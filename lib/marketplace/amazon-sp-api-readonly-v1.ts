import { createHash } from "node:crypto"
import { gunzipSync } from "node:zlib"

export const AMAZON_SP_API_READONLY_V1 =
  "SELLER_OS_AMAZON_SP_API_READONLY_V1" as const
export const AMAZON_US_MARKETPLACE_ID_V1 = "ATVPDKIKX0DER" as const

type Json = Record<string, unknown>
type FetchLike = typeof fetch
type SleepLike = (milliseconds: number) => Promise<void>

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Json : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function clean(value: unknown, maximum = 500) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ")
  return normalized && !/[\p{Cc}\p{Cf}]/u.test(normalized)
    ? normalized.slice(0, maximum) : null
}

function numeric(value: unknown) {
  if (typeof value !== "number" &&
      !(typeof value === "string" && value.trim())) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function amount(value: unknown) {
  const input = record(value)
  return numeric(input.amount ?? input.Amount ?? input.currencyAmount)
}

function iso(value: unknown) {
  const parsed = Date.parse(String(value ?? ""))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

export type AmazonSpApiReadOnlyConfigurationV1 = Readonly<{
  status: "READY" | "NOT_CONFIGURED" | "INVALID_CONFIG"
  endpoint: "https://sellingpartnerapi-na.amazon.com"
  marketplaceId: string
  sellerId: string | null
  skuPrefix: string
  missing: readonly string[]
  credentialsExposed: false
}>

export function getAmazonSpApiReadOnlyConfigurationV1(
  environment: NodeJS.ProcessEnv = process.env,
): AmazonSpApiReadOnlyConfigurationV1 {
  const clientId = environment.AMAZON_SP_API_LWA_CLIENT_ID?.trim() ?? ""
  const clientSecret = environment.AMAZON_SP_API_LWA_CLIENT_SECRET?.trim() ?? ""
  const refreshToken = environment.AMAZON_SP_API_REFRESH_TOKEN?.trim() ?? ""
  const sellerId = environment.AMAZON_SP_API_SELLER_ID?.trim() ?? ""
  const marketplaceId = environment.AMAZON_SP_API_MARKETPLACE_ID?.trim() ||
    AMAZON_US_MARKETPLACE_ID_V1
  const skuPrefix = environment.AMAZON_CONNIE_SKU_PREFIX?.trim() || "CON-"
  const missing = [
    ["AMAZON_SP_API_LWA_CLIENT_ID", clientId],
    ["AMAZON_SP_API_LWA_CLIENT_SECRET", clientSecret],
    ["AMAZON_SP_API_REFRESH_TOKEN", refreshToken],
    ["AMAZON_SP_API_SELLER_ID", sellerId],
  ].filter((entry) => !entry[1]).map((entry) => entry[0])
  const valid = /^[A-Z0-9]{6,20}$/.test(marketplaceId) &&
    /^[\p{L}\p{N}._:/-]{2,20}$/u.test(skuPrefix) &&
    (!sellerId || /^[A-Z0-9]{8,30}$/.test(sellerId))
  return Object.freeze({
    status: !valid ? "INVALID_CONFIG" : missing.length ? "NOT_CONFIGURED"
      : "READY",
    endpoint: "https://sellingpartnerapi-na.amazon.com" as const,
    marketplaceId,
    sellerId: sellerId || null,
    skuPrefix,
    missing: Object.freeze(missing),
    credentialsExposed: false as const,
  })
}

type RuntimeConfig = AmazonSpApiReadOnlyConfigurationV1 & Readonly<{
  clientId: string
  clientSecret: string
  refreshToken: string
}>

function runtimeConfig(environment: NodeJS.ProcessEnv): RuntimeConfig {
  const safe = getAmazonSpApiReadOnlyConfigurationV1(environment)
  if (safe.status !== "READY" || !safe.sellerId) {
    throw new Error(safe.status === "INVALID_CONFIG"
      ? "AMAZON_SP_API_CONFIGURATION_INVALID"
      : "AMAZON_SP_API_CONNECTION_REQUIRED")
  }
  return Object.freeze({ ...safe,
    clientId: environment.AMAZON_SP_API_LWA_CLIENT_ID!.trim(),
    clientSecret: environment.AMAZON_SP_API_LWA_CLIENT_SECRET!.trim(),
    refreshToken: environment.AMAZON_SP_API_REFRESH_TOKEN!.trim(),
  })
}

let tokenCache: { key: string; token: string; expiresAt: number } | null = null

async function accessToken(config: RuntimeConfig, fetcher: FetchLike,
  now = Date.now()) {
  const key = createHash("sha256").update(`${config.clientId}:` +
    config.refreshToken).digest("hex")
  if (tokenCache?.key === key && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token
  }
  const response = await fetcher("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ grant_type: "refresh_token",
      refresh_token: config.refreshToken, client_id: config.clientId,
      client_secret: config.clientSecret }),
    cache: "no-store",
  })
  if (!response.ok) throw new Error("AMAZON_SP_API_LWA_TOKEN_UNAVAILABLE")
  const payload = record(await response.json())
  const token = clean(payload.access_token, 4_000)
  const expiresIn = numeric(payload.expires_in)
  if (!token || !expiresIn || expiresIn < 60) {
    throw new Error("AMAZON_SP_API_LWA_TOKEN_INVALID")
  }
  tokenCache = { key, token, expiresAt: now + expiresIn * 1_000 }
  return token
}

