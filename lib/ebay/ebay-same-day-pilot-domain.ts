import { createHash } from "node:crypto"

export const SAME_DAY_PILOT_VERSION = "PILOT_3_LISTINGS_SAME_DAY_V1"
export const SAME_DAY_QUEUE_LIMIT = 5
export const SAME_DAY_MAX_CANDIDATE_CYCLES = 20
export const SAME_DAY_RECONCILIATION_DECISION_REFERENCE_LIMIT = 10
export const SAME_DAY_RECONCILIATION_COVERAGE_ROW_LIMIT = 200
export const SAME_DAY_TRADING_DETAIL_READ_LIMIT_PER_BATCH = 2

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
}

export type SameDayCandidateDecision = SameDayCandidateInput & {
  eligibleForQueue: boolean
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
  const candidatesTerminal = input.candidateMachineStates.length > 0
    && input.candidateMachineStates.every((state) =>
      TERMINAL_SAME_DAY_MACHINE_STATES.has(state))
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
  if (/^\d{8,14}$/.test(gtin)) return {
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
  const identity = productIdentityText(
    [input.productTitle, meaningfulVariant].filter(Boolean).join(" "),
  )
  return {
    strategy: "EXACT_NORMALIZED_IDENTITY", query: identity.slice(0, 100),
    reason: "No existe GTIN o MPN confiable; se requiere corroborar la identidad normalizada antes de avanzar.",
  }
}

export function evaluateSameDayCandidate(input: SameDayCandidateInput, now = new Date()): SameDayCandidateDecision {
  const queryPlan = buildSameDayProductResearchQuery(input)
  const familyFingerprint = fingerprint([
    normalized(input.brand), normalized(input.mpn || input.model),
    normalized(input.productTitle), normalized(input.variantTitle),
  ].join("|"))
  const exactOrStrongIdentity = input.exactIdentityConfirmed === true || Number(input.identityConfidence ?? 0) >= 85
  const stockKnown = input.supplierAvailable === true && Number(input.supplierQuantity ?? 0) > 0
  const stockUnknown = input.supplierAvailable === true && input.supplierQuantity == null
  const economicsPlausible = input.economicsReady === true || Number(input.estimatedProfit ?? 0) > 0
  const supplierObservedAt = Date.parse(input.supplierObservedAt ?? "")
  const lunaFresh = Number.isFinite(supplierObservedAt) && now.getTime() - supplierObservedAt <= 72 * 60 * 60_000
  const normalizedIdentity = normalized([input.productTitle, input.variantTitle].filter(Boolean).join(" "))
  const researchIdentitySufficient = /^\d{8,14}$/.test(normalized(input.gtin).replace(/\s/g, "")) ||
    Boolean(normalized(input.brand) && normalized(input.mpn || input.model)) ||
    normalizedIdentity.split(" ").filter((token) => token.length > 1).length >= 3
  const criticalHardGates = (input.hardGates ?? []).filter((gate) => !TODAY_RESOLVABLE_HARD_GATES.has(gate))
  const localBlockers = [
    input.supplierAvailable === false ? "LUNA_OUT_OF_STOCK" : "",
    !(Number(input.supplierPrice) > 0) ? "LUNA_COST_MISSING" : "",
    !normalized(input.supplierSku) ? "SUPPLIER_SKU_MISSING" : "",
    !normalized(input.supplierVariantId) ? "SUPPLIER_VARIANT_ID_MISSING" : "",
    !lunaFresh ? "LUNA_RECORD_STALE" : "",
    !researchIdentitySufficient ? "IDENTITY_INSUFFICIENT" : "",
    input.regulatedWithoutPath ? "REGULATORY_PATH_MISSING" : "",
    ["listed", "rejected", "archived"].includes(input.queueStatus ?? "") ? "OPPORTUNITY_NOT_ELIGIBLE" : "",
    ...criticalHardGates.map((gate) => `HARD_GATE:${gate}`),
  ].filter(Boolean)
  const marketReady = Number(input.activeExactCount ?? 0) > 0 && input.evidenceFresh === true
  let state: SameDayCandidateState = "READY_TO_VALIDATE_TODAY"
  let nextAutomatedAction = "Resolver ficha técnica únicamente para este candidato."
  let nextHumanAction = "Confirmar precio y disponibilidad visibles en Luna."
  const blockers = [...localBlockers]
  if (localBlockers.length) {
    state = "REJECTED_TODAY"
    nextAutomatedAction = "Continuar con el siguiente candidato sin consumir cuota."
    nextHumanAction = "Ninguna; revisar el motivo sólo si desea recuperarlo otro día."
  } else if (!stockKnown) {
    state = "NEEDS_LUNA_CONFIRMATION"
    blockers.push(stockUnknown ? "LUNA_EXACT_QUANTITY_UNKNOWN" : "LUNA_AVAILABILITY_CONFIRMATION_REQUIRED")
    nextAutomatedAction = "Conservar el candidato sin bloquear las demás tareas."
    nextHumanAction = "Confirmar precio y disponibilidad en Luna; si la cantidad es desconocida se preparará cantidad eBay 1."
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
  return { ...input, eligibleForQueue: localBlockers.length === 0, state, blockers: [...new Set(blockers)],
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
  exactMarketEvidence: boolean
  productFactsCompatible: boolean
  requiredAspectsResolved: boolean
  regulatoryAcceptable: boolean
  shippingEstimateAvailable: boolean
  estimatedProfit: number | null
  roiPercent: number | null
  netMarginPercent: number | null
}) {
  const blockers = [
    !input.exactOrStrongIdentity ? "IDENTITY_NOT_READY" : "",
    !input.exactMarketEvidence ? "EXACT_MARKET_EVIDENCE_NOT_READY" : "",
    !input.productFactsCompatible ? "PRODUCT_FACTS_NOT_READY" : "",
    !input.requiredAspectsResolved ? "REQUIRED_ASPECTS_NOT_READY" : "",
    !input.regulatoryAcceptable ? "REGULATORY_NOT_READY" : "",
    !input.shippingEstimateAvailable ? "SHIPPING_ESTIMATE_NOT_READY" : "",
    Number(input.estimatedProfit ?? 0) < 5 ? "PROFIT_BELOW_5_USD" : "",
    Number(input.roiPercent ?? 0) < 30 ? "ROI_BELOW_30_PERCENT" : "",
    Number(input.netMarginPercent ?? 0) < 20 ? "NET_MARGIN_BELOW_20_PERCENT" : "",
  ].filter(Boolean)
  return { ready: blockers.length === 0, blockers, idealProfitReached: Number(input.estimatedProfit ?? 0) >= 7 }
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

export function buildSameDayLocalPreparationPackage(candidate: SameDayCandidateDecision, observedAt: string) {
  const quantity = listingQuantityFromLuna(candidate.supplierQuantity ?? null, candidate.supplierAvailable === true)
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
      supplierImageUrl: candidate.supplierImageUrl ?? null,
      gtin: candidate.gtin ?? null,
    },
    offer: {
      listingQuantity: quantity.quantity || 1,
      recheckAfterSale: quantity.recheckAfterSale,
      supplierUnitCost: candidate.supplierPrice ?? null,
      targetPrice: null,
      finalPackIdentity: null,
    },
    market: {
      activeExactCount: candidate.activeExactCount ?? 0,
      soldExactCount: candidate.soldExactCount ?? 0,
      evidenceFresh: candidate.evidenceFresh === true,
      productResearchQuery: candidate.queryPlan.query,
      broadSearchPresentedAsDemand: false,
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
