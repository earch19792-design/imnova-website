import "server-only"

import { createHash } from "node:crypto"
import { access, chmod, mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"

import type { BrowserContext, Cookie, Page, Route } from "playwright"

import { parseDirectedLunaProductUrl } from
  "./ebay-luna-directed-product-import"

import {
  SELLER_OS_LUNA_LOGIN_ENTRYPOINT,
  classifySellerOsLunaBrowserRequestV1,
  createSellerOsLunaBrowserCeremonyCoordinatorV1,
  type SellerOsLunaBrowserHandleV1,
} from "./ebay-luna-protected-session-ceremony-v1"
import {
  resolveServerOwnedLunaSessionEnvelopeV2,
  storeSellerOsLunaProtectedSessionV1,
  type SellerOsLunaProtectedSessionEnvelope,
} from "./ebay-luna-protected-session-server-v1"
import { SELLER_OS_LUNA_PROTECTED_SESSION_VERSION } from
  "./ebay-luna-automation-prerequisites-v1"
import { SELLER_OS_LUNA_PROTECTED_SESSION_COOKIE_JAR_VERSION } from
  "./ebay-luna-session-cookie-jar-v2"
import {
  buildSellerOsLunaBrowserDirectedProductV1,
  classifySellerOsLunaBrowserSessionHealthV1,
  SELLER_OS_LUNA_BROWSER_STOCK_READ_VERSION,
  type SellerOsLunaBrowserProductEvidenceV1,
  type SellerOsLunaBrowserSessionHealthV1,
} from "./ebay-luna-canonical-browser-stock-read-v1"
import {
  buildLunaAuthenticatedBrowserAgentRequestV1,
  LUNA_AUTHENTICATED_BROWSER_PARSER_VERSION,
  LUNA_SUPPLIER_STOCK_WATCHER_VERSION,
  type LunaAuthenticatedCaptureV1,
  type LunaExactApprovedLinkV1,
} from "./ebay-luna-supplier-stock-watcher-v1"
import {
  buildLunaShippingEvidenceDigestV1,
  LUNA_PROTECTED_BROWSER_SHIPPING_SOURCE,
  normalizeLunaShippingDestinationV1,
  normalizeLunaShippingIdentityV1,
  type LunaShippingAttemptV1,
  type LunaShippingDestinationV1,
  type LunaShippingIdentityV1,
} from "./ebay-luna-authoritative-shipping-v1"

const PROFILE_PREFIX = "seller-os-luna-browser-v1-"
const PROFILE_ROOT = resolve(tmpdir())
const PLAYWRIGHT_LOCAL_LIBRARY_DIRECTORY = join(
  homedir(),
  ".local/share/seller-os-playwright-libs/usr/lib/x86_64-linux-gnu",
)
const MAX_SESSION_COOKIE_COUNT = 12
const MAX_COOKIE_HEADER_BYTES = 8_192
const MAX_CAPTURE_LIFETIME_MS = 24 * 60 * 60 * 1_000
const MIN_CAPTURE_LIFETIME_MS = 60 * 1_000
const ABANDONED_PROFILE_AGE_MS = 30 * 60 * 1_000
const SAFE_COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/
const SAFE_COOKIE_VALUE = /^[^;\u0000-\u001f\u007f]{1,4096}$/
const REQUIRED_LUNA_COOKIE_NAME = /^(?:__Host-|__Secure-)?(?:_shopify_essential|_secure_customer_sig|customer_auth_provider|customer_auth_session_created_at|customer_account_session|shopify_customer_account_session|_shopify_customer_account_session|account_session|accounts_session|identity_session)$/i
const LOGIN_PATH = /^(?:\/account\/(?:login|signin)|\/(?:login|signin)|\/authentication\/(?:login|oauth\/authorize)|\/callback)\/?$/i
const AUTHENTICATED_PAGE_MARKER = [
  "a[href*='/account/logout']",
  "form[action*='/account/logout']",
  "a[href*='/logout']",
  "form[action*='/logout']",
  "[data-customer-id]",
  "[data-testid='account-menu']",
].join(",")
const LOGIN_PAGE_MARKER = [
  "form[action*='/account/login']",
  "form[action*='/authentication/login']",
  "input[type='password']",
].join(",")
const MAX_BROWSER_PRODUCT_VARIANTS = 500
const AUTOMATIC_BROWSER_CONTEXT_LIFETIME_MS = 10 * 60 * 1_000

type PolicyFailure = Readonly<{ host: string | null; code: string }>

type ActiveLunaBrowserWorkerV1 = {
  context: BrowserContext
  page: Page
  profilePath: string
  expiresAt: number
  busy: boolean
  expiryTimer: ReturnType<typeof setTimeout> | null
}

type GlobalWithLunaBrowserWorker = typeof globalThis & {
  __sellerOsLunaActiveBrowserWorkerV1?: ActiveLunaBrowserWorkerV1 | null
  __sellerOsLunaPendingBrowserWorkerV1?: ActiveLunaBrowserWorkerV1 | null
}

function browserWorkerState() {
  return globalThis as GlobalWithLunaBrowserWorker
}

function safeProfilePath(path: string) {
  const parent = resolve(path, "..")
  return parent === PROFILE_ROOT && basename(path).startsWith(PROFILE_PREFIX)
}

async function deleteEphemeralProfile(path: string) {
  if (!safeProfilePath(path)) {
    throw new Error("LUNA_CEREMONY_PROFILE_PATH_REJECTED")
  }
  await rm(path, { recursive: true, force: true, maxRetries: 2 })
}

async function cleanupAbandonedProfiles() {
  let names: string[] = []
  try { names = await readdir(PROFILE_ROOT) } catch { return }
  const shared = browserWorkerState()
  const retainedProfiles = new Set([
    shared.__sellerOsLunaActiveBrowserWorkerV1?.profilePath,
    shared.__sellerOsLunaPendingBrowserWorkerV1?.profilePath,
  ].filter((value): value is string => Boolean(value)))
  await Promise.all(names.filter((name) => name.startsWith(PROFILE_PREFIX))
    .map(async (name) => {
      const path = join(PROFILE_ROOT, name)
      if (safeProfilePath(path) && !retainedProfiles.has(path)) {
        try {
          const metadata = await stat(path)
          if (metadata.mtimeMs <= Date.now() - ABANDONED_PROFILE_AGE_MS) {
            await deleteEphemeralProfile(path)
          }
        } catch { /* fail closed */ }
      }
    }))
}

function browserChildEnvironment(profilePath: string) {
  const existing = process.env.LD_LIBRARY_PATH?.trim()
  const inherited = Object.fromEntries([
    "DBUS_SESSION_BUS_ADDRESS",
    "DISPLAY",
    "LANG",
    "LC_ALL",
    "PATH",
    "PULSE_SERVER",
    "WAYLAND_DISPLAY",
    "XAUTHORITY",
    "XDG_RUNTIME_DIR",
  ].flatMap((name) => process.env[name]
    ? [[name, process.env[name] as string]] : []))
  return {
    ...inherited,
    HOME: profilePath,
    TMPDIR: profilePath,
    LD_LIBRARY_PATH: existing
      ? `${PLAYWRIGHT_LOCAL_LIBRARY_DIRECTORY}:${existing}`
      : PLAYWRIGHT_LOCAL_LIBRARY_DIRECTORY,
  }
}

function requestIsTopLevel(route: Route) {
  const request = route.request()
  if (!request.isNavigationRequest()) return false
  try { return request.frame().parentFrame() === null } catch { return true }
}

function blockedNavigationPage(code: string) {
  const safeCode = /^[A-Z0-9_]{3,160}$/.test(code)
    ? code : "LUNA_CEREMONY_NAVIGATION_DENIED"
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Navegación bloqueada</title></head><body style="font-family:system-ui;padding:3rem;max-width:44rem"><h1>Navegación bloqueada</h1><p>Seller OS cerró esta ruta porque no pertenece al flujo normal de autenticación de Luna.</p><p>Vuelve a la pantalla Admin, cancela la ceremonia y comienza de nuevo usando correo y contraseña directamente en Luna.</p><code>${safeCode}</code></body></html>`
}

function postLoginPathClass(page: Page) {
  let parsed: URL
  try { parsed = new URL(page.url()) } catch {
    throw new Error("LUNA_CEREMONY_POST_LOGIN_URL_INVALID")
  }
  const decision = classifySellerOsLunaBrowserRequestV1({
    url: parsed.toString(), method: "GET", topLevelNavigation: true,
  })
  if (!decision.allowed || LOGIN_PATH.test(parsed.pathname)) {
    throw new Error("LUNA_CEREMONY_AUTHENTICATION_NOT_COMPLETE")
  }
  const pathClass = parsed.hostname === "account.lunaportex.com"
    ? "LUNA_CUSTOMER_ACCOUNT"
    : /^\/account(?:\/|$)/i.test(parsed.pathname)
      ? "LUNA_ACCOUNT" : "LUNA_ALLOWED_POST_LOGIN"
  return Object.freeze({ host: parsed.hostname, pathClass })
}

function sessionCookies(cookies: readonly Cookie[]) {
  const selected = cookies.filter((cookie) => {
    const domain = cookie.domain.toLowerCase().replace(/^\./, "")
    return (domain === "lunaportex.com" || domain === "www.lunaportex.com") &&
      cookie.secure && SAFE_COOKIE_NAME.test(cookie.name) &&
      SAFE_COOKIE_VALUE.test(cookie.value) &&
      REQUIRED_LUNA_COOKIE_NAME.test(cookie.name)
  })
  if (selected.length < 1 || selected.length > MAX_SESSION_COOKIE_COUNT) {
    throw new Error("LUNA_CEREMONY_SESSION_COOKIE_SET_INVALID")
  }
  const unique = new Map<string, Cookie>()
  for (const cookie of selected) unique.set(cookie.name, cookie)
  const values = [...unique.values()].sort((left, right) =>
    left.name.localeCompare(right.name))
  const cookieHeader = values.map((cookie) =>
    `${cookie.name}=${cookie.value}`).join("; ")
  if (Buffer.byteLength(cookieHeader, "utf8") > MAX_COOKIE_HEADER_BYTES) {
    throw new Error("LUNA_CEREMONY_SESSION_COOKIE_SET_INVALID")
  }
  return { cookieHeader, cookies: values }
}

function cookieFingerprints(cookies: readonly Cookie[]) {
  const captured = sessionCookies(cookies)
  return new Map(captured.cookies.map((cookie) => [
    cookie.name,
    createHash("sha256").update(cookie.name, "utf8").update("\u0000", "utf8")
      .update(cookie.value, "utf8").digest("hex"),
  ]))
}

function captureExpiry(cookies: readonly Cookie[], now: number) {
  const explicit = cookies.map((cookie) => cookie.expires > 0
    ? Math.floor(cookie.expires * 1_000) : Number.POSITIVE_INFINITY)
  const earliest = Math.min(...explicit)
  const expiresAt = Math.min(
    now + MAX_CAPTURE_LIFETIME_MS,
    Number.isFinite(earliest) ? earliest : Number.POSITIVE_INFINITY,
  )
  if (!Number.isFinite(expiresAt) || expiresAt <= now + MIN_CAPTURE_LIFETIME_MS) {
    throw new Error("LUNA_CEREMONY_SESSION_EXPIRY_INVALID")
  }
  return new Date(expiresAt).toISOString()
}

async function pageSessionHealth(page: Page) : Promise<Readonly<{
  health: SellerOsLunaBrowserSessionHealthV1
  postLoginHost: string | null
  postLoginPathClass: string | null
}>> {
  if (page.isClosed()) return Object.freeze({
    health: "REAUTH_REQUIRED" as const,
    postLoginHost: null,
    postLoginPathClass: null,
  })
  const frames = page.frames().map((frame) => frame.url())
  const cloudflareChallengePresent = frames.some((url) => {
    try { return new URL(url).hostname === "challenges.cloudflare.com" }
    catch { return false }
  })
  const metadata = await page.evaluate((selectors) => Object.freeze({
    title: document.title.slice(0, 160),
    authenticatedMarkerPresent: Boolean(document.querySelector(selectors.auth)),
    loginFormPresent: Boolean(document.querySelector(selectors.login)),
  }), { auth: AUTHENTICATED_PAGE_MARKER, login: LOGIN_PAGE_MARKER })
  const health = classifySellerOsLunaBrowserSessionHealthV1({
    url: page.url(),
    title: metadata.title,
    cloudflareChallengePresent,
    loginFormPresent: metadata.loginFormPresent,
    authenticatedMarkerPresent: metadata.authenticatedMarkerPresent,
  })
  if (health !== "HEALTHY") return Object.freeze({
    health,
    postLoginHost: null,
    postLoginPathClass: null,
  })
  const landing = postLoginPathClass(page)
  return Object.freeze({
    health,
    postLoginHost: landing.host,
    postLoginPathClass: landing.pathClass,
  })
}

async function destroyBrowserWorker(worker: ActiveLunaBrowserWorkerV1) {
  if (worker.expiryTimer) clearTimeout(worker.expiryTimer)
  worker.expiryTimer = null
  try { await worker.context.clearCookies() } catch { /* fail closed */ }
  try { await worker.context.close() } catch { /* fail closed */ }
  await deleteEphemeralProfile(worker.profilePath).catch(() => undefined)
}

async function promotePendingBrowserWorker(worker: ActiveLunaBrowserWorkerV1) {
  const shared = browserWorkerState()
  if (shared.__sellerOsLunaPendingBrowserWorkerV1 !== worker) {
    throw new Error("LUNA_BROWSER_WORKER_PENDING_CONTEXT_MISMATCH")
  }
  const previous = shared.__sellerOsLunaActiveBrowserWorkerV1
  shared.__sellerOsLunaPendingBrowserWorkerV1 = null
  shared.__sellerOsLunaActiveBrowserWorkerV1 = worker
  const remaining = Math.max(1, worker.expiresAt - Date.now())
  worker.expiryTimer = setTimeout(() => {
    if (browserWorkerState().__sellerOsLunaActiveBrowserWorkerV1 === worker) {
      browserWorkerState().__sellerOsLunaActiveBrowserWorkerV1 = null
    }
    void destroyBrowserWorker(worker)
  }, remaining)
  worker.expiryTimer.unref?.()
  if (previous && previous !== worker) await destroyBrowserWorker(previous)
}

function activeBrowserWorker() {
  const shared = browserWorkerState()
  const worker = shared.__sellerOsLunaActiveBrowserWorkerV1
  if (!worker || worker.expiresAt <= Date.now() || worker.page.isClosed()) {
    if (worker) {
      shared.__sellerOsLunaActiveBrowserWorkerV1 = null
      void destroyBrowserWorker(worker)
    }
    throw new Error("LUNA_REAUTH_REQUIRED")
  }
  return worker
}

function quantityEvidence(variant: Record<string, unknown>) {
  for (const key of ["inventory_quantity", "inventoryQuantity",
    "quantity_available", "quantityAvailable", "stock_quantity",
    "stockQuantity"]) {
    if (Object.prototype.hasOwnProperty.call(variant, key)) {
      return Object.freeze({ quantity: variant[key], quantityExplicit: true })
    }
  }
  return Object.freeze({ quantity: null, quantityExplicit: false })
}

function boundedBrowserProductEvidence(value: unknown) :
  SellerOsLunaBrowserProductEvidenceV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const payload = value as Record<string, unknown>
  if (!Array.isArray(payload.variants) ||
      payload.variants.length > MAX_BROWSER_PRODUCT_VARIANTS) return null
  return Object.freeze({
    productId: payload.id,
    handle: payload.handle,
    title: payload.title,
    vendor: payload.vendor,
    productType: payload.type,
    currency: payload.currency,
    variants: Object.freeze(payload.variants.map((entry) => {
      const variant = entry && typeof entry === "object" && !Array.isArray(entry)
        ? entry as Record<string, unknown> : {}
      return Object.freeze({
        id: variant.id,
        title: variant.title,
        sku: variant.sku,
        barcode: variant.barcode,
        price: variant.price,
        compareAtPrice: variant.compare_at_price,
        available: variant.available,
        grams: variant.grams,
        weight: variant.weight,
        weightUnit: variant.weight_unit,
        ...quantityEvidence(variant),
      })
    })),
  })
}

async function createBrowserHandle(input: Readonly<{
  onPolicyViolation: (host: string | null, code: string) => void
}>): Promise<SellerOsLunaBrowserHandleV1> {
  if (process.env.VERCEL || (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)) {
    throw new Error("LUNA_CEREMONY_HUMAN_VISIBLE_BROWSER_UNAVAILABLE")
  }
  await cleanupAbandonedProfiles()
  const profilePath = await mkdtemp(join(PROFILE_ROOT, PROFILE_PREFIX))
  await chmod(profilePath, 0o700)
  let context: BrowserContext | null = null
  let closing = false
  let closed = false
  let policyFailure: PolicyFailure | null = null
  let unauthenticatedCookieFingerprints = new Map<string, string>()

  const failPolicy = (failure: PolicyFailure) => {
    if (!policyFailure) policyFailure = failure
    input.onPolicyViolation(failure.host, failure.code)
  }
  const assertNoPolicyFailure = () => {
    const failure: PolicyFailure | null = policyFailure
    if (failure) throw new Error(failure.code)
  }

  try {
    const { chromium } = await import("playwright")
    context = await chromium.launchPersistentContext(profilePath, {
      headless: false,
      acceptDownloads: false,
      serviceWorkers: "block",
      locale: "es-GT",
      viewport: { width: 1160, height: 820 },
      env: browserChildEnvironment(profilePath),
      args: [
        "--disable-background-networking",
        "--disable-breakpad",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-domain-reliability",
        "--disable-sync",
        "--no-default-browser-check",
        "--no-first-run",
      ],
    })
    context.setDefaultTimeout(8_000)
    context.setDefaultNavigationTimeout(15_000)
    await context.route("**/*", async (route) => {
      const request = route.request()
      const topLevelNavigation = requestIsTopLevel(route)
      const decision = classifySellerOsLunaBrowserRequestV1({
        url: request.url(),
        method: request.method(),
        topLevelNavigation,
      })
      if (decision.allowed) {
        await route.continue()
        return
      }
      const failure = {
        host: decision.host,
        code: decision.failureCode ?? "LUNA_CEREMONY_NAVIGATION_DENIED",
      }
      if (topLevelNavigation) {
        failPolicy(failure)
        await route.fulfill({
          status: 451,
          contentType: "text/html; charset=utf-8",
          headers: {
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
          },
          body: blockedNavigationPage(failure.code),
        })
      } else {
        await route.abort("blockedbyclient")
      }
    })
    context.on("page", (page) => {
      page.on("crash", () => failPolicy({
        host: null, code: "LUNA_CEREMONY_BROWSER_CRASH",
      }))
    })
    context.on("close", () => {
      closed = true
      if (!closing) failPolicy({
        host: null, code: "LUNA_CEREMONY_BROWSER_RESTART",
      })
    })
    const pages = context.pages()
    const page = pages[0] ?? await context.newPage()
    page.on("crash", () => failPolicy({
      host: null, code: "LUNA_CEREMONY_BROWSER_CRASH",
    }))
    await page.goto(SELLER_OS_LUNA_LOGIN_ENTRYPOINT, {
      waitUntil: "domcontentloaded",
    })
    try {
      unauthenticatedCookieFingerprints = cookieFingerprints(
        await context.cookies("https://www.lunaportex.com/account"),
      )
    } catch {
      unauthenticatedCookieFingerprints = new Map()
    }

    return Object.freeze({
      async captureVerifiedSession() {
        assertNoPolicyFailure()
        if (!context || closed) {
          throw new Error("LUNA_CEREMONY_BROWSER_RESTART")
        }
        const openPages = context.pages().filter((candidate) =>
          !candidate.isClosed())
        if (openPages.length !== 1) {
          throw new Error("LUNA_CEREMONY_MULTIPLE_PAGES_DENIED")
        }
        const activePage = openPages[0]
        if (!activePage) throw new Error("LUNA_CEREMONY_BROWSER_RESTART")
        await activePage.waitForLoadState("domcontentloaded", {
          timeout: 5_000,
        }).catch(() => undefined)
        assertNoPolicyFailure()
        const browserHealth = await pageSessionHealth(activePage)
        if (browserHealth.health !== "HEALTHY" ||
            !browserHealth.postLoginHost ||
            !browserHealth.postLoginPathClass) {
          throw new Error(browserHealth.health === "CLOUDFLARE_CHALLENGE"
            ? "LUNA_CAPTCHA_BLOCKED"
            : "LUNA_CEREMONY_AUTHENTICATION_NOT_COMPLETE")
        }
        const captured = sessionCookies(await context.cookies([
          "https://www.lunaportex.com/account",
          "https://account.lunaportex.com/",
        ]))
        const changedAfterHumanLogin = captured.cookies.some((cookie) => {
          const digest = createHash("sha256").update(cookie.name, "utf8")
            .update("\u0000", "utf8").update(cookie.value, "utf8")
            .digest("hex")
          return unauthenticatedCookieFingerprints.get(cookie.name) !== digest
        })
        if (!changedAfterHumanLogin) {
          throw new Error("LUNA_CEREMONY_AUTHENTICATED_SESSION_NOT_PROVEN")
        }
        const capturedAt = Date.now()
        const expiresAt = captureExpiry(captured.cookies, capturedAt)
        const pendingWorker: ActiveLunaBrowserWorkerV1 = {
          context,
          page: activePage,
          profilePath,
          expiresAt: Date.parse(expiresAt),
          busy: false,
          expiryTimer: null,
        }
        const shared = browserWorkerState()
        const stalePending = shared.__sellerOsLunaPendingBrowserWorkerV1
        if (stalePending && stalePending !== pendingWorker) {
          await destroyBrowserWorker(stalePending)
        }
        shared.__sellerOsLunaPendingBrowserWorkerV1 = pendingWorker
        const payload = Buffer.from(JSON.stringify({
          contractVersion: SELLER_OS_LUNA_PROTECTED_SESSION_VERSION,
          cookieHeader: captured.cookieHeader,
          capturedAt: new Date(capturedAt).toISOString(),
          validatedAt: new Date(capturedAt).toISOString(),
          expiresAt,
        }), "utf8")
        return Object.freeze({
          sessionPayload: payload,
          expiresAt,
          postLoginHost: browserHealth.postLoginHost,
          postLoginPathClass: browserHealth.postLoginPathClass,
          authenticatedStateProven: true as const,
        })
      },
      async close(reason) {
        if (closing) return
        closing = true
        const shared = browserWorkerState()
        const pending = shared.__sellerOsLunaPendingBrowserWorkerV1
        if (reason === "COMPLETED" && pending?.context === context) {
          await promotePendingBrowserWorker(pending)
          context = null
          unauthenticatedCookieFingerprints.clear()
          closed = true
          return
        }
        if (pending?.context === context) {
          shared.__sellerOsLunaPendingBrowserWorkerV1 = null
        }
        try { await context?.clearCookies() } catch { /* fail closed */ }
        try { await context?.close() } catch { /* fail closed */ }
        context = null
        unauthenticatedCookieFingerprints.clear()
        closed = true
        await deleteEphemeralProfile(profilePath)
      },
    })
  } catch (cause) {
    closing = true
    try { await context?.clearCookies() } catch { /* fail closed */ }
    try { await context?.close() } catch { /* fail closed */ }
    unauthenticatedCookieFingerprints.clear()
    await deleteEphemeralProfile(profilePath).catch(() => undefined)
    throw cause
  }
}

export async function probeSellerOsLunaCanonicalBrowserSessionV1() {
  let worker: ActiveLunaBrowserWorkerV1
  try { worker = activeBrowserWorker() } catch {
    return Object.freeze({
      health: "REAUTH_REQUIRED" as const,
      authenticated: false as const,
      postLoginHost: null,
      postLoginPathClass: null,
      browserContextReused: true as const,
      stockReadPerformed: false as const,
      sessionMaterialIncluded: false as const,
    })
  }
  if (worker.busy) return Object.freeze({
    health: "UNPROVEN" as const,
    authenticated: false as const,
    postLoginHost: null,
    postLoginPathClass: null,
    browserContextReused: true as const,
    stockReadPerformed: false as const,
    sessionMaterialIncluded: false as const,
  })
  worker.busy = true
  try {
    const result = await pageSessionHealth(worker.page)
    return Object.freeze({
      health: result.health,
      authenticated: result.health === "HEALTHY",
      postLoginHost: result.postLoginHost,
      postLoginPathClass: result.postLoginPathClass,
      browserContextReused: true as const,
      stockReadPerformed: false as const,
      sessionMaterialIncluded: false as const,
    })
  } finally {
    worker.busy = false
  }
}

/**
 * Authoritative authenticated stock path. It uses only the context retained by
 * the existing human ceremony; it never imports or reconstructs browser state.
 */
export async function fetchLunaAuthenticatedBrowserProductV1(
  canonicalSourceUrl: string,
) {
  const parsed = parseDirectedLunaProductUrl(canonicalSourceUrl)
  const worker = activeBrowserWorker()
  if (worker.busy) throw new Error("LUNA_BROWSER_WORKER_BUSY")
  worker.busy = true
  try {
    const preflight = await pageSessionHealth(worker.page)
    if (preflight.health !== "HEALTHY") {
      return buildSellerOsLunaBrowserDirectedProductV1({
        canonicalSourceUrl,
        sessionHealth: preflight.health,
        evidence: null,
      })
    }
    await worker.page.goto(parsed.canonicalUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    })
    const productPageMetadata = await worker.page.evaluate((selectors) => ({
      title: document.title.slice(0, 160),
      loginFormPresent: Boolean(document.querySelector(selectors.login)),
    }), { login: LOGIN_PAGE_MARKER })
    const challengePresent = worker.page.frames().some((frame) => {
      try { return new URL(frame.url()).hostname === "challenges.cloudflare.com" }
      catch { return false }
    })
    const health = classifySellerOsLunaBrowserSessionHealthV1({
      url: worker.page.url(),
      title: productPageMetadata.title,
      cloudflareChallengePresent: challengePresent,
      loginFormPresent: productPageMetadata.loginFormPresent,
      // The same retained context passed an authenticated account preflight.
      authenticatedMarkerPresent: true,
    })
    if (health !== "HEALTHY") {
      return buildSellerOsLunaBrowserDirectedProductV1({
        canonicalSourceUrl,
        sessionHealth: health,
        evidence: null,
      })
    }
    const response = await worker.page.evaluate(async (jsonUrl) => {
      const result = await fetch(jsonUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
      })
      let payload: unknown = null
      if (result.ok) {
        try {
          const raw = await result.json() as Record<string, unknown>
          const rawVariants = Array.isArray(raw.variants)
            ? raw.variants.slice(0, 501) : []
          payload = {
            id: raw.id,
            handle: raw.handle,
            title: raw.title,
            vendor: raw.vendor,
            type: raw.type,
            currency: raw.currency,
            variants: rawVariants.map((entry) => {
              const variant = entry && typeof entry === "object" &&
                !Array.isArray(entry)
                ? entry as Record<string, unknown> : {}
              const quantity: Record<string, unknown> = {}
              for (const key of ["inventory_quantity", "inventoryQuantity",
                "quantity_available", "quantityAvailable", "stock_quantity",
                "stockQuantity"]) {
                if (Object.prototype.hasOwnProperty.call(variant, key)) {
                  quantity[key] = variant[key]
                  break
                }
              }
              return {
                id: variant.id,
                title: variant.title,
                sku: variant.sku,
                barcode: variant.barcode,
                price: variant.price,
                compare_at_price: variant.compare_at_price,
                available: variant.available,
                grams: variant.grams,
                weight: variant.weight,
                weight_unit: variant.weight_unit,
                ...quantity,
              }
            }),
          }
        } catch { payload = null }
      }
      const finalUrl = new URL(result.url)
      return {
        status: result.status,
        finalHost: finalUrl.hostname,
        finalPath: finalUrl.pathname,
        payload,
      }
    }, parsed.jsonUrl)
    if (response.finalHost !== "lunaportex.com" &&
        response.finalHost !== "www.lunaportex.com") {
      throw new Error("LUNA_AUTHENTICATED_BROWSER_REDIRECT_REJECTED")
    }
    if (/\/(?:account\/)?(?:login|signin)\/?$/i.test(response.finalPath) ||
        response.status === 401) throw new Error("LUNA_REAUTH_REQUIRED")
    if (response.status === 403) throw new Error("LUNA_AUTHORIZATION_DENIED")
    if (response.status < 200 || response.status >= 300) {
      throw new Error("LUNA_AUTHENTICATED_SOURCE_UNAVAILABLE")
    }
    const evidence = boundedBrowserProductEvidence(response.payload)
    return buildSellerOsLunaBrowserDirectedProductV1({
      canonicalSourceUrl,
      sessionHealth: "HEALTHY",
      evidence,
    })
  } finally {
    worker.busy = false
  }
}

export async function captureLunaAuthenticatedBrowserWorkerV1(
  link: LunaExactApprovedLinkV1,
) : Promise<LunaAuthenticatedCaptureV1> {
  const request = buildLunaAuthenticatedBrowserAgentRequestV1(link)
  const product = await fetchLunaAuthenticatedBrowserProductV1(
    request.canonicalSourceUrl,
  )
  const variant = product.productId === request.expectedIdentity.supplierProductId
    ? product.variants.find((candidate) =>
        candidate.id === request.expectedIdentity.supplierVariantId &&
        candidate.sku === request.expectedIdentity.supplierSku) ?? null
    : null
  const observedAt = new Date().toISOString()
  const quantity = variant?.sourceInventoryQuantityExplicit === true &&
    Number.isSafeInteger(variant.sourceInventoryQuantity) &&
    Number(variant.sourceInventoryQuantity) >= 0
    ? Number(variant.sourceInventoryQuantity) : null
  const regularPrice = variant?.sourceCompareAtPrice !== null &&
      variant?.sourceCompareAtPrice !== undefined &&
      variant.sourceCompareAtPrice > variant.sourceUnitPrice
    ? variant.sourceCompareAtPrice : variant?.sourceUnitPrice ?? null
  const salePrice = variant?.sourceCompareAtPrice !== null &&
      variant?.sourceCompareAtPrice !== undefined &&
      variant.sourceCompareAtPrice > variant.sourceUnitPrice
    ? variant.sourceUnitPrice : null
  const evidence = {
    requestId: request.requestId,
    productId: product.productId,
    variantId: variant?.id ?? null,
    supplierSku: variant?.sku ?? null,
    availability: variant?.available ?? null,
    quantity,
    quantityExplicit: quantity !== null,
    regularPrice,
    salePrice,
    currency: product.sourceCurrency ?? null,
    observedAt,
    sourceEvidenceFingerprint: product.sourceEvidenceFingerprint ?? null,
  }
  const fingerprint = createHash("sha256").update(JSON.stringify(evidence))
    .digest("hex")
  return Object.freeze({
    contractVersion: LUNA_SUPPLIER_STOCK_WATCHER_VERSION,
    requestId: request.requestId,
    sourceMode: "AUTHENTICATED_WEB_SESSION" as const,
    sessionState: variant ? "SESSION_OK" as const : "VARIANT_UNPROVEN" as const,
    productId: product.productId,
    variantId: variant?.id ?? null,
    supplierSku: variant?.sku ?? null,
    availability: variant?.available ?? null,
    quantity,
    quantityExplicit: quantity !== null,
    explicitLowStock: false,
    regularPrice,
    salePrice,
    currency: product.sourceCurrency ?? null,
    observedAt,
    parserVersion: LUNA_AUTHENTICATED_BROWSER_PARSER_VERSION,
    selectorContractVersion: SELLER_OS_LUNA_BROWSER_STOCK_READ_VERSION,
    sourceEvidenceFingerprint:
      `luna_agent_evidence_${fingerprint.slice(0, 48)}`,
    limitationCode: variant ? null : "EXACT_AUTHENTICATED_VARIANT_UNPROVEN",
    agentAttestation: {
      persistentProfileUsed: true as const,
      isolatedProfileRequired: true as const,
      sessionMaterialExported: false as const,
      rawHtmlExported: false as const,
      screenshotExported: false as const,
      captchaBypassAttempted: false as const,
      mfaBypassAttempted: false as const,
    },
  })
}

function protectedCookieEntries(cookieHeader: string) {
  const entries = cookieHeader.split(/;\s*/).map((entry) => {
    const split = entry.indexOf("=")
    return split > 0
      ? { name: entry.slice(0, split), value: entry.slice(split + 1) }
      : null
  }).filter((entry): entry is { name: string; value: string } =>
    Boolean(entry && SAFE_COOKIE_NAME.test(entry.name) &&
      SAFE_COOKIE_VALUE.test(entry.value)))
  if (entries.length < 1 || entries.length > MAX_SESSION_COOKIE_COUNT) {
    throw new Error("LUNA_PROTECTED_BROWSER_SESSION_INVALID")
  }
  return entries
}

function protectedBrowserCookies(
  envelope: SellerOsLunaProtectedSessionEnvelope,
) {
  if (envelope.contractVersion === SELLER_OS_LUNA_PROTECTED_SESSION_VERSION) {
    return protectedCookieEntries(envelope.cookieHeader).map((cookie) =>
      cookie.name.startsWith("__Host-")
        ? { ...cookie, url: "https://www.lunaportex.com", secure: true }
        : { ...cookie, domain: ".lunaportex.com", path: "/", secure: true })
  }
  if (envelope.contractVersion !==
      SELLER_OS_LUNA_PROTECTED_SESSION_COOKIE_JAR_VERSION) {
    throw new Error("LUNA_PROTECTED_BROWSER_SESSION_INVALID")
  }
  return envelope.cookieJar.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    ...(cookie.hostOnly
      ? { domain: cookie.domain, path: cookie.path }
      : { domain: cookie.domain === "lunaportex.com"
          ? ".lunaportex.com" : `.${cookie.domain}`, path: cookie.path }),
    secure: cookie.secure,
    ...(cookie.expiresAt
      ? { expires: Math.floor(Date.parse(cookie.expiresAt) / 1_000) } : {}),
  }))
}

async function createAutomaticProtectedBrowserWorkerV1() {
  const session = await resolveServerOwnedLunaSessionEnvelopeV2()
  if (!session) throw new Error("LUNA_REAUTH_REQUIRED")
  await cleanupAbandonedProfiles()
  const profilePath = await mkdtemp(join(PROFILE_ROOT, PROFILE_PREFIX))
  await chmod(profilePath, 0o700)
  let context: BrowserContext | null = null
  try {
    const { chromium } = await import("playwright")
    context = await chromium.launchPersistentContext(profilePath, {
      headless: true,
      acceptDownloads: false,
      serviceWorkers: "block",
      locale: "es-GT",
      viewport: { width: 1160, height: 820 },
      env: browserChildEnvironment(profilePath),
      args: [
        "--disable-background-networking",
        "--disable-breakpad",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-domain-reliability",
        "--disable-sync",
        "--no-default-browser-check",
        "--no-first-run",
      ],
    })
    context.setDefaultTimeout(8_000)
    context.setDefaultNavigationTimeout(15_000)
    await context.route("**/*", async (route) => {
      const decision = classifySellerOsLunaBrowserRequestV1({
        url: route.request().url(),
        method: route.request().method(),
        topLevelNavigation: requestIsTopLevel(route),
      })
      if (decision.allowed) await route.continue()
      else await route.abort("blockedbyclient")
    })
    await context.addCookies(protectedBrowserCookies(session))
    const page = context.pages()[0] ?? await context.newPage()
    await page.goto("https://www.lunaportex.com/account", {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    })
    const health = await pageSessionHealth(page)
    if (health.health !== "HEALTHY") {
      throw new Error(health.health === "CLOUDFLARE_CHALLENGE"
        ? "LUNA_CAPTCHA_BLOCKED" : "LUNA_REAUTH_REQUIRED")
    }
    const worker: ActiveLunaBrowserWorkerV1 = {
      context,
      page,
      profilePath,
      expiresAt: Date.now() + AUTOMATIC_BROWSER_CONTEXT_LIFETIME_MS,
      busy: false,
      expiryTimer: null,
    }
    const shared = browserWorkerState()
    const previous = shared.__sellerOsLunaActiveBrowserWorkerV1
    shared.__sellerOsLunaActiveBrowserWorkerV1 = worker
    worker.expiryTimer = setTimeout(() => {
      if (browserWorkerState().__sellerOsLunaActiveBrowserWorkerV1 === worker) {
        browserWorkerState().__sellerOsLunaActiveBrowserWorkerV1 = null
      }
      void destroyBrowserWorker(worker)
    }, AUTOMATIC_BROWSER_CONTEXT_LIFETIME_MS)
    worker.expiryTimer.unref?.()
    context = null
    if (previous && previous !== worker) await destroyBrowserWorker(previous)
    return worker
  } catch (cause) {
    try { await context?.clearCookies() } catch { /* fail closed */ }
    try { await context?.close() } catch { /* fail closed */ }
    await deleteEphemeralProfile(profilePath).catch(() => undefined)
    throw cause
  }
}

async function automaticOrActiveBrowserWorkerV1() {
  try { return activeBrowserWorker() } catch {
    return createAutomaticProtectedBrowserWorkerV1()
  }
}

type BrowserCartQuote = Readonly<{
  status: number
  exactIdentity: boolean
  subtotalUsd: number | null
  rateAmountsUsd: readonly number[]
  currency: string | null
  cartRestored: boolean
}>

async function readBrowserCartShippingQuoteV1(
  page: Page,
  input: Readonly<{
    identity: LunaShippingIdentityV1
    destination: LunaShippingDestinationV1
  }>,
) : Promise<BrowserCartQuote> {
  return page.evaluate(async ({ identity, destination }) => {
    const safeJson = (raw: string) => {
      try {
        return JSON.parse(raw.replace(/(:\s*)(-?\d{16,})(?=\s*[,}])/g,
          '$1"$2"')) as Record<string, any>
      } catch { return null }
    }
    const request = async (path: string, init?: RequestInit) => {
      const response = await fetch(path, {
        ...init,
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
        headers: {
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...(init?.headers ?? {}),
        },
      })
      const raw = await response.text()
      return { status: response.status, body: safeJson(raw) }
    }
    const snapshot = await request("/cart.js")
    const snapshotItems = snapshot.status >= 200 && snapshot.status < 300 &&
      Array.isArray(snapshot.body?.items)
      ? snapshot.body.items.slice(0, 100).flatMap((item: any) => {
        const id = String(item?.variant_id ?? item?.id ?? "")
        const quantity = Number(item?.quantity)
        return /^\d{8,24}$/.test(id) && Number.isInteger(quantity) &&
          quantity > 0 && quantity <= 1_000 ? [{ id, quantity }] : []
      }) : []
    let status = snapshot.status
    let exactIdentity = false
    let subtotalUsd: number | null = null
    let rateAmountsUsd: number[] = []
    let currency: string | null = null
    let cartRestored = false
    try {
      if (status !== 429 && status >= 200 && status < 300) {
        const cleared = await request("/cart/clear.js", {
          method: "POST", body: JSON.stringify({}),
        })
        status = cleared.status
      }
      if (status !== 429 && status >= 200 && status < 300) {
        const added = await request("/cart/add.js", {
          method: "POST",
          body: JSON.stringify({ id: identity.lunaVariantId,
            quantity: identity.quantity }),
        })
        status = added.status
        exactIdentity = String(added.body?.product_id ?? "") ===
            identity.lunaProductId &&
          String(added.body?.variant_id ?? added.body?.id ?? "") ===
            identity.lunaVariantId &&
          String(added.body?.sku ?? "") === identity.supplierSku
        const subtotalMinor = Number(added.body?.final_line_price ??
          added.body?.final_price ?? added.body?.line_price ?? added.body?.price)
        subtotalUsd = Number.isFinite(subtotalMinor) && subtotalMinor >= 0
          ? Math.round(subtotalMinor) / 100 : null
      }
      if (status !== 429 && status >= 200 && status < 300 &&
          exactIdentity && subtotalUsd !== null) {
        const query = new URLSearchParams({
          "shipping_address[country]": destination.country,
          "shipping_address[province]": destination.province,
          "shipping_address[zip]": destination.postalCode,
        })
        const shipping = await request(`/cart/shipping_rates.json?${query}`)
        status = shipping.status
        const rates = Array.isArray(shipping.body?.shipping_rates)
          ? shipping.body.shipping_rates.slice(0, 20) : []
        rateAmountsUsd = rates.flatMap((rate: any) => {
          const amount = Number(rate?.price)
          return Number.isFinite(amount) && amount >= 0
            ? [Math.round((amount + Number.EPSILON) * 100) / 100] : []
        })
        const currencies = [...new Set(rates.map((rate: any) =>
          typeof rate?.currency === "string" ? rate.currency.toUpperCase() : null)
          .filter(Boolean))]
        currency = currencies.length === 1 ? String(currencies[0]) : null
      }
    } finally {
      const cleared = await request("/cart/clear.js", {
        method: "POST", body: JSON.stringify({}),
      }).catch(() => null)
      if (cleared && cleared.status >= 200 && cleared.status < 300) {
        if (!snapshotItems.length) cartRestored = true
        else {
          const restored = await request("/cart/add.js", {
            method: "POST",
            body: JSON.stringify({ items: snapshotItems }),
          }).catch(() => null)
          cartRestored = Boolean(restored && restored.status >= 200 &&
            restored.status < 300)
        }
      }
    }
    return { status, exactIdentity, subtotalUsd, rateAmountsUsd,
      currency, cartRestored }
  }, input)
}

export async function fetchLunaProtectedBrowserShippingQuoteV1(input: Readonly<{
  identity: LunaShippingIdentityV1
  destination: LunaShippingDestinationV1
}>) : Promise<LunaShippingAttemptV1> {
  const identity = normalizeLunaShippingIdentityV1(input.identity)
  const destination = normalizeLunaShippingDestinationV1(input.destination)
  let worker: ActiveLunaBrowserWorkerV1
  try { worker = await automaticOrActiveBrowserWorkerV1() } catch (cause) {
    const code = cause instanceof Error && /^[A-Z0-9_]{3,160}$/.test(cause.message)
      ? cause.message : "LUNA_PROTECTED_BROWSER_UNAVAILABLE"
    return Object.freeze({ status: "BLOCKED" as const, blocker: code,
      retryAfterMs: null, retryNotBefore: null,
      purchasePerformed: false as const, paymentPerformed: false as const })
  }
  if (worker.busy) return Object.freeze({
    status: "BLOCKED" as const,
    blocker: "LUNA_BROWSER_WORKER_BUSY",
    retryAfterMs: null,
    retryNotBefore: null,
    purchasePerformed: false as const,
    paymentPerformed: false as const,
  })
  worker.busy = true
  try {
    const preflight = await pageSessionHealth(worker.page)
    if (preflight.health !== "HEALTHY") return Object.freeze({
      status: "BLOCKED" as const,
      blocker: preflight.health === "CLOUDFLARE_CHALLENGE"
        ? "LUNA_CAPTCHA_BLOCKED" : "LUNA_REAUTH_REQUIRED",
      retryAfterMs: null, retryNotBefore: null,
      purchasePerformed: false as const, paymentPerformed: false as const,
    })
    await worker.page.goto(identity.canonicalProductUrl, {
      waitUntil: "domcontentloaded", timeout: 15_000,
    })
    const result = await readBrowserCartShippingQuoteV1(worker.page, {
      identity, destination,
    })
    if (!result.cartRestored) return Object.freeze({
      status: "BLOCKED" as const,
      blocker: "LUNA_BROWSER_CART_RESTORE_UNPROVEN",
      retryAfterMs: null, retryNotBefore: null,
      purchasePerformed: false as const, paymentPerformed: false as const,
    })
    if (result.status === 429) return Object.freeze({
      status: "BLOCKED" as const,
      blocker: "LUNA_BROWSER_SHIPPING_RATE_LIMITED",
      retryAfterMs: null, retryNotBefore: null,
      purchasePerformed: false as const, paymentPerformed: false as const,
    })
    const uniqueAmounts = [...new Set(result.rateAmountsUsd)]
    if (result.status < 200 || result.status >= 300 ||
        !result.exactIdentity || result.subtotalUsd === null ||
        result.currency !== "USD" || uniqueAmounts.length !== 1) {
      return Object.freeze({
        status: "BLOCKED" as const,
        blocker: uniqueAmounts.length > 1
          ? "LUNA_SHIPPING_SERVICE_SELECTION_UNPROVEN"
          : "LUNA_BROWSER_AUTHORITATIVE_SHIPPING_UNAVAILABLE",
        retryAfterMs: null, retryNotBefore: null,
        purchasePerformed: false as const, paymentPerformed: false as const,
      })
    }
    const observedAt = new Date().toISOString()
    const evidence = {
      lunaProductId: identity.lunaProductId,
      lunaVariantId: identity.lunaVariantId,
      supplierSku: identity.supplierSku,
      subtotalUsd: result.subtotalUsd,
      shippingAmountUsd: uniqueAmounts[0],
      currency: "USD" as const,
      destinationProfileDigest: destination.profileDigest,
      acquisitionMethod: LUNA_PROTECTED_BROWSER_SHIPPING_SOURCE,
      observedAt,
    }
    return Object.freeze({
      status: "AVAILABLE" as const,
      subtotalUsd: result.subtotalUsd,
      shippingAmountUsd: uniqueAmounts[0],
      currency: "USD" as const,
      acquisitionMethod: LUNA_PROTECTED_BROWSER_SHIPPING_SOURCE,
      observedAt,
      evidenceDigest: buildLunaShippingEvidenceDigestV1(evidence),
      exactLunaIdentity: true as const,
      destinationProfileId: destination.profileId,
      destinationProfileDigest: destination.profileDigest,
      noPurchase: true as const,
      noPayment: true as const,
    })
  } catch {
    return Object.freeze({
      status: "BLOCKED" as const,
      blocker: "LUNA_PROTECTED_BROWSER_UNAVAILABLE",
      retryAfterMs: null, retryNotBefore: null,
      purchasePerformed: false as const, paymentPerformed: false as const,
    })
  } finally {
    worker.busy = false
  }
}

export async function auditSellerOsLunaCanonicalBrowserRuntimeV1() {
  let playwrightInstalled = false
  let chromiumInstalled = false
  let localRuntimeLibrariesAvailable = false
  try {
    const { chromium } = await import("playwright")
    playwrightInstalled = true
    await access(chromium.executablePath())
    chromiumInstalled = true
  } catch { /* sanitized readiness only */ }
  try {
    await access(PLAYWRIGHT_LOCAL_LIBRARY_DIRECTORY)
    localRuntimeLibrariesAvailable = true
  } catch { /* sanitized readiness only */ }
  const humanDisplayAvailable = Boolean(
    process.env.DISPLAY || process.env.WAYLAND_DISPLAY,
  )
  const localBackend = !process.env.VERCEL
  let browserContextActive = false
  try {
    activeBrowserWorker()
    browserContextActive = true
  } catch { /* safe context-presence metadata only */ }
  return Object.freeze({
    contractVersion: "SELLER_OS_LUNA_CANONICAL_BROWSER_WORKER_V1" as const,
    status: playwrightInstalled && chromiumInstalled &&
      localRuntimeLibrariesAvailable && humanDisplayAvailable && localBackend
      ? "READY" as const : "UNAVAILABLE" as const,
    playwrightInstalled,
    chromiumInstalled,
    localRuntimeLibrariesAvailable,
    humanDisplayAvailable,
    localBackend,
    browserContextActive,
    browserWorker: "BACKEND_CONTROLLED" as const,
    browserVisibleToHuman: true as const,
    profile: "EPHEMERAL" as const,
    profileReuse: true as const,
    authenticatedStockPath: "CANONICAL_BROWSER_WORKER" as const,
    authenticatedServerHttpAuthoritative: false as const,
    remoteDebuggingPublic: false as const,
    navigationAllowlist: [
      "www.lunaportex.com",
      "account.lunaportex.com",
    ] as const,
    assetOnlyAllowlist: ["cdn.shopify.com"] as const,
    securityChallengeAllowlist: ["challenges.cloudflare.com"] as const,
    securityChallengeClassification: "SECURITY_CHALLENGE_REQUIRED" as const,
    securityChallengeTopLevelNavigationAllowed: false as const,
    serviceWorkers: "BLOCKED" as const,
    callerUrlAccepted: false as const,
    callerCredentialsAccepted: false as const,
    callerCookiesAccepted: false as const,
    screenshotsCaptured: false as const,
    productionPollingEnabled: false as const,
  })
}

type GlobalWithLunaCeremony = typeof globalThis & {
  __sellerOsLunaBrowserCeremonyV1?: ReturnType<
    typeof createSellerOsLunaBrowserCeremonyCoordinatorV1
  >
}

export function getSellerOsLunaBrowserCeremonyCoordinatorV1() {
  const shared = globalThis as GlobalWithLunaCeremony
  if (!shared.__sellerOsLunaBrowserCeremonyV1) {
    shared.__sellerOsLunaBrowserCeremonyV1 =
      createSellerOsLunaBrowserCeremonyCoordinatorV1({
        launchBrowser: createBrowserHandle,
        persistSession: async ({ actorUserId, sessionPayload, now }) =>
          storeSellerOsLunaProtectedSessionV1({
            actorUserId, sessionPayload, now,
          }),
        verifyStoredSession: async () => {
          const pending = browserWorkerState()
            .__sellerOsLunaPendingBrowserWorkerV1
          const result = pending
            ? await pageSessionHealth(pending.page)
            : { health: "REAUTH_REQUIRED" as const,
                postLoginHost: null, postLoginPathClass: null }
          return Object.freeze({
            authenticated: result.health === "HEALTHY",
            postLoginHost: result.postLoginHost,
            postLoginPathClass: result.postLoginPathClass,
          })
        },
      })
  }
  return shared.__sellerOsLunaBrowserCeremonyV1
}

export function digestSellerOsLunaBrowserRuntimeEvidenceV1(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
