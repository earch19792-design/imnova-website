import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { parseOutboxIntentV1, stableOutboxJsonV1, outboxFriendlyStateV1, type OutboxIntent, type DurableOutboxReceipt } from "./ipad-outbox-contract-v1"
import { ebayOfficialImageSetDigestV1 } from "../ebay/ebay-mayel-visual-phase-b-v1"
import { visualAssetOwnerApprovedV1 } from "./visual-asset-sync-state-v1"
export const IPAD_OUTBOX_TABLE = "seller_os_ipad_outbox_v1"
export type OutboxRow = { id: string; account_key: string; actor_user_id: string; item_id: string; kind: string;
  intent: OutboxIntent; binding: Record<string, unknown>; idempotency_key: string; payload_hash: string;
  state: string; reason_code: string | null; received_at: string; lease_token: string; dispatch_count: number; official_readback: boolean }
export type OutboxScope = { supabase: SupabaseClient; accountKey: string; actorUserId: string; owner?: boolean }
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}
export function publicOutboxReceiptV1(row: OutboxRow): DurableOutboxReceipt {
 return { id: row.id, idempotencyKey: row.idempotency_key, state: outboxFriendlyStateV1(row.state), internalState: row.state,
   receivedAt: row.received_at, reasonCode: row.reason_code, officialReadback: row.official_readback }
}
export async function saveDurableOutboxV1(input: OutboxScope & { intent: unknown; galleryPreviewDigest?: string; delegationId?: string }) {
 const intent = parseOutboxIntentV1(input.intent)
 const hash = `sha256:${createHash("sha256").update(stableOutboxJsonV1(intent)).digest("hex")}`
 const previous = await input.supabase.from(IPAD_OUTBOX_TABLE).select("*").eq("account_key", input.accountKey)
   .eq("actor_user_id", input.actorUserId).eq("idempotency_key", intent.idempotencyKey).maybeSingle()
 if (previous.error) throw Error("OUTBOX_RECEIPT_READ_FAILED")
 if (previous.data) {
   if (previous.data.payload_hash !== hash) throw Error("OUTBOX_IDEMPOTENCY_PAYLOAD_CONFLICT")
   return publicOutboxReceiptV1(previous.data as OutboxRow)
 }
 // Read only Seller OS evidence. Handoff deliberately has no upstream dependency.
 let binding: Record<string, unknown> = { publicationAuthorizedByDraft: false, ownerAtHandoff: input.owner === true,
   ...(input.owner === true && typeof input.galleryPreviewDigest === "string" && input.galleryPreviewDigest === intent.requestedChanges.manifestDigest
     ? { ownerGalleryPreview: { confirmation: "CONFIRM_FULL_GALLERY_PREVIEW_V1", ownerUserId: input.actorUserId,
       manifestDigest: input.galleryPreviewDigest } } : {}) }
 if (input.delegationId && intent.kind !== "IMAGE_SYNC") throw Error("CHANGE_OUTSIDE_OWNER_DELEGATION")
 if (intent.kind.startsWith("IMAGE_")) {
   const task = await input.supabase.from("ebay_mayel_visual_tasks_v1")
     .select("id,ebay_item_id,assigned_operator_user_id,current_image_set,source_image_set_digest,status,visual_manifest_digest,visual_manifest,marketplace_account_key,product_truth_digest,selection_signal,source_image_references,evidence_pack")
     .eq("marketplace_account_key", input.accountKey).eq("id", intent.requestedChanges.taskId!).eq("ebay_item_id", intent.itemId).maybeSingle()
   if (task.error || !task.data || (!input.owner && task.data.assigned_operator_user_id !== input.actorUserId)) throw Error("OUTBOX_TASK_SCOPE_REQUIRED")
   const ownerGalleryHandoff = input.owner === true && intent.kind === "IMAGE_SYNC" &&
     input.galleryPreviewDigest === task.data.visual_manifest_digest && Boolean(record(binding.ownerGalleryPreview).confirmation)
   if (task.data.assigned_operator_user_id !== input.actorUserId && !ownerGalleryHandoff) {
     if (task.data.status !== "PROMPT_READY" || task.data.visual_manifest_digest) throw Error("OUTBOX_TASK_ASSIGNEE_CONFLICT")
     const assets = await input.supabase.from("ebay_listing_image_assets").select("id")
       .eq("account_key", input.accountKey).eq("mayel_visual_task_id", task.data.id).limit(1)
     if (assets.error || assets.data?.length) throw Error("OUTBOX_TASK_ASSIGNEE_CONFLICT")
   }
   if (intent.baseVersionHash !== task.data.source_image_set_digest) throw Error("OUTBOX_SAVED_BASE_CHANGED")
   binding = { ...binding, taskId: task.data.id,
     baseImageHash: ebayOfficialImageSetDigestV1(task.data.current_image_set), sourceImageSetDigest: task.data.source_image_set_digest }
   if (intent.kind === "IMAGE_UPLOAD") {
     if (task.data.assigned_operator_user_id !== input.actorUserId) throw Error("OUTBOX_TASK_SCOPE_REQUIRED")
     const assets = await input.supabase.from("ebay_listing_image_assets")
       .select("id,source_sha256,source_image_set_digest,qa_result").eq("account_key", input.accountKey)
       .eq("mayel_visual_task_id", task.data.id).eq("uploaded_by", input.actorUserId)
       .eq("source_type", "CHATGPT_SUBSCRIPTION_MAYEL").in("status", ["pending_review", "approved"])
     if (assets.error) throw Error("OUTBOX_UPLOAD_ASSETS_READ_FAILED")
     const sourceImageSetDigest = task.data.source_image_set_digest
     binding.assets = intent.requestedChanges.files!.map(file => {
       const asset = assets.data?.find(a => a.source_sha256 === file.sha256 && a.source_image_set_digest === sourceImageSetDigest)
       if (!asset || record(asset.qa_result).automaticStatus !== "PASSED") throw Error("OUTBOX_UPLOAD_ASSETS_INCOMPLETE")
       return { assetId: asset.id, sourceSha256: file.sha256 }
     })
   } else if (intent.kind === "IMAGE_SYNC") {
     const proposed = record(task.data.visual_manifest).proposedOrderedImages
     const ids = Array.isArray(proposed) ? proposed.map(record).flatMap(e => typeof e.assetId === "string" ? [e.assetId] : []) : []
     if (!ids.includes(intent.requestedChanges.assetId!) || !ids.length) throw Error("OUTBOX_DRAFT_AUTHORITY_CHANGED")
     const native = await input.supabase.from("ebay_listing_image_assets")
       .select("id,status,mayel_output_role,mayel_approval_status,qa_result,source_sha256,output_sha256,public_url,product_truth_digest,source_image_set_digest,owner_sync_approval").eq("account_key", input.accountKey)
       .eq("mayel_visual_task_id", task.data.id).in("id", ids)
     const sourceDigest = task.data.source_image_set_digest
     if (native.error || native.data?.length !== ids.length ||
         native.data.some(a => a.source_image_set_digest !== sourceDigest ||
           (ownerGalleryHandoff && record(a.owner_sync_approval).ownerUserId !== input.actorUserId)))
       throw Error("OUTBOX_DRAFT_AUTHORITY_CHANGED")
     if (input.delegationId) {
       const { readDelegatedVisualAuthorityV1 } = await import("./mayel-optimization-delegation-server-v1")
       const delegated = await readDelegatedVisualAuthorityV1({ ...input, task: task.data, assets: native.data })
       if (!delegated.authorized || delegated.grant?.id !== input.delegationId) throw Error(delegated.reason ?? "OWNER_DELEGATION_REQUIRED")
       binding.ownerDelegation = { authority: delegated.authority, grantId: delegated.grant.id,
         authorityDigest: delegated.grant.authority_digest, manifestDigest: task.data.visual_manifest_digest }
       binding.optimizationAudit = { before: task.data.current_image_set, after: delegated.proposed,
         why: "Mejora visual aprobada por Mayel dentro de la delegación OWNER",
         evidenceUsed: { currentProductTruth: delegated.productTruthProof, productTruthDigest: task.data.product_truth_digest, sourceImageSetDigest: task.data.source_image_set_digest,
           sourceReferences: task.data.source_image_references }, mayelDecision: task.data.visual_manifest,
         qaResult: native.data.map(a => ({ assetId: a.id, qa: a.qa_result })) }
     }
     binding = { ...binding, assets: native.data.map(a => ({ assetId: a.id, sourceSha256: a.source_sha256 })) }
   } else {
     const { readMayelGeneratedImageV1 } = await import("./mayel-generated-image-binding-v1")
     const origin = await readMayelGeneratedImageV1({ ...input, itemId: intent.itemId,
       experimentId: intent.requestedChanges.experimentId!, assetId: intent.requestedChanges.assetId! })
     binding = { ...binding, assetId: origin.assetId, sourceSha256: origin.outputSha256 }
   }
 } else {
   const identity = await input.supabase.from("ebay_active_listings").select("ebay_item_id")
     .eq("account_key", input.accountKey).eq("ebay_item_id", intent.itemId).limit(1)
   if (identity.error || !identity.data?.length) throw Error("OUTBOX_LISTING_IDENTITY_REQUIRED")
 }
 const base = await input.supabase.from("ebay_active_listings")
   .select("title,ebay_sku,ebay_price,ebay_quantity,currency,last_ebay_sync_at,source")
   .eq("account_key", input.accountKey).eq("ebay_item_id", intent.itemId)
   .order("last_ebay_sync_at", { ascending: false }).limit(1).maybeSingle()
 if (base.error) throw Error("OUTBOX_BASE_READ_FAILED")
 const b = base.data
 binding.baseListing = b && String(b.source).startsWith("EBAY_TRADING_") && b.last_ebay_sync_at &&
   b.title && b.ebay_sku && b.currency && b.ebay_price !== null && b.ebay_quantity !== null
   ? { title: b.title, sku: b.ebay_sku, price: Number(b.ebay_price), currency: b.currency, quantity: Number(b.ebay_quantity) } : null
 binding.baseObservedAt = b?.last_ebay_sync_at ?? null
 binding.baseListingHash = binding.baseListing ? `sha256:${createHash("sha256").update(stableOutboxJsonV1(binding.baseListing)).digest("hex")}` : null
 const saved = await input.supabase.rpc("seller_os_put_ipad_outbox_v1", { p_account_key: input.accountKey,
   p_actor_user_id: input.actorUserId, p_intent: intent, p_hash: hash, p_binding: binding })
 if (saved.error || !saved.data) throw Error(saved.error?.message?.includes("PAYLOAD_CONFLICT") ? "OUTBOX_IDEMPOTENCY_PAYLOAD_CONFLICT" : "OUTBOX_DURABLE_HANDOFF_FAILED")
 return publicOutboxReceiptV1(saved.data as OutboxRow)
}
export async function readDurableOutboxV1(input: OutboxScope & { keys: string[] }) {
 if (input.keys.length > 100 || input.keys.some(k => !/^ipados:v1:[a-f0-9]{64}$/.test(k))) throw Error("OUTBOX_RECEIPT_KEYS_INVALID")
 if (!input.keys.length) return []
 const read = await input.supabase.from(IPAD_OUTBOX_TABLE).select("id,idempotency_key,state,received_at,reason_code,official_readback")
   .eq("account_key", input.accountKey).eq("actor_user_id", input.actorUserId).in("idempotency_key", input.keys)
 if (read.error) throw Error("OUTBOX_RECEIPT_READ_FAILED")
 return (read.data as OutboxRow[]).map(publicOutboxReceiptV1)
}
// The approval is durable existing Mayel authority, never a boolean in a draft.
export async function readOutboxImageAuthorityV1(input: { supabase: SupabaseClient; row: OutboxRow }) {
 const { row } = input
 const [task, assets] = await Promise.all([
   input.supabase.from("ebay_mayel_visual_tasks_v1").select("id,ebay_item_id,status,assigned_operator_user_id,visual_manifest,visual_manifest_digest,source_image_set_digest,product_truth_digest,marketplace_account_key,current_image_set,selection_signal,source_image_references,evidence_pack")
     .eq("marketplace_account_key", row.account_key).eq("id", row.intent.requestedChanges.taskId!).maybeSingle(),
   input.supabase.from("ebay_listing_image_assets").select("id,status,mayel_output_role,approved_by,qa_result,public_url,source_sha256,output_sha256,mayel_approval_status,owner_sync_approval,source_image_set_digest,product_truth_digest")
     .eq("account_key", row.account_key).eq("mayel_visual_task_id", row.intent.requestedChanges.taskId!).in("status", ["pending_review", "approved"]),
 ])
 if (task.error || assets.error) throw Error("OUTBOX_AUTHORITY_READ_FAILED")
 const t = task.data, manifest = record(t?.visual_manifest)
 const bound = Array.isArray(row.binding.assets) ? row.binding.assets.map(record) : [{ assetId: row.binding.assetId, sourceSha256: row.binding.sourceSha256 }]
 if (!t || t.ebay_item_id !== row.item_id || t.source_image_set_digest !== row.binding.sourceImageSetDigest ||
     !bound.length || bound.some(b => !assets.data?.some(a => a.id === b.assetId && a.source_sha256 === b.sourceSha256)))
   return { approved: false, reason: "OUTBOX_DRAFT_AUTHORITY_CHANGED", manifestDigest: null }
 if (row.binding.ownerDelegation) {
   const { readDelegatedVisualAuthorityV1 } = await import("./mayel-optimization-delegation-server-v1")
   const authority = await readDelegatedVisualAuthorityV1({ supabase: input.supabase, accountKey: row.account_key,
     task: t, assets: assets.data ?? [] })
   const proof = record(row.binding.ownerDelegation)
   const approved = authority.authorized && authority.grant?.id === proof.grantId &&
     authority.grant?.authority_digest === proof.authorityDigest && row.kind === "IMAGE_SYNC" &&
     proof.manifestDigest === t.visual_manifest_digest && row.intent.requestedChanges.manifestDigest === t.visual_manifest_digest
   return { approved, reason: approved ? null : authority.reason ?? "OUTBOX_APPROVED_MANIFEST_CHANGED",
     manifestDigest: approved ? String(t.visual_manifest_digest) : null,
     expectedImages: approved ? authority.proposed.map(e => String(e.publicUrl)) : [] }
 }
 const galleryPreview = record(row.binding.ownerGalleryPreview)
 if ((manifest.galleryPolicy === "REPLACE_APPROVED_SLOTS_ONLY" || manifest.ownerPreviewRequired === true) && (row.kind !== "IMAGE_SYNC" ||
     galleryPreview.confirmation !== "CONFIRM_FULL_GALLERY_PREVIEW_V1" || galleryPreview.ownerUserId !== row.actor_user_id ||
     galleryPreview.manifestDigest !== t.visual_manifest_digest))
   return { approved: false, reason: "OWNER_VISUAL_REVIEW_REQUIRED", manifestDigest: null }
 const proposed = Array.isArray(manifest.proposedOrderedImages) ? manifest.proposedOrderedImages.map(record) : []
 const ownerConfirmed = galleryPreview.confirmation === "CONFIRM_FULL_GALLERY_PREVIEW_V1" && galleryPreview.ownerUserId === row.actor_user_id &&
   galleryPreview.manifestDigest === t.visual_manifest_digest && proposed.some(e => e.assetId) &&
   proposed.every(e => !e.assetId || assets.data?.some(a => a.id === e.assetId && record(a.owner_sync_approval).ownerUserId === row.actor_user_id))
 if ((!ownerConfirmed && t.assigned_operator_user_id !== row.actor_user_id) || t.status !== "OWNER_PREVIEW_READY" || !t.visual_manifest_digest ||
     !assets.data?.length || !proposed.some(e => e.assetId) ||
     proposed.some(e => e.assetId && !assets.data?.some(a => a.id === e.assetId && a.output_sha256 === e.outputSha256 && visualAssetOwnerApprovedV1(a, t))) ||
     bound.some(b => !proposed.some(e => e.assetId === b.assetId) || !assets.data?.some(a => a.id === b.assetId && visualAssetOwnerApprovedV1(a, t))))
   return { approved: false, reason: "OWNER_VISUAL_REVIEW_REQUIRED", manifestDigest: null }
 if ((row.kind === "IMAGE_SYNC" || row.intent.requestedChanges.manifestDigest != null) && row.intent.requestedChanges.manifestDigest !== t.visual_manifest_digest)
   return { approved: false, reason: "OUTBOX_APPROVED_MANIFEST_CHANGED", manifestDigest: null }
 return { approved: true, reason: null, manifestDigest: String(t.visual_manifest_digest), expectedImages: proposed.map(e => typeof e.publicUrl === "string" ? e.publicUrl : "") }
}
