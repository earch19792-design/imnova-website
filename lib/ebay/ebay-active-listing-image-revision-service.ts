import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import sharp from "sharp"

import {
  getEbayTradingReadOnlyAccessToken,
  tradingXmlContainer,
  tradingXmlTagValue,
} from "./ebay-manual-listing-trading-readonly"
import { getEbayBaseApplicationTokenV1 } from
  "./ebay-seller-keyword-demand-gateway"
import {
  ebayProductionAccountFingerprint,
  getEbayProductionIdentityBindingConfiguration,
} from "./ebay-seller-account-scope"

export const ACTIVE_LISTING_IMAGE_REVISION_CONFIRMATION =
  "APLICAR 6 IMAGENES AL LISTING ACTIVO"
export const EBAY_TRADING_OFFICIAL_IMAGE_SET_DIGEST_VERSION =
  "EBAY_TRADING_PICTURE_URL_ORDERED_SET_V1" as const

const TRADING_ENDPOINT = "https://api.ebay.com/ws/api.dll"
const COMPATIBILITY_LEVEL = "1423"
const SITE_ID_US = "0"
const READ_TIMEOUT_MS = 15_000
const WRITE_TIMEOUT_MS = 25_000
const EPS_UPLOAD_TIMEOUT_MS = 25_000
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const SNAPSHOT_VERSION = "EBAY_ACTIVE_LISTING_IMAGE_SNAPSHOT_V1"

type JsonRecord = Record<string, unknown>
type FetchLike = typeof fetch

export type OfficialListingSnapshot = {
  authenticatedUserId: string
  sellerUserId: string
  itemId: string
  listingStatus: string
  ebaySku: string
  listingType: string
  pictureSource: string | null
  galleryUrl: string | null
  pictureUrls: string[]
  externalPictureUrls: string[]
  tradingPictureReadback: OfficialTradingPictureReadbackV1 | null
  protectedFields: OfficialTradingProtectedFieldsV1 | null
  observedAt: string
  sourceAuthority?: string
}

export type OfficialTradingProtectedFieldsV1 = Readonly<{
  title: string
  price: string
  currency: string
  quantity: string
  quantitySold: string
  categoryId: string
  conditionId: string
  sku: string
  descriptionDigest: string
  itemSpecificsDigest: string
  shippingDigest: string
  returnPolicyDigest: string
  paymentMethodsDigest: string
  shippingProfileId: string
  paymentProfileId: string
  returnProfileId: string
}>

export type OfficialTradingPictureReadbackV1 = Readonly<{
  authority: "EBAY_TRADING_GET_ITEM_PICTURE_DETAILS_V1"
  officialPictureCount: number
  orderedPictureUrlCount: number
  imageDigestInputCount: number
  imageDigestCanonicalizationVersion:
    typeof EBAY_TRADING_OFFICIAL_IMAGE_SET_DIGEST_VERSION
  officialImageSetDigest: string
  canonicalDigestInput: readonly string[]
  galleryUrlIncludedInDigest: false
  browseImageIncludedInDigest: false
  manifestImageIncludedInDigest: false
  mixedImageAuthority: false
  images: readonly Readonly<{
    position: number
    hostClass: "EBAY_EPS" | "EXTERNAL" | "OTHER"
    urlPresent: boolean
    urlSha256: string | null
    dimensionsIfAvailable: null
  }>[]
}>

type ImageVerification = {
  verified: boolean
  method: "EXACT_EXTERNAL_URLS" | "EXACT_PICTURE_URLS" | "PERCEPTUAL_EPS" | "NO_MATCH"
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : ""
}

function uuid(value: unknown) {
  const normalized = text(value, 40)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(normalized) ? normalized : ""
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export function normalizeOfficialTradingPictureUrlV1(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      return null
    }
    // Query parameters are part of legitimate eBay PictureURL values and are
    // therefore preserved as material bytes. Dropping or rejecting them makes
    // the count and digest describe different ordered sets.
    return url.href
  } catch { return null }
}

function tradingPictureHostClass(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase()
    if (host === "ebayimg.com" || host.endsWith(".ebayimg.com")) {
      return "EBAY_EPS" as const
    }
    return host ? "EXTERNAL" as const : "OTHER" as const
  } catch { return "OTHER" as const }
}

export function buildOfficialTradingPictureReadbackV1(
  pictureUrls: readonly string[],
): OfficialTradingPictureReadbackV1 {
  const normalized = pictureUrls.map(normalizeOfficialTradingPictureUrlV1)
  if (normalized.some((url) => url === null)) {
    throw new Error("EBAY_TRADING_GET_ITEM_PICTURE_URL_INVALID")
  }
  const canonicalDigestInput = normalized as string[]
  const canonicalBytes = JSON.stringify(canonicalDigestInput)
  return Object.freeze({
    authority: "EBAY_TRADING_GET_ITEM_PICTURE_DETAILS_V1" as const,
    officialPictureCount: pictureUrls.length,
    orderedPictureUrlCount: canonicalDigestInput.length,
    imageDigestInputCount: canonicalDigestInput.length,
    imageDigestCanonicalizationVersion:
      EBAY_TRADING_OFFICIAL_IMAGE_SET_DIGEST_VERSION,
    officialImageSetDigest: `sha256:${sha256(canonicalBytes)}`,
    canonicalDigestInput: Object.freeze([...canonicalDigestInput]),
    galleryUrlIncludedInDigest: false as const,
    browseImageIncludedInDigest: false as const,
    manifestImageIncludedInDigest: false as const,
    mixedImageAuthority: false as const,
    images: Object.freeze(canonicalDigestInput.map((url, index) =>
      Object.freeze({
        position: index + 1,
        hostClass: tradingPictureHostClass(url),
        urlPresent: true,
        urlSha256: `sha256:${sha256(url)}`,
        dimensionsIfAvailable: null,
      }))),
  })
}

