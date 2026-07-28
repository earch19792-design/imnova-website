"use client"

import { useCallback, useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"
import {
  getMobileReviewPayloadError,
  getMobileReviewRequestError,
  readMobileReviewJson,
} from "@/lib/ebay/ebay-mobile-review-http"
import {
  buildCommercialMonitorRunRequest,
  isSatisfactoryCommercialDryRun,
  type CommercialMonitorReaderView,
  type CommercialMonitorRunView,
} from "@/lib/ebay/commercial-monitor-ui"
import {
  formatSingleProductLabMetric,
  SINGLE_PRODUCT_LAB_UNAVAILABLE,
} from "@/lib/ebay/single-product-lab"

type MonitorMetrics = Record<string, unknown> & {
  dryRun?: boolean
  activeListings?: number
  officialOrdersRead?: number
  completedCheckoutLineItems?: number
  sellerHubMessageHeadersRead?: number
  sellerHubMessageContentReturned?: boolean
  sellerHubMessageRawXmlPersisted?: boolean
  analyticsListingsRead?: number
  watcherListingsRead?: number
  competitorListingsRead?: number
  competitorActiveSellers?: number
  competitorResearchRefreshRecommendations?: number
  newSales?: number
  fulfillmentTasksCreated?: number
  snapshotsCreated?: number
  eventsCreated?: number
  alertsGenerated?: number
  alertsEnqueued?: number
  outboxRowsCreated?: number
  persistenceWrites?: number
  buyerPiiFieldsReturned?: number
  listingIdentityVerified?: boolean
  lunaExactSupplyLinked?: boolean
  lunaSupplyFresh?: boolean
  lunaSupplyObservedAt?: string | null
  whatsappMetaAccepted?: number
  whatsappDelivered?: number
  ebayWrites?: number
  buyerPiiReturned?: boolean
  commercialDataPersistencePerformed?: boolean
  authentication?: {
    ordersOAuth?: string
    messagesAuth?: string
    watchersAuth?: string
    analyticsAuth?: string
    fulfillmentScopeConfirmed?: boolean
    officialIdentityMatch?: boolean | null
    actionRequired?: string
  }
  analytics?: {
    impressions?: number | null
    views?: number | null
    transactions?: number | null
    watchers?: number | null
  }
  sellerHubMessages?: {
    headersRead?: number | null
    eventsCreated?: number
    alertsEnqueued?: number
    duplicatesAvoided?: number
    contentStored?: false
    buyerPiiStored?: false
    rawXmlStored?: false
  }
  competitors?: {
    listingsScanned?: number
    activeOffers?: number
    activeSellers?: number
    newSellers?: number
    potentialSellers?: number
    researchRefreshRecommendations?: number
    activeOfferTreatedAsConfirmedSale?: false
    automaticProductResearchImport?: false
    automaticEbayMutation?: false
    ebayWrites?: 0
  } | null
}

type MonitorRun = Omit<CommercialMonitorRunView, "metrics"> & {
  metrics?: MonitorMetrics
}

type Dashboard = {
  status?: string
  latestRun?: MonitorRun | null
  lastDryRun?: MonitorRun | null
  lastPersistentRun?: MonitorRun | null
  health?: {
    fulfillmentTasks?: number
    pendingManualPurchase?: number
    awaitingTracking?: number
    alertsPending?: number
    alertsFailed?: number
    alertsDeadLetter?: number
    retries?: number
    flags?: string[]
    analyticsRulesSuspended?: boolean
    analyticsRulesSuspendedListingIds?: string[]
    continuingLanes?: string[]
  } | null
  analyticsSourceDivergence?: {
    classification?: string
    healthFlag?: string | null
    status?: string
    listingId?: string
    sku?: string
    manualSource?: {
      source?: string
      entityScope?: string
      impressionsMetric?: string
      viewsMetric?: string
      transactionsMetric?: string
      ctrMetric?: string
      ctrUnit?: string
      windowStart?: string | null
      windowEnd?: string | null
      timeZone?: string | null
      observedOn?: string
      metrics?: { impressions?: number | null; views?: number | null; transactions?: number | null; ctr?: number | null }
    } | null
    officialSource?: {
      source?: string | null
      impressionsMetric?: string
      viewsMetric?: string
      transactionsMetric?: string
      ctrMetric?: string
      ctrUnit?: string
      entityScope?: string
      timeZone?: string | null
      observedAt?: string | null
      windowStart?: string | null
      windowEnd?: string | null
      lastUpdatedDate?: string | null
      metrics?: { impressions?: number | null; views?: number | null; transactions?: number | null; ctr?: number | null } | null
    }
    lastCheckedAt?: string | null
    nextCheckAt?: string | null
    comparison?: {
      comparable?: boolean
      reasonCodes?: string[]
    }
    manualEvidenceUsedAsApiMetric?: boolean
  } | null
  listingIdentity?: {
    listingId?: string
    expectedSku?: string
    supplierSku?: string
    observedListingId?: string | null
    observedSku?: string | null
    observedListingStatus?: string | null
    itemIdMatches?: boolean
    skuMatches?: boolean
    activeListingConfirmed?: boolean
    source?: string
    error?: string | null
    observedAt?: string | null
    salesProcessingBlocked?: boolean
  }
  nextAutomaticRunAt?: string | null
  schedulerAuthorization?: {
    status?: "ACTIVE" | "EXPIRED" | "MISSING"
    mode?: "CONTINUOUS_WHILE_ACTIVE"
    authorizedAt?: string | null
    expiresAt?: string | null
    lastUsedAt?: string | null
    useCount?: number
  }
  pilot24h?: {
    status?: string
    startedAt?: string | null
    expiresAt?: string | null
    totalRuns?: number
    completedRuns?: number
    partialRuns?: number
    failedRuns?: number
    ordersRead?: number
    newSales?: number
    fulfillmentTasksCreated?: number
    alertsGenerated?: number
    whatsappMetaAccepted?: number
    whatsappDelivered?: number
    whatsappFailed?: number
    duplicatesAvoided?: number
    retries?: number
    deadLetter?: number
    analyticsDivergenceStatus?: string | null
    ebayWrites?: number
    productionChanged?: boolean
  } | null
  schedule?: {
    enabled?: boolean
    effectivelyEnabled?: boolean
    previewOnly?: boolean
    pilot?: {
      status?: string
      startedAt?: string | null
      expiresAt?: string | null
      automaticCutoff?: boolean
    }
  }
  competitorWatch?: {
    status?: "ACTIVE" | "WAITING_BASELINE"
    profiles?: Array<{
      listing_id?: string
      sku?: string | null
      last_scanned_at?: string | null
      baseline_completed_at?: string | null
      latest_active_offer_count?: number
      latest_active_seller_count?: number
      latest_estimated_activity_seller_count?: number
      latest_confirmed_sold_seller_count?: number
      latest_median_landed_price?: number | null
      latest_evidence_class?: string
      latest_suggestion_codes?: string[]
      latest_suggested_terms?: string[]
      research_refresh_recommended?: boolean
      research_refresh_reason_codes?: string[]
      last_research_refresh_recommended_at?: string | null
    }>
    priceRecommendations?: Array<{
      id?: string
      listingId?: string
      sku?: string | null
      detectedAt?: string
      recommendedAction?: string
      status?: "AWAITING_HUMAN_APPROVAL"
      changeApplied?: false
      whatsappEnqueued?: true
      priceRecommendation?: {
        action?: string
        confidence?: string
        currentItemPrice?: number
        proposedItemPrice?: number
        confirmedSoldBenchmarkLandedPrice?: number
        confirmedSoldSellerCount?: number
        confirmedSoldQuantity?: number
        activeMarketMedianLandedPrice?: number
        activeSellerCount?: number
        minimumSafeLandedPrice?: number
        standardMinimumSafeLandedPrice?: number
        floorWithPromotionReserve?: number
        floorWithoutPromotion?: number
        controlledRiskMinimumLandedPrice?: number
        controlledRiskTenPercent?: boolean
        promotionReserveIncluded?: boolean
        canReachActiveMarketSafely?: boolean
        comparisonBasis?: string
        activeMarketNotConfirmedSale?: boolean
        proposedPassesProfitGate?: boolean
        activeMarketEconomics?: {
          estimatedNetProfit?: number | null
          estimatedNetMarginPercent?: number | null
          estimatedRoiPercent?: number | null
          estimatedOutboundShipping?: number | null
          estimatedEbayFees?: number | null
          returnsReserve?: number | null
          promotedListingsReserve?: number | null
          minimumNetProfit?: number
          minimumNetMarginPercent?: number
          minimumRoiPercent?: number
          passesProfitGate?: boolean
          failedGateCodes?: string[]
          shippingSource?: string
        }
        proposedEstimatedNetProfit?: number | null
        proposedEstimatedMarginPercent?: number | null
        proposedEstimatedRoiPercent?: number | null
      }
    }>
    automaticActiveSellerDiscovery?: boolean
    productResearchRefreshIsSelective?: boolean
    automaticProductResearchImport?: false
    humanReviewRequired?: boolean
    ebayWrites?: 0
  }
  supplyActions?: Array<{
    id?: string
    eventType?: "ACTIVE_LISTING_OUT_OF_STOCK" | "LUNA_COST_CHANGED" | "MARGIN_RISK"
    severity?: "critical" | "high" | "medium" | "low"
    listingId?: string
    sku?: string | null
    detectedAt?: string
    recommendedAction?: string
    status?: "AWAITING_HUMAN_APPROVAL"
    changeApplied?: false
    humanConfirmationRequired?: true
    evidence?: {
      previousSupplierCost?: number
      currentSupplierCost?: number
      estimatedMarginPercent?: number
      stockAvailable?: number
    }
  }>
  optimizationTasks?: Array<{
    id?: string
    eventType?: string
    severity?: "critical" | "high" | "medium" | "low"
    listingId?: string
    sku?: string | null
    detectedAt?: string
    recommendedAction?: string
    status?: "AWAITING_HUMAN_APPROVAL"
    changeApplied?: false
    whatsappEnqueued?: true
    evidence?: {
      notificationTitle?: string
      whyItNeedsAttention?: string
      reviewSequence?: string[]
      nextEligibleAt?: string
      rulesetVersion?: string
      listingAgeEvidence?: {
        startedAt?: string
        ageHours?: number
        source?: "EBAY_OFFICIAL_START_TIME" | "SELLER_OS_REGISTRATION_FALLBACK"
        sourceLabel?: "FUENTE EBAY" | "ESTIMACIÓN CONSERVADORA"
        conservativeEstimate?: boolean
        explanation?: string
      }
      experiment?: {
        variable?: string
        changeCount?: 1
        proposal?: string
        measurementPlan?: string
        guardrail?: string
        status?: "AWAITING_HUMAN_APPROVAL"
        automaticChangeAllowed?: false
        ebayWriteAllowed?: false
      }
      promotionRecommendation?: {
        status?: "READY_FOR_HUMAN_APPROVAL" | "NOT_RECOMMENDED" | "BLOCKED_CONTROLLED_RISK"
        recommendedRatePercent?: number
        durationDays?: number
        reason?: string
        applyFromSellerOs?: boolean
      }
    }
  }>
}

type Payload = {
  success?: boolean
  error?: string
  dashboard?: Dashboard
  run?: MonitorRun
  comparison?: SellerHubComparison
  action?: string
  improvement?: {
    executionId?: string
    listingId?: string
    actionType?: "PRICE" | "PROMOTED_LISTINGS_GENERAL" | "END_LISTING"
    phase?: string
    appliedVerified?: boolean
    confirmationRequired?: string
  }
}

type AnalyticsAudit = {
  requestedListingIds?: string[]
  returnedListingDimensions?: string[]
  matchedListingIds?: string[]
  unmatchedRequestedListingIds?: string[]
  unexpectedDimensions?: string[]
  queryDimension?: string
  queryTimeZone?: string
  windowStart?: string
  windowEnd?: string
  reportStartDate?: string | null
  reportEndDate?: string | null
  lastUpdatedDate?: string | null
  completenessStatus?: string
  dataFreshnessStatus?: string
  warnings?: string[]
  metrics?: Array<{
    listingId?: string
    impressions?: number | null
    views?: number | null
    transactions?: number | null
    ctr?: number | null
  }>
}

type SellerHubComparison = {
  classification?: string
  explanation?: string
  sellerHubEvidence?: {
    impressions?: number | null
    views?: number | null
    transactions?: number | null
    ctr?: number | null
    calculatedCtr?: number | null
  } | null
  operational?: AnalyticsAudit | null
  comparison?: AnalyticsAudit | null
  accountDiagnostic?: AnalyticsAudit | null
  safety?: {
    persistencePerformed?: boolean
    alertsGenerated?: number
    fulfillmentTasksCreated?: number
    whatsappDelivered?: number
    ebayWrites?: number
    buyerPiiReturned?: boolean
  }
}

function formatDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Pendiente"
  return new Intl.DateTimeFormat("es", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value))
}

