export const COMMERCIAL_DRY_RUN_MAX_AGE_MS = 30 * 60 * 1000

export type CommercialMonitorReaderView = {
  status?: string
  source?: string
  observedAt?: string | null
  error?: string
  metrics?: Record<string, unknown>
}

export type CommercialMonitorRunView = {
  status?: string
  startedAt?: string
  completedAt?: string | null
  started_at?: string
  completed_at?: string | null
  nextAction?: string
  next_action?: string
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

export function buildCommercialMonitorRunRequest(dryRun: boolean) {
  return { action: "run" as const, dryRun }
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
  const metrics = run.metrics ?? {}
  if (metrics.dryRun !== true) return false

  const completedAt = run.completedAt ?? run.completed_at
  const completedTime = Date.parse(completedAt ?? "")
  const age = now - completedTime
  if (!Number.isFinite(completedTime) || age < -60_000 || age > COMMERCIAL_DRY_RUN_MAX_AGE_MS) {
    return false
  }

  const errors = errorRows(run)
  if (errors.some(({ code }) => /IDENTITY|ACCOUNT/i.test(code ?? ""))) return false
  if (errors.some(({ reader, code }) =>
    reader === "orders" && /AUTH|OAUTH|TOKEN|SCOPE|_401$|_403$/i.test(code ?? "")
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
