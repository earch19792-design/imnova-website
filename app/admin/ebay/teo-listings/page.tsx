"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { supabase } from "@/lib/supabase"

type JsonRecord = Record<string, unknown>
type Dashboard = {
  generatedAt?: string
  liveCoverage?: {
    currentState?: "CURRENT_FRESH" | "CURRENT_UNAVAILABLE"
    currentListingCount?: number | null
    currentObservedAt?: string | null
    lastCertifiedListingCount?: number | null
    lastCertifiedAt?: string | null
    sourceFailureCode?: string | null
    trading?: {
      status?: "AVAILABLE" | "FAILED" | "NOT_ATTEMPTED"
      causeClassification?: string | null
      failedOperation?: string | null
      providerErrorCode?: string | null
      detailCode?: string | null
      zeroListingsInterpretation?:
        | "NO_SE_INTERPRETA_COMO_0_LISTINGS"
        | "AUTHORITATIVE_ONLY_WHEN_CERTIFIED_COMPLETE"
    }
  } | null
  summary?: {
    verifiedListings?: number
    actionsToday?: number
    protectedListings?: number
    activeExperiments?: number
    replacementCandidates?: number
    learnedResults?: number
    pricingReady?: number
    discountOpportunities?: number
  }
  todayActions?: JsonRecord[]
  protectedListings?: JsonRecord[]
  replacementCandidates?: JsonRecord[]
  experiments?: JsonRecord[]
  memory?: JsonRecord[]
  timeline?: JsonRecord[]
  pricing?: JsonRecord[]
  pricingSourceStatus?: JsonRecord
}

