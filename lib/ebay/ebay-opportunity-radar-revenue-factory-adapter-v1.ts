import { createHash } from "node:crypto"

import { getSellerOsRadarPriceDistributionEconomicsV1,
  materializeSellerOsDeterministicFactoryCandidateV1 } from
  "./ebay-smart-stocking-durable-factory-v1"
import { buildPriceRepresentativenessV2 } from
  "./ebay-commercial-intelligence-upgrade-v1"
import { buildSellerOsPrelinkedLaunchConfigurationV1 } from
  "./ebay-prelinked-listing-fast-lane-foundation-v1"
import { calculateSellerOsProfitabilityFrontierV1 } from
  "./ebay-prelinked-profitability-frontier-v1"
import { calculateEbayUnitEconomics,
  DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG } from "./ebay-unit-economics"

export const OPPORTUNITY_RADAR_REVENUE_FACTORY_ADAPTER_VERSION =
  "OPPORTUNITY_RADAR_REVENUE_FACTORY_ADAPTER_V1" as const

const FAMILY_ID = /^market-family-v1:sha256:[0-9a-f]{64}$/
const OPPORTUNITY_CASE_ID = /^opportunity-case-v1:sha256:[0-9a-f]{64}$/
const SHA256 = /^sha256:[0-9a-f]{64}$/
const MAXIMUM_FAMILIES = 20
const MAXIMUM_CANDIDATES = 100
const MAXIMUM_RESEARCH_OBSERVATIONS = 1_000

type JsonRecord = Record<string, unknown>

type RadarRevenueFactoryReadClientV1 = Readonly<{
  rpc: (name: string, parameters?: JsonRecord) => PromiseLike<{
    data: unknown
    error: unknown
  }>
  from: (table: string) => any
}>

export type RadarRevenueFactoryFamilySeedV1 = Readonly<{
  familyId: string
  familyName: string
  opportunityCaseId: string
  demandEvidenceDigest: string
  familyDemandStatus: "FAMILY_DEMAND_PROVEN" | "FAMILY_DEMAND_SUPPORTED"
  soldComparableCount: number
  soldQuantityEvidence: number
  priceBand: Readonly<{
    currency: string | null
    minimum: number | null
    maximum: number | null
    median: number | null
  }>
  priceDistributionEvidence: readonly string[]
  evidenceObservedAt: string
  sourceUpdatedAt: string
  maximumAgeSeconds: number
  fresh: true
  limitations: readonly string[]
  evidenceScope: "FAMILY_DISCOVERY_SEED_ONLY"
  demandEvidenceGrain: "FAMILY"
  exactProductDemandClaimed: false
  familyProductFunction: string
  familyCategoryId: string
  demandTerms: readonly Readonly<{
    term: string
    familyType: "CORE" | "FORM_FACTOR" | "FEATURE" | "USE_CASE" |
      "BENEFIT" | "PACK_FORMAT" | "AUDIENCE" | "ATTRIBUTE"
  }>[]
}>

