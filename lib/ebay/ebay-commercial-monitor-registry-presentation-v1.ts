import type {
  CommercialListingReadModel,
  CommercialMonitorBackendV1,
  CommercialMonitorGetDto,
} from
  "./commercial-monitor-readonly-contract"

type RegistryCapability = CommercialMonitorBackendV1["capabilities"]["registry"]

function finite(value: number | null) {
  return value !== null && Number.isFinite(value) ? value : null
}

export function presentCommercialMonitorRegistryV1(registry: RegistryCapability) {
  const currentLiveCount = finite(registry.currentLiveCount)
  const matchedCount = finite(registry.matchedCount)
  const humanReviewCount = finite(registry.humanReviewCount)
  const observedCoverage = finite(registry.coveragePercent)
  const derivedCoverage = observedCoverage ?? (
    currentLiveCount !== null && currentLiveCount > 0 && matchedCount !== null
      ? Math.round((matchedCount / currentLiveCount) * 10_000) / 100
      : currentLiveCount === 0 && matchedCount === 0 ? 100 : null
  )
  const available = matchedCount !== null && humanReviewCount !== null && derivedCoverage !== null
  const limitation = [...new Set(registry.limitationCodes.filter(Boolean))].sort()[0] ??
    "REGISTRY_CURRENT_AGGREGATES_UNAVAILABLE"
  return {
    status: registry.status,
    currentLiveCount,
    matchedCount,
    humanReviewCount,
    coveragePercent: derivedCoverage,
    available,
    limitationCode: available ? null : limitation,
    summary: available
      ? `${matchedCount} matched · ${humanReviewCount} review · ${derivedCoverage}%`
      : `Unavailable · ${limitation.replaceAll("_", " ")}`,
  }
}

export const SELLER_OS_CANONICAL_LIVE_DASHBOARD_VERSION =
  "DASHBOARD_AND_LIVE_LISTING_INVARIANT_HARDENING_V1" as const

export const CERTIFIED_COMPONENT_STOCK_IDENTITY_MISMATCH =
  "CERTIFIED_COMPONENT_STOCK_IDENTITY_MISMATCH" as const

export function presentSellerOsCanonicalDashboardKpisV1(
  monitor: CommercialMonitorGetDto,
) {
  const backend = monitor.backend
  const livePortfolio = Object.freeze({
    scope: "CURRENT_LIVE_PORTFOLIO" as const,
    activeListings: backend.kpis.activeListings,
    impressions: backend.kpis.impressions,
    ebayViews: backend.kpis.ebayViews,
    averageCtr: backend.kpis.averageCtr,
    quantitySold: backend.kpis.quantitySold,
  })
  const accountTraffic = Object.freeze({
    ...backend.trafficScopes.accountTraffic,
    scope: "ACCOUNT_TRAFFIC" as const,
  })
  const availableValueViolations = [
    ["ACTIVE_LISTINGS", livePortfolio.activeListings],
    ["IMPRESSIONS", livePortfolio.impressions],
    ["EBAY_VIEWS", livePortfolio.ebayViews],
    ["AVERAGE_CTR", livePortfolio.averageCtr],
    ["QUANTITY_SOLD", livePortfolio.quantitySold],
    ["ORDERS", backend.kpis.orders],
  ].flatMap(([metric, observation]) =>
    typeof observation === "object" && observation !== null &&
      "status" in observation && observation.status === "AVAILABLE" &&
      "value" in observation && observation.value === null
      ? [String(metric)]
      : [])

  return Object.freeze({
    contractVersion: "SELLER_OS_DASHBOARD_CANONICAL_KPI_HYDRATION_V1" as const,
    livePortfolio,
    accountTraffic,
    orders: backend.kpis.orders,
    listingQualityReport: backend.listingQualityReport,
    availableValueViolations: Object.freeze(availableValueViolations),
    scopesSeparated: true as const,
  })
}

