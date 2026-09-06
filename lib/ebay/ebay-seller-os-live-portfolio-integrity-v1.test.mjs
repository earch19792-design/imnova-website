import assert from "node:assert/strict"
import test from "node:test"

import {
  buildCrossModuleLivePortfolioIntegrityV1,
  buildFalseZeroInvariantFindingV1,
  resolveInvariantLifecycleV1,
} from "./ebay-seller-os-live-portfolio-integrity-v1.ts"
import { buildCanonicalLiveListingDashboardMetricsV1,
  presentSellerOsCanonicalDashboardKpisV1,
  presentStockGuardInventoryIdentityV1 } from
  "./ebay-commercial-monitor-registry-presentation-v1.ts"

const OBSERVED_AT = "2026-08-13T12:00:00.000Z"

function listing(itemId, overrides = {}) {
  const base = {
    key: `listing:${itemId}`,
    identity: {
      itemId,
      title: `Listing ${itemId}`,
      sku: `SKU-${itemId}`,
      marketplaceCertification: { status: "US_CERTIFIED" },
    },
    discovery: { livePresence: { status: "LIVE_ACTIVE" } },
    metrics: {},
    experiment: { status: "UNAVAILABLE", lifecycleState: null },
    dataQualityIssues: [],
    blockers: [],
    evidenceReferences: [],
    alertCandidateKeys: [],
  }
  return {
    ...base,
    ...overrides,
    identity: { ...base.identity, ...overrides.identity },
    discovery: { ...base.discovery, ...overrides.discovery },
  }
}

const certification = {
  status: "CERTIFIED",
  marketplaceId: "EBAY_US",
  discovery: { status: "AVAILABLE", coverage: "COMPLETE" },
}

function build(listings, overrides = {}) {
  return buildCrossModuleLivePortfolioIntegrityV1({
    listings,
    liveCertification: certification,
    registry: {
      status: "COMPLETE",
      currentLiveCount: 27,
      matchedCount: 27,
      humanReviewCount: 0,
      coveragePercent: 100,
      limitationCodes: [],
    },
    observedAt: OBSERVED_AT,
    ...overrides,
  })
}

function currentAuthority(integrity) {
  return {
    contractVersion: "SELLER_OS_CURRENT_LIVE_AUTHORITY_RECOVERY_V1",
    currentState: "CURRENT_FRESH",
    currentListingCount: integrity.canonicalCohort.listingCount,
    currentItemIds: integrity.canonicalCohort.itemIds,
    currentObservedAt: OBSERVED_AT,
    authoritativeZero: integrity.canonicalCohort.listingCount === 0,
    lastCertifiedState: "LAST_CERTIFIED_AVAILABLE",
    lastCertifiedListingCount: integrity.canonicalCohort.listingCount,
    lastCertifiedItemIds: integrity.canonicalCohort.itemIds,
    lastCertifiedAt: OBSERVED_AT,
    lastCertifiedFreshUntil: "2026-08-13T12:20:00.000Z",
    scopeId: integrity.canonicalCohort.scopeId,
    sourceAuthority:
      "EBAY_TRADING_GET_MY_EBAY_SELLING_PLUS_GET_ITEM_CERTIFICATION",
    sourceFailureCode: null,
    nextRetryAt: null,
    ownerActionRequired: false,
    marketplaceWrites: 0,
  }
}

test("27 aligned live stock rows preserve canonical count parity", () => {
  const listings = Array.from({ length: 27 }, (_, index) =>
    listing(String(366_500_000_000 + index)))
  const { canonicalListings, integrity } = build(listings)

  assert.equal(canonicalListings.length, 27)
  assert.equal(integrity.canonicalCohort.listingCount, 27)
  assert.equal(integrity.stockCohort.currentLiveItemCount, 27)
  assert.equal(integrity.stockCohort.currentLiveEvidenceRowCount, 27)
  assert.equal(integrity.stockCohort.nonLiveEvidenceRowCount, 0)
  assert.equal(integrity.findings.some((finding) =>
    finding.invariantCode === "COUNT_PARITY_FAILURE"), false)
})

