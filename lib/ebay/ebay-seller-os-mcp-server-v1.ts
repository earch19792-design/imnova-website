import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from
  "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { z } from "zod"

import { executeSellerOsAssistantToolV1, SELLER_OS_ASSISTANT_TOOLS_V1 } from
  "./ebay-seller-os-assistant-gateway-v1"
import { loadSellerOsAssistantMonitorV1 } from "./ebay-seller-os-assistant-runtime"
import { createSellerOsCloudReadRelayExecutorV1,
  type SellerOsAssistantToolExecutorV1 } from
  "./ebay-seller-os-cloud-read-relay-v1"
import { authenticateSellerOsMcpRequestV1, loadSellerOsMcpOAuthConfigurationV1 } from
  "./ebay-seller-os-mcp-oauth-v1"
import { SELLER_OS_DEDICATED_MCP_MODE, getSellerOsDedicatedMcpDeploymentStateV1 } from
  "./ebay-seller-os-mcp-deployment-v1"
import { getSellerOsMcpRuntimePolicyV1, type SellerOsMcpApplicationAuthModeV1 } from
  "./ebay-seller-os-mcp-tunnel-development-v1"
import { SELLER_OS_MCP_BUILTIN_TOOL_POLICIES_V1,
  evaluateSellerOsMcpToolSafetyV1, getSellerOsMcpToolSecuritySchemesV1 } from
  "./ebay-seller-os-mcp-tool-policy-v1"
import { getEbayProRuntimeBoundary } from "./environment-boundaries"
import { validateAdminApiRequest } from "../supabase-admin"

export const SELLER_OS_MCP_ENDPOINT_VERSION = "SELLER_OS_MCP_READONLY_V1_2026_08_12"
export const SELLER_OS_CHATGPT_CONNECTION_STATE = Object.freeze({
  code: "CODE_COMPLETE" as const,
  humanConnection: "READY_FOR_HUMAN_CONNECTION_AFTER_APPROVED_AUTH_SETUP" as const,
  connected: false as const,
  liveToolCallProven: false as const,
  reason: "CHATGPT_OAUTH_CONNECTION_AND_LIVE_TOOL_CALL_NOT_YET_PERFORMED",
})

export function getSellerOsChatGptConnectionStateV1(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const oauth = loadSellerOsMcpOAuthConfigurationV1(environment)
  const dedicated = getSellerOsDedicatedMcpDeploymentStateV1(environment)
  const deployed = environment.VERCEL_ENV === "preview" ||
    (environment.VERCEL_ENV === "production" && dedicated.ready)
  return { ...SELLER_OS_CHATGPT_CONNECTION_STATE,
    deployment: deployed
      ? "DEPLOYED" as const : "NOT_DEPLOYED_OR_UNPROVEN" as const,
    oauthResourceServerConfigured: oauth.ok,
    deploymentTopology: dedicated.ready
      ? dedicated.topology : "SELLER_OS_ADMIN_APPLICATION" as const,
    readyForHumanConnection: deployed && oauth.ok,
  }
}

const READ_ONLY_HEADERS = { "Cache-Control": "private, no-store, max-age=0",
  "X-Seller-OS-Assistant-Mode": "READ_ONLY",
  "X-Seller-OS-MCP-Version": SELLER_OS_MCP_ENDPOINT_VERSION } as const

type SellerOsAssistantMonitorLoaderV1 = typeof loadSellerOsAssistantMonitorV1

const STANDARD_RESOURCES = [
  { id: "seller-os://system-review", title: "Seller OS system review bundle",
    toolName: "seller_os_get_system_review_bundle" },
  { id: "seller-os://strategic-review-queue", title: "Seller OS strategic review queue",
    toolName: "seller_os_get_strategic_review_queue" },
  { id: "seller-os://commercial-context", title: "Seller OS commercial context",
    toolName: "seller_os_get_commercial_context" },
] as const

function safeErrorResponse(status: number, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null },
    { status, headers: READ_ONLY_HEADERS })
}

export function getSellerOsMcpToolExecutionSourceV1(
  applicationAuthMode: SellerOsMcpApplicationAuthModeV1,
) {
  return applicationAuthMode === "TUNNEL_TRANSPORT_ONLY"
    ? "CLOUD_READ_RELAY" as const
    : "CANONICAL_RUNTIME_READ_LAYER" as const
}

