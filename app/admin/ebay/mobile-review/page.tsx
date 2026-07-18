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
import type { WinnerEvidenceDecisionPackage } from "@/lib/ebay/ebay-winner-evidence-v2"
import type {
  SanitizedWinnerEvidenceDecisionPackage,
  WinnerEvidenceClientInput,
} from "@/lib/ebay/ebay-winner-evidence-v2-service"
import {
  getLoop1LunaCatalogUrl,
  getLoop1PackageSaveDisabledReason,
  getLoop1SafeProductImageUrl,
  getLoop1WinnerAnalysisGate,
  LOOP1_ACTIVE_LOOP,
  LOOP1_BACKGROUND_MONITOR_STATUS,
  LOOP1_VALIDATION_STATUS,
  verifyLoop1DecisionPackageReadback,
} from "@/lib/ebay/ebay-loop1-winner-analysis-ux"
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
import { SellerOsMobileNav } from "../components/seller-os-mobile-nav"
import { OpportunityCommandCenter, type Opportunity } from "./opportunity-command-center"
import { Loop1WinnerAnalysisSummary } from "./loop1-winner-analysis-summary"
import { Loop2ListingAiPanel } from "./loop2-listing-ai-panel"
import { SellerJourneyGuide, type SellerJourneyStep } from "./seller-journey-guide"

