import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from
  "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { z } from "zod"
import { registerGoldenPathControlToolsV1, GOLDEN_PATH_MCP_TOOL_NAMES_V1 } from "./commercial-golden-path-mcp-v1"
import { goldenDigest, goldenRecord } from "./commercial-golden-path-domain-v1"

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
import { readSellerOsRevenueControlPlaneV1 } from
  "./seller-os-revenue-control-plane-v1"
import { FAST_LUNA_TEST_BATCH_MAXIMUM_COUNT_V1,
  readFastLunaTestBatchV1, startFastLunaTestBatchV1,
  startUniversalLunaDirectBatchV1 } from
  "./ebay-autonomous-stocking-batch-server-v1"

export const SELLER_OS_CONTROL_TOOL_NAMES_V1 = Object.freeze([
  "seller_os_request_pre_research_batch",
  "seller_os_get_pre_research_batch",
  "seller_os_resume_pre_research_batch",
  "seller_os_list_pre_research_batches",
  "seller_os_request_commercial_trace",
  "seller_os_get_commercial_trace",
  "seller_os_get_revenue_control_plane",
  "seller_os_publish_luna_test_batch_v1",
  "seller_os_get_luna_test_batch_v1",
  "seller_os_publish_luna_products_v1",
] as const)

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0",
  "X-Seller-OS-Control-Mode": "BOUNDED_OWNER_CONTROL_V1",
  "X-Seller-OS-Marketplace-Write-Capability":
    "OWNER_AUTHORIZED_FAST_LUNA_TEST_BATCH_ONLY" })
const securitySchemes = [{ type: "oauth2" as const,
  scopes: ["openid", "profile"] }]
export const SELLER_OS_CONTROL_SERVER_VERSION_V1 = "1.6.0"
export function readSellerOsControlRegisteredCatalogV1(server: McpServer, resource: string) {
  // The pinned SDK registry reflects actual successful registration. This is a
  // diagnostic readback, never a substitute for ChatGPT's imported tools/list.
  const registry = goldenRecord((server as unknown as { _registeredTools?: unknown })._registeredTools)
  const names = Object.keys(registry).filter(name => goldenRecord(registry[name]).enabled === true).sort()
  const goldenNames = names.filter(name => (GOLDEN_PATH_MCP_TOOL_NAMES_V1 as readonly string[]).includes(name))
  return { source: "AUTHENTICATED_MCP_SERVER_REGISTRATION_READBACK", discoveryScope: "SERVER_REGISTRY_NOT_CHATGPT_IMPORTED_CATALOG", serverVersion: SELLER_OS_CONTROL_SERVER_VERSION_V1, resource, toolCount: names.length, toolNames: names, goldenToolNames: goldenNames, goldenRegistrationStatus: goldenNames.length === GOLDEN_PATH_MCP_TOOL_NAMES_V1.length ? "COMPLETE" : "UNPROVEN", catalogDigest: goldenDigest({ serverVersion: SELLER_OS_CONTROL_SERVER_VERSION_V1, resource, names }), marketplaceWriteCapability: "OWNER_AUTHORIZED_FAST_LUNA_TEST_BATCH_ONLY" }
}
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

