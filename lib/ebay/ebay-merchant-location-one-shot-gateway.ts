import "server-only"

const INVENTORY_API_ORIGIN = "https://api.ebay.com"
const REQUEST_TIMEOUT_MS = 12_000

export const EBAY_LUNA_BOCA_RATON_LOCATION = {
  merchantLocationKey: "luna-boca-raton-fl",
  name: "Luna Marketing LLC - Boca Raton",
  merchantLocationStatus: "ENABLED",
  locationTypes: ["WAREHOUSE"],
  location: {
    address: {
      addressLine1: "1161 Holland Dr",
      city: "Boca Raton",
      stateOrProvince: "FL",
      postalCode: "33487",
      country: "US",
    },
  },
} as const

const LOCATION_URL = new URL(
  `/sell/inventory/v1/location/${EBAY_LUNA_BOCA_RATON_LOCATION.merchantLocationKey}`,
  INVENTORY_API_ORIGIN,
)

const CREATE_LOCATION_BODY = {
  name: EBAY_LUNA_BOCA_RATON_LOCATION.name,
  merchantLocationStatus:
    EBAY_LUNA_BOCA_RATON_LOCATION.merchantLocationStatus,
  locationTypes: EBAY_LUNA_BOCA_RATON_LOCATION.locationTypes,
  location: EBAY_LUNA_BOCA_RATON_LOCATION.location,
} as const

type JsonRecord = Record<string, unknown>

type EbayResponse = {
  status: number
  ok: boolean
  body: JsonRecord
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function validAccessToken(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 20
    && value.length <= 8_192
    && !/[\u0000-\u001f\u007f]/.test(value)
}

function safeEbayErrorId(body: JsonRecord) {
  const errors = Array.isArray(body.errors) ? body.errors : []
  const errorId = Number(record(errors[0]).errorId)
  return Number.isSafeInteger(errorId) && errorId > 0
    ? String(errorId).slice(0, 12)
    : "UNKNOWN"
}

function ebayFailure(operation: "GET" | "CREATE", response: EbayResponse) {
  return new Error(
    `EBAY_LUNA_LOCATION_${operation}_${response.status || "UNAVAILABLE"}_${safeEbayErrorId(response.body)}`,
  )
}

function assertFixedLocationUrl(url: URL) {
  if (
    url.origin !== INVENTORY_API_ORIGIN
    || url.pathname !== LOCATION_URL.pathname
    || url.search
    || url.hash
  ) {
    throw new Error("EBAY_LUNA_LOCATION_ENDPOINT_BLOCKED")
  }
}

async function ebayRequest(input: {
  accessToken: string
  method: "GET" | "POST"
  fetchImpl: typeof fetch
}): Promise<EbayResponse> {
  const url = new URL(LOCATION_URL)
  assertFixedLocationUrl(url)
  let response: Response
  try {
    response = await input.fetchImpl(url, {
      method: input.method,
      headers: input.method === "POST"
        ? {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json",
        }
        : { Authorization: `Bearer ${input.accessToken}` },
      body: input.method === "POST"
        ? JSON.stringify(CREATE_LOCATION_BODY)
        : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    return { status: 0, ok: false, body: {} }
  }
  return {
    status: response.status,
    ok: response.ok,
    body: record(await response.json().catch(() => ({}))),
  }
}

function locationMatchesExactly(body: JsonRecord) {
  const expected = EBAY_LUNA_BOCA_RATON_LOCATION
  const location = record(body.location)
  const address = record(location.address)
  const locationTypes = Array.isArray(body.locationTypes)
    ? body.locationTypes.map(text)
    : []
  return text(body.merchantLocationKey) === expected.merchantLocationKey
    && text(body.name) === expected.name
    && text(body.merchantLocationStatus) === expected.merchantLocationStatus
    && locationTypes.length === 1
    && locationTypes[0] === expected.locationTypes[0]
    && text(address.addressLine1) === expected.location.address.addressLine1
    && text(address.city) === expected.location.address.city
    && text(address.stateOrProvince) === expected.location.address.stateOrProvince
    && text(address.postalCode) === expected.location.address.postalCode
    && text(address.country) === expected.location.address.country
}

async function readAndVerify(input: {
  accessToken: string
  fetchImpl: typeof fetch
}) {
  const response = await ebayRequest({ ...input, method: "GET" })
  if (!response.ok) throw ebayFailure("GET", response)
  if (!locationMatchesExactly(response.body)) {
    throw new Error("EBAY_LUNA_LOCATION_EXACT_MATCH_REQUIRED")
  }
}

export async function ensureEbayLunaBocaRatonLocation(input: {
  accessToken: string
  fetchImpl?: typeof fetch
}) {
  if (!validAccessToken(input.accessToken)) {
    throw new Error("EBAY_LUNA_LOCATION_ACCESS_TOKEN_INVALID")
  }
  const fetchImpl = input.fetchImpl ?? fetch
  const existing = await ebayRequest({
    accessToken: input.accessToken,
    method: "GET",
    fetchImpl,
  })
  if (existing.ok) {
    if (!locationMatchesExactly(existing.body)) {
      throw new Error("EBAY_LUNA_LOCATION_EXISTING_MISMATCH")
    }
    return {
      status: "ALREADY_EXISTS_VERIFIED" as const,
      merchantLocationKey: EBAY_LUNA_BOCA_RATON_LOCATION.merchantLocationKey,
      ebayWrites: 0 as const,
    }
  }
  if (existing.status !== 404) throw ebayFailure("GET", existing)

  const created = await ebayRequest({
    accessToken: input.accessToken,
    method: "POST",
    fetchImpl,
  })
  if (created.status === 204) {
    await readAndVerify({ accessToken: input.accessToken, fetchImpl })
    return {
      status: "CREATED" as const,
      merchantLocationKey: EBAY_LUNA_BOCA_RATON_LOCATION.merchantLocationKey,
      ebayWrites: 1 as const,
    }
  }
  if (created.status === 409) {
    await readAndVerify({ accessToken: input.accessToken, fetchImpl })
    return {
      status: "ALREADY_EXISTS_VERIFIED" as const,
      merchantLocationKey: EBAY_LUNA_BOCA_RATON_LOCATION.merchantLocationKey,
      ebayWrites: 1 as const,
    }
  }
  if (created.status === 0 || created.status >= 500) {
    await readAndVerify({ accessToken: input.accessToken, fetchImpl })
    return {
      status: "CREATED" as const,
      merchantLocationKey: EBAY_LUNA_BOCA_RATON_LOCATION.merchantLocationKey,
      ebayWrites: 1 as const,
    }
  }
  throw ebayFailure("CREATE", created)
}
