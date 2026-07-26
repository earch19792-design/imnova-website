import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { extractPackQuantity } from "../marketplace/commercial-monitor-domain"
import {
  DEFAULT_POST_PUBLICATION_OPTIMIZATION_POLICY,
  evaluateSafePromotionRate,
  type PostPublicationPromotionEligibility,
} from "../marketplace/post-publication-optimization-domain"
import {
  readManualListingFromTradingApi,
  tradingXmlTagValue,
} from "./ebay-manual-listing-trading-readonly"
import {
  EBAY_ACTIVE_LISTING_COMMERCIAL_POLICY_VERSION,
  evaluateEbayActiveListingCommercialPolicy,
  type EbayActiveListingCommercialPolicyResult,
} from "./ebay-active-listing-commercial-policy"
import {
  assertEbayProductionCapability,
  type EbayProductionCapabilityGrant,
  type EbayWriteCapability,
} from "./ebay-production-capability-policy"
import {
  getEbayWriteCredential,
  useEbayWriteCredential,
} from "./ebay-write-credential-provider"
import {
  calculateEbayMinimumOperatorPrice,
  calculateEbayUnitEconomics,
} from "./ebay-unit-economics"
import {
  COMMERCIAL_IMPROVEMENT_CONFIRMATION,
  endActiveListingOutOfStockRequestXml,
  reviseActiveListingPriceRequestXml,
} from "./ebay-commercial-improvement-action-domain"

export { COMMERCIAL_IMPROVEMENT_CONFIRMATION,
  endActiveListingOutOfStockRequestXml,
  reviseActiveListingPriceRequestXml } from "./ebay-commercial-improvement-action-domain"

const MARKETPLACE = "EBAY_US"
const TRADING_ENDPOINT = "https://api.ebay.com/ws/api.dll"
const MARKETING_ENDPOINT = "https://api.ebay.com/sell/marketing/v1"
const RULE_VERSION =
  `SELLER_OS_COMMERCIAL_IMPROVEMENT_ACTION_V3:${EBAY_ACTIVE_LISTING_COMMERCIAL_POLICY_VERSION}`

type CommercialImprovementApplyCapability =
  | "confirmed_sold_price.apply"
  | "promotion.apply"
  | "out_of_stock.end"

type CommercialImprovementApplyGrant =
  EbayProductionCapabilityGrant<CommercialImprovementApplyCapability>

type CommercialProposal = {
  actionType: "PRICE" | "PROMOTED_LISTINGS_GENERAL" | "END_LISTING"
  targetValue: JsonRecord
  commercialPolicy: EbayActiveListingCommercialPolicyResult
}

type JsonRecord = Record<string, unknown>
type FetchLike = typeof fetch

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum)
    : ""
}

