"use client"

import { useMemo, useState } from "react"

import { supabase } from "@/lib/supabase"
import type {
  ImageAsset,
  ListingOptimizationResult,
  ProductFacts,
  TitleCandidate,
} from "@/lib/ebay/listing-optimization/types"
import { SellerOsMobileNav } from "../components/seller-os-mobile-nav"

type JsonRecord = Record<string, unknown>
type ApiResult = {
  success?: boolean
  error?: string
  result?: ListingOptimizationResult
  files?: Record<string, string>
}

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}
}

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: name.endsWith(".md") ? "text/markdown" : "application/json" }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

const inputClass = "min-h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none focus:border-cyan-200/50"
const textAreaClass = `${inputClass} min-h-48 py-3 font-mono text-xs leading-5`

export default function EbayListingOptimizationPage() {
  const [marketReport, setMarketReport] = useState<JsonRecord | null>(null)
  const [productFacts, setProductFacts] = useState("{}")
  const [sellerProfile, setSellerProfile] = useState("{}")
  const [listingDraft, setListingDraft] = useState("{}")
  const [regulatoryData, setRegulatoryData] = useState("{}")
  const [platformConstraints, setPlatformConstraints] = useState("{}")
  const [imageAssets, setImageAssets] = useState<ImageAsset[]>([])
  const [result, setResult] = useState<ListingOptimizationResult | null>(null)
  const [files, setFiles] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [approvedTitle, setApprovedTitle] = useState("")
  const [priceApproved, setPriceApproved] = useState(false)
  const [approvedBriefs, setApprovedBriefs] = useState<number[]>([])
  const [experimentStarted, setExperimentStarted] = useState(false)

  const competitors = useMemo(() => {
    const rows = marketReport?.competitorTable
    return Array.isArray(rows) ? rows.map(object).slice(0, 10) : []
  }, [marketReport])

  async function readJsonFile(file: File) {
    return JSON.parse(await file.text()) as unknown
  }

  async function loadCompleteInput(file: File) {
    setError("")
    try {
      const input = object(await readJsonFile(file))
      setMarketReport(object(input.marketIntelligenceReport))
      setProductFacts(pretty(input.productFacts ?? {}))
      setSellerProfile(pretty(input.sellerProfile ?? {}))
      setListingDraft(pretty(input.listingDraft ?? {}))
      setRegulatoryData(pretty(input.regulatoryData ?? {}))
      setPlatformConstraints(pretty(input.platformConstraints ?? {}))
      setImageAssets(Array.isArray(input.imageAssets) ? input.imageAssets as ImageAsset[] : [])
      setResult(null)
    } catch {
      setError("El archivo de entrada no contiene JSON válido.")
    }
  }

  async function optimize() {
    if (!marketReport || loading) return
    setLoading(true)
    setError("")
    setResult(null)
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !data.session) throw new Error("Sesión Admin requerida.")
      const input = {
        marketIntelligenceReport: marketReport,
        productFacts: JSON.parse(productFacts),
        sellerProfile: JSON.parse(sellerProfile),
        listingDraft: JSON.parse(listingDraft),
        imageAssets,
        regulatoryData: JSON.parse(regulatoryData),
        platformConstraints: JSON.parse(platformConstraints),
      }
      const response = await fetch("/api/admin/ebay/listing-optimization", {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      const payload = await response.json() as ApiResult
      if (!response.ok || !payload.success || !payload.result) throw new Error(payload.error ?? "No se pudo optimizar.")
      setResult(payload.result)
      setFiles(payload.files ?? {})
      setApprovedTitle("")
      setPriceApproved(false)
      setApprovedBriefs([])
      setExperimentStarted(false)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Entrada inválida.")
    } finally {
      setLoading(false)
    }
  }

  function approveTitle(candidate: TitleCandidate) {
    setApprovedTitle(candidate.title)
    const draft = object(JSON.parse(listingDraft))
    setListingDraft(pretty({ ...draft, title: candidate.title }))
  }

  function approvePrice() {
    if (!result?.review.priceProposal) return
    const draft = object(JSON.parse(listingDraft))
    setListingDraft(pretty({ ...draft, price: result.review.priceProposal }))
    setPriceApproved(true)
  }

  function updateImageStatus(id: string, status: ImageAsset["status"]) {
    setImageAssets((current) => current.map((asset) => asset.id === id ? { ...asset, status } : asset))
  }

  return <main className="min-h-screen bg-[#05070d] px-4 pb-28 pt-5 text-white sm:px-6">
    <section className="mx-auto max-w-5xl space-y-5">
      <header className="rounded-3xl border border-violet-200/20 bg-gradient-to-br from-violet-200/[0.10] via-cyan-200/[0.05] to-black p-5 md:p-8">
        <a href="/admin/ebay-seller-os" className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 text-sm font-black">← Seller OS</a>
        <p className="mt-6 text-xs font-black uppercase tracking-[0.22em] text-violet-100/60">Evidence first · no publish</p>
        <h1 className="mt-2 text-3xl font-black md:text-5xl">eBay Listing Optimization Loop</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">Convierte Market Intelligence y hechos verificados en un listing revisable. Precio y compliance regulatorio siempre requieren aprobación humana.</p>
      </header>

      <section className="grid gap-4 rounded-3xl border border-white/10 bg-white/[0.04] p-5 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-black">Cargar entrada completa JSON
          <input type="file" accept="application/json,.json" className={inputClass} onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadCompleteInput(file) }} />
        </label>
        <label className="grid gap-2 text-sm font-black">Cargar Market Intelligence Report
          <input type="file" accept="application/json,.json" className={inputClass} onChange={(event) => { const file = event.target.files?.[0]; if (file) void readJsonFile(file).then((value) => setMarketReport(object(value))).catch(() => setError("Reporte JSON inválido.")) }} />
        </label>
        <p className="text-xs leading-5 text-white/45 md:col-span-2">El navegador no guarda estos datos en Supabase. El análisis ocurre mediante una ruta Admin autenticada y devuelve archivos descargables.</p>
      </section>

      {competitors.length > 0 && <section className="rounded-3xl border border-cyan-200/20 bg-cyan-200/[0.04] p-5">
        <h2 className="text-xl font-black">Competidores observados ({competitors.length})</h2>
        <div className="mt-4 grid gap-2">{competitors.map((row, index) => <div key={String(row.url ?? index)} className="rounded-2xl border border-white/10 bg-black/25 p-3 text-xs"><p className="font-black">{String(row.title ?? `Competidor ${index + 1}`)}</p><p className="mt-1 text-white/50">Landed: {String(row.landedPrice ?? "N/D")} · por unidad: {String(row.pricePerUnit ?? "N/D")} · evidencia cantidad: {String(row.quantityEvidence ?? "unavailable")}</p></div>)}</div>
      </section>}

      <section className="grid gap-4 md:grid-cols-2">
        <JsonEditor label="Hechos del producto · única fuente de verdad" value={productFacts} onChange={setProductFacts} />
        <JsonEditor label="Draft actual" value={listingDraft} onChange={setListingDraft} />
        <JsonEditor label="Perfil Seller" value={sellerProfile} onChange={setSellerProfile} />
        <JsonEditor label="Datos regulatorios" value={regulatoryData} onChange={setRegulatoryData} />
        <JsonEditor label="Restricciones de plataforma" value={platformConstraints} onChange={setPlatformConstraints} />
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
          <h2 className="font-black">Imágenes ({imageAssets.length})</h2>
          <div className="mt-3 grid gap-2">{imageAssets.map((asset) => <div key={asset.id} className="rounded-2xl border border-white/10 bg-black/25 p-3 text-xs"><p className="break-all font-black">{asset.id}</p><p className="mt-1 text-white/50">{asset.status}</p><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => updateImageStatus(asset.id, "approved")} className="min-h-10 rounded-xl bg-emerald-200 font-black text-black">Approve</button><button type="button" onClick={() => updateImageStatus(asset.id, "rejected")} className="min-h-10 rounded-xl border border-rose-200/30 font-black text-rose-100">Reject</button></div></div>)}</div>
        </div>
      </section>

      {error && <p role="alert" className="rounded-2xl border border-rose-200/25 bg-rose-200/[0.08] p-4 text-sm font-bold text-rose-50">{error}</p>}
      <button type="button" disabled={!marketReport || loading} onClick={() => void optimize()} className="min-h-14 w-full rounded-2xl bg-cyan-200 px-5 font-black text-black disabled:opacity-40">{loading ? "Evaluando…" : "Ejecutar Optimization Loop"}</button>

      {result && <>
        <section className="grid gap-3 sm:grid-cols-3">
          <Stat label="Listing score" value={`${result.review.score.total}/100`} tone={result.review.score.total >= 90 ? "text-emerald-200" : "text-amber-100"} />
          <Stat label="Blocking issues" value={String(result.review.blockingIssues.length)} tone={result.review.blockingIssues.length ? "text-rose-200" : "text-emerald-200"} />
          <Stat label="Iteraciones" value={String(result.optimizationHistory.length)} tone="text-cyan-100" />
        </section>

        <section className="rounded-3xl border border-rose-200/20 bg-rose-200/[0.05] p-5"><h2 className="text-xl font-black">Blocking issues</h2><div className="mt-3 grid gap-2">{result.review.blockingIssues.length ? result.review.blockingIssues.map((item) => <div key={`${item.code}:${item.field}`} className="rounded-xl border border-rose-100/15 p-3 text-sm"><p className="font-black text-rose-100">{item.code}</p><p className="mt-1 text-white/60">{item.message}</p></div>) : <p className="text-sm text-emerald-100">Sin bloqueos.</p>}</div></section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5"><h2 className="text-xl font-black">Aprobar título</h2><div className="mt-4 grid gap-3">{result.titleCandidates.map((candidate) => <button type="button" key={candidate.title} onClick={() => approveTitle(candidate)} className={`rounded-2xl border p-4 text-left ${approvedTitle === candidate.title ? "border-emerald-200 bg-emerald-200/[0.08]" : "border-white/10 bg-black/25"}`}><span className="text-xs font-black text-cyan-100">Score {candidate.score}</span><p className="mt-1 font-black">{candidate.title}</p></button>)}</div></section>

        <section className="rounded-3xl border border-amber-200/20 bg-amber-200/[0.05] p-5"><h2 className="text-xl font-black">Aprobar precio</h2><p className="mt-2 text-sm text-white/60">Actual: {result.listingDraft.price} · Propuesto: {result.review.priceProposal ?? "sin cambio"}</p><button type="button" disabled={!result.review.priceProposal || priceApproved} onClick={approvePrice} className="mt-3 min-h-11 rounded-xl bg-amber-200 px-4 font-black text-black disabled:opacity-40">{priceApproved ? "Aprobado localmente · vuelve a ejecutar" : "Aprobar propuesta de precio"}</button></section>

        <section className="rounded-3xl border border-violet-200/20 bg-violet-200/[0.04] p-5"><h2 className="text-xl font-black">Image Brief · seis imágenes</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{result.imageBrief.map((brief) => <article key={brief.imageNumber} className="rounded-2xl border border-white/10 bg-black/25 p-4"><p className="text-xs font-black text-violet-100">IMAGE {brief.imageNumber}</p><h3 className="mt-1 font-black">{brief.name}</h3><p className="mt-2 text-xs leading-5 text-white/55">{brief.composition}</p><details className="mt-2"><summary className="cursor-pointer text-xs font-black">Ver prompt</summary><p className="mt-2 text-xs leading-5 text-white/50">{brief.generationPrompt}</p></details><button type="button" onClick={() => setApprovedBriefs((current) => current.includes(brief.imageNumber) ? current.filter((value) => value !== brief.imageNumber) : [...current, brief.imageNumber])} className={`mt-3 min-h-10 w-full rounded-xl text-xs font-black ${approvedBriefs.includes(brief.imageNumber) ? "bg-emerald-200 text-black" : "border border-white/15"}`}>{approvedBriefs.includes(brief.imageNumber) ? "Prompt aprobado" : "Aprobar prompt"}</button></article>)}</div></section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5"><h2 className="text-xl font-black">Historial de optimización</h2><div className="mt-3 grid gap-2">{result.optimizationHistory.map((entry) => <div key={entry.iteration} className="rounded-xl border border-white/10 p-3 text-xs"><p className="font-black">Iteración {entry.iteration}: {entry.scoreBefore} → {entry.scoreAfter}</p><p className="mt-1 text-white/50">{entry.automaticCorrections.join(", ") || "Sin correcciones automáticas seguras"}</p><p className="mt-1 text-amber-100/70">Propuestas pendientes: {entry.approvalProposals.length}</p></div>)}</div></section>

        <section className="rounded-3xl border border-cyan-200/20 bg-cyan-200/[0.04] p-5"><h2 className="text-xl font-black">Experimento A/B · una variable</h2><p className="mt-2 text-sm font-black">{result.experimentPlan.variable}</p><p className="mt-2 text-sm leading-6 text-white/60">{result.experimentPlan.hypothesis}</p><button type="button" onClick={() => setExperimentStarted(true)} disabled={experimentStarted || result.review.blockingIssues.length > 0} className="mt-3 min-h-11 rounded-xl bg-cyan-200 px-4 font-black text-black disabled:opacity-40">{experimentStarted ? "Experimento marcado como iniciado" : "Iniciar experimento"}</button><p className="mt-2 text-xs text-white/40">Sólo crea el plan; no modifica eBay.</p></section>

        <section className="rounded-3xl border border-emerald-200/20 bg-emerald-200/[0.04] p-5"><h2 className="text-xl font-black">Archivos de salida</h2><div className="mt-4 grid gap-2 sm:grid-cols-2">{Object.entries(files).map(([name, content]) => <button type="button" key={name} onClick={() => download(name, content)} className="min-h-11 rounded-xl border border-emerald-100/20 px-3 text-sm font-black text-emerald-50">Descargar {name}</button>)}</div></section>
      </>}
    </section>
    <SellerOsMobileNav active="listings" />
  </main>
}

function JsonEditor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-2 rounded-3xl border border-white/10 bg-white/[0.04] p-5 text-sm font-black">{label}<textarea value={value} onChange={(event) => onChange(event.target.value)} className={textAreaClass} spellCheck={false} /></label>
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><p className="text-xs text-white/45">{label}</p><p className={`mt-1 text-2xl font-black ${tone}`}>{value}</p></div>
}
