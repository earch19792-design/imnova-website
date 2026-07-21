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
    "OFFICIAL_MANUFACTURER_FACTS_V2_2026_07_21")
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

test("Tesla official product family verifies Brand and Type but never invents an MPN", async () => {
  let requested = null
  const result = await fetchOfficialManufacturerFacts({
    productTitle: "Tesla NEMA 14-30 Gen II Mobile Connector Smart Adapter",
    fetchImpl: async (url) => {
      requested = String(url)
      return new Response(`<!doctype html><html><head>
        <script type="application/ld+json">{"@type":"Product","name":"Gen 2 NEMA Adapters","brand":{"@type":"Brand","name":"Tesla"}}</script>
        </head><body><h1>Gen 2 NEMA Adapters</h1><p>NEMA 14-30 adapter for the Mobile Connector.</p></body></html>`, {
        status: 200, headers: { "content-type": "text/html" },
      })
    },
  })
  assert.equal(requested, "https://shop.tesla.com/product/gen-2-nema-adapters?redirect=no")
  assert.equal(result.status, "AVAILABLE")
  assert.deepEqual(result.facts.map((fact) => [fact.key, fact.value]), [
    ["brand", "Tesla"],
    ["exactProductName", "Gen 2 NEMA Adapters"],
    ["type", "NEMA Adapter"],
  ])
  assert.equal(result.facts.some((fact) => fact.key === "mpn"), false)
})

test("Tesla family page contributes no facts when the exact 14-30 variant is absent", async () => {
  const result = await fetchOfficialManufacturerFacts({
    productTitle: "Tesla NEMA 14-30 Gen II Mobile Connector Smart Adapter",
    fetchImpl: async () => new Response("<html><h1>Gen 2 NEMA Adapters</h1><p>NEMA 5-15 adapter.</p></html>", {
      status: 200, headers: { "content-type": "text/html" },
    }),
  })
  assert.equal(result.status, "NO_MATCH")
  assert.deepEqual(result.facts, [])
})

test("Tesla uses only the reviewed narrow fallback when its official edge denies server reads", async () => {
  const result = await fetchOfficialManufacturerFacts({
    productTitle: "Tesla NEMA 14-30 Gen II Mobile Connector Smart Adapter",
    now: new Date("2026-07-21T10:00:00.000Z"),
    fetchImpl: async () => new Response("denied", { status: 403,
      headers: { "content-type": "text/html" } }),
  })
  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.audit.externalPageFetched, false)
  assert.equal(result.audit.reviewedFallbackUsed, true)
  assert.equal(result.audit.identityMatched, true)
  assert.deepEqual(result.facts.map((fact) => [fact.key, fact.value]), [
    ["brand", "Tesla"],
    ["exactProductName", "Gen 2 NEMA Adapters - 14-30"],
    ["type", "NEMA Adapter"],
  ])
  assert.equal(result.facts.some((fact) => fact.key === "mpn"), false)
})
