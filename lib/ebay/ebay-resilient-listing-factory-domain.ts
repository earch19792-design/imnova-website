import { createHash, randomUUID } from "node:crypto"

export const FACTORY_POLICY_VERSION = "EBAY_LISTING_FACTORY_V1"

export const FACTORY_MAIN_STATES = [
  "QUEUED",
  "CLAIMED",
  "MARKET_RESEARCH",
  "IDENTITY_VERIFIED",
  "SUPPLY_VERIFIED",
  "DEMAND_VALIDATED",
  "ECONOMICS_PASSED",
  "CATEGORY_AND_COMPLIANCE_PASSED",
  "LISTING_INTELLIGENCE_READY",
  "VISUAL_PACKAGE_READY",
  "FINAL_QA_PASSED",
  "DRAFT_READY",
  "APPROVED_TO_PUBLISH",
  "PUBLISHING",
  "PUBLISHED",
  "POST_PUBLISH_VERIFIED",
  "COMMERCIAL_MONITORING",
] as const

export const FACTORY_SIDE_STATES = [
  "WAITING_EXTERNAL_DEPENDENCY",
  "RETRY_SCHEDULED",
  "BLOCKED_MISSING_EVIDENCE",
  "HOLD_BUSINESS_RULE",
  "STOCK_HOLD",
  "MARGIN_HOLD",
  "COMPLIANCE_HOLD",
  "IDENTITY_HOLD",
  "QUARANTINED_UNKNOWN_ERROR",
  "REJECTED_TERMINAL",
  "CANCELLED",
] as const

export const FACTORY_STATES = [
  ...FACTORY_MAIN_STATES,
  ...FACTORY_SIDE_STATES,
] as const

export type FactoryState = (typeof FACTORY_STATES)[number]

export const FACTORY_BATCH_STATUSES = [
  "ACTIVE",
  "COMPLETED",
  "COMPLETED_WITH_HOLDS",
  "COMPLETED_WITH_QUARANTINE",
  "PARTIAL_SUCCESS",
  "PAUSED_BY_GLOBAL_DEPENDENCY",
] as const

export type FactoryBatchStatus = (typeof FACTORY_BATCH_STATUSES)[number]

export type CommercialEvidenceClass =
  | "SOLD_CONFIRMED"
  | "SOLD_ESTIMATED"
  | "ACTIVE_ONLY"
  | "INSUFFICIENT_EVIDENCE"

export type FactoryPolicy = {
  version: string
  mode: "DRY_RUN" | "DRAFT_ONLY" | "SUPERVISED_CANARY" | "AUTOMATIC_POLICY"
  batchSize: 5
  maxConcurrentProducts: 5
  reserveEnabled: boolean
  maximumProductAttempts: number
  externalWritesAllowed: boolean
  automaticPublishAllowed: boolean
  killSwitchEngaged: boolean
  economics: {
    source: "EBAY_UNIT_ECONOMICS_CANONICAL"
    minimumNetProfitUsd: number
    targetNetProfitUsd: number
    minimumRoiPercent: number
    minimumMarginPercent: number
  }
  visual: {
    strategy: "VISUAL_STRATEGY_V3"
    requiredImages: 7
  }
}

/*
 * This is the fail-closed bootstrap policy. Persisted account policy is the
 * authority. Economics are evaluated by ebay-unit-economics; this module only
 * verifies its signed snapshot and never implements a second fee engine.
 */
export const SAFE_FACTORY_POLICY: Readonly<FactoryPolicy> = Object.freeze<FactoryPolicy>({
  version: FACTORY_POLICY_VERSION,
  mode: "DRY_RUN",
  batchSize: 5,
  maxConcurrentProducts: 5,
  reserveEnabled: true,
  maximumProductAttempts: 4,
  externalWritesAllowed: false,
  automaticPublishAllowed: false,
  killSwitchEngaged: true,
  economics: {
    source: "EBAY_UNIT_ECONOMICS_CANONICAL",
    minimumNetProfitUsd: 5,
    targetNetProfitUsd: 7,
    minimumRoiPercent: 30,
    minimumMarginPercent: 20,
  },
  visual: {
    strategy: "VISUAL_STRATEGY_V3",
    requiredImages: 7,
  },
})

export type TraceabilityReference = {
  field: string
  source: string
  observedAt: string
  freshness: "FRESH" | "STALE" | "UNKNOWN"
  confidence: number
  evidenceRef: string
  normalizationVersion: string
  decisionRef: string
}

