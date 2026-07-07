export const LUNA_PORTEX_STAGING_SCHEMA_COMPATIBILITY_VERSION =
  "LUNA_PORTEX_STAGING_SCHEMA_COMPATIBILITY_V1"

export const LUNA_PORTEX_STAGING_ALLOWED_WRITE_TABLES = [
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

const commonRequiredColumns = [
  "tableName",
  "sourceId",
  "sourceScanType",
  "dedupeKey",
  "stagingOnly",
  "dryRun",
  "approvalRequired",
  "writeExecuted",
] as const

const tableSpecificRequiredColumns = {
  ebay_product_candidates:
    [
      "sellReady",
      "reviewRequired",
      "status",
    ],
  ebay_candidate_scores:
    [
      "scoreType",
      "score",
      "reviewRequired",
    ],
  ebay_candidate_validations:
    [
      "validationStatus",
      "warnings",
    ],
  ebay_profit_scenarios:
    [
      "scenarioType",
      "profitScenarioReady",
      "requiresStockReview",
    ],
} as const

type StagingPayload = {
  tableName?: string | null
  dedupeKey?: string | null
  idempotencyKey?: string | null
  dryRun?: boolean | null
  stagingOnly?: boolean | null
  approvalRequired?: boolean | null
  writeExecuted?: boolean | null
  [key: string]: unknown
}

type PayloadBundle = {
  eligibleCandidates?: number | null
  blockedCandidates?: number | null
  payloadsByTable?: Record<string, StagingPayload[] | null> | null
  stagingWriteExecuted?: boolean | null
}

type SchemaColumn = {
  columnName?: string | null
  column_name?: string | null
  dataType?: string | null
  data_type?: string | null
  isNullable?: boolean | string | null
  is_nullable?: boolean | string | null
}

type SchemaTable = {
  tableName?: string | null
  table_name?: string | null
  columns?: SchemaColumn[] | null
}

type SchemaSnapshot = {
  tables?: SchemaTable[] | null
  realSchemaInspectionExecutedInThisLoop?: boolean | null
}

type CompatibilityOptions = {
  readOnlySqlPrepared?: boolean | null
}

type NormalizedSchemaTable = {
  tableName: string
  columns: Array<{
    columnName: string
    dataType: string
    isNullable: boolean | null
  }>
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function isAllowedTable(tableName: string | null) {
  return (
    tableName !== null &&
    (LUNA_PORTEX_STAGING_ALLOWED_WRITE_TABLES as readonly string[]).includes(tableName)
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

function getExpectedColumnsForTable(tableName: string) {
  const specificColumns =
    tableSpecificRequiredColumns[
      tableName as keyof typeof tableSpecificRequiredColumns
    ] ?? []

  return [
    ...commonRequiredColumns,
    ...specificColumns,
  ]
}

function normalizePayloadRows(payloadBundle: PayloadBundle = {}) {
  const rows: Array<StagingPayload & { plannedTableName: string }> = []
  const payloadsByTable =
    payloadBundle.payloadsByTable ?? {}

  for (const [tableName, payloads] of Object.entries(payloadsByTable)) {
    if (!Array.isArray(payloads)) {
      continue
    }

    for (const payload of payloads) {
      rows.push({
        ...payload,
        plannedTableName:
          tableName,
      })
    }
  }

  return rows
}

function normalizeNullable(value: SchemaColumn["isNullable"]) {
  if (typeof value === "boolean") {
    return value
  }

  if (typeof value === "string") {
    const normalized =
      value.trim().toUpperCase()

    if (normalized === "YES") {
      return true
    }

    if (normalized === "NO") {
      return false
    }
  }

  return null
}

function isVerifiableType(dataType: string) {
  return [
    "text",
    "boolean",
    "numeric",
    "integer",
    "jsonb",
    "timestamp",
    "timestamp with time zone",
    "timestamp without time zone",
  ].includes(dataType)
}

export function buildExpectedStagingSchemaContract(
  payloadBundle: PayloadBundle = {},
  options: CompatibilityOptions = {},
) {
  const payloadRows =
    normalizePayloadRows(payloadBundle)
  const payloadTables =
    [
      ...new Set(
        payloadRows
          .map(row => normalizeText(row.tableName) ?? normalizeText(row.plannedTableName))
          .filter((tableName): tableName is string => tableName !== null),
      ),
    ]
  const tables =
    LUNA_PORTEX_STAGING_ALLOWED_WRITE_TABLES.map(tableName => ({
      tableName,
      requiredColumns:
        getExpectedColumnsForTable(tableName),
    }))

  return {
    schemaCompatibilityVersion:
      LUNA_PORTEX_STAGING_SCHEMA_COMPATIBILITY_VERSION,
    payloadTables,
    tables,
    readOnlySqlPrepared:
      options.readOnlySqlPrepared !== false,
    stagingWriteExecuted:
      false,
    readOnlyInspectionRequiredBeforeRealWrite:
      true,
    approvalRequiredBeforeWrite:
      true,
  }
}

export function normalizeStagingSchemaSnapshot(
  schemaSnapshot: SchemaSnapshot = {},
) {
  const tables =
    Array.isArray(schemaSnapshot.tables)
      ? schemaSnapshot.tables
      : []
  const normalizedTables =
    tables
      .map((table): NormalizedSchemaTable | null => {
        const tableName =
          normalizeText(table.tableName) ?? normalizeText(table.table_name)

        if (tableName === null) {
          return null
        }

        return {
          tableName,
          columns:
            Array.isArray(table.columns)
              ? table.columns
                .map(column => {
                  const columnName =
                    normalizeText(column.columnName) ?? normalizeText(column.column_name)
                  const dataType =
                    normalizeText(column.dataType) ?? normalizeText(column.data_type) ?? "unknown"

                  return columnName === null
                    ? null
                    : {
                      columnName,
                      dataType,
                      isNullable:
                        normalizeNullable(column.isNullable ?? column.is_nullable),
                    }
                })
                .filter((column): column is NormalizedSchemaTable["columns"][number] => column !== null)
              : [],
        }
      })
      .filter((table): table is NormalizedSchemaTable => table !== null)

  return {
    tables:
      normalizedTables,
    realSchemaInspectionExecutedInThisLoop:
      schemaSnapshot.realSchemaInspectionExecutedInThisLoop === true,
  }
}

export function validateTableCompatibility(
  tableName: string,
  payloads: readonly StagingPayload[] = [],
  tableSchema: NormalizedSchemaTable | null,
  options: CompatibilityOptions = {},
) {
  const errors: string[] = []
  const warnings: string[] = []
  const missingRequiredColumns: string[] = []
  const requiredColumns =
    getExpectedColumnsForTable(tableName)

  if (!isAllowedTable(tableName)) {
    errors.push(`${tableName}: table not allowed`)
  }

  if (hasForbiddenTableToken(tableName)) {
    errors.push(`${tableName}: forbidden table target`)
  }

  if (tableSchema === null) {
    errors.push(`${tableName}: schema table missing`)
    missingRequiredColumns.push(
      ...requiredColumns.map(columnName => `${tableName}.${columnName}`),
    )
  } else {
    const schemaColumns =
      new Set(tableSchema.columns.map(column => column.columnName))

    for (const columnName of requiredColumns) {
      if (!schemaColumns.has(columnName)) {
        missingRequiredColumns.push(`${tableName}.${columnName}`)
      }
    }

    const extraColumns =
      tableSchema.columns
        .map(column => column.columnName)
        .filter(columnName => !requiredColumns.includes(columnName as never))

    if (extraColumns.length > 0) {
      warnings.push(`${tableName}: extra columns in schema snapshot: ${extraColumns.join(", ")}`)
    }

    for (const column of tableSchema.columns) {
      if (!isVerifiableType(column.dataType)) {
        warnings.push(`${tableName}.${column.columnName}: type not verifiable locally (${column.dataType})`)
      }
    }
  }

  payloads.forEach((payload, index) => {
    const payloadNumber =
      index + 1
    const payloadTable =
      normalizeText(payload.tableName) ?? tableName
    const dedupeKey =
      normalizeText(payload.dedupeKey) ?? normalizeText(payload.idempotencyKey)

    if (payloadTable !== tableName) {
      errors.push(`${tableName} payload ${payloadNumber}: tableName mismatch`)
    }

    if (payload.dryRun !== true) {
      errors.push(`${tableName} payload ${payloadNumber}: dryRun required`)
    }

    if (payload.stagingOnly !== true) {
      errors.push(`${tableName} payload ${payloadNumber}: stagingOnly required`)
    }

    if (payload.approvalRequired !== true) {
      errors.push(`${tableName} payload ${payloadNumber}: approvalRequired required`)
    }

    if (payload.writeExecuted === true) {
      errors.push(`${tableName} payload ${payloadNumber}: write already executed`)
    }

    if (dedupeKey === null) {
      errors.push(`${tableName} payload ${payloadNumber}: dedupeKey required`)
    }

    for (const columnName of requiredColumns) {
      if (!Object.hasOwn(payload, columnName)) {
        errors.push(`${tableName} payload ${payloadNumber}: missing payload field ${columnName}`)
      }
    }
  })

  return {
    tableName,
    compatible:
      errors.length === 0 &&
      missingRequiredColumns.length === 0,
    payloadsChecked:
      payloads.length,
    requiredColumns:
      [...requiredColumns],
    missingRequiredColumns,
    warnings,
    errors,
    readOnlySqlPrepared:
      options.readOnlySqlPrepared !== false,
  }
}

export function validatePayloadBundleAgainstStagingSchema(
  payloadBundle: PayloadBundle = {},
  schemaSnapshot: SchemaSnapshot = {},
  options: CompatibilityOptions = {},
) {
  const normalizedSnapshot =
    normalizeStagingSchemaSnapshot(schemaSnapshot)
  const payloadsByTable =
    payloadBundle.payloadsByTable ?? {}
  const tableReports =
    LUNA_PORTEX_STAGING_ALLOWED_WRITE_TABLES.map(tableName =>
      validateTableCompatibility(
        tableName,
        Array.isArray(payloadsByTable[tableName])
          ? payloadsByTable[tableName] ?? []
          : [],
        normalizedSnapshot.tables.find(table => table.tableName === tableName) ?? null,
        options,
      ),
    )
  const allPayloadTables =
    Object.keys(payloadsByTable)
  const errors =
    tableReports.flatMap(report => report.errors)
  const warnings =
    tableReports.flatMap(report => report.warnings)

  for (const tableName of allPayloadTables) {
    if (!isAllowedTable(tableName)) {
      errors.push(`${tableName}: table not allowed`)
    }

    if (hasForbiddenTableToken(tableName)) {
      errors.push(`${tableName}: forbidden table target`)
    }
  }

  const incompatibleTables =
    tableReports
      .filter(report => report.compatible === false)
      .map(report => report.tableName)
  const missingRequiredColumns =
    tableReports.flatMap(report => report.missingRequiredColumns)

  return {
    schemaCompatibilityVersion:
      LUNA_PORTEX_STAGING_SCHEMA_COMPATIBILITY_VERSION,
    status:
      errors.length === 0 && missingRequiredColumns.length === 0
        ? "STAGING_SCHEMA_COMPATIBILITY_PASS_LOCAL_SNAPSHOT_ONLY"
        : "STAGING_SCHEMA_COMPATIBILITY_BLOCKED",
    mode:
      "LOCAL_DRY_RUN_SCHEMA_COMPATIBILITY_ONLY",
    eligibleCandidates:
      payloadBundle.eligibleCandidates ?? 0,
    blockedCandidates:
      payloadBundle.blockedCandidates ?? 0,
    payloadTablesChecked:
      allPayloadTables.filter(tableName => isAllowedTable(tableName)).length,
    payloadsChecked:
      tableReports.reduce((sum, report) => sum + report.payloadsChecked, 0),
    schemaTablesChecked:
      normalizedSnapshot.tables.filter(table => isAllowedTable(table.tableName)).length,
    compatible:
      errors.length === 0 &&
      missingRequiredColumns.length === 0,
    incompatibleTables,
    missingRequiredColumns,
    warnings,
    errors,
    tableReports,
    readOnlySqlPrepared:
      options.readOnlySqlPrepared !== false,
    realSchemaInspectionExecutedInThisLoop:
      normalizedSnapshot.realSchemaInspectionExecutedInThisLoop,
    stagingWriteExecuted:
      false,
    readOnlyInspectionRequiredBeforeRealWrite:
      true,
    approvalRequiredBeforeWrite:
      true,
    safetyFlags:
      {
        productionTouched:
          false,
        stagingDbWritten:
          false,
        dbConnected:
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

export function summarizeStagingSchemaCompatibilityReport(
  report: ReturnType<typeof validatePayloadBundleAgainstStagingSchema>,
) {
  return {
    schemaCompatibilityVersion:
      report.schemaCompatibilityVersion,
    eligibleCandidates:
      report.eligibleCandidates,
    blockedCandidates:
      report.blockedCandidates,
    payloadTablesChecked:
      report.payloadTablesChecked,
    payloadsChecked:
      report.payloadsChecked,
    schemaTablesChecked:
      report.schemaTablesChecked,
    compatible:
      report.compatible,
    incompatibleTables:
      [...report.incompatibleTables],
    missingRequiredColumns:
      [...report.missingRequiredColumns],
    warnings:
      [...report.warnings],
    readOnlySqlPrepared:
      report.readOnlySqlPrepared,
    realSchemaInspectionExecutedInThisLoop:
      report.realSchemaInspectionExecutedInThisLoop,
    stagingWriteExecuted:
      report.stagingWriteExecuted,
    readOnlyInspectionRequiredBeforeRealWrite:
      report.readOnlyInspectionRequiredBeforeRealWrite,
    approvalRequiredBeforeWrite:
      report.approvalRequiredBeforeWrite,
  }
}

export function getStagingSchemaCompatibilityChecklist() {
  return [
    "confirm Production remains off-limits",
    "confirm Staging write remains disabled in LOOP 140",
    "confirm schema inspection SQL is read-only and not executed",
    "confirm payloads target only eBay Pro Staging tables",
    "confirm required columns exist in the local schema snapshot",
    "confirm payload idempotency keys are present",
    "confirm real schema inspection requires future approval",
    "confirm next loop is 141 — Approved Staging Write de 3 candidatos",
  ]
}
