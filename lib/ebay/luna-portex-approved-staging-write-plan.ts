export const LUNA_PORTEX_APPROVED_STAGING_WRITE_3_CANDIDATES_VERSION =
  "LUNA_PORTEX_APPROVED_STAGING_WRITE_3_CANDIDATES_V1"

export const LUNA_PORTEX_APPROVED_STAGING_WRITE_DEDUPE_KEYS = [
  "luna-portex:first_real_luna_portex_scan:lp-dry-001",
  "luna-portex:first_real_luna_portex_scan:lp-dry-002",
  "luna-portex:first_real_luna_portex_scan:lp-dry-004",
] as const

const executionRunId =
  "loop141-approved-staging-write-v1"
const sourceDataClass =
  "LOOP_141_CONTROLLED_STAGING_CANDIDATE_WRITE"
const maxCandidates =
  3
const maxOperations =
  12

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
  idempotencyKey?: string | null
  dryRun?: boolean | null
  stagingOnly?: boolean | null
  approvalRequired?: boolean | null
  writeExecuted?: boolean | null
  targetEnvironment?: string | null
  targetEnv?: string | null
  [key: string]: unknown
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

type SchemaCompatibilityReport = {
  compatible?: boolean | null
  stagingWriteExecuted?: boolean | null
  readOnlyInspectionRequiredBeforeRealWrite?: boolean | null
  approvalRequiredBeforeWrite?: boolean | null
  errors?: string[] | null
  missingRequiredColumns?: string[] | null
}

