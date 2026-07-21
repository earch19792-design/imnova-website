import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildActiveMarketPriceRecommendation,
  buildConfirmedSoldPriceRecommendation,
  buildCompetitorWatchAnalysis,
} from "./ebay-competitor-watch-domain.ts"
import {
  ebaySourceListingReferenceHash,
} from "./ebay-competitor-watch-fingerprints.ts"
import {
  normalizeEbayActiveCompetitorObservations,
} from "./ebay-competitor-watch-normalization.ts"

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
      itemPrice: 25,
      landedPrice: 25,
      shippingCost: 0,
      packQuantity: 1,
      supplierUnitCost: 5,
      supplierCostFresh: true,
      supplierAvailable: true,
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
  assert.equal(result.priceRecommendation, null)
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
      itemPrice: 27,
      landedPrice: 35,
      shippingCost: 8,
      packQuantity: 1,
      supplierUnitCost: 5,
      supplierCostFresh: true,
      supplierAvailable: true,
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
      itemPrice: 27,
      landedPrice: 35,
      shippingCost: 8,
      packQuantity: 1,
      supplierUnitCost: 5,
      supplierCostFresh: true,
      supplierAvailable: true,
      returnsAccepted: false,
      imageCount: 1,
      title: "Universal nozzle",
    },
  })
  assert.ok(twoSellers.suggestionCodes.includes("REVIEW_FREE_SHIPPING_COMMON_PATTERN"))
  assert.ok(twoSellers.suggestionCodes.includes("REVIEW_RETURNS_ACCEPTED_COMMON_PATTERN"))
  assert.ok(twoSellers.suggestionCodes.includes("REVIEW_MULTI_IMAGE_COMMON_PATTERN"))
})

test("una mejora accionable detectada en la línea base se alerta una sola vez", () => {
  const result = analyze({
    observations: [
      observation({ landedPrice: 14, price: 14 }),
      observation({
        itemReferenceHash: `sha256:${"3".repeat(64)}`,
        sellerReferenceHash: `hmac-sha256:${"4".repeat(64)}`,
        landedPrice: 14.04,
        price: 14.04,
      }),
    ],
    ownListing: {
      itemPrice: 20,
      landedPrice: 20,
      shippingCost: 0,
      packQuantity: 1,
      supplierUnitCost: 5,
      supplierCostFresh: true,
      supplierAvailable: true,
      returnsAccepted: true,
      imageCount: 5,
      title: "Universal nozzle",
    },
  })
  assert.equal(result.baselineEstablished, true)
  assert.ok(result.newSuggestionCodes.includes("REVIEW_MARKET_PRICE_POSITION"))
  assert.equal(result.alertRequired, true)
})

test("una recomendación activa nueva alerta aunque el patrón de precio ya existía", () => {
  const result = analyze({
    baselineExists: true,
    previousSuggestionCodes: ["REVIEW_MARKET_PRICE_POSITION"],
    observations: [
      observation({ landedPrice: 14, price: 14 }),
      observation({
        itemReferenceHash: `sha256:${"3".repeat(64)}`,
        sellerReferenceHash: `hmac-sha256:${"4".repeat(64)}`,
        landedPrice: 14.04,
        price: 14.04,
      }),
      observation({
        itemReferenceHash: `sha256:${"5".repeat(64)}`,
        sellerReferenceHash: `hmac-sha256:${"6".repeat(64)}`,
        landedPrice: 14.02,
        price: 14.02,
      }),
    ],
    ownListing: {
      itemPrice: 17.4,
      landedPrice: 17.4,
      shippingCost: 0,
      packQuantity: 1,
      supplierUnitCost: 0.78,
      supplierCostFresh: true,
      supplierAvailable: true,
      returnsAccepted: true,
      imageCount: 5,
      title: "3PCS Sister Keychains Set",
      promotionAllowed: true,
    },
  })
  assert.deepEqual(result.newSuggestionCodes, [])
  assert.equal(result.activeMarketPriceRecommendation?.action,
    "LOWER_TO_ACTIVE_MARKET_CONTROLLED_RISK_PRICE")
  assert.equal(result.alertRequired, true)
  assert.ok(result.eventFingerprint)
})

