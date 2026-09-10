const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}
export function visualExecutionScopeV1(task: Record<string, unknown>, proposed: readonly string[], proof: unknown) {
  const p = record(proof)
  const ownPackage = p.authority === "EXACT_LIVE_LINKED_PRODUCT_TRUTH_V1" && p.taskId === task.id &&
    p.itemId === task.ebay_item_id && p.accountKey === task.marketplace_account_key && p.visualSourceDigest === task.source_image_set_digest
    ? p.packageId : null
  const listingPackageId = task.listing_package_id ?? ownPackage
  if (typeof listingPackageId !== "string" || !/^[a-f0-9-]{36}$/i.test(listingPackageId) || !proposed[0])
    throw Error("MAYEL_VISUAL_EXECUTION_PACKAGE_SCOPE_REQUIRED")
  return { listingPackageId, mainImageUrl: proposed[0] }
}
/** These legacy inputs deterministically violated the DB CHECK before any
 * execution record or marketplace call existed. Absence must be read under
 * the outbox lease; all other unknown outcomes retain readback-only behavior. */
export function visualScopeFailureDefinitelyUnsentV1(input: { reason: string | null; dispatchCount: number;
  executionAbsent: boolean; manifestMatches: boolean; task: Record<string, unknown> }) {
  const m = record(input.task.visual_manifest), proposed = Array.isArray(m.proposedOrderedImages) ? m.proposedOrderedImages.map(record) : []
  return input.dispatchCount === 1 && input.executionAbsent && input.manifestMatches &&
    (input.reason === "MAYEL_VISUAL_PHASE_B_EXECUTION_SCOPE_REJECTED" ||
      input.reason === "MAYEL_VISUAL_PHASE_B_OWNER_APPROVAL_PERSIST_FAILED" && input.task.listing_package_id === null &&
      m.intentContract === "MAYEL_VISUAL_INTENT_V1" && m.mainImageChange === true &&
      Boolean(proposed[0]?.publicUrl) && proposed[0].publicUrl !== m.currentMainImage)
}
