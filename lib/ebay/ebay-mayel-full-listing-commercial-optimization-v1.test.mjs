import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8")
const classifier = read("./ebay-mayel-full-listing-commercial-optimization-v1.ts")
const commercial = read("./ebay-mayel-commercial-optimization-delegation-v1.ts")
const promotion = read("./ebay-mayel-promotion-spend-delegation-v1.ts")
const remote = read("./ebay-remote-live-optimization-operator-v1.ts")
const page = read("../../app/admin/ebay/mayel/page.tsx")
const ui = read("../../app/admin/mayel-visual-workstation.tsx")
const route = read("../../app/api/admin/ebay/mayel-visual-workstation/route.ts")
const migration = read("../../supabase/migrations/20260906091233_mayel_full_listing_commercial_optimization_delegations_v1.sql")

test("all canonical LIVE listings reach Mayel independently of visual tasks", () => {
  assert.match(remote, /listings: Object\.freeze\(listingCards\)/)
  assert.match(page, /dashboard\?: \{ listings\?: RemoteLiveOperatorListingV1\[\] \}/)
  assert.match(page, /setLivePortfolio\(listings\)/)
  assert.match(ui, /data-all-live-listings-visible-to-mayel/)
  assert.doesNotMatch(page, /dashboard\?\.taskListings/)
})

test("portfolio classifier covers every requested opportunity without fake fields", () => {
  for (const value of ["VISUAL_OPPORTUNITY", "CONTENT_OPPORTUNITY",
    "KEYWORD_OPPORTUNITY", "MARKET_REVALIDATION_REQUIRED",
    "PRICE_OPPORTUNITY", "PROMOTION_OPPORTUNITY", "PERFORMANCE_PROBLEM",
    "HEALTHY", "INSUFFICIENT_EVIDENCE"]) assert.match(classifier,
      new RegExp(`"${value}"`))
  assert.match(classifier, /supportedKeywordFields:[\s\S]*"TITLE", "ITEM_SPECIFICS", "DESCRIPTION"/)
  assert.match(classifier, /fakeKeywordFieldAllowed: false/)
  assert.match(classifier, /categoryRecommendationOnly: true/)
})

test("content authority protects facts and requires official readbacks", () => {
  assert.match(commercial, /"UNPROVEN_PRODUCT_FACTS"/)
  assert.match(commercial, /productTruthRequiredForFactualWrites: true/)
  assert.match(commercial, /keywordsOnlyInEbaySupportedFields: true/)
  assert.match(commercial, /categoryWriteRequiresSeparateCertification: true/)
  assert.match(commercial, /freshOfficialPrewriteReadbackRequired: true/)
  assert.match(commercial, /officialPostwriteReadbackRequired: true/)
  assert.match(commercial, /ownerPerListingApproval: false/)
})

test("promotion authority has no invented defaults and requires explicit ceilings", () => {
  assert.match(promotion, /ownerCeilingsRequired: true/)
  assert.match(promotion, /spendWithinOwnerCeilings: true/)
  assert.match(promotion, /economicsProven: true/)
  assert.match(promotion, /noExperimentConflict: true/)
  assert.match(promotion, /directWriteWithoutValidatedCeilings: false/)
  assert.match(ui, /maxAdSpendPerListing: ""/)
  assert.match(ui, /maxPortfolioAdSpendPerDay: ""/)
  assert.match(ui, /Sin esta autoridad Seller OS sólo recomienda/)
})

test("new authorities are owner-only, revocable, RLS locked and write no marketplace", () => {
  assert.match(route, /AUTHORIZE_COMMERCIAL_OPTIMIZATION_DELEGATION/)
  assert.match(route, /AUTHORIZE_PROMOTION_SPEND_DELEGATION/)
  assert.match(route, /MAYEL_COMMERCIAL_OWNER_AUTHORITY_REQUIRED/)
  assert.match(route, /MAYEL_PROMOTION_OWNER_AUTHORITY_REQUIRED/)
  assert.match(migration, /enable row level security/g)
  assert.match(migration, /force row level security/g)
  assert.match(migration, /from public, anon, authenticated/)
  assert.match(migration, /MAYEL_COMMERCIAL_AUTHORITY_SCOPE_IMMUTABLE/)
  assert.match(migration, /MAYEL_COMMERCIAL_AUTHORITY_APPEND_ONLY/)
  assert.match(route, /marketplaceWrites: 0/)
})

test("execution contract stays management-aware, bounded and fail-closed", () => {
  assert.match(classifier, /managementModelMustBeResolved: true/)
  assert.match(classifier, /maxMarketplaceWritesPerExecution: 1/)
  assert.match(classifier, /officialPostwriteReadbackRequired: true/)
  assert.match(classifier, /ambiguousWriteAutoRetry: false/)
  assert.match(promotion, /recommendationOnlyWhenCapabilityUnproven: true/)
})
