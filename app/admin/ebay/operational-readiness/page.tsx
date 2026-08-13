"use client"

import { AlertTriangle, ArrowLeft, ChevronRight, FileCheck2, MessageCircle,
  PackageSearch, ShieldCheck, Upload, Warehouse, Workflow } from "lucide-react"
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
  result?: Record<string, unknown>; error?: string; diagnosis?: Record<string, unknown> }
type HumanPreview = { title?: string; subject?: string; problem?: string; evidence?: string;
  recommendedAction?: string; observedAt?: string; deepLinkLabel?: string; deepLink?: string }

const QUALITY_ERRORS: Record<string, string> = {
  UNSUPPORTED_FILE_TYPE: "Tipo de archivo no soportado. Usa el XLSX original de eBay, CSV o JSON.",
  WORKBOOK_UNREADABLE: "El archivo parece XLSX, pero el libro no se pudo leer de forma segura.",
  NO_DATA_SHEET_FOUND: "El libro fue reconocido, pero no contiene una hoja de datos utilizable.",
  HEADER_ROW_NOT_FOUND: "No se localizó una fila de encabezados reconocible en el rango inspeccionado.",
  ITEM_ID_COLUMN_NOT_FOUND: "No se encontró Item ID ni una identidad de listing determinista.",
  LISTING_IDENTITY_UNPROVEN: "Las filas no permiten asociar listings con Item ID o SKU único.",
  RECOMMENDATION_COLUMNS_NOT_FOUND: "La hoja no contiene recomendaciones ni benchmarks reconocibles.",
  BENCHMARK_COLUMNS_NOT_FOUND: "No se encontraron columnas de benchmark; no se fabricarán valores.",
  MULTIPLE_CANDIDATE_SHEETS: "Varias hojas parecen contener el reporte. Se requiere revisión humana.",
  HUMAN_SELECTION_REQUIRED: "Una o más hojas contienen evidencia útil, pero ninguna puede elegirse automáticamente con confianza suficiente. Selecciona una hoja de la lista explicada.",
  NO_VALID_SHEET: "El libro fue reconocido, pero ninguna hoja contiene identidad y guía suficientes para una importación segura.",
  MALFORMED_WORKBOOK: "El libro contiene una estructura no permitida o potencialmente activa.",
  FILE_TOO_LARGE: "El archivo excede los límites seguros de tamaño o descompresión.",
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  const chunks: string[] = []
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)))
  }
  return btoa(chunks.join(""))
}

