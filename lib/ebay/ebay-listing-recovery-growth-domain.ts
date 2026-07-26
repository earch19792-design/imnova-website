import { createHash } from "node:crypto"

import {
  evaluateSafePromotionRate,
  type PostPublicationPromotionEligibility,
} from "../marketplace/post-publication-optimization-domain"

export const EBAY_LISTING_RECOVERY_ENGINE_VERSION =
  "EBAY_LISTING_RECOVERY_AND_GROWTH_ENGINE_V1"

export const EBAY_LISTING_RECOVERY_STATES = [
  "POST_PUBLISH_VERIFICATION",
  "OBSERVATION_WINDOW",
  "PERFORMANCE_BASELINE_READY",
  "PERFORMANCE_DIAGNOSIS",
  "ACTION_PROPOSED",
  "EXPERIMENT_PREPARED",
  "EXPERIMENT_ACTIVE",
  "COOLDOWN",
  "EXPERIMENT_EVALUATION",
  "PERFORMANCE_RECOVERED",
  "CONTINUE_MONITORING",
  "NEXT_OPTIMIZATION_LEVEL",
  "WAITING_FOR_SUFFICIENT_SAMPLE",
  "ROLLBACK_REQUIRED",
  "PRICE_TEST_ELIGIBLE",
  "PAUSE_OR_RETIRE_RECOMMENDED",
  "QUARANTINED_OPTIMIZATION_ERROR",
] as const

export const EBAY_LISTING_RECOVERY_DIAGNOSES = [
  "NO_IMPRESSIONS",
  "IMPRESSIONS_NO_CLICKS",
  "CLICKS_NO_CONVERSION",
  "INTEREST_WITHOUT_SALE",
  "PROMOTED_NO_RESULT",
  "PRICE_NOT_COMPETITIVE",
  "MARKET_DEMAND_WEAK",
  "LISTING_TECHNICAL_PROBLEM",
  "INSUFFICIENT_EVIDENCE",
] as const

export const EBAY_LISTING_RECOVERY_ACTION_LADDER = [
  "TECHNICAL_VERIFICATION",
  "EVIDENCE_REVALIDATION",
  "CATEGORY_AND_ASPECTS",
  "DISCOVERY_AND_KEYWORDS",
  "MAIN_IMAGE_OR_TITLE",
  "SECONDARY_IMAGES_AND_CONVERSION",
  "SHIPPING_RETURNS_COMMERCIAL_INFO",
  "CPS_PROMOTION",
  "INTERESTED_BUYER_OFFER",
  "LIMITED_PRICE_TEST",
  "PAUSE_RETIRE_OR_REPLACE",
] as const

export type RecoveryState = typeof EBAY_LISTING_RECOVERY_STATES[number]
export type RecoveryDiagnosis = typeof EBAY_LISTING_RECOVERY_DIAGNOSES[number]
export type RecoveryActionName =
  typeof EBAY_LISTING_RECOVERY_ACTION_LADDER[number]

export type RecoveryPolicy = {
  version: string
  minimumObservationHours: number
  organicFreshnessHours: number
  paidReconciliationHours: number
  minimumImpressions: number
  minimumViews: number
  provisionalMinimumCtrPercent: number
  provisionalMinimumConversionPercent: number
  minimumCohortListings: number
  minimumEvidenceConfidence: number
  cooldownHours: number
  maximumExperimentsPerListing: number
  maximumPublicPriceStepPercent: number
  maximumOfferDiscountPercent: number
  minimumNetContribution: number
  minimumMarginPercent: number
  minimumRoiPercent: number
}

export const DEFAULT_RECOVERY_POLICY: RecoveryPolicy = {
  version: "EBAY_RECOVERY_POLICY_V1",
  minimumObservationHours: 7 * 24,
  organicFreshnessHours: 48,
  paidReconciliationHours: 72,
  minimumImpressions: 100,
  minimumViews: 30,
  provisionalMinimumCtrPercent: 1,
  provisionalMinimumConversionPercent: 1,
  minimumCohortListings: 10,
  minimumEvidenceConfidence: 0.8,
  cooldownHours: 7 * 24,
  maximumExperimentsPerListing: 6,
  maximumPublicPriceStepPercent: 3,
  maximumOfferDiscountPercent: 3,
  minimumNetContribution: 5,
  minimumMarginPercent: 20,
  minimumRoiPercent: 30,
}

export type OrganicTrafficMetrics = {
  source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT"
  scope: "sell.analytics.readonly"
  capturedAt: string
  lastUpdatedDate: string | null
  timezone: string
  windowStart: string
  windowEnd: string
  completeness: "COMPLETE" | "INCOMPLETE" | "UNAVAILABLE"
  reconciliation: "RECONCILED" | "PENDING" | "UNKNOWN"
  impressions: number | null
  searchImpressions: number | null
  storeImpressions: number | null
  views: number | null
  searchViews: number | null
  directViews: number | null
  externalViews: number | null
  otherEbayViews: number | null
  storeViews: number | null
  ctrPercent: number | null
  salesConversionRatePercent: number | null
  transactions: number | null
}

export type PaidTrafficMetrics = {
  source: "EBAY_SELL_MARKETING_AD_REPORT"
  scope: "sell.marketing.readonly" | "sell.marketing"
  capturedAt: string
  lastUpdatedDate: string | null
  windowStart: string
  windowEnd: string
  completeness: "COMPLETE" | "INCOMPLETE" | "UNAVAILABLE"
  reconciliation: "RECONCILED" | "PENDING" | "UNKNOWN"
  fundingModel: "COST_PER_SALE" | "COST_PER_CLICK"
  campaignStatus: string
  campaignId: string | null
  adGroupId: string | null
  impressions: number | null
  clicks: number | null
  ctrPercent: number | null
  attributedSales: number | null
  salesConversionRatePercent: number | null
  adFees: number | null
  costPerClick: number | null
  roas: number | null
}

