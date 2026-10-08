import assert from "node:assert/strict"
import test from "node:test"

import { assertAmazonWholesaleScoutLimitV1,
  scoutAmazonWholesaleOpportunitiesV1 } from
  "../marketplace/seller-os-amazon-wholesale-opportunity-scout-v1.ts"
import { parseAmazonCatalogSearchV1 } from
  "../marketplace/amazon-sp-api-readonly-v1.ts"
import { SELLER_OS_ASSISTANT_TOOLS_V1 } from
  "./ebay-seller-os-assistant-gateway-v1.ts"

test("scout accepts one to ten opportunities and requires no ASIN", async () => {
  assert.equal(assertAmazonWholesaleScoutLimitV1(undefined), 10)
  assert.equal(assertAmazonWholesaleScoutLimitV1(1), 1)
  assert.equal(assertAmazonWholesaleScoutLimitV1(10), 10)
  for (const value of [0, 11, 1.5, "bad"]) {
    assert.throws(() => assertAmazonWholesaleScoutLimitV1(value),
      /AMAZON_WHOLESALE_SCOUT_LIMIT_INVALID/)
  }
  const supabase = { from() {
    throw new Error("SUPABASE_MUST_NOT_RUN_BEFORE_AMAZON_AUTHORIZATION")
  } }
  const result = await scoutAmazonWholesaleOpportunitiesV1({
    supabase, limit: 3, query: "oral care", environment: {},
    now: new Date("2026-10-08T12:00:00.000Z"),
  })
  assert.equal(result.status, "AMAZON_AUTHORIZATION_REQUIRED")
  assert.equal(result.requestedLimit, 3)
  assert.equal(result.returnedCount, 0)
  assert.equal(result.economicPolicy.minimumEstimatedRoiPercent, 30)
  assert.equal(result.economicPolicy.minimumContributionMarginPercent, 15)
  assert.equal(result.economicPolicy.minimumMonetaryProfitUsd, null)
  assert.equal(result.safety.paidServicesActivated, 0)
})

test("Amazon catalog parser preserves exact identifiers for product matching", () => {
  const items = parseAmazonCatalogSearchV1({ items: [{ asin: "B012345678",
    summaries: [{ itemName: "Fixture Mouthwash 16 oz", brand: "Fixture",
      websiteDisplayGroupName: "Health" }],
    productTypes: [{ productType: "ORAL_HYGIENE" }],
    identifiers: [{ identifiers: [{ identifierType: "UPC",
      identifier: "036000291452" }] }],
    attributes: { item_package_quantity: [{ value: 1 }],
      color: [{ value: "Blue" }] },
  }] })
  assert.equal(items.length, 1)
  assert.equal(items[0].asin, "B012345678")
  assert.equal(items[0].upc, "036000291452")
  assert.equal(items[0].packCount, 1)
  assert.equal(items[0].source, "AMAZON_CATALOG_ITEMS_2022_04_01")
})

test("MCP advertises the scout as bounded read-only discovery", () => {
  const tool = SELLER_OS_ASSISTANT_TOOLS_V1.find((entry) =>
    entry.name === "seller_os_scout_amazon_wholesale_opportunities")
  assert.ok(tool)
  assert.equal(tool.annotations.readOnlyHint, true)
  assert.equal(tool.annotations.destructiveHint, false)
  assert.match(tool.description, /without requiring ASINs/i)
  assert.doesNotMatch(tool.description, /minimum.*\$4/i)
})
