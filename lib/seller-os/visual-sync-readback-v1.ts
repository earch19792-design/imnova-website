/** Exact ordered URLs only. No thumbnail guessing or perceptual substitution. */
export function approvedVisualReadbackMatchesV1(input: {
  official: boolean; ownerApproved: boolean; baseListingCompatible: boolean;
  approvedManifestDigest: string | null; currentManifestDigest: string | null;
  expectedImages: readonly string[]; currentImages: readonly string[];
  liveGalleryVerified?: boolean;
}) {
  return input.official && input.liveGalleryVerified !== false && input.ownerApproved && input.baseListingCompatible &&
    Boolean(input.approvedManifestDigest) && input.approvedManifestDigest === input.currentManifestDigest &&
    input.expectedImages.length > 0 && input.expectedImages.length === input.currentImages.length &&
    input.expectedImages.every((url,index) => /^https:\/\//.test(url) && url === input.currentImages[index])
}
