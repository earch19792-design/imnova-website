import "server-only"

import {
  assertEbayFulfillmentTrackingWriterEnabled,
  clearEbayFulfillmentTrackingAccessToken,
  getEbayFulfillmentTrackingAccessToken,
} from "./ebay-fulfillment-tracking-oauth"
import {
  classifyEbayTrackingPostStatus,
  normalizeEbayShippingFulfillments,
  normalizeEbayTrackingOrder,
  type EbayShippingFulfillmentRequest,
  type SafeEbayShippingFulfillment,
  type SafeEbayTrackingOrder,
} from "../marketplace/fulfillment-v1b-domain"

const EBAY_API_ORIGIN = "https://api.ebay.com"
const FULFILLMENT_BASE_PATH = "/sell/fulfillment/v1"
const REQUEST_TIMEOUT_MS = 12_000
const MAX_READ_RETRIES = 3

type FetchLike = typeof fetch

export class EbayFulfillmentTrackingAdapterError extends Error {
  readonly category: "PERMANENT" | "AMBIGUOUS" | "TEMPORARY_BEFORE_POST"
  readonly httpStatus: number | null
  readonly postStarted: boolean

  constructor(
    code: string,
    category: EbayFulfillmentTrackingAdapterError["category"],
    options: { httpStatus?: number | null; postStarted?: boolean } = {},
  ) {
    super(code)
    this.name = "EbayFulfillmentTrackingAdapterError"
    this.category = category
    this.httpStatus = options.httpStatus ?? null
    this.postStarted = options.postStarted ?? false
  }
}

export type EbayFulfillmentTrackingAdapter = {
  getOrder(orderId: string): Promise<SafeEbayTrackingOrder>
  getShippingFulfillments(orderId: string): Promise<SafeEbayShippingFulfillment[]>
  createShippingFulfillment(orderId: string, payload: EbayShippingFulfillmentRequest): Promise<{
    outcome: "ACCEPTED"
    httpStatus: 201
    fulfillmentId: string | null
    locationPath: string | null
    postStarted: true
  }>
  getShippingFulfillment(orderId: string, fulfillmentId: string): Promise<SafeEbayShippingFulfillment>
}

function validateIdentifier(value: string, code: string, maximum = 160) {
  const normalized = value.trim()
  if (!normalized || normalized.length > maximum || !/^[A-Za-z0-9!_-]+$/.test(normalized)) {
    throw new EbayFulfillmentTrackingAdapterError(code, "PERMANENT")
  }
  return normalized
}

function urlFor(orderId: string, fulfillmentId?: string) {
  const order = validateIdentifier(orderId, "EBAY_FULFILLMENT_TRACKING_ORDER_ID_INVALID", 120)
  const suffix = fulfillmentId
    ? `/shipping_fulfillment/${encodeURIComponent(validateIdentifier(
      fulfillmentId,
      "EBAY_FULFILLMENT_TRACKING_FULFILLMENT_ID_INVALID",
    ))}`
    : "/shipping_fulfillment"
  const url = new URL(
    `${FULFILLMENT_BASE_PATH}/order/${encodeURIComponent(order)}${suffix}`,
    EBAY_API_ORIGIN,
  )
  if (url.origin !== EBAY_API_ORIGIN || !url.pathname.startsWith(`${FULFILLMENT_BASE_PATH}/order/`)) {
    throw new EbayFulfillmentTrackingAdapterError(
      "EBAY_FULFILLMENT_TRACKING_ENDPOINT_BLOCKED",
      "PERMANENT",
    )
  }
  return url
}

function orderUrl(orderId: string) {
  const order = validateIdentifier(orderId, "EBAY_FULFILLMENT_TRACKING_ORDER_ID_INVALID", 120)
  return new URL(`${FULFILLMENT_BASE_PATH}/order/${encodeURIComponent(order)}`, EBAY_API_ORIGIN)
}

function fulfillmentIdFromLocation(location: string | null, orderId: string) {
  if (!location) return { fulfillmentId: null, locationPath: null }
  try {
    const url = new URL(location, EBAY_API_ORIGIN)
    const expectedPrefix = `${FULFILLMENT_BASE_PATH}/order/${encodeURIComponent(orderId)}/shipping_fulfillment/`
    if (url.origin !== EBAY_API_ORIGIN || !url.pathname.startsWith(expectedPrefix) || url.search || url.hash) {
      return { fulfillmentId: null, locationPath: null }
    }
    const raw = decodeURIComponent(url.pathname.slice(expectedPrefix.length))
    const fulfillmentId = validateIdentifier(
      raw,
      "EBAY_FULFILLMENT_TRACKING_LOCATION_INVALID",
    )
    return { fulfillmentId, locationPath: url.pathname }
  } catch {
    return { fulfillmentId: null, locationPath: null }
  }
}