export type AmazonSpApiReadOnlyClientV1 = Readonly<{
  configuration: AmazonSpApiReadOnlyConfigurationV1
  requestValue(path: string, options?: Readonly<{
    method?: "GET" | "POST"
    query?: Record<string, string | number | undefined>
    body?: Json | readonly Json[]
  }>): Promise<unknown>
  requestJson(path: string, options?: Readonly<{
    method?: "GET" | "POST"
    query?: Record<string, string | number | undefined>
    body?: Json | readonly Json[]
  }>): Promise<Json>
  downloadReportDocument(reportDocumentId: string): Promise<Json>
}>

export function createAmazonSpApiReadOnlyClientV1(options: {
  environment?: NodeJS.ProcessEnv
  fetcher?: FetchLike
  now?: () => Date
  sleep?: SleepLike
  maximumAttempts?: number
} = {}): AmazonSpApiReadOnlyClientV1 {
  const environment = options.environment ?? process.env
  const config = runtimeConfig(environment)
  const fetcher = options.fetcher ?? fetch
  const now = options.now ?? (() => new Date())
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) =>
    setTimeout(resolve, milliseconds)))
  const maximumAttempts = Math.min(5, Math.max(1,
    Math.trunc(options.maximumAttempts ?? 3)))

  async function requestValue(path: string, request: Readonly<{
    method?: "GET" | "POST"
    query?: Record<string, string | number | undefined>
    body?: Json | readonly Json[]
  }> = {}) {
    if (!path.startsWith("/") || path.includes("..")) {
      throw new Error("AMAZON_SP_API_PATH_INVALID")
    }
    const url = new URL(path, config.endpoint)
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    const token = await accessToken(config, fetcher, now().getTime())
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      const response = await fetcher(url, {
        method: request.method ?? "GET",
        headers: { Accept: "application/json", "x-amz-access-token": token,
          "x-amz-date": now().toISOString().replace(/[-:]|\.\d{3}/g, ""),
          "User-Agent": "IMNOVA-Seller-OS/1.0 (Language=TypeScript)",
          ...(request.body ? { "Content-Type": "application/json" } : {}) },
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        cache: "no-store",
      })
      if (response.ok) return await response.json() as unknown
      const retryable = response.status === 429 || response.status >= 500
      if (retryable && attempt + 1 < maximumAttempts) {
        const retryAfter = response.headers.get("retry-after")
        const seconds = retryAfter === null ? null : Number(retryAfter)
        const retryAt = retryAfter === null ? Number.NaN : Date.parse(retryAfter)
        const delay = seconds !== null && Number.isFinite(seconds) && seconds >= 0
          ? seconds * 1_000
          : Number.isFinite(retryAt)
            ? Math.max(0, retryAt - now().getTime())
            : 1_500 * (2 ** attempt)
        await sleep(Math.min(30_000, Math.ceil(delay)))
        continue
      }
      throw new Error(retryable ? "AMAZON_SP_API_UPSTREAM_RETRYABLE"
        : response.status === 401 || response.status === 403
          ? "AMAZON_SP_API_AUTHORIZATION_REQUIRED"
          : "AMAZON_SP_API_REQUEST_FAILED")
    }
    throw new Error("AMAZON_SP_API_UPSTREAM_RETRYABLE")
  }

  async function requestJson(path: string, request: Readonly<{
    method?: "GET" | "POST"
    query?: Record<string, string | number | undefined>
    body?: Json | readonly Json[]
  }> = {}) {
    return record(await requestValue(path, request))
  }

  async function downloadReportDocument(reportDocumentId: string) {
    if (!/^[A-Za-z0-9._:-]{1,300}$/.test(reportDocumentId)) {
      throw new Error("AMAZON_SP_API_REPORT_DOCUMENT_ID_INVALID")
    }
    const document = await requestJson(
      `/reports/2021-06-30/documents/${encodeURIComponent(reportDocumentId)}`)
    const documentUrl = clean(document.url, 4_000)
    if (!documentUrl) throw new Error("AMAZON_SP_API_REPORT_URL_MISSING")
    const url = new URL(documentUrl)
    if (url.protocol !== "https:") {
      throw new Error("AMAZON_SP_API_REPORT_URL_INVALID")
    }
    const response = await fetcher(url, { method: "GET", cache: "no-store" })
    if (!response.ok) throw new Error("AMAZON_SP_API_REPORT_DOWNLOAD_FAILED")
    let bytes = Buffer.from(await response.arrayBuffer())
    if (document.compressionAlgorithm === "GZIP") bytes = gunzipSync(bytes)
    try { return record(JSON.parse(bytes.toString("utf8"))) } catch {
      throw new Error("AMAZON_SP_API_REPORT_DOCUMENT_INVALID")
    }
  }

  return Object.freeze({ configuration: getAmazonSpApiReadOnlyConfigurationV1(
    environment), requestValue, requestJson, downloadReportDocument })
}

