"use client"

import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  Database,
  Eye,
  FlaskConical,
  ImageOff,
  ListChecks,
  LockKeyhole,
  Package,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import Image from "next/image"
import { useState, type ReactNode } from "react"

import type {
  CommercialListingDecisionV1,
  CommercialListingReadModel,
  CommercialMonitorCapabilityStatus,
  CommercialMonitorGetDto,
} from "@/lib/ebay/commercial-monitor-readonly-contract"
import { presentCommercialMonitorRegistryV1 } from
  "@/lib/ebay/ebay-commercial-monitor-registry-presentation-v1"
import {
  presentSellerOsCode,
  presentSellerOsStatus,
  sellerOsCapabilityBucket,
  sellerOsStatusTone,
  SELLER_OS_UI_TYPOGRAPHY_V1 as type,
} from "@/lib/seller-os/presentation"

type CommercialMonitorCanonicalDashboardProps = {
  monitor: CommercialMonitorGetDto
  onRefresh: () => void
  refreshing: boolean
}

const numberFormatter = new Intl.NumberFormat("es-US", { maximumFractionDigits: 2 })

const decisionLabels: Record<CommercialListingDecisionV1["classification"], string> = {
  VISIBILITY: "Visibilidad",
  CTR: "CTR",
  CONVERSION: "Conversión",
  DATA_QUALITY: "Calidad de datos",
  HEALTHY_WAIT: "Esperar / saludable",
}

const actionLabels: Record<CommercialListingDecisionV1["recommendedAction"], string> = {
  WAIT: "Esperar y medir",
  IMPROVE_VISIBILITY: "Mejorar visibilidad",
  IMPROVE_CTR: "Mejorar CTR",
  IMPROVE_CONVERSION: "Mejorar conversión",
  FIX_DATA_QUALITY: "Resolver calidad de datos",
  REVIEW_EBAY_GUIDANCE: "Revisar guía de eBay",
  START_CONTROLLED_EXPERIMENT: "Iniciar experimento controlado",
  HUMAN_REVIEW: "Revisión humana",
}

const reasonLabels: Record<string, string> = {
  AUTHORITATIVE_ZERO_IMPRESSIONS: "Sin impresiones con evidencia autoritativa",
  LOW_CTR_WITH_SUFFICIENT_IMPRESSIONS: "CTR bajo con tráfico suficiente",
  TRAFFIC_WITHOUT_CONVERSION: "Tráfico sin conversión suficiente",
  INSUFFICIENT_TRAFFIC: "Tráfico insuficiente para intervenir",
  INSUFFICIENT_ANALYTICS_EVIDENCE: "Evidencia de eBay Analytics insuficiente",
  BLOCKING_DATA_QUALITY_ISSUE: "Hay un bloqueo de calidad de datos",
  ACTIVE_EXPERIMENT_PROTECTS_VARIABLE: "Un experimento activo protege variables",
  WAIT_ACTIVE_EXPERIMENT: "Esperar: experimento activo",
  WAIT_MINIMUM_TIME: "Aún no cumple el tiempo mínimo",
  WAIT_MINIMUM_EVIDENCE: "Aún no cumple la evidencia mínima",
  REVIEW_EXPERIMENT_RESULT: "Resultado listo para revisión",
  EXTERNAL_SIGNAL_REVIEW: "Nueva señal de eBay pendiente de revisión",
  HARD_OVERRIDE_REQUIRES_HUMAN_REVIEW: "Una señal crítica requiere revisión humana",
  HEALTHY_EVIDENCE_WAIT_FOR_NEXT_REVIEW: "Esperar el siguiente punto de revisión",
  LIVE_ANALYTICS_CONTRADICTS_GUIDANCE: "La evidencia activa contradice la guía",
  GUIDANCE_SUPPORTED_BY_DATA_QUALITY_GAP: "La guía coincide con una brecha de datos",
  INSUFFICIENT_CONVERSION_EVIDENCE: "Evidencia de conversión insuficiente",
  BENCHMARK_SUPPORTS_GUIDANCE: "El benchmark respalda la guía",
  BENCHMARK_NOT_AVAILABLE: "Benchmark no disponible",
  GUIDANCE_NOT_AVAILABLE: "Guía de eBay no disponible",
}

function formatValue(value: number | null) {
  return value === null ? "—" : numberFormatter.format(value)
}

function formatTimestamp(value: string | null) {
  if (!value) return "Sin observación"
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(date)
    : "Fecha no disponible"
}

function humanReason(reason: string) {
  return reasonLabels[reason] ?? presentSellerOsCode(reason)
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 ${type.status} ${sellerOsStatusTone(status)}`}>
      {presentSellerOsStatus(status)}
    </span>
  )
}

function PriorityChip({ priority }: { priority: CommercialListingDecisionV1["priority"] }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 ${type.status} ${sellerOsStatusTone(priority)}`}>
      {presentSellerOsStatus(priority)}
    </span>
  )
}

