import type { SupabaseClient } from "@supabase/supabase-js"
import { readMayelGeneratedImageV1, validateMayelGeneratedImageV1 } from "./mayel-generated-image-binding-v1"

const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}
type Scope = { supabase: SupabaseClient; accountKey: string; actorUserId: string }
const TASK_COLUMNS = "id,ebay_item_id,status,assigned_operator_user_id,current_image_set,visual_manifest,visual_manifest_digest,source_image_set_digest,updated_at"

function itemScope(ids: string[]) {
  if (!ids.length || ids.length > 20 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || !/^\d{9,20}$/.test(id)))
    throw Error("MAYEL_WORKSPACE_ITEMS_INVALID")
}

// Only stored evidence and private storage are read here. Being unable to read
// eBay must not prevent an operator from reviewing or saving an existing draft.
export async function readMayelImageWorkspaceV1(input: Scope & { itemIds: string[] }) {
  itemScope(input.itemIds)
  const [tasks, experiments] = await Promise.all([
    input.supabase.from("ebay_mayel_visual_tasks_v1").select(TASK_COLUMNS)
      .eq("marketplace_account_key", input.accountKey).in("ebay_item_id", input.itemIds)
      .in("status", ["PROMPT_READY", "OUTPUTS_UPLOADED", "MAYEL_REVIEW_PENDING", "OWNER_PREVIEW_READY"])
      .order("updated_at", { ascending: false }).limit(21),
    input.supabase.from("ebay_listing_experiments_v1")
      .select("experiment_id,account_key,marketplace,ebay_item_id,experiment_type,lifecycle_status,baseline_evidence_ref,created_at")
      .eq("account_key", input.accountKey).in("ebay_item_id", input.itemIds)
      .eq("experiment_type", "HERO_VISUAL_VARIANT").in("lifecycle_status", ["DRAFT", "READY"])
      .order("created_at", { ascending: false }).limit(81),
  ])
  if (tasks.error || experiments.error || (tasks.data?.length ?? 0) > 20 || (experiments.data?.length ?? 0) > 80)
    throw Error("MAYEL_WORKSPACE_READ_INCOMPLETE")
  const taskIds = (tasks.data ?? []).map(t => String(t.id))
  const [assets, executions] = taskIds.length ? await Promise.all([
    input.supabase.from("ebay_listing_image_assets")
      .select("id,mayel_visual_task_id,status,source_type,output_storage_path,public_url,uploaded_by,provenance")
      .eq("account_key", input.accountKey).in("mayel_visual_task_id", taskIds)
      .in("status", ["pending_review", "approved"]).limit(121),
    input.supabase.from("ebay_mayel_visual_phase_b_executions_v1")
      .select("visual_task_id,visual_manifest_digest,phase,created_at")
      .eq("marketplace_account_key", input.accountKey).in("visual_task_id", taskIds)
      .order("created_at", { ascending: false }).limit(101),
  ]) : [{ data: [], error: null }, { data: [], error: null }]
  if (assets.error || executions.error || (assets.data?.length ?? 0) > 120 || (executions.data?.length ?? 0) > 100)
    throw Error("MAYEL_WORKSPACE_RECEIPT_READ_INCOMPLETE")
  const proposals = []
  for (const row of experiments.data ?? []) {
    const visual = record(record(row.baseline_evidence_ref).sellerOsVisualVariant)
    for (const candidate of (Array.isArray(visual.variants) ? visual.variants : []).slice(0, 2)) {
      let origin
      try { origin = validateMayelGeneratedImageV1({ accountKey: input.accountKey, itemId: String(row.ebay_item_id),
        experimentId: String(row.experiment_id), assetId: String(record(candidate).assetId), row }) }
      catch { continue } // Invalid/rejected variants can never become actionable proposals.
      const task = (tasks.data ?? []).find(t => t.ebay_item_id === origin.itemId)
      const asset = (assets.data ?? []).find(a => a.id === origin.assetId)
      const manifest = record(task?.visual_manifest)
      const ordered = Array.isArray(manifest.proposedOrderedImages) ? manifest.proposedOrderedImages.map(record) : []
      const included = ordered.some(entry => entry.assetId === origin.assetId)
      const exactExecutions = (executions.data ?? []).filter(e => e.visual_task_id === task?.id && e.visual_manifest_digest === task?.visual_manifest_digest)
      const applied = included && exactExecutions.some(e => e.phase === "APPLIED_AND_OFFICIALLY_VERIFIED")
      const status = applied ? "APPLIED" : asset?.status === "approved" && included ? "QUEUED" : asset?.status === "approved" ? "SUPERSEDED" : "DRAFT"
      const path = asset?.output_storage_path ?? origin.outputStoragePath
      const signed = await input.supabase.storage.from("ebay-listing-image-staging").createSignedUrl(String(path), 300)
      proposals.push({ itemId: origin.itemId, assetId: origin.assetId, experimentId: origin.experimentId,
        taskId: task?.id ?? null, status, generatedAt: origin.generatedAt,
        editable: !task || task.assigned_operator_user_id === input.actorUserId,
        imported: Boolean(asset), previewUrl: signed.data?.signedUrl ?? null,
        beforeUrl: Array.isArray(task?.current_image_set) ? task.current_image_set[0] ?? origin.sourceImageUrl : origin.sourceImageUrl,
        sourceImageSetDigest: task?.source_image_set_digest ?? null,
        diagnostics: { latestExecutionPhase: exactExecutions[0]?.phase ?? null,
          taskStatus: task?.status ?? null, manifestDigest: task?.visual_manifest_digest ?? null } })
    }
  }
  return { proposals, marketplaceWrites: 0, tradingCalls: 0, storedEvidenceOnly: true }
}

