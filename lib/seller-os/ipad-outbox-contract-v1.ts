import type { MayelOwnerActionEvidenceV1 } from "./mayel-owner-action-presentation-v1"
export const IPAD_OUTBOX_VERSION = "SELLER_OS_IPAD_LOCAL_FIRST_EBAY_SYNC_V1" as const
export const OUTBOX_FRIENDLY_STATES = ["GUARDADO", "PENDIENTE_DE_SINCRONIZAR", "SINCRONIZADO", "REQUIERE_ATENCION"] as const
export type OutboxFriendlyState = typeof OUTBOX_FRIENDLY_STATES[number]
export type OutboxKind = "IMAGE_DRAFT" | "IMAGE_SYNC" | "IMAGE_UPLOAD" | "ADS_POLICY" | "LISTING_DRAFT"
export type OutboxImageFile = { id: string; sha256: string; mimeType: string; bytes: number; position: number }
export type OutboxPolicy = { minRate: number; maxRate: number; minProfit: number; minMargin: number; mode: string; window: string; timeZone: string; startsAt: string | null; endsAt: string | null }
export type OutboxChanges = { title?: string; description?: string; price?: number; quantity?: number;
  taskId?: string; assetId?: string; experimentId?: string; manifestDigest?: string; prepareReview?: boolean; policy?: OutboxPolicy; files?: OutboxImageFile[]; rightsConfirmed?: true }
export type OutboxIntent = { version: typeof IPAD_OUTBOX_VERSION; kind: OutboxKind; itemId: string;
  listingTitle: string; generationId: string; createdAt: string; baseVersionHash: string | null;
  baseObservedAt: string | null; idempotencyKey: string; requestedChanges: OutboxChanges }
export type DurableOutboxReceipt = MayelOwnerActionEvidenceV1 & { id: string; idempotencyKey: string; state: OutboxFriendlyState;
  internalState: string; receivedAt: string; reasonCode: string | null; officialReadback: boolean }

