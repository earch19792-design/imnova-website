"use client"

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from
  "react"

import { supabase } from "@/lib/supabase"

type CompactStatus = "READY" | "WORKING" | "WAITING" | "DEGRADED" |
  "OFFLINE"

type QuickPickSummary = Readonly<{
  inProgress: number
  readyForReview: number
  blocked: number
  total: number
}>

type DashboardSnapshot = Readonly<{
  quickPick: QuickPickSummary
  quickPickAvailable: boolean
  radarReady: number
  radarReview: number
  radarAvailable: boolean
  liveAttention: number
  liveAttentionAvailable: boolean
  stockGuard: CompactStatus
  nightRadar: CompactStatus
  analytics: CompactStatus
  orders: CompactStatus
}>

type LunaWorkerMessage = Readonly<{
  type: "SELLER_OS_LUNA_WORKER_STATUS_V1"
  status: CompactStatus
  autoClaimEnabled: boolean
}>

const emptySummary: QuickPickSummary = {
  inProgress: 0, readyForReview: 0, blocked: 0, total: 0,
}

const emptySnapshot: DashboardSnapshot = {
  quickPick: emptySummary,
  quickPickAvailable: false,
  radarReady: 0,
  radarReview: 0,
  radarAvailable: false,
  liveAttention: 0,
  liveAttentionAvailable: false,
  stockGuard: "WAITING",
  nightRadar: "WAITING",
  analytics: "WAITING",
  orders: "WAITING",
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function safeCount(value: unknown) {
  const count = Number(value)
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0
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

function readerStatus(latestRun: Record<string, unknown>, reader: string) {
  const readers = record(latestRun.readers)
  return record(readers[reader]).status ?? readers[reader]
}

function tone(status: CompactStatus) {
  if (status === "READY") return "bg-emerald-300 text-emerald-950"
  if (status === "WORKING") return "bg-cyan-300 text-cyan-950"
  if (status === "WAITING") return "bg-amber-200 text-amber-950"
  if (status === "DEGRADED") return "bg-orange-300 text-orange-950"
  return "bg-rose-300 text-rose-950"
}

function StatusPill({ status }: { status: CompactStatus }) {
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${tone(status)}`}>
    {status}
  </span>
}

export function SellerOsOperationalDashboard() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(emptySnapshot)
  const [workerStatus, setWorkerStatus] = useState<CompactStatus>("WAITING")
  const [input, setInput] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState("")
  const workerFrame = useRef<HTMLIFrameElement>(null)

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
    const [quickPickResult, commercialResult, radarResult] =
      await Promise.allSettled([
        adminRequest("/api/admin/ebay/luna-quick-pick"),
        adminRequest("/api/admin/ebay/commercial-monitor"),
        adminRequest("/api/admin/ebay/luna-opportunity-queue"),
      ])

    const quickPickPayload = quickPickResult.status === "fulfilled"
      ? record(quickPickResult.value) : {}
    const quickPickRaw = record(quickPickPayload.summary)
    const quickPick = quickPickResult.status === "fulfilled" ? {
      inProgress: safeCount(quickPickRaw.inProgress),
      readyForReview: safeCount(quickPickRaw.readyForReview),
      blocked: safeCount(quickPickRaw.blocked),
      total: safeCount(quickPickRaw.total),
    } : emptySummary

    const commercialPayload = commercialResult.status === "fulfilled"
      ? record(commercialResult.value) : {}
    const commercial = record(commercialPayload.dashboard)
    const latestRun = record(commercial.latestRun)
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
      quickPick,
      quickPickAvailable: quickPickResult.status === "fulfilled",
      radarReady: safeCount(radarSummary.ready),
      radarReview: safeCount(radarSummary.review),
      radarAvailable: radarResult.status === "fulfilled",
      liveAttention: liveListingIds.size,
      liveAttentionAvailable: commercialResult.status === "fulfilled" ||
        radarResult.status === "fulfilled",
      stockGuard: commercialResult.status === "rejected" ? "DEGRADED"
        : normalizedStatus(readerStatus(latestRun, "watchers")),
      nightRadar: radarResult.status === "rejected" ? "DEGRADED"
        : normalizedStatus(latestRadarRun.status ?? radar.status),
      analytics: commercialResult.status === "rejected" ? "DEGRADED"
        : normalizedStatus(readerStatus(latestRun, "analytics")),
      orders: commercialResult.status === "rejected" ? "DEGRADED"
        : normalizedStatus(readerStatus(latestRun, "orders")),
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

  useEffect(() => {
    const receiveWorkerStatus = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin ||
          event.source !== workerFrame.current?.contentWindow) return
      const message = record(event.data) as Partial<LunaWorkerMessage>
      if (message.type !== "SELLER_OS_LUNA_WORKER_STATUS_V1") return
      if (!new Set<CompactStatus>(["READY", "WORKING", "WAITING",
        "DEGRADED", "OFFLINE"]).has(message.status as CompactStatus)) return
      setWorkerStatus(message.status as CompactStatus)
    }
    window.addEventListener("message", receiveWorkerStatus)
    return () => window.removeEventListener("message", receiveWorkerStatus)
  }, [])

  async function submitQuickPick(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const urls = [...new Set(input.split(/\r?\n/).map((value) => value.trim())
      .filter(Boolean))].slice(0, 20)
    if (!urls.length || submitting) return
    setSubmitting(true)
    setFeedback("")
    try {
      await adminRequest("/api/admin/ebay/luna-quick-pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, selectedVariants: {} }),
      })
      setInput("")
      setFeedback(`${urls.length} Quick Pick${urls.length === 1 ? "" : "s"} en proceso`)
      await load()
    } catch {
      setFeedback("No pudimos iniciar esos links. Revisa el formato e inténtalo de nuevo.")
    } finally {
      setSubmitting(false)
    }
  }

  const opportunitiesReady = snapshot.quickPick.readyForReview +
    snapshot.radarReady
  const opportunityDataAvailable = snapshot.quickPickAvailable ||
    snapshot.radarAvailable
  const health = useMemo(() => [
    ["LUNA_SHIPPING_WORKER", workerStatus],
    ["STOCK_GUARD", snapshot.stockGuard],
    ["NIGHT_RADAR", snapshot.nightRadar],
    ["ANALYTICS", snapshot.analytics],
    ["ORDERS", snapshot.orders],
  ] as const, [snapshot, workerStatus])

  return <>
    <div className="grid gap-4 md:grid-cols-2" data-primary-dashboard-block-count="4">
      <section data-dashboard-block="opportunities" className="rounded-3xl border border-emerald-200/20 bg-emerald-200/[0.06] p-5">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100/65">💰 Oportunidades para publicar</p>
        <div className="mt-3 flex items-end justify-between gap-4">
          <div><p className="text-4xl font-black">{opportunityDataAvailable ? opportunitiesReady : "—"}</p><p className="mt-1 text-sm text-white/55">{snapshot.quickPickAvailable && snapshot.radarAvailable ? "listas para revisar" : "lectura parcial"}</p></div>
          <a href="/admin/ebay/opportunity-queue/research" className="inline-flex min-h-11 items-center rounded-2xl border border-emerald-100/20 px-4 text-sm font-black text-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-200">Revisar</a>
        </div>
        <p className="mt-4 text-sm text-white/55">Quick Pick {snapshot.quickPickAvailable ? snapshot.quickPick.readyForReview : "—"} · Radar {snapshot.radarAvailable ? snapshot.radarReady : "—"} · En revisión {snapshot.radarAvailable ? snapshot.radarReview : "—"}</p>
      </section>

      <section data-dashboard-block="quick-pick" className="rounded-3xl border border-cyan-200/25 bg-cyan-200/[0.07] p-5">
        <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/65">⚡ Quick Pick Luna</p><h2 className="mt-1 text-xl font-black">Pega links y sigue trabajando</h2></div><a href="/admin/ebay/quick-pick" className="inline-flex min-h-11 items-center text-sm font-black text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Ver detalle</a></div>
        <form onSubmit={submitQuickPick} className="mt-3 flex gap-2">
          <label className="sr-only" htmlFor="dashboard-quick-pick-input">Pegar uno o varios links Luna</label>
          <textarea id="dashboard-quick-pick-input" value={input}
            onChange={(event) => setInput(event.target.value)} rows={2}
            placeholder="Pega uno o varios links Luna, uno por línea"
            className="min-h-14 min-w-0 flex-1 resize-none rounded-2xl border border-white/15 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-white/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200" />
          <button type="submit" disabled={submitting || !input.trim()}
            className="min-h-11 min-w-24 rounded-2xl bg-cyan-200 px-4 text-sm font-black text-black disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200">{submitting ? "Procesando…" : "Procesar"}</button>
        </form>
        <p aria-live="polite" className="mt-3 text-sm text-white/60">{feedback || (snapshot.quickPickAvailable ? `${snapshot.quickPick.inProgress} en proceso · ${snapshot.quickPick.readyForReview} para revisar · ${snapshot.quickPick.blocked} bloqueados` : "Operaciones no disponibles temporalmente")}</p>
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
      </section>
    </div>
    <iframe ref={workerFrame}
      src="/admin/ebay/luna-shipping-capture?dashboardWorker=1"
      title="Control plane Luna Shipping de Seller OS"
      aria-hidden="true" tabIndex={-1}
      className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0" />
  </>
}
