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

const environmentSource = readFileSync(
  new URL("./environment-boundaries.ts", import.meta.url),
  "utf8",
)
const sellerScopeSource = readFileSync(
  new URL("./ebay-seller-account-scope.ts", import.meta.url),
  "utf8",
)
const policySource = readFileSync(
  new URL("./ebay-production-capability-policy.ts", import.meta.url),
  "utf8",
).replace(
  'from "./environment-boundaries"',
  `from "${moduleUrl(environmentSource)}"`,
)
const tradingXmlStub = moduleUrl(`
  export function tradingXmlContainer(xml, tag) {
    return xml.match(new RegExp("<" + tag + "(?:\\\\s[^>]*)?>([\\\\s\\\\S]*?)<\\\\/" + tag + ">", "i"))?.[1] ?? ""
  }
  export function tradingXmlTagValue(xml, tag) {
    return tradingXmlContainer(xml, tag).replace(/<[^>]*>/g, " ").replace(/\\\\s+/g, " ").trim() || null
  }
`)
const writeProviderSource = readFileSync(
  new URL("./ebay-write-credential-provider.ts", import.meta.url),
  "utf8",
)
  .replace(
    'from "./ebay-production-capability-policy"',
    `from "${moduleUrl(policySource)}"`,
  )
  .replace(
    'from "./ebay-manual-listing-trading-readonly"',
    `from "${tradingXmlStub}"`,
  )
  .replace(
    'from "./ebay-seller-account-scope"',
    `from "${moduleUrl(sellerScopeSource)}"`,
  )
const {
  assertEbayProductionCapability,
} = await import(moduleUrl(policySource))
const {
  ebayProductionAccountFingerprint,
} = await import(moduleUrl(sellerScopeSource))
const {
  getEbayWriteCredential,
  useEbayWriteCredential,
} = await import(moduleUrl(writeProviderSource))

test("a read credential shape is rejected by the write gateway", () => {
  const readCredential = {
    purpose: "trading.active_listing.readback",
    scopes: ["https://api.ebay.com/oauth/api_scope"],
  }
  assert.throws(
    () => useEbayWriteCredential(
      readCredential,
      "active_title.apply",
      "imnova-ebay-us",
    ),
    /EBAY_WRITE_CREDENTIAL_PURPOSE_MISMATCH/,
  )
})

