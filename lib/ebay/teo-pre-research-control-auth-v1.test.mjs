import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { registerHooks } from "node:module"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const oauth = await import("./teo-pre-research-control-oauth-v1.ts")
const authorization = await import(
  "./teo-pre-research-control-authorization-v1.ts")
const route = readFileSync(
  "app/api/admin/ebay/pre-research-control/capability/route.ts", "utf8")
const consent = readFileSync(
  "app/admin/ebay/pre-research-control/oauth/consent/control-oauth-consent.tsx",
  "utf8")

test("control OAuth configuration is isolated from read-only MCP configuration", () => {
  const config = oauth.loadSellerOsControlOAuthConfigurationV1({
    SELLER_OS_CONTROL_OAUTH_ISSUER: "https://auth.example.test/auth/v1",
    SELLER_OS_CONTROL_OAUTH_RESOURCE:
      "https://seller.example.test/api/seller-os/control/mcp",
  })
  assert.equal(config.resource,
    "https://seller.example.test/api/seller-os/control/mcp")
  assert.equal(config.metadataUrl,
    "https://seller.example.test/.well-known/oauth-protected-resource/api/seller-os/control/mcp")
  assert.equal(oauth.loadSellerOsControlOAuthConfigurationV1({}), null)
})

test("owner consent derives owner/client bindings server-side before service role", () => {
  const post = route.slice(route.indexOf("export async function POST"))
  const requestAt = post.indexOf("parseSellerOsControlAuthorizationRequestV1")
  const authAt = post.indexOf("validateAdminApiRequest(request)")
  const ownerAt = post.indexOf("assertSellerOsOwnerAdminPreResearchV1(auth)")
  const csrfAt = post.indexOf(".consume({")
  const detailsAt = post.indexOf("getAuthorizationDetails:")
  const approveAt = post.indexOf("approveAuthorization:")
  const serviceAt = post.indexOf("persistCapability:")
  assert.ok(requestAt >= 0 && authAt > requestAt && ownerAt > authAt &&
    csrfAt > ownerAt &&
    detailsAt > csrfAt && approveAt > detailsAt && serviceAt > approveAt)
  assert.match(route, /actorUserId: actor\.actorSubject/)
  assert.match(route, /\.auth\.oauth\.getAuthorizationDetails\(/)
  assert.match(route, /\.auth\.oauth\.approveAuthorization\(/)
  assert.match(route, /p_command_client_id: clientId/)
  assert.doesNotMatch(post, /body\.(?:ownerUserId|actorSubject|commandClientId)/)
})

const authorizationId = "oauth-request_AZaz09-._~opaque-token"
const actorUserId = "79bdf9e4-9daa-476b-93f5-a38f39e10ee7"
const validDetails = Object.freeze({
  authorization_id: authorizationId,
  redirect_uri: "https://chatgpt.com/connector/oauth/YZ_2z2gp8NQJ",
  resource: "https://imnova-seller-os-preprod.vercel.app/api/seller-os/control/mcp",
  scope: "openid email offline_access profile",
  client: { id: "9ab58207-f8b2-4c8a-9f10-047efc97b325" },
  user: { id: actorUserId },
})

test("opaque non-UUID authorization IDs and exact request body are accepted", () => {
  assert.equal(authorization.isValidOpaqueAuthorizationId(authorizationId), true)
  assert.deepEqual(
    authorization.parseSellerOsControlAuthorizationRequestV1({
      action: "AUTHORIZE", authorizationId,
    }),
    { authorizationId },
  )
})

test("authorization request validation rejects malformed or expanded bodies", () => {
  const rejected = [
    { action: "AUTHORIZE", authorizationId: "" },
    { action: "AUTHORIZE", authorizationId: 42 },
    { action: "AUTHORIZE", authorizationId: "a".repeat(513) },
    { action: "AUTHORIZE", authorizationId: " leading" },
    { action: "AUTHORIZE", authorizationId: "embedded whitespace" },
    { action: "AUTHORIZE", authorizationId: "control\u007f" },
    { action: "DENY", authorizationId },
    { action: "AUTHORIZE", authorizationId, clientId: "browser-value" },
  ]
  for (const body of rejected) {
    assert.throws(
      () => authorization.parseSellerOsControlAuthorizationRequestV1(body),
      /TEO_CONTROL_AUTHORIZATION_REQUEST_REJECTED/,
    )
  }
})

test("OAuth scopes are compared as an allowlisted set", () => {
  for (const scope of [
    "openid email offline_access profile",
    "profile openid",
    "offline_access profile email openid",
  ]) {
    const result = authorization.validateSellerOsControlAuthorizationDetailsV1({
      details: { ...validDetails, scope }, authorizationId, actorUserId,
    })
    assert.equal(result.clientId, validDetails.client.id)
  }
})

test("OAuth details reject invalid identity, client, redirect, resource, or scopes", () => {
  const rejected = [
    { ...validDetails, authorization_id: "different-request" },
    { ...validDetails, user: { id: "different-owner" } },
    { ...validDetails, client: { id: "different-client" } },
    { ...validDetails, redirect_uri: "https://example.test/callback" },
    { ...validDetails, resource: "https://example.test/mcp" },
    { ...validDetails, scope: "profile email offline_access" },
    { ...validDetails, scope: "openid email offline_access" },
    { ...validDetails, scope: "openid profile unknown" },
  ]
  for (const details of rejected) {
    assert.throws(
      () => authorization.validateSellerOsControlAuthorizationDetailsV1({
        details, authorizationId, actorUserId,
      }),
      /TEO_CONTROL_AUTHORIZATION_BINDING_INVALID/,
    )
  }
})

test("missing or expired authorization fails before approval and persistence", async () => {
  const calls = []
  await assert.rejects(
    authorization.authorizeSellerOsControlConsentV1({
      authorizationId, actorUserId,
    }, {
      async getAuthorizationDetails() {
        calls.push("details")
        throw new Error("TEO_CONTROL_AUTHORIZATION_DETAILS_FAILED")
      },
      async approveAuthorization() { calls.push("approve"); return "unused" },
      async persistCapability() { calls.push("persist"); return "unused" },
    }),
    /TEO_CONTROL_AUTHORIZATION_DETAILS_FAILED/,
  )
  assert.deepEqual(calls, ["details"])
})

test("failed OAuth approval cannot persist or enable a capability", async () => {
  const calls = []
  await assert.rejects(
    authorization.authorizeSellerOsControlConsentV1({
      authorizationId, actorUserId,
    }, {
      async getAuthorizationDetails() { calls.push("details"); return validDetails },
      async approveAuthorization() {
        calls.push("approve")
        throw new Error("TEO_CONTROL_OAUTH_CONSENT_FAILED")
      },
      async persistCapability() { calls.push("persist"); return { enabled: true } },
    }),
    /TEO_CONTROL_OAUTH_CONSENT_FAILED/,
  )
  assert.deepEqual(calls, ["details", "approve"])
})

test("successful consent persists capability after approval and returns exact redirect", async () => {
  const calls = []
  const redirectUrl =
    "https://chatgpt.com/connector/oauth/YZ_2z2gp8NQJ?code=exact&state=bound"
  const result = await authorization.authorizeSellerOsControlConsentV1({
    authorizationId, actorUserId,
  }, {
    async getAuthorizationDetails() { calls.push("details"); return validDetails },
    async approveAuthorization() { calls.push("approve"); return redirectUrl },
    async persistCapability(clientId) {
      calls.push("persist")
      assert.equal(clientId, validDetails.client.id)
      return { enabled: true }
    },
  })
  assert.deepEqual(calls, ["details", "approve", "persist"])
  assert.equal(result.redirectUrl, redirectUrl)
  assert.deepEqual(result.capability, { enabled: true })
})

test("capability UI supports explicit approval and fail-closed revocation", () => {
  assert.match(consent, /Autorizar control acotado/)
  assert.match(consent, /action: "AUTHORIZE"/)
  assert.match(consent, /action: "DISABLE"/)
  assert.match(route, /disable_seller_os_pre_research_command_v1/)
  assert.match(route, /sameSite: "strict"/)
  assert.match(route, /httpOnly: true/)
})
