import type { SupabaseClient } from "@supabase/supabase-js"
import { readCurrentLiveAuthorityV1 } from "../ebay/ebay-current-live-authority-v1"
import { MAX_TREATMENT_LISTINGS } from "./listing-treatment-engine-v1"

// Browsing the last certified identities must not consume Trading quota or
// promote historical observations to current authority. Actions keep their
// existing independent current-LIVE checks.
export async function readMayelListingSelectionV1(input: {
  supabase: SupabaseClient; accountKey: string; after?: string; now?: Date
}) {
  if (input.after && !/^\d{9,20}$/.test(input.after)) throw Error("LISTING_CURSOR_INVALID")
  const authority = await readCurrentLiveAuthorityV1(input)
  const actionsAvailable = authority.currentState === "CURRENT_FRESH"
  const ids = (actionsAvailable ? authority.currentItemIds : authority.lastCertifiedItemIds)
    .filter(id => id > (input.after ?? "")).slice().sort()
  const page = ids.slice(0, MAX_TREATMENT_LISTINGS)
  const read = page.length ? await input.supabase.from("ebay_active_listings")
    .select("ebay_item_id,title,ebay_sku,last_ebay_sync_at")
    .eq("account_key", input.accountKey).in("ebay_item_id", page)
    .order("updated_at", { ascending: false }).limit(201) : { data: [], error: null }
  if (read.error || (read.data?.length ?? 0) > 200) throw Error("LISTING_SELECTION_READ_FAILED")
  return {
    listings: page.map(itemId => {
      const matches = (read.data ?? []).filter(row => row.ebay_item_id === itemId)
      // Repeated representations may agree; conflicting values stay unknown.
      const titles = [...new Set(matches.map(row => row.title?.trim()).filter(Boolean))]
      const skus = [...new Set(matches.map(row => row.ebay_sku))]
      return { itemId, title: titles.length === 1 ? titles[0] : itemId,
        sku: skus.length === 1 ? skus[0] ?? null : null,
        observedAt: authority.lastCertifiedAt }
    }),
    nextCursor: ids.length > page.length ? page.at(-1) ?? null : null,
    actionsAvailable, selectionState: actionsAvailable ? "CURRENT" : page.length ? "LAST_CERTIFIED" : "UNAVAILABLE",
    authoritativeZero: authority.authoritativeZero,
    observedAt: authority.lastCertifiedAt, sourceFailureCode: authority.sourceFailureCode,
    scope: "CURRENT_PAGE_MAXIMUM_20", marketplaceWrites: 0,
  }
}
