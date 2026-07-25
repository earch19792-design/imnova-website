import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  DEFAULT_POST_PUBLICATION_OPTIMIZATION_POLICY,
  diagnosePostPublicationListing,
  postPublicationCooldownElapsed,
  POST_PUBLICATION_OPTIMIZATION_RULESET_VERSION,
  resolvePostPublicationListingStart,
} from "../marketplace/post-publication-optimization-domain.ts"

const ACCOUNT = `seller-test:${"a".repeat(64)}`

function input(overrides = {}) {
  return {
    marketplaceAccountKey: ACCOUNT,
    listingId: "366543596425",
    sku: "ITEM3995",
    listingStatus: "active",
    listingEvidenceStartedAt: "2026-07-01T12:00:00.000Z",
    listingEvidenceStartSource: "EBAY_OFFICIAL_START_TIME",
    observedAt: "2026-07-18T12:00:00.000Z",
    analytics: {
      source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
      completenessStatus: "complete",
      windowStart: "2026-07-11",
      windowEnd: "2026-07-17",
      impressions: 0,
      views: 0,
      transactions: 0,
      sourceDivergenceOpen: false,
    },
    currentWatchers: 0,
    confirmedUnitsSold: 0,
    stockAvailable: 10,
    stockEvidenceFresh: true,
    estimatedMarginPercent: 32,
    ...overrides,
  }
}

function assertSafeSingleChange(diagnostic) {
  assert.ok(diagnostic)
  assert.equal(diagnostic.rulesetVersion, POST_PUBLICATION_OPTIMIZATION_RULESET_VERSION)
  assert.equal(diagnostic.experiment.changeCount, 1)
  assert.equal(diagnostic.experiment.status, "AWAITING_HUMAN_APPROVAL")
  assert.equal(diagnostic.experiment.automaticChangeAllowed, false)
  assert.equal(diagnostic.experiment.ebayWriteAllowed, false)
  assert.equal(diagnostic.experiment.priceDecisionHumanOnly, true)
  assert.equal(diagnostic.safety.causalConclusionAllowed, false)
  assert.equal(diagnostic.safety.competitorRepricingUsed, false)
  assert.equal(diagnostic.safety.automaticPriceChangeAllowed, false)
  assert.equal(diagnostic.safety.automaticListingChangeAllowed, false)
  assert.equal(diagnostic.safety.openAiUsed, false)
  assert.equal(diagnostic.safety.ebayWriteUsed, false)
  assert.equal(diagnostic.safety.humanApprovalRequired, true)
  assert.equal(diagnostic.evidence.changeApplied, false)
  assert.equal(diagnostic.evidence.approvalStatus, "AWAITING_HUMAN_APPROVAL")
  assert.match(diagnostic.evidence.interpretation, /no prueba causalidad/i)
  assert.doesNotMatch(
    JSON.stringify(diagnostic),
    /competitorPrice|competitorListing|recommendedPrice|marketIntelligenceReport/i,
  )
}

test("clasifica cero visibilidad sólo después de edad y ventana oficial completas", () => {
  const diagnostic = diagnosePostPublicationListing(input())
  assert.equal(diagnostic?.classification, "ZERO_VISIBILITY_AFTER_COMPLETE_WINDOW")
  assert.equal(diagnostic?.eventType, "LISTING_ZERO_VISIBILITY_REVIEW")
  assert.equal(diagnostic?.experiment.variable, "CATEGORY")
  assert.equal(diagnostic?.promotionRecommendation.status, "READY_FOR_HUMAN_APPROVAL")
  assert.equal(diagnostic?.promotionRecommendation.recommendedRatePercent, 5)
  assert.equal(diagnostic?.promotionRecommendation.durationDays, 7)
  assertSafeSingleChange(diagnostic)
  assert.deepEqual(diagnostic?.listingAgeEvidence, {
    startedAt: "2026-07-01T12:00:00.000Z",
    ageHours: 408,
    source: "EBAY_OFFICIAL_START_TIME",
    sourceLabel: "FUENTE EBAY",
    conservativeEstimate: false,
    explanation: "Antigüedad calculada desde la fecha oficial de inicio informada por eBay.",
  })

  assert.equal(diagnosePostPublicationListing(input({
    listingEvidenceStartedAt: "2026-07-17T12:00:00.000Z",
  })), null)
  assert.equal(diagnosePostPublicationListing(input({
    analytics: { ...input().analytics, windowStart: "2026-07-15" },
  })), null)
})

test("el registro Seller OS se etiqueta como estimación conservadora y nunca como fecha oficial", () => {
  const diagnostic = diagnosePostPublicationListing(input({
    listingEvidenceStartedAt: "2026-07-10T12:00:00.000Z",
    listingEvidenceStartSource: "SELLER_OS_REGISTRATION_FALLBACK",
  }))
  assert.equal(diagnostic?.listingAgeEvidence.sourceLabel, "ESTIMACIÓN CONSERVADORA")
  assert.equal(diagnostic?.listingAgeEvidence.conservativeEstimate, true)
  assert.match(diagnostic?.listingAgeEvidence.explanation ?? "", /edad mínima/i)
  assert.equal(diagnostic?.evidence.listingEvidenceStartSource, "SELLER_OS_REGISTRATION_FALLBACK")

  assert.equal(diagnosePostPublicationListing(input({
    listingEvidenceStartSource: null,
  })), null)
})

