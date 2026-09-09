import type { SupabaseClient } from "@supabase/supabase-js"

// A saved visual draft may predate its active-registry linkage. Bind only one
// exact account/item active row; never select an arbitrary duplicate or create
// a fictitious publication package. Official preflight follows this linkage.
export async function resolveMayelVisualRegistryBindingV1(input: {
  supabase: SupabaseClient; accountKey: string; taskId: string; itemId: string; currentRegistryId: string | null
}) {
  if (input.currentRegistryId) return input.currentRegistryId
  const read = await input.supabase.from("ebay_active_listings").select("id,ebay_sku")
    .eq("account_key", input.accountKey).eq("ebay_item_id", input.itemId).eq("listing_status", "active").limit(2)
  if (read.error || read.data?.length !== 1 || typeof read.data[0].ebay_sku !== "string" || !read.data[0].ebay_sku.trim())
    throw Error("MAYEL_VISUAL_EXACT_ACTIVE_REGISTRY_REQUIRED")
  const id = String(read.data[0].id)
  const updated = await input.supabase.from("ebay_mayel_visual_tasks_v1").update({ active_listing_id: id })
    .eq("id", input.taskId).eq("marketplace_account_key", input.accountKey).eq("ebay_item_id", input.itemId)
    .is("active_listing_id", null).select("active_listing_id").maybeSingle()
  if (updated.error) throw Error("MAYEL_VISUAL_ACTIVE_REGISTRY_BIND_FAILED")
  if (updated.data?.active_listing_id === id) return id
  const current = await input.supabase.from("ebay_mayel_visual_tasks_v1").select("active_listing_id")
    .eq("id", input.taskId).eq("marketplace_account_key", input.accountKey).eq("ebay_item_id", input.itemId).maybeSingle()
  if (current.error || current.data?.active_listing_id !== id) throw Error("MAYEL_VISUAL_ACTIVE_REGISTRY_BIND_CONFLICT")
  return id
}
