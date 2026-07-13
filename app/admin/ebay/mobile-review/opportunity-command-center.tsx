"use client"

import { useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"

type Run = {
  id: string
  status: string
  total_candidates: number
  processed_candidates: number
  successful_candidates: number
  failed_candidates: number
  best_selling_signals_found: number
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
}

function label(value: string) {
  return value.replaceAll("_", " ")
}

function money(value: number | null) {
  return value === null ? "Pendiente" : `$${Number(value).toFixed(2)}`
}

function cardTone(status: string) {
  if (status === "ready") return "border-emerald-200/30 bg-emerald-200/[0.08]"
  if (status === "review") return "border-cyan-200/30 bg-cyan-200/[0.08]"
  if (["hold", "rejected"].includes(status)) return "border-rose-200/30 bg-rose-200/[0.08]"
  return "border-amber-200/25 bg-amber-200/[0.06]"
}

export function OpportunityCommandCenter({
  onReviewCandidate,
}: {
  onReviewCandidate: (marketRadarProductId: string) => boolean
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
    try {
      const payload = await request()
      setDashboard(payload.dashboard)
      setMessage("")
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo consultar la cola.")
    }
  }

  useEffect(() => { void load() }, [])

  async function start() {
    setBusy(true); setError(""); setMessage("Iniciando scan y analizando el primer lote…")
    try {
      await request({ action: "start", categoryIds: [] })
      setMessage("Primer lote guardado. Continúa cuando estés listo.")
      await load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "SCAN_FAILED")
    } finally { setBusy(false) }
  }

  async function continueFive() {
    if (!currentRun || currentRun.status !== "running") return
    setBusy(true); setError("")
    try {
      for (let index = 0; index < 5; index += 1) {
        setMessage(`Analizando lote ${index + 1} de 5…`)
        const payload = await request({ action: "process_next", runId: currentRun.id })
        if (payload.batch?.completed) break
      }
      setMessage("Cinco lotes procesados; el cursor quedó guardado.")
      await load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "SCAN_FAILED")
      await load()
    } finally { setBusy(false) }
  }

  const progress = currentRun?.total_candidates
    ? Math.round((currentRun.processed_candidates / currentRun.total_candidates) * 100)
    : 0
  const rows = dashboard?.queue.filter((row) => filter === "all" || row.queue_status === filter).slice(0, 25) ?? []

  return <section aria-labelledby="opportunity-command-center-heading" className="space-y-4">
    <header className="rounded-3xl border border-violet-200/25 bg-violet-200/[0.08] p-4">
      <p className="text-xs font-black uppercase tracking-widest text-violet-100/70">Centro de comando móvil</p>
      <h2 id="opportunity-command-center-heading" className="mt-2 text-2xl font-black">eBay-first × Luna</h2>
      <p className="mt-2 text-sm leading-6 text-white/70">Escanea todo Luna, ordena demanda eBay y vigila precio, stock y riesgos sin salir de Top 5 móvil.</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button disabled={busy} onClick={() => void start()} className="min-h-14 rounded-2xl bg-violet-200 px-3 font-black text-black disabled:opacity-50">Nuevo scan</button>
        <button disabled={busy || !currentRun || currentRun.status !== "running"} onClick={() => void continueFive()} className="min-h-14 rounded-2xl bg-cyan-200 px-3 font-black text-black disabled:opacity-40">Procesar 5 lotes</button>
      </div>
      {currentRun && <div className="mt-4"><div className="flex justify-between text-xs font-bold"><span>{currentRun.processed_candidates}/{currentRun.total_candidates} variantes</span><span>{progress}%</span></div><div className="mt-2 h-3 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gradient-to-r from-violet-300 to-cyan-200" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-xs text-white/55">Exitosos {currentRun.successful_candidates} · Fallidos {currentRun.failed_candidates} · BEST_SELLING {currentRun.best_selling_signals_found}</p></div>}
      {message && <p className="mt-3 rounded-2xl border border-white/10 p-3 text-sm text-white/70">{message}</p>}
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

      <nav className="flex gap-2 overflow-x-auto pb-1">{["all", "ready", "review", "watchlist", "hold"].map((value) => <button key={value} onClick={() => setFilter(value)} className={`min-h-11 shrink-0 rounded-full px-4 text-xs font-black uppercase ${filter === value ? "bg-white text-black" : "border border-white/15"}`}>{value === "all" ? "Todas" : label(value)}</button>)}</nav>

      <div className="space-y-3">{rows.map((row, index) => <article key={row.id} className={`rounded-3xl border p-4 ${cardTone(row.queue_status)}`}>
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase">#{index + 1} · {label(row.queue_status)}</p><h3 className="mt-2 text-lg font-black">{row.product_title}</h3><p className="mt-1 text-xs text-white/55">{row.variant_title ?? "Variante general"} · {row.supplier_sku ?? "SKU pendiente"}</p></div><span className="rounded-2xl bg-white px-3 py-2 text-xl font-black text-black">{Math.round(Number(row.opportunity_score))}</span></div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs"><div><dt className="text-white/50">Demanda</dt><dd className="font-black">{Math.round(Number(row.demand_score))}</dd></div><div><dt className="text-white/50">Economía</dt><dd className="font-black">{Math.round(Number(row.economics_score))}</dd></div><div><dt className="text-white/50">Identidad</dt><dd className="font-black">{Math.round(Number(row.identity_score))}</dd></div><div><dt className="text-white/50">Velocidad</dt><dd className="font-black">{row.estimated_weekly_velocity ?? "Baseline"}</dd></div><div><dt className="text-white/50">Precio eBay</dt><dd className="font-black">{money(row.median_total_buyer_price)}</dd></div><div><dt className="text-white/50">Beneficio</dt><dd className="font-black">{money(row.estimated_net_profit)}</dd></div></dl>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2"><details className="rounded-2xl border border-white/15 p-3"><summary className="cursor-pointer text-sm font-black">Guardas</summary><ul className="mt-2 list-disc space-y-1 pl-4 text-xs">{[...row.hard_gates, ...row.evidence_guards].map((guard) => <li key={guard}>{label(guard)}</li>)}</ul></details>{row.market_radar_product_id && <button onClick={() => { if (!onReviewCandidate(row.market_radar_product_id!)) setMessage("Este candidato está en la cola global pero todavía no está cargado en el Top 50 de Radar.") }} className="min-h-12 rounded-2xl bg-emerald-200 px-3 text-xs font-black text-black">Revisar</button>}</div>
      </article>)}{!rows.length && <p className="rounded-2xl border border-white/10 p-5 text-sm text-white/55">Inicia el scan para construir la primera cola.</p>}</div>

      <details className="rounded-3xl border border-white/10 p-4"><summary className="cursor-pointer font-black">Monitoreo y riesgos</summary><p className="mt-3 text-sm text-white/65">{dashboard.events.length} cambios Luna recientes · {dashboard.activeListingRisks.length} riesgos abiertos de listings.</p>{dashboard.activeListingRisks.slice(0, 8).map((risk) => <div key={risk.id} className="mt-2 rounded-2xl border border-rose-200/15 p-3 text-xs"><strong>{risk.risk_priority.toUpperCase()} · {label(risk.risk_type)}</strong><p className="mt-1 text-white/65">{risk.risk_summary}</p></div>)}</details>
    </>}
  </section>
}
