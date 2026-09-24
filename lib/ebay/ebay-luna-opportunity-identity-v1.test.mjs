import assert from "node:assert/strict"
import { test } from "node:test"
import {
  materializeCanonicalLunaOpportunityIdentityV1,
} from "./ebay-luna-opportunity-identity-v1.ts"

const identity = {
  marketplaceId: "EBAY_US",
  supplierProductId: "10211942072544",
  supplierVariantId: "54943494865120",
  supplierSku: "ITEM-8058-RED-LU-DE",
}
const candidateKey = "luna-portex:10211942072544:54943494865120"
const catalog = {
  product_id: "89a189a1-1111-4111-8111-111111111111",
  source_key: "lunaportex",
  supplier_product_id: identity.supplierProductId,
  supplier_variant_id: identity.supplierVariantId,
  sku: identity.supplierSku,
  title: "Source title",
  variant_title: "Red",
  barcode: null,
  price: "2.50",
  available: true,
  inventory_quantity: null,
  captured_at: "2026-09-23T09:02:01.761Z",
}

function fakeClient({ conflict = false } = {}) {
  const calls = []
  let durable = conflict ? {
    id: "11a11111-1111-4111-8111-111111111111",
    candidate_key: candidateKey,
    market_radar_product_id: catalog.product_id,
    supplier_product_id: identity.supplierProductId,
    supplier_variant_id: identity.supplierVariantId,
    supplier_sku: "WRONG-SKU",
    queue_status: "watchlist",
    decision: "IDENTITY_ONLY_SOURCE_VERIFIED",
  } : null
  const client = {
    from(table) {
      calls.push({ table })
      const filters = {}
      return {
        select() { return this },
        eq(name, value) { filters[name] = value; return this },
        async limit() {
          if (table === "market_radar_latest_variants") {
            return { data: [catalog], error: null }
          }
          const match = durable && Object.entries(filters).every(
            ([key, value]) => durable[key] === value)
          return { data: match ? [durable] : [], error: null }
        },
        async upsert(row, options) {
          assert.equal(table, "ebay_luna_opportunity_queue")
          assert.deepEqual(options, {
            onConflict: "candidate_key", ignoreDuplicates: true,
          })
          assert.equal(row.candidate_key, candidateKey)
          assert.equal(row.supplier_sku, identity.supplierSku)
          assert.equal(row.assessment.canonicalIdentityIntakeV1.economicsStatus,
            "UNKNOWN")
          assert.equal(row.estimated_net_profit, undefined)
          durable = { id: "11a11111-1111-4111-8111-111111111111",
            ...row }
          calls.push({ write: table })
          return { error: null }
        },
      }
    },
  }
  return { client, calls }
}

test("exact catalog identity creates only one opportunity", async () => {
  const { client, calls } = fakeClient()
  const result = await materializeCanonicalLunaOpportunityIdentityV1({
    supabase: client, identity,
  })
  assert.equal(result.candidateKey, candidateKey)
  assert.equal(result.identityReadback.supplierSku, identity.supplierSku)
  assert.equal(result.downstreamStagesTriggered, 0)
  assert.deepEqual(calls.filter((call) => call.write), [
    { write: "ebay_luna_opportunity_queue" },
  ])
})

test("candidate key collision fails without a write", async () => {
  const { client, calls } = fakeClient({ conflict: true })
  await assert.rejects(
    materializeCanonicalLunaOpportunityIdentityV1({ supabase: client, identity }),
    /LUNA_OPPORTUNITY_IDENTITY_CONFLICT/,
  )
  assert.equal(calls.some((call) => call.write), false)
})
