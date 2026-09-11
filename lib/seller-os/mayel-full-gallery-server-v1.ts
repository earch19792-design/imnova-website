import { excludeDiscardedProposalsV1 } from "./mayel-proposal-discard-v1"
import { semanticRemovalReviewMatchesV1, type RemovalReviewV1 } from "./mayel-semantic-removal-v1"
import { cachedTradingNextSafeProbeAtV1 } from "../ebay/ebay-trading-rate-limit-observability-v1"
import { nextOutboxAttemptAtV1, outboxTransientFailureV1 } from "./ipad-outbox-contract-v1"
import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { buildFullGalleryMutationV1, type GalleryDecisionV1 } from "./mayel-full-gallery-mutation-v1"
import { readOptimizationGrantV1, readDelegatedVisualAuthorityV1, withGalleryRemovalGrantV1 } from "./mayel-optimization-delegation-server-v1"
import { optimizationGrantActiveV1, delegatedVisualQaV1 } from "./mayel-optimization-delegation-v1"
import { ebayOfficialImageSetDigestV1 } from "../ebay/ebay-mayel-visual-phase-b-v1"
import { readCurrentMayelGalleryV1 } from "../ebay/mayel-current-gallery-server-v1"
import { mayelVisualDigestV1, type MayelVisualOutputRole } from "../ebay/ebay-mayel-visual-workstation-v1"

const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}

/** A semantic review is loaded from the private durable authority, never from
 * request flags. The existing identical-evidence proof remains supported. */
export function provenGalleryRemovalsV1(task: Record<string, unknown>, decisions: readonly GalleryDecisionV1[], current: readonly string[],
  reviews: readonly RemovalReviewV1[] = [], finalImages: readonly string[] = []) {
  const refs = Array.isArray(task.source_image_references) ? task.source_image_references.map(record) : []
  const shaFor = (url: string) => refs.find(r => r.url === url && typeof r.sha256 === "string" && /^[a-f0-9]{64}$/.test(r.sha256))?.sha256
  return decisions.filter(d => d.action === "REMOVE").every(d => {
    if (d.removalEvidence?.reviewId) return reviews.some(review => semanticRemovalReviewMatchesV1({
      review, task, decision: d, currentImages: current, finalImages }))
    const sha = shaFor(current[d.sourcePosition!])
    return Boolean(sha && d.removalEvidence?.productTruthDigest === task.product_truth_digest &&
      d.removalEvidence?.evidenceReferences.some(url => shaFor(url) === sha && decisions.some(k =>
        ["KEEP", "REORDER"].includes(k.action) && current[k.sourcePosition!] === url)))
  })
}

/** Authenticated Mayel/operator decision, not OWNER approval. The full mutation
 * is prepared durably; only the existing outbox runtime can dispatch it. */
