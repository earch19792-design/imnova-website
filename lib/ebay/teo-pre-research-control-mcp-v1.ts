import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from
  "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { z } from "zod"

import { getEbaySellerAccountScopeConfiguration } from
  "./ebay-seller-account-scope"
import {
  authenticateSellerOsControlRequestV1,
  loadSellerOsControlOAuthConfigurationV1,
  type SellerOsControlPrincipalV1,
} from "./teo-pre-research-control-oauth-v1"
import {
  getTeoCommercialTraceV1,
  parseTeoCommercialTraceGetV1,
  parseTeoCommercialTraceRequestV1,
  requestTeoCommercialTraceV1,
} from "./teo-commercial-trace-control-v1"
import {
  TEO_PRE_RESEARCH_CONTRACT_V1,
  TEO_PRE_RESEARCH_MAXIMUM_LIST_ROWS_V1,
  listTeoPreResearchBatchesV1,
  parseTeoPreResearchGetV1,
  parseTeoPreResearchRequestV1,
  readTeoPreResearchBatchV1,
  requestTeoPreResearchBatchV1,
  resumeTeoPreResearchBatchV1,
} from "./teo-pre-research-control-plane-v1"
import { getSupabaseAdminClient } from "../supabase-admin"

export const SELLER_OS_CONTROL_TOOL_NAMES_V1 = Object.freeze([
  "seller_os_request_pre_research_batch",
  "seller_os_get_pre_research_batch",
  "seller_os_resume_pre_research_batch",
  "seller_os_list_pre_research_batches",
  "seller_os_request_commercial_trace",
  "seller_os_get_commercial_trace",
] as const)

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0",
  "X-Seller-OS-Control-Mode": "BOUNDED_PRE_RESEARCH_AND_COMMERCIAL_TRACE_V1",
  "X-Seller-OS-Marketplace-Write-Capability": "ABSENT" })
const securitySchemes = [{ type: "oauth2" as const,
  scopes: ["openid", "profile"] }]
const candidate = z.object({ productId: z.string().regex(/^\d{1,30}$/),
  variantId: z.string().regex(/^\d{1,30}$/),
  sku: z.string().min(1).max(160) }).strict()
const listedBatch = z.object({ batchId: z.string().uuid(),
  status: z.enum(["REQUESTED", "AUTHORIZED", "RUNNING", "NEEDS_ATTENTION",
  "COMPLETED", "CANCELLED"]), createdAt: z.string(), updatedAt: z.string(),
  candidateCount: z.number().int().min(1).max(50),
  contractVersion: z.literal(TEO_PRE_RESEARCH_CONTRACT_V1) }).strict()

function toolResult(result: unknown, text: string) {
  return { structuredContent: { result }, content: [{ type: "text" as const,
    text }] }
}

