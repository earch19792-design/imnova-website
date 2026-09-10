import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { readOptimizationGrantV1, enqueueDelegatedVisualV1 } from "./mayel-optimization-delegation-server-v1"
import { optimizationGrantActiveV1 } from "./mayel-optimization-delegation-v1"
import { savedSafeDecisionV1 } from "./mayel-approved-asset-transition-v1"

export async function recoverApprovedAssetTransitionV1(input: { supabase: SupabaseClient; accountKey: string;
  taskId: string; expectedItemId: string; assetId?: string }) {
  if (!/^[a-f0-9-]{36}$/i.test(input.taskId) || !/^\d{9,20}$/.test(input.expectedItemId) ||
    input.assetId && !/^[a-f0-9-]{36}$/i.test(input.assetId)) throw Error("MAYEL_TRANSITION_EXACT_SCOPE_REQUIRED")
  const t = await input.supabase.from("ebay_mayel_visual_tasks_v1")
    .select("id,ebay_item_id,marketplace_account_key,assigned_operator_user_id,status,visual_manifest_digest,selection_signal,product_truth_digest,source_image_set_digest")
    .eq("id", input.taskId).eq("marketplace_account_key", input.accountKey).eq("ebay_item_id", input.expectedItemId).maybeSingle()
  if (t.error || !t.data) throw Error("MAYEL_TRANSITION_TASK_REQUIRED")
  const task = t.data
  const grant = await readOptimizationGrantV1(input.supabase, input.accountKey)
  if (!optimizationGrantActiveV1(grant, input.accountKey)) throw Error("OWNER_DELEGATION_REQUIRED")
  let query = input.supabase.from("ebay_listing_image_assets")
    .select("id,status,mayel_approval_status,qa_result,mayel_output_role,output_sha256,product_truth_digest,source_image_set_digest")
    .eq("account_key", input.accountKey).eq("mayel_visual_task_id", input.taskId)
  query = input.assetId ? query.eq("id", input.assetId) : query.in("status", ["approved", "pending_review"])
  const assets = await query.order("created_at", { ascending: true }).limit(7)
  if (assets.error || !assets.data?.length || assets.data.length > 6) throw Error("MAYEL_TRANSITION_ASSET_SCOPE_REQUIRED")
  const asset = assets.data[0]
  const safe = savedSafeDecisionV1(asset, t.data)
  const blocked = async (reason: string) => {
    const truth = await input.supabase.rpc("seller_os_read_visual_current_product_truth_v1", { p_account_key: input.accountKey, p_task_id: input.taskId })
    if (truth.error) throw Error("MAYEL_CURRENT_PRODUCT_TRUTH_READ_FAILED")
    const blockers = [reason, ...(!truth.data && !(task.selection_signal as Record<string, unknown>)?.productTruthSupported ? ["PRODUCT_TRUTH_REQUIRED"] : [])]
    // Diagnostic projection only; it never changes/reverses a rejection or QA.
    if (asset.status !== "rejected") {
      const saved = await input.supabase.from("ebay_listing_image_assets").update({ qa_result: { ...asset.qa_result,
        transitionRecovery: { state: "REQUIRES_ATTENTION", reason, blockers, authority: "OWNER_FULL_DELEGATION_GUARDS",
          officialReadbackRequired: true } } }).eq("id", asset.id).eq("status", asset.status)
        .eq("mayel_approval_status", asset.mayel_approval_status).eq("qa_result", JSON.stringify(asset.qa_result))
        .select("id").maybeSingle()
      if (saved.error || !saved.data) throw Error("MAYEL_TRANSITION_DIAGNOSTIC_SAVE_FAILED")
    }
    return { status: "REQUIRES_ATTENTION", reason, blockers, assetId: asset.id, activeDelegationFound: true,
      receipt: null, imageWriteCount: 0, officialReadback: false }
  }
  if (asset.status !== "approved") {
    if (!safe.safe) return blocked(safe.reason)
    const signal = task.selection_signal as Record<string, unknown>
    const gallery = signal?.currentOfficialGallery as Record<string, unknown> | undefined
    if (safe.decision.galleryDigest !== gallery?.digest) return blocked("MATERIAL_GENERATION_DRIFT")
    const { reviewMayelVisualOutputV1 } = await import("../ebay/ebay-mayel-visual-workstation-server-v1")
    await reviewMayelVisualOutputV1({ ...input, assetId: asset.id, actorUserId: t.data.assigned_operator_user_id,
      decision: "APPROVE", humanQa: safe.decision.checks, visualIntent: safe.intent,
      expectedGalleryDigest: String(safe.decision.galleryDigest) })
  }
  const queued = await enqueueDelegatedVisualV1(input)
  return { ...queued, assetId: asset.id, activeDelegationFound: true, imageWriteCount: 0, officialReadback: false }
}
