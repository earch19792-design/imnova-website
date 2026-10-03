"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"

import type { ListingCaseProjectionV1 } from
  "@/lib/ebay/seller-os-listing-registry-v1"
import { supabase } from "@/lib/supabase"

type Case = ListingCaseProjectionV1 & { case_id: string;
  last_reconciled_sweep_id: string | null }
type RegistryResponse = { success: boolean; error?: string; cases?: Case[];
  currentLiveCertified?: boolean; lastCertifiedAt?: string | null;
  currentSweepId?: string | null }
type FreshnessRow = { itemId: string; sku: string | null; title: string | null;
  identityStatus: string | null; stockguardLinkStatus: string | null;
  linkAuthorityState: string | null; supplierLinkage: string;
  liveStatus: string; monitoringStatus: "MONITORED" | "UNPROVEN";
  dataQualityWarnings: string[]; conflictingSupplierItemIds: string[];
  components: Array<{ supplierProductId: string | null;
    supplierVariantId: string | null; supplierSku: string | null }>;
  supplierAvailability: string; certifiedListingCapacity: number | null;
  stockGuardState: string;
  stockFreshness: "FRESH" | "STALE" | "UNKNOWN";
  stockObservedAt: string | null; stockFreshUntil: string | null;
  supplierStockQuantity: number | null; lastSuccessfulSource: string | null;
  limitationCode: string | null;
  stockProtectionStatus: string; protectionReadback: string;
  protectionConfirmedAt: string | null; ebayProtectionQuantity: number | null;
  protectionBlocker: string | null;
  marketplaceWriteAuthorized: "NOT_EVALUATED" }
type FreshnessResponse = { success: boolean; listings?: FreshnessRow[];
  error?: string; cohortComplete?: boolean;
  sourceStatus?: { listingRegistry: string } }
type ManualStockRead = { success: boolean; error?: string; eligible?: boolean;
  blocker?: string;
  item?: { itemId: string; title: string | null; supplierSku: string;
    productId: string; variantId: string; stockState: string;
    stockFreshness: string; stockObservedAt: string | null };
  luna?: { title: string | null; variantTitle: string | null;
    imageUrl: string | null; productUrl: string | null } | null }

