"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

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
  supplier_variant_id?: string | null
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
  pricing: {
    currency: string
    supplierCost: number | null
    targetPrice: number | null
    estimatedEbayFees: number | null
    estimatedOutboundShipping: number | null
    returnsReserve: number | null
    promotedListingsReserve: number | null
    estimatedNetProfit: number | null
    estimatedNetMarginPercent: number | null
    estimatedRoiPercent: number | null
    minimumProfitablePrice: number | null
    passesProfitGate: boolean | null
  }
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

type EbayTaxonomyAspect = {
  name: string
  mode: string | null
  cardinality: string | null
  maxLength: number | null
  dataType: string | null
  format: string | null
  advancedDataType: string | null
  expectedRequiredByDate: string | null
  suggestedValues: string[]
  values: Array<{
    value: string
    valueConstraints: Array<{
      applicableForAspectName: string
      applicableForAspectValues: string[]
    }>
  }>
  valuesComplete: boolean
  constraintsComplete: boolean
}

type DraftState = {
  readiness?: { ready: boolean; blockers: string[]; payloadHash?: string; requiredSku?: string }
  approval?: { id: string; status: string; expires_at: string } | null
  execution?: { id?: string; phase: string; offer_id?: string | null; last_error_code?: string | null; completed_at?: string | null } | null
  publication?: {
    id: string
    phase: string
    offer_id: string
    sku: string
    preview_hash: string
    preview: Record<string, unknown>
    listing_id?: string | null
    active_listing_id?: string | null
    published_at?: string | null
    verified_active_at?: string | null
    monitor_registered_at?: string | null
    last_error_code?: string | null
  } | null
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
  publicationRequirements?: {
    exactConfirmPublish: string
    finalPreviewRequired: boolean
    productionAccountConfirmationRequired: boolean
    publishOfferCallsAllowed: number
    promotionsAllowed: false
    volumePricingAllowed: false
  }
  preflight?: EbayMobilePreflight
  taxonomy?: {
    status: "AVAILABLE" | "CATEGORY_NOT_RESOLVED" | "REQUEST_FAILED"
    categoryTreeId: string | null
    categoryTreeVersion?: string | null
    categoryId: string | null
    categoryName: string | null
    aspects?: EbayTaxonomyAspect[]
    requiredAspects: EbayTaxonomyAspect[]
    recommendedAspects: EbayTaxonomyAspect[]
    source: "EBAY_TAXONOMY_OFFICIAL_READONLY"
  }
}

type ImageAsset = {
  id: string
  status: "pending_review" | "approved" | "rejected"
  asset_role: string
  public_url: string | null
  published_storage_path?: string | null
  source_url: string | null
  source_preview_url?: string | null
  output_preview_url?: string | null
  source_width: number
  source_height: number
  output_width: number
  output_height: number
  output_bytes: number
  position: number
  rights_basis: string
  authorization_reference: string
  transformation_version: string
  transformation?: {
    slot?: string
    layoutId?: string
    sameDayImageControlId?: string
    baseSameDayImageControlId?: string
  }
  qa_result: {
    automaticStatus?: string
    sourceEdgeLightNeutralRatio?: number
    humanApprovalRequired?: boolean
    manualChecksRequired?: string[]
  }
}

type ImageRevisionPayload = {
  revision: {
    id: string
    status: string
    base_control_id: string
    revision_number: number
    image_set_hash?: string | null
  }
  assets: Array<{
    id: string
    status: string
    role: string
    slot: string
    layoutId: string
    outputSha256: string
    reusedFromHistory: boolean
    previewUrl: string | null
    previewExpiresInSeconds: number | null
  }>
}

const emptyForm: FormState = {
  title: "",
  categoryId: "",
  categoryName: "",
  description: "",
  imageUrls: [],
  aspects: {},
  pricing: {
    currency: "USD",
    supplierCost: null,
    targetPrice: null,
    estimatedEbayFees: null,
    estimatedOutboundShipping: null,
    returnsReserve: null,
    promotedListingsReserve: null,
    estimatedNetProfit: null,
    estimatedNetMarginPercent: null,
    estimatedRoiPercent: null,
    minimumProfitablePrice: null,
    passesProfitGate: null,
  },
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
  dimensionUnit: "",
  weight: null,
  weightUnit: "",
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

function booleanOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null
}

function money(value: number | null) {
  return value === null ? "Pendiente" : `$${value.toFixed(2)}`
}

function percent(value: number | null) {
  return value === null ? "Pendiente" : `${value.toFixed(1)}%`
}

function humanWorkspaceBlocker(code: string, minimumProfitablePrice?: number | null) {
  const labels: Record<string, string> = {
    MINIMUM_NET_MARGIN_NOT_MET: minimumProfitablePrice
      ? `El precio no alcanza el margen mínimo. Prueba al menos ${money(minimumProfitablePrice)} y vuelve a guardar.`
      : "El precio no alcanza el beneficio, margen o ROI mínimos. Ajusta el precio y vuelve a guardar.",
    TITLE_REQUIRED: "Completa el título del listing.",
    CATEGORY_REQUIRED: "Confirma la categoría oficial de eBay.",
    DESCRIPTION_REQUIRED: "Completa la descripción con hechos verificados.",
    IMAGE_REQUIRED: "Aprueba al menos una imagen autorizada.",
    PRICE_REQUIRED: "Indica un precio objetivo mayor que cero.",
    NEED_AUTHORIZED_PRODUCT_IMAGES: "Optimiza y aprueba al menos una imagen autorizada.",
    NEED_PACKAGE_WEIGHT: "Completa el peso del paquete y su unidad.",
    NEED_PACKAGE_DIMENSIONS: "Completa largo, ancho, alto y unidad del paquete.",
    NEED_PACKAGE_WEIGHT_AND_DIMENSIONS: "Completa el peso y las dimensiones del paquete.",
    NEED_EBAY_TAXONOMY_CATEGORY: "Confirma una categoría oficial de eBay.",
    NEED_REQUIRED_EBAY_ITEM_ASPECTS: "Carga Taxonomy y completa los datos obligatorios del producto.",
  }
  if (labels[code]) return labels[code]
  if (/STOCK|SUPPLY/.test(code)) return "Vuelve a confirmar stock y disponibilidad en Luna."
  if (/IDENTITY|COMPARABLE/.test(code)) return "Confirma que el comparable de eBay es exactamente el mismo producto y variante."
  if (/ECONOMIC|MARGIN|COST|PRICE/.test(code)) return "Completa la validación de costo, precio y margen en Oportunidades."
  if (/CATEGORY|TAXONOMY|ASPECT/.test(code)) return "Completa la categoría y los datos obligatorios que eBay solicita."
  if (/IMAGE/.test(code)) return "Completa la revisión de imágenes autorizadas."
  if (/WEIGHT|DIMENSION/.test(code)) return "Completa el peso y las dimensiones reales del paquete."
  if (/RESTRICT|HAZMAT|BATTERY|CHEMICAL|CLAIM/.test(code)) return "Completa la revisión de restricciones antes de continuar."
  if (/DEMAND|MARKET|EVIDENCE|SELLING/.test(code)) return "Completa la validación de mercado y demanda desde Oportunidades."
  return "Completa la validación pendiente desde Oportunidades y vuelve a intentarlo."
}

function safeSku(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
}

function normalizedDraftWeightUnit(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase()
  const aliases: Record<string, string> = {
    LB: "POUND",
    LBS: "POUND",
    POUND: "POUND",
    POUNDS: "POUND",
    OZ: "OUNCE",
    OUNCE: "OUNCE",
    OUNCES: "OUNCE",
    KG: "KILOGRAM",
    KGS: "KILOGRAM",
    KILOGRAM: "KILOGRAM",
    G: "GRAM",
    GRAM: "GRAM",
  }
  return aliases[normalized] ?? ""
}

function normalizedDraftDimensionUnit(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase()
  const aliases: Record<string, string> = {
    IN: "INCH",
    INCH: "INCH",
    INCHES: "INCH",
    CM: "CENTIMETER",
    CENTIMETER: "CENTIMETER",
    CENTIMETERS: "CENTIMETER",
  }
  return aliases[normalized] ?? ""
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
    dimensionUnit: normalizedDraftDimensionUnit(dimensions.unit),
    weight: numberOrNull(candidate.weight),
    weightUnit: normalizedDraftWeightUnit(candidate.weightUnit),
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
    dimensionUnit: normalizedDraftDimensionUnit(dimensions.unit) || fallback.dimensionUnit,
    weight: numberOrNull(weight.value) ?? fallback.weight,
    weightUnit: normalizedDraftWeightUnit(weight.unit) || fallback.weightUnit,
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

function validUuid(value: unknown) {
  const normalized = String(value ?? "").trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(normalized) ? normalized : ""
}

function humanImageError(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  const messages: Record<string, string> = {
    EBAY_IMAGE_BACKGROUND_REQUIRES_MANUAL_REMOVAL:
      "El fondo no es suficientemente claro para una normalización segura. Usa una toma con fondo blanco o la herramienta de fondo de eBay.",
    EBAY_IMAGE_SOURCE_BELOW_500PX:
      "La imagen original mide menos de 500 px. Usa una fotografía de mayor resolución.",
    EBAY_IMAGE_SOURCE_HOST_NOT_ALLOWED:
      "Ese dominio no está autorizado como fuente. Sube la foto desde tu cámara/galería o configura el dominio proveedor.",
    EBAY_IMAGE_AUTHORIZATION_REFERENCE_REQUIRED:
      "Registra una referencia de autorización: contrato, email, factura o nota de propiedad.",
    EBAY_IMAGE_RIGHTS_BASIS_INVALID:
      "Selecciona una base válida de derechos sobre la imagen.",
    EBAY_IMAGE_RIGHTS_EVIDENCE_CONFIRMATION_REQUIRED:
      "Confirma que conservas la foto original o el permiso/licencia por escrito.",
  }
  return messages[code] ?? getMobileReviewRequestError(error, "No se pudo optimizar la imagen.")
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
      supplierCost: numberOrNull(pricing.supplierCost),
      targetPrice: numberOrNull(pricing.targetPrice),
      estimatedEbayFees: numberOrNull(pricing.estimatedEbayFees),
      estimatedOutboundShipping: numberOrNull(pricing.estimatedOutboundShipping),
      returnsReserve: numberOrNull(pricing.returnsReserve),
      promotedListingsReserve: numberOrNull(pricing.promotedListingsReserve),
      estimatedNetProfit: numberOrNull(pricing.estimatedNetProfit),
      estimatedNetMarginPercent: numberOrNull(pricing.estimatedNetMarginPercent),
      estimatedRoiPercent: numberOrNull(pricing.estimatedRoiPercent),
      minimumProfitablePrice: numberOrNull(pricing.minimumProfitablePrice),
      passesProfitGate: booleanOrNull(pricing.passesProfitGate),
    },
    shipping: object(value.shipping),
  }
}

function taxonomyOptionAvailable(
  option: EbayTaxonomyAspect["values"][number],
  selectedAspects: Record<string, string>,
) {
  const dependencies = new Map<string, Set<string>>()
  for (const constraint of option.valueConstraints ?? []) {
    if (!constraint.applicableForAspectName || !constraint.applicableForAspectValues.length) {
      return false
    }
    const accepted = dependencies.get(constraint.applicableForAspectName) ?? new Set<string>()
    for (const value of constraint.applicableForAspectValues) accepted.add(value)
    dependencies.set(constraint.applicableForAspectName, accepted)
  }
  for (const [controlName, accepted] of dependencies) {
    if (!accepted.has(selectedAspects[controlName]?.trim() ?? "")) return false
  }
  return true
}