function statusTone(status: string | undefined) {
  if (["available", "completed"].includes(status ?? "")) return "text-emerald-100"
  if (["partial", "incomplete"].includes(status ?? "")) return "text-amber-100"
  if (["failed", "unavailable"].includes(status ?? "")) return "text-rose-100"
  return "text-white/60"
}

function value(input: unknown) {
  return formatSingleProductLabMetric(input)
}

function knownSum(values: ReadonlyArray<number | null | undefined>) {
  return values.length > 0 &&
    values.every((item): item is number =>
      typeof item === "number" && Number.isFinite(item)
    )
    ? values.reduce((total, item) => total + item, 0)
    : null
}

function list(value: string[] | undefined) {
  return value?.length ? value.join(", ") : "—"
}

function authLabel(status: string | undefined) {
  if (status === "CLIENT_CREDENTIAL_MISMATCH") return "CLIENT_MISMATCH"
  return status ?? "PENDIENTE"
}

function competitorSuggestionLabel(code: string) {
  const labels: Record<string, string> = {
    REVIEW_FREE_SHIPPING_COMMON_PATTERN: "Revisar envío gratis observado entre varios vendedores",
    REVIEW_RETURNS_ACCEPTED_COMMON_PATTERN: "Revisar política de devoluciones común",
    REVIEW_MULTI_IMAGE_COMMON_PATTERN: "Revisar si conviene ampliar el set de imágenes",
    REVIEW_MARKET_PRICE_POSITION: "Revisar posición del precio total frente al mercado",
    REVIEW_CONFIRMED_SOLD_PRICE_RECOMMENDATION: "Revisar precio propuesto con ventas exactas confirmadas y piso económico propio",
    REVIEW_CROSS_SELLER_TERMS: "Revisar términos repetidos y confirmados por el producto Luna",
  }
  return labels[code] ?? code.replaceAll("_", " ").toLocaleLowerCase("es")
}

function AnalyticsWindowAudit({ label, audit }: { label: string; audit?: AnalyticsAudit | null }) {
  const row = audit?.metrics?.[0]
  const metric = (input: number | null | undefined, suffix = "") =>
    formatSingleProductLabMetric(input, { suffix })
  return <article className="rounded-2xl border border-white/10 bg-black/20 p-3">
    <h4 className="font-black text-cyan-50">{label}</h4>
    <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
      <div><span className="text-white/45">Impresiones</span><strong className="mt-1 block">{metric(row?.impressions)}</strong></div>
      <div><span className="text-white/45">Vistas</span><strong className="mt-1 block">{metric(row?.views)}</strong></div>
      <div><span className="text-white/45">Transacciones</span><strong className="mt-1 block">{metric(row?.transactions)}</strong></div>
      <div><span className="text-white/45">CTR</span><strong className="mt-1 block">{metric(row?.ctr, "%")}</strong></div>
    </div>
    <dl className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2">
      <div><dt className="text-white/45">requestedListingIds</dt><dd className="break-all font-mono">{list(audit?.requestedListingIds)}</dd></div>
      <div><dt className="text-white/45">returnedListingDimensions</dt><dd className="break-all font-mono">{list(audit?.returnedListingDimensions)}</dd></div>
      <div><dt className="text-white/45">matchedListingIds</dt><dd className="break-all font-mono">{list(audit?.matchedListingIds)}</dd></div>
      <div><dt className="text-white/45">unmatchedRequestedListingIds</dt><dd className="break-all font-mono">{list(audit?.unmatchedRequestedListingIds)}</dd></div>
      <div><dt className="text-white/45">unexpectedDimensions</dt><dd className="break-all font-mono">{list(audit?.unexpectedDimensions)}</dd></div>
      <div><dt className="text-white/45">queryDimension</dt><dd className="font-black">{audit?.queryDimension ?? "—"}</dd></div>
      <div><dt className="text-white/45">queryTimeZone</dt><dd className="font-black">{audit?.queryTimeZone ?? "—"}</dd></div>
      <div><dt className="text-white/45">windowStart / windowEnd</dt><dd>{audit?.windowStart ?? "—"} / {audit?.windowEnd ?? "—"}</dd></div>
      <div><dt className="text-white/45">reportStartDate / reportEndDate</dt><dd>{audit?.reportStartDate ?? "—"} / {audit?.reportEndDate ?? "—"}</dd></div>
      <div><dt className="text-white/45">lastUpdatedDate</dt><dd>{audit?.lastUpdatedDate ?? "—"}</dd></div>
      <div><dt className="text-white/45">completenessStatus</dt><dd className="font-black uppercase">{audit?.completenessStatus ?? "—"}</dd></div>
      <div><dt className="text-white/45">dataFreshnessStatus</dt><dd className="font-black uppercase">{audit?.dataFreshnessStatus ?? "—"}</dd></div>
      <div><dt className="text-white/45">warnings</dt><dd>{list(audit?.warnings)}</dd></div>
    </dl>
  </article>
}

