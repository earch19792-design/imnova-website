import { resolve } from "node:path"

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from
  "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { z } from "zod"

import { executeSellerOsAssistantToolV1, SELLER_OS_ASSISTANT_TOOLS_V1 } from
  "./ebay-seller-os-assistant-gateway-v1"
import { collectSellerOsOfficialOrdersReadV1,
  collectSellerOsBuyerThankYouStatusV1,
  collectSellerOsLunaSupplierLinkageStatusV1,
  collectSellerOsLunaStockObservationStatusV1,
  collectSellerOsWhatsappSaleAlertStatusV1,
  loadSellerOsAssistantMonitorV1 } from "./ebay-seller-os-assistant-runtime"
import { createSellerOsCloudReadRelayExecutorV1,
  SELLER_OS_EBAY_TRADING_RATE_LIMIT_RELAY_OPERATION_V1,
  SELLER_OS_LUNA_SUPPLIER_LINKAGE_RELAY_OPERATION_V1,
  type SellerOsAssistantToolExecutorV1 } from
  "./ebay-seller-os-cloud-read-relay-v1"
import { collectSellerOsLongitudinalOpportunityReadV1 } from
  "./ebay-longitudinal-opportunity-radar-read-v1"
import { authenticateSellerOsMcpRequestV1, loadSellerOsMcpOAuthConfigurationV1 } from
  "./ebay-seller-os-mcp-oauth-v1"
import { SELLER_OS_DEDICATED_MCP_MODE, getSellerOsDedicatedMcpDeploymentStateV1 } from
  "./ebay-seller-os-mcp-deployment-v1"
import { getSellerOsMcpRuntimePolicyV1, type SellerOsMcpApplicationAuthModeV1 } from
  "./ebay-seller-os-mcp-tunnel-development-v1"
import { SELLER_OS_MCP_BUILTIN_TOOL_POLICIES_V1,
  evaluateSellerOsMcpToolSafetyV1, getSellerOsMcpToolSecuritySchemesV1 } from
  "./ebay-seller-os-mcp-tool-policy-v1"
import { attestSellerOsRuntimeCatalogV1, collectSellerOsRuntimeHealthV1,
  createUnavailableSellerOsRuntimeHealthV1,
  SELLER_OS_RUNTIME_HEALTH_TOOL_V1,
  type SellerOsRuntimeHealthV1 } from "./ebay-seller-os-runtime-health-v1"
import { collectSellerOsDevStatusV1,
  createUnavailableSellerOsDevStatusV1,
  SELLER_OS_CANONICAL_REPOSITORY_V1,
  SELLER_OS_DEV_STATUS_TOOL_V1,
  type SellerOsDevStatusV1 } from "./ebay-seller-os-dev-status-v1"
import { collectSellerOsCiStatusV1,
  createUnavailableSellerOsCiStatusV1,
  SELLER_OS_CI_STATUS_TOOL_V1,
  type SellerOsCiStatusV1 } from "./ebay-seller-os-ci-status-v1"
import { collectSellerOsDataStatusV1,
  createUnavailableSellerOsDataStatusV1,
  SELLER_OS_DATA_STATUS_TOOL_V1,
  type SellerOsDataStatusV1 } from "./ebay-seller-os-data-status-v1"
import { createUnavailableSellerOsOfficialOrdersReadV1,
  SELLER_OS_OFFICIAL_ORDERS_TOOL_V1,
  type SellerOsOfficialOrdersReadV1 } from "./ebay-official-orders-read-v1"
import { buildSellerOsSalesOrderEventsReadV1,
  SELLER_OS_SALES_ORDER_EVENTS_TOOL_V1,
  type SellerOsSalesOrderEventsReadV1 } from
  "./ebay-sales-order-events-read-v1"
import { buildSellerOsRecentSalesFeedV1,
  SELLER_OS_RECENT_SALES_FEED_TOOL_V1,
  type SellerOsRecentSalesFeedV1 } from
  "./ebay-sales-order-read-model-v1"
import { buildSellerOsSaleAlertsReadV1,
  SELLER_OS_SALE_ALERTS_TOOL_V1,
  type SellerOsSaleAlertsReadV1 } from "./ebay-sale-alerts-read-v1"
import { createUnavailableSellerOsWhatsappSaleAlertStatusV1,
  SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_TOOL_V1,
  type SellerOsWhatsappSaleAlertStatusV1 } from
  "./ebay-whatsapp-sale-alert-v1"
import { createUnavailableSellerOsBuyerThankYouStatusV1,
  SELLER_OS_BUYER_THANK_YOU_STATUS_TOOL_V1,
  type SellerOsBuyerThankYouStatusV1 } from
  "./ebay-post-purchase-buyer-message-v1"
import { getSellerOsCrossPhaseFoundationV1 } from
  "./ebay-seller-os-cross-phase-foundation-v1"
import { buildSellerOsPostPurchaseAutomationGateV1,
  createUnavailableSellerOsPostPurchaseAutomationGateV1,
  SELLER_OS_POST_PURCHASE_AUTOMATION_GATE_RESOURCE_V1,
  type SellerOsPostPurchaseAutomationGateV1 } from
  "./ebay-post-purchase-automation-gate-v1"
import { createUnavailableSellerOsLunaSupplierLinkageStatusV1,
  SELLER_OS_LUNA_SUPPLIER_LINKAGE_RESOURCE_V1,
  type SellerOsLunaSupplierLinkageReadV1 } from
  "./ebay-luna-supplier-linkage-certification-v1"
import { createSellerOsLunaStockObservationPrebuildStatusV1,
  SELLER_OS_LUNA_STOCK_OBSERVATION_RESOURCE_V1,
  type SellerOsLunaStockObservationStatusReadV1 } from
  "./ebay-luna-stock-observation-v1"
