import { createHash } from "node:crypto"

// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { validateGtinChecksum } from "./ebay-winner-evidence-v2.ts"
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { productResearchDisplayQuery, productResearchMarketplaceFamilyQuery } from "./ebay-product-research-query-plan.ts"

export const SAME_DAY_PILOT_VERSION = "PILOT_3_LISTINGS_SAME_DAY_V1"
export const SAME_DAY_QUEUE_LIMIT = 5
export const SAME_DAY_MAX_CANDIDATE_CYCLES = 20
export const SAME_DAY_RECONCILIATION_DECISION_REFERENCE_LIMIT = 10
export const SAME_DAY_RECONCILIATION_COVERAGE_ROW_LIMIT = 200
export const SAME_DAY_TRADING_DETAIL_READ_LIMIT_PER_BATCH = 2

export type SameDayCommercialEvidenceMode =
  | "MARKET_VALIDATED"
  | "CONTROLLED_EXPLORATORY_TEST"

export type SameDayCandidateState =
  | "READY_TO_VALIDATE_TODAY"
  | "NEEDS_PRODUCT_RESEARCH_CAPTURE"
  | "NEEDS_LUNA_CONFIRMATION"
  | "NEEDS_ONE_CRITICAL_FACT"
  | "READY_FOR_CONTENT"
  | "READY_FOR_IMAGE_REVIEW"
  | "READY_FOR_MANUAL_PUBLICATION"
  | "PUBLISHED_PENDING_VERIFICATION"
  | "VERIFIED_ACTIVE"
  | "REJECTED_TODAY"

export type SameDayCandidateInput = {
  id: string
  candidateKey: string
  productTitle: string
  variantTitle?: string | null
  supplierSku?: string | null
  supplierVariantId?: string | null
  supplierProductUrl?: string | null
  supplierImageUrl?: string | null
  gtin?: string | null
  brand?: string | null
  mpn?: string | null
  model?: string | null
  nativePackCount?: number | null
  unitCount?: number | null
  size?: string | null
  color?: string | null
  scent?: string | null
  formulation?: string | null
  identityEvidenceSource?: string | null
  identityEvidenceHash?: string | null
  identityIndependentlyVerified?: boolean
  offerPackVerified?: boolean
  supplierPrice?: number | null
  supplierAvailable?: boolean | null
  supplierQuantity?: number | null
  supplierObservedAt?: string | null
  exactIdentityConfirmed?: boolean
  identityConfidence?: number
  activeExactCount?: number
  soldExactCount?: number
  compatibleSellerCount?: number
  evidenceFresh?: boolean
  economicsReady?: boolean
  estimatedProfit?: number | null
  roiPercent?: number | null
  netMarginPercent?: number | null
  hardGates?: string[]
  evidenceGuards?: string[]
  regulatedWithoutPath?: boolean
  queueStatus?: string
  score?: number
  listingPackageReadiness?: number
  queueItemAvailable?: boolean
  radarFamilyEvidence?: Record<string, unknown> | null
}

export function resolveSameDayCommercialEvidenceMode(input: {
  historicalMarketCheckCompleted: boolean
  confirmedSoldExact: number
  identityVerifiedIndependently: boolean
  exactOfferPackVerified: boolean
  relatedPackConflict?: boolean
  relatedSizeConflict?: boolean
}) {
  const blockers = [
    !input.historicalMarketCheckCompleted ? "HISTORICAL_MARKET_CHECK_NOT_COMPLETED" : "",
    !input.identityVerifiedIndependently ? "EXACT_IDENTITY_NOT_INDEPENDENTLY_VERIFIED" : "",
    !input.exactOfferPackVerified ? "EXACT_OFFER_PACK_NOT_VERIFIED" : "",
    input.relatedPackConflict ? "RELATED_PACK_CONFLICT" : "",
    input.relatedSizeConflict ? "RELATED_SIZE_CONFLICT" : "",
  ].filter(Boolean)
  const exactSold = Math.max(0, Number(input.confirmedSoldExact) || 0)
  const mode: SameDayCommercialEvidenceMode | null = blockers.length
    ? null
    : exactSold > 0
      ? "MARKET_VALIDATED"
      : "CONTROLLED_EXPLORATORY_TEST"
  return {
    eligible: mode !== null,
    mode,
    blockers,
    historicalMarketCheckCompleted: input.historicalMarketCheckCompleted,
    confirmedSoldExact: exactSold,
    forcedListingQuantity: mode === "CONTROLLED_EXPLORATORY_TEST" ? 1 : null,
    commercialMonitorRequired: mode === "CONTROLLED_EXPLORATORY_TEST",
    automaticPricingAllowed: false,
  }
}