export type ListingFactoryDossier = {
  productId: string
  marketRadarProductId: string
  sku: string
  version: number
  identity: {
    exactMatch: boolean
    supplierSku: string
    brand: string | null
    model: string | null
    variant: string | null
    color: string | null
    size: string | null
    condition: string | null
    packCount: number | null
    identifiers: Record<string, string | null>
    confidence: number
    verificationMethod: string
  }
  supplier: {
    sourceKind: "AUTHORIZED_SUPPLIER" | "UNKNOWN" | "FIXTURE"
    source: string
    isFixture: boolean
    costUsd: number | null
    stock: number | null
    available: boolean | null
    observedAt: string
    fresh: boolean
    weightKnown: boolean
    dimensionsKnown: boolean
    exactPackageKnown: boolean
    imageRightsVerified: boolean
  }
  market: {
    marketplace: "EBAY_US"
    evidenceClass: CommercialEvidenceClass
    confirmedSales: number
    activeListings: number
    comparables: FactoryComparable[]
    observedAt: string
    fresh: boolean
  }
  economics: {
    source: "EBAY_UNIT_ECONOMICS_CANONICAL" | "UNKNOWN"
    policyVersion: string
    costsComplete: boolean
    recommendedPriceUsd: number | null
    landedPriceUsd: number | null
    safeFloorUsd: number | null
    netProfitUsd: number | null
    marginPercent: number | null
    roiPercent: number | null
    passesCanonicalPolicy: boolean
  }
  listing: {
    categoryOfficial: boolean
    categoryId: string | null
    requiredAspectsComplete: boolean
    titleVerified: boolean
    descriptionVerified: boolean
    claimsVerified: boolean
    intellectualPropertyAllowed: boolean
    policiesComplete: boolean
    merchantLocationResolved: boolean
    quantity: number | null
    noSkuCollision: boolean
    payloadFrozen: boolean
    payloadHash: string | null
  }
  visual: {
    strategy: string
    immutableManifest: boolean
    exactIdentityPreserved: boolean
    approvedImageCount: number
    mainImageApproved: boolean
    secondaryImagesApproved: number
    referencesRecorded: boolean
    promptsRecorded: boolean
    hashesRecorded: boolean
  }
  runtime: {
    accountBound: boolean
    marketplaceBound: boolean
    credentialsAvailable: boolean
    quotasAvailable: boolean
    ledgerPrepared: boolean
    preflightFresh: boolean
  }
  traceability: TraceabilityReference[]
}

export type FactoryComparable = {
  id: string
  evidenceClass: CommercialEvidenceClass
  comparabilityScore: number
  itemPriceUsd: number
  mandatoryShippingUsd: number
  marketplace: string
  conditionMatches: boolean
  packMatches: boolean
  variantMatches: boolean
  identityMatches: boolean
}

export type DossierGateResult = {
  draftReady: boolean
  publishReady: boolean
  blockers: string[]
  publishBlockers: string[]
}

export type FactoryErrorClass =
  | "PRODUCT_TRANSIENT"
  | "RATE_LIMIT"
  | "MISSING_EVIDENCE"
  | "BUSINESS_RULE"
  | "COMPLIANCE_OR_IDENTITY"
  | "UNKNOWN_PRODUCT"
  | "GLOBAL_AUTH"
  | "GLOBAL_PROVIDER"
  | "UNCERTAIN_EXTERNAL_OUTCOME"
  | "TERMINAL"

export type FactoryErrorDisposition = {
  category: FactoryErrorClass
  nextState: FactoryState
  globalDependency: boolean
  retryable: boolean
  requiresReconciliation: boolean
  maximumAttempts: number
}

export type FactoryFault = {
  code: string
  dependency?: "EBAY" | "LUNA" | "OPENAI" | "SUPABASE" | "UNKNOWN"
  httpStatus?: number
  unexpected?: boolean
  outcomeUncertain?: boolean
}

export type FactorySimulationCandidate = {
  id: string
  sku: string
  dossier: ListingFactoryDossier
  resumeFrom?: FactoryState
  fault?: FactoryFault & { atState: FactoryState }
  finalized?: boolean
}

export type FactoryTransition = {
  candidateId: string
  previousState: FactoryState
  nextState: FactoryState
  reason: string
  checkpoint: FactoryState
  at: string
}

export type FactoryCandidateSimulationResult = {
  candidateId: string
  sku: string
  slot: number
  replacementFor: string | null
  finalState: FactoryState
  transitions: FactoryTransition[]
  attempts: number
  quarantined: boolean
  globalDependencyPaused: boolean
  externalWrites: 0
}

export type FactoryBatchSimulationResult = {
  runId: string
  status: FactoryBatchStatus
  selected: number
  processed: number
  completed: number
  quarantined: number
  holds: number
  replacements: number
  externalWrites: 0
  results: FactoryCandidateSimulationResult[]
}

const MAIN_INDEX = new Map<FactoryState, number>(
  FACTORY_MAIN_STATES.map((state, index) => [state, index]),
)

const HOLD_STATES = new Set<FactoryState>([
  "BLOCKED_MISSING_EVIDENCE",
  "HOLD_BUSINESS_RULE",
  "STOCK_HOLD",
  "MARGIN_HOLD",
  "COMPLIANCE_HOLD",
  "IDENTITY_HOLD",
])

const FINALIZED_STATES = new Set<FactoryState>([
  "POST_PUBLISH_VERIFIED",
  "COMMERCIAL_MONITORING",
  "REJECTED_TERMINAL",
  "CANCELLED",
])

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function sha256Hex(value: unknown): string {
  return createHash("sha256").update(
    typeof value === "string" ? value : stableJson(value),
  ).digest("hex")
}

export function buildEffectIdempotencyKey(input: {
  marketplaceAccountKey: string
  marketplace: string
  productId: string
  sku: string
  generation: number
  action: string
  dossierVersion: number
  payloadHash: string
}): string {
  return sha256Hex({
    namespace: "IMNOVA_EBAY_LISTING_FACTORY_EFFECT_V1",
    ...input,
  })
}

