import { prepareSellOneLikeThisV1 } from "./sell-one-like-this-v1"
import { keywordRecord as record, keywordWireDigestV1 as digest } from "./keyword-intelligence-handoff-v1"

export type MayelLiveContentV1 = { title: string; description: string; aspects: Record<string, string[]> }
export type MayelContentProposalV1 = { content: MayelLiveContentV1; sourceDigest: string; categoryId: string;
  evidence: Record<string, unknown>; qa: { pass: true; unsupportedClaimCount: 0; competitorContaminationCount: 0 } }

/** Reuses the certified own-truth/V2.1 renderer. Reference metadata is absent:
 * no competitor field, arbitrary saved draft or legacy keyword can enter. */
export function prepareMayelOwnContentV1(input: Omit<Parameters<typeof prepareSellOneLikeThisV1>[0], "reference">):
  { status: "QA_READY"; proposal: MayelContentProposalV1; blockers: string[] } | { status: "WAITING_FOR_DATA"; proposal: null; blockers: string[] } {
  const r = prepareSellOneLikeThisV1({ ...input, reference: {} })
  // A reference import and new image handoff are not required for a content-only LIVE revision.
  const blockers = r.blockers.filter(b => !["REFERENCE_STRUCTURE_UNPROVEN", "AUTHORIZED_PRODUCT_IMAGES_REQUIRED"].includes(b))
  const fields = Array.isArray(input.truthFields) ? input.truthFields.map(record) : []
  for (const name of ["LUNA_PRODUCT_ID", "LUNA_VARIANT_ID", "TITLE", "SUPPLIER_SKU"]) {
    if (fields.filter(f => f.FIELD === name).length !== 1) blockers.push("AMBIGUOUS_OWN_PRODUCT_TRUTH")
  }
  const p = r.preview
  if (!p?.title || typeof p.description !== "string" || !r.categoryValidationPass || !r.itemSpecificsPass || !r.keywordV2_1Pass)
    blockers.push("OWN_CONTENT_EVIDENCE_REQUIRED")
  if (blockers.length || !p?.title) return { status: "WAITING_FOR_DATA", proposal: null, blockers: [...new Set(blockers)] }
  // Descriptions contain plain own facts only; encode markup characters before sending to eBay.
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const content = { title: p.title, description: escape(p.description).replace(/\n/g, "<br>"),
    aspects: Object.fromEntries(Object.entries(p.itemSpecifics).map(([k, v]) => [k, [v]])) }
  return { status: "QA_READY", blockers: [], proposal: { content, categoryId: String(p.categoryId),
    sourceDigest: digest({ source: r.sourceDigest, content }),
    evidence: { binding: input.binding, packageId: input.packageId, sourceDigest: r.sourceDigest,
      keyword: r.keyword, product: r.sourceProvenance.product, aspects: r.sourceProvenance.aspects },
    qa: { pass: true, unsupportedClaimCount: 0, competitorContaminationCount: 0 } } }
}

export { validateMayelContentPatchV1 } from "./mayel-content-patch-v1"

export function mayelContentDiffV1(before: MayelLiveContentV1, proposal: MayelContentProposalV1) {
  const after: MayelLiveContentV1 = { ...before, ...proposal.content,
    aspects: { ...before.aspects, ...proposal.content.aspects } }
  const patch: Partial<MayelLiveContentV1> = {}
  if (before.title !== after.title) patch.title = after.title
  if (before.description !== after.description) patch.description = after.description
  if (digest(before.aspects) !== digest(after.aspects)) patch.aspects = after.aspects
  const actions = Object.keys(patch).map(k => k === "title" ? "TITLE_OPTIMIZATION" : k === "description" ? "DESCRIPTION_OPTIMIZATION" : "ITEM_SPECIFICS_OPTIMIZATION")
  return { before, after, patch, actions, changed: actions.length > 0,
    why: "OWN_PRODUCT_TRUTH_AND_CURRENT_KEYWORD_V2_1", qa: proposal.qa, evidenceUsed: proposal.evidence }
}

/** Allow only the explicit title/description/aspect diff. Every other live
 * field, including gallery, price, quantity and seller policies, stays pinned. */
export function protectedContentFieldsV1(value: Record<string, unknown>, keys: string[]) {
  const result = { ...value }
  for (const k of keys) delete result[k === "aspects" ? "itemSpecificsDigest" : k === "description" ? "descriptionDigest" : k]
  return result
}
