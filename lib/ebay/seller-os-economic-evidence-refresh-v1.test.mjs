import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const domain = await import("../seller-os/economic-evidence-refresh-v1.ts")

const accountKey = "imnova-ebay-main:0123456789abcdef"
const itemId = "366643122092"
const now = "2026-09-06T10:00:00.000Z"

function fresh(type, value, idSuffix) {
  return {
    evidence_id: `economic-evidence-v1:sha256:${idSuffix.repeat(64)}`,
    evidence_type: type,
    value_amount: value,
    fresh_until: "2026-09-06T12:00:00.000Z",
    freshness_status: "FRESH",
  }
}

test("unknown economic inputs remain null and never become false zero", () => {
  const result = domain.calculateLiveEconomicsV1({ accountKey, itemId,
    calculatedAt: now,
    evidence: { EBAY_LIVE_PRICE: fresh("EBAY_LIVE_PRICE", 22.98, "1") } })
  assert.equal(result.status, "PARTIAL")
  assert.equal(result.live_price, 22.98)
  assert.equal(result.luna_cost, null)
  assert.equal(result.luna_shipping, null)
  assert.equal(result.expected_ebay_fee, null)
  assert.equal(result.other_explicit_costs, null)
  assert.equal(result.expected_profit, null)
  assert.deepEqual(result.missing_economic_inputs, [
    "LUNA_CURRENT_COST", "LUNA_CURRENT_SHIPPING", "EXPECTED_EBAY_FEE",
    "OTHER_EXPLICIT_COSTS",
  ])
})

test("fresh proven inputs recompute LIVE-price economics independently of market", () => {
  const result = domain.calculateLiveEconomicsV1({ accountKey, itemId,
    calculatedAt: now, evidence: {
      EBAY_LIVE_PRICE: fresh("EBAY_LIVE_PRICE", 22.98, "1"),
      LUNA_CURRENT_COST: fresh("LUNA_CURRENT_COST", 5, "2"),
      LUNA_CURRENT_SHIPPING: fresh("LUNA_CURRENT_SHIPPING", 6.99, "3"),
      EXPECTED_EBAY_FEE: fresh("EXPECTED_EBAY_FEE", 3.8, "4"),
      OTHER_EXPLICIT_COSTS: fresh("OTHER_EXPLICIT_COSTS", 1.2, "5"),
    } })
  assert.equal(result.status, "PROVEN")
  assert.equal(result.expected_profit, 5.99)
  assert.equal(result.margin_percent, 26.0661)
  assert.equal(result.roi_percent, 45.4132)
  assert.equal(result.market_price_status, "UNPROVEN")
  assert.equal(result.price_position_status, "POR_COMPROBAR")
})

test("stale input invalidates dependent economics without erasing evidence", () => {
  const stale = { ...fresh("LUNA_CURRENT_COST", 5, "2"),
    fresh_until: "2026-09-06T09:59:59.000Z" }
  assert.equal(domain.evidenceIsFreshV1(stale, Date.parse(now)), false)
  const result = domain.calculateLiveEconomicsV1({ accountKey, itemId,
    calculatedAt: now, evidence: { LUNA_CURRENT_COST: stale } })
  assert.equal(result.luna_cost, null)
  assert.ok(result.missing_economic_inputs.includes("LUNA_CURRENT_COST"))
})

test("one stable job key exists per listing and authority", () => {
  const input = { accountKey, marketplaceId: "EBAY_US", itemId,
    evidenceType: "LUNA_CURRENT_SHIPPING" }
  assert.equal(domain.economicRefreshJobKeyV1(input),
    domain.economicRefreshJobKeyV1({ ...input }))
  assert.notEqual(domain.economicRefreshJobKeyV1(input),
    domain.economicRefreshJobKeyV1({ ...input,
      evidenceType: "LUNA_CURRENT_COST" }))
})

test("migration and runtime enforce durable lease, retry, readback and no marketplace write", () => {
  const migration = readFileSync(
    "supabase/migrations/20260906095925_seller_os_economic_evidence_refresh_v1.sql",
    "utf8")
  const runtime = readFileSync(
    "lib/seller-os/economic-evidence-refresh-runtime-v1.ts", "utf8")
  const integrity = readFileSync(
    "lib/seller-os/operational-integrity-runtime-v1.ts", "utf8")
  const shipping = readFileSync(
    "lib/ebay/ebay-luna-chrome-shipping-capture-server-v1.ts", "utf8")
  assert.match(migration, /unique \(marketplace_account_key, marketplace_id, ebay_item_id, evidence_type\)/)
  assert.match(migration, /for update skip locked/)
  assert.match(migration, /next_retry_at/)
  assert.match(migration, /seller_os_live_economics_readbacks_v1/)
  assert.match(runtime, /getEbayCommercialMonitorLiveReadonly/)
  assert.match(runtime, /fetchPublicLunaProductForActiveListingMonitor/)
  assert.match(runtime, /captureLiveListingShippingEvidenceV1/)
  assert.match(runtime, /calculateLiveEconomicsV1/)
  assert.match(runtime, /activeLease \? "REFRESHING"/)
  assert.match(runtime, /lease_expires_at/)
  assert.match(integrity, /runSellerOsEconomicEvidenceRefreshV1/)
  assert.match(shipping, /acquireEconomicLiveListingShippingJobsV1/)
  assert.match(shipping, /tryPersistEconomicLiveListingShippingCaptureV1/)
  assert.match(runtime, /marketplaceWrites: 0 as const/)
})
