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

const source = readFileSync(
  new URL("./ebay-account-subscription-readonly-domain.ts", import.meta.url),
  "utf8",
)
const { parseEbaySellerStoreSubscriptionReadonly } = await import(moduleUrl(source))

test("Account GET subscription proves one exact EBAY_US Store tier", () => {
  const result = parseEbaySellerStoreSubscriptionReadonly({
    subscriptions: [{
      marketplaceId: "EBAY_US",
      subscriptionType: "STORE",
      subscriptionLevel: "Basic",
    }],
  })
  assert.deepEqual(result, {
    status: "AVAILABLE",
    marketplaceId: "EBAY_US",
    storeSubscriptionLevel: "BASIC",
    matchingSubscriptionCount: 1,
  })
})

test("no EBAY_US Store subscription is explicit and never guessed", () => {
  const result = parseEbaySellerStoreSubscriptionReadonly({ subscriptions: [] })
  assert.equal(result.status, "NO_STORE")
  assert.equal(result.storeSubscriptionLevel, "NO_STORE")
})

test("multiple or unknown Store subscriptions fail closed", () => {
  assert.equal(parseEbaySellerStoreSubscriptionReadonly({ subscriptions: [
    { marketplaceId: "EBAY_US", subscriptionType: "STORE", subscriptionLevel: "BASIC" },
    { marketplaceId: "EBAY_US", subscriptionType: "STORE", subscriptionLevel: "PREMIUM" },
  ] }).status, "AMBIGUOUS")
  assert.equal(parseEbaySellerStoreSubscriptionReadonly({ subscriptions: [
    { marketplaceId: "EBAY_US", subscriptionType: "STORE", subscriptionLevel: "OTHER" },
  ] }).status, "UNPROVEN")
})

test("bounded cron branch reads category and subscription without other readers or writes", () => {
  const route = readFileSync(
    new URL("../../app/api/cron/ebay-commercial-monitor/route.ts", import.meta.url),
    "utf8",
  )
  assert.match(route, /feeAuthorityItemId/)
  assert.match(route, /readManualListingFromTradingApi/)
  assert.match(route, /readEbaySellerStoreSubscriptionReadonly/)
  assert.match(route, /readEbayPromotionStateReadonlyV1/)
  assert.match(route, /buildLiveListingPreSaleEconomicsV1/)
  assert.match(route, /sellerOsPreSaleEconomicsEvidence/)
  assert.match(route, /economicsExperimentId/)
  assert.match(route, /PRE_SALE_ECONOMICS_EXACT_LINEAGE_MISMATCH/)
  assert.match(route, /analyticsRequests: 0/)
  assert.match(route, /lunaRequests: 0/)
  assert.match(route, /marketplaceWrites: 0/)
  assert.match(route, /databaseWrites: 0/)
  assert.ok(route.indexOf("feeAuthorityItemId") < route.indexOf(
    "getCommercialMonitorScheduleConfiguration()",
  ))
})
