"use client"

import { useEffect, useMemo, useState } from "react"

import { supabase } from "@/lib/supabase"

type Run = {
  id: string
  status: string
  scan_mode: string
  total_candidates: number
  processed_candidates: number
  successful_candidates: number
  failed_candidates: number
  best_selling_signals_found: number
  started_at: string
  last_batch_at: string | null
}

type Opportunity = {
  id: string
  market_radar_product_id: string | null
  product_title: string
  variant_title: string | null
  supplier_sku: string | null
  queue_status: string
  decision: string
  opportunity_score: number
  demand_score: number
  economics_score: number
  identity_score: number
  estimated_weekly_velocity: number | null
  median_total_buyer_price: number | null
  estimated_net_profit: number | null
  supplier_available: boolean | null
  supplier_inventory_quantity: number | null
  hard_gates: string[]
  evidence_guards: string[]
  ebay_candidate_count: number
  exact_comparable_count: number
  seller_priority_score: number
  seller_lane: string
  next_seller_action: string
  can_prepare_listing_package: boolean
  listing_intake_url: string | null
  winning_structure: {
    strategyConfidence: string | null
    primarySearchPhrase: string | null
    secondarySearchTerms: string[]
    titleFormula: string | null
    categoryId: string | null
    categoryName: string | null
  }
  top_ebay_candidates: Array<{
    title: string
    price: number | null
    currency: string
    identityMatchScore: number
    identityMatchQuality: string
    professionalReferenceScore: number
  }>
}

type Dashboard = {
  runs: Run[]
  queue: Opportunity[]
  summary: {
    total: number
    ready: number
    review: number
    watchlist: number
    supplierHolds: number
    activeListingRisks: number
  }
  events: Array<{ id: string; event_type: string; created_at: string }>
  activeListingRisks: Array<{ id: string; risk_priority: string; risk_type: string; risk_summary: string }>
  automation: {
    strategy: string
    productionScheduleLabel: string
    previewRunsCronAutomatically: boolean
    productionRunsCronAutomatically: boolean
    mobileAccelerationBatchCount: number
    variantsPerBatch: number
  }
}

const ACCELERATION_BATCHES = 10

function label(value: string) {
  return value.replaceAll("_", " ")
}

function money(value: number | null) {
  return value === null ? "Pendiente" : `$${Number(value).toFixed(2)}`
}

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
    : "Pendiente"
}

function cardTone(status: string) {
  if (status === "ready") return "border-emerald-200/30 bg-emerald-200/[0.08]"
  if (status === "review") return "border-cyan-200/30 bg-cyan-200/[0.08]"
  if (["hold", "rejected"].includes(status)) return "border-rose-200/30 bg-rose-200/[0.08]"
  return "border-amber-200/25 bg-amber-200/[0.06]"
}

function sellerLaneLabel(value: string) {
  const labels: Record<string, string> = {
    LISTING_PACKAGE_READY: "Listo para preparar listing",
    FAST_TRACK_NEEDS_ECONOMICS: "Validar margen",
    FAST_TRACK_NEEDS_FACTS: "Completar datos",
    HIGH_POTENTIAL_NEEDS_IDENTITY: "Alto potencial · validar identidad",
    MARKET_SIGNAL_NEEDS_IDENTITY: "Señal eBay · validar identidad",
    SUPPLY_HOLD: "Pausa por stock",
    REFINE_EBAY_SEARCH: "Refinar búsqueda eBay",
  }
  return labels[value] ?? label(value)
}

