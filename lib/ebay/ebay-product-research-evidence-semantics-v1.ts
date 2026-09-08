export const PRODUCT_RESEARCH_EVIDENCE_SEMANTICS_V1 =
  "PRODUCT_RESEARCH_EVIDENCE_SEMANTICS_V2_2026_09_07" as const

export type ProductResearchStructuralClassificationV1 =
  | "EXACT_PRODUCT_COMPARABLE"
  | "CLOSE_VARIANT_COMPARABLE"
  | "CORE_FAMILY_COMPARABLE"
  | "ADJACENT_BUT_NOT_COMPARABLE"
  | "FALSE_POSITIVE"

type ProvenValue<T> = Readonly<{
  status: "PROVEN"
  value: T
  evidence: readonly string[]
}>

type UnprovenValue = Readonly<{
  status: "UNPROVEN"
  value: null
  evidence: readonly string[]
}>

export type EvidenceValueV1<T> = ProvenValue<T> | UnprovenValue

export type ProductResearchStructuralEvidenceV1 = Readonly<{
  productEntity: EvidenceValueV1<string>
  productArchitecture: EvidenceValueV1<readonly string[]>
  intendedUse: EvidenceValueV1<readonly string[]>
  formFactor: EvidenceValueV1<readonly string[]>
  count: EvidenceValueV1<number>
  sizeSet: EvidenceValueV1<readonly string[]>
  material: EvidenceValueV1<readonly string[]>
  familyQualifiers: EvidenceValueV1<readonly string[]>
  features: EvidenceValueV1<readonly string[]>
}>

export type ProductResearchPriceSemanticsV1 = Readonly<{
  unitSoldPrice: EvidenceValueV1<number>
  quantitySold: EvidenceValueV1<number>
  cumulativeSalesValue: EvidenceValueV1<number>
  shipping: Readonly<{
    status: "FREE_SHIPPING" | "SHIPPING_PRICE" | "SHIPPING_UNPROVEN"
    price: number | null
    evidence: readonly string[]
  }>
  totalDeliveredPrice: EvidenceValueV1<number>
  currency: EvidenceValueV1<string>
  priceSource: string
}>

export type ProductResearchEvidenceSemanticsV1 = Readonly<{
  version: typeof PRODUCT_RESEARCH_EVIDENCE_SEMANTICS_V1
  target: ProductResearchStructuralEvidenceV1
  observed: ProductResearchStructuralEvidenceV1
  classification: ProductResearchStructuralClassificationV1
  classificationReasons: readonly string[]
  compatibility: Readonly<{
    entityCompatible: boolean
    architectureCompatible: boolean
    useCompatible: boolean
    explicitCountDifference: boolean
    explicitSizeDifference: boolean
    allExactDiscriminatorsProven: boolean
  }>
  price: ProductResearchPriceSemanticsV1
  seller: Readonly<{
    status: "PROVEN" | "UNPROVEN"
    identityHash: string | null
  }>
}>

const MATERIAL_TERMS = new Set([
  "aluminum", "aluminium", "bamboo", "brass", "ceramic", "cotton",
  "fabric", "glass", "iron", "leather", "metal", "nylon", "plastic",
  "rubber", "silicone", "stainless", "steel", "stone", "wood", "wooden",
  "wool",
])

const SHAPE_TERMS = new Set([
  "conical", "flat", "oval", "rectangular", "round", "square", "triangular",
])

// A bounded, product-agnostic structural ontology. These are physical forms,
// not search keywords and are never sufficient by themselves for comparability.
const PHYSICAL_FORM_TERMS = new Set([
  "basket", "bowl", "chinois", "colander", "cone", "ear", "ears", "funnel",
  "handle", "handled", "handles", "screen", "sieve", "sifter", "skimmer",
  "spoon", "stopper",
])

const ARCHITECTURE_TERMS = new Set([
  "fine", "mesh", "nested", "perforated", "solid", "twill", "wire",
])

