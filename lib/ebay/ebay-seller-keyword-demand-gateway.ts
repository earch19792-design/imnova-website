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
const BROWSE_SCOPE = "https://api.ebay.com/oauth/api_scope"
const MARKETPLACE_INSIGHTS_SCOPE =
  "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights"
const MARKETPLACE_ID = "EBAY_US"
const DETAIL_SAMPLE_LIMIT = 10

type JsonRecord = Record<string, unknown>

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

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message)
    ? message
    : "EBAY_READONLY_MARKET_VALIDATION_FAILED"
}

async function getApplicationToken(scope: string) {
  const clientId = process.env.EBAY_CLIENT_ID?.trim() ?? ""
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim() ?? ""
  if (!clientId || !clientSecret) {
    throw new Error("EBAY_READONLY_ENV_MISSING")
  }
  const credentials = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }),
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`EBAY_OAUTH_${response.status}`)
  const payload = record(await response.json())
  const accessToken = text(payload.access_token)
  if (!accessToken) throw new Error("EBAY_OAUTH_TOKEN_MISSING")
  return accessToken
}

async function getEbayJson(url: URL, accessToken: string) {
  assertEbaySellerKeywordReadonlyRequest(url.href, "GET")
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
      "X-EBAY-C-ENDUSERCTX":
        "contextualLocation=country%3DUS%2Czip%3D33487",
    },
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`EBAY_READONLY_GET_${response.status}`)
  return record(await response.json())
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
    source,
  }
}

async function searchActiveListings(query: string, token: string) {
  const url = new URL(BROWSE_SEARCH_ENDPOINT)
  url.searchParams.set("q", query)
  url.searchParams.set("limit", "30")
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
    const activeSearch = await searchActiveListings(query, browseToken)
    const activeDetails = await Promise.all(
      activeSearch.items
        .slice(0, DETAIL_SAMPLE_LIMIT)
        .map((item) => enrichActiveListing(item, browseToken))
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
        insightsAvailability = /403|401|OAUTH/.test(code)
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
      insightsAvailability,
    })
  } finally {
    browseToken = ""
    insightsToken = ""
  }
}
