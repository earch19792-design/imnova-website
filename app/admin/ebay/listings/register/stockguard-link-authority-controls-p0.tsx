"use client"

export type StockguardLinkAuthorityReadbackP0 = {
  lifecycleState: "ACTIVE" | "SUPERSEDED" | "UNLINKED" | "INVALIDATED" | null
  stockguardEligible: boolean
  limitationCode: string | null
  conflictingLiveItemIds: string[]
  authority: null | {
    authority_id: string
    ebay_item_id: string
    ebay_sku: string
    seller_os_product_id: string
    luna_product_id: string
    luna_variant_id: string
    luna_sku: string
    supplier_quantity_required: number
    identity_preflight_status: string
    lifecycle_state: string
  }
  quarantine: null | { reason_code: string }
}

export function StockguardLinkAuthorityControlsP0(props: Readonly<{
  itemId: string
  ebaySku: string | null
  authority: StockguardLinkAuthorityReadbackP0 | null
  busy: boolean
  onVerify: () => void
  onTransition: (action: "UNLINK" | "INVALIDATE") => void
}>) {
  const link = props.authority?.authority
  return <div className="mt-5 rounded-2xl border border-cyan-200/25 bg-cyan-200/[0.06] p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100">
          Autoridad canónica de vínculo
        </p>
        <p className="mt-2 text-sm text-white/80">
          Estado: <strong>{props.authority?.lifecycleState ?? "SIN AUTORIDAD"}</strong>
          {props.authority?.quarantine
            ? ` · Cuarentena: ${props.authority.quarantine.reason_code}` : ""}
        </p>
      </div>
      <span className={`rounded-full px-3 py-2 text-xs font-black ${
        props.authority?.stockguardEligible
          ? "bg-emerald-200 text-emerald-950" : "bg-amber-100 text-amber-950"}`}>
        StockGuard {props.authority?.stockguardEligible ? "ELEGIBLE" : "UNKNOWN"}
      </span>
    </div>
    <dl className="mt-4 grid gap-2 text-xs text-white/65 md:grid-cols-2">
      <div><dt className="font-black text-white">eBay</dt><dd className="break-all">{props.itemId} · {props.ebaySku ?? "SKU UNPROVEN"}</dd></div>
      <div><dt className="font-black text-white">Seller OS product</dt><dd className="break-all">{link?.seller_os_product_id ?? "UNPROVEN"}</dd></div>
      <div><dt className="font-black text-white">Luna tuple</dt><dd className="break-all">{link ? `${link.luna_product_id} / ${link.luna_variant_id} / ${link.luna_sku}` : "UNPROVEN"}</dd></div>
      <div><dt className="font-black text-white">Pack / variante</dt><dd>{link ? `${link.supplier_quantity_required} unidad(es) · ${link.identity_preflight_status}` : "UNPROVEN"}</dd></div>
      <div className="md:col-span-2"><dt className="font-black text-white">Conflictos LIVE</dt><dd className="break-all">{props.authority?.conflictingLiveItemIds.join(", ") || "Ninguno"}</dd></div>
      <div className="md:col-span-2"><dt className="font-black text-white">Limitación</dt><dd>{props.authority?.limitationCode ?? "Ninguna"}</dd></div>
    </dl>
    <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" disabled={props.busy} onClick={props.onVerify}
        className="min-h-11 rounded-xl border border-white/25 px-4 text-xs font-black disabled:opacity-50">
        Verificar vínculo
      </button>
      {link ? <button type="button" disabled={props.busy}
        onClick={() => props.onTransition("UNLINK")}
        className="min-h-11 rounded-xl border border-amber-200/40 px-4 text-xs font-black text-amber-100 disabled:opacity-50">
        Desvincular
      </button> : null}
      {link ? <button type="button" disabled={props.busy}
        onClick={() => props.onTransition("INVALIDATE")}
        className="min-h-11 rounded-xl border border-rose-200/40 px-4 text-xs font-black text-rose-100 disabled:opacity-50">
        Invalidar vínculo
      </button> : null}
    </div>
    <p className="mt-3 text-xs text-white/45">
      Reemplazar requiere seleccionar y confirmar abajo una identidad exacta distinta; no se permite reemplazo ambiguo.
    </p>
  </div>
}
