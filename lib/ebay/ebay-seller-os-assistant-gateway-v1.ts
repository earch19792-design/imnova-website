import type { CommercialMonitorGetDto } from "./commercial-monitor-readonly-contract"
// @ts-expect-error Node's direct TypeScript runner requires the explicit extension.
import { createUnavailableSellerOsOfficialOrdersReadV1, type SellerOsOfficialOrdersReadV1 } from "./ebay-official-orders-read-v1.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { buildAutomationHealthMetricsV1, buildPortfolioIntelligenceV1, buildProactiveExceptionQueueV1, evaluateReplaceKillIntelligenceV1, selectMaterialPrioritiesV2 } from "./ebay-seller-os-portfolio-intelligence-v1.ts"
import type { CanonicalOpportunityResultV2 } from
  "./ebay-commercial-intelligence-upgrade-v1"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { buildStrategicReviewQueueV1, buildSystemReviewBundleV1 } from "./ebay-seller-os-ai-strategic-intelligence-v1.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { currentLiveListingsForMonitorV1, resolveCrossModuleLivePortfolioIntegrityV1 } from "./ebay-seller-os-live-portfolio-integrity-v1.ts"

export const SELLER_OS_ASSISTANT_GATEWAY_VERSION = "SELLER_OS_ASSISTANT_GATEWAY_V1_2026_08_12"
export const SELLER_OS_ASSISTANT_MAX_ITEMS = 100

type SellerOsAssistantMonitorWithOfficialOrdersV1 = CommercialMonitorGetDto & {
  officialOrders?: SellerOsOfficialOrdersReadV1
}

export const SELLER_OS_ASSISTANT_TOOLS_V1 = Object.freeze([
  ["seller_os_get_commercial_context", "Get commercial context",
    "Use this when the user asks what needs attention today or wants a compact Seller OS portfolio summary."],
  ["seller_os_get_exception_queue", "Get exception queue",
    "Use this when the user asks for prioritized operational, commercial, experiment, stock, or review exceptions."],
  ["seller_os_get_listing_intelligence", "Get listing intelligence",
    "Use this when the user asks about one current listing and provides its authoritative eBay Item ID."],
  ["seller_os_get_opportunity_radar", "Get opportunity radar",
    "Use this when the user asks which market opportunities are new, strengthening, stable, weakening, or need research."],
  ["seller_os_get_opportunity_case", "Get opportunity case",
    "Use this when the user asks for one existing evidence-backed Opportunity Case by stable ID."],
  ["seller_os_get_experiments", "Get experiments",
    "Use this when the user asks what is running, protected, ready to evaluate, or awaiting an external signal."],
  ["seller_os_get_stock_status", "Get stock intelligence",
    "Use this when the user asks about proven stock risk, unknown stock, stale supplier evidence, or safe capacity."],
  ["seller_os_get_quality_guidance", "Get quality guidance",
    "Use this when the user asks what eBay guidance exists and how Seller OS assesses it."],
  ["seller_os_get_learning_signals", "Get learning signals",
    "Use this when the user asks what Seller OS learned and how safely that learning may transfer."],
  ["seller_os_get_operational_readiness", "Get operational readiness",
    "Use this when the user asks which Commercial Operations capabilities are ready, blocked, or evidence-gated."],
  ["seller_os_get_system_review_bundle", "Get system review bundle",
    "Use this first for a bounded strategic review of Seller OS portfolio evidence, operational issues, opportunities, blockers, automation candidates, and AI budget status."],
  ["seller_os_get_recent_system_changes", "Get recent system changes",
    "Use this when the user asks what recently changed in Seller OS. Absence of a durable change ledger is returned as unproven, never invented."],
  ["seller_os_get_strategic_review_queue", "Get strategic review queue",
    "Use this when the user asks what Seller OS or its commercial intelligence should improve, distinct from operator-facing commercial exceptions."],
].map(([name, title, description]) => ({ name, title, description,
  annotations: { readOnlyHint: true as const, destructiveHint: false as const,
    openWorldHint: false as const, idempotentHint: true as const },
  securitySchemes: [{ type: "oauth2" as const, scopes: ["seller_os.read"] }],
  sideEffects: false as const })))

