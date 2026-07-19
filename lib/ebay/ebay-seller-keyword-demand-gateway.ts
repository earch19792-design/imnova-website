import { createHash } from "node:crypto"

import { getSupabaseAdminClient } from "../supabase-admin"

import {
  assertEbaySellerKeywordReadonlyRequest,
  buildOfficialEbayVisualMetadata,
  buildEbaySellerKeywordDemandValidation,
  buildEbaySellerKeywordSearchQuery,
  type EbaySellerComparableInput,
  type EbaySellerKeywordCandidate,
} from "./ebay-seller-keyword-demand-validation"
import {
  createEbayReadonlyQuotaLimitError,
  createEbayReadonlyRateLimitError,
  getEbayReadonlyRateLimitMetadata,
} from "./ebay-readonly-rate-limit"
import {
  parseEbayApplicationBrowseQuota,
  type EbayApplicationBrowseQuota,
} from "./ebay-application-rate-limit"
import { validateGtinChecksum } from "./ebay-winner-evidence-v2"

const TOKEN_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token"
const BROWSE_SEARCH_ENDPOINT =
  "https://api.ebay.com/buy/browse/v1/item_summary/search"
const BROWSE_ITEM_ENDPOINT = "https://api.ebay.com/buy/browse/v1/item"
const MARKETPLACE_INSIGHTS_ENDPOINT =
  "https://api.ebay.com/buy/marketplace-insights/v1_beta/item_sales/search"
const BUY_MARKETING_ENDPOINT =
  "https://api.ebay.com/buy/marketing/v1_beta/merchandised_product"
const TAXONOMY_ENDPOINT = "https://api.ebay.com/commerce/taxonomy/v1"
const CATALOG_ENDPOINT = "https://api.ebay.com/commerce/catalog/v1_beta/product_summary/search"
const DEVELOPER_RATE_LIMIT_ENDPOINT =
  "https://api.ebay.com/developer/analytics/v1_beta/rate_limit/"
const BROWSE_SCOPE = "https://api.ebay.com/oauth/api_scope"
const MARKETPLACE_INSIGHTS_SCOPE =
  "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights"
const MARKETPLACE_ID = "EBAY_US"
// Deep analysis is deliberately bounded. Discovery uses one aggregate Browse
// search and only promoted candidates may spend detail budget.
const DEFAULT_DETAIL_SAMPLE_LIMIT = 5
const DETAIL_CONCURRENCY = 2
const EBAY_REQUEST_TIMEOUT_MS = 8_000
const EBAY_MAX_RETRIES = 3
const TAXONOMY_CACHE_TTL_MS = 6 * 60 * 60 * 1_000
const RATE_LIMIT_CACHE_TTL_MS = 5 * 60 * 1_000
const BROWSE_QUOTA_RESERVE = 50

export type EbayCatalogIdentityProduct = {
  epid: string | null
  title: string | null
  brand: string | null
  gtins: string[]
  mpns: string[]
  aspects: Array<{ name: string; values: string[] }>
  categoryId: string | null
}

export type EbayCatalogIdentityResult = {
  status: "AVAILABLE" | "NO_MATCH" | "REQUEST_FAILED" | "NOT_CONFIGURED"
  products: EbayCatalogIdentityProduct[]
  observedAt: string
  source: "EBAY_CATALOG_OFFICIAL_READONLY"
}

type JsonRecord = Record<string, unknown>

type TokenCacheEntry = {
  token: string
  expiresAt: number
}

type TaxonomyCacheEntry = {
  value: EbayTaxonomyListingIntelligence
  expiresAt: number
}

const tokenCache = new Map<string, TokenCacheEntry>()
const taxonomyCache = new Map<string, TaxonomyCacheEntry>()

function cacheFingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

async function readPersistentReadonlyCache<T>(apiFamily: "BROWSE_ITEM_DETAIL" | "TAXONOMY", key: string) {
  try {
    const { data, error } = await getSupabaseAdminClient()
      .from("ebay_readonly_detail_cache")
      .select("safe_payload")
      .eq("api_family", apiFamily)
      .eq("resource_fingerprint", cacheFingerprint(key))
      .gt("expires_at", new Date().toISOString())
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    return error ? null : data?.safe_payload as T | null
  } catch {
    return null
  }
}

async function writePersistentReadonlyCache(
  apiFamily: "BROWSE_ITEM_DETAIL" | "TAXONOMY",
  key: string,
  safePayload: Record<string, unknown>,
  ttlMs: number,
) {
  try {
    const observedAt = new Date().toISOString()
    await getSupabaseAdminClient().from("ebay_readonly_detail_cache").insert({
      api_family: apiFamily,
      resource_fingerprint: cacheFingerprint(key),
      safe_payload: safePayload,
      observed_at: observedAt,
      expires_at: new Date(Date.parse(observedAt) + ttlMs).toISOString(),
    })
  } catch {
    // Cache failure never blocks the official read-only request.
  }
}
let rateLimitCache: { value: EbayApplicationBrowseQuota; expiresAt: number } | null = null

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function detailSampleLimit() {
  const configured = Number(process.env.EBAY_LISTING_INTELLIGENCE_DETAIL_SAMPLE_LIMIT)
  return Number.isInteger(configured) ? Math.max(1, Math.min(configured, 10))
    : DEFAULT_DETAIL_SAMPLE_LIMIT
}