export function createServer(principal: SellerOsControlPrincipalV1) {
  const server = new McpServer({ name: "IMNOVA Seller OS - Control",
    version: SELLER_OS_CONTROL_SERVER_VERSION_V1 })
  const goldenOAuth = loadSellerOsControlOAuthConfigurationV1()
  if (goldenOAuth) registerGoldenPathControlToolsV1(server, principal, goldenOAuth.resource)
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
    return toolResult({ ...result, controlCatalog: readSellerOsControlRegisteredCatalogV1(server, loadSellerOsControlOAuthConfigurationV1()!.resource) },
      "Seller OS returned the bounded durable Commercial Trace readback.")
  })
  server.registerTool(SELLER_OS_CONTROL_TOOL_NAMES_V1[6], {
    title: "Get current LIVE revenue control plane",
    description: "Read one bounded, source-backed EBAY_LIVE_ITEM portfolio snapshot with identity, stock, shipping, analytics, orders, research and economics. Never writes to a marketplace.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false,
      idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes },
  }, async () => {
    const account = getEbaySellerAccountScopeConfiguration()
    if (!account.accountKey || !account.accountAlias) {
      throw new Error("REVENUE_CONTROL_ACCOUNT_SCOPE_REQUIRED")
    }
    const result = await readSellerOsRevenueControlPlaneV1({
      supabase: getSupabaseAdminClient(), accountKey: account.accountKey,
      accountAlias: account.accountAlias })
    return toolResult(result,
      `Seller OS returned ${result.portfolioCount ?? "unavailable"} current LIVE portfolio rows.`)
  })
  server.registerTool(SELLER_OS_CONTROL_TOOL_NAMES_V1[7], {
    title: "Publish 1 to 4 Luna controlled-test listings",
    description: "Authorize one idempotent owner-bound batch of 1 to 4 Luna listings through the existing CURRENT publisher. Selection uses fresh exact Luna Product Truth without querying eBay market or demand. Complete costs, canonical economics, stock, duplicate, category, compliance, image, account policy, official publication readback and zero-write replay gates remain fail-closed.",
    inputSchema: z.object({
      targetCount: z.number().int().min(1)
        .max(FAST_LUNA_TEST_BATCH_MAXIMUM_COUNT_V1),
      clientIdempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true,
      idempotentHint: true, openWorldHint: true },
    _meta: { securitySchemes },
  }, async (args) => {
    const current = context()
    const result = await startFastLunaTestBatchV1({
      supabase: current.supabase,
      accountKey: current.accountKey,
      ownerUserId: current.principal.ownerUserId,
      commandClientId: current.principal.commandClientId,
      targetCount: args.targetCount,
      clientIdempotencyKey: args.clientIdempotencyKey,
      confirmation: `PUBLICAR ${args.targetCount} LISTINGS DE LUNA`,
    })
    return toolResult(result,
      `Seller OS authorized the owner-bound Luna test batch for ${args.targetCount} listings.`)
  })
  server.registerTool(SELLER_OS_CONTROL_TOOL_NAMES_V1[8], {
    title: "Get Luna controlled-test batch",
    description: "Read the durable batch, each child, blockers, listing IDs, official readback and idempotent replay for one owner-authorized Luna test batch.",
    inputSchema: z.object({ batchId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false,
      idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes },
  }, async (args) => {
    const current = context()
    const result = await readFastLunaTestBatchV1({
      supabase: current.supabase,
      accountKey: current.accountKey,
      ownerUserId: current.principal.ownerUserId,
      batchId: args.batchId,
    })
    return toolResult(result,
      "Seller OS returned the durable Luna test batch readback.")
  })
  server.registerTool(SELLER_OS_CONTROL_TOOL_NAMES_V1[9], {
    title: "Publish any 1 to 4 Luna products",
    description: "Use this when the owner says 'TEO publícame N productos de Luna en eBay'. With no productReferences, Seller OS selects N fresh in-stock Luna products. With SKU/ITEM or Luna URLs, it resolves and publishes exactly those products in the requested order. It does not require eBay market or demand evidence. Stock, complete traceable cost, canonical ROI and margin, duplicate, category, compliance, images, eBay permission, official readback and idempotent replay remain fail-closed.",
    inputSchema: z.object({
      targetCount: z.number().int().min(1)
        .max(FAST_LUNA_TEST_BATCH_MAXIMUM_COUNT_V1),
      productReferences: z.array(z.string().min(1).max(500))
        .min(1).max(FAST_LUNA_TEST_BATCH_MAXIMUM_COUNT_V1).optional(),
      clientIdempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true,
      idempotentHint: true, openWorldHint: true },
    _meta: { securitySchemes },
  }, async (args) => {
    const current = context()
    const result = await startUniversalLunaDirectBatchV1({
      supabase: current.supabase,
      accountKey: current.accountKey,
      ownerUserId: current.principal.ownerUserId,
      commandClientId: current.principal.commandClientId,
      targetCount: args.targetCount,
      productReferences: args.productReferences,
      clientIdempotencyKey: args.clientIdempotencyKey,
    })
    return toolResult(result,
      `Seller OS authorized the universal Luna batch for ${args.targetCount} listings.`)
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
