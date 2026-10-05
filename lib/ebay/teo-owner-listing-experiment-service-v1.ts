import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { getEbayCategoryLearningAccountKey } from
  "./ebay-category-performance-learning"
import { readManualListingFromTradingApi } from
  "./ebay-manual-listing-trading-readonly"
import { readCurrentLiveAuthorityV1 } from
  "./ebay-current-live-authority-v1"
import {
  assessTeoOfficialReadbackV1,
  buildTeoListingPriceDecisionV1,
  buildTeoOfficialListingSnapshotV1,
  evaluateTeoExperimentOutcomeV1,
  recommendTeoListingActionV1,
  TEO_OWNER_LISTING_EXPERIMENT_VERSION,
  TEO_VERIFIABLE_LISTING_VARIABLES,
  type TeoOfficialListingSnapshotV1,
  type TeoPerformanceEvidenceV1,
  type TeoListingRecommendationV1,
  type TeoVerifiableListingVariableV1,
} from "./teo-owner-listing-experiment-v1"

type JsonRecord = Record<string, unknown>

const ACTIVE_STATES = [
  "READY",
  "RUNNING",
  "WAITING_FOR_EVIDENCE",
  "READY_TO_EVALUATE",
  "PAUSED_FOR_EXTERNAL_SIGNAL",
] as const

const EXPERIMENT_SELECT = [
  "experiment_id",
  "account_key",
  "marketplace",
  "ebay_item_id",
  "ebay_sku",
  "hypothesis",
  "diagnosis_class",
  "experiment_type",
  "variable_changed",
  "changed_at",
  "baseline_evidence_ref",
  "lifecycle_status",
  "frozen_variables",
  "minimum_observation_duration_hours",
  "minimum_evidence_metric",
  "minimum_evidence_value",
  "current_evidence_value",
  "next_review_condition",
  "next_review_at",
  "outcome",
  "learning_reference",
  "workflow_kind",
  "owner_execution_status",
  "owner_confirmed_at",
  "owner_confirmed_by",
  "owner_confirmation_note",
  "readback_status",
  "readback_attempted_at",
  "readback_verified_at",
  "baseline_listing_snapshot",
  "readback_listing_snapshot",
  "attribution_status",
  "result_evaluated_at",
  "created_at",
  "updated_at",
].join(",")

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function nonEmptyRecord(value: unknown) {
  const parsed = record(value)
  return Object.keys(parsed).length ? parsed : null
}

function ownBuyerShippingFromRawPayload(value: unknown) {
  const raw = record(value)
  const optionsValue = raw.shippingOptions ?? raw.shipping_options
  const options = Array.isArray(optionsValue) ? optionsValue.map(record) : []
  const firstCost = record(options[0]?.shippingCost ??
    options[0]?.shipping_cost)
  return number(firstCost.value ?? raw.shippingCost ?? raw.shipping_cost)
}

function competitorPriceEvidence(row: JsonRecord | undefined) {
  const evidence = record(row?.evidence)
  const confirmed = nonEmptyRecord(evidence.confirmedSoldPriceRecommendation)
  const active = nonEmptyRecord(evidence.activeMarketPriceRecommendation)
  const recommendation = confirmed ?? active
  if (!recommendation) return {
    currentItemPrice: null,
    buyerShipping: null,
    competitiveLandedPrice: null,
    persistedStandardFloorLandedPrice: null,
    competitiveEvidence: "UNAVAILABLE" as const,
    observedAt: null,
    confidence: null,
  }
  const currentItemPrice = number(recommendation.currentItemPrice)
  const currentLandedPrice = number(recommendation.currentLandedPrice)
  return {
    currentItemPrice,
    buyerShipping: currentItemPrice !== null && currentLandedPrice !== null
      ? Math.max(0, currentLandedPrice - currentItemPrice)
      : null,
    competitiveLandedPrice: number(confirmed
      ? recommendation.confirmedSoldBenchmarkLandedPrice
      : recommendation.activeMarketMedianLandedPrice),
    persistedStandardFloorLandedPrice:
      number(recommendation.standardMinimumSafeLandedPrice) ??
      number(recommendation.minimumSafeLandedPrice),
    competitiveEvidence: confirmed
      ? "CONFIRMED_SOLD" as const : "ACTIVE_MARKET" as const,
    observedAt: text(row?.detected_at),
    confidence: text(recommendation.confidence),
  }
}

function priceAwareRecommendation(
  recommendation: TeoListingRecommendationV1,
  pricing: JsonRecord | null,
): TeoListingRecommendationV1 {
  if (recommendation.variable !== "PRICE") return recommendation
  const current = number(pricing?.currentItemPrice)
  const proposed = number(pricing?.recommendedFinalItemPrice)
  const priceAction = text(pricing?.action)
  const executable = text(pricing?.status) === "READY" &&
    current !== null && proposed !== null && Math.abs(current - proposed) >= 0.01 &&
    ((priceAction === "LOWER_PRICE" && pricing?.safeToDiscount === true) ||
      priceAction === "RAISE_TO_SAFE_FLOOR")
  if (!executable) return {
    action: "WAIT",
    priority: "LOW",
    diagnosisClass: "DATA_QUALITY",
    variable: null,
    headline: "Completar el precio rentable antes de editar",
    rationale: "Hay tráfico sin conversión, pero TEO todavía no puede demostrar un precio nuevo que proteja la rentabilidad.",
    hypothesis: null,
    metric: null,
    minimumEvidenceValue: null,
    reasonCode: "PRICE_DECISION_EVIDENCE_REQUIRED",
  }
  const lowering = proposed < current
  return {
    ...recommendation,
    headline: lowering
      ? `Probar precio final de US$${proposed.toFixed(2)}`
      : `Corregir precio al piso seguro de US$${proposed.toFixed(2)}`,
    rationale: lowering
      ? `TEO calculó un descuento seguro de US$${(current - proposed).toFixed(2)} sin bajar de las guardas de rentabilidad.`
      : "El precio actual está debajo del piso rentable calculado con costos probados.",
    hypothesis: lowering
      ? `Bajar únicamente el precio del artículo de US$${current.toFixed(2)} a US$${proposed.toFixed(2)} aumentará las transacciones sin romper la rentabilidad.`
      : `Subir únicamente el precio del artículo de US$${current.toFixed(2)} a US$${proposed.toFixed(2)} restablecerá la rentabilidad mínima.`,
  }
}

