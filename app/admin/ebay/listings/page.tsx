"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import type { ListingCaseProjectionV1 } from
  "@/lib/ebay/seller-os-listing-registry-v1"

type Case = ListingCaseProjectionV1 & { case_id: string;
  last_reconciled_sweep_id: string | null }
type ReviewCase = { itemId: string; customLabel: string | null;
  currentTitle: string | null; origin: string; identitySource: string;
  classification: string;
  reasonCode: string; recommendedOwnerAction: string;
  conflictingItemIds: string[]; candidates: Array<{ productId: string;
    variantId: string; sku: string; opportunityId: string | null;
    source: string; preflightStatus: string | null }> }
type RegistryResponse = { success: boolean; error?: string; cases?: Case[];
  failedOperation?: string | null; errorDetail?: string | null;
  currentLiveCertified?: boolean; lastCertifiedLiveCount?: number | null;
  lastCertifiedAt?: string | null; durableReadback?: string;
  currentSweepId?: string | null; currentLiveCaseCount?: number | null }
  & { reviewQueue?: ReviewCase[]; reviewSweepId?: string | null }

function show(value: string | null | undefined) { return value || "Por verificar" }

export default function ListingsPage() {
  const [data, setData] = useState<RegistryResponse | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [itemId, setItemId] = useState("")
  const [linkItemId, setLinkItemId] = useState("")
  const [opportunityId, setOpportunityId] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [filter, setFilter] = useState("ALL")
  const request = useCallback(async (action?: string, ebayItemId?: string,
    selectedOpportunityId?: string) => {
    setBusy(true); setError("")
    try {
      const { data: session, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !session.session) throw new Error("AUTH_REQUIRED")
      const response = await fetch("/api/admin/ebay/listings/registry", {
        method: action ? "POST" : "GET", cache: "no-store",
        headers: { Authorization: `Bearer ${session.session.access_token}`,
          ...(action ? { "Content-Type": "application/json" } : {}) },
        body: action ? JSON.stringify({ action, ebayItemId,
          opportunityId: selectedOpportunityId,
          confirmation: action === "link_existing" ? "VINCULAR_IDENTIDAD_CANONICA" : undefined }) : undefined,
      })
      const result = await response.json() as RegistryResponse
      if (!response.ok || !result.success) {
        const detail = [result.failedOperation, result.errorDetail]
          .filter(Boolean).join(" · ")
        throw new Error([result.error ?? "LISTING_REGISTRY_READ_FAILED", detail]
          .filter(Boolean).join(" · "))
      }
      if (action) {
        const refreshed = await fetch("/api/admin/ebay/listings/registry", {
          cache: "no-store", headers: {
            Authorization: `Bearer ${session.session.access_token}` },
        })
        const readback = await refreshed.json() as RegistryResponse
        if (!refreshed.ok || !readback.success) throw new Error("LISTING_REGISTRY_DURABLE_READBACK_FAILED")
        setData(readback)
      } else setData(result)
      if (action === "import_existing" && ebayItemId) setLinkItemId(ebayItemId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "LISTING_REGISTRY_READ_FAILED")
    } finally { setBusy(false) }
  }, [])
  useEffect(() => { void request() }, [request])
  const currentCases = useMemo(() => (data?.cases ?? []).filter((row) =>
    data?.currentLiveCertified && row.last_reconciled_sweep_id === data.currentSweepId), [data])
  const rows = useMemo(() => (data?.cases ?? []).filter((row) =>
    filter === "ALL" || row.identity_status === filter ||
    row.stockguard_link_status === filter), [data, filter])
  const counts = useMemo(() => {
    const cases = currentCases
    return { linked: cases.filter((row) => row.identity_status === "LINKED_EXACT").length,
      ambiguous: cases.filter((row) => ["AMBIGUOUS", "DUPLICATE_IDENTITY",
        "NEEDS_OWNER_REVIEW"].includes(row.identity_status)).length,
      missing: cases.filter((row) => row.identity_status === "MISSING_LUNA_IDENTITY").length,
      stockguard: cases.filter((row) => row.stockguard_link_status.startsWith("LINKED_")).length }
  }, [currentCases])
  return <main className="min-h-screen bg-slate-50 px-4 pb-28 pt-7 text-slate-900 md:px-8">
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-3xl font-black">Listings</h1>
          <p className="mt-1 text-sm text-slate-600">Un caso por cuenta e Item ID. Importación y StockGuard comparten identidad; ninguna acción aquí publica ni cambia cantidades.</p></div>
        <button type="button" disabled={busy} onClick={() => void request("reconcile_current_live")}
          className="rounded-lg bg-cyan-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {busy ? "Leyendo eBay…" : "Reconciliar LIVE oficial"}</button>
      </header>
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</p>}
      {!data?.currentLiveCertified && <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>LIVE actual pendiente de certificación.</strong> Los casos guardados se muestran como historial.
        {data?.lastCertifiedLiveCount != null && <> Última cohorte: {data.lastCertifiedLiveCount} · {show(data.lastCertifiedAt)}.</>}
      </section>}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Resumen de reconciliación">
        {[["Casos exactos", counts.linked], ["Revisión de identidad", counts.ambiguous],
          ["Sin Luna", counts.missing], ["StockGuard vinculado", counts.stockguard]].map(([label, value]) =>
          <div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-2xl font-black">{data?.currentLiveCertified ? value : "—"}</p></div>)}
      </section>
      <section id="identity-review" className="overflow-hidden rounded-xl border bg-white">
        <div className="border-b p-4"><h2 className="text-lg font-black">Revisión de identidad · {data?.reviewQueue?.length ?? 0}</h2>
          <p className="text-sm text-slate-600">Casos pendientes del barrido certificado {show(data?.reviewSweepId)}. Los candidatos muestran evidencia exacta; no crean vínculos automáticamente.</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-600"><tr>
            <th className="p-3">Item ID</th><th className="p-3">Custom Label / SKU</th>
            <th className="p-3">Título oficial del barrido</th><th className="p-3">Origen</th>
            <th className="p-3">Candidatos exactos</th><th className="p-3">Bloqueo</th>
            <th className="p-3">Acción OWNER</th>
          </tr></thead>
          <tbody>{(data?.reviewQueue ?? []).map((row) => <tr key={row.itemId} className="border-t align-top">
            <td className="p-3 font-bold">{row.itemId}</td>
            <td className="p-3">{show(row.customLabel)}</td>
            <td className="p-3">{row.currentTitle ?? "Título oficial pendiente de captura"}</td>
            <td className="p-3">{row.origin}<br /><span className="text-xs text-slate-500">{row.identitySource}</span></td>
            <td className="p-3 text-xs">{row.candidates.length ? row.candidates.map((candidate) =>
              <div key={`${candidate.productId}:${candidate.variantId}:${candidate.sku}`} className="mb-2">
                {candidate.sku}<br />{candidate.productId} / {candidate.variantId}<br />
                {candidate.source} · {show(candidate.preflightStatus)}
              </div>) : "Ninguno probado"}
              {row.conflictingItemIds.length > 0 && <div>Item IDs en conflicto: {row.conflictingItemIds.join(", ")}</div>}</td>
            <td className="p-3"><strong>{row.classification}</strong><br />{row.reasonCode}</td>
            <td className="p-3">{row.recommendedOwnerAction}
              {row.reasonCode === "EXACT_CANDIDATE_REQUIRES_GUARDED_LINK" &&
                row.candidates.length === 1 && row.candidates[0].opportunityId &&
                <a href="#link-identity" onClick={() => {
                  setLinkItemId(row.itemId)
                  setOpportunityId(row.candidates[0].opportunityId ?? "")
                  setConfirmed(false)
                }} className="mt-2 block font-bold text-cyan-800">Preparar vínculo exacto</a>}
            </td>
          </tr>)}</tbody>
        </table></div>
      </section>
      <section id="import-existing" className="rounded-xl border bg-white p-5">
        <h2 className="text-lg font-black">Link / Import Existing eBay Listing</h2>
        <p className="mt-1 text-sm text-slate-600">Lee Item ID, vendedor, estado y Custom Label desde eBay. Si falta identidad Luna, guarda el caso para revisión.</p>
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => {
          event.preventDefault(); void request("import_existing", itemId)
        }}>
          <label className="sr-only" htmlFor="existing-item-id">eBay Item ID</label>
          <input id="existing-item-id" value={itemId} onChange={(event) => setItemId(event.target.value.trim())}
            inputMode="numeric" pattern="[0-9]{9,20}" required placeholder="eBay Item ID"
            className="min-w-56 rounded-lg border px-3 py-2 text-sm" />
          <button disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Leer e importar</button>
        </form>
      </section>
      <section id="link-identity" className="rounded-xl border bg-white p-5">
        <h2 className="text-lg font-black">Vincular identidad canónica</h2>
        <p className="mt-1 text-sm text-slate-600">Selecciona el Item ID importado y una oportunidad canónica exacta. El flujo existente verifica la cuenta, el Custom Label y la identidad Luna antes de activar el vínculo.</p>
        <form className="mt-3 space-y-3" onSubmit={(event) => {
          event.preventDefault()
          if (confirmed) void request("link_existing", linkItemId, opportunityId)
        }}>
          <div className="flex flex-wrap gap-2"><input aria-label="eBay Item ID para vincular" value={linkItemId}
            onChange={(event) => setLinkItemId(event.target.value.trim())}
            inputMode="numeric" pattern="[0-9]{9,20}" required placeholder="eBay Item ID"
            className="min-w-56 rounded-lg border px-3 py-2 text-sm" />
          <input aria-label="Opportunity ID canónico" value={opportunityId}
            onChange={(event) => setOpportunityId(event.target.value.trim())}
            pattern="[0-9a-fA-F-]{36}" required placeholder="Opportunity ID canónico"
            className="min-w-72 rounded-lg border px-3 py-2 text-sm" /></div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
            Confirmo que seleccioné la oportunidad exacta para este Item ID.</label>
          <button disabled={busy || !confirmed} className="rounded-lg bg-cyan-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Verificar y vincular</button>
        </form>
      </section>
      <section className="overflow-hidden rounded-xl border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <h2 className="text-lg font-black">Registro canónico · {rows.length} de {data?.cases?.length ?? 0} casos guardados{data?.currentLiveCertified ? ` · ${currentCases.length} LIVE` : ""}</h2>
          <select aria-label="Filtrar listings" value={filter} onChange={(event) => setFilter(event.target.value)} className="rounded-lg border px-3 py-2 text-sm">
            {[["ALL", "Todos"], ["LINKED_EXACT", "Exactos"], ["LINKABLE_EXACT", "Vinculables"],
              ["AMBIGUOUS", "Ambiguos"], ["DUPLICATE_IDENTITY", "Duplicados"],
              ["MISSING_LUNA_IDENTITY", "Sin Luna"], ["NEEDS_OWNER_REVIEW", "Revisión OWNER"],
              ["LINKED_ACTIVE", "StockGuard activo"], ["LINKED_MONITOR_ONLY", "Sólo monitoreo"]].map(([value, label]) =>
              <option key={value} value={value}>{label}</option>)}</select>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-600"><tr>
            <th className="p-3">eBay Item ID</th><th className="p-3">Título</th><th className="p-3">Custom Label / SKU</th>
            <th className="p-3">Caso / producto</th><th className="p-3">Luna</th>
            <th className="p-3">Origen / estado</th><th className="p-3">Identidad</th>
            <th className="p-3">StockGuard</th><th className="p-3">Siguiente bloqueo</th>
          </tr></thead>
          <tbody>{rows.map((row) => <tr key={row.case_id} className="border-t align-top">
            <td className="p-3 font-bold">{row.ebay_item_id}</td>
            <td className="p-3">{show(row.ebay_title)}</td>
            <td className="p-3">{show(row.ebay_custom_label)}</td>
            <td className="p-3 text-xs">{row.case_id}<br />Oportunidad {show(row.opportunity_id)}<br />Paquete {show(row.listing_package_id)}</td>
            <td className="p-3 text-xs">Producto {show(row.luna_product_id)}<br />Variante {show(row.luna_variant_id)}<br />SKU {show(row.supplier_sku)}</td>
            <td className="p-3">{row.origin}<br /><span className="text-xs text-slate-500">{data?.currentLiveCertified && row.last_reconciled_sweep_id === data.currentSweepId ? "LIVE ACTUAL" : "HISTÓRICO"}</span></td>
            <td className="p-3 font-bold">{row.identity_status}</td>
            <td className="p-3">{row.stockguard_link_status}</td>
            <td className="p-3">{show(row.next_blocker)}{row.next_blocker &&
              <a href="#link-identity" onClick={() => setLinkItemId(row.ebay_item_id)}
                className="mt-1 block font-bold text-cyan-800">Seleccionar identidad OWNER</a>}</td>
          </tr>)}</tbody>
        </table></div>
        {!busy && rows.length === 0 && <p className="p-5 text-sm text-slate-500">No hay casos con ese filtro.</p>}
      </section>
    </div>
  </main>
}