export function mapLegacyMachineState(machineState: string): FactoryState {
  const mapping: Record<string, FactoryState> = {
    RUN_CREATED: "QUEUED",
    LOCAL_FILTERING: "MARKET_RESEARCH",
    CANDIDATE_SELECTION: "MARKET_RESEARCH",
    PRODUCT_RESEARCH_PLAN_READY: "MARKET_RESEARCH",
    WAITING_PRODUCT_RESEARCH_CAPTURE: "WAITING_EXTERNAL_DEPENDENCY",
    IMPORTING_SOLD_EVIDENCE: "MARKET_RESEARCH",
    RECONCILING_IDENTITY: "MARKET_RESEARCH",
    MATCHING_LUNA: "IDENTITY_VERIFIED",
    RUNNING_LOOP_1: "DEMAND_VALIDATED",
    CALCULATING_ECONOMICS: "DEMAND_VALIDATED",
    WAITING_LUNA_CONFIRMATION: "BLOCKED_MISSING_EVIDENCE",
    ENRICHING_PRODUCT_FACTS: "SUPPLY_VERIFIED",
    VALIDATING_TAXONOMY: "ECONOMICS_PASSED",
    VALIDATING_REGULATION: "CATEGORY_AND_COMPLIANCE_PASSED",
    BUILDING_OPENAI_INPUT: "LISTING_INTELLIGENCE_READY",
    WAITING_PRODUCT_APPROVAL: "HOLD_BUSINESS_RULE",
    GENERATING_LISTING_CONTENT: "LISTING_INTELLIGENCE_READY",
    VALIDATING_LISTING_CONTENT: "LISTING_INTELLIGENCE_READY",
    PREPARING_IMAGE_PACKAGE: "LISTING_INTELLIGENCE_READY",
    WAITING_IMAGE_APPROVAL: "HOLD_BUSINESS_RULE",
    BUILDING_SELLER_HUB_HANDOFF: "FINAL_QA_PASSED",
    READY_FOR_MANUAL_PUBLICATION: "DRAFT_READY",
    WAITING_ITEM_ID: "PUBLISHING",
    VERIFYING_PUBLISHED_LISTING: "PUBLISHED",
    REGISTERING_COMMERCIAL_MONITOR: "POST_PUBLISH_VERIFIED",
    VERIFIED_ACTIVE: "COMMERCIAL_MONITORING",
    BLOCKED: "HOLD_BUSINESS_RULE",
    REJECTED: "REJECTED_TERMINAL",
    COMPLETED: "COMMERCIAL_MONITORING",
  }
  return mapping[machineState] ?? "QUEUED"
}

export function canTransitionFactoryState(
  previousState: FactoryState,
  nextState: FactoryState,
  reasonCode = "",
): boolean {
  if (previousState === nextState) return true
  if (FINALIZED_STATES.has(previousState)) return false

  const previousIndex = MAIN_INDEX.get(previousState)
  const nextIndex = MAIN_INDEX.get(nextState)
  if (previousIndex !== undefined && nextIndex === previousIndex + 1) return true

  if (nextState === "WAITING_EXTERNAL_DEPENDENCY" ||
    nextState === "RETRY_SCHEDULED" ||
    nextState === "BLOCKED_MISSING_EVIDENCE" ||
    nextState === "HOLD_BUSINESS_RULE" ||
    nextState === "STOCK_HOLD" ||
    nextState === "MARGIN_HOLD" ||
    nextState === "COMPLIANCE_HOLD" ||
    nextState === "IDENTITY_HOLD" ||
    nextState === "QUARANTINED_UNKNOWN_ERROR" ||
    nextState === "REJECTED_TERMINAL" ||
    nextState === "CANCELLED") {
    return true
  }

  if (reasonCode === "REPLAY_FROM_LAST_CHECKPOINT" &&
    previousState === "QUARANTINED_UNKNOWN_ERROR" &&
    nextIndex !== undefined &&
    nextIndex <= MAIN_INDEX.get("DRAFT_READY")!) {
    return true
  }

  return false
}

