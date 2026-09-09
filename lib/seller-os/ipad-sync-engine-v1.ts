import { outboxTransientFailureV1 } from "./ipad-outbox-contract-v1"
export type SyncOperation = { state: string; dispatchCount: number; baseHash: string | null; kind: string }
export type SyncReadback = { official: boolean; baseHash: string | null; matchesIntent: boolean; safetyPass: boolean; reason: string | null; receipt: Record<string, unknown> | null }
export type SyncDependencies = {
 authority: () => Promise<{ approved: boolean; reason: string | null }>;
 quota: () => Promise<{ open: boolean; retryAt?: string | null }>;
 readback: () => Promise<SyncReadback>;
 finish: (state: string, reason: string | null, readback?: SyncReadback, retryAt?: string | null) => Promise<void>;
 markDispatch: () => Promise<void>;
 execute: () => Promise<{ writes: number; mediaWrites: number }>;
}
// Browser lifecycle never participates here. UNKNOWN_COMMIT is persisted before
// dispatch; it can only be resolved by official evidence, never a blind retry.
export async function executeOutboxOperationV1(op: SyncOperation, d: SyncDependencies) {
 let dispatched = op.state === "UNKNOWN_COMMIT" || op.dispatchCount > 0
 let writes = 0, mediaWrites = 0, dispatchedThisRun = false, executionReturned = false
 const result = () => ({ writes, mediaWrites, dispatchAttempts: dispatchedThisRun ? 1 : 0, writeOutcomeUnknown: dispatchedThisRun && !executionReturned })
 try {
   if (!["IMAGE_DRAFT", "IMAGE_SYNC", "IMAGE_UPLOAD"].includes(op.kind)) {
     await d.finish("ATTENTION", "DRAFT_IS_NOT_WRITE_AUTHORITY"); return result()
   }
   if (!dispatched) {
     const authority = await d.authority()
     if (!authority.approved) {
       await d.finish(authority.reason === "OWNER_VISUAL_REVIEW_REQUIRED" ? "PENDING_EBAY_SYNC" : "ATTENTION", authority.reason)
       return result()
     }
   }
   const quota = await d.quota()
   if (!quota.open) {
     await d.finish(dispatched ? "UNKNOWN_COMMIT" : "PENDING_EBAY_SYNC", "EBAY_QUOTA_EXHAUSTED", undefined, quota.retryAt)
     return result()
   }
   const before = await d.readback()
   if (!before.official) {
     const reason = before.reason ?? "TEMPORARY_UPSTREAM_FAILURE"
     await d.finish(dispatched ? "UNKNOWN_COMMIT" : outboxTransientFailureV1(reason) ? "PENDING_EBAY_SYNC" : "ATTENTION", reason)
     return result()
   }
   if (before.matchesIntent) { await d.finish("SYNCED", null, before); return result() }
   if (dispatched) { await d.finish("ATTENTION", "UNKNOWN_COMMIT_REQUIRES_REVIEW", before); return result() }
   if (!op.baseHash || before.baseHash !== op.baseHash) {
     await d.finish("ATTENTION", "MATERIAL_LISTING_DRIFT", before); return result()
   }
   if (!before.safetyPass) { await d.finish("ATTENTION", before.reason ?? "SAFETY_REVALIDATION_FAILED", before); return result() }
   await d.markDispatch()
   dispatched = true; dispatchedThisRun = true
   const executed = await d.execute(); executionReturned = true; writes = executed.writes; mediaWrites = executed.mediaWrites
   const after = await d.readback()
   await d.finish(after.official && after.matchesIntent ? "SYNCED" : "UNKNOWN_COMMIT",
     after.official && after.matchesIntent ? null : "OFFICIAL_READBACK_PENDING", after)
   return result()
 } catch (error) {
   const raw = error instanceof Error ? error.message : ""
   const reason = /^[A-Z0-9_:+.-]{3,160}$/.test(raw) ? raw : "TEMPORARY_UPSTREAM_FAILURE"
   await d.finish(dispatched ? "UNKNOWN_COMMIT" : outboxTransientFailureV1(reason) ? "PENDING_EBAY_SYNC" : "ATTENTION", reason)
   return result()
 }
}
