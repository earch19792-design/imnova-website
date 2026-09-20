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
const resourceMigration = readFileSync(
  "supabase/migrations/20260920151423_bind_control_oauth_resource_v1.sql",
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
  const resourceAt = post.indexOf("getAuthorizationResource:")
  const approveAt = post.indexOf("approveAuthorization:")
  const serviceAt = post.indexOf("persistCapability:")
  assert.ok(requestAt >= 0 && authAt > requestAt && ownerAt > authAt &&
    csrfAt > ownerAt &&
    detailsAt > csrfAt && resourceAt > detailsAt && approveAt > resourceAt &&
    serviceAt > approveAt)
  assert.match(route, /actorUserId: actor\.actorSubject/)
  assert.match(route, /\.auth\.oauth\.getAuthorizationDetails\(/)
  assert.match(route, /\.auth\.oauth\.approveAuthorization\(/)
  assert.match(route, /get_seller_os_control_oauth_resource_v1/)
  assert.match(route, /p_command_client_id: clientId/)
  assert.doesNotMatch(post, /body\.(?:ownerUserId|actorSubject|commandClientId)/)
})

const authorizationId = "oauth-request_AZaz09-._~opaque-token"
const actorUserId = "79bdf9e4-9daa-476b-93f5-a38f39e10ee7"
const authoritativeResource =
  "https://imnova-seller-os-preprod.vercel.app/api/seller-os/control/mcp"
const validDetails = Object.freeze({
  authorization_id: authorizationId,
  redirect_uri: "https://chatgpt.com/connector/oauth/YZ_2z2gp8NQJ",
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
      details: { ...validDetails, scope }, authoritativeResource,
      authorizationId, actorUserId,
    })
    assert.equal(result.clientId, validDetails.client.id)
  }
})

test("OAuth details reject invalid identity, client, redirect, or scopes", () => {
  const rejected = [
    { ...validDetails, authorization_id: "different-request" },
    { ...validDetails, user: { id: "different-owner" } },
    { ...validDetails, client: { id: "different-client" } },
    { ...validDetails, redirect_uri: "https://example.test/callback" },
    { ...validDetails, scope: "profile email offline_access" },
    { ...validDetails, scope: "openid email offline_access" },
    { ...validDetails, scope: "openid profile unknown" },
  ]
  for (const details of rejected) {
    assert.throws(
      () => authorization.validateSellerOsControlAuthorizationDetailsV1({
        details, authoritativeResource, authorizationId, actorUserId,
      }),
      /TEO_CONTROL_AUTHORIZATION_BINDING_INVALID/,
    )
  }
})

test("OAuth resource comes from the bound server-side lookup and remains exact", () => {
  assert.doesNotThrow(() =>
    authorization.validateSellerOsControlAuthorizationDetailsV1({
      details: validDetails, authoritativeResource, authorizationId, actorUserId,
    }))
  for (const resource of [undefined, null, "", "https://example.test/mcp"]) {
    assert.throws(
      () => authorization.validateSellerOsControlAuthorizationDetailsV1({
        details: validDetails, authoritativeResource: resource,
        authorizationId, actorUserId,
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
      async getAuthorizationResource() { calls.push("resource"); return null },
      async approveAuthorization() { calls.push("approve"); return "unused" },
      async persistCapability() { calls.push("persist"); return "unused" },
    }),
    /TEO_CONTROL_AUTHORIZATION_DETAILS_FAILED/,
  )
  assert.deepEqual(calls, ["details"])
})

test("missing server-side resource fails before approval and persistence", async () => {
  const calls = []
  await assert.rejects(
    authorization.authorizeSellerOsControlConsentV1({
      authorizationId, actorUserId,
    }, {
      async getAuthorizationDetails() { calls.push("details"); return validDetails },
      async getAuthorizationResource() {
        calls.push("resource")
        throw new Error("TEO_CONTROL_AUTHORIZATION_BINDING_INVALID")
      },
      async approveAuthorization() { calls.push("approve"); return "unused" },
      async persistCapability() { calls.push("persist"); return "unused" },
    }),
    /TEO_CONTROL_AUTHORIZATION_BINDING_INVALID/,
  )
  assert.deepEqual(calls, ["details", "resource"])
})

test("failed OAuth approval cannot persist or enable a capability", async () => {
  const calls = []
  await assert.rejects(
    authorization.authorizeSellerOsControlConsentV1({
      authorizationId, actorUserId,
    }, {
      async getAuthorizationDetails() { calls.push("details"); return validDetails },
      async getAuthorizationResource() {
        calls.push("resource")
        return authoritativeResource
      },
      async approveAuthorization() {
        calls.push("approve")
        throw new Error("TEO_CONTROL_OAUTH_CONSENT_FAILED")
      },
      async persistCapability() { calls.push("persist"); return { enabled: true } },
    }),
    /TEO_CONTROL_OAUTH_CONSENT_FAILED/,
  )
  assert.deepEqual(calls, ["details", "resource", "approve"])
})

test("successful consent persists capability after approval and returns exact redirect", async () => {
  const calls = []
  const redirectUrl =
    "https://chatgpt.com/connector/oauth/YZ_2z2gp8NQJ?code=exact&state=bound"
  const result = await authorization.authorizeSellerOsControlConsentV1({
    authorizationId, actorUserId,
  }, {
    async getAuthorizationDetails() { calls.push("details"); return validDetails },
    async getAuthorizationResource() {
      calls.push("resource")
      return authoritativeResource
    },
    async approveAuthorization() { calls.push("approve"); return redirectUrl },
    async persistCapability(clientId) {
      calls.push("persist")
      assert.equal(clientId, validDetails.client.id)
      return { enabled: true }
    },
  })
  assert.deepEqual(calls, ["details", "resource", "approve", "persist"])
  assert.equal(result.redirectUrl, redirectUrl)
  assert.deepEqual(result.capability, { enabled: true })
})

test("resource lookup is service-role-only, authorization-bound, and read-only", () => {
  assert.match(resourceMigration,
    /security definer[\s\S]*set search_path = ''/i)
  assert.match(resourceMigration,
    /from auth\.oauth_authorizations as oauth_authorization/i)
  for (const binding of [
    "oauth_authorization.authorization_id = p_authorization_id",
    "oauth_authorization.user_id = p_owner_user_id",
    "oauth_authorization.client_id = p_client_id",
    "oauth_authorization.redirect_uri = p_redirect_uri",
    "oauth_authorization.status::text = 'pending'",
    "oauth_authorization.approved_at is null",
    "oauth_authorization.authorization_code is null",
    "oauth_authorization.expires_at > now()",
  ]) assert.ok(resourceMigration.includes(binding), binding)
  assert.match(resourceMigration,
    /revoke all[\s\S]*from public, anon, authenticated/i)
  assert.match(resourceMigration,
    /grant execute[\s\S]*to service_role/i)
  assert.doesNotMatch(resourceMigration,
    /\b(?:insert\s+into|update|delete\s+from|merge\s+into)\b/i)
})

test("capability UI supports explicit approval and fail-closed revocation", () => {
  assert.match(consent, /Autorizar control acotado/)
  assert.match(consent, /action: "AUTHORIZE"/)
  assert.match(consent, /action: "DISABLE"/)
  assert.match(route, /disable_seller_os_pre_research_command_v1/)
  assert.match(route, /sameSite: "strict"/)
  assert.match(route, /httpOnly: true/)
})
