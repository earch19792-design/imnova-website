import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const {
  certifyLunaChromeShippingVisibleCaptureV1,
  LUNA_SHIPPING_EXTENSION_ID,
  LUNA_SHIPPING_QUOTE_CAPTURE_VERSION,
  normalizeLunaChromeShippingJobV1,
} = await import("./ebay-luna-chrome-shipping-capture-v1.ts")

const NOW = Date.parse("2026-08-24T18:00:00.000Z")

function job() {
  return {
    contractVersion: LUNA_SHIPPING_QUOTE_CAPTURE_VERSION,
    captureSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    nonce: "abcdefghijklmnopqrstuvwxyzABCDEFGH12345678_-",
    identity: {
      candidateId:
        "sha256:39f9566e97c230d9fdf9882a802af7dad8a7a0e54ab000999bcc3da779f4ab60",
      canonicalProductUrl: "https://lunaportex.com/products/exact-microcurrent-device",
      lunaProductId: "9220832493792",
      lunaVariantId: "48809643540704",
      supplierSku: "ITEM3734",
      quantity: 1,
    },
    destination: {
      profileId: "LUNA_BOCA_RATON_US",
      profileDigest: `sha256:${"a".repeat(64)}`,
      country: "US",
      province: "FL",
      postalCode: "33487",
    },
    salePriceUsd: 27.17,
    supplierCostUsd: 10.96,
    productName: "Exact microcurrent device",
  }
}

function capture(overrides = {}) {
  return {
    contractVersion: LUNA_SHIPPING_QUOTE_CAPTURE_VERSION,
    captureSessionId: job().captureSessionId,
    nonce: job().nonce,
    candidateId: job().identity.candidateId,
    lunaProductId: job().identity.lunaProductId,
    lunaVariantId: job().identity.lunaVariantId,
    supplierSku: job().identity.supplierSku,
    quantity: 1,
    subtotalUsd: 10.96,
    shippingUsd: 4.25,
    totalUsd: 15.21,
    currency: "USD",
    observedAt: "2026-08-24T17:59:00.000Z",
    acquisitionMethod: "NORMAL_CHROME_EXTENSION_VISIBLE_DOM",
    extensionEvidenceDigest: `sha256:${"b".repeat(64)}`,
    normalChromeAuthenticated: true,
    expectedProductIdMatch: true,
    expectedVariantIdMatch: true,
    expectedSupplierSkuMatch: true,
    subtotalPlusShippingReconciles: true,
    cartRestoreProven: true,
    cookieAccess: false,
    credentialAccess: false,
    lunaPurchases: 0,
    ...overrides,
  }
}

test("exact visible Luna shipping becomes canonical economics without a write", () => {
  const result = certifyLunaChromeShippingVisibleCaptureV1({
    job: job(), capture: capture(), now: NOW,
  })
  assert.equal(result.captureStatus, "AUTHORITATIVE_LUNA_SHIPPING_AVAILABLE")
  assert.equal(result.quote.shippingAmountUsd, 4.25)
  assert.equal(result.quote.acquisitionMethod,
    "NORMAL_CHROME_EXTENSION_VISIBLE_DOM")
  assert.equal(result.quote.exactLunaIdentity, true)
  assert.equal(result.economics.contributionProfitUsd, 4.96)
  assert.equal(result.lunaPurchases, 0)
  assert.equal(result.marketplaceWrites, 0)
})

test("product, variant and supplier SKU mismatches fail closed", () => {
  for (const mismatch of [
    { lunaProductId: "9220832493793" },
    { lunaVariantId: "48809643540705" },
    { supplierSku: "ITEM3734-WRONG" },
  ]) assert.throws(() => certifyLunaChromeShippingVisibleCaptureV1({
    job: job(), capture: capture(mismatch), now: NOW,
  }), /LUNA_SHIPPING_EXTENSION_CAPTURE_UNPROVEN/)
})

test("stale, unreconciled or unauthenticated captures fail closed", () => {
  for (const unsafe of [
    { observedAt: "2026-08-24T16:00:00.000Z" },
    { totalUsd: 15.22 },
    { normalChromeAuthenticated: false },
    { cartRestoreProven: false },
  ]) assert.throws(() => certifyLunaChromeShippingVisibleCaptureV1({
    job: job(), capture: capture(unsafe), now: NOW,
  }), /LUNA_SHIPPING_EXTENSION_CAPTURE_UNPROVEN/)
})

