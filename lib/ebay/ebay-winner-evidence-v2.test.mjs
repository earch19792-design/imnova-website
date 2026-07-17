import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildProductIdentityFingerprint,
  buildWinnerEvidenceDecisionPackage,
  classifyWinnerComparable,
  validateGtinChecksum,
  WINNER_ECONOMICS_CONFIG,
} from "./ebay-winner-evidence-v2.ts"
import { buildEbaySellerKeywordDemandValidation } from "./ebay-seller-keyword-demand-validation.ts"

const targetIdentity = {
  manufacturerBrand: "Lysol",
  distributor: "Luna Portex",
  vendor: "Luna Portex",
  gtin: "036000291452",
  mpn: "LEMON-15",
  model: "WIPES-LEMON",
  productName: "Lysol Disinfecting Wipes Lemon",
  packCount: 3,
  unitCount: 15,
  size: "15 count",
  color: "Yellow",
  scent: "Lemon",
  variant: "Disinfecting wipes",
  condition: "New",
}

function comparable(overrides = {}) {
  return {
    source: "EBAY_BROWSE_ACTIVE_LISTING",
    sourceListingId: "v1|123456789012|0",
    observedAt: "2026-07-16T12:00:00.000Z",
    identity: { ...targetIdentity },
    itemPrice: 30,
    shippingCost: 0,
    currency: "USD",
    confirmedSoldQuantity: null,
    estimatedSoldQuantity: null,
    keywords: ["lysol wipes", "lemon wipes"],
    evidenceReviewed: true,
    ...overrides,
  }
}

function visualEvidence(overrides = {}) {
  return {
    imageCount: 6,
    mainImageBackground: "WHITE",
    productCoverageEstimate: 78,
    fullPackVisible: true,
    unitCountVisible: true,
    packageFrontVisible: true,
    textDensity: "LOW",
    infographicPresence: true,
    dimensionsImage: true,
    contentsImage: true,
    lifestyleImage: false,
    useContextImage: true,
    handsOrPeoplePresent: false,
    visibleClaims: [],
    visualClutter: "LOW",
    imageConsistency: "HIGH",
    mainImageClarity: "HIGH",
    observableVisualRisks: [],
    evidenceLevel: "HIGH",
    observedAt: "2026-07-16T12:00:00.000Z",
    sourceType: "HUMAN_REVIEWED_OBSERVATION",
    ...overrides,
  }
}

function input(overrides = {}) {
  return {
    marketplaceAccountKey: "seller:" + "a".repeat(64),
    candidateId: null,
    supplierSku: "ITEM3995",
    supplierVariantId: "luna-variant-item3995",
    identity: targetIdentity,
    supplierPackageCost: 10,
    packagingCost: 1,
    outboundShippingCost: 5,
    fixedFulfillmentCost: 0,
    authorizedKeywords: ["lysol wipes", "lemon wipes", "15 count", "3 pack", "disinfecting wipes"],
    requiredKeywordCount: 5,
    stockAvailable: 8,
    stockObservedAt: "2026-07-16T11:00:00.000Z",
    costObservedAt: "2026-07-16T11:00:00.000Z",
    complianceBlocked: false,
    comparables: [
      comparable(),
      comparable({
        source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
        sourceListingId: "sold-1",
        itemPrice: 32,
        confirmedSoldQuantity: 8,
      }),
    ],
    now: "2026-07-16T12:30:00.000Z",
    ...overrides,
  }
}

test("validates GTIN checksum and rejects malformed identifiers", () => {
  assert.equal(validateGtinChecksum("036000291452"), true)
  assert.equal(validateGtinChecksum("036000291453"), false)
  assert.equal(validateGtinChecksum("123"), false)
  assert.equal(validateGtinChecksum("not-a-gtin"), false)
})

test("identity fingerprint is stable, versioned and excludes commercial fields", () => {
  const first = buildProductIdentityFingerprint({
    ...targetIdentity,
    distributor: "Distributor A",
    vendor: "Vendor A",
    price: 10,
    stock: 5,
    url: "https://supplier.invalid/a",
    seoTitle: "SEO title A",
  })
  const second = buildProductIdentityFingerprint({
    ...targetIdentity,
    distributor: "Distributor B",
    vendor: "Vendor B",
    price: 999,
    stock: 0,
    url: "https://supplier.invalid/b",
    seoTitle: "SEO title B",
  })
  assert.match(first.fingerprint, /^sha256:[0-9a-f]{64}$/)
  assert.equal(first.version, "EBAY_PRODUCT_IDENTITY_FINGERPRINT_V2")
  assert.equal(first.fingerprint, second.fingerprint)
  assert.equal(first.identity.distributor, "distributor a")
  assert.equal(first.identity.vendor, "vendor a")
})