test("dashboard metrics use the canonical live grain and exact stock semantics", () => {
  const itemIds = Array.from({ length: 8 }, (_, index) =>
    String(366_700_000_000 + index))
  const listings = itemIds.map((itemId, index) => listing(itemId, {
    stock: {
      supplierLinkageStatus: "CERTIFIED",
      supplierProductId: `product-${index}`,
      supplierVariantId: `variant-${index}`,
      supplierSku: `SUPPLIER-${index}`,
      state: index < 5 ? "IN_STOCK_SIGNAL" : "STOCK_UNKNOWN",
      freshness: { status: "FRESH", ageSeconds: 60,
        maximumAgeSeconds: 21_600 },
      limitationCode: index < 5
        ? null : "CERTIFIED_COMPONENT_STOCK_IDENTITY_MISMATCH",
    },
  }))
  const { integrity } = build(listings)
  const monitor = {
    listings,
    backend: {
      currentLiveAuthority: currentAuthority(integrity),
      livePortfolioIntegrity: integrity,
      monitorCoverage: {
        status: "AVAILABLE",
        currentLiveScopeId: integrity.canonicalCohort.scopeId,
        currentLiveScopeCount: 8,
        monitoredItemIds: itemIds,
      },
    },
  }
  const metrics = buildCanonicalLiveListingDashboardMetricsV1(monitor)
  assert.equal(metrics.canonicalParity, true)
  assert.equal(metrics.monitorAndInventoryCanonicalParity, true)
  assert.equal(metrics.currentLiveInvariantPass, true)
  assert.equal(metrics.liveCount, 8)
  assert.equal(metrics.exactSupplierLinked, 8)
  assert.equal(metrics.needsLinkage, 0)
  assert.equal(metrics.lunaLinkedCertified, 8)
  assert.equal(metrics.unlinkedLive, 0)
  assert.equal(metrics.monitoredLive, 8)
  assert.equal(metrics.unmonitoredLive, 0)
  assert.equal(metrics.stockguardEnrolledLive, 8)
  assert.equal(metrics.stockGuardEnrolled, 8)
  assert.equal(metrics.liveWithoutStockguard, 0)
  assert.equal(metrics.freshEvidenceLive, 8)
  assert.equal(metrics.stockguardProtectedLive, 8)
  assert.equal(metrics.stockguardRequiresAttention, 3)
  assert.equal(metrics.inStockSignal, 5)
  assert.equal(metrics.stockUnknown, 3)
  assert.equal(metrics.certifiedOosLive, 0)
  assert.equal(metrics.identityMismatch, 3)
  assert.equal(metrics.definitions.linkedDoesNotRequireInStock, true)
  assert.equal(metrics.definitions.needsLinkageDoesNotMeanStockUnknown, true)
  assert.equal(metrics.definitions.actionableDoesNotComeFromStockUnknown, true)
})

test("AVAILABLE canonical KPIs hydrate without scope or status substitution", () => {
  const available = (value) => ({ status: "AVAILABLE", value })
  const monitor = {
    backend: {
      kpis: {
        activeListings: available(10),
        impressions: available(9_367),
        ebayViews: available(53),
        averageCtr: available(0.68812),
        quantitySold: available(2),
        orders: available(2),
      },
      trafficScopes: {
        accountTraffic: {
          status: "AVAILABLE",
          scope: "ACCOUNT_TRAFFIC",
          impressions: 9_367,
          listingViews: 53,
          quantitySold: 2,
          ctr: 0.68812,
        },
      },
      listingQualityReport: {
        status: "UNAVAILABLE_NO_CURRENT_REPORT",
      },
    },
  }

  const presentation = presentSellerOsCanonicalDashboardKpisV1(monitor)
  assert.equal(presentation.livePortfolio.scope, "CURRENT_LIVE_PORTFOLIO")
  assert.equal(presentation.livePortfolio.activeListings.value, 10)
  assert.equal(presentation.livePortfolio.impressions.value, 9_367)
  assert.equal(presentation.livePortfolio.ebayViews.value, 53)
  assert.equal(presentation.livePortfolio.averageCtr.value, 0.68812)
  assert.equal(presentation.orders.value, 2)
  assert.equal(presentation.accountTraffic.scope, "ACCOUNT_TRAFFIC")
  assert.equal(presentation.accountTraffic.impressions, 9_367)
  assert.deepEqual(presentation.availableValueViolations, [])
  assert.equal(presentation.scopesSeparated, true)
  assert.equal(presentation.listingQualityReport.status,
    "UNAVAILABLE_NO_CURRENT_REPORT")
})

