import {
  ebayProductionAccountFingerprint,
  getEbayProductionIdentityBindingConfiguration,
} from "./ebay-seller-account-scope"

export const SELLER_OS_REVERSIBLE_OOS_PREFLIGHT_V1 =
  "SELLER_OS_REVERSIBLE_OOS_PREFLIGHT_V1_2026_08_23" as const
export const REVERSIBLE_OOS_TARGET_ITEM_ID = "366569086086" as const
export const REVERSIBLE_OOS_TARGET_SKU = "IMN-LST-000001" as const

const EBAY_ORIGIN = "https://api.ebay.com"
const TOKEN_ENDPOINT = `${EBAY_ORIGIN}/identity/v1/oauth2/token`
const TRADING_ENDPOINT = `${EBAY_ORIGIN}/ws/api.dll`
const INVENTORY_OFFER_ENDPOINT = `${EBAY_ORIGIN}/sell/inventory/v1/offer`
const BASE_SCOPE = "https://api.ebay.com/oauth/api_scope"
const INVENTORY_READONLY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly"
const MAX_XML_BYTES = 64 * 1024
const MAX_JSON_BYTES = 128 * 1024
const REQUEST_TIMEOUT_MS = 12_000

type FetchLike = typeof fetch

type AuthorizedPublication = Readonly<{
  listingId: string
  sku: string
  offerId: string
}> | null

export type ReversibleOosListingManagementModel =
  | "TRADING_FIXED_PRICE"
  | "INVENTORY_API_MANAGED"
  | "OTHER"
  | "UNPROVEN"

export type ReversibleOosModelPreflightV1 = Readonly<{
  contractVersion: typeof SELLER_OS_REVERSIBLE_OOS_PREFLIGHT_V1
  target: { itemId: typeof REVERSIBLE_OOS_TARGET_ITEM_ID
    sku: typeof REVERSIBLE_OOS_TARGET_SKU }
  outOfStockControlReadAttempted: boolean
  outOfStockControl: boolean | "UNPROVEN"
  listingManagementModel: ReversibleOosListingManagementModel
  listingManagementModelProven: boolean
  managementEvidenceSource: string
  tradingItemReadAttempted: boolean
  tradingReadSuccess: boolean
  inventoryOfferLookupAttempted: boolean
  inventoryOfferExactMatch: boolean
  inventoryPublicationItemIdMatch: boolean
  reversibleQuantityZeroSemanticsProven: boolean
  reversibleRestoreSemanticsProven: boolean
  preservesItemId: boolean
  targetReversibleProtectPossible: boolean
  listing: {
    itemIdMatch: boolean
    skuMatch: boolean
    sellerAccountMatch: boolean
    listingType: string | null
    listingDuration: string | null
    listingStatus: string | null
    inventoryTrackingMethod: string | null
    quantity: number | null
  }
  safety: {
    readOnly: true
    rawPayloadReturned: false
    credentialsReturned: false
    ebayWrites: 0
    databaseWrites: 0
    lunaWrites: 0
  }
  limitationCode: string | null
}>

function text(value: unknown, maximum = 200) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().slice(0, maximum)
    : ""
}

