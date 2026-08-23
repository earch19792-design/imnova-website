import "server-only"

import { createHash } from "node:crypto"
import { access, chmod, mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"

import type { BrowserContext, Cookie, Page, Route } from "playwright"

import {
  SELLER_OS_LUNA_LOGIN_ENTRYPOINT,
  classifySellerOsLunaBrowserRequestV1,
  createSellerOsLunaBrowserCeremonyCoordinatorV1,
  type SellerOsLunaBrowserHandleV1,
} from "./ebay-luna-protected-session-ceremony-v1"
import {
  storeSellerOsLunaProtectedSessionV1,
  verifyStoredSellerOsLunaProtectedSessionV1,
} from "./ebay-luna-protected-session-server-v1"
import { SELLER_OS_LUNA_PROTECTED_SESSION_VERSION } from
  "./ebay-luna-automation-prerequisites-v1"

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

type PolicyFailure = Readonly<{ host: string | null; code: string }>

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
  await Promise.all(names.filter((name) => name.startsWith(PROFILE_PREFIX))
    .map(async (name) => {
      const path = join(PROFILE_ROOT, name)
      if (safeProfilePath(path)) {
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
        const landing = postLoginPathClass(activePage)
        const captured = sessionCookies(await context.cookies(
          "https://www.lunaportex.com/account",
        ))
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
          postLoginHost: landing.host,
          postLoginPathClass: landing.pathClass,
          authenticatedStateProven: true as const,
        })
      },
      async close() {
        if (closing) return
        closing = true
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
    browserWorker: "BACKEND_CONTROLLED" as const,
    browserVisibleToHuman: true as const,
    profile: "EPHEMERAL" as const,
    profileReuse: false as const,
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
          const result = await verifyStoredSellerOsLunaProtectedSessionV1()
          return Object.freeze({
            authenticated: result.authenticated,
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
