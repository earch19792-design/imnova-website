import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { SELLER_OS_ASSISTANT_TOOLS_V1 } from
  "./ebay-seller-os-assistant-gateway-v1.ts"
import {
  getSellerOsMcpAuthMetadataPolicyV1,
  handleSellerOsMcpProtectedResourceMetadataForRuntimeV1,
} from "./ebay-seller-os-mcp-auth-metadata-v1.ts"
import { SELLER_OS_DEDICATED_MCP_MODE } from
  "./ebay-seller-os-mcp-deployment-v1.ts"
import {
  SELLER_OS_MCP_TUNNEL_DEVELOPMENT_MODE,
  SELLER_OS_MCP_TUNNEL_LOOPBACK_HOST,
  getSellerOsMcpRuntimePolicyV1,
} from "./ebay-seller-os-mcp-tunnel-development-v1.ts"
import {
  evaluateSellerOsMcpToolSafetyV1,
  getSellerOsMcpToolSecuritySchemesV1,
} from "./ebay-seller-os-mcp-tool-policy-v1.ts"

function tunnelEnvironment(overrides = {}) {
  return {
    NODE_ENV: "development",
    SELLER_OS_MCP_DEPLOYMENT_MODE: SELLER_OS_MCP_TUNNEL_DEVELOPMENT_MODE,
    SELLER_OS_MCP_BIND_HOST: SELLER_OS_MCP_TUNNEL_LOOPBACK_HOST,
    ...overrides,
  }
}

function policy(environment, assistantWriteTools = 0) {
  return getSellerOsMcpRuntimePolicyV1({
    environment,
    assistantWriteTools,
    dedicatedMode: SELLER_OS_DEDICATED_MCP_MODE,
  })
}

const DEDICATED_ISSUER = "https://seller-os-test.us.auth0.com/"
const DEDICATED_RESOURCE =
  "https://seller-os-mcp.example.test/api/seller-os/assistant/mcp"

test("TUNNEL_DEVELOPMENT on exact loopback permits MCP without application OAuth", () => {
  const state = policy(tunnelEnvironment())
  assert.equal(state.modeRecognized, true)
  assert.equal(state.requestHandlingAllowed, true)
  assert.equal(state.applicationAuthMode, "TUNNEL_TRANSPORT_ONLY")
  assert.equal(state.oauthRequired, false)
  assert.equal(state.requiredScope, null)
  assert.equal(state.loopbackOnly, true)
  assert.equal(state.syntheticPrincipalCreated, false)
  assert.deepEqual(state.reasonCodes, [])
  assert.deepEqual(getSellerOsMcpToolSecuritySchemesV1(
    state.applicationAuthMode,
  ), [{ type: "noauth" }])
})

test("valid tunnel development omits OAuth-required metadata with HTTP 404", async () => {
  const environment = tunnelEnvironment()
  const metadata = getSellerOsMcpAuthMetadataPolicyV1(environment)
  assert.equal(metadata.applicationAuthMode, "TUNNEL_TRANSPORT_ONLY")
  assert.equal(metadata.protectedResourceMetadata, "ABSENT_404")
  assert.equal(metadata.wwwAuthenticate, "ABSENT")
  assert.equal(metadata.oauthDiscoveryAdvertised, false)
  assert.equal(metadata.authorizationServersAdvertised, false)
  assert.equal(metadata.requiredScope, null)
  assert.equal(metadata.assistantWriteTools, 0)

  const response = handleSellerOsMcpProtectedResourceMetadataForRuntimeV1(
    environment,
  )
  assert.equal(response.status, 404)
  assert.equal(response.headers.get("www-authenticate"), null)
  assert.equal(await response.text(), "")
})

test("dedicated HTTPS retains canonical PRMD, Auth0 issuer, and seller_os.read", async () => {
  const environment = {
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "production",
    SELLER_OS_MCP_DEPLOYMENT_MODE: SELLER_OS_DEDICATED_MCP_MODE,
    SELLER_OS_MCP_OAUTH_ISSUER: DEDICATED_ISSUER,
    SELLER_OS_MCP_OAUTH_RESOURCE: DEDICATED_RESOURCE,
  }
  const metadata = getSellerOsMcpAuthMetadataPolicyV1(environment)
  assert.equal(metadata.applicationAuthMode, "OAUTH_SELLER_OS_READ")
  assert.equal(metadata.protectedResourceMetadata, "OAUTH_RESOURCE_SERVER")
  assert.equal(metadata.wwwAuthenticate, "BEARER_SELLER_OS_READ")
  assert.equal(metadata.oauthDiscoveryAdvertised, true)
  assert.equal(metadata.authorizationServersAdvertised, true)
  assert.equal(metadata.requiredScope, "seller_os.read")

  const response = handleSellerOsMcpProtectedResourceMetadataForRuntimeV1(
    environment,
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    resource: DEDICATED_RESOURCE,
    authorization_servers: [DEDICATED_ISSUER],
    scopes_supported: ["seller_os.read"],
    bearer_methods_supported: ["header"],
    resource_name: "Seller OS private read-only MCP",
  })
})

test("invalid Production tunnel context never suppresses OAuth metadata", async () => {
  const environment = tunnelEnvironment({
    NODE_ENV: "production",
    SELLER_OS_MCP_OAUTH_ISSUER: DEDICATED_ISSUER,
    SELLER_OS_MCP_OAUTH_RESOURCE: DEDICATED_RESOURCE,
  })
  const metadata = getSellerOsMcpAuthMetadataPolicyV1(environment)
  assert.equal(metadata.runtime.requestHandlingAllowed, false)
  assert.equal(metadata.protectedResourceMetadata, "OAUTH_RESOURCE_SERVER")
  assert.equal(metadata.wwwAuthenticate, "BEARER_SELLER_OS_READ")
  const response = handleSellerOsMcpProtectedResourceMetadataForRuntimeV1(
    environment,
  )
  assert.equal(response.status, 200)
})

