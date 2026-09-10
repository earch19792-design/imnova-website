import { buildVisualIntentManifestV1, type VisualIntentV1 } from "./mayel-visual-intent-v1"
import { buildFullGalleryMutationV1, FULL_GALLERY_MUTATION_V1, type GalleryDecisionV1 } from "./mayel-full-gallery-mutation-v1"
import { buildMayelOrderedVisualManifestV2, mayelVisualDigestV1, type MayelApprovedVisualAssetV1 } from "../ebay/ebay-mayel-visual-workstation-v1"

const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}
export function discardedProposalIdsV1(signal: unknown): string[] {
  const ids = record(signal).discardedVisualAssetIds
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []
}
export function excludeDiscardedProposalsV1<T extends { not: (column: string, operator: string, value: unknown) => T }>(query: T, signal: unknown): T {
  const ids = discardedProposalIdsV1(signal)
  return ids.length ? query.not("id", "in", `(${ids.join(",")})`) : query
}

/** Cancel a proposed replacement/addition, never remove its original eBay
 * source. This is a local draft operation and cannot assert a current readback. */
export function discardProposalManifestV1(input: { taskId: string; itemId: string; accountKey: string;
  manifest: Record<string, unknown>; assetIds: string[]; assets: MayelApprovedVisualAssetV1[] }) {
  const m = input.manifest
  const current = [m.currentMainImage, ...(Array.isArray(m.currentSecondaryImages) ? m.currentSecondaryImages : [])]
  const proposed = Array.isArray(m.proposedOrderedImages) ? m.proposedOrderedImages.map(record) : []
  if (m.visualTaskId !== input.taskId || m.ebayItemId !== input.itemId || !input.assetIds.length || input.assetIds.length > 6 ||
      new Set(input.assetIds).size !== input.assetIds.length || current.some(u => typeof u !== "string" || !u.startsWith("https://")) ||
      input.assetIds.some(id => !proposed.some(e => e.assetId === id))) throw Error("PROPOSAL_DISCARD_BINDING_INVALID")
  const remainingAssets = input.assets.filter(a => !input.assetIds.includes(a.assetId))
  const common = { visualTaskId: input.taskId, ebayItemId: input.itemId, currentImages: current as string[], assets: remainingAssets,
    productTruthDigest: String(m.productTruthDigest), sourceImageSetDigest: String(m.sourceImageSetDigest) }
  if (m.galleryMutationContract === FULL_GALLERY_MUTATION_V1) {
    const decisions = (m.galleryDecisions as GalleryDecisionV1[]).flatMap(d => !d.assetId || !input.assetIds.includes(d.assetId) ? [{ ...d }] :
      d.action === "ADD" ? [] : [{ action: "KEEP" as const, sourcePosition: d.sourcePosition, targetPosition: d.targetPosition,
        assetId: null, visualRole: d.sourcePosition === 0 ? "MAIN" : "CURRENT", intentReason: "Propuesta descartada; conservar la imagen original." }])
    decisions.filter(d => d.targetPosition !== null).sort((a,b) => a.targetPosition! - b.targetPosition!).forEach((d,p) => { d.targetPosition = p })
    return buildFullGalleryMutationV1({ ...common, accountKey: input.accountKey, generation: mayelVisualDigestV1({ previous: m.visualManifestDigest, discard: input.assetIds }), decisions })
  }
  if (m.intentContract !== "MAYEL_VISUAL_INTENT_V1" || !Array.isArray(m.visualIntents)) throw Error("PROPOSAL_INTENT_REQUIRED")
  const intents = (m.visualIntents as VisualIntentV1[]).filter(i => !input.assetIds.includes(i.assetId)).map(i => ({ ...i }))
  intents.filter(i => i.visualIntent === "ADD_SECONDARY").sort((a,b) => a.targetImagePosition-b.targetImagePosition)
    .forEach((i,p) => { i.targetImagePosition = current.length+p })
  if (intents.length) return buildVisualIntentManifestV1({ ...common, intents })
  return buildMayelOrderedVisualManifestV2({ ...common, assets: [], finalOrder: (current as string[]).map(publicUrl => ({ kind: "CURRENT_OFFICIAL", publicUrl })) })
}
