import { randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildDailyCommercialSummary,
  containsPrivateBuyerData,
  DEFAULT_COMMERCIAL_THRESHOLDS,
  evaluateCommercialRules,
  extractPackQuantity,
  renderDailyCommercialSummary,
  renderSaleDetectedMessage,
  stableCommercialKey,
  type CommercialEvent,
  type CommercialSnapshot,
  type CommercialThresholds,
  type SafeMarketplaceOrder,
  type SafeMarketplaceOrderLine,
} from "../marketplace/commercial-monitor-domain"
import {
  dispatchCommercialAlertOutbox,
} from "../marketplace/commercial-alert-dispatcher"
import { calculateEbayUnitEconomics } from "./ebay-unit-economics"
import {
  getComparableEbayTrafficAnalytics,
  getEbayCommercialReadersConfiguration,
  getEbayCompletedCheckoutOrders,
  getEbayListingWatchers,
} from "./ebay-commercial-readers"
import {
  getEbayCommercialReaderAuthState,
  settleEbayCommercialReaderPromises,
} from "./ebay-commercial-oauth-domain"
import { getEbaySellerAccountScopeConfiguration } from "./ebay-seller-account-scope"

const MARKETPLACE = "EBAY_US"
const MONITOR_LEASE_SECONDS = 300
const PILOT_LISTING_ID = "366543596425"
const PILOT_SKU = "ITEM3995"

export const COMMERCIAL_MONITOR_LANES = [
  "orders", "analytics", "watchers", "rules", "daily_summary", "whatsapp",
] as const

export type CommercialMonitorLane = typeof COMMERCIAL_MONITOR_LANES[number]

type ListingRow = {
  id: string
  account_key: string
  source: string
  ebay_item_id: string
  ebay_sku: string | null
  listing_status: string
  title: string
  ebay_price: number | string | null
  currency: string
  market_radar_product_id: string | null
  supplier_variant_id: string | null
  supplier_sku: string | null
  supplier_cost_at_linking: number | string | null
  last_ebay_sync_at: string | null
  raw_payload: Record<string, unknown> | null
}

type SupplyRow = {
  product_id: string
  supplier_variant_id: string | null
  sku: string | null
  title: string | null
  variant_title: string | null
  price: number | string | null
  available: boolean | null
  inventory_quantity: number | null
  product_url: string | null
  captured_at: string | null
}

type ReaderState = {
  status: "available" | "partial" | "incomplete" | "unavailable" | "skipped"
  source: string
  observedAt: string | null
  metrics?: Record<string, unknown>
  error?: string
  auth?: ReturnType<typeof getEbayCommercialReaderAuthState>
}

type RunError = { reader: string; code: string; retryable: boolean }

function numeric(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
    : fallback
}

function safeCode(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message) ? message : fallback
}

function isoDay(value: Date) {
  return value.toISOString().slice(0, 10)
}

function analyticsWindow(now: Date) {
  const days = integer(process.env.EBAY_COMMERCIAL_ANALYTICS_WINDOW_DAYS, 7, 1, 30)
  const end = new Date(now)
  end.setUTCDate(end.getUTCDate() - 1)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - days + 1)
  return { dateFrom: isoDay(start), dateTo: isoDay(end), days }
}

function normalizedLanes(input: CommercialMonitorLane[] | undefined) {
  const requested = input?.length ? input : [...COMMERCIAL_MONITOR_LANES]
  return [...new Set(requested.filter((lane) => COMMERCIAL_MONITOR_LANES.includes(lane)))]
}

function thresholdNumber(
  source: Record<string, unknown>,
  key: keyof Omit<CommercialThresholds, "version">,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const value = numeric(source[key])
  return value === null ? fallback : Math.max(minimum, Math.min(maximum, value))
}

export function normalizeCommercialThresholds(value: unknown): CommercialThresholds {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const version = typeof source.version === "string" && /^[A-Z0-9_.-]{3,80}$/.test(source.version)
    ? source.version
    : DEFAULT_COMMERCIAL_THRESHOLDS.version
  return {
    version,
    trafficMinimumImpressions: thresholdNumber(source, "trafficMinimumImpressions", 100, 1, 1_000_000_000),
    lowCtrPercent: thresholdNumber(source, "lowCtrPercent", 1.5, 0, 100),
    conversionMinimumViews: thresholdNumber(source, "conversionMinimumViews", 30, 1, 1_000_000_000),
    acceleratedUnits24h: thresholdNumber(source, "acceleratedUnits24h", 2, 1, 100_000),
    lowStockMinimum: thresholdNumber(source, "lowStockMinimum", 1, 0, 1_000_000),
    lowStockMaximum: thresholdNumber(source, "lowStockMaximum", 3, 0, 1_000_000),
    marginRiskPercent: thresholdNumber(source, "marginRiskPercent", 20, -1_000, 100),
    marginCriticalPercent: thresholdNumber(source, "marginCriticalPercent", 10, -1_000, 100),
  }
}

function thresholdPayload(thresholds: CommercialThresholds) {
  return {
    trafficMinimumImpressions: thresholds.trafficMinimumImpressions,
    lowCtrPercent: thresholds.lowCtrPercent,
    conversionMinimumViews: thresholds.conversionMinimumViews,
    acceleratedUnits24h: thresholds.acceleratedUnits24h,
    lowStockMinimum: thresholds.lowStockMinimum,
    lowStockMaximum: thresholds.lowStockMaximum,
    marginRiskPercent: thresholds.marginRiskPercent,
    marginCriticalPercent: thresholds.marginCriticalPercent,
  }
}

async function loadThresholds(
  supabase: SupabaseClient,
  accountKey: string,
  createDefault = true,
) {
  const { data, error } = await supabase
    .from("commercial_threshold_configs")
    .select("version,thresholds")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", MARKETPLACE)
    .eq("active", true)
    .maybeSingle()
  if (error) throw new Error("COMMERCIAL_THRESHOLDS_READ_FAILED")
  if (data) return normalizeCommercialThresholds({
    ...(data.thresholds as Record<string, unknown>),
    version: data.version,
  })

  const defaults = DEFAULT_COMMERCIAL_THRESHOLDS
  if (!createDefault) return defaults
  const { error: insertError } = await supabase
    .from("commercial_threshold_configs")
    .insert({
      marketplace_account_key: accountKey,
      marketplace: MARKETPLACE,
      version: defaults.version,
      active: true,
      thresholds: thresholdPayload(defaults),
    })
  if (insertError && insertError.code !== "23505") {
    throw new Error("COMMERCIAL_THRESHOLDS_CREATE_FAILED")
  }
  return defaults
}

