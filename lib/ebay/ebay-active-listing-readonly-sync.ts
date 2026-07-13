import type { SupabaseClient } from "@supabase/supabase-js"
import {
  ebayProductionAccountFingerprint,
  getEbayProductionIdentityBindingConfiguration,
  getEbaySellerAccountScopeConfiguration,
} from "@/lib/ebay/ebay-seller-account-scope"

const TOKEN_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token"
const TRADING_ENDPOINT = "https://api.ebay.com/ws/api.dll"
const INVENTORY_API_ORIGIN = "https://api.ebay.com"
const INVENTORY_ITEMS_ENDPOINT =
  `${INVENTORY_API_ORIGIN}/sell/inventory/v1/inventory_item?limit=100&offset=0`
const OFFERS_ENDPOINT = `${INVENTORY_API_ORIGIN}/sell/inventory/v1/offer`
const INVENTORY_READONLY_SCOPE = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
].join(" ")
const REQUEST_TIMEOUT_MS = 10_000
const MAX_PAGES = 50
const MAX_RETRIES = 3
const OFFER_READ_CONCURRENCY = 6
const CONNECTOR_SOURCE = "EBAY_SELL_INVENTORY_READONLY"
const MARKETPLACE_ID = "EBAY_US"
const TRADING_COMPATIBILITY_LEVEL = "1423"

type JsonRecord = Record<string, unknown>

type CachedToken = {
  value: string
  expiresAt: number
}

let cachedToken: CachedToken | null = null

export function getEbayActiveListingAccountKey() {
  const scope = getEbaySellerAccountScopeConfiguration()
  if (scope.accountKey) return scope.accountKey
  if (
    scope.reason === "ACCOUNT_KEY_REQUIRED" ||
    scope.reason === "OFFICIAL_ACCOUNT_IDENTITY_REQUIRED"
  ) {
    throw new Error("EBAY_ACTIVE_LISTING_ACCOUNT_SCOPE_REQUIRED")
  }
  throw new Error("EBAY_ACTIVE_LISTING_ACCOUNT_SCOPE_INVALID")
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function integerOrNull(value: unknown) {
  const parsed = numberOrNull(value)
  return parsed === null ? null : Math.max(0, Math.trunc(parsed))
}

function safeRetryDelay(response: Response, attempt: number) {
  const retryAfter = Number(response.headers.get("retry-after"))
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1_000, 8_000)
  }
  return Math.min(500 * (2 ** attempt), 4_000) + Math.floor(Math.random() * 250)
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function ebayFetch(url: string, accessToken: string) {
  const parsed = new URL(url)
  const allowedPath = parsed.pathname === "/sell/inventory/v1/inventory_item" ||
    parsed.pathname === "/sell/inventory/v1/offer"
  if (parsed.origin !== INVENTORY_API_ORIGIN || !allowedPath) {
    throw new Error("BLOCKED_NON_READONLY_EBAY_INVENTORY_REQUEST")
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(parsed, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (response.ok) return record(await response.json())
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === MAX_RETRIES - 1) {
        throw new Error(`EBAY_ACTIVE_LISTING_READ_${response.status}`)
      }
      await wait(safeRetryDelay(response, attempt))
    } catch (error) {
      const code = error instanceof Error ? error.message : ""
      if (code.startsWith("EBAY_ACTIVE_LISTING_READ_") || attempt === MAX_RETRIES - 1) throw error
      await wait(Math.min(500 * (2 ** attempt), 4_000) + Math.floor(Math.random() * 250))
    }
  }
  throw new Error("EBAY_ACTIVE_LISTING_READ_FAILED")
}

