"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import type {
  RemoteLiveAttentionClass,
  RemoteLiveOptimizationOperatorDashboardV1,
  RemoteLiveOperatorListingV1,
} from "@/lib/ebay/ebay-remote-live-optimization-operator-v1"
import { signOutAdmin } from "@/lib/admin-auth"
import { supabase } from "@/lib/supabase"

type ReadState = "LOADING" | "STABLE" | "RETRYING"
type ActionPreview = Readonly<{
  eventId: string
  actionType: string
  targetValue: Readonly<Record<string, unknown>>
  confirmationRequired: string
}>

const sections: readonly Readonly<{
  key: RemoteLiveAttentionClass
  label: string
  explanation: string
}>[] = Object.freeze([
  { key: "NEEDS_ATTENTION", label: "🔴 Necesita atención",
    explanation: "Requisito o riesgo real que merece revisión." },
  { key: "CAN_IMPROVE", label: "🟠 Puede mejorar",
    explanation: "Oportunidad comercial respaldada por evidencia." },
  { key: "ENRICH", label: "✨ Enriquecer",
    explanation: "Contenido o imágenes que pueden quedar más claros." },
  { key: "WAIT", label: "🟢 No hacer nada todavía",
    explanation: "La evidencia actual no justifica un cambio." },
])

function money(value: unknown, currency = "USD") {
  if (value === null || value === undefined || value === "") return "—"
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat("es-US", { style: "currency", currency,
        maximumFractionDigits: 2 }).format(parsed)
    : "—"
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return "—"
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat("es-US", { maximumFractionDigits: 2 }).format(parsed)
    : "—"
}

function percent(value: unknown) {
  if (value === null || value === undefined || value === "") return "—"
  const parsed = Number(value)
  return Number.isFinite(parsed) ? `${parsed.toFixed(2)}%` : "—"
}

function shortDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—"
  return new Intl.DateTimeFormat("es", { month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit" }).format(new Date(value))
}

async function operatorRequest(path: string, init?: RequestInit) {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error("SESSION_REQUIRED")
  const response = await fetch(path, { ...init, cache: "no-store",
    headers: { ...(init?.headers ?? {}),
      Authorization: `Bearer ${data.session.access_token}` } })
  const payload = await response.json().catch(() => null) as
    Record<string, unknown> | null
  if (!response.ok || payload?.success !== true) {
    const problem = new Error(String(payload?.operatorMessage ??
      "Esta acción no está disponible ahora. No necesitas hacer nada."))
    Object.assign(problem, { code: payload?.error ?? "REMOTE_ACTION_FAILED" })
    throw problem
  }
  return payload
}

function SalesChart({ dashboard }: {
  dashboard: RemoteLiveOptimizationOperatorDashboardV1
}) {
  const [windowDays, setWindowDays] = useState<7 | 30>(7)
  const points = dashboard.results.series.slice(-windowDays)
  const maximum = Math.max(1, ...points.map((point) => point.sales))
  return <section className="rounded-3xl border border-emerald-200/15 bg-emerald-200/[0.055] p-4 sm:p-5"
    data-remote-sales-results>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100/65">📈 Resultados</p>
        <h2 className="mt-1 text-xl font-black">Resultados de la tienda</h2>
        <p className="mt-1 text-xs leading-5 text-white/50">Ventas oficiales de eBay · corte UTC. No atribuimos ventas a un cambio sin prueba.</p></div>
      <div className="flex rounded-xl border border-white/10 p-1" role="group"
        aria-label="Ventana del gráfico">
        {[7, 30].map((days) => <button key={days} type="button"
          onClick={() => setWindowDays(days as 7 | 30)}
          className={`min-h-11 min-w-12 rounded-lg px-3 text-xs font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-200 ${windowDays === days ? "bg-emerald-200 text-emerald-950" : "text-white/60"}`}>
          {days}d
        </button>)}
      </div>
    </div>
    <dl className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
      {([
        ["Ventas hoy", dashboard.results.salesToday],
        ["Ventas · 7 días", dashboard.results.salesLast7Days],
        ["Ingresos hoy", money(dashboard.results.revenueToday,
          dashboard.results.currency ?? "USD")],
        ["Ingresos · 7 días", money(dashboard.results.revenueLast7Days,
          dashboard.results.currency ?? "USD")],
        ["Listings con ventas", dashboard.results.listingsWithSales],
      ] as const).map(([label, value]) => <div key={label}
        className="min-w-0 rounded-2xl bg-black/20 p-3">
        <dt className="text-[11px] font-bold leading-4 text-white/45">{label}</dt>
        <dd className="mt-1 break-words text-xl font-black tabular-nums">{value ?? "—"}</dd>
      </div>)}
    </dl>
    <div className="mt-4 flex h-28 items-end gap-1 overflow-hidden rounded-2xl border border-white/[0.06] bg-black/20 px-3 pb-3 pt-4"
      aria-label={`Ventas por día, últimos ${windowDays} días`}>
      {points.map((point) => <div key={point.day}
        className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
        <span className="text-[9px] font-bold text-white/45">
          {point.sales || ""}
        </span>
        <span className="w-full min-w-1 rounded-t bg-emerald-300/80"
          style={{ height: `${Math.max(point.sales ? 8 : 2,
            point.sales / maximum * 68)}px` }} />
      </div>)}
    </div>
  </section>
}

function ListingMetrics({ listing }: { listing: RemoteLiveOperatorListingV1 }) {
  return <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
    {([
      ["Veces mostrado", number(listing.metrics.impressions)],
      ["Visitas", number(listing.metrics.views)],
      ["Entraron", percent(listing.metrics.ctrPercent)],
      ["Órdenes", number(listing.metrics.orders)],
      ["Unidades", number(listing.metrics.unitsSold)],
    ] as const).map(([label, value]) => <div key={label}
      className="rounded-xl bg-black/20 p-2.5">
      <dt className="text-[10px] font-bold text-white/40">{label}</dt>
      <dd className="mt-1 font-black tabular-nums">{value}</dd>
    </div>)}
  </dl>
}

function ActionPanel({ listing, onRefresh }: {
  listing: RemoteLiveOperatorListingV1
  onRefresh: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<ActionPreview | null>(null)
  const [message, setMessage] = useState("")

  const keyFor = useCallback(() => {
    if (!listing.action.eventId) return ""
    const storageKey = `remote-live-action:${listing.action.eventId}`
    const prior = window.localStorage.getItem(storageKey)
    if (prior) return prior
    const created = `remote-live-${crypto.randomUUID()}`
    window.localStorage.setItem(storageKey, created)
    return created
  }, [listing.action.eventId])

  async function prepare() {
    if (!listing.action.eventId || busy ||
        !["AVAILABLE", "AWAITING_CONFIRMATION"].includes(
          listing.action.status)) return
    setBusy(true)
    setMessage("")
    try {
      const payload = await operatorRequest(
        "/api/admin/ebay/live-optimization-operator", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: listing.action.kind === "OWNER_ESCALATION"
              ? "ESCALATE_OWNER" : "PREPARE_SAFE_LIVE_CHANGE",
            eventId: listing.action.eventId,
            idempotencyKey: keyFor(),
          }),
        })
      if (payload.outcome === "OWNER_APPROVAL_REQUIRED") {
        setMessage(String(payload.message ??
          "Necesita decisión del owner. Ya aparece en su Dashboard."))
        return
      }
      const candidate = payload.preview as ActionPreview | undefined
      if (!candidate?.eventId) throw new Error("PREVIEW_UNAVAILABLE")
      setPreview(candidate)
      setMessage("Revisa el cambio antes de confirmarlo.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message :
        "Esta acción no está disponible ahora. No necesitas hacer nada.")
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!listing.action.eventId || !preview || busy) return
    setBusy(true)
    setMessage("Aplicando una vez y verificando en eBay…")
    try {
      const payload = await operatorRequest(
        "/api/admin/ebay/live-optimization-operator", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "APPLY_SAFE_LIVE_CHANGE",
            eventId: listing.action.eventId, idempotencyKey: keyFor(),
            confirmed: true }),
        })
      if (payload.postActionReadbackPass !== true) {
        setMessage("Estamos verificando el cambio. No vuelvas a pulsar.")
        return
      }
      setMessage("Cambio confirmado por lectura oficial de eBay.")
      setPreview(null)
      await onRefresh()
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String(error.code) : ""
      setMessage(code.includes("OUTCOME_UNKNOWN")
        ? "Estamos verificando el cambio. No vuelvas a pulsar."
        : error instanceof Error ? error.message :
          "Esta acción no está disponible ahora. No necesitas hacer nada.")
    } finally {
      setBusy(false)
    }
  }

  if (["NO_ACTION", "REVIEW_GUIDANCE", "REVIEW_VISUAL"]
      .includes(listing.action.kind)) return null
  return <div className="mt-4 rounded-2xl border border-cyan-200/15 bg-cyan-200/[0.04] p-3">
    {listing.action.ownerReason && <p className="text-sm font-bold leading-6 text-amber-50">{listing.action.ownerReason}</p>}
    {preview && <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
      <div className="rounded-xl bg-black/20 p-3"><dt className="text-white/45">Actual</dt><dd className="mt-1 text-xl font-black">{money(preview.targetValue.currentPrice)}</dd></div>
      <div className="rounded-xl bg-black/20 p-3"><dt className="text-white/45">Propuesto</dt><dd className="mt-1 text-xl font-black text-cyan-100">{money(preview.targetValue.proposedPrice)}</dd></div>
      <div className="rounded-xl bg-black/20 p-3"><dt className="text-white/45">Beneficio esperado</dt><dd className="mt-1 font-black">{money(preview.targetValue.expectedNetProfit)}</dd></div>
      <div className="rounded-xl bg-black/20 p-3"><dt className="text-white/45">Margen esperado</dt><dd className="mt-1 font-black">{percent(preview.targetValue.expectedMarginPercent)}</dd></div>
    </dl>}
    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
      {!preview && <button type="button" onClick={() => void prepare()}
        disabled={busy || !["AVAILABLE", "AWAITING_CONFIRMATION"].includes(
          listing.action.status)}
        className="min-h-12 rounded-xl border border-cyan-200/35 px-5 text-sm font-black text-cyan-100 disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">
        {busy ? "REVISANDO…" : listing.action.label}
      </button>}
      {preview && <button type="button" onClick={() => setPreview(null)}
        disabled={busy}
        className="min-h-12 rounded-xl border border-white/15 px-5 text-sm font-black text-white/65 disabled:opacity-45">CANCELAR</button>}
      {preview && <button type="button" onClick={() => void apply()}
        disabled={busy}
        className="min-h-12 rounded-xl bg-cyan-200 px-5 text-sm font-black text-cyan-950 disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">
        {busy ? "VERIFICANDO…" : "CONFIRMAR CAMBIO"}
      </button>}
    </div>
    {message && <p aria-live="polite" className="mt-3 text-sm font-bold leading-5 text-white/65">{message}</p>}
  </div>
}

