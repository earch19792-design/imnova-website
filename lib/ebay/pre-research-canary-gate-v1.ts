import type { SupabaseClient } from "@supabase/supabase-js"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_CANARY_BATCHES = 20

export type PreResearchCanaryGateV1 = Readonly<{
  state: "OFF" | "CANARY" | "INVALID"
  allowedBatchIds: readonly string[]
  allowedBatchCount: number
}>

export function readPreResearchCanaryGateV1(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PreResearchCanaryGateV1 {
  const enabled = env.PRE_RESEARCH_HARDENING_CANARY_ENABLED
  if (enabled === undefined || enabled === "false") {
    return Object.freeze({ state: "OFF", allowedBatchIds: [],
      allowedBatchCount: 0 })
  }
  if (enabled !== "true") {
    return Object.freeze({ state: "INVALID", allowedBatchIds: [],
      allowedBatchCount: 0 })
  }
  const entries = (env.PRE_RESEARCH_HARDENING_CANARY_BATCH_IDS ?? "")
    .split(",").map((value) => value.trim().toLowerCase())
  if (entries.length < 1 || entries.length > MAX_CANARY_BATCHES ||
      entries.some((value) => !UUID.test(value)) ||
      new Set(entries).size !== entries.length) {
    return Object.freeze({ state: "INVALID", allowedBatchIds: [],
      allowedBatchCount: 0 })
  }
  const allowedBatchIds = Object.freeze(entries.sort())
  return Object.freeze({ state: "CANARY", allowedBatchIds,
    allowedBatchCount: allowedBatchIds.length })
}

export async function assertPreResearchCanaryPlanClaimV1(input: Readonly<{
  supabase: SupabaseClient
  planId: string | null
  gate: PreResearchCanaryGateV1
}>) {
  // The canonical claim RPC already excludes batch plans from null-plan queue
  // acquisition. Explicit claims must also be checked before any lease write.
  if (!input.planId) return
  const { data, error } = await input.supabase
    .from("seller_os_pre_research_batch_members_v1")
    .select("batch_id").eq("plan_id", input.planId)
    .limit(MAX_CANARY_BATCHES + 1)
  if (error || !data || data.length > MAX_CANARY_BATCHES) {
    throw new Error("PRE_RESEARCH_CANARY_MEMBERSHIP_UNAVAILABLE")
  }
  if (data.length === 0) return // Unrelated research plan.
  if (input.gate.state !== "CANARY" || data.some((member) =>
    !input.gate.allowedBatchIds.includes(member.batch_id))) {
    throw new Error("PRE_RESEARCH_CANARY_PLAN_NOT_ALLOWED")
  }
}
