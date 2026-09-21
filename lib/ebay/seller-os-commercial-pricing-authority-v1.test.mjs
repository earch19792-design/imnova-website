import assert from "node:assert/strict"
import test from "node:test"
import { registerHooks } from "node:module"
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,export default {}", shortCircuit: true }
  if (specifier.startsWith(".") && !/\.(ts|mjs|js|json)$/.test(specifier)) {
    try { return next(`${specifier}.ts`, context) } catch { /* normal resolution */ }
  }
  return next(specifier, context)
} })
const { buildCommercialActiveMarketAuthorityV1: active,
  buildCanonicalAggregateSoldPricingV1: aggregate,
  readCommercialPricingContextV1: readContext } = await import("./seller-os-commercial-pricing-authority-v1.ts")
const { buildCommercialMarketProjectionV1: project,
  buildCommercialDecisionV1: decide } = await import("./seller-os-live-commercial-trace-v1.ts")
const { buildEbaySellerKeywordDemandValidation: validate } = await import("./ebay-seller-keyword-demand-validation.ts")
const { buildLunaPreResearchIdentityKeyV1: identity,
  buildLunaPreResearchProductTruthFingerprintV1: fingerprint } = await import("./luna-pre-research-intake-v1.ts")

const now = new Date("2026-09-21T03:00:00Z")
const digest = (c) => `sha256:${c.repeat(64)}`
function activeRows() {
  return [42, 44, 46].map((price, i) => ({ comparableId: String(300000000000 + i),
    sellerUsername: `seller-${i}`, eligibleComparable: true, pricingAuthorityEligible: true,
    commercialComparableClass: "NEAR_EXACT_PRODUCT", evidenceSource: "EBAY_BROWSE_ACTIVE_LISTING",
    price, shippingCost: 0, salesQuantity: 0, verifiedSoldQuantity: 0,
    activeMarketObservation: { observedAt: now.toISOString(), itemPrice: price - 2,
      shippingPrice: 2, currency: "USD", shippingCurrency: "USD", conditionId: "1000",
      active: true, sponsored: false, sellerUsername: `seller-${i}` } }))
}
function context(demandProven = true) {
  return { demandProven, demandReceipt: demandProven ? { planId: "plan", evidenceDigest: digest("a") } : null,
    aggregateSold: null, readStatus: "CANONICAL_EVIDENCE_READ" }
}
function decision(rows = activeRows(), ctx = context()) {
  const market = { ...project(null, [], [], ctx, now), activeMarketAuthority: active(rows, now) }
  return decide({ supplierCost: 8, shipping: 9.99, claimConflictCount: 0, complianceStatus: "PASS", market })
}
function aggregateFixture() {
  const accountKey = "account"
  const planId = "plan"
  const evidence = [0, 1].map((i) => ({ plan_id: planId, marketplace_account_key: accountKey,
    marketplace: "EBAY_US", item_id: String(300000000000 + i), source_observation_id: `obs-${i}`,
    source_capture_batch_id: "capture", query_provenance_hashes: [digest("e")],
    structural_classification: "EXACT_PRODUCT_COMPARABLE",
    structural_compatibility: { entityCompatible: true, architectureCompatible: true,
      useCompatible: true, explicitCountDifference: false, explicitSizeDifference: false },
    price_evidence: { CUMULATIVE_SALES_VALUE: { status: "PROVEN", amount: 160 + i * 8 },
      QUANTITY_SOLD: { status: "PROVEN", value: 4 }, SHIPPING: { status: "SHIPPING_PRICE", amount: 2 },
      CURRENCY: { status: "PROVEN", value: "USD" },
      PRICE_SOURCE: { cumulative: "PRODUCT_RESEARCH_ITEM_SALES_COLUMN" } },
    seller_evidence: { status: "PROVEN", identityHash: digest(i ? "b" : "a") } }))
  const observations = evidence.map((e, i) => ({ id: e.source_observation_id, capture_batch_id: "capture",
    marketplace_account_key: accountKey, marketplace: "EBAY_US", source_listing_id: e.item_id,
    item_sales: 160 + i * 8, confirmed_sold_quantity: 4, last_sold_date: "2026-09-19T03:00:00Z" }))
  const captures = [{ id: "capture", marketplace_account_key: accountKey, marketplace: "EBAY_US",
    source: "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE", search_query_hash: digest("e"),
    date_range: { start: "2026-08-20", end: "2026-09-20" }, captured_at: now.toISOString() }]
  return { evidence, observations, captures, accountKey, planId, now }
}

