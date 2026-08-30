import "server-only"

import { createHash } from "node:crypto"

import { fetchDirectedLunaProduct } from "./ebay-luna-directed-product-import"
import {
  buildLunaAuthenticatedHttpRequestV1,
  parseLunaAuthenticatedHttpCaptureV1,
  type LunaExactApprovedLinkV1,
} from "./ebay-luna-supplier-stock-watcher-v1"
import {
  resolveServerOwnedLunaSessionEnvelopeV2,
  sellerOsLunaProtectedSessionCookieHeaderForUrlV2,
  type SellerOsLunaProtectedSessionEnvelope,
} from
  "./ebay-luna-protected-session-server-v1"

const LUNA_HOSTS = new Set(["lunaportex.com", "www.lunaportex.com"])
const MAX_RESPONSE_BYTES = 1_000_000
const DEFAULT_TIMEOUT_MS = 12_000

type ResponseEvidence = {
  status: number
  location: string | null
  contentType: string | null
  body: string
}

function exactInventoryQuantity(value: Record<string, unknown>) {
  for (const key of ["inventory_quantity", "inventoryQuantity", "quantity_available",
    "quantityAvailable", "stock_quantity", "stockQuantity"]) {
    const parsed = Number(value[key])
    if (Number.isInteger(parsed) && parsed >= 0) return parsed
  }
  return null
}

function authenticatedSessionFailure(response: ResponseEvidence | null) {
  if (!response) return "LUNA_AUTHENTICATED_SOURCE_UNAVAILABLE"
  const context = `${response.location ?? ""} ${response.body.slice(0, 500_000)}`
  if (/captcha|verify you are human|i am not a robot|challenge-platform/i.test(context)) {
    return "LUNA_CAPTCHA_BLOCKED"
  }
  if (/two.factor|multi.factor|verification code|security code|authenticator|\/mfa\b/i
      .test(context)) return "LUNA_MFA_REQUIRED"
  if (response.status === 401 || /\/account\/(?:login|signin)|\/login|\/signin/i
      .test(response.location ?? "")) return "LUNA_REAUTH_REQUIRED"
  if (response.status === 403 || /access restricted|authorization denied|not authorized|forbidden/i
      .test(response.body.slice(0, 500_000))) return "LUNA_AUTHORIZATION_DENIED"
  if (response.status === 460) return "LUNA_SOURCE_CHANGED"
  if (response.status < 200 || response.status >= 300) {
    return "LUNA_AUTHENTICATED_SOURCE_UNAVAILABLE"
  }
  const sessionProven = /["']customerId["']?\s*:\s*["']?\d+/i.test(response.body) ||
    /href=["'][^"']*\/account\/logout/i.test(response.body)
  return sessionProven ? null : "LUNA_REAUTH_REQUIRED"
}

export async function fetchLunaAuthenticatedDirectedProductV1(
  canonicalSourceUrl: string,
  options: {
    fetchImpl?: typeof fetch
    timeoutMs?: number
    sleep?: (milliseconds: number) => Promise<void>
  } = {},
) {
  const urls = productJsonUrl(canonicalSourceUrl)
  const protectedSession = await resolveServerOwnedLunaSessionEnvelopeV2()
  if (!protectedSession) throw new Error("LUNA_REAUTH_REQUIRED")
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 20_000))
  const sleep = options.sleep ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const htmlResponse = await authenticatedGet({ url: urls.html, accept: "text/html",
    protectedSession, fetchImpl, timeoutMs, sleep })
  const sessionFailure = authenticatedSessionFailure(htmlResponse)
  if (sessionFailure) throw new Error(sessionFailure)
  const productResponse = await authenticatedGet({ url: urls.product,
    accept: "application/json", protectedSession, fetchImpl, timeoutMs, sleep })
  if (!productResponse) throw new Error("LUNA_AUTHENTICATED_SOURCE_UNAVAILABLE")
  if (productResponse.status === 401) throw new Error("LUNA_REAUTH_REQUIRED")
  if (productResponse.status === 403) throw new Error("LUNA_AUTHORIZATION_DENIED")
  if (productResponse.status === 460) throw new Error("LUNA_SOURCE_CHANGED")
  if (productResponse.status < 200 || productResponse.status >= 300) {
    throw new Error("LUNA_AUTHENTICATED_SOURCE_UNAVAILABLE")
  }
  let raw: Record<string, unknown>
  try { raw = JSON.parse(productResponse.body) as Record<string, unknown> } catch {
    throw new Error("LUNA_SOURCE_CHANGED")
  }
  const product = await fetchDirectedLunaProduct(canonicalSourceUrl,
    async () => new Response(productResponse.body, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))
  const rawVariants = Array.isArray(raw.variants)
    ? raw.variants.filter((value): value is Record<string, unknown> =>
        Boolean(value && typeof value === "object" && !Array.isArray(value)))
    : []
  const rawByIdentity = new Map(rawVariants.map((variant) => [
    `${String(variant.id ?? "")}:${String(variant.sku ?? "")}`,
    variant,
  ]))
  const variants = product.variants.map((variant) => {
    const rawVariant = rawByIdentity.get(`${variant.id}:${variant.sku}`)
    const quantity = rawVariant ? exactInventoryQuantity(rawVariant) : null
    return { ...variant, sourceInventoryQuantity: quantity,
      sourceInventoryQuantityExplicit: quantity !== null }
  })
  const currency = raw.currency && typeof raw.currency === "string" &&
    /^[A-Z]{3}$/.test(raw.currency.toUpperCase())
    ? raw.currency.toUpperCase()
    : htmlResponse?.body.match(
        /(?:property|name)=["'](?:og:price:currency|currency)["'][^>]*content=["']([A-Z]{3})["']/i,
      )?.[1]?.toUpperCase() ?? null
  const fingerprint = createHash("sha256").update(JSON.stringify({
    productId: product.productId,
    variants: variants.map((variant) => ({ id: variant.id, sku: variant.sku,
      available: variant.available,
      quantity: variant.sourceInventoryQuantityExplicit
        ? variant.sourceInventoryQuantity : null,
      price: variant.sourceUnitPrice,
      compareAtPrice: variant.sourceCompareAtPrice })),
    currency,
  })).digest("hex")
  return {
    ...product,
    variants,
    sourceMode: "AUTHENTICATED_SERVER_HTTP" as const,
    sourceSessionHealth: "SESSION_OK" as const,
    sourceParserVersion: "LUNA_AUTHENTICATED_HTTP_PRODUCT_V1",
    sourceEvidenceFingerprint: `luna_authenticated_${fingerprint.slice(0, 40)}`,
    sourceCurrency: currency,
  }
}

