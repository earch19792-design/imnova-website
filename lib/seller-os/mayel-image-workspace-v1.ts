import { readOptimizationGrantV1, readDelegatedVisualAuthorityV1 } from "./mayel-optimization-delegation-server-v1"
import { optimizationGrantActiveV1 } from "./mayel-optimization-delegation-v1"
import type { SupabaseClient } from "@supabase/supabase-js"
import { readMayelGeneratedImageV1, validateMayelGeneratedImageV1 } from "./mayel-generated-image-binding-v1"
import { startMayelSavedImageDraftV1, completeMayelSavedImageDraftV1, savedImageDraftReceiptV1 } from "./mayel-saved-image-draft-v1"
import { VISUAL_OWNER_SYNC_CONFIRMATION, visualAssetGenerationV1, visualAssetSyncViewV1 } from "./visual-asset-sync-state-v1"

const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}
type Scope = { supabase: SupabaseClient; accountKey: string; actorUserId: string; owner?: boolean }
const TASK_COLUMNS = "id,marketplace_account_key,evidence_pack,source_image_references,ebay_item_id,status,assigned_operator_user_id,current_image_set,visual_manifest,visual_manifest_digest,source_image_set_digest,product_truth_digest,selection_signal,updated_at"

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
      .select("id,account_key,mayel_visual_task_id,status,source_type,source_sha256,output_sha256,mayel_output_role,mayel_approval_status,owner_sync_approval,source_image_references,source_image_set_digest,product_truth_digest,qa_result,output_storage_path,public_url,uploaded_by,provenance")
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
  const outbox = await input.supabase.from("seller_os_ipad_outbox_v1").select("id,account_key,item_id,intent,binding,state,official_readback,received_at,execution_receipt")
    .eq("account_key", input.accountKey).in("item_id", input.itemIds).in("kind", ["IMAGE_DRAFT", "IMAGE_SYNC", "IMAGE_UPLOAD"])
    .neq("state", "SUPERSEDED").limit(500)
  if (outbox.error || (outbox.data?.length ?? 0) >= 500) throw Error("VISUAL_SYNC_STATE_READ_FAILED")
  const grant = await readOptimizationGrantV1(input.supabase, input.accountKey)
  const active = optimizationGrantActiveV1(grant, input.accountKey)
  const authorityByTask = new Map<string, Awaited<ReturnType<typeof readDelegatedVisualAuthorityV1>>>()
  if (active) for (const task of tasks.data ?? []) authorityByTask.set(task.id,
    await readDelegatedVisualAuthorityV1({ ...input, task, assets: (assets.data ?? []).filter(a => a.mayel_visual_task_id === task.id), grant }))
  for (const row of experiments.data ?? []) {
    const visual = record(record(row.baseline_evidence_ref).sellerOsVisualVariant)
    for (const candidate of (Array.isArray(visual.variants) ? visual.variants : []).slice(0, 2)) {
      let origin
      try { origin = validateMayelGeneratedImageV1({ accountKey: input.accountKey, itemId: String(row.ebay_item_id),
        experimentId: String(row.experiment_id), assetId: String(record(candidate).assetId), row }) }
      catch { continue } // Invalid/rejected variants can never become actionable proposals.
      const task = (tasks.data ?? []).find(t => t.ebay_item_id === origin.itemId)
      const asset = (assets.data ?? []).find(a => a.id === origin.assetId)
      const draft = savedImageDraftReceiptV1(task?.selection_signal, origin.assetId)
      const assetDraft = savedImageDraftReceiptV1({ savedImageDraft: record(asset?.provenance).savedImageDraft }, origin.assetId)
      const draftComplete = Boolean(asset && asset.status === "pending_review" && draft.phase === "DRAFT_PREVIEW_READY" &&
        draft.executionId === assetDraft.executionId && draft.manifestDigest === assetDraft.manifestDigest &&
        draft.generatedSourceSha256 === origin.outputSha256 && asset.source_sha256 === origin.outputSha256 &&
        record(asset.qa_result).automaticStatus === "PASSED")
      const manifest = record(task?.visual_manifest)
      const ordered = Array.isArray(manifest.proposedOrderedImages) ? manifest.proposedOrderedImages.map(record) : []
      const included = ordered.some(entry => entry.assetId === origin.assetId)
      const exactExecutions = (executions.data ?? []).filter(e => e.visual_task_id === task?.id && e.visual_manifest_digest === task?.visual_manifest_digest)
      const applied = included && exactExecutions.some(e => e.phase === "APPLIED_AND_OFFICIALLY_VERIFIED")
      const delegated = task ? authorityByTask.get(task.id) : null
      const sync = asset && task ? visualAssetSyncViewV1(asset, task, outbox.data ?? [], { active, reason: delegated?.reason,
        authorized: delegated?.authorized === true && delegated.proposed.some(p => p.assetId === asset.id) }) : null
      const status = sync?.state === "REQUIRES_ATTENTION" ? "REQUIRES_ATTENTION" : applied && sync?.approvedForEbaySync ? "APPLIED" :
        sync?.approvedForEbaySync && included ? "QUEUED" : asset?.status === "approved" && !included ? "SUPERSEDED" : "DRAFT"
      const path = asset?.output_storage_path ?? origin.outputStoragePath
      const signed = await input.supabase.storage.from("ebay-listing-image-staging").createSignedUrl(String(path), 300)
      proposals.push({ autonomousOptimization: active, itemId: origin.itemId, assetId: origin.assetId, experimentId: origin.experimentId,
        taskId: task?.id ?? null, status, sync, generatedAt: origin.generatedAt,
        editable: !task || task.assigned_operator_user_id === input.actorUserId,
        canAssignAndPrepare: input.owner === true && task !== undefined && task.assigned_operator_user_id !== input.actorUserId &&
          task.status === "PROMPT_READY" && !task.visual_manifest_digest && !draft.executionId &&
          !(assets.data ?? []).some(a => a.mayel_visual_task_id === task.id) &&
          !(executions.data ?? []).some(e => e.visual_task_id === task.id),
        imported: Boolean(asset), previewUrl: signed.data?.signedUrl ?? null,
        beforeUrl: Array.isArray(task?.current_image_set) ? task.current_image_set[0] ?? origin.sourceImageUrl : origin.sourceImageUrl,
        sourceImageSetDigest: task?.source_image_set_digest ?? null,
        diagnostics: { latestExecutionPhase: exactExecutions[0]?.phase ?? (draftComplete ? draft.phase : draft.phase === "DRAFT_PREPARING" ? draft.phase : null),
          executionScope: exactExecutions.length ? "MARKETPLACE_APPLICATION" : draft.executionId ? "DRAFT_ONLY" : null,
          executionId: draft.executionId ?? null, imageQaPassed: draftComplete && draft.imageQaPassed === true,
          taskStatus: task?.status ?? null, manifestDigest: task?.visual_manifest_digest ?? (draftComplete ? draft.manifestDigest : null),
          draftManifest: draftComplete ? draft.manifest : null } })
    }
  }
  return { proposals, autonomousOptimization: active, marketplaceWrites: 0, tradingCalls: 0, storedEvidenceOnly: true }
}

