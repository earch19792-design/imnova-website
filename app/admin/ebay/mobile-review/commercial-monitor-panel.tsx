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
  formatCommercialMetricValue,
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
  eventsCreated?: number
  alertsGenerated?: number
  alertsEnqueued?: number
  whatsappDelivered?: number
  ebayWrites?: number
  buyerPiiReturned?: boolean
  commercialDataPersistencePerformed?: boolean
  authentication?: {
    ordersOAuth?: string
    watchersAuth?: string
    analyticsAuth?: string
    fulfillmentScopeConfirmed?: boolean
    officialIdentityMatch?: boolean | null
    actionRequired?: string
  }
  analytics?: {
    impressions?: number | null
    views?: number | null
    transactions?: number | null
    watchers?: number | null
  }
}

type MonitorRun = Omit<CommercialMonitorRunView, "metrics"> & {
  metrics?: MonitorMetrics
}

type Dashboard = {
  status?: string
  latestRun?: MonitorRun | null
  lastDryRun?: MonitorRun | null
  lastPersistentRun?: MonitorRun | null
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
  comparison?: SellerHubComparison
}

type AnalyticsAudit = {
  requestedListingIds?: string[]
  returnedListingDimensions?: string[]
  matchedListingIds?: string[]
  unmatchedRequestedListingIds?: string[]
  unexpectedDimensions?: string[]
  queryDimension?: string
  queryTimeZone?: string
  windowStart?: string
  windowEnd?: string
  reportStartDate?: string | null
  reportEndDate?: string | null
  lastUpdatedDate?: string | null
  completenessStatus?: string
  dataFreshnessStatus?: string
  warnings?: string[]
  metrics?: Array<{
    listingId?: string
    impressions?: number | null
    views?: number | null
    transactions?: number | null
    ctr?: number | null
  }>
}

