import { createHash } from "node:crypto"

import type { EbayCatalogIdentityProduct } from
  "./ebay-seller-keyword-demand-gateway"
import { validateGtinChecksum } from "./ebay-winner-evidence-v2"
import type { ProductIdentityInput, WinnerComparableInput } from
  "./ebay-winner-evidence-v2"

export const QUICK_PICK_EXACT_SOLD_PRODUCT_TRUTH_V1 =
  "QUICK_PICK_EXACT_SOLD_PRODUCT_TRUTH_V1" as const

export type QuickPickMarketIdentityClassV1 =
  | "EXACT_PRODUCT_MATCH"
  | "STRONG_EXACT_MATCH"
  | "FAMILY_OR_COMPARABLE_ONLY"

export type QuickPickMarketObservationV1 = Readonly<{
  sourceClass: "SOLD_COMPLETED" | "ACTIVE_LISTING" | "OFFICIAL_CATALOG"
  sourceReference: string
  sellerReference?: string | null
  sold: boolean
  identity: ProductIdentityInput
  aspects?: ReadonlyArray<Readonly<{ name: string, value: string }>>
}>

export type QuickPickMarketFactTraceV1 = Readonly<{
  specificName: string
  candidateValue: string | null
  exactMatchCount: number
  soldExactMatchCount: number
  corroboratingListingCount: number
  conflictingListingCount: number
  identityConfidence: "HIGH" | "MEDIUM" | "LOW"
  sourceClass: "SOLD_EXACT_MATCH" | "ACTIVE_EXACT_MATCH" |
    "FAMILY_CONTEXT_ONLY" | "NO_EXACT_MARKET_EVIDENCE"
  promotionToProductTruthAllowed: boolean
  resolutionReason: string
  factInvented: false
}>

type NormalizedObservation = QuickPickMarketObservationV1 & Readonly<{
  identityClass: QuickPickMarketIdentityClassV1
  normalizedIdentity: Readonly<Record<string, string>>
}>

function text(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum)
    : null
}

function normalized(value: unknown) {
  return text(value)?.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim() ?? ""
}

function identifier(value: unknown) {
  return normalized(value).replace(/\s+/g, "")
}

function gtinIdentifier(value: unknown) {
  const candidate = String(value ?? "").replace(/\D/g, "")
  return validateGtinChecksum(candidate) ? candidate : ""
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)]
}

function safeReference(value: unknown) {
  const normalizedValue = text(value, 1_000) ?? "missing"
  return `sha256:${createHash("sha256").update(normalizedValue).digest("hex")}`
}

function fact(identity: ProductIdentityInput,
  aspects: QuickPickMarketObservationV1["aspects"], name: string) {
  const key = normalized(name)
  const direct: Record<string, unknown> = {
    brand: identity.manufacturerBrand,
    model: identity.model,
    mpn: identity.mpn,
    color: identity.color,
    size: identity.size,
    condition: identity.condition,
    upc: identity.gtin,
    ean: identity.gtin,
    gtin: identity.gtin,
  }
  const directValue = text(direct[key])
  if (directValue) return directValue
  const aliases = key === "dimensions"
    ? new Set(["dimensions", "item dimensions", "product dimensions"])
    : key === "type"
      ? new Set(["type", "product type"])
      : new Set([key])
  for (const aspect of aspects ?? []) {
    if (aliases.has(normalized(aspect.name))) {
      const value = text(aspect.value)
      if (value) return value
    }
  }
  return null
}

function identityFields(identity: ProductIdentityInput) {
  return Object.freeze({
    brand: normalized(identity.manufacturerBrand),
    gtin: gtinIdentifier(identity.gtin),
    mpn: identifier(identity.mpn),
    model: identifier(identity.model),
    size: normalized(identity.size),
    color: normalized(identity.color),
    variant: normalized(identity.variant),
    packCount: identity.packCount ? String(identity.packCount) : "",
  })
}