function ListingCard({ listing, onRefresh }: {
  listing: RemoteLiveOperatorListingV1
  onRefresh: () => Promise<void>
}) {
  return <article className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.035] p-4 sm:p-5"
    data-remote-live-listing={listing.ebayItemId}>
    <div className="flex min-w-0 items-start gap-3">
      {/* The URL is an official current-listing readback and may use several
          eBay CDN hosts, so a fixed Next Image host allowlist is inappropriate. */}
      {listing.imageUrl ? <img src={listing.imageUrl} alt=""
        className="h-20 w-20 shrink-0 rounded-2xl bg-white object-contain" />
        : <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-white/[0.05] text-2xl">📦</div>}
      <div className="min-w-0 flex-1">
        <h3 className="break-words text-base font-black leading-6">{listing.title}</h3>
        <p className="mt-1 text-xs text-white/45">Listing LIVE · {listing.sku ?? "SKU no visible"}</p>
        <p className="mt-3 text-sm font-black leading-6 text-white/90">{listing.humanSummary}</p>
      </div>
    </div>
    <div className="mt-4"><ListingMetrics listing={listing} /></div>
    <dl className="mt-4 space-y-3 text-sm leading-6">
      <div><dt className="font-black text-white/45">Por qué importa</dt><dd>{listing.whyNow}</dd></div>
      <div><dt className="font-black text-white/45">Seller OS recomienda</dt><dd>{listing.recommendation}</dd></div>
      <div><dt className="font-black text-white/45">Qué debes hacer</dt><dd>{listing.whatOperatorShouldDo}</dd></div>
      <div><dt className="font-black text-white/45">Beneficio esperado</dt><dd>{listing.expectedBenefit}</dd></div>
    </dl>
    <details className="mt-3 rounded-2xl border border-white/10 bg-black/15 p-3">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-black text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">ⓘ ¿Qué significa esto?</summary>
      <p className="mt-1 text-sm leading-6 text-white/65">{listing.helper}</p>
    </details>
    {listing.ebayGuidance.length > 0 && <details className="mt-2 rounded-2xl border border-white/10 p-3">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-black">Recomendaciones oficiales de eBay · {listing.ebayGuidance.length}</summary>
      <ul className="space-y-2 text-sm leading-6 text-white/70">{listing.ebayGuidance.map((item, index) => <li key={`${item.category}-${index}`} className="rounded-xl bg-black/20 p-3"><strong>{item.category}</strong><span className="block">{item.recommendation}</span></li>)}</ul>
    </details>}
    {listing.visualReview.findings.length > 0 && <details className="mt-2 rounded-2xl border border-white/10 p-3">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-black">Revisión de imagen · {listing.visualReview.findings.length}</summary>
      <ul className="space-y-2 text-sm leading-6 text-white/70">{listing.visualReview.findings.map((finding, index) => <li key={index} className="rounded-xl bg-black/20 p-3"><strong>{finding.observation}</strong><span className="block">{finding.whatToReview}</span></li>)}</ul>
    </details>}
    <ActionPanel listing={listing} onRefresh={onRefresh} />
    <details className="mt-2 text-xs text-white/40">
      <summary className="min-h-11 cursor-pointer py-3 font-bold">Ver evidencia técnica</summary>
      <p className="break-words leading-5">eBay Item ID {listing.ebayItemId} · identidad exacta {listing.evidence.exactListingIdentity ? "PASS" : "UNPROVEN"} · vínculo proveedor {listing.evidence.productTruthSupported ? "PASS" : "UNPROVEN"} · readback LIVE {listing.evidence.currentLiveReadback ? "PASS" : "UNPROVEN"}</p>
    </details>
  </article>
}

