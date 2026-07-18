import { createHash } from "node:crypto"

export const POST_PUBLICATION_OPTIMIZATION_RULESET_VERSION =
  "SELLER_OS_POST_PUBLICATION_DIAGNOSTICS_V1"

export const POST_PUBLICATION_OPTIMIZATION_EVENT_TYPES = [
  "LISTING_ZERO_VISIBILITY_REVIEW",
  "LISTING_IMPRESSIONS_NO_ENGAGEMENT_REVIEW",
  "LISTING_ENGAGEMENT_NO_CONVERSION_REVIEW",
  "LISTING_WATCHERS_NO_SALE_REVIEW",
  "LISTING_SALE_MARGIN_OR_STOCK_RISK",
] as const

export type PostPublicationOptimizationEventType =
  typeof POST_PUBLICATION_OPTIMIZATION_EVENT_TYPES[number]

export type PostPublicationListingStartSource =
  | "EBAY_OFFICIAL_START_TIME"
  | "SELLER_OS_REGISTRATION_FALLBACK"

export type PostPublicationListingStartEvidence = {
  timestamp: string
  source: PostPublicationListingStartSource
} | null

export type PostPublicationDiagnosticClassification =
  | "ZERO_VISIBILITY_AFTER_COMPLETE_WINDOW"
  | "IMPRESSIONS_WITHOUT_ENGAGEMENT"
  | "ENGAGEMENT_WITHOUT_CONVERSION"
  | "WATCHERS_WITHOUT_SALE"
  | "SALE_WITH_MARGIN_OR_STOCK_RISK"

export type PostPublicationExperimentVariable =
  | "CATEGORY"
  | "MAIN_IMAGE"
  | "TOTAL_OFFER_PRICE"
  | "SHIPPING_OFFER"
  | "LISTING_QUANTITY"

export type PostPublicationOptimizationPolicy = {
  version: string
  minimumListingAgeHours: number
  minimumCompleteAnalyticsDays: number
  minimumImpressionsForEngagementReview: number
  minimumViewsForConversionReview: number
  minimumWatchersForSaleReview: number
  marginRiskBelowPercent: number
  stockRiskAtOrBelowUnits: number
  optimizationCooldownHours: number
  operationalRiskCooldownHours: number
}

export const DEFAULT_POST_PUBLICATION_OPTIMIZATION_POLICY:
  PostPublicationOptimizationPolicy = {
  version: POST_PUBLICATION_OPTIMIZATION_RULESET_VERSION,
  minimumListingAgeHours: 7 * 24,
  minimumCompleteAnalyticsDays: 7,
  minimumImpressionsForEngagementReview: 100,
  minimumViewsForConversionReview: 30,
  minimumWatchersForSaleReview: 3,
  marginRiskBelowPercent: 20,
  stockRiskAtOrBelowUnits: 3,
  optimizationCooldownHours: 7 * 24,
  operationalRiskCooldownHours: 24,
}

export type PostPublicationDiagnosticInput = {
  marketplaceAccountKey: string
  listingId: string
  sku: string | null
  listingStatus: string
  listingEvidenceStartedAt: string | null
  listingEvidenceStartSource: PostPublicationListingStartSource | null
  observedAt: string
  analytics: {
    source: string | null
    completenessStatus: "complete" | "incomplete" | "unavailable"
    windowStart: string | null
    windowEnd: string | null
    impressions: number | null
    views: number | null
    transactions: number | null
    sourceDivergenceOpen: boolean
  }
  currentWatchers: number | null
  confirmedUnitsSold: number
  stockAvailable: number | null
  stockEvidenceFresh: boolean
  estimatedMarginPercent: number | null
  policy?: PostPublicationOptimizationPolicy
}

export type PostPublicationExperimentProposal = {
  contractVersion: "SELLER_OS_SINGLE_VARIABLE_EXPERIMENT_V1"
  variable: PostPublicationExperimentVariable
  changeCount: 1
  status: "AWAITING_HUMAN_APPROVAL"
  automaticChangeAllowed: false
  ebayWriteAllowed: false
  priceDecisionHumanOnly: true
  evidenceBasis: "OWN_LISTING_OFFICIAL_METRICS_AND_INTERNAL_COSTS"
  proposal: string
  measurementPlan: string
  guardrail: string
}

