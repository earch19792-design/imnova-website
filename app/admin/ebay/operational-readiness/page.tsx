"use client"

import { Activity, AlertTriangle, ArrowLeft, ChevronRight, Clock3, Laptop,
  MessageCircle, PackageSearch, RotateCcw, ShieldCheck, Warehouse,
  Workflow } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"
import { presentSellerOsCapability, presentSellerOsStatus } from
  "@/lib/seller-os/presentation"

type TemplateDefinition = { internalTemplateKey: string; intendedMetaTemplateName: string;
  humanTitle: string; categorySuggestion: string; language: string; variableSchema: string[];
  examplePayload: { classification: "NON_OPERATIONAL_TEMPLATE_EXAMPLE";
    values: Record<string, string> }; piiClassification: string; approvalStatus: string;
  dispatchAllowed: false; humanReviewStates?: Array<{ state: string; classification: string;
    values: Record<string, string> }> }
type ReadinessPayload = { success?: boolean; capabilities?: Record<string, string | boolean>;
  readiness?: Record<string, string | boolean>; templates?: TemplateDefinition[];
  result?: Record<string, unknown>; error?: string; diagnosis?: Record<string, unknown>;
  operationalIntegrity?: Record<string, unknown> | null;
  runtimeScheduler?: Record<string, unknown> | null;
  runtimeAssurance?: Record<string, unknown> | null;
  selfhostRuntime?: Record<string, unknown> | null }
type HumanPreview = { title?: string; subject?: string; problem?: string; evidence?: string;
  recommendedAction?: string; observedAt?: string; deepLinkLabel?: string; deepLink?: string }

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function healthLabel(value: unknown) {
  const labels: Record<string, string> = {
    HEALTHY: "Operando", DEGRADED_EXTERNAL: "Fuente externa limitada",
    DEGRADED_INTERNAL: "Inconsistencia interna", WAITING_DEPENDENCY:
      "Esperando dependencia", DISCONNECTED: "Desconectado",
    STALLED: "Detenido", MISSED_SCHEDULE: "Ejecución esperada ausente",
    OUTPUT_MISSING: "Resultado durable ausente", UNKNOWN: "Por comprobar",
  }
  return labels[String(value)] ?? "Por comprobar"
}

function shownDate(value: unknown) {
  const parsed = Date.parse(String(value ?? ""))
  return Number.isFinite(parsed) ? new Intl.DateTimeFormat("es-NI", {
    timeZone: "America/Managua", dateStyle: "short", timeStyle: "short",
  }).format(new Date(parsed)) : "—"
}

function shownDuration(value: unknown) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0) return "—"
  if (seconds < 120) return `${Math.round(seconds)} segundos`
  if (seconds < 7_200) return `${Math.round(seconds / 60)} minutos`
  return `${Math.round(seconds / 3_600)} horas`
}

function jobLabel(value: unknown) {
  const labels: Record<string, string> = {
    "amazon-connie-readonly-sync": "Amazon y Connie",
    "quick-pick-runtime-recovery": "Recuperación de Quick Pick",
    "commercial-monitor": "Monitor comercial de eBay",
    "commercial-alert-dispatcher": "Alertas comerciales",
    "owner-sale-alerts": "Alertas de venta al propietario",
  }
  return labels[String(value)] ?? String(value ?? "Trabajo")
}