export type SameDayCandidateDecision = SameDayCandidateInput & {
  eligibleForQueue: boolean
  lunaIdentityConfirmationRequired: boolean
  state: SameDayCandidateState
  blockers: string[]
  familyFingerprint: string
  queryPlan: { strategy: string; query: string; reason: string }
  callsEstimated: number
  priority: number
  nextAutomatedAction: string
  nextHumanAction: string
}

const TERMINAL_SAME_DAY_MACHINE_STATES = new Set([
  "REJECTED",
  "BLOCKED",
  "VERIFIED_ACTIVE",
  "COMPLETED",
])

export function isSameDayCandidateBatchSettled(machineStates: string[]) {
  return machineStates.length > 0 && machineStates.every((state) =>
    TERMINAL_SAME_DAY_MACHINE_STATES.has(state))
}

export function canStartNextSameDayCandidateCycle(input: {
  runStatus: string
  cycle: number
  candidateMachineStates: string[]
  openHumanTasks: number
  dueOrLeasedJobs: number
  verifiedNewListings: number
  targetNewListings: number
  activeWorkerLease?: boolean
  productResearchPlanSettled?: boolean
  nextCandidateSetExhausted?: boolean
}) {
  const cycle = Number.isInteger(input.cycle) ? input.cycle : 1
  const candidatesTerminal = isSameDayCandidateBatchSettled(
    input.candidateMachineStates,
  )
  const allowed = input.runStatus === "BLOCKED"
    && cycle < SAME_DAY_MAX_CANDIDATE_CYCLES
    && candidatesTerminal
    && input.openHumanTasks === 0
    && input.dueOrLeasedJobs === 0
    && input.activeWorkerLease !== true
    && input.productResearchPlanSettled !== false
    && input.nextCandidateSetExhausted !== true
    && input.verifiedNewListings < input.targetNewListings
  return {
    allowed,
    nextCycle: allowed ? cycle + 1 : cycle,
    candidatesTerminal,
    reason: allowed
      ? "NEXT_BOUNDED_CANDIDATE_SET_ALLOWED"
      : input.verifiedNewListings >= input.targetNewListings
        ? "CURRENT_CYCLE_TARGET_REACHED"
        : input.nextCandidateSetExhausted === true
          ? "NEXT_CANDIDATE_SET_EXHAUSTED"
        : cycle >= SAME_DAY_MAX_CANDIDATE_CYCLES
          ? "MAX_CANDIDATE_CYCLES_REACHED"
          : input.runStatus !== "BLOCKED"
            ? "CURRENT_CYCLE_ACTIVE"
            : input.openHumanTasks > 0
              ? "HUMAN_TASK_PENDING"
              : input.dueOrLeasedJobs > 0
                ? "BACKGROUND_JOB_PENDING"
                : input.activeWorkerLease === true
                  ? "BACKGROUND_WORKER_ACTIVE"
                  : input.productResearchPlanSettled === false
                    ? "PRODUCT_RESEARCH_PLAN_PENDING"
                : "CURRENT_CYCLE_NOT_SETTLED",
  }
}

