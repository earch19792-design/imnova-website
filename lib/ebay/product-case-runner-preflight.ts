import { createHash } from "node:crypto"
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

export const PRODUCT_CASE_RUNNER_PREFLIGHT_VERSION =
  "PRODUCT_CASE_RUNNER_PREFLIGHT_V1" as const

export const PRODUCT_CASE_RUNNER_PREFLIGHT_TIMEOUT_MS = 4_500
export const PRODUCT_CASE_RUNNER_MAX_SOURCE_BYTES = 1_000_000

const LUNA_PRODUCT_HOSTS = new Set([
  "lunaportex.com",
  "www.lunaportex.com",
])

const ALLOWED_SOURCE_CONTENT_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "application/json",
  "application/ld+json",
  "text/plain",
])

type DnsAddress = {
  address: string
  family?: number
}

export type ProductCaseRunnerDnsResolver = (
  hostname: string,
) => Promise<readonly DnsAddress[]>

export type ProductCaseRunnerPreflightAccessStatus =
  | "SOURCE_AVAILABLE"
  | "AUTHENTICATED_SOURCE_REQUIRED"

export type ProductCaseRunnerPreflightResult = {
  accessStatus: ProductCaseRunnerPreflightAccessStatus
  sourceUrl: string
  capturedAt: string
  httpStatus: number
  contentType: string | null
  contentHash: `sha256:${string}` | null
  responseBytes: number | null
  publicEvidence: readonly []
  nextAction:
    | "PASTE_VISIBLE_AUTHENTICATED_SOURCE"
    | "PASTE_VISIBLE_SOURCE_FOR_REVIEW"
}

function fail(code: string): never {
  throw new Error(code)
}

function normalizeCapturedAt(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return fail("PRODUCT_CASE_PREFLIGHT_CAPTURED_AT_INVALID")
  }
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) {
    return fail("PRODUCT_CASE_PREFLIGHT_CAPTURED_AT_INVALID")
  }
  return new Date(milliseconds).toISOString()
}

/**
 * Accepts only a public Luna product-page identifier. Query strings, fragments,
 * encoded path escapes and alternate Shopify endpoints are deliberately
 * excluded so preflight cannot be repurposed as a general server-side fetch.
 */