test("el helper prioriza la fecha oficial eBay y usa registro Seller OS sólo como fallback", () => {
  assert.deepEqual(resolvePostPublicationListingStart({
    officialStartTimeCandidates: [null, "2026-07-01T12:00:00Z"],
    sellerOsRegisteredAt: "2026-07-10T12:00:00Z",
  }), {
    timestamp: "2026-07-01T12:00:00.000Z",
    source: "EBAY_OFFICIAL_START_TIME",
  })
  assert.deepEqual(resolvePostPublicationListingStart({
    officialStartTimeCandidates: ["fecha-inválida"],
    sellerOsRegisteredAt: "2026-07-10T12:00:00Z",
  }), {
    timestamp: "2026-07-10T12:00:00.000Z",
    source: "SELLER_OS_REGISTRATION_FALLBACK",
  })
  assert.equal(resolvePostPublicationListingStart({
    officialStartTimeCandidates: [],
    sellerOsRegisteredAt: null,
  }), null)
})

test("clasifica impresiones sin vista y propone únicamente imagen principal", () => {
  const diagnostic = diagnosePostPublicationListing(input({
    analytics: { ...input().analytics, impressions: 100 },
  }))
  assert.equal(diagnostic?.classification, "IMPRESSIONS_WITHOUT_ENGAGEMENT")
  assert.equal(diagnostic?.experiment.variable, "MAIN_IMAGE")
  assert.equal(diagnostic?.promotionRecommendation.recommendedRatePercent, 0)
  assert.deepEqual(diagnostic?.reviewSequence, [
    "Imagen principal", "Título", "Claridad de cantidad y pack",
  ])
  assertSafeSingleChange(diagnostic)
})

test("clasifica vistas sin conversión y deja el precio a valoración humana por costos propios", () => {
  const diagnostic = diagnosePostPublicationListing(input({
    analytics: { ...input().analytics, impressions: 400, views: 30 },
  }))
  assert.equal(diagnostic?.classification, "ENGAGEMENT_WITHOUT_CONVERSION")
  assert.equal(diagnostic?.experiment.variable, "TOTAL_OFFER_PRICE")
  assert.equal(diagnostic?.promotionRecommendation.recommendedRatePercent, 0)
  assert.match(diagnostic?.recommendedAction ?? "", /decisión humana basada en costos propios/i)
  assert.match(diagnostic?.experiment.guardrail ?? "", /Nunca usar precios de competidores/i)
  assertSafeSingleChange(diagnostic)
})

test("prioriza watchers sin venta como interés, nunca como causalidad o venta", () => {
  const diagnostic = diagnosePostPublicationListing(input({
    analytics: { ...input().analytics, impressions: 400, views: 40 },
    currentWatchers: 3,
  }))
  assert.equal(diagnostic?.classification, "WATCHERS_WITHOUT_SALE")
  assert.equal(diagnostic?.experiment.variable, "SHIPPING_OFFER")
  assert.match(diagnostic?.whyItNeedsAttention ?? "", /señal de interés, no una causa ni una venta/i)
  assertSafeSingleChange(diagnostic)
})

test("una venta oficial con stock o margen en riesgo genera excepción operativa inmediata", () => {
  const stockRisk = diagnosePostPublicationListing(input({
    listingEvidenceStartedAt: "2026-07-18T11:00:00.000Z",
    analytics: {
      ...input().analytics,
      source: null,
      completenessStatus: "unavailable",
      windowStart: null,
      windowEnd: null,
      impressions: null,
      views: null,
      transactions: null,
    },
    confirmedUnitsSold: 1,
    stockAvailable: null,
    stockEvidenceFresh: false,
  }))
  assert.equal(stockRisk?.classification, "SALE_WITH_MARGIN_OR_STOCK_RISK")
  assert.equal(stockRisk?.experiment.variable, "LISTING_QUANTITY")
  assert.equal(stockRisk?.cooldownHours, 24)
  assert.equal(stockRisk?.safety.officialAnalyticsRequired, false)
  assertSafeSingleChange(stockRisk)

  const staleStock = diagnosePostPublicationListing(input({
    confirmedUnitsSold: 1,
    stockAvailable: 20,
    stockEvidenceFresh: false,
  }))
  assert.equal(staleStock?.experiment.variable, "LISTING_QUANTITY")
  assert.equal(staleStock?.evidence.stockEvidenceFresh, false)

  const marginRisk = diagnosePostPublicationListing(input({
    confirmedUnitsSold: 1,
    stockAvailable: 20,
    estimatedMarginPercent: 12,
  }))
  assert.equal(marginRisk?.experiment.variable, "TOTAL_OFFER_PRICE")
  assert.match(marginRisk?.recommendedAction ?? "", /no se aplicará repricing automático/i)
})