export function validateDossier(
  dossier: ListingFactoryDossier,
  policy: FactoryPolicy = SAFE_FACTORY_POLICY,
): DossierGateResult {
  const blockers: string[] = []
  const publishBlockers: string[] = []
  const add = (condition: boolean, code: string) => {
    if (!condition) blockers.push(code)
  }

  add(Boolean(dossier.productId && dossier.marketRadarProductId && dossier.sku),
    "IDENTITY_ANCHORS_MISSING")
  add(dossier.identity.exactMatch, "IDENTITY_EXACT_MATCH_REQUIRED")
  add(dossier.identity.packCount !== null && dossier.identity.packCount > 0,
    "PACK_IDENTITY_REQUIRED")
  add(Boolean(dossier.identity.condition), "CONDITION_REQUIRED")
  add(dossier.identity.confidence >= 85, "IDENTITY_CONFIDENCE_TOO_LOW")
  add(dossier.supplier.sourceKind === "AUTHORIZED_SUPPLIER" &&
    !dossier.supplier.isFixture, "AUTHORIZED_SUPPLIER_REQUIRED")
  add(dossier.supplier.costUsd !== null && dossier.supplier.costUsd >= 0,
    "CURRENT_COST_REQUIRED")
  add(dossier.supplier.available === true &&
    dossier.supplier.stock !== null && dossier.supplier.stock > 0,
  "POSITIVE_STOCK_REQUIRED")
  add(dossier.supplier.fresh, "SUPPLIER_EVIDENCE_STALE")
  add(dossier.supplier.weightKnown && dossier.supplier.dimensionsKnown,
    "PACKAGE_MEASUREMENTS_REQUIRED")
  add(dossier.supplier.exactPackageKnown, "PACKAGE_CONTENTS_REQUIRED")
  add(dossier.supplier.imageRightsVerified, "IMAGE_RIGHTS_REQUIRED")

  add(dossier.economics.source === "EBAY_UNIT_ECONOMICS_CANONICAL",
    "CANONICAL_ECONOMICS_REQUIRED")
  add(dossier.economics.costsComplete, "ECONOMIC_COSTS_INCOMPLETE")
  add(dossier.economics.passesCanonicalPolicy, "CANONICAL_ECONOMICS_FAILED")
  add(dossier.economics.netProfitUsd !== null &&
    dossier.economics.netProfitUsd >= policy.economics.minimumNetProfitUsd,
  "MINIMUM_NET_PROFIT_FAILED")
  add(dossier.economics.marginPercent !== null &&
    dossier.economics.marginPercent >= policy.economics.minimumMarginPercent,
  "MINIMUM_MARGIN_FAILED")
  add(dossier.economics.roiPercent !== null &&
    dossier.economics.roiPercent >= policy.economics.minimumRoiPercent,
  "MINIMUM_ROI_FAILED")
  add(dossier.economics.recommendedPriceUsd !== null &&
    dossier.economics.safeFloorUsd !== null &&
    dossier.economics.recommendedPriceUsd >= dossier.economics.safeFloorUsd,
  "SAFE_PRICE_FLOOR_FAILED")

  add(dossier.listing.categoryOfficial && Boolean(dossier.listing.categoryId),
    "OFFICIAL_CATEGORY_REQUIRED")
  add(dossier.listing.requiredAspectsComplete, "REQUIRED_ASPECTS_INCOMPLETE")
  add(dossier.listing.titleVerified && dossier.listing.descriptionVerified,
    "LISTING_CONTENT_UNVERIFIED")
  add(dossier.listing.claimsVerified, "UNVERIFIED_CLAIM")
  add(dossier.listing.intellectualPropertyAllowed, "IP_COMPLIANCE_FAILED")
  add(dossier.listing.policiesComplete &&
    dossier.listing.merchantLocationResolved, "SELLER_POLICIES_INCOMPLETE")
  add(dossier.listing.quantity !== null && dossier.listing.quantity > 0,
    "SAFE_INITIAL_QUANTITY_REQUIRED")
  add(dossier.listing.noSkuCollision, "SKU_OR_OFFER_COLLISION")
  add(dossier.listing.payloadFrozen &&
    Boolean(dossier.listing.payloadHash?.match(/^[0-9a-f]{64}$/)),
  "FROZEN_PAYLOAD_REQUIRED")

  add(dossier.visual.strategy === policy.visual.strategy,
    "VISUAL_STRATEGY_V3_REQUIRED")
  add(dossier.visual.immutableManifest, "VISUAL_MANIFEST_NOT_IMMUTABLE")
  add(dossier.visual.exactIdentityPreserved, "VISUAL_IDENTITY_MISMATCH")
  add(dossier.visual.approvedImageCount === policy.visual.requiredImages &&
    dossier.visual.mainImageApproved &&
    dossier.visual.secondaryImagesApproved === policy.visual.requiredImages - 1,
  "SEVEN_APPROVED_IMAGES_REQUIRED")
  add(dossier.visual.referencesRecorded && dossier.visual.promptsRecorded &&
    dossier.visual.hashesRecorded, "VISUAL_TRACEABILITY_INCOMPLETE")
  add(hasCriticalFieldTraceability(dossier), "CRITICAL_FIELD_TRACEABILITY_INCOMPLETE")

  if (!dossier.runtime.accountBound) publishBlockers.push("ACCOUNT_NOT_BOUND")
  if (!dossier.runtime.marketplaceBound) publishBlockers.push("MARKETPLACE_NOT_BOUND")
  if (!dossier.runtime.credentialsAvailable) publishBlockers.push("CREDENTIALS_UNAVAILABLE")
  if (!dossier.runtime.quotasAvailable) publishBlockers.push("RATE_LIMIT_UNAVAILABLE")
  if (!dossier.runtime.ledgerPrepared) publishBlockers.push("PUBLICATION_LEDGER_NOT_PREPARED")
  if (!dossier.runtime.preflightFresh) publishBlockers.push("FINAL_PREFLIGHT_STALE")
  if (!policy.externalWritesAllowed) publishBlockers.push("EXTERNAL_WRITES_DISABLED")
  if (!policy.automaticPublishAllowed) publishBlockers.push("AUTOMATIC_PUBLISH_DISABLED")
  if (policy.killSwitchEngaged) publishBlockers.push("KILL_SWITCH_ENGAGED")
  if (policy.mode === "DRY_RUN") publishBlockers.push("DRY_RUN_MODE")

  return {
    draftReady: blockers.length === 0,
    publishReady: blockers.length === 0 && publishBlockers.length === 0,
    blockers,
    publishBlockers,
  }
}