export type PostPublicationDiagnostic = {
  eventType: PostPublicationOptimizationEventType
  classification: PostPublicationDiagnosticClassification
  severity: "critical" | "high" | "medium" | "low"
  listingId: string
  sku: string | null
  detectedAt: string
  rulesetVersion: string
  deduplicationKey: string
  cooldownHours: number
  nextEligibleAt: string
  listingAgeHours: number
  listingAgeEvidence: {
    startedAt: string
    ageHours: number
    source: PostPublicationListingStartSource
    sourceLabel: "FUENTE EBAY" | "ESTIMACIÓN CONSERVADORA"
    conservativeEstimate: boolean
    explanation: string
  }
  completeAnalyticsDays: number
  notificationTitle: string
  whyItNeedsAttention: string
  recommendedAction: string
  reviewSequence: string[]
  experiment: PostPublicationExperimentProposal
  evidence: Record<string, unknown>
  safety: {
    ownListingEvidenceOnly: true
    officialAnalyticsRequired: boolean
    causalConclusionAllowed: false
    competitorRepricingUsed: false
    automaticPriceChangeAllowed: false
    automaticListingChangeAllowed: false
    openAiUsed: false
    ebayWriteUsed: false
    humanApprovalRequired: true
  }
}

const OFFICIAL_ANALYTICS_SOURCE = "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT"

function timestamp(value: string | null | undefined) {
  const parsed = Date.parse(value ?? "")
  return Number.isFinite(parsed) ? parsed : null
}

export function resolvePostPublicationListingStart(input: {
  officialStartTimeCandidates: unknown[]
  sellerOsRegisteredAt: unknown
}): PostPublicationListingStartEvidence {
  for (const value of input.officialStartTimeCandidates) {
    if (typeof value !== "string") continue
    const parsed = timestamp(value)
    if (parsed !== null) return {
      timestamp: new Date(parsed).toISOString(),
      source: "EBAY_OFFICIAL_START_TIME",
    }
  }
  if (typeof input.sellerOsRegisteredAt !== "string") return null
  const registeredAt = timestamp(input.sellerOsRegisteredAt)
  return registeredAt === null
    ? null
    : {
        timestamp: new Date(registeredAt).toISOString(),
        source: "SELLER_OS_REGISTRATION_FALLBACK",
      }
}

function nonnegative(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null
}

function elapsedHours(start: string | null, end: string) {
  const startAt = timestamp(start)
  const endAt = timestamp(end)
  if (startAt === null || endAt === null || endAt < startAt) return null
  return Math.floor((endAt - startAt) / 3_600_000)
}

function inclusiveDays(start: string | null, end: string | null) {
  const startAt = timestamp(start)
  const endAt = timestamp(end)
  if (startAt === null || endAt === null || endAt < startAt) return 0
  return Math.floor((endAt - startAt) / 86_400_000) + 1
}

function cooldownWindow(observedAt: string, hours: number) {
  const observed = timestamp(observedAt)
  if (observed === null) throw new Error("POST_PUBLICATION_OBSERVED_AT_INVALID")
  const duration = hours * 3_600_000
  const windowStart = Math.floor(observed / duration) * duration
  return {
    bucket: new Date(windowStart).toISOString(),
    nextEligibleAt: new Date(observed + duration).toISOString(),
  }
}

export function postPublicationCooldownElapsed(input: {
  previousDetectedAt: string | null
  currentDetectedAt: string
  cooldownHours: number
}) {
  if (!input.previousDetectedAt) return true
  const previous = timestamp(input.previousDetectedAt)
  const current = timestamp(input.currentDetectedAt)
  if (previous === null || current === null || current < previous) return false
  return current - previous >= input.cooldownHours * 3_600_000
}

function diagnosticKey(input: {
  marketplaceAccountKey: string
  listingId: string
  sku: string | null
  classification: string
  rulesetVersion: string
  cooldownBucket: string
}) {
  const digest = createHash("sha256").update(JSON.stringify([
    input.marketplaceAccountKey,
    input.listingId,
    input.sku,
    input.classification,
    input.rulesetVersion,
    input.cooldownBucket,
  ])).digest("hex")
  return `post-publication-v1:${digest}`
}

function experiment(
  variable: PostPublicationExperimentVariable,
  proposal: string,
  measurementPlan: string,
  guardrail: string,
): PostPublicationExperimentProposal {
  return {
    contractVersion: "SELLER_OS_SINGLE_VARIABLE_EXPERIMENT_V1",
    variable,
    changeCount: 1,
    status: "AWAITING_HUMAN_APPROVAL",
    automaticChangeAllowed: false,
    ebayWriteAllowed: false,
    priceDecisionHumanOnly: true,
    evidenceBasis: "OWN_LISTING_OFFICIAL_METRICS_AND_INTERNAL_COSTS",
    proposal,
    measurementPlan,
    guardrail,
  }
}

