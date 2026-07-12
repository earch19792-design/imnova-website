"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import demoRadarJson from "@/tools/fixtures/ebay-mobile-review-real-radar-connector-v1.json"
import {
  buildMobileReviewRealRadarConnector,
  loadMarketRadarReadonlyDashboard,
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
import {
  MOBILE_REVIEW_PINNED_STORAGE_KEY,
  parsePinnedCandidates,
  serializePinnedCandidates,
} from "@/lib/ebay/ebay-mobile-review-local-state"

const emptyReport = buildMobileReviewRealRadarConnector({ products: [] })
type View = "top5" | "pinned" | "blocked" | "decision"

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
  NEED_IMAGE_REVIEW: "Revisar imagen",
  STOCK_HOLD: "Bloqueado por stock",
}

const formatValue = (value: unknown) => value === null || value === undefined || value === "" ? "Pendiente" : String(value)
const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "Pendiente"
const routeLabel = (route: string | null) => route ? humanRouteLabels[route] ?? route.replaceAll("_", " ") : "Sin ruta"

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
        <div className="flex justify-between gap-3 rounded-2xl bg-black/30 p-3"><span className="text-white/70">Stock</span><strong className="text-right">{formatValue(candidate.stockQuantity)} · {candidate.stockSource}</strong></div>
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
        <button type="button" onClick={onSelect} className="min-h-12 rounded-2xl bg-emerald-200 px-4 py-3 font-black text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Revisar producto<span className="block text-[10px]">SELECT_CANDIDATE</span></button>
        <button type="button" onClick={() => { if (window.confirm(`¿Marcar “${candidate.productTitle}” como no disponible?`)) onUnavailable() }} className="min-h-12 rounded-2xl border border-rose-200/35 px-4 py-3 font-bold text-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-rose-200">Marcar no disponible<span className="block text-[10px]">MARK_UNAVAILABLE</span></button>
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
  const [loading, setLoading] = useState(true)
  const [loadState, setLoadState] = useState("LOADING")
  const [loadMessage, setLoadMessage] = useState("Cargando Market Radar read-only…")
  const [lastActionMessage, setLastActionMessage] = useState("Todavía no realizaste ninguna acción.")
  const [pinnedCandidates, setPinnedCandidates] = useState<PinnedCandidate[]>([])
  const [storageRestored, setStorageRestored] = useState(false)
  const [view, setView] = useState<View>("top5")
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
      setReport(nextReport); setState(buildInitialMobileReviewState(toMobileFixture(nextReport.top5Candidates)))
      if (nextReport.realRadarCandidatesCount === 0) { setLoadState("RADAR_EMPTY"); setLoadMessage("Radar respondió, pero no devolvió productos. Ejecuta o revisa el scan antes de decidir.") }
      else { setLoadState("READY"); setLoadMessage(`${nextReport.top5Candidates.length} candidatos disponibles de ${nextReport.realRadarCandidatesCount} productos observados.`) }
    } catch (error) {
      setReport(emptyReport); setState(buildInitialMobileReviewState(toMobileFixture([])))
      const auth = error instanceof Error && error.message === "AUTH_REQUIRED"
      setLoadState(auth ? "AUTH_REQUIRED" : "RADAR_REQUEST_FAILED")
      setLoadMessage(auth ? "La sesión admin expiró. Vuelve a iniciar sesión para leer Market Radar." : "No se pudo consultar Market Radar. Revisa la conexión e intenta nuevamente.")
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])
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
  const selectedRadarCandidate = report.top5Candidates.find((candidate) => candidate.candidateRank === state.selectedCandidateRank) ?? null
  const pinnedContinuity = useMemo(() => buildPinnedCandidateContinuityReport(report.top5Candidates, pinnedCandidates, report.allCandidates), [report, pinnedCandidates])
  const localConfirmationsComplete = Boolean(state.sameProductConfirmed && state.stockQuantityConfirmed && state.imageConfirmed && lunaPriceConfirmed)
  const radarGuards = useMemo(() => buildMobileReviewRadarGuardEnforcement({ dataSource: report.dataSource, realRadarTop5Loaded: report.realRadarTop5Loaded, top5Candidates: report.top5Candidates, selectedCandidate: selectedRadarCandidate, localConfirmationsComplete, manualConfirmations: { sameProductConfirmed: state.sameProductConfirmed, stockConfirmed: (state.stockQuantityConfirmed ?? 0) > 0, stockQuantityConfirmed: state.stockQuantityConfirmed, imageConfirmed: state.imageConfirmed, lunaPriceConfirmed, lunaPrice: lunaPriceConfirmed ? Number(lunaPrice) : null } }), [report, selectedRadarCandidate, localConfirmationsComplete, state, lunaPriceConfirmed, lunaPrice])
  const effectiveDecision = useMemo(() => buildMobileReviewEffectiveDecision({ dataSource: report.dataSource, selectedCandidateName: decision.selectedCandidateName, pendingGuards: radarGuards.pendingGuards, primaryBlockingReason: radarGuards.primaryBlockingReason, localConfirmationsComplete, holdForReview: state.holdForReview, refreshRequested: state.refreshRequested }), [report.dataSource, decision.selectedCandidateName, radarGuards, localConfirmationsComplete, state.holdForReview, state.refreshRequested])
  const summary = useMemo(() => JSON.stringify({ ...JSON.parse(buildMobileReviewCopyPasteSummary(state)), dataSource: report.dataSource, mobileDecisionPersistence: "BROWSER_STATE_ONLY", decisionPersistence: "BROWSER_STATE_OR_LOCAL_STORAGE", officialApprovalRecord: false, effectiveDecision, pendingGuards: selectedRadarCandidate ? radarGuards.pendingGuards : null, guardsEvaluated: Boolean(selectedRadarCandidate), manualConfirmationReconciliation: radarGuards.reconciliation, pinnedCandidateContinuity: pinnedContinuity, canPublish: false }, null, 2), [state, report.dataSource, effectiveDecision, selectedRadarCandidate, radarGuards, pinnedContinuity])

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
    if (action.type === "SELECT_CANDIDATE" || action.type === "MARK_UNAVAILABLE") { setStockQuantity(""); setLunaPrice(""); setLunaPriceConfirmed(false) }
    if (action.type === "APPROVE_B2_RUN_PREFLIGHT") { setLastActionMessage(`B2-RUN continúa bloqueado. Próximo paso: ${routeLabel(effectiveDecision.nextRecommendedRoute)}.`); return }
    setState((current) => applyMobileReviewAction(current, action))
    const messages: Record<string, string> = { MARK_UNAVAILABLE: "Producto marcado no disponible en este navegador. Puedes deshacer recargando antes de persistir otro estado.", SELECT_CANDIDATE: "Producto seleccionado. Completa las cuatro confirmaciones.", CONFIRM_SAME_PRODUCT: "Identidad del producto confirmada localmente.", CONFIRM_STOCK_QTY: `Stock confirmado: ${stockQuantity} unidades.`, CONFIRM_IMAGE_OK: "Imagen confirmada localmente.", REQUEST_LUNA_SCAN_REFRESH: "Solicitud de refresco preparada localmente.", HOLD_FOR_REVIEW: "Revisión puesta en espera." }
    setLastActionMessage(messages[action.type] ?? "Acción local registrada.")
    if (action.type === "SELECT_CANDIDATE") { setView("decision"); window.setTimeout(() => confirmationRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }), 50) }
  }

  const sourceLabel = report.dataSource === "MARKET_RADAR_READONLY" ? "REAL RADAR" : report.dataSource === "DEMO_FIXTURE_ONLY" ? "DEMO" : loadState === "AUTH_REQUIRED" ? "SESIÓN REQUERIDA" : loadState === "RADAR_REQUEST_FAILED" ? "ERROR DE RADAR" : "SIN DATOS"
  const tabs: { id: View; label: string; count?: number }[] = [{ id: "top5", label: "Top 5", count: report.top5Candidates.length }, { id: "pinned", label: "En revisión", count: pinnedCandidates.length }, { id: "blocked", label: "Bloqueados", count: report.stockHoldCandidates.length }, { id: "decision", label: "Decisión" }]

  return (
    <main className="min-h-screen bg-[#05070d] px-4 pb-28 pt-4 text-white sm:px-6">
      <section className="mx-auto flex max-w-xl flex-col gap-4">
        <header className="sticky top-0 z-30 -mx-4 border-b border-white/10 bg-[#05070d]/95 px-4 pb-3 pt-2 backdrop-blur">
          <div className="flex items-center justify-between gap-3"><a href="/admin/ebay-seller-os" className="min-h-11 rounded-full border border-white/20 px-4 py-3 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200">← Seller OS</a><button type="button" onClick={() => void load()} disabled={loading} className="min-h-11 rounded-full border border-cyan-200/35 px-4 py-3 text-sm font-bold text-cyan-50 disabled:opacity-50">{loading ? "Cargando…" : "↻ Actualizar"}</button></div>
          <div className="mt-3 flex items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-cyan-100">Revisión privada · read-only</p><h1 className="mt-1 text-2xl font-black">Top 5 móvil</h1></div><StatusPill tone={report.dataSource === "MARKET_RADAR_READONLY" ? "good" : report.fixtureUsed ? "warning" : "danger"}>{sourceLabel}</StatusPill></div>
        </header>

        <section className={`rounded-3xl border p-4 ${loadState === "READY" ? "border-emerald-200/25 bg-emerald-200/[0.07]" : "border-amber-200/25 bg-amber-200/[0.07]"}`}>
          <p className="font-black">{loadMessage}</p><p className="mt-2 text-sm text-white/75">Publicación desactivada · sin eBay write · sin Supabase write.</p>
          <p className="sr-only">Radar devolvió {report.realRadarCandidatesCount} productos; candidatesNeededForTop5: {report.candidatesNeededForTop5}. stock source y stock age disponibles en detalles. no eBay write.</p>
          {loadState === "AUTH_REQUIRED" ? <a href="/admin/login?returnTo=%2Fadmin%2Febay%2Fmobile-review" className="mt-3 inline-flex min-h-11 items-center rounded-2xl bg-white px-4 py-2 font-black text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200">Iniciar sesión</a> : loadState !== "READY" && <button type="button" onClick={() => void load()} className="mt-3 min-h-11 rounded-2xl bg-white px-4 py-2 font-black text-black">Reintentar lectura</button>}
        </section>
        {report.fixtureUsed && <aside className="rounded-3xl border border-amber-200/30 bg-amber-200/[0.08] p-4 text-sm"><p className="font-black">FIXTURE/DEMO · no usar para aprobación real</p><p className="mt-2 text-white/80">Fuente actual: fixture modelado · no es data viva. score modelado · Fixture · no precio runtime · Fixture · no Category ID.</p></aside>}

        <div role="status" aria-live="polite" className="rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.07] p-3 text-sm text-cyan-50">{lastActionMessage}</div>
        {radarGuards.showScoreTieWarning && <aside className="rounded-3xl border border-amber-200/30 bg-amber-200/[0.08] p-4"><p className="font-black">Orden provisional</p><p className="mt-1 text-sm text-white/80">Los cinco scores son iguales. Ningún producto se considera recomendado hasta desempatar el ranking.</p></aside>}

        <nav aria-label="Secciones de Mobile Review" className="grid grid-cols-4 gap-1 rounded-2xl border border-white/15 bg-black/40 p-1">
          {tabs.map((tab) => <button key={tab.id} type="button" aria-current={view === tab.id ? "page" : undefined} onClick={() => setView(tab.id)} className={`min-h-12 rounded-xl px-1 py-2 text-[11px] font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 ${view === tab.id ? "bg-white text-black" : "text-white/75"}`}>{tab.label}{tab.count !== undefined && <span className="block">{tab.count}</span>}</button>)}
        </nav>
        <p className="sr-only">Productos reales excluidos. No se puede aprobar B2-RUN todavía.</p>

        {view === "top5" && <section aria-labelledby="top5-heading"><h2 id="top5-heading" className="mb-3 text-xl font-black">Top 5 actual</h2><div className="space-y-4">{report.top5Candidates.map((candidate) => <CandidateCard key={candidate.candidateId} candidate={candidate} selected={state.selectedCandidateRank === candidate.candidateRank} pinned={pinnedCandidates.some((item) => pinnedCandidateMatchesRadar(item, candidate))} provisional={radarGuards.needsScoreDisambiguation} onSelect={() => act({ type: "SELECT_CANDIDATE", rank: candidate.candidateRank })} onUnavailable={() => act({ type: "MARK_UNAVAILABLE", rank: candidate.candidateRank })} />)}{!loading && report.top5Candidates.length === 0 && <p className="rounded-3xl border border-white/15 p-6 text-center text-white/75">No hay candidatos seleccionables.</p>}</div></section>}

        {view === "pinned" && <section aria-labelledby="pinned-heading"><h2 id="pinned-heading" className="text-xl font-black">En revisión / Pinned Candidates</h2><p className="mt-1 text-sm text-white/75">Continuidad local validada y con vencimiento. No es una aprobación oficial.</p><div className="mt-4 space-y-4">{pinnedContinuity.pinnedCandidates.map((candidate) => <article key={candidate.pinnedCandidateId} className="rounded-3xl border border-violet-200/25 bg-violet-200/[0.07] p-4"><StatusPill tone={candidate.supplierDrift.supplierDriftDetected ? "warning" : "good"}>{routeLabel(candidate.nextRecommendedRoute)}</StatusPill><h3 className="mt-3 text-lg font-black">{candidate.productName}</h3><dl className="mt-3 grid gap-2 text-sm"><div className="flex justify-between"><dt>Presencia Radar</dt><dd className="font-bold">{candidate.radarPresenceStatus}</dd></div><div className="flex justify-between"><dt>Stock humano</dt><dd className="font-bold">{formatValue(candidate.stockQuantityConfirmed)}</dd></div><div className="flex justify-between"><dt>Precio Luna</dt><dd className="font-bold">{candidate.lunaPrice ? `$${candidate.lunaPrice.toFixed(2)}` : "Pendiente"}</dd></div><div className="flex justify-between"><dt>Supplier drift</dt><dd className="font-bold">{candidate.supplierDrift.supplierDriftDetected ? "Detectado" : "Sin cambios"}</dd></div></dl><details className="mt-3 rounded-2xl border border-white/15 p-3"><summary className="cursor-pointer font-bold">Comparación y trazabilidad</summary><pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-white/80">{JSON.stringify(candidate.supplierDrift, null, 2)}</pre></details><div className="mt-4 grid gap-2"><button type="button" onClick={() => actPinned({ type: "RECHECK_PINNED_CANDIDATE", pinnedCandidateId: candidate.pinnedCandidateId })} className="min-h-12 rounded-2xl border border-cyan-200/35 font-bold">Revisar contra Radar<span className="block text-[10px]">RECHECK_PINNED_CANDIDATE</span></button><button type="button" disabled={!candidate.canContinueEbayMarketValidation} onClick={() => actPinned({ type: "CONTINUE_EBAY_MARKET_VALIDATION", pinnedCandidateId: candidate.pinnedCandidateId })} className="min-h-12 rounded-2xl bg-violet-200 px-3 font-black text-black disabled:opacity-40">Continuar validación eBay<span className="block text-[10px]">CONTINUE_EBAY_MARKET_VALIDATION</span></button><details className="rounded-2xl border border-white/15 p-3"><summary className="cursor-pointer font-bold">Más acciones</summary><div className="mt-3 grid gap-2"><button type="button" onClick={() => actPinned({ type: "MARK_PINNED_UNAVAILABLE", pinnedCandidateId: candidate.pinnedCandidateId })} className="min-h-12 rounded-2xl border border-rose-200/35">Marcar no disponible · MARK_PINNED_UNAVAILABLE</button><button type="button" onClick={() => actPinned({ type: "HOLD_PINNED_FOR_REVIEW", pinnedCandidateId: candidate.pinnedCandidateId })} className="min-h-12 rounded-2xl border border-amber-200/35">Poner en espera · HOLD_PINNED_FOR_REVIEW</button><button type="button" onClick={() => actPinned({ type: "UNPIN_CANDIDATE", pinnedCandidateId: candidate.pinnedCandidateId })} className="min-h-12 rounded-2xl border border-white/25">Quitar de revisión · UNPIN_CANDIDATE</button></div></details></div></article>)}{pinnedCandidates.length === 0 && <p className="rounded-3xl border border-white/15 p-6 text-center text-white/75">No hay productos guardados en revisión.</p>}</div></section>}

        {view === "blocked" && <section aria-labelledby="blocked-heading"><h2 id="blocked-heading" className="text-xl font-black">Bloqueados por stock</h2><p className="mt-1 text-sm text-white/75">Se muestran {Math.min(blockedVisible, report.stockHoldCandidates.length)} de {report.stockHoldCandidates.length}.</p><div className="mt-4 space-y-3">{report.stockHoldCandidates.slice(0, blockedVisible).map((candidate) => <article key={candidate.candidateId} className="rounded-2xl border border-rose-200/20 bg-rose-200/[0.06] p-4"><h3 className="font-black">{candidate.productTitle}</h3><p className="mt-2 text-sm text-white/75">{routeLabel(candidate.routeRecommendation)} · último scan {formatDate(candidate.lastSeenAt)}</p><details className="mt-2"><summary className="cursor-pointer text-sm font-bold">Ver identificación</summary><p className="mt-2 break-all text-xs">Radar: {candidate.marketRadarProductId}<br />SKU: {formatValue(candidate.supplierSku)}</p></details></article>)}</div>{blockedVisible < report.stockHoldCandidates.length && <button type="button" onClick={() => setBlockedVisible((value) => value + 20)} className="mt-4 min-h-12 w-full rounded-2xl border border-white/25 font-black">Mostrar 20 más</button>}</section>}

        {view === "decision" && <section ref={confirmationRef} className="scroll-mt-32 space-y-4" aria-labelledby="decision-heading"><div><h2 id="decision-heading" className="text-xl font-black">Confirmar producto</h2><p className="mt-1 text-sm text-white/75">{decision.selectedCandidateName ?? "Selecciona un producto desde Top 5."}</p></div>{selectedRadarCandidate && <><div className="rounded-3xl border border-white/15 bg-white/[0.045] p-4"><p className="font-black">1. Identidad</p><p className="mt-1 text-sm text-white/75">Confirma que el producto, variante y referencia corresponden.</p><button type="button" onClick={() => act({ type: "CONFIRM_SAME_PRODUCT" })} className="mt-3 min-h-12 w-full rounded-2xl border border-white/25 font-black">{state.sameProductConfirmed ? "✓ Mismo producto confirmado" : "Confirmar mismo producto"}<span className="block text-[10px]">CONFIRM_SAME_PRODUCT</span></button></div><div className="rounded-3xl border border-white/15 bg-white/[0.045] p-4"><label htmlFor="stock-confirmed" className="font-black">2. Cantidad observada</label><p className="mt-1 text-sm text-white/75">Ingresa manualmente un número entero mayor que cero.</p><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"><input id="stock-confirmed" inputMode="numeric" pattern="[0-9]*" placeholder="Ej. 2" value={stockQuantity} onChange={(event) => setStockQuantity(event.target.value.replace(/\D/g, ""))} className="min-h-12 rounded-2xl border border-white/25 bg-black/30 px-4 text-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200" /><button type="button" disabled={!Number.isInteger(Number(stockQuantity)) || Number(stockQuantity) < 1} onClick={() => act({ type: "CONFIRM_STOCK_QTY", quantity: Number(stockQuantity) })} className="min-h-12 rounded-2xl bg-cyan-200 px-4 font-black text-black disabled:opacity-40">Confirmar stock<span className="block text-[10px]">CONFIRM_STOCK_QTY</span></button></div></div><div className="rounded-3xl border border-white/15 bg-white/[0.045] p-4"><label htmlFor="luna-price-confirmed" className="font-black">3. Precio visto en Luna</label><p className="mt-1 text-sm text-white/75">Confirma el precio actual en USD; no se reutiliza el valor de otro producto.</p><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"><input id="luna-price-confirmed" inputMode="decimal" placeholder="Ej. 2.00" value={lunaPrice} onChange={(event) => { setLunaPrice(event.target.value); setLunaPriceConfirmed(false) }} className="min-h-12 rounded-2xl border border-white/25 bg-black/30 px-4 text-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200" /><button type="button" disabled={!(Number(lunaPrice) > 0)} onClick={() => { setLunaPriceConfirmed(true); setLastActionMessage(`Precio Luna confirmado: USD ${Number(lunaPrice).toFixed(2)}.`) }} className="min-h-12 rounded-2xl bg-cyan-200 px-4 font-black text-black disabled:opacity-40">{lunaPriceConfirmed ? "✓ Precio confirmado" : "Confirmar precio"}<span className="block text-[10px]">CONFIRM_LUNA_PRICE:{lunaPrice}</span></button></div></div><div className="rounded-3xl border border-white/15 bg-white/[0.045] p-4"><p className="font-black">4. Imagen</p><p className="mt-1 text-sm text-white/75 break-all">Referencia: {formatValue(selectedRadarCandidate.imageReference)}</p><button type="button" onClick={() => act({ type: "CONFIRM_IMAGE_OK" })} className="mt-3 min-h-12 w-full rounded-2xl border border-white/25 font-black">{state.imageConfirmed ? "✓ Imagen confirmada" : "Confirmar imagen"}<span className="block text-[10px]">CONFIRM_IMAGE_OK</span></button></div><div className="rounded-3xl border border-amber-200/25 bg-amber-200/[0.07] p-4"><p className="font-black">Resultado de guardas</p><p className="mt-2 text-sm text-white/80">Siguiente paso: <strong>{routeLabel(effectiveDecision.nextRecommendedRoute)}</strong></p>{radarGuards.pendingGuards.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-white/80">{radarGuards.pendingGuards.map((guard) => <li key={guard}>{guard}</li>)}</ul>}<button type="button" disabled className="mt-4 min-h-14 w-full rounded-2xl bg-emerald-200 px-4 font-black text-black opacity-40">B2-RUN no disponible<span className="block text-[10px]">APPROVE_B2_RUN_PREFLIGHT · canPublish false</span></button></div></>}{!selectedRadarCandidate && <button type="button" onClick={() => setView("top5")} className="min-h-12 w-full rounded-2xl bg-white font-black text-black">Ir al Top 5</button>}<details className="rounded-3xl border border-violet-200/20 bg-violet-200/[0.06] p-4" open={false}><summary className="cursor-pointer font-black">Decisión técnica copiable</summary><pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-black/40 p-4 text-xs text-white/80">{summary}</pre><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(summary); setCopied(true); setLastActionMessage("Resumen copiado.") } catch { setLastActionMessage("No se pudo copiar. Selecciona el JSON manualmente.") } }} className="mt-3 min-h-12 w-full rounded-2xl border border-violet-200/35 font-black">{copied ? "✓ Resumen copiado" : "Copiar resumen"}</button></details><div className="grid gap-2"><button type="button" onClick={() => act({ type: "REQUEST_LUNA_SCAN_REFRESH" })} className="min-h-12 rounded-2xl border border-amber-200/35 font-bold">Solicitar refresco de Radar<span className="block text-[10px]">REQUEST_LUNA_SCAN_REFRESH</span></button><button type="button" onClick={() => act({ type: "HOLD_FOR_REVIEW" })} className="min-h-12 rounded-2xl border border-amber-200/35 font-bold">Guardar para revisar después<span className="block text-[10px]">HOLD_FOR_REVIEW</span></button></div></section>}

        <footer className="pb-4 text-center text-xs leading-5 text-white/65">Estado local temporal · BROWSER_STATE_OR_LOCAL_STORAGE · officialApprovalRecord: false · canPublish: false.</footer>
      </section>
      {selectedRadarCandidate && view !== "decision" && <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/15 bg-[#0b1018]/95 p-3 backdrop-blur"><div className="mx-auto flex max-w-xl items-center gap-3"><p className="min-w-0 flex-1 truncate text-sm font-bold">Seleccionado: {selectedRadarCandidate.productTitle}</p><button type="button" onClick={() => setView("decision")} className="min-h-12 rounded-2xl bg-emerald-200 px-4 font-black text-black">Continuar</button></div></div>}
    </main>
  )
}
