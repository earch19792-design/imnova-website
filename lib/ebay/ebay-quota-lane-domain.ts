export type EbayQuotaStateSnapshot = {
  status: string
  reset_at: string | null
  available_budget: number | string | null
  reserved_budget: number | string | null
  owner_lane: string
}

export type EbayQuotaRetrySnapshot = {
  status: string
  last_error_code: string | null
  rate_limit_resume_at: string | null
  available_at: string | null
}

export function evaluateEbayQuotaLaneState(
  data: EbayQuotaStateSnapshot,
  now = new Date(),
) {
  const reset = Date.parse(data.reset_at ?? "")
  const paused = data.status === "PAUSED_429" &&
    (!Number.isFinite(reset) || reset > now.getTime())
  const resetReached = data.status === "PAUSED_429" &&
    Number.isFinite(reset) && reset <= now.getTime()
  const budgetAvailable = data.available_budget === null ||
    Number(data.available_budget) > 0 || data.status === "UNKNOWN"
  return {
    available: resetReached || (!paused && budgetAvailable),
    status: resetReached ? "RESET_REACHED" : paused ? "PAUSED_429" : data.status,
    resumeAt: paused ? data.reset_at : null,
    ownerLane: data.owner_lane,
    reservedBudget: Number(data.reserved_budget ?? 0),
    resetReached,
  }
}

/**
 * Project a persisted lane into its effective state without changing the
 * append-only rate-limit event history. A PAUSED_429 row is only a pause
 * while its reset instant is still in the future. Once that instant passes,
 * callers may perform the single controlled probe described by
 * evaluateEbayQuotaLaneState.
 */
export function projectEffectiveEbayQuotaLane<T extends EbayQuotaStateSnapshot>(
  data: T,
  now = new Date(),
) {
  const decision = evaluateEbayQuotaLaneState(data, now)
  return {
    ...data,
    status: decision.status,
    // Non-429 quota rows may also use reset_at for their normal daily quota
    // window. Clear it only when an expired PAUSED_429 is projected as
    // RESET_REACHED; otherwise preserve the authoritative value.
    reset_at: decision.resetReached ? null : data.reset_at,
  }
}

/**
 * A durable retry row can remain WAITING_RETRY until a worker leases it. That
 * does not mean the customer-facing UI should continue saying "paused" after
 * its authorized resume instant. Missing or invalid resume metadata remains
 * conservative and is treated as an active pause.
 */
export function evaluateEbayQuotaRetryState(
  data: EbayQuotaRetrySnapshot,
  now = new Date(),
) {
  const quotaRetry = data.status === "WAITING_RETRY" &&
    /(?:429|QUOTA)/.test(data.last_error_code ?? "")
  const resumeAt = data.rate_limit_resume_at || data.available_at || null
  const reset = Date.parse(resumeAt ?? "")
  const active = quotaRetry && (!Number.isFinite(reset) || reset > now.getTime())
  return {
    active,
    resetReached: quotaRetry && Number.isFinite(reset) && reset <= now.getTime(),
    resumeAt: active ? resumeAt : null,
  }
}
