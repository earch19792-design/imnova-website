import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { extractPackQuantity } from "../marketplace/commercial-monitor-domain"
import {
  getEbayTradingReadOnlyAccessToken,
  readManualListingFromTradingApi,
  tradingXmlTagValue,
} from "./ebay-manual-listing-trading-readonly"
import { calculateEbayUnitEconomics } from "./ebay-unit-economics"
import {
  COMMERCIAL_IMPROVEMENT_CONFIRMATION,
  reviseActiveListingPriceRequestXml,
} from "./ebay-commercial-improvement-action-domain"

export { COMMERCIAL_IMPROVEMENT_CONFIRMATION,
  reviseActiveListingPriceRequestXml } from "./ebay-commercial-improvement-action-domain"

const MARKETPLACE = "EBAY_US"
const TRADING_ENDPOINT = "https://api.ebay.com/ws/api.dll"
const MARKETING_ENDPOINT = "https://api.ebay.com/sell/marketing/v1"
const TOKEN_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token"
const BASE_SCOPE = "https://api.ebay.com/oauth/api_scope"
const MARKETING_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.marketing"
const RULE_VERSION = "SELLER_OS_COMMERCIAL_IMPROVEMENT_ACTION_V1"

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
    .select("id,ebay_item_id,ebay_sku,supplier_sku,supplier_variant_id,title,ebay_price,currency,raw_payload,listing_status,updated_at")
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

function proposalFromEvent(event: JsonRecord) {
  const evidence = record(event.evidence)
  const price = record(evidence.priceRecommendation)
  const proposedPrice = numeric(price.proposedItemPrice)
  const currentPrice = numeric(price.currentItemPrice)
  const proposedLandedPrice = numeric(price.proposedLandedPrice)
  if (
    text(event.event_type) === "COMPETITOR_CONFIRMED_SOLD_PRICE_RECOMMENDATION" &&
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
  }
  if (
    text(event.event_type) === "COMPETITOR_ACTIVE_MARKET_PRICE_RECOMMENDATION" &&
    text(price.comparisonBasis) ===
      "EBAY_ACTIVE_MULTI_SELLER_MEDIAN_NOT_CONFIRMED_SOLD" &&
    ["LOWER_TO_ACTIVE_MARKET_SAFE_PRICE", "RAISE_TO_SAFE_FLOOR"]
      .includes(text(price.action)) &&
    proposedPrice !== null && proposedPrice > 0 && currentPrice !== null &&
    proposedLandedPrice !== null &&
    Math.abs(proposedPrice - currentPrice) >= 0.01 &&
    price.proposedPassesProfitGate === true
  ) return {
    actionType: "PRICE" as const,
    targetValue: {
      currentPrice: money(currentPrice),
      proposedPrice: money(proposedPrice),
      proposedLandedPrice: money(proposedLandedPrice),
      expectedMarginPercent: numeric(price.proposedEstimatedMarginPercent),
      expectedNetProfit: numeric(price.proposedEstimatedNetProfit),
      confidence: text(price.confidence, 20),
      evidenceClass: "ACTIVE_MARKET_MULTI_SELLER_NOT_CONFIRMED_SOLD",
      activeMarketMedianLandedPrice:
        numeric(price.activeMarketMedianLandedPrice),
      activeSellerCount: numeric(price.activeSellerCount),
      minimumSafeLandedPrice: numeric(price.minimumSafeLandedPrice),
      activeMarketNotConfirmedSale: true,
    },
  }
  const promotion = record(evidence.promotionRecommendation)
  if (
    text(event.event_type) === "LISTING_ZERO_VISIBILITY_REVIEW" &&
    text(promotion.status) === "READY_FOR_HUMAN_APPROVAL" &&
    numeric(promotion.recommendedRatePercent) === 5 &&
    numeric(promotion.durationDays) === 7
  ) return {
    actionType: "PROMOTED_LISTINGS_GENERAL" as const,
    targetValue: {
      ratePercent: 5,
      durationDays: 7,
      fundingModel: "COST_PER_SALE",
      adRateStrategy: "FIXED",
      experimentVariableCount: 1,
      evidenceClass: "ZERO_VISIBILITY_AFTER_COMPLETE_ORGANIC_WINDOW",
    },
  }
  throw new Error("COMMERCIAL_IMPROVEMENT_NOT_ACTIONABLE")
}

