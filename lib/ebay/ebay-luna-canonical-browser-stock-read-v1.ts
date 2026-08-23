import { createHash } from "node:crypto"

import {
  parseDirectedLunaProductUrl,
  type DirectedLunaProduct,
  type DirectedLunaVariant,
// @ts-ignore -- Node's native TypeScript test runner requires the explicit extension.
} from "./ebay-luna-directed-product-import.ts"

export const SELLER_OS_LUNA_BROWSER_STOCK_READ_VERSION =
  "SELLER_OS_LUNA_BROWSER_STOCK_READ_V1" as const

export type SellerOsLunaBrowserSessionHealthV1 =
  | "HEALTHY"
  | "REAUTH_REQUIRED"
  | "CLOUDFLARE_CHALLENGE"
  | "AUTH_REQUIRED"
  | "UNPROVEN"

type JsonRecord = Record<string, unknown>

const LUNA_BROWSER_HOSTS = new Set([
  "lunaportex.com",
  "www.lunaportex.com",
  "account.lunaportex.com",
])
const LOGIN_PATH = /^(?:\/account\/(?:login|signin)|\/(?:login|signin)|\/authentication\/(?:login|oauth\/authorize)|\/callback)\/?$/i
const MAX_VARIANTS = 500

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown, maximum = 300) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, maximum) || null
    : null
}

function nonNegativeInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function positiveMoneyFromMinorUnits(value: unknown) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Number((parsed / 100).toFixed(2)) : null
}

export function classifySellerOsLunaBrowserSessionHealthV1(input: Readonly<{
  url: unknown
  title?: unknown
  cloudflareChallengePresent?: unknown
  loginFormPresent?: unknown
  authenticatedMarkerPresent?: unknown
}>) : SellerOsLunaBrowserSessionHealthV1 {
  let url: URL
  try { url = new URL(String(input.url ?? "")) } catch { return "UNPROVEN" }
  const title = text(input.title, 160) ?? ""
  if (input.cloudflareChallengePresent === true ||
      url.hostname === "challenges.cloudflare.com" ||
      /just a moment|verifying (?:you are human|your connection)|cloudflare/i
        .test(title)) {
    return "CLOUDFLARE_CHALLENGE"
  }
  if (url.protocol !== "https:" || !LUNA_BROWSER_HOSTS.has(url.hostname)) {
    return "UNPROVEN"
  }
  if (input.loginFormPresent === true || LOGIN_PATH.test(url.pathname)) {
    return "AUTH_REQUIRED"
  }
  if (input.authenticatedMarkerPresent === true) return "HEALTHY"
  return "REAUTH_REQUIRED"
}

export type SellerOsLunaBrowserProductEvidenceV1 = Readonly<{
  productId: unknown
  handle: unknown
  title: unknown
  vendor?: unknown
  productType?: unknown
  currency?: unknown
  variants: unknown
}>

type SellerOsLunaBrowserDirectedVariantV1 = DirectedLunaVariant & Readonly<{
  sourceInventoryQuantity: number | null
  sourceInventoryQuantityExplicit: boolean
}>

export type SellerOsLunaBrowserDirectedProductV1 = DirectedLunaProduct &
  Readonly<{
    variants: SellerOsLunaBrowserDirectedVariantV1[]
    sourceMode: "AUTHENTICATED_WEB_SESSION"
    sourceSessionHealth: "SESSION_OK"
    sourceParserVersion: string
    sourceEvidenceFingerprint: string
    sourceCurrency: string | null
  }>

function browserVariant(value: unknown):
  SellerOsLunaBrowserDirectedVariantV1 | null {
  const variant = record(value)
  const id = String(variant.id ?? "")
  const sku = text(variant.sku, 120)
  const title = text(variant.title, 300)
  const price = positiveMoneyFromMinorUnits(variant.price)
  if (!/^\d{1,30}$/.test(id) || !sku || !price ||
      typeof variant.available !== "boolean") return null

  const quantityExplicit = variant.quantityExplicit === true
  const quantity = quantityExplicit
    ? nonNegativeInteger(variant.quantity) : null
  if (quantityExplicit && quantity === null) return null
  const compareAtPrice = positiveMoneyFromMinorUnits(variant.compareAtPrice)
  const grams = Number(variant.grams)
  const weight = Number(variant.weight)
  const hasGrams = Number.isFinite(grams) && grams > 0
  return Object.freeze({
    id,
    title: title ?? "Variante general",
    sku,
    sourceUnitBarcode: text(variant.barcode, 120),
    sourceUnitPrice: price,
    sourceCompareAtPrice: compareAtPrice,
    available: variant.available,
    weight: hasGrams
      ? grams : Number.isFinite(weight) && weight > 0 ? weight : null,
    weightUnit: hasGrams ? "g" : text(variant.weightUnit, 30),
    sourceInventoryQuantity: quantity,
    sourceInventoryQuantityExplicit: quantityExplicit,
  })
}

