export const SELLER_OS_LUNA_PROTECTED_SESSION_COOKIE_JAR_VERSION =
  "SELLER_OS_LUNA_PROTECTED_SESSION_V2" as const

export const SELLER_OS_LUNA_COOKIE_JAR_ALLOWED_HOSTS = Object.freeze([
  "www.lunaportex.com",
  "account.lunaportex.com",
] as const)

const ALLOWED_HOSTS = new Set<string>(SELLER_OS_LUNA_COOKIE_JAR_ALLOWED_HOSTS)
const ALLOWED_COOKIE_DOMAINS = new Set([
  "lunaportex.com",
  ...SELLER_OS_LUNA_COOKIE_JAR_ALLOWED_HOSTS,
])
const SAFE_COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/
const SAFE_COOKIE_VALUE = /^[^;\u0000-\u001f\u007f]{0,4096}$/
const SAFE_COOKIE_PATH = /^\/[\u0020-\u007e]{0,511}$/
const REQUIRED_SESSION_COOKIE = /^(?:__Host-|__Secure-)?(?:_shopify_essential|_secure_customer_sig|customer_auth_provider|customer_auth_session_created_at|customer_account_session|shopify_customer_account_session|_shopify_customer_account_session|account_session|accounts_session|identity_session)$/i
const MAX_COOKIE_COUNT = 24
const MAX_COOKIE_HEADER_BYTES = 8_192

export type SellerOsLunaSessionCookieV2 = Readonly<{
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  hostOnly: boolean
  expiresAt: string | null
}>

export type SellerOsLunaSessionCookieJarV2 =
  readonly SellerOsLunaSessionCookieV2[]

function exactKeys(value: object, keys: readonly string[]) {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",")
}

function normalizedDomain(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/^\./, "")
}

function cookieIdentity(cookie: SellerOsLunaSessionCookieV2) {
  return [cookie.name, cookie.domain, cookie.path].join("\u0000")
}

export function parseSellerOsLunaSessionCookieJarV2(
  value: unknown,
  maximumExpiresAt?: number,
): SellerOsLunaSessionCookieJarV2 | null {
  if (!Array.isArray(value) || value.length < 1 ||
      value.length > MAX_COOKIE_COUNT) return null
  const identities = new Set<string>()
  const cookies: SellerOsLunaSessionCookieV2[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" ||
        Array.isArray(candidate) || !exactKeys(candidate, [
          "domain", "expiresAt", "hostOnly", "name", "path", "secure", "value",
        ])) return null
    const raw = candidate as Record<string, unknown>
    const domain = normalizedDomain(raw.domain)
    const hostOnly = raw.hostOnly === true
    const expiresAt = raw.expiresAt === null ? null
      : typeof raw.expiresAt === "string" ? raw.expiresAt : null
    const expiry = expiresAt === null ? null : Date.parse(expiresAt)
    if (!ALLOWED_COOKIE_DOMAINS.has(domain) ||
        (hostOnly && !ALLOWED_HOSTS.has(domain)) ||
        raw.secure !== true || typeof raw.name !== "string" ||
        !SAFE_COOKIE_NAME.test(raw.name) || !REQUIRED_SESSION_COOKIE.test(raw.name) ||
        typeof raw.value !== "string" ||
        !SAFE_COOKIE_VALUE.test(raw.value) || typeof raw.path !== "string" ||
        !SAFE_COOKIE_PATH.test(raw.path) ||
        (raw.expiresAt !== null && (!Number.isFinite(expiry) ||
          (maximumExpiresAt !== undefined && expiry! < maximumExpiresAt)))) {
      return null
    }
    const cookie = Object.freeze({
      name: raw.name,
      value: raw.value,
      domain,
      path: raw.path,
      secure: raw.secure,
      hostOnly,
      expiresAt: expiry === null ? null : new Date(expiry).toISOString(),
    })
    const identity = cookieIdentity(cookie)
    if (identities.has(identity)) return null
    identities.add(identity)
    cookies.push(cookie)
  }
  return Object.freeze(cookies)
}

function pathMatches(cookiePath: string, requestPath: string) {
  if (cookiePath === requestPath) return true
  if (!requestPath.startsWith(cookiePath)) return false
  return cookiePath.endsWith("/") || requestPath.charAt(cookiePath.length) === "/"
}

function domainMatches(cookie: SellerOsLunaSessionCookieV2, host: string) {
  return cookie.hostOnly
    ? host === cookie.domain
    : host === cookie.domain || host.endsWith(`.${cookie.domain}`)
}

export function sellerOsLunaCookieHeaderForUrlV2(
  cookieJar: SellerOsLunaSessionCookieJarV2,
  rawUrl: string,
  now: number = Date.now(),
) {
  let url: URL
  try { url = new URL(rawUrl) } catch { return null }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname) ||
      url.username || url.password || url.port || url.hash ||
      !Number.isFinite(now)) return null
  const applicable = cookieJar.filter((cookie) =>
    (!cookie.secure || url.protocol === "https:") &&
    domainMatches(cookie, url.hostname) &&
    pathMatches(cookie.path, url.pathname || "/") &&
    (cookie.expiresAt === null || Date.parse(cookie.expiresAt) > now))
    .sort((left, right) => right.path.length - left.path.length ||
      left.name.localeCompare(right.name))
  if (!applicable.length) return null
  const header = applicable.map((cookie) =>
    `${cookie.name}=${cookie.value}`).join("; ")
  return Buffer.byteLength(header, "utf8") <= MAX_COOKIE_HEADER_BYTES
    ? header : null
}
