"use client"

import { ArrowLeft, BrainCircuit, FlaskConical, LineChart, RefreshCw,
  ShieldCheck } from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"
import { presentSellerOsCode, presentSellerOsStatus } from "@/lib/seller-os/presentation"

type Mode = "DECISIONS" | "EXPERIMENTS" | "LEARNING"
type Json = Record<string, unknown>
type Payload = { success?: boolean; generatedAt?: string; decisions?: Json;
  experiments?: Json; learning?: Json; error?: string }
const CANONICAL_DECISION_SESSION_KEY = "seller_os_canonical_opportunity_v2"
const DECISION_CLASSES = new Set(["CRITICAL_OPERATIONAL", "ACTIONABLE_COMMERCIAL",
  "RESEARCH_OR_EVIDENCE", "CAPABILITY_BLOCKED", "HUMAN_REVIEW", "DO_NOT_TOUCH",
  "WAIT", "HEALTHY", "REPLACEMENT_CANDIDATE"])
const MATERIAL_DECISION_CLASSES = new Set(["CRITICAL_OPERATIONAL", "ACTIONABLE_COMMERCIAL",
  "RESEARCH_OR_EVIDENCE", "CAPABILITY_BLOCKED", "HUMAN_REVIEW", "REPLACEMENT_CANDIDATE"])

function rows(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter((row): row is Json => Boolean(row) &&
    typeof row === "object" && !Array.isArray(row)) : []
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(String) : []
}

function text(value: unknown) {
  return value === null || value === undefined || value === "" ? "No comprobado" : String(value)
}

function record(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {}
}

function evidenceSummary(value: unknown) {
  return Object.entries(record(value)).flatMap(([name, observed]) =>
    observed === null || ["string", "number", "boolean"].includes(typeof observed)
      ? [`${presentSellerOsCode(name)}: ${text(observed)}`] : []).slice(0, 8).join(" · ")
}

function readCanonicalSessionDecision() {
  try {
    const cached = record(JSON.parse(sessionStorage.getItem(CANONICAL_DECISION_SESSION_KEY) ?? "{}"))
    const decision = record(cached.decisionIntegration)
    const requestedItemId = new URL(window.location.href).searchParams.get("opportunityItemId")
    const itemId = typeof decision.sourceItemId === "string" ? decision.sourceItemId : ""
    const storedAt = Date.parse(typeof cached.storedAt === "string" ? cached.storedAt : "")
    if (cached.canonicalResultVersion !== "CANONICAL_OPPORTUNITY_RESULT_V2_2026_08_12" ||
        decision.contractVersion !== "CANONICAL_OPPORTUNITY_DECISION_V2_2026_08_12" ||
        !/^\d{9,19}$/.test(itemId) || (requestedItemId && requestedItemId !== itemId) ||
        !DECISION_CLASSES.has(String(decision.classification)) || !Number.isFinite(storedAt) ||
        storedAt - Date.now() > 5 * 60 * 1_000 ||
        Date.now() - storedAt > 24 * 60 * 60 * 1_000) return null
    return { ...decision, entityKey: itemId, itemId,
      title: decision.canonicalFamily ?? `Item ${itemId}`,
      dedupeIdentity: `canonical-opportunity:${itemId}`,
      sessionPresentationOnly: true, externalExecutionAllowed: false }
  } catch { return null }
}

const MODE_COPY = {
  DECISIONS: { title: "Decisiones de Seller OS", subtitle: "Excepciones priorizadas e intervenciones comerciales respaldadas por evidencia.", icon: LineChart },
  EXPERIMENTS: { title: "Guardián de experimentos", subtitle: "Experimentos protegidos, variables congeladas, evaluaciones y excepciones críticas.", icon: FlaskConical },
  LEARNING: { title: "Aprendizaje comercial", subtitle: "Resultados comprobados y transferencia conservadora por publicación, familia o categoría.", icon: BrainCircuit },
} as const