test("exact GTIN cannot hide a different pack", () => {
  const result = classifyWinnerComparable(targetIdentity, {
    ...targetIdentity,
    packCount: 2,
  })
  assert.equal(result.classification, "DIFFERENT_PACK")
})

test("exact GTIN cannot hide scent, color, size or variant differences", () => {
  for (const change of [
    { scent: "Lavender" },
    { color: "Blue" },
    { size: "35 count" },
    { variant: "Multi-purpose wipes" },
  ]) {
    const result = classifyWinnerComparable(targetIdentity, {
      ...targetIdentity,
      ...change,
    })
    assert.equal(result.classification, "DIFFERENT_VARIANT")
  }
})

test("active, confirmed sold and estimated signals remain separate cohorts", () => {
  const result = buildWinnerEvidenceDecisionPackage(input({
    comparables: [
      comparable(),
      comparable({
        source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
        sourceListingId: "sold-1",
        confirmedSoldQuantity: 4,
      }),
      comparable({
        source: "EBAY_BROWSE_ESTIMATED_SALES",
        sourceListingId: "estimated-1",
        estimatedSoldQuantity: 9,
      }),
    ],
  }))
  assert.equal(result.comparables.cohorts.ACTIVE_EXACT_MATCHES.length, 1)
  assert.equal(result.comparables.cohorts.SOLD_OR_COMPLETED_EXACT_MATCHES.length, 1)
  assert.equal(result.comparables.cohorts.ESTIMATED_DEMAND_SIGNALS.length, 1)
  assert.equal(result.comparables.cohorts.ESTIMATED_DEMAND_SIGNALS[0].confirmedSoldQuantity, null)
  assert.equal(result.comparables.cohorts.SOLD_OR_COMPLETED_EXACT_MATCHES[0].estimatedSoldQuantity, null)
})

test("uses competitor titles transiently but never stores them in the decision package", () => {
  const competitorTitle = "Competitor SEO title that must not be persisted verbatim"
  const result = buildWinnerEvidenceDecisionPackage(input({
    comparables: [
      comparable({
        identity: {
          ...targetIdentity,
          productName: competitorTitle,
        },
      }),
    ],
  }))
  const stored = result.comparables.classified[0]
  assert.equal(stored.classification, "EXACT_MATCH")
  assert.equal(stored.identity.normalizedProductName, null)
  assert.equal(stored.identity.distributor, null)
  assert.equal(stored.identity.vendor, null)
  assert.equal(stored.competitorTitleStored, false)
  assert.doesNotMatch(JSON.stringify(stored), new RegExp(competitorTitle))
})

test("reviewed imports can be sold evidence and unreviewed imports are invalid", () => {
  const result = buildWinnerEvidenceDecisionPackage(input({
    comparables: [
      comparable({
        source: "EBAY_OFFICIAL_CSV_IMPORT",
        sourceListingId: "csv-1",
        confirmedSoldQuantity: 3,
        evidenceReviewed: true,
      }),
      comparable({
        source: "EBAY_OFFICIAL_JSON_IMPORT",
        sourceListingId: "json-1",
        confirmedSoldQuantity: 4,
        evidenceReviewed: false,
      }),
    ],
  }))
  assert.equal(result.comparables.cohorts.SOLD_OR_COMPLETED_EXACT_MATCHES.length, 1)
  assert.equal(result.comparables.classified[1].classification, "INVALID_COMPARABLE")
})

test("uses one canonical economics policy with required minimums", () => {
  assert.deepEqual(
    {
      minimumProfitUsd: WINNER_ECONOMICS_CONFIG.minimumProfitUsd,
      idealProfitUsd: WINNER_ECONOMICS_CONFIG.idealProfitUsd,
      minimumRoiPercent: WINNER_ECONOMICS_CONFIG.minimumRoiPercent,
      minimumNetMarginPercent: WINNER_ECONOMICS_CONFIG.minimumNetMarginPercent,
    },
    {
      minimumProfitUsd: 5,
      idealProfitUsd: 7,
      minimumRoiPercent: 30,
      minimumNetMarginPercent: 20,
    },
  )
  const result = buildWinnerEvidenceDecisionPackage(input())
  assert.ok(result.economics.minimumSafePrice >= 5)
  assert.ok(result.economics.idealSafePrice >= result.economics.minimumSafePrice)
  assert.ok(result.economics.targetPrice >= result.economics.idealSafePrice)
  assert.equal(result.economics.targetEconomics.passes, true)
  assert.equal(result.economics.marketSupportsMinimumSafePrice, true)
  assert.equal(result.economics.viable, true)
})

