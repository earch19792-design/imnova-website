"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { validateSellerOsSession } from "@/lib/admin-auth"

type ReportStatus = Readonly<{
  state: "MISSING" | "STALE" | "CURRENT"
  lastReportImportedAt: string | null
  reportDate: string | null
  reportFreshness: "MISSING" | "STALE" | "CURRENT"
  liveListingsCovered: number
  signalsImported: number
  signalsActionable: number
  signalsNeedEvidence: number
  nonliveRowsExcluded: number
  reminderVisible: boolean
}>

type UploadAttempt = Readonly<{
  id: string
  attemptedAt: string
  fileType: "CSV" | "XLSX" | "JSON"
  status: "FAILED_VALIDATION" | "IMPORTED"
  safeFailureCode: string | null
  technicalReasonCode: string | null
  diagnosticsCaptureStatus: "CAPTURED" | "NOT_CAPTURED_LEGACY"
  workbookSheetNames: readonly string[]
  observedHeaderNames: readonly string[]
  recognizedSheet: string | null
  headerMatchStatus: string
  rowsParsed: number
  currentLiveRowsMatched: number
  nonliveRowsExcluded: number
  validImportId: string | null
}>

function localDate(value: string | null) {
  if (!value) return "—"
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat("es", { dateStyle: "medium",
      timeStyle: "short" }).format(parsed) : value
}

async function bearer() {
  const session = await validateSellerOsSession()
  return session.authorized ? session.session?.access_token ?? null : null
}

function humanUploadFailure(code: unknown) {
  if (code === "REPORT_STRUCTURE_NOT_RECOGNIZED" ||
      code === "QUALITY_REPORT_NO_VALID_SHEET") {
    return "No pudimos encontrar la tabla de recomendaciones en este archivo de eBay. El último reporte válido sigue disponible; no se reemplazó nada."
  }
  if (code === "REPORT_FILE_TYPE_NOT_SUPPORTED" ||
      code === "QUALITY_REPORT_UNSUPPORTED_FILE_TYPE") {
    return "Este tipo de archivo no es compatible. Descarga el reporte de eBay en CSV, XLSX o JSON."
  }
  if (code === "REPORT_FILE_TOO_LARGE" ||
      code === "QUALITY_REPORT_FILE_TOO_LARGE") {
    return "El archivo es demasiado grande para validarlo de forma segura. El último reporte válido no cambió."
  }
  if (code === "REPORT_FILE_COULD_NOT_BE_READ") {
    return "No pudimos leer este archivo. Vuelve a descargarlo desde eBay; el último reporte válido no cambió."
  }
  return "Este archivo no pasó la validación. El último reporte válido sigue disponible y no se reemplazó."
}