/**
 * Converts the browser worker's already-bounded page projection into the
 * existing directed-product contract. Raw HTML, browser state and credentials
 * never cross this boundary.
 */
export function buildSellerOsLunaBrowserDirectedProductV1(input: Readonly<{
  canonicalSourceUrl: unknown
  sessionHealth: SellerOsLunaBrowserSessionHealthV1
  evidence: SellerOsLunaBrowserProductEvidenceV1 | null
}>) : SellerOsLunaBrowserDirectedProductV1 {
  if (input.sessionHealth === "CLOUDFLARE_CHALLENGE") {
    throw new Error("LUNA_CAPTCHA_BLOCKED")
  }
  if (["AUTH_REQUIRED", "REAUTH_REQUIRED"].includes(input.sessionHealth)) {
    throw new Error("LUNA_REAUTH_REQUIRED")
  }
  if (input.sessionHealth !== "HEALTHY" || !input.evidence) {
    throw new Error("LUNA_AUTHENTICATED_BROWSER_STATE_UNPROVEN")
  }
  const parsedUrl = parseDirectedLunaProductUrl(input.canonicalSourceUrl)
  const evidence = record(input.evidence)
  const productId = String(evidence.productId ?? "")
  const handle = text(evidence.handle, 181)
  const title = text(evidence.title, 500)
  const variantsInput = Array.isArray(evidence.variants)
    ? evidence.variants : []
  if (!/^\d{1,30}$/.test(productId) || handle !== parsedUrl.handle || !title ||
      variantsInput.length < 1 || variantsInput.length > MAX_VARIANTS) {
    throw new Error("LUNA_AUTHENTICATED_BROWSER_PRODUCT_UNPROVEN")
  }
  const variants = variantsInput.map(browserVariant)
  if (variants.some((variant) => !variant)) {
    throw new Error("LUNA_AUTHENTICATED_BROWSER_PRODUCT_UNPROVEN")
  }
  const boundedVariants = variants as SellerOsLunaBrowserDirectedVariantV1[]
  const identityKeys = new Set(boundedVariants.map((variant) =>
    `${variant.id}:${variant.sku}`))
  if (identityKeys.size !== boundedVariants.length) {
    throw new Error("LUNA_AUTHENTICATED_BROWSER_PRODUCT_UNPROVEN")
  }
  const currency = text(evidence.currency, 3)?.toUpperCase() ?? null
  if (currency !== null && !/^[A-Z]{3}$/.test(currency)) {
    throw new Error("LUNA_AUTHENTICATED_BROWSER_PRODUCT_UNPROVEN")
  }
  const fingerprint = createHash("sha256").update(JSON.stringify({
    productId,
    handle,
    variants: boundedVariants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      available: variant.available,
      quantity: variant.sourceInventoryQuantityExplicit
        ? variant.sourceInventoryQuantity : null,
      price: variant.sourceUnitPrice,
      compareAtPrice: variant.sourceCompareAtPrice,
    })),
    currency,
  })).digest("hex")
  return Object.freeze({
    productId,
    handle,
    title,
    vendor: text(evidence.vendor, 300),
    productType: text(evidence.productType, 300),
    canonicalUrl: parsedUrl.canonicalUrl,
    imageUrls: [],
    variants: boundedVariants,
    sourceMode: "AUTHENTICATED_WEB_SESSION" as const,
    sourceSessionHealth: "SESSION_OK" as const,
    sourceParserVersion: SELLER_OS_LUNA_BROWSER_STOCK_READ_VERSION,
    sourceEvidenceFingerprint:
      `luna_authenticated_${fingerprint.slice(0, 40)}`,
    sourceCurrency: currency,
  })
}
