import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildEbayIdentitySearchUrl,
  buildLunaEbayIdentityComparison,
  getSafeEbayListingUrl,
} from "../lib/ebay/ebay-luna-ebay-identity-comparison.ts"

const moduleSource = readFileSync(
  "lib/ebay/ebay-luna-ebay-identity-comparison.ts",
  "utf8"
)
const pageSource = readFileSync(
  "app/admin/ebay/mobile-review/page.tsx",
  "utf8"
)

const lunaCandidate = {
  productName: "IT Mega Frizz Hair Spray Bonus, 10 oz.",
  variantTitle: "10 oz",
  supplierSku: "IT-MEGA-10",
  handle: "it-mega-frizz-hair-spray-bonus-10-oz",
  productUrl: "https://lunaportex.com/products/it-mega-frizz-hair-spray",
}

test("identity cannot be confirmed without an explicit eBay listing", () => {
  const report = buildLunaEbayIdentityComparison({ lunaCandidate })
  assert.equal(report.canConfirmSameProduct, false)
  assert.equal(report.identityComparisonComplete, false)
  assert.deepEqual(report.pendingGuards, ["NEED_EBAY_IDENTITY_REFERENCE"])
})

test("identity requires listing open, observed title and all comparison checks", () => {
  const partial = buildLunaEbayIdentityComparison({
    lunaCandidate,
    ebayListingUrl: "https://www.ebay.com/itm/123456789012",
    ebayObservedTitle: "IT Mega Frizz Hair Spray Bonus 10 oz",
    ebayReferenceOpened: true,
    checklist: {
      sameProductAndBrand: true,
      sameVariantSizeOrPack: true,
      compatibleReference: false,
    },
  })
  assert.equal(partial.canConfirmSameProduct, false)

  const ready = buildLunaEbayIdentityComparison({
    lunaCandidate,
    ebayListingUrl: "https://www.ebay.com/itm/123456789012",
    ebayObservedTitle: "IT Mega Frizz Hair Spray Bonus 10 oz",
    ebayReferenceOpened: true,
    checklist: {
      sameProductAndBrand: true,
      sameVariantSizeOrPack: true,
      compatibleReference: true,
    },
  })
  assert.equal(ready.canConfirmSameProduct, true)
  assert.equal(ready.identityComparisonComplete, false)
})

test("recorded confirmation is traceable to a Luna versus eBay comparison", () => {
  const report = buildLunaEbayIdentityComparison({
    lunaCandidate,
    ebayListingUrl: "https://www.ebay.com/itm/example/123456789012",
    ebayObservedTitle: "IT Mega Frizz Hair Spray Bonus 10 oz",
    ebayReferenceOpened: true,
    checklist: {
      sameProductAndBrand: true,
      sameVariantSizeOrPack: true,
      compatibleReference: true,
    },
    confirmationRecorded: true,
  })
  assert.equal(report.identityComparisonComplete, true)
  assert.equal(report.confirmationSource, "HUMAN_LUNA_EBAY_COMPARISON")
  assert.deepEqual(report.pendingGuards, [])
  assert.equal(report.canProceedToB2RunPreflight, false)
  assert.equal(report.canPublish, false)
})

test("only HTTPS eBay item URLs are accepted", () => {
  assert.equal(
    getSafeEbayListingUrl("https://www.ebay.com/itm/123456789012"),
    "https://www.ebay.com/itm/123456789012"
  )
  assert.equal(getSafeEbayListingUrl("https://example.com/itm/123"), null)
  assert.equal(getSafeEbayListingUrl("http://www.ebay.com/itm/123"), null)
  assert.equal(getSafeEbayListingUrl("https://www.ebay.com/sch/i.html"), null)
})

test("search URL uses only the Luna candidate text", () => {
  assert.equal(
    buildEbayIdentitySearchUrl(lunaCandidate),
    "https://www.ebay.com/sch/i.html?_nkw=IT%20Mega%20Frizz%20Hair%20Spray%20Bonus%2C%2010%20oz."
  )
})

test("mobile UI explains and enforces the two-source comparison", () => {
  assert.match(pageSource, /Listings y keywords que están vendiendo/)
  assert.match(pageSource, /Analizar listings y ventas en eBay/)
  assert.match(pageSource, /Confirmación humana final/)
  assert.match(pageSource, /análisis oficial eBay read-only/)
  assert.match(pageSource, /sameProductAndBrand/)
  assert.match(pageSource, /sameVariantSizeOrPack/)
  assert.match(pageSource, /compatibleReference/)
  assert.match(pageSource, /lunaEbayIdentityComparison: identityComparison/)
})

test("identity comparison remains read-only and contains no external write", () => {
  for (const forbidden of [
    /fetch\s*\(/,
    /method:\s*["']POST["']/,
    /\.insert\s*\(/,
    /\.update\s*\(/,
    /\.upsert\s*\(/,
    /publishOffer\s*\(/,
    /createOffer\s*\(/,
    /process\.env/,
    /access_token/i,
    /refresh_token/i,
  ]) assert.doesNotMatch(moduleSource, forbidden)
})
