import type { FinalListingReviewPublicationGate } from "./final-listing-review-publication-gate"
import { keywordRecord as record, keywordWireDigestV1 as digest } from "../seller-os/keyword-intelligence-handoff-v1"

export function currentPreparationBindingValidV1(value: unknown, pkg: unknown, op: unknown, fingerprint: string, now = new Date()) {
  const a=record(value), r=record(a.revision), p=record(pkg), o=record(op), i=record(a.inventory)
  const b=record(record(r.snapshot).binding)
  return a.operation === "PREPARE_UNPUBLISHED_ONLY" && a.publicationAuthorized === false && a.packageConsistent === true && a.brandSupported === true &&
    r.version === "SELLER_OS_PACKAGE_PREVIEW_REVISION_V1" && r.packageId === p.id && r.accountKey === p.account_key &&
    String(r.accountKey).endsWith(`:${fingerprint}`) && /^[a-f0-9]{64}$/.test(fingerprint) &&
    r.productId === o.supplier_product_id && r.variantId === o.supplier_variant_id && r.sku === o.supplier_sku &&
    b.ACCOUNT_KEY === r.accountKey && b.PRODUCT_ID === r.productId && b.VARIANT_ID === r.variantId && b.SKU === r.sku &&
    b.OPPORTUNITY_ID === o.id && b.CANDIDATE_KEY === p.candidate_key && o.candidate_key === p.candidate_key &&
    r.packageGeneration === record(r.snapshot).generation && r.packageHash === digest(r.snapshot) && r.previewHash === digest(r.preview) &&
    i.inventoryReady === true && i.availability === "IN_STOCK" && i.freshness === "FRESH" && i.listingQuantity === 1 &&
    Date.parse(String(i.observedAt)) <= now.getTime() && Date.parse(String(i.freshUntil)) > now.getTime()
}

export function projectCurrentPreparationPackageV1(pkg: unknown, authority: unknown) {
  const p=record(pkg), a=record(authority), r=record(a.revision), c=record(record(r.snapshot).content), old=record(p.package_data)
  return {...p,package_data:{...old,title:c.title,description:c.description,categoryId:c.categoryId,
    aspects:Object.fromEntries(Object.entries(record(c.itemSpecifics)).map(([k,v])=>[k,[v]])),imageUrls:c.imageUrls,
    pricing:{...record(old.pricing),targetPrice:c.price}}}
}

// Compare the complete marketplace content, not just identity or an old ACK.
export function currentPreparationPayloadMatchesV1(authority: unknown, payload: unknown) {
  const r=record(record(authority).revision), expected=record(r.preview), actual=record(payload)
  const inv=record(actual.inventoryItemPayload), offer=record(actual.offerPayload)
  const ei=record(expected.inventoryItemPayload), eo=record(expected.offerPayload)
  return actual.sku === expected.sku && digest(inv) === digest(ei) && digest(offer) === digest(eo)
}

export function currentPreparationApprovalMatchesV1(authority: unknown, payload: unknown) {
  const r=record(record(authority).revision), m=record(record(record(payload).compliance).publicationPreparationRevisionV1)
  return m.publicationId === r.publicationId && m.packageHash === r.packageHash &&
    m.packageGeneration === r.packageGeneration && m.previewHash === r.previewHash &&
    m.operation === "PREPARE_UNPUBLISHED_ONLY" && m.publicationAuthorized === false &&
    currentPreparationPayloadMatchesV1(authority,payload)
}

// Adapt the already-certified current-source-gallery assessment to the existing
// image binding gate. This performs no QA approval and grants no publication.
export function currentPreparationVisualGateV1(authority: unknown): FinalListingReviewPublicationGate {
  const a=record(authority), r=record(a.revision), image=record(a.imageAuthority)
  const urls=record(record(r.snapshot).content).imageUrls
  const count=Array.isArray(urls)?urls.length:0
  const allowed=a.packageConsistent === true && image.pass === true &&
    image.contractVersion === "SELLER_OS_CURRENT_SOURCE_GALLERY_PUBLICATION_V1" &&
    image.packageHash === r.packageHash && image.generation === r.packageGeneration &&
    image.imageCount === count && count > 0 && image.marketplaceWrites === 0 && image.publicationAuthorized === false
  return {required:true,allowed,reason:allowed?null:"CURRENT_REVISION_IMAGE_AUTHORITY_UNPROVEN",
    reviewId:null,revisionId:null,attemptId:null,previewHash:String(r.previewHash??""),
    finalVisualSetLocked:allowed,generationControlsHidden:true,readyForUnpublishedOfferAuthorization:allowed,
    visualPhase:allowed?"CURRENT_CERTIFIED_FULL_SOURCE_GALLERY":null,providerCallsSnapshot:0,
    selectedAssets:count,passedAssets:allowed?count:0,source:"APPROVED_LUNA_SUPPLIER_IMAGE_AUTOMATED_QA"}
}

// A matched durable write/readback receipt proves only CURRENT non-LIVE payload
// acceptance. It does not activate the publication ledger or authorize publish.
export function currentUnpublishedPayloadAcceptedV1(publication: unknown, revision: unknown, now=new Date()) {
 const p=record(publication),r=record(revision),receipt=record(record(p.sanitized_result).currentUnpublishedPreparationV1)
 const b=record(receipt.binding),result=record(receipt.result),offer=record(result.offerReadback),inventory=record(result.inventoryReadback)
 return receipt.version==='CURRENT_UNPUBLISHED_PREPARATION_V1' && receipt.key===digest(b) &&
  receipt.state==='READBACK_CONFIRMED' && receipt.publicationAuthorized===false &&
  Number.isFinite(Date.parse(String(receipt.observedAt))) && Date.parse(String(receipt.observedAt))<=now.getTime() &&
  b.publicationId===p.id && b.publicationId===r.publicationId && b.packageId===p.listing_package_id && b.packageId===r.packageId &&
  b.accountKey===p.marketplace_account_key && b.accountKey===r.accountKey && b.offerId===p.offer_id &&
  b.sku===record(r.preview).sku && b.packageHash===r.packageHash && b.packageGeneration===r.packageGeneration && b.previewHash===r.previewHash &&
  r.packageHash===digest(r.snapshot) && record(r.snapshot).generation===r.packageGeneration &&
  r.previewHash===digest(r.preview) && result.pass===true && inventory.safe===true && offer.safe===true &&
  offer.offerId===b.offerId && offer.sku===b.sku && offer.status==='UNPUBLISHED' && offer.listingPresent===false && offer.payloadMatches===true
}
