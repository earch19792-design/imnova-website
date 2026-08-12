"use client"

import { ArrowLeft, BrainCircuit, RefreshCw, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"

type Json = Record<string, unknown>
function record(value: unknown): Json { return value && typeof value === "object" &&
  !Array.isArray(value) ? value as Json : {} }
function rows(value: unknown) { return Array.isArray(value) ? value.map(record) : [] }
function text(value: unknown) { return value === null || value === undefined || value === ""
  ? "UNPROVEN" : String(value) }

export default function StrategicReviewPage() {
  const [payload, setPayload] = useState<Json | null>(null)
  const [review, setReview] = useState<Json | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function token() {
    const { data, error: authError } = await supabase.auth.getSession()
    if (authError || !data.session) throw new Error("AUTH_REQUIRED")
    return data.session.access_token
  }
  const load = useCallback(async () => {
    setBusy(true); setError("")
    try {
      const accessToken = await token()
      const response = await fetch("/api/admin/ebay/strategic-review", { cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` } })
      const body = await response.json() as Json
      if (!response.ok || body.success !== true) throw new Error(text(body.error))
      setPayload(body)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "STRATEGIC_REVIEW_FAILED") }
    finally { setBusy(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  async function runReview() {
    setBusy(true); setError("")
    try {
      const accessToken = await token()
      const fingerprint = record(review?.prefilter).materialFingerprint
      const response = await fetch("/api/admin/ebay/strategic-review", { method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ previousMaterialFingerprint: fingerprint ?? null }) })
      const body = await response.json() as Json
      if (!response.ok || body.success !== true) throw new Error(text(body.error))
      setReview(record(body.review))
    } catch (caught) { setError(caught instanceof Error ? caught.message : "STRATEGIC_REVIEW_FAILED") }
    finally { setBusy(false) }
  }
  const bundle = record(payload?.bundle)
  const decisions = record(bundle.decisions)
  const queue = record(bundle.strategicReviewQueue)
  const automation = record(bundle.automationCandidates)
  const ai = record(bundle.aiOperationalStatus)
  const budget = record(ai.budget)
  const runtime = record(payload?.aiRuntime)
  const scheduler = record(payload?.scheduler)
  const connection = record(payload?.chatGptConnection)
  const displayedBrief = record(review?.dailyBrief ?? payload?.dailyBrief)
  const sections = record(displayedBrief.sections)
  const briefSummary = typeof displayedBrief.summary === "string" ? displayedBrief.summary : null

  const counts = [
    ["Critical now", rows(decisions.criticalOperational).length],
    ["Actionable", rows(decisions.actionableCommercial).length],
    ["Research / evidence", rows(decisions.researchOrEvidence).length],
    ["Capability blockers", rows(decisions.capabilityBlockers).length],
    ["Human review", rows(decisions.humanReview).length],
  ] as const

  return <main className="min-h-screen bg-[#07111d] p-4 text-slate-100 md:p-7"><div className="mx-auto max-w-[1500px] space-y-4">
    <header className="rounded-2xl border border-white/10 bg-[#0b1826] p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><Link href="/admin/ebay-seller-os" className="inline-flex items-center gap-2 text-xs font-bold text-cyan-300"><ArrowLeft size={14} />Seller OS</Link><div className="mt-3 flex items-center gap-3"><span className="rounded-xl bg-fuchsia-400/10 p-2.5 text-fuchsia-200"><BrainCircuit size={21} /></span><div><h1 className="text-2xl font-black">Strategic AI Review</h1><p className="mt-1 text-sm text-slate-400">Deterministic evidence first; one bounded AI review only when material.</p></div></div></div><div className="flex items-center gap-2"><span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-black text-emerald-200"><ShieldCheck size={14} />READ ONLY</span><button type="button" onClick={() => void load()} disabled={busy} className="rounded-lg border border-white/10 p-2" aria-label="Refresh strategic evidence"><RefreshCw size={15} /></button></div></div></header>
    {error ? <div role="alert" className="rounded-xl border border-rose-300/20 bg-rose-300/[.06] p-4 text-sm text-rose-100">Stopped safely: {error}</div> : null}
    <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{counts.map(([label, count]) => <article key={label} className="rounded-xl border border-white/10 bg-[#0b1826] p-3"><p className="text-[10px] uppercase text-slate-500">{label}</p><p className="mt-1 text-xl font-black">{count}</p></article>)}</section>
    <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]"><article className="rounded-2xl border border-fuchsia-200/15 bg-[#0b1826] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-wider text-fuchsia-200">Daily Strategic Brief</p><h2 className="mt-1 text-xl font-black">What matters today</h2></div><button type="button" onClick={() => void runReview()} disabled={busy || !payload} className="min-h-11 rounded-xl bg-fuchsia-200 px-4 text-sm font-black text-black disabled:opacity-40">{busy ? "Reviewing…" : "Run bounded AI review"}</button></div>{briefSummary ? <p className="mt-4 text-sm leading-6">{briefSummary}</p> : <div className="mt-4 grid gap-2 sm:grid-cols-2">{Object.entries(sections).filter(([, value]) => Array.isArray(value) && value.length).slice(0, 8).map(([name, value]) => <div key={name} className="rounded-xl border border-white/10 p-3"><p className="text-[10px] uppercase text-slate-500">{name}</p><p className="mt-1 text-sm font-bold">{(value as unknown[]).length} material item(s)</p></div>)}{Object.keys(sections).length === 0 ? <p className="text-sm text-slate-500">Loading bounded evidence…</p> : null}</div>}<p className="mt-4 text-xs text-slate-500">AI call count: {text(review?.aiCallCount ?? 0)} · unchanged evidence is suppressed · deterministic Seller OS continues at every budget state.</p></article>
      <article className="rounded-2xl border border-white/10 bg-[#0b1826] p-5"><p className="text-[10px] font-black uppercase tracking-wider text-cyan-200">AI budget and routing</p><dl className="mt-3 space-y-2 text-sm"><div className="flex justify-between gap-3"><dt className="text-slate-500">Monthly policy</dt><dd>USD {text(budget.monthlyBudgetUsd ?? 10)}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">State</dt><dd>{text(budget.state)}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">Spend</dt><dd>{text(ai.costStatus)}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">Enforcement</dt><dd className="text-right text-xs">{text(budget.enforcementStatus)}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">Provider</dt><dd>{text(runtime.activeProvider)}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">Fallback health</dt><dd>{text(runtime.fallbackVisibility)}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">Scheduler</dt><dd>{text(scheduler.status)}</dd></div></dl></article></section>
    <section className="grid gap-4 xl:grid-cols-2"><article className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1826]"><div className="border-b border-white/10 px-5 py-4"><h2 className="font-black">Strategic Review Queue</h2><p className="mt-1 text-xs text-slate-500">Improve Seller OS—not the operator’s commercial action queue.</p></div><div className="divide-y divide-white/[.06]">{rows(queue.entries).map((entry) => <div key={text(entry.signalId)} className="p-4"><div className="flex items-start justify-between gap-3"><p className="font-bold">{text(entry.signalType)}</p><span className="text-xs text-amber-100">{text(entry.severity)}</span></div><p className="mt-1 text-sm text-slate-300">{text(entry.summary)}</p><p className="mt-2 text-xs text-cyan-100">Next: {text(entry.nextAction)} · evidence {text(entry.evidenceCount)}</p></div>)}{rows(queue.entries).length === 0 ? <p className="p-5 text-sm text-slate-500">No material deterministic strategic signal.</p> : null}</div></article>
      <article className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1826]"><div className="border-b border-white/10 px-5 py-4"><h2 className="font-black">Automation Candidates</h2><p className="mt-1 text-xs text-slate-500">Repeated deterministic work; never auto-enabled.</p></div><div className="divide-y divide-white/[.06]">{rows(automation.entries).map((entry) => <div key={text(entry.candidateId)} className="p-4"><p className="font-bold">{text(entry.manualOperation)}</p><p className="mt-1 text-sm text-slate-400">{text(entry.deterministicPattern)}</p><p className="mt-2 text-xs text-amber-100">{text(entry.requiredHumanGate)} · frequency {text(entry.frequency)}</p></div>)}{rows(automation.entries).length === 0 ? <p className="p-5 text-sm text-slate-500">No pattern has crossed the repeated-evidence gate.</p> : null}</div></article></section>
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><article className="rounded-xl border border-white/10 bg-[#0b1826] p-4"><p className="text-[10px] uppercase text-slate-500">System coherence warnings</p><p className="mt-2 text-xl font-black">{rows(queue.entries).filter((row) => ["DECISION_CONFLICT", "CANONICAL_TRUTH_CONFLICT"].includes(text(row.signalType))).length}</p></article><article className="rounded-xl border border-white/10 bg-[#0b1826] p-4"><p className="text-[10px] uppercase text-slate-500">Recent AI reviews</p><p className="mt-2 font-black">PREVIEW EPHEMERAL</p><p className="mt-1 text-xs text-slate-500">Durable persistence requires separate authorization.</p></article><article className="rounded-xl border border-white/10 bg-[#0b1826] p-4"><p className="text-[10px] uppercase text-slate-500">AI usage by workload</p><p className="mt-2 font-black">{rows(ai.usageByWorkload).length ? `${rows(ai.usageByWorkload).length} observed` : "UNPROVEN"}</p><p className="mt-1 text-xs text-slate-500">Model / fallback health: {text(runtime.fallbackVisibility)}</p></article><article className="rounded-xl border border-white/10 bg-[#0b1826] p-4"><p className="text-[10px] uppercase text-slate-500">ChatGPT direct bridge</p><p className="mt-2 font-black">{text(connection.code)}</p><p className="mt-1 text-xs text-slate-500">Connected: {text(connection.connected)} · live tool call proven: {text(connection.liveToolCallProven)}</p></article></section>
    <p className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-slate-400">Aggressive thinking · conservative execution · 0 marketplace writes · 0 image generation · 0 secret exposure.</p>
  </div></main>
}
