"use client"

import { AlertTriangle, ArrowLeft, Box, ImageOff, Link2, PackageCheck,
  RefreshCw, ShieldCheck } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"

import type { CommercialListingReadModel, CommercialMonitorGetDto } from
  "@/lib/ebay/commercial-monitor-readonly-contract"
import {
  buildCanonicalLiveListingDashboardMetricsV1,
  selectCanonicalCurrentLiveListingsV1,
} from "@/lib/ebay/ebay-commercial-monitor-registry-presentation-v1"
import { presentSellerOsStatus } from "@/lib/seller-os/presentation"
import { supabase } from "@/lib/supabase"

type Payload = { success?: boolean; monitor?: CommercialMonitorGetDto; error?: string }
type PortfolioFilter = "ALL" | "NEEDS_SUPPLIER_LINK" | "EXACT_PROVEN" |
  "STOCK_RISK" | "STALE" | "UNKNOWN" | "ACTIONABLE"

function shown(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === "") return "No comprobado"
  if (typeof value === "boolean") return value ? "Disponible" : "No disponible"
  return String(value)
}

function exactSupplierEvidence(listing: CommercialListingReadModel) {
  return listing.stock.supplierLinkageStatus === "CERTIFIED"
}

function stockRisk(listing: CommercialListingReadModel) {
  if (!exactSupplierEvidence(listing)) return "IDENTITY_UNPROVEN"
  if (listing.stock.state === "OUT_OF_STOCK_SIGNAL") return "OUT_OF_STOCK_CONFIRMED"
  if (listing.stock.state === "STALE") return "STALE_EVIDENCE"
  if (listing.stock.state === "SOURCE_FORMAT_CHANGED") return "SOURCE_CHANGED"
  if (listing.stock.state === "STOCK_CONFLICTED") return "CONFLICT"
  if (listing.stock.state === "IN_STOCK_SIGNAL") {
    const supplierQuantity = listing.stock.quantity.value
    if (supplierQuantity === 0) return "CONFLICT"
    if (supplierQuantity !== null && Number.isInteger(supplierQuantity) &&
        supplierQuantity > 0 && supplierQuantity <= 3) return "LOW_STOCK_CONFIRMED"
    const published = listing.identity.listedQuantity
    const capacity = listing.composition.bundleCapacity.value
    if (published !== null && capacity !== null && published > capacity) return "OVERSELL_RISK"
    return "NO_PROVEN_RISK"
  }
  return "STOCK_UNKNOWN"
}

function recommendedAction(risk: string) {
  if (["OUT_OF_STOCK_CONFIRMED", "OVERSELL_RISK"].includes(risk)) return "Revisión humana requerida"
  if (risk === "LOW_STOCK_CONFIRMED") return "Revisar exposición publicada y prioridad de recaptura"
  if (["STALE_EVIDENCE", "SOURCE_CHANGED"].includes(risk)) return "Actualizar evidencia de Luna"
  if (risk === "IDENTITY_UNPROVEN") return "Capturar y aprobar un vínculo exacto del proveedor"
  if (risk === "STOCK_UNKNOWN") return "Completar evidencia de disponibilidad del proveedor"
  return "Supervisar"
}

