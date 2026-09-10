/** OWNER delegation authorizes a scope, never unproven facts or a stale diff. */
export const MAYEL_OPTIMIZATION_DELEGATION_V1 = "MAYEL_AUTONOMOUS_LISTING_OPTIMIZATION_DELEGATION_V1"
export const MAYEL_OPTIMIZATION_ACTIONS_V1 = [
  "MAIN_IMAGE_REPLACEMENT", "SECONDARY_IMAGE_REPLACEMENT", "IMAGE_ADDITION", "IMAGE_REORDER", "IMAGE_REMOVAL",
  "TITLE_OPTIMIZATION", "DESCRIPTION_OPTIMIZATION", "ITEM_SPECIFICS_OPTIMIZATION",
  "KEYWORD_V2_1_OPTIMIZATION", "LISTING_QUALITY_REMEDIATION",
] as const
export type OptimizationActionV1 = typeof MAYEL_OPTIMIZATION_ACTIONS_V1[number]
export type OptimizationGuardsV1 = {
  exactListingIdentity: boolean; productTruthProven: boolean; currentLiveReadbackPass: boolean;
  baseGenerationCompatible: boolean; qaPass: boolean; unsupportedClaimCount: number | null;
  competitorContaminationCount: number | null;
}
export type OptimizationGrantV1 = { id: string; account_key: string; owner_user_id: string;
  contract_version: string; scope: string; status: string; revoked_at: string | null;
  authority_digest: string; allowed_actions: readonly string[] }
export function optimizationGrantActiveV1(grant: OptimizationGrantV1 | null, accountKey: string) {
  return Boolean(grant && grant.account_key === accountKey && grant.scope === "FULL" &&
    grant.contract_version === MAYEL_OPTIMIZATION_DELEGATION_V1 && grant.status === "ACTIVE" &&
    grant.revoked_at === null && /^sha256:[a-f0-9]{64}$/.test(grant.authority_digest))
}
export function authorizeOptimizationV1(input: { grant: OptimizationGrantV1 | null; accountKey: string;
  actions: readonly string[]; guards: OptimizationGuardsV1 }) {
  const g = input.guards
  const reason = !optimizationGrantActiveV1(input.grant, input.accountKey) ? "OWNER_DELEGATION_REQUIRED" :
    !input.actions.length || input.actions.some(a => !MAYEL_OPTIMIZATION_ACTIONS_V1.includes(a as OptimizationActionV1) ||
      !input.grant!.allowed_actions.includes(a)) ? "CHANGE_OUTSIDE_OWNER_DELEGATION" :
    !g.exactListingIdentity ? "EXACT_LISTING_IDENTITY_REQUIRED" : !g.productTruthProven ? "PRODUCT_TRUTH_REQUIRED" :
    !g.currentLiveReadbackPass ? "CURRENT_LIVE_READBACK_REQUIRED" : !g.baseGenerationCompatible ? "MATERIAL_GENERATION_DRIFT" :
    !g.qaPass ? "QA_REQUIRED" : g.unsupportedClaimCount !== 0 ? "UNSUPPORTED_CLAIMS_UNPROVEN_OR_PRESENT" :
    g.competitorContaminationCount !== 0 ? "COMPETITOR_CONTAMINATION_UNPROVEN_OR_PRESENT" : null
  return { authorized: reason === null, reason, authority: reason === null ? "AUTO_AUTHORIZED_BY_OWNER_DELEGATION" : null,
    ownerRoutineApprovalRequired: !optimizationGrantActiveV1(input.grant, input.accountKey),
    publicationAuthorized: false, adsSpendAuthorized: false }
}

const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}
export function delegatedVisualQaV1(asset: Record<string, unknown>, task: Record<string, unknown>) {
  const qa = record(asset.qa_result), review = record(qa.humanReview), checks = record(review.checks)
  const discarded = record(task.selection_signal).discardedVisualAssetIds
  if (Array.isArray(discarded) && discarded.includes(asset.id)) return false
  return asset.status === "approved" && asset.mayel_approval_status === "APPROVED" && qa.automaticStatus === "PASSED" &&
    review.decision === "APPROVE" && checks.productIdentityPreserved === true && checks.noUnsupportedClaims === true &&
    checks.noInventedAccessories === true && checks.noUnauthorizedText === true &&
    asset.product_truth_digest === task.product_truth_digest && typeof task.product_truth_digest === "string" &&
    asset.source_image_set_digest === task.source_image_set_digest && typeof task.source_image_set_digest === "string"
}