function KpiCard({
  label,
  value,
  status,
  detail,
  icon,
  suffix,
}: {
  label: string
  value: number | null
  status: string
  detail: string
  icon: ReactNode
  suffix?: string
}) {
  return (
    <article className="min-w-0 border-b border-slate-100 bg-white p-5 last:border-b-0 sm:border-r xl:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`${type.cardLabel} text-slate-500`}>{label}</p>
          <p className="mt-2 text-[34px] font-black leading-none tracking-tight text-slate-950 xl:text-[38px]">
            {formatValue(value)}{value === null || !suffix ? "" : suffix}
          </p>
        </div>
        <span className="rounded-lg bg-cyan-50 p-2 text-cyan-700">{icon}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
        <StatusChip status={status} />
        <p className={`${type.helper} max-w-[18rem] text-right text-slate-500`}>{detail}</p>
      </div>
    </article>
  )
}

function HealthCard({
  label,
  count,
  status,
  icon: Icon,
  accent,
}: {
  label: string
  count: number | null
  status: CommercialMonitorCapabilityStatus
  icon: LucideIcon
  accent: string
}) {
  return (
    <article className="min-w-0 border-b border-slate-100 bg-white p-4 last:border-b-0 sm:border-r xl:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <span className={`rounded-lg p-2 ${accent}`}><Icon size={17} /></span>
        <StatusChip status={status} />
      </div>
      <p className="mt-3 text-2xl font-black text-slate-950">{formatValue(count)}</p>
      <p className={`${type.cardLabel} mt-1 text-slate-600`}>{label}</p>
    </article>
  )
}

function ListingIdentity({ listing }: { listing: CommercialListingReadModel }) {
  const impressions = listing.metrics.impressions.value
  const views = listing.metrics.ebay_views.value
  const ctr = listing.metrics.ctr_calculated.value ?? listing.metrics.ctr_reported.value
  const sold = listing.metrics.transactions.value
  return (
    <div className="flex min-w-0 items-center gap-3">
      {listing.identity.primaryImageUrl ? (
        <Image
          src={listing.identity.primaryImageUrl}
          alt={listing.identity.title ? `Imagen de ${listing.identity.title}` : "Imagen de la publicación"}
          width={64}
          height={64}
          unoptimized
          className="h-16 w-16 shrink-0 rounded-xl border border-slate-200 object-cover"
        />
      ) : (
        <span aria-label="Imagen no disponible" className="grid h-16 w-16 shrink-0 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-slate-300">
          <ImageOff size={20} />
        </span>
      )}
      <div className="min-w-0">
        <p className={`${type.tablePrimary} line-clamp-2 font-bold text-slate-900`}>
          {listing.identity.title ?? `Item ${listing.identity.itemId}`}
        </p>
        <p className={`${type.tableSecondary} mt-1 truncate text-slate-500`}>
          Item {listing.identity.itemId}{listing.identity.sku ? ` · SKU ${listing.identity.sku}` : ""}
        </p>
        <p className={`${type.tableSecondary} mt-1 text-cyan-800`}>
          {formatValue(impressions)} impresiones · {formatValue(views)} vistas · CTR {formatValue(ctr)}% · {formatValue(sold)} vendidos
        </p>
      </div>
    </div>
  )
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4">
      <p className={`${type.cardTitle} text-slate-700`}>{title}</p>
      <p className={`${type.helper} mt-1 text-slate-500`}>{detail}</p>
    </div>
  )
}