export type AmazonListingReadV1 = Readonly<{
  sellerSku: string
  asin: string | null
  title: string
  brand: string | null
  productType: string | null
  condition: string | null
  state: "ACTIVE" | "INACTIVE" | "SUPPRESSED"
  priceUsd: number | null
  availableQuantity: number | null
  fulfillmentChannel: "FBA" | "FBM" | null
  createdAt: string | null
  lastUpdatedAt: string | null
  digest: string
}>

export function parseAmazonListingItemV1(value: unknown): AmazonListingReadV1 | null {
  const item = record(value)
  const sellerSku = clean(item.sku, 160)
  const summary = record(array(item.summaries)[0])
  const title = clean(summary.itemName, 500)
  if (!sellerSku || !title) return null
  const statuses = array(summary.status).flatMap((state) => {
    const normalized = clean(state, 40)
    return normalized ? [normalized] : []
  })
  const issues = array(item.issues).map(record)
  const suppressed = issues.some((issue) =>
    clean(issue.severity, 40)?.toUpperCase() === "ERROR")
  const offer = record(array(item.offers)[0])
  const price = amount(offer.price)
  const fulfillmentAvailability = array(item.fulfillmentAvailability).map(record)
  const quantities = fulfillmentAvailability.map((entry) =>
    numeric(entry.quantity)).filter((entry): entry is number =>
      entry !== null && entry >= 0)
  const fulfillmentCodes = fulfillmentAvailability.flatMap((entry) => {
    const code = clean(entry.fulfillmentChannelCode, 80)?.toUpperCase()
    return code ? [code] : []
  })
  const fulfillmentChannel = fulfillmentCodes.some((code) =>
    code !== "DEFAULT" && /AMAZON|AFN/.test(code))
    ? "FBA" as const : fulfillmentCodes.includes("DEFAULT")
      ? "FBM" as const : null
  const normalized = {
    sellerSku, asin: clean(summary.asin, 20)?.toUpperCase() ?? null,
    title, brand: clean(summary.brand, 160),
    productType: clean(summary.productType, 160),
    condition: clean(summary.conditionType, 80),
    state: suppressed ? "SUPPRESSED" as const
      : statuses.includes("BUYABLE") ? "ACTIVE" as const : "INACTIVE" as const,
    priceUsd: price === null ? null : Number(price.toFixed(2)),
    availableQuantity: quantities.length
      ? quantities.reduce((total, entry) => total + entry, 0) : null,
    fulfillmentChannel,
    createdAt: iso(summary.createdDate),
    lastUpdatedAt: iso(summary.lastUpdatedDate),
  }
  return Object.freeze({ ...normalized, digest: `sha256:${createHash("sha256")
    .update(JSON.stringify(normalized)).digest("hex")}` })
}