export default function OperationalReadinessPage() {
  const [payload, setPayload] = useState<ReadinessPayload | null>(null)
  const [qualityFile, setQualityFile] = useState<File | null>(null)
  const [qualityResult, setQualityResult] = useState<Record<string, unknown> | null>(null)
  const [whatsappResults, setWhatsappResults] = useState<Record<string,
    Record<string, unknown>>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [qualityDiagnosis, setQualityDiagnosis] = useState<Record<string, unknown> | null>(null)

  async function request(body?: unknown) {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !data.session) throw new Error("AUTH_REQUIRED")
    const response = await fetch("/api/admin/ebay/operational-readiness", { method: body ? "POST" : "GET",
      cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`,
        ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined })
    const result = await response.json() as ReadinessPayload
    if (!response.ok || !result.success) {
      const requestError = new Error(result.error ?? "READINESS_READ_FAILED") as Error &
        { diagnosis?: Record<string, unknown> }
      requestError.diagnosis = result.diagnosis
      throw requestError
    }
    return result
  }

  useEffect(() => { request().then(setPayload).catch((caught) =>
    setError(caught instanceof Error ? caught.message : "READINESS_READ_FAILED")) }, [])

  async function importQuality(selectedWorksheet?: string) {
    if (!qualityFile) return
    setLoading(true); setError(""); setQualityDiagnosis(null); setQualityResult(null)
    try {
      const xlsx = qualityFile.name.toLowerCase().endsWith(".xlsx")
      const content = xlsx ? arrayBufferToBase64(await qualityFile.arrayBuffer())
        : await qualityFile.text()
      const result = await request({ action: "IMPORT_QUALITY_REPORT", input: {
        format: xlsx ? "XLSX" : qualityFile.name.toLowerCase().endsWith(".json") ? "JSON" : "CSV",
        fileName: qualityFile.name, content, selectedWorksheet: selectedWorksheet || null } })
      setQualityResult(result.result ?? null)
    } catch (caught) {
      const typed = caught as Error & { diagnosis?: Record<string, unknown> }
      setError(QUALITY_ERRORS[typed.message] ?? typed.message ?? "QUALITY_IMPORT_FAILED")
      setQualityDiagnosis(typed.diagnosis ?? null)
    } finally { setLoading(false) }
  }

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

  const qualityPreview = qualityResult?.preview as Record<string, unknown> | undefined
  const workbook = qualityResult?.workbook as Record<string, unknown> | undefined
  const association = qualityResult?.association as Record<string, unknown> | undefined
  const lowStockPreview = whatsappResults.LOW_STOCK_CONFIRMED?.humanPreview as HumanPreview | undefined
  const stalePreview = whatsappResults.STALE_EVIDENCE?.humanPreview as HumanPreview | undefined

  return <main className="min-h-screen bg-[#eef2f6] p-4 text-slate-950 md:p-7">
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5">
        <div><Link href="/admin/ebay/monitor" className="inline-flex items-center gap-2 text-sm font-bold text-cyan-700"><ArrowLeft size={14} />Monitor comercial</Link><h1 className="mt-3 text-[28px] font-black md:text-[32px]">Estado del sistema</h1><p className="mt-1 text-base text-slate-500">Evidencia de calidad, Luna Portex, Stock Guard, economía y notificaciones. Product Case permanece en pausa.</p></div>
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700"><ShieldCheck size={15} />Solo lectura</span>
      </header>
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><strong>La validación se detuvo de forma segura.</strong> {error}{qualityDiagnosis && <details className="mt-2"><summary className="cursor-pointer font-bold">Ver detalle técnico</summary><dl className="mt-2 grid gap-1 text-[13px] sm:grid-cols-2">{Object.entries(qualityDiagnosis).filter(([key]) => key !== "candidateSheets").map(([key, value]) => <div key={key}><dt className="font-mono font-bold">{key}</dt><dd>{Array.isArray(value) ? value.join(", ") : String(value)}</dd></div>)}</dl></details>}</div>}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(payload?.capabilities ?? {}).map(([key, value]) => <article key={key} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-[13px] font-black text-slate-500">{presentSellerOsCapability(key)}</p><p className="mt-2 text-base font-bold text-slate-800">{presentSellerOsStatus(String(value))}</p></article>)}
      </section>
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-3"><FileCheck2 className="text-cyan-700" /><div><h2 className="text-lg font-black">Informe de calidad</h2><p className="text-sm text-slate-500">Archivo original de eBay en XLSX, CSV o JSON. Primero Item ID; SKU único sólo cuando es determinista; sin coincidencias difusas.</p></div></div>
          <input type="file" aria-label="Seleccionar informe de calidad" accept=".xlsx,.csv,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/json" onChange={(event) => setQualityFile(event.target.files?.[0] ?? null)} className="mt-5 block w-full text-sm" />
          <button disabled={!qualityFile || loading} onClick={() => void importQuality()} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"><Upload size={14} />Validar y previsualizar</button>
          {qualityDiagnosis?.sheetResolutionState === "HUMAN_SELECTION_REQUIRED" && Array.isArray(qualityDiagnosis.candidateSheets) ? <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-black text-amber-900">Se requiere elegir una hoja</p><p className="mt-1 text-sm text-amber-800">Elige entre las hojas mejor clasificadas por su estructura. Seller OS nunca seleccionará silenciosamente una hoja de baja confianza.</p><div className="mt-3 grid gap-2">{(qualityDiagnosis.candidateSheets as Array<Record<string, unknown>>).map((candidate) => <button key={String(candidate.sheetName)} type="button" disabled={loading} onClick={() => void importQuality(String(candidate.sheetName))} className="rounded-lg border border-amber-200 bg-white p-3 text-left transition hover:border-cyan-500 disabled:opacity-50"><span className="flex items-center justify-between gap-3"><strong className="text-base">{String(candidate.sheetName)}</strong><span className="rounded-full bg-cyan-50 px-2 py-1 text-[13px] font-black text-cyan-800">{String(candidate.confidence)} % de confianza</span></span><span className="mt-1 block text-sm text-slate-600">{String(candidate.recognizedRowCount)} filas reconocidas · {(candidate.recognizedKeyColumns as string[] | undefined)?.join(" · ") || "columnas de identidad no comprobadas"}</span><details className="mt-1 text-[13px] text-slate-500"><summary>Ver razones técnicas</summary>{(candidate.reasonCodes as string[] | undefined)?.join(" · ")}</details></button>)}</div></section> : null}
          {qualityResult ? <div className="mt-4 space-y-3"><div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-sm font-black text-emerald-800">Validado · listo para importar</p><p className="mt-1 text-base font-bold">{String(qualityResult.fileName)}</p><dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">Hoja</dt><dd className="font-bold">{String(workbook?.selectedWorksheet ?? "No aplica")}</dd></div><div><dt className="text-slate-500">Fila de encabezados</dt><dd className="font-bold">{String(workbook?.headerRowNumber ?? "—")}</dd></div><div><dt className="text-slate-500">Filas reconocidas</dt><dd className="font-bold">{String(qualityPreview?.normalizedRows ?? qualityResult.rowCount)}</dd></div><div><dt className="text-slate-500">Recomendaciones</dt><dd className="font-bold">{(qualityPreview?.recommendationCategories as string[] | undefined)?.join(", ") || "Reconocidas sin etiquetas de categoría"}</dd></div><div><dt className="text-slate-500">Benchmark</dt><dd className="font-bold">{qualityPreview?.benchmarkAvailable ? "Disponible" : "No suministrado"}</dd></div><div><dt className="text-slate-500">Top 10 %</dt><dd className="font-bold">{qualityPreview?.topTenBenchmarkAvailable ? "Disponible" : "No suministrado"}</dd></div></dl></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-sm font-black">Vista previa de asociaciones</p><p className="mt-2 text-sm text-slate-600">{String(association?.reportRows ?? 0)} filas · {String(association?.matchedItemId ?? 0)} por Item ID · {String(association?.matchedUniqueSku ?? 0)} por SKU único · {String(association?.unresolved ?? 0)} sin resolver · {String(association?.ambiguous ?? 0)} ambiguas</p><p className="mt-1 text-sm font-bold">Partición {association?.partitionValid ? "válida" : "no comprobada"} · no se guardó nada de forma remota.</p></div><details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-bold text-slate-600">Ver detalle técnico del parser</summary><pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-200">{JSON.stringify(qualityResult, null, 2)}</pre></details></div> : <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Carga el archivo original de Seller Hub. El libro se inspecciona como datos inertes y nunca se ejecuta.</p>}
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-3"><MessageCircle className="text-violet-700" /><div><h2 className="text-lg font-black">Vista previa humana de WhatsApp</h2><p className="text-sm text-slate-500">Simulación para diseñar plantillas. La aprobación de Meta y los envíos permanecen desactivados.</p></div></div>
          <div className="mt-4 flex flex-wrap gap-2"><button disabled={loading} onClick={() => void previewWhatsApp("LOW_STOCK_CONFIRMED")} className="min-h-11 rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Previsualizar stock bajo confirmado</button><button disabled={loading} onClick={() => void previewWhatsApp("STALE_EVIDENCE")} className="min-h-11 rounded-lg border border-violet-300 px-4 py-2 text-sm font-bold text-violet-800 disabled:opacity-40">Previsualizar evidencia vencida</button></div>
          {[lowStockPreview, stalePreview].filter(Boolean).map((humanPreview) => <article key={humanPreview?.title} className="mt-4 overflow-hidden rounded-2xl border border-emerald-200 bg-[#e9f7ef]"><div className="bg-[#075e54] px-4 py-2 text-sm font-black text-white">Ejemplo de plantilla · sin envío</div><div className="m-3 rounded-xl bg-white p-4 shadow-sm"><p className="text-sm font-black text-rose-700">{humanPreview?.title}</p><h3 className="mt-1 font-black">{humanPreview?.subject}</h3><p className="mt-3 text-sm">{humanPreview?.problem}</p><p className="mt-2 text-[13px] text-slate-500">{humanPreview?.evidence}</p><p className="mt-3 text-sm font-semibold">{humanPreview?.recommendedAction}</p><span className="mt-4 inline-flex rounded-lg border border-emerald-700 px-3 py-2 text-sm font-black text-emerald-800">{humanPreview?.deepLinkLabel}</span></div></article>)}
          {Object.keys(whatsappResults).length > 0 && <details className="mt-3 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-bold text-slate-600">Ver JSON técnico de la simulación</summary><pre className="mt-3 max-h-52 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-200">{JSON.stringify(whatsappResults, null, 2)}</pre></details>}
        </section>
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-black">Revisión de plantillas de Meta · 8 familias</h2><p className="mt-1 text-[13px] text-slate-500">Todos los ejemplos están sanitizados, no son operativos y no se han enviado.</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-[13px] font-black text-amber-700">Envío desactivado</span></div><div className="mt-4 grid gap-3 lg:grid-cols-2">{payload?.templates?.map((template, index) => <details key={template.internalTemplateKey} className="rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer list-none"><div className="flex items-start justify-between gap-3"><div><p className="text-[13px] font-black text-slate-400">{index + 1} · {template.categorySuggestion} · {template.language}</p><h3 className="mt-1 text-base font-black">{template.humanTitle}</h3><p className="mt-1 text-[13px] text-slate-500">{template.intendedMetaTemplateName}</p></div><ChevronRight size={16} className="text-slate-400" /></div></summary><div className="mt-3 border-t border-slate-100 pt-3 text-[13px]"><p><strong>Variables:</strong> {template.variableSchema.join(" · ")}</p><p className="mt-2 rounded-lg bg-slate-50 p-3"><strong>{template.examplePayload.classification}</strong><br />{Object.entries(template.examplePayload.values).map(([key, value]) => `${key}: ${value}`).join(" · ")}</p>{template.humanReviewStates?.length ? <div className="mt-2 grid gap-2">{template.humanReviewStates.map((example) => <p key={example.state} className="rounded-lg border border-violet-100 p-3"><strong>{example.state}</strong><br />{Object.entries(example.values).map(([key, value]) => `${key}: ${value}`).join(" · ")}</p>)}</div> : null}<details className="mt-2 text-slate-500"><summary className="cursor-pointer font-bold text-cyan-700">Ver estado técnico</summary><p className="mt-1 font-mono">{template.piiClassification} · {template.approvalStatus} · dispatchAllowed=false</p></details></div></details>)}</div></section>
      <section className="grid gap-3 md:grid-cols-3"><Link href="/admin/ebay/luna-capture" className="rounded-xl border border-orange-200 bg-white p-4 transition hover:border-orange-400"><PackageSearch className="text-orange-600" size={18} /><h2 className="mt-2 text-base font-black">Abrir captura de Luna</h2><p className="mt-1 text-sm text-slate-500">El espacio de activación está listo. Producto y variante exactos requieren aprobación antes de persistir.</p></Link><Link href="/admin/ebay/stock-guard" className="rounded-xl border border-emerald-200 bg-white p-4 transition hover:border-emerald-400"><Warehouse className="text-emerald-600" size={18} /><h2 className="mt-2 text-base font-black">Abrir Inventario y Stock Guard</h2><p className="mt-1 text-sm text-slate-500">Revisión por publicación. Desconocido no equivale a riesgo.</p></Link><article className="rounded-xl border border-slate-200 bg-white p-4"><Workflow className="text-cyan-700" size={18} /><h2 className="mt-2 text-base font-black">Control de Product Case</h2><p className="mt-1 text-sm text-slate-500">En pausa. La identidad del proveedor y la economía completa siguen limitadas por evidencia.</p></article></section>
      <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><AlertTriangle size={15} />Este espacio no permite persistencia remota, escrituras de marketplace, envíos de WhatsApp ni mutaciones de Product Case.</p>
    </div>
  </main>
}
