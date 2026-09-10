import { buildMayelOrderedVisualManifestV2, mayelVisualDigestV1, type MayelApprovedVisualAssetV1 } from "../ebay/ebay-mayel-visual-workstation-v1"

export type VisualIntentV1 = { assetId: string; visualIntent: "REPLACE_MAIN" | "REPLACE_SLOT" | "ADD_SECONDARY"; targetImagePosition: number }
export function visualIntentOrderV1(current: readonly string[], intents: readonly VisualIntentV1[]) {
  if (!current.length || current.length > 24 || new Set(current).size !== current.length ||
      current.some(u => !/^https:\/\//.test(u)) || !intents.length || intents.length > 6 ||
      new Set(intents.map(i => i.assetId)).size !== intents.length ||
      new Set(intents.map(i => i.targetImagePosition)).size !== intents.length) throw Error("VISUAL_INTENT_BINDING_INVALID")
  const order: { kind: "CURRENT_OFFICIAL" | "MAYEL_ASSET"; publicUrl?: string; assetId?: string }[] = current.map(publicUrl => ({ kind: "CURRENT_OFFICIAL", publicUrl }))
  for (const i of [...intents].sort((a,b) => a.targetImagePosition-b.targetImagePosition)) {
    const p = i.targetImagePosition
    if (!i.assetId || !Number.isInteger(p) || p < 0 || p >= 24 ||
      (i.visualIntent === "REPLACE_MAIN" && p !== 0) ||
      (i.visualIntent === "REPLACE_SLOT" && (p === 0 || p >= current.length)) ||
      (i.visualIntent === "ADD_SECONDARY" && (p !== order.length || p === 0)) ||
      !["REPLACE_MAIN", "REPLACE_SLOT", "ADD_SECONDARY"].includes(i.visualIntent)) throw Error("VISUAL_INTENT_POSITION_INVALID")
    order[p] = { kind: "MAYEL_ASSET", assetId: i.assetId }
  }
  return order
}
export function buildVisualIntentManifestV1(input: { visualTaskId: string; ebayItemId: string; currentImages: readonly string[];
  assets: readonly MayelApprovedVisualAssetV1[]; intents: readonly VisualIntentV1[]; productTruthDigest: string; sourceImageSetDigest: string }) {
  const order = visualIntentOrderV1(input.currentImages, input.intents)
  const onlyReplace = input.intents.every(i => i.visualIntent !== "ADD_SECONDARY")
  const base = buildMayelOrderedVisualManifestV2({ ...input, finalOrder: order,
    slotReplacements: onlyReplace ? input.intents.map(i => ({ assetId: i.assetId, targetImagePosition: i.targetImagePosition })) : undefined })
  const { visualManifestDigest: _oldDigest, ...material } = base
  void _oldDigest
  const next = { ...material, intentContract: "MAYEL_VISUAL_INTENT_V1", visualIntents: input.intents.map(i => ({ ...i })),
    intentPolicy: input.intents.length === 1 && input.intents[0].visualIntent === "REPLACE_MAIN" ? "REPLACE_POSITION_0_ONLY" : "EXPLICIT_POSITIONS_ONLY",
    ownerPerImageApproval: true, ownerDecisionRequiredBeforeAuthorization: true,
    ownerPreviewRequired: true, ownerApprovalIsWriteAuthority: true, mayelApprovalIsWriteAuthority: false,
    slotPreview: base.proposedOrderedImages.map((e,p) => ({ targetImagePosition: p,
      visualIntent: input.intents.find(i => i.targetImagePosition === p)?.visualIntent ?? "KEEP",
      assetId: e.assetId, before: input.currentImages[p] ?? null, after: e.publicUrl,
      action: p >= input.currentImages.length ? "ADD" : e.publicUrl === input.currentImages[p] ? "KEEP" : "REPLACE" })) }
  return Object.freeze({ ...next, visualManifestDigest: mayelVisualDigestV1(next) })
}
