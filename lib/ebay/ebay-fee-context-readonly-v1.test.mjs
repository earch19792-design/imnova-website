import assert from "node:assert/strict"
import test from "node:test"
import { projectEbayFeePerformanceV1, feeContextSafeErrorV1, resolveEbayFeeStoreContextV1 } from "./ebay-fee-context-domain-v1.ts"
import { readEbayFeePerformanceReadonlyV1 } from "./ebay-seller-analytics-readonly-gateway.ts"

const cycle = { cycleType: "CURRENT", evaluationDate: "2026-08-20T07:00:00Z", evaluationMonth: "2026-08" }
const standards = { cycle, program: "PROGRAM_US", standardsLevel: "ABOVE_STANDARD" }
const service = { evaluationCycle: { evaluationType: "CURRENT", evaluationDate: cycle.evaluationDate },
  marketplaceId: "EBAY_US", dimensionMetrics: [{ dimension: { dimensionKey: "LISTING_CATEGORY", value: "281" },
    metrics: [{ metricKey: "RATE", benchmark: { basis: "PEER_BENCHMARK", rating: "NOT_APPLICABLE" } }] }] }

test("official standards schema uses cycle and keeps projected or foreign evaluations unproven", () => {
  assert.equal(projectEbayFeePerformanceV1("STANDARDS", standards).standardsLevel, "ABOVE_STANDARD")
  for (const data of [{ ...standards, cycle: { ...cycle, cycleType: "PROJECTED" } },
    { ...standards, program: "PROGRAM_UK" }, {}, { ...standards, cycle: {} }]) {
    assert.equal(projectEbayFeePerformanceV1("STANDARDS", data).status, "UNPROVEN")
  }
})
test("service rating preserves explicit not applicable but does not resolve a leaf category arbitrarily", () => {
  const result = projectEbayFeePerformanceV1("SERVICE", service)
  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.categories[0].rating, "NOT_APPLICABLE")
  assert.equal(result.listingCategoryApplicability, "UNRESOLVED")
  assert.equal(projectEbayFeePerformanceV1("SERVICE", { ...service, dimensionMetrics: [] }).status, "UNPROVEN")
  assert.equal(projectEbayFeePerformanceV1("SERVICE", { ...service, marketplaceId: "EBAY_GB" }).status, "UNPROVEN")
})
test("fee projections exclude personal payload and arbitrary error text", () => {
  assert.equal(JSON.stringify(projectEbayFeePerformanceV1("STANDARDS", { ...standards, email: "private@example.invalid" })).includes("private@"), false)
  assert.equal(feeContextSafeErrorV1(new Error("token=private")), "EBAY_FEE_CONTEXT_READ_UNAVAILABLE")
})

test("account fee reads use fixed GETs with verified identity and never turn 204 or 429 into zero fees", async () => {
  const originalFetch = globalThis.fetch
  const keys = ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_SELLER_REFRESH_TOKEN", "EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID",
    "EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT", "EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT"]
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  for (const key of keys) delete process.env[key]
  Object.assign(process.env, { EBAY_CLIENT_ID: "fixture", EBAY_CLIENT_SECRET: "fixture", EBAY_SELLER_REFRESH_TOKEN: "fixture",
    EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: "fixture-seller" })
  const requests = []
  try {
    for (const status of [200, 204, 429]) {
      requests.length = 0
      globalThis.fetch = async (url, init) => {
        requests.push({ url: String(url), method: init.method })
        if (String(url).endsWith("/oauth2/token")) return Response.json({ access_token: "fixture-only" })
        if (String(url).endsWith("/ws/api.dll") && init.headers["X-EBAY-API-CALL-NAME"] === "GetAccount") {
          assert.ok(init.body.startsWith('<?xml version="1.0" encoding="utf-8"?>'))
          assert.match(init.body, /<EntriesPerPage>20<\/EntriesPerPage>/)
          assert.match(init.body, /<ExcludeBalance>true<\/ExcludeBalance>/)
          return new Response('<GetAccountResponse><Ack>Success</Ack><Currency>USD</Currency><AccountEntries><AccountEntry><AccountDetailsEntryType>FeeFinalValue</AccountDetailsEntryType><GrossDetailAmount currencyID="USD">3.1</GrossDetailAmount><VATPercent>0</VATPercent><Memo>private text</Memo></AccountEntry></AccountEntries></GetAccountResponse>')
        }
        if (String(url).endsWith("/ws/api.dll")) {
          assert.equal(init.headers["X-EBAY-API-CALL-NAME"], "GetUser")
          assert.match(init.body, /User.RegistrationAddress.Country/)
          return new Response("<GetUserResponse><Ack>Success</Ack><User><UserID>fixture-seller</UserID><RegistrationAddress><Country>US</Country><StateOrProvince>FL</StateOrProvince></RegistrationAddress><SellerInfo><StoreOwner>false</StoreOwner></SellerInfo><VATStatus>NoVATTax</VATStatus></User></GetUserResponse>")
        }
        assert.equal(init.method, "GET")
        assert.match(String(url), /^https:\/\/api.ebay.com\/sell\/analytics\/v1\/(seller_standards_profile|customer_service_metric)\//)
        if (status === 204) return new Response(null, { status })
        if (status === 429) return Response.json({ errors: [{ message: "sensitive upstream text" }] }, { status })
        return Response.json(String(url).includes("seller_standards_profile") ? standards : service)
      }
      const result = await readEbayFeePerformanceReadonlyV1()
      assert.equal(requests.length, 5)
      assert.equal(result.registrationCountry, "US")
      assert.equal(result.registrationState, "FL")
      assert.equal(result.storeOwner, false)
      assert.equal(result.vatStatus, "NoVATTax")
      assert.equal(result.invoice.entries[0].grossAmount, 3.1)
      assert.equal(result.invoice.entries[0].netAmount, null)
      assert.equal(result.invoice.currentPreSaleAuthority, false)
      assert.equal(JSON.stringify(result).includes("private text"), false)
      assert.equal(result.standards.httpStatus, status)
      assert.equal(result.standards.status, status === 200 ? "AVAILABLE" : "UNPROVEN")
      assert.equal(JSON.stringify(result).includes("fixture-only"), false)
      assert.equal(JSON.stringify(result).includes("sensitive"), false)
    }
    requests.length = 0
    globalThis.fetch = async (url) => {
      requests.push(String(url))
      return String(url).endsWith("/oauth2/token") ? Response.json({ access_token: "fixture-only" }) :
        new Response("<Ack>Success</Ack><UserID>wrong-seller</UserID><Country>US</Country>")
    }
    await assert.rejects(readEbayFeePerformanceReadonlyV1(), /IDENTITY_MISMATCH/)
    assert.equal(requests.length, 2)
  } finally {
    globalThis.fetch = originalFetch
    for (const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key]
  }
})


test("StoreOwner false independently proves no store; absence, true and conflicts never do", () => {
  const verified = { accountBindingExact: true, storeOwner: false }
  assert.equal(resolveEbayFeeStoreContextV1({status: "UNPROVEN"}, verified).storeSubscriptionLevel, "NO_STORE")
  for (const context of [{}, {accountBindingExact: true}, {accountBindingExact: true, storeOwner: true}, {storeOwner: false}]) {
    assert.equal(resolveEbayFeeStoreContextV1({status: "UNPROVEN"}, context).status, "UNPROVEN")
  }
  assert.equal(resolveEbayFeeStoreContextV1({status: "AVAILABLE", storeSubscriptionLevel: "BASIC"}, verified).errorCode, "EBAY_STORE_CONTEXT_CONFLICT")
})