export default function EbayListingWorkspacePage() {
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null)
  const [listingPackage, setListingPackage] = useState<ListingPackage | null>(null)
  const [workspaceGateBlockers, setWorkspaceGateBlockers] = useState<string[]>([])
  const [workspaceMode, setWorkspaceMode] = useState<"CREATION" | "ACTIVE_MAINTENANCE">("CREATION")
  const [maintenance, setMaintenance] = useState<Record<string, unknown> | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [message, setMessage] = useState("Cargando datos reales del producto…")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [aspectName, setAspectName] = useState("")
  const [aspectValue, setAspectValue] = useState("")
  const [imageUrl, setImageUrl] = useState("")
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageAssets, setImageAssets] = useState<ImageAsset[]>([])
  const [imageBusy, setImageBusy] = useState(false)
  const [imageRevision, setImageRevision] = useState<ImageRevisionPayload | null>(null)
  const [imageRevisionBusy, setImageRevisionBusy] = useState(false)
  const [imageRevisionConfirmed, setImageRevisionConfirmed] = useState(false)
  const [imageRightsBasis, setImageRightsBasis] = useState("supplier_authorized")
  const [imageAuthorizationReference, setImageAuthorizationReference] = useState("")
  const [rightsEvidenceConfirmed, setRightsEvidenceConfirmed] = useState(false)
  const [draftConfiguration, setDraftConfiguration] = useState<DraftConfiguration>(emptyDraftConfiguration)
  const [draftState, setDraftState] = useState<DraftState>({})
  const [draftBusy, setDraftBusy] = useState(false)
  const [imagesAuthorized, setImagesAuthorized] = useState(false)
  const [approvalPhrase, setApprovalPhrase] = useState("")
  const [confirmUnpublishedOnly, setConfirmUnpublishedOnly] = useState(false)
  const [confirmNoPublish, setConfirmNoPublish] = useState(false)
  const [confirmProductionAccount, setConfirmProductionAccount] = useState(false)
  const [publishConfirmation, setPublishConfirmation] = useState("")
  const [confirmFinalPublication, setConfirmFinalPublication] = useState(false)
  const [confirmPublishProductionAccount, setConfirmPublishProductionAccount] = useState(false)
  const [skuCopied, setSkuCopied] = useState(false)
  const [activeRevisionItemId, setActiveRevisionItemId] = useState("")
  const [activeRevisionConfirmation, setActiveRevisionConfirmation] = useState("")
  const [activeRevisionApplication, setActiveRevisionApplication] = useState<Record<string, unknown> | null>(null)
  const [activeRevisionBusy, setActiveRevisionBusy] = useState(false)
  const activeRevisionIdempotency = useRef<{ scope: string; key: string } | null>(null)

  const imageRequest = useCallback(async (
    body?: Record<string, unknown> | FormData,
    packageId?: string,
    candidateKey?: string,
    revisionId?: string,
  ) => {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !data.session) throw new Error("La sesión Admin expiró.")
    const endpoint = body
      ? "/api/admin/ebay/images"
      : revisionId
        ? `/api/admin/ebay/images?revisionId=${encodeURIComponent(revisionId)}`
        : `/api/admin/ebay/images?packageId=${encodeURIComponent(packageId ?? "")}&candidateKey=${encodeURIComponent(candidateKey ?? "")}`
    const multipart = body instanceof FormData
    const response = await fetch(endpoint, {
      method: body ? "POST" : "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        ...(body && !multipart ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? multipart ? body : JSON.stringify(body) : undefined,
    })
    const payload = await readMobileReviewJson<Record<string, any>>(
      response,
      "No se pudo procesar la imagen",
    )
    if (!payload.success) throw new Error(getMobileReviewPayloadError(payload, "No se pudo procesar la imagen."))
    return payload
  }, [])

  const loadImageAssets = useCallback(async (packageId: string, candidateKey: string) => {
    try {
      const payload = await imageRequest(undefined, packageId, candidateKey)
      setImageAssets((payload.assets ?? []) as ImageAsset[])
    } catch (requestError) {
      setError(getMobileReviewRequestError(requestError, "No se pudo cargar el historial de imágenes."))
    }
  }, [imageRequest])

  const loadImageRevision = useCallback(async (revisionId: string) => {
    try {
      const payload = await imageRequest(undefined, undefined, undefined, revisionId)
      setImageRevision({
        revision: payload.revision,
        assets: Array.isArray(payload.assets) ? payload.assets : [],
      })
    } catch (requestError) {
      setError(getMobileReviewRequestError(
        requestError,
        "No se pudo recuperar la revisión corregida de imágenes.",
      ))
    }
  }, [imageRequest])

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
    const failureResponse = response.clone()
    let payload: Record<string, any>
    try {
      payload = await readMobileReviewJson<Record<string, any>>(
        response,
        "No se pudo abrir el workspace",
      )
    } catch (requestFailure) {
      const requestError = new Error(
        getMobileReviewRequestError(requestFailure, "No se pudo abrir el workspace."),
      ) as Error & { blockers?: string[] }
      try {
        const failurePayload = await failureResponse.json() as Record<string, unknown>
        requestError.blockers = Array.isArray(failurePayload.blockers)
          ? failurePayload.blockers.filter((item): item is string => typeof item === "string")
          : []
      } catch {
        requestError.blockers = []
      }
      throw requestError
    }
    if (!payload.success) {
      const requestError = new Error(
        getMobileReviewPayloadError(payload, "No se pudo abrir el workspace."),
      ) as Error & { blockers?: string[] }
      requestError.blockers = Array.isArray(payload.blockers)
        ? payload.blockers.filter((item: unknown): item is string => typeof item === "string")
        : []
      throw requestError
    }
    return payload
  }, [])

  const draftRequest = useCallback(async (
    body?: Record<string, unknown>,
    packageId?: string,
  ) => {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !data.session) throw new Error("La sesión Admin expiró.")
    const accountPolicyRequest = body?.action === "account_preflight"
      || body?.action === "start_inventory_location_oauth"
    const endpoint = accountPolicyRequest
      ? "/api/admin/ebay/account-policies"
      : body
        ? "/api/admin/ebay/draft-only"
        : `/api/admin/ebay/draft-only?packageId=${encodeURIComponent(packageId ?? "")}`
    const response = await fetch(endpoint, {
      method: body ? "POST" : "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body
        ? JSON.stringify(
          body.action === "account_preflight"
            ? { selection: body.selection }
            : body.action === "start_inventory_location_oauth"
              ? { action: "start_inventory_location_oauth" }
              : body,
        )
        : undefined,
    })
    const payload = await readMobileReviewJson<Record<string, any>>(
      response,
      body?.action === "account_preflight"
        ? "No se pudo consultar la configuración de cuenta eBay"
        : "No se pudo validar el draft no publicado",
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
    const requestedItemId = params.get("ebayItemId") ?? ""
    const maintenanceRequested = params.get("mode") === "maintenance" || /^\d{9,20}$/.test(requestedItemId)
    if (!opportunityId || !candidateKey) {
      setError("Abre este workspace desde una oportunidad de Seller Command Center.")
      setMessage("")
      return
    }
    void (async () => {
      try {
        const state = await request(undefined, opportunityId)
        const selected = state.selectedOpportunity as Opportunity
        setOpportunity(selected)
        setDraftConfiguration(initialDraftConfiguration(selected))
        let prepared: Record<string, any>
        try {
          prepared = await request(maintenanceRequested
            ? { action: "open_active_maintenance", opportunityId, candidateKey, ebayItemId: requestedItemId }
            : { action: "prepare_package", opportunityId, candidateKey })
        } catch (prepareError) {
          const gateBlockers = (prepareError as Error & { blockers?: string[] }).blockers ?? []
          const gatePending = gateBlockers.length > 0
            || (prepareError instanceof Error
              && prepareError.message.includes("COMMAND_CENTER_WORKSPACE_GATES_PENDING"))
          if (!gatePending) throw prepareError
          setWorkspaceGateBlockers(gateBlockers)
          setListingPackage(null)
          setDraftState({})
          setError(gateBlockers.length
            ? ""
            : getMobileReviewRequestError(prepareError, "No se pudo preparar el paquete."))
          setMessage(gateBlockers.length
            ? "La oportunidad conserva guardas pendientes. Puedes configurar y guardar las policies de la cuenta, pero el paquete seguirá bloqueado hasta resolverlas en Command Center."
            : "")
          return
        }
        const nextPackage = prepared.listingPackage as ListingPackage
        const nextMaintenance = object(prepared.maintenance)
        const activeMaintenance = prepared.workspaceMode === "ACTIVE_MAINTENANCE"
        setWorkspaceMode(activeMaintenance ? "ACTIVE_MAINTENANCE" : "CREATION")
        setMaintenance(activeMaintenance ? nextMaintenance : null)
        setWorkspaceGateBlockers([])
        setListingPackage(nextPackage)
        setForm(fromPackage(object(nextPackage.package_data)))
        setImageRevision(null)
        setDraftConfiguration({
          ...draftConfigurationFromPackage(object(nextPackage.package_data), selected),
          sku: reservedDraftSku(nextPackage.id),
        })
        void loadImageAssets(nextPackage.id, nextPackage.candidate_key)
        const preferredImageRevisionId = validUuid(
          object(nextPackage.package_data).preferredImageRevisionId,
        )
        if (preferredImageRevisionId) void loadImageRevision(preferredImageRevisionId)
        let draftWarning = ""
        if (activeMaintenance) {
          const itemId = String(nextMaintenance.ebayItemId ?? "")
          setActiveRevisionItemId(itemId)
          setDraftState({ publication: {
            phase: "verified_active",
            listing_id: itemId,
            verified_active_at: String(nextMaintenance.verifiedAt ?? ""),
          } as DraftState["publication"] })
        } else {
          try {
            const draft = await draftRequest(undefined, nextPackage.id)
            setDraftState(draft)
          } catch (draftError) {
            setDraftState({})
            draftWarning = ` ${getMobileReviewRequestError(draftError, "El conector draft todavía no pudo validarse.")}`
          }
        }
        const defaultsMessage = prepared.safeDefaultsApplied
          ? " Se precargaron únicamente políticas, ubicación o unidades desde tu listing propio verificado; el preflight las volverá a validar."
          : ""
        setMessage(activeMaintenance
          ? `Mantenimiento del listing ACTIVE ${String(nextMaintenance.ebayItemId ?? "")}. Las guardas de creación no se vuelven a ejecutar.`
          : `${prepared.created
          ? "Paquete interno creado con la evidencia más reciente."
          : prepared.evidenceRefreshed
            ? "Evidencia Luna/eBay actualizada; tus campos editados se conservaron."
            : "Continuaste el paquete guardado anteriormente."}${defaultsMessage}${draftWarning}`)
      } catch (requestError) {
        setError(getMobileReviewRequestError(requestError, "No se pudo abrir el workspace."))
        setMessage("")
      }
    })()
  }, [request, draftRequest, loadImageAssets, loadImageRevision])

  const approvedImageAssets = useMemo(() => imageAssets
    .filter((asset) => asset.status === "approved")
    .sort((left, right) => left.position - right.position), [imageAssets])
  const approvedBaseImageControlId = useMemo(() => {
    const controls = new Map<string, Set<string>>()
    for (const asset of approvedImageAssets) {
      const controlId = validUuid(asset.transformation?.sameDayImageControlId)
      const slot = String(asset.transformation?.slot ?? "").trim()
      if (!controlId || !slot) continue
      const slots = controls.get(controlId) ?? new Set<string>()
      slots.add(slot)
      controls.set(controlId, slots)
    }
    const exactSlots = [
      "MAIN_WHITE_BACKGROUND",
      "PACK_AND_COUNT",
      "KEY_FEATURES",
      "SIZE_AND_CONTENT",
      "USE_CONTEXT",
      "PACKAGE_CONTENTS",
    ]
    return [...controls].find(([, slots]) =>
      exactSlots.every((slot) => slots.has(slot)) && slots.size === 6
    )?.[0] ?? ""
  }, [approvedImageAssets])
  const requiredTaxonomyAspects = useMemo(() => new Set(
    draftState.taxonomy?.requiredAspects.map((aspect) => aspect.name) ?? [],
  ), [draftState.taxonomy])
  const safeDefaultsMetadata = useMemo(
    () => object(object(listingPackage?.package_data).safeDefaults),
    [listingPackage],
  )
  const resolvedWorkspaceGates = useMemo(() => {
    const approvedUrls = new Set(approvedImageAssets
      .map((asset) => asset.public_url)
      .filter((url): url is string => Boolean(url)))
    const imagesReady = form.imageUrls.length > 0 && form.imageUrls.every((url) => approvedUrls.has(url))
    const weightReady = Number(draftConfiguration.weight) > 0
      && ["POUND", "OUNCE", "KILOGRAM", "GRAM"].includes(draftConfiguration.weightUnit)
    const dimensionsReady = Number(draftConfiguration.length) > 0
      && Number(draftConfiguration.width) > 0
      && Number(draftConfiguration.height) > 0
      && ["INCH", "CENTIMETER"].includes(draftConfiguration.dimensionUnit)
    const aspectEntries = Object.entries(form.aspects)
    const taxonomyReady = /^\d{1,12}$/.test(form.categoryId)
      && aspectEntries.length > 0
      && [...requiredTaxonomyAspects].every((name) =>
        Boolean(form.aspects[name]?.trim())
      )
    return new Set([
      ...(imagesReady ? ["NEED_AUTHORIZED_PRODUCT_IMAGES"] : []),
      ...(weightReady ? ["NEED_PACKAGE_WEIGHT"] : []),
      ...(dimensionsReady ? ["NEED_PACKAGE_DIMENSIONS"] : []),
      ...(weightReady && dimensionsReady ? ["NEED_PACKAGE_WEIGHT_AND_DIMENSIONS"] : []),
      ...(taxonomyReady ? ["NEED_EBAY_TAXONOMY_CATEGORY", "NEED_REQUIRED_EBAY_ITEM_ASPECTS"] : []),
    ])
  }, [approvedImageAssets, draftConfiguration, form.aspects, form.categoryId, form.imageUrls, requiredTaxonomyAspects])
  const blockers = useMemo(() => [
    ...(!form.title ? ["Falta título"] : []),
    ...(!form.categoryId ? ["Falta categoría"] : []),
    ...(!form.description ? ["Falta descripción"] : []),
    ...(!form.imageUrls.length ? ["Faltan imágenes"] : []),
    ...(!(Number(form.pricing.targetPrice) > 0) ? ["Falta precio"] : []),
    ...(opportunity?.hard_gates ?? []).filter((gate) => !resolvedWorkspaceGates.has(gate)),
    ...(opportunity?.evidence_guards ?? []),
  ], [form, opportunity, resolvedWorkspaceGates])
  const draftTarget = draftState.runtime?.target ?? "PENDIENTE"
  const productionTarget = draftTarget === "PRODUCTION"
  const expectedApprovalPhrase = draftState.approvalRequirements?.exactPhrase
    ?? (productionTarget
      ? "CREAR DRAFT NO PUBLICADO EN PRODUCCIÓN"
      : draftTarget === "SANDBOX" ? "CREAR DRAFT NO PUBLICADO" : "")
  const executionCompleted = draftState.execution?.phase === "completed"
  const publicationPhase = draftState.publication?.phase ?? ""
  const maintenanceMode = workspaceMode === "ACTIVE_MAINTENANCE"
  const verifiedActiveItemId = draftState.publication?.verified_active_at
    && /^\d{9,20}$/.test(String(draftState.publication.listing_id ?? ""))
    ? String(draftState.publication.listing_id)
    : ""
  const activeRevisionExactPhrase = "APLICAR 6 IMAGENES AL LISTING ACTIVO"
  const activeRevisionPhase = String(activeRevisionApplication?.phase ?? "")
  const activeRevisionOutcomeUnknown = /OUTCOME_UNKNOWN|IN_FLIGHT|PENDING_RECONCILIATION/i
    .test(activeRevisionPhase)
  const activeRevisionApplied = /APPLIED|COMPLETED|VERIFIED/i.test(activeRevisionPhase)
  const finalPublishPhrase = draftState.publicationRequirements?.exactConfirmPublish
    ?? "PUBLICAR LISTING EN EBAY"
  const publicationPreview = object(draftState.publication?.preview)
  const publicationInventory = object(publicationPreview.inventoryItemPayload)
  const publicationProduct = object(publicationInventory.product)
  const publicationOffer = object(publicationPreview.offerPayload)
  const publicationPrice = object(object(publicationOffer.pricingSummary).price)
  const publicationPolicies = object(publicationOffer.listingPolicies)
  const approvalActive = draftState.approval?.status === "approved"
    && Date.parse(draftState.approval.expires_at) > Date.now()
  const effectiveDraftQuantity = productionTarget ? 1 : draftConfiguration.quantity
  const accountPreflightAutoStarted = useRef(false)
  const accountPreflightAutoSaveKey = useRef("")
  const accountPolicyProfileSaved = useRef(false)
  const accountPreflight = draftState.preflight
  const accountPoliciesSelected = [
    draftConfiguration.fulfillmentPolicyId,
    draftConfiguration.paymentPolicyId,
    draftConfiguration.returnPolicyId,
  ].every((value) => value.trim().length > 0)

  useEffect(() => {
    if (verifiedActiveItemId && !activeRevisionItemId) {
      setActiveRevisionItemId(verifiedActiveItemId)
    }
  }, [activeRevisionItemId, verifiedActiveItemId])

  useEffect(() => {
    setActiveRevisionApplication(null)
    setActiveRevisionConfirmation("")
  }, [imageRevision?.revision.id])

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
      setForm(fromPackage(object(payload.listingPackage?.package_data)))
      setMessage(markReady
        ? "Paquete listo para revisión humana. No se creó ni publicó nada en eBay."
        : `Guardado en servidor · ${new Intl.DateTimeFormat("es", { timeStyle: "short" }).format(new Date(payload.savedAt))}`)
    } catch (requestError) {
      const serverBlockers = (requestError as Error & { blockers?: string[] }).blockers ?? []
      setError(serverBlockers.length
        ? serverBlockers.map((blocker) => humanWorkspaceBlocker(blocker, form.pricing.minimumProfitablePrice)).join(" ")
        : getMobileReviewRequestError(requestError, "No se pudo guardar el paquete."))
      setMessage("")
    } finally { setBusy(false) }
  }

  async function copyReservedSku() {
    if (!draftConfiguration.sku) return
    try {
      await navigator.clipboard.writeText(draftConfiguration.sku)
      setSkuCopied(true)
      setError("")
      setMessage("SKU reservado copiado. Pégalo sin cambios en Custom label (SKU) de Seller Hub.")
    } catch {
      setSkuCopied(false)
      setError("No se pudo copiar automáticamente. Mantén presionado el SKU, cópialo completo y no lo modifiques.")
      setMessage("")
    }
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
    setForm(fromPackage(object(payload.listingPackage?.package_data)))
  }

  function assertImageEvidence() {
    if (imageAuthorizationReference.trim().length < 8) {
      throw new Error("EBAY_IMAGE_AUTHORIZATION_REFERENCE_REQUIRED")
    }
    if (!rightsEvidenceConfirmed) {
      throw new Error("EBAY_IMAGE_RIGHTS_EVIDENCE_CONFIRMATION_REQUIRED")
    }
  }

  async function generateImageRevision() {
    if (!approvedBaseImageControlId || imageRevisionBusy) return
    setImageRevisionBusy(true)
    setImageRevisionConfirmed(false)
    setError("")
    setMessage("Generando seis composiciones corregidas sin tocar eBay…")
    try {
      const payload = await imageRequest({
        action: "generate",
        baseControlId: approvedBaseImageControlId,
        reason: "IMAGE_COMPOSITOR_DEFECT",
        ...(imageRevision?.revision.status === "REJECTED"
          ? { requestKey: crypto.randomUUID() }
          : {}),
      })
      setImageRevision({
        revision: payload.revision,
        assets: Array.isArray(payload.assets) ? payload.assets : [],
      })
      setMessage(payload.revision?.status === "APPROVED"
        ? "La revisión corregida ya estaba aprobada y sigue lista para el próximo preview. No se escribió en eBay."
        : "Se prepararon seis imágenes nuevas. Compara las seis antes de aprobar o rechazar el conjunto completo.")
    } catch (requestError) {
      setError(getMobileReviewRequestError(
        requestError,
        "No se pudo generar la revisión corregida.",
      ))
      setMessage("")
    } finally {
      setImageRevisionBusy(false)
    }
  }

  async function decideImageRevision(decision: "APPROVE" | "REJECT") {
    const revisionId = validUuid(imageRevision?.revision.id)
    if (!revisionId || !imageRevisionConfirmed || imageRevisionBusy) return
    setImageRevisionBusy(true)
    setError("")
    setMessage(decision === "APPROVE"
      ? "Aprobando atómicamente las seis imágenes internas…"
      : "Rechazando atómicamente la revisión interna…")
    try {
      const payload = await imageRequest({
        action: "review",
        revisionId,
        decision,
        confirmed: true,
      })
      const reviewed = object(payload.reviewed)
      const approvedUrls = Array.isArray(reviewed.imageUrls)
        ? reviewed.imageUrls
          .map(httpsImageUrl)
          .filter((url): url is string => Boolean(url))
        : []
      if (decision === "APPROVE" && approvedUrls.length === 6) {
        setForm((current) => ({ ...current, imageUrls: approvedUrls }))
        setListingPackage((current) => current ? {
          ...current,
          package_data: {
            ...current.package_data,
            preferredImageRevisionId: revisionId,
            imageUrls: approvedUrls,
          },
        } : current)
      }
      await Promise.all([
        loadImageRevision(revisionId),
        listingPackage && opportunity
          ? loadImageAssets(listingPackage.id, opportunity.candidate_key)
          : Promise.resolve(),
      ])
      setImageRevisionConfirmed(false)
      setMessage(decision === "APPROVE"
        ? "Revisión APPROVED: las seis imágenes quedaron preferidas en el paquete interno. No se cambió Inventory Item, Offer ni listing eBay."
        : "Revisión rechazada y conservada como historial. El set anterior continúa intacto.")
    } catch (requestError) {
      setError(getMobileReviewRequestError(
        requestError,
        "No se pudo guardar la decisión sobre las seis imágenes.",
      ))
      setMessage("")
    } finally {
      setImageRevisionBusy(false)
    }
  }

  function getActiveRevisionIdempotencyKey(revisionId: string, ebayItemId: string) {
    const scope = `${revisionId}:${ebayItemId}`
    if (activeRevisionIdempotency.current?.scope === scope) {
      return activeRevisionIdempotency.current.key
    }
    const storageKey = `ebay-active-image-revision:${scope}`
    let idempotencyKey = ""
    try {
      idempotencyKey = validUuid(window.sessionStorage.getItem(storageKey))
      if (!idempotencyKey) {
        idempotencyKey = crypto.randomUUID()
        window.sessionStorage.setItem(storageKey, idempotencyKey)
      }
    } catch {
      idempotencyKey = crypto.randomUUID()
    }
    activeRevisionIdempotency.current = { scope, key: idempotencyKey }
    return idempotencyKey
  }

  async function applyApprovedRevisionToActiveListing() {
    const revisionId = validUuid(imageRevision?.revision.id)
    const baseControlId = validUuid(imageRevision?.revision.base_control_id)
    const ebayItemId = activeRevisionItemId.trim()
    if (imageRevision?.revision.status !== "APPROVED" || !revisionId
      || !baseControlId || !verifiedActiveItemId
      || ebayItemId !== verifiedActiveItemId
      || activeRevisionConfirmation !== activeRevisionExactPhrase
      || activeRevisionBusy) return
    const idempotencyKey = getActiveRevisionIdempotencyKey(revisionId, ebayItemId)
    setActiveRevisionBusy(true)
    setError("")
    setMessage(activeRevisionOutcomeUnknown
      ? "Reconciliando la misma operación idempotente; no se enviará una segunda mutación…"
      : "Aplicando únicamente las seis imágenes aprobadas al listing ACTIVE verificado…")
    try {
      const payload = await imageRequest({
        action: "apply_active_revision",
        revisionId,
        baseControlId,
        ebayItemId,
        idempotencyKey,
        confirmation: activeRevisionExactPhrase,
      })
      const application = object(
        payload.application ?? payload.activeRevision ?? payload.result ?? payload,
      )
      const phase = String(application.phase ?? payload.phase ?? "COMPLETED")
      setActiveRevisionApplication({ ...application, phase })
      setMessage(/OUTCOME_UNKNOWN|IN_FLIGHT|PENDING_RECONCILIATION/i.test(phase)
        ? "El resultado todavía es incierto. Conservamos la misma clave; usa Reconciliar para consultar sin repetir la escritura."
        : /APPLIED|COMPLETED|VERIFIED/i.test(phase)
          ? "Las seis imágenes aprobadas quedaron aplicadas y verificadas en el mismo listing ACTIVE. No se modificaron SKU, precio ni cantidad."
          : `Operación registrada en fase ${phase}.`)
    } catch (requestError) {
      setActiveRevisionApplication({
        phase: "OUTCOME_UNKNOWN",
        error: getMobileReviewRequestError(
          requestError,
          "No fue posible confirmar el resultado de la actualización.",
        ),
      })
      setMessage("Resultado desconocido: no cambies el Item ID ni la frase. Reconciliar reutilizará exactamente la misma clave idempotente.")
    } finally {
      setActiveRevisionBusy(false)
    }
  }

  async function optimizeImageUrl(sourceUrl = imageUrl) {
    if (!opportunity || !listingPackage || imageBusy) return
    setImageBusy(true); setError(""); setMessage("Optimizando sin alterar el producto…")
    try {
      assertImageEvidence()
      const payload = await imageRequest({
        action: "optimize_url",
        candidateKey: opportunity.candidate_key,
        opportunityId: opportunity.id,
        listingPackageId: listingPackage.id,
        sourceUrl,
        assetRole: "main",
        rightsBasis: imageRightsBasis,
        authorizationReference: imageAuthorizationReference,
        rightsEvidenceConfirmed,
      })
      setImageUrl("")
      await loadImageAssets(listingPackage.id, opportunity.candidate_key)
      setMessage(payload.created === false
        ? "Esta versión optimizada ya existía; se recuperó para revisión."
        : "Versión 1600×1600 preparada. Compárala con el original y apruébala manualmente.")
    } catch (requestError) {
      setError(humanImageError(requestError)); setMessage("")
    } finally { setImageBusy(false) }
  }

  async function optimizeImageUpload() {
    if (!opportunity || !listingPackage || !imageFile || imageBusy) return
    setImageBusy(true); setError(""); setMessage("Subiendo y optimizando la foto propia…")
    try {
      assertImageEvidence()
      const body = new FormData()
      body.set("action", "optimize_upload")
      body.set("candidateKey", opportunity.candidate_key)
      body.set("opportunityId", opportunity.id)
      body.set("listingPackageId", listingPackage.id)
      body.set("assetRole", "main")
      body.set("rightsBasis", imageRightsBasis)
      body.set("authorizationReference", imageAuthorizationReference)
      body.set("rightsEvidenceConfirmed", "true")
      body.set("file", imageFile)
      await imageRequest(body)
      setImageFile(null)
      await loadImageAssets(listingPackage.id, opportunity.candidate_key)
      setMessage("Foto optimizada a 1600×1600. Falta comparar y aprobar el resultado.")
    } catch (requestError) {
      setError(humanImageError(requestError)); setMessage("")
    } finally { setImageBusy(false) }
  }

  async function reviewImage(asset: ImageAsset, action: "approve" | "reject") {
    if (!opportunity || !listingPackage || imageBusy) return
    if (action === "approve" && !window.confirm(
      "Confirma que la imagen muestra exactamente el mismo producto, variante, color, piezas y contenido del paquete, sin textos ni marcas de agua añadidos.",
    )) return
    setImageBusy(true); setError(""); setMessage(action === "approve" ? "Registrando aprobación…" : "Rechazando imagen…")
    try {
      const payload = await imageRequest({
        action,
        assetId: asset.id,
        listingPackageId: listingPackage.id,
      })
      if (Array.isArray(payload.imageUrls)) {
        setForm((current) => ({ ...current, imageUrls: payload.imageUrls }))
        setImagesAuthorized(false)
      }
      if (action === "approve") {
        setDraftConfiguration((current) => ({
          ...current,
          imageRightsBasis,
          imageSource: imageRightsBasis === "owned"
            ? "owned"
            : imageRightsBasis === "licensed"
              ? "licensed_asset"
              : "luna",
        }))
      }
      await loadImageAssets(listingPackage.id, opportunity.candidate_key)
      setMessage(action === "approve"
        ? "Imagen aprobada y vinculada al paquete. La autorización final del draft sigue siendo separada."
        : "Imagen rechazada y retirada del paquete.")
    } catch (requestError) {
      setError(humanImageError(requestError)); setMessage("")
    } finally { setImageBusy(false) }
  }

  async function moveApprovedImage(assetId: string, direction: -1 | 1) {
    if (!opportunity || !listingPackage || imageBusy) return
    const approved = imageAssets.filter((asset) => asset.status === "approved")
      .sort((left, right) => left.position - right.position)
    const index = approved.findIndex((asset) => asset.id === assetId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= approved.length) return
    const next = [...approved]
    ;[next[index], next[target]] = [next[target], next[index]]
    setImageBusy(true)
    try {
      const payload = await imageRequest({
        action: "reorder",
        listingPackageId: listingPackage.id,
        orderedAssetIds: next.map((asset) => asset.id),
      })
      if (Array.isArray(payload.imageUrls)) {
        setForm((current) => ({ ...current, imageUrls: payload.imageUrls }))
      }
      await loadImageAssets(listingPackage.id, opportunity.candidate_key)
    } catch (requestError) {
      setError(humanImageError(requestError))
    } finally { setImageBusy(false) }
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
      const accountPolicyProfileSaved = payload.accountPolicyProfileSaved === true
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
        ? accountPolicyProfileSaved
          ? "Preflight eBay listo. Policies guardadas para reutilización automática; no se realizó ninguna escritura eBay."
          : "Preflight eBay listo por 5 minutos. No se realizó ninguna escritura."
        : preflight.identity.status === "IDENTITY_UNBOUND"
          ? "OAuth respondió. Copia el fingerprint mostrado y configúralo como EXPECTED_ACCOUNT_FINGERPRINT de esta rama antes de aprobar."
          : `Preflight read-only pendiente: ${preflight.snapshotStatus.replaceAll("_", " ")}.`)
    } catch (requestError) {
      setError(getMobileReviewRequestError(requestError, "No se pudo consultar la configuración eBay.")); setMessage("")
    } finally { setDraftBusy(false) }
  }

  async function runAccountPreflight() {
    setDraftBusy(true); setError(""); setMessage("Consultando la configuración de cuenta eBay en modo sólo lectura…")
    try {
      const payload = await draftRequest({
        action: "account_preflight",
        selection: {
          fulfillmentPolicyId: draftConfiguration.fulfillmentPolicyId,
          paymentPolicyId: draftConfiguration.paymentPolicyId,
          returnPolicyId: draftConfiguration.returnPolicyId,
          merchantLocationKey: draftConfiguration.merchantLocationKey,
        },
      })
      const preflight = payload.preflight as EbayMobilePreflight
      const profileSaved = payload.accountPolicyProfileSaved === true
      accountPolicyProfileSaved.current = profileSaved
      const policiesComplete = [
        preflight.selection.fulfillmentPolicyId,
        preflight.selection.paymentPolicyId,
        preflight.selection.returnPolicyId,
      ].every((value) => value.trim().length > 0)
      setDraftState((current) => ({ ...current, ...payload, preflight }))
      setDraftConfiguration((current) => ({
        ...current,
        fulfillmentPolicyId: preflight.selection.fulfillmentPolicyId,
        paymentPolicyId: preflight.selection.paymentPolicyId,
        returnPolicyId: preflight.selection.returnPolicyId,
        merchantLocationKey: preflight.selection.merchantLocationKey,
        ebayPreflightSnapshot: "",
      }))
      setMessage(profileSaved
        ? "Policies de cuenta revalidadas y guardadas. No se creó ni publicó nada en eBay."
        : preflight.identity.status !== "BOUND"
          ? "eBay respondió, pero la identidad de la cuenta debe quedar vinculada antes de guardar policies."
          : !preflight.privilege.usable
            ? "eBay respondió, pero la cuenta todavía no tiene privilegios utilizables para guardar esta configuración."
            : preflight.options.merchantLocations.length === 0
              ? "eBay no devolvió merchant locations. La autorización disponible solicita sell.inventory y, tras tu consentimiento e identidad, crea una sola vez la ubicación fija luna-boca-raton-fl. No publica listings."
            : policiesComplete
              ? "Policies revalidadas. El perfil no fue guardado; revisa la configuración de cuenta antes de continuar."
              : "Opciones cargadas desde eBay. Selecciona fulfillment, payment y returns; luego vuelve a revalidar para guardarlas.")
    } catch (requestError) {
      setError(getMobileReviewRequestError(requestError, "No se pudo consultar la configuración de cuenta eBay."))
      setMessage("")
    } finally { setDraftBusy(false) }
  }

  async function startInventoryLocationOAuth() {
    setDraftBusy(true)
    setError("")
    setMessage(
      "Preparando autorización eBay para crear una sola vez la ubicación fija luna-boca-raton-fl…",
    )
    try {
      const payload = await draftRequest({
        action: "start_inventory_location_oauth",
      })
      const authorization = object(payload.authorization)
      const authorizationUrl = String(authorization.authorizationUrl ?? "")
      const expiresAt = String(authorization.expiresAt ?? "")
      const redirect = new URL(authorizationUrl)
      if (
        !expiresAt
        || redirect.origin !== "https://auth.ebay.com"
        || redirect.pathname !== "/oauth2/authorize"
      ) {
        throw new Error("EBAY_MERCHANT_LOCATION_OAUTH_RESPONSE_INVALID")
      }
      setMessage(
        "Redirigiendo a eBay. Tras tu consentimiento e identidad se creará una sola vez luna-boca-raton-fl; no se publicará ningún listing.",
      )
      window.location.assign(redirect.toString())
    } catch (requestError) {
      setError(getMobileReviewRequestError(
        requestError,
        "No se pudo iniciar la autorización para crear la merchant location.",
      ))
      setMessage("")
    } finally {
      setDraftBusy(false)
    }
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

  useEffect(() => {
    if (accountPreflightAutoStarted.current) return
    accountPreflightAutoStarted.current = true
    void runAccountPreflight()
    // The initial account read is intentionally executed once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!accountPreflight || draftBusy || accountPolicyProfileSaved.current) return
    const selection = [
      draftConfiguration.fulfillmentPolicyId,
      draftConfiguration.paymentPolicyId,
      draftConfiguration.returnPolicyId,
      draftConfiguration.merchantLocationKey,
    ]
    if (!selection.every((value) => value.trim().length > 0)) return
    const selectionKey = selection.join(":")
    if (accountPreflightAutoSaveKey.current === selectionKey) return
    accountPreflightAutoSaveKey.current = selectionKey
    void runAccountPreflight()
    // Revalidate only when a complete selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    accountPreflight,
    draftBusy,
    draftConfiguration.fulfillmentPolicyId,
    draftConfiguration.paymentPolicyId,
    draftConfiguration.returnPolicyId,
    draftConfiguration.merchantLocationKey,
  ])

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
      const taxonomy = payload.taxonomy as DraftState["taxonomy"]
      const requiredAspects = taxonomy?.status === "AVAILABLE"
        ? taxonomy.requiredAspects.map((aspect) => aspect.name).filter(Boolean)
        : []
      if (requiredAspects.length) {
        setForm((current) => ({
          ...current,
          categoryName: current.categoryName || taxonomy?.categoryName || "",
          aspects: {
            ...Object.fromEntries(requiredAspects.map((name) => [name, ""])),
            ...current.aspects,
          },
        }))
      }
      setMessage(payload.readiness?.ready
        ? `Draft listo para tu aprobación. Validaremos todo otra vez antes de tocar eBay ${payload.runtime?.target ?? draftTarget}.`
        : requiredAspects.length
          ? `eBay confirmó ${requiredAspects.length} aspectos obligatorios para esta categoría. Completa los valores vacíos; faltan ${payload.readiness?.blockers?.length ?? 0} validaciones en total.`
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
      setMessage(`Draft registrado en ${payload.draft?.target ?? draftTarget}: ${verification}. No se llamó a publicar; la ausencia de listing se verificó en ese momento.`)
    } catch (requestError) {
      setError(getMobileReviewRequestError(requestError, "No se pudo crear el draft no publicado.")); setMessage("")
    } finally { setDraftBusy(false) }
  }

  async function prepareFinalPublication() {
    if (!draftState.execution?.id) return
    setDraftBusy(true); setError(""); setMessage("Preparando el preview final exacto sin publicar…")
    try {
      const payload = await draftRequest({
        action: "prepare_publish",
        executionId: draftState.execution.id,
      })
      setDraftState((current) => ({
        ...current,
        publication: payload.publication,
        publicationRequirements: payload.publicationRequirements,
      }))
      setMessage("Preview final persistido. Revisa precio, cantidad, imágenes, policies y ubicación antes de autorizar.")
    } catch (requestError) {
      setError(getMobileReviewRequestError(requestError, "No se pudo preparar el preview final.")); setMessage("")
    } finally { setDraftBusy(false) }
  }

  async function publishFinalListing() {
    if (!draftState.publication?.id) return
    setDraftBusy(true); setError(""); setMessage("Publicando una sola vez y verificando ACTIVE…")
    try {
      const payload = await draftRequest({
        action: "publish",
        publicationId: draftState.publication.id,
        idempotencyKey: `publish:${draftState.publication.id}`,
        confirmPublish: publishConfirmation,
        confirmFinalPreview: confirmFinalPublication,
        confirmProductionAccount: confirmPublishProductionAccount,
      })
      setDraftState((current) => ({ ...current, publication: payload.publication }))
      setMessage(payload.monitoring?.registered
        ? `Listing ${payload.listing?.listingId} ACTIVE y registrado en monitoreo.`
        : `Listing ${payload.listing?.listingId} publicado; eBay aún no confirma ACTIVE. Usa reconciliar, nunca vuelvas a publicar.`)
    } catch (requestError) {
      setError(getMobileReviewRequestError(requestError, "No se pudo completar la publicación autorizada.")); setMessage("")
    } finally { setDraftBusy(false) }
  }

  async function reconcileFinalListing() {
    if (!draftState.publication?.id) return
    setDraftBusy(true); setError(""); setMessage("Reconciliando por lectura; no se volverá a llamar publishOffer…")
    try {
      const payload = await draftRequest({
        action: "reconcile_publish",
        publicationId: draftState.publication.id,
      })
      setDraftState((current) => ({ ...current, publication: payload.publication }))
      setMessage(payload.monitoring?.registered
        ? `Listing ${payload.listing?.listingId} ACTIVE y registrado en monitoreo.`
        : `Listing ${payload.listing?.listingId} sigue pendiente de verificación ACTIVE.`)
    } catch (requestError) {
      setError(getMobileReviewRequestError(requestError, "No se pudo reconciliar el listing publicado.")); setMessage("")
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
          <p className="mt-3 text-xs font-black uppercase tracking-widest text-emerald-100/70">Paso 4 · Draft / listing manual</p>
          <h1 className="mt-1 text-2xl font-black">Workspace del producto</h1>
        </header>

        {error && <p role="alert" className="rounded-2xl border border-rose-200/30 bg-rose-200/[0.08] p-4 text-sm font-bold text-rose-50">{error}</p>}
        {message && <p aria-live="polite" className="rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.06] p-3 text-sm text-cyan-50">{message}</p>}
        {maintenanceMode && <section className="rounded-3xl border border-emerald-200/30 bg-emerald-200/[0.07] p-4"><p className="text-xs font-black uppercase tracking-widest text-emerald-100/70">Mantenimiento ACTIVE</p><h2 className="mt-1 text-xl font-black">Item {String(maintenance?.ebayItemId ?? "")}</h2><p className="mt-2 text-sm leading-6 text-white/65">Cuenta, SKU y estado ACTIVE ya fueron verificados. Aquí sólo se revisan título e imágenes; no se repiten policies ni guardas de creación.</p></section>}

        <section aria-labelledby="ebay-account-configuration-heading" className={`${maintenanceMode ? "hidden" : ""} space-y-4 rounded-3xl border border-cyan-200/25 bg-cyan-200/[0.05] p-4`}>
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-cyan-100/65">Configuración independiente del producto</p>
            <h2 id="ebay-account-configuration-heading" className="mt-1 text-xl font-black">Policies de la cuenta eBay</h2>
            <p className="mt-2 text-sm leading-6 text-white/65">Carga las opciones oficiales de la cuenta y revalida tu selección. Este paso no prepara el paquete ni habilita ninguna escritura o publicación eBay.</p>
          </div>
          {workspaceGateBlockers.length > 0 && <div role="status" className="rounded-2xl border border-amber-200/30 bg-amber-200/[0.08] p-3 text-amber-50">
            <strong className="text-sm">El paquete sigue bloqueado por estas guardas:</strong>
            <ul className="mt-2 space-y-2 text-xs">
              {workspaceGateBlockers.map((blocker) => <li key={blocker} className="rounded-xl bg-black/20 p-2"><code className="block break-all font-black text-amber-100">{blocker}</code><span className="mt-1 block text-amber-50/75">{humanWorkspaceBlocker(blocker, form.pricing.minimumProfitablePrice)}</span></li>)}
            </ul>
            <a href="/admin/ebay/mobile-review" className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-amber-100/30 px-3 text-sm font-black">Resolver en Command Center</a>
          </div>}
          {accountPreflight && <dl className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/45">Identidad</dt><dd className="mt-1 font-black">{accountPreflight.identity.status.replaceAll("_", " ")}</dd></div>
            <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/45">Privilegios</dt><dd className="mt-1 font-black">{accountPreflight.privilege.usable ? "UTILIZABLES" : "PENDIENTES"}</dd></div>
          </dl>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className="text-sm font-black">Fulfillment policy</span><select value={draftConfiguration.fulfillmentPolicyId} onChange={(event) => updatePreflightSelection("fulfillmentPolicyId", event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-3"><option value="">Seleccionar fulfillment</option>{draftConfiguration.fulfillmentPolicyId && !accountPreflight?.options.fulfillmentPolicies.some((option) => option.id === draftConfiguration.fulfillmentPolicyId) && <option value={draftConfiguration.fulfillmentPolicyId}>{draftConfiguration.fulfillmentPolicyId} · revalidar</option>}{accountPreflight?.options.fulfillmentPolicies.map((option) => <option key={option.id} value={option.id} disabled={!option.usable}>{option.name} · {option.id}{option.usable ? "" : " · no apta"}</option>)}</select></label>
            <label><span className="text-sm font-black">Payment policy</span><select value={draftConfiguration.paymentPolicyId} onChange={(event) => updatePreflightSelection("paymentPolicyId", event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-3"><option value="">Seleccionar payment</option>{draftConfiguration.paymentPolicyId && !accountPreflight?.options.paymentPolicies.some((option) => option.id === draftConfiguration.paymentPolicyId) && <option value={draftConfiguration.paymentPolicyId}>{draftConfiguration.paymentPolicyId} · revalidar</option>}{accountPreflight?.options.paymentPolicies.map((option) => <option key={option.id} value={option.id} disabled={!option.usable}>{option.name} · {option.id}{option.usable ? " · pago inmediato" : " · no apta"}</option>)}</select></label>
            <label><span className="text-sm font-black">Return policy</span><select value={draftConfiguration.returnPolicyId} onChange={(event) => updatePreflightSelection("returnPolicyId", event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-3"><option value="">Seleccionar returns</option>{draftConfiguration.returnPolicyId && !accountPreflight?.options.returnPolicies.some((option) => option.id === draftConfiguration.returnPolicyId) && <option value={draftConfiguration.returnPolicyId}>{draftConfiguration.returnPolicyId} · revalidar</option>}{accountPreflight?.options.returnPolicies.map((option) => <option key={option.id} value={option.id} disabled={!option.usable}>{option.name} · {option.id}{option.usable ? "" : " · no apta"}</option>)}</select></label>
            <label><span className="text-sm font-black">Merchant location</span><select value={draftConfiguration.merchantLocationKey} onChange={(event) => updatePreflightSelection("merchantLocationKey", event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-3"><option value="">Seleccionar location</option>{draftConfiguration.merchantLocationKey && !accountPreflight?.options.merchantLocations.some((option) => option.id === draftConfiguration.merchantLocationKey) && <option value={draftConfiguration.merchantLocationKey}>{draftConfiguration.merchantLocationKey} · revalidar</option>}{accountPreflight?.options.merchantLocations.map((option) => <option key={option.id} value={option.id} disabled={!option.usable}>{option.name} · {option.id}{option.usable ? "" : " · disabled"}</option>)}</select></label>
          </div>
          <button type="button" disabled={draftBusy} onClick={() => void runAccountPreflight()} className="min-h-13 w-full rounded-2xl bg-cyan-200 px-4 font-black text-black disabled:opacity-50">{draftBusy ? "Consultando eBay…" : !accountPreflight ? "Cargar configuración desde eBay" : accountPoliciesSelected ? "Revalidar y guardar policies" : "Revalidar selección"}</button>
          <p className="text-xs leading-5 text-white/50">Sólo consulta Account API y guarda la selección verificada en IMNOVA. No crea Inventory Item, Offer ni listing; publicar permanece prohibido.</p>
        </section>

        {opportunity && listingPackage && <>
          <section className={`${maintenanceMode ? "hidden" : ""} rounded-3xl border border-emerald-200/25 bg-emerald-200/[0.06] p-4`}>
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase text-emerald-100/65">Datos reales de Luna + evidencia eBay</p><h2 className="mt-2 text-xl font-black">{opportunity.product_title}</h2><p className="mt-1 text-sm text-white/60">{opportunity.variant_title ?? "Variante general"} · {opportunity.supplier_sku ?? "SKU pendiente"}</p></div><strong className="rounded-2xl bg-white px-3 py-2 text-xl text-black">{Math.round(Number(opportunity.opportunity_score))}</strong></div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs"><div><dt className="text-white/50">Costo Luna</dt><dd className="font-black">{opportunity.supplier_price == null ? "Pendiente" : `$${Number(opportunity.supplier_price).toFixed(2)}`}</dd></div><div><dt className="text-white/50">Stock</dt><dd className="font-black">{opportunity.supplier_inventory_quantity ?? "Pendiente"}</dd></div><div><dt className="text-white/50">Fuente</dt><dd className="font-black">{listingPackage.source_observed_at ? new Date(listingPackage.source_observed_at).toLocaleDateString("es") : "Pendiente"}</dd></div></dl>
            <div className="mt-4 rounded-2xl border border-amber-200/25 bg-amber-200/[0.06] p-3 text-xs leading-5 text-amber-50">
              <strong>Publicación manual segura:</strong>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Copia el SKU reservado y pégalo sin cambios en <strong>Custom label (SKU)</strong>.</li>
                <li>El botón abre el CTA real de <strong>Single listing</strong>; completa el formulario y publica manualmente desde tu cuenta oficial.</li>
                <li>Regresa y registra el Item ID para que el OS verifique cuenta, producto y variante.</li>
              </ol>
              <span className="mt-2 block break-all rounded-xl bg-black/25 p-2 font-mono font-black text-white">{draftConfiguration.sku}</span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => void copyReservedSku()} disabled={!draftConfiguration.sku} className="min-h-12 rounded-2xl bg-white px-4 text-sm font-black text-black disabled:opacity-40">{skuCopied ? "✓ SKU copiado" : "1. Copiar SKU reservado"}</button>
              <a href="https://www.ebay.com/sl/prelist/home?sr=shListingsCTA" className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-cyan-200/30 px-4 text-center text-sm font-black text-cyan-50">2. Abrir Create listing en Seller Hub</a>
            </div>
            <a href={`/admin/ebay/listings/register?opportunityId=${encodeURIComponent(opportunity.id)}&candidateKey=${encodeURIComponent(opportunity.candidate_key)}&supplierSku=${encodeURIComponent(opportunity.supplier_sku ?? "")}&supplierVariantId=${encodeURIComponent(opportunity.supplier_variant_id ?? "")}&expectedSku=${encodeURIComponent(draftConfiguration.sku)}`} className="mt-2 inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-emerald-200/30 px-4 text-center text-sm font-black text-emerald-50">3. Ya está publicado · registrar Item ID</a>
            {safeDefaultsMetadata.source === "EBAY_OBSERVED_OWN_LISTING_TEMPLATE" && Array.isArray(safeDefaultsMetadata.appliedFields) && safeDefaultsMetadata.appliedFields.length > 0 && <div className="mt-3 rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.05] p-3 text-xs leading-5 text-cyan-50"><strong>Autocompletado desde la lectura oficial de tu listing:</strong> {safeDefaultsMetadata.appliedFields.join(", ")}. No se reutilizaron título, descripción, imágenes ni valores de aspectos; todo se revalida contra eBay.</div>}
          </section>

          <section className="space-y-4 rounded-3xl border border-white/15 bg-white/[0.04] p-4">
            <label className="block"><span className="font-black">Título eBay · máximo 80 caracteres</span><input value={form.title} maxLength={80} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-4" /><span className="mt-1 block text-right text-xs text-white/50">{form.title.length}/80</span></label>
            <div className="grid gap-3 sm:grid-cols-2"><label><span className="font-black">Category ID</span><input inputMode="numeric" value={form.categoryId} onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value.replace(/\D/g, "") }))} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-4" /></label><label><span className="font-black">Categoría</span><input value={form.categoryName} onChange={(event) => setForm((current) => ({ ...current, categoryName: event.target.value }))} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-4" /></label></div>
            <div className="rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.04] p-3">
              <label className="block"><span className="font-black">Precio objetivo USD</span><input inputMode="decimal" value={form.pricing.targetPrice ?? ""} onChange={(event) => setForm((current) => ({ ...current, pricing: {
                ...current.pricing,
                targetPrice: event.target.value ? Number(event.target.value) : null,
                estimatedEbayFees: null,
                estimatedOutboundShipping: null,
                returnsReserve: null,
                promotedListingsReserve: null,
                estimatedNetProfit: null,
                estimatedNetMarginPercent: null,
                estimatedRoiPercent: null,
                minimumProfitablePrice: null,
                passesProfitGate: null,
              } }))} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-4" /></label>
              <button type="button" disabled={busy || !(Number(form.pricing.targetPrice) > 0)} onClick={() => void save(false)} className="mt-2 min-h-11 w-full rounded-xl border border-cyan-200/30 px-3 text-sm font-black text-cyan-50 disabled:opacity-40">{busy ? "Recalculando…" : "Guardar y recalcular rentabilidad"}</button>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                <div className="rounded-xl bg-black/25 p-2"><span className="text-white/50">Costo Luna</span><strong className="mt-1 block">{money(form.pricing.supplierCost)}</strong></div>
                <div className="rounded-xl bg-black/25 p-2"><span className="text-white/50">Tarifas eBay est.</span><strong className="mt-1 block">{money(form.pricing.estimatedEbayFees)}</strong></div>
                <div className="rounded-xl bg-black/25 p-2"><span className="text-white/50">Envío estimado</span><strong className="mt-1 block">{money(form.pricing.estimatedOutboundShipping)}</strong></div>
                <div className="rounded-xl bg-black/25 p-2"><span className="text-white/50">Beneficio neto est.</span><strong className="mt-1 block">{money(form.pricing.estimatedNetProfit)}</strong></div>
                <div className="rounded-xl bg-black/25 p-2"><span className="text-white/50">Margen neto</span><strong className="mt-1 block">{percent(form.pricing.estimatedNetMarginPercent)}</strong></div>
                <div className="rounded-xl bg-black/25 p-2"><span className="text-white/50">ROI estimado</span><strong className="mt-1 block">{percent(form.pricing.estimatedRoiPercent)}</strong></div>
              </div>
              <div className={`mt-3 rounded-xl border p-3 text-xs leading-5 ${form.pricing.passesProfitGate === true ? "border-emerald-200/25 text-emerald-50" : form.pricing.passesProfitGate === false ? "border-rose-200/25 text-rose-50" : "border-amber-200/25 text-amber-50"}`}>
                {form.pricing.passesProfitGate === true
                  ? "Rentabilidad mínima superada con las reservas configuradas."
                  : form.pricing.passesProfitGate === false
                    ? `Precio insuficiente. Precio mínimo estimado: ${money(form.pricing.minimumProfitablePrice)}.`
                    : "Guarda para recalcular tarifas, envío, reservas, beneficio, margen y ROI en el servidor."}
                {form.pricing.returnsReserve !== null && form.pricing.promotedListingsReserve !== null && <span className="mt-1 block text-white/50">Incluye reserva por devoluciones {money(form.pricing.returnsReserve)} y promoción {money(form.pricing.promotedListingsReserve)}. Son estimaciones; eBay confirma los cargos reales.</span>}
              </div>
            </div>
            <label className="block"><span className="font-black">Descripción propia con hechos verificados</span><textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={8} className="mt-2 w-full rounded-2xl border border-white/20 bg-black/30 p-4" /><span className="mt-1 block text-xs leading-5 text-white/50">Usa datos confirmados de Luna/proveedor. No copies texto, promesas ni especificaciones de competidores.</span></label>
          </section>

          <section className="rounded-3xl border border-cyan-200/20 bg-cyan-200/[0.04] p-4">
            <p className="text-xs font-black uppercase tracking-widest text-cyan-100/65">Pipeline seguro de imágenes</p>
            <h2 className="mt-1 text-xl font-black">Fondo blanco y 1600×1600</h2>
            <p className="mt-2 text-sm leading-6 text-white/60">El optimizador es determinista: limpia únicamente fondos claros, centra el producto y no inventa piezas. Cada resultado queda pendiente hasta compararlo y aprobarlo.</p>
            <div className="mt-3 rounded-2xl border border-emerald-200/20 bg-emerald-200/[0.05] p-3 text-xs leading-5 text-emerald-50"><strong>Protección:</strong> no se usan imágenes de competidores, no se genera el producto desde cero y la imagen original queda identificada por hash.</div>

            <div className="mt-4 rounded-2xl border border-cyan-200/30 bg-[#071820] p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100/60">Corrección append-only</p><h3 className="mt-1 font-black">Revisión estratégica de seis imágenes</h3><p className="mt-1 text-xs leading-5 text-white/55">Motivo predeterminado: <strong>IMAGE_COMPOSITOR_DEFECT</strong>. El set aprobado anterior nunca se borra ni se desactiva.</p></div>
                <span className={`rounded-full border px-2 py-1 text-[10px] font-black ${approvedBaseImageControlId ? "border-emerald-200/30 text-emerald-100" : "border-amber-200/30 text-amber-100"}`}>{approvedBaseImageControlId ? "CONTROL BASE APPROVED" : "SIN CONTROL BASE EXACT-SIX"}</span>
              </div>
              <button type="button" disabled={!approvedBaseImageControlId || imageRevisionBusy} onClick={() => void generateImageRevision()} className="mt-3 min-h-12 w-full rounded-xl bg-cyan-200 px-4 text-sm font-black text-black disabled:opacity-40">{imageRevisionBusy ? "Procesando las seis…" : imageRevision ? "Actualizar vistas de la revisión" : "Generar revisión corregida"}</button>
              {!approvedBaseImageControlId && <p className="mt-2 text-xs leading-5 text-amber-50">Esta acción aparece únicamente cuando el candidato conserva seis slots aprobados ligados al mismo control. El servidor vuelve a comprobar que el control esté APPROVED.</p>}

              {imageRevision && <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3"><strong className="text-sm">Revisión {imageRevision.revision.revision_number} · {imageRevision.revision.status}</strong><span className="text-xs text-white/50">{imageRevision.assets.length}/6</span></div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {imageRevision.assets.map((asset, index) => <figure key={asset.id} className="min-w-0 rounded-xl border border-white/10 bg-black/25 p-2"><div className="aspect-square overflow-hidden rounded-lg bg-white">{asset.previewUrl ? <img src={asset.previewUrl} alt={`Revisión corregida ${index + 1}: ${asset.slot}`} className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center bg-black p-2 text-center text-xs text-white/50">Vista no disponible</div>}</div><figcaption className="mt-2 min-w-0"><strong className="block truncate text-[10px]">{index + 1}. {asset.slot}</strong><span className="mt-1 block truncate text-[9px] text-cyan-100/55">{asset.layoutId}</span>{asset.reusedFromHistory && <span className="mt-1 block text-[9px] text-emerald-100/70">Activo histórico reutilizado</span>}</figcaption></figure>)}
                </div>
                {imageRevision.assets.length !== 6 && <p className="rounded-xl border border-rose-200/25 p-2 text-xs text-rose-50">El conjunto no contiene exactamente seis vistas; aprobación bloqueada.</p>}
                {imageRevision.revision.status === "PENDING_REVIEW" && <div className="space-y-2 rounded-xl border border-amber-200/25 bg-amber-200/[0.05] p-3"><label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" checked={imageRevisionConfirmed} onChange={(event) => setImageRevisionConfirmed(event.target.checked)} className="mt-1 size-4" /><span>Comparé las seis imágenes, sus productos, cantidades, textos, slots y layouts. Confirmo decidir el conjunto completo de forma atómica.</span></label><div className="grid grid-cols-2 gap-2"><button type="button" disabled={imageRevisionBusy || !imageRevisionConfirmed || imageRevision.assets.length !== 6} onClick={() => void decideImageRevision("REJECT")} className="min-h-11 rounded-xl border border-rose-200/35 text-xs font-black text-rose-50 disabled:opacity-40">Rechazar las 6</button><button type="button" disabled={imageRevisionBusy || !imageRevisionConfirmed || imageRevision.assets.length !== 6} onClick={() => void decideImageRevision("APPROVE")} className="min-h-11 rounded-xl bg-emerald-200 px-2 text-xs font-black text-black disabled:opacity-40">Aprobar las 6</button></div></div>}
                {imageRevision.revision.status === "APPROVED" && <div className="space-y-3"><div className="rounded-xl border border-emerald-200/30 bg-emerald-200/[0.06] p-3 text-xs leading-5 text-emerald-50"><strong>APPROVED y listo para el próximo preview.</strong> Esta decisión sólo cambió la preferencia interna del paquete. No actualizó ni publicó nada en eBay.</div><div className="rounded-xl border border-rose-200/25 bg-rose-200/[0.04] p-3"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-rose-100/65">Acción eBay separada</p><h4 className="mt-1 text-sm font-black">Aplicar al listing ACTIVE verificado</h4><p className="mt-1 text-xs leading-5 text-white/55">Esta acción actualiza exclusivamente las seis imágenes. Nunca envía URLs desde el navegador ni modifica SKU, precio, cantidad, policies o promociones.</p><label className="mt-3 block"><span className="text-xs font-black">Item ID eBay verificado ACTIVE</span><input inputMode="numeric" value={activeRevisionItemId} onChange={(event) => setActiveRevisionItemId(event.target.value.replace(/\D/g, "").slice(0, 20))} placeholder="Item ID" className="mt-1 min-h-11 w-full rounded-xl border border-white/20 bg-black/30 px-3 font-mono text-sm" /></label>{verifiedActiveItemId ? activeRevisionItemId === verifiedActiveItemId ? <p className="mt-2 text-xs text-emerald-100">Coincide con el Item ID ACTIVE verificado por el sistema.</p> : <p className="mt-2 text-xs text-rose-100">El Item ID debe coincidir exactamente con {verifiedActiveItemId}; otro listing permanece bloqueado.</p> : <p className="mt-2 rounded-xl border border-amber-200/25 p-2 text-xs leading-5 text-amber-50">Todavía no existe una verificación ACTIVE asociada a este paquete. Publica y reconcilia el listing antes de aplicar la revisión.</p>}<label className="mt-3 block"><span className="text-xs font-black">Escribe exactamente: {activeRevisionExactPhrase}</span><input value={activeRevisionConfirmation} onChange={(event) => setActiveRevisionConfirmation(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-white/20 bg-black/30 px-3 text-sm" /></label><button type="button" disabled={activeRevisionBusy || !verifiedActiveItemId || activeRevisionItemId !== verifiedActiveItemId || activeRevisionConfirmation !== activeRevisionExactPhrase || activeRevisionApplied} onClick={() => void applyApprovedRevisionToActiveListing()} className="mt-3 min-h-12 w-full rounded-xl bg-rose-200 px-3 text-sm font-black text-black disabled:opacity-40">{activeRevisionBusy ? "Procesando una sola operación…" : activeRevisionOutcomeUnknown ? "Reconciliar sin repetir escritura" : activeRevisionApplied ? "6 imágenes aplicadas y verificadas" : "Aplicar 6 imágenes al listing ACTIVE"}</button>{activeRevisionApplication && <div className={`mt-3 rounded-xl border p-2 text-xs leading-5 ${activeRevisionOutcomeUnknown ? "border-amber-200/30 text-amber-50" : activeRevisionApplied ? "border-emerald-200/30 text-emerald-50" : "border-white/15 text-white/65"}`}><strong>Fase: {activeRevisionPhase || "PENDIENTE"}</strong>{typeof activeRevisionApplication.error === "string" && <span className="mt-1 block">{activeRevisionApplication.error}</span>}{activeRevisionOutcomeUnknown && <span className="mt-1 block">La reconciliación reutiliza Item ID, revision, control y clave originales.</span>}</div>}</div></div>}
                {imageRevision.revision.status === "REJECTED" && <div className="rounded-xl border border-rose-200/25 p-3 text-xs leading-5 text-rose-50">Revisión rechazada y preservada. Usa “Generar revisión corregida” para abrir una nueva revisión append-only.</div>}
              </div>}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-bold"><span>Derechos de la imagen</span><select value={imageRightsBasis} onChange={(event) => { setImageRightsBasis(event.target.value); setRightsEvidenceConfirmed(false); setDraftConfiguration((current) => ({ ...current, imageRightsBasis: event.target.value, imageSource: event.target.value === "owned" ? "owned" : event.target.value === "licensed" ? "licensed_asset" : "luna" })) }} className="min-h-12 rounded-2xl border border-white/20 bg-black/30 px-3"><option value="supplier_authorized">Autorizada por Luna/proveedor</option><option value="owned">Fotografía propia</option><option value="licensed">Licencia documentada</option></select></label>
              <label className="grid gap-1 text-sm font-bold"><span>Referencia de autorización</span><input value={imageAuthorizationReference} onChange={(event) => { setImageAuthorizationReference(event.target.value); setRightsEvidenceConfirmed(false) }} placeholder="Ej. email Luna 2026-07-13" className="min-h-12 rounded-2xl border border-white/20 bg-black/30 px-3" /></label>
            </div>
            <label className="mt-3 flex min-h-12 items-start gap-3 rounded-2xl border border-white/15 p-3 text-xs leading-5 text-white/70"><input type="checkbox" checked={rightsEvidenceConfirmed} onChange={(event) => setRightsEvidenceConfirmed(event.target.checked)} className="mt-1 size-4" /><span>Confirmo que conservo la fotografía original o el permiso/licencia por escrito indicado arriba. Una imagen pública no implica permiso de uso.</span></label>

            <div className="mt-4 rounded-2xl border border-white/15 p-3">
              <label className="text-sm font-black" htmlFor="authorized-image-url">Imagen autorizada por URL</label>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]"><input id="authorized-image-url" inputMode="url" placeholder="https://lunaportex.com/…" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} className="min-h-12 min-w-0 rounded-2xl border border-white/20 bg-black/30 px-3" /><button type="button" disabled={imageBusy || !httpsImageUrl(imageUrl) || imageAuthorizationReference.trim().length < 8 || !rightsEvidenceConfirmed} onClick={() => void optimizeImageUrl()} className="min-h-12 rounded-2xl bg-cyan-200 px-4 font-black text-black disabled:opacity-40">{imageBusy ? "Procesando…" : "Optimizar URL"}</button></div>
            </div>

            <div className="mt-3 rounded-2xl border border-white/15 p-3">
              <label className="text-sm font-black" htmlFor="owned-image-upload">Cámara o galería</label>
              <input id="owned-image-upload" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} className="mt-2 block min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 p-2 text-sm" />
              <button type="button" disabled={imageBusy || !imageFile || imageAuthorizationReference.trim().length < 8 || !rightsEvidenceConfirmed} onClick={() => void optimizeImageUpload()} className="mt-2 min-h-12 w-full rounded-2xl border border-cyan-200/35 px-4 font-black text-cyan-50 disabled:opacity-40">{imageBusy ? "Procesando…" : "Subir y optimizar"}</button>
            </div>

            {form.imageUrls.length > 0 && <details className="mt-3 rounded-2xl border border-white/10 p-3"><summary className="cursor-pointer text-sm font-black">Fuentes/URLs actuales del paquete · {form.imageUrls.length}</summary><div className="mt-3 space-y-2">{form.imageUrls.map((url) => <div key={url} className="grid grid-cols-[64px_1fr] gap-3 rounded-xl bg-black/25 p-2"><img src={url} alt="Fuente actual autorizada" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="size-16 rounded-lg bg-white object-contain" /><div className="min-w-0"><p className="truncate text-xs text-white/55">{url}</p><button type="button" disabled={imageBusy || imageAuthorizationReference.trim().length < 8 || !rightsEvidenceConfirmed} onClick={() => void optimizeImageUrl(url)} className="mt-2 min-h-10 rounded-xl border border-cyan-200/30 px-3 text-xs font-black text-cyan-50 disabled:opacity-40">Crear versión blanca</button></div></div>)}</div></details>}

            <div className="mt-4 space-y-3">
              {imageAssets.map((asset) => <article key={asset.id} className={`rounded-2xl border p-3 ${asset.status === "approved" ? "border-emerald-200/30 bg-emerald-200/[0.05]" : asset.status === "rejected" ? "border-rose-200/20 bg-rose-200/[0.04]" : "border-amber-200/25 bg-amber-200/[0.04]"}`}>
                <div className="flex items-center justify-between gap-3"><strong className="text-sm">{asset.status === "approved" ? `Aprobada · posición ${approvedImageAssets.findIndex((item) => item.id === asset.id) + 1}` : asset.status === "rejected" ? "Rechazada" : "Pendiente de revisión humana"}</strong><span className="rounded-full border border-white/15 px-2 py-1 text-[10px] font-black">{asset.output_width}×{asset.output_height}</span></div>
                <div className="mt-3 grid grid-cols-2 gap-2"><figure><div className="aspect-square overflow-hidden rounded-xl bg-white">{asset.source_preview_url ? <img src={asset.source_preview_url} alt="Imagen original autorizada" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center bg-black text-xs text-white/50">Original protegida</div>}</div><figcaption className="mt-1 text-center text-[10px] text-white/50">Original</figcaption></figure><figure><div className="aspect-square overflow-hidden rounded-xl bg-white">{asset.output_preview_url || asset.public_url ? <img src={asset.output_preview_url ?? asset.public_url ?? ""} alt="Versión optimizada para revisión" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center bg-black text-center text-xs text-white/50">Vista eliminada tras rechazo</div>}</div><figcaption className="mt-1 text-center text-[10px] text-white/50">Optimizada</figcaption></figure></div>
                <p className="mt-2 text-xs leading-5 text-white/60">QA automático: {asset.qa_result?.automaticStatus ?? "pendiente"} · fondo claro {Math.round(Number(asset.qa_result?.sourceEdgeLightNeutralRatio ?? 0) * 100)}% · {asset.transformation_version}</p>
                {asset.status === "pending_review" && <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={imageBusy} onClick={() => void reviewImage(asset, "reject")} className="min-h-11 rounded-xl border border-rose-200/30 text-sm font-black text-rose-50">Rechazar</button><button type="button" disabled={imageBusy} onClick={() => void reviewImage(asset, "approve")} className="min-h-11 rounded-xl bg-emerald-200 text-sm font-black text-black">Comparé y apruebo</button></div>}
                {asset.status === "approved" && <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={imageBusy || approvedImageAssets.findIndex((item) => item.id === asset.id) === 0} onClick={() => void moveApprovedImage(asset.id, -1)} className="min-h-10 rounded-xl border border-white/15 text-xs font-black disabled:opacity-30">↑ Hacer principal</button><button type="button" disabled={imageBusy || approvedImageAssets.findIndex((item) => item.id === asset.id) >= approvedImageAssets.length - 1} onClick={() => void moveApprovedImage(asset.id, 1)} className="min-h-10 rounded-xl border border-white/15 text-xs font-black disabled:opacity-30">↓ Mover</button></div>}
              </article>)}
              {!imageAssets.length && <p className="rounded-2xl border border-amber-200/20 p-3 text-sm text-amber-50">Todavía no hay una versión optimizada y aprobada. Puedes trabajar el contenido, pero el draft seguirá bloqueado.</p>}
            </div>
          </section>

          <section className="rounded-3xl border border-violet-200/20 bg-violet-200/[0.05] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-black">Item specifics</h2><p className="mt-1 text-xs leading-5 text-white/50">eBay Taxonomy define los nombres y opciones; tú confirmas los valores reales del producto Luna.</p></div><span className="rounded-full border border-violet-200/20 px-2 py-1 text-[10px] font-black">{draftState.taxonomy?.status ?? "SIN CONSULTAR"}</span></div>
            <button type="button" disabled={draftBusy || !/^\d{1,12}$/.test(form.categoryId)} onClick={() => void validateDraft()} className="mt-3 min-h-11 w-full rounded-xl border border-violet-200/30 px-3 text-sm font-black text-violet-50 disabled:opacity-40">Cargar requisitos oficiales del Category ID</button>
            <div className="mt-3 space-y-2">{Object.entries(form.aspects).map(([name, value]) => {
              const taxonomyAspect = (draftState.taxonomy?.aspects ?? [
                ...(draftState.taxonomy?.requiredAspects ?? []),
                ...(draftState.taxonomy?.recommendedAspects ?? []),
              ]).find((aspect) => aspect.name === name)
              const required = requiredTaxonomyAspects.has(name)
              const selectionOnly = taxonomyAspect?.mode === "SELECTION_ONLY"
              const selectionOptions = taxonomyAspect?.values ?? []
              const constraintSummary = taxonomyAspect
                ? [
                  taxonomyAspect.mode,
                  taxonomyAspect.cardinality,
                  taxonomyAspect.maxLength ? `máx. ${taxonomyAspect.maxLength} caracteres` : "",
                  taxonomyAspect.dataType,
                  taxonomyAspect.format,
                  taxonomyAspect.advancedDataType,
                ].filter(Boolean).join(" · ")
                : "No validado todavía contra Taxonomy"
              return <div key={name} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <label className="col-span-2 grid gap-1 sm:col-span-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-violet-100/60">{required ? "Requerido por eBay" : "Aspecto"}</span>
                  <input aria-label="Nombre del aspecto" value={name} readOnly className="min-h-11 min-w-0 rounded-xl bg-black/25 px-3" />
                  <span className="text-[10px] leading-4 text-white/45">{constraintSummary}{taxonomyAspect?.expectedRequiredByDate ? ` · requerido aproximadamente desde ${taxonomyAspect.expectedRequiredByDate}` : ""}</span>
                </label>
                <label className="grid gap-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-white/45">Valor confirmado</span>
                  {selectionOnly
                    ? <select aria-label={`Valor de ${name}`} value={value} onChange={(event) => setForm((current) => ({ ...current, aspects: { ...current.aspects, [name]: event.target.value } }))} className="min-h-11 min-w-0 rounded-xl border border-white/15 bg-black/25 px-3">
                      <option value="">Seleccionar valor oficial</option>
                      {selectionOptions.map((option) => <option key={option.value} value={option.value} disabled={!taxonomyOptionAvailable(option, form.aspects)}>{option.value}</option>)}
                    </select>
                    : <input aria-label={`Valor de ${name}`} maxLength={taxonomyAspect?.maxLength ?? undefined} value={value} onChange={(event) => setForm((current) => ({ ...current, aspects: { ...current.aspects, [name]: event.target.value } }))} className="min-h-11 min-w-0 rounded-xl border border-white/15 bg-black/25 px-3" />}
                </label>
                {required
                  ? <span aria-label={`${name} es obligatorio`} title="eBay exige este aspecto y no se puede borrar" className="mt-4 flex size-11 items-center justify-center rounded-xl border border-violet-200/25 text-violet-100">✓</span>
                  : <button type="button" aria-label={`Eliminar ${name}`} onClick={() => setForm((current) => ({ ...current, aspects: Object.fromEntries(Object.entries(current.aspects).filter(([key]) => key !== name)) }))} className="mt-4 size-11 rounded-xl border border-rose-200/30">×</button>}
              </div>
            })}</div>
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_1fr_auto]"><input aria-label="Nombre del nuevo aspecto" placeholder="Marca" value={aspectName} onChange={(event) => setAspectName(event.target.value)} className="col-span-2 min-h-11 min-w-0 rounded-xl border border-white/15 bg-black/25 px-3 sm:col-span-1" /><input aria-label="Valor del nuevo aspecto" placeholder="Valor" value={aspectValue} onChange={(event) => setAspectValue(event.target.value)} className="min-h-11 min-w-0 rounded-xl border border-white/15 bg-black/25 px-3" /><button type="button" aria-label="Agregar aspecto" disabled={!aspectName.trim() || !aspectValue.trim()} onClick={() => { setForm((current) => ({ ...current, aspects: { ...current.aspects, [aspectName.trim()]: aspectValue.trim() } })); setAspectName(""); setAspectValue("") }} className="size-11 rounded-xl bg-violet-200 font-black text-black disabled:opacity-40">+</button></div>
          </section>

          <section className={`${maintenanceMode ? "hidden" : ""} space-y-4 rounded-3xl border border-cyan-200/25 bg-cyan-200/[0.05] p-4`}>
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
            {accountPreflight?.options.merchantLocations.length === 0 && <div className="rounded-2xl border border-amber-200/30 bg-amber-200/[0.07] p-3 text-sm text-amber-50"><strong>No existe una merchant location disponible</strong><p className="mt-2 leading-6">Este paso solicita a eBay el scope <code>sell.inventory</code>. Tras tu consentimiento y la verificación de identidad, crea una sola vez la ubicación fija <code>luna-boca-raton-fl</code>. Es una escritura real de Inventory API; no crea Offers ni publica listings.</p><button type="button" disabled={draftBusy} onClick={() => void startInventoryLocationOAuth()} className="mt-3 min-h-12 w-full rounded-xl bg-amber-200 px-3 font-black text-black disabled:opacity-40">{draftBusy ? "Preparando autorización…" : "Autorizar y crear luna-boca-raton-fl"}</button></div>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className="text-sm font-black">SKU reservado del draft</span><input value={draftConfiguration.sku} readOnly className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/20 px-4 text-white/70" /></label>
              <label><span className="text-sm font-black">Cantidad</span><input inputMode="numeric" value={effectiveDraftQuantity} readOnly={productionTarget} onChange={(event) => setDraftConfiguration((current) => ({ ...current, quantity: Math.max(0, Math.trunc(Number(event.target.value) || 0)) }))} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-4 read-only:bg-white/[0.04] read-only:text-white/65" />{productionTarget && <span className="mt-1 block text-xs text-white/50">Piloto Production bloqueado en 1 unidad.</span>}</label>
              <label><span className="text-sm font-black">Condición</span><select value={draftConfiguration.condition} onChange={(event) => setDraftConfiguration((current) => ({ ...current, condition: event.target.value }))} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-4"><option value="NEW">Nuevo</option><option value="NEW_OTHER">Nuevo, otro</option><option value="NEW_WITH_DEFECTS">Nuevo con defectos</option><option value="USED_EXCELLENT">Usado excelente</option><option value="USED_GOOD">Usado bueno</option><option value="USED_ACCEPTABLE">Usado aceptable</option></select></label>
              <label><span className="text-sm font-black">Merchant location</span><select value={draftConfiguration.merchantLocationKey} onChange={(event) => updatePreflightSelection("merchantLocationKey", event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-3"><option value="">Seleccionar location</option>{draftConfiguration.merchantLocationKey && !draftState.preflight?.options.merchantLocations.some((option) => option.id === draftConfiguration.merchantLocationKey) && <option value={draftConfiguration.merchantLocationKey}>{draftConfiguration.merchantLocationKey} · revalidar</option>}{draftState.preflight?.options.merchantLocations.map((option) => <option key={option.id} value={option.id} disabled={!option.usable}>{option.name} · {option.id}{option.usable ? "" : " · disabled"}</option>)}</select></label>
              <label><span className="text-sm font-black">Fulfillment policy</span><select value={draftConfiguration.fulfillmentPolicyId} onChange={(event) => updatePreflightSelection("fulfillmentPolicyId", event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-3"><option value="">Seleccionar fulfillment</option>{draftConfiguration.fulfillmentPolicyId && !draftState.preflight?.options.fulfillmentPolicies.some((option) => option.id === draftConfiguration.fulfillmentPolicyId) && <option value={draftConfiguration.fulfillmentPolicyId}>{draftConfiguration.fulfillmentPolicyId} · revalidar</option>}{draftState.preflight?.options.fulfillmentPolicies.map((option) => <option key={option.id} value={option.id} disabled={!option.usable}>{option.name} · {option.id}{option.usable ? "" : " · no apta"}</option>)}</select></label>
              <label><span className="text-sm font-black">Payment policy</span><select value={draftConfiguration.paymentPolicyId} onChange={(event) => updatePreflightSelection("paymentPolicyId", event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-3"><option value="">Seleccionar payment</option>{draftConfiguration.paymentPolicyId && !draftState.preflight?.options.paymentPolicies.some((option) => option.id === draftConfiguration.paymentPolicyId) && <option value={draftConfiguration.paymentPolicyId}>{draftConfiguration.paymentPolicyId} · revalidar</option>}{draftState.preflight?.options.paymentPolicies.map((option) => <option key={option.id} value={option.id} disabled={!option.usable}>{option.name} · {option.id}{option.usable ? " · pago inmediato" : " · no apta"}</option>)}</select></label>
              <label><span className="text-sm font-black">Return policy</span><select value={draftConfiguration.returnPolicyId} onChange={(event) => updatePreflightSelection("returnPolicyId", event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 bg-black/30 px-3"><option value="">Seleccionar returns</option>{draftConfiguration.returnPolicyId && !draftState.preflight?.options.returnPolicies.some((option) => option.id === draftConfiguration.returnPolicyId) && <option value={draftConfiguration.returnPolicyId}>{draftConfiguration.returnPolicyId} · revalidar</option>}{draftState.preflight?.options.returnPolicies.map((option) => <option key={option.id} value={option.id} disabled={!option.usable}>{option.name} · {option.id}{option.usable ? "" : " · no apta"}</option>)}</select></label>
              <label><span className="text-sm font-black">Peso</span><div className="mt-2 grid grid-cols-[1fr_auto] gap-2"><input inputMode="decimal" value={draftConfiguration.weight ?? ""} onChange={(event) => setDraftConfiguration((current) => ({ ...current, weight: numberOrNull(event.target.value) }))} className="min-h-12 min-w-0 rounded-2xl border border-white/20 bg-black/30 px-4" /><select aria-label="Unidad de peso" value={draftConfiguration.weightUnit} onChange={(event) => setDraftConfiguration((current) => ({ ...current, weightUnit: event.target.value }))} className="rounded-2xl border border-white/20 bg-black/30 px-2"><option value="">Unidad</option><option value="POUND">lb</option><option value="OUNCE">oz</option><option value="KILOGRAM">kg</option><option value="GRAM">g</option></select></div></label>
            </div>
            <div><span className="text-sm font-black">Dimensiones del paquete</span><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{(["length", "width", "height"] as const).map((field) => <input key={field} aria-label={field} inputMode="decimal" placeholder={field === "length" ? "Largo" : field === "width" ? "Ancho" : "Alto"} value={draftConfiguration[field] ?? ""} onChange={(event) => setDraftConfiguration((current) => ({ ...current, [field]: numberOrNull(event.target.value) }))} className="min-h-12 min-w-0 rounded-xl border border-white/20 bg-black/30 px-2" />)}<select aria-label="Unidad de dimensiones" value={draftConfiguration.dimensionUnit} onChange={(event) => setDraftConfiguration((current) => ({ ...current, dimensionUnit: event.target.value }))} className="min-h-12 rounded-xl border border-white/20 bg-black/30 px-1"><option value="">Unidad</option><option value="INCH">in</option><option value="CENTIMETER">cm</option></select></div></div>
            <label className="flex min-h-14 items-start gap-3 rounded-2xl border border-white/15 p-3"><input type="checkbox" checked={imagesAuthorized} onChange={(event) => setImagesAuthorized(event.target.checked)} className="mt-1 size-5" /><span className="text-sm"><strong className="block">Confirmo derechos sobre todas las imágenes</strong><span className="text-white/55">Provienen de Luna/proveedor y están autorizadas; no fueron copiadas de eBay ni de competidores.</span></span></label>
            <button type="button" disabled={draftBusy} onClick={() => void validateDraft()} className="min-h-13 w-full rounded-2xl border border-cyan-200/35 px-4 font-black text-cyan-50 disabled:opacity-50">{draftBusy ? "Validando…" : "Validar draft seguro"}</button>
            {draftState.readiness && <div className={`rounded-2xl border p-3 ${draftState.readiness.ready ? "border-emerald-200/30 bg-emerald-200/[0.06]" : "border-amber-200/30 bg-amber-200/[0.06]"}`}><strong>{draftState.readiness.ready ? "Listo para tu aprobación" : `${draftState.readiness.blockers.length} bloqueos pendientes`}</strong>{!draftState.readiness.ready && <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-50">{draftState.readiness.blockers.map((blocker) => <li key={blocker}>{humanWorkspaceBlocker(blocker, form.pricing.minimumProfitablePrice)}</li>)}</ul>}</div>}
            {draftState.readiness?.ready && !approvalActive && !executionCompleted && <div className="space-y-3 rounded-2xl border border-emerald-200/25 p-3"><label className="block"><span className="text-sm font-black">Escribe exactamente: {expectedApprovalPhrase}</span><input value={approvalPhrase} onChange={(event) => setApprovalPhrase(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-white/20 bg-black/30 px-3" /></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmUnpublishedOnly} onChange={(event) => setConfirmUnpublishedOnly(event.target.checked)} />Entiendo que sólo autoriza un Offer no publicado.</label><label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmNoPublish} onChange={(event) => setConfirmNoPublish(event.target.checked)} />Confirmo que publicar permanece prohibido.</label>{productionTarget && <label className="flex gap-2 rounded-xl border border-rose-200/30 bg-rose-200/[0.07] p-3 text-sm"><input type="checkbox" checked={confirmProductionAccount} onChange={(event) => setConfirmProductionAccount(event.target.checked)} />Confirmo que {draftTarget} es mi cuenta real: autorizo crear Inventory Item + Offer API UNPUBLISHED, sin publicarlo.</label>}<button type="button" disabled={draftBusy || approvalPhrase !== expectedApprovalPhrase || !confirmUnpublishedOnly || !confirmNoPublish || !imagesAuthorized || (productionTarget && !confirmProductionAccount)} onClick={() => void approveDraft()} className="min-h-13 w-full rounded-2xl bg-emerald-200 px-4 font-black text-black disabled:opacity-40">Aprobar {draftTarget} por 15 minutos</button></div>}
            {approvalActive && !executionCompleted && draftState.approval && <div className="rounded-2xl border border-rose-200/30 bg-rose-200/[0.06] p-3"><strong>Aprobación {draftTarget} activa hasta {new Date(draftState.approval.expires_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</strong><p className="mt-2 text-sm text-white/65">El siguiente botón es el único que puede escribir y sólo crea Inventory Item + Offer API UNPUBLISHED en {draftTarget}.</p><button type="button" disabled={draftBusy || !draftState.runtime?.enabled || !draftState.runtime?.configured} onClick={() => void executeDraft()} className="mt-3 min-h-14 w-full rounded-2xl bg-rose-200 px-4 font-black text-black disabled:opacity-40">Crear Offer no publicado en {draftTarget}</button><button type="button" disabled={draftBusy} onClick={() => void revokeDraftApproval()} className="mt-2 min-h-12 w-full rounded-2xl border border-white/20 px-4 font-black disabled:opacity-40">Cancelar aprobación</button></div>}
            {executionCompleted && <div className="rounded-2xl border border-emerald-200/30 bg-emerald-200/[0.07] p-3 text-emerald-50"><strong>UNPUBLISHED verificado al crear {draftState.execution?.completed_at ? new Date(draftState.execution.completed_at).toLocaleString("es") : "en la ejecución registrada"}</strong><p className="mt-1 text-xs">Este estado describe la verificación realizada en ese momento; vuelve a consultar eBay antes de asumir que sigue igual.</p><p className="mt-1 break-all text-xs">Offer ID: {draftState.execution?.offer_id ?? "guardado"}</p></div>}
            {executionCompleted && !draftState.publication && <div className="rounded-2xl border border-cyan-200/30 bg-cyan-200/[0.06] p-3"><strong>Preparar publicación automática</strong><p className="mt-2 text-sm text-white/65">El sistema revalidará cuenta, stock, seis imágenes, policies y ubicación. Después mostrará el preview final; este paso todavía no publica.</p><button type="button" disabled={draftBusy || !draftState.execution?.id} onClick={() => void prepareFinalPublication()} className="mt-3 min-h-14 w-full rounded-2xl bg-cyan-200 px-4 font-black text-black disabled:opacity-40">Preparar preview final no publicado</button></div>}
            {publicationPhase === "preview_ready" && <div className="space-y-3 rounded-2xl border border-amber-200/35 bg-amber-200/[0.07] p-3"><div><p className="text-xs font-black uppercase tracking-widest text-amber-100/70">Preview final persistido</p><h3 className="mt-1 font-black">{String(publicationProduct.title ?? "Título pendiente")}</h3><p className="mt-2 text-xs text-white/65">SKU: {String(publicationOffer.sku ?? draftState.publication?.sku ?? "")} · Category ID: {String(publicationOffer.categoryId ?? "")} · Cantidad: {String(publicationOffer.availableQuantity ?? "")}</p><p className="mt-1 text-sm font-black">Precio exacto: {String(publicationPrice.currency ?? "USD")} {String(publicationPrice.value ?? "")}</p><p className="mt-1 text-xs text-white/65">Imágenes aprobadas: {Array.isArray(publicationProduct.imageUrls) ? publicationProduct.imageUrls.length : 0} · Location: {String(publicationOffer.merchantLocationKey ?? "")}</p><p className="mt-1 break-all text-[10px] text-white/50">Policies: {String(publicationPolicies.fulfillmentPolicyId ?? "")} · {String(publicationPolicies.paymentPolicyId ?? "")} · {String(publicationPolicies.returnPolicyId ?? "")}</p><p className="mt-2 rounded-xl border border-white/10 p-2 text-xs text-white/60">Sin promociones, Best Offer ni volume pricing. Se publicará exactamente este Offer una sola vez.</p></div><label className="block"><span className="text-sm font-black">Escribe exactamente: {finalPublishPhrase}</span><input value={publishConfirmation} onChange={(event) => setPublishConfirmation(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-white/20 bg-black/30 px-3" /></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmFinalPublication} onChange={(event) => setConfirmFinalPublication(event.target.checked)} />Revisé este preview final, incluidas las seis imágenes y el precio.</label><label className="flex gap-2 rounded-xl border border-rose-200/30 bg-rose-200/[0.07] p-3 text-sm"><input type="checkbox" checked={confirmPublishProductionAccount} onChange={(event) => setConfirmPublishProductionAccount(event.target.checked)} />Confirmo publicar en mi cuenta eBay PRODUCTION y registrar el listing ACTIVE en monitoreo.</label><button type="button" disabled={draftBusy || publishConfirmation !== finalPublishPhrase || !confirmFinalPublication || !confirmPublishProductionAccount} onClick={() => void publishFinalListing()} className="min-h-14 w-full rounded-2xl bg-rose-200 px-4 font-black text-black disabled:opacity-40">Publicar una sola vez en eBay</button></div>}
            {["publish_in_flight", "outcome_unknown", "published_pending_verification"].includes(publicationPhase) && <div className="rounded-2xl border border-amber-200/30 bg-amber-200/[0.07] p-3"><strong>{publicationPhase === "published_pending_verification" ? "Publicado; falta confirmar ACTIVE" : "Resultado de publicación en reconciliación"}</strong><p className="mt-2 text-sm text-white/65">Esta acción sólo consulta eBay y registra monitoreo. Nunca vuelve a llamar publishOffer.</p>{draftState.publication?.listing_id && <a href={`https://www.ebay.com/itm/${draftState.publication.listing_id}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-sm font-black text-cyan-100 underline">Ver listing {draftState.publication.listing_id}</a>}<button type="button" disabled={draftBusy} onClick={() => void reconcileFinalListing()} className="mt-3 min-h-13 w-full rounded-2xl border border-amber-200/40 px-4 font-black disabled:opacity-40">Verificar ACTIVE y registrar monitoreo</button></div>}
            {publicationPhase === "monitor_registered" && <div className="rounded-2xl border border-emerald-200/35 bg-emerald-200/[0.08] p-3 text-emerald-50"><strong>Listing ACTIVE y ciclo cerrado</strong><p className="mt-2 text-sm">Item ID {draftState.publication?.listing_id} · monitoreo comercial y disponibilidad Luna registrados.</p><a href={`https://www.ebay.com/itm/${draftState.publication?.listing_id}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex font-black underline">Abrir listing en eBay</a></div>}
            {publicationPhase === "terminal_failure" && <div className="rounded-2xl border border-rose-200/35 bg-rose-200/[0.08] p-3 text-rose-50"><strong>Publicación detenida sin reintento automático</strong><p className="mt-2 text-sm">{draftState.publication?.last_error_code ?? "EBAY_FINAL_PUBLICATION_TERMINAL_FAILURE"}</p></div>}
            <a href="https://www.ebay.com/sh/lst/active" target="_blank" rel="noreferrer" className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-white/15 text-xs font-black text-white/60">Abrir Seller Hub (respaldo manual)</a>
          </section>

          <section className="rounded-3xl border border-amber-200/20 bg-amber-200/[0.05] p-4"><div className="flex justify-between gap-3"><h2 className="font-black">Preparación del paquete</h2><strong>{listingPackage.readiness}%</strong></div>{blockers.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-50">{blockers.map((blocker) => <li key={blocker}>{humanWorkspaceBlocker(blocker, form.pricing.minimumProfitablePrice)}</li>)}</ul> : <p className="mt-2 text-sm text-emerald-100">Sin bloqueos. Puedes enviarlo a revisión humana.</p>}<p className="mt-3 text-xs leading-5 text-white/50">Guardar y validar sólo modifican datos internos. Crear el Offer permanece separado de la autorización final: publishOffer exige el preview persistido, la frase exacta y una única confirmación humana.</p></section>
        </>}
      </section>

      {opportunity && listingPackage && <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/15 bg-[#0b1018]/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur"><div className="mx-auto grid max-w-xl grid-cols-2 gap-2"><button disabled={busy} onClick={() => void save(false)} className="min-h-14 rounded-2xl border border-white/20 font-black disabled:opacity-50">{busy ? "Guardando…" : "Guardar"}</button><button disabled={busy || blockers.length > 0} onClick={() => void save(true)} className="min-h-14 rounded-2xl bg-emerald-200 px-3 font-black text-black disabled:opacity-40">Listo para revisión</button></div></div>}
    </main>
  )
}
