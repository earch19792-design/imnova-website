import { createHash } from "node:crypto"

import { materializeSellerOsDeterministicFactoryCandidateV1 } from
  "./ebay-smart-stocking-durable-factory-v1"

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
  evidenceObservedAt: string
  sourceUpdatedAt: string
  maximumAgeSeconds: number
  fresh: true
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
    const maximumAgeSeconds = nonnegativeInteger(observation.maximumAgeSeconds)
    const familyDemandStatus = observation.familyDemandStatus
    if (!familyId || !FAMILY_ID.test(familyId) || !familyName ||
        !opportunityCaseId || !OPPORTUNITY_CASE_ID.test(opportunityCaseId) ||
        !demandEvidenceDigest || !SHA256.test(demandEvidenceDigest) ||
        !["FAMILY_DEMAND_PROVEN", "FAMILY_DEMAND_SUPPORTED"].includes(
          String(familyDemandStatus ?? "")) || observation.fresh !== true ||
        soldComparableCount === null || soldQuantityEvidence === null ||
        !evidenceObservedAt || !sourceUpdatedAt || maximumAgeSeconds === null ||
        maximumAgeSeconds < 1 ||
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
      evidenceObservedAt, sourceUpdatedAt, maximumAgeSeconds, fresh: true as const,
      limitations: limitations(observation.limitations),
      evidenceScope: "FAMILY_DISCOVERY_SEED_ONLY" as const,
      exactProductDemandClaimed: false as const,
    })]
  })
}

