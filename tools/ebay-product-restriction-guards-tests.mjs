import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { buildEbayMarketValidationSelectedCandidate } from "../lib/ebay/ebay-market-validation-selected-candidate.ts"
import { detectEbayProductRestrictionGuards } from "../lib/ebay/ebay-product-restriction-guards.ts"
import { buildMobileReviewEffectiveDecision } from "../lib/ebay/ebay-mobile-review-effective-decision.ts"

const fixture = JSON.parse(
  readFileSync(
    "tools/fixtures/ebay-product-restriction-guards-v1.json",
    "utf8"
  )
)
const restrictionSource = readFileSync(
  "lib/ebay/ebay-product-restriction-guards.ts",
  "utf8"
)
const selectedCandidateSource = readFileSync(
  "lib/ebay/ebay-market-validation-selected-candidate.ts",
  "utf8"
)
const pageSource = readFileSync(
  "app/admin/ebay/mobile-review/page.tsx",
  "utf8"
)

const caseById = (id) => {
  const item = fixture.cases.find((candidate) => candidate.id === id)
  assert.ok(item, `Missing fixture case: ${id}`)
  return item
}

function assertExpectedDetection(id) {
  const item = caseById(id)
  const report = detectEbayProductRestrictionGuards(item.input)
  assert.equal(report.restrictionRiskType, item.expectedRiskType)
  for (const guard of item.expectedGuards) {
    assert.ok(report.pendingRestrictionGuards.includes(guard))
  }
  assert.equal(report.canProceedToB2RunPreflight, false)
  assert.equal(report.canPublish, false)
  return report
}

test("IT Mega Frizz Hair Spray is blocked as aerosol or spray", () => {
  const report = assertExpectedDetection("it-mega-frizz-hair-spray")
  assert.equal(report.productRestrictionRiskDetected, true)
  assert.equal(report.shippingRestrictionReviewRequired, true)
  assert.equal(report.hazmatReviewRequired, true)
  assert.equal(report.nextRequiredGuard, "NEED_SHIPPING_RESTRICTION_REVIEW")
  assert.equal(report.canProceedToListingPackage, false)
})

test("Blue Rust-Oleum Striping Paint Spray is paint spray or flammable", () => {
  const report = assertExpectedDetection("rust-oleum-striping-paint-spray")
  assert.equal(report.shippingRestrictionReviewRequired, true)
  assert.equal(report.hazmatReviewRequired, true)
  assert.equal(report.nextRequiredGuard, "NEED_SHIPPING_RESTRICTION_REVIEW")
  assert.equal(report.canProceedToListingPackage, false)
})

test("detergent, vitamin, baby device and RAM holder get scoped reviews", () => {
  const detergent = assertExpectedDetection("glisten-dishwasher-detergent")
  const vitamin = assertExpectedDetection("healthy-origins-vitamin-d3")
  const baby = assertExpectedDetection("baby-brezza-sterilizer")
  const ram = assertExpectedDetection("ram-holder")
  assert.equal(detergent.restrictionRiskType, "CHEMICAL_PRODUCT_REVIEW")
  assert.equal(vitamin.restrictionRiskType, "HEALTH_CLAIMS_REVIEW")
  assert.equal(baby.restrictionRiskType, "BABY_PRODUCT_REVIEW")
  assert.equal(ram.restrictionRiskType, "BRAND_OR_COMPATIBILITY_REVIEW")
  assert.equal(ram.hazmatReviewRequired, false)
  assert.ok(!ram.pendingRestrictionGuards.includes("NEED_HAZMAT_OR_AEROSOL_REVIEW"))
})

test("remaining required text signals map to precautionary reviews", () => {
  const cases = [
    [{ title: "Pressurized deodorant aerosol" }, "AEROSOL_OR_SPRAY"],
    [{ description: "Liquid pesticide cleaner" }, "CHEMICAL_PRODUCT_REVIEW"],
    [{ productType: "Lithium ion battery" }, "BATTERY_OR_LITHIUM_REVIEW"],
    [{ description: "Dietary supplement with immune support" }, "HEALTH_CLAIMS_REVIEW"],
    [{ title: "Deodorant suppository" }, "HEALTH_CLAIMS_REVIEW"],
    [{ description: "Medical product that treats discomfort" }, "HEALTH_CLAIMS_REVIEW"],
  ]
  for (const [input, riskType] of cases) {
    const report = detectEbayProductRestrictionGuards(input)
    assert.equal(report.productRestrictionRiskDetected, true)
    assert.equal(report.restrictionRiskType, riskType)
    assert.equal(report.canPublish, false)
  }
})

