import { buildMayelOrderedVisualManifestV2, mayelVisualDigestV1, type MayelApprovedVisualAssetV1 } from "../ebay/ebay-mayel-visual-workstation-v1"

export type VisualIntentV1 = { assetId: string; visualIntent: "REPLACE_MAIN" | "REPLACE_SLOT" | "ADD_SECONDARY"; targetImagePosition: number; intentReason?: string }
/** A preserved decision wins. Without a proven replacement target, Mayel
 * deliberately preserves the live sequence and places additional coverage last.
 * More specific strategies use the full-gallery decision contract. */
export function decideMayelAssetPositionV1(input: { assetId: string; role: string; currentImages: readonly string[]; manifest: Record<string, unknown> }) : VisualIntentV1 {
  const intents = Array.isArray(input.manifest.visualIntents) ? input.manifest.visualIntents as VisualIntentV1[] : []
  const saved = intents.find(i => i.assetId === input.assetId)
  if (saved) return saved
  if (input.manifest.selectedHeroAssetId === input.assetId) return { assetId: input.assetId, visualIntent: "REPLACE_MAIN", targetImagePosition: 0,
    intentReason: "Mayel ya seleccionó esta propuesta como principal; conserva las demás imágenes." }
  if (!input.role || !input.currentImages.length) throw Error("MAYEL_POSITION_EVIDENCE_REQUIRED")
  const targetImagePosition = input.currentImages.length + intents.filter(i => i.visualIntent === "ADD_SECONDARY").length
  if (targetImagePosition >= 24) throw Error("MAYEL_GALLERY_CAPACITY_REQUIRES_DECISION")
  return { assetId: input.assetId, visualIntent: "ADD_SECONDARY", targetImagePosition,
    intentReason: "Añadir cobertura visual después de la secuencia actual; no hay un reemplazo demostrado para esta propuesta." }
}
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
      action: p >= input.currentImages.length ? "ADD" : e.publicUrl === input.currentImages[p] ? "KEEP" : "REPLACE" })),
    finalOrderedEbayGallery: base.proposedOrderedImages.map((e,p) => ({ ...e, targetPosition: p,
      sourcePosition: p < input.currentImages.length ? p : null,
      visualRole: input.assets.find(a => a.assetId === e.assetId)?.role ?? (p === 0 ? "MAIN" : "CURRENT"),
      action: p >= input.currentImages.length ? "ADD" : e.publicUrl === input.currentImages[p] ? "KEEP" : "REPLACE",
      expectedIdentity: e.outputSha256 ? `sha256:${e.outputSha256}` : e.publicUrl,
      intentReason: input.intents.find(i => i.assetId === e.assetId)?.intentReason ?? (e.assetId ? "Aplicar la intención visual explícita en esta posición." : "Conservar la imagen actual.") })) }
  return Object.freeze({ ...next, visualManifestDigest: mayelVisualDigestV1(next) })
}
