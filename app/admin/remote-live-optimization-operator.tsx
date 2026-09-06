"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ChartNoAxesCombined,
  CircleHelp,
  ClipboardList,
  History,
  Home,
  ImagePlus,
  LogOut,
  Radio,
  RefreshCw,
  Sparkles,
} from "lucide-react"

import type {
  RemoteLiveAttentionClass,
  RemoteLiveOptimizationOperatorDashboardV1,
  RemoteLiveOperatorListingV1,
} from "@/lib/ebay/ebay-remote-live-optimization-operator-v1"
import { signOutAdmin } from "@/lib/admin-auth"
import { remoteLiveOperatorDisplayNameFromUser } from
  "@/lib/remote-live-operator-identity"
import { supabase } from "@/lib/supabase"
import { MayelVisualWorkstation } from "@/app/admin/mayel-visual-workstation"

type ReadState = "LOADING" | "STABLE" | "RETRYING"
type OperatorView = "HOME" | "TASKS" | "LIVE" | "SUGGESTIONS" |
  "VISUAL" | "RESULTS" | "HISTORY" | "HELP"
type ActionStage = "IDLE" | "APPLYING" | "VERIFYING" | "CONFIRMED" |
  "UNKNOWN"

type ActionPreview = Readonly<{
  eventId: string
  actionType: string
  targetValue: Readonly<Record<string, unknown>>
  confirmationRequired: string
}>

const navigation = Object.freeze([
  { key: "HOME" as const, label: "Inicio", icon: Home },
  { key: "TASKS" as const, label: "Mis tareas", icon: ClipboardList },
  { key: "LIVE" as const, label: "Listings LIVE", icon: Radio },
  { key: "SUGGESTIONS" as const, label: "Mejoras sugeridas", icon: Sparkles },
  { key: "VISUAL" as const, label: "Estación visual", icon: ImagePlus },
  { key: "RESULTS" as const, label: "Resultados", icon: ChartNoAxesCombined },
  { key: "HISTORY" as const, label: "Historial", icon: History },
  { key: "HELP" as const, label: "Ayuda", icon: CircleHelp },
])

