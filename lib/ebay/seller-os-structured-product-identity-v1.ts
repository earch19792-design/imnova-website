import { createHash } from "node:crypto"

export const SELLER_OS_STRUCTURED_PRODUCT_IDENTITY_V1 =
  "SELLER_OS_STRUCTURED_PRODUCT_IDENTITY_V1_3" as const
export const SELLER_OS_IDENTITY_FIRST_TRACE_POLICY_V1 =
  "SELLER_OS_IDENTITY_FIRST_TRACE_POLICY_V1" as const
export const SELLER_OS_COMMERCIAL_TRACE_ANALYSIS_VERSION =
  "SELLER_OS_COMMERCIAL_TRACE_IDENTITY_FIRST_V1_3" as const

type EvidenceSource = "LUNA_PRODUCT_TITLE" | "LUNA_VARIANT_TITLE" |
  "LUNA_PRODUCT_TYPE" | "LUNA_PRODUCT_DESCRIPTION" | "LUNA_STRUCTURED_GTIN"

export type StructuredIdentityEvidenceV1 = Readonly<{
  field: string
  value: string
  source: EvidenceSource
  rule: string
}>

export type StructuredProductIdentityV1 = Readonly<{
  version: typeof SELLER_OS_STRUCTURED_PRODUCT_IDENTITY_V1
  productFamily: string | null
  canonicalFamilyPhrase: string | null
  formFactors: readonly string[]
  audience: string | null
  color: string | null
  receiverSize: string | null
  pinDiameter: string | null
  dimensions: string | null
  edgeFeature: string | null
  sizeDescriptor: string | null
  model: string | null
  gtin: string | null
  functionalDifferentiators: readonly string[]
  identitySufficient: boolean
  insufficiencyReasons: readonly string[]
  evidence: readonly StructuredIdentityEvidenceV1[]
  queryPlan: Readonly<{
    exactStrong: string | null
    nearExactFamily: string | null
    functionalFamily: string | null
    broadFallback: string | null
    progression: readonly string[]
  }>
}>

/**
 * Durable Luna SKU identity.  A supplier SKU is only useful as a canonical
 * identity when it is bound to the exact Luna product and variant that were
 * read.  Keeping the three source keys together prevents downstream views
 * from falling back to a title (or to an unrelated opportunity SKU).
 */
export type CanonicalLunaSkuIdentityV1 = Readonly<{
  source: "LUNA_PORTEX"
  productId: string | null
  variantId: string | null
  supplierSku: string | null
  key: string | null
  status: "PROVEN" | "UNPROVEN"
  provenance: "LUNA_STRUCTURED_PRODUCT_VARIANT" | "MISSING_SOURCE_IDENTITY"
}>

export function buildCanonicalLunaSkuIdentityV1(input: Readonly<{
  productId?: string | null
  variantId?: string | null
  supplierSku?: string | null
}>) : CanonicalLunaSkuIdentityV1 {
  const productId = String(input.productId ?? "").trim() || null
  const variantId = String(input.variantId ?? "").trim() || null
  const supplierSku = String(input.supplierSku ?? "").normalize("NFKC")
    .trim() || null
  const complete = Boolean(productId && variantId && supplierSku)
  return Object.freeze({ source: "LUNA_PORTEX", productId, variantId,
    supplierSku, key: complete
      ? `LUNA_PORTEX:${productId}:${variantId}:${supplierSku}` : null,
    status: complete ? "PROVEN" : "UNPROVEN",
    provenance: complete ? "LUNA_STRUCTURED_PRODUCT_VARIANT"
      : "MISSING_SOURCE_IDENTITY" })
}

const COLORS = ["black", "white", "brown", "blue", "red", "pink", "green",
  "grey", "gray", "silver", "gold", "navy"] as const
const LOW_SIGNAL = new Set(["for", "with", "and", "the", "a", "an", "of",
  "to", "in", "on", "tool", "product", "item", "new", "portable"])
const LEADING_TITLE_DESCRIPTORS = new Set(["new", "portable", "professional",
  "compact", "instant", "painless", "premium", "deluxe", "small",
  "medium", "large", "xl", "xxl", "xlarge", "extra-large"])
