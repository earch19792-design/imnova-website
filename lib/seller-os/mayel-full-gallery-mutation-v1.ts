import { buildMayelOrderedVisualManifestV2, mayelVisualDigestV1, type MayelApprovedVisualAssetV1 } from "../ebay/ebay-mayel-visual-workstation-v1"

export const FULL_GALLERY_MUTATION_V1 = "MAYEL_FULL_GALLERY_MUTATION_V1"
export type GalleryDecisionV1 = {
  action: "KEEP" | "REPLACE" | "REMOVE" | "ADD" | "REORDER" | "REPLACE_MAIN"
  sourcePosition: number | null
  targetPosition: number | null
  assetId: string | null
  visualRole: string
  intentReason: string
  removalEvidence?: { productTruthDigest: string; evidenceReferences: string[]; noRequiredEvidenceLost: true; semanticQaPassed: true }
}
type GalleryInput = { visualTaskId: string; ebayItemId: string; accountKey: string; generation: string;
  currentImages: readonly string[]; assets: readonly MayelApprovedVisualAssetV1[];
  decisions: readonly GalleryDecisionV1[]; productTruthDigest: string; sourceImageSetDigest: string }

/** Targets refer to the FINAL gallery. Every original slot must have exactly one
 * disposition. Insertion/removal can shift slots, but cannot reverse KEEP order. */
