import type { CommercialMonitorBackendV1 } from
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
