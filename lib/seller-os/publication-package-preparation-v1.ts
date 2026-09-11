import { keywordRecord as record, keywordWireDigestV1 as digest } from "./keyword-intelligence-handoff-v1"
import { canonicalEbayPackageSku } from "../ebay/ebay-sku"

export const PACKAGE_EXPOSURE_POLICY_V1 = "SELLER_OS_PACKAGE_LISTING_EXPOSURE_V1"
export const PACKAGE_PREVIEW_REVISION_V1 = "SELLER_OS_PACKAGE_PREVIEW_REVISION_V1"

// An explicit OWNER extension of the existing one-unit exposure cap. This is
// neither supplier stock nor publication authorization. Product Truth changes
// invalidate the grant; unrelated title/description revisions do not.
export function packageExposurePolicyV1(value: unknown, binding: {
  accountKey: string; packageId: string; productId: string; variantId: string;
  sku: string; productTruthDigest: string; now: Date;
}) {
  const p = record(value), b = record(p.binding)
  const valid = p.version === PACKAGE_EXPOSURE_POLICY_V1 && p.status === "ACTIVE" &&
    p.scope === "EXACT_NEW_PACKAGE_EXPOSURE" && p.quantity === 1 && p.supplierQuantityInferred === false &&
    p.publicationAuthorized === false && p.sourcePolicy === "QUICK_PICK_REMOTE_OWNER_REVIEW_V1" &&
    typeof p.authorizedBy === "string" && Boolean(p.authorizedBy) &&
    typeof p.authorizationReference === "string" && Boolean(p.authorizationReference) &&
    Date.parse(String(p.authorizedAt)) <= binding.now.getTime() &&
    ["accountKey", "packageId", "productId", "variantId", "sku", "productTruthDigest"].every(k =>
      Boolean(binding[k as keyof typeof binding]) && b[k] === binding[k as keyof typeof binding]) &&
    /^sha256:[a-f0-9]{64}$/.test(binding.productTruthDigest)
  return { valid, quantity: valid ? 1 : null, version: PACKAGE_EXPOSURE_POLICY_V1,
    scope: valid ? p.scope : null, reference: valid ? digest(p) : null }
}

export function buildPackagePreviewRevisionV1(input: {
  certified: unknown; consistency: unknown; publication: unknown; exposure: unknown; now: Date;
  currentConfiguration?: unknown;
}) {
  const g = record(input.consistency), s = record(g.snapshot), b = record(s.binding), c = record(s.content)
  const p = record(input.publication), exposure = record(input.exposure)
  // A historical Preview is audit/identity evidence, never a payload template.
  // Missing CURRENT preparation fields remain missing for the existing validator.
  const configuration = record(input.currentConfiguration)
  if (g.PACKAGE_CONSISTENT !== true || g.IMMUTABLE !== true || g.PACKAGE_HASH_PRESENT !== true ||
    !/^sha256:[a-f0-9]{64}$/.test(String(g.PACKAGE_HASH)) ||
    p.phase !== "preview_ready" || Number(p.publish_attempt_count) !== 0 || p.publication_idempotency_key || p.claim_token || p.listing_id ||
    !Array.isArray(s.sourceEvidenceReferences) || p.listing_package_id !== s.sourceEvidenceReferences[0] ||
    p.marketplace_account_key !== b.ACCOUNT_KEY || p.sku !== canonicalEbayPackageSku(p.listing_package_id) ||
    !String(b.ACCOUNT_KEY).endsWith(`:${p.account_fingerprint}`) ||
    exposure.valid !== true || exposure.quantity !== 1) throw Error("PUBLICATION_REVISION_PRECONDITION_FAILED")
  const preview = {
    version: PACKAGE_PREVIEW_REVISION_V1, target: configuration.target, marketplaceId: "EBAY_US",
    permittedOperation: "INTERNAL_PREVIEW_ONLY", offerId: null, draftExecutionId: null, draftApprovalId: null,
    imageUrls: c.imageUrls, imageCount: Array.isArray(c.imageUrls) ? c.imageUrls.length : 0,
    listingPackageId: p.listing_package_id, opportunityId: b.OPPORTUNITY_ID, candidateKey: b.CANDIDATE_KEY,
    sku: p.sku, accountFingerprint: p.account_fingerprint,
    inventoryItemPayload: { ...(configuration.condition ? {condition:configuration.condition} : {}), availability: { shipToLocationAvailability: { quantity: 1 } },
      product: { title: c.title, description: c.description,
        aspects: Object.fromEntries(Object.entries(record(c.itemSpecifics)).map(([k, v]) => [k, [v]])), imageUrls: c.imageUrls } },
    offerPayload: { ...(configuration.listingPolicies ? {listingPolicies:configuration.listingPolicies} : {}),
      ...(configuration.merchantLocationKey ? {merchantLocationKey:configuration.merchantLocationKey} : {}),
      sku: p.sku, categoryId: c.categoryId, marketplaceId: "EBAY_US",
      format: "FIXED_PRICE", availableQuantity: 1, listingDescription: c.description,
      pricingSummary: { price: { value: String(c.price), currency: "USD" } } },
  }
  // Configuration must come from CURRENT policy/condition authorities at the
  // server caller. This revision creates neither a preparation ACK nor a grant.
  return { version: PACKAGE_PREVIEW_REVISION_V1, publicationId: p.id, packageId: p.listing_package_id,
    accountKey: b.ACCOUNT_KEY, productId: b.PRODUCT_ID, variantId: b.VARIANT_ID, sku: b.SKU,
    packageGeneration: s.generation, packageHash: g.PACKAGE_HASH, preview, previewHash: digest(preview),
    revisionKey: `publication-preview:${p.id}:${String(g.PACKAGE_HASH).slice(7)}:${digest(preview).slice(7)}`,
    priorPreviewHash: p.preview_hash, priorDraftExecutionId: p.draft_execution_id,
    certifiedPackage: input.certified, snapshot: s, createdAt: input.now.toISOString(),
    preparationStatus: "INTERNAL_PREVIEW_ONLY", ebayPrevalidated: false, publicationAuthorized: false }
}

export function currentPackagePreviewRevisionV1(value: unknown, consistency: unknown, publication: unknown, activation?: unknown) {
  const r = record(value), g = record(consistency), s = record(g.snapshot), b = record(s.binding), p = record(publication)
  const a = record(activation), rp = record(r.preview), pp = record(p.preview)
  const activated = a.publicationId === p.id && a.draftExecutionId === p.draft_execution_id && a.previewHash === p.preview_hash &&
    Number.isFinite(Date.parse(String(a.activatedAt))) &&
    digest(rp.inventoryItemPayload) === digest(pp.inventoryItemPayload) &&
    digest(rp.offerPayload) === digest(pp.offerPayload)
  const valid = r.version === PACKAGE_PREVIEW_REVISION_V1 && g.PACKAGE_CONSISTENT === true &&
    r.publicationId === p.id && r.packageId === p.listing_package_id && r.accountKey === p.marketplace_account_key &&
    r.productId === b.PRODUCT_ID && r.variantId === b.VARIANT_ID && r.sku === b.SKU &&
    r.packageGeneration === s.generation && r.packageHash === g.PACKAGE_HASH &&
    digest(r.snapshot) === digest(s) && digest(r.preview) === r.previewHash &&
    (activated || r.priorPreviewHash === p.preview_hash && r.priorDraftExecutionId === p.draft_execution_id)
  return { valid, revision: valid ? r : null,
    // Never inherit OFFER_READY from an obsolete draft execution.
    publication: valid && !activated ? { ...p, preview: r.preview, phase: "draft" } : p }
}