function createServer(principal: SellerOsControlPrincipalV1) {
  const server = new McpServer({ name: "IMNOVA Seller OS - Control",
    version: "1.0.0" })
  const context = () => {
    const account = getEbaySellerAccountScopeConfiguration()
    const oauth = loadSellerOsControlOAuthConfigurationV1()
    if (!account.accountKey) throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
    if (!oauth) throw new Error("SELLER_OS_CONTROL_OAUTH_CONFIGURATION_REQUIRED")
    return { supabase: getSupabaseAdminClient(), accountKey: account.accountKey,
      oauthResource: oauth.resource, principal }
  }
  server.registerTool(SELLER_OS_CONTROL_TOOL_NAMES_V1[0], {
    title: "Request bounded normal Pre-Research batch",
    description: "Create or reuse one authorized bounded NORMAL Luna Pre-Research batch. This never runs Publisher, Commercial Trace, StockGuard, or marketplace writes.",
    inputSchema: z.object({ snapshotId: z.string().uuid(),
      clientIdempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/),
      candidates: z.array(candidate).min(1).max(50) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false,
      idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes },
  }, async (args) => {
    const request = parseTeoPreResearchRequestV1(args)
    const result = await requestTeoPreResearchBatchV1({ ...context(), ...request })
    return toolResult(result, "Seller OS created or reused the bounded normal Pre-Research batch.")
  })
  server.registerTool(SELLER_OS_CONTROL_TOOL_NAMES_V1[1], {
    title: "Get Pre-Research batch",
    description: "Read bounded durable status, accepted comparable authority, blockers, and evidence for one authorized batch.",
    inputSchema: z.object({ batchId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false,
      idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes },
  }, async (args) => {
    const request = parseTeoPreResearchGetV1(args)
    const result = await readTeoPreResearchBatchV1({ ...context(), ...request })
    return toolResult(result, "Seller OS returned the durable bounded Pre-Research batch readback.")
  })
  server.registerTool(SELLER_OS_CONTROL_TOOL_NAMES_V1[2], {
    title: "Resume retry-safe Pre-Research batch members",
    description: "Resume only retry-safe unfinished members of the exact authorized batch. Membership and contract cannot change.",
    inputSchema: z.object({ batchId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false,
      idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes },
  }, async (args) => {
    const request = parseTeoPreResearchGetV1(args)
    const result = await resumeTeoPreResearchBatchV1({ ...context(), ...request })
    return toolResult(result, "Seller OS resumed only retry-safe members of the authorized batch.")
  })
  server.registerTool(SELLER_OS_CONTROL_TOOL_NAMES_V1[3], {
    title: "List authorized normal Pre-Research batches",
    description: "Read up to 25 authorized NORMAL Pre-Research V2 batches belonging to the authenticated owner. This performs no mutations.",
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ result: z.object({
      batches: z.array(listedBatch).max(TEO_PRE_RESEARCH_MAXIMUM_LIST_ROWS_V1),
      count: z.number().int().min(0).max(TEO_PRE_RESEARCH_MAXIMUM_LIST_ROWS_V1),
      maximumRows: z.literal(TEO_PRE_RESEARCH_MAXIMUM_LIST_ROWS_V1),
    }).strict() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false,
      idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes },
  }, async () => {
    const result = await listTeoPreResearchBatchesV1(context())
    return toolResult(result, `Seller OS returned ${result.count} authorized normal Pre-Research batches.`)
  })
  server.registerTool(SELLER_OS_CONTROL_TOOL_NAMES_V1[4], {
    title: "Request bounded Commercial Trace",
    description: "Run or reuse one idempotent canonical Commercial Trace for an exact Luna product/variant/SKU whose durable Product Truth receipt passes the Trace entry contract. This never runs Publisher or writes to a marketplace.",
    inputSchema: z.object({ productId: z.string().regex(/^\d{1,30}$/),
      variantId: z.string().regex(/^\d{1,30}$/),
      sku: z.string().min(1).max(160),
      clientIdempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false,
      idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes },
  }, async (args) => {
    const request = parseTeoCommercialTraceRequestV1(args)
    const result = await requestTeoCommercialTraceV1({ ...context(), ...request })
    return toolResult(result,
      "Seller OS ran or reused the bounded canonical Commercial Trace.")
  })
  server.registerTool(SELLER_OS_CONTROL_TOOL_NAMES_V1[5], {
    title: "Get bounded Commercial Trace",
    description: "Read status, decision, blockers, Product Truth receipt provenance, economics, and readiness for one OWNER-authorized Commercial Trace.",
    inputSchema: z.object({ traceId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false,
      idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes },
  }, async (args) => {
    const request = parseTeoCommercialTraceGetV1(args)
    const result = await getTeoCommercialTraceV1({ ...context(), ...request })
    return toolResult(result,
      "Seller OS returned the bounded durable Commercial Trace readback.")
  })
  return server
}

export async function handleSellerOsControlMcpRequestV1(request: Request) {
  if (request.method !== "POST") return Response.json({ jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." }, id: null }, {
    status: 405, headers: { ...HEADERS, Allow: "POST" },
  })
  const auth = await authenticateSellerOsControlRequestV1(request)
  if (!auth.ok) return auth.response
  const server = createServer(auth.principal)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  const response = await transport.handleRequest(request)
  const headers = new Headers(response.headers)
  Object.entries(HEADERS).forEach(([key, value]) => headers.set(key, value))
  return new Response(response.body, { status: response.status,
    statusText: response.statusText, headers })
}
