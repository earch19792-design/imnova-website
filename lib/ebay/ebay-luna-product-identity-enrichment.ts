import { createHash } from "node:crypto"

export const LUNA_PRODUCT_IDENTITY_ENRICHMENT_VERSION =
  "LUNA_PRODUCT_IDENTITY_ENRICHMENT_V1_2026_07_16"

export type ProductIdentityAttribute =
  | "manufacturer" | "brand" | "validGtin" | "mpn" | "model"
  | "normalizedProductName" | "packCount" | "unitCount" | "totalContents"
  | "size" | "color" | "scent" | "variant" | "condition" | "weight"
  | "dimensions" | "categoryId" | "requiredAspects"

export type IdentitySourceType =
  | "LUNA_STRUCTURED" | "LUNA_AUTHORIZED_FEED" | "EBAY_CATALOG"
  | "EBAY_BROWSE" | "MANUFACTURER_OFFICIAL" | "CONSERVATIVE_POLICY"

export type IdentityConflictStatus = "CLEAR" | "CONFLICTED" | "INVALID" | "UNVERIFIED"

export type IdentityAttributeEvidence = {
  attribute: ProductIdentityAttribute
  rawValue: unknown
  normalizedValue: unknown
  sourceType: IdentitySourceType
  sourceIdentifier: string
  observedAt: string
  confidence: number
  verifiedByRule: string
  conflictStatus: IdentityConflictStatus
}

export type CatalogIdentityProduct = {
  epid: string | null
  title: string | null
  brand: string | null
  gtins: string[]
  mpns: string[]
  aspects: Array<{ name: string; values: string[] }>
  categoryId: string | null
}

function tokens(value: unknown) {
  return new Set((normalizedKey(value).match(/[a-z0-9]+/g) ?? []).filter((token) => token.length > 1))
}

function similarity(left: unknown, right: unknown) {
  const a = tokens(left), b = tokens(right)
  if (!a.size || !b.size) return 0
  const intersection = [...a].filter((token) => b.has(token)).length
  return intersection / new Set([...a, ...b]).size
}

export function selectCatalogIdentityMatches(input: {
  title: string | null
  gtin: string | null
  brand: string | null
  mpn: string | null
  packCount?: number | null
}, products: CatalogIdentityProduct[]) {
  const compatible = products.filter((product) => {
    const observed = aspectValues(product, ["number in pack", "pack size", "unit quantity"])
      .map(positiveInteger).find(Boolean) ?? explicitPackFromText(product.title)
    return !input.packCount || !observed || observed === input.packCount
  })
  const gtin = normalizedGtin(input.gtin)
  if (gtin) {
    const exact = compatible.filter((product) => product.gtins.some((value) => normalizedGtin(value) === gtin))
    if (exact.length) return { products: exact, matchRule: "EXACT_GTIN", confidence: 1 }
  }
  if (input.brand && input.mpn) {
    const exact = compatible.filter((product) => normalizedKey(product.brand) === normalizedKey(input.brand) &&
      product.mpns.some((value) => normalizedKey(value) === normalizedKey(input.mpn)))
    if (exact.length) return { products: exact, matchRule: "EXACT_BRAND_MPN", confidence: .98 }
  }
  const ranked = compatible.map((product) => ({ product, score: similarity(input.title, product.title) }))
    .sort((left, right) => right.score - left.score)
  if (ranked[0]?.score >= .72 && (!ranked[1] || ranked[0].score - ranked[1].score >= .12)) {
    return { products: [ranked[0].product], matchRule: "UNIQUE_TITLE_CORROBORATION", confidence: ranked[0].score }
  }
  return { products: [], matchRule: "INSUFFICIENT_CATALOG_MATCH", confidence: 0 }
}

export type LunaStructuredIdentityInput = {
  sourceIdentifier: string
  observedAt: string
  title: string | null
  variantTitle: string | null
  optionValues?: string[]
  vendor?: string | null
  barcode?: string | null
  metadata?: Record<string, unknown>
  weight?: number | null
  weightUnit?: string | null
}

