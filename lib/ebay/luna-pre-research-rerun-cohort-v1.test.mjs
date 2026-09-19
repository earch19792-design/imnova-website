import assert from "node:assert/strict"
import test from "node:test"
import { registerHooks } from "node:module"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const rerun = await import("./luna-pre-research-rerun-cohort-v1.ts")
const intake = await import("./luna-pre-research-intake-v1.ts")

const SNAPSHOT = "11111111-1111-4111-8111-111111111111"
const COHORT = "22222222-2222-4222-8222-222222222222"
const OTHER_COHORT = "33333333-3333-4333-8333-333333333333"
const CONTRACT = "LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19"
const golden = [
  ["8028", "18028", "ITEM-8028-PIN-LU-DE", "Pink Butterfly Memorial Necklace", "Necklace", "necklace pink butterfly memorial"],
  ["8042", "18042", "ITEM-8042-HIG-LU-DE", "High-Quality Silver Dragonfly Necklace", "Necklace", "necklace silver dragonfly"],
  ["8043", "18043", "ITEM-8043-SIM-LU-DE", "Simple Opal Heartshaped Earrings", "Earrings", "earrings opal heart"],
  ["8031", "18031", "ITEM-8031-RED-LU-DE", "Red Bow Rhinestone Mouse Stud Earrings", "Earrings", "earrings red bow mouse"],
  ["8046", "18046", "ITEM-8046-✨WO-LU-DE", "Women’s Fashionable Pearl Bracelet", "Bracelet", "bracelet pearl women"],
]

const rows = golden.map(([productId, variantId, sku, title, family, exact], index) => ({
  snapshot_id: SNAPSHOT,
  product_id: productId,
  variant_id: variantId,
  sku,
  title,
  product_type: family,
  source_fingerprint: `sha256:${String(index + 1).repeat(64).slice(0, 64)}`,
  observed_at: "2026-09-19T12:00:00.000Z",
  preflight_status: "PREFLIGHT_PASS",
  identity_result: {
    version: "SELLER_OS_STRUCTURED_PRODUCT_IDENTITY_V1_3",
    productFamily: `JEWELRY_${family.toUpperCase()}`,
    canonicalFamilyPhrase: family,
    formFactors: [], audience: null, color: null,
    functionalDifferentiators: [], identitySufficient: true,
    insufficiencyReasons: [], evidence: [],
    queryPlan: { exactStrong: exact, nearExactFamily: exact,
      functionalFamily: family.toLowerCase(),
      broadFallback: family.toLowerCase(),
      progression: [exact, family.toLowerCase()] },
  },
}))

const adminValidation = Object.freeze({
  ok: true,
  status: 200,
  error: null,
  userId: "44444444-4444-4444-8444-444444444444",
  authenticationMode: "admin_user",
  accessRole: "OWNER_ADMIN",
})

function normalPlanFor(row, index) {
  const productTruthFingerprint =
    intake.buildLunaPreResearchProductTruthFingerprintV1(row)
  const sourceCandidateKey = intake.buildLunaPreResearchIdentityKeyV1({
    productId: row.product_id, variantId: row.variant_id, sku: row.sku,
    productTruthFingerprint,
  })
  return {
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    // Historical plans intentionally retain the pre-query-fix input hash.
    input_hash: `sha256:${String(index + 6).repeat(64).slice(0, 64)}`,
    source_candidate_key: sourceCandidateKey,
    source_product_truth_fingerprint: productTruthFingerprint,
    pre_research_rerun_cohort_id: null,
  }
}

function fakeSupabase() {
  const normalPlans = new Map(rows.map((row, index) => {
    const plan = normalPlanFor(row, index)
    return [plan.source_candidate_key, plan]
  }))
  const cohorts = new Map()
  const rpcCalls = []
  return {
    rpcCalls,
    from(table) {
      const filters = new Map()
      const builder = {
        select() { return this },
        eq(field, value) { filters.set(field, value); return this },
        is(field, value) { filters.set(field, value); return this },
        order() { return this },
        limit() {
          const data = table === "luna_catalog_snapshot_variants_v1"
            ? rows.filter((row) => row.snapshot_id === filters.get("snapshot_id") &&
              row.product_id === filters.get("product_id") &&
              row.variant_id === filters.get("variant_id"))
            : table === "marketplace_product_research_query_plans"
              ? [normalPlans.get(filters.get("source_candidate_key"))].filter(Boolean)
              : []
          return Promise.resolve({ data, error: null })
        },
      }
      return builder
    },
    async rpc(name, args) {
      assert.equal(name,
        "create_or_reuse_luna_pre_research_rerun_cohort_v1")
      rpcCalls.push(args)
      const existing = cohorts.get(args.p_cohort_id)
      if (existing) {
        if (existing.p_reason_code !== args.p_reason_code ||
            existing.p_membership_digest !== args.p_membership_digest ||
            existing.p_actor_subject !== args.p_actor_subject ||
            existing.p_actor_client_id !== args.p_actor_client_id) {
          return { data: null, error: { code: "REPLAY_MISMATCH" } }
        }
        return { data: { cohortCreated: false, newPlanCount: 0,
          existingPlanCount: existing.p_members.length,
          plans: existing.p_members.map((member) => ({
            productId: member.product_id, planId: member.rerun_plan_id,
            created: false,
          })) }, error: null }
      }
      cohorts.set(args.p_cohort_id, structuredClone(args))
      return { data: { cohortCreated: true,
        newPlanCount: args.p_members.length, existingPlanCount: 0,
        plans: args.p_members.map((member) => ({
          productId: member.product_id, planId: member.rerun_plan_id,
          created: true,
        })) }, error: null }
    },
  }
}

