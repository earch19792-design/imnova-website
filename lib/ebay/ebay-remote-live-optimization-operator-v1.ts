import type { SupabaseClient } from "@supabase/supabase-js"

import {
  isProvenSupplierLinkageV1,
  type CommercialListingDecisionV1,
  type CommercialListingReadModel,
  type CommercialMonitorGetDto,
  type EbayListingQualityRecommendation,
} from "./commercial-monitor-readonly-contract"
import type { SellerOsHeroVisualReviewV1 } from
  "./ebay-seller-os-visual-quality-v1"
import { currentLiveListingsForMonitorV1 } from
  "./ebay-seller-os-live-portfolio-integrity-v1"

export const REMOTE_LIVE_OPTIMIZATION_OPERATOR_VERSION =
  "REMOTE_LIVE_OPTIMIZATION_OPERATOR_V1_2026_09_01" as const

export type RemoteLiveAttentionClass = "NEEDS_ATTENTION" | "CAN_IMPROVE" |
  "ENRICH" | "WAIT"

type JsonRecord = Record<string, unknown>

export function remoteLiveOptimizationTasksV1(value: unknown) {
  const dashboard = record(value)
  const competitorWatch = record(dashboard.competitorWatch)
  return [
    ...(Array.isArray(dashboard.optimizationTasks)
      ? dashboard.optimizationTasks : []),
    ...(Array.isArray(competitorWatch.priceRecommendations)
      ? competitorWatch.priceRecommendations : []),
    ...(Array.isArray(dashboard.supplyActions)
      ? dashboard.supplyActions : []),
  ].map(record)
}

export type RemoteLiveOperatorSalesResultsV1 = Readonly<{
  source: "PERSISTED_OFFICIAL_EBAY_ORDERS"
  sourceStatus: "AVAILABLE" | "UNAVAILABLE"
  observedAt: string
  timeZone: "UTC"
  salesToday: number | null
  salesLast7Days: number | null
  revenueToday: number | null
  revenueLast7Days: number | null
  currency: string | null
  listingsWithSales: number | null
  series: readonly Readonly<{
    day: string
    sales: number
    revenue: number | null
  }>[]
  limitationCodes: readonly string[]
  analyticsQuantitySoldUsed: false
  buyerPiiIncluded: false
}>

export type RemoteLiveOperatorActionStatus = "AVAILABLE" |
  "AWAITING_CONFIRMATION" | "SUCCEEDED" | "VERIFYING" | "OWNER_REQUIRED" |
  "READ_ONLY" | "UNAVAILABLE"

export type RemoteLiveOperatorListingV1 = Readonly<{
  ebayItemId: string
  title: string
  sku: string | null
  imageUrl: string | null
  attentionClass: RemoteLiveAttentionClass
  humanSummary: string
  whyNow: string
  recommendation: string
  whatOperatorShouldDo: string
  expectedBenefit: string
  helper: string
  metrics: Readonly<{
    impressions: number | null
    views: number | null
    ctrPercent: number | null
    orders: number | null
    unitsSold: number | null
  }>
  evidence: Readonly<{
    exactListingIdentity: boolean
    productTruthSupported: boolean
    currentLiveReadback: boolean
    listingQualitySourceAvailable: boolean
    analyticsEvidenceAvailable: boolean
  }>
  ebayGuidance: readonly Readonly<{
    category: string
    recommendation: string
    source: "EBAY_LISTING_QUALITY_REPORT"
    exactListingAssociation: boolean
  }>[]
  visualReview: Readonly<{
    status: "AVAILABLE" | "PARTIAL" | "UNPROVEN"
    imageUrl: string | null
    findings: readonly Readonly<{
      observation: string
      whyItMatters: string
      whatToReview: string
    }>[]
  }>
  action: Readonly<{
    kind: "SAFE_PRICE_CHANGE" | "OWNER_ESCALATION" |
      "REVIEW_GUIDANCE" | "REVIEW_VISUAL" | "NO_ACTION"
    status: RemoteLiveOperatorActionStatus
    eventId: string | null
    label: string
    ownerApprovalRequired: boolean
    ownerReason: string | null
    postActionReadbackRequired: true
    unknownResultAutoRetry: false
  }>
}>