export function projectSameDayProductResearchReconciliationBudget(batchRowCounts: number[]) {
  const rows = batchRowCounts.map((value) => Number.isInteger(value) && value > 0 ? value : 0)
  const batchCount = rows.filter((value) => value > 0).length
  const observationsCovered = rows.reduce((sum, value) =>
    sum + Math.min(value, SAME_DAY_RECONCILIATION_COVERAGE_ROW_LIMIT), 0)
  const totalObservations = rows.reduce((sum, value) => sum + value, 0)
  const decisionReferences = rows.reduce((sum, value) =>
    sum + Math.min(value, SAME_DAY_RECONCILIATION_DECISION_REFERENCE_LIMIT), 0)
  const maximumOfficialReaderInvocations = {
    trading: batchCount * SAME_DAY_TRADING_DETAIL_READ_LIMIT_PER_BATCH,
    browse: batchCount,
    catalog: batchCount,
    taxonomy: batchCount,
  }
  return {
    batchCount,
    totalObservations,
    observationsCovered,
    allRowsCovered: observationsCovered === totalObservations,
    decisionReferences,
    maximumOfficialReaderInvocations: { ...maximumOfficialReaderInvocations,
      total: Object.values(maximumOfficialReaderInvocations)
        .reduce((sum, value) => sum + value, 0),
      unit: "READER_INVOCATIONS_NOT_HTTP_REQUESTS" as const },
  }
}

const TODAY_RESOLVABLE_HARD_GATES = new Set([
  "NEED_AUTHORIZED_PRODUCT_IMAGES",
  "NEED_PACKAGE_WEIGHT",
  "NEED_PACKAGE_DIMENSIONS",
  "NEED_PACKAGE_WEIGHT_AND_DIMENSIONS",
  "NEED_EBAY_TAXONOMY_CATEGORY",
  "NEED_REQUIRED_EBAY_ITEM_ASPECTS",
  "NEED_CONFIRMED_LUNA_STOCK_QUANTITY",
  "NEED_EXACT_GTIN_OR_BRAND_MPN_MATCH",
  "NEED_EBAY_EXACT_IDENTITY_CONFIRMATION",
  "NEED_EXACT_PACK_INVENTORY_CONFIRMATION",
  "NEED_UNIT_ECONOMICS_VALIDATION",
])

function normalized(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
    : ""
}

function productIdentityText(value: unknown) {
  return normalized(value).replace(/\bdefault title\b/gi, " ")
    .trim().replace(/\s+/g, " ")
}

function fingerprint(value: string) {
  return createHash("sha256").update(value.toLowerCase()).digest("hex")
}

export function buildSameDayProductResearchQuery(input: SameDayCandidateInput) {
  const gtin = normalized(input.gtin).replace(/\s/g, "")
  if (validateGtinChecksum(gtin)) return {
    strategy: "GTIN", query: gtin,
    reason: "El identificador global reduce coincidencias de otro tamaño, pack o variante.",
  }
  const brand = normalized(input.brand)
  const mpn = normalized(input.mpn || input.model)
  if (brand && mpn) return {
    strategy: "BRAND_MPN", query: `${brand} ${mpn}`,
    reason: "Marca + MPN/modelo es la identidad exacta disponible más restrictiva.",
  }
  const variant = normalized(input.variantTitle)
  const meaningfulVariant = /^(?:default(?: title)?|title)$/i.test(variant) ? "" : variant
  const familyAlias = productResearchMarketplaceFamilyQuery(input.productTitle)
  const identity = productIdentityText(
    [input.productTitle, meaningfulVariant].filter(Boolean).join(" "),
  )
  return {
    strategy: "FAMILY_IDENTITY_RECONCILIATION",
    query: familyAlias || productResearchDisplayQuery(identity.slice(0, 100)),
    reason: familyAlias
      ? "El título contiene una familia seguida de fabricante; se usa la forma corta que emplean otros vendedores y después se separan tamaño, pack y variante fila por fila."
      : "No existe GTIN o MPN confiable; se consulta la familia y después se separan tamaño, pack y variante fila por fila.",
  }
}