test("UNAVAILABLE metrics remain null instead of becoming synthetic zero", () => {
  const unavailable = { status: "UNAVAILABLE", value: null }
  const monitor = {
    backend: {
      kpis: {
        activeListings: { status: "AVAILABLE", value: 10 },
        impressions: unavailable,
        ebayViews: unavailable,
        averageCtr: unavailable,
        quantitySold: unavailable,
        orders: unavailable,
      },
      trafficScopes: {
        accountTraffic: {
          status: "UNAVAILABLE",
          scope: "ACCOUNT_TRAFFIC",
          impressions: null,
          listingViews: null,
          quantitySold: null,
          ctr: null,
        },
      },
      listingQualityReport: {
        status: "UNAVAILABLE_NO_CURRENT_REPORT",
      },
    },
  }

  const presentation = presentSellerOsCanonicalDashboardKpisV1(monitor)
  assert.equal(presentation.livePortfolio.impressions.value, null)
  assert.equal(presentation.accountTraffic.impressions, null)
  assert.equal(presentation.orders.value, null)
  assert.deepEqual(presentation.availableValueViolations, [])
})

test("Inventory canonical cards keep linkage, stock, and identity mismatch independent", () => {
  const itemIds = ["366574069492", "366581718546", "366582544476"]
  const listings = [
    listing(itemIds[0], { stock: {
      supplierLinkageStatus: "CERTIFIED",
      state: "STOCK_UNKNOWN",
      limitationCode: "CERTIFIED_COMPONENT_STOCK_IDENTITY_MISMATCH",
    } }),
    listing(itemIds[1], { stock: {
      supplierLinkageStatus: "CERTIFIED",
      state: "IN_STOCK_SIGNAL",
      limitationCode: null,
    } }),
    listing(itemIds[2], { stock: {
      supplierLinkageStatus: "UNPROVEN",
      state: "STOCK_UNKNOWN",
      limitationCode: "CERTIFIED_COMPONENT_STOCK_IDENTITY_MISMATCH",
    } }),
  ]
  const { integrity } = build(listings)
  const monitor = {
    listings,
    backend: {
      currentLiveAuthority: currentAuthority(integrity),
      livePortfolioIntegrity: integrity,
      monitorCoverage: {
        status: "AVAILABLE",
        currentLiveScopeId: integrity.canonicalCohort.scopeId,
        currentLiveScopeCount: 3,
        monitoredItemIds: itemIds,
      },
    },
  }

  const metrics = buildCanonicalLiveListingDashboardMetricsV1(monitor)
  assert.equal(metrics.exactSupplierLinked, 2)
  assert.equal(metrics.needsLinkage, 1)
  assert.equal(metrics.inStockSignal, 1)
  assert.equal(metrics.stockUnknown, 2)
  assert.equal(metrics.identityMismatch, 1)
  assert.equal(metrics.monitoredLive, 3)
  assert.equal(metrics.stockGuardEnrolled, 3)
})

test("Inventory row presentation separates certified linkage from stock identity mismatch", () => {
  const certifiedInStock = presentStockGuardInventoryIdentityV1(listing(
    "366574069492", { stock: {
      supplierLinkageStatus: "CERTIFIED",
      state: "IN_STOCK_SIGNAL",
      limitationCode: null,
    } }))
  assert.equal(certifiedInStock.supplierLinkageLabel, "Evidencia exacta ✅")
  assert.equal(certifiedInStock.certifiedStockIdentityMismatch, false)
  assert.equal(certifiedInStock.stockLabel, null)

  const certifiedMismatch = presentStockGuardInventoryIdentityV1(listing(
    "366582586826", { stock: {
      supplierLinkageStatus: "CERTIFIED",
      state: "STOCK_UNKNOWN",
      limitationCode: "CERTIFIED_COMPONENT_STOCK_IDENTITY_MISMATCH",
    } }))
  assert.equal(certifiedMismatch.supplierLinkageLabel, "Evidencia exacta ✅")
  assert.equal(certifiedMismatch.certifiedStockIdentityMismatch, true)
  assert.equal(certifiedMismatch.stockLabel, "Stock desconocido ⚠️")
  assert.equal(certifiedMismatch.stockDetail,
    "Identidad de stock no conciliada")
  assert.equal(certifiedMismatch.freshnessLabel, "Desconocida")
  assert.equal(certifiedMismatch.freshnessDetail,
    "No existe todavía evidencia de stock conciliada para calcular vigencia.")
  assert.equal(certifiedMismatch.riskLabel, "Stock desconocido")
  assert.equal(certifiedMismatch.recommendedAction,
    "Reconciliar identidad de stock del producto certificado con la evidencia de disponibilidad de Luna.")

  const unproven = presentStockGuardInventoryIdentityV1(listing(
    "366575102453", { stock: {
      supplierLinkageStatus: "UNPROVEN",
      state: "STOCK_UNKNOWN",
      limitationCode: null,
    } }))
  assert.equal(unproven.supplierLinkageLabel, "No comprobado")
  assert.equal(unproven.certifiedStockIdentityMismatch, false)
  assert.equal(unproven.stockLabel, null)
})

