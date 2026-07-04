export const LUNA_PORTEX_STAGING_WRITE_ADAPTER_VERSION =
  "LUNA_PORTEX_STAGING_WRITE_ADAPTER_V1"

const firstRealScanType =
  "FIRST_REAL_LUNA_PORTEX_SCAN"
const preBaselineDemoType =
  "PRE_BASELINE_DEMO"
const maxPayloadCandidates =
  20

const payloadTables = [
  "ebay_product_candidates",
  "ebay_candidate_scores",
  "ebay_candidate_validations",
  "ebay_profit_scenarios",
] as const

const forbiddenTableTokens = [
  "products",
  "subscribers",
  "notification_logs",
  "community",
  "production",
] as const

type PlannedWriteCandidate = {
  sourceId?: string | null
  scanType?: string | null
  targetTables?: string[] | null
  approvalRequired?: boolean | null
  writeExecuted?: boolean | null
  sellReady?: boolean | null
  reviewRequired?: boolean | null
  warnings?: string[] | null
  title?: string | null
  estimatedCost?: number | null
}

type WritePlan = {
  plannedWrites?: PlannedWriteCandidate[] | null
  blockedCandidates?: Array<{
    sourceId?: string | null
    reasons?: string[] | null
  }> | null
}

type AdapterOptions = {
  maxPayloadCandidates?: number | null
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function normalizeTargetTables(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [...payloadTables]
}

function hasForbiddenTarget(candidate: PlannedWriteCandidate = {}) {
  return normalizeTargetTables(candidate.targetTables).some((table) =>
    forbiddenTableTokens.some((token) => table.includes(token)),
  )
}

function isEligiblePlannedWrite(candidate: PlannedWriteCandidate = {}) {
  const scanType =
    normalizeText(candidate.scanType)
  const sourceId =
    normalizeText(candidate.sourceId)
  const targetTables =
    normalizeTargetTables(candidate.targetTables)

  return (
    sourceId !== null &&
    scanType === firstRealScanType &&
    candidate.writeExecuted === false &&
    candidate.approvalRequired === true &&
    hasForbiddenTarget(candidate) === false &&
    payloadTables.every((table) => targetTables.includes(table))
  )
}

export function buildStagingDedupeKey(
  candidate: PlannedWriteCandidate = {},
) {
  const sourceId =
    normalizeText(candidate.sourceId) ?? "unknown-source-id"
  const scanType =
    normalizeText(candidate.scanType) ?? "unknown-scan-type"

  return `luna-portex:${scanType}:${sourceId}`.toLowerCase()
}

function basePayload(candidate: PlannedWriteCandidate, tableName: string) {
  return {
    tableName,
    sourceId:
      normalizeText(candidate.sourceId) ?? "unknown-source-id",
    sourceScanType:
      firstRealScanType,
    dedupeKey:
      buildStagingDedupeKey(candidate),
    stagingOnly:
      true,
    dryRun:
      true,
    approvalRequired:
      true,
    writeExecuted:
      false,
  }
}

export function buildCandidatePayload(candidate: PlannedWriteCandidate = {}) {
  return {
    ...basePayload(candidate, "ebay_product_candidates"),
    sellReady:
      candidate.sellReady === true,
    reviewRequired:
      candidate.reviewRequired === true,
    status:
      candidate.sellReady === true ? "candidate_ready" : "review_required",
  }
}

export function buildScorePayload(candidate: PlannedWriteCandidate = {}) {
  return {
    ...basePayload(candidate, "ebay_candidate_scores"),
    scoreType:
      "first_scan_readiness",
    score:
      candidate.sellReady === true ? 90 : 50,
    reviewRequired:
      candidate.reviewRequired === true,
  }
}

export function buildValidationPayload(candidate: PlannedWriteCandidate = {}) {
  return {
    ...basePayload(candidate, "ebay_candidate_validations"),
    validationStatus:
      candidate.reviewRequired === true ? "requires_review" : "passed",
    warnings:
      Array.isArray(candidate.warnings) ? [...candidate.warnings] : [],
  }
}

export function buildProfitScenarioPayload(candidate: PlannedWriteCandidate = {}) {
  return {
    ...basePayload(candidate, "ebay_profit_scenarios"),
    scenarioType:
      "dry_run_first_scan",
    profitScenarioReady:
      candidate.sellReady === true,
    requiresStockReview:
      candidate.sellReady !== true,
  }
}

export function buildLunaPortexStagingWritePayloads(
  writePlan: WritePlan = {},
  options: AdapterOptions = {},
) {
  const limit =
    Math.min(
      Math.max(options.maxPayloadCandidates ?? maxPayloadCandidates, 0),
      maxPayloadCandidates,
    )
  const plannedWrites =
    Array.isArray(writePlan.plannedWrites)
      ? writePlan.plannedWrites.slice(0, limit)
      : []
  const eligibleCandidates =
    plannedWrites.filter(isEligiblePlannedWrite)
  const blockedCandidateCount =
    Array.isArray(writePlan.blockedCandidates) ? writePlan.blockedCandidates.length : 0

  const payloadsByTable = {
    ebay_product_candidates:
      eligibleCandidates.map(buildCandidatePayload),
    ebay_candidate_scores:
      eligibleCandidates.map(buildScorePayload),
    ebay_candidate_validations:
      eligibleCandidates.map(buildValidationPayload),
    ebay_profit_scenarios:
      eligibleCandidates.map(buildProfitScenarioPayload),
  }
  const dedupeKeys =
    eligibleCandidates.map(buildStagingDedupeKey)

  return {
    adapterVersion:
      LUNA_PORTEX_STAGING_WRITE_ADAPTER_VERSION,
    status:
      "STAGING_WRITE_ADAPTER_PAYLOADS_READY_NOT_EXECUTED",
    mode:
      "LOCAL_DRY_RUN_PAYLOADS_ONLY",
    eligibleCandidates:
      eligibleCandidates.length,
    blockedCandidates:
      blockedCandidateCount,
    payloadsByTable,
    payloadTables:
      [...payloadTables],
    dedupeKeys,
    approvalRequired:
      true,
    stagingWriteExecuted:
      false,
    safetyFlags:
      {
        productionTouched:
          false,
        stagingDbWritten:
          false,
        vmConnected:
          false,
        externalCallsUsed:
          false,
        marketplaceApiUsed:
          false,
        messagingDeliveryUsed:
          false,
        openAiUsed:
          false,
      },
  }
}

export function summarizeStagingWritePayloads(
  payloads: ReturnType<typeof buildLunaPortexStagingWritePayloads>,
) {
  return {
    adapterVersion:
      payloads.adapterVersion,
    eligibleCandidates:
      payloads.eligibleCandidates,
    blockedCandidates:
      payloads.blockedCandidates,
    payloadsByTable:
      Object.fromEntries(
        Object.entries(payloads.payloadsByTable).map(([tableName, rows]) => [
          tableName,
          rows.length,
        ]),
      ),
    dedupeKeys:
      [...payloads.dedupeKeys],
    approvalRequired:
      payloads.approvalRequired,
    stagingWriteExecuted:
      payloads.stagingWriteExecuted,
    safetyFlags:
      { ...payloads.safetyFlags },
  }
}

export function getStagingWriteExecutionChecklist() {
  return [
    "confirm Production remains off-limits",
    "confirm Staging write execution is explicitly approved",
    "confirm payloads target only eBay Pro Staging tables",
    "confirm dedupe keys are stable",
    "confirm dry-run flag is removed only in the approved execution loop",
    "confirm no marketplace, messaging, AI, or VM side effects are enabled",
  ]
}
