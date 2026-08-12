import type { CommercialMonitorGetDto } from "./commercial-monitor-readonly-contract"
import { buildAutomationHealthMetricsV1, buildPortfolioIntelligenceV1,
  buildProactiveExceptionQueueV1, evaluateReplaceKillIntelligenceV1 } from
  "./ebay-seller-os-portfolio-intelligence-v1"

export const SELLER_OS_ASSISTANT_GATEWAY_VERSION = "SELLER_OS_ASSISTANT_GATEWAY_V1_2026_08_12"
export const SELLER_OS_ASSISTANT_MAX_ITEMS = 100

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
].map(([name, title, description]) => ({ name, title, description,
  annotations: { readOnlyHint: true as const, destructiveHint: false as const,
    openWorldHint: false as const, idempotentHint: true as const },
  securitySchemes: [{ type: "oauth2" as const, scopes: ["seller_os.read"] }],
  sideEffects: false as const })))

function cap<T>(values: T[], maximum = SELLER_OS_ASSISTANT_MAX_ITEMS) {
  return values.slice(0, Math.min(SELLER_OS_ASSISTANT_MAX_ITEMS, Math.max(1, maximum)))
}

function safeListing(monitor: CommercialMonitorGetDto, itemId: string) {
  const listing = monitor.listings.find((row) => row.identity.itemId === itemId)
  if (!listing) return null
  const decision = monitor.backend.decisions.find((row) => row.listingKey === listing.key) ?? null
  const guidance = monitor.backend.guidanceVsSellerOs.find((row) => row.listingKey === listing.key) ?? null
  return { identity: { itemId: listing.identity.itemId, title: listing.identity.title,
      sku: listing.identity.sku, thumbnail: listing.identity.primaryImageUrl,
      liveStatus: listing.discovery.livePresence.status },
    analytics: { impressions: listing.metrics.impressions, views: listing.metrics.ebay_views,
      ctr: listing.metrics.ctr_calculated, quantitySold: listing.metrics.transactions,
      scope: "CURRENT_LIVE_LISTING" },
    accountTrafficScope: monitor.backend.trafficScopes.accountTraffic,
    ordersStatus: monitor.backend.orders.status,
    qualityGuidance: guidance,
    diagnosis: decision ? { classification: decision.classification, evidenceStatus: decision.evidenceStatus,
      reasonCodes: decision.reasonCodes, recommendedOperationalAction: decision.recommendedAction } : null,
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
    marketOpportunity: { status: "UNPROVEN", reason: "NO_LISTING_BOUND_OPPORTUNITY_CASE" },
    learningHistory: { status: monitor.learning.status, limitationCode: monitor.learning.limitationCode },
    currentAlertState: cap(monitor.alertCandidates.filter((row) =>
      row.listingReference.itemId === itemId), 20), noFalseZeros: true as const }
}

export function buildAssistantCommercialContextV1(monitor: CommercialMonitorGetDto) {
  const queue = buildProactiveExceptionQueueV1({ monitor, maximumEntries: 100 })
  const decisions = monitor.backend.decisions
  return { contractVersion: SELLER_OS_ASSISTANT_GATEWAY_VERSION,
    generatedFrom: monitor.contractVersion, observedAt: monitor.generatedAt,
    accountTraffic: monitor.backend.trafficScopes.accountTraffic,
    currentLivePortfolio: monitor.backend.trafficScopes.currentLivePortfolio,
    todaysPriorities: cap(queue.filter((row) => row.classification !== "WAIT_HEALTHY"), 10),
    activeExperiments: cap(decisions.filter((row) => row.experimentRunning), 20),
    doNotTouch: cap(decisions.filter((row) => row.protectionState === "DO_NOT_TOUCH"), 20),
    readyToEvaluate: cap(decisions.filter((row) =>
      row.experimentOperationalState === "READY_TO_EVALUATE"), 20),
    stockSupplierExceptions: cap(queue.filter((row) => ["CRITICAL_OPERATIONAL", "STALE_EVIDENCE"]
      .includes(row.classification)), 20),
    qualityGuidance: { status: monitor.backend.listingQualityReport.status,
      recommendations: cap(monitor.backend.listingQualityReport.recommendations, 20) },
    newOpportunities: { status: "UNPROVEN", entries: [] },
    replacementCandidates: { status: "UNPROVEN", entries: [] },
    supplierReadiness: { exactLinkedListings: monitor.listings.filter((row) =>
      row.stock.supplierProductId && row.stock.supplierVariantId).length,
      totalLiveListings: monitor.backend.kpis.activeListings.value },
    economicsCompleteness: { status: "UNPROVEN", reason: "PROVEN_COST_INPUTS_REQUIRED" },
    learningSignals: { status: monitor.learning.status,
      categoryAdjustments: cap(monitor.learning.categoryAdjustments, 20),
      limitationCode: monitor.learning.limitationCode },
    capabilityBlockers: [
      ...monitor.backend.capabilities.registry.limitationCodes,
      monitor.backend.listingQualityReport.limitationCode,
      ...monitor.backend.orders.fulfillmentStatuses.filter((value) => value !== "AVAILABLE"),
      monitor.backend.capabilities.inventory.inventoryItemsResource,
    ].filter(Boolean), bounded: true as const, buyerPiiIncluded: false as const,
    credentialsIncluded: false as const, marketplaceWrites: 0 as const }
}

