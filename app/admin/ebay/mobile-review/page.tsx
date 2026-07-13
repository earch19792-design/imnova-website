"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import demoRadarJson from "@/tools/fixtures/ebay-mobile-review-real-radar-connector-v1.json"
import {
  buildMobileReviewRealRadarConnector,
  loadMarketRadarReadonlyDashboard,
  loadMarketRadarReadonlyProductById,
  mapMarketRadarProductToMobileCandidate,
  type RadarProductInput,
  type RealRadarCandidate,
} from "@/lib/ebay/ebay-mobile-review-real-radar-connector"
import {
  applyMobileReviewAction,
  buildInitialMobileReviewState,
  buildMobileReviewCopyPasteSummary,
  buildMobileReviewDecision,
  type MobileReviewFixture,
} from "@/lib/ebay/ebay-mobile-review-page-mvp"
import { buildMobileReviewRadarGuardEnforcement } from "@/lib/ebay/ebay-mobile-review-radar-guard-enforcement"
import {
  applyPinnedCandidateAction,
  buildPinnedCandidateContinuityReport,
  pinnedCandidateMatchesRadar,
  type PinnedCandidate,
  type PinnedCandidateAction,
} from "@/lib/ebay/ebay-mobile-review-pinned-candidate-continuity"
import { buildMobileReviewEffectiveDecision } from "@/lib/ebay/ebay-mobile-review-effective-decision"
import { buildEbayMarketValidationSelectedCandidate } from "@/lib/ebay/ebay-market-validation-selected-candidate"
import {
  buildEbayIdentitySearchUrl,
  buildLunaEbayIdentityComparison,
} from "@/lib/ebay/ebay-luna-ebay-identity-comparison"
import type { EbaySellerKeywordDemandReport } from "@/lib/ebay/ebay-seller-keyword-demand-validation"
import type { EbayLunaOpportunityAssessment } from "@/lib/ebay/ebay-luna-demand-opportunity-engine"
import {
  getMobileReviewPayloadError,
  getMobileReviewRequestError,
  readMobileReviewJson,
} from "@/lib/ebay/ebay-mobile-review-http"
import {
  MOBILE_REVIEW_PINNED_STORAGE_KEY,
  parsePinnedCandidates,
  serializePinnedCandidates,
} from "@/lib/ebay/ebay-mobile-review-local-state"
import { OpportunityCommandCenter, type Opportunity } from "./opportunity-command-center"

const emptyReport = buildMobileReviewRealRadarConnector({ products: [] })
type View = "opportunities" | "top5" | "pinned" | "blocked" | "decision"

type ServerReview = {
  id: string
  opportunity_id: string
  candidate_key: string
  status: string
  current_step: string
  form_data: Record<string, unknown>
  updated_at: string
  opportunity?: Opportunity
}

type ServerAlerts = {
  activeListingRisks: Array<{ id: string; risk_priority: string; risk_type: string; risk_summary: string; recommended_action?: string }>
  outbox: Array<{ id: string; priority: string; alert_type: string; status: string; payload: Record<string, unknown>; created_at: string }>
}

type SellerWhatsAppStatus = {
  configuration?: {
    status: "READY" | "DISABLED" | "NOT_READY"
    enabled: boolean
    ready: boolean
    recipientConfigured: boolean
    immediateTemplateConfigured: boolean
    digestTemplateConfigured: boolean
    preflightStatus?: "NOT_RUN" | "PASSED" | "FAILED" | "EXPIRED"
  }
  health?: { pending: number; failed: number; deadLetter: number }
  preflight?: {
    success: boolean
    status: "PASSED" | "FAILED"
    phoneNumberAccessible: boolean
    errorCodes: string[]
  } | null
  previews?: Array<{
    alertId: string
    priority: string
    deliveryClass: string
    message: { title: string; summary: string; action: string }
  }>
}

function toMobileFixture(candidates: RealRadarCandidate[]): MobileReviewFixture {
  return {
    version: "REAL_RADAR_MOBILE_REVIEW_V2",
    status: "MOBILE_REVIEW_PENDING",
    top5Candidates: candidates,
    previousCandidate: {
      candidateRank: 0,
      candidateId: "previous-unavailable",
      productName: "Previous unavailable candidate",
      opportunityScore: 0,
      suggestedPrice: { value: 0, currency: "USD" },
      suggestedCategory: "REMOVED",
      riskFlags: ["STOCK_HOLD"],
      missingFields: [],
      listingBlueprintSummary: "Removed after mobile review",
      availabilityStatus: "REMOVED_FROM_LUNA_SCAN",
      previousStatus: "REMOVED_FROM_LUNA_SCAN",
    },
  }
}

const humanRouteLabels: Record<string, string> = {
  NEED_STOCK_CONFIRMATION: "Confirmar stock",
  NEED_STOCK_RECONFIRMATION: "Volver a confirmar stock",
  NEED_SUPPLIER_IDENTITY: "Completar identidad del proveedor",
  NEED_SUPPLIER_PRICE: "Confirmar precio Luna",
  NEED_EBAY_MARKET_PRICE: "Validar precio de mercado eBay",
  NEED_EBAY_MARKET_VALIDATION: "Continuar validación de mercado eBay",
  NEED_MARGIN_REVIEW: "Revisar margen",
  NEED_CATEGORY_RUNTIME_CONFIRMATION: "Confirmar categoría eBay",
  NEED_EBAY_DEMAND_VALIDATION: "Validar demanda eBay",
  NEED_EBAY_SALES_EVIDENCE: "Obtener evidencia de ventas en eBay",
  NEED_EBAY_COMPARABLE_LISTINGS: "Encontrar listings equivalentes en eBay",
  NEED_HUMAN_EBAY_IDENTITY_CONFIRMATION: "Confirmar el comparable de eBay",
  NEED_IMAGE_REVIEW: "Revisar imagen",
  NEED_EBAY_IDENTITY_REFERENCE: "Comparar identidad Luna con un listing de eBay",
  NEED_SHIPPING_RESTRICTION_REVIEW: "Revisar restricciones de envío",
  NEED_HAZMAT_OR_AEROSOL_REVIEW: "Revisar aerosol o material regulado",
  NEED_BRAND_REVIEW: "Revisar marca y compatibilidad",
  NEED_HEALTH_CLAIMS_REVIEW: "Revisar declaraciones de salud",
  NEED_BABY_PRODUCT_REVIEW: "Revisar producto para bebé",
  NEED_BATTERY_OR_LITHIUM_REVIEW: "Revisar batería o litio",
  NEED_CHEMICAL_PRODUCT_REVIEW: "Revisar producto químico",
  NEED_EBAY_MARKET_VALIDATION_WITH_RESTRICTION_REVIEW: "Validar mercado eBay y restricciones",
  STOCK_HOLD: "Bloqueado por stock",
}

const humanGuardLabels: Record<string, string> = {
  missingSnapshot: "Falta una observación reciente de Radar",
  missingVariant: "Falta identificar la variante",
  missingSku: "Falta confirmar el SKU",
  stockUnknown: "Falta confirmar la cantidad disponible",
  stockAvailabilityOnly: "Luna sólo informó disponibilidad, no cantidad",
  stockStale: "La confirmación de stock está vencida",
  missingLunaPrice: "Falta confirmar el precio actual en Luna",
  missingEbayPrice: "Falta validar el precio de mercado en eBay",
  missingMargin: "Falta revisar el margen estimado",
  missingCategoryId: "Falta confirmar la categoría de eBay",
  missingDemandValidation: "Falta validar la demanda en eBay",
  NEED_EBAY_SALES_EVIDENCE: "Falta evidencia de ventas para comparables equivalentes",
  NEED_EBAY_COMPARABLE_LISTINGS: "No se encontraron listings suficientemente equivalentes",
  missingImageValidation: "Falta comparar la imagen con Luna",
  riskHold: "El producto tiene una alerta de riesgo pendiente",
  outOfStock: "Radar reporta el producto sin stock",
  staleMissingFromSource: "El producto ya no aparece en la fuente reciente",
}

const formatValue = (value: unknown) => value === null || value === undefined || value === "" ? "Pendiente" : String(value)
const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "Pendiente"
const formatStockAge = (hours: number | null) => hours === null ? "edad pendiente" : hours < 1 ? "menos de 1 h" : `${Math.round(hours)} h`
const routeLabel = (route: string | null) => route ? humanRouteLabels[route] ?? route.replaceAll("_", " ") : "Sin ruta"
const guardLabel = (guard: string) => humanGuardLabels[guard] ?? humanRouteLabels[guard] ?? guard

function getLunaCatalogUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    const isLunaHost =
      url.hostname === "lunaportex.com" ||
      url.hostname.endsWith(".lunaportex.com")
    return url.protocol === "https:" && isLunaHost
      ? url.href
      : null
  } catch {
    return null
  }
}

function getSafeProductImageUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    const isTrustedImageHost =
      url.hostname === "cdn.shopify.com" ||
      url.hostname === "lunaportex.com" ||
      url.hostname.endsWith(".lunaportex.com")
    return url.protocol === "https:" && isTrustedImageHost
      ? url.href
      : null
  } catch {
    return null
  }
}

function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warning" | "danger" }) {
  const colors = { neutral: "border-white/20 bg-white/10 text-white", good: "border-emerald-200/30 bg-emerald-200/10 text-emerald-50", warning: "border-amber-200/30 bg-amber-200/10 text-amber-50", danger: "border-rose-200/30 bg-rose-200/10 text-rose-50" }
  return <span className={`rounded-full border px-3 py-1.5 text-[11px] font-bold ${colors[tone]}`}>{children}</span>
}