export function ProtectedIntelligenceSurface({ mode }: { mode: Mode }) {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [sessionDecision, setSessionDecision] = useState<Json | null>(null)
  const load = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !data.session) throw new Error("AUTH_REQUIRED")
      const response = await fetch("/api/admin/ebay/intelligence", { cache: "no-store",
        headers: { Authorization: `Bearer ${data.session.access_token}` } })
      const result = await response.json() as Payload
      if (!response.ok || !result.success) throw new Error(result.error ?? "INTELLIGENCE_READ_FAILED")
      setPayload(result)
      setSessionDecision(readCanonicalSessionDecision())
    } catch (caught) { setError(caught instanceof Error ? caught.message : "INTELLIGENCE_READ_FAILED") }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const copy = MODE_COPY[mode]
  const Icon = copy.icon

  const decisions = payload?.decisions ?? {}
  const experiments = payload?.experiments ?? {}
  const learning = payload?.learning ?? {}
  const withoutSessionItem = (entries: Json[]) => sessionDecision
    ? entries.filter((entry) => entry.entityKey !== sessionDecision.entityKey) : entries
  const withSessionDecision = (entries: Json[], classification?: string) => {
    const filtered = withoutSessionItem(entries)
    return sessionDecision && (!classification || sessionDecision.classification === classification)
      ? [sessionDecision, ...filtered] : filtered
  }
  const decisionGroups: Array<[string, Json[]]> = [
    ["Prioridades de hoy", sessionDecision &&
      MATERIAL_DECISION_CLASSES.has(String(sessionDecision.classification))
      ? withSessionDecision(rows(decisions.todaysPriorities))
      : withoutSessionItem(rows(decisions.todaysPriorities))],
    ["CRÍTICO AHORA", withSessionDecision(rows(decisions.criticalNow), "CRITICAL_OPERATIONAL")],
    ["ACCIONABLE", withSessionDecision(rows(decisions.actionable), "ACTIONABLE_COMMERCIAL")],
    ["INVESTIGACIÓN / EVIDENCIA REQUERIDA", withSessionDecision(rows(decisions.researchOrEvidence),
      "RESEARCH_OR_EVIDENCE")],
    ["BLOQUEOS DE CAPACIDAD", withSessionDecision(rows(decisions.capabilityBlockers),
      "CAPABILITY_BLOCKED")],
    ["NO TOCAR", withSessionDecision(rows(decisions.doNotTouch), "DO_NOT_TOUCH")],
    ["EN ESPERA", withSessionDecision(rows(decisions.waiting), "WAIT")],
    ["SALUDABLE", withSessionDecision(rows(decisions.healthy), "HEALTHY")],
    ["CANDIDATOS DE REEMPLAZO", rows(decisions.replacementCandidates)],
    ["REVISIÓN HUMANA", withSessionDecision(rows(decisions.humanReview), "HUMAN_REVIEW")],
  ]
  const decisionCounts = decisionGroups.slice(1).map(([label, entries]) => [label, entries.length] as const)
  const experimentGroups: Array<[string, Json[]]> = [
    ["Experimentos activos", rows(experiments.active)], ["NO TOCAR", rows(experiments.doNotTouch)],
    ["Listos para evaluar", rows(experiments.readyToEvaluate)], ["Señales preliminares", rows(experiments.softSignals)],
    ["Excepciones críticas", rows(experiments.hardOverrides)],
  ]

  return <main className="min-h-screen bg-[#07111d] p-4 text-slate-100 md:p-7"><div className="mx-auto max-w-[1500px] space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-white/10 bg-[#0b1826] p-5"><div><Link href="/admin/ebay/monitor" className="inline-flex items-center gap-2 text-sm font-bold text-cyan-300"><ArrowLeft size={14} />Monitor comercial</Link><div className="mt-3 flex items-center gap-3"><span className="rounded-xl bg-cyan-400/10 p-2.5 text-cyan-300"><Icon size={20} /></span><div><h1 className="text-2xl font-black">{copy.title}</h1><p className="mt-1 text-sm text-slate-400">{copy.subtitle}</p></div></div></div><div className="flex items-center gap-2"><Link href={`/admin/ebay/copilot?surface=${mode === "DECISIONS" ? "DECISION" : mode === "EXPERIMENTS" ? "EXPERIMENT" : "PORTFOLIO"}`} className="rounded-lg border border-violet-300/20 px-3 py-2 text-sm font-black text-violet-200">Preguntar al Copilot</Link><span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-sm font-black text-emerald-200"><ShieldCheck size={14} />Solo lectura</span><button type="button" onClick={() => void load()} className="rounded-lg border border-white/10 p-2" aria-label="Actualizar inteligencia"><RefreshCw size={15} /></button></div></header>
    {error && <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">La lectura se detuvo de forma segura: {error}</div>}
    {loading && !payload ? <div className="rounded-2xl border border-white/10 bg-[#0b1826] p-8 text-sm text-slate-400">Cargando evidencia protegida…</div> : null}

    {mode === "DECISIONS" && payload ? <div className="space-y-4"><section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{decisionCounts.map(([label, count]) => <article key={label} className="rounded-xl border border-white/10 bg-[#0b1826] p-3"><p className="text-[13px] uppercase text-slate-500">{label}</p><p className="mt-1 text-xl font-black">{count}</p></article>)}</section>{sessionDecision ? <p className="rounded-xl border border-cyan-300/15 bg-cyan-300/[.05] p-3 text-sm text-cyan-100">El último resultado canónico de oportunidad V2 de la sesión protegida está sincronizado para el Item {text(sessionDecision.itemId)}. Sólo prevalece en la presentación y no autoriza ejecución.</p> : null}{decisionGroups.filter(([, entries]) => entries.length > 0).map(([label, entries]) => <section key={label} className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1826]"><div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><h2 className="font-black">{label}</h2><span className="text-sm text-slate-500">{entries.length}</span></div><div className="divide-y divide-white/[.06]">{entries.slice(0, 50).map((entry, index) => <article key={String(entry.dedupeIdentity ?? entry.listingKey ?? index)} className="grid gap-2 p-4 lg:grid-cols-[minmax(220px,1.2fr)_repeat(3,minmax(150px,1fr))]"><div><p className="font-bold">{text(entry.title ?? entry.entityKey ?? entry.itemId)}</p><p className="mt-1 text-[13px] text-slate-500">{presentSellerOsStatus(String(entry.classification ?? entry.recommendedAction))} · prioridad {presentSellerOsStatus(text(entry.priority))} · severidad {presentSellerOsStatus(text(entry.severity))}</p></div><div><p className="text-[13px] uppercase text-slate-500">Evidencia / confianza</p><p className="mt-1 text-sm">{presentSellerOsStatus(text(entry.confidence ?? entry.evidenceStatus))}</p><p className="mt-1 text-[13px] leading-5 text-slate-500">{evidenceSummary(entry.observedEvidence) || "No se comprobó un defecto de la publicación"}</p></div><details><summary className="cursor-pointer text-[13px] uppercase text-cyan-300">Ver códigos técnicos</summary><p className="mt-1 text-[13px] text-amber-100">{strings(entry.reasonCodes).join(" · ") || "NONE"}</p></details><div><p className="text-[13px] uppercase text-slate-500">Próxima revisión</p><p className="mt-1 text-sm">{presentSellerOsStatus(text(entry.nextReviewCondition))}</p></div></article>)}</div></section>)}</div> : null}

    {mode === "EXPERIMENTS" && payload ? <div className="space-y-4">{experimentGroups.map(([label, entries]) => <section key={label} className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1826]"><div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><h2 className="font-black">{label}</h2><span className="text-[13px] text-slate-500">{entries.length}</span></div><div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">{entries.slice(0, 50).map((entry, index) => <article key={String(entry.experimentId ?? entry.listingKey ?? index)} className="rounded-xl border border-white/10 bg-white/[.025] p-4"><p className="text-base font-black">{text(entry.title ?? entry.itemId ?? entry.listingKey)}</p><p className="mt-1 text-[13px] text-violet-200">{presentSellerOsStatus(text(entry.lifecycleState ?? entry.experimentOperationalState))}</p><dl className="mt-3 space-y-2 text-[13px]"><div><dt className="text-slate-500">Variables protegidas</dt><dd>{strings(entry.frozenVariables).join(" · ") || "Ninguna comprobada"}</dd></div><div><dt className="text-slate-500">Señales preliminares o externas</dt><dd>{strings(entry.externalSignalCodes).join(" · ") || text(entry.externalSignalCount)}</dd></div><div><dt className="text-slate-500">Próxima evaluación</dt><dd>{text(entry.nextReviewAt ?? entry.nextReviewCondition ?? entry.checkpointGate)}</dd></div></dl><details className="mt-3"><summary className="cursor-pointer text-[13px] font-bold text-cyan-300">Ver estado técnico</summary><p className="mt-1 font-mono text-[13px] text-slate-400">{text(entry.lifecycleState ?? entry.experimentOperationalState)}</p></details></article>)}{entries.length === 0 && <p className="text-sm text-slate-500">No hay entradas respaldadas por evidencia en este estado.</p>}</div></section>)}</div> : null}

    {mode === "LEARNING" && payload ? <div className="grid gap-4 lg:grid-cols-3"><section className="rounded-2xl border border-white/10 bg-[#0b1826] p-5"><p className="text-[13px] font-black uppercase text-cyan-300">Aprendizajes por publicación</p><p className="mt-3 text-2xl font-black">{rows(learning.listingLevelLearnings).length}</p><p className="mt-2 text-[13px] leading-5 text-slate-400">No se sintetizan resultados a partir de diagnósticos ni de evidencia de mercado activa.</p></section><section className="rounded-2xl border border-white/10 bg-[#0b1826] p-5"><p className="text-[13px] font-black uppercase text-cyan-300">Familias candidatas</p><p className="mt-3 text-2xl font-black">{rows(learning.familyCandidates).length}</p><p className="mt-2 text-[13px] leading-5 text-slate-400">La transferencia requiere experimentos comparables terminados e identidad de familia comprobada.</p></section><section className="rounded-2xl border border-white/10 bg-[#0b1826] p-5"><p className="text-[13px] font-black uppercase text-cyan-300">Categorías candidatas</p><p className="mt-3 text-2xl font-black">{rows(learning.categoryCandidates).length}</p><p className="mt-2 text-[13px] text-slate-400">{presentSellerOsStatus(text(learning.transferState))} · reglas universales desactivadas</p></section><section className="rounded-2xl border border-white/10 bg-[#0b1826] p-5 lg:col-span-3"><h2 className="text-lg font-black">Procedencia del resultado y alcance de transferencia</h2><p className="mt-2 text-sm text-slate-300">Estado del aprendizaje almacenado: {presentSellerOsStatus(text(learning.storedLearningStatus))} · fecha de evidencia: {text(learning.evidenceTimestamp)}</p><p className="mt-2 text-[13px] text-slate-400">Fuentes elegibles cuando exista evidencia: {strings(learning.eligibleSources).join(" · ") || "Ninguna comprobada"}</p><details className="mt-3"><summary className="cursor-pointer text-[13px] font-bold text-cyan-300">Ver procedencia técnica</summary><p className="mt-2 font-mono text-[13px] text-amber-100">source={text(learning.observedSource)} · transferState={text(learning.transferState)} · limitation={text(learning.limitationCode)} · syntheticLearning=false · universalRuleAllowed=false</p></details></section></div> : null}
    <p className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-slate-400">0 escrituras de marketplace · 0 escrituras del registro · 0 mutaciones de Product Case · el Guardián de experimentos conserva su autoridad.</p>
  </div></main>
}
