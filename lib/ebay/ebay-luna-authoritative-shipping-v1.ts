import { createHash } from "node:crypto"

import { calculateEbayUnitEconomics } from "./ebay-unit-economics"

export const LUNA_AUTHORITATIVE_SHIPPING_VERSION =
  "LUNA_AUTHORITATIVE_SHIPPING_V1" as const
export const LUNA_PROTECTED_BROWSER_SHIPPING_SOURCE =
  "LUNA_PROTECTED_BROWSER_CHECKOUT_SHIPPING" as const
export const LUNA_HTTP_SHIPPING_SOURCE =
  "LUNA_AUTHENTICATED_HTTP_CART_SHIPPING" as const

const PRODUCT_ID = /^\d{8,24}$/
const VARIANT_ID = /^\d{8,24}$/
const SAFE_SKU = /^[A-Za-z0-9][A-Za-z0-9._:+/ -]{0,159}$/
const SHA256 = /^sha256:[0-9a-f]{64}$/
const MAXIMUM_RATE_LIMIT_MS = 15 * 60 * 1_000
const MAXIMUM_RATE_LIMIT_ENTRIES = 200

export type LunaShippingIdentityV1 = Readonly<{
  candidateId: string
  canonicalProductUrl: string
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
  quantity: number
}>

export type LunaShippingDestinationV1 = Readonly<{
  profileId: string
  profileDigest: string
  country: "US"
  province: string
  postalCode: string
}>

export type LunaShippingQuoteV1 = Readonly<{
  status: "AVAILABLE"
  subtotalUsd: number
  shippingAmountUsd: number
  currency: "USD"
  acquisitionMethod:
    | typeof LUNA_HTTP_SHIPPING_SOURCE
    | typeof LUNA_PROTECTED_BROWSER_SHIPPING_SOURCE
  observedAt: string
  evidenceDigest: string
  exactLunaIdentity: true
  destinationProfileId: string
  destinationProfileDigest: string
  noPurchase: true
  noPayment: true
}>

export type LunaShippingAttemptV1 = LunaShippingQuoteV1 | Readonly<{
  status: "LUNA_RATE_LIMITED" | "BLOCKED"
  blocker: string
  retryAfterMs: number | null
  retryNotBefore: string | null
  purchasePerformed: false
  paymentPerformed: false
}>

type GlobalRateLimitState = typeof globalThis & {
  __sellerOsLunaShippingRateLimitV1?: Map<string, number>
}

function rateLimits() {
  const state = globalThis as GlobalRateLimitState
  state.__sellerOsLunaShippingRateLimitV1 ??= new Map()
  return state.__sellerOsLunaShippingRateLimitV1
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function finiteMoney(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? roundMoney(parsed) : null
}

function canonicalProductUrl(value: string) {
  let parsed: URL
  try { parsed = new URL(value) } catch {
    throw new Error("LUNA_SHIPPING_PRODUCT_URL_INVALID")
  }
  if (parsed.protocol !== "https:" ||
      !new Set(["lunaportex.com", "www.lunaportex.com"]).has(parsed.hostname) ||
      !/^\/products\/[a-z0-9][a-z0-9-]{1,180}\/?$/.test(parsed.pathname) ||
      parsed.username || parsed.password || parsed.port) {
    throw new Error("LUNA_SHIPPING_PRODUCT_URL_INVALID")
  }
  parsed.hostname = "www.lunaportex.com"
  parsed.pathname = parsed.pathname.replace(/\/$/, "")
  parsed.search = ""
  parsed.hash = ""
  return parsed.toString()
}

export function normalizeLunaShippingIdentityV1(
  input: LunaShippingIdentityV1,
) : LunaShippingIdentityV1 {
  if (!SHA256.test(input.candidateId) ||
      !PRODUCT_ID.test(input.lunaProductId) ||
      !VARIANT_ID.test(input.lunaVariantId) ||
      !SAFE_SKU.test(input.supplierSku) ||
      !Number.isInteger(input.quantity) || input.quantity < 1 ||
      input.quantity > 20) {
    throw new Error("LUNA_SHIPPING_IDENTITY_INVALID")
  }
  return Object.freeze({
    ...input,
    canonicalProductUrl: canonicalProductUrl(input.canonicalProductUrl),
  })
}

export function normalizeLunaShippingDestinationV1(
  input: LunaShippingDestinationV1,
) : LunaShippingDestinationV1 {
  if (!/^[A-Z0-9_-]{3,80}$/.test(input.profileId) ||
      !SHA256.test(input.profileDigest) || input.country !== "US" ||
      !/^[A-Z]{2}$/.test(input.province) ||
      !/^\d{5}(?:-\d{4})?$/.test(input.postalCode)) {
    throw new Error("LUNA_SHIPPING_DESTINATION_INVALID")
  }
  return Object.freeze({ ...input })
}

export function parseLunaRetryAfterV1(
  value: string | null,
  now = Date.now(),
) {
  if (!value) return null
  const seconds = Number(value.trim())
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAXIMUM_RATE_LIMIT_MS, Math.ceil(seconds * 1_000))
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  return Math.min(MAXIMUM_RATE_LIMIT_MS, Math.max(0, timestamp - now))
}

