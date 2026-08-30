import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier ?? "")
    if (value === "server-only") {
      return { url: "data:text/javascript,export default {}", shortCircuit: true }
    }
    if (value.startsWith(".") &&
        !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
      return nextResolve(`${value}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const {
  buildEbaySellerOAuthReauthPurposeAuthorizationUrl,
  createEbaySellerOAuthReauthCookie,
  EBAY_MARKETING_READONLY_OAUTH_COOKIE,
  EBAY_MARKETING_READONLY_OAUTH_SCOPES,
  renderEbaySellerOAuthReauthSuccessHtml,
  verifyEbaySellerOAuthReauthCookie,
} = await import("./ebay-seller-oauth-reauth-domain.ts")
const {
  certifyEbayMarketingReadonlyOAuthStart,
  claimAndVerifyEbayMarketingReadonlyOAuth,
  verifyEbayMarketingReadonlyOAuthCandidate,
} = await import("./ebay-marketing-readonly-oauth-ceremony-v1.ts")
const {
  ebayProductionAccountFingerprint,
} = await import("./ebay-seller-account-scope.ts")
const {
  readEbayPromotionStateReadonlyV1,
} = await import("./ebay-marketing-promotion-readonly-v1.ts")

const STATE = "S".repeat(43)
const USER_ID = "canonical-seller"
const configuration = {
  ready: true,
  reason: null,
  clientId: "client-id",
  clientSecret: "client-secret",
  runame: "dedicated-preprod-runame",
  branchHost: "imnova-seller-os-preprod.vercel.app",
  callbackUrl:
    "https://imnova-seller-os-preprod.vercel.app/api/admin/ebay/monitor/seller-oauth-reauth",
  expectedUserId: USER_ID,
  expectedAccountFingerprint: ebayProductionAccountFingerprint(USER_ID),
}

test("Marketing readonly consent uses the exact bounded scope contract", () => {
  const authorizationUrl = buildEbaySellerOAuthReauthPurposeAuthorizationUrl({
    clientId: configuration.clientId,
    runame: configuration.runame,
    state: STATE,
    purpose: "MARKETING_READONLY",
  })
  const parsed = new URL(authorizationUrl)
  assert.deepEqual(
    parsed.searchParams.get("scope").split(" "),
    [...EBAY_MARKETING_READONLY_OAUTH_SCOPES],
  )
  assert.equal(parsed.searchParams.get("scope").includes("sell.marketing "), false)
  assert.equal(parsed.searchParams.get("scope").includes("sell.inventory"), false)
  assert.equal(parsed.searchParams.get("scope").includes("sell.fulfillment"), false)
  assert.deepEqual(certifyEbayMarketingReadonlyOAuthStart({
    authorizationUrl,
    purpose: "MARKETING_READONLY",
    targetSecretSlot: "EBAY_MARKETING_READONLY_REFRESH_TOKEN",
  }), {
    OAUTH_PURPOSE: "MARKETING_READONLY",
    REQUESTED_SCOPE_SET_CLASS: "MARKETING_READONLY_EXACT",
    BASE_SCOPE_PRESENT: true,
    SELL_MARKETING_READONLY_PRESENT: true,
    SELL_MARKETING_WRITE_PRESENT: false,
    TARGET_SECRET_SLOT: "EBAY_MARKETING_READONLY_REFRESH_TOKEN",
    OAUTH_START_ALLOWED: true,
  })
})

test("Marketing preflight rejects Seller general purpose before redirect", () => {
  const authorizationUrl = buildEbaySellerOAuthReauthPurposeAuthorizationUrl({
    clientId: configuration.clientId,
    runame: configuration.runame,
    state: STATE,
    purpose: "SELLER_GENERAL",
  })
  const certification = certifyEbayMarketingReadonlyOAuthStart({
    authorizationUrl,
    purpose: "SELLER_GENERAL",
    targetSecretSlot: "EBAY_SELLER_REFRESH_TOKEN",
  })
  assert.equal(certification.OAUTH_PURPOSE, "INVALID")
  assert.equal(certification.REQUESTED_SCOPE_SET_CLASS, "INVALID")
  assert.equal(certification.SELL_MARKETING_READONLY_PRESENT, false)
  assert.equal(certification.SELL_MARKETING_WRITE_PRESENT, false)
  assert.equal(certification.TARGET_SECRET_SLOT, "INVALID")
  assert.equal(certification.OAUTH_START_ALLOWED, false)
})

test("Marketing callback handoff renders only the dedicated purpose and slot", () => {
  const html = renderEbaySellerOAuthReauthSuccessHtml(
    "dedicated-marketing-refresh-token",
    "n".repeat(24),
    "EBAY_MARKETING_READONLY_REFRESH_TOKEN",
  )
  assert.match(html, /OAuth purpose: MARKETING_READONLY/)
  assert.match(html, /como EBAY_MARKETING_READONLY_REFRESH_TOKEN/)
  assert.doesNotMatch(html, /como EBAY_SELLER_REFRESH_TOKEN/)
})

test("signed callback cookie binds Marketing purpose without changing protocol", () => {
  const now = Date.now()
  const cookie = createEbaySellerOAuthReauthCookie({
    state: STATE,
    expiresAt: now + 60_000,
    actorUserId: "550e8400-e29b-41d4-a716-446655440000",
    branchHost: configuration.branchHost,
    clientSecret: configuration.clientSecret,
    expectedAccountFingerprint: configuration.expectedAccountFingerprint,
    purpose: "MARKETING_READONLY",
  })
  const verified = verifyEbaySellerOAuthReauthCookie({
    cookie,
    state: STATE,
    now,
    branchHost: configuration.branchHost,
    clientSecret: configuration.clientSecret,
    expectedAccountFingerprint: configuration.expectedAccountFingerprint,
    expectedPurpose: "MARKETING_READONLY",
  })
  assert.equal(verified.purpose, "MARKETING_READONLY")
  assert.throws(() => verifyEbaySellerOAuthReauthCookie({
    cookie: cookie.replace(/.$/, cookie.endsWith("a") ? "b" : "a"),
    state: STATE,
    now,
    branchHost: configuration.branchHost,
    clientSecret: configuration.clientSecret,
    expectedAccountFingerprint: configuration.expectedAccountFingerprint,
    expectedPurpose: "MARKETING_READONLY",
  }))

  const sellerCookie = createEbaySellerOAuthReauthCookie({
    state: STATE,
    expiresAt: now + 60_000,
    actorUserId: "550e8400-e29b-41d4-a716-446655440000",
    branchHost: configuration.branchHost,
    clientSecret: configuration.clientSecret,
    expectedAccountFingerprint: configuration.expectedAccountFingerprint,
    purpose: "SELLER_GENERAL",
  })
  const verifiedSeller = verifyEbaySellerOAuthReauthCookie({
    cookie: sellerCookie,
    state: STATE,
    now,
    branchHost: configuration.branchHost,
    clientSecret: configuration.clientSecret,
    expectedAccountFingerprint: configuration.expectedAccountFingerprint,
    expectedPurpose: "SELLER_GENERAL",
  })
  assert.equal(verifiedSeller.purpose, "SELLER_GENERAL")
  assert.throws(() => verifyEbaySellerOAuthReauthCookie({
    cookie: sellerCookie,
    state: STATE,
    now,
    branchHost: configuration.branchHost,
    clientSecret: configuration.clientSecret,
    expectedAccountFingerprint: configuration.expectedAccountFingerprint,
    expectedPurpose: "MARKETING_READONLY",
  }), /EBAY_SELLER_OAUTH_REAUTH_PURPOSE_INVALID/)
})

test("candidate is handed off only after exact scope, account and Marketing smoke", async () => {
  const calls = []
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input))
    calls.push({ url, init })
    if (url.pathname === "/identity/v1/oauth2/token") {
      const body = init.body
      assert.ok(body instanceof URLSearchParams)
      if (body.get("grant_type") === "authorization_code") {
        return Response.json({
          access_token: "initial-access",
          refresh_token: "dedicated-refresh",
          expires_in: 7200,
          scope: EBAY_MARKETING_READONLY_OAUTH_SCOPES.join(" "),
        })
      }
      assert.equal(
        body.get("scope"),
        EBAY_MARKETING_READONLY_OAUTH_SCOPES.join(" "),
      )
      return Response.json({
        access_token: "marketing-access",
        expires_in: 7200,
        scope: EBAY_MARKETING_READONLY_OAUTH_SCOPES.join(" "),
      })
    }
    if (url.pathname === "/ws/api.dll") {
      return new Response(
        `<GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents">` +
          `<Ack>Success</Ack><User><UserID>${USER_ID}</UserID>` +
          `<Site>US</Site></User></GetUserResponse>`,
        { status: 200, headers: { "Content-Type": "text/xml" } },
      )
    }
    assert.equal(
      url.pathname,
      "/sell/marketing/v1/ad_campaign/find_campaign_by_ad_reference",
    )
    assert.equal(url.searchParams.get("listing_id"), "366582586826")
    assert.equal(init.method, "GET")
    return Response.json({ campaigns: [] })
  }
  const result = await verifyEbayMarketingReadonlyOAuthCandidate({
    authorizationCode: "one-time-code",
    configuration,
    fetchImpl,
  })
  assert.equal(result.targetSecretSlot, "EBAY_MARKETING_READONLY_REFRESH_TOKEN")
  assert.equal(result.marketingOAuthScopeProven, true)
  assert.equal(result.findCampaignByAdReferenceAuthorized, true)
  assert.equal(result.accountIdentityMatch, true)
  assert.equal(result.marketplaceWrites, 0)
  assert.equal(calls.length, 4)
})

