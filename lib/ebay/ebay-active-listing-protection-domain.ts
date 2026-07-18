export const EBAY_INVENTORY_READONLY_SOURCE =
  "EBAY_SELL_INVENTORY_READONLY" as const
export const EBAY_TRADING_READONLY_SOURCE =
  "EBAY_TRADING_GET_ITEM_READONLY" as const

export type ActiveListingProtectionIdentityRow = {
  id: string
  account_key: string
  source: string
  ebay_item_id: string
  ebay_sku: string | null
  listing_status: string
  last_ebay_sync_at: string | null
}

export type ActiveListingProtectionObservation = {
  listingId: string
  source: string
  listingStatus: string
  ebaySku: string | null
  observedAt: string | null
}

export type CanonicalActiveListingProtectionGroup<
  T extends ActiveListingProtectionIdentityRow,
> = {
  canonicalKey: string
  accountKey: string
  ebayItemId: string
  ebaySku: string | null
  listing: T
  memberListingIds: string[]
  observations: ActiveListingProtectionObservation[]
}

export type CurrentLunaVariantIdentity = {
  product_id: string | null
  supplier_variant_id: string | null
  sku: string | null
  source_key?: string | null
}

export type ExactLunaVariantResolution =
  | {
      status: "resolved"
      productId: string
      supplierVariantId: string
      supplierSku: string
    }
  | {
      status: "missing" | "ambiguous"
      productId: null
      supplierVariantId: null
      supplierSku: null
    }

export type ActiveListingProtectionHealthRow =
  ActiveListingProtectionIdentityRow & {
    market_radar_product_id: string | null
    supplier_variant_id: string | null
    supplier_sku: string | null
    last_radar_review_at: string | null
  }

export type ActiveListingProtectionMonitorStatus =
  | "ACTIVE"
  | "MANUAL_RECENT"
  | "DEGRADED"
  | "NOT_MONITORED"
  | "NOT_APPLICABLE"

function normalizedRequiredIdentity(value: string) {
  return value.normalize("NFKC").trim()
}

export function normalizeActiveListingProtectionSku(value: string | null) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC").trim()
  return normalized || null
}

/**
 * Resolves a supplier identity only when the current Luna catalog contains one
 * exact product + variant for the listing SKU. SKU matching is deliberately
 * case-sensitive. A supplied variant ID is an additional required identity
 * component, never a hint that can be ignored.
 */
export function resolveExactUniqueCurrentLunaVariant(
  input: {
    supplierSku: string | null
    supplierVariantId: string | null
  },
  rows: CurrentLunaVariantIdentity[],
): ExactLunaVariantResolution {
  const supplierSku = normalizeActiveListingProtectionSku(input.supplierSku)
  const supplierVariantId = normalizeActiveListingProtectionSku(
    input.supplierVariantId,
  )
  if (!supplierSku) {
    return {
      status: "missing",
      productId: null,
      supplierVariantId: null,
      supplierSku: null,
    }
  }

  const exact = rows.filter((row) => {
    const rowProductId = normalizeActiveListingProtectionSku(row.product_id)
    const rowVariantId = normalizeActiveListingProtectionSku(
      row.supplier_variant_id,
    )
    const rowSku = normalizeActiveListingProtectionSku(row.sku)
    return Boolean(
      rowProductId &&
      rowVariantId &&
      rowSku === supplierSku &&
      (!supplierVariantId || rowVariantId === supplierVariantId) &&
      (row.source_key === undefined || row.source_key === "lunaportex"),
    )
  })
  const identities = new Map(exact.map((row) => {
    const productId = normalizeActiveListingProtectionSku(row.product_id) as string
    const variantId = normalizeActiveListingProtectionSku(
      row.supplier_variant_id,
    ) as string
    const sku = normalizeActiveListingProtectionSku(row.sku) as string
    return [JSON.stringify([productId, variantId, sku]), {
      productId,
      supplierVariantId: variantId,
      supplierSku: sku,
    }]
  }))
  if (identities.size === 1) {
    const identity = identities.values().next().value as {
      productId: string
      supplierVariantId: string
      supplierSku: string
    }
    return { status: "resolved", ...identity }
  }
  return {
    status: identities.size > 1 ? "ambiguous" : "missing",
    productId: null,
    supplierVariantId: null,
    supplierSku: null,
  }
}