function nonNegativeInteger(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function tradingXmlTagValue(xml: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = xml.match(new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)` +
      `<\\/(?:[A-Za-z0-9_-]+:)?${escaped}>`,
    "i",
  ))
  if (!match) return null
  const value = match[1].replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()
  return value || null
}

function acceptedAck(xml: string) {
  return ["success", "warning"].includes(
    text(tradingXmlTagValue(xml, "Ack"), 20).toLowerCase(),
  )
}

async function boundedText(response: Response, maximum: number) {
  const declared = response.headers.get("content-length")
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    throw new Error("REVERSIBLE_OOS_RESPONSE_TOO_LARGE")
  }
  const value = await response.text()
  if (Buffer.byteLength(value, "utf8") > maximum) {
    throw new Error("REVERSIBLE_OOS_RESPONSE_TOO_LARGE")
  }
  return value
}

function generalCredentials(environment: NodeJS.ProcessEnv) {
  return {
    clientId: text(environment.EBAY_CLIENT_ID, 500),
    clientSecret: text(environment.EBAY_CLIENT_SECRET, 500),
    refreshToken: text(environment.EBAY_SELLER_REFRESH_TOKEN, 8_000),
  }
}

async function canonicalCommercialTradingAccessToken(fetchImpl: FetchLike) {
  const { getEbayCommercialOrdersAccessToken } = await import(
    "./ebay-commercial-oauth"
  )
  return getEbayCommercialOrdersAccessToken(fetchImpl)
}

async function mintToken(input: {
  credentials: ReturnType<typeof generalCredentials>
  scopes: string[]
  fetchImpl: FetchLike
}) {
  if (!input.credentials.clientId || !input.credentials.clientSecret ||
      !input.credentials.refreshToken) {
    throw new Error("REVERSIBLE_OOS_EBAY_CREDENTIALS_UNAVAILABLE")
  }
  const response = await input.fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${input.credentials.clientId}:${input.credentials.clientSecret}`,
        "utf8",
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.credentials.refreshToken,
      scope: input.scopes.join(" "),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const body = await boundedText(response, MAX_JSON_BYTES)
  let payload: Record<string, unknown> = {}
  try {
    payload = JSON.parse(body) as Record<string, unknown>
  } catch {
    throw new Error("REVERSIBLE_OOS_OAUTH_RESPONSE_INVALID")
  }
  const accessToken = text(payload.access_token, 8_000)
  if (!response.ok || !accessToken) {
    throw new Error(`REVERSIBLE_OOS_OAUTH_${response.status}`)
  }
  return accessToken
}

async function tradingRead(input: {
  callName: "GetUserPreferences" | "GetItem"
  body: string
  token: string
  fetchImpl: FetchLike
}) {
  const response = await input.fetchImpl(TRADING_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": input.callName,
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1423",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": input.token,
    },
    body: input.body,
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const xml = await boundedText(response, MAX_XML_BYTES)
  if (!response.ok || !acceptedAck(xml)) {
    throw new Error(`REVERSIBLE_OOS_${input.callName.toUpperCase()}_${response.status}`)
  }
  return xml
}

function getUserPreferencesXml() {
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<GetUserPreferencesRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    "<ShowOutOfStockControlPreference>true</ShowOutOfStockControlPreference>" +
    "</GetUserPreferencesRequest>"
}

function getItemXml() {
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<GetItemRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    `<ItemID>${REVERSIBLE_OOS_TARGET_ITEM_ID}</ItemID>` +
    [
      "Item.ItemID",
      "Item.SKU",
      "Item.Seller.UserID",
      "Item.ListingType",
      "Item.ListingDuration",
      "Item.SellingStatus.ListingStatus",
      "Item.Quantity",
      "Item.InventoryTrackingMethod",
    ].map((selector) => `<OutputSelector>${selector}</OutputSelector>`).join("") +
    "</GetItemRequest>"
}

type ExactInventoryLookup = {
  attempted: boolean
  complete: boolean
  exactMatch: boolean
  exactOfferId: string | null
  itemIdMatch: boolean
  ambiguous: boolean
}

async function exactInventoryOfferLookup(input: {
  environment: NodeJS.ProcessEnv
  fetchImpl: FetchLike
}): Promise<ExactInventoryLookup> {
  const token = await mintToken({
    credentials: generalCredentials(input.environment),
    scopes: [BASE_SCOPE, INVENTORY_READONLY_SCOPE],
    fetchImpl: input.fetchImpl,
  })
  const url = new URL(INVENTORY_OFFER_ENDPOINT)
  url.searchParams.set("sku", REVERSIBLE_OOS_TARGET_SKU)
  url.searchParams.set("limit", "100")
  const response = await input.fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const raw = await boundedText(response, MAX_JSON_BYTES)
  let payload: Record<string, unknown> = {}
  try {
    payload = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error("REVERSIBLE_OOS_INVENTORY_RESPONSE_INVALID")
  }
  if (!response.ok || !Array.isArray(payload.offers)) {
    throw new Error(`REVERSIBLE_OOS_INVENTORY_${response.status}`)
  }
  const offers = payload.offers.filter((offer): offer is Record<string, unknown> =>
    Boolean(offer) && typeof offer === "object" && !Array.isArray(offer))
  const total = typeof payload.total === "number" &&
      Number.isSafeInteger(payload.total) && payload.total >= 0
    ? payload.total : null
  const complete = total !== null && total === offers.length &&
    !payload.next && offers.length <= 100
  const exact = offers.filter((offer) => {
    const listing = offer.listing && typeof offer.listing === "object" &&
        !Array.isArray(offer.listing)
      ? offer.listing as Record<string, unknown> : {}
    return text(offer.sku, 100) === REVERSIBLE_OOS_TARGET_SKU &&
      text(offer.marketplaceId, 40) === "EBAY_US" &&
      text(offer.status, 40).toUpperCase() === "PUBLISHED" &&
      text(listing.listingId, 20) === REVERSIBLE_OOS_TARGET_ITEM_ID
  })
  const exactOfferId = exact.length === 1
    ? text(exact[0]?.offerId, 100) || null : null
  return {
    attempted: true,
    complete,
    exactMatch: exact.length === 1 && Boolean(exactOfferId),
    exactOfferId,
    itemIdMatch: exact.length === 1,
    ambiguous: exact.length > 1,
  }
}

function unavailable(limitationCode: string,
  partial: Partial<ReversibleOosModelPreflightV1> = {},
): ReversibleOosModelPreflightV1 {
  return Object.freeze({
    contractVersion: SELLER_OS_REVERSIBLE_OOS_PREFLIGHT_V1,
    target: { itemId: REVERSIBLE_OOS_TARGET_ITEM_ID,
      sku: REVERSIBLE_OOS_TARGET_SKU },
    outOfStockControlReadAttempted: false,
    outOfStockControl: "UNPROVEN",
    listingManagementModel: "UNPROVEN",
    listingManagementModelProven: false,
    managementEvidenceSource: "UNPROVEN",
    tradingItemReadAttempted: false,
    tradingReadSuccess: false,
    inventoryOfferLookupAttempted: false,
    inventoryOfferExactMatch: false,
    inventoryPublicationItemIdMatch: false,
    reversibleQuantityZeroSemanticsProven: false,
    reversibleRestoreSemanticsProven: false,
    preservesItemId: false,
    targetReversibleProtectPossible: false,
    listing: { itemIdMatch: false, skuMatch: false,
      sellerAccountMatch: false, listingType: null, listingDuration: null,
      listingStatus: null, inventoryTrackingMethod: null, quantity: null },
    safety: { readOnly: true as const, rawPayloadReturned: false as const,
      credentialsReturned: false as const, ebayWrites: 0 as const,
      databaseWrites: 0 as const, lunaWrites: 0 as const },
    limitationCode,
    ...partial,
  })
}

export async function runVercelReversibleOosPreflightV1(input: Readonly<{
  authorizedPublication: AuthorizedPublication
  environment?: NodeJS.ProcessEnv
  fetchImpl?: FetchLike
  tradingAccessTokenProvider?: (fetchImpl: FetchLike) => Promise<string>
}>): Promise<ReversibleOosModelPreflightV1> {
  const environment = input.environment ?? process.env
  const fetchImpl = input.fetchImpl ?? fetch
  const identity = getEbayProductionIdentityBindingConfiguration(environment)
  if (!identity.bound || !identity.consistent) {
    return unavailable("REVERSIBLE_OOS_ACCOUNT_BINDING_UNPROVEN")
  }
  let preferenceAttempted = false
  let tradingItemReadAttempted = false
  let outOfStockControl: boolean | "UNPROVEN" = "UNPROVEN"
  try {
    const tradingToken = await (
      input.tradingAccessTokenProvider ?? canonicalCommercialTradingAccessToken
    )(fetchImpl)
    preferenceAttempted = true
    const preferenceXml = await tradingRead({
      callName: "GetUserPreferences",
      body: getUserPreferencesXml(),
      token: tradingToken,
      fetchImpl,
    })
    const preference = text(tradingXmlTagValue(
      preferenceXml, "OutOfStockControlPreference",
    ), 10).toLowerCase()
    outOfStockControl = preference === "true" ? true
      : preference === "false" ? false : "UNPROVEN" as const
    tradingItemReadAttempted = true
    const itemXml = await tradingRead({ callName: "GetItem",
      body: getItemXml(), token: tradingToken, fetchImpl })
    const observedItemId = text(tradingXmlTagValue(itemXml, "ItemID"), 20)
    const observedSku = text(tradingXmlTagValue(itemXml, "SKU"), 100)
    const observedSeller = text(tradingXmlTagValue(itemXml, "UserID"), 200)
    const listingType = text(tradingXmlTagValue(itemXml, "ListingType"), 50) || null
    const listingDuration = text(
      tradingXmlTagValue(itemXml, "ListingDuration"), 50,
    ) || null
    const listingStatus = text(
      tradingXmlTagValue(itemXml, "ListingStatus"), 50,
    ) || null
    const inventoryTrackingMethod = text(
      tradingXmlTagValue(itemXml, "InventoryTrackingMethod"), 50,
    ) || "ItemID"
    const quantity = nonNegativeInteger(tradingXmlTagValue(itemXml, "Quantity"))
    const itemIdMatch = observedItemId === REVERSIBLE_OOS_TARGET_ITEM_ID
    const skuMatch = observedSku === REVERSIBLE_OOS_TARGET_SKU
    const sellerAccountMatch = Boolean(observedSeller) &&
      (!identity.expectedUserId || observedSeller.toLocaleLowerCase("en-US") ===
        identity.expectedUserId.toLocaleLowerCase("en-US")) &&
      ebayProductionAccountFingerprint(observedSeller) ===
        identity.expectedAccountFingerprint
    const tradingReadSuccess = itemIdMatch && skuMatch && sellerAccountMatch &&
      listingStatus?.toLowerCase() === "active" && quantity !== null

    let inventory: ExactInventoryLookup = { attempted: false, complete: false,
      exactMatch: false, exactOfferId: null, itemIdMatch: false,
      ambiguous: false }
    let inventoryLookupFailure: string | null = null
    const inventoryOwnershipNeedsResolution = tradingReadSuccess &&
      inventoryTrackingMethod?.toLowerCase() === "sku"
    if (inventoryOwnershipNeedsResolution) {
      try {
        inventory = await exactInventoryOfferLookup({ environment, fetchImpl })
      } catch (error) {
        inventoryLookupFailure = error instanceof Error &&
            /^[A-Z0-9_]+$/.test(error.message)
          ? error.message : "REVERSIBLE_OOS_INVENTORY_LOOKUP_FAILED"
      }
    }
    const publicationMatch = Boolean(inventory.attempted &&
      input.authorizedPublication &&
      input.authorizedPublication.listingId === REVERSIBLE_OOS_TARGET_ITEM_ID &&
      input.authorizedPublication.sku === REVERSIBLE_OOS_TARGET_SKU &&
      inventory.exactOfferId &&
      input.authorizedPublication.offerId === inventory.exactOfferId)
    let listingManagementModel: ReversibleOosListingManagementModel = "UNPROVEN"
    let managementEvidenceSource = "UNPROVEN"
    if (tradingReadSuccess && inventory.complete && inventory.exactMatch &&
        publicationMatch && !inventory.ambiguous) {
      listingManagementModel = "INVENTORY_API_MANAGED"
      managementEvidenceSource =
        "EBAY_TRADING_GET_ITEM_PLUS_EXACT_INVENTORY_OFFER_PLUS_AUTHORIZED_PUBLICATION"
    } else if (tradingReadSuccess &&
        inventoryTrackingMethod?.toLowerCase() === "itemid" &&
        listingType === "FixedPriceItem" && listingDuration === "GTC") {
      listingManagementModel = "TRADING_FIXED_PRICE"
      managementEvidenceSource =
        "EBAY_TRADING_GET_ITEM_INVENTORY_TRACKING_METHOD_ITEM_ID"
    } else if (inventory.exactMatch && !publicationMatch) {
      managementEvidenceSource =
        "INVENTORY_OFFER_PRESENT_WITHOUT_AUTHORIZED_PUBLICATION_RELATIONSHIP"
    } else if (inventoryLookupFailure) {
      managementEvidenceSource = inventoryLookupFailure
    } else if (tradingReadSuccess && listingType !== "FixedPriceItem") {
      listingManagementModel = "OTHER"
      managementEvidenceSource = "EBAY_TRADING_GET_ITEM_LISTING_TYPE"
    }
    const modelProven = listingManagementModel !== "UNPROVEN"
    const reversibleModel = listingManagementModel === "TRADING_FIXED_PRICE" ||
      listingManagementModel === "INVENTORY_API_MANAGED"
    const reversibleSemantics = outOfStockControl === true && reversibleModel &&
      tradingReadSuccess
    const limitationCode = outOfStockControl !== true
      ? outOfStockControl === false
        ? "OUT_OF_STOCK_CONTROL_DISABLED"
        : "OUT_OF_STOCK_CONTROL_UNPROVEN"
      : !modelProven
        ? "LISTING_MANAGEMENT_MODEL_UNPROVEN"
        : !reversibleModel
          ? "LISTING_MANAGEMENT_MODEL_NOT_REVERSIBLE"
        : null
    return Object.freeze({
      contractVersion: SELLER_OS_REVERSIBLE_OOS_PREFLIGHT_V1,
      target: { itemId: REVERSIBLE_OOS_TARGET_ITEM_ID,
        sku: REVERSIBLE_OOS_TARGET_SKU },
      outOfStockControlReadAttempted: preferenceAttempted,
      outOfStockControl,
      listingManagementModel,
      listingManagementModelProven: modelProven,
      managementEvidenceSource,
      tradingItemReadAttempted,
      tradingReadSuccess,
      inventoryOfferLookupAttempted: inventory.attempted,
      inventoryOfferExactMatch: inventory.exactMatch,
      inventoryPublicationItemIdMatch: publicationMatch,
      reversibleQuantityZeroSemanticsProven: reversibleSemantics,
      reversibleRestoreSemanticsProven: reversibleSemantics,
      preservesItemId: reversibleSemantics,
      targetReversibleProtectPossible: reversibleSemantics,
      listing: { itemIdMatch, skuMatch, sellerAccountMatch, listingType,
        listingDuration, listingStatus, inventoryTrackingMethod, quantity },
      safety: { readOnly: true as const, rawPayloadReturned: false as const,
        credentialsReturned: false as const, ebayWrites: 0 as const,
        databaseWrites: 0 as const, lunaWrites: 0 as const },
      limitationCode,
    })
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : "REVERSIBLE_OOS_PREFLIGHT_FAILED"
    return unavailable(code, {
      outOfStockControlReadAttempted: preferenceAttempted,
      outOfStockControl,
      tradingItemReadAttempted,
    })
  }
}
