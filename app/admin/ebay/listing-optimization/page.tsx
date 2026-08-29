"use client"

import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  FlaskConical,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"

import { supabase } from "@/lib/supabase"
import { SellerOsMobileNav } from "../components/seller-os-mobile-nav"

type Json = Record<string, unknown>

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Json
    : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function stringValue(value: unknown, fallback = "No comprobado") {
  return typeof value === "string" && value.trim() ? value : fallback
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function metricValue(metric: unknown) {
  const value = record(metric)
  return value.status === "AVAILABLE" || value.status === "PARTIAL"
    ? numberValue(value.value)
    : null
}

function statusLabel(status: unknown) {
  if (status === "AVAILABLE") return "Disponible"
  if (status === "PARTIAL") return "Parcial"
  if (status === "STALE") return "Evidencia anterior"
  return "No comprobado"
}

function formatMetric(value: number | null, options?: Intl.NumberFormatOptions) {
  return value === null ? "—" : new Intl.NumberFormat("es-US", options).format(value)
}

function priorityTitle(entry: Json) {
  return stringValue(entry.summary ?? entry.title ?? entry.reasonCode, "Señal canónica")
}

export default function EbayListingOptimizationCommandCenterPage() {
  const [payload, setPayload] = useState<Json | null>(null)
  const [review, setReview] = useState<Json | null>(null)
  const [loading, setLoading] = useState(true)
  const [reviewing, setReviewing] = useState(false)
  const [error, setError] = useState("")

  async function accessToken() {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !data.session) throw new Error("Sesión Admin requerida")
    return data.session.access_token
  }

  const hydrate = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const token = await accessToken()
      const response = await fetch("/api/admin/ebay/strategic-review", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await response.json() as Json
      if (!response.ok || body.success !== true) {
        throw new Error(stringValue(body.error, "No se pudo leer la autoridad canónica"))
      }
      setPayload(body)
    } catch (caught) {
      setPayload(null)
      setError(caught instanceof Error ? caught.message : "COMMAND_CENTER_READ_FAILED")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void hydrate() }, [hydrate])

  async function runBoundedReview() {
    if (!payload || reviewing) return
    setReviewing(true)
    setError("")
    try {
      const token = await accessToken()
      const response = await fetch("/api/admin/ebay/strategic-review", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          previousMaterialFingerprint:
            record(review?.prefilter).materialFingerprint ?? null,
        }),
      })
      const body = await response.json() as Json
      if (!response.ok || body.success !== true) {
        throw new Error(stringValue(body.error, "La revisión de IA se detuvo"))
      }
      setReview(record(body.review))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "COMMAND_CENTER_AI_REVIEW_FAILED")
    } finally {
      setReviewing(false)
    }
  }

  const bundle = record(payload?.bundle)
  const portfolio = record(bundle.portfolio)
  const kpis = record(portfolio.kpis)
  const accountTraffic = record(record(bundle.trafficScopeIntegrity).accountTraffic)
  const stock = record(bundle.supplierAndStock)
  const quality = record(bundle.qualityReport)
  const experiments = record(bundle.experiments)
  const decisions = record(bundle.decisions)
  const brief = record(review?.dailyBrief ?? payload?.dailyBrief)
  const briefSections = record(brief.sections)
  const aiRuntime = record(payload?.aiRuntime)
  const liveCount = numberValue(portfolio.liveListingCount)
    ?? metricValue(kpis.activeListings)
  const stockLinked = numberValue(stock.exactSupplierLinked)
  const stockTotal = numberValue(stock.totalListings)
  const staleStock = numberValue(stock.staleEvidence)
  const unknownStock = numberValue(stock.stockUnknown)
  const stockAttention = staleStock === null || unknownStock === null
    ? null
    : staleStock + unknownStock
  const qualityCount = numberValue(quality.recommendationCount)
  const experimentCount = numberValue(experiments.resultCount)
  const priorities = useMemo(() => [
    ...rows(decisions.criticalOperational),
    ...rows(decisions.actionableCommercial),
    ...rows(decisions.researchOrEvidence),
    ...rows(decisions.capabilityBlockers),
  ].slice(0, 8), [decisions])
  const summary = typeof brief.summary === "string" ? brief.summary : null

  const metrics = [
    { label: "Publicaciones activas", value: formatMetric(liveCount),
      status: record(kpis.activeListings).status,
      help: "Publicaciones que eBay confirma como activas en el portafolio LIVE actual." },
    { label: "Impresiones", value: formatMetric(numberValue(accountTraffic.impressions)),
      status: accountTraffic.status,
      help: "Veces que eBay mostró tus productos en el tráfico de la cuenta." },
    { label: "Vistas", value: formatMetric(numberValue(accountTraffic.listingViews)),
      status: accountTraffic.status,
      help: "Personas que entraron a ver tus publicaciones en eBay." },
    { label: "CTR · Tasa de clics",
      value: formatMetric(numberValue(accountTraffic.ctr), { maximumFractionDigits: 4 }),
      status: accountTraffic.status,
      help: "De cada 100 impresiones, indica cuántas terminan en una visita." },
  ]

  return <main className="min-h-screen bg-[#05070d] px-4 pb-28 pt-5 text-white sm:px-6">
    <section className="mx-auto max-w-7xl space-y-5">
      <header className="rounded-3xl border border-violet-200/20 bg-gradient-to-br from-violet-200/[0.12] via-cyan-200/[0.05] to-black p-5 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/admin/ebay-seller-os" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 px-4 text-sm font-black"><ArrowLeft size={15} />Seller OS</Link>
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200/20 bg-emerald-200/[0.08] px-3 py-2 text-xs font-black text-emerald-100"><ShieldCheck size={15} />SOLO LECTURA · 0 WRITES EBAY</span>
        </div>
        <div className="mt-6 flex items-start gap-3">
          <span className="rounded-2xl bg-violet-200/10 p-3 text-violet-100"><BrainCircuit size={25} /></span>
          <div><p className="text-xs font-black uppercase tracking-[0.22em] text-violet-100/60">Autoridad canónica · evidencia primero</p><h1 className="mt-2 text-3xl font-black md:text-5xl">Command Center de optimización</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">Une portafolio LIVE, Analytics, StockGuard, experimentos y calidad para explicar qué conviene mejorar. No inicia sesión en eBay, no edita listings y no publica.</p></div>
        </div>
      </header>

      {error ? <div role="alert" className="rounded-2xl border border-rose-200/25 bg-rose-200/[0.08] p-4 text-sm font-bold text-rose-50">Detenido de forma segura: {error}</div> : null}
      {loading ? <section aria-busy="true" className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><RefreshCw className="mx-auto animate-spin text-cyan-100" /><p className="mt-3 text-sm font-bold">Leyendo Seller OS canónico…</p></section> : null}

      {!loading && payload ? <>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => <article key={metric.label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><p className="text-xs font-black uppercase tracking-wide text-white/45">{metric.label}</p><p className="mt-2 text-3xl font-black">{metric.value}</p><p className="mt-2 text-xs text-cyan-100">{statusLabel(metric.status)}</p><details className="mt-2 text-xs text-white/50"><summary className="cursor-pointer font-bold">¿Qué significa?</summary><p className="mt-2 leading-5">{metric.help}</p></details></article>)}
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <article className="rounded-3xl border border-emerald-200/20 bg-emerald-200/[0.05] p-5">
            <div className="flex items-center gap-2 text-emerald-100"><PackageCheck size={19} /><h2 className="font-black">Inventario protegido</h2></div>
            <p className="mt-3 text-3xl font-black">{stockLinked === null || stockTotal === null ? "—" : `${stockLinked} de ${stockTotal}`}</p>
            <div className="mt-3 space-y-1 text-sm text-white/65"><p>{stockLinked === null ? "No comprobado" : `${stockLinked} vinculados`}</p><p>{staleStock === null ? "Frescura no comprobada" : `${Math.max(0, (stockTotal ?? 0) - staleStock)} con evidencia fresca`}</p><p>{stockAttention === null ? "Atención no comprobada" : `${stockAttention} requieren atención`}</p></div>
          </article>
          <article className="rounded-3xl border border-amber-200/20 bg-amber-200/[0.05] p-5">
            <div className="flex items-center gap-2 text-amber-100"><BarChart3 size={19} /><h2 className="font-black">Listing Quality Report</h2></div>
            {quality.status === "AVAILABLE" || quality.status === "PARTIAL" ? <><p className="mt-3 text-3xl font-black">{qualityCount ?? "—"}</p><p className="mt-2 text-sm text-white/65">recomendaciones oficiales disponibles</p></> : <><p className="mt-3 font-black">Todavía no conectado</p><p className="mt-2 text-sm leading-6 text-white/55">eBay no ofrece actualmente una adquisición pública certificada para este reporte. No se interpreta como cero recomendaciones.</p></>}
          </article>
          <article className="rounded-3xl border border-cyan-200/20 bg-cyan-200/[0.05] p-5">
            <div className="flex items-center gap-2 text-cyan-100"><FlaskConical size={19} /><h2 className="font-black">Experimentos</h2></div>
            <p className="mt-3 text-3xl font-black">{experimentCount ?? "—"}</p><p className="mt-2 text-sm text-white/65">{experiments.resultStatus === "AVAILABLE" ? "registro canónico disponible" : "evidencia no comprobada"}</p><p className="mt-2 text-xs text-white/45">Activos: {rows(experiments.active).length} · listos para evaluar: {rows(experiments.readyToEvaluate).length}</p>
          </article>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
          <article className="rounded-3xl border border-violet-200/20 bg-violet-200/[0.04] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wider text-violet-100/60">Diagnóstico Seller OS</p><h2 className="mt-1 text-xl font-black">Qué merece atención ahora</h2></div><button type="button" onClick={() => void runBoundedReview()} disabled={reviewing} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-200 px-4 text-sm font-black text-black disabled:opacity-40"><Sparkles size={15} />{reviewing ? "Revisando…" : "Explicar con IA"}</button></div>
            {summary ? <p className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6">{summary}</p> : null}
            <div className="mt-4 grid gap-2">{priorities.map((entry, index) => <div key={stringValue(entry.queueEntryId ?? entry.signalId, `priority-${index}`)} className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 shrink-0 text-amber-100" size={16} /><div><p className="font-black">{priorityTitle(entry)}</p><p className="mt-1 text-xs leading-5 text-white/55">{stringValue(entry.nextAction ?? entry.resolutionAction, "Revisar la evidencia canónica indicada")}</p></div></div></div>)}{priorities.length === 0 ? <div className="rounded-2xl border border-emerald-200/20 bg-emerald-200/[0.05] p-4 text-sm text-emerald-100"><CheckCircle2 className="mr-2 inline" size={16} />No hay una prioridad material comprobada.</div> : null}</div>
            <p className="mt-4 text-xs text-white/40">La explicación usa como máximo una llamada acotada. Sin evidencia nueva se conserva el diagnóstico determinístico.</p>
          </article>
          <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <p className="text-xs font-black uppercase tracking-wider text-cyan-100/60">Fuentes y seguridad</p>
            <dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-3"><dt className="text-white/50">Current LIVE</dt><dd className="font-black">{liveCount ?? "No comprobado"}</dd></div><div className="flex justify-between gap-3"><dt className="text-white/50">StockGuard</dt><dd className="font-black">{statusLabel(record(stock.sourceStatus).status)}</dd></div><div className="flex justify-between gap-3"><dt className="text-white/50">Quality Guidance</dt><dd className="text-right font-black">{statusLabel(quality.status)}</dd></div><div className="flex justify-between gap-3"><dt className="text-white/50">Proveedor de IA</dt><dd className="font-black">{stringValue(aiRuntime.activeProvider)}</dd></div><div className="flex justify-between gap-3"><dt className="text-white/50">Login eBay del operador</dt><dd className="font-black">No requerido</dd></div><div className="flex justify-between gap-3"><dt className="text-white/50">Writes marketplace</dt><dd className="font-black">0</dd></div></dl>
            <button type="button" onClick={() => void hydrate()} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/15 text-sm font-black"><RefreshCw size={15} />Actualizar evidencia</button><Link href="/admin/ebay/strategic-review" className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-violet-200/20 text-sm font-black text-violet-100">Ver revisión técnica completa</Link>
          </article>
        </section>

        <details className="rounded-3xl border border-white/10 bg-white/[0.035] p-5"><summary className="cursor-pointer font-black">Ver detalle del resumen determinístico</summary><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(briefSections).filter(([, value]) => Array.isArray(value)).map(([name, value]) => <div key={name} className="rounded-xl border border-white/10 p-3"><p className="break-words text-xs text-white/50">{name}</p><p className="mt-1 text-xl font-black">{(value as unknown[]).length}</p></div>)}</div></details>
      </> : null}

      <p className="rounded-2xl border border-white/10 bg-black/20 p-4 text-xs leading-5 text-white/45">Autoridad: Commercial Monitor + Current LIVE + StockGuard + Experiments + Quality Guidance. Admin auth sigue siendo obligatoria. No se exponen secretos, no se inicia OAuth y no existe una acción de publicación en esta pantalla.</p>
    </section>
    <SellerOsMobileNav active="listings" />
  </main>
}
