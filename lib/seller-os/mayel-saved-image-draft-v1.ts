import { createHash, randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { isMayelGeneratedSourceBoundV1, type readMayelGeneratedImageV1 } from "./mayel-generated-image-binding-v1"

const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}
const digest = (v: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(v)).digest("hex")}`
type Scope = { supabase: SupabaseClient; accountKey: string; actorUserId: string; taskId: string }
type Origin = Awaited<ReturnType<typeof readMayelGeneratedImageV1>>
const TASK_COLUMNS = "id,ebay_item_id,assigned_operator_user_id,status,selection_signal,current_image_set,source_image_set_digest,visual_manifest_digest,updated_at"

export function savedImageDraftReceiptV1(signal: unknown, assetId: string) {
  const receipt = record(record(signal).savedImageDraft)
  return receipt.version === "MAYEL_SAVED_IMAGE_DRAFT_EXECUTION_V1" && receipt.assetId === assetId ? receipt : {}
}

async function taskRead(input: Scope) {
  const read = await input.supabase.from("ebay_mayel_visual_tasks_v1").select(TASK_COLUMNS)
    .eq("marketplace_account_key", input.accountKey).eq("id", input.taskId).maybeSingle()
  if (read.error || !read.data) throw Error("MAYEL_SAVED_DRAFT_TASK_REQUIRED")
  return read.data as Record<string, unknown>
}

// An OWNER's explicit prepare action may take only an unused task. READ never
// assigns work, and another operator cannot take a colleague's task.
export async function startMayelSavedImageDraftV1(input: Scope & { origin: Origin; owner: boolean }) {
  const task = await taskRead(input)
  if (task.ebay_item_id !== input.origin.itemId || task.visual_manifest_digest !== null)
    throw Error("MAYEL_SAVED_DRAFT_TASK_CONFLICT")
  const images = Array.isArray(task.current_image_set) ? task.current_image_set : []
  if (!images.some(url => isMayelGeneratedSourceBoundV1(url, input.origin.sourceImageUrl)))
    throw Error("MAYEL_GENERATED_IMAGE_SOURCE_CONFLICT")
  const previous = savedImageDraftReceiptV1(task.selection_signal, input.origin.assetId)
  const assigned = task.assigned_operator_user_id === input.actorUserId
  if (!assigned && !input.owner) throw Error("MAYEL_IMAGE_ASSIGNED_TASK_REQUIRED")
  if (assigned && previous.phase === "DRAFT_PREVIEW_READY") {
    if (previous.generatedSourceSha256 !== input.origin.outputSha256) throw Error("MAYEL_SAVED_DRAFT_SOURCE_CHANGED")
    return { receipt: previous, completed: true }
  }
  if (previous.phase === "DRAFT_PREPARING" && Date.now() - Date.parse(String(previous.startedAt)) < 120_000)
    throw Error("MAYEL_SAVED_DRAFT_ALREADY_RUNNING")
  const [assets, executions] = await Promise.all([
    input.supabase.from("ebay_listing_image_assets").select("id,status,uploaded_by")
      .eq("account_key", input.accountKey).eq("mayel_visual_task_id", input.taskId).limit(7),
    input.supabase.from("ebay_mayel_visual_phase_b_executions_v1").select("id")
      .eq("marketplace_account_key", input.accountKey).eq("visual_task_id", input.taskId).limit(1),
  ])
  if (assets.error || executions.error) throw Error("MAYEL_SAVED_DRAFT_ACTIVITY_READ_FAILED")
  if (executions.data?.length || (!assigned && (task.status !== "PROMPT_READY" || assets.data?.length)) ||
      !["PROMPT_READY", "OUTPUTS_UPLOADED", "MAYEL_REVIEW_PENDING"].includes(String(task.status)) ||
      (assets.data ?? []).some(a => a.id !== input.origin.assetId || a.status !== "pending_review" || a.uploaded_by !== input.actorUserId))
    throw Error("MAYEL_SAVED_DRAFT_ACTIVE_WORK_CONFLICT")
  const startedAt = new Date().toISOString()
  const receipt = { version: "MAYEL_SAVED_IMAGE_DRAFT_EXECUTION_V1", executionId: randomUUID(),
    scope: "DRAFT_ONLY", phase: "DRAFT_PREPARING", assetId: input.origin.assetId,
    experimentId: input.origin.experimentId, itemId: input.origin.itemId, taskId: input.taskId,
    generatedSourceSha256: input.origin.outputSha256,
    actorUserId: input.actorUserId, previousAssignee: task.assigned_operator_user_id,
    assignmentAuthority: assigned ? "ASSIGNED_OPERATOR" : "OWNER_EXPLICIT_PREPARE",
    startedAt, marketplaceWrites: 0, publishAuthorized: false }
  const claimed = await input.supabase.from("ebay_mayel_visual_tasks_v1").update({
    assigned_operator_user_id: input.actorUserId,
    selection_signal: { ...record(task.selection_signal), savedImageDraft: receipt }, updated_at: startedAt,
  }).eq("marketplace_account_key", input.accountKey).eq("id", input.taskId)
    .eq("assigned_operator_user_id", task.assigned_operator_user_id).eq("status", task.status)
    .eq("updated_at", task.updated_at).is("visual_manifest_digest", null).select("id").maybeSingle()
  if (claimed.error || !claimed.data) throw Error("MAYEL_SAVED_DRAFT_CLAIM_CONFLICT")
  return { receipt, completed: false }
}

export async function completeMayelSavedImageDraftV1(input: Scope & { origin: Origin; executionId: string }) {
  const task = await taskRead(input)
  const started = savedImageDraftReceiptV1(task.selection_signal, input.origin.assetId)
  if (task.assigned_operator_user_id !== input.actorUserId || task.visual_manifest_digest !== null ||
      started.executionId !== input.executionId || started.phase !== "DRAFT_PREPARING")
    throw Error("MAYEL_SAVED_DRAFT_EXECUTION_CONFLICT")
  const read = await input.supabase.from("ebay_listing_image_assets")
    .select("id,status,uploaded_by,source_type,source_sha256,output_sha256,output_storage_path,output_width,output_height,output_bytes,qa_result,provenance")
    .eq("account_key", input.accountKey).eq("mayel_visual_task_id", input.taskId).eq("id", input.origin.assetId).maybeSingle()
  const asset = read.data
  if (read.error || !asset || asset.status !== "pending_review" || asset.uploaded_by !== input.actorUserId ||
      asset.source_type !== input.origin.sourceType || asset.source_sha256 !== input.origin.outputSha256 ||
      record(asset.qa_result).automaticStatus !== "PASSED" || asset.output_width !== 1600 || asset.output_height !== 1600)
    throw Error("MAYEL_SAVED_DRAFT_QA_REQUIRED")
  const downloaded = await input.supabase.storage.from("ebay-listing-image-staging").download(asset.output_storage_path)
  if (downloaded.error || !downloaded.data) throw Error("MAYEL_SAVED_DRAFT_READBACK_FAILED")
  const bytes = Buffer.from(await downloaded.data.arrayBuffer())
  try {
    if (bytes.length !== asset.output_bytes || createHash("sha256").update(bytes).digest("hex") !== asset.output_sha256)
      throw Error("MAYEL_SAVED_DRAFT_READBACK_MISMATCH")
  } finally { bytes.fill(0) }
  const current = Array.isArray(task.current_image_set) ? task.current_image_set : []
  const manifest = { version: "MAYEL_SAVED_IMAGE_DRAFT_MANIFEST_V1", scope: "DRAFT_ONLY",
    accountKey: input.accountKey, itemId: input.origin.itemId, taskId: input.taskId,
    sourceImageSetDigest: task.source_image_set_digest,
    proposedOrderedImages: [{ kind: "PRIVATE_DRAFT_ASSET", assetId: asset.id,
      storagePath: asset.output_storage_path, sha256: asset.output_sha256 },
    ...current.slice(1).map(url => ({ kind: "CURRENT_SAVED_IMAGE", url }))],
    publishAuthorized: false, marketplaceWriteAuthorized: false }
  const receipt = { ...started, phase: "DRAFT_PREVIEW_READY", completedAt: new Date().toISOString(),
    manifest, manifestDigest: digest(manifest), imageQaPassed: true,
    qaScope: "CERTIFIED_GENERATOR_AND_NORMALIZATION_AND_STORAGE_READBACK",
    sourceBytesVerified: true, normalizedBytesVerified: true, newImageGenerationCount: 0,
    humanPublicationReviewCompleted: false, marketplaceWrites: 0, publishAuthorized: false }
  const saved = await input.supabase.from("ebay_listing_image_assets").update({
    provenance: { ...record(asset.provenance), savedImageDraft: receipt },
  }).eq("account_key", input.accountKey).eq("id", asset.id).eq("mayel_visual_task_id", input.taskId)
    .eq("uploaded_by", input.actorUserId).eq("status", "pending_review").select("id").maybeSingle()
  if (saved.error || !saved.data) throw Error("MAYEL_SAVED_DRAFT_RECEIPT_SAVE_FAILED")
  // Never set visual_manifest or OWNER_PREVIEW_READY: those are executable
  // publication authorities. This separate draft manifest stays private.
  const completed = await input.supabase.from("ebay_mayel_visual_tasks_v1").update({
    status: "MAYEL_REVIEW_PENDING", updated_at: receipt.completedAt,
    selection_signal: { ...record(task.selection_signal), savedImageDraft: receipt },
  }).eq("marketplace_account_key", input.accountKey).eq("id", input.taskId)
    .eq("assigned_operator_user_id", input.actorUserId).eq("updated_at", task.updated_at)
    .is("visual_manifest_digest", null).select("id").maybeSingle()
  if (completed.error || !completed.data) throw Error("MAYEL_SAVED_DRAFT_COMPLETE_CONFLICT")
  return receipt
}
