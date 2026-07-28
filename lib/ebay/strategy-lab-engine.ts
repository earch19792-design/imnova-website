export const STRATEGY_LAB_ENGINE_VERSION =
  "STRATEGY_LAB_ENGINE_V1_1_2026_07_28" as const

export const EVIDENCE_CLASSES = [
  "PRODUCT_VERIFIED",
  "SUPPLIER_STATED",
  "EBAY_SOLD_EXACT",
  "EBAY_ACTIVE_EXACT",
  "EBAY_ESTIMATED_SIGNAL",
  "HUMAN_HYPOTHESIS",
  "CONFLICTED",
  "MISSING",
] as const

export const MARKET_COHORTS = [
  "SOLD_EXACT",
  "ACTIVE_EXACT",
  "SIMILAR_NOT_EXACT",
  "ESTIMATED_ONLY",
  "REJECTED",
] as const

export const OFFER_SCENARIOS = [
  "SINGLE",
  "TWO_PACK",
  "THREE_PACK",
  "MIXED_VARIANT_BUNDLE",
] as const

export const STRATEGY_OUTPUTS = [
  "GO_SINGLE",
  "TEST_SINGLE",
  "EVALUATE_TWO_PACK",
  "EVALUATE_THREE_PACK",
  "MIXED_VARIANT_BUNDLE",
  "HOLD_IDENTITY",
  "HOLD_COMPATIBILITY",
  "HOLD_ECONOMICS",
  "HOLD_EVIDENCE_INCOMPLETE",
  "NO_GO",
] as const

export type EvidenceClass = typeof EVIDENCE_CLASSES[number]
export type MarketCohort = typeof MARKET_COHORTS[number]
export type OfferScenario = typeof OFFER_SCENARIOS[number]
export type StrategyOutput = typeof STRATEGY_OUTPUTS[number]
export type ConfidenceLevel = "LOW" | "MEDIUM" | "HIGH"
export type CompatibilityConfidenceLevel =
  | "NOT_APPLICABLE"
  | ConfidenceLevel

export type EvidencePurpose =
  | "IDENTITY"
  | "COMPATIBILITY"
  | "ECONOMICS"
  | "CREATIVE"

export type EconomicCostEvidence = {
  component:
    | "PRODUCT_UNIT_COST"
    | "PACKAGING_COST"
    | "OUTBOUND_SHIPPING_COST"
  currency: "USD" | string
  basis: "PER_UNIT" | "PER_ORDER"
  variantKeys?: string[]
}

export type EvidenceSourceKind =
  | "PRODUCT_INSPECTION"
  | "SUPPLIER_CATALOG"
  | "EBAY_CONFIRMED_SOLD"
  | "EBAY_ACTIVE_LISTING"
  | "EBAY_ESTIMATED_ACTIVITY"
  | "HUMAN_REVIEW"

export type EvidenceInput = {
  id: string
  field: string
  label: string
  rawValue: unknown
  normalizedValue: unknown
  scope: "PRODUCT" | "MARKET" | "STRATEGY"
  sourceKind: EvidenceSourceKind
  sourceReference: string
  observedAt: string
  conflictKey?: string | null
  requiredFor?: EvidencePurpose[]
  economicCost?: EconomicCostEvidence | null
  humanReviewed?: boolean
}

export type ClassifiedEvidence = EvidenceInput & {
  sourceClass: EvidenceClass
  classification: EvidenceClass
  classificationReasons: string[]
  provenanceComplete: boolean
  usableAsProductFact: boolean
}

export type ComparableInput = {
  itemId: string
  title: string
  sourceKind: "EBAY_SOLD" | "EBAY_ACTIVE" | "EBAY_ESTIMATED"
  sourceReference: string
  observedAt: string
  identityMatch: "EXACT" | "SIMILAR" | "REJECTED"
  identityMatchBasis: Array<
    "GTIN_EXACT" | "BRAND_MPN_EXACT" | "HUMAN_VERIFIED" | "TEXT_ONLY"
  >
  identityConflicts?: string[]
  offerScenario: OfferScenario
  packQuantity: number | null
  variantComposition: string[]
  itemPrice: number | null
  buyerShipping: number | null
  currency: "USD" | string
  saleConfirmed: boolean
  confirmedSoldQuantity: number | null
  estimatedSoldQuantity: number | null
}

export type ValidatedComparable = ComparableInput & {
  canonicalItemId: string
  accepted: boolean
  cohort: MarketCohort
  evidenceClass: EvidenceClass
  buyerTotalPrice: number | null
  offerSignature: string | null
  validationNotes: string[]
  rejectionReasons: string[]
}

export type MarketDistribution = {
  sampleSize: number
  priceSampleSize: number
  uniqueItemCount: number
  missingBuyerShippingCount: number
  minimum: number | null
  p25: number | null
  median: number | null
  p75: number | null
  maximum: number | null
}

export type MarketModel = {
  scenarioId: string
  offerScenario: OfferScenario
  offerSignature: string
  soldExact: MarketDistribution
  activeExact: MarketDistribution
  similarNotExactCount: number
  estimatedOnlyCount: number
  rejectedCount: number
  referenceMedian: {
    value: number
    basis: "SOLD_EXACT_MEDIAN" | "ACTIVE_EXACT_MEDIAN"
  } | null
  marketCeiling: {
    value: number
    basis: "SOLD_EXACT_P75" | "ACTIVE_EXACT_P75"
    canSupportGo: boolean
  } | null
  exactSoldEvidenceSufficient: boolean
}

export type EconomicsPolicy = {
  version: string
  feeRate: number
  fixedOrderFee: number
  returnsReserveRate: number
  promotedListingsReserveRate: number
  minimumProfit: number
  minimumMarginPercent: number
  minimumRoiPercent: number
}

export type ScenarioCostLine = {
  variantKey: string
  quantity: number
  unitCost: number | null
  evidenceId: string
}

export type EvidenceRequirement = {
  field: string
  blockerCode: string
  acceptedEvidenceClasses: EvidenceClass[]
  requiredPurpose: EvidencePurpose
  requireProductFact: boolean
}

export type CreativeSeed = {
  positioning: string
  heroComposition: string
  proofEvidenceFields: string[]
  requiredEvidence: EvidenceRequirement[]
  forbiddenTerms: string[]
}

export type OfferScenarioInput = {
  id: string
  offerScenario: OfferScenario
  packQuantity: number
  variantComposition: string[]
  costLines: ScenarioCostLine[]
  packagingCost: number | null
  packagingCostEvidenceId: string | null
  itemPrice: number | null
  buyerShippingCharge: number | null
  outboundShippingCost: number | null
  outboundShippingCostEvidenceId: string | null
  hypothesisEvidenceClass?: EvidenceClass | null
  requiredEvidence?: EvidenceRequirement[]
  requiresExactSoldEvidence?: boolean
  creativeSeed: CreativeSeed
}

export type CompatibilityGate = {
  required: boolean
  requirements: EvidenceRequirement[]
}

export type StrategyLabCaseInput = {
  fixtureVersion: string
  caseId: string
  productLabel: string
  evaluatedAt: string
  currency: "USD"
  economicsPolicy: EconomicsPolicy
  evidence: EvidenceInput[]
  comparables: ComparableInput[]
  scenarios: OfferScenarioInput[]
  identityRequirements: EvidenceRequirement[]
  compatibility?: CompatibilityGate
}

export type ScenarioEconomics = {
  status: "VIABLE" | "HOLD_ECONOMICS" | "MISSING_INPUT"
  buyerTotalPrice: number | null
  productCost: number | null
  costEvidenceIds: string[]
  packagingCost: number | null
  packagingCostEvidenceId: string | null
  outboundShippingCost: number | null
  outboundShippingCostEvidenceId: string | null
  investedCost: number | null
  variableFeeAmount: number | null
  fixedOrderFee: number | null
  estimatedProfit: number | null
  netMarginPercent: number | null
  roiPercent: number | null
  profitFloor: number | null
  profitFloorComponents: {
    minimumProfitPrice: number | null
    minimumMarginPrice: number | null
    minimumRoiPrice: number | null
  }
  marketCeiling: number | null
  marketCeilingBasis:
    | "SOLD_EXACT_P75"
    | "ACTIVE_EXACT_P75"
    | null
  viablePriceWindow: boolean | null
  passesProfitGate: boolean | null
  passesMarginGate: boolean | null
  passesRoiGate: boolean | null
  blockers: string[]
}

