import type { SupabaseClient } from "@supabase/supabase-js"

import {
  EBAY_STRATEGIC_ADVISOR_CONTRACT_VERSION,
  EBAY_STRATEGIC_ADVISOR_FACT_KEYS,
  EBAY_STRATEGIC_ADVISOR_OUTPUT_SCHEMA_VERSION,
  EBAY_STRATEGIC_ADVISOR_PROMPT_VERSION,
  assertEbayStrategicAdvisorPreviewActivation,
  ebayStrategicAdvisorHash,
  prepareEbayStrategicAdvisorEvidence,
  strategicAdvisorEvidenceSchema,
  validateEbayStrategicAdvisorProposal,
} from "./ebay-strategic-advisor"

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function scalar(value: unknown): string | number | boolean | null {
  return typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ? value : null
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function sourceAuthority(sourceType: unknown) {
  const mapping: Record<string, string> = {
    LUNA_EXACT_VARIANT: "LUNA_EXACT_VARIANT",
    LUNA_FULFILLMENT: "FULFILLMENT_CONFIRMED",
    MANUFACTURER_OFFICIAL_PUBLIC: "MANUFACTURER_OFFICIAL",
    OFFICIAL_LABEL: "OFFICIAL_LABEL",
    EBAY_CATALOG_OFFICIAL_READONLY: "EBAY_CATALOG",
    EBAY_TAXONOMY_OFFICIAL_READONLY: "EBAY_TAXONOMY",
    PHYSICAL_MEASUREMENT_CONFIRMED: "PHYSICAL_MEASUREMENT",
    INTERNAL_DERIVATION: "INTERNAL_LEDGER_VERIFIED",
  }
  return typeof sourceType === "string" ? mapping[sourceType] ?? null : null
}

const authorityRank: Record<string, number> = {
  OFFICIAL_LABEL: 90,
  MANUFACTURER_OFFICIAL: 80,
  PHYSICAL_MEASUREMENT: 75,
  FULFILLMENT_CONFIRMED: 70,
  EBAY_CATALOG: 60,
  EBAY_TAXONOMY: 60,
  LUNA_EXACT_VARIANT: 50,
  INTERNAL_LEDGER_VERIFIED: 40,
}

function dateTime(value: unknown, fallback: string) {
  const raw = text(value)
  if (!raw) return fallback
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw
  const timestamp = Date.parse(normalized)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback
}

async function loadServerVerifiedEvidence(input: {
  supabase: SupabaseClient
  accountKey: string
  signalEventId: string
  performanceSnapshotId: string
  queueItemId: string
}) {
  const [eventResult, snapshotResult, queueItemResult, readinessResult] = await Promise.all([
    input.supabase.from("commercial_alert_events")
      .select("id,event_type,evidence,threshold_config_version,detected_at,listing_id,sku,deduplication_key")
      .eq("id", input.signalEventId)
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", "EBAY_US")
      .maybeSingle(),
    input.supabase.from("listing_commercial_snapshots")
      .select("id,listing_id,sku,listing_status,impressions,views,ctr,transactions,sales_conversion_rate,current_watchers,observed_at,window_start,window_end,completeness_status")
      .eq("id", input.performanceSnapshotId)
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", "EBAY_US")
      .maybeSingle(),
    input.supabase.from("marketplace_listing_approval_queue_items")
      .select("id,supplier_sku,marketplace_account_key,marketplace")
      .eq("id", input.queueItemId)
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", "EBAY_US")
      .maybeSingle(),
    input.supabase.from("marketplace_product_fact_readiness_events")
      .select("id,ready,blocking_reason_codes,observed_at,event_hash")
      .eq("queue_item_id", input.queueItemId)
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", "EBAY_US")
      .eq("gate_name", "OPENAI_INPUT_READY")
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (eventResult.error || snapshotResult.error || queueItemResult.error || readinessResult.error) {
    throw new Error("STRATEGIC_ADVISOR_SOURCE_READ_FAILED")
  }
  const event = eventResult.data
  const snapshot = snapshotResult.data
  const queueItem = queueItemResult.data
  const readiness = readinessResult.data
  if (!event || !snapshot || !queueItem) throw new Error("STRATEGIC_ADVISOR_SOURCE_NOT_FOUND")
  if (!readiness?.ready) throw new Error("STRATEGIC_ADVISOR_OPENAI_INPUT_NOT_READY")
  if (event.listing_id !== snapshot.listing_id || (event.sku ?? null) !== (snapshot.sku ?? null)) {
    throw new Error("STRATEGIC_ADVISOR_EVENT_SNAPSHOT_IDENTITY_MISMATCH")
  }
  if (Date.parse(event.detected_at) !== Date.parse(snapshot.observed_at)) {
    throw new Error("STRATEGIC_ADVISOR_EVENT_SNAPSHOT_TIME_MISMATCH")
  }
  if (!event.sku || event.sku !== queueItem.supplier_sku) {
    throw new Error("STRATEGIC_ADVISOR_QUEUE_ITEM_IDENTITY_MISMATCH")
  }
  const { data: ownListingLink, error: ownListingLinkError } = await input.supabase
    .from("ebay_manual_listing_links")
    .select("id,ebay_item_id,supplier_sku,verification_status,verification_method,connector_listing_status")
    .eq("account_key", input.accountKey)
    .eq("marketplace_id", "EBAY_US")
    .eq("ebay_item_id", snapshot.listing_id)
    .eq("verification_status", "verified")
    .maybeSingle()
  if (ownListingLinkError) {
    throw new Error("STRATEGIC_ADVISOR_OWN_LISTING_VERIFICATION_READ_FAILED")
  }
  if (
    !ownListingLink ||
    ownListingLink.supplier_sku !== queueItem.supplier_sku ||
    !["EBAY_TRADING_GET_ITEM_READONLY", "EBAY_SELL_INVENTORY_READONLY"]
      .includes(String(ownListingLink.verification_method)) ||
    !["active", "paused"].includes(String(ownListingLink.connector_listing_status))
  ) {
    throw new Error("STRATEGIC_ADVISOR_VERIFIED_OWN_LISTING_REQUIRED")
  }
  const eventEvidence = record(event.evidence)
  const experiment = record(eventEvidence.experiment)
  const eventSafety = record(eventEvidence.safety)
  if (
    eventSafety.ownListingEvidenceOnly !== true ||
    eventSafety.competitorRepricingUsed !== false ||
    eventSafety.openAiUsed !== false ||
    eventSafety.ebayWriteUsed !== false ||
    experiment.changeCount !== 1 || experiment.ebayWriteAllowed !== false ||
    experiment.automaticChangeAllowed !== false
  ) {
    throw new Error("STRATEGIC_ADVISOR_DETERMINISTIC_SIGNAL_UNSAFE")
  }

  const { data: resolutionRows, error: resolutionError } = await input.supabase
    .from("marketplace_product_fact_resolutions")
    .select("id,fact_key,selected_value,selected_unit,supporting_observation_ids,verification_status,resolved_at,resolution_hash")
    .eq("queue_item_id", input.queueItemId)
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US")
    .order("resolved_at", { ascending: false })
    .limit(500)
  if (resolutionError) throw new Error("STRATEGIC_ADVISOR_FACT_RESOLUTION_READ_FAILED")
  const latestByKey = new Map<string, JsonRecord>()
  for (const row of resolutionRows ?? []) {
    if (!latestByKey.has(row.fact_key)) latestByKey.set(row.fact_key, row as JsonRecord)
  }
  const allowedKeys = new Set(EBAY_STRATEGIC_ADVISOR_FACT_KEYS)
  const allowedStatuses = new Set(["VERIFIED", "CORROBORATED", "DERIVED_VERIFIED"])
  const selectedRows = [...latestByKey.values()].filter((row) =>
    allowedKeys.has(row.fact_key as typeof EBAY_STRATEGIC_ADVISOR_FACT_KEYS[number]) &&
    allowedStatuses.has(String(row.verification_status)) && scalar(row.selected_value) !== null
  )
  const supportingIds = [...new Set(selectedRows.flatMap((row) =>
    Array.isArray(row.supporting_observation_ids)
      ? row.supporting_observation_ids.filter((value): value is string => typeof value === "string")
      : []
  ))].slice(0, 500)
  const observationResult = supportingIds.length
    ? await input.supabase.from("marketplace_product_fact_observations")
        .select("id,source_type,verification_status")
        .eq("queue_item_id", input.queueItemId)
        .eq("marketplace_account_key", input.accountKey)
        .eq("marketplace", "EBAY_US")
        .in("id", supportingIds)
    : { data: [], error: null }
  if (observationResult.error) throw new Error("STRATEGIC_ADVISOR_FACT_OBSERVATION_READ_FAILED")
  const observationById = new Map((observationResult.data ?? []).map((row) => [row.id, row]))
  const verifiedFacts = selectedRows.flatMap((row) => {
    const authorities = (Array.isArray(row.supporting_observation_ids)
      ? row.supporting_observation_ids : [])
      .map((id) => observationById.get(String(id)))
      .filter((observation) => observation && allowedStatuses.has(observation.verification_status))
      .map((observation) => sourceAuthority(observation?.source_type))
      .filter((authority): authority is string => Boolean(authority))
      .sort((left, right) => (authorityRank[right] ?? 0) - (authorityRank[left] ?? 0))
    const authority = authorities[0]
    const value = scalar(row.selected_value)
    if (!authority || value === null) return []
    return [{
      factKey: row.fact_key,
      value,
      unit: text(row.selected_unit),
      verificationStatus: row.verification_status,
      sourceAuthority: authority,
      evidenceHash: row.resolution_hash,
    }]
  })
  if (!verifiedFacts.length) throw new Error("STRATEGIC_ADVISOR_VERIFIED_FACTS_REQUIRED")

  const observedAt = dateTime(snapshot.observed_at, new Date().toISOString())
  const windowStart = dateTime(snapshot.window_start, observedAt)
  const windowEnd = dateTime(snapshot.window_end, observedAt)
  const evidence = {
    contractVersion: EBAY_STRATEGIC_ADVISOR_CONTRACT_VERSION,
    listingFingerprint: ebayStrategicAdvisorHash({
      accountKey: input.accountKey,
      listingId: snapshot.listing_id,
      scope: "OWN_EBAY_LISTING_V1",
    }),
    signal: {
      eventType: event.event_type,
      classification: eventEvidence.classification,
      authorizedVariable: experiment.variable,
      detectedAt: dateTime(event.detected_at, observedAt),
      deterministicRulesetVersion:
        text(eventEvidence.rulesetVersion) ?? text(event.threshold_config_version) ?? "UNKNOWN",
    },
    verifiedFacts,
    ownListingPerformance: {
      source: snapshot.completeness_status === "complete"
        ? "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT" : "SELLER_OS_INTERNAL_LEDGER",
      completeness: snapshot.completeness_status === "complete" ? "COMPLETE"
        : snapshot.completeness_status === "incomplete" ? "PARTIAL" : "UNAVAILABLE",
      windowStart,
      windowEnd,
      observedAt,
      impressions: numberOrNull(snapshot.impressions),
      views: numberOrNull(snapshot.views),
      clickThroughRate: numberOrNull(snapshot.ctr),
      transactions: numberOrNull(snapshot.transactions),
      conversionRate: numberOrNull(snapshot.sales_conversion_rate),
      watchers: numberOrNull(snapshot.current_watchers),
      confirmedUnitsSold: null,
      netMarginPercent: null,
      stockAvailable: null,
    },
  }
  return {
    evidence: strategicAdvisorEvidenceSchema.parse(evidence),
    sourceIds: {
      signalEventId: event.id,
      performanceSnapshotId: snapshot.id,
      queueItemId: queueItem.id,
      readinessEventId: readiness.id,
      ownListingLinkId: ownListingLink.id,
    },
  }
}

function actorHash(actorId: string) {
  return ebayStrategicAdvisorHash({ actorId, scope: "STRATEGIC_ADVISOR_OPERATOR_V1" })
}

function idempotencyHash(value: string, action: string) {
  return ebayStrategicAdvisorHash({ value, action })
}

function estimateInputTokens(value: unknown) {
  return Math.ceil(JSON.stringify(value).length / 4) + 500
}

function rpcError(error: { message?: string; code?: string } | null, fallback: string) {
  if (!error) return
  const message = error.message?.match(/STRATEGIC_ADVISOR_[A-Z0-9_]+/)?.[0]
  throw new Error(message ?? fallback)
}

function publicRunSummary(value: unknown) {
  const row = record(Array.isArray(value) ? value[0] : value)
  return {
    id: row.id ?? null,
    state: row.state ?? null,
    signalType: row.signal_type ?? null,
    classification: row.classification ?? null,
    authorizedVariable: row.authorized_variable ?? null,
    evidenceHash: row.evidence_hash ?? null,
    inputHash: row.input_hash ?? null,
    openAiCallCount: row.openai_call_count ?? 0,
    ebayWriteCount: row.ebay_write_count ?? 0,
    productionChanged: row.production_changed ?? false,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  }
}

export async function createEbayStrategicAdvisorRun(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  idempotencyKey: string
  signalEventId: string
  performanceSnapshotId: string
  queueItemId: string
  environment?: NodeJS.ProcessEnv
  now?: Date
}) {
  const configuration = assertEbayStrategicAdvisorPreviewActivation(
    input.environment ?? process.env,
  )
  const verified = await loadServerVerifiedEvidence(input)
  const prepared = prepareEbayStrategicAdvisorEvidence(verified.evidence)
  const now = input.now ?? new Date()
  const { data, error } = await input.supabase.rpc("create_ebay_strategic_advisor_run", {
    p_marketplace_account_key: input.accountKey,
    p_signal_event_id: verified.sourceIds.signalEventId,
    p_performance_snapshot_id: verified.sourceIds.performanceSnapshotId,
    p_queue_item_id: verified.sourceIds.queueItemId,
    p_readiness_event_id: verified.sourceIds.readinessEventId,
    p_listing_fingerprint: prepared.evidence.listingFingerprint,
    p_signal_type: prepared.evidence.signal.eventType,
    p_classification: prepared.evidence.signal.classification,
    p_authorized_variable: prepared.evidence.signal.authorizedVariable,
    p_contract_version: EBAY_STRATEGIC_ADVISOR_CONTRACT_VERSION,
    p_prompt_version: EBAY_STRATEGIC_ADVISOR_PROMPT_VERSION,
    p_output_schema_version: EBAY_STRATEGIC_ADVISOR_OUTPUT_SCHEMA_VERSION,
    p_evidence_hash: prepared.evidenceHash,
    p_input_hash: prepared.inputHash,
    p_deduplication_key: prepared.deduplicationKey,
    p_sanitized_evidence: prepared.evidence,
    p_estimated_input_tokens: estimateInputTokens(prepared.evidence),
    p_max_input_tokens: configuration.maxInputTokens,
    p_max_output_tokens: configuration.maxOutputTokens,
    p_estimated_call_cost_micros: configuration.estimatedCallCostMicros,
    p_max_call_cost_micros: configuration.maxCallCostMicros,
    p_daily_budget_micros: configuration.dailyBudgetMicros,
    p_actor_hash: actorHash(input.actorId),
    p_idempotency_key_hash: idempotencyHash(input.idempotencyKey, "CREATE"),
    p_now: now.toISOString(),
  })
  rpcError(error, "STRATEGIC_ADVISOR_RUN_CREATE_FAILED")
  return {
    run: publicRunSummary(data),
    configuration,
    nextHumanAction: "APPROVE_OPENAI_API_SPEND",
    openAiCalls: 0,
    ebayWrites: 0,
  }
}

export async function decideEbayStrategicAdvisorOpenAiSpend(input: {
  supabase: SupabaseClient
  accountKey: string
  runId: string
  actorId: string
  evidenceHash: string
  idempotencyKey: string
  approved: boolean
  confirmed: boolean
  environment?: NodeJS.ProcessEnv
  now?: Date
}) {
  assertEbayStrategicAdvisorPreviewActivation(input.environment ?? process.env)
  if (!input.confirmed) throw new Error("STRATEGIC_ADVISOR_OPENAI_SPEND_CONFIRMATION_REQUIRED")
  const { data, error } = await input.supabase.rpc(
    "decide_ebay_strategic_advisor_openai_spend",
    {
      p_run_id: input.runId,
      p_marketplace_account_key: input.accountKey,
      p_actor_hash: actorHash(input.actorId),
      p_evidence_hash: input.evidenceHash,
      p_idempotency_key_hash: idempotencyHash(input.idempotencyKey, "OPENAI_SPEND"),
      p_approved: input.approved,
      p_now: (input.now ?? new Date()).toISOString(),
    },
  )
  rpcError(error, "STRATEGIC_ADVISOR_OPENAI_SPEND_DECISION_FAILED")
  return {
    run: publicRunSummary(data),
    openAiCallQueued: input.approved,
    openAiCallExecuted: false,
    nextAutomaticAction: input.approved
      ? "WAIT_FOR_DISABLED_BY_DEFAULT_WORKER_ACTIVATION"
      : null,
    ebayWrites: 0,
  }
}

export async function recordEbayStrategicAdvisorProposal(input: {
  supabase: SupabaseClient
  accountKey: string
  runId: string
  jobId: string
  workerHash: string
  rawProposal: unknown
  responseIdHash: string | null
  usageSummary: { inputTokens: number | null; outputTokens: number | null }
  estimatedCostMicros: number
  idempotencyKey: string
  environment?: NodeJS.ProcessEnv
  now?: Date
}) {
  assertEbayStrategicAdvisorPreviewActivation(input.environment ?? process.env)
  const { data: run, error: runError } = await input.supabase
    .from("ebay_strategic_advisor_runs")
    .select("id,state,evidence_hash,sanitized_evidence,output_schema_version")
    .eq("id", input.runId)
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace_id", "EBAY_US")
    .maybeSingle()
  if (runError) throw new Error("STRATEGIC_ADVISOR_RUN_READ_FAILED")
  if (!run) throw new Error("STRATEGIC_ADVISOR_RUN_NOT_FOUND")
  if (run.state !== "OPENAI_CALL_QUEUED") {
    throw new Error("STRATEGIC_ADVISOR_PROPOSAL_STATE_INVALID")
  }
  const evidence = strategicAdvisorEvidenceSchema.parse(run.sanitized_evidence)
  const proposal = validateEbayStrategicAdvisorProposal(input.rawProposal, evidence)
  const outputHash = ebayStrategicAdvisorHash(proposal)
  const { data, error } = await input.supabase.rpc(
    "record_ebay_strategic_advisor_proposal",
    {
      p_run_id: input.runId,
      p_marketplace_account_key: input.accountKey,
      p_job_id: input.jobId,
      p_worker_hash: input.workerHash,
      p_output_schema_version: EBAY_STRATEGIC_ADVISOR_OUTPUT_SCHEMA_VERSION,
      p_output_hash: outputHash,
      p_proposal: proposal,
      p_response_id_hash: input.responseIdHash,
      p_usage_summary: input.usageSummary,
      p_estimated_cost_micros: input.estimatedCostMicros,
      p_idempotency_key_hash: idempotencyHash(input.idempotencyKey, "PROPOSAL"),
      p_now: (input.now ?? new Date()).toISOString(),
    },
  )
  rpcError(error, "STRATEGIC_ADVISOR_PROPOSAL_PERSIST_FAILED")
  return {
    proposal: data,
    outputHash,
    nextHumanAction: "APPROVE_ONE_VARIABLE_MANUAL_EXPERIMENT",
    automaticChangeAllowed: false,
    ebayWrites: 0,
  }
}

export async function decideEbayStrategicAdvisorManualExperiment(input: {
  supabase: SupabaseClient
  accountKey: string
  runId: string
  actorId: string
  evidenceHash: string
  proposalHash: string
  idempotencyKey: string
  approved: boolean
  confirmed: boolean
  environment?: NodeJS.ProcessEnv
  now?: Date
}) {
  assertEbayStrategicAdvisorPreviewActivation(input.environment ?? process.env)
  if (!input.confirmed) throw new Error("STRATEGIC_ADVISOR_EXPERIMENT_CONFIRMATION_REQUIRED")
  const { data, error } = await input.supabase.rpc(
    "decide_ebay_strategic_advisor_manual_experiment",
    {
      p_run_id: input.runId,
      p_marketplace_account_key: input.accountKey,
      p_actor_hash: actorHash(input.actorId),
      p_evidence_hash: input.evidenceHash,
      p_proposal_hash: input.proposalHash,
      p_idempotency_key_hash: idempotencyHash(input.idempotencyKey, "MANUAL_EXPERIMENT"),
      p_approved: input.approved,
      p_now: (input.now ?? new Date()).toISOString(),
    },
  )
  rpcError(error, "STRATEGIC_ADVISOR_EXPERIMENT_DECISION_FAILED")
  return {
    run: publicRunSummary(data),
    approvedForManualExperiment: input.approved,
    automaticChangeExecuted: false,
    ebayWrites: 0,
  }
}

export async function getEbayStrategicAdvisorRun(input: {
  supabase: SupabaseClient
  accountKey: string
  runId: string
}) {
  const { data: run, error: runError } = await input.supabase
    .from("ebay_strategic_advisor_runs")
    .select("id,listing_fingerprint,signal_type,classification,authorized_variable,state,contract_version,prompt_version,output_schema_version,evidence_hash,input_hash,estimated_input_tokens,max_input_tokens,max_output_tokens,estimated_call_cost_micros,max_call_cost_micros,daily_budget_micros,openai_call_count,ebay_write_count,production_changed,last_error_code,created_at,updated_at,completed_at")
    .eq("id", input.runId)
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace_id", "EBAY_US")
    .maybeSingle()
  if (runError) throw new Error("STRATEGIC_ADVISOR_RUN_READ_FAILED")
  if (!run) throw new Error("STRATEGIC_ADVISOR_RUN_NOT_FOUND")
  const [events, approvals, jobs, proposals] = await Promise.all([
    input.supabase.from("ebay_strategic_advisor_events")
      .select("id,previous_state,next_state,reason_code,triggered_by,evidence_hash,created_at")
      .eq("run_id", input.runId).order("created_at", { ascending: true }),
    input.supabase.from("ebay_strategic_advisor_approvals")
      .select("id,gate,decision,bound_evidence_hash,bound_proposal_hash,approved_budget,created_at")
      .eq("run_id", input.runId).order("created_at", { ascending: true }),
    input.supabase.from("ebay_strategic_advisor_jobs")
      .select("id,job_type,status,attempt_count,max_attempts,available_at,lease_expires_at,last_error_code,created_at,updated_at,completed_at")
      .eq("run_id", input.runId).order("created_at", { ascending: true }),
    input.supabase.from("ebay_strategic_advisor_proposals")
      .select("id,output_schema_version,output_hash,proposal,usage_summary,estimated_cost_micros,created_at")
      .eq("run_id", input.runId).order("created_at", { ascending: true }),
  ])
  if (events.error || approvals.error || jobs.error || proposals.error) {
    throw new Error("STRATEGIC_ADVISOR_RUN_DETAILS_READ_FAILED")
  }
  return {
    run,
    events: events.data ?? [],
    approvals: approvals.data ?? [],
    jobs: jobs.data ?? [],
    proposals: proposals.data ?? [],
    safety: {
      openAiEnabledByDefault: false,
      competitorDataStored: false,
      piiStored: false,
      rawDataStored: false,
      automaticChangeAllowed: false,
      ebayWrites: 0,
    },
  }
}