type RemoteLiveVisualBundle = Readonly<{
  status: "AVAILABLE" | "PARTIAL" | "UNPROVEN"
  listings: readonly SellerOsHeroVisualReviewV1[]
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum)
    : null
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function metricValue(listing: CommercialListingReadModel, key: string) {
  const metric = record((listing.metrics as JsonRecord)[key])
  const availability = String(metric.availability ?? metric.status ?? "")
  return ["AVAILABLE", "COMPLETE"].includes(availability)
    ? number(metric.value) : null
}

function utcDay(value: Date) {
  return value.toISOString().slice(0, 10)
}

function addUtcDays(value: Date, days: number) {
  const copy = new Date(value)
  copy.setUTCDate(copy.getUTCDate() + days)
  return copy
}

export async function readRemoteLiveOperatorSalesResultsV1(input: {
  supabase: SupabaseClient
  accountKey: string
  now?: Date
}): Promise<RemoteLiveOperatorSalesResultsV1> {
  const now = input.now ?? new Date()
  const today = utcDay(now)
  const start30 = utcDay(addUtcDays(now, -29))
  const start7 = utcDay(addUtcDays(now, -6))
  const observedAt = now.toISOString()
  const { data: orders, error: orderError } = await input.supabase
    .from("marketplace_order_snapshots")
    .select("marketplace_order_id,order_created_at,payment_status,total_amount,currency")
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("payment_status", "PAID")
    .gte("order_created_at", `${start30}T00:00:00.000Z`)
    .order("order_created_at", { ascending: true })
    .limit(500)
  if (orderError) return Object.freeze({
    source: "PERSISTED_OFFICIAL_EBAY_ORDERS",
    sourceStatus: "UNAVAILABLE",
    observedAt,
    timeZone: "UTC",
    salesToday: null,
    salesLast7Days: null,
    revenueToday: null,
    revenueLast7Days: null,
    currency: null,
    listingsWithSales: null,
    series: Object.freeze([]),
    limitationCodes: Object.freeze(["OFFICIAL_ORDER_HISTORY_READ_FAILED"]),
    analyticsQuantitySoldUsed: false,
    buyerPiiIncluded: false,
  })
  const safeOrders = (orders ?? []).map(record)
  const orderIds = safeOrders.flatMap((order) => {
    const orderId = text(order.marketplace_order_id, 200)
    return orderId ? [orderId] : []
  })
  const { data: lines, error: lineError } = orderIds.length
    ? await input.supabase.from("marketplace_order_line_items")
      .select("marketplace_order_id,listing_id")
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", "EBAY_US")
      .in("marketplace_order_id", orderIds)
      .limit(1_000)
    : { data: [], error: null }
  if (lineError) return Object.freeze({
    source: "PERSISTED_OFFICIAL_EBAY_ORDERS",
    sourceStatus: "UNAVAILABLE",
    observedAt,
    timeZone: "UTC",
    salesToday: null,
    salesLast7Days: null,
    revenueToday: null,
    revenueLast7Days: null,
    currency: null,
    listingsWithSales: null,
    series: Object.freeze([]),
    limitationCodes: Object.freeze(["OFFICIAL_ORDER_LINE_HISTORY_READ_FAILED"]),
    analyticsQuantitySoldUsed: false,
    buyerPiiIncluded: false,
  })
  const currencies = new Set(safeOrders.flatMap((order) => {
    const currency = text(order.currency, 12)
    return currency ? [currency.toUpperCase()] : []
  }))
  const currency = currencies.size === 1 ? [...currencies][0] : null
  const amountsComplete = safeOrders.every((order) =>
    number(order.total_amount) !== null)
  const byDay = new Map<string, JsonRecord[]>()
  for (const order of safeOrders) {
    const createdAt = text(order.order_created_at, 80)
    const day = createdAt && Number.isFinite(Date.parse(createdAt))
      ? new Date(createdAt).toISOString().slice(0, 10) : null
    if (!day) continue
    byDay.set(day, [...(byDay.get(day) ?? []), order])
  }
  const series = Object.freeze(Array.from({ length: 30 }, (_, index) => {
    const day = utcDay(addUtcDays(now, index - 29))
    const rows = byDay.get(day) ?? []
    return Object.freeze({ day, sales: rows.length,
      revenue: amountsComplete && currency
        ? Number(rows.reduce((total, row) =>
          total + (number(row.total_amount) ?? 0), 0).toFixed(2)) : null })
  }))
  const todayRows = byDay.get(today) ?? []
  const last7Rows = safeOrders.filter((order) => {
    const createdAt = text(order.order_created_at, 80)
    return Boolean(createdAt && createdAt.slice(0, 10) >= start7)
  })
  const listingIds = new Set((lines ?? []).flatMap((line) => {
    const listingId = text(record(line).listing_id, 30)
    return listingId ? [listingId] : []
  }))
  return Object.freeze({
    source: "PERSISTED_OFFICIAL_EBAY_ORDERS",
    sourceStatus: "AVAILABLE",
    observedAt,
    timeZone: "UTC",
    salesToday: todayRows.length,
    salesLast7Days: last7Rows.length,
    revenueToday: amountsComplete && currency
      ? Number(todayRows.reduce((total, row) =>
        total + (number(row.total_amount) ?? 0), 0).toFixed(2)) : null,
    revenueLast7Days: amountsComplete && currency
      ? Number(last7Rows.reduce((total, row) =>
        total + (number(row.total_amount) ?? 0), 0).toFixed(2)) : null,
    currency,
    listingsWithSales: listingIds.size,
    series,
    limitationCodes: Object.freeze([
      ...(!amountsComplete ? ["ORDER_TOTAL_INCOMPLETE"] : []),
      ...(currencies.size > 1 ? ["MULTIPLE_ORDER_CURRENCIES"] : []),
      ...(safeOrders.length === 500 ? ["ORDER_HISTORY_BOUND_REACHED"] : []),
    ]),
    analyticsQuantitySoldUsed: false,
    buyerPiiIncluded: false,
  })
}

