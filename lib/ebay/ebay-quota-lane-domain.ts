export type EbayQuotaStateSnapshot = {
  status: string
  reset_at: string | null
  available_budget: number | string | null
  reserved_budget: number | string | null
  owner_lane: string
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