export async function updateCommercialThresholds(
  supabase: SupabaseClient,
  input: {
    marketplaceAccountKey: string
    version: string
    thresholds: unknown
    userId?: string | null
  },
) {
  const thresholds = normalizeCommercialThresholds({
    ...(input.thresholds && typeof input.thresholds === "object" ? input.thresholds : {}),
    version: input.version,
  })
  if (thresholds.version !== input.version) throw new Error("COMMERCIAL_THRESHOLDS_VERSION_INVALID")
  if (thresholds.lowStockMinimum > thresholds.lowStockMaximum) {
    throw new Error("COMMERCIAL_THRESHOLDS_STOCK_RANGE_INVALID")
  }
  if (thresholds.marginCriticalPercent > thresholds.marginRiskPercent) {
    throw new Error("COMMERCIAL_THRESHOLDS_MARGIN_RANGE_INVALID")
  }
  const now = new Date().toISOString()
  const { error: deactivateError } = await supabase
    .from("commercial_threshold_configs")
    .update({ active: false, updated_at: now })
    .eq("marketplace_account_key", input.marketplaceAccountKey)
    .eq("marketplace", MARKETPLACE)
    .eq("active", true)
  if (deactivateError) throw new Error("COMMERCIAL_THRESHOLDS_UPDATE_FAILED")
  const { error } = await supabase
    .from("commercial_threshold_configs")
    .upsert({
      marketplace_account_key: input.marketplaceAccountKey,
      marketplace: MARKETPLACE,
      version: thresholds.version,
      active: true,
      thresholds: thresholdPayload(thresholds),
      created_by: input.userId ?? null,
      updated_at: now,
    }, { onConflict: "marketplace_account_key,marketplace,version" })
  if (error) throw new Error("COMMERCIAL_THRESHOLDS_UPDATE_FAILED")
  return thresholds
}

function listingPreference(row: ListingRow) {
  if (row.source === "EBAY_SELL_INVENTORY_READONLY") return 3
  if (row.source === "EBAY_TRADING_GET_ITEM_READONLY") return 2
  return 1
}

function canonicalListings(rows: ListingRow[]) {
  const byIdentity = new Map<string, ListingRow>()
  for (const row of rows) {
    const key = `${row.ebay_item_id}:${row.ebay_sku ?? row.supplier_sku ?? ""}`
    const current = byIdentity.get(key)
    if (!current || listingPreference(row) > listingPreference(current)) byIdentity.set(key, row)
  }
  return [...byIdentity.values()]
}

async function loadActiveListings(supabase: SupabaseClient, accountKey: string) {
  const { data, error } = await supabase
    .from("ebay_active_listings")
    .select("id,account_key,source,ebay_item_id,ebay_sku,listing_status,title,ebay_price,currency,market_radar_product_id,supplier_variant_id,supplier_sku,supplier_cost_at_linking,last_ebay_sync_at,raw_payload")
    .eq("account_key", accountKey)
    .eq("listing_status", "active")
    .order("updated_at", { ascending: false })
    .limit(500)
  if (error) throw new Error("COMMERCIAL_ACTIVE_LISTINGS_READ_FAILED")
  return canonicalListings((data ?? []) as ListingRow[])
}

async function loadSupplyRows(supabase: SupabaseClient, listings: ListingRow[]) {
  const productIds = [...new Set(listings
    .map((row) => row.market_radar_product_id)
    .filter((value): value is string => Boolean(value)))]
  const rows: SupplyRow[] = []
  for (let index = 0; index < productIds.length; index += 100) {
    const { data, error } = await supabase
      .from("market_radar_latest_variants")
      .select("product_id,supplier_variant_id,sku,title,variant_title,price,available,inventory_quantity,product_url,captured_at")
      .in("product_id", productIds.slice(index, index + 100))
    if (error) throw new Error("COMMERCIAL_LUNA_SUPPLY_READ_FAILED")
    rows.push(...((data ?? []) as SupplyRow[]))
  }
  return rows
}

function supplyForListing(listing: ListingRow, supplies: SupplyRow[]) {
  const candidates = supplies.filter((row) => row.product_id === listing.market_radar_product_id)
  return candidates.find((row) =>
    listing.supplier_variant_id && row.supplier_variant_id === listing.supplier_variant_id
  ) ?? candidates.find((row) =>
    listing.supplier_sku && row.sku === listing.supplier_sku
  ) ?? (candidates.length === 1 ? candidates[0] : null)
}

async function loadPreviousSnapshots(
  supabase: SupabaseClient,
  accountKey: string,
  listingIds: string[],
) {
  if (!listingIds.length) return new Map<string, CommercialSnapshot>()
  const { data, error } = await supabase
    .from("listing_commercial_snapshots")
    .select("marketplace_account_key,listing_id,sku,listing_status,impressions,views,ctr,transactions,sales_conversion_rate,revenue,current_watchers,stock_available,supplier_cost,estimated_margin_percent,observed_at,window_start,window_end,completeness_status")
    .eq("marketplace_account_key", accountKey)
    .in("listing_id", listingIds)
    .order("observed_at", { ascending: false })
    .limit(2_000)
  if (error) throw new Error("COMMERCIAL_SNAPSHOT_HISTORY_READ_FAILED")
  const result = new Map<string, CommercialSnapshot>()
  for (const row of data ?? []) {
    const key = `${row.listing_id}:${row.sku ?? ""}`
    if (result.has(key)) continue
    result.set(key, {
      marketplaceAccountKey: row.marketplace_account_key,
      listingId: row.listing_id,
      sku: row.sku,
      listingStatus: row.listing_status,
      impressions: numeric(row.impressions),
      views: numeric(row.views),
      ctr: numeric(row.ctr),
      transactions: numeric(row.transactions),
      salesConversionRate: numeric(row.sales_conversion_rate),
      revenue: numeric(row.revenue),
      currentWatchers: numeric(row.current_watchers),
      stockAvailable: numeric(row.stock_available),
      supplierCost: numeric(row.supplier_cost),
      estimatedMarginPercent: numeric(row.estimated_margin_percent),
      observedAt: row.observed_at,
      windowStart: row.window_start,
      windowEnd: row.window_end,
      completenessStatus: row.completeness_status,
    })
  }
  return result
}

async function latestOrderModifiedAt(supabase: SupabaseClient, accountKey: string, now: Date) {
  const { data } = await supabase
    .from("marketplace_order_snapshots")
    .select("order_modified_at")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", MARKETPLACE)
    .order("order_modified_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const lookbackHours = integer(process.env.EBAY_COMMERCIAL_ORDER_LOOKBACK_HOURS, 168, 1, 2_160)
  const oldest = now.getTime() - lookbackHours * 60 * 60 * 1_000
  const previous = data?.order_modified_at ? Date.parse(data.order_modified_at) - 5 * 60 * 1_000 : oldest
  return new Date(Math.max(oldest, Number.isFinite(previous) ? previous : oldest)).toISOString()
}

function verifiedListingForLine(listings: ListingRow[], line: SafeMarketplaceOrderLine) {
  if (!line.sku) return null
  return listings.find((listing) =>
    listing.ebay_item_id === line.listingId &&
    listing.listing_status === "active" &&
    (listing.ebay_sku === line.sku || listing.supplier_sku === line.sku)
  ) ?? null
}

async function insertEvent(supabase: SupabaseClient, accountKey: string, event: CommercialEvent & {
  marketplaceOrderId?: string | null
  marketplaceLineItemId?: string | null
}) {
  if (containsPrivateBuyerData(event.evidence)) {
    throw new Error("COMMERCIAL_EVENT_PRIVATE_BUYER_DATA_BLOCKED")
  }
  const { data, error } = await supabase
    .from("commercial_alert_events")
    .insert({
      marketplace_account_key: accountKey,
      marketplace: MARKETPLACE,
      event_type: event.eventType,
      severity: event.severity,
      evidence: event.evidence,
      threshold_config_version: event.thresholdConfigVersion,
      detected_at: event.detectedAt,
      listing_id: event.listingId,
      sku: event.sku,
      marketplace_order_id: event.marketplaceOrderId ?? null,
      marketplace_line_item_id: event.marketplaceLineItemId ?? null,
      deduplication_key: event.deduplicationKey,
      recommended_action: event.recommendedAction,
    })
    .select("id")
    .maybeSingle()
  if (error?.code === "23505") {
    const { data: existing, error: readError } = await supabase
      .from("commercial_alert_events")
      .select("id")
      .eq("deduplication_key", event.deduplicationKey)
      .maybeSingle()
    if (readError || !existing?.id) throw new Error("COMMERCIAL_EVENT_RECOVERY_READ_FAILED")
    return { id: existing.id as string, created: false }
  }
  if (error || !data?.id) throw new Error("COMMERCIAL_EVENT_CREATE_FAILED")
  return { id: data.id as string, created: true }
}

async function enqueueAlert(supabase: SupabaseClient, input: {
  accountKey: string
  eventId: string
  severity: CommercialEvent["severity"]
  deduplicationKey: string
  deliveryClass: "immediate" | "digest"
  payload: Record<string, unknown>
}) {
  if (containsPrivateBuyerData(input.payload)) {
    throw new Error("COMMERCIAL_ALERT_PRIVATE_BUYER_DATA_BLOCKED")
  }
  const { error } = await supabase.from("alert_delivery_outbox").insert({
    marketplace_account_key: input.accountKey,
    marketplace: MARKETPLACE,
    commercial_event_id: input.eventId,
    channel: "whatsapp",
    delivery_class: input.deliveryClass,
    severity: input.severity,
    deduplication_key: `whatsapp:${input.deduplicationKey}`,
    status: "pending",
    payload: input.payload,
    due_at: new Date().toISOString(),
  })
  if (error && error.code !== "23505") throw new Error("COMMERCIAL_ALERT_ENQUEUE_FAILED")
  return !error
}

function safeHttpsUrl(value: string | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" ? url.toString().replace(/\/$/, "") : null
  } catch {
    return null
  }
}

