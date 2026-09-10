import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { readCurrentMayelGalleryV1 } from "./mayel-current-gallery-server-v1"
import { cachedTradingNextSafeProbeAtV1 } from "./ebay-trading-rate-limit-observability-v1"
import { nextOutboxAttemptAtV1 } from "../seller-os/ipad-outbox-contract-v1"

/** Shared by station opening and the existing runtime. One account lease,
 * one full-gallery read, durable retry; never creates a marketplace mutation. */
export async function recoverMissingMayelGalleryV1(input: { supabase: SupabaseClient; accountKey: string; taskId: string },
  readGallery?: typeof readCurrentMayelGalleryV1) {
  const claim = await input.supabase.rpc("seller_os_claim_mayel_gallery_v1", { p_account: input.accountKey, p_task: input.taskId })
  if (claim.error) throw Error("GALLERY_RECOVERY_CLAIM_FAILED")
  if (!claim.data) return { status: "WAITING_FOR_DATA", gallery: null, marketplaceWrites: 0 }
  let gallery: Awaited<ReturnType<typeof readCurrentMayelGalleryV1>> = null
  let reason: string | null = null
  try {
    const read = readGallery ?? (await import("./mayel-current-gallery-server-v1")).readCurrentMayelGalleryV1
    gallery = await read({ ...input, itemId: claim.data.itemId })
    if (!gallery) reason = "WAITING_FOR_EBAY_OR_EXACT_LISTING_BINDING"
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    reason = /^[A-Z][A-Z0-9_:.-]{2,150}$/.test(message) ? message : "TEMPORARY_UPSTREAM_FAILURE"
  }
  const finished = await input.supabase.rpc("seller_os_finish_mayel_gallery_v1", { p_account: input.accountKey,
    p_task: input.taskId, p_token: claim.data.leaseToken, p_gallery: gallery,
    p_next: gallery ? null : nextOutboxAttemptAtV1(cachedTradingNextSafeProbeAtV1()), p_reason: reason })
  if (finished.error) throw Error("GALLERY_RECOVERY_SAVE_FAILED")
  return { status: gallery ? "GALLERY_RECOVERED" : "WAITING_FOR_DATA", gallery, marketplaceWrites: 0 }
}
