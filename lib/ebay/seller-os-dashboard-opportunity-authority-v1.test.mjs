import assert from "node:assert/strict"
import test from "node:test"

import { buildSellerOsDashboardOpportunityAuthorityV1 } from
  "./seller-os-dashboard-opportunity-authority-v1.ts"

function quickPick(index) {
  return { id: `quick-${index}`, candidate_key: `quick-key-${index}`,
    supplier_product_id: `product-${index}`,
    supplier_variant_id: `variant-${index}`,
    supplier_sku: `QP-${index}`, product_title: `Quick Pick ${index}`,
    queue_status: "ready", decision: "MARKET_TEST_READY",
    assessment: { lunaQuickPickOperationV1: {
      contractVersion: "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1" } } }
}

function radarReview(index) {
  return { id: `radar-${index}`, candidate_key: `radar-key-${index}`,
    supplier_product_id: `radar-product-${index}`,
    supplier_variant_id: `radar-variant-${index}`,
    supplier_sku: `RADAR-${index}`, product_title: `Radar ${index}`,
    queue_status: "review", decision: "FACTORY_PREPARED",
    assessment: { radarFactoryCandidateV1: {
      contractVersion: "RADAR_FACTORY_CANDIDATE_V1" } } }
}

function family(index, fresh = true) {
  return { familyId: `market-family-v1:sha256:${String(index).repeat(64)}`,
    familyName: `Family ${index}`,
    familyDemandStatus: index % 2
      ? "FAMILY_DEMAND_PROVEN" : "FAMILY_DEMAND_SUPPORTED",
    evidenceFreshness: fresh ? "FRESH" : "STALE",
    soldComparableCount: index, soldQuantityEvidence: index * 2,
    priceBand: { currency: "USD", minimum: index, median: index + 1,
      maximum: index + 2 }, nextReviewCondition: "TIME_WINDOW_ELAPSED",
    monitorStatus: "ENROLLED", automaticReviewRuntime: {
      effectiveState: "ACTIVE",
      ownerPresentationAuthority:
        "GLOBAL_RUNTIME_PLUS_CURRENT_ENROLLMENT_ELIGIBILITY",
    } }
}