function sellerOrderUrl(orderId: string) {
  const base = safeHttpsUrl(process.env.EBAY_SELLER_COMMAND_CENTER_URL)
  return base ? `${base}?section=fulfillment&order=${encodeURIComponent(orderId)}` : null
}

function eventPayload(event: CommercialEvent) {
  const labels: Record<string, string> = {
    GOOD_TRAFFIC_LOW_CTR: "Tráfico eBay con CTR bajo",
    GOOD_CTR_LOW_CONVERSION: "Interés sin conversión",
    ACCELERATED_SALES: "Ventas aceleradas",
    LOW_STOCK: "Stock Luna bajo",
    ACTIVE_LISTING_OUT_OF_STOCK: "Listing activo sin stock Luna",
    MARGIN_RISK: "Margen estimado en riesgo",
    WATCHER_MILESTONE: "Hito de watchers",
    WATCHER_INCREASE: "Aumento de watchers",
  }
  return {
    title: labels[event.eventType] ?? event.eventType,
    summary: `Listing ${event.listingId} · SKU ${event.sku ?? "pendiente"}. Evidencia: ${JSON.stringify(event.evidence)}`,
    action: event.recommendedAction,
    classification: event.eventType.startsWith("WATCHER_")
      ? "INTEREST_SIGNAL_NOT_SALE"
      : "COMMERCIAL_MONITOR_EVENT",
  }
}

async function persistOrdersAndSales(input: {
  supabase: SupabaseClient
  accountKey: string
  orders: SafeMarketplaceOrder[]
  listings: ListingRow[]
  supplies: SupplyRow[]
  thresholds: CommercialThresholds
  observedAt: string
}) {
  const { supabase, accountKey, orders, listings, supplies, thresholds, observedAt } = input
  let newSales = 0
  let tasksCreated = 0
  let alertsGenerated = 0
  let estimatedProfit = 0
  const errors: RunError[] = []

  for (const order of orders) {
    const { error: orderError } = await supabase
      .from("marketplace_order_snapshots")
      .upsert({
        marketplace_account_key: accountKey,
        marketplace: MARKETPLACE,
        marketplace_order_id: order.ebayOrderId,
        order_created_at: order.creationDate,
        order_modified_at: order.lastModifiedDate,
        payment_status: order.orderPaymentStatus,
        fulfillment_status: order.orderFulfillmentStatus,
        total_amount: order.totalAmount,
        currency: order.currency,
        source: "EBAY_SELL_FULFILLMENT_GET_ORDERS",
        observed_at: observedAt,
        updated_at: observedAt,
      }, { onConflict: "marketplace_account_key,marketplace,marketplace_order_id" })
    if (orderError) throw new Error("COMMERCIAL_ORDER_SNAPSHOT_WRITE_FAILED")

    for (const line of order.lineItems) {
      const packQuantity = extractPackQuantity(line.title)
      const { error: lineError } = await supabase
        .from("marketplace_order_line_items")
        .upsert({
          marketplace_account_key: accountKey,
          marketplace: MARKETPLACE,
          marketplace_order_id: order.ebayOrderId,
          marketplace_line_item_id: line.lineItemId,
          listing_id: line.listingId,
          sku: line.sku,
          product_title: line.title,
          pack_quantity: packQuantity,
          quantity: line.quantity,
          line_item_amount: line.lineItemAmount,
          currency: line.currency,
          ship_by_at: line.shipByDate,
          source: "EBAY_SELL_FULFILLMENT_GET_ORDERS",
          last_observed_at: observedAt,
          updated_at: observedAt,
        }, { onConflict: "marketplace_account_key,marketplace,marketplace_order_id,marketplace_line_item_id" })
      if (lineError) throw new Error("COMMERCIAL_ORDER_LINE_WRITE_FAILED")

      const listing = verifiedListingForLine(listings, line)
      if (!listing) {
        errors.push({
          reader: "orders",
          code: "SALE_LISTING_ITEM_ID_OR_SKU_VERIFICATION_FAILED",
          retryable: false,
        })
        continue
      }
      const supply = supplyForListing(listing, supplies)
      const supplierUnitCost = numeric(supply?.price) ?? numeric(listing.supplier_cost_at_linking)
      const estimatedSupplierCost = supplierUnitCost === null
        ? null
        : Number((supplierUnitCost * packQuantity * line.quantity).toFixed(2))
      const economics = calculateEbayUnitEconomics({
        salePrice: line.lineItemAmount,
        supplierCost: estimatedSupplierCost,
      })
      const profit = economics.estimatedNetProfit
      if (profit !== null) estimatedProfit += profit
      const stockAvailable = supply?.available === false
        ? 0
        : supply?.inventory_quantity ?? null
      const statusHistory = ["SALE_DETECTED", "VALIDATING_ORDER", "PENDING_MANUAL_PURCHASE"]
        .map((status) => ({ status, at: observedAt, actor: "commercial_monitor" }))
      const { data: task, error: taskError } = await supabase
        .from("fulfillment_tasks")
        .insert({
          marketplace_account_key: accountKey,
          marketplace: MARKETPLACE,
          marketplace_order_id: order.ebayOrderId,
          marketplace_line_item_id: line.lineItemId,
          listing_id: line.listingId,
          sku: line.sku,
          product_title: line.title,
          pack_quantity: packQuantity,
          quantity: line.quantity,
          status: "PENDING_MANUAL_PURCHASE",
          status_history: statusHistory,
          source_product_url: supply?.product_url ?? null,
          seller_order_url: sellerOrderUrl(order.ebayOrderId),
          supplier_unit_cost: supplierUnitCost,
          estimated_supplier_cost: estimatedSupplierCost,
          estimated_profit: profit,
          stock_available: stockAvailable,
          ship_by_at: line.shipByDate,
        })
        .select("id")
        .maybeSingle()
      if (taskError && taskError.code !== "23505") throw new Error("FULFILLMENT_TASK_CREATE_FAILED")
      if (task?.id) tasksCreated += 1

      const saleKey = stableCommercialKey(accountKey, "SALE_DETECTED", order.ebayOrderId, line.lineItemId)
      const saleEvent: CommercialEvent & { marketplaceOrderId: string; marketplaceLineItemId: string } = {
        eventType: "SALE_DETECTED",
        severity: "critical",
        evidence: {
          source: "OFFICIAL_COMPLETED_CHECKOUT_ORDER",
          orderPaymentStatus: order.orderPaymentStatus,
          orderFulfillmentStatus: order.orderFulfillmentStatus,
          quantity: line.quantity,
          amount: line.lineItemAmount,
          currency: line.currency,
          packQuantity,
          supplierUnitCost,
          estimatedSupplierCost,
          estimatedProfit: profit,
          stockAvailable,
          itemIdVerified: true,
          skuVerified: true,
        },
        thresholdConfigVersion: thresholds.version,
        detectedAt: observedAt,
        listingId: line.listingId,
        sku: line.sku,
        deduplicationKey: saleKey,
        recommendedAction: "Comprar manualmente en Luna Portex y luego pegar el tracking en Seller OS.",
        marketplaceOrderId: order.ebayOrderId,
        marketplaceLineItemId: line.lineItemId,
      }
      const saleEventResult = await insertEvent(supabase, accountKey, saleEvent)
      if (saleEventResult.created) {
        newSales += line.quantity
      }
      const message = renderSaleDetectedMessage({
        product: line.title,
        sku: line.sku ?? "pendiente",
        quantity: line.quantity,
        amount: line.lineItemAmount,
        currency: line.currency ?? order.currency ?? "USD",
        shipByDate: line.shipByDate,
        estimatedLunaCost: estimatedSupplierCost,
        estimatedProfit: profit,
        stockAvailable,
        sellerOrderUrl: sellerOrderUrl(order.ebayOrderId),
        lunaProductUrl: supply?.product_url ?? null,
      })
      const messageLines = message.split("\n")
      if (await enqueueAlert(supabase, {
        accountKey,
        eventId: saleEventResult.id,
        severity: "critical",
        deduplicationKey: saleKey,
        deliveryClass: "immediate",
        payload: {
          title: messageLines[0],
          summary: messageLines.slice(2, 11).join(" · "),
          action: messageLines.slice(11).join(" "),
          sellerOrderUrl: sellerOrderUrl(order.ebayOrderId),
          lunaProductUrl: supply?.product_url ?? null,
        },
      })) alertsGenerated += 1

      const firstSaleIdentity = line.listingId || line.sku || "unknown"
      const firstSaleKey = stableCommercialKey(accountKey, "FIRST_SALE_CONFIRMED", firstSaleIdentity)
      const firstEventResult = await insertEvent(supabase, accountKey, {
        ...saleEvent,
        eventType: "FIRST_SALE_CONFIRMED",
        severity: "high",
        evidence: {
          source: "OFFICIAL_COMPLETED_CHECKOUT_ORDER",
          firstSaleIdentity,
          itemIdVerified: true,
          skuVerified: true,
        },
        deduplicationKey: firstSaleKey,
        recommendedAction: "Conservar esta confirmación y priorizar el fulfillment manual de la primera venta.",
      })
      // FIRST_SALE_CONFIRMED is companion audit evidence for the same sale.
      // SALE_DETECTED already queued the immediate message, so a second
      // WhatsApp here would be a duplicate operator notification.
      void firstEventResult
    }
  }
  return { newSales, tasksCreated, alertsGenerated, estimatedProfit, errors }
}