export function assessSameDayResearchIdentityReadiness(input: SameDayCandidateInput) {
  const rawGtin = normalized(input.gtin).replace(/\s/g, "")
  const gtinPresent = Boolean(rawGtin)
  const gtinValid = validateGtinChecksum(rawGtin)
  const brand = normalized(input.brand)
  const modelIdentifier = normalized(input.mpn || input.model)
  const structuredBrandModel = Boolean(brand && modelIdentifier)
  const nativePackCount = Number.isInteger(input.nativePackCount) && Number(input.nativePackCount) > 0
    ? Number(input.nativePackCount) : null
  const blockers = [
    gtinPresent && !gtinValid ? "GTIN_INVALID_OR_UNVERIFIED" : "",
    !gtinValid && !structuredBrandModel ? "IDENTITY_QUERY_TOO_GENERIC" : "",
    nativePackCount === null ? "OFFER_PACK_IDENTITY_MISSING" : "",
  ].filter(Boolean)
  return {
    ready: blockers.length === 0,
    blockers,
    strategy: gtinValid ? "GTIN" as const
      : structuredBrandModel ? "BRAND_MPN" as const : "IDENTITY_ENRICHMENT_REQUIRED" as const,
    gtinValid,
    structuredBrandModel,
    nativePackCount,
    factsAvailable: {
      brand: Boolean(brand),
      mpnOrModel: Boolean(modelIdentifier),
      size: Boolean(normalized(input.size)),
      variant: Boolean(normalized(input.color || input.scent || input.formulation || input.variantTitle)),
      unitCount: Number.isInteger(input.unitCount) && Number(input.unitCount) > 0,
    },
  }
}