type Candidate = Omit<PostPublicationDiagnostic,
  "listingId" | "sku" | "detectedAt" | "rulesetVersion" |
  "deduplicationKey" | "cooldownHours" | "nextEligibleAt" |
  "listingAgeHours" | "listingAgeEvidence" | "completeAnalyticsDays" | "safety">

function optimizationCandidate(
  input: PostPublicationDiagnosticInput,
  policy: PostPublicationOptimizationPolicy,
): Candidate | null {
  const impressions = nonnegative(input.analytics.impressions)
  const views = nonnegative(input.analytics.views)
  const transactions = nonnegative(input.analytics.transactions)
  const watchers = nonnegative(input.currentWatchers)

  if (
    watchers !== null && watchers >= policy.minimumWatchersForSaleReview &&
    transactions === 0 && input.confirmedUnitsSold === 0
  ) return {
    eventType: "LISTING_WATCHERS_NO_SALE_REVIEW",
    classification: "WATCHERS_WITHOUT_SALE",
    severity: "medium",
    notificationTitle: "Este listing necesita revisar la oferta",
    whyItNeedsAttention: `${watchers} compradores observan el listing y la ventana oficial no registra ventas. Es una señal de interés, no una causa ni una venta.`,
    recommendedAction: "Revisar primero el costo total para el comprador y el envío. Cualquier cambio requiere tu aprobación.",
    reviewSequence: ["Precio total", "Envío", "Devoluciones", "Claridad del pack"],
    experiment: experiment(
      "SHIPPING_OFFER",
      "Proponer una sola mejora verificable en la oferta de envío; no aplicarla automáticamente.",
      "Mantener el resto del listing sin cambios durante al menos 7 días y comparar métricas propias del mismo listing.",
      "No atribuir causalidad; no cambiar precio, imágenes o título durante este experimento.",
    ),
    evidence: { impressions, views, transactions, currentWatchers: watchers },
  }

  if (
    views !== null && views >= policy.minimumViewsForConversionReview &&
    transactions === 0 && input.confirmedUnitsSold === 0
  ) return {
    eventType: "LISTING_ENGAGEMENT_NO_CONVERSION_REVIEW",
    classification: "ENGAGEMENT_WITHOUT_CONVERSION",
    severity: "medium",
    notificationTitle: "Este listing recibe interés, pero necesita revisar conversión",
    whyItNeedsAttention: `La fuente oficial registra ${views} vistas y ninguna transacción en la ventana analizada. Esto describe la muestra; no prueba qué elemento explica el resultado.`,
    recommendedAction: "Revisar costo total, envío, devoluciones y claridad del pack. El precio final seguirá siendo una decisión humana basada en costos propios.",
    reviewSequence: ["Precio total", "Envío", "Devoluciones", "Pack", "Descripción"],
    experiment: experiment(
      "TOTAL_OFFER_PRICE",
      "Preparar una valoración humana de un solo precio total usando costo, fees, envío y margen mínimo propios.",
      "Si se aprueba, mantener título, imágenes, pack y políticas sin cambios durante al menos 7 días.",
      "Nunca usar precios de competidores para repricing ni bajar del precio piso interno.",
    ),
    evidence: { impressions, views, transactions, currentWatchers: watchers },
  }

  if (
    impressions !== null && impressions >= policy.minimumImpressionsForEngagementReview &&
    views === 0 && transactions === 0
  ) return {
    eventType: "LISTING_IMPRESSIONS_NO_ENGAGEMENT_REVIEW",
    classification: "IMPRESSIONS_WITHOUT_ENGAGEMENT",
    severity: "medium",
    notificationTitle: "Este listing aparece, pero necesita mejorar su presentación",
    whyItNeedsAttention: `La fuente oficial registra ${impressions} impresiones y ninguna vista en la ventana completa. La asociación no identifica una causa.`,
    recommendedAction: "Revisar primero la imagen principal y después el título, en experimentos separados y con aprobación humana.",
    reviewSequence: ["Imagen principal", "Título", "Claridad de cantidad y pack"],
    experiment: experiment(
      "MAIN_IMAGE",
      "Proponer una sola imagen principal autorizada más clara; no generarla ni aplicarla automáticamente.",
      "Si se aprueba, mantener título, precio y políticas sin cambios durante al menos 7 días.",
      "Usar sólo imágenes propias, Luna autorizadas o fabricante autorizado; no usar imágenes de competidores.",
    ),
    evidence: { impressions, views, transactions, currentWatchers: watchers },
  }

  if (impressions === 0 && views === 0 && transactions === 0) return {
    eventType: "LISTING_ZERO_VISIBILITY_REVIEW",
    classification: "ZERO_VISIBILITY_AFTER_COMPLETE_WINDOW",
    severity: "high",
    notificationTitle: "Este listing necesita una revisión de visibilidad",
    whyItNeedsAttention: "La ventana oficial completa no registra impresiones, vistas ni transacciones. Primero debemos descartar un problema de indexación o configuración.",
    recommendedAction: "Auditar indexación, categoría hoja y aspectos obligatorios antes de proponer un cambio de título.",
    reviewSequence: ["Indexación", "Categoría hoja", "Aspectos obligatorios", "Título"],
    experiment: experiment(
      "CATEGORY",
      "Preparar una revisión de categoría; sólo proponer un cambio si Taxonomy confirma una categoría hoja más exacta.",
      "Tras aprobación, cambiar únicamente la categoría y observar una nueva ventana completa.",
      "No cambiar simultáneamente título, imagen, precio ni políticas.",
    ),
    evidence: { impressions, views, transactions, currentWatchers: watchers },
  }

  return null
}

