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
import type { RemoteOperatorPreparedImageProposalV1 } from
  "./ebay-remote-operator-image-review-v1"
import type { RemoteListingQualitySignalV1 } from
  "./ebay-listing-quality-report-owner-import-v1"
import type { RemoteOperatorSafeMutationCanaryV1 } from
  "./ebay-remote-operator-safe-mutation-canary-v1"

export const REMOTE_LIVE_OPTIMIZATION_OPERATOR_VERSION =
  "REMOTE_LIVE_OPTIMIZATION_OPERATOR_V1_2026_09_02_CANONICAL_TASK_FEED" as const

export const REMOTE_OPERATOR_AI_ASSISTANCE_POLICY_V1 = Object.freeze({
  deterministicFirst: true as const,
  allowedUses: Object.freeze([
    "TRANSLATE_EBAY_SIGNALS_TO_HUMAN_LANGUAGE",
    "EXPLAIN_WHAT_WHY_AND_NEXT_ACTION",
    "SUMMARIZE_EVIDENCE",
    "PREPARE_TITLE_AND_DESCRIPTION",
    "EXPRESS_EVIDENCE_BACKED_KEYWORDS",
    "COMPARE_CURRENT_AND_PROPOSED",
    "PREPARE_GUARDED_IMAGE_ENRICHMENT",
  ]),
  inventProductTruth: false as const,
  inventDemandEvidence: false as const,
  inventProductIdentifiers: false as const,
  inventProductFeatures: false as const,
  overrideMarginGuards: false as const,
  overrideOwnerAuthority: false as const,
  autoPublishNewListing: false as const,
  continuousAiPolling: false as const,
  aiCallOnlyWhenUseful: true as const,
  newAgentArchitecture: 0 as const,
})

export type RemoteLiveAttentionClass = "NEEDS_ATTENTION" | "CAN_IMPROVE" |
  "ENRICH" | "WAIT"

type JsonRecord = Record<string, unknown>

export type RemoteCommercialExceptionV1 = Readonly<{
  entityKey: string
  entityType?: string
  classification: string
  reasonCodes?: readonly string[]
  recommendedAction?: string
  humanApprovalRequired?: boolean
  actionBlockedByEvidence?: boolean
  experimentProtectionExists?: boolean
  lastObservationTime?: string | null
  dedupeIdentity: string
  material?: boolean
}>

