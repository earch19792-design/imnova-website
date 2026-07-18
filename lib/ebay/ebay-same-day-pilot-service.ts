import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  evaluateReadyForContent,
  SAME_DAY_PILOT_VERSION,
  listingQuantityFromLuna,
  selectSameDayQueue,
  type SameDayCandidateInput,
} from "./ebay-same-day-pilot-domain"
import { calculateEbayUnitEconomics } from "./ebay-unit-economics"
import { ebayDraftOnlyEconomicsConfig } from "./ebay-draft-only-readiness"
import { getProductFactsStatus, runProductFactsEnrichment } from "./ebay-product-facts-enrichment"

const MARKETPLACE = "EBAY_US"
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
function operationDate(now: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Managua", year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

function candidateInput(row: JsonRecord, latestVariant: JsonRecord = {}): SameDayCandidateInput {
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
    evidenceFresh: Boolean(observed && Date.now() - Date.parse(observed) <= 72 * 60 * 60_000),
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

export async function startSameDayPilot(input: { supabase: SupabaseClient; accountKey: string; actorId: string; now?: Date }) {
  const now = input.now ?? new Date()
  const date = operationDate(now)
  const existing = await currentState(input.supabase, input.accountKey, date)
  if (existing) return { ...existing, created: false, idempotent: true }
  const [{ data: opportunities, error: opportunityError }, { data: quotas, error: quotaError },
    { data: monitor, error: monitorError }, productResearchCount, existingPilotListing] = await Promise.all([
    input.supabase.from("ebay_luna_opportunity_queue").select("*").in("queue_status", ["watchlist", "review", "ready"]).order("opportunity_score", { ascending: false }).limit(70),
    input.supabase.from("ebay_api_quota_states").select("api_family,operation,status,remaining,reserved_budget,available_budget,reset_at,owner_lane"),
    input.supabase.from("commercial_monitor_runs").select("status,heartbeat_at,readers,errors,completed_at").eq("marketplace_account_key", input.accountKey).eq("marketplace", MARKETPLACE).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    input.supabase.from("marketplace_product_research_capture_observations").select("id", { count: "exact", head: true }).eq("marketplace_account_key", input.accountKey).eq("marketplace", MARKETPLACE),
    input.supabase.from("ebay_active_listings").select("id", { count: "exact", head: true }).eq("account_key", input.accountKey).eq("ebay_item_id", "366543596425").eq("listing_status", "active"),
  ])
  if (opportunityError || quotaError || monitorError || productResearchCount.error || existingPilotListing.error) throw new Error("SAME_DAY_PILOT_SOURCE_READ_FAILED")
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
    return candidateInput(record(row), variantByKey.get(key) ?? {})
  }))
  const { data: latestQueueRun } = await input.supabase.from("marketplace_listing_approval_queue_runs").select("id")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", MARKETPLACE).order("created_at", { ascending: false }).limit(1).maybeSingle()
  const { data: queueItems } = latestQueueRun?.id ? await input.supabase.from("marketplace_listing_approval_queue_items")
    .select("id,supplier_variant_id").eq("run_id", latestQueueRun.id).eq("marketplace_account_key", input.accountKey).limit(200) : { data: [] }
  const queueItemByVariant = new Map((queueItems ?? []).map((row) => [text(row.supplier_variant_id), row.id]))
  const runKey = `${SAME_DAY_PILOT_VERSION}:${input.accountKey}:${date}`
  const { data: run, error: runError } = await input.supabase.from("ebay_same_day_pilot_runs").insert({
    marketplace_account_key: input.accountKey, operation_date: date, run_key: runKey, queue_count: selected.length,
    verified_existing_listings: (existingPilotListing.count ?? 0) > 0 ? 1 : 0,
    source_inventory: { opportunitiesRead: opportunities?.length ?? 0, currentLunaVariantsRead: latestVariants?.length ?? 0,
      productResearchObservationsReused: productResearchCount.count ?? 0, fullCatalogRescan: false },
    quota_snapshot: { lanes: quotas ?? [], exactValidationCallsEstimated: selected.reduce((total, row) => total + row.callsEstimated, 0), protectedMonitorBudgetUsed: false },
    monitor_snapshot: monitor ?? { status: "NOT_RUNNING" },
    next_automated_action: selected.length ? "Esperar y procesar automáticamente la próxima evidencia autorizada." : "No hay candidatos seguros; preservar trabajo y revisar próximo conjunto.",
    next_human_action: selected.length ? "Completar la primera tarea en Tareas para Ernesto." : "Ninguna publicación debe forzarse.", created_by: input.actorId,
  }).select("*").single()
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
    next_automated_action: entry.nextAutomatedAction, next_human_action: entry.nextHumanAction,
  }))
  if (rows.length) {
    const { data: candidates, error } = await input.supabase.from("ebay_same_day_pilot_candidates").insert(rows).select("*")
    if (error) throw new Error("SAME_DAY_PILOT_CANDIDATES_CREATE_FAILED")
    const first = candidates?.[0]
    if (first) await bootstrapCandidate(input.supabase, run.id, record(first))
  }
  await input.supabase.from("ebay_same_day_pilot_events").insert({ run_id: run.id, event_type: "RUN_STARTED",
    event_payload: { oneClick: true, candidates: selected.length, fullCatalogRescan: false, deepDiscoveryFrozen: true },
    idempotency_key: `${run.id}:RUN_STARTED`, ebay_read_calls: 0, openai_calls: 0, ebay_writes: 0, production_changed: false })
  const state = await currentState(input.supabase, input.accountKey, date)
  if (!state) throw new Error("SAME_DAY_PILOT_STATE_MISSING")
  return { ...state, created: true, idempotent: false }
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
  const quantity = listingQuantityFromLuna(input.quantity, input.available)
  const now = new Date().toISOString()
  const { error: taskError } = await input.supabase.from("ebay_same_day_pilot_human_tasks").update({ status: "COMPLETED", completed_at: now, updated_at: now }).eq("id", task.id).eq("status", "OPEN")
  if (taskError) throw new Error("SAME_DAY_PILOT_TASK_COMPLETE_FAILED")
  await input.supabase.from("ebay_same_day_pilot_candidates").update({ listing_quantity: quantity.quantity || null,
    recheck_after_sale: quantity.recheckAfterSale, economics_summary: { confirmedLunaPrice: input.price, available: input.available,
      quantity: input.quantity, quantityUnknown: input.quantity == null }, updated_at: now }).eq("id", task.candidate_id)
  await transition({ supabase: input.supabase, runId: state.run.id, candidateId: task.candidate_id,
    previousState: "WAITING_LUNA_CONFIRMATION", nextState: input.available ? "CALCULATING_ECONOMICS" : "REJECTED",
    reasonCode: input.available ? "LUNA_CONFIRMED_AUTO_RESUME" : "LUNA_OUT_OF_STOCK", triggeredBy: "USER",
    checkpoint: { price: input.price, available: input.available, quantityKnown: input.quantity != null },
    nextAutomaticAction: input.available ? "Recalcular economía y ejecutar Product Facts automáticamente." : "Promover el siguiente candidato.",
    nextHumanAction: "Ninguna." })
  if (input.available) {
    await input.supabase.from("ebay_same_day_pilot_jobs").upsert({ run_id: state.run.id, candidate_id: task.candidate_id,
      job_type: "CALCULATE_ECONOMICS", idempotency_key: `${state.run.id}:${task.candidate_id}:CALCULATE_ECONOMICS`,
      checkpoint: { confirmedLunaPrice: input.price, quantityKnown: input.quantity != null } }, { onConflict: "idempotency_key", ignoreDuplicates: true })
  } else {
    const candidate = state.candidates.find((entry) => entry.id === task.candidate_id)
    if (candidate) await promoteNextCandidate(input.supabase, state.run.id, Number(candidate.ordinal))
  }
  return getSameDayPilot(input)
}