test("market evidence below the minimum safe price blocks an insufficient-margin product", () => {
  const result = buildWinnerEvidenceDecisionPackage(input({
    supplierPackageCost: 17.82,
    packagingCost: 0,
    outboundShippingCost: 6.99,
    fixedFulfillmentCost: 0,
    comparables: [
      comparable({ itemPrice: 33.50 }),
      comparable({ sourceListingId: "active-low-margin-2", itemPrice: 34.85 }),
    ],
  }))
  assert.ok(result.economics.minimumSafePrice > result.economics.activeMarketMedian)
  assert.equal(result.economics.marketSupportsMinimumSafePrice, false)
  assert.equal(result.economics.viable, false)
  assert.equal(result.decision.verdict, "NO_GO")
  assert.ok(result.decision.blockers.includes("MARKET_PRICE_BELOW_MINIMUM_SAFE_PRICE"))
})

test("ROI remains an economic percentage and is not capped at one hundred", () => {
  const result = buildWinnerEvidenceDecisionPackage(input({
    supplierPackageCost: 5,
    packagingCost: 0,
    outboundShippingCost: 0,
    fixedFulfillmentCost: 0,
  }))
  assert.ok(result.economics.targetEconomics.estimatedRoiPercent > 100)
  assert.equal(result.economics.viable, true)
})

test("weighted sold median uses confirmed quantity and active median stays independent", () => {
  const result = buildWinnerEvidenceDecisionPackage(input({
    comparables: [
      comparable({ itemPrice: 20 }),
      comparable({ sourceListingId: "active-2", itemPrice: 40 }),
      comparable({
        source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
        sourceListingId: "sold-heavy",
        itemPrice: 35,
        confirmedSoldQuantity: 10,
      }),
      comparable({
        source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
        sourceListingId: "sold-light",
        itemPrice: 25,
        confirmedSoldQuantity: 1,
      }),
    ],
  }))
  assert.equal(result.economics.activeMarketMedian, 30)
  assert.equal(result.economics.weightedSoldMedian, 35)
})

test("null or unavailable evidence remains null instead of becoming zero", () => {
  const result = buildWinnerEvidenceDecisionPackage(input({
    comparables: [],
    supplierPackageCost: null,
    packagingCost: null,
    outboundShippingCost: null,
    fixedFulfillmentCost: null,
  }))
  assert.equal(result.economics.weightedSoldMedian, null)
  assert.equal(result.economics.activeMarketMedian, null)
  assert.equal(result.economics.minimumSafePrice, null)
  assert.equal(result.economics.targetPrice, null)
  assert.equal(result.economics.unavailableValuesRenderAs, "N/D")
})

test("GO requires strong identity, viable economics and confirmed sold evidence", () => {
  const go = buildWinnerEvidenceDecisionPackage(input())
  assert.equal(go.decision.verdict, "GO")
  const conditional = buildWinnerEvidenceDecisionPackage(input({
    comparables: [comparable(), comparable({ sourceListingId: "active-2" })],
  }))
  assert.equal(conditional.decision.verdict, "GO_WITH_CHANGES")
  const noGo = buildWinnerEvidenceDecisionPackage(input({ comparables: [comparable()] }))
  assert.equal(noGo.decision.verdict, "NO_GO")
  assert.ok(noGo.decision.blockers.includes("EXACT_EVIDENCE_INSUFFICIENT"))
})

test("package is versioned, auditable and guarantees zero eBay writes", () => {
  const result = buildWinnerEvidenceDecisionPackage(input())
  assert.match(result.inputHash, /^sha256:[0-9a-f]{64}$/)
  assert.match(result.packageHash, /^sha256:[0-9a-f]{64}$/)
  assert.equal(result.safety.ebayWrites, 0)
  assert.equal(result.safety.canPublish, false)
  assert.equal(result.safety.competitorContentCopied, false)
  assert.equal(result.safety.competitorImagesCopied, false)
})