export type ScenarioAssessment = {
  scenario: OfferScenarioInput
  marketModel: MarketModel
  economics: ScenarioEconomics
  candidateStrategy: StrategyOutput
  releaseGate: StrategyOutput
  blockers: string[]
  warnings: string[]
  selectionScore: number
  selectionReasons: string[]
}

export type StrategyRecommendation = {
  preferredScenarioId: string | null
  preferredScenario: OfferScenario | null
  commercialDirection: StrategyOutput | null
  releaseGate: StrategyOutput
  blockers: string[]
  warnings: string[]
  nextAction: string
}

export type CreativeBrief = {
  status: "DRAFT" | "BLOCKED"
  sourceScenarioId: string | null
  sourceStrategy: StrategyOutput | null
  positioning: string
  heroComposition: string
  visualUnitCount: number
  visibleVariants: string[]
  approvedCopy: string[]
  approvedProof: Array<{
    field: string
    label: string
    normalizedValue: unknown
    evidenceClass: EvidenceClass
    sourceReference: string
  }>
  omittedProof: Array<{
    field: string
    reason: "MISSING" | "CONFLICTED" | "NOT_PRODUCT_EVIDENCE"
  }>
  prohibitedTerms: string[]
  blockers: string[]
  canProduceAssets: false
}

export type StrategyConfidence = {
  identity: ConfidenceLevel
  compatibility: CompatibilityConfidenceLevel
  market: ConfidenceLevel
  economics: ConfidenceLevel
  strategy: ConfidenceLevel
  reasons: string[]
}

export type StrategyLabEvaluation = {
  engineVersion: typeof STRATEGY_LAB_ENGINE_VERSION
  caseId: string
  evaluatedAt: string
  evidence: ClassifiedEvidence[]
  productFacts: ClassifiedEvidence[]
  acceptedComparables: ValidatedComparable[]
  rejectedComparables: ValidatedComparable[]
  cohorts: Record<MarketCohort, ValidatedComparable[]>
  scenarioAssessments: ScenarioAssessment[]
  recommendation: StrategyRecommendation
  creativeBrief: CreativeBrief
  confidence: StrategyConfidence
  safety: {
    supabaseWrites: 0
    ebayWrites: 0
    openAiCalls: 0
    whatsappCalls: 0
    generatedImages: 0
    listingChanges: 0
  }
}

export type HumanConclusion = {
  preferredScenario: OfferScenario | null
  commercialDirection: StrategyOutput | null
  releaseGate: StrategyOutput
  blockers: string[]
  nextAction: string
  positioning: string
}

export type HumanComparison = {
  agreement: "MATCH" | "PARTIAL" | "DIFFERENT"
  checks: Array<{
    field: keyof HumanConclusion
    osValue: unknown
    humanValue: unknown
    status: "MATCH" | "DIFF"
  }>
  differences: Array<{
    field: keyof HumanConclusion
    osValue: unknown
    humanValue: unknown
  }>
}

const SOURCE_CLASS: Record<EvidenceSourceKind, EvidenceClass> = {
  PRODUCT_INSPECTION: "PRODUCT_VERIFIED",
  SUPPLIER_CATALOG: "SUPPLIER_STATED",
  EBAY_CONFIRMED_SOLD: "EBAY_SOLD_EXACT",
  EBAY_ACTIVE_LISTING: "EBAY_ACTIVE_EXACT",
  EBAY_ESTIMATED_ACTIVITY: "EBAY_ESTIMATED_SIGNAL",
  HUMAN_REVIEW: "HUMAN_HYPOTHESIS",
}

function present(value: unknown) {
  return value !== null && value !== undefined && value !== ""
}

function money(value: number) {
  return Math.round((value + 1e-9) * 100) / 100
}

