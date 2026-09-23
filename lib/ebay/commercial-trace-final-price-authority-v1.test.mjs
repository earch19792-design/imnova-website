import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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

const { evaluateCommercialTraceFinalPriceV1 } = await import(
  "./commercial-trace-final-price-authority-v1.ts")
const { resolveCommercialTraceOwnerPricePolicyV1 } = await import(
  "./commercial-trace-owner-price-policy-v1.ts")
const now = new Date("2026-09-23T20:00:00Z")
const d = (value) => `sha256:${value.repeat(64)}`
const account = "imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12"
const identity = { marketplaceAccountKey: account,
  lunaProductId: "9220832493792", lunaVariantId: "48809643540704",
  supplierSku: "ITEM-8049-ORA-LU-DE", sourceFingerprint: d("a"),
  fieldTruthEvidenceDigest: d("b") }
const packageId = "11111111-1111-4111-8111-111111111111"
const packageRevision = d("c")
const source = "https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822"
const feeTypes = ["FINAL_VALUE_PERCENT", "PER_ORDER", "SELLER_PERFORMANCE",
  "SERVICE_METRICS", "INTERNATIONAL", "CURRENCY_CONVERSION",
  "REGULATORY_OPERATING", "TAX_ON_FEES"]

function fixture() {
  const components = feeTypes.map((type) => ({ type,
    status: "NOT_APPLICABLE", amount: 0, source,
    sourceVersion: "SYNTHETIC_TEST_ONLY", reference: `fixture:${type}`,
    applicabilityEvidence: "synthetic fixture" }))
  Object.assign(components[0], { status: "PROVEN", amount: 4.6,
    ratePct: 9.2, basisAmount: 50 })
  Object.assign(components[1], { status: "PROVEN", amount: 0.4 })
  return { ...identity, salePrice: 50, categoryId: "synthetic-category",
    now,
    productCost: { ...identity, status: "PROVEN", amountUsd: 10,
      source: "LUNA_FIELD_PRODUCT_TRUTH_V1", evidenceDigest: d("d"),
      observedAt: "2026-09-23T17:00:00Z",
      freshUntil: "2026-09-23T23:00:00Z" },
    shippingQty1: { ...identity, status: "PROVEN", amountUsd: 4,
      quantity: 1, currency: "USD",
      canonicalDestinationMatch: true, noPurchase: true,
      noCredentials: true, destinationProfileDigest: d("5"),
      durableReceiptId: "22222222-2222-4222-8222-222222222222",
      evidenceDigest: d("e"),
      acquisitionMethod: "LUNA_AUTHENTICATED_HTTP_CART_SHIPPING",
      observedAt: "2026-09-23T17:00:00Z",
      freshUntil: "2026-09-23T23:00:00Z" },
    fee: { itemId: null, packageId, packageRevision,
      sku: identity.supplierSku,
      packageIdentity: { ...identity, packageId, packageRevision },
      floorFeeIntervalBound: { status: "PROVEN",
        method: "OFFICIAL_INTERVAL_MAXIMUM", marketplaceAccountKey: account,
        categoryId: "synthetic-category", packageId, packageRevision,
        supplierSku: identity.supplierSku, minimumPrice: 0,
        maximumPrice: 50, maximumFeeUsd: 5, source,
        sourceVersion: "SYNTHETIC_TEST_ONLY", reference: "synthetic-interval",
        evidenceDigest: d("4"), observedAt: "2026-09-23T17:00:00Z",
        freshUntil: "2026-09-23T23:00:00Z" },
      metadata: { feeAuthorityV1: {
        contractVersion: "SELLER_OS_LISTING_FEE_AUTHORITY_V1",
        evidenceClass: "PRE_SALE_FEE_ESTIMATE",
        marketplaceAccountKey: account, marketplace: "EBAY_US",
        itemId: null, packageId, packageRevision, sku: identity.supplierSku,
        categoryId: "synthetic-category",
        storeContextReference: "synthetic-store",
        accountContextReference: "synthetic-account",
        source, sourceVersion: "SYNTHETIC_TEST_ONLY",
        reference: "synthetic-fee-authority",
        observedAt: "2026-09-23T17:00:00Z",
        freshUntil: "2026-09-23T23:00:00Z",
        amount: 5, components,
        feeBasis: { status: "PROVEN", reference: "synthetic-bound",
          amount: 50, salePrice: 50, method: "PROVEN_UPPER_BOUND",
          coveredComponents: ["ITEM_PRICE", "BUYER_SHIPPING",
            "HANDLING", "BUYER_TAX"], adBasisCovered: true },
      } } },
    ownerPolicy: {
      contractVersion: "SELLER_OS_COMMERCIAL_TRACE_OWNER_PRICE_POLICY_V1",
      marketplace: "EBAY_US", marketplaceAccountKey: account,
      status: "PROVEN", currency: "USD",
      policyVersion: "SYNTHETIC_TEST_ONLY",
      source: "OWNER_CERTIFIED_ACCOUNT_PRICE_POLICY_V1",
      approvedByOwner: true,
      authorizationReferenceDigest: d("f"),
      effectiveAt: "2026-09-23T16:00:00Z", freshUntil: null,
      promotedListings: { state: "CONFIGURED", ratePercent: 5,
        basis: "SALE_PRICE",
        reason: "synthetic promotion reserve",
        provenance: "synthetic owner fixture" },
      returnsReserve: { state: "CONFIGURED", ratePercent: 4,
        basis: "SALE_PRICE",
        reason: "synthetic returns reserve",
        provenance: "synthetic owner fixture" },
      otherExplicitCosts: { state: "NOT_APPLICABLE",
        reason: "synthetic no other costs",
        provenance: "synthetic owner fixture" },
      profitabilityGates: { state: "CONFIGURED",
        provenance: "synthetic owner fixture", minNetProfit: 5,
        minNetMarginPercent: 20, minRoiPercent: 30 },
    },
    fulfillment: { ...identity, marketplace: "EBAY_US",
      status: "PROVEN", restrictionStatus: "UNRESTRICTED",
      restrictionSource: "OWNER_PRODUCT_SPECIFIC_FULFILLMENT_REVIEW_V1",
      restrictionEvidenceDigest: d("1"),
      observedAt: "2026-09-23T17:00:00Z",
      freshUntil: "2026-09-23T23:00:00Z",
      serviceCostAuthority: { status: "NOT_APPLICABLE",
        reason: "SUPPLIER_QTY1_SHIPPING_COVERS_FULFILLMENT",
        source: "OWNER_CERTIFIED_DIRECT_SUPPLIER_FULFILLMENT_V1",
        evidenceDigest: d("2") } },
    marketPricing: { sufficient: true,
      marketSupportedTargetPrice: 50,
      pricingMode: "SOLD_PRICE_STRONG" },
  }
}
const evalPrice = (change = {}) => evaluateCommercialTraceFinalPriceV1({
  ...fixture(), ...change })