test("visual winner evidence keeps active and sold exact cohorts separate", () => {
  const result = buildWinnerEvidenceDecisionPackage(input({
    comparables: [
      comparable({ visualEvidence: visualEvidence({ infographicPresence: false }) }),
      comparable({
        source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
        sourceListingId: "sold-visual",
        confirmedSoldQuantity: 5,
        visualEvidence: visualEvidence({ infographicPresence: true }),
      }),
    ],
  }))
  const analysis = result.visualEvidenceAnalysis
  assert.equal(analysis.visualEvidenceSummary.activeExactSampleSize, 1)
  assert.equal(analysis.visualEvidenceSummary.soldOrCompletedExactSampleSize, 1)
  const infographic = analysis.secondaryImagePatterns.find((entry) => entry.pattern === "INFOGRAPHIC_PRESENT")
  assert.deepEqual(infographic.soldOrCompletedExactMatches, { count: 1, observed: 1, percent: 100 })
  assert.deepEqual(infographic.activeExactMatches, { count: 0, observed: 1, percent: 0 })
  assert.equal(infographic.causalityClaimed, false)
})

test("different packs and variants never enter visual exact-match samples", () => {
  const result = buildWinnerEvidenceDecisionPackage(input({
    comparables: [
      comparable({ identity: { ...targetIdentity, packCount: 2 }, visualEvidence: visualEvidence() }),
      comparable({ identity: { ...targetIdentity, scent: "Lavender" }, visualEvidence: visualEvidence() }),
      comparable({ visualEvidence: visualEvidence() }),
      comparable({
        source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
        sourceListingId: "sold-exact",
        confirmedSoldQuantity: 2,
        visualEvidence: visualEvidence(),
      }),
    ],
  }))
  assert.equal(result.visualEvidenceAnalysis.visualEvidenceSummary.activeExactSampleSize, 1)
  assert.equal(result.visualEvidenceAnalysis.visualEvidenceSummary.soldOrCompletedExactSampleSize, 1)
  assert.equal(result.visualEvidenceAnalysis.visualEvidenceSummary.differentPackAndVariantComparablesIncluded, 0)
})

test("small visual samples lower confidence and never claim causality", () => {
  const result = buildWinnerEvidenceDecisionPackage(input({
    comparables: [comparable({ visualEvidence: visualEvidence() })],
  }))
  assert.equal(result.visualEvidenceAnalysis.visualPatternConfidence.level, "LOW")
  assert.equal(result.visualEvidenceAnalysis.visualPatternConfidence.smallSamplePenaltyApplied, true)
  assert.ok(result.visualEvidenceAnalysis.unsupportedVisualHypotheses.includes("SAMPLE_TOO_SMALL_FOR_STRONG_VISUAL_GENERALIZATION"))
  assert.equal(result.visualEvidenceAnalysis.safeguards.causalityClaimed, false)
})

test("missing visual observations render N/D rather than zero", () => {
  const result = buildWinnerEvidenceDecisionPackage(input())
  assert.equal(result.visualEvidenceAnalysis.status, "N/D")
  assert.equal(result.visualEvidenceAnalysis.visualOpportunityScore, null)
  assert.equal(result.visualEvidenceAnalysis.visualPatternConfidence.score, null)
  assert.ok(result.visualEvidenceAnalysis.unsupportedVisualHypotheses.includes("NO_USABLE_STRUCTURED_VISUAL_OBSERVATIONS"))
})