export async function getEbayApplicationBrowseQuota(): Promise<EbayApplicationBrowseQuota> {
  if (rateLimitCache && rateLimitCache.expiresAt > Date.now()) return rateLimitCache.value
  const unavailable = () => parseEbayApplicationBrowseQuota(null)
  let token = ""
  try {
    token = await getApplicationToken(BROWSE_SCOPE)
    const response = await fetch(DEVELOPER_RATE_LIMIT_ENDPOINT, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(EBAY_REQUEST_TIMEOUT_MS),
    })
    if (response.status === 429) throw createEbayReadonlyRateLimitError("EBAY_READONLY_GET_429", response, {
      apiFamily: "DEVELOPER_ANALYTICS", operation: "RATE_LIMIT", endpoint: "/developer/analytics/v1_beta/rate_limit/",
    })
    if (!response.ok) return unavailable()
    const value = parseEbayApplicationBrowseQuota(await response.json())
    rateLimitCache = { value, expiresAt: Date.now() + RATE_LIMIT_CACHE_TTL_MS }
    return value
  } catch (error) {
    throwIfRateLimited(error)
    return unavailable()
  } finally {
    token = ""
  }
}

async function enforceBrowseQuota(expectedCalls: number) {
  const quota = await getEbayApplicationBrowseQuota()
  if (quota.status === "AVAILABLE" && quota.remaining !== null &&
    quota.remaining <= BROWSE_QUOTA_RESERVE + expectedCalls && quota.resetAt) {
    throw createEbayReadonlyQuotaLimitError(quota.resetAt, Date.now(), {
      apiFamily: "BROWSE", operation: "QUOTA_PRECHECK", endpoint: "/buy/browse/v1",
    })
  }
}

function firstCategory(value: unknown) {
  const categories = array(value).map(record)
  return categories.at(-1) ?? categories[0] ?? {}
}

function firstAvailability(value: unknown) {
  return record(array(value)[0])
}

function firstShippingOption(value: unknown) {
  return record(array(value)[0])
}

function normalizeAspects(value: unknown) {
  return array(value).map(record).map((aspect) => ({
    name: text(aspect.name),
    value: text(aspect.value),
  })).filter((aspect) => aspect.name && aspect.value)
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
) {
  const output = new Array<R>(values.length)
  let cursor = 0
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor++
        output[index] = await mapper(values[index])
      }
    }
  )
  await Promise.all(workers)
  return output
}

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message)
    ? message
    : "EBAY_READONLY_MARKET_VALIDATION_FAILED"
}

function throwIfRateLimited(error: unknown) {
  if (getEbayReadonlyRateLimitMetadata(error)) throw error
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function retryDelay(response: Response, attempt: number) {
  const retryAfter = Number(response.headers.get("retry-after"))
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1_000, 8_000)
  }
  return Math.min(400 * (2 ** attempt), 3_200) + Math.floor(Math.random() * 200)
}

async function getApplicationToken(scope: string) {
  const cached = tokenCache.get(scope)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
  const clientId = process.env.EBAY_CLIENT_ID?.trim() ?? ""
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim() ?? ""
  if (!clientId || !clientSecret) {
    throw new Error("EBAY_READONLY_ENV_MISSING")
  }
  const credentials = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")
  for (let attempt = 0; attempt < EBAY_MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ grant_type: "client_credentials", scope }),
        cache: "no-store",
        signal: AbortSignal.timeout(EBAY_REQUEST_TIMEOUT_MS),
      })
      if (response.ok) {
        const payload = record(await response.json())
        const accessToken = text(payload.access_token)
        if (!accessToken) throw new Error("EBAY_OAUTH_TOKEN_MISSING")
        const expiresIn = Math.max(120, numberOrNull(payload.expires_in) ?? 7_200)
        tokenCache.set(scope, {
          token: accessToken,
          expiresAt: Date.now() + expiresIn * 1_000,
        })
        return accessToken
      }
      if (response.status === 429) {
        throw createEbayReadonlyRateLimitError("EBAY_OAUTH_429", response, {
          apiFamily: "OAUTH", operation: "APPLICATION_TOKEN", endpoint: "/identity/v1/oauth2/token",
        })
      }
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === EBAY_MAX_RETRIES - 1) {
        throw new Error(`EBAY_OAUTH_${response.status}`)
      }
      await wait(retryDelay(response, attempt))
    } catch (error) {
      const code = error instanceof Error ? error.message : ""
      if (code.startsWith("EBAY_OAUTH_") || attempt === EBAY_MAX_RETRIES - 1) throw error
      await wait(Math.min(400 * (2 ** attempt), 3_200) + Math.floor(Math.random() * 200))
    }
  }
  throw new Error("EBAY_OAUTH_FAILED")
}