async function confirmedUnitsSoldByListing24h(
  supabase: SupabaseClient,
  accountKey: string,
  now: Date,
) {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString()
  const { data: orders, error: orderError } = await supabase
    .from("marketplace_order_snapshots")
    .select("marketplace_order_id")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", MARKETPLACE)
    .gte("order_created_at", cutoff)
    .lte("order_created_at", now.toISOString())
    .limit(2_000)
  if (orderError) throw new Error("COMMERCIAL_ACCELERATED_SALES_READ_FAILED")
  const counts = new Map<string, number>()
  const orderIds = (orders ?? []).map((order) => order.marketplace_order_id)
  for (let index = 0; index < orderIds.length; index += 100) {
    const { data, error } = await supabase
      .from("marketplace_order_line_items")
      .select("listing_id,quantity")
      .eq("marketplace_account_key", accountKey)
      .eq("marketplace", MARKETPLACE)
      .in("marketplace_order_id", orderIds.slice(index, index + 100))
    if (error) throw new Error("COMMERCIAL_ACCELERATED_SALES_READ_FAILED")
    for (const line of data ?? []) {
      counts.set(line.listing_id, (counts.get(line.listing_id) ?? 0) + Number(line.quantity ?? 0))
    }
  }
  return counts
}

async function persistSnapshotsAndRules(input: {
  supabase: SupabaseClient
  accountKey: string
  runId: string
  listings: ListingRow[]
  supplies: SupplyRow[]
  previous: Map<string, CommercialSnapshot>
  thresholds: CommercialThresholds
  analytics: Awaited<ReturnType<typeof getComparableEbayTrafficAnalytics>> | null
  watchers: Awaited<ReturnType<typeof getEbayListingWatchers>> | null
  units24h: Map<string, number>
  observedAt: string
}) {
  const analyticsByListing = new Map(input.analytics?.observations.map((row) => [row.listingId, row]) ?? [])
  const watchersByListing = new Map(input.watchers?.observations.map((row) => [row.listingId, row]) ?? [])
  const snapshots: CommercialSnapshot[] = []
  let alertsGenerated = 0
  let eventsGenerated = 0
  for (const listing of input.listings) {
    const analytics = analyticsByListing.get(listing.ebay_item_id)
    const watcher = watchersByListing.get(listing.ebay_item_id)
    const supply = supplyForListing(listing, input.supplies)
    const supplierCost = numeric(supply?.price) ?? numeric(listing.supplier_cost_at_linking)
    const packQuantity = extractPackQuantity(listing.title)
    const totalSupplierCost = supplierCost === null ? null : supplierCost * packQuantity
    const economics = calculateEbayUnitEconomics({
      salePrice: listing.ebay_price,
      supplierCost: totalSupplierCost,
    })
    const previous = input.previous.get(`${listing.ebay_item_id}:${listing.ebay_sku ?? listing.supplier_sku ?? ""}`)
    const currentWatchers = watcher?.currentWatchers ?? null
    const snapshot: CommercialSnapshot = {
      marketplaceAccountKey: input.accountKey,
      listingId: listing.ebay_item_id,
      sku: listing.ebay_sku ?? listing.supplier_sku,
      listingStatus: listing.listing_status,
      impressions: analytics?.impressions ?? null,
      views: analytics?.views ?? null,
      ctr: analytics?.ctr ?? null,
      transactions: analytics?.transactions ?? null,
      salesConversionRate: analytics?.salesConversionRate ?? null,
      revenue: analytics?.revenue ?? null,
      currentWatchers,
      stockAvailable: supply?.available === false ? 0 : supply?.inventory_quantity ?? null,
      supplierCost,
      estimatedMarginPercent: economics.estimatedNetMarginPercent,
      observedAt: input.observedAt,
      windowStart: input.analytics?.windowStart ?? null,
      windowEnd: input.analytics?.windowEnd ?? null,
      completenessStatus: input.analytics?.completenessStatus ?? "unavailable",
    }
    const { error } = await input.supabase
      .from("listing_commercial_snapshots")
      .insert({
        monitor_run_id: input.runId,
        marketplace_account_key: input.accountKey,
        marketplace: MARKETPLACE,
        listing_id: snapshot.listingId,
        sku: snapshot.sku,
        listing_status: snapshot.listingStatus,
        impressions: snapshot.impressions,
        views: snapshot.views,
        ctr: snapshot.ctr,
        transactions: snapshot.transactions,
        sales_conversion_rate: snapshot.salesConversionRate,
        revenue: snapshot.revenue,
        current_watchers: snapshot.currentWatchers,
        previous_watchers: previous?.currentWatchers ?? null,
        delta_watchers: snapshot.currentWatchers === null
          ? null
          : snapshot.currentWatchers - (previous?.currentWatchers ?? 0),
        stock_available: snapshot.stockAvailable,
        supplier_cost: snapshot.supplierCost,
        estimated_margin_percent: snapshot.estimatedMarginPercent,
        observed_at: snapshot.observedAt,
        window_start: snapshot.windowStart,
        window_end: snapshot.windowEnd,
        source: {
          analytics: input.analytics?.source ?? null,
          watchers: watcher?.source ?? null,
          stock: supply ? "LUNA_PORTEX_MARKET_RADAR_LATEST_VARIANT" : null,
          transactionsClassification: "ANALYTICS_NOT_CONFIRMED_ORDER",
          watchersClassification: "INTEREST_SIGNAL_NOT_SALE",
        },
        completeness_status: snapshot.completenessStatus,
      })
    if (error) throw new Error("COMMERCIAL_SNAPSHOT_WRITE_FAILED")
    snapshots.push(snapshot)

    for (const event of evaluateCommercialRules({
      current: snapshot,
      previous,
      unitsSold24h: input.units24h.get(listing.ebay_item_id) ?? 0,
      thresholds: input.thresholds,
    })) {
      const eventResult = await insertEvent(input.supabase, input.accountKey, event)
      if (eventResult.created) eventsGenerated += 1
      const deliveryClass = event.eventType.startsWith("WATCHER_") ? "digest" : "immediate"
      if (await enqueueAlert(input.supabase, {
        accountKey: input.accountKey,
        eventId: eventResult.id,
        severity: event.severity,
        deduplicationKey: event.deduplicationKey,
        deliveryClass,
        payload: eventPayload(event),
      })) alertsGenerated += 1
    }
  }
  return { snapshots, eventsGenerated, alertsGenerated }
}