export function hasCriticalFieldTraceability(
  dossier: ListingFactoryDossier,
): boolean {
  const required = new Set([
    "identity",
    "supplier.costUsd",
    "supplier.stock",
    "economics.recommendedPriceUsd",
    "listing.categoryId",
    "listing.title",
    "listing.payloadHash",
    "visual.main",
  ])
  for (const entry of dossier.traceability) {
    if (entry.source && entry.evidenceRef && entry.decisionRef &&
      entry.confidence >= 0 && entry.confidence <= 100) {
      required.delete(entry.field)
    }
  }
  return required.size === 0
}

export function selectPriceComparables(
  comparables: FactoryComparable[],
): Array<FactoryComparable & { landedPriceUsd: number }> {
  return comparables
    .filter((row) =>
      row.evidenceClass === "SOLD_CONFIRMED" &&
      row.comparabilityScore >= 85 &&
      row.marketplace === "EBAY_US" &&
      row.conditionMatches &&
      row.packMatches &&
      row.variantMatches &&
      row.identityMatches)
    .map((row) => ({
      ...row,
      landedPriceUsd: Number((row.itemPriceUsd + row.mandatoryShippingUsd).toFixed(2)),
    }))
}

export function evaluateCommercialSignal(input: {
  evidenceClass: CommercialEvidenceClass
  confirmedSales: number
  strongComparables: number
  economicsPassed: boolean
}): {
  decision: "OBSERVE" | "INVESTIGATE" | "PROPOSE"
  priceChangeAllowed: boolean
  promotionAllowed: boolean
  reason: string
} {
  if (input.evidenceClass === "ACTIVE_ONLY" || input.confirmedSales === 0) {
    return {
      decision: "OBSERVE",
      priceChangeAllowed: false,
      promotionAllowed: false,
      reason: "ACTIVE_ONLY_WITHOUT_CONFIRMED_SALES",
    }
  }
  if (input.evidenceClass !== "SOLD_CONFIRMED" ||
    input.strongComparables < 2 || !input.economicsPassed) {
    return {
      decision: "INVESTIGATE",
      priceChangeAllowed: false,
      promotionAllowed: false,
      reason: "EVIDENCE_OR_ECONOMICS_INCOMPLETE",
    }
  }
  return {
    decision: "PROPOSE",
    priceChangeAllowed: true,
    promotionAllowed: true,
    reason: "CONFIRMED_SALES_AND_PROTECTED_ECONOMICS",
  }
}

export function classifyFactoryError(fault: FactoryFault): FactoryErrorDisposition {
  const code = fault.code.toUpperCase()
  if (fault.outcomeUncertain || code.includes("TIMEOUT_AFTER_SEND") ||
    code.includes("UNKNOWN_OUTCOME")) {
    return {
      category: "UNCERTAIN_EXTERNAL_OUTCOME",
      nextState: "WAITING_EXTERNAL_DEPENDENCY",
      globalDependency: false,
      retryable: false,
      requiresReconciliation: true,
      maximumAttempts: 1,
    }
  }
  if (fault.dependency === "EBAY" &&
    (fault.httpStatus === 401 || fault.httpStatus === 403 ||
      code.includes("AUTH") || code.includes("TOKEN"))) {
    return {
      category: "GLOBAL_AUTH",
      nextState: "WAITING_EXTERNAL_DEPENDENCY",
      globalDependency: true,
      retryable: false,
      requiresReconciliation: false,
      maximumAttempts: 1,
    }
  }
  if ((fault.dependency === "LUNA" || fault.dependency === "OPENAI") &&
    (fault.httpStatus === 502 || fault.httpStatus === 503 ||
      code.includes("DEPENDENCY_DOWN"))) {
    return {
      category: "GLOBAL_PROVIDER",
      nextState: "WAITING_EXTERNAL_DEPENDENCY",
      globalDependency: true,
      retryable: true,
      requiresReconciliation: false,
      maximumAttempts: 4,
    }
  }
  if (fault.httpStatus === 429 || code.includes("RATE_LIMIT")) {
    return {
      category: "RATE_LIMIT",
      nextState: "RETRY_SCHEDULED",
      globalDependency: true,
      retryable: true,
      requiresReconciliation: false,
      maximumAttempts: 4,
    }
  }
  if (code.includes("MISSING") || code.includes("INCOMPLETE") ||
    code.includes("STALE_EVIDENCE")) {
    return {
      category: "MISSING_EVIDENCE",
      nextState: "BLOCKED_MISSING_EVIDENCE",
      globalDependency: false,
      retryable: false,
      requiresReconciliation: false,
      maximumAttempts: 1,
    }
  }
  if (code.includes("MARGIN") || code.includes("STOCK") ||
    code.includes("BUSINESS_RULE")) {
    return {
      category: "BUSINESS_RULE",
      nextState: code.includes("STOCK") ? "STOCK_HOLD" : "MARGIN_HOLD",
      globalDependency: false,
      retryable: false,
      requiresReconciliation: false,
      maximumAttempts: 1,
    }
  }
  if (code.includes("IDENTITY") || code.includes("COMPLIANCE") ||
    code.includes("TRADEMARK") || code.includes("CLAIM")) {
    return {
      category: "COMPLIANCE_OR_IDENTITY",
      nextState: code.includes("IDENTITY") ? "IDENTITY_HOLD" : "COMPLIANCE_HOLD",
      globalDependency: false,
      retryable: false,
      requiresReconciliation: false,
      maximumAttempts: 1,
    }
  }
  if (code.includes("TERMINAL") || fault.httpStatus === 400) {
    return {
      category: "TERMINAL",
      nextState: "REJECTED_TERMINAL",
      globalDependency: false,
      retryable: false,
      requiresReconciliation: false,
      maximumAttempts: 1,
    }
  }
  if (!fault.unexpected &&
    (fault.httpStatus === 408 || fault.httpStatus === 500 ||
      fault.httpStatus === 502 || fault.httpStatus === 503 ||
      code.includes("TRANSIENT"))) {
    return {
      category: "PRODUCT_TRANSIENT",
      nextState: "RETRY_SCHEDULED",
      globalDependency: false,
      retryable: true,
      requiresReconciliation: false,
      maximumAttempts: 4,
    }
  }
  return {
    category: "UNKNOWN_PRODUCT",
    nextState: "QUARANTINED_UNKNOWN_ERROR",
    globalDependency: false,
    retryable: false,
    requiresReconciliation: false,
    maximumAttempts: 1,
  }
}