function actionFromTask(input: {
  task: JsonRecord | null
  execution: JsonRecord | null
}) {
  const eventId = text(input.task?.id, 40)
  const eventType = text(input.task?.eventType, 100) ?? ""
  const phase = text(input.execution?.phase, 80)
  if (phase === "applied_verified") return {
    kind: "SAFE_PRICE_CHANGE" as const,
    status: "SUCCEEDED" as const,
    eventId,
    label: "Cambio verificado en eBay",
    ownerApprovalRequired: false,
    ownerReason: null,
  }
  if (phase === "outcome_unknown") return {
    kind: "SAFE_PRICE_CHANGE" as const,
    status: "VERIFYING" as const,
    eventId,
    label: "Estamos verificando el cambio. No vuelvas a pulsar.",
    ownerApprovalRequired: false,
    ownerReason: null,
  }
  if (["preview_ready", "write_in_flight", "write_acknowledged"]
      .includes(phase ?? "")) return {
    kind: "SAFE_PRICE_CHANGE" as const,
    status: "AWAITING_CONFIRMATION" as const,
    eventId,
    label: "Revisar cambio seguro",
    ownerApprovalRequired: false,
    ownerReason: null,
  }
  if (!eventId) return null
  if (["COMPETITOR_CONFIRMED_SOLD_PRICE_RECOMMENDATION",
    "COMPETITOR_ACTIVE_MARKET_PRICE_RECOMMENDATION", "LUNA_COST_CHANGED",
    "MARGIN_RISK"].includes(eventType)) return {
    kind: "SAFE_PRICE_CHANGE" as const,
    status: "AVAILABLE" as const,
    eventId,
    label: "Revisar precio recomendado",
    ownerApprovalRequired: false,
    ownerReason: null,
  }
  if (eventType === "LISTING_ZERO_VISIBILITY_REVIEW") return {
    kind: "OWNER_ESCALATION" as const,
    status: "OWNER_REQUIRED" as const,
    eventId,
    label: "Pedir aprobación al owner",
    ownerApprovalRequired: true,
    ownerReason: "Esta promoción aumenta el gasto y necesita aprobación del owner.",
  }
  if (eventType === "ACTIVE_LISTING_OUT_OF_STOCK") return {
    kind: "OWNER_ESCALATION" as const,
    status: "OWNER_REQUIRED" as const,
    eventId,
    label: "Necesita decisión del owner",
    ownerApprovalRequired: true,
    ownerReason: "Retirar o terminar un listing es una decisión exclusiva del owner.",
  }
  return null
}