test("TUNNEL_DEVELOPMENT rejects wildcard and every non-exact-loopback bind", () => {
  for (const bindHost of ["", "0.0.0.0", "::", "::1", "localhost",
    "127.0.0.2", "192.168.1.10"]) {
    const state = policy(tunnelEnvironment({
      SELLER_OS_MCP_BIND_HOST: bindHost,
    }))
    assert.equal(state.requestHandlingAllowed, false, bindHost)
    assert.equal(state.oauthRequired, true, bindHost)
    assert.ok(state.reasonCodes.includes("EXACT_LOOPBACK_BIND_REQUIRED"), bindHost)
  }
})

test("TUNNEL_DEVELOPMENT rejects Production and every Vercel deployment context", () => {
  for (const override of [
    { NODE_ENV: "production" },
    { EBAY_PRO_RUNTIME: "production_core" },
    { VERCEL_ENV: "production" },
    { VERCEL_ENV: "preview" },
    { VERCEL_ENV: "development" },
    { VERCEL_TARGET_ENV: "production" },
    { VERCEL: "1" },
  ]) {
    const state = policy(tunnelEnvironment(override))
    assert.equal(state.requestHandlingAllowed, false, JSON.stringify(override))
    assert.equal(state.oauthRequired, true, JSON.stringify(override))
    assert.ok(state.reasonCodes.some((reason) =>
      reason === "PRODUCTION_CONTEXT_FORBIDDEN" ||
      reason === "VERCEL_CONTEXT_FORBIDDEN"), JSON.stringify(override))
  }
})

test("missing, unknown, and write-capable tunnel configurations fail closed", () => {
  const missing = policy({ NODE_ENV: "development",
    SELLER_OS_MCP_BIND_HOST: SELLER_OS_MCP_TUNNEL_LOOPBACK_HOST })
  assert.equal(missing.requestHandlingAllowed, false)
  assert.deepEqual(missing.reasonCodes, ["DEPLOYMENT_MODE_REQUIRED"])

  const unknown = policy(tunnelEnvironment({
    SELLER_OS_MCP_DEPLOYMENT_MODE: "SOME_OTHER_MODE",
  }))
  assert.equal(unknown.requestHandlingAllowed, false)
  assert.deepEqual(unknown.reasonCodes, ["DEPLOYMENT_MODE_UNRECOGNIZED"])

  const writeCapable = policy(tunnelEnvironment(), 1)
  assert.equal(writeCapable.requestHandlingAllowed, false)
  assert.ok(writeCapable.reasonCodes.includes("ASSISTANT_WRITE_TOOLS_FORBIDDEN"))
})

test("dedicated HTTPS mode remains OAuth-only with exact seller_os.read", () => {
  const state = policy({
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "production",
    SELLER_OS_MCP_DEPLOYMENT_MODE: SELLER_OS_DEDICATED_MCP_MODE,
  })
  assert.equal(state.requestHandlingAllowed, true)
  assert.equal(state.applicationAuthMode, "OAUTH_SELLER_OS_READ")
  assert.equal(state.oauthRequired, true)
  assert.equal(state.requiredScope, "seller_os.read")
  assert.deepEqual(getSellerOsMcpToolSecuritySchemesV1(
    state.applicationAuthMode,
  ), [{ type: "oauth2", scopes: ["seller_os.read"] }])

  const server = readFileSync(new URL("./ebay-seller-os-mcp-server-v1.ts",
    import.meta.url), "utf8")
  const dedicated = server.slice(server.indexOf(
    "export async function handleDedicatedSellerOsMcpRequestV1",
  ))
  assert.ok(dedicated.indexOf("authenticateSellerOsMcpRequestV1(req)") >= 0)
  assert.ok(dedicated.indexOf("serveAuthenticatedSellerOsMcpRequestV1(req)") >
    dedicated.indexOf("authenticateSellerOsMcpRequestV1(req)"))
  assert.doesNotMatch(dedicated, /TUNNEL_TRANSPORT_ONLY|noauth/)
})

test("the complete MCP registry contains zero write-capable tools", () => {
  const safety = evaluateSellerOsMcpToolSafetyV1(SELLER_OS_ASSISTANT_TOOLS_V1)
  assert.equal(SELLER_OS_ASSISTANT_TOOLS_V1.length, 13)
  assert.equal(safety.registeredToolCount, 15)
  assert.equal(safety.assistantWriteTools, 0)
  assert.equal(safety.allToolsReadOnly, true)
  assert.deepEqual(safety.writeToolNames, [])
  for (const descriptor of SELLER_OS_ASSISTANT_TOOLS_V1) {
    assert.equal(descriptor.annotations.readOnlyHint, true)
    assert.equal(descriptor.annotations.destructiveHint, false)
    assert.equal(descriptor.annotations.openWorldHint, false)
    assert.equal(descriptor.sideEffects, false)
  }
})

test("the supported local command binds Next only to 127.0.0.1", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../../package.json",
    import.meta.url), "utf8"))
  const command = packageJson.scripts["dev:seller-os-mcp:tunnel"]
  assert.match(command,
    /SELLER_OS_MCP_DEPLOYMENT_MODE=TUNNEL_DEVELOPMENT/)
  assert.match(command, /SELLER_OS_MCP_BIND_HOST=127\.0\.0\.1/)
  assert.match(command, /next dev -H 127\.0\.0\.1 -p 3000/)
  assert.doesNotMatch(command, /0\.0\.0\.0|tunnel-client|CONTROL_PLANE_API_KEY/)
})
