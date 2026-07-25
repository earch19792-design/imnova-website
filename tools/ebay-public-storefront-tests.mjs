import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

function moduleUrl(source) {
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
}

const scopeSource = readFileSync(
  new URL("../lib/ebay/ebay-seller-account-scope.ts", import.meta.url),
  "utf8",
)
const storefrontSource = readFileSync(
  new URL("../lib/ebay/ebay-public-storefront.ts", import.meta.url),
  "utf8",
).replace(
  'from "./ebay-seller-account-scope"',
  `from "${moduleUrl(scopeSource)}"`,
)
const {
  getEbayPublicStorefront,
} = await import(moduleUrl(storefrontSource))
const shopRoute = readFileSync(
  new URL("../app/shop/route.ts", import.meta.url),
  "utf8",
)

test("public storefront builds one encoded all-items link from bound identity", () => {
  const storefront = getEbayPublicStorefront({
    EBAY_SELLER_ACCOUNT_KEY: "official-account",
    EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: "My Seller & Store",
  })
  assert.equal(storefront.configured, true)
  assert.equal(
    storefront.preferredShareUrl,
    "https://www.ebay.com/sch/i.html?_ssn=My%20Seller%20%26%20Store",
  )
  assert.equal(
    storefront.sellerProfileUrl,
    "https://www.ebay.com/usr/My%20Seller%20%26%20Store",
  )
})

test("public storefront fails closed without the official seller user id", () => {
  const storefront = getEbayPublicStorefront({
    EBAY_SELLER_ACCOUNT_KEY: "official-account",
    EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT:
      "a".repeat(64),
  })
  assert.equal(storefront.configured, false)
  assert.equal(storefront.preferredShareUrl, null)
  assert.equal(storefront.reason, "EBAY_PUBLIC_SELLER_USER_ID_REQUIRED")
})

test("storefront redirect exposes no credentials and performs no eBay call", () => {
  assert.doesNotMatch(
    shopRoute,
    /CLIENT_SECRET|REFRESH_TOKEN|Authorization|fetch\(/,
  )
  assert.match(shopRoute, /NextResponse\.redirect/)
  assert.match(shopRoute, /status:\s*307/)
})
