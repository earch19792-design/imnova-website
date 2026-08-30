#!/usr/bin/env node

import {
  constants,
  createCipheriv,
  createHash,
  publicEncrypt,
  randomBytes,
} from "node:crypto"
import { readFile, unlink } from "node:fs/promises"
import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"

import { chromium } from "playwright"

const VERSION = "SELLER_OS_LUNA_OWNER_REAUTH_HANDOFF_V1"
const BUILD_ID = "LUNA_OWNER_REAUTH_HELPER_V1"
const ORIGIN = "https://imnova-seller-os-preprod.vercel.app"
const UPLOAD_PATH = "/api/admin/ebay/luna-protected-session"
const ENVIRONMENT =
  "SELLER_OS_DEDICATED_PREPROD:vsfthqydfrdzulldbfbe:prj_XvOpSg1jhmLLG1yOCFhAbiLEn222"
const LOGIN_URL = "https://www.lunaportex.com/account/login"
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const NONCE = /^[A-Za-z0-9_-]{43}$/
const SAFE_COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/
const SAFE_COOKIE_VALUE = /^[^;\u0000-\u001f\u007f]{1,4096}$/
const REQUIRED_COOKIE = /^(?:__Host-|__Secure-)?(?:_shopify_essential|_secure_customer_sig|customer_auth_provider|customer_auth_session_created_at|customer_account_session|shopify_customer_account_session|_shopify_customer_account_session|account_session|accounts_session|identity_session)$/i
const AUTH_MARKER = [
  "a[href*='/account/logout']",
  "form[action*='/account/logout']",
  "a[href*='/logout']",
  "form[action*='/logout']",
  "[data-customer-id]",
  "[data-testid='account-menu']",
].join(",")
const LOGIN_MARKER = [
  "form[action*='/account/login']",
  "form[action*='/authentication/login']",
  "input[type='password']",
].join(",")
const NAVIGATION_HOSTS = new Set([
  "www.lunaportex.com",
  "account.lunaportex.com",
])
const SUBRESOURCE_HOSTS = new Set([
  ...NAVIGATION_HOSTS,
  "cdn.shopify.com",
  "challenges.cloudflare.com",
])

function stop(code) {
  const safe = /^[A-Z0-9_]{3,160}$/.test(code)
    ? code : "LUNA_OWNER_HANDOFF_HELPER_FAILED_CLOSED"
  throw new Error(safe)
}

function exactChallenge(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) stop(
    "LUNA_OWNER_HANDOFF_CHALLENGE_INVALID")
  const keys = Object.keys(value).sort().join(",")
  if (keys !== "challengeId,contractVersion,environmentBinding,expiresAt,nonce,oneTime,ownerAdminCreated,plaintextSessionAccepted,publicKeyPem,targetOrigin,uploadPath" ||
      value.contractVersion !== VERSION || !UUID.test(value.challengeId) ||
      !NONCE.test(value.nonce) || value.environmentBinding !== ENVIRONMENT ||
      value.targetOrigin !== ORIGIN || value.uploadPath !== UPLOAD_PATH ||
      value.oneTime !== true || value.ownerAdminCreated !== true ||
      value.plaintextSessionAccepted !== false ||
      typeof value.publicKeyPem !== "string" ||
      !value.publicKeyPem.startsWith("-----BEGIN PUBLIC KEY-----") ||
      typeof value.expiresAt !== "string" ||
      Date.parse(value.expiresAt) <= Date.now()) {
    stop("LUNA_OWNER_HANDOFF_CHALLENGE_INVALID")
  }
  return value
}

function topLevel(request) {
  return request.isNavigationRequest() && request.frame().parentFrame() === null
}

function allowedRequest(request) {
  const method = request.method().toUpperCase()
  if (!["GET", "HEAD", "POST", "OPTIONS"].includes(method)) return false
  let url
  try { url = new URL(request.url()) } catch { return false }
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      url.hash) return false
  if (topLevel(request)) return NAVIGATION_HOSTS.has(url.hostname)
  return SUBRESOURCE_HOSTS.has(url.hostname)
}

