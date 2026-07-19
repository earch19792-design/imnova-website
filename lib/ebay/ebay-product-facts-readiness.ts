import { createHash } from "node:crypto"

/**
 * Product facts are deliberately kept separate from product-research evidence.
 * This module is pure: it never fetches, writes, sends facts to OpenAI or calls
 * an eBay write endpoint.  That makes the resolver testable and prevents an
 * estimated fulfilment value from accidentally becoming listing copy.
 */
export const PRODUCT_FACTS_SCHEMA_VERSION = "PRODUCT_FACTS_V1_2026_07_17"
export const PRODUCT_FACTS_RESOLVER_VERSION = "PRODUCT_FACTS_RESOLVER_V1_2026_07_17"
export const SHIPPING_ESTIMATION_MODEL_VERSION = "SHIPPING_ESTIMATE_V1_2026_07_17"
export const OPENAI_FACTS_INPUT_VERSION = "OPENAI_FACTS_INPUT_V1_2026_07_17"
export const AUTHORITATIVE_FACT_SOURCE_POLICY = "TECHNICAL_AUTHORITY_ONLY_V1_2026_07_18"

export type FactScope = "PRODUCT_UNIT" | "OFFER_PACK" | "SHIPPING_PACKAGE" | "EBAY_LISTING_REQUIREMENTS"
export type FactVerificationStatus = "VERIFIED" | "CORROBORATED" | "DERIVED_VERIFIED" |
  "ESTIMATED_INTERNAL" | "MISSING" | "CONFLICTED" | "NOT_APPLICABLE" | "REJECTED"
export type FactSourceType = "LUNA_EXACT_VARIANT" | "LUNA_FULFILLMENT" |
  "EBAY_BROWSE_OFFICIAL_READONLY" | "EBAY_TRADING_GET_ITEM_READONLY" |
  "EBAY_CATALOG_OFFICIAL_READONLY" | "EBAY_TAXONOMY_OFFICIAL_READONLY" |
  "MANUFACTURER_OFFICIAL_PUBLIC" | "OFFICIAL_LABEL" | "REGULATOR_OFFICIAL" |
  "PHYSICAL_MEASUREMENT_CONFIRMED" | "INTERNAL_DERIVATION" | "INTERNAL_ESTIMATE"
export type FactAuthority = "SUPPLIER" | "MANUFACTURER_OR_LABEL" | "EBAY_TAXONOMY" |
  "REGULATOR" | "FULFILLMENT" | "PHYSICAL_MEASUREMENT" | "CORROBORATION" | "INTERNAL"
export type RequirementStatus = "SATISFIED_VERIFIED" | "SATISFIED_CORROBORATED" |
  "NOT_APPLICABLE" | "MISSING_OPTIONAL" | "MISSING_BLOCKING" | "CONFLICTED_BLOCKING"
export type ShippingMeasurementStatus = "ACTUAL_CONFIRMED" | "SUPPLIER_PROVIDED" |
  "FULFILLMENT_PROVIDED" | "ESTIMATED_INTERNAL" | "MISSING" | "CONFLICTED"
export type ReadinessGate = "IDENTITY_READY" | "PRODUCT_FACTS_READY" | "OFFER_PACK_READY" |
  "EBAY_ASPECTS_READY" | "REGULATORY_READY" | "SHIPPING_ESTIMATE_READY" |
  "SHIPPING_CONFIRMED" | "OPENAI_INPUT_READY" | "PUBLICATION_FACTS_READY"

/** Versioned fact dictionaries; persistence remains a narrow append-only observation log. */
export const PRODUCT_UNIT_FACT_KEYS = ["exactProductName", "brand", "manufacturer", "gtin", "upc", "ean", "mpn", "model",
  "variant", "scent", "flavor", "color", "formulation", "material", "unitCount", "unitCountType", "netContent", "netContentUnit",
  "unitGrossWeight", "unitLength", "unitWidth", "unitHeight", "countryOfManufacture", "ingredients", "warnings", "directions",
  "ageRestrictions", "expirationPolicy", "hazardousMaterialStatus", "regulatoryIdentifiers", "condition"] as const
export const OFFER_PACK_FACT_KEYS = ["offerPackCount", "unitsPerPack", "totalUnitCount", "totalNetContent", "packConfiguration",
  "offerPackagingType", "manufacturerMultipack", "sellerCreatedMultipack", "multipackGtin", "unitGtinReference", "packLabelingRequirements"] as const
export const SHIPPING_PACKAGE_FACT_KEYS = ["packageType", "shippingWeight", "shippingLength", "shippingWidth", "shippingHeight",
  "dimensionalWeight", "packagingMaterial", "packagingAllowance", "fulfillmentSource", "measurementSource", "measurementStatus"] as const
export const EBAY_LISTING_REQUIREMENT_FACT_KEYS = ["marketplaceId", "categoryId", "categoryTreeId", "conditionId", "requiredAspects",
  "recommendedAspects", "variationAspects", "catalogRequiredFields", "allowedValues", "regulatoryRequirements", "shippingRequirements"] as const

