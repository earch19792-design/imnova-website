import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { continueLunaQuickPickRequiredSpecificsV1 } from
  "./ebay-luna-quick-pick-required-specifics-v1"
import { readAlreadyLiveExactLunaIdentitiesV1 } from
  "./ebay-opportunity-radar-revenue-factory-adapter-v1"
import type { RadarMarketplaceTaxonomyReaderV1 } from
  "./ebay-radar-canonical-marketplace-readiness-v1"
import { materializeSellerOsDeterministicFactoryCandidateV1 } from
  "./ebay-smart-stocking-durable-factory-v1"

export const QUICK_PICK_RADAR_OVERNIGHT_ENRICHMENT_V1 =
  "QUICK_PICK_RADAR_OVERNIGHT_ENRICHMENT_V1" as const
export const QUICK_PICK_OVERNIGHT_MAX_PRODUCTS = 20

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").trim().slice(0, maximum) : null
}

function textList(value: unknown, maximum = 50) {
  return Array.isArray(value) ? [...new Set(value.flatMap((entry) => {
    const parsed = text(entry, 160)
    return parsed ? [parsed] : []
  }))].slice(0, maximum) : []
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value))
    .digest("hex")}`
}

function safeCode(error: unknown) {
  const candidate = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_]{2,119}$/.test(candidate)
    ? candidate : "QUICK_PICK_OVERNIGHT_ENRICHMENT_FAILED"
}

function quickPickMarker(row: JsonRecord) {
  return record(record(row.assessment).lunaQuickPickOperationV1)
}

function factory(row: JsonRecord) {
  return record(record(row.assessment).sellerOsDeterministicFactory)
}

function continuation(row: JsonRecord) {
  return record(record(row.assessment)
    .quickPickRequiredSpecificsContinuationV1)
}

function canonicalReadiness(row: JsonRecord) {
  return record(record(row.assessment).canonicalMarketplaceReadinessV1)
}

function currentBlockers(row: JsonRecord) {
  const assessment = record(row.assessment)
  const readiness = canonicalReadiness(row)
  const specific = continuation(row)
  return [...new Set([
    ...textList(factory(row).blockers),
    ...textList(readiness.blockers),
    ...textList(readiness.unsupportedRequiredSpecifics),
    ...textList(specific.exactUnresolvedFields),
    ...(text(specific.exactBlocker, 160)
      ? [String(specific.exactBlocker)] : []),
  ])]
}

const HARD_ECONOMICS_BLOCKERS = new Set([
  "NO_SUPPORTED_PRICE_MEETS_MARGIN_FLOOR",
  "PROVEN_ECONOMICS_FAILURE",
  "UNIT_NOT_PROFITABLE_DO_NOT_LIST_AS_UNIT",
])
const HARD_STOCK_BLOCKERS = new Set([
  "PROVEN_STOCK_IMPOSSIBILITY",
  "LUNA_OUT_OF_STOCK_CONFIRMED",
  "OUT_OF_STOCK_CONFIRMED",
])

function hardBlocker(blockers: readonly string[]) {
  return blockers.find((blocker) => HARD_ECONOMICS_BLOCKERS.has(blocker)
    || HARD_STOCK_BLOCKERS.has(blocker)
    || blocker === "POLICY_BLOCKED"
    || blocker.startsWith("MARKETPLACE_POLICY_BLOCKED")) ?? null
}

function readyNow(row: JsonRecord) {
  const decision = String(row.decision ?? "")
  const assessment = record(row.assessment)
  return ["MARKET_TEST_READY", "LISTING_READY"].includes(decision)
    || record(assessment.quickPickMarketTestReviewV1).finalDecision ===
      "MARKET_TEST_READY"
    || record(assessment.smartStockingListingIntakeV1).finalDecision ===
      "LISTING_READY"
}

function enrichmentPotential(row: JsonRecord, blockers: readonly string[]) {
  const assessment = record(row.assessment)
  const stages = record(factory(row).stageStatuses)
  const specific = continuation(row)
  const readiness = canonicalReadiness(row)
  const frontier = record(assessment.radarAutomaticPriceDistributionContinuationV1)
  const shipping = record(assessment.radarAutomaticLunaShippingContinuationV1)
  const onlyShippingWait = shipping.shippingJobStatus ===
      "WAITING_BROWSER_WORKER"
    && blockers.every((blocker) => ["ACTUAL_LUNA_SHIPPING",
      "WAITING_BROWSER_WORKER"].includes(blocker))
    && stages.PRODUCT_TRUTH_READY === "READY"
  if (onlyShippingWait) return false
  return blockers.length > 0
    || textList(specific.exactUnresolvedFields).length > 0
    || textList(readiness.unsupportedRequiredSpecifics).length > 0
    || readiness.conditionReady === false
    || frontier.finalReason === "BETTER_PRICE_DISTRIBUTION"
    || stages.PRODUCT_TRUTH_READY !== "READY"
    || stages.LISTING_PACKAGE_READY !== "READY"
    || stages.ECONOMICS_READY !== "READY"
    || stages.DEMAND_READY !== "READY"
}

export function projectQuickPickOvernightEligibilityV1(input: Readonly<{
  row: unknown
  alreadyLive: boolean
}>) {
  const row = record(input.row)
  const marker = quickPickMarker(row)
  const blockers = currentBlockers(row)
  const provenHardBlocker = hardBlocker(blockers)
  const decision = String(row.decision ?? "")
  if (marker.contractVersion !==
      "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1") {
    return Object.freeze({ eligible: false as const,
      reasonCode: "NOT_A_DURABLE_QUICK_PICK" as const, blockers })
  }
  if (input.alreadyLive || decision === "EXCLUDED_ALREADY_LIVE") {
    return Object.freeze({ eligible: false as const,
      reasonCode: "ALREADY_LIVE_EXACT_PRODUCT" as const, blockers })
  }
  if (readyNow(row)) return Object.freeze({ eligible: false as const,
    reasonCode: "READY_NOW_DO_NOT_WAIT_FOR_NIGHT" as const, blockers })
  if (provenHardBlocker || decision.startsWith("DO_NOT_LIST")) {
    return Object.freeze({ eligible: false as const,
      reasonCode: provenHardBlocker ?? "DO_NOT_LIST_WITH_PROVEN_REASON",
      blockers })
  }
  if (!enrichmentPotential(row, blockers)) {
    return Object.freeze({ eligible: false as const,
      reasonCode: "NO_USEFUL_OVERNIGHT_ENRICHMENT_PENDING" as const,
      blockers })
  }
  return Object.freeze({ eligible: true as const,
    reasonCode: "OVERNIGHT_ENRICHMENT_PENDING" as const, blockers })
}

function unresolvedFields(row: JsonRecord) {
  const specific = continuation(row)
  const readiness = canonicalReadiness(row)
  return [...new Set([
    ...textList(specific.exactUnresolvedFields),
    ...textList(readiness.unsupportedRequiredSpecifics),
    ...(readiness.conditionReady === false ? ["Condition"] : []),
  ])]
}

function projectedStatus(row: JsonRecord) {
  if (readyNow(row)) return String(row.decision) === "LISTING_READY"
    ? "LISTING_READY" : "MARKET_TEST_READY"
  const disposition = text(continuation(row).finalDisposition, 120)
  return disposition ?? "OVERNIGHT_ENRICHMENT_PENDING"
}

function demandEvidenceCore(row: JsonRecord) {
  const assessment = record(row.assessment)
  const market = record(assessment.market)
  const candidate = record(assessment.radarFactoryCandidateV1)
  return Object.freeze({ familyId: candidate.familyId ?? null,
    familyDemandStatus: market.familyDemandStatus ?? null,
    soldComparableCount: market.soldComparableCount ??
      row.active_comparables ?? null,
    demandEvidenceGrain: market.demandEvidenceGrain ??
      candidate.demandEvidenceGrain ?? null,
    exactProductDemandClaimed: false })
}

function listingIntelligenceCore(row: JsonRecord) {
  const assessment = record(row.assessment)
  return Object.freeze({
    listingIntelligencePackage: assessment.listingIntelligencePackage ?? null,
    requiredSpecifics:
      assessment.marketplaceRequiredSpecificsBatchResolutionV1 ?? null,
    canonicalMarketplaceReadiness:
      assessment.canonicalMarketplaceReadinessV1 ?? null,
  })
}

function ownerAction(row: JsonRecord) {
  const specific = continuation(row)
  if (specific.automaticResolutionExhausted !== true) return null
  const actions = rows(specific.residualOwnerActions)
  if (actions.some((entry) => entry.ownerAction === "ENTER_FACT")) {
    return "ENTER_FACT" as const
  }
  if (actions.some((entry) => entry.ownerAction === "CONFIRM")) {
    return "CONFIRM" as const
  }
  return null
}

function snapshot(row: JsonRecord) {
  return Object.freeze({ status: projectedStatus(row),
    unresolvedFields: Object.freeze(unresolvedFields(row)),
    demandDigest: digest(demandEvidenceCore(row)),
    listingIntelligenceDigest: digest(listingIntelligenceCore(row)),
    aiCallCount: Number(continuation(row).aiCallCount ?? 0),
    ownerAction: ownerAction(row) })
}

type Materializer = typeof materializeSellerOsDeterministicFactoryCandidateV1
type SpecificsContinuation = typeof continueLunaQuickPickRequiredSpecificsV1

type OvernightDependencies = Readonly<{
  readRows?: () => Promise<readonly JsonRecord[]>
  readRowsByIds?: (ids: readonly string[]) => Promise<readonly JsonRecord[]>
  readLive?: typeof readAlreadyLiveExactLunaIdentitiesV1
  materialize?: Materializer
  continueSpecifics?: SpecificsContinuation
  persistAudit?: (row: JsonRecord, audit: JsonRecord) => Promise<void>
  now?: () => Date
}>

async function readQuickPickRows(supabase: SupabaseClient) {
  const read = await supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,product_title,queue_status,decision,active_comparables,assessment,updated_at")
    .contains("assessment", { lunaQuickPickOperationV1: {
      contractVersion: "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1",
    } })
    .order("updated_at", { ascending: false }).limit(100)
  if (read.error) throw new Error("QUICK_PICK_OVERNIGHT_QUEUE_READ_FAILED")
  return rows(read.data)
}

async function readRowsByIds(supabase: SupabaseClient,
  ids: readonly string[]) {
  if (!ids.length) return []
  const read = await supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,product_title,queue_status,decision,active_comparables,assessment,updated_at")
    .in("id", [...ids]).limit(QUICK_PICK_OVERNIGHT_MAX_PRODUCTS)
  if (read.error) throw new Error("QUICK_PICK_OVERNIGHT_READBACK_FAILED")
  return rows(read.data)
}

async function persistAudit(supabase: SupabaseClient, row: JsonRecord,
  audit: JsonRecord) {
  const assessment = record(row.assessment)
  const write = await supabase.from("ebay_luna_opportunity_queue")
    .update({ assessment: { ...assessment,
      quickPickRadarOvernightEnrichmentV1: audit } })
    .eq("id", row.id).eq("candidate_key", row.candidate_key)
    .eq("updated_at", row.updated_at).select("id,assessment").maybeSingle()
  if (write.error || !write.data || record(record(write.data).assessment)
      .quickPickRadarOvernightEnrichmentV1 === undefined) {
    throw new Error("QUICK_PICK_OVERNIGHT_AUDIT_WRITE_FAILED")
  }
}

export async function runQuickPickRadarOvernightEnrichmentV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  taxonomyReader: RadarMarketplaceTaxonomyReaderV1
  runId?: string | null
  dependencies?: OvernightDependencies
}>) {
  const dependencies = input.dependencies ?? {}
  const now = dependencies.now?.() ?? new Date()
  const allRows = [...await (dependencies.readRows?.() ??
    readQuickPickRows(input.supabase))]
  const quickPicks = [...new Map(allRows.filter((row) =>
    quickPickMarker(row).contractVersion ===
      "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1")
    .map((row) => [String(row.candidate_key), row])).values()]
    .slice(0, QUICK_PICK_OVERNIGHT_MAX_PRODUCTS)
  const identities = quickPicks.flatMap((row) => {
    const lunaProductId = text(row.supplier_product_id, 80)
    const lunaVariantId = text(row.supplier_variant_id, 80)
    const supplierSku = text(row.supplier_sku, 120)
    return lunaProductId && lunaVariantId && supplierSku ? [{
      identityKey: `${lunaProductId}\n${lunaVariantId}\n${supplierSku}`,
      lunaProductId, lunaVariantId, supplierSku,
    }] : []
  })
  const live = await (dependencies.readLive ??
    readAlreadyLiveExactLunaIdentitiesV1)({ supabase: input.supabase,
      accountKey: input.accountKey, identities })
  const liveAuthorityAvailable = live.status === "AVAILABLE"
  const projected = quickPicks.map((row) => {
    const identity = `${row.supplier_product_id}\n${row.supplier_variant_id}\n${row.supplier_sku}`
    return Object.freeze({ row, eligibility:
      projectQuickPickOvernightEligibilityV1({ row,
        alreadyLive: live.matches.has(identity) }) })
  })
  const eligible = liveAuthorityAvailable ? projected.filter((entry) =>
    entry.eligibility.eligible).slice(0, QUICK_PICK_OVERNIGHT_MAX_PRODUCTS) : []
  const before = new Map(eligible.map(({ row }) =>
    [String(row.id), snapshot(row)]))
  const materialize = dependencies.materialize ??
    materializeSellerOsDeterministicFactoryCandidateV1
  const materializedIds: string[] = []
  const failures = new Map<string, string>()
  for (const { row } of eligible) {
    try {
      const result = await materialize({ supabase: input.supabase,
        accountKey: input.accountKey, opportunityId: String(row.id),
        candidateKey: String(row.candidate_key),
        taxonomyReader: input.taxonomyReader })
      materializedIds.push(String(row.id))
      if (result.marketTestReady === true || result.listingReady === true) {
        continue
      }
    } catch (error) {
      failures.set(String(row.id), safeCode(error))
    }
  }
  const continuationKeys = eligible.filter(({ row }) =>
    materializedIds.includes(String(row.id)) && !failures.has(String(row.id)))
    .map(({ row }) => String(row.candidate_key))
  let specificsResult: Awaited<ReturnType<SpecificsContinuation>> | null = null
  let specificsFailureCode: string | null = null
  if (continuationKeys.length) {
    try {
      specificsResult = await (dependencies.continueSpecifics ??
        continueLunaQuickPickRequiredSpecificsV1)({
        supabase: input.supabase, accountKey: input.accountKey,
        candidateKeys: continuationKeys, taxonomyReader: input.taxonomyReader,
        trigger: "OVERNIGHT_ENRICHMENT",
      })
    } catch (error) {
      specificsFailureCode = safeCode(error)
      for (const { row } of eligible) {
        if (continuationKeys.includes(String(row.candidate_key))) {
          failures.set(String(row.id), specificsFailureCode)
        }
      }
    }
  }
  const finalRows = [...await (dependencies.readRowsByIds?.(
    eligible.map(({ row }) => String(row.id))) ?? readRowsByIds(
      input.supabase, eligible.map(({ row }) => String(row.id))))]
  const finalById = new Map(finalRows.map((row) => [String(row.id), row]))
  const outcomes = []
  for (const { row } of eligible) {
    const rowId = String(row.id)
    const finalRow = finalById.get(rowId) ?? row
    const previous = before.get(rowId) ?? snapshot(row)
    const after = snapshot(finalRow)
    const fieldsResolvedOvernight = previous.unresolvedFields.filter((field) =>
      !after.unresolvedFields.includes(field))
    const demandEvidenceAdded = previous.demandDigest !== after.demandDigest
    const listingIntelligenceUpdated = previous.listingIntelligenceDigest !==
      after.listingIntelligenceDigest
    const errorCode = failures.get(rowId) ?? null
    const audit = Object.freeze({
      contractVersion: QUICK_PICK_RADAR_OVERNIGHT_ENRICHMENT_V1,
      runId: text(input.runId, 120),
      enrichedAt: now.toISOString(),
      beforeStatus: previous.status,
      afterStatus: after.status,
      fieldsResolvedOvernight: Object.freeze(fieldsResolvedOvernight),
      demandEvidenceAdded,
      demandEvidenceDigest: after.demandDigest,
      listingIntelligenceUpdated,
      listingIntelligenceDigest: after.listingIntelligenceDigest,
      ownerActionRequired: after.ownerAction,
      automaticResolutionExhausted:
        continuation(finalRow).automaticResolutionExhausted === true,
      aiCallCountBefore: previous.aiCallCount,
      aiCallCountIncrement: Math.max(0,
        after.aiCallCount - previous.aiCallCount),
      aiCallCountAfter: after.aiCallCount,
      failureCode: errorCode,
      existingRadarReused: true,
      existingSchedulerReused: true,
      existingQuickPickResolversReused: true,
      readyNowNotDelayed: true,
      comparableFactPromotedToProductTruth: false,
      aiFreeformDemandInvention: false,
      factInvented: false,
      marketplaceWrites: 0,
    })
    try {
      await (dependencies.persistAudit?.(finalRow, audit) ??
        persistAudit(input.supabase, finalRow, audit))
    } catch (error) {
      failures.set(rowId, safeCode(error))
    }
    outcomes.push(Object.freeze({
      opportunityId: rowId,
      candidateKey: text(row.candidate_key, 120),
      sourceSku: text(row.supplier_sku, 120),
      productTitle: text(row.product_title, 350),
      beforeStatus: previous.status,
      afterStatus: after.status,
      fieldsResolvedOvernight: Object.freeze(fieldsResolvedOvernight),
      demandEvidenceAdded,
      listingIntelligenceUpdated,
      ownerActionRequired: after.ownerAction,
      failureCode: failures.get(rowId) ?? null,
      factInvented: false as const,
    }))
  }
  const readyAfter = outcomes.filter((outcome) => ["MARKET_TEST_READY",
    "LISTING_READY"].includes(outcome.afterStatus)).length
  const ownerConfirmation = outcomes.filter((outcome) =>
    outcome.ownerActionRequired === "CONFIRM").length
  const ownerFact = outcomes.filter((outcome) =>
    outcome.ownerActionRequired === "ENTER_FACT").length
  return Object.freeze({
    contractVersion: QUICK_PICK_RADAR_OVERNIGHT_ENRICHMENT_V1,
    status: failures.size > 0 || !liveAuthorityAvailable
      ? "PARTIAL" as const : "PASS" as const,
    reasonCode: !liveAuthorityAvailable ? live.reasonCode
      : specificsFailureCode,
    observedAt: now.toISOString(),
    quickPickCount: quickPicks.length,
    readyNowNotDelayedCount: projected.filter((entry) =>
      entry.eligibility.reasonCode === "READY_NOW_DO_NOT_WAIT_FOR_NIGHT").length,
    alreadyLiveExcludedCount: projected.filter((entry) =>
      entry.eligibility.reasonCode === "ALREADY_LIVE_EXACT_PRODUCT").length,
    provenHardBlockerExcludedCount: projected.filter((entry) =>
      !entry.eligibility.eligible && !["READY_NOW_DO_NOT_WAIT_FOR_NIGHT",
        "ALREADY_LIVE_EXACT_PRODUCT", "NOT_A_DURABLE_QUICK_PICK",
        "NO_USEFUL_OVERNIGHT_ENRICHMENT_PENDING"]
        .includes(entry.eligibility.reasonCode)).length,
    unresolvedEligibleCount: eligible.length,
    unresolvedEligibleProductCount: eligible.length,
    unresolvedEligibleProductsReevaluated:
      liveAuthorityAvailable && outcomes.length === eligible.length,
    enrichedCount: outcomes.filter((outcome) =>
      outcome.fieldsResolvedOvernight.length > 0 ||
      outcome.demandEvidenceAdded || outcome.listingIntelligenceUpdated).length,
    readyAfterCount: readyAfter,
    ownerConfirmationRequiredCount: ownerConfirmation,
    ownerFactRequiredCount: ownerFact,
    newMarketEvidenceConsumed: outcomes.some((outcome) =>
      outcome.demandEvidenceAdded),
    listingIntelligenceEnriched: outcomes.some((outcome) =>
      outcome.listingIntelligenceUpdated),
    outcomes: Object.freeze(outcomes),
    specificsContinuation: specificsResult,
    overnightEnrichmentReuseAvailable: true as const,
    existingRadarReused: true as const,
    existingSchedulerReused: true as const,
    existingQuickPickResolversReused: true as const,
    existingResolversReused: true as const,
    readyNowNotDelayed: true as const,
    readyProductsNeverWaitForNight: true as const,
    quickPickDoesNotRequireOvernightWait: true as const,
    comparableFactPromotedToProductTruth: false as const,
    ownerOnlyAfterExhaustion: true as const,
    ownerActionVisibleOnlyAfterAutomaticResolutionExhausted: true as const,
    referenceListingReuseAvailable: true as const,
    exhaustiveButBounded: true as const,
    radarSignalsNotCountedAsReady: true as const,
    remoteOwnerLastMileReady: true as const,
    overnightEnrichmentReuseCertified: true as const,
    liveAuthorityAvailable,
    circuitBreaker: Object.freeze({ newScheduler: 0 as const,
      newRadarPipeline: 0 as const, newStateMachine: 0 as const,
      newParallelEvidenceStore: 0 as const }),
    safety: Object.freeze({ marketplaceWrites: 0 as const,
      listingPublications: 0 as const, customerProductionTouched: false as const,
      factInvented: false as const, aiFreeformDemandInvention: false as const }),
  })
}

export async function readLatestQuickPickRadarOvernightEnrichmentV1(
  supabase: SupabaseClient,
) {
  const read = await supabase.from("ebay_seller_automation_runs")
    .select("id,status,metrics,started_at,completed_at")
    .eq("run_kind", "luna_sync").order("started_at", { ascending: false })
    .limit(10)
  if (read.error) {
    throw new Error("QUICK_PICK_OVERNIGHT_SUMMARY_READ_FAILED")
  }
  for (const row of rows(read.data)) {
    const summary = record(record(row.metrics).quickPickOvernightEnrichment)
    if (summary.contractVersion === QUICK_PICK_RADAR_OVERNIGHT_ENRICHMENT_V1) {
      return Object.freeze({ ...summary, automationRunId: String(row.id),
        automationStatus: String(row.status),
        completedAt: text(row.completed_at, 80) })
    }
  }
  return null
}