export type RadarRevenueFactoryCandidateV1 = Readonly<{
  candidateId: string
  familyId: string
  familyName: string
  source: "RADAR_FRONTIER_LUNA_IDENTITY" | "PRODUCT_RESEARCH_EXACT_IDENTITY" |
    "RADAR_FAMILY_LUNA_SUPPLY_IDENTITY"
  disposition: "PASS_TO_LUNA" | "REJECT"
  dispositionReason: string
  exactCandidateIdentity: boolean
  lunaMatch: boolean
  stockReady: boolean
  readyForEconomics: boolean
  economicsProfit: number | null
  economicsMargin: number | null
  economicsNextEvidence: string | null
  supplierCostUsd: number | null
  supplierCostObservedAt: string | null
  productTitle: string | null
  variantTitle: string | null
  gtin: string | null
  canonicalProductUrl: string | null
  imageUrls: readonly string[]
  supplierInventoryQuantity: number | null
  familyAssignmentConfidence: "PROVEN" | "SUPPORTED" | null
  demandEvidenceGrain: "FAMILY"
  exactProductDemandClaimed: false
  marketRadarProductId: string | null
  lunaProductId: string | null
  lunaVariantId: string | null
  supplierSku: string | null
  productResearchIdentityHash: string | null
  lineage: RadarRevenueFactoryFamilySeedV1
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, maximum = 240) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
  return normalized && normalized.length <= maximum ? normalized : null
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function nonnegativeInteger(value: unknown) {
  const parsed = number(value)
  return parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function iso(value: unknown) {
  const candidate = text(value, 48)
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null
}

function limitations(value: unknown) {
  return Object.freeze([...new Set((Array.isArray(value) ? value : [])
    .map((entry) => text(entry, 160))
    .filter((entry): entry is string => Boolean(entry)))].slice(0, 30))
}

function priceDistributionEvidence(value: unknown) {
  return Object.freeze([...new Set((Array.isArray(value) ? value : [])
    .map((entry) => text(entry, 160))
    .filter((entry): entry is string => typeof entry === "string" &&
      /^marketplace_product_research_capture_observations:[0-9a-f-]{36}$/i
        .test(entry)))].sort().slice(0, 100))
}

const DEMAND_FAMILY_TYPES = new Set([
  "CORE", "FORM_FACTOR", "FEATURE", "USE_CASE", "BENEFIT", "PACK_FORMAT",
  "AUDIENCE", "ATTRIBUTE",
])

function demandTerms(value: unknown) {
  return Object.freeze(rows(record(value).soldWeightedTerms).flatMap((entry) => {
    const term = text(entry.term, 160)
    const familyType = text(entry.familyType, 32)
    return term && familyType && DEMAND_FAMILY_TYPES.has(familyType)
      ? [Object.freeze({ term, familyType: familyType as
          "CORE" | "FORM_FACTOR" | "FEATURE" | "USE_CASE" | "BENEFIT" |
          "PACK_FORMAT" | "AUDIENCE" | "ATTRIBUTE" })]
      : []
  }).slice(0, 40))
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

function currentObservation(family: JsonRecord) {
  return rows(family.observationSeries)[0] ?? record(family.currentObservation)
}

function familySeeds(radarPayload: unknown, allowedFamilyNames?: readonly string[]) {
  const root = record(radarPayload)
  if (root.status !== "AVAILABLE") return []
  const allowed = allowedFamilyNames?.length
    ? new Set(allowedFamilyNames.map((entry) => entry.normalize("NFKC").toLowerCase()))
    : null
  return rows(root.families).slice(0, MAXIMUM_FAMILIES).flatMap((family) => {
    const observation = currentObservation(family)
    const familyId = text(family.familyId, 120)
    const familyName = text(family.familyName, 200)
    const opportunityCaseId = text(family.opportunityCaseId, 120)
    const demandEvidenceDigest = text(observation.demandEvidenceDigest, 80)
    const soldComparableCount = nonnegativeInteger(observation.soldComparableCount)
    const soldQuantityEvidence = nonnegativeInteger(observation.soldQuantity)
    const evidenceObservedAt = iso(observation.evidenceObservedAt)
    const sourceUpdatedAt = iso(observation.sourceUpdatedAt)
    const maximumAgeSeconds = nonnegativeInteger(observation.maximumAgeSeconds)
    const attributeProfile = record(observation.attributeProfile)
    const familyProductFunction = text(
      attributeProfile["product family"] ?? familyName, 200)
    const familyCategoryId = text(attributeProfile["category id"], 20)
    const structuredDemandTerms = demandTerms(
      observation.demandKeywordDna ?? family.currentDemandKeywordDna)
    const familyDemandStatus = observation.familyDemandStatus
    if (!familyId || !FAMILY_ID.test(familyId) || !familyName ||
        !opportunityCaseId || !OPPORTUNITY_CASE_ID.test(opportunityCaseId) ||
        !demandEvidenceDigest || !SHA256.test(demandEvidenceDigest) ||
        !["FAMILY_DEMAND_PROVEN", "FAMILY_DEMAND_SUPPORTED"].includes(
          String(familyDemandStatus ?? "")) || observation.fresh !== true ||
        soldComparableCount === null || soldQuantityEvidence === null ||
        !evidenceObservedAt || !sourceUpdatedAt || maximumAgeSeconds === null ||
        maximumAgeSeconds < 1 || !familyProductFunction ||
        !familyCategoryId || !/^\d{1,20}$/.test(familyCategoryId) ||
        allowed && !allowed.has(familyName.normalize("NFKC").toLowerCase())) return []
    return [Object.freeze({
      familyId, familyName, opportunityCaseId, demandEvidenceDigest,
      familyDemandStatus: familyDemandStatus as
        "FAMILY_DEMAND_PROVEN" | "FAMILY_DEMAND_SUPPORTED",
      soldComparableCount, soldQuantityEvidence,
      priceBand: Object.freeze({
        currency: text(observation.priceCurrency, 12),
        minimum: number(observation.priceBandMinimum),
        maximum: number(observation.priceBandMaximum),
        median: number(observation.priceMedian),
      }),
      priceDistributionEvidence: priceDistributionEvidence(
        observation.priceDistributionEvidence),
      evidenceObservedAt, sourceUpdatedAt, maximumAgeSeconds, fresh: true as const,
      limitations: limitations(observation.limitations),
      evidenceScope: "FAMILY_DISCOVERY_SEED_ONLY" as const,
      demandEvidenceGrain: "FAMILY" as const,
      exactProductDemandClaimed: false as const,
      familyProductFunction, familyCategoryId,
      demandTerms: structuredDemandTerms,
    })]
  })
}

function catalogKey(productId: string, variantId: string, sku: string) {
  return `${productId}\n${variantId}\n${sku}`
}

const SUPPLIER_PRODUCT_TYPE_FAMILY_ANCHORS = Object.freeze({
  "jewelry accessories": ["jewelry", "necklace", "bracelet", "anklet", "ring",
    "earring", "pendant", "chain", "charm", "agate", "moonstone", "gemstone"],
  watches: ["watch", "wristwatch"],
  "hardware tools": ["hardware", "tool", "switch", "selector", "cartridge",
    "valve", "fastener", "clamp", "wrench", "drill"],
  "automotive vehicle": ["automotive", "vehicle", "car", "truck", "motorcycle",
    "battery switch", "mount"],
  "home kitchen": ["home", "kitchen", "organizer", "rack", "kettle", "cookware",
    "blanket", "scale"],
  "craft diy": ["craft", "diy", "sewing", "button", "sticker", "tapestry"],
  "phone electronics": ["phone", "electronic", "camera", "headphone", "charger",
    "adapter", "translator"],
  "beauty skincare": ["beauty", "skincare", "facial", "cosmetic", "makeup"],
  "health wellness": ["health", "wellness", "hearing", "medical", "supplement"],
  "sports outdoors": ["sport", "outdoor", "boxing", "camping", "fitness"],
} as const)

function normalizedPhrase(value: unknown) {
  return (text(value, 500) ?? "").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
}

function phraseIncluded(haystack: string, needle: string) {
  return Boolean(needle && ` ${haystack} `.includes(` ${needle} `))
}

function supplierCategoryCorroborated(row: JsonRecord) {
  const productType = normalizedPhrase(row.product_type)
  if (!productType) return false
  return (Array.isArray(row.tags) ? row.tags : []).some((tag) =>
    normalizedPhrase(tag).replace(/^category /, "") === productType)
}

function supplierTypeCompatible(
  seed: RadarRevenueFactoryFamilySeedV1,
  row: JsonRecord,
) {
  const productType = normalizedPhrase(row.product_type)
  const anchors = SUPPLIER_PRODUCT_TYPE_FAMILY_ANCHORS[
    productType as keyof typeof SUPPLIER_PRODUCT_TYPE_FAMILY_ANCHORS
  ] ?? []
  const familyEvidence = normalizedPhrase([
    seed.familyProductFunction,
    ...seed.demandTerms.map((entry) => entry.term),
  ].join(" "))
  return anchors.some((anchor) => phraseIncluded(
    familyEvidence, normalizedPhrase(anchor),
  ))
}

type FamilyLunaAssignmentV1 = Readonly<{
  seed: RadarRevenueFactoryFamilySeedV1
  row: JsonRecord
  key: string
  confidence: "PROVEN" | "SUPPORTED"
}>

function familyLunaAssignments(
  seeds: readonly RadarRevenueFactoryFamilySeedV1[],
  catalogRows: readonly unknown[],
) {
  const uniqueCatalog = new Map<string, JsonRecord>()
  for (const row of rows(catalogRows)) {
    const productId = text(row.supplier_product_id) ?? text(row.product_id)
    const variantId = text(row.supplier_variant_id)
    const sku = text(row.sku)
    if (productId && variantId && sku) {
      uniqueCatalog.set(catalogKey(productId, variantId, sku), row)
    }
  }
  const accepted: FamilyLunaAssignmentV1[] = []
  let ambiguousCount = 0
  for (const [key, row] of uniqueCatalog) {
    if (!supplierCategoryCorroborated(row)) continue
    const title = normalizedPhrase(`${text(row.title, 350) ?? ""} ${
      text(row.variant_title, 200) ?? ""}`)
    if (!title) continue
    const matches = seeds.flatMap((seed) => {
      if (!supplierTypeCompatible(seed, row)) return []
      const familyPhrase = normalizedPhrase(seed.familyProductFunction)
      const exactFamilyPhrase = phraseIncluded(title, familyPhrase)
      const coreMatches = seed.demandTerms.filter((entry) =>
        entry.familyType === "CORE" && normalizedPhrase(entry.term).split(" ").length >= 2
        && phraseIncluded(title, normalizedPhrase(entry.term)))
      const supportingMatches = seed.demandTerms.filter((entry) =>
        ["ATTRIBUTE", "FEATURE", "FORM_FACTOR", "USE_CASE"].includes(entry.familyType)
        && phraseIncluded(title, normalizedPhrase(entry.term)))
      const supported = coreMatches.length > 0 && supportingMatches.some((entry) =>
        !coreMatches.some((core) => normalizedPhrase(core.term)
          .includes(normalizedPhrase(entry.term))))
      if (!exactFamilyPhrase && !supported) return []
      return [{ seed, row, key,
        confidence: exactFamilyPhrase ? "PROVEN" as const : "SUPPORTED" as const }]
    })
    if (matches.length === 1) accepted.push(Object.freeze(matches[0]))
    else if (matches.length > 1) ambiguousCount += 1
  }
  return Object.freeze({
    assignments: Object.freeze(accepted),
    lunaProductsScanned: uniqueCatalog.size,
    familyToLunaCompatibleCount: accepted.length,
    ambiguousFamilyAssignments: ambiguousCount,
  })
}

function prepareProductResearchRows(
  values: readonly unknown[],
  seeds: readonly RadarRevenueFactoryFamilySeedV1[],
) {
  const seedIds = new Set(seeds.map((seed) => seed.familyId))
  const groupsByFamily = new Map<string, Map<string, JsonRecord[]>>()
  let validInputProducts = 0
  for (const row of rows(values)) {
    const familyId = text(row.radar_family_id, 120)
    const identityHash = text(row.identity_hash, 80)
    if (!familyId || !seedIds.has(familyId) || !identityHash ||
        !SHA256.test(identityHash)) continue
    validInputProducts += 1
    const groups = groupsByFamily.get(familyId) ?? new Map<string, JsonRecord[]>()
    const group = groups.get(identityHash) ?? []
    group.push(row)
    groups.set(identityHash, group)
    groupsByFamily.set(familyId, groups)
  }
  let conflictingIdentityGroups = 0
  const uniqueByFamily = new Map<string, JsonRecord[]>()
  for (const seed of seeds) {
    const groups = groupsByFamily.get(seed.familyId)
    if (!groups) continue
    const uniqueRows = [...groups].map(([identityHash, group]) => {
      const classifications = new Set(group.map((entry) =>
        text(entry.match_classification, 80) ?? "EXACT_PRODUCT_IDENTITY_UNPROVEN"))
      const variants = new Set(group.flatMap((entry) => {
        const variantId = text(entry.matched_supplier_variant_id)
        return variantId ? [variantId] : []
      }))
      const exactConsistent = classifications.size === 1 &&
        classifications.has("EXACT_LUNA_MATCH") && variants.size === 1 &&
        group.every((entry) => text(entry.matched_supplier_variant_id) !== null)
      const evidenceConsistent = classifications.size === 1 &&
        (variants.size <= 1 || exactConsistent)
      if (evidenceConsistent) return group[0]
      conflictingIdentityGroups += 1
      return { ...group[0], identity_hash: identityHash,
        match_classification: "AMBIGUOUS",
        matched_supplier_variant_id: null,
        match_reasons: ["DUPLICATE_IDENTITY_EVIDENCE_CONFLICT"] }
    })
    uniqueByFamily.set(seed.familyId, uniqueRows)
  }
  const interleaved: JsonRecord[] = []
  for (let index = 0; ; index += 1) {
    let added = false
    for (const seed of seeds) {
      const row = uniqueByFamily.get(seed.familyId)?.[index]
      if (row) {
        interleaved.push(row)
        added = true
      }
    }
    if (!added) break
  }
  const familiesWithInput = [...groupsByFamily.values()]
    .filter((groups) => groups.size > 0).length
  return Object.freeze({
    rows: Object.freeze(interleaved),
    inputProducts: validInputProducts,
    uniqueInputProducts: interleaved.length,
    duplicateCount: validInputProducts - interleaved.length,
    conflictingIdentityGroups,
    familiesWithInput,
  })
}

function frontierEconomicsReady(frontier: JsonRecord) {
  const distribution = getSellerOsRadarPriceDistributionEconomicsV1(frontier)
  const economics = text(frontier.economicClassification, 80)
  const hardBlockers = Array.isArray(frontier.currentHardBlockers)
    ? frontier.currentHardBlockers
    : Array.isArray(frontier.hardBlockers) ? frontier.hardBlockers : []
  const legacyReady = economics === "ECONOMICALLY_PROMISING" &&
    frontier.shippingStatus === "SHIPPING_DURABLY_PERSISTED" &&
    frontier.nextBestEvidence === "NONE" &&
    (number(frontier.contributionProfitAtMarketMedian) ?? 0) > 0 &&
    (number(frontier.contributionMarginAtMarketMedian) ?? 0) > 0 &&
    hardBlockers.length === 0
  return legacyReady || Boolean(distribution?.economicsReady &&
    frontier.shippingStatus === "SHIPPING_DURABLY_PERSISTED" &&
    frontier.nextBestEvidence === "NONE" && hardBlockers.length === 0)
}

export function buildRadarRevenueFactoryCandidateBatchV1(input: Readonly<{
  radarPayload: unknown
  frontierPayload: unknown
  lunaCatalogRows: readonly unknown[]
  productResearchRows?: readonly unknown[]
  allowedFamilyNames?: readonly string[]
  targetCandidates?: number
}>) {
  const seeds = familySeeds(input.radarPayload, input.allowedFamilyNames)
  const seedById = new Map(seeds.map((seed) => [seed.familyId, seed]))
  const catalog = new Map(rows(input.lunaCatalogRows).flatMap((row) => {
    const productId = text(row.supplier_product_id) ?? text(row.product_id)
    const variantId = text(row.supplier_variant_id)
    const sku = text(row.sku)
    return productId && variantId && sku
      ? [[catalogKey(productId, variantId, sku), row] as const] : []
  }))
  const maximum = Math.max(1, Math.min(MAXIMUM_CANDIDATES,
    Number.isInteger(input.targetCandidates) ? Number(input.targetCandidates) : 30))
  const candidates: RadarRevenueFactoryCandidateV1[] = []
  const seen = new Set<string>()
  const research = prepareProductResearchRows(input.productResearchRows ?? [], seeds)
  const frontierRoot = record(input.frontierPayload)
  const frontierRows = rows(frontierRoot.frontiers)
  const familySupply = familyLunaAssignments(seeds, input.lunaCatalogRows)
  let economicsPreflightCount = 0
  for (const assignment of familySupply.assignments) {
    if (candidates.length >= maximum) break
    const { seed, row, key, confidence } = assignment
    const productId = text(row.supplier_product_id) ?? text(row.product_id)
    const variantId = text(row.supplier_variant_id)
    const sku = text(row.sku)
    if (!productId || !variantId || !sku || seen.has(key)) continue
    const exactFrontiers = frontierRows.filter((outer) => {
      const frontier = record(outer.frontier)
      return text(frontier.familyId, 120) === seed.familyId &&
        text(outer.opportunityCaseId, 120) === seed.opportunityCaseId &&
        frontier.lunaProductId === productId &&
        frontier.lunaVariantId === variantId && frontier.lunaSku === sku
    })
    const exactFrontier = exactFrontiers.length === 1
      ? record(exactFrontiers[0].frontier) : null
    const exactTarget = exactFrontier
      ? getSellerOsRadarPriceDistributionEconomicsV1(exactFrontier) : null
    if (exactFrontier) economicsPreflightCount += 1
    seen.add(key)
    const available = row.available === true &&
      (number(row.inventory_quantity) === null || Number(row.inventory_quantity) > 0)
    candidates.push(Object.freeze({
      candidateId: digest({ familyId: seed.familyId, productId, variantId, sku }),
      familyId: seed.familyId, familyName: seed.familyName,
      source: "RADAR_FAMILY_LUNA_SUPPLY_IDENTITY" as const,
      disposition: "PASS_TO_LUNA" as const,
      dispositionReason: `FAMILY_TO_LUNA_${confidence}_STRUCTURED_ASSIGNMENT`,
      exactCandidateIdentity: true, lunaMatch: true, stockReady: available,
      readyForEconomics: exactFrontier
        ? frontierEconomicsReady(exactFrontier) : false,
      economicsProfit: exactFrontier
        ? exactTarget?.profit ??
          number(exactFrontier.contributionProfitAtMarketMedian) : null,
      economicsMargin: exactFrontier
        ? exactTarget?.margin ??
          number(exactFrontier.contributionMarginAtMarketMedian) : null,
      economicsNextEvidence: exactFrontier
        ? text(exactFrontier.nextBestEvidence, 80) : null,
      supplierCostUsd: number(row.price),
      supplierCostObservedAt: iso(row.captured_at),
      productTitle: text(row.title, 350), variantTitle: text(row.variant_title, 200),
      gtin: text(row.barcode, 120),
      canonicalProductUrl: text(row.product_url, 500),
      imageUrls: Object.freeze((Array.isArray(row.image_urls)
        ? row.image_urls : []).flatMap((entry) => {
          const url = text(entry, 500)
          return url ? [url] : []
        }).slice(0, 24)),
      supplierInventoryQuantity: number(row.inventory_quantity),
      familyAssignmentConfidence: confidence,
      demandEvidenceGrain: "FAMILY" as const,
      exactProductDemandClaimed: false as const,
      marketRadarProductId: text(row.product_id),
      lunaProductId: productId, lunaVariantId: variantId, supplierSku: sku,
      productResearchIdentityHash: null, lineage: seed,
    }))
  }
  for (const outer of frontierRows) {
    const frontier = record(outer.frontier)
    const seed = seedById.get(text(frontier.familyId, 120) ?? "")
    const productId = text(frontier.lunaProductId)
    const variantId = text(frontier.lunaVariantId)
    const sku = text(frontier.lunaSku)
    if (!seed || !productId || !variantId || !sku ||
        text(outer.opportunityCaseId, 120) !== seed.opportunityCaseId) continue
    const key = catalogKey(productId, variantId, sku)
    const row = catalog.get(key)
    if (!row || seen.has(key)) continue
    seen.add(key)
    const available = row.available === true &&
      (number(row.inventory_quantity) === null || Number(row.inventory_quantity) > 0)
    const economicsReady = frontierEconomicsReady(frontier)
    const target = getSellerOsRadarPriceDistributionEconomicsV1(frontier)
    candidates.push(Object.freeze({
      candidateId: digest({ familyId: seed.familyId, productId, variantId, sku }),
      familyId: seed.familyId, familyName: seed.familyName,
      source: "RADAR_FRONTIER_LUNA_IDENTITY" as const,
      disposition: "PASS_TO_LUNA" as const,
      dispositionReason: "EXACT_LUNA_PRODUCT_VARIANT_IDENTITY_ALREADY_PROVEN",
      exactCandidateIdentity: true, lunaMatch: true, stockReady: available,
      readyForEconomics: economicsReady,
      economicsProfit: target?.profit ??
        number(frontier.contributionProfitAtMarketMedian),
      economicsMargin: target?.margin ??
        number(frontier.contributionMarginAtMarketMedian),
      economicsNextEvidence: text(frontier.nextBestEvidence, 80),
      supplierCostUsd: number(row.price),
      supplierCostObservedAt: iso(row.captured_at),
      productTitle: text(row.title, 350), variantTitle: text(row.variant_title, 200),
      gtin: text(row.barcode, 120),
      canonicalProductUrl: text(row.product_url, 500),
      imageUrls: Object.freeze((Array.isArray(row.image_urls)
        ? row.image_urls : []).flatMap((entry) => {
          const url = text(entry, 500)
          return url ? [url] : []
        }).slice(0, 24)),
      supplierInventoryQuantity: number(row.inventory_quantity),
      familyAssignmentConfidence: null,
      demandEvidenceGrain: "FAMILY" as const,
      exactProductDemandClaimed: false as const,
      marketRadarProductId: text(row.product_id),
      lunaProductId: productId, lunaVariantId: variantId, supplierSku: sku,
      productResearchIdentityHash: null, lineage: seed,
    }))
  }
  for (const observation of research.rows) {
    if (candidates.length >= maximum) break
    const familyId = text(observation.radar_family_id, 120)
    const seed = familyId ? seedById.get(familyId) : null
    const identityHash = text(observation.identity_hash, 80)
    if (!seed || !identityHash || !SHA256.test(identityHash)) continue
    const key = `${seed.familyId}\n${identityHash}`
    if (seen.has(key)) continue
    seen.add(key)
    const matchClass = text(observation.match_classification, 80)
    const matchedVariantId = text(observation.matched_supplier_variant_id)
    const exact = matchClass === "EXACT_LUNA_MATCH" &&
      Boolean(matchedVariantId)
    candidates.push(Object.freeze({
      candidateId: digest({ familyId: seed.familyId, identityHash }),
      familyId: seed.familyId, familyName: seed.familyName,
      source: "PRODUCT_RESEARCH_EXACT_IDENTITY" as const,
      disposition: exact ? "PASS_TO_LUNA" as const : "REJECT" as const,
      dispositionReason: exact
        ? "PRODUCT_RESEARCH_EXACT_LUNA_MATCH"
        : `FAMILY_SEED_ONLY_${matchClass ?? "EXACT_PRODUCT_IDENTITY_UNPROVEN"}`,
      exactCandidateIdentity: true, lunaMatch: exact, stockReady: false,
      readyForEconomics: false, economicsProfit: null, economicsMargin: null,
      economicsNextEvidence: null, supplierCostUsd: null,
      supplierCostObservedAt: null,
      productTitle: null, variantTitle: null, gtin: null,
      canonicalProductUrl: null, imageUrls: Object.freeze([]),
      supplierInventoryQuantity: null,
      marketRadarProductId: null,
      familyAssignmentConfidence: null,
      demandEvidenceGrain: "FAMILY" as const,
      exactProductDemandClaimed: false as const,
      lunaProductId: null, lunaVariantId: matchedVariantId,
      supplierSku: null, productResearchIdentityHash: identityHash, lineage: seed,
    }))
  }
  const bounded = Object.freeze(candidates.slice(0, maximum))
  return Object.freeze({
    adapterVersion: OPPORTUNITY_RADAR_REVENUE_FACTORY_ADAPTER_VERSION,
    seeds: Object.freeze(seeds), candidates: bounded,
    radarSeedAccepted: seeds.length > 0,
    radarSeedsUsed: new Set(bounded.map((candidate) => candidate.familyId)).size,
    candidatesGenerated: bounded.length,
    exactProductFitCount: bounded.filter((candidate) =>
      candidate.exactCandidateIdentity && candidate.disposition === "PASS_TO_LUNA").length,
    lunaMatchCount: bounded.filter((candidate) => candidate.lunaMatch).length,
    stockReadyCount: bounded.filter((candidate) => candidate.stockReady).length,
    readyForEconomicsCount: bounded.filter((candidate) => candidate.readyForEconomics).length,
    freshFamiliesEvaluated: seeds.length,
    lunaProductsScanned: familySupply.lunaProductsScanned,
    familyToLunaCompatibleCount: familySupply.assignments.length,
    uniqueLunaCandidates: new Set(familySupply.assignments.map((entry) => entry.key)).size,
    ambiguousFamilyAssignments: familySupply.ambiguousFamilyAssignments,
    stockSafeCount: bounded.filter((candidate) =>
      candidate.source === "RADAR_FAMILY_LUNA_SUPPLY_IDENTITY" &&
      candidate.stockReady).length,
    economicsPreflightCount,
    economicsReadyCount: bounded.filter((candidate) =>
      candidate.source === "RADAR_FAMILY_LUNA_SUPPLY_IDENTITY" &&
      candidate.readyForEconomics).length,
    rejectedCount: bounded.filter((candidate) => candidate.disposition === "REJECT").length,
    inputProducts: research.inputProducts,
    uniqueInputProducts: research.uniqueInputProducts,
    duplicateCount: research.duplicateCount,
    ambiguousCount: bounded.filter((candidate) =>
      candidate.dispositionReason === "FAMILY_SEED_ONLY_AMBIGUOUS").length,
    differentVariantCount: bounded.filter((candidate) =>
      candidate.dispositionReason === "FAMILY_SEED_ONLY_DIFFERENT_VARIANT").length,
    noLunaMatchCount: bounded.filter((candidate) =>
      candidate.dispositionReason === "FAMILY_SEED_ONLY_NO_LUNA_MATCH").length,
    conflictingIdentityGroups: research.conflictingIdentityGroups,
    familiesWithInput: research.familiesWithInput,
    allFamiliesWithInputReceiveBoundedCoverage: research.familiesWithInput === 0 ||
      seeds.filter((seed) => research.rows.some((row) =>
        row.radar_family_id === seed.familyId)).every((seed) =>
        bounded.some((candidate) => candidate.familyId === seed.familyId)),
    evidenceLineagePreserved: bounded.length > 0 && bounded.every((candidate) =>
      candidate.lineage.evidenceScope === "FAMILY_DISCOVERY_SEED_ONLY" &&
      candidate.lineage.exactProductDemandClaimed === false),
    marketplaceWrites: 0 as const,
  })
}

function normalizedWords(value: unknown) {
  return new Set((text(value, 300) ?? "").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/).filter((word) => word.length >= 2))
}

function familyForResearchBatch(
  batch: JsonRecord,
  seeds: readonly RadarRevenueFactoryFamilySeedV1[],
) {
  const patterns = new Set((Array.isArray(batch.search_keyword_patterns)
    ? batch.search_keyword_patterns : []).flatMap((entry) =>
    [...normalizedWords(entry)]))
  return seeds.map((seed) => ({ seed,
    overlap: [...normalizedWords(seed.familyName)].filter((word) =>
      patterns.has(word)).length }))
    .filter((entry) => entry.overlap >= 2)
    .sort((left, right) => right.overlap - left.overlap ||
      left.seed.familyId.localeCompare(right.seed.familyId))[0]?.seed ?? null
}

export async function collectRadarRevenueFactoryCandidateBatchV1(input: Readonly<{
  supabase: RadarRevenueFactoryReadClientV1
  accountKey: string
  allowedFamilyNames?: readonly string[]
  targetCandidates?: number
  includeProductResearch?: boolean
}>) {
  const radarResult = await input.supabase.rpc(
    "get_seller_os_family_market_radar_v1", { p_family_id: null, p_limit: 100 },
  )
  if (radarResult.error) throw new Error("REVENUE_FACTORY_RADAR_READ_FAILED")
  const initial = buildRadarRevenueFactoryCandidateBatchV1({
    radarPayload: radarResult.data, frontierPayload: null, lunaCatalogRows: [],
    allowedFamilyNames: input.allowedFamilyNames, targetCandidates: 1,
  })
  if (!initial.seeds.length) throw new Error("REVENUE_FACTORY_RADAR_SEED_UNAVAILABLE")
  const familyIds = initial.seeds.map((seed) => seed.familyId)
  const [frontierResult, catalogResult] = await Promise.all([
    input.supabase.rpc("get_seller_os_latest_profitability_frontiers_v1", {
      p_account_key: input.accountKey, p_marketplace_id: "EBAY_US",
      p_family_ids: familyIds, p_limit: 100,
    }),
    input.supabase.from("market_radar_latest_variants")
      .select("product_id,supplier_product_id,supplier_variant_id,sku,title,variant_title,product_type,tags,metadata,price,available,inventory_quantity,product_url,image_urls,barcode,captured_at")
      .eq("source_key", "lunaportex").order("captured_at", { ascending: false })
      .limit(2_000),
  ])
  if (frontierResult.error || catalogResult.error) {
    throw new Error("REVENUE_FACTORY_EXACT_IDENTITY_READ_FAILED")
  }
  let researchRows: JsonRecord[] = []
  if (input.includeProductResearch !== false) {
    const batchResult = await input.supabase
      .from("marketplace_product_research_capture_batches")
      .select("id,search_keyword_patterns,captured_at")
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", "EBAY_US")
      .order("captured_at", { ascending: false }).limit(100)
    if (batchResult.error) throw new Error("REVENUE_FACTORY_PRODUCT_RESEARCH_BATCH_READ_FAILED")
    const latestBatchesByFamily = new Map<string, string[]>()
    for (const batch of rows(batchResult.data)) {
      const seed = familyForResearchBatch(batch, initial.seeds)
      const batchId = text(batch.id, 80)
      if (seed && batchId) {
        const selected = latestBatchesByFamily.get(seed.familyId) ?? []
        if (selected.length < 3 && !selected.includes(batchId)) {
          selected.push(batchId)
          latestBatchesByFamily.set(seed.familyId, selected)
        }
      }
    }
    const familyByBatch = new Map([...latestBatchesByFamily]
      .flatMap(([familyId, batchIds]) => batchIds.map((batchId) =>
        [batchId, familyId] as const)))
    const batchIds = [...familyByBatch.keys()]
    if (batchIds.length) {
      const observationResult = await input.supabase
        .from("marketplace_product_research_capture_observations")
        .select("id,capture_batch_id,identity_hash,normalized_identity,match_classification,match_reasons,matched_supplier_variant_id,last_sold_date,confirmed_sold_quantity")
        .eq("marketplace_account_key", input.accountKey)
        .eq("marketplace", "EBAY_US").eq("evidence_reviewed", true)
        .eq("quality_status", "VALID").in("capture_batch_id", batchIds)
        .order("last_sold_date", { ascending: false })
        .limit(MAXIMUM_RESEARCH_OBSERVATIONS)
      if (observationResult.error) {
        throw new Error("REVENUE_FACTORY_PRODUCT_RESEARCH_OBSERVATION_READ_FAILED")
      }
      researchRows = rows(observationResult.data).map((row) => ({ ...row,
        radar_family_id: familyByBatch.get(text(row.capture_batch_id, 80) ?? "") ?? null }))
    }
  }
  return buildRadarRevenueFactoryCandidateBatchV1({
    radarPayload: radarResult.data, frontierPayload: frontierResult.data,
    lunaCatalogRows: rows(catalogResult.data), productResearchRows: researchRows,
    allowedFamilyNames: input.allowedFamilyNames,
    targetCandidates: input.targetCandidates,
  })
}

type RadarEconomicsPreflightClientV1 = Readonly<{
  rpc: (name: string, parameters?: JsonRecord) => PromiseLike<{
    data: unknown
    error: unknown
  }>
}>

function normalizedInstant(value: string) {
  return new Date(Date.parse(value)).toISOString()
}

function laterInstant(left: string, right: string) {
  return normalizedInstant(Date.parse(left) >= Date.parse(right) ? left : right)
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

export function buildRadarCandidateEconomicsPreflightV1(input: Readonly<{
  accountKey: string
  candidate: RadarRevenueFactoryCandidateV1
}>) {
  const candidate = input.candidate
  if (candidate.source !== "RADAR_FAMILY_LUNA_SUPPLY_IDENTITY" ||
      candidate.disposition !== "PASS_TO_LUNA" ||
      !candidate.exactCandidateIdentity || !candidate.lunaMatch ||
      !candidate.stockReady || !candidate.lunaProductId ||
      !candidate.lunaVariantId || !candidate.supplierSku) {
    throw new Error("RADAR_ECONOMICS_PREFLIGHT_CANDIDATE_NOT_ELIGIBLE")
  }
  if (candidate.lineage.familyDemandStatus !== "FAMILY_DEMAND_PROVEN" &&
      candidate.lineage.familyDemandStatus !== "FAMILY_DEMAND_SUPPORTED") {
    throw new Error("RADAR_ECONOMICS_PREFLIGHT_DEMAND_NOT_READY")
  }
  if (candidate.lineage.priceBand.currency !== "USD" ||
      candidate.lineage.priceBand.minimum === null ||
      candidate.lineage.priceBand.median === null ||
      candidate.lineage.priceBand.maximum === null) {
    throw new Error("RADAR_ECONOMICS_PREFLIGHT_MARKET_PRICE_UNPROVEN")
  }
  if (candidate.supplierCostUsd === null || candidate.supplierCostUsd <= 0 ||
      !candidate.supplierCostObservedAt) {
    throw new Error("RADAR_ECONOMICS_PREFLIGHT_SUPPLIER_COST_UNPROVEN")
  }
  const configuration = buildSellerOsPrelinkedLaunchConfigurationV1({
    accountKey: input.accountKey,
    marketplaceId: "EBAY_US",
    configurationMode: "SINGLE_COMPONENT",
    expectedComponentCount: 1,
    components: [{
      lunaProductId: candidate.lunaProductId,
      lunaVariantId: candidate.lunaVariantId,
      lunaSku: candidate.supplierSku,
      supplierQuantityRequired: 1,
      supplierIdentityStatus: "EXACT_PRELINKED",
      p2LinkageId: null,
    }],
  })
  if (!configuration.complete || configuration.components.length !== 1) {
    throw new Error("RADAR_ECONOMICS_PREFLIGHT_CONFIGURATION_NOT_EXACT")
  }
  const evaluatedAt = laterInstant(candidate.lineage.sourceUpdatedAt,
    candidate.supplierCostObservedAt)
  const marketReference = `radar-family-demand:${candidate.lineage.familyId}`
  const marketEvidence = Object.freeze({
    authorityClass: "OFFICIAL_EXTERNAL_FACT" as const,
    reference: marketReference,
    evidenceDigest: candidate.lineage.demandEvidenceDigest,
    observedAt: normalizedInstant(candidate.lineage.evidenceObservedAt),
    maximumAgeSeconds: candidate.lineage.maximumAgeSeconds,
  })
  const supplierEvidenceDigest = digest({
    source: "LUNA_MARKET_RADAR_EXACT_VARIANT_PRICE_USD_V1",
    productId: candidate.lunaProductId,
    variantId: candidate.lunaVariantId,
    supplierSku: candidate.supplierSku,
    unitCostUsd: candidate.supplierCostUsd,
    observedAt: normalizedInstant(candidate.supplierCostObservedAt),
  })
  const costEvidence = Object.freeze({
    authorityClass: "OFFICIAL_EXTERNAL_FACT" as const,
    reference: `luna-market-radar-variant:${candidate.lunaVariantId}`,
    evidenceDigest: supplierEvidenceDigest,
    observedAt: normalizedInstant(candidate.supplierCostObservedAt),
    maximumAgeSeconds: 30 * 24 * 60 * 60,
  })
  const shippingEvidence = Object.freeze({
    authorityClass: "UNPROVEN" as const,
    reference: `luna-shipping-candidate:${candidate.candidateId}`,
    evidenceDigest: digest({ candidateId: candidate.candidateId,
      shippingStatus: "UNPROVEN" }),
    observedAt: evaluatedAt,
    maximumAgeSeconds: 30 * 24 * 60 * 60,
  })
  const price = candidate.lineage.priceBand
  const frontier = calculateSellerOsProfitabilityFrontierV1({
    configurationId: configuration.configurationIdentity,
    familyId: candidate.familyId,
    familyName: candidate.familyName,
    familyDemandStatus: candidate.lineage.familyDemandStatus,
    lunaProductId: candidate.lunaProductId,
    lunaVariantId: candidate.lunaVariantId,
    lunaSku: candidate.supplierSku,
    // The accepted assignment requires corroborated supplier category/type,
    // structured family terms and one unique exact supplier identity. Title
    // overlap alone never reaches this branch.
    productFit: "STRONG",
    components: [{
      componentId: configuration.components[0].componentIdentityId,
      unitCostUsd: candidate.supplierCostUsd,
      supplierQuantityRequired: 1,
      costEvidence,
      quantityEvidence: costEvidence,
    }],
    marketPrices: {
      low: { valueUsd: price.minimum, support: "SUPPORTED", evidence: marketEvidence },
      median: { valueUsd: price.median, support: "SUPPORTED", evidence: marketEvidence },
      high: { valueUsd: price.maximum, support: "SUPPORTED", evidence: marketEvidence },
    },
    shipping: { status: "SHIPPING_UNPROVEN", valueUsd: null,
      evidence: shippingEvidence },
    complianceStatus: "UNPROVEN",
    currentHardBlockers: [],
    evidenceAcquisitionCost: "LOW",
    evaluatedAt,
  })
  const economicPolicyDigest = digest({
    source: "SERVER_CANONICAL_EBAY_UNIT_ECONOMICS_V1",
    config: DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG,
  })
  return Object.freeze({
    candidateId: candidate.candidateId,
    frontier,
    persistence: Object.freeze({
      opportunityCaseId: candidate.lineage.opportunityCaseId,
      marketPriceEvidenceReference: marketReference,
      marketPriceEvidenceDigest: candidate.lineage.demandEvidenceDigest,
      ebayFeePolicyReference:
        "SERVER_CANONICAL_EBAY_UNIT_ECONOMICS_V1_PROVISIONAL_FEE_POLICY",
      economicPolicyReference: "SERVER_CANONICAL_EBAY_UNIT_ECONOMICS_V1",
      economicPolicyDigest,
      sourceUpdatedAt: normalizedInstant(candidate.lineage.sourceUpdatedAt),
      evidenceCutoffAt: evaluatedAt,
    }),
    shippingRequestedOnlyWhenNeeded:
      frontier.nextBestEvidence === "ACTUAL_LUNA_SHIPPING",
    marketplaceWrites: 0 as const,
  })
}

/**
 * Creates or reuses the existing durable profitability frontier for every
 * independently eligible stock-safe Radar candidate. A failed candidate is
 * parked in the returned outcome and never aborts the remaining batch.
 */
export async function ensureRadarCandidateEconomicsPreflightsV1(input: Readonly<{
  supabase: RadarEconomicsPreflightClientV1
  accountKey: string
  batch: ReturnType<typeof buildRadarRevenueFactoryCandidateBatchV1>
}>) {
  const outcomes: JsonRecord[] = []
  for (const candidate of input.batch.candidates) {
    if (candidate.source !== "RADAR_FAMILY_LUNA_SUPPLY_IDENTITY" ||
        candidate.disposition !== "PASS_TO_LUNA" || !candidate.stockReady ||
        candidate.economicsNextEvidence !== null || candidate.readyForEconomics) {
      continue
    }
    try {
      const preflight = buildRadarCandidateEconomicsPreflightV1({
        accountKey: input.accountKey, candidate,
      })
      const persistence = preflight.persistence
      const write = await input.supabase.rpc(
        "put_seller_os_profitability_frontier_v1", {
          p_account_key: input.accountKey,
          p_marketplace_id: "EBAY_US",
          p_opportunity_case_id: persistence.opportunityCaseId,
          p_market_price_evidence_reference:
            persistence.marketPriceEvidenceReference,
          p_market_price_evidence_digest:
            persistence.marketPriceEvidenceDigest,
          p_ebay_fee_policy_reference: persistence.ebayFeePolicyReference,
          p_economic_policy_reference: persistence.economicPolicyReference,
          p_economic_policy_digest: persistence.economicPolicyDigest,
          p_source_updated_at: persistence.sourceUpdatedAt,
          p_evidence_cutoff_at: persistence.evidenceCutoffAt,
          p_frontier: preflight.frontier,
        })
      const result = record(write.data)
      const outcome = text(result.outcome, 40)
      if (write.error || !["CREATED", "IDEMPOTENT_SUCCESS"].includes(
        outcome ?? "")) {
        throw new Error("RADAR_ECONOMICS_PREFLIGHT_DURABLE_WRITE_FAILED")
      }
      outcomes.push({ candidateId: candidate.candidateId,
        status: outcome === "CREATED" ? "CREATED" : "REUSED",
        reasonCode: preflight.frontier.nextBestEvidence === "ACTUAL_LUNA_SHIPPING"
          ? "SHIPPING_EVIDENCE_REQUIRED" : preflight.frontier.nextBestEvidence,
        frontierDigest: preflight.frontier.frontierDigest,
        shippingRequestedOnlyWhenNeeded:
          preflight.shippingRequestedOnlyWhenNeeded })
    } catch (error) {
      outcomes.push({ candidateId: candidate.candidateId, status: "PARKED_ECONOMICS",
        reasonCode: failureCode(error) })
    }
  }
  return Object.freeze({
    attempted: outcomes.length,
    created: outcomes.filter((entry) => entry.status === "CREATED").length,
    reused: outcomes.filter((entry) => entry.status === "REUSED").length,
    parkedEconomics: outcomes.filter((entry) =>
      entry.status === "PARKED_ECONOMICS").length,
    outcomes: Object.freeze(outcomes),
    marketplaceWrites: 0 as const,
  })
}

type DurableFactoryClientV1 = Parameters<
  typeof materializeSellerOsDeterministicFactoryCandidateV1
>[0]["supabase"]

type DurableFactoryMaterializerV1 =
  typeof materializeSellerOsDeterministicFactoryCandidateV1

function uuid(value: unknown) {
  const candidate = text(value, 80)
  return candidate && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(candidate) ? candidate : null
}

function exactQueueIdentity(
  candidate: RadarRevenueFactoryCandidateV1,
  queueRow: JsonRecord,
) {
  return queueRow.supplier_product_id === candidate.lunaProductId &&
    queueRow.supplier_variant_id === candidate.lunaVariantId &&
    queueRow.supplier_sku === candidate.supplierSku
}

function radarShippingCandidateIdentity(
  candidate: RadarRevenueFactoryCandidateV1,
  queueRow: JsonRecord,
) {
  const continuation = record(record(queueRow.assessment)
    .radarAutomaticLunaShippingContinuationV1)
  return exactQueueIdentity(candidate, queueRow) &&
    continuation.candidateId === candidate.candidateId &&
    continuation.lunaProductId === candidate.lunaProductId &&
    continuation.lunaVariantId === candidate.lunaVariantId &&
    continuation.supplierSku === candidate.supplierSku
}

function embeddedDecisionPackageId(queueRow: JsonRecord) {
  const assessment = record(queueRow.assessment)
  return uuid(record(assessment.smartStockingListingIntakeV1).decisionPackageId)
    ?? uuid(record(assessment.sellerOsDeterministicFactory).decisionPackageId)
    ?? uuid(assessment.decisionPackageId)
}

function failureCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_]{2,119}$/.test(message)
    ? message : "RADAR_DURABLE_FACTORY_CANDIDATE_FAILED"
}