function actionPriority(input: {
  task: JsonRecord
  execution: JsonRecord | null
  action: NonNullable<ReturnType<typeof actionFromTask>>
}) {
  const eventType = text(input.task.eventType, 100)
  const phase = text(input.execution?.phase, 80)
  if (phase === "outcome_unknown") return 0
  if (eventType === "ACTIVE_LISTING_OUT_OF_STOCK") return 1
  if (input.action.kind === "OWNER_ESCALATION") return 2
  if (input.action.status === "AWAITING_CONFIRMATION") return 3
  if (input.action.status === "AVAILABLE") return 4
  return 5
}

function dominantNarrative(input: {
  listing: CommercialListingReadModel
  decision: CommercialListingDecisionV1 | null
  quality: readonly EbayListingQualityRecommendation[]
  visual: SellerOsHeroVisualReviewV1 | null
  taskAction: ReturnType<typeof actionFromTask>
}) {
  const reasons = new Set(input.decision?.reasonCodes ?? [])
  const visualFinding = input.visual?.findings[0]
  if (input.listing.stock.state === "OUT_OF_STOCK_SIGNAL") return {
    attentionClass: "NEEDS_ATTENTION" as const,
    humanSummary: "El proveedor muestra este producto sin stock.",
    whyNow: "Seguir vendiéndolo puede crear una venta que no se pueda cumplir.",
    recommendation: "Seller OS recomienda que el owner revise si debe retirar el listing.",
    whatOperatorShouldDo: "Abre la evidencia y envía la decisión al owner.",
    expectedBenefit: "Evitar una venta sin inventario confirmado.",
    helper: "Stock confirmado por la identidad exacta del producto proveedor.",
  }
  if (input.quality.length > 0) return {
    attentionClass: "NEEDS_ATTENTION" as const,
    humanSummary: "eBay recomienda completar o mejorar información de este listing.",
    whyNow: "Una ficha más completa ayuda al comprador a entender el producto y evita omitir datos requeridos.",
    recommendation: `Revisar ${input.quality[0].recommendationCategory || "la información sugerida por eBay"}.`,
    whatOperatorShouldDo: "Confirma sólo datos respaldados por el producto exacto; si falta evidencia, no los inventes.",
    expectedBenefit: "Mejorar la completitud del listing sin alterar Product Truth.",
    helper: "Una recomendación de eBay no prueba por sí sola el valor que debe escribirse.",
  }
  if (reasons.has("LOW_CTR_WITH_SUFFICIENT_IMPRESSIONS")) return {
    attentionClass: "CAN_IMPROVE" as const,
    humanSummary: "Muchas personas ven este producto en eBay, pero pocas entran al listing.",
    whyNow: "Seller OS ya tiene suficiente tráfico para revisar la foto principal y el título.",
    recommendation: "Revisar primero la imagen principal y después el título.",
    whatOperatorShouldDo: "Compara la evidencia actual con la propuesta y aprueba sólo si representa el producto exacto.",
    expectedBenefit: "Aumentar las visitas al listing; no se promete una venta.",
    helper: "CTR es la proporción de veces que una impresión termina en una visita.",
  }
  if (reasons.has("TRAFFIC_WITHOUT_CONVERSION")) return {
    attentionClass: "CAN_IMPROVE" as const,
    humanSummary: "Las personas entran al listing, pero todavía no terminan comprando.",
    whyNow: "Hay visitas suficientes para revisar precio, claridad y confianza del contenido.",
    recommendation: "Revisar la propuesta comercial sin cambiar hechos del producto.",
    whatOperatorShouldDo: "Comprueba el cambio recomendado y confirma únicamente si la evidencia coincide.",
    expectedBenefit: "Reducir fricción de compra; el resultado debe medirse después.",
    helper: "Conversión significa visitas que terminaron en una compra oficial.",
  }
  if (reasons.has("AUTHORITATIVE_ZERO_IMPRESSIONS")) return {
    attentionClass: "CAN_IMPROVE" as const,
    humanSummary: "eBay no ha mostrado este producto durante la ventana observada.",
    whyNow: "Sin apariciones, el listing no puede recibir visitas orgánicas.",
    recommendation: "Revisar título, categoría e imágenes; cualquier promoción con gasto necesita al owner.",
    whatOperatorShouldDo: "Revisa la señal y escala cualquier propuesta pagada.",
    expectedBenefit: "Mejorar visibilidad o decidir una prueba controlada.",
    helper: "Una impresión es cada vez que eBay muestra el producto.",
  }
  if (visualFinding) return {
    attentionClass: "ENRICH" as const,
    humanSummary: "Seller OS encontró una mejora posible en la imagen principal.",
    whyNow: visualFinding.whyItMayMatter,
    recommendation: visualFinding.whatToReview,
    whatOperatorShouldDo: "Revisa que el producto sea exacto y que no aparezcan accesorios o funciones no incluidas.",
    expectedBenefit: "Hacer el listing más claro sin prometer impacto comercial.",
    helper: "La revisión visual es una observación, no una afirmación de causalidad sobre ventas.",
  }
  return {
    attentionClass: "WAIT" as const,
    humanSummary: "No hay evidencia suficiente para cambiar este listing ahora.",
    whyNow: "Seller OS protege el listing hasta tener una señal más clara.",
    recommendation: "No hacer nada todavía.",
    whatOperatorShouldDo: "Déjalo en observación; no necesitas realizar ninguna acción.",
    expectedBenefit: "Evitar cambios sin evidencia suficiente.",
    helper: "Esperar también es una decisión cuando el tráfico o la evidencia todavía no alcanzan.",
  }
}