const COUNT_TERMS = new Set([
  "count", "ct", "pack", "packs", "pc", "pcs", "piece", "pieces", "set",
])

const GENERIC_TERMS = new Set([
  "and", "by", "each", "for", "from", "in", "new", "of", "on", "or", "per",
  "premium", "professional", "sale", "the", "to", "tool", "tools", "with",
])

const UNIT_ALIASES = new Map<string, string>([
  ["\"", "in"], ["inch", "in"], ["inches", "in"], ["in", "in"],
  ["centimeter", "cm"], ["centimeters", "cm"], ["cm", "cm"],
  ["millimeter", "mm"], ["millimeters", "mm"], ["mm", "mm"],
  ["quart", "qt"], ["quarts", "qt"], ["qt", "qt"],
  ["ounce", "oz"], ["ounces", "oz"], ["oz", "oz"],
  ["pound", "lb"], ["pounds", "lb"], ["lb", "lb"], ["lbs", "lb"],
  ["milliliter", "ml"], ["milliliters", "ml"], ["ml", "ml"],
  ["liter", "l"], ["liters", "l"], ["l", "l"],
])

function text(value: unknown, maximum = 2_000) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum)
    : ""
}

function normalized(value: unknown) {
  return text(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
}

function tokenList(value: unknown) {
  return normalized(value).match(/[a-z0-9]+(?:\.[0-9]+)?/g) ?? []
}

function stem(value: string) {
  if (value.length > 4 && value.endsWith("ies")) return `${value.slice(0, -3)}y`
  if (value.length > 4 && /(?:ches|shes|sses|xes|zes)$/.test(value))
    return value.slice(0, -2)
  if (value.endsWith("ss")) return value
  if (value.length > 3 && value.endsWith("s")) return value.slice(0, -1)
  return value
}

function unique(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))]
}

function proven<T>(value: T, evidence: readonly string[]): ProvenValue<T> {
  return Object.freeze({ status: "PROVEN" as const, value,
    evidence: Object.freeze(unique(evidence)) })
}

function unproven(...evidence: string[]): UnprovenValue {
  return Object.freeze({ status: "UNPROVEN" as const, value: null,
    evidence: Object.freeze(unique(evidence)) })
}

function positiveInteger(value: unknown) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 && number <= 10_000 ? number : null
}

function nonNegativeMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const number = Number(String(value).replace(/[$€£,\s]/g, ""))
  return Number.isFinite(number) && number >= 0
    ? Math.round(number * 100) / 100 : null
}

function extractCount(value: unknown) {
  const source = normalized(value)
  const patterns = [
    /\b(?:set|pack|lot)\s+of\s+(\d{1,3})\b/,
    /\b(\d{1,3})\s*[- ]?(?:piece|pieces|pc|pcs|pack|packs)\b/,
    /\b(\d{1,3})\s*(?:count|ct)\b/,
  ]
  for (const pattern of patterns) {
    const matched = source.match(pattern)
    const count = positiveInteger(matched?.[1])
    if (count) return proven(count, [`TITLE_COUNT:${matched![0]}`])
  }
  return unproven("COUNT_NOT_EXPLICIT")
}

function normalizedMeasurement(value: string, unit: string) {
  const number = Number(value)
  const normalizedNumber = Number.isInteger(number) ? String(number) : String(number)
  return `${normalizedNumber} ${UNIT_ALIASES.get(unit) ?? unit}`
}

