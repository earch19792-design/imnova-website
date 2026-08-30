import { Buffer } from "node:buffer"

const API_ORIGIN = "https://api.ebay.com"
const TOKEN_ENDPOINT = `${API_ORIGIN}/identity/v1/oauth2/token`
const MARKETING_ENDPOINT = `${API_ORIGIN}/sell/marketing/v1`
const BASE_SCOPE = "https://api.ebay.com/oauth/api_scope"
const MARKETING_READONLY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.marketing.readonly"
const MARKETPLACE_ID = "EBAY_US"
const REQUEST_TIMEOUT_MS = 12_000

type JsonRecord = Record<string, unknown>

export type EbayPromotionStateReadonlyV1 = {
  status: "AVAILABLE" | "UNPROVEN"
  promotionState: "ACTIVE" | "INACTIVE" | "UNPROVEN"
  promotionType: "PROMOTED_LISTINGS_CPS" | "NONE" | "UNPROVEN"
  adRatePercent: number | null
  promotionFeeBasis: "FINAL_SALES_PRICE" | "NONE" | "UNPROVEN"
  priceDiscountState: "SEPARATE_NOT_EVALUATED"
  authority: "EBAY_MARKETING_FIND_CAMPAIGN_AND_AD_READONLY"
  limitationCode: string | null
  observedAt: string
  marketplaceId: "EBAY_US"
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown, maximum = 100) {
  const normalized = typeof value === "string" ? value.trim() : ""
  return normalized.slice(0, maximum)
}

function percentage(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
    ? parsed
    : null
}

function unproven(code: string, now: Date): EbayPromotionStateReadonlyV1 {
  return {
    status: "UNPROVEN",
    promotionState: "UNPROVEN",
    promotionType: "UNPROVEN",
    adRatePercent: null,
    promotionFeeBasis: "UNPROVEN",
    priceDiscountState: "SEPARATE_NOT_EVALUATED",
    authority: "EBAY_MARKETING_FIND_CAMPAIGN_AND_AD_READONLY",
    limitationCode: code,
    observedAt: now.toISOString(),
    marketplaceId: MARKETPLACE_ID,
  }
}

export function parseEbayPromotionStateReadonlyV1(input: {
  campaignsPayload: unknown
  adsByCampaignId: Record<string, unknown>
  ebayItemId: string
  now?: Date
}): EbayPromotionStateReadonlyV1 {
  const now = input.now ?? new Date()
  const campaigns = Array.isArray(record(input.campaignsPayload).campaigns)
    ? (record(input.campaignsPayload).campaigns as unknown[]).map(record)
    : []
  const active = campaigns.filter((campaign) =>
    text(campaign.marketplaceId).toUpperCase() === MARKETPLACE_ID &&
    text(campaign.campaignStatus).toUpperCase() === "RUNNING" &&
    text(record(campaign.fundingStrategy).fundingModel).toUpperCase() ===
      "COST_PER_SALE")
  if (active.length === 0) {
    return {
      status: "AVAILABLE",
      promotionState: "INACTIVE",
      promotionType: "NONE",
      adRatePercent: null,
      promotionFeeBasis: "NONE",
      priceDiscountState: "SEPARATE_NOT_EVALUATED",
      authority: "EBAY_MARKETING_FIND_CAMPAIGN_AND_AD_READONLY",
      limitationCode: null,
      observedAt: now.toISOString(),
      marketplaceId: MARKETPLACE_ID,
    }
  }
  if (active.length !== 1) {
    return unproven("EBAY_PROMOTION_MULTIPLE_ACTIVE_CPS_CAMPAIGNS", now)
  }
  const campaign = active[0]
  const campaignId = text(campaign.campaignId)
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(campaignId)) {
    return unproven("EBAY_PROMOTION_CAMPAIGN_ID_UNPROVEN", now)
  }
  const ads = Array.isArray(record(input.adsByCampaignId[campaignId]).ads)
    ? (record(input.adsByCampaignId[campaignId]).ads as unknown[]).map(record)
    : []
  const listingAds = ads.filter((ad) => text(ad.listingId, 20) === input.ebayItemId)
  if (listingAds.length !== 1) {
    return unproven("EBAY_PROMOTION_EXACT_LISTING_AD_UNPROVEN", now)
  }
  const adRatePercent = percentage(listingAds[0]?.bidPercentage) ??
    percentage(record(campaign.fundingStrategy).bidPercentage)
  if (adRatePercent === null) {
    return unproven("EBAY_PROMOTION_AD_RATE_UNPROVEN", now)
  }
  return {
    status: "AVAILABLE",
    promotionState: "ACTIVE",
    promotionType: "PROMOTED_LISTINGS_CPS",
    adRatePercent,
    promotionFeeBasis: "FINAL_SALES_PRICE",
    priceDiscountState: "SEPARATE_NOT_EVALUATED",
    authority: "EBAY_MARKETING_FIND_CAMPAIGN_AND_AD_READONLY",
    limitationCode: null,
    observedAt: now.toISOString(),
    marketplaceId: MARKETPLACE_ID,
  }
}

