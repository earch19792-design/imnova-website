export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from
  "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { z } from "zod"

import { getCommercialMonitorReadonly } from
  "@/lib/ebay/commercial-monitor-readonly-service"
import { getEbayCommercialMonitorLiveReadonly } from
  "@/lib/ebay/ebay-commercial-monitor-live-readonly"
import { executeSellerOsAssistantToolV1, SELLER_OS_ASSISTANT_TOOLS_V1 } from
  "@/lib/ebay/ebay-seller-os-assistant-gateway-v1"
import { getEbayProRuntimeBoundary } from "@/lib/ebay/environment-boundaries"
import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"

const READ_ONLY_HEADERS = { "Cache-Control": "private, no-store, max-age=0",
  "X-Seller-OS-Assistant-Mode": "READ_ONLY" } as const

async function loadMonitor() {
  const account = getEbaySellerAccountScopeConfiguration()
  const live = await getEbayCommercialMonitorLiveReadonly({ accountKey: account.accountKey,
    accountAlias: account.accountAlias })
  return getCommercialMonitorReadonly(account.accountKey ? getSupabaseAdminClient() : null,
    { accountKey: account.accountKey, accountAlias: account.accountAlias,
      configurationReason: account.reason }, live)
}

function createServer() {
  const server = new McpServer({ name: "seller-os-internal-readonly", version: "1.0.0" }, {
    instructions: "Private Seller OS read-only evidence. Never claim or perform marketplace mutations. Preserve unavailable and unproven states; never replace them with zero.",
  })
  let monitorPromise: ReturnType<typeof loadMonitor> | null = null
  for (const descriptor of SELLER_OS_ASSISTANT_TOOLS_V1) {
    const needsItem = descriptor.name === "seller_os_get_listing_intelligence"
    const needsCase = descriptor.name === "seller_os_get_opportunity_case"
    const config = { title: descriptor.title, description: descriptor.description,
      inputSchema: { ...(needsItem ? { itemId: z.string().regex(/^\d{9,19}$/) } : {}),
        ...(needsCase ? { opportunityCaseId: z.string().min(1).max(120) } : {}),
        limit: z.number().int().min(1).max(100).optional() },
      annotations: descriptor.annotations, securitySchemes: descriptor.securitySchemes }
    server.registerTool(descriptor.name, config, async (args) => {
      monitorPromise ??= loadMonitor()
      const result = executeSellerOsAssistantToolV1({ toolName: descriptor.name,
        arguments: args as Record<string, unknown>, monitor: await monitorPromise })
      return { structuredContent: { result }, content: [{ type: "text" as const,
        text: `Seller OS returned bounded read-only evidence for ${descriptor.title}.` }] }
    })
  }
  return server
}

async function handle(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return Response.json({ jsonrpc: "2.0", error: { code: -32001,
    message: "SELLER_OS_ASSISTANT_ADMIN_AUTH_REQUIRED" }, id: null },
  { status: validation.status || 401, headers: READ_ONLY_HEADERS })
  const boundary = getEbayProRuntimeBoundary({ pathname: new URL(req.url).pathname,
    method: req.method })
  if (boundary.blocked) return Response.json({ jsonrpc: "2.0", error: { code: -32003,
    message: "SELLER_OS_ASSISTANT_PREVIEW_ONLY" }, id: null },
  { status: 403, headers: READ_ONLY_HEADERS })
  const server = createServer()
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined,
    enableJsonResponse: true })
  await server.connect(transport)
  const response = await transport.handleRequest(req)
  const headers = new Headers(response.headers)
  Object.entries(READ_ONLY_HEADERS).forEach(([key, value]) => headers.set(key, value))
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export const GET = handle
export const POST = handle
export const DELETE = handle
