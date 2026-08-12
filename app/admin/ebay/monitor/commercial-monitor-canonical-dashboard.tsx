import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CircleGauge,
  Database,
  Eye,
  FileText,
  FlaskConical,
  Package,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Wrench,
} from "lucide-react"
import type { ReactNode } from "react"

import type {
  CommercialListingDecisionV1,
  CommercialMonitorCapabilityStatus,
  CommercialMonitorGetDto,
  EbayGuidanceComparisonV1,
} from "@/lib/ebay/commercial-monitor-readonly-contract"

type CommercialMonitorCanonicalDashboardProps = {
  monitor: CommercialMonitorGetDto
}

const numberFormatter = new Intl.NumberFormat("es-US", {
  maximumFractionDigits: 2,
})

const capabilityTone: Record<CommercialMonitorCapabilityStatus, string> = {
  AVAILABLE: "border-emerald-300/30 bg-emerald-300/[0.12] text-emerald-100",
  COMPLETE: "border-emerald-300/30 bg-emerald-300/[0.12] text-emerald-100",
  PARTIAL: "border-amber-300/30 bg-amber-300/[0.12] text-amber-100",
  PARTIAL_CERTIFIED: "border-cyan-300/30 bg-cyan-300/[0.12] text-cyan-100",
  DEGRADED: "border-orange-300/30 bg-orange-300/[0.12] text-orange-100",
  UNAVAILABLE: "border-white/15 bg-white/[0.06] text-white/65",
  UNAVAILABLE_AUTH_PENDING: "border-violet-300/30 bg-violet-300/[0.12] text-violet-100",
  UNAVAILABLE_NO_CURRENT_REPORT: "border-white/15 bg-white/[0.06] text-white/65",
  AUTH_PENDING: "border-violet-300/30 bg-violet-300/[0.12] text-violet-100",
  MISSING: "border-white/15 bg-white/[0.06] text-white/65",
  UNPROVEN: "border-amber-300/30 bg-amber-300/[0.12] text-amber-100",
  ERROR: "border-rose-300/30 bg-rose-300/[0.12] text-rose-100",
}

const priorityTone: Record<CommercialListingDecisionV1["priority"], string> = {
  CRITICAL: "border-rose-300/30 bg-rose-300/[0.12] text-rose-100",
  HIGH: "border-orange-300/30 bg-orange-300/[0.12] text-orange-100",
  MEDIUM: "border-amber-300/30 bg-amber-300/[0.12] text-amber-100",
  LOW: "border-white/15 bg-white/[0.06] text-white/65",
}

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
  REVIEW_EBAY_GUIDANCE: "Revisar guía eBay",
  START_CONTROLLED_EXPERIMENT: "Iniciar experimento controlado",
  HUMAN_REVIEW: "Revisión humana",
}

const reasonLabels: Record<string, string> = {
  AUTHORITATIVE_ZERO_IMPRESSIONS: "Sin impresiones con evidencia autoritativa",
  LOW_CTR_WITH_SUFFICIENT_IMPRESSIONS: "CTR bajo con tráfico suficiente",
  TRAFFIC_WITHOUT_CONVERSION: "Tráfico sin conversión suficiente",
  INSUFFICIENT_TRAFFIC: "Tráfico insuficiente para intervenir",
  INSUFFICIENT_ANALYTICS_EVIDENCE: "Evidencia de Analytics insuficiente",
  BLOCKING_DATA_QUALITY_ISSUE: "Hay un bloqueo de calidad de datos",
  ACTIVE_EXPERIMENT_PROTECTS_VARIABLE: "Experimento activo protege variables",
  HEALTHY_EVIDENCE_WAIT_FOR_NEXT_REVIEW: "Esperar el siguiente punto de revisión",
  LIVE_ANALYTICS_CONTRADICTS_GUIDANCE: "Analytics live contradice la guía",
  GUIDANCE_SUPPORTED_BY_DATA_QUALITY_GAP: "La guía coincide con un gap de datos",
  INSUFFICIENT_CONVERSION_EVIDENCE: "Evidencia de conversión insuficiente",
  BENCHMARK_SUPPORTS_GUIDANCE: "Benchmark respalda la guía",
  BENCHMARK_NOT_AVAILABLE: "Benchmark no disponible",
  GUIDANCE_NOT_AVAILABLE: "Guía eBay no disponible",
}

