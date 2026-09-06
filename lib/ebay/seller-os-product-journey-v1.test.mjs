import assert from "node:assert/strict"
import test from "node:test"

import { buildSellerOsProductJourneyV1 } from
  "../seller-os/product-journey-v1.ts"

const digest = (letter) => `sha256:${letter.repeat(64)}`
const candidateId = digest("a")
const packageId = "22222222-2222-4222-8222-222222222222"

function evidence(overrides = {}) {
  return {
    now: "2026-09-05T18:00:00.000Z",
    queue: {
      id: "11111111-1111-4111-8111-111111111111",
      candidate_key: candidateId,
      supplier_product_id: "100",
      supplier_variant_id: "200",
      supplier_sku: "LUNA-200",
      product_title: "Producto exacto",
      first_detected_at: "2026-09-05T10:00:00.000Z",
      supplier_snapshot_at: "2026-09-05T10:00:00.000Z",
      sold_evidence_reviewed: false,
      sold_exact_comparable_count: 0,
      assessment: {
        identity: { exactIdentityConfirmed: true },
        lunaQuickPickOperationV1: {
          contractVersion: "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1",
          firstObservedAt: "2026-09-05T10:00:00.000Z",
          canonicalUrl: "https://example.test/product",
          batchId: "batch-1",
        },
        productTruth: {
          authorityClass: "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1",
          evidenceDigest: digest("b"), title: "Producto exacto",
          imageCount: 2, marketplaceWrites: 0,
          stock: { freshness: "FRESH" },
          sourceEvidence: { requiredItemSpecificsTruthV1: {
            lunaExactProductEvidenceSetV1: { sectionCoverage: {
              productFeaturesSection: "CAPTURED",
              materialsAndCareSection: "CAPTURED",
            } },
          } },
        },
        lunaFullPageImageReviewV1: {
          reviewedAt: "2026-09-05T10:05:00.000Z",
          evidenceDigest: digest("c"), imageSetDigest: digest("d"),
          reviewedImageCount: 2, exactImageCount: 2,
          allExactProductImagesReviewed: true,
        },
        market: { familyDemandStatus: "FAMILY_DEMAND_UNPROVEN" },
        radarFactoryCandidateV1: {
          contractVersion: "NIGHT_RADAR_AUTOMATIC_GOLDEN_PATH_HANDOFF_V1",
          authority: "SELLER_OS_DETERMINISTIC_FACTORY",
          familyId: `market-family-v1:${digest("e")}`,
          marketplaceWrites: 0,
        },
        quickPickMarketTestReviewV1: {
          marketPriceSupport: "UNPROVEN", supplierCost: 5,
          shipping: 6.99, ebayFees: 3, profit: 5, margin: 25,
          roi: 100, testPrice: 19.99, marketplaceWrites: 0,
        },
        radarAutomaticLunaShippingContinuationV1: {
          contractVersion: "RADAR_AUTOMATIC_LUNA_SHIPPING_CONTINUATION_V1",
          shippingJobStatus: "SHIPPING_EVIDENCE_DURABLE",
          purchaseBoundaryEnforced: true, rawAddressPersisted: false,
          marketplaceWrites: 0,
        },
      },
    },
    listingPackage: {
      id: packageId, created_at: "2026-09-05T11:00:00.000Z",
      updated_at: "2026-09-05T11:10:00.000Z",
      source_observed_at: "2026-09-05T10:00:00.000Z",
      package_data: {
        title: "Producto exacto", categoryId: "123", conditionId: "1000",
        quantity: 1, imageUrls: ["one", "two"], aspects: { Brand: "X" },
        shipping: { supplierShippingEconomicsUsd: 6.99,
          supplierShippingEvidenceClass: "DURABLE_LUNA_SHIPPING_EVIDENCE" },
        pricing: { targetPrice: 19.99, supplierCost: 5,
          estimatedOutboundShipping: 6.99, estimatedEbayFees: 3,
          estimatedNetProfit: 5, estimatedNetMarginPercent: 25,
          estimatedRoiPercent: 100, marketPriceSupport: "UNPROVEN" },
        quickPickMarketTestPackageV1: { packageDigest: digest("f"),
          finalListingPackageReady: true,
          authorizationBinding: { imagesDigest: digest("1") } },
        quickPickRuntimePackageMaterializationV1: {
          contractVersion: "QUICK_PICK_RUNTIME_PACKAGE_MATERIALIZATION_V1",
          materialPackageCurrent: true,
          materializedAt: "2026-09-05T11:10:00.000Z",
          marketplaceWrites: 0,
        },
      },
    },
    approval: { id: "33333333-3333-4333-8333-333333333333",
      listing_package_id: packageId, payload_hash: digest("f"),
      approved_at: "2026-09-05T11:20:00.000Z" },
    batchChild: { id: "44444444-4444-4444-8444-444444444444",
      package_id: packageId, package_digest: digest("f"), status: "FAILED_BLOCKED",
      error_class: "EBAY_TEST_FAILURE", retry_safety: "ENGINEERING_REQUIRED",
      marketplace_write_count: 0, updated_at: "2026-09-05T11:30:00.000Z" },
    frontier: { shipping_status: "SHIPPING_DURABLY_PERSISTED",
      shipping_value: 6.99, calculated_at: "2026-09-05T11:00:00.000Z",
      source_updated_at: "2026-09-05T10:00:00.000Z",
      frontier_digest: digest("2"), shipping_capture_evidence: {
        candidateId, lunaProductId: "100", lunaVariantId: "200",
        supplierSku: "LUNA-200", subtotalUsd: 5, shippingUsd: 6.99,
        totalUsd: 11.99, canonicalDestinationAuthority: "CANONICAL_US",
        canonicalDestinationFingerprint: digest("9"),
        canonicalDestinationMatch: true, noPurchase: true,
        evidenceDigest: digest("8"), observedAt: "2026-09-05T10:45:00.000Z",
        maximumAgeSeconds: 86_400,
      } },
    ...overrides,
  }
}