export type EbayComparableIdentityObservation = {
  listingIdentifier: string
  sellerIdentifier: string | null
  productName: string | null
  brand: string | null
  manufacturer: string | null
  gtin: string | null
  mpn: string | null
  model: string | null
  packCount: number | null
  unitCount: number | null
  size: string | null
  color: string | null
  scent: string | null
  variant: string | null
  condition: string | null
  categoryId: string | null
  aspects: Array<{ name: string; value: string }>
}

export type ComparableIdentityClassification =
  | "EXACT_MATCH" | "NEAR_MATCH" | "DIFFERENT_PACK" | "DIFFERENT_VARIANT"
  | "CONFLICTED" | "INVALID"

export type IdentityConsensusField = {
  attribute: ProductIdentityAttribute
  observedValues: string[]
  sellerCount: number
  exactListingCount: number
  catalogConfirmation: boolean
  conflictCount: number
  confidence: number
  acceptedValue: unknown
}

export type CanonicalProductIdentity = {
  manufacturer: string | null
  brand: string | null
  validGtin: string | null
  mpn: string | null
  model: string | null
  normalizedProductName: string | null
  packCount: number | null
  unitCount: number | null
  totalContents: string[]
  size: string | null
  color: string | null
  scent: string | null
  variant: string | null
  condition: string | null
  weight: { value: number; unit: string } | null
  dimensions: { length: number; width: number; height: number; unit: "in" | "cm" } | null
  categoryId: string | null
  requiredAspects: Array<{ name: string; value: string }>
}

const CONFLICT_ATTRIBUTES = new Set<ProductIdentityAttribute>([
  "brand", "validGtin", "mpn", "packCount", "size", "variant",
])

