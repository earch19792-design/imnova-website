import type { SupabaseClient } from "@supabase/supabase-js"

export const SELLER_OS_SELFHOST_RUNTIME_STATUS_V1 =
  "SELLER_OS_SELFHOST_RUNTIME_STATUS_V1" as const

export const SELLER_OS_WORKSTATION_STATUS_TOOL_V1 = Object.freeze({
  name: "seller_os_get_workstation_status",
  title: "Get local Seller OS workstation status",
  description: "Read sanitized Docker scheduler, resume, catch-up, and durable job status. No credentials, commands, or marketplace writes.",
  annotations: { readOnlyHint: true as const, destructiveHint: false as const,
    openWorldHint: false as const, idempotentHint: true as const },
  securitySchemes: [{ type: "oauth2" as const, scopes: ["seller_os.read"] }],
  sideEffects: false as const,
})

const RUNTIME_STATUSES = new Set([
  "ONLINE", "OFFLINE_OR_HIBERNATING", "STALE", "NOT_STARTED", "UNAVAILABLE",
])
const JOB_STATUSES = new Set(["RUNNING", "SUCCEEDED", "FAILED", "STALE"])

type JsonRecord = Record<string, unknown>

export type SellerOsSelfhostRuntimeStatusV1 = Readonly<{
  contractVersion: typeof SELLER_OS_SELFHOST_RUNTIME_STATUS_V1
  observedAt: string
  runtimeStatus: "ONLINE" | "OFFLINE_OR_HIBERNATING" | "STALE" |
    "NOT_STARTED" | "UNAVAILABLE"
  heartbeatAgeSeconds: number | null
  session: null | Readonly<{
    startedAt: string | null
    priorHeartbeatAt: string | null
    lastHeartbeatAt: string | null
    resumeGapSeconds: number | null
    resumedFromGap: boolean
    catchUpCandidateCount: number
  }>
  jobs: readonly Readonly<{
    name: string
    scheduledSlot: number | null
    triggerKind: string | null
    status: string
    attemptCount: number
    startedAt: string | null
    completedAt: string | null
    httpStatus: number | null
    outcomeCode: string | null
    elapsedMs: number | null
  }>[]
  counts: Readonly<{
    running: number
    stale: number
    failedLast24Hours: number
  }>
  safety: Readonly<{
    readOnly: true
    credentialsIncluded: false
    environmentValuesIncluded: false
    marketplaceWrites: 0
    databaseBusinessMutations: 0
  }>
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function boundedText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
  return normalized ? normalized.slice(0, maximum) : null
}

function iso(value: unknown) {
  const parsed = Date.parse(String(value ?? ""))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function integer(value: unknown, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed : null
}

function counts(value: unknown) {
  const input = record(value)
  return {
    running: integer(input.running, 0, 1_000) ?? 0,
    stale: integer(input.stale, 0, 1_000) ?? 0,
    failedLast24Hours: integer(input.failedLast24Hours, 0, 1_000) ?? 0,
  }
}

export function parseSellerOsSelfhostRuntimeStatusV1(
  value: unknown,
): SellerOsSelfhostRuntimeStatusV1 {
  const input = record(value)
  const safety = record(input.safety)
  const runtimeStatus = boundedText(input.runtimeStatus, 40)
  if (input.contractVersion !== SELLER_OS_SELFHOST_RUNTIME_STATUS_V1 ||
      !runtimeStatus || !RUNTIME_STATUSES.has(runtimeStatus) ||
      safety.readOnly !== true || safety.credentialsIncluded !== false ||
      safety.environmentValuesIncluded !== false ||
      safety.marketplaceWrites !== 0 || safety.databaseBusinessMutations !== 0) {
    throw new Error("SELFHOST_RUNTIME_STATUS_INVALID")
  }
  const sessionInput = input.session === null ? null : record(input.session)
  const session = sessionInput ? {
    startedAt: iso(sessionInput.startedAt),
    priorHeartbeatAt: iso(sessionInput.priorHeartbeatAt),
    lastHeartbeatAt: iso(sessionInput.lastHeartbeatAt),
    resumeGapSeconds: integer(sessionInput.resumeGapSeconds, 0, 2_592_000),
    resumedFromGap: sessionInput.resumedFromGap === true,
    catchUpCandidateCount: integer(sessionInput.catchUpCandidateCount, 0, 16) ?? 0,
  } : null
  const jobs = Array.isArray(input.jobs) ? input.jobs.slice(0, 16).map((entry) => {
    const job = record(entry)
    const name = boundedText(job.name, 80)
    const status = boundedText(job.status, 30)
    if (!name || !/^[a-z0-9][a-z0-9-]{2,79}$/.test(name) ||
        !status || !JOB_STATUSES.has(status)) {
      throw new Error("SELFHOST_RUNTIME_STATUS_INVALID")
    }
    return {
      name,
      scheduledSlot: integer(job.scheduledSlot, 1, Number.MAX_SAFE_INTEGER),
      triggerKind: boundedText(job.triggerKind, 20),
      status,
      attemptCount: integer(job.attemptCount, 1, 20) ?? 1,
      startedAt: iso(job.startedAt),
      completedAt: iso(job.completedAt),
      httpStatus: integer(job.httpStatus, 100, 599),
      outcomeCode: boundedText(job.outcomeCode, 80),
      elapsedMs: integer(job.elapsedMs, 0, 14_400_000),
    }
  }) : []
  return {
    contractVersion: SELLER_OS_SELFHOST_RUNTIME_STATUS_V1,
    observedAt: iso(input.observedAt) ?? new Date(0).toISOString(),
    runtimeStatus: runtimeStatus as SellerOsSelfhostRuntimeStatusV1["runtimeStatus"],
    heartbeatAgeSeconds: integer(input.heartbeatAgeSeconds, 0, 31_536_000),
    session,
    jobs,
    counts: counts(input.counts),
    safety: { readOnly: true, credentialsIncluded: false,
      environmentValuesIncluded: false, marketplaceWrites: 0,
      databaseBusinessMutations: 0 },
  }
}

export function createUnavailableSellerOsSelfhostRuntimeStatusV1(
  observedAt = new Date().toISOString(),
): SellerOsSelfhostRuntimeStatusV1 {
  return {
    contractVersion: SELLER_OS_SELFHOST_RUNTIME_STATUS_V1,
    observedAt,
    runtimeStatus: "UNAVAILABLE",
    heartbeatAgeSeconds: null,
    session: null,
    jobs: [],
    counts: { running: 0, stale: 0, failedLast24Hours: 0 },
    safety: { readOnly: true, credentialsIncluded: false,
      environmentValuesIncluded: false, marketplaceWrites: 0,
      databaseBusinessMutations: 0 },
  }
}

export async function readSellerOsSelfhostRuntimeStatusV1(
  supabase: SupabaseClient,
) {
  const response = await supabase.rpc("get_seller_os_selfhost_runtime_status_v1")
  if (response.error) throw new Error("SELFHOST_RUNTIME_STATUS_UNAVAILABLE")
  return parseSellerOsSelfhostRuntimeStatusV1(response.data)
}
