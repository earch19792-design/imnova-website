// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { SELLER_OS_ASSISTANT_TOOLS_V1 } from "./ebay-seller-os-assistant-gateway-v1.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { SELLER_OS_DEDICATED_MCP_MODE } from "./ebay-seller-os-mcp-deployment-v1.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { handleSellerOsMcpProtectedResourceMetadataForEnvironmentV1 } from "./ebay-seller-os-mcp-oauth-v1.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { getSellerOsMcpRuntimePolicyV1 } from "./ebay-seller-os-mcp-tunnel-development-v1.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { evaluateSellerOsMcpToolSafetyV1 } from "./ebay-seller-os-mcp-tool-policy-v1.ts"

export const SELLER_OS_MCP_AUTH_METADATA_VERSION =
  "SELLER_OS_MCP_AUTH_METADATA_COHERENCE_V1_2026_08_12"

/**
 * Keeps discovery metadata aligned with the process-level authentication
 * boundary. Only a fully valid loopback TUNNEL_DEVELOPMENT process may omit
 * application OAuth metadata. Every other state preserves the canonical OAuth
 * resource-server path (or its existing fail-closed activation response).
 */
export function getSellerOsMcpAuthMetadataPolicyV1(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const toolSafety = evaluateSellerOsMcpToolSafetyV1(
    SELLER_OS_ASSISTANT_TOOLS_V1,
  )
  const runtime = getSellerOsMcpRuntimePolicyV1({
    environment,
    assistantWriteTools: toolSafety.assistantWriteTools,
    dedicatedMode: SELLER_OS_DEDICATED_MCP_MODE,
  })
  const tunnelTransportOnly = runtime.requestHandlingAllowed &&
    runtime.applicationAuthMode === "TUNNEL_TRANSPORT_ONLY" &&
    runtime.oauthRequired === false &&
    runtime.requiredScope === null &&
    runtime.loopbackOnly &&
    !runtime.productionContext &&
    !runtime.vercelContext &&
    toolSafety.assistantWriteTools === 0

  return Object.freeze({
    contractVersion: SELLER_OS_MCP_AUTH_METADATA_VERSION,
    applicationAuthMode: runtime.applicationAuthMode,
    protectedResourceMetadata: tunnelTransportOnly
      ? "ABSENT_404" as const
      : "OAUTH_RESOURCE_SERVER" as const,
    wwwAuthenticate: tunnelTransportOnly
      ? "ABSENT" as const
      : "BEARER_SELLER_OS_READ" as const,
    oauthDiscoveryAdvertised: !tunnelTransportOnly,
    authorizationServersAdvertised: !tunnelTransportOnly,
    requiredScope: tunnelTransportOnly ? null : "seller_os.read" as const,
    assistantWriteTools: toolSafety.assistantWriteTools,
    runtime,
  })
}

export function handleSellerOsMcpProtectedResourceMetadataForRuntimeV1(
  environment: NodeJS.ProcessEnv,
) {
  const policy = getSellerOsMcpAuthMetadataPolicyV1(environment)
  if (policy.protectedResourceMetadata === "ABSENT_404") {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  }
  return handleSellerOsMcpProtectedResourceMetadataForEnvironmentV1(
    environment,
  )
}

export function handleSellerOsMcpProtectedResourceMetadataRouteV1() {
  return handleSellerOsMcpProtectedResourceMetadataForRuntimeV1(process.env)
}