export type FactObservation = {
  id?: string
  candidateId: string
  lunaVariantId: string | null
  factScope: FactScope
  factKey: string
  rawValue: unknown
  normalizedValue: unknown
  normalizedUnit: string | null
  sourceType: FactSourceType
  sourceReference: string
  sourceAuthority: FactAuthority
  sourceObservedAt: string
  fetchedAt: string
  expiresAt: string | null
  confidence: number
  verificationStatus: FactVerificationStatus
  evidenceHash?: string
  adapterVersion: string
  derivation?: { formula: string; sourceObservationIds: string[]; version: string; derivedAt: string }
}

export type ResolvedFact = {
  factScope: FactScope
  factKey: string
  selectedValue: unknown
  selectedUnit: string | null
  supportingObservationIds: string[]
  supportingSourceTypes: FactSourceType[]
  supportingSourceAuthorities: FactAuthority[]
  conflictingObservationIds: string[]
  resolutionRule: string
  confidence: number
  verificationStatus: FactVerificationStatus
  resolvedAt: string
  resolverVersion: string
}

export type TaxonomyAspect = {
  name: string
  required: boolean
  values?: string[]
  aspectMode?: string | null
}

export type FactRequirement = {
  aspectName: string
  required: boolean
  mappedFactKey: string | null
  status: RequirementStatus
  selectedValue: string | null
  allowedValues: string[]
  source: "EBAY_TAXONOMY_OFFICIAL_READONLY"
}

export type ProductFactsResolution = {
  facts: ResolvedFact[]
  conflicts: Array<{ factScope: FactScope; factKey: string; observationIds: string[]; values: string[] }>
}

export type AuthoritativeOutboundFact = {
  scope: FactScope
  key: string
  value: unknown
  unit: string | null
  verificationStatus: "VERIFIED" | "CORROBORATED" | "DERIVED_VERIFIED"
  sourceTypes: FactSourceType[]
  resolutionRule: string
}

export type AuthoritativeFactsInputPackage = {
  ready: true
  facts: AuthoritativeOutboundFact[]
  version: typeof OPENAI_FACTS_INPUT_VERSION
  sourcePolicy: typeof AUTHORITATIVE_FACT_SOURCE_POLICY
  factPackageHash: string
  openAiCalls: 0
  blockedReason: null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function string(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum) : ""
}

function numeric(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function positiveInteger(value: unknown) {
  const parsed = numeric(value)
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function canonical(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`
  return JSON.stringify(value)
}

export function productFactsHash(value: unknown) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`
}

export function safeSourceReference(sourceType: FactSourceType, value: unknown) {
  return `${sourceType}:${productFactsHash(string(value, 2_000)).slice(0, 31)}`
}

export function factObservationKey(observation: FactObservation) {
  return productFactsHash({ candidateId: observation.candidateId, lunaVariantId: observation.lunaVariantId,
    factScope: observation.factScope, factKey: observation.factKey,
    normalizedValue: observation.normalizedValue, normalizedUnit: observation.normalizedUnit,
    sourceType: observation.sourceType, sourceReference: observation.sourceReference,
    // Observation time is retained as provenance but not as identity: rerunning the
    // same source/value must not manufacture duplicate append-only facts.
    adapterVersion: observation.adapterVersion })
}

export function normalizeGtin(value: unknown) {
  const digits = string(value).replace(/\D/g, "")
  if (![8, 12, 13, 14].includes(digits.length)) return null
  let sum = 0
  for (let index = digits.length - 2, weight = 3; index >= 0; index -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(digits[index]) * weight
  }
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1)) ? digits : null
}

export function normalizeUnit(value: unknown, sourceUnit?: unknown): { value: number; unit: string } | null {
  const fromText = typeof value === "string"
    ? value.normalize("NFKC").trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z. ]+)?$/)
    : null
  const parsed = numeric(fromText?.[1] ?? value)
  const unit = string(sourceUnit ?? fromText?.[2]).toLocaleLowerCase("en-US").replace(/\./g, "").trim()
  if (parsed === null || parsed < 0) return null
  if (["", "count", "ct", "pcs", "pieces", "units"].includes(unit)) return { value: parsed, unit: "count" }
  if (["g", "gram", "grams"].includes(unit)) return { value: parsed, unit: "g" }
  if (["kg", "kilogram", "kilograms"].includes(unit)) return { value: parsed * 1_000, unit: "g" }
  if (["oz", "ounce", "ounces"].includes(unit)) return { value: parsed * 28.349523125, unit: "g" }
  if (["lb", "lbs", "pound", "pounds"].includes(unit)) return { value: parsed * 453.59237, unit: "g" }
  if (["ml", "milliliter", "milliliters"].includes(unit)) return { value: parsed, unit: "ml" }
  if (["l", "liter", "liters", "litre", "litres"].includes(unit)) return { value: parsed * 1_000, unit: "ml" }
  if (["fl oz", "floz"].includes(unit)) return { value: parsed * 29.5735295625, unit: "ml" }
  if (["cm", "centimeter", "centimeters"].includes(unit)) return { value: parsed, unit: "cm" }
  if (["in", "inch", "inches"].includes(unit)) return { value: parsed * 2.54, unit: "cm" }
  return { value: parsed, unit }
}