export type AmazonCompetitiveSummaryV1 = Readonly<{
  asin: string
  state: "AVAILABLE" | "NO_FEATURED_OFFER" | "UNAVAILABLE"
  featuredOfferPriceUsd: number | null
  featuredOfferPriceMaximumUsd: number | null
  featuredOfferListingPriceUsd: number | null
  featuredOfferShippingUsd: number | null
  featuredOfferFulfillmentChannel: "FBA" | "FBM" | null
  featuredOfferCount: number
  observedAt: string
}>

export function parseAmazonCompetitiveSummaryBatchV1(value: unknown,
  options: { now?: Date } = {}) {
  const observedAt = (options.now ?? new Date()).toISOString()
  const summaries = new Map<string, AmazonCompetitiveSummaryV1>()
  for (const response of array(record(value).responses).map(record)) {
    const body = record(response.body)
    const asin = clean(body.asin, 20)?.toUpperCase()
    if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) continue
    const statusCode = numeric(record(response.status).statusCode)
    const newOption = array(body.featuredBuyingOptions).map(record)
      .find((entry) => clean(entry.buyingOptionType, 40)?.toUpperCase() === "NEW")
    const offers = array(newOption?.segmentedFeaturedOffers).map(record)
      .flatMap((offer) => {
        const listingPriceUsd = amount(offer.listingPrice)
        const defaultShipping = array(offer.shippingOptions).map(record)
          .find((entry) => clean(entry.shippingOptionType, 40)?.toUpperCase() ===
            "DEFAULT")
        const shippingUsd = amount(defaultShipping?.price) ?? 0
        if (listingPriceUsd === null || listingPriceUsd < 0 || shippingUsd < 0) {
          return []
        }
        const channel = clean(offer.fulfillmentType, 40)?.toUpperCase()
        return [{ listingPriceUsd, shippingUsd,
          totalUsd: Number((listingPriceUsd + shippingUsd).toFixed(2)),
          fulfillmentChannel: channel === "AFN" ? "FBA" as const
            : channel === "MFN" ? "FBM" as const : null }]
      }).sort((left, right) => left.totalUsd - right.totalUsd)
    const selected = offers[0]
    summaries.set(asin, Object.freeze({ asin,
      state: statusCode === 200 && selected ? "AVAILABLE" as const
        : statusCode === 200 ? "NO_FEATURED_OFFER" as const
          : "UNAVAILABLE" as const,
      featuredOfferPriceUsd: selected?.totalUsd ?? null,
      featuredOfferPriceMaximumUsd: offers.length
        ? offers[offers.length - 1]?.totalUsd ?? null : null,
      featuredOfferListingPriceUsd: selected?.listingPriceUsd ?? null,
      featuredOfferShippingUsd: selected?.shippingUsd ?? null,
      featuredOfferFulfillmentChannel: selected?.fulfillmentChannel ?? null,
      featuredOfferCount: offers.length, observedAt }))
  }
  return summaries
}

export async function readAmazonCompetitiveSummariesV1(
  client: AmazonSpApiReadOnlyClientV1, asins: readonly string[],
  options: { now?: Date } = {},
) {
  const uniqueAsins = [...new Set(asins.map((asin) => asin.toUpperCase()))]
    .filter((asin) => /^[A-Z0-9]{10}$/.test(asin)).slice(0, 20)
  if (!uniqueAsins.length) return new Map<string, AmazonCompetitiveSummaryV1>()
  const response = await client.requestValue(
    "/batches/products/pricing/2022-05-01/items/competitiveSummary", {
      method: "POST", body: { requests: uniqueAsins.map((asin) => ({ asin,
        marketplaceId: client.configuration.marketplaceId,
        includedData: ["featuredBuyingOptions"],
        method: "GET",
        uri: "/products/pricing/2022-05-01/items/competitiveSummary",
      })) },
    })
  return parseAmazonCompetitiveSummaryBatchV1(response, options)
}

export type AmazonCatalogDemandSignalV1 = Readonly<{
  asin: string
  displayGroupRank: number | null
  displayGroupTitle: string | null
  classificationRank: number | null
  classificationTitle: string | null
  signalState: "SUPPORTED" | "UNAVAILABLE"
  observedAt: string
}>