function OptimizationTaskCard({ task, applying, onApply }: {
  task: NonNullable<Dashboard["optimizationTasks"]>[number]
  applying: boolean
  onApply: (eventId: string) => void
}) {
  const evidence = task.evidence
  const experiment = evidence?.experiment
  const promotion = evidence?.promotionRecommendation
  const listingAgeEvidence = evidence?.listingAgeEvidence
  const officialListingStart = listingAgeEvidence?.source ===
    "EBAY_OFFICIAL_START_TIME"
  const critical = task.severity === "critical" || task.severity === "high"
  return <article className={`min-w-0 rounded-xl border p-3 ${critical ? "border-rose-200/30 bg-rose-200/[0.06]" : "border-amber-100/20 bg-black/20"}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h4 className={`break-words font-black ${critical ? "text-rose-50" : "text-amber-50"}`}>
          {evidence?.notificationTitle ?? "Este listing necesita optimización"}
        </h4>
        <p className="mt-1 break-words text-[11px] text-white/45">SKU {task.sku ?? "pendiente"} · Detectado {formatDate(task.detectedAt)}</p>
      </div>
      <span className="rounded-full border border-white/15 px-2 py-1 text-[10px] font-black uppercase text-white/70">esperando tu aprobación</span>
    </div>
    {listingAgeEvidence && <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-white/70">Inicio usado: {formatDate(listingAgeEvidence.startedAt)} · {typeof listingAgeEvidence.ageHours === "number" ? `${listingAgeEvidence.ageHours} h evaluadas` : "edad pendiente"}</p>
        <span className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase ${officialListingStart ? "border-emerald-200/25 text-emerald-100" : "border-amber-200/25 text-amber-100"}`}>{officialListingStart ? "FUENTE EBAY" : "ESTIMACIÓN CONSERVADORA"}</span>
      </div>
      <p className="mt-1 text-[11px] leading-5 text-white/50">{listingAgeEvidence.explanation ?? (officialListingStart ? "Fecha oficial de inicio informada por eBay." : "Edad mínima desde el registro en Seller OS; el listing puede ser más antiguo.")}</p>
    </div>}
    <p className="mt-3 break-words text-sm leading-6 text-white/75"><strong>Por qué:</strong> {evidence?.whyItNeedsAttention ?? "Seller OS detectó una excepción con evidencia propia."}</p>
    <p className="mt-2 break-words text-sm leading-6 text-cyan-50"><strong>Siguiente revisión:</strong> {task.recommendedAction}</p>
    {(evidence?.reviewSequence?.length ?? 0) > 0 && <p className="mt-2 break-words text-xs text-white/50">Orden recomendado: {evidence?.reviewSequence?.join(" → ")}</p>}
    {experiment && <details className="mt-3 rounded-xl border border-cyan-100/20 bg-cyan-100/[0.05] p-3">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-black text-cyan-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Ver propuesta de una sola variable</summary>
      <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-cyan-100/60">Experimento propuesto · una sola variable</p>
      <p className="mt-1 text-sm font-black text-cyan-50">{experiment.variable ?? "REVISIÓN"}</p>
      <p className="mt-1 break-words text-xs leading-5 text-white/65">{experiment.proposal}</p>
      <p className="mt-2 break-words text-[11px] text-white/45">{experiment.measurementPlan}</p>
      <p className="mt-2 text-[11px] font-bold text-amber-100">Requiere aprobación humana. No prueba causalidad y no se aplicó ningún cambio.</p>
    </details>}
    {promotion && <div className={`mt-3 rounded-xl border p-3 ${promotion.status === "READY_FOR_HUMAN_APPROVAL" ? "border-emerald-200/30 bg-emerald-200/[0.07]" : "border-white/10 bg-black/20"}`}>
      <p className="text-xs font-black uppercase tracking-widest text-white/60">Promoción</p>
      <p className="mt-1 text-sm font-black text-white">{formatSingleProductLabMetric(promotion.recommendedRatePercent, { suffix: "%" })}{promotion.durationDays ? ` · ${promotion.durationDays} días` : " · no recomendada"}</p>
      <p className="mt-1 text-xs leading-5 text-white/60">{promotion.reason}</p>
      {promotion.status === "READY_FOR_HUMAN_APPROVAL" && <p className="mt-2 text-xs font-bold text-amber-100">Recomendación visible para revisión humana; su aplicación está bloqueada durante el piloto.</p>}
      {promotion.status === "READY_FOR_HUMAN_APPROVAL" && task.id && <button type="button" disabled onClick={() => onApply(task.id!)} className="mt-3 min-h-12 w-full rounded-xl bg-emerald-200 px-3 font-black text-black disabled:opacity-40">{applying ? "BLOQUEADO EN PILOT MODE" : "REVISAR Y AUTORIZAR PROMOCIÓN 5% — BLOQUEADO EN PILOT MODE"}</button>}
      {promotion.status === "BLOCKED_CONTROLLED_RISK" && <p className="mt-2 text-xs font-black text-amber-100">No hay margen para aplicar promoción.</p>}
    </div>}
  </article>
}

