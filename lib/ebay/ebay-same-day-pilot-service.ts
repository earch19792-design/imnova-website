import { createHash, randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildSameDayLocalPreparationPackage,
  evaluateReadyForContent,
  SAME_DAY_PILOT_VERSION,
  listingQuantityFromLuna,
  selectSameDayQueue,
  type SameDayCandidateInput,
} from "./ebay-same-day-pilot-domain"
import { calculateEbayUnitEconomics } from "./ebay-unit-economics"
import { ebayDraftOnlyEconomicsConfig } from "./ebay-draft-only-readiness"
import { getProductFactsStatus, runProductFactsEnrichment } from "./ebay-product-facts-enrichment"
import {
  assertEbayLaneAvailable,
  recordPersistentEbayRateLimit,
} from "./ebay-persistent-quota-coordinator"
import { reconcileProductResearchObservations } from "./ebay-product-research-identity-reconciliation"
import { enqueueListingAiTop20Continuation } from "./ebay-listing-ai-top20-queue"

const MARKETPLACE = "EBAY_US"
const MAX_RECONCILIATION_REFERENCES = 10
type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}
}
function text(value: unknown, limit = 500) {
  return typeof value === "string" ? value.trim().slice(0, limit) : ""
}
function number(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
}
function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
function versionedHash(value: unknown) {
  return `sha256:${createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex")}`
}
function operationDate(now: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Managua", year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

function candidateInput(row: JsonRecord, latestVariant: JsonRecord = {}, now = new Date()): SameDayCandidateInput {
  const assessment = record(row.assessment)
  const identity = record(assessment.identity)
  const market = record(assessment.market)
  const economics = record(assessment.economics)
  const scores = record(assessment.scores)
  const candidate = record(assessment.candidate)
  const observed = text(row.last_scanned_at)
  return {
    id: text(row.id), candidateKey: text(row.candidate_key), productTitle: text(row.product_title),
    variantTitle: text(latestVariant.variant_title || row.variant_title) || null,
    supplierSku: text(latestVariant.sku || row.supplier_sku) || null,
    supplierVariantId: text(latestVariant.supplier_variant_id || row.supplier_variant_id) || null,
    gtin: text(latestVariant.barcode || row.gtin) || null,
    brand: text(identity.brand || candidate.brand || candidate.vendor) || null,
    mpn: text(identity.mpn || candidate.mpn) || null, model: text(identity.model || candidate.model) || null,
    supplierPrice: number(latestVariant.price) ?? number(row.supplier_price),
    supplierAvailable: latestVariant.available === true ? true : latestVariant.available === false ? false : row.supplier_available === true ? true : row.supplier_available === false ? false : null,
    supplierQuantity: number(latestVariant.inventory_quantity) ?? number(row.supplier_inventory_quantity),
    supplierObservedAt: text(latestVariant.captured_at || row.supplier_snapshot_at) || null,
    exactIdentityConfirmed: identity.exactIdentityConfirmed === true,
    identityConfidence: number(scores.confidenceScore) ?? number(row.identity_score) ?? 0,
    activeExactCount: number(row.active_comparables) ?? 0, soldExactCount: number(market.soldExactCount) ?? 0,
    compatibleSellerCount: number(market.compatibleSellerCount) ?? number(row.sellers_with_movement) ?? 0,
    evidenceFresh: Boolean(observed && now.getTime() - Date.parse(observed) <= 72 * 60 * 60_000),
    economicsReady: economics.ready === true, estimatedProfit: number(row.estimated_net_profit) ?? number(economics.estimatedNetProfit),
    roiPercent: number(economics.roiPercent), netMarginPercent: number(economics.netMarginPercent),
    hardGates: strings(row.hard_gates), evidenceGuards: strings(row.evidence_guards),
    regulatedWithoutPath: strings(row.hard_gates).some((gate) => /REGULATORY|HAZMAT|EPA/.test(gate)),
    queueStatus: text(row.queue_status), score: number(row.opportunity_score) ?? 0,
    listingPackageReadiness: number(row.listing_readiness_score) ?? 0,
  }
}

async function currentState(supabase: SupabaseClient, accountKey: string, date: string) {
  const { data: run, error } = await supabase.from("ebay_same_day_pilot_runs").select("*")
    .eq("marketplace_account_key", accountKey).eq("operation_date", date).maybeSingle()
  if (error) throw new Error("SAME_DAY_PILOT_RUN_READ_FAILED")
  if (!run) return null
  const [{ data: candidates, error: candidateError }, { data: tasks, error: taskError },
    { data: transitions, error: transitionError }, { data: jobs, error: jobError }] = await Promise.all([
    supabase.from("ebay_same_day_pilot_candidates").select("*").eq("run_id", run.id).order("ordinal"),
    supabase.from("ebay_same_day_pilot_human_tasks").select("*").eq("run_id", run.id).order("created_at"),
    supabase.from("ebay_same_day_pilot_transitions").select("*").eq("run_id", run.id).order("created_at"),
    supabase.from("ebay_same_day_pilot_jobs").select("id,job_type,status,attempt,available_at,last_error_code,created_at,updated_at").eq("run_id", run.id).order("created_at"),
  ])
  if (candidateError || taskError || transitionError || jobError) throw new Error("SAME_DAY_PILOT_STATE_READ_FAILED")
  return { run, candidates: candidates ?? [], tasks: tasks ?? [], transitions: transitions ?? [], jobs: jobs ?? [] }
}

async function transition(input: {
  supabase: SupabaseClient; runId: string; candidateId: string; previousState: string | null; nextState: string
  reasonCode: string; triggeredBy: "SYSTEM" | "USER" | "SCHEDULER" | "RETRY"; checkpoint?: JsonRecord
  nextAutomaticAction: string; nextHumanAction: string; attempt?: number
}) {
  const startedAt = new Date().toISOString()
  const evidenceHash = hash({ candidateId: input.candidateId, previousState: input.previousState, nextState: input.nextState,
    reasonCode: input.reasonCode, checkpoint: input.checkpoint ?? {} })
  const idempotencyKey = `${input.runId}:${input.candidateId}:${input.nextState}:${evidenceHash}`
  const { error } = await input.supabase.from("ebay_same_day_pilot_transitions").upsert({
    run_id: input.runId, candidate_id: input.candidateId, previous_state: input.previousState, next_state: input.nextState,
    reason_code: input.reasonCode, triggered_by: input.triggeredBy, started_at: startedAt, completed_at: new Date().toISOString(),
    attempt: input.attempt ?? 1, checkpoint: input.checkpoint ?? {}, evidence_hash: evidenceHash,
    idempotency_key: idempotencyKey, next_automatic_action: input.nextAutomaticAction, next_human_action: input.nextHumanAction,
  }, { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (error) throw new Error("SAME_DAY_PILOT_TRANSITION_PERSIST_FAILED")
  const { error: updateError } = await input.supabase.from("ebay_same_day_pilot_candidates").update({
    machine_state: input.nextState, next_automated_action: input.nextAutomaticAction,
    next_human_action: input.nextHumanAction, updated_at: new Date().toISOString(),
  }).eq("id", input.candidateId).eq("run_id", input.runId)
  if (updateError) throw new Error("SAME_DAY_PILOT_CANDIDATE_TRANSITION_FAILED")
}

async function createHumanTask(input: {
  supabase: SupabaseClient; runId: string; candidateId: string; gateType: string; title: string; why: string
  seconds: number; impact: string; evidence: JsonRecord; actionSchema: JsonRecord; continuationJobType: string
}) {
  const key = `${input.runId}:${input.candidateId}:${input.gateType}`
  const { error } = await input.supabase.from("ebay_same_day_pilot_human_tasks").upsert({
    run_id: input.runId, candidate_id: input.candidateId, gate_type: input.gateType, title: input.title,
    why_needed: input.why, estimated_seconds: input.seconds, impact: input.impact, evidence_summary: input.evidence,
    action_schema: input.actionSchema, continuation_job_type: input.continuationJobType, idempotency_key: key,
  }, { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (error) throw new Error("SAME_DAY_PILOT_HUMAN_TASK_PERSIST_FAILED")
}

async function bootstrapCandidate(supabase: SupabaseClient, runId: string, candidate: JsonRecord) {
  const id = text(candidate.id)
  const initial = text(candidate.machine_state) || "RUN_CREATED"
  await transition({ supabase, runId, candidateId: id, previousState: initial, nextState: "LOCAL_FILTERING",
    reasonCode: "LOCAL_GATES_EVALUATED", triggeredBy: "SYSTEM", nextAutomaticAction: "Seleccionar candidato.", nextHumanAction: "Ninguna." })
  await transition({ supabase, runId, candidateId: id, previousState: "LOCAL_FILTERING", nextState: "CANDIDATE_SELECTION",
    reasonCode: "CANDIDATE_SELECTED_WITHOUT_EBAY_CALL", triggeredBy: "SYSTEM", nextAutomaticAction: "Preparar consulta exacta.", nextHumanAction: "Ninguna." })
  await transition({ supabase, runId, candidateId: id, previousState: "CANDIDATE_SELECTION", nextState: "PRODUCT_RESEARCH_PLAN_READY",
    reasonCode: "EXACT_QUERY_PREPARED", triggeredBy: "SYSTEM", checkpoint: record(candidate.product_research_query_plan),
    nextAutomaticAction: "Esperar autorización de captura visible.", nextHumanAction: "Autorizar una captura Product Research." })
  if (candidate.state === "NEEDS_PRODUCT_RESEARCH_CAPTURE") {
    await transition({ supabase, runId, candidateId: id, previousState: "PRODUCT_RESEARCH_PLAN_READY", nextState: "WAITING_PRODUCT_RESEARCH_CAPTURE",
      reasonCode: "PRODUCT_RESEARCH_CAPTURE_REQUIRED", triggeredBy: "SYSTEM", nextAutomaticAction: "Importar, reconciliar y reanalizar al recibir la captura.",
      nextHumanAction: "Abrir la consulta preparada y pulsar Capturar y continuar una vez." })
    await createHumanTask({ supabase, runId, candidateId: id, gateType: "PRODUCT_RESEARCH_CAPTURE_REQUIRED",
      title: "Captura Product Research para esta familia", why: "Falta evidencia vendida exacta y fresca para decidir sin confundir resultados amplios con demanda.",
      seconds: 60, impact: "La captura enriquecerá la familia y Seller OS continuará automáticamente.",
      evidence: { product: candidate.product_title, queryPlan: candidate.product_research_query_plan },
      actionSchema: { type: "OPEN_PRODUCT_RESEARCH", query: record(candidate.product_research_query_plan).query }, continuationJobType: "IMPORT_SOLD_EVIDENCE" })
  } else {
    await transition({ supabase, runId, candidateId: id, previousState: "PRODUCT_RESEARCH_PLAN_READY", nextState: "WAITING_LUNA_CONFIRMATION",
      reasonCode: "LUNA_CONFIRMATION_REQUIRED", triggeredBy: "SYSTEM", nextAutomaticAction: "Recalcular economía y enriquecer facts.",
      nextHumanAction: "Confirmar precio y disponibilidad visibles en Luna." })
    await createHumanTask({ supabase, runId, candidateId: id, gateType: "LUNA_CONFIRMATION_REQUIRED",
      title: "Confirma precio y disponibilidad Luna", why: "El costo y stock actuales son necesarios antes de comprometer margen o cantidad.", seconds: 30,
      impact: "Seller OS recalculará economía y ejecutará Product Facts automáticamente.", evidence: { product: candidate.product_title, sku: candidate.supplier_sku },
      actionSchema: { type: "LUNA_CONFIRMATION", fields: ["price", "availability", "quantityIfVisible"] }, continuationJobType: "CALCULATE_ECONOMICS" })
  }
}

async function createLunaGate(supabase: SupabaseClient, runId: string, candidate: JsonRecord, previousState: string) {
  await transition({ supabase, runId, candidateId: text(candidate.id), previousState, nextState: "WAITING_LUNA_CONFIRMATION",
    reasonCode: "LUNA_CONFIRMATION_REQUIRED", triggeredBy: "SYSTEM", nextAutomaticAction: "Recalcular economía y enriquecer facts.",
    nextHumanAction: "Confirmar precio y disponibilidad visibles en Luna." })
  await createHumanTask({ supabase, runId, candidateId: text(candidate.id), gateType: "LUNA_CONFIRMATION_REQUIRED",
    title: "Confirma precio y disponibilidad Luna", why: "El costo y stock actuales son necesarios antes de comprometer margen o cantidad.", seconds: 30,
    impact: "Seller OS recalculará economía y ejecutará Product Facts automáticamente.", evidence: { product: candidate.product_title, sku: candidate.supplier_sku },
    actionSchema: { type: "LUNA_CONFIRMATION", fields: ["price", "availability", "quantityIfVisible"] }, continuationJobType: "CALCULATE_ECONOMICS" })
}

async function promoteNextCandidate(supabase: SupabaseClient, runId: string, ordinal: number) {
  const { data, error } = await supabase.from("ebay_same_day_pilot_candidates").select("*")
    .eq("run_id", runId).gt("ordinal", ordinal).eq("machine_state", "RUN_CREATED").order("ordinal").limit(1).maybeSingle()
  if (error) throw new Error("SAME_DAY_PILOT_REPLACEMENT_READ_FAILED")
  if (data) await bootstrapCandidate(supabase, runId, record(data))
  return Boolean(data)
}

async function refreshRunProjection(supabase: SupabaseClient, runId: string) {
  const [{ data: candidates, error: candidateError }, { data: tasks, error: taskError },
    { data: jobs, error: jobError }, { data: transitions, error: transitionError }] = await Promise.all([
    supabase.from("ebay_same_day_pilot_candidates").select("machine_state,state,next_automated_action,next_human_action").eq("run_id", runId).order("ordinal"),
    supabase.from("ebay_same_day_pilot_human_tasks").select("title,status,created_at").eq("run_id", runId).eq("status", "OPEN").order("created_at").limit(1),
    supabase.from("ebay_same_day_pilot_jobs").select("status").eq("run_id", runId),
    supabase.from("ebay_same_day_pilot_transitions").select("triggered_by").eq("run_id", runId),
  ])
  if (candidateError || taskError || jobError || transitionError) throw new Error("SAME_DAY_PILOT_PROJECTION_READ_FAILED")
  const rows = candidates ?? []
  const readyCount = rows.filter((row) => row.machine_state === "READY_FOR_MANUAL_PUBLICATION").length
  const verifiedCount = rows.filter((row) => row.machine_state === "VERIFIED_ACTIVE").length
  const active = rows.find((row) => !["REJECTED", "BLOCKED", "VERIFIED_ACTIVE", "COMPLETED"].includes(row.machine_state))
  const openTask = tasks?.[0]
  const waitingRetry = (jobs ?? []).some((job) => job.status === "WAITING_RETRY")
  const completed = verifiedCount >= 2 || rows.every((row) => ["REJECTED", "VERIFIED_ACTIVE", "COMPLETED"].includes(row.machine_state))
  const systemTransitions = (transitions ?? []).filter((row) => row.triggered_by !== "USER").length
  const userTransitions = (transitions ?? []).filter((row) => row.triggered_by === "USER").length
  const status = completed ? "COMPLETED" : readyCount ? "READY_FOR_OPERATOR" : rows.some((row) => row.machine_state === "BLOCKED") ? "PARTIALLY_READY" : "ACTIVE"
  const { error } = await supabase.from("ebay_same_day_pilot_runs").update({
    status,
    stage: active?.machine_state ?? (completed ? "COMPLETED" : "QUEUE_PREPARED"),
    ready_for_manual_publication_count: Math.min(2, readyCount),
    verified_new_listings: Math.min(2, verifiedCount),
    next_automated_action: waitingRetry ? "Reanudar automáticamente desde el checkpoint al terminar la pausa." : active?.next_automated_action ?? "Preservar el trabajo completado.",
    next_human_action: openTask?.title ?? active?.next_human_action ?? "Ninguna.",
    last_worker_heartbeat_at: new Date().toISOString(),
    automation_metrics: {
      totalTransitions: (transitions ?? []).length,
      automaticTransitions: systemTransitions,
      humanTransitions: userTransitions,
      openHumanGates: openTask ? 1 : 0,
      backgroundJobs: (jobs ?? []).length,
      waitingRetries: (jobs ?? []).filter((job) => job.status === "WAITING_RETRY").length,
    },
    updated_at: new Date().toISOString(),
  }).eq("id", runId)
  if (error) throw new Error("SAME_DAY_PILOT_PROJECTION_UPDATE_FAILED")
}

async function enqueuePilotJob(input: {
  supabase: SupabaseClient
  runId: string
  candidateId: string
  jobType: string
  idempotencyKey: string
  checkpoint?: JsonRecord
  availableAt?: string
  maxAttempts?: number
  apiFamily?: string | null
  apiOperation?: string | null
  ownerLane?: string | null
}) {
  const { error } = await input.supabase.from("ebay_same_day_pilot_jobs").upsert({
    run_id: input.runId,
    candidate_id: input.candidateId,
    job_type: input.jobType,
    idempotency_key: input.idempotencyKey,
    checkpoint: input.checkpoint ?? {},
    available_at: input.availableAt ?? new Date().toISOString(),
    max_attempts: input.maxAttempts ?? 4,
    api_family: input.apiFamily ?? null,
    api_operation: input.apiOperation ?? null,
    owner_lane: input.ownerLane ?? null,
  }, { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (error) throw new Error("SAME_DAY_PILOT_JOB_PERSIST_FAILED")
}

async function completePilotJob(supabase: SupabaseClient, jobId: string) {
  const { error } = await supabase.from("ebay_same_day_pilot_jobs").update({
    status: "COMPLETED", lease_owner: null, lease_expires_at: null,
    rate_limit_resume_at: null, last_error_code: null, updated_at: new Date().toISOString(),
  }).eq("id", jobId).eq("status", "LEASED")
  if (error) throw new Error("SAME_DAY_PILOT_JOB_COMPLETE_FAILED")
}

async function deferPilotJob(input: {
  supabase: SupabaseClient
  job: JsonRecord
  availableAt: string
  errorCode: string
  preserveAttempt?: boolean
}) {
  const attempt = Math.max(0, Number(input.job.attempt ?? 1) - (input.preserveAttempt ? 1 : 0))
  const { error } = await input.supabase.from("ebay_same_day_pilot_jobs").update({
    status: "WAITING_RETRY", available_at: input.availableAt,
    rate_limit_resume_at: /429|QUOTA_PAUSED/.test(input.errorCode) ? input.availableAt : null,
    lease_owner: null, lease_expires_at: null, last_error_code: input.errorCode,
    attempt, updated_at: new Date().toISOString(),
  }).eq("id", input.job.id).eq("status", "LEASED")
  if (error) throw new Error("SAME_DAY_PILOT_JOB_DEFER_FAILED")
}

async function rejectAndPromote(input: {
  supabase: SupabaseClient
  runId: string
  candidate: JsonRecord
  previousState: string
  reasonCode: string
  blockers?: string[]
}) {
  const blockers = input.blockers?.length ? input.blockers : [input.reasonCode]
  await transition({ supabase: input.supabase, runId: input.runId, candidateId: text(input.candidate.id),
    previousState: input.previousState, nextState: "REJECTED", reasonCode: input.reasonCode,
    triggeredBy: "SYSTEM", checkpoint: { blockers }, nextAutomaticAction: "Promover el siguiente candidato.", nextHumanAction: "Ninguna." })
  const { error } = await input.supabase.from("ebay_same_day_pilot_candidates").update({
    state: "REJECTED_TODAY", blockers, updated_at: new Date().toISOString(),
  }).eq("id", input.candidate.id).eq("run_id", input.runId)
  if (error) throw new Error("SAME_DAY_PILOT_CANDIDATE_REJECT_FAILED")
  await promoteNextCandidate(input.supabase, input.runId, Number(input.candidate.ordinal))
}

export async function previewSameDayPilot(input: {
  supabase: SupabaseClient
  accountKey: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const [{ data: opportunities, error: opportunityError }, { data: quotas, error: quotaError },
    { data: monitor, error: monitorError }, productResearchCount, existingPilotListing] = await Promise.all([
    input.supabase.from("ebay_luna_opportunity_queue").select("*").in("queue_status", ["watchlist", "review", "ready"]).order("opportunity_score", { ascending: false }).limit(70),
    input.supabase.from("ebay_api_quota_states").select("api_family,operation,status,remaining,reserved_budget,available_budget,reset_at,owner_lane"),
    input.supabase.from("commercial_monitor_runs").select("status,heartbeat_at,readers,errors,completed_at").eq("marketplace_account_key", input.accountKey).eq("marketplace", MARKETPLACE).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    input.supabase.from("marketplace_product_research_capture_observations").select("id", { count: "exact", head: true }).eq("marketplace_account_key", input.accountKey).eq("marketplace", MARKETPLACE),
    input.supabase.from("ebay_active_listings").select("id", { count: "exact", head: true }).eq("account_key", input.accountKey).eq("ebay_item_id", "366543596425").eq("listing_status", "active"),
  ])
  if (opportunityError || quotaError || monitorError || productResearchCount.error || existingPilotListing.error) {
    throw new Error("SAME_DAY_PILOT_SOURCE_READ_FAILED")
  }
  const productIds = [...new Set((opportunities ?? []).map((row) => text(row.market_radar_product_id)).filter(Boolean))]
  const { data: latestVariants, error: variantError } = productIds.length
    ? await input.supabase.from("market_radar_latest_variants").select("product_id,supplier_variant_id,variant_title,sku,barcode,price,available,inventory_quantity,captured_at").in("product_id", productIds).limit(500)
    : { data: [], error: null }
  if (variantError) throw new Error("SAME_DAY_PILOT_LUNA_CURRENT_SNAPSHOT_READ_FAILED")
  const variantByKey = new Map((latestVariants ?? []).map((variant) => [
    `${text(variant.product_id)}:${text(variant.supplier_variant_id)}`, record(variant),
  ]))
  const selected = selectSameDayQueue((opportunities ?? []).map((row) => {
    const key = `${text(row.market_radar_product_id)}:${text(row.supplier_variant_id)}`
    return candidateInput(record(row), variantByKey.get(key) ?? {}, now)
  }), now)
  const { data: latestQueueRun, error: queueRunError } = await input.supabase.from("marketplace_listing_approval_queue_runs").select("id")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", MARKETPLACE).order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (queueRunError) throw new Error("SAME_DAY_PILOT_QUEUE_RUN_READ_FAILED")
  const { data: queueItems, error: queueItemError } = latestQueueRun?.id
    ? await input.supabase.from("marketplace_listing_approval_queue_items")
      .select("id,supplier_variant_id").eq("run_id", latestQueueRun.id).eq("marketplace_account_key", input.accountKey).limit(200)
    : { data: [], error: null }
  if (queueItemError) throw new Error("SAME_DAY_PILOT_QUEUE_ITEM_READ_FAILED")
  const queueItemByVariant = new Map((queueItems ?? []).map((row) => [text(row.supplier_variant_id), row.id]))
  const exactLane = (quotas ?? []).find((lane) => lane.api_family === "BROWSE" && lane.operation === "EXACT_VERIFICATION") ?? null
  return {
    observedAt: now.toISOString(),
    selected,
    queueItemByVariant,
    latestQueueRunId: latestQueueRun?.id ?? null,
    quotaLanes: quotas ?? [],
    exactVerificationLane: exactLane,
    monitor: monitor ?? { status: "NOT_RUNNING" },
    counts: {
      opportunitiesRead: opportunities?.length ?? 0,
      currentLunaVariantsRead: latestVariants?.length ?? 0,
      productResearchObservationsReused: productResearchCount.count ?? 0,
      verifiedExistingListings: (existingPilotListing.count ?? 0) > 0 ? 1 : 0,
      selectedCandidates: selected.length,
      localPreparationPackages: selected.length,
    },
    localPreparationPackages: selected.map((candidate) => ({
      candidateKey: candidate.candidateKey,
      package: buildSameDayLocalPreparationPackage(candidate, now.toISOString()),
    })),
    safety: {
      ebayReadCalls: 0,
      ebayWrites: 0,
      openAiCalls: 0,
      productionChanged: false,
      fullCatalogRescan: false,
    },
  }
}

async function createSameDayProductResearchPlan(input: {
  supabase: SupabaseClient
  accountKey: string
  queueRunId: string | null
  selected: ReturnType<typeof selectSameDayQueue>
  operationDate: string
}) {
  if (!input.queueRunId || !input.selected.length) return null
  const groups = new Map<string, typeof input.selected>()
  for (const candidate of input.selected) {
    const key = candidate.queryPlan.query.trim().toLowerCase()
    const group = groups.get(key) ?? []
    group.push(candidate)
    groups.set(key, group)
  }
  const queries = [...groups.values()].slice(0, 15).map((group, index) => ({
    ordinal: index + 1,
    search_query: group[0].queryPlan.query.slice(0, 100),
    query_hash: versionedHash(group[0].queryPlan.query.trim().toLowerCase()),
    cluster_key_hash: versionedHash(group[0].familyFingerprint),
    category_id: null,
    candidate_count: group.length,
    candidate_variant_hashes: group.map((candidate) => versionedHash(text(candidate.supplierVariantId))).sort(),
  }))
  const inputHash = versionedHash({ version: SAME_DAY_PILOT_VERSION, operationDate: input.operationDate,
    candidates: input.selected.map((candidate) => ({ variant: candidate.supplierVariantId, query: candidate.queryPlan.query })) })
  const { data, error } = await input.supabase.rpc("create_product_research_query_plan_v1", {
    p_plan_id: randomUUID(), p_marketplace_account_key: input.accountKey,
    p_run_id: input.queueRunId, p_plan_version: `${SAME_DAY_PILOT_VERSION}_QUERY_PLAN_V1`,
    p_input_hash: inputHash, p_candidate_count: input.selected.length, p_queries: queries,
  })
  if (error || !data) throw new Error("SAME_DAY_PILOT_PRODUCT_RESEARCH_PLAN_CREATE_FAILED")
  return String(data)
}

export async function startSameDayPilot(input: { supabase: SupabaseClient; accountKey: string; actorId: string; now?: Date }) {
  const now = input.now ?? new Date()
  const date = operationDate(now)
  const existing = await currentState(input.supabase, input.accountKey, date)
  const recoverEmptyRun = Boolean(existing && existing.candidates.length === 0 &&
    Number(existing.run.queue_count ?? 0) === 0)
  if (existing && !recoverEmptyRun) return { ...existing, created: false, idempotent: true }
  const preview = await previewSameDayPilot({ supabase: input.supabase, accountKey: input.accountKey, now })
  const selected = preview.selected
  const queueItemByVariant = preview.queueItemByVariant
  const productResearchPlanId = await createSameDayProductResearchPlan({
    supabase: input.supabase, accountKey: input.accountKey,
    queueRunId: preview.latestQueueRunId, selected, operationDate: date,
  })
  const runKey = `${SAME_DAY_PILOT_VERSION}:${input.accountKey}:${date}`
  const runPatch = {
    queue_count: selected.length,
    verified_existing_listings: preview.counts.verifiedExistingListings,
    source_inventory: { ...preview.counts, fullCatalogRescan: false,
      productResearchPlanPrepared: Boolean(productResearchPlanId), productResearchPlanId },
    quota_snapshot: { lanes: preview.quotaLanes, exactValidationCallsEstimated: selected.reduce((total, row) => total + row.callsEstimated, 0), protectedMonitorBudgetUsed: false },
    monitor_snapshot: preview.monitor,
    next_automated_action: selected.length ? "Esperar y procesar automáticamente la próxima evidencia autorizada." : "No hay candidatos seguros; preservar trabajo y revisar próximo conjunto.",
    next_human_action: selected.length ? "Completar la primera tarea en Tareas para Ernesto." : "Ninguna publicación debe forzarse.",
    orchestrator_version: SAME_DAY_PILOT_VERSION,
    status: "ACTIVE",
    updated_at: now.toISOString(),
  }
  const runResult = recoverEmptyRun
    ? await input.supabase.from("ebay_same_day_pilot_runs").update(runPatch)
      .eq("id", existing!.run.id).eq("queue_count", 0).select("*").single()
    : await input.supabase.from("ebay_same_day_pilot_runs").insert({
      marketplace_account_key: input.accountKey, operation_date: date, run_key: runKey,
      ...runPatch, created_by: input.actorId,
    }).select("*").single()
  const { data: run, error: runError } = runResult
  if (runError || !run) {
    const raced = await currentState(input.supabase, input.accountKey, date)
    if (raced) return { ...raced, created: false, idempotent: true }
    throw new Error("SAME_DAY_PILOT_RUN_CREATE_FAILED")
  }
  const rows = selected.map((entry, index) => ({
    run_id: run.id, opportunity_id: entry.id, queue_item_id: queueItemByVariant.get(text(entry.supplierVariantId)) ?? null,
    ordinal: index + 1, state: entry.state, machine_state: "RUN_CREATED",
    candidate_key: entry.candidateKey, product_title: entry.productTitle, supplier_sku: entry.supplierSku,
    supplier_variant_id: entry.supplierVariantId, family_fingerprint: entry.familyFingerprint, priority: entry.priority,
    blockers: entry.blockers, evidence_summary: { activeExactCount: entry.activeExactCount, soldExactCount: entry.soldExactCount,
      compatibleSellerCount: entry.compatibleSellerCount, evidenceFresh: entry.evidenceFresh, broadSearchIsDemand: false },
    economics_summary: { ready: entry.economicsReady, estimatedProfit: entry.estimatedProfit, roiPercent: entry.roiPercent, netMarginPercent: entry.netMarginPercent },
    product_research_query_plan: entry.queryPlan, calls_estimated: entry.callsEstimated,
    local_preparation_status: "BLOCKED_PENDING_VERIFIED_GATES",
    local_preparation_package: buildSameDayLocalPreparationPackage(entry, now.toISOString()),
    next_automated_action: entry.nextAutomatedAction, next_human_action: entry.nextHumanAction,
  }))
  if (rows.length) {
    const { data: candidates, error } = await input.supabase.from("ebay_same_day_pilot_candidates").insert(rows).select("*")
    if (error) throw new Error("SAME_DAY_PILOT_CANDIDATES_CREATE_FAILED")
    const first = candidates?.[0]
    if (first) await bootstrapCandidate(input.supabase, run.id, record(first))
  }
  const eventType = recoverEmptyRun ? "EMPTY_RUN_RECOVERED" : "RUN_STARTED"
  const { error: eventError } = await input.supabase.from("ebay_same_day_pilot_events").upsert({ run_id: run.id, event_type: eventType,
    event_payload: { oneClick: true, candidates: selected.length, fullCatalogRescan: false,
      deepDiscoveryFrozen: true, recoveredEmptyRun: recoverEmptyRun },
    idempotency_key: `${run.id}:${eventType}`, ebay_read_calls: 0, openai_calls: 0, ebay_writes: 0, production_changed: false },
  { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (eventError) throw new Error("SAME_DAY_PILOT_START_EVENT_PERSIST_FAILED")
  await refreshRunProjection(input.supabase, run.id)
  const state = await currentState(input.supabase, input.accountKey, date)
  if (!state) throw new Error("SAME_DAY_PILOT_STATE_MISSING")
  return { ...state, created: !recoverEmptyRun, recovered: recoverEmptyRun, idempotent: false }
}

export async function getSameDayPilot(input: { supabase: SupabaseClient; accountKey: string; now?: Date }) {
  return currentState(input.supabase, input.accountKey, operationDate(input.now ?? new Date()))
}

export async function confirmSameDayLuna(input: { supabase: SupabaseClient; accountKey: string; actorId: string; taskId: string; price: number; available: boolean; quantity: number | null }) {
  const state = await getSameDayPilot(input)
  if (!state) throw new Error("SAME_DAY_PILOT_RUN_MISSING")
  const task = state.tasks.find((entry) => entry.id === input.taskId && entry.status === "OPEN")
  if (!task || task.gate_type !== "LUNA_CONFIRMATION_REQUIRED") throw new Error("SAME_DAY_PILOT_LUNA_TASK_INVALID")
  if (!(input.price > 0)) throw new Error("SAME_DAY_PILOT_LUNA_PRICE_INVALID")
  const candidate = state.candidates.find((entry) => entry.id === task.candidate_id)
  if (!candidate) throw new Error("SAME_DAY_PILOT_LUNA_CANDIDATE_MISSING")
  const quantity = listingQuantityFromLuna(input.quantity, input.available)
  const now = new Date().toISOString()
  const { error: taskError } = await input.supabase.from("ebay_same_day_pilot_human_tasks").update({ status: "COMPLETED", completed_at: now, updated_at: now }).eq("id", task.id).eq("status", "OPEN")
  if (taskError) throw new Error("SAME_DAY_PILOT_TASK_COMPLETE_FAILED")
  const { error: candidateError } = await input.supabase.from("ebay_same_day_pilot_candidates").update({ listing_quantity: quantity.quantity || null,
    recheck_after_sale: quantity.recheckAfterSale, economics_summary: { confirmedLunaPrice: input.price, available: input.available,
      quantity: input.quantity, quantityUnknown: input.quantity == null }, updated_at: now }).eq("id", task.candidate_id)
  if (candidateError) throw new Error("SAME_DAY_PILOT_LUNA_CANDIDATE_UPDATE_FAILED")
  if (!input.available) {
    await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
      previousState: "WAITING_LUNA_CONFIRMATION", reasonCode: "LUNA_OUT_OF_STOCK" })
  } else {
    const evidence = record(candidate.evidence_summary)
    const exactMarketReady = Number(evidence.activeExactCount ?? 0) > 0 && evidence.evidenceFresh === true
    if (!exactMarketReady) {
      await transition({ supabase: input.supabase, runId: state.run.id, candidateId: task.candidate_id,
        previousState: "WAITING_LUNA_CONFIRMATION", nextState: "WAITING_PRODUCT_RESEARCH_CAPTURE",
        reasonCode: "LUNA_CONFIRMED_MARKET_EVIDENCE_PENDING", triggeredBy: "USER",
        checkpoint: { price: input.price, available: true, quantityKnown: input.quantity != null },
        nextAutomaticAction: "Importar y reconciliar la captura autorizada.",
        nextHumanAction: "Autorizar una captura Product Research para la consulta preparada." })
      const { error: stateError } = await input.supabase.from("ebay_same_day_pilot_candidates").update({
        state: "NEEDS_PRODUCT_RESEARCH_CAPTURE", updated_at: now,
      }).eq("id", task.candidate_id)
      if (stateError) throw new Error("SAME_DAY_PILOT_MARKET_GATE_UPDATE_FAILED")
      await createHumanTask({ supabase: input.supabase, runId: state.run.id, candidateId: task.candidate_id,
        gateType: "PRODUCT_RESEARCH_CAPTURE_REQUIRED", title: "Captura Product Research para esta familia",
        why: "Luna ya fue confirmada; falta evidencia vendida exacta y fresca antes de calcular una oferta final.",
        seconds: 60, impact: "Seller OS reconciliará la evidencia y continuará desde el mismo candidato.",
        evidence: { product: candidate.product_title, queryPlan: candidate.product_research_query_plan },
        actionSchema: { type: "OPEN_PRODUCT_RESEARCH", query: record(candidate.product_research_query_plan).query },
        continuationJobType: "RECONCILE_PRODUCT_RESEARCH_CAPTURE" })
    } else {
      await transition({ supabase: input.supabase, runId: state.run.id, candidateId: task.candidate_id,
        previousState: "WAITING_LUNA_CONFIRMATION", nextState: "CALCULATING_ECONOMICS",
        reasonCode: "LUNA_CONFIRMED_AUTO_RESUME", triggeredBy: "USER",
        checkpoint: { price: input.price, available: true, quantityKnown: input.quantity != null },
        nextAutomaticAction: "Recalcular economía localmente.", nextHumanAction: "Ninguna." })
      await enqueuePilotJob({ supabase: input.supabase, runId: state.run.id, candidateId: task.candidate_id,
        jobType: "CALCULATE_ECONOMICS", idempotencyKey: `${state.run.id}:${task.candidate_id}:CALCULATE_ECONOMICS`,
        checkpoint: { confirmedLunaPrice: input.price, quantityKnown: input.quantity != null } })
    }
  }
  await refreshRunProjection(input.supabase, state.run.id)
  return getSameDayPilot(input)
}

export async function resumeSameDayPilotAfterProductResearchCapture(input: { supabase: SupabaseClient; accountKey: string; searchQuery: string; batchId: string; capturedAt?: string | null; exactLunaMatches?: number }) {
  const state = await getSameDayPilot(input)
  if (!state) return { resumed: 0 }
  const normalizedQuery = input.searchQuery.trim().toLowerCase()
  const candidates = state.candidates.filter((candidate) => candidate.machine_state === "WAITING_PRODUCT_RESEARCH_CAPTURE" &&
    text(record(candidate.product_research_query_plan).query).toLowerCase() === normalizedQuery)
  for (const candidate of candidates) {
    const { count: candidateExactMatches, error: matchError } = await input.supabase
      .from("marketplace_product_research_capture_observations")
      .select("id", { count: "exact", head: true })
      .eq("capture_batch_id", input.batchId)
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", MARKETPLACE)
      .eq("matched_supplier_variant_id", candidate.supplier_variant_id)
      .eq("match_classification", "EXACT_LUNA_MATCH")
      .eq("evidence_reviewed", true)
    if (matchError) throw new Error("SAME_DAY_PILOT_CAPTURE_MATCH_READ_FAILED")
    const exactMatches = candidateExactMatches ?? 0
    const task = state.tasks.find((entry) => entry.candidate_id === candidate.id && entry.gate_type === "PRODUCT_RESEARCH_CAPTURE_REQUIRED" && entry.status === "OPEN")
    if (task) await input.supabase.from("ebay_same_day_pilot_human_tasks").update({ status: "COMPLETED", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", task.id)
    await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
      previousState: "WAITING_PRODUCT_RESEARCH_CAPTURE", nextState: "IMPORTING_SOLD_EVIDENCE", reasonCode: "AUTHORIZED_CAPTURE_RECEIVED_AUTO_RESUME",
      triggeredBy: "SYSTEM", checkpoint: { captureBatchId: input.batchId }, nextAutomaticAction: "Reconciliar identidad, Luna y Loop 1.", nextHumanAction: "Ninguna." })
    const { error: batchUpdateError } = await input.supabase.from("ebay_same_day_pilot_candidates").update({
      product_research_capture_batch_id: input.batchId, updated_at: new Date().toISOString(),
    }).eq("id", candidate.id).eq("run_id", state.run.id)
    if (batchUpdateError) throw new Error("SAME_DAY_PILOT_CAPTURE_LINK_FAILED")
    if (exactMatches <= 0) {
      await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
        previousState: "IMPORTING_SOLD_EVIDENCE", reasonCode: "NO_EXACT_LUNA_MATCH_IN_AUTHORIZED_CAPTURE" })
    } else {
      await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
        previousState: "IMPORTING_SOLD_EVIDENCE", nextState: "RECONCILING_IDENTITY", reasonCode: "SOLD_EVIDENCE_IMPORTED",
        triggeredBy: "SYSTEM", checkpoint: { captureBatchId: input.batchId, exactLunaMatches: exactMatches },
        nextAutomaticAction: "Reconciliar sólo las referencias de este candidato.", nextHumanAction: "Ninguna." })
      await enqueuePilotJob({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
        jobType: "RECONCILE_PRODUCT_RESEARCH_CAPTURE",
        idempotencyKey: `${state.run.id}:${candidate.id}:RECONCILE_PRODUCT_RESEARCH_CAPTURE:${input.batchId}`,
        checkpoint: { captureBatchId: input.batchId, supplierVariantId: candidate.supplier_variant_id,
          capturedAt: input.capturedAt ?? new Date().toISOString() }, maxAttempts: 10,
        apiFamily: "BROWSE", apiOperation: "EXACT_VERIFICATION", ownerLane: "P1_EXACT_VERIFICATION" })
    }
  }
  await refreshRunProjection(input.supabase, state.run.id)
  return { resumed: candidates.length }
}

function retryable(code: string) {
  return /(?:429|NETWORK|TIMEOUT|HTTP_5\d\d|TEMPORARY|LEASE)/.test(code)
}

export async function processSameDayPilotJobs(input: { supabase: SupabaseClient; accountKey: string; workerId: string; now?: Date }) {
  const now = input.now ?? new Date()
  const state = await getSameDayPilot({ supabase: input.supabase, accountKey: input.accountKey, now })
  if (!state) return { processed: 0, status: "NO_ACTIVE_RUN" }
  const { data: claimed, error: leaseError } = await input.supabase.rpc("claim_same_day_pilot_job", {
    p_run_id: state.run.id, p_worker_id: input.workerId, p_now: now.toISOString(),
  })
  if (leaseError) throw new Error("SAME_DAY_PILOT_JOB_LEASE_FAILED")
  const leased = Array.isArray(claimed) ? claimed[0] : claimed
  if (!leased) return { processed: 0, status: "LEASE_LOST" }
  const candidate = state.candidates.find((entry) => entry.id === leased.candidate_id)
  if (!candidate) throw new Error("SAME_DAY_PILOT_JOB_CANDIDATE_MISSING")
  try {
    if (leased.api_family && leased.api_operation) {
      const lane = await assertEbayLaneAvailable(input.supabase, leased.api_family, leased.api_operation, now)
      if (!lane.available) {
        const resumeAt = lane.resumeAt ?? new Date(now.getTime() + 15 * 60_000).toISOString()
        await deferPilotJob({ supabase: input.supabase, job: record(leased), availableAt: resumeAt,
          errorCode: "EBAY_QUOTA_PAUSED_429", preserveAttempt: true })
        await refreshRunProjection(input.supabase, state.run.id)
        return { processed: 1, status: "PAUSED_429", jobType: leased.job_type, resumeAt,
          checkpointPreserved: true, ebayCalls: 0 }
      }
    }

    if (leased.job_type === "RECONCILE_PRODUCT_RESEARCH_CAPTURE") {
      const checkpoint = record(leased.checkpoint)
      const batchId = text(checkpoint.captureBatchId)
      const supplierVariantId = text(checkpoint.supplierVariantId)
      const { data: observations, error: observationError } = await input.supabase
        .from("marketplace_product_research_capture_observations")
        .select("id").eq("capture_batch_id", batchId)
        .eq("marketplace_account_key", input.accountKey).eq("marketplace", MARKETPLACE)
        .eq("matched_supplier_variant_id", supplierVariantId).eq("evidence_reviewed", true)
        .order("confirmed_sold_quantity", { ascending: false }).limit(MAX_RECONCILIATION_REFERENCES)
      if (observationError) throw new Error("SAME_DAY_PILOT_RECONCILIATION_OBSERVATION_READ_FAILED")
      const observationIds = (observations ?? []).map((row) => text(row.id)).filter(Boolean)
      if (!observationIds.length) {
        await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
          previousState: "RECONCILING_IDENTITY", reasonCode: "CANDIDATE_CAPTURE_REFERENCES_MISSING" })
      } else {
        const reconciled = await reconcileProductResearchObservations({
          supabase: input.supabase, accountKey: input.accountKey, observationIds, now,
        })
        if (Number(reconciled.aggregates.exact ?? 0) <= 0 || !reconciled.reanalysis.runId || !reconciled.reanalysis.shouldSchedule) {
          await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
            previousState: "RECONCILING_IDENTITY", reasonCode: "OFFICIAL_IDENTITY_RECONCILIATION_NOT_EXACT" })
        } else {
          await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
            previousState: "RECONCILING_IDENTITY", nextState: "MATCHING_LUNA", reasonCode: "IDENTITY_RECONCILIATION_COMPLETED",
            triggeredBy: "SYSTEM", checkpoint: { captureBatchId: batchId, references: observationIds.length,
              exactLunaMatches: reconciled.aggregates.exact }, nextAutomaticAction: "Ejecutar Loop 1 para este candidato.", nextHumanAction: "Ninguna." })
          await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
            previousState: "MATCHING_LUNA", nextState: "RUNNING_LOOP_1", reasonCode: "EXACT_LUNA_MATCH_CONFIRMED",
            triggeredBy: "SYSTEM", checkpoint: { captureBatchId: batchId, queueRunId: reconciled.reanalysis.runId },
            nextAutomaticAction: "Esperar el resultado candidato-específico de Loop 1.", nextHumanAction: "Ninguna." })
          const dispatched = await enqueueListingAiTop20Continuation({
            supabase: input.supabase, runId: reconciled.reanalysis.runId,
            continuationGeneration: reconciled.reanalysis.continuationGeneration,
            expectedBatch: reconciled.reanalysis.expectedBatch,
          })
          await enqueuePilotJob({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
            jobType: "WAIT_FOR_LOOP1_REANALYSIS",
            idempotencyKey: `${state.run.id}:${candidate.id}:WAIT_FOR_LOOP1_REANALYSIS:${batchId}`,
            checkpoint: { ...checkpoint, queueRunId: reconciled.reanalysis.runId,
              reconciliationReferences: observationIds.length, dispatchStatus: dispatched.status },
            availableAt: new Date(now.getTime() + 60_000).toISOString(), maxAttempts: 10 })
        }
      }
    } else if (leased.job_type === "WAIT_FOR_LOOP1_REANALYSIS") {
      const checkpoint = record(leased.checkpoint)
      const queueRunId = text(checkpoint.queueRunId)
      const supplierVariantId = text(checkpoint.supplierVariantId)
      const { data: target, error: targetError } = await input.supabase
        .from("marketplace_listing_approval_queue_scan_targets")
        .select("status,evidence_reanalysis_requested_at,evidence_reanalysis_completed_at,last_error_code")
        .eq("run_id", queueRunId).eq("marketplace_account_key", input.accountKey)
        .eq("supplier_variant_id", supplierVariantId).limit(1).maybeSingle()
      if (targetError) throw new Error("SAME_DAY_PILOT_LOOP1_TARGET_READ_FAILED")
      const requestedAt = Date.parse(text(target?.evidence_reanalysis_requested_at))
      const completedAt = Date.parse(text(target?.evidence_reanalysis_completed_at))
      if (!target || !Number.isFinite(completedAt) || (Number.isFinite(requestedAt) && completedAt < requestedAt)) {
        const capturedAt = Date.parse(text(checkpoint.capturedAt))
        if (Number.isFinite(capturedAt) && now.getTime() - capturedAt > 6 * 60 * 60_000) {
          await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
            previousState: "RUNNING_LOOP_1", reasonCode: "LOOP1_REANALYSIS_TIMEOUT" })
        } else {
          const nextCheck = new Date(now.getTime() + 60_000).toISOString()
          await deferPilotJob({ supabase: input.supabase, job: record(leased), availableAt: nextCheck,
            errorCode: "LOOP1_REANALYSIS_PENDING", preserveAttempt: true })
          await refreshRunProjection(input.supabase, state.run.id)
          return { processed: 1, status: "WAITING_RETRY", jobType: leased.job_type,
            checkpointPreserved: true, nextCheckAt: nextCheck }
        }
      } else {
        const { data: queueItem, error: queueItemError } = await input.supabase
          .from("marketplace_listing_approval_queue_items").select("id,luna_match_status,internal_status,evidence_snapshot,analyzed_at")
          .eq("run_id", queueRunId).eq("marketplace_account_key", input.accountKey)
          .eq("supplier_variant_id", supplierVariantId).order("analyzed_at", { ascending: false }).limit(1).maybeSingle()
        if (queueItemError) throw new Error("SAME_DAY_PILOT_LOOP1_ITEM_READ_FAILED")
        if (!queueItem || queueItem.luna_match_status !== "EXACT_LUNA_MATCH" || queueItem.internal_status === "REANALYSIS_REQUIRED") {
          await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
            previousState: "RUNNING_LOOP_1", reasonCode: "LOOP1_EXACT_IDENTITY_NOT_CONFIRMED" })
        } else {
          const evidence = record(queueItem.evidence_snapshot)
          const market = record(evidence.market)
          const { error: updateError } = await input.supabase.from("ebay_same_day_pilot_candidates").update({
            queue_item_id: queueItem.id,
            evidence_summary: { ...record(candidate.evidence_summary), exactIdentityConfirmed: true,
              soldExactCount: number(market.soldExactCount) ?? 0, loop1AnalyzedAt: queueItem.analyzed_at },
            updated_at: new Date().toISOString(),
          }).eq("id", candidate.id).eq("run_id", state.run.id)
          if (updateError) throw new Error("SAME_DAY_PILOT_LOOP1_LINK_FAILED")
          const confirmation = record(candidate.economics_summary)
          if (Number(confirmation.confirmedLunaPrice) > 0 && confirmation.available === true) {
            await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
              previousState: "RUNNING_LOOP_1", nextState: "CALCULATING_ECONOMICS", reasonCode: "LOOP1_REANALYSIS_COMPLETED_AUTO_RESUME",
              triggeredBy: "SYSTEM", nextAutomaticAction: "Calcular economía localmente.", nextHumanAction: "Ninguna." })
            await enqueuePilotJob({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
              jobType: "CALCULATE_ECONOMICS", idempotencyKey: `${state.run.id}:${candidate.id}:CALCULATE_ECONOMICS`,
              checkpoint: { confirmedLunaPrice: confirmation.confirmedLunaPrice,
                quantityKnown: confirmation.quantityUnknown !== true } })
          } else {
            await createLunaGate(input.supabase, state.run.id, record(candidate), "RUNNING_LOOP_1")
          }
        }
      }
    } else if (leased.job_type === "CALCULATE_ECONOMICS") {
      const { data: opportunity, error: opportunityError } = await input.supabase.from("ebay_luna_opportunity_queue").select("*").eq("id", candidate.opportunity_id).single()
      if (opportunityError) throw new Error("SAME_DAY_PILOT_OPPORTUNITY_READ_FAILED")
      const confirmation = { ...record(candidate.economics_summary), ...record(leased.checkpoint) }
      const confirmedLunaPrice = number(confirmation.confirmedLunaPrice)
      const economics = calculateEbayUnitEconomics({ salePrice: opportunity.median_total_buyer_price,
        supplierCost: confirmedLunaPrice }, ebayDraftOnlyEconomicsConfig())
      const economicsGate = evaluateReadyForContent({ exactOrStrongIdentity: Boolean(candidate.queue_item_id),
        exactMarketEvidence: Number(opportunity.active_comparables) > 0, productFactsCompatible: true,
        requiredAspectsResolved: true, regulatoryAcceptable: true, shippingEstimateAvailable: true,
        estimatedProfit: economics.estimatedNetProfit, roiPercent: economics.estimatedRoiPercent,
        netMarginPercent: economics.estimatedNetMarginPercent })
      const { error: economicsUpdateError } = await input.supabase.from("ebay_same_day_pilot_candidates").update({
        economics_summary: { ...economics, confirmedLunaPrice, available: true,
          quantityUnknown: confirmation.quantityKnown !== true }, updated_at: new Date().toISOString(),
      }).eq("id", candidate.id)
      if (economicsUpdateError) throw new Error("SAME_DAY_PILOT_ECONOMICS_UPDATE_FAILED")
      if (!economics.ready || !economicsGate.ready) {
        await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
          previousState: "CALCULATING_ECONOMICS", reasonCode: economicsGate.blockers[0] ?? "ECONOMICS_UNAVAILABLE",
          blockers: economicsGate.blockers })
      } else if (!candidate.queue_item_id) {
        await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
          previousState: "CALCULATING_ECONOMICS", reasonCode: "EXACT_TOP20_QUEUE_IDENTITY_MISSING" })
      } else {
        await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id, previousState: "CALCULATING_ECONOMICS",
          nextState: "ENRICHING_PRODUCT_FACTS", reasonCode: "ECONOMICS_GATES_PASSED", triggeredBy: "SYSTEM",
          checkpoint: { idealProfitReached: economicsGate.idealProfitReached }, nextAutomaticAction: "Resolver Product Facts, Taxonomy y regulación.", nextHumanAction: "Ninguna." })
        await enqueuePilotJob({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
          jobType: "ENRICH_PRODUCT_FACTS", idempotencyKey: `${state.run.id}:${candidate.id}:ENRICH_PRODUCT_FACTS`,
          checkpoint: { queueItemId: candidate.queue_item_id }, maxAttempts: 10,
          apiFamily: "BROWSE", apiOperation: "EXACT_VERIFICATION", ownerLane: "P1_EXACT_VERIFICATION" })
      }
    } else if (leased.job_type === "ENRICH_PRODUCT_FACTS") {
      if (!candidate.queue_item_id) throw new Error("SAME_DAY_PILOT_FACT_QUEUE_ITEM_MISSING")
      await runProductFactsEnrichment({ supabase: input.supabase, accountKey: input.accountKey, candidateIds: [candidate.queue_item_id] })
      await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id, previousState: "ENRICHING_PRODUCT_FACTS",
        nextState: "VALIDATING_TAXONOMY", reasonCode: "PRODUCT_FACTS_ENRICHED", triggeredBy: "SYSTEM",
        nextAutomaticAction: "Validar regulación.", nextHumanAction: "Ninguna." })
      await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id, previousState: "VALIDATING_TAXONOMY",
        nextState: "VALIDATING_REGULATION", reasonCode: "TAXONOMY_REQUIREMENTS_RESOLVED", triggeredBy: "SYSTEM",
        nextAutomaticAction: "Construir paquete filtrado para OpenAI.", nextHumanAction: "Ninguna." })
      const facts = await getProductFactsStatus({ supabase: input.supabase, accountKey: input.accountKey, candidateIds: [candidate.queue_item_id] })
      const summary = record(facts.byCandidate[candidate.queue_item_id])
      const openAiReady = record(summary.gates).OPENAI_INPUT_READY === true
      const { error: summaryError } = await input.supabase.from("ebay_same_day_pilot_candidates").update({ product_facts_summary: summary }).eq("id", candidate.id)
      if (summaryError) throw new Error("SAME_DAY_PILOT_FACT_SUMMARY_UPDATE_FAILED")
      if (!openAiReady) {
        await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
          previousState: "VALIDATING_REGULATION", reasonCode: "PRODUCT_FACTS_NOT_READY_TODAY",
          blockers: [text(record(summary.exception).blockingStatus) || "OPENAI_INPUT_NOT_READY"] })
      } else {
        await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id, previousState: "VALIDATING_REGULATION",
          nextState: "BUILDING_OPENAI_INPUT", reasonCode: "OPENAI_INPUT_READY", triggeredBy: "SYSTEM",
          nextAutomaticAction: "Solicitar aprobación del producto.", nextHumanAction: "Aprobar o rechazar el producto." })
        await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id, previousState: "BUILDING_OPENAI_INPUT",
          nextState: "WAITING_PRODUCT_APPROVAL", reasonCode: "PRODUCT_APPROVAL_REQUIRED", triggeredBy: "SYSTEM",
          nextAutomaticAction: "Generar versión 1 al aprobar.", nextHumanAction: "Revisar y aprobar el producto." })
        await createHumanTask({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id, gateType: "PRODUCT_APPROVAL_REQUIRED",
          title: "Revisa el producto preparado", why: "La identidad, economía y ficha técnica pasaron; falta decisión humana antes de generar contenido.",
          seconds: 180, impact: "Seller OS generará y validará automáticamente una versión de contenido cuando OpenAI sea habilitado explícitamente.",
          evidence: { economics: candidate.economics_summary, facts: summary },
          actionSchema: { type: "PRODUCT_APPROVAL", actions: ["APPROVE", "REQUEST_ONE_REVISION", "REJECT"] }, continuationJobType: "GENERATE_LISTING_CONTENT" })
      }
    } else {
      throw new Error("SAME_DAY_PILOT_JOB_TYPE_UNSUPPORTED")
    }
    await completePilotJob(input.supabase, leased.id)
    await refreshRunProjection(input.supabase, state.run.id)
    return { processed: 1, status: "COMPLETED", jobType: leased.job_type }
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message) ? error.message : "SAME_DAY_PILOT_JOB_FAILED"
    const canRetry = retryable(code) && Number(leased.attempt) < Number(leased.max_attempts)
    let availableAt = new Date(now.getTime() + Math.min(900, 30 * 2 ** Number(leased.attempt)) * 1000).toISOString()
    if (/429/.test(code)) {
      const persisted = await recordPersistentEbayRateLimit(input.supabase, {
        error, apiFamily: text(leased.api_family) || "BROWSE",
        endpoint: text(leased.api_operation) || "EXACT_VERIFICATION",
        operation: text(leased.api_operation) || "EXACT_VERIFICATION",
        lane: "P1_EXACT_VERIFICATION", checkpoint: record(leased.checkpoint), retryCount: Number(leased.attempt),
      })
      availableAt = persisted?.resumeAt ?? new Date(now.getTime() + 15 * 60_000).toISOString()
    }
    const { error: updateError } = await input.supabase.from("ebay_same_day_pilot_jobs").update({
      status: canRetry ? "WAITING_RETRY" : "DEAD_LETTER", available_at: availableAt,
      rate_limit_resume_at: /429/.test(code) ? availableAt : null,
      lease_owner: null, lease_expires_at: null, last_error_code: code, updated_at: new Date().toISOString(),
    }).eq("id", leased.id).eq("status", "LEASED")
    if (updateError) throw new Error("SAME_DAY_PILOT_JOB_FAILURE_PERSIST_FAILED")
    if (!canRetry) {
      await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
        previousState: text(candidate.machine_state), reasonCode: code })
    }
    await refreshRunProjection(input.supabase, state.run.id)
    return { processed: 1, status: canRetry ? "WAITING_RETRY" : "DEAD_LETTER", error: code,
      resumeAt: /429/.test(code) ? availableAt : null, checkpointPreserved: true }
  }
}
