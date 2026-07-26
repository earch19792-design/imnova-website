"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { supabase } from "@/lib/supabase"

import { Loop2Top20OpportunityPool } from "./loop2-top20-opportunity-pool"
import { OpenAiIntelligenceShadowPanel } from "./openai-intelligence-shadow-panel"

type Decision = {
  id: string
  candidateId: string | null
  packageVersion: string
  packageHash: string
  identityFingerprint: string
  verdict: string
  status: string
  productName: string | null
  estimatedCostUsd: number | null
  evidenceDistillation: {
    distillationHash: string
    soldEvidence: { exactCount: number; confidence: string }
    activeMarket: { exactCount: number; confidence: string }
    packStrategy: {
      strategyHash: string
      recommendedPack: PackStrategyRow | null
      alternativePack: PackStrategyRow | null
      packMatrix: PackStrategyRow[]
      pairedOfferPlan?: PairedOfferPlan
      lowCostSmallItemOpportunity: LowCostSmallItemOpportunity
    }
  } | null
  assessment: {
    eligible: boolean
    reasons: string[]
    minimumSafePrice: number | null
    targetPrice: number | null
    identityStrong: boolean
    economicsViable: boolean
    stockRecent: boolean
    costRecent: boolean
    canPublish: false
  }
}

type PackStrategyRow = {
  offerPackFingerprint: string
  packCount: number
  totalUnitCount: number | null
  medianLandedPrice: number | null
  medianPricePerUnit: number | null
  activeListingCount: number
  soldEvidenceCount: number
  evidenceConfidence: string
  competitionPressure: number
  stockRequired: number | null
  operationalRisk: string[]
  economics: {
    buyerDiscountPercent: number | null
    sellerProfit: number | null
    roiPercent: number | null
    netMarginPercent: number | null
  }
  scores: { demandConfidence: number; overallPackStrategy: number }
  decision: string
  explanation: string
}

type PairedOfferPlan = {
  applicability: string
  recommendedMode:
    | "UNIT_ONLY"
    | "UNIT_PLUS_VOLUME_PRICING"
    | "UNIT_PLUS_SEPARATE_PACK"
  demandBasis: string
  primaryCommercialUnit: {
    packCount: number
    totalUnitCount: number | null
    supplierOfferMultiplier: number
    targetPrice: number | null
  }
  optionalPackage: {
    packCount: number
    totalUnitCount: number | null
    supplierOfferMultiplier: number
    targetPrice: number | null
    soldEvidenceCount: number
    verifiedSoldQuantity: number | null
    activeListingCount: number
    evidenceConfidence: string
  } | null
  volumePricing: {
    status: string
    tiers: Array<{
      minimumQuantity: number
      calculatedDiscountPercent: number
    }>
  }
  analysisReuse: {
    fullProductResearchRerunRequired: false
    packSpecificDeltaReviewRequired: boolean
    soldEvidenceHasPriority: true
    activeListingsTreatedAsSales: false
  }
  automation: {
    autoPrepareOptionalVariant: boolean
    autoCreatePromotionPreview: boolean
    autoPublish: false
    humanApprovalRequired: true
    publicationSequence: string
  }
  blockers: string[]
}

type LowCostSmallItemOpportunity = {
  status:
    | "NOT_APPLICABLE"
    | "NEEDS_SIZE_OR_SHIPPING_EVIDENCE"
    | "EVALUATE_PACK_OPTIONS"
    | "PACK_RECOMMENDED"
  trigger: {
    unitSupplierCostUsd: number | null
    unitCostBelowThreshold: boolean
    thresholdUsdExclusive: 6
    smallItemConfirmed: boolean
    packageVolumeCubicInches: number | null
  }
  shippingComparison: {
    currentShippingCostUsd: number | null
    currentShippingCostPerBaseItemUsd: number | null
    recommendedPackCount: number | null
    recommendedShippingCostUsd: number | null
    recommendedShippingCostPerBaseItemUsd: number | null
    shippingIncreasePercent: number | null
    shippingCostPerBaseItemReductionPercent: number | null
  }
  proposedPackCounts: number[]
  autoPublish: false
  explanation: string
}