export function parseAmazonCatalogDemandSignalV1(value: unknown,
  options: { now?: Date } = {}): AmazonCatalogDemandSignalV1 | null {
  const item = record(value)
  const asin = clean(item.asin, 20)?.toUpperCase()
  if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) return null
  const salesRanks = record(array(item.salesRanks)[0])
  const displayRanks = array(salesRanks.displayGroupRanks).map(record)
    .filter((entry) => numeric(entry.rank) !== null)
    .sort((left, right) => Number(left.rank) - Number(right.rank))
  const classificationRanks = array(salesRanks.classificationRanks).map(record)
    .filter((entry) => numeric(entry.rank) !== null)
    .sort((left, right) => Number(left.rank) - Number(right.rank))
  const display = displayRanks[0]
  const classification = classificationRanks[0]
  const hasRank = Boolean(display || classification)
  return Object.freeze({ asin,
    displayGroupRank: numeric(display?.rank),
    displayGroupTitle: clean(display?.title, 200),
    classificationRank: numeric(classification?.rank),
    classificationTitle: clean(classification?.title, 200),
    signalState: hasRank ? "SUPPORTED" as const : "UNAVAILABLE" as const,
    observedAt: (options.now ?? new Date()).toISOString() })
}

export async function readAmazonCatalogDemandSignalsV1(
  client: AmazonSpApiReadOnlyClientV1, asins: readonly string[],
  options: { now?: Date } = {},
) {
  const signals = new Map<string, AmazonCatalogDemandSignalV1>()
  const uniqueAsins = [...new Set(asins.map((asin) => asin.toUpperCase()))]
    .filter((asin) => /^[A-Z0-9]{10}$/.test(asin)).slice(0, 20)
  for (const asin of uniqueAsins) {
    const response = await client.requestJson(
      `/catalog/2022-04-01/items/${encodeURIComponent(asin)}`, { query: {
        marketplaceIds: client.configuration.marketplaceId,
        includedData: "salesRanks",
      } })
    const signal = parseAmazonCatalogDemandSignalV1(response, options)
    if (signal) signals.set(asin, signal)
  }
  return signals
}

export type AmazonCatalogSearchItemV1 = Readonly<{
  asin: string
  title: string
  brand: string | null
  modelNumber: string | null
  partNumber: string | null
  manufacturerPartNumber: string | null
  upc: string | null
  ean: string | null
  gtin: string | null
  productType: string | null
  category: string | null
  size: string | null
  color: string | null
  packCount: number | null
  marketplace: "amazon us"
  source: "AMAZON_CATALOG_ITEMS_2022_04_01"
}>

function attributeText(value: unknown) {
  const values = array(value).map(record)
  const raw = values[0]?.value ?? values[0]?.displayValue
  return typeof raw === "number" && Number.isFinite(raw)
    ? String(raw) : clean(raw, 300)
}

export function parseAmazonCatalogSearchV1(value: unknown) {
  return Object.freeze(array(record(value).items).map(record).flatMap((item) => {
    const asin = clean(item.asin, 20)?.toUpperCase()
    const summary = record(array(item.summaries)[0])
    const title = clean(summary.itemName, 500)
    if (!asin || !/^[A-Z0-9]{10}$/.test(asin) || !title) return []
    const identifiers = array(record(array(item.identifiers)[0]).identifiers)
      .map(record)
    const identifier = (kind: RegExp) => clean(identifiers.find((entry) =>
      kind.test(String(entry.identifierType ?? "")))?.identifier, 40)
    const attributes = record(item.attributes)
    const productType = clean(record(array(item.productTypes)[0])
      .productType, 160)
    const packCountRaw = numeric(attributeText(attributes.item_package_quantity))
    return [Object.freeze({ asin, title,
      brand: clean(summary.brand, 160) ?? attributeText(attributes.brand),
      modelNumber: clean(summary.modelNumber, 160) ??
        attributeText(attributes.item_model_number),
      partNumber: clean(summary.partNumber, 160) ??
        attributeText(attributes.part_number),
      manufacturerPartNumber:
        attributeText(attributes.manufacturer_part_number),
      upc: identifier(/UPC/i), ean: identifier(/EAN/i),
      gtin: identifier(/GTIN/i), productType,
      category: clean(summary.websiteDisplayGroupName, 200) ?? productType,
      size: attributeText(attributes.size) ??
        attributeText(attributes.item_dimensions),
      color: attributeText(attributes.color),
      packCount: packCountRaw === null ? null : Math.trunc(packCountRaw),
      marketplace: "amazon us" as const,
      source: "AMAZON_CATALOG_ITEMS_2022_04_01" as const,
    })]
  }))
}