function readonlyRequestContext(url: URL) {
  const endpoint = url.pathname
  if (endpoint.startsWith("/buy/browse/")) return { apiFamily: "BROWSE", operation: endpoint.includes("item_summary/search") ? "SEARCH" : "ITEM_DETAIL", endpoint }
  if (endpoint.startsWith("/commerce/catalog/")) return { apiFamily: "CATALOG", operation: "PRODUCT_SUMMARY_SEARCH", endpoint }
  if (endpoint.startsWith("/commerce/taxonomy/")) {
    const operation = endpoint.includes("get_default_category_tree_id") ? "DEFAULT_CATEGORY_TREE" :
      endpoint.includes("get_category_suggestions") ? "CATEGORY_SUGGESTIONS" : "CATEGORY_ASPECTS"
    return { apiFamily: "TAXONOMY", operation, endpoint }
  }
  if (endpoint.startsWith("/buy/marketplace_insights/")) return { apiFamily: "MARKETPLACE_INSIGHTS", operation: "SOLD_HISTORY_SEARCH", endpoint }
  if (endpoint.startsWith("/buy/marketing/")) return { apiFamily: "MARKETING", operation: "BEST_SELLING_PRODUCTS", endpoint }
  return { apiFamily: "EBAY_READONLY", operation: "GET", endpoint }
}

async function getEbayJson(url: URL, accessToken: string) {
  assertEbaySellerKeywordReadonlyRequest(url.href, "GET")
  for (let attempt = 0; attempt < EBAY_MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
          "X-EBAY-C-ENDUSERCTX":
            "contextualLocation=country%3DUS%2Czip%3D33487",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(EBAY_REQUEST_TIMEOUT_MS),
      })
      if (response.ok) return record(await response.json())
      if (response.status === 401) {
        for (const [scope, cached] of tokenCache) {
          if (cached.token === accessToken) tokenCache.delete(scope)
        }
      }
      if (response.status === 429) {
        throw createEbayReadonlyRateLimitError("EBAY_READONLY_GET_429", response, readonlyRequestContext(url))
      }
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === EBAY_MAX_RETRIES - 1) {
        throw new Error(`EBAY_READONLY_GET_${response.status}`)
      }
      await wait(retryDelay(response, attempt))
    } catch (error) {
      const code = error instanceof Error ? error.message : ""
      if (code.startsWith("EBAY_READONLY_GET_") || attempt === EBAY_MAX_RETRIES - 1) throw error
      await wait(Math.min(400 * (2 ** attempt), 3_200) + Math.floor(Math.random() * 200))
    }
  }
  throw new Error("EBAY_READONLY_GET_FAILED")
}

function mapComparable(
  value: unknown,
  source: EbaySellerComparableInput["source"]
): EbaySellerComparableInput {
  const item = record(value)
  const price = record(item.lastSoldPrice ?? item.price)
  const seller = record(item.seller)
  const image = record(item.image)
  const category = firstCategory(item.categories)
  const availability = firstAvailability(item.estimatedAvailabilities)
  const shippingOption = firstShippingOption(item.shippingOptions)
  const shippingCost = record(shippingOption.shippingCost)
  const returnTerms = record(item.returnTerms)
  return {
    itemId: text(item.itemId),
    epid: text(item.epid),
    title: text(item.title),
    itemWebUrl: text(item.itemWebUrl),
    imageUrl: text(image.imageUrl),
    price: numberOrNull(price.value),
    currency: text(price.currency) || "USD",
    categoryId: text(category.categoryId),
    categoryName: text(category.categoryName),
    sellerUsername: text(seller.username ?? seller.userId),
    sellerFeedbackScore: numberOrNull(seller.feedbackScore),
    sellerFeedbackPercentage: numberOrNull(seller.feedbackPercentage),
    totalSoldQuantity: numberOrNull(item.totalSoldQuantity),
    estimatedSoldQuantity: numberOrNull(availability.estimatedSoldQuantity),
    lastSoldDate: text(item.lastSoldDate),
    gtin: normalizedGtin(item.gtin) || null,
    brand: text(item.brand),
    mpn: text(item.mpn),
    model: text(item.model),
    lotSize: numberOrNull(item.lotSize),
    color: text(item.color),
    size: text(item.size),
    shortDescription: text(item.shortDescription),
    localizedAspects: normalizeAspects(item.localizedAspects),
    shippingCost: numberOrNull(shippingCost.value),
    returnsAccepted: returnTerms.returnsAccepted === true,
    itemOriginDate: text(item.itemOriginDate),
    itemEndDate: text(item.itemEndDate),
    visualEvidence: buildOfficialEbayVisualMetadata(item),
    source,
  }
}

function normalizedGtin(value: unknown) {
  const candidate = text(value).replace(/\D/g, "")
  return validateGtinChecksum(candidate) ? candidate : ""
}

function normalizedEpid(value: unknown) {
  const candidate = text(value)
  return /^\d{1,20}$/.test(candidate) ? candidate : ""
}