function cap<T>(values: T[], maximum = SELLER_OS_ASSISTANT_MAX_ITEMS) {
  return values.slice(0, Math.min(SELLER_OS_ASSISTANT_MAX_ITEMS, Math.max(1, maximum)))
}

function assistantRecentSales(monitor: CommercialMonitorGetDto) {
  return monitor.backend.recentSales ?? {
    contractVersion: "RECENT_SALES_FEED_V1" as const,
    status: "UNAVAILABLE" as const,
    resultCount: null,
    entries: [],
    maximumEntries: 10 as const,
    truncated: false,
    limitationCodes: ["RECENT_SALES_FEED_NOT_AVAILABLE"],
    source: "PERSISTED_OFFICIAL_EBAY_ORDER_EVENTS" as const,
    buyerPiiIncluded: false as const,
  }
}

function assistantOfficialOrders(monitor: CommercialMonitorGetDto) {
  return (monitor as SellerOsAssistantMonitorWithOfficialOrdersV1).officialOrders ??
    createUnavailableSellerOsOfficialOrdersReadV1()
}

function assistantRecentSalesForItem(
  monitor: CommercialMonitorGetDto,
  itemId: string,
) {
  const feed = assistantRecentSales(monitor)
  const entries = cap(feed.entries.filter((sale) =>
    sale.itemIds.includes(itemId)), 10)
  const authoritativeItemCount = feed.status === "AVAILABLE" &&
    feed.truncated === false
  return {
    status: feed.status,
    resultCount: authoritativeItemCount ? entries.length : null,
    entries,
    source: feed.source,
    globalFeedTruncated: feed.truncated,
    itemSearchCoverage: feed.truncated
      ? "PARTIAL_RECENT_WINDOW" as const
      : feed.status,
    buyerPiiIncluded: false as const,
  }
}

