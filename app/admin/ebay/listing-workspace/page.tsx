"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { supabase } from "@/lib/supabase"

type Opportunity = {
  id: string
  candidate_key: string
  product_title: string
  variant_title: string | null
  supplier_sku: string | null
  supplier_price: number | null
  supplier_inventory_quantity: number | null
  supplier_snapshot_at: string | null
  opportunity_score: number
  demand_score: number
  economics_score: number
  identity_score: number
  hard_gates: string[]
  evidence_guards: string[]
}

type ListingPackage = {
  id: string
  opportunity_id: string
  candidate_key: string
  status: string
  package_data: Record<string, unknown>
  readiness: number
  source_observed_at: string | null
  updated_at: string
}

type FormState = {
  title: string
  categoryId: string
  categoryName: string
  description: string
  imageUrls: string[]
  aspects: Record<string, string>
  pricing: { currency: string; supplierCost: number | null; targetPrice: number | null; estimatedNetProfit: number | null }
  shipping: Record<string, unknown>
}

const emptyForm: FormState = {
  title: "",
  categoryId: "",
  categoryName: "",
  description: "",
  imageUrls: [],
  aspects: {},
  pricing: { currency: "USD", supplierCost: null, targetPrice: null, estimatedNetProfit: null },
  shipping: {},
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function fromPackage(value: Record<string, unknown>): FormState {
  const pricing = object(value.pricing)
  const aspects = object(value.aspects)
  return {
    title: String(value.title ?? ""),
    categoryId: String(value.categoryId ?? ""),
    categoryName: String(value.categoryName ?? ""),
    description: String(value.description ?? ""),
    imageUrls: Array.isArray(value.imageUrls) ? value.imageUrls.filter((item): item is string => typeof item === "string") : [],
    aspects: Object.fromEntries(Object.entries(aspects).map(([key, item]) => [key, String(item ?? "")])),
    pricing: {
      currency: String(pricing.currency ?? "USD"),
      supplierCost: Number.isFinite(Number(pricing.supplierCost)) ? Number(pricing.supplierCost) : null,
      targetPrice: Number.isFinite(Number(pricing.targetPrice)) ? Number(pricing.targetPrice) : null,
      estimatedNetProfit: Number.isFinite(Number(pricing.estimatedNetProfit)) ? Number(pricing.estimatedNetProfit) : null,
    },
    shipping: object(value.shipping),
  }
}

export default function EbayListingWorkspacePage() {
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null)
  const [listingPackage, setListingPackage] = useState<ListingPackage | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [message, setMessage] = useState("Cargando datos reales del producto…")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [aspectName, setAspectName] = useState("")
  const [aspectValue, setAspectValue] = useState("")

  const request = useCallback(async (body?: Record<string, unknown>, opportunityId?: string) => {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !data.session) throw new Error("La sesión Admin expiró.")
    const endpoint = body
      ? "/api/admin/ebay/command-center"
      : `/api/admin/ebay/command-center?opportunity=${encodeURIComponent(opportunityId ?? "")}`
    const response = await fetch(endpoint, {
      method: body ? "POST" : "GET",
      cache: "no-store",
      headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const payload = await response.json()
    if (!response.ok || !payload.success) throw new Error(payload.error ?? "No se pudo abrir el workspace.")
    return payload
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const opportunityId = params.get("opportunity") ?? ""
    const candidateKey = params.get("candidate") ?? ""
    if (!opportunityId || !candidateKey) {
      setError("Abre este workspace desde una oportunidad de Seller Command Center.")
      setMessage("")
      return
    }
    void (async () => {
      try {
        const state = await request(undefined, opportunityId)
        const selected = state.selectedOpportunity as Opportunity
        const prepared = await request({ action: "prepare_package", opportunityId, candidateKey })
        const nextPackage = prepared.listingPackage as ListingPackage
        setOpportunity(selected)
        setListingPackage(nextPackage)
        setForm(fromPackage(object(nextPackage.package_data)))
        setMessage(prepared.created ? "Paquete interno creado con la evidencia más reciente." : "Continuaste el paquete guardado anteriormente.")
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "No se pudo abrir el workspace.")
        setMessage("")
      }
    })()
  }, [request])

  const blockers = useMemo(() => [
    ...(!form.title ? ["Falta título"] : []),
    ...(!form.categoryId ? ["Falta categoría"] : []),
    ...(!form.description ? ["Falta descripción"] : []),
    ...(!form.imageUrls.length ? ["Faltan imágenes"] : []),
    ...(!(Number(form.pricing.targetPrice) > 0) ? ["Falta precio"] : []),
    ...(opportunity?.hard_gates ?? []),
    ...(opportunity?.evidence_guards ?? []),
  ], [form, opportunity])

  async function save(markReady = false) {
    if (!opportunity || !listingPackage) return
    setBusy(true); setError(""); setMessage(markReady ? "Verificando paquete…" : "Guardando…")
    try {
      if (markReady && blockers.length) throw new Error(`Todavía hay ${blockers.length} bloqueos por resolver.`)
      const payload = await request({
        action: "save_package",
        opportunityId: opportunity.id,
        candidateKey: opportunity.candidate_key,
        packageId: listingPackage.id,
        packageData: form,
        markReady,
      })
      setListingPackage(payload.listingPackage)
      setMessage(markReady
        ? "Paquete listo para revisión humana. No se creó ni publicó nada en eBay."
        : `Guardado en servidor · ${new Intl.DateTimeFormat("es", { timeStyle: "short" }).format(new Date(payload.savedAt))}`)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo guardar.")
      setMessage("")
    } finally { setBusy(false) }
  }

  return (
    <main className="min-h-screen bg-[#05070d] px-4 pb-32 pt-4 text-white sm:px-6">
      <section className="mx-auto max-w-xl space-y-4">
        <header className="sticky top-0 z-30 -mx-4 border-b border-white/10 bg-[#05070d]/95 px-4 pb-3 pt-2 backdrop-blur">
          <a href="/admin/ebay/mobile-review" className="inline-flex min-h-11 items-center rounded-full border border-white/20 px-4 text-sm font-bold">← Command Center</a>
          <p className="mt-3 text-xs font-black uppercase tracking-widest text-emerald-100/70">Paso 4 · Listing interno</p>
          <h1 className="mt-1 text-2xl font-black">Workspace del producto</h1>
        </header>

        {error && <p role="alert" className="rounded-2xl border border-rose-200/30 bg-rose-200/[0.08] p-4 text-sm font-bold text-rose-50">{error}</p>}
        {message && <p aria-live="polite" className="rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.06] p-3 text-sm text-cyan-50">{message}</p>}

        {opportunity && listingPackage && <>
          <section className="rounded-3xl border border-emerald-200/25 bg-emerald-200/[0.06] p-4">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase text-emerald-100/65">Datos reales de Luna + evidencia eBay</p><h2 className="mt-2 text-xl font-black">{opportunity.product_title}</h2><p className="mt-1 text-sm text-white/60">{opportunity.variant_title ?? "Variante general"} · {opportunity.supplier_sku ?? "SKU pendiente"}</p></div><strong className="rounded-2xl bg-white px-3 py-2 text-xl text-black">{Math.round(Number(opportunity.opportunity_score))}</strong></div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs"><div><dt className="text-white/50">Costo Luna</dt><dd className="font-black">{opportunity.supplier_price == null ? "Pendiente" : `$${Number(opportunity.supplier_price).toFixed(2)}`}</dd></div><div><dt className="text-white/50">Stock</dt><dd className="font-black">{opportunity.supplier_inventory_quantity ?? "Pendiente"}</dd></div><div><dt className="text-white/50">Fuente</dt><dd className="font-black">{listingPackage.source_observed_at ? new Date(listingPackage.source_observed_at).toLocaleDateString("es") : "Pendiente"}</dd></div></dl>
          </section>

          <section className="space-y-4 rounded-3xl border border-white/15 bg-white/[0.04] p-4">
            <label className="block"><span className="font-black">Título eBay · máximo 80 caracteres</span><input value={form.title} maxLength={80} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-4" /><span className="mt-1 block text-right text-xs text-white/50">{form.title.length}/80</span></label>
            <div className="grid gap-3 sm:grid-cols-2"><label><span className="font-black">Category ID</span><input inputMode="numeric" value={form.categoryId} onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value.replace(/\D/g, "") }))} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-4" /></label><label><span className="font-black">Categoría</span><input value={form.categoryName} onChange={(event) => setForm((current) => ({ ...current, categoryName: event.target.value }))} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-4" /></label></div>
            <label className="block"><span className="font-black">Precio objetivo USD</span><input inputMode="decimal" value={form.pricing.targetPrice ?? ""} onChange={(event) => setForm((current) => ({ ...current, pricing: { ...current.pricing, targetPrice: event.target.value ? Number(event.target.value) : null } }))} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-4" /></label>
            <label className="block"><span className="font-black">Descripción original</span><textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={8} className="mt-2 w-full rounded-2xl border border-white/20 bg-black/30 p-4" /></label>
          </section>

          <section className="rounded-3xl border border-violet-200/20 bg-violet-200/[0.05] p-4">
            <h2 className="font-black">Item specifics</h2>
            <div className="mt-3 space-y-2">{Object.entries(form.aspects).map(([name, value]) => <div key={name} className="grid grid-cols-[1fr_1fr_auto] gap-2"><input aria-label="Nombre del aspecto" value={name} readOnly className="min-w-0 rounded-xl bg-black/25 px-3" /><input aria-label={`Valor de ${name}`} value={value} onChange={(event) => setForm((current) => ({ ...current, aspects: { ...current.aspects, [name]: event.target.value } }))} className="min-h-11 min-w-0 rounded-xl border border-white/15 bg-black/25 px-3" /><button type="button" aria-label={`Eliminar ${name}`} onClick={() => setForm((current) => ({ ...current, aspects: Object.fromEntries(Object.entries(current.aspects).filter(([key]) => key !== name)) }))} className="size-11 rounded-xl border border-rose-200/30">×</button></div>)}</div>
            <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2"><input placeholder="Marca" value={aspectName} onChange={(event) => setAspectName(event.target.value)} className="min-h-11 min-w-0 rounded-xl border border-white/15 bg-black/25 px-3" /><input placeholder="Valor" value={aspectValue} onChange={(event) => setAspectValue(event.target.value)} className="min-h-11 min-w-0 rounded-xl border border-white/15 bg-black/25 px-3" /><button type="button" disabled={!aspectName.trim() || !aspectValue.trim()} onClick={() => { setForm((current) => ({ ...current, aspects: { ...current.aspects, [aspectName.trim()]: aspectValue.trim() } })); setAspectName(""); setAspectValue("") }} className="size-11 rounded-xl bg-violet-200 font-black text-black disabled:opacity-40">+</button></div>
          </section>

          <section className="rounded-3xl border border-amber-200/20 bg-amber-200/[0.05] p-4"><div className="flex justify-between gap-3"><h2 className="font-black">Readiness</h2><strong>{listingPackage.readiness}%</strong></div>{blockers.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-50">{blockers.map((blocker) => <li key={blocker}>{blocker.replaceAll("_", " ")}</li>)}</ul> : <p className="mt-2 text-sm text-emerald-100">Sin bloqueos. Puedes enviarlo a revisión humana.</p>}<p className="mt-3 text-xs leading-5 text-white/50">Este workspace sólo guarda un paquete interno. No crea Inventory Item, Offer ni publicación en eBay.</p></section>
        </>}
      </section>

      {opportunity && listingPackage && <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/15 bg-[#0b1018]/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur"><div className="mx-auto grid max-w-xl grid-cols-2 gap-2"><button disabled={busy} onClick={() => void save(false)} className="min-h-14 rounded-2xl border border-white/20 font-black disabled:opacity-50">{busy ? "Guardando…" : "Guardar"}</button><button disabled={busy || blockers.length > 0} onClick={() => void save(true)} className="min-h-14 rounded-2xl bg-emerald-200 px-3 font-black text-black disabled:opacity-40">Listo para revisión</button></div></div>}
    </main>
  )
}
