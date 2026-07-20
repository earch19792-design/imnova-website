import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import sharp from "sharp"

import {
  getEbayTradingReadOnlyAccessToken,
  tradingXmlContainer,
  tradingXmlTagValue,
} from "./ebay-manual-listing-trading-readonly"
import {
  ebayProductionAccountFingerprint,
  getEbayProductionIdentityBindingConfiguration,
} from "./ebay-seller-account-scope"

export const ACTIVE_LISTING_IMAGE_REVISION_CONFIRMATION =
  "APLICAR 6 IMAGENES AL LISTING ACTIVO"

const TRADING_ENDPOINT = "https://api.ebay.com/ws/api.dll"
const COMPATIBILITY_LEVEL = "1423"
const SITE_ID_US = "0"
const READ_TIMEOUT_MS = 15_000
const WRITE_TIMEOUT_MS = 25_000
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const SNAPSHOT_VERSION = "EBAY_ACTIVE_LISTING_IMAGE_SNAPSHOT_V1"

type JsonRecord = Record<string, unknown>
type FetchLike = typeof fetch

type OfficialListingSnapshot = {
  authenticatedUserId: string
  sellerUserId: string
  itemId: string
  listingStatus: string
  ebaySku: string
  listingType: string
  pictureSource: string | null
  pictureUrls: string[]
  externalPictureUrls: string[]
  observedAt: string
}

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
      "Item.SKU",
      "Item.ListingType",
      "Item.PictureDetails",
    ].map((selector) => `<OutputSelector>${selector}</OutputSelector>`).join("") +
    "</GetItemRequest>"
}

function revisePicturesRequestXml(itemId: string, imageUrls: string[]) {
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<ReviseFixedPriceItemRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    "<Item>" +
    `<ItemID>${itemId}</ItemID>` +
    "<PictureDetails><PictureSource>Vendor</PictureSource>" +
    imageUrls.map((url) => `<PictureURL>${xmlEscape(url)}</PictureURL>`).join("") +
    "</PictureDetails>" +
    "</Item>" +
    "</ReviseFixedPriceItemRequest>"
}

async function tradingCall(input: {
  callName: "GetUser" | "GetItem" | "ReviseFixedPriceItem"
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

async function readOfficialListingSnapshot(input: {
  accessToken: string
  itemId: string
  expectedSku: string
  accountKey: string
  fetchImpl: FetchLike
}) {
  const identity = getEbayProductionIdentityBindingConfiguration()
  if (
    !identity.bound || !identity.consistent ||
    !identity.expectedAccountFingerprint
  ) throw new Error("EBAY_ACTIVE_IMAGE_REVISION_ACCOUNT_NOT_BOUND")
  const [userResult, itemResult] = await Promise.all([
    tradingCall({
      callName: "GetUser",
      accessToken: input.accessToken,
      body: getUserRequestXml(),
      fetchImpl: input.fetchImpl,
      timeoutMs: READ_TIMEOUT_MS,
    }),
    tradingCall({
      callName: "GetItem",
      accessToken: input.accessToken,
      body: getItemRequestXml(input.itemId),
      fetchImpl: input.fetchImpl,
      timeoutMs: READ_TIMEOUT_MS,
    }),
  ])
  if (
    !userResult.response.ok || !responseAccepted(userResult.xml) ||
    !itemResult.response.ok || !responseAccepted(itemResult.xml)
  ) throw new Error("EBAY_ACTIVE_IMAGE_REVISION_OFFICIAL_READ_FAILED")

  const authenticatedUserId = text(
    tradingXmlTagValue(tradingXmlContainer(userResult.xml, "User"), "UserID"),
    100,
  )
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
  const fingerprint = ebayProductionAccountFingerprint(authenticatedUserId)
  const expectedFingerprint = identity.expectedAccountFingerprint.toLowerCase()
  if (
    !authenticatedUserId || !sellerUserId ||
    (identity.expectedUserId
      ? authenticatedUserId.toLowerCase() !== identity.expectedUserId.toLowerCase()
      : false) ||
    sellerUserId.toLowerCase() !== authenticatedUserId.toLowerCase() ||
    fingerprint !== expectedFingerprint ||
    !input.accountKey.endsWith(`:${expectedFingerprint}`) ||
    itemId !== input.itemId || listingStatus.toLowerCase() !== "active" ||
    ebaySku !== input.expectedSku ||
    !["fixedpriceitem", "storesfixedprice"].includes(listingType.toLowerCase())
  ) throw new Error("EBAY_ACTIVE_IMAGE_REVISION_IDENTITY_MISMATCH")

  return {
    authenticatedUserId,
    sellerUserId,
    itemId,
    listingStatus,
    ebaySku,
    listingType,
    pictureSource,
    pictureUrls: xmlTagValues(pictures, "PictureURL"),
    externalPictureUrls: xmlTagValues(pictures, "ExternalPictureURL"),
    observedAt: new Date().toISOString(),
  } satisfies OfficialListingSnapshot
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
    return url.protocol === "https:" &&
      url.hostname.endsWith(".supabase.co") &&
      url.pathname.includes("/storage/v1/object/public/ebay-listing-images/")
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
  fetchImpl: FetchLike,
) {
  const [expectedBytes, observedBytes] = await Promise.all([
    fetchImage({ url: expectedUrl, expectedKind: "approved", fetchImpl }),
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
    perceptuallySame(approvedUrls[index], observedUrl, fetchImpl)))
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
  if (
    imageUrls.length !== 6 || !expectedSku ||
    !/^[0-9a-f]{64}$/.test(imageSetHash) ||
    !/^[0-9a-f]{64}$/.test(accountFingerprint) || !executionId
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
  const officialBefore = await readOfficialListingSnapshot({
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
  if (officialBefore.pictureSource?.toLowerCase() !== "vendor") {
    throw new Error("EBAY_ACTIVE_IMAGE_REVISION_VENDOR_SOURCE_REQUIRED")
  }

  const claimToken = randomUUID()
  execution = await rpcRow(
    input.supabase,
    "claim_ebay_active_listing_image_revision",
    {
      p_execution_id: executionId,
      p_actor: actorId,
      p_idempotency_key_hash: idempotencyKeyHash,
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
      body: revisePicturesRequestXml(ebayItemId, imageUrls),
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
    const officialAfter = await readOfficialListingSnapshot({
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
