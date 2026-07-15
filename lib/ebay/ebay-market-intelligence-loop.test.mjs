import assert from "node:assert/strict"
import test from "node:test"

import {
  calculateListingEconomics,
  calculateMinimumSafePrice,
  median,
  normalizeCompetitors,
  parseCompetitorListingsCsv,
  runEbayMarketIntelligenceLoop,
  weightedAverage,
} from "./market-intelligence/index.ts"

function competitor(index, overrides = {}) {
  return {
    url: `https://www.ebay.com/itm/${100000000000 + index}`,
    title: `Lysol Lemon Wipes 3 Pack 15 Count ${index}`,
    price: 14 + index,
    shippingCost: index % 2 ? 0 : 3,
    quantityIncluded: 3,
    totalUnitCount: 45,
    soldCountVisible: index % 3 ? index * 4 : null,
    watchersVisible: index,
    sellerFeedbackPercent: 99.5,
    sellerFeedbackCount: 1_000 * index,
    sellerLevel: "Top Rated",
    returnsAccepted: true,
    returnPeriodDays: 30,
    returnShippingPaidBy: index % 2 ? "seller" : "buyer",
    handlingTimeDays: index % 2,
    estimatedDelivery: "3-5 days",
    promotedVisible: index % 2 === 0,
    mainImageUrl: `https://i.ebayimg.com/images/g/${index}/s-l1600.jpg`,
    secondaryImageUrls: [],
    itemSpecifics: { Brand: "Lysol", Scent: "Lemon", Count: 45, Condition: "New" },
    description: "Competitor description must not be copied into the report.",
    notes: null,
    evidenceLevel: "visible",
    fieldEvidence: {
      price: "visible",
      shippingCost: "visible",
      totalUnitCount: "visible",
      soldCountVisible: index % 3 ? "visible" : "unavailable",
    },
    condition: "new",
    internationalShipping: false,
    additionalProductsIncluded: false,
    reviewCount: 20 * index,
    listingQualityScore: 80,
    bestOfferVisible: false,
    volumePricingVisible: index % 2 === 0,
    mainImageAnalysis: {
      background: "white",
      productCoveragePercent: 75,
      quantityClarity: 85,
      textAmount: 10,
      badgeUsage: false,
      shippingBadge: false,
      brandVisibility: 90,
      imageSharpness: 88,
      visualClutter: 12,
      mobileReadability: 90,
      trustScore: 86,
      estimatedCtrScore: 82,
    },
    secondaryImageClassifications: ["packageContents", "useCase"],
    ...overrides,
  }
}

function marketInput(listings = Array.from({ length: 10 }, (_, index) => competitor(index + 1))) {
  return {
    productName: "Disinfecting Wipes To-Go Pack, Lemon Scent",
    productBrand: "Lysol",
    productCategory: "Household Cleaning",
    unitsPerListing: 3,
    unitsPerPackage: 15,
    totalUnits: 45,
    sellerProductCost: 4.5,
    packagingCost: 0.5,
    shippingCost: 5,
    expectedReturnCost: 0.5,
    ebayFeePercent: 15,
    promotedListingPercent: 2,
    targetMarginPercent: 20,
    competitorListings: listings,
    sourceDate: "2026-07-15",
    currency: "USD",
  }
}

test("calculates price per package and unit from landed price", () => {
  const { used } = normalizeCompetitors(marketInput([
    competitor(1, { price: 15, shippingCost: 3 }),
  ]))
  assert.equal(used[0].landedPrice, 18)
  assert.equal(used[0].pricePerPackage, 6)
  assert.equal(used[0].pricePerUnit, 0.4)
})

test("calculates median and evidence-weighted averages", () => {
  assert.equal(median([3, 1, 9]), 3)
  assert.equal(median([1, 3]), 2)
  assert.equal(weightedAverage([
    { value: 10, weight: 1 },
    { value: 20, weight: 3 },
  ]), 17.5)
})

test("floor price covers costs adjusted for marketplace percentages", () => {
  const input = marketInput()
  assert.equal(calculateMinimumSafePrice(input), 12.66)
  const economics = calculateListingEconomics(input, 20)
  assert.deepEqual(economics, {
    salePrice: 20,
    totalProductCost: 10.5,
    estimatedMarketplaceCost: 3.4,
    estimatedProfit: 6.1,
    estimatedMarginPercent: 30.5,
  })
})