import { collectSellerOsEbayTradingRateLimitStatusV1,
  createUnavailableSellerOsEbayTradingRateLimitStatusV1,
  SELLER_OS_EBAY_TRADING_RATE_LIMIT_RESOURCE_V1,
  type SellerOsEbayTradingRateLimitStatusV1 } from
  "./ebay-trading-rate-limit-observability-v1"
import { getEbayProRuntimeBoundary } from "./environment-boundaries"
import { validateAdminApiRequest } from "../supabase-admin"

export const SELLER_OS_MCP_ENDPOINT_VERSION =
  "SELLER_OS_MCP_READONLY_V1_2026_08_22_P2_I01A_RATE_LIMIT"
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

const SELLER_OS_MCP_TOOL_POLICIES_V1 = Object.freeze([
  ...SELLER_OS_ASSISTANT_TOOLS_V1,
  SELLER_OS_RUNTIME_HEALTH_TOOL_V1,
  SELLER_OS_DEV_STATUS_TOOL_V1,
  SELLER_OS_CI_STATUS_TOOL_V1,
  SELLER_OS_DATA_STATUS_TOOL_V1,
  SELLER_OS_OFFICIAL_ORDERS_TOOL_V1,
  SELLER_OS_SALES_ORDER_EVENTS_TOOL_V1,
  SELLER_OS_RECENT_SALES_FEED_TOOL_V1,
  SELLER_OS_SALE_ALERTS_TOOL_V1,
  SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_TOOL_V1,
  SELLER_OS_BUYER_THANK_YOU_STATUS_TOOL_V1,
])

const SELLER_OS_MCP_EXPECTED_TOOL_NAMES_V1 = Object.freeze([
  ...SELLER_OS_ASSISTANT_TOOLS_V1.map((tool) => tool.name),
  SELLER_OS_RUNTIME_HEALTH_TOOL_V1.name,
  SELLER_OS_DEV_STATUS_TOOL_V1.name,
  SELLER_OS_CI_STATUS_TOOL_V1.name,
  SELLER_OS_DATA_STATUS_TOOL_V1.name,
  SELLER_OS_OFFICIAL_ORDERS_TOOL_V1.name,
  SELLER_OS_SALES_ORDER_EVENTS_TOOL_V1.name,
  SELLER_OS_RECENT_SALES_FEED_TOOL_V1.name,
  SELLER_OS_SALE_ALERTS_TOOL_V1.name,
  SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_TOOL_V1.name,
  SELLER_OS_BUYER_THANK_YOU_STATUS_TOOL_V1.name,
  "search",
  "fetch",
])

export const SELLER_OS_MCP_EXPECTED_CATALOG_COUNT_V1 =
  SELLER_OS_MCP_EXPECTED_TOOL_NAMES_V1.length

type SellerOsAssistantMonitorLoaderV1 = typeof loadSellerOsAssistantMonitorV1

const STANDARD_RESOURCES = [
  { id: "seller-os://system-review", title: "Seller OS system review bundle",
    toolName: "seller_os_get_system_review_bundle" },
  { id: "seller-os://strategic-review-queue", title: "Seller OS strategic review queue",
    toolName: "seller_os_get_strategic_review_queue" },
  { id: "seller-os://commercial-context", title: "Seller OS commercial context",
    toolName: "seller_os_get_commercial_context" },
] as const

const CROSS_PHASE_FOUNDATION_RESOURCES = [
  { id: "seller-os://cross-phase/reuse-map",
    title: "Seller OS cross-phase reuse map",
    description: "Versioned canonical owners, consumers, classifications, extension rules and deprecations for Phases 1-10 and 6B.",
    kind: "REUSE_MAP" },
  { id: "seller-os://cross-phase/reuse-policy",
    title: "Seller OS cross-phase reuse policy",
    description: "Versioned anti-duplication, identity, evidence, provenance, status, safety, retry, audit, authority, bounds, freshness and human-review rules.",
    kind: "REUSE_POLICY" },
] as const

const PHASE_ONE_CERTIFICATION_RESOURCES = [
  { ...SELLER_OS_POST_PURCHASE_AUTOMATION_GATE_RESOURCE_V1,
    kind: "POST_PURCHASE_AUTOMATION_GATE" as const },
] as const

const PHASE_TWO_CERTIFICATION_RESOURCES = [
  { ...SELLER_OS_LUNA_SUPPLIER_LINKAGE_RESOURCE_V1,
    kind: "LUNA_SUPPLIER_LINKAGE" as const },
  { ...SELLER_OS_LUNA_STOCK_OBSERVATION_RESOURCE_V1,
    kind: "LUNA_STOCK_OBSERVATION" as const },
  { ...SELLER_OS_EBAY_TRADING_RATE_LIMIT_RESOURCE_V1,
    kind: "EBAY_TRADING_RATE_LIMIT" as const },
] as const

const DEDICATED_READ_TOOLS = Object.freeze([
  SELLER_OS_OFFICIAL_ORDERS_TOOL_V1,
  SELLER_OS_SALES_ORDER_EVENTS_TOOL_V1,
  SELLER_OS_RECENT_SALES_FEED_TOOL_V1,
  SELLER_OS_SALE_ALERTS_TOOL_V1,
  SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_TOOL_V1,
  SELLER_OS_BUYER_THANK_YOU_STATUS_TOOL_V1,
])

function safeErrorResponse(status: number, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null },
    { status, headers: READ_ONLY_HEADERS })
}

function statelessMethodNotAllowedResponse() {
  return Response.json({ jsonrpc: "2.0", error: { code: -32000,
    message: "Method not allowed." }, id: null }, {
    status: 405,
    headers: { ...READ_ONLY_HEADERS, Allow: "POST" },
  })
}

