import "server-only"

import { createHash } from "node:crypto"

import { EBAY_LUNA_BOCA_RATON_LOCATION } from
  "./ebay-merchant-location-one-shot-gateway"
import {
  acquireAuthoritativeLunaShippingV1,
  buildLunaShippingEvidenceDigestV1,
  classifyLunaRetryAfterV1,
  LUNA_HTTP_SHIPPING_SOURCE,
  normalizeLunaShippingDestinationV1,
  normalizeLunaShippingIdentityV1,
  type LunaRateLimitEvidenceV1,
  type LunaShippingAttemptV1,
  type LunaShippingIdentityV1,
} from "./ebay-luna-authoritative-shipping-v1"
import { fetchLunaProtectedBrowserShippingQuoteV1 } from
  "./ebay-luna-canonical-browser-worker-server-v1"
import {
  resolveServerOwnedLunaSessionEnvelopeV2,
  sellerOsLunaProtectedSessionCookieHeaderForUrlV2,
  type SellerOsLunaProtectedSessionEnvelope,
} from
  "./ebay-luna-protected-session-server-v1"
import { SELLER_OS_LUNA_PROTECTED_SESSION_COOKIE_JAR_VERSION } from
  "./ebay-luna-session-cookie-jar-v2"

const LUNA_ORIGIN = "https://www.lunaportex.com"
const REQUEST_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 500_000
const MAX_CART_ITEMS = 100
const SAFE_COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/
const SAFE_COOKIE_VALUE = /^[^;\u0000-\u001f\u007f]{0,4096}$/

const address = EBAY_LUNA_BOCA_RATON_LOCATION.location.address
const destinationFingerprintInput = Object.freeze({
  profileId: EBAY_LUNA_BOCA_RATON_LOCATION.merchantLocationKey,
  country: address.country,
  province: address.stateOrProvince,
  postalCode: address.postalCode,
})

export const SELLER_OS_CANONICAL_LUNA_SHIPPING_DESTINATION_V1 =
  normalizeLunaShippingDestinationV1(Object.freeze({
    profileId: "LUNA_BOCA_RATON_US",
    profileDigest: `sha256:${createHash("sha256")
      .update(JSON.stringify(destinationFingerprintInput)).digest("hex")}`,
    country: "US" as const,
    province: address.stateOrProvince,
    postalCode: address.postalCode,
  }))

type SafeCartItem = Readonly<{ id: string; quantity: number }>

function parseLosslessJson(raw: string) {
  try {
    return JSON.parse(raw.replace(/(:\s*)(-?\d{16,})(?=\s*[,}])/g,
      '$1"$2"')) as Record<string, any>
  } catch { return null }
}

function legacyCookieJar(cookieHeader: string) {
  const values = new Map<string, string>()
  for (const entry of cookieHeader.split(/;\s*/)) {
    const split = entry.indexOf("=")
    const name = split > 0 ? entry.slice(0, split) : ""
    const value = split > 0 ? entry.slice(split + 1) : ""
    if (SAFE_COOKIE_NAME.test(name) && SAFE_COOKIE_VALUE.test(value)) {
      values.set(name, value)
    }
  }
  if (!values.size) throw new Error("LUNA_PROTECTED_SESSION_INVALID")
  return {
    header(_url: URL) {
      return [...values].map(([name, value]) => `${name}=${value}`).join("; ")
    },
    update(headers: Headers, _url: URL) {
      const entries = typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []
      for (const line of entries) {
        const pair = line.split(";", 1)[0]
        const split = pair.indexOf("=")
        const name = split > 0 ? pair.slice(0, split) : ""
        const value = split > 0 ? pair.slice(split + 1) : ""
        if (SAFE_COOKIE_NAME.test(name) && SAFE_COOKIE_VALUE.test(value)) {
          values.set(name, value)
        }
      }
    },
  }
}