export function buildLunaShippingEvidenceDigestV1(value: Readonly<{
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
  subtotalUsd: number
  shippingAmountUsd: number
  currency: "USD"
  destinationProfileDigest: string
  acquisitionMethod: string
  observedAt: string
}>) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value))
    .digest("hex")}`
}

function cleanExpiredRateLimits(now: number) {
  const limits = rateLimits()
  for (const [key, expiresAt] of limits) {
    if (expiresAt <= now) limits.delete(key)
  }
  while (limits.size >= MAXIMUM_RATE_LIMIT_ENTRIES) {
    const oldest = limits.keys().next().value
    if (typeof oldest !== "string") break
    limits.delete(oldest)
  }
}

export async function acquireAuthoritativeLunaShippingV1(input: Readonly<{
  identity: LunaShippingIdentityV1
  destination: LunaShippingDestinationV1
  httpAcquire: () => Promise<LunaShippingAttemptV1>
  browserAcquire: () => Promise<LunaShippingAttemptV1>
  now?: number
}>) {
  const identity = normalizeLunaShippingIdentityV1(input.identity)
  normalizeLunaShippingDestinationV1(input.destination)
  const now = input.now ?? Date.now()
  cleanExpiredRateLimits(now)
  const existingLimit = rateLimits().get(identity.candidateId) ?? null
  let http: LunaShippingAttemptV1
  if (existingLimit !== null && existingLimit > now) {
    http = Object.freeze({
      status: "LUNA_RATE_LIMITED" as const,
      blocker: "LUNA_HTTP_RATE_LIMIT_WINDOW_ACTIVE",
      retryAfterMs: existingLimit - now,
      retryNotBefore: new Date(existingLimit).toISOString(),
      purchasePerformed: false as const,
      paymentPerformed: false as const,
    })
  } else {
    http = await input.httpAcquire()
    if (http.status === "LUNA_RATE_LIMITED") {
      const retryAfterMs = Math.max(0, Math.min(MAXIMUM_RATE_LIMIT_MS,
        http.retryAfterMs ?? 60_000))
      rateLimits().set(identity.candidateId, now + retryAfterMs)
    }
  }
  if (http.status === "AVAILABLE") return Object.freeze({
    status: "AVAILABLE" as const,
    http429Handled: false,
    browserFallbackAvailable: true,
    browserFallbackUsed: false,
    quote: http,
    blocker: null,
  })
  if (http.status !== "LUNA_RATE_LIMITED") return Object.freeze({
    status: "BLOCKED" as const,
    http429Handled: false,
    browserFallbackAvailable: true,
    browserFallbackUsed: false,
    quote: null,
    blocker: http.blocker,
  })
  const browser = await input.browserAcquire()
  if (browser.status === "AVAILABLE") return Object.freeze({
    status: "AVAILABLE" as const,
    http429Handled: true,
    browserFallbackAvailable: true,
    browserFallbackUsed: true,
    quote: browser,
    blocker: null,
  })
  return Object.freeze({
    status: "BLOCKED" as const,
    http429Handled: true,
    browserFallbackAvailable: true,
    browserFallbackUsed: true,
    quote: null,
    blocker: browser.blocker,
  })
}

export function evaluateLunaShippingEconomicsV1(input: Readonly<{
  salePriceUsd: number
  supplierCostUsd: number
  shippingQuote: LunaShippingQuoteV1 | null
}>) {
  if (!input.shippingQuote) return Object.freeze({
    status: "BLOCKED_MISSING_AUTHORITATIVE_LUNA_SHIPPING" as const,
    contributionProfitUsd: null,
    contributionMarginPercent: null,
    passesEconomics: false,
  })
  const result = calculateEbayUnitEconomics({
    salePrice: input.salePriceUsd,
    supplierCost: input.supplierCostUsd,
  }, {
    estimatedOutboundShipping: input.shippingQuote.shippingAmountUsd,
  })
  return Object.freeze({
    status: result.ready && result.passesProfitGate
      ? "PROVEN_PROFITABLE" as const : "PROVEN_UNPROFITABLE" as const,
    contributionProfitUsd: result.estimatedNetProfit,
    contributionMarginPercent: result.estimatedNetMarginPercent,
    passesEconomics: result.passesProfitGate,
  })
}
