"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

type RecoveryRow = {
  id: string
  listing_id: string
  sku: string | null
  current_state: string
  current_diagnosis: string
  current_action: string | null
  action_level: number | null
  first_observed_at: string
  last_observed_at: string
  next_evaluation_at: string | null
  impressions: number | null
  views: number | null
  ctr: number | null
  transactions: number | null
  sales_conversion_rate: number | null
  revenue: number | null
  stock_available: number | null
  estimated_margin_percent: number | null
  analytics_last_updated_at: string | null
  analytics_reconciliation_status: string | null
  experiment_status: string | null
  experiment_variable: string | null
  primary_kpi: string | null
  experiment_result: string | null
}

type Dashboard = {
  configuration: Array<{
    enabled: boolean
    shadow_mode: boolean
    scheduler_enabled: boolean
    external_writes_enabled: boolean
    policy_version: string
  }>
  listings: RecoveryRow[]
  metrics: {
    listingsInRecovery: number
    activeExperiments: number
    reusableLearnings: number
    externalWrites: number
  }
}

const QUEUES = [
  ["ALL", "Todos"],
  ["NO_IMPRESSIONS", "Sin impresiones"],
  ["IMPRESSIONS_NO_CLICKS", "Sin clics"],
  ["CLICKS_NO_CONVERSION", "Sin conversión"],
  ["INTEREST_WITHOUT_SALE", "Interesados"],
  ["PROMOTED_NO_RESULT", "Promoción"],
  ["PRICE_NOT_COMPETITIVE", "Precio"],
  ["PERFORMANCE_RECOVERED", "Recuperados"],
  ["PAUSE_OR_RETIRE_RECOMMENDED", "Pausar"],
  ["QUARANTINED_OPTIMIZATION_ERROR", "Errores"],
] as const

function number(value: number | null, suffix = "") {
  return value === null
    ? "N/D"
    : `${new Intl.NumberFormat("es-US", { maximumFractionDigits: 2 })
        .format(value)}${suffix}`
}

