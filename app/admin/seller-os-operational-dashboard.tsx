"use client"

import { FormEvent, useCallback, useEffect, useMemo, useState } from
  "react"

import { supabase } from "@/lib/supabase"
import { parseOwnerRuntimeQuickPickCard,
  parseOwnerRuntimeQuickPickReceipt, useAdminOwnerRuntime,
  type OwnerRuntimeQuickPickCard, type OwnerRuntimeQuickPickReceipt,
  type OwnerRuntimeQuickPickStageState } from
  "./admin-owner-runtime-provider"

type CompactStatus = "READY" | "WORKING" | "WAITING" | "DEGRADED" |
  "OFFLINE"
type WorkerStatus = CompactStatus | "CONNECTING"

type DashboardSnapshot = Readonly<{
  radarReady: number
  radarReview: number
  radarAvailable: boolean
  liveAttention: number
  liveAttentionAvailable: boolean
  stockGuard: CompactStatus
  nightRadar: CompactStatus
  analytics: CompactStatus
  orders: CompactStatus
  activeListings: number | null
  impressions: number | null
  views: number | null
  ctr: number | null
  quantitySold: number | null
  officialOrders: number | null
  analyticsDataStatus: "AVAILABLE_CURRENT" | "AVAILABLE_STALE" |
    "UNAVAILABLE"
  analyticsSnapshotCapturedAt: string | null
  stockScopeCount: number | null
  stockCertifiedCount: number | null
  stockFreshCount: number | null
  stockStaleCount: number | null
  stockUnknownCount: number | null
  stockRiskCount: number | null
  ordersSourceStatus: string
  ordersLastSuccessfulReadAt: string | null
}>