export async function searchAmazonCatalogItemsV1(
  client: AmazonSpApiReadOnlyClientV1,
  input: { keywords?: string | null; identifier?: string | null;
    pageSize?: number },
) {
  const identifier = clean(input.identifier, 40)?.replace(/[^A-Za-z0-9]/g, "")
  const keywords = clean(input.keywords, 500)
  if (!identifier && !keywords) return Object.freeze([])
  const identifierType = identifier && /^\d{12}$/.test(identifier) ? "UPC"
    : identifier && /^\d{13}$/.test(identifier) ? "EAN"
      : identifier && /^[A-Z0-9]{10}$/.test(identifier.toUpperCase())
        ? "ASIN" : identifier ? "GTIN" : undefined
  const response = await client.requestJson("/catalog/2022-04-01/items", {
    query: {
      marketplaceIds: client.configuration.marketplaceId,
      includedData:
        "attributes,identifiers,images,productTypes,salesRanks,summaries",
      pageSize: Math.min(10, Math.max(1, Math.trunc(input.pageSize ?? 5))),
      ...(identifier ? { identifiers: identifier,
        identifiersType: identifierType } : { keywords: keywords as string }),
    },
  })
  return parseAmazonCatalogSearchV1(response)
}

export type AmazonListingRestrictionV1 = Readonly<{
  asin: string
  state: "ELIGIBLE" | "RESTRICTED" | "UNAVAILABLE"
  reasonCodes: readonly string[]
}>

export function parseAmazonListingRestrictionsV1(asin: string,
  value: unknown): AmazonListingRestrictionV1 {
  const restrictions = array(record(value).restrictions).map(record)
  const reasonCodes = restrictions.flatMap((entry) =>
    array(entry.reasons).map(record).flatMap((reason) => {
      const code = clean(reason.reasonCode, 160)
      return code ? [code] : []
    }))
  return Object.freeze({ asin,
    state: restrictions.length === 0 ? "ELIGIBLE" as const
      : reasonCodes.length ? "RESTRICTED" as const : "UNAVAILABLE" as const,
    reasonCodes: Object.freeze([...new Set(reasonCodes)]),
  })
}

export async function readAmazonListingRestrictionsV1(
  client: AmazonSpApiReadOnlyClientV1, asins: readonly string[],
) {
  const results = new Map<string, AmazonListingRestrictionV1>()
  for (const asin of [...new Set(asins.map((value) => value.toUpperCase()))]
    .filter((value) => /^[A-Z0-9]{10}$/.test(value)).slice(0, 10)) {
    try {
      const response = await client.requestJson(
        "/listings/2021-08-01/restrictions", { query: { asin,
          sellerId: client.configuration.sellerId ?? undefined,
          marketplaceIds: client.configuration.marketplaceId,
          conditionType: "new_new" } })
      results.set(asin, parseAmazonListingRestrictionsV1(asin, response))
    } catch {
      results.set(asin, Object.freeze({ asin, state: "UNAVAILABLE" as const,
        reasonCodes: Object.freeze(["AMAZON_RESTRICTION_READ_UNAVAILABLE"]) }))
    }
  }
  return results
}

export type AmazonFeeEstimateV1 = Readonly<{
  identifier: string
  asin: string
  status: "AVAILABLE" | "UNAVAILABLE"
  totalFeesUsd: number | null
  estimatedAt: string | null
}>

export function parseAmazonFeeEstimateBatchV1(value: unknown) {
  const estimates = new Map<string, AmazonFeeEstimateV1>()
  for (const entry of array(value).map(record)) {
    const identifier = clean(record(entry.FeesEstimateIdentifier)
      .SellerInputIdentifier, 160)
    const asin = clean(record(entry.FeesEstimateIdentifier).IdValue, 20)
      ?.toUpperCase()
    if (!identifier || !asin || !/^[A-Z0-9]{10}$/.test(asin)) continue
    const estimate = record(entry.FeesEstimate)
    const totalFeesUsd = amount(estimate.TotalFeesEstimate)
    const available = clean(entry.Status, 40)?.toUpperCase() === "SUCCESS" &&
      totalFeesUsd !== null && totalFeesUsd >= 0
    estimates.set(identifier, Object.freeze({ identifier, asin,
      status: available ? "AVAILABLE" as const : "UNAVAILABLE" as const,
      totalFeesUsd: available ? Number(totalFeesUsd.toFixed(2)) : null,
      estimatedAt: iso(estimate.TimeOfFeesEstimation) }))
  }
  return estimates
}