function numeric(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function uuid(value: unknown) {
  const normalized = text(value, 40)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(normalized) ? normalized : ""
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function money(value: number) {
  return Math.round(value * 100) / 100
}

function exactNumericZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value === 0
}

function freshTimestamp(value: unknown, maximumAgeMs: number) {
  const observedAt = Date.parse(text(value, 80))
  const now = Date.now()
  return Number.isFinite(observedAt) && observedAt <= now &&
    now - observedAt <= maximumAgeMs
}

const PREPARE_ONLY_BLOCKERS = new Set([
  "OFFICIAL_CURRENT_PRICE_REVALIDATION_REQUIRED",
  "HUMAN_CONFIRMATION_REQUIRED",
  "IDEMPOTENCY_REQUIRED",
  "READBACK_REQUIRED",
])

function policyBlockerForPreparation(
  policy: EbayActiveListingCommercialPolicyResult,
) {
  return policy.blockerCodes.find((code) => !PREPARE_ONLY_BLOCKERS.has(code)) ??
    null
}

function confirmedSoldPolicyFromEvent(input: {
  event: JsonRecord
  execution?: {
    supplierEvidenceFresh: boolean
    supplierAvailable: boolean
    economicsApproved: boolean
    proposedPriceAtOrAboveFloor: boolean
    officialCurrentPriceUnchanged: boolean
    promotionEvidenceApproved?: boolean
    humanConfirmation: boolean
    idempotencyReady: boolean
    readbackReady: boolean
  }
}) {
  const evidence = record(input.event.evidence)
  const price = record(
    evidence.priceRecommendation ?? evidence.confirmedSoldPriceRecommendation,
  )
  const eventType = text(input.event.event_type, 100)
  if (eventType === "COMPETITOR_ACTIVE_MARKET_PRICE_RECOMMENDATION") {
    return evaluateEbayActiveListingCommercialPolicy({
      evidenceClass: "ACTIVE_ONLY",
      evidenceObservedAt: text(input.event.detected_at, 80) || null,
      confirmedSoldQuantity: 0,
    })
  }
  const comparisonBasis = text(price.comparisonBasis, 100)
  const exactSoldBasis =
    comparisonBasis === "PRODUCT_RESEARCH_CONFIRMED_SOLD_LANDED_PRICE"
  const confirmedSoldQuantity = numeric(price.confirmedSoldQuantity)
  const confirmedSoldOfferCount = numeric(price.confirmedSoldOfferCount)
  const confirmedSoldSellerCount = numeric(price.confirmedSoldSellerCount)
  const ownPackQuantity = numeric(price.ownPackQuantity)
  const eventFresh = freshTimestamp(input.event.detected_at, 24 * 60 * 60_000)
  const execution = input.execution
  return evaluateEbayActiveListingCommercialPolicy({
    evidenceClass: eventType ===
        "COMPETITOR_CONFIRMED_SOLD_PRICE_RECOMMENDATION" &&
        text(price.evidenceClass, 80) === "CONFIRMED_SOLD_HISTORY"
      ? "CONFIRMED_SOLD_HISTORY"
      : text(evidence.evidenceClass, 80),
    evidenceObservedAt: text(
      price.newestConfirmedSoldAt ?? price.evidenceObservedAt,
      80,
    ) || null,
    confirmedSoldQuantity,
    confirmedSoldSource: exactSoldBasis
      ? "EBAY_PRODUCT_RESEARCH_CONFIRMED_SOLD"
      : text(price.confirmedSoldSource, 120) || null,
    identityExact: exactSoldBasis &&
      (confirmedSoldOfferCount ?? 0) > 0 &&
      (confirmedSoldSellerCount ?? 0) > 0,
    samePresentation: exactSoldBasis,
    sameCondition: exactSoldBasis,
    samePack: exactSoldBasis && (ownPackQuantity ?? 0) > 0,
    landedPriceComplete:
      (numeric(price.confirmedSoldBenchmarkLandedPrice) ?? 0) > 0 &&
      (numeric(price.currentLandedPrice) ?? 0) > 0 &&
      (numeric(price.proposedLandedPrice) ?? 0) > 0,
    supplierEvidenceFresh: execution?.supplierEvidenceFresh ??
      (eventFresh && numeric(price.supplierUnitCost) !== null),
    supplierAvailable: execution?.supplierAvailable ??
      (numeric(price.supplierUnitCost) !== null),
    proposalCurrent: eventFresh,
    economicsApproved: execution?.economicsApproved ??
      price.proposedPassesProfitGate === true,
    proposedPriceAtOrAboveFloor: execution?.proposedPriceAtOrAboveFloor ??
      (
        numeric(price.proposedLandedPrice) !== null &&
        numeric(price.minimumSafeLandedPrice) !== null &&
        (numeric(price.proposedLandedPrice) as number) >=
          (numeric(price.minimumSafeLandedPrice) as number)
      ),
    officialCurrentPriceUnchanged:
      execution?.officialCurrentPriceUnchanged === true,
    promotionEvidenceApproved:
      execution?.promotionEvidenceApproved === true,
    humanConfirmation: execution?.humanConfirmation === true,
    idempotencyReady: execution?.idempotencyReady === true,
    readbackReady: execution?.readbackReady === true,
  })
}

function promotionEligibility(value: unknown): PostPublicationPromotionEligibility {
  const source = record(value)
  const evidenceLevel = text(source.evidenceLevel, 2)
  const salesClassification = text(source.salesClassification, 40)
  return {
    evidenceLevel: ["E0", "E1", "E2", "E3", "E4", "E5"].includes(evidenceLevel)
      ? evidenceLevel as PostPublicationPromotionEligibility["evidenceLevel"]
      : "E0",
    salesClassification: [
      "SOLD_CONFIRMED",
      "SOLD_ESTIMATED",
      "ACTIVE_ONLY",
      "INSUFFICIENT_EVIDENCE",
    ].includes(salesClassification)
      ? salesClassification as PostPublicationPromotionEligibility["salesClassification"]
      : "INSUFFICIENT_EVIDENCE",
    confirmedSalesSource: text(source.confirmedSalesSource, 120) || null,
    confirmedUnitsSold: numeric(source.confirmedUnitsSold) ?? Number.NaN,
    costsComplete: source.costsComplete === true,
    economicsPassesProfitGate: source.economicsPassesProfitGate === true,
    expectedNetProfit: numeric(source.expectedNetProfit),
    minimumNetProfit: numeric(source.minimumNetProfit) ?? Number.NaN,
    expectedMarginPercent: numeric(source.expectedMarginPercent),
    minimumMarginPercent: numeric(source.minimumMarginPercent) ?? Number.NaN,
    expectedRoiPercent: numeric(source.expectedRoiPercent),
    minimumRoiPercent: numeric(source.minimumRoiPercent) ?? Number.NaN,
    safetyReservePercent: numeric(source.safetyReservePercent) ?? Number.NaN,
    configuredMaximumRatePercent:
      numeric(source.configuredMaximumRatePercent) ?? Number.NaN,
    stockAvailable: numeric(source.stockAvailable),
    stockEvidenceFresh: source.stockEvidenceFresh === true,
    evidenceFresh: source.evidenceFresh === true,
    configurationVersion: text(source.configurationVersion, 80),
  }
}

function isExactLunaUrl(value: unknown) {
  try {
    const url = new URL(text(value, 2_000))
    return url.protocol === "https:" &&
      ["lunaportex.com", "www.lunaportex.com"].includes(url.hostname) &&
      url.pathname.startsWith("/products/")
  } catch {
    return false
  }
}


async function loadEventAndListing(input: {
  supabase: SupabaseClient
  accountKey: string
  eventId: string
}) {
  const { data: event, error: eventError } = await input.supabase
    .from("commercial_alert_events")
    .select("id,event_type,severity,evidence,detected_at,listing_id,sku,recommended_action")
    .eq("id", input.eventId)
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", MARKETPLACE)
    .maybeSingle()
  if (eventError || !event?.listing_id) {
    throw new Error("COMMERCIAL_IMPROVEMENT_EVENT_NOT_FOUND")
  }
  const { data: listings, error: listingError } = await input.supabase
    .from("ebay_active_listings")
    .select("id,ebay_item_id,ebay_sku,market_radar_product_id,supplier_sku,supplier_variant_id,title,ebay_price,currency,raw_payload,listing_status,updated_at")
    .eq("account_key", input.accountKey)
    .eq("ebay_item_id", event.listing_id)
    .eq("listing_status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
  if (listingError || !listings?.[0]) {
    throw new Error("COMMERCIAL_IMPROVEMENT_ACTIVE_LISTING_REQUIRED")
  }
  const listing = listings[0]
  if (event.sku && ![listing.ebay_sku, listing.supplier_sku].includes(event.sku)) {
    throw new Error("COMMERCIAL_IMPROVEMENT_SKU_MISMATCH")
  }
  return { event, listing }
}

async function promotionBlocked(input: {
  supabase: SupabaseClient
  accountKey: string
  listingId: string
}) {
  const { data: activeListing, error: activeListingError } = await input.supabase
    .from("ebay_active_listings")
    .select("controlled_risk_policy")
    .eq("account_key", input.accountKey)
    .eq("ebay_item_id", input.listingId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (activeListingError) {
    throw new Error("COMMERCIAL_IMPROVEMENT_POLICY_READ_FAILED")
  }
  const activePolicy = record(activeListing?.controlled_risk_policy)
  if (text(activePolicy.promotion) === "DO_NOT_PROMOTE" ||
    numeric(activePolicy.minimumNetMarginPercent) === 10) return true

  const { data: publication, error } = await input.supabase
    .from("ebay_authorized_listing_publications")
    .select("listing_package_id")
    .eq("marketplace_account_key", input.accountKey)
    .eq("listing_id", input.listingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error("COMMERCIAL_IMPROVEMENT_POLICY_READ_FAILED")
  if (!publication?.listing_package_id) return false
  const { data: listingPackage, error: packageError } = await input.supabase
    .from("ebay_listing_packages")
    .select("package_data")
    .eq("id", publication.listing_package_id)
    .eq("account_key", input.accountKey)
    .maybeSingle()
  if (packageError) throw new Error("COMMERCIAL_IMPROVEMENT_POLICY_READ_FAILED")
  const policy = record(record(listingPackage?.package_data).controlledRiskPolicy)
  return text(policy.promotion) === "DO_NOT_PROMOTE" ||
    numeric(policy.minimumNetMarginPercent) === 10
}

async function assertPromotionConfigurationCurrent(input: {
  supabase: SupabaseClient
  accountKey: string
  configurationVersion: string
}) {
  const { data, error } = await input.supabase
    .from("commercial_threshold_configs")
    .select("version")
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", MARKETPLACE)
    .eq("active", true)
    .maybeSingle()
  if (error || !data?.version) {
    throw new Error("COMMERCIAL_IMPROVEMENT_PROMOTION_CONFIG_REQUIRED")
  }
  if (data.version !== input.configurationVersion) {
    throw new Error("COMMERCIAL_IMPROVEMENT_PROMOTION_CONFIG_CHANGED_REVIEW_REQUIRED")
  }
}

function proposalFromEvent(event: JsonRecord): CommercialProposal {
  const evidence = record(event.evidence)
  const price = record(evidence.priceRecommendation)
  const proposedPrice = numeric(price.proposedItemPrice)
  const currentPrice = numeric(price.currentItemPrice)
  const proposedLandedPrice = numeric(price.proposedLandedPrice)
  if (text(event.event_type) ===
    "COMPETITOR_ACTIVE_MARKET_PRICE_RECOMMENDATION") {
    throw new Error("CONFIRMED_SOLD_EVIDENCE_REQUIRED")
  }
  const commercialPolicy = confirmedSoldPolicyFromEvent({ event })
  const policyBlocker = policyBlockerForPreparation(commercialPolicy)
  if (
    text(event.event_type) === "COMPETITOR_CONFIRMED_SOLD_PRICE_RECOMMENDATION" &&
    commercialPolicy.decision === "EVALUATE_CONFIRMED_SOLD_PRICE" &&
    policyBlocker === null &&
    proposedPrice !== null && proposedPrice > 0 && currentPrice !== null &&
    proposedLandedPrice !== null && text(price.action) !==
      "KEEP_PRICE_IN_CONFIRMED_SOLD_BAND"
  ) return {
    actionType: "PRICE" as const,
    targetValue: {
      currentPrice: money(currentPrice),
      proposedPrice: money(proposedPrice),
      proposedLandedPrice: money(proposedLandedPrice),
      expectedMarginPercent: numeric(price.proposedEstimatedMarginPercent),
      expectedNetProfit: numeric(price.proposedEstimatedNetProfit),
      confidence: text(price.confidence, 20),
      evidenceClass: "CONFIRMED_SOLD_EXACT_PRESENTATION",
    },
    commercialPolicy,
  }
  if (text(event.event_type) === "LISTING_ZERO_VISIBILITY_REVIEW") {
    throw new Error("CONFIRMED_SOLD_EVIDENCE_REQUIRED")
  }
  if (policyBlocker) throw new Error(policyBlocker)
  throw new Error("COMMERCIAL_IMPROVEMENT_NOT_ACTIONABLE")
}

async function freshExactLunaVariant(input: {
  supabase: SupabaseClient
  listing: JsonRecord
  observedAt?: Date
}) {
  const variantId = text(input.listing.supplier_variant_id, 80)
  const supplierSku = text(input.listing.supplier_sku, 100)
  const productId = text(input.listing.market_radar_product_id, 80)
  if (!variantId || !supplierSku || !productId) {
    throw new Error("COMMERCIAL_IMPROVEMENT_LUNA_LINK_REQUIRED")
  }
  const query = input.supabase.from("market_radar_latest_variants")
    .select("product_id,supplier_variant_id,sku,price,available,inventory_quantity,captured_at,product_url")
    .eq("source_key", "lunaportex")
    .eq("product_id", productId)
    .eq("supplier_variant_id", variantId)
    .eq("sku", supplierSku)
    .order("captured_at", { ascending: false })
    .limit(2)
  const { data, error } = await query
  if (error || !data || data.length !== 1 || !isExactLunaUrl(data[0].product_url)) {
    throw new Error("COMMERCIAL_IMPROVEMENT_LUNA_EXACT_IDENTITY_REQUIRED")
  }
  const capturedAt = Date.parse(data[0].captured_at ?? "")
  const now = (input.observedAt ?? new Date()).getTime()
  if (!Number.isFinite(capturedAt) || capturedAt > now ||
    now - capturedAt > 24 * 60 * 60_000) {
    throw new Error("COMMERCIAL_IMPROVEMENT_LUNA_FRESHNESS_REQUIRED")
  }
  return data[0]
}

async function lunaChangeProposal(input: {
  supabase: SupabaseClient
  event: JsonRecord
  listing: JsonRecord
}): Promise<CommercialProposal | null> {
  const eventType = text(input.event.event_type)
  if (!["ACTIVE_LISTING_OUT_OF_STOCK", "LUNA_COST_CHANGED", "MARGIN_RISK"]
    .includes(eventType)) return null
  const luna = await freshExactLunaVariant(input)
  if (eventType === "ACTIVE_LISTING_OUT_OF_STOCK") {
    if (!exactNumericZero(luna.inventory_quantity)) {
      throw new Error("COMMERCIAL_IMPROVEMENT_LUNA_OUT_OF_STOCK_REQUIRED")
    }
    const commercialPolicy = evaluateEbayActiveListingCommercialPolicy({
      evidenceClass: "LUNA_OUT_OF_STOCK",
      evidenceObservedAt: luna.captured_at,
      protectiveEvidenceVerified: true,
      exactLunaIdentity: true,
      supplierEvidenceFresh: true,
      exactLunaStock: luna.inventory_quantity,
    })
    return {
      actionType: "END_LISTING" as const,
      targetValue: {
        endingReason: "NotAvailable",
        supplierAvailable: false,
        supplierInventoryQuantity: luna.inventory_quantity,
        lunaObservedAt: luna.captured_at,
        lunaProductUrl: luna.product_url,
        evidenceClass: "FRESH_EXACT_LUNA_OUT_OF_STOCK",
      },
      commercialPolicy,
    }
  }
  if (luna.available !== true) {
    throw new Error("COMMERCIAL_IMPROVEMENT_LUNA_AVAILABLE_REQUIRED")
  }
  const unitCost = numeric(luna.price)
  const currentPrice = numeric(input.listing.ebay_price)
  if (unitCost === null || unitCost < 0 || currentPrice === null ||
    currentPrice <= 0) {
    throw new Error("COMMERCIAL_IMPROVEMENT_LUNA_COST_REQUIRED")
  }
  const packCount = extractPackQuantity(text(input.listing.title, 500))
  const currentEconomics = calculateEbayUnitEconomics({
    salePrice: currentPrice,
    supplierCost: unitCost * packCount,
  })
  if (currentEconomics.ready && currentEconomics.passesProfitGate) {
    throw new Error("COMMERCIAL_IMPROVEMENT_PRICE_CHANGE_NOT_REQUIRED")
  }
  const floor = calculateEbayMinimumOperatorPrice({
    supplierCost: unitCost * packCount,
  })
  if (!floor.ready || floor.minimumOperatorPrice === null ||
    floor.minimumOperatorPrice <= currentPrice) {
    throw new Error("COMMERCIAL_IMPROVEMENT_PRICE_CHANGE_NOT_REQUIRED")
  }
  const economics = calculateEbayUnitEconomics({
    salePrice: floor.minimumOperatorPrice,
    supplierCost: unitCost * packCount,
  })
  if (!economics.ready || !economics.passesProfitGate) {
    throw new Error("COMMERCIAL_IMPROVEMENT_ECONOMICS_GATE_FAILED")
  }
  const commercialPolicy = evaluateEbayActiveListingCommercialPolicy({
    evidenceClass: eventType === "MARGIN_RISK" ? "MARGIN_RISK" : "LUNA_COST_CHANGED",
    evidenceObservedAt: luna.captured_at,
    protectiveEvidenceVerified: true,
    exactLunaIdentity: true,
    supplierEvidenceFresh: true,
    supplierAvailable: true,
    economicsApproved: true,
    proposedPriceAtOrAboveFloor: true,
  })
  return {
    actionType: "PRICE" as const,
    targetValue: {
      currentPrice: money(currentPrice),
      proposedPrice: money(floor.minimumOperatorPrice),
      proposedLandedPrice: money(floor.minimumOperatorPrice),
      expectedMarginPercent: economics.estimatedNetMarginPercent,
      expectedNetProfit: economics.estimatedNetProfit,
      confidence: "HIGH",
      evidenceClass: "FRESH_EXACT_LUNA_COST_RECALCULATION",
      lunaObservedAt: luna.captured_at,
      lunaProductUrl: luna.product_url,
      packCount,
    },
    commercialPolicy,
  }
}

function publicExecution(row: JsonRecord) {
  const targetValue = record(row.target_value)
  const commercialPolicy = record(targetValue.commercialPolicy)
  return {
    executionId: text(row.id, 40),
    eventId: text(row.commercial_event_id, 40),
    listingId: text(row.listing_id, 20),
    sku: text(row.sku, 80) || null,
    actionType: text(row.action_type, 80),
    targetValue,
    phase: text(row.phase, 80),
    ebayWriteAttemptCount: numeric(row.ebay_write_attempt_count) ?? 0,
    appliedVerified: row.phase === "applied_verified",
    errorCode: text(row.last_error_code, 160) || null,
    capability: text(commercialPolicy.capability, 40) || "blocked",
    blockerCodes: Array.isArray(commercialPolicy.blockerCodes)
      ? commercialPolicy.blockerCodes
        .map((code) => text(code, 120))
        .filter(Boolean)
      : ["CONFIRMED_SOLD_EVIDENCE_REQUIRED"],
    policyVersion: text(commercialPolicy.policyVersion, 120) ||
      EBAY_ACTIVE_LISTING_COMMERCIAL_POLICY_VERSION,
    evidenceExpiresAt:
      text(commercialPolicy.evidenceExpiresAt, 80) || null,
    requestHash: text(row.request_hash, 64) || null,
    confirmationRequired: COMMERCIAL_IMPROVEMENT_CONFIRMATION,
  }
}

export async function prepareEbayCommercialImprovement(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  eventId: string
  idempotencyKey: string
  capabilityGrant:
    EbayProductionCapabilityGrant<"commercial_improvement.prepare">
}) {
  const actorId = uuid(input.actorId)
  const eventId = uuid(input.eventId)
  const idempotencyKey = text(input.idempotencyKey, 120)
  if (!actorId || !eventId || !/^[A-Za-z0-9._:-]{8,120}$/.test(idempotencyKey)) {
    throw new Error("COMMERCIAL_IMPROVEMENT_PREPARE_INVALID")
  }
  assertEbayProductionCapability({
    capability: "commercial_improvement.prepare",
    stage: "service",
    invocation: "interactive",
    authenticationMode: "admin_user",
    userId: actorId,
    accountKey: input.accountKey,
    marketplace: MARKETPLACE,
    resourceKey: eventId,
    idempotencyKey,
    policyVersion: EBAY_ACTIVE_LISTING_COMMERCIAL_POLICY_VERSION,
  }, input.capabilityGrant)
  const { event, listing } = await loadEventAndListing({ ...input, eventId })
  const proposal = await lunaChangeProposal({
    supabase: input.supabase,
    event: record(event),
    listing: record(listing),
  }) ?? proposalFromEvent(event)
  if (proposal.actionType === "PROMOTED_LISTINGS_GENERAL") {
    await assertPromotionConfigurationCurrent({
      supabase: input.supabase,
      accountKey: input.accountKey,
      configurationVersion: text(
        record(proposal.targetValue).configurationVersion,
        80,
      ),
    })
  }
  if (proposal.actionType === "PROMOTED_LISTINGS_GENERAL" && await promotionBlocked({
    supabase: input.supabase,
    accountKey: input.accountKey,
    listingId: String(event.listing_id),
  })) throw new Error("COMMERCIAL_IMPROVEMENT_PROMOTION_BLOCKED_TEN_PERCENT_MARGIN")
  const targetValue = {
    ...proposal.targetValue,
    commercialPolicy: proposal.commercialPolicy,
  }
  const requestHash = sha256(JSON.stringify({
    version: RULE_VERSION,
    commercialPolicyVersion: EBAY_ACTIVE_LISTING_COMMERCIAL_POLICY_VERSION,
    accountKey: input.accountKey,
    eventId,
    listingId: event.listing_id,
    activeListingId: listing.id,
    actionType: proposal.actionType,
    targetValue,
  }))
  const idempotencyKeyHash = sha256(idempotencyKey)
  const { data: existing, error: existingError } = await input.supabase
    .from("ebay_commercial_improvement_executions")
    .select("*")
    .eq("commercial_event_id", eventId)
    .maybeSingle()
  if (existingError) throw new Error("COMMERCIAL_IMPROVEMENT_LEDGER_READ_FAILED")
  if (existing) {
    if (existing.request_hash !== requestHash || existing.actor_user_id !== actorId) {
      throw new Error("COMMERCIAL_IMPROVEMENT_EVENT_ALREADY_CLAIMED")
    }
    return publicExecution(record(existing))
  }
  const { data, error } = await input.supabase
    .from("ebay_commercial_improvement_executions")
    .insert({
      marketplace_account_key: input.accountKey,
      commercial_event_id: eventId,
      active_listing_id: listing.id,
      actor_user_id: actorId,
      listing_id: event.listing_id,
      sku: event.sku,
      action_type: proposal.actionType,
      target_value: targetValue,
      request_hash: requestHash,
      idempotency_key_hash: idempotencyKeyHash,
    })
    .select("*")
    .single()
  if (error || !data) throw new Error("COMMERCIAL_IMPROVEMENT_PREPARE_FAILED")
  return publicExecution(record(data))
}

async function freshEconomics(input: {
  supabase: SupabaseClient
  listing: JsonRecord
  salePrice: number
  observedAt?: Date
}) {
  const data = await freshExactLunaVariant(input)
  if (data.available !== true) {
    throw new Error("COMMERCIAL_IMPROVEMENT_LUNA_AVAILABLE_REQUIRED")
  }
  const unitCost = numeric(data.price)
  if (unitCost === null || unitCost < 0) {
    throw new Error("COMMERCIAL_IMPROVEMENT_LUNA_COST_REQUIRED")
  }
  const packCount = extractPackQuantity(text(input.listing.title, 500))
  const economics = calculateEbayUnitEconomics({
    salePrice: input.salePrice,
    supplierCost: unitCost * packCount,
  })
  if (!economics.ready || !economics.passesProfitGate) {
    throw new Error("COMMERCIAL_IMPROVEMENT_ECONOMICS_GATE_FAILED")
  }
  const floor = calculateEbayMinimumOperatorPrice({
    supplierCost: unitCost * packCount,
  })
  return {
    economics,
    lunaObservedAt: data.captured_at,
    packCount,
    stockAvailable: numeric(data.inventory_quantity),
    minimumOperatorPrice: floor.ready ? floor.minimumOperatorPrice : null,
  }
}

async function revisePrice(input: {
  accessToken: string
  listingId: string
  price: number
  currency: string
  fetchImpl: FetchLike
}) {
  const response = await input.fetchImpl(TRADING_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "ReviseFixedPriceItem",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1423",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": input.accessToken,
    },
    body: reviseActiveListingPriceRequestXml(input),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  })
  const xml = await response.text()
  const ack = text(tradingXmlTagValue(xml, "Ack"), 20).toLowerCase()
  if (!response.ok || !["success", "warning"].includes(ack)) {
    const code = text(tradingXmlTagValue(xml, "ErrorCode"), 20)
    throw new Error(/^\d{1,20}$/.test(code)
      ? `COMMERCIAL_IMPROVEMENT_EBAY_PRICE_REJECTED_${code}`
      : "COMMERCIAL_IMPROVEMENT_EBAY_PRICE_REJECTED")
  }
}

async function endListingOutOfStock(input: {
  accessToken: string
  listingId: string
  fetchImpl: FetchLike
}) {
  const response = await input.fetchImpl(TRADING_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "EndFixedPriceItem",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1423",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": input.accessToken,
    },
    body: endActiveListingOutOfStockRequestXml(input),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  })
  const xml = await response.text()
  const ack = text(tradingXmlTagValue(xml, "Ack"), 20).toLowerCase()
  if (!response.ok || !["success", "warning"].includes(ack)) {
    const code = text(tradingXmlTagValue(xml, "ErrorCode"), 20)
    throw new Error(/^\d{1,20}$/.test(code)
      ? `COMMERCIAL_IMPROVEMENT_EBAY_END_REJECTED_${code}`
      : "COMMERCIAL_IMPROVEMENT_EBAY_END_REJECTED")
  }
}