type ApprovedWriteOptions = {
  schemaCompatibilityReport?: SchemaCompatibilityReport | null
  schemaCompatible?: boolean | null
  maxCandidates?: number | null
  maxOperations?: number | null
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function normalizeRows(payloadBundle: PayloadBundle = {}) {
  const rows: Array<StagingPayload & { plannedTableName: string }> = []
  const payloadsByTable =
    payloadBundle.payloadsByTable ?? {}

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

  return forbiddenTableTokens.some(token => tableName.includes(token))
}

function isProductionTarget(payload: StagingPayload) {
  const target =
    [
      normalizeText(payload.targetEnvironment),
      normalizeText(payload.targetEnv),
      normalizeText(payload.environment),
    ]
      .filter((value): value is string => value !== null)
      .join(" ")
      .toLowerCase()

  return target.includes("production") || target === "prod"
}

function isSchemaCompatibilityConfirmed(options: ApprovedWriteOptions) {
  const report =
    options.schemaCompatibilityReport

  if (report) {
    return (
      report.compatible === true &&
      report.stagingWriteExecuted !== true &&
      report.approvalRequiredBeforeWrite === true &&
      Array.isArray(report.errors) &&
      report.errors.length === 0 &&
      Array.isArray(report.missingRequiredColumns) &&
      report.missingRequiredColumns.length === 0
    )
  }

  return options.schemaCompatible === true
}

function getDedupeKey(payload: StagingPayload) {
  return normalizeText(payload.dedupeKey) ?? normalizeText(payload.idempotencyKey)
}

export function buildApprovedStagingWritePlan(
  payloadBundle: PayloadBundle = {},
  options: ApprovedWriteOptions = {},
) {
  const rows =
    normalizeRows(payloadBundle)
  const operations =
    rows.map((payload, index) => {
      const tableName =
        normalizeText(payload.tableName) ?? normalizeText(payload.plannedTableName)
      const dedupeKey =
        getDedupeKey(payload)

      return {
        operationId:
          `${tableName ?? "unknown-table"}:${dedupeKey ?? "missing-dedupe"}:${index + 1}`,
        tableName,
        payload:
          {
            ...payload,
            tableName,
            dedupeKey,
            sourceDataClass,
            sourceRunId:
              executionRunId,
            executionRunId,
            listableInEbay:
              false,
            publishable:
              false,
          },
      }
    })
  const dedupeKeys =
    [
      ...new Set(
        operations
          .map(operation => normalizeText(operation.payload.dedupeKey))
          .filter((key): key is string => key !== null),
      ),
    ]
  const tablesPlanned =
    [
      ...new Set(
        operations
          .map(operation => operation.tableName)
          .filter((tableName): tableName is string => tableName !== null),
      ),
    ]
  const writePlan = {
    writeVersion:
      LUNA_PORTEX_APPROVED_STAGING_WRITE_3_CANDIDATES_VERSION,
    status:
      "APPROVED_STAGING_WRITE_PLAN_READY_FOR_GATED_EXECUTION",
    mode:
      "APPROVED_STAGING_WRITE_GATED_EXECUTION",
    executionRunId,
    sourceDataClass,
    sourceDataClassApplied:
      sourceDataClass,
    listableInEbay:
      false,
    publishable:
      false,
    eligibleCandidates:
      payloadBundle.eligibleCandidates ?? dedupeKeys.length,
    blockedCandidates:
      payloadBundle.blockedCandidates ?? 0,
    candidatesPlanned:
      dedupeKeys.length,
    operationsPlanned:
      operations.length,
    tablesPlanned,
    dedupeKeys,
    allowedTables:
      [...allowedTables],
    operations,
    schemaCompatibilityConfirmed:
      isSchemaCompatibilityConfirmed(options),
    approvalRequired:
      true,
    stagingOnly:
      true,
    writeExecuted:
      false,
    stagingWriteExecuted:
      false,
    maxCandidates:
      options.maxCandidates ?? maxCandidates,
    maxOperations:
      options.maxOperations ?? maxOperations,
  }

  return {
    ...writePlan,
    validation:
      validateApprovedStagingWritePlan(
        writePlan,
        options,
      ),
  }
}

export function validateApprovedStagingWritePlan(
  writePlan: {
    operations?: Array<{
      tableName?: string | null
      payload?: StagingPayload | null
    }> | null
    dedupeKeys?: string[] | null
    candidatesPlanned?: number | null
    operationsPlanned?: number | null
    schemaCompatibilityConfirmed?: boolean | null
    stagingOnly?: boolean | null
    approvalRequired?: boolean | null
    writeExecuted?: boolean | null
    stagingWriteExecuted?: boolean | null
    maxCandidates?: number | null
    maxOperations?: number | null
  } = {},
  options: ApprovedWriteOptions = {},
) {
  const errors: string[] = []
  const warnings: string[] = []
  const operations =
    Array.isArray(writePlan.operations) ? writePlan.operations : []
  const dedupeKeys =
    Array.isArray(writePlan.dedupeKeys) ? writePlan.dedupeKeys : []
  const candidateLimit =
    options.maxCandidates ?? writePlan.maxCandidates ?? maxCandidates
  const operationLimit =
    options.maxOperations ?? writePlan.maxOperations ?? maxOperations

  if (writePlan.schemaCompatibilityConfirmed !== true) {
    errors.push("schema compatibility confirmation required")
  }

  if (writePlan.stagingOnly !== true) {
    errors.push("write plan must be staging-only")
  }

  if (writePlan.approvalRequired !== true) {
    errors.push("write plan approvalRequired must be true")
  }

  if (writePlan.writeExecuted === true || writePlan.stagingWriteExecuted === true) {
    errors.push("write plan must not already be executed")
  }

  if (dedupeKeys.length > candidateLimit) {
    errors.push("too many candidate dedupe keys")
  }

  if ((writePlan.operationsPlanned ?? operations.length) > operationLimit) {
    errors.push("too many write operations")
  }

  operations.forEach((operation, index) => {
    const payload =
      operation.payload ?? {}
    const tableName =
      normalizeText(operation.tableName) ?? normalizeText(payload.tableName)
    const dedupeKey =
      getDedupeKey(payload)

    if (!isAllowedTable(tableName)) {
      errors.push(`operation ${index + 1}: table not allowed`)
    }

    if (hasForbiddenTableToken(tableName)) {
      errors.push(`operation ${index + 1}: forbidden table target`)
    }

    if (isProductionTarget(payload)) {
      errors.push(`operation ${index + 1}: Production target blocked`)
    }

    if (payload.dryRun !== true) {
      errors.push(`operation ${index + 1}: dryRun required`)
    }

    if (payload.stagingOnly !== true) {
      errors.push(`operation ${index + 1}: stagingOnly required`)
    }

    if (payload.approvalRequired !== true) {
      errors.push(`operation ${index + 1}: approvalRequired required`)
    }

    if (payload.writeExecuted === true) {
      errors.push(`operation ${index + 1}: payload already executed`)
    }

    if (dedupeKey === null) {
      errors.push(`operation ${index + 1}: dedupeKey required`)
    }

    if (normalizeText(payload.sourceId) === null) {
      warnings.push(`operation ${index + 1}: sourceId missing`)
    }
  })

  return {
    valid:
      errors.length === 0,
    errors,
    warnings,
    candidatesPlanned:
      dedupeKeys.length,
    operationsPlanned:
      operations.length,
    tablesPlanned:
      [...new Set(
        operations
          .map(operation => normalizeText(operation.tableName))
          .filter((tableName): tableName is string => tableName !== null),
      )],
    dedupeKeys:
      [...dedupeKeys],
    approvalRequired:
      true,
    stagingOnly:
      true,
  }
}

export function summarizeApprovedStagingWritePlan(
  writePlan: ReturnType<typeof buildApprovedStagingWritePlan>,
) {
  return {
    writeVersion:
      writePlan.writeVersion,
    status:
      writePlan.validation.valid
        ? writePlan.status
        : "APPROVED_STAGING_WRITE_PLAN_BLOCKED",
    executionRunId:
      writePlan.executionRunId,
    candidatesPlanned:
      writePlan.candidatesPlanned,
    operationsPlanned:
      writePlan.operationsPlanned,
    tablesPlanned:
      writePlan.tablesPlanned.length,
    tableNames:
      [...writePlan.tablesPlanned],
    dedupeKeys:
      [...writePlan.dedupeKeys],
    writeExecuted:
      false,
    stagingWriteExecuted:
      false,
    approvalRequired:
      true,
    stagingOnly:
      true,
    listableInEbay:
      false,
    publishable:
      false,
    valid:
      writePlan.validation.valid,
    errors:
      [...writePlan.validation.errors],
    warnings:
      [...writePlan.validation.warnings],
  }
}

export function getApprovedStagingWriteChecklist() {
  return [
    "confirm Production remains off-limits",
    "confirm EBAY_PRO_TARGET_ENV is staging for execute mode",
    "confirm LOOP 141 approval flag is exact for execute mode",
    "confirm schema compatibility passed before write",
    "confirm max three candidate dedupe keys",
    "confirm max twelve operations",
    "confirm only four eBay Pro Staging tables are targeted",
    "confirm idempotency pre-read finds no conflicts",
    "confirm post-write verification passes after any real Staging write",
    "confirm next loop is 142 — First Real Luna Portex Mini Scan",
  ]
}

export function buildPostWriteVerificationPlan(
  writePlan: ReturnType<typeof buildApprovedStagingWritePlan>,
) {
  const expectedRowsByTable =
    Object.fromEntries(
      writePlan.tablesPlanned.map(tableName => [
        tableName,
        writePlan.operations.filter(operation => operation.tableName === tableName).length,
      ]),
    )

  return {
    writeVersion:
      writePlan.writeVersion,
    executionRunId:
      writePlan.executionRunId,
    sourceRunId:
      writePlan.executionRunId,
    sourceDataClass:
      writePlan.sourceDataClass,
    dedupeKeys:
      [...writePlan.dedupeKeys],
    tablesToVerify:
      [...writePlan.tablesPlanned],
    expectedRowsByTable,
    expectedCandidates:
      writePlan.candidatesPlanned,
    expectedOperations:
      writePlan.operationsPlanned,
    requireNoDuplicates:
      true,
    requireNoConflicts:
      true,
    requireStagingOnly:
      true,
    requireProductionUntouched:
      true,
    postWriteVerificationRequired:
      true,
  }
}