export default function OperationalReadinessPage() {
  const [payload, setPayload] = useState<ReadinessPayload | null>(null)
  const [whatsappResults, setWhatsappResults] = useState<Record<string,
    Record<string, unknown>>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function request(body?: unknown) {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !data.session) throw new Error("AUTH_REQUIRED")
    const response = await fetch("/api/admin/ebay/operational-readiness", { method: body ? "POST" : "GET",
      cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`,
        ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined })
    const result = await response.json() as ReadinessPayload
    if (!response.ok || !result.success) {
      throw new Error(result.error ?? "READINESS_READ_FAILED")
    }
    return result
  }

  useEffect(() => { request().then(setPayload).catch((caught) =>
    setError(caught instanceof Error ? caught.message : "READINESS_READ_FAILED")) }, [])

  async function previewWhatsApp(riskClass: "LOW_STOCK_CONFIRMED" | "STALE_EVIDENCE") {
    setLoading(true); setError("")
    try {
      const result = await request({ action: "PREVIEW_WHATSAPP", input: {
        accountKey: "PROTECTED_ACCOUNT", family: "LOW_STOCK_OR_STALE_EVIDENCE",
        evidenceFingerprint: "dry_run_no_business_mutation", stateVersion: "preview_v2",
        observedAt: new Date().toISOString(), rootCause: riskClass,
        stock: riskClass === "LOW_STOCK_CONFIRMED"
          ? { riskClass, exactIdentity: true, supplierQuantity: 2,
              publishedQuantity: 1, safeCapacity: 2 }
          : { riskClass, exactIdentity: true },
        deepLinkPath: "/admin/ebay/stock-guard", cooldownHours: 24,
        previewClassification: "TEMPLATE_EXAMPLE_PREVIEW" } })
      if (result.result) setWhatsappResults((current) => ({ ...current,
        [riskClass]: result.result as Record<string, unknown> }))
    } catch (caught) { setError(caught instanceof Error ? caught.message : "WHATSAPP_PREVIEW_FAILED") }
    finally { setLoading(false) }
  }

  const latestIntegrity = payload?.operationalIntegrity?.latestRun as
    Record<string, unknown> | null | undefined
  const openIntegrityCount = Number(
    payload?.operationalIntegrity?.openViolationCount ?? NaN)
  const schedulerLanes = Array.isArray(payload?.runtimeScheduler?.lanes)
    ? payload.runtimeScheduler.lanes as Record<string, unknown>[] : []
  const assuranceRun = object(payload?.runtimeAssurance?.latestRun)
  const assuranceReceipt = object(assuranceRun.audit_receipt)
  const capabilityMatrix = Array.isArray(assuranceReceipt.capabilityMatrix)
    ? assuranceReceipt.capabilityMatrix.map(object) : []
  const unhealthyCapabilities = capabilityMatrix.filter((entry) =>
    entry.finalHealthState !== "HEALTHY")
  const assuranceCounts = object(assuranceReceipt.counts)
  const selfhostRuntime = object(payload?.selfhostRuntime)
  const selfhostSession = object(selfhostRuntime.session)
  const selfhostCounts = object(selfhostRuntime.counts)
  const selfhostJobs = Array.isArray(selfhostRuntime.jobs)
    ? selfhostRuntime.jobs.map(object) : []
  const selfhostOnline = selfhostRuntime.runtimeStatus === "ONLINE"
  const lowStockPreview = whatsappResults.LOW_STOCK_CONFIRMED?.humanPreview as HumanPreview | undefined
  const stalePreview = whatsappResults.STALE_EVIDENCE?.humanPreview as HumanPreview | undefined

  return <main className="min-h-screen bg-[#eef2f6] p-4 text-slate-950 md:p-7">
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5">
        <div><Link href="/admin/ebay/monitor" className="inline-flex items-center gap-2 text-sm font-bold text-cyan-700"><ArrowLeft size={14} />Monitor comercial</Link><h1 className="mt-3 text-[28px] font-black md:text-[32px]">Estado del sistema</h1><p className="mt-1 text-base text-slate-500">Evidencia de calidad, Luna Portex, Stock Guard, economía y notificaciones. Product Case permanece en pausa.</p></div>
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700"><ShieldCheck size={15} />Solo lectura</span>
      </header>
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><strong>La validación se detuvo de forma segura.</strong> {error}</div>}
      <section id="account" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(payload?.capabilities ?? {}).map(([key, value]) => <article key={key} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-[13px] font-black text-slate-500">{presentSellerOsCapability(key)}</p><p className="mt-2 text-base font-bold text-slate-800">{presentSellerOsStatus(String(value))}</p></article>)}
      </section>
      <section id="extensions" className="rounded-2xl border border-slate-200 bg-white p-5">
        <div><p className="text-[13px] font-black uppercase tracking-wider text-violet-700">Extensiones</p><h2 className="mt-1 text-lg font-black">Puentes de navegador</h2><p className="mt-1 text-sm text-slate-500">La conexión sólo acredita el canal. La capacidad operativa se comprueba contra cola, binding y receipts.</p></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><Link href="/admin/ebay/luna-shipping-capture" className="rounded-xl border border-slate-200 p-4 hover:border-cyan-400"><strong>Luna Shipping Capture</strong><p className="mt-1 text-sm text-slate-500">Binding, cola, ejecución y trazas durables.</p></Link><Link href="/admin/ebay/mobile-review/product-research-capture" className="rounded-xl border border-slate-200 p-4 hover:border-cyan-400"><strong>Product Research</strong><p className="mt-1 text-sm text-slate-500">Plan de consultas y receipts de captura.</p></Link></div>
      </section>
      <section id="local-runtime" className="rounded-2xl border border-slate-200 bg-white p-5"
        data-selfhost-runtime-read-only>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-[13px] font-black uppercase tracking-wider text-indigo-700">Centro de salud local</p><h2 className="mt-1 text-lg font-black">Docker, reanudación y trabajos durables</h2><p className="mt-1 text-sm text-slate-500">Al volver de hibernación, Seller OS recupera una sola ejecución pendiente por tarea y conserva un recibo verificable.</p></div>
          <span className={`rounded-full px-3 py-1 text-[13px] font-black ${selfhostOnline ? "bg-emerald-50 text-emerald-700" : selfhostRuntime.runtimeStatus === "OFFLINE_OR_HIBERNATING" ? "bg-slate-100 text-slate-700" : "bg-amber-50 text-amber-700"}`}>
            {selfhostOnline ? "Docker activo" : selfhostRuntime.runtimeStatus === "OFFLINE_OR_HIBERNATING" ? "En hibernación o apagado" : selfhostRuntime.runtimeStatus === "NOT_STARTED" ? "Pendiente de primer inicio" : "Por comprobar"}
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-xl bg-slate-50 p-4"><Laptop size={18} className="text-indigo-700" /><p className="mt-2 text-[13px] font-black text-slate-500">Coordinador local</p><p className="mt-1 font-black">{selfhostOnline ? "Operando" : "Sin señal reciente"}</p><p className="mt-1 text-xs text-slate-500">Última señal: {shownDate(selfhostSession.lastHeartbeatAt)}</p></article>
          <article className="rounded-xl bg-slate-50 p-4"><RotateCcw size={18} className="text-cyan-700" /><p className="mt-2 text-[13px] font-black text-slate-500">Última reanudación</p><p className="mt-1 font-black">{selfhostSession.resumedFromGap === true ? "Recuperada" : "Arranque normal"}</p><p className="mt-1 text-xs text-slate-500">Pausa detectada: {shownDuration(selfhostSession.resumeGapSeconds)}</p></article>
          <article className="rounded-xl bg-slate-50 p-4"><Activity size={18} className="text-emerald-700" /><p className="mt-2 text-[13px] font-black text-slate-500">Trabajo en curso</p><p className="mt-1 font-black">{String(selfhostCounts.running ?? 0)} activos</p><p className="mt-1 text-xs text-slate-500">{String(selfhostCounts.stale ?? 0)} reclamos vencidos</p></article>
          <article className="rounded-xl bg-slate-50 p-4"><Clock3 size={18} className="text-amber-700" /><p className="mt-2 text-[13px] font-black text-slate-500">Recuperación acotada</p><p className="mt-1 font-black">{String(selfhostSession.catchUpCandidateCount ?? 0)} candidatos</p><p className="mt-1 text-xs text-slate-500">{String(selfhostCounts.failedLast24Hours ?? 0)} fallos en 24 horas</p></article>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {selfhostJobs.map((job) => <article key={String(job.name)} className="rounded-xl border border-slate-200 p-3 text-sm">
            <div className="flex items-start justify-between gap-3"><strong>{jobLabel(job.name)}</strong><span className={`text-[12px] font-black ${job.status === "SUCCEEDED" ? "text-emerald-700" : job.status === "RUNNING" ? "text-cyan-700" : "text-amber-700"}`}>{job.status === "SUCCEEDED" ? "Completado" : job.status === "RUNNING" ? "En curso" : job.status === "STALE" ? "Listo para retomar" : "Requiere reintento"}</span></div>
            <p className="mt-1 text-xs text-slate-500">Último inicio: {shownDate(job.startedAt)} · intento {String(job.attemptCount ?? 1)} · {String(job.triggerKind ?? "—").replaceAll("_", " ").toLowerCase()}</p>
          </article>)}
        </div>
        {selfhostJobs.length === 0 && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">La infraestructura está preparada; aparecerán recibos después del primer arranque con la nueva versión.</p>}
      </section>
      <section id="runtime" className="rounded-2xl border border-slate-200 bg-white p-5"
        data-operational-integrity-read-only>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-[13px] font-black uppercase tracking-wider text-cyan-700">
            Runtime Operational Integrity Auditor
          </p><h2 className="mt-1 text-lg font-black">Coherencia operacional durable</h2>
          <p className="mt-1 text-sm text-slate-500">Autoridad → read model → presentación → acción → executor → receipt → readback.</p></div>
          <span className={`rounded-full px-3 py-1 text-[13px] font-black ${latestIntegrity?.status === "PASS" ? "bg-emerald-50 text-emerald-700" : latestIntegrity?.status === "VIOLATION" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>
            {String(latestIntegrity?.status ?? "DESCONOCIDO")}
          </span>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-500">Violaciones abiertas</dt><dd className="mt-1 text-xl font-black">{Number.isSafeInteger(openIntegrityCount) ? openIntegrityCount : "—"}</dd></div>
          <div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-500">Última observación</dt><dd className="mt-1 font-bold">{typeof latestIntegrity?.observed_at === "string" ? new Date(latestIntegrity.observed_at).toLocaleString("es-NI") : "—"}</dd></div>
          <div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-500">GET con continuaciones</dt><dd className="mt-1 text-xl font-black">{payload?.runtimeScheduler?.getBusinessMutations === 0 ? "0" : "—"}</dd></div>
        </dl>
        <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 className="font-black">Salud de capacidades críticas</h3>
              <p className="mt-1 text-sm text-slate-500">Conexión, ejecución, resultado durable y consumo se verifican por separado.</p></div>
            <span className="rounded-full bg-white px-3 py-1 text-[13px] font-black text-slate-700">
              {capabilityMatrix.length > 0
                ? `${String(assuranceCounts.healthy ?? 0)} operando · ${unhealthyCapabilities.length} requieren atención`
                : "Todavía sin receipt de assurance"}
            </span>
          </div>
          {unhealthyCapabilities.length > 0 && <div className="mt-3 grid gap-2 md:grid-cols-2">
            {unhealthyCapabilities.slice(0, 8).map((entry) => <article key={String(entry.capabilityId)} className="rounded-lg border border-amber-200 bg-white p-3 text-sm">
              <div className="flex items-start justify-between gap-3"><strong>{String(entry.capabilityId ?? "Capacidad").replaceAll("_", " ")}</strong><span className="text-[12px] font-black text-amber-700">{healthLabel(entry.finalHealthState)}</span></div>
              <p className="mt-1 text-slate-600">{String(entry.humanSummary ?? "No hay evidencia suficiente para declarar salud.")}</p>
              <p className="mt-2 text-[12px] text-slate-500">Último resultado: {shownDate(entry.lastExpectedOutputAt)} · Próximo intento: {shownDate(entry.nextRetryAt ?? entry.nextExpectedRunAt)}</p>
              <p className="mt-1 text-[12px] text-slate-500">Impacto: {String(entry.safeFallback ?? "Se conserva el último estado comprobado.").replaceAll("_", " ").toLowerCase()}</p>
            </article>)}
          </div>}
          {capabilityMatrix.length > 0 && unhealthyCapabilities.length === 0 && <p className="mt-3 text-sm font-semibold text-emerald-700">Todas las capacidades críticas produjeron la evidencia esperada dentro de su ventana.</p>}
          <details className="mt-3 rounded-lg border border-slate-200 bg-white p-3"><summary className="cursor-pointer text-sm font-black">Ver matriz técnica completa</summary><div className="mt-3 overflow-x-auto"><table className="min-w-full text-left text-xs"><thead><tr className="text-slate-500"><th className="p-2">Capacidad</th><th className="p-2">Conexión</th><th className="p-2">Job</th><th className="p-2">Output</th><th className="p-2">Downstream</th><th className="p-2">Estado</th></tr></thead><tbody>{capabilityMatrix.map((entry) => <tr key={String(entry.capabilityId)} className="border-t border-slate-100"><td className="p-2 font-bold">{String(entry.capabilityId)}</td><td className="p-2">{String(entry.connectionHealth)}</td><td className="p-2">{String(entry.jobHealth)}</td><td className="p-2">{String(entry.outputHealth)}</td><td className="p-2">{String(entry.downstreamHealth)}</td><td className="p-2">{String(entry.finalHealthState)}</td></tr>)}</tbody></table></div></details>
        </section>
        <details id="diagnostics" className="mt-4 rounded-xl border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-black">Ver schedulers POST</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">{schedulerLanes.map((lane) => <div key={String(lane.lane)} className="rounded-lg bg-slate-50 p-3 text-[13px]"><strong>{String(lane.lane)}</strong><p className="mt-1 text-slate-500">{String(lane.httpMethod ?? "DESCONOCIDO")} · {lane.enabled === true ? "ACTIVO" : "BLOQUEADO"} · {String(lane.schedule ?? "—")}</p></div>)}</div>
          {schedulerLanes.length === 0 && <p className="mt-2 text-sm text-amber-700">Autoridad del scheduler no disponible; no se presenta como saludable.</p>}
        </details>
      </section>
      <div className="grid gap-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-3"><MessageCircle className="text-violet-700" /><div><h2 className="text-lg font-black">Vista previa humana de WhatsApp</h2><p className="text-sm text-slate-500">Simulación para diseñar plantillas. La aprobación de Meta y los envíos permanecen desactivados.</p></div></div>
          <div className="mt-4 flex flex-wrap gap-2"><button disabled={loading} onClick={() => void previewWhatsApp("LOW_STOCK_CONFIRMED")} className="min-h-11 rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Previsualizar stock bajo confirmado</button><button disabled={loading} onClick={() => void previewWhatsApp("STALE_EVIDENCE")} className="min-h-11 rounded-lg border border-violet-300 px-4 py-2 text-sm font-bold text-violet-800 disabled:opacity-40">Previsualizar evidencia vencida</button></div>
          {[lowStockPreview, stalePreview].filter(Boolean).map((humanPreview) => <article key={humanPreview?.title} className="mt-4 overflow-hidden rounded-2xl border border-emerald-200 bg-[#e9f7ef]"><div className="bg-[#075e54] px-4 py-2 text-sm font-black text-white">Ejemplo de plantilla · sin envío</div><div className="m-3 rounded-xl bg-white p-4 shadow-sm"><p className="text-sm font-black text-rose-700">{humanPreview?.title}</p><h3 className="mt-1 font-black">{humanPreview?.subject}</h3><p className="mt-3 text-sm">{humanPreview?.problem}</p><p className="mt-2 text-[13px] text-slate-500">{humanPreview?.evidence}</p><p className="mt-3 text-sm font-semibold">{humanPreview?.recommendedAction}</p><span className="mt-4 inline-flex rounded-lg border border-emerald-700 px-3 py-2 text-sm font-black text-emerald-800">{humanPreview?.deepLinkLabel}</span></div></article>)}
          {Object.keys(whatsappResults).length > 0 && <details className="mt-3 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-bold text-slate-600">Ver JSON técnico de la simulación</summary><pre className="mt-3 max-h-52 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-200">{JSON.stringify(whatsappResults, null, 2)}</pre></details>}
        </section>
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-black">Revisión de plantillas de Meta · 8 familias</h2><p className="mt-1 text-[13px] text-slate-500">Todos los ejemplos están sanitizados, no son operativos y no se han enviado.</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-[13px] font-black text-amber-700">Envío desactivado</span></div><div className="mt-4 grid gap-3 lg:grid-cols-2">{payload?.templates?.map((template, index) => <details key={template.internalTemplateKey} className="rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer list-none"><div className="flex items-start justify-between gap-3"><div><p className="text-[13px] font-black text-slate-400">{index + 1} · {template.categorySuggestion} · {template.language}</p><h3 className="mt-1 text-base font-black">{template.humanTitle}</h3><p className="mt-1 text-[13px] text-slate-500">{template.intendedMetaTemplateName}</p></div><ChevronRight size={16} className="text-slate-400" /></div></summary><div className="mt-3 border-t border-slate-100 pt-3 text-[13px]"><p><strong>Variables:</strong> {template.variableSchema.join(" · ")}</p><p className="mt-2 rounded-lg bg-slate-50 p-3"><strong>{template.examplePayload.classification}</strong><br />{Object.entries(template.examplePayload.values).map(([key, value]) => `${key}: ${value}`).join(" · ")}</p>{template.humanReviewStates?.length ? <div className="mt-2 grid gap-2">{template.humanReviewStates.map((example) => <p key={example.state} className="rounded-lg border border-violet-100 p-3"><strong>{example.state}</strong><br />{Object.entries(example.values).map(([key, value]) => `${key}: ${value}`).join(" · ")}</p>)}</div> : null}<details className="mt-2 text-slate-500"><summary className="cursor-pointer font-bold text-cyan-700">Ver estado técnico</summary><p className="mt-1 font-mono">{template.piiClassification} · {template.approvalStatus} · dispatchAllowed=false</p></details></div></details>)}</div></section>
      <section className="grid gap-3 md:grid-cols-3"><Link href="/admin/ebay/luna-capture" className="rounded-xl border border-orange-200 bg-white p-4 transition hover:border-orange-400"><PackageSearch className="text-orange-600" size={18} /><h2 className="mt-2 text-base font-black">Abrir captura de Luna</h2><p className="mt-1 text-sm text-slate-500">El espacio de activación está listo. Producto y variante exactos requieren aprobación antes de persistir.</p></Link><Link href="/admin/ebay/luna-protected-session" className="rounded-xl border border-cyan-200 bg-white p-4 transition hover:border-cyan-400"><ShieldCheck className="text-cyan-700" size={18} /><h2 className="mt-2 text-base font-black">Sesión Luna protegida</h2><p className="mt-1 text-sm text-slate-500">Estado sanitizado del handoff server-owned. Nunca recibe cookies ni credenciales del navegador.</p></Link><Link href="/admin/ebay/stock-guard" className="rounded-xl border border-emerald-200 bg-white p-4 transition hover:border-emerald-400"><Warehouse className="text-emerald-600" size={18} /><h2 className="mt-2 text-base font-black">Abrir Inventario y Stock Guard</h2><p className="mt-1 text-sm text-slate-500">Revisión por publicación. Desconocido no equivale a riesgo.</p></Link><article className="rounded-xl border border-slate-200 bg-white p-4"><Workflow className="text-cyan-700" size={18} /><h2 className="mt-2 text-base font-black">Control de Product Case</h2><p className="mt-1 text-sm text-slate-500">En pausa. La identidad del proveedor y la economía completa siguen limitadas por evidencia.</p></article></section>
      <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><AlertTriangle size={15} />Este espacio no permite persistencia remota, escrituras de marketplace, envíos de WhatsApp ni mutaciones de Product Case.</p>
    </div>
  </main>
}
