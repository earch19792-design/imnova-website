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

function normalizedRequiredIdentity(value: string) {
  return value.normalize("NFKC").trim()
}

export function normalizeActiveListingProtectionSku(value: string | null) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC").trim()
  return normalized || null
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
