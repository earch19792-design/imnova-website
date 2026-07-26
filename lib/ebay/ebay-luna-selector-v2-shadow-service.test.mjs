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
    from(table) {
      assert.equal(table, "ebay_luna_opportunity_queue")
      const state = {
        after: null,
        filters: new Map(),
        limit: rows.length,
        orders: [],
      }
      const query = {
        select() {
          return query
        },
        order(column) {
          state.orders.push(column)
          return query
        },
        limit(value) {
          state.limit = value
          return query
        },
        eq(column, value) {
          state.filters.set(column, value)
          return query
        },
        gt(column, value) {
          assert.equal(column, "candidate_key")
          state.after = value
          return query
        },
        then(resolve, reject) {
          calls.push({
            after: state.after,
            filters: new Map(state.filters),
            limit: state.limit,
            orders: [...state.orders],
          })
          const data = rows
            .filter((row) =>
              (!state.after || row.candidate_key > state.after) &&
              [...state.filters].every(([column, value]) =>
                row[column] === value
              )
            )
            .sort((left, right) =>
              left.candidate_key.localeCompare(right.candidate_key) ||
              left.id.localeCompare(right.id)
            )
            .slice(0, state.limit)
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        },
      }
      return query
    },
  }
}

test("queue pagination is stable and applies only scope columns that exist", async () => {
  const rows = Array.from({ length: 1_002 }, (_, index) => ({
    id: `id-${String(index).padStart(5, "0")}`,
    candidate_key: `candidate-${String(index).padStart(5, "0")}`,
    marketplace_account_key: index === 1_001 ? "OTHER" : "ACCOUNT_A",
    marketplace: "EBAY_US",
  }))
  const supabase = queueSupabase(rows)
  const result = await loadEbayLunaSelectorV2QueueRows({
    supabase,
    accountKey: "ACCOUNT_A",
    marketplace: "EBAY_US",
  })
  assert.equal(result.truncated, false)
  assert.equal(result.rows.length, 1_001)
  assert.deepEqual(result.scopeColumns, {
    account: "marketplace_account_key",
    marketplace: "marketplace",
  })
  assert.ok(supabase.calls.every((call) =>
    call.orders.join(",") === "candidate_key,id"
  ))
  assert.ok(supabase.calls.slice(1).every((call) =>
    call.filters.get("marketplace_account_key") === "ACCOUNT_A" &&
    call.filters.get("marketplace") === "EBAY_US"
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
  const result = await loadEbayLunaSelectorV2QueueRows({
    supabase: queueSupabase(rows),
    accountKey: "ACCOUNT_A",
    marketplace: "EBAY_US",
  })
  assert.equal(result.truncated, true)
  assert.equal(
    result.scannedRows,
    EBAY_LUNA_SELECTOR_V2_MAX_QUEUE_ROWS + 1,
  )
  assert.deepEqual(result.rows, [])
})
