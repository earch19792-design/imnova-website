import { keywordRecord as record, keywordWireDigestV1 as digest,
  consumeListingPackageKeywordHandoffV1, type KeywordBindingV1 } from "./keyword-intelligence-handoff-v1"
import { buildListingCommercialEnvelopeV1, type CommercialComponent } from "./listing-commercial-envelope-v1"
import { buildQuickPickMarketTestListingReviewV1 } from "../ebay/ebay-quick-pick-market-test-package-v1"

export const SELL_ONE_LIKE_THIS_V1 = "SELLER_OS_SELL_ONE_LIKE_THIS_V1"
const rows = (v: unknown) => Array.isArray(v) ? v.map(record) : []
const text = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null
const norm = (v: unknown) => String(v ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
type Classification = "TRANSFERABLE" | "REQUIRES_CORROBORATION" | "REJECTED"

// Only structural names can cross this boundary. Values never enter the output
// package from reference data, even when they happen to equal our own facts.
export function classifyReferenceFieldsV1(reference: Record<string, unknown>) {
  const fields: { field: string; classification: Classification; value: unknown; purpose: string }[] = []
  const add = (field: string, value: unknown, classification: Classification, purpose: string) => {
    if (value !== null && value !== undefined) fields.push({ field, value, classification, purpose })
  }
  add("REFERENCE_ITEM_ID", reference.item_id, "TRANSFERABLE", "PROVENANCE_ONLY")
  add("CATEGORY_ID", reference.categoryId, "REQUIRES_CORROBORATION", "VALIDATE_AGAINST_OUR_PRODUCT")
  for (const [name, value] of Object.entries(record(reference.itemSpecifics)).slice(0, 40)) {
    add(`ASPECT_NAME:${name}`, name, "TRANSFERABLE", "STRUCTURE_ONLY")
    add(`ASPECT_VALUE:${name}`, value, "REQUIRES_CORROBORATION", "OWN_EVIDENCE_REQUIRED")
  }
  for (const [name, value] of Object.entries(record(reference.structural_evidence)).slice(0, 40)) {
    add(`STRUCTURE:${name}`, name, "TRANSFERABLE", "STRUCTURE_ONLY")
    add(`OBSERVED:${name}`, record(value).observed, "REQUIRES_CORROBORATION", "OWN_EVIDENCE_REQUIRED")
  }
  for (const [name, value] of Object.entries(reference)) {
    if (["item_id", "categoryId", "itemSpecifics", "structural_evidence", "structural_classification",
      "structural_compatibility", "plan_id", "marketplace_account_key", "marketplace", "source_observation_id"].includes(name)) continue
    add(name, value, "REJECTED", "COMPETITOR_CONTENT_NOT_IMPORTED")
  }
  return fields
}

export function prepareSellOneLikeThisV1(input: {
  binding: KeywordBindingV1; packageId: string; reference: Record<string, unknown>;
  truthFields: unknown; requiredTruth: unknown; aspectResolutions: unknown;
  category: unknown; keywordRead: unknown; ownPrice: unknown;
  shipping?: Partial<CommercialComponent>; feeHandoff?: unknown; now: Date;
}) {
  const b = input.binding, rt = record(input.requiredTruth), category = record(input.category)
  const allFacts = rows(input.truthFields)
  const validFact = (f: Record<string, unknown>) => f.EVIDENCE_STATUS === "PROVEN" && f.SEMANTIC_CLASS === "FACT" &&
    f.CONTRADICTION === false && ["SUPPLIER", "OWNER"].includes(String(f.SOURCE_AUTHORITY)) &&
    Boolean(text(f.EVIDENCE_ID)) && Boolean(text(f.SOURCE_LOCATOR_OR_FIELD)) &&
    (!f.FRESH_UNTIL || Date.parse(String(f.FRESH_UNTIL)) > input.now.getTime()) &&
    Date.parse(String(f.OBSERVED_AT ?? f.CAPTURED_AT)) <= input.now.getTime()
  const facts = allFacts.filter(validFact)
  const fact = (name: string) => facts.find(f => f.FIELD === name)
  const exact = fact("LUNA_PRODUCT_ID")?.VALUE === b.PRODUCT_ID && fact("LUNA_VARIANT_ID")?.VALUE === b.VARIANT_ID &&
    rt.candidateKey === b.CANDIDATE_KEY && rt.supplierProductId === b.PRODUCT_ID && rt.supplierVariantId === b.VARIANT_ID &&
    rt.exactIdentity === true && rt.marketplaceId === "EBAY_US"
  const keyword = consumeListingPackageKeywordHandoffV1(input.keywordRead, b)
  const ref = input.reference, compatibility = record(ref.structural_compatibility)
  const referencePass = /^\d{9,19}$/.test(String(ref.item_id)) && ref.marketplace_account_key === b.ACCOUNT_KEY &&
    ref.marketplace === "EBAY_US" && ref.plan_id === record(keyword.BINDING).PLAN_ID && Boolean(ref.source_observation_id) &&
    ["CORE_FAMILY_COMPARABLE", "EXACT_COMPARABLE", "STRICT_COMPARABLE", "FAMILY_COMPARABLE"].includes(String(ref.structural_classification)) &&
    compatibility.entityCompatible === true && compatibility.useCompatible === true && compatibility.architectureCompatible === true &&
    compatibility.explicitCountDifference === false && compatibility.explicitSizeDifference === false
  const fields = classifyReferenceFieldsV1(ref)
  const categoryPass = exact && category.candidateKey === b.CANDIDATE_KEY && category.opportunityId === b.OPPORTUNITY_ID &&
    category.listingPackageId === input.packageId && category.marketplaceId === "EBAY_US" &&
    category.status === "AUTO_SELECTED" && record(category.semanticCompatibility).status === "PROVEN" &&
    record(category.semanticCompatibility).categoryId === category.selectedCategoryId &&
    rt.categoryId === category.selectedCategoryId && Boolean(category.taxonomySnapshotDigest) &&
    Array.isArray(category.categorySource) && category.categorySource.includes("PRODUCT_TRUTH")
  const aspects: Record<string, string> = {}, provenance: Record<string, unknown> = {}
  const contracts = rows(rt.aspectContracts)
  const ownSet = record(rt.lunaExactProductEvidenceSetV1)
  const ownSetBound = ownSet.productIdentityExact === true && ownSet.exactSupplierLineageCertified === true &&
    ownSet.lunaProductId === b.PRODUCT_ID && ownSet.lunaVariantId === b.VARIANT_ID && Boolean(ownSet.evidenceDigest)
  for (const [name, raw] of Object.entries(record(rt.resolutions))) {
    const r = record(raw), value = text(r.value ?? r.resolvedValue)
    if (exact && categoryPass && value && r.exactProductSupported === true && /^LUNA_|^OWNER_/.test(String(r.source))) {
      aspects[name] = value; provenance[name] = { authority: rt.authority, evidenceDigest: rt.evidenceDigest, resolution: r }
    }
  }
  // Existing batch mappings must cite an excerpt from this exact product. Never
  // treat an arbitrary persisted aspect or a competitor excerpt as own truth.
  for (const r of rows(input.aspectResolutions)) {
    const name = text(r.aspectName), value = text(r.resolvedValue), source = record(r.sourceEvidence)
    const excerpt = text(source.sourceExcerpt)
    const sourceText = source.sourceField === "DESCRIPTION" ? ownSet.description : source.sourceField === "TITLE" ? ownSet.title : null
    if (exact && categoryPass && ownSetBound && name && value && excerpt && sourceText &&
      r.factInvented === false && r.humanReviewRequired === false && r.confidence === "HIGH" &&
      r.resolutionClass === "DETERMINISTIC_DERIVATION" && norm(sourceText).includes(norm(excerpt)) &&
      norm(excerpt).includes(norm(value)) && !/brand|upc|gtin|mpn|certif|warranty|material|dimension/i.test(name)) {
      aspects[name] = value; provenance[name] = { authority: "EXACT_PRODUCT_BATCH_RESOLUTION", evidenceDigest: ownSet.evidenceDigest, resolution: r }
    }
  }
  const missing = contracts.filter(c => c.required === true && !aspects[String(c.name)]).map(c => String(c.name))
  const invalid = contracts.filter(c => {
    const value = aspects[String(c.name)]
    if (!value) return false
    if (typeof c.maxLength === "number" && value.length > c.maxLength) return true
    return c.freeTextAllowed !== true && (!Array.isArray(c.allowedValues) || !c.allowedValues.includes(value))
  }).map(c => String(c.name))
  const specificsPass = categoryPass && contracts.length > 0 && missing.length === 0 && invalid.length === 0 && Boolean(rt.evidenceDigest)
  const imageFact = fact("IMAGES")
  const images = exact && ownSetBound && ownSet.allExactProductImagesReviewed === true
    ? rows(imageFact?.VALUE).filter(i => typeof i.SOURCE_IMAGE_URL === "string" &&
      /^https:\/\//.test(i.SOURCE_IMAGE_URL) && Array.isArray(ownSet.exactImageUrls) && ownSet.exactImageUrls.includes(i.SOURCE_IMAGE_URL)) : []
  const imagePass = images.length > 0 && images.length === rows(imageFact?.VALUE).length
  const ownTitle = exact ? text(fact("TITLE")?.VALUE) : null
  // Reuse the V2.1 title consumer with a clean own-truth input. No original
  // package description, competitor title, policies or unproven aspects enter it.
  const content = ownTitle && keyword.STATUS === "ACCEPTED" ? buildQuickPickMarketTestListingReviewV1({
    opportunity: { id: b.OPPORTUNITY_ID, candidate_key: b.CANDIDATE_KEY, supplier_product_id: b.PRODUCT_ID,
      product_title: ownTitle, assessment: { productTruth: { title: ownTitle, exact: true } } },
    listingPackage: { id: input.packageId, status: "draft", package_data: { aspects, categoryId: category.selectedCategoryId } },
    keywordDecisionHandoff: input.keywordRead, keywordDecisionBinding: b, requireKeywordDecisionV2_1: true,
  }) : null
  const blockerCodes = [...(!referencePass ? ["REFERENCE_STRUCTURE_UNPROVEN"] : []), ...(!exact ? ["OWN_PRODUCT_BINDING_UNPROVEN"] : []),
    ...(!categoryPass ? ["OWN_CATEGORY_REQUIRED"] : []), ...(!specificsPass ? ["OWN_ITEM_SPECIFICS_REQUIRED"] : []),
    ...(!imagePass ? ["AUTHORIZED_PRODUCT_IMAGES_REQUIRED"] : []), ...(!ownTitle ? ["OWN_TITLE_REQUIRED"] : []), ...keyword.BLOCKERS]
  const proven = (value: unknown, reference: string | null, source: string): Partial<CommercialComponent> =>
    ({ status: "PROVEN", value, reference, source })
  const fee = record(input.feeHandoff), feeAuthority = record(fee.authority)
  const envelope = buildListingCommercialEnvelopeV1({ accountKey: b.ACCOUNT_KEY, packageId: input.packageId, itemId: null, now: input.now,
    components: { account: proven(b.ACCOUNT_KEY, b.ACCOUNT_KEY, "AUTHENTICATED_ACCOUNT"),
      sku: proven(fact("SUPPLIER_SKU")?.VALUE ?? null, text(fact("SUPPLIER_SKU")?.EVIDENCE_ID), "LUNA_EXACT_VARIANT"),
      productCost: proven(fact("SUPPLIER_COST")?.VALUE ?? null, text(fact("SUPPLIER_COST")?.EVIDENCE_ID), "LUNA_EXACT_VARIANT"),
      salePrice: proven(typeof input.ownPrice === "number" && input.ownPrice > 0 ? input.ownPrice : null, input.packageId, "OWN_LISTING_PACKAGE_PRICE"),
      shipping: input.shipping ?? { status: "PENDING" },
      feeAuthority: { status: fee.status === "PROVEN" ? "PROVEN" : "PENDING", value: fee.resolvedAuthority ?? null,
        reference: text(fee.reference), source: "SELLER_OS_EBAY_FEE_AUTHORITY_V1",
        observedAt: text(feeAuthority.observedAt), freshUntil: text(feeAuthority.freshUntil) },
      category: categoryPass ? proven(category.selectedCategoryId, String(category.taxonomySnapshotDigest), "OWN_OFFICIAL_CATEGORY_RESOLUTION") : { status: "PENDING" },
      itemSpecifics: specificsPass ? proven(aspects, String(rt.evidenceDigest), "OWN_PRODUCT_TRUTH") : { status: "PENDING" },
      keywordV2_1: keyword.STATUS === "ACCEPTED" ? proven(keyword.CLASSIFICATIONS, String(keyword.INPUT_FINGERPRINT), "KEYWORD_INTELLIGENCE_V2_1") : { status: "PENDING" },
      images: imagePass ? proven(images, String(imageFact?.EVIDENCE_ID), "REVIEWED_EXACT_SUPPLIER_IMAGE_SET") : { status: "PENDING" },
      listingPackage: proven(input.packageId, input.packageId, "CANONICAL_LISTING_PACKAGE"),
      liveIdentity: { status: "NOT_APPLICABLE" }, metrics: { status: "NOT_APPLICABLE" }, actualFees: { status: "NOT_APPLICABLE" }, sales: { status: "NOT_APPLICABLE" },
    } })
  const preview = content ? { title: content.title, description: [ownTitle, ...Object.entries(aspects).map(([k,v]) => `${k}: ${v}`)].join("\n"),
    categoryId: category.selectedCategoryId, itemSpecifics: aspects, imageUrls: images.map(i => String(i.SOURCE_IMAGE_URL)),
    price: envelope.components.salePrice.value } : null
  const shippingStatus = envelope.components.shipping.status === "PROVEN" ? "SHIPPING_PROVEN" : "WAITING_FOR_DATA"
  const pass = blockerCodes.length === 0 && preview !== null
  const sourceDigest = digest({ b, reference: ref, fields: allFacts, category, requiredTruth: rt, resolutions: input.aspectResolutions,
    keyword: keyword.INPUT_FINGERPRINT, price: input.ownPrice })
  return { contractVersion: SELL_ONE_LIKE_THIS_V1, status: pass ? "PREVIEW_READY" : "WAITING_FOR_DATA",
    referenceItemId: String(ref.item_id ?? ""), sourcePackageId: input.packageId, binding: b,
    referenceImport: { pass: referencePass, fields, counts: {
      TRANSFERABLE: fields.filter(f => f.classification === "TRANSFERABLE").length,
      REQUIRES_CORROBORATION: fields.filter(f => f.classification === "REQUIRES_CORROBORATION").length,
      REJECTED: fields.filter(f => f.classification === "REJECTED").length } },
    categoryValidationPass: categoryPass, itemSpecificsPass: specificsPass, missingSpecifics: missing, invalidSpecifics: invalid,
    keywordV2_1Pass: keyword.STATUS === "ACCEPTED", keyword, imageHandoffPass: imagePass,
    ownProductTruthWins: true, competitorContaminationCount: 0, unsupportedClaimCount: 0,
    sourceProvenance: { product: facts, aspects: provenance, images: { evidenceId: imageFact?.EVIDENCE_ID ?? null,
      ownImageSetDigest: ownSet.imageSetDigest ?? null, images }, referenceObservationId: ref.source_observation_id },
    shippingStatus, commercialEnvelope: envelope, commercialEnvelopePass: true,
    listingPackage: preview ? { status: "DRAFT_PREVIEW", sourcePackageId: input.packageId, content: preview,
      generation: digest({ sourceDigest, preview }), publicationAuthorized: false } : null,
    preview, previewPass: pass, listingPackagePass: pass, sourceDigest, blockers: blockerCodes,
    resume: { authority: "EXISTING_PACKAGE_AND_QUICK_PICK_POST_SHIPPING_CONTINUATION", mode: "ON_EXISTING_READ_PATH",
      candidateKey: b.CANDIDATE_KEY, opportunityId: b.OPPORTUNITY_ID, ownerManualRepairRequired: false },
    safety: { draftOnly: true, canPublish: false, marketplaceWrites: 0, publicationWrites: 0, adsWrites: 0,
      shippingClaims: 0, newPollers: 0, newBackgroundWorkers: 0, legacyKeywordFallback: false, codexRuntimeDependency: false } }
}