test("job normalization allows only exact Luna product URLs and canonical facts", () => {
  assert.equal(normalizeLunaChromeShippingJobV1(job()).identity.canonicalProductUrl,
    "https://www.lunaportex.com/products/exact-microcurrent-device")
  assert.throws(() => normalizeLunaChromeShippingJobV1({ ...job(), identity: {
    ...job().identity, canonicalProductUrl: "https://example.com/products/wrong",
  } }), /LUNA_SHIPPING_PRODUCT_URL_INVALID/)
})

test("separate MV3 extension has only fixed Luna hosts and no sensitive permission", async () => {
  const root = new URL("../../tools/browser-extensions/luna-shipping-capture/",
    import.meta.url)
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"))
  assert.equal(manifest.manifest_version, 3)
  assert.equal(manifest.version, "1.0.1")
  assert.equal(manifest.name, "Seller OS — Luna Shipping Capture")
  assert.deepEqual(manifest.permissions, [])
  assert.deepEqual(manifest.host_permissions, [
    "https://lunaportex.com/*",
    "https://www.lunaportex.com/*",
    "https://account.lunaportex.com/*",
  ])
  assert.ok(!JSON.stringify(manifest).includes("<all_urls>"))
  assert.deepEqual(manifest.externally_connectable.matches, [
    "https://imnova-website-z1qh-git-featur-6c9e25-earch19792-6888s-projects.vercel.app/*",
  ])
  const key = Buffer.from(manifest.key, "base64")
  const id = [...createHash("sha256").update(key).digest().subarray(0, 16)]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join("")
  assert.equal(id, LUNA_SHIPPING_EXTENSION_ID)
})

test("extension is shipping-only, bounded, and cannot inspect browser auth state", async () => {
  const root = new URL("../../tools/browser-extensions/luna-shipping-capture/",
    import.meta.url)
  const [content, background] = await Promise.all([
    readFile(new URL("content.js", root), "utf8"),
    readFile(new URL("background.js", root), "utf8"),
  ])
  assert.match(content, /MAX_ATTEMPTS_PER_STEP = 2/)
  assert.match(content, /LUNA_SHIPPING_DOM_CONTRACT_CHANGED/)
  assert.match(content, /cart\/clear\.js/)
  assert.match(content, /cart\/add\.js/)
  assert.doesNotMatch(content + background,
    /localStorage|sessionStorage|document\.cookie|chrome\.cookies|webRequest|Authorization/)
  assert.doesNotMatch(content + background,
    /\/checkouts?(?:\/|\b)|\/orders?(?:\/|\b)|payment_intent|place.?order/i)
  assert.match(background, /START_SHIPPING_JOB/)
  assert.match(background, /chrome\.runtime\.onMessageExternal\.addListener/)
  assert.match(background, /SELLER_OS_LUNA_SHIPPING_PING/)
  assert.match(background, /LUNA_SHIPPING_EXTENSION_READY/)
  assert.match(background, /sellerOsOriginValidated: true/)
  assert.match(background, /safeSellerSender\(sender\)/)
  assert.match(background, /if \(sellerPort !== port\) return/)
  assert.match(background, /chrome\.tabs\.update/)
})

test("Seller OS page proves the external bridge before opening the job port", async () => {
  const page = await readFile(new URL(
    "../../app/admin/ebay/luna-shipping-capture/page.tsx", import.meta.url),
  "utf8")
  assert.match(page, /SELLER_OS_LUNA_SHIPPING_PING/)
  assert.match(page, /LUNA_SHIPPING_EXTENSION_READY/)
  assert.match(page, /runtime\.sendMessage\(LUNA_SHIPPING_EXTENSION_ID/)
  assert.ok(page.indexOf("await pingExtension") <
    page.indexOf("window.chrome.runtime.connect"))
  assert.match(page, /get\("runShipping"\) !== "1"/)
  assert.ok(page.indexOf("get(\"runShipping\")") <
    page.indexOf("adminPost(\"resolve_jobs\""))
})

test("existing eBay Product Research extension remains a separate boundary", async () => {
  const manifest = JSON.parse(await readFile(new URL(
    "../../tools/browser-extensions/ebay-product-research-capture/manifest.json",
    import.meta.url), "utf8"))
  assert.equal(manifest.name, "Seller OS — eBay Product Research Capture")
  assert.ok(manifest.host_permissions.every((entry) => !entry.includes("lunaportex")))
})