async function getSellerInventoryToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value
  }
  const clientId = process.env.EBAY_CLIENT_ID?.trim() ?? ""
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim() ?? ""
  const refreshToken = process.env.EBAY_SELLER_REFRESH_TOKEN?.trim() ?? ""
  if (!clientId || !clientSecret) throw new Error("EBAY_READONLY_ENV_MISSING")
  if (!refreshToken) throw new Error("EBAY_SELLER_OAUTH_NOT_CONFIGURED")

  const credentials = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          scope: INVENTORY_READONLY_SCOPE,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (response.ok) {
        const payload = record(await response.json())
        const accessToken = text(payload.access_token)
        if (!accessToken) throw new Error("EBAY_SELLER_INVENTORY_TOKEN_MISSING")
        const expiresIn = Math.max(120, numberOrNull(payload.expires_in) ?? 7_200)
        cachedToken = { value: accessToken, expiresAt: Date.now() + expiresIn * 1_000 }
        return accessToken
      }
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === MAX_RETRIES - 1) {
        throw new Error(`EBAY_SELLER_INVENTORY_OAUTH_${response.status}`)
      }
      await wait(safeRetryDelay(response, attempt))
    } catch (error) {
      const code = error instanceof Error ? error.message : ""
      if (code.startsWith("EBAY_SELLER_INVENTORY_") || attempt === MAX_RETRIES - 1) throw error
      await wait(Math.min(500 * (2 ** attempt), 4_000) + Math.floor(Math.random() * 250))
    }
  }
  throw new Error("EBAY_SELLER_INVENTORY_OAUTH_FAILED")
}

