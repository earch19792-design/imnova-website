export const LUNA_PORTEX_STAGING_WRITE_EXECUTION_HARNESS_VERSION =
  "LUNA_PORTEX_STAGING_WRITE_EXECUTION_HARNESS_V1"

const maxExecutionCandidates =
  20

const allowedTables = [
  "ebay_product_candidates",
  "ebay_candidate_scores",
  "ebay_candidate_validations",
  "ebay_profit_scenarios",
] as const

const forbiddenTableTokens = [
  "subscribers",
  "notification_logs",
  "community",
  "production",
] as const

type StagingPayload = {
  tableName?: string | null
  sourceId?: string | null
  sourceScanType?: string | null
  dedupeKey?: string | null
  dryRun?: boolean | null
  stagingOnly?: boolean | null
  approvalRequired?: boolean | null
  writeExecuted?: boolean | null
}

type PayloadBundle = {
  eligibleCandidates?: number | null
  blockedCandidates?: number | null
  payloadsByTable?: Record<string, StagingPayload[] | null> | null
  payloadTables?: string[] | null
  dedupeKeys?: string[] | null
  approvalRequired?: boolean | null
  stagingWriteExecuted?: boolean | null
}

type ExecutionHarnessOptions = {
  maxExecutionCandidates?: number | null
  approvalGranted?: boolean | null
}

