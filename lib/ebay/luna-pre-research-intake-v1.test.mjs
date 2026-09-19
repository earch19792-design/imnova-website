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

const {
  LUNA_PRE_RESEARCH_INTAKE_V1,
  LUNA_PRE_RESEARCH_POLICY_VERSION_V1,
  buildLunaPreResearchIdentityKeyV1,
  buildLunaPreResearchProductTruthFingerprintV1,
  classifyLunaPreResearchDispositionV1,
  requestLunaPreResearchV1,
} = await import("./luna-pre-research-intake-v1.ts")

const row = {
  snapshot_id: "11111111-1111-4111-8111-111111111111",
  product_id: "123", variant_id: "456", sku: "ITEM456",
  title: "Women Leather Backpack", product_type: "Backpacks",
  source_fingerprint: "sha256:" + "a".repeat(64),
  observed_at: "2026-09-15T12:00:00.000Z", preflight_status: "PREFLIGHT_PASS",
  identity_result: {
    version: "SELLER_OS_STRUCTURED_PRODUCT_IDENTITY_V1_3",
    productFamily: "GENERIC_BACKPACK_WITH_FORM_FACTOR",
    canonicalFamilyPhrase: "Leather Backpack",
    formFactors: ["backpack"], audience: "WOMEN", color: null,
    receiverSize: null, pinDiameter: null, dimensions: null, edgeFeature: null,
    sizeDescriptor: null, functionalDifferentiators: [],
    identitySufficient: true, insufficiencyReasons: [], evidence: [
      { field: "MATERIAL", value: "leather", source: "LUNA_PRODUCT_TITLE",
        rule: "EXPLICIT_TITLE_ATTRIBUTE" },
    ],
    queryPlan: { exactStrong: "women leather backpack",
      nearExactFamily: "women leather backpack",
      functionalFamily: "leather backpack", broadFallback: "leather backpack",
      progression: ["women leather backpack", "leather backpack"] },
  },
}

function fakeSupabase(sourceRow = row) {
  let calls = 0
  let lastArgs = null
  return {
    get rpcCalls() { return calls },
    get rpcArgs() { return lastArgs },
    from() {
      let single = false
      const builder = {
        select() { return this }, eq() { return this }, limit() { return this },
        maybeSingle() { single = true; return this },
        then(resolve) {
          return Promise.resolve({ data: single ? sourceRow : [sourceRow], error: null })
            .then(resolve)
        },
      }
      return builder
    },
    async rpc(name, args) {
      assert.equal(name, "create_or_reuse_luna_pre_research_plan_v1")
      calls += 1
      lastArgs = args
      assert.equal(args.p_pre_research_policy_version,
        LUNA_PRE_RESEARCH_POLICY_VERSION_V1)
      return { data: { planId: "22222222-2222-4222-8222-222222222222",
        created: calls === 1, pendingTaskCount: 1 }, error: null }
    },
  }
}

test("identity key binds product, variant, SKU, truth, and policy", () => {
  const truth = buildLunaPreResearchProductTruthFingerprintV1(row)
  const first = buildLunaPreResearchIdentityKeyV1({ productId: "123",
    variantId: "456", sku: "ITEM456", productTruthFingerprint: truth })
  const changed = buildLunaPreResearchIdentityKeyV1({ productId: "123",
    variantId: "456", sku: "ITEM456", productTruthFingerprint: "sha256:" + "b".repeat(64) })
  assert.match(truth, /^sha256:[0-9a-f]{64}$/)
  assert.match(first, /^sha256:[0-9a-f]{64}$/)
  assert.notEqual(first, changed)
})

test("preflight dispositions fail closed outside PREFLIGHT_PASS", () => {
  assert.deepEqual(classifyLunaPreResearchDispositionV1({
    preflightStatus: "PREFLIGHT_PASS",
  }), { disposition: "PRE_RESEARCH_ELIGIBLE", researchAllowed: true })
  assert.equal(classifyLunaPreResearchDispositionV1({
    preflightStatus: "SEMANTIC_IDENTITY_INCOMPLETE",
  }).disposition, "IDENTITY_RESCUE_PRIORITY")
  assert.equal(classifyLunaPreResearchDispositionV1({
    preflightStatus: "CONTRADICTED",
  }).disposition, "QUARANTINE")
})

test("bounded intake reuses the durable idempotency identity on retry", async () => {
  const supabase = fakeSupabase()
  const input = { supabase, accountKey: "account-test", snapshotId: row.snapshot_id,
    candidates: [{ productId: "123", variantId: "456", sku: "ITEM456" }] }
  const first = await requestLunaPreResearchV1(input)
  const second = await requestLunaPreResearchV1(input)
  assert.equal(first.contractVersion, LUNA_PRE_RESEARCH_INTAKE_V1)
  assert.equal(first.results[0].idempotencyKey, second.results[0].idempotencyKey)
  assert.equal(first.results[0].researchCreated, true)
  assert.equal(second.results[0].researchCreated, false)
  assert.equal(supabase.rpcCalls, 2)
  assert.ok(supabase.rpcArgs.p_queries.every((query) =>
    query.search_query.includes("leather") && query.search_query.includes("backpack")))
})

test("PREFLIGHT_PASS uses the authoritative structured query plan", async () => {
  const sourceRow = { ...row,
    title: "Pink Butterfly Memorial Necklace – My Mind Still Talks to You Silver Chain, 21 Inches",
    identity_result: {
      ...row.identity_result, productFamily: "JEWELRY_NECKLACE",
      canonicalFamilyPhrase: "Necklace", formFactors: ["butterfly"],
      audience: null, color: "PINK", functionalDifferentiators: ["memorial"],
      evidence: [], queryPlan: { exactStrong: "necklace pink butterfly memorial",
        nearExactFamily: "necklace pink", functionalFamily: "necklace memorial",
        broadFallback: "necklace", progression: ["necklace pink butterfly memorial",
          "necklace pink", "necklace memorial", "necklace"] },
    } }
  const supabase = fakeSupabase(sourceRow)
  await requestLunaPreResearchV1({ supabase, accountKey: "account-test",
    snapshotId: sourceRow.snapshot_id,
    candidates: [{ productId: "123", variantId: "456", sku: "ITEM456" }] })
  const queries = supabase.rpcArgs.p_queries.map((query) => query.search_query)
  assert.ok(queries.length > 0)
  assert.ok(queries.every((query) => /\bnecklace\b/.test(query)))
  assert.doesNotMatch(queries.join(" | "), /21 inches you chain|you chain inches/)
})

test("intake bounds candidate batches before any persistence call", async () => {
  const supabase = fakeSupabase()
  await assert.rejects(() => requestLunaPreResearchV1({ supabase,
    accountKey: "account-test", snapshotId: row.snapshot_id,
    candidates: Array.from({ length: 11 }, (_, index) => ({
      productId: String(index + 1), variantId: String(index + 1), sku: `SKU${index + 1}`,
    })) }), /LUNA_PRE_RESEARCH_REQUEST_BOUNDS_INVALID/)
  assert.equal(supabase.rpcCalls, 0)
})