export function evaluateSameDayCandidate(input: SameDayCandidateInput, now = new Date()): SameDayCandidateDecision {
  const queryPlan = buildSameDayProductResearchQuery(input)
  const identityReadiness = assessSameDayResearchIdentityReadiness(input)
  const familyFingerprint = fingerprint([
    normalized(input.brand), normalized(input.mpn || input.model),
    normalized(input.productTitle), normalized(input.variantTitle),
  ].join("|"))
  const exactOrStrongIdentity = input.exactIdentityConfirmed === true || Number(input.identityConfidence ?? 0) >= 85
  const supplierQuantity = input.supplierQuantity ?? null
  const lunaAvailabilityQuantityConflict =
    (input.supplierAvailable === true && supplierQuantity === 0) ||
    (input.supplierAvailable === false && Number(supplierQuantity ?? 0) > 0)
  const stockKnown = !lunaAvailabilityQuantityConflict &&
    input.supplierAvailable === true && Number(supplierQuantity ?? 0) > 0
  const stockUnknown = input.supplierAvailable === true && input.supplierQuantity == null
  const economicsPlausible = input.economicsReady === true || Number(input.estimatedProfit ?? 0) > 0
  const supplierObservedAt = Date.parse(input.supplierObservedAt ?? "")
  const lunaFresh = Number.isFinite(supplierObservedAt) && now.getTime() - supplierObservedAt <= 72 * 60 * 60_000
  const criticalHardGates = (input.hardGates ?? []).filter((gate) => !TODAY_RESOLVABLE_HARD_GATES.has(gate))
  const identityCanBeConfirmedFromExactLunaPage = Boolean(
    input.supplierProductUrl && input.supplierImageUrl &&
    productIdentityText(input.productTitle).split(" ").filter(Boolean).length >= 4 &&
    !identityReadiness.blockers.includes("GTIN_INVALID_OR_UNVERIFIED"),
  )
  const lunaIdentityConfirmationRequired = identityCanBeConfirmedFromExactLunaPage &&
    identityReadiness.blockers.some((blocker) =>
      blocker === "IDENTITY_QUERY_TOO_GENERIC" || blocker === "OFFER_PACK_IDENTITY_MISSING")
  const unresolvedIdentityBlockers = identityReadiness.blockers.filter((blocker) =>
    !lunaIdentityConfirmationRequired ||
    (blocker !== "IDENTITY_QUERY_TOO_GENERIC" && blocker !== "OFFER_PACK_IDENTITY_MISSING"))
  const localBlockers = [
    input.supplierAvailable === false && !lunaAvailabilityQuantityConflict
      ? "LUNA_OUT_OF_STOCK" : "",
    !(Number(input.supplierPrice) > 0) ? "LUNA_COST_MISSING" : "",
    !normalized(input.supplierSku) ? "SUPPLIER_SKU_MISSING" : "",
    !normalized(input.supplierVariantId) ? "SUPPLIER_VARIANT_ID_MISSING" : "",
    !lunaFresh ? "LUNA_RECORD_STALE" : "",
    ...unresolvedIdentityBlockers,
    input.queueItemAvailable === false ? "EXACT_TOP20_QUEUE_IDENTITY_MISSING" : "",
    input.regulatedWithoutPath ? "REGULATORY_PATH_MISSING" : "",
    ["listed", "rejected", "archived"].includes(input.queueStatus ?? "") ? "OPPORTUNITY_NOT_ELIGIBLE" : "",
    ...criticalHardGates.map((gate) => `HARD_GATE:${gate}`),
  ].filter(Boolean)
  // Active listings describe current supply; they do not prove historical
  // sales. Reuse a previous market validation only when exact sold evidence
  // is fresh. Otherwise Product Research remains the first market gate.
  const marketReady = Number(input.soldExactCount ?? 0) > 0 && input.evidenceFresh === true
  let state: SameDayCandidateState = "READY_TO_VALIDATE_TODAY"
  let nextAutomatedAction = "Resolver ficha técnica únicamente para este candidato."
  let nextHumanAction = "Confirmar precio y disponibilidad visibles en Luna."
  const blockers = [...localBlockers]
  if (localBlockers.length) {
    state = "REJECTED_TODAY"
    nextAutomatedAction = "Continuar con el siguiente candidato sin consumir cuota."
    nextHumanAction = "Ninguna; revisar el motivo sólo si desea recuperarlo otro día."
  } else if (lunaIdentityConfirmationRequired || !stockKnown) {
    state = "NEEDS_LUNA_CONFIRMATION"
    if (lunaIdentityConfirmationRequired) blockers.push("LUNA_VISIBLE_IDENTITY_AND_PACK_CONFIRMATION_REQUIRED")
    if (lunaAvailabilityQuantityConflict) {
      blockers.push("LUNA_AVAILABILITY_QUANTITY_CONFLICT")
    } else if (!stockKnown) {
      blockers.push(stockUnknown ? "LUNA_EXACT_QUANTITY_UNKNOWN" : "LUNA_AVAILABILITY_CONFIRMATION_REQUIRED")
    }
    nextAutomatedAction = "Conservar el candidato y continuar automáticamente después de una sola confirmación Luna."
    nextHumanAction = "Confirmar producto, presentación, costo y disponibilidad en la página exacta de Luna."
  } else if (!exactOrStrongIdentity || !marketReady || !economicsPlausible) {
    state = "NEEDS_PRODUCT_RESEARCH_CAPTURE"
    if (!exactOrStrongIdentity) blockers.push("EXACT_OR_STRONG_IDENTITY_REQUIRED")
    if (!marketReady) blockers.push("FRESH_EXACT_MARKET_EVIDENCE_REQUIRED")
    if (!economicsPlausible) blockers.push("PLAUSIBLE_ECONOMICS_REQUIRED")
    nextAutomatedAction = "Esperar una sola captura agrupada de Product Research para esta familia."
    nextHumanAction = `Abrir Product Research con la consulta preparada: ${queryPlan.query}`
  }
  const priority = Math.max(0, Math.min(100,
    Number(input.score ?? 0) * .35 + Number(input.identityConfidence ?? 0) * .25 +
    Math.min(100, Number(input.activeExactCount ?? 0) * 20) * .2 +
    (stockKnown ? 10 : 0) + (economicsPlausible ? 10 : 0),
  ))
  return { ...input, eligibleForQueue: localBlockers.length === 0,
    lunaIdentityConfirmationRequired, state, blockers: [...new Set(blockers)],
    familyFingerprint, queryPlan, callsEstimated: state === "NEEDS_PRODUCT_RESEARCH_CAPTURE" ? 1 : 0,
    priority: Math.round(priority * 100) / 100, nextAutomatedAction, nextHumanAction }
}

