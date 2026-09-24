import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(specifier)) {
    try { return nextResolve(`${specifier}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const { evaluateCommercialTraceConservativePrelistingV1 } = await import(
  "./commercial-trace-conservative-prelisting-v1.ts")
const { evaluateEbayUsNoStoreConservativeFeeV1,
  readEbayUsNoStoreFvfPolicyV1,
  resolveEbayUsNoStoreFvfPolicyV1 } = await import(
  "./ebay-us-no-store-fvf-policy-v1.ts")
const { resolveCommercialTraceOwnerPricePolicyV1 } = await import(
  "./commercial-trace-owner-price-policy-v1.ts")
const bounds = (await import(
  "../../docs/ebay-prelisting-owner-conservative-fee-policy-v1.json",
  { with: { type: "json" } })).default
const now = new Date("2026-09-23T22:10:00Z")
const account = bounds.marketplaceAccountKey
const categoryId = "179239"
const ancestry = { status: "PROVEN", source: "EBAY_TAXONOMY_EXACT_CATEGORY_ANCESTRY_V1",
  marketplace: "EBAY_US", categoryId, treeVersion: "fixture-only",
  digest: "a".repeat(64),
  path: "Clothing, Shoes & Accessories:Men:Men's Accessories:Sunglasses & Sunglasses Accessories",
  ancestorIds: ["11450", "1059", "4250"],
  observedAt: "2026-09-23T21:35:00Z", freshUntil: "2026-09-23T23:35:00Z" }
const policy = await readEbayUsNoStoreFvfPolicyV1(now)
const category = resolveEbayUsNoStoreFvfPolicyV1({ accountKey: account,
  categoryId, categoryAuthority: ancestry, policy, now })
const owner = resolveCommercialTraceOwnerPricePolicyV1({
  marketplaceAccountKey: account, lunaProductId: "fixture-product",
  lunaVariantId: "fixture-variant", supplierSku: "fixture-sku",
  sourceFingerprint: "fixture-source", now })
const domesticFixture = { status: "PROVEN_EXACT", marketplace: "EBAY_US",
  marketplaceAccountKey: account, buyerRegisteredCountry: "US",
  deliveryCountry: "US", internationalFeeStatus: "NOT_APPLICABLE",
  source: "SYNTHETIC_TEST_ONLY_NOT_REAL_BUYER_PROOF",
  observedAt: "2026-09-23T21:35:00Z",
  freshUntil: "2026-09-23T23:35:00Z" }
const serviceZeroFixture = { status: "PROVEN_ZERO",
  marketplaceAccountKey: account, categoryId, ratePct: 0,
  source: "EBAY_CURRENT_CATEGORY_SERVICE_METRICS",
  observedAt: "2026-09-23T21:35:00Z",
  freshUntil: "2026-09-23T23:35:00Z" }
const feeAtPrice = (price, serviceMetricsAuthority = serviceZeroFixture) =>
  evaluateEbayUsNoStoreConservativeFeeV1({
  policyAuthority: category, itemPrice: price, buyerShipping: 0, handling: 0,
  otherBuyerCharges: 0, otherSellerFeesAuthority: {
    status: "NOT_APPLICABLE", amountUsd: 0, marketplaceAccountKey: account,
    baseFvfIncluded: false, perOrderFeeIncluded: false,
    serviceMetricsFeeIncluded: false, buyerDependentFeeIncluded: false,
    categoryId, source: "SYNTHETIC_NO_OTHER_SELLER_FEES",
    observedAt: "2026-09-23T21:35:00Z",
    freshUntil: "2026-09-23T23:35:00Z" },
  boundPolicy: bounds, domesticScenarioAuthority: domesticFixture,
  serviceMetricsAuthority, now })
const finalAuthority = (changes = {}) => ({ marketplaceAccountKey: account,
  salePrice: 30, marketSupportedTargetPrice: 30,
  productCost: { status: "PROVEN", amountUsd: 5 },
  shippingQty1: { status: "PROVEN", amountUsd: 2 },
  fulfillmentAuthority: { status: "PROVEN", amountUsd: 0 },
  ownerPolicyAuthority: { status: "PROVEN" },
  promotedListingsPolicy: { state: "NOT_APPLICABLE", amountUsd: 0,
    ratePercent: 0 },
  returnsReservePolicy: { state: "CONFIGURED", amountUsd: 1.2,
    ratePercent: 4 },
  otherExplicitCostsPolicy: { state: "NOT_APPLICABLE", amountUsd: 0,
    ratePercent: 0 },
  marketPricingAuthority: { sufficient: true }, ...changes })
const evaluate = (changes = {}, ownerPolicy = owner,
  quote = feeAtPrice) => evaluateCommercialTraceConservativePrelistingV1({
  finalAuthority: finalAuthority(changes), ownerPolicy,
  categoryId, feeAtPrice: quote })

test("synthetic complete authority passes 5 / 20% / 30% gates under conservative costs", () => {
  assert.equal(owner.status, "PROVEN")
  assert.equal(owner.profitabilityGates.minNetProfit, 5)
  assert.equal(owner.profitabilityGates.minNetMarginPercent, 20)
  assert.equal(owner.profitabilityGates.minRoiPercent, 30)
  const result = evaluate()
  assert.equal(result.prelistingPriceSafe, true)
  assert.equal(result.prelistingSafePrice, 30)
  assert.equal(result.realizedFeeExact, false)
  assert.ok(result.netProfitUnderBound >= 5)
  assert.ok(result.netMarginUnderBound >= 20)
  assert.ok(result.roiUnderBound >= 30)
  assert.ok(result.economicFloor > 10)
  assert.equal(result.returnsReserve, 1.2)
  assert.equal(result.promotedListingsCost, 0)
  assert.equal(result.profitabilityGate.gatePass, true)
})

test("missing owner buyer reserve, fulfillment, or market authority never returns safe price", () => {
  const missingBuyerReserve = evaluate({}, owner, (price) =>
    evaluateEbayUsNoStoreConservativeFeeV1({ policyAuthority: category,
      itemPrice: price, buyerShipping: 0, handling: 0,
      otherBuyerCharges: 0, otherSellerFeesAuthority: {
        status: "NOT_APPLICABLE", amountUsd: 0,
        marketplaceAccountKey: account, categoryId,
        baseFvfIncluded: false, perOrderFeeIncluded: false,
        serviceMetricsFeeIncluded: false, buyerDependentFeeIncluded: false,
        source: "SYNTHETIC_NO_OTHER_SELLER_FEES",
        observedAt: "2026-09-23T21:35:00Z",
        freshUntil: "2026-09-23T23:35:00Z" },
      boundPolicy: { ...bounds, buyerDependentFeeReserve: {
        ...bounds.buyerDependentFeeReserve, approvedByOwner: false } },
      domesticScenarioAuthority: domesticFixture,
      serviceMetricsAuthority: serviceZeroFixture, now }))
  assert.equal(missingBuyerReserve.prelistingPriceSafe, false)
  assert.equal(missingBuyerReserve.prelistingSafePrice, null)
  assert.equal(evaluate({ fulfillmentAuthority: { status: "UNKNOWN",
    amountUsd: null } }).prelistingPriceSafe, false)
  assert.equal(evaluate({ marketPricingAuthority: { sufficient: false } })
    .prelistingPriceSafe, false)
})

test("profit, margin and ROI policy gates each reject a failing candidate", () => {
  const profit = evaluate({ productCost: { status: "PROVEN", amountUsd: 20 } })
  assert.equal(profit.profitabilityGate.gatePass, false)
  assert.equal(profit.prelistingPriceSafe, false)
  const margin = evaluate({}, { ...owner, profitabilityGates: {
    ...owner.profitabilityGates, minNetMarginPercent: 90 } })
  assert.equal(margin.profitabilityGate.gatePass, false)
  const roi = evaluate({}, { ...owner, profitabilityGates: {
    ...owner.profitabilityGates, minRoiPercent: 500 } })
  assert.equal(roi.profitabilityGate.gatePass, false)
})

test("profitability gate includes the 6% unresolved-Service-Metrics reserve", () => {
  const atTwenty = { salePrice: 20, marketSupportedTargetPrice: 20,
    productCost: { status: "PROVEN", amountUsd: 8 } }
  const zero = evaluate(atTwenty)
  const bounded = evaluate(atTwenty, owner,
    (price) => feeAtPrice(price, null))
  assert.equal(zero.profitabilityGate.gatePass, true)
  assert.equal(bounded.profitabilityGate.gatePass, false)
  assert.equal(bounded.prelistingPriceSafe, false)
  assert.equal(bounded.serviceMetricsReserve, 1.2)
  assert.equal(bounded.buyerDependentFeeReserve.amountUsd, 0.5)
})

test("floor re-evaluates the fee at each price including the $10 jump", () => {
  const seen = []
  const result = evaluate({}, owner, (price) => {
    seen.push(price)
    return feeAtPrice(price)
  })
  assert.equal(result.prelistingPriceSafe, true)
  assert.ok(seen.includes(10))
  assert.ok(seen.includes(10.01))
  assert.equal(feeAtPrice(10).perOrderFee, 0.3)
  assert.equal(feeAtPrice(10.01).perOrderFee, 0.4)
})
