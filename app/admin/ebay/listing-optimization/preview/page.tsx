"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"

type Json = Record<string, unknown>
const record = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {}
const label = (value: unknown) => typeof value === "string" ? value : "Sin evidencia"

function Preview() {
  const params = useSearchParams()
  const itemId = params.get("itemId") ?? ""
  const [result, setResult] = useState<Json | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    setResult(null); setError("")
    void (async () => {
      try {
        if (!/^\d{9,19}$/.test(itemId)) throw new Error("Item ID inválido")
        const session = await supabase.auth.getSession()
        if (!session.data.session) throw new Error("Sesión Admin requerida")
        const response = await fetch("/api/admin/ebay/listing-optimization", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.data.session.access_token}` },
          body: JSON.stringify({ mode: "PREPARE_PREVIEW", itemId }),
        })
        const body = await response.json()
        if (!response.ok || body.success !== true) throw new Error(
          [body.ERROR_CODE ?? body.error, body.DEPENDENCY_STAGE, body.TRACE_ID].filter(Boolean).join(" · "))
        if (!controller.signal.aborted) setResult(record(body.result))
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "No se pudo preparar el Preview")
      }
    })()
    return () => controller.abort()
  }, [itemId])
  const original = record(result?.original), preview = record(result?.preview)
  const quality = record(result?.qualityReport)
  return <main className="mx-auto max-w-5xl space-y-6 p-6 text-white">
    <Link href="/admin/ebay/listing-optimization" className="text-cyan-200 underline">Volver a optimización</Link>
    <h1 className="text-3xl font-bold">Preview de optimización</h1>
    <p className="text-white/70">Item {itemId}. Esta revisión prepara un borrador para comparar. Para guardar cambios o generar imágenes se necesita una acción independiente.</p>
    {error ? <p role="alert" className="rounded-xl border border-red-300 p-4">{error}</p> : null}
    {!result && !error ? <p aria-live="polite">Preparando evidencia y borrador…</p> : null}
    {result ? <>
      <p className="rounded-xl border border-amber-200/30 p-4">{result.status === "PREVIEW_READY" ? "Preview preparado para revisión" : "Falta evidencia para completar la optimización"}</p>
      <p>Quality: {quality.reportExists === true ? `Reporte del ${label(quality.reportDate)} · ${label(quality.freshness)}`
        : quality.reportExists === false ? "No hay un reporte válido importado" : "Lectura no disponible"}</p>
      {quality.reportExists === true ? <p className="text-sm text-white/60">Cobertura histórica: {String(record(quality.coverage).liveListingsCovered ?? "Sin evidencia")} listings. Un reporte desactualizado no habilita acciones.</p> : null}
      {Array.isArray(result.blockers) && result.blockers.length ? <ul className="list-inside list-disc text-amber-100">{result.blockers.map((code, index) => <li key={index}>{label(code)}</li>)}</ul> : null}
      {result.preview ? <section className="grid gap-6 md:grid-cols-2">{[["Paquete existente", original], ["Preview propuesto", preview]].map(([title, value]) => {
        const content = value as Json
        return <article key={String(title)} className="space-y-4 rounded-2xl border border-white/20 p-5">
          <h2 className="text-xl font-bold">{String(title)}</h2>
          <h3 className="font-semibold">{label(content.title)}</h3>
          <p className="whitespace-pre-wrap text-sm text-white/75">{label(content.description).replace(/<[^>]*>/g, " ")}</p>
          <dl className="space-y-2 text-sm">{Object.entries(record(content.itemSpecifics)).map(([name, item]) => <div key={name}><dt className="font-semibold">{name}</dt><dd>{Array.isArray(item) ? item.map(label).join(", ") : label(item)}</dd></div>)}</dl>
          <p className="text-sm text-white/60">Imágenes existentes: {Array.isArray(content.imageUrls) ? content.imageUrls.length : "Sin evidencia"}</p>
        </article>
      })}</section> : null}
      <details className="rounded-xl border border-white/15 p-4"><summary>Ver referencias y trazabilidad</summary>
        <p className="mt-3 break-all text-xs">Paquete: {label(result.sourcePackageId)}</p>
        <p className="break-all text-xs">Preview: {label(result.previewDigest)}</p>
        <p className="break-all text-xs">TRACE_ID: {label(result.TRACE_ID)}</p>
        <p className="break-all text-xs">{label(result.ERROR_CODE)} · {label(result.DEPENDENCY_STAGE)}</p>
      </details>
    </> : null}
  </main>
}

export default function ListingOptimizationPreviewPage() {
  return <Suspense fallback={<p className="p-6">Cargando Preview…</p>}><Preview /></Suspense>
}
