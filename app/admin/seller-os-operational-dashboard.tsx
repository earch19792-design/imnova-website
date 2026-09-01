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

type RadarSignal = Readonly<{
  familyId: string
  family: string
  demandClass: string
  soldComparableCount: number | null
  soldQuantityEvidence: number | null
  priceBand: Readonly<{ currency: string | null; minimum: number | null;
    median: number | null; maximum: number | null }>
  enrichmentNextStage: string
}>

type QueueClassification = Readonly<{ READY: number; RADAR_SIGNAL: number;
  LEGACY: number; ALREADY_LIVE: number; UNPROVEN: number }>

type AlreadyLiveOpportunity = Readonly<{ opportunityId: string;
  candidateKey: string | null; title: string | null; sourceSku: string | null;
  ebayItemIds: readonly string[]; liveWorkspaceUrl: string | null }>

type DashboardSnapshot = Readonly<{
  readyForOwnerReviewCount: number
  readyForOwnerReviewCandidateKeys: readonly string[]
  readyForOwnerReviewAvailable: boolean
  radarSignalCount: number
  radarSignals: readonly RadarSignal[]
  radarAvailable: boolean
  reviewQueueCount: number
  reviewQueueClassification: QueueClassification
  alreadyLiveOpportunities: readonly AlreadyLiveOpportunity[]
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
  readyForOwnerReviewCount: 0,
  readyForOwnerReviewCandidateKeys: [],
  readyForOwnerReviewAvailable: false,
  radarSignalCount: 0,
  radarSignals: [],
  radarAvailable: false,
  reviewQueueCount: 0,
  reviewQueueClassification: { READY: 0, RADAR_SIGNAL: 0, LEGACY: 0,
    ALREADY_LIVE: 0, UNPROVEN: 0 },
  alreadyLiveOpportunities: [],
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

function nullableText(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maximum) : null
}

function parseQueueClassification(value: unknown): QueueClassification {
  const item = record(value)
  return { READY: safeCount(item.READY),
    RADAR_SIGNAL: safeCount(item.RADAR_SIGNAL),
    LEGACY: safeCount(item.LEGACY),
    ALREADY_LIVE: safeCount(item.ALREADY_LIVE),
    UNPROVEN: safeCount(item.UNPROVEN) }
}

function parseRadarSignals(value: unknown) {
  return (Array.isArray(value) ? value : []).flatMap((entry) => {
    const item = record(entry)
    const familyId = nullableText(item.familyId, 160)
    const family = nullableText(item.family, 300)
    const demandClass = nullableText(item.demandClass, 120)
    if (!familyId || !family || !demandClass) return []
    const price = record(item.priceBand)
    return [{ familyId, family, demandClass,
      soldComparableCount: availableMetric(item.soldComparableCount),
      soldQuantityEvidence: availableMetric(item.soldQuantityEvidence),
      priceBand: { currency: nullableText(price.currency, 12),
        minimum: availableMetric(price.minimum),
        median: availableMetric(price.median),
        maximum: availableMetric(price.maximum) },
      enrichmentNextStage: nullableText(item.enrichmentNextStage, 180) ??
        "WAITING_NEXT_BOUNDED_ENRICHMENT" }]
  })
}

function parseAlreadyLiveOpportunities(value: unknown) {
  return (Array.isArray(value) ? value : []).flatMap((entry) => {
    const item = record(entry)
    const opportunityId = nullableText(item.opportunityId, 120)
    if (!opportunityId || item.alreadyLiveExactProduct !== true) return []
    const ebayItemIds = (Array.isArray(item.ebayItemIds)
      ? item.ebayItemIds : []).flatMap((candidate) => {
      const parsed = nullableText(candidate, 30)
      return parsed && /^\d{9,20}$/.test(parsed) ? [parsed] : []
    })
    return [{ opportunityId,
      candidateKey: nullableText(item.candidateKey, 300),
      title: nullableText(item.title, 500),
      sourceSku: nullableText(item.sourceSku, 160), ebayItemIds,
      liveWorkspaceUrl: nullableText(item.liveWorkspaceUrl, 1_000) }]
  })
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

function ownerVisibleQuickPickBlockers(card: OwnerRuntimeQuickPickCard) {
  return card.exactBlockers.filter((value) =>
    value !== "WINNER_EVIDENCE_PREVIEW_STAGING_REQUIRED")
}

function usd(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
  }).format(parsed) : "—"
}