export type RecoveryPerformanceBaseline = {
  version: string
  source: "ACCOUNT_COHORT" | "PROVISIONAL_CONSERVATIVE"
  categoryId: string | null
  condition: string | null
  priceBand: string | null
  listingAgeBand: string | null
  productType: string | null
  pack: string | null
  trafficMode: "ORGANIC" | "PROMOTED"
  sampleSize: number
  minimumImpressions: number
  minimumViews: number
  minimumCtrPercent: number
  minimumConversionPercent: number
}

export type CanonicalRecoveryEconomics = {
  source: "EBAY_UNIT_ECONOMICS_V1"
  policyVersion: string
  calculationHash: string
  costsComplete: boolean
  currentPrice: number | null
  landedPrice: number | null
  safeFloor: number | null
  currentContribution: number | null
  currentMarginPercent: number | null
  currentRoiPercent: number | null
  stockAvailable: number | null
  stockFresh: boolean
  costObservedAt: string | null
  paidAdFeesIncluded: boolean
  returnReserveIncluded: boolean
  priceTestScenario: {
    proposedPrice: number
    projectedContribution: number
    projectedMarginPercent: number
    projectedRoiPercent: number
  } | null
}

export type RecoveryComparable = {
  id: string
  classification:
    | "SOLD_CONFIRMED"
    | "SOLD_ESTIMATED"
    | "ACTIVE_ONLY"
    | "INSUFFICIENT_EVIDENCE"
  comparabilityScore: number
  landedPrice: number | null
  categoryId: string | null
  condition: string | null
  pack: string | null
  variant: string | null
  shippingPattern: string | null
  returnPattern: string | null
  titlePatternTokens: string[]
  visualPatternTags: string[]
  confirmedUnitsSold: number
  observedAt: string
}

export type ListingRecoveryInput = {
  marketplaceAccountKey: string
  marketplace: string
  listingId: string
  sku: string | null
  offerId: string | null
  itemId: string | null
  dossierId: string | null
  observedAt: string
  listing: {
    status: string
    publishedAt: string | null
    categoryId: string | null
    condition: string | null
    pack: string | null
    productType: string | null
    priceBand: string | null
    activeVerified: boolean
    inventoryItemVerified: boolean
    offerVerified: boolean
    itemIdVerified: boolean
    categoryValid: boolean
    requiredAspectsComplete: boolean
    policiesResolved: boolean
    stockPositive: boolean
    indexationIssueCodes: string[]
  }
  metrics: {
    organic: OrganicTrafficMetrics | null
    paid: PaidTrafficMetrics | null
  }
  baseline: RecoveryPerformanceBaseline | null
  evidence: {
    level: "E0" | "E1" | "E2" | "E3" | "E4" | "E5"
    confidence: number
    fresh: boolean
    complete: boolean
    salesClassification:
      | "SOLD_CONFIRMED"
      | "SOLD_ESTIMATED"
      | "ACTIVE_ONLY"
      | "INSUFFICIENT_EVIDENCE"
    confirmedUnitsSold: number
    profitableConfirmedUnits: number
    sourceRefs: string[]
  }
  economics: CanonicalRecoveryEconomics
  promotionEligibility: PostPublicationPromotionEligibility | null
  interestedBuyerEligibility: {
    status: "ELIGIBLE" | "NOT_ELIGIBLE" | "UNAVAILABLE"
    source: "EBAY_NEGOTIATION_FIND_ELIGIBLE_ITEMS" | "UNAVAILABLE"
    capturedAt: string | null
    negotiationImplemented: boolean
  }
  comparables: RecoveryComparable[]
  history: {
    completedActionLevels: number[]
    activeExperiment: boolean
    experimentCount: number
    lastExperimentAt: string | null
    previousMainImageHash: string | null
    previousTitleHash: string | null
  }
  policy?: RecoveryPolicy
}

export type CompetitiveGapReport = {
  version: "EBAY_COMPETITIVE_GAP_REPORT_V1"
  exactComparableCount: number
  confirmedWinnerCount: number
  activeOnlyCount: number
  whatWinningSellersDoBetter: string[]
  whatImnovaDoesBetter: string[]
  gapsWeCanSafelyClose: string[]
  gapsWeMustNotCopy: string[]
  unverifiedHypotheses: string[]
  recommendedNextExperiment: string
  evidenceRefs: string[]
  competitorContentCopied: false
}

export type RecoveryExperimentProposal = {
  contractVersion: "EBAY_RECOVERY_SINGLE_VARIABLE_EXPERIMENT_V1"
  experimentIdempotencyKey: string
  variable: string
  mutationFields: [string]
  hypothesis: string
  primaryKpi: string
  baseline: Record<string, number | null>
  previousValue: unknown
  proposedValue: unknown
  observationWindowDays: number
  minimumSample: number
  guardrails: string[]
  rollback: {
    supported: true
    value: unknown
    automatic: false
  }
  executionMechanism:
    | "EXISTING_TITLE_REVISION_LEDGER"
    | "EXISTING_IMAGE_REVISION_LEDGER"
    | "EXISTING_COMMERCIAL_IMPROVEMENT_LEDGER"
    | "NEGOTIATION_NOT_IMPLEMENTED"
    | "MANUAL_ONLY"
  automaticExecutionAllowed: false
  ebayWriteAllowed: false
  requiresHumanApproval: true
}

