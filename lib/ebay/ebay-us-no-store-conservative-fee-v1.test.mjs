import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"
import bounds from "../../docs/ebay-prelisting-owner-conservative-fee-policy-v1.json" with { type: "json" }
import canaryCategories from "../../docs/ebay-prelisting-canary-category-probe-v1.json" with { type: "json" }

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(specifier)) {
    try { return nextResolve(`${specifier}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const { readEbayUsNoStoreFvfPolicyV1, resolveEbayUsNoStoreFvfPolicyV1,
  evaluateEbayUsNoStoreConservativeFeeV1,
  selectEbayFeeAmountAuthorityV1 } = await import(
  "./ebay-us-no-store-fvf-policy-v1.ts")

const now = new Date("2026-09-23T22:10:00Z")
const account = bounds.marketplaceAccountKey
const ancestry = { status: "PROVEN", source: "EBAY_TAXONOMY_EXACT_CATEGORY_ANCESTRY_V1",
  marketplace: "EBAY_US", categoryId: "179239", treeVersion: "fixture-only",
  digest: "a".repeat(64),
  path: "Clothing, Shoes & Accessories:Men:Men's Accessories:Sunglasses & Sunglasses Accessories",
  ancestorIds: ["11450", "1059", "4250"],
  observedAt: "2026-09-23T21:35:00Z", freshUntil: "2026-09-23T23:35:00Z" }
const policy = await readEbayUsNoStoreFvfPolicyV1(now)
const category = resolveEbayUsNoStoreFvfPolicyV1({ accountKey: account,
  categoryId: ancestry.categoryId, categoryAuthority: ancestry, policy, now })
const domestic = { status: "PROVEN_EXACT", marketplace: "EBAY_US",
  marketplaceAccountKey: account, buyerRegisteredCountry: "US",
  deliveryCountry: "US", internationalFeeStatus: "NOT_APPLICABLE",
  source: "FIXTURE_DOMESTIC_SCENARIO_NOT_REAL_EVIDENCE",
  observedAt: "2026-09-23T21:35:00Z", freshUntil: "2026-09-23T23:35:00Z" }
const otherSellerFees = { status: "NOT_APPLICABLE", amountUsd: 0,
  marketplaceAccountKey: account, categoryId: "179239",
  baseFvfIncluded: false, perOrderFeeIncluded: false,
  serviceMetricsFeeIncluded: false, buyerDependentFeeIncluded: false,
  source: "FIXTURE_CONFIRMED_NO_OPTIONAL_OR_INSERTION_FEE",
  observedAt: "2026-09-23T21:35:00Z", freshUntil: "2026-09-23T23:35:00Z" }
const exactServiceZeroFixture = { status: "PROVEN_ZERO",
  marketplaceAccountKey: account, categoryId: "179239", ratePct: 0,
  source: "EBAY_CURRENT_CATEGORY_SERVICE_METRICS",
  observedAt: "2026-09-23T21:35:00Z",
  freshUntil: "2026-09-23T23:35:00Z" }
const baseline = { policyAuthority: category, itemPrice: 20,
  buyerShipping: 0, handling: 0, otherBuyerCharges: 0,
  otherSellerFeesAuthority: otherSellerFees,
  domesticScenarioAuthority: domestic,
  serviceMetricsAuthority: exactServiceZeroFixture,
  boundPolicy: bounds, now }

test("official public category IDs do not impersonate an exact SKU listing-category receipt", () => {
  const [sunglasses, fragrance] = canaryCategories.items
  assert.equal(sunglasses.officialPageCategoryId, "179239")
  assert.equal(sunglasses.officialPageHasChildCategories, true)
  assert.equal(sunglasses.officialSunglassesLeafPageCategoryId, "79720")
  assert.equal(sunglasses.ownerObservedListingPath,
    "Clothing, Shoes & Accessories > Men > Men's Accessories > Sunglasses & Sunglasses Accessories > Sunglasses")
  assert.equal(sunglasses.ownerVideoArtifactId,
    "f2b723af-571d-44d3-87f0-848e2921f828.mp4")
  assert.equal(sunglasses.ownerVideoDigest,
    "sha256:f5de0e6f64822db34d77f2a4e215e1de3b38046c8d4d6926538be2a18e2e13fd")
  assert.equal(sunglasses.ownerVideoCapturedAt, "2026-09-23T22:25:59Z")
  assert.equal(sunglasses.ownerVideoSizeBytes, 61850353)
  assert.equal(sunglasses.ownerVideoEvidenceStatus,
    "OWNER_ATTESTED_METADATA_FILE_NOT_LOCALLY_VERIFIED")
  assert.equal(canaryCategories.authorizesCategoryBinding, false)
  assert.equal(sunglasses.status,
    "OWNER_FULL_PATH_ATTESTED_CURRENT_TAXONOMY_UNVERIFIED")
  assert.equal(sunglasses.currentTaxonomyTreeVersion, null)
  assert.equal(sunglasses.boundListingCategoryId, null)
  assert.equal(fragrance.officialPageCategoryId, "11848")
  assert.equal(fragrance.queueSuggestedCategoryId, "180345")
  assert.equal(fragrance.queueTaxonomyVerificationStatus, "CATEGORY_NOT_CONFIRMED")
  assert.equal(fragrance.exactDraftReceipt.categoryId, "180345")
  assert.equal(fragrance.exactDraftReceipt.categoryName, "Fragrances")
  assert.equal(fragrance.status, "EXACT_DRAFT_ID_PRESENT_BUT_TAXONOMY_UNCONFIRMED")
  assert.equal(fragrance.boundListingCategoryId, null)
  const unbound = resolveEbayUsNoStoreFvfPolicyV1({ accountKey: account,
    categoryId: null, categoryAuthority: null, policy, now })
  assert.equal(unbound.status, "MISSING")
  const publicPageOnly = resolveEbayUsNoStoreFvfPolicyV1({
    accountKey: account,
    categoryId: sunglasses.officialSunglassesLeafPageCategoryId,
    categoryAuthority: null, policy, now })
  assert.equal(publicPageOnly.status, "MISSING")
  assert.equal(publicPageOnly.blocker, "EXACT_EBAY_CATEGORY_AUTHORITY_MISSING")
})

test("offline official capture is digest-bound and expires without live scraping", async () => {
  assert.equal(policy?.rules.length, 12)
  assert.equal(policy?.sourceDigestScope,
    "NORMALIZED_OFFICIAL_BASIC_FVF_TABLE_NOT_RAW_HTML")
  assert.equal(category.status, "PROVEN")
  assert.equal(category.ruleId, "MOST_CATEGORIES")
  assert.equal(await readEbayUsNoStoreFvfPolicyV1(
    new Date("2026-10-24T00:00:00Z")), null)
})

test("UNKNOWN/NO_DATA service state uses only OWNER-approved 6% reserve", () => {
  const result = evaluateEbayUsNoStoreConservativeFeeV1({ ...baseline,
    serviceMetricsAuthority: null })
  assert.equal(result.serviceMetricsAuthority.status, "CONSERVATIVE_BOUND")
  assert.equal(result.serviceMetricsAuthority.rateFraction, 0.06)
  assert.equal(result.serviceMetricsReserve, 1.2)
  assert.equal(result.serviceMetricsAuthority.realizedSurchargeExact, false)
  assert.equal(result.totalConservativeFee, 4.82)
  const noApproval = evaluateEbayUsNoStoreConservativeFeeV1({ ...baseline,
    serviceMetricsAuthority: null, boundPolicy: { ...bounds,
      serviceMetricsSurcharge: { ...bounds.serviceMetricsSurcharge,
        approvedByOwner: false } } })
  assert.equal(noApproval.serviceMetricsAuthority.status, "UNKNOWN")
  assert.equal(noApproval.totalConservativeFee, null)
})

test("OWNER 2.5% buyer-dependent reserve is not tax or realized fee", () => {
  const result = evaluateEbayUsNoStoreConservativeFeeV1(baseline)
  assert.equal(result.status, "CONSERVATIVE_BOUND")
  assert.equal(result.knownPreListingBasis, 20)
  assert.equal(result.officialCategoryFvf, 2.72)
  assert.equal(result.perOrderFee, 0.4)
  assert.equal(result.buyerDependentFeeReserve.amountUsd, 0.5)
  assert.equal(result.buyerDependentFeeReserve.rateFraction, 0.025)
  assert.equal(result.buyerDependentFeeReserve.realizedFeeExact, false)
  assert.equal(result.serviceMetricsReserve, 0)
  assert.equal(result.totalConservativeFee, 3.62)
  assert.equal(result.realizedFeeExact, null)
})

test("buyer-dependent reserve includes fixed-fee threshold uncertainty once", () => {
  const result = evaluateEbayUsNoStoreConservativeFeeV1({ ...baseline,
    itemPrice: 9.99 })
  assert.equal(result.perOrderFee, 0.3)
  assert.equal(result.buyerDependentFeeReserve.amountUsd, 0.25)
  assert.equal(result.buyerDependentFeeReserve.includesPerOrderThresholdUncertainty, true)
  assert.equal(result.totalConservativeFee,
    Math.round((result.officialCategoryFvf + result.perOrderFee + 0.25) * 100) / 100)
})

test("explicit fee component that overlaps buyer-dependent reserve is rejected", () => {
  const duplicate = evaluateEbayUsNoStoreConservativeFeeV1({ ...baseline,
    otherSellerFeesAuthority: { ...otherSellerFees,
      buyerDependentFeeIncluded: true, amountUsd: 0.2,
      status: "PROVEN_EXACT" } })
  assert.equal(duplicate.totalConservativeFee, null)
  assert.ok(duplicate.blockers.includes("OTHER_SELLER_FEES_UNPROVEN"))
})

test("exact applicable service zero is sufficient; wrong category remains UNKNOWN", () => {
  const zero = exactServiceZeroFixture
  const result = evaluateEbayUsNoStoreConservativeFeeV1({ ...baseline,
    serviceMetricsAuthority: zero })
  assert.equal(result.serviceMetricsAuthority.status, "PROVEN_ZERO")
  assert.equal(result.serviceMetricsReserve, 0)
  const wrong = evaluateEbayUsNoStoreConservativeFeeV1({ ...baseline,
    serviceMetricsAuthority: { ...zero, categoryId: "11848" } })
  assert.equal(wrong.serviceMetricsAuthority.status, "CONSERVATIVE_BOUND")
  assert.equal(wrong.serviceMetricsReserve, 1.2)
  const actual = evaluateEbayUsNoStoreConservativeFeeV1({ ...baseline,
    serviceMetricsAuthority: { ...zero, status: "PROVEN_EXACT", ratePct: 5 } })
  assert.equal(actual.serviceMetricsAuthority.status, "PROVEN_EXACT")
  assert.equal(actual.serviceMetricsReserve, 1)
})

test("missing domestic proof and stale OWNER policy cannot certify conservative amount", () => {
  const noDomestic = evaluateEbayUsNoStoreConservativeFeeV1({ ...baseline,
    domesticScenarioAuthority: null })
  assert.equal(noDomestic.status, "UNKNOWN")
  assert.ok(noDomestic.blockers.includes("US_DOMESTIC_BUYER_AND_DELIVERY_UNPROVEN"))
  const stale = evaluateEbayUsNoStoreConservativeFeeV1({ ...baseline,
    boundPolicy: { ...bounds, revalidateAfter: "2026-09-23T22:09:00Z" } })
  assert.equal(stale.buyerDependentFeeReserve.status, "UNKNOWN")
  assert.equal(stale.totalConservativeFee, null)
  const unknownListingFees = evaluateEbayUsNoStoreConservativeFeeV1({
    ...baseline, otherSellerFeesAuthority: null })
  assert.equal(unknownListingFees.status, "UNKNOWN")
  assert.ok(unknownListingFees.blockers.includes("OTHER_SELLER_FEES_UNPROVEN"))
  const unknownOtherBuyerCharges = evaluateEbayUsNoStoreConservativeFeeV1({
    ...baseline, otherBuyerCharges: null })
  assert.equal(unknownOtherBuyerCharges.knownPreListingBasis, null)
  assert.equal(unknownOtherBuyerCharges.status, "UNKNOWN")
})

test("exact official post-sale fee supersedes, never adds to, prelisting reserves", () => {
  const prelisting = evaluateEbayUsNoStoreConservativeFeeV1({ ...baseline,
    serviceMetricsAuthority: null })
  const receipt = { status: "PROVEN_EXACT",
    source: "EBAY_OFFICIAL_ORDER_FEE_RECEIPT", marketplace: "EBAY_US",
    currency: "USD", marketplaceAccountKey: account,
    supplierSku: "ITEM-8058-RED-LU-DE", categoryId: "179239",
    orderId: "synthetic-order", itemId: "synthetic-item",
    receiptId: "synthetic-fee-receipt", observedAt: now.toISOString(),
    amountUsd: 3.14, buyerSalesTaxUsd: 1.75 }
  const input = { prelisting, realizedFeeReceipt: receipt,
    marketplaceAccountKey: account, supplierSku: "ITEM-8058-RED-LU-DE",
    categoryId: "179239" }
  const actual = selectEbayFeeAmountAuthorityV1(input)
  assert.equal(actual.status, "PROVEN_EXACT")
  assert.equal(actual.feeAmountUsd, 3.14)
  assert.equal(actual.buyerSalesTaxUsd, 1.75)
  assert.equal(actual.prelistingReserveApplied, false)
  const mismatch = selectEbayFeeAmountAuthorityV1({ ...input,
    realizedFeeReceipt: { ...receipt, supplierSku: "ITEM5674" } })
  assert.equal(mismatch.status, "CONSERVATIVE_BOUND")
  assert.equal(mismatch.feeAmountUsd, prelisting.totalConservativeFee)
  assert.equal(mismatch.realizedFeeExact, false)
})