const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}
function exact(value: unknown, keys: string[]) {
  const r = object(value)
  if (value !== r || Object.keys(r).some(k => !keys.includes(k))) throw Error("OUTBOX_FIELDS_INVALID")
  return r
}
function safeText(v: unknown, max: number) {
  if (typeof v !== "string" || v.length > max || /\bBearer\s|\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.|\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}|[?&](?:token|signature|apikey)=/i.test(v))
    throw Error("OUTBOX_UNSAFE_TEXT")
  return v
}
function timestamp(v: unknown, nullable = false) {
  if (v === null && nullable) return null
  const s = safeText(v, 40)
  if (!Number.isFinite(Date.parse(s))) throw Error("OUTBOX_TIMESTAMP_INVALID")
  return s
}
function digest(v: unknown, nullable = false) {
  if (v === null && nullable) return null
  if (typeof v !== "string" || !/^sha256:[a-f0-9]{64}$/.test(v)) throw Error("OUTBOX_BASE_VERSION_INVALID")
  return v
}
export function parseOutboxChangesV1(value: unknown): OutboxChanges {
  const r = exact(value, ["title", "description", "price", "quantity", "taskId", "assetId", "experimentId", "manifestDigest", "prepareReview", "policy", "files", "rightsConfirmed"])
  const out: OutboxChanges = {}
  if (r.rightsConfirmed !== undefined) {
    if (r.rightsConfirmed !== true) throw Error("OUTBOX_IMAGE_RIGHTS_REQUIRED")
    out.rightsConfirmed = true
  }
  if (r.files !== undefined) {
    if (!Array.isArray(r.files) || r.files.length < 1 || r.files.length > 6) throw Error("OUTBOX_IMAGE_FILES_INVALID")
    out.files = r.files.map((value, position) => {
      const f = exact(value, ["id", "sha256", "mimeType", "bytes", "position"])
      if (typeof f.id !== "string" || !/^[a-f0-9-]{36}$/i.test(f.id) ||
          typeof f.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(f.sha256) ||
          !["image/jpeg", "image/png", "image/webp"].includes(String(f.mimeType)) ||
          !Number.isSafeInteger(f.bytes) || Number(f.bytes) < 1 || Number(f.bytes) > 12 * 1024 * 1024 || f.position !== position)
        throw Error("OUTBOX_IMAGE_FILES_INVALID")
      return { id: f.id, sha256: f.sha256, mimeType: String(f.mimeType), bytes: Number(f.bytes), position }
    })
    if (new Set(out.files.map(f => f.sha256)).size !== out.files.length || new Set(out.files.map(f => f.id)).size !== out.files.length)
      throw Error("OUTBOX_DUPLICATE_IMAGE")
  }
  for (const k of ["title", "description"] as const) if (r[k] !== undefined) out[k] = safeText(r[k], k === "title" ? 500 : 8000)
  for (const k of ["price", "quantity"] as const) if (r[k] !== undefined) {
    if (typeof r[k] !== "number" || !Number.isFinite(r[k]) || r[k] < 0 || (k === "quantity" && !Number.isSafeInteger(r[k]))) throw Error("OUTBOX_NUMBER_INVALID")
    out[k] = r[k]
  }
  for (const k of ["taskId", "assetId", "experimentId"] as const) if (r[k] !== undefined) {
    if (typeof r[k] !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(r[k])) throw Error("OUTBOX_REFERENCE_INVALID")
    out[k] = r[k]
  }
  if (r.prepareReview !== undefined) {
    if (r.prepareReview !== true) throw Error("OUTBOX_PREPARE_INVALID")
    out.prepareReview = true
  }
  if (r.manifestDigest !== undefined) out.manifestDigest = digest(r.manifestDigest)!
  if (r.policy !== undefined) {
    const p = exact(r.policy, ["minRate", "maxRate", "minProfit", "minMargin", "mode", "window", "timeZone", "startsAt", "endsAt"])
    for (const k of ["minRate", "maxRate", "minProfit", "minMargin"]) if (typeof p[k] !== "number" || !Number.isFinite(p[k]) || Number(p[k]) < 0) throw Error("OUTBOX_POLICY_INVALID")
    if (Number(p.minRate) > Number(p.maxRate) || Number(p.maxRate) > 100 || Number(p.minMargin) > 100) throw Error("OUTBOX_POLICY_INVALID")
    out.policy = { minRate: Number(p.minRate), maxRate: Number(p.maxRate), minProfit: Number(p.minProfit), minMargin: Number(p.minMargin),
      mode: safeText(p.mode, 20), window: safeText(p.window, 20), timeZone: safeText(p.timeZone, 100),
      startsAt: timestamp(p.startsAt, true), endsAt: timestamp(p.endsAt, true) }
  }
  return out
}
export function parseOutboxIntentV1(value: unknown): OutboxIntent {
  const r = exact(value, ["version", "kind", "itemId", "listingTitle", "generationId", "createdAt", "baseVersionHash", "baseObservedAt", "idempotencyKey", "requestedChanges"])
  if (r.version !== IPAD_OUTBOX_VERSION || !["IMAGE_DRAFT", "IMAGE_SYNC", "IMAGE_UPLOAD", "ADS_POLICY", "LISTING_DRAFT"].includes(String(r.kind)) ||
      typeof r.itemId !== "string" || !/^\d{9,20}$/.test(r.itemId) ||
      typeof r.idempotencyKey !== "string" || !/^ipados:v1:[a-f0-9]{64}$/.test(r.idempotencyKey)) throw Error("OUTBOX_INTENT_INVALID")
  const requestedChanges = parseOutboxChangesV1(r.requestedChanges)
  if (String(r.kind).startsWith("IMAGE_") && (!requestedChanges.taskId || (r.kind !== "IMAGE_UPLOAD" && !requestedChanges.assetId))) throw Error("OUTBOX_IMAGE_REFERENCES_REQUIRED")
  if (r.kind === "IMAGE_UPLOAD" && (!requestedChanges.files || !requestedChanges.rightsConfirmed || requestedChanges.prepareReview)) throw Error("OUTBOX_IMAGE_UPLOAD_CONTRACT_INVALID")
  if (r.kind === "IMAGE_SYNC" && !requestedChanges.manifestDigest) throw Error("OUTBOX_AUTHORIZED_MANIFEST_REQUIRED")
  if (r.kind === "ADS_POLICY" && !requestedChanges.policy) throw Error("OUTBOX_ADS_POLICY_REQUIRED")
  return { version: IPAD_OUTBOX_VERSION, kind: r.kind as OutboxKind, itemId: r.itemId,
    listingTitle: safeText(r.listingTitle, 500), generationId: safeText(r.generationId, 120),
    createdAt: timestamp(r.createdAt)!, baseVersionHash: digest(r.baseVersionHash, true),
    baseObservedAt: timestamp(r.baseObservedAt, true), idempotencyKey: r.idempotencyKey, requestedChanges }
}
export function stableOutboxJsonV1(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableOutboxJsonV1).join(",")}]`
  if (v && typeof v === "object") return `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, x]) => `${JSON.stringify(k)}:${stableOutboxJsonV1(x)}`).join(",")}}`
  return JSON.stringify(v)
}
export function outboxFriendlyStateV1(state: string): OutboxFriendlyState {
  if (state === "SYNCED") return "SINCRONIZADO"
  if (["ATTENTION", "REQUIRES_ATTENTION"].includes(state)) return "REQUIERE_ATENCION"
  if (["APPROVED_FOR_EBAY_SYNC", "PENDING_EBAY_SYNC", "REVALIDATING", "SYNCING", "OFFICIAL_READBACK_REQUIRED", "LEASED", "UNKNOWN_COMMIT"].includes(state)) return "PENDIENTE_DE_SINCRONIZAR"
  return "GUARDADO"
}
export function outboxTransientFailureV1(code: string) {
  return /EBAY_QUOTA_EXHAUSTED|EBAY_TEMPORARILY_UNAVAILABLE|EBAY_RATE_LIMITED|TEMPORARY_UPSTREAM_FAILURE|RATE_LIMIT|HTTP_429|HTTP_5[0-9]{2}|EBAY_ERROR_518|MAYEL_SAVED_DRAFT_ALREADY_RUNNING|TIMEOUT|FETCH_FAILED|WAITING_FOR_EBAY/.test(code)
}

/** Shared existing outbox fallback, also used by pending gallery preparation. */
export function nextOutboxAttemptAtV1(retryAt?: string | null, now = Date.now()) {
  return retryAt && Date.parse(retryAt) > now ? retryAt : new Date(now + 15 * 60_000).toISOString()
}
