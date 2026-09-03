import { createHash } from "node:crypto"

import { validateOwnerLunaUnbrandedPolicyApplicationV1 } from
  "./ebay-owner-supplier-merchandise-policy-v1"

export const LUNA_EXACT_PRODUCT_EVIDENCE_SET_V1 =
  "LUNA_EXACT_PRODUCT_EVIDENCE_SET_V1" as const
export const LUNA_FULL_PAGE_IMAGE_REVIEW_V1 =
  "LUNA_FULL_PAGE_IMAGE_REVIEW_V1" as const
export const OWNER_LUNA_UNBRANDED_POLICY_SOURCE =
  "OWNER_LUNA_UNBRANDED_POLICY" as const

type JsonRecord = Record<string, unknown>

type LunaExactImageFactV1 = Readonly<{
  specificName: string
  exactValue: string
  imageIndex: number
  sourceExcerpt: string
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 8_000) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, maximum)
    : ""
}

function key(value: unknown) {
  return text(value, 500).normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ").trim()
}

function canonical(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") return `{${Object.entries(
    value as JsonRecord).sort(([left], [right]) => left.localeCompare(right))
    .map(([name, entry]) => `${JSON.stringify(name)}:${canonical(entry)}`)
    .join(",")}}`
  return JSON.stringify(value)
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`
}

function htmlText(value: unknown) {
  return text(typeof value === "string" ? value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/giu, " ").replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, "\"").replace(/&#39;|&apos;/giu, "'")
    : "", 50_000)
}

function strings(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.flatMap((entry) => {
    const candidate = text(entry, 2_000)
    return /^https:\/\//.test(candidate) ? [candidate] : []
  }))] : []
}