function key(value: unknown) {
  return string(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "")
}

function valueKey(value: unknown, unit: string | null) {
  const measurement = normalizeUnit(value, unit)
  if (measurement) return `${Math.round(measurement.value * 1_000_000) / 1_000_000}:${measurement.unit}`
  return `${key(value)}:${unit ?? ""}`
}

const CRITICAL_CONFLICT_KEYS = new Set([
  "gtin", "upc", "ean", "mpn", "model", "variant", "scent", "flavor", "color",
  "formulation", "unitcount", "netcontent", "offerpackcount", "unitsperpack", "totalunitcount",
  "hazardousmaterialstatus", "eparegistration",
])
const TRUSTED = new Set<FactVerificationStatus>(["VERIFIED", "CORROBORATED", "DERIVED_VERIFIED"])
const TECHNICAL_AUTHORITY_SOURCES = new Set<FactSourceType>([
  "LUNA_EXACT_VARIANT", "LUNA_FULFILLMENT", "EBAY_CATALOG_OFFICIAL_READONLY",
  "MANUFACTURER_OFFICIAL_PUBLIC", "OFFICIAL_LABEL", "REGULATOR_OFFICIAL",
  "PHYSICAL_MEASUREMENT_CONFIRMED", "EBAY_TAXONOMY_OFFICIAL_READONLY",
])
const REGULATORY_AUTHORITY_SOURCES = new Set<FactSourceType>([
  "MANUFACTURER_OFFICIAL_PUBLIC", "OFFICIAL_LABEL", "REGULATOR_OFFICIAL",
])
const CONFIRMED_SHIPPING_SOURCES = new Set<FactSourceType>([
  "LUNA_FULFILLMENT", "PHYSICAL_MEASUREMENT_CONFIRMED",
])
const RESOLUTION_WEIGHT: Record<FactAuthority, number> = {
  REGULATOR: 9, MANUFACTURER_OR_LABEL: 8, PHYSICAL_MEASUREMENT: 8, FULFILLMENT: 8,
  EBAY_TAXONOMY: 8, SUPPLIER: 7, CORROBORATION: 4, INTERNAL: 1,
}