function freshAt(value: string | null, cutoff: number) {
  const parsed = Date.parse(value ?? "")
  return Number.isFinite(parsed) && parsed >= cutoff
}

/**
 * A truthful monitor badge requires both sides of the loop: a fresh targeted
 * Luna heartbeat and a fresh protection review for every canonical active
 * listing. Full-catalog freshness remains visible but cannot substitute for
 * the active-listing monitor heartbeat.
 */
export function projectActiveListingProtectionMonitorHealth(input: {
  listings: ActiveListingProtectionHealthRow[]
  targetedMonitorLastSuccessAt: string | null
  fullCatalogLastSuccessAt: string | null
  targetedMonitorEnabled: boolean
  openMappingBrokenListingIds?: string[]
  now?: Date
  maximumAgeHours?: number
}) {
  const now = input.now ?? new Date()
  const maximumAgeHours = Math.max(1, input.maximumAgeHours ?? 36)
  const cutoff = now.getTime() - maximumAgeHours * 60 * 60 * 1_000
  const groups = canonicalizeActiveListingProtectionRows(
    input.listings.filter((listing) => listing.listing_status === "active"),
  )
  const mappingBrokenListingIds = new Set(
    input.openMappingBrokenListingIds ?? [],
  )
  const exactMapped = groups.filter(({ listing, memberListingIds }) => Boolean(
    listing.market_radar_product_id &&
    listing.supplier_variant_id &&
    listing.supplier_sku &&
    !memberListingIds.some((id) => mappingBrokenListingIds.has(id)),
  ))
  const reviewed = groups.filter(({ listing }) =>
    freshAt(listing.last_radar_review_at, cutoff))
  const targetedMonitorFresh = freshAt(
    input.targetedMonitorLastSuccessAt,
    cutoff,
  )
  const fullCatalogFresh = freshAt(input.fullCatalogLastSuccessAt, cutoff)
  const reasons: string[] = []
  if (groups.length && exactMapped.length !== groups.length) {
    reasons.push("ACTIVE_LISTING_LUNA_MAPPING_INCOMPLETE")
  }
  if (groups.length && !targetedMonitorFresh) {
    reasons.push("TARGETED_LUNA_MONITOR_HEARTBEAT_STALE")
  }
  if (groups.length && reviewed.length !== groups.length) {
    reasons.push("ACTIVE_LISTING_PROTECTION_HEARTBEAT_STALE")
  }
  if (groups.length && !input.targetedMonitorEnabled) {
    reasons.push("TARGETED_LUNA_MONITOR_FEATURE_DISABLED")
  }

  let status: ActiveListingProtectionMonitorStatus
  if (!groups.length) status = "NOT_APPLICABLE"
  else if (exactMapped.length !== groups.length || reviewed.length !== groups.length) {
    status = "NOT_MONITORED"
  } else if (!targetedMonitorFresh) status = "DEGRADED"
  else if (!input.targetedMonitorEnabled) status = "MANUAL_RECENT"
  else status = "ACTIVE"

  const reviewTimes = groups
    .map(({ listing }) => listing.last_radar_review_at)
    .filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(value))))
    .sort()
  return {
    status,
    reasons,
    targetedMonitorEnabled: input.targetedMonitorEnabled,
    automaticScheduleActive:
      input.targetedMonitorEnabled && targetedMonitorFresh,
    maximumAgeHours,
    canonicalActiveListings: groups.length,
    exactMappedActiveListings: exactMapped.length,
    freshlyReviewedActiveListings: reviewed.length,
    luna: {
      targetedMonitor: {
        lastSuccessAt: input.targetedMonitorLastSuccessAt,
        fresh: targetedMonitorFresh,
      },
      fullCatalog: {
        lastSuccessAt: input.fullCatalogLastSuccessAt,
        fresh: fullCatalogFresh,
      },
    },
    protection: {
      oldestCanonicalReviewAt: reviewTimes[0] ?? null,
      latestCanonicalReviewAt: reviewTimes.at(-1) ?? null,
      allFresh: groups.length > 0 && reviewed.length === groups.length,
    },
  }
}

