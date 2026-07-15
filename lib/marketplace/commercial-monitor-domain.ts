import { createHash } from "node:crypto"

export const COMMERCIAL_MONITOR_VERSION = "MARKETPLACE_COMMERCIAL_MONITOR_V1"

export type CommercialSeverity = "critical" | "high" | "medium" | "low"

export type CommercialThresholds = {
  version: string
  trafficMinimumImpressions: number
  lowCtrPercent: number
  conversionMinimumViews: number
  acceleratedUnits24h: number
  lowStockMinimum: number
  lowStockMaximum: number
  marginRiskPercent: number
  marginCriticalPercent: number
}

export const DEFAULT_COMMERCIAL_THRESHOLDS: CommercialThresholds = {
  version: "COMMERCIAL_THRESHOLDS_V1",
  trafficMinimumImpressions: 100,
  lowCtrPercent: 1.5,
  conversionMinimumViews: 30,
  acceleratedUnits24h: 2,
  lowStockMinimum: 1,
  lowStockMaximum: 3,
  marginRiskPercent: 20,
  marginCriticalPercent: 10,
}

export type CommercialSnapshot = {
  marketplaceAccountKey: string
  listingId: string
  sku: string | null
  listingStatus: string
  impressions: number | null
  views: number | null
  ctr: number | null
  transactions: number | null
  salesConversionRate: number | null
  revenue: number | null
  currentWatchers: number | null
  stockAvailable: number | null
  supplierCost: number | null
  estimatedMarginPercent: number | null
  observedAt: string
  windowStart: string | null
  windowEnd: string | null
  completenessStatus: "complete" | "incomplete" | "unavailable"
}

export type CommercialEvent = {
  eventType: string
  severity: CommercialSeverity
  evidence: Record<string, unknown>
  thresholdConfigVersion: string
  detectedAt: string
  listingId: string
  sku: string | null
  deduplicationKey: string
  recommendedAction: string
}

export type SafeMarketplaceOrderLine = {
  ebayOrderId: string
  lineItemId: string
  listingId: string
  sku: string | null
  title: string
  quantity: number
  lineItemAmount: number | null
  currency: string | null
  shipByDate: string | null
}

export type SafeMarketplaceOrder = {
  ebayOrderId: string
  creationDate: string
  lastModifiedDate: string
  orderPaymentStatus: string
  orderFulfillmentStatus: string
  totalAmount: number | null
  currency: string | null
  marketplaceId: string
  lineItems: SafeMarketplaceOrderLine[]
}

const PII_KEYS = new Set([
  "buyer", "buyercheckoutnotes", "buyerusername", "email", "phone",
  "phonenumber", "address", "addressline1", "addressline2", "city",
  "county", "postalcode", "stateorprovince", "recipient", "shipto",
  "shippingaddress", "contactaddress", "fullName", "fullname",
])

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function text(value: unknown, maximum = 300) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum)
    : ""
}

function numeric(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function amount(value: unknown) {
  const source = record(value)
  return numeric(source.value ?? value)
}

function isoDate(value: unknown) {
  const candidate = text(value, 40)
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null
}

export function normalizeCompletedEbayOrders(payload: unknown): SafeMarketplaceOrder[] {
  return array(record(payload).orders).flatMap((value) => {
    const order = record(value)
    const ebayOrderId = text(order.orderId, 100)
    const creationDate = isoDate(order.creationDate)
    const lastModifiedDate = isoDate(order.lastModifiedDate)
    const orderPaymentStatus = text(order.orderPaymentStatus, 40).toUpperCase()
    const orderFulfillmentStatus = text(order.orderFulfillmentStatus, 40).toUpperCase()
    if (!ebayOrderId || !creationDate || !lastModifiedDate || orderPaymentStatus !== "PAID") {
      return []
    }
    const pricing = record(order.pricingSummary)
    const total = record(pricing.total)
    const lineItems = array(order.lineItems).flatMap((lineValue) => {
      const line = record(lineValue)
      const lineItemId = text(line.lineItemId, 100)
      const listingId = text(line.legacyItemId, 20)
      const quantity = Math.max(0, Math.trunc(numeric(line.quantity) ?? 0))
      if (!lineItemId || !/^\d{9,20}$/.test(listingId) || quantity < 1) return []
      const cost = record(line.lineItemCost)
      const delivery = record(line.lineItemFulfillmentInstructions)
      return [{
        ebayOrderId,
        lineItemId,
        listingId,
        sku: text(line.sku, 100) || null,
        title: text(line.title, 300) || `eBay listing ${listingId}`,
        quantity,
        lineItemAmount: amount(cost),
        currency: text(cost.currency, 10) || null,
        shipByDate: isoDate(delivery.shipByDate),
      }]
    })
    if (!lineItems.length) return []
    return [{
      ebayOrderId,
      creationDate,
      lastModifiedDate,
      orderPaymentStatus,
      orderFulfillmentStatus,
      totalAmount: amount(total),
      currency: text(total.currency, 10) || null,
      marketplaceId: text(order.salesRecordReference ? "EBAY_US" : order.marketplaceId, 30) || "EBAY_US",
      lineItems,
    }]
  })
}

export function containsPrivateBuyerData(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPrivateBuyerData)
  if (!value || typeof value !== "object") return false
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) =>
    PII_KEYS.has(key.toLowerCase()) || containsPrivateBuyerData(nested)
  )
}