const sections: readonly Readonly<{
  key: RemoteLiveAttentionClass
  label: string
  explanation: string
  accent: string
}>[] = Object.freeze([
  { key: "NEEDS_ATTENTION", label: "Necesita atención",
    explanation: "Hay algo que conviene revisar hoy.", accent: "#b75d43" },
  { key: "CAN_IMPROVE", label: "Puede mejorar",
    explanation: "Seller OS encontró una oportunidad respaldada.",
    accent: "#b88958" },
  { key: "ENRICH", label: "Enriquecer",
    explanation: "La presentación puede quedar más clara.", accent: "#1d5961" },
  { key: "WAIT", label: "No hacer nada todavía",
    explanation: "Todavía no hay una razón suficiente para cambiar.",
    accent: "#74866d" },
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

function shortDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—"
  return new Intl.DateTimeFormat("es", { month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit" }).format(new Date(value))
}

function dayLabel(value: string) {
  if (!Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))) return value
  return new Intl.DateTimeFormat("es", { weekday: "short", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00.000Z`)).replace(".", "")
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
  const points = dashboard.results.series.slice(-7)
  const maximum = Math.max(1, ...points.map((point) => point.sales))
  const coordinates = points.map((point, index) => {
    const x = points.length > 1 ? index / (points.length - 1) * 100 : 50
    const y = 84 - point.sales / maximum * 66
    return { ...point, x, y }
  })
  const polyline = coordinates.map((point) => `${point.x},${point.y}`).join(" ")
  return <section className="rounded-[28px] border border-[#d9d1c4] bg-[#fffdf8] p-5 shadow-[0_18px_50px_rgba(55,45,32,0.07)] sm:p-7"
    data-remote-sales-results>
    <div className="max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1d5961]">Resultados oficiales</p>
      <h2 className="mt-2 font-serif text-2xl font-semibold leading-tight text-[#242724] sm:text-3xl">Resultados de la tienda</h2>
      <p className="mt-2 text-sm leading-6 text-[#64675f]">Pedidos confirmados por eBay. Las ventas no se atribuyen a una acción sin prueba.</p>
    </div>
    <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {([
        ["Ventas hoy", dashboard.results.salesToday],
        ["Ventas en 7 días", dashboard.results.salesLast7Days],
        ["Ingresos en 7 días", money(dashboard.results.revenueLast7Days,
          dashboard.results.currency ?? "USD")],
        ["Listings con ventas", dashboard.results.listingsWithSales],
      ] as const).map(([label, value]) => <div key={label}
        className="min-w-0 rounded-2xl bg-[#f4efe7] p-4">
        <dt className="text-xs font-medium leading-5 text-[#6f716b]">{label}</dt>
        <dd className="mt-2 break-words text-2xl font-semibold tabular-nums text-[#242724]">{value ?? "—"}</dd>
      </div>)}
    </dl>
    <div className="mt-6 rounded-2xl border border-[#e5ded3] bg-[#faf7f1] p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[#343834]">Ventas por día</h3>
        <span className="text-xs text-[#777a73]">Últimos 7 días</span>
      </div>
      {coordinates.length ? <>
        <svg viewBox="0 0 100 92" role="img"
          aria-label="Gráfico de ventas por día de los últimos siete días"
          className="mt-3 h-40 w-full overflow-visible" preserveAspectRatio="none">
          <path d="M0 84 H100" stroke="#d8d2c7" strokeWidth="0.7" />
          <polyline points={polyline} fill="none" stroke="#1d5961"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          {coordinates.map((point) => <g key={point.day}>
            <circle cx={point.x} cy={point.y} r="2.6" fill="#f8f2e8"
              stroke="#1d5961" strokeWidth="1.4" />
            <text x={point.x} y={Math.max(8, point.y - 7)}
              textAnchor="middle" fill="#4f554f" fontSize="5.5"
              fontWeight="700">{point.sales}</text>
          </g>)}
        </svg>
        <div className="grid grid-cols-7 gap-1" aria-hidden="true">
          {points.map((point) => <span key={point.day}
            className="text-center text-[10px] font-medium uppercase text-[#7a7d76]">{dayLabel(point.day)}</span>)}
        </div>
      </> : <p className="py-12 text-center text-sm text-[#777a73]">Los pedidos oficiales no están disponibles ahora.</p>}
    </div>
  </section>
}

function ImpactCard({ dashboard }: {
  dashboard: RemoteLiveOptimizationOperatorDashboardV1
}) {
  if (!dashboard.impact.visible) return null
  return <section className="rounded-[28px] bg-[#1d5961] p-6 text-white shadow-[0_18px_50px_rgba(29,89,97,0.18)] sm:p-7">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/65">Tu impacto</p>
    <h2 className="mt-2 font-serif text-2xl font-semibold">Tu trabajo queda registrado</h2>
    <p className="mt-2 max-w-2xl text-sm leading-6 text-white/75">Revisaste {dashboard.impact.auditedActionCount} {dashboard.impact.auditedActionCount === 1 ? "acción" : "acciones"} en {dashboard.impact.auditedListingCount} {dashboard.impact.auditedListingCount === 1 ? "listing" : "listings"}. Esto muestra actividad comprobada; no afirma que una venta haya sido causada por un cambio.</p>
  </section>
}

function SupportingNumbers({ listing }: { listing: RemoteLiveOperatorListingV1 }) {
  return <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {([
      ["Apariciones en eBay", number(listing.metrics.impressions)],
      ["Visitas al producto", number(listing.metrics.views)],
      ["Compras oficiales", number(listing.metrics.orders)],
      ["Unidades vendidas", number(listing.metrics.unitsSold)],
    ] as const).map(([label, value]) => <div key={label}
      className="rounded-xl bg-[#f4efe7] p-3">
      <dt className="text-[11px] font-medium leading-4 text-[#73766f]">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums text-[#292d29]">{value}</dd>
    </div>)}
  </dl>
}

function ImageProposalReview({ listing, canReview, onRefresh }: {
  listing: RemoteLiveOperatorListingV1
  canReview: boolean
  onRefresh: () => Promise<void>
}) {
  const proposal = listing.imageProposal
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  if (!proposal) return null

  async function review(decision: "APPROVE" | "REJECT") {
    if (!proposal?.reviewAllowed || proposal.reviewDecision || busy ||
        !canReview) return
    setBusy(true)
    setMessage("")
    try {
      const payload = await operatorRequest(
        "/api/admin/ebay/live-optimization-operator", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "REVIEW_IMAGE_PROPOSAL",
            proposalId: proposal.proposalId, decision }),
        })
      setMessage(String(payload.message ??
        "Revisión guardada. No se publicó ningún cambio."))
      await onRefresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message :
        "No pude guardar esta revisión. No se publicó ningún cambio.")
    } finally {
      setBusy(false)
    }
  }

  return <section className="mt-5 rounded-2xl border border-[#d7cfc2] bg-[#f7f2ea] p-4 sm:p-5"
    data-image-enrichment-review>
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d5961]">Revisión visual preparada</p>
      <h4 className="mt-1 font-serif text-xl font-semibold text-[#292d29]">Actual vs Propuesta</h4>
    </div>
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <figure className="min-w-0">
        <figcaption className="mb-2 text-sm font-semibold text-[#5c605a]">Actual</figcaption>
        <div className="aspect-square overflow-hidden rounded-2xl border border-[#ded7cc] bg-white">
          {proposal.currentImageUrl ? <img src={proposal.currentImageUrl}
            alt={`Imagen actual de ${listing.title}`}
            className="h-full w-full object-contain" /> :
            <div className="flex h-full items-center justify-center text-sm text-[#777a73]">Imagen no disponible</div>}
        </div>
      </figure>
      <figure className="min-w-0">
        <figcaption className="mb-2 text-sm font-semibold text-[#1d5961]">Propuesta</figcaption>
        <div className="grid grid-cols-2 gap-2">
          <img src={proposal.proposedMainImageUrl}
            alt={`Imagen principal propuesta para ${listing.title}`}
            className="aspect-square h-full w-full rounded-2xl border border-[#cad6d2] bg-white object-contain" />
          {proposal.proposedLifestyleImageUrl && <img
            src={proposal.proposedLifestyleImageUrl}
            alt={`Imagen de contexto propuesta para ${listing.title}`}
            className="aspect-square h-full w-full rounded-2xl border border-[#cad6d2] bg-white object-contain" />}
        </div>
      </figure>
    </div>
    <p className="mt-4 rounded-xl bg-white/75 p-3 text-sm leading-6 text-[#535852]">Comprueba que el producto se vea correcto y que no aparezcan accesorios o funciones que no vienen incluidos.</p>
    {proposal.reviewDecision ? <p className="mt-3 rounded-xl bg-[#dfe8de] p-3 text-sm font-semibold text-[#354436]">
      {proposal.reviewDecision === "APPROVE" ? "Propuesta aprobada" : "Propuesta rechazada"} · no se publicó ningún cambio.
    </p> : proposal.reviewAllowed && canReview ? <div className="mt-4 grid gap-2 sm:grid-cols-2">
      <button type="button" disabled={busy}
        onClick={() => void review("REJECT")}
        className="min-h-12 rounded-xl border border-[#b76e52]/50 px-5 text-sm font-semibold text-[#8b4e3a] transition hover:bg-[#f3e5df] disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#b76e52]">Rechazar propuesta</button>
      <button type="button" disabled={busy}
        onClick={() => void review("APPROVE")}
        className="min-h-12 rounded-xl bg-[#1d5961] px-5 text-sm font-semibold text-white transition hover:bg-[#174a51] disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1d5961]">{busy ? "Guardando revisión…" : "Aprobar propuesta"}</button>
    </div> : <p className="mt-3 text-sm leading-6 text-[#74776f]">La propuesta permanecerá sin cambios hasta que la operadora complete su revisión.</p>}
    {message && <p aria-live="polite" className="mt-3 text-sm font-medium leading-6 text-[#4f554f]">{message}</p>}
  </section>
}

function SafeMutationCanaryPanel({ listing, canApply, canAuthorize,
  onRefresh }: {
  listing: RemoteLiveOperatorListingV1
  canApply: boolean
  canAuthorize: boolean
  onRefresh: () => Promise<void>
}) {
  const canary = listing.safeMutationCanary
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<ActionStage>("IDLE")
  const [message, setMessage] = useState("")
  const [confirmedAuthorizationDigest, setConfirmedAuthorizationDigest] =
    useState("")
  if (!canary) return null
  const activeCanary: NonNullable<
    RemoteLiveOperatorListingV1["safeMutationCanary"]> = canary
  const ownerConfirmedExactProposal = confirmedAuthorizationDigest ===
    activeCanary.authorizationDigest

  if (canApply && activeCanary.ownerApprovalStatus ===
      "PENDING_OWNER_APPROVAL") return null

  function stableApplyKey() {
    if (!activeCanary.authorizationId) return ""
    const storageKey = `remote-title-canary:${activeCanary.authorizationId}`
    const prior = window.localStorage.getItem(storageKey)
    if (prior) return prior
    const created = `remote-title-${crypto.randomUUID()}`
    window.localStorage.setItem(storageKey, created)
    return created
  }

  async function authorize() {
    if (!canAuthorize || busy || activeCanary.ownerApprovalStatus !==
        "PENDING_OWNER_APPROVAL" || !ownerConfirmedExactProposal) return
    setBusy(true)
    setMessage("")
    try {
      const payload = await operatorRequest(
        "/api/admin/ebay/live-optimization-operator", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "AUTHORIZE_SAFE_MUTATION_CANARY",
            ebayItemId: activeCanary.ebayItemId,
            sourceSignalId: activeCanary.sourceSignalId,
            currentValue: activeCanary.currentValue,
            proposedValue: activeCanary.proposedValue,
            authorizationVersion: activeCanary.authorizationVersion,
            authorizationDigest: activeCanary.authorizationDigest }),
        })
      setMessage(String(payload.message ??
        "Mejora autorizada para Mayel. Todavía no se aplicó ningún cambio."))
      await onRefresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message :
        "No se pudo autorizar. No se aplicó ningún cambio.")
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!canApply || !activeCanary.authorizationId ||
        !activeCanary.applyAvailable || busy ||
        activeCanary.ownerApprovalStatus !== "AUTHORIZED") return
    setBusy(true)
    setMessage("")
    setStage("APPLYING")
    const verifyingTimer = window.setTimeout(() => setStage("VERIFYING"), 700)
    try {
      const payload = await operatorRequest(
        "/api/admin/ebay/live-optimization-operator", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "APPLY_SAFE_MUTATION_CANARY",
            authorizationId: activeCanary.authorizationId,
            idempotencyKey: stableApplyKey(),
            ebayItemId: activeCanary.ebayItemId,
            currentValue: activeCanary.currentValue,
            proposedValue: activeCanary.proposedValue,
            authorizationVersion: activeCanary.authorizationVersion,
            authorizationDigest: activeCanary.authorizationDigest }),
        })
      window.clearTimeout(verifyingTimer)
      if (payload.postActionReadbackPass !== true) {
        setStage("UNKNOWN")
        setMessage("Estamos verificando el cambio. No vuelvas a pulsar.")
        return
      }
      setStage("CONFIRMED")
      setMessage("Cambio confirmado ✓")
      await onRefresh()
    } catch (error) {
      window.clearTimeout(verifyingTimer)
      const code = error && typeof error === "object" && "code" in error
        ? String(error.code) : ""
      if (code === "REMOTE_OPERATOR_CANARY_AUTHORIZATION_INVALIDATED") {
        setStage("IDLE")
        setMessage("La autorización ya no es válida porque el título actual cambió. No se aplicó ningún cambio.")
      } else if (code.includes("OUTCOME_UNKNOWN") ||
          code.includes("WRITE_IN_PROGRESS")) {
        setStage("UNKNOWN")
        setMessage("Estamos verificando el cambio. No vuelvas a pulsar.")
      } else {
        setStage("IDLE")
        setMessage(error instanceof Error ? error.message :
          "Esta acción no está disponible ahora. No necesitas hacer nada.")
      }
    } finally {
      setBusy(false)
    }
  }

  return <section className="mt-5 rounded-2xl border border-[#b8ccc6] bg-[#edf3f1] p-4 sm:p-5"
    data-safe-live-mutation-canary>
    <h4 className="font-serif text-xl font-semibold text-[#292d29]">
      {canApply ? "Revisar propuesta" : "Autorizar mejora"}
    </h4>
    {canAuthorize && <p className="mt-2 text-sm font-semibold text-[#535852]">
      Item ID: {activeCanary.ebayItemId}
    </p>}
    <dl className="mt-4 grid gap-3 md:grid-cols-2">
      <div className="min-w-0 rounded-xl bg-white p-4">
        <dt className="text-sm font-semibold text-[#73766f]">Actual</dt>
        <dd className="mt-2 break-words text-sm leading-6 text-[#292d29]">{activeCanary.currentValue}</dd>
      </div>
      <div className="min-w-0 rounded-xl bg-white p-4">
        <dt className="text-sm font-semibold text-[#1d5961]">Propuesta Seller OS</dt>
        <dd className="mt-2 break-words text-sm font-semibold leading-6 text-[#1d5961]">{activeCanary.proposedValue}</dd>
      </div>
    </dl>
    <p className="mt-3 rounded-xl bg-white/80 p-3 text-sm leading-6 text-[#535852]">{activeCanary.humanExplanation}</p>
    {stage !== "IDLE" && <ol className="mt-4 grid gap-2 text-sm sm:grid-cols-3"
      aria-live="polite">
      {[["APPLYING", "Aplicando cambio…"],
        ["VERIFYING", "Verificando con eBay…"],
        ["CONFIRMED", "Cambio confirmado ✓"]].map(([key, label], index) => {
        const activeIndex = stage === "APPLYING" ? 0 :
          stage === "VERIFYING" || stage === "UNKNOWN" ? 1 : 2
        return <li key={key}
          className={`rounded-xl px-3 py-3 font-medium ${index <= activeIndex
            ? "bg-[#1d5961] text-white" : "bg-white text-[#85877f]"}`}>
          {label}
        </li>
      })}
    </ol>}
    {activeCanary.authorizationInvalidated &&
      <p className="mt-4 rounded-xl bg-[#f7e9de] p-3 text-sm font-semibold leading-6 text-[#704d3c]">La autorización ya no es válida porque el título actual cambió. No se aplicó ningún cambio.</p>}
    {activeCanary.ownerApprovalStatus === "WRITE_FAILED" &&
      <p className="mt-4 rounded-xl bg-[#f7e9de] p-3 text-sm font-semibold leading-6 text-[#704d3c]">
        {activeCanary.failureMessage ??
          "eBay rechazó el cambio. No se aplicó ningún cambio."}
      </p>}
    {activeCanary.ownerApprovalStatus === "AUTHORIZED" && !canApply &&
      <p className="mt-4 text-sm font-semibold leading-6 text-[#3f574f]">Autorizada para una única acción de Mayel.</p>}
    {canAuthorize && activeCanary.ownerApprovalStatus ===
      "PENDING_OWNER_APPROVAL" && <label className="mt-4 flex cursor-pointer gap-3 rounded-xl border border-[#b8ccc6] bg-white p-4 text-sm leading-6 text-[#3f4540]">
      <input type="checkbox" className="mt-1 h-5 w-5 shrink-0"
        checked={ownerConfirmedExactProposal}
        onChange={(event) => setConfirmedAuthorizationDigest(
          event.target.checked ? activeCanary.authorizationDigest : "",
        )} />
      <span>Confirmo que autorizo para este Item ID el valor actual y la propuesta exacta mostrados arriba.</span>
    </label>}
    <div className="mt-4 flex justify-end">
      {canAuthorize && activeCanary.ownerApprovalStatus ===
        "PENDING_OWNER_APPROVAL" && <button type="button"
        onClick={() => void authorize()}
        disabled={busy || !ownerConfirmedExactProposal}
        className="min-h-12 rounded-xl bg-[#1d5961] px-5 text-sm font-semibold text-white disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1d5961]">
        {busy ? "Autorizando…" : "Autorizar esta mejora para Mayel"}
      </button>}
      {canApply && activeCanary.ownerApprovalStatus === "AUTHORIZED" &&
        <button type="button" onClick={() => void apply()}
          disabled={busy || !activeCanary.applyAvailable || stage === "UNKNOWN"}
          className="min-h-12 rounded-xl bg-[#1d5961] px-5 text-sm font-semibold text-white disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1d5961]">
          {busy ? "Aplicando…" : "Aplicar esta mejora"}
        </button>}
    </div>
    {message && <p aria-live="polite"
      className="mt-3 text-sm font-medium leading-6 text-[#4f554f]">{message}</p>}
  </section>
}

function ActionPanel({ listing, canAct, onRefresh }: {
  listing: RemoteLiveOperatorListingV1
  canAct: boolean
  onRefresh: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<ActionPreview | null>(null)
  const [message, setMessage] = useState("")
  const [stage, setStage] = useState<ActionStage>("IDLE")

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
    if (!listing.action.eventId || busy || !canAct ||
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
          "Necesita aprobación del owner."))
        return
      }
      const candidate = payload.preview as ActionPreview | undefined
      if (!candidate?.eventId) throw new Error("PREVIEW_UNAVAILABLE")
      setPreview(candidate)
      setMessage("Compara el valor actual con la propuesta antes de confirmar.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message :
        "Esta acción no está disponible ahora. No necesitas hacer nada.")
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!listing.action.eventId || !preview || busy || !canAct) return
    setBusy(true)
    setMessage("")
    setStage("APPLYING")
    const verifyingTimer = window.setTimeout(() => setStage("VERIFYING"), 700)
    try {
      const payload = await operatorRequest(
        "/api/admin/ebay/live-optimization-operator", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "APPLY_SAFE_LIVE_CHANGE",
            eventId: listing.action.eventId, idempotencyKey: keyFor(),
            confirmed: true }),
        })
      window.clearTimeout(verifyingTimer)
      if (payload.postActionReadbackPass !== true) {
        setStage("UNKNOWN")
        setMessage("Estamos verificando el cambio. No vuelvas a pulsar.")
        setPreview(null)
        return
      }
      setStage("CONFIRMED")
      setMessage("Cambio confirmado ✓")
      setPreview(null)
      await onRefresh()
    } catch (error) {
      window.clearTimeout(verifyingTimer)
      const code = error && typeof error === "object" && "code" in error
        ? String(error.code) : ""
      if (code.includes("OUTCOME_UNKNOWN")) {
        setStage("UNKNOWN")
        setMessage("Estamos verificando el cambio. No vuelvas a pulsar.")
        setPreview(null)
      } else {
        setStage("IDLE")
        setMessage(error instanceof Error ? error.message :
          "Esta acción no está disponible ahora. No necesitas hacer nada.")
      }
    } finally {
      setBusy(false)
    }
  }

  if (["NO_ACTION", "REVIEW_GUIDANCE", "REVIEW_VISUAL"]
      .includes(listing.action.kind)) return null
  return <div className="mt-5 rounded-2xl border border-[#c9d7d4] bg-[#edf3f1] p-4">
    {listing.action.ownerReason && <p className="text-sm font-semibold leading-6 text-[#684d3e]">{listing.action.ownerReason}</p>}
    {preview && <dl className="mt-3 grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl bg-white p-4"><dt className="text-sm text-[#73766f]">Actual</dt><dd className="mt-1 text-2xl font-semibold">{money(preview.targetValue.currentPrice)}</dd></div>
      <div className="rounded-xl bg-white p-4"><dt className="text-sm text-[#1d5961]">Propuesto</dt><dd className="mt-1 text-2xl font-semibold text-[#1d5961]">{money(preview.targetValue.proposedPrice)}</dd></div>
      <div className="rounded-xl bg-white p-4"><dt className="text-sm text-[#73766f]">Beneficio estimado</dt><dd className="mt-1 font-semibold">{money(preview.targetValue.expectedNetProfit)}</dd></div>
      <div className="rounded-xl bg-white p-4"><dt className="text-sm text-[#73766f]">Margen protegido</dt><dd className="mt-1 font-semibold">{number(preview.targetValue.expectedMarginPercent)}%</dd></div>
    </dl>}
    {stage !== "IDLE" && <ol className="mt-4 grid gap-2 text-sm sm:grid-cols-3" aria-live="polite">
      {[
        ["APPLYING", "Aplicando cambio…"],
        ["VERIFYING", "Verificando con eBay…"],
        ["CONFIRMED", "Cambio confirmado ✓"],
      ].map(([key, label], index) => {
        const activeIndex = stage === "APPLYING" ? 0 :
          stage === "VERIFYING" || stage === "UNKNOWN" ? 1 : 2
        return <li key={key} className={`rounded-xl px-3 py-3 font-medium ${index <= activeIndex ? "bg-[#1d5961] text-white" : "bg-white text-[#85877f]"}`}>{label}</li>
      })}
    </ol>}
    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
      {!preview && stage !== "UNKNOWN" && <button type="button"
        onClick={() => void prepare()} disabled={busy || !canAct ||
          !["AVAILABLE", "AWAITING_CONFIRMATION"].includes(
            listing.action.status)}
        className="min-h-12 rounded-xl border border-[#1d5961]/40 px-5 text-sm font-semibold text-[#1d5961] disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1d5961]">
        {busy ? "Preparando…" : listing.action.label}
      </button>}
      {preview && <button type="button" onClick={() => setPreview(null)}
        disabled={busy}
        className="min-h-12 rounded-xl border border-[#b9b4ab] px-5 text-sm font-semibold text-[#666a63] disabled:opacity-45">Cancelar</button>}
      {preview && <button type="button" onClick={() => void apply()}
        disabled={busy}
        className="min-h-12 rounded-xl bg-[#1d5961] px-5 text-sm font-semibold text-white disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1d5961]">
        Confirmar cambio
      </button>}
    </div>
    {!canAct && <p className="mt-3 text-sm leading-6 text-[#73766f]">La vista owner es sólo una previsualización. La operadora verá el control cuando su acceso esté habilitado.</p>}
    {message && <p aria-live="polite" className="mt-3 text-sm font-medium leading-6 text-[#4f554f]">{message}</p>}
  </div>
}

function ListingCard({ listing, canAct, onRefresh }: {
  listing: RemoteLiveOperatorListingV1
  canAct: boolean
  onRefresh: () => Promise<void>
}) {
  return <article className="min-w-0 overflow-hidden rounded-[28px] border border-[#d9d1c4] bg-[#fffdf8] shadow-[0_18px_50px_rgba(55,45,32,0.06)]"
    data-remote-live-listing={listing.ebayItemId}>
    <div className="grid min-w-0 gap-0 md:grid-cols-[minmax(230px,0.78fr)_minmax(0,1.22fr)]">
      <div className="flex min-h-64 items-center justify-center bg-[#f1ece3] p-5">
        {listing.imageUrl ? <img src={listing.imageUrl}
          alt={`Producto ${listing.title}`}
          className="aspect-square max-h-80 w-full rounded-2xl bg-white object-contain" />
          : <div className="flex aspect-square w-full max-w-72 items-center justify-center rounded-2xl bg-white text-sm text-[#777a73]">Imagen no disponible</div>}
      </div>
      <div className="min-w-0 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#1d5961]">Listing activo en eBay</p>
        <h3 className="mt-2 break-words font-serif text-2xl font-semibold leading-tight text-[#242724]">{listing.title}</h3>
        <p className="mt-2 break-words text-xs text-[#7a7d76]">{listing.sku ?? "Identificador no visible"}</p>
        {listing.canonicalTask?.actionBlockedByEvidence && <p
          className="mt-4 rounded-xl bg-[#f2e7dd] p-3 text-sm font-semibold leading-6 text-[#704d3c]">
          No tenemos suficiente información todavía. No necesitas hacer nada.
        </p>}
        <dl className="mt-6 space-y-4 text-sm leading-6 text-[#454a45]">
          <div><dt className="font-semibold text-[#242724]">Qué está pasando</dt><dd className="mt-1">{listing.humanSummary}</dd></div>
          <div><dt className="font-semibold text-[#242724]">Por qué importa</dt><dd className="mt-1">{listing.whyNow}</dd></div>
          <div><dt className="font-semibold text-[#242724]">Qué recomienda Seller OS</dt><dd className="mt-1">{listing.recommendation}</dd></div>
          <div><dt className="font-semibold text-[#242724]">Qué hacer ahora</dt><dd className="mt-1">{listing.whatOperatorShouldDo}</dd></div>
        </dl>
      </div>
    </div>
    <div className="border-t border-[#e4ddd2] p-5 sm:p-6">
      <details className="rounded-2xl border border-[#d9d1c4] bg-[#faf7f1] p-3">
        <summary className="min-h-12 cursor-pointer py-3 text-sm font-semibold text-[#1d5961] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1d5961]">ⓘ ¿Qué significa esto?</summary>
        <p className="mt-1 text-sm leading-6 text-[#5f645e]">{listing.helper}</p>
      </details>
      <details className="mt-2 rounded-2xl border border-[#e0d9ce] p-3">
        <summary className="min-h-12 cursor-pointer py-3 text-sm font-semibold text-[#555a54]">Ver datos de apoyo</summary>
        <div className="mt-2"><SupportingNumbers listing={listing} /></div>
      </details>
      {listing.officialQualitySignals.length > 0 && <section
        className="mt-2 rounded-2xl border border-[#cbd4c2] bg-[#f4f6ef] p-4"
        aria-label="Mejoras oficiales de eBay">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#617159]">Señal oficial de eBay</p>
        <div className="mt-3 space-y-3">{listing.officialQualitySignals.map((signal, index) =>
          <div key={signal.signalId || `${signal.signalType}-${index}`} className="rounded-xl bg-white p-3 text-sm leading-6 text-[#50564f]">
            <p className="font-semibold text-[#292d29]">{signal.whatIsHappening}</p>
            <p className="mt-1">{signal.sellerOsRecommendation}</p>
            {signal.productTruthSupported && signal.proposedValue && <p className="mt-2 font-semibold text-[#1d5961]">
              {signal.proposedField}: {signal.proposedValue}
              <span className="block text-xs font-medium text-[#617159]">Fuente: Producto exacto ✓</span>
            </p>}
            <p className="mt-2"><strong>Acción:</strong> {signal.operatorActionRequired ? "REVISAR" : "No necesitas hacer nada"}</p>
          </div>)}</div>
      </section>}
      {listing.ebayGuidance.length > 0 && <details className="mt-2 rounded-2xl border border-[#e0d9ce] p-3">
        <summary className="min-h-12 cursor-pointer py-3 text-sm font-semibold text-[#555a54]">Sugerencias recibidas de eBay</summary>
        <ul className="mt-2 space-y-2 text-sm leading-6 text-[#5f645e]">{listing.ebayGuidance.map((item, index) => <li key={`${item.category}-${index}`} className="rounded-xl bg-[#f4efe7] p-3"><strong className="text-[#303430]">{item.category}</strong><span className="block">{item.recommendation}</span></li>)}</ul>
      </details>}
      <ImageProposalReview listing={listing} canReview={canAct}
        onRefresh={onRefresh} />
      {!listing.imageProposal && listing.visualReview.findings.length > 0 && <details className="mt-2 rounded-2xl border border-[#e0d9ce] p-3">
        <summary className="min-h-12 cursor-pointer py-3 text-sm font-semibold text-[#555a54]">Observaciones sobre la imagen actual</summary>
        <ul className="mt-2 space-y-2 text-sm leading-6 text-[#5f645e]">{listing.visualReview.findings.map((finding, index) => <li key={index} className="rounded-xl bg-[#f4efe7] p-3"><strong className="text-[#303430]">{finding.observation}</strong><span className="block">{finding.whatToReview}</span></li>)}</ul>
      </details>}
      <SafeMutationCanaryPanel listing={listing} canApply={canAct}
        canAuthorize={!canAct} onRefresh={onRefresh} />
      {!listing.safeMutationCanary && <ActionPanel listing={listing}
        canAct={canAct} onRefresh={onRefresh} />}
    </div>
  </article>
}

function AttentionSummary({ grouped }: {
  grouped: Record<RemoteLiveAttentionClass,
    readonly RemoteLiveOperatorListingV1[]>
}) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"
    aria-label="Resumen de atención">
    {sections.map((section) => <div key={section.key}
      className="min-w-0 rounded-2xl border border-[#d9d1c4] bg-[#fffdf8] p-4">
      <span className="block h-1.5 w-10 rounded-full"
        style={{ backgroundColor: section.accent }} />
      <p className="mt-3 break-words text-xs font-semibold leading-5 text-[#5c605a]">{section.label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-[#242724]">{grouped[section.key].length}</p>
    </div>)}
  </div>
}

function ListingCollection({ listings, canAct, onRefresh,
  emptyMessage = "No hay productos aquí por ahora." }: {
  listings: readonly RemoteLiveOperatorListingV1[]
  canAct: boolean
  onRefresh: () => Promise<void>
  emptyMessage?: string
}) {
  if (!listings.length) return <p className="rounded-2xl border border-[#d9d1c4] bg-[#fffdf8] p-6 text-sm text-[#6f736c]">{emptyMessage}</p>
  return <div className="space-y-5">{listings.map((listing) =>
    <ListingCard key={listing.ebayItemId} listing={listing}
      canAct={canAct} onRefresh={onRefresh} />)}</div>
}

function OperatorNavigation({ view, onChange, onLogout, side = false }: {
  view: OperatorView
  onChange: (view: OperatorView) => void
  onLogout: () => Promise<void>
  side?: boolean
}) {
  return <nav aria-label="Menú de operadora"
    className={side ? "space-y-1" :
      "grid grid-cols-2 gap-2 sm:grid-cols-4"}>
    {navigation.map((item) => {
      const Icon = item.icon
      const active = view === item.key
      return <button key={item.key} type="button" onClick={() => onChange(item.key)}
        aria-current={active ? "page" : undefined}
        className={`flex min-h-12 min-w-0 items-center gap-2 rounded-xl px-3 text-left text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1d5961] ${active ? "bg-[#1d5961] text-white shadow-sm" : "text-[#535852] hover:bg-[#ece7de]"}`}>
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="break-words leading-5">{item.label}</span>
      </button>
    })}
    {side && <button type="button" onClick={() => void onLogout()}
      className="mt-4 flex min-h-12 w-full items-center gap-2 rounded-xl border border-[#d4ccc0] px-3 text-sm font-semibold text-[#6a6e67] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1d5961]">
      <LogOut aria-hidden="true" className="h-4 w-4" />Cerrar sesión
    </button>}
  </nav>
}

export function RemoteLiveOptimizationOperator({ embeddedForOwner = false }: {
  embeddedForOwner?: boolean
}) {
  const [dashboard, setDashboard] =
    useState<RemoteLiveOptimizationOperatorDashboardV1 | null>(null)
  const [readState, setReadState] = useState<ReadState>("LOADING")
  const [message, setMessage] = useState("")
  const [view, setView] = useState<OperatorView>("HOME")
  const [operatorName, setOperatorName] = useState("")

  const load = useCallback(async () => {
    setReadState((state) => state === "STABLE" ? "STABLE" : "LOADING")
    try {
      const payload = await operatorRequest(
        "/api/admin/ebay/live-optimization-operator")
      const next = payload.dashboard as
        RemoteLiveOptimizationOperatorDashboardV1 | undefined
      if (!next?.contractVersion || !Array.isArray(next.taskListings) ||
          !Array.isArray(next.suggestedTaskListings) ||
          next.deliveryTrace.apiResponseCount !== next.taskListings.length ||
          next.deliveryTrace.serverGeneratedCount !==
            next.taskListings.length ||
          next.deliveryTrace.serverToClientCountParity !== true) {
        throw new Error("REMOTE_FEED_RESPONSE_PARITY_REQUIRED")
      }
      setDashboard(next)
      setReadState("STABLE")
      setMessage("")
    } catch {
      setReadState("RETRYING")
      setView("VISUAL")
      setMessage("El resumen comercial no está disponible ahora. La Estación visual sigue disponible y no necesitas hacer nada técnico.")
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    let active = true
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setOperatorName(
        remoteLiveOperatorDisplayNameFromUser(data.user) ?? "")
    })
    return () => { active = false }
  }, [])

  const taskListings = dashboard?.taskListings ?? []

  const grouped = useMemo(() => ({
    NEEDS_ATTENTION: taskListings.filter((listing) =>
      listing.attentionClass === "NEEDS_ATTENTION") ?? [],
    CAN_IMPROVE: taskListings.filter((listing) =>
      listing.attentionClass === "CAN_IMPROVE") ?? [],
    ENRICH: taskListings.filter((listing) =>
      listing.attentionClass === "ENRICH") ?? [],
    WAIT: taskListings.filter((listing) =>
      listing.attentionClass === "WAIT") ?? [],
  }) satisfies Record<RemoteLiveAttentionClass,
    readonly RemoteLiveOperatorListingV1[]>, [taskListings])

  const attentionListings = useMemo(() => [
    ...grouped.NEEDS_ATTENTION,
    ...grouped.CAN_IMPROVE,
    ...grouped.ENRICH,
  ], [grouped])
  const suggestedListings = dashboard?.suggestedTaskListings ?? []
  const reportedRenderReceipts = useRef(new Set<string>())
  const renderedFeedRoot = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!dashboard) return
    const clientPostFilterCount = view === "TASKS"
      ? taskListings.length
      : view === "SUGGESTIONS"
        ? suggestedListings.length
        : view === "HOME"
          ? attentionListings.length
          : null
    if (clientPostFilterCount === null) return
    const frame = window.requestAnimationFrame(() => {
      const visibleRenderCount = renderedFeedRoot.current
        ?.querySelectorAll("[data-remote-live-listing]").length ?? 0
      const receiptKey = [dashboard.generatedAt, view,
        taskListings.length, clientPostFilterCount, visibleRenderCount].join(":")
      if (reportedRenderReceipts.current.has(receiptKey)) return
      reportedRenderReceipts.current.add(receiptKey)
      void operatorRequest("/api/admin/ebay/live-optimization-operator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "REPORT_FEED_RENDER",
          contractVersion: dashboard.contractVersion,
          serverGeneratedCount: dashboard.deliveryTrace.serverGeneratedCount,
          apiResponseCount: dashboard.deliveryTrace.apiResponseCount,
          clientReceivedCount: taskListings.length,
          clientPostFilterCount,
          visibleRenderCount,
        }),
      }).catch(() => null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [attentionListings.length, dashboard, suggestedListings.length,
    taskListings.length, view])

  async function logout() {
    await fetch("/api/admin/session", { method: "DELETE" }).catch(() => null)
    await signOutAdmin()
    window.location.replace("/admin/login")
  }

  const canAct = !embeddedForOwner
  return <section ref={renderedFeedRoot} className={embeddedForOwner
    ? "mt-5 overflow-x-hidden rounded-[32px] bg-[#f4efe7] text-[#242724]"
    : "min-h-screen overflow-x-hidden bg-[#f4efe7] text-[#242724]"}
    data-remote-live-optimization-operator
    data-ai-policy="deterministic-first"
    data-continuous-ai-polling="false"
    data-postsale-access="false"
    data-new-listing-publish-access="false"
    data-client-received-count={taskListings.length}
    data-server-generated-count={dashboard?.deliveryTrace
      .serverGeneratedCount ?? 0}
    data-server-client-count-parity={dashboard?.deliveryTrace
      .serverToClientCountParity === true}>
    <div className={embeddedForOwner ? "p-4 sm:p-6" :
      "mx-auto grid min-h-screen max-w-[1500px] lg:grid-cols-[230px_minmax(0,1fr)]"}>
      {!embeddedForOwner && <aside className="hidden border-r border-[#d9d1c4] px-4 py-7 lg:block">
        <div className="sticky top-7">
          <p className="px-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#1d5961]">Seller OS</p>
          <p className="mt-2 px-3 font-serif text-xl font-semibold">Espacio de operadora</p>
          <div className="mt-7"><OperatorNavigation view={view}
            onChange={setView} onLogout={logout} side /></div>
        </div>
      </aside>}
      <main className={embeddedForOwner ? "" : "min-w-0 px-4 pb-14 pt-5 sm:px-7 lg:px-10 lg:pt-7"}>
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#d9d1c4] pb-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1d5961]">Seller OS · eBay</p>
            <h1 className="mt-2 break-words font-serif text-3xl font-semibold leading-tight sm:text-4xl">Hola{operatorName ? `, ${operatorName}` : ""} 👋</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#64675f]">Aquí verás primero lo que requiere atención y una recomendación clara para cada producto.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void load()}
              disabled={readState === "LOADING"}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-[#cfc7ba] bg-[#fffdf8] px-4 text-sm font-semibold text-[#555a54] disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1d5961]">
              <RefreshCw aria-hidden="true" className="h-4 w-4" />Actualizar
            </button>
            {!embeddedForOwner && <button type="button"
              onClick={() => void logout()}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-[#cfc7ba] bg-[#fffdf8] px-4 text-sm font-semibold text-[#555a54] lg:hidden">
              <LogOut aria-hidden="true" className="h-4 w-4" />Salir
            </button>}
          </div>
        </header>
        <div className={embeddedForOwner ? "mt-4" : "mt-4 lg:hidden"}>
          <OperatorNavigation view={view}
          onChange={setView} onLogout={logout} /></div>
        {message && <p aria-live="polite" className="mt-4 rounded-2xl border border-[#d6bca8] bg-[#f7e9de] p-4 text-sm font-medium text-[#704d3c]">{message}</p>}
        {!dashboard && view !== "VISUAL" && <div className="mt-6 rounded-[28px] border border-[#d9d1c4] bg-[#fffdf8] p-7 text-sm text-[#6f736c]">{readState === "RETRYING" ? "El resumen comercial no está disponible ahora. La Estación visual continúa funcionando." : "Preparando tu espacio…"}</div>}
        {view === "VISUAL" && <div className="mt-7 space-y-5"
          data-mayel-workspace-independent-from-trading="true">
          <section className="rounded-2xl border border-[#cbd9d4] bg-[#eef5f1] p-4 text-sm leading-6 text-[#36534a]">
            <p className="font-semibold">Mayel · Estación visual disponible</p>
            <p className="mt-1">Puedes preparar, subir y revisar recursos visuales. La aplicación y el readback en eBay se validan por separado antes de ejecutar cualquier cambio.</p>
          </section>
          <MayelVisualWorkstation canOperate={canAct}
            canOwnerAuthorize={embeddedForOwner} />
        </div>}
        {dashboard && view !== "VISUAL" && <div className="mt-7 space-y-7">
          {!dashboard.capabilities.safeLiveTitleCanary &&
            <p className="rounded-2xl border border-[#d6bca8] bg-[#f7e9de] p-4 text-sm font-medium leading-6 text-[#704d3c]">Puedes revisar las propuestas, pero aplicar esta mejora todavía no está disponible.</p>}

          {view === "HOME" && <>
            <section aria-labelledby="attention-heading">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b75d43]">Prioridad de hoy</p>
              <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
                <div><h2 id="attention-heading" className="font-serif text-3xl font-semibold leading-tight">Qué necesita tu atención hoy</h2>
                  <p className="mt-2 text-sm leading-6 text-[#64675f]">Empieza por arriba. Seller OS ya ordenó las tareas por importancia.</p></div>
                {attentionListings.length > 2 && <button type="button"
                  onClick={() => setView("TASKS")}
                  className="min-h-12 rounded-xl border border-[#1d5961]/35 px-4 text-sm font-semibold text-[#1d5961]">Ver todas mis tareas</button>}
              </div>
              <div className="mt-5"><AttentionSummary grouped={grouped} /></div>
              <div className="mt-5"><ListingCollection
                listings={attentionListings.slice(0, 2)} canAct={canAct}
                onRefresh={load}
                emptyMessage="Todo está en orden. No hay nada que requiera atención hoy." /></div>
            </section>
            <SalesChart dashboard={dashboard} />
            <ImpactCard dashboard={dashboard} />
          </>}

          {view === "TASKS" && <section aria-labelledby="tasks-heading">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b75d43]">Trabajo pendiente</p>
            <h2 id="tasks-heading" className="mt-2 font-serif text-3xl font-semibold">Mis tareas · {taskListings.length}</h2>
            <div className="mt-6 space-y-8">{sections.map((section) => <section key={section.key}>
              <div className="mb-4"><h3 className="font-serif text-2xl font-semibold">{section.label} · {grouped[section.key].length}</h3><p className="mt-1 text-sm text-[#6b6e67]">{section.explanation}</p></div>
              <ListingCollection listings={grouped[section.key]}
                canAct={canAct} onRefresh={load} />
            </section>)}</div>
          </section>}

          {view === "LIVE" && <section aria-labelledby="live-heading">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#74866d]">Catálogo activo</p>
            <h2 id="live-heading" className="mt-2 font-serif text-3xl font-semibold">Listings LIVE</h2>
            <p className="mt-2 text-sm leading-6 text-[#64675f]">Todos los productos activos, con la lectura más reciente disponible.</p>
            <div className="mt-6"><ListingCollection listings={dashboard.listings}
              canAct={canAct} onRefresh={load} /></div>
          </section>}

          {view === "SUGGESTIONS" && <section aria-labelledby="suggestions-heading">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1d5961]">Presentación y claridad</p>
            <h2 id="suggestions-heading" className="mt-2 font-serif text-3xl font-semibold">Mejoras sugeridas · {suggestedListings.length}</h2>
            <p className="mt-2 text-sm leading-6 text-[#64675f]">Sólo mostramos propuestas que tienen evidencia suficiente para ser revisadas.</p>
            <div className="mt-6"><ListingCollection listings={suggestedListings}
              canAct={canAct} onRefresh={load} /></div>
          </section>}

          {view === "RESULTS" && <>
            <SalesChart dashboard={dashboard} />
            <ImpactCard dashboard={dashboard} />
          </>}

          {view === "HISTORY" && <section aria-labelledby="history-heading">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#74866d]">Actividad comprobada</p>
            <h2 id="history-heading" className="mt-2 font-serif text-3xl font-semibold">Historial</h2>
            <div className="mt-6 space-y-3">{dashboard.history.length ? dashboard.history.map((entry, index) => <article key={`${entry.listingId}-${entry.occurredAt}-${index}`} className="rounded-2xl border border-[#d9d1c4] bg-[#fffdf8] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-[#292d29]">{entry.action}</h3><p className="mt-1 text-sm text-[#5f645e]">{entry.title}</p></div><span className="rounded-full bg-[#e3ebe1] px-3 py-2 text-xs font-semibold text-[#425143]">{entry.status}</span></div>
              <p className="mt-3 text-xs text-[#7a7d76]">{shortDate(entry.occurredAt)} · este registro no atribuye ventas a la acción.</p>
            </article>) : <p className="rounded-2xl border border-[#d9d1c4] bg-[#fffdf8] p-6 text-sm text-[#6f736c]">Todavía no hay acciones tuyas registradas.</p>}</div>
          </section>}

          {view === "HELP" && <section aria-labelledby="help-heading">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1d5961]">Guía sencilla</p>
            <h2 id="help-heading" className="mt-2 font-serif text-3xl font-semibold">Ayuda</h2>
            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              <article className="rounded-[28px] border border-[#d9d1c4] bg-[#fffdf8] p-6">
                <h3 className="font-serif text-2xl font-semibold">Cómo te ayuda Seller OS</h3>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-[#555a54]">
                  <li>Traduce las señales de eBay a una explicación clara.</li>
                  <li>Te muestra qué pasa, por qué importa y qué hacer ahora.</li>
                  <li>Prepara comparaciones y propuestas sólo cuando existe evidencia.</li>
                  <li>Usa asistencia inteligente únicamente cuando aporta algo útil.</li>
                </ul>
              </article>
              <article className="rounded-[28px] bg-[#26312d] p-6 text-white">
                <h3 className="font-serif text-2xl font-semibold">Lo que nunca hará</h3>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-white/75">
                  <li>No inventa características, identificadores ni demanda.</li>
                  <li>No cambia los límites de margen ni la autoridad del owner.</li>
                  <li>No publica un listing nuevo ni ejecuta postventa.</li>
                  <li>No aplica una propuesta visual desde esta revisión.</li>
                </ul>
              </article>
            </div>
          </section>}

          <footer className="border-t border-[#d9d1c4] pt-5 text-xs leading-5 text-[#777a73]">
            Publicaciones nuevas, postventa, credenciales, fin de listings y gasto no aprobado permanecen bajo autoridad del owner.
            {readState === "RETRYING" ? " Mostrando el último estado válido." : ""}
            <span className="mt-1 block">Última lectura: {shortDate(dashboard.generatedAt)}</span>
          </footer>
        </div>}
      </main>
    </div>
  </section>
}