async function searchActiveListings(
  candidate: EbaySellerKeywordCandidate,
  query: string,
  token: string
) {
  const url = new URL(BROWSE_SEARCH_ENDPOINT)
  const gtin = normalizedGtin(candidate.gtin)
  const epid = normalizedEpid(candidate.epid)
  if (gtin) url.searchParams.set("gtin", gtin)
  else if (epid) url.searchParams.set("epid", epid)
  else url.searchParams.set("q", query)
  if (/^\d+$/.test(text(candidate.categoryId))) {
    url.searchParams.set("category_ids", text(candidate.categoryId))
  }
  url.searchParams.set("limit", "50")
  url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE},conditions:{NEW}")
  url.searchParams.set(
    "fieldgroups",
    "MATCHING_ITEMS,CATEGORY_REFINEMENTS,ASPECT_REFINEMENTS"
  )
  const payload = await getEbayJson(url, token)
  return {
    payload,
    items: array(payload.itemSummaries),
  }
}

export type EbayListingDiscoverySignals = {
  status: "AVAILABLE" | "NO_MATCH"
  observedAt: string
  source: "EBAY_BROWSE_DISCOVERY_READONLY"
  candidateFoundCount: number
  returnedCandidateCount: number
  sellerCount: number
  landedPriceRange: { minimum: number; maximum: number } | null
  packsObserved: number[]
  estimatedMovementSignals: number
  demandSignalClass: "ESTIMATED_DEMAND_SIGNALS" | "NONE"
  categoryId: string | null
  identitySignalScore: number
  discoveryScore: number
  basicRiskCodes: string[]
  fullCompetitorContentStored: false
  ebayWrites: 0
}

function normalizedWords(value: unknown) {
  return new Set(text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")
    .filter((word) => word.length >= 3))
}

function wordOverlap(left: unknown, right: unknown) {
  const expected = normalizedWords(left)
  const observed = normalizedWords(right)
  if (!expected.size || !observed.size) return 0
  const matches = [...expected].filter((word) => observed.has(word)).length
  return matches / expected.size
}

function structuredPackCount(item: JsonRecord) {
  for (const aspect of normalizeAspects(item.localizedAspects)) {
    if (!/^(number in pack|pack quantity|pack size)$/i.test(aspect.name)) continue
    const parsed = Number(aspect.value.match(/^\s*(\d{1,3})\s*$/)?.[1])
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 100) return parsed
  }
  return null
}

/**
 * One Browse search per Luna variant. This is deliberately shallower than Loop 1:
 * it stores aggregate signals only and never enriches individual listings.
 */
export async function discoverEbayListingSignals(
  candidate: EbaySellerKeywordCandidate,
): Promise<EbayListingDiscoverySignals> {
  const observedAt = new Date().toISOString()
  const query = buildEbaySellerKeywordSearchQuery(candidate)
  if (query.length < 3) throw new Error("EBAY_SEARCH_QUERY_TOO_SHORT")
  let token = ""
  try {
    await enforceBrowseQuota(1)
    token = await getApplicationToken(BROWSE_SCOPE)
    // Exactly one search per family/lightweight pass. A different query may be
    // scheduled later after cache expiry; it is never an eager fallback here.
    const search = await searchActiveListings(candidate, query, token)
    const items = search.items.map(record)
    const sellers = new Set(items.map((item) => text(record(item.seller).username ??
      record(item.seller).userId)).filter(Boolean))
    const landedPrices = items.map((item) => {
      const price = numberOrNull(record(item.price).value)
      const shipping = numberOrNull(record(firstShippingOption(item.shippingOptions).shippingCost).value) ?? 0
      return price === null ? null : price + shipping
    }).filter((value): value is number => value !== null)
    const packsObserved = [...new Set(items.map(structuredPackCount)
      .filter((value): value is number => value !== null))].sort((left, right) => left - right)
    const estimatedMovementSignals = items.reduce((sum, item) =>
      sum + Math.max(0, numberOrNull(firstAvailability(item.estimatedAvailabilities)
        .estimatedSoldQuantity) ?? 0), 0)
    const candidateGtin = normalizedGtin(candidate.gtin)
    const exactGtinObserved = Boolean(candidateGtin && items.some((item) =>
      normalizedGtin(item.gtin) === candidateGtin))
    const candidateBrand = text(candidate.brand).toLowerCase()
    const brandAgreement = candidateBrand && items.length
      ? items.filter((item) => text(item.brand).toLowerCase() === candidateBrand).length / items.length : 0
    const titleAgreement = items.length
      ? Math.max(...items.map((item) => wordOverlap(candidate.productName, item.title))) : 0
    const identitySignalScore = Math.min(100, Math.round(
      (exactGtinObserved ? 55 : 0) + brandAgreement * 20 + titleAgreement * 25,
    ))
    const basicRiskCodes = [
      ...items.length ? [] : ["NO_EBAY_CANDIDATES"],
      ...landedPrices.length ? [] : ["MARKET_PRICE_UNAVAILABLE"],
      ...identitySignalScore < 35 ? ["WEAK_DISCOVERY_IDENTITY_SIGNAL"] : [],
      ...sellers.size <= 1 ? ["SELLER_CONCENTRATION"] : [],
    ]
    const discoveryScore = Math.max(0, Math.min(100, Math.round(
      identitySignalScore * .4 + Math.min(20, items.length / 2) +
      Math.min(15, sellers.size * 3) + Math.min(15, estimatedMovementSignals * 2) +
      (landedPrices.length ? 10 : 0) - basicRiskCodes.length * 3,
    )))
    return {
      status: items.length ? "AVAILABLE" : "NO_MATCH",
      observedAt,
      source: "EBAY_BROWSE_DISCOVERY_READONLY",
      candidateFoundCount: numberOrNull(search.payload.total) ?? items.length,
      returnedCandidateCount: items.length,
      sellerCount: sellers.size,
      landedPriceRange: landedPrices.length
        ? { minimum: Math.min(...landedPrices), maximum: Math.max(...landedPrices) } : null,
      packsObserved,
      estimatedMovementSignals,
      demandSignalClass: estimatedMovementSignals > 0 ? "ESTIMATED_DEMAND_SIGNALS" : "NONE",
      categoryId: inferCategoryId(candidate, search.payload, items) || null,
      identitySignalScore,
      discoveryScore,
      basicRiskCodes,
      fullCompetitorContentStored: false,
      ebayWrites: 0,
    }
  } finally {
    token = ""
  }
}

