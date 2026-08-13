import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from "jose"

import {
  SELLER_OS_MCP_REQUIRED_SCOPE,
  authenticateSellerOsMcpRequestV1,
  buildSellerOsMcpProtectedResourceMetadataV1,
  buildSellerOsMcpWwwAuthenticateV1,
  discoverSellerOsMcpAuthorizationServerV1,
  getSellerOsMcpProtectedResourceMetadataUrlV1,
  loadSellerOsMcpOAuthConfigurationV1,
  validateSellerOsMcpAuthorizationServerMetadataV1,
  verifySellerOsMcpAccessTokenV1,
} from "./ebay-seller-os-mcp-oauth-v1.ts"

const ISSUER = "https://seller-os-test.us.auth0.com/"
const RESOURCE = "https://seller-os-mcp.example.test/api/seller-os/assistant/mcp"
const NOW_SECONDS = 1_786_500_000

const loaded = loadSellerOsMcpOAuthConfigurationV1({
  SELLER_OS_MCP_OAUTH_ISSUER: ISSUER,
  SELLER_OS_MCP_OAUTH_RESOURCE: RESOURCE,
})
assert.equal(loaded.ok, true)
const config = loaded.config

const discoveryDocument = Object.freeze({
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}authorize`,
  token_endpoint: `${ISSUER}oauth/token`,
  jwks_uri: `${ISSUER}.well-known/jwks.json`,
  registration_endpoint: `${ISSUER}oidc/register`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
  code_challenge_methods_supported: ["S256"],
  scopes_supported: ["openid", SELLER_OS_MCP_REQUIRED_SCOPE],
})
const validatedDiscovery = validateSellerOsMcpAuthorizationServerMetadataV1(
  discoveryDocument,
  config,
)
assert.equal(validatedDiscovery.ok, true)
const metadata = validatedDiscovery.metadata

const signingKeys = await generateKeyPair("RS256")
const verificationJwk = await exportJWK(signingKeys.publicKey)
verificationJwk.alg = "RS256"
verificationJwk.kid = "seller-os-test-key"
verificationJwk.use = "sig"
const keyResolver = createLocalJWKSet({ keys: [verificationJwk] })

async function issueToken(overrides = {}) {
  let token = new SignJWT({
    scope: overrides.scope ?? SELLER_OS_MCP_REQUIRED_SCOPE,
    azp: overrides.clientId ?? "chatgpt-private-client-test",
    ...(overrides.extraClaims ?? {}),
  }).setProtectedHeader({ alg: "RS256", kid: "seller-os-test-key", typ: "JWT" })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? RESOURCE)
    .setSubject(overrides.subject ?? "auth0|seller-os-user-test")
    .setIssuedAt(NOW_SECONDS - 30)
  if (!overrides.omitNotBefore) token = token.setNotBefore(
    overrides.notBefore ?? NOW_SECONDS - 30,
  )
  if (!overrides.omitExpiration) token = token.setExpirationTime(
    overrides.expiration ?? NOW_SECONDS + 600,
  )
  return token.sign(overrides.privateKey ?? signingKeys.privateKey)
}

function mcpRequest(token) {
  return new Request(RESOURCE, {
    method: "POST",
    headers: token === undefined ? {} : { Authorization: token },
  })
}

async function authenticateToken(token) {
  return authenticateSellerOsMcpRequestV1(mcpRequest(token), {
    config,
    metadata,
    keyResolver,
    currentDate: new Date(NOW_SECONDS * 1_000),
  })
}

test("PRMD is RFC 9728 path-specific and advertises only seller_os.read", () => {
  assert.equal(config.resourceMetadataUrl,
    "https://seller-os-mcp.example.test/.well-known/oauth-protected-resource/api/seller-os/assistant/mcp")
  assert.equal(getSellerOsMcpProtectedResourceMetadataUrlV1(RESOURCE),
    config.resourceMetadataUrl)
  assert.deepEqual(buildSellerOsMcpProtectedResourceMetadataV1(config), {
    resource: RESOURCE,
    authorization_servers: [ISSUER],
    scopes_supported: [SELLER_OS_MCP_REQUIRED_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Seller OS private read-only MCP",
  })
  assert.equal(buildSellerOsMcpWwwAuthenticateV1(config),
    `Bearer resource_metadata="${config.resourceMetadataUrl}", scope="seller_os.read"`)
})

test("authorization-server discovery requires code flow, PKCE S256, exact scope, and trusted endpoints", async () => {
  const fetched = await discoverSellerOsMcpAuthorizationServerV1(config, {
    useCache: false,
    fetchImpl: async (url, init) => {
      assert.equal(String(url), config.discoveryUrl)
      assert.equal(init.redirect, "error")
      return Response.json(discoveryDocument)
    },
  })
  assert.equal(fetched.ok, true)
  assert.equal(fetched.metadata.pkceS256, true)
  assert.equal(fetched.metadata.registrationMode, "DYNAMIC_CLIENT_REGISTRATION")

  for (const invalid of [
    { ...discoveryDocument, code_challenge_methods_supported: ["plain"] },
    { ...discoveryDocument, scopes_supported: ["openid"] },
    { ...discoveryDocument, issuer: "https://wrong-issuer.example.test/" },
    { ...discoveryDocument, jwks_uri: "https://arbitrary-proxy.example.test/jwks" },
    { ...discoveryDocument, token_endpoint_auth_methods_supported: ["tls_client_auth"] },
  ]) assert.equal(validateSellerOsMcpAuthorizationServerMetadataV1(invalid, config).ok, false)
})

test("valid user-scoped JWT proves signature, issuer, audience, expiry, and exact scope", async () => {
  const token = await issueToken()
  const result = await verifySellerOsMcpAccessTokenV1({
    token,
    config,
    metadata,
    keyResolver,
    currentDate: new Date(NOW_SECONDS * 1_000),
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.principal, {
    subject: "auth0|seller-os-user-test",
    clientId: "chatgpt-private-client-test",
    scopes: [SELLER_OS_MCP_REQUIRED_SCOPE],
    issuer: ISSUER,
    resource: RESOURCE,
    expiresAt: NOW_SECONDS + 600,
  })
  assert.equal(JSON.stringify(result).includes(token), false)
})

test("missing and malformed bearer tokens fail closed with a discoverable challenge", async () => {
  for (const [header, expectedCode] of [
    [undefined, "NO_TOKEN"],
    ["Basic not-accepted", "MALFORMED_TOKEN"],
    ["Bearer malformed token", "MALFORMED_TOKEN"],
  ]) {
    const result = await authenticateToken(header)
    assert.equal(result.ok, false)
    assert.equal(result.code, expectedCode)
    assert.equal(result.response.status, 401)
    const challenge = result.response.headers.get("www-authenticate")
    assert.match(challenge, /^Bearer resource_metadata=/)
    assert.match(challenge, /scope="seller_os\.read"/)
    assert.match(challenge, /error="invalid_token"/)
  }
})

test("wrong scope and broader-looking scopes never imply seller_os.read", async () => {
  for (const scope of ["openid", "seller_os.admin", "seller_os.read.all"]) {
    const result = await authenticateToken(`Bearer ${await issueToken({ scope })}`)
    assert.equal(result.ok, false)
    assert.equal(result.code, "WRONG_SCOPE")
    assert.equal(result.response.status, 403)
    assert.match(result.response.headers.get("www-authenticate"), /error="insufficient_scope"/)
  }
  const exact = await authenticateToken(
    `Bearer ${await issueToken({ scope: "openid seller_os.read" })}`,
  )
  assert.equal(exact.ok, true)
})

test("wrong audience, issuer, expiry, nbf, and absent expiry are rejected distinctly", async () => {
  const cases = [
    [{ audience: "https://wrong-resource.example.test/mcp" }, "WRONG_AUDIENCE"],
    [{ issuer: "https://wrong-issuer.example.test/" }, "INVALID_ISSUER"],
    [{ expiration: NOW_SECONDS - 60 }, "EXPIRED_TOKEN"],
    [{ notBefore: NOW_SECONDS + 600 }, "TOKEN_NOT_ACTIVE"],
    [{ omitExpiration: true }, "TOKEN_EXPIRY_REQUIRED"],
  ]
  for (const [overrides, code] of cases) {
    const result = await authenticateToken(`Bearer ${await issueToken(overrides)}`)
    assert.equal(result.ok, false)
    assert.equal(result.code, code)
    assert.equal(result.response.status, 401)
  }
})

test("invalid signatures and non-user grants fail closed without token disclosure", async () => {
  const validToken = await issueToken()
  const segments = validToken.split(".")
  segments[2] = `${segments[2][0] === "a" ? "b" : "a"}${segments[2].slice(1)}`
  const invalidSignature = await authenticateToken(`Bearer ${segments.join(".")}`)
  assert.equal(invalidSignature.ok, false)
  assert.equal(invalidSignature.code, "INVALID_SIGNATURE")
  assert.equal((await invalidSignature.response.text()).includes(validToken), false)

  const machineOnly = await authenticateToken(`Bearer ${await issueToken({
    subject: "machine-client@clients",
    extraClaims: { gty: "client-credentials" },
  })}`)
  assert.equal(machineOnly.ok, false)
  assert.equal(machineOnly.code, "USER_SCOPED_TOKEN_REQUIRED")
})

test("configuration is server-only, HTTPS-only, and fails closed before activation", () => {
  assert.deepEqual(loadSellerOsMcpOAuthConfigurationV1({}), {
    ok: false,
    code: "OAUTH_NOT_CONFIGURED",
  })
  assert.deepEqual(loadSellerOsMcpOAuthConfigurationV1({
    NEXT_PUBLIC_SELLER_OS_MCP_OAUTH_ISSUER: ISSUER,
    NEXT_PUBLIC_SELLER_OS_MCP_OAUTH_RESOURCE: RESOURCE,
  }), { ok: false, code: "OAUTH_NOT_CONFIGURED" })
  assert.deepEqual(loadSellerOsMcpOAuthConfigurationV1({
    SELLER_OS_MCP_OAUTH_ISSUER: "http://issuer.example.test",
    SELLER_OS_MCP_OAUTH_RESOURCE: RESOURCE,
  }), { ok: false, code: "OAUTH_CONFIGURATION_INVALID" })
})

test("public MCP route uses OAuth while internal admin route preserves existing admin auth", () => {
  const server = readFileSync(new URL("./ebay-seller-os-mcp-server-v1.ts", import.meta.url),
    "utf8")
  const pathMetadata = readFileSync(new URL(
    "../../app/.well-known/oauth-protected-resource/api/seller-os/assistant/mcp/route.ts",
    import.meta.url,
  ), "utf8")
  assert.match(server, /pathname\.startsWith\("\/api\/seller-os\/"\)/)
  assert.match(server, /authenticateSellerOsMcpRequestV1\(req\)/)
  assert.match(server, /validateAdminApiRequest\(req\)/)
  assert.match(pathMetadata,
    /handleSellerOsMcpProtectedResourceMetadataRouteV1/)
  assert.doesNotMatch(server + pathMetadata,
    /createOffer|publishOffer|executeSql|NEXT_PUBLIC_SELLER_OS_MCP_OAUTH/)
})