function StatusChip({ status }: { status: CommercialMonitorCapabilityStatus }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${capabilityTone[status]}`}>
      {status.replaceAll("_", " ")}
    </span>
  )
}

function PriorityChip({ priority }: { priority: CommercialListingDecisionV1["priority"] }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${priorityTone[priority]}`}>
      {priority}
    </span>
  )
}

function formatValue(value: number | null) {
  return value === null ? "—" : numberFormatter.format(value)
}

function formatTimestamp(value: string | null) {
  if (!value) return "Sin observación"
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(date)
    : "Timestamp no disponible"
}

function listingLabel(monitor: CommercialMonitorGetDto, listingKey: string) {
  const listing = monitor.listings.find((row) => row.key === listingKey)
  return listing ? `Item ${listing.identity.itemId}` : "Listing no asociado"
}

function humanReason(reason: string) {
  return reasonLabels[reason] ?? reason.replaceAll("_", " ")
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
  status: CommercialMonitorCapabilityStatus
  detail: string
  icon: ReactNode
  suffix?: string
}) {
  return (
    <article className="min-w-0 rounded-2xl border border-white/10 bg-[#0d1320]/90 p-4 shadow-[0_16px_44px_rgba(0,0,0,0.16)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/45">{label}</p>
          <p className="mt-3 text-3xl font-black tracking-tight text-white">{formatValue(value)}{value === null || !suffix ? "" : suffix}</p>
        </div>
        <span className="rounded-xl border border-white/10 bg-white/[0.045] p-2.5 text-cyan-100">{icon}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <StatusChip status={status} />
        <p className="text-right text-[11px] leading-4 text-white/45">{detail}</p>
      </div>
    </article>
  )
}

function HealthCard({
  label,
  count,
  status,
  icon,
  accent,
}: {
  label: string
  count: number | null
  status: CommercialMonitorCapabilityStatus
  icon: ReactNode
  accent: string
}) {
  return (
    <article className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className={`rounded-xl p-2.5 ${accent}`}>{icon}</span>
        <StatusChip status={status} />
      </div>
      <p className="mt-5 text-2xl font-black">{formatValue(count)}</p>
      <p className="mt-1 text-[10px] font-black uppercase tracking-[0.14em] text-white/45">{label}</p>
    </article>
  )
}

function GuidanceRow({
  monitor,
  row,
}: {
  monitor: CommercialMonitorGetDto
  row: EbayGuidanceComparisonV1
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black text-white">{listingLabel(monitor, row.listingKey)}</p>
          <p className="mt-1 text-[11px] text-white/45">Guía eBay: {row.ebayGuidanceStatus.replaceAll("_", " ")} · Diagnóstico: {row.sellerOsDiagnosisStatus}</p>
        </div>
        <span className="rounded-full border border-cyan-300/30 bg-cyan-300/[0.1] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-cyan-100">{row.conclusion.replaceAll("_", " ")}</span>
      </div>
      <p className="mt-4 text-sm text-white/70">{row.reasonCodes.map(humanReason).join(" · ") || "Sin conclusión adicional"}</p>
      <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.12em] text-white/40">Recomendación separada de ejecución automática</p>
    </article>
  )
}

