import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { keywordRecord as record, keywordWireDigestV1 as digest, readKeywordDecisionHandoffV1 } from "./keyword-intelligence-handoff-v1"
import { prepareMayelOwnContentV1, mayelContentDiffV1, type MayelLiveContentV1 } from "./mayel-autonomous-content-v1"
import { readOptimizationGrantV1 } from "./mayel-optimization-delegation-server-v1"
import { authorizeOptimizationV1, optimizationGrantActiveV1 } from "./mayel-optimization-delegation-v1"
import { executeOutboxOperationV1 } from "./ipad-sync-engine-v1"
import { getEbayProRuntimeBoundary } from "../ebay/environment-boundaries"
import { galleryReorderDecisionV1 } from "./mayel-gallery-reorder-v1"

const TABLE = "seller_os_mayel_content_outbox_v1"
type Input = { supabase: SupabaseClient; accountKey: string; taskId: string }
export async function enqueueMayelGalleryReorderV1(input: Input & { actorUserId: string; expectedManifestDigest: string; after: string[] }) {
  const grant = await readOptimizationGrantV1(input.supabase, input.accountKey)
  if (!grant || !optimizationGrantActiveV1(grant, input.accountKey) || !grant.allowed_actions.includes("IMAGE_REORDER")) throw Error("OWNER_DELEGATION_REQUIRED")
  const t = await input.supabase.from("ebay_mayel_visual_tasks_v1").select("id,ebay_item_id,assigned_operator_user_id,visual_manifest_digest")
    .eq("id", input.taskId).eq("marketplace_account_key", input.accountKey).maybeSingle()
  if (t.error || !t.data || t.data.visual_manifest_digest !== input.expectedManifestDigest ||
      ![t.data.assigned_operator_user_id, grant.owner_user_id].includes(input.actorUserId)) throw Error("DELEGATED_VISUAL_SCOPE_CHANGED")
  const pr = await input.supabase.rpc("seller_os_read_visual_current_product_truth_v1", { p_account_key: input.accountKey, p_task_id: input.taskId })
  const proof = record(pr.data)
  if (pr.error || proof.taskId !== input.taskId || proof.accountKey !== input.accountKey || proof.itemId !== t.data.ebay_item_id ||
      proof.authority !== "EXACT_LIVE_LINKED_PRODUCT_TRUTH_V1") throw Error("PRODUCT_TRUTH_REQUIRED")
  const { collectSellerOsEbayTradingRateLimitStatusV1 } = await import("../ebay/ebay-trading-rate-limit-observability-v1")
  if ((await collectSellerOsEbayTradingRateLimitStatusV1()).gateState !== "OPEN") return { status: "WAITING_FOR_EBAY", id: null }
  const { readMayelContentLiveV1 } = await import("../ebay/ebay-mayel-content-executor-v1")
  const current = await readMayelContentLiveV1({ accountKey: input.accountKey, itemId: t.data.ebay_item_id, sku: String(proof.sku) })
  const decision = galleryReorderDecisionV1(current.galleryUrls, input.after)
  if (!decision.changed) return { status: "ALREADY_OPTIMIZED", id: null }
  const sourceDigest = digest({ proof, beforeGallery: decision.beforeGallery, afterGallery: decision.afterGallery })
  const key = digest({ accountKey: input.accountKey, itemId: proof.itemId, sourceDigest, kind: "GALLERY_REORDER" })
  const prior = await input.supabase.from(TABLE).select("id,state").eq("account_key", input.accountKey).eq("idempotency_key", key).maybeSingle()
  if (prior.error) throw Error("CONTENT_OUTBOX_READ_FAILED")
  if (prior.data) return { status: prior.data.state, id: prior.data.id }
  const audit = { ...decision, proof, categoryId: current.categoryId, before: current.content, after: current.content, patch: {},
    protectedBefore: current.protectedFields, inventoryBefore: current.inventoryPreserved, currentLiveReadbackAt: current.observedAt,
    managementModel: current.management.managementModel, mayelDecision: "AUTO_AUTHORIZED_BY_OWNER_DELEGATION", grantDigest: grant.authority_digest,
    evidenceUsed: { authority: "CURRENT_OFFICIAL_ORDERED_IMAGE_SET", observedAt: current.observedAt, productTruth: proof } }
  const saved = await input.supabase.from(TABLE).insert({ account_key: input.accountKey, item_id: proof.itemId, task_id: input.taskId,
    grant_id: grant.id, idempotency_key: key, source_digest: sourceDigest, base_hash: current.baseHash, audit }).select("id,state").maybeSingle()
  if (saved.error || !saved.data) {
    const raced = await input.supabase.from(TABLE).select("id,state").eq("account_key", input.accountKey).eq("idempotency_key", key).maybeSingle()
    if (raced.error || !raced.data) throw Error("CONTENT_OUTBOX_HANDOFF_FAILED")
    return { status: raced.data.state, id: raced.data.id }
  }
  return { status: saved.data.state, id: saved.data.id }
}
export async function readMayelOwnContentEvidenceV1(input: Input) {
  const proofRead = await input.supabase.rpc("seller_os_read_visual_current_product_truth_v1", { p_account_key: input.accountKey, p_task_id: input.taskId })
  if (proofRead.error) throw Error("OPTIMIZATION_PRODUCT_TRUTH_READ_FAILED")
  const proof = record(proofRead.data)
  if (proof.authority !== "EXACT_LIVE_LINKED_PRODUCT_TRUTH_V1" || proof.accountKey !== input.accountKey || proof.taskId !== input.taskId)
    return null
  const p = await input.supabase.from("ebay_listing_packages").select("id,account_key,opportunity_id,candidate_key,category:package_data->categoryResolverV1,ownPrice:package_data->pricing->targetPrice")
    .eq("account_key", input.accountKey).eq("id", proof.packageId).maybeSingle()
  if (p.error || !p.data) throw Error("OPTIMIZATION_OWN_PACKAGE_REQUIRED")
  const q = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,truthFields:assessment->productTruth->fieldTruthV1->fields,requiredTruth:assessment->canonicalMarketplaceReadinessV1->requiredItemSpecificsTruth,aspectResolutions:assessment->marketplaceRequiredSpecificsBatchResolutionV1->resolutions")
    .eq("id", p.data.opportunity_id).eq("candidate_key", p.data.candidate_key).maybeSingle()
  if (q.error || !q.data) throw Error("OPTIMIZATION_OWN_PRODUCT_REQUIRED")
  const own = record(q.data)
  if (String(own.supplier_product_id) !== proof.productId || String(own.supplier_variant_id) !== proof.variantId) return null
  const binding = { ACCOUNT_KEY: input.accountKey, PRODUCT_ID: String(proof.productId), VARIANT_ID: String(proof.variantId),
    CANDIDATE_KEY: String(p.data.candidate_key), OPPORTUNITY_ID: String(p.data.opportunity_id) }
  const keywordRead = await readKeywordDecisionHandoffV1({ supabase: input.supabase, binding })
  const result = prepareMayelOwnContentV1({ binding, packageId: p.data.id, category: p.data.category,
    truthFields: own.truthFields, requiredTruth: own.requiredTruth, aspectResolutions: own.aspectResolutions,
    keywordRead, ownPrice: p.data.ownPrice, now: new Date() })
  return result.proposal ? { ...result.proposal, proof } : null
}

