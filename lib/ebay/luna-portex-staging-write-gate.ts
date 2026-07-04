export const LUNA_PORTEX_STAGING_WRITE_GATE_VERSION =
  "LUNA_PORTEX_STAGING_WRITE_GATE_V1"

const firstRealScanType =
  "FIRST_REAL_LUNA_PORTEX_SCAN"
const preBaselineDemoType =
  "PRE_BASELINE_DEMO"
const maxCandidatesPerWritePlan =
  20

const allowedTargetTables = [
  "ebay_product_candidates",
  "ebay_candidate_scores",
  "ebay_candidate_validations",
  "ebay_profit_scenarios",
] as const

const forbiddenTargetTableTokens = [
  "products",
  "subscribers",
  "notification_logs",
  "community",
  "production",
] as const

type CandidatePreview = {
  sourceId?: string | null
  title?: string | null
  category?: string | null
  scanType?: string | null
  estimatedMargin?: number | null
  stockReady?: boolean | null
  reviewRequired?: boolean | null
  warnings?: string[] | null
  estimatedCost?: number | null
  targetEnvironment?: string | null
  targetTables?: string[] | null
}

type DryRunResult = {
  candidatePreviews?: CandidatePreview[] | null
  normalizedItems?: Array<{
    sourceId?: string | null
    estimatedCost?: number | null
    scanType?: string | null
  }> | null
}

type WriteGateOptions = {
  maxCandidatesPerWritePlan?: number | null
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function normalizeTargetTables(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [...allowedTargetTables]
}

function hasForbiddenTargetTable(candidate: CandidatePreview = {}) {
  const targetTables =
    normalizeTargetTables(candidate.targetTables)

  return targetTables.some((table) =>
    forbiddenTargetTableTokens.some((token) => table.includes(token)),
  )
}

function findEstimatedCost(
  candidate: CandidatePreview,
  normalizedItems: DryRunResult["normalizedItems"] = [],
) {
  if (typeof candidate.estimatedCost === "number") {
    return candidate.estimatedCost
  }

  const match =
    Array.isArray(normalizedItems)
      ? normalizedItems.find((item) => item.sourceId === candidate.sourceId)
      : undefined

  return typeof match?.estimatedCost === "number"
    ? match.estimatedCost
    : null
}

export function validateCandidateForStagingWrite(
  candidate: CandidatePreview = {},
  normalizedItems: DryRunResult["normalizedItems"] = [],
) {
  const reasons = []
  const scanType =
    normalizeText(candidate.scanType)
  const title =
    normalizeText(candidate.title)
  const estimatedCost =
    findEstimatedCost(candidate, normalizedItems)
  const targetEnvironment =
    normalizeText(candidate.targetEnvironment) ?? "staging"

  if (scanType === preBaselineDemoType) {
    reasons.push("blocked pre-baseline demo")
  }

  if (scanType !== firstRealScanType) {
    reasons.push("missing first real scan type")
  }

  if (title === null) {
    reasons.push("missing title")
  }

  if (estimatedCost === null) {
    reasons.push("missing estimated cost")
  }

  if (targetEnvironment === "production") {
    reasons.push("production target blocked")
  }

  if (hasForbiddenTargetTable(candidate)) {
    reasons.push("forbidden target table")
  }

  return {
    sourceId:
      normalizeText(candidate.sourceId) ?? "unknown-source-id",
    valid:
      reasons.length === 0,
    reasons,
  }
}

export function shouldBlockStagingWrite(
  candidate: CandidatePreview = {},
  normalizedItems: DryRunResult["normalizedItems"] = [],
) {
  return validateCandidateForStagingWrite(candidate, normalizedItems).valid === false
}

export function buildLunaPortexStagingWritePlan(
  dryRunResult: DryRunResult = {},
  options: WriteGateOptions = {},
) {
  const limit =
    Math.min(
      Math.max(options.maxCandidatesPerWritePlan ?? maxCandidatesPerWritePlan, 0),
      maxCandidatesPerWritePlan,
    )
  const previews =
    Array.isArray(dryRunResult.candidatePreviews)
      ? dryRunResult.candidatePreviews.slice(0, limit)
      : []
  const plannedWrites = []
  const blockedCandidates = []

  for (const candidate of previews) {
    const validation =
      validateCandidateForStagingWrite(candidate, dryRunResult.normalizedItems)
    const stockReady =
      candidate.stockReady === true
    const planEntry = {
      sourceId:
        validation.sourceId,
      scanType:
        firstRealScanType,
      targetTables:
        [...allowedTargetTables],
      approvalRequired:
        true,
      writeExecuted:
        false,
      sellReady:
        validation.valid && stockReady,
      reviewRequired:
        validation.valid === false || stockReady === false || candidate.reviewRequired === true,
      warnings:
        Array.isArray(candidate.warnings) ? [...candidate.warnings] : [],
    }

    if (validation.valid) {
      plannedWrites.push(planEntry)
    } else {
      blockedCandidates.push({
        sourceId:
          validation.sourceId,
        reasons:
          validation.reasons,
      })
    }
  }

  return {
    gateVersion:
      LUNA_PORTEX_STAGING_WRITE_GATE_VERSION,
    status:
      "STAGING_WRITE_GATE_PLAN_READY_NOT_EXECUTED",
    mode:
      "LOCAL_DRY_RUN_WRITE_PLAN_ONLY",
    totalPreviews:
      previews.length,
    writeEligible:
      plannedWrites.length,
    blocked:
      blockedCandidates.length,
    plannedWrites,
    blockedCandidates,
    targetTablesPlanned:
      [...allowedTargetTables],
    approvalRequired:
      true,
    writeExecuted:
      false,
    warnings:
      [
        ...plannedWrites.flatMap((entry) =>
          entry.warnings.map((warning) => `${entry.sourceId}: ${warning}`),
        ),
        ...blockedCandidates.flatMap((entry) =>
          entry.reasons.map((reason) => `${entry.sourceId}: ${reason}`),
        ),
      ],
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

export function summarizeStagingWritePlan(
  plan: ReturnType<typeof buildLunaPortexStagingWritePlan>,
) {
  return {
    gateVersion:
      plan.gateVersion,
    totalPreviews:
      plan.totalPreviews,
    writeEligible:
      plan.writeEligible,
    blocked:
      plan.blocked,
    warnings:
      [...plan.warnings],
    targetTablesPlanned:
      [...plan.targetTablesPlanned],
    approvalRequired:
      plan.approvalRequired,
    writeExecuted:
      plan.writeExecuted,
    safetyFlags:
      { ...plan.safetyFlags },
  }
}

export function getStagingWriteApprovalChecklist() {
  return [
    "confirm Production remains off-limits",
    "confirm Staging write approval is explicit",
    "confirm candidate previews are FIRST_REAL_LUNA_PORTEX_SCAN",
    "confirm PRE_BASELINE_DEMO records are blocked",
    "confirm forbidden Core tables are not targeted",
    "confirm out-of-stock candidates require review",
    "confirm no persistence occurs in this loop",
  ]
}