export function selectSameDayQueue(
  inputs: SameDayCandidateInput[],
  now = new Date(),
  exclusions: {
    opportunityIds?: Iterable<string>
    candidateKeys?: Iterable<string>
    supplierVariantIds?: Iterable<string>
    familyFingerprints?: Iterable<string>
  } = {},
) {
  const excludedOpportunityIds = new Set(exclusions.opportunityIds ?? [])
  const excludedCandidateKeys = new Set(exclusions.candidateKeys ?? [])
  const excludedSupplierVariantIds = new Set(exclusions.supplierVariantIds ?? [])
  const excludedFamilyFingerprints = new Set(exclusions.familyFingerprints ?? [])
  const evaluated = inputs.map((input) => evaluateSameDayCandidate(input, now))
    .filter((entry) => entry.eligibleForQueue)
    .filter((entry) => !excludedOpportunityIds.has(entry.id)
      && !excludedCandidateKeys.has(entry.candidateKey)
      && !excludedSupplierVariantIds.has(entry.supplierVariantId ?? "")
      && !excludedFamilyFingerprints.has(entry.familyFingerprint))
    .sort((left, right) => right.priority - left.priority
      || left.candidateKey.localeCompare(right.candidateKey)
      || left.id.localeCompare(right.id))
  const families = new Set<string>()
  const selected: SameDayCandidateDecision[] = []
  for (const entry of evaluated) {
    if (selected.length >= SAME_DAY_QUEUE_LIMIT) break
    if (families.has(entry.familyFingerprint)) continue
    families.add(entry.familyFingerprint)
    selected.push(entry)
  }
  return selected
}

export function evaluateReadyForContent(input: {
  exactOrStrongIdentity: boolean
  exactMarketEvidence?: boolean
  commercialEvidenceMode?: SameDayCommercialEvidenceMode | null
  historicalMarketCheckCompleted?: boolean
  productFactsCompatible: boolean
  requiredAspectsResolved: boolean
  regulatoryAcceptable: boolean
  shippingEstimateAvailable: boolean
  estimatedProfit: number | null
  roiPercent: number | null
  netMarginPercent: number | null
}) {
  const commercialEvidenceMode = input.commercialEvidenceMode ??
    (input.exactMarketEvidence === true ? "MARKET_VALIDATED" : null)
  const historicalMarketCheckCompleted = input.historicalMarketCheckCompleted ??
    input.exactMarketEvidence === true
  const blockers = [
    !input.exactOrStrongIdentity ? "IDENTITY_NOT_READY" : "",
    !historicalMarketCheckCompleted ? "HISTORICAL_MARKET_CHECK_NOT_COMPLETED" : "",
    !commercialEvidenceMode ? "COMMERCIAL_EVIDENCE_MODE_NOT_READY" : "",
    !input.productFactsCompatible ? "PRODUCT_FACTS_NOT_READY" : "",
    !input.requiredAspectsResolved ? "REQUIRED_ASPECTS_NOT_READY" : "",
    !input.regulatoryAcceptable ? "REGULATORY_NOT_READY" : "",
    !input.shippingEstimateAvailable ? "SHIPPING_ESTIMATE_NOT_READY" : "",
    Number(input.estimatedProfit ?? 0) < 5 ? "PROFIT_BELOW_5_USD" : "",
    Number(input.roiPercent ?? 0) < 30 ? "ROI_BELOW_30_PERCENT" : "",
    Number(input.netMarginPercent ?? 0) < 20 ? "NET_MARGIN_BELOW_20_PERCENT" : "",
  ].filter(Boolean)
  return {
    ready: blockers.length === 0,
    blockers,
    commercialEvidenceMode,
    idealProfitReached: Number(input.estimatedProfit ?? 0) >= 7,
    forcedListingQuantity: commercialEvidenceMode === "CONTROLLED_EXPLORATORY_TEST" ? 1 : null,
    commercialMonitorRequired: commercialEvidenceMode === "CONTROLLED_EXPLORATORY_TEST",
    automaticPricingAllowed: false,
  }
}