/** Resolves a single logical fact only. It never joins different variants or packs. */
export function resolveProductFacts(observations: FactObservation[], now = new Date()): ProductFactsResolution {
  const observationById = new Map(observations.map((entry) => [
    entry.id ?? factObservationKey(entry), entry,
  ] as const))
  const authorizedDerivation = (entry: FactObservation, trail = new Set<string>()): boolean => {
    if (entry.verificationStatus !== "DERIVED_VERIFIED" || !entry.derivation?.sourceObservationIds.length) return false
    const entryId = entry.id ?? factObservationKey(entry)
    if (trail.has(entryId)) return false
    const nextTrail = new Set(trail).add(entryId)
    return [...new Set(entry.derivation.sourceObservationIds)].every((sourceId) => {
      const source = observationById.get(sourceId)
      if (!source || source.candidateId !== entry.candidateId ||
        source.lunaVariantId !== entry.lunaVariantId || source === entry ||
        !TRUSTED.has(source.verificationStatus)) return false
      return source.verificationStatus === "DERIVED_VERIFIED"
        ? authorizedDerivation(source, nextTrail)
        : TECHNICAL_AUTHORITY_SOURCES.has(source.sourceType)
    })
  }
  const grouped = new Map<string, FactObservation[]>()
  for (const observation of observations) {
    const groupKey = `${observation.factScope}:${observation.factKey}`
    grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), observation])
  }
  const facts: ResolvedFact[] = []
  const conflicts: ProductFactsResolution["conflicts"] = []
  for (const entries of grouped.values()) {
    const [first] = entries
    const trusted = entries.filter((entry) => TRUSTED.has(entry.verificationStatus))
    const comparable = trusted.filter((entry) => entry.normalizedValue !== null && entry.normalizedValue !== "")
    const valueGroups = new Map<string, FactObservation[]>()
    for (const entry of comparable) {
      const entryKey = valueKey(entry.normalizedValue, entry.normalizedUnit)
      valueGroups.set(entryKey, [...(valueGroups.get(entryKey) ?? []), entry])
    }
    const critical = CRITICAL_CONFLICT_KEYS.has(key(first.factKey))
    if (critical && valueGroups.size > 1) {
      const conflicting = [...valueGroups.values()].flat()
      facts.push({ factScope: first.factScope, factKey: first.factKey, selectedValue: null,
        selectedUnit: null, supportingObservationIds: [], supportingSourceTypes: [], supportingSourceAuthorities: [],
        conflictingObservationIds: conflicting.map((entry) => entry.id ?? factObservationKey(entry)),
        resolutionRule: "CRITICAL_CONFLICT_BLOCKED", confidence: 0, verificationStatus: "CONFLICTED",
        resolvedAt: now.toISOString(), resolverVersion: PRODUCT_FACTS_RESOLVER_VERSION })
      conflicts.push({ factScope: first.factScope, factKey: first.factKey,
        observationIds: conflicting.map((entry) => entry.id ?? factObservationKey(entry)),
        values: [...valueGroups.keys()] })
      continue
    }
    const winner = [...trusted].sort((left, right) => {
      const leftScore = RESOLUTION_WEIGHT[left.sourceAuthority] * 100 + left.confidence
      const rightScore = RESOLUTION_WEIGHT[right.sourceAuthority] * 100 + right.confidence
      return rightScore - leftScore
    })[0]
    if (winner) {
      const same = trusted.filter((entry) => valueKey(entry.normalizedValue, entry.normalizedUnit) ===
        valueKey(winner.normalizedValue, winner.normalizedUnit))
      facts.push({ factScope: first.factScope, factKey: first.factKey,
        selectedValue: winner.normalizedValue, selectedUnit: winner.normalizedUnit,
        supportingObservationIds: same.map((entry) => entry.id ?? factObservationKey(entry)),
        supportingSourceTypes: [...new Set(same.map((entry) => entry.sourceType))],
        supportingSourceAuthorities: [...new Set(same.map((entry) => entry.sourceAuthority))],
        conflictingObservationIds: trusted.filter((entry) => !same.includes(entry)).map((entry) => entry.id ?? factObservationKey(entry)),
        resolutionRule: winner.verificationStatus === "DERIVED_VERIFIED" && authorizedDerivation(winner)
          ? "AUTHORIZED_DERIVATION" : same.length > 1 ? "AUTHORITY_WITH_CORROBORATION" : "FIELD_AUTHORITY_MATRIX",
        confidence: Math.max(0, Math.min(1, winner.confidence)), verificationStatus: winner.verificationStatus,
        resolvedAt: now.toISOString(), resolverVersion: PRODUCT_FACTS_RESOLVER_VERSION })
    } else {
      const estimate = entries.find((entry) => entry.verificationStatus === "ESTIMATED_INTERNAL")
      if (estimate) {
        facts.push({ factScope: first.factScope, factKey: first.factKey, selectedValue: estimate.normalizedValue,
          selectedUnit: estimate.normalizedUnit, supportingObservationIds: [estimate.id ?? factObservationKey(estimate)],
          supportingSourceTypes: [estimate.sourceType], supportingSourceAuthorities: [estimate.sourceAuthority],
          conflictingObservationIds: [], resolutionRule: "INTERNAL_ESTIMATE_NON_PUBLISHABLE", confidence: estimate.confidence,
          verificationStatus: "ESTIMATED_INTERNAL", resolvedAt: now.toISOString(), resolverVersion: PRODUCT_FACTS_RESOLVER_VERSION })
        continue
      }
      const status = entries.some((entry) => entry.verificationStatus === "NOT_APPLICABLE") ? "NOT_APPLICABLE" : "MISSING"
      facts.push({ factScope: first.factScope, factKey: first.factKey, selectedValue: null,
        selectedUnit: null, supportingObservationIds: [], supportingSourceTypes: [], supportingSourceAuthorities: [],
        conflictingObservationIds: [],
        resolutionRule: status === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "NO_TRUSTED_OBSERVATION",
        confidence: 0, verificationStatus: status, resolvedAt: now.toISOString(),
        resolverVersion: PRODUCT_FACTS_RESOLVER_VERSION })
    }
  }
  return { facts, conflicts }
}

function factByKey(facts: ResolvedFact[], scope: FactScope, factKey: string) {
  return facts.find((fact) => fact.factScope === scope && key(fact.factKey) === key(factKey)) ?? null
}

function hasPermittedSource(fact: ResolvedFact | null, sources = TECHNICAL_AUTHORITY_SOURCES) {
  if (!fact || !TRUSTED.has(fact.verificationStatus)) return false
  if (fact.verificationStatus === "DERIVED_VERIFIED") return fact.resolutionRule === "AUTHORIZED_DERIVATION"
  return fact.supportingSourceTypes.some((sourceType) => sources.has(sourceType))
}