test("tres vendedores activos permiten competir con margen controlado de 10% y sin promoción", () => {
  const recommendation = buildActiveMarketPriceRecommendation({
    medianLandedPrice: 14.02,
    activeSellerCount: 3,
    ownListing: {
      itemPrice: 17.4,
      landedPrice: 17.4,
      shippingCost: 0,
      packQuantity: 1,
      supplierUnitCost: 0.78,
      supplierCostFresh: true,
      supplierAvailable: true,
      returnsAccepted: true,
      imageCount: 5,
      title: "3PCS Sister Keychains Set",
      promotionAllowed: true,
    },
  })
  assert.equal(recommendation?.action,
    "LOWER_TO_ACTIVE_MARKET_CONTROLLED_RISK_PRICE")
  assert.equal(recommendation?.minimumSafeLandedPrice, 11.56)
  assert.equal(recommendation?.standardMinimumSafeLandedPrice, 17.4)
  assert.equal(recommendation?.floorWithoutPromotion, 16.32)
  assert.equal(recommendation?.activeMarketMedianLandedPrice, 14.02)
  assert.equal(recommendation?.canReachActiveMarketSafely, true)
  assert.equal(recommendation?.controlledRiskTenPercent, true)
  assert.equal(recommendation?.promotionReserveIncluded, false)
  assert.equal(recommendation?.proposedPassesProfitGate, true)
  assert.equal(recommendation?.proposedEstimatedNetProfit, 3.14)
  assert.equal(recommendation?.proposedEstimatedMarginPercent, 22.43)
  assert.equal(recommendation?.activeMarketNotConfirmedSale, true)
})

test("la aceptación puede bajar al piso cuando el precio actual sí deja espacio", () => {
  const recommendation = buildActiveMarketPriceRecommendation({
    medianLandedPrice: 14.02,
    activeSellerCount: 2,
    ownListing: {
      itemPrice: 20,
      landedPrice: 20,
      shippingCost: 0,
      packQuantity: 1,
      supplierUnitCost: 0.78,
      supplierCostFresh: true,
      supplierAvailable: true,
      returnsAccepted: true,
      imageCount: 5,
      title: "3PCS Sister Keychains Set",
      promotionAllowed: true,
    },
  })
  assert.equal(recommendation?.action,
    "LOWER_TO_ACTIVE_MARKET_SAFE_PRICE")
  assert.equal(recommendation?.proposedItemPrice, 17.4)
  assert.equal(recommendation?.proposedPassesProfitGate, true)
  assert.equal(recommendation?.automaticPriceChangeAllowed, false)
})

test("recomienda precio sólo con venta exacta reciente, pack comparable y costo Luna fresco", () => {
  const result = analyze({
    baselineExists: true,
    observations: [observation({
      evidenceClass: "CONFIRMED_SOLD_HISTORY",
      confirmedSoldQuantity: 6,
      confirmedSoldLastDate: "2026-07-20T00:00:00.000Z",
      confirmedSoldItemPrice: 30,
      confirmedSoldShippingCost: 0,
      confirmedSoldLandedPrice: 30,
      confirmedSoldOfferPackCount: 1,
    })],
  })
  assert.equal(result.priceRecommendation?.action, "RAISE_TO_CONFIRMED_SOLD_BAND")
  assert.equal(result.priceRecommendation?.proposedItemPrice, 30)
  assert.equal(result.priceRecommendation?.confirmedSoldQuantity, 6)
  assert.equal(result.priceRecommendation?.comparisonBasis,
    "PRODUCT_RESEARCH_CONFIRMED_SOLD_LANDED_PRICE")
  assert.equal(result.priceRecommendation?.activeOfferPriceTreatedAsSoldPrice, false)
  assert.equal(result.priceRecommendation?.automaticPriceChangeAllowed, false)
  assert.equal(result.priceRecommendation?.promotionRecommendation.recommendedRatePercent, 5)
  assert.equal(result.priceRecommendation?.promotionRecommendation.automaticPromotionAllowed, false)
  assert.ok(result.suggestionCodes.includes(
    "REVIEW_CONFIRMED_SOLD_PRICE_RECOMMENDATION"))
  assert.equal(result.alertRequired, true)
})

