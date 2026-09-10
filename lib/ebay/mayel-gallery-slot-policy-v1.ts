export type GalleryReplacementV1 = Readonly<{ targetImagePosition: number; assetId: string }>

/** A replacement is position-bound; unselected positions can neither move nor disappear. */
export function replacementSlotOrderV1(currentImages: readonly string[], replacements: readonly GalleryReplacementV1[]) {
  if (!currentImages.length || currentImages.length > 24 || new Set(currentImages).size !== currentImages.length ||
      currentImages.some(url => !/^https:\/\//.test(url)) || !replacements.length ||
      new Set(replacements.map(r => r.targetImagePosition)).size !== replacements.length ||
      new Set(replacements.map(r => r.assetId)).size !== replacements.length ||
      replacements.some(r => !Number.isInteger(r.targetImagePosition) || r.targetImagePosition < 0 ||
        r.targetImagePosition >= currentImages.length || !/^[0-9a-f-]{36}$/i.test(r.assetId))) {
    throw Error("MAYEL_VISUAL_SLOT_BINDING_INVALID")
  }
  return currentImages.map((publicUrl, targetImagePosition) => {
    const replacement = replacements.find(r => r.targetImagePosition === targetImagePosition)
    return replacement ? { kind: "MAYEL_ASSET" as const, assetId: replacement.assetId }
      : { kind: "CURRENT_OFFICIAL" as const, publicUrl }
  })
}

export function gallerySlotPreviewV1(currentImages: readonly string[], proposedImages: readonly string[]) {
  if (!currentImages.length || currentImages.length !== proposedImages.length) return null
  return currentImages.map((beforeImage, targetImagePosition) => ({ targetImagePosition,
    beforeImage, afterImage: proposedImages[targetImagePosition],
    action: beforeImage === proposedImages[targetImagePosition] ? "KEEP" as const : "REPLACE" as const }))
}

export function slotManifestMatchesGalleryV1(manifest: Record<string, unknown>, currentImages: readonly string[]) {
  if (manifest.galleryPolicy !== "REPLACE_APPROVED_SLOTS_ONLY" || !Array.isArray(manifest.slotReplacements) ||
      !Array.isArray(manifest.proposedOrderedImages)) return false
  try {
    const order = replacementSlotOrderV1(currentImages, manifest.slotReplacements)
    const proposed = manifest.proposedOrderedImages as { assetId?: string; publicUrl?: string }[]
    return order.length === proposed.length && order.every((entry, position) => entry.kind === "MAYEL_ASSET"
      ? proposed[position]?.assetId === entry.assetId
      : proposed[position]?.publicUrl === entry.publicUrl)
  } catch { return false }
}