export function deriveOfferPackFacts(input: {
  candidateId: string
  lunaVariantId: string | null
  facts: ResolvedFact[]
  now?: Date
}) {
  const now = input.now ?? new Date()
  const unit = factByKey(input.facts, "PRODUCT_UNIT", "unitCount")
  const packs = factByKey(input.facts, "OFFER_PACK", "offerPackCount")
  const unitCount = positiveInteger(unit?.selectedValue)
  const packCount = positiveInteger(packs?.selectedValue)
  if (!unitCount || !packCount || !unit || !packs || !hasPermittedSource(unit) || !hasPermittedSource(packs)) return []
  const unitsPerPack: FactObservation = {
    candidateId: input.candidateId, lunaVariantId: input.lunaVariantId, factScope: "OFFER_PACK",
    factKey: "unitsPerPack", rawValue: null, normalizedValue: unitCount,
    normalizedUnit: "count", sourceType: "INTERNAL_DERIVATION",
    sourceReference: safeSourceReference("INTERNAL_DERIVATION", `${input.candidateId}:unitsPerPack`),
    sourceAuthority: "INTERNAL", sourceObservedAt: now.toISOString(), fetchedAt: now.toISOString(), expiresAt: null,
    confidence: unit.confidence, verificationStatus: "DERIVED_VERIFIED",
    adapterVersion: PRODUCT_FACTS_RESOLVER_VERSION,
    derivation: { formula: "OFFER_PACK.unitsPerPack = PRODUCT_UNIT.unitCount", sourceObservationIds: [
      ...unit.supportingObservationIds], version: PRODUCT_FACTS_RESOLVER_VERSION, derivedAt: now.toISOString() },
  }
  unitsPerPack.evidenceHash = factObservationKey(unitsPerPack)
  const totalUnitCount: FactObservation = {
    candidateId: input.candidateId, lunaVariantId: input.lunaVariantId, factScope: "OFFER_PACK",
    factKey: "totalUnitCount", rawValue: null, normalizedValue: unitCount * packCount,
    normalizedUnit: "count", sourceType: "INTERNAL_DERIVATION", sourceReference: safeSourceReference("INTERNAL_DERIVATION", input.candidateId),
    sourceAuthority: "INTERNAL", sourceObservedAt: now.toISOString(), fetchedAt: now.toISOString(), expiresAt: null,
    confidence: Math.min(unit.confidence, packs.confidence), verificationStatus: "DERIVED_VERIFIED",
    adapterVersion: PRODUCT_FACTS_RESOLVER_VERSION,
    derivation: { formula: "PRODUCT_UNIT.unitCount × OFFER_PACK.offerPackCount", sourceObservationIds: [
      ...unit.supportingObservationIds, ...packs.supportingObservationIds], version: PRODUCT_FACTS_RESOLVER_VERSION, derivedAt: now.toISOString() },
  }
  totalUnitCount.evidenceHash = factObservationKey(totalUnitCount)
  return [unitsPerPack, totalUnitCount]
}

/** Estimates support economics only. Exact dimensions and multipack GTIN are intentionally absent. */
export function createShippingEstimate(input: {
  candidateId: string
  lunaVariantId: string | null
  unitGrossWeight: number | null
  offerPackCount: number | null
  packagingAllowanceLb?: number
  now?: Date
}) {
  const now = input.now ?? new Date()
  if (!input.unitGrossWeight || !input.offerPackCount || input.unitGrossWeight <= 0 || input.offerPackCount <= 0) return null
  const allowance = Math.max(.1, Math.min(5, input.packagingAllowanceLb ?? .35))
  const estimate = Number((input.unitGrossWeight * input.offerPackCount + allowance).toFixed(2))
  const observation: FactObservation = {
    candidateId: input.candidateId, lunaVariantId: input.lunaVariantId, factScope: "SHIPPING_PACKAGE",
    factKey: "shippingWeight", rawValue: null, normalizedValue: estimate, normalizedUnit: "lb",
    sourceType: "INTERNAL_ESTIMATE", sourceReference: safeSourceReference("INTERNAL_ESTIMATE", input.candidateId),
    sourceAuthority: "INTERNAL", sourceObservedAt: now.toISOString(), fetchedAt: now.toISOString(), expiresAt: null,
    confidence: .45, verificationStatus: "ESTIMATED_INTERNAL", adapterVersion: SHIPPING_ESTIMATION_MODEL_VERSION,
    derivation: { formula: "unitGrossWeight × offerPackCount + packagingAllowance", sourceObservationIds: [],
      version: SHIPPING_ESTIMATION_MODEL_VERSION, derivedAt: now.toISOString() },
  }
  observation.evidenceHash = factObservationKey(observation)
  return { observation, status: "ESTIMATED_INTERNAL" as const, packagingAllowanceLb: allowance,
    maximumErrorTolerancePercent: 20, modelVersion: SHIPPING_ESTIMATION_MODEL_VERSION }
}

const ASPECT_MAPPING: Record<string, string[]> = {
  brand: ["brand"], manufacturer: ["manufacturer"], upc: ["upc", "gtin"], ean: ["ean", "gtin"],
  gtin: ["gtin", "upc", "ean"], mpn: ["mpn"], model: ["model"], color: ["color"],
  scent: ["scent"], flavor: ["flavor"], formulation: ["formulation", "variant"],
  "numberinpack": ["offerPackCount", "unitCount"], "unitcount": ["unitCount", "totalUnitCount"],
  size: ["netContent", "size"], material: ["material"], condition: ["condition"],
}

export function mapTaxonomyRequirements(aspects: TaxonomyAspect[], facts: ResolvedFact[]) {
  return aspects.map<FactRequirement>((aspect) => {
    const candidates = ASPECT_MAPPING[key(aspect.name)] ?? [aspect.name]
    const resolved = candidates.map((candidate) => facts.find((fact) => key(fact.factKey) === key(candidate))).find(Boolean) ?? null
    const selectedValue = resolved && typeof resolved.selectedValue !== "object" && resolved.selectedValue !== null
      ? String(resolved.selectedValue) : null
    const status: RequirementStatus = resolved?.verificationStatus === "CONFLICTED" ? "CONFLICTED_BLOCKING" :
      hasPermittedSource(resolved) ? (resolved?.verificationStatus === "VERIFIED" ||
        resolved?.verificationStatus === "DERIVED_VERIFIED" ? "SATISFIED_VERIFIED" : "SATISFIED_CORROBORATED") :
        aspect.required ? "MISSING_BLOCKING" : "MISSING_OPTIONAL"
    return { aspectName: aspect.name, required: aspect.required, mappedFactKey: resolved?.factKey ?? null,
      status, selectedValue, allowedValues: (aspect.values ?? []).slice(0, 250), source: "EBAY_TAXONOMY_OFFICIAL_READONLY" }
  })
}

