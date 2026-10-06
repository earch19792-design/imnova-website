import type { SupabaseClient } from "@supabase/supabase-js"

import type { SafeMarketplaceOrder } from
  "../marketplace/commercial-monitor-domain"
import {
  normalizeCommercialThresholds,
  persistOrdersAndSales,
} from "./ebay-commercial-monitor-service"
import { getEbayCompletedCheckoutOrders } from "./ebay-commercial-readers"
import { getEbaySellerAccountScopeConfiguration } from
  "./ebay-seller-account-scope"
import {
  assertEbayLaneAvailable,
  recordPersistentEbayRateLimit,
} from "./ebay-persistent-quota-coordinator"

export const EBAY_OWNER_SALE_ALERT_LANE_VERSION =
  "EBAY_OWNER_SALE_ALERT_LANE_V1" as const
export const MISSING_OWNER_SALE_ALERT_RECOVERY_VERSION =
  "MISSING_OWNER_SALE_ALERT_RECOVERY_V1" as const

const MARKETPLACE = "EBAY_US"
const ORDER_LOOKBACK_HOURS = 168
const CURSOR_OVERLAP_MINUTES = 5

const TARGETED_RECOVERY = Object.freeze({
  orderId: "12-15256-64974",
  itemId: "366700046680",
  sku: "ITEM3992",
})

type OrderReader = typeof getEbayCompletedCheckoutOrders