export async function prepareMayelImageReviewV1(input: Scope & { itemId: string; taskId: string | null; experimentId: string; assetId: string }) {
  const { uploadMayelVisualOutputV1, ensureMayelVisualTaskV1 } = await import("../ebay/ebay-mayel-visual-workstation-server-v1")
  const origin = await readMayelGeneratedImageV1(input)
  const taskId = input.taskId ?? (await ensureMayelVisualTaskV1({ ...input, targetItemId: input.itemId, offlineOnly: true,
    generatedSource: { experimentId: input.experimentId, assetId: input.assetId } })).task?.id
  if (typeof taskId !== "string") throw Error("MAYEL_SAVED_VISUAL_EVIDENCE_REQUIRED")
  const started = await startMayelSavedImageDraftV1({ ...input, taskId, origin, owner: input.owner === true })
  if (started.completed) return started.receipt
  const download = await input.supabase.storage.from("ebay-listing-image-staging").download(origin.outputStoragePath)
  if (download.error || !download.data || download.data.size > 12 * 1024 * 1024) throw Error("MAYEL_GENERATED_IMAGE_READ_FAILED")
  const bytes = Buffer.from(await download.data.arrayBuffer())
  try {
    await uploadMayelVisualOutputV1({ ...input, taskId, role: "DETAIL", declaredMimeType: "image/png", file: bytes,
      rightsConfirmed: true, generatedOrigin: { experimentId: input.experimentId, assetId: input.assetId } })
    return await completeMayelSavedImageDraftV1({ ...input, taskId, origin, executionId: String(started.receipt.executionId) })
  } finally { bytes.fill(0) }
}

export async function confirmMayelImageQueueV1(input: Scope & {
  itemId: string; taskId: string; assetId: string; humanQa: unknown; replaceMainImage: boolean; expectedSourceDigest: string; authorizeDraftSync?: boolean
}) {
  if (!input.owner) throw Error("VISUAL_SYNC_OWNER_REQUIRED")
  if (input.replaceMainImage !== true) throw Error("MAYEL_IMAGE_REPLACEMENT_CONFIRMATION_REQUIRED")
  const task = await input.supabase.from("ebay_mayel_visual_tasks_v1").select("id,source_image_set_digest,selection_signal")
    .eq("marketplace_account_key", input.accountKey).eq("id", input.taskId)
    .eq("assigned_operator_user_id", input.actorUserId).eq("ebay_item_id", input.itemId).maybeSingle()
  if (task.error || !task.data || task.data.source_image_set_digest !== input.expectedSourceDigest)
    throw Error("MAYEL_IMAGE_REVIEW_SOURCE_CHANGED")
  if (savedImageDraftReceiptV1(task.data.selection_signal, input.assetId).scope === "DRAFT_ONLY" && input.authorizeDraftSync !== true)
    throw Error("MAYEL_DRAFT_ONLY_NO_PUBLICATION_AUTHORITY")
  const source = await input.supabase.from("ebay_listing_image_assets").select("source_type")
    .eq("account_key", input.accountKey).eq("mayel_visual_task_id", input.taskId).eq("id", input.assetId).maybeSingle()
  if (source.error || source.data?.source_type !== "SELLER_OS_ASSISTANT_IMAGE_VARIANT") throw Error("MAYEL_ASSISTANT_IMAGE_REQUIRED")
  // Approval writes only the existing atomic asset/manifest queue. Its existing
  // delegated runtime performs the fresh official preflight and exact readback.
  const { reviewMayelVisualOutputV1, approveMayelVisualAssetSyncV1 } = await import("../ebay/ebay-mayel-visual-workstation-server-v1")
  const outcome = await reviewMayelVisualOutputV1({ ...input, decision: "APPROVE" })
  await approveMayelVisualAssetSyncV1({ ...input, owner: true, generation: visualAssetGenerationV1(outcome.asset),
    confirmation: VISUAL_OWNER_SYNC_CONFIRMATION })
  return { queued: true, idempotent: outcome.idempotent, marketplaceWrites: 0 }
}