export function CommercialMonitorCanonicalDashboard({
  monitor,
}: CommercialMonitorCanonicalDashboardProps) {
  const backend = monitor.backend
  const registry = backend.capabilities.registry
  const qualityUnavailable = backend.listingQualityReport.status === "UNAVAILABLE_NO_CURRENT_REPORT"
  const decisionsByKey = new Map(backend.decisions.map((decision) =>
    [decision.listingKey, decision] as const))
  const actionPlan = backend.operationalHealth.priorityActionPlan.flatMap((row) => {
    const decision = decisionsByKey.get(row.listingKey)
    return decision ? [decision] : []
  })
  const renderedCriticalAlerts = actionPlan.filter((decision) =>
    decision.priority === "CRITICAL" || decision.priority === "HIGH").slice(0, 4)
  const guidanceRows = backend.guidanceVsSellerOs.filter((row) =>
    row.ebayGuidanceStatus === "AVAILABLE")
  const distributionTotal = backend.operationalHealth.statusDistribution.reduce(
    (total, row) => total + row.count,
    0,
  )
  const hasPerformanceSeries = backend.operationalHealth.performanceSeries.points.length > 0

  return (
    <div id="commercial-dashboard" className="scroll-mt-5 space-y-6">
      <nav aria-label="Áreas del Commercial Monitor" className="flex gap-2 overflow-x-auto pb-1 text-[11px] font-black uppercase tracking-[0.12em] text-white/60">
        {[
          ["Resumen", "#commercial-dashboard"],
          ["Listings", "#priority-action-plan"],
          ["Kits y Componentes", "#advanced-diagnostics"],
          ["Stock Guard", "#inventory-status"],
          ["Tráfico y Conversión", "#performance"],
          ["Plan de Acción", "#priority-action-plan"],
          ["Experimentos", "#upcoming-reviews"],
          ["Aprendizaje", "#guidance"],
          ["Calidad de Datos", "#category-benchmark"],
          ["Timeline / Auditoría", "#advanced-diagnostics"],
        ].map(([label, href]) => (
          <a key={label} href={href} className="whitespace-nowrap rounded-full border border-white/10 bg-white/[0.025] px-3 py-2 transition hover:border-cyan-200/35 hover:bg-cyan-200/[0.06] hover:text-cyan-50">{label}</a>
        ))}
      </nav>

      <section aria-labelledby="control-heading" className="overflow-hidden rounded-[28px] border border-cyan-200/15 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_34%),linear-gradient(130deg,rgba(13,20,35,0.98),rgba(7,11,20,0.96))] p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-100/60">Control comercial</p>
            <h2 id="control-heading" className="mt-2 text-2xl font-black tracking-tight md:text-3xl">Decisiones que respetan la evidencia</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">Vista operativa de sólo lectura. Ninguna guía eBay ni decisión Seller OS ejecuta cambios de marketplace.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-right">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-white/45">Última observación</p>
            <time dateTime={monitor.generatedAt} className="mt-1 block text-sm font-bold text-white/80">{formatTimestamp(monitor.generatedAt)}</time>
          </div>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-[1.25fr_1fr]">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={backend.capabilities.sellerAccountBinding} />
              <span className="text-sm font-bold text-white/80">{monitor.marketplace.accountAlias ?? "Cuenta no configurada"} · {monitor.marketplace.marketplaceId}</span>
            </div>
            <p className="mt-3 text-xs text-white/50">Binding {monitor.liveCertification.account.bindingMatched ? "verificado" : "no probado"} · rango Analytics {monitor.liveCertification.analytics.windowStart ?? "sin inicio"} a {monitor.liveCertification.analytics.windowEnd ?? "sin cierre"}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-white/45">Cobertura Registry</p>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
              <p className="text-2xl font-black">{formatValue(registry.coveragePercent)}{registry.coveragePercent === null ? "" : "%"}</p>
              <p className="text-right text-xs text-white/50">{formatValue(registry.matchedCount)} matched · {formatValue(registry.humanReviewCount)} Human Review</p>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusChip status={backend.capabilities.tradingDiscovery} />
          <StatusChip status={backend.capabilities.marketplaceCertification} />
          <StatusChip status={backend.capabilities.analytics} />
          <StatusChip status={registry.status} />
          <StatusChip status={backend.capabilities.ordersFulfillment} />
          <StatusChip status={backend.capabilities.listingQualityReport} />
          <StatusChip status={backend.capabilities.inventory.status} />
        </div>
      </section>

      <section aria-label="Indicadores principales" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Active listings" value={backend.kpis.activeListings.value} status={backend.kpis.activeListings.status} detail="Trading live" icon={<Package size={19} />} />
        <KpiCard label="Impressions" value={backend.kpis.impressions.value} status={backend.kpis.impressions.status} detail="Analytics" icon={<BarChart3 size={19} />} />
        <KpiCard label="eBay views" value={backend.kpis.ebayViews.value} status={backend.kpis.ebayViews.status} detail="Analytics" icon={<Eye size={19} />} />
        <KpiCard label="Avg CTR" value={backend.kpis.averageCtr.value} status={backend.kpis.averageCtr.status} detail="Analytics · puntos porcentuales" icon={<TrendingUp size={19} />} suffix="%" />
        <KpiCard label="Orders" value={backend.kpis.orders.value} status={backend.kpis.orders.status} detail={backend.kpis.orders.value === null ? "No disponible · auth pendiente" : "Fulfillment readonly"} icon={<ShoppingBag size={19} />} />
      </section>

      <section aria-labelledby="operational-health-heading" className="rounded-[26px] border border-white/10 bg-[#0b101b] p-5 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/45">Decision & operational health</p>
            <h2 id="operational-health-heading" className="mt-2 text-2xl font-black">Dónde mirar primero</h2>
          </div>
          <p className="text-xs text-white/45">Contadores derivados por Decision Engine V1</p>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <HealthCard label="Need intervention" count={backend.operationalHealth.needIntervention.count} status={backend.operationalHealth.needIntervention.status} icon={<AlertTriangle size={18} />} accent="bg-rose-300/10 text-rose-100" />
          <HealthCard label="Running experiments" count={backend.operationalHealth.runningExperiments.count} status={backend.operationalHealth.runningExperiments.status} icon={<FlaskConical size={18} />} accent="bg-violet-300/10 text-violet-100" />
          <HealthCard label="Stock risk" count={backend.operationalHealth.stockRisk.count} status={backend.operationalHealth.stockRisk.status} icon={<Package size={18} />} accent="bg-orange-300/10 text-orange-100" />
          <HealthCard label="Data quality" count={backend.operationalHealth.dataQuality.count} status={backend.operationalHealth.dataQuality.status} icon={<Database size={18} />} accent="bg-amber-300/10 text-amber-100" />
          <HealthCard label="eBay recommendations" count={backend.operationalHealth.ebayRecommendations.count} status={backend.operationalHealth.ebayRecommendations.status} icon={<Sparkles size={18} />} accent="bg-cyan-300/10 text-cyan-100" />
          <HealthCard label="Waiting / healthy" count={backend.operationalHealth.waitingHealthy.count} status={backend.operationalHealth.waitingHealthy.status} icon={<CheckCircle2 size={18} />} accent="bg-emerald-300/10 text-emerald-100" />
        </div>
      </section>

      <section id="guidance" aria-labelledby="guidance-heading" className="grid gap-4 xl:grid-cols-[1.3fr_.7fr]">
        <article className="rounded-[26px] border border-cyan-200/15 bg-gradient-to-br from-cyan-200/[0.08] to-white/[0.025] p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100/65">Central intelligence</p>
              <h2 id="guidance-heading" className="mt-2 text-2xl font-black">eBay guidance vs Seller OS</h2>
            </div>
            <StatusChip status={backend.listingQualityReport.status} />
          </div>
          {qualityUnavailable ? <div className="mt-5 rounded-2xl border border-dashed border-white/15 bg-black/20 p-5"><FileText className="text-white/35" size={22} /><p className="mt-3 font-bold">No current Listing Quality Report available.</p><p className="mt-1 text-sm leading-6 text-white/55">La guía eBay permanece separada de Analytics y no se fabrican recomendaciones mientras no exista un reporte actual.</p></div> : <div className="mt-5 space-y-3">{guidanceRows.map((row) => <GuidanceRow key={row.listingKey} monitor={monitor} row={row} />)}{guidanceRows.length === 0 && <p className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/55">No hay guía eBay asociada de forma certificada a los listings actuales.</p>}</div>}
        </article>
        <article id="inventory-status" className="rounded-[26px] border border-orange-300/20 bg-orange-300/[0.055] p-5 md:p-6">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-100/65">Capability state</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-black">Inventory</h2><StatusChip status={backend.capabilities.inventory.status} /></div>
          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3"><dt className="text-white/60">OAuth capability</dt><dd className="font-bold text-emerald-100">{backend.capabilities.inventory.oauthCapability}</dd></div>
            <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3"><dt className="text-white/60">Locations capability</dt><dd className="font-bold text-emerald-100">{backend.capabilities.inventory.locationsCapability}</dd></div>
            <div><dt className="text-white/60">Inventory Items</dt><dd className="mt-1 font-bold text-orange-100">{backend.capabilities.inventory.inventoryItemsResource.replaceAll("_", " ")}</dd><p className="mt-2 text-xs leading-5 text-white/55">La degradación 25709 queda aislada y no convierte el Monitor comercial en un fallo total.</p></div>
          </dl>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[.86fr_1.14fr]">
        <article aria-labelledby="alerts-heading" className="rounded-[26px] border border-rose-300/15 bg-rose-300/[0.045] p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-rose-100/65">Critical alerts</p><h2 id="alerts-heading" className="mt-2 text-2xl font-black">Señales que requieren atención</h2></div><span className="text-3xl font-black">{numberFormatter.format(renderedCriticalAlerts.length)}</span></div>
          <div className="mt-5 space-y-3">
            {renderedCriticalAlerts.map((decision) => <div key={decision.listingKey} className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="flex items-center justify-between gap-3"><strong className="text-sm">{listingLabel(monitor, decision.listingKey)}</strong><PriorityChip priority={decision.priority} /></div><p className="mt-2 text-xs text-white/60">{decisionLabels[decision.classification]} · {decision.reasonCodes.map(humanReason).join(" · ")}</p></div>)}
            {renderedCriticalAlerts.length === 0 && <p className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/55">No hay alertas comerciales de prioridad crítica o alta en la evidencia disponible.</p>}
          </div>
        </article>

        <article id="priority-action-plan" aria-labelledby="action-plan-heading" className="rounded-[26px] border border-amber-300/15 bg-[#12131a] p-5 md:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-100/65">Priority action plan</p><h2 id="action-plan-heading" className="mt-2 text-2xl font-black">Recomendaciones, no acciones ejecutables</h2></div><span className="text-xs text-white/45">Decision Engine V1</span></div>
          <div className="mt-5 space-y-3">
            {actionPlan.map((decision) => <article key={decision.listingKey} className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black">{listingLabel(monitor, decision.listingKey)}</p><p className="mt-1 text-xs text-white/50">{decisionLabels[decision.classification]} · evidencia {decision.evidenceStatus}</p></div><PriorityChip priority={decision.priority} /></div><div className="mt-4 grid gap-3 text-xs text-white/60 md:grid-cols-2"><p><span className="font-bold text-white/80">Siguiente clase:</span> {actionLabels[decision.recommendedAction]}</p><p><span className="font-bold text-white/80">Estado:</span> {decision.experimentRunning ? "Experimento activo" : decision.variableFrozen ? "Variable congelada" : decision.actionBlockedByInsufficientEvidence ? "Bloqueado por evidencia" : "Recomendación informativa"}</p></div><p className="mt-3 text-xs leading-5 text-amber-50/80">{decision.reasonCodes.map(humanReason).join(" · ")}</p>{decision.nextReviewCondition && <p className="mt-3 text-[11px] text-white/45">Revisar: {decision.nextReviewCondition}{decision.nextReviewAt ? ` · ${formatTimestamp(decision.nextReviewAt)}` : ""}</p>}</article>)}
            {actionPlan.length === 0 && <p className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/55">No hay acciones comerciales recomendadas con la evidencia actual. Esto no sustituye la revisión humana.</p>}
          </div>
        </article>
      </section>

      <section id="upcoming-reviews" aria-labelledby="reviews-heading" className="grid gap-4 xl:grid-cols-[1fr_.78fr]">
        <article className="rounded-[26px] border border-white/10 bg-[#0d1320] p-5 md:p-6">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/45">Upcoming reviews</p>
          <h2 id="reviews-heading" className="mt-2 text-2xl font-black">Puntos de espera y revisión humana</h2>
          <div className="mt-5 space-y-3">
            {backend.operationalHealth.upcomingReviews.map((review) => <div key={`${review.listingKey}:${review.condition}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 p-3"><div><p className="font-bold">{listingLabel(monitor, review.listingKey)}</p><p className="mt-1 text-xs text-white/55">{review.condition}</p></div><span className="text-xs text-cyan-100">{formatTimestamp(review.reviewAt)}</span></div>)}
            {registry.humanReviewCount !== null && registry.humanReviewCount > 0 && <div className="flex gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.07] p-4"><ShieldCheck className="mt-0.5 shrink-0 text-cyan-100" size={19} /><p className="text-sm leading-6 text-white/70"><strong className="text-white">{formatValue(registry.humanReviewCount)} Human Review.</strong> Dos relaciones SKU-only y una relación lifecycle permanecen fuera de cualquier tramo automático.</p></div>}
            {backend.operationalHealth.upcomingReviews.length === 0 && <p className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/55">No hay próximo punto de revisión certificado.</p>}
          </div>
        </article>
        <article className="rounded-[26px] border border-white/10 bg-[#0d1320] p-5 md:p-6">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/45">Registry status</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-black">Partial certified</h2><StatusChip status={registry.status} /></div>
          <div className="mt-6 grid grid-cols-3 gap-3 text-center"><div className="rounded-2xl border border-white/10 bg-black/20 p-3"><p className="text-2xl font-black">{formatValue(registry.matchedCount)}</p><p className="mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/45">Matched</p></div><div className="rounded-2xl border border-white/10 bg-black/20 p-3"><p className="text-2xl font-black">{formatValue(registry.humanReviewCount)}</p><p className="mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/45">Review</p></div><div className="rounded-2xl border border-white/10 bg-black/20 p-3"><p className="text-2xl font-black">{formatValue(registry.coveragePercent)}{registry.coveragePercent === null ? "" : "%"}</p><p className="mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/45">Coverage</p></div></div>
          <p className="mt-5 text-sm leading-6 text-white/55">La historia ended no se interpreta como un gap live. Las excepciones humanas permanecen visibles sin bloquear el resto del Monitor.</p>
        </article>
      </section>

      <section id="performance" aria-labelledby="performance-heading" className="grid gap-4 xl:grid-cols-[1.12fr_.88fr]">
        <article className="rounded-[26px] border border-white/10 bg-[#0d1320] p-5 md:p-6">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/45">Visual analytics</p>
          <h2 id="performance-heading" className="mt-2 text-2xl font-black">Performance trend</h2>
          {hasPerformanceSeries ? <div className="mt-6 h-44 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/55">Serie canónica disponible.</div> : <div className="mt-6 rounded-2xl border border-dashed border-white/15 bg-black/20 p-5"><Activity size={22} className="text-white/35" /><p className="mt-3 font-bold">Sin serie temporal canónica</p><p className="mt-1 text-sm leading-6 text-white/55">No se generan puntos sintéticos. Los KPIs superiores conservan los valores Analytics disponibles para la ventana actual.</p></div>}
        </article>
        <article aria-labelledby="distribution-heading" className="rounded-[26px] border border-white/10 bg-[#0d1320] p-5 md:p-6">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/45">Diagnostic distribution</p>
          <h2 id="distribution-heading" className="mt-2 text-2xl font-black">Distribución de decisiones</h2>
          <div className="mt-6 space-y-4">{backend.operationalHealth.statusDistribution.map((row) => <div key={row.classification}><div className="flex justify-between gap-4 text-sm"><span>{decisionLabels[row.classification]}</span><strong>{numberFormatter.format(row.count)}</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300" style={{ width: distributionTotal > 0 ? `${(row.count / distributionTotal) * 100}%` : "0%" }} /></div></div>)}{backend.operationalHealth.statusDistribution.length === 0 && <p className="rounded-2xl border border-dashed border-white/15 p-4 text-sm text-white/55">Distribución no disponible sin decisiones representables.</p>}</div>
        </article>
      </section>

      <section id="category-benchmark" aria-labelledby="benchmark-heading" className="rounded-[26px] border border-white/10 bg-[#0d1320] p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/45">Category benchmark</p><h2 id="benchmark-heading" className="mt-2 text-2xl font-black">Benchmark de Listing Quality</h2></div><StatusChip status={backend.listingQualityReport.status} /></div>
        {backend.operationalHealth.categoryBenchmarks.length > 0 ? <div className="mt-5 grid gap-3 md:grid-cols-3">{backend.operationalHealth.categoryBenchmarks.map((benchmark) => <div key={benchmark.recommendationCategory} className="rounded-2xl border border-white/10 bg-black/20 p-4"><p className="text-sm font-bold">{benchmark.recommendationCategory}</p><p className="mt-3 text-2xl font-black">{numberFormatter.format(benchmark.benchmark)}</p><p className="mt-1 text-xs text-white/45">{benchmark.source}</p></div>)}</div> : <div className="mt-5 flex gap-3 rounded-2xl border border-dashed border-white/15 bg-black/20 p-5"><CircleGauge className="mt-0.5 shrink-0 text-white/35" size={20} /><p className="text-sm leading-6 text-white/60">No current Listing Quality Report loaded. No se inventan benchmarks Top-10% ni categorías de referencia.</p></div>}
      </section>

      <aside className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.025] px-5 py-4 text-sm text-white/60">
        <div className="flex items-center gap-3"><Wrench size={18} className="text-cyan-100" /><p><strong className="text-white">Modo de recomendación.</strong> La secuencia Seller OS se detiene antes de cualquier cambio controlado.</p></div>
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-white/40">0 marketplace writes · 0 Registry writes</p>
      </aside>
    </div>
  )
}