function defaultCookiePath(pathname: string) {
  if (!pathname.startsWith("/") || pathname === "/") return "/"
  const index = pathname.lastIndexOf("/")
  return index <= 0 ? "/" : pathname.slice(0, index)
}

function multiHostCookieJar(session: SellerOsLunaProtectedSessionEnvelope) {
  if (session.contractVersion !==
      SELLER_OS_LUNA_PROTECTED_SESSION_COOKIE_JAR_VERSION) {
    return legacyCookieJar(session.cookieHeader)
  }
  const values = new Map(session.cookieJar.map((cookie) => [
    [cookie.name, cookie.domain, cookie.path].join("\u0000"), { ...cookie },
  ]))
  return {
    header(url: URL) {
      return sellerOsLunaProtectedSessionCookieHeaderForUrlV2({
        ...session,
        cookieJar: [...values.values()],
      }, url.toString())
    },
    update(headers: Headers, url: URL) {
      const entries = typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []
      for (const line of entries.slice(0, 24)) {
        const parts = line.split(";").map((part) => part.trim())
        const split = parts[0]?.indexOf("=") ?? -1
        const name = split > 0 ? parts[0].slice(0, split) : ""
        const value = split > 0 ? parts[0].slice(split + 1) : ""
        if (!SAFE_COOKIE_NAME.test(name) || !SAFE_COOKIE_VALUE.test(value)) continue
        let domain = url.hostname
        let hostOnly = true
        let path = defaultCookiePath(url.pathname)
        let secure = false
        let expiresAt: string | null = null
        for (const attribute of parts.slice(1)) {
          const separator = attribute.indexOf("=")
          const key = (separator < 0 ? attribute : attribute.slice(0, separator))
            .trim().toLowerCase()
          const attributeValue = separator < 0
            ? "" : attribute.slice(separator + 1).trim()
          if (key === "domain") {
            const candidate = attributeValue.toLowerCase().replace(/^\./, "")
            if (candidate === "lunaportex.com" || candidate === url.hostname) {
              domain = candidate
              hostOnly = false
            }
          } else if (key === "path" && /^\/[\u0020-\u007e]{0,511}$/.test(
            attributeValue,
          )) path = attributeValue
          else if (key === "secure") secure = true
          else if (key === "max-age" && /^-?\d{1,10}$/.test(attributeValue)) {
            const seconds = Number(attributeValue)
            expiresAt = new Date(Date.now() + Math.max(0, seconds) * 1_000)
              .toISOString()
          } else if (key === "expires") {
            const expiry = Date.parse(attributeValue)
            if (Number.isFinite(expiry)) expiresAt = new Date(expiry).toISOString()
          }
        }
        const identity = [name, domain, path].join("\u0000")
        if (expiresAt && Date.parse(expiresAt) <= Date.now()) values.delete(identity)
        else values.set(identity, { name, value, domain, path, secure, hostOnly,
          expiresAt })
      }
    },
  }
}

type LunaHttpCookieJar = ReturnType<typeof legacyCookieJar> |
  ReturnType<typeof multiHostCookieJar>

function finalUrlClasses(rawUrl: string) {
  if (!rawUrl) return Object.freeze({
    finalUrlHostClass: "UNAVAILABLE" as const,
    finalPathClass: "UNAVAILABLE" as const,
  })
  try {
    const url = new URL(rawUrl)
    const finalUrlHostClass = url.hostname === "www.lunaportex.com"
      ? "LUNA_WWW" as const
      : url.hostname === "account.lunaportex.com"
        ? "LUNA_ACCOUNT" as const
        : url.hostname === "lunaportex.com"
          ? "LUNA_APEX" as const : "OTHER" as const
    const finalPathClass = url.pathname === "/cart.js"
      ? "LUNA_CART_SNAPSHOT" as const
      : url.pathname === "/cart/clear.js"
        ? "LUNA_CART_CLEAR" as const
        : url.pathname === "/cart/add.js"
          ? "LUNA_CART_ADD" as const
          : url.pathname === "/cart/shipping_rates.json"
            ? "LUNA_SHIPPING_RATES" as const
            : url.pathname === "/account" || url.pathname.startsWith("/account/")
              ? "LUNA_ACCOUNT" as const
              : /(?:^|\/)(?:login|sign-in|signin)(?:\/|$)/i.test(url.pathname)
                ? "LUNA_AUTH" as const
                : finalUrlHostClass === "LUNA_ACCOUNT"
                  ? "LUNA_AUTHENTICATED_CUSTOMER_AREA" as const
                  : "OTHER" as const
    return Object.freeze({ finalUrlHostClass, finalPathClass })
  } catch {
    return Object.freeze({
      finalUrlHostClass: "UNAVAILABLE" as const,
      finalPathClass: "UNAVAILABLE" as const,
    })
  }
}

