import { keywordRecord as record, keywordWireDigestV1 as digest, consumeListingPackageKeywordHandoffV1,
  KEYWORD_DECISION_VERSION, type KeywordBindingV1 } from "./keyword-intelligence-handoff-v1"
import { commercialComponentV1, type CommercialComponent } from "./listing-commercial-envelope-v1"
import { publicationInventoryAuthorityV1 } from "./publication-inventory-authority-v1"
import { publicationEvidenceMaterialityV1, sameKeywordSemanticsV1 } from './publication-evidence-materiality-v1'

const rows = (v: unknown) => Array.isArray(v) ? v.map(record) : []
const hash = (v: unknown) => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v)
function freeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v) }
  return v
}
export type PipelineCurrentAuthorityV1 = { binding: KeywordBindingV1; accountKey: string; packageId: string; sku: string;
  truthFields: unknown; requiredTruth: unknown; aspectResolutions: unknown; category: unknown; keywordRead: unknown;
  reference: Record<string, unknown>; ownPrice: unknown; shipping?: Partial<CommercialComponent>; feeHandoff?: unknown;
  sellerPolicies?: unknown; quantityReview?: unknown; currentQuantityMaterial?: unknown;
  exposurePolicy?: unknown; productTruthDigest?: string; pinnedSnapshot?: unknown; pinnedPackageHash?: unknown; now: Date }