const NON_PRODUCT_FAMILY_HEADS = new Set(["kit", "set", "tool", "tools",
  "product", "item", "accessory", "accessories", "supplies"])

function normalize(value: unknown) {
  return String(value ?? "").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US")
    .replace(/[（）()]/g, " ").replace(/[^a-z0-9/.-]+/g, " ")
    .replace(/\s+/g, " ").trim()
}

function titleCase(value: string) {
  return value.split(" ").map((token) => ["usb", "hd", "uhd"].includes(token)
    ? token.toUpperCase() : `${token[0].toUpperCase()}${token.slice(1)}`)
    .join(" ")
}

function unique(values: readonly (string | null | undefined)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function boundedQuery(parts: readonly (string | null | undefined)[]) {
  const seen = new Set<string>()
  const tokens = parts.join(" ").split(/\s+/).map((token) => token.trim())
    .filter((token) => (token.length > 1 || /^\d$/.test(token)) &&
      !LOW_SIGNAL.has(token))
    .filter((token) => !seen.has(token) && Boolean(seen.add(token)))
  const value = tokens.slice(0, 12).join(" ").slice(0, 180).trim()
  return value.length >= 3 ? value : null
}

function explicitCommercialModel(value: string) {
  const explicit = value.match(/\b(?:model|mpn|part\s+number)\s*[:#-]?\s*([a-z0-9][a-z0-9-]{3,30})\b/i)?.[1]
  if (explicit) return explicit.toUpperCase()
  for (const match of value.matchAll(/\b[a-z0-9][a-z0-9-]{4,30}\b/gi)) {
    const token = match[0]
    const preceding = match.index ? value[match.index - 1] : ""
    if (preceding === "/" || !/[a-z]/i.test(token) || !/\d/.test(token) ||
        /^\d+(?:p|k|in|cm|mm)$/i.test(token) || /^usb-?[ac]?$/i.test(token) ||
        /^\d+-in-\d+$/i.test(token) || /(?:inch|inches)$/i.test(token)) continue
    return token.toUpperCase()
  }
  return null
}

function structuredFamilyFromTitle(title: string) {
  const boundary = title.split(
    /\b(?:for|with|featuring|compatible\s+with|made\s+from|includes?)\b|[,;(|]/,
    1)[0]?.trim() ?? ""
  // Measurements are attributes, not family words. Keep this generic so
  // titles using "10 by 14 inch" are treated like the existing "24 x 18in"
  // form instead of overflowing the central noun phrase.
  const withoutMerchandisingCount = boundary
    .replace(/\b\d+(?:\.\d+)?\s*(?:x|by)\s*\d+(?:\.\d+)?(?:\s*(?:x|by)\s*\d+(?:\.\d+)?)*\s*(?:in|inch|inches)\b/gi, " ")
    .replace(/^\d+\s*(?:-|\s)?in\s*(?:-|\s)?\d+\s+/, "")
    .replace(/^\d+\s*(?:pcs?|pieces?|pack)\s+(?:of\s+)?/, "")
    .replace(/^(?:men|women)\s+s\s+/, "")
    .replace(/\bkitchenware\b/gi, " ")
    .replace(/\s+/g, " ").trim()
  const tokens = withoutMerchandisingCount.split(/\s+/).filter(Boolean)
  while (tokens.length && (LEADING_TITLE_DESCRIPTORS.has(tokens[0]) ||
      COLORS.includes(tokens[0] as typeof COLORS[number]))) tokens.shift()
  if (tokens.length < 2 || tokens.length > 6 ||
      NON_PRODUCT_FAMILY_HEADS.has(tokens[tokens.length - 1]) ||
      !tokens.every((token) => /[a-z]/.test(token))) return null
  const phrase = tokens.join(" ")
  return {
    productFamily: phrase.toUpperCase().replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, ""),
    phrase,
    formFactors: [phrase],
    rule: "TITLE_CENTRAL_NOUN_PHRASE",
  }
}

function familyFromText(source: string, title: string) {
  if (/\b(?:trailer\s+)?hitch\s+cover\b/.test(source)) return {
    productFamily: "TRAILER_HITCH_COVER",
    phrase: "trailer hitch cover",
    formFactors: ["hitch cover"],
    rule: "HITCH_COVER_CENTRAL_NOUN_PHRASE",
  }
  const slingTerms = ["sling", "crossbody", "chest"].filter((term) =>
    new RegExp(`\\b${term}\\b`).test(source))
  if (slingTerms.length && /\b(?:bag|backpack)\b/.test(source)) return {
    productFamily: "SLING_CROSSBODY_CHEST_BAG",
    phrase: unique([...slingTerms, "bag"]).join(" "),
    formFactors: unique([...slingTerms, "bag"]),
    rule: "SLING_CROSSBODY_CHEST_FORM_FACTOR",
  }
  // Keep compound form factors (for example, face + neck massager) as one
  // product family. A strict contiguous "face massager" match used to turn
  // valid Luna titles such as "Face Neck Massager" into an unproven family.
  const faceMassagerMatch = source.match(
    /\b(?:face|facial)(?:\s+neck)?\s+massager\b/)
  if (faceMassagerMatch ||
      /\bmicrocurrent\b.*\b(?:face|facial)\s+device\b/.test(source)) return {
    productFamily: "FACIAL_MASSAGER_DEVICE",
    phrase: /\bmicrocurrent\b/.test(source)
      ? "microcurrent facial device face massager"
      : (faceMassagerMatch?.[0] ?? "facial device face massager"),
    formFactors: unique(["facial device", faceMassagerMatch?.[0] ?? "face massager"]),
    rule: "FACIAL_DEVICE_CENTRAL_NOUN_PHRASE",
  }
  if (/\bwebcam\b/.test(source)) return { productFamily: "WEBCAM",
    phrase: "webcam", formFactors: ["webcam"], rule: "WEBCAM_CENTRAL_NOUN" }
  if (/\bface\s+massager\b/.test(source)) return { productFamily: "FACE_MASSAGER",
    phrase: "face massager", formFactors: ["face massager"],
    rule: "FACE_MASSAGER_CENTRAL_NOUN_PHRASE" }
  const backpackHead = source.match(/\b(?:backpack|rucksack|daypack)\b/)?.[0]
  const backpackQualifier = ["leather", "canvas", "nylon", "waterproof",
    "laptop", "travel", "school", "hiking", "outdoor"].find((term) =>
      new RegExp(`\\b${term}\\b`).test(source))
  const backpackAudience = /\bwomen(?:'s)?\b/.test(source) ? "women"
    : /\bmen(?:'s)?\b/.test(source) ? "men" : null
  if (backpackHead && (backpackQualifier || backpackAudience)) {
    const phrase = unique([backpackAudience, backpackQualifier, "backpack"])
    return {
      productFamily: phrase.join("_").toUpperCase(),
      phrase: phrase.join(" "),
      formFactors: [backpackHead],
      rule: "QUALIFIED_BACKPACK_FORM_FACTOR",
    }
  }
  if (/\bbackpack\b/.test(source)) return { productFamily: "GENERIC_BACKPACK",
    phrase: "backpack", formFactors: ["backpack"],
    rule: "GENERIC_BACKPACK_FALLBACK" }
  const known = ["camera", "scale", "vacuum", "translator", "necklace",
    "bracelet", "ring", "holder", "chopper", "turntable"]
    .find((term) => new RegExp(`\\b${term}\\b`).test(source))
  return known ? { productFamily: known.toUpperCase(), phrase: known,
    formFactors: [known], rule: "KNOWN_CENTRAL_NOUN" }
    : structuredFamilyFromTitle(title)
}

export function buildStructuredProductIdentityV1(input: Readonly<{
  title: string
  variantTitle?: string | null
  productType?: string | null
  descriptionText?: string | null
  gtin?: string | null
}>) : StructuredProductIdentityV1 {
  const title = normalize(input.title)
  const variant = normalize(input.variantTitle)
  const productType = normalize(input.productType)
  const description = normalize(input.descriptionText)
  const identitySource = `${title} ${variant} ${productType}`.trim()
  const source = `${identitySource} ${description}`.trim()
  const family = familyFromText(identitySource, title)
  const attributeSource = (pattern: RegExp): EvidenceSource =>
    pattern.test(title) ? "LUNA_PRODUCT_TITLE"
      : pattern.test(variant) ? "LUNA_VARIANT_TITLE"
        : pattern.test(productType) ? "LUNA_PRODUCT_TYPE"
          : "LUNA_PRODUCT_DESCRIPTION"
  const evidence: StructuredIdentityEvidenceV1[] = []
  if (family) evidence.push(Object.freeze({ field: "PRODUCT_FAMILY",
    value: family.productFamily, source: "LUNA_PRODUCT_TITLE",
    rule: family.rule }))
  const receiver = source.match(/\b(\d+(?:\.\d+)?)\s*(?:-|\s)?(?:inch|inches|in)\s+receivers?\b/i)?.[1]
  const pin = source.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\s*(?:-|\s)?(?:inch|inches|in)\b[^.]{0,40}\bpin\b/i)
  const receiverSize = receiver ? `${receiver}_INCH` : null
  const pinDiameter = pin ? `${pin[1]}_${pin[2]}_INCH` : null
  if (receiverSize) evidence.push(Object.freeze({ field: "RECEIVER_SIZE",
    value: receiverSize, source: "LUNA_PRODUCT_TITLE",
    rule: "MEASUREMENT_BOUND_TO_RECEIVER_CONTEXT" }))
  if (pinDiameter) evidence.push(Object.freeze({ field: "PIN_DIAMETER",
    value: pinDiameter, source: "LUNA_PRODUCT_TITLE",
    rule: "FRACTION_BOUND_TO_PIN_CONTEXT" }))
  // Measurements and edge features are product attributes, not model tokens.
  // Preserve them with source provenance instead of silently dropping them.
  const dimensionMatch = source.match(/\b(\d+(?:\.\d+)?)\s*(?:x|by)\s*(\d+(?:\.\d+)?)(?:\s*(?:x|by)\s*(\d+(?:\.\d+)?))?\s*(?:in|inch|inches)\b/i)
  const dimensions = dimensionMatch
    ? [dimensionMatch[1], dimensionMatch[2], dimensionMatch[3]]
      .filter(Boolean).join(" x ") + " in"
    : null
  if (dimensions) evidence.push(Object.freeze({ field: "DIMENSIONS",
    value: dimensions, source: attributeSource(/\b\d+(?:\.\d+)?\s*x\s*\d+/i),
    rule: "EXPLICIT_DIMENSION_MEASUREMENT" }))
  const edgeFeature = source.match(/\b((?:counter|raised|protective)\s+lip|edge\s+lip)\b/i)?.[1]
    ?.replace(/\s+/g, " ").trim() ?? null
  if (edgeFeature) evidence.push(Object.freeze({ field: "EDGE_FEATURE",
    value: edgeFeature.toUpperCase().replace(/\s+/g, "_"),
    source: attributeSource(/\b(?:counter|raised|protective)\s+lip\b|\bedge\s+lip\b/i),
    rule: "EXPLICIT_EDGE_FEATURE" }))
  const sizeDescriptor = source.match(/\b(extra[- ]large|extra[- ]small|x{1,2}l|large|medium|small)\b/i)?.[1]
    ?.replace(/-/g, " ").toUpperCase() ?? null
  if (sizeDescriptor) evidence.push(Object.freeze({ field: "SIZE_DESCRIPTOR",
    value: sizeDescriptor, source: attributeSource(/\b(?:extra[- ]large|extra[- ]small|x{1,2}l|large|medium|small)\b/i),
    rule: "EXPLICIT_SIZE_DESCRIPTOR" }))
  const audience = /\bmen(?:'s)?\b/.test(source) ? "MEN"
    : /\bwomen(?:'s)?\b/.test(source) ? "WOMEN" : null
  if (audience) evidence.push(Object.freeze({ field: "AUDIENCE", value: audience,
    source: "LUNA_PRODUCT_TITLE", rule: "EXPLICIT_AUDIENCE_TERM" }))
  const color = COLORS.find((term) => new RegExp(`\\b${term}\\b`).test(source))
    ?.toUpperCase() ?? null
  if (color) evidence.push(Object.freeze({ field: "COLOR", value: color,
    source: "LUNA_PRODUCT_TITLE", rule: "EXPLICIT_COLOR_TERM" }))
  const functionalDifferentiators = unique([
    /\busb\s+(?:charge|charging)\s+port\b/.test(source)
      ? "USB Charging Port" : null,
    /\bbuilt[ -]?in\s+speakers?\b/.test(source) ? "Built-In Speakers" : null,
    /\b(?:microphone|mic)\b/.test(source) ? "Microphone" : null,
    /\bmicrocurrent\b/.test(source) ? "Microcurrent" : null,
  ])
  for (const value of functionalDifferentiators) evidence.push(Object.freeze({
    field: "FUNCTIONAL_DIFFERENTIATOR", value,
    source: "LUNA_PRODUCT_TITLE", rule: "EXPLICIT_TITLE_ATTRIBUTE" }))
  const model = explicitCommercialModel(input.title)
  if (model) evidence.push(Object.freeze({ field: "MODEL", value: model,
    source: "LUNA_PRODUCT_TITLE", rule: "EXPLICIT_NON_MEASUREMENT_MODEL_TOKEN" }))
  const gtin = String(input.gtin ?? "").replace(/\D/g, "") || null
  if (gtin) evidence.push(Object.freeze({ field: "GTIN", value: gtin,
    source: "LUNA_STRUCTURED_GTIN", rule: "LUNA_VARIANT_BARCODE" }))
  const discriminators = (receiverSize ? 1 : 0) + (pinDiameter ? 1 : 0) +
    (dimensions ? 1 : 0) + (edgeFeature ? 1 : 0) + (sizeDescriptor ? 1 : 0) +
    Math.max(0, (family?.formFactors.length ?? 0) - 1) +
    (audience ? 1 : 0) + (color ? 1 : 0) +
    functionalDifferentiators.length
  const genericFamily = family?.productFamily === "GENERIC_BACKPACK"
  const structuredTitleFamily = family?.rule === "TITLE_CENTRAL_NOUN_PHRASE"
  const identitySufficient = Boolean(family && !genericFamily &&
    (discriminators >= 1 || model || gtin || ["WEBCAM", "FACE_MASSAGER",
      "FACIAL_MASSAGER_DEVICE"].includes(family.productFamily) ||
      structuredTitleFamily))
  const nearExact = family ? boundedQuery([audience?.toLowerCase(),
    ...family.formFactors, color?.toLowerCase()]) : null
  const exactStrong = family ? boundedQuery([model?.toLowerCase(),
    audience?.toLowerCase(), family.phrase, receiver ? `${receiver} inch` : null,
    pin ? `${pin[1]}/${pin[2]} inch pin` : null, dimensions,
    edgeFeature, sizeDescriptor?.toLowerCase(), color?.toLowerCase(),
    ...functionalDifferentiators.map((value) => normalize(value))]) : null
  const functional = family ? boundedQuery([family.phrase,
    ...functionalDifferentiators.map((value) => normalize(value))]) : null
  const broadFallback = family ? boundedQuery([family.phrase]) : null
  return Object.freeze({ version: SELLER_OS_STRUCTURED_PRODUCT_IDENTITY_V1,
    productFamily: family?.productFamily ?? null,
    canonicalFamilyPhrase: family?.phrase ? titleCase(family.phrase) : null,
    formFactors: Object.freeze(family?.formFactors ?? []), audience, color,
    receiverSize, pinDiameter, dimensions, edgeFeature, sizeDescriptor,
    model, gtin,
    functionalDifferentiators: Object.freeze(functionalDifferentiators),
    identitySufficient,
    insufficiencyReasons: Object.freeze(identitySufficient ? [] : [
      !family ? "CENTRAL_PRODUCT_FAMILY_NOT_PROVEN"
        : genericFamily ? "GENERIC_FAMILY_REQUIRES_FORM_FACTOR"
          : "PRODUCT_IDENTITY_DISCRIMINATORS_INSUFFICIENT",
    ]), evidence: Object.freeze(evidence),
    queryPlan: Object.freeze({ exactStrong, nearExactFamily: nearExact,
      functionalFamily: functional, broadFallback,
      progression: Object.freeze(unique([exactStrong, nearExact, functional,
        broadFallback])) }),
  })
}

export function resolveIdentityFirstAnalysisStateV1(input: Readonly<{
  identitySufficient: boolean
  browserBindingState: "BROWSER_BINDING_READY" |
    "BROWSER_BINDING_UNAVAILABLE" | "BROWSER_BINDING_NOT_REQUIRED"
  browserBindingRequired: boolean
  shippingInfrastructureState?: "SHIPPING_INFRASTRUCTURE_READY" |
    "SHIPPING_INFRASTRUCTURE_UNAVAILABLE" |
    "SHIPPING_INFRASTRUCTURE_NOT_REQUIRED"
  shippingInfrastructureRequired?: boolean
  shippingExecutionBound?: boolean
  shippingQty1Ready: boolean
  proposedCommercialDecision?: string | null
}>) {
  if (!input.identitySufficient) return Object.freeze({ analysisComplete: false,
    analysisStatus: "ANALYSIS_INCOMPLETE" as const,
    finalDecision: "ANALYSIS_INCOMPLETE_PRODUCT_IDENTITY" as const,
    commercialDecisionEmitted: false as const })
  if (input.browserBindingRequired && input.browserBindingState !==
      "BROWSER_BINDING_READY") return Object.freeze({ analysisComplete: false,
    analysisStatus: "ANALYSIS_INCOMPLETE" as const,
    finalDecision: "ANALYSIS_INCOMPLETE_INFRASTRUCTURE" as const,
    commercialDecisionEmitted: false as const })
  if (input.shippingInfrastructureRequired === true &&
      (input.shippingInfrastructureState !== "SHIPPING_INFRASTRUCTURE_READY" ||
        input.shippingExecutionBound !== true)) {
    return Object.freeze({ analysisComplete: false,
      analysisStatus: "ANALYSIS_INCOMPLETE" as const,
      finalDecision: "ANALYSIS_INCOMPLETE_INFRASTRUCTURE" as const,
      commercialDecisionEmitted: false as const })
  }
  if (!input.shippingQty1Ready) return Object.freeze({ analysisComplete: false,
    analysisStatus: "ANALYSIS_INCOMPLETE" as const,
    finalDecision: "ANALYSIS_INCOMPLETE_SHIPPING" as const,
    commercialDecisionEmitted: false as const })
  return Object.freeze({ analysisComplete: true,
    analysisStatus: "COMMERCIAL_DECISION_COMPLETE" as const,
    finalDecision: input.proposedCommercialDecision ?? "HOLD_INSUFFICIENT_EVIDENCE",
    commercialDecisionEmitted: true as const })
}

export function buildCommercialTraceAnalysisIdentityV1(input: Readonly<{
  accountKey: string
  marketplaceId?: string
  canonicalUrl: string
  productId: string
  variantId: string
  supplierSku: string
  title: string
  variantTitle?: string | null
  productType?: string | null
  descriptionText?: string | null
  imageUrls?: readonly string[]
  sourceUnitPrice: number
  available: boolean
  sourceInventoryQuantity?: number | null
  gtin?: string | null
  sourceParserVersion?: string | null
}>) {
  const sourceMaterial = JSON.stringify({ source: "LUNA_PORTEX",
    productId: input.productId, variantId: input.variantId,
    supplierSku: input.supplierSku, title: input.title,
    variantTitle: input.variantTitle ?? null,
    productType: input.productType ?? null,
    descriptionText: input.descriptionText ?? null,
    imageUrls: [...(input.imageUrls ?? [])],
    sourceUnitPrice: input.sourceUnitPrice, available: input.available,
    sourceInventoryQuantity: input.sourceInventoryQuantity ?? null,
    gtin: input.gtin ?? null, sourceParserVersion: input.sourceParserVersion ?? null })
  const sourceIdentityDigest = `sha256:${createHash("sha256")
    .update(sourceMaterial).digest("hex")}`
  const identityMaterial = JSON.stringify({ accountKey: input.accountKey,
    marketplaceId: input.marketplaceId ?? "EBAY_US",
    normalizedSupplierUrl: input.canonicalUrl,
    supplierProductId: input.productId, supplierVariantId: input.variantId,
    sourceIdentityDigest,
    analysisVersion: SELLER_OS_COMMERCIAL_TRACE_ANALYSIS_VERSION })
  return Object.freeze({
    analysisVersion: SELLER_OS_COMMERCIAL_TRACE_ANALYSIS_VERSION,
    sourceIdentityDigest,
    analysisIdentityKey: `sha256:${createHash("sha256")
      .update(identityMaterial).digest("hex")}`,
  })
}