export async function resumeSameDayPilotAfterProductResearchCapture(input: { supabase: SupabaseClient; accountKey: string; searchQuery: string; batchId: string; exactLunaMatches?: number }) {
  const state = await getSameDayPilot(input)
  if (!state) return { resumed: 0 }
  const normalizedQuery = input.searchQuery.trim().toLowerCase()
  const candidates = state.candidates.filter((candidate) => candidate.machine_state === "WAITING_PRODUCT_RESEARCH_CAPTURE" &&
    text(record(candidate.product_research_query_plan).query).toLowerCase() === normalizedQuery)
  for (const candidate of candidates) {
    const task = state.tasks.find((entry) => entry.candidate_id === candidate.id && entry.gate_type === "PRODUCT_RESEARCH_CAPTURE_REQUIRED" && entry.status === "OPEN")
    if (task) await input.supabase.from("ebay_same_day_pilot_human_tasks").update({ status: "COMPLETED", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", task.id)
    await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
      previousState: "WAITING_PRODUCT_RESEARCH_CAPTURE", nextState: "IMPORTING_SOLD_EVIDENCE", reasonCode: "AUTHORIZED_CAPTURE_RECEIVED_AUTO_RESUME",
      triggeredBy: "SYSTEM", checkpoint: { captureBatchId: input.batchId }, nextAutomaticAction: "Reconciliar identidad, Luna y Loop 1.", nextHumanAction: "Ninguna." })
    await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
      previousState: "IMPORTING_SOLD_EVIDENCE", nextState: "RECONCILING_IDENTITY", reasonCode: "SOLD_EVIDENCE_IMPORTED",
      triggeredBy: "SYSTEM", checkpoint: { captureBatchId: input.batchId }, nextAutomaticAction: "Conciliar Luna.", nextHumanAction: "Ninguna." })
    await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
      previousState: "RECONCILING_IDENTITY", nextState: "MATCHING_LUNA", reasonCode: "IDENTITY_RECONCILIATION_COMPLETED",
      triggeredBy: "SYSTEM", checkpoint: { exactLunaMatches: input.exactLunaMatches ?? 0 }, nextAutomaticAction: "Ejecutar Loop 1 si existe match exacto.", nextHumanAction: "Ninguna." })
    if (Number(input.exactLunaMatches ?? 0) <= 0) {
      await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
        previousState: "MATCHING_LUNA", nextState: "REJECTED", reasonCode: "NO_EXACT_LUNA_MATCH_IN_AUTHORIZED_CAPTURE",
        triggeredBy: "SYSTEM", nextAutomaticAction: "Promover el siguiente candidato automáticamente.", nextHumanAction: "Ninguna." })
      await input.supabase.from("ebay_same_day_pilot_candidates").update({ state: "REJECTED_TODAY", blockers: ["NO_EXACT_LUNA_MATCH_IN_AUTHORIZED_CAPTURE"] }).eq("id", candidate.id)
      await promoteNextCandidate(input.supabase, state.run.id, Number(candidate.ordinal))
    } else {
      await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
        previousState: "MATCHING_LUNA", nextState: "RUNNING_LOOP_1", reasonCode: "EXACT_LUNA_MATCH_CONFIRMED",
        triggeredBy: "SYSTEM", nextAutomaticAction: "Calcular economía.", nextHumanAction: "Ninguna." })
      await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
        previousState: "RUNNING_LOOP_1", nextState: "CALCULATING_ECONOMICS", reasonCode: "LOOP_1_REANALYSIS_DISPATCHED",
        triggeredBy: "SYSTEM", nextAutomaticAction: "Solicitar confirmación Luna puntual.", nextHumanAction: "Ninguna." })
      await createLunaGate(input.supabase, state.run.id, candidate, "CALCULATING_ECONOMICS")
    }
  }
  return { resumed: candidates.length }
}

