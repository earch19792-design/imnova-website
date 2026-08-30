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
  new URL("./ebay-seller-account-scope.ts", import.meta.url),
  "utf8",
)
const rateLimitSource = readFileSync(
  new URL("./ebay-readonly-rate-limit.ts", import.meta.url),
  "utf8",
)
const tradingSource = readFileSync(
  new URL("./ebay-manual-listing-trading-readonly.ts", import.meta.url),
  "utf8",
)
  .replace(/import type \{ SafeListingDefaults \} from "\.\/ebay-manual-listing-domain"\n/, "")
  .replace(
    'from "./ebay-seller-account-scope"',
    `from "${moduleUrl(scopeSource)}"`,
  )
  .replace(
    'from "./ebay-readonly-rate-limit"',
    `from "${moduleUrl(rateLimitSource)}"`,
  )
const {
  parseTradingManualListingResponses,
  readManualListingFromTradingApi,
} = await import(moduleUrl(tradingSource))

const itemId = "123456789012"
const getUserXml = `
  <GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents">
    <Ack>Success</Ack>
    <User><UserID>Official_Seller</UserID></User>
  </GetUserResponse>
`

function getItemXml({ seller = "official_seller", status = "Active",
  shipping = "" } = {}) {
  return `
    <GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
      <Ack>Success</Ack>
      <Item>
        <ItemID>${itemId}</ItemID>
        <Title>Listing propio seguro</Title>
        <Description>Claim no autorizado</Description>
        <PictureDetails><PictureURL>https://example.invalid/image.jpg</PictureURL></PictureDetails>
        <Seller><UserID>${seller}</UserID></Seller>
        <SellingStatus><ListingStatus>${status}</ListingStatus></SellingStatus>
        <SKU>ITEM5126</SKU>
        <PrimaryCategory><CategoryID>261003</CategoryID></PrimaryCategory>
        <ConditionID>1000</ConditionID>
        ${shipping}
        <SellerProfiles>
          <SellerShippingProfile><ShippingProfileID>111</ShippingProfileID></SellerShippingProfile>
          <SellerPaymentProfile><PaymentProfileID>222</PaymentProfileID></SellerPaymentProfile>
          <SellerReturnProfile><ReturnProfileID>333</ReturnProfileID></SellerReturnProfile>
        </SellerProfiles>
        <ItemSpecifics><NameValueList><Name>Brand</Name><Value>Competitor</Value></NameValueList></ItemSpecifics>
      </Item>
    </GetItemResponse>
  `
}

test("verifica el seller autenticado y extrae sólo campos operativos seguros", () => {
  const result = parseTradingManualListingResponses(
    getUserXml,
    getItemXml(),
    itemId,
    new Date("2026-07-13T12:00:00.000Z"),
  )
  assert.equal(result.ownership, "verified")
  assert.equal(result.ebaySku, "ITEM5126")
  assert.deepEqual(result.safeDefaults, {
    fulfillmentPolicyId: "111",
    paymentPolicyId: "222",
    returnPolicyId: "333",
    categoryId: "261003",
    conditionId: "1000",
  })
  assert.equal(result.title, "Listing propio seguro")
  assert.equal(result.availableQuantity, null)
  assert.equal(result.price, null)
  assert.equal(result.currency, null)
  assert.equal(result.buyerShippingChargeStatus, "UNPROVEN")
  assert.equal(result.buyerShippingCharge, null)
  assert.equal("description" in result, false)
  assert.equal("images" in result, false)
  assert.equal("aspectValues" in result, false)
})

test("GetItem proves the cheapest domestic buyer shipping charge without using international options", () => {
  const result = parseTradingManualListingResponses(
    getUserXml,
    getItemXml({ shipping: `
      <Currency>USD</Currency>
      <ShippingDetails>
        <ShippingType>Flat</ShippingType>
        <ShippingServiceOptions>
          <ShippingService>UPSGround</ShippingService>
          <ShippingServiceCost>12.50</ShippingServiceCost>
        </ShippingServiceOptions>
        <ShippingServiceOptions>
          <ShippingService>USPSGroundAdvantage</ShippingService>
          <ShippingServiceCost>0.00</ShippingServiceCost>
          <FreeShipping>true</FreeShipping>
        </ShippingServiceOptions>
        <InternationalShippingServiceOption>
          <ShippingServiceCost>31.00</ShippingServiceCost>
        </InternationalShippingServiceOption>
      </ShippingDetails>` }),
    itemId,
  )
  assert.equal(result.buyerShippingChargeStatus, "AVAILABLE")
  assert.equal(result.buyerShippingCharge, 0)
  assert.equal(result.buyerShippingCurrency, "USD")
  assert.equal(result.buyerShippingChargeBasis, "CHEAPEST_DOMESTIC_OPTION")
  assert.equal(result.shippingType, "Flat")
})

test("un seller distinto nunca queda verificado", () => {
  const result = parseTradingManualListingResponses(
    getUserXml,
    getItemXml({ seller: "another_seller" }),
    itemId,
  )
  assert.equal(result.ownership, "not_owned")
})