const ownerPolicy = (extra = {}) => resolveCommercialTraceOwnerPricePolicyV1({
  ...identity, now, ...extra })
const approved = (extra = {}) => evalPrice({ ownerPolicy: ownerPolicy(extra) })

test("all synthetic authorities close complete economics; no real account claim", () => {
  const result = evalPrice()
  assert.equal(result.status, "PROVEN")
  assert.equal(result.priceAuthorized, true)
  assert.equal(result.finalAuthorizedPrice, 50)
  assert.equal(result.preListingFeeAuthority.status, "PROVEN")
  assert.equal(result.economics.ebayVariableFee, 4.6)
  assert.equal(result.economics.ebayFixedFee, 0.4)
  assert.equal(result.economics.totalCosts, 23.5)
  assert.equal(result.economics.netProfit, 26.5)
  assert.equal(result.economics.netMarginPercent, 53)
  assert.equal(result.economics.roiPercent, 265)
  assert.equal(result.profitabilityGate.gatePass, true)
  assert.ok(result.economicFloor < result.marketSupportedTargetPrice)
})

test("shipping proven but fee missing fails closed", () => {
  const result = evalPrice({ fee: null })
  assert.equal(result.priceAuthorized, false)
  assert.equal(result.finalAuthorizedPrice, null)
  assert.equal(result.preListingFeeAuthority.status, "MISSING")
  const stale = evalPrice({ fee: { status: "STALE" } })
  assert.equal(stale.preListingFeeAuthority.status, "STALE")
  assert.equal(stale.finalAuthorizedPrice, null)
})