test("simple paper towel holder adds no restriction or hazmat guard", () => {
  const item = caseById("paper-towel-holder")
  const report = detectEbayProductRestrictionGuards(item.input)
  assert.equal(report.productRestrictionRiskDetected, false)
  assert.equal(report.restrictionRiskType, null)
  assert.deepEqual(report.pendingRestrictionGuards, [])
  assert.equal(report.hazmatReviewRequired, false)
  assert.equal(report.canProceedToListingPackage, true)
})

test("complete human confirmations preserve commercial and restriction guards", () => {
  const item = caseById("it-mega-frizz-hair-spray")
  const report = buildEbayMarketValidationSelectedCandidate({
    selectedCandidate: item.input,
    humanConfirmationsComplete: true,
    pendingGuards: fixture.basePendingGuards,
  })
  assert.equal(report.humanConfirmationsComplete, true)
  assert.equal(report.productRestrictionRiskDetected, true)
  assert.equal(report.restrictionRiskType, "AEROSOL_OR_SPRAY")
  for (const guard of [
    ...fixture.basePendingGuards,
    "NEED_SHIPPING_RESTRICTION_REVIEW",
    "NEED_HAZMAT_OR_AEROSOL_REVIEW",
  ]) assert.ok(report.pendingGuards.includes(guard))
  assert.equal(
    report.nextRecommendedRoute,
    "NEED_EBAY_MARKET_VALIDATION_WITH_RESTRICTION_REVIEW"
  )
  assert.equal(report.canProceedToListingPackage, false)
  assert.equal(report.canProceedToB2RunPreflight, false)
  assert.equal(report.canPublish, false)
})

test("effective decision stays in market validation with restriction review", () => {
  const item = caseById("it-mega-frizz-hair-spray")
  const selected = buildEbayMarketValidationSelectedCandidate({
    selectedCandidate: item.input,
    humanConfirmationsComplete: true,
    pendingGuards: fixture.basePendingGuards,
  })
  const effective = buildMobileReviewEffectiveDecision({
    dataSource: "MARKET_RADAR_READONLY",
    selectedCandidateName: item.input.productName,
    pendingGuards: selected.pendingGuards,
    primaryBlockingReason: selected.nextRecommendedRoute,
    localConfirmationsComplete: true,
    holdForReview: false,
    refreshRequested: false,
  })
  assert.equal(
    effective.nextRecommendedRoute,
    "NEED_EBAY_MARKET_VALIDATION_WITH_RESTRICTION_REVIEW"
  )
  assert.equal(effective.canProceedToB2RunPreflight, false)
  assert.equal(effective.canPublish, false)
})

test("simple product continues to eBay market validation without restriction guards", () => {
  const item = caseById("paper-towel-holder")
  const report = buildEbayMarketValidationSelectedCandidate({
    selectedCandidate: item.input,
    humanConfirmationsComplete: true,
    pendingGuards: fixture.basePendingGuards,
  })
  assert.equal(report.productRestrictionRiskDetected, false)
  assert.deepEqual(report.restrictionGuards, [])
  assert.equal(report.nextRecommendedRoute, "NEED_EBAY_MARKET_VALIDATION")
  assert.equal(report.canProceedToB2RunPreflight, false)
  assert.equal(report.canPublish, false)
})

test("mobile UI exposes the restriction warning and blocked outcomes", () => {
  assert.match(
    pageSource,
    /Este producto puede tener restricciones de envío o categoría\./
  )
  assert.match(pageSource, /marketValidation\.restrictionRiskType/)
  assert.match(pageSource, /marketValidation\.restrictionGuards/)
  assert.match(pageSource, /B2-RUN bloqueado · canPublish false/)
  assert.match(pageSource, /marketValidationSelectedCandidate/)
})

test("restriction loop has no external write, secret, image download or scraper capability", () => {
  const combined = `${restrictionSource}\n${selectedCandidateSource}`
  for (const forbidden of [
    /method:\s*["']POST["']/,
    /\.insert\s*\(/,
    /\.update\s*\(/,
    /\.upsert\s*\(/,
    /publishOffer\s*\(/,
    /createOffer\s*\(/,
    /process\.env/,
    /SUPABASE_SERVICE_ROLE_KEY/,
    /OPENAI_API_KEY/,
  ]) assert.doesNotMatch(combined, forbidden)
  const restrictionLogic = combined
  for (const forbidden of [
    /access_token/i,
    /refresh_token/i,
    /scrap(?:e|er|ing)/i,
    /amazon/i,
    /<img/i,
  ]) assert.doesNotMatch(restrictionLogic, forbidden)
})