function saleRiskCandidate(input: PostPublicationDiagnosticInput, policy: PostPublicationOptimizationPolicy): Candidate | null {
  const confirmedUnitsSold = nonnegative(input.confirmedUnitsSold) ?? 0
  const margin = typeof input.estimatedMarginPercent === "number" &&
    Number.isFinite(input.estimatedMarginPercent)
    ? input.estimatedMarginPercent
    : null
  const stock = nonnegative(input.stockAvailable)
  if (confirmedUnitsSold < 1) return null
  const marginRisk = margin !== null && margin < policy.marginRiskBelowPercent
  const stockRisk = input.stockEvidenceFresh !== true || stock === null ||
    stock <= policy.stockRiskAtOrBelowUnits
  if (!marginRisk && !stockRisk) return null
  const variable: PostPublicationExperimentVariable = stockRisk
    ? "LISTING_QUANTITY"
    : "TOTAL_OFFER_PRICE"
  return {
    eventType: "LISTING_SALE_MARGIN_OR_STOCK_RISK",
    classification: "SALE_WITH_MARGIN_OR_STOCK_RISK",
    severity: stock === 0 || (margin !== null && margin < 10)
      ? "critical"
      : "high",
    notificationTitle: "Venta confirmada: revisa stock o margen antes de continuar",
    whyItNeedsAttention: `Orders confirma ${confirmedUnitsSold} unidad(es) vendida(s); ${stockRisk ? "el stock Luna es bajo, desconocido o agotado" : "el margen interno está bajo el mínimo"}.`,
    recommendedAction: stockRisk
      ? "Abrir la variante exacta de Luna y confirmar disponibilidad. Cualquier ajuste de cantidad en eBay será manual."
      : "Recalcular costos propios y valorar manualmente el precio; no se aplicará repricing automático.",
    reviewSequence: stockRisk
      ? ["Stock Luna exacto", "Cantidad del listing", "Margen"]
      : ["Costo Luna", "Envío", "Fees", "Margen", "Precio humano"],
    experiment: experiment(
      variable,
      stockRisk
        ? "Proponer, después de confirmar Luna, una única decisión humana sobre cantidad disponible."
        : "Proponer una única valoración humana del precio usando solamente costos y margen propios.",
      "Registrar la decisión y no mezclarla con cambios de título, imágenes, pack o políticas.",
      "Sin escrituras eBay automáticas; sin repricing competitivo; detener si stock o margen no quedan seguros.",
    ),
    evidence: {
      confirmedUnitsSold,
      confirmedSalesSource: "EBAY_SELL_FULFILLMENT_COMPLETED_CHECKOUT_ORDERS",
      stockAvailable: stock,
      stockEvidenceFresh: input.stockEvidenceFresh,
      estimatedMarginPercent: margin,
      marginRiskBelowPercent: policy.marginRiskBelowPercent,
      stockRiskAtOrBelowUnits: policy.stockRiskAtOrBelowUnits,
    },
  }
}

