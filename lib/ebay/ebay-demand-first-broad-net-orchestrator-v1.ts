import { createHash } from "node:crypto"

import {
  buildMarketOpportunityResearchV1,
  normalizeMarketResearchRequestV1,
  type MarketEvidenceV1,
} from "./ebay-market-opportunity-research-v1"
import {
  buildSellerOsFamilyMarketObservationV1,
  buildSellerOsMarketFamilyIdV1,
  buildSellerOsOpportunityMonitorEnrollmentV1,
  normalizeSellerOsDemandKeywordDnaV1,
  SELLER_OS_DEMAND_KEYWORD_DNA_VERSION,
  type SellerOsDemandKeywordDnaV1,
  type SellerOsMarketFamilyDefinitionV1,
  type SellerOsMarketFamilyIdentityV1,
} from "./ebay-prelinked-family-market-observation-v1"
import { buildSellerOsTargetProductProfileWithAuthorityV1 } from
  "./ebay-prelinked-target-product-profile-and-luna-fit-v1"
import type { SellerOsDailyDollarRadarAutopilotFamilyInputV1 } from
  "./ebay-daily-dollar-radar-autopilot-v1"
import { collectRadarRevenueFactoryCandidateBatchV1 } from
  "./ebay-opportunity-radar-revenue-factory-adapter-v1"

export const SELLER_OS_DEMAND_FIRST_BROAD_NET_ORCHESTRATOR_VERSION =
  "SELLER_OS_DEMAND_FIRST_BROAD_NET_ORCHESTRATOR_V1" as const
export const SELLER_OS_DEMAND_FIRST_BROAD_NET_LIMITS_V1 = Object.freeze({
  queryTasks: 20,
  observations: 100,
  familyCandidates: 10,
  persistedFamiliesPerManualCanary: 1,
} as const)

const MAXIMUM_AGE_SECONDS = 30 * 24 * 60 * 60
const SOURCE_ADAPTER = "SELLER_OS_PRODUCT_RESEARCH_FAMILY_ADAPTER_V1"
const SOURCE_CONTRACT = "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE"
const MOMENTUM_POLICY = "SELLER_OS_FAMILY_MARKET_MOMENTUM_POLICY_V1"
const MONITOR_POLICY = "SELLER_OS_DEMAND_FIRST_MONITOR_POLICY_V1"