const emptyReport = buildMobileReviewRealRadarConnector({ products: [] })
type View = "loop1" | "loop2" | "opportunities" | "top5" | "pinned" | "blocked"

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
        <button type="button" aria-pressed={selected} onClick={onSelect} className="min-h-12 rounded-2xl bg-emerald-200 px-4 py-3 font-black text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">{selected ? "✓ Producto seleccionado" : "Revisar producto"}</button>
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
  const [visualWinnerEvidence, setVisualWinnerEvidence] = useState<WinnerEvidenceDecisionPackage["visualEvidenceAnalysis"] | null>(null)
  const [winnerDecisionPackage, setWinnerDecisionPackage] = useState<SanitizedWinnerEvidenceDecisionPackage | null>(null)
  const [winnerDecisionPackageInput, setWinnerDecisionPackageInput] = useState<WinnerEvidenceClientInput | null>(null)
  const [decisionPackageId, setDecisionPackageId] = useState<string | null>(null)
  const [decisionPackageSaveState, setDecisionPackageSaveState] = useState<"IDLE" | "SAVING" | "SAVED" | "READING" | "VERIFIED" | "ERROR">("IDLE")
  const [decisionPackageSaveError, setDecisionPackageSaveError] = useState("")
  const [decisionPackageReadbackVerified, setDecisionPackageReadbackVerified] = useState(false)
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
  const [serverReviewsLoadState, setServerReviewsLoadState] = useState<"LOADING" | "READY" | "ERROR">("LOADING")
  const [serverReviewsError, setServerReviewsError] = useState("")
  const [whatsappStatus, setWhatsappStatus] = useState<SellerWhatsAppStatus>({})
  const [whatsappLoadState, setWhatsappLoadState] = useState<"LOADING" | "READY" | "ERROR">("LOADING")
  const [whatsappLoadError, setWhatsappLoadError] = useState("")
  const [whatsappPreflightRunning, setWhatsappPreflightRunning] = useState(false)
  const [serverSaveState, setServerSaveState] = useState("Sin cambios pendientes")
  const [blockedVisible, setBlockedVisible] = useState(5)
  const [copied, setCopied] = useState(false)
  const confirmationRef = useRef<HTMLElement>(null)
  const opportunityRef = useRef<HTMLDivElement>(null)
  const comparablesRef = useRef<HTMLElement>(null)
  const identityConfirmationRef = useRef<HTMLDivElement>(null)

  const resetWinnerDecisionState = useCallback(() => {
    setWinnerDecisionPackage(null)
    setWinnerDecisionPackageInput(null)
    setDecisionPackageId(null)
    setDecisionPackageSaveState("IDLE")
    setDecisionPackageSaveError("")
    setDecisionPackageReadbackVerified(false)
  }, [])

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
      setReport(nextReport); setState(buildInitialMobileReviewState(toMobileFixture(nextReport.top5Candidates))); setSelectedQueueCandidate(null); setSelectedQueueOpportunity(null); setStockQuantity(""); setLunaPrice(""); setLunaPriceConfirmed(false); setCatalogCheckOpened(false); setEbayListingUrl(""); setEbayObservedTitle(""); setEbayReferenceOpened(false); setIdentityChecks({ sameProductAndBrand: false, sameVariantSizeOrPack: false, compatibleReference: false }); setSellerKeywordDemand(null); setOpportunityAssessment(null); setSellerKeywordDemandError(""); resetWinnerDecisionState()
      if (nextReport.realRadarCandidatesCount === 0) { setLoadState("RADAR_EMPTY"); setLoadMessage("Radar respondió, pero no devolvió productos. Ejecuta o revisa el scan antes de decidir.") }
      else { setLoadState("READY"); setLoadMessage(`Radar anterior: ${nextReport.top5Candidates.length} candidatos disponibles de ${nextReport.realRadarCandidatesCount} productos observados. No son el Top 20 automatizado.`) }
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
  }, [resetWinnerDecisionState])

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
    setServerReviewsLoadState("LOADING")
    setServerReviewsError("")
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error || !data.session) throw new Error("AUTH_REQUIRED")
      const response = await fetch("/api/admin/ebay/command-center", { cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}` } })
      const payload = await readMobileReviewJson<{
        success?: boolean
        dashboard?: { queue?: Opportunity[] }
        reviews?: ServerReview[]
        alerts?: ServerAlerts
      }>(response, "No se pudo cargar el estado guardado del Command Center")
      if (!payload.success) throw new Error(getMobileReviewPayloadError(payload, "No se pudo cargar el estado guardado del Command Center"))
      const queue = (payload.dashboard?.queue ?? []) as Opportunity[]
      setServerReviews((payload.reviews ?? []).map((review: ServerReview) => ({ ...review, opportunity: queue.find((row) => row.id === review.opportunity_id) })))
      setServerAlerts(payload.alerts ?? { activeListingRisks: [], outbox: [] })
      setServerReviewsLoadState("READY")
    } catch (requestError) {
      setServerReviewsLoadState("ERROR")
      setServerReviewsError(getMobileReviewRequestError(requestError, "No se pudieron cargar las revisiones y alertas guardadas."))
    }
  }, [])
  useEffect(() => { void loadServerReviews() }, [loadServerReviews])
  const loadWhatsAppStatus = useCallback(async () => {
    setWhatsappLoadState("LOADING")
    setWhatsappLoadError("")
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error || !data.session) throw new Error("AUTH_REQUIRED")
      const response = await fetch("/api/admin/ebay/seller-whatsapp-alerts", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      })
      const payload = await readMobileReviewJson<SellerWhatsAppStatus & { success?: boolean }>(
        response,
        "No se pudo cargar el estado de WhatsApp",
      )
      if (!payload.success) throw new Error(getMobileReviewPayloadError(payload, "No se pudo cargar el estado de WhatsApp"))
      setWhatsappStatus(payload)
      setWhatsappLoadState("READY")
    } catch (requestError) {
      setWhatsappLoadState("ERROR")
      setWhatsappLoadError(getMobileReviewRequestError(requestError, "No se pudo cargar el estado de WhatsApp."))
    }
  }, [])
  useEffect(() => { void loadWhatsAppStatus() }, [loadWhatsAppStatus])
  const runWhatsAppPreflight = useCallback(async () => {
    setWhatsappPreflightRunning(true)
    setWhatsappLoadError("")
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
      setWhatsappLoadState("READY")
      setLastActionMessage(payload.success
        ? "WhatsApp validado: número emisor y plantillas aprobadas están listos."
        : `WhatsApp sigue bloqueado: ${(payload.preflight?.errorCodes ?? ["configuración incompleta"]).join(", ")}.`)
    } catch (error) {
      const message = getMobileReviewRequestError(error, "No se pudo ejecutar el preflight de WhatsApp.")
      setWhatsappLoadState("ERROR")
      setWhatsappLoadError(message)
      setLastActionMessage(message)
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
  const loop1CandidateOptions = useMemo(() => {
    const options = new Map<string, { id: string; label: string }>()
    for (const candidate of report.allCandidates) {
      options.set(candidate.marketRadarProductId, {
        id: candidate.marketRadarProductId,
        label: `${candidate.productTitle} · SKU ${candidate.supplierSku ?? "N/D"}`,
      })
    }
    for (const review of serverReviews) {
      const opportunity = review.opportunity
      if (!opportunity?.market_radar_product_id) continue
      if (!options.has(opportunity.market_radar_product_id)) {
        options.set(opportunity.market_radar_product_id, {
          id: opportunity.market_radar_product_id,
          label: `${opportunity.product_title} · SKU ${opportunity.supplier_sku ?? "N/D"}`,
        })
      }
    }
    return [...options.values()]
  }, [report.allCandidates, serverReviews])
  const hasReviewInProgress = Boolean(
    selectedRadarCandidate ||
    selectedQueueOpportunity ||
    stockQuantity ||
    lunaPrice ||
    ebayListingUrl ||
    ebayObservedTitle ||
    sellerKeywordDemand ||
    opportunityAssessment,
  )
  const hasUnsavedReview = Boolean(
    hasReviewInProgress &&
    (!selectedQueueOpportunity || !serverSaveState.startsWith("Guardado ")),
  )
  const confirmReviewReset = useCallback(() => {
    if (!hasReviewInProgress) return true
    return window.confirm("Actualizar Radar reiniciará el formulario visible. La revisión guardada en servidor seguirá disponible en En curso. ¿Actualizar ahora?")
  }, [hasReviewInProgress])
  const refreshRadarSafely = useCallback(async () => {
    if (!confirmReviewReset()) return report.allCandidates
    return load()
  }, [confirmReviewReset, load, report.allCandidates])
  useEffect(() => {
    if (!hasUnsavedReview) return
    const protectInProgressReview = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", protectInProgressReview)
    return () => window.removeEventListener("beforeunload", protectInProgressReview)
  }, [hasUnsavedReview])
  const lunaCatalogUrl = getLoop1LunaCatalogUrl(selectedRadarCandidate?.productUrl)
  const safeProductImageUrl = getLoop1SafeProductImageUrl(selectedRadarCandidate?.imageReference)
  const ebayIdentitySearchUrl = buildEbayIdentitySearchUrl(selectedRadarCandidate)
  const identityComparison = useMemo(() => buildLunaEbayIdentityComparison({ lunaCandidate: selectedRadarCandidate, ebayListingUrl, ebayObservedTitle, ebayReferenceOpened, checklist: identityChecks, confirmationRecorded: state.sameProductConfirmed, ebayApiUsed: Boolean(sellerKeywordDemand) }), [selectedRadarCandidate, ebayListingUrl, ebayObservedTitle, ebayReferenceOpened, identityChecks, state.sameProductConfirmed, sellerKeywordDemand])
  const pinnedContinuity = useMemo(() => buildPinnedCandidateContinuityReport(report.top5Candidates, pinnedCandidates, report.allCandidates), [report, pinnedCandidates])
  const localConfirmationsComplete = Boolean(identityComparison.identityComparisonComplete && state.stockQuantityConfirmed && state.imageConfirmed && lunaPriceConfirmed)
  const localConfirmationCount = [
    identityComparison.identityComparisonComplete,
    Boolean(state.stockQuantityConfirmed),
    Boolean(state.imageConfirmed && lunaPriceConfirmed),
  ].filter(Boolean).length
  const loop1AnalysisGate = useMemo(() => getLoop1WinnerAnalysisGate(
    selectedRadarCandidate
      ? {
          ...selectedRadarCandidate,
          lunaPrice: Number(lunaPrice) > 0 ? Number(lunaPrice) : selectedRadarCandidate.lunaPrice,
          stockQuantity: state.stockQuantityConfirmed ?? selectedRadarCandidate.stockQuantity,
        }
      : null,
    {
      stockConfirmed: Boolean(state.stockQuantityConfirmed),
      costConfirmed: lunaPriceConfirmed,
      imageConfirmed: state.imageConfirmed,
    },
  ), [selectedRadarCandidate, lunaPrice, state.stockQuantityConfirmed, state.imageConfirmed, lunaPriceConfirmed])
  const decisionPackageSaveDisabledReason = getLoop1PackageSaveDisabledReason({
    analysisEnabled: loop1AnalysisGate.analysisEnabled,
    analysisAvailable: Boolean(winnerDecisionPackage && winnerDecisionPackageInput),
    saving: decisionPackageSaveState === "SAVING" || decisionPackageSaveState === "READING",
  })
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
  const summary = useMemo(() => JSON.stringify({ ...JSON.parse(buildMobileReviewCopyPasteSummary(state)), dataSource: report.dataSource, mobileDecisionPersistence: selectedQueueOpportunity ? "SERVER_AUTOSAVE" : "BROWSER_STATE_ONLY", decisionPersistence: selectedQueueOpportunity ? "SERVER_AUTOSAVE_WITH_BROWSER_FALLBACK" : "BROWSER_STATE_OR_LOCAL_STORAGE", officialApprovalRecord: false, effectiveDecision, lunaEbayIdentityComparison: identityComparison, ebaySellerKeywordDemand: sellerKeywordDemand, ebayLunaOpportunityAssessment: opportunityAssessment, visualWinnerEvidence, winnerDecisionPackage, decisionPackageId, decisionPackageReadbackVerified, marketValidationSelectedCandidate: marketValidation, pendingGuards: selectedRadarCandidate ? marketValidation.pendingGuards : null, guardsEvaluated: Boolean(selectedRadarCandidate), manualConfirmationReconciliation: radarGuards.reconciliation, pinnedCandidateContinuity: pinnedContinuity, canPublish: false }, null, 2), [state, report.dataSource, selectedQueueOpportunity, effectiveDecision, identityComparison, sellerKeywordDemand, opportunityAssessment, visualWinnerEvidence, winnerDecisionPackage, decisionPackageId, decisionPackageReadbackVerified, marketValidation, selectedRadarCandidate, radarGuards.reconciliation, pinnedContinuity])

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
    if (action.type === "SELECT_CANDIDATE" || action.type === "MARK_UNAVAILABLE") { setStockQuantity(""); setLunaPrice(""); setLunaPriceConfirmed(false); setCatalogCheckOpened(false); setEbayListingUrl(""); setEbayObservedTitle(""); setEbayReferenceOpened(false); setIdentityChecks({ sameProductAndBrand: false, sameVariantSizeOrPack: false, compatibleReference: false }); setSellerKeywordDemand(null); setOpportunityAssessment(null); setSellerKeywordDemandError(""); resetWinnerDecisionState() }
    if (action.type === "APPROVE_B2_RUN_PREFLIGHT") { setLastActionMessage(`B2-RUN continúa bloqueado. Próximo paso: ${routeLabel(effectiveDecision.nextRecommendedRoute)}.`); return }
    setState((current) => applyMobileReviewAction(current, action))
    const messages: Record<string, string> = { MARK_UNAVAILABLE: "Producto marcado no disponible en este navegador. Puedes deshacer recargando antes de persistir otro estado.", SELECT_CANDIDATE: "Producto seleccionado para evaluar; todavía no es una recomendación. Completa las tres confirmaciones.", CONFIRM_SAME_PRODUCT: "Identidad del producto confirmada localmente.", CONFIRM_STOCK_QTY: `Stock confirmado: ${stockQuantity} unidades.`, CONFIRM_IMAGE_OK: "Precio e imagen de Luna confirmados localmente.", REQUEST_LUNA_SCAN_REFRESH: "Se marcó localmente que Radar necesita un refresco; todavía no se envió una solicitud.", HOLD_FOR_REVIEW: "La revisión quedó pausada en esta sesión." }
    setLastActionMessage(messages[action.type] ?? "Acción local registrada.")
    if (action.type === "SELECT_CANDIDATE") { setView("loop1"); window.setTimeout(() => confirmationRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }), 50) }
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
    const continuesSameLocalCandidate = !selectedQueueOpportunity &&
      selectedRadarCandidate?.marketRadarProductId === marketRadarProductId
    if (!continuesSameLocalCandidate) {
      setStockQuantity(""); setLunaPrice(""); setLunaPriceConfirmed(false); setCatalogCheckOpened(false); setEbayListingUrl(""); setEbayObservedTitle(""); setEbayReferenceOpened(false); setIdentityChecks({ sameProductAndBrand: false, sameVariantSizeOrPack: false, compatibleReference: false }); setSellerKeywordDemand(null); setOpportunityAssessment(null); setSellerKeywordDemandError(""); resetWinnerDecisionState()
      const initial = buildInitialMobileReviewState(toMobileFixture([candidate]))
      setState(applyMobileReviewAction(initial, { type: "SELECT_CANDIDATE", rank: candidate.candidateRank }))
    }
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
    if (savedForm.visualWinnerEvidence && typeof savedForm.visualWinnerEvidence === "object") {
      setVisualWinnerEvidence(
        savedForm.visualWinnerEvidence as WinnerEvidenceDecisionPackage["visualEvidenceAnalysis"],
      )
    }
    if (savedForm.winnerDecisionPackage && typeof savedForm.winnerDecisionPackage === "object") {
      setWinnerDecisionPackage(
        savedForm.winnerDecisionPackage as SanitizedWinnerEvidenceDecisionPackage,
      )
    }
    if (savedForm.winnerDecisionPackageInput && typeof savedForm.winnerDecisionPackageInput === "object") {
      setWinnerDecisionPackageInput(
        savedForm.winnerDecisionPackageInput as WinnerEvidenceClientInput,
      )
    }
    if (typeof savedForm.decisionPackageId === "string" && savedForm.decisionPackageId) {
      setDecisionPackageId(savedForm.decisionPackageId)
      setDecisionPackageSaveState("SAVED")
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
    setLastActionMessage(saved
      ? "Continuaste la validación guardada en el servidor."
      : continuesSameLocalCandidate
        ? "La oportunidad canónica quedó vinculada. Tus confirmaciones locales se conservaron y ahora se guardarán en el servidor."
        : "Producto abierto desde el ranking canónico. Confirma Luna, eBay y economía antes de preparar el listing.")
    setView("loop1")
    window.setTimeout(() => confirmationRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }), 50)
    return true
  }

  const selectLoop1Candidate = async (marketRadarProductId: string) => {
    if (!marketRadarProductId) return
    try {
      const savedReview = serverReviews.find(
        (review) => review.opportunity?.market_radar_product_id === marketRadarProductId,
      )
      let candidate = report.allCandidates.find(
        (entry) => entry.marketRadarProductId === marketRadarProductId,
      ) ?? null
      if (!candidate) candidate = await lookupRadarCandidateByProductId(marketRadarProductId)
      if (!candidate) throw new Error("LOOP1_LUNA_CANDIDATE_NOT_FOUND")
      if (savedReview?.opportunity) {
        reviewOpportunityCandidate(savedReview.opportunity, [candidate, ...report.allCandidates])
        return
      }
      setStockQuantity("")
      setLunaPrice("")
      setLunaPriceConfirmed(false)
      setCatalogCheckOpened(false)
      setEbayListingUrl("")
      setEbayObservedTitle("")
      setEbayReferenceOpened(false)
      setIdentityChecks({ sameProductAndBrand: false, sameVariantSizeOrPack: false, compatibleReference: false })
      setSellerKeywordDemand(null)
      setOpportunityAssessment(null)
      setVisualWinnerEvidence(null)
      setSellerKeywordDemandError("")
      resetWinnerDecisionState()
      const initial = buildInitialMobileReviewState(toMobileFixture([candidate]))
      setState(applyMobileReviewAction(initial, {
        type: "SELECT_CANDIDATE",
        rank: candidate.candidateRank,
      }))
      setSelectedQueueCandidate(candidate)
      setSelectedQueueOpportunity(null)
      setView("loop1")
      setLastActionMessage("Candidato Luna seleccionado. Confirma stock, costo e imagen antes de analizar eBay.")
    } catch (error) {
      setLastActionMessage(
        getMobileReviewRequestError(error, "No se pudo abrir el candidato Luna seleccionado."),
      )
    }
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
                visualWinnerEvidence,
                winnerDecisionPackage,
                winnerDecisionPackageInput,
                decisionPackageId,
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
  }, [selectedQueueOpportunity, selectedRadarCandidate, state.stockQuantityConfirmed, state.imageConfirmed, lunaPrice, lunaPriceConfirmed, identityComparison.identityComparisonComplete, ebayListingUrl, ebayObservedTitle, sellerKeywordDemand, opportunityAssessment, visualWinnerEvidence, winnerDecisionPackage, winnerDecisionPackageInput, decisionPackageId, marketValidation.pendingGuards, loadServerReviews])

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
    if (!selectedRadarCandidate || sellerKeywordDemandLoading || !loop1AnalysisGate.analysisEnabled) return
    setSellerKeywordDemandLoading(true)
    setSellerKeywordDemandError("")
    setSellerKeywordDemand(null)
    setOpportunityAssessment(null)
    setVisualWinnerEvidence(null)
    resetWinnerDecisionState()
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
          manufacturerBrand: null,
          supplierVendor: selectedRadarCandidate.brand,
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
        visualWinnerEvidence?: WinnerEvidenceDecisionPackage["visualEvidenceAnalysis"] | null
        winnerDecisionPackage?: SanitizedWinnerEvidenceDecisionPackage | null
        winnerDecisionPackageInput?: WinnerEvidenceClientInput | null
      }>(response, "No se pudo consultar la evidencia read-only de eBay")
      if (!payload.success || !payload.report) {
        throw new Error(getMobileReviewPayloadError(payload, "EBAY_READONLY_MARKET_VALIDATION_FAILED"))
      }
      setSellerKeywordDemand(payload.report)
      setOpportunityAssessment(payload.opportunityAssessment ?? null)
      setVisualWinnerEvidence(payload.visualWinnerEvidence ?? null)
      setWinnerDecisionPackage(payload.winnerDecisionPackage ?? null)
      setWinnerDecisionPackageInput(payload.winnerDecisionPackageInput ?? null)
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

  const readPersistedDecisionPackage = async (
    packageId: string,
    expectedPackage = winnerDecisionPackage,
  ) => {
    if (!expectedPackage) return
    setDecisionPackageSaveState("READING")
    setDecisionPackageSaveError("")
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error || !data.session) throw new Error("AUTH_REQUIRED")
      const response = await fetch(
        `/api/admin/ebay/winner-evidence-v2?packageId=${encodeURIComponent(packageId)}`,
        {
          cache: "no-store",
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        },
      )
      const payload = await readMobileReviewJson<{
        success?: boolean
        error?: string
        packageId?: string
        package?: SanitizedWinnerEvidenceDecisionPackage
      }>(response, "No se pudo releer el paquete de decisión")
      if (!payload.success || !payload.package || !payload.packageId) {
        throw new Error(getMobileReviewPayloadError(payload, "WINNER_EVIDENCE_PACKAGE_READ_FAILED"))
      }
      if (!verifyLoop1DecisionPackageReadback(expectedPackage, payload.package)) {
        throw new Error("WINNER_EVIDENCE_PACKAGE_INTEGRITY_MISMATCH")
      }
      setWinnerDecisionPackage(payload.package)
      setDecisionPackageId(payload.packageId)
      setDecisionPackageReadbackVerified(true)
      setDecisionPackageSaveState("VERIFIED")
      setLastActionMessage("Paquete de decisión releído: hash, versión y controles de seguridad coinciden.")
    } catch (error) {
      setDecisionPackageReadbackVerified(false)
      setDecisionPackageSaveState("ERROR")
      setDecisionPackageSaveError(
        getMobileReviewRequestError(error, "No se pudo releer el paquete de decisión."),
      )
    }
  }

  const saveWinnerDecisionPackage = async () => {
    if (!winnerDecisionPackage || !winnerDecisionPackageInput || !loop1AnalysisGate.analysisEnabled) return
    setDecisionPackageSaveState("SAVING")
    setDecisionPackageSaveError("")
    setDecisionPackageReadbackVerified(false)
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error || !data.session) throw new Error("AUTH_REQUIRED")
      const response = await fetch("/api/admin/ebay/winner-evidence-v2", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "analyze",
          input: winnerDecisionPackageInput,
          useOfficialRead: false,
          persist: true,
        }),
      })
      const payload = await readMobileReviewJson<{
        success?: boolean
        error?: string
        packageId?: string
        package?: SanitizedWinnerEvidenceDecisionPackage
      }>(response, "No se pudo guardar el paquete de decisión")
      if (!payload.success || !payload.packageId || !payload.package) {
        throw new Error(getMobileReviewPayloadError(payload, "WINNER_EVIDENCE_PACKAGE_PERSIST_FAILED"))
      }
      if (!verifyLoop1DecisionPackageReadback(winnerDecisionPackage, payload.package)) {
        throw new Error("WINNER_EVIDENCE_PACKAGE_INTEGRITY_MISMATCH")
      }
      setWinnerDecisionPackage(payload.package)
      setDecisionPackageId(payload.packageId)
      setDecisionPackageSaveState("SAVED")
      setLastActionMessage("Paquete de decisión guardado. Verificando lectura server-side…")
      await readPersistedDecisionPackage(payload.packageId, payload.package)
    } catch (error) {
      setDecisionPackageSaveState("ERROR")
      setDecisionPackageSaveError(
        getMobileReviewRequestError(error, "No se pudo guardar el paquete de decisión."),
      )
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
    setSellerKeywordDemand(null)
    setOpportunityAssessment(null)
    setVisualWinnerEvidence(null)
    resetWinnerDecisionState()
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
    setSellerKeywordDemand(null)
    setOpportunityAssessment(null)
    setVisualWinnerEvidence(null)
    resetWinnerDecisionState()
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
  const lunaMissingCount = selectedRadarCandidate
    ? Number(!state.stockQuantityConfirmed) + Number(!lunaPriceConfirmed) + Number(!state.imageConfirmed)
    : 0
  const journeyStep: SellerJourneyStep = !selectedRadarCandidate
    ? 1
    : lunaMissingCount > 0
      ? 2
      : !sellerKeywordDemand || !identityComparison.identityComparisonComplete
        ? 3
        : 4
  const journey = journeyStep === 1
    ? { title: "Elige una oportunidad", instruction: "No llenes ningún campo todavía. Primero selecciona un solo producto de la lista priorizada.", actionLabel: "Elegir producto", missingCount: 1, pendingLabel: "Falta elegir producto", systemTask: "Ordena las oportunidades por evidencia y match Luna.", userTask: "Pulsa “Validar ahora” en un producto." }
    : journeyStep === 2
      ? { title: "Confirma los datos de Luna", instruction: "Ahora completa únicamente los campos rojos. La validación de eBay seguirá bloqueada hasta terminar este paso.", actionLabel: "Ir a los campos de Luna", missingCount: lunaMissingCount, pendingLabel: `${lunaMissingCount} dato${lunaMissingCount === 1 ? "" : "s"} de Luna pendiente${lunaMissingCount === 1 ? "" : "s"}`, systemTask: "Mantiene vinculada la variante exacta y protege contra cambios de pack o tamaño.", userTask: "Confirma stock, costo e imagen en Luna." }
      : journeyStep === 3
        ? !sellerKeywordDemand
          ? { title: "Valida el mercado en eBay", instruction: "Luna ya está completo. Seller OS puede consultar los comparables oficiales sin escribir ni publicar.", actionLabel: "Analizar mercado eBay", missingCount: 1, pendingLabel: "Falta analizar eBay", systemTask: "Comparará identidad, demanda, precio, categoría y economía.", userTask: "Pulsa una vez para iniciar el análisis automático." }
          : !ebayListingUrl
            ? { title: "Elige el comparable exacto", instruction: "El análisis automático terminó. Revisa únicamente las referencias compatibles y elige la que representa el mismo producto.", actionLabel: "Ver comparables", missingCount: 1, pendingLabel: "Falta elegir comparable", systemTask: "Descartó packs, tamaños y variantes incompatibles.", userTask: "Selecciona una referencia exacta de eBay." }
            : { title: "Confirma la identidad", instruction: "Ya elegiste una referencia. Falta confirmar que corresponde exactamente al producto de Luna.", actionLabel: "Confirmar identidad", missingCount: 1, pendingLabel: "Falta confirmar identidad", systemTask: "Contrastó marca, producto, variante, tamaño y pack.", userTask: "Confirma el vínculo Luna ↔ eBay." }
        : winnerDecisionPackage
          ? { title: "Continúa a preparación", instruction: "Producto, Luna y evidencia eBay ya están vinculados. Revisa la ficha antes de preparar contenido o draft.", actionLabel: "Preparar listing", missingCount: 0, pendingLabel: "Listo para continuar", systemTask: "Construyó el paquete trazable y mantuvo publicación desactivada.", userTask: "Abre la preparación del listing." }
          : { title: "Revisa la decisión", instruction: "Los análisis terminaron. Revisa el resumen y guarda la decisión antes de preparar el listing.", actionLabel: "Revisar resultado", missingCount: 1, pendingLabel: "Falta guardar decisión", systemTask: "Resume evidencia, riesgos, rentabilidad y campos pendientes.", userTask: "Revisa el resultado y guarda la decisión." }

  const followJourney = () => {
    if (journeyStep === 1) {
      setView("opportunities")
      window.setTimeout(() => opportunityRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50)
      return
    }
    if (journeyStep === 3 && !sellerKeywordDemand) {
      void runSellerKeywordDemandValidation()
      return
    }
    if (journeyStep === 3) {
      const target = ebayListingUrl ? identityConfirmationRef.current : comparablesRef.current
      target?.scrollIntoView({ behavior: "smooth", block: "start" })
      return
    }
    else if (journeyStep === 4 && winnerDecisionPackage) setView("loop2")
    else setView("loop1")
    window.setTimeout(() => confirmationRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50)
  }

  return (
    <main className="min-h-screen bg-[#05070d] px-4 pb-48 pt-4 text-white sm:px-6">
      <section className="mx-auto flex max-w-xl flex-col gap-4">
        <header className="sticky top-0 z-30 -mx-4 border-b border-white/10 bg-[#05070d]/95 px-4 pb-3 pt-2 backdrop-blur">
          <div className="flex items-center justify-between gap-3"><a href="/admin/ebay-seller-os" className="min-h-11 rounded-full border border-white/20 px-4 py-3 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200">← Seller OS</a><button type="button" onClick={() => void refreshRadarSafely()} disabled={loading} className="min-h-11 rounded-full border border-cyan-200/35 px-4 py-3 text-sm font-bold text-cyan-50 disabled:opacity-50">{loading ? "Cargando…" : "↻ Actualizar"}</button></div>
          <div className="mt-3 flex items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-cyan-100">eBay read-only · progreso sincronizado</p><h1 className="mt-1 text-2xl font-black">Seller Command Center</h1></div><StatusPill tone={report.dataSource === "MARKET_RADAR_READONLY" ? "good" : report.fixtureUsed ? "warning" : "danger"}>{sourceLabel}</StatusPill></div>
        </header>

        <SellerJourneyGuide currentStep={journeyStep} title={journey.title} instruction={journey.instruction} actionLabel={journey.actionLabel} missingCount={journey.missingCount} pendingLabel={journey.pendingLabel} systemTask={journey.systemTask} userTask={journey.userTask} onAction={followJourney} />

        <details open={loadState !== "READY"} className={`rounded-2xl border p-3 ${loadState === "READY" ? "border-emerald-200/20 bg-emerald-200/[0.05]" : "border-amber-200/25 bg-amber-200/[0.07]"}`}>
          <summary className="cursor-pointer text-sm font-black">{loadState === "READY" ? "Sistema listo · ver estado" : loadMessage}</summary><p className="mt-2 text-xs leading-5 text-white/65">eBay read-only · scans y cola guardados · publicación separada y desactivada.</p>
          <p className="sr-only">Radar observó {report.realRadarCandidatesCount} productos y muestra {report.top5Candidates.length} candidatos seleccionables. La fuente y antigüedad del stock están disponibles en los detalles.</p>
          {loadState === "AUTH_REQUIRED" ? <a href="/admin/login?returnTo=%2Fadmin%2Febay%2Fmobile-review" className="mt-3 inline-flex min-h-11 items-center rounded-2xl bg-white px-4 py-2 font-black text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200">Iniciar sesión</a> : loadState !== "READY" && <button type="button" onClick={() => void load()} className="mt-3 min-h-11 rounded-2xl bg-white px-4 py-2 font-black text-black">Reintentar lectura</button>}
        </details>
        {view === "loop1" && (
          <details className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <summary className="cursor-pointer text-sm font-bold text-white/55">Cambiar el producto seleccionado</summary>
            <div className="mt-3">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-100/70">Validación humana unificada</p>
            <h2 className="mt-1 text-lg font-black">Producto en revisión</h2>
            <details className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3"><summary className="cursor-pointer text-xs font-bold text-white/55">Ver detalles técnicos del loop</summary><div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
              <div className="rounded-xl bg-black/25 p-2"><span className="block text-white/50">ACTIVE LOOP</span><strong>{LOOP1_ACTIVE_LOOP}</strong></div>
              <div className="rounded-xl bg-black/25 p-2"><span className="block text-white/50">STATUS</span><strong>{LOOP1_VALIDATION_STATUS}</strong></div>
              <div className="rounded-xl bg-black/25 p-2"><span className="block text-white/50">BACKGROUND MONITOR</span><strong>{LOOP1_BACKGROUND_MONITOR_STATUS}</strong></div>
            </div></details>
            <label className="mt-4 block text-sm font-black" htmlFor="loop1-candidate-select">Seleccionar candidato Luna</label>
            <select id="loop1-candidate-select" aria-invalid={!selectedRadarCandidate} aria-describedby={!selectedRadarCandidate ? "candidate-required-help" : undefined} value={selectedRadarCandidate?.marketRadarProductId ?? ""} onChange={(event) => void selectLoop1Candidate(event.target.value)} className={`mt-2 min-h-12 w-full rounded-2xl border bg-[#101526] px-3 text-sm text-white ${!selectedRadarCandidate ? "border-rose-400 ring-1 ring-rose-400/40" : "border-white/20"}`}>
              <option value="">Selecciona un producto…</option>
              {loop1CandidateOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            {selectedRadarCandidate ? (
              <div className="mt-4 space-y-3">
                <dl className="grid gap-2 text-xs sm:grid-cols-2">
                  <div><dt className="text-white/50">Producto</dt><dd className="font-black">{selectedRadarCandidate.productTitle}</dd></div>
                  <div><dt className="text-white/50">SKU Luna</dt><dd className="break-all font-black">{selectedRadarCandidate.supplierSku ?? "N/D"}</dd></div>
                  <div><dt className="text-white/50">Variante</dt><dd className="font-black">{selectedRadarCandidate.variantTitle ?? "N/D"}</dd></div>
                  <div><dt className="text-white/50">ID variante</dt><dd className="break-all font-black">{selectedRadarCandidate.supplierVariantId ?? "N/D"}</dd></div>
                  <div><dt className="text-white/50">Stock Luna</dt><dd className="font-black">{selectedRadarCandidate.stockQuantity ?? "N/D"}</dd></div>
                  <div><dt className="text-white/50">Costo Luna</dt><dd className="font-black">{selectedRadarCandidate.lunaPrice == null ? "N/D" : `$${selectedRadarCandidate.lunaPrice.toFixed(2)}`}</dd></div>
                  <div><dt className="text-white/50">URL Luna</dt><dd className="font-black">{lunaCatalogUrl ? "DISPONIBLE" : "N/D"}</dd></div>
                  <div><dt className="text-white/50">Imagen Luna</dt><dd className="font-black">{safeProductImageUrl ? "DISPONIBLE" : "N/D"}</dd></div>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <StatusPill tone={state.stockQuantityConfirmed ? "good" : "warning"}>{state.stockQuantityConfirmed ? "Stock confirmado" : "Falta confirmar stock"}</StatusPill>
                  <StatusPill tone={lunaPriceConfirmed ? "good" : "warning"}>{lunaPriceConfirmed ? "Costo confirmado" : "Falta confirmar costo"}</StatusPill>
                  <StatusPill tone={state.imageConfirmed ? "good" : "warning"}>{state.imageConfirmed ? "Imagen confirmada" : "Falta confirmar imagen"}</StatusPill>
                </div>
                {!loop1AnalysisGate.mappingComplete && <div role="alert" className="rounded-2xl border border-rose-200/30 bg-rose-200/[0.08] p-3 text-sm text-rose-50"><p className="font-black">Vínculo Luna incompleto</p><ul className="mt-2 list-disc pl-5">{loop1AnalysisGate.missingMapping.map((reason) => <li key={reason}>{reason}</li>)}</ul><p className="mt-2">Elige otro candidato para continuar sin inventar datos.</p></div>}
                <p className="rounded-2xl border border-white/10 bg-black/20 p-3 text-sm font-bold">Paso actual: {loop1AnalysisGate.disabledReason ?? (winnerDecisionPackage ? "Revisar y guardar el paquete de decisión" : "Listo para analizar mercado eBay")}</p>
              </div>
            ) : <p id="candidate-required-help" role="alert" className="mt-2 text-sm font-bold text-rose-300">Campo requerido: selecciona un candidato para comenzar.</p>}
            </div>
          </details>
        )}
        {view === "loop2" && <Loop2ListingAiPanel />}
        {loadState === "READY" && <details className="rounded-2xl border border-white/10 bg-black/20 p-3"><summary className="cursor-pointer text-sm font-bold text-white/50">Ver resumen operativo</summary><div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-white/[0.04] px-2 py-3"><span className="text-[10px] font-bold uppercase tracking-wide text-white/55">Observados</span><strong className="mt-1 block text-xl font-black">{report.realRadarCandidatesCount}</strong></div><button type="button" onClick={() => setView("pinned")} className="rounded-xl bg-emerald-200/[0.07] px-2 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-200"><span className="text-[10px] font-bold uppercase tracking-wide text-emerald-50/70">En curso</span><strong className="mt-1 block text-xl font-black">{serverReviewsLoadState === "READY" ? serverReviews.length : "—"}</strong></button><button type="button" onClick={() => setView("blocked")} className="rounded-xl bg-rose-200/[0.07] px-2 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-200"><span className="text-[10px] font-bold uppercase tracking-wide text-rose-50/70">Operación</span><strong className="mt-1 block text-xl font-black">{serverReviewsLoadState === "READY" ? alertCount : "—"}</strong></button></div></details>}
        {report.fixtureUsed && <aside className="rounded-3xl border border-amber-200/30 bg-amber-200/[0.08] p-4 text-sm"><p className="font-black">FIXTURE/DEMO · no usar para aprobación real</p><p className="mt-2 text-white/80">Fuente actual: fixture modelado · no es data viva. score modelado · Fixture · no precio runtime · Fixture · no Category ID.</p></aside>}

        {lastActionMessage !== "Todavía no realizaste ninguna acción." && <div role="status" aria-live="polite" className="rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.07] p-3 text-sm text-cyan-50">{lastActionMessage}</div>}
        {view === "top5" && radarGuards.showScoreTieWarning && <aside className="rounded-3xl border border-amber-200/30 bg-amber-200/[0.08] p-4"><p className="font-black">Orden provisional</p><p className="mt-1 text-sm text-white/80">Los cinco scores son iguales. Ningún producto se considera recomendado hasta desempatar el ranking.</p></aside>}

        {(view === "opportunities" || view === "top5") && <details className="rounded-2xl border border-white/10 bg-black/20 p-3"><summary className="cursor-pointer text-sm font-bold text-white/50">Cambiar vista de oportunidades</summary><nav aria-label="Vistas de oportunidades" className="mt-3 grid grid-cols-2 gap-1 rounded-xl border border-white/10 p-1"><button type="button" aria-pressed={view === "opportunities"} onClick={() => setView("opportunities")} className={`min-h-12 rounded-xl px-3 py-2 text-xs font-black ${view === "opportunities" ? "bg-white text-black" : "text-white/75"}`}>Cola priorizada</button><button type="button" aria-pressed={view === "top5"} onClick={() => setView("top5")} className={`min-h-12 rounded-xl px-3 py-2 text-xs font-black ${view === "top5" ? "bg-white text-black" : "text-white/75"}`}>Radar alternativo</button></nav></details>}
        <p className="sr-only">{report.stockHoldCandidates.length} productos están bloqueados por stock. B2-RUN continúa desactivado hasta completar todas las validaciones.</p>

        {serverReviewsLoadState === "ERROR" && <div role="alert" className="rounded-2xl border border-rose-200/25 bg-rose-200/[0.08] p-3 text-sm text-rose-50"><strong>No pudimos cargar En curso y Operación.</strong><span className="mt-1 block">{serverReviewsError}</span><button type="button" onClick={() => void loadServerReviews()} className="mt-3 min-h-11 rounded-xl border border-rose-100/30 px-3 font-black">Reintentar</button></div>}

        {view === "opportunities" && <div ref={opportunityRef} className="scroll-mt-32"><OpportunityCommandCenter guided onReviewCandidate={reviewOpportunityCandidate} onRadarRefresh={load} onRadarLookup={lookupRadarCandidateByProductId} confirmDestructiveRefresh={confirmReviewReset} preferredMarketRadarProductId={!selectedQueueOpportunity ? selectedRadarCandidate?.marketRadarProductId ?? null : null} /></div>}

        {view === "top5" && <section aria-labelledby="top5-heading"><h2 id="top5-heading" className="mb-3 text-xl font-black">Top 5 actual</h2><div className="space-y-4">{report.top5Candidates.map((candidate) => <CandidateCard key={candidate.candidateId} candidate={candidate} selected={!selectedQueueCandidate && state.selectedCandidateRank === candidate.candidateRank} pinned={pinnedCandidates.some((item) => pinnedCandidateMatchesRadar(item, candidate))} provisional={radarGuards.needsScoreDisambiguation} onSelect={() => { setSelectedQueueCandidate(null); setSelectedQueueOpportunity(null); act({ type: "SELECT_CANDIDATE", rank: candidate.candidateRank }) }} onUnavailable={() => act({ type: "MARK_UNAVAILABLE", rank: candidate.candidateRank })} />)}{!loading && report.top5Candidates.length === 0 && <p className="rounded-3xl border border-white/15 p-6 text-center text-white/75">No hay candidatos seleccionables.</p>}</div></section>}

        {view === "pinned" && (
          <section aria-labelledby="server-reviews-heading" className="space-y-3">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-cyan-100/60">Guardado server-side</p>
              <h2 id="server-reviews-heading" className="mt-1 text-xl font-black">Continuar donde quedé</h2>
            </div>
            {serverReviewsLoadState === "LOADING" && <p role="status" className="rounded-3xl border border-white/15 p-6 text-center text-white/70">Cargando revisiones guardadas…</p>}
            {serverReviewsLoadState === "READY" && serverReviews.map((review) => (
              <article key={review.id} className="rounded-3xl border border-cyan-200/20 bg-cyan-200/[0.05] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="text-xs font-black uppercase text-cyan-100">{routeLabel(review.current_step)}</p><h3 className="mt-2 font-black">{review.opportunity?.product_title ?? String(review.form_data.productTitle ?? "Producto en revisión")}</h3></div>
                  <StatusPill>{review.status.replaceAll("_", " ")}</StatusPill>
                </div>
                <p className="mt-2 text-xs text-white/55">Guardado {formatDate(review.updated_at)}</p>
                {review.opportunity ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => reviewOpportunityCandidate(review.opportunity!)} className="min-h-12 rounded-2xl bg-cyan-200 px-3 font-black text-black">Continuar validación</button>
                    {review.opportunity.can_open_listing_workspace ? (
                      <a href={`/admin/ebay/listing-workspace?opportunity=${encodeURIComponent(review.opportunity_id)}&candidate=${encodeURIComponent(review.candidate_key)}`} className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-emerald-200/30 px-3 text-center font-black text-emerald-50">Preparar draft</a>
                    ) : (
                      <button type="button" disabled aria-disabled="true" className="min-h-12 rounded-2xl border border-white/10 px-3 text-sm font-black text-white/40">Guardas pendientes</button>
                    )}
                  </div>
                ) : <p className="mt-3 text-sm text-amber-100">La oportunidad ya no está entre las primeras 100; sus datos siguen guardados.</p>}
              </article>
            ))}
            {serverReviewsLoadState === "READY" && serverReviews.length === 0 && <p className="rounded-3xl border border-white/15 p-6 text-center text-white/70">Todavía no hay revisiones guardadas en el servidor.</p>}
            <a href="/admin/ebay/listings/register" className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-cyan-200/30 px-3 text-center font-black text-cyan-50">Abrir asistente para vincular listing</a>
            <details className="rounded-2xl border border-white/10 p-3"><summary className="cursor-pointer text-sm font-bold">Revisiones locales anteriores</summary><p className="mt-2 text-xs text-white/60">En revisión / Pinned Candidates · {pinnedContinuity.pinnedCandidates.length} guardadas en este navegador.</p><span className="sr-only">RECHECK_PINNED_CANDIDATE CONTINUE_EBAY_MARKET_VALIDATION MARK_PINNED_UNAVAILABLE HOLD_PINNED_FOR_REVIEW UNPIN_CANDIDATE BROWSER_STATE_OR_LOCAL_STORAGE</span></details>
          </section>
        )}

        {view === "blocked" && <section aria-labelledby="blocked-heading" className="space-y-4"><div><p className="text-xs font-black uppercase tracking-widest text-rose-100/60">Operación · listings</p><h2 id="blocked-heading" className="mt-1 text-xl font-black">Listings y alertas Luna ↔ eBay</h2><p className="mt-1 text-sm text-white/65">Primero se muestran riesgos de listings activos; después, productos Luna detenidos por stock.</p><a href="/admin/ebay/listings/register" className="mt-3 inline-flex min-h-11 items-center rounded-2xl bg-white px-4 text-sm font-black text-black">Registrar listing manual</a></div><article className="rounded-3xl border border-emerald-200/20 bg-emerald-200/[0.05] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-widest text-emerald-100/60">Canal profesional</p><h3 className="mt-1 font-black">WhatsApp Seller Alerts</h3></div><StatusPill tone={whatsappLoadState === "ERROR" ? "danger" : whatsappStatus.configuration?.status === "READY" ? "good" : "warning"}>{whatsappLoadState === "LOADING" ? "CARGANDO" : whatsappLoadState === "ERROR" ? "SIN DATOS" : whatsappStatus.configuration?.status ?? "NO CONFIGURADO"}</StatusPill></div><p className="mt-2 text-sm leading-6 text-white/65">Inmediatas: oportunidad con evidencia suficiente, listing sin stock, stock 1–3, costo +5%, vínculo roto y fallo de draft. Bajas de costo menores y reposiciones no urgentes van al resumen.</p>{whatsappLoadState === "ERROR" && <p role="alert" className="mt-3 rounded-2xl border border-rose-200/25 bg-rose-200/[0.08] p-3 text-xs leading-5 text-rose-50">{whatsappLoadError}</p>}<dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Pendientes</dt><dd className="mt-1 font-black">{whatsappLoadState === "READY" ? whatsappStatus.health?.pending ?? 0 : "—"}</dd></div><div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Fallidos</dt><dd className="mt-1 font-black">{whatsappLoadState === "READY" ? whatsappStatus.health?.failed ?? 0 : "—"}</dd></div><div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Dead letter</dt><dd className="mt-1 font-black">{whatsappLoadState === "READY" ? whatsappStatus.health?.deadLetter ?? 0 : "—"}</dd></div></dl>{whatsappLoadState === "READY" && whatsappStatus.configuration?.status !== "READY" && <p className="mt-3 rounded-2xl border border-amber-200/20 p-3 text-xs leading-5 text-amber-50">Envíos reales bloqueados hasta configurar destinatario server-side, dos templates aprobados y activar el feature flag. Preflight: {whatsappStatus.configuration?.preflightStatus ?? "NOT_RUN"}.</p>}<div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => void runWhatsAppPreflight()} disabled={whatsappPreflightRunning} className="min-h-11 rounded-2xl bg-emerald-200 px-3 text-sm font-black text-black disabled:opacity-50">{whatsappPreflightRunning ? "Validando…" : "Validar Meta"}</button><button type="button" onClick={() => void loadWhatsAppStatus()} disabled={whatsappLoadState === "LOADING"} className="min-h-11 rounded-2xl border border-emerald-200/25 px-3 text-sm font-black disabled:opacity-50">Actualizar canal</button></div></article>{serverReviewsLoadState === "READY" && serverAlerts.activeListingRisks.map((risk) => <article key={risk.id} className="rounded-3xl border border-rose-200/30 bg-rose-200/[0.08] p-4"><StatusPill tone="danger">{risk.risk_priority.toUpperCase()} · {risk.risk_type.replaceAll("_", " ")}</StatusPill><h3 className="mt-3 font-black">{risk.risk_summary}</h3>{risk.recommended_action && <p className="mt-2 text-sm leading-6 text-white/70">Siguiente acción: {risk.recommended_action}</p>}</article>)}{serverReviewsLoadState === "READY" && serverAlerts.outbox.filter((alert) => !serverAlerts.activeListingRisks.some((risk) => risk.id === String(alert.payload.riskId ?? ""))).slice(0, 10).map((alert) => <article key={alert.id} className="rounded-2xl border border-amber-200/20 bg-amber-200/[0.05] p-3"><p className="text-xs font-black uppercase text-amber-100">{alert.priority} · {alert.alert_type.replaceAll("_", " ")}</p><p className="mt-1 text-xs text-white/55">Notificación {alert.status} · {formatDate(alert.created_at)}</p></article>)}{serverReviewsLoadState === "READY" && serverAlerts.activeListingRisks.length === 0 && <p className="rounded-2xl border border-emerald-200/20 bg-emerald-200/[0.05] p-4 text-sm text-emerald-50">No hay riesgos abiertos en listings vinculados. Sincroniza tus listings activos desde Oportunidades para ampliar la cobertura.</p>}<details className="rounded-3xl border border-white/10 p-4" open={serverReviewsLoadState === "READY" && serverAlerts.activeListingRisks.length === 0}><summary className="cursor-pointer font-black">Bloqueados por stock Luna · {report.stockHoldCandidates.length}</summary><div className="mt-3 space-y-3">{report.stockHoldCandidates.slice(0, blockedVisible).map((candidate) => <article key={candidate.candidateId} className="rounded-2xl border border-rose-200/20 bg-rose-200/[0.06] p-4"><h3 className="font-black">{candidate.productTitle}</h3><p className="mt-2 text-sm text-white/75">{routeLabel(candidate.routeRecommendation)} · último scan {formatDate(candidate.lastSeenAt)}</p><p className="mt-2 break-all text-xs text-white/50">SKU: {formatValue(candidate.supplierSku)}</p></article>)}</div>{blockedVisible < report.stockHoldCandidates.length && <button type="button" onClick={() => setBlockedVisible((value) => value + 20)} className="mt-4 min-h-12 w-full rounded-2xl border border-white/25 font-black">Mostrar 20 más</button>}</details></section>}

        {view === "loop1" && (
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
                {journeyStep === 2 && <section aria-labelledby="luna-first-heading" className="rounded-3xl border border-emerald-200/25 bg-emerald-200/[0.06] p-4">
                  <p className="text-xs font-black uppercase tracking-widest text-emerald-100/65">Paso 2 · Luna</p>
                  <h3 id="luna-first-heading" className="mt-1 text-lg font-black">Confirmar Luna: stock, costo e imagen</h3>
                  <p className="mt-2 text-sm leading-6 text-white/65">eBay se analiza después de confirmar que todavía podemos comprar y enviar exactamente este producto.</p>
                  <p className="mt-1 text-xs font-bold text-amber-100">Completa Luna antes de analizar eBay.</p>
                  <div className="mt-3 overflow-hidden rounded-2xl border border-white/15 bg-white">{safeProductImageUrl ? <img src={safeProductImageUrl} alt={`Imagen de ${selectedRadarCandidate.productTitle} registrada por Radar`} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="max-h-64 w-full object-contain" /> : <div className="flex min-h-32 items-center justify-center bg-black/90 p-4 text-center text-sm font-bold text-white/60">Imagen de Luna no disponible</div>}</div>
                  {lunaCatalogUrl ? <a href={lunaCatalogUrl} target="_blank" rel="noreferrer" onClick={() => setCatalogCheckOpened(true)} className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-emerald-200/35 px-4 text-center font-black text-emerald-50">Abrir producto en Luna Portex ↗</a> : <p className="mt-3 rounded-2xl border border-rose-200/25 p-3 text-sm text-rose-50">Falta URL válida del catálogo Luna.</p>}
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label><span className="text-xs font-bold text-white/70">Stock observado <span className="text-rose-300">*</span></span><input inputMode="numeric" pattern="[0-9]*" placeholder="Ej. 8" value={stockQuantity} aria-invalid={!state.stockQuantityConfirmed} aria-describedby={!state.stockQuantityConfirmed ? "stock-required-help" : undefined} onChange={(event) => resetStockConfirmation(event.target.value.replace(/\D/g, ""))} className={`mt-1 min-h-12 w-full rounded-2xl border bg-black/30 px-3 outline-none focus:ring-2 focus:ring-cyan-200 ${!state.stockQuantityConfirmed ? "border-rose-400 ring-1 ring-rose-400/35" : "border-emerald-300/50"}`} />{!state.stockQuantityConfirmed && <span id="stock-required-help" className="mt-1 block text-xs font-bold text-rose-300">Ingresa una cantidad mayor que cero y confirma el stock.</span>}</label>
                    <label><span className="text-xs font-bold text-white/70">Costo Luna USD <span className="text-rose-300">*</span></span><input inputMode="decimal" placeholder="Ej. 4.00" value={lunaPrice} aria-invalid={!lunaPriceConfirmed} aria-describedby={!lunaPriceConfirmed ? "price-required-help" : undefined} onChange={(event) => resetLunaCatalogConfirmation(event.target.value)} className={`mt-1 min-h-12 w-full rounded-2xl border bg-black/30 px-3 outline-none focus:ring-2 focus:ring-cyan-200 ${!lunaPriceConfirmed ? "border-rose-400 ring-1 ring-rose-400/35" : "border-emerald-300/50"}`} />{!lunaPriceConfirmed && <span id="price-required-help" className="mt-1 block text-xs font-bold text-rose-300">Ingresa el costo y abre Luna para confirmar precio e imagen.</span>}</label>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div><button type="button" disabled={!Number.isInteger(Number(stockQuantity)) || Number(stockQuantity) < 1} onClick={() => act({ type: "CONFIRM_STOCK_QTY", quantity: Number(stockQuantity) })} className="min-h-12 w-full rounded-2xl bg-white px-2 text-sm font-black text-black disabled:opacity-40">{state.stockQuantityConfirmed === Number(stockQuantity) ? "✓ Stock confirmado" : "Confirmar stock"}</button></div>
                    <div><button type="button" disabled={!catalogCheckOpened || !lunaCatalogUrl || !safeProductImageUrl || !(Number(lunaPrice) > 0)} onClick={confirmLunaCatalogMatch} className="min-h-12 w-full rounded-2xl bg-emerald-200 px-2 text-sm font-black text-black disabled:opacity-40">{lunaPriceConfirmed && state.imageConfirmed ? "✓ Precio e imagen coinciden" : "Confirmar que precio e imagen coinciden"}</button>{!lunaPriceConfirmed && <div className="mt-1 space-y-0.5 text-[11px] font-bold text-amber-100">{!(Number(lunaPrice) > 0) && <p>Falta confirmar costo</p>}{!safeProductImageUrl && <p>Falta confirmar imagen</p>}{lunaCatalogUrl && !catalogCheckOpened && <p>Abre primero el producto en Luna</p>}</div>}</div>
                  </div>
                </section>}
                {journeyStep === 3 && <div className="rounded-3xl border border-white/15 bg-white/[0.045] p-4">
                  <p className="font-black">Paso 3 · eBay: comparables y señales de demanda</p>
                  <p className="mt-1 text-sm leading-6 text-white/75">
                    IMNOVA consulta eBay en modo read-only, descarta productos con
                    tamaño, variante o pack contradictorios y pondera las palabras
                    según la evidencia disponible. Sólo llama “ventas verificadas”
                    al historial oficial; las señales de Browse permanecen estimadas.
                    No copia títulos ni imágenes.
                  </p>
                  <dl className="mt-3 grid gap-2 rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.06] p-3 text-sm">
                    <div><dt className="text-white/55">Producto en Luna</dt><dd className="mt-1 font-black">{selectedRadarCandidate.productTitle}</dd></div>
                    <div className="grid grid-cols-2 gap-2"><div><dt className="text-white/55">Variante</dt><dd className="font-bold">{formatValue(selectedRadarCandidate.variantTitle)}</dd></div><div><dt className="text-white/55">SKU</dt><dd className="break-all font-bold">{formatValue(selectedRadarCandidate.supplierSku)}</dd></div></div>
                  </dl>
                  <button
                    type="button"
                    disabled={sellerKeywordDemandLoading || !loop1AnalysisGate.analysisEnabled}
                    onClick={() => void runSellerKeywordDemandValidation()}
                    className="mt-3 min-h-14 w-full rounded-2xl bg-cyan-200 px-4 font-black text-black disabled:opacity-50"
                  >
                    {sellerKeywordDemandLoading
                      ? "Analizando comparables y demanda…"
                      : sellerKeywordDemand
                        ? "↻ Actualizar mercado eBay"
                        : "Analizar mercado eBay"}
                  </button>
                  <p className="mt-2 text-xs text-white/55">Analizar comparables y demanda en eBay · lectura oficial sin escrituras.</p>
                  {!sellerKeywordDemandLoading && !loop1AnalysisGate.analysisEnabled && <p className="mt-2 text-xs font-bold text-amber-100">{loop1AnalysisGate.disabledReason}</p>}

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

                      <section aria-labelledby="visual-winner-evidence-heading" className="rounded-2xl border border-sky-200/25 bg-sky-200/[0.07] p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <h3 id="visual-winner-evidence-heading" className="font-black">Patrones visuales del mercado</h3>
                            <p className="mt-1 text-xs leading-5 text-white/60">Sólo observaciones estructuradas de comparables exactos; asociación no significa causalidad.</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <StatusPill tone={visualWinnerEvidence?.status === "AVAILABLE" ? "good" : "warning"}>{visualWinnerEvidence?.status ?? "N/D"}</StatusPill>
                            <StatusPill>{visualWinnerEvidence?.visualPatternConfidence.level ?? "INSUFFICIENT"}</StatusPill>
                            <StatusPill>Score {visualWinnerEvidence?.visualOpportunityScore ?? "N/D"}</StatusPill>
                          </div>
                        </div>
                        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                          <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Vendidos exactos</dt><dd className="mt-1 font-black">{visualWinnerEvidence?.visualEvidenceSummary.soldOrCompletedExactSampleSize ?? 0}</dd></div>
                          <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Activos exactos</dt><dd className="mt-1 font-black">{visualWinnerEvidence?.visualEvidenceSummary.activeExactSampleSize ?? 0}</dd></div>
                          <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Evidencia visual útil</dt><dd className="mt-1 font-black">{visualWinnerEvidence?.visualPatternConfidence.sampleSize ?? 0}</dd></div>
                          <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Confianza</dt><dd className="mt-1 font-black">{visualWinnerEvidence?.visualPatternConfidence.score ?? "N/D"}</dd></div>
                        </dl>
                        {visualWinnerEvidence?.status === "AVAILABLE" ? (
                          <div className="mt-4 grid gap-4 lg:grid-cols-2">
                            <div>
                              <h4 className="text-sm font-black">Qué se repite</h4>
                              <ul className="mt-2 grid gap-2 text-xs">
                                {[...visualWinnerEvidence.mainImagePatterns, ...visualWinnerEvidence.secondaryImagePatterns].map((pattern) => (
                                  <li key={pattern.pattern} className="rounded-xl border border-white/10 bg-black/20 p-2">
                                    <p className="font-black">{pattern.pattern.replaceAll("_", " ")}</p>
                                    <p className="mt-1 text-white/65">Vendidos: {pattern.soldOrCompletedExactMatches.count}/{pattern.soldOrCompletedExactMatches.observed || "N/D"} · Activos: {pattern.activeExactMatches.count}/{pattern.activeExactMatches.observed || "N/D"}</p>
                                    <p className="mt-1 text-white/45">{pattern.interpretation.replaceAll("_", " ")}</p>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <h4 className="text-sm font-black">Oportunidades visuales</h4>
                              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-white/75">
                                {visualWinnerEvidence.differentiationOpportunities.length
                                  ? visualWinnerEvidence.differentiationOpportunities.map((entry) => <li key={entry.opportunity}>{entry.opportunity.replaceAll("_", " ")}</li>)
                                  : <li>N/D · la evidencia no permite diferenciar patrones.</li>}
                              </ul>
                              <h4 className="mt-4 text-sm font-black">Estrategia original de seis imágenes</h4>
                              <ol className="mt-2 space-y-2 text-xs">
                                {visualWinnerEvidence.recommendedSixImageStrategy.map((entry) => (
                                  <li key={entry.slot} className="rounded-xl bg-black/20 p-2"><strong>{entry.position}. {entry.slot.replaceAll("_", " ")}</strong><span className="mt-1 block text-white/65">{entry.strategy}</span></li>
                                ))}
                              </ol>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-3 rounded-xl border border-amber-200/20 bg-amber-200/[0.06] p-3 text-sm text-amber-50">N/D · eBay no devolvió observaciones visuales estructuradas y todavía no existe una importación humana revisada. No se descargaron ni copiaron imágenes.</p>
                        )}
                        <details className="mt-3 rounded-xl border border-white/10 p-2 text-xs">
                          <summary className="cursor-pointer font-black">Limitaciones de evidencia</summary>
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-white/60">
                            {(visualWinnerEvidence?.unsupportedVisualHypotheses ?? ["NO_USABLE_STRUCTURED_VISUAL_OBSERVATIONS"]).map((item) => <li key={item}>{item.replaceAll("_", " ")}</li>)}
                          </ul>
                          <p className="mt-2 text-white/45">Imágenes descargadas: 0 · copiadas: 0 · usadas como input generativo: 0 · escrituras eBay: 0.</p>
                        </details>
                      </section>

                      {opportunityAssessment && (
                        <section aria-labelledby="professional-opportunity-heading" className="rounded-2xl border border-cyan-200/25 bg-cyan-200/[0.07] p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                          <h3 id="professional-opportunity-heading" className="font-black">Resultado económico y oportunidad profesional</h3>
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

                      <section ref={comparablesRef} aria-labelledby="top-selling-heading" className="scroll-mt-32">
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
                                {comparable.itemWebUrl
                                  ? <a href={comparable.itemWebUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/20 px-3 text-center text-sm font-bold">Ver listing ↗</a>
                                  : <button type="button" disabled aria-disabled="true" className="min-h-11 rounded-xl border border-white/10 px-3 text-sm font-bold text-white/40">URL no disponible</button>}
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
                    <div ref={identityConfirmationRef} className="mt-4 scroll-mt-32 rounded-2xl border border-cyan-200/25 bg-cyan-200/[0.06] p-3">
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
                </div>}

                {journeyStep === 4 && <>
                <Loop1WinnerAnalysisSummary
                  decisionPackage={winnerDecisionPackage}
                  keywordReport={sellerKeywordDemand}
                  saveState={decisionPackageSaveState}
                  saveError={decisionPackageSaveError}
                  packageStored={Boolean(decisionPackageId)}
                  readbackVerified={decisionPackageReadbackVerified}
                  saveDisabledReason={decisionPackageSaveDisabledReason}
                  onSave={() => void saveWinnerDecisionPackage()}
                  onRead={() => {
                    if (decisionPackageId) void readPersistedDecisionPackage(decisionPackageId)
                  }}
                />

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
                  {selectedQueueOpportunity
                    ? <p className="mt-4 rounded-2xl border border-emerald-200/25 bg-emerald-200/[0.06] p-3 text-sm font-bold text-emerald-50">Continúa con el botón fijo “Completar paquete” cuando las guardas estén resueltas.</p>
                    : <button
                      type="button"
                      onClick={() => {
                        setLastActionMessage("Ahora toca “Validar ahora” en este mismo producto de la cola canónica. Tus confirmaciones locales se conservarán al vincularlo.")
                        setView("opportunities")
                      }}
                      className="mt-4 min-h-14 w-full rounded-2xl bg-emerald-200 px-4 font-black text-black"
                    >
                      Vincular con la oportunidad canónica
                    </button>}
                </div>
                </>}
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
      {selectedRadarCandidate && view === "top5" && <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-40 border-t border-white/15 bg-[#0b1018]/95 p-3 backdrop-blur"><div className="mx-auto flex max-w-xl items-center gap-3"><p className="min-w-0 flex-1 truncate text-sm font-bold">Seleccionado: {selectedRadarCandidate.productTitle}</p><button type="button" onClick={() => setView("loop1")} className="min-h-12 rounded-2xl bg-emerald-200 px-4 font-black text-black">Abrir Loop 1</button></div></div>}
      <SellerOsMobileNav
        active={view === "blocked" ? "operations" : "ebay-opportunities"}
        operationCount={serverReviewsLoadState === "READY" ? alertCount : 0}
        onNavigate={(destination) => {
          if (destination === "ebay-opportunities") { setView("opportunities"); return true }
          if (hasReviewInProgress && !confirmReviewReset()) return true
          return false
        }}
      />
    </main>
  )
}
