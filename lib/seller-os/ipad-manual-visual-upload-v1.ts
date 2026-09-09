import "server-only"
import { createHash } from "node:crypto"
import { parseOutboxIntentV1 } from "./ipad-outbox-contract-v1"
import type { OutboxScope } from "./ipad-durable-outbox-v1"
import { uploadMayelVisualOutputBatchV1 } from "../ebay/ebay-mayel-visual-workstation-server-v1"

export const IPAD_IMAGE_CHUNK_BYTES = 1024 * 1024
const bucket = "seller-os-ipad-image-parts-v1"
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")
// This is only transport into the existing private upload/normalization/QA
// mechanism. Chunk requests stay small even with six full-resolution outputs.
export async function receiveIpadVisualFileV1(input: OutboxScope & { form: FormData }) {
 const intent = parseOutboxIntentV1(JSON.parse(String(input.form.get("intent"))))
 if (intent.kind !== "IMAGE_UPLOAD") throw Error("OUTBOX_IMAGE_UPLOAD_CONTRACT_INVALID")
 const file = intent.requestedChanges.files!.find(f => f.id === input.form.get("fileId"))
 if (!file) throw Error("OUTBOX_IMAGE_FILES_INVALID")
 const task = await input.supabase.from("ebay_mayel_visual_tasks_v1")
   .select("id,source_image_set_digest,status").eq("marketplace_account_key", input.accountKey)
   .eq("id", intent.requestedChanges.taskId!).eq("ebay_item_id", intent.itemId)
   .eq("assigned_operator_user_id", input.actorUserId).maybeSingle()
 if (task.error || !task.data || task.data.source_image_set_digest !== intent.baseVersionHash ||
   !["PROMPT_READY", "OUTPUTS_UPLOADED", "MAYEL_REVIEW_PENDING", "OWNER_PREVIEW_READY"].includes(task.data.status)) throw Error("OUTBOX_TASK_SCOPE_REQUIRED")
 const existing = await input.supabase.from("ebay_listing_image_assets").select("id")
   .eq("account_key", input.accountKey).eq("mayel_visual_task_id", task.data.id).eq("uploaded_by", input.actorUserId)
   .eq("source_type", "CHATGPT_SUBSCRIPTION_MAYEL").eq("source_sha256", file.sha256).in("status", ["pending_review", "approved"]).maybeSingle()
 if (existing.error) throw Error("OUTBOX_UPLOAD_ASSETS_READ_FAILED")
 const count = Math.ceil(file.bytes / IPAD_IMAGE_CHUNK_BYTES)
 const prefix = `ipad-outbox/${input.actorUserId}/${task.data.id}/${intent.idempotencyKey.slice(-64)}/${file.id}`
 const paths = Array.from({ length: count }, (_, n) => `${prefix}/${n}.part`)
 const storage = input.supabase.storage.from(bucket)
 if (existing.data) { await storage.remove(paths); return { stored: true, assetId: existing.data.id, idempotent: true, marketplaceWrites: 0 } }
 if (input.form.get("action") === "IPAD_VISUAL_CHUNK") {
   const index = Number(input.form.get("chunkIndex")), chunk = input.form.get("chunk")
   if (!Number.isSafeInteger(index) || index < 0 || index >= count || !(chunk instanceof File) ||
       chunk.size !== Math.min(IPAD_IMAGE_CHUNK_BYTES, file.bytes - index * IPAD_IMAGE_CHUNK_BYTES)) throw Error("OUTBOX_IMAGE_CHUNK_INVALID")
   const bytes = Buffer.from(await chunk.arrayBuffer())
   try {
     const uploaded = await storage.upload(paths[index], bytes, { contentType: "application/octet-stream", upsert: false })
     if (uploaded.error) {
       const prior = await storage.download(paths[index])
       if (prior.error || !prior.data) throw Error("OUTBOX_IMAGE_CHUNK_SAVE_FAILED")
       const previous = Buffer.from(await prior.data.arrayBuffer())
       try { if (sha(previous) !== sha(bytes)) throw Error("OUTBOX_IMAGE_CHUNK_CONFLICT") } finally { previous.fill(0) }
     }
   } finally { bytes.fill(0) }
   return { stored: false, chunkStored: true, marketplaceWrites: 0 }
 }
 if (input.form.get("action") !== "IPAD_VISUAL_FILE") throw Error("OUTBOX_IMAGE_UPLOAD_CONTRACT_INVALID")
 const parts: Buffer[] = []
 let bytes: Buffer | null = null
 try {
   for (const path of paths) {
     const part = await storage.download(path)
     if (part.error || !part.data) throw Error("OUTBOX_IMAGE_CHUNK_READ_FAILED")
     const buffer = Buffer.from(await part.data.arrayBuffer())
     parts.push(buffer)
     if (buffer.length > IPAD_IMAGE_CHUNK_BYTES) throw Error("OUTBOX_IMAGE_CHUNK_INVALID")
   }
   bytes = Buffer.concat(parts)
   if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) throw Error("OUTBOX_IMAGE_BYTES_MISMATCH")
   const result = await uploadMayelVisualOutputBatchV1({ ...input, taskId: task.data.id,
     rightsConfirmed: true, files: [{ declaredMimeType: file.mimeType, file: bytes }] })
   if (result.failedCount) throw Error(String(result.results[0]?.error ?? "OUTBOX_IMAGE_UPLOAD_FAILED"))
   await storage.remove(paths)
   return { stored: true, assetId: result.results[0].assetId, marketplaceWrites: 0 }
 } finally { parts.forEach(b => b.fill(0)); bytes?.fill(0) }
}