test("promotion UNKNOWN and returns UNKNOWN each fail closed", () => {
  for (const key of ["promotedListings", "returnsReserve"]) {
    const input = fixture()
    input.ownerPolicy[key] = { state: "UNKNOWN" }
    const result = evaluateCommercialTraceFinalPriceV1(input)
    assert.equal(result.priceAuthorized, false)
    assert.equal(result.finalAuthorizedPrice, null)
    assert.equal(result[key === "promotedListings" ?
      "promotedListingsPolicy" : "returnsReservePolicy"].amountUsd, null)
  }
})

test("restricted item needs allowed service and exact real service cost", () => {
  const input = fixture()
  input.fulfillment.restrictionStatus = "RESTRICTED"
  input.fulfillment.allowedCarrier = "USPS"
  input.fulfillment.allowedService = "USPS_GROUND_ADVANTAGE"
  input.fulfillment.selectedCarrier = "USPS"
  input.fulfillment.selectedService = "USPS_GROUND_ADVANTAGE"
  assert.equal(evaluateCommercialTraceFinalPriceV1(input).priceAuthorized, false)
  input.fulfillment.serviceCostAuthority = { status: "PROVEN",
    allowedCarrier: "USPS", allowedService: "USPS_GROUND_ADVANTAGE",
    quantity: 1, currency: "USD", destinationProfileDigest: d("5"),
    amountUsd: 5, source: "SUPPLIER_ALLOWED_SERVICE_QUOTE_V1",
    evidenceDigest: d("3"), observedAt: "2026-09-23T17:00:00Z",
    freshUntil: "2026-09-23T23:00:00Z" }
  const proven = evaluateCommercialTraceFinalPriceV1(input)
  assert.equal(proven.fulfillmentAuthority.status, "PROVEN")
  assert.equal(proven.economics.fulfillmentCost, 5)
  assert.equal(proven.priceAuthorized, true)
  input.fulfillment.selectedService = "UPS_AIR"
  assert.equal(evaluateCommercialTraceFinalPriceV1(input).priceAuthorized, false)
})

test("absence of a product warning does not certify unrestricted fulfillment", () => {
  const result = evalPrice({ fulfillment: null })
  assert.equal(result.fulfillmentAuthority.restrictionStatus, "UNKNOWN")
  assert.equal(result.fulfillmentAuthority.amountUsd, null)
  assert.equal(result.priceAuthorized, false)
  assert.equal(result.finalAuthorizedPrice, null)
})

test("profitability failure and market insufficiency each block", () => {
  const low = fixture(); low.salePrice = 50
  low.ownerPolicy.profitabilityGates.minNetProfit = 30
  assert.equal(evaluateCommercialTraceFinalPriceV1(low).priceAuthorized, false)
  const market = fixture(); market.marketPricing.sufficient = false
  assert.equal(evaluateCommercialTraceFinalPriceV1(market).priceAuthorized, false)
})

test("estimated shipping 6.99 and estimated fee never supply final authority", () => {
  const shipping = fixture(); shipping.shippingQty1 = {
    status: "ESTIMATED", amountUsd: 6.99 }
  const result = evaluateCommercialTraceFinalPriceV1(shipping)
  assert.equal(result.priceAuthorized, false)
  assert.equal(result.finalAuthorizedPrice, null)
  // A universal 15.3% + $0.40 preview is not exact category/account authority.
  const fee = fixture(); fee.fee = { estimatedFee: 8.05 }
  assert.equal(evaluateCommercialTraceFinalPriceV1(fee).preListingFeeAuthority.status,
    "ESTIMATED")
  assert.equal(evaluateCommercialTraceFinalPriceV1(fee).finalAuthorizedPrice,
    null)
})

test("stale shipping, fee and owner policy fail closed", () => {
  const shipping = fixture()
  shipping.shippingQty1.freshUntil = "2026-09-23T17:59:00Z"
  assert.equal(evaluateCommercialTraceFinalPriceV1(shipping).priceAuthorized, false)
  const fee = fixture()
  fee.fee.metadata.feeAuthorityV1.freshUntil = "2026-09-23T17:59:00Z"
  assert.equal(evaluateCommercialTraceFinalPriceV1(fee).preListingFeeAuthority.status,
    "STALE")
  const policy = fixture()
  policy.ownerPolicy.freshUntil = "2026-09-23T17:59:00Z"
  const result = evaluateCommercialTraceFinalPriceV1(policy)
  assert.equal(result.promotedListingsPolicy.state, "UNKNOWN")
  assert.equal(result.priceAuthorized, false)
})

