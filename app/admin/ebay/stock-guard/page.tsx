"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"

import type { CommercialMonitorGetDto } from
  "@/lib/ebay/commercial-monitor-readonly-contract"
import { selectCanonicalCurrentLiveListingsV1 } from
  "@/lib/ebay/ebay-commercial-monitor-registry-presentation-v1"
import type { ListingCaseProjectionV1 } from
  "@/lib/ebay/seller-os-listing-registry-v1"
import { supabase } from "@/lib/supabase"

type Case = ListingCaseProjectionV1 & { case_id: string;
  last_reconciled_sweep_id: string | null }
type RegistryResponse = { success: boolean; error?: string; cases?: Case[];
  currentLiveCertified?: boolean; lastCertifiedAt?: string | null;
  currentSweepId?: string | null }
type MonitorResponse = { success: boolean; monitor?: CommercialMonitorGetDto }
type FreshnessRow = { itemId: string; sku: string | null;
  identityStatus: string | null; stockguardLinkStatus: string | null;
  linkAuthorityState: string | null; supplierLinkage: string;
  components: Array<{ supplierProductId: string | null;
    supplierVariantId: string | null; supplierSku: string | null }>;
  supplierAvailability: string; certifiedListingCapacity: number | null;
  stockGuardState: string;
  stockFreshness: "FRESH" | "STALE" | "UNKNOWN";
  stockObservedAt: string | null; stockFreshUntil: string | null;
  marketplaceWriteAuthorized: "NOT_EVALUATED" }
type FreshnessResponse = { success: boolean; listings?: FreshnessRow[];
  error?: string; sourceStatus?: { listingRegistry: string } }

function stockClass(state: string | null, quantity: number | null,
  freshness: string | null) {
  if (freshness !== "FRESH") return "UNKNOWN_STALE"
  if (state === "IN_STOCK_SIGNAL") {
    if (quantity === null) return "UNKNOWN_STALE"
    return quantity <= 3 ? "LOW_STOCK" : "SAFE"
  }
  if (state === "OUT_OF_STOCK_SIGNAL") return "LOW_STOCK"
  return "UNKNOWN_STALE"
}