const SOURCE_PRIORITY: Record<IdentitySourceType, number> = {
  LUNA_STRUCTURED: 6,
  LUNA_AUTHORIZED_FEED: 5,
  EBAY_CATALOG: 4,
  EBAY_BROWSE: 3,
  MANUFACTURER_OFFICIAL: 2,
  CONSERVATIVE_POLICY: 1,
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export function sanitizedSourceIdentifier(sourceType: IdentitySourceType, value: string) {
  return `${sourceType}:sha256:${digest(value).slice(0, 16)}`
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function normalizedText(value: unknown) {
  const candidate = text(value)
  return candidate ? candidate.normalize("NFKC").replace(/\s+/g, " ").trim() : null
}

function normalizedKey(value: unknown) {
  const candidate = normalizedText(value)
  return candidate ? candidate.toLocaleLowerCase("en-US") : ""
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function positiveInteger(value: unknown) {
  const candidate = Number(value)
  return Number.isInteger(candidate) && candidate > 0 ? candidate : null
}

function explicitPackFromText(value: unknown) {
  const candidate = text(value)
  if (!candidate) return null
  const match = candidate.match(/\bpack\s+of\s+(\d{1,3})\b/i) ??
    candidate.match(/\b(\d{1,3})\s*(?:-|\s)?(?:pack|pk)\b/i)
  return positiveInteger(match?.[1])
}

function unitCountFromText(value: unknown) {
  const candidate = text(value)
  if (!candidate) return null
  return positiveInteger(candidate.match(/\b(\d{1,4})\s*(?:ct|count)\b/i)?.[1])
}

function fieldFromAspects(row: EbayComparableIdentityObservation, names: string[]) {
  const expected = new Set(names.map((name) => normalizedKey(name)))
  return row.aspects.find((entry) => expected.has(normalizedKey(entry.name)))?.value ?? null
}

function comparablePack(row: EbayComparableIdentityObservation) {
  return row.packCount ?? positiveInteger(fieldFromAspects(row, ["number in pack", "pack quantity", "pack size"])) ??
    explicitPackFromText(row.productName)
}

export function classifyComparableAgainstLunaSupply(input: {
  supplyTitle: string | null
  supplyVariant: string | null
  supplyPackCount: number | null
  supplySize?: string | null
  supplyColor?: string | null
  supplyScent?: string | null
}, comparable: EbayComparableIdentityObservation): {
  classification: ComparableIdentityClassification
  reasons: string[]
  nameSimilarity: number
} {
  const nameSimilarity = similarity(input.supplyTitle, comparable.productName)
  if (!input.supplyTitle || !comparable.productName || tokens(input.supplyTitle).size < 3) {
    return { classification: "INVALID", reasons: ["PRODUCT_NAME_EVIDENCE_INSUFFICIENT"], nameSimilarity }
  }
  const pack = comparablePack(comparable)
  if (input.supplyPackCount && pack && input.supplyPackCount !== pack) {
    return { classification: "DIFFERENT_PACK", reasons: ["PACK_MISMATCH"], nameSimilarity }
  }
  for (const [name, supply, observed] of [
    ["SIZE", input.supplySize, comparable.size], ["COLOR", input.supplyColor, comparable.color],
    ["SCENT", input.supplyScent, comparable.scent], ["VARIANT", input.supplyVariant, comparable.variant],
  ] as const) {
    if (supply && observed && normalizedKey(supply) !== normalizedKey(observed)) {
      return { classification: "DIFFERENT_VARIANT", reasons: [`${name}_MISMATCH`], nameSimilarity }
    }
  }
  if (nameSimilarity >= .82) return { classification: "EXACT_MATCH",
    reasons: ["SUPPLY_NAME_AND_VARIANT_CORROBORATED"], nameSimilarity }
  if (nameSimilarity >= .58) return { classification: "NEAR_MATCH",
    reasons: ["NAME_SIMILARITY_BELOW_EXACT_THRESHOLD"], nameSimilarity }
  return { classification: "INVALID", reasons: ["BASE_PRODUCT_MISMATCH"], nameSimilarity }
}

const CONSENSUS_FIELDS: Array<{
  attribute: ProductIdentityAttribute
  read: (row: EbayComparableIdentityObservation) => unknown
}> = [
  { attribute: "brand", read: (row) => row.brand ?? fieldFromAspects(row, ["brand"]) },
  { attribute: "manufacturer", read: (row) => row.manufacturer ?? fieldFromAspects(row, ["manufacturer"]) },
  { attribute: "validGtin", read: (row) => normalizedGtin(row.gtin ?? fieldFromAspects(row, ["upc", "ean", "gtin"])) },
  { attribute: "mpn", read: (row) => row.mpn ?? fieldFromAspects(row, ["mpn", "manufacturer part number"]) },
  { attribute: "model", read: (row) => row.model ?? fieldFromAspects(row, ["model"]) },
  { attribute: "packCount", read: comparablePack },
  { attribute: "unitCount", read: (row) => row.unitCount ?? positiveInteger(fieldFromAspects(row, ["unit count", "count per pack"])) },
  { attribute: "size", read: (row) => row.size ?? fieldFromAspects(row, ["size", "capacity", "volume"]) },
  { attribute: "color", read: (row) => row.color ?? fieldFromAspects(row, ["color", "colour"]) },
  { attribute: "scent", read: (row) => row.scent ?? fieldFromAspects(row, ["scent", "fragrance"]) },
  { attribute: "variant", read: (row) => row.variant ?? fieldFromAspects(row, ["variant", "type", "formulation"]) },
  { attribute: "condition", read: (row) => row.condition },
  { attribute: "categoryId", read: (row) => row.categoryId },
]

export function buildExactComparableConsensus(input: {
  exactComparables: EbayComparableIdentityObservation[]
  catalogEvidence?: IdentityAttributeEvidence[]
  observedAt: string
}) {
  const fields: IdentityConsensusField[] = []
  const evidenceRows: IdentityAttributeEvidence[] = []
  for (const definition of CONSENSUS_FIELDS) {
    const observations = input.exactComparables.map((row) => ({ row, value: definition.read(row) }))
      .filter((entry) => entry.value !== null && entry.value !== undefined && entry.value !== "")
    const groups = new Map<string, typeof observations>()
    for (const entry of observations) {
      const key = canonicalKey(entry.value)
      groups.set(key, [...(groups.get(key) ?? []), entry])
    }
    const ranked = [...groups.entries()].sort((left, right) => right[1].length - left[1].length)
    const winner = ranked[0]
    const sellerCount = winner ? new Set(winner[1].map((entry) =>
      entry.row.sellerIdentifier ?? `listing:${entry.row.listingIdentifier}`)).size : 0
    const catalogConfirmation = Boolean(winner && input.catalogEvidence?.some((row) =>
      row.attribute === definition.attribute && row.conflictStatus === "CLEAR" &&
      canonicalKey(row.normalizedValue) === winner[0]))
    const exactListingCount = winner?.[1].length ?? 0
    const conflictCount = Math.max(0, observations.length - exactListingCount)
    const accepted = conflictCount === 0 && (exactListingCount >= 2 && sellerCount >= 2 ||
      exactListingCount >= 1 && catalogConfirmation)
    const confidence = accepted ? Math.min(.99, catalogConfirmation ? .94 : .88 + exactListingCount * .02) :
      exactListingCount ? .45 : 0
    fields.push({ attribute: definition.attribute,
      observedValues: ranked.map(([, rows]) => String(rows[0].value)).slice(0, 10),
      sellerCount, exactListingCount, catalogConfirmation, conflictCount, confidence,
      acceptedValue: accepted ? winner?.[1][0].value ?? null : null })
    if (conflictCount > 0) {
      for (const entry of observations) evidenceRows.push(evidence({
        attribute: definition.attribute, rawValue: entry.value, normalizedValue: entry.value,
        sourceType: "EBAY_BROWSE", sourceIdentifier: entry.row.listingIdentifier,
        observedAt: input.observedAt, confidence: .2,
        verifiedByRule: "EXACT_LISTING_ATTRIBUTE_CONFLICT", conflictStatus: "CONFLICTED",
      }))
      continue
    }
    if (!accepted || !winner) continue
    for (const entry of winner[1]) evidenceRows.push(evidence({
      attribute: definition.attribute, rawValue: entry.value, normalizedValue: entry.value,
      sourceType: "EBAY_BROWSE", sourceIdentifier: entry.row.listingIdentifier,
      observedAt: input.observedAt, confidence,
      verifiedByRule: catalogConfirmation ? "EXACT_LISTING_PLUS_CATALOG_CONSENSUS" : "TWO_SELLER_EXACT_LISTING_CONSENSUS",
      conflictStatus: conflictCount ? "CONFLICTED" : "CLEAR",
    }))
  }
  return { fields, evidence: evidenceRows, exactListingCount: input.exactComparables.length,
    sellerCount: new Set(input.exactComparables.map((row) => row.sellerIdentifier ??
      `listing:${row.listingIdentifier}`)).size }
}

function normalizedGtin(value: unknown) {
  const candidate = text(value)?.replace(/\D/g, "") ?? ""
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(candidate)) return null
  const digits = [...candidate].map(Number)
  const check = digits.pop() ?? -1
  let sum = 0
  for (let index = digits.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
    sum += digits[index] * (position % 2 === 0 ? 3 : 1)
  }
  return (10 - sum % 10) % 10 === check ? candidate : null
}

function evidence(input: Omit<IdentityAttributeEvidence, "sourceIdentifier"> & { sourceIdentifier: string }) {
  return { ...input, sourceIdentifier: sanitizedSourceIdentifier(input.sourceType, input.sourceIdentifier) }
}

function addTextEvidence(output: IdentityAttributeEvidence[], input: {
  attribute: ProductIdentityAttribute
  value: unknown
  sourceType: IdentitySourceType
  sourceIdentifier: string
  observedAt: string
  confidence: number
  rule: string
}) {
  const value = normalizedText(input.value)
  if (!value) return
  output.push(evidence({
    attribute: input.attribute, rawValue: input.value, normalizedValue: value,
    sourceType: input.sourceType, sourceIdentifier: input.sourceIdentifier,
    observedAt: input.observedAt, confidence: input.confidence,
    verifiedByRule: input.rule, conflictStatus: "CLEAR",
  }))
}

export function buildLunaStructuredIdentityEvidence(input: LunaStructuredIdentityInput) {
  const metadata = record(input.metadata)
  const output: IdentityAttributeEvidence[] = []
  const common = { sourceType: "LUNA_STRUCTURED" as const, sourceIdentifier: input.sourceIdentifier,
    observedAt: input.observedAt }
  addTextEvidence(output, { ...common, attribute: "manufacturer",
    value: metadata.manufacturer ?? metadata.manufacturerName, confidence: .98,
    rule: "LUNA_EXPLICIT_MANUFACTURER" })
  addTextEvidence(output, { ...common, attribute: "brand",
    value: metadata.manufacturerBrand ?? metadata.manufacturer_brand ?? metadata.brand,
    confidence: .98, rule: "LUNA_EXPLICIT_BRAND" })
  // Vendor/distributor is deliberately not promoted to manufacturer or brand.
  addTextEvidence(output, { ...common, attribute: "normalizedProductName",
    value: metadata.normalizedProductName ?? input.title, confidence: .9,
    rule: "LUNA_PRODUCT_TITLE" })
  addTextEvidence(output, { ...common, attribute: "mpn", value: metadata.mpn,
    confidence: .96, rule: "LUNA_EXPLICIT_MPN" })
  addTextEvidence(output, { ...common, attribute: "model", value: metadata.model,
    confidence: .96, rule: "LUNA_EXPLICIT_MODEL" })
  for (const [attribute, value] of [
    ["size", metadata.size], ["color", metadata.color],
    ["scent", metadata.scent ?? metadata.fragrance],
    ["variant", metadata.variant ?? input.variantTitle], ["condition", metadata.condition],
  ] as const) addTextEvidence(output, { ...common, attribute, value, confidence: .9,
    rule: `LUNA_EXPLICIT_${attribute.toUpperCase()}` })
  if (!text(metadata.condition)) addTextEvidence(output, { ...common, attribute: "condition",
    value: "new", confidence: .8, rule: "LUNA_RETAIL_SUPPLY_NEW_CONDITION" })

  const gtinRaw = input.barcode ?? text(metadata.gtin ?? metadata.upc)
  if (gtinRaw) output.push(evidence({ attribute: "validGtin", rawValue: gtinRaw,
    normalizedValue: normalizedGtin(gtinRaw), ...common, confidence: normalizedGtin(gtinRaw) ? .99 : 0,
    verifiedByRule: "GTIN_CHECKSUM", conflictStatus: normalizedGtin(gtinRaw) ? "CLEAR" : "INVALID" }))

  const explicitPack = positiveInteger(metadata.packCount ?? metadata.pack_count ?? metadata.packQuantity)
  const optionPack = input.optionValues?.map(explicitPackFromText).find(Boolean) ?? null
  const titlePack = optionPack ?? explicitPackFromText(input.variantTitle) ?? explicitPackFromText(input.title)
  if (explicitPack) output.push(evidence({ attribute: "packCount", rawValue: explicitPack,
    normalizedValue: explicitPack, ...common, confidence: .98,
    verifiedByRule: "LUNA_STRUCTURED_PACK", conflictStatus: "CLEAR" }))
  else if (titlePack) output.push(evidence({ attribute: "packCount", rawValue: titlePack,
    normalizedValue: titlePack, ...common, confidence: .55,
    verifiedByRule: optionPack ? "LUNA_STRUCTURED_OPTION_PACK" : "EXPLICIT_PACK_TEXT_REQUIRES_CORROBORATION",
    conflictStatus: optionPack ? "CLEAR" : "UNVERIFIED" }))

  const explicitUnitCount = positiveInteger(metadata.unitCount ?? metadata.unit_count ?? metadata.countPerItem)
  const unitCount = explicitUnitCount ?? unitCountFromText(input.variantTitle) ?? unitCountFromText(input.title)
  if (unitCount) output.push(evidence({ attribute: "unitCount", rawValue: unitCount,
    normalizedValue: unitCount, ...common, confidence: explicitUnitCount ? .98 : .72,
    verifiedByRule: explicitUnitCount ? "LUNA_STRUCTURED_UNIT_COUNT" : "EXPLICIT_COUNT_TEXT",
    conflictStatus: "CLEAR" }))

  const contents = Array.isArray(metadata.exactContents ?? metadata.exact_contents)
    ? (metadata.exactContents ?? metadata.exact_contents) as unknown[] : []
  const normalizedContents = contents.map(normalizedText).filter((entry): entry is string => Boolean(entry))
  if (normalizedContents.length) output.push(evidence({ attribute: "totalContents", rawValue: contents,
    normalizedValue: normalizedContents, ...common, confidence: .98,
    verifiedByRule: "LUNA_STRUCTURED_EXACT_CONTENTS", conflictStatus: "CLEAR" }))

  if (input.weight && input.weight > 0 && input.weightUnit) output.push(evidence({ attribute: "weight",
    rawValue: { value: input.weight, unit: input.weightUnit },
    normalizedValue: { value: input.weight, unit: input.weightUnit.toLowerCase() }, ...common,
    confidence: .95, verifiedByRule: "LUNA_STRUCTURED_WEIGHT", conflictStatus: "CLEAR" }))
  const dimensions = record(metadata.dimensions)
  const length = Number(dimensions.length), width = Number(dimensions.width), height = Number(dimensions.height)
  const unit = dimensions.unit === "cm" ? "cm" : dimensions.unit === "in" ? "in" : null
  if ([length, width, height].every((value) => Number.isFinite(value) && value > 0) && unit) {
    output.push(evidence({ attribute: "dimensions", rawValue: dimensions,
      normalizedValue: { length, width, height, unit }, ...common, confidence: .95,
      verifiedByRule: "LUNA_STRUCTURED_DIMENSIONS", conflictStatus: "CLEAR" }))
  }
  return output
}

function aspectValues(product: CatalogIdentityProduct, names: readonly string[]) {
  const wanted = new Set(names.map((name) => name.toLowerCase()))
  return product.aspects.filter((entry) => wanted.has(entry.name.toLowerCase()))
    .flatMap((entry) => entry.values).map(normalizedText)
    .filter((entry): entry is string => Boolean(entry))
}

export function buildEbayCatalogIdentityEvidence(products: CatalogIdentityProduct[], observedAt: string) {
  const output: IdentityAttributeEvidence[] = []
  for (const product of products) {
    const sourceIdentifier = product.epid ?? JSON.stringify({ brand: product.brand, gtins: product.gtins, mpns: product.mpns })
    const common = { sourceType: "EBAY_CATALOG" as const, sourceIdentifier, observedAt }
    addTextEvidence(output, { ...common, attribute: "brand", value: product.brand,
      confidence: .92, rule: "EBAY_CATALOG_BRAND" })
    addTextEvidence(output, { ...common, attribute: "normalizedProductName", value: product.title,
      confidence: .85, rule: "EBAY_CATALOG_PRODUCT_TITLE" })
    addTextEvidence(output, { ...common, attribute: "categoryId", value: product.categoryId,
      confidence: .9, rule: "EBAY_CATALOG_CATEGORY" })
    for (const gtin of product.gtins) output.push(evidence({ attribute: "validGtin", rawValue: gtin,
      normalizedValue: normalizedGtin(gtin), ...common, confidence: normalizedGtin(gtin) ? .95 : 0,
      verifiedByRule: "GTIN_CHECKSUM", conflictStatus: normalizedGtin(gtin) ? "CLEAR" : "INVALID" }))
    for (const mpn of product.mpns) addTextEvidence(output, { ...common, attribute: "mpn", value: mpn,
      confidence: .92, rule: "EBAY_CATALOG_MPN" })
    for (const [attribute, names] of [
      ["size", ["size"]], ["color", ["color"]], ["scent", ["scent", "fragrance"]],
      ["variant", ["variation", "type", "flavor"]], ["model", ["model"]],
    ] as const) for (const value of aspectValues(product, names)) addTextEvidence(output, {
      ...common, attribute, value, confidence: .88, rule: `EBAY_CATALOG_${attribute.toUpperCase()}`,
    })
    for (const value of aspectValues(product, ["number in pack", "pack size", "unit quantity"])) {
      const pack = positiveInteger(value)
      if (pack) output.push(evidence({ attribute: "packCount", rawValue: value,
        normalizedValue: pack, ...common, confidence: .9,
        verifiedByRule: "EBAY_CATALOG_PACK_ASPECT", conflictStatus: "CLEAR" }))
    }
  }
  return output
}

function canonicalKey(value: unknown) {
  return JSON.stringify(value, Object.keys(record(value)).sort())
}

export function resolveProductIdentity(evidenceRows: IdentityAttributeEvidence[]) {
  const conflicts: ProductIdentityAttribute[] = []
  const canonical: Partial<Record<ProductIdentityAttribute, unknown>> = {}
  const resolvedEvidence = evidenceRows.map((row) => ({ ...row }))
  const grouped = new Map<ProductIdentityAttribute, IdentityAttributeEvidence[]>()
  for (const row of resolvedEvidence) grouped.set(row.attribute, [...(grouped.get(row.attribute) ?? []), row])
  for (const [attribute, rows] of grouped) {
    const valid = rows.filter((row) => row.conflictStatus !== "INVALID" && row.normalizedValue !== null)
    const corroborated = valid.filter((row) => row.conflictStatus !== "UNVERIFIED" ||
      valid.some((other) => other !== row && canonicalKey(other.normalizedValue) === canonicalKey(row.normalizedValue)))
    const distinct = new Set(corroborated.filter((row) => row.confidence >= .75)
      .map((row) => canonicalKey(row.normalizedValue)))
    if (CONFLICT_ATTRIBUTES.has(attribute) && distinct.size > 1) {
      conflicts.push(attribute)
      for (const row of rows) if (row.conflictStatus !== "INVALID") row.conflictStatus = "CONFLICTED"
      continue
    }
    const selected = [...corroborated].sort((left, right) =>
      SOURCE_PRIORITY[right.sourceType] - SOURCE_PRIORITY[left.sourceType] ||
      right.confidence - left.confidence)[0]
    if (selected) canonical[attribute] = selected.normalizedValue
  }
  const packCount = positiveInteger(canonical.packCount)
  const gtin = text(canonical.validGtin)
  // A supplier-unit barcode is not an offer GTIN for a multipack unless another source verifies it.
  if (packCount && packCount > 1 && gtin) {
    const matching = resolvedEvidence.filter((row) => row.attribute === "validGtin" &&
      row.normalizedValue === gtin && row.conflictStatus === "CLEAR")
    if (!matching.some((row) => row.sourceType !== "LUNA_STRUCTURED")) canonical.validGtin = null
  }
  const identity: CanonicalProductIdentity = {
    manufacturer: text(canonical.manufacturer), brand: text(canonical.brand),
    validGtin: text(canonical.validGtin), mpn: text(canonical.mpn), model: text(canonical.model),
    normalizedProductName: text(canonical.normalizedProductName), packCount,
    unitCount: positiveInteger(canonical.unitCount),
    totalContents: Array.isArray(canonical.totalContents) ? canonical.totalContents.filter((v): v is string => typeof v === "string") : [],
    size: text(canonical.size), color: text(canonical.color), scent: text(canonical.scent),
    variant: text(canonical.variant), condition: text(canonical.condition),
    weight: canonical.weight && typeof canonical.weight === "object" ? canonical.weight as CanonicalProductIdentity["weight"] : null,
    dimensions: canonical.dimensions && typeof canonical.dimensions === "object" ? canonical.dimensions as CanonicalProductIdentity["dimensions"] : null,
    categoryId: text(canonical.categoryId),
    requiredAspects: Array.isArray(canonical.requiredAspects) ? canonical.requiredAspects as CanonicalProductIdentity["requiredAspects"] : [],
  }
  return { identity, evidence: resolvedEvidence, conflicts,
    status: conflicts.length ? "CONFLICTED" as const : "RESOLVED" as const }
}

export function identityCoverage(rows: CanonicalProductIdentity[]) {
  const total = rows.length
  const count = (predicate: (row: CanonicalProductIdentity) => boolean) => rows.filter(predicate).length
  return { total, brand: count((row) => Boolean(row.brand)),
    gtinOrMpn: count((row) => Boolean(row.validGtin || row.mpn || row.model)),
    pack: count((row) => Boolean(row.packCount)), weight: count((row) => Boolean(row.weight)),
    dimensions: count((row) => Boolean(row.dimensions)) }
}

export function conservativeLogistics(input: {
  weight: CanonicalProductIdentity["weight"]
  dimensions: CanonicalProductIdentity["dimensions"]
  outboundReserveUsd: number
}) {
  if (input.weight && input.dimensions) return { status: "CONFIRMED" as const,
    weight: input.weight, dimensions: input.dimensions, outboundReserveUsd: input.outboundReserveUsd }
  return { status: "ESTIMATED" as const,
    weight: input.weight ?? { value: 5, unit: "lb" },
    dimensions: input.dimensions ?? { length: 18, width: 14, height: 8, unit: "in" as const },
    outboundReserveUsd: Math.max(18, input.outboundReserveUsd) }
}

export function automaticQualification(input: {
  identity: CanonicalProductIdentity
  conflicts: ProductIdentityAttribute[]
  exactLunaMapping: boolean
  exactComparableCount: number
  imageAuthorized: boolean
  currentUrl: boolean
  logisticsStatus: "CONFIRMED" | "ESTIMATED" | "INSUFFICIENT"
  conservativeEconomicsSafe: boolean
  safePackStrategy: boolean
  complianceBlocked: boolean
  identityConsensusConfirmed: boolean
}) {
  const reasons = [
    input.conflicts.length ? "IDENTITY_SOURCE_CONFLICT" : null,
    !input.exactLunaMapping ? "EXACT_LUNA_MAPPING_REQUIRED" : null,
    !input.identity.brand ? "MANUFACTURER_BRAND_REQUIRED" : null,
    !(input.identity.validGtin || input.identity.mpn || input.identity.model) ? "STRONG_PRODUCT_IDENTIFIER_REQUIRED" : null,
    !input.identity.packCount ? "PACK_COUNT_REQUIRED" : null,
    !input.identity.condition ? "CONDITION_REQUIRED" : null,
    !input.exactComparableCount ? "EXACT_COMPARABLES_REQUIRED" : null,
    !input.identityConsensusConfirmed ? "MULTI_LISTING_OR_CATALOG_CONSENSUS_REQUIRED" : null,
    !input.safePackStrategy ? "SAFE_PACK_STRATEGY_REQUIRED" : null,
    !input.currentUrl ? "LUNA_URL_REQUIRED" : null,
    !input.imageAuthorized ? "AUTHORIZED_IMAGE_REQUIRED" : null,
    input.logisticsStatus === "INSUFFICIENT" || !input.conservativeEconomicsSafe ? "LOGISTICS_UNCERTAINTY_UNSAFE" : null,
    input.complianceBlocked ? "COMPLIANCE_BLOCKED" : null,
  ].filter((value): value is string => Boolean(value))
  return { status: reasons.length ? "NEEDS_DATA" as const : "READY_FOR_PRICE_STOCK_CONFIRMATION" as const,
    reasons, visibleInTop20: reasons.length === 0 }
}
