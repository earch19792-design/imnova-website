import { timingSafeEqual } from "node:crypto"

const PILOT_MAX_DURATION_MS = 24 * 60 * 60 * 1_000
const SCHEDULE_TICK_TOLERANCE_MS = 30_000

type PilotEnvironment = {
  vercelEnvironment?: string | null
  previewMonitorEnabled?: string | null
  monitorEnabled?: string | null
  startedAt?: string | null
  expiresAt?: string | null
}

function parsedTime(value: string | null | undefined) {
  if (!value) return null
  const parsed = Date.parse(value.trim())
  return Number.isFinite(parsed) ? parsed : null
}

export function commercialPreviewPilotConfiguration(
  environment: PilotEnvironment,
  now = new Date(),
) {
  const currentEnvironment = environment.vercelEnvironment?.trim() || "development"
  const previewOnly = currentEnvironment === "preview"
  const previewFlagEnabled = environment.previewMonitorEnabled?.trim() === "true"
  const runtimeFlagEnabled = environment.monitorEnabled?.trim() === "true"
  const startedAtMs = parsedTime(environment.startedAt)
  const expiresAtMs = parsedTime(environment.expiresAt)
  const durationMs = startedAtMs !== null && expiresAtMs !== null
    ? expiresAtMs - startedAtMs
    : null
  const validWindow = durationMs !== null && durationMs > 0 && durationMs <= PILOT_MAX_DURATION_MS
  const nowMs = now.getTime()
  const withinWindow = validWindow && startedAtMs !== null && expiresAtMs !== null &&
    nowMs >= startedAtMs && nowMs < expiresAtMs

  let status: "production_blocked" | "disabled" | "misconfigured" | "scheduled" | "active" | "expired"
  if (!previewOnly) status = "production_blocked"
  else if (!previewFlagEnabled || !runtimeFlagEnabled) status = "disabled"
  else if (!validWindow || startedAtMs === null || expiresAtMs === null) status = "misconfigured"
  else if (nowMs < startedAtMs) status = "scheduled"
  else if (nowMs >= expiresAtMs) status = "expired"
  else status = "active"

  return {
    enabled: status === "active" && withinWindow,
    status,
    previewOnly: true,
    currentEnvironment,
    startedAt: startedAtMs === null ? null : new Date(startedAtMs).toISOString(),
    expiresAt: expiresAtMs === null ? null : new Date(expiresAtMs).toISOString(),
    durationHours: durationMs === null ? null : durationMs / (60 * 60 * 1_000),
    remainingSeconds: status === "active" && expiresAtMs !== null
      ? Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1_000))
      : 0,
    automaticCutoff: true,
    productionEnabled: false,
  }
}

export function currentCommercialPreviewPilotConfiguration(now = new Date()) {
  return commercialPreviewPilotConfiguration({
    vercelEnvironment: process.env.VERCEL_ENV,
    previewMonitorEnabled: process.env.EBAY_COMMERCIAL_PREVIEW_MONITOR_ENABLED,
    monitorEnabled: process.env.EBAY_COMMERCIAL_MONITOR_ENABLED,
    startedAt: process.env.EBAY_COMMERCIAL_PILOT_STARTED_AT,
    expiresAt: process.env.EBAY_COMMERCIAL_PILOT_EXPIRES_AT,
  }, now)
}

export function commercialPreviewCronAuthorized(request: Request) {
  const authorization = request.headers.get("authorization") ?? ""
  const provided = Buffer.from(authorization)
  const allowed = [
    process.env.EBAY_COMMERCIAL_PILOT_CRON_SECRET,
    process.env.CRON_SECRET,
  ].map((value) => value?.trim() ?? "").filter(Boolean)
  return allowed.some((secret) => {
    const expected = Buffer.from(`Bearer ${secret}`)
    return provided.length === expected.length && timingSafeEqual(provided, expected)
  })
}

export function commercialScheduleLaneDue(
  lastObservedAt: string | null | undefined,
  intervalMinutes: number,
  now = new Date(),
) {
  if (!lastObservedAt) return true
  const lastObservedAtMs = Date.parse(lastObservedAt)
  if (!Number.isFinite(lastObservedAtMs)) return true
  return lastObservedAtMs + intervalMinutes * 60_000 <=
    now.getTime() + SCHEDULE_TICK_TOLERANCE_MS
}

export function commercialAnalyticsDivergenceRecheckDue(input: {
  nextCheckAt: Array<string | null | undefined>
  lastAnalyticsAttemptAt?: string | null
  now?: Date
  retryBackoffMinutes?: number
}) {
  const now = input.now ?? new Date()
  const hasDueDivergence = input.nextCheckAt.some((value) => {
    if (!value) return true
    const parsed = Date.parse(value)
    return !Number.isFinite(parsed) || parsed <= now.getTime()
  })
  if (!hasDueDivergence) return false
  return commercialScheduleLaneDue(
    input.lastAnalyticsAttemptAt,
    input.retryBackoffMinutes ?? 60,
    now,
  )
}

export function summarizeCommercialPilotRuns(input: {
  runs: Array<{ status?: string | null; metrics?: Record<string, unknown> | null }>
  deliveryAttempts: Array<{ status?: string | null; attempt_number?: number | null }>
  deadLetterCount: number
  divergenceStatus: string | null
}) {
  const numberMetric = (metrics: Record<string, unknown> | null | undefined, key: string) => {
    const value = Number(metrics?.[key] ?? 0)
    return Number.isFinite(value) ? value : 0
  }
  const runs = input.runs
  return {
    totalRuns: runs.length,
    completedRuns: runs.filter((run) => run.status === "completed").length,
    partialRuns: runs.filter((run) => run.status === "partial").length,
    failedRuns: runs.filter((run) => run.status === "failed").length,
    ordersRead: runs.reduce((sum, run) => sum + numberMetric(run.metrics, "officialOrdersRead"), 0),
    newSales: runs.reduce((sum, run) => sum + numberMetric(run.metrics, "newSales"), 0),
    fulfillmentTasksCreated: runs.reduce(
      (sum, run) => sum + numberMetric(run.metrics, "fulfillmentTasksCreated"),
      0,
    ),
    alertsGenerated: runs.reduce((sum, run) => sum + numberMetric(run.metrics, "alertsGenerated"), 0),
    duplicatesAvoided: runs.reduce((sum, run) => sum + numberMetric(run.metrics, "duplicatesAvoided"), 0),
    whatsappMetaAccepted: input.deliveryAttempts.filter((attempt) => attempt.status === "delivered").length,
    whatsappDelivered: 0,
    whatsappFailed: input.deliveryAttempts.filter((attempt) => attempt.status === "failed").length,
    retries: input.deliveryAttempts.filter(
      (attempt) => Number(attempt.attempt_number ?? 1) > 1,
    ).length,
    deadLetter: input.deadLetterCount,
    analyticsDivergenceStatus: input.divergenceStatus,
    ebayWrites: 0,
    productionChanged: false,
  }
}