export function diagnosePostPublicationListing(
  input: PostPublicationDiagnosticInput,
): PostPublicationDiagnostic | null {
  const policy = input.policy ?? DEFAULT_POST_PUBLICATION_OPTIMIZATION_POLICY
  const listingAgeHours = elapsedHours(input.listingEvidenceStartedAt, input.observedAt)
  const listingStartSourceValid = input.listingEvidenceStartSource ===
    "EBAY_OFFICIAL_START_TIME" || input.listingEvidenceStartSource ===
    "SELLER_OS_REGISTRATION_FALLBACK"
  if (
    input.listingStatus !== "active" || listingAgeHours === null ||
    !input.listingEvidenceStartedAt || !listingStartSourceValid
  ) return null

  const listingAgeEvidence = input.listingEvidenceStartSource ===
    "EBAY_OFFICIAL_START_TIME"
    ? {
        startedAt: input.listingEvidenceStartedAt,
        ageHours: listingAgeHours,
        source: "EBAY_OFFICIAL_START_TIME" as const,
        sourceLabel: "FUENTE EBAY" as const,
        conservativeEstimate: false,
        explanation: "Antigüedad calculada desde la fecha oficial de inicio informada por eBay.",
      }
    : {
        startedAt: input.listingEvidenceStartedAt,
        ageHours: listingAgeHours,
        source: "SELLER_OS_REGISTRATION_FALLBACK" as const,
        sourceLabel: "ESTIMACIÓN CONSERVADORA" as const,
        conservativeEstimate: true,
        explanation: "Antigüedad mínima calculada desde el registro en Seller OS; el listing puede ser más antiguo.",
      }

  const saleRisk = saleRiskCandidate(input, policy)
  const completeAnalyticsDays = inclusiveDays(
    input.analytics.windowStart,
    input.analytics.windowEnd,
  )
  const officialAnalyticsComplete =
    input.analytics.source === OFFICIAL_ANALYTICS_SOURCE &&
    input.analytics.completenessStatus === "complete" &&
    input.analytics.sourceDivergenceOpen === false &&
    completeAnalyticsDays >= policy.minimumCompleteAnalyticsDays

  const candidate = saleRisk ?? (
    listingAgeHours >= policy.minimumListingAgeHours && officialAnalyticsComplete
      ? optimizationCandidate(input, policy)
      : null
  )
  if (!candidate) return null

  const cooldownHours = saleRisk
    ? policy.operationalRiskCooldownHours
    : policy.optimizationCooldownHours
  const window = cooldownWindow(input.observedAt, cooldownHours)
  const deduplicationKey = diagnosticKey({
    marketplaceAccountKey: input.marketplaceAccountKey,
    listingId: input.listingId,
    sku: input.sku,
    classification: candidate.classification,
    rulesetVersion: policy.version,
    cooldownBucket: window.bucket,
  })

  return {
    ...candidate,
    listingId: input.listingId,
    sku: input.sku,
    detectedAt: input.observedAt,
    rulesetVersion: policy.version,
    deduplicationKey,
    cooldownHours,
    nextEligibleAt: window.nextEligibleAt,
    listingAgeHours,
    listingAgeEvidence,
    completeAnalyticsDays,
    evidence: {
      ...candidate.evidence,
      listingEvidenceStartedAt: input.listingEvidenceStartedAt,
      listingEvidenceStartSource: listingAgeEvidence.source,
      listingAgeEvidence,
      listingAgeHours,
      minimumListingAgeHours: policy.minimumListingAgeHours,
      analyticsSource: input.analytics.source,
      analyticsCompletenessStatus: input.analytics.completenessStatus,
      completeAnalyticsDays,
      minimumCompleteAnalyticsDays: policy.minimumCompleteAnalyticsDays,
      sampleThresholds: {
        impressions: policy.minimumImpressionsForEngagementReview,
        views: policy.minimumViewsForConversionReview,
        watchers: policy.minimumWatchersForSaleReview,
      },
      rulesetVersion: policy.version,
      cooldownHours,
      nextEligibleAt: window.nextEligibleAt,
      experiment: candidate.experiment,
      existingPerformanceEvidenceContract:
        "EBAY_LISTING_PERFORMANCE_SNAPSHOTS_OFFICIAL_OWN_LISTING",
      interpretation: "Asociación descriptiva de métricas propias; no prueba causalidad.",
      approvalStatus: "AWAITING_HUMAN_APPROVAL",
      changeApplied: false,
    },
    safety: {
      ownListingEvidenceOnly: true,
      officialAnalyticsRequired: !saleRisk,
      causalConclusionAllowed: false,
      competitorRepricingUsed: false,
      automaticPriceChangeAllowed: false,
      automaticListingChangeAllowed: false,
      openAiUsed: false,
      ebayWriteUsed: false,
      humanApprovalRequired: true,
    },
  }
}