export function sanitizedErrorMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? "")
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[REDACTED_PHONE]")
    .replace(/\b(?:access|refresh|client|app)[_-]?token\s*[:=]\s*\S+/gi,
      "token=[REDACTED]")
    .slice(0, 500)
}

export function errorFingerprint(fault: FactoryFault): string {
  const disposition = classifyFactoryError(fault)
  return sha256Hex({
    version: "FACTORY_ERROR_FINGERPRINT_V1",
    category: disposition.category,
    dependency: fault.dependency ?? "UNKNOWN",
    code: fault.code.toUpperCase().replace(/[0-9a-f]{8,}/g, "[ID]"),
    httpStatus: fault.httpStatus ?? null,
  })
}

export function reconcileExternalPublication(input: {
  sent: boolean
  responseTimedOut: boolean
  remoteFound: boolean
  expectedSku: string
  remoteSku: string | null
  expectedPayloadHash: string
  remotePayloadHash: string | null
  offerId: string | null
  listingId: string | null
}): {
  status: "RECONCILED" | "SAFE_TO_RETRY" | "UNKNOWN_OUTCOME" | "CONFIRMED"
  blindRetryAllowed: boolean
} {
  if (!input.sent) {
    return { status: "SAFE_TO_RETRY", blindRetryAllowed: true }
  }
  const exactRemoteMatch = input.remoteFound &&
    input.remoteSku === input.expectedSku &&
    input.remotePayloadHash === input.expectedPayloadHash &&
    Boolean(input.offerId || input.listingId)
  if (exactRemoteMatch) {
    return {
      status: input.responseTimedOut ? "RECONCILED" : "CONFIRMED",
      blindRetryAllowed: false,
    }
  }
  return { status: "UNKNOWN_OUTCOME", blindRetryAllowed: false }
}

export function detectMaterialDrift(input: {
  previousStock: number | null
  currentStock: number | null
  previousCostUsd: number | null
  currentCostUsd: number | null
  previousImageHash: string | null
  currentImageHash: string | null
  economicsStillPass: boolean
}): { invalidated: boolean; state: FactoryState | null; reasons: string[] } {
  const reasons: string[] = []
  let state: FactoryState | null = null
  if (input.currentStock === null || input.currentStock <= 0 ||
    input.previousStock !== input.currentStock) {
    reasons.push("SUPPLIER_STOCK_CHANGED")
    state = "STOCK_HOLD"
  }
  if (input.previousCostUsd !== input.currentCostUsd) {
    reasons.push("SUPPLIER_COST_CHANGED")
    if (!input.economicsStillPass) state = "MARGIN_HOLD"
  }
  if (input.previousImageHash !== input.currentImageHash) {
    reasons.push("REFERENCE_IMAGE_CHANGED")
    state ??= "HOLD_BUSINESS_RULE"
  }
  return { invalidated: reasons.length > 0, state, reasons }
}

export class InMemoryClaimLedger {
  private readonly claims = new Map<string, { worker: string; token: string }>()
  private readonly completed = new Set<string>()

  claim(idempotencyKey: string, worker: string): string | null {
    if (this.completed.has(idempotencyKey) || this.claims.has(idempotencyKey)) return null
    const token = randomUUID()
    this.claims.set(idempotencyKey, { worker, token })
    return token
  }

  complete(idempotencyKey: string, worker: string, token: string): boolean {
    const claim = this.claims.get(idempotencyKey)
    if (!claim || claim.worker !== worker || claim.token !== token) return false
    this.claims.delete(idempotencyKey)
    this.completed.add(idempotencyKey)
    return true
  }

  isCompleted(idempotencyKey: string): boolean {
    return this.completed.has(idempotencyKey)
  }
}