test("raw policy bypass cannot authorize without validated OWNER provenance", () => {
  const defaultPolicy = JSON.parse(readFileSync(
    "docs/commercial-trace-owner-price-policy-v1.json", "utf8"))
  const result = evalPrice({ ownerPolicy: defaultPolicy })
  assert.equal(result.promotedListingsPolicy.state, "UNKNOWN")
  assert.equal(result.returnsReservePolicy.state, "UNKNOWN")
  assert.equal(result.otherExplicitCostsPolicy.state, "UNKNOWN")
  assert.equal(result.priceAuthorized, false)
})

test("approved OWNER policy is account-scoped, durable and has exact gates", () => {
  const policy = ownerPolicy()
  assert.equal(policy.status, "PROVEN")
  assert.equal(policy.currency, "USD")
  assert.equal(policy.policyVersion, "OWNER_PRICE_POLICY_V1_20260923")
  assert.equal(policy.profitabilityGates.minNetProfit, 5)
  assert.equal(policy.profitabilityGates.minNetMarginPercent, 20)
  assert.equal(policy.profitabilityGates.minRoiPercent, 30)
  assert.equal(policy.returnsReserve.ratePercent, 4)
  assert.equal(policy.promotedListings.state, "NOT_APPLICABLE")
  assert.equal(policy.otherExplicitCosts.state, "NOT_APPLICABLE")
  assert.equal(ownerPolicy({ marketplaceAccountKey: "wrong-account" }).status,
    "UNKNOWN")
  assert.equal(ownerPolicy({ now: new Date("2026-09-23T18:00:00Z") }).status,
    "UNKNOWN")
  const tampered = JSON.parse(readFileSync(
    "docs/commercial-trace-owner-price-policy-v1.json", "utf8"))
  tampered.returnsReserve.rateFraction = 0.05
  assert.equal(ownerPolicy({ policy: tampered }).status, "UNKNOWN")
})

test("approved reserve is 4%, opt-in default is explicit zero, all gates pass", () => {
  const result = approved()
  assert.equal(result.ownerPolicyAuthority.status, "PROVEN")
  assert.equal(result.returnsReservePolicy.amountUsd, 2)
  assert.equal(result.promotedListingsPolicy.state, "NOT_APPLICABLE")
  assert.equal(result.promotedListingsPolicy.amountUsd, 0)
  assert.equal(result.otherExplicitCostsPolicy.state, "NOT_APPLICABLE")
  assert.equal(result.otherExplicitCostsPolicy.amountUsd, 0)
  assert.equal(result.economics.promotedListingsCost, 0)
  assert.equal(result.economics.returnsReserve, 2)
  assert.equal(result.economics.totalCosts, 21)
  assert.equal(result.profitabilityGate.gatePass, true)
  assert.equal(result.priceAuthorized, true)
})

test("exact product promotion opt-in applies only its approved rate", () => {
  const proof = { ...identity, status: "PROVEN",
    source: "OWNER_EXPLICIT_PROMOTION_OPT_IN_V1", rateFraction: 0.07,
    evidenceDigest: d("7"), observedAt: "2026-09-23T19:00:00Z",
    freshUntil: "2026-09-23T23:00:00Z" }
  const result = approved({ promotionOptIn: proof })
  assert.equal(result.promotedListingsPolicy.state, "CONFIGURED")
  assert.equal(result.promotedListingsPolicy.amountUsd, 3.5)
  assert.equal(result.economics.promotedListingsCost, 3.5)
  const missingRate = approved({ promotionOptIn: { ...proof,
    rateFraction: null } })
  assert.equal(missingRate.priceAuthorized, false)
  assert.equal(missingRate.promotedListingsPolicy.state, "UNKNOWN")
  assert.equal(approved({ promotionOptIn: { ...proof,
    supplierSku: "OTHER-SKU" } }).priceAuthorized, false)
})

test("discovered extra cost must be exact and proven; UNKNOWN is not zero", () => {
  const unknown = approved({ additionalCostEvidence: { status: "UNKNOWN" } })
  assert.equal(unknown.otherExplicitCostsPolicy.state, "UNKNOWN")
  assert.equal(unknown.priceAuthorized, false)
  const proof = { ...identity, status: "PROVEN",
    source: "OWNER_EXPLICIT_OTHER_COST_V1", amountUsd: 1.25,
    evidenceDigest: d("8"), observedAt: "2026-09-23T19:00:00Z",
    freshUntil: "2026-09-23T23:00:00Z" }
  assert.equal(approved({ additionalCostEvidence: proof })
    .economics.otherExplicitCosts, 1.25)
})