test("A: existing verified realized SOLD authority remains first", () => {
  const report = validate({ candidate: { productName: "Rechargeable Facial Device" }, asOf: now,
    comparables: [42, 44].map((price, i) => ({ itemId: String(300000000000 + i),
      title: "Rechargeable Facial Device", price, shippingCost: 2,
      sellerUsername: `seller-${i}`, totalSoldQuantity: 5, lastSoldDate: now.toISOString(),
      source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY" })) })
  const market = project(report, [], [], { ...context(), aggregateSold: aggregate(aggregateFixture()) }, now)
  const result = decide({ supplierCost: 8, shipping: 9.99, claimConflictCount: 0, complianceStatus: "PASS", market })
  assert.equal(result.pricingMode, "SOLD_PRICE_STRONG")
  assert.equal(result.pricingAuthority.realizedSoldPriceStatus, "PROVEN")
})
test("B: exact durable cumulative SOLD value / quantity outranks active pricing", () => {
  const sold = aggregate(aggregateFixture())
  assert.equal(sold.sufficient, true)
  assert.equal(sold.priceRange.median, 43)
  const result = decision(activeRows(), { ...context(), aggregateSold: sold })
  assert.equal(result.pricingMode, "AGGREGATE_SOLD_PRICING")
  assert.equal(result.recommendedPrice, 43)
  assert.equal(result.pricingAuthority.realizedSoldPriceStatus, "UNAVAILABLE")
  assert.equal(result.economics.passesProfitGate, true)
})
test("public SOLD price proof supports A without Insights; quantity alone never does", () => {
  const comparables = [42, 44].map((price, i) => ({ itemId: String(300000000000 + i),
    title: "Rechargeable Facial Device", price, shippingCost: 2,
    sellerUsername: `seller-${i}`, confirmedSoldQuantity: 5, lastSoldDate: now.toISOString(),
    soldHistorySource: "CONFIRMED_DURABLE_SOLD", realizedPriceStatus: "REALIZED_PRICE_CONFIRMED",
    source: "EBAY_BROWSE_ACTIVE_LISTING" }))
  const make = () => project(validate({ candidate: { productName: "Rechargeable Facial Device" },
    comparables, asOf: now }), [], [], context(), now)
  assert.equal(make().pricingEvidenceQuality.strongDecisionAllowed, true)
  comparables.forEach((e) => { e.realizedPriceStatus = "UNPROVEN" })
  assert.equal(make().pricingEvidenceQuality.strongDecisionAllowed, false)
})
test("C: strong demand plus broad fresh active market works with Insights disabled", () => {
  const prior = process.env.EBAY_MARKETPLACE_INSIGHTS_ENABLED
  process.env.EBAY_MARKETPLACE_INSIGHTS_ENABLED = "false"
  try {
    const result = decision()
    assert.equal(result.pricingMode, "MARKET_PRICE_TESTABLE")
    assert.equal(result.recommendedPrice, 44)
    assert.equal(result.economics.passesProfitGate, true)
    assert.equal(result.pricingAuthority.realizedSoldPriceStatus, "UNAVAILABLE")
    assert.equal(result.pricingAuthority.activeMarketPriceStatus, "PROVEN")
    assert.equal(result.pricingAuthority.demandStatus, "PROVEN")
    assert.equal(result.pricingAuthority.pricingConfidence, "MEDIUM")
    assert.equal(result.pricingAuthority.postSalePriceReviewRequired, true)
    assert.equal(result.pricingAuthority.marketplaceInsightsRequired, false)
  } finally {
    if (prior === undefined) delete process.env.EBAY_MARKETPLACE_INSIGHTS_ENABLED
    else process.env.EBAY_MARKETPLACE_INSIGHTS_ENABLED = prior
  }
})
for (const [name, mutate] of [
  ["one seller", (rows) => rows.forEach((e) => { e.activeMarketObservation.sellerUsername = "same" })],
  ["stale active observations", (rows) => rows.forEach((e) => { e.activeMarketObservation.observedAt = "2026-09-01" })],
  ["weak product match", (rows) => rows.forEach((e) => { e.commercialComparableClass = "FUNCTIONAL_COMPARABLE" })],
  ["unknown shipping", (rows) => rows.forEach((e) => { e.activeMarketObservation.shippingPrice = null })],
  ["used condition", (rows) => rows.forEach((e) => { e.activeMarketObservation.conditionId = "3000" })],
  ["sponsored noise", (rows) => rows.forEach((e) => { e.activeMarketObservation.sponsored = true })],
  ["unknown seller", (rows) => rows.forEach((e) => { e.activeMarketObservation.sellerUsername = "Vendedor eBay" })],
  ["brand/identity rejection", (rows) => rows.forEach((e) => { e.pricingAuthorityEligible = false })],
  ["market below floor", (rows) => rows.forEach((e) => { e.activeMarketObservation.itemPrice = 24 })],
  ["ended listing", (rows) => rows.forEach((e) => { e.activeMarketObservation.active = false })],
  ["different shipping currency", (rows) => rows.forEach((e) => { e.activeMarketObservation.shippingCurrency = "EUR" })],
]) test(`${name} remains HOLD`, () => {
  const rows = activeRows(); mutate(rows)
  const result = decision(rows)
  assert.equal(result.pricingMode, "INSUFFICIENT_MARKET_EVIDENCE")
  assert.equal(result.recommendedPrice, null)
  assert.equal(result.economics, null)
  assert.equal(result.finalDecision, "HOLD_PRICING_EVIDENCE_QUALITY")
})
test("insufficient/estimated demand cannot authorize active pricing", () => {
  assert.equal(decision(activeRows(), context(false)).pricingMode, "INSUFFICIENT_MARKET_EVIDENCE")
})
test("deduplicate legacy and REST IDs; duplicates cannot increase breadth", () => {
  const rows = activeRows().slice(0, 2)
  rows.push({ ...rows[0], comparableId: `v1|${rows[0].comparableId}|0` })
  assert.equal(active(rows, now).distribution.sampleSize, 2)
  assert.equal(active(rows, now).sufficient, false)
})
test("explicit paid shipping and free shipping both normalize; never sold", () => {
  const rows = activeRows()
  rows[0].activeMarketObservation.shippingPrice = 0
  const result = active(rows, now)
  assert.equal(result.distribution.minimumLandedPrice, 40)
  assert.equal(result.realizedSoldPriceProven, false)
  assert.ok(result.evidence.every((e) => e.soldQuantity === 0))
})
test("bounded statistics reject excessive spread and do not use high outlier for floor", () => {
  const rows = activeRows()
  rows[0].activeMarketObservation.itemPrice = 20
  rows[1].activeMarketObservation.itemPrice = 21
  rows[2].activeMarketObservation.itemPrice = 400
  assert.equal(decision(rows).pricingMode, "INSUFFICIENT_MARKET_EVIDENCE")
})
for (const [name, mutate] of [
  ["ambiguous legacy average", (f) => f.evidence.forEach((e) => { e.price_evidence.CUMULATIVE_SALES_VALUE.status = "UNPROVEN"; e.legacy_ambiguous_observed_value = 50 })],
  ["wrong account", (f) => { f.accountKey = "other" }],
  ["wrong plan", (f) => { f.planId = "other" }],
  ["stale sold window", (f) => { f.captures[0].date_range.end = "2025-01-01" }],
  ["wrong quantity", (f) => f.observations.forEach((o) => { o.confirmed_sold_quantity = 3 })],
  ["missing seller provenance", (f) => f.evidence.forEach((e) => { e.seller_evidence.status = "UNPROVEN" })],
  ["wrong pack", (f) => f.evidence.forEach((e) => { e.structural_compatibility.explicitCountDifference = true })],
]) test(`aggregate rejects ${name}`, () => {
  const fixture = aggregateFixture(); mutate(fixture)
  assert.equal(aggregate(fixture).sufficient, false)
})

test("canonical demand read is account/product/variant/SKU/truth bound and read-only", async () => {
  const variant = { product_id: "p", variant_id: "v", sku: "SKU", title: "Title", product_type: null, identity_result: { contract: "identity" } }
  const truthHash = fingerprint(variant)
  const key = identity({ productId: "p", variantId: "v", sku: "SKU", productTruthFingerprint: truthHash })
  const plan = { id: "plan", status: "COMPLETED", pre_research_result: "PRE_RESEARCH_HIGH",
    source_candidate_key: key, source_product_truth_fingerprint: truthHash,
    pre_research_trace_eligible: true, pre_research_completed_at: now.toISOString(),
    pre_research_evidence_digest: digest("a"), pre_research_evidence: {
      contractVersion: "LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19", planId: "plan", productId: "p", variantId: "v", sku: "SKU",
      productTruthFingerprint: truthHash, exactComparableCount: 3, acceptedComparableSoldQuantity: 7 } }
  const calls = []
  const supabase = { from(table) {
    calls.push(["from", table])
    return { select() { return this }, eq(...args) { calls.push(args); return this },
      is(...args) { calls.push(args); return this }, order() { return this }, limit() { return this },
      maybeSingle() { return this }, then(resolve) { return Promise.resolve({ data:
        table === "marketplace_product_research_query_plans" ? plan : [], error: null }).then(resolve) } }
  } }
  const result = await readContext({ supabase, accountKey: "account", productTruthRow: variant, now })
  assert.equal(result.demandProven, true)
  for (const pair of [["marketplace_account_key", "account"], ["source_luna_product_id", "p"],
    ["subject_supplier_variant_id", "v"], ["source_supplier_sku", "SKU"],
    ["source_candidate_key", key], ["source_product_truth_fingerprint", truthHash],
    ["pre_research_rerun_cohort_id", null]]) assert.ok(calls.some((value) => JSON.stringify(value) === JSON.stringify(pair)))
  plan.pre_research_evidence.productTruthFingerprint = digest("f")
  assert.equal((await readContext({ supabase, accountKey: "account", productTruthRow: variant, now })).demandProven, false)
})
