import { validateMayelHumanQaV1, type MayelVisualOutputRole } from "../ebay/ebay-mayel-visual-workstation-v1"
import "server-only"
import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { authorizeOptimizationV1, delegatedVisualQaV1, MAYEL_OPTIMIZATION_DELEGATION_V1, type OptimizationGrantV1 } from "./mayel-optimization-delegation-v1"
import { stableOutboxJsonV1, IPAD_OUTBOX_VERSION } from "./ipad-outbox-contract-v1"
import { visualIntentOrderV1 } from "./mayel-visual-intent-v1"
import { FULL_GALLERY_MUTATION_V1, fullGalleryManifestMatchesV1, type GalleryDecisionV1 } from "./mayel-full-gallery-mutation-v1"

export async function readOptimizationGrantV1(supabase: SupabaseClient, accountKey: string) {
  const r = await supabase.from("seller_os_mayel_optimization_grants_v1")
    .select("id,account_key,owner_user_id,contract_version,scope,status,revoked_at,authority_digest,allowed_actions")
    .eq("account_key", accountKey).eq("status", "ACTIVE").is("revoked_at", null).limit(1).maybeSingle()
  if (r.error) throw Error("MAYEL_OPTIMIZATION_GRANT_READ_FAILED")
  return r.data as OptimizationGrantV1 | null
}
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}
export async function withGalleryRemovalGrantV1(supabase: SupabaseClient, grant: OptimizationGrantV1 | null) {
  if (!grant) return null
  const r = await supabase.from("seller_os_mayel_gallery_removal_grants_v1").select("id")
    .eq("grant_id", grant.id).eq("account_key", grant.account_key).eq("owner_user_id", grant.owner_user_id)
    .is("revoked_at", null).limit(1).maybeSingle()
  if (r.error) throw Error("GALLERY_REMOVAL_AUTHORITY_READ_FAILED")
  return r.data ? { ...grant, allowed_actions: [...grant.allowed_actions, "IMAGE_REMOVAL"] } : grant
}
export async function readDelegatedVisualAuthorityV1(input: { supabase: SupabaseClient; accountKey: string;
  task: Record<string, unknown>; assets: Record<string, unknown>[]; grant?: OptimizationGrantV1 | null }) {
  const { task, assets } = input
  let grant = input.grant === undefined ? await readOptimizationGrantV1(input.supabase, input.accountKey) : input.grant
  const manifest = record(task.visual_manifest), signal = record(task.selection_signal)
  const proposed = Array.isArray(manifest.proposedOrderedImages) ? manifest.proposedOrderedImages.map(record) : []
  const participatingAssets = assets.filter(a => proposed.some(e => e.assetId === a.id))
  const intents = Array.isArray(manifest.visualIntents) ? manifest.visualIntents.map(record) : []
  const fullGallery = manifest.galleryMutationContract === FULL_GALLERY_MUTATION_V1
  const galleryActions = fullGallery && Array.isArray(manifest.galleryActions) ? manifest.galleryActions.map(String) : []
  if (galleryActions.includes("IMAGE_REMOVAL")) grant = await withGalleryRemovalGrantV1(input.supabase, grant)
  let compatible = false
  try {
    const order = visualIntentOrderV1(task.current_image_set as string[], intents as unknown as import("./mayel-visual-intent-v1").VisualIntentV1[])
    compatible = order.length === proposed.length && order.every((e, i) => e.kind === "MAYEL_ASSET"
      ? e.assetId === proposed[i].assetId : e.publicUrl === proposed[i].publicUrl)
  } catch { /* Malformed or implicit changes never gain delegation authority. */ }
  if (fullGallery) compatible = fullGalleryManifestMatchesV1({ visualTaskId: String(task.id), ebayItemId: String(task.ebay_item_id),
    accountKey: input.accountKey, generation: String(manifest.generation), currentImages: task.current_image_set as string[],
    assets: assets.map(a => ({ assetId: String(a.id), role: String(a.mayel_output_role) as import("../ebay/ebay-mayel-visual-workstation-v1").MayelVisualOutputRole,
      outputSha256: String(a.output_sha256), publicUrl: String(a.public_url) })),
    decisions: manifest.galleryDecisions as GalleryDecisionV1[], productTruthDigest: String(task.product_truth_digest),
    sourceImageSetDigest: String(task.source_image_set_digest) }, manifest)
  if (fullGallery) {
    if (participatingAssets.some(a => !validateMayelHumanQaV1(record(record(a.qa_result).humanReview).checks, a.mayel_output_role as MayelVisualOutputRole))) compatible = false
    if (galleryActions.includes("IMAGE_REMOVAL")) {
      const { provenGalleryRemovalsV1 } = await import("./mayel-full-gallery-server-v1")
      if (!provenGalleryRemovalsV1(task, manifest.galleryDecisions as GalleryDecisionV1[], task.current_image_set as string[])) compatible = false
    }
  }
  const references = Array.isArray(task.source_image_references) ? task.source_image_references.map(record) : []
  const pack = record(task.evidence_pack)
  const ownSourcePack = stableOutboxJsonV1(pack.sourceImageSet) === stableOutboxJsonV1(task.source_image_references) &&
    typeof pack.lunaProductId === "string" && /^\d+$/.test(pack.lunaProductId) &&
    typeof pack.lunaVariantId === "string" && /^\d+$/.test(pack.lunaVariantId)
  const sourcesProven = references.length > 0 && references.every(r => typeof r.sha256 === "string" && /^[a-f0-9]{64}$/.test(r.sha256) &&
    (r.authority === "OFFICIAL_EBAY_CURRENT_LISTING_IMAGE" && r.referenceId === `EBAY_ITEM_${task.ebay_item_id}` ||
      ownSourcePack && ["AUTHORIZED_LUNA_SOURCE_PACK", "APPROVED_CANONICAL_LISTING_ASSET", "SAVED_AUTHORIZED_GENERATOR_SOURCE"].includes(String(r.authority))))
  let productTruthProof: Record<string, unknown> | null = null
  if (grant && signal.productTruthSupported !== true && task.status === "OWNER_PREVIEW_READY" && proposed.some(e => e.assetId)) {
    const proof = await input.supabase.rpc("seller_os_read_visual_current_product_truth_v1", { p_account_key: input.accountKey, p_task_id: task.id })
    if (proof.error) throw Error("MAYEL_CURRENT_PRODUCT_TRUTH_READ_FAILED")
    const value = record(proof.data)
    if (value.authority === "EXACT_LIVE_LINKED_PRODUCT_TRUTH_V1" && value.taskId === task.id &&
        value.itemId === task.ebay_item_id && value.accountKey === input.accountKey && value.visualSourceDigest === task.source_image_set_digest)
      productTruthProof = value
  }
  const gallery = record(signal.currentOfficialGallery)
  const decision = authorizeOptimizationV1({ grant, accountKey: input.accountKey,
    actions: fullGallery ? galleryActions : intents.map(i => i.visualIntent === "REPLACE_MAIN" ? "MAIN_IMAGE_REPLACEMENT" :
      i.visualIntent === "REPLACE_SLOT" ? "SECONDARY_IMAGE_REPLACEMENT" : i.visualIntent === "ADD_SECONDARY" ? "IMAGE_ADDITION" : "UNSUPPORTED"),
    guards: {
      exactListingIdentity: task.marketplace_account_key === input.accountKey && manifest.ebayItemId === task.ebay_item_id && manifest.visualTaskId === task.id,
      productTruthProven: signal.productTruthSupported === true || productTruthProof !== null,
      currentLiveReadbackPass: gallery.authority === "CURRENT_OFFICIAL_ORDERED_IMAGE_SET" && Array.isArray(gallery.images),
      baseGenerationCompatible: compatible && stableOutboxJsonV1(gallery.images) === stableOutboxJsonV1(task.current_image_set),
      qaPass: proposed.some(e => e.assetId) && proposed.every(e => !e.assetId || assets.some(a => a.id === e.assetId &&
        a.output_sha256 === e.outputSha256 && a.public_url === e.publicUrl && delegatedVisualQaV1(a, task))),
      unsupportedClaimCount: participatingAssets.length > 0 && participatingAssets.every(a => delegatedVisualQaV1(a, task)) ? 0 : null,
      competitorContaminationCount: sourcesProven ? 0 : null,
    } })
  return { ...decision, grant, proposed, productTruthProof }
}