test("Marketing callback state is one-shot and replay is rejected", async () => {
  let available = true
  const ledger = {
    async createPending() { return true },
    async claimPending() {
      if (!available) return false
      available = false
      return true
    },
  }
  const first = await claimAndVerifyEbayMarketingReadonlyOAuth({
    callback: { kind: "DENIED", state: STATE },
    stateHash: "a".repeat(64),
    ledger,
    configuration,
  })
  assert.equal(first.kind, "DENIED")
  assert.equal(first.claimSucceeded, true)
  assert.equal(first.code, "EBAY_MARKETING_READONLY_OAUTH_CONSENT_DENIED")
  const replay = await claimAndVerifyEbayMarketingReadonlyOAuth({
    callback: { kind: "DENIED", state: STATE },
    stateHash: "a".repeat(64),
    ledger,
    configuration,
  })
  assert.equal(replay.kind, "DENIED")
  assert.equal(replay.claimSucceeded, false)
  assert.equal(replay.code, "EBAY_SELLER_OAUTH_REAUTH_STATE_NOT_CLAIMED")
})

test("Marketing consumer fails closed without its dedicated token", async () => {
  const previous = process.env.EBAY_MARKETING_READONLY_REFRESH_TOKEN
  const generic = process.env.EBAY_SELLER_REFRESH_TOKEN
  delete process.env.EBAY_MARKETING_READONLY_REFRESH_TOKEN
  process.env.EBAY_SELLER_REFRESH_TOKEN = "generic-must-not-be-used"
  let fetchCalls = 0
  try {
    await assert.rejects(
      readEbayPromotionStateReadonlyV1("366582586826", async () => {
        fetchCalls += 1
        throw new Error("FETCH_MUST_NOT_RUN")
      }),
      /MARKETING_READONLY_OAUTH_REQUIRED/,
    )
    assert.equal(fetchCalls, 0)
  } finally {
    if (previous === undefined) {
      delete process.env.EBAY_MARKETING_READONLY_REFRESH_TOKEN
    } else {
      process.env.EBAY_MARKETING_READONLY_REFRESH_TOKEN = previous
    }
    if (generic === undefined) delete process.env.EBAY_SELLER_REFRESH_TOKEN
    else process.env.EBAY_SELLER_REFRESH_TOKEN = generic
  }
})