function safeListing(
  monitor: CommercialMonitorGetDto,
  itemId: string,
  canonicalOpportunity?: CanonicalOpportunityResultV2 | null,
) {
  const listing = currentLiveListingsForMonitorV1(monitor).find((row) =>
    row.identity.itemId === itemId)
  if (!listing) return null
  const decision = monitor.backend.decisions.find((row) => row.listingKey === listing.key) ?? null
  const guidance = monitor.backend.guidanceVsSellerOs.find((row) => row.listingKey === listing.key) ?? null
  const canonical = canonicalOpportunity?.sourceItemId === itemId
    ? canonicalOpportunity : null
  const coverage = monitor.backend.monitorCoverage
  const monitored = coverage
    ? coverage.monitoredItemIds.includes(itemId)
    : null
  const visibleInPriorityRows = coverage
    ? coverage.visiblePriorityItemIds.includes(itemId)
    : null
  const monitorCoverage = { itemId, currentLive: monitored, monitored,
    visibleInPriorityRows,
    monitoredOutsideTopN: monitored === null || visibleInPriorityRows === null
      ? null
      : monitored && !visibleInPriorityRows,
    status: coverage?.status === "UNPROVEN" || !coverage
      ? "UNPROVEN" as const
      : monitored ? "MONITORED" as const : "NOT_IN_CURRENT_LIVE_SCOPE" as const }
  const exception = buildProactiveExceptionQueueV1({ monitor,
    canonicalOpportunities: canonical ? [canonical.decisionIntegration] : [], maximumEntries: 100 })
    .find((row) => row.entityKey === itemId) ?? null
  return { identity: { itemId: listing.identity.itemId, title: listing.identity.title,
      sku: listing.identity.sku, thumbnail: listing.identity.primaryImageUrl,
      liveStatus: listing.discovery.livePresence.status },
    analytics: { impressions: listing.metrics.impressions, views: listing.metrics.ebay_views,
      ctr: listing.metrics.ctr_calculated, quantitySold: listing.metrics.transactions,
      scope: "CURRENT_LIVE_LISTING" },
    accountTrafficScope: monitor.backend.trafficScopes.accountTraffic,
    ordersStatus: monitor.backend.orders.status,
    orderSourceHealth: monitor.backend.orderSourceHealth,
    monitorCoverage,
    recentSales: assistantRecentSalesForItem(monitor, itemId),
    qualityGuidance: guidance,
    diagnosis: decision ? { classification: decision.classification, evidenceStatus: decision.evidenceStatus,
      reasonCodes: decision.reasonCodes, recommendedOperationalAction: decision.recommendedAction,
      scope: "MONITOR_EVIDENCE_DIAGNOSTIC",
      authoritativeCommercialRecommendation: false as const,
      mayOverrideCanonicalOpportunity: false as const,
      canonicalPrecedenceApplied: canonical !== null } : null,
    experiment: decision ? { status: decision.experimentOperationalState,
      doNotTouch: decision.protectionState === "DO_NOT_TOUCH", frozenVariables: decision.frozenVariables,
      nextReviewCondition: decision.nextReviewCondition, nextReviewAt: decision.nextReviewAt } : null,
    supplier: { productId: listing.stock.supplierProductId,
      variantId: listing.stock.supplierVariantId, sku: listing.stock.supplierSku,
      linkage: listing.stock.supplierProductId && listing.stock.supplierVariantId
        ? "EXACT_PROVEN" : "UNPROVEN" },
    stockGuard: { state: listing.stock.state, sourceHealth: listing.stock.sourceContractStatus,
      quantity: listing.stock.quantity, freshness: listing.stock.freshness,
      safeCapacity: listing.composition.bundleCapacity, hardOverride:
        decision?.reasonCodes.includes("HARD_OVERRIDE_REQUIRES_HUMAN_REVIEW") ?? false },
    economics: { status: "UNPROVEN", reason: "COMPLETE_PROVEN_COST_INPUTS_REQUIRED" },
    marketOpportunity: canonical ? {
      status: "CANONICAL_V2_AVAILABLE",
      authoritative: true,
      canonicalResultVersion: canonical.versions.canonicalResultVersion,
      canonicalFamily: canonical.canonicalFamily.canonicalFamily,
      canonicalFamilyConfidence: canonical.canonicalFamily.confidence,
      attributeSet: canonical.canonicalFamily.attributes,
      commercialRecommendation: canonical.commercialRecommendation,
      keywordRecommendation: canonical.keywordIntelligence.spine,
      keywordOpportunity: { status: canonical.keywordIntelligence.keywordOpportunity,
        searchVolume: canonical.keywordIntelligence.searchVolume.status },
      priceOpportunity: canonical.priceOpportunity,
      referenceCandidate: canonical.referenceStrategy.primaryReference,
      useAsReferenceReadiness: canonical.commercialRecommendation.useAsReference,
      nextBestEvidence: canonical.nextBestEvidence,
      decisionTaxonomy: canonical.decisionIntegration,
      exceptionPriority: exception?.priority ?? null,
      legacyDiagnostics: { authoritative: false, mayOverrideCanonicalResult: false },
    } : {
      status: "CANONICAL_V2_NOT_AVAILABLE",
      authoritative: false,
      canonicalResultVersion: null,
      canonicalFamily: null,
      canonicalFamilyConfidence: null,
      attributeSet: [],
      commercialRecommendation: null,
      keywordRecommendation: null,
      keywordOpportunity: null,
      priceOpportunity: null,
      referenceCandidate: null,
      useAsReferenceReadiness: "UNPROVEN",
      nextBestEvidence: "NEED_CANONICAL_OPPORTUNITY_ANALYSIS",
      decisionTaxonomy: null,
      exceptionPriority: exception?.priority ?? null,
      reason: "NO_PERSISTED_LISTING_BOUND_CANONICAL_V2_RESULT",
      legacyDiagnostics: { authoritative: false,
        titleOnlyFamilyResolutionSuppressed: true, mayOverrideCanonicalResult: false },
    },
    learningHistory: { status: monitor.learning.status, limitationCode: monitor.learning.limitationCode },
    currentAlertState: cap(monitor.alertCandidates.filter((row) =>
      row.listingReference.itemId === itemId), 20), noFalseZeros: true as const }
}