test("projects ten human phases from existing durable authorities", () => {
  const journey = buildSellerOsProductJourneyV1(evidence())
  assert.equal(journey.phases.length, 10)
  assert.deepEqual(journey.phases.map((phase) => phase.ordinal),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.equal(journey.phases[0].status, "COMPROBADO")
  assert.equal(journey.phases[0].mechanismCertification, "PHYSICAL_PASS")
  assert.equal(journey.phases[1].status, "FALTA_COMPROBAR")
  assert.equal(journey.phases[1].failureClass,
    "PRODUCT_RESEARCH_NOT_EXECUTED")
  assert.equal(journey.phases[2].failureClass,
    "RADAR_RESEARCH_REQUIRED_WITHOUT_NEXT_RESEARCH_PLAN")
  assert.equal(journey.phases[3].status, "FALTA_COMPROBAR")
  assert.match(journey.phases[3].result, /precio de mercado/i)
  assert.equal(journey.phases[4].status, "COMPROBADO")
  assert.equal(journey.phases[6].status, "COMPROBADO")
  assert.equal(journey.phases[7].status, "TIENE_UN_FALLO")
  assert.equal(journey.integrity.marketplaceWritesForObservability, 0)
  assert.equal(journey.integrity.databaseMutationsFromRead, 0)
  assert.equal(journey.integrity.noNewParallelRuntime, true)
})

test("closes Radar research loop only from a durable research plan", () => {
  const journey = buildSellerOsProductJourneyV1(evidence({ research: {
    planCount: 1, taskCount: 1, completedTaskCount: 1, failedTaskCount: 0,
    captureBatchCount: 1, sourceRowCount: 4, acceptedComparableCount: 1,
    rejectedComparableCount: 3, dedupedComparableCount: 4,
    queries: ["exact product"], rejectionReasons: ["DIFFERENT_VARIANT"],
    capturedAt: "2026-09-05T10:30:00.000Z",
    confirmedSoldQuantity: 1, lastSoldAt: "2026-09-04T10:00:00.000Z",
    minimumSoldPrice: 17, maximumSoldPrice: 17,
    itemIdDedupeProven: true, soldDatesPresent: true,
    conditionCoverageProven: true, shippingTreatmentProven: true,
  } }))
  assert.equal(journey.phases[1].status, "COMPROBADO")
  assert.equal(journey.phases[1].mechanismCertification, "PHYSICAL_PASS")
  assert.equal(journey.phases[2].status, "COMPROBADO")
  assert.equal(journey.phases[2].failureClass, null)
  assert.equal(journey.integrity.violations.some((entry) =>
    entry.invariantCode ===
      "RADAR_RESEARCH_REQUIRED_REQUIRES_NEXT_RESEARCH_PLAN"), false)
})

test("technical detail remains secondary and unknown values are not zeroed", () => {
  const journey = buildSellerOsProductJourneyV1(evidence())
  assert.equal(journey.integrity.technicalDetailsSecondary, true)
  assert.equal(journey.integrity.noFalseZero, true)
  assert.equal(journey.phases[0].databaseWriteCount, null)
  assert.equal(journey.phases[8].marketplaceWriteCount, 0)
  assert.match(journey.phases[0].ownerIntervention, /Ninguna/i)
})

test("physical Shipping receipt does not claim current proof without freshness", () => {
  const current = evidence()
  const shipping = { ...current.frontier.shipping_capture_evidence }
  delete shipping.maximumAgeSeconds
  const journey = buildSellerOsProductJourneyV1(evidence({
    frontier: { ...current.frontier, shipping_capture_evidence: shipping },
  }))
  assert.equal(journey.phases[4].mechanismCertification, "PHYSICAL_PASS")
  assert.equal(journey.phases[4].status, "FALTA_COMPROBAR")
  assert.equal(journey.phases[4].failureClass,
    "SHIPPING_FRESHNESS_UNPROVEN")
})