test("34 stock evidence rows reconcile to 27 live Item IDs without denominator contamination", () => {
  const live = Array.from({ length: 27 }, (_, index) =>
    listing(String(366_500_000_000 + index)))
  const duplicate = listing(live[0].identity.itemId, {
    key: `stock-duplicate:${live[0].identity.itemId}`,
    identity: { title: "Different evidence title representation" },
  })
  const nonLive = Array.from({ length: 6 }, (_, index) =>
    listing(String(365_400_000_000 + index), {
      key: `historical:${index}`,
      discovery: { livePresence: { status: "ENDED" } },
    }))
  const { integrity } = build([...live, duplicate, ...nonLive])

  assert.equal(integrity.stockCohort.evidenceRowCount, 34)
  assert.equal(integrity.canonicalCohort.listingCount, 27)
  assert.equal(integrity.stockCohort.currentLiveItemCount, 27)
  assert.equal(integrity.stockCohort.currentLiveEvidenceRowCount, 28)
  assert.equal(integrity.stockCohort.nonLiveEvidenceRowCount, 6)
  assert.equal(integrity.stockCohort.duplicateItemIds.length, 1)
  assert.equal(integrity.stockCohort.duplicateItemIds[0].itemId,
    live[0].identity.itemId)
  const duplicateFinding = integrity.findings.find((finding) =>
    finding.invariantCode === "DUPLICATE_ITEM_ID")
  assert.equal(duplicateFinding?.lifecycle, "ACTIVE_VIOLATION")
  assert.equal(duplicateFinding?.guardCode,
    "STOCK_EVIDENCE_DEDUPLICATION_GUARD")
  assert.equal(duplicateFinding?.humanApprovalRequired, true)
  assert.equal(duplicateFinding?.autoMutationAllowed, false)
  assert.equal(duplicateFinding?.entityRefs.includes(live[0].identity.itemId),
    true)
  assert.equal(integrity.stockCohort.duplicateItemIds[0].rowCount, 2)
  assert.equal(integrity.stockCohort.duplicateItemIds[0].evidenceRows.length, 2)
  assert.equal(integrity.stockCohort.duplicateItemIds[0]
    .evidenceRowsTruncated, false)
  assert.equal(integrity.stockCohort.duplicateItemIds[0].evidenceRows.every(
    (row) => row.evidenceRowId.startsWith("stock-evidence-row:") &&
      row.evidenceFingerprint.startsWith("commercial-readonly-v1:") &&
      row.representationHash.startsWith("commercial-readonly-v1:") &&
      row.cohortClassification === "CURRENT_LIVE"), true)
  const reversed = build([...nonLive.reverse(), duplicate, ...live.reverse()])
    .integrity.stockCohort.duplicateItemIds[0]
  assert.deepEqual(reversed.evidenceRows,
    integrity.stockCohort.duplicateItemIds[0].evidenceRows)
  assert.deepEqual(reversed.titleRepresentations,
    integrity.stockCohort.duplicateItemIds[0].titleRepresentations)
  assert.deepEqual(reversed.skuRepresentations,
    integrity.stockCohort.duplicateItemIds[0].skuRepresentations)
  const nonLiveFinding = integrity.findings.find((finding) =>
    finding.invariantCode === "NON_LIVE_EVIDENCE_PRESENT_EXCLUDED")
  assert.equal(nonLiveFinding?.lifecycle, "MITIGATED_BY_POLICY")
  assert.equal(nonLiveFinding?.strategicClassification, "MITIGATED_CONDITION")
  assert.equal(nonLiveFinding?.blockingImpact,
    "NONE_CURRENT_LIVE_DENOMINATOR_PROTECTED")
  assert.equal(integrity.findings.some((finding) =>
    finding.invariantCode === "NON_LIVE_ENTITY_IN_LIVE_DENOMINATOR"), false)
  assert.equal(integrity.deterministicGuards.find((guard) => guard.guardCode ===
    "CURRENT_LIVE_COHORT_RECONCILIATION")?.status, "MITIGATED")
  assert.equal(integrity.hardeningVersion,
    "CROSS_MODULE_INTEGRITY_HARDENING_V2_2026_08_13")
})

