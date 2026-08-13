import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import test from "node:test"

import {
  SELLER_OS_DEDICATED_MCP_MODE,
  SELLER_OS_DEDICATED_MCP_PATH,
  getSellerOsDedicatedMcpDeploymentStateV1,
} from "./ebay-seller-os-mcp-deployment-v1.ts"

const ISSUER = "https://seller-os-test.us.auth0.com/"
const RESOURCE =
  `https://seller-os-mcp.example.test${SELLER_OS_DEDICATED_MCP_PATH}`
const serviceRoot = new URL("../../services/seller-os-mcp/", import.meta.url)

function deploymentEnvironment(overrides = {}) {
  return {
    SELLER_OS_MCP_DEPLOYMENT_MODE: SELLER_OS_DEDICATED_MCP_MODE,
    SELLER_OS_MCP_OAUTH_ISSUER: ISSUER,
    SELLER_OS_MCP_OAUTH_RESOURCE: RESOURCE,
    ...overrides,
  }
}

test("dedicated HTTPS deployment activates only for exact mode and resource path", () => {
  const ready = getSellerOsDedicatedMcpDeploymentStateV1(
    deploymentEnvironment(),
  )
  assert.equal(ready.ready, true)
  assert.equal(ready.topology, "ROUTE_ONLY_SEPARATE_TRUST_BOUNDARY")
  assert.equal(ready.oauthRequired, true)
  assert.equal(ready.requiredScope, "seller_os.read")
  assert.equal(ready.anonymousToolExecutionAllowed, false)
  assert.equal(ready.adminApplicationIncluded, false)
  assert.equal(ready.assistantWriteTools, 0)
  assert.equal(ready.secureMcpTunnelStatus, "PRESERVED_ALTERNATIVE_PATH")

  for (const environment of [
    deploymentEnvironment({ SELLER_OS_MCP_DEPLOYMENT_MODE: "" }),
    deploymentEnvironment({
      SELLER_OS_MCP_OAUTH_RESOURCE:
        "https://seller-os-mcp.example.test/mcp",
    }),
    deploymentEnvironment({
      SELLER_OS_MCP_OAUTH_RESOURCE:
        `http://seller-os-mcp.example.test${SELLER_OS_DEDICATED_MCP_PATH}`,
    }),
    deploymentEnvironment({ SELLER_OS_MCP_OAUTH_ISSUER: "" }),
  ]) {
    assert.equal(getSellerOsDedicatedMcpDeploymentStateV1(environment).ready,
      false)
  }
})

test("route-only service reuses canonical OAuth and Assistant Gateway code", () => {
  const routeFiles = readdirSync(new URL("app/", serviceRoot), {
    recursive: true,
    withFileTypes: true,
  }).filter((entry) => entry.isFile() && entry.name === "route.ts")
  assert.equal(routeFiles.length, 3)

  const mcpRoute = readFileSync(new URL(
    "app/api/seller-os/assistant/mcp/route.ts",
    serviceRoot,
  ), "utf8")
  const rootMetadata = readFileSync(new URL(
    "app/.well-known/oauth-protected-resource/route.ts",
    serviceRoot,
  ), "utf8")
  const pathMetadata = readFileSync(new URL(
    "app/.well-known/oauth-protected-resource/api/seller-os/assistant/mcp/route.ts",
    serviceRoot,
  ), "utf8")
  const combined = `${mcpRoute}\n${rootMetadata}\n${pathMetadata}`

  assert.match(mcpRoute, /handleDedicatedSellerOsMcpRequestV1/)
  assert.match(combined, /@seller-os\/ebay-seller-os-mcp-(server|oauth)-v1/)
  assert.doesNotMatch(combined,
    /createOffer|publishOffer|executeSql|arbitraryUrl|SUPABASE_SERVICE_ROLE_KEY/)
  assert.doesNotMatch(combined, /api\/admin|admin\/|page\.(ts|tsx)/)
})

test("dedicated handler authenticates before MCP transport and exposes no admin fallback", () => {
  const server = readFileSync(new URL("./ebay-seller-os-mcp-server-v1.ts",
    import.meta.url), "utf8")
  const start = server.indexOf(
    "export async function handleDedicatedSellerOsMcpRequestV1",
  )
  const dedicated = server.slice(start)
  const authenticate = dedicated.indexOf("authenticateSellerOsMcpRequestV1(req)")
  const serve = dedicated.indexOf("serveAuthenticatedSellerOsMcpRequestV1(req)")
  assert.ok(start >= 0)
  assert.ok(authenticate >= 0)
  assert.ok(serve > authenticate)
  assert.doesNotMatch(dedicated, /validateAdminApiRequest/)
  assert.doesNotMatch(dedicated, /getEbayProRuntimeBoundary/)
})

test("dedicated deployment package contains no parallel commercial engine", () => {
  const packageJson = JSON.parse(readFileSync(new URL("package.json", serviceRoot),
    "utf8"))
  assert.equal(packageJson.private, true)
  assert.equal(packageJson.name, "@imnova/seller-os-mcp")
  assert.equal("openai" in packageJson.dependencies, false)
  assert.equal("@openai/agents" in packageJson.dependencies, false)

  const applicationFiles = readdirSync(new URL("app/", serviceRoot), {
    recursive: true,
    withFileTypes: true,
  }).filter((entry) => entry.isFile())
  assert.equal(applicationFiles.every((entry) => entry.name === "route.ts"), true)
})