function date(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Pendiente"
  return new Intl.DateTimeFormat("es-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function queueMatch(row: RecoveryRow, queue: string) {
  if (queue === "ALL") return true
  if (queue === "PERFORMANCE_RECOVERED") {
    return row.current_state === "PERFORMANCE_RECOVERED"
  }
  if (queue === "PAUSE_OR_RETIRE_RECOMMENDED") {
    return row.current_state === "PAUSE_OR_RETIRE_RECOMMENDED"
  }
  if (queue === "QUARANTINED_OPTIMIZATION_ERROR") {
    return row.current_state === "QUARANTINED_OPTIMIZATION_ERROR"
  }
  return row.current_diagnosis === queue
}

export function ListingRecoveryPanel() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [loadState, setLoadState] =
    useState<"LOADING" | "READY" | "ERROR">("LOADING")
  const [error, setError] = useState("")
  const [queue, setQueue] = useState("ALL")
  const [dryRun, setDryRun] = useState<null | {
    listingCount: number
    diagnosed: number
    quarantined: number
  }>(null)
  const [running, setRunning] = useState(false)

  const load = useCallback(async () => {
    setLoadState("LOADING")
    try {
      const response = await fetch("/api/admin/ebay/listing-recovery", {
        cache: "no-store",
      })
      const payload = await response.json()
      if (!response.ok || payload.success !== true) {
        throw new Error(payload.error ?? "RECOVERY_DASHBOARD_UNAVAILABLE")
      }
      setDashboard(payload.dashboard)
      setError("")
      setLoadState("READY")
    } catch (caught) {
      setError(caught instanceof Error
        ? caught.message : "RECOVERY_DASHBOARD_UNAVAILABLE")
      setLoadState("ERROR")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const runFive = useCallback(async () => {
    setRunning(true)
    try {
      const response = await fetch("/api/admin/ebay/listing-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dry_run_five" }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success !== true) {
        throw new Error(payload.error ?? "RECOVERY_DRY_RUN_FAILED")
      }
      setDryRun(payload.result)
      setError("")
    } catch (caught) {
      setError(caught instanceof Error
        ? caught.message : "RECOVERY_DRY_RUN_FAILED")
    } finally {
      setRunning(false)
    }
  }, [])

  const rows = useMemo(() =>
    (dashboard?.listings ?? []).filter((row) => queueMatch(row, queue)),
  [dashboard?.listings, queue])
  const config = dashboard?.configuration[0]

  return (
    <section
      aria-labelledby="listing-recovery-heading"
      className="overflow-hidden rounded-3xl border border-sky-200/20 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.14),transparent_46%),linear-gradient(145deg,rgba(8,47,73,0.72),rgba(3,7,18,0.96))] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-100/60">
            Recovery &amp; Growth · Shadow
          </p>
          <h3 id="listing-recovery-heading" className="mt-1 text-lg font-black">
            Listings en recuperación
          </h3>
          <p className="mt-2 max-w-xl text-sm leading-6 text-white/65">
            Diagnostica el embudo, prepara un experimento de una variable y
            mide ventas rentables. No modifica eBay.
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-black ${
          config?.enabled
            ? "border-sky-200/40 bg-sky-200/10 text-sky-50"
            : "border-amber-200/40 bg-amber-200/10 text-amber-50"
        }`}>
          {config?.enabled ? "SHADOW ACTIVO" : "DESACTIVADO"}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["En recuperación", dashboard?.metrics.listingsInRecovery ?? 0],
          ["Experimentos", dashboard?.metrics.activeExperiments ?? 0],
          ["Aprendizajes", dashboard?.metrics.reusableLearnings ?? 0],
          ["Escrituras eBay", dashboard?.metrics.externalWrites ?? 0],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-black/25 p-3">
            <p className="text-[10px] font-black uppercase tracking-wide text-white/45">
              {label}
            </p>
            <strong className="mt-1 block text-xl font-black">{value}</strong>
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {QUEUES.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setQueue(value)}
            className={`min-h-10 shrink-0 rounded-full border px-3 text-xs font-black ${
              queue === value
                ? "border-sky-200 bg-sky-200 text-slate-950"
                : "border-white/15 bg-white/[0.04] text-white/65"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loadState === "LOADING" && (
        <p className="mt-4 rounded-2xl border border-white/10 p-4 text-sm text-white/60">
          Cargando recuperación…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-2xl border border-rose-200/30 bg-rose-200/[0.08] p-3 text-sm text-rose-50">
          {error}
        </p>
      )}
      {loadState === "READY" && rows.length === 0 && (
        <p className="mt-4 rounded-2xl border border-emerald-200/20 bg-emerald-200/[0.06] p-4 text-sm text-emerald-50">
          No hay listings en esta cola. El scheduler y las escrituras externas
          permanecen desactivados.
        </p>
      )}

      <div className="mt-4 space-y-3">
        {rows.slice(0, 30).map((row) => (
          <article key={row.id} className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-black">
                  Listing {row.listing_id}
                </p>
                <p className="mt-1 break-all text-xs text-white/45">
                  SKU: {row.sku ?? "N/D"}
                </p>
              </div>
              <span className="rounded-full border border-sky-100/20 px-2 py-1 text-[10px] font-black text-sky-50">
                {row.current_diagnosis.replaceAll("_", " ")}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl bg-white/[0.04] p-2">
                <dt className="text-white/45">Impresiones</dt>
                <dd className="mt-1 font-black">{number(row.impressions)}</dd>
              </div>
              <div className="rounded-xl bg-white/[0.04] p-2">
                <dt className="text-white/45">Vistas / CTR</dt>
                <dd className="mt-1 font-black">{number(row.views)} / {number(row.ctr, "%")}</dd>
              </div>
              <div className="rounded-xl bg-white/[0.04] p-2">
                <dt className="text-white/45">Ventas / Conv.</dt>
                <dd className="mt-1 font-black">{number(row.transactions)} / {number(row.sales_conversion_rate, "%")}</dd>
              </div>
            </dl>
            <div className="mt-3 rounded-xl border border-white/10 p-3 text-xs leading-5">
              <p><strong>Estado:</strong> {row.current_state.replaceAll("_", " ")}</p>
              <p><strong>Acción:</strong> {row.current_action?.replaceAll("_", " ") ?? "Seguir observando"}</p>
              <p><strong>Margen:</strong> {number(row.estimated_margin_percent, "%")} · <strong>Stock:</strong> {number(row.stock_available)}</p>
              <p><strong>Experimento:</strong> {row.experiment_variable?.replaceAll("_", " ") ?? "Ninguno"} · {row.experiment_status ?? "N/D"}</p>
              <p><strong>Próxima evaluación:</strong> {date(row.next_evaluation_at)}</p>
              <p><strong>Fuente Analytics:</strong> {row.analytics_reconciliation_status ?? "N/D"} · {date(row.analytics_last_updated_at)}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void runFive()}
          disabled={running}
          className="min-h-11 rounded-2xl bg-sky-200 px-3 text-sm font-black text-slate-950 disabled:opacity-50"
        >
          {running ? "Simulando…" : "Dry-run de 5"}
        </button>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loadState === "LOADING"}
          className="min-h-11 rounded-2xl border border-sky-100/25 px-3 text-sm font-black disabled:opacity-50"
        >
          Actualizar
        </button>
      </div>
      {dryRun && (
        <p role="status" className="mt-3 rounded-2xl border border-sky-200/20 bg-sky-200/[0.07] p-3 text-xs leading-5 text-sky-50">
          Dry-run: {dryRun.listingCount} listings · {dryRun.diagnosed} diagnosticados · {dryRun.quarantined} aislados · 0 escrituras eBay.
        </p>
      )}
      <p className="mt-3 text-[11px] leading-5 text-white/45">
        CPC, ofertas, precio, título, imágenes, promoción y retiro requieren
        autorización y un ledger canónico. Esta pantalla no expone botones de
        escritura.
      </p>
    </section>
  )
}