export function listingQuantityFromLuna(quantity: number | null, available: boolean) {
  if (quantity !== null && (!Number.isInteger(quantity) || quantity < 0)) {
    throw new Error("LUNA_QUANTITY_INVALID")
  }
  if ((available && quantity === 0) || (!available && Number(quantity ?? 0) > 0)) {
    throw new Error("LUNA_AVAILABILITY_QUANTITY_CONFLICT")
  }
  if (!available) return { quantity: 0, recheckAfterSale: false }
  return { quantity: quantity && quantity > 0 ? quantity : 1, recheckAfterSale: quantity == null }
}

export function isValidSameDayLunaConfirmation(input: {
  price: number | null
  available: boolean
  quantity: number | null
  nativePackCount?: number | null
}) {
  if (typeof input.available !== "boolean") return false
  if (input.price !== null &&
    (!Number.isFinite(input.price) || input.price <= 0)) return false
  if (input.available && input.price === null) return false
  if (input.quantity !== null &&
    (!Number.isInteger(input.quantity) || input.quantity < 0)) return false
  if ((input.available && input.quantity === 0) ||
    (!input.available && Number(input.quantity ?? 0) > 0)) return false
  if (input.nativePackCount !== null && input.nativePackCount !== undefined &&
    (!Number.isInteger(input.nativePackCount) || input.nativePackCount <= 0 ||
      input.nativePackCount > 100)) return false
  return true
}

export function buildSameDayLocalPreparationPackage(candidate: SameDayCandidateDecision, observedAt: string) {
  const supplierQuantity = candidate.supplierQuantity ?? null
  const snapshotConflict =
    (candidate.supplierAvailable === true && supplierQuantity === 0) ||
    (candidate.supplierAvailable === false && Number(supplierQuantity ?? 0) > 0)
  const quantity = candidate.supplierAvailable == null || snapshotConflict
    ? { quantity: 1, recheckAfterSale: true }
    : listingQuantityFromLuna(supplierQuantity, candidate.supplierAvailable === true)
  return {
    schemaVersion: "SELLER_HUB_LOCAL_PREPARATION_V1",
    status: "BLOCKED_PENDING_VERIFIED_GATES" as const,
    preparedAt: observedAt,
    product: {
      lunaProductName: candidate.productTitle,
      variant: candidate.variantTitle ?? null,
      supplierSku: candidate.supplierSku ?? null,
      supplierVariantId: candidate.supplierVariantId ?? null,
      supplierProductUrl: candidate.supplierProductUrl ?? null,
      gtin: candidate.gtin ?? null,
      brand: candidate.brand ?? null,
      mpn: candidate.mpn ?? null,
      model: candidate.model ?? null,
      unitCount: candidate.unitCount ?? null,
      size: candidate.size ?? null,
      identityProvenance: {
        source: candidate.identityEvidenceSource ?? null,
        evidenceHash: candidate.identityEvidenceHash ?? null,
      },
    },
    offer: {
      listingQuantity: quantity.quantity || 1,
      recheckAfterSale: quantity.recheckAfterSale,
      supplierUnitCost: candidate.supplierPrice ?? null,
      nativePackCount: candidate.nativePackCount ?? null,
      targetPrice: null,
      finalPackIdentity: null,
    },
    market: {
      activeExactCount: candidate.activeExactCount ?? 0,
      soldExactCount: candidate.soldExactCount ?? 0,
      evidenceFresh: candidate.evidenceFresh === true,
      productResearchQuery: candidate.queryPlan.query,
      broadSearchPresentedAsDemand: false,
      radarFamilyEvidence: candidate.radarFamilyEvidence ?? null,
    },
    unresolved: candidate.blockers,
    intentionallyOmitted: [
      "FINAL_TITLE", "DESCRIPTION", "ITEM_SPECIFICS", "FINAL_PRICE",
      "SHIPPING_FACTS", "REGULATORY_CLAIMS", "IMAGE_PACKAGE",
    ],
    safety: {
      openAiUsed: false,
      ebayWriteUsed: false,
      publishable: false,
      competitorContentCopied: false,
    },
  }
}