export class InMemoryCircuitBreaker {
  private readonly states = new Map<string, {
    status: "CLOSED" | "OPEN" | "HALF_OPEN"
    failures: number
  }>()

  recordFailure(dependency: string, globalDependency: boolean): void {
    if (!globalDependency) return
    const prior = this.states.get(dependency) ?? { status: "CLOSED" as const, failures: 0 }
    this.states.set(dependency, { status: "OPEN", failures: prior.failures + 1 })
  }

  halfOpen(dependency: string): void {
    const prior = this.states.get(dependency)
    if (prior?.status === "OPEN") {
      this.states.set(dependency, { ...prior, status: "HALF_OPEN" })
    }
  }

  recover(dependency: string): void {
    this.states.set(dependency, { status: "CLOSED", failures: 0 })
  }

  status(dependency: string): "CLOSED" | "OPEN" | "HALF_OPEN" {
    return this.states.get(dependency)?.status ?? "CLOSED"
  }
}

export function selectUniqueBatchCandidates<T extends {
  id: string
  sku: string
  productId?: string
}>(candidates: T[], previouslyUsed = new Set<string>()): T[] {
  const selected: T[] = []
  const seen = new Set(previouslyUsed)
  for (const candidate of candidates) {
    const identities = [candidate.id, candidate.sku, candidate.productId ?? ""]
    if (identities.some((value) => value && seen.has(value))) continue
    selected.push(candidate)
    identities.forEach((value) => value && seen.add(value))
    if (selected.length === 5) break
  }
  return selected
}

function candidateSuccessState(state: FactoryState): boolean {
  return state === "DRAFT_READY" || state === "COMMERCIAL_MONITORING"
}

async function simulateCandidate(input: {
  candidate: FactorySimulationCandidate
  slot: number
  replacementFor?: string | null
  policy: FactoryPolicy
}): Promise<FactoryCandidateSimulationResult> {
  const { candidate, slot, policy } = input
  if (candidate.finalized && candidate.resumeFrom &&
    candidate.resumeFrom !== "COMMERCIAL_MONITORING") {
    throw new Error("FINALIZED_LISTING_CANNOT_BE_RESURRECTED")
  }
  const transitions: FactoryTransition[] = []
  let current = candidate.resumeFrom ?? "QUEUED"
  let attempts = 0
  const startIndex = MAIN_INDEX.get(current) ?? 0
  const finalTarget = policy.mode === "DRY_RUN"
    ? MAIN_INDEX.get("DRAFT_READY")!
    : MAIN_INDEX.get("COMMERCIAL_MONITORING")!

  for (let index = startIndex + 1; index <= finalTarget; index += 1) {
    const next = FACTORY_MAIN_STATES[index]
    if (!next) break
    attempts += 1

    if (candidate.fault?.atState === next) {
      const disposition = classifyFactoryError(candidate.fault)
      transitions.push({
        candidateId: candidate.id,
        previousState: current,
        nextState: disposition.nextState,
        reason: candidate.fault.code,
        checkpoint: current,
        at: new Date().toISOString(),
      })
      return {
        candidateId: candidate.id,
        sku: candidate.sku,
        slot,
        replacementFor: input.replacementFor ?? null,
        finalState: disposition.nextState,
        transitions,
        attempts,
        quarantined: disposition.nextState === "QUARANTINED_UNKNOWN_ERROR",
        globalDependencyPaused: disposition.globalDependency,
        externalWrites: 0,
      }
    }

    if (next === "FINAL_QA_PASSED") {
      const gate = validateDossier(candidate.dossier, policy)
      if (!gate.draftReady) {
        const failureState: FactoryState = gate.blockers.some((code) =>
          code.includes("STOCK")) ? "STOCK_HOLD"
          : gate.blockers.some((code) => code.includes("MARGIN") ||
            code.includes("PROFIT") || code.includes("ROI") ||
            code.includes("PRICE_FLOOR")) ? "MARGIN_HOLD"
            : gate.blockers.some((code) => code.includes("IDENTITY") ||
              code.includes("PACK")) ? "IDENTITY_HOLD"
              : gate.blockers.some((code) => code.includes("COMPLIANCE") ||
                code.includes("CLAIM") || code.includes("IP_"))
                ? "COMPLIANCE_HOLD"
                : "BLOCKED_MISSING_EVIDENCE"
        transitions.push({
          candidateId: candidate.id,
          previousState: current,
          nextState: failureState,
          reason: gate.blockers.join(","),
          checkpoint: current,
          at: new Date().toISOString(),
        })
        return {
          candidateId: candidate.id,
          sku: candidate.sku,
          slot,
          replacementFor: input.replacementFor ?? null,
          finalState: failureState,
          transitions,
          attempts,
          quarantined: false,
          globalDependencyPaused: false,
          externalWrites: 0,
        }
      }
    }

    if (!canTransitionFactoryState(current, next)) {
      throw new Error(`INVALID_FACTORY_TRANSITION:${current}:${next}`)
    }
    transitions.push({
      candidateId: candidate.id,
      previousState: current,
      nextState: next,
      reason: "DRY_RUN_GATE_PASSED",
      checkpoint: next,
      at: new Date().toISOString(),
    })
    current = next
    await Promise.resolve()
  }

  return {
    candidateId: candidate.id,
    sku: candidate.sku,
    slot,
    replacementFor: input.replacementFor ?? null,
    finalState: current,
    transitions,
    attempts,
    quarantined: false,
    globalDependencyPaused: false,
    externalWrites: 0,
  }
}