type SellerHubComparison = {
  classification?: string
  explanation?: string
  sellerHubEvidence?: {
    impressions?: number
    views?: number
    transactions?: number
    ctr?: number
    calculatedCtr?: number | null
  }
  operational?: AnalyticsAudit
  comparison?: AnalyticsAudit
  accountDiagnostic?: AnalyticsAudit
  safety?: {
    persistencePerformed?: boolean
    alertsGenerated?: number
    fulfillmentTasksCreated?: number
    whatsappDelivered?: number
    ebayWrites?: number
    buyerPiiReturned?: boolean
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
  return formatCommercialMetricValue(input)
}

function list(value: string[] | undefined) {
  return value?.length ? value.join(", ") : "—"
}

function authLabel(status: string | undefined) {
  if (status === "CLIENT_CREDENTIAL_MISMATCH") return "CLIENT_MISMATCH"
  return status ?? "PENDIENTE"
}

function AnalyticsWindowAudit({ label, audit }: { label: string; audit?: AnalyticsAudit }) {
  const row = audit?.metrics?.[0]
  const metric = (input: number | null | undefined, suffix = "") =>
    typeof input === "number" && Number.isFinite(input)
      ? `${new Intl.NumberFormat("es-US", { maximumFractionDigits: 2 }).format(input)}${suffix}`
      : audit?.dataFreshnessStatus === "REPORT_NOT_UPDATED_YET"
        ? "Pendiente de actualización eBay"
        : "—"
  return <article className="rounded-2xl border border-white/10 bg-black/20 p-3">
    <h4 className="font-black text-cyan-50">{label}</h4>
    <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
      <div><span className="text-white/45">Impresiones</span><strong className="mt-1 block">{metric(row?.impressions)}</strong></div>
      <div><span className="text-white/45">Vistas</span><strong className="mt-1 block">{metric(row?.views)}</strong></div>
      <div><span className="text-white/45">Transacciones</span><strong className="mt-1 block">{metric(row?.transactions)}</strong></div>
      <div><span className="text-white/45">CTR</span><strong className="mt-1 block">{metric(row?.ctr, "%")}</strong></div>
    </div>
    <dl className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2">
      <div><dt className="text-white/45">requestedListingIds</dt><dd className="break-all font-mono">{list(audit?.requestedListingIds)}</dd></div>
      <div><dt className="text-white/45">returnedListingDimensions</dt><dd className="break-all font-mono">{list(audit?.returnedListingDimensions)}</dd></div>
      <div><dt className="text-white/45">matchedListingIds</dt><dd className="break-all font-mono">{list(audit?.matchedListingIds)}</dd></div>
      <div><dt className="text-white/45">unmatchedRequestedListingIds</dt><dd className="break-all font-mono">{list(audit?.unmatchedRequestedListingIds)}</dd></div>
      <div><dt className="text-white/45">unexpectedDimensions</dt><dd className="break-all font-mono">{list(audit?.unexpectedDimensions)}</dd></div>
      <div><dt className="text-white/45">queryDimension</dt><dd className="font-black">{audit?.queryDimension ?? "—"}</dd></div>
      <div><dt className="text-white/45">queryTimeZone</dt><dd className="font-black">{audit?.queryTimeZone ?? "—"}</dd></div>
      <div><dt className="text-white/45">windowStart / windowEnd</dt><dd>{audit?.windowStart ?? "—"} / {audit?.windowEnd ?? "—"}</dd></div>
      <div><dt className="text-white/45">reportStartDate / reportEndDate</dt><dd>{audit?.reportStartDate ?? "—"} / {audit?.reportEndDate ?? "—"}</dd></div>
      <div><dt className="text-white/45">lastUpdatedDate</dt><dd>{audit?.lastUpdatedDate ?? "—"}</dd></div>
      <div><dt className="text-white/45">completenessStatus</dt><dd className="font-black uppercase">{audit?.completenessStatus ?? "—"}</dd></div>
      <div><dt className="text-white/45">dataFreshnessStatus</dt><dd className="font-black uppercase">{audit?.dataFreshnessStatus ?? "—"}</dd></div>
      <div><dt className="text-white/45">warnings</dt><dd>{list(audit?.warnings)}</dd></div>
    </dl>
  </article>
}

export function CommercialMonitorPanel() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [busyMode, setBusyMode] = useState<"dry_run" | "persistent" | "comparison" | null>(null)
  const [dryRunResult, setDryRunResult] = useState<MonitorRun | null>(null)
  const [comparison, setComparison] = useState<SellerHubComparison | null>(null)
  const [gateNow, setGateNow] = useState(0)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const request = useCallback(async (
    mode?: "dry_run" | "persistent",
    authorizedDryRunId?: string,
  ) => {
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
        ? JSON.stringify(buildCommercialMonitorRunRequest(
            mode === "dry_run",
            authorizedDryRunId,
          ))
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

  const compareWithSellerHub = useCallback(async () => {
    if (busyMode) return
    setBusyMode("comparison")
    setError("")
    setMessage("Comparando dos ventanas oficiales sin persistencia comercial…")
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !data.session) throw new Error("AUTH_REQUIRED")
      const response = await fetch("/api/admin/ebay/commercial-monitor", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "compare_seller_hub" }),
      })
      const payload = await readMobileReviewJson<Payload>(
        response,
        "No se pudo comparar Analytics con Seller Hub",
      )
      if (!payload.success || !payload.comparison) {
        throw new Error(getMobileReviewPayloadError(payload, "EBAY_ANALYTICS_COMPARISON_FAILED"))
      }
      setComparison(payload.comparison)
      setMessage(payload.comparison.explanation ?? "Comparación read-only completada.")
    } catch (requestError) {
      setError(getMobileReviewRequestError(
        requestError,
        "No se pudo completar la comparación oficial.",
      ))
    } finally {
      setBusyMode(null)
    }
  }, [busyMode])

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
      const dryRunId = displayedDryRun?.runId ?? displayedDryRun?.id
      if (!dryRunId) throw new Error("COMMERCIAL_DRY_RUN_GATE_REQUIRED")
      const payload = await request("persistent", dryRunId)
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

  const run = dashboard?.lastPersistentRun ??
    (dashboard?.latestRun?.metrics?.dryRun === true ? null : dashboard?.latestRun)
  const metrics = run?.metrics
  const analytics = metrics?.analytics
  const health = dashboard?.health
  const readers: Record<string, CommercialMonitorReaderView> = run?.readers ?? {}
  const displayedDryRun = dryRunResult ?? dashboard?.lastDryRun ??
    (dashboard?.latestRun?.metrics?.dryRun === true ? dashboard.latestRun : null)
  const dryRunMetrics = displayedDryRun?.metrics
  const dryRunReaders: Record<string, CommercialMonitorReaderView> = displayedDryRun?.readers ?? {}
  const dryRunAuthentication = dryRunMetrics?.authentication
  const dryRunSatisfactory = gateNow > 0
    && isSatisfactoryCommercialDryRun(displayedDryRun, gateNow)
  const dryRunConsumedAt = displayedDryRun?.consumedAt ?? displayedDryRun?.dry_run_consumed_at
  const dryRunWasSatisfactory = displayedDryRun?.satisfactory === true ||
    displayedDryRun?.dry_run_satisfactory === true || dryRunSatisfactory || Boolean(dryRunConsumedAt)
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
          : dryRunConsumedAt
            ? "Dry run anterior consumido. Ejecuta un dry run nuevo antes de otra actualización."
            : "Actualizar rendimiento permanece bloqueado hasta completar un dry run satisfactorio en los últimos 30 minutos."}
      </p>

      <section aria-labelledby="dry-run-results-heading" className="mt-4 rounded-2xl border border-cyan-200/25 bg-cyan-200/[0.06] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-cyan-100/60">Modo</p>
            <h3 id="dry-run-results-heading" className="text-lg font-black text-cyan-50">DRY RUN</h3>
          </div>
          <span className={`rounded-full border border-white/15 px-3 py-1 text-[10px] font-black uppercase ${dryRunSatisfactory ? "text-emerald-100" : "text-white/55"}`}>
            {displayedDryRun
              ? dryRunConsumedAt
                ? "consumido"
                : dryRunSatisfactory
                  ? "satisfactorio"
                  : displayedDryRun.status ?? "requiere revisión"
              : "sin ejecutar"}
          </span>
        </div>

        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-xl border border-white/10 p-2"><dt className="text-white/45">Status</dt><dd className="mt-1 font-black uppercase">{displayedDryRun?.status ?? "sin ejecutar"}</dd></div>
          <div className="rounded-xl border border-white/10 p-2"><dt className="text-white/45">Completed at</dt><dd className="mt-1 font-black">{formatDate(displayedDryRun?.completedAt ?? displayedDryRun?.completed_at)}</dd></div>
          <div className="rounded-xl border border-white/10 p-2"><dt className="text-white/45">Satisfactory</dt><dd className="mt-1 font-black">{displayedDryRun ? (dryRunWasSatisfactory ? "SÍ" : "NO") : "—"}</dd></div>
          <div className="rounded-xl border border-white/10 p-2"><dt className="text-white/45">Consumed at</dt><dd className="mt-1 font-black">{dryRunConsumedAt ? formatDate(dryRunConsumedAt) : "—"}</dd></div>
          <div className="rounded-xl border border-white/10 p-2 sm:col-span-4"><dt className="text-white/45">Authorized persistent run ID</dt><dd className="mt-1 break-all font-mono text-[11px]">{displayedDryRun?.authorizedPersistentRunId ?? displayedDryRun?.authorized_persistent_run_id ?? "—"}</dd></div>
        </dl>

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

        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-5">
          <div className="rounded-xl border border-white/10 p-2">
            <dt className="text-white/45">Orders OAuth</dt>
            <dd className="mt-1 break-words font-black text-cyan-50">{authLabel(dryRunReaders.orders?.auth?.status ?? dryRunAuthentication?.ordersOAuth)}</dd>
          </div>
          <div className="rounded-xl border border-white/10 p-2">
            <dt className="text-white/45">Watchers auth</dt>
            <dd className="mt-1 break-words font-black text-cyan-50">{authLabel(dryRunReaders.watchers?.auth?.status ?? dryRunAuthentication?.watchersAuth)}</dd>
          </div>
          <div className="rounded-xl border border-white/10 p-2">
            <dt className="text-white/45">Analytics auth</dt>
            <dd className="mt-1 break-words font-black text-cyan-50">{authLabel(dryRunReaders.analytics?.auth?.status ?? dryRunAuthentication?.analyticsAuth)}</dd>
          </div>
          <div className="rounded-xl border border-white/10 p-2">
            <dt className="text-white/45">Scope fulfillment confirmado</dt>
            <dd className="mt-1 font-black text-cyan-50">{dryRunAuthentication ? (dryRunAuthentication.fulfillmentScopeConfirmed ? "SÍ" : "NO") : "PENDIENTE"}</dd>
          </div>
          <div className="rounded-xl border border-white/10 p-2">
            <dt className="text-white/45">Identidad oficial</dt>
            <dd className="mt-1 font-black text-cyan-50">{dryRunAuthentication?.officialIdentityMatch === true ? "MATCH" : dryRunAuthentication?.officialIdentityMatch === false ? "NO MATCH" : "PENDIENTE"}</dd>
          </div>
        </dl>

        <div className="mt-3 rounded-xl bg-black/25 p-3 text-sm">
          <span className="text-white/45">Próxima acción</span>
          <p className="mt-1 font-bold text-cyan-50">{dryRunAuthentication?.actionRequired ?? displayedDryRun?.nextAction ?? displayedDryRun?.next_action ?? "Ejecutar el dry run seguro."}</p>
        </div>
      </section>

      <section aria-labelledby="persistent-run-heading" className="mt-4 rounded-2xl border border-emerald-200/25 bg-emerald-200/[0.06] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-100/60">Última actualización persistente</p>
            <h3 id="persistent-run-heading" className="text-lg font-black text-emerald-50">
              Última actualización: {run ? (run.status === "completed" ? "COMPLETADA" : run.status?.toUpperCase()) : "PENDIENTE"}
            </h3>
          </div>
          {dryRunConsumedAt && <span className="rounded-full border border-white/15 px-3 py-1 text-[10px] font-black uppercase text-cyan-100">Dry run anterior: CONSUMIDO</span>}
        </div>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/45">Completed at</dt><dd className="mt-1 font-black">{formatDate(run?.completedAt ?? run?.completed_at)}</dd></div>
          <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/45">Snapshots creados</dt><dd className="mt-1 text-lg font-black">{value(metrics?.snapshotsCreated)}</dd></div>
          <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/45">Eventos creados</dt><dd className="mt-1 text-lg font-black">{value(metrics?.eventsCreated)}</dd></div>
          <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/45">Alertas generadas</dt><dd className="mt-1 text-lg font-black">{value(metrics?.alertsGenerated)}</dd></div>
          <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/45">WhatsApp delivered</dt><dd className="mt-1 text-lg font-black">{value(metrics?.whatsappDelivered)}</dd></div>
          <div className="rounded-xl bg-black/25 p-2 sm:col-span-3"><dt className="text-white/45">Próxima acción</dt><dd className="mt-1 font-black text-emerald-50">{run?.nextAction ?? run?.next_action ?? "Ejecuta un dry run nuevo antes de otra actualización."}</dd></div>
        </dl>
        {run && dryRunConsumedAt && <p className="mt-3 text-xs font-bold text-cyan-50">Ejecuta un dry run nuevo antes de otra actualización.</p>}
      </section>

      <section aria-labelledby="seller-hub-comparison-heading" className="mt-4 rounded-2xl border border-violet-200/25 bg-violet-200/[0.05] p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-violet-100/60">Diagnóstico oficial · listing 366543596425</p>
            <h3 id="seller-hub-comparison-heading" className="text-lg font-black">Comparar con Seller Hub</h3>
            <p className="mt-1 text-xs text-white/55">Compara 7 días cerrados contra hasta 90 días. No persiste snapshots, reglas, alertas ni WhatsApp.</p>
          </div>
          <button
            type="button"
            disabled={Boolean(busyMode) || loading}
            onClick={() => void compareWithSellerHub()}
            className="min-h-12 rounded-2xl border border-violet-100/30 bg-violet-100 px-4 font-black text-black disabled:opacity-50"
          >
            {busyMode === "comparison" ? "Comparando…" : "Comparar con Seller Hub"}
          </button>
        </div>
        {comparison && <>
          <div className="mt-3 rounded-xl bg-black/25 p-3">
            <span className="text-[10px] font-black uppercase text-white/45">Clasificación</span>
            <p className="mt-1 text-lg font-black text-violet-50">{comparison.classification ?? "INSUFFICIENT_EVIDENCE"}</p>
            <p className="mt-1 text-xs leading-5 text-white/65">{comparison.explanation}</p>
            <p className="mt-2 text-xs text-white/50">CTR Seller Hub validado: {comparison.sellerHubEvidence?.calculatedCtr === 5.56 ? "1 / 18 × 100 = 5.56% (5.6% UI)" : "—"}</p>
          </div>
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            <AnalyticsWindowAudit label="A · Ventana operativa · 7 días cerrados" audit={comparison.operational} />
            <AnalyticsWindowAudit label="B · Ventana diagnóstica · hasta 90 días" audit={comparison.comparison} />
            <AnalyticsWindowAudit label="C · Cuenta por día · sólo diagnóstico" audit={comparison.accountDiagnostic} />
          </div>
          <p className="mt-3 text-xs font-bold text-emerald-100">
            Persistencia: {comparison.safety?.persistencePerformed === false ? "NO" : "—"} · Alertas: {value(comparison.safety?.alertsGenerated)} · Fulfillment: {value(comparison.safety?.fulfillmentTasksCreated)} · WhatsApp: {value(comparison.safety?.whatsappDelivered)} · Escrituras eBay: {value(comparison.safety?.ebayWrites)}
          </p>
        </>}
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
