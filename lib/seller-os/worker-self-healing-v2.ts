import type { SupabaseClient } from "@supabase/supabase-js"

export const SELLER_OS_WORKER_RESILIENCE_VERSION_V2 =
  "SELLER_OS_WORKER_RESILIENCE_AND_SELF_HEALING_V2"

export type SellerOsWorkerFailureClassV2 =
  | "TRANSIENT"
  | "SESSION"
  | "TASK_DATA"
  | "ENGINEERING"

export type SellerOsBrowserRecoveryStageV2 =
  | "WAIT_RENDER_CHECK"
  | "REFRESH_PAGE"
  | "RECREATE_TAB_SESSION"
  | "RESTART_BROWSER_WORKER"
  | "QUARANTINE_TASK"

const FAILURE_RULES = Object.freeze([
  Object.freeze({ failureClass: "SESSION" as const,
    expression: /(SESSION_REQUIRED|SESSION_EXPIRED|LOGIN_REQUIRED|UNAUTHORIZED|AUTH_REQUIRED)/ }),
  Object.freeze({ failureClass: "TASK_DATA" as const,
    expression: /(NO_COMPARABLE|INSUFFICIENT_MARKET_EVIDENCE|PRODUCT_TRUTH_INCOMPLETE|CANDIDATE_DATA_INCOMPLETE)/ }),
  Object.freeze({ failureClass: "ENGINEERING" as const,
    expression: /(PLAN_ATTACHMENT_MISSING|SCHEMA|INVARIANT|IDENTITY_MISMATCH|RESULT_INVALID)/ }),
  Object.freeze({ failureClass: "TRANSIENT" as const,
    expression: /(TIMEOUT|VISIBLE_TABLE_NOT_FOUND|REQUEST_FAILED|NETWORK|CONNECTION_RESET|PAGE_STILL_LOADING|CONTENT_SCRIPT_MISSING|SOURCE_FORMAT_CHANGED)/ }),
])

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function safeCode(value: unknown) {
  const code = typeof value === "string" ? value.trim() : ""
  return /^[A-Z0-9_]{3,180}$/.test(code)
    ? code : "PRODUCT_RESEARCH_UNCLASSIFIED_FAILURE"
}

function integer(value: unknown) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

export function classifySellerOsWorkerFailureV2(
  errorCode: unknown,
): SellerOsWorkerFailureClassV2 {
  const code = safeCode(errorCode)
  return FAILURE_RULES.find((rule) => rule.expression.test(code))
    ?.failureClass ?? "ENGINEERING"
}

export function nextSellerOsBrowserRecoveryStageV2(
  visibleTableFailureCount: number,
): SellerOsBrowserRecoveryStageV2 {
  const count = Math.max(1, Math.trunc(visibleTableFailureCount))
  if (count === 1) return "WAIT_RENDER_CHECK"
  if (count === 2) return "REFRESH_PAGE"
  if (count === 3) return "RECREATE_TAB_SESSION"
  if (count === 4) return "RESTART_BROWSER_WORKER"
  return "QUARANTINE_TASK"
}

export function sellerOsWorkerCircuitStateV2(input: Readonly<{
  consecutiveFingerprintCount: number
  canaryPassed: boolean
}>) {
  if (input.canaryPassed) return Object.freeze({ state: "CLOSED" as const,
    consumptionAllowed: true, threshold: 10 })
  const count = integer(input.consecutiveFingerprintCount)
  return Object.freeze({
    state: count >= 10 ? "OPEN" as const : "CLOSED" as const,
    consumptionAllowed: count < 10,
    threshold: 10,
  })
}

export async function readSellerOsWorkerResilienceV2(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
}>) {
  const response = await input.supabase.rpc(
    "read_seller_os_worker_resilience_v2", {
      p_marketplace_account_key: input.accountKey,
    })
  if (response.error) throw new Error("SELLER_OS_WORKER_RESILIENCE_READ_FAILED")
  const result = record(response.data)
  if (result.contractVersion !== SELLER_OS_WORKER_RESILIENCE_VERSION_V2 ||
      result.marketplaceWrites !== 0 || result.commercialDecisionWrites !== 0) {
    throw new Error("SELLER_OS_WORKER_RESILIENCE_READBACK_INVALID")
  }
  return Object.freeze(result)
}

export async function reconcileSellerOsWorkerStuckWorkV2(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  workerId: string
}>) {
  const response = await input.supabase.rpc(
    "reconcile_seller_os_worker_stuck_work_v2", {
      p_marketplace_account_key: input.accountKey,
      p_worker_id: input.workerId,
    })
  if (response.error) throw new Error("SELLER_OS_WORKER_RECONCILER_FAILED")
  const result = record(response.data)
  if (result.marketplaceWrites !== 0) {
    throw new Error("SELLER_OS_WORKER_RECONCILER_READBACK_INVALID")
  }
  return Object.freeze(result)
}

export async function recordSellerOsWorkerProgressV2(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  workerId: string
  planId: string
  stage: "PENDING" | "CLAIMED" | "RUNNING" | "COMPLETED"
}>) {
  const response = await input.supabase.rpc(
    "record_seller_os_worker_progress_v2", {
      p_marketplace_account_key: input.accountKey,
      p_worker_id: input.workerId,
      p_plan_id: input.planId,
      p_stage: input.stage,
      p_code_version: SELLER_OS_WORKER_RESILIENCE_VERSION_V2,
    })
  if (response.error) throw new Error("SELLER_OS_WORKER_PROGRESS_WRITE_FAILED")
  const result = record(response.data)
  if (result.stage !== input.stage || result.planId !== input.planId ||
      result.marketplaceWrites !== 0) {
    throw new Error("SELLER_OS_WORKER_PROGRESS_READBACK_FAILED")
  }
  return Object.freeze(result)
}

export async function releaseSellerOsProductResearchFailureV2(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  workerId: string
  planId: string
  errorCode: unknown
}>) {
  const errorCode = safeCode(input.errorCode)
  const response = await input.supabase.rpc(
    "release_seller_os_product_research_failure_v2", {
      p_marketplace_account_key: input.accountKey,
      p_plan_id: input.planId,
      p_worker_id: input.workerId,
      p_error_code: errorCode,
      p_code_version: SELLER_OS_WORKER_RESILIENCE_VERSION_V2,
    })
  if (response.error) throw new Error("MAYEL_RESEARCH_WORKER_RELEASE_FAILED")
  const result = record(response.data)
  if (result.released !== true || result.planId !== input.planId ||
      result.marketplaceWrites !== 0 ||
      result.failureClass !== classifySellerOsWorkerFailureV2(errorCode)) {
    throw new Error("SELLER_OS_WORKER_FAILURE_READBACK_INVALID")
  }
  return Object.freeze(result)
}
