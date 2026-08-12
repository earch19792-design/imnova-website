import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from
  "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { z } from "zod"

import { executeSellerOsAssistantToolV1, SELLER_OS_ASSISTANT_TOOLS_V1 } from
  "./ebay-seller-os-assistant-gateway-v1"
import { loadSellerOsAssistantMonitorV1 } from "./ebay-seller-os-assistant-runtime"
import { authenticateSellerOsMcpRequestV1, loadSellerOsMcpOAuthConfigurationV1 } from
  "./ebay-seller-os-mcp-oauth-v1"
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
  return { ...SELLER_OS_CHATGPT_CONNECTION_STATE,
    deployment: environment.VERCEL_ENV === "preview"
      ? "DEPLOYED" as const : "NOT_DEPLOYED_OR_UNPROVEN" as const,
    oauthResourceServerConfigured: oauth.ok,
    readyForHumanConnection: environment.VERCEL_ENV === "preview" && oauth.ok,
  }
}

const READ_ONLY_HEADERS = { "Cache-Control": "private, no-store, max-age=0",
  "X-Seller-OS-Assistant-Mode": "READ_ONLY",
  "X-Seller-OS-MCP-Version": SELLER_OS_MCP_ENDPOINT_VERSION } as const

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

export function createSellerOsMcpServerV1() {
  const server = new McpServer({ name: "seller-os-private-readonly",
    version: SELLER_OS_MCP_ENDPOINT_VERSION }, {
    instructions: "Private Seller OS canonical read-only evidence. Preserve unavailable and unproven states. Never claim or perform marketplace, inventory, supplier, Registry, Product Case, buyer-message, WhatsApp, OAuth, environment, SQL, or arbitrary URL mutations.",
  })
  let monitorPromise: ReturnType<typeof loadSellerOsAssistantMonitorV1> | null = null
  const monitor = () => (monitorPromise ??= loadSellerOsAssistantMonitorV1())
  for (const descriptor of SELLER_OS_ASSISTANT_TOOLS_V1) {
    const needsItem = descriptor.name === "seller_os_get_listing_intelligence"
    const needsCase = descriptor.name === "seller_os_get_opportunity_case"
    const config = { title: descriptor.title,
      description: descriptor.description,
      inputSchema: { ...(needsItem ? { itemId: z.string().regex(/^\d{9,19}$/) } : {}),
        ...(needsCase ? { opportunityCaseId: z.string().min(1).max(120) } : {}),
        limit: z.number().int().min(1).max(100).optional() },
      annotations: descriptor.annotations, securitySchemes: descriptor.securitySchemes,
      _meta: { securitySchemes: descriptor.securitySchemes },
    }
    server.registerTool(descriptor.name, config, async (args) => {
      try {
        const result = executeSellerOsAssistantToolV1({ toolName: descriptor.name,
          arguments: args as Record<string, unknown>, monitor: await monitor() })
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
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false,
      idempotentHint: true },
    securitySchemes: [{ type: "oauth2" as const, scopes: ["seller_os.read"] }],
    _meta: { securitySchemes: [{ type: "oauth2", scopes: ["seller_os.read"] }] },
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
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false,
      idempotentHint: true },
    securitySchemes: [{ type: "oauth2" as const, scopes: ["seller_os.read"] }],
    _meta: { securitySchemes: [{ type: "oauth2", scopes: ["seller_os.read"] }] },
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
      result = executeSellerOsAssistantToolV1({ toolName,
        arguments: listingMatch ? { itemId: listingMatch[1] } : {}, monitor: await monitor() })
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

export async function handleSellerOsMcpRequestV1(req: Request) {
  const pathname = new URL(req.url).pathname
  if (pathname.startsWith("/api/seller-os/")) {
    const oauth = await authenticateSellerOsMcpRequestV1(req)
    if (!oauth.ok) return oauth.response
  } else {
    const validation = await validateAdminApiRequest(req)
    if (!validation.ok) return safeErrorResponse(validation.status || 401, -32001,
      "SELLER_OS_ASSISTANT_AUTH_REQUIRED")
  }
  const boundary = getEbayProRuntimeBoundary({ pathname,
    method: req.method })
  if (boundary.blocked) return safeErrorResponse(403, -32003,
    "SELLER_OS_ASSISTANT_PREVIEW_ONLY")
  const server = createSellerOsMcpServerV1()
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined,
    enableJsonResponse: true })
  await server.connect(transport)
  const response = await transport.handleRequest(req)
  const headers = new Headers(response.headers)
  Object.entries(READ_ONLY_HEADERS).forEach(([key, value]) => headers.set(key, value))
  return new Response(response.body, { status: response.status,
    statusText: response.statusText, headers })
}
