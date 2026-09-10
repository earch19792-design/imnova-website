import type { SupabaseClient } from "@supabase/supabase-js"
import type { MayelShippingSnapshotV1 } from "./mayel-shipping-visibility-v1"
// Read existing durable authorities only. No producer, RPC claim, or eBay client.
export async function readMayelShippingVisibilityV1(input: { supabase: SupabaseClient; accountKey: string; itemIds: unknown; now?: Date }): Promise<MayelShippingSnapshotV1> {
  if (!Array.isArray(input.itemIds) || input.itemIds.length > 20 || input.itemIds.some(id => typeof id !== "string" || !/^\d{9,20}$/.test(id))) throw Error("SHIPPING_VISIBILITY_SCOPE_INVALID")
  const itemIds = [...new Set(input.itemIds as string[])]
  const db = input.supabase, account = input.accountKey
  const bounded = <T extends { abortSignal: (signal: AbortSignal) => T; retry: (enabled: boolean) => T }>(query: T) =>
    query.abortSignal(AbortSignal.timeout(8000)).retry(false)
  const results = await Promise.allSettled([
    bounded(db.from("seller_os_browser_worker_capabilities_v1").select("worker_instance_id,extension_version,extension_identity_match,physical_connection,observed_at,fresh_until").eq("marketplace_account_key", account).eq("worker_family", "LUNA_SHIPPING").limit(1)).maybeSingle(),
    bounded(db.from("seller_os_browser_workload_leases_v1").select("worker_instance_id,lease_expires_at,shipping_capture_state,shipping_capability_worker_id,shipping_capability_observed_at,shipping_capability_transition,shipping_next_attempt_at").eq("marketplace_account_key", account).eq("worker_family", "LUNA_SHIPPING").limit(1)).maybeSingle(),
    bounded(db.from("ebay_active_listing_sync_state").select("current_live_source_state,current_live_last_error_code,last_certified_live_fresh_until").eq("account_key", account).limit(1)).maybeSingle(),
    itemIds.length ? bounded(db.from("seller_os_economic_evidence_refresh_jobs_v1").select("ebay_item_id,status,lease_expires_at,last_evidence_id,failure_class,next_retry_at").eq("marketplace_account_key", account).eq("evidence_type", "LUNA_CURRENT_SHIPPING").in("ebay_item_id", itemIds).limit(20)) : Promise.resolve({data:[],error:null}),
    itemIds.length ? bounded(db.rpc("seller_os_latest_economic_evidence_v1", {p_account_key:account,p_item_ids:itemIds})) : Promise.resolve({data:[],error:null}),
    itemIds.length ? bounded(db.from("seller_os_live_economics_readbacks_v1").select("ebay_item_id,input_evidence_ids,calculated_at").eq("marketplace_account_key", account).in("ebay_item_id", itemIds).order("calculated_at",{ascending:false}).limit(100)) : Promise.resolve({data:[],error:null}),
  ])
  const value = (index: number) => { const r = results[index]; return r.status === "fulfilled" && !r.value.error ? r.value.data : null }
  const evidence = (value(4) ?? []).filter((e: any) => e.evidence_type === "LUNA_CURRENT_SHIPPING").map((e: any) => ({
    ebay_item_id:e.ebay_item_id,marketplace_account_key:e.marketplace_account_key,evidence_type:e.evidence_type,
    evidence_id:e.evidence_id,freshness_status:e.freshness_status,value_amount:e.value_amount,captured_at:e.captured_at,fresh_until:e.fresh_until,
  }))
  return {observedAt:(input.now ?? new Date()).toISOString(),accountKey:account,itemIds,
    worker:value(0),lease:value(1),ebay:value(2),jobs:value(3) ?? [],evidence,economics:value(5) ?? []}
}
