import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildCompetitorWatchAnalysis,
} from "./ebay-competitor-watch-domain.ts"
import {
  ebaySourceListingReferenceHash,
} from "./ebay-competitor-watch-fingerprints.ts"

const observedAt = "2026-07-21T03:00:00.000Z"

function observation(overrides = {}) {
  return {
    itemReferenceHash: `sha256:${"1".repeat(64)}`,
    sellerReferenceHash: `hmac-sha256:${"2".repeat(64)}`,
    identityMatchQuality: "EXACT_IDENTIFIER",
    evidenceClass: "ACTIVE_ONLY",
    price: 25,
    shippingCost: 0,
    landedPrice: 25,
    returnsAccepted: true,
    imageCount: 5,
    packQuantity: 1,
    sellerFeedbackBand: "ESTABLISHED",
    estimatedSoldQuantity: 0,
    ...overrides,
  }
}

function analyze(overrides = {}) {
  return buildCompetitorWatchAnalysis({
    observations: [observation()],
    previousOffers: [],
    baselineExists: false,
    ownListing: {
      landedPrice: 25,
      shippingCost: 0,
      returnsAccepted: true,
      imageCount: 5,
      title: "Universal turbo pressure washer nozzle 4500 PSI",
    },
    crossSellerCandidateConfirmedTerms: [],
    previousSuggestionCodes: [],
    lastResearchRefreshRecommendedAt: null,
    observedAt,
    ...overrides,
  })
}

test("la primera lectura crea línea base sin alertas ni ventas inventadas", () => {
  const result = analyze()
  assert.equal(result.baselineEstablished, true)
  assert.equal(result.alertRequired, false)
  assert.equal(result.confirmedSoldSellerCount, 0)
  assert.equal(result.evidenceClass, "ACTIVE_ONLY")
  assert.equal(result.safeguards.activeOfferTreatedAsSale, false)
  assert.equal(result.safeguards.automaticProductResearchImport, false)
})

test("un vendedor nuevo sin señal fuerte espera una segunda lectura", () => {
  const firstDiscovery = analyze({ baselineExists: true })
  assert.equal(firstDiscovery.newSellerHashes.length, 1)
  assert.equal(firstDiscovery.potentialSellerHashes.length, 0)
  assert.equal(firstDiscovery.researchRefreshRecommended, false)

  const secondDiscovery = analyze({
    baselineExists: true,
    previousOffers: [{
      itemReferenceHash: `sha256:${"1".repeat(64)}`,
      sellerReferenceHash: `hmac-sha256:${"2".repeat(64)}`,
      active: true,
      firstSeenAsBaseline: false,
      consecutiveScanCount: 1,
      potentialNotifiedAt: null,
      evidenceClass: "ACTIVE_ONLY",
    }],
  })
  assert.equal(secondDiscovery.potentialSellerHashes.length, 1)
  assert.equal(secondDiscovery.researchRefreshRecommended, true)
  assert.equal(secondDiscovery.alertRequired, true)
})

test("actividad estimada acelera revisión pero nunca se llama venta confirmada", () => {
  const result = analyze({
    baselineExists: true,
    observations: [observation({
      evidenceClass: "ESTIMATED_ACTIVITY",
      estimatedSoldQuantity: 3,
    })],
  })
  assert.equal(result.potentialSellerHashes.length, 1)
  assert.equal(result.evidenceClass, "ESTIMATED_ACTIVITY")
  assert.equal(result.confirmedSoldSellerCount, 0)
  assert.equal(result.researchRefreshRecommended, true)
})

test("match de Product Research confirma venta y evita pedir otra captura", () => {
  const result = analyze({
    baselineExists: true,
    observations: [observation({
      evidenceClass: "CONFIRMED_SOLD_HISTORY",
      confirmedSoldQuantity: 4,
      confirmedSoldLastDate: "2026-07-20T00:00:00.000Z",
    })],
    previousOffers: [{
      itemReferenceHash: `sha256:${"1".repeat(64)}`,
      sellerReferenceHash: `hmac-sha256:${"2".repeat(64)}`,
      active: true,
      firstSeenAsBaseline: false,
      consecutiveScanCount: 1,
      potentialNotifiedAt: null,
      evidenceClass: "ACTIVE_ONLY",
    }],
  })
  assert.equal(result.confirmedSoldSellerCount, 1)
  assert.equal(result.newlyConfirmedOfferHashes.length, 1)
  assert.equal(result.researchRefreshRecommended, false)
  assert.equal(result.alertRequired, true)
})

test("las mejoras sólo nacen de patrones repetidos entre vendedores", () => {
  const oneSeller = analyze({
    baselineExists: true,
    ownListing: {
      landedPrice: 35,
      shippingCost: 8,
      returnsAccepted: false,
      imageCount: 1,
      title: "Universal nozzle",
    },
  })
  assert.deepEqual(oneSeller.suggestionCodes, [])

  const twoSellers = analyze({
    baselineExists: true,
    observations: [
      observation(),
      observation({
        itemReferenceHash: `sha256:${"3".repeat(64)}`,
        sellerReferenceHash: `hmac-sha256:${"4".repeat(64)}`,
        landedPrice: 27,
        price: 27,
      }),
    ],
    ownListing: {
      landedPrice: 35,
      shippingCost: 8,
      returnsAccepted: false,
      imageCount: 1,
      title: "Universal nozzle",
    },
  })
  assert.ok(twoSellers.suggestionCodes.includes("REVIEW_FREE_SHIPPING_COMMON_PATTERN"))
  assert.ok(twoSellers.suggestionCodes.includes("REVIEW_RETURNS_ACCEPTED_COMMON_PATTERN"))
  assert.ok(twoSellers.suggestionCodes.includes("REVIEW_MULTI_IMAGE_COMMON_PATTERN"))
})

test("el Item ID REST y el legacy producen la misma referencia de Research", () => {
  assert.equal(
    ebaySourceListingReferenceHash("v1|366543596425|0"),
    ebaySourceListingReferenceHash("366543596425"),
  )
})

test("el esquema prohíbe contenido crudo y cualquier escritura en eBay", () => {
  const migration = readFileSync(
    new URL("../../supabase/migrations/20260721030000_create_ebay_listing_competitor_watch.sql", import.meta.url),
    "utf8",
  )
  assert.match(migration, /force row level security/g)
  assert.match(migration, /raw_competitor_titles_stored = false/)
  assert.match(migration, /raw_seller_usernames_stored = false/)
  assert.match(migration, /active_offer_treated_as_sale = false/)
  assert.match(migration, /automatic_product_research_import = false/)
  assert.match(migration, /automatic_ebay_mutation = false/)
  assert.match(migration, /ebay_writes = 0/g)
  assert.doesNotMatch(migration, /seller_username\s+text|competitor_title\s+text|item_url\s+text/i)
})