function classifyIdentity(candidate: ProductIdentityInput,
  observation: QuickPickMarketObservationV1) {
  const expected = identityFields(candidate)
  const observed = identityFields(observation.identity)
  const variantConflict = ["size", "color", "variant", "packCount"]
    .some((key) => expected[key as keyof typeof expected]
      && observed[key as keyof typeof observed]
      && expected[key as keyof typeof expected] !==
        observed[key as keyof typeof observed])
  if (variantConflict) return "FAMILY_OR_COMPARABLE_ONLY" as const
  const gtinExact = Boolean(expected.gtin && observed.gtin
    && expected.gtin === observed.gtin)
  const expectedPart = expected.mpn || expected.model
  const observedPart = observed.mpn || observed.model
  const partExact = Boolean(expectedPart && observedPart
    && expectedPart === observedPart)
  const brandConflict = Boolean(expected.brand && observed.brand
    && expected.brand !== observed.brand)
  if (gtinExact && !brandConflict) return "EXACT_PRODUCT_MATCH" as const
  if (partExact && expected.brand && observed.brand
      && expected.brand === observed.brand) {
    return "EXACT_PRODUCT_MATCH" as const
  }
  if (partExact && !brandConflict) return "STRONG_EXACT_MATCH" as const
  // Title or family overlap is intentionally insufficient.
  return "FAMILY_OR_COMPARABLE_ONLY" as const
}

function catalogObservations(products: readonly EbayCatalogIdentityProduct[]) {
  return products.map((product, index): QuickPickMarketObservationV1 => ({
    sourceClass: "OFFICIAL_CATALOG",
    sourceReference: safeReference(product.epid ?? product.title ?? index),
    sellerReference: null,
    sold: false,
    identity: {
      manufacturerBrand: product.brand,
      gtin: product.gtins[0] ?? null,
      mpn: product.mpns[0] ?? null,
      model: product.aspects.find((aspect) =>
        normalized(aspect.name) === "model")?.values[0] ?? null,
      productName: product.title,
    },
    aspects: product.aspects.flatMap((aspect) => aspect.values.slice(0, 1)
      .map((value) => ({ name: aspect.name, value }))),
  }))
}

export function quickPickSoldComparableObservationV1(
  comparable: WinnerComparableInput,
): QuickPickMarketObservationV1 {
  return Object.freeze({
    sourceClass: "SOLD_COMPLETED",
    sourceReference: safeReference(comparable.sourceListingId),
    sellerReference: null,
    sold: Number(comparable.confirmedSoldQuantity ?? 0) > 0,
    identity: comparable.identity,
    aspects: [],
  })
}

export function quickPickActiveComparableObservationV1(value: unknown):
  QuickPickMarketObservationV1 | null {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
  if (row.eligibleComparable !== true) return null
  const aspects = Array.isArray(row.localizedAspects)
    ? row.localizedAspects.flatMap((entry) => {
      const aspect = entry && typeof entry === "object" && !Array.isArray(entry)
        ? entry as Record<string, unknown> : {}
      const name = text(aspect.name, 120)
      const value = text(aspect.value, 500)
      return name && value ? [{ name, value }] : []
    }) : []
  const aspectValue = (...names: string[]) => aspects.find((aspect) =>
    names.includes(normalized(aspect.name)))?.value ?? null
  return Object.freeze({
    sourceClass: "ACTIVE_LISTING",
    sourceReference: safeReference(row.comparableId),
    sellerReference: text(row.sellerUsername, 200)
      ? safeReference(row.sellerUsername) : null,
    sold: row.verifiedSoldRecent === true,
    identity: {
      manufacturerBrand: text(row.brand, 160) ?? aspectValue("brand"),
      gtin: text(row.gtin, 40) ?? aspectValue("upc", "ean", "gtin"),
      mpn: text(row.mpn, 120) ?? aspectValue("mpn",
        "manufacturer part number"),
      model: text(row.model, 120) ?? aspectValue("model", "model number"),
      color: text(row.color, 120) ?? aspectValue("color", "colour"),
      size: text(row.size, 120) ?? aspectValue("size", "capacity", "volume"),
      packCount: Number.isInteger(row.lotSize) ? Number(row.lotSize) : null,
      productName: text(row.title, 350),
    },
    aspects,
  })
}

