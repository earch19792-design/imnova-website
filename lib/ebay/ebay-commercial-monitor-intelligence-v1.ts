import type {
  AlertCandidate,
  CommercialDecisionAction,
  CommercialDecisionClass,
  CommercialListingDecisionV1,
  CommercialListingReadModel,
  CommercialMonitorBackendV1,
  CommercialMonitorCapabilityStatus,
  EbayGuidanceComparisonReason,
  EbayGuidanceComparisonV1,
  EbayListingQualityRecommendation,
  EbayLiveCertificationReadModel,
} from "./commercial-monitor-readonly-contract"

export const EBAY_LISTING_QUALITY_REPORT_SOURCE =
  "EBAY_LISTING_QUALITY_REPORT" as const

export type CommercialMonitorRegistryCertificationV1 = {
  status: "PARTIAL_CERTIFIED" | "COMPLETE" | "UNPROVEN"
  currentLiveCount: number | null
  matchedCount: number | null
  humanReviewCount: number | null
  coveragePercent: number | null
  limitationCodes: string[]
}

export type CommercialMonitorOrderFactsV1 = {
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE_AUTH_PENDING" | "UNAVAILABLE"
  orderCount: number | null
  lineItemCount: number | null
  quantitySold: number | null
  latestOrderCreationAt: string | null
  orderStatuses: string[]
  fulfillmentStatuses: string[]
  trackingAvailability: "AVAILABLE" | "MISSING" | "UNPROVEN"
}

type QualityReportArtifact = {
  source?: unknown
  sourceVersion?: unknown
  observedAt?: unknown
  importedAt?: unknown
  rows?: unknown
}

