"use client"

import { AlertTriangle, ArrowLeft, Box, ImageOff, Link2, PackageCheck,
  RefreshCw, ShieldCheck } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"

import type { CommercialListingReadModel, CommercialMonitorGetDto } from
  "@/lib/ebay/commercial-monitor-readonly-contract"
import { supabase } from "@/lib/supabase"

type Payload = { success?: boolean; monitor?: CommercialMonitorGetDto; error?: string }
type PortfolioFilter = "ALL" | "NEEDS_SUPPLIER_LINK" | "EXACT_PROVEN" |
  "STOCK_RISK" | "STALE" | "UNKNOWN" | "ACTIONABLE"

function shown(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === "") return "Unproven"
  if (typeof value === "boolean") return value ? "Available" : "Not available"
  return String(value)
}

function exactSupplierEvidence(listing: CommercialListingReadModel) {
  return Boolean(listing.stock.sourceContractStatus === "HEALTHY" &&
    listing.stock.supplierProductId && listing.stock.supplierVariantId &&
    listing.stock.supplierSku)
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
  if (["OUT_OF_STOCK_CONFIRMED", "OVERSELL_RISK"].includes(risk)) return "Human review required"
  if (risk === "LOW_STOCK_CONFIRMED") return "Review published exposure and recapture priority"
  if (["STALE_EVIDENCE", "SOURCE_CHANGED"].includes(risk)) return "Refresh Luna evidence"
  if (risk === "IDENTITY_UNPROVEN") return "Capture and approve an exact supplier link"
  if (risk === "STOCK_UNKNOWN") return "Complete supplier availability evidence"
  return "Monitor"
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
  const liveListings = useMemo(() => (monitor?.listings ?? []).filter((listing) =>
    listing.discovery.livePresence.status === "LIVE_ACTIVE"), [monitor])
  const rows = useMemo(() => liveListings.map((listing) => ({ listing,
    exact: exactSupplierEvidence(listing), risk: stockRisk(listing) })), [liveListings])
  const exactCount = rows.filter((row) => row.exact).length
  const needsLinkCount = rows.length - exactCount
  const stockRiskCount = rows.filter((row) => ["OUT_OF_STOCK_CONFIRMED", "OVERSELL_RISK",
    "LOW_STOCK_CONFIRMED"].includes(row.risk)).length
  const staleCount = rows.filter((row) => row.risk === "STALE_EVIDENCE").length
  const unknownCount = rows.filter((row) => row.listing.stock.state === "STOCK_UNKNOWN").length
  const actionableCount = rows.filter((row) => row.risk !== "NO_PROVEN_RISK" &&
    row.risk !== "STOCK_UNKNOWN").length
  const visibleRows = rows.filter((row) => filter === "ALL" ||
    filter === "NEEDS_SUPPLIER_LINK" && !row.exact ||
    filter === "EXACT_PROVEN" && row.exact ||
    filter === "STOCK_RISK" && ["OUT_OF_STOCK_CONFIRMED", "OVERSELL_RISK",
      "LOW_STOCK_CONFIRMED"].includes(row.risk) ||
    filter === "STALE" && row.risk === "STALE_EVIDENCE" ||
    filter === "UNKNOWN" && row.listing.stock.state === "STOCK_UNKNOWN" ||
    filter === "ACTIONABLE" && row.risk !== "NO_PROVEN_RISK" && row.risk !== "STOCK_UNKNOWN")
  const filters: Array<[PortfolioFilter, string, number]> = [
    ["ALL", "All", rows.length], ["NEEDS_SUPPLIER_LINK", "Needs supplier link", needsLinkCount],
    ["EXACT_PROVEN", "Exact proven", exactCount], ["STOCK_RISK", "Stock risk", stockRiskCount],
    ["STALE", "Stale", staleCount], ["UNKNOWN", "Unknown", unknownCount],
    ["ACTIONABLE", "Actionable", actionableCount],
  ]

  return <main className="min-h-screen bg-[#eef2f6] p-4 text-slate-950 md:p-7">
    <div className="mx-auto max-w-[1500px] space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5">
        <div><Link href="/admin/ebay/monitor" className="inline-flex items-center gap-2 text-xs font-bold text-cyan-700"><ArrowLeft size={14} />Commercial Monitor</Link><h1 className="mt-3 text-2xl font-black">Stock Guard V2</h1><p className="mt-1 text-sm text-slate-500">Exact supplier evidence joined onto authoritative live Item IDs. Unknown is not risk.</p></div>
        <div className="flex items-center gap-2"><Link href="/admin/ebay/copilot?surface=STOCK" className="rounded-lg border border-violet-200 px-3 py-2 text-xs font-black text-violet-700">Ask Copilot</Link><span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700"><ShieldCheck size={15} />READ-ONLY</span><button onClick={() => void load()} disabled={loading} className="rounded-lg border border-slate-200 p-2 text-slate-600 disabled:opacity-40" aria-label="Refresh Stock Guard"><RefreshCw size={16} /></button></div>
      </header>
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">Read stopped safely: {error}</div>}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8"><article className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-[10px] font-black uppercase text-slate-400">Stock Guard engine</p><p className="mt-2 font-black text-emerald-700">READY</p></article><article className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-[10px] font-black uppercase text-slate-400">Live listings</p><p className="mt-2 text-xl font-black">{monitor ? rows.length : "—"}</p></article><article className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-[10px] font-black uppercase text-slate-400">Exact supplier-linked</p><p className="mt-2 text-xl font-black">{monitor ? exactCount : "—"}</p></article><article className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-[10px] font-black uppercase text-slate-400">Awaiting evidence</p><p className="mt-2 text-xl font-black">{monitor ? needsLinkCount : "—"}</p><p className="mt-1 text-[9px] font-bold text-amber-700">{monitor && exactCount === 0 ? "LUNA READY BUT NOT ACTIVATED" : "LUNA LINK COVERAGE"}</p></article><article className="rounded-xl border border-rose-200 bg-white p-4"><p className="text-[10px] font-black uppercase text-rose-600">Stock risks</p><p className="mt-2 text-xl font-black">{monitor ? stockRiskCount : "—"}</p></article><article className="rounded-xl border border-amber-200 bg-white p-4"><p className="text-[10px] font-black uppercase text-amber-700">Stale evidence</p><p className="mt-2 text-xl font-black">{monitor ? staleCount : "—"}</p></article><article className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-[10px] font-black uppercase text-slate-400">Stock unknown</p><p className="mt-2 text-xl font-black">{monitor ? unknownCount : "—"}</p><p className="mt-1 text-[9px] font-bold text-slate-400">NOT A RISK</p></article><article className="rounded-xl border border-cyan-200 bg-white p-4"><p className="text-[10px] font-black uppercase text-cyan-700">Actionable</p><p className="mt-2 text-xl font-black">{monitor ? actionableCount : "—"}</p></article></section>
      {monitor && exactCount === 0 && <section className="rounded-2xl border border-cyan-200 bg-cyan-50 p-5"><div className="flex gap-3"><Link2 className="shrink-0 text-cyan-700" /><div><h2 className="font-black">Supplier activation required</h2><p className="mt-1 text-sm text-cyan-950">Stock states remain unavailable until Luna evidence identifies the exact supplier product, variant and SKU and a human approves the Item-ID relationship.</p><p className="mt-3 text-xs font-bold">Next safe action: capture one exact Luna variant, review the evidence, then approve the deterministic link. No fuzzy or automatic linkage is performed.</p></div></div></section>}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-200 px-4 py-3"><div className="flex items-center justify-between"><div><h2 className="font-black">Current live portfolio</h2><p className="text-xs text-slate-500">One row per authoritative Trading Item ID</p></div><span className="text-xs font-bold text-slate-500">{loading ? "Reading…" : `${visibleRows.length} of ${rows.length} listings`}</span></div><div className="mt-3 flex flex-wrap gap-2" aria-label="Stock Guard portfolio filters">{filters.map(([value, label, count]) => <button type="button" key={value} onClick={() => setFilter(value)} aria-pressed={filter === value} className={`rounded-full border px-3 py-1.5 text-[10px] font-black ${filter === value ? "border-cyan-600 bg-cyan-50 text-cyan-800" : "border-slate-200 text-slate-500"}`}>{label} · {count}</button>)}</div></div>
        <div className="divide-y divide-slate-100">{visibleRows.map(({ listing, risk }) => { const hardOverride = listing.experiment.status === "AVAILABLE" && listing.experiment.lifecycleState === "RUNNING" && ["OUT_OF_STOCK_CONFIRMED", "OVERSELL_RISK"].includes(risk); return <article key={listing.identity.itemId} className="grid gap-3 p-4 lg:grid-cols-[minmax(260px,1.4fr)_repeat(4,minmax(130px,1fr))]"><div className="flex min-w-0 gap-3">{listing.identity.primaryImageUrl ? <Image src={listing.identity.primaryImageUrl} alt="" width={54} height={54} unoptimized className="h-14 w-14 shrink-0 rounded-lg border border-slate-200 object-cover" /> : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400"><ImageOff size={18} /></span>}<div className="min-w-0"><h3 className="truncate text-sm font-black">{listing.identity.title ?? `Item ${listing.identity.itemId}`}</h3><p className="mt-1 text-[11px] text-slate-500">Item {listing.identity.itemId} · SKU {shown(listing.identity.sku)}</p><p className="mt-1 text-[10px] font-bold text-cyan-700">{listing.identity.primaryImageSource ?? "IMAGE UNPROVEN"}</p></div></div><div><p className="text-[9px] font-black uppercase text-slate-400">Supplier link</p><p className="mt-1 text-xs font-bold">{exactSupplierEvidence(listing) ? "EXACT EVIDENCE" : "UNPROVEN"}</p><p className="mt-1 text-[11px] text-slate-500">Product {shown(listing.stock.supplierProductId)} · Variant {shown(listing.stock.supplierVariantId)} · SKU {shown(listing.stock.supplierSku)}</p></div><div><p className="text-[9px] font-black uppercase text-slate-400">Stock evidence</p><p className="mt-1 text-xs font-bold">{listing.stock.state.replaceAll("_", " ")}</p><p className="mt-1 text-[11px] text-slate-500">Supplier {shown(listing.stock.quantity.value)} · Published {shown(listing.identity.listedQuantity)} · Safe capacity {shown(listing.composition.bundleCapacity.value)}</p></div><div><p className="text-[9px] font-black uppercase text-slate-400">Freshness</p><p className="mt-1 text-xs font-bold">{listing.stock.freshness.status}</p><p className="mt-1 text-[11px] text-slate-500">Age {shown(listing.stock.freshness.ageSeconds)} sec · source {listing.stock.sourceContractStatus}</p></div><div><p className="text-[9px] font-black uppercase text-slate-400">Risk / action</p><p className={`mt-1 text-xs font-black ${["OUT_OF_STOCK_CONFIRMED", "OVERSELL_RISK"].includes(risk) ? "text-rose-700" : "text-slate-700"}`}>{risk.replaceAll("_", " ")}</p><p className="mt-1 text-[11px] text-slate-500">{recommendedAction(risk)}</p>{hardOverride && <p className="mt-1 flex items-center gap-1 text-[10px] font-black text-rose-700"><AlertTriangle size={12} />HARD OVERRIDE · HUMAN REVIEW</p>}</div></article> })}{!loading && visibleRows.length === 0 && <div className="flex items-center gap-3 p-6 text-sm text-slate-500"><Box />No listings match this evidence filter.</div>}</div>
      </section>
      <p className="flex items-center gap-2 rounded-xl bg-slate-900 p-3 text-xs text-white"><PackageCheck size={15} />0 eBay writes · 0 Inventory writes · 0 Registry writes · recommendations only</p>
    </div>
  </main>
}
