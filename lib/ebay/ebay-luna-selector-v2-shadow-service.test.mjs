import assert from "node:assert/strict"
import test from "node:test"

import {
  EBAY_LUNA_SELECTOR_V2_MAX_QUEUE_ROWS,
  getEbayLunaSelectorV2ShadowConfiguration,
  loadEbayLunaSelectorV2QueueRows,
  normalizeEbayLunaSelectorV2QueueRow,
} from "./ebay-luna-selector-v2-shadow-service.ts"
import {
  evaluateEbayLunaSelectorCandidateV2,
} from "./ebay-luna-selector-v2-domain.ts"

test("shadow selector remains disabled by default and always blocked in Production", () => {
  assert.equal(getEbayLunaSelectorV2ShadowConfiguration({}).enabled, false)
  assert.equal(getEbayLunaSelectorV2ShadowConfiguration({
    VERCEL_ENV: "preview",
    EBAY_LUNA_SELECTOR_V2_SHADOW_ENABLED: "true",
  }).enabled, true)
  const production = getEbayLunaSelectorV2ShadowConfiguration({
    VERCEL_ENV: "production",
    EBAY_LUNA_SELECTOR_V2_SHADOW_ENABLED: "true",
  })
  assert.equal(production.enabled, false)
  assert.equal(production.productionBlocked, true)
  assert.equal(production.ebayWritesAllowed, false)
})

test("legacy estimated quantities cannot be normalized as confirmed sold evidence", () => {
  const normalized = normalizeEbayLunaSelectorV2QueueRow({
    candidate_key: "candidate-1",
    product_id: "product-1",
    family_key: "family-1",
    evidence_class: "ACTIVE_ONLY",
    estimated_sold_quantity: 500,
    seller_count: 100,
    demand_score: 100,
  })
  assert.equal(normalized.demand.evidenceClass, "ACTIVE_ONLY")
  assert.equal(normalized.demand.soldExactUnits, null)
  assert.equal(normalized.demand.soldExactSellerCount, null)
  const evaluation = evaluateEbayLunaSelectorCandidateV2(normalized)
  assert.equal(evaluation.readyToList, false)
  assert.equal(evaluation.ebayDemandScore, 0)
})

test("unknown fields remain unknown instead of becoming confirmed zeroes", () => {
  const normalized = normalizeEbayLunaSelectorV2QueueRow({
    candidate_key: "candidate-2",
    product_id: "product-2",
  })
  assert.equal(normalized.supplier.numericStock, null)
  assert.equal(normalized.supplier.costUsd, null)
  assert.equal(normalized.demand.soldExactUnits, null)
  assert.equal(normalized.demand.evidenceClass, "INSUFFICIENT_EVIDENCE")
})

function queueSupabase(rows) {
  const calls = []
  return {
    calls,
    rpc(functionName, parameters) {
      assert.equal(
        functionName,
        "read_eligible_ebay_luna_opportunities_v2",
      )
      calls.push({ functionName, parameters: { ...parameters } })
      return Promise.resolve({
        data: rows.slice(
          parameters.p_offset,
          parameters.p_offset + parameters.p_limit,
        ),
        error: null,
      })
    },
  }
}

test("queue pagination uses the scoped RPC with stable offsets", async () => {
  const rows = Array.from({ length: 1_002 }, (_, index) => ({
    id: `id-${String(index).padStart(5, "0")}`,
    candidate_key: `candidate-${String(index).padStart(5, "0")}`,
  }))
  const supabase = queueSupabase(rows)
  const result = await loadEbayLunaSelectorV2QueueRows({
    supabase,
    accountKey: "ACCOUNT_A",
    marketplace: "EBAY_US",
  })
  assert.equal(result.truncated, false)
  assert.equal(result.rows.length, 1_002)
  assert.deepEqual(result.scopeColumns, {
    account: "marketplace_account_key",
    marketplace: "marketplace",
  })
  assert.deepEqual(
    supabase.calls.map((call) => call.parameters.p_offset),
    [0, 1_000],
  )
  assert.ok(supabase.calls.every((call) =>
    call.parameters.p_account_key === "ACCOUNT_A" &&
    call.parameters.p_marketplace === "EBAY_US" &&
    call.parameters.p_limit === 1_000
  ))
})

test("queue overflow is explicit and fail-closed", async () => {
  const rows = Array.from(
    { length: EBAY_LUNA_SELECTOR_V2_MAX_QUEUE_ROWS + 1 },
    (_, index) => ({
      id: `id-${String(index).padStart(6, "0")}`,
      candidate_key: `candidate-${String(index).padStart(6, "0")}`,
    }),
  )
  const supabase = queueSupabase(rows)
  const result = await loadEbayLunaSelectorV2QueueRows({
    supabase,
    accountKey: "ACCOUNT_A",
    marketplace: "EBAY_US",
  })
  assert.equal(result.truncated, true)
  assert.equal(
    result.scannedRows,
    EBAY_LUNA_SELECTOR_V2_MAX_QUEUE_ROWS + 1,
  )
  assert.deepEqual(result.rows, [])
  assert.deepEqual(
    supabase.calls.at(-1)?.parameters,
    {
      p_account_key: "ACCOUNT_A",
      p_marketplace: "EBAY_US",
      p_limit: 1,
      p_offset: EBAY_LUNA_SELECTOR_V2_MAX_QUEUE_ROWS,
    },
  )
})