test("write provider uses separate configuration and never imports the readonly token", () => {
  const source = writeProviderSource
  assert.match(source, /EBAY_WRITE_CLIENT_ID/)
  assert.match(source, /EBAY_WRITE_CLIENT_SECRET/)
  assert.match(source, /EBAY_WRITE_SELLER_REFRESH_TOKEN/)
  assert.doesNotMatch(source, /getEbayTradingReadOnlyAccessToken/)
  assert.match(source, /X-EBAY-API-CALL-NAME": "GetUser"/)
  assert.match(source, /EBAY_WRITE_CREDENTIAL_ACCOUNT_MISMATCH/)
  assert.match(source, /\$\{grant\.accountKey\}:\$\{capability\}/)
})

test("write credential binds an injected OAuth adapter to the official account", async () => {
  const previous = {
    clientId: process.env.EBAY_WRITE_CLIENT_ID,
    clientSecret: process.env.EBAY_WRITE_CLIENT_SECRET,
    refreshToken: process.env.EBAY_WRITE_SELLER_REFRESH_TOKEN,
    accountAlias: process.env.EBAY_SELLER_ACCOUNT_KEY,
    expectedUserId: process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID,
    expectedFingerprint:
      process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT,
  }
  const userId = "Official_Seller"
  const fingerprint = ebayProductionAccountFingerprint(userId)
  const accountKey = `imnova-ebay-us:${fingerprint}`
  process.env.EBAY_WRITE_CLIENT_ID = "write-client"
  process.env.EBAY_WRITE_CLIENT_SECRET = "write-secret"
  process.env.EBAY_WRITE_SELLER_REFRESH_TOKEN = "write-refresh"
  process.env.EBAY_SELLER_ACCOUNT_KEY = "imnova-ebay-us"
  process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID = userId
  process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT =
    fingerprint
  const now = new Date()
  const common = {
    capability: "active_title.apply",
    invocation: "interactive",
    authenticationMode: "admin_user",
    userId: "123e4567-e89b-42d3-a456-426614174000",
    accountKey,
    marketplace: "EBAY_US",
    resourceKey: "123456789012",
    idempotencyKey: "title:123456789012:v1",
    policyVersion: "EBAY_ACTIVE_LISTING_TITLE_REVISION_POLICY_V1",
    confirmedHumanAction: true,
  }
  const environment = { vercelEnv: "preview", now }
  const routeGrant = assertEbayProductionCapability(
    { ...common, stage: "route" },
    undefined,
    environment,
  )
  const serviceGrant = assertEbayProductionCapability(
    { ...common, stage: "service" },
    routeGrant,
    environment,
  )
  const effectGrant = assertEbayProductionCapability(
    {
      ...common,
      stage: "effect",
      proposalHash: "a".repeat(64),
      preflightPassed: true,
      preflightObservedAt: now.toISOString(),
    },
    serviceGrant,
    environment,
  )
  const calls = []
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input)
    calls.push({ url: url.pathname, call: init.headers?.["X-EBAY-API-CALL-NAME"] })
    if (url.pathname === "/identity/v1/oauth2/token") {
      const oauthBody = new URLSearchParams(init.body)
      assert.equal(
        oauthBody.get("scope"),
        "https://api.ebay.com/oauth/api_scope",
      )
      assert.doesNotMatch(oauthBody.get("scope"), /imnova|active_title/)
      return new Response(JSON.stringify({
        access_token: "write-access-token",
        expires_in: 7_200,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    return new Response(
      "<GetUserResponse><Ack>Success</Ack>" +
      `<User><UserID>${userId}</UserID></User></GetUserResponse>`,
      { status: 200, headers: { "Content-Type": "text/xml" } },
    )
  }
  try {
    const credential = await getEbayWriteCredential(
      "active_title.apply",
      effectGrant,
      fetchImpl,
    )
    assert.equal(credential.accountKey, accountKey)
    assert.equal(credential.accountFingerprint, fingerprint)
    assert.equal(
      useEbayWriteCredential(credential, "active_title.apply", accountKey),
      "write-access-token",
    )
    assert.deepEqual(calls, [
      { url: "/identity/v1/oauth2/token", call: undefined },
      { url: "/ws/api.dll", call: "GetUser" },
    ])
  } finally {
    for (const [key, value] of Object.entries({
      EBAY_WRITE_CLIENT_ID: previous.clientId,
      EBAY_WRITE_CLIENT_SECRET: previous.clientSecret,
      EBAY_WRITE_SELLER_REFRESH_TOKEN: previous.refreshToken,
      EBAY_SELLER_ACCOUNT_KEY: previous.accountAlias,
      EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: previous.expectedUserId,
      EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT:
        previous.expectedFingerprint,
    })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test("active title and image effects consume exact-purpose write credentials", () => {
  const title = readFileSync(
    new URL("./ebay-active-listing-title-revision-service.ts", import.meta.url),
    "utf8",
  )
  const images = readFileSync(
    new URL("./ebay-active-listing-image-revision-service.ts", import.meta.url),
    "utf8",
  )
  assert.match(title, /getEbayWriteCredential\(\s*"active_title\.apply"/)
  assert.match(images, /getEbayWriteCredential\(\s*"active_images\.apply"/)
  assert.doesNotMatch(title, /getEbayTradingReadOnlyAccessToken/)
  assert.doesNotMatch(images, /getEbayTradingReadOnlyAccessToken/)
})