export function marketplaceLineItemKey(
  marketplaceAccountKey: string,
  ebayOrderId: string,
  lineItemId: string,
) {
  return [marketplaceAccountKey, ebayOrderId, lineItemId].join(":")
}

export function stableCommercialKey(...parts: Array<string | number | null | undefined>) {
  const digest = createHash("sha256").update(JSON.stringify(parts)).digest("hex")
  return `commercial-v1:${digest}`
}

export function extractPackQuantity(title: string) {
  const normalized = text(title, 300)
  const match = normalized.match(/(?:^|\b)(\d{1,3})\s*(?:[- ]?pack|pk|packages?)(?:\b|$)/i)
    ?? normalized.match(/(?:^|\b)pack\s*(?:of\s*)?(\d{1,3})(?:\b|$)/i)
  const value = Number(match?.[1])
  return Number.isSafeInteger(value) && value > 0 && value <= 100 ? value : 1
}

export type WatcherSignal = {
  kind: "first" | "milestone" | "increase"
  threshold: number
  current: number
  previous: number
}

export function detectWatcherSignals(
  previousValue: number | null | undefined,
  currentValue: number | null | undefined,
): WatcherSignal[] {
  if (!Number.isFinite(currentValue) || Number(currentValue) < 0) return []
  const current = Math.trunc(Number(currentValue))
  const previous = Number.isFinite(previousValue)
    ? Math.max(0, Math.trunc(Number(previousValue)))
    : 0
  const signals: WatcherSignal[] = []
  if (previous === 0 && current >= 1) {
    signals.push({ kind: "first", threshold: 1, current, previous })
  }
  for (const threshold of [3, 5, 10]) {
    if (previous < threshold && current >= threshold) {
      signals.push({ kind: "milestone", threshold, current, previous })
    }
  }
  if (current - previous >= 3) {
    signals.push({ kind: "increase", threshold: 3, current, previous })
  }
  return signals
}

function dayBucket(value: string) {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().slice(0, 10) : "unknown"
}

function baseEvent(
  snapshot: CommercialSnapshot,
  thresholds: CommercialThresholds,
  eventType: string,
  severity: CommercialSeverity,
  evidence: Record<string, unknown>,
  recommendedAction: string,
  dedupeBucket: string,
): CommercialEvent {
  return {
    eventType,
    severity,
    evidence,
    thresholdConfigVersion: thresholds.version,
    detectedAt: snapshot.observedAt,
    listingId: snapshot.listingId,
    sku: snapshot.sku,
    deduplicationKey: stableCommercialKey(
      snapshot.marketplaceAccountKey,
      eventType,
      snapshot.listingId,
      snapshot.sku,
      thresholds.version,
      dedupeBucket,
    ),
    recommendedAction,
  }
}

