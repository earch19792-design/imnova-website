"use client"

import { useEffect, useMemo, useState } from "react"

import { supabase } from "@/lib/supabase"

type ScanRun = {
  id: string
  status: string
  total_candidates: number
  processed_candidates: number
  successful_candidates: number
  failed_candidates: number
  best_selling_signals_found: number
  last_error: string | null
  started_at: string
}

type QueueRow = {
  id: string
  candidate_key: string
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
  competition_score: number
  supply_score: number
  listing_readiness_score: number
  active_comparables: number
  sellers_with_movement: number
  estimated_weekly_velocity: number | null
  median_total_buyer_price: number | null
  estimated_net_profit: number | null
  supplier_price: number | null
  supplier_available: boolean | null
  supplier_inventory_quantity: number | null
  best_selling_match_score: number | null
  hard_gates: string[]
  evidence_guards: string[]
  last_scanned_at: string
  ebay_candidate_count: number
  exact_comparable_count: number
  seller_priority_score: number
  seller_lane: string
  next_seller_action: string
  can_prepare_listing_package: boolean
  can_open_listing_workspace: boolean
  listing_workspace_blockers: string[]
  listing_workspace_resolvable_gates: string[]
  listing_intake_url: string | null
  winning_structure: {
    strategyConfidence: string | null
    primarySearchPhrase: string | null
    secondarySearchTerms: string[]
    confirmedAttributes: string[]
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
  runs: ScanRun[]
  queue: QueueRow[]
  events: Array<{
    id: string
    event_type: string
    created_at: string
    ebay_luna_opportunity_queue?: { product_title?: string; supplier_sku?: string | null }
  }>
  activeListingRisks: Array<{
    id: string
    risk_type: string
    risk_priority: string
    risk_summary: string
    recommended_action: string
  }>
  summary: {
    total: number
    ready: number
    review: number
    watchlist: number
    supplierHolds: number
    activeListingRisks: number
  }
}

const numberFormatter = new Intl.NumberFormat("es-US", { maximumFractionDigits: 2 })

function money(value: number | null) {
  return value === null ? "Pendiente" : `$${numberFormatter.format(value)}`
}

function label(value: string) {
  return value.replaceAll("_", " ")
}

function tone(status: string) {
  if (status === "ready") return "border-emerald-200/30 bg-emerald-200/[0.08] text-emerald-50"
  if (status === "review") return "border-cyan-200/30 bg-cyan-200/[0.08] text-cyan-50"
  if (status === "hold" || status === "rejected") return "border-rose-200/30 bg-rose-200/[0.08] text-rose-50"
  return "border-amber-200/25 bg-amber-200/[0.06] text-amber-50"
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

function humanError(code: string) {
  const messages: Record<string, string> = {
    AUTH_REQUIRED: "La sesión Admin expiró. Inicia sesión nuevamente.",
    EBAY_READONLY_ENV_MISSING: "Faltan las credenciales eBay de Production.",
    EBAY_LUNA_QUEUE_DASHBOARD_READ_FAILED: "La migración de la cola todavía no está aplicada en Supabase.",
    LUNA_CATALOG_COUNT_FAILED: "No fue posible contar las variantes actuales de Luna.",
    EBAY_LUNA_SCAN_FAILED: "El lote no pudo completarse. Puedes reintentarlo sin perder el progreso.",
  }
  return messages[code] ?? `${code || "ERROR_DESCONOCIDO"} · No se pudo completar la operación.`
}

export default function EbayLunaOpportunityQueuePage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [categoryIds, setCategoryIds] = useState("")
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [filter, setFilter] = useState("all")

  const currentRun = dashboard?.runs.find((run) => run.status === "running") ?? dashboard?.runs[0] ?? null
  const filteredQueue = useMemo(() => dashboard?.queue.filter((row) =>
    filter === "all" || row.queue_status === filter,
  ) ?? [], [dashboard, filter])
  const topPotential = useMemo(() => [...(dashboard?.queue ?? [])]
    .filter((row) => row.supplier_available !== false && row.ebay_candidate_count > 0)
    .sort((left, right) =>
      right.seller_priority_score - left.seller_priority_score ||
      right.opportunity_score - left.opportunity_score,
    )
    .slice(0, 5), [dashboard])

  async function adminRequest(path: string, init?: RequestInit) {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !data.session) throw new Error("AUTH_REQUIRED")
    return fetch(path, {
      ...init,
      cache: "no-store",
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${data.session.access_token}`,
      },
    })
  }

  async function load() {
    setError("")
    try {
      const response = await adminRequest(
        "/api/admin/ebay/luna-opportunity-queue?fullQueue=1")
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error)
      setDashboard(payload.dashboard)
    } catch (requestError) {
      setError(humanError(requestError instanceof Error ? requestError.message : ""))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function post(body: Record<string, unknown>) {
    const response = await adminRequest("/api/admin/ebay/luna-opportunity-queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const payload = await response.json()
    if (!response.ok || !payload.success) throw new Error(payload.error)
    return payload
  }

  async function startScan() {
    setScanning(true); setError(""); setMessage("Creando scan y procesando el primer lote…")
    try {
      await post({
        action: "start",
        categoryIds: categoryIds.split(/[\s,]+/).filter(Boolean),
      })
      setMessage("Scan creado. El primer lote quedó guardado.")
      await load()
    } catch (requestError) {
      setError(humanError(requestError instanceof Error ? requestError.message : ""))
    } finally { setScanning(false) }
  }

  async function continueScan(batchCount = 1) {
    if (!currentRun || currentRun.status !== "running") return
    setScanning(true); setError("")
    try {
      for (let index = 0; index < batchCount; index += 1) {
        setMessage(`Procesando lote ${index + 1} de ${batchCount}…`)
        const payload = await post({ action: "process_next", runId: currentRun.id })
        if (payload.batch?.completed) break
      }
      setMessage("Progreso guardado. Puedes cerrar la pantalla y continuar después.")
      await load()
    } catch (requestError) {
      setError(humanError(requestError instanceof Error ? requestError.message : ""))
      await load()
    } finally { setScanning(false) }
  }

  const progress = currentRun && currentRun.total_candidates > 0
    ? Math.round((currentRun.processed_candidates / currentRun.total_candidates) * 100)
    : 0

  return (
    <main className="min-h-screen bg-[#05070d] px-4 py-6 text-white sm:px-6 md:px-10">
      <section className="mx-auto flex max-w-7xl flex-col gap-6">
        <nav className="flex flex-wrap gap-2 text-xs font-black uppercase tracking-wider">
          <a href="/admin/ebay-seller-os" className="rounded-full border border-white/15 px-4 py-2">Seller OS</a>
          <a href="/admin/ebay/mobile-review" className="rounded-full border border-white/15 px-4 py-2">Top 5 móvil</a>
          <a href="/admin/ebay/seller-performance" className="rounded-full border border-white/15 px-4 py-2">Performance</a>
        </nav>

        <header className="rounded-[32px] border border-violet-200/20 bg-gradient-to-br from-violet-300/[0.12] via-cyan-300/[0.06] to-black p-6 md:p-9">
          <p className="text-xs font-black uppercase tracking-[0.28em] text-violet-100/65">eBay-first × Luna Portex</p>
          <h1 className="mt-4 text-4xl font-black md:text-6xl">Cola automática de oportunidades</h1>
          <p className="mt-4 max-w-4xl text-sm leading-7 text-white/65">Recorre todas las variantes observadas en Luna, consulta comparables oficiales de eBay, acumula snapshots de velocidad y prioriza oportunidades sin crear ni publicar listings.</p>
        </header>

        <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 md:p-7">
          <div className="grid gap-4 lg:grid-cols-[2fr_auto_auto] lg:items-end">
            <label className="grid gap-2 text-sm font-bold text-white/70">Category IDs eBay opcionales para BEST_SELLING
              <input value={categoryIds} onChange={(event) => setCategoryIds(event.target.value)} placeholder="Ejemplo: 11700, 26395" className="min-h-12 rounded-2xl border border-white/15 bg-black/30 px-4" />
            </label>
            <button disabled={scanning} onClick={() => void startScan()} className="min-h-12 rounded-2xl bg-violet-200 px-5 font-black text-black disabled:opacity-50">Nuevo scan completo</button>
            <button disabled={scanning || !currentRun || currentRun.status !== "running"} onClick={() => void continueScan(5)} className="min-h-12 rounded-2xl bg-cyan-200 px-5 font-black text-black disabled:opacity-40">Procesar 5 lotes</button>
          </div>
          {currentRun && <div className="mt-5">
            <div className="flex justify-between text-xs font-bold"><span>{currentRun.status.toUpperCase()} · {currentRun.processed_candidates} de {currentRun.total_candidates} variantes</span><span>{progress}%</span></div>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gradient-to-r from-violet-300 to-cyan-200" style={{ width: `${progress}%` }} /></div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/55"><span>Exitosos: {currentRun.successful_candidates}</span><span>Fallidos: {currentRun.failed_candidates}</span><span>BEST_SELLING: {currentRun.best_selling_signals_found}</span></div>
          </div>}
          {message && <p className="mt-4 rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.06] p-3 text-sm text-cyan-50">{message}</p>}
          {error && <p className="mt-4 rounded-2xl border border-rose-200/25 bg-rose-200/[0.08] p-3 text-sm text-rose-50">{error}</p>}
        </section>

        {dashboard && <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            {Object.entries({ Total: dashboard.summary.total, Listas: dashboard.summary.ready, Revisar: dashboard.summary.review, Observación: dashboard.summary.watchlist, "Stock/Hold": dashboard.summary.supplierHolds, "Riesgos activos": dashboard.summary.activeListingRisks }).map(([name, value]) => <article key={name} className="rounded-2xl border border-white/10 bg-black/25 p-4"><p className="text-xs text-white/45">{name}</p><p className="mt-2 text-2xl font-black">{value}</p></article>)}
          </section>

          <section className="rounded-3xl border border-emerald-200/20 bg-emerald-200/[0.045] p-5 md:p-7">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100/60">Fast lane del vendedor</p>
                <h2 className="mt-2 text-2xl font-black md:text-3xl">Top potencial para preparar listing</h2>
                <p className="mt-2 max-w-4xl text-sm leading-6 text-white/60">Prioriza stock Luna, señal eBay y estructura disponible. El score ordena trabajo; no promete ventas ni sustituye la validación de identidad y margen.</p>
              </div>
              <span className="w-fit rounded-full border border-emerald-200/20 bg-black/25 px-4 py-2 text-xs font-black text-emerald-50">Top {topPotential.length} actual</span>
            </div>
            <div className="mt-5 grid gap-3 lg:grid-cols-5">
              {topPotential.map((row, index) => <article key={row.id} className="flex min-w-0 flex-col rounded-3xl border border-white/10 bg-black/25 p-4">
                <div className="flex items-center justify-between gap-3"><span className="text-xs font-black text-emerald-100/65">#{index + 1}</span><strong className="rounded-xl bg-emerald-100 px-2 py-1 text-sm text-black">{row.seller_priority_score}</strong></div>
                <h3 className="mt-3 text-sm font-black leading-5">{row.product_title}</h3>
                <p className="mt-2 text-xs leading-5 text-white/55">{row.ebay_candidate_count} candidatos eBay · {row.exact_comparable_count} exactos</p>
                <p className="mt-3 text-xs font-black text-emerald-100">{sellerLaneLabel(row.seller_lane)}</p>
                <p className="mt-2 text-xs leading-5 text-white/60">{row.next_seller_action}</p>
                <a href={`#opportunity-${row.id}`} className="mt-auto pt-4 text-xs font-black text-cyan-100 underline decoration-cyan-200/35 underline-offset-4">Ver evidencia y estructura</a>
              </article>)}
              {!topPotential.length && <p className="text-sm text-white/55">Procesa más lotes para encontrar candidatos con señal eBay.</p>}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-black/25 p-4 md:p-6">
            <div className="flex flex-wrap gap-2">{["all", "ready", "review", "watchlist", "hold"].map((value) => <button key={value} onClick={() => setFilter(value)} className={`rounded-full px-4 py-2 text-xs font-black uppercase ${filter === value ? "bg-white text-black" : "border border-white/15 text-white/65"}`}>{value === "all" ? "Todas" : label(value)}</button>)}</div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {filteredQueue.map((row, index) => <article id={`opportunity-${row.id}`} key={row.id} className={`scroll-mt-5 rounded-3xl border p-5 ${tone(row.queue_status)}`}>
                <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wider">#{index + 1} · {label(row.queue_status)}</p><h2 className="mt-2 text-xl font-black">{row.product_title}</h2><p className="mt-1 text-xs opacity-65">{row.variant_title ?? "Variante general"} · SKU {row.supplier_sku ?? "pendiente"}</p></div><span className="rounded-2xl bg-white px-3 py-2 text-xl font-black text-black">{Math.round(Number(row.opportunity_score))}</span></div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-xs"><div><span className="opacity-55">Demanda</span><strong className="block">{Math.round(Number(row.demand_score))}</strong></div><div><span className="opacity-55">Economía</span><strong className="block">{Math.round(Number(row.economics_score))}</strong></div><div><span className="opacity-55">Identidad</span><strong className="block">{Math.round(Number(row.identity_score))}</strong></div><div><span className="opacity-55">Velocidad/sem</span><strong className="block">{row.estimated_weekly_velocity ?? "Baseline"}</strong></div><div><span className="opacity-55">Precio eBay</span><strong className="block">{money(row.median_total_buyer_price)}</strong></div><div><span className="opacity-55">Beneficio</span><strong className="block">{money(row.estimated_net_profit)}</strong></div></div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs"><div className="rounded-2xl border border-white/15 p-3"><span className="opacity-55">Candidatos encontrados en eBay</span><strong className="mt-1 block text-lg">{row.ebay_candidate_count}</strong></div><div className="rounded-2xl border border-white/15 p-3"><span className="opacity-55">Comparables exactos</span><strong className="mt-1 block text-lg">{row.exact_comparable_count}</strong></div></div>
                <p className="mt-3 text-xs font-bold">{row.sellers_with_movement} vendedores con movimiento · match BEST_SELLING {row.best_selling_match_score ?? "pendiente"}</p>
                <details className="mt-3 rounded-2xl border border-emerald-200/20 bg-black/15 p-3" open={index < 2}>
                  <summary className="cursor-pointer text-sm font-black">Evidencia eBay y estructura profesional</summary>
                  <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
                    <div><span className="opacity-55">Prioridad vendedor</span><strong className="block text-lg">{row.seller_priority_score}/100</strong><p className="mt-1 font-bold text-emerald-100">{sellerLaneLabel(row.seller_lane)}</p></div>
                    <div><span className="opacity-55">Siguiente acción</span><p className="mt-1 leading-5">{row.next_seller_action}</p></div>
                    <div><span className="opacity-55">Frase principal</span><strong className="mt-1 block">{row.winning_structure.primarySearchPhrase ?? "Pendiente de evidencia multi-vendedor"}</strong><p className="mt-1 opacity-65">{row.winning_structure.secondarySearchTerms.join(" · ") || "Sin términos secundarios confirmados"}</p></div>
                    <div><span className="opacity-55">Categoría sugerida</span><strong className="mt-1 block">{row.winning_structure.categoryName ?? "Pendiente"}</strong><p className="mt-1 opacity-65">ID {row.winning_structure.categoryId ?? "pendiente"}</p></div>
                  </div>
                  {row.winning_structure.titleFormula && <p className="mt-3 rounded-xl border border-white/10 p-3 text-xs leading-5"><span className="opacity-55">Fórmula de título:</span> {row.winning_structure.titleFormula}</p>}
                  <div className="mt-3 space-y-2">{row.top_ebay_candidates.map((candidate, candidateIndex) => <div key={`${candidate.title}-${candidateIndex}`} className="rounded-xl border border-white/10 p-3 text-xs"><strong>Referencia {candidateIndex + 1} · {candidate.title}</strong><p className="mt-1 opacity-65">{candidate.price === null ? "Precio pendiente" : `${candidate.currency} ${numberFormatter.format(candidate.price)}`} · match {candidate.identityMatchScore} · {label(candidate.identityMatchQuality)}</p></div>)}</div>
                  {row.listing_intake_url ? <a href={row.listing_intake_url} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-2xl bg-emerald-100 px-4 py-2 text-xs font-black text-black">Preparar paquete de listing</a> : <p className="mt-4 rounded-xl border border-amber-200/15 bg-amber-200/[0.05] p-3 text-xs leading-5 text-amber-50">El paquete se desbloquea al confirmar identidad, margen, stock y datos obligatorios.</p>}
                </details>
                <details className="mt-3 rounded-2xl border border-white/15 p-3"><summary className="cursor-pointer text-sm font-black">Guardas y decisión</summary><p className="mt-2 text-xs">{label(row.decision)}</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{[...row.hard_gates, ...row.evidence_guards].map((guard) => <li key={guard}>{label(guard)}</li>)}</ul></details>
              </article>)}
              {!loading && !filteredQueue.length && <p className="rounded-2xl border border-white/10 p-6 text-white/55">La cola todavía está vacía. Inicia el primer scan.</p>}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-5"><h2 className="text-xl font-black">Cambios Luna monitoreados</h2><div className="mt-4 space-y-2">{dashboard.events.slice(0, 12).map((event) => <div key={event.id} className="rounded-2xl border border-white/10 p-3 text-sm"><strong>{label(event.event_type)}</strong><p className="mt-1 text-white/60">{event.ebay_luna_opportunity_queue?.product_title ?? "Producto Luna"}</p></div>)}{!dashboard.events.length && <p className="text-sm text-white/50">Sin cambios acumulados todavía.</p>}</div></article>
            <article className="rounded-3xl border border-rose-200/15 bg-rose-200/[0.04] p-5"><h2 className="text-xl font-black">Protección de listings activos</h2><div className="mt-4 space-y-2">{dashboard.activeListingRisks.slice(0, 12).map((risk) => <div key={risk.id} className="rounded-2xl border border-rose-200/15 p-3 text-sm"><strong>{risk.risk_priority.toUpperCase()} · {label(risk.risk_type)}</strong><p className="mt-1 text-white/70">{risk.risk_summary}</p><p className="mt-1 text-xs text-rose-100/70">{risk.recommended_action}</p></div>)}{!dashboard.activeListingRisks.length && <p className="text-sm text-white/50">No hay riesgos abiertos. Cuando existan listings vinculados, un stock agotado o aumento de costo en Luna se elevará aquí.</p>}</div></article>
          </section>
        </>}

        <footer className="rounded-3xl border border-emerald-200/15 bg-emerald-200/[0.05] p-5 text-sm leading-7 text-white/65"><strong className="text-emerald-100">Seguridad:</strong> descubrimiento eBay read-only, snapshots internos, aprobación humana obligatoria y publicación desactivada. Los estimados de Browse no se presentan como ventas históricas verificadas.</footer>
      </section>
    </main>
  )
}