function fallbackAction(input: {
  narrative: ReturnType<typeof dominantNarrative>
  quality: readonly EbayListingQualityRecommendation[]
  visual: SellerOsHeroVisualReviewV1 | null
}) {
  if (input.quality.length) return {
    kind: "REVIEW_GUIDANCE" as const,
    status: "READ_ONLY" as const,
    eventId: null,
    label: "Revisar recomendación",
    ownerApprovalRequired: false,
    ownerReason: null,
  }
  if (input.visual?.findings.length) return {
    kind: "REVIEW_VISUAL" as const,
    status: "READ_ONLY" as const,
    eventId: null,
    label: "Ver mejora visual",
    ownerApprovalRequired: false,
    ownerReason: null,
  }
  return {
    kind: "NO_ACTION" as const,
    status: "UNAVAILABLE" as const,
    eventId: null,
    label: input.narrative.attentionClass === "WAIT"
      ? "No hacer nada todavía" : "Ver evidencia",
    ownerApprovalRequired: false,
    ownerReason: null,
  }
}

export function buildRemoteLiveOptimizationOperatorV1(input: {
  monitor: CommercialMonitorGetDto
  commercialDashboard: unknown
  visualQuality: RemoteLiveVisualBundle
  salesResults: RemoteLiveOperatorSalesResultsV1
  improvementExecutions?: readonly unknown[]
  liveMutationEnabled?: boolean
}) {
  const listings = currentLiveListingsForMonitorV1(input.monitor)
  const tasks = remoteLiveOptimizationTasksV1(input.commercialDashboard)
  const executions = (input.improvementExecutions ?? []).map(record)
  const decisions = input.monitor.backend.decisions
  const qualityReport = input.monitor.backend.listingQualityReport
  const listingCards = listings.map((listing): RemoteLiveOperatorListingV1 => {
    const decision = decisions.find((row) => row.listingKey === listing.key) ?? null
    const quality = qualityReport.recommendations.filter((row) =>
      row.listingKey === listing.key &&
      row.associationStatus !== "UNPROVEN").slice(0, 5)
    const visual = input.visualQuality.listings.find((row) =>
      row.ebayItemId === listing.identity.itemId) ?? null
    const taskCandidate = tasks.filter((row) =>
      text(row.listingId, 30) === listing.identity.itemId)
      .flatMap((task) => {
        const execution = executions.find((row) =>
          text(row.commercial_event_id, 40) === text(task.id, 40)) ?? null
        const action = actionFromTask({ task, execution })
        return action ? [{ task, execution, action }] : []
      }).sort((left, right) => actionPriority(left) - actionPriority(right))[0]
      ?? null
    const taskAction = taskCandidate?.action ?? null
    const narrative = dominantNarrative({ listing, decision, quality,
      visual, taskAction })
    const resolvedAction = taskAction ?? fallbackAction({ narrative, quality,
      visual })
    const currentLiveReadback =
      listing.discovery.livePresence.status === "LIVE_ACTIVE" &&
      listing.discovery.livePresence.source ===
        "EBAY_TRADING_GET_MY_EBAY_SELLING"
    const exactListingIdentity = currentLiveReadback &&
      listing.identity.marketplaceCertification.status === "US_CERTIFIED" &&
      /^\d{9,20}$/.test(listing.identity.itemId)
    const productTruthSupported = isProvenSupplierLinkageV1(listing.stock)
    const action = !exactListingIdentity || !currentLiveReadback ||
      (resolvedAction.kind === "SAFE_PRICE_CHANGE" && !productTruthSupported)
      ? { kind: resolvedAction.kind,
          status: "UNAVAILABLE" as const,
          eventId: resolvedAction.eventId,
          label: "Esta acción no está disponible ahora. No necesitas hacer nada.",
          ownerApprovalRequired: resolvedAction.ownerApprovalRequired,
          ownerReason: "Falta una guarda autoritativa del listing exacto.", }
      : resolvedAction.kind === "SAFE_PRICE_CHANGE" &&
          input.liveMutationEnabled !== true
        ? { ...resolvedAction, status: "UNAVAILABLE" as const,
            label: "Disponible después de la certificación física.",
            ownerReason: "La escritura LIVE permanece cerrada hasta completar el canary físico." }
        : resolvedAction
    return Object.freeze({
      ebayItemId: listing.identity.itemId,
      title: listing.identity.title ?? `Listing ${listing.identity.itemId}`,
      sku: listing.identity.sku,
      imageUrl: visual?.heroImageUrl ?? listing.identity.primaryImageUrl,
      attentionClass: narrative.attentionClass,
      humanSummary: narrative.humanSummary,
      whyNow: narrative.whyNow,
      recommendation: narrative.recommendation,
      whatOperatorShouldDo: narrative.whatOperatorShouldDo,
      expectedBenefit: narrative.expectedBenefit,
      helper: narrative.helper,
      metrics: Object.freeze({
        impressions: metricValue(listing, "impressions"),
        views: metricValue(listing, "ebay_views"),
        ctrPercent: metricValue(listing, "ctr_calculated") ??
          metricValue(listing, "ctr_reported"),
        orders: metricValue(listing, "orders"),
        unitsSold: metricValue(listing, "units_sold"),
      }),
      evidence: Object.freeze({
        exactListingIdentity,
        productTruthSupported,
        currentLiveReadback,
        listingQualitySourceAvailable:
          qualityReport.status === "AVAILABLE",
        analyticsEvidenceAvailable:
          metricValue(listing, "impressions") !== null,
      }),
      ebayGuidance: Object.freeze(quality.map((row) => Object.freeze({
        category: row.recommendationCategory,
        recommendation: row.recommendationText ??
          `Revisar ${row.recommendationCategory}`,
        source: row.source,
        exactListingAssociation: row.associationStatus !== "UNPROVEN",
      }))),
      visualReview: Object.freeze({
        status: visual?.status ?? "UNPROVEN",
        imageUrl: visual?.heroImageUrl ?? listing.identity.primaryImageUrl,
        findings: Object.freeze((visual?.findings ?? []).slice(0, 4)
          .map((finding) => Object.freeze({
            observation: finding.observation,
            whyItMatters: finding.whyItMayMatter,
            whatToReview: finding.whatToReview,
          }))),
      }),
      action: Object.freeze({
        ...action,
        postActionReadbackRequired: true as const,
        unknownResultAutoRetry: false as const,
      }),
    })
  }).sort((left, right) => {
    const priority: Record<RemoteLiveAttentionClass, number> = {
      NEEDS_ATTENTION: 0, CAN_IMPROVE: 1, ENRICH: 2, WAIT: 3,
    }
    return priority[left.attentionClass] - priority[right.attentionClass] ||
      left.title.localeCompare(right.title)
  })
  return Object.freeze({
    contractVersion: REMOTE_LIVE_OPTIMIZATION_OPERATOR_VERSION,
    generatedAt: new Date().toISOString(),
    role: "REMOTE_LIVE_OPTIMIZATION_OPERATOR" as const,
    marketplace: "EBAY_US" as const,
    listings: Object.freeze(listingCards),
    queueCounts: Object.freeze({
      needsAttention: listingCards.filter((row) =>
        row.attentionClass === "NEEDS_ATTENTION").length,
      canImprove: listingCards.filter((row) =>
        row.attentionClass === "CAN_IMPROVE").length,
      enrich: listingCards.filter((row) =>
        row.attentionClass === "ENRICH").length,
      wait: listingCards.filter((row) =>
        row.attentionClass === "WAIT").length,
    }),
    results: input.salesResults,
    impact: Object.freeze({
      label: "Resultados de la tienda" as const,
      causalAttributionClaimed: false as const,
      operatorAttributedSales: null,
      reason: "OPERATOR_ACTION_TO_SALE_CAUSAL_ATTRIBUTION_NOT_PROVEN",
    }),
    capabilities: Object.freeze({
      listingQualitySignals: qualityReport.status === "AVAILABLE",
      commercialSignals: decisions.length > 0,
      imageEnrichmentReview: listingCards.some((row) =>
        row.visualReview.status !== "UNPROVEN"),
      lifestylePreparedAssetReview: false,
      promotionReview: true,
      safeLivePriceMutation: input.liveMutationEnabled === true,
      officialPostActionReadback: true,
    }),
    authority: Object.freeze({
      newListingPublishOwnerOnly: true as const,
      endListingOwnerOnly: true as const,
      infrastructureOwnerOnly: true as const,
      credentialsOwnerOnly: true as const,
      postsaleOwnerOnly: true as const,
      remoteOperatorPostsaleAccess: false as const,
      unauthorizedPromotionSpend: 0 as const,
    }),
    safety: Object.freeze({
      rawEbayJargonRequiredForOperation: false as const,
      factsInvented: false as const,
      officialReadbackRequired: true as const,
      unknownResultAutoRetry: false as const,
      buyerPiiIncluded: false as const,
      marketplaceWritesDuringRead: 0 as const,
    }),
  })
}

export type RemoteLiveOptimizationOperatorDashboardV1 = ReturnType<
  typeof buildRemoteLiveOptimizationOperatorV1>
