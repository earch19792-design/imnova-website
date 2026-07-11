"use client"

import { useEffect, useMemo, useRef, useState } from "react"

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

const emptyReport = buildMobileReviewRealRadarConnector({ products: [] })

function toMobileFixture(candidates: RealRadarCandidate[]): MobileReviewFixture {
  const previousCandidate = candidates[0] ?? {
    candidateRank: 0, candidateId: "none", productName: "Sin candidato",
    opportunityScore: 0, suggestedPrice: { value: 0, currency: "USD" },
    suggestedCategory: "CATEGORY_PENDING", riskFlags: [], missingFields: [],
    listingBlueprintSummary: "Sin datos", availabilityStatus: "REMOVED_FROM_LUNA_SCAN" as const,
  }
  return {
    version: "EBAY_MOBILE_REVIEW_REAL_RADAR_CONNECTOR_V1",
    status: "BROWSER_STATE_ONLY",
    top5Candidates: candidates,
    previousCandidate: {
      ...previousCandidate,
      availabilityStatus: "REMOVED_FROM_LUNA_SCAN",
      previousStatus: "REMOVED_FROM_LUNA_SCAN",
    },
  }
}

function StatusPill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-cyan-200/15 bg-cyan-200/[0.07] px-3 py-1 text-[11px] font-black uppercase tracking-wider text-cyan-100/75">{children}</span>
}

const formatValue = (value: unknown) => value === null || value === undefined || value === "" ? "pendiente" : String(value)