export type RecoveryDecision = {
  engineVersion: string
  policyVersion: string
  listingId: string
  sku: string | null
  state: RecoveryState
  diagnosis: RecoveryDiagnosis
  actionLevel: number | null
  action: RecoveryActionName | null
  reason: string
  whyNotNextLevel: string
  funnel: {
    impressions: number | null
    views: number | null
    interest: "ELIGIBLE" | "NOT_ELIGIBLE" | "UNAVAILABLE"
    trafficTransactions: number | null
    confirmedUnitsSold: number
    profitableConfirmedUnits: number
  }
  baseline: RecoveryPerformanceBaseline
  competitiveGap: CompetitiveGapReport
  experiment: RecoveryExperimentProposal | null
  safety: {
    metricsFresh: boolean
    metricsReconciled: boolean
    organicPaidSeparated: true
    activeOnlyUsedAsSale: false
    priceFloorProtected: boolean
    cpcAutomaticAllowed: false
    ebayWrites: 0
    stateMutations: 0
    externalEffects: 0
  }
  evidenceRefs: string[]
}

const TRANSITIONS: Record<RecoveryState, RecoveryState[]> = {
  POST_PUBLISH_VERIFICATION: ["OBSERVATION_WINDOW", "QUARANTINED_OPTIMIZATION_ERROR"],
  OBSERVATION_WINDOW: ["PERFORMANCE_BASELINE_READY", "WAITING_FOR_SUFFICIENT_SAMPLE"],
  PERFORMANCE_BASELINE_READY: ["PERFORMANCE_DIAGNOSIS"],
  PERFORMANCE_DIAGNOSIS: [
    "ACTION_PROPOSED", "PERFORMANCE_RECOVERED", "CONTINUE_MONITORING",
    "WAITING_FOR_SUFFICIENT_SAMPLE", "PRICE_TEST_ELIGIBLE",
    "PAUSE_OR_RETIRE_RECOMMENDED", "QUARANTINED_OPTIMIZATION_ERROR",
  ],
  ACTION_PROPOSED: ["EXPERIMENT_PREPARED", "CONTINUE_MONITORING"],
  EXPERIMENT_PREPARED: ["EXPERIMENT_ACTIVE", "CONTINUE_MONITORING"],
  EXPERIMENT_ACTIVE: ["COOLDOWN", "ROLLBACK_REQUIRED", "QUARANTINED_OPTIMIZATION_ERROR"],
  COOLDOWN: ["EXPERIMENT_EVALUATION", "ROLLBACK_REQUIRED"],
  EXPERIMENT_EVALUATION: [
    "PERFORMANCE_RECOVERED", "CONTINUE_MONITORING", "NEXT_OPTIMIZATION_LEVEL",
    "WAITING_FOR_SUFFICIENT_SAMPLE", "ROLLBACK_REQUIRED",
    "PRICE_TEST_ELIGIBLE", "PAUSE_OR_RETIRE_RECOMMENDED",
  ],
  PERFORMANCE_RECOVERED: ["CONTINUE_MONITORING"],
  CONTINUE_MONITORING: ["OBSERVATION_WINDOW", "PERFORMANCE_DIAGNOSIS"],
  NEXT_OPTIMIZATION_LEVEL: ["PERFORMANCE_DIAGNOSIS"],
  WAITING_FOR_SUFFICIENT_SAMPLE: ["OBSERVATION_WINDOW", "PERFORMANCE_DIAGNOSIS"],
  ROLLBACK_REQUIRED: ["COOLDOWN", "CONTINUE_MONITORING"],
  PRICE_TEST_ELIGIBLE: ["ACTION_PROPOSED", "PAUSE_OR_RETIRE_RECOMMENDED"],
  PAUSE_OR_RETIRE_RECOMMENDED: ["CONTINUE_MONITORING"],
  QUARANTINED_OPTIMIZATION_ERROR: ["PERFORMANCE_DIAGNOSIS"],
}