export async function prepareMayelImageReviewV1(input: Scope & { itemId: string; taskId: string | null; experimentId: string; assetId: string }) {
  const { uploadMayelVisualOutputV1, ensureMayelVisualTaskV1 } = await import("../ebay/ebay-mayel-visual-workstation-server-v1")
  const origin = await readMayelGeneratedImageV1(input)
  const taskId = input.taskId ?? (await ensureMayelVisualTaskV1({ ...input, targetItemId: input.itemId, offlineOnly: true,
    generatedSource: { experimentId: input.experimentId, assetId: input.assetId } })).task?.id
  if (typeof taskId !== "string") throw Error("MAYEL_SAVED_VISUAL_EVIDENCE_REQUIRED")
  const task = await input.supabase.from("ebay_mayel_visual_tasks_v1").select("id,ebay_item_id")
    .eq("marketplace_account_key", input.accountKey).eq("id", taskId)
    .eq("assigned_operator_user_id", input.actorUserId).eq("ebay_item_id", input.itemId).maybeSingle()
  if (task.error || !task.data) throw Error("MAYEL_IMAGE_ASSIGNED_TASK_REQUIRED")
  const download = await input.supabase.storage.from("ebay-listing-image-staging").download(origin.outputStoragePath)
  if (download.error || !download.data || download.data.size > 12 * 1024 * 1024) throw Error("MAYEL_GENERATED_IMAGE_READ_FAILED")
  const bytes = Buffer.from(await download.data.arrayBuffer())
  try {
    return await uploadMayelVisualOutputV1({ ...input, taskId, role: "DETAIL", declaredMimeType: "image/png", file: bytes,
      rightsConfirmed: true, generatedOrigin: { experimentId: input.experimentId, assetId: input.assetId } })
  } finally { bytes.fill(0) }
}

export async function confirmMayelImageQueueV1(input: Scope & {
  itemId: string; taskId: string; assetId: string; humanQa: unknown; replaceMainImage: boolean; expectedSourceDigest: string
}) {
  const { reviewMayelVisualOutputV1 } = await import("../ebay/ebay-mayel-visual-workstation-server-v1")
  if (input.replaceMainImage !== true) throw Error("MAYEL_IMAGE_REPLACEMENT_CONFIRMATION_REQUIRED")
  const task = await input.supabase.from("ebay_mayel_visual_tasks_v1").select("id,source_image_set_digest")
    .eq("marketplace_account_key", input.accountKey).eq("id", input.taskId)
    .eq("assigned_operator_user_id", input.actorUserId).eq("ebay_item_id", input.itemId).maybeSingle()
  if (task.error || !task.data || task.data.source_image_set_digest !== input.expectedSourceDigest)
    throw Error("MAYEL_IMAGE_REVIEW_SOURCE_CHANGED")
  const source = await input.supabase.from("ebay_listing_image_assets").select("source_type")
    .eq("account_key", input.accountKey).eq("mayel_visual_task_id", input.taskId).eq("id", input.assetId).maybeSingle()
  if (source.error || source.data?.source_type !== "SELLER_OS_ASSISTANT_IMAGE_VARIANT") throw Error("MAYEL_ASSISTANT_IMAGE_REQUIRED")
  // Approval writes only the existing atomic asset/manifest queue. Its existing
  // delegated runtime performs the fresh official preflight and exact readback.
  const outcome = await reviewMayelVisualOutputV1({ ...input, decision: "APPROVE" })
  return { queued: true, idempotent: outcome.idempotent, marketplaceWrites: 0 }
}
