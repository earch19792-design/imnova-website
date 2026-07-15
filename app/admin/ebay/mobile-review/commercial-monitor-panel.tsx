"use client"

import { useCallback, useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"
import {
  getMobileReviewPayloadError,
  getMobileReviewRequestError,
  readMobileReviewJson,
} from "@/lib/ebay/ebay-mobile-review-http"

type Reader = {
  status?: string
  source?: string
  observedAt?: string | null
  error?: string
  metrics?: Record<string, unknown>
}

type Dashboard = {
  status?: string
  latestRun?: {
    status?: string
    started_at?: string
    completed_at?: string | null
    readers?: Record<string, Reader>
    metrics?: {
      activeListings?: number
      officialOrdersRead?: number
      newSales?: number
      fulfillmentTasksCreated?: number
      snapshotsCreated?: number
      alertsGenerated?: number
      analytics?: {
        impressions?: number
        views?: number
        transactions?: number
        watchers?: number
      }
    }
    errors?: Array<{ reader?: string; code?: string; retryable?: boolean }>
    next_action?: string
  } | null
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
  run?: {
    status?: string
    nextAction?: string
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
  return typeof input === "number" ? new Intl.NumberFormat("es-US").format(input) : "0"
}

export function CommercialMonitorPanel() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const request = useCallback(async (run = false) => {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !data.session) throw new Error("AUTH_REQUIRED")
    const response = await fetch("/api/admin/ebay/commercial-monitor", {
      method: run ? "POST" : "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        ...(run ? { "Content-Type": "application/json" } : {}),
      },
      body: run ? JSON.stringify({ action: "run", dryRun: false }) : undefined,
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
      const payload = await request(false)
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

  async function updatePerformance() {
    if (busy) return
    setBusy(true)
    setError("")
    setMessage("Consultando órdenes, Analytics y señales de interés…")
    try {
      const payload = await request(true)
      setDashboard(payload.dashboard ?? null)
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
      setBusy(false)
    }
  }

  const run = dashboard?.latestRun
  const metrics = run?.metrics
  const analytics = metrics?.analytics
  const health = dashboard?.health
  const readers = run?.readers ?? {}

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

      <button
        type="button"
        disabled={busy || loading}
        onClick={() => void updatePerformance()}
        className="mt-4 min-h-14 w-full rounded-2xl bg-emerald-200 px-4 font-black text-black disabled:opacity-50"
      >
        {busy ? "Actualizando rendimiento…" : "Actualizar rendimiento"}
      </button>

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