function isVariable(value: unknown): value is TeoVerifiableListingVariableV1 {
  return typeof value === "string" &&
    (TEO_VERIFIABLE_LISTING_VARIABLES as readonly string[]).includes(value)
}

function performanceFromRow(row: JsonRecord): TeoPerformanceEvidenceV1 | null {
  const reportDateFrom = text(row.report_date_from)
  const reportDateTo = text(row.report_date_to)
  const observedAt = text(row.observed_at)
  const totalImpressions = number(row.total_impressions)
  if (!reportDateFrom || !reportDateTo || !observedAt ||
      totalImpressions === null) return null
  return {
    reportDateFrom,
    reportDateTo,
    totalImpressions,
    searchImpressions: number(row.search_impressions),
    totalViews: number(row.total_views),
    searchViews: number(row.search_views),
    transactions: number(row.transactions),
    observedAt,
  }
}

function officialSnapshotFromReadback(
  listing: Awaited<ReturnType<typeof readManualListingFromTradingApi>>,
) {
  return buildTeoOfficialListingSnapshotV1({
    title: listing.title,
    price: listing.price,
    currency: listing.currency,
    categoryId: listing.safeDefaults.categoryId ?? null,
    conditionId: listing.safeDefaults.conditionId ?? null,
    shippingPrice: listing.buyerShippingCharge,
    shippingCurrency: listing.buyerShippingCurrency,
    listingStatus: listing.listingStatus,
    sku: listing.ebaySku,
    observedAt: listing.observedAt,
  })
}

function officialSnapshotFromStored(value: unknown) {
  const source = record(value)
  const observedAt = text(source.observedAt)
  if (!observedAt) return null
  return buildTeoOfficialListingSnapshotV1({
    title: text(source.title),
    price: number(source.price),
    currency: text(source.currency),
    categoryId: text(source.categoryId),
    conditionId: text(source.conditionId),
    shippingPrice: number(source.shippingPrice),
    shippingCurrency: text(source.shippingCurrency),
    listingStatus: text(source.listingStatus),
    sku: text(source.sku),
    observedAt,
  })
}

function eventFingerprint(input: {
  experimentId: string
  eventType: string
  occurredAt: string
  evidence: JsonRecord
}) {
  return createHash("sha256").update(JSON.stringify([
    input.experimentId,
    input.eventType,
    input.occurredAt,
    input.evidence,
  ])).digest("hex")
}

async function appendEvent(
  supabase: SupabaseClient,
  input: {
    experimentId: string
    accountKey: string
    ebayItemId: string
    eventType: string
    actorRole: "TEO" | "OWNER" | "SYSTEM"
    actorUserId?: string | null
    occurredAt: string
    evidence?: JsonRecord
  },
) {
  const evidence = input.evidence ?? {}
  const row = {
    experiment_id: input.experimentId,
    account_key: input.accountKey,
    ebay_item_id: input.ebayItemId,
    event_type: input.eventType,
    actor_role: input.actorRole,
    actor_user_id: input.actorUserId ?? null,
    occurred_at: input.occurredAt,
    evidence,
    event_fingerprint: eventFingerprint({
      experimentId: input.experimentId,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      evidence,
    }),
  }
  const { error } = await supabase
    .from("ebay_listing_experiment_events_v1")
    .upsert(row, { onConflict: "event_fingerprint", ignoreDuplicates: true })
  if (error) throw new Error("TEO_EXPERIMENT_EVENT_WRITE_FAILED")
}

async function verifiedLink(
  supabase: SupabaseClient,
  accountKey: string,
  ebayItemId: string,
) {
  const { data, error } = await supabase
    .from("ebay_manual_listing_links")
    .select("id,ebay_item_id,connector_ebay_sku,connector_listing_status,verification_status,last_verification_at")
    .eq("account_key", accountKey)
    .eq("marketplace_id", "EBAY_US")
    .eq("ebay_item_id", ebayItemId)
    .eq("verification_status", "verified")
    .maybeSingle()
  if (error) throw new Error("TEO_VERIFIED_LISTING_READ_FAILED")
  if (!data) throw new Error("TEO_VERIFIED_OWN_LISTING_REQUIRED")
  return data as JsonRecord
}

