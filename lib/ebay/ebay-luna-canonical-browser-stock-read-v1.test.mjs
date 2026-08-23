import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const {
  buildSellerOsLunaBrowserDirectedProductV1,
  classifySellerOsLunaBrowserSessionHealthV1,
} = await import("./ebay-luna-canonical-browser-stock-read-v1.ts")

const PRODUCT_URL = "https://lunaportex.com/products/exact-product"

function evidence(overrides = {}) {
  return {
    productId: "9220832362720",
    handle: "exact-product",
    title: "Exact product",
    vendor: "Luna",
    productType: "Accessory",
    currency: "USD",
    variants: [{
      id: "48809643409632",
      title: "Black",
      sku: "ITEM3752",
      barcode: null,
      price: 1179,
      compareAtPrice: null,
      available: true,
      quantity: 5,
      quantityExplicit: true,
      grams: 0,
      weight: 1,
      weightUnit: "kg",
    }],
    ...overrides,
  }
}

test("authenticated browser page is HEALTHY and yields bounded in-stock evidence", () => {
  const health = classifySellerOsLunaBrowserSessionHealthV1({
    url: "https://account.lunaportex.com/",
    title: "Account",
    authenticatedMarkerPresent: true,
  })
  assert.equal(health, "HEALTHY")
  const product = buildSellerOsLunaBrowserDirectedProductV1({
    canonicalSourceUrl: PRODUCT_URL,
    sessionHealth: health,
    evidence: evidence(),
  })
  assert.equal(product.sourceMode, "AUTHENTICATED_WEB_SESSION")
  assert.equal(product.variants[0].available, true)
  assert.equal(product.variants[0].sourceInventoryQuantity, 5)
  assert.equal(product.variants[0].sourceInventoryQuantityExplicit, true)
  assert.equal(product.sourceCurrency, "USD")
})

test("Cloudflare challenge fails closed without stock certification", () => {
  const health = classifySellerOsLunaBrowserSessionHealthV1({
    url: "https://www.lunaportex.com/products/exact-product",
    title: "Just a moment...",
    cloudflareChallengePresent: true,
    authenticatedMarkerPresent: true,
  })
  assert.equal(health, "CLOUDFLARE_CHALLENGE")
  assert.throws(() => buildSellerOsLunaBrowserDirectedProductV1({
    canonicalSourceUrl: PRODUCT_URL,
    sessionHealth: health,
    evidence: evidence({ variants: [{ available: false }] }),
  }), /LUNA_CAPTCHA_BLOCKED/)
})

test("login redirect fails closed without stock certification", () => {
  const health = classifySellerOsLunaBrowserSessionHealthV1({
    url: "https://www.lunaportex.com/account/login",
    loginFormPresent: true,
    authenticatedMarkerPresent: false,
  })
  assert.equal(health, "AUTH_REQUIRED")
  assert.throws(() => buildSellerOsLunaBrowserDirectedProductV1({
    canonicalSourceUrl: PRODUCT_URL,
    sessionHealth: health,
    evidence: evidence(),
  }), /LUNA_REAUTH_REQUIRED/)
})

test("explicit sold-out browser evidence yields authoritative OOS", () => {
  const variant = {
    ...evidence().variants[0],
    available: false,
    quantity: 0,
    quantityExplicit: true,
  }
  const product = buildSellerOsLunaBrowserDirectedProductV1({
    canonicalSourceUrl: PRODUCT_URL,
    sessionHealth: "HEALTHY",
    evidence: evidence({ variants: [variant] }),
  })
  assert.equal(product.variants[0].available, false)
  assert.equal(product.variants[0].sourceInventoryQuantity, 0)
  assert.equal(product.variants[0].sourceInventoryQuantityExplicit, true)
})

test("quantity stays unknown when Luna does not explicitly expose it", () => {
  const variant = {
    ...evidence().variants[0],
    quantity: null,
    quantityExplicit: false,
  }
  const product = buildSellerOsLunaBrowserDirectedProductV1({
    canonicalSourceUrl: PRODUCT_URL,
    sessionHealth: "HEALTHY",
    evidence: evidence({ variants: [variant] }),
  })
  assert.equal(product.variants[0].sourceInventoryQuantity, null)
  assert.equal(product.variants[0].sourceInventoryQuantityExplicit, false)
})

test("unknown or malformed product evidence fails closed", () => {
  assert.throws(() => buildSellerOsLunaBrowserDirectedProductV1({
    canonicalSourceUrl: PRODUCT_URL,
    sessionHealth: "UNPROVEN",
    evidence: evidence(),
  }), /LUNA_AUTHENTICATED_BROWSER_STATE_UNPROVEN/)
  assert.throws(() => buildSellerOsLunaBrowserDirectedProductV1({
    canonicalSourceUrl: PRODUCT_URL,
    sessionHealth: "HEALTHY",
    evidence: evidence({ variants: [{
      ...evidence().variants[0], quantity: "unknown", quantityExplicit: true,
    }] }),
  }), /LUNA_AUTHENTICATED_BROWSER_PRODUCT_UNPROVEN/)
})

test("browser stock contract contains no mutation or session export path", async () => {
  const source = await readFile(new URL(
    "./ebay-luna-canonical-browser-stock-read-v1.ts", import.meta.url,
  ), "utf8")
  assert.doesNotMatch(source, /\bsupabase\b|\.insert\(|\.upsert\(/i)
  assert.doesNotMatch(source, /ebay.*(?:revise|end|write)|luna.*(?:write|mutate)/i)
  assert.doesNotMatch(source,
    /cookieHeader|storageState|localStorage|sessionStorage|rawHtml|screenshot/i)
})

test("existing stock compositions use the canonical browser worker, not HTTP auth", async () => {
  const files = await Promise.all([
    new URL("./ebay-luna-canonical-server-read-server-v1.ts", import.meta.url),
    new URL("../../app/api/cron/ebay-active-listing-luna-monitor/route.ts",
      import.meta.url),
  ].map((url) => readFile(url, "utf8")))
  for (const source of files) {
    assert.match(source, /fetchLunaAuthenticatedBrowserProductV1/)
    assert.doesNotMatch(source, /fetchLunaAuthenticatedDirectedProductV1/)
  }
})