test("baja hacia la banda vendida sólo cuando la banda conserva el piso económico", () => {
  const recommendation = buildConfirmedSoldPriceRecommendation({
    observations: [observation({
      evidenceClass: "CONFIRMED_SOLD_HISTORY",
      confirmedSoldQuantity: 4,
      confirmedSoldLastDate: "2026-07-20T00:00:00.000Z",
      confirmedSoldLandedPrice: 25,
      confirmedSoldOfferPackCount: 1,
    })],
    ownListing: {
      itemPrice: 35,
      landedPrice: 35,
      shippingCost: 0,
      packQuantity: 1,
      supplierUnitCost: 5,
      supplierCostFresh: true,
      supplierAvailable: true,
      returnsAccepted: true,
      imageCount: 5,
      title: "Exact product one pack",
    },
    observedAt,
  })
  assert.equal(recommendation?.action, "LOWER_TO_CONFIRMED_SOLD_BAND")
  assert.equal(recommendation?.proposedItemPrice, 25)
  assert.equal(recommendation?.proposedPassesProfitGate, true)
})

test("no persigue un precio vendido que rompe el piso económico propio", () => {
  const result = analyze({
    baselineExists: true,
    observations: [observation({
      evidenceClass: "CONFIRMED_SOLD_HISTORY",
      confirmedSoldQuantity: 3,
      confirmedSoldLastDate: "2026-07-20T00:00:00.000Z",
      confirmedSoldLandedPrice: 20,
      confirmedSoldOfferPackCount: 1,
    })],
  })
  assert.equal(result.priceRecommendation?.action,
    "DO_NOT_MATCH_BELOW_ECONOMIC_FLOOR")
  assert.equal(result.priceRecommendation?.proposedItemPrice, 25)
  assert.ok((result.priceRecommendation?.minimumSafeLandedPrice ?? 0) > 20)
  assert.equal(result.priceRecommendation?.promotionRecommendation.recommendedRatePercent, 5)
})

test("un listing de margen 10% mantiene promoción bloqueada aunque el mercado mejore", () => {
  const recommendation = buildConfirmedSoldPriceRecommendation({
    observations: [observation({
      evidenceClass: "CONFIRMED_SOLD_HISTORY",
      confirmedSoldQuantity: 8,
      confirmedSoldLastDate: "2026-07-20T00:00:00.000Z",
      confirmedSoldLandedPrice: 45,
      confirmedSoldOfferPackCount: 1,
    })],
    ownListing: {
      itemPrice: 32.55,
      landedPrice: 32.55,
      shippingCost: 0,
      packQuantity: 1,
      supplierUnitCost: 5,
      supplierCostFresh: true,
      supplierAvailable: true,
      returnsAccepted: false,
      imageCount: 6,
      title: "Controlled risk product",
      promotionAllowed: false,
    },
    observedAt,
  })
  assert.equal(recommendation?.promotionRecommendation.recommendedRatePercent, 0)
  assert.equal(recommendation?.promotionRecommendation.status,
    "BLOCKED_CONTROLLED_RISK_TEN_PERCENT_MARGIN")
  assert.match(recommendation?.promotionRecommendation.reason ?? "",
    /No hay margen para aplicar promoción/)
})