function extractSizeSet(value: unknown) {
  const source = normalized(value)
  const found: string[] = []
  const direct = /\b(\d+(?:\.\d+)?)\s*("|inches?|in|centimeters?|cm|millimeters?|mm|quarts?|qt|ounces?|oz|pounds?|lbs?|milliliters?|ml|liters?|l)(?=\s|[,/;:.)]|$)/g
  for (const matched of source.matchAll(direct)) {
    found.push(normalizedMeasurement(matched[1], matched[2]))
  }
  // Marketplace titles commonly apply one trailing inch mark to a comma list.
  const sharedInches = source.match(/\b(\d+(?:\.\d+)?(?:\s*[,/]\s*\d+(?:\.\d+)?){1,7})\s*"/)
  if (sharedInches) {
    for (const number of sharedInches[1].split(/\s*[,/]\s*/)) {
      found.push(normalizedMeasurement(number, "\""))
    }
  }
  const result = unique(found).sort((left, right) => {
    const unit = left.replace(/^[0-9.]+\s+/, "")
      .localeCompare(right.replace(/^[0-9.]+\s+/, ""))
    return unit || Number(left.match(/^[0-9.]+/)?.[0]) -
      Number(right.match(/^[0-9.]+/)?.[0])
  })
  return result.length ? proven(Object.freeze(result), result.map((entry) =>
    `TITLE_SIZE:${entry}`)) : unproven("SIZE_SET_NOT_EXPLICIT")
}

function titleBeforeUseConnector(value: unknown) {
  return normalized(value).split(/\b(?:with|for|ideal for|used for)\b/, 1)[0]
}

function extractEntity(value: unknown) {
  const candidates = tokenList(titleBeforeUseConnector(value)).filter((token) =>
    token.length > 1 && !/^\d+(?:\.\d+)?$/.test(token) &&
    !MATERIAL_TERMS.has(token) && !SHAPE_TERMS.has(token) &&
    !PHYSICAL_FORM_TERMS.has(token) && !ARCHITECTURE_TERMS.has(token) &&
    !COUNT_TERMS.has(token) && !GENERIC_TERMS.has(token))
  const entity = candidates.at(-1)
  return entity ? proven(stem(entity), [`TITLE_ENTITY:${entity}`])
    : unproven("PRODUCT_ENTITY_NOT_EXPLICIT")
}

function selectedTerms(value: unknown, vocabulary: ReadonlySet<string>) {
  return unique(tokenList(value).filter((token) => vocabulary.has(token)).map(stem))
}

function extractUseTerms(value: unknown, entity: string | null) {
  const source = normalized(value)
  const tokens = tokenList(source)
  const entityIndex = entity
    ? tokens.findIndex((token) => stem(token) === entity) : -1
  const beforeEntity = entityIndex >= 0 ? tokens.slice(0, entityIndex) : []
  const contextual = beforeEntity.filter((token) => token.length > 2 &&
    !MATERIAL_TERMS.has(token) && !SHAPE_TERMS.has(token) &&
    !PHYSICAL_FORM_TERMS.has(token) && !ARCHITECTURE_TERMS.has(token) &&
    !COUNT_TERMS.has(token) && !GENERIC_TERMS.has(token) &&
    !/^\d+(?:\.\d+)?$/.test(token)).slice(-3)
  const marked: string[] = []
  for (const match of source.matchAll(/\b(?:for|ideal for|used for)\s+([^.;:|]{2,80})/g)) {
    marked.push(...tokenList(match[1]).filter((token) => token.length > 2 &&
      !GENERIC_TERMS.has(token) && !MATERIAL_TERMS.has(token)).slice(0, 6))
  }
  return unique([...contextual, ...marked.map(stem)]).slice(0, 12)
}

function extractFeatures(value: unknown) {
  const source = normalized(value)
  const result: string[] = []
  for (const matched of source.matchAll(/\bwith\s+([^.;:|,-]{2,60})/g)) {
    result.push(...tokenList(matched[1]).filter((token) => token.length > 2 &&
      !GENERIC_TERMS.has(token) && !MATERIAL_TERMS.has(token) &&
      !COUNT_TERMS.has(token)).slice(0, 6).map(stem))
  }
  for (const matched of source.matchAll(/\b([^.;:|,-]{2,40})[- ]design\b/g)) {
    result.push(...tokenList(matched[1]).filter((token) => token.length > 2 &&
      !GENERIC_TERMS.has(token) && !MATERIAL_TERMS.has(token) &&
      !COUNT_TERMS.has(token)).slice(-4).map(stem))
  }
  return unique(result)
}

export function extractProductResearchStructuralEvidenceV1(input: Readonly<{
  title: unknown
  supportingEvidence?: unknown
}>) : ProductResearchStructuralEvidenceV1 {
  const title = text(input.title)
  const supporting = text(input.supportingEvidence)
  const combined = `${title} ${supporting}`.trim()
  const entity = extractEntity(title)
  const entityValue = entity.status === "PROVEN" ? entity.value : null
  const materials = selectedTerms(combined, MATERIAL_TERMS)
  const shapes = selectedTerms(combined, SHAPE_TERMS)
  const featureEvidence = extractFeatures(combined)
  const physicalForms = selectedTerms(`${title} ${featureEvidence.join(" ")}`,
    PHYSICAL_FORM_TERMS)
  const architecture = selectedTerms(combined, ARCHITECTURE_TERMS)
  const use = extractUseTerms(combined, entityValue)
  const features = featureEvidence
  const familyQualifiers = unique([...architecture, ...shapes])
  return Object.freeze({
    productEntity: entity,
    productArchitecture: architecture.length
      ? proven(Object.freeze(architecture), architecture.map((entry) =>
        `STRUCTURE_TERM:${entry}`)) : unproven("ARCHITECTURE_NOT_EXPLICIT"),
    intendedUse: use.length ? proven(Object.freeze(use), use.map((entry) =>
      `USE_TERM:${entry}`)) : unproven("INTENDED_USE_NOT_EXPLICIT"),
    formFactor: physicalForms.length || shapes.length
      ? proven(Object.freeze(unique([...physicalForms, ...shapes])),
        unique([...physicalForms, ...shapes]).map((entry) => `FORM_TERM:${entry}`))
      : unproven("FORM_FACTOR_NOT_EXPLICIT"),
    count: extractCount(title),
    sizeSet: extractSizeSet(combined),
    material: materials.length ? proven(Object.freeze(materials), materials.map((entry) =>
      `MATERIAL_TERM:${entry}`)) : unproven("MATERIAL_NOT_EXPLICIT"),
    familyQualifiers: familyQualifiers.length
      ? proven(Object.freeze(familyQualifiers), familyQualifiers.map((entry) =>
        `FAMILY_QUALIFIER:${entry}`)) : unproven("FAMILY_QUALIFIERS_NOT_EXPLICIT"),
    features: features.length ? proven(Object.freeze(features), features.map((entry) =>
      `FEATURE_TERM:${entry}`)) : unproven("FEATURES_NOT_EXPLICIT"),
  })
}

function values<T>(field: EvidenceValueV1<readonly T[]>) {
  return field.status === "PROVEN" ? [...field.value] : []
}

function sameSet(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((entry) => right.includes(entry))
}

function intersects(left: readonly string[], right: readonly string[]) {
  return left.some((entry) => right.includes(entry))
}

function explicitFormConflict(
  target: ProductResearchStructuralEvidenceV1,
  observed: ProductResearchStructuralEvidenceV1,
) {
  const targetForms = values(target.formFactor)
  const observedForms = values(observed.formFactor)
  const targetShapes = targetForms.filter((entry) => SHAPE_TERMS.has(entry))
  const observedShapes = observedForms.filter((entry) => SHAPE_TERMS.has(entry))
  if (targetShapes.length && observedShapes.length &&
      !intersects(targetShapes, observedShapes)) return true
  const targetBodies = targetForms.filter((entry) => PHYSICAL_FORM_TERMS.has(entry))
  const observedBodies = observedForms.filter((entry) => PHYSICAL_FORM_TERMS.has(entry))
  return observedBodies.some((entry) => !targetBodies.includes(entry) &&
    !["ear", "handle"].includes(entry))
}

function hasPlumbingUseConflict(targetTitle: unknown, observedTitle: unknown) {
  const target = normalized(targetTitle)
  const observed = normalized(observedTitle)
  const plumbing = /\b(?:bathroom|drain|floor drain|sewer|shower|sink drain|tub)\b/
  return !plumbing.test(target) && plumbing.test(observed)
}

function priceSemantics(input: Readonly<{
  unitSoldPrice?: unknown
  quantitySold?: unknown
  cumulativeSalesValue?: unknown
  shippingPrice?: unknown
  freeShipping?: unknown
  currency?: unknown
  priceSource?: unknown
  legacyAmbiguousPrice?: unknown
}>): ProductResearchPriceSemanticsV1 {
  const unit = nonNegativeMoney(input.unitSoldPrice)
  const quantity = positiveInteger(input.quantitySold)
  const cumulative = nonNegativeMoney(input.cumulativeSalesValue)
  const shipping = nonNegativeMoney(input.shippingPrice)
  const currency = text(input.currency, 3).toUpperCase()
  const source = text(input.priceSource, 120)
  const currencyProven = /^[A-Z]{3}$/.test(currency)
  const unitProven = unit !== null && currencyProven && source.length >= 3
  const shippingStatus = input.freeShipping === true
    ? "FREE_SHIPPING" as const
    : shipping !== null && currencyProven
      ? "SHIPPING_PRICE" as const : "SHIPPING_UNPROVEN" as const
  const shippingAmount = shippingStatus === "FREE_SHIPPING" ? 0
    : shippingStatus === "SHIPPING_PRICE" ? shipping : null
  const total = unitProven && shippingAmount !== null
    ? Math.round((unit + shippingAmount) * 100) / 100 : null
  return Object.freeze({
    unitSoldPrice: unitProven ? proven(unit, [`UNIT_PRICE_SOURCE:${source}`])
      : unproven(nonNegativeMoney(input.legacyAmbiguousPrice) !== null
        ? "AMBIGUOUS_LEGACY_PRICE_NOT_PROMOTED" : "UNIT_PRICE_NOT_EXPLICIT"),
    quantitySold: quantity ? proven(quantity, ["CONFIRMED_SOLD_QUANTITY"])
      : unproven("QUANTITY_SOLD_NOT_EXPLICIT"),
    cumulativeSalesValue: cumulative !== null && currencyProven && source.length >= 3
      ? proven(cumulative, [`CUMULATIVE_VALUE_SOURCE:${source}`])
      : unproven("CUMULATIVE_SALES_VALUE_NOT_EXPLICIT"),
    shipping: Object.freeze({ status: shippingStatus, price: shippingAmount,
      evidence: Object.freeze(shippingStatus === "FREE_SHIPPING"
        ? ["FREE_SHIPPING_EXPLICIT"] : shippingStatus === "SHIPPING_PRICE"
          ? ["SHIPPING_PRICE_EXPLICIT"] : ["SHIPPING_NOT_EXPLICIT"]) }),
    totalDeliveredPrice: total !== null ? proven(total,
      ["UNIT_PRICE_PLUS_PROVEN_SHIPPING"]) : unproven("TOTAL_DELIVERED_PRICE_UNPROVEN"),
    currency: currencyProven && (unitProven || cumulative !== null || shippingAmount !== null)
      ? proven(currency, ["EXPLICIT_PRICE_CURRENCY"])
      : unproven("PRICE_CURRENCY_UNPROVEN"),
    priceSource: source || (nonNegativeMoney(input.legacyAmbiguousPrice) !== null
      ? "LEGACY_AMBIGUOUS_PRODUCT_RESEARCH_PRICE" : "UNPROVEN"),
  })
}

export function classifyProductResearchEvidenceSemanticsV1(input: Readonly<{
  targetTitle: unknown
  targetSupportingEvidence?: unknown
  observedTitle: unknown
  unitSoldPrice?: unknown
  quantitySold?: unknown
  cumulativeSalesValue?: unknown
  shippingPrice?: unknown
  freeShipping?: unknown
  currency?: unknown
  priceSource?: unknown
  legacyAmbiguousPrice?: unknown
  sellerIdentityHash?: unknown
}>) : ProductResearchEvidenceSemanticsV1 {
  const target = extractProductResearchStructuralEvidenceV1({
    title: input.targetTitle, supportingEvidence: input.targetSupportingEvidence,
  })
  const observed = extractProductResearchStructuralEvidenceV1({ title: input.observedTitle })
  const targetEntity = target.productEntity.status === "PROVEN"
    ? target.productEntity.value : null
  const observedTokens = tokenList(input.observedTitle).map(stem)
  const entityCompatible = Boolean(targetEntity && observedTokens.includes(targetEntity))
  const architectureCompatible = entityCompatible &&
    !explicitFormConflict(target, observed)
  const useCompatible = architectureCompatible &&
    !hasPlumbingUseConflict(input.targetTitle, input.observedTitle)
  const explicitCountDifference = target.count.status === "PROVEN" &&
    observed.count.status === "PROVEN" && target.count.value !== observed.count.value
  const explicitSizeDifference = target.sizeSet.status === "PROVEN" &&
    observed.sizeSet.status === "PROVEN" &&
    !sameSet(target.sizeSet.value, observed.sizeSet.value)
  const targetDiscriminators = [target.productArchitecture, target.intendedUse,
    target.formFactor, target.count, target.sizeSet, target.material,
    target.familyQualifiers, target.features]
  const observedDiscriminators = [observed.productArchitecture, observed.intendedUse,
    observed.formFactor, observed.count, observed.sizeSet, observed.material,
    observed.familyQualifiers, observed.features]
  const allExactDiscriminatorsProven = entityCompatible && useCompatible &&
    targetDiscriminators.every((field, index) => field.status === "PROVEN" &&
      observedDiscriminators[index].status === "PROVEN") &&
    target.count.status === "PROVEN" && observed.count.status === "PROVEN" &&
    target.count.value === observed.count.value &&
    target.sizeSet.status === "PROVEN" && observed.sizeSet.status === "PROVEN" &&
    sameSet(target.sizeSet.value, observed.sizeSet.value) &&
    values(target.material).every((entry) => values(observed.material).includes(entry)) &&
    values(target.productArchitecture).every((entry) =>
      values(observed.productArchitecture).includes(entry)) &&
    values(target.formFactor).every((entry) => values(observed.formFactor).includes(entry)) &&
    values(target.intendedUse).every((entry) => values(observed.intendedUse).includes(entry)) &&
    values(target.familyQualifiers).every((entry) =>
      values(observed.familyQualifiers).includes(entry)) &&
    values(target.features).every((entry) => values(observed.features).includes(entry))

  let classification: ProductResearchStructuralClassificationV1
  const reasons: string[] = []
  if (!entityCompatible) {
    classification = "FALSE_POSITIVE"
    reasons.push("PRODUCT_ENTITY_INCOMPATIBLE")
  } else if (!architectureCompatible) {
    classification = "ADJACENT_BUT_NOT_COMPARABLE"
    reasons.push("PRODUCT_ARCHITECTURE_INCOMPATIBLE")
  } else if (!useCompatible) {
    classification = "ADJACENT_BUT_NOT_COMPARABLE"
    reasons.push("INTENDED_USE_INCOMPATIBLE")
  } else if (allExactDiscriminatorsProven) {
    classification = "EXACT_PRODUCT_COMPARABLE"
    reasons.push("ALL_EXACT_DISCRIMINATORS_PROVEN")
  } else if (explicitCountDifference || explicitSizeDifference) {
    classification = "CLOSE_VARIANT_COMPARABLE"
    if (explicitCountDifference) reasons.push("EXPLICIT_TITLE_COUNT_DIFFERENCE")
    if (explicitSizeDifference) reasons.push("EXPLICIT_TITLE_SIZE_DIFFERENCE")
  } else {
    classification = "CORE_FAMILY_COMPARABLE"
    reasons.push("ENTITY_USE_AND_ARCHITECTURE_COMPATIBLE",
      "EXACT_DISCRIMINATORS_INCOMPLETE")
  }
  const sellerIdentityHash = text(input.sellerIdentityHash, 80)
  const sellerProven = /^sha256:[0-9a-f]{64}$/.test(sellerIdentityHash)
  return Object.freeze({
    version: PRODUCT_RESEARCH_EVIDENCE_SEMANTICS_V1,
    target,
    observed,
    classification,
    classificationReasons: Object.freeze(reasons),
    compatibility: Object.freeze({ entityCompatible, architectureCompatible,
      useCompatible, explicitCountDifference, explicitSizeDifference,
      allExactDiscriminatorsProven }),
    price: priceSemantics(input),
    seller: Object.freeze({ status: sellerProven ? "PROVEN" as const
      : "UNPROVEN" as const, identityHash: sellerProven ? sellerIdentityHash : null }),
  })
}

export function summarizeProductResearchEvidenceSemanticsV1(
  rows: readonly ProductResearchEvidenceSemanticsV1[],
) {
  const count = (classification: ProductResearchStructuralClassificationV1) =>
    rows.filter((row) => row.classification === classification).length
  const compatible = rows.filter((row) => ["EXACT_PRODUCT_COMPARABLE",
    "CLOSE_VARIANT_COMPARABLE", "CORE_FAMILY_COMPARABLE"].includes(
      row.classification))
  const sellerHashes = compatible.flatMap((row) => row.seller.status === "PROVEN" &&
    row.seller.identityHash ? [row.seller.identityHash] : [])
  const sellerCounts = new Map<string, number>()
  for (const hash of sellerHashes) sellerCounts.set(hash, (sellerCounts.get(hash) ?? 0) + 1)
  const distinctSellerCount = sellerHashes.length ? sellerCounts.size : null
  const sellerConcentration = sellerHashes.length
    ? Math.max(...sellerCounts.values()) / sellerHashes.length : null
  const unitPrices = compatible.flatMap((row) => row.price.unitSoldPrice.status === "PROVEN"
    ? [row.price.unitSoldPrice.value] : [])
  const shippingProvenCount = compatible.filter((row) =>
    row.price.shipping.status !== "SHIPPING_UNPROVEN").length
  return Object.freeze({
    canonicalUniqueItems: rows.length,
    exact: count("EXACT_PRODUCT_COMPARABLE"),
    closeVariant: count("CLOSE_VARIANT_COMPARABLE"),
    coreFamily: count("CORE_FAMILY_COMPARABLE"),
    adjacent: count("ADJACENT_BUT_NOT_COMPARABLE"),
    falsePositive: count("FALSE_POSITIVE"),
    structurallyIncompatibleCoreFamilyCount: rows.filter((row) =>
      row.classification === "CORE_FAMILY_COMPARABLE" &&
      (!row.compatibility.architectureCompatible || !row.compatibility.useCompatible)).length,
    distinctSellerCount,
    sellerConcentration,
    sellerDiversityStatus: distinctSellerCount === null ? "UNPROVEN"
      : distinctSellerCount >= 3 && (sellerConcentration ?? 1) <= 0.6
        ? "DIVERSE" : "CONCENTRATED",
    unitPriceProvenCount: unitPrices.length,
    shippingProvenCount,
    familyDemandStatus: compatible.length >= 3 ? "PROVEN" : "UNPROVEN",
    exactProductDemandStatus: count("EXACT_PRODUCT_COMPARABLE") >= 3
      ? "PROVEN" : "UNPROVEN",
    comparableClassificationContractPass: rows.every((row) =>
      row.classification !== "CORE_FAMILY_COMPARABLE" ||
      row.compatibility.architectureCompatible && row.compatibility.useCompatible),
    sellerDiversityPass: rows.every((row) => row.seller.status === "PROVEN"
      ? Boolean(row.seller.identityHash) : row.seller.identityHash === null),
    priceEvidencePass: rows.every((row) => row.price.unitSoldPrice.status === "PROVEN"
      ? row.price.currency.status === "PROVEN" && row.price.priceSource !== "UNPROVEN"
      : row.price.unitSoldPrice.value === null),
  })
}
