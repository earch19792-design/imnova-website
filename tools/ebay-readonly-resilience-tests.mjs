import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const gateway = readFileSync(
  new URL("../lib/ebay/ebay-seller-keyword-demand-gateway.ts", import.meta.url),
  "utf8",
)
const route = readFileSync(
  new URL("../app/api/admin/ebay/seller-keyword-demand/route.ts", import.meta.url),
  "utf8",
)
const mobileReview = readFileSync(
  new URL("../app/admin/ebay/mobile-review/page.tsx", import.meta.url),
  "utf8",
)

test("eBay read-only gateway caches short-lived OAuth and taxonomy data", () => {
  assert.match(gateway, /tokenCache = new Map/)
  assert.match(gateway, /expires_in/)
  assert.match(gateway, /taxonomyCache = new Map/)
  assert.match(gateway, /TAXONOMY_CACHE_TTL_MS/)
  assert.match(gateway, /ebayTaxonomyCacheKeyV1/)
  assert.match(gateway,
    /marketplace:\$\{input\.marketplaceId\}:\$\{identity\}/)
})

test("Taxonomy replaces a rejected inherited category only with an official leaf suggestion", () => {
  assert.match(gateway, /const suggestCategory = async/)
  assert.match(gateway, /get_category_suggestions/)
  assert.match(gateway, /categoryResolution = "TITLE_SUGGESTION_FALLBACK"/)
  assert.match(gateway, /aspectsPayload = await getAspects\(categoryId\)/)
  assert.match(gateway, /if \(!suggestion\.id \|\| suggestion\.id === categoryId\) throw knownCategoryError/)
  assert.match(gateway, /failureCode = \/\^EBAY_READONLY_GET_/)
})

test("eBay read-only gateway retries transient failures with Retry-After", () => {
  assert.match(gateway, /\[429, 500, 502, 503, 504\]/)
  assert.match(gateway, /retry-after/)
  assert.match(gateway, /EBAY_MAX_RETRIES/)
  assert.match(gateway, /assertEbaySellerKeywordReadonlyRequest\(url\.href, "GET"\)/)
  assert.match(gateway, /candidateFoundCount:[\s\S]*activeSearch\.payload\.total/)
  assert.match(gateway, /returnedCandidateCount: activeSearch\.items\.length/)
  assert.match(gateway, /enrichedSampleCount: activeComparables\.length/)
  assert.match(gateway, /value === null \|\| value === undefined \|\| value === ""/)
})

test("seller market analysis preserves eBay 429 and prevents repeated browser retries", () => {
  assert.match(route, /export async function GET\(req: Request\)/)
  assert.match(route, /ebayCalls: 0/)
  assert.match(route, /getEbayReadonlyRateLimitMetadata\(error\)/)
  assert.match(route, /status: 429/)
  assert.match(route, /headers: \{ "Retry-After": String\(retryAfterSeconds\) \}/)
  assert.match(mobileReview, /if \(response\.status === 429\)/)
  assert.match(mobileReview, /setSellerKeywordRetryAt\(retryAt\)/)
  assert.match(mobileReview, /payload\.quota\?\.available === false/)
  assert.match(mobileReview, /sellerKeywordDemandLoading \|\| ebayRateLimitActive/)
  assert.match(mobileReview, /sellerKeywordDemandError && !ebayRateLimitActive/)
  assert.match(route, /recordPersistentEbayRateLimit/)
  assert.match(route, /checkpointPreserved: true/)
  assert.match(mobileReview, /Capturar ventas en Product Research/)
  assert.match(mobileReview, /Revisar otra oportunidad/)
})