export function CommercialMonitorPanel() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [busyMode, setBusyMode] = useState<"luna" | "dry_run" | "persistent" | "comparison" | "scheduler" | null>(null)
  const [dryRunResult, setDryRunResult] = useState<MonitorRun | null>(null)
  const [comparison, setComparison] = useState<SellerHubComparison | null>(null)
  const [gateNow, setGateNow] = useState(0)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [improvementBusyId, setImprovementBusyId] = useState<string | null>(null)
  const [requestedImprovementId, setRequestedImprovementId] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("section") !== "commercial-monitor") return
    setRequestedImprovementId(params.get("improvement"))
  }, [])

  async function applyImprovement(eventId: string) {
    if (improvementBusyId) return
    setImprovementBusyId(eventId)
    setError("")
    setMessage("Preparando evidencia y comprobaciones de seguridad…")
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !data.session) throw new Error("AUTH_REQUIRED")
      const storageKey = `seller-os-commercial-improvement:${eventId}`
      const existing = window.sessionStorage.getItem(storageKey)
      const idempotencyKey = existing ?? `commercial-improvement-${crypto.randomUUID()}`
      window.sessionStorage.setItem(storageKey, idempotencyKey)
      const call = async (action: "prepare_improvement" | "apply_improvement", confirmation?: string) => {
        const response = await fetch("/api/admin/ebay/commercial-monitor", {
          method: "POST",
          cache: "no-store",
          headers: { Authorization: `Bearer ${data.session.access_token}`,
            "Content-Type": "application/json" },
          body: JSON.stringify({ action, eventId, idempotencyKey, confirmation }),
        })
        const payload = await readMobileReviewJson<Payload>(response,
          "No se pudo procesar la mejora comercial")
        if (!payload.success || !payload.improvement) {
          throw new Error(getMobileReviewPayloadError(payload,
            "COMMERCIAL_IMPROVEMENT_REQUEST_FAILED"))
        }
        return payload.improvement
      }
      const preview = await call("prepare_improvement")
      const label = preview.actionType === "PRICE"
        ? "el nuevo precio verificado"
        : preview.actionType === "END_LISTING"
          ? "el retiro del listing porque Luna confirmó stock cero"
          : "Promoted Listings General al 5% durante 7 días"
      if (!window.confirm(`Seller OS aplicará ${label} al listing ${preview.listingId}. Se verificará identidad, stock, costo y economía antes de escribir en eBay. ¿Deseas autorizarlo?`)) {
        setMessage("Mejora no autorizada; eBay no fue modificado.")
        return
      }
      const applied = await call("apply_improvement", preview.confirmationRequired)
      if (!applied.appliedVerified) {
        throw new Error(applied.phase === "outcome_unknown"
          ? "COMMERCIAL_IMPROVEMENT_OUTCOME_UNKNOWN"
          : "COMMERCIAL_IMPROVEMENT_NOT_VERIFIED")
      }
      setMessage("Mejora aplicada desde Seller OS y confirmada por lectura posterior de eBay.")
      await load()
    } catch (requestError) {
      setError(getMobileReviewRequestError(requestError,
        "No se pudo aplicar la mejora. Seller OS no la marcará como completada sin verificación de eBay."))
    } finally {
      setImprovementBusyId(null)
    }
  }

  const request = useCallback(async (
    mode?: "dry_run" | "persistent",
    authorizedDryRunId?: string,
  ) => {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !data.session) throw new Error("AUTH_REQUIRED")
    const response = await fetch("/api/admin/ebay/commercial-monitor", {
      method: mode ? "POST" : "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        ...(mode ? { "Content-Type": "application/json" } : {}),
      },
      body: mode
        ? JSON.stringify(buildCommercialMonitorRunRequest(
            mode === "dry_run",
            authorizedDryRunId,
          ))
        : undefined,
    })
    const payload = await readMobileReviewJson<Payload>(
      response,
      "No se pudo consultar el monitor comercial",
    )
    if (!payload.success || !payload.dashboard) {
      throw new Error(getMobileReviewPayloadError(payload, "COMMERCIAL_MONITOR_REQUEST_FAILED"))
    }
    return payload
  }, [])

  const compareWithSellerHub = useCallback(async () => {
    if (busyMode) return
    setBusyMode("comparison")
    setError("")
    setMessage("Comparando evidencia manual explícita con ventanas oficiales read-only…")
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !data.session) throw new Error("AUTH_REQUIRED")
      const divergence = dashboard?.analyticsSourceDivergence
      const manualMetrics = divergence?.manualSource?.metrics
      const evidence =
        typeof manualMetrics?.impressions === "number" &&
        Number.isFinite(manualMetrics.impressions) &&
        typeof manualMetrics.views === "number" &&
        Number.isFinite(manualMetrics.views) &&
        typeof manualMetrics.transactions === "number" &&
        Number.isFinite(manualMetrics.transactions) &&
        typeof manualMetrics.ctr === "number" &&
        Number.isFinite(manualMetrics.ctr)
          ? {
              impressions: manualMetrics.impressions,
              views: manualMetrics.views,
              transactions: manualMetrics.transactions,
              ctr: manualMetrics.ctr,
              scope: "LISTING",
            }
          : undefined
      const response = await fetch("/api/admin/ebay/commercial-monitor", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "compare_seller_hub",
          listingId: divergence?.listingId ??
            dashboard?.listingIdentity?.listingId,
          evidence,
        }),
      })
      const payload = await readMobileReviewJson<Payload>(
        response,
        "No se pudo comparar Analytics con Seller Hub",
      )
      if (!payload.success || !payload.comparison) {
        throw new Error(getMobileReviewPayloadError(payload, "EBAY_ANALYTICS_COMPARISON_FAILED"))
      }
      setComparison(payload.comparison)
      setMessage(payload.comparison.explanation ?? "Comparación read-only completada.")
    } catch (requestError) {
      setError(getMobileReviewRequestError(
        requestError,
        "No se pudo completar la comparación oficial.",
      ))
    } finally {
      setBusyMode(null)
    }
  }, [busyMode, dashboard])

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const payload = await request()
      setDashboard(payload.dashboard ?? null)
    } catch (requestError) {
      setError(getMobileReviewRequestError(
        requestError,
        "No se pudo cargar el estado comercial.",
      ))
    } finally {
      setLoading(false)
    }
  }, [request])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    setGateNow(Date.now())
    const interval = window.setInterval(() => setGateNow(Date.now()), 15_000)
    return () => window.clearInterval(interval)
  }, [])

  async function refreshLunaEvidence() {
    if (busyMode) return
    setBusyMode("luna")
    setError("")
    setMessage("Actualizando catálogo, stock y precios desde Luna…")
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !data.session) throw new Error("AUTH_REQUIRED")
      const response = await fetch("/api/admin/market-radar", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "sync_lunaportex" }),
      })
      const payload = await readMobileReviewJson<Payload>(
        response,
        "No se pudo actualizar la evidencia Luna",
      )
      if (!payload.success) {
        throw new Error(getMobileReviewPayloadError(
          payload,
          "MARKET_RADAR_SYNC_FAILED",
        ))
      }
      await load()
      setMessage("Evidencia Luna actualizada. Ejecuta ahora el dry run comercial.")
    } catch (requestError) {
      setError(getMobileReviewRequestError(
        requestError,
        "No se pudo actualizar la evidencia Luna.",
      ))
    } finally {
      setBusyMode(null)
    }
  }

  async function executeDryRun() {
    if (busyMode) return
    setDryRunResult(null)
    setBusyMode("dry_run")
    setError("")
    setMessage("Ejecutando lectura segura sin persistencia comercial…")
    try {
      const payload = await request("dry_run")
      setDashboard(payload.dashboard ?? null)
      setDryRunResult(payload.run ?? null)
      setMessage(payload.run?.status === "already_running"
        ? "Ya existe una ejecución en curso para esta cuenta."
        : payload.run?.nextAction ?? "Dry run completado.")
    } catch (requestError) {
      setError(getMobileReviewRequestError(
        requestError,
        "No se pudo completar el dry run.",
      ))
      await load().catch(() => undefined)
    } finally {
      setBusyMode(null)
    }
  }

  async function updatePerformance() {
    if (busyMode || !isSatisfactoryCommercialDryRun(displayedDryRun)) return
    const confirmed = window.confirm(
      "Esta acción guardará snapshots y eventos comerciales y podría entregar una alerta pendiente por WhatsApp en Preview. ¿Continuar?",
    )
    if (!confirmed) return
    setBusyMode("persistent")
    setError("")
    setMessage("Guardando la actualización comercial confirmada…")
    try {
      const dryRunId = displayedDryRun?.runId ?? displayedDryRun?.id
      if (!dryRunId) throw new Error("COMMERCIAL_DRY_RUN_GATE_REQUIRED")
      const payload = await request("persistent", dryRunId)
      setDashboard(payload.dashboard ?? null)
      setDryRunResult(null)
      setMessage(payload.run?.status === "already_running"
        ? "Ya existe una actualización en curso para esta cuenta."
        : payload.run?.nextAction ?? "Rendimiento actualizado.")
    } catch (requestError) {
      setError(getMobileReviewRequestError(
        requestError,
        "No se pudo completar la actualización comercial.",
      ))
      await load().catch(() => undefined)
    } finally {
      setBusyMode(null)
    }
  }

  async function updateSchedulerAuthorization(action: "authorize_scheduler" | "revoke_scheduler") {
    if (busyMode) return
    const dryRunId = displayedDryRun?.runId ?? displayedDryRun?.id
    if (action === "authorize_scheduler" && (!dryRunSatisfactory || !dryRunId)) return
    const confirmed = window.confirm(action === "authorize_scheduler"
      ? "Autorizar el monitor automático únicamente en Preview durante 60 minutos. Seguirá siendo de lectura en eBay y respetará las pausas de cuota. ¿Continuar?"
      : "Pausar ahora el monitor automático de Preview. ¿Continuar?")
    if (!confirmed) return

    setBusyMode("scheduler")
    setError("")
    setMessage(action === "authorize_scheduler"
      ? "Registrando autorización temporal y auditable…"
      : "Pausando el monitor automático…")
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !data.session) throw new Error("AUTH_REQUIRED")
      const response = await fetch("/api/admin/ebay/commercial-monitor", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          confirmed: true,
          ...(action === "authorize_scheduler"
            ? { dryRunId, durationMinutes: 60 }
            : {}),
        }),
      })
      const payload = await readMobileReviewJson<Payload>(
        response,
        action === "authorize_scheduler"
          ? "No se pudo autorizar el monitor"
          : "No se pudo pausar el monitor",
      )
      if (!payload.success || !payload.dashboard) {
        throw new Error(getMobileReviewPayloadError(payload, "COMMERCIAL_MONITOR_SCHEDULER_CONTROL_FAILED"))
      }
      setDashboard(payload.dashboard)
      setMessage(action === "authorize_scheduler"
        ? "Monitor Preview autorizado por 60 minutos. Se detendrá al vencer la autorización."
        : "Monitor automático de Preview pausado.")
    } catch (requestError) {
      setError(getMobileReviewRequestError(
        requestError,
        action === "authorize_scheduler"
          ? "No se pudo autorizar el monitor."
          : "No se pudo pausar el monitor.",
      ))
      await load().catch(() => undefined)
    } finally {
      setBusyMode(null)
    }
  }

  const run = dashboard?.lastPersistentRun ??
    (dashboard?.latestRun?.metrics?.dryRun === true ? null : dashboard?.latestRun)
  const metrics = run?.metrics
  const analytics = metrics?.analytics
  const health = dashboard?.health
  const divergence = dashboard?.analyticsSourceDivergence
  const analyticsDivergenceOpen = divergence?.status === "open" &&
    divergence.healthFlag === "ANALYTICS_SOURCE_DIVERGENCE"
  const manualEvidenceNotComparable =
    divergence?.classification === "MANUAL_EVIDENCE_NOT_COMPARABLE"
  const listingIdentity = dashboard?.listingIdentity
  const readers: Record<string, CommercialMonitorReaderView> = run?.readers ?? {}
  const verifiedNewSales = readers.orders?.status === "available"
    ? metrics?.newSales
    : null
  const displayedDryRun = dryRunResult ?? dashboard?.lastDryRun ??
    (dashboard?.latestRun?.metrics?.dryRun === true ? dashboard.latestRun : null)
  const dryRunMetrics = displayedDryRun?.metrics
  const dryRunReaders: Record<string, CommercialMonitorReaderView> = displayedDryRun?.readers ?? {}
  const dryRunAuthentication = dryRunMetrics?.authentication
  const dryRunSatisfactory = gateNow > 0
    && isSatisfactoryCommercialDryRun(displayedDryRun, gateNow)
  const dryRunConsumedAt = displayedDryRun?.consumedAt ?? displayedDryRun?.dry_run_consumed_at
  const dryRunWasSatisfactory = displayedDryRun?.satisfactory === true ||
    displayedDryRun?.dry_run_satisfactory === true || dryRunSatisfactory || Boolean(dryRunConsumedAt)
  const schedulerAuthorized = dashboard?.schedulerAuthorization?.status === "ACTIVE"
  const dryRunValue = (input: unknown) =>
    displayedDryRun ? value(input) : SINGLE_PRODUCT_LAB_UNAVAILABLE
  const optimizationTasks = dashboard?.optimizationTasks ?? []
  const primaryOptimizationTask = optimizationTasks[0]
  const additionalOptimizationTasks = optimizationTasks.slice(1, 5)
  const competitorProfiles = dashboard?.competitorWatch?.profiles ?? []
  const competitorPriceRecommendations =
    dashboard?.competitorWatch?.priceRecommendations ?? []
  const supplyActions = dashboard?.supplyActions ?? []
  const researchRefreshProfiles = competitorProfiles.filter((profile) =>
    profile.research_refresh_recommended)

  useEffect(() => {
    if (loading || !requestedImprovementId) return
    const target = document.getElementById(
      `commercial-improvement-${requestedImprovementId}`,
    ) ?? document.getElementById("competitor-watch-heading")
    if (!target) return
    const timer = window.setTimeout(() => {
      target.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      })
      target.focus({ preventScroll: true })
    }, 50)
    return () => window.clearTimeout(timer)
  }, [loading, requestedImprovementId, competitorPriceRecommendations,
    supplyActions])

  return (
    <section aria-labelledby="commercial-monitor-heading" className="min-w-0 overflow-hidden rounded-3xl border border-emerald-200/25 bg-gradient-to-br from-emerald-200/[0.10] via-cyan-200/[0.04] to-black p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-emerald-100/65">Monitoreo comercial · separado de Radar</p>
          <h2 id="commercial-monitor-heading" className="mt-2 text-2xl font-black">Ventas y rendimiento</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/65">Lee Luna, listings activos, órdenes, Analytics y Watchers. Durante el piloto no ejecuta scans, persistencia comercial, WhatsApp, publicación, precio, imágenes ni otras acciones automáticas.</p>
        </div>
        <span className={`rounded-full border border-white/15 px-3 py-2 text-xs font-black uppercase ${statusTone(run?.status)}`}>
          {loading ? "cargando" : run?.status ?? dashboard?.status ?? "sin ejecutar"}
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          disabled
          onClick={() => void refreshLunaEvidence()}
          className="min-h-14 rounded-2xl border border-amber-200/35 bg-amber-200/[0.08] px-4 font-black text-amber-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100 disabled:opacity-50"
        >
          Luna read-only · sync automático bloqueado
        </button>
        <button
          type="button"
          disabled={Boolean(busyMode) || loading}
          onClick={() => void executeDryRun()}
          className="min-h-14 rounded-2xl bg-cyan-200 px-4 font-black text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-100 disabled:opacity-50"
        >
          {busyMode === "dry_run" ? "Ejecutando dry run…" : "Ejecutar dry run"}
        </button>
        <button
          type="button"
          disabled
          onClick={() => void updatePerformance()}
          aria-describedby="persistent-update-gate"
          className="min-h-14 rounded-2xl border border-emerald-200/35 bg-emerald-200/[0.08] px-4 font-black text-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-100 disabled:cursor-not-allowed disabled:opacity-35"
        >
          BLOQUEADO EN PILOT MODE
        </button>
      </div>
      <p id="persistent-update-gate" className="mt-2 text-xs leading-5 text-white/55">
        La actualización persistente, las alertas y todas las acciones automáticas
        permanecen bloqueadas por SINGLE_PRODUCT_LAB.
      </p>

      <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-black text-white">Automatización de Preview</p>
            <p className="mt-1 text-xs leading-5 text-white/55">
              {schedulerAuthorized
                ? "Existe una autorización previa. Sólo puedes revocarla; el runner está bloqueado."
                : "No se puede autorizar automatización durante el piloto."}
            </p>
          </div>
          <button
            type="button"
            disabled={Boolean(busyMode) || loading || !schedulerAuthorized}
            onClick={() => void updateSchedulerAuthorization(
              schedulerAuthorized ? "revoke_scheduler" : "authorize_scheduler",
            )}
            className={`min-h-11 shrink-0 rounded-xl border px-4 text-sm font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-35 ${schedulerAuthorized ? "border-rose-200/35 bg-rose-200/[0.08] text-rose-50 focus-visible:outline-rose-100" : "border-cyan-200/35 bg-cyan-200/[0.08] text-cyan-50 focus-visible:outline-cyan-100"}`}
          >
            {busyMode === "scheduler"
              ? "Procesando…"
              : schedulerAuthorized
                ? "Pausar monitor"
                : "BLOQUEADO EN PILOT MODE"}
          </button>
        </div>
      </div>

      <details data-technical-details="dry-run" className="mt-4 rounded-2xl border border-cyan-200/25 bg-cyan-200/[0.06] p-3">
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">
          <span><span className="block text-[10px] uppercase tracking-widest text-cyan-100/60">Ver detalles técnicos</span><span className="text-lg text-cyan-50">DRY RUN</span></span>
          <span className={`rounded-full border border-white/15 px-3 py-1 text-[10px] font-black uppercase ${dryRunSatisfactory ? "text-emerald-100" : "text-white/55"}`}>
            {displayedDryRun
              ? dryRunConsumedAt
                ? "consumido"
                : dryRunSatisfactory
                  ? "satisfactorio"
                  : displayedDryRun.status ?? "requiere revisión"
              : "sin ejecutar"}
          </span>
        </summary>
        <div className="min-w-0">

        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-xl border border-white/10 p-2"><dt className="text-white/45">Status</dt><dd className="mt-1 font-black uppercase">{displayedDryRun?.status ?? "sin ejecutar"}</dd></div>
          <div className="rounded-xl border border-white/10 p-2"><dt className="text-white/45">Completed at</dt><dd className="mt-1 font-black">{formatDate(displayedDryRun?.completedAt ?? displayedDryRun?.completed_at)}</dd></div>
          <div className="rounded-xl border border-white/10 p-2"><dt className="text-white/45">Satisfactory</dt><dd className="mt-1 font-black">{displayedDryRun ? (dryRunWasSatisfactory ? "SÍ" : "NO") : "—"}</dd></div>
          <div className="rounded-xl border border-white/10 p-2"><dt className="text-white/45">Consumed at</dt><dd className="mt-1 font-black">{dryRunConsumedAt ? formatDate(dryRunConsumedAt) : "—"}</dd></div>
          <div className="rounded-xl border border-white/10 p-2 sm:col-span-4"><dt className="text-white/45">Authorized persistent run ID</dt><dd className="mt-1 break-all font-mono text-[11px]">{displayedDryRun?.authorizedPersistentRunId ?? displayedDryRun?.authorized_persistent_run_id ?? "—"}</dd></div>
        </dl>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Órdenes leídas</span><strong className="mt-1 block text-lg">{dryRunValue(dryRunMetrics?.officialOrdersRead)}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Line items leídos</span><strong className="mt-1 block text-lg">{dryRunValue(dryRunMetrics?.completedCheckoutLineItems)}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Mensajes pendientes</span><strong className="mt-1 block text-lg">{dryRunValue(dryRunMetrics?.sellerHubMessageHeadersRead)}</strong><span className="mt-1 block text-[10px] text-white/40">sólo encabezados seguros</span></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Listings Analytics</span><strong className="mt-1 block text-lg">{dryRunValue(dryRunMetrics?.analyticsListingsRead)}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Listings Watchers</span><strong className="mt-1 block text-lg">{dryRunValue(dryRunMetrics?.watcherListingsRead)}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Listings competencia</span><strong className="mt-1 block text-lg">{dryRunValue(dryRunMetrics?.competitorListingsRead)}</strong><span className="mt-1 block text-[10px] text-white/40">lectura activa, no ventas</span></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Persistencia comercial</span><strong className="mt-1 block text-lg">{dryRunMetrics?.commercialDataPersistencePerformed === false ? "NO" : "—"}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Alertas encoladas</span><strong className="mt-1 block text-lg">{dryRunValue(dryRunMetrics?.alertsEnqueued)}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Tareas de fulfillment creadas</span><strong className="mt-1 block text-lg">{dryRunValue(dryRunMetrics?.fulfillmentTasksCreated)}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">WhatsApp META_ACCEPTED</span><strong className="mt-1 block text-lg">{dryRunValue(dryRunMetrics?.whatsappMetaAccepted)}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Escrituras eBay</span><strong className="mt-1 block text-lg">{dryRunValue(dryRunMetrics?.ebayWrites)}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Última ejecución</span><strong className="mt-1 block text-xs">{formatDate(displayedDryRun?.completedAt ?? displayedDryRun?.completed_at)}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Vínculo Luna exacto</span><strong className="mt-1 block text-lg">{dryRunMetrics?.lunaExactSupplyLinked === true ? "SÍ" : "NO"}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Snapshot Luna fresco</span><strong className="mt-1 block text-lg">{dryRunMetrics?.lunaSupplyFresh === true ? "SÍ" : "NO"}</strong><span className="mt-1 block text-[10px] text-white/40">{formatDate(dryRunMetrics?.lunaSupplyObservedAt)}</span></div>
        </div>

        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
          {(["orders", "messages", "analytics", "watchers", "competitors"] as const).map((name) => {
            const recordedError = displayedDryRun?.errors?.find((item) => item.reader === name)?.code
            const readerError = dryRunReaders[name]?.error ?? recordedError
            return <div key={`dry-${name}`} className="rounded-xl border border-white/10 p-2">
              <span className="font-black uppercase text-white/45">{name === "orders" ? "Orders" : name === "messages" ? "Mensajes" : name === "analytics" ? "Analytics" : name === "watchers" ? "Watchers" : "Competencia"}</span>
              <span className={`mt-1 block break-words font-bold ${readerError ? "text-rose-100" : "text-emerald-100"}`}>
                {readerError ?? (displayedDryRun ? "Sin errores" : "Pendiente")}
              </span>
            </div>
          })}
        </div>

        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-5">
          <div className="rounded-xl border border-white/10 p-2">
            <dt className="text-white/45">Orders OAuth</dt>
            <dd className="mt-1 break-words font-black text-cyan-50">{authLabel(dryRunReaders.orders?.auth?.status ?? dryRunAuthentication?.ordersOAuth)}</dd>
          </div>
          <div className="rounded-xl border border-white/10 p-2">
            <dt className="text-white/45">Mensajes auth</dt>
            <dd className="mt-1 break-words font-black text-cyan-50">{authLabel(dryRunReaders.messages?.auth?.status ?? dryRunAuthentication?.messagesAuth)}</dd>
          </div>
          <div className="rounded-xl border border-white/10 p-2">
            <dt className="text-white/45">Watchers auth</dt>
            <dd className="mt-1 break-words font-black text-cyan-50">{authLabel(dryRunReaders.watchers?.auth?.status ?? dryRunAuthentication?.watchersAuth)}</dd>
          </div>
          <div className="rounded-xl border border-white/10 p-2">
            <dt className="text-white/45">Analytics auth</dt>
            <dd className="mt-1 break-words font-black text-cyan-50">{authLabel(dryRunReaders.analytics?.auth?.status ?? dryRunAuthentication?.analyticsAuth)}</dd>
          </div>
          <div className="rounded-xl border border-white/10 p-2">
            <dt className="text-white/45">Scope fulfillment confirmado</dt>
            <dd className="mt-1 font-black text-cyan-50">{dryRunAuthentication ? (dryRunAuthentication.fulfillmentScopeConfirmed ? "SÍ" : "NO") : "PENDIENTE"}</dd>
          </div>
          <div className="rounded-xl border border-white/10 p-2">
            <dt className="text-white/45">Identidad oficial</dt>
            <dd className="mt-1 font-black text-cyan-50">{dryRunAuthentication?.officialIdentityMatch === true ? "MATCH" : dryRunAuthentication?.officialIdentityMatch === false ? "NO MATCH" : "PENDIENTE"}</dd>
          </div>
        </dl>

        <div className="mt-3 rounded-xl bg-black/25 p-3 text-sm">
          <span className="text-white/45">Próxima acción</span>
          <p className="mt-1 font-bold text-cyan-50">{dryRunAuthentication?.actionRequired ?? displayedDryRun?.nextAction ?? displayedDryRun?.next_action ?? "Ejecutar el dry run seguro."}</p>
        </div>
        </div>
      </details>

      <details data-technical-details="persistent-run" className="mt-4 rounded-2xl border border-emerald-200/25 bg-emerald-200/[0.06] p-3">
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-200">
          <span><span className="block text-[10px] uppercase tracking-widest text-emerald-100/60">Última actualización persistente · ver detalles técnicos</span><span className="text-lg text-emerald-50">Última actualización: {run ? (run.status === "completed" ? "COMPLETADA" : run.status?.toUpperCase()) : "PENDIENTE"}</span></span>
          {dryRunConsumedAt && <span className="rounded-full border border-white/15 px-3 py-1 text-[10px] font-black uppercase text-cyan-100">Dry run anterior: CONSUMIDO</span>}
        </summary>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/45">Completed at</dt><dd className="mt-1 font-black">{formatDate(run?.completedAt ?? run?.completed_at)}</dd></div>
          <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/45">Snapshots creados</dt><dd className="mt-1 text-lg font-black">{value(metrics?.snapshotsCreated)}</dd></div>
          <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/45">Eventos creados</dt><dd className="mt-1 text-lg font-black">{value(metrics?.eventsCreated)}</dd></div>
          <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/45">Alertas generadas</dt><dd className="mt-1 text-lg font-black">{value(metrics?.alertsGenerated)}</dd></div>
          <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/45">WhatsApp META_ACCEPTED</dt><dd className="mt-1 text-lg font-black">{value(metrics?.whatsappMetaAccepted)}</dd><span className="mt-1 block text-[10px] text-white/40">Aceptado por Meta; entrega final requiere webhook.</span></div>
          <div className="rounded-xl bg-black/25 p-2 sm:col-span-3"><dt className="text-white/45">Próxima acción</dt><dd className="mt-1 font-black text-emerald-50">{run?.nextAction ?? run?.next_action ?? "Ejecuta un dry run nuevo antes de otra actualización."}</dd></div>
        </dl>
        {run && dryRunConsumedAt && <p className="mt-3 text-xs font-bold text-cyan-50">Ejecuta un dry run nuevo antes de otra actualización.</p>}
      </details>

      <section aria-labelledby="luna-action-queue-heading" className="mt-4 rounded-2xl border border-cyan-200/30 bg-cyan-200/[0.06] p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-cyan-100/60">Luna Portex → acción Seller OS</p>
            <h3 id="luna-action-queue-heading" className="text-lg font-black">Cambios de costo y stock</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-white/60">Seller OS vuelve a comprobar la variante exacta de Luna antes de preparar la acción. Precio: recalcula el piso económico. Stock cero: prepara el retiro del listing. Nada se escribe en eBay sin tu confirmación.</p>
          </div>
          <span className="rounded-full border border-cyan-100/25 px-3 py-1 text-xs font-black uppercase text-cyan-50">{supplyActions.length} pendientes</span>
        </div>
        {supplyActions.length === 0
          ? <p className="mt-3 rounded-xl bg-black/20 p-3 text-sm text-white/55">No hay cambios frescos de Luna que requieran una acción.</p>
          : <div className="mt-3 grid gap-3">
            {supplyActions.slice(0, 8).map((entry) => {
              const isOutOfStock = entry.eventType === "ACTIVE_LISTING_OUT_OF_STOCK"
              const previousCost = entry.evidence?.previousSupplierCost
              const currentCost = entry.evidence?.currentSupplierCost
              return <article
                key={entry.id}
                id={entry.id ? `commercial-improvement-${entry.id}` : undefined}
                tabIndex={entry.id === requestedImprovementId ? -1 : undefined}
                className={`scroll-mt-32 rounded-xl border bg-black/25 p-3 outline-none ${entry.id === requestedImprovementId ? "border-cyan-100 ring-2 ring-cyan-200" : "border-white/10"}`}
              >
                <p className="font-black text-white">Listing {entry.listingId} · SKU {entry.sku ?? "pendiente"}</p>
                <p className="mt-1 text-xs text-white/65">{isOutOfStock
                  ? "Luna confirmó disponibilidad cero; la acción propuesta es retirar el listing con razón NotAvailable."
                  : typeof previousCost === "number" && typeof currentCost === "number"
                    ? `Costo Luna: $${previousCost.toFixed(2)} → $${currentCost.toFixed(2)}. Requiere revisión humana; el repricing está bloqueado.`
                    : `Margen estimado: ${typeof entry.evidence?.estimatedMarginPercent === "number" ? `${entry.evidence.estimatedMarginPercent.toFixed(2)}%` : SINGLE_PRODUCT_LAB_UNAVAILABLE}. Requiere revisión humana; el repricing está bloqueado.`}</p>
                <p className="mt-2 text-xs font-bold text-cyan-50">{entry.recommendedAction}</p>
                <p className="mt-1 text-[10px] font-black uppercase text-amber-100">Revisión humana pendiente · ningún cambio automático permitido</p>
                {entry.id && <button type="button" disabled onClick={() => void applyImprovement(entry.id!)} className={`mt-3 min-h-12 w-full rounded-xl px-3 font-black text-black disabled:opacity-40 ${isOutOfStock ? "bg-rose-200" : "bg-cyan-200"}`}>BLOQUEADO EN PILOT MODE</button>}
              </article>
            })}
          </div>}
      </section>

      <section aria-labelledby="listing-optimization-tasks-heading" className="mt-4 rounded-2xl border border-amber-200/30 bg-amber-200/[0.06] p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-100/60">Diagnóstico post-publicación</p>
            <h3 id="listing-optimization-tasks-heading" className="text-lg font-black">Listings que necesitan atención</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-white/60">Seller OS avisa primero y explica la etapa del embudo. No cambia imágenes, títulos, precios, cantidad ni políticas automáticamente.</p>
          </div>
          <span className="rounded-full border border-amber-100/25 px-3 py-1 text-xs font-black uppercase text-amber-50">
            {optimizationTasks.length} detectadas
          </span>
        </div>
        {optimizationTasks.length === 0
          ? <p className="mt-3 rounded-xl bg-black/20 p-3 text-sm text-white/55">Aún no hay una muestra oficial suficiente que justifique una propuesta de optimización.</p>
          : <div className="mt-3 grid gap-3">
            {primaryOptimizationTask && <OptimizationTaskCard task={primaryOptimizationTask} applying={improvementBusyId === primaryOptimizationTask.id} onApply={(eventId) => void applyImprovement(eventId)} />}
            {additionalOptimizationTasks.length > 0 && <details className="rounded-xl border border-white/10 p-3">
              <summary className="flex min-h-11 cursor-pointer items-center font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Ver {additionalOptimizationTasks.length} diagnóstico(s) posterior(es)</summary>
              <div className="mt-3 grid gap-3">{additionalOptimizationTasks.map((task) => <OptimizationTaskCard key={task.id} task={task} applying={improvementBusyId === task.id} onApply={(eventId) => void applyImprovement(eventId)} />)}</div>
            </details>}
          </div>}
      </section>

      <details data-technical-details="seller-hub-comparison" className="mt-4 rounded-2xl border border-violet-200/25 bg-violet-200/[0.05] p-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-lg font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-200">Comparar con Seller Hub · diagnóstico opcional</summary>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-xs leading-5 text-white/55">Compara evidencia Seller Hub explícita contra ventanas oficiales del listing vinculado. Si falta Item ID o evidencia manual, responde MISSING / UNAVAILABLE; no inventa valores ni persiste efectos comerciales.</p>
          <button
            type="button"
            disabled={Boolean(busyMode) || loading}
            onClick={() => void compareWithSellerHub()}
            className="min-h-12 w-full rounded-2xl border border-violet-100/30 px-4 font-black text-violet-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-200 disabled:opacity-50 sm:w-auto"
          >
            {busyMode === "comparison" ? "Comparando…" : "Comparar con Seller Hub"}
          </button>
        </div>
        {comparison && <>
          <div className="mt-3 rounded-xl bg-black/25 p-3">
            <span className="text-[10px] font-black uppercase text-white/45">Clasificación</span>
            <p className="mt-1 text-lg font-black text-violet-50">{comparison.classification ?? "INSUFFICIENT_EVIDENCE"}</p>
            <p className="mt-1 text-xs leading-5 text-white/65">{comparison.explanation}</p>
            <p className="mt-2 text-xs text-white/50">CTR Seller Hub validado: {formatSingleProductLabMetric(comparison.sellerHubEvidence?.calculatedCtr, { suffix: "%" })}</p>
          </div>
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            <AnalyticsWindowAudit label="A · Ventana operativa · 7 días cerrados" audit={comparison.operational} />
            <AnalyticsWindowAudit label="B · Ventana diagnóstica · hasta 90 días" audit={comparison.comparison} />
            <AnalyticsWindowAudit label="C · Cuenta por día · sólo diagnóstico" audit={comparison.accountDiagnostic} />
          </div>
          <p className="mt-3 text-xs font-bold text-emerald-100">
            Persistencia: {comparison.safety?.persistencePerformed === false ? "NO" : "—"} · Alertas: {value(comparison.safety?.alertsGenerated)} · Fulfillment: {value(comparison.safety?.fulfillmentTasksCreated)} · WhatsApp: {value(comparison.safety?.whatsappDelivered)} · Escrituras eBay: {value(comparison.safety?.ebayWrites)}
          </p>
        </>}
      </details>

      <details data-technical-details="analytics-source-health" className="mt-4 rounded-2xl border border-amber-200/30 bg-amber-200/[0.06] p-3">
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-3 font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200">
          <span><span className="block text-[10px] uppercase tracking-widest text-amber-100/60">Ver salud de fuentes Analytics</span><span className="text-lg">{divergence?.healthFlag ?? "SIN DIVERGENCIA ABIERTA"}</span></span>
          <span className="rounded-full border border-amber-100/25 px-3 py-1 text-xs font-black uppercase">
            {divergence?.status ?? "clear"}
          </span>
        </summary>
        <div className="min-w-0">
        <p className="mt-2 text-xs text-white/60">{divergence?.classification ?? "Las fuentes no tienen una discrepancia registrada."}</p>
        {divergence && <>
          <p className={`mt-2 text-[11px] font-black uppercase ${analyticsDivergenceOpen ? "text-amber-100" : "text-emerald-100"}`}>{analyticsDivergenceOpen
            ? "Health flag: ANALYTICS_SOURCE_DIVERGENCE"
            : "Health flag: SIN DIVERGENCIA ABIERTA"}</p>
          {manualEvidenceNotComparable && <p className="mt-2 rounded-xl border border-emerald-200/25 bg-emerald-200/[0.07] p-3 text-xs leading-5 text-emerald-50">
            La observación manual es orgánica y no declara una ventana. El reporte oficial es total, por listing y con ventana UTC; se conservan ambos datos, pero no se comparan como si midieran lo mismo.
          </p>}
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <article className="rounded-xl bg-black/25 p-3">
              <h4 className="font-black text-amber-50">Seller Hub · evidencia manual separada</h4>
              <p className="mt-1 text-xs text-white/50">Fuente: {divergence.manualSource?.source ?? "—"} · Observada: {divergence.manualSource?.observedOn ?? "—"}</p>
              <p className="mt-1 text-[11px] text-white/45">Ventana: {divergence.manualSource?.windowStart && divergence.manualSource?.windowEnd
                ? `${divergence.manualSource.windowStart} → ${divergence.manualSource.windowEnd}`
                : "no declarada"} · zona horaria: {divergence.manualSource?.timeZone ?? "no declarada"}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div><span className="text-white/45">Organic impressions</span><strong className="block">{value(divergence.manualSource?.metrics?.impressions)}</strong></div>
                <div><span className="text-white/45">Organic listing views</span><strong className="block">{value(divergence.manualSource?.metrics?.views)}</strong></div>
                <div><span className="text-white/45">Quantity sold</span><strong className="block">{value(divergence.manualSource?.metrics?.transactions)}</strong></div>
                <div><span className="text-white/45">CTR</span><strong className="block">{formatSingleProductLabMetric(divergence.manualSource?.metrics?.ctr, { suffix: "%" })}</strong></div>
              </div>
            </article>
            <article className="rounded-xl bg-black/25 p-3">
              <h4 className="font-black text-cyan-50">Traffic API · fuente oficial</h4>
              <p className="mt-1 text-xs text-white/50">Fuente: {divergence.officialSource?.source ?? "—"} · Consultada: {formatDate(divergence.officialSource?.observedAt)}</p>
              <p className="mt-1 text-[11px] text-white/45">Ventana: {divergence.officialSource?.windowStart ?? "—"} → {divergence.officialSource?.windowEnd ?? "—"} · lastUpdated: {divergence.officialSource?.lastUpdatedDate ?? "—"}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div><span className="text-white/45">Total impressions</span><strong className="block">{value(divergence.officialSource?.metrics?.impressions)}</strong></div>
                <div><span className="text-white/45">Listing views total</span><strong className="block">{value(divergence.officialSource?.metrics?.views)}</strong></div>
                <div><span className="text-white/45">Transaction</span><strong className="block">{value(divergence.officialSource?.metrics?.transactions)}</strong></div>
                <div><span className="text-white/45">CTR</span><strong className="block">{formatSingleProductLabMetric(divergence.officialSource?.metrics?.ctr, { suffix: "%" })}</strong></div>
              </div>
            </article>
          </div>
          <p className={`mt-3 text-xs font-bold ${analyticsDivergenceOpen ? "text-amber-50" : "text-emerald-100"}`}>{analyticsDivergenceOpen
            ? `Reglas de impresiones, CTR y conversión: SUSPENDIDAS · Próxima reconciliación: ${formatDate(divergence.nextCheckAt)}`
            : "Reglas de impresiones, CTR y conversión: ACTIVAS con la fuente oficial completa."}</p>
          <p className="mt-1 text-xs text-emerald-100">Orders, Analytics, Watchers y stock Luna continúan read-only; fulfillment y WhatsApp están bloqueados.</p>
          <p className="mt-1 text-[11px] text-white/45">Evidencia manual usada como métrica API: {divergence.manualEvidenceUsedAsApiMetric === false ? "NO" : "—"}</p>
        </>}
        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
          <h4 className="font-black text-white">Vínculo oficial antes del scheduler</h4>
          <p className="mt-1">Item ID esperado/observado: {listingIdentity?.listingId ?? "MISSING"} / {listingIdentity?.observedListingId ?? "MISSING"}</p>
          <p>Custom label eBay esperado/observado: {listingIdentity?.expectedSku ?? "—"} / {listingIdentity?.observedSku ?? "—"}</p>
          <p>SKU Luna/Seller OS: {listingIdentity?.supplierSku ?? divergence?.sku ?? "MISSING"}</p>
          <p>Estado oficial: {listingIdentity?.observedListingStatus ?? "—"} · Match exacto: {listingIdentity?.activeListingConfirmed ? "SÍ" : "NO"}</p>
          <p className="mt-1 font-black">Procesamiento de ventas: {listingIdentity?.salesProcessingBlocked ? "BLOQUEADO" : "HABILITADO"}</p>
        </div>
        </div>
      </details>

      <section aria-labelledby="competitor-watch-heading" className="mt-4 rounded-2xl border border-violet-200/25 bg-violet-200/[0.06] p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-violet-100/60">Monitoreo read-only por listing</p>
            <h3 id="competitor-watch-heading" className="mt-1 text-lg font-black text-violet-50">Competidores y Product Research</h3>
          </div>
          <span className="rounded-full border border-violet-100/20 px-2 py-1 text-[10px] font-black uppercase text-violet-100">
            {dashboard?.competitorWatch?.status === "ACTIVE" ? "activo" : "esperando línea base"}
          </span>
        </div>
        <p className="mt-2 text-xs leading-5 text-white/60">Los vendedores activos se descubren desde eBay sin importar otra tabla. Una oferta activa no se cuenta como venta; la venta sólo pasa a confirmada cuando coincide con una captura oficial de Product Research.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Listings cubiertos</span><strong className="mt-1 block text-lg">{competitorProfiles.length}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Vendedores activos</span><strong className="mt-1 block text-lg">{value(knownSum(competitorProfiles.map((profile) => profile.latest_active_seller_count)))}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Con actividad estimada</span><strong className="mt-1 block text-lg">{value(knownSum(competitorProfiles.map((profile) => profile.latest_estimated_activity_seller_count)))}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Venta confirmada</span><strong className="mt-1 block text-lg">{value(knownSum(competitorProfiles.map((profile) => profile.latest_confirmed_sold_seller_count)))}</strong></div>
        </div>
        {competitorPriceRecommendations.length > 0 && <div className="mt-3 rounded-xl border border-emerald-200/30 bg-emerald-200/[0.08] p-3">
          <p className="font-black text-emerald-50">Recomendaciones de precio con piso económico</p>
          <div className="mt-2 grid gap-2">
            {competitorPriceRecommendations.slice(0, 3).map((entry) => {
              const recommendation = entry.priceRecommendation ?? {}
              const money = (amount: number | undefined) => typeof amount === "number"
                ? `$${amount.toFixed(2)}` : SINGLE_PRODUCT_LAB_UNAVAILABLE
              return <article
                key={entry.id}
                id={entry.id ? `commercial-improvement-${entry.id}` : undefined}
                tabIndex={entry.id === requestedImprovementId ? -1 : undefined}
                className={`scroll-mt-32 rounded-xl bg-black/25 p-3 text-xs outline-none ${entry.id === requestedImprovementId ? "ring-2 ring-emerald-200" : ""}`}
              >
                <p className="font-black text-white">Listing {entry.listingId} · SKU {entry.sku ?? "pendiente"}</p>
                <p className="mt-1 text-white/70">Actual {money(recommendation.currentItemPrice)} → propuesta {money(recommendation.proposedItemPrice)} · {recommendation.activeMarketNotConfirmedSale
                  ? `mediana activa ${money(recommendation.activeMarketMedianLandedPrice)}`
                  : `referencia vendida ${money(recommendation.confirmedSoldBenchmarkLandedPrice)}`}</p>
                <p className="mt-1 text-white/55">{recommendation.activeMarketNotConfirmedSale
                  ? `${value(recommendation.activeSellerCount)} vendedor(es) activos · no son ventas confirmadas`
                  : `${value(recommendation.confirmedSoldSellerCount)} vendedor(es) exacto(s) · ${value(recommendation.confirmedSoldQuantity)} venta(s)`} · piso propio {money(recommendation.minimumSafeLandedPrice)} · utilidad {money(recommendation.proposedEstimatedNetProfit ?? undefined)} · margen {formatSingleProductLabMetric(recommendation.proposedEstimatedMarginPercent, { suffix: "%" })} · ROI {formatSingleProductLabMetric(recommendation.proposedEstimatedRoiPercent, { suffix: "%" })}</p>
                {recommendation.activeMarketNotConfirmedSale && <p className="mt-1 text-white/55">Piso normal con reserva publicitaria 5%: {money(recommendation.floorWithPromotionReserve)} · sin promoción: {money(recommendation.floorWithoutPromotion)} · piso controlado 10%: {money(recommendation.controlledRiskMinimumLandedPrice)} · alcanza la mediana activa: {recommendation.canReachActiveMarketSafely ? "SÍ" : "NO"}</p>}
                {recommendation.controlledRiskTenPercent && <p className="mt-2 rounded-lg border border-amber-200/25 bg-amber-200/[0.08] p-2 font-black text-amber-50">PRECIO COMPETITIVO CON MARGEN CONTROLADO 10% · PROMOCIÓN BLOQUEADA</p>}
                {recommendation.activeMarketNotConfirmedSale && recommendation.activeMarketEconomics && <p className="mt-1 text-white/55">A precio de mercado: utilidad {money(recommendation.activeMarketEconomics.estimatedNetProfit ?? undefined)} · margen {formatSingleProductLabMetric(recommendation.activeMarketEconomics.estimatedNetMarginPercent, { suffix: "%" })} · ROI {formatSingleProductLabMetric(recommendation.activeMarketEconomics.estimatedRoiPercent, { suffix: "%" })} · envío conservador {money(recommendation.activeMarketEconomics.estimatedOutboundShipping ?? undefined)}. Regla(s) que fallan: {(recommendation.activeMarketEconomics.failedGateCodes ?? []).join(", ") || "ninguna"}.</p>}
                <p className="mt-2 font-bold text-emerald-50">{entry.recommendedAction}</p>
                <p className="mt-1 text-[10px] font-black uppercase text-amber-100">Esperando revisión humana · WhatsApp bloqueado · ningún cambio aplicado</p>
                {entry.id && !["KEEP_PRICE_IN_CONFIRMED_SOLD_BAND", "HOLD_AT_SAFE_FLOOR_MARKET_BELOW_FLOOR"].includes(recommendation.action ?? "") && recommendation.proposedPassesProfitGate !== false && <button type="button" disabled onClick={() => void applyImprovement(entry.id!)} className="mt-3 min-h-12 w-full rounded-xl bg-emerald-200 px-3 font-black text-black disabled:opacity-40">BLOQUEADO EN PILOT MODE</button>}
                {recommendation.action === "HOLD_AT_SAFE_FLOOR_MARKET_BELOW_FLOOR" && <p className="mt-3 rounded-xl border border-amber-200/25 bg-amber-200/[0.08] p-3 text-center font-black text-amber-50">MANTENER {money(recommendation.currentItemPrice)} · YA ESTÁ EN EL PISO</p>}
              </article>
            })}
          </div>
        </div>}
        {researchRefreshProfiles.length > 0 && <div className="mt-3 rounded-xl border border-amber-200/25 bg-amber-200/[0.08] p-3">
          <p className="font-black text-amber-50">Product Research recomendado · {researchRefreshProfiles.length} listing(s)</p>
          <p className="mt-1 text-xs leading-5 text-white/65">Actualizar una sola captura dirigida para confirmar si el nuevo competidor realmente vende. La recomendación tiene enfriamiento y no importa ni modifica nada automáticamente.</p>
        </div>}
        <div className="mt-3 space-y-2">
          {competitorProfiles.slice(0, 5).map((profile) => <article key={profile.listing_id} className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className="font-black text-white">Listing {profile.listing_id}</p><p className="text-[11px] text-white/45">SKU {profile.sku ?? "pendiente"} · {formatDate(profile.last_scanned_at)}</p></div>
              <span className="rounded-full border border-white/15 px-2 py-1 text-[10px] font-black uppercase text-white/65">{profile.latest_evidence_class?.replaceAll("_", " ") ?? "sin evidencia"}</span>
            </div>
            <p className="mt-2 text-xs text-white/65">{value(profile.latest_active_seller_count)} vendedor(es) activo(s) · precio total mediano {typeof profile.latest_median_landed_price === "number" ? `$${profile.latest_median_landed_price.toFixed(2)}` : SINGLE_PRODUCT_LAB_UNAVAILABLE}</p>
            {(profile.latest_suggestion_codes?.length ?? 0) > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-violet-50">{profile.latest_suggestion_codes?.map((code) => <li key={code}>{competitorSuggestionLabel(code)}</li>)}</ul>}
          </article>)}
          {competitorProfiles.length === 0 && <p className="rounded-xl border border-white/10 p-3 text-xs text-white/55">La primera ejecución segura establecerá la línea base sin generar una avalancha de alertas.</p>}
        </div>
        <p className="mt-3 text-[11px] font-bold text-emerald-100">Descubrimiento automático: NO · importación automática de Research: NO · cambios automáticos en eBay: NO.</p>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-2xl bg-black/30 p-3"><span className="text-white/45">Ventas nuevas</span><strong className="mt-1 block text-xl">{value(verifiedNewSales)}</strong></div>
        <div className="rounded-2xl bg-black/30 p-3"><span className="text-white/45">Impresiones</span><strong className="mt-1 block text-xl">{value(analytics?.impressions)}</strong></div>
        <div className="rounded-2xl bg-black/30 p-3"><span className="text-white/45">Vistas</span><strong className="mt-1 block text-xl">{value(analytics?.views)}</strong></div>
        <div className="rounded-2xl bg-black/30 p-3"><span className="text-white/45">Watchers</span><strong className="mt-1 block text-xl">{value(analytics?.watchers)}</strong><span className="mt-1 block text-[10px] text-white/40">señales de interés</span></div>
        <div className="rounded-2xl bg-black/30 p-3"><span className="text-white/45">Transacciones Analytics</span><strong className="mt-1 block text-xl">{value(analytics?.transactions)}</strong><span className="mt-1 block text-[10px] text-white/40">no sustituyen órdenes</span></div>
        <div className="rounded-2xl bg-black/30 p-3"><span className="text-white/45">Alertas</span><strong className="mt-1 block text-xl">{value(metrics?.alertsGenerated)}</strong></div>
        <div className="rounded-2xl bg-black/30 p-3"><span className="text-white/45">Mensajes Seller Hub</span><strong className="mt-1 block text-xl">{value(metrics?.sellerHubMessages?.headersRead)}</strong><span className="mt-1 block text-[10px] text-white/40">contenido protegido</span></div>
        <div className="rounded-2xl bg-black/30 p-3"><span className="text-white/45">Fulfillment</span><strong className="mt-1 block text-xl">{value(health?.fulfillmentTasks)}</strong></div>
        <div className="rounded-2xl bg-black/30 p-3"><span className="text-white/45">Reintentos</span><strong className="mt-1 block text-xl">{value(health?.retries)}</strong></div>
      </div>

      <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-4">
        {(["orders", "messages", "analytics", "watchers", "competitors"] as const).map((name) => (
          <div key={name} className="rounded-2xl border border-white/10 p-3">
            <dt className="font-black uppercase text-white/45">{name === "orders" ? "Órdenes" : name === "messages" ? "Mensajes" : name === "analytics" ? "Analytics" : name === "watchers" ? "Watchers" : "Competencia"}</dt>
            <dd className={`mt-1 font-black uppercase ${statusTone(readers[name]?.status)}`}>{readers[name]?.status ?? "sin ejecutar"}</dd>
            <dd className="mt-1 break-words text-white/45">{readers[name]?.source ?? "Fuente pendiente"}</dd>
            {readers[name]?.error && <dd className="mt-1 break-words text-rose-100">{readers[name]?.error}</dd>}
          </div>
        ))}
      </dl>

      <details className="mt-4 rounded-2xl border border-white/10 p-3">
        <summary className="flex min-h-11 cursor-pointer items-center font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Salud, errores y próxima acción</summary>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-white/45">Última actualización</dt><dd className="font-bold">{formatDate(run?.completed_at ?? run?.started_at)}</dd></div>
          <div><dt className="text-white/45">Scheduler Preview</dt><dd className="font-bold">{dashboard?.schedule?.effectivelyEnabled ? "AUTORIZADO" : `BLOQUEADO · ${dashboard?.schedulerAuthorization?.status ?? "SIN DRY RUN"}`}</dd></div>
          <div><dt className="text-white/45">Vigencia</dt><dd className="font-bold">{dashboard?.schedulerAuthorization?.mode === "CONTINUOUS_WHILE_ACTIVE" ? "CONTINUA MIENTRAS HAYA LISTINGS ACTIVE" : formatDate(dashboard?.schedulerAuthorization?.expiresAt)}</dd></div>
          <div><dt className="text-white/45">Próxima ejecución</dt><dd className="font-bold">{dashboard?.schedule?.effectivelyEnabled ? formatDate(dashboard.nextAutomaticRunAt) : "Requiere dry run satisfactorio y autorización durable"}</dd></div>
          <div><dt className="text-white/45">Pendientes de compra</dt><dd className="font-bold">{value(health?.pendingManualPurchase)}</dd></div>
          <div><dt className="text-white/45">Esperando tracking</dt><dd className="font-bold">{value(health?.awaitingTracking)}</dd></div>
          <div><dt className="text-white/45">Alertas fallidas</dt><dd className="font-bold">{value(health?.alertsFailed)}</dd></div>
          <div><dt className="text-white/45">Dead letter</dt><dd className="font-bold">{value(health?.alertsDeadLetter)}</dd></div>
        </dl>
        <p className="mt-3 text-sm leading-6 text-cyan-50">{run?.next_action ?? "Ejecuta la primera actualización controlada."}</p>
        {(run?.errors?.length ?? 0) > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-rose-100">{run?.errors?.map((item, index) => <li key={`${item.code}-${index}`}>{item.reader}: {item.code}{item.retryable ? " · reintentable" : ""}</li>)}</ul>}
      </details>

      {dashboard?.pilot24h && <details className="mt-4 rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.04] p-3">
        <summary className="flex min-h-11 cursor-pointer items-center font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Reporte acumulado del monitor continuo</summary>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          <div><dt className="text-white/45">Estado</dt><dd className="font-black uppercase text-cyan-100">{dashboard.pilot24h.status}</dd></div>
          <div><dt className="text-white/45">Inicio</dt><dd className="font-bold">{formatDate(dashboard.pilot24h.startedAt)}</dd></div>
          <div><dt className="text-white/45">Corte automático</dt><dd className="font-bold">SÍ · runner bloqueado por SINGLE_PRODUCT_LAB</dd></div>
          <div><dt className="text-white/45">Ejecuciones</dt><dd className="font-bold">{value(dashboard.pilot24h.totalRuns)}</dd></div>
          <div><dt className="text-white/45">Completadas / parciales / fallidas</dt><dd className="font-bold">{value(dashboard.pilot24h.completedRuns)} / {value(dashboard.pilot24h.partialRuns)} / {value(dashboard.pilot24h.failedRuns)}</dd></div>
          <div><dt className="text-white/45">Órdenes leídas</dt><dd className="font-bold">{value(dashboard.pilot24h.ordersRead)}</dd></div>
          <div><dt className="text-white/45">Ventas / fulfillment</dt><dd className="font-bold">{value(dashboard.pilot24h.newSales)} / {value(dashboard.pilot24h.fulfillmentTasksCreated)}</dd></div>
          <div><dt className="text-white/45">Alertas</dt><dd className="font-bold">{value(dashboard.pilot24h.alertsGenerated)}</dd></div>
          <div><dt className="text-white/45">WhatsApp META_ACCEPTED / fallidos</dt><dd className="font-bold">{value(dashboard.pilot24h.whatsappMetaAccepted)} / {value(dashboard.pilot24h.whatsappFailed)}</dd></div>
          <div><dt className="text-white/45">Duplicados evitados</dt><dd className="font-bold">{value(dashboard.pilot24h.duplicatesAvoided)}</dd></div>
          <div><dt className="text-white/45">Reintentos / dead-letter</dt><dd className="font-bold">{value(dashboard.pilot24h.retries)} / {value(dashboard.pilot24h.deadLetter)}</dd></div>
          <div><dt className="text-white/45">Divergencia Analytics</dt><dd className="font-bold uppercase">{dashboard.pilot24h.analyticsDivergenceStatus ?? "sin evidencia"}</dd></div>
          <div><dt className="text-white/45">Escrituras eBay</dt><dd className="font-bold">{value(dashboard.pilot24h.ebayWrites)}</dd></div>
          <div><dt className="text-white/45">Production modificada</dt><dd className="font-bold">{dashboard.pilot24h.productionChanged ? "SÍ" : "NO"}</dd></div>
        </dl>
      </details>}

      {message && <p aria-live="polite" className="mt-3 rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.06] p-3 text-sm text-cyan-50">{message}</p>}
      {error && <p role="alert" className="mt-3 rounded-2xl border border-rose-200/25 bg-rose-200/[0.08] p-3 text-sm text-rose-50">{error}</p>}
    </section>
  )
}