export function canonicalizeLunaProductSourceUrl(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 2_048 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fail("PRODUCT_CASE_SOURCE_URL_INVALID")
  }

  const authority = value.match(/^https:\/\/([^/?#]+)/i)?.[1] ?? ""
  if (!LUNA_PRODUCT_HOSTS.has(authority.toLocaleLowerCase("en-US"))) {
    return fail("PRODUCT_CASE_SOURCE_URL_INVALID")
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return fail("PRODUCT_CASE_SOURCE_URL_INVALID")
  }

  const hostname = parsed.hostname.toLocaleLowerCase("en-US")
  if (
    parsed.protocol !== "https:" ||
    !LUNA_PRODUCT_HOSTS.has(hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    isIP(hostname) !== 0 ||
    parsed.search ||
    parsed.hash ||
    /%[0-9a-f]{2}/i.test(parsed.pathname)
  ) {
    return fail("PRODUCT_CASE_SOURCE_URL_INVALID")
  }

  const productPath = parsed.pathname.match(
    /^\/products\/([a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?)\/?$/,
  )
  if (!productPath) return fail("PRODUCT_CASE_SOURCE_URL_INVALID")

  return `https://${hostname}/products/${productPath[1]}`
}

function isPublicIpv4(address: string) {
  const octets = address.split(".").map(Number)
  if (
    octets.length !== 4 ||
    octets.some((octet) =>
      !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) return false

  const [first, second, third, fourth] = octets
  if (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    (first === 255 && second === 255 && third === 255 && fourth === 255)
  ) return false

  return true
}

function isPublicIpv6(address: string) {
  const normalized = address.toLocaleLowerCase("en-US")
  const firstHextet = Number.parseInt(normalized.split(":")[0] || "0", 16)
  if (
    !Number.isInteger(firstHextet) ||
    firstHextet < 0x2000 ||
    firstHextet > 0x3fff ||
    normalized.startsWith("2001:db8:") ||
    normalized === "2001:db8::"
  ) return false
  return true
}

export function isPublicProductCaseSourceAddress(address: unknown) {
  if (typeof address !== "string") return false
  const family = isIP(address)
  return family === 4
    ? isPublicIpv4(address)
    : family === 6
      ? isPublicIpv6(address)
      : false
}

const defaultDnsResolver: ProductCaseRunnerDnsResolver =
  async (hostname) => lookup(hostname, { all: true, verbatim: true })

async function resolvePublicSourceHost(
  hostname: string,
  resolver: ProductCaseRunnerDnsResolver,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const addresses = await Promise.race([
      resolver(hostname),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("PRODUCT_CASE_SOURCE_DNS_TIMEOUT")),
          PRODUCT_CASE_RUNNER_PREFLIGHT_TIMEOUT_MS,
        )
      }),
    ])
    if (
      !addresses.length ||
      addresses.some((entry) =>
        !isPublicProductCaseSourceAddress(entry.address))
    ) {
      return fail("PRODUCT_CASE_SOURCE_DNS_NOT_PUBLIC")
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    if (
      code === "PRODUCT_CASE_SOURCE_DNS_TIMEOUT" ||
      code === "PRODUCT_CASE_SOURCE_DNS_NOT_PUBLIC"
    ) throw error
    return fail("PRODUCT_CASE_SOURCE_DNS_UNAVAILABLE")
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function boundedResponseBytes(response: Response) {
  const declaredValue = response.headers.get("content-length")?.trim() ?? ""
  if (/^\d+$/.test(declaredValue)) {
    const declaredBytes = Number(declaredValue)
    if (
      !Number.isSafeInteger(declaredBytes) ||
      declaredBytes > PRODUCT_CASE_RUNNER_MAX_SOURCE_BYTES
    ) return fail("PRODUCT_CASE_SOURCE_RESPONSE_TOO_LARGE")
  }

  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      totalBytes += value.byteLength
      if (totalBytes > PRODUCT_CASE_RUNNER_MAX_SOURCE_BYTES) {
        await reader.cancel("PRODUCT_CASE_SOURCE_RESPONSE_TOO_LARGE")
          .catch(() => undefined)
        return fail("PRODUCT_CASE_SOURCE_RESPONSE_TOO_LARGE")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const output = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function responseContentType(response: Response) {
  const contentType = response.headers.get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLocaleLowerCase("en-US") ?? ""
  return contentType || null
}

function loginPath(pathname: string) {
  return /^\/(?:account(?:\/login)?|login|password|challenge|access-restricted)(?:\/|$)/i
    .test(pathname)
}

function redirectTarget(
  response: Response,
  sourceUrl: string,
) {
  const location = response.headers.get("location")
  if (!location) return fail("PRODUCT_CASE_SOURCE_REDIRECT_REJECTED")
  let target: URL
  try {
    target = new URL(location, sourceUrl)
  } catch {
    return fail("PRODUCT_CASE_SOURCE_REDIRECT_REJECTED")
  }
  const internalLunaTarget =
    target.protocol === "https:" &&
    LUNA_PRODUCT_HOSTS.has(
      target.hostname.toLocaleLowerCase("en-US"),
    ) &&
    !target.username &&
    !target.password &&
    !target.port
  if (internalLunaTarget && loginPath(target.pathname)) {
    return "AUTHENTICATED_SOURCE_REQUIRED" as const
  }
  return fail("PRODUCT_CASE_SOURCE_REDIRECT_REJECTED")
}

function bodyRequiresAuthentication(body: Uint8Array) {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(body)
  return (
    /\bAccess Restricted\b/i.test(text) ||
    /shopify-section-main-(?:login|password)/i.test(text) ||
    /<form\b[^>]*(?:action=["'][^"']*\/(?:account\/login|password)|id=["']customer_login)/i
      .test(text) ||
    /name=["']customer\[(?:email|password)\]["']/i.test(text) ||
    /<title\b[^>]*>\s*(?:log\s*in|login|access restricted|password)\b/i
      .test(text)
  )
}

function authenticatedSourceRequired(input: {
  sourceUrl: string
  capturedAt: string
  httpStatus: number
  contentType: string | null
}): ProductCaseRunnerPreflightResult {
  return {
    accessStatus: "AUTHENTICATED_SOURCE_REQUIRED",
    sourceUrl: input.sourceUrl,
    capturedAt: input.capturedAt,
    httpStatus: input.httpStatus,
    contentType: input.contentType,
    contentHash: null,
    responseBytes: null,
    publicEvidence: [],
    nextAction: "PASTE_VISIBLE_AUTHENTICATED_SOURCE",
  }
}

export async function preflightLunaProductSource(input: {
  sourceUrl: unknown
  capturedAt: string
  fetchImpl?: typeof fetch
  dnsResolver?: ProductCaseRunnerDnsResolver
}): Promise<ProductCaseRunnerPreflightResult> {
  const sourceUrl = canonicalizeLunaProductSourceUrl(input.sourceUrl)
  const capturedAt = normalizeCapturedAt(input.capturedAt)
  const parsed = new URL(sourceUrl)
  await resolvePublicSourceHost(
    parsed.hostname,
    input.dnsResolver ?? defaultDnsResolver,
  )

  const fetchImpl = input.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(sourceUrl, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/json,application/ld+json,text/plain",
      },
      signal: AbortSignal.timeout(PRODUCT_CASE_RUNNER_PREFLIGHT_TIMEOUT_MS),
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : ""
    if (name === "AbortError" || name === "TimeoutError") {
      return fail("PRODUCT_CASE_SOURCE_TIMEOUT")
    }
    return fail("PRODUCT_CASE_SOURCE_REQUEST_FAILED")
  }

  const contentType = responseContentType(response)
  if (response.status >= 300 && response.status < 400) {
    const redirect = redirectTarget(response, sourceUrl)
    if (redirect === "AUTHENTICATED_SOURCE_REQUIRED") {
      return authenticatedSourceRequired({
        sourceUrl,
        capturedAt,
        httpStatus: response.status,
        contentType,
      })
    }
  }

  if (response.status === 401 || response.status === 403) {
    return authenticatedSourceRequired({
      sourceUrl,
      capturedAt,
      httpStatus: response.status,
      contentType,
    })
  }

  if (!response.ok) return fail("PRODUCT_CASE_SOURCE_REQUEST_FAILED")
  if (!contentType || !ALLOWED_SOURCE_CONTENT_TYPES.has(contentType)) {
    return fail("PRODUCT_CASE_SOURCE_CONTENT_TYPE_REJECTED")
  }

  const body = await boundedResponseBytes(response)
  if (bodyRequiresAuthentication(body)) {
    return authenticatedSourceRequired({
      sourceUrl,
      capturedAt,
      httpStatus: response.status,
      contentType,
    })
  }
  if (!body.byteLength) return fail("PRODUCT_CASE_SOURCE_REQUEST_FAILED")

  const digest = createHash("sha256").update(body).digest("hex")
  return {
    accessStatus: "SOURCE_AVAILABLE",
    sourceUrl,
    capturedAt,
    httpStatus: response.status,
    contentType,
    contentHash: `sha256:${digest}`,
    responseBytes: body.byteLength,
    publicEvidence: [],
    nextAction: "PASTE_VISIBLE_SOURCE_FOR_REVIEW",
  }
}