type JsonRecord = Record<string, unknown>
type ReadWriteClient = Readonly<{
  rpc: (name: string, parameters?: JsonRecord) => PromiseLike<{
    data: unknown
    error: unknown
  }>
  from: (table: string) => any
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

function integer(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function money(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round((parsed + Number.EPSILON) * 100) / 100 : null
}

function instant(value: unknown) {
  const candidate = text(value, 48)
  return candidate && Number.isFinite(Date.parse(candidate))
    ? new Date(candidate).toISOString() : null
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right, "en-US"))
      .map(([key, entry]) => [key, canonical(entry)]))
  }
  return value
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical(value))).digest("hex")}`
}

function unique(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) =>
    Buffer.compare(Buffer.from(left), Buffer.from(right)))
}

function demandTokens(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9+.-]+/g, " ").trim().split(/\s+/)
    .filter(Boolean).slice(0, 30)
}

type DemandKeywordFamilyInputV1 = Readonly<{
  canonicalPhrase: string
  familyType: SellerOsDemandKeywordDnaV1["soldWeightedTerms"][number]["familyType"]
  soldListingsObserved: number | null
  soldQuantityObserved: number | null
  qualityScore: number
  evidenceStatus: "SOLD_EVIDENCE_AVAILABLE" |
    "ACTIVE_LISTING_EVIDENCE_ONLY" | "UNPROVEN"
  soldEvidenceReferences: readonly string[]
}>

export function buildSellerOsDemandKeywordDnaV1(input: Readonly<{
  keywordFamilies: readonly DemandKeywordFamilyInputV1[]
  soldTitles: readonly Readonly<{
    title: string
    soldQuantityObserved: number
    evidenceReference: string
  }>[]
  familyDemandStatus: "FAMILY_DEMAND_PROVEN" | "FAMILY_DEMAND_SUPPORTED"
  evidenceObservedAt: string
  maximumAgeSeconds: number
}>) : SellerOsDemandKeywordDnaV1 {
  const soldWeighted = input.keywordFamilies.flatMap((family) => {
    const term = text(family.canonicalPhrase, 120)?.toLocaleLowerCase("en-US")
    const references = unique(family.soldEvidenceReferences.flatMap((reference) => {
      const value = text(reference, 240)
      return value ? [value] : []
    }))
    return family.evidenceStatus === "SOLD_EVIDENCE_AVAILABLE" && term &&
      Number.isInteger(family.soldListingsObserved) &&
      Number(family.soldListingsObserved) > 0 &&
      Number.isInteger(family.soldQuantityObserved) &&
      Number(family.soldQuantityObserved) > 0 && references.length ? [{
        term, familyType: family.familyType,
        soldListingsObserved: Number(family.soldListingsObserved),
        soldQuantityObserved: Number(family.soldQuantityObserved),
        qualityScore: Number.isFinite(family.qualityScore) ? family.qualityScore : 0,
        evidenceReferences: references,
      }] : []
  }).sort((left, right) =>
    right.soldQuantityObserved - left.soldQuantityObserved ||
    right.soldListingsObserved - left.soldListingsObserved ||
    right.qualityScore - left.qualityScore ||
    demandTokens(right.term).length - demandTokens(left.term).length ||
    Buffer.compare(Buffer.from(left.term), Buffer.from(right.term)))
    .filter((entry, index, values) => values.findIndex((candidate) =>
      candidate.term === entry.term) === index).slice(0, 30)
  if (!soldWeighted.length) throw new Error("DEMAND_KEYWORD_DNA_SOLD_EVIDENCE_REQUIRED")
  const soldWeightedTerms = soldWeighted.map((entry, index) => Object.freeze({
    term: entry.term, familyType: entry.familyType,
    soldListingsObserved: entry.soldListingsObserved,
    soldQuantityObserved: entry.soldQuantityObserved,
    weightRank: index + 1, evidenceReferences: Object.freeze(entry.evidenceReferences),
  }))
  const soldTerm = (familyTypes: readonly string[]) => unique(soldWeightedTerms
    .filter((entry) => familyTypes.includes(entry.familyType)).map((entry) => entry.term))
  const compatibility = unique(soldWeightedTerms.filter((entry) =>
    demandTokens(entry.term).some((token) => ["compatible", "compatibility",
      "replacement", "fits", "fit", "works"].includes(token)))
    .map((entry) => entry.term))
  const titleGroups = new Map<string, { tokens: string[]; quantity: number;
    references: string[] }>()
  for (const soldTitle of input.soldTitles) {
    const tokens = demandTokens(soldTitle.title)
    const reference = text(soldTitle.evidenceReference, 240)
    if (!tokens.length || !reference || !Number.isInteger(soldTitle.soldQuantityObserved) ||
        soldTitle.soldQuantityObserved <= 0) continue
    const key = tokens.join(" ")
    const current = titleGroups.get(key) ?? { tokens, quantity: 0, references: [] }
    current.quantity += soldTitle.soldQuantityObserved
    current.references.push(reference)
    titleGroups.set(key, current)
  }
  const titleTokenStructure = [...titleGroups.values()].sort((left, right) =>
    right.quantity - left.quantity ||
    Buffer.compare(Buffer.from(left.tokens.join(" ")),
      Buffer.from(right.tokens.join(" ")))).slice(0, 20).map((entry) =>
    Object.freeze({ tokens: Object.freeze(entry.tokens),
      soldQuantityObserved: entry.quantity,
      evidenceReferences: Object.freeze(unique(entry.references)) }))
  if (!titleTokenStructure.length) {
    throw new Error("DEMAND_KEYWORD_DNA_TITLE_STRUCTURE_REQUIRED")
  }
  const keywordEvidenceReferences = unique(soldWeightedTerms.flatMap((entry) =>
    [...entry.evidenceReferences]))
  const base = Object.freeze({
    contractVersion: SELLER_OS_DEMAND_KEYWORD_DNA_VERSION,
    primaryDemandKeyword: soldWeightedTerms[0].term,
    soldWeightedTerms: Object.freeze(soldWeightedTerms),
    highIntentModifiers: Object.freeze(soldTerm(["USE_CASE", "BENEFIT"])),
    attributeTerms: Object.freeze(soldTerm(["ATTRIBUTE", "PACK_FORMAT", "AUDIENCE"])),
    useCaseTerms: Object.freeze(soldTerm(["USE_CASE"])),
    compatibilityTerms: Object.freeze(compatibility),
    titleTokenStructure: Object.freeze(titleTokenStructure),
    keywordDemandConfidence: Object.freeze({ scope: "FAMILY_LEVEL" as const,
      status: input.familyDemandStatus === "FAMILY_DEMAND_PROVEN"
        ? "PROVEN" as const : "SUPPORTED" as const,
      exactProductDemandClaimed: false as const }),
    keywordEvidenceClass: "OFFICIAL_SOLD_EVIDENCE" as const,
    keywordEvidenceReferences: Object.freeze(keywordEvidenceReferences),
    keywordEvidenceObservedAt: new Date(input.evidenceObservedAt).toISOString(),
    keywordEvidenceFreshness: Object.freeze({ statusAtObservation: "FRESH" as const,
      maximumAgeSeconds: input.maximumAgeSeconds }),
  })
  return normalizeSellerOsDemandKeywordDnaV1(Object.freeze({ ...base,
    keywordEvidenceDigest: digest(base),
  }))
}

function normalizedIdentity(row: JsonRecord) {
  return record(row.normalized_identity ?? row.normalizedIdentity)
}

function identityText(identity: JsonRecord, camel: string, alternate?: string) {
  return text(identity[camel] ?? (alternate ? identity[alternate] : null), 160)
}

function dateRange(batch: JsonRecord) {
  const range = record(batch.date_range ?? batch.dateRange)
  const parse = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return new Date(value).toISOString()
    }
    return instant(value)
  }
  return { startAt: parse(range.start), endAt: parse(range.end) }
}

function median(values: readonly number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const value = sorted.length % 2
    ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function evidenceFromObservation(task: JsonRecord, batch: JsonRecord,
  observation: JsonRecord): MarketEvidenceV1 | null {
  const id = text(observation.id, 80)
  const query = text(task.search_query, 100)
  const observedAt = instant(observation.last_sold_date) ??
    instant(batch.captured_at)
  const quantity = integer(observation.confirmed_sold_quantity)
  const identity = normalizedIdentity(observation)
  const productName = identityText(identity, "normalizedProductName",
    "productName")
  if (!id || !query || !observedAt || !productName || !quantity ||
      observation.evidence_reviewed !== true ||
      observation.quality_status !== "VALID") return null
  return {
    evidenceId: `marketplace_product_research_capture_observations:${id}`,
    itemId: null,
    title: productName,
    categoryId: text(task.category_id, 40), categoryName: null,
    brand: identityText(identity, "manufacturerBrand", "brand"),
    gtin: identityText(identity, "gtin"),
    mpn: identityText(identity, "mpn"), model: identityText(identity, "model"),
    packCount: integer(identity.packCount ?? observation.detected_offer_pack_count),
    size: identityText(identity, "size") ?? text(observation.detected_size, 80),
    color: identityText(identity, "color"),
    condition: identityText(identity, "condition"),
    price: money(observation.average_sold_price), currency: "USD",
    shippingCost: money(observation.average_shipping), imageUrl: null,
    itemSpecifics: {},
    keywordSignals: (Array.isArray(observation.keyword_signals)
      ? observation.keyword_signals : []).flatMap((entry) => {
        const value = text(entry, 120)
        return value ? [value] : []
      }),
    activeListing: false, confirmedSold: true,
    confirmedSoldQuantity: quantity, saleObservedAt: observedAt, observedAt,
    source: "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE",
    sourceVersion: SOURCE_CONTRACT,
    evidenceCompleteness: Object.keys(identity).length >= 2 ? "COMPLETE" : "PARTIAL",
    sellerReferenceHash: text(observation.seller_reference_fingerprint, 120),
  }
}

export type SellerOsDemandFirstFamilyCandidateV1 = Readonly<{
  status: "QUALIFIED" | "DUPLICATE" | "UNQUALIFIED"
  reason: string
  familyDefinition: SellerOsMarketFamilyDefinitionV1 | null
  observation: ReturnType<typeof buildSellerOsFamilyMarketObservationV1> | null
  taskId: string | null
  batchId: string | null
}>

export function buildSellerOsDemandFirstFamilyCandidatesV1(input: Readonly<{
  tasks: readonly unknown[]
  batches: readonly unknown[]
  observations: readonly unknown[]
  existingCases: readonly unknown[]
}>) {
  const batchesById = new Map(rows(input.batches).flatMap((batch) => {
    const id = text(batch.id, 80)
    return id ? [[id, batch] as const] : []
  }))
  const observationsByBatch = new Map<string, JsonRecord[]>()
  for (const observation of rows(input.observations)) {
    const batchId = text(observation.capture_batch_id, 80)
    if (!batchId) continue
    observationsByBatch.set(batchId,
      [...(observationsByBatch.get(batchId) ?? []), observation])
  }
  const exactExisting = new Set(rows(input.existingCases)
    .flatMap((row) => text(row.family_id, 120) ? [text(row.family_id, 120) as string] : []))
  const semanticExisting = new Set(rows(input.existingCases).flatMap((row) => {
    const identity = record(row.family_identity)
    const productFunction = text(identity.productFunction, 120)?.toLowerCase()
    const category = text(identity.category, 120)?.toLowerCase()
    return productFunction && category ? [`${category}\n${productFunction}`] : []
  }))
  const emitted = new Set<string>()
  const candidates: SellerOsDemandFirstFamilyCandidateV1[] = []
  for (const task of rows(input.tasks).slice(0,
    SELLER_OS_DEMAND_FIRST_BROAD_NET_LIMITS_V1.queryTasks)) {
    const taskId = text(task.id, 80)
    const batchId = text(task.capture_batch_id, 80)
    const query = text(task.search_query, 100)
    const categoryId = text(task.category_id, 40)
    const batch = batchId ? batchesById.get(batchId) : null
    if (task.status !== "PROCESSED" || !taskId || !batchId || !query || !batch) {
      candidates.push(Object.freeze({ status: "UNQUALIFIED" as const,
        reason: "PROCESSED_REVIEWED_CAPTURE_REQUIRED", familyDefinition: null,
        observation: null, taskId, batchId }))
      continue
    }
    const taskEvidence = (observationsByBatch.get(batchId) ?? [])
      .flatMap((row) => {
        const item = evidenceFromObservation(task, batch, row)
        return item ? [item] : []
      }).slice(0, SELLER_OS_DEMAND_FIRST_BROAD_NET_LIMITS_V1.observations)
    const research = buildMarketOpportunityResearchV1({
      request: normalizeMarketResearchRequestV1({
        marketplace: "EBAY_US", seedType: "SEED_QUERY", seedValue: query,
        requestedWindowDays: 30, researchIntent: "FAMILY_DISCOVERY",
        queryBudget: 5,
        seedIdentity: { categoryId, categoryName: null, brand: null, gtin: null,
          mpn: null, model: null, packCount: null, size: null, color: null },
      }),
      evidence: taskEvidence,
      observedAt: instant(batch.captured_at) ?? new Date(0).toISOString(),
      activeMarketStatus: "UNAVAILABLE", soldHistoryStatus: "AVAILABLE",
      paginationCoverage: "BOUNDED_REVIEWED_PRODUCT_RESEARCH_CAPTURE",
      sourceLimitations: ["MARKETPLACE_INSIGHTS_UNAVAILABLE_OR_RESTRICTED",
        "ACTIVE_ASKING_PRICE_NOT_USED_AS_SOLD_EVIDENCE"],
    })
    const family = research.productFamilies[0]
    const identityCount = new Set((observationsByBatch.get(batchId) ?? [])
      .flatMap((row) => text(row.identity_hash, 80) ?
        [text(row.identity_hash, 80) as string] : [])).size
    if (!categoryId || taskEvidence.length < 2 || identityCount < 2 || !family ||
        family.soldEvidenceCount < 2 || family.supportingListingCount < 2 ||
        family.canonicalLabel === "Unproven product family") {
      candidates.push(Object.freeze({ status: "UNQUALIFIED" as const,
        reason: "DEFENSIBLE_FAMILY_EVIDENCE_INSUFFICIENT", familyDefinition: null,
        observation: null, taskId, batchId }))
      continue
    }
    const intent = unique((research.keywordSpine.terms.length
      ? research.keywordSpine.terms : [query]).slice(0, 8))
    const familyIdentity: SellerOsMarketFamilyIdentityV1 = {
      productFunction: family.canonicalLabel,
      buyerUseCase: query,
      category: `ebay-us-category:${categoryId}`,
      structuredDefinition: {
        "category id": categoryId,
        "product family": family.canonicalLabel,
      },
    }
    const range = dateRange(batch)
    const capturedAt = instant(batch.captured_at)
    const references = unique(taskEvidence.map((row) => row.evidenceId))
    const prices = taskEvidence.flatMap((row) => row.price === null ? [] : [row.price])
    const quantities = taskEvidence.reduce((sum, row) =>
      sum + (row.confirmedSoldQuantity ?? 0), 0)
    if (!range.startAt || !range.endAt || !capturedAt || !prices.length) {
      candidates.push(Object.freeze({ status: "UNQUALIFIED" as const,
        reason: "CAPTURE_WINDOW_OR_PRICE_EVIDENCE_INVALID", familyDefinition: null,
        observation: null, taskId, batchId }))
      continue
    }
    const familyDemandStatus = references.length >= 5 && quantities >= 10
      ? "FAMILY_DEMAND_PROVEN" as const : "FAMILY_DEMAND_SUPPORTED" as const
    const demandKeywordFamilyTypes = new Set<DemandKeywordFamilyInputV1["familyType"]>([
      "CORE", "FORM_FACTOR", "FEATURE", "USE_CASE", "BENEFIT", "PACK_FORMAT",
      "AUDIENCE", "ATTRIBUTE",
    ])
    const demandKeywordDna = buildSellerOsDemandKeywordDnaV1({
      keywordFamilies: research.keywordFamilies.flatMap((keywordFamily) =>
        demandKeywordFamilyTypes.has(
          keywordFamily.familyType as DemandKeywordFamilyInputV1["familyType"],
        ) ? [{ ...keywordFamily,
          familyType: keywordFamily.familyType as
            DemandKeywordFamilyInputV1["familyType"] }] : []),
      soldTitles: taskEvidence.flatMap((row) => row.title ? [{ title: row.title,
        soldQuantityObserved: row.confirmedSoldQuantity ?? 0,
        evidenceReference: row.evidenceId }] : []),
      familyDemandStatus, evidenceObservedAt: capturedAt,
      maximumAgeSeconds: MAXIMUM_AGE_SECONDS,
    })
    const familyDefinition: SellerOsMarketFamilyDefinitionV1 = {
      identity: familyIdentity, familyName: family.canonicalLabel,
      familyQuerySet: unique([query, ...research.generatedQueries.map((row) => row.query)])
        .slice(0, 16),
      keyProductAttributes: ["category id", "product family"],
      keyBuyerIntentTerms: intent, demandKeywordDna,
      adapterContract: SELLER_OS_DEMAND_FIRST_BROAD_NET_ORCHESTRATOR_VERSION,
      adapterVersion: "1",
    }
    const familyId = buildSellerOsMarketFamilyIdV1(familyIdentity)
    const semantic = `${familyIdentity.category.toLowerCase()}\n${familyIdentity.productFunction.toLowerCase()}`
    if (exactExisting.has(familyId) || semanticExisting.has(semantic) ||
        emitted.has(familyId)) {
      candidates.push(Object.freeze({ status: "DUPLICATE" as const,
        reason: "CANONICAL_FAMILY_DUPLICATE_SUPPRESSED", familyDefinition,
        observation: null, taskId, batchId }))
      continue
    }
    emitted.add(familyId)
    const sellerHashes = unique(taskEvidence.flatMap((row) =>
      row.sellerReferenceHash ? [row.sellerReferenceHash] : []))
    const observation = buildSellerOsFamilyMarketObservationV1({
      familyDefinition, observationWindowStart: range.startAt,
      observationWindowEnd: range.endAt, familyDemandStatus,
      demandEvidenceClass: "OFFICIAL_SOLD_EVIDENCE", sourceStatus: "AVAILABLE",
      aggregationSemantics: "CUMULATIVE_SNAPSHOT",
      demandEvidenceReferences: references, demandEvidenceDigest: digest(references),
      soldComparableCount: references.length,
      soldQuantityEvidence: { quantity: quantities,
        authorityClass: "OFFICIAL_EXTERNAL_FACT", evidenceReferences: references },
      activeComparableCount: null,
      sellerDiversity: sellerHashes.length ? sellerHashes.length : null,
      priceBand: { currency: "USD", minimum: Math.min(...prices),
        maximum: Math.max(...prices) },
      priceMedian: median(prices), priceDistributionEvidence: references,
      competitionState: "UNPROVEN", buyerIntentTerms: intent,
      keywordState: "AVAILABLE", demandKeywordDna,
      attributeProfile: familyIdentity.structuredDefinition,
      opportunityTypes: ["DEMAND_FIRST_TEST_LAUNCH"],
      evidenceObservedAt: capturedAt, sourceUpdatedAt: capturedAt,
      maximumAgeSeconds: MAXIMUM_AGE_SECONDS, sourceAdapter: SOURCE_ADAPTER,
      sourceContractVersion: SOURCE_CONTRACT,
      limitations: ["MARKETPLACE_INSIGHTS_UNAVAILABLE_OR_RESTRICTED",
        "EXACT_PRODUCT_DEMAND_NOT_CLAIMED"],
    })
    candidates.push(Object.freeze({ status: "QUALIFIED" as const,
      reason: "OFFICIAL_SOLD_FAMILY_EVIDENCE_QUALIFIED", familyDefinition,
      observation, taskId, batchId }))
  }
  return Object.freeze(candidates.slice(0,
    SELLER_OS_DEMAND_FIRST_BROAD_NET_LIMITS_V1.familyCandidates))
}

function currentObservation(family: JsonRecord) {
  return rows(family.observationSeries)[0] ?? record(family.currentObservation)
}

export function buildPersistedDailyDollarFamiliesV1(input: Readonly<{
  radarPayload: unknown
}>) : readonly SellerOsDailyDollarRadarAutopilotFamilyInputV1[] {
  const radar = record(input.radarPayload)
  if (radar.status !== "AVAILABLE") return Object.freeze([])
  return Object.freeze(rows(radar.families).slice(0, 100).flatMap((family) => {
    const current = currentObservation(family)
    const observationId = text(current.observationId, 120)
    const familyId = text(family.familyId, 120)
    const caseId = text(family.opportunityCaseId, 120)
    const familyName = text(family.familyName, 160)
    const demandStatus = text(current.familyDemandStatus, 80)
    const evidenceDigest = text(current.demandEvidenceDigest, 80)
    const observedAt = instant(current.evidenceObservedAt)
    const maximumAgeSeconds = integer(current.maximumAgeSeconds)
    const attributeProfile = record(current.attributeProfile)
    const keywordDnaRecord = record(current.demandKeywordDna)
    const demandKeywordDna = Object.keys(keywordDnaRecord).length
      ? normalizeSellerOsDemandKeywordDnaV1(
        keywordDnaRecord as SellerOsDemandKeywordDnaV1) : null
    const buyerIntentTerms = (Array.isArray(current.buyerIntentTerms)
      ? current.buyerIntentTerms : []).flatMap((entry) => {
        const value = text(entry, 120)
        return value ? [value] : []
      })
    if (!familyId || !caseId || !familyName || !observationId ||
        !evidenceDigest || !observedAt || !maximumAgeSeconds ||
        !["FAMILY_DEMAND_PROVEN", "FAMILY_DEMAND_SUPPORTED"].includes(
          demandStatus ?? "") || !Object.keys(attributeProfile).length ||
        !buyerIntentTerms.length) return []
    const attributes = Object.entries(attributeProfile).map(([key, value]) => ({
      key, expectedValue: String(value), attributeClassification: "PROVEN_ATTRIBUTE" as const,
      requirement: "REQUIRED" as const, matchMode: "EXACT_NORMALIZED" as const,
      componentIdentityId: null,
      authority: { authorityClass: "DURABLY_PERSISTED_FACT" as const,
        reference: observationId, evidenceDigest, observedAt, maximumAgeSeconds },
    }))
    const targetProfile = buildSellerOsTargetProductProfileWithAuthorityV1({
      familyId, opportunityCaseId: caseId,
      currentMarketObservationId: observationId, attributes, buyerIntentTerms,
    })
    const competition = text(current.competitionState, 40)
    const momentum = text(current.momentumStatus, 40)
    return [Object.freeze({
      discoveryStatus: "EXISTING_MONITORED_FAMILY" as const,
      radar: Object.freeze({ familyId, familyName, opportunityCaseId: caseId,
        currentMarketObservationId: observationId,
        familyDemandStatus: demandStatus as "FAMILY_DEMAND_PROVEN" |
          "FAMILY_DEMAND_SUPPORTED",
        competitionStatus: competition === "LOW" ? "FAVORABLE" as const
          : competition === "MODERATE" ? "ACCEPTABLE" as const
            : competition === "HIGH" ? "DIFFICULT" as const : "UNPROVEN" as const,
        evidenceObservedAt: observedAt, maximumAgeSeconds, evidenceDigest,
        demandEvidenceSummary: Object.freeze({
          demandEvidenceClass: text(current.demandEvidenceClass, 80) ===
            "OFFICIAL_SOLD_EVIDENCE" ? "OFFICIAL_SOLD_EVIDENCE" as const
            : "UNPROVEN" as const,
          soldComparableCount: integer(current.soldComparableCount),
          soldQuantityEvidence: integer(current.soldQuantity),
          priceMedianUsd: money(current.priceMedian),
          limitations: (Array.isArray(current.limitations) ? current.limitations : [])
            .flatMap((entry) => text(entry, 160) ? [text(entry, 160) as string] : []),
        }),
        momentumStatus: (["INSUFFICIENT_HISTORY", "NEW", "STRENGTHENING", "STABLE",
          "WEAKENING", "SATURATING"].includes(momentum ?? "") ? momentum
          : "INSUFFICIENT_HISTORY") as "INSUFFICIENT_HISTORY" | "NEW" |
          "STRENGTHENING" | "STABLE" | "WEAKENING" | "SATURATING",
      }),
      targetProfile,
      keywordSource: Object.freeze({ sourceContractVersion: SOURCE_CONTRACT,
        authorityClass: "DURABLY_PERSISTED_FACT" as const,
        reference: observationId, evidenceDigest, observedAt, maximumAgeSeconds,
        terms: Object.freeze(buyerIntentTerms), demandKeywordDna }),
      lunaMatches: Object.freeze([]),
    })]
  }))
}

async function checkedRpc(client: ReadWriteClient, name: string,
  parameters: JsonRecord) {
  const result = await client.rpc(name, parameters)
  if (result.error) throw new Error(`${name.toUpperCase()}_FAILED`)
  return record(result.data)
}

export async function runSellerOsDemandFirstBroadNetCanaryV1(input: Readonly<{
  supabase: ReadWriteClient
  accountKey: string
  maximumFamiliesToPersist?: number
}>) {
  const tasksResult = await input.supabase
    .from("marketplace_product_research_query_tasks")
    .select("id,search_query,query_hash,category_id,status,capture_batch_id,captured_at")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
    .eq("status", "PROCESSED").order("captured_at", { ascending: false })
    .limit(SELLER_OS_DEMAND_FIRST_BROAD_NET_LIMITS_V1.queryTasks)
  if (tasksResult.error) throw new Error("DEMAND_FIRST_QUERY_TASK_READ_FAILED")
  const tasks = rows(tasksResult.data)
  const batchIds = unique(tasks.flatMap((task) => {
    const id = text(task.capture_batch_id, 80)
    return id ? [id] : []
  }))
  let batches: JsonRecord[] = []
  let observations: JsonRecord[] = []
  if (batchIds.length) {
    const [batchResult, observationResult] = await Promise.all([
      input.supabase.from("marketplace_product_research_capture_batches")
        .select("id,search_query_hash,search_keyword_patterns,date_range,captured_at,source,listing_site,raw_html_stored,pii_stored")
        .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
        .in("id", batchIds).limit(SELLER_OS_DEMAND_FIRST_BROAD_NET_LIMITS_V1.queryTasks),
      input.supabase.from("marketplace_product_research_capture_observations")
        .select("id,capture_batch_id,identity_hash,normalized_identity,detected_offer_pack_count,detected_size,average_sold_price,average_shipping,confirmed_sold_quantity,last_sold_date,keyword_signals,evidence_reviewed,quality_status,seller_reference_fingerprint")
        .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
        .eq("evidence_reviewed", true).eq("quality_status", "VALID")
        .in("capture_batch_id", batchIds).order("last_sold_date", { ascending: false })
        .limit(SELLER_OS_DEMAND_FIRST_BROAD_NET_LIMITS_V1.observations),
    ])
    if (batchResult.error || observationResult.error) {
      throw new Error("DEMAND_FIRST_OFFICIAL_EVIDENCE_READ_FAILED")
    }
    batches = rows(batchResult.data)
    observations = rows(observationResult.data)
  }
  const existingResult = await input.supabase.rpc(
    "get_seller_os_family_market_radar_v1", { p_family_id: null, p_limit: 100 })
  if (existingResult.error) throw new Error("DEMAND_FIRST_FAMILY_AUTHORITY_READ_FAILED")
  const existingRadar = record(existingResult.data)
  if (existingRadar.status !== "AVAILABLE" || !Array.isArray(existingRadar.families)) {
    throw new Error("DEMAND_FIRST_FAMILY_AUTHORITY_UNAVAILABLE")
  }
  const candidates = buildSellerOsDemandFirstFamilyCandidatesV1({
    tasks, batches, observations, existingCases: rows(existingRadar.families).map(
      (family) => ({ family_id: family.familyId, family_name: family.familyName,
        opportunity_case_id: family.opportunityCaseId })),
  })
  const qualified = candidates.filter((item) => item.status === "QUALIFIED")
    .slice(0, Math.min(SELLER_OS_DEMAND_FIRST_BROAD_NET_LIMITS_V1
      .persistedFamiliesPerManualCanary, input.maximumFamiliesToPersist ?? 1))
  let persisted = 0
  let opportunityCasesCreated = 0
  let observationsCreated = 0
  let enrollmentsCreated = 0
  let productFitHandoff: unknown = null
  const persistedNames: string[] = []
  for (const candidate of qualified) {
    if (!candidate.familyDefinition || !candidate.observation) continue
    const definition = candidate.familyDefinition
    const expected = candidate.observation
    const caseResult = await checkedRpc(input.supabase,
      "put_seller_os_market_opportunity_case_v1", {
        p_family_identity: definition.identity, p_family_name: definition.familyName,
        p_family_query_set: definition.familyQuerySet,
        p_key_product_attributes: definition.keyProductAttributes,
        p_key_buyer_intent_terms: definition.keyBuyerIntentTerms,
        p_adapter_contract: definition.adapterContract,
        p_adapter_version: definition.adapterVersion,
        p_demand_keyword_dna: definition.demandKeywordDna,
      })
    if (text(caseResult.familyId, 120) !== expected.familyId ||
        text(caseResult.opportunityCaseId, 120) !== expected.opportunityCaseId ||
        text(caseResult.familyDefinitionVersionId, 120) !==
          expected.familyDefinitionVersionId) {
      throw new Error("DEMAND_FIRST_CASE_READBACK_MISMATCH")
    }
    opportunityCasesCreated += caseResult.outcome === "IDEMPOTENT_SUCCESS" ? 0 : 1
    const observationResult = await checkedRpc(input.supabase,
      "put_seller_os_family_market_observation_v1", {
        p_opportunity_case_id: expected.opportunityCaseId,
        p_family_definition_version_id: expected.familyDefinitionVersionId,
        p_observation_window_start: expected.observationWindowStart,
        p_observation_window_end: expected.observationWindowEnd,
        p_demand_evidence_class: "OFFICIAL_SOLD_EVIDENCE",
        p_source_status: "AVAILABLE", p_aggregation_semantics: "CUMULATIVE_SNAPSHOT",
        p_demand_evidence_references: expected.demandEvidenceReferences,
        p_sold_comparable_count: expected.soldComparableCount,
        p_sold_quantity: expected.soldQuantityEvidence?.quantity ?? null,
        p_active_comparable_count: null, p_seller_diversity: expected.sellerDiversity,
        p_price_currency: expected.priceBand?.currency ?? null,
        p_price_band_minimum: expected.priceBand?.minimum ?? null,
        p_price_band_maximum: expected.priceBand?.maximum ?? null,
        p_price_median: expected.priceMedian,
        p_price_distribution_evidence: expected.priceDistributionEvidence,
        p_competition_state: "UNPROVEN",
        p_buyer_intent_terms: expected.buyerIntentTerms,
        p_keyword_state: "AVAILABLE",
        p_demand_keyword_dna: expected.demandKeywordDna,
        p_attribute_profile: expected.attributeProfile,
        p_opportunity_types: expected.opportunityTypes,
        p_evidence_observed_at: expected.evidenceObservedAt,
        p_source_updated_at: expected.sourceUpdatedAt,
        p_maximum_age_seconds: MAXIMUM_AGE_SECONDS,
        p_source_adapter: SOURCE_ADAPTER, p_source_contract_version: SOURCE_CONTRACT,
        p_momentum_policy_version: MOMENTUM_POLICY, p_limitations: expected.limitations,
      })
    const observationId = text(observationResult.observationId, 120)
    if (observationId !== expected.observationId) {
      throw new Error("DEMAND_FIRST_OBSERVATION_READBACK_MISMATCH")
    }
    observationsCreated += observationResult.outcome === "CREATED" ? 1 : 0
    const enrollment = buildSellerOsOpportunityMonitorEnrollmentV1({
      familyIdentity: definition.identity, monitorPolicyVersion: MONITOR_POLICY,
      enrolledAt: expected.evidenceObservedAt, status: "ENROLLED",
      nextReviewCondition: "TIME_WINDOW_ELAPSED", nextEligibleReviewAt: null,
      lastObservationId: observationId, lastEvaluatedAt: expected.evidenceObservedAt,
    })
    const enrollmentResult = await checkedRpc(input.supabase,
      "put_seller_os_opportunity_monitor_enrollment_v1", {
        p_opportunity_case_id: expected.opportunityCaseId,
        p_monitor_policy_version: MONITOR_POLICY,
        p_enrolled_at: enrollment.enrolledAt, p_status: "ENROLLED",
        p_next_review_condition: "TIME_WINDOW_ELAPSED",
        p_next_eligible_review_at: null, p_last_observation_id: observationId,
        p_last_evaluated_at: expected.evidenceObservedAt,
      })
    if (enrollmentResult.schedulerEnabled !== false ||
        text(enrollmentResult.lastObservationId, 120) !== observationId) {
      throw new Error("DEMAND_FIRST_ENROLLMENT_READBACK_MISMATCH")
    }
    enrollmentsCreated += enrollmentResult.outcome === "CREATED" ? 1 : 0
    const readback = await checkedRpc(input.supabase,
      "get_seller_os_family_market_radar_v1", {
        p_family_id: expected.familyId, p_limit: 1,
      })
    const readbackFamily = rows(readback.families)[0]
    const readbackObservation = rows(readbackFamily?.observationSeries)[0]
    if (readback.status !== "AVAILABLE" ||
        text(readbackFamily?.familyId, 120) !== expected.familyId ||
        digest(record(readbackObservation?.demandKeywordDna)) !==
          digest(record(expected.demandKeywordDna))) {
      throw new Error("DEMAND_FIRST_RADAR_READBACK_MISMATCH")
    }
    persisted += 1
    persistedNames.push(definition.familyName)
    if (expected.familyDemandStatus === "FAMILY_DEMAND_PROVEN") {
      productFitHandoff = await collectRadarRevenueFactoryCandidateBatchV1({
        supabase: input.supabase, accountKey: input.accountKey,
        allowedFamilyNames: [definition.familyName], targetCandidates: 10,
      })
    }
  }
  const radarReadback = persisted ? await checkedRpc(input.supabase,
    "get_seller_os_family_market_radar_v1", { p_family_id: null, p_limit: 100 })
    : existingRadar
  return Object.freeze({
    contractVersion: SELLER_OS_DEMAND_FIRST_BROAD_NET_ORCHESTRATOR_VERSION,
    status: "PASS" as const,
    eBayDiscoverySignals: observations.length,
    newFamilyCandidates: qualified.length,
    duplicatesSuppressed: candidates.filter((item) => item.status === "DUPLICATE").length,
    newFamiliesPersisted: persisted, opportunityCasesCreated,
    observationsCreated, enrollmentsCreated,
    radarReadback: radarReadback.status === "AVAILABLE" ? "PASS" as const : "FAIL" as const,
    lunaProductFitHandoff: productFitHandoff ?? (persistedNames.length
      ? "NOT_ELIGIBLE_UNTIL_FAMILY_DEMAND_PROVEN" : "NO_NEW_ELIGIBLE_FAMILY"),
    shippingRuns: 0 as const, marketplaceWrites: 0 as const,
    externalAlerts: 0 as const, nightlyPolicyEnabled: false as const,
  })
}
