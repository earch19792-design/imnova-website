import assert from "node:assert/strict"
import test from "node:test"

import {
  OFFICIAL_MANUFACTURER_FACTS_ADAPTER_VERSION,
  fetchOfficialManufacturerFacts,
} from "./ebay-official-manufacturer-facts.ts"

const officialHtml = `<!doctype html><html><head>
  <script type="application/ld+json">{"@type":"Product","name":"Paper Snack & Sandwich Bags","brand":{"@type":"Brand","name":"If You Care"}}</script>
  </head><body><h1>Paper Snack &amp; Sandwich Bags</h1>
  <p>Made in Sweden from unbleached pulp of Scandinavian spruce trees.</p></body></html>`

test("official manufacturer adapter uses one closed exact source and returns structured facts only", async () => {
  let requested = null
  const result = await fetchOfficialManufacturerFacts({
    productTitle: "If You Care Paper Snack and Sandwich Bags",
    now: new Date("2026-07-19T12:00:00.000Z"),
    fetchImpl: async (url, options) => {
      requested = { url: String(url), options }
      return new Response(officialHtml, { status: 200,
        headers: { "content-type": "text/html; charset=utf-8" } })
    },
  })
  assert.equal(OFFICIAL_MANUFACTURER_FACTS_ADAPTER_VERSION,
    "OFFICIAL_MANUFACTURER_FACTS_V1_2026_07_19")
  assert.equal(requested.url, "https://ifyoucare.com/products/sandwich-bags-fcs-certified")
  assert.equal(requested.options.redirect, "manual")
  assert.equal(requested.options.credentials, "omit")
  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.audit.identityMatched, true)
  assert.equal(result.audit.rawHtmlStored, false)
  assert.equal(result.audit.sourceUrlStored, false)
  assert.match(result.sourceReference, /^MANUFACTURER_OFFICIAL_PUBLIC:sha256:[0-9a-f]{24}$/)
  assert.deepEqual(result.facts.map((fact) => [fact.key, fact.value]), [
    ["brand", "If You Care"],
    ["exactProductName", "Paper Snack & Sandwich Bags"],
    ["countryOfManufacture", "Sweden"],
    ["material", "Unbleached paper"],
  ])
  assert.equal("url" in result, false)
  assert.equal("html" in result, false)
})
test("generic unbranded products never trigger an external request", async () => {
  let calls = 0
  const result = await fetchOfficialManufacturerFacts({
    productTitle: "Food Scale with Nutritional Calculator",
    fetchImpl: async () => { calls += 1; throw new Error("unexpected") },
  })
  assert.equal(calls, 0)
  assert.equal(result.status, "NOT_ALLOWLISTED")
  assert.deepEqual(result.facts, [])
})

test("an allowlisted page with a different product identity contributes no facts", async () => {
  const result = await fetchOfficialManufacturerFacts({
    productTitle: "If You Care Paper Snack and Sandwich Bags",
    fetchImpl: async () => new Response("<html><h1>Recycled Aluminum Foil</h1></html>", {
      status: 200, headers: { "content-type": "text/html" },
    }),
  })
  assert.equal(result.status, "NO_MATCH")
  assert.deepEqual(result.facts, [])
})