export function CommercialMonitorCanonicalDashboard({
  monitor,
  onRefresh,
  refreshing,
}: CommercialMonitorCanonicalDashboardProps) {
  const [trafficScope, setTrafficScope] = useState<"ACCOUNT_TRAFFIC" | "CURRENT_LIVE_PORTFOLIO">(
    "CURRENT_LIVE_PORTFOLIO",
  )
  const backend = monitor.backend
  const accountTraffic = backend.trafficScopes.accountTraffic
  const currentLiveTraffic = backend.trafficScopes.currentLivePortfolio
  const accountTrafficSelected = trafficScope === "ACCOUNT_TRAFFIC"
  const selectedTraffic = accountTrafficSelected
    ? {
        status: accountTraffic.status as CommercialMonitorCapabilityStatus,
        impressions: accountTraffic.impressions,
        listingViews: accountTraffic.listingViews,
        quantitySold: accountTraffic.quantitySold,
        ctr: accountTraffic.ctr,
        detail: accountTraffic.status === "AVAILABLE"
          ? `Tráfico de la cuenta · ${accountTraffic.timeZone}`
          : "Tráfico de la cuenta no disponible · sin usar el portafolio como sustituto",
      }
    : {
        status: currentLiveTraffic.completeness,
        impressions: currentLiveTraffic.impressions,
        listingViews: currentLiveTraffic.listingViews,
        quantitySold: currentLiveTraffic.quantitySold,
        ctr: currentLiveTraffic.ctr,
        detail: "Publicaciones activas canónicas · Item IDs únicos de Trading",
      }
  const registry = backend.capabilities.registry
  const registryPresentation = presentCommercialMonitorRegistryV1(registry)
  const integrity = backend.livePortfolioIntegrity
  const activeIntegrityFindings = integrity.findings.filter((finding) =>
    finding.lifecycle === "ACTIVE_VIOLATION")
  const mitigatedIntegrityFindings = integrity.findings.filter((finding) =>
    finding.lifecycle === "MITIGATED_BY_POLICY")
  const passingIntegrityGuards = integrity.deterministicGuards.filter((guard) =>
    guard.status === "PASS").length
  const qualityUnavailable = backend.listingQualityReport.status === "UNAVAILABLE_NO_CURRENT_REPORT"
  const decisionsByKey = new Map(backend.decisions.map((decision) =>
    [decision.listingKey, decision] as const))
  const actionPlan = backend.operationalHealth.priorityActionPlan.flatMap((row) => {
    const decision = decisionsByKey.get(row.listingKey)
    return decision ? [decision] : []
  })
  const renderedCriticalAlerts = actionPlan.filter((decision) =>
    decision.priority === "CRITICAL" || decision.priority === "HIGH").slice(0, 4)
  const guidanceByListing = new Map(backend.guidanceVsSellerOs.map((row) =>
    [row.listingKey, row] as const))
  const liveRows = backend.decisions.flatMap((decision) => {
    const listing = monitor.listings.find((candidate) => candidate.key === decision.listingKey)
    return listing ? [{ listing, decision }] : []
  }).slice(0, 8)
  const distributionTotal = backend.operationalHealth.statusDistribution.reduce(
    (total, row) => total + row.count,
    0,
  )
  const hasComparablePerformanceSeries =
    backend.operationalHealth.performanceSeries.points.length >= 2
  const actionTypeDistribution = [...new Map(actionPlan.map((decision) => [
    decision.recommendedAction,
    actionPlan.filter((row) => row.recommendedAction === decision.recommendedAction).length,
  ] as const)).entries()]
  const actionTypeTotal = actionTypeDistribution.reduce((total, [, count]) => total + count, 0)

  const systemCapabilities = [
    { label: "eBay Analytics", status: backend.capabilities.analytics },
    { label: "Luna Portex", status: backend.capabilities.inventory.status },
    { label: "Órdenes", status: backend.kpis.orders.status },
    { label: "Informe de calidad", status: backend.listingQualityReport.status },
    { label: "Economía", status: "EVIDENCE_GATED" },
    { label: "WhatsApp", status: "DRY_RUN_ONLY" },
  ] as const
  const systemStatusCounts = systemCapabilities.reduce((counts, capability) => {
    counts[sellerOsCapabilityBucket(capability.status)] += 1
    return counts
  }, { AVAILABLE: 0, LIMITED: 0, UNAVAILABLE: 0 })
  const overallStatus = activeIntegrityFindings.length > 0
    ? "Requiere atención"
    : systemStatusCounts.UNAVAILABLE > 0 || systemStatusCounts.LIMITED > 0
      ? "Operativo con limitaciones"
      : "Operativo"

  return (
    <div id="commercial-dashboard" className="min-h-screen bg-[#eef2f6] text-base text-slate-950">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-[#f8fafc]/95 px-4 py-3 backdrop-blur md:px-6">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className={type.pageTitle}>Monitor comercial de eBay</h1>
              <span className={`rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-800 ${type.status}`}>Solo lectura</span>
            </div>
            <p className={type.pageSubtitle}>Estado de la cuenta, prioridades y decisiones respaldadas por evidencia.</p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#102033] px-4 text-white transition hover:bg-[#1c324c] disabled:cursor-wait disabled:opacity-60 ${type.button}`}
          >
            <CalendarRange size={17} />{refreshing ? "Actualizando…" : "Actualizar datos"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] space-y-5 p-4 pb-28 md:p-6">
        <section aria-label="Cuenta y sincronización" className="grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:grid-cols-2 xl:grid-cols-[1.2fr_.7fr_1.1fr_1fr]">
          <div className="border-b border-slate-100 px-5 py-4 xl:border-b-0 xl:border-r">
            <p className={`${type.cardLabel} text-slate-500`}>Cuenta eBay</p>
            <p className="mt-1 truncate font-black">{monitor.marketplace.accountAlias ?? "Cuenta no configurada"}</p>
          </div>
          <div className="border-b border-slate-100 px-5 py-4 xl:border-b-0 xl:border-r">
            <p className={`${type.cardLabel} text-slate-500`}>Marketplace</p>
            <p className="mt-1 font-black">{monitor.marketplace.marketplaceId}</p>
          </div>
          <div className="border-b border-slate-100 px-5 py-4 xl:border-b-0 xl:border-r">
            <p className={`${type.cardLabel} text-slate-500`}>Última sincronización</p>
            <time dateTime={monitor.generatedAt} className="mt-1 block font-black">{formatTimestamp(monitor.generatedAt)}</time>
          </div>
          <div className="px-5 py-4">
            <p className={`${type.cardLabel} text-slate-500`}>Estado general</p>
            <p className={`mt-1 font-black ${activeIntegrityFindings.length > 0 ? "text-amber-800" : "text-emerald-800"}`}>{overallStatus}</p>
          </div>
        </section>

        <section aria-label="Seleccionar ámbito de métricas" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
          <div>
            <p className={`${type.cardLabel} text-slate-800`}>Ámbito de las métricas</p>
            <p className={`${type.helper} text-slate-500`}>La cuenta y el portafolio activo son poblaciones diferentes y no se mezclan.</p>
          </div>
          <div className="inline-flex rounded-xl bg-slate-100 p-1" role="group" aria-label="Seleccionar ámbito de tráfico">
            <button
              type="button"
              aria-pressed={accountTrafficSelected}
              onClick={() => setTrafficScope("ACCOUNT_TRAFFIC")}
              className={`min-h-10 rounded-lg px-4 ${type.button} ${accountTrafficSelected ? "bg-white text-cyan-800 shadow-sm" : "text-slate-600"}`}
            >Tráfico de la cuenta</button>
            <button
              type="button"
              aria-pressed={!accountTrafficSelected}
              onClick={() => setTrafficScope("CURRENT_LIVE_PORTFOLIO")}
              className={`min-h-10 rounded-lg px-4 ${type.button} ${!accountTrafficSelected ? "bg-white text-cyan-800 shadow-sm" : "text-slate-600"}`}
            >Portafolio activo</button>
          </div>
        </section>

        <section aria-label="Indicadores principales" className="grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:grid-cols-2 xl:grid-cols-6">
          <KpiCard label="Publicaciones activas" value={backend.kpis.activeListings.value} status={backend.kpis.activeListings.status} detail="Publicaciones activas canónicas" icon={<Package size={20} />} />
          <KpiCard label="Impresiones" value={selectedTraffic.impressions} status={selectedTraffic.status} detail={selectedTraffic.detail} icon={<BarChart3 size={20} />} />
          <KpiCard label="Vistas" value={selectedTraffic.listingViews} status={selectedTraffic.status} detail={selectedTraffic.detail} icon={<Eye size={20} />} />
          <KpiCard label="CTR" value={selectedTraffic.ctr} status={selectedTraffic.status} detail={selectedTraffic.detail} icon={<TrendingUp size={20} />} suffix="%" />
          <KpiCard label="Cantidad vendida" value={selectedTraffic.quantitySold} status={selectedTraffic.status} detail="Métrica TRANSACTION de eBay Analytics; no equivale a órdenes" icon={<Activity size={20} />} />
          <KpiCard label="Órdenes" value={backend.kpis.orders.value} status={backend.kpis.orders.status} detail={backend.kpis.orders.value === null ? "Autorización o fuente pendiente" : "Lectura de fulfillment"} icon={<ShoppingBag size={20} />} />
        </section>

        <section aria-labelledby="attention-heading">
          <div className="mb-3">
            <p className={`${type.sectionEyebrow} text-cyan-800`}>Prioridades</p>
            <h2 id="attention-heading" className={type.sectionTitle}>Requiere atención</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div><p className={`${type.cardLabel} text-rose-700`}>Alertas comerciales</p><p className={`${type.helper} mt-1 text-slate-500`}>Prioridades críticas o altas respaldadas por la decisión actual.</p></div>
                <strong className="text-3xl font-black text-rose-700">{renderedCriticalAlerts.length}</strong>
              </div>
              <p className={`${type.helper} mt-3 font-bold text-slate-700`}>{actionPlan.length} acciones comerciales priorizadas</p>
            </article>

            <article className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div><p className={`${type.cardLabel} text-amber-800`}>Integridad del sistema</p><p className={`${type.helper} mt-1 text-slate-500`}>{activeIntegrityFindings.length} incidencias activas · {mitigatedIntegrityFindings.length} mitigadas · {passingIntegrityGuards} controles correctos</p></div>
                <strong className="text-3xl font-black text-amber-800">{activeIntegrityFindings.length}</strong>
              </div>
              <a href="#system-integrity" className={`${type.button} mt-3 inline-flex items-center gap-1 text-cyan-800`}>Ver detalle técnico <ChevronRight size={16} /></a>
            </article>

            <article className="rounded-2xl border border-cyan-200 bg-white p-5 shadow-sm">
              <p className={`${type.cardLabel} text-cyan-800`}>Revisión humana</p>
              <div className={`${type.helper} mt-2 space-y-1 text-slate-600`}>
                <p><strong>{formatValue(backend.operationalHealth.needIntervention.count)}</strong> acciones comerciales ejecutables</p>
                <p><strong>{formatValue(backend.operationalHealth.dataQuality.count)}</strong> publicaciones con evidencia por revisar</p>
                <p><strong>{formatValue(registry.humanReviewCount)}</strong> relaciones del registro requieren revisión humana</p>
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className={`${type.cardLabel} text-slate-700`}>Estado del sistema</p>
              <p className={`${type.helper} mt-1 text-slate-500`}>{systemStatusCounts.AVAILABLE} disponibles · {systemStatusCounts.LIMITED} limitados · {systemStatusCounts.UNAVAILABLE} no disponibles</p>
              <a href="#system-status" className={`${type.button} mt-3 inline-flex items-center gap-1 text-cyan-800`}>Ver detalle <ChevronRight size={16} /></a>
            </article>
          </div>
        </section>

        <article id="guidance-table" className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <p className={`${type.sectionEyebrow} text-cyan-800`}>Inteligencia central</p>
              <h2 className={type.sectionTitle}>Portafolio y decisiones comerciales</h2>
              <p className={`${type.helper} mt-1 text-slate-500`}>La evidencia comercial y la calidad de datos se muestran por separado.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`${type.helper} text-slate-500`}>{liveRows.length} de {backend.decisions.length} publicaciones</span>
              <StatusChip status={backend.listingQualityReport.status} />
            </div>
          </div>

          <div className="hidden md:block">
            <table className="w-full table-fixed text-left">
              <thead className="bg-slate-50 text-[13px] font-black uppercase tracking-[0.08em] text-slate-500">
                <tr>
                  <th className="w-[38%] px-4 py-3">Publicación</th>
                  <th className="w-[14%] px-3 py-3">Diagnóstico</th>
                  <th className="w-[17%] px-3 py-3">Guía de eBay</th>
                  <th className="w-[21%] px-3 py-3">Seller OS</th>
                  <th className="w-[10%] px-3 py-3">Prioridad</th>
                </tr>
              </thead>
              <tbody>
                {liveRows.map(({ listing, decision }) => {
                  const guidance = guidanceByListing.get(listing.key)
                  return (
                    <tr key={listing.identity.itemId} className="min-h-[88px] border-t border-slate-100 align-middle">
                      <td className="px-4 py-3"><ListingIdentity listing={listing} /></td>
                      <td className={`px-3 py-3 ${type.tablePrimary} font-semibold text-slate-800`}>
                        {decisionLabels[decision.classification]}
                        <span className={`${type.tableSecondary} mt-1 block font-normal text-slate-500`}>Estado de evidencia</span>
                      </td>
                      <td className={`px-3 py-3 ${type.tableSecondary} text-slate-600`}>
                        {qualityUnavailable ? (
                          <><strong className="block text-slate-700">Sin informe vigente</strong><span>No se inventa una recomendación.</span></>
                        ) : (
                          <><strong className="block text-slate-700">{presentSellerOsStatus(guidance?.ebayGuidanceStatus)}</strong><span>{guidance?.reasonCodes.map(humanReason).join(" · ") || "Sin razón disponible"}</span></>
                        )}
                      </td>
                      <td className={`px-3 py-3 ${type.tablePrimary} font-semibold text-slate-800`}>
                        {actionLabels[decision.recommendedAction]}
                        {decision.experimentRunning && (
                          <span className={`${type.tableSecondary} mt-1 block rounded-lg bg-violet-50 px-2 py-1 text-violet-800`}>
                            Experimento en curso · variables protegidas
                          </span>
                        )}
                        <details className={`${type.tableSecondary} mt-2 font-normal text-slate-500`}>
                          <summary className="cursor-pointer font-bold text-cyan-800">Ver detalle técnico</summary>
                          <p className="mt-1 break-words">{decision.reasonCodes.join(" · ") || "NO_REASON_CODE"}</p>
                          <p className="mt-1 break-words">{decision.protectionState} · variables: {decision.frozenVariables.join(", ") || "NONE"}</p>
                          <p className="mt-1 break-words">Próxima revisión: {decision.nextReviewCondition ?? "UNPROVEN"}</p>
                        </details>
                      </td>
                      <td className="px-3 py-3"><PriorityChip priority={decision.priority} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-slate-100 md:hidden">
            {liveRows.map(({ listing, decision }) => (
              <article key={listing.identity.itemId} className="space-y-3 p-4">
                <ListingIdentity listing={listing} />
                <div className="grid grid-cols-2 gap-3">
                  <div><p className={`${type.cardLabel} text-slate-500`}>Diagnóstico</p><p className={type.body}>{decisionLabels[decision.classification]}</p></div>
                  <div><p className={`${type.cardLabel} text-slate-500`}>Prioridad</p><PriorityChip priority={decision.priority} /></div>
                  <div className="col-span-2"><p className={`${type.cardLabel} text-slate-500`}>Seller OS</p><p className={type.body}>{actionLabels[decision.recommendedAction]}</p></div>
                </div>
              </article>
            ))}
          </div>
          <div className={`flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 ${type.helper} text-slate-500`}>
            <span>Identidad activa de Trading · el Informe de calidad es enriquecimiento opcional</span>
            <a href="#advanced-diagnostics" className="font-black text-cyan-800">Ver todas y diagnóstico avanzado</a>
          </div>
        </article>

        <section className="grid gap-4 lg:grid-cols-3">
          <article className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between"><div><p className={`${type.sectionEyebrow} text-rose-700`}>Alertas comerciales</p><h2 className={type.cardTitle}>Prioridad comercial</h2></div><span className="text-3xl font-black text-rose-700">{renderedCriticalAlerts.length}</span></div>
            <div className="mt-3 space-y-2">
              {renderedCriticalAlerts.map((decision) => (
                <div key={decision.listingKey} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-2"><strong className="truncate">Item {monitor.listings.find((row) => row.key === decision.listingKey)?.identity.itemId ?? "no asociado"}</strong><PriorityChip priority={decision.priority} /></div>
                  <p className={`${type.helper} mt-1 text-slate-500`}>{decision.reasonCodes.map(humanReason).join(" · ")}</p>
                </div>
              ))}
              {renderedCriticalAlerts.length === 0 && <EmptyState title="Sin alertas comerciales críticas" detail="No hay prioridades críticas o altas con la evidencia actual. Las incidencias de integridad se muestran por separado." />}
            </div>
          </article>

          <article id="priority-action-plan" className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
            <p className={`${type.sectionEyebrow} text-amber-800`}>Siguiente acción</p>
            <h2 className={type.cardTitle}>Plan de acción prioritario</h2>
            <div className="mt-3 space-y-2">
              {actionPlan.slice(0, 5).map((decision) => (
                <div key={decision.listingKey} className="flex gap-2 rounded-xl border border-slate-100 p-3">
                  <ListChecks size={17} className="mt-0.5 shrink-0 text-amber-700" />
                  <div className="min-w-0"><p className="truncate font-bold">Item {monitor.listings.find((row) => row.key === decision.listingKey)?.identity.itemId ?? "no asociado"}</p><p className={`${type.helper} mt-1 text-slate-500`}>{actionLabels[decision.recommendedAction]}</p></div>
                </div>
              ))}
              {actionPlan.length === 0 && <EmptyState title="Sin acciones comerciales ejecutables" detail="Seller OS no propone intervención sin evidencia suficiente." />}
            </div>
          </article>

          <article id="upcoming-reviews" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className={`${type.sectionEyebrow} text-slate-600`}>Seguimiento</p>
            <h2 className={type.cardTitle}>Próximas revisiones</h2>
            <div className="mt-3 space-y-2">
              {backend.operationalHealth.upcomingReviews.slice(0, 3).map((review) => (
                <div key={`${review.listingKey}:${review.condition}`} className="rounded-xl bg-slate-50 p-3"><p className="font-bold">Item {monitor.listings.find((row) => row.key === review.listingKey)?.identity.itemId ?? "no asociado"}</p><p className={`${type.helper} mt-1 text-slate-500`}>{humanReason(review.condition)}</p></div>
              ))}
              {registry.humanReviewCount !== null && registry.humanReviewCount > 0 && (
                <div className={`rounded-xl border border-cyan-100 bg-cyan-50 p-3 ${type.helper} text-cyan-950`}><strong>{formatValue(registry.humanReviewCount)} relaciones del registro requieren revisión humana.</strong> No se realiza ninguna mutación automática.</div>
              )}
            </div>
          </article>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <details id="system-integrity" className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <div><p className={`${type.sectionEyebrow} text-amber-800`}>Integridad del sistema</p><h2 className={type.cardTitle}>{activeIntegrityFindings.length} incidencias activas · {mitigatedIntegrityFindings.length} mitigadas · {passingIntegrityGuards} controles correctos</h2></div>
              <span className={`${type.button} inline-flex items-center gap-1 text-cyan-800`}>Ver detalle técnico <ChevronRight className="transition group-open:rotate-90" size={17} /></span>
            </summary>
            <div className="mt-5 space-y-4 border-t border-slate-100 pt-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-xl bg-slate-50 p-3"><p className={type.cardLabel}>Publicaciones canónicas</p><strong className="mt-1 block text-xl">{formatValue(integrity.canonicalCohort.listingCount)}</strong></div>
                <div className="rounded-xl bg-slate-50 p-3"><p className={type.cardLabel}>Stock · Item IDs activos</p><strong className="mt-1 block text-xl">{formatValue(integrity.stockCohort.currentLiveItemCount)} / {formatValue(integrity.canonicalCohort.listingCount)}</strong></div>
                <div className="rounded-xl bg-slate-50 p-3"><p className={type.cardLabel}>Evidencia histórica</p><strong className="mt-1 block text-xl">{formatValue(integrity.stockCohort.nonLiveEvidenceRowCount)}</strong></div>
                <div className="rounded-xl bg-slate-50 p-3"><p className={type.cardLabel}>Item IDs duplicados</p><strong className="mt-1 block text-xl">{formatValue(integrity.stockCohort.duplicateItemIds.length)}</strong></div>
                <div className="rounded-xl bg-slate-50 p-3"><p className={type.cardLabel}>Colisiones de SKU activos</p><strong className="mt-1 block text-xl">{integrity.liveSkuUniqueness.collisionCount === null ? "No comprobado" : formatValue(integrity.liveSkuUniqueness.collisionCount)}</strong></div>
              </div>
              <p className={`${type.helper} text-slate-600`}>El denominador activo usa Item IDs canónicos únicos. Las particiones del registro y la evidencia histórica están excluidas.</p>
              <div className="space-y-2">
                {integrity.findings.map((finding) => (
                  <article key={`${finding.invariantCode}:${finding.entityRefs.join(":")}`} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center gap-2"><strong>{presentSellerOsCode(finding.invariantCode)}</strong><StatusChip status={finding.lifecycle} /></div>
                    <p className={`${type.helper} mt-1 text-slate-600`}>{finding.recommendedAction}</p>
                    <p className={`${type.tableSecondary} mt-2 font-mono text-slate-500`}>{finding.invariantCode} · {finding.lifecycle} · {finding.scopeType} · {finding.entityType}</p>
                  </article>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {integrity.deterministicGuards.map((guard) => (
                  <span key={guard.guardCode} title={`${guard.guardCode} · ${guard.reasonCode}`} className={`rounded-full border px-2.5 py-1 ${type.status} ${sellerOsStatusTone(guard.status)}`}>
                    {presentSellerOsCode(guard.guardCode)} · {presentSellerOsStatus(guard.status)}
                  </span>
                ))}
              </div>
            </div>
          </details>

          <details id="system-status" className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <div><p className={`${type.sectionEyebrow} text-cyan-800`}>Estado del sistema</p><h2 className={type.cardTitle}>{systemStatusCounts.AVAILABLE} disponibles · {systemStatusCounts.LIMITED} limitados · {systemStatusCounts.UNAVAILABLE} no disponibles</h2></div>
              <span className={`${type.button} inline-flex items-center gap-1 text-cyan-800`}>Ver detalle <ChevronRight className="transition group-open:rotate-90" size={17} /></span>
            </summary>
            <div className="mt-5 divide-y divide-slate-100 border-t border-slate-100">
              {systemCapabilities.map((capability) => (
                <div key={capability.label} className="flex items-center justify-between gap-3 py-3"><span className={type.body}>{capability.label}</span><StatusChip status={capability.status} /></div>
              ))}
              <a href="/admin/ebay/operational-readiness" className={`flex min-h-11 items-center gap-2 pt-3 text-cyan-800 ${type.button}`}><Wrench size={17} />Ver estado del sistema</a>
            </div>
          </details>
        </section>

        <section aria-labelledby="operational-health-heading" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><p className={`${type.sectionEyebrow} text-slate-500`}>Decisiones y estado operativo</p><h2 id="operational-health-heading" className={type.sectionTitle}>Semánticas específicas, sin falsos ceros</h2></div><p className={`${type.helper} text-slate-500`}>Stock desconocido: {formatValue(backend.operationalHealth.stockUnknown.count)}</p></div>
          <div className="mt-4 grid overflow-hidden rounded-xl border border-slate-100 sm:grid-cols-2 xl:grid-cols-6">
            <HealthCard label="Acciones comerciales ejecutables" count={backend.operationalHealth.needIntervention.count} status={backend.operationalHealth.needIntervention.status} icon={AlertTriangle} accent="bg-rose-100 text-rose-700" />
            <HealthCard label="Experimentos en curso" count={backend.operationalHealth.runningExperiments.count} status={backend.operationalHealth.runningExperiments.status} icon={FlaskConical} accent="bg-violet-100 text-violet-700" />
            <HealthCard label="Riesgos de stock comprobados" count={backend.operationalHealth.stockRisk.count} status={backend.operationalHealth.stockRisk.status} icon={Package} accent="bg-orange-100 text-orange-700" />
            <HealthCard label="Publicaciones con evidencia por revisar" count={backend.operationalHealth.dataQuality.count} status={backend.operationalHealth.dataQuality.status} icon={Database} accent="bg-amber-100 text-amber-700" />
            <HealthCard label="Recomendaciones de eBay" count={backend.operationalHealth.ebayRecommendations.count} status={backend.operationalHealth.ebayRecommendations.status} icon={Sparkles} accent="bg-cyan-100 text-cyan-700" />
            <HealthCard label="En espera / saludables" count={backend.operationalHealth.waitingHealthy.count} status={backend.operationalHealth.waitingHealthy.status} icon={CheckCircle2} accent="bg-emerald-100 text-emerald-700" />
          </div>
          <p className={`${type.helper} mt-3 text-slate-500`}>Cero riesgos de stock comprobados no significa que el portafolio esté seguro. Stock desconocido no se clasifica como riesgo ni como seguro.</p>
        </section>

        <section id="performance" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className={`${type.sectionEyebrow} text-slate-500`}>Rendimiento general</p><h2 className={type.cardTitle}>Tendencia de rendimiento</h2>
            {hasComparablePerformanceSeries ? (
              <div className="mt-4 space-y-2">{backend.operationalHealth.performanceSeries.points.slice(-5).map((point) => <div key={`${point.windowStart}:${point.observedAt}`} className={`grid grid-cols-[1fr_auto_auto] gap-2 rounded-lg bg-slate-50 px-3 py-2 ${type.tableSecondary}`}><span>{new Date(point.windowEnd).toLocaleDateString("es")}</span><span>{formatValue(point.impressions)} imp.</span><span>{formatValue(point.listingViews)} vistas</span></div>)}</div>
            ) : <EmptyState title="Tendencia todavía no disponible" detail="Se necesitan al menos dos snapshots comparables. No se generan puntos sintéticos." />}
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className={`${type.sectionEyebrow} text-slate-500`}>Diagnósticos</p><h2 className={type.cardTitle}>Distribución por estado</h2>
            {distributionTotal > 0 ? <div className="mt-4 space-y-2">{backend.operationalHealth.statusDistribution.map((row) => <div key={row.classification} className={`flex justify-between gap-2 ${type.tableSecondary}`}><span className="text-slate-600">{decisionLabels[row.classification]}</span><strong>{formatValue(row.count)}</strong></div>)}</div> : <EmptyState title="Sin distribución comprobada" detail="No se dibuja un gráfico de cero sin evidencia representativa." />}
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className={`${type.sectionEyebrow} text-slate-500`}>Acciones</p><h2 className={type.cardTitle}>Distribución por tipo</h2>
            {actionTypeTotal > 0 ? <div className="mt-4 space-y-2">{actionTypeDistribution.slice(0, 5).map(([action, count]) => <div key={action} className={`flex justify-between gap-2 ${type.tableSecondary}`}><span className="text-slate-600">{actionLabels[action]}</span><strong>{formatValue(count)}</strong></div>)}</div> : <EmptyState title="Sin acciones representables" detail="No existe evidencia suficiente para mostrar una distribución útil." />}
          </article>

          <article id="category-benchmark" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><p className={`${type.sectionEyebrow} text-slate-500`}>Benchmark de categoría</p><h2 className={type.cardTitle}>Calidad de publicaciones</h2></div><CircleGauge size={20} className="text-slate-400" /></div>
            {backend.operationalHealth.categoryBenchmarks.length > 0 ? <div className="mt-4 space-y-2">{backend.operationalHealth.categoryBenchmarks.map((benchmark) => <div key={benchmark.recommendationCategory} className={`flex items-center justify-between border-b border-slate-100 pb-2 ${type.tableSecondary}`}><span>{benchmark.recommendationCategory}</span><strong>{formatValue(benchmark.benchmark)}</strong></div>)}</div> : <EmptyState title="Informe de calidad no disponible" detail="Carga un informe vigente para ver benchmarks. No se inventan valores del Top 10 %." />}
          </article>
        </section>

        <details id="inventory-status" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <summary className={`${type.button} cursor-pointer text-slate-700`}>Ver procedencia y estado técnico de las fuentes</summary>
          <div className={`mt-4 grid gap-4 border-t border-slate-100 pt-4 ${type.helper} md:grid-cols-4`}>
            <div><p className="font-black">Registro</p><p className="mt-1 text-slate-500">{registryPresentation.summary}</p></div>
            <div><p className="font-black">Inventario</p><p className="mt-1 font-mono text-slate-500">{backend.capabilities.inventory.inventoryItemsResource}</p></div>
            <div><p className="font-black">Marketplace</p><p className="mt-1 text-slate-500">{monitor.liveCertification.account.bindingMatched ? "Vinculación certificada" : "Vinculación no comprobada"}</p></div>
            <div><p className="font-black">Ámbito canónico</p><p className="mt-1 font-mono text-slate-500">{integrity.canonicalCohort.scopeType} · {integrity.canonicalCohort.scopeId}</p></div>
          </div>
        </details>

        <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><LockKeyhole size={19} className="text-emerald-700" /><p className={type.cardTitle}>Seller OS funciona en modo de solo lectura</p></div><ShieldCheck size={20} className="text-emerald-700" /></div>
          <p className={`${type.helper} mt-2`}>Sin escrituras en eBay, cambios de publicaciones, mensajes a compradores ni envíos de WhatsApp.</p>
          <p className={`${type.helper} mt-2 font-black uppercase tracking-[0.08em] text-emerald-800`}>0 escrituras de marketplace · 0 escrituras del registro</p>
        </article>
      </main>
    </div>
  )
}