function campaignIdFromLocation(location: string | null) {
  const value = text(location, 1_000).split("/").filter(Boolean).at(-1) ?? ""
  return /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : ""
}

async function createPromotionCampaign(input: {
  accessToken: string
  listingId: string
  eventId: string
  ratePercent: number
  durationDays: number
  fetchImpl: FetchLike
}) {
  const start = new Date()
  const end = new Date(
    start.getTime() + input.durationDays * 24 * 60 * 60_000,
  )
  const rateKey = input.ratePercent.toFixed(2).replace(".", "p")
  const campaignName =
    `SellerOS-safe-${rateKey}pct-${input.listingId}-${input.eventId.slice(0, 8)}`
  const response = await input.fetchImpl(`${MARKETING_ENDPOINT}/ad_campaign`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
    },
    body: JSON.stringify({
      marketplaceId: MARKETPLACE,
      campaignName,
      fundingStrategy: {
        fundingModel: "COST_PER_SALE",
        adRateStrategy: "FIXED",
        bidPercentage: input.ratePercent.toFixed(2),
      },
      startDate: start.toISOString().replace(/\.\d{3}Z$/, "Z"),
      endDate: end.toISOString().replace(/\.\d{3}Z$/, "Z"),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  })
  const campaignId = campaignIdFromLocation(response.headers.get("location"))
  if (!response.ok || !campaignId) {
    throw new Error("COMMERCIAL_IMPROVEMENT_CAMPAIGN_CREATE_REJECTED")
  }
  return { campaignId, campaignName, endsAt: end.toISOString() }
}

