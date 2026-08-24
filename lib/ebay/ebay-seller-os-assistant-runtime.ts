import { assertCommercialMonitorAssistantDtoSafe } from
  "./commercial-monitor-readonly-contract"
import { getCommercialMonitorReadonly } from
  "./commercial-monitor-readonly-service"
import { getEbayCommercialMonitorLiveReadonly } from
  "./ebay-commercial-monitor-live-readonly"
import { getEbayOfficialOrdersLiveReadonly } from
  "./ebay-commercial-monitor-live-readonly"
import { getEbaySellerAccountScopeConfiguration } from
  "./ebay-seller-account-scope"
import { resolveCrossModuleLivePortfolioIntegrityV1 } from
  "./ebay-seller-os-live-portfolio-integrity-v1"
// @ts-expect-error Node's direct TypeScript runner requires the explicit extension.
import { buildSellerOsOfficialOrdersReadV1 } from "./ebay-official-orders-read-v1.ts"
// @ts-expect-error Node's direct TypeScript runner requires the explicit extension.
import { buildSellerOsSalesOrderEventsReadV1 } from "./ebay-sales-order-events-read-v1.ts"
// @ts-expect-error Node's direct TypeScript runner requires the explicit extension.
import { buildSellerOsRecentSalesFeedV1 } from "./ebay-sales-order-read-model-v1.ts"
// @ts-expect-error Node's direct TypeScript runner requires the explicit extension.
import { buildSellerOsSaleAlertsReadV1 } from "./ebay-sale-alerts-read-v1.ts"
// @ts-expect-error Node's direct TypeScript runner requires the explicit extension.
import { buildSellerOsWhatsappSaleAlertStatusV1, sellerOsWhatsappSaleAlertDeliveryKeyV1 } from "./ebay-whatsapp-sale-alert-v1.ts"
// @ts-expect-error Node's direct TypeScript runner requires the explicit extension.
import { readSellerOsWhatsappSaleAlertAuditV1 } from "./ebay-whatsapp-sale-alert-readonly-repository-v1.ts"
// @ts-expect-error Node's direct TypeScript runner requires the explicit extension.
import { buildSellerOsBuyerThankYouStatusV1, preflightEbayBuyerMessagingCapabilityV1, sellerOsBuyerThankYouDeliveryKeysForSaleAlertsV1 } from "./ebay-post-purchase-buyer-message-v1.ts"
// @ts-expect-error Node's direct TypeScript runner requires the explicit extension.
import { readSellerOsBuyerThankYouAuditV1 } from "./ebay-buyer-thank-you-readonly-repository-v1.ts"
import { buildSellerOsLunaSupplierLinkageStatusFromMonitorV1,
  createUnavailableSellerOsLunaSupplierLinkageStatusV1 } from
// @ts-expect-error Node's direct TypeScript runner requires the explicit extension.
  "./ebay-luna-supplier-linkage-certification-v1.ts"
import { readSellerOsLunaSupplierLinkageEvidenceV1 } from
// @ts-expect-error Node's direct TypeScript runner requires the explicit extension.
  "./ebay-luna-supplier-linkage-readonly-repository-v1.ts"
import { createSellerOsLunaStockObservationPrebuildStatusV1 } from
// @ts-expect-error Node's direct TypeScript runner requires the explicit extension.
  "./ebay-luna-stock-observation-v1.ts"
import { getSellerWhatsAppGatewayConfiguration,
  preflightSellerWhatsAppGateway } from "./ebay-seller-whatsapp-gateway"
import { getSupabaseAdminClient } from "../supabase-admin"

export const SELLER_OS_ASSISTANT_MONITOR_SNAPSHOT_TTL_MS = 5 * 60_000

function withAccountTrafficCacheTelemetryV1<T>(value: T, cacheHitCount: number): T {
  if (!value || typeof value !== "object") return value
  const monitor = value as Record<string, unknown>
  const backend = monitor.backend
  if (!backend || typeof backend !== "object") return value
  const trafficScopes = (backend as Record<string, unknown>).trafficScopes
  if (!trafficScopes || typeof trafficScopes !== "object") return value
  const accountTraffic = (trafficScopes as Record<string, unknown>).accountTraffic
  if (!accountTraffic || typeof accountTraffic !== "object") return value
  const previousCacheHitCount = typeof (accountTraffic as Record<string,
    unknown>).cacheHitCount === "number"
    ? (accountTraffic as Record<string, number>).cacheHitCount : 0
  return {
    ...monitor,
    backend: {
      ...backend as Record<string, unknown>,
      trafficScopes: {
        ...trafficScopes as Record<string, unknown>,
        accountTraffic: {
          ...accountTraffic as Record<string, unknown>,
          cacheHitCount: previousCacheHitCount + cacheHitCount,
        },
      },
    },
  } as T
}