// Audit an existing generation. This never rebuilds its content or mutates it.
// Fresh commercial observations form a new evaluation, not a new package.
export function listingPipelineConsistencyV1(existing: unknown, a: PipelineCurrentAuthorityV1) {
  const r = record(existing), p = record(r.listingPackage), content = record(p.content), b = record(r.binding), rt = record(a.requiredTruth), c = record(a.category)
  const facts = rows(a.truthFields), fact = (name: string) => facts.filter(f => f.FIELD === name)
  const valid = (f: Record<string, unknown>) => f.EVIDENCE_STATUS === "PROVEN" && f.CONTRADICTION === false && f.SEMANTIC_CLASS === "FACT" &&
    ["SUPPLIER", "OWNER"].includes(String(f.SOURCE_AUTHORITY)) && Boolean(f.EVIDENCE_ID) && Boolean(f.SOURCE_LOCATOR_OR_FIELD) &&
    Number.isFinite(Date.parse(String(f.OBSERVED_AT ?? f.CAPTURED_AT))) && Date.parse(String(f.OBSERVED_AT ?? f.CAPTURED_AT)) <= a.now.getTime() &&
    (!f.FRESH_UNTIL || Date.parse(String(f.FRESH_UNTIL)) > a.now.getTime())
  const one = (name: string, value: unknown) => fact(name).length === 1 && valid(fact(name)[0]) && fact(name)[0].VALUE === value
  const product = one("LUNA_PRODUCT_ID", a.binding.PRODUCT_ID) && b.PRODUCT_ID === a.binding.PRODUCT_ID && rt.supplierProductId === a.binding.PRODUCT_ID && rt.exactIdentity === true
  const variation = one("LUNA_VARIANT_ID", a.binding.VARIANT_ID) && b.VARIANT_ID === a.binding.VARIANT_ID && rt.supplierVariantId === a.binding.VARIANT_ID
  const account = Boolean(a.accountKey) && a.binding.ACCOUNT_KEY === a.accountKey && b.ACCOUNT_KEY === a.accountKey &&
    record(r.commercialEnvelope).accountKey === a.accountKey
  const sku = Boolean(a.sku) && one("SUPPLIER_SKU", a.sku) && record(record(record(r.commercialEnvelope).components).sku).value === a.sku
  const lineage = b.OPPORTUNITY_ID === a.binding.OPPORTUNITY_ID && b.CANDIDATE_KEY === a.binding.CANDIDATE_KEY &&
    rt.candidateKey === a.binding.CANDIDATE_KEY && r.sourcePackageId === a.packageId && p.sourcePackageId === a.packageId
  const category = c.candidateKey === a.binding.CANDIDATE_KEY && c.opportunityId === a.binding.OPPORTUNITY_ID && c.listingPackageId === a.packageId &&
    c.marketplaceId === "EBAY_US" && rt.marketplaceId === "EBAY_US" && c.status === "AUTO_SELECTED" &&
    record(c.semanticCompatibility).status === "PROVEN" && record(c.semanticCompatibility).categoryId === c.selectedCategoryId &&
    c.selectedCategoryId === content.categoryId && rt.categoryId === content.categoryId && hash(c.taxonomySnapshotDigest) &&
    Array.isArray(c.categorySource) && c.categorySource.includes("PRODUCT_TRUTH")
  const aspects = record(content.itemSpecifics), aspectSources = record(record(r.sourceProvenance).aspects)
  const specifics = category && r.itemSpecificsPass === true && rows(rt.aspectContracts).length > 0 &&
    rows(rt.aspectContracts).every(contract => (!contract.required || Boolean(aspects[String(contract.name)])) &&
      (!aspects[String(contract.name)] || (contract.freeTextAllowed === true ||
        Array.isArray(contract.allowedValues) && contract.allowedValues.includes(aspects[String(contract.name)])))) &&
    Object.keys(aspects).every(k => Boolean(record(aspectSources[k]).evidenceDigest))
  const keyword = consumeListingPackageKeywordHandoffV1(a.keywordRead, a.binding), oldKeyword = record(r.keyword)
  const keywordPinned = keyword.STATUS === "ACCEPTED" && keyword.DECISION_VERSION === KEYWORD_DECISION_VERSION &&
    oldKeyword.DECISION_VERSION === KEYWORD_DECISION_VERSION &&
    sameKeywordSemanticsV1(oldKeyword,keyword) &&
    oldKeyword.LEGACY_FALLBACK_USED === false
  const ownSet = record(rt.lunaExactProductEvidenceSetV1), imageFact = fact("IMAGES")[0]
  const images = Array.isArray(content.imageUrls) ? content.imageUrls : []
  const imageProvenance = product && variation && fact("IMAGES").length === 1 && valid(imageFact) &&
    ownSet.lunaProductId === a.binding.PRODUCT_ID && ownSet.lunaVariantId === a.binding.VARIANT_ID &&
    ownSet.productIdentityExact === true && ownSet.exactSupplierLineageCertified === true && ownSet.allExactProductImagesReviewed === true &&
    Boolean(ownSet.evidenceDigest) && images.length > 0 && images.every(url => rows(imageFact.VALUE).some(i => i.SOURCE_IMAGE_URL === url) &&
      Array.isArray(ownSet.exactImageUrls) && ownSet.exactImageUrls.includes(url))
  const currentSourceDigest = digest({ b: a.binding, reference: a.reference, fields: a.truthFields, category: a.category,
    requiredTruth: a.requiredTruth, resolutions: a.aspectResolutions, keyword: keyword.INPUT_FINGERPRINT, price: a.ownPrice })
  const materiality = publicationEvidenceMaterialityV1(existing,a)
  const sourcePinned = currentSourceDigest === r.sourceDigest || materiality.equivalent
  const generation = hash(p.generation) && p.generation === digest({ sourceDigest: r.sourceDigest, preview: content }) && digest(content) === digest(r.preview)
  const contamination = r.competitorContaminationCount === 0 && r.ownProductTruthWins === true && sourcePinned && generation
  const claims = r.unsupportedClaimCount === 0 && sourcePinned && generation
  const ambiguous = ["LUNA_PRODUCT_ID", "LUNA_VARIANT_ID", "SUPPLIER_SKU", "IMAGES"].filter(k => fact(k).length !== 1).length
  const checks = { EXACT_PRODUCT_BINDING: product, EXACT_ACCOUNT_BINDING: account, EXACT_SKU_BINDING: sku,
    EXACT_VARIATION_BINDING: variation, CATEGORY_BINDING_VALID: category, ITEM_SPECIFICS_BINDING_VALID: specifics,
    KEYWORD_V2_1_VERSION_PINNED: keywordPinned, IMAGE_PROVENANCE_VALID: imageProvenance, PACKAGE_LINEAGE_MATCH: lineage,
    SOURCE_EVIDENCE_MATCH: sourcePinned, GENERATION_MATCH: generation, OUR_PRODUCT_TRUTH_WINS: contamination && claims }
  const inconsistencies = Object.entries(checks).filter(([,v]) => !v).map(([k]) => k)
  const fromFact = (name: string): CommercialComponent => {
    const f = fact(name)[0] ?? {}
    return commercialComponentV1({ status: fact(name).length === 1 && valid(f) ? "PROVEN" : "PENDING", value: f.VALUE ?? null,
      reference: typeof f.EVIDENCE_ID === "string" ? f.EVIDENCE_ID : null, source: typeof f.SOURCE_AUTHORITY === "string" ? f.SOURCE_AUTHORITY : null,
      observedAt: String(f.OBSERVED_AT ?? f.CAPTURED_AT ?? ""), freshUntil: typeof f.FRESH_UNTIL === "string" ? f.FRESH_UNTIL : null }, a.now)
  }
  const fee = record(a.feeHandoff), feeAuthority = record(fee.authority)
  const policies = record(a.sellerPolicies)
  const policiesProven = policies.account_key === a.accountKey && policies.marketplace_id === "EBAY_US" &&
    Number.isFinite(Date.parse(String(policies.verified_at))) && Date.parse(String(policies.verified_at)) <= a.now.getTime() &&
    Date.parse(String(policies.expires_at)) > a.now.getTime() &&
    ["fulfillment_policy_id", "payment_policy_id", "return_policy_id", "merchant_location_key"].every(k => typeof policies[k] === "string" && Boolean(policies[k]))
  const quantityMaterial = record(a.currentQuantityMaterial)
  const quantityContentMatches = quantityMaterial.title === content.title && quantityMaterial.description === content.description &&
    quantityMaterial.categoryId === content.categoryId && quantityMaterial.price === content.price &&
    digest(quantityMaterial.itemSpecifics) === digest(content.itemSpecifics) && digest(quantityMaterial.imageUrls) === digest(content.imageUrls)
  const inventory = publicationInventoryAuthorityV1({ availability: fact("SUPPLIER_AVAILABILITY").length === 1 ? fact("SUPPLIER_AVAILABILITY")[0] : null,
    numericStock: fact("SUPPLIER_STOCK").length === 1 ? fact("SUPPLIER_STOCK")[0] : null,
    exactBinding: product && variation && account && sku && lineage, now: a.now,
    packageId: a.packageId, sku: a.sku, productId: a.binding.PRODUCT_ID, variantId: a.binding.VARIANT_ID,
    quantityReview: a.quantityReview, currentQuantityMaterial: quantityContentMatches ? quantityMaterial : null,
    exposurePolicy: a.exposurePolicy, accountKey: a.accountKey, productTruthDigest: a.productTruthDigest })
  const evidence = { productCost: fromFact("SUPPLIER_COST"), inventory: {
    ...commercialComponentV1({ status: inventory.inventoryReady ? "PROVEN" : inventory.freshness === "STALE" ? "STALE" : "PENDING",
      value: inventory.listingQuantity, reference: inventory.reference, source: "LUNA_AVAILABILITY_WITH_SEPARATE_PACKAGE_EXPOSURE_V1",
      observedAt: inventory.observedAt, freshUntil: inventory.freshUntil }, a.now), ...inventory },
    salePrice: commercialComponentV1({ status: typeof a.ownPrice === "number" && a.ownPrice > 0 && content.price === a.ownPrice ? "PROVEN" : "PENDING",
      value: a.ownPrice, reference: a.packageId, source: "OWN_LISTING_PACKAGE_PRICE" }, a.now),
    shipping: commercialComponentV1(a.shipping ?? {}, a.now),
    feeAuthority: commercialComponentV1({ status: fee.status === "PROVEN" ? "PROVEN" : "PENDING", value: fee.resolvedAuthority ?? null,
      reference: typeof fee.reference === "string" ? fee.reference : null, source: "SELLER_OS_EBAY_FEE_AUTHORITY_V1",
      freshUntil: typeof feeAuthority.freshUntil === "string" ? feeAuthority.freshUntil : null }, a.now),
    // Presence alone is not evidence of exact account/category policy authority.
    sellerPolicies: { status: policiesProven ? "PROVEN" : "PENDING", present: Object.keys(policies).length > 0, authority: "ebay_account_policy_profiles", reference: policiesProven ? digest(policies) : null } }
  const waiting = Object.entries(evidence).filter(([,e]) => e.status !== "PROVEN").map(([k]) => k)
  const consistent = inconsistencies.length === 0 && ambiguous === 0
  const sourceEvidenceReferences = [...new Set([a.packageId, r.sourceDigest, c.taxonomySnapshotDigest, rt.evidenceDigest,
    keyword.INPUT_FINGERPRINT, ...facts.map(f => f.EVIDENCE_ID)].filter((v): v is string => typeof v === "string" && v.length > 0))]
  const currentMaterial = { binding: { ...a.binding, SKU: a.sku }, generation: p.generation, content, sourceEvidenceReferences }
  const pinned=record(a.pinnedSnapshot)
  const pinnedValid=sourcePinned && generation && hash(a.pinnedPackageHash) && digest(pinned)===a.pinnedPackageHash &&
    digest(pinned.binding)===digest(currentMaterial.binding) && pinned.generation===p.generation &&
    digest(pinned.content)===digest(content) && Array.isArray(pinned.sourceEvidenceReferences) &&
    pinned.sourceEvidenceReferences[0]===a.packageId && pinned.sourceEvidenceReferences.includes(r.sourceDigest) &&
    pinned.sourceEvidenceReferences.includes(oldKeyword.INPUT_FINGERPRINT)
  // The immutable package keeps its original evidence pins. A fresh evaluation
  // carries the replacement receipts separately, after semantic equivalence.
  const material = pinnedValid ? pinned : currentMaterial
  const packageHash = generation ? digest(material) : null
  // Preparation identity only. It conveys no approval and does not replace the
  // publisher's authorization/execution idempotency contracts.
  const publicationPreparationKey = consistent && packageHash ? `listing-package-preview:v1:${packageHash.slice(7)}` : null
  return freeze({ contractVersion: "SELLER_OS_LISTING_PIPELINE_CONSISTENCY_GATE_V1", ...checks,
    LEGACY_KEYWORD_FALLBACK: false, COMPETITOR_CONTAMINATION_COUNT: contamination ? 0 : null,
    UNSUPPORTED_CLAIM_COUNT: claims ? 0 : null, AMBIGUOUS_BINDING_COUNT: ambiguous,
    STALE_EVIDENCE_USED_AS_CURRENT: 0, PACKAGE_CONSISTENT: consistent,
    PACKAGE_HASH_PRESENT: Boolean(packageHash), PACKAGE_HASH: packageHash, GENERATION_PRESENT: generation,
    SOURCE_EVIDENCE_REFERENCES_PRESENT: sourceEvidenceReferences.length > 0,
    IMMUTABLE: generation, snapshot: generation ? JSON.parse(JSON.stringify(material)) as unknown : null,
    PUBLICATION_IDEMPOTENCY_KEY_READY: Boolean(publicationPreparationKey), publicationPreparationKey,
    PUBLICATION_AUTHORIZATION_GRANTED: false, READY_TO_PUBLISH: consistent && waiting.length === 0,
    SHIPPING_STATUS: evidence.shipping.status === "PROVEN" ? "FRESH" : "WAITING_FOR_DATA",
    status: consistent ? waiting.length ? "PACKAGE_CONSISTENT_WAITING_FOR_DATA" : "PACKAGE_CONSISTENT" : "REQUIRES_REVIEW", evidence, waiting, inconsistencies,
    evidenceMateriality:materiality,currentEvidenceLineage:{sourceEvidenceReferences,currentSourceDigest,observedAt:a.now.toISOString()},
    evaluationObservedAt: a.now.toISOString(), reevaluation: "EXISTING_READ_PATH_AND_POST_SHIPPING_CONTINUATION",
    CODEX_RUNTIME_DEPENDENCY: false, safety: { publicationWrites: 0, adsWrites: 0, marketplaceWrites: 0, newPollers: 0, newBackgroundWorkers: 0 } })
}
