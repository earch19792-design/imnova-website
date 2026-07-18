import type { SupabaseClient } from "@supabase/supabase-js"

import { getEbayReadonlyRateLimitMetadata } from "./ebay-readonly-rate-limit"

export const EBAY_QUOTA_COORDINATOR_VERSION = "EBAY-QUOTA-COORDINATOR-V1"

export type EbayQuotaLane =
  | "P0_ORDERS"
  | "P0_PROTECTION"
  | "P0_COMMERCIAL_MONITOR"
  | "P1_EXACT_VERIFICATION"
  | "P2_DISCOVERY"
  | "P3_DEEP_ANALYSIS"

export async function recordPersistentEbayRateLimit(
  supabase: SupabaseClient,
  input: {
    error: unknown
    apiFamily: string
    endpoint: string
    operation: string
    lane: EbayQuotaLane
    checkpoint?: Record<string, unknown>
    retryCount?: number
  },
) {
  const rateLimit = getEbayReadonlyRateLimitMetadata(input.error)
  if (!rateLimit) return null
  const observedAt = rateLimit.observedAt
  const fallbackSeconds = 15 * 60
  const retryAfterSeconds = rateLimit.retryAfterSeconds ?? fallbackSeconds
  const resumeAt = new Date(Date.parse(observedAt) + retryAfterSeconds * 1_000).toISOString()
  const { data: state, error: stateError } = await supabase
    .from("ebay_api_quota_states")
    .upsert({
      marketplace: "EBAY_US",
      api_family: input.apiFamily,
      operation: input.operation,
      status: "PAUSED_429",
      remaining: 0,
      available_budget: 0,
      reset_at: resumeAt,
      owner_lane: input.lane,
      last_refreshed_at: observedAt,
      updated_at: observedAt,
    }, { onConflict: "marketplace,api_family,operation" })
    .select("id")
    .single()
  if (stateError) throw new Error("EBAY_QUOTA_429_STATE_PERSIST_FAILED")
  const { error: eventError } = await supabase.from("ebay_api_quota_events").insert({
    quota_state_id: state.id,
    api_family: input.apiFamily,
    endpoint: input.endpoint,
    http_status: rateLimit.httpStatus,
    retry_after_seconds: rateLimit.retryAfterSeconds,
    rate_limit_reset_at: resumeAt,
    observed_at: observedAt,
    pause_started_at: observedAt,
    resume_at: resumeAt,
    affected_lane: input.lane,
    checkpoint: input.checkpoint ?? {},
    retry_count: input.retryCount ?? 0,
  })
  if (eventError) throw new Error("EBAY_QUOTA_429_EVENT_PERSIST_FAILED")
  return { ...rateLimit, resumeAt, affectedLane: input.lane }
}

export async function assertEbayLaneAvailable(
  supabase: SupabaseClient,
  apiFamily: string,
  operation: string,
  now = new Date(),
) {
  const { data, error } = await supabase
    .from("ebay_api_quota_states")
    .select("status,reset_at,available_budget,reserved_budget,owner_lane")
    .eq("marketplace", "EBAY_US")
    .eq("api_family", apiFamily)
    .eq("operation", operation)
    .maybeSingle()
  if (error) throw new Error("EBAY_QUOTA_STATE_READ_FAILED")
  if (!data) return { available: true, status: "UNKNOWN", resumeAt: null }
  const reset = Date.parse(data.reset_at ?? "")
  const paused = data.status === "PAUSED_429" && (!Number.isFinite(reset) || reset > now.getTime())
  return {
    available: !paused && (data.available_budget === null || Number(data.available_budget) > 0 || data.status === "UNKNOWN"),
    status: paused ? "PAUSED_429" : data.status,
    resumeAt: paused ? data.reset_at : null,
    ownerLane: data.owner_lane,
    reservedBudget: Number(data.reserved_budget ?? 0),
  }
}