test("route and UI isolate dedicated slot and retain one-shot claim", async () => {
  const [route, page, consumer] = await Promise.all([
    readFile(new URL(
      "../../app/api/admin/ebay/monitor/seller-oauth-reauth/route.ts",
      import.meta.url,
    ), "utf8"),
    readFile(new URL(
      "../../app/admin/ebay/monitor/seller-oauth-reauth/page.tsx",
      import.meta.url,
    ), "utf8"),
    readFile(new URL(
      "./ebay-marketing-promotion-readonly-v1.ts",
      import.meta.url,
    ), "utf8"),
  ])
  assert.match(route, /action === "start_marketing_readonly"/)
  assert.match(route, /transaction\.purpose === "MARKETING_READONLY"/)
  assert.match(route, /EBAY_MARKETING_READONLY_OAUTH_COOKIE/)
  assert.match(route, /expectedPurpose: marketingCallback/)
  assert.match(route, /await ledger\.claimPending\(/)
  assert.match(route, /"EBAY_MARKETING_READONLY_REFRESH_TOKEN"/)
  assert.match(page, /data-testid="marketing-readonly-owner-entrypoint"/)
  assert.match(page, /Autorizar Marketing read-only/)
  assert.match(page, /Continuar a eBay con Marketing read-only/)
  assert.match(page, /pendingMarketingReadonlyOAuth\.certification/)
  assert.match(page, /OAUTH_PURPOSE: "MARKETING_READONLY"/)
  assert.match(page,
    /REQUESTED_SCOPE_SET_CLASS: "MARKETING_READONLY_EXACT"/)
  assert.match(page, /SELL_MARKETING_READONLY_PRESENT: true/)
  assert.match(page, /SELL_MARKETING_WRITE_PRESENT: false/)
  assert.match(page,
    /TARGET_SECRET_SLOT: "EBAY_MARKETING_READONLY_REFRESH_TOKEN"/)
  assert.match(page,
    /body: JSON\.stringify\(\{ action: "start_marketing_readonly" \}\)/)
  assert.equal((page.match(/Autorizar Marketing read-only/g) ?? []).length, 1)
  const ownerConfirmation = page.indexOf("checked={confirmed}")
  const marketingEntrypoint = page.indexOf(
    'data-testid="marketing-readonly-owner-entrypoint"',
  )
  const sellerEntrypoint = page.indexOf(
    'data-testid="seller-general-owner-entrypoint"',
  )
  assert.ok(ownerConfirmation >= 0)
  assert.ok(ownerConfirmation < marketingEntrypoint)
  assert.ok(marketingEntrypoint < sellerEntrypoint)
  assert.match(page, /Iniciar consentimiento Seller general una vez/)
  assert.equal(EBAY_MARKETING_READONLY_OAUTH_COOKIE,
    "__Secure-ebay_marketing_readonly_oauth")
  assert.match(route, /startCertification: prepared\.startCertification/)
  assert.match(consumer, /process\.env\.EBAY_MARKETING_READONLY_REFRESH_TOKEN/)
  assert.doesNotMatch(consumer, /process\.env\.EBAY_SELLER_REFRESH_TOKEN/)
})