async function boundedBody(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0)
  if (declared > MAX_RESPONSE_BYTES) return null
  const body = await response.text()
  return Buffer.byteLength(body, "utf8") <= MAX_RESPONSE_BYTES ? body : null
}

async function cartRequest(input: Readonly<{
  path: string
  method?: "GET" | "POST"
  body?: unknown
  fetchImpl: typeof fetch
  jar: LunaHttpCookieJar
}>) {
  const url = new URL(input.path, LUNA_ORIGIN)
  if (url.origin !== LUNA_ORIGIN ||
      !new Set(["/cart.js", "/cart/clear.js", "/cart/add.js",
        "/cart/shipping_rates.json"]).has(url.pathname)) {
    throw new Error("LUNA_SHIPPING_ENDPOINT_DENIED")
  }
  const cookieHeader = input.jar.header(url)
  const response = await input.fetchImpl(url, {
    method: input.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      "User-Agent": "Seller-OS-Luna-Shipping/1.0",
      ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  input.jar.update(response.headers, url)
  const raw = await boundedBody(response)
  const retryAfter = response.status === 429
    ? classifyLunaRetryAfterV1(response.headers.get("retry-after")) : null
  const finalUrl = response.status === 429
    ? finalUrlClasses(response.url) : null
  return Object.freeze({
    status: raw === null ? 460 : response.status,
    retryAfterMs: retryAfter?.retryAfterMs ?? null,
    rateLimitEvidence: response.status === 429 && retryAfter && finalUrl
      ? Object.freeze({
        classificationOrigin: "CURRENT_HTTP_429" as const,
        upstreamHttpStatusClass: "HTTP_429" as const,
        retryAfterPresent: retryAfter.retryAfterPresent,
        retryAfterClass: retryAfter.retryAfterClass,
        retryAfterSafeValue: retryAfter.retryAfterSafeValue,
        finalUrlHostClass: finalUrl.finalUrlHostClass,
        finalPathClass: finalUrl.finalPathClass,
        cooldownRemainingClass: null,
      }) satisfies LunaRateLimitEvidenceV1 : null,
    body: raw === null ? null : parseLosslessJson(raw),
  })
}

function snapshotItems(body: Record<string, any> | null) {
  if (!Array.isArray(body?.items) || body.items.length > MAX_CART_ITEMS) {
    return null
  }
  const items: SafeCartItem[] = []
  for (const item of body.items) {
    const id = String(item?.variant_id ?? item?.id ?? "")
    const quantity = Number(item?.quantity)
    if (!/^\d{8,24}$/.test(id) || !Number.isInteger(quantity) ||
        quantity < 1 || quantity > 1_000) return null
    items.push(Object.freeze({ id, quantity }))
  }
  return Object.freeze(items)
}

function blocked(blocker: string): LunaShippingAttemptV1 {
  return Object.freeze({ status: "BLOCKED" as const, blocker,
    retryAfterMs: null, retryNotBefore: null,
    purchasePerformed: false as const, paymentPerformed: false as const })
}

function limited(input: Readonly<{
  retryAfterMs: number | null
  rateLimitEvidence: LunaRateLimitEvidenceV1 | null
}>): LunaShippingAttemptV1 {
  const delay = input.retryAfterMs ?? 60_000
  return Object.freeze({
    status: "LUNA_RATE_LIMITED" as const,
    blocker: "LUNA_RATE_LIMITED",
    retryAfterMs: delay,
    retryNotBefore: new Date(Date.now() + delay).toISOString(),
    rateLimitEvidence: input.rateLimitEvidence,
    purchasePerformed: false as const,
    paymentPerformed: false as const,
  })
}

export async function attemptLunaAuthenticatedHttpShippingQuoteV1(
  rawIdentity: LunaShippingIdentityV1,
  options: Readonly<{
    fetchImpl?: typeof fetch
    resolveProtectedSession?: () => Promise<
      string | SellerOsLunaProtectedSessionEnvelope | null
    >
  }> = {},
) : Promise<LunaShippingAttemptV1> {
  const identity = normalizeLunaShippingIdentityV1(rawIdentity)
  const destination = SELLER_OS_CANONICAL_LUNA_SHIPPING_DESTINATION_V1
  const protectedSession = options.resolveProtectedSession
    ? await options.resolveProtectedSession()
    : await resolveServerOwnedLunaSessionEnvelopeV2()
  if (!protectedSession) return blocked("LUNA_REAUTH_REQUIRED")
  const fetchImpl = options.fetchImpl ?? fetch
  const jar = typeof protectedSession === "string"
    ? legacyCookieJar(protectedSession)
    : multiHostCookieJar(protectedSession)
  let touched = false
  let originalItems: readonly SafeCartItem[] = []
  let snapshotCaptured = false
  let result: LunaShippingAttemptV1 = blocked(
    "LUNA_HTTP_AUTHORITATIVE_SHIPPING_UNAVAILABLE")
  let restoreProven = true
  const execute = async (): Promise<LunaShippingAttemptV1> => {
    const snapshot = await cartRequest({ path: "/cart.js", fetchImpl, jar })
    if (snapshot.status === 429) return limited(snapshot)
    if (snapshot.status < 200 || snapshot.status >= 300) return result
    const parsedSnapshot = snapshotItems(snapshot.body)
    if (parsedSnapshot === null) return blocked("LUNA_HTTP_CART_SNAPSHOT_UNPROVEN")
    originalItems = parsedSnapshot
    snapshotCaptured = true
    const clear = await cartRequest({ path: "/cart/clear.js", method: "POST",
      body: {}, fetchImpl, jar })
    touched = clear.status >= 200 && clear.status < 300
    if (clear.status === 429) return limited(clear)
    if (!touched) return result
    const add = await cartRequest({ path: "/cart/add.js", method: "POST",
      body: { id: identity.lunaVariantId, quantity: identity.quantity },
      fetchImpl, jar })
    if (add.status === 429) return limited(add)
    const exactIdentity = String(add.body?.product_id ?? "") ===
        identity.lunaProductId &&
      String(add.body?.variant_id ?? add.body?.id ?? "") ===
        identity.lunaVariantId &&
      String(add.body?.sku ?? "") === identity.supplierSku
    const subtotalMinor = Number(add.body?.final_line_price ??
      add.body?.final_price ?? add.body?.line_price ?? add.body?.price)
    const subtotalUsd = Number.isFinite(subtotalMinor) && subtotalMinor >= 0
      ? Math.round(subtotalMinor) / 100 : null
    if (add.status < 200 || add.status >= 300 || !exactIdentity ||
        subtotalUsd === null) return blocked("LUNA_HTTP_EXACT_IDENTITY_UNPROVEN")
    const query = new URLSearchParams({
      "shipping_address[country]": destination.country,
      "shipping_address[province]": destination.province,
      "shipping_address[zip]": destination.postalCode,
    })
    const shipping = await cartRequest({
      path: `/cart/shipping_rates.json?${query}`, fetchImpl, jar,
    })
    if (shipping.status === 429) return limited(shipping)
    const rates = Array.isArray(shipping.body?.shipping_rates)
      ? shipping.body.shipping_rates.slice(0, 20) : []
    const amounts = [...new Set(rates.flatMap((rate: any) => {
      const value = Number(rate?.price)
      return Number.isFinite(value) && value >= 0
        ? [Math.round((value + Number.EPSILON) * 100) / 100] : []
    }))]
    const currencies = [...new Set(rates.map((rate: any) =>
      typeof rate?.currency === "string" ? rate.currency.toUpperCase() : null)
      .filter(Boolean))]
    if (shipping.status < 200 || shipping.status >= 300 ||
        amounts.length !== 1 || currencies.length !== 1 ||
        currencies[0] !== "USD") {
      return blocked(amounts.length > 1
        ? "LUNA_SHIPPING_SERVICE_SELECTION_UNPROVEN"
        : "LUNA_HTTP_AUTHORITATIVE_SHIPPING_UNAVAILABLE")
    }
    const observedAt = new Date().toISOString()
    const evidence = {
      lunaProductId: identity.lunaProductId,
      lunaVariantId: identity.lunaVariantId,
      supplierSku: identity.supplierSku,
      subtotalUsd,
      shippingAmountUsd: amounts[0],
      currency: "USD" as const,
      destinationProfileDigest: destination.profileDigest,
      acquisitionMethod: LUNA_HTTP_SHIPPING_SOURCE,
      observedAt,
    }
    result = Object.freeze({
      status: "AVAILABLE" as const,
      subtotalUsd,
      shippingAmountUsd: amounts[0],
      currency: "USD" as const,
      acquisitionMethod: LUNA_HTTP_SHIPPING_SOURCE,
      observedAt,
      evidenceDigest: buildLunaShippingEvidenceDigestV1(evidence),
      exactLunaIdentity: true as const,
      destinationProfileId: destination.profileId,
      destinationProfileDigest: destination.profileDigest,
      noPurchase: true as const,
      noPayment: true as const,
    })
    return result
  }
  try {
    result = await execute()
  } catch {
    result = blocked("LUNA_HTTP_AUTHORITATIVE_SHIPPING_UNAVAILABLE")
  } finally {
    if (touched && snapshotCaptured) {
      const clear = await cartRequest({ path: "/cart/clear.js", method: "POST",
        body: {}, fetchImpl, jar }).catch(() => null)
      if (!clear || clear.status < 200 || clear.status >= 300) restoreProven = false
      else if (originalItems.length) {
        const restore = await cartRequest({ path: "/cart/add.js", method: "POST",
          body: { items: originalItems }, fetchImpl, jar }).catch(() => null)
        restoreProven = Boolean(restore && restore.status >= 200 &&
          restore.status < 300)
      }
    }
  }
  // Cart integrity is deliberately not persisted or surfaced with contents.
  return restoreProven ? result : blocked("LUNA_HTTP_CART_RESTORE_UNPROVEN")
}

export async function acquireCanonicalLunaShippingV1(
  identity: LunaShippingIdentityV1,
  options: Readonly<{ fetchImpl?: typeof fetch; now?: number }> = {},
) {
  const exact = normalizeLunaShippingIdentityV1(identity)
  return acquireAuthoritativeLunaShippingV1({
    identity: exact,
    destination: SELLER_OS_CANONICAL_LUNA_SHIPPING_DESTINATION_V1,
    httpAcquire: () => attemptLunaAuthenticatedHttpShippingQuoteV1(exact, {
      fetchImpl: options.fetchImpl,
    }),
    browserAcquire: () => fetchLunaProtectedBrowserShippingQuoteV1({
      identity: exact,
      destination: SELLER_OS_CANONICAL_LUNA_SHIPPING_DESTINATION_V1,
    }),
    now: options.now,
  })
}