export default function EbayMobileReviewPage() {
  const [report, setReport] = useState(emptyReport)
  const [state, setState] = useState(() => buildInitialMobileReviewState(toMobileFixture([])))
  const [stockQuantity, setStockQuantity] = useState("20")
  const [loading, setLoading] = useState(true)
  const [loadMessage, setLoadMessage] = useState("Cargando Market Radar read-only…")
  const [lastActionMessage, setLastActionMessage] = useState("Todavía no realizaste ninguna acción.")
  const confirmationRef = useRef<HTMLElement>(null)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const demoRequested = new URLSearchParams(window.location.search).get("demo") === "1"
        const products = demoRequested
          ? demoRadarJson.products as unknown as RadarProductInput[]
          : await (async () => {
              const { data, error } = await supabase.auth.getSession()
              if (error || !data.session) throw new Error("No hay sesión admin activa.")
              return loadMarketRadarReadonlyDashboard(`Bearer ${data.session.access_token}`)
            })()
        const nextReport = buildMobileReviewRealRadarConnector({
          products,
          mode: demoRequested ? "DEMO_FIXTURE_ONLY" : "REAL_READONLY",
        })
        if (!active) return
        setReport(nextReport)
        setState(buildInitialMobileReviewState(toMobileFixture(nextReport.top5Candidates)))
        setLoadMessage(nextReport.top5Candidates.length
          ? `${nextReport.top5Candidates.length} candidatos cargados.`
          : "No hay Top 5 real disponible. Ejecuta o revisa Market Radar antes de tomar decisiones.")
      } catch {
        if (!active) return
        setReport(emptyReport)
        setState(buildInitialMobileReviewState(toMobileFixture([])))
        setLoadMessage("No hay Top 5 real disponible. Ejecuta o revisa Market Radar antes de tomar decisiones.")
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [])

  const decision = useMemo(() => buildMobileReviewDecision(state), [state])
  const summary = useMemo(() => JSON.stringify({
    ...JSON.parse(buildMobileReviewCopyPasteSummary(state)),
    dataSource: report.dataSource,
    decisionPersistence: "BROWSER_STATE_ONLY",
    officialApprovalRecord: false,
    canPublish: false,
  }, null, 2), [state, report.dataSource])

  const act = (action: Parameters<typeof applyMobileReviewAction>[1]) => {
    setState((current) => applyMobileReviewAction(current, action))
    const messages: Record<string, string> = {
      MARK_UNAVAILABLE: "Producto removido solo en este navegador. B2-RUN quedó bloqueado.",
      SELECT_CANDIDATE: "Candidato seleccionado. Continúa con mismo producto, stock e imagen.",
      CONFIRM_SAME_PRODUCT: "Mismo producto confirmado localmente.",
      CONFIRM_STOCK_QTY: `Stock local confirmado: ${stockQuantity} unidades.`,
      CONFIRM_IMAGE_OK: "Revisión visual confirmada localmente.",
      REQUEST_LUNA_SCAN_REFRESH: "Solicitud de refresco preparada localmente.",
      HOLD_FOR_REVIEW: "Decisión puesta en espera para revisión.",
      APPROVE_B2_RUN_PREFLIGHT: "Preflight evaluado; no crea aprobación oficial.",
    }
    setLastActionMessage(messages[action.type] ?? "Acción local registrada.")
    if (action.type === "SELECT_CANDIDATE") window.setTimeout(() => confirmationRef.current?.scrollIntoView({ behavior: "smooth" }), 50)
  }

  return (
    <main className="min-h-screen bg-[#05070d] px-4 py-6 text-white sm:px-6">
      <section className="mx-auto flex max-w-xl flex-col gap-5">
        <a href="/admin/ebay-seller-os" className="w-fit rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/65">← eBay Seller OS</a>
        <header className="rounded-3xl border border-cyan-300/15 bg-cyan-300/[0.06] p-5">
          <p className="text-xs font-black uppercase tracking-[0.25em] text-cyan-100/55">Revisión privada · read-only</p>
          <h1 className="mt-3 text-3xl font-black leading-tight">Top 5 móvil</h1>
          <p className="mt-3 text-sm leading-6 text-white/60">Market Radar aporta productos, snapshots, score y stock. Las decisiones viven solo en este navegador.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusPill>{report.fixtureUsed ? "FIXTURE/DEMO" : "REAL RADAR"}</StatusPill>
            <StatusPill>{report.dataSource}</StatusPill>
            <StatusPill>canPublish: false</StatusPill>
            <StatusPill>no eBay write</StatusPill>
          </div>
        </header>

        <aside className={`rounded-3xl border p-5 ${report.fixtureUsed ? "border-amber-300/20 bg-amber-300/[0.06]" : "border-emerald-300/20 bg-emerald-300/[0.06]"}`}>
          <p className="text-xs font-black uppercase tracking-widest">Fuente: {report.dataSource}</p>
          <p className="mt-3 text-sm leading-6 text-white/65">{loadMessage}</p>
          {!report.fixtureUsed && <p className="mt-2 text-xs font-black text-emerald-100">Fuente real esperada: MARKET_RADAR_READONLY</p>}
          {report.fixtureUsed && <p className="mt-2 text-sm font-black text-amber-100">DEMO_FIXTURE_ONLY · no usar para aprobación real. Fuente actual: fixture modelado · no es data viva. score modelado · Fixture · no precio runtime · Fixture · no Category ID.</p>}
          <p className="mt-2 text-xs text-white/45">decisionPersistence: BROWSER_STATE_ONLY · officialApprovalRecord: false · Supabase write: false</p>
        </aside>

        <div aria-live="polite" className="sticky top-2 z-20 rounded-2xl border border-emerald-300/25 bg-[#102019]/95 p-4 text-sm font-bold leading-5 text-emerald-50 shadow-xl backdrop-blur">
          {loading ? "Cargando…" : `Última acción: ${lastActionMessage}`}
        </div>

        <div className="space-y-4">
          {report.top5Candidates.map((candidate) => {
            const selected = state.selectedCandidateRank === candidate.candidateRank
            const unavailable = candidate.routeRecommendation === "STOCK_HOLD"
            return (
              <article key={candidate.candidateId} className={`rounded-3xl border p-5 ${selected ? "border-emerald-300/40 bg-emerald-300/[0.08]" : "border-white/10 bg-white/[0.035]"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-white/40">Rank #{candidate.candidateRank}{candidate.candidateRank === 1 ? " · Recomendado" : ""}</p>
                    <h2 className="mt-2 text-xl font-black leading-6">{candidate.productTitle}</h2>
                    <p className="mt-1 text-xs text-cyan-100/60">{formatValue(candidate.variantTitle)} · SKU {formatValue(candidate.supplierSku)}</p>
                  </div>
                  <span className="rounded-2xl bg-white/10 px-3 py-2 text-lg font-black">{candidate.opportunityScore.toFixed(2)}<span className="block text-[9px] text-white/35">Supplier Opportunity Score</span></span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-2xl bg-black/25 p-3"><dt className="text-white/40">Radar IDs</dt><dd className="mt-1 break-all">{candidate.marketRadarProductId}<br />{formatValue(candidate.marketRadarSnapshotId)}</dd></div>
                  <div className="rounded-2xl bg-black/25 p-3"><dt className="text-white/40">Proveedor</dt><dd className="mt-1 break-all">{candidate.supplierProductId}<br />{formatValue(candidate.supplierVariantId)}</dd></div>
                  <div className="rounded-2xl bg-black/25 p-3"><dt className="text-white/40">Último scan</dt><dd className="mt-1">seen {formatValue(candidate.lastSeenAt)}<br />snapshot {formatValue(candidate.lastSnapshotAt)}</dd></div>
                  <div className="rounded-2xl bg-black/25 p-3"><dt className="text-white/40">Stock</dt><dd className="mt-1">{candidate.inventoryStatus} · qty {formatValue(candidate.stockQuantity)}<br />stock source: {candidate.stockSource}<br />confidence: {candidate.stockConfidence}<br />stock age: {formatValue(candidate.stockConfirmationAgeHours)}h</dd></div>
                  <div className="rounded-2xl bg-black/25 p-3"><dt className="text-white/40">Precios</dt><dd className="mt-1">Luna ${formatValue(candidate.lunaPrice)} / compare ${formatValue(candidate.lunaCompareAtPrice)}<br />discount: {formatValue(candidate.discountPercent)}%<br />eBay ${formatValue(candidate.ebayEstimatedPrice)} · {formatValue(candidate.ebayPriceSource)}</dd></div>
                  <div className="rounded-2xl bg-black/25 p-3"><dt className="text-white/40">Readiness</dt><dd className="mt-1">{candidate.professionalReadinessStatus}<br />Category ID: {formatValue(candidate.categoryId)}<br />Pipeline: {candidate.pipelineStatus}</dd></div>
                </dl>
                <p className="mt-3 break-all text-xs leading-5 text-white/45">Handle: {candidate.handle}<br />URL: {formatValue(candidate.productUrl)}<br />Image reference: {formatValue(candidate.imageReference)}</p>
                <p className="mt-3 text-xs leading-5 text-white/45">Ruta: {candidate.routeRecommendation}<br />Colecciones: {candidate.collections.join(", ") || "ninguna"}<br />Riesgos: {candidate.riskFlags.join(", ") || "ninguno"}<br />Faltantes: {candidate.missingFields.join(", ") || "ninguno"}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <button type="button" disabled={unavailable} onClick={() => act({ type: "SELECT_CANDIDATE", rank: candidate.candidateRank })} className="min-h-12 rounded-2xl bg-emerald-300 px-4 py-3 text-sm font-black text-black disabled:opacity-30">Seleccionar candidato<span className="block text-[10px]">SELECT_CANDIDATE</span></button>
                  <button type="button" onClick={() => act({ type: "MARK_UNAVAILABLE", rank: candidate.candidateRank })} className="min-h-12 rounded-2xl border border-rose-300/30 px-4 py-3 text-sm font-black text-rose-100">Marcar no disponible<span className="block text-[10px]">MARK_UNAVAILABLE</span></button>
                </div>
              </article>
            )
          })}
        </div>

        <section ref={confirmationRef} className="scroll-mt-20 rounded-3xl border border-white/10 bg-white/[0.035] p-5">
          <h2 className="text-xl font-black">Confirmaciones del seleccionado</h2>
          <p className="mt-2 text-sm text-white/50">{decision.selectedCandidateName ?? "Selecciona primero un candidato del Top 5."}</p>
          <div className="mt-4 space-y-3">
            <button type="button" disabled={!state.selectedCandidateRank} onClick={() => act({ type: "CONFIRM_SAME_PRODUCT" })} className="min-h-12 w-full rounded-2xl border border-white/15 px-4 py-3 text-sm font-black disabled:opacity-30">CONFIRM_SAME_PRODUCT {state.sameProductConfirmed ? "✓" : ""}</button>
            <div className="flex gap-2"><input aria-label="Cantidad de stock confirmada" inputMode="numeric" value={stockQuantity} onChange={(event) => setStockQuantity(event.target.value)} className="min-w-0 flex-1 rounded-2xl border border-white/15 bg-black/30 px-4 text-lg font-black" /><button type="button" disabled={!state.selectedCandidateRank} onClick={() => act({ type: "CONFIRM_STOCK_QTY", quantity: Number(stockQuantity) })} className="min-h-12 rounded-2xl bg-cyan-200 px-4 py-3 text-xs font-black text-black disabled:opacity-30">CONFIRM_STOCK_QTY</button></div>
            <button type="button" disabled={!state.selectedCandidateRank} onClick={() => act({ type: "CONFIRM_IMAGE_OK" })} className="min-h-12 w-full rounded-2xl border border-white/15 px-4 py-3 text-sm font-black disabled:opacity-30">CONFIRM_IMAGE_OK {state.imageConfirmed ? "✓" : ""}</button>
            <button type="button" disabled={!state.selectedCandidateRank || report.fixtureUsed} onClick={() => act({ type: "APPROVE_B2_RUN_PREFLIGHT" })} className="min-h-14 w-full rounded-2xl bg-emerald-300 px-4 py-4 text-sm font-black text-black disabled:opacity-30">APPROVE_B2_RUN_PREFLIGHT</button>
            <button type="button" onClick={() => act({ type: "REQUEST_LUNA_SCAN_REFRESH" })} className="min-h-12 w-full rounded-2xl border border-amber-200/25 px-4 py-3 text-sm font-black text-amber-100">REQUEST_LUNA_SCAN_REFRESH</button>
            <button type="button" onClick={() => act({ type: "HOLD_FOR_REVIEW" })} className="min-h-12 w-full rounded-2xl border border-amber-200/25 px-4 py-3 text-sm font-black text-amber-100">HOLD_FOR_REVIEW</button>
          </div>
        </section>

        <section className="rounded-3xl border border-violet-300/15 bg-violet-300/[0.05] p-5"><p className="text-xs font-black uppercase tracking-widest text-violet-100/55">Decisión operativa copiable</p><pre className="mt-4 overflow-x-auto whitespace-pre-wrap break-words rounded-2xl bg-black/40 p-4 text-xs leading-5 text-white/70">{summary}</pre><button type="button" onClick={() => navigator.clipboard?.writeText(summary)} className="mt-3 min-h-12 w-full rounded-2xl border border-violet-200/25 px-4 py-3 text-sm font-black">Copiar resumen</button></section>
        <footer className="pb-8 text-center text-xs leading-5 text-white/35">Estado local y temporal. Sin WhatsApp real, Supabase write, eBay API, write ni publicación. canPublish siempre es false.</footer>
      </section>
    </main>
  )
}