export function buildAssistantCommercialContextV1(
  monitor: CommercialMonitorGetDto,
  canonicalOpportunities: Record<string, CanonicalOpportunityResultV2> = {},
) {
  const canonicalResults = Object.values(canonicalOpportunities).slice(0,
    SELLER_OS_ASSISTANT_MAX_ITEMS)
  const queue = buildProactiveExceptionQueueV1({ monitor,
    canonicalOpportunities: canonicalResults.map((row) => row.decisionIntegration),
    maximumEntries: 100 })
  const decisions = monitor.backend.decisions
  const integrity = resolveCrossModuleLivePortfolioIntegrityV1(monitor)
  const liveListings = currentLiveListingsForMonitorV1(monitor)
  const livePortfolioProven = ["AVAILABLE", "PARTIAL"].includes(
    monitor.backend.kpis.activeListings.status) &&
    typeof monitor.backend.kpis.activeListings.value === "number"
  return { contractVersion: SELLER_OS_ASSISTANT_GATEWAY_VERSION,
    generatedFrom: monitor.contractVersion, observedAt: monitor.generatedAt,
    accountTraffic: monitor.backend.trafficScopes.accountTraffic,
    currentLivePortfolio: monitor.backend.trafficScopes.currentLivePortfolio,
    monitorCoverage: monitor.backend.monitorCoverage
      ? { ...monitor.backend.monitorCoverage,
          monitoredItemIds: cap(
            [...monitor.backend.monitorCoverage.monitoredItemIds],
            25,
          ),
          visiblePriorityItemIds: cap(
            [...monitor.backend.monitorCoverage.visiblePriorityItemIds],
            25,
          ),
          monitoredItemIdsTruncated:
            monitor.backend.monitorCoverage.monitoredItemIds.length > 25 }
      : null,
    orderSourceHealth: monitor.backend.orderSourceHealth ?? null,
    officialOrders: assistantOfficialOrders(monitor),
    recentSales: { ...assistantRecentSales(monitor),
      entries: cap(assistantRecentSales(monitor).entries, 10) },
    livePortfolioIntegrity: {
      canonicalCohort: { ...integrity.canonicalCohort,
        itemIds: cap(integrity.canonicalCohort.itemIds, 25),
        itemIdSampleTruncated: integrity.canonicalCohort.itemIds.length > 25 },
      stockCohort: { currentLiveItemCount: integrity.stockCohort.currentLiveItemCount,
        nonLiveEvidenceRowCount: integrity.stockCohort.nonLiveEvidenceRowCount,
        duplicateItemIds: cap(integrity.stockCohort.duplicateItemIds, 20) },
      liveSkuUniqueness: { status: integrity.liveSkuUniqueness.status,
        collisionCount: integrity.liveSkuUniqueness.collisionCount,
        collisions: cap(integrity.liveSkuUniqueness.collisions, 20) },
      findings: cap(integrity.findings, 20),
      deterministicGuards: integrity.deterministicGuards,
      bounded: true as const },
    todaysPriorities: cap(selectMaterialPrioritiesV2(queue, 10), 10),
    activeExperiments: cap(decisions.filter((row) => row.experimentRunning), 20),
    doNotTouch: cap(decisions.filter((row) => row.protectionState === "DO_NOT_TOUCH"), 20),
    readyToEvaluate: cap(decisions.filter((row) =>
      row.experimentOperationalState === "READY_TO_EVALUATE"), 20),
    stockSupplierExceptions: cap(queue.filter((row) => row.classification === "CRITICAL_OPERATIONAL" ||
      row.reasonCodes.some((reason) => /STOCK|SUPPLIER/.test(reason))), 20),
    qualityGuidance: { status: monitor.backend.listingQualityReport.status,
      recommendations: cap(monitor.backend.listingQualityReport.recommendations, 20) },
    newOpportunities: { status: "UNPROVEN", resultCount: null, entries: [],
      scopeId: integrity.canonicalCohort.scopeId,
      scopeType: integrity.canonicalCohort.scopeType,
      scopeCount: integrity.canonicalCohort.listingCount,
      observedAt: integrity.canonicalCohort.observedAt,
      grain: "CANONICAL_OPPORTUNITY_RESULT" as const },
    replacementCandidates: { status: "UNPROVEN", resultCount: null,
      entries: [], scopeId: integrity.canonicalCohort.scopeId,
      scopeType: integrity.canonicalCohort.scopeType,
      scopeCount: integrity.canonicalCohort.listingCount,
      observedAt: integrity.canonicalCohort.observedAt,
      grain: "REPLACEMENT_CANDIDATE" as const },
    supplierReadiness: { status: livePortfolioProven
      ? "AVAILABLE" as const : "UNPROVEN" as const,
      exactLinkedListings: livePortfolioProven ? liveListings.filter((row) =>
        row.stock.supplierProductId && row.stock.supplierVariantId).length : null,
      totalLiveListings: livePortfolioProven
        ? integrity.canonicalCohort.listingCount : null,
      currentLiveScopeId: integrity.canonicalCohort.scopeId },
    economicsCompleteness: { status: "UNPROVEN", reason: "PROVEN_COST_INPUTS_REQUIRED" },
    learningSignals: { status: monitor.learning.status,
      categoryAdjustments: cap(monitor.learning.categoryAdjustments, 20),
      limitationCode: monitor.learning.limitationCode },
    capabilityBlockers: [
      ...monitor.backend.capabilities.registry.limitationCodes,
      monitor.backend.listingQualityReport.limitationCode,
      ...monitor.backend.orders.fulfillmentStatuses.filter((value) => value !== "AVAILABLE"),
      monitor.backend.capabilities.inventory.inventoryItemsResource,
    ].filter(Boolean),
    commercialIntelligence: {
      status: "READ_ONLY_ON_DEMAND" as const,
      canonicalResultVersion: "CANONICAL_OPPORTUNITY_RESULT_V2_2026_08_12",
      authoritativeResults: canonicalResults.map((row) => ({ itemId: row.sourceItemId,
        canonicalFamily: row.canonicalFamily.canonicalFamily,
        commercialRecommendation: row.commercialRecommendation,
        decisionTaxonomy: row.decisionIntegration })),
      legacyDiagnosticsAuthoritative: false as const,
      supportedFields: ["commercialRecommendation", "canonicalFamily", "keywordRecommendation",
        "keywordOpportunity", "priceOpportunity", "referenceCandidate",
        "useAsReferenceReadiness", "nextBestEvidence", "exceptionPriority"],
      batchPolicy: { bounded: true as const, maximumReturnedItems: SELLER_OS_ASSISTANT_MAX_ITEMS,
        persistenceRequiredForHistoricalOpportunityCases: true as const },
    },
    bounded: true as const, buyerPiiIncluded: false as const,
    credentialsIncluded: false as const, marketplaceWrites: 0 as const }
}

