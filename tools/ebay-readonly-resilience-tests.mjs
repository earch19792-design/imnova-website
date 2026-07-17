import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const gateway = readFileSync(
  new URL("../lib/ebay/ebay-seller-keyword-demand-gateway.ts", import.meta.url),
  "utf8",
)

test("eBay read-only gateway caches short-lived OAuth and taxonomy data", () => {
  assert.match(gateway, /tokenCache = new Map/)
  assert.match(gateway, /expires_in/)
  assert.match(gateway, /taxonomyCache = new Map/)
  assert.match(gateway, /TAXONOMY_CACHE_TTL_MS/)
  assert.match(gateway, /category:\$\{normalizedKnownCategory\}/)
})

test("eBay read-only gateway retries transient failures with Retry-After", () => {
  assert.match(gateway, /\[429, 500, 502, 503, 504\]/)
  assert.match(gateway, /retry-after/)
  assert.match(gateway, /EBAY_MAX_RETRIES/)
  assert.match(gateway, /assertEbaySellerKeywordReadonlyRequest\(url\.href, "GET"\)/)
  assert.match(gateway, /candidateFoundCount:[\s\S]*activeSearch\.payload\.total/)
  assert.match(gateway, /returnedCandidateCount: activeSearch\.items\.length/)
  assert.match(gateway, /enrichedSampleCount: activeDetails\.length/)
  assert.match(gateway, /value === null \|\| value === undefined \|\| value === ""/)
})