async function generateDailySummary(input: {
  supabase: SupabaseClient
  accountKey: string
  thresholds: CommercialThresholds
  snapshots: CommercialSnapshot[]
  orders: SafeMarketplaceOrder[]
  estimatedProfit: number
  observedAt: string
}) {
  const day = input.observedAt.slice(0, 10)
  const dayStart = `${day}T00:00:00.000Z`
  const dayEndDate = new Date(dayStart)
  dayEndDate.setUTCDate(dayEndDate.getUTCDate() + 1)
  const dayEnd = dayEndDate.toISOString()
  const previousDay = new Date(`${day}T00:00:00Z`)
  previousDay.setUTCDate(previousDay.getUTCDate() - 1)
  const [taskResult, priorResult, orderResult] = await Promise.all([
    input.supabase
      .from("fulfillment_tasks")
      .select("status,marketplace_order_id,estimated_profit,created_at")
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", MARKETPLACE)
      .order("created_at", { ascending: false })
      .limit(2_000),
    input.supabase
      .from("commercial_daily_summaries")
      .select("window_complete")
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", MARKETPLACE)
      .eq("summary_day", isoDay(previousDay))
      .maybeSingle(),
    input.supabase
      .from("marketplace_order_snapshots")
      .select("marketplace_order_id,total_amount")
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", MARKETPLACE)
      .gte("order_created_at", dayStart)
      .lt("order_created_at", dayEnd),
  ])
  if (taskResult.error || priorResult.error || orderResult.error) {
    throw new Error("COMMERCIAL_DAILY_SUMMARY_READ_FAILED")
  }
  const tasks = taskResult.data ?? []
  const dailyOrderIds = (orderResult.data ?? []).map((order) => order.marketplace_order_id)
  let confirmedSales = 0
  for (let index = 0; index < dailyOrderIds.length; index += 100) {
    const { data, error } = await input.supabase
      .from("marketplace_order_line_items")
      .select("quantity")
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", MARKETPLACE)
      .in("marketplace_order_id", dailyOrderIds.slice(index, index + 100))
    if (error) throw new Error("COMMERCIAL_DAILY_SUMMARY_READ_FAILED")
    confirmedSales += (data ?? []).reduce((sum, line) => sum + Number(line.quantity ?? 0), 0)
  }
  const revenue = (orderResult.data ?? []).reduce(
    (total, order) => total + Number(order.total_amount ?? 0),
    0,
  )
  const estimatedProfit = tasks
    .filter((task) => task.created_at >= dayStart && task.created_at < dayEnd)
    .reduce((total, task) => total + Number(task.estimated_profit ?? 0), 0)
  const summary = buildDailyCommercialSummary({
    snapshots: input.snapshots,
    confirmedSales,
    revenue,
    estimatedProfit,
    pendingPurchaseOrders: tasks.filter((task) => task.status === "PENDING_MANUAL_PURCHASE").length,
    awaitingTrackingOrders: tasks.filter((task) => task.status === "PURCHASED_AWAITING_TRACKING").length,
    previousDayComplete: priorResult.data?.window_complete === true,
  })
  const rendered = renderDailyCommercialSummary(summary)
  const { error } = await input.supabase.from("commercial_daily_summaries").upsert({
    marketplace_account_key: input.accountKey,
    marketplace: MARKETPLACE,
    summary_day: day,
    window_complete: summary.complete,
    comparable_to_previous_day: summary.comparableToPreviousDay,
    metrics: summary,
    rendered_summary: rendered,
    updated_at: input.observedAt,
  }, { onConflict: "marketplace_account_key,marketplace,summary_day" })
  if (error) throw new Error("COMMERCIAL_DAILY_SUMMARY_WRITE_FAILED")

  const event: CommercialEvent = {
    eventType: "DAILY_COMMERCIAL_SUMMARY",
    severity: "low",
    evidence: {
      ...summary,
      comparisonIncluded: summary.comparableToPreviousDay,
      transactionsClassification: "CONFIRMED_COMPLETED_CHECKOUT_ORDERS_ONLY",
    },
    thresholdConfigVersion: input.thresholds.version,
    detectedAt: input.observedAt,
    listingId: "ACCOUNT_SUMMARY",
    sku: null,
    deduplicationKey: stableCommercialKey(input.accountKey, "DAILY_COMMERCIAL_SUMMARY", day),
    recommendedAction: "Revisar órdenes pendientes, stock bajo y alertas críticas en Seller OS.",
  }
  const eventResult = await insertEvent(input.supabase, input.accountKey, event)
  await enqueueAlert(input.supabase, {
    accountKey: input.accountKey,
    eventId: eventResult.id,
    severity: "low",
    deduplicationKey: event.deduplicationKey,
    deliveryClass: "digest",
    payload: {
      title: "📊 RESUMEN DIARIO EBAY",
      summary: rendered.replace("📊 RESUMEN DIARIO EBAY\n\n", "").replaceAll("\n", " · "),
      action: event.recommendedAction,
    },
  })
  return { summary, rendered, alertGenerated: eventResult.created }
}