export async function saveFullMayelGalleryV1(input: { supabase: SupabaseClient; accountKey: string; actorUserId: string;
  taskId: string; expectedManifestDigest: string | null; expectedCurrentImages: string[]; decisions: GalleryDecisionV1[]; readGallery?: typeof readCurrentMayelGalleryV1 }): Promise<Record<string, unknown>> {
  const t = await input.supabase.from("ebay_mayel_visual_tasks_v1")
    .select("id,ebay_item_id,marketplace_account_key,assigned_operator_user_id,status,visual_manifest_id,visual_manifest_digest,visual_manifest,current_image_set,selection_signal,source_image_references,evidence_pack,product_truth_digest,source_image_set_digest")
    .eq("id", input.taskId).eq("marketplace_account_key", input.accountKey).maybeSingle()
  let grant = await readOptimizationGrantV1(input.supabase, input.accountKey)
  if (!optimizationGrantActiveV1(grant, input.accountKey) || !grant) throw Error("ACTIVE_DELEGATION_REQUIRED")
  if (t.error || !t.data || ![grant.owner_user_id, t.data.assigned_operator_user_id].includes(input.actorUserId) || t.data.status === "CANCELLED")
    throw Error("EXACT_VISUAL_TASK_REQUIRED")
  const task = t.data
  const replayGeneration = mayelVisualDigestV1({ taskId: task.id, account: input.accountKey,
    base: ebayOfficialImageSetDigestV1(input.expectedCurrentImages), decisions: input.decisions })
  if (record(task.visual_manifest).galleryMutationContract === "MAYEL_FULL_GALLERY_MUTATION_V1" && record(task.visual_manifest).generation === replayGeneration)
    return { status: "ALREADY_PREPARED", manifest: task.visual_manifest, marketplaceWrites: 0 }
  if (task.visual_manifest_digest !== input.expectedManifestDigest) throw Error("MAYEL_VISUAL_REBASE_STALE_PREVIEW")
  const storedPending = record(record(task.selection_signal).pendingGalleryDecision)
  if (storedPending.generation === replayGeneration && Date.parse(String(storedPending.nextAttemptAt)) > Date.now())
    return { status: "WAITING_FOR_DATA", nextAttemptAt: storedPending.nextAttemptAt, marketplaceWrites: 0 }
  const pending = await input.supabase.from("seller_os_ipad_outbox_v1").select("id")
    .eq("account_key", input.accountKey).eq("item_id", task.ebay_item_id).eq("kind", "IMAGE_SYNC")
    .not("state", "in", "(SYNCED,REQUIRES_ATTENTION,SUPERSEDED)").limit(1).maybeSingle()
  if (pending.error || pending.data) throw Error("CURRENT_GALLERY_INTENT_PENDING")
  const a = await excludeDiscardedProposalsV1(input.supabase.from("ebay_listing_image_assets")
    .select("id,mayel_output_role,output_sha256,public_url,status,mayel_approval_status,qa_result,product_truth_digest,source_image_set_digest")
    .eq("account_key", input.accountKey).eq("mayel_visual_task_id", input.taskId).eq("status", "approved").limit(7), task.selection_signal)
  if (a.error || (a.data?.length ?? 0) > 6) throw Error("CANONICAL_ASSET_READ_FAILED")
  const assets = a.data ?? []
  for (const d of input.decisions.filter(d => d.assetId)) {
    const asset = assets.find(a => a.id === d.assetId)
    if (!asset || !delegatedVisualQaV1(asset, task)) throw Error("PRODUCT_TRUTH_SEMANTIC_QA_REQUIRED")
  }
  if (input.decisions.some(d => d.action === "REMOVE")) grant = await withGalleryRemovalGrantV1(input.supabase, grant)
  // Validate shape and asset binding before persisting a resumable decision.
  const planned = buildFullGalleryMutationV1({ visualTaskId: task.id, ebayItemId: task.ebay_item_id, accountKey: input.accountKey,
    generation: replayGeneration, currentImages: input.expectedCurrentImages, decisions: input.decisions,
    assets: assets.map(a => ({ assetId: a.id, role: a.mayel_output_role as MayelVisualOutputRole, outputSha256: a.output_sha256, publicUrl: a.public_url })),
    productTruthDigest: task.product_truth_digest, sourceImageSetDigest: task.source_image_set_digest })
  const reviewIds = [...new Set(input.decisions.filter(d => d.action === "REMOVE")
    .flatMap(d => d.removalEvidence?.reviewId ? [d.removalEvidence.reviewId] : []))]
  const reviews = reviewIds.length ? await input.supabase.from("seller_os_mayel_removal_reviews_v1")
    .select("id,account_key,task_id,item_id,product_truth_digest,source_image_set_digest,base_manifest_digest,current_images,final_images,source_position,reason,evidence_references,checks,revoked_at")
    .eq("account_key", input.accountKey).eq("task_id", input.taskId).in("id", reviewIds).limit(24)
    : { data: [], error: null }
  if (reviews.error || !provenGalleryRemovalsV1(task, input.decisions, input.expectedCurrentImages,
    (reviews.data ?? []) as RemovalReviewV1[], planned.proposedOrderedImages.map(e => e.publicUrl)))
    throw Error("REMOVAL_PRODUCT_EVIDENCE_UNPROVEN")
  if (JSON.stringify(planned.proposedOrderedImages.map(e => e.publicUrl)) === JSON.stringify(input.expectedCurrentImages))
    return { status: "NO_GALLERY_CHANGE", marketplaceWrites: 0 }
  const pendingDecision = { contract: "MAYEL_PENDING_FULL_GALLERY_DECISION_V1", state: "WAITING_FOR_CURRENT_GALLERY",
    actorUserId: input.actorUserId, expectedManifestDigest: input.expectedManifestDigest,
    expectedCurrentImages: input.expectedCurrentImages, decisions: input.decisions, generation: replayGeneration, writeAuthority: false }
  const savePending = async (state: string, reason: string | null = null, nextAttemptAt: string | null = null) => {
    const prior = record(record(task.selection_signal).pendingGalleryDecision)
    if (prior.generation === replayGeneration && prior.state === state && prior.reason === reason && prior.nextAttemptAt === nextAttemptAt) return
    let q = input.supabase.from("ebay_mayel_visual_tasks_v1").update({ selection_signal: {
      ...record(task.selection_signal), pendingGalleryDecision: { ...pendingDecision, state, reason, nextAttemptAt } } })
      .eq("id", task.id).eq("marketplace_account_key", input.accountKey)
    q = input.expectedManifestDigest ? q.eq("visual_manifest_digest", input.expectedManifestDigest) : q.is("visual_manifest_digest", null)
    const r = await q.select("id").maybeSingle()
    if (r.error || !r.data) throw Error("GALLERY_GENERATION_CHANGED")
  }
  // Persist the decision before depending on eBay availability. It grants no
  // mutation authority; the existing bounded discovery resumes this same task.
  await savePending("WAITING_FOR_CURRENT_GALLERY")
  let gallery: Awaited<ReturnType<typeof readCurrentMayelGalleryV1>>
  try { gallery = await (input.readGallery ?? readCurrentMayelGalleryV1)({ ...input, itemId: task.ebay_item_id }) }
  catch (error) {
    const reason = error instanceof Error ? error.message : "TEMPORARY_UPSTREAM_FAILURE"
    const transient = outboxTransientFailureV1(reason)
    await savePending(transient ? "WAITING_FOR_CURRENT_GALLERY" : "REQUIRES_ATTENTION", reason, transient ? nextOutboxAttemptAtV1(cachedTradingNextSafeProbeAtV1()) : null)
    return { status: transient ? "WAITING_FOR_DATA" : "REQUIRES_ATTENTION", reason, marketplaceWrites: 0 }
  }
  if (!gallery) {
    await savePending("WAITING_FOR_CURRENT_GALLERY", "WAITING_FOR_EBAY", nextOutboxAttemptAtV1(cachedTradingNextSafeProbeAtV1()))
    return { status: "WAITING_FOR_DATA", marketplaceWrites: 0 }
  }
  if (JSON.stringify(gallery.images) !== JSON.stringify(input.expectedCurrentImages)) {
    await savePending("REQUIRES_ATTENTION", "CURRENT_GALLERY_CHANGED")
    return { status: "REQUIRES_ATTENTION", reason: "CURRENT_GALLERY_CHANGED", marketplaceWrites: 0 }
  }
  const generation = mayelVisualDigestV1({ taskId: task.id, account: input.accountKey, base: gallery.digest, decisions: input.decisions })
  const manifest = buildFullGalleryMutationV1({ visualTaskId: task.id, ebayItemId: task.ebay_item_id, accountKey: input.accountKey,
    generation, currentImages: gallery.images, decisions: input.decisions,
    assets: assets.map(a => ({ assetId: a.id, role: a.mayel_output_role as MayelVisualOutputRole, outputSha256: a.output_sha256, publicUrl: a.public_url })),
    productTruthDigest: task.product_truth_digest, sourceImageSetDigest: task.source_image_set_digest })
  const signal = { ...record(task.selection_signal) }; delete signal.pendingGalleryDecision
  const next = { ...task, status: "OWNER_PREVIEW_READY", visual_manifest: manifest, current_image_set: gallery.images,
    selection_signal: { ...signal, currentOfficialGallery: gallery } }
  const newAssets = manifest.proposedOrderedImages.some(e => e.assetId)
  if (newAssets) {
    const permission = await readDelegatedVisualAuthorityV1({ ...input, task: next, assets, grant })
    if (!permission.authorized) {
      await savePending("REQUIRES_ATTENTION", permission.reason ?? "GALLERY_DELEGATION_REQUIRED")
      return { status: "REQUIRES_ATTENTION", reason: permission.reason, marketplaceWrites: 0 }
    }
  } else {
    if (!grant || manifest.galleryActions.some(a => !grant.allowed_actions.includes(a))) throw Error("GALLERY_DELEGATION_REQUIRED")
  }
  if (manifest.visualManifestDigest === task.visual_manifest_digest) return { status: "ALREADY_PREPARED", manifest, marketplaceWrites: 0 }
  let save = input.supabase.from("ebay_mayel_visual_tasks_v1").update({ visual_manifest: manifest,
    visual_manifest_digest: manifest.visualManifestDigest, current_image_set: gallery.images,
    selection_signal: next.selection_signal, status: "OWNER_PREVIEW_READY", updated_at: new Date().toISOString() })
    .eq("id", task.id).eq("marketplace_account_key", input.accountKey)
  save = input.expectedManifestDigest ? save.eq("visual_manifest_digest", input.expectedManifestDigest) : save.is("visual_manifest_digest", null)
  const saved = await save.select("id").maybeSingle()
  if (saved.error || !saved.data) throw Error("GALLERY_GENERATION_CHANGED")
  if (!newAssets) {
    const { enqueueMayelGalleryReorderV1 } = await import("./mayel-autonomous-content-server-v1")
    return { status: "GALLERY_PREPARED", manifest, handoff: await enqueueMayelGalleryReorderV1({ ...input,
      expectedManifestDigest: manifest.visualManifestDigest, after: manifest.proposedOrderedImages.map(e => e.publicUrl), galleryMutation: manifest }), marketplaceWrites: 0 }
  }
  const { enqueueDelegatedVisualV1 } = await import("./mayel-optimization-delegation-server-v1")
  return { status: "GALLERY_PREPARED", manifest, handoff: await enqueueDelegatedVisualV1(input), marketplaceWrites: 0 }
}