function buildRadarSmartStockingQueueRowV1(
  candidate: RadarRevenueFactoryCandidateV1,
) {
  if (!candidate.lunaProductId || !candidate.lunaVariantId ||
      !candidate.supplierSku || !candidate.productTitle ||
      candidate.supplierCostUsd === null || !candidate.supplierCostObservedAt) {
    throw new Error("RADAR_SMART_STOCKING_DURABLE_INPUT_UNPROVEN")
  }
  const stock = Object.freeze({
    state: "IN_STOCK_SUPPLIER_STATED" as const,
    freshness: "FRESH" as const,
    observedAt: normalizedInstant(candidate.supplierCostObservedAt),
    exactIdentityVerified: true as const,
    supplierStatedQuantity: candidate.supplierInventoryQuantity,
    safeCapacity: null,
    safeCapacityStatus: "UNPROVEN_NOT_INFERRED" as const,
  })
  const productTruthCore = {
    authorityClass: "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1",
    candidateKey: candidate.candidateId,
    lunaProductId: candidate.lunaProductId,
    lunaVariantId: candidate.lunaVariantId,
    supplierSku: candidate.supplierSku,
    gtin: candidate.gtin,
    supplierPriceUsd: candidate.supplierCostUsd,
    title: candidate.productTitle,
    sourceUrl: candidate.canonicalProductUrl,
    imageCount: candidate.imageUrls.length,
    rawHtmlStored: false,
    marketplaceWrites: 0,
    stock,
  }
  const canonicalReadinessBlockers = [
    ...(candidate.imageUrls.length ? [] : ["AUTHORIZED_PRODUCT_IMAGES_UNPROVEN"]),
    ...(!candidate.lineage.familyCategoryId
      ? ["MARKETPLACE_CATEGORY_NOT_READY"] : []),
    "MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN",
  ]
  const shippingRequired = candidate.economicsNextEvidence ===
    "ACTUAL_LUNA_SHIPPING"
  const assessment = {
    radarFactoryCandidateV1: {
      contractVersion: "NIGHT_RADAR_AUTOMATIC_GOLDEN_PATH_HANDOFF_V1",
      authority: "SELLER_OS_DETERMINISTIC_FACTORY",
      candidateId: candidate.candidateId,
      familyId: candidate.familyId,
      demandEvidenceGrain: candidate.demandEvidenceGrain,
      exactProductDemandClaimed: false,
      familyAssignmentConfidence: candidate.familyAssignmentConfidence,
      itemSpecificLogicUsed: false,
      marketplaceWrites: 0,
    },
    radarAutomaticLunaShippingContinuationV1: {
      contractVersion: "RADAR_AUTOMATIC_LUNA_SHIPPING_CONTINUATION_V1",
      candidateId: candidate.candidateId,
      lunaProductId: candidate.lunaProductId,
      lunaVariantId: candidate.lunaVariantId,
      supplierSku: candidate.supplierSku,
      shippingJobStatus: shippingRequired
        ? "WAITING_BROWSER_WORKER" : "SHIPPING_EVIDENCE_DURABLE",
      canonicalDestinationBindingRequired: true,
      purchaseBoundaryEnforced: true,
      rawAddressPersisted: false,
      oneShippingCapturePerCandidateAtATime: true,
      itemSpecificLogicUsed: false,
    },
    candidate: {
      candidateKey: candidate.candidateId,
      marketRadarProductId: candidate.marketRadarProductId,
      supplierProductId: candidate.lunaProductId,
      supplierVariantId: candidate.lunaVariantId,
      sku: candidate.supplierSku,
      title: candidate.productTitle,
      variantTitle: candidate.variantTitle,
      gtin: candidate.gtin,
      supplierCost: candidate.supplierCostUsd,
      available: true,
      inventoryQuantity: candidate.supplierInventoryQuantity,
      stockCapturedAt: normalizedInstant(candidate.supplierCostObservedAt),
      imageUrls: candidate.imageUrls,
      description: "",
    },
    productTruth: { ...productTruthCore,
      evidenceDigest: digest(productTruthCore) },
    identity: { exactIdentityConfirmed: true, comparables: [] },
    economics: {
      ready: candidate.readyForEconomics,
      estimatedNetProfit: candidate.economicsProfit,
      estimatedNetMarginPercent: candidate.economicsMargin,
    },
    market: {
      familyDemandStatus: candidate.lineage.familyDemandStatus,
      demandEvidenceGrain: "FAMILY",
      exactProductDemandClaimed: false,
    },
    canonicalReadiness: { blockers: canonicalReadinessBlockers },
    listingIntelligencePackage: {
      recommendedTitle: candidate.productTitle.slice(0, 80),
      titleStrategy: {
        titleFormula: candidate.productTitle.slice(0, 80),
        primarySearchPhrase: candidate.lineage.familyName,
        secondarySearchTerms: [],
        confirmedAttributes: [],
        strategyConfidence: "PRODUCT_TRUTH_AND_FAMILY_MARKET_SUPPORTED",
      },
      categoryRecommendation: {
        categoryId: candidate.lineage.familyCategoryId,
        categoryName: candidate.lineage.familyName,
      },
      itemSpecifics: { supplierConfirmed: {} },
      shippingRecommendation: {
        supplierShippingEconomicsUsd: null,
        buyerFacingShippingPolicy: "USE_CANONICAL_ACCOUNT_POLICY",
      },
    },
    hardGates: canonicalReadinessBlockers,
    evidenceGuards: [],
  }
  return {
    candidate_key: candidate.candidateId,
    market_radar_product_id: candidate.marketRadarProductId,
    supplier_product_id: candidate.lunaProductId,
    supplier_variant_id: candidate.lunaVariantId,
    supplier_sku: candidate.supplierSku,
    product_title: candidate.productTitle,
    variant_title: candidate.variantTitle,
    gtin: candidate.gtin,
    queue_status: "review",
    decision: shippingRequired
      ? "WAITING_BROWSER_WORKER" : "FACTORY_PREPARED",
    opportunity_score: 0,
    demand_score: candidate.lineage.familyDemandStatus ===
      "FAMILY_DEMAND_PROVEN" ? 100 : 75,
    economics_score: candidate.readyForEconomics ? 100 : 0,
    identity_score: 100,
    competition_score: 0,
    supply_score: 100,
    listing_readiness_score: 0,
    active_comparables: candidate.lineage.soldComparableCount,
    sellers_with_movement: 0,
    estimated_weekly_velocity: null,
    median_total_buyer_price: candidate.lineage.priceBand.median,
    estimated_net_profit: candidate.economicsProfit,
    supplier_price: candidate.supplierCostUsd,
    supplier_available: true,
    supplier_inventory_quantity: candidate.supplierInventoryQuantity,
    supplier_snapshot_at: normalizedInstant(candidate.supplierCostObservedAt),
    best_selling_match_score: null,
    best_selling_matches: [],
    keyword_structure: assessment.listingIntelligencePackage.titleStrategy,
    hard_gates: canonicalReadinessBlockers,
    evidence_guards: [],
    assessment,
    last_scanned_at: normalizedInstant(candidate.supplierCostObservedAt),
    next_scan_at: new Date(Date.parse(candidate.supplierCostObservedAt) +
      86_400_000).toISOString(),
    updated_at: normalizedInstant(candidate.supplierCostObservedAt),
  }
}