export async function loadSellerOsAssistantMonitorV1() {
  const account = getEbaySellerAccountScopeConfiguration()
  const live = await getEbayCommercialMonitorLiveReadonly({ accountKey: account.accountKey,
    accountAlias: account.accountAlias })
  const monitor = await getCommercialMonitorReadonly(
    account.accountKey ? getSupabaseAdminClient() : null,
    { accountKey: account.accountKey, accountAlias: account.accountAlias,
      configurationReason: account.reason }, live)
  return {
    ...assertCommercialMonitorAssistantDtoSafe(monitor),
    officialOrders: buildSellerOsOfficialOrdersReadV1({
      orders: live.orders,
      analytics: live.analytics,
    }),
  }
}

/**
 * Dedicated MCP read collector: reuse the canonical fixed-account live reader
 * without entering the cloud relay or a persistence path.
 */
export async function collectSellerOsOfficialOrdersReadV1() {
  const account = getEbaySellerAccountScopeConfiguration()
  const live = await getEbayOfficialOrdersLiveReadonly({
    accountKey: account.accountKey,
    accountAlias: account.accountAlias,
  })
  return buildSellerOsOfficialOrdersReadV1({
    orders: live.orders,
    analytics: null,
  })
}

/**
 * Read-only I05 certification collector. Provider preflight performs only
 * fixed Meta metadata GETs; durable delivery evidence is read from the
 * existing fixed outbox. This function never claims work or sends WhatsApp.
 */
export async function collectSellerOsWhatsappSaleAlertStatusV1() {
  const observedAt = new Date().toISOString()
  const officialOrders = await collectSellerOsOfficialOrdersReadV1()
  const saleAlerts = buildSellerOsSaleAlertsReadV1(
    buildSellerOsRecentSalesFeedV1(
      buildSellerOsSalesOrderEventsReadV1(officialOrders),
    ),
  )
  let configuration = getSellerWhatsAppGatewayConfiguration()
  let preflightLimitations: string[] = []
  if (configuration.enabled && configuration.configurationComplete) {
    try {
      const preflight = await preflightSellerWhatsAppGateway()
      preflightLimitations = preflight.success ? [] : preflight.errorCodes
    } catch {
      preflightLimitations = ["SELLER_WHATSAPP_PREFLIGHT_READ_FAILED"]
    }
    configuration = getSellerWhatsAppGatewayConfiguration()
  }
  const account = getEbaySellerAccountScopeConfiguration()
  const deliveryKeys = saleAlerts.alerts.map((alert) =>
    sellerOsWhatsappSaleAlertDeliveryKeyV1(alert.eventId))
  const audit = account.accountKey
    ? await readSellerOsWhatsappSaleAlertAuditV1(
        getSupabaseAdminClient(),
        account.accountKey,
        deliveryKeys,
        observedAt,
      )
    : {
        source: "ALERT_DELIVERY_OUTBOX" as const,
        status: "UNAVAILABLE" as const,
        observedAt,
        rows: Object.freeze([]),
        truncated: false,
        limitationCodes: Object.freeze([
          "CANONICAL_SELLER_ACCOUNT_BINDING_UNAVAILABLE",
        ]),
      }
  return buildSellerOsWhatsappSaleAlertStatusV1({
    saleAlerts,
    audit,
    provider: Object.freeze({
      observedAt,
      provider: "META_CLOUD_API" as const,
      configurationStatus: configuration.status,
      preflightStatus: configuration.preflightStatus,
      deliveryAttemptAllowed: configuration.deliveryAttemptAllowed,
      realDeliveryPermitted: configuration.realDeliveryPermitted,
      configuredRecipientOnly: true as const,
      approvedTemplateOnly: true as const,
      environmentBoundary: "PREVIEW_ONLY" as const,
      limitationCodes: Object.freeze([
        ...preflightLimitations,
        ...(!configuration.enabled ? ["SELLER_WHATSAPP_DISABLED"] : []),
        ...(!configuration.configurationComplete
          ? ["SELLER_WHATSAPP_CONFIGURATION_INCOMPLETE"] : []),
      ]),
    }),
  })
}

/**
 * Read-only I06 certification collector. It performs one fixed Message API
 * metadata GET to prove capability, reads only the fixed durable delivery
 * ledger, and never resolves a buyer recipient or invokes send_message.
 */
