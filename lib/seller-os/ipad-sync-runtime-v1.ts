import { randomUUID } from "node:crypto"
import { visualScopeFailureDefinitelyUnsentV1 } from "./mayel-visual-execution-scope-v1"
import { approvedVisualReadbackMatchesV1 } from "./visual-sync-readback-v1"
import { stableOutboxJsonV1 } from "./ipad-outbox-contract-v1"
import type { SupabaseClient } from "@supabase/supabase-js"
import { IPAD_OUTBOX_TABLE, readOutboxImageAuthorityV1, type OutboxRow } from "./ipad-durable-outbox-v1"
import { executeOutboxOperationV1, type SyncReadback } from "./ipad-sync-engine-v1"
import { getEbayProRuntimeBoundary } from "../ebay/environment-boundaries"
export async function runIpadOutboxRuntimeV1(input: { supabase: SupabaseClient; accountKey: string; outboxId?: string; itemId?: string }) {
 if (getEbayProRuntimeBoundary({ pathname: "/api/runtime/operational-integrity", method: "POST" }).runtime !== "seller_os_dedicated_preprod")
   return { status: "OUTSIDE_PREPROD", processed: 0, listingWriteCount: 0, mediaWriteCount: 0 }
 if (Boolean(input.outboxId) !== Boolean(input.itemId) || input.outboxId &&
     (!/^[a-f0-9-]{36}$/i.test(input.outboxId) || !/^\d{9,20}$/.test(input.itemId!))) throw Error("OUTBOX_EXACT_SCOPE_REQUIRED")
 let listingWriteCount = 0, mediaWriteCount = 0, processed = 0, dispatchAttempts = 0, writeOutcomeUnknown = false
 // Bounded work shares the existing scheduled operational runtime.
 for (let i = 0; i < (input.outboxId ? 1 : 3) && dispatchAttempts < 1; i++) {
   const claim = input.outboxId && input.itemId
     ? await input.supabase.from(IPAD_OUTBOX_TABLE).update({ lease_token: randomUUID(),
         lease_until: new Date(Date.now() + 5 * 60_000).toISOString() })
       .eq("id", input.outboxId).eq("account_key", input.accountKey).eq("item_id", input.itemId)
       .in("state", ["APPROVED_FOR_EBAY_SYNC", "PENDING_EBAY_SYNC", "REVALIDATING", "SYNCING", "OFFICIAL_READBACK_REQUIRED", "UNKNOWN_COMMIT"])
       .lte("next_attempt_at", new Date().toISOString())
       .or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
       .select("id,account_key,actor_user_id,item_id,kind,intent,binding,idempotency_key,payload_hash,state,reason_code,received_at,lease_token,dispatch_count,official_readback")
     : await input.supabase.rpc("seller_os_claim_ipad_outbox_v1", { p_account_key: input.accountKey })
   if (claim.error) throw Error("OUTBOX_CLAIM_FAILED")
   const row = claim.data?.[0] as OutboxRow | undefined
   if (!row) break
   let preDispatchFailureProven = false
   if (row.binding.ownerDelegation && row.dispatch_count === 1 &&
       ["MAYEL_VISUAL_PHASE_B_OWNER_APPROVAL_PERSIST_FAILED", "MAYEL_VISUAL_PHASE_B_EXECUTION_SCOPE_REJECTED"].includes(row.reason_code ?? "")) {
     const task = await input.supabase.from("ebay_mayel_visual_tasks_v1")
       .select("listing_package_id,visual_manifest,visual_manifest_digest").eq("id", row.intent.requestedChanges.taskId!)
       .eq("marketplace_account_key", input.accountKey).maybeSingle()
     const execution = await input.supabase.from("ebay_mayel_visual_phase_b_executions_v1").select("id")
       .eq("marketplace_account_key", input.accountKey).eq("visual_task_id", row.intent.requestedChanges.taskId!)
       .eq("visual_manifest_digest", row.intent.requestedChanges.manifestDigest!).maybeSingle()
     preDispatchFailureProven = !task.error && !execution.error && visualScopeFailureDefinitelyUnsentV1({
       reason: row.reason_code, dispatchCount: row.dispatch_count, executionAbsent: !execution.data,
       manifestMatches: task.data?.visual_manifest_digest === row.intent.requestedChanges.manifestDigest, task: task.data ?? {} })
   }
   const recoveryProof = preDispatchFailureProven ? { previousReason: row.reason_code, dispatchCounterPreserved: true,
     authority: "DETERMINISTIC_EXECUTION_SCOPE_CHECK_REJECTION", executionRecordAbsent: true, observedAt: new Date().toISOString() } : null
   let manifestDigest: string | null = typeof row.binding.executionManifestDigest === "string" ? row.binding.executionManifestDigest : null
   let expectedImages: string[] = [], ownerApproved = false
   let managementModel: string | null = null
   const patch = async (values: Record<string, unknown>) => {
     const changed = await input.supabase.from(IPAD_OUTBOX_TABLE).update({ ...values, updated_at: new Date().toISOString() })
       .eq("id", row.id).eq("account_key", input.accountKey).eq("lease_token", row.lease_token).select("id").maybeSingle()
     if (changed.error || !changed.data) throw Error("OUTBOX_LEASE_LOST")
   }
   const deps = {
     transition: async (state: string) => { await patch({ state }) },
     authority: async () => {
       if (row.intent.requestedChanges.prepareReview === true) {
         const task = await input.supabase.from("ebay_mayel_visual_tasks_v1").select("status,visual_manifest_digest")
           .eq("id", row.intent.requestedChanges.taskId!).eq("marketplace_account_key", input.accountKey).maybeSingle()
         if (task.error || !task.data) throw Error("OUTBOX_PREPARE_TASK_READ_FAILED")
         if (!task.data.visual_manifest_digest && ["PROMPT_READY", "OUTPUTS_UPLOADED", "MAYEL_REVIEW_PENDING"].includes(task.data.status)) {
           const { prepareMayelImageReviewV1 } = await import("./mayel-image-workspace-v1")
           await prepareMayelImageReviewV1({ ...input, actorUserId: row.actor_user_id, owner: row.binding.ownerAtHandoff === true,
             itemId: row.item_id, taskId: row.intent.requestedChanges.taskId!, assetId: row.intent.requestedChanges.assetId!,
             experimentId: row.intent.requestedChanges.experimentId! })
         }
       }
       const authority = await readOutboxImageAuthorityV1({ supabase: input.supabase, row })
       if (manifestDigest && authority.approved && authority.manifestDigest !== manifestDigest)
         return { approved: false, reason: "OUTBOX_APPROVED_MANIFEST_CHANGED" }
       manifestDigest = authority.manifestDigest
       ownerApproved = authority.approved
       expectedImages = authority.expectedImages ?? []
       return authority
     },
     quota: async () => {
       const { collectSellerOsEbayTradingRateLimitStatusV1 } = await import("../ebay/ebay-trading-rate-limit-observability-v1")
       const q = await collectSellerOsEbayTradingRateLimitStatusV1()
       return { open: q.gateState === "OPEN", retryAt: q.nextSafeTradingProbeAt }
     },
     readback: async (): Promise<SyncReadback> => {
       const { readMayelVisualPhaseBPreviewV1 } = await import("../ebay/ebay-mayel-visual-phase-b-server-v1")
       const preview = await readMayelVisualPhaseBPreviewV1({ ...input, taskId: row.intent.requestedChanges.taskId! })
       managementModel = preview.managementModel
       const execution = manifestDigest ? await input.supabase.from("ebay_mayel_visual_phase_b_executions_v1")
         .select("id,phase,proposed_image_digest,postwrite_snapshot")
         .eq("marketplace_account_key", input.accountKey).eq("visual_task_id", row.intent.requestedChanges.taskId!)
         .eq("visual_manifest_digest", manifestDigest).maybeSingle() : { data: null, error: null }
       if (execution.error) throw Error("OUTBOX_EXECUTION_READ_FAILED")
       const official = preview.officialReadStatus === "PASS" && preview.currentImageSetProven &&
         preview.accountIdentityProven && preview.listingIdentityProven && preview.officialReadAuthority !== "EBAY_BROWSE_GET_ITEM_BY_LEGACY_ID_V1"
       const baseListingCompatible = Boolean(row.binding.baseListing && preview.currentListingVersionFields &&
         stableOutboxJsonV1(row.binding.baseListing) === stableOutboxJsonV1(preview.currentListingVersionFields))
       const e = execution.data
       // A stored terminal claim alone is insufficient: current official digest
       // and the executor's protected-field verification must both agree.
       const alreadyApplied = approvedVisualReadbackMatchesV1({ official, ownerApproved, baseListingCompatible,
         approvedManifestDigest: manifestDigest, currentManifestDigest: preview.visualManifestDigest,
         expectedImages, currentImages: preview.currentImages })
       const matchesIntent = alreadyApplied || official && ownerApproved && baseListingCompatible && preview.visualManifestDigest === manifestDigest && preview.approvedGalleryAlreadyOfficial || official && baseListingCompatible && Boolean(e && e.phase === "APPLIED_AND_OFFICIALLY_VERIFIED" &&
         e.proposed_image_digest === preview.currentOfficialImageSetDigest && e.postwrite_snapshot?.nonAuthorizedFieldsUnchanged === true)
       return { official, baseHash: preview.currentOfficialImageSetDigest, matchesIntent,
         safetyPass: baseListingCompatible && preview.safeToExecuteVisualChange && preview.visualOnlyDiff && preview.unauthorizedFieldDiffCount === 0 && preview.visualManifestDigest === manifestDigest,
         reason: preview.applicationStatus === "WAITING_FOR_EBAY" ? "EBAY_RATE_LIMITED" :
           !baseListingCompatible ? "LISTING_ECONOMIC_OR_IDENTITY_DRIFT" : preview.blocker,
         receipt: matchesIntent ? { executionId: e?.id ?? null, phase: e?.phase ?? "ALREADY_APPLIED_OFFICIALLY_VERIFIED", manifestDigest, officialDigest: preview.currentOfficialImageSetDigest, observedAt: new Date().toISOString(), writesThisReconciliation: 0 } : null }
     },
     markDispatch: async () => {
       if (!manifestDigest || row.dispatch_count !== 0 && !preDispatchFailureProven) throw Error("OUTBOX_DUPLICATE_DISPATCH_BLOCKED")
       await patch({ state: "SYNCING", dispatch_count: 1, binding: { ...row.binding, executionManifestDigest: manifestDigest } })
     },
     execute: async () => {
       if (managementModel === "INVENTORY_API_MANAGED" && row.binding.ownerDelegation) {
         const { applyMayelVisualManifestToEbayV1 } = await import("../ebay/ebay-mayel-visual-phase-b-server-v1")
         const { readOptimizationGrantV1 } = await import("./mayel-optimization-delegation-server-v1")
         const grant = await readOptimizationGrantV1(input.supabase, input.accountKey)
         if (!grant || !manifestDigest) throw Error("OWNER_DELEGATION_REQUIRED")
         const result = await applyMayelVisualManifestToEbayV1({ ...input, taskId: row.intent.requestedChanges.taskId!,
           outboxId: row.id, outboxLeaseToken: row.lease_token, ownerUserId: grant.owner_user_id,
           visualManifestDigest: manifestDigest, confirmation: "AUTO_AUTHORIZED_BY_OWNER_DELEGATION" })
         return { writes: result?.marketplaceWriteCount ?? 0, mediaWrites: 0 }
       }
       const { executeMayelTradingVisualDelegatedManifestV1 } = await import("../ebay/ebay-mayel-visual-phase-b-server-v1")
       const result = await executeMayelTradingVisualDelegatedManifestV1({ ...input, taskId: row.intent.requestedChanges.taskId!, outboxId: row.id, outboxLeaseToken: row.lease_token })
       return { writes: result.tradingListingWriteCount, mediaWrites: result.mediaApiWriteCount, ...(result.status === "GALLERY_CHANGED" ? { stoppedReason: "MAYEL_VISUAL_CURRENT_OFFICIAL_IMAGE_SET_CHANGED" } : {}) }
     },
     finish: async (state: string, reason: string | null, proof?: SyncReadback, retryAt?: string | null) => {
       const due = retryAt && Date.parse(retryAt) > Date.now() ? retryAt : new Date(Date.now() + 15 * 60_000).toISOString()
       await patch({ state, reason_code: reason, next_attempt_at: due, lease_until: null, lease_token: null,
         official_readback: state === "SYNCED" && proof?.official === true && proof.matchesIntent,
         ...(proof?.receipt || recoveryProof ? { execution_receipt: { ...proof?.receipt, ...(recoveryProof ? { preDispatchRecovery: recoveryProof } : {}) } } : {}),
         ...(state === "SYNCED" && manifestDigest ? { binding: { ...row.binding, executionManifestDigest: manifestDigest } } : {}) })
     },
   }
   const result = await executeOutboxOperationV1({ state: row.state, dispatchCount: row.dispatch_count, preDispatchFailureProven,
     baseHash: typeof row.binding.baseImageHash === "string" ? row.binding.baseImageHash : null, kind: row.kind }, deps)
   dispatchAttempts += result.dispatchAttempts; writeOutcomeUnknown ||= result.writeOutcomeUnknown
   listingWriteCount += result.writes; mediaWriteCount += result.mediaWrites; processed++
 }
 return { status: writeOutcomeUnknown ? "OFFICIAL_READBACK_PENDING" : "OPERATING", processed, listingWriteCount, mediaWriteCount, dispatchAttempts, writeOutcomeUnknown }
}
