import { createHash } from "node:crypto"

export const OPPORTUNITY_RADAR_REVENUE_FACTORY_ADAPTER_VERSION =
  "OPPORTUNITY_RADAR_REVENUE_FACTORY_ADAPTER_V1" as const

const FAMILY_ID = /^market-family-v1:sha256:[0-9a-f]{64}$/
const OPPORTUNITY_CASE_ID = /^opportunity-case-v1:sha256:[0-9a-f]{64}$/
const SHA256 = /^sha256:[0-9a-f]{64}$/
const MAXIMUM_FAMILIES = 20
const MAXIMUM_CANDIDATES = 100

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
  familyDemandStatus: "FAMILY_DEMAND_PROVEN"
  soldComparableCount: number
  soldQuantityEvidence: number
  priceBand: Readonly<{
    currency: string | null
    minimum: number | null
    maximum: number | null
    median: number | null
  }>
  evidenceObservedAt: string
  sourceUpdatedAt: string
  limitations: readonly string[]
  evidenceScope: "FAMILY_DISCOVERY_SEED_ONLY"
  exactProductDemandClaimed: false
}>

export type RadarRevenueFactoryCandidateV1 = Readonly<{
  candidateId: string
  familyId: string
  familyName: string
  source: "RADAR_FRONTIER_LUNA_IDENTITY" | "PRODUCT_RESEARCH_EXACT_IDENTITY"
  disposition: "PASS_TO_LUNA" | "REJECT"
  dispositionReason: string
  exactCandidateIdentity: boolean
  lunaMatch: boolean
  stockReady: boolean
  readyForEconomics: boolean
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
    if (!familyId || !FAMILY_ID.test(familyId) || !familyName ||
        !opportunityCaseId || !OPPORTUNITY_CASE_ID.test(opportunityCaseId) ||
        !demandEvidenceDigest || !SHA256.test(demandEvidenceDigest) ||
        observation.familyDemandStatus !== "FAMILY_DEMAND_PROVEN" ||
        soldComparableCount === null || soldQuantityEvidence === null ||
        !evidenceObservedAt || !sourceUpdatedAt ||
        allowed && !allowed.has(familyName.normalize("NFKC").toLowerCase())) return []
    return [Object.freeze({
      familyId, familyName, opportunityCaseId, demandEvidenceDigest,
      familyDemandStatus: "FAMILY_DEMAND_PROVEN" as const,
      soldComparableCount, soldQuantityEvidence,
      priceBand: Object.freeze({
        currency: text(observation.priceCurrency, 12),
        minimum: number(observation.priceBandMinimum),
        maximum: number(observation.priceBandMaximum),
        median: number(observation.priceMedian),
      }),
      evidenceObservedAt, sourceUpdatedAt,
      limitations: limitations(observation.limitations),
      evidenceScope: "FAMILY_DISCOVERY_SEED_ONLY" as const,
      exactProductDemandClaimed: false as const,
    })]
  })
}

function catalogKey(productId: string, variantId: string, sku: string) {
  return `${productId}\n${variantId}\n${sku}`
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
  const seenResearchIdentities = new Set<string>()
  const frontierRoot = record(input.frontierPayload)
  for (const outer of rows(frontierRoot.frontiers)) {
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
    const economics = text(frontier.economicClassification, 80)
    candidates.push(Object.freeze({
      candidateId: digest({ familyId: seed.familyId, productId, variantId, sku }),
      familyId: seed.familyId, familyName: seed.familyName,
      source: "RADAR_FRONTIER_LUNA_IDENTITY" as const,
      disposition: "PASS_TO_LUNA" as const,
      dispositionReason: "EXACT_LUNA_PRODUCT_VARIANT_IDENTITY_ALREADY_PROVEN",
      exactCandidateIdentity: true, lunaMatch: true, stockReady: available,
      readyForEconomics: economics !== null && economics !== "ECONOMICS_UNPROVEN",
      marketRadarProductId: text(row.product_id),
      lunaProductId: productId, lunaVariantId: variantId, supplierSku: sku,
      productResearchIdentityHash: null, lineage: seed,
    }))
  }
  for (const observation of rows(input.productResearchRows ?? [])) {
    if (candidates.length >= maximum) break
    const familyId = text(observation.radar_family_id, 120)
    const seed = familyId ? seedById.get(familyId) : null
    const identityHash = text(observation.identity_hash, 80)
    if (!seed || !identityHash || !SHA256.test(identityHash)) continue
    const observationId = text(observation.id, 80)
    const key = `${seed.familyId}\n${observationId ?? identityHash}`
    if (seen.has(key)) continue
    seen.add(key)
    const identityKey = `${seed.familyId}\n${identityHash}`
    const duplicateIdentity = seenResearchIdentities.has(identityKey)
    seenResearchIdentities.add(identityKey)
    const matchClass = text(observation.match_classification, 80)
    const matchedVariantId = text(observation.matched_supplier_variant_id)
    const exact = !duplicateIdentity && matchClass === "EXACT_LUNA_MATCH" &&
      Boolean(matchedVariantId)
    candidates.push(Object.freeze({
      candidateId: digest({ familyId: seed.familyId, identityHash }),
      familyId: seed.familyId, familyName: seed.familyName,
      source: "PRODUCT_RESEARCH_EXACT_IDENTITY" as const,
      disposition: exact ? "PASS_TO_LUNA" as const : "REJECT" as const,
      dispositionReason: exact
        ? "PRODUCT_RESEARCH_EXACT_LUNA_MATCH"
        : duplicateIdentity
          ? "DUPLICATE_PRODUCT_IDENTITY_WITHIN_FAMILY"
        : `FAMILY_SEED_ONLY_${matchClass ?? "EXACT_PRODUCT_IDENTITY_UNPROVEN"}`,
      exactCandidateIdentity: true, lunaMatch: exact, stockReady: false,
      readyForEconomics: false, marketRadarProductId: null,
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
    rejectedCount: bounded.filter((candidate) => candidate.disposition === "REJECT").length,
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
      .select("product_id,supplier_product_id,supplier_variant_id,sku,title,variant_title,price,available,inventory_quantity,product_url,captured_at")
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
        .order("last_sold_date", { ascending: false }).limit(200)
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