function selectedCookies(cookies) {
  const selected = cookies.filter((cookie) => {
    const domain = cookie.domain.toLowerCase().replace(/^\./, "")
    return (domain === "lunaportex.com" || domain === "www.lunaportex.com") &&
      cookie.secure && SAFE_COOKIE_NAME.test(cookie.name) &&
      SAFE_COOKIE_VALUE.test(cookie.value) && REQUIRED_COOKIE.test(cookie.name)
  })
  const unique = new Map(selected.map((cookie) => [cookie.name, cookie]))
  const values = [...unique.values()].sort((left, right) =>
    left.name.localeCompare(right.name))
  if (values.length < 1 || values.length > 12) {
    stop("LUNA_OWNER_HANDOFF_SESSION_COOKIE_SET_INVALID")
  }
  const cookieHeader = values.map((cookie) =>
    `${cookie.name}=${cookie.value}`).join("; ")
  if (Buffer.byteLength(cookieHeader, "utf8") > 8_192) {
    stop("LUNA_OWNER_HANDOFF_SESSION_COOKIE_SET_INVALID")
  }
  return { values, cookieHeader }
}

function cookieFingerprint(cookie) {
  return createHash("sha256").update(cookie.name, "utf8")
    .update("\u0000", "utf8").update(cookie.value, "utf8").digest("hex")
}

function aad(challenge) {
  return Buffer.from([
    VERSION,
    challenge.challengeId,
    ENVIRONMENT,
    challenge.expiresAt,
  ].join("\u0000"), "utf8")
}

