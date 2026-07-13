import {
  assertEbaySellerKeywordReadonlyRequest,
  buildEbaySellerKeywordDemandValidation,
  buildEbaySellerKeywordSearchQuery,
  type EbaySellerComparableInput,
  type EbaySellerKeywordCandidate,
} from "./ebay-seller-keyword-demand-validation"

const TOKEN_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token"
const BROWSE_SEARCH_ENDPOINT =
  "https://api.ebay.com/buy/browse/v1/item_summary/search"
const BROWSE_ITEM_ENDPOINT = "https://api.ebay.com/buy/browse/v1/item"
const MARKETPLACE_INSIGHTS_ENDPOINT =
  "https://api.ebay.com/buy/marketplace-insights/v1_beta/item_sales/search"
const BUY_MARKETING_ENDPOINT =
  "https://api.ebay.com/buy/marketing/v1_beta/merchandised_product"
const TAXONOMY_ENDPOINT = "https://api.ebay.com/commerce/taxonomy/v1"
const BROWSE_SCOPE = "https://api.ebay.com/oauth/api_scope"
const MARKETPLACE_INSIGHTS_SCOPE =
  "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights"
const MARKETPLACE_ID = "EBAY_US"
const DETAIL_SAMPLE_LIMIT = 20
const DETAIL_CONCURRENCY = 5
const EBAY_REQUEST_TIMEOUT_MS = 8_000
const EBAY_MAX_RETRIES = 3
const TAXONOMY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000

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
    gtin: text(item.gtin),
    brand: text(item.brand),
    mpn: text(item.mpn),
    color: text(item.color),
    size: text(item.size),
    shortDescription: text(item.shortDescription),
    localizedAspects: normalizeAspects(item.localizedAspects),
    shippingCost: numberOrNull(shippingCost.value),
    returnsAccepted: returnTerms.returnsAccepted === true,
    itemOriginDate: text(item.itemOriginDate),
    itemEndDate: text(item.itemEndDate),
    source,
  }
}

function normalizedGtin(value: unknown) {
  const candidate = text(value).replace(/\D/g, "")
  return /^\d{8,14}$/.test(candidate) ? candidate : ""
}

