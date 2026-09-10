import { visualIntentOrderV1 } from "./mayel-visual-intent-v1"
import "server-only"
import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { IPAD_OUTBOX_VERSION } from "./ipad-outbox-contract-v1"
import { saveDurableOutboxV1, publicOutboxReceiptV1, type OutboxRow } from "./ipad-durable-outbox-v1"
import { visualAssetOwnerApprovedV1 } from "./visual-asset-sync-state-v1"
import { gallerySlotPreviewV1, replacementSlotOrderV1 } from "../ebay/mayel-gallery-slot-policy-v1"

export async function confirmMayelGalleryPreviewV1(input: { supabase: SupabaseClient; accountKey: string;
  actorUserId: string; taskId: string; expectedDigest: string; confirmation: string }) {
  if (input.confirmation !== "CONFIRM_FULL_GALLERY_PREVIEW_V1") throw Error("OWNER_GALLERY_PREVIEW_REQUIRED")
  const ownerAuthority = await input.supabase.from("ebay_mayel_visual_delegation_authorities_v1")
    .select("id").eq("marketplace_account_key", input.accountKey).eq("owner_user_id", input.actorUserId)
    .eq("status", "ACTIVE").is("revoked_at", null).limit(1).maybeSingle()
  if (ownerAuthority.error || !ownerAuthority.data) throw Error("OWNER_GALLERY_PREVIEW_REQUIRED")
  const taskRead = await input.supabase.from("ebay_mayel_visual_tasks_v1")
    .select("id,ebay_item_id,assigned_operator_user_id,visual_manifest_id,visual_manifest,visual_manifest_digest,source_image_set_digest,product_truth_digest,current_image_set,created_at,evidence_pack")
    .eq("id", input.taskId).eq("marketplace_account_key", input.accountKey).maybeSingle()
  const task = taskRead.data, manifest = task?.visual_manifest
  if (taskRead.error || !task || task.visual_manifest_digest !== input.expectedDigest ||
      (manifest?.intentContract !== "MAYEL_VISUAL_INTENT_V1" && (manifest?.galleryPolicy !== "REPLACE_APPROVED_SLOTS_ONLY" || !Array.isArray(manifest.slotReplacements))))
    throw Error("MAYEL_GALLERY_PREVIEW_STALE")
  const explicit = manifest.intentContract === "MAYEL_VISUAL_INTENT_V1"
  const order = explicit ? visualIntentOrderV1(task.current_image_set, manifest.visualIntents) : replacementSlotOrderV1(task.current_image_set, manifest.slotReplacements)
  const preview = gallerySlotPreviewV1(task.current_image_set, manifest.proposedOrderedImages.map((e: { publicUrl: string }) => e.publicUrl))
  if ((!explicit && !preview) || order.length !== manifest.proposedOrderedImages.length || order.some((entry, position) => entry.kind === "MAYEL_ASSET"
    ? manifest.proposedOrderedImages[position]?.assetId !== entry.assetId
    : manifest.proposedOrderedImages[position]?.publicUrl !== entry.publicUrl)) throw Error("MAYEL_GALLERY_PREVIEW_INVALID")
  const assetIds = (explicit ? manifest.visualIntents : manifest.slotReplacements).map((r: { assetId: string }) => r.assetId)
  const assets = await input.supabase.from("ebay_listing_image_assets")
    .select("id,status,qa_result,source_sha256,output_sha256,mayel_approval_status,owner_sync_approval,source_image_set_digest,product_truth_digest")
    .eq("account_key", input.accountKey).eq("mayel_visual_task_id", input.taskId).in("id", assetIds)
  if (assets.error || assets.data?.length !== assetIds.length || assets.data.some(a => !visualAssetOwnerApprovedV1(a, task) || a.owner_sync_approval?.ownerUserId !== input.actorUserId))
    throw Error("OWNER_VISUAL_REVIEW_REQUIRED")
  const key = `ipados:v1:${createHash("sha256").update(`${input.accountKey}:${input.actorUserId}:${task.id}:${input.expectedDigest}:FULL_GALLERY_PREVIEW_V1`).digest("hex")}`
  const existing = await input.supabase.from("seller_os_ipad_outbox_v1")
    .select("id,idempotency_key,state,received_at,reason_code,official_readback")
    .eq("account_key", input.accountKey).eq("actor_user_id", input.actorUserId).eq("idempotency_key", key).maybeSingle()
  if (existing.error) throw Error("OUTBOX_RECEIPT_READ_FAILED")
  if (existing.data) return publicOutboxReceiptV1(existing.data as OutboxRow)
  // This owner-authenticated intent is the durable full-gallery confirmation.
  // Asset approvals remain independently checked by every runtime dispatch.
  return saveDurableOutboxV1({ ...input, owner: true, galleryPreviewDigest: input.expectedDigest, intent: { version: IPAD_OUTBOX_VERSION,
    kind: "IMAGE_SYNC", itemId: task.ebay_item_id, listingTitle: String(task.evidence_pack?.productTitle ?? ""),
    generationId: task.visual_manifest_id, createdAt: task.created_at, baseVersionHash: task.source_image_set_digest,
    baseObservedAt: null, idempotencyKey: key, requestedChanges: { taskId: task.id, assetId: assetIds[0], manifestDigest: input.expectedDigest } } })
}