export function regulatoryReadiness(facts: ResolvedFact[], regulated: boolean) {
  if (!regulated) return { status: "NOT_APPLICABLE" as const, blocking: false, missing: [] as string[] }
  const required = ["warnings", "hazardousMaterialStatus", "regulatoryIdentifiers"]
  const missing = required.filter((factKey) => {
    const fact = facts.find((entry) => key(entry.factKey) === key(factKey))
    return !hasPermittedSource(fact ?? null, REGULATORY_AUTHORITY_SOURCES)
  })
  return { status: missing.length ? "REGULATORY_NOT_READY" as const : "REGULATORY_READY" as const,
    blocking: missing.length > 0, missing }
}

export function calculateReadiness(input: {
  identityExact: boolean
  facts: ResolvedFact[]
  requirements: FactRequirement[]
  regulated: boolean
  taxonomySourceReady?: boolean
}) {
  const has = (scope: FactScope, keys: string[]) => keys.every((factKey) => {
    const fact = factByKey(input.facts, scope, factKey)
    return hasPermittedSource(fact)
  })
  const conflict = input.facts.some((fact) => fact.verificationStatus === "CONFLICTED") ||
    input.requirements.some((requirement) => requirement.status === "CONFLICTED_BLOCKING")
  const requirementsReady = !input.requirements.some((requirement) =>
    ["MISSING_BLOCKING", "CONFLICTED_BLOCKING"].includes(requirement.status))
  const regulatory = regulatoryReadiness(input.facts, input.regulated)
  const actualShipping = ["shippingWeight", "shippingLength", "shippingWidth", "shippingHeight"].every((factKey) => {
    const fact = factByKey(input.facts, "SHIPPING_PACKAGE", factKey)
    return Boolean(fact && hasPermittedSource(fact) && fact.supportingSourceTypes
      .some((sourceType) => CONFIRMED_SHIPPING_SOURCES.has(sourceType)))
  })
  const estimate = input.facts.some((fact) => fact.factScope === "SHIPPING_PACKAGE" && fact.factKey === "shippingWeight" &&
    ["ESTIMATED_INTERNAL", "VERIFIED", "CORROBORATED", "DERIVED_VERIFIED"].includes(fact.verificationStatus))
  const productFacts = has("PRODUCT_UNIT", ["exactProductName", "brand", "condition"])
  const offerPackCount = positiveInteger(factByKey(input.facts, "OFFER_PACK", "offerPackCount")?.selectedValue)
  const unitsPerPack = positiveInteger(factByKey(input.facts, "OFFER_PACK", "unitsPerPack")?.selectedValue)
  const totalUnitCount = positiveInteger(factByKey(input.facts, "OFFER_PACK", "totalUnitCount")?.selectedValue)
  const offerPack = has("OFFER_PACK", ["offerPackCount", "unitsPerPack", "totalUnitCount"]) &&
    Boolean(offerPackCount && unitsPerPack && totalUnitCount && offerPackCount * unitsPerPack === totalUnitCount)
  const gates: Record<ReadinessGate, boolean> = {
    IDENTITY_READY: input.identityExact && !conflict,
    PRODUCT_FACTS_READY: productFacts && !conflict,
    OFFER_PACK_READY: offerPack && !conflict,
    EBAY_ASPECTS_READY: input.taxonomySourceReady === true && requirementsReady && !conflict,
    REGULATORY_READY: !regulatory.blocking,
    SHIPPING_ESTIMATE_READY: estimate,
    SHIPPING_CONFIRMED: actualShipping,
    OPENAI_INPUT_READY: false,
    PUBLICATION_FACTS_READY: false,
  }
  gates.OPENAI_INPUT_READY = gates.IDENTITY_READY && gates.PRODUCT_FACTS_READY && gates.OFFER_PACK_READY &&
    gates.EBAY_ASPECTS_READY && gates.REGULATORY_READY
  gates.PUBLICATION_FACTS_READY = gates.OPENAI_INPUT_READY && gates.SHIPPING_CONFIRMED
  return { gates, regulatory, conflicted: conflict }
}

