export const SELLER_OS_LUNA_STOCK_FRESHNESS_RENEWAL_VERSION =
  "SELLER_OS_LUNA_STOCK_FRESHNESS_RENEWAL_V1" as const

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
  return Object.freeze({
    contractVersion: SELLER_OS_LUNA_STOCK_FRESHNESS_RENEWAL_VERSION,
    schedulerIntervalSeconds,
    targetItemIds: Object.freeze(due.map((outcome) => outcome.itemId).sort()),
    outcomes: Object.freeze(outcomes),
  })
}