function officialOrdersRelayResultV1(value: unknown): SellerOsOfficialOrdersReadV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SELLER_OS_OFFICIAL_ORDERS_RELAY_RESPONSE_INVALID")
  }
  const result = value as Record<string, unknown>
  const safety = result.safety
  if (result.contractVersion !== "SELLER_OS_OFFICIAL_ORDERS_READ_V1" ||
      result.source !== "EBAY_SELL_FULFILLMENT_GET_ORDERS" ||
      result.bounded !== true || !safety || typeof safety !== "object" ||
      Array.isArray(safety) ||
      (safety as Record<string, unknown>).readOnly !== true ||
      (safety as Record<string, unknown>).buyerPiiIncluded !== false ||
      (safety as Record<string, unknown>).credentialsIncluded !== false ||
      (safety as Record<string, unknown>).environmentValuesIncluded !== false ||
      (safety as Record<string, unknown>).marketplaceWrites !== 0 ||
      (safety as Record<string, unknown>).databaseWrites !== 0) {
    throw new Error("SELLER_OS_OFFICIAL_ORDERS_RELAY_RESPONSE_INVALID")
  }
  return value as SellerOsOfficialOrdersReadV1
}

function whatsappSaleAlertStatusRelayResultV1(
  value: unknown,
): SellerOsWhatsappSaleAlertStatusV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SELLER_OS_WHATSAPP_SALE_ALERT_RELAY_RESPONSE_INVALID")
  }
  const result = value as Record<string, unknown>
  const safety = result.safety
  if (result.contractVersion !==
      "SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_V1" ||
      result.bounded !== true || !safety || typeof safety !== "object" ||
      Array.isArray(safety) ||
      (safety as Record<string, unknown>).readOnlyCertificationSurface !== true ||
      (safety as Record<string, unknown>).buyerPiiIncluded !== false ||
      (safety as Record<string, unknown>).credentialsIncluded !== false ||
      (safety as Record<string, unknown>).environmentValuesIncluded !== false ||
      (safety as Record<string, unknown>).phoneNumberIncluded !== false ||
      (safety as Record<string, unknown>).whatsappSendsByThisRead !== 0 ||
      (safety as Record<string, unknown>).marketplaceWrites !== 0) {
    throw new Error("SELLER_OS_WHATSAPP_SALE_ALERT_RELAY_RESPONSE_INVALID")
  }
  return value as SellerOsWhatsappSaleAlertStatusV1
}

function lunaSupplierLinkageRelayResultV1(
  value: unknown,
): SellerOsLunaSupplierLinkageReadV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SELLER_OS_LUNA_SUPPLIER_LINKAGE_RELAY_RESPONSE_INVALID")
  }
  const result = value as Record<string, unknown>
  const safety = result.safety
  const safetyRecord = safety && typeof safety === "object" &&
      !Array.isArray(safety)
    ? safety as Record<string, unknown> : {}
  const inventoryEffectKey = "inventory" +
    "WritesByThisRead"
  const inventoryEffectCount = safetyRecord[inventoryEffectKey]
  if (result.contractVersion !==
      "SELLER_OS_LUNA_SUPPLIER_LINKAGE_STATUS_V1" ||
      result.bounded !== true || !safety || typeof safety !== "object" ||
      Array.isArray(safety) ||
      safetyRecord.readOnlySurface !== true ||
      safetyRecord.buyerPiiIncluded !== false ||
      safetyRecord.credentialsIncluded !== false ||
      safetyRecord.environmentValuesIncluded !== false ||
      safetyRecord.arbitraryAccountAllowed !== false ||
      safetyRecord.arbitrarySupplierUrlAllowed !== false ||
      safetyRecord.arbitraryUrlFetchAllowed !== false ||
      safetyRecord.databaseWritesByThisRead !== 0 ||
      safetyRecord.marketplaceWritesByThisRead !== 0 ||
      safetyRecord.ebayPauseWritesByThisRead !== 0 ||
      safetyRecord.ebayReviseWritesByThisRead !== 0 ||
      inventoryEffectCount !== 0 ||
      safetyRecord.listingWritesByThisRead !== 0 ||
      safetyRecord.lunaLinkMutationsByThisRead !== 0 ||
      safetyRecord.lunaMutationsByThisRead !== 0 ||
      safetyRecord.whatsappSendsByThisRead !== 0 ||
      safetyRecord.buyerMessageSendsByThisRead !== 0 ||
      safetyRecord.paymentTransactionsByThisRead !== 0) {
    throw new Error("SELLER_OS_LUNA_SUPPLIER_LINKAGE_RELAY_RESPONSE_INVALID")
  }
  return value as SellerOsLunaSupplierLinkageReadV1
}

function ebayTradingRateLimitRelayResultV1(
  value: unknown,
): SellerOsEbayTradingRateLimitStatusV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SELLER_OS_EBAY_TRADING_RATE_LIMIT_RELAY_RESPONSE_INVALID")
  }
  const result = value as Record<string, unknown>
  const safety = result.safety
  const safe = safety && typeof safety === "object" && !Array.isArray(safety)
    ? safety as Record<string, unknown>
    : {}
  const inventoryEffectKey = "inventory" +
    "WritesByThisRead"
  if (result.contractVersion !==
      "SELLER_OS_EBAY_TRADING_RATE_LIMIT_STATUS_V1" ||
      result.source !== "EBAY_DEVELOPER_ANALYTICS_GET_RATE_LIMITS" ||
      result.bounded !== true ||
      !["OPEN", "BLOCKED", "UNPROVEN"].includes(String(result.gateState)) ||
      safe.readOnlySurface !== true ||
      safe.callerProvidedApiContextAllowed !== false ||
      safe.arbitraryUrlAllowed !== false ||
      safe.tradingLiveCallsByThisRead !== 0 ||
      safe.getMyeBaySellingCallsByThisRead !== 0 ||
      safe.getSellerListCallsByThisRead !== 0 ||
      safe.getItemCallsByThisRead !== 0 ||
      safe.ebayWritesByThisRead !== 0 ||
      safe.listingWritesByThisRead !== 0 ||
      safe[inventoryEffectKey] !== 0 ||
      safe.oauthUserChangesByThisRead !== 0 ||
      safe.credentialsIncluded !== false ||
      safe.environmentValuesIncluded !== false ||
      safe.buyerPiiIncluded !== false ||
      safe.lunaPollingByThisRead !== 0 ||
      safe.vaultWritesByThisRead !== 0 ||
      safe.messageSendsByThisRead !== 0 ||
      safe.paymentTransactionsByThisRead !== 0) {
    throw new Error("SELLER_OS_EBAY_TRADING_RATE_LIMIT_RELAY_RESPONSE_INVALID")
  }
  return value as SellerOsEbayTradingRateLimitStatusV1
}