async function delay(attempt: number) {
  await new Promise((resolve) => setTimeout(resolve, Math.min(300 * (2 ** attempt), 2_000)))
}

async function safeJson(response: Response) {
  try { return await response.json() as unknown } catch { return {} }
}

export async function createEbayFulfillmentTrackingAdapter(
  fetchImpl: FetchLike = fetch,
): Promise<EbayFulfillmentTrackingAdapter> {
  assertEbayFulfillmentTrackingWriterEnabled()
  const accessToken = await getEbayFulfillmentTrackingAccessToken(fetchImpl)
  const read = async (url: URL) => {
    for (let attempt = 0; attempt < MAX_READ_RETRIES; attempt += 1) {
      let response: Response
      try {
        response = await fetchImpl(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      } catch {
        if (attempt < MAX_READ_RETRIES - 1) {
          await delay(attempt)
          continue
        }
        throw new EbayFulfillmentTrackingAdapterError(
          "EBAY_FULFILLMENT_TRACKING_READ_UNAVAILABLE",
          "TEMPORARY_BEFORE_POST",
        )
      }
      if (response.ok) return safeJson(response)
      if (response.status === 401) clearEbayFulfillmentTrackingAccessToken()
      if ((response.status === 429 || response.status >= 500) && attempt < MAX_READ_RETRIES - 1) {
        await delay(attempt)
        continue
      }
      throw new EbayFulfillmentTrackingAdapterError(
        `EBAY_FULFILLMENT_TRACKING_READ_${response.status}`,
        response.status === 429 || response.status >= 500
          ? "TEMPORARY_BEFORE_POST"
          : "PERMANENT",
        { httpStatus: response.status },
      )
    }
    throw new EbayFulfillmentTrackingAdapterError(
      "EBAY_FULFILLMENT_TRACKING_READ_UNAVAILABLE",
      "TEMPORARY_BEFORE_POST",
    )
  }

  return {
    async getOrder(orderId) {
      return normalizeEbayTrackingOrder(await read(orderUrl(orderId)))
    },
    async getShippingFulfillments(orderId) {
      return normalizeEbayShippingFulfillments(await read(urlFor(orderId)))
    },
    async createShippingFulfillment(orderId, payload) {
      const url = urlFor(orderId)
      let response: Response
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
          },
          body: JSON.stringify(payload),
          cache: "no-store",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      } catch {
        throw new EbayFulfillmentTrackingAdapterError(
          "EBAY_FULFILLMENT_TRACKING_POST_AMBIGUOUS",
          "AMBIGUOUS",
          { postStarted: true },
        )
      }
      if (response.status === 201) {
        const location = fulfillmentIdFromLocation(response.headers.get("location"), orderId)
        return {
          outcome: "ACCEPTED",
          httpStatus: 201,
          fulfillmentId: location.fulfillmentId,
          locationPath: location.locationPath,
          postStarted: true,
        }
      }
      if (response.status === 401) clearEbayFulfillmentTrackingAccessToken()
      if (classifyEbayTrackingPostStatus(response.status) === "AMBIGUOUS_RECONCILIATION_REQUIRED") {
        throw new EbayFulfillmentTrackingAdapterError(
          `EBAY_FULFILLMENT_TRACKING_POST_${response.status}_RECONCILE_REQUIRED`,
          "AMBIGUOUS",
          { httpStatus: response.status, postStarted: true },
        )
      }
      throw new EbayFulfillmentTrackingAdapterError(
        `EBAY_FULFILLMENT_TRACKING_POST_${response.status}`,
        "PERMANENT",
        { httpStatus: response.status, postStarted: true },
      )
    },
    async getShippingFulfillment(orderId, fulfillmentId) {
      const rows = normalizeEbayShippingFulfillments([
        await read(urlFor(orderId, fulfillmentId)),
      ])
      if (rows.length !== 1) {
        throw new EbayFulfillmentTrackingAdapterError(
          "EBAY_FULFILLMENT_TRACKING_RECONCILIATION_NOT_FOUND",
          "TEMPORARY_BEFORE_POST",
        )
      }
      return rows[0]
    },
  }
}