export default function StockGuardPage() {
  const [registry, setRegistry] = useState<RegistryResponse | null>(null)
  const [monitor, setMonitor] = useState<CommercialMonitorGetDto | null>(null)
  const [freshness, setFreshness] = useState<FreshnessResponse | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState("ALL")
  const [origin, setOrigin] = useState("ALL")
  const [marketplace, setMarketplace] = useState("ALL")
  const [account, setAccount] = useState("ALL")
  const load = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const { data, error: authError } = await supabase.auth.getSession()
      if (authError || !data.session) throw new Error("AUTH_REQUIRED")
      const headers = { Authorization: `Bearer ${data.session.access_token}` }
      const [registryResponse, monitorResponse, freshnessResponse] = await Promise.all([
        fetch("/api/admin/ebay/listings/registry", { cache: "no-store", headers }),
        fetch("/api/admin/ebay/monitor", { cache: "no-store", headers }),
        fetch("/api/admin/ebay/stockguard-freshness", { cache: "no-store", headers }),
      ])
      const registryData = await registryResponse.json() as RegistryResponse
      if (!registryResponse.ok || !registryData.success) {
        throw new Error(registryData.error ?? "STOCKGUARD_REGISTRY_READ_FAILED")
      }
      setRegistry(registryData)
      if (monitorResponse.ok) {
        const monitorData = await monitorResponse.json() as MonitorResponse
        if (monitorData.success && monitorData.monitor) setMonitor(monitorData.monitor)
      }
      const freshnessData = await freshnessResponse.json() as FreshnessResponse
      setFreshness(freshnessResponse.ok && freshnessData.success ?
        freshnessData : null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "STOCKGUARD_READ_FAILED")
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const cases = useMemo(() => registry?.cases ?? [], [registry])
  const currentCases = cases.filter((row) => registry?.currentLiveCertified &&
    row.last_reconciled_sweep_id === registry.currentSweepId)
  const freshnessByItem = useMemo(() => new Map((freshness?.listings ?? [])
    .map((row) => [row.itemId, row])), [freshness])
  const stockByItem = useMemo(() => new Map((monitor && registry?.currentLiveCertified
    ? selectCanonicalCurrentLiveListingsV1(monitor) : []).map((listing) =>
    [listing.identity.itemId, stockClass(listing.stock.state,
      listing.stock.quantity.value,
      freshnessByItem.get(listing.identity.itemId)?.stockFreshness ?? null)])),
  [monitor, registry, freshnessByItem])
  const visible = cases.filter((row) =>
    (status === "ALL" || row.stockguard_link_status === status) &&
    (origin === "ALL" || row.origin === origin) &&
    (marketplace === "ALL" || row.marketplace_id === marketplace) &&
    (account === "ALL" || row.account_key === account))
  const linked = currentCases.filter((row) => row.stockguard_link_status.startsWith("LINKED_"))
  const currentCount = (predicate: (row: Case) => boolean) =>
    registry?.currentLiveCertified ? currentCases.filter(predicate).length : "—"
  const counts = [
    ["Total linked listings", registry?.currentLiveCertified ? linked.length : "—"],
    ["Monitoring", currentCount((row) => row.stockguard_link_status === "LINKED_MONITOR_ONLY")],
    ["Safe", registry?.currentLiveCertified ? linked.filter((row) =>
      stockByItem.get(row.ebay_item_id) === "SAFE").length : "—"],
    ["Low stock", registry?.currentLiveCertified ? linked.filter((row) =>
      stockByItem.get(row.ebay_item_id) === "LOW_STOCK").length : "—"],
    ["Unknown/stale stock", registry?.currentLiveCertified ? linked.filter((row) =>
      !stockByItem.has(row.ebay_item_id) ||
      stockByItem.get(row.ebay_item_id) === "UNKNOWN_STALE").length : "—"],
    ["Stock FRESH", currentCount((row) => row.stockguard_link_status.startsWith("LINKED_") &&
      freshnessByItem.get(row.ebay_item_id)?.stockFreshness === "FRESH")],
    ["Stock STALE", currentCount((row) => row.stockguard_link_status.startsWith("LINKED_") &&
      freshnessByItem.get(row.ebay_item_id)?.stockFreshness === "STALE")],
    ["Stock UNKNOWN", currentCount((row) => row.stockguard_link_status.startsWith("LINKED_") &&
      !["FRESH", "STALE"].includes(freshnessByItem.get(row.ebay_item_id)?.stockFreshness ?? "UNKNOWN"))],
    ["Blocked identity", currentCount((row) => row.stockguard_link_status === "BLOCKED_IDENTITY")],
    ["Needs OWNER review", currentCount((row) => row.stockguard_link_status === "NEEDS_OWNER_REVIEW")],
  ] as const

  return <main className="min-h-screen bg-slate-50 px-4 pb-28 pt-7 text-slate-900 md:px-8">
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3"><div>
        <h1 className="text-3xl font-black">StockGuard</h1>
        <p className="mt-1 text-sm text-slate-600">Una vista desde el registro canónico. El vínculo y el monitoreo no autorizan escrituras de cantidad en eBay.</p>
      </div><div className="flex gap-2"><Link href="/admin/ebay/copilot?surface=STOCK" className="rounded-lg border px-3 py-2 text-sm font-bold text-violet-800">Copilot</Link><Link href="/admin/ebay/listings" className="rounded-lg border px-3 py-2 text-sm font-bold text-cyan-800">Listings</Link>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-lg border px-3 py-2 text-sm font-bold disabled:opacity-50">Actualizar lectura</button></div></header>
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</p>}
      {!registry?.currentLiveCertified && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">LIVE actual no certificado. Los casos guardados son historial; la fecha y frescura del stock pueden verse, pero no prueban que el listing siga activo. Última certificación: {registry?.lastCertifiedAt ?? "ninguna"}.</p>}
      {!freshness && !loading && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Frescura de stock no disponible. Se muestra UNKNOWN hasta recuperar el lector canónico.</p>}
      <section aria-label="Resumen StockGuard" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {counts.map(([label, count]) => <div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-2xl font-black">{count}</p></div>)}
      </section>
      <section className="rounded-xl border bg-white">
        <div className="flex flex-wrap gap-2 border-b p-4">
          <select aria-label="Filtrar por estado" value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border px-2 py-2 text-sm">
            {["ALL", "LINKED_ACTIVE", "LINKED_MONITOR_ONLY", "BLOCKED_IDENTITY", "BLOCKED_STOCK_SOURCE", "NEEDS_OWNER_REVIEW"].map((value) => <option key={value} value={value}>{value === "ALL" ? "Todos los estados" : value}</option>)}</select>
          <select aria-label="Filtrar por origen" value={origin} onChange={(event) => setOrigin(event.target.value)} className="rounded-lg border px-2 py-2 text-sm">
            {["ALL", "SELLER_OS", "MANUAL_EBAY", "IMPORTED_LEGACY"].map((value) => <option key={value} value={value}>{value === "ALL" ? "Todos los orígenes" : value}</option>)}</select>
          <select aria-label="Filtrar por marketplace" value={marketplace} onChange={(event) => setMarketplace(event.target.value)} className="rounded-lg border px-2 py-2 text-sm"><option value="ALL">Todos los marketplaces</option>{[...new Set(cases.map((row) => row.marketplace_id))].map((value) => <option key={value} value={value}>{value}</option>)}</select>
          <select aria-label="Filtrar por seller account" value={account} onChange={(event) => setAccount(event.target.value)} className="rounded-lg border px-2 py-2 text-sm"><option value="ALL">Todas las cuentas</option>{[...new Set(cases.map((row) => row.account_key))].map((value) => <option key={value} value={value}>{value}</option>)}</select>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-left text-sm"><thead className="bg-slate-100 text-xs uppercase text-slate-600"><tr><th className="p-3">eBay Item ID / SKU</th><th className="p-3">Origen</th><th className="p-3">Identidad Luna</th><th className="p-3">StockGuard / estados</th><th className="p-3">Stock proveedor</th><th className="p-3">Observado / vence</th><th className="p-3">Frescura</th><th className="p-3">Siguiente bloqueo</th></tr></thead>
          <tbody>{visible.map((row) => {
            const current = registry?.currentLiveCertified &&
              row.last_reconciled_sweep_id === registry.currentSweepId
            const observed = freshnessByItem.get(row.ebay_item_id)
            return <tr key={row.case_id} className="border-t"><td className="p-3 font-bold">{row.ebay_item_id}<br /><span className="font-normal">{row.ebay_custom_label ?? "Sin Custom Label"}</span></td><td className="p-3">{row.origin}<br /><span className="text-xs text-slate-500">{current ? "LIVE ACTUAL" : "HISTÓRICO"}</span></td><td className="p-3 text-xs">{row.identity_status}<br />{row.supplier_sku ?? "Sin Luna"}<br />{row.luna_product_id ?? "—"} / {row.luna_variant_id ?? "—"}</td><td className="p-3 text-xs">{row.stockguard_link_status}<br />IDENTITY_LINKED={row.identity_status === "LINKED_EXACT" ? "YES" : "NO"}<br />STOCK_MONITORING_ACTIVE={observed?.linkAuthorityState === "ACTIVE" ? "YES" : "NO"}<br />STOCK_EVIDENCE_FRESH={observed?.stockFreshness === "FRESH" ? "YES" : "NO"}<br />MARKETPLACE_WRITE_AUTHORIZED=NOT_EVALUATED</td><td className="p-3">{observed?.supplierAvailability ?? "UNKNOWN"}<br /><span className="text-xs">Capacidad certificada: {observed?.certifiedListingCapacity ?? "—"}<br />{current ? stockByItem.get(row.ebay_item_id) ?? "UNKNOWN_STALE" : "NO_CURRENT_READ"}</span></td><td className="p-3 text-xs">{observed?.stockObservedAt ?? "Sin observación"}<br />{observed?.stockFreshUntil ?? "Sin vencimiento probado"}</td><td className="p-3 font-bold">{observed?.stockFreshness ?? "UNKNOWN"}</td><td className="p-3">{row.next_blocker ?? "—"}</td></tr>
          })}</tbody></table></div>
        {!loading && !visible.length && <p className="p-5 text-sm text-slate-500">No hay casos con estos filtros.</p>}
      </section>
    </div>
  </main>
}