export default function StockGuardPage() {
  const [registry, setRegistry] = useState<RegistryResponse | null>(null)
  const [freshness, setFreshness] = useState<FreshnessResponse | null>(null)
  const [error, setError] = useState("")
  const [refreshStatus, setRefreshStatus] = useState("")
  const [manualStock, setManualStock] = useState<ManualStockRead | null>(null)
  const [manualState, setManualState] = useState("IN_STOCK")
  const [manualQuantity, setManualQuantity] = useState("")
  const [manualPending, setManualPending] = useState(false)
  const [manualFeedback, setManualFeedback] = useState<{
    itemId: string; status: "SUCCESS" | "ERROR"; detail: string } | null>(null)
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
      const [registryResponse, freshnessResponse] = await Promise.all([
        fetch("/api/admin/ebay/listings/registry", { cache: "no-store", headers }),
        fetch("/api/admin/ebay/stockguard-freshness", { cache: "no-store", headers }),
      ])
      const registryData = await registryResponse.json() as RegistryResponse
      if (!registryResponse.ok || !registryData.success) {
        throw new Error(registryData.error ?? "STOCKGUARD_REGISTRY_READ_FAILED")
      }
      setRegistry(registryData)
      const freshnessData = await freshnessResponse.json() as FreshnessResponse
      setFreshness(freshnessResponse.ok && freshnessData.success ?
        freshnessData : null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "STOCKGUARD_READ_FAILED")
    } finally { setLoading(false) }
  }, [])
  const refreshStockEvidence = useCallback(async () => {
    setLoading(true); setError(""); setRefreshStatus("")
    try {
      const { data, error: authError } = await supabase.auth.getSession()
      if (authError || !data.session) throw new Error("AUTH_REQUIRED")
      const response = await fetch("/api/admin/ebay/stockguard-freshness", {
        method: "POST", cache: "no-store",
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      })
      const result = await response.json() as { success: boolean;
        error?: string; refresh?: { targetCount?: number;
          newObservationCount?: number; refreshFailedCount?: number } }
      if (!response.ok || !result.success) throw new Error(
        result.error ?? "STOCKGUARD_REFRESH_FAILED")
      setRefreshStatus(`Supplier evidence refreshed: ${result.refresh?.newObservationCount ?? 0}/${result.refresh?.targetCount ?? 0}; failed ${result.refresh?.refreshFailedCount ?? 0}.`)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "STOCKGUARD_REFRESH_FAILED")
    } finally { setLoading(false) }
  }, [load])
  const openManualStock = useCallback(async (itemId: string) => {
    setError(""); setManualStock(null); setManualFeedback(null); setManualPending(true)
    try {
      const { data } = await supabase.auth.getSession()
      if (!data.session) throw Error("AUTH_REQUIRED")
      const response = await fetch(`/api/admin/ebay/stockguard-manual-verification?itemId=${itemId}`, {
        cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}` },
      })
      const read = await response.json() as ManualStockRead
      if (!response.ok || !read.success) throw Error(read.error ?? "STOCKGUARD_MANUAL_READ_FAILED")
      setManualStock(read); setManualState("IN_STOCK"); setManualQuantity("")
      setManualFeedback({ itemId, status: read.eligible ? "SUCCESS" : "ERROR",
        detail: read.eligible ? "Exact Luna source ready for OWNER verification"
          : read.blocker ?? "STOCKGUARD_MANUAL_NOT_ELIGIBLE" })
    } catch (caught) {
      setManualFeedback({ itemId, status: "ERROR", detail: caught instanceof Error
        ? caught.message : "STOCKGUARD_MANUAL_READ_FAILED" })
    } finally { setManualPending(false) }
  }, [])
  const confirmManualStock = useCallback(async () => {
    if (!manualStock?.item?.itemId || !manualStock.eligible) return
    const itemId = manualStock.item.itemId
    setManualPending(true); setManualFeedback(null)
    try {
      const { data } = await supabase.auth.getSession()
      if (!data.session) throw Error("AUTH_REQUIRED")
      const response = await fetch("/api/admin/ebay/stockguard-manual-verification", {
        method: "POST", cache: "no-store", headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        }, body: JSON.stringify({ itemId: manualStock.item.itemId,
          stockState: manualState,
          exactQuantity: manualQuantity.trim() ? Number(manualQuantity) : null,
          quantityExplicitlyVisible: Boolean(manualQuantity.trim()),
          confirmation: "VERIFY STOCK MANUALLY" }),
      })
      const result = await response.json() as { success: boolean; error?: string;
        observationId?: string; stockState?: string; stockFreshness?: string;
        supplierStockQuantity?: number | null }
      if (!response.ok || !result.success) throw Error(result.error ?? "STOCKGUARD_MANUAL_WRITE_FAILED")
      setManualStock(null)
      await load()
      setManualFeedback({ itemId, status: "SUCCESS",
        detail: `Observation ${result.observationId ?? "—"} · ${result.stockState ?? "UNKNOWN"} · ${result.stockFreshness ?? "UNKNOWN"} · ${result.supplierStockQuantity === null
          ? "IN STOCK — quantity not provided by source" : `Quantity: ${result.supplierStockQuantity ?? "UNKNOWN"}`}` })
    } catch (caught) {
      setManualFeedback({ itemId, status: "ERROR", detail: caught instanceof Error
        ? caught.message : "STOCKGUARD_MANUAL_WRITE_FAILED" })
    } finally { setManualPending(false) }
  }, [load, manualStock, manualState, manualQuantity])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (manualStock?.item) {
      document.getElementById("manual-stock-verification")?.scrollIntoView({
        behavior: "smooth", block: "start" })
    }
  }, [manualStock])

  const cases = useMemo(() => registry?.cases ?? [], [registry])
  const currentCases = cases.filter((row) => registry?.currentLiveCertified &&
    row.last_reconciled_sweep_id === registry.currentSweepId)
  const freshnessByItem = useMemo(() => new Map((freshness?.listings ?? [])
    .map((row) => [row.itemId, row])), [freshness])
  const canonicalRows = freshness?.listings ?? []
  const caseByItem = new Map(currentCases.map((row) => [row.ebay_item_id, row]))
  const visible = canonicalRows.map((stock) => {
    const known = caseByItem.get(stock.itemId)
    return known ?? ({ case_id: `canonical:${stock.itemId}`,
      ebay_item_id: stock.itemId, ebay_title: stock.title,
      ebay_custom_label: stock.sku, origin: "IMPORTED_LEGACY",
      identity_status: stock.supplierLinkage === "CERTIFIED" ?
        "LINKED_EXACT" : "MISSING_LUNA_IDENTITY",
      stockguard_link_status: stock.supplierLinkage === "CERTIFIED" ?
        "LINKED_MONITOR_ONLY" : "BLOCKED_IDENTITY",
      supplier_sku: stock.components[0]?.supplierSku ?? null,
      luna_product_id: stock.components[0]?.supplierProductId ?? null,
      luna_variant_id: stock.components[0]?.supplierVariantId ?? null,
      next_blocker: stock.limitationCode, last_reconciled_sweep_id:
        registry?.currentSweepId ?? null, marketplace_id: "EBAY_US",
      account_key: "canonical" } as Case)
  }).filter((row) =>
    (status === "ALL" || row.stockguard_link_status === status) &&
    (origin === "ALL" || row.origin === origin) &&
    (marketplace === "ALL" || row.marketplace_id === marketplace) &&
    (account === "ALL" || row.account_key === account))
  const activeCount = freshness?.cohortComplete
    ? canonicalRows.length : null
  const certifiedRows = canonicalRows.filter((row) =>
    row.supplierLinkage === "CERTIFIED")
  const counts = [
    ["ACTIVE LISTINGS", activeCount],
    ["LINKED", activeCount === null ? null : certifiedRows.length],
    ["FRESH", activeCount === null ? null : certifiedRows.filter((row) =>
      row.stockFreshness === "FRESH").length],
    ["STALE", activeCount === null ? null : certifiedRows.filter((row) =>
      row.stockFreshness === "STALE").length],
    ["UNKNOWN", activeCount === null ? null : certifiedRows.filter((row) =>
      row.stockFreshness !== "FRESH" && row.stockFreshness !== "STALE").length],
    ["UNLINKED / BLOCKED", activeCount === null ? null
      : activeCount - certifiedRows.length],
  ] as const

  return <main className="min-h-screen bg-slate-50 px-4 pb-28 pt-7 text-slate-900 md:px-8">
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3"><div>
        <h1 className="text-3xl font-black">StockGuard</h1>
        <p className="mt-1 text-sm text-slate-600">Una vista desde el registro canónico. Solo stock agotado exacto, probado y fresco autoriza proteger con cantidad 0; el restock requiere revisión.</p>
      </div><div className="flex gap-2"><Link href="/admin/ebay/copilot?surface=STOCK" className="rounded-lg border px-3 py-2 text-sm font-bold text-violet-800">Copilot</Link><Link href="/admin/ebay/listings" className="rounded-lg border px-3 py-2 text-sm font-bold text-cyan-800">Listings</Link>
        <button type="button" onClick={() => void refreshStockEvidence()} disabled={loading} className="rounded-lg border px-3 py-2 text-sm font-bold disabled:opacity-50">Actualizar</button></div></header>
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</p>}
      {refreshStatus && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{refreshStatus}</p>}
      {manualFeedback && <p role={manualFeedback.status === "ERROR" ? "alert" : "status"}
        className={`rounded-lg border p-3 text-sm font-bold ${manualFeedback.status === "ERROR"
          ? "border-rose-200 bg-rose-50 text-rose-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
        {manualFeedback.status} · {manualFeedback.itemId} · {manualFeedback.detail}</p>}
      {!registry?.currentLiveCertified && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">LIVE actual no certificado. Los casos guardados son historial; la fecha y frescura del stock pueden verse, pero no prueban que el listing siga activo. Última certificación: {registry?.lastCertifiedAt ?? "ninguna"}.</p>}
      {!freshness && !loading && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Frescura de stock no disponible. Se muestra UNKNOWN hasta recuperar el lector canónico.</p>}
      <section aria-label="Resumen StockGuard" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {counts.map(([label, count]) => <div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-2xl font-black">{count ?? "—"}</p></div>)}
      </section>
      {manualStock?.item && <section id="manual-stock-verification" aria-label="Verify stock manually" className="rounded-xl border border-violet-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3"><h2 className="text-lg font-bold">VERIFY STOCK MANUALLY</h2><button type="button" onClick={() => setManualStock(null)} className="rounded border px-2 py-1">Close</button></div>
        <div className="mt-3 grid gap-4 md:grid-cols-2"><div><p className="font-semibold">eBay: {manualStock.item.itemId}</p><p>{manualStock.item.title}</p><p className="text-sm">{manualStock.item.stockState} · {manualStock.item.stockFreshness} · {manualStock.item.stockObservedAt ?? "No observation"}</p></div><div><p className="font-semibold">Luna: {manualStock.luna?.title ?? "Source unavailable"}</p>{manualStock.luna?.imageUrl && <img src={manualStock.luna.imageUrl} alt="Exact Luna product" className="my-2 h-28 w-28 object-contain" />}<p className="text-sm">{manualStock.item.supplierSku}<br />{manualStock.item.productId} / {manualStock.item.variantId}</p>{manualStock.luna?.productUrl && <a href={manualStock.luna.productUrl} target="_blank" rel="noreferrer" className="text-sm font-bold text-violet-700 underline">Open exact Luna source</a>}</div></div>
        {!manualStock.eligible ? <p className="mt-3 text-sm text-amber-800">{manualStock.blocker}</p> : <div className="mt-4 flex flex-wrap items-end gap-3"><label className="text-sm font-semibold">Visible source state<select value={manualState} onChange={(event) => setManualState(event.target.value)} className="mt-1 block rounded border p-2"><option value="IN_STOCK">IN_STOCK</option><option value="OUT_OF_STOCK">OUT_OF_STOCK</option></select></label><label className="text-sm font-semibold">Exact numeric quantity, only if visibly shown<input type="number" min="0" max="1000000" step="1" value={manualQuantity} onChange={(event) => setManualQuantity(event.target.value)} className="mt-1 block rounded border p-2" placeholder="Leave blank if not shown" /></label><button type="button" onClick={() => void confirmManualStock()} disabled={manualPending} className="rounded bg-violet-700 px-4 py-2 font-bold text-white disabled:opacity-50">Confirm visible Luna stock</button></div>}
        <p className="mt-2 text-xs text-slate-600">OWNER observation expires under the existing StockGuard policy. This provenance does not authorize an automatic eBay quantity write.</p>
      </section>}
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
            const current = freshness?.cohortComplete === true
            const observed = freshnessByItem.get(row.ebay_item_id)
            const currentLive = current && observed?.liveStatus === "LIVE_ACTIVE"
            const linkedNow = observed?.supplierLinkage === "CERTIFIED"
            const freshnessLabel = linkedNow
              ? observed.stockFreshness : "UNLINKED / BLOCKED"
            const quantityLabel = observed?.supplierStockQuantity !== null &&
              observed?.supplierStockQuantity !== undefined
              ? `Quantity: ${observed.supplierStockQuantity}`
              : observed?.supplierAvailability === "IN_STOCK"
                ? "IN STOCK — quantity not provided by source" : "Quantity: UNKNOWN"
            return <tr key={row.case_id} className="border-t"><td className="p-3 font-bold">{row.ebay_item_id}<br /><span className="font-normal">{observed?.title ?? row.ebay_title ?? "Título pendiente"}<br />{row.ebay_custom_label ?? "Sin Custom Label"}</span></td><td className="p-3">{row.origin}<br /><span className="text-xs text-slate-500">{currentLive ? "LIVE ACTUAL" : "CURRENT LIVE UNPROVEN"}</span></td><td className="p-3 text-xs">{linkedNow ? "CERTIFIED" : "UNPROVEN"}<br />{observed?.components[0]?.supplierSku ?? row.supplier_sku ?? "Sin Luna"}<br />{observed?.components[0]?.supplierProductId ?? row.luna_product_id ?? "—"} / {observed?.components[0]?.supplierVariantId ?? row.luna_variant_id ?? "—"}</td><td className="p-3 text-xs">{linkedNow ? "LINKED" : row.stockguard_link_status}<br />IDENTITY_PROVEN={linkedNow ? "YES" : "NO"}<br />STOCK_MONITORING_ACTIVE={linkedNow && observed?.monitoringStatus === "MONITORED" ? "YES" : "NO"}<br />STOCK_EVIDENCE_FRESH={linkedNow && observed?.stockFreshness === "FRESH" ? "YES" : "NO"}<br />{observed?.stockProtectionStatus ?? "NOT_PROTECTED"}<br />Protection readback: {observed?.protectionReadback ?? "UNCONFIRMED"}<br />eBay protection quantity: {observed?.ebayProtectionQuantity ?? "—"}<br />Protection confirmed: {observed?.protectionConfirmedAt ?? "—"}<br />MARKETPLACE_QUANTITY_WRITE_AUTHORIZED={observed?.marketplaceWriteAuthorized ?? "NOT_EVALUATED"}</td><td className="p-3">{observed?.supplierAvailability ?? "UNKNOWN"}<br /><span className="text-xs">{quantityLabel}<br />Certified capacity: {observed?.certifiedListingCapacity ?? "—"}<br />{current ? observed?.stockGuardState ?? "STOCK_UNKNOWN" : "NO_CURRENT_READ"}</span></td><td className="p-3 text-xs">{linkedNow ? observed?.stockObservedAt ?? "Sin observación" : "—"}<br />{linkedNow ? observed?.stockFreshUntil ?? "Sin vencimiento probado" : "—"}</td><td className={`p-3 font-bold ${freshnessLabel === "STALE" ? "text-rose-700" : ""}`}>{freshnessLabel}<br /><span className="text-xs font-normal">Source: {observed?.lastSuccessfulSource ?? "UNKNOWN"}</span></td><td className="p-3">{observed?.protectionBlocker ?? observed?.limitationCode ?? row.next_blocker ?? "—"}{observed?.dataQualityWarnings?.includes("DUPLICATE_CUSTOM_LABEL") && <p className="mt-1 text-xs font-bold text-amber-700">DATA QUALITY WARNING: duplicate Custom Label</p>}{observed?.conflictingSupplierItemIds?.length ? <p className="mt-1 text-xs font-bold text-rose-700">SUPPLIER IDENTITY CONFLICT: {observed.conflictingSupplierItemIds.join(", ")}</p> : null}{currentLive && linkedNow && (observed?.stockFreshness === "STALE" || observed?.stockFreshness === "UNKNOWN") && <button type="button" onClick={() => void openManualStock(row.ebay_item_id)} disabled={manualPending} className="mt-2 block rounded border border-violet-500 px-2 py-1 text-xs font-bold text-violet-800 disabled:opacity-50">VERIFY STOCK MANUALLY</button>}{manualFeedback?.itemId === row.ebay_item_id && <p role={manualFeedback.status === "ERROR" ? "alert" : "status"} className={`mt-2 text-xs font-bold ${manualFeedback.status === "ERROR" ? "text-rose-700" : "text-emerald-700"}`}>{manualFeedback.status}: {manualFeedback.detail}</p>}</td></tr>
          })}</tbody></table></div>
        {!loading && !visible.length && <p className="p-5 text-sm text-slate-500">No hay casos con estos filtros.</p>}
      </section>
    </div>
  </main>
}
