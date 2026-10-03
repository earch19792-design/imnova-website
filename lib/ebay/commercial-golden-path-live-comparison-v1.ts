import { goldenDigest, goldenRecord, type GoldenAuthority, type GoldenCandidateKey, type GoldenRecord } from "./commercial-golden-path-domain-v1"

export type GoldenLiveComparisonInput = {
  evaluationReceiptId: string
  comparisons: Array<{ itemId: string; decision: "DIFFERENT_PRODUCT"; reason: string; sourceLocator: string; sourceDigest: string }>
}
const sha = (value: unknown) => /^sha256:[0-9a-f]{64}$/.test(String(value))
export function goldenLiveCohortIdentityDigestV1(accountKey: string, candidate: GoldenCandidateKey, sourceFingerprint: unknown, listings: Array<{ itemId: string; sku: string | null; title: string | null; variationKey?: string | null }>) {
  return goldenDigest({ accountKey, candidate, sourceFingerprint, listings: listings.map(l => ({ itemId: l.itemId, sku: l.sku, title: l.title, variationKey: l.variationKey ?? null })).sort((a, b) => a.itemId.localeCompare(b.itemId) || String(a.sku).localeCompare(String(b.sku)) || String(a.variationKey).localeCompare(String(b.variationKey)) || String(a.title).localeCompare(String(b.title))) })
}

/** OWNER business comparison is scoped to one candidate and one official LIVE
 * cohort. It creates no supplier fact, historical identity or portfolio link. */
export function buildGoldenLiveComparisonReviewV1(input: { candidate: GoldenCandidateKey; sourceFingerprint: unknown; ownerUserId: string; invocationSource: unknown; now: Date; evaluation: GoldenRecord; review: GoldenLiveComparisonInput }) {
  const e = input.evaluation, d = goldenRecord(e.duplicateGate)
  const observed = Date.parse(String(e.evaluatedAt))
  if (input.invocationSource !== "AUTHENTICATED_CONTROL_MCP" || goldenRecord(e.executionAuthority).source !== "AUTHENTICATED_CONTROL_MCP" || goldenRecord(e.executionAuthority).ownerUserId !== input.ownerUserId) throw Error("LIVE_COMPARISON_AUTHENTICATED_OWNER_REQUIRED")
  if (goldenDigest(e.candidate) !== goldenDigest(input.candidate) || goldenRecord(e.sourceIdentity).sourceFingerprint !== input.sourceFingerprint || !sha(input.sourceFingerprint)) throw Error("LIVE_COMPARISON_EXACT_CANDIDATE_BINDING_REQUIRED")
  if (!(observed <= +input.now && +input.now - observed < 86400000) || d.paginationComplete !== true || !sha(d.cohortIdentityDigest) || d.status !== "UNPROVEN" || !Array.isArray(d.unresolvedItemIds) || !d.unresolvedItemIds.length) throw Error("LIVE_COMPARISON_OFFICIAL_COMPLETE_COHORT_REQUIRED")
  const targets = new Map<string, GoldenRecord[]>()
  for (const r of (Array.isArray(d.comparisonTargets) ? d.comparisonTargets : []).map(goldenRecord)) targets.set(String(r.itemId), [...(targets.get(String(r.itemId)) ?? []), r])
  const unresolved = new Set(d.unresolvedItemIds.map(String))
  const ids = new Set<string>()
  if (!input.review.comparisons.length || input.review.comparisons.length > 500) throw Error("LIVE_COMPARISON_REVIEW_BOUND_REQUIRED")
  const comparisons = input.review.comparisons.map(r => {
    if (r.decision !== "DIFFERENT_PRODUCT" || !unresolved.has(r.itemId) || !targets.has(r.itemId) || ids.has(r.itemId) || r.reason.trim().length < 8 || r.sourceLocator.length < 8 || !sha(r.sourceDigest)) throw Error("LIVE_COMPARISON_UNRESOLVED_ITEM_PROVENANCE_REQUIRED")
    ids.add(r.itemId)
    return { ...r, officialListing: targets.get(r.itemId) }
  })
  return { contractVersion: "CANDIDATE_LIVE_COMPARISON_REVIEW_V1", candidate: input.candidate, sourceFingerprint: input.sourceFingerprint, ownerUserId: input.ownerUserId, evaluationReceiptId: input.review.evaluationReceiptId, cohortIdentityDigest: d.cohortIdentityDigest, comparisons, observedAt: input.now.toISOString(), freshUntil: new Date(observed + 86400000).toISOString(), source: "OWNER_ATTESTED_CANDIDATE_LIVE_COMPARISON", supplierTruthModified: false, portfolioLinkageModified: false, marketplaceWrites: 0 }
}

export function applyGoldenLiveComparisonReviewsV1(input: { base: GoldenAuthority; candidate: GoldenCandidateKey; sourceFingerprint: unknown; ownerUserId: string; now: Date; receipts: GoldenRecord[] }) {
  if (input.base.status === "DUPLICATE" || input.base.paginationComplete !== true || !sha(input.base.cohortIdentityDigest)) return input.base
  const approved = new Map<string, string>(), proofReceipts: string[] = []
  for (const row of input.receipts.slice(0, 10)) {
    const payload = goldenRecord(row.payload), review = goldenRecord(payload.liveComparisonReview)
    const observed = Date.parse(String(review.observedAt)), until = Date.parse(String(review.freshUntil))
    if (goldenDigest(payload) !== row.evidence_digest || goldenRecord(payload.executionAuthority).source !== "AUTHENTICATED_CONTROL_MCP" || goldenRecord(payload.executionAuthority).ownerUserId !== input.ownerUserId || review.ownerUserId !== input.ownerUserId || review.contractVersion !== "CANDIDATE_LIVE_COMPARISON_REVIEW_V1" || goldenDigest(review.candidate) !== goldenDigest(input.candidate) || review.sourceFingerprint !== input.sourceFingerprint || review.cohortIdentityDigest !== input.base.cohortIdentityDigest || !(observed <= +input.now && +input.now - observed < 86400000 && until > +input.now && until - observed <= 86400000)) continue
    const comparisons = Array.isArray(review.comparisons) ? review.comparisons.map(goldenRecord) : []
    for (const c of comparisons) if (c.decision === "DIFFERENT_PRODUCT" && sha(c.sourceDigest) && typeof c.reason === "string" && c.reason.length >= 8 && typeof c.sourceLocator === "string" && c.sourceLocator.length >= 8) approved.set(String(c.itemId), String(row.receipt_id))
    proofReceipts.push(String(row.receipt_id))
  }
  const unresolved = Array.isArray(input.base.unresolvedItemIds) ? input.base.unresolvedItemIds.map(String) : []
  const remaining = unresolved.filter(id => !approved.has(id))
  const related = Array.isArray(input.base.relatedItemIds) ? input.base.relatedItemIds : []
  if (!approved.size) return input.base
  const status = remaining.length || related.length ? "UNPROVEN" : "PASS"
  const body = { ...input.base, status, unresolvedItemIds: remaining, ownerComparedDistinctItemIds: unresolved.filter(id => approved.has(id)), ownerComparisonReceiptIds: [...new Set(proofReceipts)], reasonCode: remaining.length ? "CANDIDATE_LIVE_COMPARISONS_STILL_UNPROVEN" : related.length ? "RELATED_PRODUCT_VARIANT_LIVE_REVIEW_REQUIRED" : null, historicalBackfillStarted: false, supplierTruthModified: false, portfolioLinkageModified: false }
  return { ...body, receiptId: goldenDigest(body) }
}