const emptySnapshot: DashboardSnapshot = {
  radarReady: 0,
  radarReview: 0,
  radarAvailable: false,
  liveAttention: 0,
  liveAttentionAvailable: false,
  stockGuard: "WAITING",
  nightRadar: "WAITING",
  analytics: "WAITING",
  orders: "WAITING",
  activeListings: null,
  impressions: null,
  views: null,
  ctr: null,
  quantitySold: null,
  officialOrders: null,
  analyticsDataStatus: "UNAVAILABLE",
  analyticsSnapshotCapturedAt: null,
  stockScopeCount: null,
  stockCertifiedCount: null,
  stockFreshCount: null,
  stockStaleCount: null,
  stockUnknownCount: null,
  stockRiskCount: null,
  ordersSourceStatus: "UNPROVEN",
  ordersLastSuccessfulReadAt: null,
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function safeCount(value: unknown) {
  const count = Number(value)
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0
}

function availableMetric(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return null
  if (typeof value === "string" && value.trim() === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function compactStatus(value: unknown,
  fallback: CompactStatus = "DEGRADED"): CompactStatus {
  const normalized = String(value ?? "").toUpperCase()
  return new Set<CompactStatus>(["READY", "WORKING", "WAITING", "DEGRADED",
    "OFFLINE"]).has(normalized as CompactStatus)
    ? normalized as CompactStatus : fallback
}

function normalizedStatus(value: unknown,
  unavailable: CompactStatus = "DEGRADED"): CompactStatus {
  const status = String(value ?? "").toUpperCase()
  if (!status) return "WAITING"
  if (/RUNNING|PROCESSING|CAPTURING|IN_PROGRESS|STARTED|CLAIMED/.test(status)) {
    return "WORKING"
  }
  if (/READY|AVAILABLE|ACTIVE|PASS|COMPLETED|SUCCESS|IDLE|HEALTHY/.test(status)) {
    return "READY"
  }
  if (/WAIT|PENDING|PAUSED|NEVER_RUN|UNPROVEN|NOT_CONFIGURED/.test(status)) {
    return "WAITING"
  }
  if (/OFFLINE|DISCONNECTED|MISSING_EXTENSION/.test(status)) return "OFFLINE"
  if (/429|DEGRADED|UNAVAILABLE|FAILED|ERROR|BLOCKED|EXPIRED/.test(status)) {
    return unavailable
  }
  return "WAITING"
}

function tone(status: WorkerStatus) {
  if (status === "READY") return "bg-emerald-300 text-emerald-950"
  if (status === "WORKING") return "bg-cyan-300 text-cyan-950"
  if (status === "CONNECTING") return "bg-sky-200 text-sky-950"
  if (status === "WAITING") return "bg-amber-200 text-amber-950"
  if (status === "DEGRADED") return "bg-orange-300 text-orange-950"
  return "bg-rose-300 text-rose-950"
}

function StatusPill({ status }: { status: WorkerStatus }) {
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${tone(status)}`}>
    {status}
  </span>
}

function metricLabel(value: number | null, suffix = "") {
  return value === null ? "—" : `${new Intl.NumberFormat("es-NI", {
    maximumFractionDigits: suffix ? 2 : 0,
  }).format(value)}${suffix}`
}

function shortTimestamp(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—"
  return new Intl.DateTimeFormat("es-NI", {
    dateStyle: "short", timeStyle: "short",
  }).format(new Date(value))
}

function workerDetail(status: WorkerStatus, reasonCode: string) {
  if (status === "READY") return "Chrome owner conectado · sin trabajo pendiente"
  if (status === "WORKING") return "Procesando una evidencia de envío"
  if (status === "CONNECTING") return "Conectando con Chrome owner…"
  if (reasonCode.includes("BIND") || reasonCode.includes("DESTINATION")) {
    return "Falta confirmar el perfil canónico de envío"
  }
  if (status === "OFFLINE") return "Extensión o Chrome owner no disponible"
  return "Esperando una condición requerida del worker"
}

const QUICK_PICK_STAGES = [
  ["IDENTITY", "Identidad"],
  ["DUPLICATE", "Duplicado"],
  ["STOCK", "Stock"],
  ["DEMAND", "Demanda"],
  ["SHIPPING", "Shipping"],
  ["ECONOMICS", "Economics"],
  ["PRODUCT_TRUTH", "Product Truth"],
  ["LISTING_PACKAGE", "Marketplace prep"],
  ["REQUIRED_SPECIFICS", "Required specifics"],
  ["MARKETPLACE_READINESS", "Marketplace readiness"],
  ["LISTING_READY", "Ready"],
] as const

function quickPickStageTone(state: OwnerRuntimeQuickPickStageState) {
  if (state === "PASS") return "bg-emerald-200/15 text-emerald-50"
  if (state === "RUNNING") return "bg-cyan-200/15 text-cyan-50"
  if (state === "BLOCKED") return "bg-amber-200/15 text-amber-50"
  return "bg-white/[0.04] text-white/45"
}

function quickPickStageLabel(card: OwnerRuntimeQuickPickCard) {
  if (card.exactBlocker?.startsWith(
    "MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN")) {
    return "Required specifics"
  }
  if (card.exactBlocker?.startsWith("MARKETPLACE_CONDITION_NOT_READY")) {
    return "Marketplace readiness"
  }
  return QUICK_PICK_STAGES.find(([key]) => key === card.lastStage)?.[1] ??
    card.lastStage.replaceAll("_", " ")
}

function quickPickBlockerLabel(value: string | null) {
  if (!value) return "Sin blocker"
  if (value.startsWith("MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN")) {
    return "Faltan datos requeridos por eBay"
  }
  if (value.startsWith("MARKETPLACE_CONDITION_NOT_READY")) {
    return "Falta demostrar la condición para eBay"
  }
  return value.replaceAll("_", " ")
}

function mergeQuickPickCards(current: readonly OwnerRuntimeQuickPickCard[],
  incoming: readonly OwnerRuntimeQuickPickCard[]) {
  const key = (card: OwnerRuntimeQuickPickCard) => card.candidateKey ??
    card.sourceUrl
  const merged = new Map(current.map((card) => [key(card), card]))
  incoming.forEach((card) => merged.set(key(card), card))
  return [...merged.values()]
}

export function SellerOsOperationalDashboard() {
  const ownerRuntime = useAdminOwnerRuntime()
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(emptySnapshot)
  const [input, setInput] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState("")
  const [submittedQuickPickReceipt, setSubmittedQuickPickReceipt] =
    useState<OwnerRuntimeQuickPickReceipt | null>(null)
  const [submittedQuickPickCards, setSubmittedQuickPickCards] = useState<
    readonly OwnerRuntimeQuickPickCard[]>([])

  const adminRequest = useCallback(async (path: string, init?: RequestInit) => {
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session) throw new Error("ADMIN_AUTH_REQUIRED")
    const response = await fetch(path, {
      ...init,
      cache: "no-store",
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${data.session.access_token}`,
      },
    })
    const payload = await response.json()
    if (!response.ok || payload.success !== true) {
      throw new Error(String(payload.error ?? "SELLER_OS_DASHBOARD_READ_FAILED"))
    }
    return payload
  }, [])

  const load = useCallback(async () => {
    const [commercialResult, radarResult] =
      await Promise.allSettled([
        adminRequest(
          "/api/admin/ebay/commercial-monitor?dashboardHealthOnly=1",
        ),
        adminRequest("/api/admin/ebay/luna-opportunity-queue"),
      ])

    const commercialPayload = commercialResult.status === "fulfilled"
      ? record(commercialResult.value) : {}
    const commercial = record(commercialPayload.dashboard)
    const commercialHealth = record(commercialPayload.commercialHealth)
    const stockHealth = record(commercialHealth.stockGuard)
    const orderHealth = record(commercialHealth.orders)
    const analyticsHealth = record(commercialHealth.analytics)
    const liveListingIds = new Set<string>()
    for (const value of [commercial.supplyActions,
      commercial.optimizationTasks]) {
      for (const item of Array.isArray(value) ? value : []) {
        const listingId = record(item).listingId
        if (typeof listingId === "string" && listingId) {
          liveListingIds.add(listingId)
        }
      }
    }

    const radarPayload = radarResult.status === "fulfilled"
      ? record(radarResult.value) : {}
    const radar = record(radarPayload.dashboard)
    const radarSummary = record(radar.summary)
    const runs = Array.isArray(radar.runs) ? radar.runs : []
    const latestRadarRun = record(runs[0])
    for (const item of Array.isArray(radar.activeListingRisks)
      ? radar.activeListingRisks : []) {
      const risk = record(item)
      const listingId = risk.listingId ?? risk.listing_id
      if (typeof listingId === "string" && listingId) {
        liveListingIds.add(listingId)
      }
    }

    setSnapshot({
      radarReady: safeCount(radarSummary.ready),
      radarReview: safeCount(radarSummary.review),
      radarAvailable: radarResult.status === "fulfilled",
      liveAttention: liveListingIds.size,
      liveAttentionAvailable: commercialResult.status === "fulfilled" ||
        radarResult.status === "fulfilled",
      stockGuard: commercialResult.status === "rejected" ? "DEGRADED"
        : compactStatus(stockHealth.dashboardStatus),
      nightRadar: radarResult.status === "rejected" ? "DEGRADED"
        : normalizedStatus(latestRadarRun.status ?? radar.status),
      analytics: commercialResult.status === "rejected" ? "DEGRADED"
        : compactStatus(analyticsHealth.dashboardStatus),
      orders: commercialResult.status === "rejected" ? "DEGRADED"
        : compactStatus(orderHealth.dashboardStatus),
      activeListings: commercialResult.status === "fulfilled"
        ? availableMetric(commercialHealth.activeListings) : null,
      impressions: availableMetric(analyticsHealth.impressions),
      views: availableMetric(analyticsHealth.views),
      ctr: availableMetric(analyticsHealth.ctr),
      quantitySold: availableMetric(analyticsHealth.quantitySold),
      officialOrders: availableMetric(orderHealth.officialOrderCount),
      analyticsDataStatus: new Set(["AVAILABLE_CURRENT", "AVAILABLE_STALE"])
        .has(String(analyticsHealth.snapshotDataStatus))
        ? analyticsHealth.snapshotDataStatus as
          "AVAILABLE_CURRENT" | "AVAILABLE_STALE" : "UNAVAILABLE",
      analyticsSnapshotCapturedAt:
        typeof analyticsHealth.snapshotCapturedAt === "string"
          ? analyticsHealth.snapshotCapturedAt : null,
      stockScopeCount: availableMetric(stockHealth.scopeCount),
      stockCertifiedCount: availableMetric(stockHealth.certifiedCount),
      stockFreshCount: availableMetric(stockHealth.freshCount),
      stockStaleCount: availableMetric(stockHealth.staleCount),
      stockUnknownCount: availableMetric(stockHealth.unknownCount),
      stockRiskCount: availableMetric(stockHealth.riskCount),
      ordersSourceStatus: String(orderHealth.sourceStatus ?? "UNPROVEN"),
      ordersLastSuccessfulReadAt:
        typeof orderHealth.lastSuccessfulReadAt === "string"
          ? orderHealth.lastSuccessfulReadAt : null,
    })
  }, [adminRequest])

  useEffect(() => {
    let active = true
    void load().catch(() => undefined)
    const timer = window.setInterval(() => {
      if (active) void load().catch(() => undefined)
    }, 15_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [load])

  async function submitQuickPick(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const urls = input.split(/\r?\n/).map((value) => value.trim())
      .filter(Boolean).slice(0, 20)
    if (!urls.length || submitting) return
    setSubmitting(true)
    setFeedback(`${urls.length} links recibidos · registrando lote…`)
    try {
      const received = await adminRequest("/api/admin/ebay/luna-quick-pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RECEIVE", urls }),
      })
      const receipt = record(received.receipt)
      setSubmittedQuickPickReceipt(
        parseOwnerRuntimeQuickPickReceipt(received.receipt))
      setSubmittedQuickPickCards((Array.isArray(receipt.cards)
        ? receipt.cards : []).flatMap((value) => {
        const parsed = parseOwnerRuntimeQuickPickCard(value)
        return parsed ? [parsed] : []
      }))
      setInput("")
      setFeedback(`Lote recibido · ${String(receipt.ownerReference)}`)
      void ownerRuntime.refreshQuickPicks().catch(() => undefined)
      void adminRequest("/api/admin/ebay/luna-quick-pick", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "PROCESS", batchId: receipt.batchId,
          urls, selectedVariants: {} }),
      }).then((payload) => {
        setSubmittedQuickPickReceipt(
          parseOwnerRuntimeQuickPickReceipt(payload.receipt))
        void ownerRuntime.refreshQuickPicks().catch(() => undefined)
      }).catch(() => setFeedback(
        "Lote recibido · reconciliando el progreso durable"))
    } catch {
      setFeedback("No pude registrar el lote · reintentando cuando vuelvas a procesar")
    } finally {
      setSubmitting(false)
    }
  }

  const opportunitiesReady = ownerRuntime.quickPick.readyForReview +
    snapshot.radarReady
  const opportunityDataAvailable = ownerRuntime.quickPickAvailable ||
    snapshot.radarAvailable
  const health = useMemo(() => [
    ["LUNA_SHIPPING_WORKER", ownerRuntime.lunaWorker.status],
    ["STOCK_GUARD", snapshot.stockGuard],
    ["NIGHT_RADAR", snapshot.nightRadar],
    ["ANALYTICS", snapshot.analytics],
    ["ORDERS", snapshot.orders],
  ] as const, [ownerRuntime.lunaWorker.status, snapshot])
  const quickPickReceipt = submittedQuickPickReceipt &&
    ownerRuntime.quickPickReceipt?.ownerReference !==
      submittedQuickPickReceipt.ownerReference
    ? submittedQuickPickReceipt
    : ownerRuntime.quickPickReceipt ?? submittedQuickPickReceipt
  const quickPickCards = useMemo(() => mergeQuickPickCards(
    submittedQuickPickCards, ownerRuntime.quickPickCards),
  [ownerRuntime.quickPickCards, submittedQuickPickCards])

  return <>
    <div className="grid gap-4 md:grid-cols-2" data-primary-dashboard-block-count="4">
      <section data-dashboard-block="opportunities" className="rounded-3xl border border-emerald-200/20 bg-emerald-200/[0.06] p-5">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100/65">💰 Oportunidades para publicar</p>
        <div className="mt-3 flex items-end justify-between gap-4">
          <div><p className="text-4xl font-black">{opportunityDataAvailable ? opportunitiesReady : "—"}</p><p className="mt-1 text-sm text-white/55">{ownerRuntime.quickPickAvailable && snapshot.radarAvailable ? "listas para revisar" : "lectura parcial"}</p></div>
          <a href="/admin/ebay/opportunity-queue/research" className="inline-flex min-h-11 items-center rounded-2xl border border-emerald-100/20 px-4 text-sm font-black text-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-200">Revisar</a>
        </div>
        <p className="mt-4 text-sm text-white/55">Quick Pick {ownerRuntime.quickPickAvailable ? ownerRuntime.quickPick.readyForReview : "—"} · Radar {snapshot.radarAvailable ? snapshot.radarReady : "—"} · En revisión {snapshot.radarAvailable ? snapshot.radarReview : "—"}</p>
      </section>

      <section data-dashboard-block="quick-pick" className="rounded-3xl border border-cyan-200/25 bg-cyan-200/[0.07] p-5">
        <div><p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/65">⚡ Quick Pick Luna</p><h2 className="mt-1 text-xl font-black">Pega links y sigue trabajando</h2></div>
        <form onSubmit={submitQuickPick} className="mt-3 flex gap-2">
          <label className="sr-only" htmlFor="dashboard-quick-pick-input">Pegar uno o varios links Luna</label>
          <textarea id="dashboard-quick-pick-input" value={input}
            onChange={(event) => setInput(event.target.value)} rows={2}
            placeholder="Pega uno o varios links Luna, uno por línea"
            className="min-h-14 min-w-0 flex-1 resize-none rounded-2xl border border-white/15 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-white/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200" />
          <button type="submit" disabled={submitting || !input.trim()}
            className="min-h-11 min-w-24 rounded-2xl bg-cyan-200 px-4 text-sm font-black text-black disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200">{submitting ? "Procesando…" : "Procesar"}</button>
        </form>
        {quickPickReceipt && <section aria-live="polite"
          data-quick-pick-inline-receipt={quickPickReceipt.ownerReference}
          className="mt-3 rounded-2xl border border-emerald-200/20 bg-emerald-200/[0.06] p-3 text-emerald-50">
          <strong className="text-sm">LOTE RECIBIDO · {quickPickReceipt.ownerReference}</strong>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-center sm:grid-cols-4 lg:grid-cols-7">
            {([
              ["Recibidos", quickPickReceipt.rawInputCount],
              ["Materializados", quickPickReceipt.durableOperationCount],
              ["No comprobados", quickPickReceipt.unprovenInputCount],
              ["Trabajando", ownerRuntime.quickPickAvailable
                ? ownerRuntime.quickPick.inProgress : null],
              ["Bloqueados", ownerRuntime.quickPickAvailable
                ? ownerRuntime.quickPick.blocked : null],
              ["Listos", ownerRuntime.quickPickAvailable
                ? ownerRuntime.quickPick.readyForReview : null],
              ["Receipt", quickPickReceipt.ownerReference],
            ] as const).map(([label, value]) => <div key={label}
              className="rounded-xl bg-black/20 px-2 py-2">
              <dt className="text-[10px] font-bold uppercase tracking-wide text-white/45">{label}</dt>
              <dd className="mt-1 truncate text-sm font-black">{value ?? "—"}</dd>
            </div>)}
          </dl>
        </section>}
        <p aria-live="polite" className="mt-3 text-sm text-white/60">{feedback || (ownerRuntime.quickPickAvailable ? `${ownerRuntime.quickPick.inProgress} en proceso · ${ownerRuntime.quickPick.readyForReview} para revisar · ${ownerRuntime.quickPick.blocked} bloqueados` : "No pude cargar el estado del lote · reintentando")}</p>
        <div className="mt-3 space-y-2" data-quick-pick-inline-operation-view>
          {quickPickCards.map((card) => <details
            key={card.candidateKey ?? card.sourceUrl}
            data-quick-pick-inline-card
            className="group rounded-2xl border border-white/10 bg-black/20 p-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-start justify-between gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">
              <div className="min-w-0">
                <p className="truncate text-sm font-black">{card.title ?? "Producto Luna"}</p>
                <p className="mt-1 truncate text-xs text-white/50">{card.sourceSku ?? "Identificando…"} · {card.disposition}</p>
                <p className="mt-1 text-xs text-white/65">Etapa: <strong>{quickPickStageLabel(card)}</strong></p>
                {card.exactBlocker && <p className="mt-1 text-xs font-bold text-amber-100">{quickPickBlockerLabel(card.exactBlocker)} <span className="font-mono font-normal text-amber-100/55">· {card.exactBlocker}</span></p>}
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${quickPickStageTone(card.state === "READY" ? "PASS" : card.state)}`}>{card.state}</span>
            </summary>
            <ol className="mt-3 grid gap-1.5 border-t border-white/10 pt-3 sm:grid-cols-2">
              {QUICK_PICK_STAGES.map(([key, label]) => {
                const state = card.stages[key] ?? "WAITING"
                return <li key={key}
                  className={`flex min-h-9 items-center justify-between gap-2 rounded-xl px-2.5 text-xs ${quickPickStageTone(state)}`}>
                  <span>{label}</span><strong>{state}</strong>
                </li>
              })}
            </ol>
          </details>)}
          {ownerRuntime.quickPickAvailable && quickPickCards.length === 0 &&
            <p className="rounded-xl border border-white/10 p-3 text-sm text-white/45">No hay operaciones Quick Pick durables recientes.</p>}
        </div>
        <a href="/admin/ebay/quick-pick"
          className="mt-3 inline-flex min-h-11 items-center text-xs font-bold text-cyan-100/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Detalles técnicos opcionales</a>
      </section>

      <section data-dashboard-block="live-attention" className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-white/50">📦 Listings LIVE que requieren atención</p>
        <div className="mt-3 flex items-end justify-between gap-4"><div><p className="text-4xl font-black">{snapshot.liveAttentionAvailable ? snapshot.liveAttention : "—"}</p><p className="mt-1 text-sm text-white/55">{snapshot.liveAttentionAvailable ? "señales activas" : "lectura no disponible"}</p></div><a href="/admin/ebay/listing-workspace" className="inline-flex min-h-11 items-center rounded-2xl border border-white/15 px-4 text-sm font-black text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Ver listings</a></div>
        <p className="mt-4 text-sm text-white/50">Sólo alertas durables; evidencia no disponible nunca se muestra como cero comercial.</p>
      </section>

      <section data-dashboard-block="system-health" className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-white/50">🟢 Estado compacto de Seller OS</p>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          {health.map(([label, status]) => <div key={label} className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-black/20 px-3"><dt className="truncate text-xs font-bold text-white/60">{label.replaceAll("_", " ")}</dt><dd><StatusPill status={status} /></dd></div>)}
        </dl>
        <p className="mt-3 text-xs leading-5 text-white/50" data-luna-worker-detail>
          {workerDetail(ownerRuntime.lunaWorker.status,
            ownerRuntime.lunaWorker.reasonCode)}
        </p>
        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-white/50">Métricas comerciales</p>
            {snapshot.analyticsDataStatus === "AVAILABLE_STALE" ?
              <p className="text-[11px] font-bold text-amber-100">Última lectura válida · {shortTimestamp(snapshot.analyticsSnapshotCapturedAt)}</p> : null}
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
            {([
              ["Activos", metricLabel(snapshot.activeListings)],
              ["Impresiones", metricLabel(snapshot.impressions)],
              ["Vistas", metricLabel(snapshot.views)],
              ["CTR", metricLabel(snapshot.ctr, "%")],
              ["Vendidos", metricLabel(snapshot.quantitySold)],
              ["Órdenes", metricLabel(snapshot.officialOrders)],
            ] as const).map(([label, value]) => <div key={label}
              className="rounded-xl bg-black/20 px-2 py-2.5">
              <dt className="truncate text-[10px] font-bold uppercase tracking-wide text-white/40">{label}</dt>
              <dd className="mt-1 text-base font-black">{value}</dd>
            </div>)}
          </dl>
          <p className="mt-3 text-xs leading-5 text-white/55" data-stock-freshness-summary>
            StockGuard {snapshot.stockCertifiedCount === null ||
              snapshot.stockScopeCount === null ? "—" :
              `${snapshot.stockCertifiedCount}/${snapshot.stockScopeCount}`} · FRESH {snapshot.stockFreshCount ?? "—"} · STALE {snapshot.stockStaleCount ?? "—"} · UNKNOWN {snapshot.stockUnknownCount ?? "—"} · RISKS {snapshot.stockRiskCount ?? "—"}
          </p>
          <p className="mt-1 text-[11px] text-white/40">
            Orders {snapshot.ordersSourceStatus} · última lectura {shortTimestamp(snapshot.ordersLastSuccessfulReadAt)}
          </p>
        </div>
      </section>
    </div>
  </>
}
