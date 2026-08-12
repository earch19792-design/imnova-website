import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  Database,
  Eye,
  FileText,
  FlaskConical,
  HelpCircle,
  LayoutDashboard,
  LineChart,
  ListChecks,
  LockKeyhole,
  Package,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  UsersRound,
  WalletCards,
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
  const navigation = [
    ["Dashboard", "#commercial-dashboard", LayoutDashboard],
    ["eBay Integración", "#control-bar", ShieldCheck],
    ["Oportunidades", "#priority-action-plan", Sparkles],
    ["Productos", "#guidance-table", FileText],
    ["eBay Monitor", "#commercial-dashboard", LineChart],
  ] as const
  const monitorNavigation = [
    ["Resumen", "#commercial-dashboard"],
    ["Listings", "#guidance-table"],
    ["Kits y Componentes", "#advanced-diagnostics"],
    ["Stock Guard", "#inventory-status"],
    ["Tráfico y Conversión", "#performance"],
    ["Plan de Acción", "#priority-action-plan"],
    ["Experimentos", "#upcoming-reviews"],
    ["Aprendizaje", "#guidance-table"],
    ["Calidad de Datos", "#category-benchmark"],
    ["Timeline / Auditoría", "#advanced-diagnostics"],
  ] as const
  const actionTypeDistribution = [...new Map(actionPlan.map((decision) =>
    [decision.recommendedAction, actionPlan.filter((row) =>
      row.recommendedAction === decision.recommendedAction).length] as const)).entries()]
  const actionTypeTotal = actionTypeDistribution.reduce((total, [, count]) => total + count, 0)

  return (
    <div id="commercial-dashboard" className="min-h-screen bg-[#eef2f6] text-slate-950 xl:pl-[248px]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-white/10 bg-[#101b2c] px-4 py-5 text-slate-100 xl:flex">
        <div className="flex items-center gap-3 px-2"><span className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-300 text-[#101b2c]"><LineChart size={19} /></span><div><p className="text-sm font-black tracking-tight">IMNOVA</p><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-200">Seller OS</p></div></div>
        <nav aria-label="Navegación principal" className="mt-8 space-y-1">{navigation.map(([label, href, Icon]) => <a key={label} href={href} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${label === "eBay Monitor" ? "bg-cyan-300 text-[#102033] shadow-lg shadow-cyan-500/10" : "text-slate-300 hover:bg-white/[0.06] hover:text-white"}`}><Icon size={16} />{label}</a>)}</nav>
        <div className="mt-6 border-t border-white/10 pt-5"><p className="px-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">eBay Monitor</p><nav aria-label="Módulos del Monitor" className="mt-2 space-y-0.5">{monitorNavigation.map(([label, href]) => <a key={label} href={href} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 transition hover:bg-white/[0.06] hover:text-white"><ChevronRight size={13} className="text-cyan-300/75" />{label}</a>)}</nav></div>
        <nav aria-label="Operación" className="mt-6 space-y-1 border-t border-white/10 pt-5 text-sm font-semibold text-slate-300"><a href="#upcoming-reviews" className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.06]"><ShoppingBag size={16} />Órdenes</a><a href="#inventory-status" className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.06]"><Package size={16} />Inventario</a><a href="#category-benchmark" className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.06]"><WalletCards size={16} />Finanzas</a><a href="#advanced-diagnostics" className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.06]"><FileText size={16} />Reportes</a><a href="#advanced-diagnostics" className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.06]"><Settings size={16} />Configuración</a></nav>
        <div className="mt-auto flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] p-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-slate-700"><UsersRound size={15} /></span><div><p className="text-xs font-bold">Administrador</p><p className="text-[10px] text-slate-400">Acceso protegido</p></div></div>
      </aside>

      <header className="sticky top-0 z-20 flex min-h-[64px] items-center justify-between border-b border-slate-200 bg-[#f8fafc]/95 px-4 backdrop-blur md:px-7">
        <div><div className="flex items-center gap-2"><h1 className="text-base font-black tracking-tight md:text-lg">eBay Commercial Monitor</h1><span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-black tracking-[0.12em] text-emerald-700">READ-ONLY</span></div><p className="hidden text-xs text-slate-500 md:block">Cockpit operativo, diagnóstico y decisiones basadas en datos</p></div>
        <div className="flex items-center gap-3 text-slate-500"><Bell size={18} /><a href="#advanced-diagnostics" className="inline-flex items-center gap-1 text-xs font-bold hover:text-slate-950"><HelpCircle size={16} />Ayuda</a></div>
      </header>

      <main className="mx-auto max-w-[1680px] space-y-4 p-4 md:p-6">
        <section id="control-bar" aria-label="Control y estado" className="grid overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:grid-cols-2 xl:grid-cols-[1.3fr_.8fr_.9fr_.9fr_.85fr_.9fr_auto]">
          <div className="border-b border-slate-100 px-4 py-3 xl:border-b-0 xl:border-r"><p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Cuenta eBay</p><p className="mt-1 truncate text-sm font-bold">{monitor.marketplace.accountAlias ?? "Cuenta no configurada"}</p></div>
          <div className="border-b border-slate-100 px-4 py-3 xl:border-b-0 xl:border-r"><p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Marketplace</p><p className="mt-1 text-sm font-bold">{monitor.marketplace.marketplaceId}</p></div>
          <div className="border-b border-slate-100 px-4 py-3 xl:border-b-0 xl:border-r"><p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Última sincronización</p><time dateTime={monitor.generatedAt} className="mt-1 block truncate text-xs font-bold">{formatTimestamp(monitor.generatedAt)}</time></div>
          <div className="border-b border-slate-100 px-4 py-3 xl:border-b-0 xl:border-r"><p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Cobertura de datos</p><p className="mt-1 text-sm font-black">{formatValue(registry.coveragePercent)}{registry.coveragePercent === null ? "" : "%"}</p></div>
          <div className="border-b border-slate-100 px-4 py-3 xl:border-b-0 xl:border-r"><p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">eBay Analytics</p><div className="mt-1"><StatusChip status={backend.capabilities.analytics} /></div></div>
          <div className="border-b border-slate-100 px-4 py-3 xl:border-b-0 xl:border-r"><p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Luna Portex</p><div className="mt-1"><StatusChip status={backend.capabilities.inventory.status} /></div></div>
          <a href="#commercial-dashboard" className="m-2 inline-flex items-center justify-center gap-2 rounded-lg bg-[#102033] px-3 py-2 text-xs font-black text-white transition hover:bg-[#1c324c]"><CalendarRange size={15} />Actualizar datos</a>
        </section>

        <section aria-label="Estado de eBay Guidance" className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2.5 text-xs text-slate-600"><strong className="text-[10px] tracking-[0.14em] text-cyan-800">EBAY GUIDANCE</strong><StatusChip status={backend.listingQualityReport.status} /><span>Último reporte: {qualityUnavailable ? "No current report" : "Disponible"}</span><span>Ventana: {qualityUnavailable ? "No disponible" : "según reporte"}</span><span>Fuente: eBay Listing Quality Report</span><a href="#guidance-table" className="ml-auto font-bold text-cyan-800">Ver detalle</a></section>

        <section aria-label="Indicadores principales" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard label="Listings Activos" value={backend.kpis.activeListings.value} status={backend.kpis.activeListings.status} detail="Trading live" icon={<Package size={18} />} />
          <KpiCard label="Impresiones" value={backend.kpis.impressions.value} status={backend.kpis.impressions.status} detail="eBay Analytics" icon={<BarChart3 size={18} />} />
          <KpiCard label="eBay Views" value={backend.kpis.ebayViews.value} status={backend.kpis.ebayViews.status} detail="eBay Analytics" icon={<Eye size={18} />} />
          <KpiCard label="CTR Promedio" value={backend.kpis.averageCtr.value} status={backend.kpis.averageCtr.status} detail="Puntos porcentuales" icon={<TrendingUp size={18} />} suffix="%" />
          <KpiCard label="Órdenes" value={backend.kpis.orders.value} status={backend.kpis.orders.status} detail={backend.kpis.orders.value === null ? "Auth pendiente" : "Fulfillment readonly"} icon={<ShoppingBag size={18} />} />
        </section>

        <section aria-labelledby="operational-health-heading" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Decision & operational health</p><h2 id="operational-health-heading" className="mt-1 text-base font-black">Estado operativo</h2></div><p className="text-xs text-slate-500">Decision Engine V1</p></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><HealthCard label="Necesitan intervención" count={backend.operationalHealth.needIntervention.count} status={backend.operationalHealth.needIntervention.status} icon={<AlertTriangle size={17} />} accent="bg-rose-100 text-rose-700" /><HealthCard label="Experimentos RUNNING" count={backend.operationalHealth.runningExperiments.count} status={backend.operationalHealth.runningExperiments.status} icon={<FlaskConical size={17} />} accent="bg-violet-100 text-violet-700" /><HealthCard label="Riesgo de stock" count={backend.operationalHealth.stockRisk.count} status={backend.operationalHealth.stockRisk.status} icon={<Package size={17} />} accent="bg-orange-100 text-orange-700" /><HealthCard label="Data Quality" count={backend.operationalHealth.dataQuality.count} status={backend.operationalHealth.dataQuality.status} icon={<Database size={17} />} accent="bg-amber-100 text-amber-700" /><HealthCard label="eBay Recomendaciones" count={backend.operationalHealth.ebayRecommendations.count} status={backend.operationalHealth.ebayRecommendations.status} icon={<Sparkles size={17} />} accent="bg-cyan-100 text-cyan-700" /><HealthCard label="Waiting / Healthy" count={backend.operationalHealth.waitingHealthy.count} status={backend.operationalHealth.waitingHealthy.status} icon={<CheckCircle2 size={17} />} accent="bg-emerald-100 text-emerald-700" /></div></section>

        <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <article id="guidance-table" className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><p className="text-[10px] font-black uppercase tracking-[0.15em] text-cyan-700">Central intelligence</p><h2 className="mt-1 text-lg font-black">eBay guidance vs Seller OS Decisions</h2></div><StatusChip status={backend.listingQualityReport.status} /></div><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-xs"><thead className="bg-slate-50 text-[9px] font-black uppercase tracking-[0.12em] text-slate-400"><tr><th className="px-4 py-3">Listing / Item ID</th><th className="px-4 py-3">Diagnóstico</th><th className="px-4 py-3">eBay recommendation</th><th className="px-4 py-3">Benchmark / razón</th><th className="px-4 py-3">Seller OS</th><th className="px-4 py-3">Estado</th></tr></thead><tbody>{qualityUnavailable ? <tr><td colSpan={6} className="h-[252px] px-5 text-center"><FileText className="mx-auto text-slate-300" size={26} /><p className="mt-3 font-bold">No current Listing Quality Report available.</p><p className="mt-1 text-slate-500">Se preserva la comparación; no se fabrican recomendaciones, benchmarks ni fechas.</p></td></tr> : guidanceRows.map((row) => { const decision = decisionsByKey.get(row.listingKey); return <tr key={row.listingKey} className="border-t border-slate-100 align-top"><td className="px-4 py-3 font-bold">{listingLabel(monitor, row.listingKey)}</td><td className="px-4 py-3 text-slate-600">{decision ? decisionLabels[decision.classification] : row.sellerOsDiagnosisStatus}</td><td className="px-4 py-3 text-slate-600">{row.ebayGuidanceStatus.replaceAll("_", " ")}</td><td className="max-w-[220px] px-4 py-3 text-slate-500">{row.reasonCodes.map(humanReason).join(" · ")}</td><td className="px-4 py-3 font-semibold text-slate-700">{decision ? actionLabels[decision.recommendedAction] : "UNPROVEN"}</td><td className="px-4 py-3"><span className="rounded-full bg-cyan-50 px-2 py-1 text-[9px] font-black text-cyan-800">{row.conclusion.replaceAll("_", " ")}</span></td></tr> })}</tbody></table></div></article>

          <aside className="space-y-3"><article className="rounded-xl border border-rose-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.14em] text-rose-600">Alertas críticas</p><h2 className="mt-1 text-sm font-black">Prioridad comercial</h2></div><span className="text-2xl font-black text-rose-700">{numberFormatter.format(renderedCriticalAlerts.length)}</span></div><div className="mt-3 space-y-2">{renderedCriticalAlerts.map((decision) => <div key={decision.listingKey} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5"><div className="flex items-center justify-between gap-2"><strong className="truncate text-xs">{listingLabel(monitor, decision.listingKey)}</strong><PriorityChip priority={decision.priority} /></div><p className="mt-1 line-clamp-2 text-[11px] text-slate-500">{decision.reasonCodes.map(humanReason).join(" · ")}</p></div>)}{renderedCriticalAlerts.length === 0 && <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Sin alertas críticas o altas con la evidencia actual.</p>}</div></article>
          <article id="priority-action-plan" aria-label="Priority action plan" className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-700">Plan de acción prioritario</p><div className="mt-3 space-y-2">{actionPlan.slice(0, 5).map((decision) => <div key={decision.listingKey} className="flex gap-2 rounded-lg border border-slate-100 p-2.5"><ListChecks size={15} className="mt-0.5 shrink-0 text-amber-600" /><div className="min-w-0"><p className="truncate text-xs font-bold">{listingLabel(monitor, decision.listingKey)}</p><p className="mt-1 text-[11px] text-slate-500">{actionLabels[decision.recommendedAction]}</p></div></div>)}{actionPlan.length === 0 && <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Sin recomendaciones accionables.</p>}</div></article>
          <article id="upcoming-reviews" aria-label="Upcoming reviews" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Próximas revisiones</p><div className="mt-3 space-y-2">{backend.operationalHealth.upcomingReviews.slice(0, 3).map((review) => <div key={`${review.listingKey}:${review.condition}`} className="rounded-lg bg-slate-50 p-2.5"><p className="text-xs font-bold">{listingLabel(monitor, review.listingKey)}</p><p className="mt-1 text-[11px] text-slate-500">{review.condition}</p></div>)}{registry.humanReviewCount !== null && registry.humanReviewCount > 0 && <div className="rounded-lg border border-cyan-100 bg-cyan-50 p-2.5 text-xs text-cyan-900"><strong>{formatValue(registry.humanReviewCount)} Human Review.</strong> Casos aislados, sin mutación automática.</div>}</div></article>
          <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 shadow-sm"><div className="flex items-center gap-2"><LockKeyhole size={17} className="text-emerald-700" /><p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">System 100% read-only</p></div><ul className="mt-3 space-y-1.5 text-xs"><li>Sin escrituras a eBay</li><li>Sin cambios en listings</li><li>Sin mensajes a compradores</li><li>Sin dispatch WhatsApp</li></ul><p className="mt-3 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-800">0 marketplace writes · 0 Registry writes</p></article></aside>
        </section>

        <section id="performance" className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.3fr_.7fr_.7fr_1fr]">
          <article className="min-h-[230px] rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Rendimiento general</p><h2 className="mt-1 text-sm font-black">Performance trend</h2>{hasPerformanceSeries ? <div className="mt-6 grid h-32 place-items-center rounded-lg bg-slate-50 text-xs text-slate-500">Serie canónica disponible.</div> : <div className="mt-6 grid h-32 place-items-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-5 text-center"><Activity className="text-slate-300" size={20} /><p className="mt-2 text-xs font-bold">Sin serie temporal canónica</p><p className="text-[11px] text-slate-500">No se generan puntos sintéticos.</p></div>}</article>
          <article className="min-h-[230px] rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Distribución por estado</p><div className="mt-5 flex items-center gap-4"><div className="grid h-24 w-24 shrink-0 place-items-center rounded-full border-[14px] border-cyan-400"><strong className="text-lg">{numberFormatter.format(distributionTotal)}</strong></div><div className="min-w-0 space-y-2">{backend.operationalHealth.statusDistribution.map((row) => <div key={row.classification} className="flex justify-between gap-2 text-[11px]"><span className="truncate text-slate-500">{decisionLabels[row.classification]}</span><strong>{numberFormatter.format(row.count)}</strong></div>)}</div></div></article>
          <article className="min-h-[230px] rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Distribución por tipo</p><div className="mt-5 flex items-center gap-4"><div className="grid h-24 w-24 shrink-0 place-items-center rounded-full border-[14px] border-violet-400"><strong className="text-lg">{numberFormatter.format(actionTypeTotal)}</strong></div><div className="min-w-0 space-y-2">{actionTypeDistribution.slice(0, 4).map(([action, count]) => <div key={action} className="flex justify-between gap-2 text-[11px]"><span className="truncate text-slate-500">{actionLabels[action]}</span><strong>{numberFormatter.format(count)}</strong></div>)}{actionTypeDistribution.length === 0 && <p className="text-xs text-slate-500">Sin tipos representables.</p>}</div></div></article>
          <article id="category-benchmark" className="min-h-[230px] rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Benchmark categoría</p><h2 className="mt-1 text-sm font-black">Listing Quality</h2></div><CircleGauge size={18} className="text-slate-400" /></div>{backend.operationalHealth.categoryBenchmarks.length > 0 ? <div className="mt-4 space-y-2">{backend.operationalHealth.categoryBenchmarks.map((benchmark) => <div key={benchmark.recommendationCategory} className="flex items-center justify-between border-b border-slate-100 pb-2 text-xs"><span>{benchmark.recommendationCategory}</span><strong>{numberFormatter.format(benchmark.benchmark)}</strong></div>)}</div> : <div className="mt-5 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">No current Listing Quality Report loaded. No se inventan benchmarks Top-10%.</div>}</article>
        </section>

        <section id="inventory-status" className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 text-xs md:grid-cols-4"><div><p className="font-black">Registry</p><p className="mt-1 text-slate-500">{formatValue(registry.matchedCount)} matched · {formatValue(registry.humanReviewCount)} review · {formatValue(registry.coveragePercent)}%</p></div><div><p className="font-black">Inventory</p><p className="mt-1 text-slate-500">{backend.capabilities.inventory.inventoryItemsResource.replaceAll("_", " ")}</p></div><div><p className="font-black">Marketplace</p><p className="mt-1 text-slate-500">{monitor.liveCertification.account.bindingMatched ? "Binding certificado" : "Binding no probado"}</p></div><div className="md:text-right"><p className="font-black">Estado operativo</p><p className="mt-1 text-slate-500">Versión read-only · sin acciones de marketplace</p></div></section>
      </main>
    </div>
  )
}