/**
 * The durable handoff for the existing Radar adapter. This function does not
 * create a second candidate model: it resolves the exact existing Smart
 * Stocking row and delegates package/readiness writes to the general factory.
 */
export async function materializeRadarRevenueFactoryCandidateBatchV1(
  input: Readonly<{
    supabase: DurableFactoryClientV1
    accountKey: string
    batch: ReturnType<typeof buildRadarRevenueFactoryCandidateBatchV1>
    materializeCandidate?: DurableFactoryMaterializerV1
    continuePriceDistribution?: typeof continueRadarCandidatePriceDistributionV1
  }>,
) {
  const startedAt = Date.now()
  const materializeCandidate = input.materializeCandidate ??
    materializeSellerOsDeterministicFactoryCandidateV1
  const candidates = [...input.batch.candidates]
  const durableCandidates = candidates.filter((candidate) =>
    candidate.disposition === "PASS_TO_LUNA" &&
    candidate.exactCandidateIdentity && candidate.lunaMatch &&
    candidate.stockReady && (candidate.readyForEconomics ||
      candidate.economicsNextEvidence === "ACTUAL_LUNA_SHIPPING" ||
      candidate.economicsNextEvidence === "BETTER_PRICE_DISTRIBUTION") &&
    candidate.lunaProductId && candidate.lunaVariantId && candidate.supplierSku)
  const eligibleCandidateIds = new Set(durableCandidates
    .filter((candidate) => candidate.readyForEconomics)
    .map((candidate) => candidate.candidateId))
  const variantIds = [...new Set(durableCandidates.flatMap((candidate) =>
    candidate.lunaVariantId ? [candidate.lunaVariantId] : []))]
  const queueRead = variantIds.length
    ? await input.supabase.from("ebay_luna_opportunity_queue")
      .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,gtin,assessment")
      .in("supplier_variant_id", variantIds).limit(1_000)
    : { data: [], error: null }
  const queueRows = rows(queueRead.data)
  const queueCreationFailures = new Map<string, string>()
  const queueCreationOutcomes = new Map<string, "CREATED" | "REUSED">()
  for (const candidate of durableCandidates) {
    const existingRows = queueRows.filter((row) =>
      exactQueueIdentity(candidate, row))
    if (existingRows.length > 1) {
      queueCreationFailures.set(candidate.candidateId,
        "RADAR_SMART_STOCKING_IDENTITY_AMBIGUOUS")
      continue
    }
    if (existingRows.length === 1) {
      try {
        const existing = existingRows[0]
        if (!radarShippingCandidateIdentity(candidate, existing)) {
          const hydrated = buildRadarSmartStockingQueueRowV1(candidate)
          const update = await input.supabase.from("ebay_luna_opportunity_queue")
            .update({
              product_title: hydrated.product_title,
              variant_title: hydrated.variant_title,
              gtin: hydrated.gtin,
              queue_status: hydrated.queue_status,
              decision: hydrated.decision,
              demand_score: hydrated.demand_score,
              economics_score: hydrated.economics_score,
              identity_score: hydrated.identity_score,
              supply_score: hydrated.supply_score,
              active_comparables: hydrated.active_comparables,
              median_total_buyer_price: hydrated.median_total_buyer_price,
              estimated_net_profit: hydrated.estimated_net_profit,
              supplier_price: hydrated.supplier_price,
              supplier_available: hydrated.supplier_available,
              supplier_inventory_quantity:
                hydrated.supplier_inventory_quantity,
              supplier_snapshot_at: hydrated.supplier_snapshot_at,
              keyword_structure: hydrated.keyword_structure,
              hard_gates: hydrated.hard_gates,
              evidence_guards: hydrated.evidence_guards,
              assessment: hydrated.assessment,
              last_scanned_at: hydrated.last_scanned_at,
              next_scan_at: hydrated.next_scan_at,
              updated_at: hydrated.updated_at,
            }).eq("id", existing.id)
            .eq("supplier_product_id", candidate.lunaProductId)
            .eq("supplier_variant_id", candidate.lunaVariantId)
            .eq("supplier_sku", candidate.supplierSku)
            .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,gtin,assessment")
            .single()
          if (update.error || !update.data ||
              !radarShippingCandidateIdentity(candidate, record(update.data))) {
            throw new Error("RADAR_SMART_STOCKING_DURABLE_WRITE_FAILED")
          }
          const index = queueRows.indexOf(existing)
          queueRows[index] = record(update.data)
        }
        queueCreationOutcomes.set(candidate.candidateId, "REUSED")
        continue
      } catch (error) {
        queueCreationFailures.set(candidate.candidateId, failureCode(error))
        continue
      }
    }
    try {
      const write = await input.supabase.from("ebay_luna_opportunity_queue")
        .upsert(buildRadarSmartStockingQueueRowV1(candidate), {
          onConflict: "candidate_key",
        }).select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,gtin,assessment")
        .single()
      if (write.error || !write.data ||
          !exactQueueIdentity(candidate, record(write.data))) {
        throw new Error("RADAR_SMART_STOCKING_DURABLE_WRITE_FAILED")
      }
      queueRows.push(record(write.data))
      queueCreationOutcomes.set(candidate.candidateId, "CREATED")
    } catch (error) {
      queueCreationFailures.set(candidate.candidateId, failureCode(error))
    }
  }
  const outcomes: JsonRecord[] = []
  const priceContinuationResults = new Map<string, Awaited<ReturnType<
    typeof continueRadarCandidatePriceDistributionV1>>>()
  const priceContinuationFailures = new Map<string, string>()
  const continuePriceDistribution = input.continuePriceDistribution ??
    continueRadarCandidatePriceDistributionV1
  for (const candidate of durableCandidates.filter((entry) =>
    entry.economicsNextEvidence === "BETTER_PRICE_DISTRIBUTION")) {
    const exactRows = queueRows.filter((row) => exactQueueIdentity(candidate, row))
    if (exactRows.length !== 1 || !candidate.lunaProductId ||
        !candidate.lunaVariantId || !candidate.supplierSku) {
      priceContinuationFailures.set(candidate.candidateId,
        exactRows.length > 1 ? "RADAR_SMART_STOCKING_IDENTITY_AMBIGUOUS"
          : "RADAR_SMART_STOCKING_CANDIDATE_NOT_DURABLE_YET")
      continue
    }
    try {
      const continued = await continuePriceDistribution({
        supabase: input.supabase,
        accountKey: input.accountKey,
        queueRow: exactRows[0],
        candidateId: candidate.candidateId,
        lunaProductId: candidate.lunaProductId,
        lunaVariantId: candidate.lunaVariantId,
        supplierSku: candidate.supplierSku,
      })
      priceContinuationResults.set(candidate.candidateId, continued)
      if (continued.continuation?.economicsReady === true) {
        eligibleCandidateIds.add(candidate.candidateId)
      }
    } catch (error) {
      priceContinuationFailures.set(candidate.candidateId, failureCode(error))
    }
  }

  for (const candidate of candidates) {
    if (!eligibleCandidateIds.has(candidate.candidateId)) {
      const priceContinuation = priceContinuationResults.get(candidate.candidateId)
      const priceFailure = priceContinuationFailures.get(candidate.candidateId)
      const reason = candidate.disposition === "REJECT"
        ? candidate.dispositionReason
        : !candidate.stockReady ? "CANONICAL_STOCK_NOT_READY"
          : priceContinuation?.continuation?.finalReason ?? priceFailure ??
            (!candidate.readyForEconomics ? "PARKED_ECONOMICS"
              : "DETERMINISTIC_FACTORY_INPUT_NOT_ELIGIBLE")
      const waitingForBrowser = durableCandidates.includes(candidate) &&
        candidate.economicsNextEvidence === "ACTUAL_LUNA_SHIPPING"
      const durableQueueRow = queueRows.find((row) =>
        exactQueueIdentity(candidate, row))
      outcomes.push({ candidateId: candidate.candidateId,
        familyId: candidate.familyId, familyName: candidate.familyName,
        lunaProductId: candidate.lunaProductId,
        lunaVariantId: candidate.lunaVariantId, supplierSku: candidate.supplierSku,
        status: priceFailure ? "EXCEPTION"
          : reason === "PARKED_ECONOMICS" ||
            reason === "NO_SUPPORTED_PRICE_MEETS_MARGIN_FLOOR"
            ? "PARKED_ECONOMICS" : "PARKED",
        reasonCode: waitingForBrowser
          ? "WAITING_BROWSER_WORKER" : reason,
        economicsNextEvidence: candidate.economicsNextEvidence,
        priceDistributionContinuation:
          priceContinuation?.continuation ?? null,
        shippingJobCreatedOrReused: waitingForBrowser && Boolean(durableQueueRow),
        shippingJobStatus: waitingForBrowser && durableQueueRow
          ? "WAITING_BROWSER_WORKER" : null,
        shippingJobIdentityMatch: waitingForBrowser && Boolean(durableQueueRow) &&
          radarShippingCandidateIdentity(candidate, durableQueueRow!),
        shippingOpportunityId: waitingForBrowser
          ? durableQueueRow?.id ?? null : null,
        queuePersistenceOutcome: queueCreationOutcomes.get(candidate.candidateId)
          ?? null,
        deterministicRejected: !waitingForBrowser && !priceContinuation,
        listingReady: false })
      continue
    }
    if (queueRead.error) {
      outcomes.push({ candidateId: candidate.candidateId,
        familyId: candidate.familyId, familyName: candidate.familyName,
        lunaProductId: candidate.lunaProductId,
        lunaVariantId: candidate.lunaVariantId, supplierSku: candidate.supplierSku,
        status: "EXCEPTION", reasonCode: "RADAR_SMART_STOCKING_QUEUE_READ_FAILED",
        listingReady: false })
      continue
    }
    const exactRows = queueRows.filter((row) => exactQueueIdentity(candidate, row))
    if (exactRows.length !== 1) {
      outcomes.push({ candidateId: candidate.candidateId,
        familyId: candidate.familyId, familyName: candidate.familyName,
        lunaProductId: candidate.lunaProductId,
        lunaVariantId: candidate.lunaVariantId, supplierSku: candidate.supplierSku,
        status: exactRows.length || queueCreationFailures.has(candidate.candidateId)
          ? "EXCEPTION" : "PARKED",
        reasonCode: queueCreationFailures.get(candidate.candidateId) ?? (exactRows.length
          ? "RADAR_SMART_STOCKING_IDENTITY_AMBIGUOUS"
          : "RADAR_SMART_STOCKING_CANDIDATE_NOT_DURABLE_YET"),
        listingReady: false })
      continue
    }
    const queueRow = exactRows[0]
    const embeddedId = embeddedDecisionPackageId(queueRow)
    try {
      const result = await materializeCandidate({
        supabase: input.supabase,
        accountKey: input.accountKey,
        opportunityId: String(queueRow.id),
        candidateKey: String(queueRow.candidate_key),
        decisionPackageId: embeddedId,
      })
      const packageSeed = record(result.packageSeed)
      const pricing = record(packageSeed.pricing)
      outcomes.push({ candidateId: candidate.candidateId,
        familyId: candidate.familyId, familyName: candidate.familyName,
        lunaProductId: candidate.lunaProductId,
        lunaVariantId: candidate.lunaVariantId, supplierSku: candidate.supplierSku,
        opportunityId: result.opportunityId, candidateKey: result.candidateKey,
        listingPackageId: result.listingPackageId,
        decisionPackageId: result.decisionPackageId ?? null,
        decisionPackageIdentityResolved:
          result.decisionPackageIdentityResolved === true,
        identityAmbiguityReason: result.identityAmbiguityReason ?? null,
        status: result.listingReady ? "LISTING_READY" : "PARKED",
        reasonCode: result.firstBlocker,
        listingReady: result.listingReady,
        packageCreated: result.packageCreated,
        stages: result.stageStatuses,
        dollarCheck: result.listingReady ? {
          title: packageSeed.title ?? null,
          categoryId: packageSeed.categoryId ?? null,
          imageUrls: Array.isArray(packageSeed.imageUrls)
            ? packageSeed.imageUrls : [],
          supplierCost: pricing.supplierCost ?? null,
          targetPrice: pricing.targetPrice ?? null,
        } : null })
    } catch (error) {
      outcomes.push({ candidateId: candidate.candidateId,
        familyId: candidate.familyId, familyName: candidate.familyName,
        lunaProductId: candidate.lunaProductId,
        lunaVariantId: candidate.lunaVariantId, supplierSku: candidate.supplierSku,
        opportunityId: queueRow.id, candidateKey: queueRow.candidate_key,
        status: "EXCEPTION", reasonCode: failureCode(error), listingReady: false })
    }
  }

  const ready = outcomes.filter((outcome) => outcome.status === "LISTING_READY")
  const topCandidate = candidates.filter((candidate) =>
    candidate.source === "RADAR_FAMILY_LUNA_SUPPLY_IDENTITY" &&
    candidate.stockReady).sort((left, right) =>
      Number(right.readyForEconomics) - Number(left.readyForEconomics) ||
      Number(right.familyAssignmentConfidence === "PROVEN") -
        Number(left.familyAssignmentConfidence === "PROVEN") ||
      String(left.supplierSku).localeCompare(String(right.supplierSku)))[0] ?? null
  const stageCount = (stage: string) => outcomes.filter((outcome) =>
    record(outcome.stages)[stage] === "READY").length
  return Object.freeze({
    contractVersion: "NIGHT_RADAR_TO_GENERAL_FACTORY_CONNECTION_V1" as const,
    authority: "SELLER_OS_DETERMINISTIC_FACTORY" as const,
    targetSpecificAllowlistUsed: false as const,
    familiesEvaluated: input.batch.seeds.length,
    lunaProductsEvaluated: candidates.length,
    freshFamiliesEvaluated: input.batch.freshFamiliesEvaluated,
    lunaProductsScanned: input.batch.lunaProductsScanned,
    familyToLunaCompatibleCount: input.batch.familyToLunaCompatibleCount,
    uniqueLunaCandidates: input.batch.uniqueLunaCandidates,
    ambiguousFamilyAssignments: input.batch.ambiguousFamilyAssignments,
    stockSafeCount: input.batch.stockSafeCount,
    economicsPreflightCount: input.batch.economicsPreflightCount,
    economicsReadyCount: stageCount("ECONOMICS_READY"),
    priceDistributionAcquired: [...priceContinuationResults.values()]
      .filter((entry) => entry.applicable === true).length,
    economicsReevaluated: [...priceContinuationResults.values()]
      .filter((entry) => entry.continuation?.economicsReevaluated === true).length,
    priceDistributionOutcomes: Object.freeze([...priceContinuationResults]
      .map(([candidateId, entry]) => Object.freeze({ candidateId,
        ...record(entry.continuation) }))),
    shippingJobsCreated: outcomes.filter((outcome) =>
      outcome.shippingJobCreatedOrReused === true &&
      outcome.queuePersistenceOutcome === "CREATED").length,
    shippingJobsReused: outcomes.filter((outcome) =>
      outcome.shippingJobCreatedOrReused === true &&
      outcome.queuePersistenceOutcome === "REUSED").length,
    waitingBrowserWorker: outcomes.filter((outcome) =>
      outcome.shippingJobStatus === "WAITING_BROWSER_WORKER").length,
    inputProducts: input.batch.inputProducts,
    uniqueInputProducts: input.batch.uniqueInputProducts,
    lunaMatchCount: input.batch.lunaMatchCount,
    lunaMatchRate: candidates.length > 0
      ? Math.round(input.batch.lunaMatchCount / candidates.length * 100_000) /
        1_000 : 0,
    duplicateCount: input.batch.duplicateCount,
    ambiguousCount: input.batch.ambiguousCount,
    differentVariantCount: input.batch.differentVariantCount,
    noLunaMatchCount: input.batch.noLunaMatchCount,
    familiesWithInput: input.batch.familiesWithInput,
    allFamiliesWithInputReceiveBoundedCoverage:
      input.batch.allFamiliesWithInputReceiveBoundedCoverage,
    deterministicallyRejected: outcomes.filter((outcome) =>
      outcome.deterministicRejected === true).length,
    factoryCandidatesCreated: outcomes.filter((outcome) =>
      outcome.packageCreated === true).length,
    factoryCandidatesReused: outcomes.filter((outcome) =>
      outcome.packageCreated === false).length,
    productTruthReady: stageCount("PRODUCT_TRUTH_READY"),
    demandReady: stageCount("DEMAND_READY"),
    economicsReady: stageCount("ECONOMICS_READY"),
    listingPackageReady: stageCount("LISTING_PACKAGE_READY"),
    listingReady: ready.length,
    parked: outcomes.filter((outcome) =>
      outcome.status === "PARKED" || outcome.status === "PARKED_ECONOMICS").length,
    exceptions: outcomes.filter((outcome) => outcome.status === "EXCEPTION").length,
    humanClicksRequired: 0 as const,
    elapsedMs: Date.now() - startedAt,
    topCandidate: topCandidate ? Object.freeze({
      candidateId: topCandidate.candidateId,
      familyId: topCandidate.familyId,
      familyName: topCandidate.familyName,
      lunaProductId: topCandidate.lunaProductId,
      lunaVariantId: topCandidate.lunaVariantId,
      supplierSku: topCandidate.supplierSku,
      familyAssignmentConfidence: topCandidate.familyAssignmentConfidence,
      demandEvidenceGrain: topCandidate.demandEvidenceGrain,
      exactProductDemandClaimed: topCandidate.exactProductDemandClaimed,
      profit: topCandidate.economicsProfit,
      margin: topCandidate.economicsMargin,
    }) : null,
    outcomes: Object.freeze(outcomes),
    dollarCheck: Object.freeze({ triggered: ready.length > 0,
      candidates: Object.freeze(ready) }),
    safety: Object.freeze({ marketplaceWrites: 0 as const,
      publishCalls: 0 as const, newEbayOffers: 0 as const,
      withdrawCalls: 0 as const }),
  })
}