async function finishRun(
  supabase: SupabaseClient,
  runId: string,
  workerId: string,
  status: "completed" | "partial" | "failed" | "cancelled",
  readers: Record<string, ReaderState>,
  metrics: Record<string, unknown>,
  errors: RunError[],
  nextAction: string,
) {
  const { data, error } = await supabase.rpc("finish_commercial_monitor_run", {
    p_run_id: runId,
    p_worker_id: workerId,
    p_status: status,
    p_readers: readers,
    p_metrics: metrics,
    p_errors: errors,
    p_next_action: nextAction,
  })
  if (error || data !== true) throw new Error("COMMERCIAL_MONITOR_RUN_FINISH_FAILED")
}

export async function runEbayCommercialMonitor(
  supabase: SupabaseClient,
  input: {
    triggerSource: "manual" | "schedule" | "recovery" | "dry_run"
    lanes?: CommercialMonitorLane[]
    workerId?: string
    dispatchWhatsApp?: boolean
    dryRunWhatsApp?: boolean
    now?: Date
  },
) {
  const accountScope = getEbaySellerAccountScopeConfiguration()
  if (!accountScope.accountKey) throw new Error("COMMERCIAL_MONITOR_ACCOUNT_SCOPE_REQUIRED")
  const accountKey = accountScope.accountKey
  const lanes = normalizedLanes(input.lanes)
  const workerId = input.workerId ?? `commercial-monitor:${input.triggerSource}:${randomUUID()}`
  const { data: claimed, error: claimError } = await supabase.rpc("start_commercial_monitor_run", {
    p_marketplace_account_key: accountKey,
    p_marketplace: MARKETPLACE,
    p_trigger_source: input.triggerSource,
    p_requested_lanes: lanes,
    p_worker_id: workerId,
    p_lease_seconds: MONITOR_LEASE_SECONDS,
  })
  if (claimError) throw new Error("COMMERCIAL_MONITOR_RUN_CLAIM_FAILED")
  const run = Array.isArray(claimed) ? claimed[0] : claimed
  if (!run?.id) {
    return {
      success: true,
      status: "already_running" as const,
      error: "COMMERCIAL_MONITOR_ALREADY_RUNNING",
      safety: { ebayReadOnly: true, ebayWriteUsed: false, canPublish: false },
    }
  }

  const runId = run.id as string
  const now = input.now ?? new Date()
  const observedAt = now.toISOString()
  const readers: Record<string, ReaderState> = {}
  const errors: RunError[] = []
  try {
    const [listings, thresholds] = await Promise.all([
      loadActiveListings(supabase, accountKey),
      loadThresholds(supabase, accountKey, input.triggerSource !== "dry_run"),
    ])
    const supplies = await loadSupplyRows(supabase, listings)
    const previous = await loadPreviousSnapshots(
      supabase,
      accountKey,
      listings.map((row) => row.ebay_item_id),
    )
    const window = analyticsWindow(now)
    const orderFrom = await latestOrderModifiedAt(supabase, accountKey, now)
    const orderPromise = lanes.includes("orders")
      ? getEbayCompletedCheckoutOrders({ modifiedFrom: orderFrom, modifiedTo: observedAt })
      : Promise.resolve(null)
    const analyticsPromise = lanes.includes("analytics")
      ? getComparableEbayTrafficAnalytics({
          listingIds: listings.map((row) => row.ebay_item_id),
          dateFrom: window.dateFrom,
          dateTo: window.dateTo,
        })
      : Promise.resolve(null)
    const watchersPromise = lanes.includes("watchers")
      ? getEbayListingWatchers({ listingIds: listings.map((row) => row.ebay_item_id) })
      : Promise.resolve(null)
    const {
      orders: orderResult,
      analytics: analyticsResult,
      watchers: watchersResult,
    } = await settleEbayCommercialReaderPromises({
      orders: orderPromise,
      analytics: analyticsPromise,
      watchers: watchersPromise,
    })

    let orders: SafeMarketplaceOrder[] = []
    let analytics: Awaited<ReturnType<typeof getComparableEbayTrafficAnalytics>> | null = null
    let watchers: Awaited<ReturnType<typeof getEbayListingWatchers>> | null = null
    if (orderResult.status === "fulfilled" && orderResult.value) {
      orders = orderResult.value.orders
      readers.orders = {
        status: "available",
        source: orderResult.value.source,
        observedAt: orderResult.value.observedAt,
        metrics: { orders: orders.length, pagesRead: orderResult.value.pagesRead },
        auth: getEbayCommercialReaderAuthState("orders"),
      }
    } else if (lanes.includes("orders")) {
      const code = safeCode(orderResult.status === "rejected" ? orderResult.reason : null, "EBAY_ORDERS_READ_FAILED")
      readers.orders = {
        status: "unavailable",
        source: "EBAY_SELL_FULFILLMENT_GET_ORDERS",
        observedAt,
        error: code,
        auth: getEbayCommercialReaderAuthState("orders", code),
      }
      errors.push({ reader: "orders", code, retryable: true })
    } else readers.orders = { status: "skipped", source: "schedule", observedAt: null }

    if (analyticsResult.status === "fulfilled" && analyticsResult.value) {
      analytics = analyticsResult.value
      readers.analytics = {
        status: analytics.status === "AVAILABLE" ? "available" : "incomplete",
        source: analytics.source,
        observedAt: analytics.observedAt,
        metrics: {
          listings: analytics.observations.length,
          windowStart: analytics.windowStart,
          windowEnd: analytics.windowEnd,
          completenessStatus: analytics.completenessStatus,
        },
        auth: getEbayCommercialReaderAuthState("analytics"),
      }
      if (analytics.status !== "AVAILABLE") {
        errors.push({ reader: "analytics", code: "EBAY_ANALYTICS_WINDOW_INCOMPLETE", retryable: true })
      }
    } else if (lanes.includes("analytics")) {
      const code = safeCode(analyticsResult.status === "rejected" ? analyticsResult.reason : null, "EBAY_ANALYTICS_READ_FAILED")
      readers.analytics = {
        status: "unavailable",
        source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
        observedAt,
        error: code,
        auth: getEbayCommercialReaderAuthState("analytics", code),
      }
      errors.push({ reader: "analytics", code, retryable: true })
    } else readers.analytics = { status: "skipped", source: "schedule", observedAt: null }

    if (watchersResult.status === "fulfilled" && watchersResult.value) {
      watchers = watchersResult.value
      readers.watchers = {
        status: watchers.status === "AVAILABLE" ? "available" : watchers.status === "PARTIAL" ? "partial" : "unavailable",
        source: watchers.source,
        observedAt,
        metrics: { listings: watchers.observations.length, errors: watchers.errors.length },
        auth: getEbayCommercialReaderAuthState("watchers"),
      }
      for (const error of watchers.errors) {
        errors.push({ reader: "watchers", code: error.code, retryable: true })
      }
    } else if (lanes.includes("watchers")) {
      const code = safeCode(watchersResult.status === "rejected" ? watchersResult.reason : null, "EBAY_WATCHERS_READ_FAILED")
      readers.watchers = {
        status: "unavailable",
        source: "EBAY_TRADING_GET_ITEM_WATCHCOUNT",
        observedAt,
        error: code,
        auth: getEbayCommercialReaderAuthState("watchers", code),
      }
      errors.push({ reader: "watchers", code, retryable: true })
    } else readers.watchers = { status: "skipped", source: "schedule", observedAt: null }

    if (input.triggerSource === "dry_run") {
      readers.whatsapp = {
        status: "skipped",
        source: "DRY_RUN_NO_OUTBOX_CLAIM",
        observedAt: null,
      }
      const authentication = {
        ordersOAuth: readers.orders.auth?.status ?? "NOT_RUN",
        watchersAuth: readers.watchers.auth?.status ?? "NOT_RUN",
        analyticsAuth: readers.analytics.auth?.status ?? "NOT_RUN",
        fulfillmentScopeConfirmed: readers.orders.auth?.scopeConfirmed === true,
        officialIdentityMatch: Object.values(readers)
          .some((reader) => reader.auth?.identityMatch === false)
          ? false
          : Object.values(readers).some((reader) => reader.auth?.identityMatch === true)
            ? true
            : null,
        actionRequired: [readers.orders, readers.watchers, readers.analytics]
          .find((reader) => reader.auth?.status && reader.auth.status !== "READY")
          ?.auth?.actionRequired ?? "Sin acción de autenticación; continuar con el dry run read-only.",
      }
      const metrics = {
        dryRun: true,
        activeListings: listings.length,
        officialOrdersRead: orders.length,
        completedCheckoutLineItems: orders.reduce(
          (total, order) => total + order.lineItems.length,
          0,
        ),
        analyticsListingsRead: analytics?.observations.length ?? 0,
        watcherListingsRead: watchers?.observations.length ?? 0,
        commercialDataPersistencePerformed: false,
        alertsEnqueued: 0,
        fulfillmentTasksCreated: 0,
        whatsappDelivered: 0,
        ebayWrites: 0,
        buyerPiiReturned: false,
        authentication,
        thresholdConfigVersion: thresholds.version,
      }
      const status = errors.length ? "partial" as const : "completed" as const
      const nextAction = errors.length
        ? authentication.actionRequired
        : "Dry run correcto; ejecutar una actualización manual controlada para persistir snapshots."
      await finishRun(supabase, runId, workerId, status, readers, metrics, errors, nextAction)
      return {
        success: true,
        status,
        runId,
        startedAt: run.started_at,
        completedAt: new Date().toISOString(),
        readers,
        metrics,
        errors,
        nextAction,
        safety: {
          dryRun: true,
          commercialDataPersistencePerformed: false,
          runAuditPersisted: true,
          alertDeliveryAttempted: false,
          ebayReadOnly: true,
          ebayWriteUsed: false,
          canPublish: false,
          buyerPiiReturned: false,
        },
      }
    }

    const orderWork = lanes.includes("orders") && orders.length
      ? await persistOrdersAndSales({
          supabase, accountKey, orders, listings, supplies, thresholds, observedAt,
        })
      : { newSales: 0, tasksCreated: 0, alertsGenerated: 0, estimatedProfit: 0, errors: [] }
    errors.push(...orderWork.errors)
    const confirmedUnits24h = await confirmedUnitsSoldByListing24h(
      supabase,
      accountKey,
      now,
    )

    const snapshotWork = lanes.some((lane) => ["analytics", "watchers", "rules"].includes(lane))
      ? await persistSnapshotsAndRules({
          supabase,
          accountKey,
          runId,
          listings,
          supplies,
          previous,
          thresholds,
          analytics,
          watchers,
          units24h: confirmedUnits24h,
          observedAt,
        })
      : { snapshots: [], eventsGenerated: 0, alertsGenerated: 0 }

    const daily = lanes.includes("daily_summary")
      ? await generateDailySummary({
          supabase,
          accountKey,
          thresholds,
          snapshots: snapshotWork.snapshots,
          orders,
          estimatedProfit: orderWork.estimatedProfit,
          observedAt,
        })
      : null

    let delivery: Awaited<ReturnType<typeof dispatchCommercialAlertOutbox>> | null = null
    if (lanes.includes("whatsapp") && input.dispatchWhatsApp !== false) {
      delivery = await dispatchCommercialAlertOutbox(supabase, {
        marketplaceAccountKey: accountKey,
        workerId: `commercial-dispatch:${runId}`,
        limit: 1,
        dryRun: input.dryRunWhatsApp !== false,
      })
      readers.whatsapp = {
        status: delivery.mode === "delivery" && delivery.failed > 0 ? "partial" : "available",
        source: "META_WHATSAPP_APPROVED_TEMPLATE",
        observedAt,
        metrics: {
          mode: delivery.mode,
          delivered: delivery.delivered,
          failed: delivery.failed,
        },
      }
    } else readers.whatsapp = { status: "skipped", source: "schedule", observedAt: null }

    const metrics = {
      activeListings: listings.length,
      pilot: {
        listingId: PILOT_LISTING_ID,
        sku: PILOT_SKU,
        activeListingVerified: listings.some((row) =>
          row.ebay_item_id === PILOT_LISTING_ID &&
          (row.ebay_sku === PILOT_SKU || row.supplier_sku === PILOT_SKU)
        ),
      },
      officialOrdersRead: orders.length,
      newSales: orderWork.newSales,
      fulfillmentTasksCreated: orderWork.tasksCreated,
      snapshotsCreated: snapshotWork.snapshots.length,
      commercialEventsCreated: snapshotWork.eventsGenerated + orderWork.newSales,
      alertsGenerated: orderWork.alertsGenerated + snapshotWork.alertsGenerated + (daily?.alertGenerated ? 1 : 0),
      analytics: snapshotWork.snapshots.reduce((totals, row) => ({
        impressions: totals.impressions + (row.impressions ?? 0),
        views: totals.views + (row.views ?? 0),
        transactions: totals.transactions + (row.transactions ?? 0),
        watchers: totals.watchers + (row.currentWatchers ?? 0),
      }), { impressions: 0, views: 0, transactions: 0, watchers: 0 }),
      dailySummary: daily?.summary ?? null,
      whatsapp: delivery ? {
        mode: delivery.mode,
        delivered: delivery.delivered,
        failed: delivery.failed,
      } : null,
      thresholdConfigVersion: thresholds.version,
    }
    const unavailable = Object.values(readers).some((reader) => reader.status === "unavailable")
    const status = unavailable || errors.length ? "partial" as const : "completed" as const
    const nextAction = orderWork.newSales > 0
      ? "Comprar manualmente en Luna las ventas nuevas y continuar fulfillment en Seller OS."
      : errors.length
        ? "Revisar errores del lector y dejar que el scheduler aplique backoff."
        : "Sin acción urgente; esperar la próxima ejecución automática."
    await finishRun(supabase, runId, workerId, status, readers, metrics, errors, nextAction)
    return {
      success: true,
      status,
      runId,
      startedAt: run.started_at,
      completedAt: new Date().toISOString(),
      readers,
      metrics,
      errors,
      nextAction,
      safety: {
        ebayReadOnly: true,
        ebayResourceMethods: ["GET", "Trading API read calls"],
        ebayWriteUsed: false,
        listingMutationUsed: false,
        inventoryMutationUsed: false,
        orderMutationUsed: false,
        canPublish: false,
        buyerPiiStored: false,
      },
    }
  } catch (error) {
    const code = safeCode(error, "COMMERCIAL_MONITOR_FAILED")
    errors.push({ reader: "monitor", code, retryable: true })
    await finishRun(
      supabase,
      runId,
      workerId,
      "failed",
      readers,
      {},
      errors,
      "Revisar el fallo terminal y reintentar desde Seller Command Center.",
    ).catch(() => undefined)
    throw new Error(code)
  }
}