function buyerThankYouStatusRelayResultV1(
  value: unknown,
): SellerOsBuyerThankYouStatusV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SELLER_OS_BUYER_THANK_YOU_RELAY_RESPONSE_INVALID")
  }
  const result = value as Record<string, unknown>
  const safety = result.safety
  if (result.contractVersion !== "SELLER_OS_BUYER_THANK_YOU_STATUS_V1" ||
      result.bounded !== true || !safety || typeof safety !== "object" ||
      Array.isArray(safety) ||
      (safety as Record<string, unknown>).readOnlyCertificationSurface !== true ||
      (safety as Record<string, unknown>).buyerPiiIncluded !== false ||
      (safety as Record<string, unknown>).buyerIdentityIncluded !== false ||
      (safety as Record<string, unknown>).credentialsIncluded !== false ||
      (safety as Record<string, unknown>).environmentValuesIncluded !== false ||
      (safety as Record<string, unknown>).buyerMessageSendsByThisRead !== 0 ||
      (safety as Record<string, unknown>).marketplaceWritesByThisRead !== 0) {
    throw new Error("SELLER_OS_BUYER_THANK_YOU_RELAY_RESPONSE_INVALID")
  }
  return value as SellerOsBuyerThankYouStatusV1
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
  runtimeHealthCollector?: () => Promise<SellerOsRuntimeHealthV1>
  devStatusCollector?: () => Promise<SellerOsDevStatusV1>
  ciStatusCollector?: () => Promise<SellerOsCiStatusV1>
  dataStatusCollector?: () => Promise<SellerOsDataStatusV1>
  officialOrdersCollector?: () => Promise<SellerOsOfficialOrdersReadV1>
  salesOrderEventsCollector?: () => Promise<SellerOsSalesOrderEventsReadV1>
  recentSalesFeedCollector?: () => Promise<SellerOsRecentSalesFeedV1>
  saleAlertsCollector?: () => Promise<SellerOsSaleAlertsReadV1>
  whatsappSaleAlertStatusCollector?: () => Promise<
    SellerOsWhatsappSaleAlertStatusV1
  >
  buyerThankYouStatusCollector?: () => Promise<
    SellerOsBuyerThankYouStatusV1
  >
  postPurchaseAutomationGateCollector?: () => Promise<
    SellerOsPostPurchaseAutomationGateV1
  >
  lunaSupplierLinkageStatusCollector?: () => Promise<
    SellerOsLunaSupplierLinkageReadV1
  >
  lunaStockObservationStatusCollector?: () => Promise<
    SellerOsLunaStockObservationStatusReadV1
  >
  ebayTradingRateLimitStatusCollector?: () => Promise<
    SellerOsEbayTradingRateLimitStatusV1
  >
} = {}) {
  const applicationAuthMode = options.applicationAuthMode ??
    "OAUTH_SELLER_OS_READ"
  const toolSafety = evaluateSellerOsMcpToolSafetyV1(
    SELLER_OS_MCP_TOOL_POLICIES_V1,
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
  if (SELLER_OS_MCP_EXPECTED_TOOL_NAMES_V1.length !==
      SELLER_OS_MCP_EXPECTED_CATALOG_COUNT_V1 ||
      new Set(SELLER_OS_MCP_EXPECTED_TOOL_NAMES_V1).size !==
        SELLER_OS_MCP_EXPECTED_CATALOG_COUNT_V1) {
    throw new Error("SELLER_OS_MCP_EXPECTED_CATALOG_INVALID")
  }
  const registeredToolNames = new Set<string>()
  let monitorPromise: ReturnType<typeof loadSellerOsAssistantMonitorV1> | null = null
  const monitorLoader = options.monitorLoader ?? loadSellerOsAssistantMonitorV1
  const monitor = () => (monitorPromise ??= monitorLoader())
  const localToolExecutor: SellerOsAssistantToolExecutorV1 = async (input) =>
    input.toolName === "seller_os_get_opportunity_radar" ||
      input.toolName === "seller_os_get_opportunity_case"
      ? collectSellerOsLongitudinalOpportunityReadV1({
          toolName: input.toolName,
          arguments: input.arguments,
        })
      : executeSellerOsAssistantToolV1({ toolName: input.toolName,
          arguments: input.arguments, monitor: await monitor() })
  const configuredToolExecutor = (
    getSellerOsMcpToolExecutionSourceV1(applicationAuthMode) ===
      "CLOUD_READ_RELAY"
    ? createSellerOsCloudReadRelayExecutorV1()
    : localToolExecutor)
  const toolExecutor = options.toolExecutor ?? (async (input) =>
    input.toolName === "seller_os_get_opportunity_radar" ||
      input.toolName === "seller_os_get_opportunity_case"
      ? collectSellerOsLongitudinalOpportunityReadV1({
          toolName: input.toolName,
          arguments: input.arguments,
        })
      : configuredToolExecutor(input))
  for (const descriptor of SELLER_OS_ASSISTANT_TOOLS_V1) {
    const needsItem = descriptor.name === "seller_os_get_listing_intelligence"
    const needsCase = descriptor.name === "seller_os_get_opportunity_case"
    const config = { title: descriptor.title,
      description: descriptor.description,
      inputSchema: { ...(needsItem ? { itemId: z.string().regex(/^\d{9,19}$/) } : {}),
        ...(needsCase ? { opportunityCaseId: z.string().regex(
          /^opportunity-case-v1:sha256:[0-9a-f]{64}$/,
        ) } : {}),
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
    registeredToolNames.add(descriptor.name)
  }
  const runtimeHealthCollector = options.runtimeHealthCollector ??
    collectSellerOsRuntimeHealthV1
  const runtimeHealthConfig = {
    title: SELLER_OS_RUNTIME_HEALTH_TOOL_V1.title,
    description: SELLER_OS_RUNTIME_HEALTH_TOOL_V1.description,
    inputSchema: z.object({}).strict(),
    annotations: SELLER_OS_RUNTIME_HEALTH_TOOL_V1.annotations,
    securitySchemes,
    _meta: { securitySchemes },
  }
  server.registerTool(SELLER_OS_RUNTIME_HEALTH_TOOL_V1.name,
    runtimeHealthConfig, async () => {
    let result: SellerOsRuntimeHealthV1
    try {
      result = await runtimeHealthCollector()
    } catch {
      result = createUnavailableSellerOsRuntimeHealthV1()
    }
    result = attestSellerOsRuntimeCatalogV1(result, {
      registeredToolNames: [...registeredToolNames],
      expectedToolNames: SELLER_OS_MCP_EXPECTED_TOOL_NAMES_V1,
      runtimeWorkingDirectoryMatch: resolve(process.cwd()) === resolve(
        SELLER_OS_CANONICAL_REPOSITORY_V1.directory,
      ),
      loadedMcpImplementationVersion: SELLER_OS_MCP_ENDPOINT_VERSION,
    })
    return { structuredContent: { result }, content: [{ type: "text" as const,
      text: "Seller OS returned bounded read-only local runtime health evidence." }] }
    })
  registeredToolNames.add(SELLER_OS_RUNTIME_HEALTH_TOOL_V1.name)
  const devStatusCollector = options.devStatusCollector ?? collectSellerOsDevStatusV1
  const devStatusConfig = {
    title: SELLER_OS_DEV_STATUS_TOOL_V1.title,
    description: SELLER_OS_DEV_STATUS_TOOL_V1.description,
    inputSchema: z.object({}).strict(),
    annotations: SELLER_OS_DEV_STATUS_TOOL_V1.annotations,
    securitySchemes,
    _meta: { securitySchemes },
  }
  server.registerTool(SELLER_OS_DEV_STATUS_TOOL_V1.name,
    devStatusConfig, async () => {
    let result: SellerOsDevStatusV1
    try {
      result = await devStatusCollector()
    } catch {
      result = createUnavailableSellerOsDevStatusV1()
    }
    return { structuredContent: { result }, content: [{ type: "text" as const,
      text: "Seller OS returned bounded read-only canonical development status evidence." }] }
    })
  registeredToolNames.add(SELLER_OS_DEV_STATUS_TOOL_V1.name)
  const ciStatusCollector = options.ciStatusCollector ?? collectSellerOsCiStatusV1
  const ciStatusConfig = {
    title: SELLER_OS_CI_STATUS_TOOL_V1.title,
    description: SELLER_OS_CI_STATUS_TOOL_V1.description,
    inputSchema: z.object({}).strict(),
    annotations: SELLER_OS_CI_STATUS_TOOL_V1.annotations,
    securitySchemes,
    _meta: { securitySchemes },
  }
  server.registerTool(SELLER_OS_CI_STATUS_TOOL_V1.name,
    ciStatusConfig, async () => {
    let result: SellerOsCiStatusV1
    try {
      result = await ciStatusCollector()
    } catch {
      result = createUnavailableSellerOsCiStatusV1()
    }
    return { structuredContent: { result }, content: [{ type: "text" as const,
      text: "Seller OS returned bounded read-only SHA-bound validation evidence." }] }
    })
  registeredToolNames.add(SELLER_OS_CI_STATUS_TOOL_V1.name)
  const dataStatusCollector = options.dataStatusCollector ?? collectSellerOsDataStatusV1
  const dataStatusConfig = {
    title: SELLER_OS_DATA_STATUS_TOOL_V1.title,
    description: SELLER_OS_DATA_STATUS_TOOL_V1.description,
    inputSchema: z.object({}).strict(),
    annotations: SELLER_OS_DATA_STATUS_TOOL_V1.annotations,
    securitySchemes,
    _meta: { securitySchemes },
  }
  server.registerTool(SELLER_OS_DATA_STATUS_TOOL_V1.name,
    dataStatusConfig, async () => {
    let result: SellerOsDataStatusV1
    try {
      result = await dataStatusCollector()
    } catch {
      result = createUnavailableSellerOsDataStatusV1()
    }
    return { structuredContent: { result }, content: [{ type: "text" as const,
      text: "Seller OS returned bounded read-only workspace-bound data and migration evidence." }] }
    })
  registeredToolNames.add(SELLER_OS_DATA_STATUS_TOOL_V1.name)
  const officialOrdersCollector = options.officialOrdersCollector ?? (async () => {
    if (getSellerOsMcpToolExecutionSourceV1(applicationAuthMode) ===
        "CLOUD_READ_RELAY") {
      return officialOrdersRelayResultV1(await toolExecutor({
        toolName: SELLER_OS_OFFICIAL_ORDERS_TOOL_V1.name,
        arguments: {},
      }))
    }
    return collectSellerOsOfficialOrdersReadV1()
  })
  const officialOrdersConfig = {
    title: SELLER_OS_OFFICIAL_ORDERS_TOOL_V1.title,
    description: SELLER_OS_OFFICIAL_ORDERS_TOOL_V1.description,
    inputSchema: z.object({}).strict(),
    annotations: SELLER_OS_OFFICIAL_ORDERS_TOOL_V1.annotations,
    securitySchemes,
    _meta: { securitySchemes },
  }
  server.registerTool(SELLER_OS_OFFICIAL_ORDERS_TOOL_V1.name,
    officialOrdersConfig, async () => {
    let result: SellerOsOfficialOrdersReadV1
    try {
      result = await officialOrdersCollector()
    } catch {
      result = createUnavailableSellerOsOfficialOrdersReadV1(
        "OFFICIAL_ORDERS_COLLECTOR_FAILED_CLOSED",
      )
    }
    return { structuredContent: { result }, content: [{ type: "text" as const,
      text: "Seller OS returned bounded PII-free official eBay Orders evidence." }] }
    })
  registeredToolNames.add(SELLER_OS_OFFICIAL_ORDERS_TOOL_V1.name)
  const salesOrderEventsCollector = options.salesOrderEventsCollector ??
    (async () => buildSellerOsSalesOrderEventsReadV1(
      await officialOrdersCollector(),
    ))
  const salesOrderEventsConfig = {
    title: SELLER_OS_SALES_ORDER_EVENTS_TOOL_V1.title,
    description: SELLER_OS_SALES_ORDER_EVENTS_TOOL_V1.description,
    inputSchema: z.object({}).strict(),
    annotations: SELLER_OS_SALES_ORDER_EVENTS_TOOL_V1.annotations,
    securitySchemes,
    _meta: { securitySchemes },
  }
  server.registerTool(SELLER_OS_SALES_ORDER_EVENTS_TOOL_V1.name,
    salesOrderEventsConfig, async () => {
    let result: SellerOsSalesOrderEventsReadV1
    try {
      result = await salesOrderEventsCollector()
    } catch {
      result = buildSellerOsSalesOrderEventsReadV1(
        createUnavailableSellerOsOfficialOrdersReadV1(
          "SALES_ORDER_EVENTS_COLLECTOR_FAILED_CLOSED",
        ),
      )
    }
    return { structuredContent: { result }, content: [{ type: "text" as const,
      text: "Seller OS returned bounded deterministic PII-free Sales Order Event projections." }] }
    })
  registeredToolNames.add(SELLER_OS_SALES_ORDER_EVENTS_TOOL_V1.name)
  const recentSalesFeedCollector = options.recentSalesFeedCollector ??
    (async () => buildSellerOsRecentSalesFeedV1(
      await salesOrderEventsCollector(),
    ))
  const recentSalesFeedConfig = {
    title: SELLER_OS_RECENT_SALES_FEED_TOOL_V1.title,
    description: SELLER_OS_RECENT_SALES_FEED_TOOL_V1.description,
    inputSchema: z.object({}).strict(),
    annotations: SELLER_OS_RECENT_SALES_FEED_TOOL_V1.annotations,
    securitySchemes,
    _meta: { securitySchemes },
  }
  server.registerTool(SELLER_OS_RECENT_SALES_FEED_TOOL_V1.name,
    recentSalesFeedConfig, async () => {
    let result: SellerOsRecentSalesFeedV1
    try {
      result = await recentSalesFeedCollector()
    } catch {
      result = buildSellerOsRecentSalesFeedV1(
        buildSellerOsSalesOrderEventsReadV1(
          createUnavailableSellerOsOfficialOrdersReadV1(
            "RECENT_SALES_FEED_COLLECTOR_FAILED_CLOSED",
          ),
        ),
      )
    }
    return { structuredContent: { result }, content: [{ type: "text" as const,
      text: "Seller OS returned a bounded deterministic PII-free recent sales feed." }] }
    })
  registeredToolNames.add(SELLER_OS_RECENT_SALES_FEED_TOOL_V1.name)
  const saleAlertsCollector = options.saleAlertsCollector ??
    (async () => buildSellerOsSaleAlertsReadV1(
      await recentSalesFeedCollector(),
    ))
  const saleAlertsConfig = {
    title: SELLER_OS_SALE_ALERTS_TOOL_V1.title,
    description: SELLER_OS_SALE_ALERTS_TOOL_V1.description,
    inputSchema: z.object({}).strict(),
    annotations: SELLER_OS_SALE_ALERTS_TOOL_V1.annotations,
    securitySchemes,
    _meta: { securitySchemes },
  }
  server.registerTool(SELLER_OS_SALE_ALERTS_TOOL_V1.name,
    saleAlertsConfig, async () => {
    let result: SellerOsSaleAlertsReadV1
    try {
      result = await saleAlertsCollector()
    } catch {
      result = buildSellerOsSaleAlertsReadV1(
        buildSellerOsRecentSalesFeedV1(
          buildSellerOsSalesOrderEventsReadV1(
            createUnavailableSellerOsOfficialOrdersReadV1(
              "SALE_ALERTS_COLLECTOR_FAILED_CLOSED",
            ),
          ),
        ),
      )
    }
    return { structuredContent: { result }, content: [{ type: "text" as const,
      text: "Seller OS returned bounded deterministic PII-free Dashboard sale alerts." }] }
    })
  registeredToolNames.add(SELLER_OS_SALE_ALERTS_TOOL_V1.name)
  const whatsappSaleAlertStatusCollector =
    options.whatsappSaleAlertStatusCollector ?? (async () => {
      if (getSellerOsMcpToolExecutionSourceV1(applicationAuthMode) ===
          "CLOUD_READ_RELAY") {
        return whatsappSaleAlertStatusRelayResultV1(await toolExecutor({
          toolName: SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_TOOL_V1.name,
          arguments: {},
        }))
      }
      return collectSellerOsWhatsappSaleAlertStatusV1()
    })
  const whatsappSaleAlertStatusConfig = {
    title: SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_TOOL_V1.title,
    description: SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_TOOL_V1.description,
    inputSchema: z.object({}).strict(),
    annotations: SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_TOOL_V1.annotations,
    securitySchemes,
    _meta: { securitySchemes },
  }
  server.registerTool(SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_TOOL_V1.name,
    whatsappSaleAlertStatusConfig, async () => {
    let result: SellerOsWhatsappSaleAlertStatusV1
    try {
      result = await whatsappSaleAlertStatusCollector()
    } catch {
      result = createUnavailableSellerOsWhatsappSaleAlertStatusV1(
        "WHATSAPP_SALE_ALERT_STATUS_COLLECTOR_FAILED_CLOSED",
      )
    }
    return { structuredContent: { result }, content: [{ type: "text" as const,
      text: "Seller OS returned bounded PII-free WhatsApp sale-alert workflow and durable receipt status without sending a message." }] }
    })
  registeredToolNames.add(SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_TOOL_V1.name)
  const buyerThankYouStatusCollector =
    options.buyerThankYouStatusCollector ?? (async () => {
      if (getSellerOsMcpToolExecutionSourceV1(applicationAuthMode) ===
          "CLOUD_READ_RELAY") {
        return buyerThankYouStatusRelayResultV1(await toolExecutor({
          toolName: SELLER_OS_BUYER_THANK_YOU_STATUS_TOOL_V1.name,
          arguments: {},
        }))
      }
      return collectSellerOsBuyerThankYouStatusV1()
    })
  const buyerThankYouStatusConfig = {
    title: SELLER_OS_BUYER_THANK_YOU_STATUS_TOOL_V1.title,
    description: SELLER_OS_BUYER_THANK_YOU_STATUS_TOOL_V1.description,
    inputSchema: z.object({}).strict(),
    annotations: SELLER_OS_BUYER_THANK_YOU_STATUS_TOOL_V1.annotations,
    securitySchemes,
    _meta: { securitySchemes },
  }
  server.registerTool(SELLER_OS_BUYER_THANK_YOU_STATUS_TOOL_V1.name,
    buyerThankYouStatusConfig, async () => {
    let result: SellerOsBuyerThankYouStatusV1
    try {
      result = await buyerThankYouStatusCollector()
    } catch {
      result = createUnavailableSellerOsBuyerThankYouStatusV1(
        "BUYER_THANK_YOU_STATUS_COLLECTOR_FAILED_CLOSED",
      )
    }
    return { structuredContent: { result }, content: [{ type: "text" as const,
      text: "Seller OS returned bounded PII-free eBay buyer thank-you eligibility, workflow, capability and durable receipt status without sending a message." }] }
    })
  registeredToolNames.add(SELLER_OS_BUYER_THANK_YOU_STATUS_TOOL_V1.name)
  const postPurchaseAutomationGateCollector =
    options.postPurchaseAutomationGateCollector ?? (async () => {
      const officialOrders = await officialOrdersCollector()
      const salesOrderEvents = buildSellerOsSalesOrderEventsReadV1(
        officialOrders,
      )
      const recentSalesFeed = buildSellerOsRecentSalesFeedV1(
        salesOrderEvents,
      )
      const saleAlerts = buildSellerOsSaleAlertsReadV1(recentSalesFeed)
      const [whatsapp, buyerThankYou] = await Promise.all([
        whatsappSaleAlertStatusCollector(), buyerThankYouStatusCollector(),
      ])
      return buildSellerOsPostPurchaseAutomationGateV1({
        officialOrders, salesOrderEvents, recentSalesFeed, saleAlerts,
        whatsapp, buyerThankYou,
      })
    })
  const lunaSupplierLinkageStatusCollector =
    options.lunaSupplierLinkageStatusCollector ?? (async () => {
      if (getSellerOsMcpToolExecutionSourceV1(applicationAuthMode) ===
          "CLOUD_READ_RELAY") {
        return lunaSupplierLinkageRelayResultV1(await toolExecutor({
          toolName: SELLER_OS_LUNA_SUPPLIER_LINKAGE_RELAY_OPERATION_V1,
          arguments: {},
        }))
      }
      return collectSellerOsLunaSupplierLinkageStatusV1()
    })
  const lunaStockObservationStatusCollector =
    options.lunaStockObservationStatusCollector ??
      collectSellerOsLunaStockObservationStatusV1
  const ebayTradingRateLimitStatusCollector =
    options.ebayTradingRateLimitStatusCollector ?? (async () => {
      if (getSellerOsMcpToolExecutionSourceV1(applicationAuthMode) ===
          "CLOUD_READ_RELAY") {
        return ebayTradingRateLimitRelayResultV1(await toolExecutor({
          toolName: SELLER_OS_EBAY_TRADING_RATE_LIMIT_RELAY_OPERATION_V1,
          arguments: {},
        }))
      }
      return collectSellerOsEbayTradingRateLimitStatusV1()
    })
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
      ...CROSS_PHASE_FOUNDATION_RESOURCES.map((row) => ({ id: row.id,
        title: row.title, url: row.id, description: row.description })),
      ...PHASE_ONE_CERTIFICATION_RESOURCES.map((row) => ({ id: row.id,
        title: row.title, url: row.id, description: row.description })),
      ...PHASE_TWO_CERTIFICATION_RESOURCES.map((row) => ({ id: row.id,
        title: row.title, url: row.id, description: row.description })),
      ...SELLER_OS_ASSISTANT_TOOLS_V1.map((row) => ({ id: `seller-os://tool/${row.name}`,
        title: row.title, url: `seller-os://tool/${row.name}`, description: row.description })),
      ...DEDICATED_READ_TOOLS.map((row) => ({
        id: `seller-os://tool/${row.name}`, title: row.title,
        url: `seller-os://tool/${row.name}`, description: row.description,
      })),
    ].filter((row) => `${row.title} ${row.description}`.toLowerCase().includes(normalized))
      .slice(0, limit ?? 10)
    return { structuredContent: { results: resources }, content: [{ type: "text" as const,
      text: JSON.stringify({ results: resources }) }] }
  })
  registeredToolNames.add("search")
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
    const foundation = CROSS_PHASE_FOUNDATION_RESOURCES.find((row) =>
      row.id === id)
    const phaseOneCertification = PHASE_ONE_CERTIFICATION_RESOURCES.find(
      (row) => row.id === id,
    )
    const phaseTwoCertification = PHASE_TWO_CERTIFICATION_RESOURCES.find(
      (row) => row.id === id,
    )
    const listingMatch = /^seller-os:\/\/listing\/(\d{9,19})$/.exec(id)
    const toolMatch = /^seller-os:\/\/tool\/(seller_os_get_[a-z_]+)$/.exec(id)
    const descriptor = toolMatch ? [
      ...SELLER_OS_ASSISTANT_TOOLS_V1,
      ...DEDICATED_READ_TOOLS,
    ].find((row) => row.name === toolMatch[1]) : null
    if (!standard && !foundation && !phaseOneCertification &&
        !phaseTwoCertification && !listingMatch && !descriptor) {
      throw new Error("SELLER_OS_FETCH_RESOURCE_NOT_ALLOWLISTED")
    }
    let result: unknown
    if (foundation) {
      const shared = getSellerOsCrossPhaseFoundationV1()
      result = foundation.kind === "REUSE_MAP"
        ? shared.reuseMap : shared.reusePolicy
    } else if (phaseOneCertification) {
      try {
        result = await postPurchaseAutomationGateCollector()
      } catch {
        result = createUnavailableSellerOsPostPurchaseAutomationGateV1()
      }
    } else if (phaseTwoCertification) {
      if (phaseTwoCertification.kind === "LUNA_SUPPLIER_LINKAGE") {
        try {
          result = await lunaSupplierLinkageStatusCollector()
        } catch {
          result = createUnavailableSellerOsLunaSupplierLinkageStatusV1(
            "LUNA_SUPPLIER_LINKAGE_COLLECTOR_FAILED_CLOSED",
          )
        }
      } else if (phaseTwoCertification.kind === "LUNA_STOCK_OBSERVATION") {
        try {
          result = await lunaStockObservationStatusCollector()
        } catch {
          result = createSellerOsLunaStockObservationPrebuildStatusV1()
        }
      } else {
        try {
          result = await ebayTradingRateLimitStatusCollector()
        } catch {
          result = createUnavailableSellerOsEbayTradingRateLimitStatusV1(
            "EBAY_DEVELOPER_ANALYTICS_COLLECTOR_FAILED_CLOSED",
          )
        }
      }
    } else {
      const toolName = standard?.toolName ?? (listingMatch
        ? "seller_os_get_listing_intelligence" : descriptor!.name)
      try {
        result = toolName === SELLER_OS_OFFICIAL_ORDERS_TOOL_V1.name
          ? await officialOrdersCollector()
          : toolName === SELLER_OS_SALES_ORDER_EVENTS_TOOL_V1.name
            ? await salesOrderEventsCollector()
            : toolName === SELLER_OS_RECENT_SALES_FEED_TOOL_V1.name
              ? await recentSalesFeedCollector()
              : toolName === SELLER_OS_SALE_ALERTS_TOOL_V1.name
                ? await saleAlertsCollector()
                : toolName === SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_TOOL_V1.name
                  ? await whatsappSaleAlertStatusCollector()
              : await toolExecutor({ toolName,
                arguments: listingMatch ? { itemId: listingMatch[1] } : {} })
      } catch {
        result = { status: "SELLER_OS_EVIDENCE_READ_FAILED_CLOSED",
          credentialsIncluded: false, buyerPiiIncluded: false, marketplaceWrites: 0 }
      }
    }
    const document = { id, title: standard?.title ?? foundation?.title ??
      phaseOneCertification?.title ??
      phaseTwoCertification?.title ??
      descriptor?.title ??
      `Seller OS listing ${listingMatch?.[1]}`, text: JSON.stringify(result), url: id,
      metadata: { source: foundation
        ? "SELLER_OS_CROSS_PHASE_SHARED_FOUNDATION"
        : phaseOneCertification
          ? "SELLER_OS_PHASE_ONE_CERTIFICATION"
        : phaseTwoCertification
          ? "SELLER_OS_PHASE_TWO_CERTIFICATION"
        : "SELLER_OS_CANONICAL_READONLY", bounded: true,
        marketplaceWrites: 0 } }
    return { structuredContent: document, content: [{ type: "text" as const,
      text: JSON.stringify(document) }] }
  })
  registeredToolNames.add("fetch")
  return server
}

async function serveAuthenticatedSellerOsMcpRequestV1(
  req: Request,
  applicationAuthMode: SellerOsMcpApplicationAuthModeV1 =
    "OAUTH_SELLER_OS_READ",
) {
  // SDK 1.30.0 stateless transports are fresh per POST and have no shared
  // session on which GET/SSE or DELETE can operate. Passing GET to a fresh
  // transport creates an unbound stream, so advertise the supported method
  // explicitly, as the SDK's stateless Streamable HTTP example does. Preserve
  // the SDK's required GET Accept negotiation before method discovery.
  if (req.method === "GET" &&
      !req.headers.get("accept")?.includes("text/event-stream")) {
    return safeErrorResponse(406, -32000,
      "Not Acceptable: Client must accept text/event-stream")
  }
  if (req.method !== "POST") return statelessMethodNotAllowedResponse()
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
      SELLER_OS_MCP_TOOL_POLICIES_V1,
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