async function enrichActiveListing(value: unknown, token: string) {
  const summary = record(value)
  const itemId = text(summary.itemId)
  if (!itemId) return summary
  try {
    const url = new URL(`${BROWSE_ITEM_ENDPOINT}/${encodeURIComponent(itemId)}`)
    const detail = await getEbayJson(url, token)
    return { ...summary, ...detail }
  } catch (error) {
    throwIfRateLimited(error)
    return summary
  }
}

async function mappedActiveComparable(value: unknown, token: string) {
  const summary = record(value)
  const itemId = text(summary.itemId)
  const key = itemId ? `item:${itemId}` : ""
  const cached = key
    ? await readPersistentReadonlyCache<EbaySellerComparableInput>("BROWSE_ITEM_DETAIL", key)
    : null
  if (cached) return cached
  const mapped = mapComparable(await enrichActiveListing(summary, token), "EBAY_BROWSE_ACTIVE_LISTING")
  if (key) {
    await writePersistentReadonlyCache("BROWSE_ITEM_DETAIL", key, {
      ...mapped,
      imageUrl: null,
      itemWebUrl: null,
    }, 48 * 60 * 60_000)
  }
  return mapped
}

function inferCategoryId(
  candidate: EbaySellerKeywordCandidate,
  searchPayload: JsonRecord,
  activeItems: unknown[]
) {
  if (/^\d+$/.test(text(candidate.categoryId))) return text(candidate.categoryId)
  const dominantCategoryId = text(searchPayload.dominantCategoryId)
  if (dominantCategoryId) return dominantCategoryId
  return text(firstCategory(record(activeItems[0]).categories).categoryId)
}

async function searchSoldHistory(
  query: string,
  categoryId: string,
  token: string
) {
  const url = new URL(MARKETPLACE_INSIGHTS_ENDPOINT)
  url.searchParams.set("q", query)
  url.searchParams.set("category_ids", categoryId)
  url.searchParams.set("limit", "50")
  url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE},conditions:{NEW}")
  const payload = await getEbayJson(url, token)
  return array(payload.itemSales)
}

export async function runEbaySellerKeywordDemandValidation(
  candidate: EbaySellerKeywordCandidate
) {
  const query = buildEbaySellerKeywordSearchQuery(candidate)
  if (query.length < 3) throw new Error("EBAY_SEARCH_QUERY_TOO_SHORT")

  let browseToken = ""
  let insightsToken = ""
  try {
    await enforceBrowseQuota(1 + detailSampleLimit())
    browseToken = await getApplicationToken(BROWSE_SCOPE)
    let activeSearch = await searchActiveListings(candidate, query, browseToken)
    if (activeSearch.items.length === 0 && normalizedGtin(candidate.gtin)) {
      activeSearch = await searchActiveListings(
        { ...candidate, gtin: null },
        query,
        browseToken
      )
    }
    const activeComparables = (await mapWithConcurrency(
      activeSearch.items.slice(0, detailSampleLimit()),
      DETAIL_CONCURRENCY,
      (item) => mappedActiveComparable(item, browseToken)
    )).map((mapped) => {
      return mapped.estimatedSoldQuantity && mapped.estimatedSoldQuantity > 0
        ? { ...mapped, source: "EBAY_BROWSE_ESTIMATED_SALES" as const }
        : mapped
    })

    let insightsAvailability:
      | "AVAILABLE"
      | "NOT_CONFIGURED"
      | "NOT_ENTITLED"
      | "REQUEST_FAILED" = "NOT_CONFIGURED"
    let soldComparables: EbaySellerComparableInput[] = []
    const insightsEnabled =
      process.env.EBAY_MARKETPLACE_INSIGHTS_ENABLED?.trim() === "true"
    const categoryId = inferCategoryId(
      candidate,
      activeSearch.payload,
      activeSearch.items
    )
    if (insightsEnabled && categoryId) {
      try {
        insightsToken = await getApplicationToken(MARKETPLACE_INSIGHTS_SCOPE)
        const soldItems = await searchSoldHistory(query, categoryId, insightsToken)
        soldComparables = soldItems.map((item) =>
          mapComparable(item, "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY")
        )
        insightsAvailability = "AVAILABLE"
      } catch (error) {
        throwIfRateLimited(error)
        const code = safeErrorCode(error)
        insightsAvailability = /(?:OAUTH|READONLY_GET)_(?:401|403)$/.test(code)
          ? "NOT_ENTITLED"
          : "REQUEST_FAILED"
      }
    }

    const byId = new Map<string, EbaySellerComparableInput>()
    for (const comparable of [...activeComparables, ...soldComparables]) {
      const key = comparable.itemId || `${comparable.source}:${comparable.title}`
      byId.set(key, comparable)
    }
    return buildEbaySellerKeywordDemandValidation({
      candidate,
      comparables: [...byId.values()],
      candidateFoundCount:
        numberOrNull(activeSearch.payload.total) ?? activeSearch.items.length,
      returnedCandidateCount: activeSearch.items.length,
      enrichedSampleCount: activeComparables.length,
      insightsAvailability,
    })
  } finally {
    browseToken = ""
    insightsToken = ""
  }
}