export function evaluateCommercialRules(input: {
  current: CommercialSnapshot
  previous?: CommercialSnapshot | null
  unitsSold24h?: number
  thresholds?: CommercialThresholds
}) {
  const thresholds = input.thresholds ?? DEFAULT_COMMERCIAL_THRESHOLDS
  const snapshot = input.current
  const events: CommercialEvent[] = []
  const complete = snapshot.completenessStatus === "complete"
  const bucket = dayBucket(snapshot.windowEnd ?? snapshot.observedAt)

  if (
    complete &&
    (snapshot.impressions ?? -1) >= thresholds.trafficMinimumImpressions &&
    snapshot.ctr !== null && snapshot.ctr < thresholds.lowCtrPercent &&
    snapshot.transactions === 0
  ) {
    events.push(baseEvent(snapshot, thresholds, "GOOD_TRAFFIC_LOW_CTR", "medium", {
      impressions: snapshot.impressions,
      ctr: snapshot.ctr,
      transactions: snapshot.transactions,
      minimumImpressions: thresholds.trafficMinimumImpressions,
      maximumCtrPercent: thresholds.lowCtrPercent,
      officialAnalyticsWindowComplete: true,
    }, "Revisar imagen principal, título y precio; no cambiar el listing sin aprobación humana.", bucket))
  }

  if (
    complete &&
    (snapshot.views ?? -1) >= thresholds.conversionMinimumViews &&
    snapshot.ctr !== null && snapshot.ctr >= thresholds.lowCtrPercent &&
    snapshot.transactions === 0
  ) {
    events.push(baseEvent(snapshot, thresholds, "GOOD_CTR_LOW_CONVERSION", "medium", {
      views: snapshot.views,
      ctr: snapshot.ctr,
      transactions: snapshot.transactions,
      minimumViews: thresholds.conversionMinimumViews,
      officialAnalyticsWindowComplete: true,
    }, "Revisar oferta, descripción, envío y confianza del listing antes de proponer cambios.", bucket))
  }

  const unitsSold24h = Math.max(0, Math.trunc(input.unitsSold24h ?? 0))
  if (unitsSold24h >= thresholds.acceleratedUnits24h) {
    events.push(baseEvent(snapshot, thresholds, "ACCELERATED_SALES", "high", {
      confirmedUnits24h: unitsSold24h,
      threshold: thresholds.acceleratedUnits24h,
      source: "OFFICIAL_COMPLETED_CHECKOUT_ORDERS",
    }, "Priorizar compra manual en Luna y confirmar stock para las órdenes abiertas.", bucket))
  }

  const active = snapshot.listingStatus === "active"
  if (active && snapshot.stockAvailable !== null && snapshot.stockAvailable >= thresholds.lowStockMinimum && snapshot.stockAvailable <= thresholds.lowStockMaximum) {
    events.push(baseEvent(snapshot, thresholds, "LOW_STOCK", "high", {
      stockAvailable: snapshot.stockAvailable,
      minimum: thresholds.lowStockMinimum,
      maximum: thresholds.lowStockMaximum,
    }, "Confirmar reposición o revisar manualmente la cantidad disponible en eBay.", "active-condition"))
  }
  if (active && snapshot.stockAvailable === 0) {
    events.push(baseEvent(snapshot, thresholds, "ACTIVE_LISTING_OUT_OF_STOCK", "critical", {
      stockAvailable: 0,
      listingStatus: snapshot.listingStatus,
    }, "Revisar el listing inmediatamente; cualquier ajuste en eBay requiere acción humana.", "active-condition"))
  }
  if (active && snapshot.estimatedMarginPercent !== null && snapshot.estimatedMarginPercent < thresholds.marginRiskPercent) {
    const critical = snapshot.estimatedMarginPercent < thresholds.marginCriticalPercent
    events.push(baseEvent(snapshot, thresholds, "MARGIN_RISK", critical ? "critical" : "high", {
      estimatedMarginPercent: snapshot.estimatedMarginPercent,
      riskBelowPercent: thresholds.marginRiskPercent,
      criticalBelowPercent: thresholds.marginCriticalPercent,
    }, "Recalcular costo y precio; no modificar eBay sin revisión humana.", critical ? "critical-condition" : "risk-condition"))
  }

  for (const signal of detectWatcherSignals(
    input.previous?.currentWatchers,
    snapshot.currentWatchers,
  )) {
    const eventType = signal.kind === "increase" ? "WATCHER_INCREASE" : "WATCHER_MILESTONE"
    events.push(baseEvent(snapshot, thresholds, eventType, "low", {
      signalType: signal.kind,
      currentWatchers: signal.current,
      previousWatchers: signal.previous,
      deltaWatchers: signal.current - signal.previous,
      threshold: signal.threshold,
      classification: "INTEREST_SIGNAL_NOT_SALE",
    }, "Observar la señal de interés y esperar evidencia de venta confirmada antes de actuar.", `${signal.kind}:${signal.threshold}`))
  }
  return events
}

export type DailyCommercialSummary = {
  activeListings: number
  impressions: number
  views: number
  ctr: number | null
  watchers: number
  sales: number
  conversion: number | null
  revenue: number
  estimatedProfit: number
  pendingPurchaseOrders: number
  awaitingTrackingOrders: number
  lowStockProducts: number
  complete: boolean
  comparableToPreviousDay: boolean
}

