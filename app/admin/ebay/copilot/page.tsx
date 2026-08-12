"use client"

import { ArrowLeft, Bot, Send, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useState } from "react"

import { supabase } from "@/lib/supabase"

type Json = Record<string, unknown>

const prompts = [
  "What needs my attention today?",
  "What should we automate next?",
  "What is Seller OS doing inconsistently?",
  "What is blocking scale to 1000 listings?",
  "What evidence is missing most often?",
  "How much AI budget have we used?",
]

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {}
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map((row) => typeof row === "string"
    ? row : JSON.stringify(row)) : []
}

function SellerOsCopilotPageContent() {
  const search = useSearchParams()
  const [prompt, setPrompt] = useState("")
  const [status, setStatus] = useState<Json | null>(null)
  const [result, setResult] = useState<Json | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const contextRef = useMemo(() => {
    const requested = search.get("surface")?.toUpperCase() ?? "PORTFOLIO"
    const surface = ["PORTFOLIO", "LISTING", "OPPORTUNITY", "STOCK", "EXPERIMENT",
      "DECISION"].includes(requested) ? requested : "PORTFOLIO"
    return { surface, itemId: search.get("itemId"),
      opportunityCaseId: search.get("opportunityCaseId"),
      experimentId: search.get("experimentId"), exceptionId: search.get("exceptionId") }
  }, [search])

  async function token() {
    const { data, error: authError } = await supabase.auth.getSession()
    if (authError || !data.session) throw new Error("AUTH_REQUIRED")
    return data.session.access_token
  }

  useEffect(() => {
    void (async () => {
      try {
        const accessToken = await token()
        const response = await fetch("/api/admin/ebay/copilot", { cache: "no-store",
          headers: { Authorization: `Bearer ${accessToken}` } })
        const body = await response.json() as Json
        if (!response.ok) throw new Error(String(body.error ?? "COPILOT_STATUS_FAILED"))
        setStatus(body)
      } catch (caught) { setError(caught instanceof Error ? caught.message : "COPILOT_STATUS_FAILED") }
    })()
  }, [])

  async function ask(selected?: string) {
    const question = (selected ?? prompt).trim()
    if (!question || busy) return
    setBusy(true); setError(""); setResult(null)
    try {
      const accessToken = await token()
      const response = await fetch("/api/admin/ebay/copilot", { method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: question, contextRef }) })
      const body = await response.json() as Json
      if (!response.ok || body.success !== true) throw new Error(String(body.error ??
        record(body.result).status ?? "COPILOT_FAILED_CLOSED"))
      setResult(record(body.result)); setPrompt(question)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "COPILOT_FAILED_CLOSED") }
    finally { setBusy(false) }
  }

  const response = record(result?.response)
  const plan = record(result?.plan)
  const runtime = status ? record(status.status) : record(plan.runtime)
  const recommendations = Array.isArray(response.recommendations)
    ? response.recommendations.map(record) : []

  return <main className="min-h-screen bg-[#07111d] p-4 text-slate-100 md:p-7">
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="rounded-2xl border border-white/10 bg-[#0b1826] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4"><div>
          <Link href="/admin/ebay-seller-os" className="inline-flex items-center gap-2 text-xs font-bold text-cyan-300"><ArrowLeft size={14} />Seller OS</Link>
          <div className="mt-3 flex items-center gap-3"><span className="rounded-xl bg-violet-400/10 p-2.5 text-violet-200"><Bot size={21} /></span><div><h1 className="text-2xl font-black">Seller OS Copilot</h1><p className="mt-1 text-sm text-slate-400">OpenAI-powered reasoning over the same canonical read-only Seller OS evidence.</p></div></div>
        </div><span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-black text-emerald-200"><ShieldCheck size={14} />READ ONLY</span></div>
        <p className="mt-4 rounded-xl border border-violet-300/15 bg-violet-300/[.04] p-3 text-xs text-violet-100">This is the internal Seller OS Copilot, not your ChatGPT conversation. Context is bounded to {String(contextRef.surface)}{contextRef.itemId ? ` · Item ${contextRef.itemId}` : ""}; it drills down through focused tools.</p>
      </header>

      <section className="grid gap-2 sm:grid-cols-3">
        <article className="rounded-xl border border-white/10 bg-[#0b1826] p-3"><p className="text-[10px] uppercase text-slate-500">AI runtime</p><p className="mt-1 font-black">{String(runtime.status ?? "Checking")}</p></article>
        <article className="rounded-xl border border-white/10 bg-[#0b1826] p-3"><p className="text-[10px] uppercase text-slate-500">Provider route</p><p className="mt-1 font-black">{String(runtime.activeProvider ?? "UNPROVEN")}</p></article>
        <article className="rounded-xl border border-white/10 bg-[#0b1826] p-3"><p className="text-[10px] uppercase text-slate-500">Execution</p><p className="mt-1 font-black text-emerald-200">0 marketplace writes</p></article>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#0b1826] p-5">
        <label htmlFor="copilot-prompt" className="text-xs font-black uppercase tracking-wider text-cyan-200">Ask with evidence</label>
        <textarea id="copilot-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={2000} rows={4} placeholder="Why is this listing classified this way?" className="mt-3 w-full rounded-xl border border-white/10 bg-black/25 p-3 text-sm outline-none focus:border-cyan-300/50" />
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void ask()} disabled={busy || !prompt.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-cyan-200 px-4 text-sm font-black text-black disabled:opacity-40"><Send size={15} />{busy ? "Reviewing…" : "Ask Copilot"}</button>{prompts.map((suggestion) => <button key={suggestion} type="button" disabled={busy} onClick={() => void ask(suggestion)} className="min-h-11 rounded-xl border border-white/10 px-3 text-left text-xs text-slate-300 disabled:opacity-40">{suggestion}</button>)}</div>
      </section>

      {error ? <div role="alert" className="rounded-xl border border-rose-300/20 bg-rose-300/[.06] p-4 text-sm text-rose-100">Stopped safely: {error}</div> : null}
      {result ? <section className="space-y-4 rounded-2xl border border-cyan-200/15 bg-[#0b1826] p-5">
        <div><p className="text-[10px] font-black uppercase tracking-wider text-cyan-200">Evidence-backed answer</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{String(response.summary ?? result.status)}</p></div>
        <div className="grid gap-4 lg:grid-cols-2"><div><h2 className="font-black">Recommendations</h2><div className="mt-2 space-y-2">{recommendations.map((row, index) => <article key={index} className="rounded-xl border border-white/10 p-3 text-sm"><p className="font-bold">{String(row.action)}</p><p className="mt-1 text-xs text-slate-400">{String(row.reason)} · {String(row.priority)}{row.humanApprovalRequired ? " · human approval" : ""}</p></article>)}{recommendations.length === 0 ? <p className="text-sm text-slate-500">No model recommendation was produced; deterministic Seller OS remains available.</p> : null}</div></div><div><h2 className="font-black">Evidence and boundaries</h2><p className="mt-2 text-xs leading-5 text-slate-400">{strings(response.evidenceRefs).join(" · ") || "No evidence references returned"}</p><p className="mt-3 text-xs text-amber-100">Do not touch: {strings(response.doNotTouch).join(" · ") || "No additional protected entity named"}</p><p className="mt-3 text-xs text-slate-500">Cost: UNPROVEN unless authoritative gateway evidence is returned. No buyer PII, secrets, arbitrary SQL, URL proxy, or write tool is available.</p></div></div>
      </section> : null}
    </div>
  </main>
}

export default function SellerOsCopilotPage() {
  return <Suspense fallback={<main className="min-h-screen bg-[#07111d] p-7 text-slate-300">Loading protected Copilot…</main>}><SellerOsCopilotPageContent /></Suspense>
}