export function presentStockGuardInventoryIdentityV1(
  listing: CommercialListingReadModel,
) {
  const supplierLinkageCertified =
    listing.stock.supplierLinkageStatus === "CERTIFIED"
  const certifiedStockIdentityMismatch = supplierLinkageCertified &&
    listing.stock.state === "STOCK_UNKNOWN" &&
    listing.stock.limitationCode ===
      CERTIFIED_COMPONENT_STOCK_IDENTITY_MISMATCH

  return Object.freeze({
    supplierLinkageCertified,
    supplierLinkageLabel: supplierLinkageCertified
      ? "Evidencia exacta ✅" : "No comprobado",
    certifiedStockIdentityMismatch,
    stockLabel: certifiedStockIdentityMismatch
      ? "Stock desconocido ⚠️" : null,
    stockDetail: certifiedStockIdentityMismatch
      ? "Identidad de stock no conciliada" : null,
    freshnessLabel: certifiedStockIdentityMismatch ? "Desconocida" : null,
    freshnessDetail: certifiedStockIdentityMismatch
      ? "No existe todavía evidencia de stock conciliada para calcular vigencia."
      : null,
    riskLabel: certifiedStockIdentityMismatch ? "Stock desconocido" : null,
    recommendedAction: certifiedStockIdentityMismatch
      ? "Reconciliar identidad de stock del producto certificado con la evidencia de disponibilidad de Luna."
      : null,
  })
}

function evidenceScore(listing: CommercialListingReadModel) {
  const metrics = Object.values(listing.metrics).filter((metric) =>
    (metric.availability === "AVAILABLE" || metric.availability === "PARTIAL") &&
    typeof metric.value === "number" && Number.isFinite(metric.value)).length
  return (listing.identity.marketplaceCertification?.status === "US_CERTIFIED"
    ? 10_000 : 0) + metrics * 100 + listing.evidenceReferences.length
}

export function selectCanonicalCurrentLiveListingsV1(
  monitor: CommercialMonitorGetDto,
) {
  const liveSet = new Set(
    monitor.backend.livePortfolioIntegrity.canonicalCohort.itemIds,
  )
  const byItemId = new Map<string, CommercialListingReadModel[]>()
  for (const listing of monitor.listings) {
    const itemId = listing.identity.itemId.trim()
    if (!liveSet.has(itemId) ||
        listing.discovery.livePresence.status !== "LIVE_ACTIVE") continue
    byItemId.set(itemId, [...(byItemId.get(itemId) ?? []), listing])
  }
  return [...byItemId.values()].map((rows) => [...rows].sort((left, right) =>
    evidenceScore(right) - evidenceScore(left) ||
    left.key.localeCompare(right.key))[0])
}

