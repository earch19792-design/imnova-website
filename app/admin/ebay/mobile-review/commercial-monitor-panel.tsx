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

type MonitorMetrics = Record<string, unknown> & {
  dryRun?: boolean
  activeListings?: number
  officialOrdersRead?: number
  completedCheckoutLineItems?: number
  analyticsListingsRead?: number
  watcherListingsRead?: number
  newSales?: number
  fulfillmentTasksCreated?: number
  snapshotsCreated?: number
  alertsGenerated?: number
  alertsEnqueued?: number
  whatsappDelivered?: number
  ebayWrites?: number
  buyerPiiReturned?: boolean
  commercialDataPersistencePerformed?: boolean
  analytics?: {
    impressions?: number
    views?: number
    transactions?: number
    watchers?: number
  }
}

type MonitorRun = Omit<CommercialMonitorRunView, "metrics"> & {
  metrics?: MonitorMetrics
}

type Dashboard = {
  status?: string
  latestRun?: MonitorRun | null
  health?: {
    fulfillmentTasks?: number
    pendingManualPurchase?: number
    awaitingTracking?: number
    alertsPending?: number
    alertsFailed?: number
    alertsDeadLetter?: number
    retries?: number
  } | null
  nextAutomaticRunAt?: string | null
  schedule?: {
    enabled?: boolean
    previewOnly?: boolean
  }
}

type Payload = {
  success?: boolean
  error?: string
  dashboard?: Dashboard
  run?: MonitorRun
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
  return typeof input === "number" ? new Intl.NumberFormat("es-US").format(input) : "0"
}

