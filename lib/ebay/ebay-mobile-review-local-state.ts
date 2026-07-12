import type { PinnedCandidate } from "@/lib/ebay/ebay-mobile-review-pinned-candidate-continuity"

export const MOBILE_REVIEW_LOCAL_STATE_VERSION = 2
export const MOBILE_REVIEW_PINNED_STORAGE_KEY = "imnova:ebay-mobile-review:pinned-candidates:v2"
export const MOBILE_REVIEW_PINNED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

type StoredPinnedState = {
  schemaVersion: number
  savedAt: string
  pinnedCandidates: PinnedCandidate[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value))

export function isPinnedCandidate(value: unknown): value is PinnedCandidate {
  if (!isRecord(value)) return false
  return Boolean(
    typeof value.pinnedCandidateId === "string" &&
    typeof value.productName === "string" &&
    typeof value.sameProductConfirmed === "boolean" &&
    typeof value.stockConfirmed === "boolean" &&
    (value.stockQuantityConfirmed === null || typeof value.stockQuantityConfirmed === "number") &&
    typeof value.lunaPriceConfirmed === "boolean" &&
    (value.lunaPrice === null || typeof value.lunaPrice === "number") &&
    typeof value.imageConfirmed === "boolean" &&
    value.source === "HUMAN_MOBILE_CONFIRMED"
  )
}

export function serializePinnedCandidates(candidates: PinnedCandidate[], now = new Date()) {
  const payload: StoredPinnedState = {
    schemaVersion: MOBILE_REVIEW_LOCAL_STATE_VERSION,
    savedAt: now.toISOString(),
    pinnedCandidates: candidates,
  }
  return JSON.stringify(payload)
}

export function parsePinnedCandidates(raw: string | null, now = Date.now()) {
  if (!raw) return { candidates: [] as PinnedCandidate[], status: "EMPTY" as const }
  try {
    const payload: unknown = JSON.parse(raw)
    if (!isRecord(payload) || payload.schemaVersion !== MOBILE_REVIEW_LOCAL_STATE_VERSION || typeof payload.savedAt !== "string" || !Array.isArray(payload.pinnedCandidates)) {
      return { candidates: [] as PinnedCandidate[], status: "INVALID" as const }
    }
    const savedAt = Date.parse(payload.savedAt)
    if (!Number.isFinite(savedAt) || now - savedAt > MOBILE_REVIEW_PINNED_MAX_AGE_MS) {
      return { candidates: [] as PinnedCandidate[], status: "EXPIRED" as const }
    }
    if (!payload.pinnedCandidates.every(isPinnedCandidate)) {
      return { candidates: [] as PinnedCandidate[], status: "INVALID" as const }
    }
    return { candidates: payload.pinnedCandidates, status: "RESTORED" as const }
  } catch {
    return { candidates: [] as PinnedCandidate[], status: "INVALID" as const }
  }
}