const tabs = ["HOY", "PRECIOS", "EXPERIMENTOS", "REEMPLAZO", "MEMORIA"] as const
type Tab = typeof tabs[number]

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : ""
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function numeric(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function usd(value: unknown) {
  const parsed = numeric(value)
  return parsed === null ? "Falta evidencia" : new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(parsed)
}

function formatDate(value: unknown) {
  const source = text(value)
  const parsed = new Date(source)
  return source && Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat("es", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(parsed)
    : "Pendiente"
}

function label(value: unknown) {
  return text(value).replaceAll("_", " ") || "Pendiente"
}

function liveCoverageCause(value: unknown) {
  const causes: Record<string, string> = {
    QUOTA_EXHAUSTED: "Cuota de Trading agotada",
    AUTH_ERROR: "Autenticación o autorización",
    EBAY_TRADING_ERROR: "Error de Trading de eBay",
    TEMPORARY_UPSTREAM_FAILURE: "Fallo temporal del servicio de eBay",
    UNKNOWN_CAUSE: "Causa todavía no comprobada",
  }
  const code = text(value)
  return causes[code] ?? label(code)
}

function SummaryCard({ label: title, value, detail }: {
  label: string
  value: number
  detail: string
}) {
  return <article className="rounded-3xl border border-white/10 bg-white/[0.045] p-5">
    <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">{title}</p>
    <p className="mt-3 text-3xl font-black text-white">{value}</p>
    <p className="mt-2 text-xs leading-5 text-white/50">{detail}</p>
  </article>
}

function Status({ children, tone = "cyan" }: {
  children: string
  tone?: "cyan" | "green" | "amber" | "rose"
}) {
  const colors = {
    cyan: "border-cyan-200/25 bg-cyan-200/[0.08] text-cyan-100",
    green: "border-emerald-200/25 bg-emerald-200/[0.08] text-emerald-100",
    amber: "border-amber-200/25 bg-amber-200/[0.08] text-amber-100",
    rose: "border-rose-200/25 bg-rose-200/[0.08] text-rose-100",
  }
  return <span className={`rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-wide ${colors[tone]}`}>
    {children}
  </span>
}

function PriceDecision({ value, compact = false }: {
  value: JsonRecord
  compact?: boolean
}) {
  const safe = value.safeToDiscount === true
  const action = text(value.action)
  const evidence = text(value.competitiveEvidence)
  const expectedProfit = numeric(value.expectedNetProfitAtRecommended)
  const status = text(value.status)
  return <div className={`rounded-2xl border ${safe ? "border-emerald-200/25 bg-emerald-200/[0.06]" : status === "READY" ? "border-cyan-200/20 bg-cyan-200/[0.045]" : "border-amber-200/20 bg-amber-200/[0.045]"} ${compact ? "mt-4 p-4" : "p-5"}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong className="text-sm text-white">Precio final recomendado: {usd(value.recommendedFinalItemPrice)}</strong>
      <Status tone={safe ? "green" : status === "READY" ? "cyan" : "amber"}>
        {safe ? "Descuento seguro" : action === "RAISE_TO_SAFE_FLOOR" ? "Subir al piso" : status === "READY" ? "Mantener" : "Falta evidencia"}
      </Status>
    </div>
    <div className="mt-3 grid gap-2 text-xs text-white/60 sm:grid-cols-2">
      <p>Precio actual: <strong className="text-white/90">{usd(value.currentItemPrice)}</strong></p>
      <p>Piso seguro: <strong className="text-white/90">{usd(value.minimumSafeItemPrice)}</strong></p>
      <p>Descuento sugerido: <strong className="text-white/90">{usd(value.suggestedDiscountUsd)}</strong></p>
      <p>Utilidad estimada: <strong className={expectedProfit !== null && expectedProfit >= 4 ? "text-emerald-100" : "text-amber-100"}>{usd(value.expectedNetProfitAtRecommended)}</strong></p>
    </div>
    {!compact && <p className="mt-3 text-[11px] leading-5 text-white/45">
      Competencia: {evidence === "CONFIRMED_SOLD" ? "ventas confirmadas" : evidence === "ACTIVE_MARKET" ? "ofertas activas, no ventas" : "sin referencia suficiente"} · Referencia total con envío: {usd(value.competitiveLandedPrice)}
    </p>}
  </div>
}

function humanError(code: string) {
  const messages: Record<string, string> = {
    admin_forbidden: "Esta pantalla es exclusiva del owner.",
    owner_user_required: "Debes entrar con la sesión personal del owner.",
    TEO_EXPERIMENT_REGISTRY_READ_FAILED:
      "La memoria de TEO todavía no está instalada en Supabase.",
    TEO_EXPERIMENT_MEMORY_READ_FAILED:
      "No se pudo leer la memoria histórica de TEO.",
    TEO_ACTIONABLE_IMPROVEMENT_NOT_PROVEN:
      "TEO no encontró evidencia suficiente para cambiar este listing hoy.",
    TEO_PRICE_DECISION_EVIDENCE_REQUIRED:
      "Faltan costos o evidencia competitiva para autorizar un precio rentable.",
    TEO_LISTING_ALREADY_HAS_ACTIVE_EXPERIMENT:
      "Ese listing ya tiene un experimento activo; no debe tocarse.",
    TEO_OFFICIAL_ACTIVE_OWNERSHIP_REQUIRED:
      "eBay no confirmó que el listing esté activo y pertenezca a la cuenta oficial.",
  }
  return messages[code] ?? `No se pudo completar la acción (${label(code)}).`
}

export default function TeoListingsPage() {
  const [tab, setTab] = useState<Tab>("HOY")
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState("")
  const [error, setError] = useState("")

  const request = useCallback(async (
    method: "GET" | "POST",
    body?: JsonRecord,
  ) => {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !data.session) throw new Error("AUTH_REQUIRED")
    const response = await fetch("/api/admin/ebay/teo-listings", {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const payload = await response.json() as {
      success?: boolean
      error?: string
      dashboard?: Dashboard
    }
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || "TEO_LISTING_WORKFLOW_FAILED")
    }
    return payload
  }, [])

  const load = useCallback(async () => {
    setError("")
    try {
      const payload = await request("GET")
      setDashboard(payload.dashboard ?? null)
    } catch (requestError) {
      const code = requestError instanceof Error ? requestError.message : ""
      setError(code === "AUTH_REQUIRED"
        ? "La sesión del owner expiró. Vuelve a iniciar sesión."
        : humanError(code))
    } finally {
      setLoading(false)
    }
  }, [request])

  useEffect(() => { void load() }, [load])

  async function act(key: string, body: JsonRecord) {
    if (busyKey) return
    setBusyKey(key)
    setError("")
    try {
      await request("POST", body)
      await load()
    } catch (requestError) {
      const code = requestError instanceof Error ? requestError.message : ""
      setError(humanError(code))
    } finally {
      setBusyKey("")
    }
  }

  const actions = dashboard?.todayActions ?? []
  const protectedListings = dashboard?.protectedListings ?? []
  const pricing = dashboard?.pricing ?? []
  const pricingSources = dashboard?.pricingSourceStatus ?? {}
  const summary = dashboard?.summary ?? {}
  const liveCoverage = dashboard?.liveCoverage ?? null
  const liveTrading = liveCoverage?.trading ?? null
  const activeExperiments = useMemo(() =>
    (dashboard?.experiments ?? []).filter((entry) =>
      !["COMPLETED", "INCONCLUSIVE", "CANCELLED"]
        .includes(text(entry.lifecycleStatus))), [dashboard])

  return <main className="min-h-screen bg-[#07101b] px-4 pb-28 pt-7 text-white sm:px-6 lg:px-10">
    <section className="mx-auto max-w-7xl space-y-6">
      <header className="overflow-hidden rounded-[32px] border border-cyan-200/15 bg-gradient-to-br from-cyan-300/[0.12] via-white/[0.035] to-emerald-300/[0.08] p-6 md:p-9">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-100/60">TEO · listings publicados</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-6xl">Ruta diaria para empujar ventas</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-white/65 md:text-base">
              TEO diagnostica, recomienda una sola mejora y mide el resultado. Tú, como owner, haces el cambio directamente en eBay; TEO nunca edita el marketplace.
            </p>
          </div>
          <Status tone="green">Solo owner · eBay read-only</Status>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          {tabs.map((entry) => <button key={entry} type="button"
            onClick={() => setTab(entry)}
            className={`min-h-11 rounded-full px-4 text-xs font-black tracking-wide ${tab === entry ? "bg-white text-black" : "border border-white/10 text-white/60 hover:bg-white/[0.06]"}`}>
            {entry === "REEMPLAZO" ? "REEMPLAZO" : entry === "MEMORIA" ? "MEMORIA Y RESULTADOS" : entry}
          </button>)}
        </div>
      </header>

      {error && <section className="rounded-2xl border border-rose-200/25 bg-rose-200/[0.08] p-4 text-sm font-bold text-rose-50">
        {error}
      </section>}

      {loading && <section className="rounded-3xl border border-white/10 p-8 text-white/55">TEO está ordenando la ruta de hoy…</section>}

      {!loading && dashboard && <>
        <section aria-label="Cobertura LIVE de eBay" className={`rounded-3xl border p-5 md:p-6 ${liveCoverage?.currentState === "CURRENT_FRESH" ? "border-emerald-200/25 bg-emerald-200/[0.06]" : "border-amber-200/25 bg-amber-200/[0.08]"}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Cobertura LIVE oficial</p>
              <h2 className="mt-2 text-xl font-black">{liveCoverage?.currentState === "CURRENT_FRESH" ? "Cobertura certificada" : "Cobertura actual no certificada"}</h2>
            </div>
            <Status tone={liveCoverage?.currentState === "CURRENT_FRESH" ? "green" : "amber"}>{liveTrading?.status === "AVAILABLE" ? "Trading disponible" : liveTrading?.status === "FAILED" ? "Trading falló" : "Trading no comprobado"}</Status>
          </div>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div><p className="text-xs font-bold text-white/45">Última cobertura LIVE certificada</p><p className="mt-1 font-black">{liveCoverage?.lastCertifiedListingCount ?? "No disponible"} listings</p></div>
            <div><p className="text-xs font-bold text-white/45">Timestamp certificado</p><p className="mt-1 font-black">{formatDate(liveCoverage?.lastCertifiedAt)}</p></div>
            <div><p className="text-xs font-bold text-white/45">Clasificación de causa</p><p className="mt-1 font-black">{liveTrading?.causeClassification ? liveCoverageCause(liveTrading.causeClassification) : "Sin fallo clasificado"}</p></div>
            <div><p className="text-xs font-bold text-white/45">Detalle seguro</p><p className="mt-1 break-all font-black">{liveTrading?.detailCode ?? liveCoverage?.sourceFailureCode ?? "No comprobado"}</p></div>
          </div>
          {liveCoverage?.currentState !== "CURRENT_FRESH" && <p className="mt-4 rounded-xl border border-amber-100/20 bg-black/20 px-3 py-2 text-sm font-black text-amber-50">La falta de cobertura no se interpreta como 0 listings. TEO conserva la última cohorte certificada y no habilita automatizaciones de marketplace.</p>}
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <SummaryCard label="Acciones hoy" value={summary.actionsToday ?? 0} detail="En orden de prioridad." />
          <SummaryCard label="Descuentos seguros" value={summary.discountOpportunities ?? 0} detail="Con utilidad neta mínima de US$4 y guardas de margen." />
          <SummaryCard label="No tocar" value={summary.protectedListings ?? 0} detail="Protegidos para no contaminar evidencia." />
          <SummaryCard label="Experimentos" value={summary.activeExperiments ?? 0} detail="Mejoras bajo seguimiento." />
          <SummaryCard label="Reemplazo" value={summary.replacementCandidates ?? 0} detail="Casos que ya no conviene retocar." />
          <SummaryCard label="Memoria" value={summary.learnedResults ?? 0} detail="Resultados positivos, negativos o neutros." />
        </section>

        {tab === "HOY" && <div className="grid gap-6 xl:grid-cols-[1.3fr_.7fr]">
          <section className="rounded-3xl border border-white/10 bg-black/20 p-5 md:p-7">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-100/55">Prioridad del día</p>
            <h2 className="mt-2 text-2xl font-black">Qué hacer ahora</h2>
            <div className="mt-5 space-y-4">
              {!actions.length && <p className="rounded-2xl border border-emerald-200/20 bg-emerald-200/[0.06] p-5 text-emerald-50">No hay cambios probados para ejecutar hoy. Mantener es una decisión válida.</p>}
              {actions.map((entry, index) => {
                const action = text(entry.action)
                const itemId = text(entry.ebayItemId)
                const experiment = record(entry.experiment)
                const recommendation = record(entry.recommendation)
                const priceDecision = record(entry.pricing)
                const experimentId = text(experiment.experimentId)
                const key = `${action}:${itemId}:${experimentId}`
                return <article key={key || index} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><p className="text-xs font-black text-cyan-100">#{index + 1} · Listing {itemId}</p><h3 className="mt-1 text-lg font-black">{text(recommendation.headline) || label(action)}</h3></div>
                    <Status tone={action === "RETRY_OFFICIAL_READBACK" ? "amber" : "cyan"}>{label(action)}</Status>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-white/60">{text(entry.instruction) || text(recommendation.rationale)}</p>
                  {text(recommendation.hypothesis) && <p className="mt-3 rounded-xl bg-black/25 p-3 text-xs leading-5 text-white/55"><strong className="text-white/80">Hipótesis:</strong> {text(recommendation.hypothesis)}</p>}
                  {Object.keys(priceDecision).length > 0 && (text(recommendation.variable) === "PRICE" || text(experiment.variableChanged) === "PRICE" || priceDecision.safeToDiscount === true) && <PriceDecision value={priceDecision} compact />}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {action === "START_ONE_VARIABLE_EXPERIMENT" && <button type="button" disabled={Boolean(busyKey)} onClick={() => void act(key, { action: "START_EXPERIMENT", ebayItemId: itemId })} className="min-h-11 rounded-xl bg-cyan-200 px-4 text-sm font-black text-black disabled:opacity-50">{busyKey === key ? "Preparando…" : "Abrir experimento"}</button>}
                    {action === "OWNER_EXECUTE_AND_CONFIRM" && <button type="button" disabled={Boolean(busyKey)} onClick={() => void act(key, { action: "CONFIRM_EXECUTED", experimentId })} className="min-h-11 rounded-xl bg-emerald-200 px-4 text-sm font-black text-black disabled:opacity-50">{busyKey === key ? "Comprobando eBay…" : "Ya lo ejecuté en eBay"}</button>}
                    {action === "RETRY_OFFICIAL_READBACK" && <button type="button" disabled={Boolean(busyKey)} onClick={() => void act(key, { action: "VERIFY_READBACK", experimentId })} className="min-h-11 rounded-xl bg-amber-200 px-4 text-sm font-black text-black disabled:opacity-50">{busyKey === key ? "Leyendo eBay…" : "Volver a comprobar"}</button>}
                  </div>
                </article>
              })}
            </div>
          </section>
          <section className="rounded-3xl border border-emerald-200/15 bg-emerald-200/[0.045] p-5 md:p-7">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-100/55">Protección</p>
            <h2 className="mt-2 text-2xl font-black">No tocar hoy</h2>
            <div className="mt-5 space-y-3">
              {!protectedListings.length && <p className="text-sm text-white/55">No hay listings protegidos.</p>}
              {protectedListings.slice(0, 20).map((entry, index) => <article key={`${text(entry.ebayItemId)}:${index}`} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-3"><strong>Listing {text(entry.ebayItemId)}</strong><Status tone="green">No tocar</Status></div>
                <p className="mt-2 text-xs leading-5 text-white/55">{text(entry.instruction)}</p>
                {text(entry.nextReviewAt) && <p className="mt-2 text-xs text-emerald-100">Revisión: {formatDate(entry.nextReviewAt)}</p>}
              </article>)}
            </div>
          </section>
        </div>}

        {tab === "PRECIOS" && <section className="rounded-3xl border border-white/10 bg-black/20 p-5 md:p-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-100/55">Control de rentabilidad</p>
              <h2 className="mt-2 text-2xl font-black">Precio final y margen para descuento</h2>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-white/55">
                TEO compara el precio total del mercado, pero te propone el precio del artículo que debes colocar en eBay. Nunca baja del piso que conserva al menos US$4 netos, 20% de margen, 30% de ROI y reservas conservadoras.
              </p>
            </div>
            <Status tone="green">Owner ejecuta · TEO verifica</Status>
          </div>
          <div className="mt-5 rounded-2xl border border-amber-200/20 bg-amber-200/[0.05] p-4 text-xs leading-6 text-amber-50/80">
            Una oferta activa de la competencia no demuestra una venta. TEO la identifica por separado y sólo autoriza descuento cuando también existen costos probados y un piso seguro.
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-white/50">
            <span>Fuentes:</span>
            <span>economía {text(pricingSources.liveEconomics) === "AVAILABLE" ? "disponible" : "pendiente"}</span>
            <span>· competencia {text(pricingSources.competition) === "AVAILABLE" ? "disponible" : "pendiente"}</span>
            <span>· listing vivo {text(pricingSources.activeListings) === "AVAILABLE" ? "disponible" : "pendiente"}</span>
          </div>
          <div className="mt-5 overflow-x-auto rounded-2xl border border-white/10">
            <table className="min-w-[1120px] w-full text-left text-sm">
              <thead className="bg-white/[0.055] text-[11px] uppercase tracking-wider text-white/45">
                <tr>
                  <th className="px-4 py-4">Listing</th>
                  <th className="px-4 py-4">Actual · artículo</th>
                  <th className="px-4 py-4">Competencia total</th>
                  <th className="px-4 py-4">Piso · artículo</th>
                  <th className="px-4 py-4">Final · artículo</th>
                  <th className="px-4 py-4">Descuento sugerido</th>
                  <th className="px-4 py-4">Descuento máximo</th>
                  <th className="px-4 py-4">Utilidad esperada</th>
                  <th className="px-4 py-4">Decisión</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {!pricing.length && <tr><td colSpan={9} className="px-4 py-8 text-center text-white/50">Aún no hay listings verificados para calcular.</td></tr>}
                {pricing.map((entry) => {
                  const safe = entry.safeToDiscount === true
                  const evidence = text(entry.competitiveEvidence)
                  const ready = text(entry.status) === "READY"
                  return <tr key={text(entry.ebayItemId)} className="align-top hover:bg-white/[0.025]">
                    <td className="px-4 py-4"><strong className="text-white">{text(entry.ebayItemId)}</strong><p className="mt-1 text-xs text-white/40">{text(entry.sku) || "SKU pendiente"}</p></td>
                    <td className="px-4 py-4 font-bold text-white/85">{usd(entry.currentItemPrice)}</td>
                    <td className="px-4 py-4"><strong className="text-white/85">{usd(entry.competitiveLandedPrice)}</strong><p className="mt-1 max-w-36 text-[11px] leading-4 text-white/40">{evidence === "CONFIRMED_SOLD" ? "Venta confirmada" : evidence === "ACTIVE_MARKET" ? "Oferta activa; no venta" : "Sin referencia"}</p></td>
                    <td className="px-4 py-4 font-bold text-amber-100">{usd(entry.minimumSafeItemPrice)}</td>
                    <td className="px-4 py-4 text-base font-black text-cyan-100">{usd(entry.recommendedFinalItemPrice)}</td>
                    <td className="px-4 py-4 font-bold text-emerald-100">{usd(entry.suggestedDiscountUsd)}{numeric(entry.suggestedDiscountPercent) !== null && <p className="mt-1 text-[11px] text-white/40">{numeric(entry.suggestedDiscountPercent)?.toFixed(2)}%</p>}</td>
                    <td className="px-4 py-4 text-white/70">{usd(entry.maximumSafeDiscountUsd)}</td>
                    <td className="px-4 py-4 font-bold text-emerald-100">{usd(entry.expectedNetProfitAtRecommended)}<p className="mt-1 text-[11px] text-white/40">{numeric(entry.expectedMarginPercentAtRecommended) === null ? "margen pendiente" : `${numeric(entry.expectedMarginPercentAtRecommended)?.toFixed(2)}% margen`} · mínimo US$4</p></td>
                    <td className="px-4 py-4"><Status tone={safe ? "green" : ready ? "cyan" : "amber"}>{safe ? "Bajar" : text(entry.action) === "RAISE_TO_SAFE_FLOOR" ? "Subir" : ready ? "Mantener" : "Completar datos"}</Status></td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {pricing.filter((entry) => entry.safeToDiscount === true).slice(0, 6).map((entry) => <PriceDecision key={`price:${text(entry.ebayItemId)}`} value={entry} />)}
          </div>
        </section>}

        {tab === "EXPERIMENTOS" && <section className="rounded-3xl border border-white/10 bg-black/20 p-5 md:p-7">
          <h2 className="text-2xl font-black">Experimentos activos</h2>
          <p className="mt-2 text-sm text-white/55">Confirmado por owner y verificado en eBay son estados diferentes.</p>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {!activeExperiments.length && <p className="text-white/55">No hay experimentos activos.</p>}
            {activeExperiments.map((entry) => <article key={text(entry.experimentId)} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
              <div className="flex flex-wrap items-center justify-between gap-2"><strong>Listing {text(entry.ebayItemId)}</strong><Status>{label(entry.lifecycleStatus)}</Status></div>
              <h3 className="mt-3 text-lg font-black">Cambiar sólo: {label(entry.variableChanged)}</h3>
              <p className="mt-2 text-sm leading-6 text-white/60">{text(entry.hypothesis)}</p>
              <div className="mt-4 grid gap-2 text-xs text-white/55 sm:grid-cols-2">
                <p>Owner: <strong className="text-white/85">{label(entry.ownerExecutionStatus)}</strong></p>
                <p>eBay: <strong className="text-white/85">{label(entry.readbackStatus)}</strong></p>
                <p>Atribución: <strong className="text-white/85">{label(entry.attributionStatus)}</strong></p>
                <p>Próxima revisión: <strong className="text-white/85">{formatDate(entry.nextReviewAt)}</strong></p>
              </div>
            </article>)}
          </div>
        </section>}

        {tab === "REEMPLAZO" && <section className="rounded-3xl border border-white/10 bg-black/20 p-5 md:p-7">
          <h2 className="text-2xl font-black">Candidatos a reemplazo</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">TEO sólo propone reemplazar cuando el listing no está activo, acumula dos ventanas sin exposición o dos experimentos limpios fueron negativos.</p>
          <div className="mt-5 space-y-4">
            {!(dashboard.replacementCandidates ?? []).length && <p className="rounded-2xl border border-emerald-200/20 p-5 text-emerald-100">Ningún listing requiere reemplazo hoy.</p>}
            {(dashboard.replacementCandidates ?? []).map((entry, index) => {
              const recommendation = record(entry.recommendation)
              return <article key={`${text(entry.ebayItemId)}:${index}`} className="rounded-2xl border border-rose-200/20 bg-rose-200/[0.05] p-5">
                <div className="flex items-center justify-between gap-3"><strong>Listing {text(entry.ebayItemId)}</strong><Status tone="rose">Candidato</Status></div>
                <h3 className="mt-3 text-lg font-black">{text(recommendation.headline)}</h3>
                <p className="mt-2 text-sm text-white/60">{text(recommendation.rationale)}</p>
              </article>
            })}
          </div>
        </section>}

        {tab === "MEMORIA" && <section className="rounded-3xl border border-white/10 bg-black/20 p-5 md:p-7">
          <h2 className="text-2xl font-black">Memoria de mejoras y resultados</h2>
          <p className="mt-2 text-sm text-white/55">Cada conclusión conserva variable, resultado y calidad de atribución.</p>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {!(dashboard.memory ?? []).length && <p className="text-white/55">Aún no hay experimentos concluidos.</p>}
            {(dashboard.memory ?? []).map((entry) => {
              const outcome = record(entry.outcome)
              const result = text(outcome.result) || text(entry.lifecycleStatus)
              return <article key={text(entry.experimentId)} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
                <div className="flex items-center justify-between gap-3"><strong>Listing {text(entry.ebayItemId)}</strong><Status tone={result === "POSITIVE" ? "green" : result === "NEGATIVE" ? "rose" : "amber"}>{label(result)}</Status></div>
                <p className="mt-3 text-sm text-white/65">Variable: <strong className="text-white">{label(entry.variableChanged)}</strong></p>
                <p className="mt-2 text-xs text-white/50">Atribución: {label(entry.attributionStatus)} · Evaluado: {formatDate(entry.resultEvaluatedAt)}</p>
              </article>
            })}
          </div>
        </section>}
      </>}

      <footer className="rounded-3xl border border-cyan-200/15 bg-cyan-200/[0.045] p-5 text-sm leading-7 text-white/60">
        <strong className="text-cyan-100">Regla de TEO:</strong> una sola variable, una lectura oficial y una ventana comparable. En precio, nunca recomendar bajar sin preservar como mínimo US$4 netos y las guardas de margen/ROI. Si cambian varias cosas, el resultado queda inconcluso y no alimenta recomendaciones futuras.
      </footer>
    </section>
  </main>
}
