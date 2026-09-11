import { createHash } from "node:crypto"

const digest = (v: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(v)).digest("hex")}`
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}
function urls(v: unknown): string[] | null {
  if (!Array.isArray(v) || !v.length || v.length > 24) return null
  const parsed = v.map(x => {
    try { const u = new URL(String(x)); return u.protocol === "https:" && !u.username && !u.password && !u.hash ? u.href : null } catch { return null }
  })
  return parsed.every((x): x is string => x !== null) ? parsed : null
}

// LIVE PictureDetails is authoritative even for an Inventory-managed listing.
// Inventory product.imageUrls remains separate transport/write evidence.
export function currentLiveGalleryV1(official: { pictureUrls: readonly string[] } | null) {
  return [...(official?.pictureUrls ?? [])]
}

export function galleryDriftEvidenceV1(input: {
  binding: Record<string, unknown>; currentUrls: readonly string[]; currentObservedAt: string | null;
  currentReadbackReference: string; official: boolean; proposalObservedAt?: string;
  // Only the existing official ordered-image verifier may supply this proof.
  orderedIdentityProof?: { verified: boolean; method: string; baselineDigest: string; currentDigest: string };
}) {
  const audit = record(input.binding.optimizationAudit)
  const baseline = record(input.binding.baselineGallery)
  const baselineUrls = urls(baseline.urls ?? audit.before)
  const currentUrls = urls(input.currentUrls)
  const proposal = record(input.binding.galleryProposal)
  const after = Array.isArray(proposal.images) ? proposal.images.map(record) : Array.isArray(audit.after) ? audit.after.map(record) : []
  const proposedUrls = urls(after.map(x => x.publicUrl))
  const baselineDigest = baselineUrls ? digest(baselineUrls) : null
  const currentDigest = currentUrls ? digest(currentUrls) : null
  const proposedDigest = proposedUrls ? digest(proposedUrls) : null
  const baselineValid = Boolean(baselineUrls && baselineDigest === input.binding.baseImageHash)
  const equivalent = input.official && baselineValid && baselineUrls?.length === currentUrls?.length && input.orderedIdentityProof?.verified === true &&
    input.orderedIdentityProof.baselineDigest === baselineDigest && input.orderedIdentityProof.currentDigest === currentDigest &&
    ["EXACT_EXTERNAL_URLS", "EXACT_PICTURE_URLS", "PERCEPTUAL_EPS"].includes(input.orderedIdentityProof.method)
  const classification = !baselineValid || !currentUrls || !input.official ? "BASELINE_EVIDENCE_DEFECT" :
    baselineDigest === currentDigest ? "NO_DRIFT" : equivalent ? "NON_MATERIAL_DRIFT" : "MATERIAL_EXTERNAL_DRIFT"
  const entries = (set: string[] | null) => (set ?? []).map((url, position) => ({ position, normalizedUrl: url, identity: `url:${url}` }))
  const baselineEntries = entries(baselineUrls), currentEntries = entries(currentUrls)
  // For rewritten URLs a proven ordered correspondence supplies stable baseline
  // identities, rather than guessing from an eBay filename/query string.
  if (equivalent && baselineEntries.length === currentEntries.length) currentEntries.forEach((e, i) => { e.identity = baselineEntries[i].identity })
  const beforeIds = baselineEntries.map(e => e.identity), currentIds = currentEntries.map(e => e.identity)
  return {
    contract: "MAYEL_GALLERY_DRIFT_EVIDENCE_V1", DRIFT_CLASSIFICATION: classification,
    BASELINE_DIGEST: baselineDigest, CURRENT_DIGEST: currentDigest, PROPOSED_DIGEST: proposedDigest,
    recordedBaselineDigest: input.binding.baseImageHash ?? null, baselineEvidenceValid: baselineValid,
    BASELINE_GALLERY: { count: baselineEntries.length, images: baselineEntries, digest: baselineDigest,
      observedAt: baseline.observedAt ?? input.binding.baseObservedAt ?? null, sourceReference: baseline.sourceReference ?? "OUTBOX_OPTIMIZATION_AUDIT_BEFORE" },
    CURRENT_EBAY_GALLERY: { count: currentEntries.length, images: currentEntries, digest: currentDigest,
      observedAt: input.currentObservedAt, sourceReference: input.currentReadbackReference, official: input.official },
    PROPOSED_GALLERY: { count: proposedUrls?.length ?? 0, digest: proposedDigest,
      images: after.map((a, position) => ({ position, assetId: a.assetId ?? null, normalizedUrl: proposedUrls?.[position] ?? null,
        identity: typeof a.outputSha256 === "string" ? `sha256:${a.outputSha256}` : null })),
      sourceReference: proposal.manifestDigest ?? record(audit.mayelDecision).visualManifestDigest ?? null,
      observedAt: proposal.recordedAt ?? input.proposalObservedAt ?? null },
    ADDED_ASSETS: currentEntries.filter(e => !beforeIds.includes(e.identity)),
    REMOVED_ASSETS: baselineEntries.filter(e => !currentIds.includes(e.identity)),
    REORDERED_ASSETS: currentEntries.filter(e => beforeIds.includes(e.identity) && beforeIds.indexOf(e.identity) !== e.position),
    orderedIdentityProof: input.orderedIdentityProof ?? null,
  }
}
