"use client"

import { useEffect, useMemo, useState } from "react"

import { supabase } from "@/lib/supabase"
import {
  getMobileReviewPayloadError,
  getMobileReviewRequestError,
  readMobileReviewJson,
} from "@/lib/ebay/ebay-mobile-review-http"
import type { RealRadarCandidate } from "@/lib/ebay/ebay-mobile-review-real-radar-connector"

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

export type Opportunity = {
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
  classification: "RECOMMENDED_FOR_REVIEW" | "PRELIMINARY_POTENTIAL" | "NEW_LUNA_SIGNAL" | "BLOCKED" | "REJECTED"
  evidence_tier: string
  why_here: {
    executedQuery: string | null
    analysisDate: string | null
    fresh: boolean
    identityConfidence: number
    broadResultCount: number
    exactComparableCount: number
    compatibleSellerCount: number
    confirmedSoldQuantity: number
    estimatedSignals: number
    productResearchStatus: string
    margin: number | null
    blockers: string[]
  }
  score_axes?: { potential: number; confidence: number; urgency: number }
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
    health?: {
      listingProtectionMonitor: {
        status: "ACTIVE" | "MANUAL_RECENT" | "DEGRADED" | "NOT_MONITORED" | "NOT_APPLICABLE"
        reasons: string[]
        targetedMonitorEnabled: boolean
        automaticScheduleActive: boolean
        canonicalActiveListings: number
        exactMappedActiveListings: number
        freshlyReviewedActiveListings: number
        luna: {
          targetedMonitor: { lastSuccessAt: string | null; fresh: boolean }
          fullCatalog: { lastSuccessAt: string | null; fresh: boolean }
        }
        protection: {
          oldestCanonicalReviewAt: string | null
          latestCanonicalReviewAt: string | null
          allFresh: boolean
        }
      }
    }
  }
  quota: {
    discoveryPaused: boolean
    monitorBudgetProtected: boolean
    latestPause: { resume_at: string | null; affected_lane: string; retry_after_seconds: number | null } | null
    states: Array<{ api_family: string; operation: string; remaining: number | null; reserved_budget: number; available_budget: number; status: string; owner_lane: string }>
  }
}

type ActiveListingSyncStatus = {
  latest_started_at: string | null
  last_success_at: string | null
  last_error_at: string | null
  last_error_code: string | null
  active_run_started_at: string | null
  active_run_lease_expires_at: string | null
}

const ACCELERATION_BATCHES = 10

