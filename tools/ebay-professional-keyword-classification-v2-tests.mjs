import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildEbaySellerKeywordDemandValidation,
} from "../lib/ebay/ebay-seller-keyword-demand-validation.ts"

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/ebay-professional-keyword-classification-v2.json", import.meta.url),
    "utf8"
  )
)

const buildReport = (insightsAvailability = "NOT_CONFIGURED") =>
  buildEbaySellerKeywordDemandValidation({
    candidate: fixture.candidate,
    comparables: fixture.comparables,
    insightsAvailability,
  })

test("labels disabled Marketplace Insights separately from denied authorization", () => {
  assert.equal(buildReport().marketplaceInsightsStatus, "MARKETPLACE_INSIGHTS_NOT_ENABLED")
  assert.equal(buildReport("NOT_ENTITLED").marketplaceInsightsStatus, "MARKETPLACE_INSIGHTS_NOT_AUTHORIZED")
})

test("classifies estimated multi-seller keywords without calling them verified sales", () => {
  const report = buildReport()
  const crackFiller = report.keywordEvidenceGroups.estimatedMultiSellerSignal.find(
    (keyword) => keyword.term === "crack filler"
  )
  assert.ok(crackFiller)
  assert.equal(crackFiller.estimatedSoldQuantity, 200)
  assert.equal(crackFiller.estimatedSellerCount, 2)
  assert.equal(crackFiller.safeToCallEstimatedOpportunity, true)
  assert.equal(crackFiller.safeToCallVerifiedSalesKeyword, false)
  assert.equal(report.keywordsBringingSales.length, 0)
  assert.match(report.keywordEvidenceHeading, /estimada/i)
  assert.equal(report.demandValidationBasis, "INSUFFICIENT_CONFIRMED_SOLD_EXACT")
  assert.equal(report.demandValidationPassed, false)
  assert.equal(
    report.demandEvidencePolicy.evidenceClass,
    "OBSERVED_ESTIMATED_ROTATION",
  )
})

test("keeps one-seller terms exploratory and never winning", () => {
  const report = buildReport()
  const concreteJoint = report.singleSellerKeywordObservations.find(
    (keyword) => keyword.term === "concrete joint"
  )
  assert.ok(concreteJoint)
  assert.equal(concreteJoint.professionalEvidenceClass, "SINGLE_SELLER_OBSERVATION")
  assert.equal(concreteJoint.safeToCallVerifiedSalesKeyword, false)
  assert.ok(report.recommendedListingKeywordStructure.termsToKeepExploratory.includes("concrete joint"))
})

test("separates core phrases from packaging, color and quantity attributes", () => {
  const report = buildReport()
  const keywords = report.activeListingKeywords
  assert.equal(keywords.find((keyword) => keyword.term === "bottle")?.keywordRole, "PACKAGING_OR_FORMAT")
  assert.equal(keywords.find((keyword) => keyword.term === "lb")?.keywordRole, "CONFIRMED_SPECIFICATION_OR_QUANTITY")
  assert.equal(keywords.find((keyword) => keyword.term === "gray")?.keywordRole, "PRODUCT_ATTRIBUTE")
  assert.equal(keywords.some((keyword) => keyword.term === "lb."), false)
  assert.equal(report.recommendedListingKeywordStructure.primarySearchPhrase, "crack filler")
  assert.ok(report.recommendedListingKeywordStructure.confirmedAttributes.includes("gray"))
  assert.notEqual(report.recommendedListingKeywordStructure.primarySearchPhrase, "bottle")
})

test("excludes a contradictory color variant from professional comparables", () => {
  const report = buildReport()
  assert.equal(report.eligibleComparableListings, 2)
  assert.equal(
    report.topSellingListings.some((listing) => listing.comparableId === "v1|200000000003|0"),
    false
  )
})

test("builds professional listing structure and buyer intent without personal data", () => {
  const report = buildReport()
  assert.equal(report.recommendedListingKeywordStructure.strategyConfidence, "MEDIUM_ESTIMATED_MULTI_SELLER")
  assert.match(report.recommendedListingKeywordStructure.titleFormula, /Marca confirmada/)
  assert.equal(report.highestPotentialBuyerIntent.intentType, "PROBLEM_SOLUTION_REPAIR")
  assert.equal(report.highestPotentialBuyerIntent.potentialLevel, "MEDIUM_WITH_ESTIMATED_SIGNAL")
  assert.equal(report.highestPotentialBuyerIntent.usesPersonalBuyerData, false)
  assert.match(report.professionalReferenceGuidance.selectionRule, /nunca elegir sólo por cantidad estimada/i)
})

test("mobile language exposes professional evidence groups and structured guidance", () => {
  const page = readFileSync(
    new URL("../app/admin/ebay/mobile-review/page.tsx", import.meta.url),
    "utf8"
  )
  assert.match(page, /keywordEvidenceHeading/)
  assert.match(page, /Señales exploratorias de un solo vendedor/)
  assert.match(page, /Estructura profesional recomendada/)
  assert.match(page, /Intención de compra con mayor potencial/)
  assert.match(page, /score profesional/)
  assert.match(page, /no utiliza datos personales de compradores/)
  assert.doesNotMatch(page, />Keywords respaldadas por ventas</)
})

test("professional classification remains read-only and publication-blocked", () => {
  const report = buildReport()
  assert.equal(report.ebayWriteUsed, false)
  assert.equal(report.supabaseWriteUsed, false)
  assert.equal(report.canProceedToB2RunPreflight, false)
  assert.equal(report.canPublish, false)
})