export function RemoteLiveOptimizationOperator({ embeddedForOwner = false }: {
  embeddedForOwner?: boolean
}) {
  const [dashboard, setDashboard] =
    useState<RemoteLiveOptimizationOperatorDashboardV1 | null>(null)
  const [readState, setReadState] = useState<ReadState>("LOADING")
  const [message, setMessage] = useState("")

  const load = useCallback(async () => {
    setReadState((state) => state === "STABLE" ? "STABLE" : "LOADING")
    try {
      const payload = await operatorRequest(
        "/api/admin/ebay/live-optimization-operator")
      const next = payload.dashboard as
        RemoteLiveOptimizationOperatorDashboardV1 | undefined
      if (!next?.contractVersion) throw new Error("DASHBOARD_UNAVAILABLE")
      setDashboard(next)
      setReadState("STABLE")
      setMessage("")
    } catch {
      setReadState("RETRYING")
      setMessage("No pude actualizar ahora · reintentando. No necesitas hacer nada.")
    }
  }, [])

  useEffect(() => {
    let active = true
    void load()
    const interval = window.setInterval(() => {
      if (active) void load()
    }, 30_000)
    return () => { active = false; window.clearInterval(interval) }
  }, [load])

  const grouped = useMemo(() => ({
    NEEDS_ATTENTION: dashboard?.listings.filter((listing) =>
      listing.attentionClass === "NEEDS_ATTENTION") ?? [],
    CAN_IMPROVE: dashboard?.listings.filter((listing) =>
      listing.attentionClass === "CAN_IMPROVE") ?? [],
    ENRICH: dashboard?.listings.filter((listing) =>
      listing.attentionClass === "ENRICH") ?? [],
    WAIT: dashboard?.listings.filter((listing) =>
      listing.attentionClass === "WAIT") ?? [],
  }) satisfies Record<RemoteLiveAttentionClass,
    readonly RemoteLiveOperatorListingV1[]>, [dashboard])

  async function logout() {
    await fetch("/api/admin/session", { method: "DELETE" }).catch(() => null)
    await signOutAdmin()
    window.location.replace("/admin/login")
  }

  return <section className={embeddedForOwner
    ? "mt-5 rounded-[32px] border border-violet-200/15 bg-violet-200/[0.035] p-4 sm:p-5"
    : "min-h-screen overflow-x-hidden bg-[#05070d] px-4 pb-12 pt-4 text-white sm:px-6"}
    data-remote-live-optimization-operator
    data-postsale-access="false"
    data-new-listing-publish-access="false">
    <div className={embeddedForOwner ? "" : "mx-auto max-w-6xl"}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
        <div className="min-w-0"><p className="text-xs font-black uppercase tracking-[0.2em] text-violet-100/65">Remote LIVE Optimization</p>
          <h1 className="mt-1 text-2xl font-black leading-tight sm:text-3xl">Qué necesita atención</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-white/55">Seller OS traduce las señales y protege cada cambio. No necesitas entrar a eBay ni usar herramientas técnicas.</p></div>
        {!embeddedForOwner && <button type="button" onClick={() => void logout()}
          className="min-h-11 rounded-xl border border-white/15 px-4 text-sm font-black text-white/65 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-200">Cerrar sesión</button>}
      </header>
      {message && <p aria-live="polite" className="mt-3 rounded-2xl border border-amber-200/15 bg-amber-200/[0.05] p-3 text-sm font-bold text-amber-50">{message}</p>}
      {!dashboard && <div className="mt-5 rounded-3xl border border-white/10 p-6 text-sm text-white/60">{readState === "RETRYING" ? "Esta vista no está disponible ahora. No necesitas hacer nada." : "Preparando tus tareas…"}</div>}
      {dashboard && <>
        {!dashboard.capabilities.safeLivePriceMutation &&
          <p className="mt-3 rounded-2xl border border-amber-200/15 bg-amber-200/[0.05] p-3 text-sm font-bold leading-6 text-amber-50">
            Vista en certificación · puedes revisar las señales, pero los cambios LIVE siguen cerrados hasta completar el canary físico.
          </p>}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Resumen de atención">
          {sections.map((section) => <div key={section.key}
            className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
            <p className="break-words text-[11px] font-black leading-4 text-white/55">{section.label}</p>
            <p className="mt-1 text-2xl font-black tabular-nums">{grouped[section.key].length}</p>
          </div>)}
        </div>
        <div className="mt-4"><SalesChart dashboard={dashboard} /></div>
        <div className="mt-5 space-y-6">
          {sections.map((section) => <section key={section.key}
            aria-labelledby={`remote-${section.key}`}>
            <div className="mb-3"><h2 id={`remote-${section.key}`}
              className="text-lg font-black">{section.label} · {grouped[section.key].length}</h2>
              <p className="mt-1 text-sm text-white/45">{section.explanation}</p></div>
            <div className="grid min-w-0 gap-3 xl:grid-cols-2">
              {grouped[section.key].map((listing) => <ListingCard
                key={listing.ebayItemId} listing={listing} onRefresh={load} />)}
              {!grouped[section.key].length && <p className="rounded-2xl border border-white/[0.06] p-4 text-sm text-white/40">No hay productos en esta sección.</p>}
            </div>
          </section>)}
        </div>
        <footer className="mt-6 rounded-2xl border border-white/10 p-4 text-xs leading-5 text-white/45">
          Sesión browser-only · cambios de precio con confirmación y readback oficial · promociones con gasto, publicaciones nuevas, fin de listings, credenciales y postventa son owner-only.
          {readState === "RETRYING" ? " · Mostrando el último estado válido mientras reintentamos." : ""}
          <span className="block mt-1">Última lectura: {shortDate(dashboard.generatedAt)}</span>
        </footer>
      </>}
    </div>
  </section>
}