type GenerationRun = {
  id: string
  status: string
  current_version_id: string | null
  revision_count: number
  max_revisions: number
  model: string
  cache_hit: boolean
  projected_cost_usd: number
  total_estimated_cost_usd: number
  last_error_code: string | null
  created_at: string
}

type StatusPayload = {
  success?: boolean
  error?: string
  activeLoop?: string
  loop1Package?: Decision | null
  decisions?: Decision[]
  generations?: GenerationRun[]
  configuration?: {
    status: string
    enabled: boolean
    apiKey: "PRESENT" | "MISSING"
    model: string | null
    reviewModel: "CONFIGURED" | "OFF"
    promptVersion: string
    maxRevisions: number
    realReady: boolean
  }
  budget?: {
    spentUsd: number
    remainingUsd: number
    warningReached: boolean
    hardStopReached: boolean
    monthlyBudgetUsd: number
    warningBudgetUsd: number
    hardStopUsd: number
  }
  backgroundMonitor?: string
}

type GenerationDetails = {
  run: GenerationRun
  versions: Array<{
    id: string
    version_number: number
    revision_number: number
    output_hash: string
    generation_output: {
      recommendedTitle?: string
      titleCandidates?: string[]
      factualBullets?: string[]
      itemSpecifics?: Array<{ name: string; value: string }>
      description?: string
      primaryKeywords?: string[]
      secondaryKeywords?: string[]
      imageBriefs?: Array<{ slot: string; objective: string }>
      complianceNotes?: string[]
      unsupportedClaims?: string[]
      pricePresentation?: { price?: number; minimumSafePrice?: number; currency?: string }
    }
    created_at: string
  }>
  validations: Array<{
    id: string
    revision_number: number
    validation_kind: string
    passed: boolean
    error_codes: string[]
  }>
  approvals: Array<{
    id: string
    action: string
    reason_code: string | null
    created_at: string
  }>
}

function money(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "N/D"
}

function humanReason(code: string) {
  const labels: Record<string, string> = {
    LOOP1_PACKAGE_NOT_APPROVED: "El paquete de Loop 1 todavía no tiene aprobación humana.",
    LOOP1_VERDICT_NOT_ELIGIBLE: "Loop 1 determinó NO_GO; selecciona otro producto.",
    LOOP1_PACKAGE_INTEGRITY_INVALID: "No se pudo verificar la integridad del paquete.",
    LOOP1_PACKAGE_STALE: "El paquete de Loop 1 está vencido y debe regenerarse con evidencia reciente.",
    PRODUCT_IDENTITY_NOT_STRONG: "Falta identidad fuerte de producto.",
    ECONOMICS_NOT_VIABLE: "La economía no cumple los límites comerciales.",
    MINIMUM_SAFE_PRICE_REQUIRED: "Falta el precio mínimo seguro.",
    TARGET_PRICE_REQUIRED: "Falta el precio objetivo.",
    SUPPLIER_COST_REQUIRED: "Falta el costo verificado del proveedor.",
    STOCK_EVIDENCE_STALE: "El stock necesita una confirmación reciente.",
    COST_EVIDENCE_STALE: "El costo necesita una confirmación reciente.",
    STOCK_NOT_AVAILABLE: "No hay stock Luna disponible.",
    LISTING_AI_INTAKE_REQUIRED: "Falta el intake aprobado de categoría, aspectos y claims.",
    APPROVED_KEYWORDS_REQUIRED: "Faltan keywords aprobadas.",
    CATEGORY_REQUIRED: "Falta la categoría oficial de eBay.",
    REQUIRED_ASPECTS_REQUIRED: "Faltan los item specifics obligatorios.",
    INCLUDED_CONTENTS_REQUIRED: "Falta confirmar exactamente qué incluye el paquete.",
    ALLOWED_IMAGE_FACTS_REQUIRED: "Faltan hechos autorizados para los briefs visuales.",
    PACK_STRATEGY_RECOMMENDATION_REQUIRED: "Falta una estrategia de pack segura: revisa stock, shipping, peso, dimensiones y economía por presentación.",
    PAIRED_OFFER_NOT_REPEAT_PURCHASE_CONSUMABLE: "La automatización unidad + paquete se reserva para productos de consumo recurrente.",
    CURRENT_COMMERCIAL_UNIT_NOT_READY: "La presentación base todavía no supera economía, stock y operación.",
    PACK_COMPLIANCE_REVALIDATION_REQUIRED: "El paquete requiere volver a validar cumplimiento, hazmat y transporte.",
    NO_SAFE_LARGER_PACK_EVIDENCE: "Ningún paquete mayor supera todavía demanda, stock, envío y margen.",
  }
  return labels[code] ?? code.replaceAll("_", " ")
}

