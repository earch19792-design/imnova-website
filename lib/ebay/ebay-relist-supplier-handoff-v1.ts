import type { SupabaseClient } from "@supabase/supabase-js"

// Rotation applies only when the existing intake cycle runs; no timer is added.
export function orderRelistHandoffCandidatesV1<T extends { itemId: string }>(
  candidates: readonly T[], nowMs: number,
): T[] {
  const ordered = [...candidates].sort((a, b) => a.itemId.localeCompare(b.itemId))
  const offset = ordered.length ? Math.floor(nowMs / 300_000) % ordered.length : 0
  return [...ordered.slice(offset), ...ordered.slice(0, offset)]
}

// This runs inside the existing intake cycle, never from a heartbeat/poller.
// The database resolves and locks durable authorities; callers supply no
// product, variant, predecessor, title or approval to manufacture a match.
export async function reconcileRelistSupplierHandoffV1(input: {
  supabase: SupabaseClient; accountKey: string; itemId: string
}) {
  const result = await input.supabase.rpc("resolve_relist_supplier_handoff_v1", {
    p_account_key: input.accountKey, p_item_id: input.itemId, p_apply: true,
  }).abortSignal(AbortSignal.timeout(8_000)).retry(false)
  if (result.error) return { status: "WAITING_FOR_DATA", reason:
    "RELIST_HANDOFF_DURABLE_OPERATION_UNCONFIRMED", ownerActionRequired: false }
  const value = result.data as Record<string, unknown> | null
  if (value?.status !== "CERTIFIED") return value ?? {
    status: "WAITING_FOR_DATA", reason: "RELIST_HANDOFF_RESULT_MISSING",
    ownerActionRequired: false,
  }
  // A response/ACK alone cannot finish the handoff, including after a restart.
  const read = await input.supabase.from("seller_os_luna_linkage_decisions")
    .select("linkage_id,decision,ebay_sku,luna_product_id,luna_variant_id,luna_sku")
    .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
    .eq("ebay_item_id", input.itemId).order("decision_version", { ascending: false })
    .limit(1).abortSignal(AbortSignal.timeout(8_000)).retry(false).maybeSingle()
  const exact = !read.error && read.data?.decision === "APPROVE_EXACT_LINKAGE" &&
    read.data.linkage_id === value.linkageId && read.data.luna_product_id === value.productId &&
    read.data.luna_variant_id === value.variantId && read.data.luna_sku === (value.supplierSku ?? value.sourceSku)
  return exact ? { ...value, durableReadbackMatch: true } : {
    status: "WAITING_FOR_DATA", reason: "RELIST_LINKAGE_READBACK_REQUIRED", ownerActionRequired: false,
  }
}