async function assertListingNotAlreadyPromoted(input: {
  accessToken: string
  listingId: string
  fetchImpl: FetchLike
}) {
  const url = new URL(`${MARKETING_ENDPOINT}/ad_campaign/find_campaign_by_ad_reference`)
  url.searchParams.set("listing_id", input.listingId)
  const response = await input.fetchImpl(url, {
    headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 404) return
  const payload = record(await response.json().catch(() => ({})))
  if (response.ok && (text(payload.campaignId, 100) || text(payload.campaign_id, 100))) {
    throw new Error("COMMERCIAL_IMPROVEMENT_PROMOTION_ALREADY_ACTIVE_REVIEW_REQUIRED")
  }
  if (!response.ok) {
    throw new Error("COMMERCIAL_IMPROVEMENT_PROMOTION_PREFLIGHT_UNAVAILABLE")
  }
}

async function createPromotionAd(input: {
  accessToken: string
  campaignId: string
  listingId: string
  ratePercent: number
  fetchImpl: FetchLike
}) {
  const response = await input.fetchImpl(
    `${MARKETING_ENDPOINT}/ad_campaign/${encodeURIComponent(input.campaignId)}/ad`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
      },
      body: JSON.stringify({
        listingId: input.listingId,
        bidPercentage: input.ratePercent.toFixed(2),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    },
  )
  if (!response.ok) throw new Error("COMMERCIAL_IMPROVEMENT_AD_CREATE_REJECTED")
}

async function verifyCampaignAd(input: {
  accessToken: string
  campaignId: string
  listingId: string
  ratePercent: number
  fetchImpl: FetchLike
}) {
  const response = await input.fetchImpl(
    `${MARKETING_ENDPOINT}/ad_campaign/${encodeURIComponent(input.campaignId)}/ad?limit=500`,
    {
      headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  )
  const payload = record(await response.json().catch(() => ({})))
  const ads = Array.isArray(payload.ads) ? payload.ads.map(record) : []
  return response.ok && ads.some((ad) =>
    text(ad.listingId, 20) === input.listingId &&
    Math.abs((numeric(ad.bidPercentage) ?? 0) - input.ratePercent) < 0.01)
}

export function requiredEbayCommercialImprovementApplyCapability(input: {
  actionType: unknown
  targetValue: unknown
}): CommercialImprovementApplyCapability {
  const actionType = text(input.actionType, 80)
  const target = record(input.targetValue)
  if (actionType === "END_LISTING" &&
    text(target.evidenceClass, 100) === "FRESH_EXACT_LUNA_OUT_OF_STOCK") {
    return "out_of_stock.end"
  }
  if (actionType === "PROMOTED_LISTINGS_GENERAL") return "promotion.apply"
  if (actionType === "PRICE" &&
    text(target.evidenceClass, 100) ===
      "CONFIRMED_SOLD_EXACT_PRESENTATION") {
    return "confirmed_sold_price.apply"
  }
  if (actionType === "PRICE" &&
    text(target.evidenceClass, 100) ===
      "FRESH_EXACT_LUNA_COST_RECALCULATION") {
    throw new Error(
      "COMMERCIAL_IMPROVEMENT_PROTECTIVE_PRICE_APPLY_NOT_ENABLED",
    )
  }
  throw new Error("COMMERCIAL_IMPROVEMENT_CAPABILITY_NOT_ALLOWED")
}

export async function applyEbayCommercialImprovement(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  eventId: string
  idempotencyKey: string
  confirmation: string
  prepareCapabilityGrant:
    EbayProductionCapabilityGrant<"commercial_improvement.prepare">
  capabilityGrant: CommercialImprovementApplyGrant
  fetchImpl?: FetchLike
}) {
  if (input.confirmation !== COMMERCIAL_IMPROVEMENT_CONFIRMATION) {
    throw new Error("COMMERCIAL_IMPROVEMENT_CONFIRMATION_REQUIRED")
  }
  const preview = await prepareEbayCommercialImprovement({
    ...input,
    capabilityGrant: input.prepareCapabilityGrant,
  })
  if (["applied_verified", "terminal_failure"].includes(preview.phase)) {
    return preview
  }
  const capability = requiredEbayCommercialImprovementApplyCapability(preview)
  let capabilityGrant = assertEbayProductionCapability({
    capability,
    stage: "service",
    invocation: "interactive",
    authenticationMode: "admin_user",
    userId: input.actorId,
    accountKey: input.accountKey,
    marketplace: MARKETPLACE,
    resourceKey: preview.listingId,
    idempotencyKey: input.idempotencyKey,
    policyVersion: EBAY_ACTIVE_LISTING_COMMERCIAL_POLICY_VERSION,
    confirmedHumanAction: true,
  }, input.capabilityGrant)
  const { event, listing } = await loadEventAndListing(input)
  const fetchImpl = input.fetchImpl ?? fetch
  const target = record(preview.targetValue)
  const officialBefore = await readManualListingFromTradingApi(
    String(event.listing_id),
    fetchImpl,
  )
  const endingListing = preview.actionType === "END_LISTING"
  const priorOutcome = [
    "write_in_flight",
    "write_acknowledged",
    "outcome_unknown",
  ].includes(preview.phase)
  const identityMatches = !event.sku ||
    [officialBefore.ebaySku, listing.supplier_sku].includes(event.sku)
  if ((!priorOutcome || !endingListing) &&
      officialBefore.ownership !== "verified" ||
    !identityMatches) {
    throw new Error("COMMERCIAL_IMPROVEMENT_OFFICIAL_IDENTITY_MISMATCH")
  }

  if (priorOutcome) {
    const proposedPrice = numeric(target.proposedPrice)
    const reconciled = endingListing
      ? officialBefore.ownership === "inactive" &&
        officialBefore.listingStatus?.toLowerCase() !== "active"
      : preview.actionType === "PRICE" && proposedPrice !== null &&
        officialBefore.price !== null &&
        Math.abs(officialBefore.price - proposedPrice) <= 0.01
    if (reconciled) {
      const reconciledAt = new Date().toISOString()
      if (endingListing) {
        const { error: registryError } = await input.supabase
          .from("ebay_active_listings")
          .update({ listing_status: "ended", updated_at: reconciledAt })
          .eq("id", listing.id)
          .eq("account_key", input.accountKey)
          .eq("listing_status", "active")
        if (registryError) {
          throw new Error(
            "COMMERCIAL_IMPROVEMENT_ACTIVE_REGISTRY_UPDATE_FAILED",
          )
        }
      }
      const { data, error } = await input.supabase
        .from("ebay_commercial_improvement_executions")
        .update({
          phase: "applied_verified",
          postflight_snapshot: {
            source: "EBAY_TRADING_GET_ITEM_RECONCILIATION",
            price: officialBefore.price,
            listingStatus: officialBefore.listingStatus,
            ownership: officialBefore.ownership,
            observedAt: officialBefore.observedAt,
            reconciled: true,
          },
          applied_verified_at: reconciledAt,
          last_error_code: null,
          updated_at: reconciledAt,
        })
        .eq("id", preview.executionId)
        .in("phase", [
          "write_in_flight",
          "write_acknowledged",
          "outcome_unknown",
        ])
        .select("*")
        .maybeSingle()
      if (error || !data) {
        throw new Error("COMMERCIAL_IMPROVEMENT_RECONCILIATION_FAILED")
      }
      return publicExecution(record(data))
    }
    const { data } = await input.supabase
      .from("ebay_commercial_improvement_executions")
      .update({
        phase: "outcome_unknown",
        last_error_code: "COMMERCIAL_IMPROVEMENT_READBACK_RECONCILIATION_PENDING",
        updated_at: new Date().toISOString(),
      })
      .eq("id", preview.executionId)
      .in("phase", [
        "write_in_flight",
        "write_acknowledged",
        "outcome_unknown",
      ])
      .select("*")
      .maybeSingle()
    return data ? publicExecution(record(data)) : preview
  }

  const salePrice = preview.actionType === "PRICE"
    ? numeric(target.proposedLandedPrice)
    : numeric(officialBefore.price)
  const lunaState = endingListing
    ? await freshExactLunaVariant({
        supabase: input.supabase,
        listing: record(listing),
      })
    : null
  if (endingListing && !exactNumericZero(lunaState?.inventory_quantity)) {
    throw new Error("COMMERCIAL_IMPROVEMENT_LUNA_OUT_OF_STOCK_REQUIRED")
  }
  if (!endingListing && (salePrice === null || salePrice <= 0)) {
    throw new Error("COMMERCIAL_IMPROVEMENT_PRICE_REQUIRED")
  }
  const economics = endingListing ? null : await freshEconomics({
    supabase: input.supabase,
    listing: record(listing),
    salePrice: salePrice as number,
  })
  let promotionEvaluation = null
  if (preview.actionType === "PROMOTED_LISTINGS_GENERAL") {
    const storedEligibility = promotionEligibility(target.promotionEligibility)
    await assertPromotionConfigurationCurrent({
      supabase: input.supabase,
      accountKey: input.accountKey,
      configurationVersion: storedEligibility.configurationVersion,
    })
    const reservedPromotionPercent = economics?.economics.ready
      ? economics.economics.config.promotedListingsReserveRate * 100
      : null
    promotionEvaluation = evaluateSafePromotionRate({
      eligibility: {
        ...storedEligibility,
        costsComplete: economics?.economics.ready === true,
        economicsPassesProfitGate:
          economics?.economics.passesProfitGate === true,
        expectedNetProfit:
          economics?.economics.estimatedNetProfit ?? null,
        minimumNetProfit:
          economics?.economics.config.minimumNetProfit ??
          storedEligibility.minimumNetProfit,
        expectedMarginPercent:
          economics?.economics.estimatedNetMarginPercent === null ||
          economics?.economics.estimatedNetMarginPercent === undefined ||
          reservedPromotionPercent === null
            ? null
            : economics.economics.estimatedNetMarginPercent +
              reservedPromotionPercent,
        minimumMarginPercent: storedEligibility.minimumMarginPercent,
        expectedRoiPercent:
          economics?.economics.estimatedRoiPercent ?? null,
        minimumRoiPercent:
          economics?.economics.config.minimumRoiPercent ??
          storedEligibility.minimumRoiPercent,
        stockAvailable: economics?.stockAvailable ?? null,
        stockEvidenceFresh: true,
        evidenceFresh: true,
      },
    })
    const requestedRate = numeric(target.ratePercent)
    if (!promotionEvaluation.allowed || requestedRate === null ||
      Math.abs(requestedRate - promotionEvaluation.ratePercent) > 0.001 ||
      text(target.policyVersion, 80) !== promotionEvaluation.policyVersion ||
      text(target.configurationVersion, 80) !==
        promotionEvaluation.configurationVersion) {
      throw new Error(
        "COMMERCIAL_IMPROVEMENT_PROMOTION_ECONOMICS_CHANGED_REVIEW_REQUIRED",
      )
    }
  }
  if (preview.actionType === "PROMOTED_LISTINGS_GENERAL" &&
    await promotionBlocked({
      supabase: input.supabase,
      accountKey: input.accountKey,
      listingId: String(event.listing_id),
    })) {
    throw new Error(
      "COMMERCIAL_IMPROVEMENT_PROMOTION_BLOCKED_TEN_PERCENT_MARGIN",
    )
  }

  const proposedPrice = numeric(target.proposedPrice)
  const currentPrice = numeric(target.currentPrice)
  const commercialPolicy = endingListing
    ? evaluateEbayActiveListingCommercialPolicy({
        evidenceClass: "LUNA_OUT_OF_STOCK",
        evidenceObservedAt: lunaState?.captured_at,
        protectiveEvidenceVerified: true,
        exactLunaIdentity: true,
        supplierEvidenceFresh: true,
        exactLunaStock: lunaState?.inventory_quantity,
        humanConfirmation: true,
        idempotencyReady: true,
        readbackReady: true,
      })
    : confirmedSoldPolicyFromEvent({
        event: record(event),
        execution: {
          supplierEvidenceFresh: true,
          supplierAvailable: true,
          economicsApproved: economics?.economics.passesProfitGate === true,
          proposedPriceAtOrAboveFloor:
            salePrice !== null &&
            economics?.minimumOperatorPrice !== null &&
            economics?.minimumOperatorPrice !== undefined &&
            salePrice >= economics.minimumOperatorPrice,
          officialCurrentPriceUnchanged:
            currentPrice !== null && officialBefore.price !== null &&
            Math.abs(officialBefore.price - currentPrice) <= 0.01,
          promotionEvidenceApproved: promotionEvaluation?.allowed === true,
          humanConfirmation: true,
          idempotencyReady: true,
          readbackReady: true,
        },
      })
  const policyAllowsAction = endingListing
    ? commercialPolicy.canEndForOutOfStock
    : preview.actionType === "PROMOTED_LISTINGS_GENERAL"
      ? commercialPolicy.canPreparePromotion
      : commercialPolicy.canPreparePriceDecrease
  if (!policyAllowsAction) {
    throw new Error(
      commercialPolicy.blockerCodes[0] ??
      "CONFIRMED_SOLD_EVIDENCE_REQUIRED",
    )
  }
  if (preview.actionType === "PRICE" &&
    (proposedPrice === null || currentPrice === null ||
      officialBefore.price === null ||
      Math.abs(officialBefore.price - currentPrice) > 0.01)) {
    throw new Error("COMMERCIAL_IMPROVEMENT_PRICE_CHANGED_REVIEW_REQUIRED")
  }

  capabilityGrant = assertEbayProductionCapability({
    capability,
    stage: "effect",
    invocation: "interactive",
    authenticationMode: "admin_user",
    userId: input.actorId,
    accountKey: input.accountKey,
    marketplace: MARKETPLACE,
    resourceKey: preview.listingId,
    idempotencyKey: input.idempotencyKey,
    policyVersion: EBAY_ACTIVE_LISTING_COMMERCIAL_POLICY_VERSION,
    proposalHash: preview.requestHash,
    confirmedHumanAction: true,
    preflightPassed: true,
    preflightObservedAt: officialBefore.observedAt,
  }, capabilityGrant)
  const writeCredential = await getEbayWriteCredential(
    capability as EbayWriteCapability,
    capabilityGrant,
    fetchImpl,
  )
  const writeAccessToken = useEbayWriteCredential(
    writeCredential,
    capability as EbayWriteCapability,
    input.accountKey,
  )
  if (preview.actionType === "PROMOTED_LISTINGS_GENERAL") {
    await assertListingNotAlreadyPromoted({
      accessToken: writeAccessToken,
      listingId: String(event.listing_id),
      fetchImpl,
    })
  }

  const { data: claimed, error: claimError } = await input.supabase
    .from("ebay_commercial_improvement_executions")
    .update({
      phase: "write_in_flight",
      ebay_write_attempt_count: 1,
      ebay_write_dispatched: true,
      preflight_snapshot: {
        source: "EBAY_TRADING_GET_ITEM_AND_FRESH_LUNA",
        observedPrice: officialBefore.price,
        currency: officialBefore.currency,
        sku: officialBefore.ebaySku,
        lunaObservedAt: economics?.lunaObservedAt ?? lunaState?.captured_at,
        lunaProductUrl: target.lunaProductUrl ?? lunaState?.product_url,
        supplierAvailable: lunaState?.available ?? true,
        supplierInventoryQuantity: lunaState?.inventory_quantity ?? null,
        economics: economics?.economics ?? null,
        promotionEvaluation,
        commercialPolicy,
        capability,
        requestHash: preview.requestHash,
      },
      last_error_code: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", preview.executionId)
    .eq("actor_user_id", input.actorId)
    .eq("phase", "preview_ready")
    .eq("ebay_write_attempt_count", 0)
    .eq("ebay_write_dispatched", false)
    .select("*")
    .maybeSingle()
  if (claimError) throw new Error("COMMERCIAL_IMPROVEMENT_CLAIM_FAILED")
  if (!claimed) {
    const { data } = await input.supabase
      .from("ebay_commercial_improvement_executions")
      .select("*")
      .eq("id", preview.executionId)
      .maybeSingle()
    if (!data) throw new Error("COMMERCIAL_IMPROVEMENT_LEDGER_READ_FAILED")
    return publicExecution(record(data))
  }
  let row = record(claimed)
  try {
    if (preview.actionType === "END_LISTING") {
      await endListingOutOfStock({
        accessToken: writeAccessToken,
        listingId: String(event.listing_id),
        fetchImpl,
      })
      const { data: acknowledged, error } = await input.supabase
        .from("ebay_commercial_improvement_executions")
        .update({
          phase: "write_acknowledged",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("phase", "write_in_flight")
        .select("*")
        .single()
      if (error || !acknowledged) {
        throw new Error("COMMERCIAL_IMPROVEMENT_ACK_RECORD_FAILED")
      }
      row = record(acknowledged)
      const after = await readManualListingFromTradingApi(
        String(event.listing_id),
        fetchImpl,
      )
      if (after.ownership !== "inactive" ||
        after.listingStatus?.toLowerCase() === "active") {
        throw new Error("COMMERCIAL_IMPROVEMENT_END_READBACK_MISMATCH")
      }
      const endedAt = new Date().toISOString()
      const { error: registryError } = await input.supabase
        .from("ebay_active_listings")
        .update({ listing_status: "ended", updated_at: endedAt })
        .eq("id", listing.id)
        .eq("account_key", input.accountKey)
        .eq("listing_status", "active")
      if (registryError) {
        throw new Error(
          "COMMERCIAL_IMPROVEMENT_ACTIVE_REGISTRY_UPDATE_FAILED",
        )
      }
      const { data: completed, error: completeError } = await input.supabase
        .from("ebay_commercial_improvement_executions")
        .update({
          phase: "applied_verified",
          postflight_snapshot: {
            source: "EBAY_TRADING_GET_ITEM_READBACK",
            listingStatus: after.listingStatus,
            ownership: after.ownership,
            observedAt: after.observedAt,
            localRegistryStatus: "ended",
          },
          applied_verified_at: endedAt,
          updated_at: endedAt,
        })
        .eq("id", row.id)
        .select("*")
        .single()
      if (completeError || !completed) {
        throw new Error("COMMERCIAL_IMPROVEMENT_COMPLETE_FAILED")
      }
      return publicExecution(record(completed))
    }

    if (preview.actionType === "PRICE") {
      await revisePrice({
        accessToken: writeAccessToken,
        listingId: String(event.listing_id),
        price: proposedPrice as number,
        currency: officialBefore.currency ?? "USD",
        fetchImpl,
      })
      const { data: acknowledged, error } = await input.supabase
        .from("ebay_commercial_improvement_executions")
        .update({
          phase: "write_acknowledged",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("phase", "write_in_flight")
        .select("*")
        .single()
      if (error || !acknowledged) {
        throw new Error("COMMERCIAL_IMPROVEMENT_ACK_RECORD_FAILED")
      }
      row = record(acknowledged)
      const after = await readManualListingFromTradingApi(
        String(event.listing_id),
        fetchImpl,
      )
      if (after.price === null ||
        Math.abs(after.price - (proposedPrice as number)) > 0.01) {
        throw new Error("COMMERCIAL_IMPROVEMENT_PRICE_READBACK_MISMATCH")
      }
      const { data: completed, error: completeError } = await input.supabase
        .from("ebay_commercial_improvement_executions")
        .update({
          phase: "applied_verified",
          postflight_snapshot: {
            source: "EBAY_TRADING_GET_ITEM_READBACK",
            price: after.price,
            currency: after.currency,
            observedAt: after.observedAt,
          },
          applied_verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .select("*")
        .single()
      if (completeError || !completed) {
        throw new Error("COMMERCIAL_IMPROVEMENT_COMPLETE_FAILED")
      }
      return publicExecution(record(completed))
    }

    const ratePercent = numeric(target.ratePercent)
    const durationDays = numeric(target.durationDays)
    if (ratePercent === null || durationDays === null ||
      promotionEvaluation?.allowed !== true) {
      throw new Error("COMMERCIAL_IMPROVEMENT_PROMOTION_PREFLIGHT_REQUIRED")
    }
    const campaign = await createPromotionCampaign({
      accessToken: writeAccessToken,
      listingId: String(event.listing_id),
      eventId: String(event.id),
      ratePercent,
      durationDays,
      fetchImpl,
    })
    const campaignRecorded = await input.supabase
      .from("ebay_commercial_improvement_executions")
      .update({
        ebay_resource_id: campaign.campaignId,
        ebay_write_attempt_count: 2,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("phase", "write_in_flight")
      .eq("ebay_write_attempt_count", 1)
      .select("*")
      .single()
    if (campaignRecorded.error || !campaignRecorded.data) {
      throw new Error("COMMERCIAL_IMPROVEMENT_CAMPAIGN_RECORD_FAILED")
    }
    row = record(campaignRecorded.data)
    await createPromotionAd({
      accessToken: writeAccessToken,
      campaignId: campaign.campaignId,
      listingId: String(event.listing_id),
      ratePercent,
      fetchImpl,
    })
    const acknowledged = await input.supabase
      .from("ebay_commercial_improvement_executions")
      .update({ phase: "write_acknowledged", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("phase", "write_in_flight")
      .select("*")
      .single()
    if (acknowledged.error || !acknowledged.data) {
      throw new Error("COMMERCIAL_IMPROVEMENT_ACK_RECORD_FAILED")
    }
    row = record(acknowledged.data)
    const verified = await verifyCampaignAd({
      accessToken: writeAccessToken,
      campaignId: campaign.campaignId,
      listingId: String(event.listing_id),
      ratePercent,
      fetchImpl,
    })
    if (!verified) {
      throw new Error("COMMERCIAL_IMPROVEMENT_PROMOTION_READBACK_MISMATCH")
    }
    const { data: completed, error: completeError } = await input.supabase
      .from("ebay_commercial_improvement_executions")
      .update({
        phase: "applied_verified",
        postflight_snapshot: {
          source: "EBAY_MARKETING_GET_ADS_READBACK",
          campaignName: campaign.campaignName,
          campaignId: campaign.campaignId,
          ratePercent,
          endsAt: campaign.endsAt,
          verified: true,
          policyVersion: target.policyVersion,
          configurationVersion: target.configurationVersion,
        },
        applied_verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .select("*")
      .single()
    if (completeError || !completed) {
      throw new Error("COMMERCIAL_IMPROVEMENT_COMPLETE_FAILED")
    }
    return publicExecution(record(completed))
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : "COMMERCIAL_IMPROVEMENT_OUTCOME_UNKNOWN"
    const { data: failed } = await input.supabase
      .from("ebay_commercial_improvement_executions")
      .update({
        phase: "outcome_unknown",
        last_error_code: code,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("ebay_write_dispatched", true)
      .select("*")
      .maybeSingle()
    if (!failed) throw new Error(code)
    return publicExecution(record(failed))
  }
}