export function CommercialMonitorPanel() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [busyMode, setBusyMode] = useState<"dry_run" | "persistent" | null>(null)
  const [dryRunResult, setDryRunResult] = useState<MonitorRun | null>(null)
  const [gateNow, setGateNow] = useState(0)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const request = useCallback(async (mode?: "dry_run" | "persistent") => {
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
        ? JSON.stringify(buildCommercialMonitorRunRequest(mode === "dry_run"))
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
      const payload = await request("persistent")
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

  const run = dashboard?.latestRun
  const metrics = run?.metrics
  const analytics = metrics?.analytics
  const health = dashboard?.health
  const readers: Record<string, CommercialMonitorReaderView> = run?.readers ?? {}
  const displayedDryRun = dryRunResult ?? (run?.metrics?.dryRun === true ? run : null)
  const dryRunMetrics = displayedDryRun?.metrics
  const dryRunReaders: Record<string, CommercialMonitorReaderView> = displayedDryRun?.readers ?? {}
  const dryRunSatisfactory = gateNow > 0
    && isSatisfactoryCommercialDryRun(displayedDryRun, gateNow)
  const dryRunValue = (input: unknown) => displayedDryRun ? value(input) : "—"

  return (
    <section aria-labelledby="commercial-monitor-heading" className="rounded-3xl border border-emerald-200/25 bg-gradient-to-br from-emerald-200/[0.10] via-cyan-200/[0.04] to-black p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-emerald-100/65">Monitoreo comercial · separado de Radar</p>
          <h2 id="commercial-monitor-heading" className="mt-2 text-2xl font-black">Ventas y rendimiento</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/65">Lee órdenes con checkout completado, Analytics oficial y WatchCount. No cambia listings, precios, inventario ni órdenes.</p>
        </div>
        <span className={`rounded-full border border-white/15 px-3 py-2 text-xs font-black uppercase ${statusTone(run?.status)}`}>
          {loading ? "cargando" : run?.status ?? dashboard?.status ?? "sin ejecutar"}
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={Boolean(busyMode) || loading}
          onClick={() => void executeDryRun()}
          className="min-h-14 rounded-2xl bg-cyan-200 px-4 font-black text-black disabled:opacity-50"
        >
          {busyMode === "dry_run" ? "Ejecutando dry run…" : "Ejecutar dry run"}
        </button>
        <button
          type="button"
          disabled={Boolean(busyMode) || loading || !dryRunSatisfactory}
          onClick={() => void updatePerformance()}
          aria-describedby="persistent-update-gate"
          className="min-h-14 rounded-2xl bg-emerald-200 px-4 font-black text-black disabled:cursor-not-allowed disabled:opacity-35"
        >
          {busyMode === "persistent" ? "Actualizando rendimiento…" : "Actualizar rendimiento"}
        </button>
      </div>
      <p id="persistent-update-gate" className="mt-2 text-xs leading-5 text-white/55">
        {dryRunSatisfactory
          ? "Dry run reciente y satisfactorio. La actualización persistente requiere confirmación adicional."
          : "Actualizar rendimiento permanece bloqueado hasta completar un dry run satisfactorio en los últimos 30 minutos."}
      </p>

      <section aria-labelledby="dry-run-results-heading" className="mt-4 rounded-2xl border border-cyan-200/25 bg-cyan-200/[0.06] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-cyan-100/60">Modo</p>
            <h3 id="dry-run-results-heading" className="text-lg font-black text-cyan-50">DRY RUN</h3>
          </div>
          <span className={`rounded-full border border-white/15 px-3 py-1 text-[10px] font-black uppercase ${dryRunSatisfactory ? "text-emerald-100" : "text-white/55"}`}>
            {displayedDryRun ? (dryRunSatisfactory ? "satisfactorio" : displayedDryRun.status ?? "requiere revisión") : "sin ejecutar"}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Órdenes leídas</span><strong className="mt-1 block text-lg">{dryRunValue(dryRunMetrics?.officialOrdersRead)}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Line items leídos</span><strong className="mt-1 block text-lg">{dryRunValue(dryRunMetrics?.completedCheckoutLineItems)}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Listings Analytics</span><strong className="mt-1 block text-lg">{dryRunValue(dryRunMetrics?.analyticsListingsRead)}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Listings Watchers</span><strong className="mt-1 block text-lg">{dryRunValue(dryRunMetrics?.watcherListingsRead)}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Persistencia comercial</span><strong className="mt-1 block text-lg">{dryRunMetrics?.commercialDataPersistencePerformed === false ? "NO" : "—"}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Alertas encoladas</span><strong className="mt-1 block text-lg">{dryRunValue(dryRunMetrics?.alertsEnqueued)}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Tareas de fulfillment creadas</span><strong className="mt-1 block text-lg">{dryRunValue(dryRunMetrics?.fulfillmentTasksCreated)}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">WhatsApp entregados</span><strong className="mt-1 block text-lg">{dryRunValue(dryRunMetrics?.whatsappDelivered)}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Escrituras eBay</span><strong className="mt-1 block text-lg">{dryRunValue(dryRunMetrics?.ebayWrites)}</strong></div>
          <div className="rounded-xl bg-black/25 p-2"><span className="text-white/45">Última ejecución</span><strong className="mt-1 block text-xs">{formatDate(displayedDryRun?.completedAt ?? displayedDryRun?.completed_at)}</strong></div>
        </div>

        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          {(["orders", "analytics", "watchers"] as const).map((name) => {
            const recordedError = displayedDryRun?.errors?.find((item) => item.reader === name)?.code
            const readerError = dryRunReaders[name]?.error ?? recordedError
            return <div key={`dry-${name}`} className="rounded-xl border border-white/10 p-2">
              <span className="font-black uppercase text-white/45">{name === "orders" ? "Orders" : name === "analytics" ? "Analytics" : "Watchers"}</span>
              <span className={`mt-1 block break-words font-bold ${readerError ? "text-rose-100" : "text-emerald-100"}`}>
                {readerError ?? (displayedDryRun ? "Sin errores" : "Pendiente")}
              </span>
            </div>
          })}
        </div>

        <div className="mt-3 rounded-xl bg-black/25 p-3 text-sm">
          <span className="text-white/45">Próxima acción</span>
          <p className="mt-1 font-bold text-cyan-50">{displayedDryRun?.nextAction ?? displayedDryRun?.next_action ?? "Ejecutar el dry run seguro."}</p>
        </div>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-2xl bg-black/30 p-3"><span className="text-white/45">Ventas nuevas</span><strong className="mt-1 block text-xl">{value(metrics?.newSales)}</strong></div>
        <div className="rounded-2xl bg-black/30 p-3"><span className="text-white/45">Impresiones</span><strong className="mt-1 block text-xl">{value(analytics?.impressions)}</strong></div>
        <div className="rounded-2xl bg-black/30 p-3"><span className="text-white/45">Vistas</span><strong className="mt-1 block text-xl">{value(analytics?.views)}</strong></div>
        <div className="rounded-2xl bg-black/30 p-3"><span className="text-white/45">Watchers</span><strong className="mt-1 block text-xl">{value(analytics?.watchers)}</strong><span className="mt-1 block text-[10px] text-white/40">señales de interés</span></div>
        <div className="rounded-2xl bg-black/30 p-3"><span className="text-white/45">Transacciones Analytics</span><strong className="mt-1 block text-xl">{value(analytics?.transactions)}</strong><span className="mt-1 block text-[10px] text-white/40">no sustituyen órdenes</span></div>
        <div className="rounded-2xl bg-black/30 p-3"><span className="text-white/45">Alertas</span><strong className="mt-1 block text-xl">{value(metrics?.alertsGenerated)}</strong></div>
        <div className="rounded-2xl bg-black/30 p-3"><span className="text-white/45">Fulfillment</span><strong className="mt-1 block text-xl">{value(health?.fulfillmentTasks)}</strong></div>
        <div className="rounded-2xl bg-black/30 p-3"><span className="text-white/45">Reintentos</span><strong className="mt-1 block text-xl">{value(health?.retries)}</strong></div>
      </div>

      <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
        {(["orders", "analytics", "watchers"] as const).map((name) => (
          <div key={name} className="rounded-2xl border border-white/10 p-3">
            <dt className="font-black uppercase text-white/45">{name === "orders" ? "Órdenes" : name === "analytics" ? "Analytics" : "Watchers"}</dt>
            <dd className={`mt-1 font-black uppercase ${statusTone(readers[name]?.status)}`}>{readers[name]?.status ?? "sin ejecutar"}</dd>
            <dd className="mt-1 break-words text-white/45">{readers[name]?.source ?? "Fuente pendiente"}</dd>
            {readers[name]?.error && <dd className="mt-1 break-words text-rose-100">{readers[name]?.error}</dd>}
          </div>
        ))}
      </dl>

      <details className="mt-4 rounded-2xl border border-white/10 p-3">
        <summary className="cursor-pointer font-black">Salud, errores y próxima acción</summary>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-white/45">Última actualización</dt><dd className="font-bold">{formatDate(run?.completed_at ?? run?.started_at)}</dd></div>
          <div><dt className="text-white/45">Próxima ejecución</dt><dd className="font-bold">{dashboard?.schedule?.enabled ? formatDate(dashboard.nextAutomaticRunAt) : "Scheduler Preview pendiente de activar"}</dd></div>
          <div><dt className="text-white/45">Pendientes de compra</dt><dd className="font-bold">{value(health?.pendingManualPurchase)}</dd></div>
          <div><dt className="text-white/45">Esperando tracking</dt><dd className="font-bold">{value(health?.awaitingTracking)}</dd></div>
          <div><dt className="text-white/45">Alertas fallidas</dt><dd className="font-bold">{value(health?.alertsFailed)}</dd></div>
          <div><dt className="text-white/45">Dead letter</dt><dd className="font-bold">{value(health?.alertsDeadLetter)}</dd></div>
        </dl>
        <p className="mt-3 text-sm leading-6 text-cyan-50">{run?.next_action ?? "Ejecuta la primera actualización controlada."}</p>
        {(run?.errors?.length ?? 0) > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-rose-100">{run?.errors?.map((item, index) => <li key={`${item.code}-${index}`}>{item.reader}: {item.code}{item.retryable ? " · reintentable" : ""}</li>)}</ul>}
      </details>

      {message && <p aria-live="polite" className="mt-3 rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.06] p-3 text-sm text-cyan-50">{message}</p>}
      {error && <p role="alert" className="mt-3 rounded-2xl border border-rose-200/25 bg-rose-200/[0.08] p-3 text-sm text-rose-50">{error}</p>}
    </section>
  )
}
