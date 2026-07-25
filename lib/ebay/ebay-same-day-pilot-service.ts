import { createHash, randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildSameDayLocalPreparationPackage,
  canStartNextSameDayCandidateCycle,
  evaluateSameDayCandidate,
  resolveSameDayCommercialEvidenceMode,
  SAME_DAY_QUEUE_LIMIT,
  SAME_DAY_MAX_CANDIDATE_CYCLES,
  SAME_DAY_PILOT_VERSION,
  SAME_DAY_RECONCILIATION_COVERAGE_ROW_LIMIT,
  SAME_DAY_RECONCILIATION_DECISION_REFERENCE_LIMIT,
  SAME_DAY_TRADING_DETAIL_READ_LIMIT_PER_BATCH,
  isValidSameDayLunaConfirmation,
  isSameDayCandidateBatchSettled,
  listingQuantityFromLuna,
  selectSameDayQueue,
  type SameDayCandidateInput,
} from "./ebay-same-day-pilot-domain"
import { calculateEbayMinimumOperatorPrice, calculateEbayUnitEconomics } from "./ebay-unit-economics"
import {
  controlledRiskEconomicsConfig,
  EBAY_CONTROLLED_RISK_OVERRIDE_VERSION,
  evaluateControlledRiskManualOverride,
} from "./ebay-controlled-risk-manual-override"
import { ebayDraftOnlyEconomicsConfig } from "./ebay-draft-only-readiness"
import { preflightEbayDraftOnlyMobile } from "./ebay-draft-only-gateway"
import {
  PRODUCT_FACTS_ENGINE_VERSION,
  runProductFactsEnrichment,
} from "./ebay-product-facts-enrichment"
import {
  buildEbayMarketPricingRecommendation,
  EBAY_MARKET_PRICING_STRATEGY_VERSION,
} from "./ebay-market-pricing-strategy"
import { selectApplicableSafeListingDefaults } from "./ebay-manual-listing-service"
import { readManualListingFromTradingApi } from "./ebay-manual-listing-trading-readonly"
import { ebayConditionContractFromVerifiedFact } from "./ebay-manual-listing-domain"
import { isAllowedLunaProductUrl } from "../marketplace/fulfillment-v1a-domain"
import {
  normalizeEbayCompliantFulfillmentBasis,
  type EbayCompliantFulfillmentBasis,
} from "./ebay-fulfillment-policy-compliance"
import { bindCurrentAuthoritativeFactsForManualHandoff, buildVerifiedManualSellerHubHandoff,
  SAME_DAY_MANUAL_HANDOFF_VERSION } from "./ebay-same-day-manual-handoff"
import {
  assertEbayLaneAvailable,
  recordPersistentEbayRateLimit,
  releaseExpiredEbayQuotaPauses,
} from "./ebay-persistent-quota-coordinator"
import { projectEffectiveEbayQuotaLane } from "./ebay-quota-lane-domain"
import {
  PRODUCT_RESEARCH_IDENTITY_RECONCILIATION_VERSION,
  reconcileProductResearchObservations,
} from "./ebay-product-research-identity-reconciliation"
import {
  PRODUCT_RESEARCH_VISUAL_PATTERN_ALGORITHM_VERSION,
  PRODUCT_RESEARCH_VISUAL_PATTERN_SCHEMA_VERSION,
  VISUAL_MARKET_BRIEF_VERSION,
} from "./ebay-product-research-visual-pattern"
import {
  isEbayImageMarketBriefUsable,
  loadEbayImageMarketBrief,
} from "./ebay-image-market-brief"
import {
  markProductResearchQueryCaptured,
  productResearchPlannedQueryHash,
  productResearchQueriesMatch,
  skipProductResearchQuery,
} from "./ebay-product-research-query-plan"
import { enqueueListingAiTop20Continuation } from "./ebay-listing-ai-top20-queue"
import { getEbayReadonlyRateLimitMetadata } from "./ebay-readonly-rate-limit"
import {
  evaluatePackDiscountScenarios,
  rankRelatedPackStrategies,
} from "./luna-fulfillment-pricing"
import { extractLunaOfficialDescriptionIdentity } from "./luna-official-description-identity"
import { loadBoundAuthoritativeFactPackage } from "./ebay-authoritative-fact-package"
import { confirmListingAiQueueLunaObservation } from "./ebay-listing-ai-approval-queue-service"
import {
  generateAndPersistSameDayImagePackage,
  reviewSameDayImagePackage,
} from "./ebay-same-day-image-package-runtime"
import { buildCurrentSameDayImageFactoryInput } from
  "./ebay-same-day-image-factory-input"
import {
  buildSameDayImageGenerationJobSpec,
  isSameDayImagePreparationOrphan,
  SAME_DAY_IMAGE_ORPHAN_RECOVERY_VERSION,
  SAME_DAY_IMAGE_VISUAL_STRATEGY_RECOVERY_VERSION,
} from "./ebay-same-day-image-job-lineage"
import { reviewedOfficialManufacturerIdentity } from "./ebay-official-manufacturer-facts"

const MARKETPLACE = "EBAY_US"
const SINGLE_FACT_EXCEPTION_VERSION = "SAME_DAY_SINGLE_FACT_EXCEPTION_V3_2026_07_21"
const OPERATOR_CONFIRMABLE_OFFICIAL_LABEL_FACTS: Record<string, { factKey: string; label: string }> = {
  brand: { factKey: "brand", label: "Marca (Brand)" },
  color: { factKey: "color", label: "Color" },
  type: { factKey: "type", label: "Tipo de producto (Type)" },
  style: { factKey: "style", label: "Estilo (Style)" },
  mpn: { factKey: "mpn", label: "Número de parte del fabricante (MPN)" },
  "item length": { factKey: "itemLength", label: "Largo del producto (Item Length)" },
  "item width": { factKey: "itemWidth", label: "Ancho del producto (Item Width)" },
}
function operatorConfirmableOfficialLabelFact(aspectNameValue: unknown) {
  const aspectName = text(aspectNameValue, 100).normalize("NFKC").replace(/\s+/g, " ")
  const configured = OPERATOR_CONFIRMABLE_OFFICIAL_LABEL_FACTS[
    aspectName.toLocaleLowerCase()
  ]
  if (configured) return configured
  // Taxonomy can introduce category-specific mandatory aspects at any time.
  // A server-originated aspect may enter the final manual lane, but its value
  // must still be copied from the exact official label/page and is rechecked
  // against Taxonomy before publication.
  if (!aspectName || /[\p{C}]/u.test(aspectName)) return null
  return { factKey: aspectName, label: `${aspectName} (obligatorio eBay)` }
}
const PRODUCT_FACT_AUTHORITY_LINEAGE_RECOVERY_VERSION =
  "PRODUCT_FACT_AUTHORITY_AND_SOURCE_RECOVERY_V3_2026_07_21"
const LEGACY_PRODUCT_FACTS_RECOVERY_VERSION = "LEGACY_PRODUCT_FACTS_RECOVERY_V2_2026_07_19"
const STALE_DECISION_FACTS_RECOVERY_VERSION = "STALE_DECISION_FACTS_RECOVERY_V1_2026_07_19"
const STALE_SUPPLY_OPENAI_INPUT_RECOVERY_VERSION =
  "STALE_SUPPLY_OPENAI_INPUT_RECOVERY_V1_2026_07_25"
const PRE_FACTS_DECISION_REFRESH_VERSION = "PRE_FACTS_DECISION_REFRESH_V1_2026_07_21"
const OFFICIAL_BRAND_MARKET_PRICING_RECOVERY_VERSION =
  "OFFICIAL_BRAND_MARKET_PRICING_RECOVERY_V3_2026_07_21"
const PREMATURE_TAXONOMY_REJECTION_RECOVERY_VERSION =
  "PREMATURE_TAXONOMY_REJECTION_RECOVERY_V1_2026_07_21"
const SAME_DAY_LUNA_DECISION_REFRESH_VERSION = "SAME_DAY_LUNA_DECISION_REFRESH_V1_2026_07_19"
const SAME_DAY_REPLENISHMENT_VERSION = "SAME_RUN_REPLENISHMENT_V1_2026_07_20"
const VISUAL_MARKET_RECAPTURE_RECOVERY_VERSION =
  "VISUAL_MARKET_RECAPTURE_RECOVERY_V1_2026_07_23"
const QUERY_FAMILY_VISUAL_BRIEF_RECOVERY_VERSION =
  "QUERY_FAMILY_VISUAL_BRIEF_RECOVERY_V1_2026_07_23"
const RETIRED_V6_IMAGE_APPROVAL_ERROR =
  "SAME_DAY_IMAGE_V6_EXACT_SIX_REQUIRED"
const V9_EXACT_SEVEN_SQL_GATE_RECOVERY_REASON =
  "V9_EXACT_SEVEN_SQL_GATE_RECOVERED"
const VISUAL_MARKET_RECAPTURE_LIMIT_REASON =
  "MARKET_VISUAL_EVIDENCE_NOT_ACTIONABLE_AFTER_RECAPTURE"
const VISUAL_MARKET_RECAPTURE_ERROR_CODES = new Set([
  "MARKET_VISUAL_SIGNALS_INSUFFICIENT",
  "SAME_DAY_IMAGE_MARKET_BRIEF_REQUIRED",
])
const VISUAL_MARKET_BACKGROUND_RECAPTURE_ERROR_CODES = new Set([
  "MARKET_VISUAL_SIGNALS_INSUFFICIENT",
])
const VISUAL_MARKET_RECAPTURE_UNBOUND_CANDIDATE_CODES = new Set([
  "SAME_DAY_PILOT_VISUAL_RECAPTURE_CAPTURE_BINDING_MISSING",
  "SAME_DAY_PILOT_VISUAL_RECAPTURE_PLAN_BINDING_MISSING",
  "SAME_DAY_PILOT_VISUAL_RECAPTURE_QUERY_TASK_MISSING",
])
const SAME_DAY_MAX_TOTAL_CANDIDATE_ATTEMPTS =
  SAME_DAY_QUEUE_LIMIT * SAME_DAY_MAX_CANDIDATE_CYCLES
const LEGACY_PRODUCT_FACTS_REJECTION_REASONS = new Set([
  "PRODUCT_FACT_MARKETPLACE_PRODUCT_FACT_SOURCE_SNAPSHOTS_PERSIST_FAILED",
  "SHIPPING_CONFIRMED_REQUIRED",
  "EBAY_TAXONOMY_NOT_READY",
])
const PRODUCT_FACT_READ_DEPENDENCIES = [
  ["OAUTH", "APPLICATION_TOKEN"],
  ["BROWSE", "QUOTA_PRECHECK"],
  ["BROWSE", "SEARCH"],
  ["BROWSE", "ITEM_DETAIL"],
  ["CATALOG", "PRODUCT_SUMMARY_SEARCH"],
  ["TAXONOMY", "DEFAULT_CATEGORY_TREE"],
  ["TAXONOMY", "CATEGORY_SUGGESTIONS"],
  ["TAXONOMY", "CATEGORY_ASPECTS"],
  ["TRADING", "OAUTH_REFRESH"],
  ["TRADING", "GETUSER"],
  ["TRADING", "GETITEM"],
] as const
type JsonRecord = Record<string, unknown>
type PilotJobSpec = {
  jobType: string
  idempotencyKey: string
  checkpoint?: JsonRecord
  availableAt?: string
  maxAttempts?: number
  apiFamily?: string | null
  apiOperation?: string | null
  ownerLane?: string | null
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}
}
function text(value: unknown, limit = 500) {
  return typeof value === "string" ? value.trim().slice(0, limit) : ""
}
function officialLabelFactText(value: unknown) {
  const normalized = text(value, 250).normalize("NFKC").replace(/\s+/g, " ")
  return /^[\p{L}\p{N}][\p{L}\p{N}\s&'’().,+\-/#:;]{0,249}$/u.test(normalized)
    ? normalized : ""
}
function explicitPackCountFromTitle(value: unknown) {
  const normalized = text(value, 500).normalize("NFKC")
  const match = normalized.match(/\b(\d{1,3})\s*(?:pack|pk)\b/i) ??
    normalized.match(/\b(?:pack|set|lot|case)\s+(?:of\s+)?(\d{1,3})\b/i)
  const parsed = number(match?.[1])
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 && parsed <= 100
    ? parsed : null
}
function number(value: unknown) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
function conservativeShippingReserveReady(candidateValue: unknown) {
  const candidate = record(candidateValue)
  const config = record(record(candidate.economics_summary).config)
  const reserve = number(config.estimatedOutboundShipping)
  return reserve !== null && reserve > 0
}

function reusableOperatorProductApproval(candidateValue: unknown, now: Date) {
  const candidate = record(candidateValue)
  const economics = record(candidate.economics_summary)
  const approvedPrice = number(economics.operatorApprovedSalePrice)
  const supplierCost = number(economics.confirmedLunaPrice)
  const recommendedPrice = number(record(economics.pricingRecommendation)
    .recommendedSalePrice)
  const approvedAt = Date.parse(text(economics.operatorApprovedAt))
  const fulfillmentBasis = normalizeEbayCompliantFulfillmentBasis(
    economics.fulfillmentBasis,
  )
  // Price, fulfillment basis, image rights and spend authorization are durable
  // decisions. Supplier availability has its own freshness advisory and is
  // rechecked at publication/purchase, so it must not expire this approval or
  // block content and image preparation after 24 hours.
  const approvalRecorded = Number.isFinite(approvedAt) &&
    now.getTime() - approvedAt >= -5 * 60_000
  const priceStillMatches = approvedPrice !== null && recommendedPrice !== null &&
    Math.abs(approvedPrice - recommendedPrice) <= Math.max(.01, recommendedPrice * .02)
  if (economics.operatorPriceApproved !== true || !approvalRecorded ||
    approvedPrice === null || supplierCost === null || !priceStillMatches ||
    !fulfillmentBasis || economics.imageRightsConfirmed !== true ||
    economics.openAiImageSpendApproved !== true) return false
  const controlledRisk = record(economics.controlledRiskOverride).authorized === true
  const evaluation = calculateEbayUnitEconomics({ salePrice: approvedPrice, supplierCost },
    controlledRisk
      ? controlledRiskEconomicsConfig(ebayDraftOnlyEconomicsConfig())
      : ebayDraftOnlyEconomicsConfig())
  return evaluation.ready && evaluation.passesProfitGate
}

const DURABLE_PRODUCT_APPROVAL_RECOVERY_VERSION =
  "DURABLE_PRODUCT_APPROVAL_RECOVERY_V1_2026_07_24"

async function resumeReusableOperatorProductApprovalGate(
  supabase: SupabaseClient,
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
  now: Date,
) {
  const task = state.tasks.find((entry) =>
    entry.status === "OPEN" &&
    entry.gate_type === "PRODUCT_APPROVAL_REQUIRED")
  const otherOpenTask = state.tasks.some((entry) =>
    entry.status === "OPEN" &&
    entry.gate_type !== "CRITICAL_EXCEPTION_REQUIRED")
  if (!task && (otherOpenTask ||
    visualMarketRecoveryPriorityCandidate(state))) return false
  const candidate = [...state.candidates]
    .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    .find((entry) =>
      text(entry.machine_state) === "WAITING_PRODUCT_APPROVAL" &&
      (!task || text(entry.id) === text(task.candidate_id)))
  if (!candidate || !reusableOperatorProductApproval(candidate, now)) {
    return false
  }
  const factsSummary = record(candidate.product_facts_summary)
  const factRunId = text(factsSummary.factRunId)
  if (!/^[0-9a-f-]{36}$/i.test(factRunId)) {
    throw new Error("SAME_DAY_PILOT_REUSABLE_APPROVAL_FACT_RUN_MISSING")
  }
  const economics = record(candidate.economics_summary)
  const supplyAdvisory = lunaSupplyFreshnessAdvisory(candidate, now)
  const checkpoint = {
    recoveryVersion: DURABLE_PRODUCT_APPROVAL_RECOVERY_VERSION,
    originalOperatorApprovedAt: economics.operatorApprovedAt ?? null,
    operatorPriceApproved: true,
    approvalRepeated: false,
    supplyFreshnessStatus: supplyAdvisory.status,
    supplyRecheckRequiredAt: supplyAdvisory.nextRequiredAt,
    openAiCalls: 0,
    ebayWrites: 0,
  }
  const job = {
    jobType: "BUILD_MANUAL_SELLER_HUB_HANDOFF",
    idempotencyKey:
      `${state.run.id}:${candidate.id}:BUILD_MANUAL_SELLER_HUB_HANDOFF:${factRunId}`,
    checkpoint: {
      factRunId,
      priorApprovalPreserved: true,
      recoveryVersion: DURABLE_PRODUCT_APPROVAL_RECOVERY_VERSION,
      supplyFreshnessStatus: supplyAdvisory.status,
      openAiCalls: 0,
      ebayWrites: 0,
    },
  }
  if (task) {
    await completeAndAdvanceHumanGate({
      supabase,
      taskId: text(task.id),
      gateType: "PRODUCT_APPROVAL_REQUIRED",
      runId: text(state.run.id),
      candidateId: text(candidate.id),
      previousState: "WAITING_PRODUCT_APPROVAL",
      nextState: "GENERATING_LISTING_CONTENT",
      reasonCode: "DURABLE_PRODUCT_APPROVAL_REUSED_SUPPLY_ALERT_NON_BLOCKING",
      triggeredBy: "SYSTEM",
      checkpoint,
      nextAutomaticAction:
        "Construir el listing y preparar las imágenes con la aprobación vigente.",
      nextHumanAction: "Ninguna hasta revisar las imágenes.",
      job,
    })
  } else {
    await transition({
      supabase,
      runId: text(state.run.id),
      candidateId: text(candidate.id),
      previousState: "WAITING_PRODUCT_APPROVAL",
      nextState: "GENERATING_LISTING_CONTENT",
      reasonCode: "DURABLE_PRODUCT_APPROVAL_REUSED_SUPPLY_ALERT_NON_BLOCKING",
      triggeredBy: "SYSTEM",
      checkpoint,
      nextAutomaticAction:
        "Construir el listing y preparar las imágenes con la aprobación vigente.",
      nextHumanAction: "Ninguna hasta revisar las imágenes.",
      job,
    })
  }
  const { error } = await supabase.from("ebay_same_day_pilot_events").upsert({
    run_id: state.run.id,
    candidate_id: candidate.id,
    event_type: "DURABLE_PRODUCT_APPROVAL_REUSED",
    event_payload: {
      recoveryVersion: DURABLE_PRODUCT_APPROVAL_RECOVERY_VERSION,
      originalOperatorApprovedAt: economics.operatorApprovedAt ?? null,
      approvalRepeated: false,
      supplyFreshnessStatus: supplyAdvisory.status,
      supplyRecheckRequiredAt: supplyAdvisory.nextRequiredAt,
      blocksAnalysis: false,
      blocksPublication: supplyAdvisory.blocksPublication,
      historyDeleted: false,
    },
    idempotency_key: [
      state.run.id,
      candidate.id,
      DURABLE_PRODUCT_APPROVAL_RECOVERY_VERSION,
      factRunId,
    ].join(":"),
    ebay_read_calls: 0,
    openai_calls: 0,
    ebay_writes: 0,
    production_changed: false,
  }, { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (error) {
    throw new Error("SAME_DAY_PILOT_REUSABLE_APPROVAL_EVENT_FAILED")
  }
  return true
}

async function persistConfirmedOfferPackQueueBinding(input: {
  supabase: SupabaseClient
  accountKey: string
  candidate: JsonRecord
  now: Date
}) {
  const selectionIdentity = record(record(input.candidate.evidence_summary).selectionIdentity)
  const nativePackCount = number(selectionIdentity.nativePackCount)
  const explicitTitlePackCount = explicitPackCountFromTitle(input.candidate.product_title)
  if (selectionIdentity.exactIdentityConfirmed !== true ||
    selectionIdentity.exactOfferPackVerified !== true ||
    nativePackCount === null || !Number.isInteger(nativePackCount) ||
    nativePackCount <= 0 || nativePackCount > 100 ||
    (explicitTitlePackCount !== null && explicitTitlePackCount !== nativePackCount) ||
    !text(input.candidate.queue_item_id)) return false
  const { data: queueItem, error: readError } = await input.supabase
    .from("marketplace_listing_approval_queue_items")
    .select("id,recommended_pack_count,evidence_snapshot")
    .eq("id", input.candidate.queue_item_id)
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", MARKETPLACE)
    .maybeSingle()
  if (readError || !queueItem) {
    throw new Error("SAME_DAY_PILOT_OFFER_PACK_QUEUE_ITEM_READ_FAILED")
  }
  const snapshot = record(queueItem.evidence_snapshot)
  const packStrategy = record(snapshot.packStrategy)
  const recommendedPack = record(packStrategy.recommendedPack)
  if (number(queueItem.recommended_pack_count) === nativePackCount &&
    number(recommendedPack.packCount) === nativePackCount) return true
  const evidenceHash = text(selectionIdentity.evidenceHash) || versionedHash({
    version: PRODUCT_FACT_AUTHORITY_LINEAGE_RECOVERY_VERSION,
    candidateId: input.candidate.id,
    nativePackCount,
  })
  const { error: updateError } = await input.supabase
    .from("marketplace_listing_approval_queue_items")
    .update({
      recommended_pack_count: nativePackCount,
      evidence_snapshot: {
        ...snapshot,
        packStrategy: { ...packStrategy,
          recommendedPack: { ...recommendedPack, packCount: nativePackCount } },
        operatorOfferPackConfirmation: {
          nativePackCount,
          evidenceHash,
          confirmedAt: text(selectionIdentity.confirmedAt) || input.now.toISOString(),
          source: "OPERATOR_VISIBLE_LUNA_EXACT_PRODUCT_PAGE",
          actorRecorded: selectionIdentity.actorRecorded === true,
          urlStored: false,
        },
      },
      updated_at: input.now.toISOString(),
    })
    .eq("id", queueItem.id)
    .eq("marketplace_account_key", input.accountKey)
  if (updateError) throw new Error("SAME_DAY_PILOT_OFFER_PACK_QUEUE_ITEM_UPDATE_FAILED")
  return true
}

async function cancelSupersededProductFactsDeadLetters(input: {
  supabase: SupabaseClient
  runId: string
  candidateId: string
  now: Date
}) {
  const { data, error } = await input.supabase
    .from("ebay_same_day_pilot_jobs")
    .select("id,checkpoint,last_error_code")
    .eq("run_id", input.runId)
    .eq("candidate_id", input.candidateId)
    .eq("job_type", "ENRICH_PRODUCT_FACTS")
    .eq("status", "DEAD_LETTER")
  if (error) throw new Error("SAME_DAY_PILOT_SUPERSEDED_FACTS_DEAD_LETTER_READ_FAILED")
  let cancelled = 0
  for (const failed of data ?? []) {
    const { error: updateError } = await input.supabase
      .from("ebay_same_day_pilot_jobs")
      .update({
        status: "CANCELLED",
        last_error_code: "SUPERSEDED_BY_PRODUCT_FACT_AUTHORITY_LINEAGE_RECOVERY",
        checkpoint: {
          ...record(failed.checkpoint),
          _supersededRecovery: {
            version: PRODUCT_FACT_AUTHORITY_LINEAGE_RECOVERY_VERSION,
            previousErrorCode: text(failed.last_error_code) || null,
            recoveredAt: input.now.toISOString(),
            historyDeleted: false,
          },
        },
        updated_at: input.now.toISOString(),
      })
      .eq("id", failed.id)
      .eq("status", "DEAD_LETTER")
    if (updateError) {
      throw new Error("SAME_DAY_PILOT_SUPERSEDED_FACTS_DEAD_LETTER_CANCEL_FAILED")
    }
    cancelled += 1
  }
  return cancelled
}

async function reconcileEnqueuedAuthorityLineageRecoveryDeadLetters(
  supabase: SupabaseClient,
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
  now: Date,
) {
  const { data, error } = await supabase
    .from("ebay_same_day_pilot_jobs")
    .select("candidate_id,checkpoint,status")
    .eq("run_id", state.run.id)
    .eq("job_type", "ENRICH_PRODUCT_FACTS")
    .in("status", ["PENDING", "WAITING_RETRY", "LEASED"])
  if (error) throw new Error("SAME_DAY_PILOT_ENQUEUED_FACTS_RECOVERY_READ_FAILED")
  const candidateIds = [...new Set((data ?? [])
    .filter((job) => record(job.checkpoint).authorityLineageRecovery === true)
    .map((job) => text(job.candidate_id))
    .filter(Boolean))]
  let cancelled = 0
  for (const candidateId of candidateIds) {
    const candidate = state.candidates.find((entry) => text(entry.id) === candidateId)
    if (text(candidate?.machine_state) !== "ENRICHING_PRODUCT_FACTS") continue
    cancelled += await cancelSupersededProductFactsDeadLetters({
      supabase, runId: state.run.id, candidateId, now,
    })
  }
  return cancelled
}
function safeHttpsUrl(value: unknown) {
  const submitted = text(value, 2_000)
  try {
    const url = new URL(submitted)
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}
function money(value: number) {
  return Math.round(value * 100) / 100
}
function exactSoldMarketReference(rows: JsonRecord[]) {
  const valid = rows.map((row) => ({
    soldPrice: number(row.average_sold_price), shipping: number(row.average_shipping),
    soldQuantity: Math.max(0, number(row.confirmed_sold_quantity) ?? 0),
    lastSoldDate: text(row.last_sold_date), listingFormat: text(row.listing_format),
  })).filter((row) => row.soldPrice !== null && row.soldQuantity > 0)
  if (!valid.length) return null
  const soldQuantity = valid.reduce((total, row) => total + row.soldQuantity, 0)
  const leader = [...valid].sort((left, right) => right.soldQuantity - left.soldQuantity)[0]
  const prices = valid.map((row) => row.soldPrice as number)
  const dates = valid.map((row) => row.lastSoldDate).filter(Boolean).sort()
  return {
    evidenceTier: "CONFIRMED_SOLD_EXACT",
    source: "EBAY_PRODUCT_RESEARCH_AUTHORIZED_CAPTURE",
    descriptiveOnly: true,
    automaticPriceRecommendation: false,
    exactListingSampleSize: valid.length,
    confirmedSoldQuantity: soldQuantity,
    weightedAverageSoldPrice: money(valid.reduce((total, row) => total + (row.soldPrice as number) * row.soldQuantity, 0) / soldQuantity),
    soldPriceRange: { minimum: money(Math.min(...prices)), maximum: money(Math.max(...prices)) },
    highestSoldExactListing: { soldPrice: money(leader.soldPrice as number),
      shipping: leader.shipping === null ? null : money(leader.shipping),
      confirmedSoldQuantity: leader.soldQuantity, lastSoldDate: leader.lastSoldDate || null,
      listingFormat: leader.listingFormat || "UNKNOWN" },
    capturePeriod: { earliestLastSoldDate: dates[0] ?? null, latestLastSoldDate: dates.at(-1) ?? null },
    confidence: valid.length >= 5 ? "HIGH" : valid.length >= 2 ? "MEDIUM" : "LOW",
    limitations: ["Muestra capturada y autorizada por el operador.",
      "Describe precios observados; no determina automáticamente el precio del listing."],
  }
}

function relatedPackStrategyFromReconciliation(
  rows: JsonRecord[],
  nativePackCount: number | null,
  confirmedLunaPresentationCost: number | null,
) {
  const grouped = new Map<number, { packCount: number; observationCount: number;
    confirmedSoldQuantity: number; confidenceTotal: number }>()
  for (const row of rows) {
    if (row.classification !== "SAME_PRODUCT_DIFFERENT_PACK") continue
    const packCount = number(row.observedPackCount)
    if (!packCount || !Number.isInteger(packCount) || packCount <= 0) continue
    const current = grouped.get(packCount) ?? { packCount, observationCount: 0,
      confirmedSoldQuantity: 0, confidenceTotal: 0 }
    current.observationCount += 1
    current.confirmedSoldQuantity += Math.max(0, number(row.confirmedSoldQuantity) ?? 0)
    current.confidenceTotal += Math.max(0, Math.min(1, number(row.confidence) ?? 0))
    grouped.set(packCount, current)
  }
  const cohorts = [...grouped.values()].map((cohort) => {
    const averageConfidence = cohort.observationCount
      ? cohort.confidenceTotal / cohort.observationCount : 0
    return {
      packCount: cohort.packCount,
      observationCount: cohort.observationCount,
      confirmedSoldQuantity: cohort.confirmedSoldQuantity,
      confidence: averageConfidence >= .9 ? "HIGH" as const
        : averageConfidence >= .75 ? "MEDIUM" as const : "LOW" as const,
    }
  })
  const strategy = nativePackCount === null
    ? {
        version: "LUNA_RELATED_PACK_STRATEGY_V1",
        candidates: [],
        suggestedPackCountForEvaluation: null,
        requiresCustomPreparation: false,
        conclusion: "No se evaluaron presentaciones relacionadas porque el pack nativo de Luna no está verificado.",
        prohibitedConclusions: [
          "La presentación causó las ventas.",
          "El precio observado debe convertirse automáticamente en precio del listing.",
        ],
      }
    : rankRelatedPackStrategies({ nativePackCount, relatedPackEvidence: cohorts })
  const targetPackCount = nativePackCount === null
    ? null : number(strategy.suggestedPackCountForEvaluation)
  const targetCohort = targetPackCount === null
    ? null : cohorts.find((cohort) => cohort.packCount === targetPackCount) ?? null
  const lunaPurchaseUnitsPerOffer = nativePackCount && targetPackCount &&
    targetPackCount % nativePackCount === 0
    ? targetPackCount / nativePackCount : null
  const discountScenarioPreflight = nativePackCount && targetPackCount &&
    lunaPurchaseUnitsPerOffer
    ? evaluatePackDiscountScenarios({
        source: targetPackCount === nativePackCount
          ? "LUNA_NATIVE_PRESENTATION" : "LUNA_CUSTOM_PRESENTATION",
        nativePackCount,
        targetPackCount,
        lunaPurchaseUnitsPerOffer,
        lunaPurchaseUnitCostUsd: confirmedLunaPresentationCost,
        approvedBaselinePricePerNativePresentationUsd: null,
        shippingCostUsd: null,
        packagingType: targetPackCount === nativePackCount ? undefined : "UNKNOWN",
        packagingMaterial: targetPackCount === nativePackCount ? undefined : "UNKNOWN",
        marketEvidence: targetCohort ? {
          packCount: targetCohort.packCount,
          evidenceTier: "CONFIRMED_SOLD_RELATED_PACK",
          confirmedSoldObservationCount: targetCohort.observationCount,
          confirmedSoldQuantity: targetCohort.confirmedSoldQuantity,
          confidence: targetCohort.confidence,
        } : null,
      })
    : null
  return {
    ...strategy,
    analysisStatus: nativePackCount === null ? "UNAVAILABLE" as const : "ANALYZED" as const,
    blockers: nativePackCount === null ? ["OFFER_PACK_IDENTITY_MISSING"] : [],
    evidenceTier: "CONFIRMED_SOLD_RELATED_PACK" as const,
    soldExactCountImpact: 0,
    sampleSize: cohorts.reduce((sum, cohort) => sum + cohort.observationCount, 0),
    confirmedSoldQuantity: cohorts.reduce((sum, cohort) => sum + cohort.confirmedSoldQuantity, 0),
    discountScenarioPreflight,
    discountScenarioStatus: discountScenarioPreflight
      ? "WAITING_OWNER_BASELINE_AND_EXACT_PACK_COSTS" as const
      : "NOT_APPLICABLE" as const,
  }
}
function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
}
function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
function versionedHash(value: unknown) {
  return `sha256:${createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex")}`
}

function recoverableSingleFactException(summaryValue: unknown) {
  const summary = record(summaryValue)
  const gates = record(summary.gates)
  const missing = (Array.isArray(summary.resolvedRequirements)
    ? summary.resolvedRequirements.map(record) : [])
    .filter((requirement) => ["MISSING_BLOCKING", "CONFLICTED_BLOCKING"]
      .includes(text(requirement.status)))
  if (!missing.length || gates.IDENTITY_READY !== true ||
    gates.PRODUCT_FACTS_READY !== true || gates.OFFER_PACK_READY !== true ||
    gates.REGULATORY_READY !== true) return null
  const configured = missing.map((requirement) => {
    const aspectName = text(requirement.aspectName, 100)
    const configuration = operatorConfirmableOfficialLabelFact(aspectName)
    return configuration ? { requirement, aspectName, configuration } : null
  })
  // Manual fallback is allowed only when every remaining blocking aspect is a
  // narrow, label-verifiable field. Regulatory, identity and pack conflicts
  // never enter this path.
  if (configured.some((entry) => !entry)) return null
  const selected = configured[0]
  if (!selected) return null
  return {
    actionType: "CONFIRM_OFFICIAL_LABEL_FACT" as const,
    factScope: "PRODUCT_UNIT" as const,
    aspectName: selected.aspectName,
    factKey: selected.configuration.factKey,
    label: selected.configuration.label,
    remainingBlockingFields: configured.map((entry) => entry?.aspectName).filter(Boolean),
    selectionOnly: selected.requirement.selectionOnly === true,
    allowedValuesComplete: selected.requirement.allowedValuesComplete === true,
    allowedValues: Array.isArray(selected.requirement.allowedValues)
      ? selected.requirement.allowedValues.map((entry) => text(entry, 100)).filter(Boolean).slice(0, 100)
      : [],
  }
}

function recoverableOfferPackException(candidateValue: unknown, summaryValue: unknown) {
  const candidate = record(candidateValue)
  const summary = record(summaryValue)
  const gates = record(summary.gates)
  const selectionIdentity = record(record(candidate.evidence_summary).selectionIdentity)
  const nativePackCount = number(selectionIdentity.nativePackCount)
  if (gates.IDENTITY_READY !== true || gates.PRODUCT_FACTS_READY !== true ||
    gates.REGULATORY_READY !== true || gates.OFFER_PACK_READY === true ||
    selectionIdentity.exactIdentityConfirmed !== true ||
    selectionIdentity.exactOfferPackVerified !== true ||
    nativePackCount === null || !Number.isInteger(nativePackCount) ||
    nativePackCount <= 0 || nativePackCount > 100) return null
  return {
    actionType: "CONFIRM_OFFICIAL_OFFER_PACK" as const,
    factScope: "OFFER_PACK" as const,
    aspectName: "Offer Pack",
    factKey: "offerPackCount",
    label: "Unidades físicas contenidas en cada presentación de Luna",
    remainingBlockingFields: ["Offer Pack"],
    selectionOnly: false,
    allowedValuesComplete: false,
    allowedValues: [],
    currentValue: nativePackCount,
    explicitTitlePackCount: explicitPackCountFromTitle(candidate.product_title),
  }
}

function recoverableTaxonomyException(summaryValue: unknown) {
  const summary = record(summaryValue)
  const gates = record(summary.gates)
  const taxonomy = record(summary.taxonomy)
  if (gates.IDENTITY_READY !== true || gates.PRODUCT_FACTS_READY !== true ||
    gates.OFFER_PACK_READY !== true || gates.REGULATORY_READY !== true ||
    gates.EBAY_ASPECTS_READY === true || text(taxonomy.status) === "AVAILABLE") return null
  return {
    actionType: "CONFIRM_OFFICIAL_EBAY_CATEGORY" as const,
    factScope: "EBAY_LISTING_REQUIREMENTS" as const,
    aspectName: "Categoría eBay oficial",
    factKey: "categoryId",
    label: "ID numérico de la categoría exacta en eBay",
    remainingBlockingFields: ["Categoría eBay oficial"],
    selectionOnly: false,
    allowedValuesComplete: false,
    allowedValues: [] as string[],
  }
}

const MANUAL_REGULATORY_FACTS: Record<string, string> = {
  warnings: "Advertencia oficial visible",
  hazardousMaterialStatus: "Estado de material peligroso visible",
  regulatoryIdentifiers: "Identificador regulatorio oficial",
}

function recoverableRegulatoryFactException(summaryValue: unknown) {
  const summary = record(summaryValue)
  const gates = record(summary.gates)
  if (gates.IDENTITY_READY !== true || gates.PRODUCT_FACTS_READY !== true ||
    gates.OFFER_PACK_READY !== true || gates.EBAY_ASPECTS_READY !== true ||
    gates.REGULATORY_READY === true) return null
  const present = new Set((Array.isArray(summary.resolvedFacts)
    ? summary.resolvedFacts.map(record) : [])
    .filter((fact) => text(fact.scope) === "PRODUCT_UNIT")
    .map((fact) => text(fact.key)).filter(Boolean))
  const factKey = Object.keys(MANUAL_REGULATORY_FACTS)
    .find((key) => !present.has(key))
  if (!factKey) return null
  return {
    actionType: "CONFIRM_OFFICIAL_LABEL_FACT" as const,
    factScope: "PRODUCT_UNIT" as const,
    aspectName: MANUAL_REGULATORY_FACTS[factKey],
    factKey,
    label: MANUAL_REGULATORY_FACTS[factKey],
    remainingBlockingFields: Object.keys(MANUAL_REGULATORY_FACTS)
      .filter((key) => !present.has(key)).map((key) => MANUAL_REGULATORY_FACTS[key]),
    selectionOnly: false,
    allowedValuesComplete: false,
    allowedValues: [] as string[],
    regulatoryFact: true as const,
  }
}
function operationDate(now: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Managua", year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

function controlledRiskEvaluationForCandidate(
  candidate: JsonRecord,
  operatorSalePrice?: number | null,
) {
  const evidence = record(candidate.evidence_summary)
  const selectionIdentity = record(evidence.selectionIdentity)
  const evidenceTiers = record(evidence.evidenceTiers)
  const exactSoldReference = record(evidence.exactSoldMarketReference)
  const highestSoldExactListing = record(exactSoldReference.highestSoldExactListing)
  const exactSoldReferenceReconciledAt = Date.parse(
    text(evidence.exactSoldMarketReferenceReconciledAt),
  )
  const exactSoldEvidenceFresh = Number.isFinite(exactSoldReferenceReconciledAt) &&
    exactSoldReferenceReconciledAt <= Date.now() + 300_000 &&
    Date.now() - exactSoldReferenceReconciledAt <= 72 * 60 * 60_000
  const soldPrice = number(highestSoldExactListing.soldPrice)
  const shipping = number(highestSoldExactListing.shipping)
  const competitiveBuyerPrice = soldPrice === null
    ? null
    : money(soldPrice + Math.max(0, shipping ?? 0))
  const economics = record(candidate.economics_summary)
  const config = record(economics.config)
  const facts = record(candidate.product_facts_summary)
  const gates = record(facts.gates)
  const decision = record(candidate.commercial_decision_summary)
  const evaluation = evaluateControlledRiskManualOverride({
    supplierCost: economics.confirmedLunaPrice ?? economics.supplierCost,
    operatorSalePrice,
    exactSoldReferenceTotalBuyerPrice: competitiveBuyerPrice,
    confirmedSoldExactQuantity: exactSoldReference.confirmedSoldQuantity ??
      evidence.soldExactCount,
    exactIdentityConfirmed: evidence.exactIdentityConfirmed === true ||
      selectionIdentity.exactIdentityConfirmed === true ||
      Number(evidenceTiers.exactIdentityMatches ?? 0) > 0,
    exactOfferPackVerified: selectionIdentity.exactOfferPackVerified === true ||
      Number(evidenceTiers.exactIdentityMatches ?? 0) > 0,
    lunaAvailable: economics.available === true,
    evidenceFresh: evidence.evidenceFresh === true || exactSoldEvidenceFresh,
    decisionFresh: decision.fresh === true,
    decisionPackageHashMatches: decision.packageHashMatches === true,
    factsReady: facts.currentRunBound === true && gates.OPENAI_INPUT_READY === true,
    shippingEstimateReady: gates.SHIPPING_ESTIMATE_READY === true ||
      conservativeShippingReserveReady(candidate),
    decisionVerdict: decision.verdict,
    decisionBlockers: decision.blockers,
    baseConfig: {
      estimatedEbayFeeRate: number(config.estimatedEbayFeeRate) ?? undefined,
      fixedOrderFee: number(config.fixedOrderFee) ?? undefined,
      estimatedOutboundShipping: number(config.estimatedOutboundShipping) ?? undefined,
      returnsReserveRate: number(config.returnsReserveRate) ?? undefined,
      promotedListingsReserveRate: number(config.promotedListingsReserveRate) ?? undefined,
      minimumNetProfit: number(config.minimumNetProfit) ?? undefined,
      minimumNetMarginPercent: number(config.minimumNetMarginPercent) ?? undefined,
      minimumRoiPercent: number(config.minimumRoiPercent) ?? undefined,
    },
  })
  return {
    evaluation,
    exactSoldReference: {
      totalBuyerPrice: competitiveBuyerPrice,
      soldPrice,
      shipping,
      confirmedSoldQuantity: evaluation.confirmedSoldExactQuantity,
      capturePeriod: record(exactSoldReference.capturePeriod),
      confidence: text(exactSoldReference.confidence),
      source: text(exactSoldReference.source),
    },
  }
}

function candidateInput(
  row: JsonRecord,
  latestVariant: JsonRecord = {},
  now = new Date(),
  officialDescriptionIdentity: JsonRecord = {},
): SameDayCandidateInput {
  const assessment = record(row.assessment)
  const identity = record(assessment.identity)
  const market = record(assessment.market)
  const economics = record(assessment.economics)
  const scores = record(assessment.scores)
  const candidate = record(assessment.candidate)
  const sourceVerification = record(assessment.sourceVerification)
  const observed = text(row.last_scanned_at)
  const supplierProductUrl = text(latestVariant.product_url || row.product_url, 2_000)
  const lunaVariantGtin = text(latestVariant.barcode)
  const officialDescriptionHasStrongIdentity = Boolean(
    text(officialDescriptionIdentity.gtin) ||
    (text(officialDescriptionIdentity.brand) &&
      text(officialDescriptionIdentity.mpn || officialDescriptionIdentity.model)),
  )
  const identityEvidenceSource = lunaVariantGtin
    ? "LUNA_EXACT_VARIANT"
    : officialDescriptionHasStrongIdentity
      ? text(officialDescriptionIdentity.source)
      : ""
  const identityEvidenceHash = lunaVariantGtin
    ? versionedHash({ source: "LUNA_EXACT_VARIANT", productId: row.market_radar_product_id,
        supplierVariantId: latestVariant.supplier_variant_id || row.supplier_variant_id,
        gtin: lunaVariantGtin })
    : text(officialDescriptionIdentity.evidenceHash)
  const officialPackCount = number(officialDescriptionIdentity.packCount)
  const offerPackVerified = officialPackCount !== null ||
    sourceVerification.humanConfirmedCommercialPacks === true
  return {
    id: text(row.id), candidateKey: text(row.candidate_key), productTitle: text(row.product_title),
    variantTitle: text(latestVariant.variant_title || row.variant_title) || null,
    supplierSku: text(latestVariant.sku || row.supplier_sku) || null,
    supplierVariantId: text(latestVariant.supplier_variant_id || row.supplier_variant_id) || null,
    supplierProductUrl: isAllowedLunaProductUrl(supplierProductUrl) ? supplierProductUrl : null,
    supplierImageUrl: safeHttpsUrl(latestVariant.featured_image_url || row.featured_image_url),
    gtin: text(latestVariant.barcode || row.gtin || officialDescriptionIdentity.gtin) || null,
    brand: text(identity.brand || candidate.brand || officialDescriptionIdentity.brand) || null,
    mpn: text(identity.mpn || candidate.mpn || officialDescriptionIdentity.mpn) || null,
    model: text(identity.model || candidate.model || officialDescriptionIdentity.model) || null,
    nativePackCount: number(candidate.packQuantity ?? candidate.packCount ?? identity.packCount ??
      officialDescriptionIdentity.packCount),
    unitCount: number(candidate.unitCount ?? identity.unitCount),
    size: text(candidate.size || identity.size || officialDescriptionIdentity.size) || null,
    color: text(candidate.color || identity.color) || null,
    scent: text(candidate.scent || identity.scent) || null,
    formulation: text(candidate.formulation || identity.formulation) || null,
    identityEvidenceSource: identityEvidenceSource || null,
    identityEvidenceHash: identityEvidenceHash || null,
    identityIndependentlyVerified: Boolean(identityEvidenceSource && identityEvidenceHash),
    offerPackVerified,
    supplierPrice: number(latestVariant.price) ?? number(row.supplier_price),
    supplierAvailable: latestVariant.available === true ? true : latestVariant.available === false ? false : row.supplier_available === true ? true : row.supplier_available === false ? false : null,
    supplierQuantity: number(latestVariant.inventory_quantity) ?? number(row.supplier_inventory_quantity),
    supplierObservedAt: text(latestVariant.captured_at || row.supplier_snapshot_at) || null,
    exactIdentityConfirmed: identity.exactIdentityConfirmed === true,
    identityConfidence: number(scores.confidenceScore) ?? number(row.identity_score) ?? 0,
    activeExactCount: number(row.active_comparables) ?? 0, soldExactCount: number(market.soldExactCount) ?? 0,
    compatibleSellerCount: number(market.compatibleSellerCount) ?? number(row.sellers_with_movement) ?? 0,
    evidenceFresh: Boolean(observed && now.getTime() - Date.parse(observed) <= 72 * 60 * 60_000),
    economicsReady: economics.ready === true, estimatedProfit: number(row.estimated_net_profit) ?? number(economics.estimatedNetProfit),
    roiPercent: number(economics.roiPercent), netMarginPercent: number(economics.netMarginPercent),
    hardGates: strings(row.hard_gates), evidenceGuards: strings(row.evidence_guards),
    regulatedWithoutPath: strings(row.hard_gates).some((gate) => /REGULATORY|HAZMAT|EPA/.test(gate)),
    queueStatus: text(row.queue_status), score: number(row.opportunity_score) ?? 0,
    listingPackageReadiness: number(row.listing_readiness_score) ?? 0,
  }
}

async function currentState(
  supabase: SupabaseClient,
  accountKey: string,
  date: string,
  now = new Date(),
) {
  const { data: datedRun, error } = await supabase.from("ebay_same_day_pilot_runs").select("*")
    .eq("marketplace_account_key", accountKey).eq("operation_date", date)
    .order("cycle", { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error("SAME_DAY_PILOT_RUN_READ_FAILED")
  let run = datedRun
  if (!run) {
    // A launch is durable work, not a disposable calendar view. If Ernesto
    // pauses overnight, resume the newest unfinished run before offering a
    // fresh one; this preserves candidates, captures and checkpoints.
    const { data: carryoverRuns, error: carryoverError } = await supabase
      .from("ebay_same_day_pilot_runs").select("*")
      .eq("marketplace_account_key", accountKey).in("status", [
        "ACTIVE", "PARTIALLY_READY", "READY_FOR_OPERATOR", "BLOCKED", "COMPLETED",
      ])
      .order("operation_date", { ascending: false })
      .order("cycle", { ascending: false }).limit(10)
    if (carryoverError) throw new Error("SAME_DAY_PILOT_CARRYOVER_RUN_READ_FAILED")
    const completedRunIds = (carryoverRuns ?? []).filter((candidateRun) =>
      candidateRun.status === "COMPLETED").map((candidateRun) =>
      text(candidateRun.id)).filter(Boolean)
    const blockedRunIds = (carryoverRuns ?? []).filter((candidateRun) =>
      candidateRun.status === "BLOCKED").map((candidateRun) =>
      text(candidateRun.id)).filter(Boolean)
    const { data: completedRunCandidates, error: completedRunCandidateError } =
      completedRunIds.length
        ? await supabase.from("ebay_same_day_pilot_candidates")
          .select("run_id,machine_state").in("run_id", completedRunIds)
        : { data: [], error: null }
    const { data: blockedRunCandidates, error: blockedRunCandidateError } =
      blockedRunIds.length
        ? await supabase.from("ebay_same_day_pilot_candidates")
          .select("run_id,machine_state,state,blockers,queue_item_id,supplier_variant_id,evidence_summary,economics_summary")
          .in("run_id", blockedRunIds)
        : { data: [], error: null }
    if (completedRunCandidateError) {
      throw new Error("SAME_DAY_PILOT_CARRYOVER_CANDIDATE_READ_FAILED")
    }
    if (blockedRunCandidateError) {
      throw new Error("SAME_DAY_PILOT_BLOCKED_RECOVERY_CANDIDATE_READ_FAILED")
    }
    const completedRunStates = new Map<string, string[]>()
    for (const candidate of completedRunCandidates ?? []) {
      const runId = text(candidate.run_id)
      const states = completedRunStates.get(runId) ?? []
      states.push(text(candidate.machine_state))
      completedRunStates.set(runId, states)
    }
    const recoverableBlockedRunIds = new Set((blockedRunCandidates ?? [])
      .filter((candidate) =>
        text(candidate.machine_state) === "REJECTED" &&
        text(candidate.state) === "REJECTED_TODAY" &&
        strings(candidate.blockers).length === 1 &&
        strings(candidate.blockers)[0] ===
          "PRODUCT_FACT_CONTROLLED_EXPLORATORY_TARGET_INVALID" &&
        controlledExploratoryFactsCanContinue(record(candidate), now))
      .map((candidate) => text(candidate.run_id)))
    run = (carryoverRuns ?? []).find((candidateRun) => {
      if (candidateRun.status === "COMPLETED") {
        return !isSameDayCandidateBatchSettled(
          completedRunStates.get(text(candidateRun.id)) ?? [],
        )
      }
      if (candidateRun.status !== "BLOCKED") return true
      if (recoverableBlockedRunIds.has(text(candidateRun.id))) return true
      const verified = number(candidateRun.verified_new_listings) ?? 0
      const target = number(candidateRun.target_new_listings) ?? 2
      return verified < target &&
        record(candidateRun.source_inventory).nextCandidateSetExhausted !== true
    }) ?? null
  }
  if (!run) return null
  const productResearchPlanId = text(record(run.source_inventory).productResearchPlanId)
  const [{ data: candidates, error: candidateError }, { data: tasks, error: taskError },
    { data: transitions, error: transitionError }, { data: jobs, error: jobError },
    { data: handoffs, error: handoffError }, { data: quotaStates, error: quotaError },
    { data: productResearchPlan, error: productResearchPlanError },
    { data: cycleRuns, error: cycleRunsError }] = await Promise.all([
    supabase.from("ebay_same_day_pilot_candidates").select("*").eq("run_id", run.id).order("ordinal"),
    supabase.from("ebay_same_day_pilot_human_tasks").select("*").eq("run_id", run.id).order("created_at"),
    supabase.from("ebay_same_day_pilot_transitions").select("*").eq("run_id", run.id).order("created_at"),
    supabase.from("ebay_same_day_pilot_jobs").select("id,candidate_id,job_type,status,attempt,available_at,rate_limit_resume_at,last_error_code,created_at,updated_at").eq("run_id", run.id).order("created_at"),
    supabase.from("ebay_same_day_pilot_handoffs").select("id,candidate_id,status,package_data,package_hash,created_at")
      .eq("run_id", run.id).order("created_at"),
    supabase.from("ebay_api_quota_states")
      .select("api_family,operation,status,remaining,reserved_budget,available_budget,reset_at,owner_lane,last_refreshed_at")
      .eq("marketplace", MARKETPLACE),
    productResearchPlanId
      ? supabase.from("marketplace_product_research_query_plans").select("id,status")
        .eq("id", productResearchPlanId).eq("marketplace_account_key", accountKey)
        .eq("marketplace", MARKETPLACE).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("ebay_same_day_pilot_runs")
      .select("id,cycle,verified_existing_listings,verified_new_listings,status")
      .eq("marketplace_account_key", accountKey)
      .eq("operation_date", run.operation_date)
      .order("cycle", { ascending: true }),
  ])
  if (candidateError || taskError || transitionError || jobError || handoffError || quotaError || cycleRunsError) {
    throw new Error("SAME_DAY_PILOT_STATE_READ_FAILED")
  }
  const candidateRows = candidates ?? []
  const opportunityIds = [...new Set(candidateRows.map((candidate) => text(candidate.opportunity_id)).filter(Boolean))]
  const { data: opportunityRows, error: opportunityError } = opportunityIds.length
    ? await supabase.from("ebay_luna_opportunity_queue")
      .select("id,market_radar_product_id,supplier_variant_id")
      .in("id", opportunityIds)
    : { data: [], error: null }
  if (opportunityError) throw new Error("SAME_DAY_PILOT_LUNA_ANCHOR_IDENTITY_READ_FAILED")
  const opportunities = new Map((opportunityRows ?? []).map((row) => [text(row.id), record(row)]))
  const productIds = [...new Set((opportunityRows ?? []).map((row) => text(row.market_radar_product_id)).filter(Boolean))]
  const { data: anchorRows, error: anchorError } = productIds.length
    ? await supabase.from("market_radar_latest_variants")
      .select("product_id,supplier_variant_id,product_url,featured_image_url")
      .eq("source_key", "lunaportex")
      .in("product_id", productIds)
    : { data: [], error: null }
  if (anchorError) throw new Error("SAME_DAY_PILOT_LUNA_ANCHOR_READ_FAILED")
  const anchors = new Map((anchorRows ?? []).map((row) => [
    `${text(row.product_id)}:${text(row.supplier_variant_id)}`,
    record(row),
  ]))
  const anchoredCandidates = candidateRows.map((candidate) => {
    const opportunity = opportunities.get(text(candidate.opportunity_id)) ?? {}
    const exactVariant = text(opportunity.supplier_variant_id) === text(candidate.supplier_variant_id)
    const productId = exactVariant ? text(opportunity.market_radar_product_id) : ""
    const anchor = productId
      ? anchors.get(`${productId}:${text(candidate.supplier_variant_id)}`) ?? {}
      : {}
    const localPackage = record(candidate.local_preparation_package)
    const product = record(localPackage.product)
    const productUrl = text(anchor.product_url, 2_000)
    return {
      ...candidate,
      local_preparation_package: {
        ...localPackage,
        product: {
          ...product,
          marketRadarProductId: productId || null,
          supplierProductUrl: isAllowedLunaProductUrl(productUrl) ? productUrl : null,
          supplierImageUrl: safeHttpsUrl(anchor.featured_image_url),
        },
      },
    }
  })
  const rejectedQueueItemIds = [...new Set(anchoredCandidates.filter((candidate) =>
    ["REJECTED", "BLOCKED"].includes(text(candidate.machine_state)))
    .map((candidate) => text(candidate.queue_item_id)).filter(Boolean))]
  const { data: decisionLinks, error: decisionLinkError } = rejectedQueueItemIds.length
    ? await supabase.from("marketplace_listing_approval_queue_items")
      .select("id,decision_package_id,package_hash,stale_after")
      .in("id", rejectedQueueItemIds)
    : { data: [], error: null }
  if (decisionLinkError) throw new Error("SAME_DAY_PILOT_DECISION_EXPLANATION_LINK_READ_FAILED")
  const decisionPackageIds = [...new Set((decisionLinks ?? [])
    .map((entry) => text(entry.decision_package_id)).filter(Boolean))]
  const { data: decisionRows, error: decisionError } = decisionPackageIds.length
    ? await supabase.from("marketplace_listing_decision_packages")
      .select("id,package_hash,verdict,status,generated_at,economics:package_payload->economics,comparable_counts:package_payload->comparables->counts,decision_summary:package_payload->decision")
      .in("id", decisionPackageIds)
    : { data: [], error: null }
  if (decisionError) throw new Error("SAME_DAY_PILOT_DECISION_EXPLANATION_READ_FAILED")
  const decisionById = new Map((decisionRows ?? []).map((entry) => [text(entry.id), record(entry)]))
  const decisionLinkByQueueItem = new Map((decisionLinks ?? []).map((entry) => [text(entry.id), record(entry)]))
  const candidatesWithDecision = anchoredCandidates.map((candidate) => {
    const decisionLink = decisionLinkByQueueItem.get(text(candidate.queue_item_id)) ?? {}
    const decision = decisionById.get(text(decisionLink.decision_package_id)) ?? {}
    if (!text(decision.id)) return candidate
    const economics = record(decision.economics)
    const comparableCounts = record(decision.comparable_counts)
    const decisionBlock = record(decision.decision_summary)
    const staleAfter = text(decisionLink.stale_after)
    const staleAfterMs = Date.parse(staleAfter)
    return {
      ...candidate,
      commercial_decision_summary: {
        verdict: text(decision.verdict),
        status: text(decision.status),
        generatedAt: text(decision.generated_at),
        staleAfter: staleAfter || null,
        fresh: Number.isFinite(staleAfterMs) && staleAfterMs > now.getTime(),
        packageHashMatches: Boolean(text(decisionLink.package_hash) &&
          text(decisionLink.package_hash) === text(decision.package_hash)),
        economics: {
          activeMarketMedian: number(economics.activeMarketMedian),
          minimumSafePrice: number(economics.minimumSafePrice),
          marketSupportsMinimumSafePrice: economics.marketSupportsMinimumSafePrice === true,
        },
        evidence: {
          activeExactCount: number(comparableCounts.activeExact) ?? 0,
          confirmedSoldExact: number(comparableCounts.confirmedSoldExact) ?? 0,
        },
        blockers: strings(decisionBlock.blockers),
      },
    }
  })
  const explainedCandidates = candidatesWithDecision.map((candidate) => {
    if (!['REJECTED', 'BLOCKED'].includes(text(candidate.machine_state))) return candidate
    const controlledRisk = controlledRiskEvaluationForCandidate(record(candidate))
    return {
      ...candidate,
      controlled_risk_override_preview: {
        available: controlledRisk.evaluation.available,
        blockers: controlledRisk.evaluation.blockers,
        minimumRiskPrice: controlledRisk.evaluation.minimumRiskPrice,
        maximumCompetitivePrice: controlledRisk.evaluation.maximumCompetitivePrice,
        confirmedSoldExactQuantity: controlledRisk.evaluation.confirmedSoldExactQuantity,
        exactSoldReference: controlledRisk.exactSoldReference,
        policy: controlledRisk.evaluation.policy,
      },
    }
  })
  const cycleRunRows = cycleRuns ?? []
  const cycleRunIds = cycleRunRows.map((cycleRun) => text(cycleRun.id)).filter(Boolean)
  const { data: historicalCandidates, error: historicalCandidateError } = cycleRunIds.length
    ? await supabase.from("ebay_same_day_pilot_candidates")
      .select("run_id,machine_state,opportunity_id,candidate_key,supplier_variant_id,family_fingerprint")
      .in("run_id", cycleRunIds)
    : { data: [], error: null }
  if (historicalCandidateError) throw new Error("SAME_DAY_PILOT_HISTORY_READ_FAILED")
  const effectiveQuotaLanes = (quotaStates ?? []).map((lane) =>
    projectEffectiveEbayQuotaLane(lane, now))
  const projectedRun = {
    ...run,
    quota_snapshot: {
      ...record(run.quota_snapshot),
      lanes: effectiveQuotaLanes,
      observedAt: now.toISOString(),
    },
  }
  const legacyNextCandidateCycle = canStartNextSameDayCandidateCycle({
    runStatus: text(run.status),
    cycle: number(run.cycle) ?? 1,
    candidateMachineStates: explainedCandidates.map((candidate) =>
      text(candidate.machine_state)),
    openHumanTasks: (tasks ?? []).filter((task) => task.status === "OPEN").length,
    dueOrLeasedJobs: (jobs ?? []).filter((job) =>
      ["PENDING", "WAITING_RETRY", "LEASED"].includes(text(job.status))).length,
    verifiedNewListings: number(run.verified_new_listings) ?? 0,
    targetNewListings: number(run.target_new_listings) ?? 2,
    activeWorkerLease: Date.parse(text(run.worker_lease_expires_at)) > now.getTime(),
    productResearchPlanSettled: !productResearchPlanId || (!productResearchPlanError
      && ["COMPLETED", "SUPERSEDED"].includes(text(productResearchPlan?.status))),
    nextCandidateSetExhausted: record(run.source_inventory).nextCandidateSetExhausted === true,
  })
  const nextCandidateCycle = legacyNextCandidateCycle.allowed &&
    (number(run.target_new_listings) ?? 2) > 2
    ? { ...legacyNextCandidateCycle, allowed: false,
        reason: "AUTOMATIC_SAME_RUN_REPLENISHMENT_PENDING" }
    : legacyNextCandidateCycle
  const verifiedPilotProgress = Math.min(3, Math.max(0, ...cycleRunRows.map((cycleRun) =>
    (number(cycleRun.verified_existing_listings) ?? 0)
      + (number(cycleRun.verified_new_listings) ?? 0))))
  const historicalRows = historicalCandidates ?? []
  const cycleHistory = {
    cycles: cycleRunRows.length,
    attemptedCandidates: historicalRows.length,
    rejectedCandidates: historicalRows.filter((candidate) =>
      ["REJECTED", "BLOCKED"].includes(text(candidate.machine_state))).length,
    verifiedPilotProgress,
    remainingPilotListings: Math.max(0, 3 - verifiedPilotProgress),
  }
  return {
    run: projectedRun,
    candidates: explainedCandidates,
    tasks: tasks ?? [],
    transitions: transitions ?? [],
    jobs: jobs ?? [],
    handoffs: handoffs ?? [],
    nextCandidateCycle,
    cycleHistory,
  }
}

async function transition(input: {
  supabase: SupabaseClient; runId: string; candidateId: string; previousState: string; nextState: string
  reasonCode: string; triggeredBy: "SYSTEM" | "USER" | "SCHEDULER" | "RETRY"; checkpoint?: JsonRecord
  nextAutomaticAction: string; nextHumanAction: string; attempt?: number; job?: PilotJobSpec
}) {
  const startedAt = new Date().toISOString()
  const completedAt = new Date().toISOString()
  const evidenceHash = hash({ candidateId: input.candidateId, previousState: input.previousState, nextState: input.nextState,
    reasonCode: input.reasonCode, checkpoint: input.checkpoint ?? {} })
  const idempotencyKey = `${input.runId}:${input.candidateId}:${input.nextState}:${evidenceHash}`
  const { data, error } = await input.supabase.rpc("advance_same_day_pilot_candidate", {
    p_run_id: input.runId,
    p_candidate_id: input.candidateId,
    p_expected_previous_state: input.previousState,
    p_next_state: input.nextState,
    p_reason_code: input.reasonCode,
    p_triggered_by: input.triggeredBy,
    p_started_at: startedAt,
    p_completed_at: completedAt,
    p_attempt: input.attempt ?? 1,
    p_checkpoint: input.checkpoint ?? {},
    p_evidence_hash: evidenceHash,
    p_transition_idempotency_key: idempotencyKey,
    p_next_automatic_action: input.nextAutomaticAction,
    p_next_human_action: input.nextHumanAction,
    p_job_type: input.job?.jobType ?? null,
    p_job_idempotency_key: input.job?.idempotencyKey ?? null,
    p_job_checkpoint: input.job?.checkpoint ?? {},
    p_job_available_at: input.job?.availableAt ?? completedAt,
    p_job_max_attempts: input.job?.maxAttempts ?? 4,
    p_api_family: input.job?.apiFamily ?? null,
    p_api_operation: input.job?.apiOperation ?? null,
    p_owner_lane: input.job?.ownerLane ?? null,
  })
  if (error) throw new Error("SAME_DAY_PILOT_TRANSITION_PERSIST_FAILED")
  if (data === "STALE") throw new Error("SAME_DAY_PILOT_STALE_TRANSITION")
}

async function enqueuePilotJob(input: {
  supabase: SupabaseClient
  runId: string
  candidateId: string
  job: PilotJobSpec
}) {
  const { error } = await input.supabase.from("ebay_same_day_pilot_jobs").upsert({
    run_id: input.runId,
    candidate_id: input.candidateId,
    job_type: input.job.jobType,
    idempotency_key: input.job.idempotencyKey,
    checkpoint: input.job.checkpoint ?? {},
    available_at: input.job.availableAt ?? new Date().toISOString(),
    max_attempts: input.job.maxAttempts ?? 4,
    api_family: input.job.apiFamily ?? null,
    api_operation: input.job.apiOperation ?? null,
    owner_lane: input.job.ownerLane ?? null,
  }, { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (error) throw new Error("SAME_DAY_PILOT_JOB_ENQUEUE_FAILED")
}

type SerializedOpenHumanTask = {
  id: string
  candidate_id: string
  gate_type: string
  created_at: string
}

async function serializeOpenHumanTasksForRun(supabase: SupabaseClient, runId: string) {
  const { data, error } = await supabase.from("ebay_same_day_pilot_human_tasks")
    .select("id,candidate_id,gate_type,created_at")
    .eq("run_id", runId)
    .eq("status", "OPEN")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
  if (error) throw new Error("SAME_DAY_PILOT_OPEN_TASK_SERIALIZATION_READ_FAILED")
  const openTasks = (data ?? []).map((task) => ({
    id: text(task.id),
    candidate_id: text(task.candidate_id),
    gate_type: text(task.gate_type),
    created_at: text(task.created_at),
  })).filter((task) => task.id) as SerializedOpenHumanTask[]
  // Required-fact corrections are a non-terminal inbox: several candidates
  // may wait for one precise manual value while the rest of the batch keeps
  // moving. Decision, capture and publication gates remain serialized.
  const correctionTasks = openTasks.filter((task) =>
    task.gate_type === "CRITICAL_EXCEPTION_REQUIRED")
  const primaryTasks = openTasks.filter((task) =>
    task.gate_type !== "CRITICAL_EXCEPTION_REQUIRED")
  const primaryOpenTask = primaryTasks[0] ?? null
  const seenCorrectionCandidates = new Set<string>()
  const duplicateCorrectionIds: string[] = []
  for (const task of correctionTasks) {
    if (seenCorrectionCandidates.has(task.candidate_id)) {
      duplicateCorrectionIds.push(task.id)
    } else {
      seenCorrectionCandidates.add(task.candidate_id)
    }
  }
  const duplicateIds = [
    ...primaryTasks.slice(1).map((task) => task.id),
    ...duplicateCorrectionIds,
  ]
  if (duplicateIds.length) {
    const completedAt = new Date().toISOString()
    const { error: supersedeError } = await supabase.from("ebay_same_day_pilot_human_tasks").update({
      status: "SUPERSEDED", completed_at: completedAt, updated_at: completedAt,
    }).eq("run_id", runId).eq("status", "OPEN").in("id", duplicateIds)
    if (supersedeError) throw new Error("SAME_DAY_PILOT_OPEN_TASK_SERIALIZATION_FAILED")
  }
  return { openTask: primaryOpenTask ?? correctionTasks[0] ?? null,
    primaryOpenTask, correctionTasks, openTasks, superseded: duplicateIds.length }
}

async function createHumanTask(input: {
  supabase: SupabaseClient; runId: string; candidateId: string; expectedState: string; gateType: string; title: string; why: string
  seconds: number; impact: string; evidence: JsonRecord; actionSchema: JsonRecord; continuationJobType: string
}) {
  const before = await serializeOpenHumanTasksForRun(input.supabase, input.runId)
  const correctionTask = input.gateType === "CRITICAL_EXCEPTION_REQUIRED"
  const existingSameTask = before.openTasks.find((task) =>
    task.candidate_id === input.candidateId && task.gate_type === input.gateType)
  if (existingSameTask) return true
  if (!correctionTask && before.primaryOpenTask) return false
  const { data, error } = await input.supabase.rpc("ensure_same_day_pilot_human_task", {
    p_run_id: input.runId, p_candidate_id: input.candidateId, p_expected_machine_state: input.expectedState,
    p_gate_type: input.gateType, p_title: input.title, p_why_needed: input.why,
    p_estimated_seconds: input.seconds, p_impact: input.impact, p_evidence_summary: input.evidence,
    p_action_schema: input.actionSchema, p_continuation_job_type: input.continuationJobType,
  })
  if (error) throw new Error("SAME_DAY_PILOT_HUMAN_TASK_PERSIST_FAILED")
  // The SQL helper serializes per candidate. This second pass closes the
  // cross-candidate race for primary decisions. Correction tasks intentionally
  // coexist across candidates so one missing required field cannot stop a lot.
  const after = await serializeOpenHumanTasksForRun(input.supabase, input.runId)
  return after.openTasks.some((task) => task.id === text(data) ||
    (task.candidate_id === input.candidateId && task.gate_type === input.gateType))
}

async function completeAndAdvanceHumanGate(input: {
  supabase: SupabaseClient
  taskId: string
  gateType: string
  runId: string
  candidateId: string
  previousState: string
  nextState: string
  reasonCode: string
  triggeredBy: "SYSTEM" | "USER"
  checkpoint?: JsonRecord
  candidatePatch?: JsonRecord
  nextAutomaticAction: string
  nextHumanAction: string
  job?: PilotJobSpec
}) {
  const startedAt = new Date().toISOString()
  const completedAt = new Date().toISOString()
  const checkpoint = input.checkpoint ?? {}
  // taskId is the durable generation of a human gate. The same candidate can
  // legitimately revisit the same state with the same capture batch and
  // checkpoint later. Scoping both ledgers to this task prevents an older
  // COMPLETED transition/job from swallowing the new continuation.
  const evidenceHash = hash({ taskId: input.taskId,
    candidateId: input.candidateId, previousState: input.previousState,
    nextState: input.nextState, reasonCode: input.reasonCode, checkpoint })
  const idempotencyKey = `${input.runId}:${input.candidateId}:${input.nextState}:${evidenceHash}`
  const jobIdempotencyKey = input.job
    ? `${input.job.idempotencyKey}:GATE:${input.taskId}`
    : null
  const { data, error } = await input.supabase.rpc("complete_and_advance_same_day_pilot_gate_v1", {
    p_task_id: input.taskId, p_run_id: input.runId, p_candidate_id: input.candidateId,
    p_expected_gate_type: input.gateType, p_expected_previous_state: input.previousState,
    p_next_state: input.nextState, p_reason_code: input.reasonCode, p_triggered_by: input.triggeredBy,
    p_started_at: startedAt, p_completed_at: completedAt, p_attempt: 1,
    p_checkpoint: checkpoint, p_evidence_hash: evidenceHash,
    p_transition_idempotency_key: idempotencyKey,
    p_next_automatic_action: input.nextAutomaticAction, p_next_human_action: input.nextHumanAction,
    p_candidate_patch: input.candidatePatch ?? {}, p_job_type: input.job?.jobType ?? null,
    p_job_idempotency_key: jobIdempotencyKey,
    p_job_checkpoint: input.job?.checkpoint ?? {}, p_job_available_at: input.job?.availableAt ?? completedAt,
    p_job_max_attempts: input.job?.maxAttempts ?? 4, p_api_family: input.job?.apiFamily ?? null,
    p_api_operation: input.job?.apiOperation ?? null, p_owner_lane: input.job?.ownerLane ?? null,
  })
  if (error) throw new Error("SAME_DAY_PILOT_HUMAN_GATE_COMMIT_FAILED")
  if (!['ADVANCED', 'IDEMPOTENT'].includes(text(data))) throw new Error("SAME_DAY_PILOT_HUMAN_GATE_RESULT_INVALID")
}

async function activateCandidateProductResearchPlan(
  supabase: SupabaseClient,
  runId: string,
  candidate: JsonRecord,
) {
  const planId = text(record(candidate.product_research_query_plan).productResearchPlanId)
  if (!planId) return
  const { data: run, error: readError } = await supabase
    .from("ebay_same_day_pilot_runs")
    .select("source_inventory")
    .eq("id", runId)
    .single()
  if (readError) throw new Error("SAME_DAY_PILOT_PRODUCT_RESEARCH_PLAN_ACTIVATION_READ_FAILED")
  const sourceInventory = record(run.source_inventory)
  if (text(sourceInventory.productResearchPlanId) === planId) return
  const { error: updateError } = await supabase
    .from("ebay_same_day_pilot_runs")
    .update({
      source_inventory: {
        ...sourceInventory,
        productResearchPlanId: planId,
        productResearchPlanActivatedForCandidateId: text(candidate.id),
        productResearchPlanActivatedAt: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId)
  if (updateError) throw new Error("SAME_DAY_PILOT_PRODUCT_RESEARCH_PLAN_ACTIVATION_FAILED")
}

async function bootstrapCandidate(supabase: SupabaseClient, runId: string, candidate: JsonRecord) {
  const id = text(candidate.id)
  let machineState = text(candidate.machine_state) || "RUN_CREATED"
  if (machineState === "RUN_CREATED") {
    await transition({ supabase, runId, candidateId: id, previousState: "RUN_CREATED", nextState: "LOCAL_FILTERING",
      reasonCode: "LOCAL_GATES_EVALUATED", triggeredBy: "SYSTEM", nextAutomaticAction: "Seleccionar candidato.", nextHumanAction: "Ninguna." })
    machineState = "LOCAL_FILTERING"
  }
  if (machineState === "LOCAL_FILTERING") {
    await transition({ supabase, runId, candidateId: id, previousState: "LOCAL_FILTERING", nextState: "CANDIDATE_SELECTION",
      reasonCode: "CANDIDATE_SELECTED_WITHOUT_EBAY_CALL", triggeredBy: "SYSTEM", nextAutomaticAction: "Preparar consulta exacta.", nextHumanAction: "Ninguna." })
    machineState = "CANDIDATE_SELECTION"
  }
  if (machineState === "CANDIDATE_SELECTION") {
    await transition({ supabase, runId, candidateId: id, previousState: "CANDIDATE_SELECTION", nextState: "PRODUCT_RESEARCH_PLAN_READY",
      reasonCode: "EXACT_QUERY_PREPARED", triggeredBy: "SYSTEM", checkpoint: record(candidate.product_research_query_plan),
      nextAutomaticAction: "Esperar autorización de captura visible.", nextHumanAction: "Autorizar una captura Product Research." })
    machineState = "PRODUCT_RESEARCH_PLAN_READY"
  }
  if (machineState === "PRODUCT_RESEARCH_PLAN_READY" && candidate.state === "NEEDS_PRODUCT_RESEARCH_CAPTURE") {
    const reusableCaptureBatchId = text(candidate.product_research_capture_batch_id)
    if (reusableCaptureBatchId) {
      await transition({ supabase, runId, candidateId: id, previousState: "PRODUCT_RESEARCH_PLAN_READY", nextState: "IMPORTING_SOLD_EVIDENCE",
        reasonCode: "FAMILY_CAPTURE_REUSED_AUTOMATICALLY", triggeredBy: "SYSTEM",
        checkpoint: { captureBatchId: reusableCaptureBatchId }, nextAutomaticAction: "Reconciliar la evidencia ya autorizada para esta variante.", nextHumanAction: "Ninguna." })
      await transition({ supabase, runId, candidateId: id, previousState: "IMPORTING_SOLD_EVIDENCE", nextState: "RECONCILING_IDENTITY",
        reasonCode: "GROUPED_SOLD_EVIDENCE_LINKED", triggeredBy: "SYSTEM",
        checkpoint: { captureBatchId: reusableCaptureBatchId }, nextAutomaticAction: "Reconciliar sólo las referencias de este candidato.", nextHumanAction: "Ninguna.",
        job: { jobType: "RECONCILE_PRODUCT_RESEARCH_CAPTURE",
          idempotencyKey: `${runId}:${id}:RECONCILE_PRODUCT_RESEARCH_CAPTURE:${reusableCaptureBatchId}`,
          checkpoint: { captureBatchId: reusableCaptureBatchId, supplierVariantId: candidate.supplier_variant_id,
            capturedAt: new Date().toISOString() }, maxAttempts: 10,
          apiFamily: "BROWSE", apiOperation: "EXACT_VERIFICATION", ownerLane: "P1_EXACT_VERIFICATION" } })
      return
    }
    await transition({ supabase, runId, candidateId: id, previousState: "PRODUCT_RESEARCH_PLAN_READY", nextState: "WAITING_PRODUCT_RESEARCH_CAPTURE",
      reasonCode: "PRODUCT_RESEARCH_CAPTURE_REQUIRED", triggeredBy: "SYSTEM", nextAutomaticAction: "Importar, reconciliar y reanalizar al recibir la captura.",
      nextHumanAction: "Abrir la consulta preparada y pulsar Capturar y continuar una vez." })
    machineState = "WAITING_PRODUCT_RESEARCH_CAPTURE"
  } else if (machineState === "PRODUCT_RESEARCH_PLAN_READY") {
    await transition({ supabase, runId, candidateId: id, previousState: "PRODUCT_RESEARCH_PLAN_READY", nextState: "WAITING_LUNA_CONFIRMATION",
      reasonCode: "LUNA_CONFIRMATION_REQUIRED", triggeredBy: "SYSTEM", nextAutomaticAction: "Recalcular economía y enriquecer facts.",
      nextHumanAction: "Confirmar precio y disponibilidad visibles en Luna." })
    machineState = "WAITING_LUNA_CONFIRMATION"
  }
  if (machineState === "WAITING_PRODUCT_RESEARCH_CAPTURE") {
    const evidence = record(candidate.evidence_summary)
    const visualMarketRecapture =
      text(evidence.visualMarketRecaptureRecoveryVersion) ===
        VISUAL_MARKET_RECAPTURE_RECOVERY_VERSION
    if (visualMarketRecapture && (
      candidate.state !== "NEEDS_PRODUCT_RESEARCH_CAPTURE" ||
      text(candidate.product_research_capture_batch_id) ||
      !strings(candidate.blockers).includes("VISUAL_MARKET_EVIDENCE_REQUIRED")
    )) {
      const { error } = await supabase.from("ebay_same_day_pilot_candidates")
        .update({
          state: "NEEDS_PRODUCT_RESEARCH_CAPTURE",
          blockers: ["VISUAL_MARKET_EVIDENCE_REQUIRED"],
          product_research_capture_batch_id: null,
          next_automated_action:
            "Validar la nueva evidencia visual y reanudar desde el paquete ya aprobado.",
          next_human_action:
            "Recapturar una sola vez la consulta Product Research preparada.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("run_id", runId)
        .eq("machine_state", "WAITING_PRODUCT_RESEARCH_CAPTURE")
      if (error) {
        throw new Error("SAME_DAY_PILOT_VISUAL_RECAPTURE_CANDIDATE_REPAIR_FAILED")
      }
      candidate = {
        ...candidate,
        state: "NEEDS_PRODUCT_RESEARCH_CAPTURE",
        blockers: ["VISUAL_MARKET_EVIDENCE_REQUIRED"],
        product_research_capture_batch_id: null,
      }
    }
    await activateCandidateProductResearchPlan(supabase, runId, candidate)
    await createHumanTask({ supabase, runId, candidateId: id, expectedState: "WAITING_PRODUCT_RESEARCH_CAPTURE", gateType: "PRODUCT_RESEARCH_CAPTURE_REQUIRED",
      title: visualMarketRecapture
        ? "Recaptura Product Research con análisis visual"
        : "Captura Product Research para esta familia",
      why: visualMarketRecapture
        ? "La evidencia comercial ya es válida, pero las miniaturas de la captura anterior no produjeron señales visuales utilizables para diseñar el listing."
        : "Falta evidencia vendida exacta y fresca para decidir sin confundir resultados amplios con demanda.",
      seconds: 60,
      impact: visualMarketRecapture
        ? "Seller OS conservará identidad, economía, ficha y aprobación; sólo reconstruirá la evidencia visual y continuará automáticamente."
        : "La captura enriquecerá la familia y Seller OS continuará automáticamente.",
      evidence: { product: candidate.product_title,
        queryPlan: candidate.product_research_query_plan,
        commercialEvidencePreserved: visualMarketRecapture,
        requiredVisualPatternSchemaVersion:
          visualMarketRecapture ? PRODUCT_RESEARCH_VISUAL_PATTERN_SCHEMA_VERSION : null,
        requiredVisualPatternAlgorithmVersion:
          visualMarketRecapture ? PRODUCT_RESEARCH_VISUAL_PATTERN_ALGORITHM_VERSION : null,
        requiredVisualMarketBriefVersion:
          visualMarketRecapture ? VISUAL_MARKET_BRIEF_VERSION : null },
      actionSchema: { type: "OPEN_PRODUCT_RESEARCH",
        query: record(candidate.product_research_query_plan).query,
        requiresVisualPatternCapture: visualMarketRecapture,
        requiredVisualPatternSchemaVersion:
          visualMarketRecapture ? PRODUCT_RESEARCH_VISUAL_PATTERN_SCHEMA_VERSION : null,
        requiredVisualPatternAlgorithmVersion:
          visualMarketRecapture ? PRODUCT_RESEARCH_VISUAL_PATTERN_ALGORITHM_VERSION : null },
      continuationJobType: visualMarketRecapture
        ? "RECONCILE_PRODUCT_RESEARCH_CAPTURE"
        : "IMPORT_SOLD_EVIDENCE" })
    return
  }
  if (machineState === "WAITING_LUNA_CONFIRMATION") {
    const selectionIdentity = record(record(candidate.evidence_summary).selectionIdentity)
    const identityConfirmationRequired = selectionIdentity.confirmationRequired === true &&
      selectionIdentity.independentlyVerified !== true
    await createHumanTask({ supabase, runId, candidateId: id, expectedState: "WAITING_LUNA_CONFIRMATION", gateType: "LUNA_CONFIRMATION_REQUIRED",
      title: "Confirma producto, presentación, precio y stock Luna",
      why: identityConfirmationRequired
        ? "Luna aún no entregó identidad estructurada suficiente; confirma visualmente el producto exacto y cuántas unidades contiene la presentación comprada."
        : "El costo, stock y número físico de unidades de la presentación deben quedar ligados a la misma página exacta antes de calcular el listing.", seconds: 45,
      impact: "Seller OS recalculará economía y ejecutará Product Facts automáticamente.", evidence: { product: candidate.product_title, sku: candidate.supplier_sku },
      actionSchema: { type: "LUNA_CONFIRMATION", fields: ["price", "availability", "quantityIfVisible",
        "identityAndPackConfirmed", "nativePackCount"] }, continuationJobType: "CALCULATE_ECONOMICS" })
    return
  }
  if (machineState === "WAITING_PRODUCT_APPROVAL") {
    const economics = record(candidate.economics_summary)
    const priorApprovedPrice = number(economics.operatorApprovedSalePrice)
    const recommendedPrice = number(
      record(economics.pricingRecommendation).recommendedSalePrice,
    )
    const priorPriceApprovalChanged = economics.operatorPriceApproved === true &&
      priorApprovedPrice !== null &&
      recommendedPrice !== null &&
      Math.abs(priorApprovedPrice - recommendedPrice) >
        Math.max(.01, recommendedPrice * .02)
    await createHumanTask({ supabase, runId, candidateId: id, expectedState: "WAITING_PRODUCT_APPROVAL", gateType: "PRODUCT_APPROVAL_REQUIRED",
      title: priorPriceApprovalChanged
        ? "Confirma el precio actualizado del producto"
        : "Revisa el producto y confirma su fulfillment",
      why: priorPriceApprovalChanged
        ? `La ficha y la aprobación anterior siguen vigentes, pero el precio recomendado cambió de $${priorApprovedPrice.toFixed(2)} a $${recommendedPrice.toFixed(2)}. El stock vencido no bloquea este paso y se reconfirmará antes de publicar o comprar.`
        : "La identidad, economía y ficha técnica pasaron; antes de preparar el listing debes confirmar inventario propio o un acuerdo vigente con proveedor mayorista autorizado.",
      seconds: 180, impact: "Seller OS conservará el checkpoint y continuará automáticamente sólo después de una aprobación explícita.",
      evidence: { product: candidate.product_title, economics: candidate.economics_summary,
        facts: candidate.product_facts_summary,
        approvalReviewReason: priorPriceApprovalChanged
          ? "RECOMMENDED_PRICE_CHANGED"
          : "INITIAL_PRODUCT_APPROVAL",
        priorApprovedPrice, recommendedPrice,
        staleSupplyBlocksAnalysis: false,
        staleSupplyRecheckAt: "FINAL_PUBLICATION_OR_PURCHASE_GATE" },
      actionSchema: { type: "PRODUCT_APPROVAL", actions: ["APPROVE", "REQUEST_ONE_REVISION", "REJECT"],
        fields: ["operatorSalePrice", "fulfillmentBasis", "imageRightsConfirmed",
          "openAiImageSpendApproved"],
        allowedFulfillmentBases: ["OWNED_INVENTORY", "AUTHORIZED_WHOLESALE_FULFILLMENT_AGREEMENT"] },
      continuationJobType: "GENERATE_LISTING_CONTENT" })
    return
  }
  if (machineState === "WAITING_IMAGE_APPROVAL") {
    await createHumanTask({ supabase, runId, candidateId: id, expectedState: "WAITING_IMAGE_APPROVAL", gateType: "IMAGE_APPROVAL_REQUIRED",
      title: "Revisa el set completo de siete imágenes", why: "Debes confirmar que el producto autorizado, pack, variante, textos y elementos incluidos son exactos.",
      seconds: 120, impact: "Seller OS publicará internamente el set aprobado y preparará el paquete para tu autorización final dentro del sistema.",
      evidence: { product: candidate.product_title, imagePackage: candidate.image_package_summary },
      actionSchema: { type: "IMAGE_APPROVAL", actions: ["APPROVE", "REJECT"], expectedImages: 7,
        maximumOpenAiCalls: 1 }, continuationJobType: "APPROVE_SIX_IMAGE_SET" })
  }
}

async function repairProcessedProductResearchCaptureGate(
  supabase: SupabaseClient,
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
  accountKey: string,
) {
  const waitingQueries = new Set(state.candidates.filter((candidate) =>
    candidate.machine_state === "WAITING_PRODUCT_RESEARCH_CAPTURE" &&
    state.tasks.some((task) => task.candidate_id === candidate.id &&
      task.gate_type === "PRODUCT_RESEARCH_CAPTURE_REQUIRED" && task.status === "OPEN"))
    .map((candidate) => productResearchPlannedQueryHash(
      record(candidate.product_research_query_plan).query,
    )))
  if (!waitingQueries.size) return false
  const planId = text(record(state.run.source_inventory).productResearchPlanId)
  if (!planId) return false
  const { data: processedTasks, error } = await supabase
    .from("marketplace_product_research_query_tasks")
    .select("search_query,capture_batch_id,captured_at")
    .eq("plan_id", planId)
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", MARKETPLACE)
    .eq("status", "PROCESSED")
    .not("capture_batch_id", "is", null)
    .order("ordinal")
  if (error) throw new Error("SAME_DAY_PILOT_PROCESSED_CAPTURE_REPAIR_READ_FAILED")
  for (const task of processedTasks ?? []) {
    const searchQuery = text(task.search_query, 100)
    const captureBatchId = text(task.capture_batch_id)
    if (!searchQuery || !captureBatchId ||
      !waitingQueries.has(productResearchPlannedQueryHash(searchQuery))) continue
    const result = await resumeSameDayPilotAfterProductResearchCapture({
      supabase,
      accountKey,
      searchQuery,
      batchId: captureBatchId,
      capturedAt: text(task.captured_at) || null,
    })
    if (result.resumed > 0) return true
  }
  return false
}

const LEGACY_PREMATURE_NO_EXACT_REASON = "NO_EXACT_LUNA_MATCH_IN_AUTHORIZED_CAPTURE"

async function repairLegacyPrematureProductResearchRejections(
  supabase: SupabaseClient,
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
  accountKey: string,
) {
  const candidates = state.candidates.filter((candidate) => {
    const blockers = strings(candidate.blockers)
    return candidate.machine_state === "REJECTED" && candidate.state === "REJECTED_TODAY" &&
      blockers.length === 1 && blockers[0] === LEGACY_PREMATURE_NO_EXACT_REASON &&
      text(candidate.product_research_capture_batch_id) && text(candidate.queue_item_id) &&
      text(candidate.supplier_variant_id)
  })
  if (!candidates.length) return 0
  const planId = text(record(state.run.source_inventory).productResearchPlanId)
  if (!planId) return 0
  const { data: plan, error: planError } = await supabase
    .from("marketplace_product_research_query_plans")
    .select("id,run_id,status")
    .eq("id", planId)
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", MARKETPLACE)
    .eq("status", "COMPLETED")
    .maybeSingle()
  if (planError) throw new Error("SAME_DAY_PILOT_LEGACY_REPAIR_PLAN_READ_FAILED")
  if (!plan?.run_id) return 0
  const [{ data: tasks, error: taskError }, { data: queueItems, error: queueItemError }] =
    await Promise.all([
      supabase.from("marketplace_product_research_query_tasks")
        .select("id,search_query,capture_batch_id,captured_at")
        .eq("plan_id", plan.id)
        .eq("marketplace_account_key", accountKey)
        .eq("marketplace", MARKETPLACE)
        .eq("status", "PROCESSED")
        .not("capture_batch_id", "is", null),
      supabase.from("marketplace_listing_approval_queue_items")
        .select("id,run_id,supplier_variant_id")
        .eq("run_id", plan.run_id)
        .eq("marketplace_account_key", accountKey)
        .eq("marketplace", MARKETPLACE)
        .in("id", candidates.map((candidate) => candidate.queue_item_id)),
    ])
  if (taskError || queueItemError) throw new Error("SAME_DAY_PILOT_LEGACY_REPAIR_BINDING_READ_FAILED")
  const queueItemsById = new Map((queueItems ?? []).map((item) => [text(item.id), item]))
  let repaired = 0
  for (const candidate of candidates) {
    const captureBatchId = text(candidate.product_research_capture_batch_id)
    const supplierVariantId = text(candidate.supplier_variant_id)
    const queueItem = queueItemsById.get(text(candidate.queue_item_id))
    if (!captureBatchId || !supplierVariantId || !queueItem ||
      text(queueItem.supplier_variant_id) !== supplierVariantId) continue
    const queryHash = productResearchPlannedQueryHash(
      record(candidate.product_research_query_plan).query,
    )
    const task = (tasks ?? []).find((entry) =>
      text(entry.capture_batch_id) === captureBatchId &&
      productResearchPlannedQueryHash(entry.search_query) === queryHash)
    if (!task) continue
    await transition({ supabase, runId: state.run.id, candidateId: text(candidate.id),
      previousState: "REJECTED", nextState: "RECONCILING_IDENTITY",
      reasonCode: "LEGACY_PREMATURE_NO_EXACT_REPAIR", triggeredBy: "SYSTEM",
      checkpoint: { planId: plan.id, taskId: task.id, captureBatchId,
        previousReason: LEGACY_PREMATURE_NO_EXACT_REASON },
      nextAutomaticAction: "Reconciliar la captura ya importada contra la variante planificada.",
      nextHumanAction: "Ninguna.",
      job: { jobType: "RECONCILE_PRODUCT_RESEARCH_CAPTURE",
        idempotencyKey: `${state.run.id}:${candidate.id}:RECONCILE_PRODUCT_RESEARCH_CAPTURE:${captureBatchId}:${PRODUCT_RESEARCH_IDENTITY_RECONCILIATION_VERSION}`,
        checkpoint: { captureBatchId, supplierVariantId,
          capturedAt: text(task.captured_at) || new Date().toISOString(),
          legacyPrematureRejectionRepair: true }, maxAttempts: 10,
        apiFamily: "BROWSE", apiOperation: "EXACT_VERIFICATION",
        ownerLane: "P1_EXACT_VERIFICATION" } })
    const { error: candidateError } = await supabase.from("ebay_same_day_pilot_candidates")
      .update({ state: "NEEDS_PRODUCT_RESEARCH_CAPTURE", blockers: [],
        evidence_summary: { ...record(candidate.evidence_summary),
          legacyPrematureRejectionRepaired: true,
          reconciliationVersion: PRODUCT_RESEARCH_IDENTITY_RECONCILIATION_VERSION },
        updated_at: new Date().toISOString() })
      .eq("id", candidate.id).eq("run_id", state.run.id)
      .eq("machine_state", "RECONCILING_IDENTITY")
    if (candidateError) throw new Error("SAME_DAY_PILOT_LEGACY_REPAIR_CANDIDATE_UPDATE_FAILED")
    repaired += 1
  }
  if (repaired) await refreshRunProjection(supabase, state.run.id)
  return repaired
}

/**
 * A superseded Taxonomy rule used to turn unresolved fields and incomplete
 * eBay suggestion samples into terminal rejections. Re-run only Product Facts
 * and Taxonomy, preserving Luna, Product Research and every valid commercial
 * authorization. Operator and out-of-stock rejections are never reopened.
 */
async function repairPrematureTaxonomyRejections(
  supabase: SupabaseClient,
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
  now: Date,
) {
  const recoverableBlockers = new Set([
    "MISSING_BLOCKING",
    "EBAY_TAXONOMY_NOT_READY",
    "EBAY_REQUIRED_ASPECTS_NOT_READY_TODAY",
  ])
  const candidate = [...state.candidates]
    .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    .find((entry) => {
      const blockers = strings(entry.blockers)
      const evidence = record(entry.evidence_summary)
      const systemTaxonomyFailure = blockers.some((blocker) =>
        recoverableBlockers.has(blocker) ||
        blocker.startsWith("ASPECT_VALUE_NOT_ALLOWED_"))
      return entry.machine_state === "REJECTED" &&
        entry.state === "REJECTED_TODAY" && systemTaxonomyFailure &&
        !blockers.includes("LUNA_OUT_OF_STOCK") &&
        !blockers.includes("PRODUCT_REJECTED_BY_OPERATOR") &&
        text(entry.queue_item_id) && text(entry.supplier_variant_id) &&
        text(evidence.prematureTaxonomyRejectionRecoveryVersion) !==
          PREMATURE_TAXONOMY_REJECTION_RECOVERY_VERSION
    })
  if (!candidate) return 0
  await cancelSupersededProductFactsDeadLetters({
    supabase,
    runId: state.run.id,
    candidateId: text(candidate.id),
    now,
  })
  const previousBlockers = strings(candidate.blockers)
  const priorApprovalPreserved = record(candidate.economics_summary)
    .operatorPriceApproved === true
  const recoveryEvidence = {
    ...record(candidate.evidence_summary),
    prematureTaxonomyRejectionRecoveryVersion:
      PREMATURE_TAXONOMY_REJECTION_RECOVERY_VERSION,
    prematureTaxonomyRejectionRecoveredAt: now.toISOString(),
    prematureTaxonomyPreviousBlockers: previousBlockers,
    priorApprovalPreserved,
    productResearchRepeated: false,
    fullCatalogRescan: false,
  }
  await transition({
    supabase,
    runId: state.run.id,
    candidateId: text(candidate.id),
    previousState: "REJECTED",
    nextState: "ENRICHING_PRODUCT_FACTS",
    reasonCode: "PREMATURE_TAXONOMY_REJECTION_REOPENED",
    triggeredBy: "RETRY",
    checkpoint: {
      recoveryVersion: PREMATURE_TAXONOMY_REJECTION_RECOVERY_VERSION,
      previousBlockers,
      priorApprovalPreserved,
      productResearchRepeated: false,
      ebayWrites: 0,
    },
    nextAutomaticAction: "Revalidar categoría, Product Facts y aspectos oficiales.",
    nextHumanAction: "Ninguna; si queda un dato obligatorio se solicitará un solo campo.",
    job: {
      jobType: "ENRICH_PRODUCT_FACTS",
      idempotencyKey: `${state.run.id}:${candidate.id}:ENRICH_PRODUCT_FACTS:${PREMATURE_TAXONOMY_REJECTION_RECOVERY_VERSION}`,
      checkpoint: {
        queueItemId: candidate.queue_item_id,
        prematureTaxonomyRejectionRecovery: true,
        priorApprovalPreserved,
        ebayWrites: 0,
      },
      availableAt: now.toISOString(),
      maxAttempts: 10,
      apiFamily: "BROWSE",
      apiOperation: "EXACT_VERIFICATION",
      ownerLane: "P1_EXACT_VERIFICATION",
    },
  })
  const { error } = await supabase.from("ebay_same_day_pilot_candidates")
    .update({
      state: "READY_FOR_CONTENT",
      blockers: [],
      evidence_summary: recoveryEvidence,
      product_facts_summary: {},
      next_automated_action: "Revalidar categoría y ficha sin repetir Product Research.",
      next_human_action: "Ninguna; Seller OS conservará cualquier aprobación vigente.",
      updated_at: now.toISOString(),
    })
    .eq("id", candidate.id)
    .eq("run_id", state.run.id)
    .eq("machine_state", "ENRICHING_PRODUCT_FACTS")
  if (error) throw new Error("SAME_DAY_PILOT_PREMATURE_TAXONOMY_RECOVERY_FAILED")
  await refreshRunProjection(supabase, state.run.id)
  return 1
}

/**
 * Replays only a candidate rejected by a superseded Product Facts rule or a
 * transient append-only persistence failure. It never reopens a commercial
 * rejection, repeats Discovery, or widens the five-candidate queue. One
 * candidate is repaired per pass so the operator inbox remains serialized.
 */
async function repairLegacyProductFactsRejections(
  supabase: SupabaseClient,
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
  now: Date,
) {
  if (state.tasks.some((task) => task.status === "OPEN")) return 0
  const candidate = [...state.candidates]
    .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    .find((entry) => {
      const blockers = strings(entry.blockers)
      const evidence = record(entry.evidence_summary)
      return entry.machine_state === "REJECTED" && entry.state === "REJECTED_TODAY" &&
        blockers.length === 1 && LEGACY_PRODUCT_FACTS_REJECTION_REASONS.has(blockers[0]) &&
        text(entry.queue_item_id) && text(entry.supplier_variant_id) &&
        text(evidence.legacyProductFactsRecoveryVersion) !== LEGACY_PRODUCT_FACTS_RECOVERY_VERSION
    })
  if (!candidate) return 0

  const economics = record(candidate.economics_summary)
  const lunaConfirmation = record(economics.lunaConfirmation)
  const confirmedAt = Date.parse(text(lunaConfirmation.confirmedAt))
  const confirmationFresh = economics.available === true && Number(economics.confirmedLunaPrice) > 0 &&
    Number.isFinite(confirmedAt) && now.getTime() - confirmedAt >= -5 * 60_000 &&
    now.getTime() - confirmedAt <= 24 * 60 * 60_000
  const recoveryEvidence = {
    ...record(candidate.evidence_summary),
    legacyProductFactsRecoveryVersion: LEGACY_PRODUCT_FACTS_RECOVERY_VERSION,
    legacyProductFactsRecoveredAt: now.toISOString(),
    legacyProductFactsPreviousBlocker: strings(candidate.blockers)[0],
    fullCatalogRescan: false,
  }

  if (!confirmationFresh) {
    await createLunaGate(supabase, state.run.id, record(candidate), "REJECTED")
    const { error } = await supabase.from("ebay_same_day_pilot_candidates").update({
      state: "NEEDS_LUNA_CONFIRMATION",
      blockers: [],
      evidence_summary: recoveryEvidence,
      product_facts_summary: {},
      next_automated_action: "Recalcular economía y Product Facts con la confirmación vigente.",
      next_human_action: "Confirmar nuevamente precio y disponibilidad visibles en Luna.",
      updated_at: now.toISOString(),
    }).eq("id", candidate.id).eq("run_id", state.run.id)
      .eq("machine_state", "WAITING_LUNA_CONFIRMATION")
    if (error) throw new Error("SAME_DAY_PILOT_LEGACY_FACTS_LUNA_RECOVERY_FAILED")
  } else {
    await transition({
      supabase,
      runId: state.run.id,
      candidateId: text(candidate.id),
      previousState: "REJECTED",
      nextState: "ENRICHING_PRODUCT_FACTS",
      reasonCode: "LEGACY_PRODUCT_FACTS_RULE_REPAIRED",
      triggeredBy: "RETRY",
      checkpoint: {
        previousReason: strings(candidate.blockers)[0],
        recoveryVersion: LEGACY_PRODUCT_FACTS_RECOVERY_VERSION,
        fullCatalogRescan: false,
      },
      nextAutomaticAction: "Reprocesar únicamente Product Facts y Taxonomy del candidato afectado.",
      nextHumanAction: "Ninguna.",
      job: {
        jobType: "ENRICH_PRODUCT_FACTS",
        idempotencyKey: `${state.run.id}:${candidate.id}:ENRICH_PRODUCT_FACTS:${PRODUCT_FACTS_ENGINE_VERSION}`,
        checkpoint: { queueItemId: candidate.queue_item_id, targetedLegacyRecovery: true },
        // The worker claim uses the cycle's captured `now`. Pin this recovery
        // job to that same instant so a few milliseconds of transition work do
        // not defer otherwise immediate continuation to the next cron slot.
        availableAt: now.toISOString(),
        maxAttempts: 10,
        apiFamily: "BROWSE",
        apiOperation: "EXACT_VERIFICATION",
        ownerLane: "P1_EXACT_VERIFICATION",
      },
    })
    const { error } = await supabase.from("ebay_same_day_pilot_candidates").update({
      state: "READY_FOR_CONTENT",
      blockers: [],
      evidence_summary: recoveryEvidence,
      product_facts_summary: {},
      next_automated_action: "Resolver Product Facts, categoría y requisitos obligatorios.",
      next_human_action: "Ninguna.",
      updated_at: now.toISOString(),
    }).eq("id", candidate.id).eq("run_id", state.run.id)
      .eq("machine_state", "ENRICHING_PRODUCT_FACTS")
    if (error) throw new Error("SAME_DAY_PILOT_LEGACY_FACTS_RECOVERY_FAILED")
  }
  await refreshRunProjection(supabase, state.run.id)
  return 1
}

/**
 * Resolver V3 separates technical ancestry from non-authoritative competitor
 * corroboration, and the reviewed official-source registry may now resolve a
 * missing field before manual fallback. Re-run only Product Facts once for
 * affected rejections; Product Research and eBay writes are never repeated.
 */
async function repairRejectedProductFactAuthorityLineage(
  supabase: SupabaseClient,
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
  now: Date,
) {
  const selected = [...state.candidates]
    .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    .find((candidate) => {
      const evidence = record(candidate.evidence_summary)
      const selectionIdentity = record(evidence.selectionIdentity)
      const facts = record(candidate.product_facts_summary)
      const gates = record(facts.gates)
      const confirmation = record(record(candidate.economics_summary).lunaConfirmation)
      const confirmedAt = Date.parse(text(confirmation.confirmedAt))
      const nativePackCount = number(selectionIdentity.nativePackCount)
      const blockers = strings(candidate.blockers)
      const recoverableMissingFacts = blockers.includes("MISSING_BLOCKING") &&
        facts.currentRunBound === true && gates.IDENTITY_READY === true &&
        gates.PRODUCT_FACTS_READY === true && gates.REGULATORY_READY === true
      const recoverablePreFactsDecisionFailure = blockers.includes(
        "TOP10_CANONICAL_FACT_RECOVERY_NOT_READY",
      )
      return candidate.machine_state === "REJECTED" && candidate.state === "REJECTED_TODAY" &&
        (recoverableMissingFacts || recoverablePreFactsDecisionFailure) &&
        selectionIdentity.exactIdentityConfirmed === true &&
        selectionIdentity.exactOfferPackVerified === true &&
        nativePackCount !== null && Number.isInteger(nativePackCount) &&
        nativePackCount > 0 && nativePackCount <= 100 &&
        text(candidate.queue_item_id) && Number.isFinite(confirmedAt) &&
        now.getTime() - confirmedAt <= 24 * 60 * 60_000 &&
        text(evidence.productFactAuthorityLineageRecoveryVersion) !==
          PRODUCT_FACT_AUTHORITY_LINEAGE_RECOVERY_VERSION
    })
  if (!selected) return 0
  const packBindingReady = await persistConfirmedOfferPackQueueBinding({
    supabase,
    accountKey: text(state.run.marketplace_account_key),
    candidate: record(selected),
    now,
  })
  if (strings(selected.blockers).includes("TOP10_CANONICAL_FACT_RECOVERY_NOT_READY") &&
    !packBindingReady) return 0
  // The claim RPC intentionally blocks a run while any dead letter exists.
  // Preserve the failed row as CANCELLED audit history before enqueueing the
  // versioned replacement, otherwise the replacement can never be leased.
  await cancelSupersededProductFactsDeadLetters({
    supabase,
    runId: state.run.id,
    candidateId: text(selected.id),
    now,
  })
  const evidenceSummary = {
    ...record(selected.evidence_summary),
    productFactAuthorityLineageRecoveryVersion:
      PRODUCT_FACT_AUTHORITY_LINEAGE_RECOVERY_VERSION,
    productFactAuthorityLineageRecoveredAt: now.toISOString(),
    productResearchRepeated: false,
    fullCatalogRescan: false,
  }
  await transition({
    supabase,
    runId: state.run.id,
    candidateId: text(selected.id),
    previousState: "REJECTED",
    nextState: "ENRICHING_PRODUCT_FACTS",
    reasonCode: "PRODUCT_FACT_AUTHORITY_LINEAGE_RECALCULATION",
    triggeredBy: "RETRY",
    checkpoint: {
      version: PRODUCT_FACT_AUTHORITY_LINEAGE_RECOVERY_VERSION,
      productResearchRepeated: false,
      fullCatalogRescan: false,
      ebayWrites: 0,
    },
    nextAutomaticAction: "Recalcular únicamente Ficha y cumplimiento.",
    nextHumanAction: "Ninguna.",
    job: {
      jobType: "ENRICH_PRODUCT_FACTS",
      idempotencyKey: `${state.run.id}:${selected.id}:ENRICH_PRODUCT_FACTS:${PRODUCT_FACT_AUTHORITY_LINEAGE_RECOVERY_VERSION}`,
      checkpoint: { queueItemId: selected.queue_item_id, authorityLineageRecovery: true },
      availableAt: now.toISOString(),
      maxAttempts: 10,
      apiFamily: "BROWSE",
      apiOperation: "EXACT_VERIFICATION",
      ownerLane: "P1_EXACT_VERIFICATION",
    },
  })
  const { error } = await supabase.from("ebay_same_day_pilot_candidates").update({
    state: "READY_FOR_CONTENT",
    blockers: [],
    evidence_summary: evidenceSummary,
    next_automated_action: "Recalcular Ficha y cumplimiento con procedencia y fuentes oficiales actualizadas.",
    next_human_action: "Ninguna.",
    updated_at: now.toISOString(),
  }).eq("id", selected.id).eq("run_id", state.run.id)
    .eq("machine_state", "ENRICHING_PRODUCT_FACTS")
  if (error) throw new Error("SAME_DAY_PILOT_PRODUCT_FACT_AUTHORITY_LINEAGE_RECOVERY_FAILED")
  await refreshRunProjection(supabase, state.run.id)
  return 1
}

/**
 * Operator-verifiable label facts are requested one at a time instead of
 * discarding an otherwise safe candidate. Recovery remains serialized and is
 * limited to one field per task. Category and regulatory evidence remain
 * publication gates, but they become explicit manual-last-resort tasks rather
 * than silently discarding the candidate. Taxonomy itself determines how many
 * required aspects exist; Seller OS does not discard a product merely because
 * that count is high.
 */
async function repairRejectedSingleFactException(
  supabase: SupabaseClient,
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
  now: Date,
) {
  const selected = [...state.candidates]
    .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    .map((candidate) => ({
      candidate,
      exception: recoverableOfferPackException(candidate, candidate.product_facts_summary) ??
        recoverableSingleFactException(candidate.product_facts_summary) ??
        recoverableTaxonomyException(candidate.product_facts_summary) ??
        recoverableRegulatoryFactException(candidate.product_facts_summary),
    }))
    .find(({ candidate, exception }) => {
      const evidence = record(candidate.evidence_summary)
      const attemptedFields = new Set([
        ...strings(evidence.singleFactExceptionFields),
        ...(evidence.singleFactExceptionConfirmed === true
          ? [text(evidence.singleFactExceptionField)] : []),
      ].map((field) => field.toLocaleLowerCase()).filter(Boolean))
      const recoverableBlocker = strings(candidate.blockers).some((blocker) => [
        "MISSING_BLOCKING", "EBAY_TAXONOMY_NOT_READY", "EBAY_REQUIRED_ASPECTS_NOT_READY_TODAY",
        "CONFLICTED_BLOCKING", "OFFER_PACK_FACTS_REQUIRED",
        "REGULATORY_NOT_READY", "REGULATORY_READY_FALSE",
      ].includes(blocker))
      return Boolean(exception) && candidate.machine_state === "REJECTED" &&
        candidate.state === "REJECTED_TODAY" && recoverableBlocker &&
        text(candidate.queue_item_id) && text(candidate.supplier_variant_id) &&
        !state.tasks.some((task) => task.status === "OPEN" &&
          task.candidate_id === candidate.id) &&
        !attemptedFields.has(text(exception?.aspectName).toLocaleLowerCase())
    })
  if (!selected?.exception) return 0
  const candidate = record(selected.candidate)
  const exception = selected.exception
  const previousEvidence = record(candidate.evidence_summary)
  const attemptedFields = new Set([
    ...strings(previousEvidence.singleFactExceptionFields),
    ...(previousEvidence.singleFactExceptionConfirmed === true
      ? [text(previousEvidence.singleFactExceptionField)] : []),
  ].map((field) => field.toLocaleLowerCase()).filter(Boolean))
  attemptedFields.add(exception.aspectName.toLocaleLowerCase())
  const evidenceSummary = {
    ...previousEvidence,
    singleFactExceptionRecoveryVersion: SINGLE_FACT_EXCEPTION_VERSION,
    singleFactExceptionOpenedAt: now.toISOString(),
    singleFactExceptionField: exception.aspectName,
    singleFactExceptionFields: [...attemptedFields],
    singleFactExceptionGeneration: Number(previousEvidence.singleFactExceptionGeneration ?? 0) + 1,
    fullCatalogRescan: false,
  }
  await transition({
    supabase,
    runId: state.run.id,
    candidateId: text(candidate.id),
    previousState: "REJECTED",
    nextState: "VALIDATING_TAXONOMY",
    reasonCode: "SINGLE_OFFICIAL_LABEL_FACT_EXCEPTION_OPENED",
    triggeredBy: "RETRY",
    checkpoint: { field: exception.aspectName, factKey: exception.factKey,
      version: SINGLE_FACT_EXCEPTION_VERSION, fullCatalogRescan: false },
    nextAutomaticAction: "Esperar una confirmación puntual y reanudar Product Facts.",
    nextHumanAction: `Confirmar ${exception.label} desde el empaque o la página exacta de Luna.`,
  })
  const { error: updateError } = await supabase.from("ebay_same_day_pilot_candidates")
    .update({
      state: "NEEDS_ONE_CRITICAL_FACT",
      blockers: [],
      evidence_summary: evidenceSummary,
      next_automated_action: "Reanudar Product Facts después de la confirmación puntual.",
      next_human_action: `Confirmar ${exception.label} desde una fuente visible autorizada.`,
      updated_at: now.toISOString(),
    })
    .eq("id", candidate.id)
    .eq("run_id", state.run.id)
    .eq("machine_state", "VALIDATING_TAXONOMY")
  if (updateError) throw new Error("SAME_DAY_PILOT_SINGLE_FACT_RECOVERY_UPDATE_FAILED")
  await createHumanTask({
    supabase,
    runId: state.run.id,
    candidateId: text(candidate.id),
    expectedState: "VALIDATING_TAXONOMY",
    gateType: "CRITICAL_EXCEPTION_REQUIRED",
    title: `Confirma únicamente: ${exception.label}`,
    why: exception.actionType === "CONFIRM_OFFICIAL_OFFER_PACK"
      ? "Seller OS conserva la identidad exacta, pero encontró una contradicción entre la presentación confirmada y los datos del producto."
      : exception.actionType === "CONFIRM_OFFICIAL_EBAY_CATEGORY"
        ? "Seller OS agotó Catalog y Taxonomy dentro del presupuesto automático sin resolver la categoría hoja. Confirma el ID desde el selector oficial de eBay."
      : `eBay exige ${exception.aspectName}. Seller OS revisó Luna, Catalog y Taxonomy, pero no encontró un valor estructurado verificable.`,
    seconds: 45,
    impact: "Seller OS guardará sólo el fact confirmado con procedencia, repetirá Product Facts para este candidato y continuará automáticamente.",
    evidence: { fieldRequired: exception.aspectName,
      remainingBlockingFields: exception.remainingBlockingFields,
      currentValue: "currentValue" in exception ? exception.currentValue : null,
      explicitTitlePackCount: "explicitTitlePackCount" in exception
        ? exception.explicitTitlePackCount : null,
      sourcesAlreadyChecked: ["Luna exact variant", "eBay Catalog oficial", "eBay Taxonomy oficial",
        "fuente pública oficial del fabricante cuando existe"] },
    actionSchema: { type: exception.actionType, factScope: exception.factScope,
      factKey: exception.factKey, fieldRequired: exception.aspectName,
      fieldLabel: exception.label, selectionOnly: exception.selectionOnly,
      allowedValuesComplete: exception.allowedValuesComplete,
      allowedValues: exception.allowedValues,
      currentValue: "currentValue" in exception ? exception.currentValue : null,
      explicitTitlePackCount: "explicitTitlePackCount" in exception
        ? exception.explicitTitlePackCount : null,
      regulatoryFact: "regulatoryFact" in exception && exception.regulatoryFact === true,
      requiresVisibleOfficialLabel: true },
    continuationJobType: "ENRICH_PRODUCT_FACTS",
  })
  await refreshRunProjection(supabase, state.run.id)
  return 1
}

/**
 * Product facts can remain valid while their commercial decision binding has
 * expired. Refresh the decision from the operator's existing Luna
 * confirmation and stored evidence, then rerun only Product Facts. This does
 * not repeat Discovery, Product Research or any eBay write.
 */
async function repairStaleDecisionProductFactsRejection(
  supabase: SupabaseClient,
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
  now: Date,
) {
  const selected = [...state.candidates]
    .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    .find((candidate) => {
      const gates = record(record(candidate.product_facts_summary).gates)
      const evidence = record(candidate.evidence_summary)
      const confirmation = record(record(candidate.economics_summary).lunaConfirmation)
      const confirmedAt = Date.parse(text(confirmation.confirmedAt))
      return candidate.machine_state === "REJECTED" && candidate.state === "REJECTED_TODAY" &&
        strings(candidate.blockers).includes("OPENAI_INPUT_NOT_READY") &&
        gates.IDENTITY_READY === true && gates.PRODUCT_FACTS_READY === true &&
        gates.OFFER_PACK_READY === true && gates.EBAY_ASPECTS_READY === true &&
        gates.REGULATORY_READY === true &&
        (gates.SHIPPING_ESTIMATE_READY === true ||
          conservativeShippingReserveReady(candidate)) &&
        text(candidate.queue_item_id) && Number(candidate.economics_summary?.confirmedLunaPrice) > 0 &&
        confirmation.status !== "OUT_OF_STOCK" && Number.isFinite(confirmedAt) &&
        now.getTime() - confirmedAt <= 24 * 60 * 60_000 &&
        text(evidence.staleDecisionFactsRecoveryVersion) !== STALE_DECISION_FACTS_RECOVERY_VERSION
    })
  if (!selected) return 0
  const actorId = text(state.run.created_by)
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) return 0
  const economics = record(selected.economics_summary)
  const confirmation = record(economics.lunaConfirmation)
  const exactQuantity = confirmation.quantityVisible === true
    ? number(confirmation.confirmedQuantity) : null
  await confirmListingAiQueueLunaObservation({
    supabase,
    accountKey: text(state.run.marketplace_account_key),
    actorId,
    itemId: text(selected.queue_item_id),
    idempotencyKey: `${state.run.id}:${selected.id}:${STALE_DECISION_FACTS_RECOVERY_VERSION}`,
    priceObserved: Number(economics.confirmedLunaPrice),
    availability: exactQuantity !== null ? "EXACT_QUANTITY_VISIBLE" : "AVAILABLE_QUANTITY_NOT_SHOWN",
    exactQuantity,
    now,
  })
  const evidenceSummary = {
    ...record(selected.evidence_summary),
    staleDecisionFactsRecoveryVersion: STALE_DECISION_FACTS_RECOVERY_VERSION,
    staleDecisionRefreshedAt: now.toISOString(),
    fullCatalogRescan: false,
    productResearchRepeated: false,
  }
  await transition({
    supabase,
    runId: state.run.id,
    candidateId: text(selected.id),
    previousState: "REJECTED",
    nextState: "ENRICHING_PRODUCT_FACTS",
    reasonCode: "STALE_COMMERCIAL_DECISION_REFRESHED",
    triggeredBy: "RETRY",
    checkpoint: { version: STALE_DECISION_FACTS_RECOVERY_VERSION,
      fullCatalogRescan: false, productResearchRepeated: false, ebayWrites: 0 },
    nextAutomaticAction: "Recalcular Product Facts con la decisión comercial vigente.",
    nextHumanAction: "Ninguna.",
    job: {
      jobType: "ENRICH_PRODUCT_FACTS",
      idempotencyKey: `${state.run.id}:${selected.id}:ENRICH_PRODUCT_FACTS:${STALE_DECISION_FACTS_RECOVERY_VERSION}`,
      checkpoint: { queueItemId: selected.queue_item_id, staleDecisionRecovery: true },
      availableAt: now.toISOString(),
      maxAttempts: 10,
      apiFamily: "BROWSE",
      apiOperation: "EXACT_VERIFICATION",
      ownerLane: "P1_EXACT_VERIFICATION",
    },
  })
  const { error } = await supabase.from("ebay_same_day_pilot_candidates").update({
    state: "READY_FOR_CONTENT",
    blockers: [],
    evidence_summary: evidenceSummary,
    product_facts_summary: {},
    next_automated_action: "Recalcular Product Facts y Taxonomy del candidato afectado.",
    next_human_action: "Ninguna.",
    updated_at: now.toISOString(),
  }).eq("id", selected.id).eq("run_id", state.run.id)
    .eq("machine_state", "ENRICHING_PRODUCT_FACTS")
  if (error) throw new Error("SAME_DAY_PILOT_STALE_DECISION_RECOVERY_FAILED")
  await refreshRunProjection(supabase, state.run.id)
  return 1
}

/**
 * A stale supplier observation must not invalidate an otherwise durable
 * technical facts package. Re-run only Product Facts with the controlled
 * identity/pack binding and retain the mandatory publication/purchase alert.
 */
async function repairStaleSupplyOpenAiInputRejection(
  supabase: SupabaseClient,
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
  now: Date,
) {
  const selected = [...state.candidates]
    .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    .find((candidate) => {
      const gates = record(record(candidate.product_facts_summary).gates)
      const evidence = record(candidate.evidence_summary)
      return text(candidate.machine_state) === "REJECTED" &&
        text(candidate.state) === "REJECTED_TODAY" &&
        strings(candidate.blockers).length === 1 &&
        strings(candidate.blockers)[0] === "OPENAI_INPUT_NOT_READY" &&
        gates.IDENTITY_READY === true &&
        gates.PRODUCT_FACTS_READY === true &&
        gates.OFFER_PACK_READY === true &&
        gates.EBAY_ASPECTS_READY === true &&
        gates.REGULATORY_READY === true &&
        controlledExploratoryFactsCanContinue(record(candidate), now) &&
        text(evidence.staleSupplyOpenAiInputRecoveryVersion) !==
          STALE_SUPPLY_OPENAI_INPUT_RECOVERY_VERSION
    })
  if (!selected) return 0
  const candidateId = text(selected.id)
  const freshnessAdvisory = lunaSupplyFreshnessAdvisory(
    record(selected),
    now,
  )
  await transition({
    supabase,
    runId: text(state.run.id),
    candidateId,
    previousState: "REJECTED",
    nextState: "ENRICHING_PRODUCT_FACTS",
    reasonCode: "STALE_SUPPLY_DOES_NOT_EXPIRE_TECHNICAL_FACTS",
    triggeredBy: "RETRY",
    checkpoint: {
      recoveryVersion: STALE_SUPPLY_OPENAI_INPUT_RECOVERY_VERSION,
      freshnessAdvisory,
      productResearchRepeated: false,
    },
    nextAutomaticAction:
      "Reconstruir el paquete técnico con identidad y pack preservados.",
    nextHumanAction:
      "Ninguna ahora; reconfirmar Luna antes de publicar o comprar.",
    job: {
      jobType: "ENRICH_PRODUCT_FACTS",
      idempotencyKey: [
        state.run.id,
        candidateId,
        "ENRICH_PRODUCT_FACTS",
        STALE_SUPPLY_OPENAI_INPUT_RECOVERY_VERSION,
      ].join(":"),
      checkpoint: {
        queueItemId: selected.queue_item_id,
        freshnessAdvisory,
        durableTechnicalFactsBinding: true,
      },
      availableAt: now.toISOString(),
      maxAttempts: 10,
      apiFamily: "BROWSE",
      apiOperation: "EXACT_VERIFICATION",
      ownerLane: "P1_EXACT_VERIFICATION",
    },
  })
  const nextEvidence = {
    ...record(selected.evidence_summary),
    lunaSupplyFreshness: freshnessAdvisory,
    staleSupplyOpenAiInputRecoveryVersion:
      STALE_SUPPLY_OPENAI_INPUT_RECOVERY_VERSION,
    staleSupplyOpenAiInputRecoveredAt: now.toISOString(),
    productResearchRepeated: false,
  }
  const { data: updated, error: updateError } = await supabase
    .from("ebay_same_day_pilot_candidates")
    .update({
      state: "READY_FOR_CONTENT",
      blockers: [],
      evidence_summary: nextEvidence,
      next_automated_action:
        "Reconstruir Product Facts sin repetir stock ni Product Research.",
      next_human_action:
        "Ninguna ahora; reconfirmar Luna antes de publicar o comprar.",
      updated_at: now.toISOString(),
    })
    .eq("id", candidateId)
    .eq("run_id", state.run.id)
    .eq("machine_state", "ENRICHING_PRODUCT_FACTS")
    .select("id")
  if (updateError || (updated ?? []).length !== 1) {
    throw new Error("SAME_DAY_PILOT_STALE_SUPPLY_OPENAI_RECOVERY_FAILED")
  }
  const { error: eventError } = await supabase
    .from("ebay_same_day_pilot_events")
    .upsert({
      run_id: state.run.id,
      candidate_id: candidateId,
      event_type: "STALE_SUPPLY_TECHNICAL_FACTS_CONTINUED",
      event_payload: {
        recoveryVersion: STALE_SUPPLY_OPENAI_INPUT_RECOVERY_VERSION,
        freshnessAdvisory,
        technicalFactsPreserved: true,
        productResearchRepeated: false,
        lunaGateOpened: false,
        finalPublicationRecheckRequired: true,
        historyDeleted: false,
      },
      idempotency_key: [
        state.run.id,
        candidateId,
        STALE_SUPPLY_OPENAI_INPUT_RECOVERY_VERSION,
      ].join(":"),
      ebay_read_calls: 0,
      openai_calls: 0,
      ebay_writes: 0,
      production_changed: false,
    }, { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (eventError) {
    throw new Error("SAME_DAY_PILOT_STALE_SUPPLY_OPENAI_EVENT_FAILED")
  }
  await refreshRunProjection(supabase, state.run.id)
  return 1
}

/**
 * Replays Product Facts when a reviewed manufacturer identity contradicts a
 * legacy generic Brand marker and active Browse comparables were consequently
 * filtered out. Historical ambiguous rows remain non-qualifying and no eBay
 * write or Product Research recapture is performed.
 */
async function repairOfficialBrandMarketPricingGap(
  supabase: SupabaseClient,
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
  now: Date,
) {
  const selected = [...state.candidates]
    .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    .find((candidate) => {
      const evidence = record(candidate.evidence_summary)
      const facts = record(candidate.product_facts_summary)
      const marketPricing = record(facts.marketPricing)
      const currentPresentation = record(marketPricing.currentPresentation)
      const activeMarket = record(currentPresentation.active)
      const resolvedFacts = Array.isArray(facts.resolvedFacts) ? facts.resolvedFacts : []
      const resolvedBrand = resolvedFacts.map(record).find((fact) =>
        text(fact.key).toLocaleLowerCase("en-US") === "brand")
      const brand = text(resolvedBrand?.value).toLocaleLowerCase("en-US")
      const official = reviewedOfficialManufacturerIdentity(text(candidate.product_title))
      const activeMedian = Number(activeMarket.medianLandedPrice)
      const activeMaximum = Number(activeMarket.maximumLandedPrice)
      const outlierPricingRecoveryRequired = marketPricing.status === "AVAILABLE" &&
        Number(activeMarket.sourceSampleSize ?? activeMarket.sampleSize) >= 5 &&
        Number.isFinite(activeMedian) &&
        Number.isFinite(activeMaximum) && activeMedian > 0 &&
        activeMaximum > activeMedian * 1.75
      const pricingStrategyUpgradeRequired = marketPricing.status === "AVAILABLE" &&
        text(marketPricing.version) !== EBAY_MARKET_PRICING_STRATEGY_VERSION
      return candidate.machine_state === "WAITING_PRODUCT_APPROVAL" &&
        Boolean(text(candidate.queue_item_id)) && Boolean(official) &&
        ((["unbranded", "generic", "does not apply", "not applicable", "n/a"].includes(brand) &&
          marketPricing.status === "INSUFFICIENT_EQUIVALENT_MARKET_DATA") ||
          outlierPricingRecoveryRequired || pricingStrategyUpgradeRequired) &&
        text(evidence.officialBrandMarketPricingRecoveryVersion) !==
          OFFICIAL_BRAND_MARKET_PRICING_RECOVERY_VERSION
    })
  if (!selected) return 0
  const official = reviewedOfficialManufacturerIdentity(text(selected.product_title))!
  const completedAt = now.toISOString()
  const { error: taskError } = await supabase.from("ebay_same_day_pilot_human_tasks").update({
    status: "SUPERSEDED", completed_at: completedAt, updated_at: completedAt,
  }).eq("candidate_id", selected.id).eq("status", "OPEN")
  if (taskError) throw new Error("SAME_DAY_OFFICIAL_BRAND_RECOVERY_TASK_FAILED")
  await transition({
    supabase,
    runId: state.run.id,
    candidateId: text(selected.id),
    previousState: "WAITING_PRODUCT_APPROVAL",
    nextState: "ENRICHING_PRODUCT_FACTS",
    reasonCode: "OFFICIAL_BRAND_MARKET_PRICING_RECALCULATION",
    triggeredBy: "RETRY",
    checkpoint: {
      version: OFFICIAL_BRAND_MARKET_PRICING_RECOVERY_VERSION,
      officialSourceId: official.sourceId,
      sourceReference: official.sourceReference,
      priorBrandGeneric: true,
      productResearchRepeated: false,
      ebayWrites: 0,
    },
    nextAutomaticAction: "Recalcular la identidad oficial y el rango de mercado activo.",
    nextHumanAction: "Ninguna.",
    job: {
      jobType: "ENRICH_PRODUCT_FACTS",
      idempotencyKey: `${state.run.id}:${selected.id}:ENRICH_PRODUCT_FACTS:${OFFICIAL_BRAND_MARKET_PRICING_RECOVERY_VERSION}`,
      checkpoint: { queueItemId: selected.queue_item_id,
        officialBrandMarketPricingRecovery: true },
      availableAt: completedAt,
      maxAttempts: 10,
      apiFamily: "BROWSE",
      apiOperation: "EXACT_VERIFICATION",
      ownerLane: "P1_EXACT_VERIFICATION",
    },
  })
  const { error: candidateError } = await supabase.from("ebay_same_day_pilot_candidates").update({
    state: "READY_FOR_CONTENT",
    blockers: [],
    evidence_summary: { ...record(selected.evidence_summary),
      officialBrandMarketPricingRecoveryVersion:
        OFFICIAL_BRAND_MARKET_PRICING_RECOVERY_VERSION,
      officialBrandMarketPricingRecoveredAt: completedAt,
      productResearchRepeated: false,
    },
    product_facts_summary: {},
    next_automated_action: "Recalcular identidad oficial y mercado activo.",
    next_human_action: "Ninguna.",
    updated_at: completedAt,
  }).eq("id", selected.id).eq("run_id", state.run.id)
    .eq("machine_state", "ENRICHING_PRODUCT_FACTS")
  if (candidateError) throw new Error("SAME_DAY_OFFICIAL_BRAND_RECOVERY_FAILED")
  await refreshRunProjection(supabase, state.run.id)
  return 1
}

async function refreshCandidateDecisionBeforeProductFacts(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  candidate: JsonRecord
  now: Date
}) {
  if (!/^[0-9a-f-]{36}$/i.test(input.actorId) ||
    !text(input.candidate.queue_item_id)) return false
  const { data: queueItem, error } = await input.supabase
    .from("marketplace_listing_approval_queue_items")
    .select("id,decision_package_id,package_hash,stale_after")
    .eq("id", input.candidate.queue_item_id)
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", MARKETPLACE)
    .maybeSingle()
  if (error) throw new Error("SAME_DAY_PILOT_PRE_FACTS_DECISION_READ_FAILED")
  if (!queueItem) return false
  const staleAt = Date.parse(text(queueItem.stale_after))
  const bindingFresh = /^[0-9a-f-]{36}$/i.test(text(queueItem.decision_package_id)) &&
    /^sha256:[0-9a-f]{64}$/.test(text(queueItem.package_hash)) &&
    Number.isFinite(staleAt) && staleAt > input.now.getTime()
  if (bindingFresh) return false
  const lunaConfirmation = record(record(input.candidate.economics_summary).lunaConfirmation)
  const confirmedAt = Date.parse(text(lunaConfirmation.confirmedAt))
  const confirmedPrice = number(record(input.candidate.economics_summary).confirmedLunaPrice)
  const priorFacts = record(input.candidate.product_facts_summary)
  const priorGates = record(priorFacts.gates)
  const canonicalRecoveryReady = priorFacts.currentRunBound === true && [
    "IDENTITY_READY", "PRODUCT_FACTS_READY", "OFFER_PACK_READY",
    "EBAY_ASPECTS_READY", "REGULATORY_READY",
  ].every((gate) => priorGates[gate] === true)
  if ((!text(queueItem.decision_package_id) && !canonicalRecoveryReady) ||
    confirmedPrice === null || confirmedPrice <= 0 ||
    !text(lunaConfirmation.status).startsWith("AVAILABLE_") ||
    !Number.isFinite(confirmedAt) || confirmedAt > input.now.getTime() + 300_000 ||
    input.now.getTime() - confirmedAt > 24 * 60 * 60_000) return false
  const exactQuantity = lunaConfirmation.quantityVisible === true
    ? number(lunaConfirmation.confirmedQuantity) : null
  await confirmListingAiQueueLunaObservation({
    supabase: input.supabase,
    accountKey: input.accountKey,
    actorId: input.actorId,
    itemId: text(input.candidate.queue_item_id),
    idempotencyKey: `${text(input.candidate.id)}:${PRE_FACTS_DECISION_REFRESH_VERSION}:${text(lunaConfirmation.confirmedAt)}`,
    priceObserved: confirmedPrice,
    availability: exactQuantity !== null
      ? "EXACT_QUANTITY_VISIBLE" : "AVAILABLE_QUANTITY_NOT_SHOWN",
    exactQuantity,
    now: input.now,
  })
  return true
}

async function repairSameDayPilotBootstrap(
  supabase: SupabaseClient,
  state: Awaited<ReturnType<typeof currentState>>,
  accountKey: string,
) {
  if (!state) return false
  const serialized = await serializeOpenHumanTasksForRun(supabase, state.run.id)
  let repaired = serialized.superseded > 0
  let activeState = serialized.superseded > 0
    ? await currentState(supabase, accountKey, text(state.run.operation_date))
    : state
  if (!activeState) return repaired
  if (Number(activeState.run.queue_count ?? 0) === 0 && activeState.candidates.length > 0) {
    const { error: projectionError } = await supabase.from("ebay_same_day_pilot_runs")
      .update({ queue_count: Math.min(5, activeState.candidates.length),
        stage: "QUEUE_PREPARED", status: "ACTIVE",
        next_automated_action: "Continuar desde el primer candidato durable.",
        next_human_action: "Completar la tarea visible en Tareas para Ernesto.",
        updated_at: new Date().toISOString() })
      .eq("id", activeState.run.id).eq("queue_count", 0)
    if (projectionError) throw new Error("SAME_DAY_PILOT_QUEUE_PROJECTION_REPAIR_FAILED")
    repaired = true
    activeState = await currentState(supabase, accountKey, text(state.run.operation_date))
    if (!activeState) return repaired
  }
  const deferredVisualQueryTasksRestored =
    await restoreDeferredLegacyVisualMarketRecoveryQueryTasks(
      supabase,
      activeState,
      new Date(),
    )
  if (deferredVisualQueryTasksRestored > 0) {
    repaired = true
    activeState = await currentState(
      supabase,
      accountKey,
      text(state.run.operation_date),
    )
    if (!activeState) return repaired
  }
  if (await restoreUsableSupersededVisualCapture(
    supabase,
    activeState,
    accountKey,
    new Date(),
  )) {
    repaired = true
  }
  if (await repairQueryFamilyVisualReconciliationOrphan(
    supabase,
    activeState,
  )) {
    return true
  }
  if (await activateNextDeferredVisualMarketRecovery(
    supabase,
    activeState,
    accountKey,
    new Date(),
  )) {
    repaired = true
    activeState = await currentState(
      supabase,
      accountKey,
      text(state.run.operation_date),
    )
    if (!activeState) return true
  }
  // A capture is durable before the Same-Day transition is attempted. If an
  // older deployment or a transient continuation failure left the query task
  // PROCESSED while its human gate stayed OPEN, consume that exact stored
  // batch now. Insufficient evidence rejects/promotes the candidate; it never
  // asks the operator to repeat the same authorized capture.
  if (await repairProcessedProductResearchCaptureGate(supabase, activeState, accountKey)) {
    return true
  }
  const deferredLaterTasks =
    await supersedeLaterTasksForVisualMarketRecovery(
      supabase,
      activeState,
      new Date(),
    )
  if (deferredLaterTasks.length) {
    repaired = true
    activeState = await currentState(
      supabase,
      accountKey,
      text(state.run.operation_date),
    )
    if (!activeState) return repaired
  }
  if (await resumeReusableOperatorProductApprovalGate(
    supabase,
    activeState,
    new Date(),
  )) {
    return true
  }
  // Normal repair must never widen the operator queue. Quota pauses have one
  // explicit exception below: promoteImmediateSuccessorDuringQuotaPause may
  // activate only the immediate successor, and its RUN_CREATED check makes a
  // replay unable to leapfrog to another candidate.
  if (activeState.tasks.some((task) => task.status === "OPEN" &&
    task.gate_type !== "CRITICAL_EXCEPTION_REQUIRED")) return repaired
  const gateByState: Record<string, string> = {
    WAITING_PRODUCT_RESEARCH_CAPTURE: "PRODUCT_RESEARCH_CAPTURE_REQUIRED",
    WAITING_LUNA_CONFIRMATION: "LUNA_CONFIRMATION_REQUIRED",
    WAITING_PRODUCT_APPROVAL: "PRODUCT_APPROVAL_REQUIRED",
    WAITING_IMAGE_APPROVAL: "IMAGE_APPROVAL_REQUIRED",
  }
  const bootstrapStates = ["RUN_CREATED", "LOCAL_FILTERING", "CANDIDATE_SELECTION", "PRODUCT_RESEARCH_PLAN_READY"]
  const priorityVisualRecovery = visualMarketRecoveryPriorityCandidate(activeState)
  const active = activeState.candidates.find((candidate) => {
    const machineState = text(candidate.machine_state)
    if (["REJECTED", "BLOCKED", "READY_FOR_MANUAL_PUBLICATION", "VERIFIED_ACTIVE", "COMPLETED"]
      .includes(machineState)) return false
    if (priorityVisualRecovery &&
      text(candidate.id) !== text(priorityVisualRecovery.id)) {
      return false
    }
    if (isDeferredLegacyVisualMarketRecovery(candidate)) return false
    if (bootstrapStates.includes(machineState)) return true
    const expectedGate = gateByState[machineState]
    return Boolean(expectedGate && !activeState.tasks.some((task) =>
      task.candidate_id === candidate.id && task.gate_type === expectedGate && task.status === "OPEN"))
  })
  if (!active) return repaired
  await bootstrapCandidate(supabase, activeState.run.id, record(active))
  return true
}

async function createLunaGate(supabase: SupabaseClient, runId: string, candidate: JsonRecord, previousState: string) {
  const selectionIdentity = record(record(candidate.evidence_summary).selectionIdentity)
  const identityConfirmationRequired = selectionIdentity.confirmationRequired === true &&
    selectionIdentity.independentlyVerified !== true
  await transition({ supabase, runId, candidateId: text(candidate.id), previousState, nextState: "WAITING_LUNA_CONFIRMATION",
    reasonCode: "LUNA_CONFIRMATION_REQUIRED", triggeredBy: "SYSTEM", nextAutomaticAction: "Recalcular economía y enriquecer facts.",
    nextHumanAction: "Confirmar precio y disponibilidad visibles en Luna." })
  await createHumanTask({ supabase, runId, candidateId: text(candidate.id), expectedState: "WAITING_LUNA_CONFIRMATION", gateType: "LUNA_CONFIRMATION_REQUIRED",
    title: "Confirma producto, presentación, precio y stock Luna",
    why: identityConfirmationRequired
      ? "Luna aún no entregó identidad estructurada suficiente; una confirmación visible del producto exacto y su presentación permite investigar sin inventar datos."
      : "El costo, stock y número físico de unidades de la presentación deben quedar ligados a la misma página exacta antes de calcular el listing.", seconds: 45,
    impact: "Seller OS recalculará economía y ejecutará Product Facts automáticamente.", evidence: { product: candidate.product_title, sku: candidate.supplier_sku },
    actionSchema: { type: "LUNA_CONFIRMATION", fields: ["price", "availability", "quantityIfVisible",
      "identityAndPackConfirmed", "nativePackCount"] }, continuationJobType: "CALCULATE_ECONOMICS" })
}

const STALE_LUNA_ANALYSIS_ADVISORY_RECOVERY_VERSION =
  "STALE_LUNA_ANALYSIS_ADVISORY_RECOVERY_V1_2026_07_24"
const LUNA_ANALYSIS_ADVISORY_AFTER_MS = 24 * 60 * 60_000

function controlledExploratoryFactsCanContinue(
  candidate: JsonRecord,
  now: Date,
) {
  const evidence = record(candidate.evidence_summary)
  if (!["CONTROLLED_EXPLORATORY_TEST", "MARKET_VALIDATED"]
    .includes(text(evidence.commercialEvidenceMode))) return false
  const selectionIdentity = record(evidence.selectionIdentity)
  const economics = record(candidate.economics_summary)
  const confirmation = record(economics.lunaConfirmation)
  const confirmedAt = Date.parse(text(confirmation.confirmedAt))
  const confirmedPrice = number(economics.confirmedLunaPrice)
  const ageMs = now.getTime() - confirmedAt
  return Boolean(text(candidate.queue_item_id)) &&
    Boolean(text(candidate.supplier_variant_id)) &&
    confirmedPrice !== null && confirmedPrice > 0 &&
    text(confirmation.status).startsWith("AVAILABLE_") &&
    Number.isFinite(confirmedAt) &&
    ageMs >= -5 * 60_000 &&
    selectionIdentity.exactOfferPackVerified === true &&
    Number.isInteger(number(selectionIdentity.nativePackCount)) &&
    Number(selectionIdentity.nativePackCount) > 0 &&
    Number(selectionIdentity.nativePackCount) <= 100 &&
    /^sha256:[0-9a-f]{64}$/.test(
      text(evidence.controlledIdentityEvidenceHash),
    ) &&
    /^sha256:[0-9a-f]{64}$/.test(text(evidence.commercialEvidenceHash))
}

function lunaSupplyFreshnessAdvisory(candidate: JsonRecord, now: Date) {
  const confirmation = record(
    record(candidate.economics_summary).lunaConfirmation,
  )
  const confirmedAt = Date.parse(text(confirmation.confirmedAt))
  const ageMs = Number.isFinite(confirmedAt)
    ? Math.max(0, now.getTime() - confirmedAt)
    : null
  const stale = ageMs === null || ageMs > LUNA_ANALYSIS_ADVISORY_AFTER_MS
  return {
    status: stale ? "RECONFIRM_BEFORE_PUBLICATION" : "FRESH",
    lastConfirmedAt: Number.isFinite(confirmedAt)
      ? new Date(confirmedAt).toISOString()
      : null,
    ageMs,
    alertRequired: stale,
    blocksAnalysis: false,
    blocksPublication: stale,
    blocksPurchase: stale,
    nextRequiredAt: "FINAL_PUBLICATION_OR_PURCHASE_GATE",
  }
}

async function repairStaleControlledLunaConfirmationRejection(
  supabase: SupabaseClient,
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
  now: Date,
) {
  if (state.tasks.some((task) => task.status === "OPEN" &&
    task.gate_type !== "CRITICAL_EXCEPTION_REQUIRED")) return 0
  const candidate = [...state.candidates]
    .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    .find((entry) =>
      text(entry.machine_state) === "REJECTED" &&
      text(entry.state) === "REJECTED_TODAY" &&
      strings(entry.blockers).length === 1 &&
      strings(entry.blockers)[0] ===
        "PRODUCT_FACT_CONTROLLED_EXPLORATORY_TARGET_INVALID" &&
      controlledExploratoryFactsCanContinue(record(entry), now))
  if (!candidate) return 0
  const { data: failedJob, error: failedJobError } = await supabase
    .from("ebay_same_day_pilot_jobs")
    .select("id,status,last_error_code,checkpoint")
    .eq("run_id", state.run.id)
    .eq("candidate_id", candidate.id)
    .eq("job_type", "ENRICH_PRODUCT_FACTS")
    .in("status", ["DEAD_LETTER", "COMPLETED"])
    .in("last_error_code", [
      "PRODUCT_FACT_CONTROLLED_EXPLORATORY_TARGET_INVALID",
      "EFFECT_ALREADY_APPLIED_RECOVERED",
    ])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (failedJobError) {
    throw new Error("SAME_DAY_PILOT_STALE_LUNA_DEAD_LETTER_READ_FAILED")
  }
  if (!failedJob) return 0
  if (failedJob.status === "DEAD_LETTER") {
    const { data: cancelled, error: cancelError } = await supabase
      .from("ebay_same_day_pilot_jobs")
      .update({
        status: "CANCELLED",
        checkpoint: {
          ...record(failedJob.checkpoint),
          staleLunaAnalysisAdvisoryRecoveryVersion:
            STALE_LUNA_ANALYSIS_ADVISORY_RECOVERY_VERSION,
          supersededAt: now.toISOString(),
          historyDeleted: false,
        },
        updated_at: now.toISOString(),
      })
      .eq("id", failedJob.id)
      .eq("status", "DEAD_LETTER")
      .select("id")
    if (cancelError || (cancelled ?? []).length !== 1) {
      throw new Error("SAME_DAY_PILOT_STALE_LUNA_DEAD_LETTER_CANCEL_FAILED")
    }
  }
  const candidateId = text(candidate.id)
  const freshnessAdvisory = lunaSupplyFreshnessAdvisory(
    record(candidate),
    now,
  )
  await transition({
    supabase,
    runId: text(state.run.id),
    candidateId,
    previousState: "REJECTED",
    nextState: "ENRICHING_PRODUCT_FACTS",
    reasonCode: "STALE_LUNA_SUPPLY_DOES_NOT_BLOCK_ANALYSIS",
    triggeredBy: "RETRY",
    checkpoint: {
      recoveryVersion: STALE_LUNA_ANALYSIS_ADVISORY_RECOVERY_VERSION,
      failedJobId: failedJob.id,
      freshnessAdvisory,
    },
    nextAutomaticAction:
      "Continuar Product Facts con identidad y pack preservados.",
    nextHumanAction:
      "Ninguna ahora; reconfirmar Luna antes de publicar o comprar.",
    job: {
      jobType: "ENRICH_PRODUCT_FACTS",
      idempotencyKey: [
        state.run.id,
        candidateId,
        "ENRICH_PRODUCT_FACTS",
        STALE_LUNA_ANALYSIS_ADVISORY_RECOVERY_VERSION,
        failedJob.id,
      ].join(":"),
      checkpoint: {
        queueItemId: candidate.queue_item_id,
        freshnessAdvisory,
      },
      maxAttempts: 10,
      apiFamily: "BROWSE",
      apiOperation: "EXACT_VERIFICATION",
      ownerLane: "P1_EXACT_VERIFICATION",
    },
  })
  const { error: candidateError } = await supabase
    .from("ebay_same_day_pilot_candidates")
    .update({
      state: "READY_FOR_CONTENT",
      blockers: [],
      evidence_summary: {
        ...record(candidate.evidence_summary),
        lunaSupplyFreshness: freshnessAdvisory,
      },
      next_automated_action:
        "Continuar Product Facts con identidad y pack preservados.",
      next_human_action:
        "Ninguna ahora; reconfirmar Luna antes de publicar o comprar.",
      updated_at: now.toISOString(),
    })
    .eq("id", candidateId)
    .eq("run_id", state.run.id)
    .eq("machine_state", "ENRICHING_PRODUCT_FACTS")
  if (candidateError) {
    throw new Error("SAME_DAY_PILOT_STALE_LUNA_ADVISORY_CANDIDATE_FAILED")
  }
  const { error: eventError } = await supabase
    .from("ebay_same_day_pilot_events")
    .upsert({
      run_id: state.run.id,
      candidate_id: candidateId,
      event_type: "STALE_LUNA_ANALYSIS_CONTINUED",
      event_payload: {
        recoveryVersion: STALE_LUNA_ANALYSIS_ADVISORY_RECOVERY_VERSION,
        failedJobId: failedJob.id,
        freshnessAdvisory,
        productResearchRepeated: false,
        lunaGateOpened: false,
        finalPublicationRecheckRequired: true,
        commercialEvidencePreserved: true,
        productFactsHistoryPreserved: true,
        historyDeleted: false,
      },
      idempotency_key: [
        state.run.id,
        candidateId,
        STALE_LUNA_ANALYSIS_ADVISORY_RECOVERY_VERSION,
        failedJob.id,
      ].join(":"),
      ebay_read_calls: 0,
      openai_calls: 0,
      ebay_writes: 0,
      production_changed: false,
    }, { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (eventError) {
    throw new Error("SAME_DAY_PILOT_STALE_LUNA_ADVISORY_EVENT_FAILED")
  }
  await refreshRunProjection(supabase, state.run.id, true)
  return 1
}

async function promoteNextCandidate(supabase: SupabaseClient, runId: string, ordinal: number) {
  const serialized = await serializeOpenHumanTasksForRun(supabase, runId)
  if (serialized.primaryOpenTask) return false
  const { data, error } = await supabase.from("ebay_same_day_pilot_candidates").select("*")
    .eq("run_id", runId).gt("ordinal", ordinal)
    .in("machine_state", ["RUN_CREATED", "WAITING_PRODUCT_RESEARCH_CAPTURE"])
    .order("ordinal").limit(1).maybeSingle()
  if (error) throw new Error("SAME_DAY_PILOT_REPLACEMENT_READ_FAILED")
  // Older runs may already have advanced several candidates to the Product
  // Research gate before global inbox serialization superseded their extra
  // OPEN tasks. Re-bootstrap only the first eligible successor: RUN_CREATED
  // advances normally, while WAITING_PRODUCT_RESEARCH_CAPTURE recreates its
  // durable gate. Terminal and in-flight states are never reactivated, and
  // createHumanTask performs a second serialization check against races.
  if (data) await bootstrapCandidate(supabase, runId, record(data))
  return Boolean(data)
}

async function promoteImmediateSuccessorDuringQuotaPause(
  supabase: SupabaseClient,
  runId: string,
  ordinal: number,
) {
  const serialized = await serializeOpenHumanTasksForRun(supabase, runId)
  if (serialized.primaryOpenTask) return false
  const { data: pausedCandidate, error: pausedCandidateError } = await supabase
    .from("ebay_same_day_pilot_candidates")
    .select("id")
    .eq("run_id", runId)
    .eq("ordinal", ordinal)
    .maybeSingle()
  if (pausedCandidateError) throw new Error("SAME_DAY_PILOT_QUOTA_CANDIDATE_READ_FAILED")
  if (!pausedCandidate) return false
  const { data: pausedJob, error: pausedJobError } = await supabase
    .from("ebay_same_day_pilot_jobs")
    .select("id,last_error_code")
    .eq("run_id", runId)
    .eq("candidate_id", pausedCandidate.id)
    .eq("status", "WAITING_RETRY")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (pausedJobError) throw new Error("SAME_DAY_PILOT_QUOTA_JOB_READ_FAILED")
  if (!pausedJob || !/(?:429|QUOTA_PAUSED)/.test(text(pausedJob.last_error_code))) return false
  const { data, error } = await supabase.from("ebay_same_day_pilot_candidates").select("*")
    .eq("run_id", runId).gt("ordinal", ordinal).order("ordinal").limit(1).maybeSingle()
  if (error) throw new Error("SAME_DAY_PILOT_QUOTA_SUCCESSOR_READ_FAILED")
  // Inspect the immediate successor instead of the next RUN_CREATED row. Once
  // that successor has moved, replaying the same 429 cannot activate another
  // candidate and overload the operator inbox.
  if (!data || data.machine_state !== "RUN_CREATED") return false
  await bootstrapCandidate(supabase, runId, record(data))
  return true
}

async function promoteNextCandidateAfterPreparedPackage(
  supabase: SupabaseClient,
  runId: string,
  ordinal: number,
) {
  const [{ data: run, error: runError }, { count, error: countError }] = await Promise.all([
    supabase.from("ebay_same_day_pilot_runs").select("target_new_listings").eq("id", runId).single(),
    supabase.from("ebay_same_day_pilot_candidates").select("id", { count: "exact", head: true })
      .eq("run_id", runId)
      .in("state", ["READY_FOR_MANUAL_PUBLICATION", "PUBLISHED_PENDING_VERIFICATION", "VERIFIED_ACTIVE"]),
  ])
  if (runError || countError) throw new Error("SAME_DAY_PILOT_PREPARED_PACKAGE_COUNT_FAILED")
  const target = Math.max(0, Math.min(SAME_DAY_QUEUE_LIMIT,
    Number(run?.target_new_listings ?? 2)))
  if (Number(count ?? 0) >= target) return false
  return promoteNextCandidate(supabase, runId, ordinal)
}

async function refreshRunProjection(supabase: SupabaseClient, runId: string, workerHeartbeat = false) {
  const [{ data: run, error: runError }, { data: candidates, error: candidateError }, { data: tasks, error: taskError },
    { data: jobs, error: jobError }, { data: transitions, error: transitionError }] = await Promise.all([
    supabase.from("ebay_same_day_pilot_runs").select("target_new_listings").eq("id", runId).single(),
    supabase.from("ebay_same_day_pilot_candidates").select("machine_state,state,next_automated_action,next_human_action").eq("run_id", runId).order("ordinal"),
    supabase.from("ebay_same_day_pilot_human_tasks").select("title,status,gate_type,created_at,completed_at").eq("run_id", runId).order("created_at"),
    supabase.from("ebay_same_day_pilot_jobs").select("status,attempt,job_type,last_error_code").eq("run_id", runId),
    supabase.from("ebay_same_day_pilot_transitions").select("triggered_by,started_at,completed_at,next_state,reason_code").eq("run_id", runId),
  ])
  if (runError || candidateError || taskError || jobError || transitionError) throw new Error("SAME_DAY_PILOT_PROJECTION_READ_FAILED")
  const rows = candidates ?? []
  const readyCount = rows.filter((row) => row.machine_state === "READY_FOR_MANUAL_PUBLICATION").length
  const verifiedCount = rows.filter((row) => row.machine_state === "VERIFIED_ACTIVE").length
  const active = rows.find((row) =>
    !["REJECTED", "BLOCKED", "READY_FOR_MANUAL_PUBLICATION", "VERIFIED_ACTIVE", "COMPLETED"]
      .includes(row.machine_state))
  const taskRows = tasks ?? []
  const openTask = taskRows.find((task) => task.status === "OPEN")
  const waitingRetry = (jobs ?? []).some((job) => job.status === "WAITING_RETRY")
  const targetNewListings = Math.max(0, Math.min(SAME_DAY_QUEUE_LIMIT,
    Number(run?.target_new_listings ?? 2)))
  const candidateWorkSettled = isSameDayCandidateBatchSettled(
    rows.map((row) => text(row.machine_state)),
  )
  const openHumanWork = taskRows.some((task) => task.status === "OPEN")
  const unresolvedBackgroundWork = (jobs ?? []).some((job) =>
    ["PENDING", "WAITING_RETRY", "LEASED", "DEAD_LETTER"]
      .includes(text(job.status)))
  const completed = verifiedCount >= targetNewListings &&
    candidateWorkSettled && !openHumanWork && !unresolvedBackgroundWork
  const exhausted = rows.length === 0 || candidateWorkSettled
  const systemTransitions = (transitions ?? []).filter((row) => row.triggered_by !== "USER").length
  const userTransitions = (transitions ?? []).filter((row) => row.triggered_by === "USER").length
  const totalTransitions = (transitions ?? []).length
  const automaticDurationMs = (transitions ?? []).filter((row) => row.triggered_by !== "USER").reduce((total, row) => {
    const started = Date.parse(String(row.started_at ?? "")); const ended = Date.parse(String(row.completed_at ?? ""))
    return total + (Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0)
  }, 0)
  const waitingUserMs = taskRows.reduce((total, task) => {
    const started = Date.parse(String(task.created_at ?? ""))
    const ended = task.completed_at ? Date.parse(String(task.completed_at)) : Date.now()
    return total + (Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0)
  }, 0)
  const status = completed ? "COMPLETED" : exhausted ? "BLOCKED" : readyCount ? "READY_FOR_OPERATOR" :
    rows.some((row) => row.machine_state === "BLOCKED") ? "PARTIALLY_READY" : "ACTIVE"
  const patch: JsonRecord = {
    status,
    stage: active?.machine_state ?? (completed ? "COMPLETED" : exhausted ? "BLOCKED" : "QUEUE_PREPARED"),
    ready_for_manual_publication_count: Math.min(SAME_DAY_QUEUE_LIMIT, readyCount),
    verified_new_listings: Math.min(SAME_DAY_QUEUE_LIMIT, verifiedCount),
    next_automated_action: waitingRetry ? "Reanudar automáticamente desde el checkpoint al terminar la pausa." : active?.next_automated_action ?? "Preservar el trabajo completado.",
    next_human_action: openTask?.title ?? active?.next_human_action ?? "Ninguna.",
    automation_metrics: {
      totalStagesObserved: totalTransitions,
      totalTransitions,
      automaticTransitions: systemTransitions,
      humanTransitions: userTransitions,
      automationCoveragePercent: totalTransitions ? Math.round((systemTransitions / totalTransitions) * 100) : 0,
      normalHumanGates: taskRows.filter((task) => task.gate_type !== "CRITICAL_EXCEPTION_REQUIRED" && !["CANCELLED", "SUPERSEDED"].includes(task.status)).length,
      openHumanGates: taskRows.filter((task) => task.status === "OPEN").length,
      productResearchCaptures: taskRows.filter((task) => task.gate_type === "PRODUCT_RESEARCH_CAPTURE_REQUIRED" && task.status === "COMPLETED").length,
      exceptions: taskRows.filter((task) => task.gate_type === "CRITICAL_EXCEPTION_REQUIRED").length,
      backgroundJobs: (jobs ?? []).length,
      waitingRetries: (jobs ?? []).filter((job) => job.status === "WAITING_RETRY").length,
      retries: (jobs ?? []).reduce((total, job) => total + Math.max(0, Number(job.attempt ?? 0) - 1), 0),
      candidateReplacements: (transitions ?? []).filter((row) => row.next_state === "REJECTED").length,
      automaticDurationMs,
      waitingForOperatorMs: waitingUserMs,
      operatorInterventionsPerVerifiedListing: verifiedCount ? Number((userTransitions / verifiedCount).toFixed(2)) : null,
    },
    updated_at: new Date().toISOString(),
  }
  if (workerHeartbeat) patch.last_worker_heartbeat_at = new Date().toISOString()
  const { error } = await supabase.from("ebay_same_day_pilot_runs").update(patch).eq("id", runId)
  if (error) throw new Error("SAME_DAY_PILOT_PROJECTION_UPDATE_FAILED")
}

async function settlePilotJob(input: {
  supabase: SupabaseClient
  job: JsonRecord
  workerId: string
  status: "COMPLETED" | "WAITING_RETRY" | "DEAD_LETTER"
  availableAt?: string | null
  errorCode?: string | null
  preserveAttempt?: boolean
}) {
  const leaseToken = text(input.job.lease_token)
  if (!leaseToken) throw new Error("SAME_DAY_PILOT_JOB_LEASE_TOKEN_MISSING")
  const { data, error } = await input.supabase.rpc("settle_same_day_pilot_job", {
    p_job_id: input.job.id,
    p_worker_id: input.workerId,
    p_lease_token: leaseToken,
    p_status: input.status,
    p_available_at: input.availableAt ?? null,
    p_error_code: input.errorCode ?? null,
    p_preserve_attempt: input.preserveAttempt === true,
    p_now: new Date().toISOString(),
  })
  if (error) throw new Error("SAME_DAY_PILOT_JOB_SETTLEMENT_FAILED")
  if (data !== true) throw new Error("SAME_DAY_PILOT_JOB_LEASE_LOST")
}

async function heartbeatPilotJob(input: { supabase: SupabaseClient; job: JsonRecord; workerId: string }) {
  const leaseToken = text(input.job.lease_token)
  if (!leaseToken) throw new Error("SAME_DAY_PILOT_JOB_LEASE_TOKEN_MISSING")
  const { data, error } = await input.supabase.rpc("heartbeat_same_day_pilot_job", {
    p_job_id: input.job.id,
    p_worker_id: input.workerId,
    p_lease_token: leaseToken,
    p_now: new Date().toISOString(),
  })
  if (error || data !== true) throw new Error("SAME_DAY_PILOT_JOB_LEASE_LOST")
}

async function deferPilotJob(input: {
  supabase: SupabaseClient
  job: JsonRecord
  workerId: string
  availableAt: string
  errorCode: string
  preserveAttempt?: boolean
}) {
  await settlePilotJob({ supabase: input.supabase, job: input.job, workerId: input.workerId,
    status: "WAITING_RETRY", availableAt: input.availableAt, errorCode: input.errorCode,
    preserveAttempt: input.preserveAttempt })
}

async function rejectAndPromote(input: {
  supabase: SupabaseClient
  runId: string
  candidate: JsonRecord
  previousState: string
  reasonCode: string
  blockers?: string[]
}) {
  const blockers = input.blockers?.length ? input.blockers : [input.reasonCode]
  await transition({ supabase: input.supabase, runId: input.runId, candidateId: text(input.candidate.id),
    previousState: input.previousState, nextState: "REJECTED", reasonCode: input.reasonCode,
    triggeredBy: "SYSTEM", checkpoint: { blockers }, nextAutomaticAction: "Promover el siguiente candidato.", nextHumanAction: "Ninguna." })
  const { error } = await input.supabase.from("ebay_same_day_pilot_candidates").update({
    state: "REJECTED_TODAY", blockers, updated_at: new Date().toISOString(),
  }).eq("id", input.candidate.id).eq("run_id", input.runId)
  if (error) throw new Error("SAME_DAY_PILOT_CANDIDATE_REJECT_FAILED")
  await promoteNextCandidate(input.supabase, input.runId, Number(input.candidate.ordinal))
}

async function blockRelatedPresentationAndPromote(input: {
  supabase: SupabaseClient
  runId: string
  candidate: JsonRecord
  previousState: string
  reasonCode: string
  blockers: string[]
}) {
  await transition({ supabase: input.supabase, runId: input.runId,
    candidateId: text(input.candidate.id), previousState: input.previousState,
    nextState: "BLOCKED", reasonCode: input.reasonCode, triggeredBy: "SYSTEM",
    checkpoint: { blockers: input.blockers, evidenceRetained: true },
    nextAutomaticAction: "Conservar la estrategia de presentación y promover el siguiente candidato.",
    nextHumanAction: "Ninguna por ahora; Seller OS debe resolver costos del pack antes de recuperarlo." })
  const { error } = await input.supabase.from("ebay_same_day_pilot_candidates").update({
    state: "NEEDS_ONE_CRITICAL_FACT", blockers: input.blockers,
    updated_at: new Date().toISOString(),
  }).eq("id", input.candidate.id).eq("run_id", input.runId)
  if (error) throw new Error("SAME_DAY_PILOT_RELATED_PRESENTATION_BLOCK_FAILED")
  await promoteNextCandidate(input.supabase, input.runId, Number(input.candidate.ordinal))
}

export async function previewSameDayPilot(input: {
  supabase: SupabaseClient
  accountKey: string
  now?: Date
  excludeOpportunityIds?: string[]
  excludeCandidateKeys?: string[]
  excludeSupplierVariantIds?: string[]
  excludeFamilyFingerprints?: string[]
}) {
  const now = input.now ?? new Date()
  const [{ data: opportunities, error: opportunityError }, { data: quotas, error: quotaError },
    { data: monitor, error: monitorError }, productResearchCount, existingPilotListing] = await Promise.all([
    input.supabase.from("ebay_luna_opportunity_queue").select("*").in("queue_status", ["watchlist", "review", "ready"]).order("opportunity_score", { ascending: false }).limit(70),
    input.supabase.from("ebay_api_quota_states").select("api_family,operation,status,remaining,reserved_budget,available_budget,reset_at,owner_lane"),
    input.supabase.from("commercial_monitor_runs").select("status,heartbeat_at,readers,errors,completed_at").eq("marketplace_account_key", input.accountKey).eq("marketplace", MARKETPLACE).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    input.supabase.from("marketplace_product_research_capture_observations").select("id", { count: "exact", head: true }).eq("marketplace_account_key", input.accountKey).eq("marketplace", MARKETPLACE),
    input.supabase.from("ebay_active_listings").select("id", { count: "exact", head: true }).eq("account_key", input.accountKey).eq("ebay_item_id", "366543596425").eq("listing_status", "active"),
  ])
  if (opportunityError || quotaError || monitorError || productResearchCount.error || existingPilotListing.error) {
    throw new Error("SAME_DAY_PILOT_SOURCE_READ_FAILED")
  }
  const excludedOpportunityIds = new Set(
    (input.excludeOpportunityIds ?? []).map((id) => text(id)).filter(Boolean),
  )
  const eligibleOpportunities = (opportunities ?? []).filter((row) =>
    !excludedOpportunityIds.has(text(row.id)))
  const productIds = [...new Set(eligibleOpportunities
    .map((row) => text(row.market_radar_product_id)).filter(Boolean))]
  const [variantResult, productDescriptionResult] = productIds.length
    ? await Promise.all([
      input.supabase.from("market_radar_latest_variants")
        .select("product_id,supplier_variant_id,variant_title,sku,barcode,price,available,inventory_quantity,product_url,featured_image_url,captured_at")
        .in("product_id", productIds).limit(500),
      input.supabase.from("market_radar_products")
        .select("id,body_html").in("id", productIds).limit(500),
    ])
    : [{ data: [], error: null }, { data: [], error: null }]
  const latestVariants = variantResult.data ?? []
  if (variantResult.error || productDescriptionResult.error) {
    throw new Error("SAME_DAY_PILOT_LUNA_CURRENT_SNAPSHOT_READ_FAILED")
  }
  const variantByKey = new Map((latestVariants ?? []).map((variant) => [
    `${text(variant.product_id)}:${text(variant.supplier_variant_id)}`, record(variant),
  ]))
  const descriptionIdentityByProductId = new Map((productDescriptionResult.data ?? [])
    .map((product) => {
      const extracted = extractLunaOfficialDescriptionIdentity({ bodyHtml: product.body_html })
      return [text(product.id), { ...extracted.facts, source: extracted.source,
        evidenceHash: extracted.evidenceHash }] as const
    }))
  const { data: latestQueueRun, error: queueRunError } = await input.supabase
    .from("marketplace_listing_approval_queue_runs").select("id")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", MARKETPLACE)
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (queueRunError) throw new Error("SAME_DAY_PILOT_QUEUE_RUN_READ_FAILED")
  const { data: queueItems, error: queueItemError } = latestQueueRun?.id
    ? await input.supabase.from("marketplace_listing_approval_queue_items")
      .select("id,supplier_variant_id").eq("run_id", latestQueueRun.id)
      .eq("marketplace_account_key", input.accountKey).limit(200)
    : { data: [], error: null }
  if (queueItemError) throw new Error("SAME_DAY_PILOT_QUEUE_ITEM_READ_FAILED")
  const queueItemByVariant = new Map((queueItems ?? [])
    .map((row) => [text(row.supplier_variant_id), row.id]))
  const candidateInputs = eligibleOpportunities.map((row) => {
    const key = `${text(row.market_radar_product_id)}:${text(row.supplier_variant_id)}`
    const candidate = candidateInput(record(row), variantByKey.get(key) ?? {}, now,
      descriptionIdentityByProductId.get(text(row.market_radar_product_id)) ?? {})
    return { ...candidate,
      queueItemAvailable: queueItemByVariant.has(text(candidate.supplierVariantId)) }
  })
  const evaluatedCandidates = candidateInputs.map((candidate) =>
    evaluateSameDayCandidate(candidate, now))
  const selected = selectSameDayQueue(candidateInputs, now, {
    opportunityIds: excludedOpportunityIds,
    candidateKeys: input.excludeCandidateKeys,
    supplierVariantIds: input.excludeSupplierVariantIds,
    familyFingerprints: input.excludeFamilyFingerprints,
  })
  const effectiveQuotaLanes = (quotas ?? []).map((lane) =>
    projectEffectiveEbayQuotaLane(lane, now))
  const exactLane = effectiveQuotaLanes.find((lane) =>
    lane.api_family === "BROWSE" && lane.operation === "EXACT_VERIFICATION") ?? null
  return {
    observedAt: now.toISOString(),
    selected,
    queueItemByVariant,
    latestQueueRunId: latestQueueRun?.id ?? null,
    quotaLanes: effectiveQuotaLanes,
    exactVerificationLane: exactLane,
    monitor: monitor ?? { status: "NOT_RUNNING" },
    counts: {
      opportunitiesRead: opportunities?.length ?? 0,
      previouslyAttemptedExcluded: excludedOpportunityIds.size,
      opportunitiesEligibleForCycle: eligibleOpportunities.length,
      currentLunaVariantsRead: latestVariants?.length ?? 0,
      productResearchObservationsReused: productResearchCount.count ?? 0,
      identityEnrichmentRequired: evaluatedCandidates.filter((candidate) =>
        candidate.blockers.includes("IDENTITY_QUERY_TOO_GENERIC") ||
        candidate.blockers.includes("GTIN_INVALID_OR_UNVERIFIED") ||
        candidate.blockers.includes("OFFER_PACK_IDENTITY_MISSING")).length,
      verifiedExistingListings: (existingPilotListing.count ?? 0) > 0 ? 1 : 0,
      selectedCandidates: selected.length,
      localPreparationPackages: selected.length,
    },
    localPreparationPackages: selected.map((candidate) => ({
      candidateKey: candidate.candidateKey,
      package: buildSameDayLocalPreparationPackage(candidate, now.toISOString()),
    })),
    safety: {
      ebayReadCalls: 0,
      ebayWrites: 0,
      openAiCalls: 0,
      productionChanged: false,
      fullCatalogRescan: false,
    },
  }
}

async function createSameDayProductResearchPlan(input: {
  supabase: SupabaseClient
  accountKey: string
  queueRunId: string | null
  selected: ReturnType<typeof selectSameDayQueue>
  operationDate: string
  cycle: number
  supersedeExisting?: boolean
}) {
  if (!input.queueRunId || !input.selected.length) return null
  const groups = new Map<string, typeof input.selected>()
  for (const candidate of input.selected) {
    const key = candidate.queryPlan.query.trim().toLowerCase()
    const group = groups.get(key) ?? []
    group.push(candidate)
    groups.set(key, group)
  }
  const queries = [...groups.values()].slice(0, 15).map((group, index) => ({
    ordinal: index + 1,
    search_query: group[0].queryPlan.query.slice(0, 100),
    query_hash: versionedHash(group[0].queryPlan.query.trim().toLowerCase()),
    cluster_key_hash: versionedHash(group[0].familyFingerprint),
    category_id: null,
    candidate_count: group.length,
    candidate_variant_hashes: group.map((candidate) => versionedHash(text(candidate.supplierVariantId))).sort(),
  }))
  const inputHash = versionedHash({ version: SAME_DAY_PILOT_VERSION, operationDate: input.operationDate,
    cycle: input.cycle,
    candidates: input.selected.map((candidate) => ({ variant: candidate.supplierVariantId, query: candidate.queryPlan.query })) })
  const { data, error } = await input.supabase.rpc("create_product_research_query_plan_v2", {
    p_plan_id: randomUUID(), p_marketplace_account_key: input.accountKey,
    p_run_id: input.queueRunId, p_plan_version: `${SAME_DAY_PILOT_VERSION}_QUERY_PLAN_V2`,
    p_input_hash: inputHash, p_candidate_count: input.selected.length, p_queries: queries,
    p_supersede_existing: input.supersedeExisting !== false,
  })
  if (error || !data) throw new Error("SAME_DAY_PILOT_PRODUCT_RESEARCH_PLAN_CREATE_FAILED")
  return String(data)
}

async function replenishSettledSameDayRun(input: {
  supabase: SupabaseClient
  accountKey: string
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>
  now: Date
  mode?: "SETTLED_RUN" | "OUT_OF_STOCK_REPLACEMENT"
  rejectedCandidateId?: string
}) {
  const { state, now } = input
  const immediateOutOfStockReplacement =
    input.mode === "OUT_OF_STOCK_REPLACEMENT"
  const sourceInventory = record(state.run.source_inventory)
  const target = Math.max(0, Math.min(SAME_DAY_QUEUE_LIMIT,
    Number(state.run.target_new_listings ?? 2)))
  const verifiedCount = state.candidates.filter((candidate) =>
    candidate.machine_state === "VERIFIED_ACTIVE").length
  const settled = state.candidates.length > 0 && state.candidates.every((candidate) =>
    ["REJECTED", "BLOCKED", "VERIFIED_ACTIVE", "COMPLETED"]
      .includes(text(candidate.machine_state)))
  const openTask = state.tasks.some((task) => task.status === "OPEN")
  const pendingJob = state.jobs.some((job) =>
    ["PENDING", "WAITING_RETRY", "LEASED"].includes(text(job.status)))
  const rejectedCandidate = immediateOutOfStockReplacement
    ? state.candidates.find((candidate) =>
        text(candidate.id) === text(input.rejectedCandidateId) &&
        text(candidate.machine_state) === "REJECTED" &&
        strings(candidate.blockers).includes("LUNA_OUT_OF_STOCK"))
    : null
  const settledRunEligible = text(state.run.status) === "BLOCKED" && settled &&
    !openTask && !pendingJob && verifiedCount < target
  const immediateReplacementEligible = Boolean(
    immediateOutOfStockReplacement && rejectedCandidate && !openTask,
  )
  if (!settledRunEligible && !immediateReplacementEligible) {
    return { status: "NOT_ELIGIBLE", replenished: 0, exhausted: false }
  }
  if (!immediateOutOfStockReplacement &&
    text(sourceInventory.replenishmentExhaustionVersion) ===
    SAME_DAY_REPLENISHMENT_VERSION) {
    return { status: "ALREADY_EXHAUSTED", replenished: 0, exhausted: true }
  }

  const maxOrdinal = Math.max(0, ...state.candidates.map((candidate) =>
    Number(candidate.ordinal) || 0))
  const remainingAttemptCapacity = SAME_DAY_MAX_TOTAL_CANDIDATE_ATTEMPTS - maxOrdinal
  const remainingTarget = target - verifiedCount
  const requested = immediateOutOfStockReplacement
    ? Math.min(1, remainingAttemptCapacity)
    : Math.min(SAME_DAY_QUEUE_LIMIT, remainingTarget, remainingAttemptCapacity)
  const persistExhaustion = async (reasonCode: string) => {
    if (immediateOutOfStockReplacement) {
      return {
        status: `IMMEDIATE_REPLACEMENT_${reasonCode}`,
        replenished: 0,
        exhausted: false,
      }
    }
    const exhaustedSource = {
      ...sourceInventory,
      nextCandidateSetExhausted: true,
      nextCandidateSetExhaustedAt: now.toISOString(),
      replenishmentExhaustionVersion: SAME_DAY_REPLENISHMENT_VERSION,
      replenishmentExhaustionReason: reasonCode,
      attemptedCandidatesExcluded: state.candidates.length,
      fullCatalogRescan: false,
    }
    const { error: runError } = await input.supabase
      .from("ebay_same_day_pilot_runs")
      .update({ status: "BLOCKED", stage: "BLOCKED",
        source_inventory: exhaustedSource,
        next_automated_action: "Preservar los listings verificados; no quedan candidatos locales recuperables.",
        next_human_action: "No forzar una publicación. Esperar nueva evidencia elegible.",
        updated_at: now.toISOString() })
      .eq("id", state.run.id)
    if (runError) throw new Error("SAME_DAY_PILOT_REPLENISHMENT_EXHAUSTION_PERSIST_FAILED")
    const { error: eventError } = await input.supabase
      .from("ebay_same_day_pilot_events")
      .upsert({ run_id: state.run.id,
        event_type: "SAME_RUN_CANDIDATE_REPLENISHMENT_EXHAUSTED",
        event_payload: { version: SAME_DAY_REPLENISHMENT_VERSION, reasonCode,
          targetNewListings: target, verifiedNewListings: verifiedCount,
          attemptedCandidates: state.candidates.length, maximumAttempts:
            SAME_DAY_MAX_TOTAL_CANDIDATE_ATTEMPTS },
        idempotency_key: `${state.run.id}:${SAME_DAY_REPLENISHMENT_VERSION}:EXHAUSTED`,
        ebay_read_calls: 0, openai_calls: 0, ebay_writes: 0,
        production_changed: false },
      { onConflict: "idempotency_key", ignoreDuplicates: true })
    if (eventError) throw new Error("SAME_DAY_PILOT_REPLENISHMENT_EXHAUSTION_EVENT_FAILED")
    return { status: reasonCode, replenished: 0, exhausted: true }
  }
  if (requested <= 0) return persistExhaustion("MAXIMUM_CANDIDATE_ATTEMPTS_REACHED")

  const preview = await previewSameDayPilot({
    supabase: input.supabase,
    accountKey: input.accountKey,
    now,
    excludeOpportunityIds: state.candidates.map((candidate) =>
      text(candidate.opportunity_id)),
    excludeCandidateKeys: state.candidates.map((candidate) =>
      text(candidate.candidate_key)),
    excludeSupplierVariantIds: state.candidates.map((candidate) =>
      text(candidate.supplier_variant_id)),
    excludeFamilyFingerprints: state.candidates.map((candidate) =>
      text(candidate.family_fingerprint)),
  })
  const selected = preview.selected.slice(0, requested)
  if (!selected.length) return persistExhaustion("NO_RECOVERABLE_LOCAL_CANDIDATES")

  const replenishmentBatch = Math.min(SAME_DAY_MAX_CANDIDATE_CYCLES,
    Math.floor(maxOrdinal / SAME_DAY_QUEUE_LIMIT) + 1)
  const productResearchPlanId = await createSameDayProductResearchPlan({
    supabase: input.supabase,
    accountKey: input.accountKey,
    queueRunId: preview.latestQueueRunId,
    selected,
    operationDate: text(state.run.operation_date),
    cycle: replenishmentBatch,
    // The original five-candidate plan remains scoped to candidates already
    // in flight. A one-for-one OOS replacement owns a separate plan and must
    // not invalidate the next valid candidate (for example 80144).
    supersedeExisting: !immediateOutOfStockReplacement,
  })
  const nextSourceInventory = {
    ...sourceInventory,
    ...preview.counts,
    productResearchPlanPrepared: Boolean(productResearchPlanId),
    productResearchPlanId: immediateOutOfStockReplacement
      ? sourceInventory.productResearchPlanId ?? null
      : productResearchPlanId,
    replacementProductResearchPlanIds: immediateOutOfStockReplacement &&
      productResearchPlanId
      ? [...new Set([
          ...strings(sourceInventory.replacementProductResearchPlanIds),
          productResearchPlanId,
        ])]
      : strings(sourceInventory.replacementProductResearchPlanIds),
    nextCandidateSetExhausted: false,
    replenishmentExhaustionVersion: null,
    replenishmentExhaustionReason: null,
    sameRunReplenishmentVersion: SAME_DAY_REPLENISHMENT_VERSION,
    replenishmentBatch,
    replenishmentMode: immediateOutOfStockReplacement
      ? "OUT_OF_STOCK_REPLACEMENT"
      : "SETTLED_RUN",
    replacedCandidateId: immediateOutOfStockReplacement
      ? text(input.rejectedCandidateId)
      : null,
    attemptedCandidatesExcluded: state.candidates.length,
    fullCatalogRescan: false,
  }
  const { error: metadataError } = await input.supabase
    .from("ebay_same_day_pilot_runs")
    .update({ source_inventory: nextSourceInventory,
      quota_snapshot: { lanes: preview.quotaLanes,
        exactValidationCallsEstimated: selected.reduce((total, candidate) =>
          total + candidate.callsEstimated, 0), protectedMonitorBudgetUsed: false },
      monitor_snapshot: preview.monitor, updated_at: now.toISOString() })
    .eq("id", state.run.id)
  if (metadataError) throw new Error("SAME_DAY_PILOT_REPLENISHMENT_METADATA_FAILED")

  const rows = selected.map((entry, index) => ({
    run_id: state.run.id,
    opportunity_id: entry.id,
    queue_item_id: preview.queueItemByVariant.get(text(entry.supplierVariantId)) ?? null,
    ordinal: maxOrdinal + index + 1,
    state: entry.state,
    machine_state: "RUN_CREATED",
    candidate_key: entry.candidateKey,
    product_title: entry.productTitle,
    supplier_sku: entry.supplierSku,
    supplier_variant_id: entry.supplierVariantId,
    family_fingerprint: entry.familyFingerprint,
    priority: entry.priority,
    blockers: entry.blockers,
    evidence_summary: {
      activeExactCount: entry.activeExactCount,
      soldExactCount: entry.soldExactCount,
      compatibleSellerCount: entry.compatibleSellerCount,
      evidenceFresh: entry.evidenceFresh,
      broadSearchIsDemand: false,
      historicalMarketCheckStatus: Number(entry.soldExactCount ?? 0) > 0 &&
        entry.evidenceFresh ? "COMPLETED_WITH_EXACT_SOLD" : "PENDING",
      commercialEvidenceMode: Number(entry.soldExactCount ?? 0) > 0 &&
        entry.evidenceFresh ? "MARKET_VALIDATED" : null,
      selectionIdentity: {
        exactIdentityConfirmed: entry.exactIdentityConfirmed === true,
        independentlyVerified: entry.identityIndependentlyVerified === true,
        confidence: entry.identityConfidence ?? 0,
        evidenceSource: entry.identityEvidenceSource ?? null,
        evidenceHash: entry.identityEvidenceHash ?? null,
        exactOfferPackVerified: entry.offerPackVerified === true,
        nativePackCount: entry.nativePackCount ?? null,
        confirmationRequired: entry.lunaIdentityConfirmationRequired === true,
      },
    },
    economics_summary: { ready: entry.economicsReady,
      estimatedProfit: entry.estimatedProfit, roiPercent: entry.roiPercent,
      netMarginPercent: entry.netMarginPercent },
    product_research_query_plan: productResearchPlanId
      ? { ...entry.queryPlan, productResearchPlanId }
      : entry.queryPlan,
    calls_estimated: entry.callsEstimated,
    local_preparation_status: "BLOCKED_PENDING_VERIFIED_GATES",
    local_preparation_package: buildSameDayLocalPreparationPackage(entry,
      now.toISOString()),
    next_automated_action: entry.nextAutomatedAction,
    next_human_action: entry.nextHumanAction,
  }))
  const { data: inserted, error: insertError } = await input.supabase
    .from("ebay_same_day_pilot_candidates").insert(rows).select("*")
  if (insertError) throw new Error("SAME_DAY_PILOT_REPLENISHMENT_INSERT_FAILED")
  const lastOrdinal = maxOrdinal + selected.length
  const runPatch = immediateOutOfStockReplacement
    ? {
        queue_count: lastOrdinal,
        updated_at: now.toISOString(),
      }
    : {
        queue_count: lastOrdinal,
        status: "ACTIVE",
        stage: "QUEUE_PREPARED",
        next_automated_action: "Procesar automáticamente los candidatos de reposición.",
        next_human_action: "Ninguna hasta que el flujo solicite una validación indispensable.",
        updated_at: now.toISOString(),
      }
  const { error: finalizeError } = await input.supabase
    .from("ebay_same_day_pilot_runs")
    .update(runPatch)
    .eq("id", state.run.id)
  if (finalizeError) throw new Error("SAME_DAY_PILOT_REPLENISHMENT_FINALIZE_FAILED")
  const selectionHash = hash(selected.map((candidate) => candidate.candidateKey))
  const { error: eventError } = await input.supabase
    .from("ebay_same_day_pilot_events")
    .upsert({ run_id: state.run.id,
      event_type: immediateOutOfStockReplacement
        ? "SAME_RUN_OUT_OF_STOCK_CANDIDATE_REPLACED"
        : "SAME_RUN_CANDIDATES_REPLENISHED",
      event_payload: { version: SAME_DAY_REPLENISHMENT_VERSION,
        replenishmentBatch, addedCandidates: selected.length,
        firstOrdinal: maxOrdinal + 1, lastOrdinal, targetNewListings: target,
        verifiedNewListings: verifiedCount, selectionHash,
        replacementReason: immediateOutOfStockReplacement
          ? "LUNA_OUT_OF_STOCK"
          : "SETTLED_RUN_BELOW_TARGET",
        replacedCandidateId: immediateOutOfStockReplacement
          ? text(input.rejectedCandidateId)
          : null },
      idempotency_key: immediateOutOfStockReplacement
        ? `${state.run.id}:${SAME_DAY_REPLENISHMENT_VERSION}:OUT_OF_STOCK:${text(input.rejectedCandidateId)}`
        : `${state.run.id}:${SAME_DAY_REPLENISHMENT_VERSION}:${maxOrdinal + 1}:${selectionHash}`,
      ebay_read_calls: 0, openai_calls: 0, ebay_writes: 0,
      production_changed: false },
    { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (eventError) throw new Error("SAME_DAY_PILOT_REPLENISHMENT_EVENT_FAILED")
  const first = inserted?.[0]
  if (first && !immediateOutOfStockReplacement) {
    await bootstrapCandidate(input.supabase, state.run.id, record(first))
  }
  return {
    status: immediateOutOfStockReplacement
      ? "OUT_OF_STOCK_REPLACED"
      : "REPLENISHED",
    replenished: selected.length,
    exhausted: false,
  }
}

export async function startSameDayPilot(input: { supabase: SupabaseClient; accountKey: string; actorId: string; now?: Date }) {
  const now = input.now ?? new Date()
  const date = operationDate(now)
  let existing = await currentState(input.supabase, input.accountKey, date)
  let repaired = false
  if (existing) {
    repaired = await repairSameDayPilotBootstrap(
      input.supabase, existing, input.accountKey,
    )
    if (repaired) {
      await refreshRunProjection(input.supabase, existing.run.id)
      existing = await currentState(input.supabase, input.accountKey, date)
    }
    if (existing && await repairRejectedProductFactAuthorityLineage(input.supabase, existing, now)) {
      repaired = true
      existing = await currentState(input.supabase, input.accountKey,
        text(existing.run.operation_date) || date)
    }
    if (existing && await repairPrematureTaxonomyRejections(input.supabase, existing, now)) {
      repaired = true
      existing = await currentState(input.supabase, input.accountKey,
        text(existing.run.operation_date) || date)
    }
    if (existing && await repairRejectedSingleFactException(input.supabase, existing, now)) {
      repaired = true
      existing = await currentState(input.supabase, input.accountKey,
        text(existing.run.operation_date) || date)
    }
    if (existing && await repairStaleSupplyOpenAiInputRejection(
      input.supabase,
      existing,
      now,
    )) {
      repaired = true
      existing = await currentState(input.supabase, input.accountKey,
        text(existing.run.operation_date) || date)
    }
    if (existing && await repairStaleDecisionProductFactsRejection(input.supabase, existing, now)) {
      repaired = true
      existing = await currentState(input.supabase, input.accountKey,
        text(existing.run.operation_date) || date)
    }
    if (existing && await repairOfficialBrandMarketPricingGap(input.supabase, existing, now)) {
      repaired = true
      existing = await currentState(input.supabase, input.accountKey,
        text(existing.run.operation_date) || date)
    }
  }
  const recoverEmptyRun = Boolean(existing && existing.candidates.length === 0
    && Number(existing.run.queue_count ?? 0) === 0)
  const startNextCycle = Boolean(existing && !recoverEmptyRun
    && existing.nextCandidateCycle.allowed === true)
  const cycleDate = existing ? text(existing.run.operation_date) || date : date
  if (existing && !recoverEmptyRun && !startNextCycle) {
    const current = await currentState(input.supabase, input.accountKey, cycleDate)
    return { ...(current ?? existing), created: false, idempotent: true, repaired }
  }

  const { data: cycleRuns, error: cycleRunsError } = await input.supabase
    .from("ebay_same_day_pilot_runs")
    .select("id,cycle,verified_existing_listings,verified_new_listings")
    .eq("marketplace_account_key", input.accountKey)
    .eq("operation_date", cycleDate)
    .order("cycle", { ascending: true })
  if (cycleRunsError) throw new Error("SAME_DAY_PILOT_CYCLE_HISTORY_READ_FAILED")
  const cycleRunIds = (cycleRuns ?? []).map((run) => text(run.id)).filter(Boolean)
  const { data: attemptedCandidates, error: attemptedCandidateError } = cycleRunIds.length
    ? await input.supabase.from("ebay_same_day_pilot_candidates")
      .select("opportunity_id,candidate_key,supplier_variant_id,family_fingerprint")
      .in("run_id", cycleRunIds)
    : { data: [], error: null }
  if (attemptedCandidateError) throw new Error("SAME_DAY_PILOT_ATTEMPT_HISTORY_READ_FAILED")
  const attemptedRows = attemptedCandidates ?? []
  const cycle = startNextCycle
    ? Math.max(1, ...(cycleRuns ?? []).map((run) => number(run.cycle) ?? 1)) + 1
    : recoverEmptyRun ? number(existing?.run.cycle) ?? 1 : 1
  if (cycle > SAME_DAY_MAX_CANDIDATE_CYCLES) {
    throw new Error("SAME_DAY_PILOT_MAX_CANDIDATE_CYCLES_REACHED")
  }
  const cumulativeVerifiedProgress = Math.min(3, Math.max(0, ...(cycleRuns ?? []).map((run) =>
    (number(run.verified_existing_listings) ?? 0) + (number(run.verified_new_listings) ?? 0))))
  const verifiedExistingListings = startNextCycle
    ? cumulativeVerifiedProgress
    : number(existing?.run.verified_existing_listings) ?? 0
  const targetNewListings = startNextCycle
    ? Math.min(2, Math.max(0, 3 - verifiedExistingListings))
    : number(existing?.run.target_new_listings) ?? 2
  const preview = await previewSameDayPilot({
    supabase: input.supabase,
    accountKey: input.accountKey,
    now,
    excludeOpportunityIds: attemptedRows.map((row) => text(row.opportunity_id)),
    excludeCandidateKeys: attemptedRows.map((row) => text(row.candidate_key)),
    excludeSupplierVariantIds: attemptedRows.map((row) => text(row.supplier_variant_id)),
    excludeFamilyFingerprints: attemptedRows.map((row) => text(row.family_fingerprint)),
  })
  const selected = preview.selected
  const queueItemByVariant = preview.queueItemByVariant

  if (startNextCycle && selected.length === 0) {
    const sourceInventory = {
      ...record(existing!.run.source_inventory),
      nextCandidateSetExhausted: true,
      nextCandidateSetExhaustedAt: now.toISOString(),
      attemptedCandidatesExcluded: attemptedRows.length,
      fullCatalogRescan: false,
    }
    const { error: exhaustedError } = await input.supabase.from("ebay_same_day_pilot_runs")
      .update({ source_inventory: sourceInventory,
        next_automated_action: "Preservar el trabajo; no quedan candidatos distintos elegibles en la cola local actual.",
        next_human_action: "No forzar una publicación. Esperar nueva evidencia o el próximo ciclo operativo.",
        updated_at: now.toISOString() })
      .eq("id", existing!.run.id)
    if (exhaustedError) throw new Error("SAME_DAY_PILOT_EXHAUSTION_PERSIST_FAILED")
    const exhausted = await currentState(input.supabase, input.accountKey, cycleDate)
    if (!exhausted) throw new Error("SAME_DAY_PILOT_STATE_MISSING")
    return { ...exhausted, created: false, idempotent: false,
      nextSetExhausted: true, reasonCode: "NEXT_CANDIDATE_SET_EXHAUSTED" }
  }

  const runKey = cycle === 1
    ? `${SAME_DAY_PILOT_VERSION}:${input.accountKey}:${cycleDate}`
    : `${SAME_DAY_PILOT_VERSION}:${input.accountKey}:${cycleDate}:CYCLE:${cycle}`
  const { data: claimData, error: claimError } = await input.supabase
    .rpc("claim_same_day_pilot_cycle_v1", {
      p_marketplace_account_key: input.accountKey,
      p_operation_date: cycleDate,
      p_cycle: cycle,
      p_run_key: runKey,
      p_target_new_listings: targetNewListings,
      p_verified_existing_listings: verifiedExistingListings || preview.counts.verifiedExistingListings,
      p_created_by: input.actorId,
      p_expected_previous_run_id: startNextCycle ? existing!.run.id : null,
      p_now: now.toISOString(),
    })
  if (claimError) throw new Error("SAME_DAY_PILOT_CYCLE_CLAIM_FAILED")
  const claim = record(claimData)
  const runId = text(claim.runId)
  if (!runId) throw new Error("SAME_DAY_PILOT_CYCLE_CLAIM_INVALID")
  if (claim.claimed !== true) {
    const raced = await currentState(input.supabase, input.accountKey, cycleDate)
    if (raced) return { ...raced, created: false, idempotent: true }
    throw new Error("SAME_DAY_PILOT_RUN_CREATE_FAILED")
  }

  if (!selected.length) {
    const { error: emptyError } = await input.supabase.from("ebay_same_day_pilot_runs")
      .update({ status: "BLOCKED", stage: "BLOCKED",
        source_inventory: { ...preview.counts, cycle, fullCatalogRescan: false,
          nextCandidateSetExhausted: true, nextCandidateSetExhaustedAt: now.toISOString() },
        next_automated_action: "No hay candidatos seguros en la cola local actual.",
        next_human_action: "No forzar una publicación; esperar nueva evidencia.",
        updated_at: now.toISOString() })
      .eq("id", runId)
    if (emptyError) throw new Error("SAME_DAY_PILOT_EMPTY_CYCLE_PERSIST_FAILED")
    const emptyState = await currentState(input.supabase, input.accountKey, cycleDate)
    if (!emptyState) throw new Error("SAME_DAY_PILOT_STATE_MISSING")
    return { ...emptyState, created: claim.created === true, idempotent: false,
      nextSetExhausted: true, reasonCode: "NEXT_CANDIDATE_SET_EXHAUSTED" }
  }

  const productResearchPlanId = await createSameDayProductResearchPlan({
    supabase: input.supabase, accountKey: input.accountKey,
    queueRunId: preview.latestQueueRunId, selected, operationDate: cycleDate, cycle,
  })
  const sourceInventory = { ...preview.counts, cycle,
    previousRunId: startNextCycle ? existing!.run.id : null,
    attemptedCandidatesExcluded: attemptedRows.length,
    candidateInsertFailureCount: number(
      record(existing?.run.source_inventory).candidateInsertFailureCount,
    ) ?? 0,
    fullCatalogRescan: false,
    productResearchPlanPrepared: Boolean(productResearchPlanId), productResearchPlanId }
  const quotaSnapshot = { lanes: preview.quotaLanes,
    exactValidationCallsEstimated: selected.reduce((total, row) => total + row.callsEstimated, 0),
    protectedMonitorBudgetUsed: false }
  const { error: metadataError } = await input.supabase.from("ebay_same_day_pilot_runs")
    .update({ source_inventory: sourceInventory, quota_snapshot: quotaSnapshot,
      monitor_snapshot: preview.monitor, updated_at: now.toISOString() })
    .eq("id", runId).eq("queue_count", 0)
  if (metadataError) throw new Error("SAME_DAY_PILOT_CYCLE_METADATA_PERSIST_FAILED")

  const rows = selected.map((entry, index) => ({
    run_id: runId, opportunity_id: entry.id, queue_item_id: queueItemByVariant.get(text(entry.supplierVariantId)) ?? null,
    ordinal: index + 1, state: entry.state, machine_state: "RUN_CREATED",
    candidate_key: entry.candidateKey, product_title: entry.productTitle, supplier_sku: entry.supplierSku,
    supplier_variant_id: entry.supplierVariantId, family_fingerprint: entry.familyFingerprint, priority: entry.priority,
    blockers: entry.blockers, evidence_summary: {
      activeExactCount: entry.activeExactCount,
      soldExactCount: entry.soldExactCount,
      compatibleSellerCount: entry.compatibleSellerCount,
      evidenceFresh: entry.evidenceFresh,
      broadSearchIsDemand: false,
      historicalMarketCheckStatus: Number(entry.soldExactCount ?? 0) > 0 && entry.evidenceFresh
        ? "COMPLETED_WITH_EXACT_SOLD" : "PENDING",
      commercialEvidenceMode: Number(entry.soldExactCount ?? 0) > 0 && entry.evidenceFresh
        ? "MARKET_VALIDATED" : null,
      selectionIdentity: {
        exactIdentityConfirmed: entry.exactIdentityConfirmed === true,
        independentlyVerified: entry.identityIndependentlyVerified === true,
        confidence: entry.identityConfidence ?? 0,
        evidenceSource: entry.identityEvidenceSource ?? null,
        evidenceHash: entry.identityEvidenceHash ?? null,
        exactOfferPackVerified: entry.offerPackVerified === true,
        nativePackCount: entry.nativePackCount ?? null,
        confirmationRequired: entry.lunaIdentityConfirmationRequired === true,
      },
    },
    economics_summary: { ready: entry.economicsReady, estimatedProfit: entry.estimatedProfit, roiPercent: entry.roiPercent, netMarginPercent: entry.netMarginPercent },
    product_research_query_plan: productResearchPlanId
      ? { ...entry.queryPlan, productResearchPlanId }
      : entry.queryPlan,
    calls_estimated: entry.callsEstimated,
    local_preparation_status: "BLOCKED_PENDING_VERIFIED_GATES",
    local_preparation_package: buildSameDayLocalPreparationPackage(entry, now.toISOString()),
    next_automated_action: entry.nextAutomatedAction, next_human_action: entry.nextHumanAction,
  }))
  if (rows.length) {
    const { data: candidates, error } = await input.supabase.from("ebay_same_day_pilot_candidates").insert(rows).select("*")
    if (error) {
      const candidateInsertFailureCount = Number(sourceInventory.candidateInsertFailureCount) + 1
      const failureSourceInventory = { ...sourceInventory,
        candidateInsertFailureCount,
        lastCandidateInsertFailureCode: "SAME_DAY_PILOT_CANDIDATES_CREATE_FAILED",
        lastCandidateInsertFailureAt: new Date().toISOString(),
        preparedPlanPreserved: Boolean(productResearchPlanId) }
      const { error: recoveryError } = await input.supabase.from("ebay_same_day_pilot_runs")
        .update({ status: "BLOCKED", stage: "CANDIDATE_INSERT_RETRYABLE",
          source_inventory: failureSourceInventory,
          next_automated_action: "Reutilizar el mismo plan y reintentar la inserción idempotente.",
          next_human_action: "Reanudar los cinco candidatos preparados; no repetir capturas.",
          updated_at: new Date().toISOString() })
        .eq("id", runId).eq("queue_count", 0)
      if (recoveryError) throw new Error("SAME_DAY_PILOT_CANDIDATE_FAILURE_RECOVERY_PERSIST_FAILED")
      await input.supabase.from("ebay_same_day_pilot_events").upsert({
        run_id: runId, event_type: "CANDIDATE_INSERT_RETRYABLE_FAILURE",
        event_payload: { reasonCode: "SAME_DAY_PILOT_CANDIDATES_CREATE_FAILED",
          preparedPlanPreserved: Boolean(productResearchPlanId), candidateInsertFailureCount },
        idempotency_key: `${runId}:CANDIDATE_INSERT_RETRYABLE_FAILURE:${candidateInsertFailureCount}`,
        ebay_read_calls: 0, openai_calls: 0, ebay_writes: 0, production_changed: false,
      }, { onConflict: "idempotency_key", ignoreDuplicates: true })
      throw new Error("SAME_DAY_PILOT_CANDIDATES_CREATE_FAILED")
    }
    const { error: finalizeError } = await input.supabase.from("ebay_same_day_pilot_runs")
      .update({ queue_count: selected.length, stage: "QUEUE_PREPARED", status: "ACTIVE",
        next_automated_action: "Esperar y procesar automáticamente la próxima evidencia autorizada.",
        next_human_action: "Completar la primera tarea en Tareas para Ernesto.",
        updated_at: now.toISOString() })
      .eq("id", runId).eq("queue_count", 0)
    if (finalizeError) throw new Error("SAME_DAY_PILOT_CYCLE_FINALIZE_FAILED")
    const first = candidates?.[0]
    if (first) await bootstrapCandidate(input.supabase, runId, record(first))
  }
  const eventType = startNextCycle ? "NEXT_CANDIDATE_CYCLE_STARTED"
    : claim.recovered === true ? "EMPTY_RUN_RECOVERED" : "RUN_STARTED"
  const { error: eventError } = await input.supabase.from("ebay_same_day_pilot_events").upsert({ run_id: runId, event_type: eventType,
    event_payload: { oneClick: true, candidates: selected.length, fullCatalogRescan: false,
      deepDiscoveryFrozen: true, recoveredEmptyRun: claim.recovered === true, cycle,
      priorCandidatesExcluded: attemptedRows.length },
    idempotency_key: `${runId}:${eventType}`, ebay_read_calls: 0, openai_calls: 0, ebay_writes: 0, production_changed: false },
  { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (eventError) throw new Error("SAME_DAY_PILOT_START_EVENT_PERSIST_FAILED")
  await refreshRunProjection(input.supabase, runId)
  const state = await currentState(input.supabase, input.accountKey, cycleDate)
  if (!state) throw new Error("SAME_DAY_PILOT_STATE_MISSING")
  return { ...state, created: claim.created === true, recovered: claim.recovered === true,
    candidateCycleStarted: startNextCycle, idempotent: false }
}

export async function getSameDayPilot(input: { supabase: SupabaseClient; accountKey: string; now?: Date }) {
  const now = input.now ?? new Date()
  return currentState(input.supabase, input.accountKey, operationDate(now), now)
}

export async function confirmSameDayLuna(input: { supabase: SupabaseClient; accountKey: string; actorId: string; taskId: string; price: number | null; available: boolean; quantity: number | null; identityAndPackConfirmed?: boolean; nativePackCount?: number | null }) {
  const state = await getSameDayPilot(input)
  if (!state) throw new Error("SAME_DAY_PILOT_RUN_MISSING")
  const task = state.tasks.find((entry) => entry.id === input.taskId && entry.status === "OPEN")
  if (!task || task.gate_type !== "LUNA_CONFIRMATION_REQUIRED") throw new Error("SAME_DAY_PILOT_LUNA_TASK_INVALID")
  if (!isValidSameDayLunaConfirmation(input)) {
    throw new Error("SAME_DAY_PILOT_LUNA_CONFIRMATION_INVALID")
  }
  const confirmedPrice = input.price
  const candidate = state.candidates.find((entry) => entry.id === task.candidate_id)
  if (!candidate) throw new Error("SAME_DAY_PILOT_LUNA_CANDIDATE_MISSING")
  const evidence = record(candidate.evidence_summary)
  const selectionIdentity = record(evidence.selectionIdentity)
  const taskFields = strings(record(task.action_schema).fields)
  const identityConfirmationRequired = selectionIdentity.confirmationRequired === true &&
    selectionIdentity.independentlyVerified !== true
  // New Luna gates always bind the physical presentation. Legacy gates retain
  // their original contract unless identity was already explicitly required.
  const packConfirmationRequired = taskFields.includes("nativePackCount") ||
    identityConfirmationRequired
  const confirmedNativePackCount = number(input.nativePackCount) ??
    number(selectionIdentity.nativePackCount)
  if (input.available && packConfirmationRequired &&
    (input.identityAndPackConfirmed !== true || !Number.isInteger(confirmedNativePackCount) ||
      Number(confirmedNativePackCount) <= 0 || Number(confirmedNativePackCount) > 100)) {
    throw new Error("SAME_DAY_PILOT_LUNA_IDENTITY_PACK_CONFIRMATION_REQUIRED")
  }
  const explicitTitlePackCount = explicitPackCountFromTitle(candidate.product_title)
  if (input.available && packConfirmationRequired && explicitTitlePackCount !== null &&
    confirmedNativePackCount !== explicitTitlePackCount) {
    throw new Error("SAME_DAY_PILOT_OFFER_PACK_VISIBLE_COUNT_CONFLICT")
  }
  const quantity = listingQuantityFromLuna(input.quantity, input.available)
  const now = new Date().toISOString()
  const confirmedSelectionIdentity = input.available && packConfirmationRequired
    ? {
        ...selectionIdentity,
        exactIdentityConfirmed: true,
        independentlyVerified: true,
        confidence: 100,
        evidenceSource: "OPERATOR_VISIBLE_LUNA_EXACT_PRODUCT_PAGE",
        evidenceHash: versionedHash({
          version: "LUNA_VISIBLE_IDENTITY_CONFIRMATION_V1",
          candidateId: candidate.id,
          supplierVariantId: candidate.supplier_variant_id,
          productTitleHash: versionedHash(text(candidate.product_title)),
          nativePackCount: confirmedNativePackCount,
          confirmedAt: now,
        }),
        exactOfferPackVerified: true,
        nativePackCount: confirmedNativePackCount,
        confirmationRequired: false,
        confirmedAt: now,
        actorRecorded: Boolean(input.actorId),
      }
    : selectionIdentity
  const confirmedEvidence = {
    ...evidence,
    selectionIdentity: confirmedSelectionIdentity,
  }
  if (input.available && packConfirmationRequired && text(candidate.queue_item_id)) {
    const { data: queueItem, error: queueReadError } = await input.supabase
      .from("marketplace_listing_approval_queue_items")
      .select("id,evidence_snapshot")
      .eq("id", candidate.queue_item_id)
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", MARKETPLACE)
      .maybeSingle()
    if (queueReadError || !queueItem) {
      throw new Error("SAME_DAY_PILOT_OFFER_PACK_QUEUE_ITEM_READ_FAILED")
    }
    const queueSnapshot = record(queueItem.evidence_snapshot)
    const packStrategy = record(queueSnapshot.packStrategy)
    const recommendedPack = record(packStrategy.recommendedPack)
    const { error: queueUpdateError } = await input.supabase
      .from("marketplace_listing_approval_queue_items")
      .update({ recommended_pack_count: confirmedNativePackCount,
        evidence_snapshot: { ...queueSnapshot,
          packStrategy: { ...packStrategy,
            recommendedPack: { ...recommendedPack,
              packCount: confirmedNativePackCount } },
          operatorOfferPackConfirmation: {
            nativePackCount: confirmedNativePackCount,
            evidenceHash: text(confirmedSelectionIdentity.evidenceHash),
            confirmedAt: now,
            source: "OPERATOR_VISIBLE_LUNA_EXACT_PRODUCT_PAGE",
            actorRecorded: Boolean(input.actorId), urlStored: false,
          } },
        updated_at: now })
      .eq("id", queueItem.id)
      .eq("marketplace_account_key", input.accountKey)
    if (queueUpdateError) throw new Error("SAME_DAY_PILOT_OFFER_PACK_QUEUE_ITEM_UPDATE_FAILED")
  }
  const lunaConfirmation = {
    status: input.available
      ? input.quantity == null ? "AVAILABLE_QUANTITY_NOT_SHOWN" : "AVAILABLE_EXACT_QUANTITY"
      : "OUT_OF_STOCK",
    confirmedUnitCost: confirmedPrice,
    confirmedQuantity: input.quantity,
    quantityVisible: input.quantity != null,
    recheckAfterSale: quantity.recheckAfterSale,
    source: "OPERATOR_VISIBLE_LUNA_PRODUCT_PAGE",
    confirmedAt: now,
    confirmedByActorRecorded: Boolean(input.actorId),
    supplierProductLinkPresent: Boolean(record(candidate.local_preparation_package).product &&
      text(record(record(candidate.local_preparation_package).product).supplierProductUrl, 2_000)),
    ebayConfirmedSupplierStock: false,
  }
  const economicsSummary = { ...record(candidate.economics_summary),
    confirmedLunaPrice: confirmedPrice, available: input.available, quantity: input.quantity,
    quantityUnknown: input.quantity == null, lunaConfirmation }
  const commercialEvidenceMode = text(evidence.commercialEvidenceMode)
  const controlledExploratoryTest = commercialEvidenceMode === "CONTROLLED_EXPLORATORY_TEST"
  const basePatch = {
    // Luna's visible quantity is supplier evidence, not inventory reserved for
    // this eBay offer. The same-day pilot therefore exposes one offer pack at
    // a time and preserves the full supplier quantity only in lunaConfirmation.
    listingQuantity: input.available ? 1 : null,
    recheckAfterSale: input.available,
    economicsSummary: controlledExploratoryTest
      ? { ...economicsSummary, controlledTestPlan: {
          listingQuantity: 1, commercialMonitorRequired: true,
          oneVariableAtATime: true, automaticPricingUsed: false,
        } }
      : economicsSummary,
    evidenceSummary: confirmedEvidence,
    blockers: strings(candidate.blockers).filter((blocker) => ![
      "IDENTITY_QUERY_TOO_GENERIC",
      "OFFER_PACK_IDENTITY_MISSING",
      "EXACT_OR_STRONG_IDENTITY_REQUIRED",
      "LUNA_VISIBLE_IDENTITY_AND_PACK_CONFIRMATION_REQUIRED",
    ].includes(blocker)),
  }
  if (!input.available) {
    await completeAndAdvanceHumanGate({ supabase: input.supabase, taskId: task.id,
      gateType: "LUNA_CONFIRMATION_REQUIRED", runId: state.run.id, candidateId: task.candidate_id,
      previousState: "WAITING_LUNA_CONFIRMATION", nextState: "REJECTED",
      reasonCode: "LUNA_OUT_OF_STOCK", triggeredBy: "USER",
      checkpoint: { available: false, operatorConfirmedAt: now },
      candidatePatch: { ...basePatch, state: "REJECTED_TODAY", blockers: ["LUNA_OUT_OF_STOCK"] },
      nextAutomaticAction: "Agregar un reemplazo elegible y promover el siguiente candidato.",
      nextHumanAction: "Ninguna." })
    const productResearchPlanId = text(
      record(candidate.product_research_query_plan).productResearchPlanId,
    ) || text(record(state.run.source_inventory).productResearchPlanId)
    try {
      if (productResearchPlanId) {
        await skipProductResearchQuery({
          supabase: input.supabase,
          accountKey: input.accountKey,
          planId: productResearchPlanId,
          searchQuery: record(candidate.product_research_query_plan).query,
          reasonCode: "LUNA_OUT_OF_STOCK",
          now: new Date(now),
        })
      }
      const rejectedState = await currentState(
        input.supabase,
        input.accountKey,
        text(state.run.operation_date),
      )
      if (rejectedState) {
        await replenishSettledSameDayRun({
          supabase: input.supabase,
          accountKey: input.accountKey,
          state: rejectedState,
          now: new Date(now),
          mode: "OUT_OF_STOCK_REPLACEMENT",
          rejectedCandidateId: text(candidate.id),
        })
      }
    } finally {
      // A replacement lookup must never hold the current five-candidate flow.
      await promoteNextCandidate(
        input.supabase,
        state.run.id,
        Number(candidate.ordinal),
      )
    }
  } else {
    if (confirmedPrice === null) {
      throw new Error("SAME_DAY_PILOT_LUNA_PRICE_INVALID")
    }
    const historicalMarketCheckStatus = text(evidence.historicalMarketCheckStatus)
    const marketDecisionReady = commercialEvidenceMode === "MARKET_VALIDATED" ||
      (controlledExploratoryTest && historicalMarketCheckStatus === "COMPLETED_NO_EXACT_SOLD")
    if (!marketDecisionReady) {
      await completeAndAdvanceHumanGate({ supabase: input.supabase, taskId: task.id,
        gateType: "LUNA_CONFIRMATION_REQUIRED", runId: state.run.id, candidateId: task.candidate_id,
        previousState: "WAITING_LUNA_CONFIRMATION", nextState: "WAITING_PRODUCT_RESEARCH_CAPTURE",
        reasonCode: "LUNA_CONFIRMED_MARKET_EVIDENCE_PENDING", triggeredBy: "USER",
        checkpoint: { price: confirmedPrice, available: true, quantityKnown: input.quantity != null,
          identityAndPackConfirmed: packConfirmationRequired,
          nativePackCount: confirmedNativePackCount },
        candidatePatch: { ...basePatch, state: "NEEDS_PRODUCT_RESEARCH_CAPTURE" },
        nextAutomaticAction: "Importar y reconciliar la captura autorizada.",
        nextHumanAction: "Autorizar una captura Product Research para la consulta preparada." })
      await activateCandidateProductResearchPlan(
        input.supabase,
        state.run.id,
        record(candidate),
      )
      await createHumanTask({ supabase: input.supabase, runId: state.run.id, candidateId: task.candidate_id,
        expectedState: "WAITING_PRODUCT_RESEARCH_CAPTURE",
        gateType: "PRODUCT_RESEARCH_CAPTURE_REQUIRED", title: "Captura Product Research para esta familia",
        why: "Luna ya fue confirmada; falta evidencia vendida exacta y fresca antes de calcular una oferta final.",
        seconds: 60, impact: "Seller OS reconciliará la evidencia y continuará desde el mismo candidato.",
        evidence: { product: candidate.product_title, queryPlan: candidate.product_research_query_plan },
        actionSchema: { type: "OPEN_PRODUCT_RESEARCH", query: record(candidate.product_research_query_plan).query },
        continuationJobType: "RECONCILE_PRODUCT_RESEARCH_CAPTURE" })
    } else {
      if (!text(candidate.queue_item_id)) throw new Error("SAME_DAY_PILOT_FACT_QUEUE_ITEM_MISSING")
      const priorLunaConfirmation = record(record(candidate.economics_summary).lunaConfirmation)
      const priorConfirmedAt = Date.parse(text(priorLunaConfirmation.confirmedAt))
      const nowTimestamp = Date.parse(now)
      const priorQuantityMatches = input.quantity === null
        ? priorLunaConfirmation.confirmedQuantity === null
        : number(priorLunaConfirmation.confirmedQuantity) === input.quantity
      const reusablePriorLunaConfirmation = Number(task.gate_generation) > 1 &&
        priorLunaConfirmation.confirmedByActorRecorded === true &&
        text(priorLunaConfirmation.status).startsWith("AVAILABLE_") &&
        number(priorLunaConfirmation.confirmedUnitCost) === confirmedPrice &&
        priorQuantityMatches && Number.isFinite(priorConfirmedAt) &&
        priorConfirmedAt <= nowTimestamp && nowTimestamp - priorConfirmedAt <= 24 * 60 * 60 * 1_000
      if (!reusablePriorLunaConfirmation) {
        await confirmListingAiQueueLunaObservation({
          supabase: input.supabase,
          accountKey: input.accountKey,
          actorId: input.actorId,
          itemId: text(candidate.queue_item_id),
          idempotencyKey: `${state.run.id}:${task.id}:${SAME_DAY_LUNA_DECISION_REFRESH_VERSION}`,
          priceObserved: confirmedPrice,
          availability: input.quantity === null ? "AVAILABLE_QUANTITY_NOT_SHOWN" : "EXACT_QUANTITY_VISIBLE",
          exactQuantity: input.quantity,
        })
      }
      await completeAndAdvanceHumanGate({ supabase: input.supabase, taskId: task.id,
        gateType: "LUNA_CONFIRMATION_REQUIRED", runId: state.run.id, candidateId: task.candidate_id,
        previousState: "WAITING_LUNA_CONFIRMATION", nextState: "CALCULATING_ECONOMICS",
        reasonCode: controlledExploratoryTest
          ? "LUNA_CONFIRMED_CONTROLLED_TEST_AUTO_RESUME"
          : "LUNA_CONFIRMED_AUTO_RESUME", triggeredBy: "USER",
        checkpoint: { price: confirmedPrice, available: true, quantityKnown: input.quantity != null,
          identityAndPackConfirmed: packConfirmationRequired,
          nativePackCount: confirmedNativePackCount,
          reusedPriorLunaConfirmation: reusablePriorLunaConfirmation },
        candidatePatch: basePatch,
        nextAutomaticAction: "Recalcular economía localmente.", nextHumanAction: "Ninguna.",
        job: { jobType: "CALCULATE_ECONOMICS",
          idempotencyKey: `${state.run.id}:${task.candidate_id}:CALCULATE_ECONOMICS:${task.id}:${SAME_DAY_LUNA_DECISION_REFRESH_VERSION}`,
          checkpoint: { confirmedLunaPrice: confirmedPrice, quantityKnown: input.quantity != null } } })
    }
  }
  await refreshRunProjection(input.supabase, state.run.id)
  return getSameDayPilot(input)
}

export async function decideSameDayFactException(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  taskId: string
  decision: "CONFIRM" | "REJECT"
  value?: string | null
  visibleOfficialLabelConfirmed?: boolean
  brandAbsentConfirmed?: boolean
}) {
  const state = await getSameDayPilot(input)
  if (!state) throw new Error("SAME_DAY_PILOT_RUN_MISSING")
  const task = state.tasks.find((entry) => entry.id === input.taskId && entry.status === "OPEN")
  if (!task || task.gate_type !== "CRITICAL_EXCEPTION_REQUIRED") {
    throw new Error("SAME_DAY_PILOT_FACT_EXCEPTION_TASK_INVALID")
  }
  const candidate = state.candidates.find((entry) => entry.id === task.candidate_id)
  if (!candidate || !["VALIDATING_TAXONOMY", "VALIDATING_REGULATION"]
    .includes(candidate.machine_state)) {
    throw new Error("SAME_DAY_PILOT_FACT_EXCEPTION_CANDIDATE_INVALID")
  }
  const schema = record(task.action_schema)
  const factKey = text(schema.factKey, 100)
  const fieldRequired = text(schema.fieldRequired, 100)
  const resolvedRequirementsValue = record(candidate.product_facts_summary).resolvedRequirements
  const resolvedRequirements = Array.isArray(resolvedRequirementsValue)
    ? resolvedRequirementsValue.map(record) : []
  const resolvedFactKeys = new Set((Array.isArray(record(candidate.product_facts_summary).resolvedFacts)
    ? record(candidate.product_facts_summary).resolvedFacts as unknown[] : [])
    .map(record).filter((fact) => text(fact.scope) === "PRODUCT_UNIT")
    .map((fact) => text(fact.key)).filter(Boolean))
  const regulatoryLabelException = schema.regulatoryFact === true &&
    Object.hasOwn(MANUAL_REGULATORY_FACTS, factKey) && !resolvedFactKeys.has(factKey)
  const officialLabelException = schema.type === "CONFIRM_OFFICIAL_LABEL_FACT" &&
    schema.factScope === "PRODUCT_UNIT" &&
    (regulatoryLabelException ||
      (operatorConfirmableOfficialLabelFact(fieldRequired)?.factKey === factKey &&
        resolvedRequirements.some((requirement) =>
          ["MISSING_BLOCKING", "CONFLICTED_BLOCKING"].includes(
            text(requirement.status),
          ) &&
          text(requirement.aspectName).toLocaleLowerCase() === fieldRequired.toLocaleLowerCase())))
  const offerPackException = schema.type === "CONFIRM_OFFICIAL_OFFER_PACK" &&
    schema.factScope === "OFFER_PACK" && factKey === "offerPackCount"
  const taxonomyException = schema.type === "CONFIRM_OFFICIAL_EBAY_CATEGORY" &&
    schema.factScope === "EBAY_LISTING_REQUIREMENTS" && factKey === "categoryId" &&
    record(record(candidate.product_facts_summary).taxonomy).status !== "AVAILABLE"
  if (!officialLabelException && !offerPackException && !taxonomyException) {
    throw new Error("SAME_DAY_PILOT_FACT_EXCEPTION_SCHEMA_INVALID")
  }
  const now = new Date().toISOString()
  const evidenceSummary = {
    ...record(candidate.evidence_summary),
    singleFactExceptionRecoveryVersion: SINGLE_FACT_EXCEPTION_VERSION,
    singleFactExceptionField: fieldRequired,
    singleFactExceptionDecisionAt: now,
    singleFactExceptionActorRecorded: Boolean(input.actorId),
  }
  if (input.decision === "REJECT") {
    await completeAndAdvanceHumanGate({ supabase: input.supabase, taskId: task.id,
      gateType: "CRITICAL_EXCEPTION_REQUIRED", runId: state.run.id,
      candidateId: task.candidate_id, previousState: candidate.machine_state,
      nextState: "REJECTED", reasonCode: "SINGLE_FACT_EXCEPTION_NOT_VERIFIABLE",
      triggeredBy: "USER", checkpoint: { fieldRequired, rejected: true },
      candidatePatch: { state: "REJECTED_TODAY", blockers: ["MISSING_BLOCKING"],
        evidenceSummary: { ...evidenceSummary, singleFactExceptionRejected: true } },
      nextAutomaticAction: "Promover el siguiente candidato recuperable.",
      nextHumanAction: "Ninguna." })
    await refreshRunProjection(input.supabase, state.run.id)
    return getSameDayPilot(input)
  }
  if (offerPackException) {
    const confirmedPackCount = number(input.value)
    if (input.visibleOfficialLabelConfirmed !== true || confirmedPackCount === null ||
      !Number.isInteger(confirmedPackCount) || confirmedPackCount <= 0 ||
      confirmedPackCount > 100) {
      throw new Error("SAME_DAY_PILOT_FACT_EXCEPTION_EVIDENCE_REQUIRED")
    }
    const explicitTitlePackCount = explicitPackCountFromTitle(candidate.product_title)
    if (explicitTitlePackCount !== null && explicitTitlePackCount !== confirmedPackCount) {
      throw new Error("SAME_DAY_PILOT_OFFER_PACK_VISIBLE_COUNT_CONFLICT")
    }
    const evidenceMode = "OPERATOR_CONFIRMED_VISIBLE_OFFER_PACK"
    const evidenceHash = versionedHash({ version: SINGLE_FACT_EXCEPTION_VERSION,
      taskId: task.id, candidateId: candidate.id, factKey,
      value: confirmedPackCount, evidenceMode })
    const selectionIdentity = {
      ...record(record(candidate.evidence_summary).selectionIdentity),
      exactIdentityConfirmed: true,
      independentlyVerified: true,
      exactOfferPackVerified: true,
      nativePackCount: confirmedPackCount,
      confidence: 100,
      evidenceSource: "OPERATOR_VISIBLE_LUNA_EXACT_PRODUCT_PAGE",
      evidenceHash,
      confirmationRequired: false,
      confirmedAt: now,
      actorRecorded: Boolean(input.actorId),
    }
    if (!text(candidate.queue_item_id)) {
      throw new Error("SAME_DAY_PILOT_FACT_QUEUE_ITEM_MISSING")
    }
    const { data: queueItem, error: queueReadError } = await input.supabase
      .from("marketplace_listing_approval_queue_items")
      .select("id,evidence_snapshot")
      .eq("id", candidate.queue_item_id)
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", MARKETPLACE)
      .maybeSingle()
    if (queueReadError || !queueItem) {
      throw new Error("SAME_DAY_PILOT_OFFER_PACK_QUEUE_ITEM_READ_FAILED")
    }
    const queueSnapshot = record(queueItem.evidence_snapshot)
    const packStrategy = record(queueSnapshot.packStrategy)
    const recommendedPack = record(packStrategy.recommendedPack)
    const { error: queueUpdateError } = await input.supabase
      .from("marketplace_listing_approval_queue_items")
      .update({ recommended_pack_count: confirmedPackCount,
        evidence_snapshot: { ...queueSnapshot,
          packStrategy: { ...packStrategy,
            recommendedPack: { ...recommendedPack,
              packCount: confirmedPackCount } },
          operatorOfferPackConfirmation: {
            nativePackCount: confirmedPackCount, evidenceHash,
            confirmedAt: now,
            source: "OPERATOR_VISIBLE_LUNA_EXACT_PRODUCT_PAGE",
            actorRecorded: Boolean(input.actorId), urlStored: false,
          } },
        // Force the next enrichment to rebuild the commercial binding with the
        // corrected physical presentation before content approval.
        stale_after: now, updated_at: now })
      .eq("id", queueItem.id)
      .eq("marketplace_account_key", input.accountKey)
    if (queueUpdateError) throw new Error("SAME_DAY_PILOT_OFFER_PACK_QUEUE_ITEM_UPDATE_FAILED")
    await completeAndAdvanceHumanGate({ supabase: input.supabase, taskId: task.id,
      gateType: "CRITICAL_EXCEPTION_REQUIRED", runId: state.run.id,
      candidateId: task.candidate_id, previousState: "VALIDATING_TAXONOMY",
      nextState: "ENRICHING_PRODUCT_FACTS", reasonCode: "OFFICIAL_OFFER_PACK_CONFIRMED",
      triggeredBy: "USER", checkpoint: { fieldRequired, factKey,
        confirmedPackCount, evidenceHash, evidenceMode, imageStored: false },
      candidatePatch: { state: "READY_FOR_CONTENT", blockers: [],
        evidenceSummary: { ...evidenceSummary, selectionIdentity,
          singleFactExceptionConfirmed: true,
          singleFactExceptionEvidenceHash: evidenceHash } },
      nextAutomaticAction: "Recalcular Product Facts con la presentación corregida.",
      nextHumanAction: "Ninguna.",
      job: { jobType: "ENRICH_PRODUCT_FACTS",
        idempotencyKey: `${state.run.id}:${candidate.id}:ENRICH_PRODUCT_FACTS:${evidenceHash}`,
        checkpoint: { queueItemId: candidate.queue_item_id,
          officialOfferPackEvidenceHash: evidenceHash }, maxAttempts: 10,
        apiFamily: "BROWSE", apiOperation: "EXACT_VERIFICATION",
        ownerLane: "P1_EXACT_VERIFICATION" } })
    await refreshRunProjection(input.supabase, state.run.id)
    return getSameDayPilot(input)
  }
  if (taxonomyException) {
    const categoryId = text(input.value, 20)
    if (input.visibleOfficialLabelConfirmed !== true || !/^\d{1,20}$/.test(categoryId) ||
      !text(candidate.queue_item_id)) {
      throw new Error("SAME_DAY_PILOT_FACT_EXCEPTION_EVIDENCE_REQUIRED")
    }
    const { data: queueItem, error: queueReadError } = await input.supabase
      .from("marketplace_listing_approval_queue_items")
      .select("id,evidence_snapshot")
      .eq("id", candidate.queue_item_id)
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", MARKETPLACE)
      .maybeSingle()
    if (queueReadError || !queueItem) {
      throw new Error("SAME_DAY_PILOT_CATEGORY_QUEUE_ITEM_READ_FAILED")
    }
    const snapshot = record(queueItem.evidence_snapshot)
    const identityEnrichment = record(snapshot.identityEnrichment)
    const identity = record(identityEnrichment.identity)
    const evidenceHash = versionedHash({ version: SINGLE_FACT_EXCEPTION_VERSION,
      taskId: task.id, candidateId: candidate.id, factKey, categoryId,
      evidenceMode: "OPERATOR_CONFIRMED_OFFICIAL_EBAY_CATEGORY" })
    const { error: queueUpdateError } = await input.supabase
      .from("marketplace_listing_approval_queue_items")
      .update({ evidence_snapshot: {
        ...snapshot,
        identityEnrichment: { ...identityEnrichment,
          identity: { ...identity, categoryId } },
        operatorCategoryConfirmation: {
          categoryId, evidenceHash, confirmedAt: now,
          source: "OPERATOR_VISIBLE_EBAY_OFFICIAL_CATEGORY_SELECTOR",
          actorRecorded: Boolean(input.actorId), urlStored: false,
        },
      }, updated_at: now })
      .eq("id", queueItem.id)
      .eq("marketplace_account_key", input.accountKey)
    if (queueUpdateError) throw new Error("SAME_DAY_PILOT_CATEGORY_QUEUE_ITEM_UPDATE_FAILED")
    await completeAndAdvanceHumanGate({ supabase: input.supabase, taskId: task.id,
      gateType: "CRITICAL_EXCEPTION_REQUIRED", runId: state.run.id,
      candidateId: task.candidate_id, previousState: candidate.machine_state,
      nextState: "ENRICHING_PRODUCT_FACTS", reasonCode: "OFFICIAL_EBAY_CATEGORY_CONFIRMED",
      triggeredBy: "USER", checkpoint: { fieldRequired, factKey, categoryId,
        evidenceHash, sourceUrlStored: false },
      candidatePatch: { state: "READY_FOR_CONTENT", blockers: [],
        evidenceSummary: { ...evidenceSummary,
          singleFactExceptionConfirmed: true,
          singleFactExceptionEvidenceHash: evidenceHash } },
      nextAutomaticAction: "Consultar Taxonomy oficial para la categoría confirmada.",
      nextHumanAction: "Ninguna.",
      job: { jobType: "ENRICH_PRODUCT_FACTS",
        idempotencyKey: `${state.run.id}:${candidate.id}:ENRICH_PRODUCT_FACTS:${evidenceHash}`,
        checkpoint: { queueItemId: candidate.queue_item_id,
          officialCategoryEvidenceHash: evidenceHash }, maxAttempts: 10,
        apiFamily: "TAXONOMY", apiOperation: "CATEGORY_ASPECTS",
        ownerLane: "P1_EXACT_VERIFICATION" } })
    await refreshRunProjection(input.supabase, state.run.id)
    return getSameDayPilot(input)
  }
  const brandAbsentConfirmed = factKey === "brand" && input.brandAbsentConfirmed === true
  const value = brandAbsentConfirmed ? "Unbranded" : officialLabelFactText(input.value)
  if (!value || (!brandAbsentConfirmed && input.visibleOfficialLabelConfirmed !== true)) {
    throw new Error("SAME_DAY_PILOT_FACT_EXCEPTION_EVIDENCE_REQUIRED")
  }
  const allowedValues = strings(schema.allowedValues).map((entry) => entry.normalize("NFKC"))
  if (schema.selectionOnly === true && schema.allowedValuesComplete === true &&
    allowedValues.length && !allowedValues.some((entry) =>
    entry.toLocaleLowerCase() === value.toLocaleLowerCase())) {
    throw new Error("SAME_DAY_PILOT_FACT_EXCEPTION_VALUE_NOT_ALLOWED")
  }
  const factRunId = text(record(candidate.product_facts_summary).factRunId, 40)
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(factRunId) || !text(candidate.queue_item_id)) {
    throw new Error("SAME_DAY_PILOT_FACT_EXCEPTION_RUN_BINDING_REQUIRED")
  }
  const sourceReference = `OFFICIAL_LABEL:sha256:${hash({ taskId: task.id, factKey }).slice(0, 24)}`
  const evidenceMode = brandAbsentConfirmed
    ? "OPERATOR_CONFIRMED_NO_BRAND_VISIBLE" : "OPERATOR_CONFIRMED_LABEL_VALUE_VISIBLE"
  const evidenceHash = versionedHash({ version: SINGLE_FACT_EXCEPTION_VERSION,
    taskId: task.id, candidateId: candidate.id, factKey, value, evidenceMode })
  const { error: observationError } = await input.supabase
    .from("marketplace_product_fact_observations")
    .upsert({
      fact_run_id: factRunId,
      queue_item_id: candidate.queue_item_id,
      luna_variant_id: candidate.supplier_variant_id,
      marketplace_account_key: input.accountKey,
      marketplace: MARKETPLACE,
      fact_scope: "PRODUCT_UNIT",
      fact_key: factKey,
      raw_value: value,
      normalized_value: value,
      normalized_unit: null,
      source_type: "OFFICIAL_LABEL",
      source_reference: sourceReference,
      source_authority: "MANUFACTURER_OR_LABEL",
      source_observed_at: now,
      fetched_at: now,
      expires_at: null,
      confidence: 1,
      verification_status: "VERIFIED",
      evidence_hash: evidenceHash,
      adapter_version: SINGLE_FACT_EXCEPTION_VERSION,
      derivation: null,
    }, { onConflict: "queue_item_id,evidence_hash", ignoreDuplicates: true })
  if (observationError) throw new Error("SAME_DAY_PILOT_FACT_EXCEPTION_PERSIST_FAILED")
  await completeAndAdvanceHumanGate({ supabase: input.supabase, taskId: task.id,
    gateType: "CRITICAL_EXCEPTION_REQUIRED", runId: state.run.id,
    candidateId: task.candidate_id, previousState: candidate.machine_state,
    nextState: "ENRICHING_PRODUCT_FACTS", reasonCode: "OFFICIAL_LABEL_FACT_CONFIRMED",
    triggeredBy: "USER", checkpoint: { fieldRequired, factKey, evidenceHash,
      evidenceMode, rawLabelStored: false, imageStored: false },
    candidatePatch: { state: "READY_FOR_CONTENT", blockers: [],
      evidenceSummary: { ...evidenceSummary, singleFactExceptionConfirmed: true,
        singleFactExceptionEvidenceHash: evidenceHash } },
    nextAutomaticAction: "Recalcular Product Facts y Taxonomy para este candidato.",
    nextHumanAction: "Ninguna.",
    job: { jobType: "ENRICH_PRODUCT_FACTS",
      idempotencyKey: `${state.run.id}:${candidate.id}:ENRICH_PRODUCT_FACTS:${evidenceHash}`,
      checkpoint: { queueItemId: candidate.queue_item_id,
        officialLabelEvidenceHash: evidenceHash }, maxAttempts: 10,
      apiFamily: "BROWSE", apiOperation: "EXACT_VERIFICATION",
      ownerLane: "P1_EXACT_VERIFICATION" } })
  await refreshRunProjection(input.supabase, state.run.id)
  return getSameDayPilot(input)
}

export async function authorizeSameDayControlledRiskOverride(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  candidateId: string
  salePrice: number
  fulfillmentBasis: EbayCompliantFulfillmentBasis
  imageRightsConfirmed: boolean
  openAiImageSpendApproved: boolean
  commercialRiskAccepted: boolean
  noPromotionConfirmed: boolean
  voluntaryReturnsPolicyAcknowledged: boolean
  ebayMoneyBackGuaranteeAcknowledged: boolean
}) {
  if (input.commercialRiskAccepted !== true || input.noPromotionConfirmed !== true ||
    input.voluntaryReturnsPolicyAcknowledged !== true ||
    input.ebayMoneyBackGuaranteeAcknowledged !== true) {
    throw new Error("SAME_DAY_PILOT_CONTROLLED_RISK_ACKNOWLEDGEMENTS_REQUIRED")
  }
  const fulfillmentBasis = normalizeEbayCompliantFulfillmentBasis(input.fulfillmentBasis)
  if (!fulfillmentBasis) {
    throw new Error("SAME_DAY_PILOT_COMPLIANT_FULFILLMENT_BASIS_REQUIRED")
  }
  if (input.imageRightsConfirmed !== true) {
    throw new Error("SAME_DAY_PILOT_IMAGE_RIGHTS_CONFIRMATION_REQUIRED")
  }
  if (input.openAiImageSpendApproved !== true) {
    throw new Error("SAME_DAY_PILOT_OPENAI_IMAGE_SPEND_APPROVAL_REQUIRED")
  }
  const state = await getSameDayPilot(input)
  if (!state) throw new Error("SAME_DAY_PILOT_RUN_MISSING")
  const candidate = state.candidates.find((entry) => entry.id === input.candidateId)
  if (!candidate || candidate.machine_state !== "REJECTED" ||
    candidate.state !== "REJECTED_TODAY") {
    throw new Error("SAME_DAY_PILOT_CONTROLLED_RISK_CANDIDATE_INVALID")
  }
  const controlledRisk = controlledRiskEvaluationForCandidate(
    record(candidate),
    input.salePrice,
  )
  if (!controlledRisk.evaluation.available || !controlledRisk.evaluation.economics?.ready ||
    !controlledRisk.evaluation.economics.passesProfitGate) {
    throw new Error("SAME_DAY_PILOT_CONTROLLED_RISK_NOT_ELIGIBLE")
  }
  const factsSummary = record(candidate.product_facts_summary)
  if (factsSummary.currentRunBound !== true ||
    record(factsSummary.gates).OPENAI_INPUT_READY !== true) {
    throw new Error("SAME_DAY_PILOT_PRODUCT_FACTS_APPROVAL_BLOCKED")
  }
  const approvedAt = new Date().toISOString()
  const existingEconomics = record(candidate.economics_summary)
  const standardMinimumOperatorPrice = number(existingEconomics.minimumOperatorPrice)
  const economicsSummary = {
    ...existingEconomics,
    ...controlledRisk.evaluation.economics,
    standardMinimumOperatorPrice,
    minimumOperatorPrice: controlledRisk.evaluation.minimumRiskPrice,
    operatorApprovedSalePrice: controlledRisk.evaluation.operatorSalePrice,
    operatorPriceApproved: true,
    operatorApprovedAt: approvedAt,
    operatorActorRecorded: Boolean(input.actorId),
    automaticPricingUsed: false,
    fulfillmentBasis,
    fulfillmentBasisConfirmedAt: approvedAt,
    fulfillmentBasisActorRecorded: Boolean(input.actorId),
    fulfillmentBasisAttestationVersion: "EBAY_FULFILLMENT_BASIS_V1_2026_07_18",
    imageRightsConfirmed: true,
    imageRightsConfirmedAt: approvedAt,
    imageRightsActorRecorded: Boolean(input.actorId),
    imageRightsAttestationVersion: "LUNA_AUTHORIZED_IMAGE_OPERATOR_ATTESTATION_V1_2026_07_18",
    openAiImageSpendApproved: true,
    openAiImageSpendApprovedAt: approvedAt,
    openAiImageSpendActorRecorded: Boolean(input.actorId),
    openAiImageMaximumCallsApproved: 1,
    openAiImageQualityApproved: "low",
    controlledRiskOverride: {
      authorized: true,
      version: EBAY_CONTROLLED_RISK_OVERRIDE_VERSION,
      authorizedAt: approvedAt,
      minimumNetMarginPercent: 10,
      minimumRiskPrice: controlledRisk.evaluation.minimumRiskPrice,
      maximumCompetitivePrice: controlledRisk.evaluation.maximumCompetitivePrice,
      confirmedSoldExactQuantity: controlledRisk.evaluation.confirmedSoldExactQuantity,
      exactSoldReference: controlledRisk.exactSoldReference,
      promotionAllowed: false,
      promotedListingsReserveRate: 0,
      voluntaryReturns: "NOT_ACCEPTED_WHERE_EBAY_ALLOWS",
      ebayMoneyBackGuaranteeStillApplies: true,
      commercialRiskAccepted: true,
      automaticPricingUsed: false,
      manualPublicationOnly: false,
      finalHumanAuthorizationRequired: true,
      sellerOsPublicationAfterAuthorization: true,
      unattendedPublicationAllowed: false,
      ebayWrites: 0,
    },
    fulfillmentDocumentsStored: false,
    fulfillmentPiiStored: false,
  }
  const { data: updatedCandidate, error: candidateError } = await input.supabase
    .from("ebay_same_day_pilot_candidates")
    .update({
      economics_summary: economicsSummary,
      state: "READY_FOR_CONTENT",
      blockers: [],
      next_automated_action: "Construir el paquete manual sin promoción.",
      next_human_action: "Revisar las imágenes antes de autorizar la publicación desde Seller OS.",
      updated_at: approvedAt,
    })
    .eq("id", candidate.id)
    .eq("run_id", state.run.id)
    .eq("machine_state", "REJECTED")
    .select("id")
    .maybeSingle()
  if (candidateError || !updatedCandidate) {
    throw new Error("SAME_DAY_PILOT_CONTROLLED_RISK_UPDATE_FAILED")
  }
  await transition({
    supabase: input.supabase,
    runId: state.run.id,
    candidateId: candidate.id,
    previousState: "REJECTED",
    nextState: "GENERATING_LISTING_CONTENT",
    reasonCode: "CONTROLLED_RISK_OVERRIDE_AUTHORIZED",
    triggeredBy: "USER",
    checkpoint: {
      version: EBAY_CONTROLLED_RISK_OVERRIDE_VERSION,
      operatorPriceApproved: true,
      minimumNetMarginPercent: 10,
      promotionAllowed: false,
      voluntaryReturnsPolicyAcknowledged: true,
      ebayMoneyBackGuaranteeAcknowledged: true,
      confirmedSoldExactQuantity: controlledRisk.evaluation.confirmedSoldExactQuantity,
      manualPublicationOnly: false,
      finalHumanAuthorizationRequired: true,
      sellerOsPublicationAfterAuthorization: true,
      unattendedPublicationAllowed: false,
      openAiCalls: 0,
      ebayWrites: 0,
    },
    nextAutomaticAction: "Construir un paquete original desde facts verificados.",
    nextHumanAction: "Ninguna hasta revisar las imágenes.",
    job: {
      jobType: "BUILD_MANUAL_SELLER_HUB_HANDOFF",
      idempotencyKey: `${state.run.id}:${candidate.id}:CONTROLLED_RISK_BUILD_MANUAL_HANDOFF`,
      checkpoint: {
        factRunId: factsSummary.factRunId,
        controlledRiskOverrideVersion: EBAY_CONTROLLED_RISK_OVERRIDE_VERSION,
        openAiCalls: 0,
        ebayWrites: 0,
      },
    },
  })
  const { error: eventError } = await input.supabase
    .from("ebay_same_day_pilot_events")
    .upsert({
      run_id: state.run.id,
      event_type: "CONTROLLED_RISK_OVERRIDE_AUTHORIZED",
      event_payload: {
        candidateId: candidate.id,
        version: EBAY_CONTROLLED_RISK_OVERRIDE_VERSION,
        minimumNetMarginPercent: 10,
        promotionAllowed: false,
        voluntaryReturns: "NOT_ACCEPTED_WHERE_EBAY_ALLOWS",
        ebayMoneyBackGuaranteeStillApplies: true,
        manualPublicationOnly: false,
        finalHumanAuthorizationRequired: true,
        sellerOsPublicationAfterAuthorization: true,
        unattendedPublicationAllowed: false,
        operatorActorRecorded: Boolean(input.actorId),
      },
      idempotency_key: `${state.run.id}:${candidate.id}:CONTROLLED_RISK_OVERRIDE_AUTHORIZED`,
      ebay_read_calls: 0,
      openai_calls: 0,
      ebay_writes: 0,
      production_changed: false,
    }, { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (eventError) throw new Error("SAME_DAY_PILOT_CONTROLLED_RISK_EVENT_FAILED")
  await refreshRunProjection(input.supabase, state.run.id)
  return getSameDayPilot(input)
}

export async function decideSameDayProduct(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  taskId: string
  decision: "APPROVE" | "REJECT"
  salePrice?: number | null
  fulfillmentBasis?: EbayCompliantFulfillmentBasis | null
  imageRightsConfirmed?: boolean
  openAiImageSpendApproved?: boolean
  noPromotionConfirmed?: boolean
}) {
  const state = await getSameDayPilot(input)
  if (!state) throw new Error("SAME_DAY_PILOT_RUN_MISSING")
  const task = state.tasks.find((entry) => entry.id === input.taskId && entry.status === "OPEN")
  if (!task || task.gate_type !== "PRODUCT_APPROVAL_REQUIRED") throw new Error("SAME_DAY_PILOT_PRODUCT_TASK_INVALID")
  const candidate = state.candidates.find((entry) => entry.id === task.candidate_id)
  if (!candidate || candidate.machine_state !== "WAITING_PRODUCT_APPROVAL") throw new Error("SAME_DAY_PILOT_PRODUCT_CANDIDATE_INVALID")
  if (input.decision === "REJECT") {
    await completeAndAdvanceHumanGate({ supabase: input.supabase, taskId: task.id,
      gateType: "PRODUCT_APPROVAL_REQUIRED", runId: state.run.id, candidateId: candidate.id,
      previousState: "WAITING_PRODUCT_APPROVAL", nextState: "REJECTED",
      reasonCode: "PRODUCT_REJECTED_BY_OPERATOR", triggeredBy: "USER",
      checkpoint: { rejectedByOperator: true },
      candidatePatch: { state: "REJECTED_TODAY", blockers: ["PRODUCT_REJECTED_BY_OPERATOR"] },
      nextAutomaticAction: "Promover el siguiente candidato.", nextHumanAction: "Ninguna." })
    await promoteNextCandidate(input.supabase, state.run.id, Number(candidate.ordinal))
    await refreshRunProjection(input.supabase, state.run.id)
    return getSameDayPilot(input)
  }
  const salePrice = number(input.salePrice)
  const pricingRecommendation = record(record(candidate.economics_summary).pricingRecommendation)
  const evidence = record(candidate.evidence_summary)
  const controlledExploratoryTest = text(evidence.commercialEvidenceMode) ===
    "CONTROLLED_EXPLORATORY_TEST"
  const controlledTestPlan = record(evidence.controlledTestPlan)
  const controlledTestPriceReady = controlledExploratoryTest &&
    pricingRecommendation.controlledExploratoryFloorUsed === true &&
    controlledTestPlan.listingQuantity === 1 &&
    controlledTestPlan.commercialMonitorRequired === true &&
    Number(candidate.listing_quantity) === 1
  const controlledRiskActiveMarketReady =
    pricingRecommendation.controlledRiskActiveMarketFallbackUsed === true &&
    pricingRecommendation.marketReferenceUsed === true &&
    pricingRecommendation.promotionAllowed === false &&
    number(pricingRecommendation.minimumNetMarginPercent) === 10 &&
    Number(candidate.listing_quantity) === 1
  const nonCompetitiveControlledRiskReady =
    pricingRecommendation.nonCompetitiveControlledRiskOverrideAvailable === true &&
    pricingRecommendation.status === "OWN_COST_FLOOR_ABOVE_MARKET" &&
    pricingRecommendation.marketReferenceUsed === true &&
    pricingRecommendation.promotionAllowed === false &&
    number(pricingRecommendation.minimumNetMarginPercent) === 10 &&
    Number(candidate.listing_quantity) === 1
  const controlledRiskOperatorOverrideReady = controlledRiskActiveMarketReady ||
    nonCompetitiveControlledRiskReady
  if (controlledRiskOperatorOverrideReady && input.noPromotionConfirmed !== true) {
    throw new Error("SAME_DAY_PILOT_CONTROLLED_RISK_NO_PROMOTION_CONFIRMATION_REQUIRED")
  }
  if (!(number(pricingRecommendation.recommendedSalePrice) ?? 0) ||
    (pricingRecommendation.marketReferenceUsed !== true && !controlledTestPriceReady)) {
    throw new Error("SAME_DAY_PILOT_MARKET_PRICE_REFERENCE_REQUIRED")
  }
  const fulfillmentBasis = normalizeEbayCompliantFulfillmentBasis(
    input.fulfillmentBasis,
  )
  const supplierCost = number(record(candidate.economics_summary).confirmedLunaPrice)
  if (!(salePrice && salePrice > 0) || supplierCost === null) throw new Error("SAME_DAY_PILOT_OPERATOR_PRICE_REQUIRED")
  if (!fulfillmentBasis) throw new Error("SAME_DAY_PILOT_COMPLIANT_FULFILLMENT_BASIS_REQUIRED")
  if (input.imageRightsConfirmed !== true) {
    throw new Error("SAME_DAY_PILOT_IMAGE_RIGHTS_CONFIRMATION_REQUIRED")
  }
  if (input.openAiImageSpendApproved !== true) {
    throw new Error("SAME_DAY_PILOT_OPENAI_IMAGE_SPEND_APPROVAL_REQUIRED")
  }
  const factsSummary = record(candidate.product_facts_summary)
  if (factsSummary.currentRunBound !== true || record(factsSummary.gates).OPENAI_INPUT_READY !== true) {
    throw new Error("SAME_DAY_PILOT_PRODUCT_FACTS_APPROVAL_BLOCKED")
  }
  const economicsConfig = controlledRiskOperatorOverrideReady
    ? controlledRiskEconomicsConfig(ebayDraftOnlyEconomicsConfig())
    : ebayDraftOnlyEconomicsConfig()
  const economics = calculateEbayUnitEconomics({ salePrice, supplierCost }, economicsConfig)
  if (!economics.ready || !economics.passesProfitGate) throw new Error("SAME_DAY_PILOT_OPERATOR_PRICE_ECONOMICS_BLOCKED")
  const operatorApprovedAt = new Date().toISOString()
  const economicsSummary = { ...record(candidate.economics_summary), ...economics,
    operatorApprovedSalePrice: salePrice, operatorPriceApproved: true, operatorApprovedAt,
    operatorActorRecorded: Boolean(input.actorId), automaticPricingUsed: false,
    fulfillmentBasis, fulfillmentBasisConfirmedAt: operatorApprovedAt,
    fulfillmentBasisActorRecorded: Boolean(input.actorId),
    fulfillmentBasisAttestationVersion: "EBAY_FULFILLMENT_BASIS_V1_2026_07_18",
    imageRightsConfirmed: true,
    imageRightsConfirmedAt: operatorApprovedAt,
    imageRightsActorRecorded: Boolean(input.actorId),
    imageRightsAttestationVersion: "LUNA_AUTHORIZED_IMAGE_OPERATOR_ATTESTATION_V1_2026_07_18",
    openAiImageSpendApproved: true,
    openAiImageSpendApprovedAt: operatorApprovedAt,
    openAiImageSpendActorRecorded: Boolean(input.actorId),
    openAiImageMaximumCallsApproved: 1,
    openAiImageQualityApproved: "low",
    controlledExploratoryTestApproved: controlledTestPriceReady,
    commercialMonitorRequired: controlledTestPriceReady || controlledRiskOperatorOverrideReady,
    controlledRiskOverride: controlledRiskOperatorOverrideReady ? {
      authorized: true,
      version: EBAY_CONTROLLED_RISK_OVERRIDE_VERSION,
      authorizedAt: operatorApprovedAt,
      evidenceBasis: nonCompetitiveControlledRiskReady
        ? "NON_COMPETITIVE_EQUIVALENT_PACK_ACTIVE_MULTI_SELLER_MARKET_OPERATOR_EXCEPTION"
        : "FRESH_EQUIVALENT_PACK_ACTIVE_MULTI_SELLER_MARKET",
      minimumNetMarginPercent: 10,
      minimumRiskPrice: pricingRecommendation.controlledRiskMinimumPrice,
      maximumCompetitivePrice: record(pricingRecommendation.marketReference).maximumPrice,
      confirmedSoldExactQuantity: 0,
      promotionAllowed: false,
      promotedListingsReserveRate: 0,
      voluntaryReturns: "NOT_ACCEPTED_WHERE_EBAY_ALLOWS",
      ebayMoneyBackGuaranteeStillApplies: true,
      commercialRiskAccepted: true,
      automaticPricingUsed: false,
      finalHumanAuthorizationRequired: true,
      sellerOsPublicationAfterAuthorization: true,
      unattendedPublicationAllowed: false,
      commerciallyRecommended: !nonCompetitiveControlledRiskReady,
      ebayWrites: 0,
    } : null,
    fulfillmentDocumentsStored: false, fulfillmentPiiStored: false }
  await completeAndAdvanceHumanGate({ supabase: input.supabase, taskId: task.id,
    gateType: "PRODUCT_APPROVAL_REQUIRED", runId: state.run.id, candidateId: candidate.id,
    previousState: "WAITING_PRODUCT_APPROVAL", nextState: "GENERATING_LISTING_CONTENT",
    reasonCode: "OPENAI_SKIPPED_MANUAL_FACTS_ONLY", triggeredBy: "USER",
    checkpoint: { operatorPriceApproved: true, automaticPricingUsed: false, fulfillmentBasis,
      imageRightsConfirmed: true, openAiImageSpendApproved: true,
      noPromotionConfirmed: controlledRiskOperatorOverrideReady,
      nonCompetitiveOperatorException: nonCompetitiveControlledRiskReady,
      openAiImageMaximumCallsApproved: 1 },
    candidatePatch: { economicsSummary },
    nextAutomaticAction: "Construir un paquete original desde facts verificados.", nextHumanAction: "Ninguna.",
    job: { jobType: "BUILD_MANUAL_SELLER_HUB_HANDOFF",
      idempotencyKey: `${state.run.id}:${candidate.id}:BUILD_MANUAL_SELLER_HUB_HANDOFF:${factsSummary.factRunId}`,
      checkpoint: { factRunId: factsSummary.factRunId, openAiCalls: 0, ebayWrites: 0 } } })
  await refreshRunProjection(input.supabase, state.run.id)
  return getSameDayPilot(input)
}

export async function resumeSameDayPilotAfterAccountPolicyProfile(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  candidateId: string
}) {
  const { data, error } = await input.supabase.rpc(
    "resume_same_day_pilot_candidate_after_account_policy_profile_v1",
    {
      p_account_key: input.accountKey,
      p_actor: input.actorId,
      p_candidate_id: input.candidateId,
      p_now: new Date().toISOString(),
    },
  )
  if (error) {
    const message = text(record(error).message, 1_000)
    const code = message.match(/SAME_DAY_PILOT_[A-Z0-9_]+/)?.[0]
      ?? "SAME_DAY_PILOT_POLICY_RECOVERY_FAILED"
    throw new Error(code)
  }
  return record(data)
}

export async function decideSameDayImages(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  taskId: string
  decision: "APPROVE" | "REJECT"
}) {
  const state = await getSameDayPilot(input)
  if (!state) throw new Error("SAME_DAY_PILOT_RUN_MISSING")
  const task = state.tasks.find((entry) => entry.id === input.taskId && entry.status === "OPEN")
  if (!task || task.gate_type !== "IMAGE_APPROVAL_REQUIRED") throw new Error("SAME_DAY_PILOT_IMAGE_TASK_INVALID")
  const candidate = state.candidates.find((entry) => entry.id === task.candidate_id)
  if (!candidate || candidate.machine_state !== "WAITING_IMAGE_APPROVAL") throw new Error("SAME_DAY_PILOT_IMAGE_CANDIDATE_INVALID")
  if (input.decision === "REJECT") {
    await reviewSameDayImagePackage({
      supabase: input.supabase,
      accountKey: input.accountKey,
      actorId: input.actorId,
      candidate: record(candidate),
      decision: "REJECT",
    })
    await completeAndAdvanceHumanGate({ supabase: input.supabase, taskId: task.id,
      gateType: "IMAGE_APPROVAL_REQUIRED", runId: state.run.id, candidateId: candidate.id,
      previousState: "WAITING_IMAGE_APPROVAL", nextState: "REJECTED",
      reasonCode: "IMAGES_REJECTED_BY_OPERATOR", triggeredBy: "USER",
      checkpoint: { rejectedByOperator: true },
      candidatePatch: { state: "REJECTED_TODAY", blockers: ["IMAGES_REJECTED_BY_OPERATOR"] },
      nextAutomaticAction: "Promover el siguiente candidato.", nextHumanAction: "Ninguna." })
    await promoteNextCandidate(input.supabase, state.run.id, Number(candidate.ordinal))
  } else {
    await completeAndAdvanceHumanGate({ supabase: input.supabase, taskId: task.id,
      gateType: "IMAGE_APPROVAL_REQUIRED", runId: state.run.id, candidateId: candidate.id,
      previousState: "WAITING_IMAGE_APPROVAL", nextState: "BUILDING_SELLER_HUB_HANDOFF",
      reasonCode: "SIX_IMAGE_SET_APPROVAL_CONFIRMED", triggeredBy: "USER",
      checkpoint: { imageApproval: true, actorRecorded: Boolean(input.actorId),
        controlId: record(candidate.image_package_summary).controlId,
        openAiCalls: record(candidate.image_package_summary).openAiCalls ?? 0 },
      nextAutomaticAction: "Publicar internamente el set aprobado y preparar la autorización final en Seller OS.", nextHumanAction: "Ninguna.",
      job: { jobType: "APPROVE_SIX_IMAGE_SET",
        idempotencyKey: `${state.run.id}:${candidate.id}:APPROVE_SIX_IMAGE_SET`,
        checkpoint: { controlId: record(candidate.image_package_summary).controlId,
          openAiCalls: record(candidate.image_package_summary).openAiCalls ?? 0,
          ebayWrites: 0 }, maxAttempts: 4 } })
  }
  await refreshRunProjection(input.supabase, state.run.id)
  return getSameDayPilot(input)
}

export async function resumeSameDayPilotAfterProductResearchCapture(input: { supabase: SupabaseClient; accountKey: string; searchQuery: string; batchId: string; capturedAt?: string | null; exactLunaMatches?: number }) {
  const state = await getSameDayPilot(input)
  if (!state) return { resumed: 0, familyEnriched: 0 }
  const [{ count: captureObservationCount, error: captureObservationError },
    { data: captureBatch, error: captureBatchError }] = await Promise.all([
    input.supabase
      .from("marketplace_product_research_capture_observations")
      .select("id", { count: "exact", head: true })
      .eq("capture_batch_id", input.batchId)
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", MARKETPLACE)
      .eq("evidence_reviewed", true)
      .eq("quality_status", "VALID"),
    input.supabase
      .from("marketplace_product_research_capture_batches")
      .select("id,source_row_count,valid_count,imported_count,duplicate_count,rejected_count,error_counts")
      .eq("id", input.batchId)
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", MARKETPLACE)
      .maybeSingle(),
  ])
  if (captureObservationError || captureBatchError || !captureBatch) {
    throw new Error("SAME_DAY_PILOT_CAPTURE_MATCH_READ_FAILED")
  }
  const authorizedObservationCount = Number(captureObservationCount ?? 0)
  const capturedQueryHash = productResearchPlannedQueryHash(input.searchQuery)
  const familyCandidates = state.candidates.filter((candidate) =>
    !["REJECTED", "BLOCKED", "VERIFIED_ACTIVE", "COMPLETED"].includes(text(candidate.machine_state)) &&
    (productResearchPlannedQueryHash(record(candidate.product_research_query_plan).query) ===
      capturedQueryHash || productResearchQueriesMatch(
        record(candidate.product_research_query_plan).query,
        input.searchQuery,
      )))
  let resumed = 0
  let familyEnriched = 0
  for (const candidate of familyCandidates) {
    if (authorizedObservationCount > 0 && candidate.machine_state !== "WAITING_PRODUCT_RESEARCH_CAPTURE") {
      const { error: familyLinkError } = await input.supabase.from("ebay_same_day_pilot_candidates").update({
        product_research_capture_batch_id: input.batchId,
        evidence_summary: { ...record(candidate.evidence_summary),
          captureCandidateReferencesPendingReconciliation: authorizedObservationCount,
          groupedCaptureObservedAt: input.capturedAt ?? new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }).eq("id", candidate.id).eq("run_id", state.run.id)
      if (familyLinkError) throw new Error("SAME_DAY_PILOT_FAMILY_CAPTURE_LINK_FAILED")
      familyEnriched += 1
    }
    if (candidate.machine_state !== "WAITING_PRODUCT_RESEARCH_CAPTURE") continue
    const task = state.tasks.find((entry) => entry.candidate_id === candidate.id && entry.gate_type === "PRODUCT_RESEARCH_CAPTURE_REQUIRED" && entry.status === "OPEN")
    if (!task) throw new Error("SAME_DAY_PILOT_CAPTURE_GATE_TASK_MISSING")
    resumed += 1
    const captureResolvedBlockers = strings(candidate.blockers).filter((blocker) =>
      blocker !== "VISUAL_MARKET_EVIDENCE_REQUIRED")
    const evidenceSummary = { ...record(candidate.evidence_summary),
      captureCandidateReferencesPendingReconciliation: authorizedObservationCount,
      groupedCaptureObservedAt: input.capturedAt ?? new Date().toISOString() }
    if (authorizedObservationCount <= 0) {
      const now = new Date()
      const selectionIdentity = record(record(candidate.evidence_summary).selectionIdentity)
      const economicsSummary = record(candidate.economics_summary)
      const lunaConfirmation = record(economicsSummary.lunaConfirmation)
      const lunaAlreadyConfirmed = text(lunaConfirmation.status).startsWith("AVAILABLE_") &&
        Number(economicsSummary.confirmedLunaPrice) > 0
      const officialNoSoldResults = Number(captureBatch.valid_count) === 0 &&
        Number(captureBatch.source_row_count) === 0 &&
        Number(record(captureBatch.error_counts).OFFICIAL_NO_SOLD_RESULTS) === 1
      const zeroValidSoldRows = Number(captureBatch.valid_count) === 0 && (
        officialNoSoldResults ||
        Number(captureBatch.source_row_count) > 0 &&
          Number(captureBatch.rejected_count) === Number(captureBatch.source_row_count)
      )
      const commercialEvidenceHash = versionedHash({
        batchId: input.batchId,
        supplierVariantId: candidate.supplier_variant_id,
        capturedQueryHash,
        validSoldRows: Number(captureBatch.valid_count),
        importedSoldRows: Number(captureBatch.imported_count),
        rejectedRows: Number(captureBatch.rejected_count),
        mode: "CONTROLLED_EXPLORATORY_TEST",
        version: "SAME_DAY_ZERO_VALID_SOLD_EVIDENCE_V1",
      })
      const controlledEvidenceSummary = { ...evidenceSummary,
        evidenceTiers: {
          exactIdentityMatches: 0,
          confirmedSoldExact: 0,
          confirmedSoldRelatedPack: 0,
          confirmedSoldRelatedSize: 0,
          broadSearchOnlyPromoted: false,
        },
        historicalMarketCheckStatus: "COMPLETED_NO_EXACT_SOLD",
        historicalMarketCheckedAt: now.toISOString(),
        commercialEvidenceMode: "CONTROLLED_EXPLORATORY_TEST",
        commercialEvidenceVersion: "SAME_DAY_COMMERCIAL_EVIDENCE_V1",
        commercialEvidenceHash,
        controlledIdentityEvidenceHash: text(selectionIdentity.evidenceHash) || null,
        commercialEvidenceBlockers: [],
        controlledTestPlan: {
          listingQuantity: 1,
          commercialMonitorRequired: true,
          activeMarketVerificationRequired: true,
          oneVariableAtATime: true,
          automaticPricingAllowed: false,
          manualPublicationRequired: true,
        },
        productResearchCaptureQuality: {
          status: officialNoSoldResults
            ? "COMPLETED_OFFICIAL_NO_SOLD_RESULTS"
            : zeroValidSoldRows
            ? "COMPLETED_ZERO_VALID_SOLD_ROWS"
            : "COMPLETED_NO_BATCH_SCOPED_VALID_ROWS",
          sourceRowCount: Number(captureBatch.source_row_count),
          validSoldRowCount: Number(captureBatch.valid_count),
          rejectedRowCount: Number(captureBatch.rejected_count),
          errorCounts: record(captureBatch.error_counts),
          rejectedRowsUsedForCommercialDecisions: false,
        },
        reconciliationCoverage: {
          reviewedObservations: 0,
          eventsProcessed: 0,
          decisionReferences: 0,
          targetSupplierVariantScoped: true,
          version: PRODUCT_RESEARCH_IDENTITY_RECONCILIATION_VERSION,
        },
      }
      const remainingBlockers = strings(candidate.blockers).filter((blocker) => ![
        "AUTHORIZED_CAPTURE_OBSERVATIONS_MISSING",
        "PRODUCT_RESEARCH_EVIDENCE_QUARANTINED",
        "LAST_SOLD_DATE_OUTSIDE_CAPTURE_WINDOW",
        "VISUAL_MARKET_EVIDENCE_REQUIRED",
      ].includes(blocker))
      await completeAndAdvanceHumanGate({ supabase: input.supabase, taskId: task.id,
        gateType: "PRODUCT_RESEARCH_CAPTURE_REQUIRED", runId: state.run.id, candidateId: candidate.id,
        previousState: "WAITING_PRODUCT_RESEARCH_CAPTURE",
        nextState: lunaAlreadyConfirmed ? "CALCULATING_ECONOMICS" : "RECONCILING_IDENTITY",
        reasonCode: officialNoSoldResults
          ? "PRODUCT_RESEARCH_COMPLETED_NO_SOLD_RESULTS_AUTO_RESUME"
          : zeroValidSoldRows
          ? "PRODUCT_RESEARCH_COMPLETED_ZERO_VALID_SOLD_AUTO_RESUME"
          : "PRODUCT_RESEARCH_COMPLETED_NO_BATCH_SCOPED_VALID_ROWS_AUTO_RESUME",
        triggeredBy: "SYSTEM",
        checkpoint: { captureBatchId: input.batchId, authorizedObservationCount: 0,
          sourceRowCount: Number(captureBatch.source_row_count),
          validSoldRowCount: Number(captureBatch.valid_count),
          rejectedRowCount: Number(captureBatch.rejected_count),
          soldEvidenceImported: true,
          rejectedRowsUsedForCommercialDecisions: false },
        candidatePatch: { productResearchCaptureBatchId: input.batchId,
          evidenceSummary: controlledEvidenceSummary, blockers: remainingBlockers },
        nextAutomaticAction: lunaAlreadyConfirmed
          ? "Calcular economía y verificar el mercado activo."
          : "Solicitar la confirmación Luna y después verificar el mercado activo.",
        nextHumanAction: lunaAlreadyConfirmed
          ? "Ninguna."
          : "Confirmar precio, disponibilidad e identidad visibles en Luna.",
        job: lunaAlreadyConfirmed ? { jobType: "CALCULATE_ECONOMICS",
          idempotencyKey: `${state.run.id}:${candidate.id}:CALCULATE_ECONOMICS:${input.batchId}:ZERO_VALID_SOLD`,
          checkpoint: {
            confirmedLunaPrice: economicsSummary.confirmedLunaPrice,
            quantityKnown: economicsSummary.quantityUnknown !== true,
            activeMarketVerificationRequired: true,
          } } : undefined })
      if (!lunaAlreadyConfirmed) {
        await createLunaGate(input.supabase, state.run.id, record(candidate),
          "RECONCILING_IDENTITY")
      }
    } else {
      familyEnriched += 1
      const queryFamilyVisualBriefReused =
        text(record(candidate.evidence_summary)
          .visualMarketRecaptureRecoveryVersion) ===
          VISUAL_MARKET_RECAPTURE_RECOVERY_VERSION &&
        text(record(candidate.evidence_summary)
          .supersededVisualCaptureBatchId) === input.batchId
      const reconciliationJobIdempotencyKey = [
        state.run.id,
        candidate.id,
        "RECONCILE_PRODUCT_RESEARCH_CAPTURE",
        input.batchId,
        ...(queryFamilyVisualBriefReused
          ? [QUERY_FAMILY_VISUAL_BRIEF_RECOVERY_VERSION]
          : []),
      ].join(":")
      await completeAndAdvanceHumanGate({ supabase: input.supabase, taskId: task.id,
        gateType: "PRODUCT_RESEARCH_CAPTURE_REQUIRED", runId: state.run.id, candidateId: candidate.id,
        previousState: "WAITING_PRODUCT_RESEARCH_CAPTURE", nextState: "RECONCILING_IDENTITY",
        reasonCode: "AUTHORIZED_SOLD_EVIDENCE_IMPORTED_AUTO_RESUME", triggeredBy: "SYSTEM",
        checkpoint: { captureBatchId: input.batchId, authorizedObservationCount,
          provisionalExactLunaMatches: Number(input.exactLunaMatches ?? 0),
          soldEvidenceImported: true },
        candidatePatch: { productResearchCaptureBatchId: input.batchId,
          evidenceSummary, blockers: captureResolvedBlockers },
        nextAutomaticAction: "Reconciliar sólo las referencias de este candidato.", nextHumanAction: "Ninguna.",
        job: { jobType: "RECONCILE_PRODUCT_RESEARCH_CAPTURE",
          idempotencyKey: reconciliationJobIdempotencyKey,
          checkpoint: { captureBatchId: input.batchId, supplierVariantId: candidate.supplier_variant_id,
            capturedAt: input.capturedAt ?? new Date().toISOString(),
            queryFamilyVisualBriefReused }, maxAttempts: 10,
          apiFamily: "BROWSE", apiOperation: "EXACT_VERIFICATION", ownerLane: "P1_EXACT_VERIFICATION" } })
    }
  }
  await refreshRunProjection(input.supabase, state.run.id)
  return { resumed, familyEnriched }
}

function retryable(code: string) {
  return /(?:429|NETWORK|TIMEOUT|(?:^|_)5\d\d(?:$|_)|HTTP_?5\d\d|TEMPORARY|DEPENDENCY|LEASE)/.test(code)
}

const SAME_DAY_MACHINE_ORDER = [
  "RUN_CREATED", "LOCAL_FILTERING", "CANDIDATE_SELECTION", "PRODUCT_RESEARCH_PLAN_READY",
  "WAITING_PRODUCT_RESEARCH_CAPTURE", "IMPORTING_SOLD_EVIDENCE", "RECONCILING_IDENTITY",
  "MATCHING_LUNA", "RUNNING_LOOP_1", "CALCULATING_ECONOMICS", "WAITING_LUNA_CONFIRMATION",
  "ENRICHING_PRODUCT_FACTS", "VALIDATING_TAXONOMY", "VALIDATING_REGULATION", "BUILDING_OPENAI_INPUT",
  "WAITING_PRODUCT_APPROVAL", "GENERATING_LISTING_CONTENT", "VALIDATING_LISTING_CONTENT",
  "PREPARING_IMAGE_PACKAGE", "WAITING_IMAGE_APPROVAL", "BUILDING_SELLER_HUB_HANDOFF",
  "READY_FOR_MANUAL_PUBLICATION", "WAITING_ITEM_ID", "VERIFYING_PUBLISHED_LISTING",
  "REGISTERING_COMMERCIAL_MONITOR", "VERIFIED_ACTIVE", "COMPLETED",
]

function jobEffectAlreadyApplied(jobType: string, machineState: string) {
  if (["REJECTED", "BLOCKED", "VERIFIED_ACTIVE", "COMPLETED"].includes(machineState)) return true
  if (jobType === "GENERATE_SIX_IMAGE_PACKAGE" &&
    machineState === "WAITING_PRODUCT_RESEARCH_CAPTURE") return true
  const minimumState: Record<string, string> = {
    RECONCILE_PRODUCT_RESEARCH_CAPTURE: "RUNNING_LOOP_1",
    WAIT_FOR_LOOP1_REANALYSIS: "CALCULATING_ECONOMICS",
    CALCULATE_ECONOMICS: "ENRICHING_PRODUCT_FACTS",
    ENRICH_PRODUCT_FACTS: "WAITING_PRODUCT_APPROVAL",
    BUILD_MANUAL_SELLER_HUB_HANDOFF: "PREPARING_IMAGE_PACKAGE",
    GENERATE_SIX_IMAGE_PACKAGE: "WAITING_IMAGE_APPROVAL",
    APPROVE_SIX_IMAGE_SET: "READY_FOR_MANUAL_PUBLICATION",
    FINALIZE_MANUAL_HANDOFF: "READY_FOR_MANUAL_PUBLICATION",
  }
  const minimum = minimumState[jobType]
  if (!minimum) return false
  return SAME_DAY_MACHINE_ORDER.indexOf(machineState) >= SAME_DAY_MACHINE_ORDER.indexOf(minimum)
}

function isSupersededRetiredV6ApprovalDeadLetter(input: {
  failed: unknown
  candidate: unknown
  jobs: unknown[]
  transitions: unknown[]
}) {
  const failed = record(input.failed)
  const candidate = record(input.candidate)
  const candidateId = text(candidate.id)
  const imageSummary = record(candidate.image_package_summary)
  const handoffSummary = record(candidate.manual_handoff_package)
  const assetIds = strings(imageSummary.assetIds)
  const hasReplacementApprovalJob = input.jobs.some((jobValue) => {
    const job = record(jobValue)
    return text(job.id) !== text(failed.id) &&
      text(job.candidate_id) === candidateId &&
      text(job.job_type) === "APPROVE_SIX_IMAGE_SET" &&
      ["PENDING", "WAITING_RETRY", "LEASED"].includes(text(job.status))
  })
  const hasRecoveryTransition = input.transitions.some((transitionValue) => {
    const transitionRow = record(transitionValue)
    return text(transitionRow.candidate_id) === candidateId &&
      text(transitionRow.previous_state) === "REJECTED" &&
      text(transitionRow.next_state) === "BUILDING_SELLER_HUB_HANDOFF" &&
      text(transitionRow.reason_code) === V9_EXACT_SEVEN_SQL_GATE_RECOVERY_REASON
  })
  return text(failed.job_type) === "APPROVE_SIX_IMAGE_SET" &&
    text(failed.last_error_code) === RETIRED_V6_IMAGE_APPROVAL_ERROR &&
    text(candidate.machine_state) === "BUILDING_SELLER_HUB_HANDOFF" &&
    text(candidate.state) === "READY_FOR_IMAGE_REVIEW" &&
    strings(candidate.blockers).length === 0 &&
    text(imageSummary.status) === "PENDING_HUMAN_REVIEW" &&
    imageSummary.approved !== true &&
    assetIds.length === 7 &&
    number(imageSummary.count) === 7 &&
    Boolean(text(imageSummary.controlId)) &&
    Boolean(text(imageSummary.listingPackageId)) &&
    text(handoffSummary.status) === "AWAITING_IMAGE_APPROVAL" &&
    text(handoffSummary.version) === SAME_DAY_MANUAL_HANDOFF_VERSION &&
    Boolean(text(handoffSummary.packageHash)) &&
    hasReplacementApprovalJob &&
    hasRecoveryTransition
}

async function verifiedBusinessPoliciesFromOwnActiveListing(input: {
  supabase: SupabaseClient
  accountKey: string
}) {
  const [activeListings, verifiedLinks] = await Promise.all([
    input.supabase.from("ebay_active_listings")
      .select("ebay_item_id,listing_status,last_ebay_sync_at")
      .eq("account_key", input.accountKey)
      .order("last_ebay_sync_at", { ascending: false })
      .limit(5),
    input.supabase.from("ebay_manual_listing_links")
      .select("ebay_item_id,verification_status,last_verification_at")
      .eq("account_key", input.accountKey)
      .eq("marketplace_id", MARKETPLACE)
      .eq("verification_status", "verified")
      .order("last_verification_at", { ascending: false })
      .limit(5),
  ])
  if (activeListings.error && verifiedLinks.error) return null
  const itemIds: string[] = []
  const seen = new Set<string>()
  for (const row of [
    ...(activeListings.data ?? []).filter((entry) => text(entry.listing_status).toUpperCase() === "ACTIVE"),
    ...(verifiedLinks.data ?? []),
  ]) {
    const itemId = text(row.ebay_item_id)
    if (!/^\d{9,20}$/.test(itemId) || seen.has(itemId)) continue
    seen.add(itemId)
    itemIds.push(itemId)
  }
  for (const itemId of itemIds.slice(0, 3)) {
    try {
      const listing = await readManualListingFromTradingApi(itemId)
      const policies = {
        fulfillmentPolicyId: text(listing.safeDefaults.fulfillmentPolicyId) || null,
        paymentPolicyId: text(listing.safeDefaults.paymentPolicyId) || null,
        returnPolicyId: text(listing.safeDefaults.returnPolicyId) || null,
      }
      if (listing.ownership === "verified" &&
        Object.values(policies).every((value) => text(value))) {
        return { ...policies, verifiedSourceAt: listing.observedAt }
      }
    } catch {
      // Continue only across the bounded set of listings owned by this account.
    }
  }
  return null
}

async function prepareFactsOnlyManualHandoff(input: {
  supabase: SupabaseClient
  accountKey: string
  runId: string
  candidate: JsonRecord
}) {
  const factsSummary = record(input.candidate.product_facts_summary)
  const queueItemId = text(input.candidate.queue_item_id)
  if (!queueItemId) throw new Error("SAME_DAY_PILOT_FACT_QUEUE_ITEM_MISSING")
  const { data: queueItem, error: queueItemError } = await input.supabase
    .from("marketplace_listing_approval_queue_items")
    .select("id,run_id,decision_package_id,package_hash")
    .eq("id", queueItemId)
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", MARKETPLACE)
    .maybeSingle()
  if (queueItemError) throw new Error("SAME_DAY_PILOT_FACT_BINDING_READ_FAILED")
  const decisionPackageId = text(queueItem?.decision_package_id)
  const decisionPackageHash = text(queueItem?.package_hash)
  const queueRunId = text(queueItem?.run_id)
  if (!queueItem || !queueRunId || !decisionPackageId || !decisionPackageHash) {
    throw new Error("SAME_DAY_PILOT_FACT_BINDING_MISSING")
  }
  const boundFacts = await loadBoundAuthoritativeFactPackage({
    supabase: input.supabase,
    accountKey: input.accountKey,
    itemId: queueItemId,
    binding: { queueRunId, decisionPackageId, decisionPackageHash },
  })
  const currentFactsSummary: JsonRecord = bindCurrentAuthoritativeFactsForManualHandoff({
    factsSummary, boundFacts,
  })
  const taxonomy = record(currentFactsSummary.taxonomy)
  const categoryId = text(taxonomy.categoryId)
  const conditionFact = Array.isArray(currentFactsSummary.resolvedFacts)
    ? currentFactsSummary.resolvedFacts.map(record).find((fact) => text(fact.scope) === "PRODUCT_UNIT" &&
      text(fact.key) === "condition" && ["VERIFIED", "CORROBORATED", "DERIVED_VERIFIED"].includes(text(fact.status)))
    : null
  const conditionContract = ebayConditionContractFromVerifiedFact(conditionFact?.value)
  const { data: opportunity, error: opportunityError } = await input.supabase
    .from("ebay_luna_opportunity_queue")
    .select("market_radar_product_id,supplier_variant_id")
    .eq("id", input.candidate.opportunity_id)
    .maybeSingle()
  if (opportunityError) throw new Error("SAME_DAY_PILOT_LUNA_HANDOFF_IDENTITY_FAILED")
  if (!opportunity?.market_radar_product_id ||
    text(opportunity.supplier_variant_id) !== text(input.candidate.supplier_variant_id)) {
    throw new Error("SAME_DAY_PILOT_LUNA_HANDOFF_IDENTITY_MISMATCH")
  }
  const { data: luna, error: lunaError } = await input.supabase.from("market_radar_latest_variants")
    .select("product_id,supplier_variant_id,featured_image_url,image_urls")
    .eq("source_key", "lunaportex")
    .eq("product_id", opportunity.market_radar_product_id)
    .eq("supplier_variant_id", input.candidate.supplier_variant_id)
    .maybeSingle()
  if (lunaError) throw new Error("SAME_DAY_PILOT_LUNA_HANDOFF_SOURCE_FAILED")
  if (!luna) throw new Error("SAME_DAY_PILOT_LUNA_HANDOFF_SOURCE_MISSING")
  const defaults = /^\d+$/.test(categoryId) && conditionContract
    ? await selectApplicableSafeListingDefaults(input.supabase, { categoryId, conditionId: conditionContract.conditionId })
    : null
  const reusableConditionId = text(defaults?.defaults.conditionId)
  if (reusableConditionId && reusableConditionId !== conditionContract?.conditionId) {
    throw new Error("SAME_DAY_PILOT_SAFE_DEFAULT_CONDITION_MISMATCH")
  }
  const handoffGeneratedAt = new Date().toISOString()
  let verifiedPolicies = {
    fulfillmentPolicyId: text(defaults?.defaults.fulfillmentPolicyId) || null,
    paymentPolicyId: text(defaults?.defaults.paymentPolicyId) || null,
    returnPolicyId: text(defaults?.defaults.returnPolicyId) || null,
    verifiedSourceAt: text(defaults?.verifiedSourceAt) || null,
  }
  let accountProfileRequiresLiveValidation = false
  if (![verifiedPolicies.fulfillmentPolicyId, verifiedPolicies.paymentPolicyId,
    verifiedPolicies.returnPolicyId].every((value) => text(value))) {
    const { data: accountProfile } = await input.supabase
      .from("ebay_account_policy_profiles")
      .select("fulfillment_policy_id,payment_policy_id,return_policy_id,verified_at,expires_at")
      .eq("account_key", input.accountKey)
      .eq("marketplace_id", MARKETPLACE)
      .gt("expires_at", handoffGeneratedAt)
      .maybeSingle()
    if (accountProfile) {
      verifiedPolicies = {
        fulfillmentPolicyId: text(accountProfile.fulfillment_policy_id) || null,
        paymentPolicyId: text(accountProfile.payment_policy_id) || null,
        returnPolicyId: text(accountProfile.return_policy_id) || null,
        verifiedSourceAt: text(accountProfile.verified_at) || null,
      }
      accountProfileRequiresLiveValidation = true
    }
  }
  if (accountProfileRequiresLiveValidation ||
    ![verifiedPolicies.fulfillmentPolicyId, verifiedPolicies.paymentPolicyId,
      verifiedPolicies.returnPolicyId].every((value) => text(value))) {
    const ownListingPolicies = await verifiedBusinessPoliciesFromOwnActiveListing({
      supabase: input.supabase,
      accountKey: input.accountKey,
    })
    if (ownListingPolicies) verifiedPolicies = ownListingPolicies
  }
  if (![verifiedPolicies.fulfillmentPolicyId, verifiedPolicies.paymentPolicyId,
    verifiedPolicies.returnPolicyId].every((value) => text(value))) {
    try {
      const preflight = await preflightEbayDraftOnlyMobile({
        fulfillmentPolicyId: verifiedPolicies.fulfillmentPolicyId ?? undefined,
        paymentPolicyId: verifiedPolicies.paymentPolicyId ?? undefined,
        returnPolicyId: verifiedPolicies.returnPolicyId ?? undefined,
      })
      const livePolicies = {
        fulfillmentPolicyId: text(preflight.selection.fulfillmentPolicyId) || null,
        paymentPolicyId: text(preflight.selection.paymentPolicyId) || null,
        returnPolicyId: text(preflight.selection.returnPolicyId) || null,
      }
      if (preflight.mode === "GET_ONLY" && preflight.identity.status === "BOUND" &&
        preflight.privilege.usable && Object.values(livePolicies).every((value) => text(value))) {
        verifiedPolicies = { ...livePolicies, verifiedSourceAt: handoffGeneratedAt }
      } else if (accountProfileRequiresLiveValidation) {
        verifiedPolicies = { fulfillmentPolicyId: null, paymentPolicyId: null,
          returnPolicyId: null, verifiedSourceAt: null }
      }
    } catch {
      // The handoff builder keeps the verified-policy blocker. Never guess a
      // seller policy when the official read-only account lookup is unavailable.
      if (accountProfileRequiresLiveValidation) {
        verifiedPolicies = { fulfillmentPolicyId: null, paymentPolicyId: null,
          returnPolicyId: null, verifiedSourceAt: null }
      }
    }
  }
  const images = [text(luna?.featured_image_url, 2_000),
    ...(Array.isArray(luna?.image_urls) ? luna.image_urls.map((value) => text(value, 2_000)) : [])].filter(Boolean)
  const result = buildVerifiedManualSellerHubHandoff({
    candidateId: text(input.candidate.id), factRunId: text(currentFactsSummary.factRunId),
    productTitle: text(input.candidate.product_title), supplierSku: text(input.candidate.supplier_sku),
    listingQuantity: Number(input.candidate.listing_quantity ?? 0),
    salePrice: Number(record(input.candidate.economics_summary).operatorApprovedSalePrice ?? 0),
    fulfillmentBasis: record(input.candidate.economics_summary).fulfillmentBasis,
    economics: record(input.candidate.economics_summary), factsSummary: currentFactsSummary, lunaImageUrls: images,
    policies: { categoryId: text(defaults?.defaults.categoryId || categoryId) || null,
      conditionId: conditionContract?.conditionId ?? null,
      ...verifiedPolicies },
    generatedAt: handoffGeneratedAt,
  })
  if (!result.ready) return { ...result, summary: null }
  const { error: persistError } = await input.supabase.from("ebay_same_day_pilot_handoffs").upsert({
    run_id: input.runId, candidate_id: input.candidate.id, fact_run_id: factsSummary.factRunId,
    handoff_version: SAME_DAY_MANUAL_HANDOFF_VERSION, status: "AWAITING_IMAGE_APPROVAL",
    package_data: result.package, package_hash: result.packageHash,
    source_image_type: "LUNA_AUTHORIZED_CATALOG", image_count: result.package.images.count,
    operator_price_approved: true, openai_calls: 0, ebay_writes: 0, production_changed: false,
  }, { onConflict: "candidate_id,package_hash", ignoreDuplicates: true })
  if (persistError) throw new Error("SAME_DAY_PILOT_HANDOFF_PERSIST_FAILED")
  const summary = { status: "AWAITING_IMAGE_APPROVAL", version: SAME_DAY_MANUAL_HANDOFF_VERSION,
    packageHash: result.packageHash, package: result.package, blockers: [], warnings: result.warnings,
    openAiCalls: 0, ebayWrites: 0 }
  const { error: updateError } = await input.supabase.from("ebay_same_day_pilot_candidates").update({
    manual_handoff_package: summary,
    image_package_summary: { source: "LUNA_AUTHORIZED_CATALOG", count: result.package.images.count,
      approved: false, generatedImages: 0, competitorImages: 0 },
    updated_at: new Date().toISOString(),
  }).eq("id", input.candidate.id).eq("run_id", input.runId)
  if (updateError) throw new Error("SAME_DAY_PILOT_HANDOFF_SUMMARY_FAILED")
  return { ...result, summary }
}

async function resetVisualMarketRecaptureQueryPlan(input: {
  supabase: SupabaseClient
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>
  candidate: JsonRecord
  priorCaptureBatchId: string
  now: Date
}) {
  const accountKey = text(input.state.run.marketplace_account_key)
  const candidatePlan = record(input.candidate.product_research_query_plan)
  const planId = text(candidatePlan.productResearchPlanId) ||
    text(record(input.state.run.source_inventory).productResearchPlanId)
  const plannedQuery = text(candidatePlan.query, 100)
  if (!planId || !plannedQuery) {
    throw new Error("SAME_DAY_PILOT_VISUAL_RECAPTURE_PLAN_BINDING_MISSING")
  }

  const [{ data: plan, error: planError }, { data: tasks, error: taskError }] =
    await Promise.all([
      input.supabase.from("marketplace_product_research_query_plans")
        .select("id,status")
        .eq("id", planId)
        .eq("marketplace_account_key", accountKey)
        .eq("marketplace", MARKETPLACE)
        .in("status", ["ACTIVE", "COMPLETED"])
        .maybeSingle(),
      input.supabase.from("marketplace_product_research_query_tasks")
        .select("id,status,search_query,capture_batch_id")
        .eq("plan_id", planId)
        .eq("marketplace_account_key", accountKey)
        .eq("marketplace", MARKETPLACE)
        .in("status", ["PENDING", "PROCESSED"])
        .order("ordinal", { ascending: true }),
    ])
  if (planError || taskError || !plan) {
    throw new Error("SAME_DAY_PILOT_VISUAL_RECAPTURE_PLAN_READ_FAILED")
  }
  const task = (tasks ?? []).find((entry) =>
    productResearchQueriesMatch(plannedQuery, entry.search_query) && (
      entry.status === "PENDING" ||
      (entry.status === "PROCESSED" &&
        text(entry.capture_batch_id) === input.priorCaptureBatchId)
    ))
  if (!task) {
    throw new Error("SAME_DAY_PILOT_VISUAL_RECAPTURE_QUERY_TASK_MISSING")
  }

  if (task.status === "PROCESSED") {
    const { data: resetTasks, error } = await input.supabase
      .from("marketplace_product_research_query_tasks")
      .update({
        status: "PENDING",
        capture_batch_id: null,
        captured_at: null,
        processed_at: null,
        last_error_code: "VISUAL_MARKET_RECAPTURE_REQUIRED",
        updated_at: input.now.toISOString(),
      })
      .eq("id", task.id)
      .eq("plan_id", planId)
      .eq("status", "PROCESSED")
      .eq("capture_batch_id", input.priorCaptureBatchId)
      .select("id")
    if (error || (resetTasks ?? []).length !== 1) {
      throw new Error("SAME_DAY_PILOT_VISUAL_RECAPTURE_QUERY_TASK_RESET_FAILED")
    }
  }
  if (plan.status === "COMPLETED") {
    const { data: resetPlans, error } = await input.supabase
      .from("marketplace_product_research_query_plans")
      .update({
        status: "ACTIVE",
        completed_at: null,
        updated_at: input.now.toISOString(),
      })
      .eq("id", planId)
      .eq("marketplace_account_key", accountKey)
      .eq("marketplace", MARKETPLACE)
      .eq("status", "COMPLETED")
      .select("id")
    if (error || (resetPlans ?? []).length !== 1) {
      throw new Error("SAME_DAY_PILOT_VISUAL_RECAPTURE_PLAN_RESET_FAILED")
    }
  }
  return { planId, taskId: text(task.id) }
}

async function routeCandidateToVisualMarketRecapture(input: {
  supabase: SupabaseClient
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>
  candidate: JsonRecord
  previousState: string
  errorCode: string
  recoveryOrigin: "ACTIVE_IMAGE_JOB" | "REJECTED_HISTORY_REPAIR"
  now: Date
}) {
  if (!VISUAL_MARKET_RECAPTURE_ERROR_CODES.has(input.errorCode)) {
    throw new Error("SAME_DAY_PILOT_VISUAL_RECAPTURE_ERROR_NOT_RECOVERABLE")
  }
  const candidateId = text(input.candidate.id)
  const priorCaptureBatchId = text(
    input.candidate.product_research_capture_batch_id,
  )
  if (!candidateId || !priorCaptureBatchId) {
    throw new Error("SAME_DAY_PILOT_VISUAL_RECAPTURE_CAPTURE_BINDING_MISSING")
  }
  const queryPlan = await resetVisualMarketRecaptureQueryPlan({
    supabase: input.supabase,
    state: input.state,
    candidate: input.candidate,
    priorCaptureBatchId,
    now: input.now,
  })
  const boundProductResearchQueryPlan = {
    ...record(input.candidate.product_research_query_plan),
    productResearchPlanId: queryPlan.planId,
  }
  const facts = record(input.candidate.product_facts_summary)
  const handoff = record(input.candidate.manual_handoff_package)
  const evidenceSummary = {
    ...record(input.candidate.evidence_summary),
    visualMarketRecaptureRecoveryVersion:
      VISUAL_MARKET_RECAPTURE_RECOVERY_VERSION,
    visualMarketRecaptureRequestedAt: input.now.toISOString(),
    visualMarketRecaptureRecoveryOrigin: input.recoveryOrigin,
    visualMarketEvidenceStatus: "RECAPTURE_REQUIRED",
    visualMarketEvidenceReason: input.errorCode,
    supersededVisualCaptureBatchId: priorCaptureBatchId,
    requiredVisualPatternSchemaVersion:
      PRODUCT_RESEARCH_VISUAL_PATTERN_SCHEMA_VERSION,
    requiredVisualPatternAlgorithmVersion:
      PRODUCT_RESEARCH_VISUAL_PATTERN_ALGORITHM_VERSION,
    requiredVisualMarketBriefVersion: VISUAL_MARKET_BRIEF_VERSION,
    commercialEvidencePreserved: true,
    productFactsPreserved: true,
    productApprovalPreservedForRevalidation: true,
    fullCatalogRescan: false,
  }
  const imageSummary = {
    ...record(input.candidate.image_package_summary),
    status: "WAITING_VISUAL_MARKET_RECAPTURE",
    approved: false,
    regenerationReason: "VISUAL_MARKET_EVIDENCE_REQUIRED",
    openAiCalls: 0,
    ebayWrites: 0,
  }
  // Persist the recovery marker before the state transition. If the worker
  // loses its lease between calls, bootstrap can still recreate the exact
  // visual task instead of falling back to a generic commercial recapture.
  const { error: markerError } = await input.supabase
    .from("ebay_same_day_pilot_candidates")
    .update({
      product_research_query_plan: boundProductResearchQueryPlan,
      evidence_summary: evidenceSummary,
      image_package_summary: imageSummary,
      next_automated_action:
        "Validar la nueva evidencia visual y continuar desde el paquete conservado.",
      next_human_action:
        "Recapturar una sola vez la consulta Product Research preparada.",
      updated_at: input.now.toISOString(),
    })
    .eq("id", candidateId)
    .eq("run_id", input.state.run.id)
    .eq("machine_state", input.previousState)
  if (markerError) {
    throw new Error("SAME_DAY_PILOT_VISUAL_RECAPTURE_MARKER_FAILED")
  }

  await transition({
    supabase: input.supabase,
    runId: input.state.run.id,
    candidateId,
    previousState: input.previousState,
    nextState: "WAITING_PRODUCT_RESEARCH_CAPTURE",
    reasonCode: "VISUAL_MARKET_RECAPTURE_REQUIRED",
    triggeredBy: "RETRY",
    checkpoint: {
      recoveryVersion: VISUAL_MARKET_RECAPTURE_RECOVERY_VERSION,
      previousErrorCode: input.errorCode,
      recoveryOrigin: input.recoveryOrigin,
      supersededCaptureBatchId: priorCaptureBatchId,
      productResearchPlanId: queryPlan.planId,
      productResearchQueryTaskId: queryPlan.taskId,
      factRunId: facts.factRunId ?? null,
      packageHash: handoff.packageHash ?? null,
      commercialEvidencePreserved: true,
      productFactsPreserved: true,
      productApprovalPreservedForRevalidation: true,
      fullCatalogRescan: false,
      openAiCalls: 0,
      ebayWrites: 0,
      productionChanged: false,
    },
    nextAutomaticAction:
      "Validar la nueva evidencia visual y continuar desde el paquete conservado.",
    nextHumanAction:
      "Recapturar una sola vez la consulta Product Research preparada.",
  })
  const { error: candidateError } = await input.supabase
    .from("ebay_same_day_pilot_candidates")
    .update({
      state: "NEEDS_PRODUCT_RESEARCH_CAPTURE",
      blockers: ["VISUAL_MARKET_EVIDENCE_REQUIRED"],
      product_research_capture_batch_id: null,
      product_research_query_plan: boundProductResearchQueryPlan,
      evidence_summary: evidenceSummary,
      image_package_summary: imageSummary,
      updated_at: input.now.toISOString(),
    })
    .eq("id", candidateId)
    .eq("run_id", input.state.run.id)
    .eq("machine_state", "WAITING_PRODUCT_RESEARCH_CAPTURE")
  if (candidateError) {
    throw new Error("SAME_DAY_PILOT_VISUAL_RECAPTURE_CANDIDATE_UPDATE_FAILED")
  }

  await bootstrapCandidate(input.supabase, input.state.run.id, {
    ...input.candidate,
    machine_state: "WAITING_PRODUCT_RESEARCH_CAPTURE",
    state: "NEEDS_PRODUCT_RESEARCH_CAPTURE",
    blockers: ["VISUAL_MARKET_EVIDENCE_REQUIRED"],
    product_research_capture_batch_id: null,
    product_research_query_plan: boundProductResearchQueryPlan,
    evidence_summary: evidenceSummary,
    image_package_summary: imageSummary,
  })
  const { error: eventError } = await input.supabase
    .from("ebay_same_day_pilot_events")
    .upsert({
      run_id: input.state.run.id,
      candidate_id: candidateId,
      event_type: "VISUAL_MARKET_RECAPTURE_REQUIRED",
      event_payload: {
        recoveryVersion: VISUAL_MARKET_RECAPTURE_RECOVERY_VERSION,
        previousErrorCode: input.errorCode,
        recoveryOrigin: input.recoveryOrigin,
        supersededCaptureBatchId: priorCaptureBatchId,
        productResearchPlanId: queryPlan.planId,
        productResearchQueryTaskId: queryPlan.taskId,
        commercialEvidencePreserved: true,
        productFactsPreserved: true,
        productApprovalPreservedForRevalidation: true,
        requestedAt: input.now.toISOString(),
        historyDeleted: false,
      },
      idempotency_key:
        `${input.state.run.id}:${candidateId}:${VISUAL_MARKET_RECAPTURE_RECOVERY_VERSION}`,
      ebay_read_calls: 0,
      openai_calls: 0,
      ebay_writes: 0,
      production_changed: false,
    }, { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (eventError) {
    throw new Error("SAME_DAY_PILOT_VISUAL_RECAPTURE_EVENT_FAILED")
  }
  return { priorCaptureBatchId, queryPlan }
}

function visualMarketRecoveryPriorityCandidate(
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
) {
  return [...state.candidates]
    .filter((candidate) => {
      const evidence = record(candidate.evidence_summary)
      return text(evidence.visualMarketRecaptureRecoveryVersion) ===
        VISUAL_MARKET_RECAPTURE_RECOVERY_VERSION &&
        (text(evidence.visualMarketEvidenceReason) ===
          "MARKET_VISUAL_SIGNALS_INSUFFICIENT" ||
          text(evidence.visualMarketRecaptureRecoveryOrigin) ===
            "ACTIVE_IMAGE_JOB") &&
        !["REJECTED", "BLOCKED", "VERIFIED_ACTIVE", "COMPLETED"]
          .includes(text(candidate.machine_state))
    })
    .sort((left, right) => {
      const leftRequestedAt = Date.parse(text(
        record(left.evidence_summary).visualMarketRecaptureRequestedAt,
      ))
      const rightRequestedAt = Date.parse(text(
        record(right.evidence_summary).visualMarketRecaptureRequestedAt,
      ))
      if (Number.isFinite(leftRequestedAt) &&
        Number.isFinite(rightRequestedAt) &&
        leftRequestedAt !== rightRequestedAt) {
        return leftRequestedAt - rightRequestedAt
      }
      return Number(left.ordinal) - Number(right.ordinal)
    })[0] ?? null
}

async function restoreUsableSupersededVisualCapture(
  supabase: SupabaseClient,
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
  accountKey: string,
  now: Date,
) {
  const candidate = visualMarketRecoveryPriorityCandidate(state)
  if (!candidate ||
    text(candidate.machine_state) !== "WAITING_PRODUCT_RESEARCH_CAPTURE" ||
    text(candidate.product_research_capture_batch_id)) return false
  const candidateId = text(candidate.id)
  const evidence = record(candidate.evidence_summary)
  const captureBatchId = text(evidence.supersededVisualCaptureBatchId)
  const familyFingerprint = text(candidate.family_fingerprint)
  const candidatePlan = record(candidate.product_research_query_plan)
  const planId = text(candidatePlan.productResearchPlanId) ||
    text(record(state.run.source_inventory).productResearchPlanId)
  const plannedQuery = text(candidatePlan.query, 100)
  const queryHash = productResearchPlannedQueryHash(plannedQuery)
  const hasOpenCaptureGate = state.tasks.some((task) =>
    text(task.candidate_id) === candidateId &&
    task.gate_type === "PRODUCT_RESEARCH_CAPTURE_REQUIRED" &&
    task.status === "OPEN")
  if (!candidateId || !hasOpenCaptureGate ||
    !/^[0-9a-f-]{36}$/i.test(captureBatchId) ||
    !/^[0-9a-f-]{36}$/i.test(planId) ||
    !/^(?:sha256:)?[0-9a-f]{64}$/.test(familyFingerprint) ||
    !plannedQuery) return false

  const [{ data: queryTasks, error: queryTaskError },
    { data: captureBatch, error: captureBatchError },
    marketVisualBrief] = await Promise.all([
    supabase.from("marketplace_product_research_query_tasks")
      .select("id,status,query_hash")
      .eq("plan_id", planId)
      .eq("marketplace_account_key", accountKey)
      .eq("marketplace", MARKETPLACE)
      .eq("query_hash", queryHash)
      .eq("status", "PENDING"),
    supabase.from("marketplace_product_research_capture_batches")
      .select("id,captured_at,search_query_hash")
      .eq("id", captureBatchId)
      .eq("marketplace_account_key", accountKey)
      .eq("marketplace", MARKETPLACE)
      .maybeSingle(),
    loadEbayImageMarketBrief({
      supabase,
      accountKey,
      captureBatchId,
      familyFingerprint,
    }),
  ])
  if (queryTaskError || captureBatchError) {
    throw new Error("SAME_DAY_PILOT_QUERY_FAMILY_VISUAL_RECOVERY_READ_FAILED")
  }
  const queryTask = (queryTasks ?? []).find((task) =>
    text(task.query_hash) === queryHash)
  const capturedAt = new Date(text(captureBatch?.captured_at))
  if (!queryTask || text(captureBatch?.search_query_hash) !== queryHash ||
    !Number.isFinite(capturedAt.getTime()) ||
    !isEbayImageMarketBriefUsable(marketVisualBrief, now)) return false

  await markProductResearchQueryCaptured({
    supabase,
    accountKey,
    searchQueryHash: queryHash,
    captureBatchId,
    planId,
    taskId: text(queryTask.id),
    capturedAt,
    now,
  })
  const { error: eventError } = await supabase
    .from("ebay_same_day_pilot_events")
    .upsert({
      run_id: state.run.id,
      candidate_id: candidateId,
      event_type: "QUERY_FAMILY_VISUAL_BRIEF_REUSED",
      event_payload: {
        recoveryVersion: QUERY_FAMILY_VISUAL_BRIEF_RECOVERY_VERSION,
        captureBatchId,
        productResearchPlanId: planId,
        productResearchQueryTaskId: queryTask.id,
        confidence: marketVisualBrief?.confidence ?? null,
        aggregateSampleSize: marketVisualBrief?.sampleSize ?? 0,
        primaryCohort: marketVisualBrief?.primaryCohort ?? null,
        sameCaptureBatchOnly: true,
        commercialEvidencePreserved: true,
        productFactsPreserved: true,
        productApprovalPreservedForRevalidation: true,
        identityClaimsInferred: false,
        historyDeleted: false,
      },
      idempotency_key:
        `${state.run.id}:${candidateId}:${QUERY_FAMILY_VISUAL_BRIEF_RECOVERY_VERSION}:${captureBatchId}`,
      ebay_read_calls: 0,
      openai_calls: 0,
      ebay_writes: 0,
      production_changed: false,
    }, { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (eventError) {
    throw new Error("SAME_DAY_PILOT_QUERY_FAMILY_VISUAL_RECOVERY_EVENT_FAILED")
  }
  return true
}

async function repairQueryFamilyVisualReconciliationOrphan(
  supabase: SupabaseClient,
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
) {
  const candidate = state.candidates.find((entry) => {
    const evidence = record(entry.evidence_summary)
    return text(entry.machine_state) === "RECONCILING_IDENTITY" &&
      text(entry.product_research_capture_batch_id) &&
      text(entry.product_research_capture_batch_id) ===
        text(evidence.supersededVisualCaptureBatchId) &&
      text(evidence.visualMarketRecaptureRecoveryVersion) ===
        VISUAL_MARKET_RECAPTURE_RECOVERY_VERSION
  })
  if (!candidate) return false
  const candidateId = text(candidate.id)
  const captureBatchId = text(candidate.product_research_capture_batch_id)
  const activeReconciliationJob = state.jobs.some((job) =>
    text(job.candidate_id) === candidateId &&
    text(job.job_type) === "RECONCILE_PRODUCT_RESEARCH_CAPTURE" &&
    ["PENDING", "WAITING_RETRY", "LEASED"].includes(text(job.status)))
  if (activeReconciliationJob) return false

  const recoveryJobKey = [
    state.run.id,
    candidateId,
    "RECONCILE_PRODUCT_RESEARCH_CAPTURE",
    captureBatchId,
    QUERY_FAMILY_VISUAL_BRIEF_RECOVERY_VERSION,
  ].join(":")
  const [{ data: recoveryEvents, error: recoveryEventReadError },
    { data: existingJob, error: existingJobError }] = await Promise.all([
    supabase.from("ebay_same_day_pilot_events")
      .select("id,event_payload")
      .eq("run_id", state.run.id)
      .eq("candidate_id", candidateId)
      .eq("event_type", "QUERY_FAMILY_VISUAL_BRIEF_REUSED")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase.from("ebay_same_day_pilot_jobs")
      .select("id,status")
      .eq("idempotency_key", recoveryJobKey)
      .maybeSingle(),
  ])
  if (recoveryEventReadError || existingJobError) {
    throw new Error(
      "SAME_DAY_PILOT_QUERY_FAMILY_RECONCILIATION_ORPHAN_READ_FAILED",
    )
  }
  const exactRecoveryEvent = (recoveryEvents ?? []).find((event) =>
    text(record(event.event_payload).captureBatchId) === captureBatchId)
  if (!exactRecoveryEvent || existingJob) return false

  await enqueuePilotJob({
    supabase,
    runId: text(state.run.id),
    candidateId,
    job: {
      jobType: "RECONCILE_PRODUCT_RESEARCH_CAPTURE",
      idempotencyKey: recoveryJobKey,
      checkpoint: {
        captureBatchId,
        supplierVariantId: candidate.supplier_variant_id,
        capturedAt:
          record(candidate.evidence_summary).groupedCaptureObservedAt ?? null,
        queryFamilyVisualBriefReused: true,
        orphanRecovery: true,
      },
      maxAttempts: 10,
      apiFamily: "BROWSE",
      apiOperation: "EXACT_VERIFICATION",
      ownerLane: "P1_EXACT_VERIFICATION",
    },
  })
  const { error: eventError } = await supabase
    .from("ebay_same_day_pilot_events")
    .upsert({
      run_id: state.run.id,
      candidate_id: candidateId,
      event_type: "QUERY_FAMILY_VISUAL_RECONCILIATION_ORPHAN_REPAIRED",
      event_payload: {
        recoveryVersion: QUERY_FAMILY_VISUAL_BRIEF_RECOVERY_VERSION,
        captureBatchId,
        recoveryJobKey,
        priorCompletedJobPreserved: true,
        historyDeleted: false,
      },
      idempotency_key:
        `${recoveryJobKey}:ORPHAN_REPAIR_EVENT`,
      ebay_read_calls: 0,
      openai_calls: 0,
      ebay_writes: 0,
      production_changed: false,
    }, { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (eventError) {
    throw new Error(
      "SAME_DAY_PILOT_QUERY_FAMILY_RECONCILIATION_ORPHAN_EVENT_FAILED",
    )
  }
  return true
}

function isDeferredLegacyVisualMarketRecovery(candidate: JsonRecord) {
  const evidence = record(candidate.evidence_summary)
  return (
    text(candidate.machine_state) ===
      "WAITING_PRODUCT_RESEARCH_CAPTURE" &&
    text(evidence.visualMarketRecaptureRecoveryVersion) ===
      VISUAL_MARKET_RECAPTURE_RECOVERY_VERSION &&
    text(evidence.visualMarketEvidenceReason) ===
      "SAME_DAY_IMAGE_MARKET_BRIEF_REQUIRED" &&
    text(evidence.visualMarketRecaptureRecoveryOrigin) !== "ACTIVE_IMAGE_JOB"
  )
}

const DEFERRED_VISUAL_CAPTURE_GATE_RECOVERY_VERSION =
  "DEFERRED_VISUAL_CAPTURE_GATE_RECOVERY_V1_2026_07_24"

/**
 * A foreground image failure can temporarily defer older visual-market
 * recaptures. Once that foreground recovery settles, restore exactly one
 * deferred candidate to the serialized operator inbox. A capture accepted
 * after the recapture request is consumed as durable evidence; an older
 * superseded capture is reset to PENDING so the operator receives one real
 * query instead of an inert PROCESSED plan.
 */
async function activateNextDeferredVisualMarketRecovery(
  supabase: SupabaseClient,
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
  accountKey: string,
  now: Date,
) {
  if (visualMarketRecoveryPriorityCandidate(state) ||
    state.tasks.some((task) => task.status === "OPEN" &&
      task.gate_type !== "CRITICAL_EXCEPTION_REQUIRED")) return false
  const candidate = [...state.candidates]
    .filter((entry) =>
      isDeferredLegacyVisualMarketRecovery(record(entry)) &&
      text(entry.machine_state) === "WAITING_PRODUCT_RESEARCH_CAPTURE" &&
      !text(entry.product_research_capture_batch_id))
    .sort((left, right) => {
      const leftRequestedAt = Date.parse(text(
        record(left.evidence_summary).visualMarketRecaptureRequestedAt,
      ))
      const rightRequestedAt = Date.parse(text(
        record(right.evidence_summary).visualMarketRecaptureRequestedAt,
      ))
      if (Number.isFinite(leftRequestedAt) &&
        Number.isFinite(rightRequestedAt) &&
        leftRequestedAt !== rightRequestedAt) {
        return leftRequestedAt - rightRequestedAt
      }
      return Number(left.ordinal) - Number(right.ordinal)
    })[0] ?? null
  if (!candidate) return false

  const candidateId = text(candidate.id)
  const candidatePlan = record(candidate.product_research_query_plan)
  const plannedQuery = text(candidatePlan.query, 100)
  const recoveryTransition = [...state.transitions].reverse().find((entry) =>
    text(entry.candidate_id) === candidateId &&
    text(entry.next_state) === "WAITING_PRODUCT_RESEARCH_CAPTURE" &&
    text(entry.reason_code) === "VISUAL_MARKET_RECAPTURE_REQUIRED")
  const recoveryCheckpoint = record(recoveryTransition?.checkpoint)
  const planId = text(candidatePlan.productResearchPlanId) ||
    text(recoveryCheckpoint.productResearchPlanId)
  const preferredTaskId = text(recoveryCheckpoint.productResearchQueryTaskId)
  if (!candidateId || !plannedQuery ||
    !/^[0-9a-f-]{36}$/i.test(planId)) {
    throw new Error("SAME_DAY_PILOT_DEFERRED_VISUAL_PLAN_BINDING_MISSING")
  }

  const [{ data: plan, error: planError }, { data: tasks, error: taskError }] =
    await Promise.all([
      supabase.from("marketplace_product_research_query_plans")
        .select("id,status")
        .eq("id", planId)
        .eq("marketplace_account_key", accountKey)
        .eq("marketplace", MARKETPLACE)
        .in("status", ["ACTIVE", "COMPLETED"])
        .maybeSingle(),
      supabase.from("marketplace_product_research_query_tasks")
        .select("id,status,search_query,capture_batch_id,captured_at")
        .eq("plan_id", planId)
        .eq("marketplace_account_key", accountKey)
        .eq("marketplace", MARKETPLACE)
        .in("status", ["PENDING", "PROCESSED"])
        .order("ordinal", { ascending: true }),
    ])
  if (planError || taskError || !plan) {
    throw new Error("SAME_DAY_PILOT_DEFERRED_VISUAL_PLAN_READ_FAILED")
  }
  const task = (tasks ?? []).find((entry) =>
    (preferredTaskId && text(entry.id) === preferredTaskId) ||
    productResearchQueriesMatch(plannedQuery, entry.search_query))
  if (!task) {
    throw new Error("SAME_DAY_PILOT_DEFERRED_VISUAL_QUERY_TASK_MISSING")
  }

  const evidence = record(candidate.evidence_summary)
  const requestedAt = Date.parse(text(evidence.visualMarketRecaptureRequestedAt))
  const capturedAt = Date.parse(text(task.captured_at))
  const captureBatchId = text(task.capture_batch_id)
  const supersededCaptureBatchId = text(evidence.supersededVisualCaptureBatchId)
  const freshProcessedCapture = task.status === "PROCESSED" &&
    Boolean(captureBatchId) &&
    captureBatchId !== supersededCaptureBatchId &&
    Number.isFinite(requestedAt) &&
    Number.isFinite(capturedAt) &&
    capturedAt >= requestedAt
  const resetForFreshCapture = task.status === "PROCESSED" &&
    !freshProcessedCapture

  if (resetForFreshCapture) {
    const { data: resetTasks, error } = await supabase
      .from("marketplace_product_research_query_tasks")
      .update({
        status: "PENDING",
        capture_batch_id: null,
        captured_at: null,
        processed_at: null,
        last_error_code: "VISUAL_MARKET_RECAPTURE_REQUIRED",
        updated_at: now.toISOString(),
      })
      .eq("id", task.id)
      .eq("plan_id", planId)
      .eq("status", "PROCESSED")
      .select("id")
    if (error || (resetTasks ?? []).length !== 1) {
      throw new Error("SAME_DAY_PILOT_DEFERRED_VISUAL_QUERY_RESET_FAILED")
    }
  }
  if (plan.status === "COMPLETED" &&
    (resetForFreshCapture || task.status === "PENDING")) {
    const { data: resetPlans, error } = await supabase
      .from("marketplace_product_research_query_plans")
      .update({
        status: "ACTIVE",
        completed_at: null,
        updated_at: now.toISOString(),
      })
      .eq("id", planId)
      .eq("marketplace_account_key", accountKey)
      .eq("marketplace", MARKETPLACE)
      .eq("status", "COMPLETED")
      .select("id")
    if (error || (resetPlans ?? []).length !== 1) {
      throw new Error("SAME_DAY_PILOT_DEFERRED_VISUAL_PLAN_RESET_FAILED")
    }
  }

  const boundProductResearchQueryPlan = {
    ...candidatePlan,
    productResearchPlanId: planId,
  }
  const { error: candidateError } = await supabase
    .from("ebay_same_day_pilot_candidates")
    .update({
      product_research_query_plan: boundProductResearchQueryPlan,
      updated_at: now.toISOString(),
    })
    .eq("id", candidateId)
    .eq("run_id", state.run.id)
    .eq("machine_state", "WAITING_PRODUCT_RESEARCH_CAPTURE")
  if (candidateError) {
    throw new Error("SAME_DAY_PILOT_DEFERRED_VISUAL_BINDING_REPAIR_FAILED")
  }
  const boundCandidate = {
    ...record(candidate),
    product_research_query_plan: boundProductResearchQueryPlan,
  }
  await activateCandidateProductResearchPlan(
    supabase,
    text(state.run.id),
    boundCandidate,
  )
  await bootstrapCandidate(supabase, text(state.run.id), boundCandidate)

  const { error: eventError } = await supabase
    .from("ebay_same_day_pilot_events")
    .upsert({
      run_id: state.run.id,
      candidate_id: candidateId,
      event_type: "DEFERRED_VISUAL_CAPTURE_GATE_RECOVERED",
      event_payload: {
        recoveryVersion: DEFERRED_VISUAL_CAPTURE_GATE_RECOVERY_VERSION,
        productResearchPlanId: planId,
        productResearchQueryTaskId: task.id,
        freshProcessedCapture,
        captureBatchId: freshProcessedCapture ? captureBatchId : null,
        resetForFreshCapture,
        serializedOneAtATime: true,
        commercialEvidencePreserved: true,
        productFactsPreserved: true,
        productApprovalPreservedForRevalidation: true,
        historyDeleted: false,
      },
      idempotency_key: [
        state.run.id,
        candidateId,
        DEFERRED_VISUAL_CAPTURE_GATE_RECOVERY_VERSION,
      ].join(":"),
      ebay_read_calls: 0,
      openai_calls: 0,
      ebay_writes: 0,
      production_changed: false,
    }, { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (eventError) {
    throw new Error("SAME_DAY_PILOT_DEFERRED_VISUAL_GATE_EVENT_FAILED")
  }
  return true
}

async function restoreDeferredLegacyVisualMarketRecoveryQueryTasks(
  supabase: SupabaseClient,
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
  now: Date,
) {
  // A current image-job failure has priority. Historical visual-v1 candidates
  // remain available for later review, but their original PROCESSED query
  // tasks must not stay PENDING and consume the visible candidate's capture.
  if (!visualMarketRecoveryPriorityCandidate(state)) return 0
  const bindings = state.candidates.flatMap((candidate) => {
    if (!isDeferredLegacyVisualMarketRecovery(record(candidate)) ||
      text(candidate.machine_state) !== "WAITING_PRODUCT_RESEARCH_CAPTURE" ||
      text(candidate.product_research_capture_batch_id)) return []
    // Once a fresh recapture gate is visible, its PENDING query belongs to the
    // operator. Restoring the superseded batch here would complete that gate
    // with old evidence and could strand the candidate in an automatic state
    // without a new job.
    const hasOpenFreshCaptureGate = state.tasks.some((task) =>
      text(task.candidate_id) === text(candidate.id) &&
      task.gate_type === "PRODUCT_RESEARCH_CAPTURE_REQUIRED" &&
      task.status === "OPEN")
    if (hasOpenFreshCaptureGate) return []
    const candidatePlan = record(candidate.product_research_query_plan)
    const planId = text(candidatePlan.productResearchPlanId)
    const plannedQuery = text(candidatePlan.query, 100)
    const priorCaptureBatchId = text(
      record(candidate.evidence_summary).supersededVisualCaptureBatchId,
    )
    if (!/^[0-9a-f-]{36}$/i.test(planId) ||
      !/^[0-9a-f-]{36}$/i.test(priorCaptureBatchId) ||
      !plannedQuery) return []
    return [{
      candidateId: text(candidate.id),
      planId,
      queryHash: productResearchPlannedQueryHash(plannedQuery),
      priorCaptureBatchId,
    }]
  })
  if (!bindings.length) return 0
  const planIds = [...new Set(bindings.map((binding) => binding.planId))]
  const batchIds = [...new Set(bindings.map((binding) =>
    binding.priorCaptureBatchId))]
  const accountKey = text(state.run.marketplace_account_key)
  const [{ data: tasks, error: taskError }, { data: batches, error: batchError }] =
    await Promise.all([
      supabase.from("marketplace_product_research_query_tasks")
        .select("id,plan_id,query_hash,status")
        .eq("marketplace_account_key", accountKey)
        .eq("marketplace", MARKETPLACE)
        .in("plan_id", planIds)
        .eq("status", "PENDING"),
      supabase.from("marketplace_product_research_capture_batches")
        .select("id,captured_at,search_query_hash")
        .eq("marketplace_account_key", accountKey)
        .eq("marketplace", MARKETPLACE)
        .in("id", batchIds),
    ])
  if (taskError || batchError) {
    throw new Error("SAME_DAY_PILOT_DEFERRED_VISUAL_QUERY_RESTORE_READ_FAILED")
  }
  const batchesById = new Map((batches ?? []).map((batch) => [
    text(batch.id),
    batch,
  ]))
  let restored = 0
  for (const binding of bindings) {
    const task = (tasks ?? []).find((entry) =>
      text(entry.plan_id) === binding.planId &&
      text(entry.query_hash) === binding.queryHash)
    const batch = batchesById.get(binding.priorCaptureBatchId)
    const capturedAt = new Date(text(batch?.captured_at))
    if (!task || text(batch?.search_query_hash) !== binding.queryHash ||
      !Number.isFinite(capturedAt.getTime())) continue
    await markProductResearchQueryCaptured({
      supabase,
      accountKey,
      searchQueryHash: binding.queryHash,
      captureBatchId: binding.priorCaptureBatchId,
      planId: binding.planId,
      taskId: text(task.id),
      capturedAt,
      now,
    })
    const { error: eventError } = await supabase
      .from("ebay_same_day_pilot_events")
      .upsert({
        run_id: state.run.id,
        candidate_id: binding.candidateId,
        event_type: "DEFERRED_VISUAL_QUERY_TASK_RESTORED",
        event_payload: {
          recoveryVersion: VISUAL_MARKET_RECAPTURE_RECOVERY_VERSION,
          queryTaskId: task.id,
          restoredCaptureBatchId: binding.priorCaptureBatchId,
          deferredBehindCandidateId:
            visualMarketRecoveryPriorityCandidate(state)?.id ?? null,
          historyDeleted: false,
        },
        idempotency_key:
          `${state.run.id}:${binding.candidateId}:DEFERRED_VISUAL_QUERY_RESTORE:${task.id}`,
        ebay_read_calls: 0,
        openai_calls: 0,
        ebay_writes: 0,
        production_changed: false,
      }, { onConflict: "idempotency_key", ignoreDuplicates: true })
    if (eventError) {
      throw new Error("SAME_DAY_PILOT_DEFERRED_VISUAL_QUERY_RESTORE_EVENT_FAILED")
    }
    restored += 1
  }
  return restored
}

const STALE_VISUAL_AUTO_RESUME_RECOVERY_VERSION =
  "STALE_VISUAL_AUTO_RESUME_RECOVERY_V1_2026_07_24"

/**
 * A superseded visual capture can be consumed again after a deferred recovery
 * race. The atomic gate transition then lands on CALCULATING_ECONOMICS while
 * the reused CALCULATE_ECONOMICS idempotency key already belongs to a
 * COMPLETED job. Restore the exact visual recapture gate instead of pretending
 * that profitability is still running or asking for Luna again.
 */
async function repairStaleVisualAutoResumeOrphan(
  supabase: SupabaseClient,
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
  now: Date,
) {
  const candidate = state.candidates.find((entry) => {
    const evidence = record(entry.evidence_summary)
    const candidateId = text(entry.id)
    const activeJob = state.jobs.some((job) =>
      text(job.candidate_id) === candidateId &&
      ["PENDING", "WAITING_RETRY", "LEASED"].includes(text(job.status)))
    return text(entry.machine_state) === "CALCULATING_ECONOMICS" &&
      !activeJob &&
      text(entry.product_research_capture_batch_id) &&
      text(entry.product_research_capture_batch_id) ===
        text(evidence.supersededVisualCaptureBatchId) &&
      text(evidence.visualMarketRecaptureRecoveryVersion) ===
        VISUAL_MARKET_RECAPTURE_RECOVERY_VERSION &&
      text(evidence.visualMarketEvidenceStatus) === "RECAPTURE_REQUIRED"
  })
  if (!candidate) return 0

  const evidence = record(candidate.evidence_summary)
  await routeCandidateToVisualMarketRecapture({
    supabase,
    state,
    candidate: record(candidate),
    previousState: "CALCULATING_ECONOMICS",
    errorCode: VISUAL_MARKET_RECAPTURE_ERROR_CODES.has(
      text(evidence.visualMarketEvidenceReason),
    )
      ? text(evidence.visualMarketEvidenceReason)
      : "SAME_DAY_IMAGE_MARKET_BRIEF_REQUIRED",
    recoveryOrigin: "REJECTED_HISTORY_REPAIR",
    now,
  })
  const { error } = await supabase.from("ebay_same_day_pilot_events").upsert({
    run_id: state.run.id,
    candidate_id: candidate.id,
    event_type: "STALE_VISUAL_AUTO_RESUME_ORPHAN_REPAIRED",
    event_payload: {
      recoveryVersion: STALE_VISUAL_AUTO_RESUME_RECOVERY_VERSION,
      previousState: "CALCULATING_ECONOMICS",
      restoredState: "WAITING_PRODUCT_RESEARCH_CAPTURE",
      supersededCaptureBatchId:
        evidence.supersededVisualCaptureBatchId ?? null,
      commercialEvidencePreserved: true,
      productFactsPreserved: true,
      productApprovalPreservedForRevalidation: true,
      historyDeleted: false,
    },
    idempotency_key: [
      state.run.id,
      candidate.id,
      STALE_VISUAL_AUTO_RESUME_RECOVERY_VERSION,
    ].join(":"),
    ebay_read_calls: 0,
    openai_calls: 0,
    ebay_writes: 0,
    production_changed: false,
  }, { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (error) {
    throw new Error("SAME_DAY_PILOT_STALE_VISUAL_AUTO_RESUME_EVENT_FAILED")
  }
  return 1
}

async function supersedeLaterTasksForVisualMarketRecovery(
  supabase: SupabaseClient,
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
  now: Date,
) {
  const priority = visualMarketRecoveryPriorityCandidate(state)
  if (!priority) return [] as string[]
  const visualFailureAt = Math.max(0, ...state.transitions
    .filter((entry) =>
      text(entry.candidate_id) === text(priority.id) &&
      text(entry.next_state) === "REJECTED" &&
      VISUAL_MARKET_RECAPTURE_ERROR_CODES.has(text(entry.reason_code)))
    .map((entry) => Date.parse(text(entry.created_at)))
    .filter(Number.isFinite))
  const competingCandidateIds = new Set(state.candidates
    .filter((candidate) =>
      text(candidate.id) !== text(priority.id))
    .map((candidate) => text(candidate.id))
    .filter(Boolean))
  const deferredTasks = state.tasks.filter((task) =>
    task.status === "OPEN" &&
    task.gate_type !== "CRITICAL_EXCEPTION_REQUIRED" &&
    competingCandidateIds.has(text(task.candidate_id)) &&
    Date.parse(text(task.created_at)) >= visualFailureAt)
  const taskIds = deferredTasks.map((task) => text(task.id)).filter(Boolean)
  if (!taskIds.length) return []
  const { error } = await supabase.from("ebay_same_day_pilot_human_tasks")
    .update({
      status: "SUPERSEDED",
      completed_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("run_id", state.run.id)
    .eq("status", "OPEN")
    .in("id", taskIds)
  if (error) {
    throw new Error("SAME_DAY_PILOT_VISUAL_RECOVERY_SUCCESSOR_TASK_DEFER_FAILED")
  }
  const { error: eventError } = await supabase
    .from("ebay_same_day_pilot_events")
    .upsert({
      run_id: state.run.id,
      candidate_id: priority.id,
      event_type: "VISUAL_MARKET_RECOVERY_SUCCESSOR_TASK_DEFERRED",
      event_payload: {
        recoveryVersion: VISUAL_MARKET_RECAPTURE_RECOVERY_VERSION,
        priorityCandidateId: priority.id,
        deferredTaskIds: taskIds,
        deferredCandidateIds: deferredTasks.map((task) => task.candidate_id),
        resumeOnlyAfterPriorityCandidateSettles: true,
        historyDeleted: false,
      },
      idempotency_key:
        `${state.run.id}:${priority.id}:VISUAL_RECOVERY_TASK_DEFER:${hash(taskIds.sort())}`,
      ebay_read_calls: 0,
      openai_calls: 0,
      ebay_writes: 0,
      production_changed: false,
    }, { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (eventError) {
    throw new Error("SAME_DAY_PILOT_VISUAL_RECOVERY_SUCCESSOR_EVENT_FAILED")
  }
  return taskIds
}

async function repairRejectedVisualMarketRecapture(
  supabase: SupabaseClient,
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
  now: Date,
) {
  if (visualMarketRecoveryPriorityCandidate(state)) return 0
  const candidates = [...state.candidates]
    .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    .filter((entry) => {
      const blockers = strings(entry.blockers)
      return entry.machine_state === "REJECTED" &&
        entry.state === "REJECTED_TODAY" &&
        blockers.length === 1 &&
        VISUAL_MARKET_BACKGROUND_RECAPTURE_ERROR_CODES.has(blockers[0])
    })
  for (const candidate of candidates) {
    const { data: imageJobs, error: imageJobsError } = await supabase
      .from("ebay_same_day_pilot_jobs")
      .select("id,status,last_error_code,checkpoint")
      .eq("run_id", state.run.id)
      .eq("candidate_id", candidate.id)
      .eq("job_type", "GENERATE_SIX_IMAGE_PACKAGE")
      .in("status", ["DEAD_LETTER", "CANCELLED", "COMPLETED"])
      .order("created_at", { ascending: false })
    if (imageJobsError) {
      throw new Error("SAME_DAY_PILOT_VISUAL_RECAPTURE_IMAGE_JOB_READ_FAILED")
    }
    const failedJob = (imageJobs ?? []).find((job) => {
      const recovery = record(
        record(job.checkpoint)._visualMarketRecaptureRecovery,
      )
      return VISUAL_MARKET_RECAPTURE_ERROR_CODES.has(
        text(job.last_error_code),
      ) || VISUAL_MARKET_RECAPTURE_ERROR_CODES.has(
        text(recovery.previousErrorCode),
      ) || (job.status === "COMPLETED" &&
        text(job.last_error_code) === "EFFECT_ALREADY_APPLIED_RECOVERED")
    })
    if (!failedJob) continue

    const candidateErrorCode = strings(candidate.blockers)[0]
    try {
      await routeCandidateToVisualMarketRecapture({
        supabase,
        state,
        candidate: record(candidate),
        previousState: "REJECTED",
        recoveryOrigin: "REJECTED_HISTORY_REPAIR",
        errorCode: VISUAL_MARKET_RECAPTURE_ERROR_CODES.has(
          text(failedJob.last_error_code),
        )
          ? text(failedJob.last_error_code)
          : VISUAL_MARKET_RECAPTURE_ERROR_CODES.has(
            text(record(
              record(failedJob.checkpoint)._visualMarketRecaptureRecovery,
            ).previousErrorCode),
          )
          ? text(record(
            record(failedJob.checkpoint)._visualMarketRecaptureRecovery,
          ).previousErrorCode)
          : candidateErrorCode,
        now,
      })
    } catch (error) {
      const code = error instanceof Error ? error.message : ""
      if (VISUAL_MARKET_RECAPTURE_UNBOUND_CANDIDATE_CODES.has(code)) {
        // Older rejected candidates may predate the durable query-task
        // binding. Preserve them unchanged and keep looking for the first
        // candidate whose exact plan, query and capture can be proved.
        continue
      }
      throw error
    }
    if (failedJob.status === "DEAD_LETTER") {
      const { error } = await supabase.from("ebay_same_day_pilot_jobs")
        .update({
          status: "CANCELLED",
          last_error_code: "SUPERSEDED_BY_VISUAL_MARKET_RECAPTURE",
          checkpoint: {
            ...record(failedJob.checkpoint),
            _visualMarketRecaptureRecovery: {
              version: VISUAL_MARKET_RECAPTURE_RECOVERY_VERSION,
              previousErrorCode: text(failedJob.last_error_code),
              recoveredAt: now.toISOString(),
              historyDeleted: false,
            },
          },
          updated_at: now.toISOString(),
        })
        .eq("id", failedJob.id)
        .eq("status", "DEAD_LETTER")
      if (error) {
        throw new Error(
          "SAME_DAY_PILOT_VISUAL_RECAPTURE_DEAD_LETTER_CANCEL_FAILED",
        )
      }
    }
    const recoveredState = await currentState(
      supabase,
      text(state.run.marketplace_account_key),
      text(state.run.operation_date),
      now,
    )
    if (recoveredState) {
      await repairSameDayPilotBootstrap(
        supabase,
        recoveredState,
        text(state.run.marketplace_account_key),
      )
    }
    await refreshRunProjection(supabase, state.run.id)
    return 1
  }
  return 0
}

async function repairRejectedSingleUnitVisualStrategy(
  supabase: SupabaseClient,
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
  now: Date,
) {
  const recoverableErrorCodes = new Set([
    "NEEDS_VERIFIED_PRODUCT_FACTS:VISUAL_STRATEGY",
    "NEEDS_MORE_VERIFIED_FACTS",
    "LUNA_CATALOG_SOURCE_PACK_STORAGE_FAILED",
    "LUNA_CATALOG_SOURCE_PACK_SAVE_FAILED",
    "SAME_DAY_IMAGE_PACKAGE_IDEMPOTENCY_CONFLICT",
    "SAME_DAY_IMAGE_SET_VISUAL_STRATEGY_V2_INVALID",
  ])
  const candidates = [...state.candidates]
    .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    .filter((candidate) => {
      const blockers = strings(candidate.blockers)
      return text(candidate.machine_state) === "REJECTED" &&
        text(candidate.state) === "REJECTED_TODAY" &&
        blockers.length === 1 &&
        recoverableErrorCodes.has(blockers[0])
    })
  for (const candidate of candidates) {
    const priorErrorCode = strings(candidate.blockers)[0]
    const factsSummary = record(candidate.product_facts_summary)
    const factsPackage = record(factsSummary.authoritativeFactsPackage)
    const handoffSummary = record(candidate.manual_handoff_package)
    let factoryInput: ReturnType<typeof buildCurrentSameDayImageFactoryInput>
    try {
      factoryInput = buildCurrentSameDayImageFactoryInput({
        handoffPackage: handoffSummary.package,
        authoritativeFactsPackage: factsPackage,
        currentBinding: {
          candidateId: text(candidate.id),
          factRunId: text(factsSummary.factRunId),
          factPackageHash: text(factsPackage.factPackageHash),
        },
      })
    } catch {
      continue
    }
    // This recovery is deliberately narrow. Visual Strategy V2 now treats an
    // exact single-unit offer as a useful PACKAGE_CONTENTS objective; products
    // with genuinely missing identity/pack facts remain rejected.
    if (factoryInput.facts.packCount !== 1 ||
      factoryInput.facts.unitCount !== 1) continue

    const { data: priorJobs, error: priorJobsError } = await supabase
      .from("ebay_same_day_pilot_jobs")
      .select("id,status,last_error_code,checkpoint")
      .eq("run_id", state.run.id)
      .eq("candidate_id", candidate.id)
      .eq("job_type", "GENERATE_SIX_IMAGE_PACKAGE")
      .in("status", ["DEAD_LETTER", "CANCELLED", "COMPLETED"])
      .order("created_at", { ascending: false })
    if (priorJobsError) {
      throw new Error("SAME_DAY_PILOT_SINGLE_UNIT_VISUAL_JOB_READ_FAILED")
    }
    const failureTransitionPresent = state.transitions.some((entry) =>
      text(entry.candidate_id) === text(candidate.id) &&
      text(entry.previous_state) === "PREPARING_IMAGE_PACKAGE" &&
      text(entry.next_state) === "REJECTED" &&
      text(entry.reason_code) === priorErrorCode)
    const priorFailurePresent = (priorJobs ?? []).some((job) =>
      text(job.last_error_code) === priorErrorCode ||
      text(record(job.checkpoint).singleUnitVisualStrategyPreviousError) ===
        priorErrorCode)
    if (!failureTransitionPresent && !priorFailurePresent) continue

    const imageJob = buildSameDayImageGenerationJobSpec({
      runId: state.run.id,
      candidateId: candidate.id,
      productResearchCaptureBatchId:
        candidate.product_research_capture_batch_id,
      factRunId: factsSummary.factRunId,
      packageHash: handoffSummary.packageHash,
      visualStrategyRecovery: true,
    })
    if (!imageJob) continue

    for (const failed of (priorJobs ?? []).filter((job) =>
      job.status === "DEAD_LETTER" &&
      text(job.last_error_code) === priorErrorCode)) {
      const { error } = await supabase.from("ebay_same_day_pilot_jobs")
        .update({
          status: "CANCELLED",
          checkpoint: {
            ...record(failed.checkpoint),
            singleUnitVisualStrategyRecoveryVersion:
              SAME_DAY_IMAGE_VISUAL_STRATEGY_RECOVERY_VERSION,
            singleUnitVisualStrategyPreviousError: priorErrorCode,
            supersededAt: now.toISOString(),
            historyDeleted: false,
          },
          updated_at: now.toISOString(),
        })
        .eq("id", failed.id)
        .eq("status", "DEAD_LETTER")
      if (error) {
        throw new Error(
          "SAME_DAY_PILOT_SINGLE_UNIT_VISUAL_DEAD_LETTER_CANCEL_FAILED",
        )
      }
    }

    await transition({
      supabase,
      runId: state.run.id,
      candidateId: text(candidate.id),
      previousState: "REJECTED",
      nextState: "PREPARING_IMAGE_PACKAGE",
      reasonCode: "SINGLE_UNIT_VISUAL_STRATEGY_RECOVERED",
      triggeredBy: "RETRY",
      checkpoint: {
        recoveryVersion: SAME_DAY_IMAGE_VISUAL_STRATEGY_RECOVERY_VERSION,
        priorErrorCode,
        verifiedOfferPackCount: 1,
        verifiedUnitCount: 1,
        factRunId: factsSummary.factRunId,
        productResearchCaptureBatchId:
          candidate.product_research_capture_batch_id,
        packageHash: handoffSummary.packageHash,
        commercialEvidencePreserved: true,
        productFactsPreserved: true,
        productApprovalPreserved: true,
        historyDeleted: false,
      },
      nextAutomaticAction:
        "Regenerar las seis estrategias desde el paquete 1 × 1 verificado.",
      nextHumanAction: "Ninguna hasta revisar las imágenes.",
      job: imageJob,
    })
    const { data: repairedCandidate, error: candidateError } = await supabase
      .from("ebay_same_day_pilot_candidates")
      .update({
        state: "READY_FOR_CONTENT",
        blockers: [],
        evidence_summary: {
          ...record(candidate.evidence_summary),
          singleUnitVisualStrategyRecoveryVersion:
            SAME_DAY_IMAGE_VISUAL_STRATEGY_RECOVERY_VERSION,
          singleUnitVisualStrategyRecoveredAt: now.toISOString(),
          productResearchRepeated: false,
        },
        image_package_summary: {
          ...record(candidate.image_package_summary),
          status: "PREPARING",
          approved: false,
          regenerationReason: "SINGLE_UNIT_OFFER_SCOPE_SUPPORTED",
          ebayWrites: 0,
        },
        updated_at: now.toISOString(),
      })
      .eq("id", candidate.id)
      .eq("run_id", state.run.id)
      .eq("machine_state", "PREPARING_IMAGE_PACKAGE")
      .select("id")
      .maybeSingle()
    if (candidateError || !repairedCandidate) {
      throw new Error("SAME_DAY_PILOT_SINGLE_UNIT_VISUAL_CANDIDATE_FAILED")
    }
    const { error: eventError } = await supabase
      .from("ebay_same_day_pilot_events")
      .upsert({
        run_id: state.run.id,
        candidate_id: candidate.id,
        event_type: "SINGLE_UNIT_VISUAL_STRATEGY_RECOVERED",
        event_payload: {
          recoveryVersion: SAME_DAY_IMAGE_VISUAL_STRATEGY_RECOVERY_VERSION,
          priorErrorCode,
          verifiedOfferPackCount: 1,
          verifiedUnitCount: 1,
          exactOfferShownOnce: true,
          fabricatedFacts: false,
          productResearchRepeated: false,
          priorJobsPreserved: (priorJobs ?? []).length,
          historyDeleted: false,
        },
        idempotency_key: `${imageJob.idempotencyKey}:EVENT`,
        ebay_read_calls: 0,
        openai_calls: 0,
        ebay_writes: 0,
        production_changed: false,
      }, { onConflict: "idempotency_key", ignoreDuplicates: true })
    if (eventError) {
      throw new Error("SAME_DAY_PILOT_SINGLE_UNIT_VISUAL_EVENT_FAILED")
    }
    await refreshRunProjection(supabase, state.run.id, true)
    return 1
  }
  return 0
}

async function repairOrphanedImagePreparation(
  supabase: SupabaseClient,
  state: NonNullable<Awaited<ReturnType<typeof currentState>>>,
  now: Date,
) {
  const candidate = state.candidates.find((entry) =>
    text(entry.machine_state) === "PREPARING_IMAGE_PACKAGE")
  if (!candidate) return 0

  const { data: imageJobs, error: imageJobsError } = await supabase
    .from("ebay_same_day_pilot_jobs")
    .select("status")
    .eq("run_id", state.run.id)
    .eq("candidate_id", candidate.id)
    .eq("job_type", "GENERATE_SIX_IMAGE_PACKAGE")
  if (imageJobsError) {
    throw new Error("SAME_DAY_PILOT_IMAGE_ORPHAN_JOB_READ_FAILED")
  }

  const handoffSummary = record(candidate.manual_handoff_package)
  const factsSummary = record(candidate.product_facts_summary)
  const openPrimaryHumanTasks = state.tasks.filter((task) =>
    task.status === "OPEN" &&
    task.gate_type !== "CRITICAL_EXCEPTION_REQUIRED").length
  if (!isSameDayImagePreparationOrphan({
    machineState: candidate.machine_state,
    handoffStatus: handoffSummary.status,
    packageHash: handoffSummary.packageHash,
    productResearchCaptureBatchId:
      candidate.product_research_capture_batch_id,
    factRunId: factsSummary.factRunId,
    openPrimaryHumanTasks,
    imageJobStatuses: (imageJobs ?? []).map((job) => job.status),
  })) return 0

  const job = buildSameDayImageGenerationJobSpec({
    runId: state.run.id,
    candidateId: candidate.id,
    productResearchCaptureBatchId:
      candidate.product_research_capture_batch_id,
    factRunId: factsSummary.factRunId,
    packageHash: handoffSummary.packageHash,
    orphanRecovery: true,
  })
  if (!job) return 0

  await enqueuePilotJob({
    supabase,
    runId: state.run.id,
    candidateId: text(candidate.id),
    job,
  })
  const { error: eventError } = await supabase
    .from("ebay_same_day_pilot_events")
    .upsert({
      run_id: state.run.id,
      candidate_id: candidate.id,
      event_type: "IMAGE_PREPARATION_ORPHAN_RECOVERED",
      event_payload: {
        version: SAME_DAY_IMAGE_ORPHAN_RECOVERY_VERSION,
        factRunId: factsSummary.factRunId,
        productResearchCaptureBatchId:
          candidate.product_research_capture_batch_id,
        packageHash: handoffSummary.packageHash,
        priorImageJobsPreserved: (imageJobs ?? []).length,
        recoveredAt: now.toISOString(),
        maximumOpenAiCalls: 1,
        historyDeleted: false,
      },
      idempotency_key: `${job.idempotencyKey}:EVENT`,
      ebay_read_calls: 0,
      openai_calls: 0,
      ebay_writes: 0,
      production_changed: false,
    }, { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (eventError) {
    throw new Error("SAME_DAY_PILOT_IMAGE_ORPHAN_EVENT_FAILED")
  }
  return 1
}

async function recoverDeadLetterCandidates(supabase: SupabaseClient, state: NonNullable<Awaited<ReturnType<typeof currentState>>>) {
  const { data, error } = await supabase.from("ebay_same_day_pilot_jobs")
    .select("id,candidate_id,job_type,last_error_code").eq("run_id", state.run.id).eq("status", "DEAD_LETTER")
  if (error) throw new Error("SAME_DAY_PILOT_DEAD_LETTER_READ_FAILED")
  let recovered = 0
  const handledCandidates = new Set<string>()
  for (const failed of data ?? []) {
    const candidate = state.candidates.find((entry) => entry.id === failed.candidate_id)
    if (!candidate) continue
    const candidateId = text(candidate.id)
    const candidateBlockers = strings(candidate.blockers)
    if (isSupersededRetiredV6ApprovalDeadLetter({
      failed,
      candidate,
      jobs: state.jobs,
      transitions: state.transitions,
    })) {
      const { error: cancelError } = await supabase
        .from("ebay_same_day_pilot_jobs")
        .update({
          status: "CANCELLED",
          updated_at: new Date().toISOString(),
        })
        .eq("id", failed.id)
        .eq("status", "DEAD_LETTER")
      if (cancelError) {
        throw new Error("SAME_DAY_PILOT_RETIRED_V6_DEAD_LETTER_CANCEL_FAILED")
      }
      continue
    }
    if (text(failed.job_type) === "GENERATE_SIX_IMAGE_PACKAGE" &&
      text(candidate.machine_state) === "REJECTED" &&
      candidateBlockers.length === 1 &&
      VISUAL_MARKET_RECAPTURE_ERROR_CODES.has(candidateBlockers[0])) {
      // The targeted visual-recapture repair runs before this generic lane.
      // If it could not prove its bindings, retain the dead letter for the
      // next safe retry instead of erasing the original recoverable error.
      continue
    }
    if (jobEffectAlreadyApplied(text(failed.job_type), text(candidate.machine_state))) {
      if (text(failed.job_type) === "FINALIZE_MANUAL_HANDOFF") {
        await promoteNextCandidateAfterPreparedPackage(
          supabase,
          state.run.id,
          Number(candidate.ordinal),
        )
      }
      const { error: appliedError } = await supabase.from("ebay_same_day_pilot_jobs").update({
        status: "COMPLETED", last_error_code: "EFFECT_ALREADY_APPLIED_RECOVERED",
        completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", failed.id).eq("status", "DEAD_LETTER")
      if (appliedError) throw new Error("SAME_DAY_PILOT_APPLIED_DEAD_LETTER_RECOVERY_FAILED")
      continue
    }
    if (!handledCandidates.has(candidateId)) {
      await rejectAndPromote({ supabase, runId: state.run.id, candidate: record(candidate),
        previousState: text(candidate.machine_state), reasonCode: text(failed.last_error_code) || "BACKGROUND_JOB_ATTEMPTS_EXHAUSTED" })
      handledCandidates.add(candidateId)
      recovered += 1
    }
    const { error: cancelError } = await supabase.from("ebay_same_day_pilot_jobs").update({
      status: "CANCELLED", updated_at: new Date().toISOString(),
    }).eq("id", failed.id).eq("status", "DEAD_LETTER")
    if (cancelError) throw new Error("SAME_DAY_PILOT_DEAD_LETTER_CANCEL_FAILED")
  }
  return recovered
}

async function acquirePilotRunLease(input: {
  supabase: SupabaseClient
  runId: string
  workerId: string
  now: Date
}) {
  const { data, error } = await input.supabase.rpc("acquire_same_day_pilot_run_lease", {
    p_run_id: input.runId, p_worker_id: input.workerId, p_now: input.now.toISOString(),
  })
  if (error) throw new Error("SAME_DAY_PILOT_RUN_LEASE_FAILED")
  return text(data)
}

async function releasePilotRunLease(input: {
  supabase: SupabaseClient
  runId: string
  workerId: string
  leaseToken: string
}) {
  const { data, error } = await input.supabase.rpc("release_same_day_pilot_run_lease", {
    p_run_id: input.runId, p_worker_id: input.workerId, p_lease_token: input.leaseToken,
  })
  return !error && data === true
}

export async function processSameDayPilotJobs(input: { supabase: SupabaseClient; accountKey: string; workerId: string; now?: Date }) {
  const now = input.now ?? new Date()
  // The scheduler heartbeat also reconciles expired persistent pauses, even
  // when the run is currently waiting at a human gate and has no quota job to
  // claim. This prevents an old 429 from looking active indefinitely.
  const expiredQuotaPauses = await releaseExpiredEbayQuotaPauses(input.supabase, now)
  let state = await getSameDayPilot({ supabase: input.supabase, accountKey: input.accountKey, now })
  if (!state) return { processed: 0, status: "NO_ACTIVE_RUN", expiredQuotaPausesReleased: expiredQuotaPauses.released }
  const runId = state.run.id
  const runLeaseToken = await acquirePilotRunLease({
    supabase: input.supabase, runId, workerId: input.workerId, now,
  })
  if (!runLeaseToken) return { processed: 0, status: "RUN_BUSY", expiredQuotaPausesReleased: expiredQuotaPauses.released }
  try {
  const { error: heartbeatError } = await input.supabase.from("ebay_same_day_pilot_runs").update({
    last_worker_heartbeat_at: now.toISOString(), updated_at: now.toISOString(),
  }).eq("id", state.run.id)
  if (heartbeatError) throw new Error("SAME_DAY_PILOT_WORKER_HEARTBEAT_FAILED")
  // Reconcile deployments where the versioned replacement was already
  // enqueued before its obsolete dead letter could be marked superseded.
  // This is recovery-only: no candidate, marketplace, or eBay data is written.
  const supersededAuthorityLineageDeadLetters =
    await reconcileEnqueuedAuthorityLineageRecoveryDeadLetters(
      input.supabase,
      state,
      now,
    )
  const officialBrandMarketPricingRecovered =
    await repairOfficialBrandMarketPricingGap(input.supabase, state, now)
  if (officialBrandMarketPricingRecovered) {
    state = await getSameDayPilot({ supabase: input.supabase, accountKey: input.accountKey, now })
    if (!state) return { processed: 0, status: "NO_ACTIVE_RUN" }
  }
  const repaired = await repairSameDayPilotBootstrap(
    input.supabase,
    state,
    input.accountKey,
  )
  if (repaired) {
    state = await getSameDayPilot({ supabase: input.supabase, accountKey: input.accountKey, now })
    if (!state) return { processed: 0, status: "NO_ACTIVE_RUN" }
  }
  const staleVisualAutoResumeOrphansRecovered =
    await repairStaleVisualAutoResumeOrphan(input.supabase, state, now)
  if (staleVisualAutoResumeOrphansRecovered) {
    await refreshRunProjection(input.supabase, state.run.id, true)
    return {
      processed: 1,
      status: "COMPLETED",
      jobType: "RECOVER_STALE_VISUAL_AUTO_RESUME_ORPHAN",
      staleVisualAutoResumeOrphansRecovered,
      ebayWrites: 0,
    }
  }
  const visualMarketRecapturesRecovered =
    await repairRejectedVisualMarketRecapture(input.supabase, state, now)
  if (visualMarketRecapturesRecovered) {
    await refreshRunProjection(input.supabase, state.run.id, true)
    return {
      processed: 1,
      status: "COMPLETED",
      jobType: "RECOVER_VISUAL_MARKET_RECAPTURE",
      visualMarketRecapturesRecovered,
      ebayWrites: 0,
    }
  }
  const singleUnitVisualStrategiesRecovered =
    await repairRejectedSingleUnitVisualStrategy(input.supabase, state, now)
  if (singleUnitVisualStrategiesRecovered) {
    await refreshRunProjection(input.supabase, state.run.id, true)
    return {
      processed: 1,
      status: "COMPLETED",
      jobType: "RECOVER_SINGLE_UNIT_VISUAL_STRATEGY",
      singleUnitVisualStrategiesRecovered,
      ebayWrites: 0,
    }
  }
  const orphanedImagePreparationsRecovered =
    await repairOrphanedImagePreparation(input.supabase, state, now)
  if (orphanedImagePreparationsRecovered) {
    state = await getSameDayPilot({
      supabase: input.supabase,
      accountKey: input.accountKey,
      now,
    })
    if (!state) return { processed: 0, status: "NO_ACTIVE_RUN" }
  }
  const legacyPrematureRejectionsRepaired =
    orphanedImagePreparationsRecovered ? 0 :
      await repairLegacyPrematureProductResearchRejections(
        input.supabase,
        state,
        input.accountKey,
      )
  const prematureTaxonomyRejectionsRecovered =
    orphanedImagePreparationsRecovered || legacyPrematureRejectionsRepaired ? 0 :
    await repairPrematureTaxonomyRejections(input.supabase, state, now)
  const productFactAuthorityLineageRecovered =
    orphanedImagePreparationsRecovered ||
    prematureTaxonomyRejectionsRecovered ? 0 :
    await repairRejectedProductFactAuthorityLineage(input.supabase, state, now)
  const singleFactExceptionsRecovered = orphanedImagePreparationsRecovered ||
    prematureTaxonomyRejectionsRecovered ||
    productFactAuthorityLineageRecovered ? 0 :
    await repairRejectedSingleFactException(input.supabase, state, now)
  // Repair at most one durable lane per worker cycle. Each repair can create a
  // job or human task, so later repair decisions must observe the refreshed
  // state on the following cycle instead of opening parallel operator work.
  const staleSupplyOpenAiInputsRecovered =
    orphanedImagePreparationsRecovered ||
    prematureTaxonomyRejectionsRecovered ||
    productFactAuthorityLineageRecovered || singleFactExceptionsRecovered ? 0 :
    await repairStaleSupplyOpenAiInputRejection(input.supabase, state, now)
  const staleDecisionFactsRecovered = orphanedImagePreparationsRecovered ||
    prematureTaxonomyRejectionsRecovered ||
    productFactAuthorityLineageRecovered || singleFactExceptionsRecovered ||
    staleSupplyOpenAiInputsRecovered ? 0 :
    await repairStaleDecisionProductFactsRejection(input.supabase, state, now)
  const legacyProductFactsRejectionsRepaired =
    orphanedImagePreparationsRecovered ||
    prematureTaxonomyRejectionsRecovered ||
    productFactAuthorityLineageRecovered ||
    singleFactExceptionsRecovered || staleSupplyOpenAiInputsRecovered ||
    staleDecisionFactsRecovered ? 0 :
    await repairLegacyProductFactsRejections(input.supabase, state, now)
  const staleControlledLunaConfirmationsRecovered =
    orphanedImagePreparationsRecovered ||
    prematureTaxonomyRejectionsRecovered ||
    productFactAuthorityLineageRecovered ||
    singleFactExceptionsRecovered || staleSupplyOpenAiInputsRecovered ||
    staleDecisionFactsRecovered ||
    legacyProductFactsRejectionsRepaired ? 0 :
    await repairStaleControlledLunaConfirmationRejection(
      input.supabase,
      state,
      now,
    )
  const deadLettersRecovered = orphanedImagePreparationsRecovered ||
    prematureTaxonomyRejectionsRecovered || productFactAuthorityLineageRecovered ||
    singleFactExceptionsRecovered || staleSupplyOpenAiInputsRecovered ||
    staleDecisionFactsRecovered ||
    legacyProductFactsRejectionsRepaired ||
    staleControlledLunaConfirmationsRecovered ? 0 :
    await recoverDeadLetterCandidates(input.supabase, state)
  if (legacyPrematureRejectionsRepaired || prematureTaxonomyRejectionsRecovered ||
    productFactAuthorityLineageRecovered ||
    singleFactExceptionsRecovered || staleSupplyOpenAiInputsRecovered ||
    staleDecisionFactsRecovered ||
    legacyProductFactsRejectionsRepaired ||
    staleControlledLunaConfirmationsRecovered || deadLettersRecovered) {
    state = await getSameDayPilot({ supabase: input.supabase, accountKey: input.accountKey, now })
    if (!state) return { processed: 0, status: "NO_ACTIVE_RUN" }
  }
  const { data: claimed, error: leaseError } = await input.supabase.rpc("claim_same_day_pilot_job", {
    p_run_id: state.run.id, p_worker_id: input.workerId, p_now: now.toISOString(),
  })
  if (leaseError) throw new Error("SAME_DAY_PILOT_JOB_LEASE_FAILED")
  const leased = Array.isArray(claimed) ? claimed[0] : claimed
  if (!leased) {
    const replenishment = await replenishSettledSameDayRun({
      supabase: input.supabase, accountKey: input.accountKey, state, now,
    })
    if (replenishment.replenished > 0) {
      await refreshRunProjection(input.supabase, state.run.id, true)
      return { processed: 1, status: "COMPLETED",
        jobType: "REPLENISH_SAME_DAY_CANDIDATES", replenishment }
    }
    if (replenishment.exhausted) {
      return { processed: 0, status: "BLOCKED_NO_RECOVERABLE_CANDIDATES",
        replenishment }
    }
    await refreshRunProjection(input.supabase, state.run.id, true)
    return { processed: 0, status: "IDLE", repaired,
      supersededAuthorityLineageDeadLetters,
      officialBrandMarketPricingRecovered,
      orphanedImagePreparationsRecovered,
      legacyPrematureRejectionsRepaired, singleFactExceptionsRecovered,
      staleSupplyOpenAiInputsRecovered,
      staleDecisionFactsRecovered,
      legacyProductFactsRejectionsRepaired,
      staleControlledLunaConfirmationsRecovered,
      deadLettersRecovered }
  }
  const candidate = state.candidates.find((entry) => entry.id === leased.candidate_id)
  if (!candidate) throw new Error("SAME_DAY_PILOT_JOB_CANDIDATE_MISSING")
  if (jobEffectAlreadyApplied(text(leased.job_type), text(candidate.machine_state))) {
    if (text(leased.job_type) === "FINALIZE_MANUAL_HANDOFF") {
      await promoteNextCandidateAfterPreparedPackage(
        input.supabase,
        state.run.id,
        Number(candidate.ordinal),
      )
    }
    await settlePilotJob({ supabase: input.supabase, job: record(leased), workerId: input.workerId, status: "COMPLETED" })
    await refreshRunProjection(input.supabase, state.run.id, true)
    return { processed: 1, status: "EFFECT_ALREADY_APPLIED", jobType: leased.job_type, replayAvoided: true }
  }
  try {
    if (leased.api_family && leased.api_operation) {
      const lane = await assertEbayLaneAvailable(input.supabase, leased.api_family, leased.api_operation, now)
      if (!lane.available) {
        const resumeAt = lane.resumeAt ?? new Date(now.getTime() + 15 * 60_000).toISOString()
        await deferPilotJob({ supabase: input.supabase, job: record(leased), workerId: input.workerId, availableAt: resumeAt,
          errorCode: "EBAY_QUOTA_PAUSED_429", preserveAttempt: true })
        await promoteImmediateSuccessorDuringQuotaPause(
          input.supabase,
          state.run.id,
          Number(candidate.ordinal),
        )
        await refreshRunProjection(input.supabase, state.run.id, true)
        return { processed: 1, status: "PAUSED_429", jobType: leased.job_type, resumeAt,
          checkpointPreserved: true, ebayCalls: 0 }
      }
    }
    if (leased.job_type === "ENRICH_PRODUCT_FACTS") {
      for (const [apiFamily, operation] of PRODUCT_FACT_READ_DEPENDENCIES) {
        const dependency = await assertEbayLaneAvailable(input.supabase, apiFamily, operation, now)
        if (!dependency.available) {
          const resumeAt = dependency.resumeAt ?? new Date(now.getTime() + 15 * 60_000).toISOString()
          await deferPilotJob({ supabase: input.supabase, job: record(leased), workerId: input.workerId,
            availableAt: resumeAt, errorCode: "EBAY_QUOTA_PAUSED_429", preserveAttempt: true })
          await promoteImmediateSuccessorDuringQuotaPause(
            input.supabase,
            state.run.id,
            Number(candidate.ordinal),
          )
          await refreshRunProjection(input.supabase, state.run.id, true)
          return { processed: 1, status: "PAUSED_429", jobType: leased.job_type, resumeAt,
            pausedApiFamily: apiFamily, pausedOperation: operation, checkpointPreserved: true, ebayCalls: 0 }
        }
      }
    }

    await heartbeatPilotJob({ supabase: input.supabase, job: record(leased), workerId: input.workerId })

    if (leased.job_type === "RECONCILE_PRODUCT_RESEARCH_CAPTURE") {
      const checkpoint = record(leased.checkpoint)
      const batchId = text(checkpoint.captureBatchId)
      const supplierVariantId = text(checkpoint.supplierVariantId)
      if (!batchId || !supplierVariantId || supplierVariantId !== text(candidate.supplier_variant_id)) {
        throw new Error("SAME_DAY_PILOT_RECONCILIATION_TARGET_BINDING_INVALID")
      }
      const candidateQueryHash = productResearchPlannedQueryHash(
        record(candidate.product_research_query_plan).query,
      )
      const plannedTargetVariantIds = [...new Set(state.candidates.filter((entry) =>
        productResearchPlannedQueryHash(record(entry.product_research_query_plan).query) ===
          candidateQueryHash)
        .map((entry) => text(entry.supplier_variant_id)).filter(Boolean))]
      if (!plannedTargetVariantIds.includes(supplierVariantId)) {
        throw new Error("SAME_DAY_PILOT_RECONCILIATION_PLANNED_TARGET_MISSING")
      }
      const [decisionResult, coverageResult] = await Promise.all([
        input.supabase.from("marketplace_product_research_capture_observations")
          .select("id,average_sold_price,average_shipping,confirmed_sold_quantity,last_sold_date,listing_format")
          .eq("capture_batch_id", batchId)
          .eq("marketplace_account_key", input.accountKey).eq("marketplace", MARKETPLACE)
          .eq("evidence_reviewed", true)
          .eq("quality_status", "VALID")
          .order("confirmed_sold_quantity", { ascending: false })
          .limit(SAME_DAY_RECONCILIATION_DECISION_REFERENCE_LIMIT),
        input.supabase.from("marketplace_product_research_capture_observations")
          .select("id")
          .eq("capture_batch_id", batchId)
          .eq("marketplace_account_key", input.accountKey).eq("marketplace", MARKETPLACE)
          .eq("evidence_reviewed", true)
          .eq("quality_status", "VALID")
          .order("created_at", { ascending: true })
          .limit(SAME_DAY_RECONCILIATION_COVERAGE_ROW_LIMIT),
      ])
      if (decisionResult.error || coverageResult.error) {
        throw new Error("SAME_DAY_PILOT_RECONCILIATION_OBSERVATION_READ_FAILED")
      }
      const decisionObservations = (decisionResult.data ?? []).map((row) => record(row))
      const decisionObservationIds = decisionObservations.map((row) => text(row.id)).filter(Boolean)
      const decisionObservationIdSet = new Set(decisionObservationIds)
      const coverageObservationIds = (coverageResult.data ?? [])
        .map((row) => text(row.id)).filter(Boolean)
      if (!coverageObservationIds.length) {
        await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
          previousState: "RECONCILING_IDENTITY", reasonCode: "CANDIDATE_CAPTURE_REFERENCES_MISSING" })
      } else {
        const reconciled = await reconcileProductResearchObservations({
          supabase: input.supabase, accountKey: input.accountKey,
          observationIds: coverageObservationIds,
          targetSupplierVariantIds: plannedTargetVariantIds,
          tradingObservationIds: decisionObservationIds.slice(
            0,
            SAME_DAY_TRADING_DETAIL_READ_LIMIT_PER_BATCH,
          ),
          maxTradingReadsPerBatch: SAME_DAY_TRADING_DETAIL_READ_LIMIT_PER_BATCH,
          now,
        })
        const exactIdentityResults = reconciled.results.filter((result) =>
          result.classification === "EXACT_LUNA_MATCH" &&
          result.supplierVariantId === supplierVariantId)
        const exactIdentityObservationIds = new Set(exactIdentityResults
          .map((result) => text(result.observationId)).filter(Boolean))
        const exactSoldObservationIds = new Set(exactIdentityResults.filter((result) =>
          Number(result.soldExactCountImpact ?? 0) > 0,
        ).map((result) => text(result.observationId)).filter(Boolean))
        const marketReferenceObservationIds = new Set([...exactSoldObservationIds]
          .filter((observationId) => decisionObservationIdSet.has(observationId)))
        const reconciledExactRows = decisionObservations
          .filter((row) => marketReferenceObservationIds.has(text(row.id)))
        const marketReference = exactSoldMarketReference(reconciledExactRows)
        const relatedPackResults = reconciled.results.filter((result) =>
          result.classification === "SAME_PRODUCT_DIFFERENT_PACK" &&
          result.supplierVariantId === supplierVariantId &&
          Number(result.packIntelligenceImpact ?? 0) > 0)
        const relatedSizeResults = reconciled.results.filter((result) =>
          result.classification === "SAME_PRODUCT_DIFFERENT_SIZE" &&
          result.supplierVariantId === supplierVariantId &&
          Number(result.packIntelligenceImpact ?? 0) > 0)
        const selectionIdentity = record(record(candidate.evidence_summary).selectionIdentity)
        const nativePackCount = number(record(
          record(candidate.local_preparation_package).offer,
        ).nativePackCount) ?? number(selectionIdentity.nativePackCount) ??
          number(relatedPackResults[0]?.candidatePackCount)
        const relatedPackStrategy = relatedPackStrategyFromReconciliation(
          relatedPackResults, nativePackCount,
          number(record(candidate.economics_summary).confirmedLunaPrice),
        )
        const commercialRoute = resolveSameDayCommercialEvidenceMode({
          historicalMarketCheckCompleted: true,
          confirmedSoldExact: exactSoldObservationIds.size,
          identityVerifiedIndependently: exactIdentityResults.length > 0 ||
            selectionIdentity.independentlyVerified === true,
          exactOfferPackVerified: exactIdentityResults.length > 0 ||
            selectionIdentity.exactOfferPackVerified === true,
          relatedPackConflict: relatedPackResults.length > 0,
          relatedSizeConflict: relatedSizeResults.length > 0,
        })
        const controlledIdentityEvidenceHash = text(selectionIdentity.evidenceHash) ||
          (exactIdentityObservationIds.size > 0
            ? versionedHash({ supplierVariantId,
                exactIdentityObservationIds: [...exactIdentityObservationIds].sort(),
                reconciliationVersion: PRODUCT_RESEARCH_IDENTITY_RECONCILIATION_VERSION })
            : null)
        const commercialEvidenceHash = versionedHash({
          batchId, supplierVariantId, candidateQueryHash,
          exactIdentityObservationIds: [...exactIdentityObservationIds].sort(),
          exactSoldObservationIds: [...exactSoldObservationIds].sort(),
          relatedPackCount: relatedPackResults.length,
          relatedSizeCount: relatedSizeResults.length,
          mode: commercialRoute.mode,
          version: "SAME_DAY_COMMERCIAL_EVIDENCE_V1",
        })
        const reconciliationEvidenceSummary = { ...record(candidate.evidence_summary),
          evidenceTiers: {
            exactIdentityMatches: exactIdentityObservationIds.size,
            confirmedSoldExact: exactSoldObservationIds.size,
            confirmedSoldRelatedPack: relatedPackResults.length,
            confirmedSoldRelatedSize: relatedSizeResults.length,
            broadSearchOnlyPromoted: false,
          },
          historicalMarketCheckStatus: exactSoldObservationIds.size > 0
            ? "COMPLETED_WITH_EXACT_SOLD"
            : commercialRoute.mode === "CONTROLLED_EXPLORATORY_TEST"
              ? "COMPLETED_NO_EXACT_SOLD"
              : "COMPLETED_IDENTITY_UNRESOLVED",
          historicalMarketCheckedAt: now.toISOString(),
          commercialEvidenceMode: commercialRoute.mode,
          commercialEvidenceVersion: "SAME_DAY_COMMERCIAL_EVIDENCE_V1",
          commercialEvidenceHash,
          controlledIdentityEvidenceHash,
          commercialEvidenceBlockers: commercialRoute.blockers,
          controlledTestPlan: commercialRoute.mode === "CONTROLLED_EXPLORATORY_TEST"
            ? { listingQuantity: 1, commercialMonitorRequired: true,
                oneVariableAtATime: true, automaticPricingAllowed: false,
                manualPublicationRequired: true }
            : null,
          relatedPackStrategy,
          relatedSizeSampleSize: relatedSizeResults.length,
          reconciliationCoverage: {
            reviewedObservations: coverageObservationIds.length,
            eventsProcessed: reconciled.observationsProcessed,
            decisionReferences: decisionObservationIds.length,
            decisionReferenceLimit: SAME_DAY_RECONCILIATION_DECISION_REFERENCE_LIMIT,
            targetSupplierVariantScoped: true,
            plannedTargetVariantCount: plannedTargetVariantIds.length,
            officialCallBudget: reconciled.officialCallBudget,
            version: PRODUCT_RESEARCH_IDENTITY_RECONCILIATION_VERSION,
          } }
        const { error: coverageUpdateError } = await input.supabase
          .from("ebay_same_day_pilot_candidates").update({
            evidence_summary: reconciliationEvidenceSummary,
            updated_at: now.toISOString(),
          }).eq("id", candidate.id).eq("run_id", state.run.id)
        if (coverageUpdateError) throw new Error("SAME_DAY_PILOT_RECONCILIATION_COVERAGE_UPDATE_FAILED")
        if (exactSoldObservationIds.size <= 0 || !reconciled.reanalysis.runId || !reconciled.reanalysis.shouldSchedule) {
          if (reconciled.reanalysis.runId && reconciled.reanalysis.shouldSchedule) {
            // Related pack/size evidence can refresh Loop 1 pack intelligence,
            // but it never promotes the same-day candidate as an exact match.
            await enqueueListingAiTop20Continuation({
              supabase: input.supabase, runId: reconciled.reanalysis.runId,
              continuationGeneration: reconciled.reanalysis.continuationGeneration,
              expectedBatch: reconciled.reanalysis.expectedBatch,
            })
          }
          if (relatedPackResults.length > 0) {
            await blockRelatedPresentationAndPromote({ supabase: input.supabase,
              runId: state.run.id, candidate: record(candidate),
              previousState: "RECONCILING_IDENTITY",
              reasonCode: "RELATED_PACK_STRATEGY_RETAINED",
              blockers: ["CUSTOM_PRESENTATION_ECONOMICS_REQUIRED",
                "LUNA_PACKAGING_CONFIGURATION_REQUIRED"] })
          } else if (relatedSizeResults.length > 0) {
            await blockRelatedPresentationAndPromote({ supabase: input.supabase,
              runId: state.run.id, candidate: record(candidate),
              previousState: "RECONCILING_IDENTITY",
              reasonCode: "RELATED_SIZE_STRATEGY_RETAINED",
              blockers: ["RELATED_SIZE_IS_NOT_EXACT_OFFER",
                "EXACT_PRODUCT_PRESENTATION_REQUIRED"] })
          } else if (commercialRoute.mode === "CONTROLLED_EXPLORATORY_TEST" &&
            text(candidate.queue_item_id)) {
            const existingLunaConfirmation = record(
              record(candidate.economics_summary).lunaConfirmation,
            )
            const lunaAlreadyConfirmed = text(existingLunaConfirmation.status)
              .startsWith("AVAILABLE_") &&
              Number(record(candidate.economics_summary).confirmedLunaPrice) > 0
            if (lunaAlreadyConfirmed) {
              await transition({ supabase: input.supabase, runId: state.run.id,
                candidateId: candidate.id, previousState: "RECONCILING_IDENTITY",
                nextState: "CALCULATING_ECONOMICS",
                reasonCode: "CONTROLLED_TEST_LUNA_ALREADY_CONFIRMED_AUTO_RESUME",
                triggeredBy: "SYSTEM",
                checkpoint: {
                  confirmedLunaPrice: record(candidate.economics_summary).confirmedLunaPrice,
                  quantityKnown: record(candidate.economics_summary).quantityUnknown !== true,
                },
                nextAutomaticAction: "Calcular economía localmente.",
                nextHumanAction: "Ninguna.",
                job: { jobType: "CALCULATE_ECONOMICS",
                  idempotencyKey: `${state.run.id}:${candidate.id}:CALCULATE_ECONOMICS:${leased.id}`,
                  checkpoint: {
                    confirmedLunaPrice: record(candidate.economics_summary).confirmedLunaPrice,
                    quantityKnown: record(candidate.economics_summary).quantityUnknown !== true,
                  } },
              })
            } else {
              await createLunaGate(input.supabase, state.run.id, record(candidate),
                "RECONCILING_IDENTITY")
            }
          } else {
            await rejectAndPromote({ supabase: input.supabase, runId: state.run.id,
              candidate: record(candidate), previousState: "RECONCILING_IDENTITY",
              reasonCode: commercialRoute.mode === "CONTROLLED_EXPLORATORY_TEST"
                ? "CONTROLLED_TEST_QUEUE_BINDING_MISSING"
                : "OFFICIAL_IDENTITY_RECONCILIATION_NOT_EXACT" })
          }
        } else {
          const { error: evidenceUpdateError } = await input.supabase.from("ebay_same_day_pilot_candidates").update({
            evidence_summary: { ...reconciliationEvidenceSummary,
              reconciledExactObservationCount: exactSoldObservationIds.size,
              exactSoldMarketReference: marketReference,
              exactSoldMarketReferenceReconciledAt: now.toISOString(),
              exactSoldMarketReferenceSource: "FINAL_IDENTITY_RECONCILIATION" },
            updated_at: now.toISOString(),
          }).eq("id", candidate.id).eq("run_id", state.run.id)
          if (evidenceUpdateError) throw new Error("SAME_DAY_PILOT_RECONCILED_EVIDENCE_UPDATE_FAILED")
          await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
            previousState: "RECONCILING_IDENTITY", nextState: "MATCHING_LUNA", reasonCode: "IDENTITY_RECONCILIATION_COMPLETED",
            triggeredBy: "SYSTEM", checkpoint: { captureBatchId: batchId,
              references: decisionObservationIds.length,
              reconciliationCoverage: coverageObservationIds.length,
              exactLunaMatches: exactIdentityObservationIds.size }, nextAutomaticAction: "Ejecutar Loop 1 para este candidato.", nextHumanAction: "Ninguna." })
          const dispatched = await enqueueListingAiTop20Continuation({
            supabase: input.supabase, runId: reconciled.reanalysis.runId,
            continuationGeneration: reconciled.reanalysis.continuationGeneration,
            expectedBatch: reconciled.reanalysis.expectedBatch,
          })
          await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
            previousState: "MATCHING_LUNA", nextState: "RUNNING_LOOP_1", reasonCode: "EXACT_LUNA_MATCH_CONFIRMED",
            triggeredBy: "SYSTEM", checkpoint: { captureBatchId: batchId, queueRunId: reconciled.reanalysis.runId },
            nextAutomaticAction: "Esperar el resultado candidato-específico de Loop 1.", nextHumanAction: "Ninguna.",
            job: { jobType: "WAIT_FOR_LOOP1_REANALYSIS",
              idempotencyKey: `${state.run.id}:${candidate.id}:WAIT_FOR_LOOP1_REANALYSIS:${batchId}`,
              checkpoint: { ...checkpoint, queueRunId: reconciled.reanalysis.runId,
                reconciliationReferences: decisionObservationIds.length,
                reconciliationCoverage: coverageObservationIds.length,
                dispatchStatus: dispatched.status },
              availableAt: new Date(now.getTime() + 60_000).toISOString(), maxAttempts: 10 } })
        }
      }
    } else if (leased.job_type === "WAIT_FOR_LOOP1_REANALYSIS") {
      const checkpoint = record(leased.checkpoint)
      const queueRunId = text(checkpoint.queueRunId)
      const supplierVariantId = text(checkpoint.supplierVariantId)
      const { data: target, error: targetError } = await input.supabase
        .from("marketplace_listing_approval_queue_scan_targets")
        .select("status,evidence_reanalysis_requested_at,evidence_reanalysis_completed_at,last_error_code")
        .eq("run_id", queueRunId).eq("marketplace_account_key", input.accountKey)
        .eq("supplier_variant_id", supplierVariantId).limit(1).maybeSingle()
      if (targetError) throw new Error("SAME_DAY_PILOT_LOOP1_TARGET_READ_FAILED")
      const requestedAt = Date.parse(text(target?.evidence_reanalysis_requested_at))
      const completedAt = Date.parse(text(target?.evidence_reanalysis_completed_at))
      if (!target || !Number.isFinite(completedAt) || (Number.isFinite(requestedAt) && completedAt < requestedAt)) {
        const capturedAt = Date.parse(text(checkpoint.capturedAt))
        if (Number.isFinite(capturedAt) && now.getTime() - capturedAt > 6 * 60 * 60_000) {
          await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
            previousState: "RUNNING_LOOP_1", reasonCode: "LOOP1_REANALYSIS_TIMEOUT" })
        } else {
          const nextCheck = new Date(now.getTime() + 60_000).toISOString()
          await deferPilotJob({ supabase: input.supabase, job: record(leased), workerId: input.workerId, availableAt: nextCheck,
            errorCode: "LOOP1_REANALYSIS_PENDING", preserveAttempt: true })
          await refreshRunProjection(input.supabase, state.run.id, true)
          return { processed: 1, status: "WAITING_RETRY", jobType: leased.job_type,
            checkpointPreserved: true, nextCheckAt: nextCheck }
        }
      } else {
        const { data: queueItem, error: queueItemError } = await input.supabase
          .from("marketplace_listing_approval_queue_items").select("id,luna_match_status,internal_status,evidence_snapshot,analyzed_at")
          .eq("run_id", queueRunId).eq("marketplace_account_key", input.accountKey)
          .eq("supplier_variant_id", supplierVariantId).order("analyzed_at", { ascending: false }).limit(1).maybeSingle()
        if (queueItemError) throw new Error("SAME_DAY_PILOT_LOOP1_ITEM_READ_FAILED")
        if (!queueItem || queueItem.luna_match_status !== "EXACT_LUNA_MATCH" || queueItem.internal_status === "REANALYSIS_REQUIRED") {
          await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
            previousState: "RUNNING_LOOP_1", reasonCode: "LOOP1_EXACT_IDENTITY_NOT_CONFIRMED" })
        } else {
          const evidence = record(queueItem.evidence_snapshot)
          const market = record(evidence.market)
          const { error: updateError } = await input.supabase.from("ebay_same_day_pilot_candidates").update({
            queue_item_id: queueItem.id,
            evidence_summary: { ...record(candidate.evidence_summary), exactIdentityConfirmed: true,
              soldExactCount: number(market.soldExactCount) ?? 0, loop1AnalyzedAt: queueItem.analyzed_at },
            updated_at: new Date().toISOString(),
          }).eq("id", candidate.id).eq("run_id", state.run.id)
          if (updateError) throw new Error("SAME_DAY_PILOT_LOOP1_LINK_FAILED")
          const confirmation = record(candidate.economics_summary)
          if (Number(confirmation.confirmedLunaPrice) > 0 && confirmation.available === true) {
            await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
              previousState: "RUNNING_LOOP_1", nextState: "CALCULATING_ECONOMICS", reasonCode: "LOOP1_REANALYSIS_COMPLETED_AUTO_RESUME",
              triggeredBy: "SYSTEM", nextAutomaticAction: "Calcular economía localmente.", nextHumanAction: "Ninguna.",
              job: { jobType: "CALCULATE_ECONOMICS",
                idempotencyKey: `${state.run.id}:${candidate.id}:CALCULATE_ECONOMICS:${leased.id}`,
                checkpoint: { confirmedLunaPrice: confirmation.confirmedLunaPrice,
                  quantityKnown: confirmation.quantityUnknown !== true } } })
          } else {
            await createLunaGate(input.supabase, state.run.id, record(candidate), "RUNNING_LOOP_1")
          }
        }
      }
    } else if (leased.job_type === "CALCULATE_ECONOMICS") {
      const confirmation = { ...record(candidate.economics_summary), ...record(leased.checkpoint) }
      const confirmedLunaPrice = number(confirmation.confirmedLunaPrice)
      const economics = calculateEbayMinimumOperatorPrice({ supplierCost: confirmedLunaPrice }, ebayDraftOnlyEconomicsConfig())
      const { error: economicsUpdateError } = await input.supabase.from("ebay_same_day_pilot_candidates").update({
        economics_summary: { ...record(candidate.economics_summary), ...economics,
          confirmedLunaPrice, available: true,
          quantityUnknown: confirmation.quantityKnown !== true, status: "AWAITING_OPERATOR_PRICE",
          automaticPricingUsed: false, competitorPriceUsedForRecommendation: false },
        updated_at: new Date().toISOString(),
      }).eq("id", candidate.id)
      if (economicsUpdateError) throw new Error("SAME_DAY_PILOT_ECONOMICS_UPDATE_FAILED")
      if (!economics.ready) {
        await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
          previousState: "CALCULATING_ECONOMICS", reasonCode: "LUNA_COST_REQUIRED_FOR_ECONOMICS",
          blockers: ["LUNA_COST_REQUIRED_FOR_ECONOMICS"] })
      } else if (!candidate.queue_item_id) {
        await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
          previousState: "CALCULATING_ECONOMICS", reasonCode: "EXACT_TOP20_QUEUE_IDENTITY_MISSING" })
      } else {
        await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id, previousState: "CALCULATING_ECONOMICS",
          nextState: "ENRICHING_PRODUCT_FACTS", reasonCode: "OWN_COST_FLOOR_CALCULATED_OPERATOR_PRICE_PENDING", triggeredBy: "SYSTEM",
          checkpoint: { minimumOperatorPrice: economics.minimumOperatorPrice, automaticPricingUsed: false },
          nextAutomaticAction: "Resolver Product Facts, Taxonomy y regulación.", nextHumanAction: "Ninguna.",
          job: { jobType: "ENRICH_PRODUCT_FACTS",
            idempotencyKey: `${state.run.id}:${candidate.id}:ENRICH_PRODUCT_FACTS:${leased.id}:${PRODUCT_FACTS_ENGINE_VERSION}`,
            checkpoint: { queueItemId: candidate.queue_item_id }, maxAttempts: 10,
            apiFamily: "BROWSE", apiOperation: "EXACT_VERIFICATION", ownerLane: "P1_EXACT_VERIFICATION" } })
      }
    } else if (leased.job_type === "ENRICH_PRODUCT_FACTS") {
      if (!candidate.queue_item_id) throw new Error("SAME_DAY_PILOT_FACT_QUEUE_ITEM_MISSING")
      let productFactsState = text(candidate.machine_state)
      let summary = record(candidate.product_facts_summary)
      if (productFactsState === "ENRICHING_PRODUCT_FACTS") {
        const marketEvidence = record(candidate.evidence_summary)
        const lunaSupplyFreshness = lunaSupplyFreshnessAdvisory(
          record(candidate),
          now,
        )
        const selectionIdentity = record(marketEvidence.selectionIdentity)
        const lunaConfirmation = record(record(candidate.economics_summary).lunaConfirmation)
        const controlledExploratoryTarget = ["CONTROLLED_EXPLORATORY_TEST", "MARKET_VALIDATED"]
          .includes(text(marketEvidence.commercialEvidenceMode))
          ? {
              candidateId: text(candidate.queue_item_id),
              supplierVariantId: text(candidate.supplier_variant_id),
              identityEvidenceHash: text(marketEvidence.controlledIdentityEvidenceHash),
              commercialEvidenceHash: text(marketEvidence.commercialEvidenceHash),
              historicalMarketCheckCompleted: true as const,
              exactOfferPackVerified: true as const,
              confirmedNativePackCount: number(selectionIdentity.nativePackCount) ?? 0,
              lunaConfirmedAt: text(lunaConfirmation.confirmedAt),
            }
          : undefined
        await refreshCandidateDecisionBeforeProductFacts({
          supabase: input.supabase,
          accountKey: input.accountKey,
          actorId: text(state.run.created_by),
          candidate: record(candidate),
          now,
        })
        const factRun = await runProductFactsEnrichment({ supabase: input.supabase, accountKey: input.accountKey,
          candidateIds: [candidate.queue_item_id], controlledExploratoryTarget })
        await heartbeatPilotJob({ supabase: input.supabase, job: record(leased), workerId: input.workerId })
        const currentResult = factRun.candidateResults.find((result) => result.candidateId === candidate.queue_item_id)
        const evidenceBinding = currentResult?.evidenceBinding
        if (factRun.candidatesRequested !== 1 || factRun.candidatesProcessed !== 1 || currentResult?.status !== "PREPARED" ||
          evidenceBinding?.currentRunBound !== true || evidenceBinding.factRunId !== factRun.runId ||
          evidenceBinding.sourceSnapshotLinks < 1 || evidenceBinding.observationLinks < 1 ||
          evidenceBinding.resolutionLinks < 1 || evidenceBinding.readinessEventLinks < 1) {
          await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
            previousState: "ENRICHING_PRODUCT_FACTS", reasonCode: "CURRENT_PRODUCT_FACT_RUN_INCOMPLETE",
            blockers: [text(currentResult?.reason) || "PRODUCT_FACTS_PARTIAL_OR_EXCLUDED"] })
          productFactsState = "REJECTED"
        } else {
          const currentEconomics = record(candidate.economics_summary)
          const controlledRiskFloor = calculateEbayMinimumOperatorPrice({
            supplierCost: number(currentEconomics.confirmedLunaPrice) ?? 0,
          }, controlledRiskEconomicsConfig(ebayDraftOnlyEconomicsConfig()))
          const pricingRecommendation = buildEbayMarketPricingRecommendation({
            minimumOperatorPrice: number(currentEconomics.minimumOperatorPrice),
            controlledRiskMinimumPrice: controlledRiskFloor.ready
              ? controlledRiskFloor.minimumOperatorPrice : null,
            marketPricing: currentResult.marketPricing,
            exactSoldMarketReference: record(candidate.evidence_summary).exactSoldMarketReference,
            confirmedRelatedPackStrategy:
              record(candidate.evidence_summary).relatedPackStrategy,
            variationAspectNames: currentResult.taxonomy?.variationAspects,
            controlledExploratoryTest: text(record(candidate.evidence_summary).commercialEvidenceMode) ===
              "CONTROLLED_EXPLORATORY_TEST",
          })
          const nextEconomics = {
            ...currentEconomics,
            pricingRecommendation,
            recommendedSalePrice: pricingRecommendation.recommendedSalePrice,
            status: pricingRecommendation.marketReferenceUsed
              ? pricingRecommendation.controlledRiskActiveMarketFallbackUsed
                ? "CONTROLLED_RISK_PRICE_PENDING_APPROVAL"
                : pricingRecommendation.competitiveness === "NOT_COMPETITIVE"
                  ? "COST_NOT_COMPETITIVE"
                  : "PRICE_RECOMMENDED_PENDING_APPROVAL"
              : pricingRecommendation.controlledExploratoryFloorUsed
                ? "CONTROLLED_TEST_PRICE_PENDING_APPROVAL"
                : "MARKET_REFERENCE_PENDING",
            automaticPricingUsed: false,
            automaticPricingRecommendationUsed: pricingRecommendation.marketReferenceUsed ||
              pricingRecommendation.controlledExploratoryFloorUsed,
            competitorPriceUsedForRecommendation: pricingRecommendation.marketReferenceUsed,
            individualCompetitorPriceCopied: false,
          }
          summary = {
            factRunId: factRun.runId, status: currentResult.status, gates: currentResult.gates ?? {},
            exception: currentResult.exception ?? null, counts: currentResult.factCounts ?? {},
            requirements: currentResult.requirementCounts ?? {}, resolvedFacts: currentResult.resolvedFacts ?? [],
            authoritativeFactsPackage: currentResult.authoritativeFactsPackage ?? null,
            resolvedRequirements: currentResult.resolvedRequirements ?? [], taxonomy: currentResult.taxonomy ?? {},
            marketPricing: currentResult.marketPricing ?? null,
            pricingRecommendation,
            evidenceBinding,
            observedAt: new Date().toISOString(),
            currentRunBound: true, openAiCalls: 0, ebayWrites: 0,
          }
          const { error: summaryError } = await input.supabase.from("ebay_same_day_pilot_candidates")
            .update({ product_facts_summary: summary, economics_summary: nextEconomics,
              evidence_summary: {
                ...marketEvidence,
                lunaSupplyFreshness,
              },
              updated_at: new Date().toISOString() }).eq("id", candidate.id)
          if (summaryError) throw new Error("SAME_DAY_PILOT_FACT_SUMMARY_UPDATE_FAILED")
          Object.assign(candidate, {
            economics_summary: nextEconomics,
            evidence_summary: {
              ...marketEvidence,
              lunaSupplyFreshness,
            },
          })
        }
      }
      if (productFactsState === "ENRICHING_PRODUCT_FACTS") {
        await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id, previousState: "ENRICHING_PRODUCT_FACTS",
          nextState: "VALIDATING_TAXONOMY", reasonCode: "PRODUCT_FACTS_ENRICHED", triggeredBy: "SYSTEM",
          nextAutomaticAction: "Validar regulación.", nextHumanAction: "Ninguna." })
        productFactsState = "VALIDATING_TAXONOMY"
      }
      if (!["REJECTED", "BLOCKED"].includes(productFactsState) &&
        (!text(summary.factRunId) || summary.status !== "PREPARED" || summary.currentRunBound !== true)) {
        throw new Error("SAME_DAY_PILOT_CURRENT_FACT_SUMMARY_MISSING")
      }
      const gates = record(summary.gates)
      const taxonomyReady = gates.EBAY_ASPECTS_READY === true
      const regulatoryReady = gates.REGULATORY_READY === true
      const openAiReady = gates.OPENAI_INPUT_READY === true
      const shippingEstimateReady = gates.SHIPPING_ESTIMATE_READY === true
      const contentShippingReady = shippingEstimateReady ||
        conservativeShippingReserveReady(candidate)
      const exceptionStatus = text(record(summary.exception).blockingStatus)
      const missingBlockingAspects = Number(record(summary.requirements).MISSING_BLOCKING ?? 0)
      if (productFactsState === "VALIDATING_TAXONOMY") {
        if (!taxonomyReady) {
          const singleFactException = recoverableOfferPackException(candidate, summary) ??
            recoverableSingleFactException(summary) ??
            recoverableTaxonomyException(summary)
          if (singleFactException) {
            const exceptionEvidence = {
              ...record(candidate.evidence_summary),
              singleFactExceptionRecoveryVersion: SINGLE_FACT_EXCEPTION_VERSION,
              singleFactExceptionOpenedAt: new Date().toISOString(),
              singleFactExceptionField: singleFactException.aspectName,
              fullCatalogRescan: false,
            }
            const { error: exceptionUpdateError } = await input.supabase
              .from("ebay_same_day_pilot_candidates")
              .update({ state: "NEEDS_ONE_CRITICAL_FACT", blockers: [],
                evidence_summary: exceptionEvidence,
                next_automated_action: "Reanudar Product Facts después de la confirmación puntual.",
                next_human_action: `Confirmar ${singleFactException.label} desde una fuente visible autorizada.`,
                updated_at: new Date().toISOString() })
              .eq("id", candidate.id).eq("run_id", state.run.id)
              .eq("machine_state", "VALIDATING_TAXONOMY")
            if (exceptionUpdateError) throw new Error("SAME_DAY_PILOT_SINGLE_FACT_TASK_UPDATE_FAILED")
            await createHumanTask({ supabase: input.supabase, runId: state.run.id,
              candidateId: text(candidate.id), expectedState: "VALIDATING_TAXONOMY",
              gateType: "CRITICAL_EXCEPTION_REQUIRED",
              title: `Confirma únicamente: ${singleFactException.label}`,
              why: singleFactException.actionType === "CONFIRM_OFFICIAL_OFFER_PACK"
                ? "Seller OS conserva la identidad exacta, pero encontró una contradicción entre la presentación confirmada y los datos del producto."
                : `eBay exige ${singleFactException.aspectName}. Seller OS revisó Luna, Catalog y Taxonomy, pero no encontró un valor estructurado verificable.`,
              seconds: 45,
              impact: "Seller OS guardará sólo el fact confirmado con procedencia, repetirá Product Facts para este candidato y continuará automáticamente.",
              evidence: { fieldRequired: singleFactException.aspectName,
                remainingBlockingFields: singleFactException.remainingBlockingFields,
                currentValue: "currentValue" in singleFactException
                  ? singleFactException.currentValue : null,
                explicitTitlePackCount: "explicitTitlePackCount" in singleFactException
                  ? singleFactException.explicitTitlePackCount : null,
                sourcesAlreadyChecked: ["Luna exact variant", "eBay Catalog oficial", "eBay Taxonomy oficial",
                  "fuente pública oficial del fabricante cuando existe"] },
              actionSchema: { type: singleFactException.actionType,
                factScope: singleFactException.factScope,
                factKey: singleFactException.factKey,
                fieldRequired: singleFactException.aspectName,
                fieldLabel: singleFactException.label,
                selectionOnly: singleFactException.selectionOnly,
                allowedValuesComplete: singleFactException.allowedValuesComplete,
                allowedValues: singleFactException.allowedValues,
                regulatoryFact: "regulatoryFact" in singleFactException &&
                  singleFactException.regulatoryFact === true,
                requiresVisibleOfficialLabel: true },
              continuationJobType: "ENRICH_PRODUCT_FACTS" })
          } else {
            await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
              previousState: "VALIDATING_TAXONOMY", reasonCode: "EBAY_REQUIRED_ASPECTS_NOT_READY_TODAY",
              blockers: [missingBlockingAspects > 0 ? "MISSING_BLOCKING" : "EBAY_TAXONOMY_NOT_READY"] })
            productFactsState = "REJECTED"
          }
        } else {
          await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id, previousState: "VALIDATING_TAXONOMY",
            nextState: "VALIDATING_REGULATION", reasonCode: "TAXONOMY_REQUIREMENTS_RESOLVED", triggeredBy: "SYSTEM",
            nextAutomaticAction: "Validar regulación con facts resueltos.", nextHumanAction: "Ninguna." })
          productFactsState = "VALIDATING_REGULATION"
        }
      }
      if (productFactsState === "VALIDATING_REGULATION") {
        if (!regulatoryReady) {
          const regulatoryException = recoverableRegulatoryFactException(summary)
          if (regulatoryException) {
            const exceptionEvidence = {
              ...record(candidate.evidence_summary),
              singleFactExceptionRecoveryVersion: SINGLE_FACT_EXCEPTION_VERSION,
              singleFactExceptionOpenedAt: new Date().toISOString(),
              singleFactExceptionField: regulatoryException.aspectName,
              fullCatalogRescan: false,
            }
            const { error: exceptionUpdateError } = await input.supabase
              .from("ebay_same_day_pilot_candidates")
              .update({ state: "NEEDS_ONE_CRITICAL_FACT", blockers: [],
                evidence_summary: exceptionEvidence,
                next_automated_action: "Reanudar Product Facts después de confirmar la evidencia regulatoria.",
                next_human_action: `Confirmar ${regulatoryException.label} desde la etiqueta o fuente oficial exacta.`,
                updated_at: new Date().toISOString() })
              .eq("id", candidate.id).eq("run_id", state.run.id)
              .eq("machine_state", "VALIDATING_REGULATION")
            if (exceptionUpdateError) throw new Error("SAME_DAY_PILOT_REGULATORY_FACT_TASK_UPDATE_FAILED")
            await createHumanTask({ supabase: input.supabase, runId: state.run.id,
              candidateId: text(candidate.id), expectedState: "VALIDATING_REGULATION",
              gateType: "CRITICAL_EXCEPTION_REQUIRED",
              title: `Confirma únicamente: ${regulatoryException.label}`,
              why: "La búsqueda automática no encontró la evidencia regulatoria exacta. La publicación permanece cerrada, pero el producto se conserva para una confirmación oficial puntual.",
              seconds: 60,
              impact: "Seller OS guardará únicamente el dato atestiguado, repetirá la validación y continuará sin afectar los otros candidatos.",
              evidence: { fieldRequired: regulatoryException.aspectName,
                remainingBlockingFields: regulatoryException.remainingBlockingFields,
                sourcesAlreadyChecked: ["Luna exact variant", "fabricante oficial", "fuente regulatoria autorizada"] },
              actionSchema: { type: regulatoryException.actionType,
                factScope: regulatoryException.factScope,
                factKey: regulatoryException.factKey,
                fieldRequired: regulatoryException.aspectName,
                fieldLabel: regulatoryException.label,
                selectionOnly: regulatoryException.selectionOnly,
                allowedValuesComplete: regulatoryException.allowedValuesComplete,
                allowedValues: regulatoryException.allowedValues,
                regulatoryFact: true,
                requiresVisibleOfficialLabel: true },
              continuationJobType: "ENRICH_PRODUCT_FACTS" })
          } else {
            await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
              previousState: "VALIDATING_REGULATION", reasonCode: "REGULATORY_NOT_READY_TODAY",
              blockers: [text(record(summary.exception).blockingStatus) || "REGULATORY_READY_FALSE"] })
            productFactsState = "REJECTED"
          }
        } else if (!openAiReady || !contentShippingReady) {
          await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
            previousState: "VALIDATING_REGULATION", reasonCode: "PRODUCT_FACTS_NOT_READY_TODAY",
            blockers: [!contentShippingReady
              ? "SHIPPING_ESTIMATE_REQUIRED_FOR_CONTENT"
              : exceptionStatus === "SHIPPING_CONFIRMATION_DEFERRED_TO_PUBLICATION"
                ? "OPENAI_INPUT_NOT_READY"
                : exceptionStatus || "OPENAI_INPUT_NOT_READY"] })
          productFactsState = "REJECTED"
        } else {
          await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id, previousState: "VALIDATING_REGULATION",
            nextState: "BUILDING_OPENAI_INPUT", reasonCode: "OPENAI_INPUT_READY", triggeredBy: "SYSTEM",
            nextAutomaticAction: "Solicitar aprobación del producto.", nextHumanAction: "Aprobar o rechazar el producto." })
          productFactsState = "BUILDING_OPENAI_INPUT"
        }
      }
      if (productFactsState === "BUILDING_OPENAI_INPUT") {
        if (!openAiReady || !contentShippingReady) {
          await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
            previousState: "BUILDING_OPENAI_INPUT", reasonCode: "PRODUCT_FACTS_NOT_READY_TODAY",
            blockers: [!contentShippingReady
              ? "SHIPPING_ESTIMATE_REQUIRED_FOR_CONTENT"
              : exceptionStatus === "SHIPPING_CONFIRMATION_DEFERRED_TO_PUBLICATION"
                ? "OPENAI_INPUT_NOT_READY"
                : exceptionStatus || "OPENAI_INPUT_NOT_READY"] })
          productFactsState = "REJECTED"
        } else if (reusableOperatorProductApproval(candidate, now)) {
          await transition({
            supabase: input.supabase,
            runId: state.run.id,
            candidateId: candidate.id,
            previousState: "BUILDING_OPENAI_INPUT",
            nextState: "GENERATING_LISTING_CONTENT",
            reasonCode: "VALID_OPERATOR_APPROVAL_PRESERVED_AFTER_TAXONOMY_RECOVERY",
            triggeredBy: "RETRY",
            checkpoint: {
              factRunId: summary.factRunId,
              operatorPriceApproved: true,
              approvalRepeated: false,
              recoveryVersion: PREMATURE_TAXONOMY_REJECTION_RECOVERY_VERSION,
              ebayWrites: 0,
            },
            nextAutomaticAction: "Construir el paquete con la aprobación vigente.",
            nextHumanAction: "Ninguna hasta revisar las imágenes.",
            job: {
              jobType: "BUILD_MANUAL_SELLER_HUB_HANDOFF",
              idempotencyKey: `${state.run.id}:${candidate.id}:BUILD_MANUAL_SELLER_HUB_HANDOFF:${summary.factRunId}`,
              checkpoint: {
                factRunId: summary.factRunId,
                priorApprovalPreserved: true,
                openAiCalls: 0,
                ebayWrites: 0,
              },
            },
          })
          productFactsState = "GENERATING_LISTING_CONTENT"
        } else {
          await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id, previousState: "BUILDING_OPENAI_INPUT",
            nextState: "WAITING_PRODUCT_APPROVAL", reasonCode: "PRODUCT_APPROVAL_REQUIRED", triggeredBy: "SYSTEM",
            nextAutomaticAction: "Mantener el checkpoint listo; OpenAI continúa apagado.", nextHumanAction: "Revisar y aprobar o rechazar el producto." })
          productFactsState = "WAITING_PRODUCT_APPROVAL"
        }
      }
      if (productFactsState === "WAITING_PRODUCT_APPROVAL") {
        await createHumanTask({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
          expectedState: "WAITING_PRODUCT_APPROVAL", gateType: "PRODUCT_APPROVAL_REQUIRED",
          title: "Revisa el producto y confirma su fulfillment", why: "La identidad, economía y ficha técnica pasaron; falta confirmar inventario propio o un acuerdo vigente con proveedor mayorista autorizado.",
          seconds: 180, impact: "Seller OS conservará los facts verificados; OpenAI y las escrituras eBay permanecen apagados.",
          evidence: { economics: candidate.economics_summary, facts: summary },
          actionSchema: { type: "PRODUCT_APPROVAL", actions: ["APPROVE", "REJECT"],
            fields: ["operatorSalePrice", "fulfillmentBasis", "imageRightsConfirmed",
              "openAiImageSpendApproved"],
            allowedFulfillmentBases: ["OWNED_INVENTORY", "AUTHORIZED_WHOLESALE_FULFILLMENT_AGREEMENT"],
            automaticPricingUsed: false, automaticPricingRecommendationUsed: true,
            requiresManualPriceEntry: false, humanPriceApprovalRequired: true,
            requiresMarketReference: text(record(candidate.evidence_summary).commercialEvidenceMode) !==
              "CONTROLLED_EXPLORATORY_TEST",
            presentationPortfolio: record(record(candidate.economics_summary).pricingRecommendation)
              .publicationPortfolio ?? null },
          continuationJobType: "PREPARE_VERIFIED_HANDOFF" })
      }
    } else if (leased.job_type === "BUILD_MANUAL_SELLER_HUB_HANDOFF") {
      let handoffState = text(candidate.machine_state)
      let handoffSummary = record(candidate.manual_handoff_package)
      if (handoffState === "GENERATING_LISTING_CONTENT") {
        const prepared = await prepareFactsOnlyManualHandoff({ supabase: input.supabase,
          accountKey: input.accountKey, runId: state.run.id,
          candidate: record(candidate) })
        if (!prepared.ready) {
          await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
            previousState: "GENERATING_LISTING_CONTENT", reasonCode: text(prepared.blockers[0]) || "MANUAL_HANDOFF_NOT_READY",
            blockers: prepared.blockers })
          handoffState = "REJECTED"
        } else {
          handoffSummary = record(prepared.summary)
          await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
            previousState: "GENERATING_LISTING_CONTENT", nextState: "VALIDATING_LISTING_CONTENT",
            reasonCode: "FACTS_ONLY_CONTENT_BUILT_OPENAI_ZERO", triggeredBy: "SYSTEM",
            checkpoint: { packageHash: prepared.packageHash, openAiCalls: 0, ebayWrites: 0 },
            nextAutomaticAction: "Validar el paquete y preparar imágenes Luna.", nextHumanAction: "Ninguna." })
          handoffState = "VALIDATING_LISTING_CONTENT"
        }
      }
      if (handoffState === "VALIDATING_LISTING_CONTENT") {
        if (text(handoffSummary.status) !== "AWAITING_IMAGE_APPROVAL" || !text(handoffSummary.packageHash)) {
          throw new Error("SAME_DAY_PILOT_HANDOFF_CHECKPOINT_MISSING")
        }
        await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
          previousState: "VALIDATING_LISTING_CONTENT", nextState: "PREPARING_IMAGE_PACKAGE",
          reasonCode: "FACTS_ONLY_LISTING_VALIDATED", triggeredBy: "SYSTEM",
          checkpoint: { packageHash: handoffSummary.packageHash },
          nextAutomaticAction: "Presentar imágenes autorizadas para aprobación.", nextHumanAction: "Ninguna." })
        handoffState = "PREPARING_IMAGE_PACKAGE"
      }
      if (handoffState === "PREPARING_IMAGE_PACKAGE") {
        const visualEvidenceBatchId = text(candidate.product_research_capture_batch_id)
        if (!visualEvidenceBatchId) {
          throw new Error("SAME_DAY_PILOT_IMAGE_VISUAL_EVIDENCE_BINDING_MISSING")
        }
        const imageJob = buildSameDayImageGenerationJobSpec({
          runId: state.run.id,
          candidateId: candidate.id,
          productResearchCaptureBatchId: visualEvidenceBatchId,
          factRunId: record(candidate.product_facts_summary).factRunId,
          packageHash: handoffSummary.packageHash,
        })
        if (!imageJob) {
          throw new Error("SAME_DAY_PILOT_IMAGE_LINEAGE_BINDING_INVALID")
        }
        const { error: stateUpdateError } = await input.supabase.from("ebay_same_day_pilot_candidates").update({
          state: "READY_FOR_CONTENT", updated_at: new Date().toISOString(),
        }).eq("id", candidate.id).eq("run_id", state.run.id)
        if (stateUpdateError) throw new Error("SAME_DAY_PILOT_IMAGE_PREPARATION_STATE_FAILED")
        await enqueuePilotJob({
          supabase: input.supabase,
          runId: state.run.id,
          candidateId: candidate.id,
          job: imageJob,
        })
      }
    } else if (leased.job_type === "GENERATE_SIX_IMAGE_PACKAGE") {
      if (text(candidate.machine_state) !== "PREPARING_IMAGE_PACKAGE") {
        throw new Error("SAME_DAY_PILOT_IMAGE_GENERATION_STATE_INVALID")
      }
      const generated = await generateAndPersistSameDayImagePackage({
        supabase: input.supabase,
        accountKey: input.accountKey,
        actorId: text(state.run.created_by),
        runId: state.run.id,
        candidate: record(candidate),
      })
      await heartbeatPilotJob({ supabase: input.supabase, job: record(leased), workerId: input.workerId })
      const imageSummary = {
        status: "PENDING_HUMAN_REVIEW",
        source: "LUNA_AUTHORIZED_DERIVATIVE_SET",
        setVersion: "EBAY_LISTING_IMAGE_COMPOSITION_SET_V1",
        listingPackageId: generated.listingPackageId,
        controlId: generated.controlId,
        assetIds: generated.assetIds,
        count: generated.assetIds.length,
        generatedImages: generated.assetIds.length,
        openAiCalls: generated.openAiCalls,
        openAiBackgroundPlates: generated.openAiCalls,
        aiConfiguration: generated.aiConfiguration,
        generationMode: generated.generationMode,
        competitorImages: 0,
        approved: false,
      }
      const { error: imageUpdateError } = await input.supabase
        .from("ebay_same_day_pilot_candidates")
        .update({
          state: "READY_FOR_IMAGE_REVIEW",
          image_package_summary: imageSummary,
          updated_at: new Date().toISOString(),
        })
        .eq("id", candidate.id)
        .eq("run_id", state.run.id)
      if (imageUpdateError) throw new Error("SAME_DAY_PILOT_IMAGE_PACKAGE_SUMMARY_FAILED")
      await transition({
        supabase: input.supabase,
        runId: state.run.id,
        candidateId: candidate.id,
        previousState: "PREPARING_IMAGE_PACKAGE",
        nextState: "WAITING_IMAGE_APPROVAL",
        reasonCode: generated.openAiCalls === 1
          ? "SIX_IMAGE_SET_READY_ONE_SAFE_OPENAI_BACKGROUND"
          : "SIX_IMAGE_SET_READY_DETERMINISTIC_FALLBACK",
        triggeredBy: "SYSTEM",
        checkpoint: { controlId: generated.controlId,
          listingPackageId: generated.listingPackageId,
          assetIds: generated.assetIds,
          openAiCalls: generated.openAiCalls,
          generatedImages: 7, competitorImages: 0, ebayWrites: 0 },
        nextAutomaticAction: "Esperar una sola aprobación visual.",
        nextHumanAction: "Revisar y aprobar o rechazar el set completo de siete imágenes.",
      })
      await createHumanTask({
        supabase: input.supabase,
        runId: state.run.id,
        candidateId: candidate.id,
        expectedState: "WAITING_IMAGE_APPROVAL",
        gateType: "IMAGE_APPROVAL_REQUIRED",
        title: "Revisa el set completo de siete imágenes",
        why: "Confirma que producto, pack, variante, textos y elementos incluidos coinciden exactamente.",
        seconds: 120,
        impact: "Una sola aprobación publicará internamente el set y preparará el paquete para la autorización final en Seller OS.",
        evidence: { product: candidate.product_title, imagePackage: imageSummary },
        actionSchema: { type: "IMAGE_APPROVAL", actions: ["APPROVE", "REJECT"],
          expectedImages: 7, maximumOpenAiCalls: 1 },
        continuationJobType: "APPROVE_SIX_IMAGE_SET",
      })
    } else if (leased.job_type === "APPROVE_SIX_IMAGE_SET") {
      if (text(candidate.machine_state) !== "BUILDING_SELLER_HUB_HANDOFF") {
        throw new Error("SAME_DAY_PILOT_IMAGE_APPROVAL_STATE_INVALID")
      }
      const reviewed = await reviewSameDayImagePackage({
        supabase: input.supabase,
        accountKey: input.accountKey,
        actorId: text(state.run.created_by),
        candidate: record(candidate),
        decision: "APPROVE",
      })
      const imageSummary = {
        ...record(candidate.image_package_summary),
        status: "APPROVED",
        approved: true,
        approvedAt: new Date().toISOString(),
        publicUrls: reviewed.publicUrls,
        ebayWrites: 0,
      }
      const { error: approvalUpdateError } = await input.supabase
        .from("ebay_same_day_pilot_candidates")
        .update({ image_package_summary: imageSummary, updated_at: new Date().toISOString() })
        .eq("id", candidate.id)
        .eq("run_id", state.run.id)
      if (approvalUpdateError) throw new Error("SAME_DAY_PILOT_IMAGE_APPROVAL_SUMMARY_FAILED")
      await enqueuePilotJob({
        supabase: input.supabase,
        runId: state.run.id,
        candidateId: candidate.id,
        job: {
          jobType: "FINALIZE_MANUAL_HANDOFF",
          idempotencyKey: `${state.run.id}:${candidate.id}:FINALIZE_MANUAL_HANDOFF`,
          checkpoint: { controlId: reviewed.controlId,
            openAiCalls: record(candidate.image_package_summary).openAiCalls ?? 0,
            approvedImages: 7, ebayWrites: 0 },
          maxAttempts: 4,
        },
      })
    } else if (leased.job_type === "FINALIZE_MANUAL_HANDOFF") {
      if (text(candidate.machine_state) !== "BUILDING_SELLER_HUB_HANDOFF") throw new Error("SAME_DAY_PILOT_FINALIZE_STATE_INVALID")
      const currentSummary = record(candidate.manual_handoff_package)
      const basePackage = record(currentSummary.package)
      if (!Object.keys(basePackage).length || !text(currentSummary.packageHash)) throw new Error("SAME_DAY_PILOT_HANDOFF_CHECKPOINT_MISSING")
      const imageSummary = record(candidate.image_package_summary)
      const approvedImageUrls = Array.isArray(imageSummary.publicUrls)
        ? imageSummary.publicUrls.map((value) => safeHttpsUrl(value)).filter(Boolean)
        : []
      if (imageSummary.approved !== true || approvedImageUrls.length !== 7) {
        throw new Error("SAME_DAY_PILOT_APPROVED_SEVEN_IMAGE_SET_REQUIRED")
      }
      const openAiImageCalls = Number(imageSummary.openAiCalls) === 1 ? 1 : 0
      const readyPackage = currentSummary.status === "READY_FOR_MANUAL_PUBLICATION"
        ? basePackage
        : { ...basePackage,
          images: { urls: approvedImageUrls, count: 7,
            source: "LUNA_AUTHORIZED_DERIVATIVE_SET", competitorImages: 0,
            openAiBackgroundPlates: openAiImageCalls },
          safety: { ...record(basePackage.safety), openAiCalls: openAiImageCalls,
            ebayWrites: 0, competitorContentUsed: false },
          imageApproval: { approved: true, approvedAt: new Date().toISOString(),
            controlId: imageSummary.controlId, approvedImageCount: 7 } }
      const packageHash = currentSummary.status === "READY_FOR_MANUAL_PUBLICATION"
        ? text(currentSummary.packageHash)
        : hash(readyPackage)
      const factsSummary = record(candidate.product_facts_summary)
      const images = record(readyPackage.images)
      const { error: persistError } = await input.supabase.from("ebay_same_day_pilot_handoffs").upsert({
        run_id: state.run.id, candidate_id: candidate.id, fact_run_id: factsSummary.factRunId,
        handoff_version: SAME_DAY_MANUAL_HANDOFF_VERSION, status: "READY_FOR_MANUAL_PUBLICATION",
        package_data: readyPackage, package_hash: packageHash, source_image_type: "LUNA_AUTHORIZED_DERIVATIVE_SET",
        image_count: Number(images.count ?? 0), operator_price_approved: true,
        openai_calls: openAiImageCalls, ebay_writes: 0, production_changed: false,
      }, { onConflict: "candidate_id,package_hash", ignoreDuplicates: true })
      if (persistError) throw new Error("SAME_DAY_PILOT_READY_HANDOFF_PERSIST_FAILED")
      const readySummary = { status: "READY_FOR_MANUAL_PUBLICATION", version: SAME_DAY_MANUAL_HANDOFF_VERSION,
        packageHash, package: readyPackage, blockers: [], openAiCalls: openAiImageCalls, ebayWrites: 0 }
      const { error: updateError } = await input.supabase.from("ebay_same_day_pilot_candidates").update({
        state: "READY_FOR_MANUAL_PUBLICATION", local_preparation_status: "SUPERSEDED",
        manual_handoff_package: readySummary,
        image_package_summary: { ...record(candidate.image_package_summary), approved: true, approvedAt: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }).eq("id", candidate.id).eq("run_id", state.run.id)
      if (updateError) throw new Error("SAME_DAY_PILOT_READY_HANDOFF_UPDATE_FAILED")
      await transition({ supabase: input.supabase, runId: state.run.id, candidateId: candidate.id,
        previousState: "BUILDING_SELLER_HUB_HANDOFF", nextState: "READY_FOR_MANUAL_PUBLICATION",
        reasonCode: "MANUAL_SELLER_HUB_HANDOFF_READY", triggeredBy: "SYSTEM",
        checkpoint: { packageHash, openAiCalls: openAiImageCalls, approvedImages: 7, ebayWrites: 0 },
        nextAutomaticAction: "Esperar la autorización final en Seller OS; después publicar una sola vez, verificar ACTIVE y registrar monitoreo.", nextHumanAction: "Abrir el workspace exacto, revisar el preview final y autorizar la publicación." })
      await promoteNextCandidateAfterPreparedPackage(
        input.supabase,
        state.run.id,
        Number(candidate.ordinal),
      )
    } else {
      throw new Error("SAME_DAY_PILOT_JOB_TYPE_UNSUPPORTED")
    }
    await settlePilotJob({ supabase: input.supabase, job: record(leased), workerId: input.workerId, status: "COMPLETED" })
    await refreshRunProjection(input.supabase, state.run.id, true)
    return { processed: 1, status: "COMPLETED", jobType: leased.job_type }
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message) ? error.message : "SAME_DAY_PILOT_JOB_FAILED"
    if (leased.job_type === "GENERATE_SIX_IMAGE_PACKAGE" &&
      VISUAL_MARKET_RECAPTURE_ERROR_CODES.has(code)) {
      const priorVisualRecaptures = state.transitions.filter((entry) =>
        text(entry.candidate_id) === text(candidate.id) &&
        text(entry.next_state) === "WAITING_PRODUCT_RESEARCH_CAPTURE" &&
        text(entry.reason_code) === "VISUAL_MARKET_RECAPTURE_REQUIRED").length
      if (priorVisualRecaptures >= 1) {
        await settlePilotJob({
          supabase: input.supabase,
          job: record(leased),
          workerId: input.workerId,
          status: "COMPLETED",
          errorCode: VISUAL_MARKET_RECAPTURE_LIMIT_REASON,
        })
        await rejectAndPromote({
          supabase: input.supabase,
          runId: state.run.id,
          candidate: record(candidate),
          previousState: "PREPARING_IMAGE_PACKAGE",
          reasonCode: VISUAL_MARKET_RECAPTURE_LIMIT_REASON,
          blockers: [
            VISUAL_MARKET_RECAPTURE_LIMIT_REASON,
            code,
          ],
        })
        const { error: limitEventError } = await input.supabase
          .from("ebay_same_day_pilot_events")
          .upsert({
            run_id: state.run.id,
            candidate_id: candidate.id,
            event_type: "VISUAL_MARKET_RECAPTURE_LIMIT_REACHED",
            event_payload: {
              recoveryVersion: VISUAL_MARKET_RECAPTURE_RECOVERY_VERSION,
              priorVisualRecaptures,
              finalEvidenceError: code,
              evidencePreserved: true,
              operatorRecaptureRequestedAgain: false,
              historyDeleted: false,
            },
            idempotency_key:
              `${state.run.id}:${candidate.id}:VISUAL_MARKET_RECAPTURE_LIMIT:${leased.id}`,
            ebay_read_calls: 0,
            openai_calls: 0,
            ebay_writes: 0,
            production_changed: false,
          }, { onConflict: "idempotency_key", ignoreDuplicates: true })
        if (limitEventError) {
          throw new Error("SAME_DAY_PILOT_VISUAL_RECAPTURE_LIMIT_EVENT_FAILED")
        }
        await refreshRunProjection(input.supabase, state.run.id, true)
        return {
          processed: 1,
          status: "COMPLETED",
          jobType: leased.job_type,
          rejectedAfterBoundedRecapture: true,
          error: VISUAL_MARKET_RECAPTURE_LIMIT_REASON,
          ebayWrites: 0,
        }
      }
      await routeCandidateToVisualMarketRecapture({
        supabase: input.supabase,
        state,
        candidate: record(candidate),
        previousState: "PREPARING_IMAGE_PACKAGE",
        errorCode: code,
        recoveryOrigin: "ACTIVE_IMAGE_JOB",
        now,
      })
      await settlePilotJob({
        supabase: input.supabase,
        job: record(leased),
        workerId: input.workerId,
        status: "COMPLETED",
        errorCode: "VISUAL_MARKET_RECAPTURE_REQUIRED",
      })
      await refreshRunProjection(input.supabase, state.run.id, true)
      return {
        processed: 1,
        status: "COMPLETED",
        jobType: leased.job_type,
        waitingFor: "VISUAL_PRODUCT_RESEARCH_RECAPTURE",
        error: code,
        ebayWrites: 0,
      }
    }
    const rateLimitMetadata = getEbayReadonlyRateLimitMetadata(error)
    const rateLimited = Boolean(rateLimitMetadata) || /429|QUOTA_PAUSED/.test(code)
    const canRetry = rateLimited || (retryable(code) && Number(leased.attempt) < Number(leased.max_attempts))
    let availableAt = new Date(now.getTime() + Math.min(900, 30 * 2 ** Number(leased.attempt)) * 1000).toISOString()
    if (rateLimited) {
      const persisted = await recordPersistentEbayRateLimit(input.supabase, {
        error, apiFamily: text(rateLimitMetadata?.apiFamily) || text(leased.api_family) || "BROWSE",
        endpoint: text(rateLimitMetadata?.endpoint) || text(leased.api_operation) || "EXACT_VERIFICATION",
        operation: text(rateLimitMetadata?.operation) || text(leased.api_operation) || "EXACT_VERIFICATION",
        lane: "P1_EXACT_VERIFICATION", checkpoint: record(leased.checkpoint), retryCount: Number(leased.attempt),
      })
      availableAt = persisted?.resumeAt ?? new Date(now.getTime() + 15 * 60_000).toISOString()
    }
    await settlePilotJob({ supabase: input.supabase, job: record(leased), workerId: input.workerId,
      status: canRetry ? "WAITING_RETRY" : "DEAD_LETTER", availableAt, errorCode: code,
      preserveAttempt: rateLimited })
    if (rateLimited) {
      await promoteImmediateSuccessorDuringQuotaPause(
        input.supabase,
        state.run.id,
        Number(candidate.ordinal),
      )
    }
    if (!canRetry) {
      await rejectAndPromote({ supabase: input.supabase, runId: state.run.id, candidate: record(candidate),
        previousState: text(candidate.machine_state), reasonCode: code })
    }
    await refreshRunProjection(input.supabase, state.run.id, true)
    return { processed: 1, status: canRetry ? "WAITING_RETRY" : "DEAD_LETTER", error: code,
      resumeAt: rateLimited ? availableAt : null, checkpointPreserved: true }
  }
  } finally {
    await releasePilotRunLease({
      supabase: input.supabase, runId, workerId: input.workerId, leaseToken: runLeaseToken,
    })
  }
}

export async function processSameDayPilotJobChain(input: {
  supabase: SupabaseClient
  accountKey: string
  workerId: string
  now?: Date
  maximumJobs?: number
  maximumDurationMs?: number
}) {
  const maximumJobs = Math.max(1, Math.min(30, Math.trunc(input.maximumJobs ?? 30)))
  const maximumDurationMs = Math.max(1_000, Math.min(240_000,
    Math.trunc(input.maximumDurationMs ?? 240_000)))
  const startedAt = Date.now()
  const results: Array<Awaited<ReturnType<typeof processSameDayPilotJobs>>> = []
  let stoppedReason = "MAXIMUM_JOBS_REACHED"

  for (let index = 0; index < maximumJobs; index += 1) {
    const result = await processSameDayPilotJobs({
      supabase: input.supabase,
      accountKey: input.accountKey,
      workerId: `${input.workerId}:chain:${index + 1}`,
      now: input.now ? new Date(input.now.getTime() + index) : undefined,
    })
    results.push(result)
    if (result.processed !== 1) {
      stoppedReason = result.status === "IDLE" ? "QUEUE_DRAINED" : result.status
      break
    }
    if (!["COMPLETED", "EFFECT_ALREADY_APPLIED"].includes(result.status)) {
      // A 429, retry, dead letter or busy lease must preserve its checkpoint
      // and return control to the durable scheduler instead of spinning.
      stoppedReason = result.status
      break
    }
    if (Date.now() - startedAt >= maximumDurationMs) {
      stoppedReason = "TIME_BUDGET_REACHED"
      break
    }
  }

  return {
    processed: results.reduce((total, result) => total + Number(result.processed ?? 0), 0),
    status: "IMMEDIATE_CHAIN_FINISHED",
    stoppedReason,
    executions: results.map((result) => ({
      status: result.status,
      jobType: "jobType" in result ? result.jobType ?? null : null,
    })),
    schedulerFallback: true,
    recursiveHttp: false,
  }
}