export function buildOpenAiFactsInputPackage(input: { facts: ResolvedFact[]; readiness: ReturnType<typeof calculateReadiness> }) {
  if (!input.readiness.gates.OPENAI_INPUT_READY) return { ready: false, facts: [], version: OPENAI_FACTS_INPUT_VERSION,
    sourcePolicy: AUTHORITATIVE_FACT_SOURCE_POLICY, factPackageHash: null,
    openAiCalls: 0, blockedReason: "OPENAI_INPUT_NOT_READY" }
  const facts = input.facts.filter((fact) => hasPermittedSource(fact)).map<AuthoritativeOutboundFact>((fact) => ({
    scope: fact.factScope, key: fact.factKey, value: fact.selectedValue, unit: fact.selectedUnit,
    verificationStatus: fact.verificationStatus as AuthoritativeOutboundFact["verificationStatus"],
    // Preserve only the technical authorities that made the fact eligible.
    // Browse and Trading may corroborate internally but never cross this
    // outbound firewall, even when they agree with an authoritative source.
    sourceTypes: fact.verificationStatus === "DERIVED_VERIFIED"
      ? ["INTERNAL_DERIVATION"]
      : fact.supportingSourceTypes.filter((sourceType) => TECHNICAL_AUTHORITY_SOURCES.has(sourceType)),
    resolutionRule: fact.resolutionRule,
  })).sort((left, right) => `${left.scope}:${left.key}`.localeCompare(`${right.scope}:${right.key}`))
  const required = new Set([
    "PRODUCT_UNIT:exactproductname", "PRODUCT_UNIT:brand", "PRODUCT_UNIT:condition",
    "OFFER_PACK:offerpackcount", "OFFER_PACK:unitsperpack", "OFFER_PACK:totalunitcount",
  ])
  for (const fact of facts) required.delete(`${fact.scope}:${key(fact.key)}`)
  if (required.size) return { ready: false, facts: [], version: OPENAI_FACTS_INPUT_VERSION,
    sourcePolicy: AUTHORITATIVE_FACT_SOURCE_POLICY, factPackageHash: null,
    openAiCalls: 0, blockedReason: "AUTHORITATIVE_FACT_PACKAGE_INCOMPLETE" }
  const hashInput = { version: OPENAI_FACTS_INPUT_VERSION, sourcePolicy: AUTHORITATIVE_FACT_SOURCE_POLICY, facts }
  return { ready: true as const, facts, version: OPENAI_FACTS_INPUT_VERSION,
    sourcePolicy: AUTHORITATIVE_FACT_SOURCE_POLICY, factPackageHash: productFactsHash(hashInput),
    openAiCalls: 0 as const, blockedReason: null }
}

/**
 * Treat persisted JSON as hostile at the final outbound boundary. A status such
 * as CORROBORATED is not sufficient: every fact must carry an allowed source
 * class (or a traceable authorized derivation) and the immutable package hash
 * must match before OpenAI or Seller Hub can consume it.
 */
export function parseAuthoritativeFactsInputPackage(value: unknown): AuthoritativeFactsInputPackage | null {
  const packageRecord = record(value)
  if (packageRecord.ready !== true || packageRecord.version !== OPENAI_FACTS_INPUT_VERSION ||
    packageRecord.sourcePolicy !== AUTHORITATIVE_FACT_SOURCE_POLICY || packageRecord.openAiCalls !== 0 ||
    packageRecord.blockedReason !== null || !Array.isArray(packageRecord.facts) ||
    !/^sha256:[0-9a-f]{64}$/.test(string(packageRecord.factPackageHash))) return null
  const allowedScopes = new Set<FactScope>(["PRODUCT_UNIT", "OFFER_PACK", "SHIPPING_PACKAGE", "EBAY_LISTING_REQUIREMENTS"])
  const allowedStatuses = new Set(["VERIFIED", "CORROBORATED", "DERIVED_VERIFIED"])
  const facts: AuthoritativeOutboundFact[] = []
  for (const rawFact of packageRecord.facts.slice(0, 250)) {
    const fact = record(rawFact)
    const scope = string(fact.scope) as FactScope
    const factKey = string(fact.key, 160)
    const status = string(fact.verificationStatus) as AuthoritativeOutboundFact["verificationStatus"]
    const resolutionRule = string(fact.resolutionRule, 160)
    const sourceTypes = Array.isArray(fact.sourceTypes)
      ? [...new Set(fact.sourceTypes.map((entry) => string(entry) as FactSourceType).filter(Boolean))]
      : []
    const authorizedDerivation = status === "DERIVED_VERIFIED" && resolutionRule === "AUTHORIZED_DERIVATION" &&
      sourceTypes.length === 1 && sourceTypes[0] === "INTERNAL_DERIVATION"
    const authoritativeSources = status !== "DERIVED_VERIFIED" && sourceTypes.length > 0 &&
      sourceTypes.every((sourceType) => TECHNICAL_AUTHORITY_SOURCES.has(sourceType))
    if (!allowedScopes.has(scope) || !factKey || !allowedStatuses.has(status) ||
      (!authorizedDerivation && !authoritativeSources)) return null
    facts.push({ scope, key: factKey, value: fact.value, unit: string(fact.unit) || null,
      verificationStatus: status, sourceTypes, resolutionRule })
  }
  if (facts.length !== packageRecord.facts.length) return null
  const required = new Set([
    "PRODUCT_UNIT:exactproductname", "PRODUCT_UNIT:brand", "PRODUCT_UNIT:condition",
    "OFFER_PACK:offerpackcount", "OFFER_PACK:unitsperpack", "OFFER_PACK:totalunitcount",
  ])
  for (const fact of facts) required.delete(`${fact.scope}:${key(fact.key)}`)
  if (required.size) return null
  const hashInput = { version: OPENAI_FACTS_INPUT_VERSION, sourcePolicy: AUTHORITATIVE_FACT_SOURCE_POLICY, facts }
  if (productFactsHash(hashInput) !== packageRecord.factPackageHash) return null
  return { ready: true, facts, version: OPENAI_FACTS_INPUT_VERSION,
    sourcePolicy: AUTHORITATIVE_FACT_SOURCE_POLICY,
    factPackageHash: string(packageRecord.factPackageHash), openAiCalls: 0, blockedReason: null }
}