function credential(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : ""
  return normalized && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : ""
}

async function accessToken(fetchImpl: typeof fetch) {
  const clientId = credential(process.env.EBAY_CLIENT_ID)
  const clientSecret = credential(process.env.EBAY_CLIENT_SECRET)
  const refreshToken = credential(
    process.env.EBAY_MARKETING_READONLY_REFRESH_TOKEN,
  )
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("MARKETING_READONLY_OAUTH_REQUIRED")
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
      scope: `${BASE_SCOPE} ${MARKETING_READONLY_SCOPE}`,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const body = record(await response.json().catch(() => ({})))
  const token = text(body.access_token, 8_000)
  if (!response.ok || !token) {
    throw new Error("EBAY_MARKETING_READONLY_OAUTH_SCOPE_REQUIRED")
  }
  return token
}

async function getJson(url: URL, token: string, fetchImpl: typeof fetch) {
  if (url.origin !== API_ORIGIN || !url.pathname.startsWith(
    "/sell/marketing/v1/",
  )) throw new Error("EBAY_MARKETING_READONLY_ENDPOINT_BLOCKED")
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const body = record(await response.json().catch(() => ({})))
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("EBAY_MARKETING_READONLY_SCOPE_REQUIRED")
    }
    throw new Error(`EBAY_MARKETING_READONLY_HTTP_${response.status}`)
  }
  return body
}

export async function readEbayPromotionStateReadonlyV1(
  ebayItemId: string,
  fetchImpl: typeof fetch = fetch,
) {
  if (!/^\d{9,20}$/.test(ebayItemId)) {
    throw new Error("EBAY_MARKETING_READONLY_ITEM_ID_INVALID")
  }
  const token = await accessToken(fetchImpl)
  const campaignsUrl = new URL(
    `${MARKETING_ENDPOINT}/ad_campaign/find_campaign_by_ad_reference`,
  )
  campaignsUrl.searchParams.set("listing_id", ebayItemId)
  const campaignsPayload = await getJson(campaignsUrl, token, fetchImpl)
  const campaigns = Array.isArray(campaignsPayload.campaigns)
    ? campaignsPayload.campaigns.map(record)
    : []
  const adsByCampaignId: Record<string, unknown> = {}
  for (const campaign of campaigns) {
    if (
      text(campaign.marketplaceId).toUpperCase() !== MARKETPLACE_ID ||
      text(campaign.campaignStatus).toUpperCase() !== "RUNNING" ||
      text(record(campaign.fundingStrategy).fundingModel).toUpperCase() !==
        "COST_PER_SALE"
    ) continue
    const campaignId = text(campaign.campaignId)
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(campaignId)) continue
    const adsUrl = new URL(
      `${MARKETING_ENDPOINT}/ad_campaign/${encodeURIComponent(campaignId)}/ad`,
    )
    adsUrl.searchParams.set("limit", "500")
    adsByCampaignId[campaignId] = await getJson(adsUrl, token, fetchImpl)
  }
  return parseEbayPromotionStateReadonlyV1({
    campaignsPayload,
    adsByCampaignId,
    ebayItemId,
  })
}