export async function runResilientBatchDryRun(input: {
  candidates: FactorySimulationCandidate[]
  reserves?: FactorySimulationCandidate[]
  policy?: FactoryPolicy
  runId?: string
}): Promise<FactoryBatchSimulationResult> {
  const policy = input.policy ?? SAFE_FACTORY_POLICY
  if (input.candidates.length !== policy.batchSize) {
    throw new Error("FACTORY_BATCH_REQUIRES_EXACTLY_FIVE_PRODUCTS")
  }
  if (policy.externalWritesAllowed || policy.automaticPublishAllowed ||
    !policy.killSwitchEngaged || policy.mode !== "DRY_RUN") {
    throw new Error("DRY_RUN_POLICY_MUST_BLOCK_ALL_EXTERNAL_WRITES")
  }
  const identities = new Set<string>()
  for (const candidate of [...input.candidates, ...(input.reserves ?? [])]) {
    for (const identity of [candidate.id, candidate.sku]) {
      if (identities.has(identity)) throw new Error("DUPLICATE_PRODUCT_OR_SKU")
      identities.add(identity)
    }
  }

  const settled = await Promise.allSettled(input.candidates.map(
    (candidate, index) => simulateCandidate({
      candidate,
      slot: index + 1,
      replacementFor: null,
      policy,
    }),
  ))
  const results: FactoryCandidateSimulationResult[] = settled.map(
    (entry, index) => entry.status === "fulfilled"
      ? entry.value
      : {
        candidateId: input.candidates[index]?.id ?? `unknown-${index}`,
        sku: input.candidates[index]?.sku ?? "UNKNOWN",
        slot: index + 1,
        replacementFor: null,
        finalState: "QUARANTINED_UNKNOWN_ERROR",
        transitions: [],
        attempts: 1,
        quarantined: true,
        globalDependencyPaused: false,
        externalWrites: 0,
      },
  )

  let reserveIndex = 0
  if (policy.reserveEnabled) {
    for (const failed of [...results]) {
      if (!failed.quarantined && !HOLD_STATES.has(failed.finalState)) continue
      const replacement = input.reserves?.[reserveIndex]
      if (!replacement) continue
      reserveIndex += 1
      results.push(await simulateCandidate({
        candidate: replacement,
        slot: failed.slot,
        replacementFor: failed.candidateId,
        policy,
      }))
    }
  }

  const globalPaused = results.some((row) => row.globalDependencyPaused)
  const quarantined = results.filter((row) => row.quarantined).length
  const holds = results.filter((row) => HOLD_STATES.has(row.finalState)).length
  const activeBySlot = new Map<number, FactoryCandidateSimulationResult>()
  for (const result of results) {
    if (!activeBySlot.has(result.slot) || result.replacementFor) {
      activeBySlot.set(result.slot, result)
    }
  }
  const completed = [...activeBySlot.values()].filter((row) =>
    candidateSuccessState(row.finalState)).length

  let status: FactoryBatchStatus
  if (globalPaused) status = "PAUSED_BY_GLOBAL_DEPENDENCY"
  else if (completed === 5 && quarantined > 0) status = "COMPLETED_WITH_QUARANTINE"
  else if (completed === 5 && holds > 0) status = "COMPLETED_WITH_HOLDS"
  else if (completed === 5) status = "COMPLETED"
  else if (completed > 0) status = "PARTIAL_SUCCESS"
  else if (quarantined > 0) status = "COMPLETED_WITH_QUARANTINE"
  else status = "COMPLETED_WITH_HOLDS"

  return {
    runId: input.runId ?? randomUUID(),
    status,
    selected: 5,
    processed: results.length,
    completed,
    quarantined,
    holds,
    replacements: results.filter((row) => row.replacementFor).length,
    externalWrites: 0,
    results,
  }
}

export function canReplayFromCheckpoint(input: {
  currentState: FactoryState
  checkpointState: FactoryState
  confirmedPublicationEffect: boolean
  evidenceRevalidated: boolean
}): { allowed: boolean; reason: string } {
  if (input.currentState !== "QUARANTINED_UNKNOWN_ERROR") {
    return { allowed: false, reason: "CANDIDATE_NOT_QUARANTINED" }
  }
  if (input.confirmedPublicationEffect) {
    return { allowed: false, reason: "CONFIRMED_PUBLICATION_EFFECT_MUST_NOT_REPEAT" }
  }
  if (!input.evidenceRevalidated) {
    return { allowed: false, reason: "EXPIRED_EVIDENCE_MUST_BE_REVALIDATED" }
  }
  if (FINALIZED_STATES.has(input.checkpointState) ||
    input.checkpointState === "PUBLISHED") {
    return { allowed: false, reason: "FINALIZED_LISTING_CANNOT_BE_RESURRECTED" }
  }
  return { allowed: true, reason: "REPLAY_FROM_LAST_CHECKPOINT_ALLOWED" }
}