function CandidateCard({ candidate, selected, pinned, provisional, onSelect, onUnavailable }: { candidate: RealRadarCandidate; selected: boolean; pinned: boolean; provisional: boolean; onSelect: () => void; onUnavailable: () => void }) {
  return (
    <article className={`rounded-3xl border p-4 ${selected ? "border-emerald-200/60 bg-emerald-200/10" : "border-white/15 bg-white/[0.045]"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-cyan-100">Orden #{candidate.candidateRank}{candidate.candidateRank === 1 && !provisional ? " · Recomendado" : provisional ? " · Provisional" : ""}</p>
          <h2 className="mt-2 text-lg font-black leading-6">{candidate.productTitle}</h2>
          <p className="mt-1 text-sm text-white/70">{formatValue(candidate.variantTitle)} · SKU {formatValue(candidate.supplierSku)}</p>
        </div>
        <span className="shrink-0 rounded-2xl bg-white/10 px-3 py-2 text-lg font-black">{candidate.opportunityScore.toFixed(2)}</span>
      </div>
      <div className="mt-4 grid gap-2 text-sm">
        <div className="flex justify-between gap-3 rounded-2xl bg-black/30 p-3"><span className="text-white/70">Stock</span><strong className="text-right">{formatValue(candidate.stockQuantity)} · {candidate.stockSource}<span className="block text-xs font-medium text-white/55">Actualizado: {formatStockAge(candidate.stockConfirmationAgeHours)}</span></strong></div>
        <div className="flex justify-between gap-3 rounded-2xl bg-black/30 p-3"><span className="text-white/70">Precio Luna</span><strong>{candidate.lunaPrice === null ? "Pendiente" : `$${candidate.lunaPrice.toFixed(2)}`}</strong></div>
        <div className="flex justify-between gap-3 rounded-2xl bg-black/30 p-3"><span className="text-white/70">Siguiente paso</span><strong className="text-right text-amber-100">{routeLabel(candidate.routeRecommendation)}</strong></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">{pinned && <StatusPill tone="warning">También está en revisión</StatusPill>}<StatusPill>Último scan: {formatDate(candidate.lastSeenAt)}</StatusPill></div>
      <details className="mt-4 rounded-2xl border border-white/15 bg-black/20 p-3">
        <summary className="cursor-pointer font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200">Ver detalles técnicos</summary>
        <dl className="mt-3 grid gap-3 text-xs text-white/80">
          <div><dt className="font-bold text-white">Radar</dt><dd className="break-all">Producto: {candidate.marketRadarProductId}<br />Snapshot: {formatValue(candidate.marketRadarSnapshotId)}</dd></div>
          <div><dt className="font-bold text-white">Proveedor</dt><dd className="break-all">Producto: {candidate.supplierProductId}<br />Variante: {formatValue(candidate.supplierVariantId)}</dd></div>
          <div><dt className="font-bold text-white">Readiness</dt><dd>{candidate.professionalReadinessStatus}<br />Pipeline: {candidate.pipelineStatus}<br />Category ID: {formatValue(candidate.categoryId)}</dd></div>
          <div><dt className="font-bold text-white">Guardas</dt><dd>{candidate.missingFields.join(", ") || "Ninguna"}</dd></div>
          <div><dt className="font-bold text-white">URL</dt><dd className="break-all">{formatValue(candidate.productUrl)}</dd></div>
        </dl>
      </details>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={onSelect} className="min-h-12 rounded-2xl bg-emerald-200 px-4 py-3 font-black text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Revisar producto</button>
        <button type="button" onClick={() => { if (window.confirm(`¿Marcar “${candidate.productTitle}” como no disponible?`)) onUnavailable() }} className="min-h-12 rounded-2xl border border-rose-200/35 px-4 py-3 font-bold text-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-rose-200">Marcar no disponible</button>
      </div>
    </article>
  )
}

export default function EbayMobileReviewPage() {
  const [report, setReport] = useState(emptyReport)
  const [state, setState] = useState(() => buildInitialMobileReviewState(toMobileFixture([])))
  const [stockQuantity, setStockQuantity] = useState("")
  const [lunaPrice, setLunaPrice] = useState("")
  const [lunaPriceConfirmed, setLunaPriceConfirmed] = useState(false)
  const [catalogCheckOpened, setCatalogCheckOpened] = useState(false)
  const [ebayListingUrl, setEbayListingUrl] = useState("")
  const [ebayObservedTitle, setEbayObservedTitle] = useState("")
  const [ebayReferenceOpened, setEbayReferenceOpened] = useState(false)
  const [identityChecks, setIdentityChecks] = useState({
    sameProductAndBrand: false,
    sameVariantSizeOrPack: false,
    compatibleReference: false,
  })
  const [sellerKeywordDemand, setSellerKeywordDemand] = useState<EbaySellerKeywordDemandReport | null>(null)
  const [opportunityAssessment, setOpportunityAssessment] = useState<EbayLunaOpportunityAssessment | null>(null)
  const [sellerKeywordDemandLoading, setSellerKeywordDemandLoading] = useState(false)
  const [sellerKeywordDemandError, setSellerKeywordDemandError] = useState("")
  const [loading, setLoading] = useState(true)
  const [loadState, setLoadState] = useState("LOADING")
  const [loadMessage, setLoadMessage] = useState("Cargando Market Radar read-only…")
  const [lastActionMessage, setLastActionMessage] = useState("Todavía no realizaste ninguna acción.")
  const [pinnedCandidates, setPinnedCandidates] = useState<PinnedCandidate[]>([])
  const [storageRestored, setStorageRestored] = useState(false)
  const [view, setView] = useState<View>("opportunities")
  const [selectedQueueCandidate, setSelectedQueueCandidate] = useState<RealRadarCandidate | null>(null)
  const [selectedQueueOpportunity, setSelectedQueueOpportunity] = useState<Opportunity | null>(null)
  const [serverReviews, setServerReviews] = useState<ServerReview[]>([])
  const [serverAlerts, setServerAlerts] = useState<ServerAlerts>({ activeListingRisks: [], outbox: [] })
  const [whatsappStatus, setWhatsappStatus] = useState<SellerWhatsAppStatus>({})
  const [whatsappPreflightRunning, setWhatsappPreflightRunning] = useState(false)
  const [serverSaveState, setServerSaveState] = useState("Sin cambios pendientes")
  const [blockedVisible, setBlockedVisible] = useState(5)
  const [copied, setCopied] = useState(false)
  const confirmationRef = useRef<HTMLElement>(null)

  const load = useCallback(async () => {
    setLoading(true); setLoadState("LOADING")
    try {
      const demoRequested = new URLSearchParams(window.location.search).get("demo") === "1"
      const products = demoRequested ? demoRadarJson.products as unknown as RadarProductInput[] : await (async () => {
        const { data, error } = await supabase.auth.getSession()
        if (error || !data.session) throw new Error("AUTH_REQUIRED")
        return loadMarketRadarReadonlyDashboard(`Bearer ${data.session.access_token}`)
      })()
      const nextReport = buildMobileReviewRealRadarConnector({ products, mode: demoRequested ? "DEMO_FIXTURE_ONLY" : "REAL_READONLY" })
      setReport(nextReport); setState(buildInitialMobileReviewState(toMobileFixture(nextReport.top5Candidates))); setSelectedQueueCandidate(null); setSelectedQueueOpportunity(null); setStockQuantity(""); setLunaPrice(""); setLunaPriceConfirmed(false); setCatalogCheckOpened(false); setEbayListingUrl(""); setEbayObservedTitle(""); setEbayReferenceOpened(false); setIdentityChecks({ sameProductAndBrand: false, sameVariantSizeOrPack: false, compatibleReference: false }); setSellerKeywordDemand(null); setOpportunityAssessment(null); setSellerKeywordDemandError("")
      if (nextReport.realRadarCandidatesCount === 0) { setLoadState("RADAR_EMPTY"); setLoadMessage("Radar respondió, pero no devolvió productos. Ejecuta o revisa el scan antes de decidir.") }
      else { setLoadState("READY"); setLoadMessage(`${nextReport.top5Candidates.length} candidatos disponibles de ${nextReport.realRadarCandidatesCount} productos observados.`) }
      return nextReport.allCandidates
    } catch (error) {
      setReport(emptyReport); setState(buildInitialMobileReviewState(toMobileFixture([])))
      const auth = error instanceof Error && error.message === "AUTH_REQUIRED"
      setLoadState(auth ? "AUTH_REQUIRED" : "RADAR_REQUEST_FAILED")
      setLoadMessage(auth
        ? "La sesión admin expiró. Vuelve a iniciar sesión para leer Market Radar."
        : getMobileReviewRequestError(error, "No se pudo consultar Market Radar. Revisa la conexión e intenta nuevamente."))
      return []
    } finally { setLoading(false) }
  }, [])

  const lookupRadarCandidateByProductId = useCallback(async (
    productId: string,
  ) => {
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session) throw new Error("AUTH_REQUIRED")
    const product = await loadMarketRadarReadonlyProductById(
      `Bearer ${data.session.access_token}`,
      productId,
    )
    return product
      ? mapMarketRadarProductToMobileCandidate(product, 0)
      : null
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const section = new URLSearchParams(window.location.search).get("section")
    if (section === "in-progress") setView("pinned")
    if (section === "alerts") setView("blocked")
  }, [])
  const loadServerReviews = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error || !data.session) return
      const response = await fetch("/api/admin/ebay/command-center", { cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}` } })
      const payload = await readMobileReviewJson<{
        success?: boolean
        dashboard?: { queue?: Opportunity[] }
        reviews?: ServerReview[]
        alerts?: ServerAlerts
      }>(response, "No se pudo cargar el estado guardado del Command Center")
      if (!payload.success) return
      const queue = (payload.dashboard?.queue ?? []) as Opportunity[]
      setServerReviews((payload.reviews ?? []).map((review: ServerReview) => ({ ...review, opportunity: queue.find((row) => row.id === review.opportunity_id) })))
      setServerAlerts(payload.alerts ?? { activeListingRisks: [], outbox: [] })
    } catch { /* La cola principal muestra el error de sesión/conexión. */ }
  }, [])
  useEffect(() => { void loadServerReviews() }, [loadServerReviews])
  const loadWhatsAppStatus = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error || !data.session) return
      const response = await fetch("/api/admin/ebay/seller-whatsapp-alerts", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      })
      const payload = await readMobileReviewJson<SellerWhatsAppStatus & { success?: boolean }>(
        response,
        "No se pudo cargar el estado de WhatsApp",
      )
      if (payload.success) setWhatsappStatus(payload)
    } catch { /* WhatsApp no debe bloquear Radar ni la revisión móvil. */ }
  }, [])
  useEffect(() => { void loadWhatsAppStatus() }, [loadWhatsAppStatus])
  const runWhatsAppPreflight = useCallback(async () => {
    setWhatsappPreflightRunning(true)
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error || !data.session) throw new Error("AUTH_REQUIRED")
      const response = await fetch("/api/admin/ebay/seller-whatsapp-alerts", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "preflight", force: true }),
      })
      const payload = await readMobileReviewJson<SellerWhatsAppStatus & { success?: boolean }>(
        response,
        "No se pudo validar la configuración de WhatsApp",
      )
      setWhatsappStatus((current) => ({ ...current, ...payload }))
      setLastActionMessage(payload.success
        ? "WhatsApp validado: número emisor y plantillas aprobadas están listos."
        : `WhatsApp sigue bloqueado: ${(payload.preflight?.errorCodes ?? ["configuración incompleta"]).join(", ")}.`)
    } catch (error) {
      setLastActionMessage(getMobileReviewRequestError(error, "No se pudo ejecutar el preflight de WhatsApp."))
    } finally {
      setWhatsappPreflightRunning(false)
    }
  }, [])
  useEffect(() => {
    const restored = parsePinnedCandidates(window.localStorage.getItem(MOBILE_REVIEW_PINNED_STORAGE_KEY))
    setPinnedCandidates(restored.candidates); setStorageRestored(true)
    if (restored.status === "INVALID" || restored.status === "EXPIRED") setLastActionMessage("El estado local anterior era inválido o venció y no fue restaurado.")
  }, [])
  useEffect(() => {
    if (!storageRestored) return
    try { window.localStorage.setItem(MOBILE_REVIEW_PINNED_STORAGE_KEY, serializePinnedCandidates(pinnedCandidates)) }
    catch { setLastActionMessage("No se pudo guardar la continuidad local. Copia el resumen antes de salir.") }
  }, [pinnedCandidates, storageRestored])

  const decision = useMemo(() => buildMobileReviewDecision(state), [state])
  const selectedRadarCandidate = selectedQueueCandidate?.candidateRank === state.selectedCandidateRank
    ? selectedQueueCandidate
    : report.top5Candidates.find((candidate) => candidate.candidateRank === state.selectedCandidateRank) ?? null
  const lunaCatalogUrl = getLunaCatalogUrl(selectedRadarCandidate?.productUrl)
  const safeProductImageUrl = getSafeProductImageUrl(selectedRadarCandidate?.imageReference)
  const ebayIdentitySearchUrl = buildEbayIdentitySearchUrl(selectedRadarCandidate)
  const identityComparison = useMemo(() => buildLunaEbayIdentityComparison({ lunaCandidate: selectedRadarCandidate, ebayListingUrl, ebayObservedTitle, ebayReferenceOpened, checklist: identityChecks, confirmationRecorded: state.sameProductConfirmed, ebayApiUsed: Boolean(sellerKeywordDemand) }), [selectedRadarCandidate, ebayListingUrl, ebayObservedTitle, ebayReferenceOpened, identityChecks, state.sameProductConfirmed, sellerKeywordDemand])
  const pinnedContinuity = useMemo(() => buildPinnedCandidateContinuityReport(report.top5Candidates, pinnedCandidates, report.allCandidates), [report, pinnedCandidates])
  const localConfirmationsComplete = Boolean(identityComparison.identityComparisonComplete && state.stockQuantityConfirmed && state.imageConfirmed && lunaPriceConfirmed)
  const localConfirmationCount = [
    identityComparison.identityComparisonComplete,
    Boolean(state.stockQuantityConfirmed),
    Boolean(state.imageConfirmed && lunaPriceConfirmed),
  ].filter(Boolean).length
  const radarGuards = useMemo(() => buildMobileReviewRadarGuardEnforcement({ dataSource: report.dataSource, realRadarTop5Loaded: report.realRadarTop5Loaded, top5Candidates: report.top5Candidates, selectedCandidate: selectedRadarCandidate, localConfirmationsComplete, manualConfirmations: { sameProductConfirmed: identityComparison.identityComparisonComplete, stockConfirmed: (state.stockQuantityConfirmed ?? 0) > 0, stockQuantityConfirmed: state.stockQuantityConfirmed, imageConfirmed: state.imageConfirmed, lunaPriceConfirmed, lunaPrice: lunaPriceConfirmed ? Number(lunaPrice) : null } }), [report, selectedRadarCandidate, localConfirmationsComplete, identityComparison.identityComparisonComplete, state.stockQuantityConfirmed, state.imageConfirmed, lunaPriceConfirmed, lunaPrice])
  const demandAwareRadarGuards = useMemo(() => {
    const guards = sellerKeywordDemand?.demandValidationPassed
      ? radarGuards.pendingGuards.filter((guard) => guard !== "missingDemandValidation")
      : radarGuards.pendingGuards
    return [
      ...guards,
      ...(sellerKeywordDemand?.pendingGuards ?? []),
    ]
  }, [radarGuards.pendingGuards, sellerKeywordDemand])
  const marketValidation = useMemo(() => buildEbayMarketValidationSelectedCandidate({ selectedCandidate: selectedRadarCandidate, humanConfirmationsComplete: localConfirmationsComplete, pendingGuards: [...demandAwareRadarGuards, ...(selectedRadarCandidate && !identityComparison.identityComparisonComplete ? identityComparison.pendingGuards : [])] }), [selectedRadarCandidate, localConfirmationsComplete, demandAwareRadarGuards, identityComparison.identityComparisonComplete, identityComparison.pendingGuards])
  const effectiveDecision = useMemo(() => buildMobileReviewEffectiveDecision({ dataSource: report.dataSource, selectedCandidateName: decision.selectedCandidateName, pendingGuards: marketValidation.pendingGuards, primaryBlockingReason: localConfirmationsComplete ? marketValidation.nextRecommendedRoute : radarGuards.primaryBlockingReason, localConfirmationsComplete, holdForReview: state.holdForReview, refreshRequested: state.refreshRequested }), [report.dataSource, decision.selectedCandidateName, marketValidation, radarGuards.primaryBlockingReason, localConfirmationsComplete, state.holdForReview, state.refreshRequested])
  const summary = useMemo(() => JSON.stringify({ ...JSON.parse(buildMobileReviewCopyPasteSummary(state)), dataSource: report.dataSource, mobileDecisionPersistence: selectedQueueOpportunity ? "SERVER_AUTOSAVE" : "BROWSER_STATE_ONLY", decisionPersistence: selectedQueueOpportunity ? "SERVER_AUTOSAVE_WITH_BROWSER_FALLBACK" : "BROWSER_STATE_OR_LOCAL_STORAGE", officialApprovalRecord: false, effectiveDecision, lunaEbayIdentityComparison: identityComparison, ebaySellerKeywordDemand: sellerKeywordDemand, ebayLunaOpportunityAssessment: opportunityAssessment, marketValidationSelectedCandidate: marketValidation, pendingGuards: selectedRadarCandidate ? marketValidation.pendingGuards : null, guardsEvaluated: Boolean(selectedRadarCandidate), manualConfirmationReconciliation: radarGuards.reconciliation, pinnedCandidateContinuity: pinnedContinuity, canPublish: false }, null, 2), [state, report.dataSource, selectedQueueOpportunity, effectiveDecision, identityComparison, sellerKeywordDemand, opportunityAssessment, marketValidation, selectedRadarCandidate, radarGuards.reconciliation, pinnedContinuity])

  useEffect(() => {
    if (!selectedRadarCandidate || !localConfirmationsComplete) return
    const confirmedAt = new Date().toISOString()
    setPinnedCandidates((current) => {
      const existing = current.find((candidate) => pinnedCandidateMatchesRadar(candidate, selectedRadarCandidate))
      const next: PinnedCandidate = {
        pinnedCandidateId: existing?.pinnedCandidateId ?? `radar:${selectedRadarCandidate.marketRadarProductId}`,
        marketRadarProductId: selectedRadarCandidate.marketRadarProductId,
        supplierProductId: selectedRadarCandidate.supplierProductId,
        productName: selectedRadarCandidate.productName,
        handle: selectedRadarCandidate.handle,
        productUrl: selectedRadarCandidate.productUrl,
        status: "PINNED_CANDIDATE_UNDER_REVIEW",
        sameProductConfirmed: true,
        stockConfirmed: true,
        stockQuantityConfirmed: state.stockQuantityConfirmed,
        stockWarning: (state.stockQuantityConfirmed ?? 0) <= 2 ? "STOCK_LIMITED_WARNING" : null,
        lunaPriceConfirmed: true,
        lunaPrice: Number(lunaPrice),
        imageConfirmed: true,
        source: "HUMAN_MOBILE_CONFIRMED",
        lastHumanConfirmationAt: confirmedAt,
        lastKnownRoute: "NEED_EBAY_MARKET_VALIDATION",
        radarPresenceStatus: "PINNED_AND_IN_CURRENT_TOP5",
        nextRecommendedRoute: "NEED_EBAY_MARKET_VALIDATION",
        lastKnownHumanConfirmation: {
          stockQuantityConfirmed: state.stockQuantityConfirmed,
          lunaPrice: Number(lunaPrice),
          availabilityStatus: "AVAILABLE",
          imageConfirmed: true,
          imageReference: selectedRadarCandidate.imageReference,
          sameProductConfirmed: true,
          confirmedAt,
        },
        latestRadarObservation: {
          latestAvailabilityStatus: selectedRadarCandidate.availabilityStatus,
          latestStockQuantity: selectedRadarCandidate.stockQuantity,
          latestLunaPrice: selectedRadarCandidate.lunaPrice,
          latestImageReference: selectedRadarCandidate.imageReference,
          latestLastSeenAt: selectedRadarCandidate.lastSeenAt,
          latestScanId: selectedRadarCandidate.marketRadarSnapshotId,
          sourceLastSuccessAt: selectedRadarCandidate.lastSnapshotAt,
          latestProductUrlStatus: selectedRadarCandidate.productUrl ? "VALID" : "MISSING",
          isPresentInLatestScan: true,
          missingIntervals: 0,
        },
      }
      return existing ? current.map((candidate) => candidate.pinnedCandidateId === existing.pinnedCandidateId ? next : candidate) : [...current, next]
    })
  }, [selectedRadarCandidate, localConfirmationsComplete, state.stockQuantityConfirmed, lunaPrice])

  const actPinned = (action: PinnedCandidateAction) => { setPinnedCandidates((current) => applyPinnedCandidateAction(current, action, report.allCandidates)); setLastActionMessage(`Acción de candidato en revisión: ${action.type}. Guardada solo en este navegador.`) }
  const act = (action: Parameters<typeof applyMobileReviewAction>[1]) => {
    if (action.type === "SELECT_CANDIDATE" || action.type === "MARK_UNAVAILABLE") { setStockQuantity(""); setLunaPrice(""); setLunaPriceConfirmed(false); setCatalogCheckOpened(false); setEbayListingUrl(""); setEbayObservedTitle(""); setEbayReferenceOpened(false); setIdentityChecks({ sameProductAndBrand: false, sameVariantSizeOrPack: false, compatibleReference: false }); setSellerKeywordDemand(null); setOpportunityAssessment(null); setSellerKeywordDemandError("") }
    if (action.type === "APPROVE_B2_RUN_PREFLIGHT") { setLastActionMessage(`B2-RUN continúa bloqueado. Próximo paso: ${routeLabel(effectiveDecision.nextRecommendedRoute)}.`); return }
    setState((current) => applyMobileReviewAction(current, action))
    const messages: Record<string, string> = { MARK_UNAVAILABLE: "Producto marcado no disponible en este navegador. Puedes deshacer recargando antes de persistir otro estado.", SELECT_CANDIDATE: "Producto seleccionado para evaluar; todavía no es una recomendación. Completa las tres confirmaciones.", CONFIRM_SAME_PRODUCT: "Identidad del producto confirmada localmente.", CONFIRM_STOCK_QTY: `Stock confirmado: ${stockQuantity} unidades.`, CONFIRM_IMAGE_OK: "Precio e imagen de Luna confirmados localmente.", REQUEST_LUNA_SCAN_REFRESH: "Se marcó localmente que Radar necesita un refresco; todavía no se envió una solicitud.", HOLD_FOR_REVIEW: "La revisión quedó pausada en esta sesión." }
    setLastActionMessage(messages[action.type] ?? "Acción local registrada.")
    if (action.type === "SELECT_CANDIDATE") { setView("decision"); window.setTimeout(() => confirmationRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }), 50) }
  }

  const reviewOpportunityCandidate = (
    opportunity: Opportunity,
    radarCandidates: RealRadarCandidate[] = report.allCandidates,
  ) => {
    const marketRadarProductId = opportunity.market_radar_product_id
    if (!marketRadarProductId) return false
    const candidate = radarCandidates.find(
      (entry) => entry.marketRadarProductId === marketRadarProductId,
    )
    if (!candidate) return false
    setStockQuantity(""); setLunaPrice(""); setLunaPriceConfirmed(false); setCatalogCheckOpened(false); setEbayListingUrl(""); setEbayObservedTitle(""); setEbayReferenceOpened(false); setIdentityChecks({ sameProductAndBrand: false, sameVariantSizeOrPack: false, compatibleReference: false }); setSellerKeywordDemand(null); setOpportunityAssessment(null); setSellerKeywordDemandError("")
    const initial = buildInitialMobileReviewState(toMobileFixture([candidate]))
    setState(applyMobileReviewAction(initial, { type: "SELECT_CANDIDATE", rank: candidate.candidateRank }))
    setSelectedQueueCandidate(candidate)
    setSelectedQueueOpportunity(opportunity)
    const saved = serverReviews.find((review) => review.candidate_key === opportunity.candidate_key)
    const savedForm = saved?.form_data ?? {}
    const savedStock = Number(savedForm.stockQuantity)
    const savedLunaPrice = Number(savedForm.lunaPrice)
    if (savedForm.sellerKeywordDemand && typeof savedForm.sellerKeywordDemand === "object") {
      setSellerKeywordDemand(savedForm.sellerKeywordDemand as EbaySellerKeywordDemandReport)
    }
    if (savedForm.opportunityAssessment && typeof savedForm.opportunityAssessment === "object") {
      setOpportunityAssessment(savedForm.opportunityAssessment as EbayLunaOpportunityAssessment)
    }
    if (typeof savedForm.ebayListingUrl === "string" && savedForm.ebayListingUrl) {
      setEbayListingUrl(savedForm.ebayListingUrl)
      setEbayObservedTitle(typeof savedForm.ebayObservedTitle === "string" ? savedForm.ebayObservedTitle : "")
      setEbayReferenceOpened(true)
    }
    if (savedForm.identityConfirmed === true) {
      setIdentityChecks({ sameProductAndBrand: true, sameVariantSizeOrPack: true, compatibleReference: true })
      setState((current) => applyMobileReviewAction(current, { type: "CONFIRM_SAME_PRODUCT" }))
    }
    if (Number.isInteger(savedStock) && savedStock > 0) {
      setStockQuantity(String(savedStock))
      setState((current) => applyMobileReviewAction(current, { type: "CONFIRM_STOCK_QTY", quantity: savedStock }))
    }
    if (savedForm.lunaPriceConfirmed === true && savedLunaPrice > 0) {
      setLunaPrice(String(savedLunaPrice)); setLunaPriceConfirmed(true); setCatalogCheckOpened(true)
      setState((current) => applyMobileReviewAction(current, { type: "CONFIRM_IMAGE_OK" }))
    }
    setLastActionMessage(saved ? "Continuaste la validación guardada en el servidor." : "Producto abierto desde el ranking canónico. Confirma Luna, eBay y economía antes de preparar el listing.")
    setView("decision")
    window.setTimeout(() => confirmationRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }), 50)
    return true
  }

  useEffect(() => {
    if (!selectedQueueOpportunity || !selectedRadarCandidate) return
    const timer = window.setTimeout(() => {
      void (async () => {
        setServerSaveState("Guardando en servidor…")
        try {
          const { data, error } = await supabase.auth.getSession()
          if (error || !data.session) throw new Error("AUTH_REQUIRED")
          const confirmedFields = [
            ...(identityComparison.identityComparisonComplete ? ["identity"] : []),
            ...(state.stockQuantityConfirmed ? ["stock"] : []),
            ...(lunaPriceConfirmed && state.imageConfirmed ? ["luna_catalog"] : []),
            ...(sellerKeywordDemand ? ["ebay_evidence"] : []),
            ...(opportunityAssessment?.economics?.estimatedNetProfit != null ? ["economics"] : []),
          ]
          const currentStep = !state.stockQuantityConfirmed || !lunaPriceConfirmed
            ? "luna"
            : !sellerKeywordDemand
              ? "ebay"
              : opportunityAssessment?.economics?.estimatedNetProfit == null
                ? "economics"
                : "listing"
          const response = await fetch("/api/admin/ebay/command-center", {
            method: "POST",
            cache: "no-store",
            headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "save_review",
              opportunityId: selectedQueueOpportunity.id,
              candidateKey: selectedQueueOpportunity.candidate_key,
              status: opportunityAssessment?.canProceedToListingPackage === true && !marketValidation.pendingGuards.length
                ? "ready_for_package"
                : "in_progress",
              currentStep,
              confirmedFields,
              blockers: marketValidation.pendingGuards,
              formData: {
                productTitle: selectedRadarCandidate.productTitle,
                marketRadarProductId: selectedRadarCandidate.marketRadarProductId,
                stockQuantity: state.stockQuantityConfirmed,
                lunaPrice: lunaPrice ? Number(lunaPrice) : null,
                lunaPriceConfirmed,
                imageConfirmed: state.imageConfirmed,
                identityConfirmed: identityComparison.identityComparisonComplete,
                ebayListingUrl,
                ebayObservedTitle,
                sellerKeywordDemand,
                opportunityAssessment,
              },
            }),
          })
          const payload = await readMobileReviewJson<{
            success?: boolean
            error?: string
            savedAt?: string
          }>(response, "No se pudo guardar la revisión")
          if (!payload.success) throw new Error(getMobileReviewPayloadError(payload, "No se pudo guardar la revisión"))
          const savedAt = payload.savedAt ? new Date(payload.savedAt) : new Date()
          setServerSaveState(`Guardado ${new Intl.DateTimeFormat("es", { timeStyle: "short" }).format(savedAt)}`)
          void loadServerReviews()
        } catch {
          setServerSaveState("No se pudo guardar · reintenta con conexión")
        }
      })()
    }, 800)
    return () => window.clearTimeout(timer)
  }, [selectedQueueOpportunity, selectedRadarCandidate, state.stockQuantityConfirmed, state.imageConfirmed, lunaPrice, lunaPriceConfirmed, identityComparison.identityComparisonComplete, ebayListingUrl, ebayObservedTitle, sellerKeywordDemand, opportunityAssessment, marketValidation.pendingGuards, loadServerReviews])

  const resetIdentityConfirmation = () => {
    setState((current) =>
      applyMobileReviewAction(current, {
        type: "RESET_SAME_PRODUCT_CONFIRMATION",
      })
    )
  }

  const confirmIdentityComparison = () => {
    if (!identityComparison.canConfirmSameProduct) return
    act({ type: "CONFIRM_SAME_PRODUCT" })
    setLastActionMessage(
      "Identidad confirmada contra el comparable elegido del análisis read-only de eBay."
    )
  }

  const runSellerKeywordDemandValidation = async () => {
    if (!selectedRadarCandidate || sellerKeywordDemandLoading || !state.stockQuantityConfirmed || !lunaPriceConfirmed || !state.imageConfirmed) return
    setSellerKeywordDemandLoading(true)
    setSellerKeywordDemandError("")
    setSellerKeywordDemand(null)
    setOpportunityAssessment(null)
    setEbayListingUrl("")
    setEbayObservedTitle("")
    setEbayReferenceOpened(false)
    setIdentityChecks({ sameProductAndBrand: false, sameVariantSizeOrPack: false, compatibleReference: false })
    resetIdentityConfirmation()
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error || !data.session) throw new Error("AUTH_REQUIRED")
      const response = await fetch("/api/admin/ebay/seller-keyword-demand", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productName: selectedRadarCandidate.productName,
          productTitle: selectedRadarCandidate.productTitle,
          variantTitle: selectedRadarCandidate.variantTitle,
          supplierSku: selectedRadarCandidate.supplierSku,
          categoryId: selectedRadarCandidate.categoryId,
          candidateKey: `luna-portex:${selectedRadarCandidate.supplierProductId}:${selectedRadarCandidate.supplierVariantId ?? selectedRadarCandidate.supplierSku ?? "unknown"}`,
          marketRadarProductId: selectedRadarCandidate.marketRadarProductId,
          supplierProductId: selectedRadarCandidate.supplierProductId,
          supplierVariantId: selectedRadarCandidate.supplierVariantId,
          brand: selectedRadarCandidate.brand,
          gtin: selectedRadarCandidate.gtin,
          productType: selectedRadarCandidate.productType,
          supplierCost: lunaPriceConfirmed ? Number(lunaPrice) : selectedRadarCandidate.lunaPrice,
          available: selectedRadarCandidate.availabilityStatus === "AVAILABLE",
          inventoryQuantity: state.stockQuantityConfirmed ?? selectedRadarCandidate.stockQuantity,
          stockCapturedAt: selectedRadarCandidate.lastSnapshotAt,
          weight: selectedRadarCandidate.weight,
          weightUnit: selectedRadarCandidate.weightUnit,
          imageUrls: selectedRadarCandidate.imageReference ? [selectedRadarCandidate.imageReference] : [],
          imageAuthorized: state.imageConfirmed,
          restrictionGuards: marketValidation.restrictionGuards,
        }),
      })
      const payload = await readMobileReviewJson<{
        success?: boolean
        error?: string
        report?: EbaySellerKeywordDemandReport
        opportunityAssessment?: EbayLunaOpportunityAssessment
      }>(response, "No se pudo consultar la evidencia read-only de eBay")
      if (!payload.success || !payload.report) {
        throw new Error(getMobileReviewPayloadError(payload, "EBAY_READONLY_MARKET_VALIDATION_FAILED"))
      }
      setSellerKeywordDemand(payload.report)
      setOpportunityAssessment(payload.opportunityAssessment ?? null)
      setLastActionMessage(
        `eBay analizado en modo read-only: ${payload.report.eligibleComparableListings} comparables y ${payload.report.sellersAnalyzed} vendedores.`
      )
    } catch (error) {
      const code = getMobileReviewRequestError(error, "EBAY_READONLY_MARKET_VALIDATION_FAILED")
      setSellerKeywordDemandError(
        code === "EBAY_READONLY_ENV_MISSING"
          ? "EBAY_READONLY_ENV_MISSING · Las credenciales read-only de eBay todavía no están configuradas en este Preview."
          : code === "AUTH_REQUIRED"
            ? "La sesión admin expiró. Inicia sesión y vuelve a intentar."
            : `No se pudo consultar la evidencia de eBay. No se registró ninguna validación. ${code}`
      )
    } finally {
      setSellerKeywordDemandLoading(false)
    }
  }

  const chooseEbayComparable = (
    comparable: EbaySellerKeywordDemandReport["topSellingListings"][number]
  ) => {
    if (!comparable.itemWebUrl || !comparable.eligibleComparable) return
    setEbayListingUrl(comparable.itemWebUrl)
    setEbayObservedTitle(comparable.title)
    setEbayReferenceOpened(true)
    setIdentityChecks({
      sameProductAndBrand: true,
      sameVariantSizeOrPack: true,
      compatibleReference: true,
    })
    resetIdentityConfirmation()
    setLastActionMessage(
      `Comparable seleccionado: ${comparable.salesQuantity} ventas señaladas por eBay; falta tu confirmación final de identidad.`
    )
  }

  const resetStockConfirmation = (value: string) => {
    setStockQuantity(value)
    setState((current) =>
      applyMobileReviewAction(
        current,
        { type: "RESET_STOCK_CONFIRMATION" }
      )
    )
  }

  const resetLunaCatalogConfirmation = (value: string) => {
    setLunaPrice(value)
    setLunaPriceConfirmed(false)
    setState((current) =>
      applyMobileReviewAction(
        current,
        { type: "RESET_LUNA_CATALOG_CONFIRMATION" }
      )
    )
  }

  const confirmLunaCatalogMatch = () => {
    const price = Number(lunaPrice)
    if (!catalogCheckOpened || !lunaCatalogUrl || !safeProductImageUrl || !(price > 0)) return
    setLunaPriceConfirmed(true)
    setState((current) =>
      applyMobileReviewAction(
        current,
        { type: "CONFIRM_IMAGE_OK" }
      )
    )
    setLastActionMessage(
      `Precio USD ${price.toFixed(2)} e imagen confirmados contra el catálogo de Luna Portex.`
    )
  }

  const sourceLabel = report.dataSource === "MARKET_RADAR_READONLY" ? "REAL RADAR" : report.dataSource === "DEMO_FIXTURE_ONLY" ? "DEMO" : loadState === "AUTH_REQUIRED" ? "SESIÓN REQUERIDA" : loadState === "RADAR_REQUEST_FAILED" ? "ERROR DE RADAR" : "SIN DATOS"
  const professionalKeywordSignals = sellerKeywordDemand
    ? sellerKeywordDemand.keywordEvidenceGroups.verifiedHistoricalMultiSeller.length
      ? sellerKeywordDemand.keywordEvidenceGroups.verifiedHistoricalMultiSeller
      : sellerKeywordDemand.keywordEvidenceGroups.estimatedMultiSellerSignal
    : []
  const professionalKeywordSignalsAreVerified = Boolean(
    sellerKeywordDemand?.keywordEvidenceGroups.verifiedHistoricalMultiSeller.length
  )
  const alertCount = serverAlerts.activeListingRisks.length + serverAlerts.outbox.length + report.stockHoldCandidates.length
  const tabs: { id: View; label: string; count?: number }[] = [{ id: "opportunities", label: "Oportunidades" }, { id: "pinned", label: "En curso", count: serverReviews.length || pinnedCandidates.length }, { id: "decision", label: "Cockpit" }, { id: "blocked", label: "Alertas", count: alertCount }]

  return (
    <main className="min-h-screen bg-[#05070d] px-4 pb-48 pt-4 text-white sm:px-6">
      <section className="mx-auto flex max-w-xl flex-col gap-4">
        <header className="sticky top-0 z-30 -mx-4 border-b border-white/10 bg-[#05070d]/95 px-4 pb-3 pt-2 backdrop-blur">
          <div className="flex items-center justify-between gap-3"><a href="/admin/ebay-seller-os" className="min-h-11 rounded-full border border-white/20 px-4 py-3 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200">← Seller OS</a><button type="button" onClick={() => void load()} disabled={loading} className="min-h-11 rounded-full border border-cyan-200/35 px-4 py-3 text-sm font-bold text-cyan-50 disabled:opacity-50">{loading ? "Cargando…" : "↻ Actualizar"}</button></div>
          <div className="mt-3 flex items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-cyan-100">eBay read-only · progreso sincronizado</p><h1 className="mt-1 text-2xl font-black">Seller Command Center</h1></div><StatusPill tone={report.dataSource === "MARKET_RADAR_READONLY" ? "good" : report.fixtureUsed ? "warning" : "danger"}>{sourceLabel}</StatusPill></div>
        </header>

        <section className={`rounded-3xl border p-4 ${loadState === "READY" ? "border-emerald-200/25 bg-emerald-200/[0.07]" : "border-amber-200/25 bg-amber-200/[0.07]"}`}>
          <p className="font-black">{loadMessage}</p><p className="mt-2 text-sm text-white/75">eBay read-only · scans y cola guardados en Supabase · publicación separada y desactivada.</p>
          <p className="sr-only">Radar observó {report.realRadarCandidatesCount} productos y muestra {report.top5Candidates.length} candidatos seleccionables. La fuente y antigüedad del stock están disponibles en los detalles.</p>
          {loadState === "AUTH_REQUIRED" ? <a href="/admin/login?returnTo=%2Fadmin%2Febay%2Fmobile-review" className="mt-3 inline-flex min-h-11 items-center rounded-2xl bg-white px-4 py-2 font-black text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200">Iniciar sesión</a> : loadState !== "READY" && <button type="button" onClick={() => void load()} className="mt-3 min-h-11 rounded-2xl bg-white px-4 py-2 font-black text-black">Reintentar lectura</button>}
        </section>
        {loadState === "READY" && <dl className="grid grid-cols-3 gap-2 rounded-2xl border border-white/15 bg-black/30 p-2 text-center"><div className="rounded-xl bg-white/[0.04] px-2 py-3"><dt className="text-[10px] font-bold uppercase tracking-wide text-white/55">Observados</dt><dd className="mt-1 text-xl font-black">{report.realRadarCandidatesCount}</dd></div><div className="rounded-xl bg-emerald-200/[0.07] px-2 py-3"><dt className="text-[10px] font-bold uppercase tracking-wide text-emerald-50/70">En curso</dt><dd className="mt-1 text-xl font-black">{serverReviews.length}</dd></div><div className="rounded-xl bg-rose-200/[0.07] px-2 py-3"><dt className="text-[10px] font-bold uppercase tracking-wide text-rose-50/70">Alertas</dt><dd className="mt-1 text-xl font-black">{alertCount}</dd></div></dl>}
        <ol className="grid grid-cols-4 gap-1 rounded-2xl border border-white/10 bg-black/25 p-2 text-center text-[10px] font-black uppercase tracking-wide text-white/60"><li className={view === "opportunities" ? "rounded-xl bg-violet-200 px-1 py-2 text-black" : "px-1 py-2"}>1 Descubrir</li><li className={view === "top5" || view === "pinned" ? "rounded-xl bg-cyan-200 px-1 py-2 text-black" : "px-1 py-2"}>2 Validar</li><li className={view === "decision" ? "rounded-xl bg-emerald-200 px-1 py-2 text-black" : "px-1 py-2"}>3 Preparar</li><li className="px-1 py-2 text-white/35">4 Publicar</li></ol>
        {report.fixtureUsed && <aside className="rounded-3xl border border-amber-200/30 bg-amber-200/[0.08] p-4 text-sm"><p className="font-black">FIXTURE/DEMO · no usar para aprobación real</p><p className="mt-2 text-white/80">Fuente actual: fixture modelado · no es data viva. score modelado · Fixture · no precio runtime · Fixture · no Category ID.</p></aside>}

        <div role="status" aria-live="polite" className="rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.07] p-3 text-sm text-cyan-50">{lastActionMessage}</div>
        {view === "top5" && radarGuards.showScoreTieWarning && <aside className="rounded-3xl border border-amber-200/30 bg-amber-200/[0.08] p-4"><p className="font-black">Orden provisional</p><p className="mt-1 text-sm text-white/80">Los cinco scores son iguales. Ningún producto se considera recomendado hasta desempatar el ranking.</p></aside>}

        <nav aria-label="Secciones de Mobile Review" className="flex gap-1 overflow-x-auto rounded-2xl border border-white/15 bg-black/40 p-1">
          {tabs.map((tab) => <button key={tab.id} type="button" aria-current={view === tab.id ? "page" : undefined} onClick={() => setView(tab.id)} className={`min-h-12 shrink-0 rounded-xl px-3 py-2 text-[11px] font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 ${view === tab.id ? "bg-white text-black" : "text-white/75"}`}>{tab.label}{tab.count !== undefined && <span className="ml-1 rounded-full bg-black/20 px-1.5 py-0.5">{tab.count}</span>}</button>)}
        </nav>
        <p className="sr-only">{report.stockHoldCandidates.length} productos están bloqueados por stock. B2-RUN continúa desactivado hasta completar todas las validaciones.</p>

        {view === "opportunities" && <OpportunityCommandCenter onReviewCandidate={reviewOpportunityCandidate} onRadarRefresh={load} onRadarLookup={lookupRadarCandidateByProductId} />}

        {view === "top5" && <section aria-labelledby="top5-heading"><h2 id="top5-heading" className="mb-3 text-xl font-black">Top 5 actual</h2><div className="space-y-4">{report.top5Candidates.map((candidate) => <CandidateCard key={candidate.candidateId} candidate={candidate} selected={!selectedQueueCandidate && state.selectedCandidateRank === candidate.candidateRank} pinned={pinnedCandidates.some((item) => pinnedCandidateMatchesRadar(item, candidate))} provisional={radarGuards.needsScoreDisambiguation} onSelect={() => { setSelectedQueueCandidate(null); setSelectedQueueOpportunity(null); act({ type: "SELECT_CANDIDATE", rank: candidate.candidateRank }) }} onUnavailable={() => act({ type: "MARK_UNAVAILABLE", rank: candidate.candidateRank })} />)}{!loading && report.top5Candidates.length === 0 && <p className="rounded-3xl border border-white/15 p-6 text-center text-white/75">No hay candidatos seleccionables.</p>}</div></section>}

        {view === "pinned" && <section aria-labelledby="server-reviews-heading" className="space-y-3"><div><p className="text-xs font-black uppercase tracking-widest text-cyan-100/60">Guardado server-side</p><h2 id="server-reviews-heading" className="mt-1 text-xl font-black">Continuar donde quedé</h2></div>{serverReviews.map((review) => <article key={review.id} className="rounded-3xl border border-cyan-200/20 bg-cyan-200/[0.05] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase text-cyan-100">{routeLabel(review.current_step)}</p><h3 className="mt-2 font-black">{review.opportunity?.product_title ?? String(review.form_data.productTitle ?? "Producto en revisión")}</h3></div><StatusPill>{review.status.replaceAll("_", " ")}</StatusPill></div><p className="mt-2 text-xs text-white/55">Guardado {formatDate(review.updated_at)}</p>{review.opportunity ? <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => reviewOpportunityCandidate(review.opportunity!)} className="min-h-12 rounded-2xl bg-cyan-200 px-3 font-black text-black">Continuar validación</button><a href={`/admin/ebay/listing-workspace?opportunity=${encodeURIComponent(review.opportunity_id)}&candidate=${encodeURIComponent(review.candidate_key)}`} className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-emerald-200/30 px-3 text-center font-black text-emerald-50">Workspace</a></div> : <p className="mt-3 text-sm text-amber-100">La oportunidad ya no está entre las primeras 100; sus datos siguen guardados.</p>}</article>)}{serverReviews.length === 0 && <p className="rounded-3xl border border-white/15 p-6 text-center text-white/70">Todavía no hay revisiones guardadas en el servidor.</p>}<details className="rounded-2xl border border-white/10 p-3"><summary className="cursor-pointer text-sm font-bold">Revisiones locales anteriores</summary><p className="mt-2 text-xs text-white/60">En revisión / Pinned Candidates · {pinnedContinuity.pinnedCandidates.length} guardadas en este navegador.</p><span className="sr-only">RECHECK_PINNED_CANDIDATE CONTINUE_EBAY_MARKET_VALIDATION MARK_PINNED_UNAVAILABLE HOLD_PINNED_FOR_REVIEW UNPIN_CANDIDATE BROWSER_STATE_OR_LOCAL_STORAGE</span></details></section>}

        {view === "blocked" && <section aria-labelledby="blocked-heading" className="space-y-4"><div><p className="text-xs font-black uppercase tracking-widest text-rose-100/60">Acción prioritaria</p><h2 id="blocked-heading" className="mt-1 text-xl font-black">Alertas Luna ↔ eBay</h2><p className="mt-1 text-sm text-white/65">Primero se muestran riesgos de listings activos; después, productos Luna detenidos por stock.</p></div><article className="rounded-3xl border border-emerald-200/20 bg-emerald-200/[0.05] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-widest text-emerald-100/60">Canal profesional</p><h3 className="mt-1 font-black">WhatsApp Seller Alerts</h3></div><StatusPill tone={whatsappStatus.configuration?.status === "READY" ? "good" : "warning"}>{whatsappStatus.configuration?.status ?? "CARGANDO"}</StatusPill></div><p className="mt-2 text-sm leading-6 text-white/65">Inmediatas: ganador verificado, listing sin stock, stock 1–3, costo +5%, vínculo roto y fallo de draft. Bajas de costo menores y reposiciones no urgentes van al resumen.</p><dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Pendientes</dt><dd className="mt-1 font-black">{whatsappStatus.health?.pending ?? 0}</dd></div><div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Fallidos</dt><dd className="mt-1 font-black">{whatsappStatus.health?.failed ?? 0}</dd></div><div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Dead letter</dt><dd className="mt-1 font-black">{whatsappStatus.health?.deadLetter ?? 0}</dd></div></dl>{whatsappStatus.configuration?.status !== "READY" && <p className="mt-3 rounded-2xl border border-amber-200/20 p-3 text-xs leading-5 text-amber-50">Envíos reales bloqueados hasta configurar destinatario server-side, dos templates aprobados y activar el feature flag. Preflight: {whatsappStatus.configuration?.preflightStatus ?? "NOT_RUN"}.</p>}<div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => void runWhatsAppPreflight()} disabled={whatsappPreflightRunning} className="min-h-11 rounded-2xl bg-emerald-200 px-3 text-sm font-black text-black disabled:opacity-50">{whatsappPreflightRunning ? "Validando…" : "Validar Meta"}</button><button type="button" onClick={() => void loadWhatsAppStatus()} className="min-h-11 rounded-2xl border border-emerald-200/25 px-3 text-sm font-black">Actualizar</button></div></article>{serverAlerts.activeListingRisks.map((risk) => <article key={risk.id} className="rounded-3xl border border-rose-200/30 bg-rose-200/[0.08] p-4"><StatusPill tone="danger">{risk.risk_priority.toUpperCase()} · {risk.risk_type.replaceAll("_", " ")}</StatusPill><h3 className="mt-3 font-black">{risk.risk_summary}</h3>{risk.recommended_action && <p className="mt-2 text-sm leading-6 text-white/70">Siguiente acción: {risk.recommended_action}</p>}</article>)}{serverAlerts.outbox.filter((alert) => !serverAlerts.activeListingRisks.some((risk) => risk.id === String(alert.payload.riskId ?? ""))).slice(0, 10).map((alert) => <article key={alert.id} className="rounded-2xl border border-amber-200/20 bg-amber-200/[0.05] p-3"><p className="text-xs font-black uppercase text-amber-100">{alert.priority} · {alert.alert_type.replaceAll("_", " ")}</p><p className="mt-1 text-xs text-white/55">Notificación {alert.status} · {formatDate(alert.created_at)}</p></article>)}{serverAlerts.activeListingRisks.length === 0 && <p className="rounded-2xl border border-emerald-200/20 bg-emerald-200/[0.05] p-4 text-sm text-emerald-50">No hay riesgos abiertos en listings vinculados. Sincroniza tus listings activos desde Oportunidades para ampliar la cobertura.</p>}<details className="rounded-3xl border border-white/10 p-4" open={serverAlerts.activeListingRisks.length === 0}><summary className="cursor-pointer font-black">Bloqueados por stock Luna · {report.stockHoldCandidates.length}</summary><div className="mt-3 space-y-3">{report.stockHoldCandidates.slice(0, blockedVisible).map((candidate) => <article key={candidate.candidateId} className="rounded-2xl border border-rose-200/20 bg-rose-200/[0.06] p-4"><h3 className="font-black">{candidate.productTitle}</h3><p className="mt-2 text-sm text-white/75">{routeLabel(candidate.routeRecommendation)} · último scan {formatDate(candidate.lastSeenAt)}</p><p className="mt-2 break-all text-xs text-white/50">SKU: {formatValue(candidate.supplierSku)}</p></article>)}</div>{blockedVisible < report.stockHoldCandidates.length && <button type="button" onClick={() => setBlockedVisible((value) => value + 20)} className="mt-4 min-h-12 w-full rounded-2xl border border-white/25 font-black">Mostrar 20 más</button>}</details></section>}

        {view === "decision" && (
          <section
            ref={confirmationRef}
            className="scroll-mt-32 space-y-4"
            aria-labelledby="decision-heading"
          >
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="decision-heading" className="text-xl font-black">
                  Candidato seleccionado
                </h2>
                {radarGuards.needsScoreDisambiguation && (
                  <StatusPill tone="warning">No recomendado todavía</StatusPill>
                )}
              </div>
              <p className="mt-1 text-sm text-white/75">
                {selectedRadarCandidate?.productTitle ?? decision.selectedCandidateName ?? "Selecciona un producto desde Top 5."}
              </p>
              {selectedRadarCandidate && (
                <div className="mt-3 rounded-2xl border border-white/15 bg-black/25 p-3">
                  <div className="flex items-center justify-between gap-3 text-xs font-bold">
                    <span>Confirmaciones locales</span>
                    <span>{localConfirmationCount} de 3</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-cyan-200 transition-all"
                      style={{ width: `${(localConfirmationCount / 3) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {selectedRadarCandidate && (
              <>
                <section aria-labelledby="luna-first-heading" className="rounded-3xl border border-emerald-200/25 bg-emerald-200/[0.06] p-4">
                  <p className="text-xs font-black uppercase tracking-widest text-emerald-100/65">Paso 1 · Bodega ahora</p>
                  <h3 id="luna-first-heading" className="mt-1 text-lg font-black">Confirmar Luna: stock, costo e imagen</h3>
                  <p className="mt-2 text-sm leading-6 text-white/65">eBay se analiza después de confirmar que todavía podemos comprar y enviar exactamente este producto.</p>
                  <div className="mt-3 overflow-hidden rounded-2xl border border-white/15 bg-white">{safeProductImageUrl ? <img src={safeProductImageUrl} alt={`Imagen de ${selectedRadarCandidate.productTitle} registrada por Radar`} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="max-h-64 w-full object-contain" /> : <div className="flex min-h-32 items-center justify-center bg-black/90 p-4 text-center text-sm font-bold text-white/60">Imagen de Luna no disponible</div>}</div>
                  {lunaCatalogUrl ? <a href={lunaCatalogUrl} target="_blank" rel="noreferrer" onClick={() => setCatalogCheckOpened(true)} className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-emerald-200/35 px-4 text-center font-black text-emerald-50">Abrir producto en Luna Portex ↗</a> : <p className="mt-3 rounded-2xl border border-rose-200/25 p-3 text-sm text-rose-50">Falta URL válida del catálogo Luna.</p>}
                  <div className="mt-3 grid grid-cols-2 gap-2"><label><span className="text-xs font-bold text-white/60">Stock observado</span><input inputMode="numeric" pattern="[0-9]*" placeholder="Ej. 8" value={stockQuantity} onChange={(event) => resetStockConfirmation(event.target.value.replace(/\D/g, ""))} className="mt-1 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-3" /></label><label><span className="text-xs font-bold text-white/60">Costo Luna USD</span><input inputMode="decimal" placeholder="Ej. 4.00" value={lunaPrice} onChange={(event) => resetLunaCatalogConfirmation(event.target.value)} className="mt-1 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-3" /></label></div>
                  <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" disabled={!Number.isInteger(Number(stockQuantity)) || Number(stockQuantity) < 1} onClick={() => act({ type: "CONFIRM_STOCK_QTY", quantity: Number(stockQuantity) })} className="min-h-12 rounded-2xl bg-white px-2 text-sm font-black text-black disabled:opacity-40">{state.stockQuantityConfirmed === Number(stockQuantity) ? "✓ Stock" : "Confirmar stock"}</button><button type="button" disabled={!catalogCheckOpened || !lunaCatalogUrl || !safeProductImageUrl || !(Number(lunaPrice) > 0)} onClick={confirmLunaCatalogMatch} className="min-h-12 rounded-2xl bg-emerald-200 px-2 text-sm font-black text-black disabled:opacity-40">{lunaPriceConfirmed && state.imageConfirmed ? "✓ Costo e imagen" : "Confirmar costo e imagen"}</button></div>
                </section>
                <div className="rounded-3xl border border-white/15 bg-white/[0.045] p-4">
                  <p className="font-black">2. eBay: Listings y keywords que están vendiendo</p>
                  <p className="mt-1 text-sm leading-6 text-white/75">
                    IMNOVA consulta eBay en modo read-only, descarta productos con
                    tamaño, variante o pack contradictorios y pondera las palabras
                    por ventas observadas. No copia títulos ni imágenes.
                  </p>
                  <dl className="mt-3 grid gap-2 rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.06] p-3 text-sm">
                    <div><dt className="text-white/55">Producto en Luna</dt><dd className="mt-1 font-black">{selectedRadarCandidate.productTitle}</dd></div>
                    <div className="grid grid-cols-2 gap-2"><div><dt className="text-white/55">Variante</dt><dd className="font-bold">{formatValue(selectedRadarCandidate.variantTitle)}</dd></div><div><dt className="text-white/55">SKU</dt><dd className="break-all font-bold">{formatValue(selectedRadarCandidate.supplierSku)}</dd></div></div>
                  </dl>
                  <button
                    type="button"
                    disabled={sellerKeywordDemandLoading || !state.stockQuantityConfirmed || !lunaPriceConfirmed || !state.imageConfirmed}
                    onClick={() => void runSellerKeywordDemandValidation()}
                    className="mt-3 min-h-14 w-full rounded-2xl bg-cyan-200 px-4 font-black text-black disabled:opacity-50"
                  >
                    {sellerKeywordDemandLoading
                      ? "Analizando vendedores y ventas…"
                      : sellerKeywordDemand
                        ? "↻ Actualizar análisis de eBay"
                        : !state.stockQuantityConfirmed || !lunaPriceConfirmed || !state.imageConfirmed
                          ? "Completa Luna antes de analizar eBay"
                          : "Analizar listings y ventas en eBay"}
                  </button>

                  {sellerKeywordDemandError && (
                    <div role="alert" className="mt-3 rounded-2xl border border-rose-200/30 bg-rose-200/[0.08] p-3 text-sm text-rose-50">
                      <p className="font-bold">{sellerKeywordDemandError}</p>
                      <a href={ebayIdentitySearchUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center underline">Abrir búsqueda de respaldo en eBay ↗</a>
                    </div>
                  )}

                  {sellerKeywordDemand && (
                    <div className="mt-4 space-y-4">
                      <div className="rounded-2xl border border-emerald-200/25 bg-emerald-200/[0.07] p-3">
                        <div className="flex flex-wrap gap-2">
                          <StatusPill tone={sellerKeywordDemand.salesEvidenceAvailable ? "good" : "warning"}>{sellerKeywordDemand.evidenceLevel.replaceAll("_", " ")}</StatusPill>
                          <StatusPill>{sellerKeywordDemand.eligibleComparableListings} comparables</StatusPill>
                          <StatusPill>{sellerKeywordDemand.sellersAnalyzed} vendedores</StatusPill>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-white/80">{sellerKeywordDemand.evidenceDisclaimer}</p>
                        {sellerKeywordDemand.insightsAvailability !== "AVAILABLE" && (
                          <p className="mt-2 text-xs leading-5 text-amber-100"><strong>{sellerKeywordDemand.marketplaceInsightsStatus}</strong> · {sellerKeywordDemand.marketplaceInsightsStatus === "MARKETPLACE_INSIGHTS_NOT_ENABLED" ? "Marketplace Insights está desactivado por configuración; no se intentó usar ese permiso." : "eBay no entregó historial vendido autorizado para esta consulta."} Se usa Browse como fallback estimado cuando eBay expone esa señal; nunca se presenta como venta histórica verificada.</p>
                        )}
                      </div>

                      <section aria-labelledby="sales-keywords-heading">
                        <h3 id="sales-keywords-heading" className="font-black">{sellerKeywordDemand.keywordEvidenceHeading}</h3>
                        <p className="mt-1 text-xs leading-5 text-white/65">
                          {professionalKeywordSignalsAreVerified
                            ? "Estas palabras tienen historial vendido oficial en al menos dos vendedores comparables."
                            : "Estas palabras se repiten en al menos dos vendedores con cantidad vendida estimada por eBay. No son ventas históricas verificadas."}
                        </p>
                        {professionalKeywordSignals.length ? (
                          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                            {professionalKeywordSignals.slice(0, 8).map((keyword) => (
                              <li key={keyword.term} className="rounded-2xl border border-white/15 bg-black/25 p-3">
                                <p className="font-black text-cyan-50">{keyword.term}</p>
                                <p className="mt-1 text-xs text-white/65">
                                  {professionalKeywordSignalsAreVerified
                                    ? `Historial verificado: ${keyword.verifiedSoldQuantity}`
                                    : `Señal estimada: ${keyword.estimatedSoldQuantity}`} · {professionalKeywordSignalsAreVerified ? keyword.verifiedSellerCount : keyword.estimatedSellerCount} vendedores
                                </p>
                                <p className="mt-1 text-[11px] font-bold text-white/45">Rol: {keyword.keywordRole.replaceAll("_", " ")}</p>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2 rounded-2xl border border-amber-200/25 bg-amber-200/[0.07] p-3 text-sm text-amber-50">Todavía no hay señal suficiente entre varios vendedores. Ninguna palabra se marcará como keyword ganadora.</p>
                        )}
                      </section>

                      {sellerKeywordDemand.singleSellerKeywordObservations.length > 0 && (
                        <details className="rounded-2xl border border-amber-200/20 bg-amber-200/[0.05] p-3">
                          <summary className="cursor-pointer text-sm font-black">Señales exploratorias de un solo vendedor</summary>
                          <p className="mt-2 text-xs leading-5 text-amber-50">Sirven para investigar, pero no se consideran keywords ganadoras ni evidencia de mercado.</p>
                          <ul className="mt-2 flex flex-wrap gap-2">
                            {sellerKeywordDemand.singleSellerKeywordObservations.slice(0, 8).map((keyword) => (
                              <li key={keyword.term} className="rounded-full border border-amber-200/25 px-3 py-1.5 text-xs">{keyword.term} · 1 vendedor</li>
                            ))}
                          </ul>
                        </details>
                      )}

                      <section aria-labelledby="listing-keyword-structure-heading" className="rounded-2xl border border-violet-200/25 bg-violet-200/[0.07] p-3">
                        <h3 id="listing-keyword-structure-heading" className="font-black">Estructura profesional recomendada</h3>
                        <dl className="mt-3 grid gap-2 text-sm">
                          <div><dt className="text-white/55">Frase principal</dt><dd className="font-black text-violet-50">{sellerKeywordDemand.recommendedListingKeywordStructure.primarySearchPhrase ?? "Pendiente por falta de señal multi-vendedor"}</dd></div>
                          <div><dt className="text-white/55">Términos secundarios</dt><dd className="font-bold">{sellerKeywordDemand.recommendedListingKeywordStructure.secondarySearchTerms.join(" · ") || "Ninguno confirmado"}</dd></div>
                          <div><dt className="text-white/55">Atributos confirmados en Luna</dt><dd className="font-bold">{sellerKeywordDemand.recommendedListingKeywordStructure.confirmedAttributes.join(" · ") || "Ninguno confirmado"}</dd></div>
                          <div><dt className="text-white/55">Fórmula de título</dt><dd className="leading-5">{sellerKeywordDemand.recommendedListingKeywordStructure.titleFormula}</dd></div>
                          <div><dt className="text-white/55">Confianza</dt><dd className="font-black">{sellerKeywordDemand.recommendedListingKeywordStructure.strategyConfidence.replaceAll("_", " ")}</dd></div>
                        </dl>
                        {sellerKeywordDemand.recommendedListingKeywordStructure.termsToKeepExploratory.length > 0 && (
                          <p className="mt-3 text-xs leading-5 text-white/60">Mantener fuera del título principal hasta confirmar: {sellerKeywordDemand.recommendedListingKeywordStructure.termsToKeepExploratory.join(" · ")}.</p>
                        )}
                      </section>

                      <section aria-labelledby="buyer-intent-heading" className="rounded-2xl border border-emerald-200/25 bg-emerald-200/[0.07] p-3">
                        <h3 id="buyer-intent-heading" className="font-black">Intención de compra con mayor potencial</h3>
                        <p className="mt-2 font-black text-emerald-50">{sellerKeywordDemand.highestPotentialBuyerIntent.buyerProfileLabel}</p>
                        <p className="mt-1 text-sm leading-6 text-white/75">{sellerKeywordDemand.highestPotentialBuyerIntent.explanation}</p>
                        <div className="mt-2 flex flex-wrap gap-2"><StatusPill>{sellerKeywordDemand.highestPotentialBuyerIntent.intentType.replaceAll("_", " ")}</StatusPill><StatusPill tone={professionalKeywordSignalsAreVerified ? "good" : "warning"}>{sellerKeywordDemand.highestPotentialBuyerIntent.potentialLevel.replaceAll("_", " ")}</StatusPill></div>
                        <p className="mt-2 text-[11px] text-white/50">Perfil de intención agregado; no utiliza datos personales de compradores.</p>
                      </section>

                      {opportunityAssessment && (
                        <section aria-labelledby="professional-opportunity-heading" className="rounded-2xl border border-cyan-200/25 bg-cyan-200/[0.07] p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                          <h3 id="professional-opportunity-heading" className="font-black">3. Economía y oportunidad profesional</h3>
                              <p className="mt-1 text-xs leading-5 text-white/65">Combina identidad, demanda, economía, competencia, stock y preparación del listing. No garantiza ventas.</p>
                            </div>
                            <span className="rounded-2xl bg-cyan-100 px-3 py-2 text-xl font-black text-black">{Math.round(opportunityAssessment.scores.opportunityScore)}</span>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                            <div className="rounded-xl bg-black/25 p-2"><p className="text-white/50">Demanda</p><p className="mt-1 font-black">{Math.round(opportunityAssessment.scores.demandScore)}</p></div>
                            <div className="rounded-xl bg-black/25 p-2"><p className="text-white/50">Economía</p><p className="mt-1 font-black">{Math.round(opportunityAssessment.scores.economicsScore)}</p></div>
                            <div className="rounded-xl bg-black/25 p-2"><p className="text-white/50">Identidad</p><p className="mt-1 font-black">{Math.round(opportunityAssessment.scores.identityScore)}</p></div>
                            <div className="rounded-xl bg-black/25 p-2"><p className="text-white/50">Competencia</p><p className="mt-1 font-black">{Math.round(opportunityAssessment.scores.competitionScore)}</p></div>
                            <div className="rounded-xl bg-black/25 p-2"><p className="text-white/50">Stock</p><p className="mt-1 font-black">{Math.round(opportunityAssessment.scores.supplyScore)}</p></div>
                            <div className="rounded-xl bg-black/25 p-2"><p className="text-white/50">Listing</p><p className="mt-1 font-black">{Math.round(opportunityAssessment.scores.listingReadinessScore)}</p></div>
                          </div>
                          <dl className="mt-3 grid gap-2 text-sm">
                            <div><dt className="text-white/55">Decisión</dt><dd className="font-black text-cyan-50">{opportunityAssessment.decision.replaceAll("_", " ")}</dd></div>
                            <div><dt className="text-white/55">Rotación</dt><dd className="font-bold">{opportunityAssessment.market.rotationEvidenceStatus.replaceAll("_", " ")}</dd></div>
                            <div><dt className="text-white/55">Velocidad semanal observada</dt><dd className="font-bold">{opportunityAssessment.market.totalEstimatedWeeklyVelocity > 0 ? `${opportunityAssessment.market.totalEstimatedWeeklyVelocity} unidades estimadas` : "Se necesita una segunda observación"}</dd></div>
                            <div><dt className="text-white/55">Precio total mediano</dt><dd className="font-bold">{opportunityAssessment.market.medianTotalBuyerPrice === null ? "Pendiente" : `$${opportunityAssessment.market.medianTotalBuyerPrice.toFixed(2)}`}</dd></div>
                            <div><dt className="text-white/55">Beneficio neto estimado</dt><dd className="font-bold">{opportunityAssessment.economics.estimatedNetProfit === null ? "Pendiente" : `$${opportunityAssessment.economics.estimatedNetProfit.toFixed(2)}`}</dd></div>
                            <div><dt className="text-white/55">Categoría oficial</dt><dd className="font-bold">{opportunityAssessment.listingIntelligencePackage.categoryRecommendation.categoryName ?? opportunityAssessment.listingIntelligencePackage.categoryRecommendation.categoryId ?? "Pendiente"}</dd></div>
                            <div><dt className="text-white/55">Aspectos obligatorios</dt><dd className="font-bold">{opportunityAssessment.listingIntelligencePackage.categoryRecommendation.requiredAspects.map((aspect) => aspect.name).join(" · ") || "eBay no devolvió aspectos obligatorios"}</dd></div>
                          </dl>
                          {(opportunityAssessment.hardGates.length > 0 || opportunityAssessment.evidenceGuards.length > 0) && (
                            <details className="mt-3 rounded-xl border border-amber-200/20 bg-amber-200/[0.05] p-3">
                              <summary className="cursor-pointer text-sm font-black">Guardas antes del listing package</summary>
                              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-50">
                                {[...opportunityAssessment.hardGates, ...opportunityAssessment.evidenceGuards].map((guard) => <li key={guard}>{guard.replaceAll("_", " ")}</li>)}
                              </ul>
                            </details>
                          )}
                          <p className="mt-3 text-[11px] leading-5 text-white/50">Una lectura aislada de estimatedSoldQuantity no demuestra rotación. El sistema requiere snapshots separados antes de calcular deltas de 7/30 días.</p>
                        </section>
                      )}

                      <section aria-labelledby="top-selling-heading">
                        <h3 id="top-selling-heading" className="font-black">Comparables para escoger la mejor referencia</h3>
                        <p className="mt-1 text-xs leading-5 text-white/65">El orden combina identidad, calidad de evidencia, señal comercial y reputación. La cantidad estimada por sí sola no decide.</p>
                        <div className="mt-2 grid gap-3">
                          {sellerKeywordDemand.topSellingListings.map((comparable, index) => (
                            <article key={comparable.comparableId} className={`rounded-2xl border p-3 ${ebayListingUrl === comparable.itemWebUrl ? "border-cyan-200/60 bg-cyan-200/[0.08]" : "border-white/15 bg-black/25"}`}>
                              <div className="flex gap-3">
                                {comparable.imageUrl ? (
                                  <img src={comparable.imageUrl} alt="Imagen remota del listing de referencia en eBay" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="size-20 shrink-0 rounded-xl bg-white object-contain" />
                                ) : (
                                  <div className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-white/10 text-center text-[10px] text-white/60">Sin imagen</div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-black text-cyan-100">#{index + 1} · score profesional {comparable.professionalReferenceScore}% · match {comparable.identityMatchScore}%</p>
                                  <p className="mt-1 text-sm font-bold leading-5">{comparable.title}</p>
                                  <p className="mt-1 text-xs text-white/60">{comparable.sellerUsername} · ${comparable.price.toFixed(2)} {comparable.currency}</p>
                                  <p className="mt-1 text-xs font-bold text-emerald-100">
                                    {comparable.verifiedSoldQuantity > 0
                                      ? `${comparable.verifiedSoldQuantity} ventas históricas verificadas`
                                      : comparable.estimatedSoldQuantity > 0
                                        ? `${comparable.estimatedSoldQuantity} ventas estimadas por eBay`
                                        : "Listing activo; ventas no demostradas"}
                                  </p>
                                  <p className="mt-1 text-[11px] font-bold text-white/45">{comparable.referenceRecommendation.replaceAll("_", " ")}</p>
                                </div>
                              </div>
                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                <a href={comparable.itemWebUrl ?? undefined} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/20 px-3 text-center text-sm font-bold">Ver listing ↗</a>
                                <button type="button" disabled={!comparable.itemWebUrl || !comparable.eligibleComparable} onClick={() => chooseEbayComparable(comparable)} className="min-h-11 rounded-xl bg-white px-3 text-sm font-black text-black disabled:opacity-40">
                                  {ebayListingUrl === comparable.itemWebUrl ? "✓ Referencia elegida" : "Usar como referencia"}
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    </div>
                  )}

                  {identityComparison.ebayIdentity.listingUrl && (
                    <div className="mt-4 rounded-2xl border border-cyan-200/25 bg-cyan-200/[0.06] p-3">
                      <p className="text-sm font-black">Confirmación humana final</p>
                      <p className="mt-1 text-xs leading-5 text-white/70">El sistema ya comparó marca/producto, variante, tamaño y pack. Confirma que la referencia elegida corresponde al producto de Luna.</p>
                      <button type="button" disabled={!identityComparison.canConfirmSameProduct} onClick={confirmIdentityComparison} className="mt-3 min-h-12 w-full rounded-2xl bg-cyan-200 px-4 font-black text-black disabled:opacity-40">
                        {identityComparison.identityComparisonComplete
                          ? "✓ Identidad Luna ↔ eBay confirmada"
                          : "Confirmar comparable seleccionado"}
                      </button>
                    </div>
                  )}
                  {identityComparison.identityComparisonComplete && <p className="mt-2 text-xs font-bold text-emerald-100">Fuente: análisis oficial eBay read-only + confirmación humana final.</p>}
                </div>

                <div className="hidden rounded-3xl border border-white/15 bg-white/[0.045] p-4">
                  <label htmlFor="stock-confirmed" className="font-black">
                    2. Cantidad observada
                  </label>
                  <p className="mt-1 text-sm text-white/75">
                    Ingresa manualmente un número entero mayor que cero.
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                    <input
                      id="stock-confirmed"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="Ej. 2"
                      value={stockQuantity}
                      onChange={(event) =>
                        resetStockConfirmation(
                          event.target.value.replace(/\D/g, "")
                        )
                      }
                      className="min-h-12 rounded-2xl border border-white/25 bg-black/30 px-4 text-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200"
                    />
                    <button
                      type="button"
                      disabled={
                        !Number.isInteger(Number(stockQuantity)) ||
                        Number(stockQuantity) < 1
                      }
                      onClick={() =>
                        act({
                          type: "CONFIRM_STOCK_QTY",
                          quantity: Number(stockQuantity),
                        })
                      }
                      className="min-h-12 rounded-2xl bg-cyan-200 px-4 font-black text-black disabled:opacity-40"
                    >
                      {state.stockQuantityConfirmed === Number(stockQuantity)
                        ? `✓ Stock confirmado: ${stockQuantity}`
                        : "Confirmar stock"}
                    </button>
                  </div>
                </div>

                <div className="hidden rounded-3xl border border-cyan-200/25 bg-cyan-200/[0.06] p-4">
                  <label htmlFor="luna-price-confirmed" className="font-black">
                    3. Comparar precio e imagen en Luna
                  </label>
                  <p className="mt-1 text-sm leading-6 text-white/75">
                    Abre el producto en Luna Portex, compara la imagen y escribe
                    el precio actual en USD. Esta confirmación no valida el precio
                    de mercado de eBay.
                  </p>
                  <div className="mt-3 overflow-hidden rounded-2xl border border-white/15 bg-white">
                    {safeProductImageUrl ? (
                      <img
                        src={safeProductImageUrl}
                        alt={`Imagen de ${selectedRadarCandidate.productTitle} registrada por Radar`}
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="max-h-72 w-full object-contain"
                      />
                    ) : (
                      <div className="flex min-h-40 items-center justify-center bg-black/90 p-4 text-center text-sm font-bold text-white/70">
                        Imagen no disponible o fuente no autorizada.
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-white/60">
                    Imagen observada por Radar. Compárala con la ficha que se abre en Luna Portex.
                  </p>
                  {lunaCatalogUrl ? (
                    <a
                      href={lunaCatalogUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => setCatalogCheckOpened(true)}
                      className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-cyan-200/40 bg-black/30 px-4 text-center font-black text-cyan-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200"
                    >
                      Abrir producto en Luna Portex ↗
                    </a>
                  ) : (
                    <p className="mt-3 rounded-2xl border border-rose-200/25 bg-rose-200/[0.07] p-3 text-sm font-bold text-rose-50">
                      El producto no tiene una URL válida del catálogo de Luna.
                    </p>
                  )}
                  <input
                    id="luna-price-confirmed"
                    inputMode="decimal"
                    placeholder="Precio visto, ej. 4.00"
                    value={lunaPrice}
                    onChange={(event) =>
                      resetLunaCatalogConfirmation(event.target.value)
                    }
                    className="mt-3 min-h-12 w-full rounded-2xl border border-white/25 bg-black/30 px-4 text-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200"
                  />
                  <button
                    type="button"
                    disabled={
                      !catalogCheckOpened ||
                      !lunaCatalogUrl ||
                      !safeProductImageUrl ||
                      !(Number(lunaPrice) > 0)
                    }
                    onClick={confirmLunaCatalogMatch}
                    className="mt-2 min-h-12 w-full rounded-2xl bg-cyan-200 px-4 font-black text-black disabled:opacity-40"
                  >
                    {lunaPriceConfirmed && state.imageConfirmed
                      ? `✓ Precio USD ${Number(lunaPrice).toFixed(2)} e imagen coinciden`
                      : !safeProductImageUrl
                        ? "Imagen no disponible para confirmar"
                      : catalogCheckOpened
                        ? "Confirmar que precio e imagen coinciden"
                        : "Abre Luna antes de confirmar"}
                  </button>
                </div>

                {marketValidation.productRestrictionRiskDetected && (
                  <aside role="alert" className="rounded-3xl border border-rose-200/35 bg-rose-200/[0.09] p-4">
                    <p className="font-black">Revisión de restricciones requerida</p>
                    <p className="mt-2 text-sm leading-6 text-white/85">Este producto puede tener restricciones de envío o categoría. Requiere revisión antes de preparar listing.</p>
                    <dl className="mt-3 grid gap-2 text-sm">
                      <div className="rounded-2xl bg-black/25 p-3"><dt className="text-white/60">Tipo de riesgo</dt><dd className="mt-1 break-words font-black text-rose-50">{marketValidation.restrictionRiskType}</dd></div>
                      <div className="rounded-2xl bg-black/25 p-3"><dt className="text-white/60">Guardas de restricción pendientes</dt><dd className="mt-1"><ul className="list-disc space-y-1 pl-5 font-bold">{marketValidation.restrictionGuards.map((guard) => <li key={guard}>{guard}</li>)}</ul></dd></div>
                    </dl>
                    <p className="mt-3 text-sm font-bold text-rose-50">B2-RUN bloqueado · canPublish false</p>
                  </aside>
                )}

                <div className="rounded-3xl border border-amber-200/25 bg-amber-200/[0.07] p-4">
                  <p className="font-black">Resultado de validaciones</p>
                  <p className="mt-2 text-sm text-white/80">
                    Siguiente paso: <strong>{routeLabel(effectiveDecision.nextRecommendedRoute)}</strong>
                  </p>
                  {marketValidation.pendingGuards.length > 0 && (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-white/80">
                      {marketValidation.pendingGuards.map((guard) => (
                        <li key={guard}>{guardLabel(guard)}</li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    disabled
                    className="mt-4 min-h-14 w-full rounded-2xl bg-emerald-200 px-4 font-black text-black opacity-40"
                  >
                    B2-RUN no disponible
                  </button>
                </div>
              </>
            )}

            {!selectedRadarCandidate && (
              <button
                type="button"
                onClick={() => setView("opportunities")}
                className="min-h-12 w-full rounded-2xl bg-white font-black text-black"
              >
                Ir a oportunidades
              </button>
            )}

            <details className="rounded-3xl border border-violet-200/20 bg-violet-200/[0.06] p-4">
              <summary className="cursor-pointer font-black">
                Detalle técnico y resumen copiable
              </summary>
              <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-black/40 p-4 text-xs text-white/80">
                {summary}
              </pre>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(summary)
                    setCopied(true)
                    setLastActionMessage("Resumen copiado.")
                  } catch {
                    setLastActionMessage(
                      "No se pudo copiar. Selecciona el JSON manualmente."
                    )
                  }
                }}
                className="mt-3 min-h-12 w-full rounded-2xl border border-violet-200/35 font-black"
              >
                {copied ? "✓ Resumen copiado" : "Copiar resumen"}
              </button>
            </details>

            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => act({ type: "REQUEST_LUNA_SCAN_REFRESH" })}
                className="min-h-12 rounded-2xl border border-amber-200/35 px-4 font-bold"
              >
                Marcar que Radar necesita refresco
              </button>
              <button
                type="button"
                onClick={() => act({ type: "HOLD_FOR_REVIEW" })}
                className="min-h-12 rounded-2xl border border-amber-200/35 px-4 font-bold"
              >
                Pausar revisión en esta sesión
              </button>
            </div>
          </section>
        )}

        <footer className="pb-4 text-center text-xs leading-5 text-white/65">
          {selectedQueueOpportunity
            ? serverSaveState
            : localConfirmationsComplete
              ? "Confirmaciones locales disponibles; abre el producto desde la cola para sincronizarlas."
              : "Selecciona una oportunidad para comenzar."}
          <br />
          Sin aprobación oficial · publicación desactivada.
        </footer>
      </section>
      {selectedRadarCandidate && view !== "decision" && <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-40 border-t border-white/15 bg-[#0b1018]/95 p-3 backdrop-blur"><div className="mx-auto flex max-w-xl items-center gap-3"><p className="min-w-0 flex-1 truncate text-sm font-bold">Seleccionado: {selectedRadarCandidate.productTitle}</p><button type="button" onClick={() => setView("decision")} className="min-h-12 rounded-2xl bg-emerald-200 px-4 font-black text-black">Siguiente paso</button></div></div>}
      {selectedQueueOpportunity && view === "decision" && <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-40 border-t border-white/15 bg-[#0b1018]/95 p-3 backdrop-blur"><div className="mx-auto flex max-w-xl items-center gap-3"><p className="min-w-0 flex-1 text-xs font-bold text-white/60">{serverSaveState}</p><a href={`/admin/ebay/listing-workspace?opportunity=${encodeURIComponent(selectedQueueOpportunity.id)}&candidate=${encodeURIComponent(selectedQueueOpportunity.candidate_key)}`} className="inline-flex min-h-12 items-center rounded-2xl bg-emerald-200 px-4 font-black text-black">4. Workspace</a></div></div>}
      <nav aria-label="Navegación principal móvil" className="fixed inset-x-0 bottom-0 z-50 border-t border-white/15 bg-[#070b12]/95 px-2 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur"><div className="mx-auto grid max-w-xl grid-cols-4 gap-1"><a href="/admin/ebay-seller-os" className="flex min-h-14 flex-col items-center justify-center rounded-xl text-[11px] font-black text-white/65"><span aria-hidden="true" className="text-lg">⌂</span>Inicio</a><button type="button" onClick={() => setView("opportunities")} className={`min-h-14 rounded-xl text-[11px] font-black ${view === "opportunities" ? "bg-violet-200 text-black" : "text-white/65"}`}><span aria-hidden="true" className="block text-lg">⌕</span>Oportunidades</button><button type="button" onClick={() => setView("pinned")} className={`min-h-14 rounded-xl text-[11px] font-black ${view === "pinned" || view === "decision" ? "bg-cyan-200 text-black" : "text-white/65"}`}><span aria-hidden="true" className="block text-lg">◷</span>En curso</button><button type="button" onClick={() => setView("blocked")} className={`relative min-h-14 rounded-xl text-[11px] font-black ${view === "blocked" ? "bg-rose-200 text-black" : "text-white/65"}`}><span aria-hidden="true" className="block text-lg">!</span>Alertas{alertCount > 0 && <span className="absolute right-2 top-1 rounded-full bg-rose-500 px-1.5 text-[10px] text-white">{alertCount}</span>}</button></div></nav>
    </main>
  )
}