test("venta vieja, pack distinto o desconocido y costo Luna vencido no producen precio", () => {
  const confirmed = observation({
    evidenceClass: "CONFIRMED_SOLD_HISTORY",
    confirmedSoldQuantity: 10,
    confirmedSoldLastDate: "2026-07-20T00:00:00.000Z",
    confirmedSoldLandedPrice: 30,
    confirmedSoldOfferPackCount: 1,
  })
  const ownListing = {
    itemPrice: 25,
    landedPrice: 25,
    shippingCost: 0,
    packQuantity: 1,
    supplierUnitCost: 5,
    supplierCostFresh: true,
    supplierAvailable: true,
    returnsAccepted: true,
    imageCount: 5,
    title: "Exact product one pack",
  }
  const invalidCases = [
    { observation: { ...confirmed, confirmedSoldLastDate: "2026-01-01T00:00:00.000Z" }, ownListing },
    { observation: { ...confirmed, confirmedSoldOfferPackCount: 2 }, ownListing },
    { observation: { ...confirmed, confirmedSoldOfferPackCount: null }, ownListing },
    { observation: confirmed, ownListing: { ...ownListing, supplierCostFresh: false } },
  ]
  for (const invalid of invalidCases) {
    assert.equal(buildConfirmedSoldPriceRecommendation({
      observations: [invalid.observation],
      ownListing: invalid.ownListing,
      observedAt,
    }), null)
  }
})

test("el Item ID REST y el legacy producen la misma referencia de Research", () => {
  assert.equal(
    ebaySourceListingReferenceHash("v1|366543596425|0"),
    ebaySourceListingReferenceHash("366543596425"),
  )
})

test("variaciones repetidas e inputs de pack inválidos se normalizan antes del upsert", () => {
  const normalized = normalizeEbayActiveCompetitorObservations([
    observation({ packQuantity: 0, imageCount: 2.5 }),
    observation({
      packQuantity: 1.5,
      imageCount: 4,
      evidenceClass: "ESTIMATED_ACTIVITY",
      estimatedSoldQuantity: 3.8,
    }),
  ])
  assert.equal(normalized.length, 1)
  assert.equal(normalized[0].packQuantity, null)
  assert.equal(normalized[0].imageCount, 4)
  assert.equal(normalized[0].estimatedSoldQuantity, 3)
  assert.equal(normalized[0].evidenceClass, "ESTIMATED_ACTIVITY")
})

test("una línea base incompleta se reconstruye y un parcial obtiene reintento corto", () => {
  const service = readFileSync(
    new URL("./ebay-competitor-watch-service.ts", import.meta.url),
    "utf8",
  )
  const monitor = readFileSync(
    new URL("./ebay-commercial-monitor-service.ts", import.meta.url),
    "utf8",
  )
  assert.match(service, /baselineHistoryComplete/)
  assert.match(service, /persistedActiveOfferCount/)
  assert.match(service, /baselineExists: baselineHistoryComplete/)
  assert.match(monitor, /COMPETITOR_PARTIAL_RETRY_MINUTES = 15/)
  assert.match(monitor, /competitorPartialRetryDue/)
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

test("la recomendación confirmada se envía por WhatsApp con margen y aprobación humana", () => {
  const service = readFileSync(
    new URL("./ebay-competitor-watch-service.ts", import.meta.url),
    "utf8",
  )
  assert.match(service, /COMPETITOR_CONFIRMED_SOLD_PRICE_RECOMMENDATION/)
  assert.match(service, /Recomendación de precio · competidor con venta confirmada/)
  assert.match(service, /confirmedSoldBenchmarkLandedPrice/)
  assert.match(service, /minimumSafeLandedPrice/)
  assert.match(service, /Requiere revisión humana; no se modificó eBay/)
  assert.match(service, /currentActiveOfferPriceUsedAsSoldPrice: false/)
  assert.match(service, /COMPETITOR_ACTIVE_MARKET_PRICE_RECOMMENDATION/)
  assert.match(service, /piso seguro/)
  const monitor = readFileSync(
    new URL("./ebay-commercial-monitor-service.ts", import.meta.url),
    "utf8",
  )
  assert.match(monitor, /confirmedSoldPriceRecommendations/)
  assert.match(monitor, /confirmedSoldPriceRequired: true/)
  assert.match(monitor, /ownCostFloorRequired: true/)
})