function databaseErrorCode(error: unknown, fallback: string) {
  const message = text(record(error).message, 1_000)
  return message.match(/[A-Z][A-Z0-9_]{2,160}/)?.[0] ?? fallback
}

function firstRow(value: unknown) {
  return record(Array.isArray(value) ? value[0] : value)
}

function exactSixUrls(value: unknown) {
  if (!Array.isArray(value) || value.length !== 6) return []
  const urls = value.map((entry) => text(entry, 500))
  if (
    urls.some((url) => !url.startsWith("https://")) ||
    new Set(urls).size !== 6 ||
    urls.reduce((total, url) => total + url.length, 0) > 3_975
  ) return []
  return urls
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function xmlTagValues(xml: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const pattern = new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${escaped}>`,
    "gi",
  )
  return Array.from(xml.matchAll(pattern)).map((match) => match[1]
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim())
    .filter(Boolean)
}

function responseAccepted(xml: string) {
  const ack = tradingXmlTagValue(xml, "Ack")?.toLowerCase()
  return ack === "success" || ack === "warning"
}

function officialReadFailureClass(
  callName: "GET_USER" | "GET_ITEM",
  result: { response: Response; xml: string },
) {
  const ebayError = text(tradingXmlTagValue(result.xml, "ErrorCode"), 20)
  return `EBAY_ACTIVE_IMAGE_REVISION_${callName}_HTTP_${result.response.status}`
    + (/^\d{1,20}$/.test(ebayError) ? `_EBAY_ERROR_${ebayError}` : "")
}

function getUserRequestXml() {
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<GetUserRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    "<OutputSelector>User.UserID</OutputSelector>" +
    "</GetUserRequest>"
}

function getItemRequestXml(itemId: string) {
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<GetItemRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    `<ItemID>${itemId}</ItemID>` +
    [
      "Item.ItemID",
      "Item.Seller.UserID",
      "Item.SellingStatus.ListingStatus",
      "Item.Title",
      "Item.SKU",
      "Item.ListingType",
      "Item.Quantity",
      "Item.SellingStatus.QuantitySold",
      "Item.SellingStatus.CurrentPrice",
      "Item.Currency",
      "Item.PrimaryCategory.CategoryID",
      "Item.ConditionID",
      "Item.Description",
      "Item.ItemSpecifics",
      "Item.ShippingDetails",
      "Item.ReturnPolicy",
      "Item.PaymentMethods",
      "Item.SellerProfiles",
      "Item.PictureDetails",
        "Item.PictureDetails.PictureSource",
        "Item.PictureDetails.PictureURL",
        "Item.PictureDetails.ExternalPictureURL",
        "Item.PictureDetails.GalleryURL",
    ].map((selector) => `<OutputSelector>${selector}</OutputSelector>`).join("") +
    "</GetItemRequest>"
}

function protectedXmlDigest(value: string) {
  return `sha256:${sha256(value.replace(/>\s+</g, "><").trim())}`
}

function protectedFieldsFromTradingItem(
  item: string,
): OfficialTradingProtectedFieldsV1 {
  const selling = tradingXmlContainer(item, "SellingStatus")
  const primaryCategory = tradingXmlContainer(item, "PrimaryCategory")
  const sellerProfiles = tradingXmlContainer(item, "SellerProfiles")
  const shippingProfile = tradingXmlContainer(
    sellerProfiles, "SellerShippingProfile")
  const paymentProfile = tradingXmlContainer(
    sellerProfiles, "SellerPaymentProfile")
  const returnProfile = tradingXmlContainer(
    sellerProfiles, "SellerReturnProfile")
  return Object.freeze({
    title: text(tradingXmlTagValue(item, "Title"), 240),
    price: text(tradingXmlTagValue(selling, "CurrentPrice"), 40),
    currency: text(tradingXmlTagValue(item, "Currency"), 12),
    quantity: text(tradingXmlTagValue(item, "Quantity"), 20),
    quantitySold: text(tradingXmlTagValue(selling, "QuantitySold"), 20),
    categoryId: text(tradingXmlTagValue(primaryCategory, "CategoryID"), 20),
    conditionId: text(tradingXmlTagValue(item, "ConditionID"), 20),
    sku: text(tradingXmlTagValue(item, "SKU"), 50),
    descriptionDigest: protectedXmlDigest(
      tradingXmlContainer(item, "Description")),
    itemSpecificsDigest: protectedXmlDigest(
      tradingXmlContainer(item, "ItemSpecifics")),
    shippingDigest: protectedXmlDigest(
      tradingXmlContainer(item, "ShippingDetails")),
    returnPolicyDigest: protectedXmlDigest(
      tradingXmlContainer(item, "ReturnPolicy")),
    paymentMethodsDigest: protectedXmlDigest(
      xmlTagValues(item, "PaymentMethods").join("\u0000")),
    shippingProfileId: text(tradingXmlTagValue(
      shippingProfile, "ShippingProfileID"), 40),
    paymentProfileId: text(tradingXmlTagValue(
      paymentProfile, "PaymentProfileID"), 40),
    returnProfileId: text(tradingXmlTagValue(
      returnProfile, "ReturnProfileID"), 40),
  })
}

function uploadSiteHostedPictureRequestXml(imageUrl: string, position: number) {
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<UploadSiteHostedPicturesRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    "<WarningLevel>High</WarningLevel>" +
    `<ExternalPictureURL>${xmlEscape(imageUrl)}</ExternalPictureURL>` +
    `<PictureName>IMNOVA approved image ${position}</PictureName>` +
    "<PictureSet>Standard</PictureSet>" +
    "</UploadSiteHostedPicturesRequest>"
}

function revisePicturesRequestXml(
  itemId: string,
  imageUrls: string[],
  pictureSource: "EPS" | "Vendor",
) {
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<ReviseFixedPriceItemRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    "<Item>" +
    `<ItemID>${itemId}</ItemID>` +
    `<PictureDetails><PictureSource>${pictureSource}</PictureSource>` +
    imageUrls.map((url) => `<PictureURL>${xmlEscape(url)}</PictureURL>`).join("") +
    "</PictureDetails>" +
    "</Item>" +
    "</ReviseFixedPriceItemRequest>"
}

  async function tradingCall(input: {
    callName: "GetUser" | "GetItem" | "UploadSiteHostedPictures" | "ReviseFixedPriceItem"
  accessToken: string
  body: string
  fetchImpl: FetchLike
  timeoutMs: number
}) {
  const endpoint = new URL(TRADING_ENDPOINT)
  if (
    endpoint.origin !== "https://api.ebay.com" ||
    endpoint.pathname !== "/ws/api.dll"
  ) throw new Error("EBAY_ACTIVE_IMAGE_REVISION_ENDPOINT_BLOCKED")
  const response = await input.fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": input.callName,
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPATIBILITY_LEVEL,
      "X-EBAY-API-SITEID": SITE_ID_US,
      "X-EBAY-API-IAF-TOKEN": input.accessToken,
    },
    body: input.body,
    cache: "no-store",
    signal: AbortSignal.timeout(input.timeoutMs),
  })
  return { response, xml: await response.text() }
}

export async function readOfficialActiveListingImageSnapshotV1(input: {
  accessToken: string
  itemId: string
  expectedSku: string
  accountKey: string
  fetchImpl: FetchLike
  durableAccountIdentityProven?: boolean
}): Promise<OfficialListingSnapshot> {
  const identity = getEbayProductionIdentityBindingConfiguration()
  if (
    !identity.bound || !identity.consistent ||
    !identity.expectedAccountFingerprint
  ) throw new Error("EBAY_ACTIVE_IMAGE_REVISION_ACCOUNT_NOT_BOUND")
  const userPromise = input.durableAccountIdentityProven
    ? Promise.resolve(null)
    : tradingCall({
      callName: "GetUser",
      accessToken: input.accessToken,
      body: getUserRequestXml(),
      fetchImpl: input.fetchImpl,
      timeoutMs: READ_TIMEOUT_MS,
    })
  const [userResult, itemResult] = await Promise.all([userPromise,
    tradingCall({
      callName: "GetItem",
      accessToken: input.accessToken,
      body: getItemRequestXml(input.itemId),
      fetchImpl: input.fetchImpl,
      timeoutMs: READ_TIMEOUT_MS,
    })])
  if (userResult && (!userResult.response.ok ||
      !responseAccepted(userResult.xml))) {
    throw new Error(officialReadFailureClass("GET_USER", userResult))
  }
  if (!itemResult.response.ok || !responseAccepted(itemResult.xml)) {
    throw new Error(officialReadFailureClass("GET_ITEM", itemResult))
  }

  const authenticatedUserId = userResult ? text(
    tradingXmlTagValue(tradingXmlContainer(userResult.xml, "User"), "UserID"),
    100,
  ) : identity.expectedUserId
  const item = tradingXmlContainer(itemResult.xml, "Item")
  const sellerUserId = text(
    tradingXmlTagValue(tradingXmlContainer(item, "Seller"), "UserID"),
    100,
  )
  const itemId = text(tradingXmlTagValue(item, "ItemID"), 20)
  const listingStatus = text(
    tradingXmlTagValue(tradingXmlContainer(item, "SellingStatus"), "ListingStatus"),
    40,
  )
  const ebaySku = text(tradingXmlTagValue(item, "SKU"), 50)
  const listingType = text(tradingXmlTagValue(item, "ListingType"), 40)
  const pictures = tradingXmlContainer(item, "PictureDetails")
  const pictureSource = text(tradingXmlTagValue(pictures, "PictureSource"), 20) || null
  const galleryUrl = text(tradingXmlTagValue(pictures, "GalleryURL"), 500) || null
  const tradingPictureReadback = buildOfficialTradingPictureReadbackV1(
    xmlTagValues(pictures, "PictureURL"),
  )
  const protectedFields = protectedFieldsFromTradingItem(item)
  const identityUserId = authenticatedUserId || sellerUserId
  const fingerprint = ebayProductionAccountFingerprint(identityUserId)
  const expectedFingerprint = identity.expectedAccountFingerprint.toLowerCase()
  if (
    !identityUserId || !sellerUserId ||
    (identity.expectedUserId
      ? authenticatedUserId.toLowerCase() !== identity.expectedUserId.toLowerCase()
      : false) ||
    (authenticatedUserId
      ? sellerUserId.toLowerCase() !== authenticatedUserId.toLowerCase()
      : false) ||
    fingerprint !== expectedFingerprint ||
    !input.accountKey.endsWith(`:${expectedFingerprint}`) ||
    itemId !== input.itemId || listingStatus.toLowerCase() !== "active" ||
    ebaySku !== input.expectedSku ||
    !["fixedpriceitem", "storesfixedprice"].includes(listingType.toLowerCase())
  ) throw new Error("EBAY_ACTIVE_IMAGE_REVISION_IDENTITY_MISMATCH")

  return {
    authenticatedUserId: identityUserId,
    sellerUserId,
    itemId,
    listingStatus,
    ebaySku,
    listingType,
    pictureSource,
    galleryUrl,
    pictureUrls: [...tradingPictureReadback.canonicalDigestInput],
    externalPictureUrls: xmlTagValues(pictures, "ExternalPictureURL"),
    tradingPictureReadback,
    protectedFields,
    observedAt: new Date().toISOString(),
  } satisfies OfficialListingSnapshot
}

export async function readOfficialActiveListingBrowseSnapshotV1(input: {
  itemId: string
  accountKey: string
  fetchImpl: FetchLike
}): Promise<OfficialListingSnapshot> {
  const identity = getEbayProductionIdentityBindingConfiguration()
  if (!identity.bound || !identity.consistent ||
      !identity.expectedAccountFingerprint ||
      !/^\d{9,20}$/.test(input.itemId)) {
    throw new Error("EBAY_ACTIVE_IMAGE_BROWSE_IDENTITY_UNBOUND")
  }
  let token = await getEbayBaseApplicationTokenV1()
  try {
    const url = new URL(
      "https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id")
    url.searchParams.set("legacy_item_id", input.itemId)
    const response = await input.fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        "Accept-Language": "en-US" },
      cache: "no-store",
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
    const body = record(await response.json().catch(() => ({})))
    if (!response.ok) {
      const errors = Array.isArray(body.errors) ? body.errors.map(record) : []
      const errorId = text(errors[0]?.errorId, 20)
      throw new Error(`EBAY_ACTIVE_IMAGE_BROWSE_HTTP_${response.status}`
        + (/^\d{1,20}$/.test(errorId) ? `_EBAY_ERROR_${errorId}` : ""))
    }
    const sellerUserId = text(record(body.seller).username, 100)
    const legacyItemId = text(body.legacyItemId, 20)
      || text(body.itemId, 100).match(/^v1\|(\d{9,20})\|/)?.[1] || ""
    const fingerprint = ebayProductionAccountFingerprint(sellerUserId)
    const buyingOptions = Array.isArray(body.buyingOptions)
      ? body.buyingOptions.map((value) => text(value, 40).toUpperCase()) : []
    const main = text(record(body.image).imageUrl, 500)
    const additional = Array.isArray(body.additionalImages)
      ? body.additionalImages.map((value) => text(record(value).imageUrl, 500))
        .filter(Boolean) : []
    const pictureUrls = [...new Set([main, ...additional].filter(Boolean))]
    if (!sellerUserId || legacyItemId !== input.itemId
      || fingerprint !== identity.expectedAccountFingerprint.toLowerCase()
      || !input.accountKey.endsWith(`:${fingerprint}`)
      || !buyingOptions.includes("FIXED_PRICE")
      || pictureUrls.length === 0) {
      throw new Error("EBAY_ACTIVE_IMAGE_BROWSE_IDENTITY_MISMATCH")
    }
    return {
      authenticatedUserId: sellerUserId,
      sellerUserId,
      itemId: legacyItemId,
      listingStatus: "Active",
      // Browse proves the exact legacy Item and seller, but does not expose SKU.
      // Do not project the locally expected SKU as official evidence.
      ebaySku: "",
      listingType: "FixedPriceItem",
      pictureSource: "BROWSE_OFFICIAL",
      galleryUrl: main || null,
      pictureUrls,
      externalPictureUrls: pictureUrls,
      // Browse remains useful corroboration, but it never becomes the Trading
      // PictureDetails authority or enters its official ordered-set digest.
      tradingPictureReadback: null,
      protectedFields: null,
      observedAt: new Date().toISOString(),
      sourceAuthority: "EBAY_BROWSE_GET_ITEM_BY_LEGACY_ID_V1",
    } satisfies OfficialListingSnapshot
  } finally {
    token = ""
  }
}

function sameUrls(left: string[], right: string[]) {
  if (left.length !== right.length) return false
  return left.every((value, index) => {
    try {
      return new URL(value).href === new URL(right[index]).href
    } catch {
      return false
    }
  })
}

function approvedStorageUrl(value: string) {
  try {
    const url = new URL(value)
    const configured = new URL(
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    )
    return url.protocol === "https:" && configured.protocol === "https:" &&
      url.origin === configured.origin && !url.username && !url.password &&
      !url.search && !url.hash &&
      url.pathname.startsWith("/storage/v1/object/public/ebay-listing-images/")
  } catch {
    return false
  }
}

function ebayPictureUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" &&
      (url.hostname === "ebayimg.com" || url.hostname.endsWith(".ebayimg.com"))
  } catch {
    return false
  }
}

async function uploadApprovedImagesToEps(input: {
  imageUrls: string[]
  accessToken: string
  fetchImpl: FetchLike
}) {
  if (
    input.imageUrls.length !== 6 ||
    new Set(input.imageUrls).size !== 6 ||
    !input.imageUrls.every(approvedStorageUrl)
  ) throw new Error("EBAY_ACTIVE_IMAGE_REVISION_EPS_SOURCE_INVALID")
  const uploads = await Promise.all(input.imageUrls.map((imageUrl, index) =>
    tradingCall({
      callName: "UploadSiteHostedPictures",
      accessToken: input.accessToken,
      body: uploadSiteHostedPictureRequestXml(imageUrl, index + 1),
      fetchImpl: input.fetchImpl,
      timeoutMs: EPS_UPLOAD_TIMEOUT_MS,
    })))
  const epsUrls = uploads.map((upload) => {
    if (!upload.response.ok || !responseAccepted(upload.xml)) {
      const ebayError = text(tradingXmlTagValue(upload.xml, "ErrorCode"), 20)
      throw new Error(/^\d{1,20}$/.test(ebayError)
        ? `EBAY_ACTIVE_IMAGE_REVISION_EPS_UPLOAD_REJECTED_${ebayError}`
        : "EBAY_ACTIVE_IMAGE_REVISION_EPS_UPLOAD_FAILED")
    }
    const details = tradingXmlContainer(upload.xml, "SiteHostedPictureDetails")
    const fullUrl = text(tradingXmlTagValue(details, "FullURL"), 500)
    if (!ebayPictureUrl(fullUrl)) {
      throw new Error("EBAY_ACTIVE_IMAGE_REVISION_EPS_URL_INVALID")
    }
    return fullUrl
  })
  if (epsUrls.length !== 6 || new Set(epsUrls).size !== 6) {
    throw new Error("EBAY_ACTIVE_IMAGE_REVISION_EPS_SET_INVALID")
  }
  return epsUrls
}

async function fetchImage(input: {
  url: string
  expectedKind: "approved" | "ebay"
  fetchImpl: FetchLike
}) {
  const permitted = input.expectedKind === "approved"
    ? approvedStorageUrl
    : ebayPictureUrl
  if (!permitted(input.url)) {
    throw new Error("EBAY_ACTIVE_IMAGE_REVISION_IMAGE_HOST_BLOCKED")
  }
  const response = await input.fetchImpl(input.url, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  })
  if (!response.ok || !permitted(response.url || input.url)) {
    throw new Error("EBAY_ACTIVE_IMAGE_REVISION_IMAGE_READ_FAILED")
  }
  const contentLength = Number(response.headers.get("content-length") ?? 0)
  const contentType = response.headers.get("content-type")?.split(";")[0] ?? ""
  if (
    (contentLength && contentLength > MAX_IMAGE_BYTES) ||
    !["image/jpeg", "image/png", "image/webp"].includes(contentType)
  ) throw new Error("EBAY_ACTIVE_IMAGE_REVISION_IMAGE_READ_FAILED")
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    bytes.fill(0)
    throw new Error("EBAY_ACTIVE_IMAGE_REVISION_IMAGE_READ_FAILED")
  }
  return bytes
}

async function normalizedPixels(bytes: Buffer) {
  return sharp(bytes).rotate().resize(64, 64, { fit: "fill" })
    .removeAlpha().raw().toBuffer()
}

async function perceptuallySame(
  expectedUrl: string,
  observedUrl: string,
  expectedKind: "approved" | "ebay",
  fetchImpl: FetchLike,
) {
  const [expectedBytes, observedBytes] = await Promise.all([
    fetchImage({ url: expectedUrl, expectedKind, fetchImpl }),
    fetchImage({ url: observedUrl, expectedKind: "ebay", fetchImpl }),
  ])
  try {
    const [expected, observed] = await Promise.all([
      normalizedPixels(expectedBytes),
      normalizedPixels(observedBytes),
    ])
    try {
      if (expected.length !== observed.length || !expected.length) return false
      let absoluteDifference = 0
      for (let index = 0; index < expected.length; index += 1) {
        absoluteDifference += Math.abs(expected[index] - observed[index])
      }
      return absoluteDifference / expected.length <= 10
    } finally {
      expected.fill(0)
      observed.fill(0)
    }
  } finally {
    expectedBytes.fill(0)
    observedBytes.fill(0)
  }
}

async function verifyApprovedImages(
  snapshot: OfficialListingSnapshot,
  approvedUrls: string[],
  fetchImpl: FetchLike,
): Promise<ImageVerification> {
  if (sameUrls(snapshot.externalPictureUrls, approvedUrls)) {
    return { verified: true, method: "EXACT_EXTERNAL_URLS" }
  }
  if (sameUrls(snapshot.pictureUrls, approvedUrls)) {
    return { verified: true, method: "EXACT_PICTURE_URLS" }
  }
  if (
    snapshot.pictureUrls.length !== 6 ||
    !snapshot.pictureUrls.every(ebayPictureUrl)
  ) return { verified: false, method: "NO_MATCH" }
  const matches = await Promise.all(snapshot.pictureUrls.map((observedUrl, index) =>
    perceptuallySame(approvedUrls[index], observedUrl, "approved", fetchImpl)))
  return matches.every(Boolean)
    ? { verified: true, method: "PERCEPTUAL_EPS" }
    : { verified: false, method: "NO_MATCH" }
}

export async function verifyOfficialOrderedImageSetV1(
  snapshot: OfficialListingSnapshot,
  expectedUrls: readonly string[],
  fetchImpl: FetchLike = fetch,
): Promise<ImageVerification> {
  const expected = [...expectedUrls]
  if (expected.length < 1 || expected.length > 24
    || new Set(expected).size !== expected.length) {
    return { verified: false, method: "NO_MATCH" }
  }
  if (sameUrls(snapshot.externalPictureUrls, expected)) {
    return { verified: true, method: "EXACT_EXTERNAL_URLS" }
  }
  if (sameUrls(snapshot.pictureUrls, expected)) {
    return { verified: true, method: "EXACT_PICTURE_URLS" }
  }
  if (snapshot.pictureUrls.length !== expected.length
    || !snapshot.pictureUrls.every(ebayPictureUrl)
    || !expected.every((url) => approvedStorageUrl(url) || ebayPictureUrl(url))) {
    return { verified: false, method: "NO_MATCH" }
  }
  const matches = await Promise.all(snapshot.pictureUrls.map((observed, index) =>
    perceptuallySame(expected[index], observed,
      approvedStorageUrl(expected[index]) ? "approved" : "ebay", fetchImpl)))
  return matches.every(Boolean)
    ? { verified: true, method: "PERCEPTUAL_EPS" }
    : { verified: false, method: "NO_MATCH" }
}

function safeSnapshot(input: {
  snapshot: OfficialListingSnapshot
  verification: ImageVerification
  imageSetHash: string
  accountFingerprint: string
}) {
  return {
    version: SNAPSHOT_VERSION,
    itemId: input.snapshot.itemId,
    listingStatus: input.snapshot.listingStatus,
    ebaySku: input.snapshot.ebaySku,
    listingType: input.snapshot.listingType,
    accountFingerprint: input.accountFingerprint,
    ownershipVerified: true,
    pictureSource: input.snapshot.pictureSource,
    pictureCount: input.snapshot.pictureUrls.length,
    externalPictureCount: input.snapshot.externalPictureUrls.length,
    pictureUrlSetHash: sha256(JSON.stringify(input.snapshot.pictureUrls)),
    externalPictureUrlSetHash: sha256(JSON.stringify(input.snapshot.externalPictureUrls)),
    approvedImageSetHash: input.imageSetHash,
    imageSetVerified: input.verification.verified,
    verificationMethod: input.verification.method,
    observedAt: input.snapshot.observedAt,
  }
}

async function rpcRow(
  supabase: SupabaseClient,
  name: string,
  parameters: JsonRecord,
  fallback: string,
) {
  const { data, error } = await supabase.rpc(name, parameters)
  const row = firstRow(data)
  if (error || !row.id) throw new Error(databaseErrorCode(error, fallback))
  return row
}

function publicResult(row: JsonRecord, messageCode: string) {
  const phase = text(row.phase, 60)
  return {
    executionId: uuid(row.id),
    revisionId: uuid(row.revision_id),
    baseControlId: uuid(row.base_control_id),
    ebayItemId: text(row.ebay_item_id, 20),
    phase,
    imageCount: exactSixUrls(row.image_urls).length,
    ebayWriteAttemptCount: Number(row.ebay_write_attempt_count) || 0,
    ebayWriteDispatched: row.ebay_write_dispatched === true,
    imageSetVerified: phase === "applied_verified",
    reconciled: row.reconciled === true,
    messageCode,
  }
}

async function completeVerified(input: {
  supabase: SupabaseClient
  executionId: string
  actorId: string
  claimToken?: string | null
  snapshot: JsonRecord
  reconciled: boolean
}) {
  return rpcRow(input.supabase, "complete_ebay_active_listing_image_revision", {
    p_execution_id: input.executionId,
    p_actor: input.actorId,
    p_claim_token: input.claimToken ?? null,
    p_postflight_snapshot: input.snapshot,
    p_reconciled: input.reconciled,
  }, "EBAY_ACTIVE_IMAGE_REVISION_COMPLETE_FAILED")
}

async function markOutcomeUnknown(input: {
  supabase: SupabaseClient
  executionId: string
  actorId: string
  claimToken?: string | null
  snapshot?: JsonRecord | null
  httpStatus?: number | null
  errorCode: string
}) {
  return rpcRow(input.supabase, "mark_ebay_active_image_revision_unknown", {
    p_execution_id: input.executionId,
    p_actor: input.actorId,
    p_claim_token: input.claimToken ?? null,
    p_http_status: input.httpStatus ?? null,
    p_error_code: input.errorCode,
    p_postflight_snapshot: input.snapshot ?? null,
  }, "EBAY_ACTIVE_IMAGE_REVISION_OUTCOME_RECORD_FAILED")
}

export async function applyApprovedImageRevisionToActiveListing(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  revisionId: string
  baseControlId: string
  ebayItemId: string
  idempotencyKey: string
  confirmation: string
  fetchImpl?: FetchLike
}) {
  const actorId = uuid(input.actorId)
  const revisionId = uuid(input.revisionId)
  const baseControlId = uuid(input.baseControlId)
  const ebayItemId = text(input.ebayItemId, 20)
  const idempotencyKey = text(input.idempotencyKey, 120)
  if (
    !actorId || !revisionId || !baseControlId ||
    !/^\d{9,20}$/.test(ebayItemId) ||
    !/^[A-Za-z0-9._:-]{8,120}$/.test(idempotencyKey) ||
    input.confirmation !== ACTIVE_LISTING_IMAGE_REVISION_CONFIRMATION
  ) throw new Error("EBAY_ACTIVE_IMAGE_REVISION_CONFIRMATION_INVALID")
  const fetchImpl = input.fetchImpl ?? fetch
  const idempotencyKeyHash = sha256(idempotencyKey)
  let execution = await rpcRow(
    input.supabase,
    "prepare_ebay_active_listing_image_revision",
    {
      p_revision_id: revisionId,
      p_base_control_id: baseControlId,
      p_actor: actorId,
      p_account_key: input.accountKey,
      p_ebay_item_id: ebayItemId,
      p_idempotency_key_hash: idempotencyKeyHash,
    },
    "EBAY_ACTIVE_IMAGE_REVISION_PREPARE_FAILED",
  )
  const imageUrls = exactSixUrls(execution.image_urls)
  const expectedSku = text(execution.ebay_sku, 50)
  const imageSetHash = text(execution.image_set_hash, 64)
    const accountFingerprint = text(execution.account_fingerprint, 64)
    const executionId = uuid(execution.id)
    const ledgerIdempotencyKeyHash = text(execution.idempotency_key_hash, 64)
    if (
      imageUrls.length !== 6 || !expectedSku ||
      !/^[0-9a-f]{64}$/.test(imageSetHash) ||
      !/^[0-9a-f]{64}$/.test(accountFingerprint) ||
      !/^[0-9a-f]{64}$/.test(ledgerIdempotencyKeyHash) || !executionId
  ) throw new Error("EBAY_ACTIVE_IMAGE_REVISION_LEDGER_INVALID")

  let phase = text(execution.phase, 60)
  if (phase === "applied_verified") {
    return publicResult(execution, "EBAY_ACTIVE_IMAGE_REVISION_ALREADY_VERIFIED")
  }
  if (phase === "terminal_failure") {
    return publicResult(execution, "EBAY_ACTIVE_IMAGE_REVISION_TERMINAL_FAILURE")
  }
  if (phase === "write_in_flight") {
    const leaseExpiresAt = Date.parse(text(execution.lease_expires_at, 50))
    if (Number.isFinite(leaseExpiresAt) && leaseExpiresAt > Date.now()) {
      return publicResult(execution, "EBAY_ACTIVE_IMAGE_REVISION_WRITE_IN_PROGRESS")
    }
  }

  const accessToken = await getEbayTradingReadOnlyAccessToken(fetchImpl)
  const officialBefore = await readOfficialActiveListingImageSnapshotV1({
    accessToken,
    itemId: ebayItemId,
    expectedSku,
    accountKey: input.accountKey,
    fetchImpl,
  })
  const beforeVerification = await verifyApprovedImages(
    officialBefore,
    imageUrls,
    fetchImpl,
  )
  const beforeSnapshot = safeSnapshot({
    snapshot: officialBefore,
    verification: beforeVerification,
    imageSetHash,
    accountFingerprint,
  })

  if (beforeVerification.verified) {
    execution = await completeVerified({
      supabase: input.supabase,
      executionId,
      actorId,
      snapshot: beforeSnapshot,
      reconciled: phase !== "preview_ready",
    })
    return publicResult(execution, "EBAY_ACTIVE_IMAGE_REVISION_VERIFIED")
  }
  if (["write_in_flight", "write_acknowledged", "outcome_unknown"].includes(phase)) {
    execution = await markOutcomeUnknown({
      supabase: input.supabase,
      executionId,
      actorId,
      snapshot: beforeSnapshot,
      errorCode: "EBAY_ACTIVE_IMAGE_REVISION_RECONCILIATION_PENDING",
    })
    return publicResult(execution, "EBAY_ACTIVE_IMAGE_REVISION_OUTCOME_UNKNOWN")
  }
  if (phase !== "preview_ready") {
    throw new Error("EBAY_ACTIVE_IMAGE_REVISION_PHASE_CONFLICT")
  }
  const pictureSource = officialBefore.pictureSource?.toLowerCase()
  const defaultEpsSource = !pictureSource &&
    officialBefore.pictureUrls.length > 0 &&
    officialBefore.pictureUrls.every(ebayPictureUrl)
  if (pictureSource !== "vendor" && pictureSource !== "eps" && !defaultEpsSource) {
    throw new Error("EBAY_ACTIVE_IMAGE_REVISION_PICTURE_SOURCE_UNSUPPORTED")
  }
  const useEps = pictureSource === "eps" || defaultEpsSource
  const writeImageUrls = useEps
    ? await uploadApprovedImagesToEps({ imageUrls, accessToken, fetchImpl })
    : imageUrls
  const writePictureSource = useEps ? "EPS" : "Vendor"

  const claimToken = randomUUID()
  execution = await rpcRow(
    input.supabase,
    "claim_ebay_active_listing_image_revision",
    {
      p_execution_id: executionId,
      p_actor: actorId,
        p_idempotency_key_hash: ledgerIdempotencyKeyHash,
      p_request_hash: text(execution.request_hash, 64),
      p_confirmation: input.confirmation,
      p_claim_token: claimToken,
      p_preflight_snapshot: beforeSnapshot,
    },
    "EBAY_ACTIVE_IMAGE_REVISION_CLAIM_FAILED",
  )
  phase = text(execution.phase, 60)
  if (phase !== "write_in_flight" || text(execution.claim_token, 40) !== claimToken) {
    return publicResult(execution, "EBAY_ACTIVE_IMAGE_REVISION_NOT_CLAIMED")
  }

  let writeStatus: number | null = null
  let writeXml = ""
  try {
    const write = await tradingCall({
      callName: "ReviseFixedPriceItem",
      accessToken,
        body: revisePicturesRequestXml(
          ebayItemId,
          writeImageUrls,
          writePictureSource,
        ),
      fetchImpl,
      timeoutMs: WRITE_TIMEOUT_MS,
    })
    writeStatus = write.response.status
    writeXml = write.xml
    if (!write.response.ok || !responseAccepted(write.xml)) {
      const ebayError = text(tradingXmlTagValue(write.xml, "ErrorCode"), 20)
      const errorCode = /^\d{1,20}$/.test(ebayError)
        ? `EBAY_ACTIVE_IMAGE_REVISION_REJECTED_${ebayError}`
        : "EBAY_ACTIVE_IMAGE_REVISION_WRITE_RESPONSE_UNKNOWN"
      const outcomeUnknown = write.response.status >= 500 || !tradingXmlTagValue(write.xml, "Ack")
      execution = outcomeUnknown
        ? await markOutcomeUnknown({
          supabase: input.supabase,
          executionId,
          actorId,
          claimToken,
          httpStatus: writeStatus,
          errorCode,
        })
        : await rpcRow(input.supabase, "fail_ebay_active_listing_image_revision", {
          p_execution_id: executionId,
          p_actor: actorId,
          p_claim_token: claimToken,
          p_http_status: writeStatus,
          p_error_code: errorCode,
        }, "EBAY_ACTIVE_IMAGE_REVISION_FAILURE_RECORD_FAILED")
      if (!outcomeUnknown) {
        return publicResult(execution, "EBAY_ACTIVE_IMAGE_REVISION_TERMINAL_FAILURE")
      }
    } else {
      execution = await rpcRow(
        input.supabase,
        "ack_ebay_active_listing_image_revision",
        {
          p_execution_id: executionId,
          p_actor: actorId,
          p_claim_token: claimToken,
          p_http_status: writeStatus,
          p_ack: text(tradingXmlTagValue(write.xml, "Ack"), 20),
        },
        "EBAY_ACTIVE_IMAGE_REVISION_ACK_RECORD_FAILED",
      )
    }
  } catch (error) {
    const code = error instanceof Error && error.name === "TimeoutError"
      ? "EBAY_ACTIVE_IMAGE_REVISION_WRITE_TIMEOUT"
      : "EBAY_ACTIVE_IMAGE_REVISION_WRITE_TRANSPORT_UNKNOWN"
    execution = await markOutcomeUnknown({
      supabase: input.supabase,
      executionId,
      actorId,
      claimToken,
      httpStatus: writeStatus,
      errorCode: code,
    })
  } finally {
    writeXml = ""
  }

  try {
    const officialAfter = await readOfficialActiveListingImageSnapshotV1({
      accessToken,
      itemId: ebayItemId,
      expectedSku,
      accountKey: input.accountKey,
      fetchImpl,
    })
    const afterVerification = await verifyApprovedImages(
      officialAfter,
      imageUrls,
      fetchImpl,
    )
    const afterSnapshot = safeSnapshot({
      snapshot: officialAfter,
      verification: afterVerification,
      imageSetHash,
      accountFingerprint,
    })
    if (afterVerification.verified) {
      execution = await completeVerified({
        supabase: input.supabase,
        executionId,
        actorId,
        snapshot: afterSnapshot,
        reconciled: text(execution.phase, 60) === "outcome_unknown",
      })
      return publicResult(execution, "EBAY_ACTIVE_IMAGE_REVISION_VERIFIED")
    }
    execution = await markOutcomeUnknown({
      supabase: input.supabase,
      executionId,
      actorId,
      snapshot: afterSnapshot,
      httpStatus: writeStatus,
      errorCode: "EBAY_ACTIVE_IMAGE_REVISION_POST_READ_MISMATCH",
    })
  } catch {
    execution = await markOutcomeUnknown({
      supabase: input.supabase,
      executionId,
      actorId,
      httpStatus: writeStatus,
      errorCode: "EBAY_ACTIVE_IMAGE_REVISION_POST_READ_FAILED",
    })
  }
  return publicResult(execution, "EBAY_ACTIVE_IMAGE_REVISION_OUTCOME_UNKNOWN")
}