function safeCode(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message) ? message : fallback
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function orderCursorPlan(
  supabase: SupabaseClient,
  accountKey: string,
  now: Date,
) {
  const [latestRead, targetedRecoveryRead] = await Promise.all([
    supabase
      .from("marketplace_order_snapshots")
      .select("order_modified_at")
      .eq("marketplace_account_key", accountKey)
      .eq("marketplace", MARKETPLACE)
      .order("order_modified_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("marketplace_order_snapshots")
      .select("marketplace_order_id")
      .eq("marketplace_account_key", accountKey)
      .eq("marketplace", MARKETPLACE)
      .eq("marketplace_order_id", TARGETED_RECOVERY.orderId)
      .maybeSingle(),
  ])
  if (latestRead.error || targetedRecoveryRead.error) {
    throw new Error("OWNER_SALE_ORDER_CURSOR_READ_FAILED")
  }
  const oldest = now.getTime() - ORDER_LOOKBACK_HOURS * 60 * 60 * 1_000
  const prior = typeof latestRead.data?.order_modified_at === "string"
    ? Date.parse(latestRead.data.order_modified_at) -
      CURSOR_OVERLAP_MINUTES * 60 * 1_000
    : oldest
  const incrementalFrom = new Date(Math.max(
    oldest,
    Number.isFinite(prior) ? prior : oldest,
  )).toISOString()
  const targetedRecoveryScan = !targetedRecoveryRead.data
  return Object.freeze({
    modifiedFrom: targetedRecoveryScan
      ? new Date(oldest).toISOString()
      : incrementalFrom,
    incrementalFrom,
    targetedRecoveryScan,
  })
}

async function ownerSaleOrderRead(
  supabase: SupabaseClient,
  input: {
    modifiedFrom: string
    modifiedTo: string
    readOrders: OrderReader
  },
) {
  const dependencies = [
    { apiFamily: "OAUTH", operation: "ORDERS_REFRESH_TOKEN",
      endpoint: "/identity/v1/oauth2/token" },
    { apiFamily: "TRADING", operation: "GET_USER",
      endpoint: "/ws/api.dll" },
    { apiFamily: "SELL_FULFILLMENT", operation: "GET_ORDERS",
      endpoint: "/sell/fulfillment/v1/order" },
  ]
  for (const dependency of dependencies) {
    const state = await assertEbayLaneAvailable(
      supabase,
      dependency.apiFamily,
      dependency.operation,
    )
    if (!state.available) {
      throw new Error("EBAY_OWNER_SALE_ORDER_LANE_PAUSED_429")
    }
  }
  try {
    return await input.readOrders({
      modifiedFrom: input.modifiedFrom,
      modifiedTo: input.modifiedTo,
    })
  } catch (error) {
    const dependency = dependencies.at(-1) as (typeof dependencies)[number]
    await recordPersistentEbayRateLimit(supabase, {
      error,
      ...dependency,
      lane: "P0_ORDERS",
      checkpoint: {
        ownerSaleAlertLaneVersion: EBAY_OWNER_SALE_ALERT_LANE_VERSION,
        modifiedFrom: input.modifiedFrom,
        modifiedTo: input.modifiedTo,
      },
      retryCount: 0,
    })
    throw error
  }
}

/**
 * P0 polling lane for official paid eBay orders. It deliberately supplies no
 * Registry, StockGuard, Luna, or analytics evidence to persistence: those
 * systems enrich the sale later and cannot suppress the durable owner alert.
 */
export async function runEbayOwnerSaleAlertLaneV1(
  supabase: SupabaseClient,
  input: {
    accountKey?: string
    now?: Date
    readOrders?: OrderReader
  } = {},
) {
  const accountKey = input.accountKey ??
    getEbaySellerAccountScopeConfiguration().accountKey
  const now = input.now ?? new Date()
  const observedAt = now.toISOString()
  if (!accountKey) throw new Error("OWNER_SALE_ALERT_ACCOUNT_SCOPE_REQUIRED")
  let cursor: Awaited<ReturnType<typeof orderCursorPlan>>
  try {
    cursor = await orderCursorPlan(supabase, accountKey, now)
  } catch (error) {
    return Object.freeze({
      contractVersion: EBAY_OWNER_SALE_ALERT_LANE_VERSION,
      success: false as const,
      status: "ORDER_SOURCE_UNAVAILABLE" as const,
      source: "EBAY_SELL_FULFILLMENT_GET_ORDERS" as const,
      sourceStatus: "UNAVAILABLE" as const,
      observedAt,
      orderCount: null,
      lineCount: null,
      errorCode: safeCode(error, "OWNER_SALE_ORDER_CURSOR_READ_FAILED"),
      falseZeroPrevented: true as const,
      persistenceSkipped: true as const,
      marketplaceWrites: 0 as const,
    })
  }
  let response: Awaited<ReturnType<OrderReader>>
  try {
    response = await ownerSaleOrderRead(supabase, {
      modifiedFrom: cursor.modifiedFrom,
      modifiedTo: observedAt,
      readOrders: input.readOrders ?? getEbayCompletedCheckoutOrders,
    })
  } catch (error) {
    return Object.freeze({
      contractVersion: EBAY_OWNER_SALE_ALERT_LANE_VERSION,
      success: false as const,
      status: "ORDER_SOURCE_UNAVAILABLE" as const,
      source: "EBAY_SELL_FULFILLMENT_GET_ORDERS" as const,
      sourceStatus: "UNAVAILABLE" as const,
      observedAt,
      orderCount: null,
      lineCount: null,
      errorCode: safeCode(error, "EBAY_OWNER_SALE_ORDER_READ_FAILED"),
      falseZeroPrevented: true as const,
      persistenceSkipped: true as const,
      marketplaceWrites: 0 as const,
    })
  }
  // A one-time widened read is required when the known missed order has no
  // snapshot. Persist only that order plus the normal incremental window so
  // the recovery cannot fan out historical notifications or audit noise.
  const incrementalBoundary = Date.parse(cursor.incrementalFrom)
  const orders = cursor.targetedRecoveryScan
    ? response.orders.filter((order) =>
        order.ebayOrderId === TARGETED_RECOVERY.orderId ||
        Date.parse(order.lastModifiedDate) >= incrementalBoundary)
    : response.orders
  const work = await persistOrdersAndSales({
    supabase,
    accountKey,
    orders,
    listings: [],
    supplies: [],
    thresholds: normalizeCommercialThresholds({
      version: EBAY_OWNER_SALE_ALERT_LANE_VERSION,
    }),
    observedAt,
    verifiedIdentities: new Set(),
    ownerAlertRecoveryOrderIds: cursor.targetedRecoveryScan && orders.some(
      (order) => order.ebayOrderId === TARGETED_RECOVERY.orderId,
    ) ? [TARGETED_RECOVERY.orderId] : [],
  })
  return Object.freeze({
    contractVersion: EBAY_OWNER_SALE_ALERT_LANE_VERSION,
    success: true as const,
    status: "COMPLETED" as const,
    source: response.source,
    sourceStatus: "AVAILABLE" as const,
    observedAt,
    modifiedFrom: cursor.modifiedFrom,
    incrementalFrom: cursor.incrementalFrom,
    targetedRecoveryScan: cursor.targetedRecoveryScan,
    targetedRecoveryOrderObserved: orders.some((order) =>
      order.ebayOrderId === TARGETED_RECOVERY.orderId),
    upstreamOrderCount: response.orders.length,
    orderCount: orders.length,
    lineCount: orders.reduce((sum, order) =>
      sum + order.lineItems.length, 0),
    pagesRead: response.pagesRead,
    newSales: work.newSales,
    eventsCreated: work.eventsCreated,
    ownerAlertOutboxesCreated: work.alertsGenerated,
    duplicatesAvoided: work.duplicatesAvoided,
    downstreamEnrichmentErrors: work.errors,
    registryRequired: false as const,
    stockGuardRequired: false as const,
    lunaLinkageRequired: false as const,
    analyticsRequired: false as const,
    falseZeroPrevented: false as const,
    marketplaceWrites: 0 as const,
  })
}

function snapshotOrder(
  snapshot: Record<string, unknown>,
  lines: Array<Record<string, unknown>>,
): SafeMarketplaceOrder {
  const orderId = String(snapshot.marketplace_order_id ?? "")
  return {
    ebayOrderId: orderId,
    creationDate: String(snapshot.order_created_at ?? ""),
    lastModifiedDate: String(snapshot.order_modified_at ?? ""),
    orderPaymentStatus: String(snapshot.payment_status ?? ""),
    orderFulfillmentStatus: String(snapshot.fulfillment_status ?? ""),
    totalAmount: numberOrNull(snapshot.total_amount),
    currency: String(snapshot.currency ?? "") || null,
    marketplaceId: MARKETPLACE,
    lineItems: lines.map((line) => ({
      ebayOrderId: orderId,
      lineItemId: String(line.marketplace_line_item_id ?? ""),
      listingId: String(line.listing_id ?? ""),
      sku: typeof line.sku === "string" ? line.sku : null,
      title: String(line.product_title ?? ""),
      quantity: Math.trunc(Number(line.quantity ?? 0)),
      lineItemAmount: numberOrNull(line.line_item_amount),
      currency: String(line.currency ?? snapshot.currency ?? "") || null,
      shipByDate: typeof line.ship_by_at === "string"
        ? line.ship_by_at : null,
    })),
  }
}

/**
 * Narrow, one-order recovery for the owner alert missed on 2026-10-06. Any
 * existing commercial outbox row for the order makes this a no-op, including
 * delivered, failed, dead-letter, or cancelled history.
 */
export async function backfillMissingOwnerSaleAlertV1(
  supabase: SupabaseClient,
  input: { accountKey: string; now?: Date },
) {
  const observedAt = (input.now ?? new Date()).toISOString()
  const { data: snapshot, error: snapshotError } = await supabase
    .from("marketplace_order_snapshots")
    .select("marketplace_account_key,marketplace,marketplace_order_id,order_created_at,order_modified_at,payment_status,fulfillment_status,total_amount,currency,source")
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", MARKETPLACE)
    .eq("marketplace_order_id", TARGETED_RECOVERY.orderId)
    .maybeSingle()
  if (snapshotError) throw new Error("OWNER_SALE_BACKFILL_SNAPSHOT_READ_FAILED")
  if (!snapshot) return Object.freeze({
    status: "SKIPPED" as const,
    reasonCode: "OFFICIAL_ORDER_SNAPSHOT_NOT_OBSERVED" as const,
    orderId: TARGETED_RECOVERY.orderId,
    outboxesCreated: 0,
  })
  if (snapshot.source !== "EBAY_SELL_FULFILLMENT_GET_ORDERS" ||
      String(snapshot.payment_status).toUpperCase() !== "PAID") {
    return Object.freeze({
      status: "BLOCKED" as const,
      reasonCode: "OFFICIAL_PAID_ORDER_REQUIRED" as const,
      orderId: TARGETED_RECOVERY.orderId,
      outboxesCreated: 0,
    })
  }
  const { data: lines, error: linesError } = await supabase
    .from("marketplace_order_line_items")
    .select("marketplace_order_id,marketplace_line_item_id,listing_id,sku,product_title,quantity,line_item_amount,currency,ship_by_at,source")
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", MARKETPLACE)
    .eq("marketplace_order_id", TARGETED_RECOVERY.orderId)
  if (linesError) throw new Error("OWNER_SALE_BACKFILL_LINES_READ_FAILED")
  const officialLines = (lines ?? []).filter((line) =>
    line.source === "EBAY_SELL_FULFILLMENT_GET_ORDERS")
  const expectedLine = officialLines.find((line) =>
    line.listing_id === TARGETED_RECOVERY.itemId &&
    line.sku === TARGETED_RECOVERY.sku)
  if (!expectedLine || !officialLines.length) return Object.freeze({
    status: "BLOCKED" as const,
    reasonCode: "EXPECTED_OFFICIAL_ORDER_LINE_REQUIRED" as const,
    orderId: TARGETED_RECOVERY.orderId,
    outboxesCreated: 0,
  })
  const { data: events, error: eventsError } = await supabase
    .from("commercial_alert_events")
    .select("id")
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", MARKETPLACE)
    .eq("event_type", "SALE_DETECTED")
    .eq("marketplace_order_id", TARGETED_RECOVERY.orderId)
    .limit(20)
  if (eventsError) throw new Error("OWNER_SALE_BACKFILL_EVENT_READ_FAILED")
  const eventIds = (events ?? []).map((event) => event.id)
  if (eventIds.length) {
    const { data: existing, error: outboxError } = await supabase
      .from("alert_delivery_outbox")
      .select("id,status")
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", MARKETPLACE)
      .eq("channel", "whatsapp")
      .in("commercial_event_id", eventIds)
      .limit(1)
    if (outboxError) throw new Error("OWNER_SALE_BACKFILL_OUTBOX_READ_FAILED")
    if (existing?.length) return Object.freeze({
      status: "ALREADY_MATERIALIZED" as const,
      reasonCode: "OWNER_SALE_ALERT_OUTBOX_ALREADY_EXISTS" as const,
      orderId: TARGETED_RECOVERY.orderId,
      outboxesCreated: 0,
    })
  }
  const work = await persistOrdersAndSales({
    supabase,
    accountKey: input.accountKey,
    orders: [snapshotOrder(snapshot, officialLines)],
    listings: [],
    supplies: [],
    thresholds: normalizeCommercialThresholds({
      version: MISSING_OWNER_SALE_ALERT_RECOVERY_VERSION,
    }),
    observedAt,
    verifiedIdentities: new Set(),
    ownerAlertRecoveryOrderIds: [TARGETED_RECOVERY.orderId],
  })
  return Object.freeze({
    status: work.alertsGenerated > 0
      ? "RECOVERED" as const
      : "ALREADY_MATERIALIZED" as const,
    reasonCode: work.alertsGenerated > 0
      ? "MISSING_OWNER_SALE_ALERT_RECOVERED_ONCE" as const
      : "OWNER_SALE_ALERT_OUTBOX_ALREADY_EXISTS" as const,
    orderId: TARGETED_RECOVERY.orderId,
    outboxesCreated: work.alertsGenerated,
    duplicatesAvoided: work.duplicatesAvoided,
    marketplaceWrites: 0 as const,
  })
}
