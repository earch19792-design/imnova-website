"use client"

import { FormEvent, useCallback, useEffect, useMemo, useState } from
  "react"

import { supabase } from "@/lib/supabase"
import { mergeOwnerRuntimeQuickPickCards, parseOwnerRuntimeQuickPickCard,
  parseOwnerRuntimeQuickPickReceipt, useAdminOwnerRuntime,
  type OwnerRuntimeQuickPickCard, type OwnerRuntimeQuickPickReceipt,
  type OwnerRuntimeQuickPickStageState } from
  "./admin-owner-runtime-provider"

type CompactStatus = "READY" | "WORKING" | "WAITING" | "DEGRADED" |
  "OFFLINE"
type WorkerStatus = CompactStatus | "CONNECTING"
type DashboardReadState = "REFRESHING" | "STABLE" | "READ_RETRYING"

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

function authoritativeCompactStatus(value: unknown) {
  const normalized = String(value ?? "").toUpperCase()
  return new Set<CompactStatus>(["READY", "WORKING", "WAITING", "DEGRADED",
    "OFFLINE"]).has(normalized as CompactStatus)
    ? normalized as CompactStatus : null
}

function ordersDashboardStatus(value: Record<string, unknown>,
  previous: CompactStatus) {
  const sourceStatus = String(value.sourceStatus ?? "").toUpperCase()
  if (sourceStatus === "AVAILABLE") return "READY" as const
  if (sourceStatus === "UNPROVEN") return "WAITING" as const
  if (["UNAVAILABLE", "PARTIAL", "UPSTREAM_ERROR", "AUTHORIZATION_BLOCKED"]
      .includes(sourceStatus)) return "DEGRADED" as const
  return authoritativeCompactStatus(value.dashboardStatus) ?? previous
}