type QualityReportRow = {
  itemId?: unknown
  sku?: unknown
  recommendationCategory?: unknown
  recommendationType?: unknown
  recommendationText?: unknown
  reportedBenchmark?: unknown
  topCategoryBenchmark?: unknown
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown, maximum = 240) {
  if (typeof value !== "string") return null
  const safe = value.replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/Bearer\s+[^\s"'<]+/gi, "[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED]")
    .replace(/\s+/g, " ").trim().slice(0, maximum)
  return safe || null
}

function iso(value: unknown) {
  const candidate = text(value, 50)
  return candidate && Number.isFinite(Date.parse(candidate))
    ? new Date(candidate).toISOString()
    : null
}

function nonnegativeNumber(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function normalizedCategory(value: unknown) {
  const candidate = text(value, 80)?.toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  return candidate || "UNSPECIFIED"
}

export function normalizeEbayListingQualityReport(input: {
  artifact?: unknown
  listings: CommercialListingReadModel[]
}): CommercialMonitorBackendV1["listingQualityReport"] {
  if (input.artifact === undefined || input.artifact === null) {
    return {
      status: "UNAVAILABLE_NO_CURRENT_REPORT",
      source: EBAY_LISTING_QUALITY_REPORT_SOURCE,
      persistenceStatus: "IN_MEMORY_READ_ONLY",
      limitationCode: "LISTING_QUALITY_REPORT_NOT_PROVIDED",
      recommendations: [],
    }
  }
  const artifact = record(input.artifact) as QualityReportArtifact
  const sourceVersion = text(artifact.sourceVersion, 80)
  const observedAt = iso(artifact.observedAt)
  const importedAt = iso(artifact.importedAt)
  const rows = Array.isArray(artifact.rows) ? artifact.rows : null
  if (artifact.source !== EBAY_LISTING_QUALITY_REPORT_SOURCE ||
      !sourceVersion || !observedAt || !importedAt || !rows) {
    return {
      status: "UNPROVEN",
      source: EBAY_LISTING_QUALITY_REPORT_SOURCE,
      persistenceStatus: "IN_MEMORY_READ_ONLY",
      limitationCode: "LISTING_QUALITY_REPORT_CONTRACT_INVALID",
      recommendations: [],
    }
  }
  const byItemId = new Map<string, CommercialListingReadModel[]>()
  const bySku = new Map<string, CommercialListingReadModel[]>()
  for (const listing of input.listings) {
    const itemGroup = byItemId.get(listing.identity.itemId) ?? []
    itemGroup.push(listing)
    byItemId.set(listing.identity.itemId, itemGroup)
    if (listing.identity.sku) {
      const skuGroup = bySku.get(listing.identity.sku) ?? []
      skuGroup.push(listing)
      bySku.set(listing.identity.sku, skuGroup)
    }
  }
  const recommendations: EbayListingQualityRecommendation[] = rows.map((value) => {
    const row = record(value) as QualityReportRow
    const itemId = text(row.itemId, 30)
    const sku = text(row.sku, 120)
    const itemMatches = itemId ? byItemId.get(itemId) ?? [] : []
    const skuMatches = !itemId && sku ? bySku.get(sku) ?? [] : []
    const itemCertified = itemMatches.length === 1
    const skuUnique = !itemId && skuMatches.length === 1
    return {
      source: EBAY_LISTING_QUALITY_REPORT_SOURCE,
      sourceVersion,
      listingKey: itemCertified
        ? itemMatches[0].key
        : skuUnique
          ? skuMatches[0].key
          : null,
      associationStatus: itemCertified
        ? "ITEM_ID_CERTIFIED"
        : skuUnique
          ? "SKU_UNIQUE"
          : "UNPROVEN",
      recommendationCategory: normalizedCategory(row.recommendationCategory),
      recommendationType: normalizedCategory(row.recommendationType),
      recommendationText: text(row.recommendationText),
      reportedBenchmark: nonnegativeNumber(row.reportedBenchmark),
      topCategoryBenchmark: nonnegativeNumber(row.topCategoryBenchmark),
      observedAt,
      importedAt,
    }
  })
  const resolved = recommendations.filter((row) => row.listingKey !== null).length
  return {
    status: recommendations.length === 0
      ? "MISSING"
      : resolved === recommendations.length
        ? "AVAILABLE"
        : "PARTIAL",
    source: EBAY_LISTING_QUALITY_REPORT_SOURCE,
    persistenceStatus: "IN_MEMORY_READ_ONLY",
    limitationCode: resolved === recommendations.length
      ? null
      : "LISTING_QUALITY_REPORT_ASSOCIATION_UNPROVEN",
    recommendations,
  }
}

function metricValue(
  listing: CommercialListingReadModel,
  keys: Array<keyof CommercialListingReadModel["metrics"]>,
) {
  for (const key of keys) {
    const metric = listing.metrics[key]
    if ((metric.availability === "AVAILABLE" ||
        metric.availability === "PARTIAL") &&
        typeof metric.value === "number" && Number.isFinite(metric.value)) {
      return metric.value
    }
  }
  return null
}

export function classifyCommercialListingV1(
  listing: CommercialListingReadModel,
): CommercialListingDecisionV1 {
  const impressions = metricValue(listing, ["impressions"])
  const ctr = metricValue(listing, ["ctr_calculated", "ctr_reported"])
  const views = metricValue(listing, ["ebay_views"])
  const orders = metricValue(listing, ["orders", "transactions"])
  const conversion = metricValue(listing, ["conversion"])
  const experimentRunning = listing.experiment.status === "AVAILABLE" &&
    listing.experiment.lifecycleState === "RUNNING"
  const variableFrozen = listing.experiment.status === "AVAILABLE" &&
    listing.experiment.frozenVariables.length > 0
  let classification: CommercialDecisionClass
  let action: CommercialDecisionAction
  let priority: CommercialListingDecisionV1["priority"]
  let evidenceStatus: CommercialListingDecisionV1["evidenceStatus"] = "AVAILABLE"
  const reasons: CommercialListingDecisionV1["reasonCodes"] = []

  if (listing.blockers.length > 0) {
    classification = "DATA_QUALITY"
    action = "FIX_DATA_QUALITY"
    priority = "HIGH"
    evidenceStatus = "UNPROVEN"
    reasons.push("BLOCKING_DATA_QUALITY_ISSUE")
  } else if (impressions === null) {
    classification = "DATA_QUALITY"
    action = "FIX_DATA_QUALITY"
    priority = "MEDIUM"
    evidenceStatus = "UNPROVEN"
    reasons.push("INSUFFICIENT_ANALYTICS_EVIDENCE")
  } else if (impressions === 0) {
    classification = "VISIBILITY"
    action = "IMPROVE_VISIBILITY"
    priority = "HIGH"
    reasons.push("AUTHORITATIVE_ZERO_IMPRESSIONS")
  } else if (impressions < 100) {
    classification = "HEALTHY_WAIT"
    action = "WAIT"
    priority = "LOW"
    evidenceStatus = "PARTIAL"
    reasons.push("INSUFFICIENT_TRAFFIC")
  } else if (ctr !== null && ctr < 1) {
    classification = "CTR"
    action = "IMPROVE_CTR"
    priority = "HIGH"
    reasons.push("LOW_CTR_WITH_SUFFICIENT_IMPRESSIONS")
  } else if (views !== null && views >= 20 &&
    (orders === 0 || conversion === 0)) {
    classification = "CONVERSION"
    action = "IMPROVE_CONVERSION"
    priority = "HIGH"
    reasons.push("TRAFFIC_WITHOUT_CONVERSION")
  } else {
    classification = "HEALTHY_WAIT"
    action = "WAIT"
    priority = "LOW"
    reasons.push("HEALTHY_EVIDENCE_WAIT_FOR_NEXT_REVIEW")
  }
  if (experimentRunning) {
    action = "WAIT"
    reasons.push("ACTIVE_EXPERIMENT_PROTECTS_VARIABLE")
  }
  return {
    listingKey: listing.key,
    classification,
    priority,
    evidenceStatus,
    reasonCodes: [...new Set(reasons)],
    recommendedAction: action,
    actionBlockedByInsufficientEvidence: evidenceStatus === "UNPROVEN",
    experimentRunning,
    variableFrozen,
    nextReviewCondition: listing.experiment.status === "AVAILABLE"
      ? listing.experiment.checkpointGate ?? "EXPERIMENT_CHECKPOINT"
      : evidenceStatus === "PARTIAL"
        ? "MINIMUM_TRAFFIC_THRESHOLD"
        : null,
    nextReviewAt: null,
    actionExecutionAllowed: false,
  }
}

function categoryClass(category: string): CommercialDecisionClass | null {
  if (category.includes("VISIBILITY") || category.includes("IMPRESSION")) {
    return "VISIBILITY"
  }
  if (category.includes("CTR") || category.includes("CLICK")) return "CTR"
  if (category.includes("CONVERSION") || category.includes("SALE")) {
    return "CONVERSION"
  }
  if (category.includes("DATA") || category.includes("QUALITY")) {
    return "DATA_QUALITY"
  }
  return null
}

export function compareEbayGuidanceWithSellerOsV1(input: {
  decision: CommercialListingDecisionV1
  guidance?: EbayListingQualityRecommendation
}): EbayGuidanceComparisonV1 {
  if (!input.guidance) {
    return {
      listingKey: input.decision.listingKey,
      ebayGuidanceStatus: "MISSING",
      sellerOsDiagnosisStatus: input.decision.evidenceStatus === "UNPROVEN"
        ? "UNPROVEN"
        : "AVAILABLE",
      conclusion: "INSUFFICIENT_EVIDENCE",
      reasonCodes: ["GUIDANCE_NOT_AVAILABLE"],
      automaticExecutionAllowed: false,
    }
  }
  if (input.guidance.associationStatus === "UNPROVEN") {
    return {
      listingKey: input.decision.listingKey,
      ebayGuidanceStatus: "UNPROVEN",
      sellerOsDiagnosisStatus: input.decision.evidenceStatus === "UNPROVEN"
        ? "UNPROVEN"
        : "AVAILABLE",
      conclusion: "INSUFFICIENT_EVIDENCE",
      reasonCodes: ["BENCHMARK_NOT_AVAILABLE"],
      automaticExecutionAllowed: false,
    }
  }
  const guidanceClass = categoryClass(input.guidance.recommendationCategory)
  const reasons: EbayGuidanceComparisonReason[] = []
  let conclusion: EbayGuidanceComparisonV1["conclusion"]
  if (input.decision.experimentRunning) {
    conclusion = "PARTIALLY_AGREE"
    reasons.push("ACTIVE_EXPERIMENT_PROTECTS_VARIABLE")
  } else if (input.decision.evidenceStatus === "UNPROVEN") {
    conclusion = "INSUFFICIENT_EVIDENCE"
    reasons.push("GUIDANCE_SUPPORTED_BY_DATA_QUALITY_GAP")
  } else if (!guidanceClass) {
    conclusion = "INSUFFICIENT_EVIDENCE"
    reasons.push("BENCHMARK_NOT_AVAILABLE")
  } else if (guidanceClass === input.decision.classification) {
    conclusion = "AGREE"
    reasons.push(input.guidance.reportedBenchmark !== null ||
      input.guidance.topCategoryBenchmark !== null
      ? "BENCHMARK_SUPPORTS_GUIDANCE"
      : "BENCHMARK_NOT_AVAILABLE")
  } else if (input.decision.classification === "HEALTHY_WAIT") {
    conclusion = "DISAGREE"
    reasons.push(input.decision.reasonCodes.includes("INSUFFICIENT_TRAFFIC")
      ? "INSUFFICIENT_TRAFFIC"
      : "LIVE_ANALYTICS_CONTRADICTS_GUIDANCE")
  } else {
    conclusion = "PARTIALLY_AGREE"
    reasons.push("INSUFFICIENT_CONVERSION_EVIDENCE")
  }
  return {
    listingKey: input.decision.listingKey,
    ebayGuidanceStatus: "AVAILABLE",
    sellerOsDiagnosisStatus: input.decision.evidenceStatus === "UNPROVEN"
      ? "UNPROVEN"
      : "AVAILABLE",
    conclusion,
    reasonCodes: reasons,
    automaticExecutionAllowed: false,
  }
}

function aggregateMetric(
  listings: CommercialListingReadModel[],
  keys: Array<keyof CommercialListingReadModel["metrics"]>,
  average = false,
) {
  const values = listings.flatMap((listing) => {
    const value = metricValue(listing, keys)
    return value === null ? [] : [value]
  })
  if (!values.length) {
    return { status: "UNPROVEN" as const, value: null }
  }
  const total = values.reduce((sum, value) => sum + value, 0)
  return {
    status: values.length === listings.length
      ? "AVAILABLE" as const
      : "PARTIAL" as const,
    value: average ? total / values.length : total,
  }
}

function capabilityFromLiveStatus(
  value: "CERTIFIED" | "PARTIAL" | "UNAVAILABLE",
): CommercialMonitorCapabilityStatus {
  return value === "CERTIFIED" ? "AVAILABLE" : value
}

function uniqueBy<T>(values: T[], keyOf: (value: T) => string) {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = keyOf(value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function primaryListingEvidenceScore(listing: CommercialListingReadModel) {
  const metricCoverage = Object.values(listing.metrics).filter((metric) =>
    (metric.availability === "AVAILABLE" || metric.availability === "PARTIAL") &&
    typeof metric.value === "number" && Number.isFinite(metric.value)).length
  const evidenceReferenceCount = Array.isArray(listing.evidenceReferences)
    ? listing.evidenceReferences.length
    : 0
  return metricCoverage * 100 + evidenceReferenceCount
}

function canonicalPrimaryLiveListings(
  listings: CommercialListingReadModel[],
): CommercialListingReadModel[] {
  const byItemId = new Map<string, CommercialListingReadModel[]>()
  for (const listing of listings) {
    const itemId = listing.identity.itemId.trim()
    if (!itemId || listing.discovery.livePresence.status !== "LIVE_ACTIVE") continue
    const current = byItemId.get(itemId)
    if (current) current.push(listing)
    else byItemId.set(itemId, [listing])
  }

  return [...byItemId.entries()].map(([itemId, members]) => {
    const primary = [...members].sort((left, right) => {
      const scoreDifference = primaryListingEvidenceScore(right) -
        primaryListingEvidenceScore(left)
      return scoreDifference || left.key.localeCompare(right.key)
    })[0]
    const runningExperiment = members.find((listing) =>
      listing.experiment.status === "AVAILABLE" &&
      listing.experiment.lifecycleState === "RUNNING")
    return {
      ...primary,
      identity: { ...primary.identity, itemId },
      experiment: runningExperiment?.experiment ?? primary.experiment,
      dataQualityIssues: uniqueBy(
        members.flatMap((listing) => listing.dataQualityIssues ?? []),
        (issue) => `${issue.code}:${issue.source}:${issue.domain}`,
      ),
      blockers: uniqueBy(
        members.flatMap((listing) => listing.blockers ?? []),
        (issue) => `${issue.code}:${issue.source}:${issue.domain}`,
      ),
      evidenceReferences: uniqueBy(
        members.flatMap((listing) => listing.evidenceReferences ?? []),
        (evidence) => evidence.reference,
      ),
      alertCandidateKeys: [...new Set(members.flatMap((listing) =>
        listing.alertCandidateKeys ?? []))],
    }
  }).sort((left, right) => left.identity.itemId.localeCompare(right.identity.itemId))
}

export function buildCommercialMonitorBackendV1(input: {
  liveCertification: EbayLiveCertificationReadModel
  listings: CommercialListingReadModel[]
  alertCandidates: AlertCandidate[]
  registry?: CommercialMonitorRegistryCertificationV1 | null
  orders?: CommercialMonitorOrderFactsV1 | null
  listingQualityReportArtifact?: unknown
}): CommercialMonitorBackendV1 {
  const primaryListings = canonicalPrimaryLiveListings(input.listings)
  const quality = normalizeEbayListingQualityReport({
    artifact: input.listingQualityReportArtifact,
    listings: primaryListings,
  })
  const decisions = primaryListings.map(classifyCommercialListingV1)
  const guidanceByListing = new Map(quality.recommendations.flatMap((row) =>
    row.listingKey ? [[row.listingKey, row] as const] : []))
  const guidanceVsSellerOs = decisions.map((decision) =>
    compareEbayGuidanceWithSellerOsV1({
      decision,
      guidance: guidanceByListing.get(decision.listingKey),
    }))
  const orders = input.orders ?? {
    status: "UNAVAILABLE" as const,
    orderCount: null,
    lineItemCount: null,
    quantitySold: null,
    latestOrderCreationAt: null,
    orderStatuses: [],
    fulfillmentStatuses: [],
    trackingAvailability: "UNPROVEN" as const,
  }
  const activeListingsProven = input.liveCertification.discovery.coverage ===
    "COMPLETE"
  const tradingDiscoveryStatus = input.liveCertification.discovery.status
  const statusCounts = new Map<CommercialDecisionClass, number>()
  for (const decision of decisions) {
    const currentCount = statusCounts.get(decision.classification)
    statusCounts.set(
      decision.classification,
      currentCount === undefined ? 1 : currentCount + 1,
    )
  }
  const countStatus: CommercialMonitorCapabilityStatus = decisions.length
    ? "AVAILABLE"
    : "UNPROVEN"
  const priorityRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
  const priorityActionPlan = decisions.filter((row) =>
    row.recommendedAction !== "WAIT" &&
    !row.actionBlockedByInsufficientEvidence)
    .sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority])
    .slice(0, 12)
    .map((row) => ({
      listingKey: row.listingKey,
      classification: row.classification,
      priority: row.priority,
      recommendedAction: row.recommendedAction,
    }))
  const renderedCriticalAlertCount = priorityActionPlan.filter((row) =>
    row.priority === "CRITICAL" || row.priority === "HIGH").slice(0, 4).length
  return {
    contractVersion: "COMMERCIAL_MONITOR_BACKEND_V1",
    mode: "READ_ONLY",
    capabilities: {
      sellerAccountBinding: input.liveCertification.account.bindingMatched
        ? "AVAILABLE"
        : input.liveCertification.account.bindingConfigured
          ? "PARTIAL"
          : "UNPROVEN",
      tradingDiscovery:
        tradingDiscoveryStatus === "UNKNOWN" ||
          tradingDiscoveryStatus === "INSUFFICIENT_EVIDENCE"
          ? "UNPROVEN"
          : tradingDiscoveryStatus,
      marketplaceCertification:
        input.liveCertification.discovery.coverage === "COMPLETE"
          ? "COMPLETE"
          : input.liveCertification.discovery.coverage,
      analytics: capabilityFromLiveStatus(input.liveCertification.analytics.status),
      registry: input.registry ?? {
        status: "UNPROVEN",
        currentLiveCount: null,
        matchedCount: null,
        humanReviewCount: null,
        coveragePercent: null,
        limitationCodes: ["REGISTRY_CERTIFICATION_NOT_AVAILABLE"],
      },
      ordersFulfillment: orders.status,
      listingQualityReport: quality.status,
      inventory: {
        status: "DEGRADED",
        oauthCapability: "AVAILABLE",
        locationsCapability: "AVAILABLE",
        inventoryItemsResource: "EBAY_REJECTED_25709_UNRESOLVED",
        representation: "UNPROVEN",
      },
    },
    kpis: {
      activeListings: {
        status: activeListingsProven ? "AVAILABLE" : "UNPROVEN",
        value: activeListingsProven ? primaryListings.length : null,
      },
      impressions: aggregateMetric(primaryListings, ["impressions"]),
      ebayViews: aggregateMetric(primaryListings, ["ebay_views"]),
      averageCtr: aggregateMetric(
        primaryListings,
        ["ctr_calculated", "ctr_reported"],
        true,
      ),
      orders: {
        status: orders.status,
        value: orders.orderCount,
      },
    },
    orders: {
      ...orders,
      buyerPiiIncluded: false,
    },
    listingQualityReport: quality,
    decisions,
    guidanceVsSellerOs,
    operationalHealth: {
      needIntervention: {
        status: countStatus,
        count: decisions.length
          ? decisions.filter((row) => row.recommendedAction !== "WAIT" &&
              !row.actionBlockedByInsufficientEvidence).length
          : null,
      },
      runningExperiments: {
        status: countStatus,
        count: decisions.length
          ? decisions.filter((row) => row.experimentRunning).length
          : null,
      },
      stockRisk: {
        status: countStatus,
        count: decisions.length
          ? primaryListings.filter((listing) =>
              listing.stock?.state === "OUT_OF_STOCK_SIGNAL").length
          : null,
      },
      stockUnknown: {
        status: countStatus,
        count: decisions.length
          ? primaryListings.filter((listing) =>
              listing.stock?.state === "STOCK_UNKNOWN").length
          : null,
      },
      dataQuality: {
        status: countStatus,
        count: decisions.length
          ? decisions.filter((row) => row.classification === "DATA_QUALITY").length
          : null,
      },
      ebayRecommendations: {
        status: quality.status,
        count: quality.status === "UNAVAILABLE_NO_CURRENT_REPORT" ||
            quality.status === "UNPROVEN"
          ? null
          : quality.recommendations.length,
      },
      waitingHealthy: {
        status: countStatus,
        count: decisions.length
          ? decisions.filter((row) => row.classification === "HEALTHY_WAIT").length
          : null,
      },
      criticalAlerts: {
        status: "AVAILABLE",
        count: renderedCriticalAlertCount,
      },
      priorityActionPlan,
      upcomingReviews: decisions.flatMap((row) => row.nextReviewCondition
        ? [{
            listingKey: row.listingKey,
            condition: row.nextReviewCondition,
            reviewAt: row.nextReviewAt,
          }]
        : []),
      performanceSeries: {
        status: "MISSING",
        points: [],
        limitationCode: "NO_CANONICAL_TIME_SERIES",
      },
      statusDistribution: [...statusCounts.entries()].map(
        ([classification, count]) => ({ classification, count })),
      categoryBenchmarks: quality.recommendations.flatMap((row) =>
        row.topCategoryBenchmark === null
          ? []
          : [{
              recommendationCategory: row.recommendationCategory,
              benchmark: row.topCategoryBenchmark,
              source: EBAY_LISTING_QUALITY_REPORT_SOURCE,
            }]),
    },
    safety: {
      marketplaceWrites: 0,
      registryWrites: 0,
      fulfillmentWrites: 0,
      buyerMessages: 0,
      guidanceAutoExecution: false,
      decisionExecution: false,
      syntheticChartData: false,
    },
  }
}
