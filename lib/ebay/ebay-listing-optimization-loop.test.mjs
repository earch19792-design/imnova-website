import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  calculateListingScore,
  diagnoseListingMetrics,
  evaluateListingCompliance,
  executeEbayListingOptimizationLoop,
  generateImageBrief,
  generateTitleCandidates,
} from "./listing-optimization/index.ts"

function marketReport() {
  return {
    reportVersion: "EBAY_MARKET_INTELLIGENCE_LOOP_V1",
    currency: "USD",
    marketRange: {
      medianLandedPrice: 21,
      medianPricePerUnit: 0.4667,
      weightedMarketPrice: 22,
      competitorCountUsed: 10,
      competitorCountExcluded: 0,
    },
    competitorTable: Array.from({ length: 10 }, (_, index) => ({
      url: `https://www.ebay.com/itm/${100000000000 + index}`,
      title: `Competitor cleaning wipes ${index + 1}`,
    })),
    recommendedPrice: { salePrice: 21.99 },
    minimumSafePrice: { salePrice: 15.5 },
    confidenceScore: 85,
    titleKeywordAnalysis: { keywords: ["cleaning", "wipes", "cure"] },
  }
}

function image(index, overrides = {}) {
  return {
    id: `image-${index}`,
    url: `https://example.com/image-${index}.jpg`,
    status: "approved",
    observedText: [],
    observedQuantity: 3,
    observedTotalUnits: 45,
    medicalTextDetected: false,
    background: index === 1 ? "pure white" : "neutral",
    productCoveragePercent: index === 1 ? 82 : 60,
    imageSharpness: 90,
    mobileReadability: 90,
    factsDepicted: ["3 packages", "45 total units"],
    ...overrides,
  }
}

function validInput(overrides = {}) {
  const input = {
    marketIntelligenceReport: marketReport(),
    productFacts: {
      brand: "Lysol",
      productName: "Cleaning Wipes To-Go",
      productType: "Cleaning Wipes",
      quantityIncluded: 3,
      unitsPerPackage: 15,
      totalUnits: 45,
      scent: "Lemon",
      condition: "New",
      upc: "740136480733",
      manufacturerPartNumber: "ITEM3995-3PK",
      epaRegistrationNumber: null,
      packageContents: ["3 sealed packages"],
      dimensions: { length: 8, width: 6, height: 3, unit: "in" },
      weight: { value: 12, unit: "oz" },
      permittedClaims: [],
      prohibitedClaims: ["Kills 99.9%", "Prevents disease"],
      verifiedUseCases: ["Desk cleanup", "Travel convenience"],
      verifiedCompatibility: ["Hard non-porous surfaces listed on the product label"],
      shippingOrigin: "United States",
      handlingTime: 1,
      returnPolicy: "30-day returns",
    },
    sellerProfile: {
      accountAge: 1,
      sellerFeedbackPercent: null,
      sellerFeedbackCount: 0,
      topRatedStatus: false,
      freeShipping: true,
      sellerPaidReturns: true,
      promotedListingPercent: 2,
      targetMarginPercent: 20,
    },
    listingDraft: {
      title: "Lysol Cleaning Wipes 3 Pack 45 Count Lemon",
      subtitle: null,
      price: 20.99,
      quantity: 1,
      category: "Cleaning Products",
      itemSpecifics: {},
      description: "Basic draft",
      shippingPolicy: "Free Shipping · 1 business day handling",
      returnPolicy: "30-day returns",
      bestOfferEnabled: false,
      immediatePaymentEnabled: true,
      volumePricing: [],
      images: Array.from({ length: 6 }, (_, index) => `image-${index + 1}`),
    },
    imageAssets: Array.from({ length: 6 }, (_, index) => image(index + 1)),
    regulatoryData: {
      confirmedEpaRegistrationNumber: null,
      confirmedRegulatoryClaims: [],
      brandUsageAuthorized: true,
      madeInUsaConfirmed: false,
      usaSellerConfirmed: false,
      tsaApprovedConfirmed: false,
    },
    platformConstraints: {
      maximumTitleLength: 80,
      maximumImages: 12,
      prohibitedTerms: ["COVID-19", "coronavirus"],
      minimumPrice: null,
      maximumPrice: null,
    },
  }
  return { ...input, ...overrides }
}

test("generates at most five factual titles without importing risky market keywords", () => {
  const input = validInput()
  input.productFacts.productName = "Cleaning Wipes Kills 99.9% COVID-19"
  const candidates = generateTitleCandidates(input)
  assert.ok(candidates.length <= 5)
  for (const candidate of candidates) {
    assert.match(candidate.title, /^Lysol /)
    assert.match(candidate.title, /3 Pack/)
    assert.ok(candidate.title.length <= 80)
    assert.doesNotMatch(candidate.title, /cure|covid|coronavirus|kills 99\.9/i)
  }
})

test("detects prohibited, contradictory and unsupported compliance content", () => {
  const input = validInput()
  input.sellerProfile.freeShipping = false
  input.listingDraft.description = "Prevents disease from COVID-19. Kills 99.9%. Made in USA. TSA Approved."
  input.listingDraft.itemSpecifics.UPC = "123456789012"
  input.imageAssets[0] = image(1, { observedQuantity: 6, medicalTextDetected: true, observedText: ["UPC 123456789012", "Brand: Other"] })
  const review = evaluateListingCompliance(input)
  const codes = review.blockingIssues.map((entry) => entry.code)
  for (const expected of [
    "PROHIBITED_COVID_REFERENCE", "UNVERIFIED_DISEASE_CLAIM", "KILLS_99_9_NOT_PERMITTED",
    "UPC_CONTRADICTION", "IMAGE_QUANTITY_CONTRADICTION", "IMAGE_MEDICAL_TEXT_PROHIBITED",
    "IMAGE_UPC_CONTRADICTION", "IMAGE_BRAND_CONTRADICTION",
    "FREE_SHIPPING_NOT_SUPPORTED", "MADE_IN_USA_UNCONFIRMED", "TSA_APPROVED_UNCONFIRMED",
  ]) assert.ok(codes.includes(expected), expected)
  assert.equal(calculateListingScore(input, review).total <= 60, true)
})