function protectedSessionValue() {
  return process.env.LUNAPORTEX_AUTH_COOKIE?.trim() || null
}

export function auditLunaProtectedSessionConfigurationV1() {
  const present = Boolean(protectedSessionValue())
  const clientExposed = Boolean(
    process.env.NEXT_PUBLIC_LUNAPORTEX_AUTH_COOKIE?.trim(),
  )
  return {
    lunaCookiePresent: present,
    lunaCookieServerOnly: present && !clientExposed,
    lunaCookieClientExposed: clientExposed,
  }
}

function productJsonUrl(canonicalSourceUrl: string) {
  const parsed = new URL(canonicalSourceUrl)
  if (parsed.protocol !== "https:" || !LUNA_HOSTS.has(parsed.hostname) ||
      !/^\/products\/[^/]+\/?$/.test(parsed.pathname) || parsed.username ||
      parsed.password || parsed.port) {
    throw new Error("LUNA_AUTHENTICATED_HTTP_URL_INVALID")
  }
  parsed.search = ""
  parsed.hash = ""
  if (parsed.hostname === "lunaportex.com") {
    parsed.hostname = "www.lunaportex.com"
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, "")
  return { html: parsed.toString(), product: `${parsed.toString()}.js` }
}

async function responseTextBounded(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0)
  if (declared > MAX_RESPONSE_BYTES) return null
  if (!response.body) return ""
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let body = ""
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      bytes += value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        return null
      }
      body += decoder.decode(value, { stream: true })
    }
    body += decoder.decode()
    return body
  } finally {
    reader.releaseLock()
  }
}

function retryableStatus(status: number) {
  return [408, 425, 500, 502, 503, 504].includes(status)
}

async function authenticatedGet(input: {
  url: string
  accept: string
  protectedSession: SellerOsLunaProtectedSessionEnvelope
  fetchImpl: typeof fetch
  timeoutMs: number
  sleep: (milliseconds: number) => Promise<void>
}) : Promise<ResponseEvidence | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const protectedValue = sellerOsLunaProtectedSessionCookieHeaderForUrlV2(
        input.protectedSession,
        input.url,
      )
      if (!protectedValue) return { status: 401, location: null,
        contentType: null, body: "" }
      const response = await input.fetchImpl(input.url, {
        method: "GET",
        headers: {
          Accept: input.accept,
          Cookie: protectedValue,
          "User-Agent": "Seller-OS-Luna-Watcher/1.0",
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(input.timeoutMs),
      })
      const body = await responseTextBounded(response)
      if (body === null) return { status: 460, location: null,
        contentType: response.headers.get("content-type"), body: "" }
      const evidence = {
        status: response.status,
        location: response.headers.get("location"),
        contentType: response.headers.get("content-type"),
        body,
      }
      if (!retryableStatus(response.status) || attempt === 2) return evidence
    } catch {
      if (attempt === 2) return null
    }
    await input.sleep(500 * (2 ** attempt))
  }
  return null
}

export async function captureLunaAuthenticatedHttpV1(
  link: LunaExactApprovedLinkV1,
  options: {
    fetchImpl?: typeof fetch
    timeoutMs?: number
    sleep?: (milliseconds: number) => Promise<void>
    now?: string
  } = {},
) {
  const request = buildLunaAuthenticatedHttpRequestV1(link)
  const observedAt = options.now ?? new Date().toISOString()
  const protectedSession = await resolveServerOwnedLunaSessionEnvelopeV2()
  if (!protectedSession) return parseLunaAuthenticatedHttpCaptureV1({
    request,
    protectedSessionValuePresent: false,
    htmlResponse: null,
    productResponse: null,
    observedAt,
  })
  const urls = productJsonUrl(request.canonicalSourceUrl)
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 20_000))
  const sleep = options.sleep ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const htmlResponse = await authenticatedGet({ url: urls.html, accept: "text/html",
    protectedSession, fetchImpl, timeoutMs, sleep })
  const productResponse = htmlResponse && htmlResponse.status >= 200 &&
    htmlResponse.status < 300
    ? await authenticatedGet({ url: urls.product, accept: "application/json",
        protectedSession, fetchImpl, timeoutMs, sleep })
    : null
  return parseLunaAuthenticatedHttpCaptureV1({
    request,
    protectedSessionValuePresent: true,
    htmlResponse,
    productResponse,
    observedAt,
  })
}