function percentage(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? `${parsed.toFixed(2)}%` : "—"
}

function QuickPickOwnerReviewInline({ card, request, onUpdated }: Readonly<{
  card: OwnerRuntimeQuickPickCard
  request: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>
  onUpdated: () => Promise<void>
}>) {
  const review = record(card.listingReview)
  const category = record(review.category)
  const condition = record(review.condition)
  const shipping = record(review.shipping)
  const dollar = record(review.dollarCheck)
  const band = record(review.supportedPriceBand)
  const ownerReview = record(review.ownerReview)
  const keywords = Array.isArray(review.keywords)
    ? review.keywords.map(record) : []
  const specifics = record(review.itemSpecifics)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(String(review.title ?? ""))
  const [description, setDescription] = useState(
    String(review.description ?? ""))
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState("")
  const ready = review.finalListingPackageReady === true
  const confirmed = ownerReview.status === "CONFIRMED" &&
    ownerReview.readyForOwnerPublishAuthorization === true

  useEffect(() => {
    if (editing) return
    setTitle(String(review.title ?? ""))
    setDescription(String(review.description ?? ""))
  }, [editing, review.description, review.title])

  async function persist(intent: "EDIT" | "CONFIRM") {
    if (!card.candidateKey || !card.listingPackageId || busy) return
    setBusy(true)
    setFeedback(intent === "EDIT" ? "Guardando cambios…" : "Confirmando…")
    try {
      await request("/api/admin/ebay/luna-quick-pick", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "OWNER_REVIEW", intent,
          candidateKey: card.candidateKey,
          listingPackageId: card.listingPackageId,
          ...(intent === "EDIT" ? { edits: { title, description } } : {}) }),
      })
      await onUpdated()
      setEditing(false)
      setFeedback(intent === "EDIT"
        ? "Cambios guardados · confirma cuando estés conforme"
        : "Paquete confirmado · listo para autorización de publicación")
    } catch {
      setFeedback("No pude guardar la revisión · el paquete no cambió")
    } finally {
      setBusy(false)
    }
  }

  if (!Object.keys(review).length) return null
  return <section data-quick-pick-owner-review-inline
    className="mt-3 rounded-2xl border border-amber-200/20 bg-amber-100/[0.04] p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-amber-100/70">
        {review.demand && record(review.demand).status ===
          "UNPROVEN_INSUFFICIENT_MARKET_EVIDENCE"
          ? "🟡 Prueba de mercado" : "Paquete final"}
      </p><p className="mt-1 text-xs text-white/50">
        Revisión owner inline · ningún cambio se publica desde aquí
      </p></div>
      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${
        confirmed ? "bg-emerald-200 text-emerald-950" : ready
          ? "bg-amber-200 text-amber-950" : "bg-white/10 text-white/55"}`}>
        {confirmed ? "CONFIRMADO" : ready ? "LISTO PARA REVISAR" : "INCOMPLETO"}
      </span>
    </div>

    <div className="mt-3 grid gap-3 xl:grid-cols-[1.2fr_1fr_0.9fr]">
      <div className="rounded-xl bg-black/20 p-3">
        <p className="text-[10px] font-black uppercase tracking-wide text-white/40">
          Título final optimizado
        </p>
        {editing ? <input value={title} maxLength={80}
          onChange={(event) => setTitle(event.target.value)}
          className="mt-2 min-h-11 w-full rounded-xl border border-white/15 bg-black/30 px-3 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200" />
          : <p className="mt-2 text-sm font-black leading-5">{String(
            review.title ?? "—")}</p>}
        <p className="mt-3 text-[10px] font-black uppercase tracking-wide text-white/40">
          Keywords con evidencia
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {keywords.map((keyword) => <li key={String(keyword.term)}
            className="rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1 text-[11px]">
            <strong>{String(keyword.term)}</strong>
            <span className="ml-1 text-white/45">· {keyword.productRelevance ===
              "EXACT_PRODUCT" ? "producto exacto" : "proyección"}</span>
          </li>)}
          {!keywords.length && <li className="text-xs text-amber-100">
            No hay términos comerciales con evidencia suficiente
          </li>}
        </ul>
        <p className="mt-3 text-[10px] font-black uppercase tracking-wide text-white/40">
          Descripción
        </p>
        {editing ? <textarea value={description} rows={6} maxLength={5_000}
          onChange={(event) => setDescription(event.target.value)}
          className="mt-2 min-h-32 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm leading-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200" />
          : <p className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-xs leading-5 text-white/70">
            {String(review.description ?? "—")}
          </p>}
      </div>

      <div className="rounded-xl bg-black/20 p-3">
        <p className="text-[10px] font-black uppercase tracking-wide text-white/40">
          Item specifics
        </p>
        <dl className="mt-2 space-y-1.5 text-xs">
          {Object.entries(specifics).map(([key, value]) => <div key={key}
            className="flex min-h-8 items-center justify-between gap-3 border-b border-white/[0.06] pb-1">
            <dt className="text-white/50">{key}</dt>
            <dd className="text-right font-bold">{String(value)}</dd>
          </div>)}
        </dl>
        <dl className="mt-3 space-y-2 border-t border-white/10 pt-3 text-xs">
          <div><dt className="text-white/40">Categoría</dt>
            <dd className="mt-1 font-bold">{String(category.name ?? "—")}
              {category.id ? ` · ${String(category.id)}` : ""}</dd></div>
          <div><dt className="text-white/40">Condición</dt>
            <dd className="mt-1 font-bold">{String(condition.label ?? "—")}</dd></div>
          <div><dt className="text-white/40">Shipping supplier</dt>
            <dd className="mt-1 font-bold">{usd(shipping.amount)}</dd></div>
        </dl>
      </div>

      <div className="rounded-xl bg-black/20 p-3">
        <p className="text-[10px] font-black uppercase tracking-wide text-white/40">
          Dollar Check
        </p>
        <dl className="mt-2 space-y-2 text-xs">
          {([
            ["Supplier cost", usd(dollar.supplierCost)],
            ["Shipping", usd(dollar.shipping)],
            ["eBay fees", usd(dollar.ebayFees)],
            ["Target price", usd(dollar.targetPrice)],
            ["Ganancia esperada", usd(dollar.expectedContribution)],
            ["Margen", percentage(dollar.expectedMargin)],
            ["ROI", percentage(dollar.expectedRoi)],
            ["Break-even", usd(dollar.breakEvenPrice)],
            ["Mínimo rentable", usd(dollar.minimumProfitablePrice)],
          ] as const).map(([label, value]) => <div key={label}
            className="flex min-h-8 items-center justify-between gap-2 border-b border-white/[0.06] pb-1">
            <dt className="text-white/50">{label}</dt><dd className="font-black">{value}</dd>
          </div>)}
        </dl>
        <p className="mt-3 rounded-xl border border-amber-200/15 bg-amber-200/[0.06] p-2 text-[11px] leading-4 text-amber-50">
          Precio soportado: {String(band.status ?? "UNPROVEN")}.
          La demanda y competitividad del precio no están probadas.
        </p>
      </div>
    </div>

    <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button type="button" onClick={() => setEditing((value) => !value)}
        disabled={busy || confirmed}
        className="min-h-11 rounded-xl border border-cyan-200/35 px-5 text-sm font-black text-cyan-100 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">
        {editing ? "CANCELAR" : "EDITAR"}
      </button>
      {editing && <button type="button" onClick={() => void persist("EDIT")}
        disabled={busy || !title.trim() || !description.trim()}
        className="min-h-11 rounded-xl bg-cyan-200 px-5 text-sm font-black text-cyan-950 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">
        GUARDAR CAMBIOS
      </button>}
      {!editing && <button type="button"
        onClick={() => void persist("CONFIRM")}
        disabled={busy || !ready || confirmed}
        className="min-h-11 rounded-xl bg-emerald-200 px-5 text-sm font-black text-emerald-950 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-200">
        {confirmed ? "CONFIRMADO" : "CONFIRMAR"}
      </button>}
    </div>
    {feedback && <p aria-live="polite"
      className="mt-2 text-right text-xs font-bold text-white/60">{feedback}</p>}
  </section>
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
  const [ownerReviewOpen, setOwnerReviewOpen] = useState(false)

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
    const opportunityAuthority = record(
      radar.commercialOpportunityAuthority)
    const opportunityAuthorityValid = radarAuthoritative &&
      opportunityAuthority.contractVersion ===
        "SELLER_OS_DASHBOARD_OPPORTUNITY_AUTHORITY_V1"
    const readyAuthority = record(opportunityAuthority.readyForOwnerReview)
    const radarAuthority = record(opportunityAuthority.radar)
    const reviewQueueAudit = record(opportunityAuthority.reviewQueueAudit)
    const alreadyLiveAuthority = record(opportunityAuthority.alreadyLive)
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
          liveAttention: liveListingIds.size,
          liveAttentionAvailable: true,
          nightRadar: normalizedStatus(latestRadarRun.status ?? radar.status),
        }
      }
      if (opportunityAuthorityValid) {
        const readyRecords = Array.isArray(readyAuthority.records)
          ? readyAuthority.records.map(record) : []
        const readyAvailable = readyAuthority.status === "AVAILABLE"
        const radarAvailable = radarAuthority.status === "AVAILABLE"
        next = { ...next,
          readyForOwnerReviewCount: readyAvailable
            ? safeCount(readyAuthority.count) : previous.readyForOwnerReviewCount,
          readyForOwnerReviewCandidateKeys: readyAvailable
            ? readyRecords.flatMap((row) => {
              const candidateKey = nullableText(row.candidateKey, 300)
              return candidateKey ? [candidateKey] : []
            }) : previous.readyForOwnerReviewCandidateKeys,
          readyForOwnerReviewAvailable: readyAvailable ||
            previous.readyForOwnerReviewAvailable,
          radarSignalCount: radarAvailable
            ? safeCount(radarAuthority.count) : previous.radarSignalCount,
          radarSignals: radarAvailable
            ? parseRadarSignals(radarAuthority.signals) : previous.radarSignals,
          radarAvailable: radarAvailable || previous.radarAvailable,
          reviewQueueCount: readyAvailable
            ? safeCount(reviewQueueAudit.total) : previous.reviewQueueCount,
          reviewQueueClassification: readyAvailable
            ? parseQueueClassification(reviewQueueAudit.classification)
            : previous.reviewQueueClassification,
          alreadyLiveOpportunities: readyAvailable
            ? parseAlreadyLiveOpportunities(alreadyLiveAuthority.records)
            : previous.alreadyLiveOpportunities,
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
    setRadarReadState(opportunityAuthorityValid
      ? "STABLE" : "READ_RETRYING")
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
  const ownerReviewCandidateKeys = useMemo(() => new Set(
    snapshot.readyForOwnerReviewCandidateKeys),
  [snapshot.readyForOwnerReviewCandidateKeys])
  const ownerReviewCards = useMemo(() => quickPickCards.filter((card) =>
    card.candidateKey && ownerReviewCandidateKeys.has(card.candidateKey) &&
    card.state === "READY" &&
    ["MARKET_TEST_READY", "LISTING_READY"].includes(card.disposition)),
  [ownerReviewCandidateKeys, quickPickCards])
  const opportunitiesReady = snapshot.readyForOwnerReviewCount
  const opportunityDataAvailable = snapshot.readyForOwnerReviewAvailable

  return <>
    <div className="grid gap-4 md:grid-cols-2" data-primary-dashboard-block-count="4">
      <section data-dashboard-block="opportunities" className="rounded-3xl border border-emerald-200/20 bg-emerald-200/[0.06] p-5">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100/65">💰 Oportunidades para publicar</p>
        <div className="mt-3 flex items-end justify-between gap-4">
          <div><p className="text-4xl font-black" data-ready-for-owner-review-count>{opportunityDataAvailable ? opportunitiesReady : "—"}</p><p className="mt-1 text-sm text-white/55">{opportunityDataAvailable ? "listas para revisar" : "lectura autoritativa pendiente"}</p></div>
          <button type="button" onClick={() => setOwnerReviewOpen((open) =>
            !open)} aria-expanded={ownerReviewOpen}
            aria-controls="dashboard-owner-review-queue"
            className="inline-flex min-h-11 items-center rounded-2xl border border-emerald-100/20 px-4 text-sm font-black text-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-200">
            {ownerReviewOpen ? "Cerrar" : "Revisar"}
          </button>
        </div>
        <p className="mt-4 text-sm text-white/55">
          Owner Review {opportunityDataAvailable ? opportunitiesReady : "—"}
          {" · "}Señales Radar {snapshot.radarAvailable
            ? snapshot.radarSignalCount : "—"}
        </p>
        {ownerReviewOpen && <div id="dashboard-owner-review-queue"
          data-owner-review-inline-queue className="mt-4 space-y-3 border-t border-emerald-100/15 pt-4">
          {ownerReviewCards.map((card) => <article
            key={card.candidateKey ?? card.sourceUrl}
            data-owner-review-inline-card
            className="rounded-2xl border border-emerald-100/15 bg-black/20 p-3">
            <p className="text-sm font-black">{card.title ?? "Producto Luna"}</p>
            <p className="mt-1 text-xs text-white/50">{card.sourceSku ??
              "SKU pendiente"} · {card.disposition === "MARKET_TEST_READY"
              ? "Prueba de mercado" : "Listing listo"}</p>
            <QuickPickOwnerReviewInline card={card} request={adminRequest}
              onUpdated={ownerRuntime.refreshQuickPicks} />
          </article>)}
          {opportunityDataAvailable && opportunitiesReady === 0 &&
            <p className="rounded-xl border border-white/10 p-3 text-sm text-white/50">
              No hay productos que hayan completado el Golden Path para revisión.
            </p>}
          {opportunityDataAvailable && opportunitiesReady >
              ownerReviewCards.length && <p
              className="rounded-xl border border-amber-100/15 bg-amber-100/[0.04] p-3 text-xs text-amber-50/75">
              Reconciliando {opportunitiesReady - ownerReviewCards.length}
              {" "}paquete durable con la vista owner.
            </p>}
        </div>}
        <details className="mt-3 rounded-2xl border border-white/10 bg-black/15 p-3"
          data-dashboard-radar-signals>
          <summary className="min-h-11 cursor-pointer list-none py-2 text-sm font-black text-violet-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-200">
            Radar · {snapshot.radarAvailable ? snapshot.radarSignalCount : "—"}
            {" "}señales familiares
          </summary>
          <p className="mt-1 text-xs leading-5 text-white/50">
            Señales comerciales; no entran en Owner Review hasta completar el Golden Path.
          </p>
          <ul className="mt-2 space-y-2">
            {snapshot.radarSignals.map((signal) => <li key={signal.familyId}
              className="rounded-xl bg-white/[0.04] p-2.5 text-xs leading-5 text-white/65">
              <strong className="text-white/85">{signal.family}</strong>
              <span className="block">Demanda {signal.demandClass.replaceAll(
                "FAMILY_DEMAND_", "")} · {signal.soldComparableCount ?? "—"}
                {" "}comparables · {signal.soldQuantityEvidence ?? "—"} vendidos</span>
              <span className="block">Banda {signal.priceBand.minimum === null
                ? "—" : usd(signal.priceBand.minimum)} – {signal.priceBand.maximum
                === null ? "—" : usd(signal.priceBand.maximum)} · siguiente:
                {" "}{signal.enrichmentNextStage.replaceAll("_", " ")}</span>
            </li>)}
          </ul>
        </details>
        <details className="mt-2 text-xs text-white/45"
          data-dashboard-review-queue-audit>
          <summary className="min-h-11 cursor-pointer py-3 font-bold">
            Auditoría de cola histórica · {snapshot.reviewQueueCount} registros
          </summary>
          <p className="leading-5">Ready {snapshot.reviewQueueClassification.READY}
            {" · "}Radar signal {snapshot.reviewQueueClassification.RADAR_SIGNAL}
            {" · "}Legacy {snapshot.reviewQueueClassification.LEGACY}
            {" · "}Already LIVE {snapshot.reviewQueueClassification.ALREADY_LIVE}
            {" · "}No probado {snapshot.reviewQueueClassification.UNPROVEN}</p>
        </details>
        {snapshot.alreadyLiveOpportunities.length > 0 && <details
          className="mt-2 text-xs text-white/45"
          data-dashboard-already-live-exclusions>
          <summary className="min-h-11 cursor-pointer py-3 font-bold">
            Historial excluido por listing LIVE · {snapshot.alreadyLiveOpportunities.length}
          </summary>
          <ul className="space-y-2">
            {snapshot.alreadyLiveOpportunities.map((item) => <li
              key={item.opportunityId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.04] p-2.5">
              <span><strong className="text-white/70">{item.sourceSku ??
                item.title ?? "Producto"}</strong> · LIVE {item.ebayItemIds.join(
                ", ")}</span>
              {item.liveWorkspaceUrl && <a href={item.liveWorkspaceUrl}
                className="inline-flex min-h-11 items-center text-emerald-100/70">
                Abrir listing LIVE
              </a>}
            </li>)}
          </ul>
        </details>}
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
        <section data-quick-pick-overnight-summary
          className="mt-3 rounded-2xl border border-violet-200/15 bg-violet-200/[0.05] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-black uppercase tracking-[0.16em] text-violet-100/75">Trabajo nocturno</h3>
            {ownerRuntime.overnightEnrichment?.observedAt && <span
              className="text-[10px] font-bold text-white/40">
              {shortTimestamp(ownerRuntime.overnightEnrichment.observedAt)}
            </span>}
          </div>
          {ownerRuntime.overnightEnrichment ? <>
            <p className="mt-2 text-xs leading-5 text-white/65">
              {ownerRuntime.overnightEnrichment.enrichedCount} enriquecidos · {ownerRuntime.overnightEnrichment.readyAfterCount} listos · {ownerRuntime.overnightEnrichment.ownerConfirmationRequiredCount} necesitan confirmación · {ownerRuntime.overnightEnrichment.ownerFactRequiredCount} necesitan un dato
            </p>
            {ownerRuntime.overnightEnrichment.outcomes.length > 0 && <ul
              className="mt-2 space-y-1.5">
              {ownerRuntime.overnightEnrichment.outcomes.map((outcome,
                index) => <li
                key={`${outcome.sourceSku ?? "quick-pick"}-${index}`}
                className="rounded-xl bg-black/20 px-2.5 py-2 text-xs text-white/60">
                <strong className="text-white/80">{outcome.productTitle ??
                  outcome.sourceSku ?? "Producto Luna"}</strong>
                <span className="ml-1">{outcome.beforeStatus} → {outcome.afterStatus}</span>
                {outcome.fieldsResolvedOvernight.length > 0 && <span>
                  {` · resuelto: ${outcome.fieldsResolvedOvernight.join(", ")}`}
                </span>}
                {outcome.demandEvidenceAdded && <span> · nueva evidencia de demanda</span>}
                {outcome.listingIntelligenceUpdated && <span> · listing actualizado</span>}
                {outcome.ownerActionRequired === "CONFIRM" && <span> · confirmar</span>}
                {outcome.ownerActionRequired === "ENTER_FACT" && <span> · introducir dato</span>}
              </li>)}
            </ul>}
          </> : <p className="mt-2 text-xs leading-5 text-white/50">
            La segunda pasada aparecerá aquí después del próximo Night Radar. Los productos listos durante el día no esperan a la noche.
          </p>}
        </section>
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
                {ownerVisibleQuickPickBlockers(card).length > 0 && <ul
                  data-quick-pick-commercial-blockers
                  className="mt-1 space-y-1 text-xs font-bold text-amber-100">
                  {ownerVisibleQuickPickBlockers(card).map((blocker) =>
                    <li key={blocker}>
                    {quickPickBlockerLabel(blocker)}
                  </li>)}
                </ul>}
                {card.ownerResidualActions.length > 0 && <p
                  className="mt-2 text-xs font-bold text-sky-100">
                  {card.nextOwnerAction === "ENTER_FACT"
                    ? "Falta un dato exacto del owner"
                    : "Listo para confirmación final del owner"}
                </p>}
                {card.overnightEnrichmentPending && <p
                  className="mt-2 text-xs font-bold text-violet-100">
                  Segunda pasada nocturna pendiente · no retrasa una resolución diurna
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
        <div className="mt-3 flex items-end justify-between gap-4"><div><p className="text-4xl font-black">{snapshot.liveAttentionAvailable ? snapshot.liveAttention : "—"}</p><p className="mt-1 text-sm text-white/55">{snapshot.liveAttentionAvailable ? "señales activas" : "lectura no disponible"}</p></div><a href="/admin/ebay/monitor" className="inline-flex min-h-11 items-center rounded-2xl border border-white/15 px-4 text-sm font-black text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Ver listings</a></div>
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
