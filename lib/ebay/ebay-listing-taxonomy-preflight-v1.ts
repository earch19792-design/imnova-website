import { createHash } from "node:crypto"

import type {
  EbayTaxonomyAspectIntelligence,
  EbayTaxonomyListingIntelligence,
} from "./ebay-seller-keyword-demand-gateway"

export const EBAY_LISTING_TAXONOMY_PREFLIGHT_V1 =
  "SELLER_OS_EBAY_LISTING_TAXONOMY_PREFLIGHT_V1" as const

type BuildTaxonomyPreflightInput = {
  taxonomy: EbayTaxonomyListingIntelligence
  expectedCategoryId: string
  existingAspects: Record<string, unknown>
  provenProductValues: Record<string, string>
  knownUnknownAspectNames?: string[]
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function key(value: unknown) {
  return text(value).toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ").trim()
}

function compatibleOfficialValue(
  aspect: EbayTaxonomyAspectIntelligence,
  proposed: string,
) {
  if (aspect.mode !== "SELECTION_ONLY" || !aspect.valuesComplete) {
    return proposed
  }
  return aspect.values.find((entry) => key(entry.value) === key(proposed))
    ?.value ?? ""
}

function canonicalAspect(aspect: EbayTaxonomyAspectIntelligence) {
  return {
    name: aspect.name,
    mode: aspect.mode,
    cardinality: aspect.cardinality,
    maxLength: aspect.maxLength,
    dataType: aspect.dataType,
    format: aspect.format,
    advancedDataType: aspect.advancedDataType,
    expectedRequiredByDate: aspect.expectedRequiredByDate,
    required: aspect.required,
    enabledForVariations: aspect.enabledForVariations,
    usage: aspect.usage,
    suggestedValues: aspect.suggestedValues,
    values: aspect.values,
    valuesComplete: aspect.valuesComplete,
    constraintsComplete: aspect.constraintsComplete,
  }
}

export function buildEbayListingTaxonomyPreflightV1(
  input: BuildTaxonomyPreflightInput,
) {
  const expectedCategoryId = text(input.expectedCategoryId)
  if (
    input.taxonomy.status !== "AVAILABLE"
    || input.taxonomy.source !== "EBAY_TAXONOMY_OFFICIAL_READONLY"
    || input.taxonomy.categoryResolution !== "KNOWN_CATEGORY"
    || input.taxonomy.categoryId !== expectedCategoryId
    || !input.taxonomy.observedAt
    || !input.taxonomy.categoryTreeId
  ) {
    throw new Error("EBAY_LISTING_TAXONOMY_EXACT_CATEGORY_UNAVAILABLE")
  }

  const officialByKey = new Map(input.taxonomy.aspects.map((aspect) => [
    key(aspect.name), aspect,
  ]))
  const unknown = new Set((input.knownUnknownAspectNames ?? []).map(key))
  const resolvedAspects: Record<string, string> = {}
  for (const [name, rawValue] of Object.entries(input.existingAspects)) {
    const aspect = officialByKey.get(key(name))
    const value = text(rawValue)
    if (!aspect || !value || unknown.has(key(aspect.name))) continue
    const compatible = compatibleOfficialValue(aspect, value)
    if (compatible) resolvedAspects[aspect.name] = compatible
  }

  const provenValuesAutoBound: Record<string, string> = {}
  for (const [name, proposed] of Object.entries(input.provenProductValues)) {
    const aspect = officialByKey.get(key(name))
    if (!aspect) continue
    const compatible = compatibleOfficialValue(aspect, text(proposed))
    if (!compatible) continue
    resolvedAspects[aspect.name] = compatible
    provenValuesAutoBound[aspect.name] = compatible
  }

  const aspects = input.taxonomy.aspects.map(canonicalAspect)
  const requiredAspects = aspects.filter((aspect) => aspect.required)
  const recommendedAspects = aspects.filter((aspect) =>
    !aspect.required && aspect.usage === "RECOMMENDED")
  const optionalAspects = aspects.filter((aspect) =>
    !aspect.required && aspect.usage !== "RECOMMENDED")
  const unprovenRequiredAspectNames = requiredAspects
    .filter((aspect) => !text(resolvedAspects[aspect.name]))
    .map((aspect) => aspect.name)

  const digestPayload = {
    schemaVersion: EBAY_LISTING_TAXONOMY_PREFLIGHT_V1,
    source: input.taxonomy.source,
    categoryId: input.taxonomy.categoryId,
    categoryName: input.taxonomy.categoryName,
    categoryTreeId: input.taxonomy.categoryTreeId,
    categoryTreeVersion: input.taxonomy.categoryTreeVersion,
    taxonomyMarketplaceId: input.taxonomy.taxonomyMarketplaceId,
    aspects,
    provenValuesAutoBound,
    unprovenRequiredAspectNames,
  }
  const evidenceDigest = `sha256:${createHash("sha256")
    .update(JSON.stringify(digestPayload)).digest("hex")}`

  return {
    ...digestPayload,
    status: "CONSULTADO" as const,
    officialStatus: "AVAILABLE" as const,
    observedAt: input.taxonomy.observedAt,
    categoryResolution: input.taxonomy.categoryResolution,
    requiredAspects,
    recommendedAspects,
    optionalAspects,
    resolvedAspects,
    evidenceDigest,
  }
}