test("owner review, Radar signals, legacy review and CURRENT LIVE stay separate", () => {
  const rows = [quickPick(1), quickPick(2), quickPick(3),
    { id: "item3404", candidate_key: "item3404-key",
      supplier_product_id: "product-3404", supplier_variant_id: "variant-3404",
      supplier_sku: "ITEM3404", product_title: "Legacy 3404",
      queue_status: "ready", decision: "LISTING_READY", assessment: {} },
    { id: "item3525", candidate_key: "item3525-key",
      supplier_product_id: "product-3525", supplier_variant_id: "variant-3525",
      supplier_sku: "ITEM3525", product_title: "Legacy 3525",
      queue_status: "ready", decision: "LISTING_READY", assessment: {} },
    { id: "false-ready", candidate_key: "false-ready-key",
      supplier_product_id: "product-false", supplier_variant_id: "variant-false",
      supplier_sku: "ITEM3760", product_title: "Not commercially ready",
      queue_status: "ready", decision: "MATCH_REVIEW_REQUIRED", assessment: {} },
    ...[1, 2, 3].map(radarReview),
    ...Array.from({ length: 6 }, (_, index) => ({ id: `legacy-${index}`,
      candidate_key: `legacy-key-${index}`,
      supplier_product_id: `legacy-product-${index}`,
      supplier_variant_id: `legacy-variant-${index}`,
      supplier_sku: `LEGACY-${index}`, product_title: `Legacy ${index}`,
      queue_status: "review", decision: "DIRECTED_LUNA_PACK_INTAKE",
      assessment: {} })),
    { id: "unproven", candidate_key: "unproven-key",
      supplier_product_id: "unproven-product",
      supplier_variant_id: "unproven-variant", supplier_sku: "UNPROVEN",
      product_title: "Unproven", queue_status: "review",
      decision: "MATCH_REVIEW_REQUIRED", assessment: {} }]
  const liveMatches = new Map([
    ["item3404", { ebayItemIds: ["366634810965"] }],
    ["item3525", { ebayItemIds: ["366635285436"] }],
    ["radar-3", { ebayItemIds: ["366582671136"] }],
  ])
  const result = buildSellerOsDashboardOpportunityAuthorityV1({
    queueRows: rows, liveReadStatus: "AVAILABLE", liveMatches,
    radarReadStatus: "AVAILABLE",
    radarEntries: [...Array.from({ length: 6 }, (_, index) =>
      family(index + 1)), family(7, false)],
  })

  assert.equal(result.readyForOwnerReview.count, 3)
  assert.deepEqual(result.readyForOwnerReview.records.map((row) =>
    row.sourceSku), ["QP-1", "QP-2", "QP-3"])
  assert.equal(result.radar.count, 6)
  assert.equal(result.radar.countedAsReadyForOwnerReview, false)
  assert.ok(result.radar.signals.every((signal) =>
    signal.automaticReviewRuntime.status === "ACTIVE" &&
    signal.automaticReviewRuntime
      .legacyEnrollmentFieldUsedAloneAsOwnerAuthority === false))
  assert.equal(result.reviewQueueAudit.total, 10)
  assert.deepEqual(result.reviewQueueAudit.classification, {
    READY: 0, RADAR_SIGNAL: 2, LEGACY: 6, ALREADY_LIVE: 1, UNPROVEN: 1,
  })
  assert.deepEqual(result.readyQueueAudit.classification, {
    READY: 3, RADAR_SIGNAL: 0, LEGACY: 0, ALREADY_LIVE: 2, UNPROVEN: 1,
  })
  const alreadyLive = result.alreadyLive.records.filter((row) =>
    ["ITEM3404", "ITEM3525"].includes(row.sourceSku ?? ""))
  assert.equal(alreadyLive.length, 2)
  assert.ok(alreadyLive.every((row) => row.alreadyLiveExactProduct))
  assert.ok(alreadyLive.every((row) => !row.publicationCtaVisible &&
    !row.completePackageCtaVisible))
  assert.ok(alreadyLive.every((row) => row.liveWorkspaceUrl?.startsWith(
    "/admin/ebay/listing-workspace?")))
  assert.equal(result.safety.marketplaceWrites, 0)
  assert.equal(result.safety.listingPublications, 0)
})

test("CURRENT LIVE authority failure fails owner review closed", () => {
  const result = buildSellerOsDashboardOpportunityAuthorityV1({
    queueRows: [quickPick(1)], liveReadStatus: "UNAVAILABLE",
    liveMatches: new Map(), radarReadStatus: "UNAVAILABLE", radarEntries: [],
  })
  assert.equal(result.readyForOwnerReview.status, "UNAVAILABLE")
  assert.equal(result.readyForOwnerReview.count, null)
  assert.deepEqual(result.readyForOwnerReview.records, [])
  assert.equal(result.radar.count, null)
})

test("current minimum truthful blocker overrides an older ready queue decision", () => {
  const stale = quickPick(1)
  stale.dashboard_minimum_readiness_current = true
  stale.dashboard_minimum_market_test_ready = false
  stale.dashboard_minimum_listing_ready = false
  const result = buildSellerOsDashboardOpportunityAuthorityV1({
    queueRows: [stale], liveReadStatus: "AVAILABLE", liveMatches: new Map(),
    radarReadStatus: "UNAVAILABLE", radarEntries: [],
  })
  assert.equal(result.readyForOwnerReview.count, 0)
  assert.equal(result.readyQueueAudit.classification.UNPROVEN, 1)
})

test("durable Radar handoff is projected into the existing owner signal", () => {
  const signal = family(1)
  const queue = quickPick(1)
  queue.assessment.radarToQuickPickHandoffV1 = {
    radarFamilyId: signal.familyId,
    lunaSku: "ITEM-A",
    quickPickOperationId: queue.id,
  }
  const result = buildSellerOsDashboardOpportunityAuthorityV1({
    queueRows: [queue], liveReadStatus: "AVAILABLE", liveMatches: new Map(),
    radarReadStatus: "AVAILABLE", radarEntries: [signal],
  })
  assert.equal(result.radar.signals[0].lunaDiscoveryStatus,
    "HANDED_TO_QUICK_PICK")
  assert.equal(result.radar.signals[0].bestLunaSku, "ITEM-A")
  assert.equal(result.radar.signals[0].quickPickOperationId, "quick-1")
})
