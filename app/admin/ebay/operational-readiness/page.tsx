"use client"

import { ArrowLeft, FileCheck2, PackageSearch, ShieldCheck, Upload, Workflow } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"

type ReadinessPayload = {
  success?: boolean
  capabilities?: Record<string, string | boolean>
  readiness?: Record<string, string | boolean>
  templates?: Array<{ internalTemplateKey: string; approvalStatus: string }>
  result?: unknown
  error?: string
}

export default function OperationalReadinessPage() {
  const [payload, setPayload] = useState<ReadinessPayload | null>(null)
  const [qualityFile, setQualityFile] = useState<File | null>(null)
  const [qualityResult, setQualityResult] = useState<unknown>(null)
  const [whatsappResult, setWhatsappResult] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function request(body?: unknown) {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !data.session) throw new Error("AUTH_REQUIRED")
    const response = await fetch("/api/admin/ebay/operational-readiness", {
      method: body ? "POST" : "GET", cache: "no-store",
      headers: { Authorization: `Bearer ${data.session.access_token}`,
        ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const result = await response.json() as ReadinessPayload
    if (!response.ok || !result.success) throw new Error(result.error ?? "READINESS_READ_FAILED")
    return result
  }

  useEffect(() => { request().then(setPayload).catch((caught) =>
    setError(caught instanceof Error ? caught.message : "READINESS_READ_FAILED")) }, [])

  async function importQuality() {
    if (!qualityFile) return
    setLoading(true); setError("")
    try {
      const content = await qualityFile.text()
      const result = await request({ action: "IMPORT_QUALITY_REPORT", input: {
        format: qualityFile.name.toLowerCase().endsWith(".json") ? "JSON" : "CSV",
        fileName: qualityFile.name, content,
      } })
      setQualityResult(result.result)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "QUALITY_IMPORT_FAILED") }
    finally { setLoading(false) }
  }

  async function previewWhatsApp() {
    setLoading(true); setError("")
    try {
      const result = await request({ action: "PREVIEW_WHATSAPP", input: {
        accountKey: "PROTECTED_ACCOUNT", family: "LOW_STOCK_OR_STALE_EVIDENCE",
        evidenceFingerprint: "dry_run_no_business_mutation", stateVersion: "preview_v1",
        observedAt: new Date().toISOString(), rootCause: "STALE_EVIDENCE",
        stock: { riskClass: "STALE_EVIDENCE", exactIdentity: true },
        deepLinkPath: "/admin/ebay/operational-readiness", cooldownHours: 24,
      } })
      setWhatsappResult(result.result)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "WHATSAPP_PREVIEW_FAILED") }
    finally { setLoading(false) }
  }

  return <main className="min-h-screen bg-[#eef2f6] p-4 text-slate-950 md:p-7">
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5">
        <div><Link href="/admin/ebay/monitor" className="inline-flex items-center gap-2 text-xs font-bold text-cyan-700"><ArrowLeft size={14} />Commercial Monitor</Link><h1 className="mt-3 text-2xl font-black">Commercial operational readiness</h1><p className="mt-1 text-sm text-slate-500">Supplier evidence, Stock Guard, economics and sanitized alert dry runs. Product Case remains paused.</p></div>
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700"><ShieldCheck size={15} />READ-ONLY</span>
      </header>
      {error && <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(payload?.capabilities ?? {}).map(([key, value]) => <article key={key} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{key.replaceAll(/([A-Z])/g, " $1")}</p><p className="mt-2 text-sm font-bold text-slate-800">{String(value).replaceAll("_", " ")}</p></article>)}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-3"><FileCheck2 className="text-cyan-700" /><div><h2 className="font-black">Listing Quality Report import</h2><p className="text-xs text-slate-500">CSV/JSON human-assisted ingestion. Item ID first; unique SKU only; no fuzzy matching.</p></div></div><input type="file" accept=".csv,.json,text/csv,application/json" onChange={(event) => setQualityFile(event.target.files?.[0] ?? null)} className="mt-5 block w-full text-xs" /><button disabled={!qualityFile || loading} onClick={importQuality} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40"><Upload size={14} />Validate report</button>{qualityResult ? <pre className="mt-4 max-h-52 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] text-slate-200">{JSON.stringify(qualityResult, null, 2)}</pre> : <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Ready for a real report sample. Nothing is persisted remotely.</p>}</section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-3"><Workflow className="text-violet-700" /><div><h2 className="font-black">WhatsApp alert dry run</h2><p className="text-xs text-slate-500">Eight template families, dedupe and cooldown. Meta approval is not assumed.</p></div></div><p className="mt-5 text-sm"><strong>{payload?.templates?.length ?? 8}</strong> template contracts · NOT SUBMITTED</p><button disabled={loading} onClick={previewWhatsApp} className="mt-3 rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">Preview sanitized alert</button>{whatsappResult ? <pre className="mt-4 max-h-52 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] text-slate-200">{JSON.stringify(whatsappResult, null, 2)}</pre> : null}</section>
      </div>
      <section className="grid gap-3 md:grid-cols-3"><article className="rounded-xl border border-slate-200 bg-white p-4"><PackageSearch className="text-orange-600" size={18} /><h2 className="mt-2 text-sm font-black">Luna Capture</h2><p className="mt-1 text-xs text-slate-500">Exact product/variant evidence, source-change detection, no credential exposure.</p></article><article className="rounded-xl border border-slate-200 bg-white p-4"><ShieldCheck className="text-emerald-600" size={18} /><h2 className="mt-2 text-sm font-black">Stock Guard V2</h2><p className="mt-1 text-xs text-slate-500">Exact identity only. Unknown is not risk. Proven critical stock signals hard-override experiments.</p></article><article className="rounded-xl border border-slate-200 bg-white p-4"><Workflow className="text-cyan-700" size={18} /><h2 className="mt-2 text-sm font-black">Product Case gate</h2><p className="mt-1 text-xs text-slate-500">Paused. Supplier identity and complete economics remain evidence-gated.</p></article></section>
    </div>
  </main>
}