function label(value: string) {
  const operationalLabels: Record<string, string> = {
    ACTIVE_LISTING_LUNA_MAPPING_INCOMPLETE: "Falta vincular uno o más listings con la variante exacta de Luna",
    TARGETED_LUNA_MONITOR_HEARTBEAT_STALE: "El monitor dirigido de Luna no tiene una ejecución reciente",
    ACTIVE_LISTING_PROTECTION_HEARTBEAT_STALE: "La revisión de protección del listing está vencida",
    TARGETED_LUNA_MONITOR_FEATURE_DISABLED: "El monitor dirigido de Luna está desactivado en Preview",
  }
  if (operationalLabels[value]) return operationalLabels[value]
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
    LISTING_PACKAGE_INTAKE_READY: "Listo para completar paquete",
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
  guided = false,
  radarCandidates = [],
  onReviewCandidate,
  onRadarRefresh,
  onRadarLookup,
  confirmDestructiveRefresh,
  preferredMarketRadarProductId,
}: {
  guided?: boolean
  radarCandidates?: RealRadarCandidate[]
  onReviewCandidate: (opportunity: Opportunity, radarCandidates?: RealRadarCandidate[]) => boolean
  onRadarRefresh: () => Promise<RealRadarCandidate[]>
  onRadarLookup: (productId: string) => Promise<RealRadarCandidate | null>
  confirmDestructiveRefresh?: () => boolean
  preferredMarketRadarProductId?: string | null
}) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("Cargando cola eBay-first…")
  const [error, setError] = useState("")
  const [filter, setFilter] = useState("all")
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null)
  const [missingRadarOpportunity, setMissingRadarOpportunity] = useState<Opportunity | null>(null)
  const [missingRadarDetail, setMissingRadarDetail] = useState("")
  const [activeListingSyncStatus, setActiveListingSyncStatus] =
    useState<ActiveListingSyncStatus | null>(null)
  const currentRun = dashboard?.runs.find((run) => run.status === "running") ?? dashboard?.runs[0] ?? null

  function showMessage(nextMessage: string) {
    setError("")
    setMessage(nextMessage)
  }

  function showError(nextError: string) {
    setMessage("")
    setError(nextError)
  }

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
    const payload = await readMobileReviewJson<Record<string, any>>(
      response,
      "No se pudo consultar la cola de oportunidades",
    )
    if (!payload.success) throw new Error(getMobileReviewPayloadError(payload, "No se pudo consultar la cola."))
    return payload
  }

  async function load() {
    setError("")
    try {
      const payload = await request()
      setDashboard(payload.dashboard)
      setRefreshedAt(new Date().toISOString())
      showMessage("")
    } catch (requestError) {
      showError(getMobileReviewRequestError(requestError, "No se pudo consultar la cola."))
    }
  }

  async function syncActiveListings() {
    setBusy(true); setError(""); setMessage("Sincronizando tus listings activos desde eBay…")
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !data.session) throw new Error("La sesión Admin expiró.")
      const response = await fetch("/api/admin/ebay/active-listings/sync", {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      })
      const payload = await readMobileReviewJson<Record<string, any>>(
        response,
        "No se pudieron sincronizar los listings activos",
      )
      if (!payload.success) throw new Error(getMobileReviewPayloadError(payload, "ACTIVE_LISTING_SYNC_FAILED"))
      await loadActiveListingSyncStatus()
      await load()
      showMessage(`Listings sincronizados: ${payload.sync?.listingsStored ?? 0}; vinculados con Luna: ${payload.sync?.listingsMappedToLuna ?? 0}. La protección ya usa el estado más reciente.`)
    } catch (requestError) {
      await loadActiveListingSyncStatus().catch(() => undefined)
      showError(getMobileReviewRequestError(requestError, "ACTIVE_LISTING_SYNC_FAILED"))
    } finally { setBusy(false) }
  }

  async function loadActiveListingSyncStatus() {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !data.session) return
    const response = await fetch("/api/admin/ebay/active-listings/sync", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    })
    const payload = await readMobileReviewJson<Record<string, any>>(
      response,
      "No se pudo consultar la última sincronización",
    )
    if (payload.success) setActiveListingSyncStatus(payload.state ?? null)
  }

  useEffect(() => {
    void load()
    void loadActiveListingSyncStatus()
  }, [])

  async function startPriorityScan() {
    const restart = Boolean(currentRun?.status === "running" && currentRun.processed_candidates > 0)
    setBusy(true); setError(""); setMessage(restart ? "Reiniciando por potencial…" : "Iniciando scan prioritario…")
    try {
      if (restart) {
        const preview = await request({ action: "preview_recovery", mode: "RESUME_FROM_CHECKPOINT" })
        const tasks = Number(preview.preview?.taskCount ?? 0)
        const maximumCalls = Number(preview.preview?.estimatedBrowseCalls?.maximum ?? 0)
        if (!window.confirm(`Se reanudará desde el mismo checkpoint: ${tasks} tareas elegibles, máximo estimado ${maximumCalls} llamadas Browse. Nunca se reiniciarán las 1,513 variantes. ¿Continuar?`)) return
      }
      await request({ action: restart ? "RESUME_FROM_CHECKPOINT" : "start", categoryIds: [] })
      showMessage("Primer lote prioritario guardado. Los mejores candidatos se analizan primero.")
      await load()
    } catch (requestError) {
      showError(getMobileReviewRequestError(requestError, "SCAN_FAILED"))
    } finally { setBusy(false) }
  }

  async function refreshLunaRadar() {
    if (confirmDestructiveRefresh && !confirmDestructiveRefresh()) return null
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
      const payload = await readMobileReviewJson<Record<string, any>>(
        response,
        "No se pudo actualizar Market Radar desde Luna",
      )
      if (!payload.success) throw new Error(getMobileReviewPayloadError(payload, "MARKET_RADAR_SYNC_FAILED"))
      const [radarCandidates] = await Promise.all([onRadarRefresh(), load()])
      showMessage("Luna quedó actualizada. Radar y Opportunity Queue ya pueden usar la evidencia más reciente.")
      return radarCandidates
    } catch (requestError) {
      showError(getMobileReviewRequestError(requestError, "MARKET_RADAR_SYNC_FAILED"))
      return null
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
      showMessage(`${completedBatches} lotes procesados. El progreso quedó guardado y puedes cerrar el teléfono.`)
      await load()
    } catch (requestError) {
      showError(getMobileReviewRequestError(requestError, "SCAN_FAILED"))
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
    .filter((row) => row.supplier_available !== false &&
      ["RECOMMENDED_FOR_REVIEW", "PRELIMINARY_POTENTIAL"].includes(row.classification))
    .sort((left, right) => right.seller_priority_score - left.seller_priority_score)
    .slice(0, 5), [dashboard])
  const radarByProductId = useMemo(
    () => new Map(radarCandidates.map((candidate) => [candidate.marketRadarProductId, candidate])),
    [radarCandidates],
  )
  const newRadarSignals = useMemo(() => {
    const queuedIds = new Set((dashboard?.queue ?? [])
      .map((row) => row.market_radar_product_id)
      .filter((value): value is string => Boolean(value)))
    return radarCandidates
      .filter((candidate) => candidate.availabilityStatus === "AVAILABLE" &&
        !queuedIds.has(candidate.marketRadarProductId))
      .slice(0, 5)
  }, [dashboard, radarCandidates])
  const preferredOpportunity = useMemo(
    () => preferredMarketRadarProductId
      ? dashboard?.queue.find((row) => row.market_radar_product_id === preferredMarketRadarProductId) ?? null
      : null,
    [dashboard, preferredMarketRadarProductId],
  )

  async function openRadarReview(opportunity: Opportunity) {
    if (onReviewCandidate(opportunity)) {
      setMissingRadarOpportunity(null)
      setMissingRadarDetail("")
      showMessage("")
      return
    }

    setError("")
    setMessage("")
    setMissingRadarOpportunity(opportunity)
    if (!opportunity.market_radar_product_id) {
      setMissingRadarDetail("La oportunidad no tiene un productId de Radar vinculado. Actualiza Luna para reconstruir la relación.")
      return
    }

    setBusy(true)
    setMissingRadarDetail("No está en el Top 50 cargado. Buscando el productId exacto en Radar…")
    try {
      const candidate = await onRadarLookup(opportunity.market_radar_product_id)
      if (candidate && onReviewCandidate(opportunity, [candidate])) {
        setMissingRadarOpportunity(null)
        setMissingRadarDetail("")
        showMessage("Producto encontrado por productId en Radar. Ya puedes continuar la revisión móvil.")
        return
      }
      setMissingRadarDetail("Radar respondió a la búsqueda exacta, pero este productId no está disponible. Actualiza Luna y vuelve a intentar.")
    } catch (requestError) {
      setMissingRadarDetail(getMobileReviewRequestError(
        requestError,
        "No se pudo completar la búsqueda exacta por productId.",
      ))
    } finally {
      setBusy(false)
    }
  }

  async function refreshMissingRadarOpportunity() {
    if (!missingRadarOpportunity || busy) return
    const opportunity = missingRadarOpportunity
    setMissingRadarDetail("Actualizando Luna y buscando el producto nuevamente en Radar…")
    const radarCandidates = await refreshLunaRadar()
    if (!radarCandidates) return

    if (onReviewCandidate(opportunity, radarCandidates)) {
      setMissingRadarOpportunity(null)
      setMissingRadarDetail("")
      showMessage("Producto encontrado en Radar. Ya puedes continuar la revisión móvil.")
      return
    }

    if (opportunity.market_radar_product_id) {
      try {
        const candidate = await onRadarLookup(opportunity.market_radar_product_id)
        if (candidate && onReviewCandidate(opportunity, [candidate])) {
          setMissingRadarOpportunity(null)
          setMissingRadarDetail("")
          showMessage("Producto encontrado por productId después de actualizar Radar.")
          return
        }
      } catch (requestError) {
        setMissingRadarDetail(getMobileReviewRequestError(
          requestError,
          "Radar se actualizó, pero falló la búsqueda exacta por productId.",
        ))
        return
      }
    }

    setError("")
    setMessage("")
    setMissingRadarDetail("Radar se actualizó correctamente, pero este producto aún no aparece. Procesa el siguiente lote prioritario y vuelve a intentar.")
  }

  return <section aria-labelledby="opportunity-command-center-heading" className="space-y-4">
    <header className="rounded-3xl border border-violet-200/25 bg-gradient-to-br from-violet-200/[0.12] via-cyan-200/[0.05] to-black p-4">
      <p className="text-xs font-black uppercase tracking-widest text-violet-100/70">Descubrir → validar → preparar</p>
      <h2 id="opportunity-command-center-heading" className="mt-2 text-2xl font-black">Centro de oportunidades eBay-first</h2>
      <p className="mt-2 text-sm leading-6 text-white/70">Analiza primero los productos con mejor señal de Radar, guarda evidencia eBay y te lleva al siguiente bloqueo sin usar la laptop.</p>
      <details open={!guided} className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3">
        <summary className="cursor-pointer text-sm font-black text-white/70">{guided ? "Actualizar oportunidades" : "Controles de análisis"}</summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <button disabled={busy} onClick={() => void refreshLunaRadar()} className="min-h-14 rounded-2xl border border-white/20 bg-black/25 px-3 font-black text-white disabled:opacity-50">1. Actualizar Luna</button>
        <button disabled={busy} onClick={() => void startPriorityScan()} className="min-h-14 rounded-2xl bg-violet-200 px-3 font-black text-black disabled:opacity-50">{currentRun?.status === "running" && currentRun.processed_candidates > 0 ? "Reanudar desde checkpoint" : "Iniciar discovery ligero"}</button>
        <button disabled={busy || !currentRun || currentRun.status !== "running"} onClick={() => void accelerate()} className="min-h-14 rounded-2xl bg-cyan-200 px-3 font-black text-black disabled:opacity-40">{busy ? "Analizando…" : "Acelerar 20 productos"}</button>
      </div>
      {currentRun && <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-3"><div className="flex justify-between text-xs font-bold"><span>{currentRun.status.toUpperCase()} · {currentRun.processed_candidates}/{currentRun.total_candidates}</span><span>{progressLabel}</span></div><div className="mt-2 h-3 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gradient-to-r from-violet-300 to-cyan-200" style={{ width: `${Math.max(progressValue > 0 ? 1 : 0, progressValue)}%` }} /></div><p className="mt-2 text-xs text-white/55">Exitosos {currentRun.successful_candidates} · Fallidos {currentRun.failed_candidates} · última ejecución {formatDate(currentRun.last_batch_at)}</p></div>}
      {dashboard?.automation && <div className="mt-3 rounded-2xl border border-emerald-200/20 bg-emerald-200/[0.05] p-3 text-xs leading-5 text-emerald-50"><strong>Automatización:</strong> prioridad primero · {dashboard.automation.productionScheduleLabel}. El cron corre en Production; en este Preview usa “Acelerar 20 productos”.</div>}
      {dashboard?.quota && <div className={`mt-3 rounded-2xl border p-3 text-xs leading-5 ${dashboard.quota.discoveryPaused ? "border-amber-200/30 bg-amber-200/[0.08] text-amber-50" : "border-cyan-200/20 bg-cyan-200/[0.05] text-cyan-50"}`}><strong>Cuota eBay:</strong> {dashboard.quota.discoveryPaused ? `Discovery pausado hasta ${formatDate(dashboard.quota.latestPause?.resume_at ?? null)}; el checkpoint está guardado.` : "Discovery disponible."} <span className="block">Reserva del monitor comercial: {dashboard.quota.monitorBudgetProtected ? "protegida" : "pendiente de configurar"}.</span></div>}
      {refreshedAt && <p className="mt-3 text-right text-[11px] font-bold text-white/45">Panel actualizado {formatDate(refreshedAt)}</p>}
      {message && <p aria-live="polite" className="mt-3 rounded-2xl border border-white/10 p-3 text-sm text-white/70">{message}</p>}
      {error && <p role="alert" className="mt-3 rounded-2xl border border-rose-200/25 bg-rose-200/[0.08] p-3 text-sm text-rose-50">{error}</p>}
      </details>
    </header>

    {missingRadarOpportunity && <section role="status" className="rounded-3xl border border-amber-200/30 bg-amber-200/[0.08] p-4 text-amber-50">
      <p className="text-xs font-black uppercase tracking-widest text-amber-100/70">Sincronización pendiente</p>
      <h3 className="mt-2 text-lg font-black">Este producto aún no está en Radar móvil</h3>
      <p className="mt-1 font-bold">{missingRadarOpportunity.product_title}</p>
      <p className="mt-2 text-sm leading-6 text-amber-50/75">{missingRadarDetail}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button type="button" disabled={busy} onClick={() => void refreshMissingRadarOpportunity()} className="min-h-12 rounded-2xl bg-amber-100 px-4 font-black text-black disabled:opacity-50">Actualizar Radar y reintentar</button>
        <button type="button" onClick={() => { setMissingRadarOpportunity(null); setMissingRadarDetail("") }} className="min-h-12 rounded-2xl border border-amber-100/30 px-4 font-bold">Cerrar aviso</button>
      </div>
    </section>}

    {dashboard && <>
      {preferredMarketRadarProductId && <section className="rounded-3xl border border-emerald-200/30 bg-emerald-200/[0.08] p-4">
        <p className="text-xs font-black uppercase tracking-widest text-emerald-100/65">Continuar producto del Top 5</p>
        {preferredOpportunity
          ? <><h3 className="mt-2 font-black">{preferredOpportunity.product_title}</h3><p className="mt-1 text-sm text-white/65">La oportunidad canónica está disponible. Vincúlala para conservar las confirmaciones locales y activar el guardado en servidor.</p><button type="button" disabled={busy} onClick={() => void openRadarReview(preferredOpportunity)} className="mt-3 min-h-12 w-full rounded-2xl bg-emerald-200 px-4 font-black text-black disabled:opacity-50">Continuar este mismo producto</button></>
          : <><h3 className="mt-2 font-black">Todavía no está en la cola canónica</h3><p className="mt-1 text-sm text-white/65">Inicia o acelera el scan prioritario. El OS mostrará aquí el botón para vincularlo en cuanto aparezca, sin pedirte otro producto.</p></>}
      </section>}

      <details open={!guided} className="rounded-2xl border border-white/10 p-3"><summary className="cursor-pointer text-sm font-bold text-white/55">Resumen de la cola</summary><div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-2xl border border-white/10 p-3"><span className="text-white/50">Total</span><strong className="mt-1 block text-xl">{dashboard.summary.total}</strong></div>
        <div className="rounded-2xl border border-emerald-200/20 p-3"><span className="text-white/50">Para draft</span><strong className="mt-1 block text-xl">{dashboard.summary.ready}</strong></div>
        <div className="rounded-2xl border border-cyan-200/20 p-3"><span className="text-white/50">Revisar</span><strong className="mt-1 block text-xl">{dashboard.summary.review}</strong></div>
        <div className="rounded-2xl border border-amber-200/20 p-3"><span className="text-white/50">Baseline</span><strong className="mt-1 block text-xl">{dashboard.summary.watchlist}</strong></div>
        <div className="rounded-2xl border border-rose-200/20 p-3"><span className="text-white/50">Hold</span><strong className="mt-1 block text-xl">{dashboard.summary.supplierHolds}</strong></div>
        <div className="rounded-2xl border border-rose-200/20 p-3"><span className="text-white/50">Riesgos</span><strong className="mt-1 block text-xl">{dashboard.summary.activeListingRisks}</strong></div>
      </div></details>

      <section className="rounded-3xl border border-emerald-200/20 bg-emerald-200/[0.045] p-4">
        <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-widest text-emerald-100/65">Cola canónica + Radar actualizado</p><h3 className="mt-1 text-xl font-black">Oportunidades para revisar</h3></div><span className="rounded-xl bg-emerald-100 px-3 py-2 text-sm font-black text-black">Top {topPotential.length}</span></div>
        <p className="mt-2 text-xs leading-5 text-white/60">El orden combina evidencia compatible, economía e identidad. Una señal sólo de Luna o una búsqueda amplia nunca se presenta como demanda confirmada.</p>
        <div className="mt-4 space-y-3">{topPotential.map((row, index) => {
          const radar = row.market_radar_product_id
            ? radarByProductId.get(row.market_radar_product_id) ?? null
            : null
          return <article key={row.id} className="rounded-2xl border border-white/10 bg-black/25 p-3">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black text-emerald-100">#{index + 1} · {sellerLaneLabel(row.seller_lane)}</p><h4 className="mt-1 font-black leading-5">{row.product_title}</h4></div><div className="rounded-xl bg-white px-2 py-1 text-center text-black"><span className="block text-[9px] font-black uppercase">Prioridad</span><strong>{row.seller_priority_score}</strong></div></div>
          {!guided && row.score_axes && <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]"><div className="rounded-xl bg-white/[0.06] p-2"><dt className="text-white/50">Potencial</dt><dd className="mt-1 font-black">{Math.round(row.score_axes.potential)}</dd></div><div className="rounded-xl bg-white/[0.06] p-2"><dt className="text-white/50">Confianza</dt><dd className="mt-1 font-black">{Math.round(row.score_axes.confidence)}</dd></div><div className="rounded-xl bg-white/[0.06] p-2"><dt className="text-white/50">Urgencia</dt><dd className="mt-1 font-black">{Math.round(row.score_axes.urgency)}</dd></div></dl>}
          {radar && <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]"><div className="rounded-xl bg-cyan-200/[0.07] p-2"><dt className="text-cyan-50/55">Stock Luna</dt><dd className="mt-1 font-black">{radar.stockQuantity ?? "Por confirmar"}</dd></div><div className="rounded-xl bg-cyan-200/[0.07] p-2"><dt className="text-cyan-50/55">Costo Luna</dt><dd className="mt-1 font-black">{radar.lunaPrice === null ? "Pendiente" : money(radar.lunaPrice)}</dd></div><div className="rounded-xl bg-cyan-200/[0.07] p-2"><dt className="text-cyan-50/55">Frescura</dt><dd className="mt-1 font-black">{radar.stockConfirmationAgeHours === null ? "Pendiente" : radar.stockConfirmationAgeHours < 1 ? "Menos de 1 h" : `${Math.round(radar.stockConfirmationAgeHours)} h`}</dd></div></dl>}
          {!radar && <p className="mt-3 rounded-xl border border-amber-200/20 bg-amber-200/[0.05] p-2 text-xs text-amber-50">Radar pendiente de sincronizar para este producto. La prioridad canónica se conserva.</p>}
          {!guided && <p className="mt-2 text-xs text-white/60">{row.ebay_candidate_count} candidatos eBay · {row.exact_comparable_count} comparables exactos</p>}
          <details className="mt-3 rounded-xl border border-white/15 p-2 text-xs"><summary className="cursor-pointer font-black">¿Por qué está aquí?</summary><dl className="mt-2 grid gap-1"><div><dt className="text-white/45">Clasificación</dt><dd className="font-bold">{label(row.classification)}</dd></div><div><dt className="text-white/45">Evidencia</dt><dd>{label(row.evidence_tier)} · identidad {Math.round(row.why_here.identityConfidence)}%</dd></div><div><dt className="text-white/45">Mercado</dt><dd>{row.why_here.broadResultCount} amplios · {row.why_here.exactComparableCount} exactos · vendidos exactos {row.why_here.confirmedSoldQuantity}</dd></div><div><dt className="text-white/45">Product Research</dt><dd>{label(row.why_here.productResearchStatus)}</dd></div><div><dt className="text-white/45">Frescura</dt><dd>{row.why_here.fresh ? "Vigente" : "Vencida o pendiente"} · {formatDate(row.why_here.analysisDate)}</dd></div>{row.why_here.blockers.length > 0 && <div><dt className="text-rose-100/70">Bloqueos</dt><dd className="text-rose-50">{row.why_here.blockers.map(label).join(" · ")}</dd></div>}</dl></details>
          <p className="mt-2 text-xs leading-5 text-white/75">{row.next_seller_action}</p>
          <div className={`mt-3 ${guided ? "" : "grid grid-cols-2 gap-2"}`}><button type="button" disabled={busy || !row.market_radar_product_id} onClick={() => { if (row.market_radar_product_id) void openRadarReview(row) }} className="min-h-12 w-full rounded-xl bg-cyan-200 px-3 text-sm font-black text-black disabled:opacity-40">Elegir este producto</button>{!guided && (row.can_open_listing_workspace ? <a href={`/admin/ebay/listing-workspace?opportunity=${encodeURIComponent(row.id)}&candidate=${encodeURIComponent(row.candidate_key)}`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-emerald-200/35 px-3 text-center text-xs font-black text-emerald-50">{row.can_prepare_listing_package ? "Preparar draft" : "Completar paquete"}</a> : <button type="button" disabled aria-disabled="true" className="min-h-11 rounded-xl border border-white/10 px-3 text-xs font-black text-white/40">Guardas de mercado</button>)}</div>
        </article>})}{!topPotential.length && <p className="text-sm text-white/55">Acelera el scan para construir el primer Top con evidencia eBay.</p>}</div>
        {newRadarSignals.length > 0 && <details className="mt-4 rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.05] p-3"><summary className="cursor-pointer text-sm font-black">{newRadarSignals.length} señal{newRadarSignals.length === 1 ? "" : "es"} nueva{newRadarSignals.length === 1 ? "" : "s"} de Radar</summary><p className="mt-2 text-xs leading-5 text-white/60">Son productos recientes de Luna que todavía no terminaron el análisis canónico. No compiten en el ranking hasta procesar evidencia eBay.</p><div className="mt-3 space-y-2">{newRadarSignals.map((candidate) => <div key={candidate.marketRadarProductId} className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="font-bold">{candidate.productTitle}</p><p className="mt-1 text-xs text-white/55">SKU {candidate.supplierSku ?? "Pendiente"} · stock {candidate.stockQuantity ?? "por confirmar"} · costo {candidate.lunaPrice === null ? "pendiente" : money(candidate.lunaPrice)}</p><p className="mt-1 text-xs font-bold text-cyan-50">Nueva señal · análisis pendiente</p></div>)}</div></details>}
      </section>

      <details open={!guided} className="rounded-3xl border border-white/10 p-4"><summary className="cursor-pointer font-black">Ver toda la cola y filtros</summary><nav aria-label="Filtrar oportunidades" className="mt-3 flex gap-2 overflow-x-auto pb-1">{["all", "ready", "review", "watchlist", "hold"].map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`min-h-11 shrink-0 rounded-full px-4 text-xs font-black uppercase ${filter === value ? "bg-white text-black" : "border border-white/15"}`}>{value === "all" ? "Todas" : label(value)}</button>)}</nav>

      <div className="mt-3 space-y-3">{rows.map((row, index) => <article key={row.id} className={`rounded-3xl border p-4 ${cardTone(row.queue_status)}`}>
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase">#{index + 1} · {label(row.queue_status)}</p><h3 className="mt-2 text-lg font-black">{row.product_title}</h3><p className="mt-1 text-xs text-white/55">{row.variant_title ?? "Variante general"} · {row.supplier_sku ?? "SKU pendiente"}</p></div><div className="rounded-2xl bg-white px-3 py-2 text-center text-black"><span className="block text-[9px] font-black uppercase">Prioridad</span><strong className="text-xl">{row.seller_priority_score}</strong></div></div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs"><div><dt className="text-white/50">Evidencia</dt><dd className="font-black">{label(row.evidence_tier)}</dd></div><div><dt className="text-white/50">Economía</dt><dd className="font-black">{Math.round(Number(row.economics_score))}</dd></div><div><dt className="text-white/50">Identidad</dt><dd className="font-black">{Math.round(Number(row.identity_score))}</dd></div><div><dt className="text-white/50">Resultados amplios</dt><dd className="font-black">{row.ebay_candidate_count}</dd></div><div><dt className="text-white/50">Exactos</dt><dd className="font-black">{row.exact_comparable_count}</dd></div><div><dt className="text-white/50">Score V2</dt><dd className="font-black">{row.seller_priority_score}</dd></div></dl>
        <details className="mt-3 rounded-2xl border border-white/15 p-3"><summary className="cursor-pointer text-sm font-black">Evidencia y estructura</summary><dl className="mt-3 grid gap-2 text-xs"><div><dt className="text-white/50">Siguiente acción</dt><dd className="mt-1 font-bold">{row.next_seller_action}</dd></div><div><dt className="text-white/50">Frase principal</dt><dd className="mt-1 font-bold">{row.winning_structure.primarySearchPhrase ?? "Pendiente de evidencia multi-vendedor"}</dd></div><div><dt className="text-white/50">Categoría</dt><dd className="mt-1 font-bold">{row.winning_structure.categoryName ?? row.winning_structure.categoryId ?? "Pendiente"}</dd></div></dl><div className="mt-3 space-y-2">{row.top_ebay_candidates.map((candidate, candidateIndex) => <div key={`${candidate.title}-${candidateIndex}`} className="rounded-xl bg-black/25 p-2 text-xs"><strong>Referencia {candidateIndex + 1}: {candidate.title}</strong><p className="mt-1 text-white/55">{candidate.price === null ? "Precio pendiente" : `${candidate.currency} ${candidate.price.toFixed(2)}`} · match {candidate.identityMatchScore}</p></div>)}</div></details>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2"><details className="rounded-2xl border border-white/15 p-3"><summary className="cursor-pointer text-sm font-black">Guardas</summary><ul className="mt-2 list-disc space-y-1 pl-4 text-xs">{[...row.hard_gates, ...row.evidence_guards].map((guard) => <li key={guard}>{label(guard)}</li>)}</ul></details>{row.market_radar_product_id && <button disabled={busy} onClick={() => void openRadarReview(row)} className="min-h-12 rounded-2xl bg-emerald-200 px-3 text-xs font-black text-black disabled:opacity-50">Revisar</button>}</div>
      </article>)}{!rows.length && <p className="rounded-2xl border border-white/10 p-5 text-sm text-white/55">Inicia el scan prioritario para construir la cola.</p>}</div></details>

      <details className="rounded-3xl border border-white/10 p-4"><summary className="cursor-pointer font-black">Operación y riesgos de listings</summary><p className="mt-3 text-sm text-white/65">{dashboard.events.length} cambios Luna recientes · {dashboard.activeListingRisks.length} riesgos abiertos de listings.</p>{dashboard.automation.health?.listingProtectionMonitor && <div className={`mt-3 rounded-2xl border p-3 text-xs leading-5 ${dashboard.automation.health.listingProtectionMonitor.status === "ACTIVE" ? "border-emerald-200/30 bg-emerald-200/[0.08] text-emerald-50" : dashboard.automation.health.listingProtectionMonitor.status === "MANUAL_RECENT" ? "border-cyan-200/25 bg-cyan-200/[0.06] text-cyan-50" : "border-amber-200/30 bg-amber-200/[0.08] text-amber-50"}`}><strong>Protección Luna: {dashboard.automation.health.listingProtectionMonitor.status === "ACTIVE" ? "automática y vigente" : dashboard.automation.health.listingProtectionMonitor.status === "MANUAL_RECENT" ? "revisión manual reciente" : dashboard.automation.health.listingProtectionMonitor.status === "NOT_APPLICABLE" ? "sin listings activos" : "no confirmada"}</strong><p className="mt-1">Monitor dirigido: {formatDate(dashboard.automation.health.listingProtectionMonitor.luna.targetedMonitor.lastSuccessAt)} · catálogo general: {formatDate(dashboard.automation.health.listingProtectionMonitor.luna.fullCatalog.lastSuccessAt)} · protección: {formatDate(dashboard.automation.health.listingProtectionMonitor.protection.latestCanonicalReviewAt)} · vínculos exactos {dashboard.automation.health.listingProtectionMonitor.exactMappedActiveListings}/{dashboard.automation.health.listingProtectionMonitor.canonicalActiveListings}.</p>{dashboard.automation.health.listingProtectionMonitor.reasons.length > 0 && <p className="mt-1 opacity-75">{dashboard.automation.health.listingProtectionMonitor.reasons.map(label).join(" · ")}</p>}</div>}<div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl bg-white/[0.05] p-2"><span className="text-white/45">Última ejecución</span><strong className="mt-1 block">{formatDate(activeListingSyncStatus?.latest_started_at ?? null)}</strong></div><div className="rounded-xl bg-white/[0.05] p-2"><span className="text-white/45">Último éxito</span><strong className="mt-1 block">{formatDate(activeListingSyncStatus?.last_success_at ?? null)}</strong></div></div>{activeListingSyncStatus?.last_error_at && <p role="alert" className="mt-2 rounded-xl border border-rose-200/20 p-2 text-xs text-rose-50">Último error {formatDate(activeListingSyncStatus.last_error_at)} · {activeListingSyncStatus.last_error_code ?? "ACTIVE_LISTING_SYNC_FAILED"}</p>}<p className="mt-3 text-xs leading-5 text-cyan-50/70">Piloto manual: ejecuta esta sincronización inmediatamente después de registrar el Item ID y antes de cada revisión operativa.</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><button type="button" disabled={busy || Boolean(activeListingSyncStatus?.active_run_started_at && activeListingSyncStatus?.active_run_lease_expires_at && Date.parse(activeListingSyncStatus.active_run_lease_expires_at) > Date.now())} onClick={() => void syncActiveListings()} className="min-h-12 rounded-2xl border border-cyan-200/30 px-3 font-black text-cyan-50 disabled:opacity-50">Sincronizar listings activos</button><a href="/admin/ebay/listings/register" className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-cyan-200 px-3 text-center font-black text-black">Registrar listing manual</a></div>{dashboard.activeListingRisks.slice(0, 8).map((risk) => <div key={risk.id} className="mt-2 rounded-2xl border border-rose-200/15 p-3 text-xs"><strong>{risk.risk_priority.toUpperCase()} · {label(risk.risk_type)}</strong><p className="mt-1 text-white/65">{risk.risk_summary}</p></div>)}</details>
    </>}
  </section>
}