export function buildRadarAutomaticPriceDistributionContinuationV1(
  input: Readonly<{
    familyId: string
    demandEvidenceDigest: string
    evidenceObservedAt: string
    priceDistributionSource: string
    priceEvidence: readonly Readonly<{
      evidenceId: string
      price: number
      currency: "USD"
    }>[]
    supplierCostUsd: number
    shippingUsd: number
  }>,
) {
  if (!FAMILY_ID.test(input.familyId) ||
      !SHA256.test(input.demandEvidenceDigest) ||
      !Number.isFinite(Date.parse(input.evidenceObservedAt)) ||
      input.priceEvidence.length < 4 || input.supplierCostUsd < 0 ||
      input.shippingUsd < 0 || input.priceEvidence.some((entry) =>
        !entry.evidenceId || entry.currency !== "USD" ||
        !Number.isFinite(entry.price) || entry.price <= 0)) {
    throw new Error("RADAR_PRICE_DISTRIBUTION_INPUT_UNPROVEN")
  }
  const representativeness = buildPriceRepresentativenessV2(
    input.priceEvidence.map((entry) => ({
      evidenceId: entry.evidenceId,
      itemId: null,
      title: null,
      price: entry.price,
      currency: entry.currency,
    })),
    "USD",
  )
  const band = representativeness.ROBUST_CORE_PRICE_BAND
  if (!band || band.currency !== "USD" || band.p25 === null ||
      band.median === null || band.p75 === null ||
      band.range.minimum === null || band.range.maximum === null) {
    throw new Error("RADAR_PRICE_DISTRIBUTION_ROBUST_BAND_UNPROVEN")
  }
  const quantiles = [
    ["P25", band.p25],
    ["MEDIAN", band.median],
    ["P75", band.p75],
  ] as const
  const seenPrices = new Set<number>()
  const scenarios = quantiles.flatMap(([quantile, rawPrice]) => {
    const price = round(rawPrice)
    if (seenPrices.has(price)) return []
    seenPrices.add(price)
    const result = calculateEbayUnitEconomics({
      salePrice: price,
      supplierCost: input.supplierCostUsd,
    }, { estimatedOutboundShipping: input.shippingUsd })
    if (!result.ready) {
      throw new Error("RADAR_PRICE_DISTRIBUTION_ECONOMICS_UNPROVEN")
    }
    return [Object.freeze({
      quantile,
      price,
      profit: result.estimatedNetProfit,
      marginPercent: result.estimatedNetMarginPercent,
      roiPercent: result.estimatedRoiPercent,
      estimatedEbayFees: result.estimatedEbayFees,
      returnsReserve: result.returnsReserve,
      promotedListingsReserve: result.promotedListingsReserve,
      passesMarginFloor: result.estimatedNetMarginPercent !== null &&
        result.estimatedNetMarginPercent >=
          DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.minimumNetMarginPercent,
      passesCanonicalEconomicsPolicy: result.passesProfitGate,
    })]
  })
  const selected = [...scenarios]
    .sort((left, right) => left.price - right.price)
    .find((scenario) => scenario.passesCanonicalEconomicsPolicy) ?? null
  const targetWithinSupportedDistribution = Boolean(selected &&
    selected.price >= band.range.minimum && selected.price <= band.range.maximum)
  const economicsReady = Boolean(selected && targetWithinSupportedDistribution)
  const evidenceIds = [...new Set(input.priceEvidence.map((entry) =>
    entry.evidenceId))].sort()
  const evidenceDigest = digest({
    familyId: input.familyId,
    demandEvidenceDigest: input.demandEvidenceDigest,
    evidenceIds,
    prices: [...input.priceEvidence].map((entry) => entry.price)
      .sort((left, right) => left - right),
  })
  return Object.freeze({
    contractVersion: "RADAR_AUTOMATIC_PRICE_DISTRIBUTION_CONTINUATION_V1" as const,
    demandEvidenceGrain: "FAMILY" as const,
    exactProductDemandClaimed: false as const,
    familyId: input.familyId,
    evidenceDigest,
    priceSampleCount: input.priceEvidence.length,
    priceDistributionSource: input.priceDistributionSource,
    priceMin: round(band.range.minimum),
    priceMedian: round(band.median),
    priceMax: round(band.range.maximum),
    outlierPolicy: "PRICE_REPRESENTATIVENESS_V2_IQR_1_5" as const,
    outlierCount: representativeness.PRICE_OUTLIER_COUNT,
    targetPriceLow: round(band.p25),
    targetPrice: selected?.price ?? null,
    targetPriceHigh: round(band.p75),
    targetPriceWithinSupportedDistribution: targetWithinSupportedDistribution,
    targetSelectionPolicy:
      "LOWEST_SUPPORTED_ROBUST_QUANTILE_PASSING_CANONICAL_ECONOMICS" as const,
    marginFloorPercent:
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.minimumNetMarginPercent,
    scenarios: Object.freeze(scenarios),
    targetEconomics: selected ? Object.freeze({
      profit: selected.profit,
      marginPercent: selected.marginPercent,
      roiPercent: selected.roiPercent,
      estimatedEbayFees: selected.estimatedEbayFees,
      returnsReserve: selected.returnsReserve,
      promotedListingsReserve: selected.promotedListingsReserve,
    }) : null,
    economicsReevaluated: true as const,
    economicsReady,
    marginFloorPass: selected?.passesMarginFloor === true,
    finalDisposition: economicsReady
      ? "ECONOMICS_READY" as const : "PARKED_ECONOMICS" as const,
    finalReason: economicsReady ? null
      : "NO_SUPPORTED_PRICE_MEETS_MARGIN_FLOOR" as const,
    evidenceObservedAt: normalizedInstant(input.evidenceObservedAt),
    marketplaceWrites: 0 as const,
  })
}

