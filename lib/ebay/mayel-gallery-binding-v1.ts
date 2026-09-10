/** The current discovery row and its older GetItem certificate are one listing.
 * Conflicting SKUs or competing current rows never resolve by arbitrary LIMIT 1. */
export function galleryListingSkuV1(rows: readonly Record<string, unknown>[], itemId: string, accountKey: string) {
  if (!rows.length || rows.length > 2 || rows.some(r => r.account_key !== accountKey || r.ebay_item_id !== itemId ||
      r.listing_status !== "active" || typeof r.ebay_sku !== "string" || !r.ebay_sku)) return null
  if (new Set(rows.map(r => r.ebay_sku)).size !== 1) return null
  if (rows.length === 2) {
    const source = (r: Record<string, unknown>) => (r.raw_payload as Record<string, unknown> | null)?.source
    if (rows.filter(r => source(r) === "EBAY_TRADING_GET_MY_EBAY_SELLING").length !== 1 ||
        rows.filter(r => source(r) === "EBAY_TRADING_GET_ITEM_READONLY").length !== 1) return null
  }
  return rows[0].ebay_sku as string
}