function pairedModeLabel(mode: PairedOfferPlan["recommendedMode"]) {
  if (mode === "UNIT_PLUS_SEPARATE_PACK") {
    return "Unidad comercial + listing de paquete separado"
  }
  if (mode === "UNIT_PLUS_VOLUME_PRICING") {
    return "Unidad comercial + paquete mediante volume pricing"
  }
  return "Solo unidad comercial"
}

function demandBasisLabel(value: string) {
  if (value === "VERIFIED_SOLD_OR_COMPLETED_FIRST") {
    return "Primero ventas verificadas/completadas del pack exacto"
  }
  if (value === "ACTIVE_PACK_PATTERN_EXPLORATORY") {
    return "Patrón de listings activos; prueba exploratoria, no ventas confirmadas"
  }
  if (value === "NOT_APPLICABLE") return "No aplica a esta categoría"
  return "Sin evidencia segura de un paquete mayor"
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) throw new Error("AUTH_REQUIRED")
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  })
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? "LISTING_AI_REQUEST_FAILED")
  return payload
}

function idempotencyKey(action: string, id: string) {
  return `${action}:${id}:${crypto.randomUUID()}`
}

export function Loop2ListingAiPanel() {
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [details, setDetails] = useState<GenerationDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [showEvidence, setShowEvidence] = useState(false)
  const [compareVersions, setCompareVersions] = useState(false)

  const loadStatus = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const payload = await adminFetch<StatusPayload>("/api/admin/ebay/listing-ai/status")
      setStatus(payload)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "LISTING_AI_STATUS_UNAVAILABLE")
    } finally {
      setLoading(false)
    }
  }, [])

  const loadGeneration = useCallback(async (id: string) => {
    setWorking(true)
    setError("")
    try {
      const payload = await adminFetch<{ generation: GenerationDetails }>(
        `/api/admin/ebay/listing-ai/generations/${encodeURIComponent(id)}`,
      )
      setDetails(payload.generation)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "LISTING_AI_GENERATION_UNAVAILABLE")
    } finally {
      setWorking(false)
    }
  }, [])

  useEffect(() => { void loadStatus() }, [loadStatus])

  const decision = status?.loop1Package ?? null
  const blockedReason = useMemo(() => {
    if (loading) return "Cargando configuración y paquete Loop 1…"
    if (!decision) return "No existe un paquete Loop 1 disponible."
    if (!decision.assessment.eligible) return humanReason(decision.assessment.reasons[0] ?? "NOT_ELIGIBLE")
    if (status?.configuration?.status === "DISABLED") return "La fábrica OpenAI está apagada por defecto."
    if (status?.configuration?.apiKey === "MISSING") return "Falta configurar la credencial OpenAI en Preview."
    if (!status?.configuration?.model) return "Falta configurar el modelo OpenAI."
    if (status?.budget?.hardStopReached) return "El presupuesto alcanzó el hard stop server-side."
    if (!status?.configuration?.realReady) return "La configuración OpenAI todavía no está lista."
    return null
  }, [decision, loading, status])

  const currentVersion = details?.versions.find((entry) => entry.id === details.run.current_version_id) ?? null
  const pairedOfferPlan =
    decision?.evidenceDistillation?.packStrategy.pairedOfferPlan ?? null
  const lowCostSmallItemOpportunity =
    decision?.evidenceDistillation?.packStrategy
      .lowCostSmallItemOpportunity ?? null

  const generate = async () => {
    if (!decision || blockedReason) return
    setWorking(true); setError(""); setMessage("")
    try {
      const payload = await adminFetch<{ result: { generation?: GenerationDetails } }>(
        "/api/admin/ebay/listing-ai/generate",
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey("generate", decision.id) },
          body: JSON.stringify({ packageId: decision.id, packageHash: decision.packageHash }),
        },
      )
      const generation = payload.result.generation
      if (generation?.run?.id) await loadGeneration(generation.run.id)
      setMessage("Generación completada para revisión humana. No se creó ningún draft.")
      await loadStatus()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "LISTING_AI_GENERATE_FAILED")
    } finally {
      setWorking(false)
    }
  }

  const mutate = async (action: "approve" | "reject" | "request-revision", body: Record<string, unknown>) => {
    if (!details) return
    setWorking(true); setError(""); setMessage("")
    try {
      await adminFetch(
        `/api/admin/ebay/listing-ai/generations/${encodeURIComponent(details.run.id)}/${action}`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey(action, details.run.id) },
          body: JSON.stringify(body),
        },
      )
      await loadGeneration(details.run.id)
      await loadStatus()
      setMessage(action === "approve"
        ? "Versión aprobada para el siguiente loop. Publicación continúa bloqueada."
        : action === "reject"
          ? "Generación rechazada y auditada."
          : "Solicitud procesada. Máximo una corrección automática.")
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "LISTING_AI_ACTION_FAILED")
    } finally {
      setWorking(false)
    }
  }

  return (
    <section aria-labelledby="loop2-heading" className="space-y-4 rounded-3xl border border-fuchsia-200/30 bg-fuchsia-200/[0.07] p-4">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-100/70">Aprobación humana · sin publicación</p>
        <h2 id="loop2-heading" className="mt-1 text-xl font-black">Loop 2 — Generar listing con IA</h2>
      </div>
      <div className="grid gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-xl bg-black/25 p-2"><span className="block text-white/50">ACTIVE LOOP</span><strong>LOOP 2</strong></div>
        <div className="rounded-xl bg-black/25 p-2"><span className="block text-white/50">LOOP 1 PACKAGE</span><strong>{decision?.assessment.eligible ? "APPROVED" : "NOT ELIGIBLE"}</strong></div>
        <div className="rounded-xl bg-black/25 p-2"><span className="block text-white/50">BACKGROUND MONITOR</span><strong>INDEPENDENT</strong></div>
      </div>

      <div className="grid gap-2 text-xs sm:grid-cols-4" aria-label="Capacidades separadas de Seller Command Center">
        <div className="rounded-xl border border-white/10 p-2"><strong>A · Radar anterior</strong><p className="mt-1 text-white/55">Fuente prioritaria; sus cinco candidatos no son el Top 20.</p></div>
        <div className="rounded-xl border border-cyan-200/20 p-2"><strong>B · Top 20 automatizado</strong><p className="mt-1 text-white/55">Discovery y Loop 1 se orquestan aquí con un solo botón.</p></div>
        <div className="rounded-xl border border-emerald-200/20 p-2"><strong>C · Paquete Loop 1</strong><p className="mt-1 text-white/55">Referencia ya calculada; no inicia análisis.</p></div>
        <div className="rounded-xl border border-fuchsia-200/20 p-2"><strong>D · OpenAI</strong><p className="mt-1 text-white/55">Sólo después de aprobación humana.</p></div>
      </div>

      <OpenAiIntelligenceShadowPanel />

      <Loop2Top20OpportunityPool />

      <div className="rounded-2xl border border-emerald-200/20 bg-emerald-200/[0.04] p-3">
        <h3 className="font-black">Paquete Loop 1 actualmente seleccionado</h3>
        <p className="mt-1 text-xs text-white/60">Referencia histórica separada del Top 20. Puede mostrar 9001E, pero no lo presenta como candidato del nuevo ranking.</p>
      </div>

      {loading ? <p role="status">Cargando configuración server-side…</p> : (
        <>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-2xl bg-black/25 p-3"><dt className="text-white/55">Producto</dt><dd className="font-black">{decision?.productName ?? "N/D"}</dd></div>
            <div className="rounded-2xl bg-black/25 p-3"><dt className="text-white/55">Fingerprint</dt><dd className="break-all font-mono text-xs">{decision?.identityFingerprint ?? "N/D"}</dd></div>
            <div className="rounded-2xl bg-black/25 p-3"><dt className="text-white/55">Veredicto Loop 1</dt><dd className="font-black">{decision?.verdict ?? "N/D"}</dd></div>
            <div className="rounded-2xl bg-black/25 p-3"><dt className="text-white/55">Precio mínimo / objetivo</dt><dd className="font-black">{money(decision?.assessment.minimumSafePrice)} / {money(decision?.assessment.targetPrice)}</dd></div>
            <div className="rounded-2xl bg-black/25 p-3"><dt className="text-white/55">Modelo configurado</dt><dd className="font-black">{status?.configuration?.model ?? "N/D"}</dd></div>
            <div className="rounded-2xl bg-black/25 p-3"><dt className="text-white/55">Costo máximo estimado</dt><dd className="font-black">{money(decision?.estimatedCostUsd)}</dd></div>
            <div className="rounded-2xl bg-black/25 p-3"><dt className="text-white/55">Presupuesto restante</dt><dd className="font-black">{money(status?.budget?.remainingUsd)}</dd></div>
            <div className="rounded-2xl bg-black/25 p-3"><dt className="text-white/55">Revisor superior</dt><dd className="font-black">{status?.configuration?.reviewModel ?? "OFF"}</dd></div>
          </dl>

          {status?.budget?.warningReached && !status.budget.hardStopReached && (
            <p role="alert" className="rounded-2xl border border-amber-200/30 bg-amber-200/[0.08] p-3 text-sm text-amber-50">Advertencia: el gasto mensual alcanzó el umbral de {money(status.budget.warningBudgetUsd)}.</p>
          )}
          {blockedReason && <p role="alert" className="rounded-2xl border border-amber-200/30 bg-amber-200/[0.08] p-3 text-sm font-bold text-amber-50">{blockedReason}</p>}
          {decision && !decision.assessment.eligible && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-white/75">
              {decision.assessment.reasons.map((reason) => <li key={reason}>{humanReason(reason)}</li>)}
            </ul>
          )}
          <button type="button" onClick={() => void generate()} disabled={Boolean(blockedReason) || working} className="min-h-12 w-full rounded-2xl bg-fuchsia-200 px-4 font-black text-black disabled:cursor-not-allowed disabled:opacity-40">{working ? "Procesando…" : "Generar listing con IA"}</button>
          {blockedReason && <p className="text-xs text-white/60">Botón bloqueado: {blockedReason}</p>}
          <button type="button" onClick={() => setShowEvidence((value) => !value)} className="min-h-11 w-full rounded-2xl border border-fuchsia-200/30 px-4 font-black">{showEvidence ? "Ocultar evidencia" : "Ver evidencia"}</button>
          {decision?.evidenceDistillation?.packStrategy && (
            <section aria-labelledby="pack-strategy-heading" className="space-y-3 rounded-2xl border border-white/15 bg-black/20 p-3">
              <div>
                <h3 id="pack-strategy-heading" className="font-black">Estrategia de presentación y paquetes</h3>
                <p className="text-xs text-white/60">Packs distintos informan estrategia, pero nunca se mezclan con el offer exacto.</p>
              </div>
              {lowCostSmallItemOpportunity
                && lowCostSmallItemOpportunity.status !== "NOT_APPLICABLE"
                && (
                  <article className="space-y-2 rounded-2xl border border-emerald-200/25 bg-emerald-200/[0.06] p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h4 className="font-black">Oportunidad: producto pequeño de costo bajo</h4>
                        <p className="mt-1 text-xs text-white/65">
                          Costo base {money(lowCostSmallItemOpportunity.trigger.unitSupplierCostUsd)} · umbral exclusivo USD 6 · tamaño pequeño {lowCostSmallItemOpportunity.trigger.smallItemConfirmed ? "confirmado" : "pendiente"}.
                        </p>
                      </div>
                      <span className="rounded-full border border-emerald-100/30 px-2 py-1 text-xs font-black">
                        {lowCostSmallItemOpportunity.status === "PACK_RECOMMENDED"
                          ? "PACK RECOMENDADO"
                          : lowCostSmallItemOpportunity.status === "EVALUATE_PACK_OPTIONS"
                            ? "COMPARAR PACKS"
                            : "FALTA LOGÍSTICA"}
                      </span>
                    </div>
                    <p className="text-xs text-white/75">
                      Comparar: {lowCostSmallItemOpportunity.proposedPackCounts.map((pack) => `${pack}-pack`).join(" · ")}. El objetivo es diluir un envío casi igual entre más unidades sin sacrificar demanda, stock ni margen.
                    </p>
                    {lowCostSmallItemOpportunity.shippingComparison.recommendedPackCount && (
                      <p className="rounded-xl border border-emerald-200/20 bg-black/20 p-2 text-xs text-emerald-50">
                        Mejor opción verificada: {lowCostSmallItemOpportunity.shippingComparison.recommendedPackCount}-pack · envío {money(lowCostSmallItemOpportunity.shippingComparison.recommendedShippingCostUsd)} · envío por unidad {money(lowCostSmallItemOpportunity.shippingComparison.recommendedShippingCostPerBaseItemUsd)} · reducción por unidad {lowCostSmallItemOpportunity.shippingComparison.shippingCostPerBaseItemReductionPercent?.toFixed(1) ?? "N/D"}%.
                      </p>
                    )}
                    <p className="text-xs text-white/65">
                      Requiere demanda exacta del pack, stock Luna, costo/margen, peso/dimensiones, contenido/GTIN y aprobación final. Publicación automática: no.
                    </p>
                  </article>
                )}
              {pairedOfferPlan && (
                <article className="space-y-3 rounded-2xl border border-cyan-200/25 bg-cyan-200/[0.06] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className="font-black">Plan opcional automatizable</h4>
                      <p className="mt-1 text-xs text-white/65">
                        {demandBasisLabel(pairedOfferPlan.demandBasis)}
                      </p>
                    </div>
                    <span className="rounded-full border border-cyan-100/30 px-2 py-1 text-xs font-black">
                      {pairedModeLabel(pairedOfferPlan.recommendedMode)}
                    </span>
                  </div>
                  <dl className="grid gap-2 text-xs sm:grid-cols-3">
                    <div className="rounded-xl bg-black/25 p-2">
                      <dt className="text-white/50">Unidad comercial</dt>
                      <dd className="font-black">
                        1 oferta Luna · {pairedOfferPlan.primaryCommercialUnit.packCount}-pack
                        {pairedOfferPlan.primaryCommercialUnit.totalUnitCount
                          ? ` · ${pairedOfferPlan.primaryCommercialUnit.totalUnitCount} unidades`
                          : ""}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-black/25 p-2">
                      <dt className="text-white/50">Paquete opcional</dt>
                      <dd className="font-black">
                        {pairedOfferPlan.optionalPackage
                          ? `${pairedOfferPlan.optionalPackage.packCount}-pack · ${pairedOfferPlan.optionalPackage.supplierOfferMultiplier} oferta(s) Luna`
                          : "No recomendado todavía"}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-black/25 p-2">
                      <dt className="text-white/50">Precio objetivo del pack</dt>
                      <dd className="font-black">
                        {money(pairedOfferPlan.optionalPackage?.targetPrice)}
                      </dd>
                    </div>
                  </dl>
                  {pairedOfferPlan.optionalPackage && (
                    <p className="text-xs text-white/70">
                      Evidencia del paquete: {pairedOfferPlan.optionalPackage.soldEvidenceCount} observación(es) vendida(s) verificadas · {pairedOfferPlan.optionalPackage.activeListingCount} activa(s) · confianza {pairedOfferPlan.optionalPackage.evidenceConfidence}.
                    </p>
                  )}
                  {pairedOfferPlan.volumePricing.tiers.length > 0 && (
                    <p className="rounded-xl border border-emerald-200/20 bg-emerald-200/[0.05] p-2 text-xs text-emerald-50">
                      Preview calculado: comprar {pairedOfferPlan.volumePricing.tiers[0].minimumQuantity}+ ofertas comerciales con {pairedOfferPlan.volumePricing.tiers[0].calculatedDiscountPercent.toFixed(2)}% de descuento. Se recalcula con stock y margen antes de crear la promoción.
                    </p>
                  )}
                  <p className="text-xs text-white/65">
                    Reutiliza identidad, categoría, cumplimiento y research exacto. Solo repite las validaciones que cambian por pack: contenido, stock, costo, envío, título, specifics e imágenes visibles.
                  </p>
                  <p className="text-xs font-bold text-cyan-50">
                    Recomendación/preview automático: {pairedOfferPlan.automation.autoPrepareOptionalVariant || pairedOfferPlan.automation.autoCreatePromotionPreview ? "sí" : "no"} · publicación automática: no · aprobación humana final: obligatoria.
                  </p>
                  {pairedOfferPlan.blockers.length > 0 && (
                    <ul className="list-disc space-y-1 pl-5 text-xs text-amber-100">
                      {pairedOfferPlan.blockers.map((reason) => (
                        <li key={reason}>{humanReason(reason)}</li>
                      ))}
                    </ul>
                  )}
                </article>
              )}
              <div className="space-y-2">
                {decision.evidenceDistillation.packStrategy.packMatrix.map((pack) => (
                  <article key={pack.offerPackFingerprint} className="rounded-xl bg-black/25 p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <strong>{pack.packCount}-pack · {pack.totalUnitCount ?? "N/D"} unidades</strong>
                      <span className="rounded-full border border-white/20 px-2 py-1 text-xs font-black">{pack.decision}</span>
                    </div>
                    <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-4">
                      <div><dt className="text-white/50">Precio / unidad</dt><dd>{money(pack.medianLandedPrice)} / {money(pack.medianPricePerUnit)}</dd></div>
                      <div><dt className="text-white/50">Demanda / competencia</dt><dd>{pack.scores.demandConfidence.toFixed(0)} / {pack.competitionPressure.toFixed(0)}</dd></div>
                      <div><dt className="text-white/50">Beneficio / ROI / margen</dt><dd>{money(pack.economics.sellerProfit)} / {pack.economics.roiPercent?.toFixed(1) ?? "N/D"}% / {pack.economics.netMarginPercent?.toFixed(1) ?? "N/D"}%</dd></div>
                      <div><dt className="text-white/50">Descuento / score</dt><dd>{pack.economics.buyerDiscountPercent?.toFixed(1) ?? "N/D"}% / {pack.scores.overallPackStrategy.toFixed(0)}</dd></div>
                    </dl>
                    <p className="mt-2 text-xs text-white/70">{pack.explanation}</p>
                    {pack.operationalRisk.length > 0 && <p className="mt-1 text-xs text-amber-100">Pendiente: {pack.operationalRisk.join(", ")}</p>}
                  </article>
                ))}
              </div>
            </section>
          )}
          {showEvidence && decision && <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-black/35 p-3 text-xs">{JSON.stringify({ packageVersion: decision.packageVersion, verdict: decision.verdict, identityFingerprint: decision.identityFingerprint, assessment: decision.assessment, evidenceDistillation: decision.evidenceDistillation, canPublish: false }, null, 2)}</pre>}
        </>
      )}

      <div className="rounded-2xl border border-fuchsia-200/20 bg-fuchsia-200/[0.04] p-3">
        <h3 className="font-black">Generaciones OpenAI</h3>
        <p className="mt-1 text-xs text-white/60">Área separada; el scanner y el ranking mantienen OpenAI calls: 0.</p>
      </div>
      {status?.generations?.length ? (
        <div className="space-y-2">
          <h3 className="font-black">Historial de generaciones</h3>
          {status.generations.map((run) => (
            <button key={run.id} type="button" onClick={() => void loadGeneration(run.id)} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border border-white/15 px-3 text-left">
              <span><strong>{run.status}</strong><span className="block text-xs text-white/55">{new Date(run.created_at).toLocaleString("es")}</span></span>
              <span className="text-xs">v{run.revision_count + 1} · {money(run.total_estimated_cost_usd)}</span>
            </button>
          ))}
        </div>
      ) : <p className="text-sm text-white/60">Todavía no existen generaciones.</p>}

      {details && (
        <article className="space-y-3 rounded-2xl border border-white/15 bg-black/20 p-3">
          <div className="flex items-center justify-between gap-3"><h3 className="font-black">Generación seleccionada</h3><strong>{details.run.status}</strong></div>
          {currentVersion ? (
            <>
              <p className="text-lg font-black">{currentVersion.generation_output.recommendedTitle ?? "Título no disponible"}</p>
              <p className="whitespace-pre-wrap text-sm leading-6 text-white/75">{currentVersion.generation_output.description}</p>
              <dl className="grid grid-cols-2 gap-2 text-xs"><div><dt className="text-white/50">Precio</dt><dd>{money(currentVersion.generation_output.pricePresentation?.price)}</dd></div><div><dt className="text-white/50">Output hash</dt><dd className="break-all font-mono">{currentVersion.output_hash}</dd></div></dl>
              <div className="grid gap-2 sm:grid-cols-3">
                <button type="button" disabled={details.run.status !== "GENERATED" || working} onClick={() => void mutate("approve", { versionId: currentVersion.id, outputHash: currentVersion.output_hash, confirmed: true })} className="min-h-11 rounded-2xl bg-emerald-200 px-3 font-black text-black disabled:opacity-40">Aprobar</button>
                <button type="button" disabled={!["GENERATED", "HUMAN_REVIEW_REQUIRED"].includes(details.run.status) || working} onClick={() => void mutate("request-revision", { reasonCodes: ["HUMAN_COPY_REVIEW"] })} className="min-h-11 rounded-2xl border border-amber-200/30 px-3 font-black disabled:opacity-40">Solicitar una corrección</button>
                <button type="button" disabled={!["GENERATED", "HUMAN_REVIEW_REQUIRED"].includes(details.run.status) || working} onClick={() => void mutate("reject", { versionId: currentVersion.id, outputHash: currentVersion.output_hash, reasonCode: "HUMAN_REJECTED" })} className="min-h-11 rounded-2xl border border-rose-200/30 px-3 font-black text-rose-50 disabled:opacity-40">Rechazar</button>
              </div>
            </>
          ) : <p className="text-sm text-amber-100">La ejecución no produjo una versión estructurada válida.</p>}
          {details.versions.length > 1 && (
            <>
              <button type="button" onClick={() => setCompareVersions((value) => !value)} className="min-h-11 w-full rounded-2xl border border-white/20 font-black">{compareVersions ? "Ocultar comparación" : "Comparar versiones"}</button>
              {compareVersions && <div className="grid gap-2 sm:grid-cols-2">{details.versions.map((version) => <div key={version.id} className="rounded-xl bg-black/30 p-3 text-xs"><strong>Versión {version.version_number}</strong><p className="mt-2">{version.generation_output.recommendedTitle}</p><button type="button" disabled={version.id === details.run.current_version_id || working} onClick={() => void mutate("request-revision", { restoreVersionId: version.id, reasonCodes: ["RESTORE_PREVIOUS_VERSION"] })} className="mt-3 min-h-10 w-full rounded-xl border border-white/20 font-black disabled:opacity-40">Restaurar versión anterior</button></div>)}</div>}
            </>
          )}
          <details className="rounded-xl border border-white/10 p-3"><summary className="cursor-pointer font-bold">Validaciones e historial</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify({ validations: details.validations, approvals: details.approvals, safety: { canPublish: false, ebayWrites: 0 } }, null, 2)}</pre></details>
        </article>
      )}

      {error && <p role="alert" className="rounded-2xl border border-rose-200/30 bg-rose-200/[0.08] p-3 text-sm text-rose-50">{humanReason(error)}</p>}
      {message && <p role="status" className="rounded-2xl border border-emerald-200/25 bg-emerald-200/[0.07] p-3 text-sm text-emerald-50">{message}</p>}
      <p className="text-xs text-white/55">Sin cron · sin generación masiva · sin imágenes · sin drafts · sin publicación · eBay writes: 0.</p>
    </section>
  )
}