function tradingXmlValue(xml: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = xml.match(new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${escaped}>`,
    "i",
  ))
  return match?.[1]
    ?.replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim() || null
}

async function assertAuthenticatedSellerAccount(
  accessToken: string,
) {
  const identity = getEbayProductionIdentityBindingConfiguration()
  if (!identity.bound) {
    throw new Error("EBAY_ACTIVE_LISTING_ACCOUNT_SCOPE_REQUIRED")
  }
  const response = await fetch(TRADING_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetUser",
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_COMPATIBILITY_LEVEL,
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": accessToken,
    },
    body: "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
      "<GetUserRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
      "<OutputSelector>User.UserID</OutputSelector>" +
      "</GetUserRequest>",
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const xml = await response.text()
  if (response.status === 401) {
    throw new Error("EBAY_ACTIVE_LISTING_READ_401")
  }
  const ack = tradingXmlValue(xml, "Ack")?.toLowerCase()
  const authenticatedUserId = tradingXmlValue(xml, "UserID")
  if (
    !response.ok ||
    !["success", "warning"].includes(ack ?? "") ||
    !authenticatedUserId
  ) {
    throw new Error("EBAY_ACTIVE_LISTING_ACCOUNT_IDENTITY_UNAVAILABLE")
  }
  const fingerprintMatches =
    ebayProductionAccountFingerprint(authenticatedUserId) ===
      identity.expectedAccountFingerprint
  const expectedUserMatches = !identity.expectedUserId ||
    authenticatedUserId.toLocaleLowerCase("en-US") ===
      identity.expectedUserId.toLocaleLowerCase("en-US")
  if (!fingerprintMatches || !expectedUserMatches) {
    throw new Error("EBAY_ACTIVE_LISTING_ACCOUNT_IDENTITY_MISMATCH")
  }
}

async function loadAllPages(
  initialUrl: string,
  collectionKey: "inventoryItems" | "offers",
  accessToken: string,
) {
  const rows: JsonRecord[] = []
  let nextUrl: string | null = initialUrl
  for (let page = 0; nextUrl && page < MAX_PAGES; page += 1) {
    const payload = await ebayFetch(nextUrl, accessToken)
    rows.push(...array(payload[collectionKey]).map(record))
    const next = text(payload.next)
    nextUrl = next ? new URL(next, INVENTORY_API_ORIGIN).href : null
  }
  if (nextUrl) throw new Error("EBAY_ACTIVE_LISTING_PAGE_LIMIT_REACHED")
  return rows
}

function listingStatus(offer: JsonRecord) {
  const listing = record(offer.listing)
  const raw = (text(listing.listingStatus) ?? text(offer.status) ?? "").toUpperCase()
  if (["ACTIVE", "PUBLISHED", "OUT_OF_STOCK"].includes(raw)) return "active"
  if (["INACTIVE", "PAUSED", "SUSPENDED"].includes(raw)) return "paused"
  if (["ENDED", "EBAY_ENDED", "WITHDRAWN"].includes(raw)) return "ended"
  if (["NOT_LISTED", "UNPUBLISHED", "DRAFT"].includes(raw)) return "draft"
  return "unknown"
}

function listingId(offer: JsonRecord) {
  const listing = record(offer.listing)
  return text(listing.listingId) ?? text(offer.listingId)
}

function inventoryQuantity(inventory: JsonRecord, offer: JsonRecord) {
  const availability = record(inventory.availability)
  const shipTo = record(availability.shipToLocationAvailability)
  return integerOrNull(offer.availableQuantity) ?? integerOrNull(shipTo.quantity)
}

async function loadOpportunityMappings(supabase: SupabaseClient, skus: string[]) {
  type Mapping = {
    productId: string | null
    variantId: string | null
    supplierSku: string | null
    supplierPrice: number | null
    source: "CANONICAL_LISTING_PACKAGE_SKU" | "UNIQUE_SUPPLIER_SKU"
  }
  type MappingResolution = {
    state:
      | "RESOLVED_CANONICAL"
      | "RESOLVED_UNIQUE_SUPPLIER"
      | "RESERVED_UNRESOLVED"
      | "AMBIGUOUS_SUPPLIER_SKU"
      | "UNMAPPED"
    mapping: Mapping | null
  }
  const uniqueSkus = [...new Set(skus)]
  const resolutions = new Map<string, MappingResolution>()
  const packageIdBySku = new Map<string, string>()
  for (const sku of uniqueSkus) {
    if (!/^IMNOVA-/i.test(sku)) {
      resolutions.set(sku, { state: "UNMAPPED", mapping: null })
      continue
    }
    // IMNOVA is a reserved identity namespace. A malformed or unknown value
    // must never be reinterpreted as a supplier SKU.
    resolutions.set(sku, { state: "RESERVED_UNRESOLVED", mapping: null })
    const match = sku.match(/^IMNOVA-([0-9A-F]{32})$/)
    if (!match) continue
    const compact = match[1].toLowerCase()
    packageIdBySku.set(sku, [
      compact.slice(0, 8),
      compact.slice(8, 12),
      compact.slice(12, 16),
      compact.slice(16, 20),
      compact.slice(20),
    ].join("-"))
  }

  const packageRows: Array<{
    id: string
    opportunity_id: string
    candidate_key: string
  }> = []
  const packageIds = [...new Set(packageIdBySku.values())]
  for (let index = 0; index < packageIds.length; index += 200) {
    const chunk = packageIds.slice(index, index + 200)
    const { data, error } = await supabase
      .from("ebay_listing_packages")
      .select("id,opportunity_id,candidate_key")
      .in("id", chunk)
    if (error) throw new Error("EBAY_ACTIVE_LISTING_PACKAGE_MAPPING_READ_FAILED")
    packageRows.push(...((data ?? []) as typeof packageRows))
  }
  const packageById = new Map(packageRows.map((row) => [row.id, row]))
  const opportunityIds = [...new Set(packageRows.map((row) => row.opportunity_id))]
  const opportunityById = new Map<string, Record<string, unknown>>()
  for (let index = 0; index < opportunityIds.length; index += 200) {
    const chunk = opportunityIds.slice(index, index + 200)
    const { data, error } = await supabase
      .from("ebay_luna_opportunity_queue")
      .select("id,candidate_key,supplier_sku,market_radar_product_id,supplier_variant_id,supplier_price")
      .in("id", chunk)
    if (error) throw new Error("EBAY_ACTIVE_LISTING_PACKAGE_OPPORTUNITY_READ_FAILED")
    for (const row of data ?? []) opportunityById.set(row.id, row)
  }
  for (const [sku, packageId] of packageIdBySku) {
    const packageRow = packageById.get(packageId)
    const row = packageRow
      ? opportunityById.get(packageRow.opportunity_id)
      : null
    if (!row || text(row.candidate_key) !== packageRow?.candidate_key) continue
    resolutions.set(sku, {
      state: "RESOLVED_CANONICAL",
      mapping: {
        productId: typeof row.market_radar_product_id === "string"
          ? row.market_radar_product_id
          : null,
        variantId: text(row.supplier_variant_id),
        supplierSku: text(row.supplier_sku),
        supplierPrice: numberOrNull(row.supplier_price),
        source: "CANONICAL_LISTING_PACKAGE_SKU",
      },
    })
  }

  const fallbackSkus = uniqueSkus.filter((sku) => !/^IMNOVA-/i.test(sku))
  for (let index = 0; index < fallbackSkus.length; index += 200) {
    const chunk = fallbackSkus.slice(index, index + 200)
    if (!chunk.length) continue
    const { data, error } = await supabase
      .from("ebay_luna_opportunity_queue")
      .select("id,supplier_sku,market_radar_product_id,supplier_variant_id,supplier_price")
      .in("supplier_sku", chunk)
    if (error) throw new Error("EBAY_ACTIVE_LISTING_MAPPING_READ_FAILED")
    const candidatesBySku = new Map<string, typeof data>()
    for (const row of data ?? []) {
      if (!row.supplier_sku) continue
      const candidates = candidatesBySku.get(row.supplier_sku) ?? []
      candidates.push(row)
      candidatesBySku.set(row.supplier_sku, candidates)
    }
    for (const [sku, candidates] of candidatesBySku) {
      if (candidates.length !== 1) {
        resolutions.set(sku, {
          state: "AMBIGUOUS_SUPPLIER_SKU",
          mapping: null,
        })
        continue
      }
      const row = candidates[0]
      resolutions.set(sku, {
        state: "RESOLVED_UNIQUE_SUPPLIER",
        mapping: {
          productId: row.market_radar_product_id ?? null,
          variantId: row.supplier_variant_id ?? null,
          supplierSku: row.supplier_sku,
          supplierPrice: numberOrNull(row.supplier_price),
          source: "UNIQUE_SUPPLIER_SKU",
        },
      })
    }
  }
  return resolutions
}

function isSameOpportunityIdentity(
  mapping: {
    productId: string | null
    variantId: string | null
    supplierSku: string | null
  },
  previous: ExistingListing | undefined,
) {
  return Boolean(previous) &&
    mapping.productId === previous?.market_radar_product_id &&
    mapping.variantId === previous?.supplier_variant_id &&
    mapping.supplierSku === previous?.supplier_sku
}

function withoutPreviousOpportunityIdentity(value: unknown) {
  const cleaned = { ...record(value) }
  for (const key of [
    "marketRadarProductId",
    "market_radar_product_id",
    "supplierVariantId",
    "supplier_variant_id",
    "supplierSku",
    "supplier_sku",
    "supplierCostAtLinking",
    "supplier_cost_at_linking",
    "opportunityMappingState",
    "opportunityMappingSource",
  ]) {
    delete cleaned[key]
  }
  return cleaned
}

type ExistingListing = {
  id: string
  sync_key: string
  ebay_item_id: string
  market_radar_product_id: string | null
  supplier_variant_id: string | null
  supplier_sku: string | null
  supplier_cost_at_linking: number | string | null
  raw_payload: JsonRecord | null
}

async function loadConnectorListings(
  supabase: SupabaseClient,
  accountKey: string,
) {
  const rows: ExistingListing[] = []
  const pageSize = 500
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("ebay_active_listings")
      .select("id,sync_key,ebay_item_id,market_radar_product_id,supplier_variant_id,supplier_sku,supplier_cost_at_linking,raw_payload")
      .eq("source", CONNECTOR_SOURCE)
      .eq("account_key", accountKey)
      .range(from, from + pageSize - 1)
    if (error) throw new Error("EBAY_ACTIVE_LISTING_RECONCILE_READ_FAILED")
    rows.push(...((data ?? []) as ExistingListing[]))
    if ((data ?? []).length < pageSize) break
  }
  return rows
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
) {
  const output = new Array<R>(values.length)
  let cursor = 0
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor++
        output[index] = await mapper(values[index])
      }
    },
  ))
  return output
}

async function loadOffersForSku(sku: string, accessToken: string) {
  const url = new URL(OFFERS_ENDPOINT)
  url.searchParams.set("sku", sku)
  url.searchParams.set("limit", "100")
  url.searchParams.set("offset", "0")
  return loadAllPages(url.href, "offers", accessToken)
}

async function syncEbayActiveListingsWithToken(
  supabase: SupabaseClient,
  accessToken: string,
  accountKey: string,
) {
  try {
    const syncRunId = crypto.randomUUID()
    const { data: generationData, error: generationError } = await supabase.rpc(
      "begin_ebay_active_listing_sync_generation",
      {
        p_account_key: accountKey,
        p_sync_run_id: syncRunId,
      },
    )
    const generationRow = Array.isArray(generationData)
      ? generationData[0]
      : generationData
    const syncGeneration = Number(generationRow?.sync_generation)
    if (
      generationError ||
      !Number.isSafeInteger(syncGeneration) ||
      syncGeneration < 1
    ) {
      throw new Error("EBAY_ACTIVE_LISTING_SYNC_GENERATION_FAILED")
    }
    const inventoryItems = await loadAllPages(
      INVENTORY_ITEMS_ENDPOINT,
      "inventoryItems",
      accessToken,
    )
    const inventoryBySku = new Map(
      inventoryItems
        .map((item) => [text(item.sku), item] as const)
        .filter((entry): entry is [string, JsonRecord] => Boolean(entry[0])),
    )
    const inventorySkus = [...inventoryBySku.keys()]
    const offersBySku = await mapWithConcurrency(
      inventorySkus,
      OFFER_READ_CONCURRENCY,
      (sku) => loadOffersForSku(sku, accessToken),
    )
    const offers = offersBySku.flat()
    const publishedOffers = offers.filter((offer) => Boolean(listingId(offer)))
    const skus = [...new Set(publishedOffers.map((offer) => text(offer.sku)).filter(Boolean))] as string[]
    const mappings = await loadOpportunityMappings(supabase, skus)
    const observedAt = new Date().toISOString()
    const existingListings = await loadConnectorListings(supabase, accountKey)
    const existingBySyncKey = new Map(existingListings.map((row) => [row.sync_key, row]))
    const rows = publishedOffers.flatMap((offer) => {
      const ebayItemId = listingId(offer)
      const sku = text(offer.sku)
      if (!ebayItemId || !sku) return []
      const offerId = text(offer.offerId)
      const syncKey = `${CONNECTOR_SOURCE}:${accountKey}:${offerId || `${ebayItemId}:${sku}`}`
      const previous = existingBySyncKey.get(syncKey)
      const inventory = inventoryBySku.get(sku) ?? {}
      const product = record(inventory.product)
      const pricing = record(offer.pricingSummary)
      const price = record(pricing.price)
      const mappingResolution = mappings.get(sku) ?? {
        state: "UNMAPPED" as const,
        mapping: null,
      }
      const mapping = mappingResolution.mapping
      const sameOpportunityIdentity = mapping
        ? isSameOpportunityIdentity(mapping, previous)
        : false
      const previousRaw = withoutPreviousOpportunityIdentity(
        previous?.raw_payload,
      )
      return [{
        source: CONNECTOR_SOURCE,
        account_key: accountKey,
        sync_key: syncKey,
        sync_run_id: syncRunId,
        sync_generation: syncGeneration,
        ebay_item_id: ebayItemId,
        listing_status: listingStatus(offer),
        title: text(product.title) ?? `eBay listing ${ebayItemId}`,
        ebay_sku: sku,
        ebay_quantity: inventoryQuantity(inventory, offer),
        ebay_price: numberOrNull(price.value),
        currency: text(price.currency) ?? "USD",
        // A completed lookup is authoritative. Ambiguous, malformed and
        // unresolved identities are cleared instead of inheriting stale links.
        market_radar_product_id: mapping ? mapping.productId : null,
        supplier_variant_id: mapping ? mapping.variantId : null,
        supplier_sku: mapping ? mapping.supplierSku : null,
        supplier_cost_at_linking: mapping
          ? sameOpportunityIdentity
            ? previous?.supplier_cost_at_linking ?? mapping.supplierPrice
            : mapping.supplierPrice
          : null,
        last_ebay_sync_at: observedAt,
        raw_payload: {
          ...previousRaw,
          source: CONNECTOR_SOURCE,
          offerId,
          marketplaceId: text(offer.marketplaceId),
          categoryId: text(offer.categoryId),
          offerStatus: text(offer.status),
          opportunityMappingState: mappingResolution.state,
          opportunityMappingSource: mapping?.source ?? null,
        },
        updated_at: observedAt,
      }]
    })

    // A single database transaction conditionally applies this generation and
    // reconciles missing offers. A slower, older run can never resurrect rows
    // after a newer generation has committed.
    const { data: commitData, error: commitError } = await supabase.rpc(
      "commit_ebay_active_listing_sync_generation",
      {
        p_account_key: accountKey,
        p_sync_run_id: syncRunId,
        p_sync_generation: syncGeneration,
        p_observed_at: observedAt,
        p_rows: rows,
      },
    )
    const commit = (Array.isArray(commitData) ? commitData[0] : commitData) as {
      applied?: boolean
      listings_stored?: number
      active_listings_stored?: number
      listings_mapped_to_luna?: number
      stale_listings_ended?: number
    } | null
    if (commitError || !commit || typeof commit.applied !== "boolean") {
      throw new Error("EBAY_ACTIVE_LISTING_SYNC_COMMIT_FAILED")
    }

    return {
      status: commit.applied
        ? "AVAILABLE" as const
        : "STALE_GENERATION_IGNORED" as const,
      observedAt,
      syncGeneration,
      inventoryItemsRead: inventoryItems.length,
      inventorySkusRead: inventorySkus.length,
      offersRead: offers.length,
      activeListingsStored: Number(commit.active_listings_stored ?? 0),
      listingsStored: Number(commit.listings_stored ?? 0),
      listingsMappedToLuna: Number(commit.listings_mapped_to_luna ?? 0),
      staleListingsEnded: Number(commit.stale_listings_ended ?? 0),
      ebayWriteUsed: false as const,
      tokensReturned: false as const,
    }
  } finally {
    // Keep only the short-lived module cache; never return or persist the token.
  }
}

export async function syncEbayActiveListingsReadonly(supabase: SupabaseClient) {
  const accountKey = getEbayActiveListingAccountKey()
  for (let authorizationAttempt = 0; authorizationAttempt < 2; authorizationAttempt += 1) {
    const accessToken = await getSellerInventoryToken()
    try {
      await assertAuthenticatedSellerAccount(accessToken)
      return await syncEbayActiveListingsWithToken(
        supabase,
        accessToken,
        accountKey,
      )
    } catch (error) {
      const code = error instanceof Error ? error.message : ""
      if (code !== "EBAY_ACTIVE_LISTING_READ_401" || authorizationAttempt > 0) throw error
      cachedToken = null
    }
  }
  throw new Error("EBAY_ACTIVE_LISTING_AUTH_REFRESH_FAILED")
}

export function getEbayActiveListingReadonlySyncConfiguration() {
  const accountScope = getEbaySellerAccountScopeConfiguration()
  return {
    configured: Boolean(
      process.env.EBAY_CLIENT_ID?.trim() &&
      process.env.EBAY_CLIENT_SECRET?.trim() &&
      process.env.EBAY_SELLER_REFRESH_TOKEN?.trim() &&
      accountScope.configured
    ),
    accountScopeConfigured: accountScope.configured,
    accountScopeReason: accountScope.reason,
    requiredScope: "sell.inventory.readonly",
    ebayWriteUsed: false,
    canPublish: false,
  }
}
