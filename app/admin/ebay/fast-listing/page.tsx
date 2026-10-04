"use client"

import { useCallback, useEffect, useState } from "react"
import Image from "next/image"
import { ArrowRight, Check, ExternalLink, Package, Search, ShieldCheck, Zap } from "lucide-react"
import { supabase } from "@/lib/supabase"
import type { FastField } from "@/lib/seller-os/fast-listing-v1"
import type { projectLoadedFastListingV1 } from "@/lib/seller-os/fast-listing-runtime-v1"

type View = ReturnType<typeof projectLoadedFastListingV1>
type Catalog = { product_id: string; variant_id: string; sku: string; title: string; price: number | null;
  availability: boolean | null; images: string[]; product_type: string }
const labels: Record<string, string> = { SUPPLIER_SKU: "SKU Luna", TITLE: "Nombre exacto", SOURCE_URL: "URL Luna", BRAND: "Marca",
  MODEL: "Modelo", GTIN: "UPC / GTIN", CONDITION: "Condición", SUPPLIER_COST: "Costo unitario Luna", SUPPLIER_AVAILABILITY: "Disponibilidad",
  SUPPLIER_STOCK: "Stock exacto", QUANTITY_OR_SET_COUNT: "Piezas por presentación proveedor", PACKAGE_CONTENTS: "Contenido incluido",
  VARIANT_OPTIONS: "Variación", SIZE_SET: "Tamaño", COLOR: "Color", MATERIAL: "Material", WEIGHT: "Peso", DIMENSIONS: "Dimensiones", IMAGES: "Imágenes" }