function itemIdentityKey(row: ActiveListingProtectionIdentityRow) {
  return JSON.stringify([
    normalizedRequiredIdentity(row.account_key),
    normalizedRequiredIdentity(row.ebay_item_id),
  ])
}

function sourcePreference(source: string) {
  if (source === EBAY_INVENTORY_READONLY_SOURCE) return 2
  if (source === EBAY_TRADING_READONLY_SOURCE) return 1
  return 0
}

function observedAtEpoch(value: string | null) {
  if (!value) return Number.NEGATIVE_INFINITY
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}

function compareCanonicalCandidates(
  left: ActiveListingProtectionIdentityRow,
  right: ActiveListingProtectionIdentityRow,
) {
  return sourcePreference(right.source) - sourcePreference(left.source) ||
    observedAtEpoch(right.last_ebay_sync_at) -
      observedAtEpoch(left.last_ebay_sync_at) ||
    left.id.localeCompare(right.id)
}

/**
 * Collapses connector rows that represent the same seller listing identity.
 *
 * SKU matching remains case-sensitive because seller SKUs can identify
 * variations. A missing SKU is attached to a concrete SKU only when that eBay
 * item has exactly one observed non-null SKU; otherwise it stays isolated so a
 * variation is never guessed. The preferred row is returned unchanged, most
 * importantly including its real listing_status.
 */
export function canonicalizeActiveListingProtectionRows<
  T extends ActiveListingProtectionIdentityRow,
>(rows: T[]): CanonicalActiveListingProtectionGroup<T>[] {
  const concreteSkusByItem = new Map<string, Set<string>>()
  for (const row of rows) {
    const sku = normalizeActiveListingProtectionSku(row.ebay_sku)
    if (!sku) continue
    const key = itemIdentityKey(row)
    const skus = concreteSkusByItem.get(key) ?? new Set<string>()
    skus.add(sku)
    concreteSkusByItem.set(key, skus)
  }

  const groups = new Map<string, {
    accountKey: string
    ebayItemId: string
    ebaySku: string | null
    rows: T[]
  }>()
  for (const row of rows) {
    const accountKey = normalizedRequiredIdentity(row.account_key)
    const ebayItemId = normalizedRequiredIdentity(row.ebay_item_id)
    const concreteSku = normalizeActiveListingProtectionSku(row.ebay_sku)
    const itemSkus = concreteSkusByItem.get(itemIdentityKey(row))
    const ebaySku = concreteSku ?? (itemSkus?.size === 1
      ? [...itemSkus][0]
      : null)
    const canonicalKey = JSON.stringify([accountKey, ebayItemId, ebaySku])
    const group = groups.get(canonicalKey) ?? {
      accountKey,
      ebayItemId,
      ebaySku,
      rows: [],
    }
    group.rows.push(row)
    groups.set(canonicalKey, group)
  }

  return [...groups.entries()].map(([canonicalKey, group]) => {
    const candidates = [...group.rows].sort(compareCanonicalCandidates)
    return {
      canonicalKey,
      accountKey: group.accountKey,
      ebayItemId: group.ebayItemId,
      ebaySku: group.ebaySku,
      listing: candidates[0],
      memberListingIds: candidates.map((row) => row.id),
      observations: candidates.map((row) => ({
        listingId: row.id,
        source: row.source,
        listingStatus: row.listing_status,
        ebaySku: normalizeActiveListingProtectionSku(row.ebay_sku),
        observedAt: row.last_ebay_sync_at,
      })),
    }
  })
}