export async function readAmazonFeeEstimatesV1(
  client: AmazonSpApiReadOnlyClientV1,
  inputs: readonly { identifier: string; asin: string; priceUsd: number;
    fulfillmentChannel: "FBA" | "FBM" }[],
) {
  const bounded = inputs.filter((entry) => /^[A-Z0-9]{10}$/.test(entry.asin) &&
    Number.isFinite(entry.priceUsd) && entry.priceUsd > 0).slice(0, 20)
  if (!bounded.length) return new Map<string, AmazonFeeEstimateV1>()
  const response = await client.requestValue("/products/fees/v0/feesEstimate", {
    method: "POST", body: bounded.map((entry) => ({
      FeesEstimateRequest: {
        MarketplaceId: client.configuration.marketplaceId,
        IsAmazonFulfilled: entry.fulfillmentChannel === "FBA",
        PriceToEstimateFees: { ListingPrice: { CurrencyCode: "USD",
          Amount: Number(entry.priceUsd.toFixed(2)) } },
        Identifier: entry.identifier,
      },
      IdType: "ASIN", IdValue: entry.asin,
    })),
  })
  return parseAmazonFeeEstimateBatchV1(response)
}

export async function searchAmazonListingsReadOnlyV1(
  client: AmazonSpApiReadOnlyClientV1, options: { maximumPages?: number } = {},
) {
  const items: AmazonListingReadV1[] = []
  let pageToken: string | undefined
  const maximumPages = Math.min(100, Math.max(1,
    Math.trunc(options.maximumPages ?? 25)))
  for (let page = 0; page < maximumPages; page += 1) {
    const response = await client.requestJson(
      `/listings/2021-08-01/items/${encodeURIComponent(
        client.configuration.sellerId ?? "")}`, { query: {
        marketplaceIds: client.configuration.marketplaceId,
        includedData: "summaries,issues,offers,fulfillmentAvailability",
        sortBy: "lastUpdatedDate", sortOrder: "DESC", pageSize: 20,
        pageToken,
      } })
    items.push(...array(response.items).flatMap((entry) => {
      const parsed = parseAmazonListingItemV1(entry)
      return parsed ? [parsed] : []
    }))
    pageToken = clean(record(response.pagination).nextToken, 2_000) ?? undefined
    if (!pageToken) break
  }
  return Object.freeze(items)
}

export type AmazonSalesTrafficMetricV1 = Readonly<{
  asin: string
  sellerSku: string | null
  unitsOrdered: number
  grossSalesUsd: number
  sessions: number | null
  pageViews: number | null
  unitSessionPercentage: number | null
}>

export function parseAmazonSalesTrafficReportV1(value: unknown) {
  const report = record(value)
  const metrics = new Map<string, AmazonSalesTrafficMetricV1>()
  for (const entry of array(report.salesAndTrafficByAsin).map(record)) {
    const asin = clean(entry.childAsin ?? entry.asin, 20)?.toUpperCase()
    if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) continue
    const sales = record(entry.salesByAsin)
    const traffic = record(entry.trafficByAsin)
    const units = numeric(sales.unitsOrdered)
    const gross = amount(sales.orderedProductSales)
    if (units === null || units < 0 || gross === null || gross < 0) continue
    metrics.set(asin, Object.freeze({ asin,
      sellerSku: clean(entry.sku, 160),
      unitsOrdered: Math.trunc(units), grossSalesUsd: Number(gross.toFixed(2)),
      sessions: numeric(traffic.sessions), pageViews: numeric(traffic.pageViews),
      unitSessionPercentage: numeric(traffic.unitSessionPercentage),
    }))
  }
  const specification = record(report.reportSpecification)
  return Object.freeze({
    dataStartTime: iso(specification.dataStartTime),
    dataEndTime: iso(specification.dataEndTime), metrics,
  })
}

function breakdowns(value: unknown): Json[] {
  return array(value).map(record).flatMap((entry) => [entry,
    ...breakdowns(entry.breakdowns)])
}

export type AmazonFinanceMetricV1 = Readonly<{
  sellerSku: string
  asin: string | null
  matchedTransactions: number
  amazonFeesUsd: number
  fulfillmentFeesUsd: number
  refundsUsd: number
}>