function catalogKey(productId: string, variantId: string, sku: string) {
  return `${productId}\n${variantId}\n${sku}`
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
    const hardBlockers = Array.isArray(frontier.hardBlockers)
      ? frontier.hardBlockers : []
    const economicsReady = economics === "ECONOMICALLY_PROMISING" &&
      frontier.shippingStatus === "SHIPPING_DURABLY_PERSISTED" &&
      frontier.nextBestEvidence === "NONE" &&
      (number(frontier.contributionProfitAtMarketMedian) ?? 0) > 0 &&
      (number(frontier.contributionMarginAtMarketMedian) ?? 0) > 0 &&
      hardBlockers.length === 0
    candidates.push(Object.freeze({
      candidateId: digest({ familyId: seed.familyId, productId, variantId, sku }),
      familyId: seed.familyId, familyName: seed.familyName,
      source: "RADAR_FRONTIER_LUNA_IDENTITY" as const,
      disposition: "PASS_TO_LUNA" as const,
      dispositionReason: "EXACT_LUNA_PRODUCT_VARIANT_IDENTITY_ALREADY_PROVEN",
      exactCandidateIdentity: true, lunaMatch: true, stockReady: available,
      readyForEconomics: economicsReady,
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

function exactDecisionPackageIdentity(queueRow: JsonRecord, value: unknown) {
  const row = record(value)
  const payload = record(row.package_payload)
  const identity = record(record(payload.productIdentity).identity)
  return row.status === "GENERATED" &&
    payload.supplierSku === queueRow.supplier_sku &&
    payload.supplierVariantId === queueRow.supplier_variant_id &&
    identity.gtin === queueRow.gtin
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
  }>,
) {
  const startedAt = Date.now()
  const materializeCandidate = input.materializeCandidate ??
    materializeSellerOsDeterministicFactoryCandidateV1
  const candidates = [...input.batch.candidates]
  const eligible = candidates.filter((candidate) =>
    candidate.disposition === "PASS_TO_LUNA" &&
    candidate.exactCandidateIdentity && candidate.lunaMatch &&
    candidate.stockReady && candidate.readyForEconomics &&
    candidate.lunaProductId && candidate.lunaVariantId && candidate.supplierSku)
  const variantIds = [...new Set(eligible.flatMap((candidate) =>
    candidate.lunaVariantId ? [candidate.lunaVariantId] : []))]
  const queueRead = variantIds.length
    ? await input.supabase.from("ebay_luna_opportunity_queue")
      .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,gtin,assessment")
      .in("supplier_variant_id", variantIds).limit(1_000)
    : { data: [], error: null }
  const queueRows = rows(queueRead.data)
  const decisionRead = queueRows.length
    ? await input.supabase.from("marketplace_listing_decision_packages")
      .select("id,status,package_payload")
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", "EBAY_US").eq("status", "GENERATED")
      .order("created_at", { ascending: false }).limit(500)
    : { data: [], error: null }
  const decisionPackages = rows(decisionRead.data)
  const outcomes: JsonRecord[] = []

  for (const candidate of candidates) {
    if (!eligible.includes(candidate)) {
      const reason = candidate.disposition === "REJECT"
        ? candidate.dispositionReason
        : !candidate.stockReady ? "CANONICAL_STOCK_NOT_READY"
          : !candidate.readyForEconomics ? "ECONOMICS_NOT_READY"
            : "DETERMINISTIC_FACTORY_INPUT_NOT_ELIGIBLE"
      outcomes.push({ candidateId: candidate.candidateId,
        familyId: candidate.familyId, familyName: candidate.familyName,
        lunaProductId: candidate.lunaProductId,
        lunaVariantId: candidate.lunaVariantId, supplierSku: candidate.supplierSku,
        status: "PARKED", reasonCode: reason, deterministicRejected: true,
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
        status: exactRows.length ? "EXCEPTION" : "PARKED",
        reasonCode: exactRows.length
          ? "RADAR_SMART_STOCKING_IDENTITY_AMBIGUOUS"
          : "RADAR_SMART_STOCKING_CANDIDATE_NOT_DURABLE_YET",
        listingReady: false })
      continue
    }
    const queueRow = exactRows[0]
    if (decisionRead.error) {
      outcomes.push({ candidateId: candidate.candidateId,
        familyId: candidate.familyId, familyName: candidate.familyName,
        lunaProductId: candidate.lunaProductId,
        lunaVariantId: candidate.lunaVariantId, supplierSku: candidate.supplierSku,
        opportunityId: queueRow.id, candidateKey: queueRow.candidate_key,
        status: "EXCEPTION", reasonCode: "RADAR_DECISION_PACKAGE_READ_FAILED",
        listingReady: false })
      continue
    }
    const exactPackages = decisionPackages.filter(
      (entry) => exactDecisionPackageIdentity(queueRow, entry))
    const embeddedId = embeddedDecisionPackageId(queueRow)
    const decisionPackageId = embeddedId ??
      (exactPackages.length === 1 ? uuid(exactPackages[0].id) : null)
    if (exactPackages.length > 1 && !embeddedId) {
      outcomes.push({ candidateId: candidate.candidateId,
        familyId: candidate.familyId, familyName: candidate.familyName,
        lunaProductId: candidate.lunaProductId,
        lunaVariantId: candidate.lunaVariantId, supplierSku: candidate.supplierSku,
        opportunityId: queueRow.id, candidateKey: queueRow.candidate_key,
        status: "PARKED", reasonCode: "DECISION_PACKAGE_IDENTITY_AMBIGUOUS",
        listingReady: false })
      continue
    }
    try {
      const result = await materializeCandidate({
        supabase: input.supabase,
        accountKey: input.accountKey,
        opportunityId: String(queueRow.id),
        candidateKey: String(queueRow.candidate_key),
        decisionPackageId,
      })
      const packageSeed = record(result.packageSeed)
      const pricing = record(packageSeed.pricing)
      outcomes.push({ candidateId: candidate.candidateId,
        familyId: candidate.familyId, familyName: candidate.familyName,
        lunaProductId: candidate.lunaProductId,
        lunaVariantId: candidate.lunaVariantId, supplierSku: candidate.supplierSku,
        opportunityId: result.opportunityId, candidateKey: result.candidateKey,
        listingPackageId: result.listingPackageId,
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
  const stageCount = (stage: string) => outcomes.filter((outcome) =>
    record(outcome.stages)[stage] === "READY").length
  return Object.freeze({
    contractVersion: "NIGHT_RADAR_TO_GENERAL_FACTORY_CONNECTION_V1" as const,
    authority: "SELLER_OS_DETERMINISTIC_FACTORY" as const,
    targetSpecificAllowlistUsed: false as const,
    familiesEvaluated: input.batch.seeds.length,
    lunaProductsEvaluated: candidates.length,
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
    parked: outcomes.filter((outcome) => outcome.status === "PARKED").length,
    exceptions: outcomes.filter((outcome) => outcome.status === "EXCEPTION").length,
    humanClicksRequired: 0 as const,
    elapsedMs: Date.now() - startedAt,
    outcomes: Object.freeze(outcomes),
    dollarCheck: Object.freeze({ triggered: ready.length > 0,
      candidates: Object.freeze(ready) }),
    safety: Object.freeze({ marketplaceWrites: 0 as const,
      publishCalls: 0 as const, newEbayOffers: 0 as const,
      withdrawCalls: 0 as const }),
  })
}