test("excludes non-comparable listings but retains reasons", () => {
  const { used, excluded } = normalizeCompetitors(marketInput([
    competitor(1),
    competitor(2, { condition: "used" }),
    competitor(3, { internationalShipping: true }),
    competitor(4, { additionalProductsIncluded: true }),
    competitor(5, { quantityIncluded: null, totalUnitCount: null }),
  ]))
  assert.equal(used.length, 1)
  assert.equal(excluded.length, 4)
  assert.ok(excluded.some((item) => item.reasons.includes("USED_OR_REFURBISHED")))
  assert.ok(excluded.some((item) => item.reasons.includes("INTERNATIONAL_SHIPPING_NOT_COMPARABLE")))
  assert.ok(excluded.some((item) => item.reasons.includes("ADDITIONAL_PRODUCTS_INCLUDED")))
  assert.ok(excluded.some((item) => item.reasons.includes("QUANTITY_NOT_NORMALIZABLE")))
})

test("never upgrades inferred sold counts to visible sales evidence", () => {
  const input = marketInput([
    competitor(1, {
      soldCountVisible: 999,
      fieldEvidence: { soldCountVisible: "inferred", price: "visible", shippingCost: "visible", totalUnitCount: "visible" },
    }),
  ])
  const result = runEbayMarketIntelligenceLoop(input, new Date("2026-07-15T12:00:00Z"))
  assert.equal(result.report.demandSignals[0].soldCountEvidence, "inferred")
  assert.doesNotMatch(result.report.demandSignals[0].signals.join(" "), /Visible sold count/)
  assert.ok(result.report.riskFlags.includes("NO_VISIBLE_SOLD_COUNT_DEMAND_SIGNALS_ONLY"))
})

test("supports 10 comparables and emits report.json and report.md without copied descriptions", () => {
  const result = runEbayMarketIntelligenceLoop(
    marketInput(),
    new Date("2026-07-15T12:00:00Z"),
  )
  assert.equal(result.report.marketRange.competitorCountUsed, 10)
  assert.equal(result.report.competitorTable.length, 10)
  assert.ok(result.report.recommendedPrice.estimatedMarginPercent >= 20)
  assert.ok(result.report.minimumSafePrice.salePrice >= 12.66)
  assert.equal(result.report.imagePatternAnalysis.backgroundFrequency.white, 10)
  assert.equal(result.report.imagePatternAnalysis.secondaryImageFrequency.packageContents, 10)
  assert.equal(result.report.competitorTable[0].evidence.notes, "unavailable")
  assert.match(result.files["report.md"], /## 17\. Evidence Summary/)
  assert.match(result.files["report.json"], /EBAY_MARKET_INTELLIGENCE_LOOP_V1/)
  assert.doesNotMatch(result.files["report.json"], /Competitor description must not be copied/)
  assert.deepEqual(result.safety, {
    scrapingUsed: false,
    competitorContentCopied: false,
    inferredSalesPresentedAsVerified: false,
  })
})

test("imports competitor observations from CSV with JSON evidence fields", () => {
  const csv = [
    "url,title,price,shippingCost,quantityIncluded,totalUnitCount,soldCountVisible,watchersVisible,sellerFeedbackPercent,sellerFeedbackCount,sellerLevel,returnsAccepted,returnPeriodDays,returnShippingPaidBy,handlingTimeDays,estimatedDelivery,promotedVisible,mainImageUrl,secondaryImageUrls,itemSpecifics,description,notes,evidenceLevel,fieldEvidence,condition,internationalShipping,additionalProductsIncluded",
    'https://www.ebay.com/itm/123456789012,"Lysol Wipes, 3 Pack",15,0,3,45,,2,99.8,1000,Top Rated,true,30,seller,1,3 days,false,,[],"{\"\"Brand\"\":\"\"Lysol\"\"}",,,visible,"{\"\"price\"\":\"\"visible\"\",\"\"soldCountVisible\"\":\"\"unavailable\"\"}",new,false,false',
  ].join("\n")
  const rows = parseCompetitorListingsCsv(csv)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, "Lysol Wipes, 3 Pack")
  assert.equal(rows[0].soldCountVisible, null)
  assert.equal(rows[0].fieldEvidence.soldCountVisible, "unavailable")
})

test("Zod rejects more than 10 competitors and unsupported evidence levels", () => {
  assert.throws(
    () => runEbayMarketIntelligenceLoop(marketInput(Array.from({ length: 11 }, (_, index) => competitor(index + 1)))),
  )
  assert.throws(
    () => runEbayMarketIntelligenceLoop(marketInput([competitor(1, { evidenceLevel: "guessed" })])),
  )
})