export function createSellerOsMcpServerV1(options: {
  monitorLoader?: SellerOsAssistantMonitorLoaderV1
  applicationAuthMode?: SellerOsMcpApplicationAuthModeV1
  toolExecutor?: SellerOsAssistantToolExecutorV1
} = {}) {
  const applicationAuthMode = options.applicationAuthMode ??
    "OAUTH_SELLER_OS_READ"
  const toolSafety = evaluateSellerOsMcpToolSafetyV1(
    SELLER_OS_ASSISTANT_TOOLS_V1,
  )
  if (!toolSafety.allToolsReadOnly) {
    throw new Error("SELLER_OS_MCP_WRITE_TOOL_REGISTRATION_FORBIDDEN")
  }
  const securitySchemes = getSellerOsMcpToolSecuritySchemesV1(
    applicationAuthMode,
  )
  const server = new McpServer({ name: "seller-os-private-readonly",
    version: SELLER_OS_MCP_ENDPOINT_VERSION }, {
    instructions: "Private Seller OS canonical read-only evidence. Preserve unavailable and unproven states. Never claim or perform marketplace, inventory, supplier, Registry, Product Case, buyer-message, WhatsApp, OAuth, environment, SQL, or arbitrary URL mutations.",
  })
  let monitorPromise: ReturnType<typeof loadSellerOsAssistantMonitorV1> | null = null
  const monitorLoader = options.monitorLoader ?? loadSellerOsAssistantMonitorV1
  const monitor = () => (monitorPromise ??= monitorLoader())
  const localToolExecutor: SellerOsAssistantToolExecutorV1 = async (input) =>
    executeSellerOsAssistantToolV1({ toolName: input.toolName,
      arguments: input.arguments, monitor: await monitor() })
  const toolExecutor = options.toolExecutor ?? (
    getSellerOsMcpToolExecutionSourceV1(applicationAuthMode) ===
      "CLOUD_READ_RELAY"
    ? createSellerOsCloudReadRelayExecutorV1()
    : localToolExecutor)
  for (const descriptor of SELLER_OS_ASSISTANT_TOOLS_V1) {
    const needsItem = descriptor.name === "seller_os_get_listing_intelligence"
    const needsCase = descriptor.name === "seller_os_get_opportunity_case"
    const config = { title: descriptor.title,
      description: descriptor.description,
      inputSchema: { ...(needsItem ? { itemId: z.string().regex(/^\d{9,19}$/) } : {}),
        ...(needsCase ? { opportunityCaseId: z.string().min(1).max(120) } : {}),
        limit: z.number().int().min(1).max(100).optional() },
      annotations: descriptor.annotations, securitySchemes,
      _meta: { securitySchemes },
    }
    server.registerTool(descriptor.name, config, async (args) => {
      try {
        const result = await toolExecutor({ toolName: descriptor.name,
          arguments: args as Record<string, unknown> })
        return { structuredContent: { result }, content: [{ type: "text" as const,
          text: `Seller OS returned bounded read-only evidence for ${descriptor.title}.` }] }
      } catch {
        const result = { status: "SELLER_OS_EVIDENCE_READ_FAILED_CLOSED",
          credentialsIncluded: false, buyerPiiIncluded: false, marketplaceWrites: 0 }
        return { isError: true, structuredContent: { result }, content: [{ type: "text" as const,
          text: "Seller OS stopped the bounded read safely; no evidence was inferred." }] }
      }
    })
  }
  const searchConfig = {
    title: "Search Seller OS read-only resources",
    description: "Search the bounded Seller OS resource catalog. This never proxies arbitrary URLs.",
    inputSchema: { query: z.string().min(1).max(120),
      limit: z.number().int().min(1).max(20).optional() },
    annotations: SELLER_OS_MCP_BUILTIN_TOOL_POLICIES_V1[0].annotations,
    securitySchemes,
    _meta: { securitySchemes },
  }
  server.registerTool("search", searchConfig, async ({ query, limit }) => {
    const normalized = query.toLowerCase().trim()
    const resources = [
      ...(/^\d{9,19}$/.test(normalized) ? [{ id: `seller-os://listing/${normalized}`,
        title: `Seller OS listing ${normalized}`, url: `seller-os://listing/${normalized}`,
        description: "Canonical bounded listing intelligence by authoritative eBay Item ID" }] : []),
      ...STANDARD_RESOURCES.map((row) => ({ id: row.id, title: row.title,
        url: row.id, description: row.title })),
      ...SELLER_OS_ASSISTANT_TOOLS_V1.map((row) => ({ id: `seller-os://tool/${row.name}`,
        title: row.title, url: `seller-os://tool/${row.name}`, description: row.description })),
    ].filter((row) => `${row.title} ${row.description}`.toLowerCase().includes(normalized))
      .slice(0, limit ?? 10)
    return { structuredContent: { results: resources }, content: [{ type: "text" as const,
      text: JSON.stringify({ results: resources }) }] }
  })
  const fetchConfig = {
    title: "Fetch a Seller OS read-only resource",
    description: "Fetch one allowlisted Seller OS resource ID returned by search. Arbitrary URLs are rejected.",
    inputSchema: { id: z.string().min(1).max(180) },
    annotations: SELLER_OS_MCP_BUILTIN_TOOL_POLICIES_V1[1].annotations,
    securitySchemes,
    _meta: { securitySchemes },
  }
  server.registerTool("fetch", fetchConfig, async ({ id }) => {
    const standard = STANDARD_RESOURCES.find((row) => row.id === id)
    const listingMatch = /^seller-os:\/\/listing\/(\d{9,19})$/.exec(id)
    const toolMatch = /^seller-os:\/\/tool\/(seller_os_get_[a-z_]+)$/.exec(id)
    const descriptor = toolMatch ? SELLER_OS_ASSISTANT_TOOLS_V1.find((row) =>
      row.name === toolMatch[1]) : null
    if (!standard && !listingMatch && !descriptor) {
      throw new Error("SELLER_OS_FETCH_RESOURCE_NOT_ALLOWLISTED")
    }
    const toolName = standard?.toolName ?? (listingMatch
      ? "seller_os_get_listing_intelligence" : descriptor!.name)
    let result: unknown
    try {
      result = await toolExecutor({ toolName,
        arguments: listingMatch ? { itemId: listingMatch[1] } : {} })
    } catch {
      result = { status: "SELLER_OS_EVIDENCE_READ_FAILED_CLOSED",
        credentialsIncluded: false, buyerPiiIncluded: false, marketplaceWrites: 0 }
    }
    const document = { id, title: standard?.title ?? descriptor?.title ??
      `Seller OS listing ${listingMatch?.[1]}`, text: JSON.stringify(result), url: id,
      metadata: { source: "SELLER_OS_CANONICAL_READONLY", bounded: true,
        marketplaceWrites: 0 } }
    return { structuredContent: document, content: [{ type: "text" as const,
      text: JSON.stringify(document) }] }
  })
  return server
}

