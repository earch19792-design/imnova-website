type JsonRecord = Record<string, unknown>

const RETRYABLE_GALLERY_SYNC_STATES = new Set([
  "APPROVED_FOR_EBAY_SYNC",
  "PENDING_EBAY_SYNC",
  "REVALIDATING",
  "SYNCING",
  "OFFICIAL_READBACK_REQUIRED",
  "UNKNOWN_COMMIT",
])

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function timestamp(value: unknown) {
  if (typeof value !== "string") return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function mayelGallerySyncResumeV1(input: {
  rows: JsonRecord[]
  task: JsonRecord
  now?: string
}) {
  const taskId = String(input.task.id ?? "")
  const itemId = String(input.task.ebay_item_id ?? "")
  const manifestDigest = String(input.task.visual_manifest_digest ?? "")
  if (!taskId || !/^\d{9,20}$/.test(itemId) ||
      !/^sha256:[0-9a-f]{64}$/.test(manifestDigest)) return null

  const candidates = input.rows.filter((row) => {
    const changes = record(record(row.intent).requestedChanges)
    return row.kind === "IMAGE_SYNC" && row.item_id === itemId &&
      RETRYABLE_GALLERY_SYNC_STATES.has(String(row.state)) &&
      changes.taskId === taskId && changes.manifestDigest === manifestDigest
  }).sort((a, b) => timestamp(b.updated_at ?? b.received_at) -
    timestamp(a.updated_at ?? a.received_at))
  const row = candidates[0]
  if (!row || typeof row.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(row.id)) return null

  const now = timestamp(input.now ?? new Date().toISOString())
  const leaseUntil = typeof row.lease_until === "string"
    ? row.lease_until : null
  const leaseActive = timestamp(leaseUntil) > now
  const state = String(row.state)
  const readbackOnly = Number(row.dispatch_count ?? 0) > 0 ||
    ["SYNCING", "OFFICIAL_READBACK_REQUIRED", "UNKNOWN_COMMIT"]
      .includes(state)

  return {
    outboxId: row.id,
    state,
    reasonCode: typeof row.reason_code === "string"
      ? row.reason_code : null,
    nextAttemptAt: typeof row.next_attempt_at === "string"
      ? row.next_attempt_at : null,
    leaseActive,
    canResume: !leaseActive,
    mode: readbackOnly ? "VERIFY" as const : "SYNC" as const,
    label: readbackOnly
      ? "Verificar sincronización ahora"
      : "Sincronizar imágenes ahora",
  }
}

export const MAYEL_GALLERY_SYNC_RETRYABLE_STATES =
  [...RETRYABLE_GALLERY_SYNC_STATES]
