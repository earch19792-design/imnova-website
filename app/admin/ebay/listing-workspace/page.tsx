"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { supabase } from "@/lib/supabase"
import {
  getMobileReviewPayloadError,
  getMobileReviewRequestError,
  readMobileReviewJson,
} from "@/lib/ebay/ebay-mobile-review-http"

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
  assessment?: Record<string, unknown>
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

type DraftConfiguration = {
  sku: string
  quantity: number
  condition: string
  merchantLocationKey: string
  fulfillmentPolicyId: string
  paymentPolicyId: string
  returnPolicyId: string
  length: number | null
  width: number | null
  height: number | null
  dimensionUnit: string
  weight: number | null
  weightUnit: string
  imageRightsBasis: string
  imageSource: string
}

type DraftState = {
  readiness?: { ready: boolean; blockers: string[]; payloadHash?: string }
  approval?: { id: string; status: string; expires_at: string } | null
  execution?: { phase: string; offer_id?: string | null; last_error_code?: string | null } | null
  runtime?: { enabled: boolean; configured: boolean; target: string; canPublish: false }
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

const emptyDraftConfiguration: DraftConfiguration = {
  sku: "",
  quantity: 1,
  condition: "NEW",
  merchantLocationKey: "",
  fulfillmentPolicyId: "",
  paymentPolicyId: "",
  returnPolicyId: "",
  length: null,
  width: null,
  height: null,
  dimensionUnit: "INCH",
  weight: null,
  weightUnit: "POUND",
  imageRightsBasis: "supplier_authorized",
  imageSource: "luna",
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function safeSku(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
}

function initialDraftConfiguration(opportunity: Opportunity): DraftConfiguration {
  const assessment = object(opportunity.assessment)
  const candidate = object(assessment.candidate)
  const dimensions = object(candidate.dimensions)
  const stock = Math.max(1, Math.trunc(numberOrNull(opportunity.supplier_inventory_quantity) ?? 1))
  return {
    ...emptyDraftConfiguration,
    sku: safeSku(opportunity.supplier_sku || opportunity.candidate_key),
    quantity: Math.min(stock, 1),
    length: numberOrNull(dimensions.length),
    width: numberOrNull(dimensions.width),
    height: numberOrNull(dimensions.height),
    dimensionUnit: String(dimensions.unit ?? "INCH").toUpperCase(),
    weight: numberOrNull(candidate.weight),
    weightUnit: String(candidate.weightUnit ?? "POUND").toUpperCase(),
  }
}

function draftConfigurationFromPackage(
  packageData: Record<string, unknown>,
  opportunity: Opportunity,
): DraftConfiguration {
  const fallback = initialDraftConfiguration(opportunity)
  const saved = object(packageData.draftConfiguration)
  const policies = object(saved.businessPolicies)
  const packageWeightAndSize = object(saved.packageWeightAndSize)
  const dimensions = object(packageWeightAndSize.dimensions)
  const weight = object(packageWeightAndSize.weight)
  return {
    ...fallback,
    sku: safeSku(saved.sku) || fallback.sku,
    quantity: Math.max(1, Math.trunc(numberOrNull(saved.quantity) ?? fallback.quantity)),
    condition: String(saved.condition ?? fallback.condition).toUpperCase(),
    merchantLocationKey: String(saved.merchantLocationKey ?? fallback.merchantLocationKey),
    fulfillmentPolicyId: String(policies.fulfillmentPolicyId ?? fallback.fulfillmentPolicyId),
    paymentPolicyId: String(policies.paymentPolicyId ?? fallback.paymentPolicyId),
    returnPolicyId: String(policies.returnPolicyId ?? fallback.returnPolicyId),
    length: numberOrNull(dimensions.length) ?? fallback.length,
    width: numberOrNull(dimensions.width) ?? fallback.width,
    height: numberOrNull(dimensions.height) ?? fallback.height,
    dimensionUnit: String(dimensions.unit ?? fallback.dimensionUnit).toUpperCase(),
    weight: numberOrNull(weight.value) ?? fallback.weight,
    weightUnit: String(weight.unit ?? fallback.weightUnit).toUpperCase(),
    imageRightsBasis: String(object(saved.imageAuthorization).rightsBasis ?? fallback.imageRightsBasis),
    imageSource: String(object(saved.imageAuthorization).source ?? fallback.imageSource),
  }
}

function httpsImageUrl(value: unknown) {
  try {
    const parsed = new URL(String(value ?? "").trim())
    return parsed.protocol === "https:" ? parsed.toString() : null
  } catch {
    return null
  }
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
  const [imageUrl, setImageUrl] = useState("")
  const [draftConfiguration, setDraftConfiguration] = useState<DraftConfiguration>(emptyDraftConfiguration)
  const [draftState, setDraftState] = useState<DraftState>({})
  const [draftBusy, setDraftBusy] = useState(false)
  const [imagesAuthorized, setImagesAuthorized] = useState(false)
  const [approvalPhrase, setApprovalPhrase] = useState("")
  const [confirmUnpublishedOnly, setConfirmUnpublishedOnly] = useState(false)
  const [confirmNoPublish, setConfirmNoPublish] = useState(false)

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
    const payload = await readMobileReviewJson<Record<string, any>>(
      response,
      "No se pudo abrir el workspace",
    )
    if (!payload.success) throw new Error(getMobileReviewPayloadError(payload, "No se pudo abrir el workspace."))
    return payload
  }, [])

  const draftRequest = useCallback(async (
    body?: Record<string, unknown>,
    packageId?: string,
  ) => {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !data.session) throw new Error("La sesión Admin expiró.")
    const endpoint = body
      ? "/api/admin/ebay/draft-only"
      : `/api/admin/ebay/draft-only?packageId=${encodeURIComponent(packageId ?? "")}`
    const response = await fetch(endpoint, {
      method: body ? "POST" : "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const payload = await readMobileReviewJson<Record<string, any>>(
      response,
      "No se pudo validar el draft no publicado",
    )
    if (!payload.success) {
      const requestError = new Error(getMobileReviewPayloadError(payload, "No se pudo validar el draft.")) as Error & { blockers?: string[] }
      requestError.blockers = Array.isArray(payload.blockers) ? payload.blockers : []
      throw requestError
    }
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
        setDraftConfiguration(draftConfigurationFromPackage(object(nextPackage.package_data), selected))
        try {
          const draft = await draftRequest(undefined, nextPackage.id)
          setDraftState(draft)
        } catch {
          setDraftState({})
        }
        setMessage(prepared.created ? "Paquete interno creado con la evidencia más reciente." : "Continuaste el paquete guardado anteriormente.")
      } catch (requestError) {
        setError(getMobileReviewRequestError(requestError, "No se pudo abrir el workspace."))
        setMessage("")
      }
    })()
  }, [request, draftRequest])

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
        packageData: packageDataPayload(),
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

  function draftConfigurationPayload() {
    return {
      sku: draftConfiguration.sku,
      quantity: draftConfiguration.quantity,
      condition: draftConfiguration.condition,
      merchantLocationKey: draftConfiguration.merchantLocationKey,
      businessPolicies: {
        fulfillmentPolicyId: draftConfiguration.fulfillmentPolicyId,
        paymentPolicyId: draftConfiguration.paymentPolicyId,
        returnPolicyId: draftConfiguration.returnPolicyId,
      },
      packageWeightAndSize: {
        dimensions: {
          length: draftConfiguration.length,
          width: draftConfiguration.width,
          height: draftConfiguration.height,
          unit: draftConfiguration.dimensionUnit,
        },
        weight: {
          value: draftConfiguration.weight,
          unit: draftConfiguration.weightUnit,
        },
      },
      imageAuthorization: {
        rightsBasis: draftConfiguration.imageRightsBasis,
        source: draftConfiguration.imageSource,
      },
    }
  }

  function packageDataPayload() {
    return {
      ...form,
      draftConfiguration: draftConfigurationPayload(),
    }
  }

  async function persistCurrentPackage() {
    if (!opportunity || !listingPackage) throw new Error("Falta el paquete del producto.")
    const payload = await request({
      action: "save_package",
      opportunityId: opportunity.id,
      candidateKey: opportunity.candidate_key,
      packageId: listingPackage.id,
      packageData: packageDataPayload(),
      markReady: false,
    })
    setListingPackage(payload.listingPackage)
  }

  async function validateDraft() {
    if (!listingPackage) return
    setDraftBusy(true); setError(""); setMessage("Validando draft seguro…")
    try {
      await persistCurrentPackage()
      const payload = await draftRequest({
        action: "preview",
        packageId: listingPackage.id,
        draftConfiguration: draftConfigurationPayload(),
        confirmImagesAuthorized: imagesAuthorized,
      })
      setDraftState((current) => ({ ...current, ...payload }))
      setMessage(payload.readiness?.ready
        ? "Draft listo para tu aprobación. Validaremos todo otra vez antes de tocar eBay Sandbox."
        : `Faltan ${payload.readiness?.blockers?.length ?? 0} validaciones para autorizar.`)
    } catch (requestError) {
      const blockers = (requestError as Error & { blockers?: string[] }).blockers ?? []
      if (blockers.length) setDraftState((current) => ({ ...current, readiness: { ready: false, blockers } }))
      setError(getMobileReviewRequestError(requestError, "No se pudo validar el draft.")); setMessage("")
    } finally { setDraftBusy(false) }
  }

  async function approveDraft() {
    if (!listingPackage) return
    setDraftBusy(true); setError(""); setMessage("Registrando aprobación de un solo uso…")
    try {
      await persistCurrentPackage()
      const payload = await draftRequest({
        action: "approve",
        packageId: listingPackage.id,
        idempotencyKey: `approval:${listingPackage.id}:${crypto.randomUUID()}`,
        confirmation: approvalPhrase,
        confirmUnpublishedOnly,
        confirmNoPublish,
        confirmImagesAuthorized: imagesAuthorized,
        draftConfiguration: draftConfigurationPayload(),
      })
      setDraftState((current) => ({ ...current, ...payload }))
      setListingPackage((current) => current ? { ...current, status: "approved" } : current)
      setMessage("Aprobación registrada por 15 minutos. Aún no se escribió nada en eBay.")
    } catch (requestError) {
      const blockers = (requestError as Error & { blockers?: string[] }).blockers ?? []
      if (blockers.length) setDraftState((current) => ({ ...current, readiness: { ready: false, blockers } }))
      setError(getMobileReviewRequestError(requestError, "No se pudo aprobar el draft.")); setMessage("")
    } finally { setDraftBusy(false) }
  }

  async function executeDraft() {
    if (!listingPackage || !draftState.approval?.id) return
    setDraftBusy(true); setError(""); setMessage("Revalidando Luna y creando únicamente el Offer no publicado…")
    try {
      const payload = await draftRequest({
        action: "execute",
        approvalId: draftState.approval.id,
        idempotencyKey: `execution:${draftState.approval.id}`,
      })
      setDraftState((current) => ({ ...current, ...payload, execution: payload.execution }))
      setMessage(`Draft creado en ${payload.draft?.target ?? "SANDBOX"}: ${payload.draft?.status ?? "UNPUBLISHED"}. No está visible para compradores.`)
    } catch (requestError) {
      setError(getMobileReviewRequestError(requestError, "No se pudo crear el draft no publicado.")); setMessage("")
    } finally { setDraftBusy(false) }
  }

  async function revokeDraftApproval() {
    if (!draftState.approval?.id) return
    setDraftBusy(true); setError(""); setMessage("Cancelando aprobación…")
    try {
      const payload = await draftRequest({
        action: "revoke",
        approvalId: draftState.approval.id,
      })
      setDraftState((current) => ({ ...current, approval: payload.approval }))
      setMessage("Aprobación cancelada. No se escribió nada en eBay.")
    } catch (requestError) {
      setError(getMobileReviewRequestError(requestError, "No se pudo cancelar la aprobación.")); setMessage("")
    } finally { setDraftBusy(false) }
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

          <section className="rounded-3xl border border-cyan-200/20 bg-cyan-200/[0.04] p-4">
            <h2 className="font-black">Imágenes autorizadas</h2>
            <p className="mt-1 text-xs leading-5 text-white/55">Usa únicamente imágenes propias o autorizadas por Luna/proveedor. No copies imágenes de listings de eBay.</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {form.imageUrls.map((url) => <article key={url} className="overflow-hidden rounded-2xl border border-white/15 bg-black/25"><img src={url} alt="Imagen autorizada del producto" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-32 w-full bg-white object-contain" /><button type="button" onClick={() => { setForm((current) => ({ ...current, imageUrls: current.imageUrls.filter((item) => item !== url) })); setImagesAuthorized(false) }} className="min-h-11 w-full border-t border-white/15 px-2 text-xs font-black text-rose-100">Quitar</button></article>)}
            </div>
            {!form.imageUrls.length && <p className="mt-3 rounded-2xl border border-amber-200/20 p-3 text-sm text-amber-50">Falta al menos una imagen HTTPS autorizada.</p>}
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-2"><input inputMode="url" placeholder="https://…" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} className="min-h-12 min-w-0 rounded-2xl border border-white/20 bg-black/30 px-3" /><button type="button" disabled={!httpsImageUrl(imageUrl) || form.imageUrls.length >= 24} onClick={() => { const next = httpsImageUrl(imageUrl); if (!next) return; setForm((current) => ({ ...current, imageUrls: [...new Set([...current.imageUrls, next])] })); setImagesAuthorized(false); setImageUrl("") }} className="min-h-12 rounded-2xl bg-cyan-200 px-4 font-black text-black disabled:opacity-40">Agregar</button></div>
          </section>

          <section className="rounded-3xl border border-violet-200/20 bg-violet-200/[0.05] p-4">
            <h2 className="font-black">Item specifics</h2>
            <div className="mt-3 space-y-2">{Object.entries(form.aspects).map(([name, value]) => <div key={name} className="grid grid-cols-[1fr_1fr_auto] gap-2"><input aria-label="Nombre del aspecto" value={name} readOnly className="min-w-0 rounded-xl bg-black/25 px-3" /><input aria-label={`Valor de ${name}`} value={value} onChange={(event) => setForm((current) => ({ ...current, aspects: { ...current.aspects, [name]: event.target.value } }))} className="min-h-11 min-w-0 rounded-xl border border-white/15 bg-black/25 px-3" /><button type="button" aria-label={`Eliminar ${name}`} onClick={() => setForm((current) => ({ ...current, aspects: Object.fromEntries(Object.entries(current.aspects).filter(([key]) => key !== name)) }))} className="size-11 rounded-xl border border-rose-200/30">×</button></div>)}</div>
            <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2"><input placeholder="Marca" value={aspectName} onChange={(event) => setAspectName(event.target.value)} className="min-h-11 min-w-0 rounded-xl border border-white/15 bg-black/25 px-3" /><input placeholder="Valor" value={aspectValue} onChange={(event) => setAspectValue(event.target.value)} className="min-h-11 min-w-0 rounded-xl border border-white/15 bg-black/25 px-3" /><button type="button" disabled={!aspectName.trim() || !aspectValue.trim()} onClick={() => { setForm((current) => ({ ...current, aspects: { ...current.aspects, [aspectName.trim()]: aspectValue.trim() } })); setAspectName(""); setAspectValue("") }} className="size-11 rounded-xl bg-violet-200 font-black text-black disabled:opacity-40">+</button></div>
          </section>

          <section className="space-y-4 rounded-3xl border border-cyan-200/25 bg-cyan-200/[0.05] p-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-cyan-100/65">Draft eBay controlado</p>
              <h2 className="mt-1 text-xl font-black">Offer no publicado · Sandbox</h2>
              <p className="mt-2 text-sm leading-6 text-white/65">Primero validas, después autorizas por 15 minutos y finalmente ejecutas. Ningún paso puede publicar el listing.</p>
            </div>
            <div className={`rounded-2xl border p-3 text-sm ${draftState.runtime?.enabled && draftState.runtime?.configured ? "border-emerald-200/25 bg-emerald-200/[0.06] text-emerald-50" : "border-amber-200/25 bg-amber-200/[0.06] text-amber-50"}`}>
              <strong>{draftState.runtime?.enabled && draftState.runtime?.configured ? "Conector Sandbox listo" : "Conector Sandbox bloqueado por configuración"}</strong>
              <p className="mt-1 text-xs opacity-75">Target: {draftState.runtime?.target ?? "SANDBOX"} · publicación: desactivada</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className="text-sm font-black">SKU del draft</span><input value={draftConfiguration.sku} onChange={(event) => setDraftConfiguration((current) => ({ ...current, sku: safeSku(event.target.value) }))} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-4" /></label>
              <label><span className="text-sm font-black">Cantidad</span><input inputMode="numeric" value={draftConfiguration.quantity} onChange={(event) => setDraftConfiguration((current) => ({ ...current, quantity: Math.max(0, Math.trunc(Number(event.target.value) || 0)) }))} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-4" /></label>
              <label><span className="text-sm font-black">Condición</span><select value={draftConfiguration.condition} onChange={(event) => setDraftConfiguration((current) => ({ ...current, condition: event.target.value }))} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-4"><option value="NEW">Nuevo</option><option value="NEW_OTHER">Nuevo, otro</option><option value="NEW_WITH_DEFECTS">Nuevo con defectos</option><option value="USED_EXCELLENT">Usado excelente</option><option value="USED_GOOD">Usado bueno</option><option value="USED_ACCEPTABLE">Usado aceptable</option></select></label>
              <label><span className="text-sm font-black">Merchant location</span><input value={draftConfiguration.merchantLocationKey} onChange={(event) => setDraftConfiguration((current) => ({ ...current, merchantLocationKey: event.target.value.trim() }))} placeholder="Warehouse eBay" className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-4" /></label>
              <label><span className="text-sm font-black">Fulfillment policy ID</span><input value={draftConfiguration.fulfillmentPolicyId} onChange={(event) => setDraftConfiguration((current) => ({ ...current, fulfillmentPolicyId: event.target.value.trim() }))} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-4" /></label>
              <label><span className="text-sm font-black">Payment policy ID</span><input value={draftConfiguration.paymentPolicyId} onChange={(event) => setDraftConfiguration((current) => ({ ...current, paymentPolicyId: event.target.value.trim() }))} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-4" /></label>
              <label><span className="text-sm font-black">Return policy ID</span><input value={draftConfiguration.returnPolicyId} onChange={(event) => setDraftConfiguration((current) => ({ ...current, returnPolicyId: event.target.value.trim() }))} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-4" /></label>
              <label><span className="text-sm font-black">Peso</span><div className="mt-2 grid grid-cols-[1fr_auto] gap-2"><input inputMode="decimal" value={draftConfiguration.weight ?? ""} onChange={(event) => setDraftConfiguration((current) => ({ ...current, weight: numberOrNull(event.target.value) }))} className="min-h-12 min-w-0 rounded-2xl border border-white/20 bg-black/30 px-4" /><select value={draftConfiguration.weightUnit} onChange={(event) => setDraftConfiguration((current) => ({ ...current, weightUnit: event.target.value }))} className="rounded-2xl border border-white/20 bg-black/30 px-2"><option value="POUND">lb</option><option value="OUNCE">oz</option><option value="KILOGRAM">kg</option><option value="GRAM">g</option></select></div></label>
            </div>
            <div><span className="text-sm font-black">Dimensiones del paquete</span><div className="mt-2 grid grid-cols-4 gap-2">{(["length", "width", "height"] as const).map((field) => <input key={field} aria-label={field} inputMode="decimal" placeholder={field === "length" ? "Largo" : field === "width" ? "Ancho" : "Alto"} value={draftConfiguration[field] ?? ""} onChange={(event) => setDraftConfiguration((current) => ({ ...current, [field]: numberOrNull(event.target.value) }))} className="min-h-12 min-w-0 rounded-xl border border-white/20 bg-black/30 px-2" />)}<select value={draftConfiguration.dimensionUnit} onChange={(event) => setDraftConfiguration((current) => ({ ...current, dimensionUnit: event.target.value }))} className="min-h-12 rounded-xl border border-white/20 bg-black/30 px-1"><option value="INCH">in</option><option value="CENTIMETER">cm</option></select></div></div>
            <label className="flex min-h-14 items-start gap-3 rounded-2xl border border-white/15 p-3"><input type="checkbox" checked={imagesAuthorized} onChange={(event) => setImagesAuthorized(event.target.checked)} className="mt-1 size-5" /><span className="text-sm"><strong className="block">Confirmo derechos sobre todas las imágenes</strong><span className="text-white/55">Provienen de Luna/proveedor y están autorizadas; no fueron copiadas de eBay ni de competidores.</span></span></label>
            <button type="button" disabled={draftBusy} onClick={() => void validateDraft()} className="min-h-13 w-full rounded-2xl border border-cyan-200/35 px-4 font-black text-cyan-50 disabled:opacity-50">{draftBusy ? "Validando…" : "Validar draft seguro"}</button>
            {draftState.readiness && <div className={`rounded-2xl border p-3 ${draftState.readiness.ready ? "border-emerald-200/30 bg-emerald-200/[0.06]" : "border-amber-200/30 bg-amber-200/[0.06]"}`}><strong>{draftState.readiness.ready ? "Listo para tu aprobación" : `${draftState.readiness.blockers.length} bloqueos pendientes`}</strong>{!draftState.readiness.ready && <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-50">{draftState.readiness.blockers.map((blocker) => <li key={blocker}>{blocker.replaceAll("_", " ")}</li>)}</ul>}</div>}
            {draftState.readiness?.ready && !draftState.approval && <div className="space-y-3 rounded-2xl border border-emerald-200/25 p-3"><label className="block"><span className="text-sm font-black">Escribe exactamente: CREAR DRAFT NO PUBLICADO</span><input value={approvalPhrase} onChange={(event) => setApprovalPhrase(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-white/20 bg-black/30 px-3" /></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmUnpublishedOnly} onChange={(event) => setConfirmUnpublishedOnly(event.target.checked)} />Entiendo que sólo autoriza un Offer no publicado.</label><label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmNoPublish} onChange={(event) => setConfirmNoPublish(event.target.checked)} />Confirmo que publicar permanece prohibido.</label><button type="button" disabled={draftBusy || approvalPhrase !== "CREAR DRAFT NO PUBLICADO" || !confirmUnpublishedOnly || !confirmNoPublish || !imagesAuthorized} onClick={() => void approveDraft()} className="min-h-13 w-full rounded-2xl bg-emerald-200 px-4 font-black text-black disabled:opacity-40">Aprobar por 15 minutos</button></div>}
            {draftState.approval?.status === "approved" && draftState.execution?.phase !== "completed" && <div className="rounded-2xl border border-rose-200/30 bg-rose-200/[0.06] p-3"><strong>Aprobación activa hasta {new Date(draftState.approval.expires_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</strong><p className="mt-2 text-sm text-white/65">El siguiente botón es el único que puede escribir y sólo crea Inventory Item + Offer UNPUBLISHED en Sandbox.</p><button type="button" disabled={draftBusy || !draftState.runtime?.enabled || !draftState.runtime?.configured} onClick={() => void executeDraft()} className="mt-3 min-h-14 w-full rounded-2xl bg-rose-200 px-4 font-black text-black disabled:opacity-40">Crear draft no publicado</button><button type="button" disabled={draftBusy} onClick={() => void revokeDraftApproval()} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 px-4 font-black disabled:opacity-40">Cancelar aprobación</button></div>}
            {draftState.execution?.phase === "completed" && <div className="rounded-2xl border border-emerald-200/30 bg-emerald-200/[0.07] p-3 text-emerald-50"><strong>Draft creado · UNPUBLISHED</strong><p className="mt-1 break-all text-xs">Offer ID: {draftState.execution.offer_id ?? "guardado"}</p></div>}
          </section>

          <section className="rounded-3xl border border-amber-200/20 bg-amber-200/[0.05] p-4"><div className="flex justify-between gap-3"><h2 className="font-black">Readiness</h2><strong>{listingPackage.readiness}%</strong></div>{blockers.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-50">{blockers.map((blocker) => <li key={blocker}>{blocker.replaceAll("_", " ")}</li>)}</ul> : <p className="mt-2 text-sm text-emerald-100">Sin bloqueos. Puedes enviarlo a revisión humana.</p>}<p className="mt-3 text-xs leading-5 text-white/50">Guardar y validar sólo modifican datos internos. Únicamente “Crear draft no publicado”, después de tu aprobación, puede crear Inventory Item + Offer UNPUBLISHED en eBay Sandbox. Publicar permanece prohibido.</p></section>
        </>}
      </section>

      {opportunity && listingPackage && <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/15 bg-[#0b1018]/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur"><div className="mx-auto grid max-w-xl grid-cols-2 gap-2"><button disabled={busy} onClick={() => void save(false)} className="min-h-14 rounded-2xl border border-white/20 font-black disabled:opacity-50">{busy ? "Guardando…" : "Guardar"}</button><button disabled={busy || blockers.length > 0} onClick={() => void save(true)} className="min-h-14 rounded-2xl bg-emerald-200 px-3 font-black text-black disabled:opacity-40">Listo para revisión</button></div></div>}
    </main>
  )
}