export function parseAmazonFinanceTransactionsV1(value: unknown) {
  const root = record(value)
  const payload = record(root.payload)
  const metrics = new Map<string, { sellerSku: string; asin: string | null;
    matchedTransactions: number; amazonFeesUsd: number;
    fulfillmentFeesUsd: number; refundsUsd: number }>()
  for (const transaction of array(payload.transactions).map(record)) {
    const description = clean(transaction.description, 200)?.toLowerCase() ?? ""
    for (const item of array(transaction.items).map(record)) {
      const contexts = array(item.contexts).map(record)
      const sku = contexts.map((context) => clean(context.sku, 160))
        .find((candidate) => candidate) ?? null
      if (!sku) continue
      const asin = contexts.map((context) => clean(context.asin, 20)?.toUpperCase())
        .find((candidate) => candidate) ?? null
      const current = metrics.get(sku) ?? { sellerSku: sku, asin,
        matchedTransactions: 0, amazonFeesUsd: 0,
        fulfillmentFeesUsd: 0, refundsUsd: 0 }
      current.matchedTransactions += 1
      for (const part of breakdowns(item.breakdowns)) {
        const type = clean(part.breakdownType, 200)?.toLowerCase() ?? ""
        const value = amount(part.breakdownAmount)
        if (value === null || value >= 0) continue
        const absolute = Math.abs(value)
        if (/fulfillment|fba|shipping chargeback|pick.*pack|weight handling/.test(type)) {
          current.fulfillmentFeesUsd += absolute
        } else if (/fee|commission|closing|service|storage/.test(type)) {
          current.amazonFeesUsd += absolute
        } else if (/refund|principal|product charges/.test(type) &&
            /refund|adjustment/.test(description)) {
          current.refundsUsd += absolute
        }
      }
      metrics.set(sku, current)
    }
  }
  return new Map([...metrics].map(([sku, metric]) => [sku, Object.freeze({
    ...metric, amazonFeesUsd: Number(metric.amazonFeesUsd.toFixed(2)),
    fulfillmentFeesUsd: Number(metric.fulfillmentFeesUsd.toFixed(2)),
    refundsUsd: Number(metric.refundsUsd.toFixed(2)),
  })]))
}

export async function readAmazonFinancesV1(client: AmazonSpApiReadOnlyClientV1,
  input: { postedAfter: string; postedBefore: string; maximumPages?: number }) {
  const transactions: unknown[] = []
  let nextToken: string | undefined
  const maximumPages = Math.min(25, Math.max(1,
    Math.trunc(input.maximumPages ?? 10)))
  for (let page = 0; page < maximumPages; page += 1) {
    const response = await client.requestJson(
      "/finances/2024-06-19/transactions", { query: {
        postedAfter: input.postedAfter, postedBefore: input.postedBefore,
        transactionStatus: "RELEASED", nextToken,
      } })
    const payload = record(response.payload)
    transactions.push(...array(payload.transactions))
    nextToken = clean(payload.nextToken, 2_000) ?? undefined
    if (!nextToken) break
  }
  return parseAmazonFinanceTransactionsV1({ payload: { transactions } })
}

export async function createAmazonSalesTrafficReportV1(
  client: AmazonSpApiReadOnlyClientV1,
  input: { dataStartTime: string; dataEndTime: string },
) {
  const response = await client.requestJson("/reports/2021-06-30/reports", {
    method: "POST", body: {
      reportType: "GET_SALES_AND_TRAFFIC_REPORT",
      dataStartTime: input.dataStartTime, dataEndTime: input.dataEndTime,
      marketplaceIds: [client.configuration.marketplaceId],
      reportOptions: { dateGranularity: "DAY", asinGranularity: "CHILD" },
    },
  })
  const reportId = clean(response.reportId, 300)
  if (!reportId) throw new Error("AMAZON_SP_API_REPORT_ID_MISSING")
  return reportId
}

export async function readAmazonSalesTrafficReportStatusV1(
  client: AmazonSpApiReadOnlyClientV1, reportId: string,
) {
  if (!/^[A-Za-z0-9._:-]{1,300}$/.test(reportId)) {
    throw new Error("AMAZON_SP_API_REPORT_ID_INVALID")
  }
  const report = await client.requestJson(
    `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`)
  const status = clean(report.processingStatus, 40) ?? "UNKNOWN"
  const reportDocumentId = clean(report.reportDocumentId, 300)
  return Object.freeze({ status, reportDocumentId,
    createdTime: iso(report.createdTime),
    dataStartTime: iso(report.dataStartTime),
    dataEndTime: iso(report.dataEndTime) })
}