export function executeSellerOsAssistantToolV1(input: {
  toolName: string
  arguments: Record<string, unknown>
  monitor: CommercialMonitorGetDto
}) {
  const maximum = typeof input.arguments.limit === "number" ? input.arguments.limit : 50
  if (input.toolName === "seller_os_get_commercial_context") {
    return buildAssistantCommercialContextV1(input.monitor)
  }
  if (input.toolName === "seller_os_get_exception_queue") {
    return { entries: buildProactiveExceptionQueueV1({ monitor: input.monitor,
      maximumEntries: maximum }), deterministic: true, marketplaceWrites: 0 }
  }
  if (input.toolName === "seller_os_get_listing_intelligence") {
    const itemId = typeof input.arguments.itemId === "string" ? input.arguments.itemId : ""
    if (!/^\d{9,19}$/.test(itemId)) throw new Error("ASSISTANT_ITEM_ID_REQUIRED")
    return safeListing(input.monitor, itemId) ?? { status: "NOT_FOUND", itemId }
  }
  if (input.toolName === "seller_os_get_opportunity_radar") {
    return { status: "UNPROVEN", entries: [],
      reason: "PERSISTED_MARKET_OBSERVATION_SERIES_UNAVAILABLE", soldMomentumClaimed: false }
  }
  if (input.toolName === "seller_os_get_opportunity_case") {
    const id = typeof input.arguments.opportunityCaseId === "string"
      ? input.arguments.opportunityCaseId.slice(0, 120) : null
    return { status: id ? "UNPROVEN" : "ID_REQUIRED", opportunityCaseId: id,
      reason: "OPPORTUNITY_CASE_PERSISTENCE_NOT_ACTIVATED", productCaseMutations: 0 }
  }
  if (input.toolName === "seller_os_get_experiments") {
    return { entries: cap(input.monitor.backend.decisions.filter((row) =>
      row.experimentOperationalState !== "INACTIVE"), maximum), authoritativeStatus:
      input.monitor.backend.operationalHealth.runningExperiments.status, marketplaceWrites: 0 }
  }
  if (input.toolName === "seller_os_get_stock_status") {
    return { entries: cap(input.monitor.listings.map((row) => ({ itemId: row.identity.itemId,
      title: row.identity.title, supplierLinkage: row.stock.supplierProductId &&
        row.stock.supplierVariantId ? "EXACT_PROVEN" : "UNPROVEN", state: row.stock.state,
      freshness: row.stock.freshness, quantity: row.stock.quantity.value,
      safeCapacity: row.composition.bundleCapacity.value, limitationCode: row.stock.limitationCode })), maximum),
      stockUnknownIsRisk: false, marketplaceWrites: 0 }
  }
  if (input.toolName === "seller_os_get_quality_guidance") {
    return { status: input.monitor.backend.listingQualityReport.status,
      recommendations: cap(input.monitor.backend.listingQualityReport.recommendations, maximum),
      comparisons: cap(input.monitor.backend.guidanceVsSellerOs, maximum), autoExecutionAllowed: false }
  }
  if (input.toolName === "seller_os_get_learning_signals") {
    return { status: input.monitor.learning.status,
      categoryAdjustments: cap(input.monitor.learning.categoryAdjustments, maximum),
      limitationCode: input.monitor.learning.limitationCode, universalRuleAllowed: false }
  }
  if (input.toolName === "seller_os_get_operational_readiness") {
    return { capabilities: input.monitor.backend.capabilities,
      automationHealth: buildAutomationHealthMetricsV1({ staleEntityCount:
        input.monitor.listings.filter((row) => row.stock.freshness.status === "STALE").length,
      totalEntityCount: input.monitor.listings.length }),
      portfolio: buildPortfolioIntelligenceV1({ monitor: input.monitor }),
      productCaseState: input.monitor.productCaseOperatingState, marketplaceWrites: 0 }
  }
  throw new Error("ASSISTANT_TOOL_NOT_ALLOWLISTED")
}

export function buildReplacementAssessmentForItemV1(monitor: CommercialMonitorGetDto, itemId: string) {
  const listing = monitor.listings.find((row) => row.identity.itemId === itemId)
  if (!listing) return null
  return evaluateReplaceKillIntelligenceV1({ listing,
    decision: monitor.backend.decisions.find((row) => row.listingKey === listing.key) ?? null })
}