export type EbayBestSellingProductSignal = {
  categoryId: string
  epid: string | null
  title: string
  imageUrl: string | null
  averageRating: number | null
  ratingCount: number | null
  reviewCount: number | null
  evidenceClass: "EBAY_MARKETING_BEST_SELLING_PRODUCT"
}

export async function discoverEbayBestSellingProducts(
  categoryId: string
): Promise<{
  status: "AVAILABLE" | "NOT_AUTHORIZED" | "REQUEST_FAILED"
  products: EbayBestSellingProductSignal[]
}> {
  if (!/^\d+$/.test(categoryId)) {
    throw new Error("EBAY_CATEGORY_ID_REQUIRED")
  }
  let token = ""
  try {
    token = await getApplicationToken(BROWSE_SCOPE)
    const url = new URL(BUY_MARKETING_ENDPOINT)
    url.searchParams.set("category_id", categoryId)
    url.searchParams.set("metric_name", "BEST_SELLING")
    const payload = await getEbayJson(url, token)
    const products = array(payload.merchandisedProducts).map(record).map((product) => ({
      categoryId,
      epid: text(product.epid) || null,
      title: text(product.title),
      imageUrl: text(record(product.image).imageUrl) || null,
      averageRating: numberOrNull(product.averageRating),
      ratingCount: numberOrNull(product.ratingCount),
      reviewCount: numberOrNull(product.reviewCount),
      evidenceClass: "EBAY_MARKETING_BEST_SELLING_PRODUCT" as const,
    })).filter((product) => product.title)
    return { status: "AVAILABLE", products }
  } catch (error) {
    throwIfRateLimited(error)
    const code = safeErrorCode(error)
    if (/(?:OAUTH|READONLY_GET)_(?:401|403)$/.test(code)) {
      return { status: "NOT_AUTHORIZED", products: [] }
    }
    return { status: "REQUEST_FAILED", products: [] }
  } finally {
    token = ""
  }
}

export type EbayTaxonomyAspectValueIntelligence = {
  value: string
  valueConstraints: Array<{
    applicableForAspectName: string
    applicableForAspectValues: string[]
  }>
}

export type EbayTaxonomyAspectIntelligence = {
  name: string
  required: boolean
  usage: string | null
  mode: string | null
  cardinality: string | null
  maxLength: number | null
  dataType: string | null
  format: string | null
  advancedDataType: string | null
  expectedRequiredByDate: string | null
  suggestedValues: string[]
  values: EbayTaxonomyAspectValueIntelligence[]
  valuesComplete: boolean
  constraintsComplete: boolean
}

function catalogStrings(value: unknown) {
  return [...new Set(array(value).map(text).filter(Boolean))]
}

function mapCatalogProduct(value: unknown): EbayCatalogIdentityProduct {
  const product = record(value)
  const aspects = array(product.aspects).map(record).map((aspect) => ({
    name: text(aspect.localizedName ?? aspect.name),
    values: catalogStrings(aspect.localizedValues ?? aspect.values),
  })).filter((aspect) => aspect.name && aspect.values.length)
  const category = record(array(product.categories)[0])
  return {
    epid: text(product.epid ?? product.ePID) || null,
    title: text(product.title) || null,
    brand: text(product.brand) || null,
    gtins: catalogStrings(product.gtins ?? product.gtin),
    mpns: catalogStrings(product.mpns ?? product.mpn),
    aspects,
    categoryId: text(product.primaryCategoryId ?? category.categoryId) || null,
  }
}