test("non-live entity actually included in a live denominator remains an active violation", () => {
  const live = Array.from({ length: 2 }, (_, index) =>
    listing(String(366_510_000_000 + index)))
  const historical = listing("365400000099", {
    key: "historical:365400000099",
    discovery: { livePresence: { status: "ENDED" } },
  })
  const { integrity } = build([...live, historical], {
    registry: { status: "COMPLETE", currentLiveCount: 2, matchedCount: 2,
      humanReviewCount: 0, coveragePercent: 100, limitationCodes: [] },
    currentLiveDenominatorItemIds: [
      ...live.map((row) => row.identity.itemId),
      historical.identity.itemId,
    ],
  })
  const finding = integrity.findings.find((candidate) =>
    candidate.invariantCode === "NON_LIVE_ENTITY_IN_LIVE_DENOMINATOR")
  assert.equal(finding?.lifecycle, "ACTIVE_VIOLATION")
  assert.equal(finding?.blockingImpact,
    "LIVE_PORTFOLIO_DENOMINATOR_CONTAMINATION")
  assert.equal(integrity.deterministicGuards.find((guard) => guard.guardCode ===
    "CURRENT_LIVE_COHORT_RECONCILIATION")?.status, "TRIGGERED")
})

test("two current-live Item IDs sharing a Custom Label produce a human-gated collision", () => {
  const listings = Array.from({ length: 27 }, (_, index) =>
    listing(String(366_500_000_000 + index)))
  listings[0].identity.sku = "IMN-LST-000026"
  listings[1].identity.sku = "IMN-LST-000026"
  const { integrity } = build(listings)

  assert.equal(integrity.liveSkuUniqueness.status, "FAIL")
  assert.equal(integrity.liveSkuUniqueness.collisionCount, 1)
  assert.deepEqual(integrity.liveSkuUniqueness.collisions[0].itemIds,
    [listings[0].identity.itemId, listings[1].identity.itemId])
  const finding = integrity.findings.find((candidate) =>
    candidate.invariantCode === "DUPLICATE_LIVE_SKU")
  assert.equal(finding?.humanApprovalRequired, true)
  assert.equal(finding?.autoMutationAllowed, false)
  assert.equal(finding?.deterministic, true)
  assert.equal(finding?.lifecycle, "ACTIVE_VIOLATION")
  assert.equal(finding?.guardAlwaysOn, true)
  assert.equal(finding?.guardCode, "LIVE_SKU_UNIQUENESS_CHECK")
  assert.equal(integrity.deterministicGuards.find((guard) => guard.guardCode ===
    "LIVE_SKU_UNIQUENESS_CHECK")?.status, "TRIGGERED")
  assert.equal(integrity.deterministicGuards.find((guard) => guard.guardCode ===
    "LIVE_SKU_UNIQUENESS_CHECK")?.independentOfAutomationThreshold, true)
  assert.equal(finding?.recommendedAction,
    "HUMAN_REVIEW_LIVE_SKU_COLLISION_NO_MARKETPLACE_WRITE")
})

test("unproven capability zero is rejected while null is the coherent representation", () => {
  const falseZero = buildFalseZeroInvariantFindingV1({
    status: "UNPROVEN",
    count: 0,
    module: "OPPORTUNITIES",
    capability: "REPLACEMENT_CANDIDATES",
    scopeId: "current-live:test",
    observedAt: OBSERVED_AT,
  })
  assert.equal(falseZero?.invariantCode,
    "FALSE_ZERO_FROM_UNPROVEN_CAPABILITY")
  assert.equal(falseZero?.lifecycle, "ACTIVE_VIOLATION")
  assert.equal(falseZero?.guardCode, "FALSE_ZERO_REPRESENTATION_GUARD")
  assert.equal(falseZero?.guardAlwaysOn, true)
  assert.equal(buildFalseZeroInvariantFindingV1({
    status: "UNPROVEN",
    count: null,
    module: "OPPORTUNITIES",
    capability: "REPLACEMENT_CANDIDATES",
    scopeId: "current-live:test",
    observedAt: OBSERVED_AT,
  }), null)
  assert.equal(buildFalseZeroInvariantFindingV1({
    status: "AVAILABLE",
    count: 0,
    module: "EXPERIMENTS",
    capability: "ACTIVE_EXPERIMENTS",
    scopeId: "current-live:test",
    observedAt: OBSERVED_AT,
  }), null)
})