function moneyUp(value: number) {
  return Math.ceil((value - 1e-9) * 100) / 100
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableValue).join(",")}]`
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableValue(record[key])}`
    ).join(",")}}`
  }
  return JSON.stringify(value) ?? String(value)
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function sortedUnique(values: string[]) {
  return unique(values).sort((left, right) => left.localeCompare(right))
}

function isEbaySource(sourceKind: EvidenceSourceKind) {
  return sourceKind.startsWith("EBAY_")
}

export function classifyEvidence(input: EvidenceInput): ClassifiedEvidence {
  const sourceClass = SOURCE_CLASS[input.sourceKind]
  const provenanceComplete = Boolean(
    input.sourceReference.trim() && input.observedAt.trim(),
  )
  const reasons: string[] = []
  let classification: EvidenceClass = sourceClass

  if (!present(input.normalizedValue)) {
    classification = "MISSING"
    reasons.push("NORMALIZED_VALUE_MISSING")
  }
  if (classification === "PRODUCT_VERIFIED" &&
    input.humanReviewed !== true) {
    classification = "HUMAN_HYPOTHESIS"
    reasons.push("PRODUCT_INSPECTION_REQUIRES_HUMAN_REVIEW")
  }
  if (!provenanceComplete) {
    classification = "CONFLICTED"
    reasons.push("PROVENANCE_INCOMPLETE")
  }
  if (input.scope === "PRODUCT" && isEbaySource(input.sourceKind)) {
    classification = "CONFLICTED"
    reasons.push("COMPETITOR_DATA_CANNOT_BECOME_PRODUCT_FACT")
  }

  const usableAsProductFact = input.scope === "PRODUCT" &&
    ["PRODUCT_INSPECTION", "SUPPLIER_CATALOG"].includes(input.sourceKind) &&
    ["PRODUCT_VERIFIED", "SUPPLIER_STATED"].includes(classification)

  return {
    ...input,
    sourceClass,
    classification,
    classificationReasons: reasons,
    provenanceComplete,
    usableAsProductFact,
  }
}

export function classifyEvidenceSet(
  inputs: EvidenceInput[],
): ClassifiedEvidence[] {
  const classified = inputs.map(classifyEvidence)
  const conflictValues = new Map<string, Set<string>>()
  for (const entry of classified) {
    if (!entry.conflictKey || !present(entry.normalizedValue)) continue
    const values = conflictValues.get(entry.conflictKey) ?? new Set<string>()
    values.add(stableValue(entry.normalizedValue))
    conflictValues.set(entry.conflictKey, values)
  }

  return classified.map((entry) => {
    if (!entry.conflictKey ||
      (conflictValues.get(entry.conflictKey)?.size ?? 0) < 2) {
      return entry
    }
    return {
      ...entry,
      classification: "CONFLICTED" as const,
      classificationReasons: unique([
        ...entry.classificationReasons,
        `CONFLICT_GROUP:${entry.conflictKey}`,
      ]),
      usableAsProductFact: false,
    }
  })
}

function canonicalVariants(variants: string[]) {
  return variants
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
}

export function buildOfferSignature(input: {
  offerScenario: OfferScenario
  packQuantity: number
  variantComposition: string[]
}) {
  return [
    input.offerScenario,
    String(input.packQuantity),
    canonicalVariants(input.variantComposition).join("+"),
  ].join("|")
}

export function canonicalizeEbayItemId(input: string) {
  const trimmed = input.trim()
  const numericPart = trimmed.match(/(?:^|\|)(\d{9,15})(?:\||$)/)?.[1]
  return (numericPart ?? trimmed).toUpperCase()
}

function rejectedComparable(
  input: ComparableInput,
  reasons: string[],
  notes: string[] = [],
): ValidatedComparable {
  const packQuantity = Number.isInteger(input.packQuantity) &&
      Number(input.packQuantity) > 0
    ? Number(input.packQuantity)
    : null
  return {
    ...input,
    canonicalItemId: canonicalizeEbayItemId(input.itemId),
    accepted: false,
    cohort: "REJECTED",
    evidenceClass: reasons.some((reason) => reason.includes("CONFLICT"))
      ? "CONFLICTED"
      : "MISSING",
    buyerTotalPrice: null,
    offerSignature: packQuantity === null
      ? null
      : buildOfferSignature({
          offerScenario: input.offerScenario,
          packQuantity,
          variantComposition: input.variantComposition,
        }),
    validationNotes: notes,
    rejectionReasons: unique(reasons),
  }
}

export function validateComparable(
  input: ComparableInput,
): ValidatedComparable {
  const rejectionReasons: string[] = []
  const notes: string[] = []
  const canonicalItemId = canonicalizeEbayItemId(input.itemId)
  const packQuantity = input.packQuantity
  const structuralExact = input.identityMatchBasis.some((basis) =>
    basis !== "TEXT_ONLY"
  )

  if (!canonicalItemId) rejectionReasons.push("ITEM_ID_MISSING")
  if (!input.sourceReference.trim() || !input.observedAt.trim()) {
    rejectionReasons.push("PROVENANCE_INCOMPLETE")
  }
  if (!Number.isInteger(packQuantity) || Number(packQuantity) <= 0) {
    rejectionReasons.push("PACK_QUANTITY_MISSING")
  }
  if (input.itemPrice === null || !Number.isFinite(input.itemPrice) ||
    input.itemPrice < 0) {
    rejectionReasons.push("ITEM_PRICE_MISSING_OR_INVALID")
  }
  if (input.buyerShipping !== null &&
    (!Number.isFinite(input.buyerShipping) || input.buyerShipping < 0)) {
    rejectionReasons.push("BUYER_SHIPPING_INVALID")
  }
  if (input.currency !== "USD") {
    rejectionReasons.push("UNSUPPORTED_CURRENCY")
  }
  if (input.identityMatch === "REJECTED") {
    rejectionReasons.push("IDENTITY_REJECTED")
  }
  if ((input.identityConflicts?.length ?? 0) > 0) {
    rejectionReasons.push("IDENTITY_CONFLICT")
  }
  if (rejectionReasons.length) {
    return rejectedComparable(input, rejectionReasons)
  }

  const exact = input.identityMatch === "EXACT" && structuralExact
  if (input.identityMatch === "EXACT" && !structuralExact) {
    notes.push("TEXT_ONLY_MATCH_DOWNGRADED")
  }

  let cohort: MarketCohort
  let evidenceClass: EvidenceClass

  if (input.sourceKind === "EBAY_ESTIMATED") {
    cohort = "ESTIMATED_ONLY"
    evidenceClass = "EBAY_ESTIMATED_SIGNAL"
  } else if (!exact || input.identityMatch === "SIMILAR") {
    cohort = "SIMILAR_NOT_EXACT"
    evidenceClass = "HUMAN_HYPOTHESIS"
  } else if (input.sourceKind === "EBAY_ACTIVE") {
    cohort = "ACTIVE_EXACT"
    evidenceClass = "EBAY_ACTIVE_EXACT"
  } else if (input.saleConfirmed &&
    Number.isInteger(input.confirmedSoldQuantity) &&
    Number(input.confirmedSoldQuantity) > 0) {
    cohort = "SOLD_EXACT"
    evidenceClass = "EBAY_SOLD_EXACT"
  } else if (Number.isFinite(input.estimatedSoldQuantity) &&
    Number(input.estimatedSoldQuantity) > 0) {
    cohort = "ESTIMATED_ONLY"
    evidenceClass = "EBAY_ESTIMATED_SIGNAL"
    notes.push("UNVERIFIED_SOLD_INPUT_DOWNGRADED_TO_ESTIMATED")
  } else {
    return rejectedComparable(
      input,
      ["CONFIRMED_SOLD_EVIDENCE_MISSING"],
      notes,
    )
  }

  if (input.buyerShipping === null) {
    notes.push("BUYER_SHIPPING_MISSING")
  }
  if (input.sourceKind === "EBAY_ACTIVE" &&
    (input.confirmedSoldQuantity ?? 0) > 0) {
    notes.push("ACTIVE_INPUT_CANNOT_BECOME_SOLD_EVIDENCE")
  }

  const buyerTotalPrice = input.buyerShipping === null ||
      input.itemPrice === null
    ? null
    : money(input.itemPrice + input.buyerShipping)
  const safePackQuantity = Number(packQuantity)

  return {
    ...input,
    canonicalItemId,
    accepted: true,
    cohort,
    evidenceClass,
    buyerTotalPrice,
    offerSignature: buildOfferSignature({
      offerScenario: input.offerScenario,
      packQuantity: safePackQuantity,
      variantComposition: input.variantComposition,
    }),
    validationNotes: notes,
    rejectionReasons: [],
  }
}

function comparableStrength(input: ValidatedComparable) {
  const cohortRank: Record<MarketCohort, number> = {
    SOLD_EXACT: 5,
    ACTIVE_EXACT: 4,
    SIMILAR_NOT_EXACT: 3,
    ESTIMATED_ONLY: 2,
    REJECTED: 0,
  }
  return cohortRank[input.cohort]
}

function asDuplicate(
  comparable: ValidatedComparable,
  reason: string,
): ValidatedComparable {
  return {
    ...comparable,
    accepted: false,
    cohort: "REJECTED",
    evidenceClass: reason.includes("CONFLICT") ? "CONFLICTED" : "MISSING",
    rejectionReasons: unique([...comparable.rejectionReasons, reason]),
  }
}

export function deduplicateComparables(
  inputs: ValidatedComparable[],
): {
  kept: ValidatedComparable[]
  discarded: ValidatedComparable[]
} {
  const preRejected = inputs.filter((entry) => !entry.accepted)
  const groups = new Map<string, ValidatedComparable[]>()
  for (const entry of inputs.filter((candidate) => candidate.accepted)) {
    const group = groups.get(entry.canonicalItemId) ?? []
    group.push(entry)
    groups.set(entry.canonicalItemId, group)
  }

  const kept: ValidatedComparable[] = []
  const discarded: ValidatedComparable[] = [...preRejected]

  for (const group of groups.values()) {
    const signatures = new Set(group.map((entry) => entry.offerSignature))
    if (signatures.size > 1) {
      discarded.push(...group.map((entry) =>
        asDuplicate(entry, "DUPLICATE_ITEM_ID_CONFLICT")
      ))
      continue
    }

    const ranked = [...group].sort((left, right) =>
      comparableStrength(right) - comparableStrength(left) ||
      right.observedAt.localeCompare(left.observedAt) ||
      left.sourceReference.localeCompare(right.sourceReference)
    )
    kept.push(ranked[0])
    discarded.push(...ranked.slice(1).map((entry) =>
      asDuplicate(entry, "DUPLICATE_ITEM_ID")
    ))
  }

  return {
    kept: kept.sort((left, right) =>
      left.canonicalItemId.localeCompare(right.canonicalItemId)
    ),
    discarded,
  }
}

export function separateMarketCohorts(
  inputs: ValidatedComparable[],
): Record<MarketCohort, ValidatedComparable[]> {
  const result: Record<MarketCohort, ValidatedComparable[]> = {
    SOLD_EXACT: [],
    ACTIVE_EXACT: [],
    SIMILAR_NOT_EXACT: [],
    ESTIMATED_ONLY: [],
    REJECTED: [],
  }
  for (const entry of inputs) result[entry.cohort].push(entry)
  return result
}

function percentile(values: number[], position: number) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = (sorted.length - 1) * position
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return money(sorted[lower])
  return money(
    sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower),
  )
}

function distribution(entries: ValidatedComparable[]): MarketDistribution {
  const prices = entries.flatMap((entry) =>
    entry.buyerTotalPrice === null ? [] : [entry.buyerTotalPrice]
  )
  return {
    sampleSize: entries.length,
    priceSampleSize: prices.length,
    uniqueItemCount: new Set(entries.map((entry) =>
      entry.canonicalItemId
    )).size,
    missingBuyerShippingCount: entries.filter((entry) =>
      entry.buyerShipping === null
    ).length,
    minimum: prices.length ? money(Math.min(...prices)) : null,
    p25: percentile(prices, 0.25),
    median: percentile(prices, 0.5),
    p75: percentile(prices, 0.75),
    maximum: prices.length ? money(Math.max(...prices)) : null,
  }
}

export function buildMarketModel(
  comparables: ValidatedComparable[],
  scenario: OfferScenarioInput,
): MarketModel {
  const offerSignature = buildOfferSignature(scenario)
  const matching = comparables.filter((entry) =>
    entry.offerSignature === offerSignature
  )
  const cohorts = separateMarketCohorts(matching)
  const soldExact = distribution(cohorts.SOLD_EXACT)
  const activeExact = distribution(cohorts.ACTIVE_EXACT)
  const soldSufficient = soldExact.priceSampleSize >= 2
  const activeSufficient = activeExact.priceSampleSize >= 2

  const referenceMedian = soldSufficient && soldExact.median !== null
    ? {
        value: soldExact.median,
        basis: "SOLD_EXACT_MEDIAN" as const,
      }
    : activeSufficient && activeExact.median !== null
      ? {
          value: activeExact.median,
          basis: "ACTIVE_EXACT_MEDIAN" as const,
        }
      : null
  const marketCeiling = soldSufficient && soldExact.p75 !== null
    ? {
        value: soldExact.p75,
        basis: "SOLD_EXACT_P75" as const,
        canSupportGo: true,
      }
    : activeSufficient && activeExact.p75 !== null
      ? {
          value: activeExact.p75,
          basis: "ACTIVE_EXACT_P75" as const,
          canSupportGo: false,
        }
      : null

  return {
    scenarioId: scenario.id,
    offerScenario: scenario.offerScenario,
    offerSignature,
    soldExact,
    activeExact,
    similarNotExactCount: cohorts.SIMILAR_NOT_EXACT.length,
    estimatedOnlyCount: cohorts.ESTIMATED_ONLY.length,
    rejectedCount: cohorts.REJECTED.length,
    referenceMedian,
    marketCeiling,
    exactSoldEvidenceSufficient: soldSufficient,
  }
}

function validRate(value: number) {
  return Number.isFinite(value) && value >= 0 && value < 1
}

function validNonnegativeNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0
}

const ACCEPTED_ECONOMICS_EVIDENCE_CLASSES: EvidenceClass[] = [
  "PRODUCT_VERIFIED",
  "SUPPLIER_STATED",
]

function costFromLines(input: {
  lines: ScenarioCostLine[]
  evidence: ClassifiedEvidence[]
  expectedQuantity: number
}) {
  const blockers: string[] = []
  const evidenceIds: string[] = []
  if (!input.lines.length) blockers.push("SUPPLIER_COST_MISSING")

  const quantity = input.lines.reduce((total, line) =>
    total + (Number.isInteger(line.quantity) && line.quantity > 0
      ? line.quantity
      : 0), 0
  )
  if (quantity !== input.expectedQuantity) {
    blockers.push("COST_LINE_QUANTITY_MISMATCH")
  }

  for (const line of input.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0 ||
      line.unitCost === null || !Number.isFinite(line.unitCost) ||
      line.unitCost < 0) {
      blockers.push(`SUPPLIER_COST_INVALID:${line.variantKey}`)
      continue
    }
    const observation = input.evidence.find((entry) =>
      entry.id === line.evidenceId
    )
    if (!observation) {
      blockers.push(`COST_EVIDENCE_MISSING:${line.variantKey}`)
      continue
    }
    if (!ACCEPTED_ECONOMICS_EVIDENCE_CLASSES.includes(
      observation.classification,
    )) {
      blockers.push(
        `COST_EVIDENCE_CLASS_NOT_ACCEPTED:${line.variantKey}:${observation.classification}`,
      )
      continue
    }
    if (!observation.usableAsProductFact) {
      blockers.push(`COST_PRODUCT_FACT_REQUIRED:${line.variantKey}`)
      continue
    }
    if (!observation.requiredFor?.includes("ECONOMICS")) {
      blockers.push(`COST_EVIDENCE_PURPOSE_MISSING:${line.variantKey}`)
      continue
    }
    if (observation.economicCost?.component !== "PRODUCT_UNIT_COST" ||
      observation.economicCost.currency !== "USD" ||
      observation.economicCost.basis !== "PER_UNIT" ||
      !observation.economicCost.variantKeys?.includes(line.variantKey)) {
      blockers.push(`COST_EVIDENCE_ROLE_MISMATCH:${line.variantKey}`)
      continue
    }
    if (typeof observation.normalizedValue !== "number" ||
      !Number.isFinite(observation.normalizedValue) ||
      Math.abs(observation.normalizedValue - line.unitCost) > 0.000_001) {
      blockers.push(`COST_EVIDENCE_CONFLICTED:${line.variantKey}`)
      continue
    }
    evidenceIds.push(observation.id)
  }

  if (blockers.length) {
    return {
      productCost: null,
      evidenceIds: sortedUnique(evidenceIds),
      blockers: unique(blockers),
    }
  }
  return {
    productCost: money(input.lines.reduce((total, line) =>
      total + line.quantity * Number(line.unitCost), 0
    )),
    evidenceIds: sortedUnique(evidenceIds),
    blockers: [],
  }
}

function evidenceBackedScenarioCost(input: {
  component: "PACKAGING_COST" | "OUTBOUND_SHIPPING_COST"
  value: number | null
  evidenceId: string | null
  evidence: ClassifiedEvidence[]
  missingBlocker: string
}) {
  if (input.value === null) {
    return {
      value: null,
      evidenceId: null,
      evidenceClass: null,
      blockers: [input.missingBlocker],
    }
  }
  if (!Number.isFinite(input.value) || input.value < 0) {
    return {
      value: null,
      evidenceId: null,
      evidenceClass: null,
      blockers: [`${input.component}_INVALID`],
    }
  }
  if (!input.evidenceId?.trim()) {
    return {
      value: null,
      evidenceId: null,
      evidenceClass: null,
      blockers: [`${input.component}_EVIDENCE_MISSING`],
    }
  }

  const observation = input.evidence.find((entry) =>
    entry.id === input.evidenceId
  )
  if (!observation) {
    return {
      value: null,
      evidenceId: null,
      evidenceClass: null,
      blockers: [`${input.component}_EVIDENCE_MISSING`],
    }
  }

  const blockers: string[] = []
  if (!ACCEPTED_ECONOMICS_EVIDENCE_CLASSES.includes(
    observation.classification,
  )) {
    blockers.push(
      `${input.component}_EVIDENCE_CLASS_NOT_ACCEPTED:${observation.classification}`,
    )
  }
  if (!observation.usableAsProductFact) {
    blockers.push(`${input.component}_PRODUCT_FACT_REQUIRED`)
  }
  if (!observation.requiredFor?.includes("ECONOMICS")) {
    blockers.push(`${input.component}_EVIDENCE_PURPOSE_MISSING`)
  }
  if (observation.economicCost?.component !== input.component ||
    observation.economicCost.currency !== "USD" ||
    observation.economicCost.basis !== "PER_ORDER") {
    blockers.push(`${input.component}_EVIDENCE_ROLE_MISMATCH`)
  }
  if (typeof observation.normalizedValue !== "number" ||
    !Number.isFinite(observation.normalizedValue) ||
    observation.normalizedValue < 0 ||
    Math.abs(observation.normalizedValue - input.value) > 0.000_001) {
    blockers.push(`${input.component}_EVIDENCE_CONFLICTED`)
  }
  if (blockers.length) {
    return {
      value: null,
      evidenceId: null,
      evidenceClass: null,
      blockers: unique(blockers),
    }
  }

  return {
    value: money(input.value),
    evidenceId: observation.id,
    evidenceClass: observation.classification,
    blockers: [],
  }
}

export function calculateOfferScenarioEconomics(input: {
  scenario: OfferScenarioInput
  policy: EconomicsPolicy
  marketModel: MarketModel
  evidence: ClassifiedEvidence[]
}): ScenarioEconomics {
  const { scenario, policy, marketModel } = input
  const blockers: string[] = []
  const costResult = costFromLines({
    lines: scenario.costLines,
    evidence: input.evidence,
    expectedQuantity: scenario.packQuantity,
  })
  const productCost = costResult.productCost
  blockers.push(...costResult.blockers)
  const packagingResult = evidenceBackedScenarioCost({
    component: "PACKAGING_COST",
    value: scenario.packagingCost,
    evidenceId: scenario.packagingCostEvidenceId,
    evidence: input.evidence,
    missingBlocker: "PACKAGING_COST_MISSING",
  })
  const shippingResult = evidenceBackedScenarioCost({
    component: "OUTBOUND_SHIPPING_COST",
    value: scenario.outboundShippingCost,
    evidenceId: scenario.outboundShippingCostEvidenceId,
    evidence: input.evidence,
    missingBlocker: scenario.packQuantity > 1
      ? `CONSOLIDATED_SHIPPING_MISSING:${scenario.offerScenario}`
      : "OUTBOUND_SHIPPING_MISSING:SINGLE",
  })
  blockers.push(...packagingResult.blockers, ...shippingResult.blockers)
  const policyValid = [
    policy.feeRate,
    policy.returnsReserveRate,
    policy.promotedListingsReserveRate,
  ].every(validRate) &&
    Number.isFinite(policy.fixedOrderFee) && policy.fixedOrderFee >= 0 &&
    Number.isFinite(policy.minimumProfit) && policy.minimumProfit >= 0 &&
    Number.isFinite(policy.minimumMarginPercent) &&
    policy.minimumMarginPercent >= 0 && policy.minimumMarginPercent < 100 &&
    Number.isFinite(policy.minimumRoiPercent) &&
    policy.minimumRoiPercent >= 0 &&
    policy.feeRate + policy.returnsReserveRate +
      policy.promotedListingsReserveRate < 1 &&
    policy.feeRate + policy.returnsReserveRate +
      policy.promotedListingsReserveRate +
      policy.minimumMarginPercent / 100 < 1

  if (productCost === null && !costResult.blockers.length) {
    blockers.push("SUPPLIER_COST_MISSING")
  }
  if (scenario.itemPrice === null || !Number.isFinite(scenario.itemPrice) ||
    scenario.itemPrice < 0 ||
    scenario.buyerShippingCharge === null ||
    !Number.isFinite(scenario.buyerShippingCharge) ||
    scenario.buyerShippingCharge < 0) {
    blockers.push("BUYER_TOTAL_PRICE_MISSING")
  }
  if (!policyValid) blockers.push("ECONOMICS_POLICY_INVALID")
  if (!marketModel.marketCeiling) {
    blockers.push(`MARKET_CEILING_MISSING:${scenario.offerScenario}`)
  }

  const buyerTotalPrice = !validNonnegativeNumber(scenario.itemPrice) ||
      !validNonnegativeNumber(scenario.buyerShippingCharge)
    ? null
    : money(scenario.itemPrice + scenario.buyerShippingCharge)
  const packagingCost = packagingResult.value
  const outboundShippingCost = shippingResult.value
  const investedCost = productCost === null || packagingCost === null ||
      outboundShippingCost === null
    ? null
    : money(productCost + packagingCost + outboundShippingCost)
  const variableRate = policy.feeRate + policy.returnsReserveRate +
    policy.promotedListingsReserveRate

  let minimumProfitPrice: number | null = null
  let minimumMarginPrice: number | null = null
  let minimumRoiPrice: number | null = null
  let profitFloor: number | null = null
  let variableFeeAmount: number | null = null
  let estimatedProfit: number | null = null
  let netMarginPercent: number | null = null
  let roiPercent: number | null = null

  if (policyValid && investedCost !== null && investedCost > 0 &&
    variableRate < 1) {
    minimumProfitPrice = moneyUp(
      (investedCost + policy.fixedOrderFee + policy.minimumProfit) /
        (1 - variableRate),
    )
    const minimumMarginRate = policy.minimumMarginPercent / 100
    if (variableRate + minimumMarginRate < 1) {
      minimumMarginPrice = moneyUp(
        (investedCost + policy.fixedOrderFee) /
          (1 - variableRate - minimumMarginRate),
      )
    }
    minimumRoiPrice = moneyUp(
      (
        investedCost + policy.fixedOrderFee +
        investedCost * (policy.minimumRoiPercent / 100)
      ) / (1 - variableRate),
    )
    const floors = [
      minimumProfitPrice,
      minimumMarginPrice,
      minimumRoiPrice,
    ].filter((value): value is number => value !== null)
    profitFloor = floors.length ? moneyUp(Math.max(...floors)) : null
  }

  if (buyerTotalPrice !== null && investedCost !== null && policyValid) {
    const rawVariableFeeAmount = buyerTotalPrice * variableRate
    const rawEstimatedProfit = buyerTotalPrice - investedCost -
      policy.fixedOrderFee - rawVariableFeeAmount
    variableFeeAmount = money(rawVariableFeeAmount)
    estimatedProfit = money(rawEstimatedProfit)
    netMarginPercent = buyerTotalPrice > 0
      ? money((rawEstimatedProfit / buyerTotalPrice) * 100)
      : null
    roiPercent = investedCost > 0 && estimatedProfit !== null
      ? money((estimatedProfit / investedCost) * 100)
      : null
  }

  const marketCeiling = marketModel.marketCeiling?.value ?? null
  const viablePriceWindow = profitFloor === null || marketCeiling === null
    ? null
    : profitFloor <= marketCeiling
  const passesProfitGate = estimatedProfit === null
    ? null
    : estimatedProfit >= policy.minimumProfit
  const passesMarginGate = netMarginPercent === null
    ? null
    : netMarginPercent >= policy.minimumMarginPercent
  const passesRoiGate = roiPercent === null
    ? null
    : roiPercent >= policy.minimumRoiPercent

  const missingInput = blockers.length > 0
  const passesEveryGate = passesProfitGate === true &&
    passesMarginGate === true && passesRoiGate === true &&
    viablePriceWindow === true
  const status: ScenarioEconomics["status"] = missingInput
    ? "MISSING_INPUT"
    : passesEveryGate
      ? "VIABLE"
      : "HOLD_ECONOMICS"

  if (!missingInput && viablePriceWindow === false) {
    blockers.push("PROFIT_FLOOR_ABOVE_MARKET_CEILING")
  }
  if (!missingInput && passesProfitGate === false) {
    blockers.push("MINIMUM_PROFIT_NOT_MET")
  }
  if (!missingInput && passesMarginGate === false) {
    blockers.push("MINIMUM_MARGIN_NOT_MET")
  }
  if (!missingInput && passesRoiGate === false) {
    blockers.push("MINIMUM_ROI_NOT_MET")
  }

  return {
    status,
    buyerTotalPrice,
    productCost,
    costEvidenceIds: sortedUnique([
      ...costResult.evidenceIds,
      ...(packagingResult.evidenceId
        ? [packagingResult.evidenceId]
        : []),
      ...(shippingResult.evidenceId
        ? [shippingResult.evidenceId]
        : []),
    ]),
    packagingCost,
    packagingCostEvidenceId: packagingResult.evidenceId,
    outboundShippingCost,
    outboundShippingCostEvidenceId: shippingResult.evidenceId,
    investedCost,
    variableFeeAmount,
    fixedOrderFee: Number.isFinite(policy.fixedOrderFee) &&
        policy.fixedOrderFee >= 0
      ? money(policy.fixedOrderFee)
      : null,
    estimatedProfit,
    netMarginPercent,
    roiPercent,
    profitFloor,
    profitFloorComponents: {
      minimumProfitPrice,
      minimumMarginPrice,
      minimumRoiPrice,
    },
    marketCeiling,
    marketCeilingBasis: marketModel.marketCeiling?.basis ?? null,
    viablePriceWindow,
    passesProfitGate,
    passesMarginGate,
    passesRoiGate,
    blockers: unique(blockers),
  }
}

function findEvidence(
  evidence: ClassifiedEvidence[],
  field: string,
) {
  return evidence.filter((entry) => entry.field === field)
}

function evaluateEvidenceRequirement(
  entries: ClassifiedEvidence[],
  requirement: EvidenceRequirement,
) {
  const blockers: string[] = []
  const acceptedClasses = unique(requirement.acceptedEvidenceClasses ?? [])
  if (!acceptedClasses.length) {
    return {
      satisfied: false,
      blockers: [
        requirement.blockerCode,
        `EVIDENCE_POLICY_MISSING:${requirement.field}`,
      ],
    }
  }
  if (entries.some((entry) => entry.classification === "CONFLICTED")) {
    return {
      satisfied: false,
      blockers: [
        requirement.blockerCode,
        `EVIDENCE_CONFLICT:${requirement.field}`,
      ],
    }
  }

  const presentEntries = entries.filter((entry) =>
    entry.classification !== "MISSING"
  )
  if (!presentEntries.length) {
    return {
      satisfied: false,
      blockers: [requirement.blockerCode],
    }
  }

  const classAccepted = presentEntries.filter((entry) =>
    acceptedClasses.includes(entry.classification)
  )
  if (!classAccepted.length) {
    return {
      satisfied: false,
      blockers: [
        requirement.blockerCode,
        `EVIDENCE_CLASS_NOT_ACCEPTED:${requirement.field}:${
          sortedUnique(presentEntries.map((entry) =>
            entry.classification
          )).join("+")
        }`,
      ],
    }
  }

  const purposeAccepted = classAccepted.filter((entry) =>
    entry.requiredFor?.includes(requirement.requiredPurpose)
  )
  if (!purposeAccepted.length) {
    blockers.push(
      `EVIDENCE_PURPOSE_MISSING:${requirement.field}:${requirement.requiredPurpose}`,
    )
  }
  const productFactAccepted = requirement.requireProductFact
    ? purposeAccepted.filter((entry) => entry.usableAsProductFact)
    : purposeAccepted
  if (requirement.requireProductFact && !productFactAccepted.length) {
    blockers.push(`PRODUCT_FACT_REQUIRED:${requirement.field}`)
  }

  if (blockers.length) {
    return {
      satisfied: false,
      blockers: unique([requirement.blockerCode, ...blockers]),
    }
  }
  return {
    satisfied: true,
    blockers: [],
  }
}

function requirementBlockers(
  evidence: ClassifiedEvidence[],
  requirement: EvidenceRequirement,
) {
  return evaluateEvidenceRequirement(
    findEvidence(evidence, requirement.field),
    requirement,
  ).blockers
}

function directionFor(
  scenario: OfferScenarioInput,
  market: MarketModel,
  economics: ScenarioEconomics,
): StrategyOutput {
  if (scenario.offerScenario === "SINGLE") {
    return economics.status === "VIABLE" &&
        market.marketCeiling?.canSupportGo === true
      ? "GO_SINGLE"
      : "TEST_SINGLE"
  }
  if (scenario.offerScenario === "TWO_PACK") return "EVALUATE_TWO_PACK"
  if (scenario.offerScenario === "THREE_PACK") {
    return "EVALUATE_THREE_PACK"
  }
  if (economics.status === "VIABLE") return "MIXED_VARIANT_BUNDLE"
  if (scenario.packQuantity === 2) return "EVALUATE_TWO_PACK"
  if (scenario.packQuantity === 3) return "EVALUATE_THREE_PACK"
  return "MIXED_VARIANT_BUNDLE"
}

function scoreAssessment(input: {
  releaseGate: StrategyOutput
  scenario: OfferScenarioInput
  market: MarketModel
}) {
  const gateScore: Partial<Record<StrategyOutput, number>> = {
    GO_SINGLE: 100,
    TEST_SINGLE: 90,
    EVALUATE_TWO_PACK: 90,
    EVALUATE_THREE_PACK: 90,
    MIXED_VARIANT_BUNDLE: 95,
    HOLD_COMPATIBILITY: 70,
    HOLD_EVIDENCE_INCOMPLETE: 60,
    HOLD_IDENTITY: 30,
    HOLD_ECONOMICS: 10,
    NO_GO: 0,
  }
  const gate = gateScore[input.releaseGate] ?? 0
  const soldEvidence = Math.min(
    10,
    input.market.soldExact.uniqueItemCount * 2,
  )
  const hypothesisPenalty =
    input.scenario.hypothesisEvidenceClass === "HUMAN_HYPOTHESIS"
      ? -10
      : 0
  return {
    score: gate + soldEvidence + hypothesisPenalty,
    reasons: [
      `RELEASE_GATE_SCORE:${input.releaseGate}:${gate}`,
      `UNIQUE_SOLD_EXACT_SCORE:${input.market.soldExact.uniqueItemCount}:${soldEvidence}`,
      hypothesisPenalty < 0
        ? `HUMAN_HYPOTHESIS_PENALTY:${hypothesisPenalty}`
        : "NO_HUMAN_HYPOTHESIS_BONUS:0",
    ],
  }
}

function conflictWarnings(evidence: ClassifiedEvidence[]) {
  return evidence
    .filter((entry) => entry.classification === "CONFLICTED")
    .map((entry) =>
      `EVIDENCE_CONFLICT:${entry.conflictKey ?? entry.field}`
    )
}

function nextActionFor(
  releaseGate: StrategyOutput,
  blockers: string[],
) {
  if (releaseGate === "NO_GO") return "HUMAN_CONFIRM_NO_GO"
  const orderedRules: Array<[RegExp, string]> = [
    [/FITMENT|COMPATIBILITY|DIMENSION/, "VALIDATE_FITMENT_AND_DIMENSIONS"],
    [/SOLD_EXACT_COHORT/, "COLLECT_EXACT_SOLD_COHORT"],
    [/OUTBOUND_SHIPPING_MISSING:SINGLE/, "CONFIRM_OUTBOUND_SHIPPING"],
    [/SHIPPING/, "CONFIRM_CONSOLIDATED_SHIPPING"],
    [/MARKET_CEILING/, "ESTABLISH_MARKET_CEILING"],
    [/VISUAL_SOURCE/, "ATTACH_REAL_PRODUCT_VISUAL_SOURCE"],
    [/PRODUCT_EVIDENCE|IDENTITY/, "RECONCILE_PRODUCT_EVIDENCE"],
  ]
  for (const [pattern, action] of orderedRules) {
    if (blockers.some((blocker) => pattern.test(blocker))) return action
  }
  if (releaseGate === "HOLD_ECONOMICS") {
    return "REDESIGN_OFFER_OR_RECORD_NO_GO"
  }
  return "HUMAN_VALIDATE_STRATEGY"
}

export function recommendStrategy(input: {
  caseInput: StrategyLabCaseInput
  evidence: ClassifiedEvidence[]
  comparables: ValidatedComparable[]
}): {
  assessments: ScenarioAssessment[]
  recommendation: StrategyRecommendation
} {
  const warnings = sortedUnique(conflictWarnings(input.evidence))
  const identityBlockers = input.caseInput.identityRequirements.length
    ? input.caseInput.identityRequirements.flatMap(
        (requirement) => requirementBlockers(input.evidence, requirement),
      )
    : ["IDENTITY_REQUIREMENTS_MISSING"]
  const compatibilityBlockers = input.caseInput.compatibility?.required
    ? input.caseInput.compatibility.requirements.length
      ? input.caseInput.compatibility.requirements.flatMap((requirement) =>
          requirementBlockers(input.evidence, requirement)
        )
      : ["COMPATIBILITY_REQUIREMENTS_MISSING"]
    : []

  const assessments = input.caseInput.scenarios.map((scenario) => {
    const marketModel = buildMarketModel(input.comparables, scenario)
    const economics = calculateOfferScenarioEconomics({
      scenario,
      policy: input.caseInput.economicsPolicy,
      marketModel,
      evidence: input.evidence,
    })
    const evidenceBlockers = (scenario.requiredEvidence ?? []).flatMap(
      (requirement) => requirementBlockers(input.evidence, requirement),
    )
    if (scenario.requiresExactSoldEvidence &&
      !marketModel.exactSoldEvidenceSufficient) {
      evidenceBlockers.push(
        `SOLD_EXACT_COHORT_MISSING:${scenario.offerScenario}`,
      )
    }
    const blockers = unique([
      ...identityBlockers,
      ...compatibilityBlockers,
      ...evidenceBlockers,
      ...economics.blockers,
    ])
    const candidateStrategy = directionFor(
      scenario,
      marketModel,
      economics,
    )
    let releaseGate: StrategyOutput = candidateStrategy
    if (identityBlockers.length) {
      releaseGate = "HOLD_IDENTITY"
    } else if (compatibilityBlockers.length) {
      releaseGate = "HOLD_COMPATIBILITY"
    } else if (economics.status === "HOLD_ECONOMICS") {
      releaseGate = "HOLD_ECONOMICS"
    } else if (evidenceBlockers.length ||
      economics.status === "MISSING_INPUT") {
      releaseGate = "HOLD_EVIDENCE_INCOMPLETE"
    }

    const score = scoreAssessment({
      releaseGate,
      scenario,
      market: marketModel,
    })
    return {
      scenario,
      marketModel,
      economics,
      candidateStrategy,
      releaseGate,
      blockers,
      warnings,
      selectionScore: score.score,
      selectionReasons: score.reasons,
    }
  })

  const preferred = assessments.reduce<ScenarioAssessment | null>(
    (best, candidate) =>
      !best || candidate.selectionScore > best.selectionScore
        ? candidate
        : best,
    null,
  )
  const allScenariosFailEconomics = assessments.length > 0 &&
    assessments.every((assessment) =>
      assessment.releaseGate === "HOLD_ECONOMICS"
    )
  const releaseGate: StrategyOutput = allScenariosFailEconomics
    ? "NO_GO"
    : preferred?.releaseGate ?? "NO_GO"
  const blockers = allScenariosFailEconomics
    ? sortedUnique(assessments.flatMap((assessment) =>
        assessment.blockers
      ))
    : preferred?.blockers ?? ["NO_SCENARIO_AVAILABLE"]

  return {
    assessments,
    recommendation: {
      preferredScenarioId: preferred?.scenario.id ?? null,
      preferredScenario: preferred?.scenario.offerScenario ?? null,
      commercialDirection: allScenariosFailEconomics
        ? null
        : preferred?.candidateStrategy ?? null,
      releaseGate,
      blockers,
      warnings,
      nextAction: nextActionFor(releaseGate, blockers),
    },
  }
}

function containsForbidden(input: string, forbiddenTerms: string[]) {
  const normalized = input.toLocaleLowerCase("en-US")
  return forbiddenTerms.some((term) =>
    normalized.includes(term.toLocaleLowerCase("en-US"))
  )
}

export function generateCreativeBrief(input: {
  recommendation: StrategyRecommendation
  assessments: ScenarioAssessment[]
  evidence: ClassifiedEvidence[]
}): CreativeBrief {
  const assessment = input.assessments.find((entry) =>
    entry.scenario.id === input.recommendation.preferredScenarioId
  )
  if (!assessment) {
    return {
      status: "BLOCKED",
      sourceScenarioId: null,
      sourceStrategy: null,
      positioning: "NO_STRATEGY_AVAILABLE",
      heroComposition: "Human strategy selection required.",
      visualUnitCount: 0,
      visibleVariants: [],
      approvedCopy: [],
      approvedProof: [],
      omittedProof: [],
      prohibitedTerms: [],
      blockers: ["NO_SCENARIO_AVAILABLE"],
      canProduceAssets: false,
    }
  }

  const seed = assessment.scenario.creativeSeed
  const approvedProof: CreativeBrief["approvedProof"] = []
  const omittedProof: CreativeBrief["omittedProof"] = []
  for (const field of seed.proofEvidenceFields) {
    const observations = findEvidence(input.evidence, field)
    const approved = observations.find((entry) =>
      entry.usableAsProductFact &&
      !["MISSING", "CONFLICTED"].includes(entry.classification)
    )
    if (approved) {
      approvedProof.push({
        field,
        label: approved.label,
        normalizedValue: approved.normalizedValue,
        evidenceClass: approved.classification,
        sourceReference: approved.sourceReference,
      })
      continue
    }
    const reason = observations.some((entry) =>
      entry.classification === "CONFLICTED"
    )
      ? "CONFLICTED"
      : observations.some((entry) => entry.classification === "MISSING")
        ? "MISSING"
        : "NOT_PRODUCT_EVIDENCE"
    omittedProof.push({ field, reason })
  }

  const creativeRequirementsMissing = seed.requiredEvidence.flatMap(
    (requirement) => requirementBlockers(input.evidence, requirement),
  )
  const proposedCopy = [seed.positioning, seed.heroComposition]
  const copyViolations = proposedCopy.flatMap((copy) =>
    containsForbidden(copy, seed.forbiddenTerms)
      ? [`FORBIDDEN_TERM_IN_COPY:${copy}`]
      : []
  )
  const blockers = unique([
    ...creativeRequirementsMissing,
    ...copyViolations,
  ])

  return {
    status: blockers.length ? "BLOCKED" : "DRAFT",
    sourceScenarioId: assessment.scenario.id,
    sourceStrategy: assessment.candidateStrategy,
    positioning: seed.positioning,
    heroComposition: seed.heroComposition,
    visualUnitCount: assessment.scenario.packQuantity,
    visibleVariants: [...assessment.scenario.variantComposition],
    approvedCopy: blockers.length ? [] : proposedCopy,
    approvedProof,
    omittedProof,
    prohibitedTerms: [...seed.forbiddenTerms],
    blockers,
    canProduceAssets: false,
  }
}

function evidenceUsedByRequirement(
  evidence: ClassifiedEvidence[],
  requirement: EvidenceRequirement,
) {
  return findEvidence(evidence, requirement.field).filter((entry) =>
    requirement.acceptedEvidenceClasses.includes(entry.classification) &&
    entry.requiredFor?.includes(requirement.requiredPurpose) &&
    (!requirement.requireProductFact || entry.usableAsProductFact)
  )
}

function confidenceForRequiredProductEvidence(input: {
  dimension: "IDENTITY" | "COMPATIBILITY"
  evidence: ClassifiedEvidence[]
  requirements: EvidenceRequirement[]
}) {
  if (!input.requirements.length) {
    return {
      level: "LOW" as const,
      reasons: [`${input.dimension}_LOW:REQUIREMENTS_MISSING`],
    }
  }
  const allEntries = input.requirements.flatMap((requirement) =>
    findEvidence(input.evidence, requirement.field)
  )
  const checks = input.requirements.map((requirement) =>
    evaluateEvidenceRequirement(
      findEvidence(input.evidence, requirement.field),
      requirement,
    )
  )
  const weakClassification = allEntries.find((entry) =>
    ["MISSING", "CONFLICTED", "HUMAN_HYPOTHESIS"].includes(
      entry.classification,
    )
  )
  if (checks.some((check) => !check.satisfied) || weakClassification) {
    return {
      level: "LOW" as const,
      reasons: sortedUnique([
        `${input.dimension}_LOW:REQUIRED_EVIDENCE_INCOMPLETE`,
        ...checks.flatMap((check) => check.blockers.map((blocker) =>
          `${input.dimension}_REASON:${blocker}`
        )),
        ...(weakClassification
          ? [
              `${input.dimension}_REASON:${weakClassification.field}:${weakClassification.classification}`,
            ]
          : []),
      ]),
    }
  }

  const used = input.requirements.flatMap((requirement) =>
    evidenceUsedByRequirement(input.evidence, requirement)
  )
  const allVerified = used.length >= input.requirements.length &&
    used.every((entry) => entry.classification === "PRODUCT_VERIFIED")
  return allVerified
    ? {
        level: "HIGH" as const,
        reasons: [`${input.dimension}_HIGH:ALL_REQUIRED_FIELDS_PRODUCT_VERIFIED`],
      }
    : {
        level: "MEDIUM" as const,
        reasons: [
          `${input.dimension}_MEDIUM:ALLOWED_SUPPLIER_STATED_EVIDENCE`,
        ],
      }
}

export function calculateStrategyConfidence(input: {
  caseInput: StrategyLabCaseInput
  evidence: ClassifiedEvidence[]
  preferredAssessment: ScenarioAssessment | null
}): StrategyConfidence {
  const identity = confidenceForRequiredProductEvidence({
    dimension: "IDENTITY",
    evidence: input.evidence,
    requirements: input.caseInput.identityRequirements,
  })

  const compatibility = input.caseInput.compatibility?.required
    ? confidenceForRequiredProductEvidence({
        dimension: "COMPATIBILITY",
        evidence: input.evidence,
        requirements: input.caseInput.compatibility.requirements,
      })
    : {
        level: "NOT_APPLICABLE" as const,
        reasons: ["COMPATIBILITY_NOT_APPLICABLE:NO_HARD_GATE"],
      }

  const marketModel = input.preferredAssessment?.marketModel
  const completeSoldExact = marketModel
    ? Math.min(
        marketModel.soldExact.uniqueItemCount,
        marketModel.soldExact.priceSampleSize,
      )
    : 0
  const market = completeSoldExact >= 5 &&
      marketModel?.marketCeiling?.basis === "SOLD_EXACT_P75"
    ? {
        level: "HIGH" as const,
        reasons: [
          `MARKET_HIGH:COMPLETE_UNIQUE_SOLD_EXACT:${completeSoldExact}`,
        ],
      }
    : completeSoldExact >= 2 && completeSoldExact <= 4 &&
        marketModel?.marketCeiling?.basis === "SOLD_EXACT_P75"
      ? {
          level: "MEDIUM" as const,
          reasons: [
            `MARKET_MEDIUM:COMPLETE_UNIQUE_SOLD_EXACT:${completeSoldExact}`,
          ],
        }
      : {
          level: "LOW" as const,
          reasons: [
            completeSoldExact <= 1
              ? `MARKET_LOW:COMPLETE_UNIQUE_SOLD_EXACT:${completeSoldExact}`
              : "MARKET_LOW:SOLD_EXACT_CEILING_MISSING",
          ],
        }

  const economicsOutput = input.preferredAssessment?.economics
  const economicsComplete = Boolean(
    economicsOutput &&
    economicsOutput.productCost !== null &&
    economicsOutput.packagingCost !== null &&
    economicsOutput.outboundShippingCost !== null &&
    economicsOutput.investedCost !== null &&
    economicsOutput.costEvidenceIds.length >= 3,
  )
  const economicsEvidence = economicsOutput?.costEvidenceIds.flatMap((id) => {
    const entry = input.evidence.find((candidate) => candidate.id === id)
    return entry ? [entry] : []
  }) ?? []
  const economicsComponents = new Set<EconomicCostEvidence["component"]>(
    economicsEvidence.flatMap((entry) =>
      entry.economicCost ? [entry.economicCost.component] : []
    ),
  )
  const requiredEconomicsComponents: EconomicCostEvidence["component"][] = [
    "PRODUCT_UNIT_COST",
    "PACKAGING_COST",
    "OUTBOUND_SHIPPING_COST",
  ]
  const economicsRolesComplete = requiredEconomicsComponents.every(
    (component) => economicsComponents.has(component),
  )
  const economicsClassesAccepted = economicsEvidence.length > 0 &&
    economicsEvidence.every((entry) =>
      ACCEPTED_ECONOMICS_EVIDENCE_CLASSES.includes(entry.classification)
    )
  const economics = !economicsComplete || !economicsClassesAccepted ||
      !economicsRolesComplete
    ? {
        level: "LOW" as const,
        reasons: ["ECONOMICS_LOW:COST_EVIDENCE_INCOMPLETE_OR_INVALID"],
      }
    : economicsEvidence.every((entry) =>
        entry.classification === "PRODUCT_VERIFIED"
      )
      ? {
          level: "HIGH" as const,
          reasons: [
            "ECONOMICS_HIGH:ALL_COSTS_PRODUCT_VERIFIED_AND_CONCORDANT",
          ],
        }
      : {
          level: "MEDIUM" as const,
          reasons: [
            "ECONOMICS_MEDIUM:COMPLETE_VERIFIED_AND_SUPPLIER_STATED_COSTS",
          ],
        }

  const criticalLevels: ConfidenceLevel[] = [
    identity.level,
    market.level,
    economics.level,
    ...(compatibility.level === "NOT_APPLICABLE"
      ? []
      : [compatibility.level]),
  ]
  const strategy: ConfidenceLevel = criticalLevels.includes("LOW")
    ? "LOW"
    : criticalLevels.every((level) => level === "HIGH")
      ? "HIGH"
      : "MEDIUM"
  const strategyReason = strategy === "LOW"
    ? "STRATEGY_LOW:AT_LEAST_ONE_CRITICAL_DIMENSION_LOW"
    : strategy === "HIGH"
      ? "STRATEGY_HIGH:ALL_CRITICAL_DIMENSIONS_HIGH"
      : "STRATEGY_MEDIUM:CRITICAL_DIMENSIONS_COMPLETE_WITH_MIXED_CONFIDENCE"

  return {
    identity: identity.level,
    compatibility: compatibility.level,
    market: market.level,
    economics: economics.level,
    strategy,
    reasons: sortedUnique([
      ...identity.reasons,
      ...compatibility.reasons,
      ...market.reasons,
      ...economics.reasons,
      strategyReason,
    ]),
  }
}

export function evaluateStrategyLabCase(
  input: StrategyLabCaseInput,
): StrategyLabEvaluation {
  const evidence = classifyEvidenceSet(input.evidence)
  const validated = input.comparables.map(validateComparable)
  const deduplicated = deduplicateComparables(validated)
  const allComparables = [...deduplicated.kept, ...deduplicated.discarded]
  const { assessments, recommendation } = recommendStrategy({
    caseInput: input,
    evidence,
    comparables: allComparables,
  })
  const creativeBrief = generateCreativeBrief({
    recommendation,
    assessments,
    evidence,
  })
  const preferredAssessment = assessments.find((assessment) =>
    assessment.scenario.id === recommendation.preferredScenarioId
  ) ?? null
  const confidence = calculateStrategyConfidence({
    caseInput: input,
    evidence,
    preferredAssessment,
  })

  return {
    engineVersion: STRATEGY_LAB_ENGINE_VERSION,
    caseId: input.caseId,
    evaluatedAt: input.evaluatedAt,
    evidence,
    productFacts: evidence.filter((entry) => entry.usableAsProductFact),
    acceptedComparables: deduplicated.kept,
    rejectedComparables: deduplicated.discarded,
    cohorts: separateMarketCohorts(allComparables),
    scenarioAssessments: assessments,
    recommendation,
    creativeBrief,
    confidence,
    safety: {
      supabaseWrites: 0,
      ebayWrites: 0,
      openAiCalls: 0,
      whatsappCalls: 0,
      generatedImages: 0,
      listingChanges: 0,
    },
  }
}

function comparableHumanValue(value: unknown) {
  return Array.isArray(value)
    ? stableValue([...value].sort((left, right) =>
        String(left).localeCompare(String(right))
      ))
    : stableValue(value)
}

export function compareHumanConclusion(
  evaluation: StrategyLabEvaluation,
  expected: HumanConclusion,
): HumanComparison {
  const actual: HumanConclusion = {
    preferredScenario: evaluation.recommendation.preferredScenario,
    commercialDirection: evaluation.recommendation.commercialDirection,
    releaseGate: evaluation.recommendation.releaseGate,
    blockers: evaluation.recommendation.blockers,
    nextAction: evaluation.recommendation.nextAction,
    positioning: evaluation.creativeBrief.positioning,
  }
  const fields = Object.keys(expected) as Array<keyof HumanConclusion>
  const checks = fields.map((field) => {
    const osValue = actual[field]
    const humanValue = expected[field]
    return {
      field,
      osValue,
      humanValue,
      status: comparableHumanValue(osValue) === comparableHumanValue(humanValue)
        ? "MATCH" as const
        : "DIFF" as const,
    }
  })
  const differences = checks
    .filter((check) => check.status === "DIFF")
    .map(({ field, osValue, humanValue }) => ({
      field,
      osValue,
      humanValue,
    }))

  return {
    agreement: differences.length === 0
      ? "MATCH"
      : differences.length === checks.length
        ? "DIFFERENT"
        : "PARTIAL",
    checks,
    differences,
  }
}
