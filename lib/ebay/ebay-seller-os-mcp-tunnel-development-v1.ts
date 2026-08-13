export const SELLER_OS_MCP_TUNNEL_DEVELOPMENT_VERSION =
  "SELLER_OS_MCP_TUNNEL_DEVELOPMENT_V1_2026_08_12"
export const SELLER_OS_MCP_TUNNEL_DEVELOPMENT_MODE = "TUNNEL_DEVELOPMENT"
export const SELLER_OS_MCP_TUNNEL_LOOPBACK_HOST = "127.0.0.1"
export const SELLER_OS_MCP_TUNNEL_ENVIRONMENT = Object.freeze({
  deploymentMode: "SELLER_OS_MCP_DEPLOYMENT_MODE",
  bindHost: "SELLER_OS_MCP_BIND_HOST",
})

export type SellerOsMcpApplicationAuthModeV1 =
  | "OAUTH_SELLER_OS_READ"
  | "TUNNEL_TRANSPORT_ONLY"

export type SellerOsMcpRuntimePolicyV1 = Readonly<{
  contractVersion: typeof SELLER_OS_MCP_TUNNEL_DEVELOPMENT_VERSION
  configuredMode: string
  modeRecognized: boolean
  requestHandlingAllowed: boolean
  applicationAuthMode: SellerOsMcpApplicationAuthModeV1
  oauthRequired: boolean
  requiredScope: "seller_os.read" | null
  loopbackOnly: boolean
  bindHost: string
  productionContext: boolean
  vercelContext: boolean
  assistantWriteTools: number
  syntheticPrincipalCreated: false
  reasonCodes: readonly string[]
}>

type SellerOsMcpRuntimePolicyInputV1 = Readonly<{
  environment?: NodeJS.ProcessEnv
  assistantWriteTools: number
  dedicatedMode: string
}>

function normalize(value: string | undefined) {
  return value?.trim() ?? ""
}

/**
 * Resolves the application authentication policy without inspecting request
 * headers. TUNNEL_DEVELOPMENT is deliberately a local process policy, not a
 * caller-provided trust signal or a synthetic Seller OS identity.
 */
export function getSellerOsMcpRuntimePolicyV1(
  input: SellerOsMcpRuntimePolicyInputV1,
): SellerOsMcpRuntimePolicyV1 {
  const environment = input.environment ?? process.env
  const configuredMode = normalize(
    environment[SELLER_OS_MCP_TUNNEL_ENVIRONMENT.deploymentMode],
  )
  const bindHost = normalize(
    environment[SELLER_OS_MCP_TUNNEL_ENVIRONMENT.bindHost],
  )
  const nodeEnvironment = normalize(environment.NODE_ENV).toLowerCase()
  const sellerOsRuntime = normalize(environment.EBAY_PRO_RUNTIME).toLowerCase()
  const vercelEnvironment = normalize(environment.VERCEL_ENV).toLowerCase()
  const vercelTargetEnvironment = normalize(
    environment.VERCEL_TARGET_ENV,
  ).toLowerCase()
  const vercelContext = normalize(environment.VERCEL) === "1" ||
    Boolean(vercelEnvironment) || Boolean(vercelTargetEnvironment)
  const productionContext = nodeEnvironment === "production" ||
    sellerOsRuntime === "production" ||
    sellerOsRuntime === "production_core" ||
    vercelEnvironment === "production" ||
    vercelTargetEnvironment === "production"

  if (configuredMode === input.dedicatedMode) {
    const writeToolsPresent = input.assistantWriteTools !== 0
    return Object.freeze({
      contractVersion: SELLER_OS_MCP_TUNNEL_DEVELOPMENT_VERSION,
      configuredMode,
      modeRecognized: true,
      requestHandlingAllowed: !writeToolsPresent,
      applicationAuthMode: "OAUTH_SELLER_OS_READ",
      oauthRequired: true,
      requiredScope: "seller_os.read",
      loopbackOnly: false,
      bindHost,
      productionContext,
      vercelContext,
      assistantWriteTools: input.assistantWriteTools,
      syntheticPrincipalCreated: false,
      reasonCodes: Object.freeze(writeToolsPresent
        ? ["ASSISTANT_WRITE_TOOLS_FORBIDDEN"]
        : []),
    })
  }

  const reasonCodes: string[] = []
  if (configuredMode !== SELLER_OS_MCP_TUNNEL_DEVELOPMENT_MODE) {
    reasonCodes.push(configuredMode
      ? "DEPLOYMENT_MODE_UNRECOGNIZED"
      : "DEPLOYMENT_MODE_REQUIRED")
  }
  if (configuredMode === SELLER_OS_MCP_TUNNEL_DEVELOPMENT_MODE) {
    if (productionContext) reasonCodes.push("PRODUCTION_CONTEXT_FORBIDDEN")
    if (vercelContext) reasonCodes.push("VERCEL_CONTEXT_FORBIDDEN")
    if (bindHost !== SELLER_OS_MCP_TUNNEL_LOOPBACK_HOST) {
      reasonCodes.push("EXACT_LOOPBACK_BIND_REQUIRED")
    }
    if (input.assistantWriteTools !== 0) {
      reasonCodes.push("ASSISTANT_WRITE_TOOLS_FORBIDDEN")
    }
  }
  const requestHandlingAllowed = configuredMode ===
    SELLER_OS_MCP_TUNNEL_DEVELOPMENT_MODE && reasonCodes.length === 0

  return Object.freeze({
    contractVersion: SELLER_OS_MCP_TUNNEL_DEVELOPMENT_VERSION,
    configuredMode,
    modeRecognized: configuredMode === SELLER_OS_MCP_TUNNEL_DEVELOPMENT_MODE,
    requestHandlingAllowed,
    applicationAuthMode: requestHandlingAllowed
      ? "TUNNEL_TRANSPORT_ONLY"
      : "OAUTH_SELLER_OS_READ",
    oauthRequired: !requestHandlingAllowed,
    requiredScope: requestHandlingAllowed ? null : "seller_os.read",
    loopbackOnly: bindHost === SELLER_OS_MCP_TUNNEL_LOOPBACK_HOST,
    bindHost,
    productionContext,
    vercelContext,
    assistantWriteTools: input.assistantWriteTools,
    syntheticPrincipalCreated: false,
    reasonCodes: Object.freeze(reasonCodes),
  })
}