async function serveAuthenticatedSellerOsMcpRequestV1(
  req: Request,
  applicationAuthMode: SellerOsMcpApplicationAuthModeV1 =
    "OAUTH_SELLER_OS_READ",
) {
  const server = createSellerOsMcpServerV1({ applicationAuthMode })
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined,
    enableJsonResponse: true })
  await server.connect(transport)
  const response = await transport.handleRequest(req)
  const headers = new Headers(response.headers)
  Object.entries(READ_ONLY_HEADERS).forEach(([key, value]) => headers.set(key, value))
  return new Response(response.body, { status: response.status,
    statusText: response.statusText, headers })
}

export async function handleSellerOsMcpRequestV1(req: Request) {
  const pathname = new URL(req.url).pathname
  let applicationAuthMode: SellerOsMcpApplicationAuthModeV1 =
    "OAUTH_SELLER_OS_READ"
  let deploymentMode = "INTERNAL_ADMIN_AUTH"
  if (pathname.startsWith("/api/seller-os/")) {
    const toolSafety = evaluateSellerOsMcpToolSafetyV1(
      SELLER_OS_ASSISTANT_TOOLS_V1,
    )
    const runtimePolicy = getSellerOsMcpRuntimePolicyV1({
      assistantWriteTools: toolSafety.assistantWriteTools,
      dedicatedMode: SELLER_OS_DEDICATED_MCP_MODE,
    })
    if (!runtimePolicy.requestHandlingAllowed) {
      return safeErrorResponse(503, -32004,
        "SELLER_OS_MCP_DEPLOYMENT_MODE_NOT_ALLOWED")
    }
    applicationAuthMode = runtimePolicy.applicationAuthMode
    deploymentMode = runtimePolicy.configuredMode
    if (runtimePolicy.oauthRequired) {
      const oauth = await authenticateSellerOsMcpRequestV1(req)
      if (!oauth.ok) return oauth.response
    }
  } else {
    const validation = await validateAdminApiRequest(req)
    if (!validation.ok) return safeErrorResponse(validation.status || 401, -32001,
      "SELLER_OS_ASSISTANT_AUTH_REQUIRED")
  }
  const boundary = getEbayProRuntimeBoundary({ pathname,
    method: req.method })
  if (boundary.blocked) return safeErrorResponse(403, -32003,
    "SELLER_OS_ASSISTANT_PREVIEW_ONLY")
  const response = await serveAuthenticatedSellerOsMcpRequestV1(
    req,
    applicationAuthMode,
  )
  const headers = new Headers(response.headers)
  headers.set("X-Seller-OS-MCP-Deployment", deploymentMode)
  return new Response(response.body, { status: response.status,
    statusText: response.statusText, headers })
}

/**
 * Entry point for the route-only dedicated HTTPS service. It deliberately does
 * not inherit the admin application's Preview-only boundary: the separate app
 * contains only the OAuth-protected MCP route and RFC 9728 metadata routes.
 * Activation still fails closed until the exact dedicated mode and canonical
 * HTTPS resource URI are configured server-side.
 */
export async function handleDedicatedSellerOsMcpRequestV1(req: Request) {
  const pathname = new URL(req.url).pathname
  const deployment = getSellerOsDedicatedMcpDeploymentStateV1()
  if (!deployment.ready || pathname !== deployment.mcpPath) {
    return Response.json({ error: "temporarily_unavailable",
      error_description: "The dedicated Seller OS MCP resource is not activated." }, {
      status: 503,
      headers: READ_ONLY_HEADERS,
    })
  }
  const oauth = await authenticateSellerOsMcpRequestV1(req)
  if (!oauth.ok) return oauth.response
  const response = await serveAuthenticatedSellerOsMcpRequestV1(req)
  const headers = new Headers(response.headers)
  headers.set("X-Seller-OS-MCP-Deployment", deployment.deploymentMode)
  return new Response(response.body, { status: response.status,
    statusText: response.statusText, headers })
}