export function isAllowedRecoveryTransition(
  previous: RecoveryState,
  next: RecoveryState,
) {
  return TRANSITIONS[previous].includes(next)
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function nonnegative(value: unknown) {
  const parsed = number(value)
  return parsed !== null && parsed >= 0 ? parsed : null
}

function timestamp(value: string | null | undefined) {
  const parsed = Date.parse(value ?? "")
  return Number.isFinite(parsed) ? parsed : null
}

function elapsedHours(start: string | null, end: string) {
  const startAt = timestamp(start)
  const endAt = timestamp(end)
  return startAt !== null && endAt !== null && endAt >= startAt
    ? (endAt - startAt) / 3_600_000
    : null
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function baseline(input: ListingRecoveryInput, policy: RecoveryPolicy):
  RecoveryPerformanceBaseline {
  if (
    input.baseline &&
    input.baseline.sampleSize >= policy.minimumCohortListings
  ) return input.baseline
  return {
    version: `${policy.version}:PROVISIONAL`,
    source: "PROVISIONAL_CONSERVATIVE",
    categoryId: input.listing.categoryId,
    condition: input.listing.condition,
    priceBand: input.listing.priceBand,
    listingAgeBand: null,
    productType: input.listing.productType,
    pack: input.listing.pack,
    trafficMode: input.metrics.paid ? "PROMOTED" : "ORGANIC",
    sampleSize: input.baseline?.sampleSize ?? 0,
    minimumImpressions: policy.minimumImpressions,
    minimumViews: policy.minimumViews,
    minimumCtrPercent: policy.provisionalMinimumCtrPercent,
    minimumConversionPercent: policy.provisionalMinimumConversionPercent,
  }
}

export function buildCompetitiveGapReport(
  input: Pick<ListingRecoveryInput, "comparables" | "evidence" | "listing">,
): CompetitiveGapReport {
  const exact = input.comparables.filter((row) =>
    row.comparabilityScore >= 85 &&
    row.condition === input.listing.condition &&
    row.pack === input.listing.pack
  )
  const winners = exact.filter((row) =>
    row.classification === "SOLD_CONFIRMED" && row.confirmedUnitsSold > 0
  )
  const activeOnly = exact.filter((row) => row.classification === "ACTIVE_ONLY")
  const winningTokens = [...new Set(winners.flatMap((row) =>
    row.titlePatternTokens.filter((token) => /^[A-Za-z0-9 -]{2,40}$/.test(token))
  ))].slice(0, 8)
  const visualPatterns = [...new Set(winners.flatMap((row) =>
    row.visualPatternTags.filter((tag) => /^[A-Za-z0-9 _-]{2,60}$/.test(tag))
  ))].slice(0, 6)
  return {
    version: "EBAY_COMPETITIVE_GAP_REPORT_V1",
    exactComparableCount: exact.length,
    confirmedWinnerCount: winners.length,
    activeOnlyCount: activeOnly.length,
    whatWinningSellersDoBetter: winners.length
      ? [
          ...(winningTokens.length
            ? [`Cobertura agregada de términos verificados: ${winningTokens.join(", ")}.`]
            : []),
          ...(visualPatterns.length
            ? [`Patrones visuales agregados: ${visualPatterns.join(", ")}.`]
            : []),
        ]
      : ["No hay vendedores ganadores verificables con ventas confirmadas."],
    whatImnovaDoesBetter: [
      "IMNOVA conserva identidad, piso económico y trazabilidad por evidencia.",
    ],
    gapsWeCanSafelyClose: winners.length
      ? ["Probar un patrón agregado verificable sin copiar contenido creativo."]
      : ["Continuar recopilando ventas confirmadas y comparables exactos."],
    gapsWeMustNotCopy: [
      "Títulos completos, descripciones, fotografías, logotipos y claims de terceros.",
    ],
    unverifiedHypotheses: activeOnly.length
      ? [`${activeOnly.length} listings ACTIVE_ONLY miden oferta, no ventas ni demanda.`]
      : [],
    recommendedNextExperiment: winners.length
      ? "Seleccionar una sola diferencia verificable y medirla."
      : "No cambiar precio; ampliar evidencia oficial.",
    evidenceRefs: [...input.evidence.sourceRefs],
    competitorContentCopied: false,
  }
}

function metricsFresh(input: ListingRecoveryInput, policy: RecoveryPolicy) {
  const organic = input.metrics.organic
  if (!organic) return false
  const age = elapsedHours(organic.capturedAt, input.observedAt)
  return age !== null && age <= policy.organicFreshnessHours &&
    input.evidence.fresh
}

function metricsReconciled(input: ListingRecoveryInput) {
  const organic = input.metrics.organic
  if (!organic || organic.reconciliation !== "RECONCILED") return false
  const paid = input.metrics.paid
  return !paid || paid.reconciliation === "RECONCILED"
}

function technicalProblems(input: ListingRecoveryInput) {
  const listing = input.listing
  return [
    !listing.activeVerified ? "LISTING_ACTIVE_NOT_VERIFIED" : null,
    !listing.inventoryItemVerified ? "INVENTORY_ITEM_NOT_VERIFIED" : null,
    !listing.offerVerified ? "OFFER_NOT_VERIFIED" : null,
    !listing.itemIdVerified ? "ITEM_ID_NOT_VERIFIED" : null,
    !listing.stockPositive ? "STOCK_NOT_POSITIVE" : null,
    !listing.categoryValid ? "CATEGORY_INVALID" : null,
    !listing.policiesResolved ? "SELLER_POLICIES_UNRESOLVED" : null,
    ...listing.indexationIssueCodes,
  ].filter((value): value is string => Boolean(value))
}

function priceScenarioSafe(
  economics: CanonicalRecoveryEconomics,
  policy: RecoveryPolicy,
) {
  const scenario = economics.priceTestScenario
  return Boolean(
    economics.costsComplete &&
    economics.stockFresh &&
    scenario &&
    economics.currentPrice !== null &&
    economics.safeFloor !== null &&
    scenario.proposedPrice >= economics.safeFloor &&
    scenario.proposedPrice < economics.currentPrice &&
    ((economics.currentPrice - scenario.proposedPrice) / economics.currentPrice) *
      100 <= policy.maximumPublicPriceStepPercent &&
    scenario.projectedContribution >= policy.minimumNetContribution &&
    scenario.projectedMarginPercent >= policy.minimumMarginPercent &&
    scenario.projectedRoiPercent >= policy.minimumRoiPercent,
  )
}

function actionKey(input: ListingRecoveryInput, action: RecoveryActionName,
  variable: string, proposedValue: unknown, policy: RecoveryPolicy) {
  return `recovery-v1:${stableHash([
    input.marketplaceAccountKey, input.marketplace, input.listingId, input.sku,
    action, variable, proposedValue, input.evidence.sourceRefs,
    input.economics.calculationHash, policy.version,
  ])}`
}

function experiment(input: ListingRecoveryInput, policy: RecoveryPolicy, details: {
  action: RecoveryActionName
  variable: string
  hypothesis: string
  primaryKpi: string
  previousValue: unknown
  proposedValue: unknown
  minimumSample: number
  guardrails: string[]
  mechanism: RecoveryExperimentProposal["executionMechanism"]
}): RecoveryExperimentProposal {
  return {
    contractVersion: "EBAY_RECOVERY_SINGLE_VARIABLE_EXPERIMENT_V1",
    experimentIdempotencyKey: actionKey(
      input, details.action, details.variable, details.proposedValue, policy,
    ),
    variable: details.variable,
    mutationFields: [details.variable],
    hypothesis: details.hypothesis,
    primaryKpi: details.primaryKpi,
    baseline: {
      impressions: input.metrics.organic?.impressions ?? null,
      views: input.metrics.organic?.views ?? null,
      ctrPercent: input.metrics.organic?.ctrPercent ?? null,
      conversionPercent:
        input.metrics.organic?.salesConversionRatePercent ?? null,
      confirmedUnitsSold: input.evidence.confirmedUnitsSold,
    },
    previousValue: details.previousValue,
    proposedValue: details.proposedValue,
    observationWindowDays: 7,
    minimumSample: details.minimumSample,
    guardrails: details.guardrails,
    rollback: {
      supported: true,
      value: details.previousValue,
      automatic: false,
    },
    executionMechanism: details.mechanism,
    automaticExecutionAllowed: false,
    ebayWriteAllowed: false,
    requiresHumanApproval: true,
  }
}

function decision(input: ListingRecoveryInput, policy: RecoveryPolicy,
  values: Omit<RecoveryDecision,
    "engineVersion" | "policyVersion" | "listingId" | "sku" | "funnel" |
    "baseline" | "competitiveGap" | "safety" | "evidenceRefs">,
): RecoveryDecision {
  const organic = input.metrics.organic
  return {
    engineVersion: EBAY_LISTING_RECOVERY_ENGINE_VERSION,
    policyVersion: policy.version,
    listingId: input.listingId,
    sku: input.sku,
    ...values,
    funnel: {
      impressions: organic?.impressions ?? null,
      views: organic?.views ?? null,
      interest: input.interestedBuyerEligibility.status,
      trafficTransactions: organic?.transactions ?? null,
      confirmedUnitsSold: input.evidence.confirmedUnitsSold,
      profitableConfirmedUnits: input.evidence.profitableConfirmedUnits,
    },
    baseline: baseline(input, policy),
    competitiveGap: buildCompetitiveGapReport(input),
    safety: {
      metricsFresh: metricsFresh(input, policy),
      metricsReconciled: metricsReconciled(input),
      organicPaidSeparated: true,
      activeOnlyUsedAsSale: false,
      priceFloorProtected: input.economics.priceTestScenario
        ? priceScenarioSafe(input.economics, policy)
        : true,
      cpcAutomaticAllowed: false,
      ebayWrites: 0,
      stateMutations: 0,
      externalEffects: 0,
    },
    evidenceRefs: [...input.evidence.sourceRefs],
  }
}

function cooldownOpen(input: ListingRecoveryInput, policy: RecoveryPolicy) {
  if (!input.history.lastExperimentAt) return false
  const hours = elapsedHours(input.history.lastExperimentAt, input.observedAt)
  return hours === null || hours < policy.cooldownHours
}

function levelsCompleted(input: ListingRecoveryInput, required: number[]) {
  return required.every((level) => input.history.completedActionLevels.includes(level))
}

export function diagnoseListingRecovery(
  input: ListingRecoveryInput,
): RecoveryDecision {
  const policy = input.policy ?? DEFAULT_RECOVERY_POLICY
  const organic = input.metrics.organic
  const cohort = baseline(input, policy)
  const listingAge = elapsedHours(input.listing.publishedAt, input.observedAt)
  const technical = technicalProblems(input)

  if (
    !organic ||
    organic.completeness !== "COMPLETE" ||
    !metricsFresh(input, policy) ||
    !input.evidence.complete ||
    input.evidence.confidence < policy.minimumEvidenceConfidence
  ) return decision(input, policy, {
    state: "WAITING_FOR_SUFFICIENT_SAMPLE",
    diagnosis: "INSUFFICIENT_EVIDENCE",
    actionLevel: 2,
    action: "EVIDENCE_REVALIDATION",
    reason: "Las métricas o la evidencia están incompletas, vencidas o por debajo de la confianza mínima.",
    whyNotNextLevel: "No se prepara ningún cambio hasta renovar evidencia oficial.",
    experiment: null,
  })

  if (
    organic.reconciliation !== "RECONCILED" ||
    (input.metrics.paid &&
      input.metrics.paid.reconciliation !== "RECONCILED")
  ) return decision(input, policy, {
    state: "WAITING_FOR_SUFFICIENT_SAMPLE",
    diagnosis: "INSUFFICIENT_EVIDENCE",
    actionLevel: null,
    action: null,
    reason: "La ventana todavía puede cambiar durante la reconciliación del proveedor.",
    whyNotNextLevel: "Un dato no reconciliado nunca dispara una acción.",
    experiment: null,
  })

  if (listingAge === null || listingAge < policy.minimumObservationHours) {
    return decision(input, policy, {
      state: "WAITING_FOR_SUFFICIENT_SAMPLE",
      diagnosis: "INSUFFICIENT_EVIDENCE",
      actionLevel: null,
      action: null,
      reason: "El listing no completó la ventana mínima de observación verificable.",
      whyNotNextLevel: "El tiempo transcurrido sin muestra suficiente no justifica cambios.",
      experiment: null,
    })
  }

  if (technical.length) return decision(input, policy, {
    state: "ACTION_PROPOSED",
    diagnosis: "LISTING_TECHNICAL_PROBLEM",
    actionLevel: 1,
    action: "TECHNICAL_VERIFICATION",
    reason: `La verificación técnica detectó: ${technical.join(", ")}.`,
    whyNotNextLevel: "Precio, contenido y promoción permanecen bloqueados hasta resolver el problema técnico.",
    experiment: null,
  })

  if (input.history.activeExperiment || cooldownOpen(input, policy)) {
    return decision(input, policy, {
      state: "COOLDOWN",
      diagnosis: "INSUFFICIENT_EVIDENCE",
      actionLevel: null,
      action: null,
      reason: "Existe un experimento activo o un cooldown vigente.",
      whyNotNextLevel: "No se mezclan variables ni se modifican listings continuamente.",
      experiment: null,
    })
  }

  if (input.history.experimentCount >= policy.maximumExperimentsPerListing) {
    return decision(input, policy, {
      state: "PAUSE_OR_RETIRE_RECOMMENDED",
      diagnosis: "MARKET_DEMAND_WEAK",
      actionLevel: 11,
      action: "PAUSE_RETIRE_OR_REPLACE",
      reason: "El listing agotó el presupuesto de experimentos sin recuperación demostrada.",
      whyNotNextLevel: "No se permiten ciclos infinitos ni venta con pérdida.",
      experiment: null,
    })
  }

  if (
    input.evidence.profitableConfirmedUnits > 0 &&
    input.economics.costsComplete &&
    (input.economics.currentContribution ?? -Infinity) >=
      policy.minimumNetContribution &&
    (input.economics.currentMarginPercent ?? -Infinity) >=
      policy.minimumMarginPercent &&
    (input.economics.currentRoiPercent ?? -Infinity) >=
      policy.minimumRoiPercent
  ) return decision(input, policy, {
    state: "PERFORMANCE_RECOVERED",
    diagnosis: "CLICKS_NO_CONVERSION",
    actionLevel: null,
    action: null,
    reason: "Existen ventas propias confirmadas y rentables dentro de todas las guardas.",
    whyNotNextLevel: "El listing vuelve a monitoreo; impresiones aisladas nunca declaran éxito.",
    experiment: null,
  })

  const paid = input.metrics.paid
  if (
    paid &&
    paid.campaignStatus === "ACTIVE" &&
    (paid.adFees ?? 0) > 0 &&
    (paid.attributedSales ?? 0) === 0
  ) return decision(input, policy, {
    state: "ACTION_PROPOSED",
    diagnosis: "PROMOTED_NO_RESULT",
    actionLevel: 8,
    action: "CPS_PROMOTION",
    reason: paid.fundingModel === "COST_PER_CLICK"
      ? "La campaña CPC consume presupuesto sin ventas atribuidas."
      : "La promoción CPS registra costo o actividad sin ventas atribuidas rentables.",
    whyNotNextLevel: paid.fundingModel === "COST_PER_CLICK"
      ? "CPC nunca se aumenta ni activa automáticamente; se propone pausar con autorización humana."
      : "No se incrementa promoción para compensar un listing que no convierte.",
    experiment: experiment(input, policy, {
      action: "CPS_PROMOTION",
      variable: "promotion_status",
      hypothesis: "Pausar gasto ineficiente protege contribución mientras se corrige conversión.",
      primaryKpi: "net_contribution",
      previousValue: paid.campaignStatus,
      proposedValue: "PAUSE_RECOMMENDED",
      minimumSample: cohort.minimumViews,
      guardrails: [
        "No crear CPC", "No aumentar presupuesto", "Conservar ventas rentables",
      ],
      mechanism: "EXISTING_COMMERCIAL_IMPROVEMENT_LEDGER",
    }),
  })

  const impressions = nonnegative(organic.impressions) ?? 0
  const views = nonnegative(organic.views) ?? 0
  const ctr = nonnegative(organic.ctrPercent)
  const transactions = nonnegative(organic.transactions) ?? 0

  if (impressions < cohort.minimumImpressions) {
    const promotion = evaluateSafePromotionRate({
      eligibility: input.promotionEligibility,
    })
    if (
      levelsCompleted(input, [1, 3, 4, 5]) &&
      promotion.allowed
    ) return decision(input, policy, {
      state: "ACTION_PROPOSED",
      diagnosis: "NO_IMPRESSIONS",
      actionLevel: 8,
      action: "CPS_PROMOTION",
      reason: "La verificación técnica y optimización orgánica ya se completaron; existe headroom económico para una prueba CPS.",
      whyNotNextLevel: "Se limita a CPS y aprobación humana; CPC y precio permanecen bloqueados.",
      experiment: experiment(input, policy, {
        action: "CPS_PROMOTION",
        variable: "cps_ad_rate_percent",
        hypothesis: "Una prueba CPS limitada puede ampliar alcance sin romper el margen.",
        primaryKpi: "profitable_confirmed_sales",
        previousValue: 0,
        proposedValue: promotion.ratePercent,
        minimumSample: cohort.minimumImpressions,
        guardrails: [
          `Tasa máxima ${promotion.ratePercent}%`,
          "Detener si baja la contribución",
          "No usar CPC",
        ],
        mechanism: "EXISTING_COMMERCIAL_IMPROVEMENT_LEDGER",
      }),
    })
    const aspectsFirst = !input.listing.requiredAspectsComplete
    return decision(input, policy, {
      state: "ACTION_PROPOSED",
      diagnosis: "NO_IMPRESSIONS",
      actionLevel: aspectsFirst ? 3 : 4,
      action: aspectsFirst ? "CATEGORY_AND_ASPECTS" : "DISCOVERY_AND_KEYWORDS",
      reason: `${impressions} impresiones no alcanzan la muestra mínima de ${cohort.minimumImpressions}; el problema es descubrimiento o elegibilidad.`,
      whyNotNextLevel: "No se reduce precio cuando el listing todavía no obtiene exposición suficiente.",
      experiment: aspectsFirst
        ? experiment(input, policy, {
            action: "CATEGORY_AND_ASPECTS",
            variable: "item_specifics",
            hypothesis: "Completar un aspecto oficial faltante puede mejorar elegibilidad e indexación.",
            primaryKpi: "organic_impressions",
            previousValue: "INCOMPLETE",
            proposedValue: "PREPARED_FOR_HUMAN_REVIEW",
            minimumSample: cohort.minimumImpressions,
            guardrails: ["Solo hechos del expediente", "Categoría material requiere humano"],
            mechanism: "MANUAL_ONLY",
          })
        : experiment(input, policy, {
            action: "DISCOVERY_AND_KEYWORDS",
            variable: "verified_keyword_set",
            hypothesis: "Una cobertura semántica respaldada puede mejorar impresiones orgánicas.",
            primaryKpi: "organic_impressions",
            previousValue: "CURRENT",
            proposedValue: "EVIDENCE_BACKED_PROPOSAL",
            minimumSample: cohort.minimumImpressions,
            guardrails: ["No copiar títulos", "No inventar atributos", "No cambiar precio"],
            mechanism: "EXISTING_TITLE_REVISION_LEDGER",
          }),
    })
  }

  if (
    views < cohort.minimumViews ||
    (ctr !== null && ctr < cohort.minimumCtrPercent)
  ) return decision(input, policy, {
    state: "ACTION_PROPOSED",
    diagnosis: "IMPRESSIONS_NO_CLICKS",
    actionLevel: 5,
    action: "MAIN_IMAGE_OR_TITLE",
    reason: "El listing aparece con muestra suficiente, pero la atracción está por debajo de su baseline aplicable.",
    whyNotNextLevel: "Primero se prueba una sola variable visible; no se reduce precio ni se mezclan imagen y título.",
    experiment: experiment(input, policy, {
      action: "MAIN_IMAGE_OR_TITLE",
      variable: "main_image",
      hypothesis: "Una imagen principal fiel y más clara puede elevar el CTR.",
      primaryKpi: "organic_ctr_percent",
      previousValue: input.history.previousMainImageHash,
      proposedValue: "PREPARED_EXACT_IDENTITY_IMAGE",
      minimumSample: cohort.minimumImpressions,
      guardrails: [
        "Identidad exacta", "Sin accesorios inventados", "No cambiar título ni precio",
      ],
      mechanism: "EXISTING_IMAGE_REVISION_LEDGER",
    }),
  })

  if (views >= cohort.minimumViews && transactions === 0 &&
    input.evidence.confirmedUnitsSold === 0) {
    if (
      input.interestedBuyerEligibility.status === "ELIGIBLE" &&
      priceScenarioSafe(input.economics, policy)
    ) return decision(input, policy, {
      state: "ACTION_PROPOSED",
      diagnosis: "INTEREST_WITHOUT_SALE",
      actionLevel: 9,
      action: "INTERESTED_BUYER_OFFER",
      reason: "eBay declaró el listing elegible para compradores interesados y existe un escenario económico seguro.",
      whyNotNextLevel: input.interestedBuyerEligibility.negotiationImplemented
        ? "La oferta se prepara antes de una reducción pública y requiere autorización."
        : "Negotiation API no está implementada; la oferta permanece simulada y no puede enviarse.",
      experiment: experiment(input, policy, {
        action: "INTERESTED_BUYER_OFFER",
        variable: "interested_buyer_offer_price",
        hypothesis: "Una oferta limitada puede convertir interés sin reducir públicamente el precio.",
        primaryKpi: "profitable_confirmed_sales",
        previousValue: input.economics.currentPrice,
        proposedValue: input.economics.priceTestScenario?.proposedPrice ?? null,
        minimumSample: 1,
        guardrails: [
          "Precio por encima del piso",
          "No repetir al mismo grupo",
          "Duración definida",
          "No exponer buyer PII",
        ],
        mechanism: "NEGOTIATION_NOT_IMPLEMENTED",
      }),
    })

    if (
      levelsCompleted(input, [1, 5, 6, 8]) &&
      ["E4", "E5"].includes(input.evidence.level) &&
      input.evidence.salesClassification !== "ACTIVE_ONLY"
    ) {
      if (!priceScenarioSafe(input.economics, policy)) {
        return decision(input, policy, {
          state: "PAUSE_OR_RETIRE_RECOMMENDED",
          diagnosis: "PRICE_NOT_COMPETITIVE",
          actionLevel: 11,
          action: "PAUSE_RETIRE_OR_REPLACE",
          reason: "No existe un escenario de precio competitivo que conserve piso, contribución, margen y ROI.",
          whyNotNextLevel: "IMNOVA no vende con pérdida ni persigue listings ACTIVE_ONLY.",
          experiment: null,
        })
      }
      return decision(input, policy, {
        state: "PRICE_TEST_ELIGIBLE",
        diagnosis: "PRICE_NOT_COMPETITIVE",
        actionLevel: 10,
        action: "LIMITED_PRICE_TEST",
        reason: "Las optimizaciones anteriores terminaron, existe evidencia E4+ y el escenario canónico protege todas las guardas.",
        whyNotNextLevel: "Solo se permite un escalón pequeño, humano, reversible y reconciliable.",
        experiment: experiment(input, policy, {
          action: "LIMITED_PRICE_TEST",
          variable: "listing_price",
          hypothesis: "Un escalón pequeño puede mejorar conversión conservando rentabilidad.",
          primaryKpi: "profitable_confirmed_sales",
          previousValue: input.economics.currentPrice,
          proposedValue: input.economics.priceTestScenario?.proposedPrice ?? null,
          minimumSample: cohort.minimumViews,
          guardrails: [
            `Piso ${input.economics.safeFloor}`,
            `Contribución >= ${policy.minimumNetContribution}`,
            `Margen >= ${policy.minimumMarginPercent}%`,
            `ROI >= ${policy.minimumRoiPercent}%`,
          ],
          mechanism: "EXISTING_COMMERCIAL_IMPROVEMENT_LEDGER",
        }),
      })
    }

    return decision(input, policy, {
      state: "ACTION_PROPOSED",
      diagnosis: "CLICKS_NO_CONVERSION",
      actionLevel: 6,
      action: "SECONDARY_IMAGES_AND_CONVERSION",
      reason: "Existe interés inicial, pero ninguna venta confirmada; deben resolverse objeciones de conversión.",
      whyNotNextLevel: input.evidence.salesClassification === "ACTIVE_ONLY"
        ? "ACTIVE_ONLY no autoriza precio, oferta ni promoción."
        : "Precio y promoción esperan evidencia E4 y experimentos de mejor relación riesgo/beneficio.",
      experiment: experiment(input, policy, {
        action: "SECONDARY_IMAGES_AND_CONVERSION",
        variable: "secondary_image_package",
        hypothesis: "Aclarar pack, dimensiones y compatibilidad puede mejorar conversión.",
        primaryKpi: "sales_conversion_rate_percent",
        previousValue: "CURRENT",
        proposedValue: "PREPARED_OBJECTION_RESOLUTION_SET",
        minimumSample: cohort.minimumViews,
        guardrails: [
          "Una variable principal", "Identidad exacta", "No cambiar precio ni promoción",
        ],
        mechanism: "EXISTING_IMAGE_REVISION_LEDGER",
      }),
    })
  }

  return decision(input, policy, {
    state: "CONTINUE_MONITORING",
    diagnosis: "MARKET_DEMAND_WEAK",
    actionLevel: null,
    action: null,
    reason: "La muestra no demuestra una intervención ventajosa adicional.",
    whyNotNextLevel: "Se conservan margen, estabilidad y evidencia hasta una nueva ventana.",
    experiment: null,
  })
}

export function recoveryExperimentCooldownElapsed(input: {
  previousExperimentAt: string | null
  observedAt: string
  cooldownHours?: number
}) {
  if (!input.previousExperimentAt) return true
  const elapsed = elapsedHours(input.previousExperimentAt, input.observedAt)
  return elapsed !== null &&
    elapsed >= (input.cooldownHours ?? DEFAULT_RECOVERY_POLICY.cooldownHours)
}

export function reconcileRecoveryActionOutcome(input: {
  phase: "PREPARED" | "SENT" | "UNKNOWN_OUTCOME" | "CONFIRMED" | "FAILED"
  expectedPayloadHash: string
  observedPayloadHash: string | null
  safeFailureProven: boolean
}) {
  if (input.phase === "CONFIRMED") return {
    state: "CONFIRMED" as const,
    retryAllowed: false,
    reconciled: true,
  }
  if (
    input.observedPayloadHash &&
    input.observedPayloadHash === input.expectedPayloadHash
  ) return {
    state: "RECONCILED" as const,
    retryAllowed: false,
    reconciled: true,
  }
  if (input.phase === "FAILED" && input.safeFailureProven) return {
    state: "FAILED" as const,
    retryAllowed: true,
    reconciled: false,
  }
  return {
    state: "UNKNOWN_OUTCOME" as const,
    retryAllowed: false,
    reconciled: false,
  }
}

export function evaluateRecoveryExperiment(input: {
  experiment: RecoveryExperimentProposal
  before: { kpi: number | null; sample: number }
  after: { kpi: number | null; sample: number }
  minimumContributionProtected: boolean
  marginProtected: boolean
  roiProtected: boolean
}) {
  if (
    input.after.sample < input.experiment.minimumSample ||
    input.before.kpi === null ||
    input.after.kpi === null
  ) return {
    state: "WAITING_FOR_SUFFICIENT_SAMPLE" as const,
    result: "INCONCLUSIVE" as const,
    rollback: false,
  }
  if (
    !input.minimumContributionProtected ||
    !input.marginProtected ||
    !input.roiProtected ||
    input.after.kpi < input.before.kpi * 0.9
  ) return {
    state: "ROLLBACK_REQUIRED" as const,
    result: "LOST" as const,
    rollback: true,
    rollbackValue: input.experiment.rollback.value,
  }
  if (input.after.kpi > input.before.kpi * 1.05) return {
    state: "PERFORMANCE_RECOVERED" as const,
    result: "WON" as const,
    rollback: false,
  }
  return {
    state: "NEXT_OPTIMIZATION_LEVEL" as const,
    result: "NEUTRAL" as const,
    rollback: false,
  }
}

export function buildRecoveryLearningEvent(input: {
  listingId: string
  experimentId: string
  result: "WON" | "NEUTRAL" | "LOST" | "INCONCLUSIVE"
  confirmedUnitsSold: number
  netContribution: number | null
  evidenceRefs: string[]
}) {
  const commerciallyReusable = input.result === "WON" &&
    input.confirmedUnitsSold > 0 &&
    (input.netContribution ?? -Infinity) >=
      DEFAULT_RECOVERY_POLICY.minimumNetContribution
  return {
    version: "EBAY_RECOVERY_LEARNING_V1",
    ...input,
    commerciallyReusable,
    feeds: commerciallyReusable
      ? [
          "PRODUCT_OPPORTUNITY_SCORE", "TOP_5_RANKING", "LISTING_READINESS",
          "KEYWORDS", "VISUAL_STRATEGY", "PRICING", "PROMOTION",
        ]
      : ["AUDIT_ONLY"],
    impressionsAloneCountAsSuccess: false,
  }
}

export async function runFiveListingRecoveryDryRun(
  inputs: ListingRecoveryInput[],
  diagnose: (input: ListingRecoveryInput) =>
    RecoveryDecision | Promise<RecoveryDecision> = diagnoseListingRecovery,
) {
  if (inputs.length !== 5) throw new Error("RECOVERY_DRY_RUN_REQUIRES_FIVE_LISTINGS")
  const items = await Promise.all(inputs.map(async (input, index) => {
    try {
      return {
        position: index + 1,
        listingId: input.listingId,
        status: "DIAGNOSED" as const,
        decision: await diagnose(input),
        errorCode: null,
      }
    } catch {
      return {
        position: index + 1,
        listingId: input.listingId,
        status: "QUARANTINED_OPTIMIZATION_ERROR" as const,
        decision: null,
        errorCode: "RECOVERY_DIAGNOSIS_UNKNOWN_ERROR",
      }
    }
  }))
  return {
    engineVersion: EBAY_LISTING_RECOVERY_ENGINE_VERSION,
    listingCount: items.length,
    diagnosed: items.filter((item) => item.status === "DIAGNOSED").length,
    quarantined: items.filter((item) =>
      item.status === "QUARANTINED_OPTIMIZATION_ERROR").length,
    items,
    safety: {
      realEbayReads: 0,
      realEbayWrites: 0,
      openAiCalls: 0,
      whatsappMessages: 0,
      stateMutations: 0,
    },
  }
}