export async function enqueueMayelContentOptimizationV1(input: Input) {
  const grant = await readOptimizationGrantV1(input.supabase, input.accountKey)
  if (!optimizationGrantActiveV1(grant, input.accountKey) || !grant) return { status: "DELEGATION_REQUIRED", id: null }
  const proposal = await readMayelOwnContentEvidenceV1(input)
  if (!proposal) return { status: "WAITING_FOR_DATA", id: null }
  const key = digest({ account: input.accountKey, item: proposal.proof.itemId, source: proposal.sourceDigest })
  const prior = await input.supabase.from(TABLE).select("id,state").eq("account_key", input.accountKey).eq("idempotency_key", key).maybeSingle()
  if (prior.error) throw Error("CONTENT_OUTBOX_READ_FAILED")
  if (prior.data) return { status: prior.data.state, id: prior.data.id }
  const pending = await input.supabase.from(TABLE).select("id").eq("account_key", input.accountKey).eq("item_id", proposal.proof.itemId)
    .not("state", "in", "(SYNCED,REQUIRES_ATTENTION)").limit(1).maybeSingle()
  if (pending.error) throw Error("CONTENT_PENDING_READ_FAILED")
  if (pending.data) return { status: "PENDING_EBAY_SYNC", id: pending.data.id }
  const { collectSellerOsEbayTradingRateLimitStatusV1 } = await import("../ebay/ebay-trading-rate-limit-observability-v1")
  const quota = await collectSellerOsEbayTradingRateLimitStatusV1()
  if (quota.gateState !== "OPEN") return { status: "WAITING_FOR_EBAY", id: null }
  const { readMayelContentLiveV1 } = await import("../ebay/ebay-mayel-content-executor-v1")
  const current = await readMayelContentLiveV1({ accountKey: input.accountKey, itemId: String(proposal.proof.itemId), sku: String(proposal.proof.sku) })
  if (current.categoryId !== proposal.categoryId) return { status: "REQUIRES_ATTENTION", id: null }
  const diff = mayelContentDiffV1(current.content, proposal)
  if (!diff.changed) return { status: "ALREADY_OPTIMIZED", id: null }
  const permission = authorizeOptimizationV1({ grant, accountKey: input.accountKey, actions: diff.actions,
    guards: { exactListingIdentity: true, productTruthProven: true, currentLiveReadbackPass: true, baseGenerationCompatible: true,
      qaPass: proposal.qa.pass, unsupportedClaimCount: proposal.qa.unsupportedClaimCount, competitorContaminationCount: proposal.qa.competitorContaminationCount } })
  if (!permission.authorized) return { status: "REQUIRES_ATTENTION", id: null }
  const audit = { ...diff, proof: proposal.proof, categoryId: proposal.categoryId,
    protectedBefore: current.protectedFields, inventoryBefore: current.inventoryPreserved,
    managementModel: current.management.managementModel, currentLiveReadbackAt: current.observedAt,
    mayelDecision: "AUTO_AUTHORIZED_BY_OWNER_DELEGATION", grantDigest: grant.authority_digest }
  const saved = await input.supabase.from(TABLE).insert({ account_key: input.accountKey, item_id: proposal.proof.itemId,
    task_id: input.taskId, grant_id: grant.id, idempotency_key: key, source_digest: proposal.sourceDigest,
    base_hash: current.baseHash, audit }).select("id,state").maybeSingle()
  if (saved.error || !saved.data) {
    const raced = await input.supabase.from(TABLE).select("id,state").eq("account_key", input.accountKey).eq("idempotency_key", key).maybeSingle()
    if (!raced.error && raced.data) return { status: raced.data.state, id: raced.data.id }
    throw Error("CONTENT_OUTBOX_HANDOFF_FAILED")
  }
  return { status: saved.data.state, id: saved.data.id }
}