const candidates = rows.map((row) => ({ productId: row.product_id,
  variantId: row.variant_id, sku: row.sku }))

test("cohort input hash is deterministic, cohort-specific, and leaves source identity unchanged", () => {
  const baseInputHash = intake.buildLunaPreResearchQueryPayloadV1(rows[0])
    .inputHash
  const first = rerun.buildLunaPreResearchRerunInputHashV1({ baseInputHash,
    rerunCohortId: COHORT, contractVersion: CONTRACT })
  const replay = rerun.buildLunaPreResearchRerunInputHashV1({ baseInputHash,
    rerunCohortId: COHORT, contractVersion: CONTRACT })
  const changed = rerun.buildLunaPreResearchRerunInputHashV1({ baseInputHash,
    rerunCohortId: OTHER_COHORT, contractVersion: CONTRACT })
  assert.equal(first, replay)
  assert.notEqual(first, changed)
  assert.notEqual(baseInputHash, normalPlanFor(rows[0], 0).input_hash)
  assert.equal(normalPlanFor(rows[0], 0).source_candidate_key,
    intake.buildLunaPreResearchIdentityKeyV1({ productId: rows[0].product_id,
      variantId: rows[0].variant_id, sku: rows[0].sku,
      productTruthFingerprint:
        intake.buildLunaPreResearchProductTruthFingerprintV1(rows[0]) }))
})

test("five-member golden cohort creates five plans and exact replay creates zero", async () => {
  const supabase = fakeSupabase()
  const request = { supabase, accountKey: "account-golden", adminValidation,
    rerunCohortId: COHORT, snapshotId: SNAPSHOT,
    reasonCode: "GOLDEN_PILOT_V2_FRESH_EXECUTION",
    expectedContractVersion: CONTRACT, candidates }
  const first = await rerun.requestControlledLunaPreResearchRerunV1(request)
  const replay = await rerun.requestControlledLunaPreResearchRerunV1(request)
  assert.equal(first.maximumMembers, 5)
  assert.equal(first.newPlanCount, 5)
  assert.equal(first.existingPlanCount, 0)
  assert.equal(replay.newPlanCount, 0)
  assert.equal(replay.existingPlanCount, 5)
  assert.equal(supabase.rpcCalls[0].p_actor_subject, adminValidation.userId)
  assert.equal(supabase.rpcCalls[0].p_actor_client_id,
    "SELLER_OS_ADMIN_PRE_RESEARCH_CONTROLLED_RERUN_V1")
  assert.equal(supabase.rpcCalls[0].p_members.length, 5)
  for (const member of supabase.rpcCalls[0].p_members) {
    const historical = normalPlansForAssertion().get(member.source_candidate_key)
    assert.ok(historical)
    assert.equal(member.prior_plan_id, historical.id)
    assert.equal(member.prior_plan_input_hash, historical.input_hash)
    assert.notEqual(member.base_input_hash, historical.input_hash)
    assert.notEqual(member.rerun_plan_id, historical.id)
  }
})

test("different authorized cohorts create distinct executions for unchanged Product Truth", async () => {
  const supabase = fakeSupabase()
  const base = { supabase, accountKey: "account-golden", adminValidation,
    snapshotId: SNAPSHOT, reasonCode: "CONTROLLED_POLICY_REVALIDATION",
    expectedContractVersion: CONTRACT, candidates: [candidates[0]] }
  const first = await rerun.requestControlledLunaPreResearchRerunV1({
    ...base, rerunCohortId: COHORT,
  })
  const second = await rerun.requestControlledLunaPreResearchRerunV1({
    ...base, rerunCohortId: OTHER_COHORT,
  })
  assert.equal(first.newPlanCount, 1)
  assert.equal(second.newPlanCount, 1)
  assert.equal(supabase.rpcCalls[0].p_members[0].source_candidate_key,
    supabase.rpcCalls[1].p_members[0].source_candidate_key)
  assert.notEqual(supabase.rpcCalls[0].p_members[0].execution_input_hash,
    supabase.rpcCalls[1].p_members[0].execution_input_hash)
})

function normalPlansForAssertion() {
  return new Map(rows.map((row, index) => {
    const plan = normalPlanFor(row, index)
    return [plan.source_candidate_key, plan]
  }))
}

test("same cohort rejects reason or membership drift and bounds membership at ten", async () => {
  const supabase = fakeSupabase()
  const request = { supabase, accountKey: "account-golden", adminValidation,
    rerunCohortId: COHORT, snapshotId: SNAPSHOT,
    reasonCode: "GOLDEN_PILOT_V2_FRESH_EXECUTION",
    expectedContractVersion: CONTRACT, candidates }
  await rerun.requestControlledLunaPreResearchRerunV1(request)
  await assert.rejects(() => rerun.requestControlledLunaPreResearchRerunV1({
    ...request, reasonCode: "CHANGED_REASON",
  }), /RERUN_COHORT_PERSIST_FAILED/)
  await assert.rejects(() => rerun.requestControlledLunaPreResearchRerunV1({
    ...request, candidates: Array.from({ length: 11 }, (_, index) => ({
      productId: String(index + 1), variantId: String(index + 1),
      sku: `ITEM-${index + 1}`,
    })),
  }), /RERUN_REQUEST_BOUNDS_INVALID/)
})