export function OwnerListingQualityReportControl() {
  const file = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<ReportStatus | null>(null)
  const [latestAttempt, setLatestAttempt] =
    useState<UploadAttempt | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const token = await bearer()
    if (!token) return
    const response = await fetch("/api/admin/ebay/listing-quality-report", {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
    const payload = await response.json() as { success?: boolean;
      status?: ReportStatus; latestUploadAttempt?: UploadAttempt | null }
    if (response.ok && payload.success && payload.status) {
      setStatus(payload.status)
      setLatestAttempt(payload.latestUploadAttempt ?? null)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function upload(selected: File | null) {
    if (!selected) return
    setBusy(true); setMessage("Validando el reporte contra los listings LIVE…")
    try {
      const extension = selected.name.toLowerCase().split(".").pop()
      const format = extension === "xlsx" ? "XLSX" : extension === "csv"
        ? "CSV" : extension === "json" ? "JSON" : null
      if (!format) throw new Error("Formato no compatible. Usa CSV, XLSX o JSON.")
      const content = format === "XLSX"
        ? await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "")
            reader.onerror = () => reject(new Error("No se pudo leer el archivo."))
            reader.readAsDataURL(selected)
          })
        : await selected.text()
      const token = await bearer()
      if (!token) throw new Error("La sesión owner ya no está disponible.")
      const response = await fetch("/api/admin/ebay/listing-quality-report", {
        method: "POST", headers: { Authorization: `Bearer ${token}`,
          "Content-Type": "application/json" },
        body: JSON.stringify({ format, fileName: selected.name, content }) })
      const payload = await response.json() as { success?: boolean;
        status?: ReportStatus; latestUploadAttempt?: UploadAttempt | null;
        error?: string }
      if (!response.ok || !payload.success || !payload.status) {
        if (payload.status) setStatus(payload.status)
        if (payload.latestUploadAttempt) {
          setLatestAttempt(payload.latestUploadAttempt)
        }
        throw new Error(humanUploadFailure(
          payload.latestUploadAttempt?.safeFailureCode ?? payload.error))
      }
      setStatus(payload.status)
      setLatestAttempt(payload.latestUploadAttempt ?? null)
      setMessage("Listing Quality Report actualizado hoy ✓")
    } catch (error) {
      setMessage(error instanceof Error ? error.message
        : "El reporte no pasó la validación.")
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ""
    }
  }

  const current = status?.state === "CURRENT"
  const latestAttemptFailed = latestAttempt?.status === "FAILED_VALIDATION"
  return <section aria-labelledby="quality-report-owner-heading"
    data-remote-operator-upload-access="false"
    data-remote-operator-raw-report-access="false"
    className="mt-4 overflow-hidden rounded-3xl border border-[#d8cbb8]/25 bg-[#171713] shadow-[0_20px_80px_rgba(0,0,0,0.25)]">
    <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1.35fr_1fr]">
      <div className="min-w-0">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-[#b7c4a8]">Fuente oficial owner</p>
        <h2 id="quality-report-owner-heading" className="mt-2 text-xl font-black tracking-tight text-[#f4efe5] sm:text-2xl">
          IMPORTAR LISTING QUALITY REPORT
        </h2>
        <div className={`mt-4 rounded-2xl border p-4 ${latestAttemptFailed
          ? "border-[#c98268]/40 bg-[#c98268]/10"
          : current ? "border-[#9db18a]/35 bg-[#9db18a]/10"
            : "border-[#c98268]/35 bg-[#c98268]/10"}`}>
          <p className="font-black text-[#f4efe5]">{latestAttemptFailed
            ? "El último archivo no se pudo importar"
            : latestAttempt?.status === "IMPORTED"
              ? "Último archivo importado correctamente ✓"
              : current ? "Último reporte válido actualizado hoy ✓"
                : status?.state === "STALE"
                  ? "Reporte desactualizado · sube uno nuevo."
                  : "📋 Listing Quality Report pendiente"}</p>
          {latestAttemptFailed && <p className="mt-2 text-sm leading-6 text-[#d8d0c3]">
            {humanUploadFailure(latestAttempt.safeFailureCode)}
          </p>}
          {!latestAttemptFailed && !current && <p className="mt-2 text-sm leading-6 text-[#d8d0c3]">
            Sube el reporte de eBay de hoy para que Seller OS pueda convertir sus señales en tareas para Mayel.
          </p>}
          {latestAttempt && <p className="mt-2 text-xs leading-5 text-[#aaa294]">
            Último intento · {localDate(latestAttempt.attemptedAt)} · {latestAttempt.fileType}
          </p>}
          {latestAttemptFailed && <details className="mt-3 text-xs text-[#aaa294]">
            <summary className="cursor-pointer font-bold text-[#d8d0c3]">
              Detalle técnico
            </summary>
            <dl className="mt-2 grid gap-1 break-words">
              <div><dt className="inline">Código: </dt><dd className="inline font-mono">{latestAttempt.technicalReasonCode ?? "—"}</dd></div>
              <div><dt className="inline">Hojas detectadas: </dt><dd className="inline">{latestAttempt.workbookSheetNames.join(", ") || "No capturadas en este intento"}</dd></div>
              <div><dt className="inline">Hoja reconocida: </dt><dd className="inline">{latestAttempt.recognizedSheet ?? "—"}</dd></div>
              <div><dt className="inline">Headers: </dt><dd className="inline">{latestAttempt.headerMatchStatus}</dd></div>
            </dl>
          </details>}
        </div>
        <input ref={file} type="file" className="sr-only"
          accept=".csv,.xlsx,.json,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => void upload(event.target.files?.[0] ?? null)} />
        <button type="button" disabled={busy} onClick={() => file.current?.click()}
          className="mt-4 min-h-12 rounded-2xl bg-[#e7dac5] px-5 text-sm font-black tracking-wide text-[#26231f] transition hover:bg-[#f4efe5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b7c4a8] disabled:cursor-wait disabled:opacity-60">
          {busy ? "VALIDANDO…" : "SUBIR REPORTE"}
        </button>
        {message && <p role="status" className="mt-3 break-words text-sm leading-6 text-[#d8d0c3]">{message}</p>}
      </div>
      <div className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-4">
        <p className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-[#b7c4a8]">
          Último reporte válido
        </p>
        <p className="mb-3 text-sm font-bold text-[#f4efe5]">{current
          ? "Actualizado hoy ✓"
          : status?.state === "STALE" ? "Desactualizado" : "Todavía no hay un reporte válido"}</p>
      <dl className="grid min-w-0 grid-cols-2 gap-3 text-sm">
        {[
          ["Última importación", localDate(status?.lastReportImportedAt ?? null)],
          ["Fecha del reporte", status?.reportDate ?? "—"],
          ["Vigencia", status?.reportFreshness ?? "—"],
          ["Listings LIVE cubiertos", status?.liveListingsCovered ?? 0],
          ["Señales importadas", status?.signalsImported ?? 0],
          ["Señales accionables", status?.signalsActionable ?? 0],
          ["Necesitan evidencia", status?.signalsNeedEvidence ?? 0],
          ["Filas no LIVE excluidas", status?.nonliveRowsExcluded ?? 0],
        ].map(([label, value]) => <div key={String(label)} className="min-w-0 rounded-xl bg-white/[0.035] p-3">
          <dt className="text-xs leading-5 text-[#aaa294]">{label}</dt>
          <dd className="mt-1 break-words font-black text-[#f4efe5]">{value}</dd>
        </div>)}
      </dl>
      </div>
    </div>
  </section>
}
