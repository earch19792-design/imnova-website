export const COMMERCIAL_DRY_RUN_MAX_AGE_MS = 30 * 60 * 1000

export function formatCommercialMetricValue(input: unknown) {
  return typeof input === "number" && Number.isFinite(input)
    ? new Intl.NumberFormat("es-US").format(input)
    : "—"
}

export type CommercialMonitorReaderView = {
  status?: string
  source?: string
  observedAt?: string | null
  error?: string
  metrics?: Record<string, unknown>
  auth?: {
    status?: string
    requiredScope?: string
    scopeConfirmed?: boolean
    identityMatch?: boolean | null
    actionRequired?: string
    rawOAuthDescriptionExposed?: boolean
  }
}

export type CommercialMonitorRunView = {
  id?: string
  runId?: string
  status?: string
  startedAt?: string
  completedAt?: string | null
  started_at?: string
  completed_at?: string | null
  nextAction?: string
  next_action?: string
  satisfactory?: boolean
  consumedAt?: string | null
  authorizedPersistentRunId?: string | null
  dry_run_satisfactory?: boolean
  dry_run_consumed_at?: string | null
  authorized_persistent_run_id?: string | null
  readers?: Record<string, CommercialMonitorReaderView>
  metrics?: Record<string, unknown>
  errors?: Array<{ reader?: string; code?: string; retryable?: boolean }>
  safety?: {
    dryRun?: boolean
    commercialDataPersistencePerformed?: boolean
    alertDeliveryAttempted?: boolean
    ebayWriteUsed?: boolean
    buyerPiiReturned?: boolean
  }
}

export function buildCommercialMonitorRunRequest(dryRun: boolean, dryRunId?: string) {
  if (dryRun) return { action: "run" as const, dryRun: true as const }
  return dryRunId
    ? { action: "run" as const, dryRun: false as const, dryRunId }
    : { action: "run" as const, dryRun: false as const }
}

function errorRows(run: CommercialMonitorRunView) {
  const rows = [...(run.errors ?? [])]
  for (const [reader, state] of Object.entries(run.readers ?? {})) {
    if (state.error && !rows.some((row) => row.reader === reader && row.code === state.error)) {
      rows.push({ reader, code: state.error })
    }
  }
  return rows
}

function isZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value === 0
}

export function isSatisfactoryCommercialDryRun(
  run: CommercialMonitorRunView | null | undefined,
  now = Date.now(),
) {
  if (!run || !["completed", "partial"].includes(run.status ?? "")) return false
  if (run.consumedAt || run.dry_run_consumed_at || run.authorizedPersistentRunId ||
    run.authorized_persistent_run_id) return false
  const metrics = run.metrics ?? {}
  if (metrics.dryRun !== true) return false

  const completedAt = run.completedAt ?? run.completed_at
  const completedTime = Date.parse(completedAt ?? "")
  const age = now - completedTime
  if (!Number.isFinite(completedTime) || age < -60_000 || age > COMMERCIAL_DRY_RUN_MAX_AGE_MS) {
    return false
  }

  const errors = errorRows(run)
  if (errors.some(({ code }) =>
    /IDENTITY|ACCOUNT|CUSTOM_LABEL|LISTING_ITEM_ID/i.test(code ?? "")
  )) return false
  if (errors.some(({ reader, code }) =>
    reader === "orders" && /AUTH|OAUTH|TOKEN|SCOPE|_401$|_403$/i.test(code ?? "")
  )) return false
  if (
    run.readers?.orders?.auth?.status &&
    run.readers.orders.auth.status !== "READY"
  ) return false
  if (Object.values(run.readers ?? {}).some((reader) =>
    reader.auth?.rawOAuthDescriptionExposed === true
  )) return false

  const buyerPiiReturned = run.safety?.buyerPiiReturned ?? metrics.buyerPiiReturned
  const ebayWriteUsed = run.safety?.ebayWriteUsed
  const alertDeliveryAttempted = run.safety?.alertDeliveryAttempted

  return metrics.commercialDataPersistencePerformed === false
    && isZero(metrics.alertsEnqueued)
    && isZero(metrics.fulfillmentTasksCreated)
    && isZero(metrics.whatsappDelivered)
    && isZero(metrics.ebayWrites)
    && buyerPiiReturned === false
    && (run.safety?.dryRun === undefined || run.safety.dryRun === true)
    && (ebayWriteUsed === undefined || ebayWriteUsed === false)
    && (alertDeliveryAttempted === undefined || alertDeliveryAttempted === false)
}