/** Called only by the existing operational runtime; one claim and one dispatch
 * share its marketplace budget. Prepared content is never a publication. */
export async function runMayelContentOutboxV1(input: { supabase: SupabaseClient; accountKey: string }) {
  if (getEbayProRuntimeBoundary({ pathname: "/api/runtime/operational-integrity", method: "POST" }).runtime !== "seller_os_dedicated_preprod")
    return { status: "OUTSIDE_PREPROD", writes: 0, dispatchAttempts: 0 }
  const claim = await input.supabase.rpc("seller_os_claim_content_outbox_v1", { p_account_key: input.accountKey })
  if (claim.error) throw Error("CONTENT_OUTBOX_CLAIM_FAILED")
  const row = claim.data?.[0]
  if (!row) return { status: "NO_DUE_WORK", writes: 0, dispatchAttempts: 0 }
  const audit = record(row.audit), proof = record(audit.proof), patch = record(audit.patch)
  const reorder = digest(audit.actions) === digest(["IMAGE_REORDER"])
  const { readMayelContentLiveV1, executeMayelContentMutationV1, contentReadbackMatchesV1, galleryReorderReadbackMatchesV1, executeGalleryReorderMutationV1 } = await import("../ebay/ebay-mayel-content-executor-v1")
  let current: Awaited<ReturnType<typeof readMayelContentLiveV1>> | null = null
  const save = async (values: Record<string, unknown>) => {
    const r = await input.supabase.from(TABLE).update({ ...values, updated_at: new Date().toISOString() })
      .eq("id", row.id).eq("account_key", input.accountKey).eq("lease_token", row.lease_token).select("id").maybeSingle()
    if (r.error || !r.data) throw Error("CONTENT_OUTBOX_LEASE_LOST")
  }
  const result = await executeOutboxOperationV1({ state: row.state, dispatchCount: row.dispatch_count, baseHash: row.base_hash, kind: "LISTING_OPTIMIZATION" }, {
    authority: async () => {
      const grant = await readOptimizationGrantV1(input.supabase, input.accountKey)
      if (reorder) {
        const p = await input.supabase.rpc("seller_os_read_visual_current_product_truth_v1", { p_account_key: input.accountKey, p_task_id: row.task_id })
        const before = Array.isArray(audit.beforeGallery) ? audit.beforeGallery.map(String) : [], after = Array.isArray(audit.afterGallery) ? audit.afterGallery.map(String) : []
        const qa = galleryReorderDecisionV1(before, after)
        return { approved: !p.error && digest(p.data) === digest(proof) && proof.itemId === row.item_id && proof.accountKey === input.accountKey &&
          digest({ proof, beforeGallery: before, afterGallery: after }) === row.source_digest && qa.changed &&
          optimizationGrantActiveV1(grant, input.accountKey) && grant?.id === row.grant_id && grant?.authority_digest === audit.grantDigest && grant?.allowed_actions.includes("IMAGE_REORDER") === true,
          reason: "GALLERY_REORDER_AUTHORITY_REVALIDATION" }
      }
      const proposal = await readMayelOwnContentEvidenceV1({ ...input, taskId: row.task_id })
      const expected = proposal ? mayelContentDiffV1(record(audit.before) as MayelLiveContentV1, proposal) : null
      const patchProven = Boolean(expected && digest(expected.patch) === digest(audit.patch) &&
        digest(expected.after) === digest(audit.after) && digest(expected.actions) === digest(audit.actions))
      const decision = authorizeOptimizationV1({ grant, accountKey: input.accountKey, actions: Array.isArray(audit.actions) ? audit.actions.map(String) : [],
        guards: { exactListingIdentity: proof.itemId === row.item_id && proof.accountKey === input.accountKey && proof.taskId === row.task_id,
          productTruthProven: Boolean(proposal && proposal.sourceDigest === row.source_digest && patchProven), currentLiveReadbackPass: Boolean(audit.currentLiveReadbackAt),
          baseGenerationCompatible: Boolean(proposal && proposal.sourceDigest === row.source_digest), qaPass: proposal?.qa.pass === true,
          unsupportedClaimCount: proposal?.qa.unsupportedClaimCount ?? null, competitorContaminationCount: proposal?.qa.competitorContaminationCount ?? null } })
      return { approved: decision.authorized && grant?.id === row.grant_id && grant?.authority_digest === audit.grantDigest,
        reason: decision.reason ?? (grant?.id !== row.grant_id ? "OWNER_DELEGATION_CHANGED" : null) }
    },
    quota: async () => {
      const { collectSellerOsEbayTradingRateLimitStatusV1 } = await import("../ebay/ebay-trading-rate-limit-observability-v1")
      const q = await collectSellerOsEbayTradingRateLimitStatusV1()
      return { open: q.gateState === "OPEN", retryAt: q.nextSafeTradingProbeAt }
    },
    transition: async state => save({ state }),
    readback: async () => {
      current = await readMayelContentLiveV1({ accountKey: input.accountKey, itemId: row.item_id, sku: String(proof.sku) })
      const matches = reorder ? await galleryReorderReadbackMatchesV1(current, audit) : contentReadbackMatchesV1(current, audit)
      return { official: true, baseHash: current.baseHash, matchesIntent: matches,
        safetyPass: current.categoryId === audit.categoryId && current.management.managementModel === audit.managementModel && current.baseHash === row.base_hash,
        reason: matches ? null : "CONTENT_CURRENT_GENERATION_CHANGED", receipt: matches ? { authority: "OFFICIAL_EBAY_CONTENT_READBACK_V1",
          itemId: row.item_id, observedAt: current.observedAt, after: current.content, ...(reorder ? { afterGallery: current.galleryUrls } : {}), protectedFields: current.protectedFields,
          sourceDigest: row.source_digest, idempotencyKey: row.idempotency_key } : null }
    },
    markDispatch: async () => save({ state: "SYNCING", dispatch_count: 1 }),
    execute: async () => {
      if (!current) throw Error("CURRENT_LIVE_READBACK_REQUIRED")
      if (reorder) return executeGalleryReorderMutationV1({ accountKey: input.accountKey, itemId: row.item_id, sku: String(proof.sku), current,
        after: Array.isArray(audit.afterGallery) ? audit.afterGallery.map(String) : [], claimToken: row.lease_token, idempotencyKey: row.idempotency_key })
      // Last exact read is immediately before dispatch. The executor preserves
      // all unrequested fields and never retries a mutation.
      return executeMayelContentMutationV1({ accountKey: input.accountKey, itemId: row.item_id, sku: String(proof.sku),
        current, patch: patch as Partial<MayelLiveContentV1> })
    },
    finish: async (state, reason, readback, retryAt) => save({ state: state === "OWNER_APPROVAL_REQUIRED" ? "REQUIRES_ATTENTION" : state,
      reason_code: reason, lease_token: null, lease_until: null,
      next_attempt_at: retryAt && Date.parse(retryAt) > Date.now() ? retryAt : new Date(Date.now() + 15 * 60_000).toISOString(),
      official_readback: state === "SYNCED" && readback?.official === true && readback.matchesIntent,
      ...(readback?.receipt ? { execution_receipt: readback.receipt } : {}) }),
  })
  return { status: result.writeOutcomeUnknown ? "OFFICIAL_READBACK_REQUIRED" : "OPERATING", ...result }
}