test("OWNER profit, margin and ROI thresholds fail closed", () => {
  for (const [cost, metric, threshold] of [
    [36, "actualNetProfit", 5],
    [30, "actualNetMarginPercent", 20],
    [35, "actualRoiPercent", 30],
  ]) {
    const input = fixture()
    input.ownerPolicy = ownerPolicy()
    input.productCost.amountUsd = cost
    const result = evaluateCommercialTraceFinalPriceV1(input)
    assert.ok(result.profitabilityGate[metric] < threshold)
    assert.equal(result.profitabilityGate.gatePass, false)
    assert.equal(result.finalAuthorizedPrice, null)
  }
})

test("unverified sources and active-only market evidence cannot mint authority", () => {
  const owner = fixture()
  owner.ownerPolicy.source = "SYNTHETIC_UNVERIFIED_POLICY"
  assert.equal(evaluateCommercialTraceFinalPriceV1(owner).priceAuthorized, false)
  const fulfillment = fixture()
  fulfillment.fulfillment.restrictionSource = "CATEGORY_INFERENCE"
  assert.equal(evaluateCommercialTraceFinalPriceV1(fulfillment).priceAuthorized,
    false)
  const supplierCost = fixture()
  supplierCost.productCost.source = "CHAT_VALUE"
  assert.equal(evaluateCommercialTraceFinalPriceV1(supplierCost).priceAuthorized,
    false)
  const market = fixture()
  market.marketPricing.pricingMode = "MARKET_PRICE_TESTABLE"
  assert.equal(evaluateCommercialTraceFinalPriceV1(market).priceAuthorized,
    false)
})

test("exact-target fee alone cannot fabricate an economic floor", () => {
  const input = fixture()
  delete input.fee.floorFeeIntervalBound
  const result = evaluateCommercialTraceFinalPriceV1(input)
  assert.equal(result.preListingFeeAuthority.status, "PROVEN")
  assert.equal(result.economicFloor, null)
  assert.equal(result.finalAuthorizedPrice, null)
  assert.ok(result.blockers.includes("ECONOMIC_FLOOR_FEE_INTERVAL_UNPROVEN"))
})

test("other required costs UNKNOWN never become zero", () => {
  const input = fixture()
  input.ownerPolicy.otherExplicitCosts = { state: "UNKNOWN" }
  const result = evaluateCommercialTraceFinalPriceV1(input)
  assert.equal(result.otherExplicitCostsPolicy.amountUsd, null)
  assert.equal(result.economics, null)
  assert.equal(result.priceAuthorized, false)
})

test("cross-account, cross-SKU or unbound fee package cannot authorize", () => {
  for (const mutate of [
    (input) => { input.ownerPolicy.marketplaceAccountKey = "other-account" },
    (input) => { input.shippingQty1.supplierSku = "OTHER-SKU" },
    (input) => { input.fee.packageIdentity.packageRevision = d("6") },
  ]) {
    const input = fixture()
    mutate(input)
    assert.equal(evaluateCommercialTraceFinalPriceV1(input).priceAuthorized,
      false)
  }
})

test("stale fulfillment or fee interval authority blocks a final price", () => {
  const fulfillment = fixture()
  fulfillment.fulfillment.freshUntil = "2026-09-23T17:59:00Z"
  assert.equal(evaluateCommercialTraceFinalPriceV1(fulfillment).priceAuthorized,
    false)
  const interval = fixture()
  interval.fee.floorFeeIntervalBound.freshUntil = "2026-09-23T17:59:00Z"
  assert.equal(evaluateCommercialTraceFinalPriceV1(interval).economicFloor, null)
  assert.equal(evaluateCommercialTraceFinalPriceV1(interval).priceAuthorized,
    false)
})

test("unsupported destination service or missing destination proof blocks", () => {
  const input = fixture()
  input.shippingQty1.destinationProfileDigest = null
  assert.equal(evaluateCommercialTraceFinalPriceV1(input).priceAuthorized, false)
})