const shown = (v: unknown) => v === null || v === undefined || v === "" ? "Pendiente" : typeof v === "object" ? JSON.stringify(v) : String(v)
const usd = (v: unknown) => typeof v === "number" ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v) : "Pendiente"
async function api(params = "", body?: Record<string, unknown>) {
  const session = await supabase.auth.getSession()
  if (!session.data.session) throw Error("Inicia sesión en Seller OS para continuar.")
  const r = await fetch(`/api/admin/ebay/fast-listing${params}`, { method: body ? "POST" : "GET", cache: "no-store",
    headers: { Authorization: `Bearer ${session.data.session.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined })
  const p = await r.json(); if (!r.ok || !p.success) throw Error(p.error ?? "No se pudo cargar Fast Listing.")
  return p as { view?: View; catalog?: Catalog[] }
}
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-40"
const secondary = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-100 disabled:opacity-40"
const panel = "rounded-2xl border border-slate-700 bg-slate-900/80 p-5"

export default function FastListingPage() {
  const [catalog, setCatalog] = useState<Catalog[]>([]), [view, setView] = useState<View | null>(null)
  const [search, setSearch] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("")
  const [field, setField] = useState<FastField | null>(null), [value, setValue] = useState("")
  const [pack, setPack] = useState(2), [reason, setReason] = useState(""), [testPrice, setTestPrice] = useState("")
  const loadCatalog = useCallback(async (term = "") => { setBusy(true); setError(""); try { const p = await api(`?search=${encodeURIComponent(term)}`); setCatalog(p.catalog ?? []) }
    catch (e) { setError(e instanceof Error ? e.message : "Error de catálogo") } finally { setBusy(false) } }, [])
  useEffect(() => {
    const params = new URLSearchParams(window.location.search), id = params.get("opportunityId"), sku = params.get("sku")
    if (id) { void api(`?opportunityId=${encodeURIComponent(id)}`).then(p => setView(p.view ?? null)).catch(e => setError(e.message)) }
    else void loadCatalog(sku ?? "")
  }, [loadCatalog])
  useEffect(()=>{
    if(!view?.opportunityId || busy) return
    const timer=window.setInterval(()=>{void api(`?opportunityId=${encodeURIComponent(view.opportunityId)}`).then(p=>{if(p.view)setView(p.view)}).catch(()=>{})},30000)
    return ()=>window.clearInterval(timer)
  },[view?.opportunityId,busy])
  async function action(name: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setError("")
    try {
      const p = await api("", { action: name, opportunityId: view?.opportunityId, revision: view?.revision, ...extra })
      if (p.view) { setView(p.view); window.history.replaceState(null, "", `?opportunityId=${p.view.opportunityId}`) }
      return p.view
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo completar la acción") }
    finally { setBusy(false) }
  }
  const selected = view?.selected
  return <main className="mx-auto max-w-7xl px-4 py-8 text-slate-100 md:px-8">
    <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-cyan-200"><Zap size={16} /> Seller OS · Producto primero</div>
        <h1 className="text-3xl font-black tracking-tight">Fast Listing V1</h1><p className="mt-2 max-w-2xl text-sm text-slate-400">De un producto Luna a un borrador interno. Evidencia visible, decisiones claras y revisión humana antes de publicar.</p></div>
      <a href="/admin/ebay/quick-pick" className={secondary}>Quick Pick <ArrowRight size={16} /></a>
    </header>
    {error && <div role="alert" className="mb-5 rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">{error}</div>}
    {!view ? <section className={panel}>
      <form className="mb-6 flex gap-3" onSubmit={e => { e.preventDefault(); void loadCatalog(search) }}><label className="sr-only" htmlFor="luna-search">Producto, SKU o identificador Luna</label>
        <input id="luna-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto, SKU o identificador Luna" className="min-w-0 flex-1 rounded-xl border border-slate-600 bg-slate-950 p-3" />
        <button className={button} disabled={busy}><Search size={16} /> Buscar</button></form>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{catalog.map(p => <article key={`${p.product_id}:${p.variant_id}`} className="flex flex-col rounded-xl border border-slate-700 bg-slate-950 p-4">
        <div className="relative mb-3 h-40 overflow-hidden rounded-lg bg-white">{p.images?.[0] ? <Image src={p.images[0]} alt={p.title} fill unoptimized className="object-contain p-2" /> : <div className="grid h-full place-items-center text-slate-500"><Package size={32} /></div>}</div>
        <p className="text-xs text-cyan-200">{p.sku} · {p.product_type}</p><h2 className="mt-1 line-clamp-3 min-h-16 text-sm font-bold">{p.title}</h2>
        <p className="my-3 text-sm text-slate-400">{usd(p.price === null ? null : Number(p.price))} · {p.availability === true ? "Disponible en Luna" : p.availability === false ? "Sin stock" : "Stock pendiente"}</p>
        <button className={`${button} mt-auto`} disabled={busy} onClick={() => void action("START", { productId: p.product_id, variantId: p.variant_id, sku: p.sku })}>Evaluar y preparar borrador</button>
      </article>)}</div>{!catalog.length && !busy && <p className="py-10 text-center text-slate-400">No hay productos para esta búsqueda.</p>}
    </section> : <>
      <section className="mb-5 rounded-2xl border border-cyan-300/25 bg-cyan-300/5 p-5">
        <div className="flex flex-wrap justify-between gap-3"><div><span className="rounded-md bg-slate-800 px-2 py-1 text-xs font-bold">{view.state}</span>
          <span className="ml-2 text-xs text-amber-200">{view.marketClassification === "CONTROLLED_TEST" ? "CONTROLLED_TEST · producto sin historial probado" : view.marketClassification}</span>
          <h2 className="mt-3 text-xl font-bold">{shown(view.truth.values.TITLE)}</h2></div><button className={secondary} disabled={busy} onClick={() => { setView(null); window.history.replaceState(null, "", "/admin/ebay/fast-listing"); void loadCatalog() }}>Elegir otro producto</button></div>
        <p className="mt-3 text-sm text-slate-300">{view.explanation}</p><p className="mt-2 flex items-center gap-2 text-sm font-bold text-cyan-200"><ArrowRight size={16} /> {view.nextAction}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">{[["Presentación", selected?.presentation], ["Precio", usd(selected?.price)], ["Beneficio neto", usd(selected?.netProfit)], ["Margen", selected?.marginPercent == null ? "Pendiente" : `${selected.marginPercent.toFixed(1)}%`]].map(([label, content]) => <div key={label} className="rounded-xl bg-slate-950/60 p-3"><p className="text-xs text-slate-400">{label}</p><p className="mt-1 font-bold">{content ?? "Pendiente"}</p></div>)}</div>
      </section>
      <div className="grid items-start gap-5 lg:grid-cols-[1fr_1.25fr]">
        <section className={panel}><h3 className="mb-4 text-lg font-bold">Verdad del producto</h3><p className="mb-3 text-xs text-slate-400">Una unidad proveedor puede incluir varias piezas. Confirma esa presentación antes de preparar el borrador.</p>
          <dl className="divide-y divide-slate-800">{view.truth.fields.filter(f => labels[f.FIELD]).map(f => <div key={f.FIELD} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0"><dt className="text-xs font-semibold text-slate-400">{labels[f.FIELD]}</dt><dd className={`mt-1 break-words text-sm ${f.STATUS !== "PROVEN" ? "text-amber-200" : "text-slate-100"}`}>{f.STATUS === "MISSING" ? "Falta dato · requiere corrección humana" : shown(f.VALUE)}{f.STATUS === "STALE" ? " · dato vencido" : ""}</dd>
              <p className="mt-1 text-[10px] text-slate-500">{f.SOURCE} · {f.METHOD} · {f.OBSERVED_AT ? new Date(f.OBSERVED_AT).toLocaleString() : "Sin fecha"}</p></div>
            {!["SUPPLIER_SKU", "SOURCE_URL", "IMAGES"].includes(f.FIELD) && <button className="shrink-0 text-xs font-bold text-cyan-200" onClick={() => { setField(f); setValue(f.VALUE === null ? "" : String(f.VALUE)) }}>Corregir</button>}
          </div>)}</dl>
          {field && <form className="mt-4 rounded-xl border border-cyan-200/30 p-3" onSubmit={e => { e.preventDefault(); void action("CORRECT", { field: field.FIELD, value }).then(r => { if (r) setField(null) }) }}>
            <label htmlFor="fact-correction" className="text-xs font-bold">{labels[field.FIELD]} · dato confirmado por ti</label>
            <input id="fact-correction" value={value} onChange={e => setValue(e.target.value)} placeholder={field.FIELD === "CONDITION" ? "NEW, USED, OPEN_BOX o REFURBISHED" : field.FIELD === "SUPPLIER_AVAILABILITY" ? "AVAILABLE o OUT_OF_STOCK" : "Valor exacto observado"} className="my-2 w-full rounded-lg border border-slate-600 bg-slate-950 p-2" />
            <div className="flex gap-2"><button disabled={busy} className={button}>Guardar corrección</button><button type="button" className={secondary} onClick={() => setField(null)}>Cancelar</button></div>
          </form>}
          <button className={`${button} mt-5 w-full`} disabled={busy} onClick={() => void action("CONFIRM")}><Check size={16} /> Confirmar datos del producto</button>
          {view.identityConfirmed && <p className="mt-2 text-xs text-emerald-300">Identidad confirmada y ligada a estos datos.</p>}
        </section>
        <div className="space-y-5">
          <section className={panel}><div className="flex flex-wrap justify-between gap-3"><h3 className="text-lg font-bold">Evidencia Sold</h3><button disabled={busy} className={secondary} onClick={() => void action("RESEARCH").then(r => { const url = r?.researchPlan.publicSoldUrl; if (typeof url === "string") window.open(url, "_blank", "noopener,noreferrer") })}><Search size={16} /> Buscar comparables Sold</button></div>
            <p className="mt-2 text-xs text-slate-400">Product Research y su extensión guardan la captura. Precio activo y venta realizada se muestran por separado.</p>
            {typeof view.researchPlan.publicSoldUrl === "string" && <a href={view.researchPlan.publicSoldUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex gap-1 text-sm text-cyan-200">Abrir búsqueda pública Sold <ExternalLink size={14} /></a>}
            <div className="mt-4 space-y-3">{view.comparables.filter(c=>c.classification!=="REJECTED_COMPARABLE").slice(0,12).map(c => <article key={c.evidenceId} className="rounded-xl border border-slate-700 p-3">
              <p className="text-sm font-semibold">{shown(c.identity.productName)}</p><p className="mt-1 text-xs text-slate-400">{c.listingState} · {c.classification} · {shown(c.identity.packCount)} piezas · Precio {usd(c.realizedSoldPrice)} · Shipping {usd(c.buyerShipping)}</p>
              <p className="mt-1 text-xs text-slate-500">Venta: {shown(c.lastSoldDate)} · Precio realizado: {c.realizedPriceStatus}</p>
              <div className="mt-3 flex flex-wrap gap-2">{c.sourceLocator.startsWith("https://www.ebay.com/itm/") && <a href={c.sourceLocator} target="_blank" rel="noreferrer" className={secondary}>Ver comparable</a>}
                <button className={secondary} disabled={busy || c.listingState!=="SOLD"} onClick={() => void action("COMPARABLE", { evidenceId: c.evidenceId })}>{c.selected ? "Comparable confirmado" : "Usar como comparable"}</button>
                {c.selected && <button className={secondary} disabled={busy} onClick={() => void action("REFERENCE", { evidenceId: c.evidenceId })}>Sell one like this</button>}</div>
            </article>)}</div>
            {!view.comparables.length && <p className="my-5 text-sm text-amber-200">No se encontró comparable Sold. La falta de historial sigue visible.</p>}
            <div className="mt-4 border-t border-slate-700 pt-4"><button disabled={busy} className={secondary} onClick={() => void action("CONTROLLED_TEST")}>Registrar CONTROLLED_TEST</button>
              {view.marketClassification === "CONTROLLED_TEST" && <form className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); void action("PRICE", { price: Number(testPrice), quantity: view.selectedQuantity }) }}><input aria-label="Precio de prueba controlada" type="number" min="0.01" step="0.01" value={testPrice} onChange={e=>setTestPrice(e.target.value)} placeholder="Precio de prueba" className="min-w-0 rounded-lg border border-slate-600 bg-slate-950 p-2" /><button disabled={busy} className={secondary}>Confirmar precio</button></form>}</div>
            {typeof view.reference.url === "string" && <details className="mt-4 rounded-xl bg-slate-950 p-3"><summary className="cursor-pointer text-sm font-bold">Diferencias de la referencia frente a Product Truth</summary><p className="mt-2 text-xs text-slate-400">Los valores de la referencia no sustituyen los del producto propio.</p><pre className="my-3 max-h-56 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(view.reference.differences,null,2)}</pre><a href={view.reference.url} target="_blank" rel="noreferrer" className={secondary}>Abrir Sell one like this</a></details>}
          </section>
          <section className={panel}><h3 className="text-lg font-bold">Unidad y packs</h3><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-slate-600 text-slate-400">{["Presentación", "Piezas", "Precio", "Costo Luna", "Shipping", "Tarifa eBay", "Publicidad", "Otros", "Neto", "Margen", "Sold / estado"].map(h=><th key={h} className="whitespace-nowrap p-2">{h}</th>)}</tr></thead>
            <tbody>{view.matrix.map(o=><tr key={o.quantity} className={`border-b border-slate-800 ${o.quantity===view.selectedQuantity?"bg-cyan-300/5":""}`}><td className="p-2"><button disabled={busy} className="whitespace-nowrap font-bold text-cyan-200" onClick={()=>void action("SELECT",{quantity:o.quantity})}>{o.presentation}</button></td><td className="p-2">{shown(o.includedCount)}</td>{[o.price,o.totalLunaCost,o.shipping,o.ebayFee,o.advertising,o.otherCosts,o.netProfit].map((v,i)=><td key={i} className="whitespace-nowrap p-2">{usd(v)}</td>)}<td className="p-2">{o.marginPercent===null?"Pendiente":`${o.marginPercent.toFixed(1)}%`}</td><td className="p-2">{o.comparableCount} · {o.evidenceClass}<br />{o.status}</td></tr>)}</tbody></table></div>
            {selected?.warnings.length ? <p className="mt-3 text-sm text-amber-200">Advertencia: margen menor de 15%.</p> : null}
            <p className="mt-3 text-xs text-slate-400">Shipping independiente por presentación, capturado por Luna Shipping Capture. Las tarifas requieren la política aplicable de tu cuenta y categoría.</p>
            <form className="mt-4 grid gap-2 sm:grid-cols-[auto_1fr_auto]" onSubmit={e=>{e.preventDefault();void action("PACK",{quantity:pack,explanation:reason})}}><select aria-label="Tamaño de pack" value={pack} onChange={e=>setPack(Number(e.target.value))} className="rounded-lg border border-slate-600 bg-slate-950 p-2">{[2,3,4].map(q=><option key={q} value={q}>Pack {q}</option>)}</select><input aria-label="Evidencia o confirmación para el pack" value={reason} onChange={e=>setReason(e.target.value)} placeholder="Motivo y evidencia que confirmas" className="min-w-0 rounded-lg border border-slate-600 bg-slate-950 p-2" /><button className={secondary} disabled={busy || reason.trim().length<12}>Confirmar pack</button></form>
            <div className="mt-4 flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>void action("EVALUATE")}>Actualizar evaluación</button><button className={secondary} disabled={busy || !view.identityConfirmed} onClick={()=>void action("SHIPPING")}>Calcular shipping exacto</button></div>
            {Object.keys(view.shippingRequested).length>0 && <p className="mt-3 text-xs text-cyan-200">Solicitud durable enviada al ejecutor Luna Shipping Capture. No se realizará una compra.</p>}
          </section>
          <section className={panel}><h3 className="text-lg font-bold">Título e imágenes</h3><p className="mt-3 text-sm">{shown(view.title)}</p><div className="mt-4 grid grid-cols-3 gap-3">{view.imageAssets.slice(0,6).map((asset,i)=><div key={i} className="relative h-28 rounded-xl bg-white"><Image src={String(asset.url)} alt={`Imagen autorizada ${i+1} del producto Luna`} fill unoptimized className="object-contain p-2" /></div>)}</div>{!view.imageAssets.length && <p className="mt-3 text-sm text-amber-200">Imágenes autorizadas pendientes.</p>}<a href={view.packageId?`/admin/ebay/mayel?packageId=${view.packageId}`:"/admin/ebay/mayel"} className="mt-3 inline-block text-xs font-bold text-cyan-200">Abrir pipeline existente de imágenes</a></section>
        </div>
      </div>
      <section className={`${panel} mt-5`}><div className="flex flex-wrap justify-between gap-4"><div><h3 className="text-lg font-bold">Borrador y revisión final</h3><p className="mt-2 text-sm text-slate-400">El borrador interno puede guardar advertencias. Publicación bloqueada hasta resolver todos los requisitos.</p></div><div className="flex flex-wrap gap-2"><button disabled={busy || !view.canPrepareDraft} className={button} onClick={()=>void action("PREPARE")}>Preparar borrador</button>{view.packageId && <a href={`/admin/ebay/listing-workspace?candidate=${encodeURIComponent(view.candidateKey)}`} className={secondary}>Abrir revisión final</a>}<button disabled={busy || view.publishBlockers.some(b=>b!=="FINAL_HUMAN_REVIEW_REQUIRED")} className={secondary} onClick={()=>void action("FINAL_REVIEW")}>Confirmar revisión final</button></div></div>
        <ul className="mt-4 grid gap-2 text-xs text-amber-200 sm:grid-cols-2">{view.publishBlockers.map(b=><li key={b}>• {b}</li>)}</ul><p className="mt-4 flex items-center gap-2 text-xs text-slate-400"><ShieldCheck size={15} /> Sin compras ni publicaciones automáticas. La revisión final no ejecuta escrituras en eBay.</p>
      </section>
    </>}
    {busy && <p role="status" className="fixed bottom-5 right-5 rounded-xl bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 shadow-lg">Procesando el producto…</p>}
  </main>
}
