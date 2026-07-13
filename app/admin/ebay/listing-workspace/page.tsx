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
  ebayPreflightSnapshot: string
}

type PreflightOption = { id: string; name: string; usable: boolean; status?: string }

type EbayMobilePreflight = {
  mode: "GET_ONLY"
  target: "SANDBOX" | "PRODUCTION"
  marketplaceId: "EBAY_US"
  identity: {
    status: "BOUND" | "IDENTITY_UNBOUND" | "IDENTITY_MISMATCH"
    accountFingerprint: string
    expectedIdentityConfigured: boolean
    accountType: string
    registrationMarketplaceId: string
  }
  privilege: {
    sellerRegistrationCompleted: boolean
    sellingLimitPresent: boolean
    sellingLimitZero: boolean
    usable: boolean
  }
  options: {
    fulfillmentPolicies: PreflightOption[]
    paymentPolicies: PreflightOption[]
    returnPolicies: PreflightOption[]
    merchantLocations: PreflightOption[]
  }
  selection: {
    fulfillmentPolicyId: string
    paymentPolicyId: string
    returnPolicyId: string
    merchantLocationKey: string
  }
  selectionComplete: boolean
  snapshot: string
  snapshotExpiresAt: string | null
  snapshotStatus: string
  warnings: string[]
}