export function getCommercialMonitorScheduleConfiguration() {
  return {
    enabled: process.env.EBAY_COMMERCIAL_MONITOR_ENABLED === "true",
    previewOnly: true,
    currentEnvironment: process.env.VERCEL_ENV ?? "development",
    orderIntervalMinutes: integer(process.env.EBAY_COMMERCIAL_ORDERS_INTERVAL_MINUTES, 5, 5, 1_440),
    analyticsIntervalMinutes: integer(process.env.EBAY_COMMERCIAL_ANALYTICS_INTERVAL_MINUTES, 360, 60, 1_440),
    watchersIntervalMinutes: integer(process.env.EBAY_COMMERCIAL_WATCHERS_INTERVAL_MINUTES, 240, 15, 1_440),
    dailySummaryHourUtc: integer(process.env.EBAY_COMMERCIAL_DAILY_SUMMARY_HOUR_UTC, 14, 0, 23),
    dispatcherIntervalMinutes: integer(process.env.EBAY_COMMERCIAL_DISPATCHER_INTERVAL_MINUTES, 5, 5, 60),
  }
}

function due(last: string | null | undefined, minutes: number, now: Date) {
  return !last || !Number.isFinite(Date.parse(last)) || Date.parse(last) + minutes * 60_000 <= now.getTime()
}