type ExecutionOperation = {
  operationId: string
  tableName: string
  sourceId: string
  dedupeKey: string
  dryRun: true
  stagingOnly: true
  approvalRequired: true
  writeExecuted: false
  simulated: true
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function normalizePayloadRows(payloadBundle: PayloadBundle = {}) {
  const payloadsByTable =
    payloadBundle.payloadsByTable ?? {}
  const rows: Array<StagingPayload & { plannedTableName: string }> = []

  for (const [tableName, tableRows] of Object.entries(payloadsByTable)) {
    if (!Array.isArray(tableRows)) {
      continue
    }

    for (const row of tableRows) {
      rows.push({
        ...row,
        plannedTableName:
          tableName,
      })
    }
  }

  return rows
}

function isAllowedTable(tableName: string | null) {
  return (
    tableName !== null &&
    (allowedTables as readonly string[]).includes(tableName)
  )
}

function hasForbiddenTableToken(tableName: string | null) {
  if (tableName === null) {
    return false
  }

  if (tableName === "products") {
    return true
  }

  return forbiddenTableTokens.some(
    token =>
      tableName.includes(token),
  )
}

function getCandidateCount(payloadBundle: PayloadBundle, rows: StagingPayload[]) {
  if (
    typeof payloadBundle.eligibleCandidates === "number" &&
    Number.isFinite(payloadBundle.eligibleCandidates)
  ) {
    return payloadBundle.eligibleCandidates
  }

  const dedupeKeys =
    rows
      .map(row => normalizeText(row.dedupeKey))
      .filter((dedupeKey): dedupeKey is string => dedupeKey !== null)

  return new Set(dedupeKeys).size
}

export function validateStagingExecutionPayloads(
  payloadBundle: PayloadBundle = {},
  options: ExecutionHarnessOptions = {},
) {
  const rows =
    normalizePayloadRows(payloadBundle)
  const limit =
    Math.min(
      Math.max(options.maxExecutionCandidates ?? maxExecutionCandidates, 0),
      maxExecutionCandidates,
    )
  const candidateCount =
    getCandidateCount(payloadBundle, rows)
  const errors: string[] = []
  const warnings: string[] = []
  const validatedPayloads: ExecutionOperation[] = []

  if (candidateCount > limit) {
    errors.push("too many execution candidates")
  }

  if (payloadBundle.stagingWriteExecuted === true) {
    errors.push("payload bundle already executed")
  }

  if (payloadBundle.approvalRequired !== true) {
    errors.push("payload bundle missing approval requirement")
  }

  rows.forEach((row, index) => {
    const tableName =
      normalizeText(row.tableName) ?? normalizeText(row.plannedTableName)
    const sourceId =
      normalizeText(row.sourceId)
    const dedupeKey =
      normalizeText(row.dedupeKey)

    if (!isAllowedTable(tableName)) {
      errors.push(`payload ${index + 1}: table not allowed`)
    }

    if (hasForbiddenTableToken(tableName)) {
      errors.push(`payload ${index + 1}: forbidden table target`)
    }

    if (row.dryRun !== true) {
      errors.push(`payload ${index + 1}: dryRun required`)
    }

    if (row.stagingOnly !== true) {
      errors.push(`payload ${index + 1}: stagingOnly required`)
    }

    if (row.approvalRequired !== true) {
      errors.push(`payload ${index + 1}: approvalRequired required`)
    }

    if (row.writeExecuted === true) {
      errors.push(`payload ${index + 1}: write already executed`)
    }

    if (dedupeKey === null) {
      errors.push(`payload ${index + 1}: dedupeKey required`)
    }

    if (sourceId === null) {
      warnings.push(`payload ${index + 1}: missing sourceId`)
    }

    if (
      tableName !== null &&
      sourceId !== null &&
      dedupeKey !== null &&
      row.dryRun === true &&
      row.stagingOnly === true &&
      row.approvalRequired === true &&
      row.writeExecuted !== true &&
      isAllowedTable(tableName) &&
      hasForbiddenTableToken(tableName) === false
    ) {
      validatedPayloads.push({
        operationId:
          `${tableName}:${dedupeKey}:${index + 1}`,
        tableName,
        sourceId,
        dedupeKey,
        dryRun:
          true,
        stagingOnly:
          true,
        approvalRequired:
          true,
        writeExecuted:
          false,
        simulated:
          true,
      })
    }
  })

  return {
    valid:
      errors.length === 0,
    payloadsValidated:
      validatedPayloads.length,
    candidateCount,
    blockedCandidates:
      payloadBundle.blockedCandidates ?? 0,
    allowedTables:
      [...allowedTables],
    tablesPlanned:
      [...new Set(validatedPayloads.map(payload => payload.tableName))],
    dedupeKeys:
      [...new Set(validatedPayloads.map(payload => payload.dedupeKey))],
    operations:
      validatedPayloads,
    errors,
    warnings,
  }
}

export function buildLunaPortexStagingExecutionPlan(
  payloadBundle: PayloadBundle = {},
  options: ExecutionHarnessOptions = {},
) {
  const validation =
    validateStagingExecutionPayloads(
      payloadBundle,
      options,
    )

  return {
    harnessVersion:
      LUNA_PORTEX_STAGING_WRITE_EXECUTION_HARNESS_VERSION,
    status:
      validation.valid
        ? "STAGING_WRITE_EXECUTION_PLAN_READY_FOR_FUTURE_APPROVAL"
        : "STAGING_WRITE_EXECUTION_PLAN_BLOCKED",
    mode:
      "LOCAL_DRY_RUN_EXECUTION_PLAN_ONLY",
    validation,
    eligibleCandidates:
      validation.candidateCount,
    blockedCandidates:
      validation.blockedCandidates,
    payloadsValidated:
      validation.payloadsValidated,
    executionOperationsPlanned:
      validation.operations.length,
    tablesPlanned:
      [...validation.tablesPlanned],
    dedupeKeys:
      [...validation.dedupeKeys],
    operations:
      [...validation.operations],
    approvalRequired:
      true,
    simulatedExecutionOnly:
      true,
    stagingWriteExecuted:
      false,
    executionReadyForFutureApproval:
      validation.valid,
    safetyFlags:
      {
        productionTouched:
          false,
        stagingDbWritten:
          false,
        realWriterConnected:
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

export function shouldBlockStagingExecution(
  executionPlan: ReturnType<typeof buildLunaPortexStagingExecutionPlan>,
  options: ExecutionHarnessOptions = {},
) {
  return (
    executionPlan.validation.valid === false ||
    options.approvalGranted !== true
  )
}

export function simulateStagingWriteExecution(
  executionPlan: ReturnType<typeof buildLunaPortexStagingExecutionPlan>,
  options: ExecutionHarnessOptions = {},
) {
  const blockedForRealExecution =
    shouldBlockStagingExecution(
      executionPlan,
      options,
    )

  return {
    harnessVersion:
      executionPlan.harnessVersion,
    status:
      executionPlan.validation.valid
        ? "STAGING_WRITE_EXECUTION_SIMULATED_NOT_EXECUTED"
        : "STAGING_WRITE_EXECUTION_SIMULATION_BLOCKED",
    mode:
      "LOCAL_DRY_RUN_EXECUTION_PLAN_ONLY",
    eligibleCandidates:
      executionPlan.eligibleCandidates,
    blockedCandidates:
      executionPlan.blockedCandidates,
    payloadsValidated:
      executionPlan.payloadsValidated,
    executionOperationsPlanned:
      executionPlan.executionOperationsPlanned,
    tablesPlanned:
      [...executionPlan.tablesPlanned],
    dedupeKeys:
      [...executionPlan.dedupeKeys],
    approvalRequired:
      true,
    approvalGranted:
      options.approvalGranted === true,
    blockedForRealExecution,
    simulatedExecutionOnly:
      true,
    stagingWriteExecuted:
      false,
    executionReadyForFutureApproval:
      executionPlan.executionReadyForFutureApproval,
    errors:
      [...executionPlan.validation.errors],
    warnings:
      [...executionPlan.validation.warnings],
    operations:
      executionPlan.operations.map(operation => ({
        ...operation,
        simulated:
          true,
        writeExecuted:
          false,
      })),
    safetyFlags:
      { ...executionPlan.safetyFlags },
  }
}

export function summarizeStagingExecutionSimulation(
  simulation: ReturnType<typeof simulateStagingWriteExecution>,
) {
  return {
    harnessVersion:
      simulation.harnessVersion,
    eligibleCandidates:
      simulation.eligibleCandidates,
    blockedCandidates:
      simulation.blockedCandidates,
    payloadsValidated:
      simulation.payloadsValidated,
    executionOperationsPlanned:
      simulation.executionOperationsPlanned,
    tablesPlanned:
      [...simulation.tablesPlanned],
    dedupeKeys:
      [...simulation.dedupeKeys],
    approvalRequired:
      simulation.approvalRequired,
    simulatedExecutionOnly:
      simulation.simulatedExecutionOnly,
    stagingWriteExecuted:
      simulation.stagingWriteExecuted,
    executionReadyForFutureApproval:
      simulation.executionReadyForFutureApproval,
    warnings:
      [...simulation.warnings],
    errors:
      [...simulation.errors],
  }
}

export function getStagingExecutionApprovalChecklist() {
  return [
    "confirm Production remains off-limits",
    "confirm payloads target only eBay Pro Staging tables",
    "confirm every payload is dry-run and staging-only",
    "confirm every payload has a dedupe key",
    "confirm Staging write approval is explicit",
    "confirm real writer remains disconnected in LOOP 139",
    "confirm simulated execution only",
    "confirm next loop is 140 — Staging schema compatibility",
  ]
}