test("un token de otra cuenta no satisface la identidad oficial esperada", () => {
  const result = parseTradingManualListingResponses(
    getUserXml,
    getItemXml(),
    itemId,
    new Date(),
    "Expected_Official_Account",
  )
  assert.equal(result.ownership, "identity_mismatch")
})

test("un listing propio terminado no activa automatización", () => {
  const result = parseTradingManualListingResponses(
    getUserXml,
    getItemXml({ status: "Completed" }),
    itemId,
  )
  assert.equal(result.ownership, "inactive")
})

test("evidencia incompleta falla cerrado", () => {
  assert.throws(
    () => parseTradingManualListingResponses(
      "<GetUserResponse><Ack>Success</Ack></GetUserResponse>",
      getItemXml(),
      itemId,
    ),
    /EBAY_TRADING_OWNERSHIP_EVIDENCE_INCOMPLETE/,
  )
})

test("el conector ejecuta exclusivamente OAuth, GetUser y GetItem", async () => {
  const previous = {
    clientId: process.env.EBAY_CLIENT_ID,
    clientSecret: process.env.EBAY_CLIENT_SECRET,
    refreshToken: process.env.EBAY_SELLER_REFRESH_TOKEN,
    expectedUserId: process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID,
    expectedFingerprint:
      process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT,
  }
  process.env.EBAY_CLIENT_ID = "client-id"
  process.env.EBAY_CLIENT_SECRET = "client-secret"
  process.env.EBAY_SELLER_REFRESH_TOKEN = "refresh-token"
  process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID = "Official_Seller"
  delete process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT
  const calls = []
  const fakeFetch = async (input, init = {}) => {
    const url = new URL(input)
    calls.push({ url, init })
    if (url.pathname === "/identity/v1/oauth2/token") {
      return new Response(JSON.stringify({
        access_token: "short-lived-access-token",
        expires_in: 7200,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    const callName = init.headers["X-EBAY-API-CALL-NAME"]
    return new Response(
      callName === "GetUser" ? getUserXml : getItemXml(),
      { status: 200, headers: { "Content-Type": "text/xml" } },
    )
  }

  try {
    const result = await readManualListingFromTradingApi(itemId, fakeFetch)
    assert.equal(result.ownership, "verified")
    const tradingCalls = calls.filter(
      (call) => call.url.pathname === "/ws/api.dll",
    )
    assert.deepEqual(
      tradingCalls.map((call) => call.init.headers["X-EBAY-API-CALL-NAME"]).sort(),
      ["GetItem", "GetUser"],
    )
    assert.equal(
      tradingCalls.some((call) => /Add|Revise|Relist|EndItem/.test(
        call.init.headers["X-EBAY-API-CALL-NAME"],
      )),
      false,
    )
    const getItemCall = tradingCalls.find(
      (call) => call.init.headers["X-EBAY-API-CALL-NAME"] === "GetItem",
    )
    assert.match(getItemCall.init.body, /<OutputSelector>Item\.Seller\.UserID<\/OutputSelector>/)
    assert.match(getItemCall.init.body, /<OutputSelector>Item\.PrimaryCategory\.CategoryID<\/OutputSelector>/)
    assert.match(getItemCall.init.body, /Item\.SellerProfiles\.SellerShippingProfile\.ShippingProfileID/)
    assert.match(getItemCall.init.body, /Item\.SellerProfiles\.SellerPaymentProfile\.PaymentProfileID/)
    assert.match(getItemCall.init.body, /Item\.SellerProfiles\.SellerReturnProfile\.ReturnProfileID/)
    assert.match(getItemCall.init.body, /Item\.ShippingDetails\.ShippingServiceOptions\.ShippingServiceCost/)
    assert.match(getItemCall.init.body, /Item\.ShippingDetails\.ShippingServiceOptions\.FreeShipping/)
    assert.doesNotMatch(
      getItemCall.init.body,
      /Description|PictureURL|ItemSpecifics/,
    )
    assert.equal(JSON.stringify(result).includes("short-lived-access-token"), false)
  } finally {
    if (previous.clientId === undefined) delete process.env.EBAY_CLIENT_ID
    else process.env.EBAY_CLIENT_ID = previous.clientId
    if (previous.clientSecret === undefined) delete process.env.EBAY_CLIENT_SECRET
    else process.env.EBAY_CLIENT_SECRET = previous.clientSecret
    if (previous.refreshToken === undefined) delete process.env.EBAY_SELLER_REFRESH_TOKEN
    else process.env.EBAY_SELLER_REFRESH_TOKEN = previous.refreshToken
    if (previous.expectedUserId === undefined) {
      delete process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID
    } else {
      process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID = previous.expectedUserId
    }
    if (previous.expectedFingerprint === undefined) {
      delete process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT
    } else {
      process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT =
        previous.expectedFingerprint
    }
  }
})
