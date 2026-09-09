"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { validateSellerOsSession } from "@/lib/admin-auth"
import { QualityUploadErrorV1, submitQualityUploadV1, qualityUploadCodeV1,
  qualityUploadFailureMessageV1,
  type QualityUploadTrace } from "@/lib/ebay/ebay-listing-quality-upload-transport-v1"

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
  recognizedSheetNames: readonly string[]
  recognizedSheetCount: number
  headerMatchStatus: string
  failedStage: string
  requestTransportClass: string
  requestContentTypeClass: string
  fileSizeClass: string
  mimeTypeClass: string
  deploymentId: string
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
  return session.authorized && session.role === "OWNER_ADMIN"
    ? session.session?.access_token ?? null : null
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
  const [loadDiagnostic, setLoadDiagnostic] = useState<string | null>(null)
  const [uploadTrace, setUploadTrace] = useState<QualityUploadTrace | null>(null)

  const load = useCallback(async () => {
    try {
    const token = await bearer()
    if (!token) {
      setMessage(qualityUploadFailureMessageV1("QUALITY_REPORT_OWNER_AUTH_REQUIRED"))
      return
    }
    const response = await fetch("/api/admin/ebay/listing-quality-report", {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
    const payload = await response.json() as { success?: boolean;
      status?: ReportStatus; latestUploadAttempt?: UploadAttempt | null; error?: string }
    if (response.ok && payload.success && payload.status) {
      setStatus(payload.status)
      setLatestAttempt(payload.latestUploadAttempt ?? null)
    } else {
      const code = qualityUploadCodeV1(payload.error, `QUALITY_REPORT_HTTP_${response.status}`)
      setMessage(qualityUploadFailureMessageV1(code))
      setLoadDiagnostic(`${code} · HTTP ${response.status}`)
    }
    } catch {
      setMessage("No se pudo consultar el último reporte.")
      setLoadDiagnostic("QUALITY_REPORT_STATUS_READ_FAILED")
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function upload(selected: File | null) {
    if (!selected) return
    setBusy(true); setUploadTrace(null)
    setMessage("Validando el reporte contra los listings LIVE…")
    try {
      const result = await submitQualityUploadV1({ file: selected,
        ownerToken: bearer, request: fetch, read: async (format) => format === "XLSX"
        ? await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "")
            reader.onerror = () => reject(new Error("No se pudo leer el archivo."))
            reader.readAsDataURL(selected)
          })
        : await selected.text() })
      const payload = result.payload as { success?: boolean;
        status?: ReportStatus; latestUploadAttempt?: UploadAttempt | null;
        error?: string }
      setUploadTrace(result.trace)
      setStatus(payload.status ?? null)
      setLatestAttempt(payload.latestUploadAttempt ?? null)
      setMessage(payload.status?.reportFreshness === "CURRENT"
        ? "Listing Quality Report actualizado hoy ✓"
        : "Archivo importado ✓. La fecha del último reporte válido sigue desactualizada.")
    } catch (error) {
      if (error instanceof QualityUploadErrorV1) {
        setUploadTrace(error.trace)
        const payload = error.payload as { status?: ReportStatus;
          latestUploadAttempt?: UploadAttempt | null } | null
        if (payload?.status) setStatus(payload.status)
        if (payload?.latestUploadAttempt) setLatestAttempt(payload.latestUploadAttempt)
      }
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
    data-remote-operator-upload-access="false" data-remote-operator-raw-report-access="false"
    className="mt-4 rounded-2xl border bg-white p-5 text-slate-800">
    <h2 id="quality-report-owner-heading" className="text-xl font-semibold">Último reporte</h2>
    <p className="mt-2">{current ? "CURRENT" : status?.state === "STALE" ? "STALE" : "Pendiente"} · {status?.reportDate ?? "Sin fecha"}</p>
    <p>{status?.liveListingsCovered ?? "—"} listings analizados · {status?.signalsImported ?? "—"} recomendaciones</p>
    {latestAttemptFailed && <p role="alert">{humanUploadFailure(latestAttempt.safeFailureCode)}</p>}
    <input ref={file} type="file" className="sr-only" disabled={busy} aria-label="Archivo Listing Quality Report"
      accept=".csv,.xlsx,.json,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      onChange={(event) => void upload(event.target.files?.[0] ?? null)} />
    <button type="button" disabled={busy} onClick={() => file.current?.click()}
      className="mt-3 min-h-11 rounded-xl border bg-[#dcebdc] px-4 font-semibold disabled:opacity-50">
      {busy ? "Validando…" : "Actualizar reporte"}
    </button>
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    <details className="mt-3 text-xs"><summary>Ver detalles</summary>
      <p>Última importación: {localDate(status?.lastReportImportedAt ?? null)}</p>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap">{JSON.stringify({ status, latestAttempt, uploadTrace, loadDiagnostic }, null, 2)}</pre>
    </details>
  </section>
}