async function searchActiveListings(
  candidate: EbaySellerKeywordCandidate,
  query: string,
  token: string
) {
  const url = new URL(BROWSE_SEARCH_ENDPOINT)
  const gtin = normalizedGtin(candidate.gtin)
  if (gtin) url.searchParams.set("gtin", gtin)
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

async function enrichActiveListing(value: unknown, token: string) {
  const summary = record(value)
  const itemId = text(summary.itemId)
  if (!itemId) return summary
  try {
    const url = new URL(`${BROWSE_ITEM_ENDPOINT}/${encodeURIComponent(itemId)}`)
    const detail = await getEbayJson(url, token)
    return { ...summary, ...detail }
  } catch {
    return summary
  }
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
    browseToken = await getApplicationToken(BROWSE_SCOPE)
    let activeSearch = await searchActiveListings(candidate, query, browseToken)
    if (activeSearch.items.length === 0 && normalizedGtin(candidate.gtin)) {
      activeSearch = await searchActiveListings(
        { ...candidate, gtin: null },
        query,
        browseToken
      )
    }
    const activeDetails = await mapWithConcurrency(
      activeSearch.items.slice(0, DETAIL_SAMPLE_LIMIT),
      DETAIL_CONCURRENCY,
      (item) => enrichActiveListing(item, browseToken)
    )
    const activeComparables = activeDetails.map((item) => {
      const mapped = mapComparable(item, "EBAY_BROWSE_ACTIVE_LISTING")
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
      enrichedSampleCount: activeDetails.length,
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
    const code = safeErrorCode(error)
    if (/(?:OAUTH|READONLY_GET)_(?:401|403)$/.test(code)) {
      return { status: "NOT_AUTHORIZED", products: [] }
    }
    return { status: "REQUEST_FAILED", products: [] }
  } finally {
    token = ""
  }
}

export type EbayTaxonomyListingIntelligence = {
  status: "AVAILABLE" | "CATEGORY_NOT_RESOLVED" | "REQUEST_FAILED"
  categoryTreeId: string | null
  categoryId: string | null
  categoryName: string | null
  requiredAspects: Array<{
    name: string
    mode: string | null
    cardinality: string | null
    expectedRequiredByDate: string | null
    suggestedValues: string[]
  }>
  recommendedAspects: Array<{
    name: string
    mode: string | null
    cardinality: string | null
    expectedRequiredByDate: string | null
    suggestedValues: string[]
  }>
  source: "EBAY_TAXONOMY_OFFICIAL_READONLY"
}

function mapTaxonomyAspect(value: unknown) {
  const aspect = record(value)
  const constraint = record(aspect.aspectConstraint)
  return {
    name: text(aspect.localizedAspectName),
    mode: text(constraint.aspectMode) || null,
    cardinality: text(constraint.itemToAspectCardinality) || null,
    expectedRequiredByDate: text(constraint.expectedRequiredByDate) || null,
    required: constraint.aspectRequired === true,
    usage: text(constraint.aspectUsage),
    suggestedValues: array(aspect.aspectValues)
      .map(record)
      .map((entry) => text(entry.localizedValue))
      .filter(Boolean)
      .slice(0, 25),
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
  const empty = (status: EbayTaxonomyListingIntelligence["status"]): EbayTaxonomyListingIntelligence => ({
    status,
    categoryTreeId: null,
    categoryId: null,
    categoryName: null,
    requiredAspects: [],
    recommendedAspects: [],
    source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
  })
  try {
    token = await getApplicationToken(BROWSE_SCOPE)
    const treeUrl = new URL(`${TAXONOMY_ENDPOINT}/get_default_category_tree_id`)
    treeUrl.searchParams.set("marketplace_id", MARKETPLACE_ID)
    const treePayload = await getEbayJson(treeUrl, token)
    const categoryTreeId = text(treePayload.categoryTreeId)
    if (!categoryTreeId) return empty("REQUEST_FAILED")

    let categoryId = normalizedKnownCategory
    let categoryName = ""
    if (!categoryId) {
      const suggestionUrl = new URL(
        `${TAXONOMY_ENDPOINT}/category_tree/${encodeURIComponent(categoryTreeId)}/get_category_suggestions`
      )
      suggestionUrl.searchParams.set("q", query.slice(0, 350))
      const suggestionPayload = await getEbayJson(suggestionUrl, token)
      const suggestion = record(array(suggestionPayload.categorySuggestions)[0])
      const category = record(suggestion.category)
      categoryId = text(category.categoryId)
      categoryName = text(category.categoryName)
    }
    if (!categoryId) {
      return { ...empty("CATEGORY_NOT_RESOLVED"), categoryTreeId }
    }
    const aspectsUrl = new URL(
      `${TAXONOMY_ENDPOINT}/category_tree/${encodeURIComponent(categoryTreeId)}/get_item_aspects_for_category`
    )
    aspectsUrl.searchParams.set("category_id", categoryId)
    const aspectsPayload = await getEbayJson(aspectsUrl, token)
    const aspects = array(aspectsPayload.aspects).map(mapTaxonomyAspect).filter((aspect) => aspect.name)
    const value: EbayTaxonomyListingIntelligence = {
      status: "AVAILABLE",
      categoryTreeId,
      categoryId,
      categoryName: categoryName || null,
      requiredAspects: aspects.filter((aspect) => aspect.required).map(({ required: _required, usage: _usage, ...aspect }) => aspect),
      recommendedAspects: aspects.filter((aspect) => !aspect.required && aspect.usage === "RECOMMENDED").map(({ required: _required, usage: _usage, ...aspect }) => aspect),
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }
    taxonomyCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + TAXONOMY_CACHE_TTL_MS,
    })
    return value
  } catch {
    return empty("REQUEST_FAILED")
  } finally {
    token = ""
  }
}