/** Official, read-only Catalog lookup. It never returns tokens or request headers. */
export async function searchEbayCatalogIdentity(input: {
  query: string
  gtin?: string | null
  mpn?: string | null
  categoryId?: string | null
}): Promise<EbayCatalogIdentityResult> {
  const observedAt = new Date().toISOString()
  if (!process.env.EBAY_CLIENT_ID?.trim() || !process.env.EBAY_CLIENT_SECRET?.trim()) {
    return { status: "NOT_CONFIGURED", products: [], observedAt,
      source: "EBAY_CATALOG_OFFICIAL_READONLY" }
  }
  let token = ""
  try {
    token = await getApplicationToken(BROWSE_SCOPE)
    const url = new URL(CATALOG_ENDPOINT)
    const gtin = normalizedGtin(input.gtin)
    if (gtin) url.searchParams.set("gtin", gtin)
    else if (text(input.mpn)) url.searchParams.set("mpn", text(input.mpn))
    else url.searchParams.set("q", text(input.query).slice(0, 350))
    if (/^\d+$/.test(text(input.categoryId))) url.searchParams.set("category_id", text(input.categoryId))
    url.searchParams.set("limit", "10")
    const payload = await getEbayJson(url, token)
    const products = array(payload.productSummaries).map(mapCatalogProduct)
      .filter((product) => Boolean(product.epid || product.gtins.length || product.title))
    return { status: products.length ? "AVAILABLE" : "NO_MATCH", products,
      observedAt, source: "EBAY_CATALOG_OFFICIAL_READONLY" }
  } catch (error) {
    throwIfRateLimited(error)
    return { status: "REQUEST_FAILED", products: [], observedAt,
      source: "EBAY_CATALOG_OFFICIAL_READONLY" }
  } finally {
    token = ""
  }
}

export type EbayTaxonomyListingIntelligence = {
  status: "AVAILABLE" | "CATEGORY_NOT_RESOLVED" | "REQUEST_FAILED"
  categoryTreeId: string | null
  categoryTreeVersion: string | null
  categoryId: string | null
  categoryName: string | null
  observedAt: string | null
  /** Complete aspect metadata used for server-side validation. */
  aspects: EbayTaxonomyAspectIntelligence[]
  requiredAspects: EbayTaxonomyAspectIntelligence[]
  recommendedAspects: EbayTaxonomyAspectIntelligence[]
  categoryResolution: "KNOWN_CATEGORY" | "TITLE_SUGGESTION" |
    "TITLE_SUGGESTION_FALLBACK" | "UNRESOLVED"
  failureCode: string | null
  source: "EBAY_TAXONOMY_OFFICIAL_READONLY"
}

function mapTaxonomyAspect(value: unknown) {
  const aspect = record(value)
  const constraint = record(aspect.aspectConstraint)
  const rawValues = array(aspect.aspectValues)
  const mappedValues = rawValues.map((rawValue) => {
    const aspectValue = record(rawValue)
    const rawValueConstraints = array(aspectValue.valueConstraints)
    const valueConstraints = rawValueConstraints.map((rawConstraint) => {
      const valueConstraint = record(rawConstraint)
      return {
        applicableForAspectName: text(valueConstraint.applicableForLocalizedAspectName),
        applicableForAspectValues: array(valueConstraint.applicableForLocalizedAspectValues)
          .map(text)
          .filter(Boolean),
      }
    })
    return {
      value: text(aspectValue.localizedValue),
      valueConstraints,
      constraintsComplete: valueConstraints.length === rawValueConstraints.length
        && valueConstraints.every((entry) =>
          Boolean(entry.applicableForAspectName)
          && entry.applicableForAspectValues.length > 0
        ),
    }
  })
  const values = mappedValues
    .filter((entry) => entry.value)
    .map(({ constraintsComplete: _complete, ...entry }) => entry)
  const parsedMaxLength = numberOrNull(constraint.aspectMaxLength)
  return {
    name: text(aspect.localizedAspectName),
    mode: text(constraint.aspectMode) || null,
    cardinality: text(constraint.itemToAspectCardinality) || null,
    maxLength: parsedMaxLength !== null && Number.isInteger(parsedMaxLength) && parsedMaxLength > 0
      ? parsedMaxLength
      : null,
    dataType: text(constraint.aspectDataType) || null,
    format: text(constraint.aspectFormat) || null,
    advancedDataType: text(constraint.aspectAdvancedDataType) || null,
    expectedRequiredByDate: text(constraint.expectedRequiredByDate) || null,
    required: constraint.aspectRequired === true,
    usage: text(constraint.aspectUsage),
    suggestedValues: values.map((entry) => entry.value).slice(0, 25),
    values,
    valuesComplete: values.length === rawValues.length,
    constraintsComplete: mappedValues.length === rawValues.length
      && mappedValues.every((entry) => entry.constraintsComplete),
  }
}