function retryable(code: string) {
  return /(?:429|NETWORK|TIMEOUT|HTTP_5\d\d|TEMPORARY|LEASE)/.test(code)
}

export async function processSameDayPilotJobs(input: { supabase: SupabaseClient; accountKey: string; workerId: string; now?: Date }) {
  const now = input.now ?? new Date()
  const state = await getSameDayPilot({ supabase: input.supabase, accountKey: input.accountKey, now })
  if (!state) return { processed: 0, status: "NO_ACTIVE_RUN" }
  const { data: job, error: readError } = await input.supabase.from("ebay_same_day_pilot_jobs").select("*")
    .eq("run_id", state.run.id).in("status", ["PENDING", "WAITING_RETRY"]).lte("available_at", now.toISOString())
    .order("created_at").limit(1).maybeSingle()
  if (readError) throw new Error("SAME_DAY_PILOT_JOB_READ_FAILED")
  if (!job) return { processed: 0, status: "IDLE" }
  const leaseUntil = new Date(now.getTime() + 2 * 60_000).toISOString()
  const { data: leased, error: leaseError } = await input.supabase.from("ebay_same_day_pilot_jobs").update({
    status: "LEASED", lease_owner: input.workerId, lease_expires_at: leaseUntil, last_heartbeat_at: now.toISOString(),
    attempt: Number(job.attempt) + 1, updated_at: now.toISOString(),
  }).eq("id", job.id).in("status", ["PENDING", "WAITING_RETRY"]).select("*").maybeSingle()
  if (leaseError) throw new Error("SAME_DAY_PILOT_JOB_LEASE_FAILED")
  if (!leased) return { processed: 0, status: "LEASE_LOST" }
  const candidate = state.candidates.find((entry) => entry.id === leased.candidate_id)
  if (!candidate) throw new Error("SAME_DAY_PILOT_JOB_CANDIDATE_MISSING")
  try {
    if (leased.job_type !== "CALCULATE_ECONOMICS") throw new Error("SAME_DAY_PILOT_JOB_TYPE_UNSUPPORTED")
    const { data: opportunity, error: opportunityError } = await input.supabase.from("ebay_luna_opportunity_queue").select("*").eq("id", candidate.opportunity_id).single()
    if (opportunityError) throw new Error("SAME_DAY_PILOT_OPPORTUNITY_READ_FAILED")
    const confirmation = record(candidate.economics_summary)
    const economics = calculateEbayUnitEconomics({ salePrice: opportunity.median_total_buyer_price, supplierCost: confirmation.confirmedLunaPrice }, ebayDraftOnlyEconomicsConfig())
    const economicsGate = evaluateReadyForContent({ exactOrStrongIdentity: true, exactMarketEvidence: Number(opportunity.active_comparables) > 0,
      productFactsCompatible: true, requiredAspectsResolved: true, regulatoryAcceptable: true, shippingEstimateAvailable: true,
      estimatedProfit: economics.estimatedNetProfit, roiPercent: economics.estimatedRoiPercent, netMarginPercent: economics.estimatedNetMarginPercent })
    await input.supabase.from("ebay_same_day_pilot_candidates").update({ economics_summary: economics, updated_at: new Date().toISOString() }).eq("id", candidate.id)
    if (!economics.ready || !economicsGate.ready) {
      await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id, previousState: "CALCULATING_ECONOMICS",
        nextState: "REJECTED", reasonCode: economicsGate.blockers[0] ?? "ECONOMICS_UNAVAILABLE", triggeredBy: "SYSTEM",
        checkpoint: { blockers: economicsGate.blockers }, nextAutomaticAction: "Promover el siguiente candidato.", nextHumanAction: "Ninguna." })
      await input.supabase.from("ebay_same_day_pilot_candidates").update({ state: "REJECTED_TODAY", blockers: economicsGate.blockers }).eq("id", candidate.id)
      await promoteNextCandidate(input.supabase, state.run.id, Number(candidate.ordinal))
    } else if (!candidate.queue_item_id) {
      await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id, previousState: "CALCULATING_ECONOMICS",
        nextState: "REJECTED", reasonCode: "EXACT_TOP20_QUEUE_IDENTITY_MISSING", triggeredBy: "SYSTEM",
        nextAutomaticAction: "Promover el siguiente candidato.", nextHumanAction: "Ninguna." })
      await input.supabase.from("ebay_same_day_pilot_candidates").update({ state: "REJECTED_TODAY", blockers: ["EXACT_TOP20_QUEUE_IDENTITY_MISSING"] }).eq("id", candidate.id)
      await promoteNextCandidate(input.supabase, state.run.id, Number(candidate.ordinal))
    } else {
      await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id, previousState: "CALCULATING_ECONOMICS",
        nextState: "ENRICHING_PRODUCT_FACTS", reasonCode: "ECONOMICS_GATES_PASSED", triggeredBy: "SYSTEM",
        checkpoint: { idealProfitReached: economicsGate.idealProfitReached }, nextAutomaticAction: "Resolver Taxonomy y regulación.", nextHumanAction: "Ninguna." })
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
      await input.supabase.from("ebay_same_day_pilot_candidates").update({ product_facts_summary: summary }).eq("id", candidate.id)
      if (!openAiReady) {
        await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id, previousState: "VALIDATING_REGULATION",
          nextState: "BLOCKED", reasonCode: "OPENAI_INPUT_NOT_READY", triggeredBy: "SYSTEM", checkpoint: { exception: summary.exception ?? null },
          nextAutomaticAction: "Excluir si hay múltiples gaps; conservar una excepción puntual si es resoluble.", nextHumanAction: "Revisar la única excepción mostrada." })
      } else {
        await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id, previousState: "VALIDATING_REGULATION",
          nextState: "BUILDING_OPENAI_INPUT", reasonCode: "OPENAI_INPUT_READY", triggeredBy: "SYSTEM",
          nextAutomaticAction: "Solicitar aprobación del producto.", nextHumanAction: "Aprobar o rechazar el producto." })
        await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id, previousState: "BUILDING_OPENAI_INPUT",
          nextState: "WAITING_PRODUCT_APPROVAL", reasonCode: "PRODUCT_APPROVAL_REQUIRED", triggeredBy: "SYSTEM",
          nextAutomaticAction: "Generar versión 1 al aprobar.", nextHumanAction: "Revisar y aprobar el producto." })
        await createHumanTask({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id, gateType: "PRODUCT_APPROVAL_REQUIRED",
          title: "Revisa el producto preparado", why: "La identidad, economía y ficha técnica pasaron; falta decisión humana antes de generar contenido.",
          seconds: 180, impact: "Seller OS generará y validará automáticamente una versión de contenido.", evidence: { economics, facts: summary },
          actionSchema: { type: "PRODUCT_APPROVAL", actions: ["APPROVE", "REQUEST_ONE_REVISION", "REJECT"] }, continuationJobType: "GENERATE_LISTING_CONTENT" })
      }
    }
    await input.supabase.from("ebay_same_day_pilot_jobs").update({ status: "COMPLETED", lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString() }).eq("id", leased.id)
    return { processed: 1, status: "COMPLETED", jobType: leased.job_type }
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message) ? error.message : "SAME_DAY_PILOT_JOB_FAILED"
    const canRetry = retryable(code) && Number(leased.attempt) < Number(leased.max_attempts)
    const delaySeconds = /429/.test(code) ? 3600 : Math.min(900, 30 * 2 ** Number(leased.attempt))
    await input.supabase.from("ebay_same_day_pilot_jobs").update({ status: canRetry ? "WAITING_RETRY" : "DEAD_LETTER",
      available_at: new Date(Date.now() + delaySeconds * 1000).toISOString(), lease_owner: null, lease_expires_at: null,
      last_error_code: code, updated_at: new Date().toISOString() }).eq("id", leased.id)
    return { processed: 1, status: canRetry ? "WAITING_RETRY" : "DEAD_LETTER", error: code }
  }
}