test("visual evidence stores no images and performs no downloads, generation or writes", () => {
  const result = buildWinnerEvidenceDecisionPackage(input({
    comparables: [
      comparable({ visualEvidence: visualEvidence() }),
      comparable({
        source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
        confirmedSoldQuantity: 3,
        visualEvidence: visualEvidence(),
      }),
    ],
  }))
  const serialized = JSON.stringify(result.visualEvidenceAnalysis)
  assert.doesNotMatch(serialized, /imageUrl|https?:\/\//i)
  assert.equal(result.visualEvidenceAnalysis.safeguards.competitorImagesCopied, 0)
  assert.equal(result.visualEvidenceAnalysis.safeguards.competitorImagesDownloaded, 0)
  assert.equal(result.visualEvidenceAnalysis.safeguards.competitorImagesUsedAsGenerativeInput, 0)
  assert.equal(result.visualEvidenceAnalysis.safeguards.imageGenerationStarted, false)
  assert.equal(result.visualEvidenceAnalysis.safeguards.ebayWrites, 0)
})

test("visual observation transport allowlists fields and strips image payloads", () => {
  const report = buildEbaySellerKeywordDemandValidation({
    candidate: { productName: "Lysol disinfecting wipes", gtin: "036000291452" },
    comparables: [{
      itemId: "123",
      title: "Lysol disinfecting wipes",
      gtin: "036000291452",
      source: "EBAY_BROWSE_ACTIVE_LISTING",
      visualEvidence: {
        imageCount: 6,
        fullPackVisible: true,
        evidenceLevel: "HIGH",
        sourceType: "HUMAN_REVIEWED_OBSERVATION",
        imageUrl: "https://competitor.invalid/image.jpg",
        rawPayload: "must-not-pass",
      },
    }],
    asOf: "2026-07-16T12:00:00.000Z",
  })
  const transported = report.comparableEvidence[0].visualEvidence
  assert.equal(transported.imageCount, 6)
  assert.equal(transported.fullPackVisible, true)
  assert.equal("imageUrl" in transported, false)
  assert.equal("rawPayload" in transported, false)
})

test("visual observations are versioned and change the auditable package hash", () => {
  const lowClarity = buildWinnerEvidenceDecisionPackage(input({
    comparables: [
      comparable({ visualEvidence: visualEvidence({ mainImageClarity: "LOW" }) }),
      comparable({
        source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
        confirmedSoldQuantity: 3,
        visualEvidence: visualEvidence(),
      }),
    ],
  }))
  const highClarity = buildWinnerEvidenceDecisionPackage(input({
    comparables: [
      comparable({ visualEvidence: visualEvidence({ mainImageClarity: "HIGH" }) }),
      comparable({
        source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
        confirmedSoldQuantity: 3,
        visualEvidence: visualEvidence(),
      }),
    ],
  }))
  assert.equal(lowClarity.packageVersion, "EBAY_WINNER_EVIDENCE_PRODUCT_DECISION_VISUAL_V2_3_2026_07_16")
  assert.notEqual(lowClarity.packageHash, highClarity.packageHash)
})

test("Loop 2 intake is signed inside the decision package without competitor content", () => {
  const listingAiIntake = {
    approvedKeywords: ["lysol wipes", "lemon wipes"],
    category: { id: "261041", name: "Household Cleaning Products" },
    requiredAspects: [{ name: "Brand", value: "Lysol" }],
    optionalAspects: [{ name: "Scent", value: "Lemon" }],
    pricingScenarioName: "TARGET_PRICE",
    includedContents: ["3 packs of 15 wipes"],
    complianceRestrictions: ["No medical claims"],
    blockedClaims: ["FDA approved"],
    allowedImageFacts: ["3 pack", "15 wipes per pack"],
    locale: "en-US",
  }
  const withIntake = buildWinnerEvidenceDecisionPackage(input({ listingAiIntake }))
  const withoutIntake = buildWinnerEvidenceDecisionPackage(input())
  assert.deepEqual(withIntake.listingAiIntake, listingAiIntake)
  assert.notEqual(withIntake.packageHash, withoutIntake.packageHash)
  assert.doesNotMatch(JSON.stringify(withIntake.listingAiIntake), /competitor|sellerUsername|imageUrl/i)
})

test("route and migration enforce Preview/staging and service-role persistence", () => {
  const route = readFileSync("app/api/admin/ebay/winner-evidence-v2/route.ts", "utf8")
  const service = readFileSync("lib/ebay/ebay-winner-evidence-v2-service.ts", "utf8")
  const migration = readFileSync(
    "supabase/migrations/20260716140000_create_ebay_winner_evidence_v2.sql",
    "utf8",
  )
  const grantHardening = readFileSync(
    "supabase/migrations/20260716140100_harden_ebay_winner_evidence_v2_grants.sql",
    "utf8",
  )
  const sellerRoute = readFileSync("app/api/admin/ebay/seller-keyword-demand/route.ts", "utf8")
  const mobileUi = readFileSync("app/admin/ebay/mobile-review/page.tsx", "utf8")
  assert.match(service, /VERCEL_ENV === "preview"/)
  assert.match(service, /vsfthqydfrdzulldbfbe/)
  assert.match(route, /validateAdminApiRequest/)
  assert.match(route, /competitorImageDownloadAllowed: false/)
  assert.match(route, /competitorImageGenerativeInputAllowed: false/)
  assert.match(migration, /enable row level security/i)
  assert.match(migration, /revoke all.*anon, authenticated/i)
  assert.match(migration, /grant select, insert, update.*service_role/i)
  assert.match(grantHardening, /revoke all.*service_role/i)
  assert.match(grantHardening, /grant select, insert, update.*service_role/i)
  assert.match(sellerRoute, /visualWinnerEvidence/)
  assert.match(sellerRoute, /competitorImagesDownloaded: 0/)
  assert.match(sellerRoute, /imageGenerationStarted: false/)
  assert.match(mobileUi, /Patrones visuales del mercado/)
  assert.match(mobileUi, /asociación no significa causalidad/i)
  assert.doesNotMatch(`${migration}\n${grantHardening}`, /drop\s+table|delete\s+from|truncate/i)
})
