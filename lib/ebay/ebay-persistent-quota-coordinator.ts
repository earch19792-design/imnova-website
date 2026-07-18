import type { SupabaseClient } from "@supabase/supabase-js"

import { getEbayReadonlyRateLimitMetadata } from "./ebay-readonly-rate-limit"
// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
import { evaluateEbayQuotaLaneState } from "./ebay-quota-lane-domain.ts"

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
    retry_after_source: rateLimit.retryAfterSource,
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
    .select("id,status,reset_at,available_budget,reserved_budget,owner_lane,last_refreshed_at")
    .eq("marketplace", "EBAY_US")
    .eq("api_family", apiFamily)
    .eq("operation", operation)
    .maybeSingle()
  if (error) throw new Error("EBAY_QUOTA_STATE_READ_FAILED")
  if (!data) return { available: true, status: "UNKNOWN", resumeAt: null }
  const decision = evaluateEbayQuotaLaneState(data, now)
  if (!decision.available && decision.status === "PAUSED_429") {
    const { data: event } = await supabase
      .from("ebay_api_quota_events")
      .select("http_status,retry_after_seconds,retry_after_source,observed_at,resume_at,affected_lane")
      .eq("quota_state_id", data.id)
      .eq("resume_at", data.reset_at)
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    return {
      ...decision,
      httpStatus: event?.http_status === 429 ? 429 as const : 429 as const,
      retryAfterSeconds: event?.retry_after_seconds ?? null,
      retryAfterSource: event?.retry_after_source ?? "UNAVAILABLE",
      observedAt: event?.observed_at ?? data.last_refreshed_at ?? now.toISOString(),
      resumeAt: event?.resume_at ?? decision.resumeAt,
      affectedLane: event?.affected_lane ?? decision.ownerLane,
    }
  }
  if (decision.resetReached) {
    // The first request after eBay's authorized reset may probe the lane once.
    // A new 429 will persist a new pause; a successful request resumes normal work.
    await supabase.from("ebay_api_quota_states").update({
      status: "UNKNOWN",
      reset_at: null,
      last_refreshed_at: now.toISOString(),
      updated_at: now.toISOString(),
    }).eq("marketplace", "EBAY_US")
      .eq("api_family", apiFamily)
      .eq("operation", operation)
    return {
      available: true,
      status: "RESET_REACHED",
      resumeAt: null,
      ownerLane: decision.ownerLane,
      reservedBudget: decision.reservedBudget,
    }
  }
  return decision
}
