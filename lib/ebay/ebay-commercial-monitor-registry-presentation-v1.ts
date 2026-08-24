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
  const liveCount = integrity.canonicalCohort.listingCount
  const liveSet = new Set(integrity.canonicalCohort.itemIds)
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
  const canonicalParity =
    integrity.canonicalCohort.identityStatus === "CERTIFIED" &&
    liveListings.length === liveCount &&
    monitor.backend.monitorCoverage.status === "AVAILABLE" &&
    monitor.backend.monitorCoverage.currentLiveScopeId ===
      integrity.canonicalCohort.scopeId &&
    monitor.backend.monitorCoverage.currentLiveScopeCount === liveCount &&
    integrity.stockCohort.currentLiveItemCount === liveCount
  const unlinkedLive = liveCount - lunaLinkedCertified
  const unmonitoredLive = liveCount - monitoredItemIds.size
  const liveWithoutStockguard = stockguardMissingItemIds.size
  const currentLiveInvariantPass = canonicalParity && unlinkedLive === 0 &&
    unmonitoredLive === 0 && liveWithoutStockguard === 0

  return Object.freeze({
    contractVersion: SELLER_OS_CANONICAL_LIVE_DASHBOARD_VERSION,
    canonicalParity,
    monitorAndInventoryCanonicalParity: canonicalParity,
    currentLiveInvariantPass,
    status: canonicalParity ? "AVAILABLE" as const : "UNPROVEN" as const,
    scopeId: integrity.canonicalCohort.scopeId,
    observedAt: integrity.canonicalCohort.observedAt,
    liveCount,
    exactSupplierLinked: lunaLinkedCertified,
    needsLinkage: unlinkedLive,
    lunaLinkedCertified,
    unlinkedLive,
    monitoredLive: monitoredItemIds.size,
    unmonitoredLive,
    stockguardEnrolledLive: liveCount - stockguardMissingItemIds.size,
    stockGuardEnrolled: liveCount - stockguardMissingItemIds.size,
    liveWithoutStockguard,
    inStockSignal: liveListings.filter((listing) =>
      listing.stock.state === "IN_STOCK_SIGNAL").length,
    certifiedOosLive: liveListings.filter((listing) =>
      listing.stock.state === "CERTIFIED_OOS").length,
    stockUnknown: liveListings.filter((listing) =>
      listing.stock.state === "STOCK_UNKNOWN").length,
    identityMismatch: liveListings.filter((listing) =>
      listing.stock.supplierLinkageStatus === "CERTIFIED" &&
      listing.stock.limitationCode ===
        "CERTIFIED_COMPONENT_STOCK_IDENTITY_MISMATCH").length,
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