export function targetedFactException(input: { readiness: ReturnType<typeof calculateReadiness>; requirements: FactRequirement[] }) {
  const gates = input.readiness.gates
  const missingAspect = input.requirements.find((requirement) => requirement.status === "MISSING_BLOCKING")
  if (missingAspect) return { fieldRequired: missingAspect.aspectName,
    whyItMatters: "eBay requiere este item specific para la categoría seleccionada.",
    sourcesAlreadyChecked: ["eBay Taxonomy oficial", "Luna exact variant", "eBay Catalog oficial"],
    exactEvidenceNeeded: `Etiqueta oficial o fuente autorizada que confirme ${missingAspect.aspectName}.`, blockingStatus: "MISSING_BLOCKING" }
  if (!gates.IDENTITY_READY) return { fieldRequired: "identidad exacta del producto",
    whyItMatters: "La ficha no puede unir variantes o presentaciones diferentes.",
    sourcesAlreadyChecked: ["Luna exact variant", "eBay Catalog oficial"],
    exactEvidenceNeeded: "GTIN o marca + MPN/modelo que confirme la variante exacta.",
    blockingStatus: "IDENTITY_FACTS_REQUIRED" }
  if (!gates.PRODUCT_FACTS_READY) return { fieldRequired: "nombre, marca o condición verificados",
    whyItMatters: "El contenido sólo puede utilizar hechos técnicos con procedencia.",
    sourcesAlreadyChecked: ["Luna exact variant", "eBay Catalog oficial", "fuentes autorizadas configuradas"],
    exactEvidenceNeeded: "Etiqueta oficial o fuente autorizada que confirme el dato faltante.",
    blockingStatus: "PRODUCT_UNIT_FACTS_REQUIRED" }
  if (!gates.OFFER_PACK_READY) return { fieldRequired: "presentación exacta de la oferta",
    whyItMatters: "Seller OS debe distinguir una unidad, un multipack y el total incluido.",
    sourcesAlreadyChecked: ["Luna exact variant", "confirmación visible del operador"],
    exactEvidenceNeeded: "Confirma unidades por presentación y total incluido en una oferta.",
    blockingStatus: "OFFER_PACK_FACTS_REQUIRED" }
  if (!gates.EBAY_ASPECTS_READY) return { fieldRequired: "categoría y aspectos obligatorios de eBay",
    whyItMatters: "La categoría hoja y sus requisitos deben provenir de Taxonomy oficial.",
    sourcesAlreadyChecked: ["eBay Taxonomy oficial", "eBay Catalog oficial"],
    exactEvidenceNeeded: "Resolver la categoría hoja y sus item specifics obligatorios.",
    blockingStatus: "EBAY_TAXONOMY_NOT_READY" }
  if (!gates.REGULATORY_READY) return { fieldRequired: "validación regulatoria",
    whyItMatters: "Un producto regulado no puede avanzar con datos críticos sin verificar.",
    sourcesAlreadyChecked: ["Luna exact variant", "fuentes regulatorias autorizadas configuradas"],
    exactEvidenceNeeded: "Etiqueta o fuente regulatoria oficial aplicable al producto exacto.",
    blockingStatus: "REGULATORY_NOT_READY" }
  if (!gates.SHIPPING_ESTIMATE_READY) return { fieldRequired: "estimación de peso de envío",
    whyItMatters: "La economía necesita una estimación conservadora antes de preparar contenido.",
    sourcesAlreadyChecked: ["Luna exact variant", "modelo interno de estimación"],
    exactEvidenceNeeded: "Peso unitario o estimación conservadora trazable del paquete.",
    blockingStatus: "SHIPPING_ESTIMATE_REQUIRED_FOR_CONTENT" }
  if (!gates.SHIPPING_CONFIRMED) return { fieldRequired: "shippingWeight / package dimensions",
    whyItMatters: "Las medidas confirmadas se exigen al publicar cuando la política de envío las necesita, no para redactar contenido.",
    sourcesAlreadyChecked: ["Luna exact variant", "Luna fulfillment", "estimación interna no publicable"],
    exactEvidenceNeeded: "Confirma el peso y las dimensiones desde Luna o fulfillment antes de usar envío calculado.",
    blockingStatus: "SHIPPING_CONFIRMATION_DEFERRED_TO_PUBLICATION",
    blocksContent: false, blocksPublication: true }
  return null
}
