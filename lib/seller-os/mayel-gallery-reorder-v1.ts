import { keywordWireDigestV1 as digest } from "./keyword-intelligence-handoff-v1"
export function galleryReorderDecisionV1(before: readonly string[], after: readonly string[]) {
  if (!before.length || before.length > 24 || before.length !== after.length || new Set(before).size !== before.length ||
      new Set(after).size !== after.length || after.some(u => !before.includes(u)) || before.some(u => !/^https:\/\//.test(u)))
    throw Error("GALLERY_REORDER_MUST_PRESERVE_ALL_IMAGES")
  return { changed: digest(before) !== digest(after), beforeGallery: [...before], afterGallery: [...after],
    actions: ["IMAGE_REORDER"], qa: { pass: true as const, unsupportedClaimCount: 0 as const, competitorContaminationCount: 0 as const },
    why: "MAYEL_EXPLICIT_ORDER_OF_CURRENT_OFFICIAL_IMAGES", unauthorizedImageRemovalCount: 0 }
}