export function OpportunityCommandCenter({
  onReviewCandidate,
  onRadarRefresh,
}: {
  onReviewCandidate: (marketRadarProductId: string) => boolean
  onRadarRefresh: () => Promise<void>
}) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("Cargando cola eBay-first…")
  const [error, setError] = useState("")
  const [filter, setFilter] = useState("all")
  const currentRun = dashboard?.runs.find((run) => run.status === "running") ?? dashboard?.runs[0] ?? null

  async function request(body?: Record<string, unknown>) {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !data.session) throw new Error("La sesión Admin expiró.")
    const response = await fetch("/api/admin/ebay/luna-opportunity-queue", {
      method: body ? "POST" : "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const payload = await response.json()
    if (!response.ok || !payload.success) throw new Error(payload.error ?? "No se pudo consultar la cola.")
    return payload
  }

  async function load() {
    setError("")
    try {
      const payload = await request()
      setDashboard(payload.dashboard)
      setMessage("")
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo consultar la cola.")
    }
  }

  useEffect(() => { void load() }, [])

  async function startPriorityScan() {
    const restart = Boolean(currentRun?.status === "running" && currentRun.processed_candidates > 0)
    if (restart && !window.confirm("Esto pausará el run actual y comenzará otro desde los productos con mayor potencial. La cola ya guardada no se elimina. ¿Continuar?")) return
    setBusy(true); setError(""); setMessage(restart ? "Reiniciando por potencial…" : "Iniciando scan prioritario…")
    try {
      await request({ action: restart ? "restart_priority" : "start", categoryIds: [] })
      setMessage("Primer lote prioritario guardado. Los mejores candidatos se analizan primero.")
      await load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "SCAN_FAILED")
    } finally { setBusy(false) }
  }

  async function refreshLunaRadar() {
    setBusy(true); setError(""); setMessage("Actualizando catálogo, stock y precios desde Luna…")
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !data.session) throw new Error("La sesión Admin expiró.")
      const response = await fetch("/api/admin/market-radar", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "sync_lunaportex" }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error ?? "MARKET_RADAR_SYNC_FAILED")
      await Promise.all([onRadarRefresh(), load()])
      setMessage("Luna quedó actualizada. Radar y Opportunity Queue ya pueden usar la evidencia más reciente.")
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "MARKET_RADAR_SYNC_FAILED")
    } finally { setBusy(false) }
  }

  async function accelerate() {
    if (!currentRun || currentRun.status !== "running") return
    setBusy(true); setError("")
    let completedBatches = 0
    try {
      for (let index = 0; index < ACCELERATION_BATCHES; index += 1) {
        setMessage(`Acelerando desde el teléfono · lote ${index + 1} de ${ACCELERATION_BATCHES}…`)
        const payload = await request({ action: "process_next", runId: currentRun.id })
        completedBatches += 1
        if (payload.batch?.completed) break
      }
      setMessage(`${completedBatches} lotes procesados. El progreso quedó guardado y puedes cerrar el teléfono.`)
      await load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "SCAN_FAILED")
      await load()
    } finally { setBusy(false) }
  }

  const progressValue = currentRun?.total_candidates
    ? (currentRun.processed_candidates / currentRun.total_candidates) * 100
    : 0
  const progress = Math.round(progressValue)
  const progressLabel = progressValue > 0 && progressValue < 1 ? "<1%" : `${progress}%`
  const rows = dashboard?.queue.filter((row) => filter === "all" || row.queue_status === filter).slice(0, 25) ?? []
  const topPotential = useMemo(() => [...(dashboard?.queue ?? [])]
    .filter((row) => row.supplier_available !== false && row.ebay_candidate_count > 0)
    .sort((left, right) => right.seller_priority_score - left.seller_priority_score)
    .slice(0, 5), [dashboard])

  return <section aria-labelledby="opportunity-command-center-heading" className="space-y-4">
    <header className="rounded-3xl border border-violet-200/25 bg-gradient-to-br from-violet-200/[0.12] via-cyan-200/[0.05] to-black p-4">
      <p className="text-xs font-black uppercase tracking-widest text-violet-100/70">Descubrir → validar → preparar</p>
      <h2 id="opportunity-command-center-heading" className="mt-2 text-2xl font-black">Centro de oportunidades eBay-first</h2>
      <p className="mt-2 text-sm leading-6 text-white/70">Analiza primero los productos con mejor señal de Radar, guarda evidencia eBay y te lleva al siguiente bloqueo sin usar la laptop.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <button disabled={busy} onClick={() => void refreshLunaRadar()} className="min-h-14 rounded-2xl border border-white/20 bg-black/25 px-3 font-black text-white disabled:opacity-50">1. Actualizar Luna</button>
        <button disabled={busy} onClick={() => void startPriorityScan()} className="min-h-14 rounded-2xl bg-violet-200 px-3 font-black text-black disabled:opacity-50">{currentRun?.status === "running" && currentRun.processed_candidates > 0 ? "Reiniciar por potencial" : "Iniciar scan prioritario"}</button>
        <button disabled={busy || !currentRun || currentRun.status !== "running"} onClick={() => void accelerate()} className="min-h-14 rounded-2xl bg-cyan-200 px-3 font-black text-black disabled:opacity-40">{busy ? "Analizando…" : "Acelerar 20 productos"}</button>
      </div>
      {currentRun && <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-3"><div className="flex justify-between text-xs font-bold"><span>{currentRun.status.toUpperCase()} · {currentRun.processed_candidates}/{currentRun.total_candidates}</span><span>{progressLabel}</span></div><div className="mt-2 h-3 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gradient-to-r from-violet-300 to-cyan-200" style={{ width: `${Math.max(progressValue > 0 ? 1 : 0, progressValue)}%` }} /></div><p className="mt-2 text-xs text-white/55">Exitosos {currentRun.successful_candidates} · Fallidos {currentRun.failed_candidates} · última ejecución {formatDate(currentRun.last_batch_at)}</p></div>}
      {dashboard?.automation && <div className="mt-3 rounded-2xl border border-emerald-200/20 bg-emerald-200/[0.05] p-3 text-xs leading-5 text-emerald-50"><strong>Automatización:</strong> prioridad primero · {dashboard.automation.productionScheduleLabel}. El cron corre en Production; en este Preview usa “Acelerar 20 productos”.</div>}
      {message && <p aria-live="polite" className="mt-3 rounded-2xl border border-white/10 p-3 text-sm text-white/70">{message}</p>}
      {error && <p role="alert" className="mt-3 rounded-2xl border border-rose-200/25 bg-rose-200/[0.08] p-3 text-sm text-rose-50">{error}</p>}
    </header>

    {dashboard && <>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-2xl border border-white/10 p-3"><span className="text-white/50">Total</span><strong className="mt-1 block text-xl">{dashboard.summary.total}</strong></div>
        <div className="rounded-2xl border border-emerald-200/20 p-3"><span className="text-white/50">Listas</span><strong className="mt-1 block text-xl">{dashboard.summary.ready}</strong></div>
        <div className="rounded-2xl border border-cyan-200/20 p-3"><span className="text-white/50">Revisar</span><strong className="mt-1 block text-xl">{dashboard.summary.review}</strong></div>
        <div className="rounded-2xl border border-amber-200/20 p-3"><span className="text-white/50">Baseline</span><strong className="mt-1 block text-xl">{dashboard.summary.watchlist}</strong></div>
        <div className="rounded-2xl border border-rose-200/20 p-3"><span className="text-white/50">Hold</span><strong className="mt-1 block text-xl">{dashboard.summary.supplierHolds}</strong></div>
        <div className="rounded-2xl border border-rose-200/20 p-3"><span className="text-white/50">Riesgos</span><strong className="mt-1 block text-xl">{dashboard.summary.activeListingRisks}</strong></div>
      </div>

      <section className="rounded-3xl border border-emerald-200/20 bg-emerald-200/[0.045] p-4">
        <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-widest text-emerald-100/65">Fast lane</p><h3 className="mt-1 text-xl font-black">Top para trabajar ahora</h3></div><span className="rounded-xl bg-emerald-100 px-3 py-2 text-sm font-black text-black">Top {topPotential.length}</span></div>
        <div className="mt-4 space-y-3">{topPotential.map((row, index) => <article key={row.id} className="rounded-2xl border border-white/10 bg-black/25 p-3">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black text-emerald-100">#{index + 1} · {sellerLaneLabel(row.seller_lane)}</p><h4 className="mt-1 font-black leading-5">{row.product_title}</h4></div><strong className="rounded-xl bg-white px-2 py-1 text-black">{row.seller_priority_score}</strong></div>
          <p className="mt-2 text-xs text-white/60">{row.ebay_candidate_count} candidatos eBay · {row.exact_comparable_count} comparables exactos</p>
          <p className="mt-2 text-xs leading-5 text-white/75">{row.next_seller_action}</p>
          <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={!row.market_radar_product_id} onClick={() => { if (row.market_radar_product_id && !onReviewCandidate(row.market_radar_product_id)) setMessage("Radar no tiene este producto cargado para revisión móvil todavía.") }} className="min-h-11 rounded-xl bg-cyan-200 px-3 text-xs font-black text-black disabled:opacity-40">Validar ahora</button>{row.listing_intake_url ? <a href={row.listing_intake_url} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-200 px-3 text-center text-xs font-black text-black">Preparar listing</a> : <span className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/15 px-3 text-center text-[11px] text-white/55">Listing aún bloqueado</span>}</div>
        </article>)}{!topPotential.length && <p className="text-sm text-white/55">Acelera el scan para construir el primer Top con evidencia eBay.</p>}</div>
      </section>

      <nav className="flex gap-2 overflow-x-auto pb-1">{["all", "ready", "review", "watchlist", "hold"].map((value) => <button key={value} onClick={() => setFilter(value)} className={`min-h-11 shrink-0 rounded-full px-4 text-xs font-black uppercase ${filter === value ? "bg-white text-black" : "border border-white/15"}`}>{value === "all" ? "Todas" : label(value)}</button>)}</nav>

      <div className="space-y-3">{rows.map((row, index) => <article key={row.id} className={`rounded-3xl border p-4 ${cardTone(row.queue_status)}`}>
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase">#{index + 1} · {label(row.queue_status)}</p><h3 className="mt-2 text-lg font-black">{row.product_title}</h3><p className="mt-1 text-xs text-white/55">{row.variant_title ?? "Variante general"} · {row.supplier_sku ?? "SKU pendiente"}</p></div><span className="rounded-2xl bg-white px-3 py-2 text-xl font-black text-black">{Math.round(Number(row.opportunity_score))}</span></div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs"><div><dt className="text-white/50">Demanda</dt><dd className="font-black">{Math.round(Number(row.demand_score))}</dd></div><div><dt className="text-white/50">Economía</dt><dd className="font-black">{Math.round(Number(row.economics_score))}</dd></div><div><dt className="text-white/50">Identidad</dt><dd className="font-black">{Math.round(Number(row.identity_score))}</dd></div><div><dt className="text-white/50">Candidatos</dt><dd className="font-black">{row.ebay_candidate_count}</dd></div><div><dt className="text-white/50">Exactos</dt><dd className="font-black">{row.exact_comparable_count}</dd></div><div><dt className="text-white/50">Prioridad</dt><dd className="font-black">{row.seller_priority_score}</dd></div></dl>
        <details className="mt-3 rounded-2xl border border-white/15 p-3"><summary className="cursor-pointer text-sm font-black">Evidencia y estructura</summary><dl className="mt-3 grid gap-2 text-xs"><div><dt className="text-white/50">Siguiente acción</dt><dd className="mt-1 font-bold">{row.next_seller_action}</dd></div><div><dt className="text-white/50">Frase principal</dt><dd className="mt-1 font-bold">{row.winning_structure.primarySearchPhrase ?? "Pendiente de evidencia multi-vendedor"}</dd></div><div><dt className="text-white/50">Categoría</dt><dd className="mt-1 font-bold">{row.winning_structure.categoryName ?? row.winning_structure.categoryId ?? "Pendiente"}</dd></div></dl><div className="mt-3 space-y-2">{row.top_ebay_candidates.map((candidate, candidateIndex) => <div key={`${candidate.title}-${candidateIndex}`} className="rounded-xl bg-black/25 p-2 text-xs"><strong>Referencia {candidateIndex + 1}: {candidate.title}</strong><p className="mt-1 text-white/55">{candidate.price === null ? "Precio pendiente" : `${candidate.currency} ${candidate.price.toFixed(2)}`} · match {candidate.identityMatchScore}</p></div>)}</div></details>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2"><details className="rounded-2xl border border-white/15 p-3"><summary className="cursor-pointer text-sm font-black">Guardas</summary><ul className="mt-2 list-disc space-y-1 pl-4 text-xs">{[...row.hard_gates, ...row.evidence_guards].map((guard) => <li key={guard}>{label(guard)}</li>)}</ul></details>{row.market_radar_product_id && <button onClick={() => { if (!onReviewCandidate(row.market_radar_product_id!)) setMessage("Radar no tiene este producto cargado para revisión móvil todavía.") }} className="min-h-12 rounded-2xl bg-emerald-200 px-3 text-xs font-black text-black">Revisar</button>}</div>
      </article>)}{!rows.length && <p className="rounded-2xl border border-white/10 p-5 text-sm text-white/55">Inicia el scan prioritario para construir la cola.</p>}</div>

      <details className="rounded-3xl border border-white/10 p-4"><summary className="cursor-pointer font-black">Monitoreo y riesgos</summary><p className="mt-3 text-sm text-white/65">{dashboard.events.length} cambios Luna recientes · {dashboard.activeListingRisks.length} riesgos abiertos de listings.</p>{dashboard.activeListingRisks.slice(0, 8).map((risk) => <div key={risk.id} className="mt-2 rounded-2xl border border-rose-200/15 p-3 text-xs"><strong>{risk.risk_priority.toUpperCase()} · {label(risk.risk_type)}</strong><p className="mt-1 text-white/65">{risk.risk_summary}</p></div>)}</details>
    </>}
  </section>
}
