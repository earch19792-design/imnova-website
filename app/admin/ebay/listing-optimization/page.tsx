"use client"

import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Eye,
  FlaskConical,
  ImageIcon,
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
  const visualQuality = record(bundle.visualQuality)
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
  const visualListings = rows(visualQuality.listings)
  const visualAvailable = numberValue(visualQuality.visualAnalysisAvailableCount)
  const visualPartial = numberValue(visualQuality.partialCount)
  const visualUnproven = numberValue(visualQuality.unprovenCount)
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

        <section className="rounded-3xl border border-sky-200/20 bg-sky-200/[0.04] p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-xs font-black uppercase tracking-wider text-sky-100/60">Calidad visual · imagen principal</p><h2 className="mt-1 text-2xl font-black">Qué vemos y qué conviene probar</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">Reglas reproducibles revisan la hero oficial de cada Item ID LIVE. Una observación visual sugiere una hipótesis; no demuestra por sí sola una causa de CTR.</p></div>
            <span className="rounded-full border border-sky-200/20 px-3 py-2 text-xs font-black text-sky-100">{visualQuality.status === "AVAILABLE" ? "Disponible" : visualQuality.status === "PARTIAL" ? "Evidencia parcial" : "No comprobado"}</span>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-4">
            {[
              ["Hero observadas", numberValue(visualQuality.heroImagesObserved)],
              ["Análisis disponible", visualAvailable],
              ["Parcial", visualPartial],
              ["No comprobado", visualUnproven],
            ].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-white/10 bg-black/20 p-3"><p className="text-xs text-white/45">{label}</p><p className="mt-1 text-2xl font-black">{typeof value === "number" ? value : "—"}</p></div>)}
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {visualListings.map((listing) => {
              const signals = record(listing.signals)
              const dimensions = record(record(signals.imageDimensions).value)
              const findings = rows(listing.findings)
              const score = record(listing.predictedHeroScore)
              const imageUrl = typeof listing.heroImageUrl === "string" ? listing.heroImageUrl : null
              return <article key={stringValue(listing.ebayItemId)} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <div className="flex gap-4">
                  <div className="h-28 w-28 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white">{imageUrl ? <img src={imageUrl} alt={`Imagen principal del Item ${stringValue(listing.ebayItemId)}`} className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center text-slate-500"><ImageIcon size={24} /></div>}</div>
                  <div className="min-w-0 flex-1"><p className="text-xs font-black uppercase tracking-wide text-white/40">Item ID</p><p className="mt-1 break-all font-black">{stringValue(listing.ebayItemId)}</p><p className="mt-2 text-xs text-white/50">{typeof dimensions.width === "number" && typeof dimensions.height === "number" ? `${dimensions.width} × ${dimensions.height} px` : "Dimensiones no comprobadas"}</p><p className="mt-2 text-xs font-black text-sky-100">{listing.status === "AVAILABLE" ? "Diagnóstico disponible" : listing.status === "PARTIAL" ? "Diagnóstico parcial" : "Evidencia no disponible"}</p>{score.status === "PARTIAL" && typeof score.value === "number" ? <p className="mt-2 text-sm"><span className="font-black">Presentación por reglas: {score.value}/100</span><span className="text-white/45"> · no predice ventas</span></p> : null}</div>
                </div>
                <div className="mt-4 space-y-3">
                  {findings.slice(0, 3).map((finding) => <div key={stringValue(finding.findingCode)} className="rounded-xl border border-amber-200/15 bg-amber-200/[0.05] p-3"><p className="font-black text-amber-50">{stringValue(finding.observation)}</p><p className="mt-2 text-xs leading-5 text-white/55"><span className="font-black text-white/75">Por qué puede importar:</span> {stringValue(finding.whyItMayMatter)}</p><p className="mt-1 text-xs leading-5 text-white/55"><span className="font-black text-white/75">Qué revisar:</span> {stringValue(finding.whatToReview)}</p><details className="mt-2 text-xs"><summary className="cursor-pointer font-black text-sky-100">Ver evidencia e hipótesis por separado</summary><div className="mt-2 space-y-1 text-white/50"><p><span className="font-black text-white/70">Observación:</span> {stringValue(finding.observation)}</p><p><span className="font-black text-white/70">Objetivo:</span> {stringValue(finding.objective)}</p><p><span className="font-black text-white/70">Hipótesis:</span> {stringValue(finding.hypothesis)}</p><p><span className="font-black text-white/70">Experimento propuesto:</span> {stringValue(finding.proposedExperiment)}</p></div></details></div>)}
                  {findings.length === 0 && listing.status !== "UNPROVEN" ? <p className="rounded-xl border border-emerald-200/15 bg-emerald-200/[0.05] p-3 text-sm text-emerald-100">Las reglas objetivas no detectaron un problema material en esta hero.</p> : null}
                  {listing.status === "UNPROVEN" ? <p className="rounded-xl border border-white/10 p-3 text-sm text-white/55">La imagen no estuvo accesible. Esto no se interpreta como un fallo visual y no detiene a los otros listings.</p> : null}
                </div>
                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">{imageUrl ? <a href={imageUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 text-xs font-black"><Eye size={14} />VER IMAGEN</a> : <span className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/10 text-xs text-white/35">IMAGEN NO DISPONIBLE</span>}<details className="rounded-xl border border-white/15 px-3 py-3 text-xs"><summary className="cursor-pointer text-center font-black">VER POR QUÉ</summary><div className="mt-3 space-y-2 text-white/50"><p>Fondo blanco: {record(signals.mainImageWhiteBackgroundStandard).value === true ? "probado" : record(signals.mainImageWhiteBackgroundStandard).value === false ? "no probado" : "sin evidencia"}</p><p>Dominancia: {typeof record(signals.productDominance).value === "number" ? `${Math.round(Number(record(signals.productDominance).value) * 100)}%` : "no comprobada"}</p><p>Centrado: {typeof record(signals.productCentering).value === "number" ? `${Math.round(Number(record(signals.productCentering).value) * 100)}% de desplazamiento` : "no comprobado"}</p>{rows(score.components).map((component) => <p key={stringValue(component.component)}>{stringValue(component.component)}: {numberValue(component.points) ?? "—"}/{numberValue(component.maximum) ?? "—"}</p>)}</div></details><details className="rounded-xl border border-violet-200/20 bg-violet-200/[0.05] px-3 py-3 text-xs"><summary className="cursor-pointer text-center font-black text-violet-100">PREPARAR EXPERIMENTO</summary><div className="mt-3 space-y-2 text-white/55">{findings.length ? findings.map((finding) => <p key={stringValue(finding.findingCode)}>{stringValue(finding.proposedExperiment)}</p>) : <p>No hay una variante material que preparar con la evidencia actual.</p>}<p className="font-black text-white/70">No edita eBay ni genera imágenes.</p></div></details></div>
              </article>
            })}
          </div>
          <p className="mt-4 text-xs leading-5 text-white/40">IA visual: {numberValue(record(visualQuality.ai).aiCallCount) ?? 0} llamadas. El filtro determinístico fue suficiente para este diagnóstico inicial. Generación de imágenes: 0.</p>
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
