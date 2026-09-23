import assert from "node:assert/strict"
import test from "node:test"
import { assertPreResearchCanaryPlanClaimV1,
  readPreResearchCanaryGateV1 } from "./pre-research-canary-gate-v1.ts"

const a = "30000000-0000-4000-8000-000000000001"
const b = "30000000-0000-4000-8000-000000000002"
const planId = "70000000-0000-4000-8000-000000000001"
const on = (ids) => readPreResearchCanaryGateV1({
  PRE_RESEARCH_HARDENING_CANARY_ENABLED: "true",
  PRE_RESEARCH_HARDENING_CANARY_BATCH_IDS: ids,
})

function supabaseWithMembers(batchIds, error = null) {
  return { from(table) {
    assert.equal(table, "seller_os_pre_research_batch_members_v1")
    return { select(column) {
      assert.equal(column, "batch_id")
      return { eq(field, value) {
        assert.equal(field, "plan_id")
        assert.equal(value, planId)
        return { async limit(size) {
          assert.equal(size, 21)
          return { data: batchIds.map((batch_id) => ({ batch_id })), error }
        } }
      } }
    } }
  } }
}

test("OFF is default-safe and does not interpret an allowlist", () => {
  assert.deepEqual(readPreResearchCanaryGateV1({}), {
    state: "OFF", allowedBatchIds: [], allowedBatchCount: 0,
  })
  assert.equal(readPreResearchCanaryGateV1({
    PRE_RESEARCH_HARDENING_CANARY_ENABLED: "false",
    PRE_RESEARCH_HARDENING_CANARY_BATCH_IDS: a,
  }).state, "OFF")
})

test("valid multiple batch IDs are deterministic and duplicate/malformed input fails safe", () => {
  assert.deepEqual(on(`${b}, ${a}`), {
    state: "CANARY", allowedBatchIds: [a, b], allowedBatchCount: 2,
  })
  for (const value of ["", "garbage", `${a},`, `${a},${a}`,
    Array(21).fill(a).join(",")]) {
    assert.deepEqual(on(value), {
      state: "INVALID", allowedBatchIds: [], allowedBatchCount: 0,
    })
  }
  assert.equal(readPreResearchCanaryGateV1({
    PRE_RESEARCH_HARDENING_CANARY_ENABLED: "TRUE",
    PRE_RESEARCH_HARDENING_CANARY_BATCH_IDS: a,
  }).state, "INVALID")
})

test("explicit claim allows only batch plans whose every membership is allowlisted", async () => {
  const gate = on(a)
  await assertPreResearchCanaryPlanClaimV1({
    supabase: supabaseWithMembers([a]), planId, gate,
  })
  await assert.rejects(assertPreResearchCanaryPlanClaimV1({
    supabase: supabaseWithMembers([b]), planId, gate,
  }), /PRE_RESEARCH_CANARY_PLAN_NOT_ALLOWED/)
  await assert.rejects(assertPreResearchCanaryPlanClaimV1({
    supabase: supabaseWithMembers([a, b]), planId, gate,
  }), /PRE_RESEARCH_CANARY_PLAN_NOT_ALLOWED/)
  await assertPreResearchCanaryPlanClaimV1({
    supabase: supabaseWithMembers([a, b]), planId, gate: on(`${b},${a}`),
  })
  await assertPreResearchCanaryPlanClaimV1({
    supabase: supabaseWithMembers([]), planId, gate: on(""),
  }) // Unrelated nonbatch research is unaffected.
  await assert.rejects(assertPreResearchCanaryPlanClaimV1({
    supabase: supabaseWithMembers([a]), planId, gate: on(""),
  }), /PRE_RESEARCH_CANARY_PLAN_NOT_ALLOWED/)
  await assert.rejects(assertPreResearchCanaryPlanClaimV1({
    supabase: supabaseWithMembers([], { code: "DB_UNAVAILABLE" }),
    planId, gate,
  }), /PRE_RESEARCH_CANARY_MEMBERSHIP_UNAVAILABLE/)
})