export async function getDueCommercialMonitorLanes(
  supabase: SupabaseClient,
  accountKey: string,
  now = new Date(),
) {
  const schedule = getCommercialMonitorScheduleConfiguration()
  const { data, error } = await supabase
    .from("commercial_monitor_runs")
    .select("started_at,readers")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", MARKETPLACE)
    .in("status", ["completed", "partial"])
    .order("started_at", { ascending: false })
    .limit(100)
  if (error) throw new Error("COMMERCIAL_MONITOR_SCHEDULE_READ_FAILED")
  const lastByReader = new Map<string, string>()
  for (const run of data ?? []) {
    const readers = run.readers && typeof run.readers === "object"
      ? run.readers as Record<string, { status?: string }>
      : {}
    for (const name of ["orders", "analytics", "watchers"]) {
      if (!lastByReader.has(name) && ["available", "partial", "incomplete"].includes(readers[name]?.status ?? "")) {
        lastByReader.set(name, run.started_at)
      }
    }
  }
  const lanes: CommercialMonitorLane[] = []
  if (due(lastByReader.get("orders"), schedule.orderIntervalMinutes, now)) lanes.push("orders", "rules")
  if (due(lastByReader.get("analytics"), schedule.analyticsIntervalMinutes, now)) lanes.push("analytics", "rules")
  if (due(lastByReader.get("watchers"), schedule.watchersIntervalMinutes, now)) lanes.push("watchers", "rules")
  const { data: todaySummary } = await supabase
    .from("commercial_daily_summaries")
    .select("id")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", MARKETPLACE)
    .eq("summary_day", isoDay(now))
    .maybeSingle()
  if (!todaySummary && now.getUTCHours() >= schedule.dailySummaryHourUtc) {
    lanes.push("orders", "analytics", "watchers", "rules", "daily_summary")
  }
  lanes.push("whatsapp")
  return [...new Set(lanes)]
}

function nextRunAt(lastRun: string | null, minutes: number, now = new Date()) {
  if (!lastRun) return now.toISOString()
  const next = Date.parse(lastRun) + minutes * 60_000
  return new Date(Math.max(now.getTime(), Number.isFinite(next) ? next : now.getTime())).toISOString()
}

export async function getEbayCommercialMonitorDashboard(
  supabase: SupabaseClient,
) {
  const accountScope = getEbaySellerAccountScopeConfiguration()
  const accountKey = accountScope.accountKey
  const schedule = getCommercialMonitorScheduleConfiguration()
  if (!accountKey) return {
    status: "not_configured",
    accountScope: { configured: false, reason: accountScope.reason },
    readersConfiguration: getEbayCommercialReadersConfiguration(),
    schedule,
    latestRun: null,
    health: null,
  }
  const [latestRun, latestCompleted, taskRows, outboxRows] = await Promise.all([
    supabase.from("commercial_monitor_runs").select("*")
      .eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
      .order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("commercial_monitor_runs").select("started_at,readers")
      .eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
      .in("status", ["completed", "partial"]).order("started_at", { ascending: false }).limit(50),
    supabase.from("fulfillment_tasks").select("id,status,listing_id,sku,product_title,quantity,ship_by_at,estimated_profit,stock_available,created_at")
      .eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
      .order("created_at", { ascending: false }).limit(20),
    supabase.from("alert_delivery_outbox").select("id,status,severity,attempts,last_error_code,due_at,created_at")
      .eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
      .order("created_at", { ascending: false }).limit(100),
  ])
  const firstError = latestRun.error ?? latestCompleted.error ?? taskRows.error ?? outboxRows.error
  if (firstError) throw new Error("COMMERCIAL_MONITOR_DASHBOARD_READ_FAILED")
  const readerLast = new Map<string, string>()
  for (const run of latestCompleted.data ?? []) {
    const readers = run.readers && typeof run.readers === "object"
      ? run.readers as Record<string, { status?: string }>
      : {}
    for (const name of ["orders", "analytics", "watchers"]) {
      if (!readerLast.has(name) && ["available", "partial", "incomplete"].includes(readers[name]?.status ?? "")) {
        readerLast.set(name, run.started_at)
      }
    }
  }
  const outbox = outboxRows.data ?? []
  const tasks = taskRows.data ?? []
  return {
    status: latestRun.data?.status ?? "never_run",
    accountScope: { configured: true, accountAlias: accountScope.accountAlias },
    readersConfiguration: getEbayCommercialReadersConfiguration(),
    schedule,
    latestRun: latestRun.data ?? null,
    health: {
      fulfillmentTasks: tasks.length,
      pendingManualPurchase: tasks.filter((task) => task.status === "PENDING_MANUAL_PURCHASE").length,
      awaitingTracking: tasks.filter((task) => task.status === "PURCHASED_AWAITING_TRACKING").length,
      alertsPending: outbox.filter((row) => row.status === "pending").length,
      alertsFailed: outbox.filter((row) => row.status === "failed").length,
      alertsDeadLetter: outbox.filter((row) => row.status === "dead_letter").length,
      retries: outbox.reduce((sum, row) => sum + Number(row.attempts ?? 0), 0),
    },
    fulfillmentTasks: tasks,
    nextAutomaticRunAt: [
      nextRunAt(readerLast.get("orders") ?? null, schedule.orderIntervalMinutes),
      nextRunAt(readerLast.get("analytics") ?? null, schedule.analyticsIntervalMinutes),
      nextRunAt(readerLast.get("watchers") ?? null, schedule.watchersIntervalMinutes),
    ].sort()[0],
    safety: {
      ebayReadOnly: true,
      productionAutomaticMonitorEnabled: false,
      radarOwnsCommercialMonitoring: false,
      buyerPiiReturned: false,
      canPublish: false,
    },
  }
}
