// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { loadSellerOsMcpOAuthConfigurationV1 } from "./ebay-seller-os-mcp-oauth-v1.ts"

export const SELLER_OS_DEDICATED_MCP_DEPLOYMENT_VERSION =
  "SELLER_OS_DEDICATED_HTTPS_MCP_V1_2026_08_12"
export const SELLER_OS_DEDICATED_MCP_MODE =
  "DEDICATED_HTTPS_OAUTH_READ_ONLY"
export const SELLER_OS_DEDICATED_MCP_PATH =
  "/api/seller-os/assistant/mcp"
export const SELLER_OS_DEDICATED_MCP_ENVIRONMENT = Object.freeze({
  deploymentMode: "SELLER_OS_MCP_DEPLOYMENT_MODE",
})

export function getSellerOsDedicatedMcpDeploymentStateV1(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const deploymentMode = environment[
    SELLER_OS_DEDICATED_MCP_ENVIRONMENT.deploymentMode
  ]?.trim() ?? ""
  const oauth = loadSellerOsMcpOAuthConfigurationV1(environment)
  const configuredResource = oauth.ok ? new URL(oauth.config.resource) : null
  const exactResourcePath = configuredResource?.pathname ===
    SELLER_OS_DEDICATED_MCP_PATH
  const ready = deploymentMode === SELLER_OS_DEDICATED_MCP_MODE &&
    oauth.ok && exactResourcePath

  return Object.freeze({
    contractVersion: SELLER_OS_DEDICATED_MCP_DEPLOYMENT_VERSION,
    topology: "ROUTE_ONLY_SEPARATE_TRUST_BOUNDARY" as const,
    deploymentMode: SELLER_OS_DEDICATED_MCP_MODE,
    mcpPath: SELLER_OS_DEDICATED_MCP_PATH,
    configuredModeMatches: deploymentMode === SELLER_OS_DEDICATED_MCP_MODE,
    oauthConfigured: oauth.ok,
    exactResourcePath,
    ready,
    oauthRequired: true as const,
    requiredScope: "seller_os.read" as const,
    anonymousToolExecutionAllowed: false as const,
    adminApplicationIncluded: false as const,
    assistantWriteTools: 0 as const,
    secureMcpTunnelStatus: "PRESERVED_ALTERNATIVE_PATH" as const,
  })
}
