import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier)
    if (value.startsWith(".") && !/\.(?:ts|mjs|js|json)$/.test(value)) {
      return nextResolve(`${value}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const {
  buildOperationalReviewBurdenV2,
  buildCommercialMonitorBackendV1,
  classifyCommercialListingV1,
  evaluateOperationalReviewFalseZeroGuardV1,
  compareEbayGuidanceWithSellerOsV1,
  normalizeEbayListingQualityReport,
} = await import("./ebay-commercial-monitor-intelligence-v1.ts")
const {
  sanitizeLiveEbayOrders,
} = await import("./ebay-commercial-monitor-live-readonly-domain.ts")

const AT = "2026-08-11T12:00:00.000Z"

function metric(value, availability = value === null ? "UNAVAILABLE" : "AVAILABLE") {
  return {
    value,
    availability,
    completeness: value === null ? "UNPROVEN" : "COMPLETE",
  }
}

function listing(index, values = {}, options = {}) {
  const unavailable = metric(null)
  return {
    key: `listing-${index}`,
    identity: {
      itemId: String(500000000000 + index),
      sku: `SKU-${index}`,
    },
    discovery: {
      livePresence: {
        status: options.livePresence ?? "LIVE_ACTIVE",
      },
    },
    metrics: {
      listing_price: unavailable,
      impressions: metric(values.impressions ?? 500),
      ebay_views: metric(values.views ?? 50),
      external_views: unavailable,
      ctr_reported: metric(values.ctr ?? 2),
      ctr_calculated: unavailable,
      watchers: unavailable,
      transactions: metric(values.orders ?? 2),
      orders: metric(values.orders ?? 2),
      units_sold: unavailable,
      conversion: metric(values.conversion ?? 4),
      revenue: unavailable,
      fees: unavailable,
      promoted_fees: unavailable,
      supplier_cost: unavailable,
      shipping: unavailable,
      contribution: unavailable,
      net_profit: unavailable,
      margin: unavailable,
      roi: unavailable,
    },
    experiment: options.experiment ?? {
      status: "MISSING",
      checkedAt: AT,
      commercialAction: "HUMAN_REVIEW_ONLY",
      source: { reference: "experiment-none", source: "TEST", capturedAt: AT },
    },
    blockers: options.blockers ?? [],
    dataQualityIssues: options.dataQualityIssues ?? [],
    stock: options.stock ?? { state: "STOCK_UNKNOWN" },
  }
}

function liveCertification(ordersStatus = "UNAVAILABLE", orderGaps = [
  "FULFILLMENT_DEDICATED_REFRESH_TOKEN_MISSING",
]) {
  return {
    status: "CERTIFIED",
    marketplaceId: "EBAY_US",
    account: { bindingConfigured: true, bindingMatched: true },
    discovery: { status: "AVAILABLE", coverage: "COMPLETE" },
    analytics: { status: "CERTIFIED" },
    orders: { status: ordersStatus, gapCodes: orderGaps },
  }
}

test("decision engine emits all five canonical classes without executing", () => {
  const visibility = classifyCommercialListingV1(listing(1, { impressions: 0 }))
  const ctr = classifyCommercialListingV1(listing(2, { impressions: 500, ctr: 0.5 }))
  const conversion = classifyCommercialListingV1(listing(3, {
    impressions: 500,
    ctr: 2,
    views: 50,
    orders: 0,
    conversion: 0,
  }))
  const dataQuality = classifyCommercialListingV1(listing(4, {}, {
    blockers: [{ code: "SOURCE_UNAVAILABLE" }],
  }))
  const healthy = classifyCommercialListingV1(listing(5))
  assert.deepEqual([
    visibility.classification,
    ctr.classification,
    conversion.classification,
    dataQuality.classification,
    healthy.classification,
  ], ["VISIBILITY", "CTR", "CONVERSION", "DATA_QUALITY", "HEALTHY_WAIT"])
  for (const decision of [visibility, ctr, conversion, dataQuality, healthy]) {
    assert.equal(decision.actionExecutionAllowed, false)
  }
})

test("active experiments freeze actions and preserve the controlled loop", () => {
  const decision = classifyCommercialListingV1(listing(6, {
    impressions: 500,
    ctr: 0.5,
  }, {
    experiment: {
      status: "AVAILABLE",
      lifecycleState: "RUNNING",
      experimentId: "exp-running",
      testedVariable: "PRIMARY_IMAGE",
      t0: "2026-08-01T00:00:00.000Z",
      evidenceTimestamp: AT,
      dataQualityStatus: "AVAILABLE",
      frozenVariables: ["title"],
      checkpointGate: "WAIT_7_DAYS",
      minimumObservationDurationHours: 400,
      minimumEvidenceMetric: "IMPRESSIONS",
      minimumEvidenceValue: 1_500,
      currentEvidenceValue: 500,
    },
  }))
  assert.equal(decision.classification, "CTR")
  assert.equal(decision.recommendedAction, "WAIT")
  assert.equal(decision.experimentRunning, true)
  assert.equal(decision.variableFrozen, true)
  assert.equal(decision.protectionState, "DO_NOT_TOUCH")
  assert.ok(decision.reasonCodes.includes("WAIT_MINIMUM_TIME"))
  assert.ok(decision.reasonCodes.includes("WAIT_MINIMUM_EVIDENCE"))
  assert.ok(decision.reasonCodes.includes("ACTIVE_EXPERIMENT_PROTECTS_VARIABLE"))
})

test("missing analytics stays UNPROVEN rather than becoming zero", () => {
  const candidate = listing(7)
  candidate.metrics.impressions = metric(null)
  const decision = classifyCommercialListingV1(candidate)
  assert.equal(decision.classification, "DATA_QUALITY")
  assert.equal(decision.evidenceStatus, "UNPROVEN")
  assert.equal(decision.actionBlockedByInsufficientEvidence, true)
})

test("quality report uses Item ID first, unique SKU second, and never fabricates", () => {
  const listings = [listing(8), listing(9)]
  const missing = normalizeEbayListingQualityReport({ listings })
  assert.equal(missing.status, "UNAVAILABLE_NO_CURRENT_REPORT")
  assert.deepEqual(missing.recommendations, [])
  const quality = normalizeEbayListingQualityReport({
    listings,
    artifact: {
      source: "EBAY_LISTING_QUALITY_REPORT",
      sourceVersion: "v1",
      observedAt: AT,
      importedAt: AT,
      rows: [
        {
          itemId: listings[0].identity.itemId,
          sku: "WRONG-SKU-MUST-NOT-OVERRIDE-ITEM",
          recommendationCategory: "CTR",
          recommendationType: "IMPROVE_TITLE",
          reportedBenchmark: 1.5,
        },
        {
          sku: listings[1].identity.sku,
          recommendationCategory: "CONVERSION",
          recommendationType: "REVIEW_PRICE",
        },
        {
          sku: "NO-MATCH",
          recommendationCategory: "VISIBILITY",
          recommendationType: "REVIEW_CATEGORY",
        },
      ],
    },
  })
  assert.equal(quality.status, "PARTIAL")
  assert.deepEqual(quality.recommendations.map((row) => row.associationStatus), [
    "ITEM_ID_CERTIFIED", "SKU_UNIQUE", "UNPROVEN",
  ])
})

test("eBay guidance is separate and never auto-executes", () => {
  const decision = classifyCommercialListingV1(listing(10, {
    impressions: 500,
    ctr: 0.5,
  }))
  const comparison = compareEbayGuidanceWithSellerOsV1({
    decision,
    guidance: {
      associationStatus: "ITEM_ID_CERTIFIED",
      recommendationCategory: "CTR",
      reportedBenchmark: 1.5,
      topCategoryBenchmark: null,
    },
  })
  assert.equal(comparison.conclusion, "AGREE")
  assert.equal(comparison.automaticExecutionAllowed, false)
})

test("orders capability is auth-pending with null KPI and Inventory remains degraded", () => {
  const backend = buildCommercialMonitorBackendV1({
    liveCertification: liveCertification(),
    listings: [listing(11)],
    alertCandidates: [],
    registry: {
      status: "PARTIAL_CERTIFIED",
      currentLiveCount: 27,
      matchedCount: 24,
      humanReviewCount: 3,
      coveragePercent: 88.89,
      limitationCodes: ["REGISTRY_HUMAN_REVIEW_RELATIONSHIPS_PRESENT"],
    },
    orders: {
      status: "UNAVAILABLE_AUTH_PENDING",
      orderCount: null,
      lineItemCount: null,
      quantitySold: null,
      latestOrderCreationAt: null,
      orderStatuses: [],
      fulfillmentStatuses: [],
      trackingAvailability: "UNPROVEN",
    },
  })
  assert.equal(backend.capabilities.ordersFulfillment, "UNAVAILABLE_AUTH_PENDING")
  assert.equal(backend.kpis.orders.value, null)
  assert.equal(backend.kpis.quantitySold.value, 2)
  assert.notEqual(backend.kpis.quantitySold.value, backend.kpis.orders.value)
  assert.equal(backend.capabilities.registry.matchedCount, 24)
  assert.equal(backend.capabilities.registry.humanReviewCount, 3)
  assert.equal(backend.capabilities.inventory.status, "DEGRADED")
  assert.equal(backend.capabilities.inventory.inventoryItemsResource,
    "EBAY_REJECTED_25709_UNRESOLVED")
  assert.equal(backend.orderSourceHealth.capability,
    "EBAY_SELL_FULFILLMENT_GET_ORDERS")
  assert.equal(backend.orderSourceHealth.detectionMode, "POLLING")
  assert.equal(backend.orderSourceHealth.permissionStatus, "UNPROVEN")
  assert.equal(backend.recentSales.status, "UNAVAILABLE")
  assert.equal(backend.recentSales.resultCount, null)
  assert.equal(backend.safety.marketplaceWrites, 0)
  assert.equal(backend.safety.registryWrites, 0)
})

test("monitor coverage distinguishes current-live monitored scope from visible Top N", () => {
  const liveListings = Array.from({ length: 27 }, (_, index) =>
    listing(700 + index))
  for (const prioritized of liveListings.slice(0, 8)) {
    prioritized.metrics.impressions = metric(0)
  }
  const hearingAids = liveListings[20]
  hearingAids.identity.itemId = "366575102453"
  const backend = buildCommercialMonitorBackendV1({
    liveCertification: liveCertification(),
    listings: liveListings,
    alertCandidates: [],
  })

  assert.equal(backend.monitorCoverage.currentLiveScopeCount, 27)
  assert.equal(backend.monitorCoverage.visiblePriorityRowCount, 8)
  assert.equal(backend.monitorCoverage.monitoredOutsideVisibleCount, 19)
  assert.equal(backend.monitorCoverage.monitoredItemIds.includes(
    "366575102453"), true)
  assert.equal(backend.monitorCoverage.visiblePriorityItemIds.includes(
    "366575102453"), false)
  assert.equal(backend.monitorCoverage.notVisibleDoesNotMeanNotMonitored, true)
})

test("primary commercial population is unique current live Item IDs only", () => {
  const liveListings = Array.from({ length: 27 }, (_, index) =>
    listing(100 + index))
  liveListings[0].metrics.impressions = metric(0)
  liveListings[1].metrics.ctr_reported = metric(0.5)
  liveListings[0].identity.sku = "DUPLICATE-MUTABLE-SKU"
  liveListings[1].identity.sku = "DUPLICATE-MUTABLE-SKU"

  const duplicateEvidence = listing(200, { impressions: 0 })
  duplicateEvidence.key = "duplicate-live-evidence"
  duplicateEvidence.identity.itemId = liveListings[0].identity.itemId
  duplicateEvidence.identity.sku = "STALE-MUTABLE-SKU"

  const endedRegistryEvidence = listing(300, {}, {
    livePresence: "STORED_ONLY_NOT_IN_CURRENT_LIVE_ENUMERATION",
  })

  const backend = buildCommercialMonitorBackendV1({
    liveCertification: liveCertification(),
    listings: [...liveListings, duplicateEvidence, endedRegistryEvidence],
    alertCandidates: [],
    registry: {
      status: "PARTIAL_CERTIFIED",
      currentLiveCount: 27,
      matchedCount: 24,
      humanReviewCount: 3,
      coveragePercent: 88.89,
      limitationCodes: [],
    },
  })
  const distributionTotal = backend.operationalHealth.statusDistribution
    .reduce((total, row) => total + row.count, 0)
  const actionKeys = backend.operationalHealth.priorityActionPlan
    .map((row) => row.listingKey)
  const listingPopulation = backend.kpis.activeListings.value

  assert.equal(listingPopulation, 27)
  assert.equal(backend.decisions.length, 27)
  assert.equal(distributionTotal, 27)
  assert.equal(new Set(backend.decisions.map((row) => row.listingKey)).size, 27)
  assert.equal(new Set(actionKeys).size, actionKeys.length)
  for (const count of [
    backend.operationalHealth.needIntervention.count,
    backend.operationalHealth.runningExperiments.count,
    backend.operationalHealth.stockRisk.count,
    backend.operationalHealth.dataQuality.count,
    backend.operationalHealth.waitingHealthy.count,
  ]) {
    assert.ok(count === null || count <= listingPopulation)
  }
  const renderedAlerts = backend.operationalHealth.priorityActionPlan
    .filter((row) => row.priority === "CRITICAL" || row.priority === "HIGH")
    .slice(0, 4)
  assert.equal(backend.operationalHealth.criticalAlerts.count, renderedAlerts.length)
  assert.equal(backend.capabilities.registry.matchedCount, 24)
  assert.equal(backend.capabilities.registry.humanReviewCount, 3)
  assert.equal(backend.capabilities.registry.coveragePercent, 88.89)
})

test("duplicate mutable SKU preserves distinct current Item-ID entities", () => {
  const first = listing(401)
  const second = listing(402)
  first.identity.sku = "SHARED-MUTABLE-SKU"
  second.identity.sku = "SHARED-MUTABLE-SKU"
  const backend = buildCommercialMonitorBackendV1({
    liveCertification: liveCertification(),
    listings: [first, second],
    alertCandidates: [],
  })
  assert.equal(backend.kpis.activeListings.value, 2)
  assert.equal(backend.decisions.length, 2)
})

test("unknown stock evidence is not promoted to proven stock risk", () => {
  const backend = buildCommercialMonitorBackendV1({
    liveCertification: liveCertification(),
    listings: [
      listing(91, {}, { stock: { state: "STOCK_UNKNOWN" } }),
      listing(92, {}, { stock: { state: "OUT_OF_STOCK_SIGNAL" } }),
    ],
    alertCandidates: [],
  })
  assert.equal(backend.operationalHealth.stockRisk.count, 1)
  assert.equal(backend.operationalHealth.stockUnknown.count, 1)
})

test("blocked insufficient-evidence diagnosis is not a proven intervention", () => {
  const backend = buildCommercialMonitorBackendV1({
    liveCertification: liveCertification(),
    listings: [listing(93, {}, {
      blockers: [{ code: "SOURCE_UNAVAILABLE" }],
    })],
    alertCandidates: [],
  })
  assert.equal(backend.decisions[0].classification, "DATA_QUALITY")
  assert.equal(backend.decisions[0].actionBlockedByInsufficientEvidence, true)
  assert.equal(backend.operationalHealth.needIntervention.count, 0)
})

test("operational review uses Decision Taxonomy V2 and stays separate from Registry burden", () => {
  const review = listing(94, {
    impressions: 500,
    ctr: 2,
    views: 40,
    orders: 0,
    conversion: 0,
  }, {
    blockers: [{ code: "LISTING_IDENTITY_UNPROVEN" }],
  })
  const healthy = listing(95, {}, {
    blockers: [],
  })
  const backend = buildCommercialMonitorBackendV1({
    liveCertification: liveCertification(),
    listings: [review, healthy],
    alertCandidates: [],
    registry: {
      status: "PARTIAL_CERTIFIED",
      currentLiveCount: 2,
      matchedCount: 1,
      humanReviewCount: 1,
      coveragePercent: 50,
      limitationCodes: ["REGISTRY_RELATIONSHIP_HUMAN_REVIEW"],
    },
  })

  assert.equal(backend.operationalHealth.manualReview.authority,
    "DECISION_TAXONOMY_V2")
  assert.equal(backend.operationalHealth.manualReview.grain,
    "EBAY_LIVE_LISTING")
  assert.equal(backend.operationalHealth.manualReview.status, "AVAILABLE")
  assert.equal(backend.operationalHealth.manualReview.value, 1)
  assert.equal(backend.operationalHealth.manualReview.zeroIsAuthoritative, false)
  assert.equal(backend.capabilities.registry.humanReviewCount, 1)
  assert.equal(backend.operationalHealth.dataQuality.count, 0)
})

function makeManualReviewDecision(input, overrides = {}) {
  return {
    listingKey: input.key,
    classification: "CTR",
    priority: "HIGH",
    evidenceStatus: "AVAILABLE",
    reasonCodes: ["EXTERNAL_SIGNAL_REVIEW"],
    recommendedAction: "HUMAN_REVIEW",
    actionBlockedByInsufficientEvidence: false,
    experimentRunning: false,
    variableFrozen: false,
    protectionState: "UNPROVEN",
    experimentOperationalState: "INACTIVE",
    frozenVariables: [],
    nextReviewEvidenceRemaining: null,
    externalSignalCount: null,
    nextReviewCondition: null,
    nextReviewAt: null,
    actionExecutionAllowed: false,
    ...overrides,
  }
}

test("Registry unavailable preserves independent review evidence and never invents zero", () => {
  const first = listing(96)
  const second = listing(97)
  const decisions = [
    makeManualReviewDecision(first),
    {
      ...makeManualReviewDecision(second, { recommendedAction: "WAIT",
        classification: "HEALTHY_WAIT",
        priority: "LOW",
        reasonCodes: ["HEALTHY_EVIDENCE_WAIT_FOR_NEXT_REVIEW"],
        actionExecutionAllowed: false,
      }),
    },
  ]
  const burden = buildOperationalReviewBurdenV2({
    listings: [first, second],
    decisions,
    registryStatus: "UNAVAILABLE",
    activeListingStatus: "AVAILABLE",
    activeListingCount: 2,
    scopeId: "current-live:test",
    scopeCount: 2,
    scopeObservedAt: AT,
    identityStatus: "CERTIFIED",
  })

  assert.equal(burden.status, "AVAILABLE")
  assert.equal(burden.value, 1)
  assert.equal(burden.dependencyStatus.registry, "UNAVAILABLE")
  assert.equal(burden.zeroIsAuthoritative, false)
  assert.equal(burden.falseZeroGuard.status, "PASS")
})

test("uncalculable operational review remains PARTIAL/null while true zero stays authoritative", () => {
  const blocked = listing(98, { impressions: 500, ctr: 0.5 }, {
    blockers: [{ code: "SOURCE_UNAVAILABLE" }],
  })
  const unavailable = buildCommercialMonitorBackendV1({
    liveCertification: liveCertification(),
    listings: [blocked],
    alertCandidates: [],
    registry: {
      status: "UNAVAILABLE",
      currentLiveCount: null,
      matchedCount: null,
      humanReviewCount: null,
      coveragePercent: null,
      limitationCodes: ["COMMERCIAL_REGISTRY_READ_FAILED"],
    },
  })
  assert.equal(unavailable.operationalHealth.manualReview.status, "PARTIAL")
  assert.equal(unavailable.operationalHealth.manualReview.value, null)
  assert.equal(unavailable.operationalHealth.manualReview.zeroIsAuthoritative, false)
  assert.equal(unavailable.capabilities.registry.humanReviewCount, null)
  assert.equal(unavailable.kpis.impressions.value, 500)

  const authoritative = buildCommercialMonitorBackendV1({
    liveCertification: liveCertification(),
    listings: [listing(99)],
    alertCandidates: [],
    registry: {
      status: "COMPLETE",
      currentLiveCount: 1,
      matchedCount: 1,
      humanReviewCount: 0,
      coveragePercent: 100,
      limitationCodes: [],
    },
  })
  assert.equal(authoritative.operationalHealth.manualReview.status, "AVAILABLE")
  assert.equal(authoritative.operationalHealth.manualReview.value, 0)
  assert.equal(authoritative.operationalHealth.manualReview.zeroIsAuthoritative, true)
  assert.equal(authoritative.operationalHealth.manualReview.falseZeroGuard.status, "PASS")
})

test("operational false-zero guard triggers only for an unsafe asserted zero", () => {
  const guard = evaluateOperationalReviewFalseZeroGuardV1({
    status: "PARTIAL",
    value: 0,
    authority: "DECISION_TAXONOMY_V2",
    scopeType: "CURRENT_LIVE_COHORT_SCOPE",
    scopeCount: 27,
    zeroIsAuthoritative: false,
    dependencyStatus: {
      currentLiveIdentity: "AVAILABLE",
      decisions: "PARTIAL",
      registry: "UNAVAILABLE",
      unresolvedListingCount: 27,
      registryUnavailableMayBecomeZero: false,
    },
    observedAt: AT,
  })
  assert.equal(guard.status, "TRIGGERED")
  assert.equal(guard.reasonCode,
    "UNAVAILABLE_DEPENDENCY_WOULD_CREATE_FALSE_ZERO")
  assert.equal(guard.autoMutationAllowed, false)
})

test("registry unavailable runtime shape preserves independent evidence and does not emit false authoritative zero", () => {
  const hearingAids = listing(200, { impressions: 1343, views: 1, ctr: 0.2119 }, {
    blockers: [],
  })
  hearingAids.identity.itemId = "366575102453"
  hearingAids.key = "hearing-aids-listing"
  const independentListings = Array.from({ length: 27 }, (_, index) => {
    if (index === 0) {
      return hearingAids
    }
    const row = listing(index + 201)
    return row
  })
  const independentDecisions = independentListings.map((row, index) => {
    const needsReview = index < 3
    return needsReview ? makeManualReviewDecision(row) : {
      ...makeManualReviewDecision(row, {
        recommendedAction: "WAIT",
        classification: "HEALTHY_WAIT",
        priority: "LOW",
        reasonCodes: ["HEALTHY_EVIDENCE_WAIT_FOR_NEXT_REVIEW"],
        actionExecutionAllowed: false,
      }),
    }
  })
  const unavailableBurden = buildOperationalReviewBurdenV2({
    listings: independentListings,
    decisions: independentDecisions,
    registryStatus: "UNAVAILABLE",
    activeListingStatus: "AVAILABLE",
    activeListingCount: 27,
    scopeId: "current-live:test:regression",
    scopeCount: 27,
    scopeObservedAt: AT,
    identityStatus: "CERTIFIED",
  })
  assert.equal(unavailableBurden.status, "AVAILABLE")
  assert.equal(unavailableBurden.value, 3)
  assert.equal(unavailableBurden.zeroIsAuthoritative, false)
  assert.equal(unavailableBurden.falseZeroGuard.status, "PASS")
  assert.equal(unavailableBurden.dependencyStatus.decisions, "AVAILABLE")

  const unavailable = buildCommercialMonitorBackendV1({
    liveCertification: liveCertification(),
    listings: independentListings,
    alertCandidates: [],
    registry: {
      status: "UNAVAILABLE",
      currentLiveCount: 27,
      matchedCount: null,
      humanReviewCount: null,
      coveragePercent: null,
      limitationCodes: ["COMMERCIAL_REGISTRY_READ_FAILED"],
    },
  })

  assert.equal(unavailable.capabilities.registry.status, "UNAVAILABLE")
  assert.equal(unavailable.capabilities.registry.currentLiveCount, 27)
  assert.equal(unavailable.capabilities.registry.matchedCount, null)
  assert.equal(unavailable.capabilities.registry.humanReviewCount, null)
  assert.equal(unavailable.capabilities.registry.coveragePercent, null)
  assert.equal(unavailable.kpis.impressions.status, "AVAILABLE")
  assert.equal(typeof unavailable.kpis.impressions.value, "number")
  assert.equal(unavailable.kpis.ebayViews.status, "AVAILABLE")
  assert.equal(typeof unavailable.kpis.ebayViews.value, "number")
  assert.equal(unavailable.kpis.averageCtr.status, "AVAILABLE")
  assert.equal(typeof unavailable.kpis.averageCtr.value, "number")
  const hearingAidsDecision = unavailable.decisions.find((row) =>
    row.listingKey === hearingAids.key)
  assert.equal(hearingAidsDecision?.recommendedAction,
    hearingAidsDecision?.recommendedAction ?? "WAIT")
  assert.equal(unavailable.monitorCoverage.monitoredItemIds.includes(
    hearingAids.identity.itemId), true)
})

test("registry unavailable with registry-dependent composition blocks and no independent review evidence emits PARTIAL with null", () => {
  const hearingAids = listing(300, { impressions: 1343, views: 1, ctr: 0.2119 }, {
    blockers: [{ code: "REGISTRY_RECONCILIATION_FAILED" }],
  })
  hearingAids.identity.itemId = "366575102453"
  hearingAids.key = "hearing-aids-listing"
  const blockedListings = Array.from({ length: 27 }, (_, index) => {
    const row = listing(index + 301, { impressions: 1200, views: 2 }, {
      blockers: [{ code: "REGISTRY_RECONCILIATION_FAILED" }],
    })
    row.key = `blocked-${index}`
    return row
  })
  blockedListings[0] = hearingAids
  const independentDecisions = blockedListings.map((row) => ({
    ...classifyCommercialListingV1(row),
    recommendedAction: "WAIT",
    reasonCodes: ["INSUFFICIENT_TRAFFIC"],
    actionBlockedByInsufficientEvidence: false,
  }))
  const unavailableBurden = buildOperationalReviewBurdenV2({
    listings: blockedListings,
    decisions: independentDecisions,
    registryStatus: "UNAVAILABLE",
    activeListingStatus: "AVAILABLE",
    activeListingCount: 27,
    scopeId: "current-live:test:registry-blocked-unproven",
    scopeCount: 27,
    scopeObservedAt: AT,
    identityStatus: "CERTIFIED",
  })

  assert.equal(unavailableBurden.status, "PARTIAL")
  assert.equal(unavailableBurden.value, null)
  assert.equal(unavailableBurden.denominator, null)
  assert.equal(unavailableBurden.zeroIsAuthoritative, false)
  assert.equal(unavailableBurden.dependencyStatus.decisions, "PARTIAL")
  assert.equal(unavailableBurden.falseZeroGuard.status, "PASS")
  assert.equal(unavailableBurden.reasonCode, "OPERATIONAL_REVIEW_DEPENDENCY_UNAVAILABLE")

  const available = buildCommercialMonitorBackendV1({
    liveCertification: liveCertification(),
    listings: blockedListings,
    alertCandidates: [],
    registry: {
      status: "UNAVAILABLE",
      currentLiveCount: 27,
      matchedCount: null,
      humanReviewCount: null,
      coveragePercent: null,
      limitationCodes: ["COMMERCIAL_REGISTRY_READ_FAILED"],
    },
    decisions: independentDecisions,
  })
  assert.equal(available.operationalHealth.manualReview.status, "PARTIAL")
  assert.equal(available.operationalHealth.manualReview.value, null)
  assert.equal(available.operationalHealth.manualReview.numerator, null)
  assert.equal(available.operationalHealth.manualReview.denominator, null)
  assert.equal(available.operationalHealth.manualReview.zeroIsAuthoritative, false)
  assert.equal(available.kpis.impressions.status, "AVAILABLE")
  assert.equal(typeof available.kpis.averageCtr.value, "number")
  const listeningIdsByDecision = new Map(blockedListings.map((row) => [
    row.key, row.identity.itemId,
  ]))
  const hearingAidsDecision = available.decisions.find((row) =>
    row.listingKey === hearingAids.key)
  assert.equal(listeningIdsByDecision.get(hearingAidsDecision?.listingKey ?? ""), "366575102453")
})

test("registry unavailable runtime regression preserves independent decisions and does not produce AVAILABLE false zero", () => {
  const hearingAids = listing(200, { impressions: 1343, views: 1, ctr: 0.2119 }, {})
  hearingAids.identity.itemId = "366575102453"
  hearingAids.key = "hearing-aids-listing"
  const independentListings = Array.from({ length: 27 }, (_, index) => {
    if (index === 0) {
      return hearingAids
    }
    const requiresReview = index <= 23
    const row = listing(index + 201, {
      impressions: requiresReview ? 0 : 500,
    }, { blockers: [{ code: "REGISTRY_RECONCILIATION_FAILED" }] })
    row.key = `independent-${index}`
    return row
  })
  const independentDecisions = independentListings.map((row) => classifyCommercialListingV1(row))
  const expectedManualReviewCount = independentDecisions
    .filter((row) => row.recommendedAction !== "WAIT" &&
      !row.actionBlockedByInsufficientEvidence).length
  const unavailableBurden = buildOperationalReviewBurdenV2({
    listings: independentListings,
    decisions: independentDecisions,
    registryStatus: "UNAVAILABLE",
    activeListingStatus: "AVAILABLE",
    activeListingCount: 27,
    scopeId: "current-live:test:regression",
    scopeCount: 27,
    scopeObservedAt: AT,
    identityStatus: "CERTIFIED",
  })
  assert.equal(unavailableBurden.status, "AVAILABLE")
  assert.equal(unavailableBurden.value, expectedManualReviewCount)
  assert.equal(unavailableBurden.dependencyStatus.decisions, "AVAILABLE")
  assert.equal(unavailableBurden.zeroIsAuthoritative, false)
  assert.equal(unavailableBurden.falseZeroGuard.status, "PASS")
  const unavailable = buildCommercialMonitorBackendV1({
    liveCertification: liveCertification(),
    listings: independentListings,
    alertCandidates: [],
    registry: {
      status: "UNAVAILABLE",
      currentLiveCount: 27,
      matchedCount: null,
      humanReviewCount: null,
      coveragePercent: null,
      limitationCodes: ["COMMERCIAL_REGISTRY_READ_FAILED"],
    },
  })
  assert.equal(unavailable.capabilities.registry.status, "UNAVAILABLE")
  assert.equal(unavailable.operationalHealth.manualReview.value, expectedManualReviewCount)
  assert.equal(unavailable.operationalHealth.manualReview.dependencyStatus.decisions,
    "AVAILABLE")
  assert.equal(unavailable.operationalHealth.manualReview.zeroIsAuthoritative, false)
  assert.equal(unavailable.operationalHealth.manualReview.falseZeroGuard.status, "PASS")
  assert.equal(unavailable.capabilities.registry.matchedCount, null)
  assert.equal(unavailable.capabilities.registry.humanReviewCount, null)
  assert.equal(unavailable.capabilities.registry.coveragePercent, null)
  assert.equal(unavailable.operationalHealth.needIntervention.status, "AVAILABLE")
  assert.equal(
    unavailable.operationalHealth.needIntervention.count,
    expectedManualReviewCount,
  )
  assert.equal(unavailable.decisions.filter((row) =>
    row.recommendedAction !== "WAIT" &&
    !row.actionBlockedByInsufficientEvidence).length,
    expectedManualReviewCount,
  )
  const hearingAidsMetric = unavailable.kpis.averageCtr
  assert.equal(hearingAidsMetric.status, "AVAILABLE")
  assert.equal(typeof hearingAidsMetric.value, "number")
  assert.equal(unavailable.monitorCoverage.monitoredItemIds.includes(
    hearingAids.identity.itemId), true)
})

test("registry unavailable runtime regression recovers on partial certification without losing independent priorities", () => {
  const hearingAids = listing(401, { impressions: 1343, views: 1, ctr: 0.2119 }, {})
  hearingAids.identity.itemId = "366575102453"
  hearingAids.key = "hearing-aids-listing-regression"
  const independentListings = Array.from({ length: 27 }, (_, index) => {
    const requiresReview = index <= 23
    const row = index === 0 ? hearingAids : listing(index + 402, {
      impressions: requiresReview ? 0 : 500,
    }, { blockers: [{ code: "REGISTRY_RECONCILIATION_FAILED" }] })
    row.key = index === 0 ? "recovery-hearing-aids" : `recovery-${index}`
    return row
  })
  const independentDecisions = independentListings.flatMap((row, index) => {
    const requiresReview = index <= 23
    const classification = classifyCommercialListingV1(row)
    return [{
      ...classification,
      recommendedAction: requiresReview ? "HUMAN_REVIEW" : "WAIT",
      reasonCodes: requiresReview
        ? ["EXTERNAL_SIGNAL_REVIEW"]
        : ["INSUFFICIENT_TRAFFIC"],
      actionBlockedByInsufficientEvidence: false,
      actionExecutionAllowed: false,
      recommendedActionTitle: requiresReview ? "Revisión humana" : "Esperar",
    }]
  })
  const unavailable = buildOperationalReviewBurdenV2({
    listings: independentListings,
    decisions: independentDecisions,
    registryStatus: "UNAVAILABLE",
    activeListingStatus: "AVAILABLE",
    activeListingCount: 27,
    scopeId: "current-live:test:regression-recovery",
    scopeCount: 27,
    scopeObservedAt: AT,
    identityStatus: "CERTIFIED",
  })
  const recovered = buildOperationalReviewBurdenV2({
    listings: independentListings,
    decisions: independentDecisions,
    registryStatus: "PARTIAL_CERTIFIED",
    activeListingStatus: "AVAILABLE",
    activeListingCount: 27,
    scopeId: "current-live:test:regression-recovery",
    scopeCount: 27,
    scopeObservedAt: AT,
    identityStatus: "CERTIFIED",
  })

  assert.equal(unavailable.status, "AVAILABLE")
  assert.equal(unavailable.value, 24)
  assert.equal(unavailable.denominator, 27)
  assert.equal(unavailable.falseZeroGuard.status, "PASS")
  assert.equal(recovered.status, "AVAILABLE")
  assert.equal(recovered.value, 24)
  assert.equal(recovered.denominator, 27)
  assert.equal(recovered.falseZeroGuard.status, "PASS")

  const unavailableBackend = buildCommercialMonitorBackendV1({
    liveCertification: liveCertification(),
    listings: independentListings,
    alertCandidates: [],
    registry: {
      status: "UNAVAILABLE",
      currentLiveCount: 27,
      matchedCount: null,
      humanReviewCount: null,
      coveragePercent: null,
      limitationCodes: ["COMMERCIAL_REGISTRY_READ_FAILED"],
    },
    decisions: independentDecisions,
  })
  const recoveredBackend = buildCommercialMonitorBackendV1({
    liveCertification: liveCertification(),
    listings: independentListings,
    alertCandidates: [],
    registry: {
      status: "PARTIAL_CERTIFIED",
      currentLiveCount: 27,
      matchedCount: 20,
      humanReviewCount: 24,
      coveragePercent: 88.9,
      limitationCodes: [],
    },
    decisions: independentDecisions,
  })
  assert.equal(unavailableBackend.operationalHealth.manualReview.status, "AVAILABLE")
  assert.equal(unavailableBackend.operationalHealth.manualReview.value, 24)
  assert.equal(unavailableBackend.operationalHealth.manualReview.denominator, 27)
  assert.equal(recoveredBackend.operationalHealth.manualReview.value, 24)
  assert.equal(recoveredBackend.operationalHealth.manualReview.denominator, 27)
  assert.equal(recoveredBackend.operationalHealth.manualReview.falseZeroGuard.status, "PASS")
  assert.equal(recoveredBackend.decisions.filter((row) =>
    row.recommendedAction === "HUMAN_REVIEW").length, 24)
  const hearingAidsRow = unavailableBackend.decisions.find((row) =>
    row.listingKey === hearingAids.key)
  const hearingAidsListingIdByDecision = new Map(independentListings.map((row) => [
    row.key, row.identity.itemId,
  ]))
  assert.equal(hearingAidsListingIdByDecision.get(
    hearingAidsRow?.listingKey ?? ""), "366575102453")
})

test("exact runtime shape with hearing aids preserves independent decisions during registry failure", () => {
  const hearingAids = listing(900, {
    impressions: 1343,
    ebayViews: 1,
    ctr: 0.2119,
  }, {})
  hearingAids.identity.itemId = "366575102453"
  hearingAids.key = "hearing-aids-listing-regression-shape"
  const independentListings = Array.from({ length: 27 }, (_, index) => {
    const requiresReview = index < 24
    const row = index === 0
      ? hearingAids
      : listing(index + 901, {
        impressions: requiresReview ? 900 : 400,
      }, {})
    row.key = index === 0 ? hearingAids.key : `shape-${row.identity.itemId}`
    return row
  })
  const decisions = independentListings.flatMap((row, index) => {
    const needsReview = index < 24
    return [{
      ...classifyCommercialListingV1(row),
      recommendedAction: needsReview ? "HUMAN_REVIEW" : "WAIT",
      reasonCodes: needsReview ? ["EXTERNAL_SIGNAL_REVIEW"] : ["INSUFFICIENT_TRAFFIC"],
      actionBlockedByInsufficientEvidence: false,
      actionExecutionAllowed: false,
    }]
  })

  const availability = buildOperationalReviewBurdenV2({
    listings: independentListings,
    decisions,
    registryStatus: "UNAVAILABLE",
    activeListingStatus: "AVAILABLE",
    activeListingCount: 27,
    scopeId: "current-live:test:shape-regression",
    scopeCount: 27,
    scopeObservedAt: AT,
    identityStatus: "CERTIFIED",
  })
  assert.equal(availability.status, "AVAILABLE")
  assert.equal(availability.value, 24)
  assert.equal(availability.denominator, 27)
  assert.equal(availability.zeroIsAuthoritative, false)
  assert.equal(availability.falseZeroGuard.status, "PASS")

  const backend = buildCommercialMonitorBackendV1({
    liveCertification: liveCertification(),
    listings: independentListings,
    decisions,
    alertCandidates: [],
    registry: {
      status: "UNAVAILABLE",
      currentLiveCount: 27,
      matchedCount: null,
      humanReviewCount: null,
      coveragePercent: null,
      limitationCodes: ["COMMERCIAL_REGISTRY_READ_FAILED"],
    },
  })
  const hearingAidsDecision = backend.decisions.find((row) =>
    row.listingKey === hearingAids.key)
  const hearingAidsMetric = backend.kpis.averageCtr
  assert.equal(backend.capabilities.registry.status, "UNAVAILABLE")
  assert.equal(backend.capabilities.registry.humanReviewCount, null)
  assert.equal(backend.operationalHealth.manualReview.status, "AVAILABLE")
  assert.equal(backend.operationalHealth.manualReview.value, 24)
  assert.equal(backend.operationalHealth.manualReview.denominator, 27)
  assert.equal(backend.operationalHealth.manualReview.falseZeroGuard.status, "PASS")
  assert.equal(backend.operationalHealth.needIntervention.count, 24)
  assert.equal(backend.kpis.averageCtr.status, "AVAILABLE")
  assert.equal(hearingAidsMetric.status, "AVAILABLE")
  assert.equal(hearingAids.metrics.ctr_reported.value, 0.2119)
  assert.ok(Math.abs((hearingAidsMetric.value ?? 0) -
    ((0.2119 + (26 * 2)) / 27)) < 1e-12)
  assert.equal(hearingAidsDecision?.recommendedAction, "HUMAN_REVIEW")
  assert.equal(hearingAidsDecision?.reasonCodes.includes(
    "EXTERNAL_SIGNAL_REVIEW"), true)
  assert.equal(backend.monitorCoverage.currentLiveScopeCount, 27)
  assert.equal(backend.monitorCoverage.monitoredItemIds.includes(
    "366575102453"), true)
  assert.equal(backend.capabilities.registry.limitationCodes.includes(
    "COMMERCIAL_REGISTRY_READ_FAILED"), true)

  const recovered = buildOperationalReviewBurdenV2({
    listings: independentListings,
    decisions,
    registryStatus: "PARTIAL_CERTIFIED",
    activeListingStatus: "AVAILABLE",
    activeListingCount: 27,
    scopeId: "current-live:test:shape-regression",
    scopeCount: 27,
    scopeObservedAt: AT,
    identityStatus: "CERTIFIED",
  })
  assert.equal(recovered.status, "AVAILABLE")
  assert.equal(recovered.value, 24)
  assert.equal(recovered.falseZeroGuard.status, "PASS")
})

test("registry recovery does not duplicate listing-level priorities or degrade independent decisions", () => {
  const rows = Array.from({ length: 27 }, (_, index) => {
    const requiresReview = index >= 10
    const row = listing(index + 300, { impressions: requiresReview ? 1 : 0 }, {
      blockers: [{ code: "REGISTRY_RECONCILIATION_FAILED" }],
    })
    row.key = `recover-${index}`
    return row
  })
  const decisions = rows.map((row) => classifyCommercialListingV1(row))
  const expectedManualReviewCount = decisions.filter((row) =>
    row.recommendedAction !== "WAIT" &&
    !row.actionBlockedByInsufficientEvidence).length
  const unavailable = buildOperationalReviewBurdenV2({
    listings: rows,
    decisions,
    registryStatus: "UNAVAILABLE",
    activeListingStatus: "AVAILABLE",
    activeListingCount: 27,
    scopeId: "current-live:test:recovery",
    scopeCount: 27,
    scopeObservedAt: AT,
    identityStatus: "CERTIFIED",
  })
  assert.equal(unavailable.value, expectedManualReviewCount)
  assert.equal(unavailable.status, "AVAILABLE")
  assert.equal(unavailable.falseZeroGuard.status, "PASS")
  const recovered = buildOperationalReviewBurdenV2({
    listings: rows,
    decisions,
    registryStatus: "PARTIAL_CERTIFIED",
    activeListingStatus: "AVAILABLE",
    activeListingCount: 27,
    scopeId: "current-live:test:recovery",
    scopeCount: 27,
    scopeObservedAt: AT,
    identityStatus: "CERTIFIED",
  })
  assert.equal(recovered.value, expectedManualReviewCount)
  assert.equal(recovered.status, "AVAILABLE")
  assert.equal(recovered.falseZeroGuard.status, "PASS")
  assert.equal(recovered.dependencyStatus.decisions, "AVAILABLE")
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length)
  assert.equal(rows.length, recovered.denominator)
})

test("registry recovery from unavailable preserves listing-level priorities without duplicates", () => {
  const unavailable = buildOperationalReviewBurdenV2({
    listings: [
      listing(300, { impressions: 1343, ctr: 0.2119 }, { blockers: [] }),
      listing(301, { impressions: 500 }, { blockers: [] }),
      listing(302, { impressions: 1200 }, { blockers: [] }),
    ],
    decisions: [
      { ...classifyCommercialListingV1(listing(300, { impressions: 1343, ctr: 0.2119 })),
        recommendedAction: "HUMAN_REVIEW",
        reasonCodes: ["EXTERNAL_SIGNAL_REVIEW"],
        actionBlockedByInsufficientEvidence: false },
      { ...classifyCommercialListingV1(listing(301, { impressions: 500 })),
        recommendedAction: "WAIT",
        reasonCodes: ["INSUFFICIENT_TRAFFIC"],
        actionBlockedByInsufficientEvidence: false },
      { ...classifyCommercialListingV1(listing(302, { impressions: 1200 })),
        recommendedAction: "HUMAN_REVIEW",
        reasonCodes: ["EXTERNAL_SIGNAL_REVIEW"],
        actionBlockedByInsufficientEvidence: false },
    ],
    registryStatus: "UNAVAILABLE",
    activeListingStatus: "AVAILABLE",
    activeListingCount: 3,
    scopeId: "current-live:test:recovery",
    scopeCount: 3,
    scopeObservedAt: AT,
    identityStatus: "CERTIFIED",
  })

  assert.equal(unavailable.status, "AVAILABLE")
  assert.equal(unavailable.value, 2)
  const recovered = buildOperationalReviewBurdenV2({
    listings: [
      listing(300, { impressions: 1343, ctr: 0.2119 }, { blockers: [] }),
      listing(301, { impressions: 500 }, { blockers: [] }),
      listing(302, { impressions: 1200 }, { blockers: [] }),
    ],
    decisions: [
      { ...classifyCommercialListingV1(listing(300, { impressions: 1343, ctr: 0.2119 })),
        recommendedAction: "HUMAN_REVIEW",
        reasonCodes: ["EXTERNAL_SIGNAL_REVIEW"],
        actionBlockedByInsufficientEvidence: false },
      { ...classifyCommercialListingV1(listing(301, { impressions: 500 })),
        recommendedAction: "WAIT",
        reasonCodes: ["INSUFFICIENT_TRAFFIC"],
        actionBlockedByInsufficientEvidence: false },
      { ...classifyCommercialListingV1(listing(302, { impressions: 1200 })),
        recommendedAction: "HUMAN_REVIEW",
        reasonCodes: ["EXTERNAL_SIGNAL_REVIEW"],
        actionBlockedByInsufficientEvidence: false },
    ],
    registryStatus: "PARTIAL_CERTIFIED",
    activeListingStatus: "AVAILABLE",
    activeListingCount: 3,
    scopeId: "current-live:test:recovery",
    scopeCount: 3,
    scopeObservedAt: AT,
    identityStatus: "CERTIFIED",
  })
  assert.equal(recovered.status, "AVAILABLE")
  assert.equal(recovered.value, 2)
  assert.equal(recovered.falseZeroGuard.status, "PASS")
  assert.equal(recovered.dependencyStatus.decisions, "AVAILABLE")
})

test("Fulfillment normalization strips buyer PII and preserves safe order facts", () => {
  const orders = sanitizeLiveEbayOrders({
    orders: [{
      orderId: "SAFE-ORDER-1",
      creationDate: AT,
      lastModifiedDate: AT,
      orderPaymentStatus: "PAID",
      orderFulfillmentStatus: "NOT_STARTED",
      buyer: { username: "private-buyer", email: "buyer@example.com" },
      fulfillmentStartInstructions: [{
        shippingStep: { shipTo: { fullName: "Private Name", phoneNumber: "555" } },
      }],
      pricingSummary: { total: { value: "19.99", currency: "USD" } },
      lineItems: [{
        lineItemId: "LINE-1",
        legacyItemId: "123456789012",
        listingMarketplaceId: "EBAY_US",
        sku: "SAFE-SKU",
        quantity: 2,
        lineItemCost: { value: "19.99", currency: "USD" },
      }],
    }],
  })
  assert.equal(orders.length, 1)
  assert.equal(orders[0].lineItems[0].quantity, 2)
  const serialized = JSON.stringify(orders)
  assert.doesNotMatch(serialized, /buyer|email|shipTo|fullName|phone|Private/i)
})

test("Official Orders preserves completed official Fulfillment evidence", () => {
  const orders = sanitizeLiveEbayOrders({
    orders: [{
      orderId: "SAFE-FULFILLED-ORDER-1",
      creationDate: AT,
      lastModifiedDate: AT,
      orderPaymentStatus: "PAID",
      orderFulfillmentStatus: "FULFILLED",
      buyer: { username: "private-buyer", email: "buyer@example.com" },
      pricingSummary: { total: { value: "19.99", currency: "USD" } },
      lineItems: [{
        lineItemId: "FULFILLED-LINE-1",
        legacyItemId: "123456789012",
        listingMarketplaceId: "EBAY_US",
        sku: "SAFE-FULFILLED-SKU",
        quantity: 1,
        lineItemCost: { value: "19.99", currency: "USD" },
      }],
    }],
  })
  assert.equal(orders.length, 1)
  assert.equal(orders[0].orderFulfillmentStatus, "FULFILLED")
  assert.equal(orders[0].lineItems[0].lineItemId, "FULFILLED-LINE-1")
  assert.doesNotMatch(JSON.stringify(orders), /buyer@example|private-buyer/i)
})