async function continueRadarCandidatePriceDistributionV1(input: Readonly<{
  supabase: DurableFactoryClientV1
  accountKey: string
  queueRow: JsonRecord
  candidateId: string
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
}>) {
  const radarIdentity = record(record(input.queueRow.assessment)
    .radarFactoryCandidateV1)
  const familyId = text(radarIdentity.familyId, 120)
  if (!familyId || !FAMILY_ID.test(familyId)) {
    throw new Error("RADAR_PRICE_DISTRIBUTION_FAMILY_IDENTITY_UNPROVEN")
  }
  const [frontierRead, radarRead] = await Promise.all([
    input.supabase.rpc("get_seller_os_latest_profitability_frontiers_v1", {
      p_account_key: input.accountKey,
      p_marketplace_id: "EBAY_US",
      p_family_ids: [familyId],
      p_limit: 100,
    }),
    input.supabase.rpc("get_seller_os_family_market_radar_v1", {
      p_family_id: familyId,
      p_limit: 1,
    }),
  ])
  if (frontierRead.error || radarRead.error) {
    throw new Error("RADAR_PRICE_DISTRIBUTION_AUTHORITY_READ_FAILED")
  }
  const exact = rows(record(frontierRead.data).frontiers).filter((outer) => {
    const frontier = record(outer.frontier)
    return frontier.familyId === familyId &&
      frontier.lunaProductId === input.lunaProductId &&
      frontier.lunaVariantId === input.lunaVariantId &&
      frontier.lunaSku === input.supplierSku
  })
  if (exact.length !== 1) {
    throw new Error("RADAR_PRICE_DISTRIBUTION_FRONTIER_IDENTITY_UNPROVEN")
  }
  const outer = exact[0]
  const current = record(outer.frontier)
  if (current.economicClassification !== "ECONOMICALLY_RECOVERABLE" ||
      current.nextBestEvidence !== "BETTER_PRICE_DISTRIBUTION") {
    return Object.freeze({ applicable: false as const, frontier: current,
      continuation: null })
  }
  if (current.shippingStatus !== "SHIPPING_DURABLY_PERSISTED") {
    throw new Error("RADAR_PRICE_DISTRIBUTION_SHIPPING_NOT_DURABLE")
  }
  const seeds = familySeeds(radarRead.data, undefined)
    .filter((seed) => seed.familyId === familyId)
  if (seeds.length !== 1) {
    throw new Error("RADAR_PRICE_DISTRIBUTION_FAMILY_EVIDENCE_UNPROVEN")
  }
  const seed = seeds[0]
  if (!seed.priceDistributionEvidence.length ||
      seed.demandEvidenceDigest !== outer.marketPriceEvidenceDigest) {
    throw new Error("RADAR_PRICE_DISTRIBUTION_LINEAGE_MISMATCH")
  }
  const evidenceIds = seed.priceDistributionEvidence.map((reference) =>
    reference.split(":", 2)[1])
  const observationRead = await input.supabase
    .from("marketplace_product_research_capture_observations")
    .select("id,marketplace,average_sold_price,evidence_reviewed,quality_status")
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US").eq("evidence_reviewed", true)
    .eq("quality_status", "VALID").in("id", evidenceIds)
    .limit(100)
  if (observationRead.error) {
    throw new Error("RADAR_PRICE_DISTRIBUTION_EVIDENCE_READ_FAILED")
  }
  const observations = rows(observationRead.data)
  const byId = new Map(observations.map((row) => [String(row.id), row]))
  if (byId.size !== evidenceIds.length) {
    throw new Error("RADAR_PRICE_DISTRIBUTION_EVIDENCE_INCOMPLETE")
  }
  const continuation = buildRadarAutomaticPriceDistributionContinuationV1({
    familyId,
    demandEvidenceDigest: seed.demandEvidenceDigest,
    evidenceObservedAt: seed.evidenceObservedAt,
    priceDistributionSource:
      "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE_FAMILY_DISTRIBUTION",
    priceEvidence: evidenceIds.map((id) => {
      const row = byId.get(id)
      const price = number(row?.average_sold_price)
      if (!row || row.marketplace !== "EBAY_US" ||
          row.evidence_reviewed !== true || row.quality_status !== "VALID" ||
          price === null || price <= 0) {
        throw new Error("RADAR_PRICE_DISTRIBUTION_EVIDENCE_INVALID")
      }
      return { evidenceId:
        `marketplace_product_research_capture_observations:${id}`,
      price, currency: "USD" as const }
    }),
    supplierCostUsd: number(current.lunaUnitCost) ?? -1,
    shippingUsd: number(current.shippingValue) ?? -1,
  })
  const evaluatedAt = new Date().toISOString()
  const existingBlockers = limitations(current.currentHardBlockers ??
    current.hardBlockers)
  const currentHardBlockers = continuation.economicsReady
    ? existingBlockers.filter((blocker) =>
      blocker !== "NO_SUPPORTED_PRICE_MEETS_MARGIN_FLOOR")
    : limitations([...existingBlockers,
      "NO_SUPPORTED_PRICE_MEETS_MARGIN_FLOOR"])
  const { frontierDigest: _previousDigest, ...currentWithoutDigest } = current
  const nextWithoutDigest = {
    ...currentWithoutDigest,
    currentHardBlockers,
    nextBestEvidence: "NONE",
    radarAutomaticPriceDistributionContinuationV1: continuation,
    evaluatedAt,
  }
  const nextFrontier = Object.freeze({ ...nextWithoutDigest,
    frontierDigest: digest(nextWithoutDigest) })
  const previousSourceUpdatedAt = iso(outer.sourceUpdatedAt)
  if (!previousSourceUpdatedAt) {
    throw new Error("RADAR_PRICE_DISTRIBUTION_SOURCE_TIME_UNPROVEN")
  }
  const sourceUpdatedAt = laterInstant(seed.sourceUpdatedAt,
    previousSourceUpdatedAt)
  const write = await input.supabase.rpc(
    "put_seller_os_profitability_frontier_v1", {
      p_account_key: input.accountKey,
      p_marketplace_id: "EBAY_US",
      p_opportunity_case_id: outer.opportunityCaseId ?? seed.opportunityCaseId,
      p_market_price_evidence_reference: outer.marketPriceEvidenceReference,
      p_market_price_evidence_digest: outer.marketPriceEvidenceDigest,
      p_ebay_fee_policy_reference: outer.ebayFeePolicyReference,
      p_economic_policy_reference: outer.economicPolicyReference,
      p_economic_policy_digest: outer.economicPolicyDigest,
      p_source_updated_at: sourceUpdatedAt,
      p_evidence_cutoff_at: evaluatedAt,
      p_frontier: nextFrontier,
    })
  if (write.error || !["CREATED", "IDEMPOTENT_SUCCESS"].includes(
    String(record(write.data).outcome ?? ""))) {
    throw new Error("RADAR_PRICE_DISTRIBUTION_DURABLE_WRITE_FAILED")
  }
  const readback = await input.supabase.rpc(
    "get_seller_os_latest_profitability_frontiers_v1", {
      p_account_key: input.accountKey,
      p_marketplace_id: "EBAY_US",
      p_family_ids: [familyId],
      p_limit: 100,
    })
  const matched = rows(record(readback.data).frontiers).some((candidate) => {
    const stored = record(candidate.frontier)
    return stored.frontierDigest === nextFrontier.frontierDigest &&
      stored.lunaProductId === input.lunaProductId &&
      stored.lunaVariantId === input.lunaVariantId &&
      stored.lunaSku === input.supplierSku
  })
  if (readback.error || !matched) {
    throw new Error("RADAR_PRICE_DISTRIBUTION_DURABLE_READBACK_FAILED")
  }
  return Object.freeze({ applicable: true as const,
    frontier: nextFrontier, continuation, durableReadback: true as const })
}