export async function collectSellerOsBuyerThankYouStatusV1() {
  const observedAt = new Date().toISOString()
  const officialOrders = await collectSellerOsOfficialOrdersReadV1()
  const saleAlerts = buildSellerOsSaleAlertsReadV1(
    buildSellerOsRecentSalesFeedV1(
      buildSellerOsSalesOrderEventsReadV1(officialOrders),
    ),
  )
  const capability = await preflightEbayBuyerMessagingCapabilityV1()
  const account = getEbaySellerAccountScopeConfiguration()
  const deliveryKeys = sellerOsBuyerThankYouDeliveryKeysForSaleAlertsV1(
    saleAlerts,
  )
  const audit = account.accountKey
    ? await readSellerOsBuyerThankYouAuditV1(
        getSupabaseAdminClient(),
        account.accountKey,
        deliveryKeys,
        observedAt,
      )
    : {
        source: "COMMERCIAL_ALERT_EVENTS_BUYER_MESSAGE_LEDGER" as const,
        status: "UNAVAILABLE" as const,
        observedAt,
        rows: Object.freeze([]),
        truncated: false,
        limitationCodes: Object.freeze([
          "CANONICAL_SELLER_ACCOUNT_BINDING_UNAVAILABLE",
        ]),
      }
  return buildSellerOsBuyerThankYouStatusV1({
    saleAlerts,
    capability,
    audit,
  })
}

/**
 * Read-only P2-I01 certification collector. It binds the current canonical
 * live cohort to existing exact approval envelopes and candidate evidence.
 * It never fetches a caller URL, writes an approval, reads stock as identity,
 * or performs a marketplace/Luna mutation.
 */
export async function collectSellerOsLunaSupplierLinkageStatusV1() {
  const account = getEbaySellerAccountScopeConfiguration()
  if (!account.accountKey) {
    return createUnavailableSellerOsLunaSupplierLinkageStatusV1(
      "CANONICAL_SELLER_ACCOUNT_BINDING_UNAVAILABLE",
    )
  }
  const monitor = await loadSellerOsAssistantMonitorSnapshotV1()
  const itemIds = resolveCrossModuleLivePortfolioIntegrityV1(monitor)
    .canonicalCohort.itemIds
  const evidence = await readSellerOsLunaSupplierLinkageEvidenceV1(
    getSupabaseAdminClient(),
    account.accountKey,
    itemIds,
  )
  return buildSellerOsLunaSupplierLinkageStatusFromMonitorV1({
    monitor,
    accountKey: account.accountKey,
    repositoryEvidence: evidence,
  })
}

/**
 * P2-I02 PREBUILD certification surface. This audits configuration presence
 * only; it never opens Luna, starts a scheduler, or reads eBay.
 */
export async function collectSellerOsLunaStockObservationStatusV1() {
  const { auditSellerOsLunaProtectedSessionV1 } = await import(
    "./ebay-luna-protected-session-server-v1"
  )
  const session = await auditSellerOsLunaProtectedSessionV1({
    vaultSchemaApplied: true,
  })
  const monitor = await loadSellerOsAssistantMonitorSnapshotV1()
  const currentLive = monitor.listings.filter((listing) =>
    listing.discovery.livePresence.status === "LIVE_ACTIVE")
  const currentPrerequisitesSatisfied = currentLive.length > 0 &&
    currentLive.every((listing) =>
      listing.stock.supplierLinkageStatus === "CERTIFIED" &&
      listing.stock.state !== "STOCK_UNKNOWN" &&
      listing.stock.limitationCode !==
        "CERTIFIED_COMPONENT_STOCK_IDENTITY_MISMATCH")
  return createSellerOsLunaStockObservationPrebuildStatusV1({
    sessionAssessment: session,
    activationCertified:
      process.env.EBAY_TARGETED_LUNA_ACTIVE_MONITOR_ENABLED === "true" &&
      currentPrerequisitesSatisfied,
  })
}

export function createSellerOsAssistantMonitorSnapshotLoaderV1(input: {
  loader?: typeof loadSellerOsAssistantMonitorV1
  now?: () => number
  maximumAgeMs?: number
} = {}) {
  const loader = input.loader ?? loadSellerOsAssistantMonitorV1
  const now = input.now ?? Date.now
  const maximumAgeMs = Math.min(10 * 60_000, Math.max(1_000,
    input.maximumAgeMs ?? SELLER_OS_ASSISTANT_MONITOR_SNAPSHOT_TTL_MS))
  let snapshot: {
    expiresAt: number
    promise: ReturnType<typeof loadSellerOsAssistantMonitorV1>
  } | null = null
  let cacheHitCount = 0
  return async () => {
    const timestamp = now()
    if (snapshot && snapshot.expiresAt > timestamp) {
      cacheHitCount += 1
      return withAccountTrafficCacheTelemetryV1(
        await snapshot.promise,
        cacheHitCount,
      )
    }
    const promise = loader()
    cacheHitCount = 0
    snapshot = { expiresAt: timestamp + maximumAgeMs, promise }
    try {
      return withAccountTrafficCacheTelemetryV1(await promise, 0)
    } catch (error) {
      if (snapshot?.promise === promise) snapshot = null
      throw error
    }
  }
}

const loadBoundedSellerOsAssistantMonitorSnapshotV1 =
  createSellerOsAssistantMonitorSnapshotLoaderV1()

export async function loadSellerOsAssistantMonitorSnapshotV1() {
  return loadBoundedSellerOsAssistantMonitorSnapshotV1()
}
