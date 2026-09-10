import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getEbayTradingReadOnlyAccessToken } from "./ebay-manual-listing-trading-readonly"
import { readOfficialActiveListingImageSnapshotV1 } from "./ebay-active-listing-image-revision-service"
import { ebayOfficialImageSetDigestV1 } from "./ebay-mayel-visual-phase-b-v1"

type RecordValue = Record<string, unknown>
const record = (v: unknown): RecordValue => v && typeof v === "object" && !Array.isArray(v) ? v as RecordValue : {}
export function savedOfficialGalleryV1(signal: unknown) {
  const gallery = record(record(signal).currentOfficialGallery)
  const images = Array.isArray(gallery.images) ? gallery.images.filter((v): v is string => typeof v === "string" && /^https:\/\//.test(v)) : []
  return gallery.authority === "CURRENT_OFFICIAL_ORDERED_IMAGE_SET" && images.length &&
    gallery.digest === ebayOfficialImageSetDigestV1(images) ? { images, digest: String(gallery.digest), observedAt: String(gallery.observedAt) } : null
}

/** One exact listing, existing quota gate, no polling and no marketplace writes. */
export async function readCurrentMayelGalleryV1(input: { supabase: SupabaseClient; accountKey: string;
  itemId: string; sku?: string | null; offlineOnly?: boolean; fetchImpl?: typeof fetch }) {
  if (input.offlineOnly) return null
  const { collectSellerOsEbayTradingRateLimitStatusV1 } = await import("./ebay-trading-rate-limit-observability-v1")
  if ((await collectSellerOsEbayTradingRateLimitStatusV1()).gateState !== "OPEN") return null
  const active = await input.supabase.from("ebay_active_listings").select("ebay_sku")
    .eq("account_key", input.accountKey).eq("ebay_item_id", input.itemId).eq("listing_status", "active").maybeSingle()
  const sku = active.data?.ebay_sku
  if (active.error || !sku || input.sku && input.sku !== sku) return null
  const fetchImpl = input.fetchImpl ?? fetch
  const accessToken = await getEbayTradingReadOnlyAccessToken(fetchImpl)
  const official = await readOfficialActiveListingImageSnapshotV1({ accessToken, itemId: input.itemId,
    expectedSku: sku, accountKey: input.accountKey, fetchImpl })
  return { authority: "CURRENT_OFFICIAL_ORDERED_IMAGE_SET", images: official.pictureUrls,
    digest: ebayOfficialImageSetDigestV1(official.pictureUrls), observedAt: official.observedAt }
}

export async function refreshMayelStationGalleryV1(input: { supabase: SupabaseClient; accountKey: string;
  taskId: string; actorUserId: string; owner: boolean }) {
  let query = input.supabase.from("ebay_mayel_visual_tasks_v1")
    .select("id,ebay_item_id,assigned_operator_user_id,selection_signal,visual_manifest,visual_manifest_digest")
    .eq("id", input.taskId).eq("marketplace_account_key", input.accountKey)
  if (!input.owner) query = query.eq("assigned_operator_user_id", input.actorUserId)
  const task = await query.maybeSingle()
  if (task.error || !task.data) throw Error("MAYEL_VISUAL_TASK_FORBIDDEN")
  const cached = savedOfficialGalleryV1(task.data.selection_signal)
  if (cached && Date.now() - Date.parse(cached.observedAt) >= 0 && Date.now() - Date.parse(cached.observedAt) < 60_000)
    return { gallery: cached, reused: true, marketplaceWrites: 0 }
  let gallery
  try { gallery = await readCurrentMayelGalleryV1({ ...input, itemId: task.data.ebay_item_id }) }
  catch { return { gallery: cached, status: "WAITING_FOR_DATA", marketplaceWrites: 0 } }
  if (!gallery) return { gallery: cached, status: "WAITING_FOR_DATA", marketplaceWrites: 0 }
  // Store observation separately: never overwrite a manifest's approval base.
  const changed = await input.supabase.from("ebay_mayel_visual_tasks_v1")
    .update({ selection_signal: { ...record(task.data.selection_signal), currentOfficialGallery: gallery } })
    .eq("id", input.taskId).eq("marketplace_account_key", input.accountKey).select("id").maybeSingle()
  if (changed.error || !changed.data) throw Error("MAYEL_GALLERY_OBSERVATION_SAVE_FAILED")
  const manifest = record(task.data.visual_manifest)
  const base = [manifest.currentMainImage, ...(Array.isArray(manifest.currentSecondaryImages) ? manifest.currentSecondaryImages : [])]
  const drift = Boolean(task.data.visual_manifest_digest && JSON.stringify(base) !== JSON.stringify(gallery.images))
  if (drift && manifest.galleryPolicy === "REPLACE_APPROVED_SLOTS_ONLY" && Array.isArray(manifest.slotReplacements) &&
      manifest.slotReplacements.every((r: { targetImagePosition: number }) => base[r.targetImagePosition] === gallery.images[r.targetImagePosition])) {
    const { rebaseMayelVisualPhaseBPreviewV1 } = await import("./ebay-mayel-visual-phase-b-server-v1")
    try {
      await rebaseMayelVisualPhaseBPreviewV1({ ...input, expectedVisualManifestDigest: task.data.visual_manifest_digest })
      return { gallery, status: "OWNER_GALLERY_PREVIEW_REQUIRED", marketplaceWrites: 0 }
    } catch { /* Keep the current gallery visible, with all writes blocked. */ }
  }
  return { gallery, status: drift ? "AUTO_REBASE_REQUIRED" : "CURRENT", marketplaceWrites: 0 }
}