async function latestPerformance(
  supabase: SupabaseClient,
  accountKey: string,
  ebayItemId: string,
) {
  const { data, error } = await supabase
    .from("ebay_listing_performance_snapshots")
    .select("report_date_from,report_date_to,total_impressions,search_impressions,total_views,search_views,transactions,observed_at")
    .eq("account_key", accountKey)
    .eq("marketplace_id", "EBAY_US")
    .eq("ebay_item_id", ebayItemId)
    .order("observed_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error("TEO_PERFORMANCE_BASELINE_READ_FAILED")
  return performanceFromRow(record(data))
}

function baselinePerformanceFromExperiment(experiment: JsonRecord) {
  const baseline = record(experiment.baseline_evidence_ref)
  const teo = record(baseline.teoOwnerManual)
  return performanceFromRow({
    ...record(teo.baselinePerformance),
    report_date_from: record(teo.baselinePerformance).reportDateFrom,
    report_date_to: record(teo.baselinePerformance).reportDateTo,
    total_impressions: record(teo.baselinePerformance).totalImpressions,
    search_impressions: record(teo.baselinePerformance).searchImpressions,
    total_views: record(teo.baselinePerformance).totalViews,
    search_views: record(teo.baselinePerformance).searchViews,
    transactions: record(teo.baselinePerformance).transactions,
    observed_at: record(teo.baselinePerformance).observedAt,
  })
}

function publicExperiment(row: JsonRecord) {
  return {
    experimentId: text(row.experiment_id),
    ebayItemId: text(row.ebay_item_id),
    sku: text(row.ebay_sku),
    hypothesis: text(row.hypothesis),
    diagnosisClass: text(row.diagnosis_class),
    variableChanged: text(row.variable_changed),
    lifecycleStatus: text(row.lifecycle_status),
    ownerExecutionStatus: text(row.owner_execution_status),
    ownerConfirmedAt: text(row.owner_confirmed_at),
    readbackStatus: text(row.readback_status),
    readbackAttemptedAt: text(row.readback_attempted_at),
    readbackVerifiedAt: text(row.readback_verified_at),
    attributionStatus: text(row.attribution_status),
    nextReviewAt: text(row.next_review_at),
    outcome: record(row.outcome),
    resultEvaluatedAt: text(row.result_evaluated_at),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  }
}

export async function loadTeoOwnerListingDashboardV1(
  supabase: SupabaseClient,
) {
  const accountKey = getEbayCategoryLearningAccountKey()
  const [
    linksRead,
    experimentsRead,
    snapshotsRead,
    eventsRead,
    economicsRead,
    competitorEventsRead,
    activeListingsRead,
    currentLiveAuthority,
  ] =
    await Promise.all([
      supabase.from("ebay_manual_listing_links")
        .select("id,ebay_item_id,connector_ebay_sku,connector_listing_status,verification_status,verified_at,last_verification_at")
        .eq("account_key", accountKey)
        .eq("marketplace_id", "EBAY_US")
        .eq("verification_status", "verified")
        .order("verified_at", { ascending: false })
        .limit(500),
      supabase.from("ebay_listing_experiments_v1")
        .select(EXPERIMENT_SELECT)
        .eq("account_key", accountKey)
        .eq("marketplace", "EBAY_US")
        .order("updated_at", { ascending: false })
        .limit(1_000),
      supabase.from("ebay_listing_performance_snapshots")
        .select("ebay_item_id,report_date_from,report_date_to,total_impressions,search_impressions,total_views,search_views,transactions,observed_at")
        .eq("account_key", accountKey)
        .eq("marketplace_id", "EBAY_US")
        .order("observed_at", { ascending: false })
        .limit(5_000),
      supabase.from("ebay_listing_experiment_events_v1")
        .select("event_id,experiment_id,ebay_item_id,event_type,actor_role,occurred_at,evidence")
        .eq("account_key", accountKey)
        .order("occurred_at", { ascending: false })
        .limit(200),
      supabase.from("seller_os_live_economics_readbacks_v1")
        .select("ebay_item_id,status,live_price,luna_cost,luna_shipping,other_explicit_costs,expected_profit,margin_percent,roi_percent,missing_economic_inputs,calculated_at")
        .eq("marketplace_account_key", accountKey)
        .eq("marketplace_id", "EBAY_US")
        .order("calculated_at", { ascending: false })
        .limit(2_000),
      supabase.from("commercial_alert_events")
        .select("listing_id,event_type,evidence,detected_at")
        .eq("marketplace_account_key", accountKey)
        .eq("marketplace", "EBAY_US")
        .in("event_type", [
          "COMPETITOR_CONFIRMED_SOLD_PRICE_RECOMMENDATION",
          "COMPETITOR_ACTIVE_MARKET_PRICE_RECOMMENDATION",
        ])
        .order("detected_at", { ascending: false })
        .limit(2_000),
      supabase.from("ebay_active_listings")
        .select("ebay_item_id,ebay_price,currency,raw_payload,last_ebay_sync_at,updated_at")
        .eq("account_key", accountKey)
        .order("updated_at", { ascending: false })
        .limit(2_000),
      readCurrentLiveAuthorityV1({ supabase, accountKey })
        .catch(() => null),
    ])
  if (linksRead.error) throw new Error("TEO_VERIFIED_LISTING_READ_FAILED")
  if (experimentsRead.error) throw new Error("TEO_EXPERIMENT_REGISTRY_READ_FAILED")
  if (snapshotsRead.error) throw new Error("TEO_PERFORMANCE_HISTORY_READ_FAILED")
  if (eventsRead.error) throw new Error("TEO_EXPERIMENT_MEMORY_READ_FAILED")

  const latestEconomicsByItem = new Map<string, JsonRecord>()
  if (!economicsRead.error) {
    for (const row of (economicsRead.data ?? []).map(record)) {
      const itemId = text(row.ebay_item_id)
      if (itemId && !latestEconomicsByItem.has(itemId)) {
        latestEconomicsByItem.set(itemId, row)
      }
    }
  }
  const latestCompetitorEventByItem = new Map<string, JsonRecord>()
  if (!competitorEventsRead.error) {
    for (const row of (competitorEventsRead.data ?? []).map(record)) {
      const itemId = text(row.listing_id)
      if (itemId && !latestCompetitorEventByItem.has(itemId)) {
        latestCompetitorEventByItem.set(itemId, row)
      }
    }
  }
  const latestActiveListingByItem = new Map<string, JsonRecord>()
  if (!activeListingsRead.error) {
    for (const row of (activeListingsRead.data ?? []).map(record)) {
      const itemId = text(row.ebay_item_id)
      if (itemId && !latestActiveListingByItem.has(itemId)) {
        latestActiveListingByItem.set(itemId, row)
      }
    }
  }

  const pricingByItem = new Map<string, JsonRecord>()
  for (const link of (linksRead.data ?? []).map(record)) {
    const itemId = text(link.ebay_item_id)
    if (!itemId) continue
    const economics = latestEconomicsByItem.get(itemId)
    const activeListing = latestActiveListingByItem.get(itemId)
    const competitorEvent = latestCompetitorEventByItem.get(itemId)
    const competition = competitorPriceEvidence(competitorEvent)
    const currentItemPrice = competition.currentItemPrice ??
      number(economics?.live_price) ?? number(activeListing?.ebay_price)
    const buyerShipping = competition.buyerShipping ??
      ownBuyerShippingFromRawPayload(activeListing?.raw_payload)
    const decision = buildTeoListingPriceDecisionV1({
      currentItemPrice,
      currentBuyerShipping: buyerShipping,
      supplierCost: economics?.luna_cost,
      supplierShipping: economics?.luna_shipping,
      otherExplicitCosts: economics?.other_explicit_costs,
      currentExpectedNetProfit: economics?.expected_profit,
      economicsProven: text(economics?.status) === "PROVEN",
      competitiveLandedPrice: competition.competitiveLandedPrice,
      competitiveEvidence: competition.competitiveEvidence,
      persistedStandardFloorLandedPrice:
        competition.persistedStandardFloorLandedPrice,
      returnsReserveRate: 0.04,
    })
    pricingByItem.set(itemId, {
      ebayItemId: itemId,
      sku: text(link.connector_ebay_sku),
      currency: text(activeListing?.currency) ?? "USD",
      ...decision,
      competitorConfidence: competition.confidence,
      competitorObservedAt: competition.observedAt,
      economicsStatus: text(economics?.status) ?? "UNAVAILABLE",
      economicsCalculatedAt: text(economics?.calculated_at),
      missingEconomicInputs: Array.isArray(economics?.missing_economic_inputs)
        ? economics.missing_economic_inputs : [],
      livePriceObservedAt: text(activeListing?.last_ebay_sync_at) ??
        text(activeListing?.updated_at),
    })
  }

  const experiments = (experimentsRead.data ?? []).map(record)
  const teoExperiments = experiments.filter((row) =>
    text(row.workflow_kind) === "TEO_OWNER_MANUAL")
  const activeByItem = new Map<string, JsonRecord>()
  for (const experiment of experiments) {
    const itemId = text(experiment.ebay_item_id)
    if (itemId && ACTIVE_STATES.includes(
      text(experiment.lifecycle_status) as typeof ACTIVE_STATES[number],
    ) && !activeByItem.has(itemId)) activeByItem.set(itemId, experiment)
  }
  const performanceHistory = new Map<string, TeoPerformanceEvidenceV1[]>()
  for (const row of (snapshotsRead.data ?? []).map(record)) {
    const itemId = text(row.ebay_item_id)
    const performance = performanceFromRow(row)
    if (!itemId || !performance) continue
    const history = performanceHistory.get(itemId) ?? []
    history.push(performance)
    performanceHistory.set(itemId, history)
  }

  const todayActions: JsonRecord[] = []
  const protectedListings: JsonRecord[] = []
  const replacementCandidates: JsonRecord[] = []
  const recommendations: JsonRecord[] = []
  for (const link of (linksRead.data ?? []).map(record)) {
    const itemId = text(link.ebay_item_id)
    if (!itemId) continue
    const pricing = pricingByItem.get(itemId) ?? null
    const active = activeByItem.get(itemId)
    if (active) {
      const workflowKind = text(active.workflow_kind)
      const ownerStatus = text(active.owner_execution_status)
      const readbackStatus = text(active.readback_status)
      if (workflowKind !== "TEO_OWNER_MANUAL") {
        protectedListings.push({
          ebayItemId: itemId,
          pricing,
          reason: "ANOTHER_EXPERIMENT_IS_ACTIVE",
          instruction: "No tocar hasta cerrar el experimento activo.",
        })
      } else if (ownerStatus === "AWAITING_OWNER") {
        const exactPrice = number(pricing?.recommendedFinalItemPrice)
        const variable = text(active.variable_changed)
        todayActions.push({
          priority: 1,
          action: "OWNER_EXECUTE_AND_CONFIRM",
          ebayItemId: itemId,
          pricing,
          experiment: publicExperiment(active),
          instruction: variable === "PRICE" && exactPrice !== null
            ? `Cambiar sólo el precio del artículo a US$${exactPrice.toFixed(2)} directamente en eBay y confirmar aquí.`
            : `Cambiar sólo ${variable ?? "la variable indicada"} directamente en eBay y confirmar aquí.`,
        })
      } else if (readbackStatus !== "VERIFIED_ON_EBAY") {
        todayActions.push({
          priority: 2,
          action: "RETRY_OFFICIAL_READBACK",
          ebayItemId: itemId,
          pricing,
          experiment: publicExperiment(active),
          instruction: "TEO debe volver a comprobar el cambio en eBay.",
        })
      } else {
        protectedListings.push({
          ebayItemId: itemId,
          pricing,
          reason: "EXPERIMENT_OBSERVATION_WINDOW_ACTIVE",
          instruction: "No tocar mientras TEO mide el resultado.",
          nextReviewAt: text(active.next_review_at),
          experiment: publicExperiment(active),
        })
      }
      continue
    }
    const history = performanceHistory.get(itemId) ?? []
    const negativeExperiments = teoExperiments.filter((experiment) =>
      text(experiment.ebay_item_id) === itemId &&
      text(record(experiment.outcome).result) === "NEGATIVE" &&
      text(experiment.attribution_status) === "CLEAN_SINGLE_VARIABLE").length
    const consecutiveZeroImpressionWindows = history
      .slice(0, 2)
      .filter((entry) => entry.totalImpressions === 0).length
    const recommendation = priceAwareRecommendation(
      recommendTeoListingActionV1({
      listingStatus: text(link.connector_listing_status),
      performance: history[0] ?? null,
      consecutiveZeroImpressionWindows,
      completedNegativeExperiments: negativeExperiments,
      }),
      pricing,
    )
    const row = {
      ebayItemId: itemId,
      sku: text(link.connector_ebay_sku),
      recommendation,
      performance: history[0] ?? null,
      pricing,
    }
    if (recommendation.action === "REPLACE_CANDIDATE") {
      replacementCandidates.push(row)
    } else if (recommendation.action === "IMPROVE") {
      recommendations.push(row)
      todayActions.push({
        priority: 3,
        action: "START_ONE_VARIABLE_EXPERIMENT",
        ...row,
        instruction: "Abrir un experimento antes de editar eBay.",
      })
    } else {
      protectedListings.push({
        ebayItemId: itemId,
        pricing,
        reason: recommendation.reasonCode,
        instruction: recommendation.headline,
      })
    }
  }

  const memory = teoExperiments
    .filter((row) => ["COMPLETED", "INCONCLUSIVE", "CANCELLED"]
      .includes(text(row.lifecycle_status) ?? ""))
    .map(publicExperiment)
  return {
    contractVersion: TEO_OWNER_LISTING_EXPERIMENT_VERSION,
    generatedAt: new Date().toISOString(),
    policy: {
      ebayWriteUsed: false,
      ownerExecutesInEbay: true,
      ownerConfirmationEqualsVerification: false,
      oneVariableAtATime: true,
      mayelIncluded: false,
    },
    liveCoverage: currentLiveAuthority,
    summary: {
      verifiedListings: linksRead.data?.length ?? 0,
      actionsToday: todayActions.length,
      protectedListings: protectedListings.length,
      activeExperiments: teoExperiments.filter((row) =>
        ACTIVE_STATES.includes(
          text(row.lifecycle_status) as typeof ACTIVE_STATES[number],
        )).length,
      replacementCandidates: replacementCandidates.length,
      learnedResults: memory.length,
      pricingReady: [...pricingByItem.values()].filter((row) =>
        text(row.status) === "READY").length,
      discountOpportunities: [...pricingByItem.values()].filter((row) =>
        row.safeToDiscount === true).length,
    },
    todayActions: todayActions.sort((a, b) =>
      (number(a.priority) ?? 99) - (number(b.priority) ?? 99)),
    protectedListings,
    replacementCandidates,
    recommendations,
    pricing: [...pricingByItem.values()].sort((a, b) => {
      if (a.safeToDiscount === true && b.safeToDiscount !== true) return -1
      if (a.safeToDiscount !== true && b.safeToDiscount === true) return 1
      return (number(b.suggestedDiscountUsd) ?? 0) -
        (number(a.suggestedDiscountUsd) ?? 0)
    }),
    pricingSourceStatus: {
      liveEconomics: economicsRead.error ? "UNAVAILABLE" : "AVAILABLE",
      competition: competitorEventsRead.error ? "UNAVAILABLE" : "AVAILABLE",
      activeListings: activeListingsRead.error ? "UNAVAILABLE" : "AVAILABLE",
    },
    experiments: teoExperiments.map(publicExperiment),
    memory,
    timeline: (eventsRead.data ?? []).map((row) => ({
      eventId: row.event_id,
      experimentId: row.experiment_id,
      ebayItemId: row.ebay_item_id,
      eventType: row.event_type,
      actorRole: row.actor_role,
      occurredAt: row.occurred_at,
      evidence: row.evidence,
    })),
  }
}

export async function startTeoOwnerListingExperimentV1(
  supabase: SupabaseClient,
  input: { ebayItemId: string },
) {
  if (!/^\d{9,20}$/.test(input.ebayItemId)) {
    throw new Error("TEO_EBAY_ITEM_ID_INVALID")
  }
  const accountKey = getEbayCategoryLearningAccountKey()
  const link = await verifiedLink(supabase, accountKey, input.ebayItemId)
  const { data: existing, error: existingError } = await supabase
    .from("ebay_listing_experiments_v1")
    .select(EXPERIMENT_SELECT)
    .eq("account_key", accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("ebay_item_id", input.ebayItemId)
    .in("lifecycle_status", [...ACTIVE_STATES])
    .limit(1)
    .maybeSingle()
  if (existingError) throw new Error("TEO_EXPERIMENT_REGISTRY_READ_FAILED")
  if (existing) throw new Error("TEO_LISTING_ALREADY_HAS_ACTIVE_EXPERIMENT")

  const baselinePerformance = await latestPerformance(
    supabase,
    accountKey,
    input.ebayItemId,
  )
  const baseRecommendation = recommendTeoListingActionV1({
    listingStatus: text(link.connector_listing_status),
    performance: baselinePerformance,
  })
  let pricing: JsonRecord | null = null
  if (baseRecommendation.variable === "PRICE") {
    const dashboard = await loadTeoOwnerListingDashboardV1(supabase)
    pricing = dashboard.pricing.find((row) =>
      text(row.ebayItemId) === input.ebayItemId) ?? null
  }
  const recommendation = priceAwareRecommendation(baseRecommendation, pricing)
  if (baseRecommendation.variable === "PRICE" &&
      recommendation.variable !== "PRICE") {
    throw new Error("TEO_PRICE_DECISION_EVIDENCE_REQUIRED")
  }
  if (recommendation.action !== "IMPROVE" || !recommendation.variable ||
      !recommendation.hypothesis || !recommendation.metric ||
      recommendation.minimumEvidenceValue === null) {
    throw new Error("TEO_ACTIONABLE_IMPROVEMENT_NOT_PROVEN")
  }
  const official = await readManualListingFromTradingApi(input.ebayItemId)
  if (official.ownership !== "verified") {
    throw new Error("TEO_OFFICIAL_ACTIVE_OWNERSHIP_REQUIRED")
  }
  const baselineListingSnapshot = officialSnapshotFromReadback(official)
  const now = new Date().toISOString()
  const experimentId = randomUUID()
  const frozenVariables = TEO_VERIFIABLE_LISTING_VARIABLES
    .filter((variable) => variable !== recommendation.variable)
  const { data, error } = await supabase
    .from("ebay_listing_experiments_v1")
    .insert({
      experiment_id: experimentId,
      account_key: accountKey,
      marketplace: "EBAY_US",
      ebay_item_id: input.ebayItemId,
      ebay_sku: official.ebaySku,
      hypothesis: recommendation.hypothesis,
      diagnosis_class: recommendation.diagnosisClass,
      experiment_type: "TEO_OWNER_MANUAL_SINGLE_VARIABLE",
      variable_changed: recommendation.variable,
      changed_at: now,
      baseline_evidence_ref: {
        teoOwnerManual: {
          contractVersion: TEO_OWNER_LISTING_EXPERIMENT_VERSION,
          recommendationReasonCode: recommendation.reasonCode,
          priceDecision: recommendation.variable === "PRICE" ? pricing : null,
          baselinePerformance,
          baselineCapturedAt: now,
        },
      },
      lifecycle_status: "READY",
      frozen_variables: frozenVariables,
      minimum_observation_duration_hours: 336,
      minimum_evidence_metric: recommendation.metric,
      minimum_evidence_value: recommendation.minimumEvidenceValue,
      current_evidence_value: null,
      next_review_condition: "OWNER_EXECUTES_ONE_VARIABLE_IN_EBAY",
      next_review_at: null,
      outcome: null,
      learning_reference: null,
      workflow_kind: "TEO_OWNER_MANUAL",
      owner_execution_status: "AWAITING_OWNER",
      readback_status: "AWAITING_OWNER",
      baseline_listing_snapshot: baselineListingSnapshot,
      attribution_status: "UNASSESSED",
    })
    .select(EXPERIMENT_SELECT)
    .single()
  if (error || !data) throw new Error("TEO_EXPERIMENT_CREATE_FAILED")
  await appendEvent(supabase, {
    experimentId,
    accountKey,
    ebayItemId: input.ebayItemId,
    eventType: "RECOMMENDED",
    actorRole: "TEO",
    occurredAt: now,
    evidence: {
      variable: recommendation.variable,
      reasonCode: recommendation.reasonCode,
      officialBaselineCaptured: true,
      priceDecision: recommendation.variable === "PRICE" ? pricing : null,
      ebayWriteUsed: false,
    },
  })
  return publicExperiment(record(data))
}

async function loadTeoExperiment(
  supabase: SupabaseClient,
  accountKey: string,
  experimentId: string,
) {
  const { data, error } = await supabase
    .from("ebay_listing_experiments_v1")
    .select(EXPERIMENT_SELECT)
    .eq("experiment_id", experimentId)
    .eq("account_key", accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("workflow_kind", "TEO_OWNER_MANUAL")
    .maybeSingle()
  if (error) throw new Error("TEO_EXPERIMENT_REGISTRY_READ_FAILED")
  if (!data) throw new Error("TEO_EXPERIMENT_NOT_FOUND")
  return record(data)
}

export async function verifyTeoOwnerListingExperimentV1(
  supabase: SupabaseClient,
  input: { experimentId: string; actorRole?: "OWNER" | "SYSTEM" },
) {
  const accountKey = getEbayCategoryLearningAccountKey()
  const experiment = await loadTeoExperiment(
    supabase,
    accountKey,
    input.experimentId,
  )
  if (text(experiment.owner_execution_status) !== "CONFIRMED_BY_OWNER") {
    throw new Error("TEO_OWNER_CONFIRMATION_REQUIRED")
  }
  const itemId = text(experiment.ebay_item_id)
  const variable = text(experiment.variable_changed)
  const baseline = officialSnapshotFromStored(
    experiment.baseline_listing_snapshot,
  )
  if (!itemId || !isVariable(variable) || !baseline) {
    throw new Error("TEO_EXPERIMENT_BASELINE_INVALID")
  }
  let official: Awaited<ReturnType<typeof readManualListingFromTradingApi>>
  try {
    official = await readManualListingFromTradingApi(itemId)
  } catch (error) {
    const attemptedAt = new Date().toISOString()
    const errorCode = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "TEO_OFFICIAL_READBACK_FAILED"
    const { error: updateError } = await supabase
      .from("ebay_listing_experiments_v1")
      .update({
        readback_status: "READBACK_FAILED",
        readback_attempted_at: attemptedAt,
        updated_at: attemptedAt,
        next_review_condition: "RETRY_OFFICIAL_EBAY_READBACK",
      })
      .eq("experiment_id", input.experimentId)
      .eq("account_key", accountKey)
    if (updateError) throw new Error("TEO_EXPERIMENT_UPDATE_FAILED")
    await appendEvent(supabase, {
      experimentId: input.experimentId,
      accountKey,
      ebayItemId: itemId,
      eventType: "READBACK_FAILED",
      actorRole: input.actorRole ?? "SYSTEM",
      occurredAt: attemptedAt,
      evidence: { errorCode, ebayWriteUsed: false },
    })
    return { status: "READBACK_FAILED" as const, errorCode }
  }
  const observed = officialSnapshotFromReadback(official)
  const baselineEvidence = record(experiment.baseline_evidence_ref)
  const teoBaseline = record(baselineEvidence.teoOwnerManual)
  const priceDecision = record(teoBaseline.priceDecision)
  const assessment = assessTeoOfficialReadbackV1({
    targetVariable: variable,
    baseline,
    observed,
    expectedPrice: variable === "PRICE"
      ? number(priceDecision.recommendedFinalItemPrice) : null,
  })
  const contaminated = assessment.attributionStatus ===
    "CONTAMINATED_MULTIPLE_VARIABLES"
  const lifecycleStatus = contaminated
    ? "INCONCLUSIVE"
    : assessment.readbackStatus === "VERIFIED_ON_EBAY"
      ? "WAITING_FOR_EVIDENCE"
      : "RUNNING"
  const confirmedAt = text(experiment.owner_confirmed_at) ??
    new Date().toISOString()
  const nextReviewAt = assessment.readbackStatus === "VERIFIED_ON_EBAY" &&
      !contaminated
    ? new Date(Date.parse(confirmedAt) + 336 * 3_600_000).toISOString()
    : null
  const outcome = contaminated ? {
    result: "INCONCLUSIVE",
    reasonCode: "MULTIPLE_VARIABLES_CHANGED",
    changedVariables: assessment.changedVariables,
    evaluatedAt: observed.observedAt,
  } : experiment.outcome ?? null
  const { data, error } = await supabase
    .from("ebay_listing_experiments_v1")
    .update({
      readback_status: assessment.readbackStatus,
      readback_attempted_at: observed.observedAt,
      readback_verified_at: assessment.readbackStatus === "VERIFIED_ON_EBAY"
        ? observed.observedAt
        : null,
      readback_listing_snapshot: observed,
      attribution_status: assessment.attributionStatus,
      lifecycle_status: lifecycleStatus,
      next_review_condition: contaminated
        ? "CONTAMINATED_RESTART_WITH_ONE_VARIABLE"
        : assessment.readbackStatus === "VERIFIED_ON_EBAY"
          ? "WAIT_FOR_COMPLETE_POST_CHANGE_ANALYTICS_WINDOW"
          : "RETRY_OFFICIAL_EBAY_READBACK",
      next_review_at: nextReviewAt,
      outcome,
      result_evaluated_at: contaminated ? observed.observedAt : null,
      updated_at: observed.observedAt,
    })
    .eq("experiment_id", input.experimentId)
    .eq("account_key", accountKey)
    .select(EXPERIMENT_SELECT)
    .single()
  if (error || !data) throw new Error("TEO_EXPERIMENT_UPDATE_FAILED")
  await appendEvent(supabase, {
    experimentId: input.experimentId,
    accountKey,
    ebayItemId: itemId,
    eventType: contaminated
      ? "READBACK_CONTAMINATED"
      : assessment.readbackStatus === "VERIFIED_ON_EBAY"
        ? "READBACK_VERIFIED"
        : "READBACK_PENDING",
    actorRole: input.actorRole ?? "SYSTEM",
    occurredAt: observed.observedAt,
    evidence: {
      reasonCode: assessment.reasonCode,
      targetVariable: variable,
      changedVariables: assessment.changedVariables,
      ebayWriteUsed: false,
    },
  })
  return {
    status: assessment.readbackStatus,
    assessment,
    experiment: publicExperiment(record(data)),
  }
}

export async function confirmTeoOwnerListingExperimentV1(
  supabase: SupabaseClient,
  input: { experimentId: string; ownerUserId: string; note?: string },
) {
  const accountKey = getEbayCategoryLearningAccountKey()
  const experiment = await loadTeoExperiment(
    supabase,
    accountKey,
    input.experimentId,
  )
  const itemId = text(experiment.ebay_item_id)
  if (!itemId) throw new Error("TEO_EXPERIMENT_ITEM_ID_INVALID")
  let confirmedAt = text(experiment.owner_confirmed_at)
  if (text(experiment.owner_execution_status) !== "CONFIRMED_BY_OWNER") {
    confirmedAt = new Date().toISOString()
    const note = input.note?.trim().slice(0, 500) || null
    const { error } = await supabase
      .from("ebay_listing_experiments_v1")
      .update({
        owner_execution_status: "CONFIRMED_BY_OWNER",
        owner_confirmed_at: confirmedAt,
        owner_confirmed_by: input.ownerUserId,
        owner_confirmation_note: note,
        readback_status: "PENDING_READBACK",
        changed_at: confirmedAt,
        lifecycle_status: "RUNNING",
        next_review_condition: "VERIFY_OFFICIAL_EBAY_READBACK",
        updated_at: confirmedAt,
      })
      .eq("experiment_id", input.experimentId)
      .eq("account_key", accountKey)
    if (error) throw new Error("TEO_OWNER_CONFIRMATION_WRITE_FAILED")
    await appendEvent(supabase, {
      experimentId: input.experimentId,
      accountKey,
      ebayItemId: itemId,
      eventType: "OWNER_CONFIRMED",
      actorRole: "OWNER",
      actorUserId: input.ownerUserId,
      occurredAt: confirmedAt,
      evidence: {
        variable: text(experiment.variable_changed),
        noteRecorded: Boolean(note),
        verificationPending: true,
      },
    })
  }
  return verifyTeoOwnerListingExperimentV1(supabase, {
    experimentId: input.experimentId,
    actorRole: "OWNER",
  })
}

export async function evaluateTeoOwnerListingExperimentV1(
  supabase: SupabaseClient,
  input: { experimentId: string },
) {
  const accountKey = getEbayCategoryLearningAccountKey()
  const experiment = await loadTeoExperiment(
    supabase,
    accountKey,
    input.experimentId,
  )
  const itemId = text(experiment.ebay_item_id)
  const variable = text(experiment.variable_changed)
  const baseline = baselinePerformanceFromExperiment(experiment)
  const changedAt = text(experiment.changed_at)
  if (!itemId || !isVariable(variable) || !baseline || !changedAt) {
    throw new Error("TEO_EXPERIMENT_PERFORMANCE_BASELINE_INVALID")
  }
  if (text(experiment.readback_status) !== "VERIFIED_ON_EBAY") {
    throw new Error("TEO_OFFICIAL_READBACK_REQUIRED")
  }
  if (text(experiment.attribution_status) !== "CLEAN_SINGLE_VARIABLE") {
    throw new Error("TEO_CLEAN_ATTRIBUTION_REQUIRED")
  }
  const completePostChangeDay = changedAt.slice(0, 10)
  const { data, error } = await supabase
    .from("ebay_listing_performance_snapshots")
    .select("report_date_from,report_date_to,total_impressions,search_impressions,total_views,search_views,transactions,observed_at")
    .eq("account_key", accountKey)
    .eq("marketplace_id", "EBAY_US")
    .eq("ebay_item_id", itemId)
    .gte("report_date_from", completePostChangeDay)
    .order("report_date_to", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error("TEO_POST_CHANGE_PERFORMANCE_READ_FAILED")
  const current = performanceFromRow(record(data))
  if (!current) return {
    status: "WAITING_FOR_COMPLETE_POST_CHANGE_WINDOW" as const,
    nextReviewAt: text(experiment.next_review_at),
  }
  const outcome = evaluateTeoExperimentOutcomeV1({
    variable,
    baseline,
    current,
    attributionStatus: "CLEAN_SINGLE_VARIABLE",
  })
  const evaluatedAt = new Date().toISOString()
  const lifecycleStatus = outcome.result === "INCONCLUSIVE"
    ? "INCONCLUSIVE"
    : "COMPLETED"
  const { data: updated, error: updateError } = await supabase
    .from("ebay_listing_experiments_v1")
    .update({
      lifecycle_status: lifecycleStatus,
      current_evidence_value: outcome.currentValue,
      outcome: {
        ...outcome,
        baselineWindow: {
          dateFrom: baseline.reportDateFrom,
          dateTo: baseline.reportDateTo,
        },
        currentWindow: {
          dateFrom: current.reportDateFrom,
          dateTo: current.reportDateTo,
        },
        evidenceState: "COMPARABLE_CORRELATIONAL",
        causalProofClaimed: false,
        evaluatedAt,
      },
      learning_reference: `TEO:${variable}:${outcome.result}`,
      result_evaluated_at: evaluatedAt,
      next_review_condition: "EXPERIMENT_COMPLETE",
      next_review_at: null,
      updated_at: evaluatedAt,
    })
    .eq("experiment_id", input.experimentId)
    .eq("account_key", accountKey)
    .select(EXPERIMENT_SELECT)
    .single()
  if (updateError || !updated) throw new Error("TEO_EXPERIMENT_RESULT_WRITE_FAILED")
  await appendEvent(supabase, {
    experimentId: input.experimentId,
    accountKey,
    ebayItemId: itemId,
    eventType: "RESULT_EVALUATED",
    actorRole: "TEO",
    occurredAt: evaluatedAt,
    evidence: {
      result: outcome.result,
      metric: outcome.metric,
      delta: outcome.delta,
      causalProofClaimed: false,
    },
  })
  return {
    status: "EVALUATED" as const,
    outcome,
    experiment: publicExperiment(record(updated)),
  }
}

export async function refreshTeoOwnerListingExperimentsV1(
  supabase: SupabaseClient,
  options: { maximumExperiments?: number } = {},
) {
  const accountKey = getEbayCategoryLearningAccountKey()
  const maximum = Math.max(1, Math.min(20,
    Math.floor(options.maximumExperiments ?? 5)))
  const { data, error } = await supabase
    .from("ebay_listing_experiments_v1")
    .select(EXPERIMENT_SELECT)
    .eq("account_key", accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("workflow_kind", "TEO_OWNER_MANUAL")
    .eq("owner_execution_status", "CONFIRMED_BY_OWNER")
    .in("lifecycle_status", ["RUNNING", "WAITING_FOR_EVIDENCE", "READY_TO_EVALUATE"])
    .order("updated_at", { ascending: true })
    .limit(maximum)
  if (error) throw new Error("TEO_EXPERIMENT_REGISTRY_READ_FAILED")
  const results: JsonRecord[] = []
  for (const row of (data ?? []).map(record)) {
    const experimentId = text(row.experiment_id)
    if (!experimentId) continue
    try {
      if (text(row.readback_status) !== "VERIFIED_ON_EBAY") {
        results.push(record(await verifyTeoOwnerListingExperimentV1(
          supabase,
          { experimentId },
        )))
      } else {
        results.push(record(await evaluateTeoOwnerListingExperimentV1(
          supabase,
          { experimentId },
        )))
      }
    } catch (error) {
      results.push({
        experimentId,
        status: "ERROR",
        error: error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
          ? error.message
          : "TEO_EXPERIMENT_REFRESH_FAILED",
      })
    }
  }
  return {
    processed: results.length,
    results,
    ebayWriteUsed: false as const,
  }
}