export type RemoteOperatorCanonicalTaskV1 = Readonly<{
  taskId: string
  ebayItemId: string
  currentLive: true
  sourceAuthority: "COMMERCIAL_EXCEPTION_QUEUE" |
    "EBAY_LISTING_QUALITY_REPORT"
  sourceSignalId: string
  sourceAuthorities: readonly ("COMMERCIAL_EXCEPTION_QUEUE" |
    "EBAY_LISTING_QUALITY_REPORT")[]
  sourceSignalIds: readonly string[]
  observedAt: string
  recommendedAction: string
  attentionClass: RemoteLiveAttentionClass
  actionBlockedByEvidence: boolean
  executable: boolean
  productTruthSupported: boolean
  stockEvidenceSupported: boolean
  ownerApprovalRequired: boolean
}>

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
  officialQualitySignals: readonly RemoteListingQualitySignalV1[]
  visualReview: Readonly<{
    status: "AVAILABLE" | "PARTIAL" | "UNPROVEN"
    imageUrl: string | null
    findings: readonly Readonly<{
      observation: string
      whyItMatters: string
      whatToReview: string
    }>[]
  }>
  imageProposal: Readonly<{
    proposalId: string
    preparedAt: string
    currentImageUrl: string | null
    proposedMainImageUrl: string
    proposedLifestyleImageUrl: string | null
    proposedImageUrls: readonly string[]
    reviewAllowed: boolean
    reviewDecision: "APPROVE" | "REJECT" | null
    reviewedAt: string | null
    guards: Readonly<{
      exactProductIdentity: boolean
      noFalseFeatures: boolean
      noUnprovenAccessories: boolean
      productNotMisrepresented: boolean
    }>
  }> | null
  safeMutationCanary: RemoteOperatorSafeMutationCanaryV1 | null
  canonicalTask: RemoteOperatorCanonicalTaskV1 | null
  action: Readonly<{
    kind: "SAFE_PRICE_CHANGE" | "OWNER_ESCALATION" |
      "REVIEW_GUIDANCE" | "REVIEW_VISUAL" | "NO_ACTION"
    status: RemoteLiveOperatorActionStatus
    eventId: string | null
    label: string
    ownerApprovalRequired: boolean
    ownerReason: string | null
    actionBlockedByEvidence: boolean
    executable: boolean
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

function canonicalTaskAttentionClass(classification: string) {
  if (["CRITICAL_OPERATIONAL", "HUMAN_REVIEW"].includes(classification)) {
    return "NEEDS_ATTENTION" as const
  }
  if (["ACTIONABLE_COMMERCIAL", "REPLACEMENT_CANDIDATE"].includes(
    classification,
  )) return "CAN_IMPROVE" as const
  return "WAIT" as const
}

function humanRecommendedAction(value: string) {
  const actions: Record<string, string> = {
    IMPROVE_CTR: "Revisar primero la foto principal y el título.",
    IMPROVE_VISIBILITY: "Revisar título, categoría e imágenes.",
    IMPROVE_CONVERSION: "Revisar claridad, confianza y oferta del listing.",
    HUMAN_REVIEW: "Revisar la evidencia y pedir al owner la decisión que corresponda.",
    FIX_PROVEN_DATA_QUALITY_ISSUE:
      "Revisar el dato señalado usando únicamente evidencia confirmada.",
    REVIEW_EXPERIMENT_RESULT: "Revisar el resultado antes de cambiar otra variable.",
    REFRESH_SUPPLIER_EVIDENCE:
      "Esperar una lectura actual del producto exacto antes de cambiar el listing.",
    COLLECT_REQUIRED_EVIDENCE:
      "Esperar evidencia suficiente antes de cambiar el listing.",
    RESTORE_REQUIRED_EVIDENCE_CAPABILITY:
      "Esperar a que Seller OS recupere la evidencia necesaria.",
  }
  return actions[value] ??
    "Revisar la evidencia actual sin inventar información del producto."
}

function timestamp(value: unknown, fallback: string) {
  const candidate = text(value, 80)
  return candidate && Number.isFinite(Date.parse(candidate))
    ? new Date(candidate).toISOString() : fallback
}

function qualitySignalRank(signal: RemoteListingQualitySignalV1) {
  const attention = { NEEDS_ATTENTION: 0, CAN_IMPROVE: 1, ENRICH: 2,
    WAIT: 3 } as const
  return attention[signal.priorityClass]
}

/**
 * Adapter only: it does not diagnose listings or invent recommendations.
 * It projects the canonical CURRENT LIVE exception queue and the latest valid
 * normalized Listing Quality signals into one item-bound remote work feed.
 */
export function buildRemoteOperatorCanonicalTaskFeedV1(input: {
  listings: readonly CommercialListingReadModel[]
  commercialExceptions?: readonly RemoteCommercialExceptionV1[]
  listingQualitySignals?: readonly RemoteListingQualitySignalV1[]
  remoteScopeAuthorized?: boolean
  generatedAt?: string
}) {
  const generatedAt = timestamp(input.generatedAt, new Date().toISOString())
  const liveByItemId = new Map(input.listings.filter((listing) =>
    listing.discovery.livePresence.status === "LIVE_ACTIVE" &&
    /^\d{9,20}$/.test(listing.identity.itemId)).map((listing) =>
      [listing.identity.itemId, listing]))
  type Candidate = RemoteOperatorCanonicalTaskV1 & Readonly<{
    rank: number
  }>
  const candidates: Candidate[] = []
  const commercialExceptions = (input.commercialExceptions ?? []).filter(
    (entry) => entry.entityType === "EBAY_LIVE_LISTING" &&
      entry.material !== false && /^\d{9,20}$/.test(entry.entityKey) &&
      liveByItemId.has(entry.entityKey),
  )
  for (const entry of commercialExceptions) {
    const listing = liveByItemId.get(entry.entityKey)!
    const productTruthSupported = isProvenSupplierLinkageV1(listing.stock)
    const stockEvidenceSupported = listing.stock.state === "IN_STOCK_SIGNAL" &&
      listing.stock.freshness?.status === "FRESH"
    const actionBlockedByEvidence = entry.actionBlockedByEvidence === true ||
      !productTruthSupported || !stockEvidenceSupported
    const sourceSignalId = text(entry.dedupeIdentity, 100)
    if (!sourceSignalId) continue
    const attentionClass = canonicalTaskAttentionClass(entry.classification)
    candidates.push(Object.freeze({
      taskId: `remote:${entry.entityKey}:${sourceSignalId}`,
      ebayItemId: entry.entityKey,
      currentLive: true as const,
      sourceAuthority: "COMMERCIAL_EXCEPTION_QUEUE" as const,
      sourceSignalId,
      sourceAuthorities: Object.freeze([
        "COMMERCIAL_EXCEPTION_QUEUE" as const,
      ]),
      sourceSignalIds: Object.freeze([sourceSignalId]),
      observedAt: timestamp(entry.lastObservationTime, generatedAt),
      recommendedAction: humanRecommendedAction(
        entry.recommendedAction ?? "HUMAN_REVIEW"),
      attentionClass,
      actionBlockedByEvidence,
      executable: !actionBlockedByEvidence &&
        entry.experimentProtectionExists !== true,
      productTruthSupported,
      stockEvidenceSupported,
      ownerApprovalRequired: entry.humanApprovalRequired === true,
      rank: attentionClass === "NEEDS_ATTENTION" ? 0 :
        attentionClass === "CAN_IMPROVE" ? 1 : 3,
    }))
  }
  const validQualitySignals = input.listingQualitySignals ?? []
  const currentLiveQualitySignals = validQualitySignals.filter((signal) =>
    liveByItemId.has(signal.itemId))
  for (const signal of currentLiveQualitySignals.filter((row) =>
    row.freshness === "CURRENT")) {
    const listing = liveByItemId.get(signal.itemId)!
    const productTruthSupported = signal.productTruthSupported &&
      isProvenSupplierLinkageV1(listing.stock)
    const stockEvidenceSupported = listing.stock.state === "IN_STOCK_SIGNAL" &&
      listing.stock.freshness?.status === "FRESH"
    const actionBlockedByEvidence = !signal.operatorActionRequired ||
      !productTruthSupported || !stockEvidenceSupported
    const sourceSignalId = text(signal.signalId, 100)
    if (!sourceSignalId) continue
    const promotion = signal.signalType === "PROMOTION_VISIBILITY_OPPORTUNITY"
    candidates.push(Object.freeze({
      taskId: `remote:${signal.itemId}:${sourceSignalId}`,
      ebayItemId: signal.itemId,
      currentLive: true as const,
      sourceAuthority: "EBAY_LISTING_QUALITY_REPORT" as const,
      sourceSignalId,
      sourceAuthorities: Object.freeze([
        "EBAY_LISTING_QUALITY_REPORT" as const,
      ]),
      sourceSignalIds: Object.freeze([sourceSignalId]),
      observedAt: timestamp(signal.observedAt, generatedAt),
      recommendedAction: signal.sellerOsRecommendation,
      attentionClass: signal.priorityClass,
      actionBlockedByEvidence,
      executable: !actionBlockedByEvidence && !promotion,
      productTruthSupported,
      stockEvidenceSupported,
      ownerApprovalRequired: promotion,
      rank: qualitySignalRank(signal),
    }))
  }

  // The remote surface is item-oriented. Multiple authorities for the same
  // exact listing become one work bundle so one underlying problem can never
  // create duplicate taps or parallel decisions.
  const byItemId = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    byItemId.set(candidate.ebayItemId,
      [...(byItemId.get(candidate.ebayItemId) ?? []), candidate])
  }
  const beforeAcl = byItemId.size
  const authorized = input.remoteScopeAuthorized !== false
  const tasks = authorized ? [...byItemId.values()].map((rows) => {
    const ordered = [...rows].sort((left, right) => left.rank - right.rank ||
      left.observedAt.localeCompare(right.observedAt) * -1 ||
      left.sourceSignalId.localeCompare(right.sourceSignalId))
    const primary = ordered[0]
    const sourceAuthorities = [...new Set(ordered.flatMap((row) =>
      row.sourceAuthorities))]
    const sourceSignalIds = [...new Set(ordered.flatMap((row) =>
      row.sourceSignalIds))]
    return Object.freeze({
      taskId: primary.taskId,
      ebayItemId: primary.ebayItemId,
      currentLive: true as const,
      sourceAuthority: primary.sourceAuthority,
      sourceSignalId: primary.sourceSignalId,
      sourceAuthorities: Object.freeze(sourceAuthorities),
      sourceSignalIds: Object.freeze(sourceSignalIds),
      observedAt: ordered.map((row) => row.observedAt).sort().at(-1) ??
        primary.observedAt,
      recommendedAction: primary.recommendedAction,
      attentionClass: primary.attentionClass,
      actionBlockedByEvidence: ordered.every((row) =>
        row.actionBlockedByEvidence),
      executable: ordered.some((row) => row.executable),
      productTruthSupported: ordered.some((row) =>
        row.productTruthSupported),
      stockEvidenceSupported: ordered.some((row) =>
        row.stockEvidenceSupported),
      ownerApprovalRequired: ordered.some((row) =>
        row.ownerApprovalRequired),
    })
  }).sort((left, right) => {
    const priority = { NEEDS_ATTENTION: 0, CAN_IMPROVE: 1, ENRICH: 2,
      WAIT: 3 } as const
    return priority[left.attentionClass] - priority[right.attentionClass] ||
      right.observedAt.localeCompare(left.observedAt) ||
      left.ebayItemId.localeCompare(right.ebayItemId)
  }) : []
  return Object.freeze({
    tasks: Object.freeze(tasks),
    trace: Object.freeze({
      remoteOperatorAuthPass: authorized,
      currentLiveCohortVisibleToServer: liveByItemId.size,
      commercialExceptionCount: commercialExceptions.length,
      validQualitySignalCount: validQualitySignals.length,
      qualitySignalCurrentLiveMatchCount: currentLiveQualitySignals.length,
      remoteTaskCandidateCountBeforeAcl: beforeAcl,
      remoteTaskCountAfterAcl: tasks.length,
      remoteTaskCountAfterEvidenceGate: tasks.length,
      remoteExecutableTaskCountAfterEvidenceGate: tasks.filter((row) =>
        row.executable).length,
      remoteBlockedTaskCountAfterEvidenceGate: tasks.filter((row) =>
        row.actionBlockedByEvidence).length,
      remoteTaskCountRendered: tasks.length,
      blockedTasksRetainedInFeed: true as const,
      duplicateTaskCount: 0 as const,
    }),
  })
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
    ownerReason: "Este producto podría recibir más visibilidad. Necesita aprobación del owner porque implica gasto.",
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
  canonicalException: RemoteCommercialExceptionV1 | null
  quality: readonly EbayListingQualityRecommendation[]
  officialQualitySignal: RemoteListingQualitySignalV1 | null
  visual: SellerOsHeroVisualReviewV1 | null
  taskAction: ReturnType<typeof actionFromTask>
}) {
  const reasons = new Set([
    ...(input.canonicalException?.reasonCodes ?? []),
    ...(input.decision?.reasonCodes ?? []),
  ])
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
  if (input.officialQualitySignal) return {
    attentionClass: input.officialQualitySignal.priorityClass,
    humanSummary: input.officialQualitySignal.whatIsHappening,
    whyNow: input.officialQualitySignal.whyItMatters,
    recommendation: input.officialQualitySignal.sellerOsRecommendation,
    whatOperatorShouldDo: input.officialQualitySignal.whatToDoNow,
    expectedBenefit: input.officialQualitySignal.operatorActionRequired
      ? "Completar el listing con evidencia del producto exacto."
      : "Evitar completar datos sin evidencia suficiente.",
    helper: input.officialQualitySignal.productTruthSupported
      ? "Seller OS vinculó esta propuesta con el producto exacto."
      : "La recomendación de eBay no prueba por sí sola qué valor corresponde.",
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
    helper: "Comparamos cuántas veces eBay mostró el producto con cuántas personas decidieron abrirlo.",
  }
  if (reasons.has("TRAFFIC_WITHOUT_CONVERSION")) return {
    attentionClass: "CAN_IMPROVE" as const,
    humanSummary: "Las personas entran al listing, pero todavía no terminan comprando.",
    whyNow: "Hay visitas suficientes para revisar precio, claridad y confianza del contenido.",
    recommendation: "Revisar la propuesta comercial sin cambiar hechos del producto.",
    whatOperatorShouldDo: "Comprueba el cambio recomendado y confirma únicamente si la evidencia coincide.",
    expectedBenefit: "Reducir fricción de compra; el resultado debe medirse después.",
    helper: "Aquí sólo contamos compras confirmadas en los pedidos oficiales de eBay.",
  }
  if (reasons.has("AUTHORITATIVE_ZERO_IMPRESSIONS")) return {
    attentionClass: "CAN_IMPROVE" as const,
    humanSummary: "eBay no ha mostrado este producto durante la ventana observada.",
    whyNow: "Sin apariciones, el listing no puede recibir visitas orgánicas.",
    recommendation: "Revisar título, categoría e imágenes. Este producto podría recibir más visibilidad.",
    whatOperatorShouldDo: "Revisa la señal y escala cualquier propuesta pagada.",
    expectedBenefit: "Mejorar visibilidad o decidir una prueba controlada.",
    helper: "Esta señal cuenta cada vez que eBay mostró el producto durante el período observado.",
  }
  if (input.canonicalException?.material !== false) return {
    attentionClass: canonicalTaskAttentionClass(
      input.canonicalException?.classification ?? "WAIT"),
    humanSummary:
      "Seller OS encontró una señal que necesita una revisión humana.",
    whyNow:
      "La evidencia actual requiere una decisión cuidadosa antes de cambiar el listing.",
    recommendation: humanRecommendedAction(
      input.canonicalException?.recommendedAction ?? "HUMAN_REVIEW"),
    whatOperatorShouldDo:
      "Abre la evidencia y revisa la recomendación sin cambiar hechos del producto.",
    expectedBenefit:
      "Resolver la señal sin crear información ni hacer cambios innecesarios.",
    helper:
      "Seller OS conserva la evidencia técnica, pero aquí la presenta como una tarea sencilla.",
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
  officialQualitySignal: RemoteListingQualitySignalV1 | null
  visual: SellerOsHeroVisualReviewV1 | null
}) {
  if (input.officialQualitySignal?.operatorActionRequired || input.quality.length) return {
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
  commercialExceptions?: readonly RemoteCommercialExceptionV1[]
  visualQuality: RemoteLiveVisualBundle
  salesResults: RemoteLiveOperatorSalesResultsV1
  imageProposals?: readonly RemoteOperatorPreparedImageProposalV1[]
  listingQualitySignals?: readonly RemoteListingQualitySignalV1[]
  safeMutationCanary?: RemoteOperatorSafeMutationCanaryV1 | null
  improvementExecutions?: readonly unknown[]
  operatorUserId?: string | null
  remoteScopeAuthorized?: boolean
  liveMutationEnabled?: boolean
}) {
  const listings = currentLiveListingsForMonitorV1(input.monitor)
  const canonicalFeed = buildRemoteOperatorCanonicalTaskFeedV1({
    listings,
    commercialExceptions: input.commercialExceptions,
    listingQualitySignals: input.listingQualitySignals,
    remoteScopeAuthorized: input.remoteScopeAuthorized,
    generatedAt: input.monitor.generatedAt,
  })
  const canonicalTaskByItemId = new Map(canonicalFeed.tasks.map((task) =>
    [task.ebayItemId, task]))
  const canonicalExceptionByItemId = new Map(
    (input.commercialExceptions ?? []).filter((entry) =>
      entry.entityType === "EBAY_LIVE_LISTING" &&
      /^\d{9,20}$/.test(entry.entityKey)).map((entry) =>
        [entry.entityKey, entry]),
  )
  const tasks = remoteLiveOptimizationTasksV1(input.commercialDashboard)
  const executions = (input.improvementExecutions ?? []).map(record)
  const decisions = input.monitor.backend.decisions
  const qualityReport = input.monitor.backend.listingQualityReport
  const listingCards = listings.map((listing): RemoteLiveOperatorListingV1 => {
    const decision = decisions.find((row) => row.listingKey === listing.key) ?? null
    const canonicalException = canonicalExceptionByItemId.get(
      listing.identity.itemId) ?? null
    const canonicalTask = canonicalTaskByItemId.get(listing.identity.itemId) ??
      null
    const quality = qualityReport.recommendations.filter((row) =>
      row.listingKey === listing.key &&
      row.associationStatus !== "UNPROVEN").slice(0, 5)
    const officialQualitySignals = (input.listingQualitySignals ?? []).filter((row) =>
      row.itemId === listing.identity.itemId).slice(0, 5)
    const officialQualitySignal = officialQualitySignals.find((row) =>
      row.freshness === "CURRENT") ?? null
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
    const baseNarrative = dominantNarrative({ listing, decision,
      canonicalException, quality, officialQualitySignal, visual, taskAction })
    const narrative = canonicalTask?.actionBlockedByEvidence === true
      ? { ...baseNarrative,
          recommendation:
            "No tenemos suficiente información todavía. No necesitas hacer nada.",
          whatOperatorShouldDo:
            "No tenemos suficiente información todavía. No necesitas hacer nada.",
          expectedBenefit:
            "Evitar un cambio que no esté respaldado por evidencia actual." }
      : baseNarrative
    const resolvedAction = taskAction ?? fallbackAction({ narrative, quality,
      officialQualitySignal, visual })
    const currentLiveReadback =
      listing.discovery.livePresence.status === "LIVE_ACTIVE" &&
      listing.discovery.livePresence.source ===
        "EBAY_TRADING_GET_MY_EBAY_SELLING"
    const exactListingIdentity = currentLiveReadback &&
      listing.identity.marketplaceCertification.status === "US_CERTIFIED" &&
      /^\d{9,20}$/.test(listing.identity.itemId)
    const productTruthSupported = isProvenSupplierLinkageV1(listing.stock)
    const preparedProposal = input.imageProposals?.find((proposal) =>
      proposal.ebayItemId === listing.identity.itemId) ?? null
    const proposalGuards = preparedProposal ? Object.freeze({
      exactProductIdentity: exactListingIdentity && productTruthSupported &&
        preparedProposal.guards.pipelineExactProductIdentity,
      noFalseFeatures: preparedProposal.guards.noFalseFeatures,
      noUnprovenAccessories:
        preparedProposal.guards.noUnprovenAccessories,
      productNotMisrepresented:
        preparedProposal.guards.productNotMisrepresented,
    }) : null
    const imageProposal = preparedProposal && proposalGuards
      ? Object.freeze({
          proposalId: preparedProposal.proposalId,
          preparedAt: preparedProposal.preparedAt,
          currentImageUrl: visual?.heroImageUrl ??
            listing.identity.primaryImageUrl,
          proposedMainImageUrl: preparedProposal.proposedMainImageUrl,
          proposedLifestyleImageUrl:
            preparedProposal.proposedLifestyleImageUrl,
          proposedImageUrls: preparedProposal.proposedImageUrls,
          reviewAllowed: Object.values(proposalGuards).every(Boolean),
          reviewDecision: preparedProposal.reviewDecision,
          reviewedAt: preparedProposal.reviewedAt,
          guards: proposalGuards,
        }) : null
    const action = canonicalTask?.actionBlockedByEvidence === true
      ? { kind: "NO_ACTION" as const,
          status: "UNAVAILABLE" as const,
          eventId: null,
          label:
            "No tenemos suficiente información todavía. No necesitas hacer nada.",
          ownerApprovalRequired: false,
          ownerReason: null }
      : !exactListingIdentity || !currentLiveReadback ||
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
      officialQualitySignals: Object.freeze(officialQualitySignals),
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
      imageProposal,
      safeMutationCanary: input.safeMutationCanary?.ebayItemId ===
        listing.identity.itemId ? input.safeMutationCanary : null,
      canonicalTask,
      action: Object.freeze({
        ...action,
        actionBlockedByEvidence:
          canonicalTask?.actionBlockedByEvidence === true,
        executable: canonicalTask?.actionBlockedByEvidence !== true &&
          ["AVAILABLE", "AWAITING_CONFIRMATION", "OWNER_REQUIRED"]
            .includes(action.status),
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
  const operatorExecutions = executions.filter((row) =>
    input.operatorUserId && text(row.actor_user_id, 40) ===
      input.operatorUserId).filter((row) =>
        /^\d{9,20}$/.test(text(row.listing_id, 30) ?? ""))
  const history = Object.freeze(operatorExecutions.slice(0, 20).map((row) => {
    const phase = text(row.phase, 80)
    return Object.freeze({
      listingId: text(row.listing_id, 30) ?? "",
      title: listingCards.find((listing) =>
        listing.ebayItemId === text(row.listing_id, 30))?.title ??
          "Listing LIVE",
      action: text(row.action_type, 80) === "PRICE"
        ? "Revisión de precio" : "Revisión de visibilidad",
      status: phase === "applied_verified" ? "Cambio confirmado" :
        phase === "outcome_unknown" ? "Verificando con eBay" :
          phase === "terminal_failure" ? "No se aplicó" :
            "Revisión preparada",
      occurredAt: text(row.applied_verified_at, 80) ??
        text(row.created_at, 80),
      saleCausalityClaimed: false as const,
    })
  }))
  const imageReviewCount = (input.imageProposals ?? []).filter((proposal) =>
    proposal.reviewDecision !== null).length
  const auditedListingIds = new Set([
    ...history.map((row) => row.listingId),
    ...(input.imageProposals ?? []).filter((proposal) =>
      proposal.reviewDecision !== null).map((proposal) =>
      proposal.ebayItemId),
  ])
  const taskListingCards = listingCards.filter((row) =>
    row.canonicalTask !== null)
  return Object.freeze({
    contractVersion: REMOTE_LIVE_OPTIMIZATION_OPERATOR_VERSION,
    generatedAt: new Date().toISOString(),
    role: "REMOTE_LIVE_OPTIMIZATION_OPERATOR" as const,
    marketplace: "EBAY_US" as const,
    menu: Object.freeze([
      "Inicio", "Mis tareas", "Listings LIVE", "Mejoras sugeridas",
      "Resultados", "Historial", "Ayuda",
    ]),
    aiAssistancePolicy: REMOTE_OPERATOR_AI_ASSISTANCE_POLICY_V1,
    taskFeed: canonicalFeed.tasks,
    feedTrace: canonicalFeed.trace,
    listings: Object.freeze(listingCards),
    queueCounts: Object.freeze({
      needsAttention: taskListingCards.filter((row) =>
        row.attentionClass === "NEEDS_ATTENTION").length,
      canImprove: taskListingCards.filter((row) =>
        row.attentionClass === "CAN_IMPROVE").length,
      enrich: taskListingCards.filter((row) =>
        row.attentionClass === "ENRICH").length,
      wait: taskListingCards.filter((row) =>
        row.attentionClass === "WAIT").length,
    }),
    results: input.salesResults,
    impact: Object.freeze({
      label: "Tu impacto" as const,
      visible: auditedListingIds.size > 0,
      auditedActionCount: history.length + imageReviewCount,
      auditedListingCount: auditedListingIds.size,
      causalAttributionClaimed: false as const,
      operatorAttributedSales: null,
      reason: "OPERATOR_ACTION_TO_SALE_CAUSAL_ATTRIBUTION_NOT_PROVEN",
    }),
    capabilities: Object.freeze({
      listingQualitySignals: qualityReport.status === "AVAILABLE" ||
        (input.listingQualitySignals?.length ?? 0) > 0,
      commercialSignals: decisions.length > 0,
      imageEnrichmentReview: true as const,
      lifestylePreparedAssetReview: true as const,
      preparedImageProposalCount: listingCards.filter((row) =>
        row.imageProposal !== null).length,
      promotionReview: true,
      safeLivePriceMutation: input.liveMutationEnabled === true,
      safeLiveTitleCanary: input.safeMutationCanary !== null &&
        input.safeMutationCanary !== undefined,
      safeLiveTitleCanaryApplyEnabled:
        input.safeMutationCanary?.applyAvailable === true,
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
      remoteOperatorReportUploadAccess: false as const,
      remoteOperatorRawReportAccess: false as const,
      marketplaceWritesDuringRead: 0 as const,
    }),
    history,
  })
}

export type RemoteLiveOptimizationOperatorDashboardV1 = ReturnType<
  typeof buildRemoteLiveOptimizationOperatorV1>