/**
 * Continues one exact Radar candidate after the existing Luna Shipping
 * capture contract has durably persisted and read back its quote. The durable
 * Smart Stocking row is the handoff authority; no background worker, retry or
 * second candidate model is introduced here.
 */
export async function resumeRadarFactoryCandidateAfterShippingV1(
  input: Readonly<{
    supabase: DurableFactoryClientV1
    accountKey: string
    candidateId: string
    lunaProductId: string
    lunaVariantId: string
    supplierSku: string
    materializeCandidate?: DurableFactoryMaterializerV1
    continuePriceDistribution?: typeof continueRadarCandidatePriceDistributionV1
  }>,
) {
  const queueRead = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("*").eq("supplier_product_id", input.lunaProductId)
    .eq("supplier_variant_id", input.lunaVariantId)
    .eq("supplier_sku", input.supplierSku).limit(2)
  if (queueRead.error) {
    throw new Error("RADAR_SHIPPING_CONTINUATION_QUEUE_READ_FAILED")
  }
  const exactRows = rows(queueRead.data)
  if (exactRows.length === 0) return Object.freeze({
    applicable: false as const,
    reasonCode: "RADAR_SHIPPING_CONTINUATION_NOT_APPLICABLE" as const,
    economicsResumed: false as const,
    marketplaceWrites: 0 as const,
  })
  if (exactRows.length !== 1) {
    throw new Error("RADAR_SHIPPING_CONTINUATION_IDENTITY_AMBIGUOUS")
  }
  const queueRow = exactRows[0]
  const durableIdentity = record(record(queueRow.assessment)
    .radarAutomaticLunaShippingContinuationV1)
  if (durableIdentity.candidateId !== input.candidateId ||
      durableIdentity.lunaProductId !== input.lunaProductId ||
      durableIdentity.lunaVariantId !== input.lunaVariantId ||
      durableIdentity.supplierSku !== input.supplierSku) {
    throw new Error("RADAR_SHIPPING_CONTINUATION_IDENTITY_MISMATCH")
  }
  const priceContinuation = await (input.continuePriceDistribution ??
    continueRadarCandidatePriceDistributionV1)({
    supabase: input.supabase,
    accountKey: input.accountKey,
    queueRow,
    candidateId: input.candidateId,
    lunaProductId: input.lunaProductId,
    lunaVariantId: input.lunaVariantId,
    supplierSku: input.supplierSku,
  })
  const materializeCandidate = input.materializeCandidate ??
    materializeSellerOsDeterministicFactoryCandidateV1
  const result = await materializeCandidate({
    supabase: input.supabase,
    accountKey: input.accountKey,
    opportunityId: String(queueRow.id),
    candidateKey: String(queueRow.candidate_key),
    decisionPackageId: embeddedDecisionPackageId(queueRow),
  })
  const stages = record(result.stageStatuses)
  const economicsReady = stages.ECONOMICS_READY === "READY"
  const continuation = Object.freeze({
    contractVersion: "RADAR_AUTOMATIC_LUNA_SHIPPING_CONTINUATION_V1" as const,
    candidateId: input.candidateId,
    lunaProductId: input.lunaProductId,
    lunaVariantId: input.lunaVariantId,
    supplierSku: input.supplierSku,
    shippingJobStatus: "SHIPPING_EVIDENCE_DURABLE" as const,
    economicsResumed: true as const,
    economicsReady,
    parkedEconomics: !economicsReady,
    listingPackageReady: stages.LISTING_PACKAGE_READY === "READY",
    listingReady: result.listingReady === true,
    firstBlocker: result.firstBlocker ?? null,
    priceDistributionAcquired: priceContinuation.applicable === true,
    priceDistributionContinuation:
      priceContinuation.continuation ?? null,
    canonicalDestinationBindingRequired: true as const,
    purchaseBoundaryEnforced: true as const,
    rawAddressPersisted: false as const,
    marketplaceWrites: 0 as const,
  })
  const assessment = {
    ...record(queueRow.assessment),
    sellerOsDeterministicFactory: result.factoryPreparationAuthority,
    ...(result.smartStockingListingIntakeV1
      ? { smartStockingListingIntakeV1: result.smartStockingListingIntakeV1 }
      : {}),
    radarAutomaticLunaShippingContinuationV1: continuation,
  }
  const write = await input.supabase.from("ebay_luna_opportunity_queue")
    .update({ assessment, decision: result.listingReady
      ? "LISTING_READY" : economicsReady ? "FACTORY_PREPARED" : "PARKED_ECONOMICS",
    updated_at: new Date().toISOString() })
    .eq("id", queueRow.id).eq("candidate_key", queueRow.candidate_key)
    .select("id,candidate_key,assessment").single()
  const stored = record(record(write.data).assessment)
  const readback = record(stored.radarAutomaticLunaShippingContinuationV1)
  if (write.error || !write.data || readback.candidateId !== input.candidateId ||
      readback.shippingJobStatus !== "SHIPPING_EVIDENCE_DURABLE" ||
      readback.economicsResumed !== true) {
    throw new Error("RADAR_SHIPPING_CONTINUATION_DURABLE_WRITE_FAILED")
  }
  return Object.freeze({ applicable: true as const, ...continuation,
    opportunityId: String(queueRow.id),
    listingPackageId: result.listingPackageId,
    durableReadback: true as const,
    dollarCheck: Object.freeze({ triggered: result.listingReady === true }),
  })
}