test("muestra insuficiente, fuente incompleta o divergente no produce diagnóstico comercial", () => {
  assert.equal(diagnosePostPublicationListing(input({
    analytics: { ...input().analytics, impressions: 99, views: 1 },
  })), null)
  assert.equal(diagnosePostPublicationListing(input({
    analytics: { ...input().analytics, completenessStatus: "incomplete" },
  })), null)
  assert.equal(diagnosePostPublicationListing(input({
    analytics: { ...input().analytics, sourceDivergenceOpen: true },
  })), null)
  assert.equal(diagnosePostPublicationListing(input({
    analytics: { ...input().analytics, source: "MANUAL_SCREENSHOT" },
  })), null)
  assert.equal(diagnosePostPublicationListing(input({ listingStatus: "ended" })), null)
})

test("cooldown deduplica dentro de la ventana y permite nueva revisión después", () => {
  const first = diagnosePostPublicationListing(input())
  const sameWindow = diagnosePostPublicationListing(input({
    observedAt: "2026-07-18T13:00:00.000Z",
  }))
  const nextWindow = diagnosePostPublicationListing(input({
    observedAt: "2026-07-26T12:00:00.000Z",
    analytics: {
      ...input().analytics,
      windowStart: "2026-07-19",
      windowEnd: "2026-07-25",
    },
  }))
  assert.equal(first?.deduplicationKey, sameWindow?.deduplicationKey)
  assert.notEqual(first?.deduplicationKey, nextWindow?.deduplicationKey)
  assert.equal(first?.cooldownHours, DEFAULT_POST_PUBLICATION_OPTIMIZATION_POLICY.optimizationCooldownHours)
  assert.equal(first?.nextEligibleAt, "2026-07-25T12:00:00.000Z")
  assert.equal(postPublicationCooldownElapsed({
    previousDetectedAt: "2026-07-22T23:30:00.000Z",
    currentDetectedAt: "2026-07-23T00:30:00.000Z",
    cooldownHours: 168,
  }), false)
  assert.equal(postPublicationCooldownElapsed({
    previousDetectedAt: "2026-07-15T00:30:00.000Z",
    currentDetectedAt: "2026-07-23T00:30:00.000Z",
    cooldownHours: 168,
  }), true)
})

test("Commercial Monitor crea tarea accionable in-app y la envía por WhatsApp sin aplicarla solo", () => {
  const service = readFileSync("lib/ebay/ebay-commercial-monitor-service.ts", "utf8")
  const panel = readFileSync(
    "app/admin/ebay/mobile-review/commercial-monitor-panel.tsx",
    "utf8",
  )
  assert.match(service, /diagnosePostPublicationListing\(\{/)
  assert.match(service, /channel: "in_app"/)
  assert.match(service, /channel: "whatsapp"/)
  assert.match(service, /sellerImprovementUrl/)
  assert.match(service, /whatsappEnqueued: true/)
  assert.match(service, /changeApplied: false/)
  assert.match(service, /POST_PUBLICATION_OPTIMIZATION_EVENT_TYPES/)
  assert.match(panel, /Listings que necesitan atención/)
  assert.match(panel, /Por qué:/)
  assert.match(panel, /Experimento propuesto · una sola variable/)
  assert.match(panel, /Requiere aprobación humana\. No prueba causalidad y no se aplicó ningún cambio\./)
  assert.doesNotMatch(panel, /Aplicar optimización automáticamente/)
  assert.match(panel, /REVISAR Y AUTORIZAR PROMOCIÓN 5%/)
})

test("la excepción de margen 10% bloquea toda promoción aunque no haya visibilidad", () => {
  const diagnostic = diagnosePostPublicationListing(input({
    promotionAllowed: false,
    estimatedMarginPercent: 10,
  }))
  assert.equal(diagnostic?.promotionRecommendation.status, "BLOCKED_CONTROLLED_RISK")
  assert.equal(diagnostic?.promotionRecommendation.recommendedRatePercent, 0)
  assert.match(diagnostic?.promotionRecommendation.reason ?? "", /No hay margen/i)
})

test("Commercial Monitor distingue inicio oficial eBay del fallback conservador Seller OS", () => {
  const service = readFileSync("lib/ebay/ebay-commercial-monitor-service.ts", "utf8")
  const panel = readFileSync(
    "app/admin/ebay/mobile-review/commercial-monitor-panel.tsx",
    "utf8",
  )
  assert.match(service, /function listingAgeEvidenceStart\(listing: ListingRow\)/)
  assert.match(service, /resolvePostPublicationListingStart\(\{/)
  assert.match(service, /listingEvidenceStartSource: listingAgeStart\?\.source \?\? null/)
  assert.match(service, /listingAgeEvidence: diagnostic\.listingAgeEvidence/)
  assert.match(panel, /FUENTE EBAY/)
  assert.match(panel, /ESTIMACIÓN CONSERVADORA/)
  assert.match(panel, /el listing puede ser más antiguo/i)
})