export async function getEbayTaxonomyListingIntelligence(
  query: string,
  knownCategoryId?: string | null
): Promise<EbayTaxonomyListingIntelligence> {
  let token = ""
  const normalizedKnownCategory = /^\d+$/.test(text(knownCategoryId))
    ? text(knownCategoryId)
    : ""
  const cacheKey = normalizedKnownCategory
    ? `category:${normalizedKnownCategory}`
    : `query:${query.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 160)}`
  const cached = taxonomyCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const persistentCached = await readPersistentReadonlyCache<EbayTaxonomyListingIntelligence>("TAXONOMY", cacheKey)
  if (persistentCached) {
    taxonomyCache.set(cacheKey, { value: persistentCached, expiresAt: Date.now() + TAXONOMY_CACHE_TTL_MS })
    return persistentCached
  }
  let resolvedCategoryId = normalizedKnownCategory
  let resolvedCategoryTreeId = ""
  let resolvedCategoryTreeVersion: string | null = null
  let failureCode: string | null = null
  const empty = (status: EbayTaxonomyListingIntelligence["status"], context?: {
    categoryTreeId?: string | null
    categoryTreeVersion?: string | null
  }): EbayTaxonomyListingIntelligence => ({
    status,
    categoryTreeId: context?.categoryTreeId ?? (resolvedCategoryTreeId || null),
    categoryTreeVersion: context?.categoryTreeVersion ?? resolvedCategoryTreeVersion,
    // Preserve a previously resolved numeric category for diagnostics and a
    // targeted retry, but never mark its aspects ready after a failed request.
    categoryId: resolvedCategoryId || null,
    categoryName: null,
    observedAt: null,
    aspects: [],
    requiredAspects: [],
    recommendedAspects: [],
    categoryResolution: "UNRESOLVED",
    failureCode,
    source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
  })
  try {
    token = await getApplicationToken(BROWSE_SCOPE)
    const treeUrl = new URL(`${TAXONOMY_ENDPOINT}/get_default_category_tree_id`)
    treeUrl.searchParams.set("marketplace_id", MARKETPLACE_ID)
    const treePayload = await getEbayJson(treeUrl, token)
    const categoryTreeId = text(treePayload.categoryTreeId)
    const categoryTreeVersion = text(treePayload.categoryTreeVersion) || null
    resolvedCategoryTreeId = categoryTreeId
    resolvedCategoryTreeVersion = categoryTreeVersion
    if (!categoryTreeId) return empty("REQUEST_FAILED")

    const suggestCategory = async () => {
      const suggestionUrl = new URL(
        `${TAXONOMY_ENDPOINT}/category_tree/${encodeURIComponent(categoryTreeId)}/get_category_suggestions`
      )
      suggestionUrl.searchParams.set("q", query.slice(0, 350))
      const suggestionPayload = await getEbayJson(suggestionUrl, token)
      const suggestion = record(array(suggestionPayload.categorySuggestions)[0])
      const category = record(suggestion.category)
      return { id: text(category.categoryId), name: text(category.categoryName) }
    }
    let categoryId = normalizedKnownCategory
    let categoryName = ""
    let categoryResolution: EbayTaxonomyListingIntelligence["categoryResolution"] =
      categoryId ? "KNOWN_CATEGORY" : "TITLE_SUGGESTION"
    if (!categoryId) {
      const suggestion = await suggestCategory()
      categoryId = suggestion.id
      categoryName = suggestion.name
      resolvedCategoryId = categoryId
    }
    if (!categoryId) {
      return empty("CATEGORY_NOT_RESOLVED", { categoryTreeId, categoryTreeVersion })
    }
    const getAspects = (targetCategoryId: string) => {
      const aspectsUrl = new URL(
        `${TAXONOMY_ENDPOINT}/category_tree/${encodeURIComponent(categoryTreeId)}/get_item_aspects_for_category`
      )
      aspectsUrl.searchParams.set("category_id", targetCategoryId)
      return getEbayJson(aspectsUrl, token)
    }
    let aspectsPayload: JsonRecord
    try {
      aspectsPayload = await getAspects(categoryId)
    } catch (knownCategoryError) {
      throwIfRateLimited(knownCategoryError)
      if (!normalizedKnownCategory) throw knownCategoryError
      // Categories copied from an active comparable can be old, non-leaf, or
      // simply unsuitable for the exact Luna product. Fall back only to the
      // current official leaf suggestion and still require its aspects call to
      // succeed before readiness can pass.
      const suggestion = await suggestCategory()
      if (!suggestion.id || suggestion.id === categoryId) throw knownCategoryError
      categoryId = suggestion.id
      categoryName = suggestion.name
      resolvedCategoryId = categoryId
      categoryResolution = "TITLE_SUGGESTION_FALLBACK"
      aspectsPayload = await getAspects(categoryId)
    }
    const aspects = array(aspectsPayload.aspects).map(mapTaxonomyAspect).filter((aspect) => aspect.name)
    const value: EbayTaxonomyListingIntelligence = {
      status: "AVAILABLE",
      categoryTreeId,
      categoryTreeVersion,
      categoryId,
      categoryName: categoryName || null,
      observedAt: new Date().toISOString(),
      aspects,
      requiredAspects: aspects.filter((aspect) => aspect.required),
      recommendedAspects: aspects.filter((aspect) => !aspect.required && aspect.usage === "RECOMMENDED"),
      categoryResolution,
      failureCode: null,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }
    taxonomyCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + TAXONOMY_CACHE_TTL_MS,
    })
    await writePersistentReadonlyCache(
      "TAXONOMY",
      cacheKey,
      value as unknown as Record<string, unknown>,
      TAXONOMY_CACHE_TTL_MS,
    )
    return value
  } catch (error) {
    throwIfRateLimited(error)
    const code = error instanceof Error ? error.message : ""
    failureCode = /^EBAY_READONLY_GET_(?:FAILED|\d{3})$/.test(code)
      ? code
      : "EBAY_TAXONOMY_REQUEST_FAILED"
    return empty("REQUEST_FAILED")
  } finally {
    token = ""
  }
}