function exactImageUrls(catalogRow: JsonRecord | null) {
  if (!catalogRow) return []
  return [...new Set([
    text(catalogRow.featured_image_url, 2_000),
    ...strings(catalogRow.image_urls),
  ].filter((value) => /^https:\/\//.test(value)))]
}

export function lunaExactImageSetDigestV1(imageUrls: readonly string[]) {
  return digest([...imageUrls])
}

export function buildLunaFullPageImageReviewV1(input: Readonly<{
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
  imageUrls: readonly string[]
  brandEvidenceStatus: "NO_EXPLICIT_BRAND" | "EXPLICIT_BRAND" | "CONFLICT"
  explicitBrand?: string | null
  exactFacts?: readonly LunaExactImageFactV1[]
  reviewMethod?: "BOUNDED_COMPLETE_EXACT_IMAGE_REVIEW" |
    "ONE_BOUNDED_OPENAI_BATCH"
  reviewedAt?: string
}>) {
  const reviewedAt = input.reviewedAt ?? new Date().toISOString()
  const explicitBrand = text(input.explicitBrand, 120) || null
  const exactFacts = normalizeExactImageFacts(input.exactFacts,
    input.imageUrls.length)
  if (!/^\d{1,30}$/.test(input.lunaProductId)
      || !/^\d{1,30}$/.test(input.lunaVariantId)
      || !text(input.supplierSku, 120)
      || !Number.isFinite(Date.parse(reviewedAt))
      || exactFacts === null
      || (input.brandEvidenceStatus === "EXPLICIT_BRAND" && !explicitBrand)
      || (input.brandEvidenceStatus !== "EXPLICIT_BRAND" && explicitBrand)) {
    return null
  }
  const core = {
    contractVersion: LUNA_FULL_PAGE_IMAGE_REVIEW_V1,
    lunaProductId: input.lunaProductId,
    lunaVariantId: input.lunaVariantId,
    supplierSku: text(input.supplierSku, 120),
    imageSetDigest: lunaExactImageSetDigestV1(input.imageUrls),
    exactImageCount: input.imageUrls.length,
    reviewedImageCount: input.imageUrls.length,
    allExactProductImagesReviewed: true as const,
    brandEvidenceStatus: input.brandEvidenceStatus,
    explicitBrand,
    exactFacts,
    reviewAuthority: "BOUNDED_EXACT_LUNA_FULL_PAGE_REVIEW" as const,
    reviewMethod: input.reviewMethod ??
      "BOUNDED_COMPLETE_EXACT_IMAGE_REVIEW" as const,
    marketplaceResearchUsed: false as const,
    factInvented: false as const,
    reviewedAt: new Date(reviewedAt).toISOString(),
  }
  return Object.freeze({ ...core, evidenceDigest: digest(core) })
}

function normalizeExactImageFacts(value: unknown, imageCount: number) {
  if (value === undefined) return [] as LunaExactImageFactV1[]
  if (!Array.isArray(value) || value.length > 20) return null
  const normalized: LunaExactImageFactV1[] = []
  for (const raw of value) {
    const fact = record(raw)
    const specificName = text(fact.specificName, 120)
    const exactValue = text(fact.exactValue, 500)
    const sourceExcerpt = text(fact.sourceExcerpt, 500)
    const imageIndex = Number(fact.imageIndex)
    if (!specificName || !exactValue || !sourceExcerpt
        || !Number.isInteger(imageIndex) || imageIndex < 0
        || imageIndex >= imageCount
        || normalized.some((entry) => key(entry.specificName)
          === key(specificName))) return null
    normalized.push(Object.freeze({ specificName, exactValue,
      imageIndex, sourceExcerpt }))
  }
  return normalized
}

function validatedImageReview(input: Readonly<{
  opportunity: JsonRecord
  imageUrls: readonly string[]
}>) {
  const assessment = record(input.opportunity.assessment)
  const review = record(assessment.lunaFullPageImageReviewV1)
  const exactFacts = normalizeExactImageFacts(review.exactFacts,
    input.imageUrls.length)
  const { evidenceDigest, ...core } = review
  const exact = review.contractVersion === LUNA_FULL_PAGE_IMAGE_REVIEW_V1
    && review.lunaProductId === input.opportunity.supplier_product_id
    && review.lunaVariantId === input.opportunity.supplier_variant_id
    && review.supplierSku === input.opportunity.supplier_sku
    && review.imageSetDigest === lunaExactImageSetDigestV1(input.imageUrls)
    && review.exactImageCount === input.imageUrls.length
    && review.reviewedImageCount === input.imageUrls.length
    && review.allExactProductImagesReviewed === true
    && ["NO_EXPLICIT_BRAND", "EXPLICIT_BRAND", "CONFLICT"]
      .includes(String(review.brandEvidenceStatus ?? ""))
    && review.reviewAuthority === "BOUNDED_EXACT_LUNA_FULL_PAGE_REVIEW"
    && ["BOUNDED_COMPLETE_EXACT_IMAGE_REVIEW",
      "ONE_BOUNDED_OPENAI_BATCH"].includes(String(review.reviewMethod ?? ""))
    && review.marketplaceResearchUsed === false
    && review.factInvented === false
    && exactFacts !== null
    && typeof review.reviewedAt === "string"
    && Number.isFinite(Date.parse(review.reviewedAt))
    && /^sha256:[0-9a-f]{64}$/.test(String(evidenceDigest ?? ""))
    && evidenceDigest === digest(core)
  if (!exact) return null
  const explicitBrand = text(review.explicitBrand, 120) || null
  if (review.brandEvidenceStatus === "EXPLICIT_BRAND" && !explicitBrand) {
    return null
  }
  if (review.brandEvidenceStatus !== "EXPLICIT_BRAND" && explicitBrand) {
    return null
  }
  return review
}

function stringRecord(value: unknown, maximumEntries = 100) {
  return Object.fromEntries(Object.entries(record(value)).flatMap(
    ([name, entry]) => {
      const normalizedName = text(name, 120)
      const normalizedValue = text(entry, 1_000)
      return normalizedName && normalizedValue
        ? [[normalizedName, normalizedValue] as const] : []
    }).slice(0, maximumEntries))
}

function sectionStatus(present: boolean) {
  return present ? "CAPTURED" as const : "NOT_PRESENT_ON_EXACT_LUNA_PAGE" as const
}

function stableDurableProductTruth(value: unknown) {
  const truth = record(value)
  const sourceEvidence = record(truth.sourceEvidence)
  const priorRequiredTruth = record(
    sourceEvidence.requiredItemSpecificsTruthV1)
  const priorResolutions = record(priorRequiredTruth.resolutions)
  const resolverDerivedAspects = new Set(Object.entries(priorResolutions)
    .flatMap(([name, raw]) => record(raw).exactProductSupported === true
      ? [key(name)] : []))
  const upstreamProvenProductValues = Object.fromEntries(Object.entries(
    stringRecord(truth.provenProductValues)).filter(([name]) =>
    !resolverDerivedAspects.has(key(name))))
  const { requiredItemSpecificsTruthV1: _requiredTruth,
    ...upstreamSourceEvidence } = sourceEvidence
  return {
    authorityClass: text(truth.authorityClass, 120),
    candidateKey: text(truth.candidateKey, 120),
    lunaProductId: text(truth.lunaProductId, 30),
    lunaVariantId: text(truth.lunaVariantId, 30),
    supplierSku: text(truth.supplierSku, 120),
    title: text(truth.title, 350),
    gtin: text(truth.gtin, 120),
    brand: record(truth.brand),
    upstreamProvenProductValues,
    upstreamSourceEvidence,
  }
}

function quantityConflicts(description: string) {
  const declared = [...description.matchAll(
    /\b(?:includes?|set\s+(?:includes?|of))\s+(\d{1,3})\s+(?:pre[- ]?cut\s+)?(?:led\s+)?(?:pieces?|pcs?|strips?|items?)\b/giu,
  )].map((match) => Number(match[1])).filter(Number.isFinite)
  const enumerated = [...description.matchAll(
    /\b(\d{1,3})\s*[x×]\s*\d+(?:[.,]\d+)?\s*(?:in(?:ches?)?|cm|mm|ft|feet)\b/giu,
  )].map((match) => Number(match[1])).filter(Number.isFinite)
  if (declared.length !== 1 || enumerated.length < 2) return []
  const enumeratedTotal = enumerated.reduce((sum, value) => sum + value, 0)
  return enumeratedTotal !== declared[0] ? [Object.freeze({
    conflictCode: "DECLARED_PACKAGE_QUANTITY_CONFLICT",
    affectedFacts: Object.freeze(["Package Quantity", "Number in Pack"]),
    declaredQuantity: declared[0], enumeratedQuantity: enumeratedTotal,
    sourceConflictDetected: true as const,
  })] : []
}

export function buildLunaExactProductEvidenceSetV1(input: Readonly<{
  opportunity: JsonRecord
  catalogRow: JsonRecord | null
}>) {
  const row = input.catalogRow
  const exactIdentity = Boolean(row
    && row.supplier_product_id === input.opportunity.supplier_product_id
    && row.supplier_variant_id === input.opportunity.supplier_variant_id
    && row.sku === input.opportunity.supplier_sku)
  const description = exactIdentity ? htmlText(row?.body_html) : ""
  const images = exactIdentity ? exactImageUrls(row) : []
  const imageReview = exactIdentity ? validatedImageReview({
    opportunity: input.opportunity, imageUrls: images }) : null
  const productMetadata = exactIdentity
    ? stringRecord(row?.product_metadata) : {}
  const variantMetadata = exactIdentity
    ? stringRecord(row?.metadata) : {}
  const durableProductTruth = exactIdentity
    ? record(record(input.opportunity.assessment).productTruth) : {}
  const existingDurableProductTruth = exactIdentity
    ? stableDurableProductTruth(durableProductTruth) : {}
  const title = exactIdentity ? text(row?.title, 350) : ""
  const variantTitle = exactIdentity ? text(row?.variant_title, 240) : ""
  const hasFeatureSection = /\b(?:key\s+)?features?\s*:/iu.test(description)
    || /\bproduct\s+features?\b/iu.test(description)
  const hasMaterialsCare = /\bmaterials?(?:\s+and|\s*&)?\s+care\b/iu
    .test(description)
  const evidenceCore = {
    contractVersion: LUNA_EXACT_PRODUCT_EVIDENCE_SET_V1,
    exactSupplierLineageCertified: exactIdentity,
    productIdentityExact: exactIdentity,
    lunaProductId: text(input.opportunity.supplier_product_id, 30),
    lunaVariantId: text(input.opportunity.supplier_variant_id, 30),
    supplierSku: text(input.opportunity.supplier_sku, 120),
    title,
    variantTitle,
    description,
    productMetadata,
    variantMetadata,
    existingDurableProductTruth,
    productType: exactIdentity ? text(row?.product_type, 160) : "",
    tags: exactIdentity && Array.isArray(row?.tags)
      ? row!.tags.map((entry) => text(entry, 120)).filter(Boolean) : [],
    exactImageUrls: images,
    exactImageCount: images.length,
    imageSetDigest: lunaExactImageSetDigestV1(images),
    allExactProductImagesReviewed:
      images.length === 0 || imageReview?.allExactProductImagesReviewed === true,
    imageBrandEvidenceStatus: imageReview?.brandEvidenceStatus ??
      (images.length === 0 ? "NO_EXPLICIT_BRAND" : "UNREVIEWED"),
    imageExplicitBrand: text(imageReview?.explicitBrand, 120) || null,
    imageExactFacts: imageReview
      ? normalizeExactImageFacts(imageReview.exactFacts, images.length) ?? []
      : [],
    sectionCoverage: {
      structuredProductJson: sectionStatus(exactIdentity),
      variantData: sectionStatus(exactIdentity),
      mainProductTitle: sectionStatus(Boolean(title)),
      mainProductSummary: sectionStatus(Boolean(description)),
      fullNarrativeDescription: sectionStatus(Boolean(description)),
      productFeaturesSection: sectionStatus(hasFeatureSection),
      materialsAndCareSection: sectionStatus(hasMaterialsCare),
      allExactProductImages: sectionStatus(images.length === 0
        || imageReview?.allExactProductImagesReviewed === true),
      existingDurableProductTruth: sectionStatus(Boolean(
        Object.keys(durableProductTruth).length)),
    },
    sourceConflicts: quantityConflicts(description),
    marketplaceResearchUsed: false as const,
    factInvented: false as const,
  }
  return Object.freeze({ ...evidenceCore,
    evidenceDigest: digest(evidenceCore) })
}

const SUPPLIER_NAMES = new Set([
  "luna", "luna warehouse", "luna portex", "lunaportex", "my store",
])

function explicitBrandCandidates(evidence: ReturnType<
  typeof buildLunaExactProductEvidenceSetV1>) {
  const candidates: Array<Readonly<{ value: string, sourceField:
    "TITLE" | "DESCRIPTION" | "SPECS" | "VARIANT" | "IMAGE", excerpt: string,
    imageIndex: number | null, strength: number }>> = []
  const structured = {
    ...evidence.productMetadata,
    ...evidence.variantMetadata,
  }
  for (const [name, value] of Object.entries(structured)) {
    if (!["brand", "manufacturer", "product brand", "manufacturer brand"]
      .includes(key(name)) || SUPPLIER_NAMES.has(key(value))) continue
    candidates.push({ value: text(value, 120), sourceField: "SPECS",
      excerpt: `${name}: ${text(value, 120)}`, imageIndex: null, strength: 3 })
  }
  for (const source of [evidence.title, evidence.description]) {
    const labeled = source.match(
      /(?:^|[\n;|])\s*(?:manufacturer\s+)?brand\s*[:#=-]\s*([^\n;|]{1,100})/iu,
    )
    if (labeled && !SUPPLIER_NAMES.has(key(labeled[1]))) {
      candidates.push({ value: text(labeled[1], 120),
        sourceField: source === evidence.title ? "TITLE" : "DESCRIPTION",
        excerpt: text(labeled[0], 180), imageIndex: null, strength: 3 })
    }
  }
  const relational = [
    /\ball\s+([A-Z][A-Za-z0-9&.'’+-]{1,39}(?:\s+[A-Z][A-Za-z0-9&.'’+-]{1,39}){0,2})\s+products\b/gu,
    /\b([A-Z][A-Za-z0-9&.'’+-]{1,39}(?:\s+[A-Z][A-Za-z0-9&.'’+-]{1,39}){0,2})\s+combines\b/gu,
  ]
  for (const pattern of relational) {
    for (const match of evidence.description.matchAll(pattern)) {
      if (!SUPPLIER_NAMES.has(key(match[1]))) candidates.push({
        value: text(match[1], 120), sourceField: "DESCRIPTION",
        excerpt: text(match[0], 180), imageIndex: null, strength: 2,
      })
    }
  }
  if (evidence.imageBrandEvidenceStatus === "EXPLICIT_BRAND"
      && evidence.imageExplicitBrand) candidates.push({
    value: evidence.imageExplicitBrand, sourceField: "IMAGE",
    excerpt: evidence.imageExplicitBrand, imageIndex: null, strength: 3,
  })
  return candidates
}

function officialValue(input: Readonly<{
  proposed: string
  freeTextAllowed: boolean
  allowedValues: readonly string[]
  allowedValuesComplete: boolean
  maxLength?: number | null
}>) {
  if (typeof input.maxLength === "number"
      && input.maxLength > 0 && input.proposed.length > input.maxLength) {
    return null
  }
  if (input.freeTextAllowed || !input.allowedValuesComplete) {
    return text(input.proposed, 500) || null
  }
  return input.allowedValues.find((value) => key(value) === key(input.proposed))
    ?? null
}

export type LunaFullPageRequiredFactResolutionV1 = Readonly<{
  value: string
  source: "EXPLICIT_LUNA_EVIDENCE" | typeof OWNER_LUNA_UNBRANDED_POLICY_SOURCE |
    "DETERMINISTIC_DERIVATION" | "LUNA_CONTEXTUAL_DERIVATION" |
    "EBAY_SEMANTIC_MAPPING"
  sourceField: "TITLE" | "DESCRIPTION" | "SPECS" | "VARIANT" | "IMAGE" |
    "OWNER_POLICY"
  sourceExcerpt: string
  evidenceEntailsValue: true
  materialConflict: false
  factInvented: false
  fullPageGapDiagnostic: "CAPTURED_BUT_NOT_EXTRACTED" |
    "EXTRACTED_BUT_NOT_PROMOTED_TO_PRODUCT_TRUTH" |
    "SEMANTIC_MAPPING_GAP"
}>

function result(input: Omit<LunaFullPageRequiredFactResolutionV1,
  "evidenceEntailsValue" | "materialConflict" | "factInvented" |
  "fullPageGapDiagnostic">):
LunaFullPageRequiredFactResolutionV1 {
  const fullPageGapDiagnostic = input.source === "OWNER_LUNA_UNBRANDED_POLICY"
    ? "EXTRACTED_BUT_NOT_PROMOTED_TO_PRODUCT_TRUTH" as const
    : input.source === "EBAY_SEMANTIC_MAPPING"
      ? "SEMANTIC_MAPPING_GAP" as const
      : "CAPTURED_BUT_NOT_EXTRACTED" as const
  return Object.freeze({ ...input, evidenceEntailsValue: true,
    materialConflict: false, factInvented: false, fullPageGapDiagnostic })
}

export function resolveLunaFullPageRequiredFactV1(input: Readonly<{
  opportunity: JsonRecord
  evidence: ReturnType<typeof buildLunaExactProductEvidenceSetV1>
  specificName: string
  freeTextAllowed: boolean
  allowedValues: readonly string[]
  allowedValuesComplete: boolean
  maxLength?: number | null
}>) {
  if (!input.evidence.exactSupplierLineageCertified
      || !input.evidence.productIdentityExact) return null
  const aspect = key(input.specificName)
  const aspectHasMaterialConflict = input.evidence.sourceConflicts.some(
    (conflict) => conflict.affectedFacts.some((name) => key(name) === aspect))
  if (aspectHasMaterialConflict) return null
  const exactImageFact = input.evidence.imageExactFacts.find((fact) =>
    key(fact.specificName) === aspect)
  if (exactImageFact) {
    const value = officialValue({ proposed: exactImageFact.exactValue,
      freeTextAllowed: input.freeTextAllowed,
      allowedValues: input.allowedValues,
      allowedValuesComplete: input.allowedValuesComplete,
      maxLength: input.maxLength })
    if (value) return result({ value, source: "EXPLICIT_LUNA_EVIDENCE",
      sourceField: "IMAGE", sourceExcerpt: exactImageFact.sourceExcerpt })
  }
  if (aspect === "brand") {
    const candidates = explicitBrandCandidates(input.evidence)
    const grouped = new Map<string, typeof candidates>()
    for (const candidate of candidates) grouped.set(key(candidate.value), [
      ...(grouped.get(key(candidate.value)) ?? []), candidate,
    ])
    if (grouped.size > 1
        || input.evidence.imageBrandEvidenceStatus === "CONFLICT") return null
    if (grouped.size === 1) {
      const evidence = [...grouped.values()][0]
        .sort((left, right) => right.strength - left.strength)[0]
      const value = officialValue({ proposed: evidence.value,
        freeTextAllowed: input.freeTextAllowed,
        allowedValues: input.allowedValues,
        allowedValuesComplete: input.allowedValuesComplete,
        maxLength: input.maxLength })
      if (value) return result({ value, source: "EXPLICIT_LUNA_EVIDENCE",
        sourceField: evidence.sourceField,
        sourceExcerpt: evidence.excerpt })
    }
    const application = record(record(input.opportunity.assessment)
      .ownerLunaUnbrandedPolicyApplicationV1)
    const policyValid = validateOwnerLunaUnbrandedPolicyApplicationV1(
      application, { lunaProductId: input.opportunity.supplier_product_id,
        lunaVariantId: input.opportunity.supplier_variant_id,
        supplierSku: input.opportunity.supplier_sku })
    const unbranded = officialValue({ proposed: "Unbranded",
      freeTextAllowed: input.freeTextAllowed,
      allowedValues: input.allowedValues,
      allowedValuesComplete: input.allowedValuesComplete,
      maxLength: input.maxLength })
    if (policyValid && unbranded
        && input.evidence.allExactProductImagesReviewed
        && input.evidence.imageBrandEvidenceStatus === "NO_EXPLICIT_BRAND") {
      return result({ value: unbranded,
        source: OWNER_LUNA_UNBRANDED_POLICY_SOURCE,
        sourceField: "OWNER_POLICY",
        sourceExcerpt: "FULL_EXACT_LUNA_PAGE_REVIEW_FOUND_NO_BRAND" })
    }
    return null
  }
  const corpus = `${input.evidence.title}\n${input.evidence.variantTitle}\n${
    input.evidence.description}`
  if (aspect === "model" && input.freeTextAllowed) {
    const model = corpus.match(
      /\b(?:product\s+)?model\s*[:#=-]\s*([A-Z0-9][A-Z0-9._/-]{1,39})\b/iu)
    const proposed = model?.[1] ?? null
    const value = proposed ? officialValue({ proposed,
      freeTextAllowed: input.freeTextAllowed,
      allowedValues: input.allowedValues,
      allowedValuesComplete: input.allowedValuesComplete,
      maxLength: input.maxLength }) : null
    if (model && value) return result({ value,
      source: "EXPLICIT_LUNA_EVIDENCE", sourceField: "DESCRIPTION",
      sourceExcerpt: text(model[0], 180) })
  }
  if (aspect === "type" && input.freeTextAllowed) {
    const match = corpus.match(
      /\b(?:multicolor\s+|rgb\s+|usb(?:-powered)?\s+)?(led\s+(?:tv\s+)?backlight\s+strips?)\b/iu,
    )
    const proposed = match && (/s$/iu.test(match[1])
      ? match[1].replace(/s$/iu, "") : match[1])
    const value = proposed ? officialValue({ proposed,
      freeTextAllowed: input.freeTextAllowed,
      allowedValues: input.allowedValues,
      allowedValuesComplete: input.allowedValuesComplete,
      maxLength: input.maxLength }) : null
    if (match && value) return result({ value,
      source: "LUNA_CONTEXTUAL_DERIVATION", sourceField: "DESCRIPTION",
      sourceExcerpt: text(match[0], 180) })
    const sideSleeper = /\bside\s+sleeper\b/iu.exec(corpus)
    const pillow = /\bpillow\b/iu.exec(corpus)
    const sideSleeperValue = sideSleeper && pillow
      ? officialValue({ proposed: "Side Sleeper Pillow",
        freeTextAllowed: input.freeTextAllowed,
        allowedValues: input.allowedValues,
        allowedValuesComplete: input.allowedValuesComplete,
        maxLength: input.maxLength }) : null
    if (sideSleeper && pillow && sideSleeperValue) return result({
      value: sideSleeperValue, source: "LUNA_CONTEXTUAL_DERIVATION",
      sourceField: "DESCRIPTION",
      sourceExcerpt: `${sideSleeper[0]}; ${pillow[0]}`,
    })
  }
  if (aspect === "size" && input.freeTextAllowed) {
    const adjustable = /\badjustable\s+width\b/iu.exec(corpus)
    const age = /\bnewborns?\s+up\s+to\s+(\d{1,2})\s+months?\b/iu.exec(corpus)
    const proposed = adjustable && age
      ? `Adjustable - Newborn up to ${age[1]} Months` : null
    const value = proposed ? officialValue({ proposed,
      freeTextAllowed: input.freeTextAllowed,
      allowedValues: input.allowedValues,
      allowedValuesComplete: input.allowedValuesComplete,
      maxLength: input.maxLength }) : null
    if (adjustable && age && value) return result({
      value,
      source: "LUNA_CONTEXTUAL_DERIVATION", sourceField: "DESCRIPTION",
      sourceExcerpt: `${adjustable[0]}; ${age[0]}`,
    })
  }
  if (aspect === "department" && !input.freeTextAllowed) {
    const unisexKids = input.allowedValues.find((value) =>
      key(value) === "unisex kids")
    const childUse = /\b(?:school\s+use|kids?|children|newborns?|baby)\b/iu
      .test(corpus)
    const gendered = /\b(?:boys?|girls?|mens?|womens?)\b/iu.test(corpus)
    if (unisexKids && childUse && !gendered) return result({
      value: unisexKids, source: "EBAY_SEMANTIC_MAPPING",
      sourceField: "DESCRIPTION",
      sourceExcerpt: text(corpus.match(
        /\b(?:school\s+use|kids?|children|newborns?|baby)\b/iu)?.[0], 180),
    })
  }
  return null
}