function stockGuardDashboardStatus(value: Record<string, unknown>,
  previous: CompactStatus) {
  const scope = availableMetric(value.scopeCount)
  const certified = availableMetric(value.certifiedCount)
  const fresh = availableMetric(value.freshCount)
  const stale = availableMetric(value.staleCount)
  const unknown = availableMetric(value.unknownCount)
  const risks = availableMetric(value.riskCount)
  if ([scope, certified, fresh, stale, unknown, risks]
      .some((entry) => entry === null)) {
    return authoritativeCompactStatus(value.dashboardStatus) ?? previous
  }
  if (risks! > 0 || unknown! > 0 || certified! < scope! ||
      fresh! + stale! < scope!) return "DEGRADED" as const
  if (stale! > 0) return "WAITING" as const
  if (scope! > 0 && certified === scope && fresh === scope) {
    return "READY" as const
  }
  return authoritativeCompactStatus(value.dashboardStatus) ?? previous
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
  if (card.lastStage === "REQUIRED_SPECIFICS" ||
      card.exactBlockers.some((value) => value.startsWith(
        "MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN")) &&
      card.stages.REQUIRED_SPECIFICS === "BLOCKED") {
    return "Required specifics"
  }
  if (card.lastStage === "MARKETPLACE_READINESS" ||
      card.exactBlockers.some((value) => value.startsWith(
        "MARKETPLACE_CONDITION_NOT_READY"))) {
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
  const [commercialReadState, setCommercialReadState] =
    useState<DashboardReadState>("REFRESHING")
  const [radarReadState, setRadarReadState] =
    useState<DashboardReadState>("REFRESHING")

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
    setCommercialReadState("REFRESHING")
    setRadarReadState("REFRESHING")
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
    const commercialAuthoritative = commercialResult.status === "fulfilled" &&
      commercialHealth.contractVersion ===
        "SELLER_OS_DASHBOARD_COMMERCIAL_HEALTH_V1"
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
    const radarAuthoritative = radarResult.status === "fulfilled" &&
      Object.keys(radar).length > 0
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

    setSnapshot((previous) => {
      let next = { ...previous }
      if (radarAuthoritative) {
        next = { ...next,
          radarReady: safeCount(radarSummary.ready),
          radarReview: safeCount(radarSummary.review),
          radarAvailable: true,
          liveAttention: liveListingIds.size,
          liveAttentionAvailable: true,
          nightRadar: normalizedStatus(latestRadarRun.status ?? radar.status),
        }
      }
      if (commercialAuthoritative) {
        const analyticsDataStatus = new Set([
          "AVAILABLE_CURRENT", "AVAILABLE_STALE",
        ]).has(String(analyticsHealth.snapshotDataStatus))
          ? analyticsHealth.snapshotDataStatus as
            "AVAILABLE_CURRENT" | "AVAILABLE_STALE" : "UNAVAILABLE"
        next = { ...next,
          stockGuard: stockGuardDashboardStatus(
            stockHealth, previous.stockGuard),
          analytics: authoritativeCompactStatus(
            analyticsHealth.dashboardStatus) ?? previous.analytics,
          orders: ordersDashboardStatus(orderHealth, previous.orders),
          activeListings: availableMetric(commercialHealth.activeListings),
          impressions: availableMetric(analyticsHealth.impressions),
          views: availableMetric(analyticsHealth.views),
          ctr: availableMetric(analyticsHealth.ctr),
          quantitySold: availableMetric(analyticsHealth.quantitySold),
          officialOrders: availableMetric(orderHealth.officialOrderCount),
          analyticsDataStatus,
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
        }
      }
      return next
    })
    setCommercialReadState(commercialAuthoritative
      ? "STABLE" : "READ_RETRYING")
    setRadarReadState(radarAuthoritative ? "STABLE" : "READ_RETRYING")
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
  const quickPickCards = useMemo(() => mergeOwnerRuntimeQuickPickCards(
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
          <dl className="mt-2 grid grid-cols-2 gap-2 text-center sm:grid-cols-3">
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
            ] as const).map(([label, value]) => <div key={label}
              className="min-w-0 rounded-xl bg-black/20 px-2 py-2">
              <dt className="break-words text-[10px] font-bold uppercase leading-4 tracking-wide text-white/45">{label}</dt>
              <dd className="mt-1 text-sm font-black tabular-nums">{value ?? "—"}</dd>
            </div>)}
          </dl>
        </section>}
        <p aria-live="polite" className="mt-3 text-sm text-white/60">{feedback ||
          (ownerRuntime.quickPickReadState === "READ_RETRYING"
            ? "No pude actualizar · reintentando; conservo el último estado válido"
            : ownerRuntime.quickPickReadState === "REFRESHING"
              ? "Actualizando estado…"
              : ownerRuntime.quickPickAvailable
                ? `${ownerRuntime.quickPick.inProgress} en proceso · ${ownerRuntime.quickPick.readyForReview} para revisar · ${ownerRuntime.quickPick.blocked} bloqueados`
                : "Recuperando operaciones durables…")}</p>
        <div className="mt-3 space-y-2" data-quick-pick-inline-operation-view>
          {quickPickCards.map((card) => <details
            key={card.opportunityId ?? card.candidateKey ??
              (card.lunaProductId && card.lunaVariantId && card.sourceSku
                ? `${card.lunaProductId}:${card.lunaVariantId}:${card.sourceSku}`
                : card.sourceUrl)}
            data-quick-pick-inline-card
            className="group rounded-2xl border border-white/10 bg-black/20 p-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-start justify-between gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">
              <div className="min-w-0">
                <p className="truncate text-sm font-black">{card.title ?? "Producto Luna"}</p>
                <p className="mt-1 truncate text-xs text-white/50">{card.sourceSku ?? "Identificando…"} · {card.disposition}</p>
                <p className="mt-1 text-xs text-white/65">Etapa: <strong>{quickPickStageLabel(card)}</strong></p>
                {card.exactBlockers.length > 0 && <ul
                  data-quick-pick-commercial-blockers
                  className="mt-1 space-y-1 text-xs font-bold text-amber-100">
                  {card.exactBlockers.map((blocker) => <li key={blocker}>
                    {quickPickBlockerLabel(blocker)}
                  </li>)}
                </ul>}
                {card.ownerResidualActions.length > 0 && <p
                  className="mt-2 text-xs font-bold text-sky-100">
                  {card.nextOwnerAction === "ENTER_FACT"
                    ? "Falta un dato exacto del owner"
                    : "Listo para confirmación final del owner"}
                </p>}
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
            {(card.requiredItemSpecificsCount !== null ||
              card.conditionReady !== null) && <p
              className="mt-2 text-xs leading-5 text-white/50"
              data-quick-pick-durable-readiness-summary>
              Required specifics {card.requiredItemSpecificsSatisfied ?? "—"}/
              {card.requiredItemSpecificsCount ?? "—"}
              {card.unresolvedRequiredAspects.length > 0
                ? ` · pendientes: ${card.unresolvedRequiredAspects.join(", ")}`
                : ""} · Condition {card.conditionReady === true ? "PASS" :
                  card.conditionReady === false ? "BLOCKED" : "WAITING"}
            </p>}
            {card.ownerResidualActions.length > 0 && <ul
              className="mt-2 space-y-1 rounded-xl border border-sky-200/15 bg-sky-200/[0.05] p-2 text-xs text-sky-50">
              {card.ownerResidualActions.map((action) => <li
                key={action.productField}>
                <strong>{action.productField}</strong>: {action.bestProposal
                  ? `confirmar “${action.bestProposal}” o editar`
                  : "ingresar el hecho exacto"}
              </li>)}
            </ul>}
            {card.exactBlockers.length > 0 && <details className="mt-2">
              <summary className="min-h-11 cursor-pointer py-3 text-xs font-bold text-white/45">
                Ver evidencia técnica
              </summary>
              <ul className="space-y-1 text-xs text-white/45">
                {card.exactBlockers.map((blocker) => <li key={blocker}
                  className="break-all font-mono">{blocker}</li>)}
              </ul>
            </details>}
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
        {(commercialReadState !== "STABLE" || radarReadState !== "STABLE") &&
          <p className="mt-2 text-[11px] font-bold text-sky-100/60"
            data-dashboard-refresh-state>
            {commercialReadState === "READ_RETRYING" ||
              radarReadState === "READ_RETRYING"
              ? "No pude actualizar una lectura · reintentando; mantengo el último estado válido"
              : "Actualizando estado…"}
          </p>}
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
              `${snapshot.stockCertifiedCount}/${snapshot.stockScopeCount}`} · FRESH {snapshot.stockFreshCount ?? "—"} · REFRESH DUE {snapshot.stockStaleCount ?? "—"} · UNKNOWN {snapshot.stockUnknownCount ?? "—"} · PROVEN RISKS {snapshot.stockRiskCount ?? "—"}
          </p>
          <p className="mt-1 text-[11px] text-white/40">
            Orders {snapshot.ordersSourceStatus} · última lectura {shortTimestamp(snapshot.ordersLastSuccessfulReadAt)}
          </p>
        </div>
      </section>
    </div>
  </>
}