export function executeSellerOsAssistantToolV1(input: {
  toolName: string
  arguments: Record<string, unknown>
  monitor: CommercialMonitorGetDto
  canonicalOpportunities?: Record<string, CanonicalOpportunityResultV2>
}) {
  const maximum = typeof input.arguments.limit === "number" ? input.arguments.limit : 50
  const canonicalResults = Object.values(input.canonicalOpportunities ?? {})
    .slice(0, SELLER_OS_ASSISTANT_MAX_ITEMS)
  if (input.toolName === "seller_os_get_commercial_context") {
    return buildAssistantCommercialContextV1(input.monitor, input.canonicalOpportunities)
  }
  if (input.toolName === "seller_os_get_exception_queue") {
    return { entries: buildProactiveExceptionQueueV1({ monitor: input.monitor,
      canonicalOpportunities: Object.values(input.canonicalOpportunities ?? {})
        .map((row) => row.decisionIntegration),
      maximumEntries: maximum }), deterministic: true, marketplaceWrites: 0 }
  }
  if (input.toolName === "seller_os_get_listing_intelligence") {
    const itemId = typeof input.arguments.itemId === "string" ? input.arguments.itemId : ""
    if (!/^\d{9,19}$/.test(itemId)) throw new Error("ASSISTANT_ITEM_ID_REQUIRED")
    return safeListing(input.monitor, itemId, input.canonicalOpportunities?.[itemId]) ??
      { status: "NOT_FOUND", itemId }
  }
  if (input.toolName === "seller_os_get_opportunity_radar") {
    const entries = cap(canonicalResults.map((row) => ({ itemId: row.sourceItemId,
      canonicalResultVersion: row.versions.canonicalResultVersion,
      canonicalFamily: row.canonicalFamily.canonicalFamily,
      commercialRecommendation: row.commercialRecommendation,
      keywordRecommendation: row.keywordIntelligence.spine,
      keywordOpportunity: row.keywordIntelligence.keywordOpportunity,
      priceOpportunity: row.priceOpportunity,
      referenceCandidate: row.referenceStrategy.primaryReference,
      useAsReferenceReadiness: row.commercialRecommendation.useAsReference,
      nextBestEvidence: row.nextBestEvidence,
      decisionTaxonomy: row.decisionIntegration,
      legacyDiagnostics: { authoritative: false, mayOverrideCanonicalResult: false },
    })), maximum)
    return { status: entries.length ? "CANONICAL_V2_AVAILABLE" : "UNPROVEN",
      resultCount: entries.length ? entries.length : null, entries,
      reason: entries.length ? null : "PERSISTED_MARKET_OBSERVATION_SERIES_UNAVAILABLE",
      soldMomentumClaimed: false, readOnly: true, marketplaceWrites: 0 }
  }
  if (input.toolName === "seller_os_get_opportunity_case") {
    const id = typeof input.arguments.opportunityCaseId === "string"
      ? input.arguments.opportunityCaseId.slice(0, 120) : null
    const canonical = id ? input.canonicalOpportunities?.[id] ?? canonicalResults.find((row) =>
      row.sourceItemId === id || row.decisionIntegration.entityKey === id) ?? null : null
    if (canonical) return { status: "CANONICAL_V2_AVAILABLE", opportunityCaseId: id,
      canonicalResultVersion: canonical.versions.canonicalResultVersion,
      canonicalFamily: canonical.canonicalFamily.canonicalFamily,
      commercialRecommendation: canonical.commercialRecommendation,
      keywordRecommendation: canonical.keywordIntelligence.spine,
      keywordOpportunity: canonical.keywordIntelligence.keywordOpportunity,
      priceOpportunity: canonical.priceOpportunity,
      referenceCandidate: canonical.referenceStrategy.primaryReference,
      useAsReferenceReadiness: canonical.commercialRecommendation.useAsReference,
      nextBestEvidence: canonical.nextBestEvidence,
      decisionTaxonomy: canonical.decisionIntegration,
      legacyDiagnostics: { authoritative: false, mayOverrideCanonicalResult: false },
      productCaseMutations: 0, marketplaceWrites: 0 }
    return { status: id ? "UNPROVEN" : "ID_REQUIRED", opportunityCaseId: id,
      reason: "OPPORTUNITY_CASE_PERSISTENCE_NOT_ACTIVATED",
      commercialRecommendation: null, canonicalFamily: null, keywordRecommendation: null,
      keywordOpportunity: null, priceOpportunity: null, referenceCandidate: null,
      useAsReferenceReadiness: "UNPROVEN", nextBestEvidence: "NEED_PERSISTED_OPPORTUNITY_CASE",
      exceptionPriority: null, productCaseMutations: 0, marketplaceWrites: 0 }
  }
  if (input.toolName === "seller_os_get_experiments") {
    const entries = cap(input.monitor.backend.decisions.filter((row) =>
      row.experimentOperationalState !== "INACTIVE"), maximum)
    const authoritativeStatus =
      input.monitor.backend.operationalHealth.runningExperiments.status
    return { entries, resultCount: ["AVAILABLE", "PARTIAL"].includes(
      authoritativeStatus) ? entries.length : null, authoritativeStatus,
    marketplaceWrites: 0 }
  }
  if (input.toolName === "seller_os_get_stock_status") {
    const integrity = resolveCrossModuleLivePortfolioIntegrityV1(input.monitor)
    const liveListings = currentLiveListingsForMonitorV1(input.monitor)
    const entries = cap(liveListings.map((row) => ({ itemId: row.identity.itemId,
      title: row.identity.title, supplierLinkage: row.stock.supplierProductId &&
        row.stock.supplierVariantId ? "EXACT_PROVEN" : "UNPROVEN", state: row.stock.state,
      freshness: row.stock.freshness, quantity: row.stock.quantity.value,
      safeCapacity: row.composition.bundleCapacity.value,
      limitationCode: row.stock.limitationCode })), maximum)
    return { scope: integrity.canonicalCohort, entries,
      resultCount: integrity.canonicalCohort.identityStatus === "UNPROVEN"
        ? null : entries.length,
      historicalOrNonliveEvidence: {
        count: integrity.stockCohort.nonLiveEvidenceRowCount,
        itemIds: cap(integrity.stockCohort.nonLiveItemIds, maximum),
      },
      duplicateItemIds: cap(integrity.stockCohort.duplicateItemIds, maximum),
      stockUnknownIsRisk: false, marketplaceWrites: 0 }
  }
  if (input.toolName === "seller_os_get_quality_guidance") {
    const proven = ["AVAILABLE", "PARTIAL"].includes(
      input.monitor.backend.listingQualityReport.status)
    return { status: input.monitor.backend.listingQualityReport.status,
      resultCount: proven
        ? input.monitor.backend.listingQualityReport.recommendations.length : null,
      recommendations: cap(input.monitor.backend.listingQualityReport.recommendations, maximum),
      comparisons: cap(input.monitor.backend.guidanceVsSellerOs, maximum), autoExecutionAllowed: false }
  }
  if (input.toolName === "seller_os_get_learning_signals") {
    const proven = ["AVAILABLE", "PARTIAL"].includes(input.monitor.learning.status)
    return { status: input.monitor.learning.status,
      resultCount: proven ? input.monitor.learning.categoryAdjustments.length : null,
      categoryAdjustments: cap(input.monitor.learning.categoryAdjustments, maximum),
      limitationCode: input.monitor.learning.limitationCode, universalRuleAllowed: false }
  }
  if (input.toolName === "seller_os_get_operational_readiness") {
    const integrity = resolveCrossModuleLivePortfolioIntegrityV1(input.monitor)
    const liveListings = currentLiveListingsForMonitorV1(input.monitor)
    const livePortfolioProven = ["AVAILABLE", "PARTIAL"].includes(
      input.monitor.backend.kpis.activeListings.status) &&
      typeof input.monitor.backend.kpis.activeListings.value === "number"
    return { capabilities: input.monitor.backend.capabilities,
      automationHealth: buildAutomationHealthMetricsV1(livePortfolioProven
        ? { staleEntityCount: liveListings.filter((row) =>
          row.stock.freshness.status === "STALE").length,
        totalEntityCount: integrity.canonicalCohort.listingCount }
        : {}),
      portfolio: buildPortfolioIntelligenceV1({ monitor: input.monitor }),
      livePortfolioIntegrity: { scopeId: integrity.canonicalCohort.scopeId,
        scopeCount: integrity.canonicalCohort.listingCount,
        findingCount: integrity.findings.length,
        deterministicGuards: integrity.deterministicGuards },
      productCaseState: input.monitor.productCaseOperatingState, marketplaceWrites: 0 }
  }
  if (input.toolName === "seller_os_get_system_review_bundle") {
    return buildSystemReviewBundleV1({ monitor: input.monitor,
      canonicalOpportunities: input.canonicalOpportunities })
  }
  if (input.toolName === "seller_os_get_recent_system_changes") {
    return { status: "UNPROVEN_NO_DURABLE_CHANGE_LEDGER", resultCount: null,
      entries: [],
      bounded: true, maximumEntries: Math.min(maximum, 20), inferredChanges: false,
      marketplaceWrites: 0 }
  }
  if (input.toolName === "seller_os_get_strategic_review_queue") {
    return buildStrategicReviewQueueV1({ monitor: input.monitor,
      canonicalOpportunities: input.canonicalOpportunities,
      maximumSignals: Math.min(maximum, 20) })
  }
  throw new Error("ASSISTANT_TOOL_NOT_ALLOWLISTED")
}

export function buildReplacementAssessmentForItemV1(monitor: CommercialMonitorGetDto, itemId: string) {
  const listing = currentLiveListingsForMonitorV1(monitor).find((row) =>
    row.identity.itemId === itemId)
  if (!listing) return null
  return evaluateReplaceKillIntelligenceV1({ listing,
    decision: monitor.backend.decisions.find((row) => row.listingKey === listing.key) ?? null })
}