type DraftState = {
  readiness?: { ready: boolean; blockers: string[]; payloadHash?: string; requiredSku?: string }
  approval?: { id: string; status: string; expires_at: string } | null
  execution?: { phase: string; offer_id?: string | null; last_error_code?: string | null; completed_at?: string | null } | null
  runtime?: {
    enabled: boolean
    configured: boolean
    oauthConfigured?: boolean
    identityBound?: boolean
    snapshotConfigured?: boolean
    environmentAllowed?: boolean
    target: "SANDBOX" | "PRODUCTION"
    accountFingerprint?: string | null
    canPublish: false
  }
  approvalRequirements?: {
    exactPhrase: string
    target: "SANDBOX" | "PRODUCTION"
    productionAccountConfirmationRequired?: boolean
  }
  preflight?: EbayMobilePreflight
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
  ebayPreflightSnapshot: "",
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

function reservedDraftSku(packageId: string) {
  const normalized = packageId.replace(/[^A-Za-z0-9]/g, "").toUpperCase()
  return normalized.length >= 16 ? `IMNOVA-${normalized.slice(0, 32)}` : ""
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
    ebayPreflightSnapshot: String(saved.ebayPreflightSnapshot ?? fallback.ebayPreflightSnapshot),
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
  const [confirmProductionAccount, setConfirmProductionAccount] = useState(false)

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
        setDraftConfiguration({
          ...draftConfigurationFromPackage(object(nextPackage.package_data), selected),
          sku: reservedDraftSku(nextPackage.id),
        })
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
  const draftTarget = draftState.runtime?.target ?? "SANDBOX"
  const productionTarget = draftTarget === "PRODUCTION"
  const expectedApprovalPhrase = draftState.approvalRequirements?.exactPhrase
    ?? (productionTarget
      ? "CREAR DRAFT NO PUBLICADO EN PRODUCCIÓN"
      : "CREAR DRAFT NO PUBLICADO")
  const executionCompleted = draftState.execution?.phase === "completed"
  const approvalActive = draftState.approval?.status === "approved"
    && Date.parse(draftState.approval.expires_at) > Date.now()
  const effectiveDraftQuantity = productionTarget ? 1 : draftConfiguration.quantity

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
      quantity: effectiveDraftQuantity,
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
      ebayPreflightSnapshot: draftConfiguration.ebayPreflightSnapshot,
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

  async function runEbayPreflight() {
    if (!listingPackage) return
    setDraftBusy(true); setError(""); setMessage("Consultando eBay en modo sólo lectura…")
    try {
      const payload = await draftRequest({
        action: "preflight",
        packageId: listingPackage.id,
        selection: {
          fulfillmentPolicyId: draftConfiguration.fulfillmentPolicyId,
          paymentPolicyId: draftConfiguration.paymentPolicyId,
          returnPolicyId: draftConfiguration.returnPolicyId,
          merchantLocationKey: draftConfiguration.merchantLocationKey,
        },
      })
      const preflight = payload.preflight as EbayMobilePreflight
      setDraftState((current) => ({ ...current, ...payload, preflight }))
      setDraftConfiguration((current) => ({
        ...current,
        fulfillmentPolicyId: preflight.selection.fulfillmentPolicyId,
        paymentPolicyId: preflight.selection.paymentPolicyId,
        returnPolicyId: preflight.selection.returnPolicyId,
        merchantLocationKey: preflight.selection.merchantLocationKey,
        ebayPreflightSnapshot: preflight.snapshot,
      }))
      setMessage(preflight.snapshotStatus === "READY"
        ? "Preflight eBay listo por 5 minutos. No se realizó ninguna escritura."
        : preflight.identity.status === "IDENTITY_UNBOUND"
          ? "OAuth respondió. Copia el fingerprint mostrado y configúralo como EXPECTED_ACCOUNT_FINGERPRINT de esta rama antes de aprobar."
          : `Preflight read-only pendiente: ${preflight.snapshotStatus.replaceAll("_", " ")}.`)
    } catch (requestError) {
      setError(getMobileReviewRequestError(requestError, "No se pudo consultar la configuración eBay.")); setMessage("")
    } finally { setDraftBusy(false) }
  }

  function updatePreflightSelection(
    field: "fulfillmentPolicyId" | "paymentPolicyId" | "returnPolicyId" | "merchantLocationKey",
    value: string,
  ) {
    setDraftConfiguration((current) => ({
      ...current,
      [field]: value,
      ebayPreflightSnapshot: "",
    }))
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
        ? `Draft listo para tu aprobación. Validaremos todo otra vez antes de tocar eBay ${payload.runtime?.target ?? draftTarget}.`
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
        confirmTarget: draftTarget,
        confirmUnpublishedOnly,
        confirmNoPublish,
        confirmProductionAccount: productionTarget ? confirmProductionAccount : false,
        confirmImagesAuthorized: imagesAuthorized,
        draftConfiguration: draftConfigurationPayload(),
      })
      setDraftState((current) => ({ ...current, ...payload }))
      setListingPackage((current) => current ? { ...current, status: "approved" } : current)
      setMessage("Aprobación registrada por 15 minutos. La ejecución requiere el siguiente paso.")
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
      const verification = String(
        payload.draft?.verification ?? payload.draft?.status ?? "UNPUBLISHED_VERIFIED_AT_CREATE",
      ).replaceAll("_", " ")
      setMessage(`Draft registrado en ${payload.draft?.target ?? "SANDBOX"}: ${verification}. No se llamó a publicar; la ausencia de listing se verificó en ese momento.`)
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
      setMessage("Aprobación cancelada. Se bloquearon nuevos intentos; una ejecución ya iniciada debe reconciliarse.")
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
              <h2 className="mt-1 text-xl font-black">Offer API no publicado · {draftTarget}</h2>
              <p className="mt-2 text-sm leading-6 text-white/65">Primero validas, después autorizas por 15 minutos y finalmente ejecutas. Ningún paso puede publicar el listing.</p>
              <p className="mt-2 rounded-xl border border-white/15 p-2 text-xs leading-5 text-white/60">Esto crea Inventory Item + Offer con estado UNPUBLISHED mediante la API. No garantiza que eBay lo muestre como un “draft” editable dentro de Seller Hub.</p>
            </div>
            <div className={`rounded-2xl border p-3 text-sm ${productionTarget ? "border-rose-200/40 bg-rose-200/[0.09] text-rose-50" : draftState.runtime?.enabled && draftState.runtime?.configured ? "border-emerald-200/25 bg-emerald-200/[0.06] text-emerald-50" : "border-amber-200/25 bg-amber-200/[0.06] text-amber-50"}`}>
              <strong>{draftState.runtime?.enabled && draftState.runtime?.configured ? `Conector ${draftTarget} listo` : `Conector ${draftTarget} bloqueado por configuración`}</strong>
              <p className="mt-1 text-xs opacity-75">Target: {draftTarget} · publicación: desactivada · la ejecución exige coincidencia exacta de cuenta</p>
              {productionTarget && <p className="mt-2 text-xs font-black">ATENCIÓN: Inventory Item y Offer se crearán dentro de tu cuenta real de vendedor eBay, aunque permanecerán sin publicar.</p>}
              {productionTarget && draftState.runtime?.environmentAllowed === false && <p className="mt-2 text-xs font-black">Producción draft-only sólo se permite en el Preview y la rama autorizada.</p>}
            </div>
            <div className="rounded-2xl border border-sky-200/25 bg-sky-200/[0.05] p-3 text-sm">
              <div className="flex items-center justify-between gap-3"><strong>Preflight eBay · recursos sólo GET</strong><span className="rounded-full border border-white/15 px-2 py-1 text-[10px] font-black">{draftState.preflight?.snapshotStatus ?? "NO EJECUTADO"}</span></div>
              {draftState.preflight && <><p className="mt-2 text-xs">Identidad: {draftState.preflight.identity.status} · privilegios: {draftState.preflight.privilege.usable ? "OK" : "BLOQUEADOS"}</p><p className="mt-1 text-xs text-white/65">Cuenta: {draftState.preflight.identity.accountType || "tipo no informado"} · registro: {draftState.preflight.identity.registrationMarketplaceId || "marketplace no informado"}</p><p className="mt-1 break-all text-[10px] text-white/55">Fingerprint: {draftState.preflight.identity.accountFingerprint}</p>{draftState.preflight.privilege.sellingLimitZero && <p className="mt-2 text-xs font-black text-amber-100">eBay reporta límite de venta en cero. El draft puede prepararse, pero no se considera publicable.</p>}{draftState.preflight.snapshotExpiresAt && <p className="mt-1 text-xs text-emerald-100">Snapshot válido hasta {new Date(draftState.preflight.snapshotExpiresAt).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>}</>}
              <button type="button" disabled={draftBusy || !draftState.runtime?.oauthConfigured} onClick={() => void runEbayPreflight()} className="mt-3 min-h-12 w-full rounded-xl border border-sky-200/35 px-3 font-black text-sky-50 disabled:opacity-40">{draftBusy ? "Consultando…" : "Cargar y validar configuración eBay"}</button>
              {draftState.runtime?.oauthConfigured === false && <p className="mt-2 text-xs text-amber-50">Faltan credenciales OAuth dedicadas. Los flags de escritura pueden permanecer apagados.</p>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className="text-sm font-black">SKU reservado del draft</span><input value={draftConfiguration.sku} readOnly className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/20 px-4 text-white/70" /></label>
              <label><span className="text-sm font-black">Cantidad</span><input inputMode="numeric" value={effectiveDraftQuantity} readOnly={productionTarget} onChange={(event) => setDraftConfiguration((current) => ({ ...current, quantity: Math.max(0, Math.trunc(Number(event.target.value) || 0)) }))} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-4 read-only:bg-white/[0.04] read-only:text-white/65" />{productionTarget && <span className="mt-1 block text-xs text-white/50">Piloto Production bloqueado en 1 unidad.</span>}</label>
              <label><span className="text-sm font-black">Condición</span><select value={draftConfiguration.condition} onChange={(event) => setDraftConfiguration((current) => ({ ...current, condition: event.target.value }))} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-4"><option value="NEW">Nuevo</option><option value="NEW_OTHER">Nuevo, otro</option><option value="NEW_WITH_DEFECTS">Nuevo con defectos</option><option value="USED_EXCELLENT">Usado excelente</option><option value="USED_GOOD">Usado bueno</option><option value="USED_ACCEPTABLE">Usado aceptable</option></select></label>
              <label><span className="text-sm font-black">Merchant location</span><select value={draftConfiguration.merchantLocationKey} onChange={(event) => updatePreflightSelection("merchantLocationKey", event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-3"><option value="">Seleccionar location</option>{draftConfiguration.merchantLocationKey && !draftState.preflight?.options.merchantLocations.some((option) => option.id === draftConfiguration.merchantLocationKey) && <option value={draftConfiguration.merchantLocationKey}>{draftConfiguration.merchantLocationKey} · revalidar</option>}{draftState.preflight?.options.merchantLocations.map((option) => <option key={option.id} value={option.id} disabled={!option.usable}>{option.name} · {option.id}{option.usable ? "" : " · disabled"}</option>)}</select></label>
              <label><span className="text-sm font-black">Fulfillment policy</span><select value={draftConfiguration.fulfillmentPolicyId} onChange={(event) => updatePreflightSelection("fulfillmentPolicyId", event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-3"><option value="">Seleccionar fulfillment</option>{draftConfiguration.fulfillmentPolicyId && !draftState.preflight?.options.fulfillmentPolicies.some((option) => option.id === draftConfiguration.fulfillmentPolicyId) && <option value={draftConfiguration.fulfillmentPolicyId}>{draftConfiguration.fulfillmentPolicyId} · revalidar</option>}{draftState.preflight?.options.fulfillmentPolicies.map((option) => <option key={option.id} value={option.id} disabled={!option.usable}>{option.name} · {option.id}{option.usable ? "" : " · no apta"}</option>)}</select></label>
              <label><span className="text-sm font-black">Payment policy</span><select value={draftConfiguration.paymentPolicyId} onChange={(event) => updatePreflightSelection("paymentPolicyId", event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-3"><option value="">Seleccionar payment</option>{draftConfiguration.paymentPolicyId && !draftState.preflight?.options.paymentPolicies.some((option) => option.id === draftConfiguration.paymentPolicyId) && <option value={draftConfiguration.paymentPolicyId}>{draftConfiguration.paymentPolicyId} · revalidar</option>}{draftState.preflight?.options.paymentPolicies.map((option) => <option key={option.id} value={option.id} disabled={!option.usable}>{option.name} · {option.id}{option.usable ? " · pago inmediato" : " · no apta"}</option>)}</select></label>
              <label><span className="text-sm font-black">Return policy</span><select value={draftConfiguration.returnPolicyId} onChange={(event) => updatePreflightSelection("returnPolicyId", event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-3"><option value="">Seleccionar returns</option>{draftConfiguration.returnPolicyId && !draftState.preflight?.options.returnPolicies.some((option) => option.id === draftConfiguration.returnPolicyId) && <option value={draftConfiguration.returnPolicyId}>{draftConfiguration.returnPolicyId} · revalidar</option>}{draftState.preflight?.options.returnPolicies.map((option) => <option key={option.id} value={option.id} disabled={!option.usable}>{option.name} · {option.id}{option.usable ? "" : " · no apta"}</option>)}</select></label>
              <label><span className="text-sm font-black">Peso</span><div className="mt-2 grid grid-cols-[1fr_auto] gap-2"><input inputMode="decimal" value={draftConfiguration.weight ?? ""} onChange={(event) => setDraftConfiguration((current) => ({ ...current, weight: numberOrNull(event.target.value) }))} className="min-h-12 min-w-0 rounded-2xl border border-white/20 bg-black/30 px-4" /><select value={draftConfiguration.weightUnit} onChange={(event) => setDraftConfiguration((current) => ({ ...current, weightUnit: event.target.value }))} className="rounded-2xl border border-white/20 bg-black/30 px-2"><option value="POUND">lb</option><option value="OUNCE">oz</option><option value="KILOGRAM">kg</option><option value="GRAM">g</option></select></div></label>
            </div>
            <div><span className="text-sm font-black">Dimensiones del paquete</span><div className="mt-2 grid grid-cols-4 gap-2">{(["length", "width", "height"] as const).map((field) => <input key={field} aria-label={field} inputMode="decimal" placeholder={field === "length" ? "Largo" : field === "width" ? "Ancho" : "Alto"} value={draftConfiguration[field] ?? ""} onChange={(event) => setDraftConfiguration((current) => ({ ...current, [field]: numberOrNull(event.target.value) }))} className="min-h-12 min-w-0 rounded-xl border border-white/20 bg-black/30 px-2" />)}<select value={draftConfiguration.dimensionUnit} onChange={(event) => setDraftConfiguration((current) => ({ ...current, dimensionUnit: event.target.value }))} className="min-h-12 rounded-xl border border-white/20 bg-black/30 px-1"><option value="INCH">in</option><option value="CENTIMETER">cm</option></select></div></div>
            <label className="flex min-h-14 items-start gap-3 rounded-2xl border border-white/15 p-3"><input type="checkbox" checked={imagesAuthorized} onChange={(event) => setImagesAuthorized(event.target.checked)} className="mt-1 size-5" /><span className="text-sm"><strong className="block">Confirmo derechos sobre todas las imágenes</strong><span className="text-white/55">Provienen de Luna/proveedor y están autorizadas; no fueron copiadas de eBay ni de competidores.</span></span></label>
            <button type="button" disabled={draftBusy} onClick={() => void validateDraft()} className="min-h-13 w-full rounded-2xl border border-cyan-200/35 px-4 font-black text-cyan-50 disabled:opacity-50">{draftBusy ? "Validando…" : "Validar draft seguro"}</button>
            {draftState.readiness && <div className={`rounded-2xl border p-3 ${draftState.readiness.ready ? "border-emerald-200/30 bg-emerald-200/[0.06]" : "border-amber-200/30 bg-amber-200/[0.06]"}`}><strong>{draftState.readiness.ready ? "Listo para tu aprobación" : `${draftState.readiness.blockers.length} bloqueos pendientes`}</strong>{!draftState.readiness.ready && <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-50">{draftState.readiness.blockers.map((blocker) => <li key={blocker}>{blocker.replaceAll("_", " ")}</li>)}</ul>}</div>}
            {draftState.readiness?.ready && !approvalActive && !executionCompleted && <div className="space-y-3 rounded-2xl border border-emerald-200/25 p-3"><label className="block"><span className="text-sm font-black">Escribe exactamente: {expectedApprovalPhrase}</span><input value={approvalPhrase} onChange={(event) => setApprovalPhrase(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-white/20 bg-black/30 px-3" /></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmUnpublishedOnly} onChange={(event) => setConfirmUnpublishedOnly(event.target.checked)} />Entiendo que sólo autoriza un Offer no publicado.</label><label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmNoPublish} onChange={(event) => setConfirmNoPublish(event.target.checked)} />Confirmo que publicar permanece prohibido.</label>{productionTarget && <label className="flex gap-2 rounded-xl border border-rose-200/30 bg-rose-200/[0.07] p-3 text-sm"><input type="checkbox" checked={confirmProductionAccount} onChange={(event) => setConfirmProductionAccount(event.target.checked)} />Confirmo que {draftTarget} es mi cuenta real: autorizo crear Inventory Item + Offer API UNPUBLISHED, sin publicarlo.</label>}<button type="button" disabled={draftBusy || approvalPhrase !== expectedApprovalPhrase || !confirmUnpublishedOnly || !confirmNoPublish || !imagesAuthorized || (productionTarget && !confirmProductionAccount)} onClick={() => void approveDraft()} className="min-h-13 w-full rounded-2xl bg-emerald-200 px-4 font-black text-black disabled:opacity-40">Aprobar {draftTarget} por 15 minutos</button></div>}
            {approvalActive && !executionCompleted && draftState.approval && <div className="rounded-2xl border border-rose-200/30 bg-rose-200/[0.06] p-3"><strong>Aprobación {draftTarget} activa hasta {new Date(draftState.approval.expires_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</strong><p className="mt-2 text-sm text-white/65">El siguiente botón es el único que puede escribir y sólo crea Inventory Item + Offer API UNPUBLISHED en {draftTarget}.</p><button type="button" disabled={draftBusy || !draftState.runtime?.enabled || !draftState.runtime?.configured} onClick={() => void executeDraft()} className="mt-3 min-h-14 w-full rounded-2xl bg-rose-200 px-4 font-black text-black disabled:opacity-40">Crear Offer no publicado en {draftTarget}</button><button type="button" disabled={draftBusy} onClick={() => void revokeDraftApproval()} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 px-4 font-black disabled:opacity-40">Cancelar aprobación</button></div>}
            {executionCompleted && <div className="rounded-2xl border border-emerald-200/30 bg-emerald-200/[0.07] p-3 text-emerald-50"><strong>UNPUBLISHED verificado al crear {draftState.execution?.completed_at ? new Date(draftState.execution.completed_at).toLocaleString("es") : "en la ejecución registrada"}</strong><p className="mt-1 text-xs">Este estado describe la verificación realizada en ese momento; vuelve a consultar eBay antes de asumir que sigue igual.</p><p className="mt-1 break-all text-xs">Offer ID: {draftState.execution?.offer_id ?? "guardado"}</p></div>}
          </section>

          <section className="rounded-3xl border border-amber-200/20 bg-amber-200/[0.05] p-4"><div className="flex justify-between gap-3"><h2 className="font-black">Readiness</h2><strong>{listingPackage.readiness}%</strong></div>{blockers.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-50">{blockers.map((blocker) => <li key={blocker}>{blocker.replaceAll("_", " ")}</li>)}</ul> : <p className="mt-2 text-sm text-emerald-100">Sin bloqueos. Puedes enviarlo a revisión humana.</p>}<p className="mt-3 text-xs leading-5 text-white/50">Guardar y validar sólo modifican datos internos. Únicamente “Crear Offer no publicado”, después de tu aprobación, puede crear Inventory Item + Offer API UNPUBLISHED en eBay {draftTarget}. Publicar permanece prohibido.</p></section>
        </>}
      </section>

      {opportunity && listingPackage && <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/15 bg-[#0b1018]/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur"><div className="mx-auto grid max-w-xl grid-cols-2 gap-2"><button disabled={busy} onClick={() => void save(false)} className="min-h-14 rounded-2xl border border-white/20 font-black disabled:opacity-50">{busy ? "Guardando…" : "Guardar"}</button><button disabled={busy || blockers.length > 0} onClick={() => void save(true)} className="min-h-14 rounded-2xl bg-emerald-200 px-3 font-black text-black disabled:opacity-40">Listo para revisión</button></div></div>}
    </main>
  )
}
