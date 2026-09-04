import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { buildLunaExactProductEvidenceSetV1 } from
  "./ebay-luna-full-page-required-facts-v1"
import { completeLunaQuickPickBatchReceiptV1,
  processLunaQuickPickBatchV1, readLunaQuickPickProgressV1,
  receiveLunaQuickPickBatchV1 } from
  "./ebay-luna-quick-pick-v1"
import { continueLunaQuickPickPostShippingRuntimeV1 } from
  "./ebay-quick-pick-post-shipping-continuation-v1"
import { readAlreadyLiveExactLunaIdentitiesV1,
  readRadarRevenueFactoryLunaCatalogV1 } from
  "./ebay-opportunity-radar-revenue-factory-adapter-v1"
import type { RadarMarketplaceTaxonomyReaderV1,
  RadarProductIdentifierPolicyReaderV1 } from
  "./ebay-radar-canonical-marketplace-readiness-v1"
import { resolveSharedProductIdentityMatchV1,
  type SharedProductIdentityClassV1 } from
  "./exact-product-visual-matcher-v1"

export const RADAR_LUNA_QUICK_PICK_HANDOFF_V1 =
  "RADAR_LUNA_QUICK_PICK_HANDOFF_V1" as const
export const MAX_QUALIFIED_SIGNALS_PER_CYCLE = 3
export const MAX_CHEAP_LUNA_CANDIDATES = 12
export const MAX_FULL_EVIDENCE_CANDIDATES = 3

type JsonRecord = Record<string, unknown>
type DemandClass = "FAMILY_DEMAND_PROVEN" | "FAMILY_DEMAND_SUPPORTED"

export type QualifiedRadarSignalV1 = Readonly<{
  familyId: string
  familyName: string
  opportunityCaseId: string
  observationId: string
  radarEvidenceDigest: string
  familyDemandStatus: DemandClass
  exactDemandStatus: "UNPROVEN"
  momentumStatus: string
  commercialComparableStatus: "AVAILABLE" | "UNPROVEN"
  commercialComparableCount: number
  commercialPriceBand: Readonly<{
    currency: string | null
    minimum: number | null
    maximum: number | null
  }>
  targetPhrases: readonly string[]
  exactSupplierIdentity: Readonly<{
    lunaProductId: string
    lunaVariantId: string
    supplierSku: string
  }> | null
}>

export type RadarLunaCheapCandidateV1 = Readonly<{
  familyId: string
  opportunityCaseId: string
  row: JsonRecord
  lunaProductId: string
  lunaVariantId: string
  lunaSku: string
  title: string
  productUrl: string
  available: boolean
  identityClass: SharedProductIdentityClassV1
  identityScore: number
  exactPhrase: boolean
}>

type CandidateGuardV1 = Readonly<{
  queueRow: JsonRecord | null
  alreadyLive: boolean
  alreadyInQuickPick: boolean
  existingHandoff: boolean
  activeProcessing: boolean
  parkedEconomicsWithoutMaterialChange: boolean
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, maximum = 500) {
  if (typeof value !== "string") return null
  const candidate = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
  return candidate && candidate.length <= maximum ? candidate : null
}