async function main() {
  const challengePath = process.argv[2]
  if (!challengePath || process.argv.length !== 3) {
    stop("LUNA_OWNER_HANDOFF_CHALLENGE_FILE_REQUIRED")
  }
  let challenge
  try {
    challenge = exactChallenge(JSON.parse(await readFile(challengePath, "utf8")))
  } finally {
    await unlink(challengePath).catch(() => undefined)
  }

  stdout.write(`${BUILD_ID}\n`)
  stdout.write("Abriendo Chromium visible. Inicia sesión directamente en Luna.\n")
  let browser
  let context
  let sessionPayload
  let sessionKey
  let ciphertext
  try {
    browser = await chromium.launch({
      headless: false,
      args: [
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-sync",
        "--no-default-browser-check",
        "--no-first-run",
      ],
    })
    context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      locale: "es-GT",
      viewport: { width: 1160, height: 820 },
    })
    await context.route("**/*", async (route) => {
      if (allowedRequest(route.request())) await route.continue()
      else await route.abort("blockedbyclient")
    })
    const page = await context.newPage()
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" })
    const initial = new Map()
    try {
      for (const cookie of selectedCookies(await context.cookies([
        "https://www.lunaportex.com/account",
        "https://account.lunaportex.com/",
      ])).values) initial.set(cookie.name, cookieFingerprint(cookie))
    } catch { /* the unauthenticated cookie set may be empty */ }

    const prompt = createInterface({ input: stdin, output: stdout })
    try {
      await prompt.question(
        "Cuando veas tu cuenta Luna autenticada, vuelve aquí y pulsa Enter. ",
      )
    } finally {
      prompt.close()
    }
    if (Date.parse(challenge.expiresAt) <= Date.now()) {
      stop("LUNA_OWNER_HANDOFF_EXPIRED")
    }
    const pages = context.pages().filter((entry) => !entry.isClosed())
    if (pages.length !== 1) stop("LUNA_OWNER_HANDOFF_MULTIPLE_PAGES_DENIED")
    const activePage = pages[0]
    const pageUrl = new URL(activePage.url())
    if (!NAVIGATION_HOSTS.has(pageUrl.hostname) ||
        /\/(?:login|signin|callback)(?:\/|$)/i.test(pageUrl.pathname)) {
      stop("LUNA_OWNER_HANDOFF_AUTHENTICATION_NOT_COMPLETE")
    }
    const pageState = await activePage.evaluate(({ auth, login }) => ({
      authenticatedMarker: Boolean(document.querySelector(auth)),
      loginForm: Boolean(document.querySelector(login)),
    }), { auth: AUTH_MARKER, login: LOGIN_MARKER })
    if (!pageState.authenticatedMarker || pageState.loginForm) {
      stop("LUNA_OWNER_HANDOFF_AUTHENTICATION_NOT_COMPLETE")
    }
    const captured = selectedCookies(await context.cookies([
      "https://www.lunaportex.com/account",
      "https://account.lunaportex.com/",
    ]))
    if (!captured.values.some((cookie) =>
      initial.get(cookie.name) !== cookieFingerprint(cookie))) {
      stop("LUNA_OWNER_HANDOFF_AUTHENTICATED_SESSION_NOT_PROVEN")
    }
    const capturedAt = Date.now()
    const explicitExpiries = captured.values
      .filter((cookie) => cookie.expires > 0)
      .map((cookie) => Math.floor(cookie.expires * 1_000))
    const expiresAt = Math.min(
      capturedAt + 24 * 60 * 60_000,
      explicitExpiries.length ? Math.min(...explicitExpiries) : Infinity,
    )
    if (!Number.isFinite(expiresAt) || expiresAt <= capturedAt + 60_000) {
      stop("LUNA_OWNER_HANDOFF_SESSION_EXPIRY_INVALID")
    }
    sessionPayload = Buffer.from(JSON.stringify({
      contractVersion: "SELLER_OS_LUNA_PROTECTED_SESSION_V1",
      cookieHeader: captured.cookieHeader,
      capturedAt: new Date(capturedAt).toISOString(),
      validatedAt: new Date(capturedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
    }), "utf8")

    sessionKey = randomBytes(32)
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", sessionKey, iv)
    cipher.setAAD(aad(challenge))
    ciphertext = Buffer.concat([cipher.update(sessionPayload), cipher.final()])
    const authTag = cipher.getAuthTag()
    const wrappedKey = publicEncrypt({
      key: challenge.publicKeyPem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    }, sessionKey)

    const response = await fetch(`${ORIGIN}${UPLOAD_PATH}`, {
      method: "PUT",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contractVersion: VERSION,
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        environmentBinding: ENVIRONMENT,
        expiresAt: challenge.expiresAt,
        wrappedKey: wrappedKey.toString("base64url"),
        iv: iv.toString("base64url"),
        authTag: authTag.toString("base64url"),
        ciphertext: ciphertext.toString("base64url"),
      }),
    })
    const result = await response.json().catch(() => ({}))
    wrappedKey.fill(0)
    iv.fill(0)
    authTag.fill(0)
    if (!response.ok || result?.success !== true ||
        result?.status !== "SESSION_READY") {
      stop(typeof result?.error === "string"
        ? result.error : "LUNA_OWNER_HANDOFF_UPLOAD_REJECTED")
    }
    stdout.write("SESSION_READY · handoff cifrado completado.\n")
  } finally {
    sessionPayload?.fill(0)
    sessionKey?.fill(0)
    ciphertext?.fill(0)
    try { await context?.clearCookies() } catch { /* fail closed */ }
    try { await context?.close() } catch { /* fail closed */ }
    try { await browser?.close() } catch { /* fail closed */ }
  }
}

main().catch((cause) => {
  const code = cause instanceof Error && /^[A-Z0-9_]{3,160}$/.test(cause.message)
    ? cause.message : "LUNA_OWNER_HANDOFF_HELPER_FAILED_CLOSED"
  process.stderr.write(`${code}\n`)
  process.exitCode = 1
})