export default function StockGuardPage() {
  const [monitor, setMonitor] = useState<CommercialMonitorGetDto | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<PortfolioFilter>("ALL")
  const load = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !data.session) throw new Error("AUTH_REQUIRED")
      const response = await fetch("/api/admin/ebay/monitor", { cache: "no-store",
        headers: { Authorization: `Bearer ${data.session.access_token}` } })
      const result = await response.json() as Payload
      if (!response.ok || !result.success || !result.monitor) {
        throw new Error(result.error ?? "STOCK_GUARD_READ_FAILED")
      }
      setMonitor(result.monitor)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "STOCK_GUARD_READ_FAILED")
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const liveListings = useMemo(() => monitor
    ? selectCanonicalCurrentLiveListingsV1(monitor) : [], [monitor])
  const rows = useMemo(() => liveListings.map((listing) => ({ listing,
    exact: exactSupplierEvidence(listing), risk: stockRisk(listing) })), [liveListings])
  const canonicalInventory = useMemo(() => monitor
    ? buildCanonicalLiveListingDashboardMetricsV1(monitor) : null, [monitor])
  const exactCount = canonicalInventory?.exactSupplierLinked ?? 0
  const needsLinkCount = canonicalInventory?.needsLinkage ?? 0
  const stockRiskCount = rows.filter((row) => ["OUT_OF_STOCK_CONFIRMED", "OVERSELL_RISK",
    "LOW_STOCK_CONFIRMED"].includes(row.risk)).length
  const staleCount = rows.filter((row) => row.risk === "STALE_EVIDENCE").length
  const unknownCount = canonicalInventory?.stockUnknown ?? 0
  const actionableCount = rows.filter((row) =>
    row.listing.stock.state !== "STOCK_UNKNOWN" &&
    row.risk !== "NO_PROVEN_RISK" && row.risk !== "STOCK_UNKNOWN").length
  const visibleRows = rows.filter((row) => filter === "ALL" ||
    filter === "NEEDS_SUPPLIER_LINK" && !row.exact ||
    filter === "EXACT_PROVEN" && row.exact ||
    filter === "STOCK_RISK" && ["OUT_OF_STOCK_CONFIRMED", "OVERSELL_RISK",
      "LOW_STOCK_CONFIRMED"].includes(row.risk) ||
    filter === "STALE" && row.risk === "STALE_EVIDENCE" ||
    filter === "UNKNOWN" && row.listing.stock.state === "STOCK_UNKNOWN" ||
    filter === "ACTIONABLE" && row.listing.stock.state !== "STOCK_UNKNOWN" &&
      row.risk !== "NO_PROVEN_RISK" && row.risk !== "STOCK_UNKNOWN")
  const filters: Array<[PortfolioFilter, string, number]> = [
    ["ALL", "Todo", rows.length], ["NEEDS_SUPPLIER_LINK", "Necesita vínculo", needsLinkCount],
    ["EXACT_PROVEN", "Exacto comprobado", exactCount], ["STOCK_RISK", "Riesgo de stock", stockRiskCount],
    ["STALE", "Evidencia vencida", staleCount], ["UNKNOWN", "Desconocido", unknownCount],
    ["ACTIONABLE", "Accionable", actionableCount],
  ]

  return <main className="min-h-screen bg-[#eef2f6] p-4 text-slate-950 md:p-7">
    <div className="mx-auto max-w-[1500px] space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5">
        <div><Link href="/admin/ebay/monitor" className="inline-flex items-center gap-2 text-sm font-bold text-cyan-700"><ArrowLeft size={14} />Monitor comercial</Link><h1 className="mt-3 text-[28px] font-black md:text-[32px]">Inventario y Stock Guard</h1><p className="mt-1 text-base text-slate-500">Evidencia exacta del proveedor vinculada a Item IDs activos autoritativos. Desconocido no equivale a riesgo.</p></div>
        <div className="flex items-center gap-2"><Link href="/admin/ebay/copilot?surface=STOCK" className="rounded-lg border border-violet-200 px-3 py-2 text-sm font-black text-violet-700">Preguntar al Copilot</Link><span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700"><ShieldCheck size={15} />Solo lectura</span><button onClick={() => void load()} disabled={loading} className="rounded-lg border border-slate-200 p-2 text-slate-600 disabled:opacity-40" aria-label="Actualizar Stock Guard"><RefreshCw size={16} /></button></div>
      </header>
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">La lectura se detuvo de forma segura: {error}</div>}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <article className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-[13px] font-black text-slate-500">Paridad canónica</p><p className={`mt-2 font-black ${canonicalInventory?.monitorAndInventoryCanonicalParity ? "text-emerald-700" : "text-amber-800"}`}>{canonicalInventory?.monitorAndInventoryCanonicalParity ? "Monitor = Inventory" : "No comprobada"}</p></article>
        <article className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-[13px] font-black text-slate-500">Publicaciones live canónicas</p><p className="mt-2 text-xl font-black">{canonicalInventory?.liveCount ?? "—"}</p></article>
        <article className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-[13px] font-black text-slate-500">Vínculo exacto certificado</p><p className="mt-2 text-xl font-black">{canonicalInventory?.exactSupplierLinked ?? "—"}</p><p className="mt-1 text-[13px] text-slate-500">supplierLinkage = CERTIFIED</p></article>
        <article className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-[13px] font-black text-slate-500">Necesita vínculo</p><p className="mt-2 text-xl font-black">{canonicalInventory?.needsLinkage ?? "—"}</p><p className="mt-1 text-[13px] text-slate-500">No se deriva de stock desconocido</p></article>
        <article className="rounded-xl border border-emerald-200 bg-white p-4"><p className="text-[13px] font-black text-emerald-800">Señal in stock</p><p className="mt-2 text-xl font-black">{canonicalInventory?.inStockSignal ?? "—"}</p><p className="mt-1 text-[13px] text-slate-500">No equivale a vínculo exacto</p></article>
        <article className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-[13px] font-black text-slate-500">Stock desconocido</p><p className="mt-2 text-xl font-black">{canonicalInventory?.stockUnknown ?? "—"}</p><p className="mt-1 text-[13px] text-slate-500">No implica acción</p></article>
        <article className="rounded-xl border border-amber-200 bg-white p-4"><p className="text-[13px] font-black text-amber-800">Mismatch de identidad</p><p className="mt-2 text-xl font-black">{canonicalInventory?.identityMismatch ?? "—"}</p><p className="mt-1 text-[13px] text-slate-500">Sólo linkage CERTIFIED</p></article>
        <article className="rounded-xl border border-cyan-200 bg-white p-4"><p className="text-[13px] font-black text-cyan-800">Live monitoreados</p><p className="mt-2 text-xl font-black">{canonicalInventory?.monitoredLive ?? "—"}</p></article>
        <article className="rounded-xl border border-violet-200 bg-white p-4"><p className="text-[13px] font-black text-violet-800">StockGuard inscritos</p><p className="mt-2 text-xl font-black">{canonicalInventory?.stockGuardEnrolled ?? "—"}</p></article>
        <article className="rounded-xl border border-cyan-200 bg-white p-4"><p className="text-[13px] font-black text-cyan-800">Accionable</p><p className="mt-2 text-xl font-black">{monitor ? actionableCount : "—"}</p><p className="mt-1 text-[13px] text-slate-500">Excluye STOCK_UNKNOWN</p></article>
      </section>
      {monitor && exactCount === 0 && <section className="rounded-2xl border border-cyan-200 bg-cyan-50 p-5"><div className="flex gap-3"><Link2 className="shrink-0 text-cyan-700" /><div><h2 className="text-lg font-black">Se requiere activar el vínculo del proveedor</h2><p className="mt-1 text-sm text-cyan-950">Los estados de stock permanecen no disponibles hasta que Luna identifique producto, variante y SKU exactos y una persona apruebe la relación con el Item ID.</p><p className="mt-3 text-sm font-bold">Siguiente acción segura: capturar una variante exacta de Luna, revisar la evidencia y aprobar el vínculo determinista. No se realiza vinculación difusa ni automática.</p></div></div></section>}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-200 px-4 py-3"><div className="flex items-center justify-between"><div><h2 className="text-lg font-black">Portafolio activo</h2><p className="text-sm text-slate-500">Una fila por Item ID autoritativo de Trading</p></div><span className="text-sm font-bold text-slate-500">{loading ? "Leyendo…" : `${visibleRows.length} de ${rows.length} publicaciones`}</span></div><div className="mt-3 flex flex-wrap gap-2" aria-label="Filtros del portafolio de Stock Guard">{filters.map(([value, label, count]) => <button type="button" key={value} onClick={() => setFilter(value)} aria-pressed={filter === value} className={`rounded-full border px-3 py-1.5 text-[13px] font-black ${filter === value ? "border-cyan-600 bg-cyan-50 text-cyan-800" : "border-slate-200 text-slate-500"}`}>{label} · {count}</button>)}</div></div>
        <div className="divide-y divide-slate-100">
          {visibleRows.map(({ listing, risk }) => {
            const hardOverride = listing.experiment.status === "AVAILABLE" &&
              listing.experiment.lifecycleState === "RUNNING" &&
              ["OUT_OF_STOCK_CONFIRMED", "OVERSELL_RISK"].includes(risk)
            return (
              <article key={listing.identity.itemId} className="grid min-h-[88px] gap-4 p-4 lg:grid-cols-[minmax(280px,1.4fr)_repeat(4,minmax(145px,1fr))]">
                <div className="flex min-w-0 gap-3">
                  {listing.identity.primaryImageUrl
                    ? <Image src={listing.identity.primaryImageUrl} alt="" width={64} height={64} unoptimized className="h-16 w-16 shrink-0 rounded-xl border border-slate-200 object-cover" />
                    : <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-400"><ImageOff size={20} /></span>}
                  <div className="min-w-0">
                    <h3 className="truncate text-[15px] font-black">{listing.identity.title ?? `Item ${listing.identity.itemId}`}</h3>
                    <p className="mt-1 text-[13px] text-slate-500">Item {listing.identity.itemId} · SKU {shown(listing.identity.sku)}</p>
                    <p className="mt-1 text-[13px] font-bold text-cyan-700">{listing.identity.primaryImageUrl ? "Imagen disponible" : "Imagen no comprobada"}</p>
                  </div>
                </div>
                <div>
                  <p className="text-[13px] font-black uppercase text-slate-400">Vínculo del proveedor</p>
                  <p className="mt-1 text-sm font-bold">{exactSupplierEvidence(listing) ? "Evidencia exacta" : "No comprobado"}</p>
                  <p className="mt-1 text-[13px] leading-5 text-slate-500">Producto {shown(listing.stock.supplierProductId)} · Variante {shown(listing.stock.supplierVariantId)} · SKU {shown(listing.stock.supplierSku)}</p>
                </div>
                <div>
                  <p className="text-[13px] font-black uppercase text-slate-400">Evidencia de stock</p>
                  <p className="mt-1 text-sm font-bold">{presentSellerOsStatus(listing.stock.state)}</p>
                  <p className="mt-1 text-[13px] leading-5 text-slate-500">Proveedor {shown(listing.stock.quantity.value)} · Publicado {shown(listing.identity.listedQuantity)} · Capacidad segura {shown(listing.composition.bundleCapacity.value)}</p>
                </div>
                <div>
                  <p className="text-[13px] font-black uppercase text-slate-400">Vigencia</p>
                  <p className="mt-1 text-sm font-bold">{presentSellerOsStatus(listing.stock.freshness.status)}</p>
                  <p className="mt-1 text-[13px] leading-5 text-slate-500">Antigüedad {shown(listing.stock.freshness.ageSeconds)} s · fuente {presentSellerOsStatus(listing.stock.sourceContractStatus)}</p>
                </div>
                <div>
                  <p className="text-[13px] font-black uppercase text-slate-400">Riesgo y acción</p>
                  <p className={`mt-1 text-sm font-black ${["OUT_OF_STOCK_CONFIRMED", "OVERSELL_RISK"].includes(risk) ? "text-rose-700" : "text-slate-700"}`}>{presentSellerOsStatus(risk)}</p>
                  <p className="mt-1 text-[13px] leading-5 text-slate-500">{recommendedAction(risk)}</p>
                  {hardOverride && <p className="mt-1 flex items-center gap-1 text-[13px] font-black text-rose-700"><AlertTriangle size={14} />Excepción crítica · revisión humana</p>}
                  <details className="mt-2"><summary className="cursor-pointer text-[13px] font-bold text-cyan-700">Ver códigos técnicos</summary><p className="mt-1 font-mono text-[13px] text-slate-500">{risk} · {listing.stock.state} · {listing.stock.sourceContractStatus}</p></details>
                </div>
              </article>
            )
          })}
          {!loading && visibleRows.length === 0 && <div className="flex items-center gap-3 p-6 text-sm text-slate-500"><Box />Ninguna publicación coincide con este filtro de evidencia.</div>}
        </div>
      </section>
      <p className="flex items-center gap-2 rounded-xl bg-slate-900 p-3 text-sm text-white"><PackageCheck size={15} />0 escrituras en eBay · 0 escrituras de inventario · 0 escrituras del registro · sólo recomendaciones</p>
    </div>
  </main>
}