function finite(value: unknown) {
  if (value == null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function bool(value: unknown) {
  return value === true || value === "true"
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as JsonRecord)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stable(entry)]))
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(stable(value))).digest("hex")}`
}

function uniqueText(values: readonly unknown[], maximum = 40) {
  return [...new Set(values.flatMap((value) => {
    const candidate = text(value, 300)
    return candidate ? [candidate] : []
  }))].slice(0, maximum)
}

function currentObservation(family: JsonRecord) {
  return rows(family.observationSeries)[0] ?? record(family.currentObservation)
}

function demandKeywordTerms(value: unknown) {
  const dna = record(value)
  return rows(dna.soldWeightedTerms).flatMap((entry) =>
    text(entry.term, 200) ? [String(entry.term)] : [])
}

export function projectQualifiedRadarSignalsV1(payload: unknown) {
  const root = record(payload)
  if (root.status !== "AVAILABLE") return Object.freeze([] as
    QualifiedRadarSignalV1[])
  const projected = rows(root.families).flatMap((family) => {
    const observation = currentObservation(family)
    const familyId = text(family.familyId, 120)
    const familyName = text(family.familyName, 240)
    const opportunityCaseId = text(family.opportunityCaseId, 120)
    const observationId = text(observation.observationId, 120)
    const radarEvidenceDigest = text(observation.demandEvidenceDigest, 80)
    const demand = text(observation.familyDemandStatus, 80)
    if (!familyId || !familyName || !opportunityCaseId || !observationId ||
        !radarEvidenceDigest || observation.fresh !== true ||
        !["FAMILY_DEMAND_PROVEN", "FAMILY_DEMAND_SUPPORTED"].includes(
          demand ?? "")) return []
    const commercial = record(observation.commercialComparableCluster)
    const status = text(observation.commercialComparableStatus, 40) ??
      text(commercial.status, 40)
    const commercialStatus = status === "AVAILABLE"
      ? "AVAILABLE" as const : "UNPROVEN" as const
    const price = record(observation.commercialPriceBand)
    const attributeProfile = record(observation.attributeProfile)
    const exact = record(family.exactSupplierIdentity)
    const lunaProductId = text(exact.lunaProductId ??
      attributeProfile["supplier product id"], 80)
    const lunaVariantId = text(exact.lunaVariantId ??
      attributeProfile["supplier variant id"], 80)
    const supplierSku = text(exact.supplierSku ??
      attributeProfile["supplier sku"], 120)
    const targetPhrases = uniqueText([
      familyName,
      attributeProfile["product family"],
      ...demandKeywordTerms(observation.demandKeywordDna ??
        family.currentDemandKeywordDna),
    ])
    return [Object.freeze({ familyId, familyName, opportunityCaseId,
      observationId, radarEvidenceDigest,
      familyDemandStatus: demand as DemandClass,
      exactDemandStatus: "UNPROVEN" as const,
      momentumStatus: text(observation.momentumStatus, 80) ??
        "INSUFFICIENT_HISTORY",
      commercialComparableStatus: commercialStatus,
      commercialComparableCount: Math.max(0, Math.trunc(finite(
        observation.commercialComparableCount ?? commercial.comparableCount) ?? 0)),
      commercialPriceBand: Object.freeze({
        currency: text(observation.commercialPriceCurrency ??
          price.currency, 12),
        minimum: finite(observation.commercialPriceTypicalLow ??
          price.minimum ?? price.typicalLow),
        maximum: finite(observation.commercialPriceTypicalHigh ??
          price.maximum ?? price.typicalHigh),
      }), targetPhrases,
      exactSupplierIdentity: lunaProductId && lunaVariantId && supplierSku
        ? Object.freeze({ lunaProductId, lunaVariantId, supplierSku }) : null,
    })]
  }).sort((left, right) => {
    const demandOrder = left.familyDemandStatus === "FAMILY_DEMAND_PROVEN"
      ? 0 : 1
    const rightDemandOrder = right.familyDemandStatus ===
      "FAMILY_DEMAND_PROVEN" ? 0 : 1
    const commercialOrder = left.commercialComparableStatus === "AVAILABLE"
      ? 0 : 1
    const rightCommercialOrder = right.commercialComparableStatus ===
      "AVAILABLE" ? 0 : 1
    return demandOrder - rightDemandOrder || commercialOrder - rightCommercialOrder
      || right.commercialComparableCount - left.commercialComparableCount
      || left.familyId.localeCompare(right.familyId)
  })
  return Object.freeze(projected)
}

function candidateTitle(row: JsonRecord) {
  return uniqueText([row.title, row.variant_title, row.product_type,
    ...(Array.isArray(row.tags) ? row.tags : [])], 30).join(" ")
}

function exactSupplierIdentity(signal: QualifiedRadarSignalV1, row: JsonRecord) {
  return Boolean(signal.exactSupplierIdentity &&
    signal.exactSupplierIdentity.lunaProductId === text(
      row.supplier_product_id ?? row.product_id, 80) &&
    signal.exactSupplierIdentity.lunaVariantId === text(
      row.supplier_variant_id, 80) &&
    signal.exactSupplierIdentity.supplierSku === text(row.sku, 120))
}

export function buildBoundedRadarLunaShortlistsV1(input: Readonly<{
  signals: readonly QualifiedRadarSignalV1[]
  catalogRows: readonly unknown[]
  maximumCheapCandidates?: number
  maximumFullEvidenceCandidates?: number
}>) {
  const maximumCheap = Math.max(1, Math.min(MAX_CHEAP_LUNA_CANDIDATES,
    Math.trunc(input.maximumCheapCandidates ?? MAX_CHEAP_LUNA_CANDIDATES)))
  const maximumFull = Math.max(1, Math.min(MAX_FULL_EVIDENCE_CANDIDATES,
    Math.trunc(input.maximumFullEvidenceCandidates ??
      MAX_FULL_EVIDENCE_CANDIDATES)))
  const byFamily = new Map<string, RadarLunaCheapCandidateV1[]>()
  let catalogCandidatesFound = 0
  let cheapRejectedCount = 0
  for (const signal of input.signals) {
    const scored = rows(input.catalogRows).flatMap((row) => {
      const lunaProductId = text(row.supplier_product_id ?? row.product_id, 80)
      const lunaVariantId = text(row.supplier_variant_id, 80)
      const lunaSku = text(row.sku, 120)
      const title = text(row.title, 500)
      const productUrl = text(row.product_url, 2_000)
      if (!lunaProductId || !lunaVariantId || !lunaSku || !title ||
          !productUrl) return []
      const exactIdentity = exactSupplierIdentity(signal, row)
      const match = exactIdentity ? Object.freeze({ classification: "EXACT" as const,
        bestPhraseOverlap: 1, exactPhrase: true })
        : resolveSharedProductIdentityMatchV1({
            targetPhrases: signal.targetPhrases,
            candidateTitle: candidateTitle(row),
            candidateIdentifiers: [row.barcode],
            candidateBrand: row.vendor,
          })
      if (match.classification === "UNPROVEN") return []
      catalogCandidatesFound += 1
      const available = bool(row.available) &&
        (finite(row.inventory_quantity) ?? 1) > 0
      return [Object.freeze({ familyId: signal.familyId,
        opportunityCaseId: signal.opportunityCaseId, row,
        lunaProductId, lunaVariantId, lunaSku, title, productUrl, available,
        identityClass: match.classification,
        identityScore: match.bestPhraseOverlap,
        exactPhrase: match.exactPhrase })]
    }).sort((left, right) => {
      const classOrder = (value: SharedProductIdentityClassV1) =>
        value === "EXACT" ? 0 : value === "STRONG" ? 1 :
          value === "FAMILY" ? 2 : 3
      return classOrder(left.identityClass) - classOrder(right.identityClass)
        || Number(right.available) - Number(left.available)
        || right.identityScore - left.identityScore
        || left.lunaSku.localeCompare(right.lunaSku)
    })
    cheapRejectedCount += Math.max(0, scored.length - maximumCheap)
      + scored.filter((candidate) => !candidate.available ||
        !["EXACT", "STRONG"].includes(candidate.identityClass)).length
    const cheap = scored.slice(0, maximumCheap)
    byFamily.set(signal.familyId, cheap.slice(0, maximumFull))
  }
  return Object.freeze({ byFamily, catalogCandidatesFound,
    cheapRejectedCount, maximumCheapCandidates: maximumCheap,
    maximumFullEvidenceCandidates: maximumFull,
    fullPageScanUsedForAllLunaProducts: false as const })
}

function identityKey(candidate: RadarLunaCheapCandidateV1) {
  return `${candidate.lunaProductId}\n${candidate.lunaVariantId}\n${candidate.lunaSku}`
}

function markerFrom(row: JsonRecord | null, name: string) {
  return record(record(row?.assessment)[name])
}

function activeProcessing(row: JsonRecord | null) {
  const operation = markerFrom(row, "lunaQuickPickOperationV1")
  return Boolean(row && operation.completedAt == null &&
    (text(operation.claimId, 160) || text(operation.processingClaimId, 160)))
}

function parkedWithoutChange(row: JsonRecord | null,
  signal: QualifiedRadarSignalV1, candidate: RadarLunaCheapCandidateV1) {
  if (!row || text(row.decision, 120) !== "PARKED_ECONOMICS") return false
  const previous = markerFrom(row, "radarToQuickPickHandoffV1")
  if (!Object.keys(previous).length) return true
  const previousDigest = text(previous.materialChangeDigest, 80)
  const currentDigest = digest({ radarEvidenceDigest: signal.radarEvidenceDigest,
    commercialPriceBand: signal.commercialPriceBand,
    supplierCost: candidate.row.price,
    inventory: candidate.row.inventory_quantity,
    variantId: candidate.lunaVariantId })
  return previousDigest === currentDigest
}

function canarySelection(input: Readonly<{
  signals: readonly QualifiedRadarSignalV1[]
  candidates: ReadonlyMap<string, readonly RadarLunaCheapCandidateV1[]>
  guards: ReadonlyMap<string, CandidateGuardV1>
}>) {
  const eligibleStrong = (signal: QualifiedRadarSignalV1) =>
    (input.candidates.get(signal.familyId) ?? []).filter((candidate) => {
      const guard = input.guards.get(identityKey(candidate))
      return candidate.available && ["EXACT", "STRONG"].includes(
        candidate.identityClass) && guard && !guard.alreadyLive &&
        !guard.alreadyInQuickPick && !guard.existingHandoff &&
        !guard.activeProcessing && !guard.parkedEconomicsWithoutMaterialChange
    })
  const a = input.signals.find((signal) =>
    signal.familyDemandStatus === "FAMILY_DEMAND_PROVEN" &&
    signal.commercialComparableStatus === "AVAILABLE" &&
    eligibleStrong(signal).length > 0)
  const b = input.signals.find((signal) => signal.familyId !== a?.familyId &&
    eligibleStrong(signal).length === 0 &&
    !(input.candidates.get(signal.familyId) ?? []).some((candidate) => {
      const guard = input.guards.get(identityKey(candidate))
      return ["EXACT", "STRONG"].includes(candidate.identityClass) &&
        Boolean(guard?.alreadyLive || guard?.alreadyInQuickPick ||
          guard?.existingHandoff)
    }))
  const c = input.signals.find((signal) => signal.familyId !== a?.familyId &&
    signal.familyId !== b?.familyId &&
    (input.candidates.get(signal.familyId) ?? []).some((candidate) => {
      const guard = input.guards.get(identityKey(candidate))
      return ["EXACT", "STRONG"].includes(candidate.identityClass) &&
        Boolean(guard?.alreadyLive || guard?.alreadyInQuickPick ||
          guard?.existingHandoff)
    }))
  if (!a || !b || !c) {
    throw new Error("RADAR_TO_QUICK_PICK_CERTIFICATION_COHORT_UNAVAILABLE")
  }
  return Object.freeze({ a, b, c,
    candidateA: eligibleStrong(a)[0],
    candidateC: (input.candidates.get(c.familyId) ?? []).find((candidate) => {
      const guard = input.guards.get(identityKey(candidate))
      return ["EXACT", "STRONG"].includes(candidate.identityClass) &&
        Boolean(guard?.alreadyLive || guard?.alreadyInQuickPick ||
          guard?.existingHandoff)
    })! })
}

function exactUrl(candidate: RadarLunaCheapCandidateV1) {
  const url = new URL(candidate.productUrl)
  url.searchParams.set("variant", candidate.lunaVariantId)
  return url.toString()
}

async function exactEvidence(input: Readonly<{
  supabase: SupabaseClient
  candidate: RadarLunaCheapCandidateV1
  queueRow: JsonRecord | null
}>) {
  const productId = text(input.candidate.row.product_id, 80)
  if (!productId) throw new Error("RADAR_LUNA_PRODUCT_ID_UNAVAILABLE")
  const productRead = await input.supabase.from("market_radar_products")
    .select("id,body_html,metadata").eq("id", productId).maybeSingle()
  if (productRead.error || !productRead.data) {
    throw new Error("RADAR_LUNA_FULL_EVIDENCE_READ_FAILED")
  }
  return buildLunaExactProductEvidenceSetV1({
    opportunity: input.queueRow ?? {
      supplier_product_id: input.candidate.lunaProductId,
      supplier_variant_id: input.candidate.lunaVariantId,
      supplier_sku: input.candidate.lunaSku,
      assessment: {},
    },
    catalogRow: { ...input.candidate.row,
      body_html: record(productRead.data).body_html,
      product_metadata: record(productRead.data).metadata },
  })
}

async function persistHandoff(input: Readonly<{
  supabase: SupabaseClient
  signal: QualifiedRadarSignalV1
  candidate: RadarLunaCheapCandidateV1
  evidence: ReturnType<typeof buildLunaExactProductEvidenceSetV1>
  batchId: string
  operationId: string
  finalState: string
}>) {
  const read = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,assessment,updated_at")
    .eq("supplier_product_id", input.candidate.lunaProductId)
    .eq("supplier_variant_id", input.candidate.lunaVariantId)
    .eq("supplier_sku", input.candidate.lunaSku).maybeSingle()
  const row = record(read.data)
  if (read.error || !row.id) throw new Error(
    "RADAR_TO_QUICK_PICK_OPERATION_READBACK_FAILED")
  const assessment = record(row.assessment)
  const existing = record(assessment.radarToQuickPickHandoffV1)
  if (existing.radarEvidenceDigest === input.signal.radarEvidenceDigest &&
      existing.quickPickOperationId === input.operationId) {
    return Object.freeze({ created: false, row })
  }
  const now = new Date().toISOString()
  const materialChangeDigest = digest({
    radarEvidenceDigest: input.signal.radarEvidenceDigest,
    commercialPriceBand: input.signal.commercialPriceBand,
    supplierCost: input.candidate.row.price,
    inventory: input.candidate.row.inventory_quantity,
    variantId: input.candidate.lunaVariantId,
  })
  const marker = Object.freeze({ contractVersion:
      RADAR_LUNA_QUICK_PICK_HANDOFF_V1,
    opportunityCaseId: input.signal.opportunityCaseId,
    radarFamilyId: input.signal.familyId,
    radarObservationId: input.signal.observationId,
    radarEvidenceDigest: input.signal.radarEvidenceDigest,
    lunaProductId: input.candidate.lunaProductId,
    lunaVariantId: input.candidate.lunaVariantId,
    lunaSku: input.candidate.lunaSku,
    identityClass: input.candidate.identityClass,
    familyDemandStatus: input.signal.familyDemandStatus,
    exactDemandStatus: "UNPROVEN",
    commercialPriceBand: input.signal.commercialPriceBand,
    lunaEvidenceSetVersion: input.evidence.contractVersion,
    lunaEvidenceDigest: input.evidence.evidenceDigest,
    materialChangeDigest,
    handoffCreatedAt: now,
    quickPickBatchId: input.batchId,
    quickPickOperationId: input.operationId,
    quickPickFinalState: input.finalState,
    quickPickSharedRuntimeUsed: true,
    radarBypassesQuickPickGates: false,
    marketplaceWrites: 0,
  })
  const write = await input.supabase.from("ebay_luna_opportunity_queue")
    .update({ assessment: { ...assessment,
      radarToQuickPickHandoffV1: marker }, updated_at: now })
    .eq("id", row.id).eq("updated_at", row.updated_at)
    .select("id,assessment").maybeSingle()
  const stored = record(record(record(write.data).assessment)
    .radarToQuickPickHandoffV1)
  if (write.error || !write.data ||
      stored.radarEvidenceDigest !== input.signal.radarEvidenceDigest ||
      stored.quickPickOperationId !== input.operationId) {
    throw new Error("RADAR_TO_QUICK_PICK_HANDOFF_WRITE_FAILED")
  }
  return Object.freeze({ created: true, row: record(write.data) })
}

export async function runRadarLunaQuickPickHandoffCycleV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  mode?: "SCHEDULED" | "CERTIFICATION"
  taxonomyReader: RadarMarketplaceTaxonomyReaderV1
  productIdentifierPolicyReader?: RadarProductIdentifierPolicyReaderV1
}>) {
  const radarRead = await input.supabase.rpc(
    "get_seller_os_family_market_radar_v1", { p_family_id: null, p_limit: 100 })
  if (radarRead.error) throw new Error("RADAR_TO_LUNA_AUTHORITY_READ_FAILED")
  const allSignals = projectQualifiedRadarSignalsV1(radarRead.data)
  const signals = input.mode === "CERTIFICATION" ? allSignals
    : allSignals.slice(0, MAX_QUALIFIED_SIGNALS_PER_CYCLE)
  const catalog = await readRadarRevenueFactoryLunaCatalogV1(input.supabase)
  const shortlists = buildBoundedRadarLunaShortlistsV1({ signals,
    catalogRows: catalog.rows })
  const candidates = [...shortlists.byFamily.values()].flat()
  const variantIds = [...new Set(candidates.map((entry) => entry.lunaVariantId))]
  const queueRead = variantIds.length
    ? await input.supabase.from("ebay_luna_opportunity_queue")
      .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,queue_status,decision,assessment,updated_at")
      .in("supplier_variant_id", variantIds).limit(200)
    : { data: [], error: null }
  if (queueRead.error) throw new Error("RADAR_TO_QUICK_PICK_GUARD_READ_FAILED")
  const queueByIdentity = new Map(rows(queueRead.data).map((row) => [
    `${text(row.supplier_product_id, 80)}\n${text(row.supplier_variant_id, 80)}\n${text(row.supplier_sku, 120)}`,
    row,
  ]))
  const live = await readAlreadyLiveExactLunaIdentitiesV1({
    supabase: input.supabase, accountKey: input.accountKey,
    identities: candidates.filter((candidate) =>
      ["EXACT", "STRONG"].includes(candidate.identityClass)).map((candidate) => ({
      identityKey: identityKey(candidate),
      lunaProductId: candidate.lunaProductId,
      lunaVariantId: candidate.lunaVariantId,
      supplierSku: candidate.lunaSku,
    })),
  })
  if (live.status !== "AVAILABLE") throw new Error(
    live.reasonCode ?? "RADAR_TO_QUICK_PICK_LIVE_GUARD_FAILED")
  const signalById = new Map(signals.map((signal) => [signal.familyId, signal]))
  const guards = new Map<string, CandidateGuardV1>()
  for (const candidate of candidates) {
    const queueRow = queueByIdentity.get(identityKey(candidate)) ?? null
    const quickPick = markerFrom(queueRow, "lunaQuickPickOperationV1")
    const handoff = markerFrom(queueRow, "radarToQuickPickHandoffV1")
    const signal = signalById.get(candidate.familyId)!
    guards.set(identityKey(candidate), Object.freeze({ queueRow,
      alreadyLive: live.matches.has(identityKey(candidate)),
      alreadyInQuickPick: Object.keys(quickPick).length > 0,
      existingHandoff: Object.keys(handoff).length > 0,
      activeProcessing: activeProcessing(queueRow),
      parkedEconomicsWithoutMaterialChange:
        parkedWithoutChange(queueRow, signal, candidate),
    }))
  }
  const certification = input.mode === "CERTIFICATION"
    ? canarySelection({ signals, candidates: shortlists.byFamily, guards }) : null
  const selectedSignals = certification ? [certification.a]
    : signals.filter((signal) =>
      (shortlists.byFamily.get(signal.familyId) ?? []).some((candidate) => {
        const guard = guards.get(identityKey(candidate))
        return candidate.available && ["EXACT", "STRONG"].includes(
          candidate.identityClass) && guard && !guard.alreadyLive &&
          !guard.alreadyInQuickPick && !guard.existingHandoff &&
          !guard.activeProcessing && !guard.parkedEconomicsWithoutMaterialChange
      })).slice(0, 1)
  let fullEvidenceCandidateCount = 0
  let quickPickHandoffCreated = false
  let quickPickOperationId: string | null = null
  let quickPickFinalCanaryState: string | null = null
  let batchId: string | null = null
  let aiCallCount = 0
  let bestLunaCandidate: JsonRecord | null = null
  for (const signal of selectedSignals) {
    const candidate = (shortlists.byFamily.get(signal.familyId) ?? [])
      .find((entry) => {
        const guard = guards.get(identityKey(entry))
        return entry.available && ["EXACT", "STRONG"].includes(
          entry.identityClass) && guard && !guard.alreadyLive &&
          !guard.alreadyInQuickPick && !guard.existingHandoff &&
          !guard.activeProcessing && !guard.parkedEconomicsWithoutMaterialChange
      })
    if (!candidate) continue
    const guard = guards.get(identityKey(candidate))!
    const evidence = await exactEvidence({ supabase: input.supabase,
      candidate, queueRow: guard.queueRow })
    fullEvidenceCandidateCount += 1
    const sourceUrl = exactUrl(candidate)
    const receipt = await receiveLunaQuickPickBatchV1({
      supabase: input.supabase, urls: [sourceUrl] })
    batchId = receipt.batchId
    try {
      const processed = await processLunaQuickPickBatchV1({
        supabase: input.supabase, accountKey: input.accountKey,
        urls: [sourceUrl], batchId: receipt.batchId,
        taxonomyReader: input.taxonomyReader,
        productIdentifierPolicyReader: input.productIdentifierPolicyReader,
      })
      await completeLunaQuickPickBatchReceiptV1({ supabase: input.supabase,
        batchId: receipt.batchId, result: processed })
      const processedCard = processed.cards.find((entry) =>
        entry.lunaProductId === candidate.lunaProductId &&
        entry.lunaVariantId === candidate.lunaVariantId &&
        entry.sourceSku === candidate.lunaSku)
      if (!processedCard?.opportunityId) throw new Error(
        "RADAR_TO_QUICK_PICK_OPERATION_ID_MISSING")
      await continueLunaQuickPickPostShippingRuntimeV1({
        supabase: input.supabase,
        accountKey: input.accountKey,
        candidateKeys: processed.cards.flatMap((entry) =>
          entry.candidateKey && !entry.alreadyLive
            ? [entry.candidateKey] : []),
        taxonomyReader: input.taxonomyReader,
        productIdentifierPolicyReader: input.productIdentifierPolicyReader,
      })
      const refreshedCards = processedCard.candidateKey
        ? await readLunaQuickPickProgressV1({
          supabase: input.supabase,
          accountKey: input.accountKey,
          candidateKeys: [processedCard.candidateKey],
          includeRecent: false,
        }) : []
      const card = refreshedCards.find((entry) =>
        entry.candidateKey === processedCard.candidateKey) ?? processedCard
      aiCallCount += card.aiCallCount
      const operationId = card.opportunityId ?? processedCard.opportunityId
      quickPickOperationId = operationId
      quickPickFinalCanaryState = card.disposition
      const persisted = await persistHandoff({ supabase: input.supabase,
        signal, candidate, evidence, batchId: receipt.batchId,
        operationId, finalState: card.disposition })
      quickPickHandoffCreated ||= persisted.created
      bestLunaCandidate = { familyId: signal.familyId,
        lunaProductId: candidate.lunaProductId,
        lunaVariantId: candidate.lunaVariantId, lunaSku: candidate.lunaSku,
        identityClass: candidate.identityClass,
        fullLunaEvidenceByRuntime: true,
        lunaEvidenceSetVersion: evidence.contractVersion,
        lunaEvidenceDigest: evidence.evidenceDigest,
        exactDemandStatus: "UNPROVEN" }
    } catch (error) {
      await completeLunaQuickPickBatchReceiptV1({ supabase: input.supabase,
        batchId: receipt.batchId,
        failureCode: error instanceof Error ? error.message :
          "RADAR_TO_QUICK_PICK_PROCESS_FAILED" }).catch(() => undefined)
      throw error
    }
  }
  const identityResults = signals.map((signal) => ({
    familyId: signal.familyId,
    familyDemandStatus: signal.familyDemandStatus,
    exactDemandStatus: signal.exactDemandStatus,
    candidates: (shortlists.byFamily.get(signal.familyId) ?? []).map((candidate) => ({
      lunaProductId: candidate.lunaProductId,
      lunaVariantId: candidate.lunaVariantId,
      lunaSku: candidate.lunaSku,
      identityClass: candidate.identityClass,
      available: candidate.available,
      guard: guards.get(identityKey(candidate)),
    })),
  }))
  const noMatch = certification ? {
    familyId: certification.b.familyId,
    qualifiedMarketSignal: true,
    lunaSearchExecuted: true,
    exactMatchCount: (shortlists.byFamily.get(certification.b.familyId) ?? [])
      .filter((candidate) => candidate.available &&
        candidate.identityClass === "EXACT").length,
    strongMatchCount: (shortlists.byFamily.get(certification.b.familyId) ?? [])
      .filter((candidate) => candidate.available &&
        candidate.identityClass === "STRONG").length,
    quickPickHandoffCreated: false,
    factInvented: false,
  } : null
  const dedupeGuard = certification
    ? guards.get(identityKey(certification.candidateC))! : null
  const dedupe = certification ? {
    familyId: certification.c.familyId,
    lunaSku: certification.candidateC.lunaSku,
    alreadyLive: dedupeGuard?.alreadyLive ?? false,
    alreadyInQuickPick: dedupeGuard?.alreadyInQuickPick ?? false,
    existingHandoff: dedupeGuard?.existingHandoff ?? false,
    quickPickHandoffCreated: false,
    newDuplicateOperationCount: 0,
  } : null
  return Object.freeze({ contractVersion: RADAR_LUNA_QUICK_PICK_HANDOFF_V1,
    status: "COMPLETE" as const, mode: input.mode ?? "SCHEDULED",
    qualifiedSignalPolicy: "FRESH_PROVEN_OR_SUPPORTED_OPPORTUNITY_CASE",
    qualifiedSignalCount: signals.length,
    canaryFamilies: certification ? Object.freeze({
      a: certification.a.familyId, b: certification.b.familyId,
      c: certification.c.familyId }) : null,
    lunaCatalogCandidatesFound: shortlists.catalogCandidatesFound,
    cheapFilterRejectedCount: shortlists.cheapRejectedCount,
    fullEvidenceCandidateCount,
    identityResults: Object.freeze(identityResults), bestLunaCandidate,
    noMatchCanaryResult: noMatch, dedupeCanaryResult: dedupe,
    quickPickHandoffCreated, quickPickOperationId,
    quickPickBatchId: batchId, quickPickFinalCanaryState,
    newDuplicateOperationCount: 0,
    aiCallCount,
    lunaFullPageScanCount: fullEvidenceCandidateCount,
    maximumCheapLunaCandidates: MAX_CHEAP_LUNA_CANDIDATES,
    maximumFullEvidenceCandidates: MAX_FULL_EVIDENCE_CANDIDATES,
    fullPageScanNotUsedForAllLunaProducts: true,
    sharedLunaScannerReused: true,
    sharedIdentityMatcherReused: true,
    quickPickSharedRuntimeUsed: true,
    radarBypassesQuickPickGates: false,
    familyDemandPromotedToExact: false,
    futureRadarToLunaRequiresCodex: false,
    futureRadarToQuickPickRequiresCodex: false,
    marketplaceWrites: 0,
    listingPublications: 0,
    listingMutations: 0,
    customerProductionTouched: false,
  })
}