function publicExecution(row: JsonRecord) {
  return {
    executionId: text(row.id, 40),
    eventId: text(row.commercial_event_id, 40),
    listingId: text(row.listing_id, 20),
    sku: text(row.sku, 80) || null,
    actionType: text(row.action_type, 80),
    targetValue: record(row.target_value),
    phase: text(row.phase, 80),
    ebayWriteAttemptCount: numeric(row.ebay_write_attempt_count) ?? 0,
    appliedVerified: row.phase === "applied_verified",
    errorCode: text(row.last_error_code, 160) || null,
    confirmationRequired: COMMERCIAL_IMPROVEMENT_CONFIRMATION,
  }
}

export async function prepareEbayCommercialImprovement(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  eventId: string
  idempotencyKey: string
}) {
  const actorId = uuid(input.actorId)
  const eventId = uuid(input.eventId)
  const idempotencyKey = text(input.idempotencyKey, 120)
  if (!actorId || !eventId || !/^[A-Za-z0-9._:-]{8,120}$/.test(idempotencyKey)) {
    throw new Error("COMMERCIAL_IMPROVEMENT_PREPARE_INVALID")
  }
  const { event, listing } = await loadEventAndListing({ ...input, eventId })
  const proposal = proposalFromEvent(event)
  if (proposal.actionType === "PROMOTED_LISTINGS_GENERAL" && await promotionBlocked({
    supabase: input.supabase,
    accountKey: input.accountKey,
    listingId: String(event.listing_id),
  })) throw new Error("COMMERCIAL_IMPROVEMENT_PROMOTION_BLOCKED_TEN_PERCENT_MARGIN")
  const requestHash = sha256(JSON.stringify({
    version: RULE_VERSION,
    accountKey: input.accountKey,
    eventId,
    listingId: event.listing_id,
    activeListingId: listing.id,
    actionType: proposal.actionType,
    targetValue: proposal.targetValue,
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
      target_value: proposal.targetValue,
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
  const variantId = text(input.listing.supplier_variant_id, 80)
  if (!variantId) throw new Error("COMMERCIAL_IMPROVEMENT_LUNA_LINK_REQUIRED")
  const { data, error } = await input.supabase.from("market_radar_latest_variants")
    .select("price,available,captured_at")
    .eq("supplier_variant_id", variantId)
    .eq("source_key", "lunaportex")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data || data.available !== true) {
    throw new Error("COMMERCIAL_IMPROVEMENT_LUNA_AVAILABLE_REQUIRED")
  }
  const capturedAt = Date.parse(data.captured_at ?? "")
  const now = (input.observedAt ?? new Date()).getTime()
  if (!Number.isFinite(capturedAt) || capturedAt > now || now - capturedAt > 24 * 60 * 60_000) {
    throw new Error("COMMERCIAL_IMPROVEMENT_LUNA_FRESHNESS_REQUIRED")
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
  return { economics, lunaObservedAt: data.captured_at, packCount }
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

async function marketingAccessToken(fetchImpl: FetchLike) {
  const clientId = process.env.EBAY_CLIENT_ID?.trim() ?? ""
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim() ?? ""
  const refreshToken = process.env.EBAY_SELLER_REFRESH_TOKEN?.trim() ?? ""
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("EBAY_MARKETING_OAUTH_NOT_CONFIGURED")
  }
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: `${BASE_SCOPE} ${MARKETING_SCOPE}`,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  })
  const payload = record(await response.json().catch(() => ({})))
  const token = text(payload.access_token, 8_000)
  if (!response.ok || !token) throw new Error("EBAY_MARKETING_OAUTH_SCOPE_REQUIRED")
  return token
}

function campaignIdFromLocation(location: string | null) {
  const value = text(location, 1_000).split("/").filter(Boolean).at(-1) ?? ""
  return /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : ""
}

async function createFivePercentCampaign(input: {
  accessToken: string
  listingId: string
  eventId: string
  fetchImpl: FetchLike
}) {
  const start = new Date()
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60_000)
  const campaignName = `SellerOS-5pct-${input.listingId}-${input.eventId.slice(0, 8)}`
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
        bidPercentage: "5.0",
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

async function createFivePercentAd(input: {
  accessToken: string
  campaignId: string
  listingId: string
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
      body: JSON.stringify({ listingId: input.listingId, bidPercentage: "5.0" }),
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
    Math.abs((numeric(ad.bidPercentage) ?? 0) - 5) < 0.01)
}

export async function applyEbayCommercialImprovement(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  eventId: string
  idempotencyKey: string
  confirmation: string
  fetchImpl?: FetchLike
}) {
  if (input.confirmation !== COMMERCIAL_IMPROVEMENT_CONFIRMATION) {
    throw new Error("COMMERCIAL_IMPROVEMENT_CONFIRMATION_REQUIRED")
  }
  const preview = await prepareEbayCommercialImprovement(input)
  if (["applied_verified", "terminal_failure"].includes(preview.phase)) return preview
  const { event, listing } = await loadEventAndListing(input)
  const fetchImpl = input.fetchImpl ?? fetch
  const target = record(preview.targetValue)
  const officialBefore = await readManualListingFromTradingApi(String(event.listing_id), fetchImpl)
  if (officialBefore.ownership !== "verified" ||
    (event.sku && ![officialBefore.ebaySku, listing.supplier_sku].includes(event.sku))) {
    throw new Error("COMMERCIAL_IMPROVEMENT_OFFICIAL_IDENTITY_MISMATCH")
  }
  const salePrice = preview.actionType === "PRICE"
    ? numeric(target.proposedLandedPrice)
    : numeric(officialBefore.price)
  if (salePrice === null || salePrice <= 0) {
    throw new Error("COMMERCIAL_IMPROVEMENT_PRICE_REQUIRED")
  }
  const economics = await freshEconomics({
    supabase: input.supabase,
    listing: record(listing),
    salePrice,
  })
  if (preview.actionType === "PROMOTED_LISTINGS_GENERAL" && await promotionBlocked({
    supabase: input.supabase,
    accountKey: input.accountKey,
    listingId: String(event.listing_id),
  })) throw new Error("COMMERCIAL_IMPROVEMENT_PROMOTION_BLOCKED_TEN_PERCENT_MARGIN")

  const { data: claimed, error: claimError } = await input.supabase
    .from("ebay_commercial_improvement_executions")
    .update({
      phase: "write_in_flight",
      preflight_snapshot: {
        source: "EBAY_TRADING_GET_ITEM_AND_FRESH_LUNA",
        observedPrice: officialBefore.price,
        currency: officialBefore.currency,
        sku: officialBefore.ebaySku,
        lunaObservedAt: economics.lunaObservedAt,
        economics: economics.economics,
      },
      last_error_code: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", preview.executionId)
    .eq("actor_user_id", input.actorId)
    .eq("phase", "preview_ready")
    .select("*")
    .maybeSingle()
  if (claimError) throw new Error("COMMERCIAL_IMPROVEMENT_CLAIM_FAILED")
  if (!claimed) {
    const { data } = await input.supabase.from("ebay_commercial_improvement_executions")
      .select("*").eq("id", preview.executionId).maybeSingle()
    if (!data) throw new Error("COMMERCIAL_IMPROVEMENT_LEDGER_READ_FAILED")
    return publicExecution(record(data))
  }
  let row = record(claimed)
  try {
    if (preview.actionType === "PRICE") {
      const proposedPrice = numeric(target.proposedPrice)
      const currentPrice = numeric(target.currentPrice)
      if (proposedPrice === null || currentPrice === null ||
        officialBefore.price === null || Math.abs(officialBefore.price - currentPrice) > 0.01) {
        throw new Error("COMMERCIAL_IMPROVEMENT_PRICE_CHANGED_REVIEW_REQUIRED")
      }
      const accessToken = await getEbayTradingReadOnlyAccessToken(fetchImpl)
      await revisePrice({
        accessToken,
        listingId: String(event.listing_id),
        price: proposedPrice,
        currency: officialBefore.currency ?? "USD",
        fetchImpl,
      })
      row = { ...row, ebay_write_attempt_count: 1, ebay_write_dispatched: true }
      const { data: acknowledged, error } = await input.supabase
        .from("ebay_commercial_improvement_executions")
        .update({ phase: "write_acknowledged", ebay_write_attempt_count: 1,
          ebay_write_dispatched: true, updated_at: new Date().toISOString() })
        .eq("id", row.id).eq("phase", "write_in_flight").select("*").single()
      if (error || !acknowledged) throw new Error("COMMERCIAL_IMPROVEMENT_ACK_RECORD_FAILED")
      row = record(acknowledged)
      const after = await readManualListingFromTradingApi(String(event.listing_id), fetchImpl)
      if (after.price === null || Math.abs(after.price - proposedPrice) > 0.01) {
        throw new Error("COMMERCIAL_IMPROVEMENT_PRICE_READBACK_MISMATCH")
      }
      const { data: completed, error: completeError } = await input.supabase
        .from("ebay_commercial_improvement_executions")
        .update({ phase: "applied_verified", postflight_snapshot: {
          source: "EBAY_TRADING_GET_ITEM_READBACK", price: after.price,
          currency: after.currency, observedAt: after.observedAt,
        }, applied_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", row.id).select("*").single()
      if (completeError || !completed) throw new Error("COMMERCIAL_IMPROVEMENT_COMPLETE_FAILED")
      return publicExecution(record(completed))
    }

    const marketingToken = await marketingAccessToken(fetchImpl)
    await assertListingNotAlreadyPromoted({
      accessToken: marketingToken,
      listingId: String(event.listing_id),
      fetchImpl,
    })
    const campaign = await createFivePercentCampaign({
      accessToken: marketingToken,
      listingId: String(event.listing_id),
      eventId: String(event.id),
      fetchImpl,
    })
    row = { ...row, ebay_resource_id: campaign.campaignId,
      ebay_write_attempt_count: 1, ebay_write_dispatched: true }
    const campaignRecorded = await input.supabase
      .from("ebay_commercial_improvement_executions")
      .update({ ebay_resource_id: campaign.campaignId, ebay_write_attempt_count: 1,
        ebay_write_dispatched: true, updated_at: new Date().toISOString() })
      .eq("id", row.id).eq("phase", "write_in_flight").select("*").single()
    if (campaignRecorded.error || !campaignRecorded.data) {
      throw new Error("COMMERCIAL_IMPROVEMENT_CAMPAIGN_RECORD_FAILED")
    }
    row = record(campaignRecorded.data)
    await createFivePercentAd({
      accessToken: marketingToken,
      campaignId: campaign.campaignId,
      listingId: String(event.listing_id),
      fetchImpl,
    })
    const verified = await verifyCampaignAd({
      accessToken: marketingToken,
      campaignId: campaign.campaignId,
      listingId: String(event.listing_id),
      fetchImpl,
    })
    if (!verified) throw new Error("COMMERCIAL_IMPROVEMENT_PROMOTION_READBACK_MISMATCH")
    const { data: completed, error: completeError } = await input.supabase
      .from("ebay_commercial_improvement_executions")
      .update({ phase: "applied_verified", ebay_write_attempt_count: 2,
        postflight_snapshot: { source: "EBAY_MARKETING_GET_ADS_READBACK",
          campaignName: campaign.campaignName, campaignId: campaign.campaignId,
          ratePercent: 5, endsAt: campaign.endsAt, verified: true },
        applied_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", row.id).select("*").single()
    if (completeError || !completed) throw new Error("COMMERCIAL_IMPROVEMENT_COMPLETE_FAILED")
    return publicExecution(record(completed))
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : "COMMERCIAL_IMPROVEMENT_OUTCOME_UNKNOWN"
    const dispatched = row.ebay_write_dispatched === true ||
      (numeric(row.ebay_write_attempt_count) ?? 0) > 0
    const { data: failed } = await input.supabase
      .from("ebay_commercial_improvement_executions")
      .update({ phase: dispatched ? "outcome_unknown" : "preview_ready",
        last_error_code: code, updated_at: new Date().toISOString() })
      .eq("id", row.id).select("*").maybeSingle()
    if (!failed) throw new Error(code)
    if (!dispatched) throw new Error(code)
    return publicExecution(record(failed))
  }
}