test("all V2 deterministic guards are always-on and independent of automation promotion", () => {
  const { integrity } = build([listing("366500000001")], {
    registry: { status: "COMPLETE", currentLiveCount: 1, matchedCount: 1,
      humanReviewCount: 0, coveragePercent: 100, limitationCodes: [] },
    accountTraffic: {
      status: "AVAILABLE",
      scopeId: "account-traffic:UTC:2026-07-14:2026-08-12",
      scopeCount: 30,
      observedAt: OBSERVED_AT,
      metadataValidationStatus: "VALID",
      metadataValidationReasonCode: null,
      upstreamSnapshotAcquisitionCount: 1,
      retryCount: 0,
      snapshotReuseStatus: "ACQUIRED",
      snapshotReuseReasonCode: "CACHE_MISS_ACQUIRED",
      quantitySold: 0,
    },
  })
  const required = [
    "CURRENT_LIVE_COHORT_RECONCILIATION",
    "LIVE_SKU_UNIQUENESS_CHECK",
    "FALSE_ZERO_REPRESENTATION_GUARD",
    "STOCK_EVIDENCE_DEDUPLICATION_GUARD",
    "ACCOUNT_TRAFFIC_METADATA_VALIDATION_GUARD",
    "ACCOUNT_TRAFFIC_SNAPSHOT_REUSE_GUARD",
    "REVIEW_BURDEN_AUTHORITY_MISMATCH_GUARD",
  ]
  assert.deepEqual(integrity.deterministicGuards.map((guard) =>
    guard.guardCode).sort(), required.sort())
  assert.equal(integrity.deterministicGuards.every((guard) =>
    guard.guardAlwaysOn && guard.independentOfAutomationThreshold &&
      guard.autoMutationAllowed === false && guard.reasonCode), true)
  assert.equal(integrity.deterministicGuards.find((guard) => guard.guardCode ===
    "ACCOUNT_TRAFFIC_SNAPSHOT_REUSE_GUARD")?.status, "PASS")
  assert.equal(integrity.deterministicGuards.find((guard) => guard.guardCode ===
    "REVIEW_BURDEN_AUTHORITY_MISMATCH_GUARD")?.status, "PASS")
})

test("Account Traffic sales remain a distinct research scope with no fabricated attribution", () => {
  const listings = Array.from({ length: 27 }, (_, index) =>
    listing(String(366_500_000_000 + index)))
  const { integrity } = build(listings, {
    currentLiveQuantitySold: 0,
    accountTraffic: {
      status: "AVAILABLE",
      quantitySold: 2,
      source: "EBAY_ANALYTICS_TRAFFIC_REPORT_ACCOUNT_SCOPE",
    },
  })
  const finding = integrity.findings.find((candidate) =>
    candidate.invariantCode ===
      "HISTORICAL_OR_NONLIVE_SALES_ATTRIBUTION_REQUIRED")
  assert.equal(finding?.scopeType, "ACCOUNT_TRAFFIC_SCOPE")
  assert.equal(finding?.observedNumerator, 2)
  assert.equal(finding?.humanApprovalRequired, false)
  assert.equal(finding?.recommendedAction,
    "RESEARCH_HISTORICAL_OR_NONLIVE_SALES_ITEM_IDS")
})

test("invariant lifecycle distinguishes reconciliation and a human-accepted evidence duplicate", () => {
  assert.equal(resolveInvariantLifecycleV1({ activeViolation: false,
    authoritativeReconciliationEvidence: true }), "RECONCILED")
  assert.equal(resolveInvariantLifecycleV1({ activeViolation: true,
    humanAcceptedException: true }), "ACCEPTED_EXCEPTION")
  assert.equal(resolveInvariantLifecycleV1({ activeViolation: true }),
    "ACTIVE_VIOLATION")
})
