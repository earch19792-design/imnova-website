export const SELLER_OS_MCP_TOOL_POLICY_VERSION =
  "SELLER_OS_MCP_READ_ONLY_TOOL_POLICY_V1_2026_08_12"

export const SELLER_OS_MCP_BUILTIN_TOOL_POLICIES_V1 = Object.freeze([
  Object.freeze({
    name: "search",
    annotations: Object.freeze({
      readOnlyHint: true as const,
      destructiveHint: false as const,
      openWorldHint: false as const,
      idempotentHint: true as const,
    }),
    sideEffects: false as const,
  }),
  Object.freeze({
    name: "fetch",
    annotations: Object.freeze({
      readOnlyHint: true as const,
      destructiveHint: false as const,
      openWorldHint: false as const,
      idempotentHint: true as const,
    }),
    sideEffects: false as const,
  }),
])

type SellerOsMcpToolPolicyCandidateV1 = Readonly<{
  name: string
  annotations?: Readonly<{
    readOnlyHint?: boolean
    destructiveHint?: boolean
    openWorldHint?: boolean
    idempotentHint?: boolean
  }>
  sideEffects?: boolean
}>

export function evaluateSellerOsMcpToolSafetyV1(
  assistantTools: readonly SellerOsMcpToolPolicyCandidateV1[],
) {
  const tools = [...assistantTools, ...SELLER_OS_MCP_BUILTIN_TOOL_POLICIES_V1]
  const writeToolNames = tools.filter((tool) =>
    tool.sideEffects !== false || tool.annotations?.readOnlyHint !== true ||
    tool.annotations?.destructiveHint !== false ||
    tool.annotations?.openWorldHint !== false)
    .map((tool) => tool.name)
  return Object.freeze({
    contractVersion: SELLER_OS_MCP_TOOL_POLICY_VERSION,
    registeredToolCount: tools.length,
    assistantWriteTools: writeToolNames.length,
    writeToolNames: Object.freeze(writeToolNames),
    allToolsReadOnly: writeToolNames.length === 0,
  })
}

export function getSellerOsMcpToolSecuritySchemesV1(
  applicationAuthMode: "OAUTH_SELLER_OS_READ" | "TUNNEL_TRANSPORT_ONLY",
) {
  return applicationAuthMode === "TUNNEL_TRANSPORT_ONLY"
    ? [{ type: "noauth" as const }]
    : [{ type: "oauth2" as const, scopes: ["seller_os.read"] }]
}
