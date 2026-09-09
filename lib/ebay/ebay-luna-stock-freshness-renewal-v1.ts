export const SELLER_OS_LUNA_STOCK_FRESHNESS_RENEWAL_VERSION =
  "SELLER_OS_LUNA_STOCK_FRESHNESS_RENEWAL_V1" as const
export const SELLER_OS_STOCK_RECONCILIATION_MAX_TARGETS_V1 = 20 as const

type RenewalListing = Readonly<{
  itemId: string
  liveStatus: string
  supplierLinkageStatus: string | null | undefined
  limitationCode: string | null
  freshness: Readonly<{
    status: "FRESH" | "STALE" | "UNKNOWN" | "NOT_APPLICABLE"
    ageSeconds: number | null
    maximumAgeSeconds: number | null
  }>
}>

function boundedSeconds(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.max(60, Math.min(604_800, Math.trunc(parsed)))
    : fallback
}

export function selectSellerOsLunaStockFreshnessRenewalsV1(input: Readonly<{
  listings: readonly RenewalListing[]
  schedulerIntervalSeconds: number
  cycleStartedAt?: string
}>) {
  const schedulerIntervalSeconds = boundedSeconds(
    input.schedulerIntervalSeconds,
    900,
  )
  const outcomes = input.listings.map((listing) => {
    if (listing.liveStatus !== "LIVE_ACTIVE") {
      return Object.freeze({ itemId: listing.itemId, due: false as const,
        reasonCode: "NOT_CURRENT_LIVE" as const, renewalLeadSeconds: null })
    }
    if (listing.supplierLinkageStatus !== "CERTIFIED") {
      return Object.freeze({ itemId: listing.itemId, due: false as const,
        reasonCode: "CERTIFIED_LINKAGE_REQUIRED" as const,
        renewalLeadSeconds: null })
    }
    if (listing.limitationCode ===
        "CERTIFIED_COMPONENT_STOCK_IDENTITY_MISMATCH") {
      return Object.freeze({ itemId: listing.itemId, due: false as const,
        reasonCode: "CERTIFIED_IDENTITY_MISMATCH" as const,
        renewalLeadSeconds: null })
    }
    const maximumAgeSeconds = listing.freshness.maximumAgeSeconds
    const ageSeconds = listing.freshness.ageSeconds
    if (listing.freshness.status === "STALE") {
      return Object.freeze({ itemId: listing.itemId, due: true as const,
        reasonCode: "STALE_EVIDENCE" as const,
        renewalLeadSeconds: maximumAgeSeconds })
    }
    if (listing.freshness.status === "UNKNOWN" ||
        listing.freshness.status === "NOT_APPLICABLE" ||
        maximumAgeSeconds === null || ageSeconds === null) {
      return Object.freeze({ itemId: listing.itemId, due: true as const,
        reasonCode: "MISSING_OR_UNKNOWN_EVIDENCE" as const,
        renewalLeadSeconds: maximumAgeSeconds })
    }
    // The lead window is derived from this evidence's own TTL and the
    // existing scheduler cadence. It deliberately does not assume a universal
    // six-hour freshness rule.
    const renewalLeadSeconds = Math.min(maximumAgeSeconds, Math.max(
      schedulerIntervalSeconds * 2,
      Math.ceil(maximumAgeSeconds / 10),
    ))
    const due = ageSeconds >= maximumAgeSeconds - renewalLeadSeconds
    return Object.freeze({ itemId: listing.itemId, due,
      reasonCode: due
        ? "APPROACHING_EVIDENCE_TTL" as const
        : "EVIDENCE_CURRENT" as const,
      renewalLeadSeconds })
  })
  const due = outcomes.filter((outcome) => outcome.due)
    .map((outcome) => outcome.itemId).sort()
  const cycleStartedAt = input.cycleStartedAt &&
      Number.isFinite(Date.parse(input.cycleStartedAt))
    ? Date.parse(input.cycleStartedAt) : 0
  const cycleOrdinal = cycleStartedAt > 0
    ? Math.floor(cycleStartedAt / (schedulerIntervalSeconds * 1_000)) : 0
  // Rotate one full batch per scheduler slot. A persistently failing low item
  // ID therefore cannot permanently hide later eligible items.
  const offset = due.length > SELLER_OS_STOCK_RECONCILIATION_MAX_TARGETS_V1
    ? (cycleOrdinal * SELLER_OS_STOCK_RECONCILIATION_MAX_TARGETS_V1) % due.length
    : 0
  const rotated = due.length ? [...due.slice(offset), ...due.slice(0, offset)] : []
  const selectedTargetItemIds = rotated.slice(
    0,
    SELLER_OS_STOCK_RECONCILIATION_MAX_TARGETS_V1,
  )
  const selected = new Set(selectedTargetItemIds)
  const deferredTargetItemIds = due.filter((itemId) => !selected.has(itemId))
  return Object.freeze({
    contractVersion: SELLER_OS_LUNA_STOCK_FRESHNESS_RENEWAL_VERSION,
    schedulerIntervalSeconds,
    maximumTargetsPerCycle: SELLER_OS_STOCK_RECONCILIATION_MAX_TARGETS_V1,
    eligibleTargetItemIds: Object.freeze(due),
    targetItemIds: Object.freeze(selectedTargetItemIds),
    deferredTargetItemIds: Object.freeze(deferredTargetItemIds),
    deferred: Object.freeze(deferredTargetItemIds.map((itemId) =>
      Object.freeze({ itemId, status: "DEFERRED_NOT_PROCESSED" as const }))),
    operationalEfficiency: Object.freeze({
      selectorMaximum: SELLER_OS_STOCK_RECONCILIATION_MAX_TARGETS_V1,
      reconcilerMaximum: SELLER_OS_STOCK_RECONCILIATION_MAX_TARGETS_V1,
      deferredCountedAsComponentFailure: false as const,
      additionalPollers: 0 as const,
    }),
    selectionOffset: offset,
    outcomes: Object.freeze(outcomes),
  })
}