test("missing critical facts create blocking issues and cap score at 60", () => {
  const input = validInput()
  input.productFacts.dimensions = null
  input.productFacts.weight = null
  input.productFacts.upc = null
  input.productFacts.manufacturerPartNumber = null
  input.productFacts.totalUnits = 44
  const review = evaluateListingCompliance(input)
  assert.ok(review.blockingIssues.some((entry) => entry.code === "DIMENSIONS_MISSING"))
  assert.ok(review.blockingIssues.some((entry) => entry.code === "WEIGHT_MISSING"))
  assert.ok(review.blockingIssues.some((entry) => entry.code === "PRODUCT_IDENTIFIER_MISSING"))
  assert.ok(review.blockingIssues.some((entry) => entry.code === "PRODUCT_QUANTITY_STRUCTURE_INCONSISTENT"))
  assert.equal(calculateListingScore(input, review).cappedByBlockingIssue, true)
})

test("regulatory product requires matching EPA registration and never auto-corrects it", () => {
  const input = validInput()
  input.productFacts.productType = "Disinfecting Wipes"
  input.productFacts.epaRegistrationNumber = "777-123"
  input.regulatoryData.confirmedEpaRegistrationNumber = "777-999"
  const output = executeEbayListingOptimizationLoop(input, new Date("2026-07-15T12:00:00Z"))
  assert.ok(output.result.review.blockingIssues.some((entry) => entry.code === "EPA_REGISTRATION_UNCONFIRMED"))
  assert.equal(output.result.safety.regulatoryDataChangedAutomatically, false)
  assert.ok(output.result.review.regulatoryProposals.length > 0)
})

test("creates six independent image briefs from verified facts", () => {
  const briefs = generateImageBrief(validInput())
  assert.equal(briefs.length, 6)
  assert.deepEqual(briefs.map((brief) => brief.imageNumber), [1, 2, 3, 4, 5, 6])
  assert.equal(new Set(briefs.map((brief) => brief.name)).size, 6)
  assert.equal(briefs[0].productCoveragePercent, 82)
  for (const brief of briefs) {
    assert.match(brief.generationPrompt, /3 packages/)
    assert.doesNotMatch(brief.generationPrompt, /cure|COVID-19 is prevented/i)
  }
})

test("optimization loop applies only safe corrections, preserves price and records history", () => {
  const input = validInput()
  const originalPrice = input.listingDraft.price
  const output = executeEbayListingOptimizationLoop(input, new Date("2026-07-15T12:00:00Z"))
  const result = output.result
  assert.ok(result.optimizationHistory.length >= 1 && result.optimizationHistory.length <= 5)
  assert.equal(result.listingDraft.price, originalPrice)
  assert.equal(result.safety.priceChangedAutomatically, false)
  assert.match(result.listingDraft.description, /Product summary/)
  assert.equal(result.listingDraft.itemSpecifics.Brand, "Lysol")
  assert.equal(result.imageBrief.length, 6)
  assert.equal(Object.keys(output.files).length, 6)
  assert.deepEqual(Object.keys(output.files).sort(), [
    "experiment-plan.json", "final-listing.md", "image-brief.json",
    "listing-draft.json", "listing-review.json", "optimization-history.json",
  ])
})

test("diagnostics map metrics to one-variable optimization areas", () => {
  assert.deepEqual(diagnoseListingMetrics({
    impressions: 1000, clicks: 10, ctr: 1, watchers: 0, addToCart: 0, purchases: 0,
    conversionRate: 0, averageOrderValue: 0, returnRate: 6, cancellationRate: 0, profitPerOrder: 0,
  }), [
    "GOOD_IMPRESSIONS_LOW_CTR_REVIEW_MAIN_IMAGE_PRICE",
    "HIGH_RETURNS_REVIEW_INFORMATION_QUANTITY_DIMENSIONS_EXPECTATIONS",
  ])
})

test("legacy optimizer route remains authenticated and non-publishing", () => {
  const route = readFileSync("app/api/admin/ebay/listing-optimization/route.ts", "utf8")
  assert.match(route, /validateAdminApiRequest\(req\)/)
  assert.match(route, /ebayWriteUsed: false/)
  assert.match(route, /canPublish: false/)
  assert.doesNotMatch(route, /publishOffer|createOffer|GetItem|AddItem/)
})

test("AI listing optimization Command Center hydrates the canonical strategic authority", () => {
  const page = readFileSync("app/admin/ebay/listing-optimization/page.tsx", "utf8")
  assert.match(page, /\/api\/admin\/ebay\/strategic-review/)
  assert.match(page, /Command Center de optimización/)
  assert.match(page, /Current LIVE/)
  assert.match(page, /StockGuard/)
  assert.match(page, /Listing Quality Report/)
  assert.match(page, /Experimentos/)
  assert.match(page, /No se interpreta como cero recomendaciones/)
  assert.match(page, /Login eBay del operador/)
  assert.match(page, /No requerido/)
  assert.match(page, /0 WRITES EBAY/)
  assert.doesNotMatch(page,
    /publishOffer|createOffer|withdrawOffer|reviseInventoryStatus|action=approve/)
  assert.doesNotMatch(page, /EBAY_CLIENT_SECRET|REFRESH_TOKEN|CRON_SECRET/)
})
