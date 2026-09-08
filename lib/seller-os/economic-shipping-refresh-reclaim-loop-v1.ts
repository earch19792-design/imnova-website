import { economicEvidenceDigestV1 } from "./economic-evidence-refresh-v1"

export const SELLER_OS_ECONOMIC_SHIPPING_REFRESH_RECLAIM_LOOP_FIX_V1 =
  "SELLER_OS_ECONOMIC_SHIPPING_REFRESH_RECLAIM_LOOP_FIX_V1" as const
export const SELLER_OS_ECONOMIC_SHIPPING_MAX_ATTEMPTS_V1 = 5
export const SELLER_OS_ECONOMIC_SHIPPING_BATCH_LIMIT_V1 = 1
export const SELLER_OS_ECONOMIC_SHIPPING_RETRY_MINUTES_V1 =
  Object.freeze([1, 2, 4, 8, 15] as const)

export function economicShippingFreshnessGenerationV1(input: Readonly<{
  jobId: string
  accountKey: string
  ebayItemId: string
  lunaProductId: string
  lunaVariantId: string
  sourceSku: string
  requiredEvidenceAfter: string
}>) {
  if (!/^[0-9a-f-]{36}$/i.test(input.jobId) ||
      !/^\d{9,20}$/.test(input.ebayItemId) ||
      !Number.isFinite(Date.parse(input.requiredEvidenceAfter))) {
    throw new Error("ECONOMIC_SHIPPING_FRESHNESS_GENERATION_INVALID")
  }
  return `economic-shipping-refresh-v1:${economicEvidenceDigestV1({
    contract: SELLER_OS_ECONOMIC_SHIPPING_REFRESH_RECLAIM_LOOP_FIX_V1,
    jobId: input.jobId,
    accountKey: input.accountKey,
    ebayItemId: input.ebayItemId,
    lunaProductId: input.lunaProductId,
    lunaVariantId: input.lunaVariantId,
    sourceSku: input.sourceSku,
    requiredEvidenceAfter: new Date(input.requiredEvidenceAfter).toISOString(),
  })}`
}

export function economicShippingRetryDecisionV1(input: Readonly<{
  attemptCount: number
  now?: number
  retryable?: boolean
}>) {
  const attempt = Math.max(1, Math.floor(input.attemptCount))
  const terminal = input.retryable === false ||
    attempt >= SELLER_OS_ECONOMIC_SHIPPING_MAX_ATTEMPTS_V1
  const minutes = SELLER_OS_ECONOMIC_SHIPPING_RETRY_MINUTES_V1[
    Math.min(attempt - 1,
      SELLER_OS_ECONOMIC_SHIPPING_RETRY_MINUTES_V1.length - 1)]
  return Object.freeze({
    status: terminal ? "FAILED_TERMINAL" as const
      : "FAILED_RETRYABLE" as const,
    nextRetryAt: terminal ? null : new Date((input.now ?? Date.now()) +
      minutes * 60_000).toISOString(),
    deadLetter: terminal,
    backoffMinutes: terminal ? null : minutes,
  })
}

export function economicShippingExpiredLeaseDecisionV1(input: Readonly<{
  attemptCount: number
  leaseExpiresAt: string | null
  now?: number
}>) {
  const now = input.now ?? Date.now()
  const expiry = Date.parse(input.leaseExpiresAt ?? "")
  if (!Number.isFinite(expiry) || expiry > now) return null
  return economicShippingRetryDecisionV1({ attemptCount: input.attemptCount,
    now })
}

export function reusableEconomicShippingEvidenceV1(input: Readonly<{
  evidence: Readonly<{ observedAt: string; maximumAgeSeconds: number }> |
    null | undefined
  requiredEvidenceAfter: string
  bindingMatches: boolean
  now?: number
}>) {
  const observedAt = Date.parse(input.evidence?.observedAt ?? "")
  const requiredAfter = Date.parse(input.requiredEvidenceAfter)
  const maximumAgeSeconds = Number(input.evidence?.maximumAgeSeconds)
  const now = input.now ?? Date.now()
  return input.bindingMatches &&
    Number.isFinite(observedAt) && Number.isFinite(requiredAfter) &&
    maximumAgeSeconds === 6 * 60 * 60 && observedAt <= now &&
    observedAt + maximumAgeSeconds * 1_000 >= now &&
    observedAt >= requiredAfter
}
