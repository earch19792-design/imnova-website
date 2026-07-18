import { createHash, timingSafeEqual } from "node:crypto"
// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
import { createEbayReadonlyRateLimitError } from "./ebay-readonly-rate-limit.ts"

const TOKEN_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token"
const TRADING_ENDPOINT = "https://api.ebay.com/ws/api.dll"
const BASE_SCOPE = "https://api.ebay.com/oauth/api_scope"
const REQUEST_TIMEOUT_MS = 10_000
const COMPATIBILITY_LEVEL = "1423"
const SITE_ID_US = "0"

type FetchLike = typeof fetch

export type TradingItemIdentityReadOnlyResult = {
  itemId: string
  title: string | null
  brand: string | null
  manufacturer: string | null
  gtin: string | null
  mpn: string | null
  model: string | null
  size: string | null
  color: string | null
  scent: string | null
  variant: string | null
  packCount: number | null
  unitCount: number | null
  condition: string | null
  categoryId: string | null
  observedAt: string
  source: "EBAY_TRADING_GET_ITEM_READONLY"
  ebayWriteUsed: false
}

function decodeXml(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&")
}

function tagPattern(tag: string, flags = "i") {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${escaped}>`,
    flags,
  )
}

function tagValue(xml: string, tag: string) {
  const match = xml.match(tagPattern(tag))
  const value = match ? decodeXml(match[1].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim() : ""
  return value || null
}

function container(xml: string, tag: string) {
  return xml.match(tagPattern(tag))?.[1] ?? ""
}

function containers(xml: string, tag: string) {
  return [...xml.matchAll(tagPattern(tag, "gi"))].map((match) => match[1])
}

function positiveInteger(value: string | null) {
  const match = value?.match(/\b(\d{1,4})\b/)
  const parsed = match ? Number(match[1]) : NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function numericIdentifier(value: string | null) {
  return value && /^\d{1,20}$/.test(value) ? value : null
}

export function parseTradingItemIdentityResponse(
  getItemXml: string,
  expectedItemId: string,
  now = new Date(),
): TradingItemIdentityReadOnlyResult {
  const item = container(getItemXml, "Item")
  if (!item || tagValue(item, "ItemID") !== expectedItemId) {
    throw new Error("EBAY_TRADING_GETITEM_IDENTITY_INCOMPLETE")
  }
  const specifics = new Map<string, string>()
  for (const valueList of containers(item, "NameValueList")) {
    const name = tagValue(valueList, "Name")?.toLocaleLowerCase("en-US")
    const value = tagValue(valueList, "Value")
    if (name && value && !specifics.has(name)) specifics.set(name, value)
  }
  const detail = container(item, "ProductListingDetails")
  const aspect = (...names: string[]) => names.map((name) => specifics.get(name)).find(Boolean) ?? null
  const gtin = tagValue(detail, "UPC") ?? tagValue(detail, "EAN") ?? tagValue(detail, "ISBN") ??
    aspect("upc", "ean", "gtin")
  return {
    itemId: expectedItemId,
    title: tagValue(item, "Title"), brand: aspect("brand"),
    manufacturer: aspect("manufacturer"),
    gtin: gtin && /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin.replace(/[\s-]/g, ""))
      ? gtin.replace(/[\s-]/g, "") : null,
    mpn: aspect("mpn", "manufacturer part number"),
    model: aspect("model", "model number"), size: aspect("size", "unit size", "volume"),
    color: aspect("color", "colour"), scent: aspect("scent", "fragrance"),
    variant: aspect("type", "variation"),
    packCount: positiveInteger(aspect("number in pack", "pack quantity", "package quantity")),
    unitCount: positiveInteger(aspect("unit quantity", "count per pack", "number of items in set")),
    condition: tagValue(item, "ConditionDisplayName"),
    categoryId: numericIdentifier(tagValue(container(item, "PrimaryCategory"), "CategoryID")),
    observedAt: now.toISOString(), source: "EBAY_TRADING_GET_ITEM_READONLY",
    ebayWriteUsed: false,
  }
}

function getUserRequest() {
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<GetUserRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    "<OutputSelector>User.UserID</OutputSelector></GetUserRequest>"
}

function getItemRequest(itemId: string) {
  const selectors = [
    "Item.ItemID", "Item.Title", "Item.PrimaryCategory.CategoryID", "Item.ConditionDisplayName",
    "Item.ProductListingDetails.UPC", "Item.ProductListingDetails.EAN",
    "Item.ProductListingDetails.ISBN", "Item.ItemSpecifics.NameValueList",
    "Item.Variations.VariationSpecificsSet.NameValueList",
  ]
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<GetItemRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    `<ItemID>${itemId}</ItemID>` + selectors.map((selector) =>
      `<OutputSelector>${selector}</OutputSelector>`).join("") + "</GetItemRequest>"
}

async function accessToken(fetchImpl: FetchLike) {
  const clientId = process.env.EBAY_CLIENT_ID?.trim() ?? ""
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim() ?? ""
  const refreshToken = process.env.EBAY_SELLER_REFRESH_TOKEN?.trim() ?? ""
  if (!clientId || !clientSecret || !refreshToken) throw new Error("EBAY_TRADING_READONLY_NOT_CONFIGURED")
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, scope: BASE_SCOPE }),
    cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (response.status === 429) throw createEbayReadonlyRateLimitError("EBAY_OAUTH_429", response, {
    apiFamily: "TRADING", operation: "OAUTH_REFRESH", endpoint: "/identity/v1/oauth2/token",
  })
  if (!response.ok) throw new Error(`EBAY_TRADING_OAUTH_${response.status}`)
  const payload = await response.json() as Record<string, unknown>
  const token = typeof payload.access_token === "string" ? payload.access_token.trim() : ""
  if (!token) throw new Error("EBAY_TRADING_OAUTH_TOKEN_MISSING")
  return token
}

async function tradingRead(callName: "GetUser" | "GetItem", token: string,
  body: string, fetchImpl: FetchLike) {
  const response = await fetchImpl(TRADING_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/xml", "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPATIBILITY_LEVEL,
      "X-EBAY-API-SITEID": SITE_ID_US, "X-EBAY-API-IAF-TOKEN": token },
    body, cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const xml = await response.text()
  const ack = tagValue(xml, "Ack")?.toLocaleLowerCase("en-US")
  if (response.status === 429) throw createEbayReadonlyRateLimitError("EBAY_READONLY_GET_429", response, {
    apiFamily: "TRADING", operation: callName.toUpperCase(), endpoint: "/ws/api.dll",
  })
  if (!response.ok || !["success", "warning"].includes(ack ?? "")) {
    throw new Error(`EBAY_TRADING_${callName.toLocaleUpperCase("en-US")}_${response.status}`)
  }
  return xml
}

function expectedFingerprint() {
  const value = process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT?.trim() ||
    process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT?.trim() || ""
  return /^[0-9a-f]{64}$/i.test(value) ? value.toLocaleLowerCase("en-US") : ""
}

/** Official Trading GetItem read. It never selects, returns or compares competitor SKU/Custom Label. */
export async function readEbayTradingItemIdentityReadonly(
  ebayItemId: string,
  fetchImpl: FetchLike = fetch,
) {
  if (!/^\d{9,20}$/.test(ebayItemId)) throw new Error("MANUAL_LISTING_ITEM_ID_INVALID")
  const expected = expectedFingerprint()
  if (!expected) throw new Error("EBAY_TRADING_OFFICIAL_IDENTITY_NOT_BOUND")
  let token = await accessToken(fetchImpl)
  try {
    const getUserXml = await tradingRead("GetUser", token, getUserRequest(), fetchImpl)
    const userId = tagValue(container(getUserXml, "User"), "UserID")
    if (!userId) throw new Error("EBAY_TRADING_GETUSER_IDENTITY_MISSING")
    const actual = createHash("sha256").update(`PRODUCTION:${userId}`).digest("hex")
    if (!timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))) {
      throw new Error("EBAY_TRADING_CONFIGURED_FINGERPRINT_MISMATCH")
    }
    const xml = await tradingRead("GetItem", token, getItemRequest(ebayItemId), fetchImpl)
    return parseTradingItemIdentityResponse(xml, ebayItemId)
  } finally {
    token = ""
  }
}
