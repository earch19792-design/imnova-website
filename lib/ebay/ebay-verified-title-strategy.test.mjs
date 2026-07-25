import assert from "node:assert/strict"
import test from "node:test"

import { buildVerifiedEbayTitle } from "./ebay-verified-title-strategy.ts"

test("a verified pack is expressed exactly once in the title", () => {
  assert.equal(
    buildVerifiedEbayTitle({
      productTitle:
        "2-Pack 2 Pack Large Non-Stick Reusable Oven Bottom Liners for Gas & Electric",
      packCount: 2,
    }),
    "2-Pack Large Non-Stick Reusable Oven Bottom Liners for Gas & Electric",
  )
  assert.equal(
    buildVerifiedEbayTitle({
      productTitle: "2 Pack Large Non-Stick Reusable Oven Bottom Liners",
      packCount: 2,
    }),
    "2-Pack Large Non-Stick Reusable Oven Bottom Liners",
  )
})

test("the title uses offer pack count rather than total units per offer", () => {
  const title = buildVerifiedEbayTitle({
    productTitle: "Disinfecting Wipes Lemon 15 Count",
    packCount: 3,
  })
  assert.match(title, /^3-Pack\b/)
  assert.doesNotMatch(title, /^45-Pack\b/)
})

test("a verified single offer does not turn its unit count into a pack claim", () => {
  const title = buildVerifiedEbayTitle({
    productTitle: "Disinfecting Wipes Lemon 15 Count",
    packCount: 1,
  })
  assert.equal(title, "Disinfecting Wipes Lemon 15 Count")
  assert.doesNotMatch(title, /15-Pack/)
})