export function buildFullGalleryMutationV1(input: GalleryInput) {
  const { currentImages: current, decisions } = input
  if (!input.accountKey || !input.generation || !current.length || current.length > 24 ||
      new Set(current).size !== current.length || current.some(u => !/^https:\/\//.test(u)) ||
      !decisions.length || decisions.length > 48) throw Error("FULL_OFFICIAL_GALLERY_REQUIRED")
  const sources = new Set<number>(), targets = new Set<number>(), assets = new Set<string>()
  const actions = new Set<string>()
  for (const d of decisions) {
    if (!["KEEP", "REPLACE", "REMOVE", "ADD", "REORDER", "REPLACE_MAIN"].includes(d.action) ||
        !d.visualRole?.trim() || !d.intentReason?.trim()) throw Error("GALLERY_DECISION_REQUIRED")
    if (d.action === "ADD") {
      if (d.sourcePosition !== null) throw Error("ADD_SOURCE_MUST_BE_NULL")
      actions.add("IMAGE_ADDITION")
    } else {
      if (!Number.isInteger(d.sourcePosition) || d.sourcePosition! < 0 || d.sourcePosition! >= current.length ||
          sources.has(d.sourcePosition!)) throw Error("GALLERY_SOURCE_BINDING_INVALID")
      sources.add(d.sourcePosition!)
    }
    if (d.action === "REMOVE") {
      const e = d.removalEvidence
      if (d.targetPosition !== null || d.assetId !== null || !e || e.productTruthDigest !== input.productTruthDigest ||
          e.noRequiredEvidenceLost !== true || e.semanticQaPassed !== true || !e.evidenceReferences.length ||
          e.evidenceReferences.some(r => !r.trim())) throw Error("REMOVAL_EVIDENCE_REQUIRED")
      actions.add("IMAGE_REMOVAL")
      continue
    }
    if (!Number.isInteger(d.targetPosition) || d.targetPosition! < 0 || d.targetPosition! >= 24 || targets.has(d.targetPosition!))
      throw Error("DETERMINISTIC_TARGET_POSITION_REQUIRED")
    targets.add(d.targetPosition!)
    if (["REPLACE", "REPLACE_MAIN", "ADD"].includes(d.action)) {
      if (!d.assetId || assets.has(d.assetId) || !input.assets.some(a => a.assetId === d.assetId && /^[a-f0-9]{64}$/.test(a.outputSha256)))
        throw Error("APPROVED_ASSET_IDENTITY_REQUIRED")
      assets.add(d.assetId)
      if (d.action !== "ADD") actions.add(d.sourcePosition === 0 ? "MAIN_IMAGE_REPLACEMENT" : "SECONDARY_IMAGE_REPLACEMENT")
    } else if (d.assetId !== null) throw Error("CURRENT_IMAGE_CANNOT_CHANGE_IDENTITY")
    if (d.action === "REPLACE_MAIN" && (d.targetPosition !== 0 || d.sourcePosition !== 0)) throw Error("MAIN_POSITION_ZERO_REQUIRED")
    if (d.action === "REORDER") actions.add("IMAGE_REORDER")
  }
  if (sources.size !== current.length) throw Error("UNAUTHORIZED_IMAGE_REMOVAL")
  const final = decisions.filter(d => d.action !== "REMOVE").sort((a,b) => a.targetPosition! - b.targetPosition!)
  if (!final.length || final.length > 24 || final.some((d,p) => d.targetPosition !== p)) throw Error("FINAL_GALLERY_NOT_CONTIGUOUS")
  // Only explicitly moved images may cross another original image. REPLACE
  // inherits its source position; ADD/REMOVE shifts are fully materialized.
  const stationary = final.filter(d => d.sourcePosition !== null && d.action !== "REORDER")
  if (stationary.some((d,i) => i > 0 && d.sourcePosition! < stationary[i-1].sourcePosition!)) throw Error("UNAUTHORIZED_IMAGE_REORDER")
  const order = final.map(d => d.assetId ? { kind: "MAYEL_ASSET" as const, assetId: d.assetId } :
    { kind: "CURRENT_OFFICIAL" as const, publicUrl: current[d.sourcePosition!] })
  const base = buildMayelOrderedVisualManifestV2({ ...input, assets: input.assets.filter(a => assets.has(a.assetId)), finalOrder: order })
  const { visualManifestDigest: _old, ...material } = base
  void _old
  const galleryDecisions = decisions.map(d => ({ ...d,
    beforeImage: d.sourcePosition === null ? null : current[d.sourcePosition],
    afterImage: d.targetPosition === null ? null : base.proposedOrderedImages[d.targetPosition].publicUrl,
    expectedSha256: d.assetId ? input.assets.find(a => a.assetId === d.assetId)!.outputSha256 : null,
    expectedIdentity: d.assetId ? `sha256:${input.assets.find(a => a.assetId === d.assetId)!.outputSha256}` : current[d.sourcePosition!],
    productTruthBinding: input.productTruthDigest }))
  const next = { ...material, intentContract: "MAYEL_VISUAL_INTENT_V1", galleryMutationContract: FULL_GALLERY_MUTATION_V1,
    visualIntents: final.filter(d => d.assetId).map(d => ({ assetId: d.assetId!, targetImagePosition: d.targetPosition!,
      visualIntent: d.action === "ADD" ? "ADD_SECONDARY" : d.sourcePosition === 0 ? "REPLACE_MAIN" : "REPLACE_SLOT" })),
    accountKey: input.accountKey, generation: input.generation,
    baseImageSetDigest: mayelVisualDigestV1(current), galleryDecisions,
    galleryActions: [...actions].sort(),
    finalOrderedEbayGallery: final.map((d,p) => ({ ...base.proposedOrderedImages[p], visualRole: d.visualRole,
      action: d.action, sourcePosition: d.sourcePosition, targetPosition: p, intentReason: d.intentReason })),
    slotPreview: galleryDecisions, policy: "EXPLICIT_FULL_GALLERY_DECISION",
    ownerSlotApprovalRequired: false, officialOrderedReadbackRequired: true }
  return Object.freeze({ ...next, visualManifestDigest: mayelVisualDigestV1(next) })
}

/** Rebuild from canonical inputs, never trust a submitted final URL array. */
export function fullGalleryManifestMatchesV1(input: GalleryInput, manifest: Record<string, unknown>) {
  try {
    const { visualManifestDigest, ...material } = manifest
    return mayelVisualDigestV1(material) === visualManifestDigest && buildFullGalleryMutationV1(input).visualManifestDigest === visualManifestDigest
  }
  catch { return false }
}

export function galleryPositionLabelV1(position: number) { return position === 0 ? "Principal" : `Imagen ${position + 1}` }

export function existingGalleryMutationDecisionV1(before: readonly string[], after: readonly string[], m: Record<string, unknown>) {
  const { visualManifestDigest, ...material } = m
  if (mayelVisualDigestV1(material) !== visualManifestDigest) throw Error("GALLERY_MANIFEST_CHANGED")
  if (m.galleryMutationContract !== FULL_GALLERY_MUTATION_V1 || !Array.isArray(m.galleryDecisions) ||
      m.galleryDecisions.some(d => d.assetId || !["KEEP", "REMOVE", "REORDER"].includes(d.action))) throw Error("EXISTING_GALLERY_DECISION_REQUIRED")
  const built = buildFullGalleryMutationV1({ visualTaskId: String(m.visualTaskId), ebayItemId: String(m.ebayItemId),
    accountKey: String(m.accountKey), generation: String(m.generation), currentImages: before, assets: [],
    decisions: m.galleryDecisions as GalleryDecisionV1[], productTruthDigest: String(m.productTruthDigest), sourceImageSetDigest: String(m.sourceImageSetDigest) })
  if (built.visualManifestDigest !== m.visualManifestDigest || JSON.stringify(built.proposedOrderedImages.map(e => e.publicUrl)) !== JSON.stringify(after))
    throw Error("GALLERY_MANIFEST_CHANGED")
  return { changed: JSON.stringify(before) !== JSON.stringify(after), beforeGallery: [...before], afterGallery: [...after],
    actions: built.galleryActions, qa: { pass: true as const, unsupportedClaimCount: 0 as const, competitorContaminationCount: 0 as const },
    why: "MAYEL_EXPLICIT_FULL_GALLERY_DECISION", unauthorizedImageRemovalCount: 0 }
}

export function fullGalleryReadbackV1(expected: readonly string[], official: readonly string[], removed: readonly string[]) {
  const match = expected.length > 0 && expected.length === official.length && expected.every((u,p) => u === official[p]) &&
    removed.every(u => !official.includes(u))
  return { synced: match, state: match ? "SYNCED" : "ORDER_OR_REPLACEMENT_MISMATCH", officialReadback: match }
}

/** Projection of the existing content outbox; task, generation and the currently
 * observed complete gallery must all match its official receipt. */
export function contentGalleryReceiptMatchesV1(input: { taskId: string; itemId: string; manifestDigest: string;
  currentImages: readonly string[]; receipt: Record<string, unknown> }) {
  const r = input.receipt
  return r.task_id === input.taskId && r.item_id === input.itemId && r.manifestDigest === input.manifestDigest &&
    r.state === "SYNCED" && r.official_readback === true && r.readbackItem === input.itemId &&
    r.readbackAuthority === "OFFICIAL_EBAY_CONTENT_READBACK_V1" && input.currentImages.length > 0 &&
    JSON.stringify(r.afterGallery) === JSON.stringify(input.currentImages)
}