function productHasBrandOrLicenseSignal(observations: readonly NormalizedObservation[]) {
  return observations.some((entry) => {
    const brand = normalized(entry.identity.manufacturerBrand)
    return brand && brand !== "unbranded" && brand !== "does not apply"
  })
}

export function resolveQuickPickExactSoldProductTruthV1(input: Readonly<{
  candidate: ProductIdentityInput
  requiredSpecificNames: readonly string[]
  observations: readonly QuickPickMarketObservationV1[]
  catalogProducts?: readonly EbayCatalogIdentityProduct[]
}>) {
  const observations = [...input.observations,
    ...catalogObservations(input.catalogProducts ?? [])].map((entry) =>
      Object.freeze({ ...entry,
        identityClass: classifyIdentity(input.candidate, entry),
        normalizedIdentity: identityFields(entry.identity),
      }))
  const exactObservations = observations.filter((entry) =>
    entry.identityClass !== "FAMILY_OR_COMPARABLE_ONLY")
  const exactListings = exactObservations.filter((entry) =>
    entry.sourceClass !== "OFFICIAL_CATALOG")
  const exactProductMatchCount = exactListings.filter((entry) =>
    entry.identityClass === "EXACT_PRODUCT_MATCH").length
  const strongExactMatchCount = exactListings.filter((entry) =>
    entry.identityClass === "STRONG_EXACT_MATCH").length
  const familyOrComparableOnlyCount = observations.length
    - exactProductMatchCount - strongExactMatchCount
  const catalog = exactObservations.filter((entry) =>
    entry.sourceClass === "OFFICIAL_CATALOG")
  const productBrandSignal = productHasBrandOrLicenseSignal(observations)
  const factTraces: QuickPickMarketFactTraceV1[] = []
  const promotedProductTruth: Record<string, string> = {}
  const marketIdentifierCandidates: Array<Readonly<{
    identifierType: "UPC_EAN" | "MPN"
    candidateValue: string
    identityClass: QuickPickMarketIdentityClassV1
    promotionToProductTruthAllowed: false
  }>> = []

  for (const observation of exactObservations) {
    for (const [identifierType, candidateValue] of [
      ["UPC_EAN", text(observation.identity.gtin, 40)],
      ["MPN", text(observation.identity.mpn, 120)],
    ] as const) if (candidateValue) marketIdentifierCandidates.push({
      identifierType, candidateValue,
      identityClass: observation.identityClass,
      promotionToProductTruthAllowed: false,
    })
  }

  for (const specificName of unique(input.requiredSpecificNames
    .flatMap((value) => text(value, 120) ? [text(value, 120)!] : []))) {
    const protectedCondition = normalized(specificName) === "condition"
    const protectedIdentifier = ["upc", "ean", "gtin", "mpn", "isbn"]
      .includes(normalized(specificName))
    const values = new Map<string, { value: string,
      observations: NormalizedObservation[] }>()
    for (const observation of exactObservations) {
      const value = fact(observation.identity, observation.aspects, specificName)
      if (!value) continue
      const key = normalized(value)
      const current = values.get(key) ?? { value, observations: [] }
      current.observations.push(observation)
      values.set(key, current)
    }
    const ranked = [...values.values()].sort((left, right) =>
      right.observations.length - left.observations.length)
    const selected = ranked[0] ?? null
    const corroboratingListings = selected?.observations.filter((entry) =>
      entry.sourceClass !== "OFFICIAL_CATALOG") ?? []
    const soldExactMatchCount = corroboratingListings.filter((entry) =>
      entry.sold).length
    const conflictingListingCount = ranked.slice(1).reduce((sum, entry) =>
      sum + entry.observations.filter((observation) =>
        observation.sourceClass !== "OFFICIAL_CATALOG").length, 0)
    const distinctListings = new Set(corroboratingListings
      .map((entry) => entry.sourceReference)).size
    const sellerReferences = corroboratingListings
      .map((entry) => entry.sellerReference).filter(Boolean) as string[]
    const distinctSellers = new Set(sellerReferences).size
    const catalogCorroborates = Boolean(selected && catalog.some((entry) =>
      normalized(fact(entry.identity, entry.aspects, specificName)) ===
        normalized(selected.value)))
    const soldMultiSeller = soldExactMatchCount >= 2 && distinctSellers >= 2
    const activeMultiSource = distinctListings >= 2 && distinctSellers >= 2
      && catalogCorroborates
    const unbrandedUnsafe = normalized(specificName) === "brand"
      && normalized(selected?.value) === "unbranded" && productBrandSignal
    const canPromote = Boolean(selected && !protectedCondition
      && !protectedIdentifier && conflictingListingCount === 0
      && !unbrandedUnsafe && (soldMultiSeller || activeMultiSource))
    const sourceClass = soldExactMatchCount > 0
      ? "SOLD_EXACT_MATCH" as const
      : distinctListings > 0 ? "ACTIVE_EXACT_MATCH" as const
        : observations.length > exactObservations.length
          ? "FAMILY_CONTEXT_ONLY" as const
          : "NO_EXACT_MARKET_EVIDENCE" as const
    const resolutionReason = protectedCondition
      ? "CONDITION_REQUIRES_INVENTORY_AUTHORITY"
      : protectedIdentifier
        ? "MARKET_IDENTIFIER_CANDIDATE_REQUIRES_CATEGORY_POLICY"
        : conflictingListingCount > 0
          ? "MATERIAL_MARKET_FACT_CONFLICT"
          : unbrandedUnsafe
            ? "UNBRANDED_CONTRADICTS_BRAND_OR_LICENSE_SIGNAL"
            : canPromote ? "EXACT_MULTI_SOURCE_CORROBORATION"
              : selected ? "MULTI_SOURCE_OR_SELLER_CORROBORATION_INSUFFICIENT"
                : "NO_EXACT_MARKET_FACT"
    if (canPromote && selected) promotedProductTruth[specificName] = selected.value
    factTraces.push(Object.freeze({ specificName,
      candidateValue: selected?.value ?? null,
      exactMatchCount: distinctListings,
      soldExactMatchCount,
      corroboratingListingCount: selected ? distinctListings : 0,
      conflictingListingCount,
      identityConfidence: exactProductMatchCount > 0 ? "HIGH"
        : strongExactMatchCount > 0 ? "MEDIUM" : "LOW",
      sourceClass, promotionToProductTruthAllowed: canPromote,
      resolutionReason, factInvented: false }))
  }

  return Object.freeze({
    contractVersion: QUICK_PICK_EXACT_SOLD_PRODUCT_TRUTH_V1,
    exactProductMatchCount, strongExactMatchCount,
    familyOrComparableOnlyCount,
    exactSoldProductFound: exactListings.some((entry) => entry.sold),
    factTraces: Object.freeze(factTraces),
    promotedProductTruth: Object.freeze(promotedProductTruth),
    marketIdentifierCandidates: Object.freeze(unique(
      marketIdentifierCandidates.map((entry) => JSON.stringify(entry)))
      .map((entry) => JSON.parse(entry))),
    familyEvidencePromotedToProductTruth: false as const,
    nightRadarFactPromotionAllowed: false as const,
    conditionFromSoldEvidenceAllowed: false as const,
    productIdentifiersRequireOfficialCategoryPolicy: true as const,
    factInvented: false as const,
  })
}
