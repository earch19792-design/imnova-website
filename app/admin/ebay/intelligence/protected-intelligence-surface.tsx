"use client"

import { ArrowLeft, BrainCircuit, FlaskConical, LineChart, RefreshCw,
  ShieldCheck } from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"

type Mode = "DECISIONS" | "EXPERIMENTS" | "LEARNING"
type Json = Record<string, unknown>
type Payload = { success?: boolean; generatedAt?: string; decisions?: Json;
  experiments?: Json; learning?: Json; error?: string }

function rows(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter((row): row is Json => Boolean(row) &&
    typeof row === "object" && !Array.isArray(row)) : []
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(String) : []
}

function text(value: unknown) {
  return value === null || value === undefined || value === "" ? "Unproven" : String(value)
}

const MODE_COPY = {
  DECISIONS: { title: "Seller OS Decisions", subtitle: "Prioritized exceptions and evidence-backed commercial interventions.", icon: LineChart },
  EXPERIMENTS: { title: "Experiment Guardian", subtitle: "Protected experiments, frozen variables, evaluation gates and hard overrides.", icon: FlaskConical },
  LEARNING: { title: "Commercial Learning", subtitle: "Proven outcomes and conservative listing, family or category transfer scope.", icon: BrainCircuit },
} as const

export function ProtectedIntelligenceSurface({ mode }: { mode: Mode }) {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
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
    } catch (caught) { setError(caught instanceof Error ? caught.message : "INTELLIGENCE_READ_FAILED") }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const copy = MODE_COPY[mode]
  const Icon = copy.icon

  const decisions = payload?.decisions ?? {}
  const experiments = payload?.experiments ?? {}
  const learning = payload?.learning ?? {}
  const decisionGroups: Array<[string, Json[]]> = [
    ["Today's priorities", rows(decisions.todaysPriorities)],
    ["Exception Queue", rows(decisions.exceptionQueue)],
    ["Commercial interventions", rows(decisions.commercialInterventions)],
    ["HUMAN_REVIEW", rows(decisions.humanReview)],
    ["DO_NOT_TOUCH", rows(decisions.doNotTouch)],
    ["REPLACEMENT_CANDIDATE", rows(decisions.replacementCandidates)],
    ["WAIT / HEALTHY", rows(decisions.waitingHealthy)],
  ]
  const experimentGroups: Array<[string, Json[]]> = [
    ["Active experiments", rows(experiments.active)], ["DO_NOT_TOUCH", rows(experiments.doNotTouch)],
    ["Ready to evaluate", rows(experiments.readyToEvaluate)], ["Soft signals", rows(experiments.softSignals)],
    ["Hard overrides", rows(experiments.hardOverrides)],
  ]

  return <main className="min-h-screen bg-[#07111d] p-4 text-slate-100 md:p-7"><div className="mx-auto max-w-[1500px] space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-white/10 bg-[#0b1826] p-5"><div><Link href="/admin/ebay/monitor" className="inline-flex items-center gap-2 text-xs font-bold text-cyan-300"><ArrowLeft size={14} />Commercial Monitor</Link><div className="mt-3 flex items-center gap-3"><span className="rounded-xl bg-cyan-400/10 p-2.5 text-cyan-300"><Icon size={20} /></span><div><h1 className="text-2xl font-black">{copy.title}</h1><p className="mt-1 text-sm text-slate-400">{copy.subtitle}</p></div></div></div><div className="flex items-center gap-2"><span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-black text-emerald-200"><ShieldCheck size={14} />READ-ONLY</span><button type="button" onClick={() => void load()} className="rounded-lg border border-white/10 p-2" aria-label="Refresh intelligence"><RefreshCw size={15} /></button></div></header>
    {error && <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">Read stopped safely: {error}</div>}
    {loading && !payload ? <div className="rounded-2xl border border-white/10 bg-[#0b1826] p-8 text-sm text-slate-400">Loading protected evidence…</div> : null}

    {mode === "DECISIONS" && payload ? <div className="space-y-4">{decisionGroups.map(([label, entries]) => <section key={label} className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1826]"><div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><h2 className="font-black">{label}</h2><span className="text-xs text-slate-500">{entries.length}</span></div><div className="divide-y divide-white/[.06]">{entries.slice(0, 50).map((entry, index) => <article key={String(entry.dedupeIdentity ?? entry.listingKey ?? index)} className="grid gap-2 p-4 lg:grid-cols-[minmax(220px,1.2fr)_repeat(3,minmax(150px,1fr))]"><div><p className="font-bold">{text(entry.title ?? entry.entityKey ?? entry.itemId)}</p><p className="mt-1 text-xs text-slate-500">{text(entry.classification ?? entry.recommendedAction)}</p></div><div><p className="text-[10px] uppercase text-slate-500">Evidence / confidence</p><p className="mt-1 text-xs">{text(entry.confidence ?? entry.evidenceStatus)}</p></div><div><p className="text-[10px] uppercase text-slate-500">Reason codes</p><p className="mt-1 text-xs text-amber-100">{strings(entry.reasonCodes).join(" · ") || "None"}</p></div><div><p className="text-[10px] uppercase text-slate-500">Next review condition</p><p className="mt-1 text-xs">{text(entry.nextReviewCondition)}</p></div></article>)}{entries.length === 0 && <p className="p-4 text-sm text-slate-500">No evidence-backed entries in this class.</p>}</div></section>)}</div> : null}

    {mode === "EXPERIMENTS" && payload ? <div className="space-y-4">{experimentGroups.map(([label, entries]) => <section key={label} className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1826]"><div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><h2 className="font-black">{label}</h2><span className="text-xs text-slate-500">{entries.length}</span></div><div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">{entries.slice(0, 50).map((entry, index) => <article key={String(entry.experimentId ?? entry.listingKey ?? index)} className="rounded-xl border border-white/10 bg-white/[.025] p-4"><p className="text-sm font-black">{text(entry.title ?? entry.itemId ?? entry.listingKey)}</p><p className="mt-1 text-xs text-violet-200">{text(entry.lifecycleState ?? entry.experimentOperationalState)}</p><dl className="mt-3 space-y-2 text-xs"><div><dt className="text-slate-500">Frozen variables</dt><dd>{strings(entry.frozenVariables).join(" · ") || "None proven"}</dd></div><div><dt className="text-slate-500">Soft / external signals</dt><dd>{strings(entry.externalSignalCodes).join(" · ") || text(entry.externalSignalCount)}</dd></div><div><dt className="text-slate-500">Next evaluation</dt><dd>{text(entry.nextReviewAt ?? entry.nextReviewCondition ?? entry.checkpointGate)}</dd></div></dl></article>)}{entries.length === 0 && <p className="text-sm text-slate-500">No evidence-backed entries in this state.</p>}</div></section>)}</div> : null}

    {mode === "LEARNING" && payload ? <div className="grid gap-4 lg:grid-cols-3"><section className="rounded-2xl border border-white/10 bg-[#0b1826] p-5"><p className="text-[10px] font-black uppercase text-cyan-300">Listing-level learnings</p><p className="mt-3 text-2xl font-black">{rows(learning.listingLevelLearnings).length}</p><p className="mt-2 text-xs text-slate-400">No outcome is synthesized from diagnosis or active-market evidence.</p></section><section className="rounded-2xl border border-white/10 bg-[#0b1826] p-5"><p className="text-[10px] font-black uppercase text-cyan-300">Family candidates</p><p className="mt-3 text-2xl font-black">{rows(learning.familyCandidates).length}</p><p className="mt-2 text-xs text-slate-400">Transfer requires comparable completed experiments and proven family identity.</p></section><section className="rounded-2xl border border-white/10 bg-[#0b1826] p-5"><p className="text-[10px] font-black uppercase text-cyan-300">Category candidates</p><p className="mt-3 text-2xl font-black">{rows(learning.categoryCandidates).length}</p><p className="mt-2 text-xs text-slate-400">{text(learning.transferState)} · universal rules disabled</p></section><section className="rounded-2xl border border-white/10 bg-[#0b1826] p-5 lg:col-span-3"><h2 className="font-black">Outcome provenance and transfer scope</h2><p className="mt-2 text-sm text-slate-300">Source: {text(learning.source)} · evidence timestamp: {text(learning.evidenceTimestamp)}</p><p className="mt-2 text-xs text-amber-100">Limitation: {text(learning.limitationCode)} · syntheticLearning=false · universalRuleAllowed=false</p></section></div> : null}
    <p className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-slate-400">0 marketplace writes · 0 Registry writes · 0 Product Case mutations · Experiment Guardian remains authoritative.</p>
  </div></main>
}