export function buildCanonicalLiveListingDashboardMetricsV1(
  monitor: CommercialMonitorGetDto,
) {
  const integrity = monitor.backend.livePortfolioIntegrity
  const authority = monitor.backend.currentLiveAuthority
  const currentAvailable = authority.currentState === "CURRENT_FRESH" &&
    authority.currentListingCount !== null
  const liveCount = currentAvailable ? authority.currentListingCount : null
  const liveSet = new Set(currentAvailable ? authority.currentItemIds : [])
  const liveListings = selectCanonicalCurrentLiveListingsV1(monitor)
  const monitoredItemIds = new Set(
    monitor.backend.monitorCoverage.monitoredItemIds.filter((itemId) =>
      liveSet.has(itemId)),
  )
  const stockguardMissingItemIds = new Set(
    integrity.stockCohort.missingCurrentLiveItemIds,
  )
  const lunaLinkedCertified = liveListings.filter((listing) =>
    listing.stock.supplierLinkageStatus === "CERTIFIED").length
  const canonicalParity = currentAvailable && liveCount !== null &&
    integrity.canonicalCohort.identityStatus === "CERTIFIED" &&
    liveListings.length === liveCount &&
    monitor.backend.monitorCoverage.status === "AVAILABLE" &&
    monitor.backend.monitorCoverage.currentLiveScopeId ===
      integrity.canonicalCohort.scopeId &&
    monitor.backend.monitorCoverage.currentLiveScopeCount === liveCount &&
    integrity.stockCohort.currentLiveItemCount === liveCount
  const unlinkedLive = liveCount === null ? null
    : liveCount - lunaLinkedCertified
  const unmonitoredLive = liveCount === null ? null
    : liveCount - monitoredItemIds.size
  const liveWithoutStockguard = currentAvailable
    ? stockguardMissingItemIds.size : null
  const freshEvidenceItemIds = new Set(liveListings.filter((listing) =>
    listing.stock.freshness?.status === "FRESH")
    .map((listing) => listing.identity.itemId))
  const protectedItemIds = new Set(liveListings.filter((listing) =>
    listing.stock.supplierLinkageStatus === "CERTIFIED" &&
    !stockguardMissingItemIds.has(listing.identity.itemId) &&
    listing.stock.freshness?.status === "FRESH")
    .map((listing) => listing.identity.itemId))
  const attentionItemIds = new Set([
    ...(currentAvailable ? integrity.canonicalCohort.itemIds : [])
      .filter((itemId) =>
      !protectedItemIds.has(itemId)),
    ...liveListings.filter((listing) =>
      listing.stock.state === "STOCK_UNKNOWN" ||
      listing.stock.state === "CERTIFIED_OOS")
      .map((listing) => listing.identity.itemId),
  ])
  const currentLiveInvariantPass = canonicalParity && unlinkedLive === 0 &&
    unmonitoredLive === 0 && liveWithoutStockguard === 0

  return Object.freeze({
    contractVersion: SELLER_OS_CANONICAL_LIVE_DASHBOARD_VERSION,
    canonicalParity,
    monitorAndInventoryCanonicalParity: canonicalParity,
    currentLiveInvariantPass,
    status: canonicalParity ? "AVAILABLE" as const : "UNPROVEN" as const,
    currentAuthorityState: authority.currentState,
    lastCertifiedState: authority.lastCertifiedState,
    lastCertifiedLiveCount: authority.lastCertifiedListingCount,
    lastCertifiedAt: authority.lastCertifiedAt,
    sourceFailureCode: authority.sourceFailureCode,
    nextRetryAt: authority.nextRetryAt,
    scopeId: authority.scopeId ?? integrity.canonicalCohort.scopeId,
    observedAt: authority.currentObservedAt,
    liveCount,
    exactSupplierLinked: currentAvailable ? lunaLinkedCertified : null,
    needsLinkage: unlinkedLive,
    lunaLinkedCertified: currentAvailable ? lunaLinkedCertified : null,
    unlinkedLive,
    monitoredLive: currentAvailable ? monitoredItemIds.size : null,
    unmonitoredLive,
    stockguardEnrolledLive: liveCount === null ? null
      : liveCount - stockguardMissingItemIds.size,
    stockGuardEnrolled: liveCount === null ? null
      : liveCount - stockguardMissingItemIds.size,
    liveWithoutStockguard,
    freshEvidenceLive: currentAvailable ? freshEvidenceItemIds.size : null,
    stockguardProtectedLive: currentAvailable ? protectedItemIds.size : null,
    stockguardRequiresAttention: currentAvailable ? attentionItemIds.size : null,
    inStockSignal: currentAvailable ? liveListings.filter((listing) =>
      listing.stock.state === "IN_STOCK_SIGNAL").length : null,
    certifiedOosLive: currentAvailable ? liveListings.filter((listing) =>
      listing.stock.state === "CERTIFIED_OOS").length : null,
    stockUnknown: currentAvailable ? liveListings.filter((listing) =>
      listing.stock.state === "STOCK_UNKNOWN").length : null,
    identityMismatch: currentAvailable ? liveListings.filter((listing) =>
      listing.stock.supplierLinkageStatus === "CERTIFIED" &&
      listing.stock.limitationCode ===
        CERTIFIED_COMPONENT_STOCK_IDENTITY_MISMATCH).length : null,
    definitions: Object.freeze({
      linkedMeansSupplierLinkageCertifiedOnly: true as const,
      linkedDoesNotRequireInStock: true as const,
      certifiedOosRemainsVisibleAsRisk: true as const,
      needsLinkageDoesNotMeanStockUnknown: true as const,
      actionableDoesNotComeFromStockUnknown: true as const,
      nonLiveEvidenceExcluded: true as const,
    }),
  })
}
