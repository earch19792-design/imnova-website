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

export function OwnerListingQualityReportControl() {
  const file = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<ReportStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const token = await bearer()
    if (!token) return
    const response = await fetch("/api/admin/ebay/listing-quality-report", {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
    const payload = await response.json() as { success?: boolean;
      status?: ReportStatus }
    if (response.ok && payload.success && payload.status) setStatus(payload.status)
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
        status?: ReportStatus; error?: string }
      if (!response.ok || !payload.success || !payload.status) {
        throw new Error(payload.error ?? "El reporte no pasó la validación.")
      }
      setStatus(payload.status)
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
        <div className={`mt-4 rounded-2xl border p-4 ${current
          ? "border-[#9db18a]/35 bg-[#9db18a]/10"
          : "border-[#c98268]/35 bg-[#c98268]/10"}`}>
          <p className="font-black text-[#f4efe5]">{current
            ? "Listing Quality Report actualizado hoy ✓"
            : status?.state === "STALE"
              ? "Reporte desactualizado · sube uno nuevo."
              : "📋 Listing Quality Report pendiente"}</p>
          {!current && <p className="mt-2 text-sm leading-6 text-[#d8d0c3]">
            Sube el reporte de eBay de hoy para que Seller OS pueda convertir sus señales en tareas para Mayel.
          </p>}
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
      <dl className="grid min-w-0 grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm">
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
  </section>
}