/** Called by the existing bounded runtime. This creates one immutable intent;
 * it never impersonates a per-asset OWNER confirmation or calls an eBay write. */
export async function enqueueDelegatedVisualV1(input: { supabase: SupabaseClient; accountKey: string; taskId: string }) {
  const t = await input.supabase.from("ebay_mayel_visual_tasks_v1")
    .select("id,marketplace_account_key,ebay_item_id,assigned_operator_user_id,status,visual_manifest_id,visual_manifest,visual_manifest_digest,source_image_set_digest,product_truth_digest,current_image_set,selection_signal,source_image_references,evidence_pack,created_at")
    .eq("id", input.taskId).eq("marketplace_account_key", input.accountKey).maybeSingle()
  if (t.error || !t.data) throw Error("MAYEL_OPTIMIZATION_TASK_REQUIRED")
  const task = t.data
  const pendingManifest = record(task.visual_manifest)
  if (pendingManifest.galleryMutationContract === FULL_GALLERY_MUTATION_V1 && Array.isArray(pendingManifest.proposedOrderedImages) &&
      pendingManifest.proposedOrderedImages.every(e => !record(e).assetId)) {
    const { enqueueMayelGalleryReorderV1 } = await import("./mayel-autonomous-content-server-v1")
    const handoff = await enqueueMayelGalleryReorderV1({ ...input, actorUserId: task.assigned_operator_user_id,
      expectedManifestDigest: task.visual_manifest_digest, after: pendingManifest.proposedOrderedImages.map(e => String(record(e).publicUrl)),
      galleryMutation: pendingManifest })
    return { status: handoff.status, reason: null, receipt: null }
  }
  const a = await input.supabase.from("ebay_listing_image_assets")
    .select("id,status,mayel_output_role,mayel_approval_status,qa_result,source_sha256,output_sha256,public_url,source_image_set_digest,product_truth_digest")
    .eq("account_key", input.accountKey).eq("mayel_visual_task_id", task.id).eq("status", "approved").limit(7)
  if (a.error || !a.data?.length || a.data.length > 6) throw Error("MAYEL_OPTIMIZATION_ASSETS_REQUIRED")
  let authority = await readDelegatedVisualAuthorityV1({ ...input, task, assets: a.data })
  if (authority.grant && authority.reason === "CURRENT_LIVE_READBACK_REQUIRED") {
    // Existing quota gate and exact management-aware readback. No new poller.
    const { readMayelVisualPhaseBPreviewV1 } = await import("../ebay/ebay-mayel-visual-phase-b-server-v1")
    const preview = await readMayelVisualPhaseBPreviewV1(input)
    if (preview.officialReadStatus !== "PASS" || !preview.accountIdentityProven || !preview.listingIdentityProven ||
        !preview.currentImageSetProven || preview.officialReadAuthority === "EBAY_BROWSE_GET_ITEM_BY_LEGACY_ID_V1")
      return { status: "WAITING_FOR_DATA", reason: preview.blocker, receipt: null }
    const selectionSignal = { ...record(task.selection_signal), currentOfficialGallery: {
      authority: "CURRENT_OFFICIAL_ORDERED_IMAGE_SET", images: preview.currentImages,
      digest: preview.currentOfficialImageSetDigest, observedAt: preview.officialObservedAt,
      managementModel: preview.managementModel } }
    const saved = await input.supabase.from("ebay_mayel_visual_tasks_v1").update({ selection_signal: selectionSignal })
      .eq("id", task.id).eq("marketplace_account_key", input.accountKey).eq("visual_manifest_digest", task.visual_manifest_digest)
      .select("id").maybeSingle()
    if (saved.error || !saved.data) throw Error("MAYEL_GALLERY_OBSERVATION_SAVE_FAILED")
    task.selection_signal = selectionSignal
    authority = await readDelegatedVisualAuthorityV1({ ...input, task, assets: a.data })
  }
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
