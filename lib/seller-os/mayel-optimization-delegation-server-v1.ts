import "server-only"
import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { authorizeOptimizationV1, delegatedVisualQaV1, MAYEL_OPTIMIZATION_DELEGATION_V1, type OptimizationGrantV1 } from "./mayel-optimization-delegation-v1"
import { stableOutboxJsonV1, IPAD_OUTBOX_VERSION } from "./ipad-outbox-contract-v1"
import { visualIntentOrderV1 } from "./mayel-visual-intent-v1"

export async function readOptimizationGrantV1(supabase: SupabaseClient, accountKey: string) {
  const r = await supabase.from("seller_os_mayel_optimization_grants_v1")
    .select("id,account_key,owner_user_id,contract_version,scope,status,revoked_at,authority_digest,allowed_actions")
    .eq("account_key", accountKey).eq("status", "ACTIVE").is("revoked_at", null).limit(1).maybeSingle()
  if (r.error) throw Error("MAYEL_OPTIMIZATION_GRANT_READ_FAILED")
  return r.data as OptimizationGrantV1 | null
}
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}
export async function readDelegatedVisualAuthorityV1(input: { supabase: SupabaseClient; accountKey: string;
  task: Record<string, unknown>; assets: Record<string, unknown>[]; grant?: OptimizationGrantV1 | null }) {
  const { task, assets } = input
  const grant = input.grant === undefined ? await readOptimizationGrantV1(input.supabase, input.accountKey) : input.grant
  const manifest = record(task.visual_manifest), signal = record(task.selection_signal)
  const proposed = Array.isArray(manifest.proposedOrderedImages) ? manifest.proposedOrderedImages.map(record) : []
  const intents = Array.isArray(manifest.visualIntents) ? manifest.visualIntents.map(record) : []
  let compatible = false
  try {
    const order = visualIntentOrderV1(task.current_image_set as string[], intents as unknown as import("./mayel-visual-intent-v1").VisualIntentV1[])
    compatible = order.length === proposed.length && order.every((e, i) => e.kind === "MAYEL_ASSET"
      ? e.assetId === proposed[i].assetId : e.publicUrl === proposed[i].publicUrl)
  } catch { /* Malformed or implicit changes never gain delegation authority. */ }
  const references = Array.isArray(task.source_image_references) ? task.source_image_references.map(record) : []
  const pack = record(task.evidence_pack)
  const ownSourcePack = stableOutboxJsonV1(pack.sourceImageSet) === stableOutboxJsonV1(task.source_image_references) &&
    typeof pack.lunaProductId === "string" && /^\d+$/.test(pack.lunaProductId) &&
    typeof pack.lunaVariantId === "string" && /^\d+$/.test(pack.lunaVariantId)
  const sourcesProven = references.length > 0 && references.every(r => typeof r.sha256 === "string" && /^[a-f0-9]{64}$/.test(r.sha256) &&
    (r.authority === "OFFICIAL_EBAY_CURRENT_LISTING_IMAGE" && r.referenceId === `EBAY_ITEM_${task.ebay_item_id}` ||
      ownSourcePack && ["AUTHORIZED_LUNA_SOURCE_PACK", "APPROVED_CANONICAL_LISTING_ASSET", "SAVED_AUTHORIZED_GENERATOR_SOURCE"].includes(String(r.authority))))
  const gallery = record(signal.currentOfficialGallery)
  const decision = authorizeOptimizationV1({ grant, accountKey: input.accountKey,
    actions: intents.map(i => i.visualIntent === "REPLACE_MAIN" ? "MAIN_IMAGE_REPLACEMENT" :
      i.visualIntent === "REPLACE_SLOT" ? "SECONDARY_IMAGE_REPLACEMENT" : i.visualIntent === "ADD_SECONDARY" ? "IMAGE_ADDITION" : "UNSUPPORTED"),
    guards: {
      exactListingIdentity: task.marketplace_account_key === input.accountKey && manifest.ebayItemId === task.ebay_item_id && manifest.visualTaskId === task.id,
      productTruthProven: signal.productTruthSupported === true,
      currentLiveReadbackPass: gallery.authority === "CURRENT_OFFICIAL_ORDERED_IMAGE_SET" && Array.isArray(gallery.images),
      baseGenerationCompatible: compatible && stableOutboxJsonV1(gallery.images) === stableOutboxJsonV1(task.current_image_set),
      qaPass: proposed.some(e => e.assetId) && proposed.every(e => !e.assetId || assets.some(a => a.id === e.assetId &&
        a.output_sha256 === e.outputSha256 && a.public_url === e.publicUrl && delegatedVisualQaV1(a, task))),
      unsupportedClaimCount: assets.length > 0 && assets.every(a => delegatedVisualQaV1(a, task)) ? 0 : null,
      competitorContaminationCount: sourcesProven ? 0 : null,
    } })
  return { ...decision, grant, proposed }
}

/** Called by the existing bounded runtime. This creates one immutable intent;
 * it never impersonates a per-asset OWNER confirmation or calls an eBay write. */
export async function enqueueDelegatedVisualV1(input: { supabase: SupabaseClient; accountKey: string; taskId: string }) {
  const t = await input.supabase.from("ebay_mayel_visual_tasks_v1")
    .select("id,marketplace_account_key,ebay_item_id,assigned_operator_user_id,status,visual_manifest_id,visual_manifest,visual_manifest_digest,source_image_set_digest,product_truth_digest,current_image_set,selection_signal,source_image_references,evidence_pack,created_at")
    .eq("id", input.taskId).eq("marketplace_account_key", input.accountKey).maybeSingle()
  if (t.error || !t.data) throw Error("MAYEL_OPTIMIZATION_TASK_REQUIRED")
  const task = t.data
  const a = await input.supabase.from("ebay_listing_image_assets")
    .select("id,status,mayel_approval_status,qa_result,source_sha256,output_sha256,public_url,source_image_set_digest,product_truth_digest")
    .eq("account_key", input.accountKey).eq("mayel_visual_task_id", task.id).eq("status", "approved").limit(7)
  if (a.error || !a.data?.length || a.data.length > 6) throw Error("MAYEL_OPTIMIZATION_ASSETS_REQUIRED")
  const authority = await readDelegatedVisualAuthorityV1({ ...input, task, assets: a.data })
  if (!authority.authorized || !authority.grant) return { status: "REQUIRES_ATTENTION", reason: authority.reason, receipt: null }
  const { saveDurableOutboxV1 } = await import("./ipad-durable-outbox-v1")
  const idempotencyKey = `ipados:v1:${createHash("sha256").update(`${input.accountKey}:${task.id}:${task.visual_manifest_digest}:${MAYEL_OPTIMIZATION_DELEGATION_V1}`).digest("hex")}`
  const receipt = await saveDurableOutboxV1({ ...input, actorUserId: task.assigned_operator_user_id,
    delegationId: authority.grant.id, intent: { version: IPAD_OUTBOX_VERSION, kind: "IMAGE_SYNC", itemId: task.ebay_item_id,
      listingTitle: "Mejora visual", generationId: task.visual_manifest_id, createdAt: task.created_at,
      baseVersionHash: task.source_image_set_digest, baseObservedAt: null, idempotencyKey,
      requestedChanges: { taskId: task.id, assetId: authority.proposed.find(e => e.assetId)!.assetId, manifestDigest: task.visual_manifest_digest } } })
  return { status: "AUTO_AUTHORIZED_BY_OWNER_DELEGATION", reason: null, receipt }
}