export function buildDailyCommercialSummary(input: {
  snapshots: CommercialSnapshot[]
  confirmedSales: number
  revenue: number
  estimatedProfit: number
  pendingPurchaseOrders: number
  awaitingTrackingOrders: number
  previousDayComplete?: boolean
}): DailyCommercialSummary {
  const complete = input.snapshots.length > 0 && input.snapshots.every((row) => row.completenessStatus === "complete")
  const impressions = input.snapshots.reduce((sum, row) => sum + (row.impressions ?? 0), 0)
  const views = input.snapshots.reduce((sum, row) => sum + (row.views ?? 0), 0)
  return {
    activeListings: input.snapshots.filter((row) => row.listingStatus === "active").length,
    impressions,
    views,
    ctr: impressions > 0 ? Number(((views / impressions) * 100).toFixed(2)) : null,
    watchers: input.snapshots.reduce((sum, row) => sum + (row.currentWatchers ?? 0), 0),
    sales: Math.max(0, Math.trunc(input.confirmedSales)),
    conversion: views > 0 ? Number(((input.confirmedSales / views) * 100).toFixed(2)) : null,
    revenue: Number(input.revenue.toFixed(2)),
    estimatedProfit: Number(input.estimatedProfit.toFixed(2)),
    pendingPurchaseOrders: Math.max(0, Math.trunc(input.pendingPurchaseOrders)),
    awaitingTrackingOrders: Math.max(0, Math.trunc(input.awaitingTrackingOrders)),
    lowStockProducts: input.snapshots.filter((row) => row.stockAvailable !== null && row.stockAvailable >= 1 && row.stockAvailable <= 3).length,
    complete,
    comparableToPreviousDay: complete && input.previousDayComplete === true,
  }
}

export function renderDailyCommercialSummary(summary: DailyCommercialSummary) {
  const value = (number: number | null, suffix = "") => number === null ? "—" : `${number}${suffix}`
  return [
    "📊 RESUMEN DIARIO EBAY",
    "",
    `Listings activos: ${summary.activeListings}`,
    `Impresiones: ${summary.impressions}`,
    `Vistas: ${summary.views}`,
    `CTR: ${value(summary.ctr, "%")}`,
    `Watchers (señales de interés): ${summary.watchers}`,
    `Ventas confirmadas: ${summary.sales}`,
    `Conversión: ${value(summary.conversion, "%")}`,
    `Ingresos: $${summary.revenue.toFixed(2)}`,
    `Beneficio estimado: $${summary.estimatedProfit.toFixed(2)}`,
    `Órdenes pendientes de compra: ${summary.pendingPurchaseOrders}`,
    `Órdenes esperando tracking: ${summary.awaitingTrackingOrders}`,
    `Productos con stock bajo: ${summary.lowStockProducts}`,
  ].join("\n")
}

export function renderSaleDetectedMessage(input: {
  product: string
  sku: string
  quantity: number
  amount: number | null
  currency: string
  shipByDate: string | null
  estimatedLunaCost: number | null
  estimatedProfit: number | null
  stockAvailable: number | null
  sellerOrderUrl: string | null
  lunaProductUrl: string | null
}) {
  const money = (value: number | null) => value === null ? "Pendiente" : `${input.currency} ${value.toFixed(2)}`
  return [
    "🛒 NUEVA VENTA EBAY",
    "",
    `Producto: ${text(input.product, 300)}`,
    `SKU: ${text(input.sku, 100)}`,
    `Cantidad: ${Math.max(1, Math.trunc(input.quantity))}`,
    `Importe: ${money(input.amount)}`,
    `Enviar antes de: ${input.shipByDate ?? "Pendiente"}`,
    `Costo Luna estimado: ${money(input.estimatedLunaCost)}`,
    `Beneficio estimado: ${money(input.estimatedProfit)}`,
    `Stock disponible: ${input.stockAvailable ?? "Pendiente"}`,
    "",
    "ACCIÓN REQUERIDA:",
    "Comprar manualmente en Luna Portex.",
    "",
    input.sellerOrderUrl ? `[ABRIR ORDEN EN SELLER OS] ${input.sellerOrderUrl}` : "[ABRIR ORDEN EN SELLER OS]",
    input.lunaProductUrl ? `[ABRIR PRODUCTO EN LUNA] ${input.lunaProductUrl}` : "[ABRIR PRODUCTO EN LUNA]",
  ].join("\n")
}
