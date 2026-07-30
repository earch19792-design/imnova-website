// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { evaluateStrategyLabCase } from "./strategy-lab-engine.ts"
import type {
  ComparableInput,
  CreativeSeed,
  EconomicsPolicy,
  EvidenceClass,
  EvidenceInput,
  EvidencePurpose,
  OfferScenario,
  StrategyLabCaseInput,
  StrategyOutput,
} from "./strategy-lab-engine"

export const PRODUCT_CASE_RUNNER_VERSION =
  "PRODUCT_CASE_RUNNER_V1_2026_07_28" as const
export const PRODUCT_CASE_PARSER_VERSION =
  "LUNA_TEXT_PARSER_V1_2026_07_29_NARRATIVE_BLOCKS_3" as const
export const LUNA_SOURCE_CONTRACT_VERSION =
  "LUNA_SOURCE_CONTRACT_V1" as const
export const HUMAN_VISUAL_REVIEW_CONTRACT_VERSION =
  "HUMAN_VISUAL_REVIEW_CONTRACT_V1" as const
export const HUMAN_IDENTITY_REVIEW_CONTRACT_VERSION =
  "HUMAN_IDENTITY_REVIEW_CONTRACT_V1" as const

export const PRODUCT_CASE_CONTENT_MAX_BYTES = 262_144

export const PRODUCT_CASE_CORE_PHASES = [
  { index: 0, name: "SOURCE ACCESS" },
  { index: 1, name: "RAW SUPPLIER EVIDENCE" },
  { index: 2, name: "IDENTITY AND VARIANTS" },
  { index: 3, name: "EVIDENCE CLASSIFICATION" },
  { index: 4, name: "CONFLICTS AND MISSING DATA" },
  { index: 5, name: "PRODUCT FACTS READINESS" },
  { index: 6, name: "STRATEGY LAB INPUT PREVIEW" },
  { index: 7, name: "OS CONCLUSION" },
  { index: 8, name: "HUMAN REVIEW / SHADOW MODE" },
] as const

export const PRODUCT_CASE_PHASES = [
  ...PRODUCT_CASE_CORE_PHASES,
  { index: 9, name: "IMAGE REGISTRY / QA" },
  { index: 10, name: "MANUAL LISTING PACKAGE" },
  { index: 11, name: "MANUAL HANDOFF / REGISTRATION DRAFT" },
  { index: 12, name: "LEARNING OBSERVATION" },
] as const

export const PRODUCT_CASE_OPERATIONAL_PHASES = [
  "SUPPLIER_SOURCE",
  "PRODUCT_EVIDENCE",
  "HUMAN_VISUAL_REVIEW",
  "IDENTITY_AND_VARIANTS",
  "MARKET_EVIDENCE",
  "SCENARIO_ECONOMICS",
  "STRATEGY_RECOMMENDATION",
  "HUMAN_SHADOW_REVIEW",
  "IMAGE_AND_COMMERCIAL_QA",
  "MANUAL_LISTING_PACKAGE",
  "MANUAL_EBAY_HANDOFF",
  "MANUAL_LISTING_REGISTRATION",
] as const

export type ProductCaseOperationalPhaseName =
  typeof PRODUCT_CASE_OPERATIONAL_PHASES[number]
export type ProductCaseOperationalPhaseStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "HUMAN_REVIEW_REQUIRED"
  | "BLOCKED"
  | "COMPLETED"

export const PRODUCT_CASE_LISTING_GATE_IDS = [
  "IDENTITY_AND_VARIANT_READY",
  "SUPPLIER_AVAILABILITY_READY",
  "PACK_QUANTITY_READY",
  "MARKET_EVIDENCE_READY",
  "ECONOMICS_READY",
  "STRATEGY_HUMAN_REVIEW_READY",
  "TITLE_READY",
  "CATEGORY_AND_CONDITION_READY",
  "REQUIRED_ITEM_SPECIFICS_READY",
  "BRAND_IP_AND_CLAIMS_REVIEW_READY",
  "REAL_IMAGE_ORDER_READY",
  "PRICE_AND_QUANTITY_READY",
  "SHIPPING_RETURN_HANDLING_LOCATION_POLICIES_READY",
  "EVIDENCE_ASSUMPTIONS_DIFFERENCES_READY",
  "EXPLICIT_HUMAN_HANDOFF_APPROVAL_READY",
] as const

export const PRODUCT_CASE_EVIDENCE_FIELDS = [
  "title",
  "brand",
  "model",
  "mpn",
  "supplier_product_id",
  "supplier_sku",
  "variant_id",
  "option_name",
  "option_value",
  "color",
  "material",
  "product_type",
  "available_colors",
  "selected_variant",
  "intended_purpose",
  "intended_users",
  "capacity",
  "dimensions",
  "product_dimensions",
  "package_dimensions",
  "weight",
  "contents",
  "inflation_mechanism",
  "accessories",
  "warnings",
  "included_quantity",
  "pack_quantity",
  "supplier_price",
  "regular_price",
  "sale_price",
  "currency",
  "visible_stock",
  "description",
  "bullet",
  "supplier_specification",
  "marketing_claim",
  "visual_observation",
  "source_image_url",
  "product_shipping_statement",
  "fulfillment_quote",
  "supplier_merchandising_signal",
  "supplier_unit_cost",
  "packaging_cost",
  "outbound_shipping_cost",
  "listing_price",
  "buyer_shipping_charge",
  "ebay_category",
  "ebay_condition",
  "ebay_item_specific",
  "ebay_optimized_title",
  "listing_description",
  "listing_quantity",
  "listing_policy_bundle",
  "item_location",
] as const

export type ProductCaseEvidenceField =
  typeof PRODUCT_CASE_EVIDENCE_FIELDS[number]
export type ProductCasePhase = typeof PRODUCT_CASE_PHASES[number]
export type ProductCaseListingGateId =
  typeof PRODUCT_CASE_LISTING_GATE_IDS[number]

export type ProductCaseSourceType =
  | "LUNA_PUBLIC_PREFLIGHT"
  | "LUNA_AUTHENTICATED_MANUAL_CAPTURE"
  | "LUNA_MANUAL_CAPTURE"
  | "HUMAN_PRODUCT_INSPECTION"
  | "HUMAN_VISUAL_OBSERVATION"
  | "HUMAN_LISTING_DECISION"
  | "HUMAN_CORRECTION"

export type ProductCaseContentFormat =
  | "TEXT"
  | "HTML_AS_TEXT"
  | "JSON"
  | "JSON_LD"

export type ProductCaseEvidenceClass =
  | EvidenceClass
  | "SUPPLIER_MERCHANDISING_SIGNAL"
  | "SUPPLIER_MARKETING_CLAIM"
  | "HUMAN_VISUAL_REVIEW"

export type ProductCaseEvidenceStatus =
  | "PROPOSED"
  | "ACCEPTED"
  | "REJECTED"
  | "CORRECTED"
  | "NEEDS_MORE_EVIDENCE"
  | "CONFLICTED"
  | "MISSING"

export type ProductCaseHumanVerdict =
  | "UNREVIEWED"
  | "ACCEPT"
  | "REJECT"
  | "CORRECT"
  | "NEEDS_MORE_EVIDENCE"

export type ProductCaseEvidence = {
  id: string
  field: ProductCaseEvidenceField
  label: string
  variantKey: string | null
  sourceType: ProductCaseSourceType
  sourceUrl: string
  capturedAt: string
  contentHash: string
  extractionPath: string
  extractionMethod:
    | "PUBLIC_SNAPSHOT"
    | "JSON_PATH"
    | "HTML_META"
    | "HTML_TEXT_PATTERN"
    | "PLAIN_TEXT_PATTERN"
    | "HUMAN_STRUCTURED_REVIEW"
    | "MISSING"
  rawValue: unknown
  normalizedValue: unknown
  evidenceClass: ProductCaseEvidenceClass
  sourceEvidenceClass: ProductCaseEvidenceClass
  evidenceStatus: ProductCaseEvidenceStatus
  humanVerdict: ProductCaseHumanVerdict
  humanReason: string | null
  originalValue: unknown
  correctedValue: unknown
  conflictKey: string | null
  availabilityPurpose: "INVENTORY_SIGNAL" | null
  demandEvidence: "NONE" | null
}

export type ProductCaseConflict = {
  conflictKey: string
  field: ProductCaseEvidenceField
  variantKey: string | null
  evidenceIds: string[]
  values: unknown[]
  status: "OPEN" | "HUMAN_RESOLVED"
}

export type LunaSourceParseHealth =
  | "PARSED_OK"
  | "PARTIAL_EXTRACTION"
  | "SOURCE_FORMAT_CHANGED"
  | "AUTHENTICATION_REQUIRED"

export type LunaStockState =
  | "IN_STOCK_SIGNAL"
  | "OUT_OF_STOCK_SIGNAL"
  | "STOCK_UNKNOWN"
  | "STOCK_CONFLICTED"

export type ProductCaseCapture = {
  sourceType: ProductCaseSourceType
  sourceUrl: string
  capturedAt: string
  contentHash: string
  parserVersion: typeof PRODUCT_CASE_PARSER_VERSION | null
  sourceContractVersion: typeof LUNA_SOURCE_CONTRACT_VERSION | null
  parseHealth: LunaSourceParseHealth | null
  stockState: LunaStockState | null
  format: ProductCaseContentFormat
  byteLength: number
  fullContentStored: false
  scriptsExecuted: false
  resourcesLoaded: false
}

export type ProductCaseSupplierSourceCapture = {
  supplierUrl: string
  rawVisibleSourceText: string
  sourceAccessStatus: ProductCaseSourceAccessStatus
  sourceCaptureMethod: "MANUAL_AUTHENTICATED_PASTE"
  capturedAt: string
  contentHash: `sha256:${string}`
  parserVersion: typeof PRODUCT_CASE_PARSER_VERSION
  sourceContractVersion: typeof LUNA_SOURCE_CONTRACT_VERSION
  parseHealth: LunaSourceParseHealth
  stockState: LunaStockState
  extractionWarnings: string[]
  evidenceCandidates: ProductCaseEvidence[]
  missingFields: ProductCaseEvidenceField[]
  fullHtmlAccepted: false
  sensitiveContentAssessment: "NO_SENSITIVE_PATTERN_DETECTED"
  humanVisibleProductTextConfirmed: true
}

export type ProductCaseExtractionResult = {
  capture: ProductCaseCapture
  parserVersion: typeof PRODUCT_CASE_PARSER_VERSION
  sourceContractVersion: typeof LUNA_SOURCE_CONTRACT_VERSION
  parseHealth: LunaSourceParseHealth
  stockState: LunaStockState
  evidence: ProductCaseEvidence[]
  conflicts: ProductCaseConflict[]
  missingFields: ProductCaseEvidenceField[]
  parserWarnings: string[]
  safety: ProductCaseSafety
}

export type ProductCaseSourceAccessStatus =
  | "NOT_RUN"
  | "PUBLIC_ACCESSIBLE"
  | "AUTHENTICATED_SOURCE_REQUIRED"
  | "REJECTED"
  | "UNAVAILABLE"

export type ProductCaseSourceAccess = {
  status: ProductCaseSourceAccessStatus
  canonicalUrl: string | null
  checkedAt: string | null
  reason: string | null
  httpStatus: number | null
  redirectsFollowed: number
  credentialsUsed: false
}

export function resolveLunaSourceContractGuard(input: {
  sourceAccessStatus: ProductCaseSourceAccessStatus
  supplierSourceCapture: ProductCaseSupplierSourceCapture | null
}) {
  if (input.supplierSourceCapture) {
    return {
      parserVersion: input.supplierSourceCapture.parserVersion,
      sourceContractVersion:
        input.supplierSourceCapture.sourceContractVersion,
      parseHealth: input.supplierSourceCapture.parseHealth,
      stockState: input.supplierSourceCapture.stockState,
    }
  }
  return {
    parserVersion: PRODUCT_CASE_PARSER_VERSION,
    sourceContractVersion: LUNA_SOURCE_CONTRACT_VERSION,
    parseHealth: input.sourceAccessStatus ===
        "AUTHENTICATED_SOURCE_REQUIRED"
      ? "AUTHENTICATION_REQUIRED" as const
      : "PARTIAL_EXTRACTION" as const,
    stockState: "STOCK_UNKNOWN" as const,
  }
}

export type ProductCaseMarketEvidence = {
  runStatus: "NOT_RUN" | "NOT_VALIDATED" | "INSUFFICIENT" | "COMPLETE"
  soldExact: "MISSING" | "NOT_VALIDATED" | "AVAILABLE"
  activeExact: "MISSING" | "NOT_VALIDATED" | "AVAILABLE"
  marketCeiling: "MISSING" | "NOT_VALIDATED" | "AVAILABLE"
  soldExactCount: number
  referenceMedian: number | null
  comparables: ComparableInput[]
  humanSuppliedComparableCandidates: ProductCaseHumanComparableCandidate[]
  observedAt: string | null
}

export type ProductCaseHumanComparableCandidate = {
  sourceType: "HUMAN_SUPPLIED_COMPARABLE_CANDIDATE"
  validationStatus: "NOT_VALIDATED" | "VALIDATED_ACTIVE_EXACT"
  ebayItemId: string | null
  ebayUrl: string | null
  listingStatus:
    | "ACTIVE_VISIBLE"
    | "SOLD_AUCTION_VISIBLE"
    | "SOLD_USED_VISIBLE"
    | "ACTIVE_USED_VISIBLE"
  observedTitle: string | null
  observedPriceApprox: number | null
  observedShippingApprox: number | null
  currency: string | null
  visibleSoldSignal: number | null
  confirmedSoldQuantity: number | null
  condition: string | null
  endedAt: string | null
  competitorDimensions: string | null
  competitorWeight: string | null
  sourceReference: string
  observedAt: string
  identityValidated: boolean
  variantValidated: boolean
  contentsValidated: boolean
  packQuantityValidated: boolean
  eligibleForStrategyLab: boolean
  eligibleForSoldExact: false
  canBecomeProductFact: false
  provisionalCohort: "SIMILAR_NOT_EXACT" | "REJECTED" | "ACTIVE_EXACT"
  review: {
    decision:
      | "KEEP_NOT_VALIDATED"
      | "REJECT"
      | "VALIDATE_ACTIVE_EXACT"
    reason: string | null
    reviewer: string | null
    reviewedAt: string | null
    validatedTitle: string | null
    validatedPackQuantity: number | null
    validatedVariantComposition: string[]
    buyerShipping: number | null
    reasonCodes: string[]
  }
  validationBlockers: string[]
}

export type ProductCaseHumanConclusion = {
  scenario: OfferScenario | null
  conclusion: StrategyOutput | null
  reason: string | null
  reviewedAt: string | null
  reviewer: string | null
}

export type ProductCaseHumanReview = {
  conclusion: ProductCaseHumanConclusion
  proposedRuleObservation: string | null
  learningStatus: "HUMAN_REVIEW_DRAFT"
  canChangeEngineRules: false
  canPublishAutomatically: false
  canLinkListing: false
}

export type ProductCaseImageObservation = {
  contractVersion: typeof HUMAN_VISUAL_REVIEW_CONTRACT_VERSION
  imageId: string
  evidenceId: string
  contentHash: `sha256:${string}`
  sourceUrl: string | null
  sourceReference?: string
  sourceType: "SUPPLIER_IMAGE"
  verificationStatus: "SOURCE_IMAGE_OBSERVED"
  physicalProductVerified: false
  captureMethod: "HUMAN_VISUAL_REVIEW"
  reviewerType: "HUMAN"
  observedProductType: string | null
  visibleFeatures: string[]
  visibleText: string[]
  visibleBrands: string[]
  visibleColors: string[]
  visibleQuantity: number | null
  observedVariant: string | null
  possibleConflicts: string[]
  contradictsEvidenceIds: string[]
  confidence: "LOW" | "MEDIUM" | "HIGH"
  humanDecision:
    | "ACCEPT_FOR_ANALYSIS"
    | "REJECT_FOR_EBAY_HANDOFF"
    | "NEEDS_MORE_EVIDENCE"
  humanReason: string
  reviewedAt: string
  rawHumanInput: {
    imageId: string
    sourceUrl: string
    sourceReference: string
    observedProductType: string
    visibleFeatures: string
    visibleText: string
    visibleBrands: string
    visibleColors: string
    visibleQuantity: string
    observedVariant: string
    possibleConflicts: string
    confidence: string
    humanDecision: string
    humanReason: string
  }
}

export type ProductCaseImageAnalysis = {
  imageAnalysisCapability: "HUMAN_ASSISTED_ONLY"
  machineVisionStatus: "NOT_IMPLEMENTED"
  openAiVisionUsed: false
  humanReviewRequired: true
  visualEvidenceStatus: "NOT_REVIEWED" | "HUMAN_REVIEWED"
  conflictDetectedFrom: Array<
    "SUPPLIER_TEXT" | "HUMAN_VISUAL_REVIEW"
  >
  contractIssues?: string[]
  observations: ProductCaseImageObservation[]
}

export const PRODUCT_CASE_HUMAN_IDENTITY_FIELDS = [
  "brand",
  "model",
  "mpn",
  "supplier_product_id",
  "supplier_sku",
  "variant_id",
  "color",
  "pack_quantity",
] as const

export type ProductCaseHumanIdentityField =
  typeof PRODUCT_CASE_HUMAN_IDENTITY_FIELDS[number]

export type ProductCaseHumanIdentityReview = {
  contractVersion: typeof HUMAN_IDENTITY_REVIEW_CONTRACT_VERSION
  reviewId: string
  contentHash: `sha256:${string}`
  reviewer: string
  reviewedAt: string
  decision:
    | "NEEDS_MORE_EVIDENCE"
    | "CONFLICT_CONFIRMED"
    | "IDENTITY_CONFIRMED"
  status: "PARTIAL" | "CONFLICTED" | "READY"
  confidence: "LOW" | "MEDIUM" | "HIGH"
  humanReason: string
  evidenceIds: string[]
  sameGeneralProductTypeConfirmed: boolean
  exactIdentityConfirmed: boolean
  brandConfirmed: boolean
  brand: string | null
  model: string | null
  mpn: string | null
  supplierProductId: string | null
  supplierSku: string | null
  variantId: string | null
  color: string | null
  packQuantity: number | null
  availableFields: ProductCaseHumanIdentityField[]
  missingFields: ProductCaseHumanIdentityField[]
  physicalProductVerified: boolean
  physicalVerificationEvidenceIds: string[]
  rawHumanInput: {
    reviewer: string
    decision: string
    confidence: string
    humanReason: string
    evidenceIds: string[]
    sameGeneralProductTypeConfirmed: boolean
    exactIdentityConfirmed: boolean
    brandConfirmed: boolean
    brand: string
    model: string
    mpn: string
    supplierProductId: string
    supplierSku: string
    variantId: string
    color: string
    packQuantity: string
    physicalProductVerified: boolean
    physicalVerificationEvidenceIds: string[]
  }
}

export type ProductCaseIdentityReview = {
  status: "NOT_REVIEWED" | "PARTIAL" | "CONFLICTED" | "READY"
  confidence: "LOW" | "MEDIUM" | "HIGH"
  physicalProductVerified: boolean
  physicalVerificationEvidenceIds: string[]
  conflictHistory: string[]
  currentConflict: string | null
  supplierEvidenceIds: string[]
  humanObservationEvidenceIds: string[]
  blockers: string[]
  nextAction: string
  humanReview?: ProductCaseHumanIdentityReview | null
}

export type ProductCaseDocument = {
  version: typeof PRODUCT_CASE_RUNNER_VERSION
  caseId: string
  productLabel: string
  sourceUrl: string
  createdAt: string
  sourceAccess: ProductCaseSourceAccess
  supplierSourceCapture: ProductCaseSupplierSourceCapture | null
  captures: ProductCaseCapture[]
  evidence: ProductCaseEvidence[]
  marketEvidence: ProductCaseMarketEvidence
  imageAnalysis: ProductCaseImageAnalysis
  identityReview: ProductCaseIdentityReview
  humanReview: ProductCaseHumanReview
  safety: ProductCaseSafety
}

export type ProductCaseScenarioDraft = {
  id: string
  offerScenario: OfferScenario
  variantComposition: string[]
  packQuantityEvidenceId: string
  costLines: Array<{
    variantKey: string
    quantity: number
    unitCostEvidenceId: string
  }>
  packagingCostEvidenceId: string
  outboundShippingCostEvidenceId: string
  listingPriceEvidenceId: string
  buyerShippingChargeEvidenceId: string
  requiredIdentityFields: ProductCaseEvidenceField[]
  requiredDimensionFields: ProductCaseEvidenceField[]
  requiresExactSoldEvidence: boolean
  hypothesisEvidenceClass?: EvidenceClass | null
  creativeSeed: CreativeSeed
}

export type ProductCaseStrategyAdapterInput = {
  document: ProductCaseDocument
  evaluatedAt: string
  economicsPolicy: EconomicsPolicy | null
  scenarioDraft: ProductCaseScenarioDraft | null
}

export type ProductCaseStrategyAdapterResult = {
  status: "READY" | "BLOCKED"
  acceptedEvidenceInputs: EvidenceInput[]
  acceptedRunnerEvidenceIds: string[]
  excludedEvidence: Array<{
    evidenceId: string
    reason: string
  }>
  excludedComparableCandidates: Array<{
    ebayItemId: string | null
    reason:
      "HUMAN_SUPPLIED_COMPARABLE_CANDIDATE_REQUIRES_VALIDATION"
  }>
  validatedComparableInputs: ComparableInput[]
  blockers: string[]
  strategyLabInput: StrategyLabCaseInput | null
  osConclusion: StrategyOutput
  nextAction: string
  marketEvidence: ProductCaseMarketEvidence
  currentEvidenceLeader: {
    scenarioId: string
    offerScenario: OfferScenario
    label: "CURRENT EVIDENCE LEADER"
    subtitle:
      "Escenario actualmente mejor respaldado; no está aprobado para ejecutar."
  } | null
  strategicHypothesisToValidate: {
    scenarioId: string
    offerScenario: OfferScenario
    evidenceClass: "HUMAN_HYPOTHESIS"
    label: "STRATEGIC HYPOTHESIS TO VALIDATE"
  } | null
  safety: ProductCaseSafety
}

export type ProductCaseListingGate = {
  id: ProductCaseListingGateId
  status: "PASS" | "BLOCKED" | "NOT_RUN"
  evidenceIds: string[]
  blockers: string[]
}

export type ProductCaseImageApproval = {
  evidenceId: string | null
  sourceKind: "ORIGINAL_SUPPLIER" | "MANUALLY_PREPARED"
  sourceUrl: string
  assetHash: `sha256:${string}` | null
  purpose: string
  role: "MAIN" | "SECONDARY"
  order: number
  variantId: string | null
  packQuantity: number | null
  humanNotes: string | null
  status:
    | "SOURCE_REQUIRED"
    | "MANUAL_IMAGE_ATTACHED"
    | "HUMAN_REVIEW"
    | "APPROVED"
    | "REJECTED"
  reviewer: string | null
  reviewedAt: string | null
  reason: string | null
  qa: {
    productAndVariantMatch: boolean
    packQuantityMatch: boolean
    logosAndIpReviewed: boolean
    claimsReviewed: boolean
    ebayRoleCoherent: boolean
  }
}

export type ProductCaseImageRegistryEntry = {
  registryId: string
  evidenceId: string | null
  sourceKind: ProductCaseImageApproval["sourceKind"]
  sourceUrl: string
  sourceCaptureHash: string | null
  assetHash: `sha256:${string}` | null
  productCaseId: string
  packQuantity: number | null
  variantId: string | null
  purpose: string
  role: "MAIN" | "SECONDARY"
  order: number
  approvalStatus: ProductCaseImageApproval["status"]
  reviewer: string | null
  reviewedAt: string | null
  humanNotes: string | null
  qa: ProductCaseImageApproval["qa"]
  sourceOnly: true
  downloaded: false
  transformed: false
  generated: false
}

export type ProductCaseImageRegistry = {
  status:
    | "SOURCE_REQUIRED"
    | "MANUAL_IMAGE_ATTACHED"
    | "HUMAN_REVIEW"
    | "APPROVED"
    | "REJECTED"
  entries: ProductCaseImageRegistryEntry[]
  approvedMainRegistryId: string | null
  approvedMainEvidenceId: string | null
  approvedMainAssetHash: `sha256:${string}` | null
  blockers: string[]
  safety: ProductCaseSafety
}

export type ProductCaseListingOperations = {
  title: string | null
  categoryId: string | null
  categoryName: string | null
  conditionId: string | null
  conditionDescription: string | null
  itemSpecifics: Record<string, string[]>
  requiredItemSpecifics: string[]
  description: string | null
  listingPrice: number | null
  quantity: number | null
  totalInvestment: number | null
  estimatedProfit: number | null
  marginPercent: number | null
  roiPercent: number | null
  fulfillmentPolicyId: string | null
  paymentPolicyId: string | null
  returnPolicyId: string | null
  shippingPolicySummary: string | null
  returnPolicySummary: string | null
  handlingTimeDays: number | null
  itemLocation: {
    country: string | null
    postalCode: string | null
    city: string | null
    stateOrProvince: string | null
  }
  imageEvidenceOrder: string[]
  supportingEvidenceIds: string[]
  evidenceLinks: {
    title: string[]
    category: string[]
    condition: string[]
    itemSpecifics: Record<string, string[]>
    description: string[]
    listingPrice: string[]
    quantity: string[]
    economics: string[]
    policies: string[]
    itemLocation: string[]
  }
  assumptions: string[]
  blockers: string[]
  differences: string[]
  supplierAvailabilityStatus:
    | "CONFIRMED_AVAILABLE"
    | "CONFIRMED_UNAVAILABLE"
    | "NOT_CONFIRMED"
  brandIpClaimsReview: {
    status: "APPROVED" | "REJECTED" | "NOT_REVIEWED"
    reviewer: string | null
    reviewedAt: string | null
    reason: string | null
  }
  explicitHumanApproval: {
    approved: boolean
    reviewer: string | null
    reviewedAt: string | null
    reason: string | null
  }
  humanOverride: {
    applied: boolean
    reviewer: string | null
    reviewedAt: string | null
    reason: string | null
    overriddenBlockers: string[]
  }
  candidateKey: string | null
}

export type ProductCaseManualListingPackage = {
  version: "PRODUCT_CASE_MANUAL_LISTING_PACKAGE_V1"
  productCaseId: string
  supplierUrl: string
  osConclusion: StrategyOutput
  humanConclusion: ProductCaseHumanConclusion
  decisionDifferences: Array<{
    field: string
    osValue: unknown
    humanValue: unknown
  }>
  packageStatus:
    | "NOT_GENERATED_IDENTITY_HOLD"
    | "DRAFT_EVIDENCE_ONLY"
    | "READY_FOR_HUMAN_SELLER_HUB_ENTRY"
  generatedAt: string
  acceptedEvidenceIds: string[]
  rejectedEvidenceIds: string[]
  identity: {
    title: string | null
    brand: string | null
    model: string | null
    mpn: string | null
    supplierProductId: string | null
    supplierSku: string | null
    variantId: string | null
  }
  packQuantity: number | null
  supplierPrices: Array<{
    field: "supplier_price" | "regular_price" | "sale_price"
    value: number
    currency: string | null
    evidenceId: string
  }>
  title: string | null
  category: {
    id: string | null
    name: string | null
  }
  condition: {
    id: string | null
    description: string | null
  }
  itemSpecifics: Record<string, string[]>
  requiredItemSpecifics: string[]
  description: string | null
  listingPrice: number | null
  quantity: number | null
  economics: {
    totalInvestment: number | null
    estimatedProfit: number | null
    marginPercent: number | null
    roiPercent: number | null
  }
  policies: {
    fulfillmentPolicyId: string | null
    paymentPolicyId: string | null
    returnPolicyId: string | null
    shippingPolicySummary: string | null
    returnPolicySummary: string | null
    handlingTimeDays: number | null
    itemLocation: ProductCaseListingOperations["itemLocation"]
  }
  itemSpecificEvidence: Array<{
    field: ProductCaseEvidenceField
    value: unknown
    evidenceId: string
  }>
  excludedClaims: Array<{
    evidenceId: string
    reason: "SUPPLIER_CLAIM_NOT_PRODUCT_VERIFIED"
  }>
  sourceImageUrls: string[]
  approvedImages: Array<{
    registryId: string
    evidenceId: string | null
    sourceUrl: string
    sourceCaptureHash: string | null
    assetHash: `sha256:${string}` | null
    approvalStatus: "APPROVED"
    purpose: string
    role: "MAIN" | "SECONDARY"
    order: number
    reviewer: string | null
    reviewedAt: string | null
    variantId: string | null
    packQuantity: number | null
    qa: ProductCaseImageApproval["qa"]
  }>
  imageEvidenceOrder: string[]
  supportingEvidenceIds: string[]
  evidenceLinks: ProductCaseListingOperations["evidenceLinks"]
  assumptions: string[]
  blockers: string[]
  differences: string[]
  humanOverride: ProductCaseListingOperations["humanOverride"]
  gates: ProductCaseListingGate[]
  canPublishAutomatically: false
  manualHandoffAllowed: boolean
  handoffStatus:
    | "BLOCKED_EVIDENCE_INCOMPLETE"
    | "READY_FOR_HUMAN_SELLER_HUB_ENTRY"
  safety: ProductCaseSafety
}

export type ProductCaseRegistrationDraft = {
  version: "MANUAL_LISTING_REGISTRATION_DRAFT_V1"
  status: "MANUAL_LISTING_REGISTRATION_DRAFT"
  executionStatus: "DRAFT_NOT_SUBMITTED"
  canSubmit: false
  productCaseId: string
  listingPackageVersion: ProductCaseManualListingPackage["version"]
  listingPackageStatus: ProductCaseManualListingPackage["packageStatus"]
  postPublicationFields: {
    ebayItemId: string | null
    listingUrl: string | null
    marketplaceAccountKey: string | null
    marketplace: string | null
    ebaySku: string | null
    productCaseReference: string
    listingPackageId: string | null
    listingPackageReference: string
    lunaProductId: string | null
    lunaVariantId: string | null
    variantFingerprint: string | null
    packQuantity: number | null
    supplierUnitCost: number | null
    publishedPrice: number | null
    publishedQuantity: number | null
    categoryId: string | null
    conditionId: string | null
    shippingPolicyId: string | null
    returnPolicyId: string | null
    handlingTimeDays: number | null
    publicationTimestamp: string | null
  }
  existingRouteProjection: {
    targetRoute: "/api/admin/ebay/listings/register"
    payload: {
      ebayItemId: null
      ebayUrl: null
      opportunityId: null
      candidateKey: string | null
      supplierSku: null
      supplierVariantId: null
      safeDefaults: Record<string, never>
    }
  }
  blockers: string[]
  reuseContract: "ManualListingRegistrationInput"
  existingRouteCompatibilityGap: string[]
  safety: ProductCaseSafety
}

export type ProductCaseLearningObservation = {
  osRecommendation: StrategyOutput
  humanDecision: ProductCaseHumanConclusion
  finalListingDecision: null
  differences: Array<{
    field: string
    osValue: unknown
    humanValue: unknown
  }>
  humanReasonCodes: string[]
  evidenceAddedByHuman: string[]
  evidenceRejectedByHuman: string[]
  ruleCandidate: string | null
  ruleCandidateStatus: "OBSERVATION_ONLY"
  listingOutcomeStatus: "NOT_YET_MEASURED"
  engineRuleChanged: false
  learningStatus: "HUMAN_REVIEW_DRAFT"
}

export type ProductCaseFutureMeasurementStage = {
  stage:
    | "DAY_0_LISTING_SNAPSHOT"
    | "DAY_7_PERFORMANCE_REVIEW"
    | "DAY_14_PERFORMANCE_REVIEW"
    | "DAY_30_PERFORMANCE_REVIEW"
  status: "BLOCKED"
  measurementStatus: "NOT_YET_MEASURED"
  reason: "MANUAL_LISTING_NOT_PUBLISHED_AND_REGISTERED"
  metrics: ProductCaseMeasurementMetrics
}

export type ProductCaseUnavailableMetric = {
  value: null
  status: "MISSING / UNAVAILABLE"
  source: null
  observedAt: null
}

export type ProductCaseMeasurementMetrics = {
  impressions: ProductCaseUnavailableMetric
  pageViews: ProductCaseUnavailableMetric
  clicks: ProductCaseUnavailableMetric
  ctr: ProductCaseUnavailableMetric
  watchers: ProductCaseUnavailableMetric
  quantitySold: ProductCaseUnavailableMetric
  conversion: ProductCaseUnavailableMetric
  promotedListingCost: ProductCaseUnavailableMetric
  sellingFees: ProductCaseUnavailableMetric
  realShipping: ProductCaseUnavailableMetric
  refunds: ProductCaseUnavailableMetric
  netProfit: ProductCaseUnavailableMetric
}

export type ProductCasePhaseSnapshot = {
  index: ProductCasePhase["index"]
  name: ProductCasePhase["name"]
  status: "COMPLETE" | "IN_REVIEW" | "BLOCKED" | "NOT_RUN"
  input: Record<string, unknown>
  output: Record<string, unknown>
  acceptedEvidenceIds: string[]
  rejectedEvidenceIds: string[]
  conflicts: ProductCaseConflict[]
  missingFields: ProductCaseEvidenceField[]
  blockers: string[]
  confidence: "LOW" | "MEDIUM" | "HIGH"
  appliedRules: string[]
  nextAction: string
}

export type ProductCaseOperationalPhaseSnapshot = {
  phase: ProductCaseOperationalPhaseName
  status: ProductCaseOperationalPhaseStatus
  input: Record<string, unknown>
  output: Record<string, unknown>
  acceptedEvidenceIds: string[]
  rejectedEvidenceIds: string[]
  conflicts: ProductCaseConflict[]
  missingFields: ProductCaseEvidenceField[]
  blockers: string[]
  confidence: "LOW" | "MEDIUM" | "HIGH"
  appliedRules: string[]
  nextAction: string
  publicationStatus: "NOT_PUBLISHED"
  handoffArtifactGenerated: boolean
}

export type ProductCaseSafety = {
  supabaseWrites: 0
  ebayWrites: 0
  openAiCalls: 0
  whatsappCalls: 0
  generatedImages: 0
  transformedImages: 0
  listingChanges: 0
  serverFilesWritten: 0
  canPublishAutomatically: false
  canChangeEngineRules: false
}

export type ProductCaseRunnerOutput = {
  version: typeof PRODUCT_CASE_RUNNER_VERSION
  document: ProductCaseDocument
  adapter: ProductCaseStrategyAdapterResult
  imageRegistry: ProductCaseImageRegistry
  listingPackage: ProductCaseManualListingPackage | null
  listingPackageStatus: ProductCaseManualListingPackage["packageStatus"]
  registrationDraft: ProductCaseRegistrationDraft
  learningObservation: ProductCaseLearningObservation
  futureMeasurementStages: ProductCaseFutureMeasurementStage[]
  legacyPhaseDiagnostics: ProductCasePhaseSnapshot[]
  operationalPipeline: ProductCaseOperationalPhaseSnapshot[]
  readiness: {
    productIdentity: "MISSING" | "PARTIAL" | "CONFLICTED" | "READY"
    identityConfidence: "LOW" | "MEDIUM" | "HIGH"
    productFactsReadiness: "NOT_READY" | "READY"
    supplierEvidence: "MISSING" | "PARTIAL" | "READY"
    marketEvidence: "NOT_RUN" | "NOT_VALIDATED" | "INSUFFICIENT" | "READY"
    economics: "MISSING_INPUT" | "READY"
    strategy: StrategyOutput
  }
  canPublishAutomatically: false
  publicationStatus: "NOT_PUBLISHED"
  handoffArtifactGenerated: boolean
  manualHandoffAllowed: boolean
  shadowMode: {
    osConclusion: StrategyOutput
    humanConclusion: ProductCaseHumanConclusion
    differences: Array<{
      field: string
      osValue: unknown
      humanValue: unknown
    }>
    proposedRuleObservation: string | null
    learningStatus: "HUMAN_REVIEW_DRAFT"
    canChangeEngineRules: false
    canLinkListing: false
  }
  safety: ProductCaseSafety
}

export const PRODUCT_CASE_ZERO_EFFECTS: ProductCaseSafety = Object.freeze({
  supabaseWrites: 0,
  ebayWrites: 0,
  openAiCalls: 0,
  whatsappCalls: 0,
  generatedImages: 0,
  transformedImages: 0,
  listingChanges: 0,
  serverFilesWritten: 0,
  canPublishAutomatically: false,
  canChangeEngineRules: false,
})

const FIELD_LABELS: Record<ProductCaseEvidenceField, string> = {
  title: "Title",
  brand: "Brand",
  model: "Model",
  mpn: "MPN",
  supplier_product_id: "Supplier product ID",
  supplier_sku: "Supplier SKU",
  variant_id: "Variant ID",
  option_name: "Option name",
  option_value: "Option value",
  color: "Color",
  material: "Material",
  product_type: "Product type",
  available_colors: "Available supplier colors",
  selected_variant: "Human-selected variant",
  intended_purpose: "Supplier-stated intended purpose",
  intended_users: "Supplier-stated intended users",
  capacity: "Capacity",
  dimensions: "Dimensions",
  product_dimensions: "Product dimensions",
  package_dimensions: "Package dimensions",
  weight: "Weight",
  contents: "Included contents",
  inflation_mechanism: "Inflation mechanism",
  accessories: "Included accessories",
  warnings: "Supplier warnings",
  included_quantity: "Included quantity",
  pack_quantity: "Pack quantity",
  supplier_price: "Supplier price",
  regular_price: "Regular supplier price",
  sale_price: "Sale supplier price",
  currency: "Currency",
  visible_stock: "Visible stock",
  description: "Supplier description",
  bullet: "Supplier bullet",
  supplier_specification: "Supplier-stated specification",
  marketing_claim: "Supplier marketing claim",
  visual_observation: "Human visual observation",
  source_image_url: "Original supplier image URL",
  product_shipping_statement: "Product-specific shipping statement",
  fulfillment_quote: "Real fulfillment quote",
  supplier_merchandising_signal: "Supplier merchandising signal",
  supplier_unit_cost: "Supplier unit cost",
  packaging_cost: "Packaging cost",
  outbound_shipping_cost: "Outbound shipping cost",
  listing_price: "Proposed listing price",
  buyer_shipping_charge: "Proposed buyer shipping charge",
  ebay_category: "Human-reviewed eBay category",
  ebay_condition: "Human-reviewed eBay condition",
  ebay_item_specific: "Human-reviewed eBay item specific",
  ebay_optimized_title: "Human-reviewed eBay optimized title",
  listing_description: "Human-reviewed listing description",
  listing_quantity: "Human-reviewed listing quantity",
  listing_policy_bundle: "Human-reviewed listing policy bundle",
  item_location: "Human-reviewed item location",
}

const MULTI_VALUE_FIELDS = new Set<ProductCaseEvidenceField>([
  "option_name",
  "option_value",
  "contents",
  "accessories",
  "bullet",
  "supplier_specification",
  "marketing_claim",
  "visual_observation",
  "source_image_url",
  "warnings",
  "ebay_item_specific",
])

const CONFLICT_FIELDS = new Set<ProductCaseEvidenceField>([
  "title",
  "brand",
  "model",
  "mpn",
  "supplier_product_id",
  "supplier_sku",
  "variant_id",
  "color",
  "material",
  "product_type",
  "available_colors",
  "selected_variant",
  "intended_purpose",
  "intended_users",
  "capacity",
  "dimensions",
  "product_dimensions",
  "package_dimensions",
  "weight",
  "inflation_mechanism",
  "included_quantity",
  "pack_quantity",
  "supplier_price",
  "regular_price",
  "sale_price",
  "currency",
  "visible_stock",
  "supplier_unit_cost",
  "packaging_cost",
  "outbound_shipping_cost",
  "listing_price",
  "buyer_shipping_charge",
  "listing_quantity",
])

type Candidate = {
  field: ProductCaseEvidenceField
  rawValue: unknown
  normalizedValue: unknown
  extractionPath: string
  variantKey?: string | null
  evidenceClass?: ProductCaseEvidenceClass
  stockSignal?: "OUT_OF_STOCK"
}

function normalizeWhitespace(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim()
}

function explicitOutOfStockSignal(value: unknown) {
  if (typeof value !== "string") return false
  const compact = normalizeWhitespace(value)
  const token = /^https?:\/\/(?:www\.)?schema\.org\//i.test(compact)
    ? compact.replace(/[?#].*$/, "").split(/[\/#]/).at(-1) ?? ""
    : compact
  const normalized = token
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLocaleLowerCase("en-US")
  return normalized === "out of stock" || normalized === "sold out"
}

function nonempty(value: unknown) {
  return value !== null && value !== undefined && value !== ""
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) =>
      `${JSON.stringify(key)}:${stableValue(object[key])}`
    ).join(",")}}`
  }
  return JSON.stringify(value) ?? String(value)
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function utf8Length(value: string) {
  return new TextEncoder().encode(value).byteLength
}

function validIsoInstant(value: string) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/,
  )
  if (!match) return false
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, ,
    zone] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return false
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day < 1 || day > daysInMonth) return false
  if (zone !== "Z") {
    const zoneHour = Number(zone.slice(1, 3))
    const zoneMinute = Number(zone.slice(4, 6))
    if (zoneHour > 23 || zoneMinute > 59) return false
  }
  return Number.isFinite(Date.parse(value))
}

function validSha256(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(value)
}

function validHttpsLunaReference(value: unknown) {
  if (typeof value !== "string" || !value.trim() ||
    value !== value.trim()) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === "https:" &&
      (parsed.hostname === "lunaportex.com" ||
        parsed.hostname === "www.lunaportex.com") &&
      !parsed.username && !parsed.password && !parsed.port
  } catch {
    return false
  }
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value !== "string") return null
  const compact = value.replace(/,/g, "")
  const match = compact.match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

function positiveInteger(value: unknown): number | null {
  const parsed = numericValue(value)
  return parsed !== null && Number.isInteger(parsed) && parsed > 0
    ? parsed
    : null
}

function normalizeFieldValue(
  field: ProductCaseEvidenceField,
  value: unknown,
): unknown {
  if (!nonempty(value)) return null
  if ([
    "supplier_price",
    "regular_price",
    "sale_price",
    "supplier_unit_cost",
    "packaging_cost",
    "outbound_shipping_cost",
    "listing_price",
    "buyer_shipping_charge",
  ].includes(field)) {
    return numericValue(value)
  }
  if (field === "visible_stock") return numericValue(value)
  if (["included_quantity", "pack_quantity", "listing_quantity"].includes(
    field,
  )) {
    return positiveInteger(value)
  }
  if (field === "source_image_url") {
    try {
      const url = new URL(String(value))
      return url.protocol === "https:" ? url.href : null
    } catch {
      return null
    }
  }
  if (typeof value === "string") return normalizeWhitespace(value)
  return value
}

function canonicalVariantKey(value: unknown) {
  if (!nonempty(value)) return null
  return normalizeWhitespace(String(value)).slice(0, 160) || null
}

export function validateLunaProductUrl(value: unknown):
  | {
      valid: true
      canonicalUrl: string
      host: "lunaportex.com" | "www.lunaportex.com"
      handle: string
    }
  | { valid: false; error: string } {
  if (typeof value !== "string" || !value) {
    return { valid: false, error: "LUNA_PRODUCT_URL_REQUIRED" }
  }
  if (value.length > 2_048 || value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)) {
    return { valid: false, error: "LUNA_PRODUCT_URL_INVALID" }
  }
  if (/%[0-9a-f]{2}/i.test(value)) {
    return { valid: false, error: "LUNA_PRODUCT_URL_ENCODING_FORBIDDEN" }
  }
  if (/^http:\/\//i.test(value)) {
    return { valid: false, error: "LUNA_PRODUCT_URL_HTTPS_REQUIRED" }
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { valid: false, error: "LUNA_PRODUCT_URL_INVALID" }
  }
  const host = url.hostname.toLocaleLowerCase("en-US")
  if (url.protocol !== "https:") {
    return { valid: false, error: "LUNA_PRODUCT_URL_HTTPS_REQUIRED" }
  }
  if (url.username || url.password) {
    return { valid: false, error: "LUNA_PRODUCT_URL_CREDENTIALS_FORBIDDEN" }
  }
  if (url.port) {
    return { valid: false, error: "LUNA_PRODUCT_URL_CUSTOM_PORT_FORBIDDEN" }
  }
  const lunaTrackingParameters = new Set(["_pos", "_sid", "_ss"])
  if (
    url.hash ||
    url.host !== host ||
    [...url.searchParams.keys()].some((key) =>
      !lunaTrackingParameters.has(key)
    )
  ) {
    return { valid: false, error: "LUNA_PRODUCT_URL_INVALID" }
  }
  if (host !== "lunaportex.com" && host !== "www.lunaportex.com") {
    return { valid: false, error: "LUNA_PRODUCT_URL_HOST_NOT_ALLOWED" }
  }
  const match = url.pathname.match(
    /^\/products\/([a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?)$/,
  )
  if (!match) {
    return { valid: false, error: "LUNA_PRODUCT_URL_PATH_NOT_ALLOWED" }
  }
  const canonicalUrl = `https://${host}/products/${match[1]}`
  return {
    valid: true,
    canonicalUrl,
    host,
    handle: match[1],
  }
}

export async function hashProductCaseContent(content: string) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error("PRODUCT_CASE_SHA256_UNAVAILABLE")
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(content),
  )
  return `sha256:${[...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`
}

const MANUAL_SOURCE_SENSITIVE_PATTERNS = [
  /(?:^|\n)\s*(?:password|contraseña|passwd)\s*[:=]/i,
  /(?:^|\n)\s*(?:cookie|set-cookie|session(?:id)?|csrf)\s*[:=]/i,
  /(?:^|\n)\s*(?:authorization|access[_ -]?token|refresh[_ -]?token|bearer)\s*[:=]/i,
  /(?:^|\n)\s*(?:credit[_ -]?card|card[_ -]?number|cvv|cvc|payment[_ -]?method)\s*[:=]/i,
  /(?:^|\n)\s*(?:account[_ -]?email|customer[_ -]?email|account[_ -]?name)\s*[:=]/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/i,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/,
  /\b(?:authorization\s+)?bearer\s+[A-Za-z0-9._~+\/=-]{8,}/i,
  /\b(?:cookie|set-cookie)\s+[A-Za-z0-9_-]{1,64}=[^;\s]{4,}/i,
] as const

function containsPaymentCardNumber(value: string) {
  const candidates = value.match(/(?:^|[^\d])((?:\d[ -]?){12,18}\d)(?!\d)/g) ??
    []
  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/g, "")
    if (
      digits.length < 13 ||
      digits.length > 19 ||
      /^(\d)\1+$/.test(digits)
    ) return false
    let sum = 0
    let doubleDigit = false
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      let digit = Number(digits[index])
      if (doubleDigit) {
        digit *= 2
        if (digit > 9) digit -= 9
      }
      sum += digit
      doubleDigit = !doubleDigit
    }
    return sum % 10 === 0
  })
}

export function validateManualAuthenticatedVisibleSourceText(value: unknown):
  | { valid: true; rawVisibleSourceText: string; byteLength: number }
  | { valid: false; error: string } {
  if (typeof value !== "string" || !value.trim()) {
    return { valid: false, error: "MANUAL_SOURCE_CONTENT_REQUIRED" }
  }
  const byteLength = utf8Length(value)
  if (byteLength > PRODUCT_CASE_CONTENT_MAX_BYTES) {
    return { valid: false, error: "MANUAL_SOURCE_CONTENT_TOO_LARGE" }
  }
  if (
    /<!doctype\s+html|<html\b|<head\b|<body\b|<script\b|<\/html\s*>/i
      .test(value)
  ) {
    return { valid: false, error: "FULL_HTML_NOT_ACCEPTED_PASTE_VISIBLE_TEXT_ONLY" }
  }
  if (
    MANUAL_SOURCE_SENSITIVE_PATTERNS.some((pattern) => pattern.test(value)) ||
    containsPaymentCardNumber(value)
  ) {
    return {
      valid: false,
      error: "SENSITIVE_ACCOUNT_OR_CREDENTIAL_CONTENT_REJECTED",
    }
  }
  return { valid: true, rawVisibleSourceText: value, byteLength }
}

export async function createManualAuthenticatedSupplierSourceCapture(input: {
  supplierUrl: string
  rawVisibleSourceText: string
  sourceAccessStatus: ProductCaseSourceAccessStatus
  extraction: ProductCaseExtractionResult
  humanVisibleProductTextConfirmed: boolean
}): Promise<ProductCaseSupplierSourceCapture> {
  const validatedText = validateManualAuthenticatedVisibleSourceText(
    input.rawVisibleSourceText,
  )
  if (!validatedText.valid) throw new Error(validatedText.error)
  if (input.humanVisibleProductTextConfirmed !== true) {
    throw new Error("HUMAN_VISIBLE_PRODUCT_TEXT_CONFIRMATION_REQUIRED")
  }
  const validatedUrl = validateLunaProductUrl(input.supplierUrl)
  if (!validatedUrl.valid) throw new Error(validatedUrl.error)
  if (
    input.sourceAccessStatus !== "AUTHENTICATED_SOURCE_REQUIRED" ||
    input.extraction.capture.sourceType !==
      "LUNA_AUTHENTICATED_MANUAL_CAPTURE" ||
    input.extraction.capture.sourceUrl !== validatedUrl.canonicalUrl
  ) {
    throw new Error("MANUAL_AUTHENTICATED_SOURCE_CAPTURE_CONTEXT_INVALID")
  }
  const recalculatedContentHash = await hashProductCaseContent(
    validatedText.rawVisibleSourceText,
  )
  if (
    input.extraction.capture.byteLength !== validatedText.byteLength ||
    !validSha256(input.extraction.capture.contentHash) ||
    input.extraction.capture.contentHash !== recalculatedContentHash
  ) {
    throw new Error("MANUAL_AUTHENTICATED_SOURCE_CAPTURE_HASH_INVALID")
  }
  const evidenceCandidates = input.extraction.evidence.filter((entry) =>
    entry.evidenceStatus !== "MISSING"
  )
  return {
    supplierUrl: validatedUrl.canonicalUrl,
    rawVisibleSourceText: validatedText.rawVisibleSourceText,
    sourceAccessStatus: input.sourceAccessStatus,
    sourceCaptureMethod: "MANUAL_AUTHENTICATED_PASTE",
    capturedAt: input.extraction.capture.capturedAt,
    contentHash: input.extraction.capture.contentHash as `sha256:${string}`,
    parserVersion: input.extraction.parserVersion,
    sourceContractVersion: input.extraction.sourceContractVersion,
    parseHealth: input.extraction.parseHealth,
    stockState: input.extraction.stockState,
    extractionWarnings: [...input.extraction.parserWarnings],
    evidenceCandidates: structuredClone(evidenceCandidates),
    missingFields: [...input.extraction.missingFields],
    fullHtmlAccepted: false,
    sensitiveContentAssessment: "NO_SENSITIVE_PATTERN_DETECTED",
    humanVisibleProductTextConfirmed: true,
  }
}

function detectFormat(
  content: string,
  requested?: ProductCaseContentFormat,
): ProductCaseContentFormat {
  if (requested) return requested
  const trimmed = content.trim()
  if (/^[{[]/.test(trimmed)) return "JSON"
  if (/<(?:!doctype|html|head|body|script|meta|div|h1)\b/i.test(trimmed)) {
    return "HTML_AS_TEXT"
  }
  return "TEXT"
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  }
  return value.replace(
    /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,8}));/gi,
    (match, decimal: string, hexadecimal: string, name: string) => {
      const code = decimal
        ? Number(decimal)
        : hexadecimal
          ? Number.parseInt(hexadecimal, 16)
          : null
      if (code !== null && Number.isInteger(code) && code >= 0 &&
        code <= 0x10ffff && ![0xd800, 0xdfff].includes(code)) {
        try {
          return String.fromCodePoint(code)
        } catch {
          return ""
        }
      }
      return named[name?.toLocaleLowerCase("en-US")] ?? match
    },
  )
}

function textFromMarkup(value: string) {
  return normalizeWhitespace(decodeHtmlEntities(
    value
      .replace(
        /<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
        " ",
      )
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]{0,4000}>/g, " "),
  ))
}

function attribute(tag: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = tag.match(new RegExp(
    `\\b${escaped}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`,
    "i",
  ))
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "")
}

function safeImageUrl(value: unknown, sourceUrl: string) {
  if (typeof value !== "string" || !value.trim()) return null
  try {
    const url = new URL(value.trim(), sourceUrl)
    return url.protocol === "https:" ? url.href : null
  } catch {
    return null
  }
}

function pushCandidate(
  target: Candidate[],
  candidate: Candidate,
) {
  const normalized = normalizeFieldValue(
    candidate.field,
    candidate.normalizedValue,
  )
  const stockSignal = candidate.field === "visible_stock" &&
      explicitOutOfStockSignal(candidate.normalizedValue)
    ? "OUT_OF_STOCK" as const
    : candidate.stockSignal
  if (!nonempty(normalized) && !stockSignal) return
  const key = [
    candidate.field,
    candidate.variantKey ?? "",
    stableValue(normalized),
    stockSignal ?? "",
    candidate.extractionPath,
  ].join("|")
  if (target.some((entry) => [
    entry.field,
    entry.variantKey ?? "",
    stableValue(normalizeFieldValue(entry.field, entry.normalizedValue)),
    entry.stockSignal ?? "",
    entry.extractionPath,
  ].join("|") === key)) return
  target.push({
    ...candidate,
    normalizedValue: normalized,
    variantKey: canonicalVariantKey(candidate.variantKey),
    stockSignal,
  })
}

function structuredCandidates(
  input: unknown,
  rootPath: string,
  sourceUrl: string,
): { candidates: Candidate[]; warnings: string[] } {
  const candidates: Candidate[] = []
  const warnings: string[] = []
  const queue: Array<{
    value: unknown
    path: string
    depth: number
    variantKey: string | null
  }> = [{ value: input, path: rootPath, depth: 0, variantKey: null }]
  let visited = 0
  while (queue.length) {
    const current = queue.shift()!
    visited += 1
    if (visited > 5_000) {
      warnings.push("STRUCTURED_NODE_LIMIT_REACHED")
      break
    }
    if (current.depth > 24) {
      warnings.push("STRUCTURED_DEPTH_LIMIT_REACHED")
      continue
    }
    if (Array.isArray(current.value)) {
      current.value.slice(0, 500).forEach((entry, index) => {
        queue.push({
          value: entry,
          path: `${current.path}[${index}]`,
          depth: current.depth + 1,
          variantKey: current.variantKey,
        })
      })
      continue
    }
    const object = record(current.value)
    if (!Object.keys(object).length) continue
    const lowerPath = current.path.toLocaleLowerCase("en-US")
    const isVariant = /(?:variants?|hasvariant)\[\d+\]/.test(lowerPath)
    const localVariantKey = isVariant
      ? canonicalVariantKey(
          object.variant_id ?? object.variantId ?? object.sku ??
            object.id ?? object["@id"] ?? current.variantKey,
        )
      : current.variantKey
    const type = String(object["@type"] ?? object.type ?? "")
      .toLocaleLowerCase("en-US")

    for (const [key, raw] of Object.entries(object)) {
      const normalizedKey = key.replace(/[^a-z0-9]+/gi, "")
        .toLocaleLowerCase("en-US")
      const path = `${current.path}.${key}`
      const add = (
        field: ProductCaseEvidenceField,
        value: unknown = raw,
        variantKey: string | null = localVariantKey,
      ) => pushCandidate(candidates, {
        field,
        rawValue: value,
        normalizedValue: value,
        extractionPath: path,
        variantKey,
      })

      if (normalizedKey === "name") {
        if (/\.brand$/i.test(current.path)) add("brand", raw, null)
        else if (!isVariant && (current.depth === 0 || type === "product")) {
          add("title", raw, null)
        } else if (isVariant) add("option_value", raw)
      } else if (normalizedKey === "brand") {
        const brand = record(raw)
        add("brand", brand.name ?? raw, null)
      } else if (normalizedKey === "model") add("model")
      else if (normalizedKey === "mpn") add("mpn")
      else if (["productid", "productidentifier"].includes(normalizedKey)) {
        add("supplier_product_id", raw, null)
      } else if (normalizedKey === "sku") add("supplier_sku")
      else if (["variantid", "variationid"].includes(normalizedKey) ||
        (normalizedKey === "id" && isVariant)) add("variant_id")
      else if (/^option\d*$/.test(normalizedKey)) {
        add("option_value", raw)
      } else if (normalizedKey === "optionname") add("option_name")
      else if (normalizedKey === "optionvalue") add("option_value")
      else if (normalizedKey === "color" || normalizedKey === "colour") {
        add("color")
      } else if (normalizedKey === "material") add("material")
      else if (["producttype", "itemtype"].includes(normalizedKey)) {
        add("product_type", raw, null)
      } else if (["availablecolors", "availablecolours"].includes(
        normalizedKey,
      )) add("available_colors", raw, null)
      else if (["selectedvariant", "selectedoption"].includes(normalizedKey)) {
        add("selected_variant")
      } else if (["intendedpurpose", "intendeduse"].includes(
        normalizedKey,
      )) add("intended_purpose", raw, null)
      else if (["intendedusers", "targetusers", "audience"].includes(
        normalizedKey,
      )) add("intended_users", raw, null)
      else if (["capacity", "volume"].includes(normalizedKey)) add("capacity")
      else if (["dimensions", "size"].includes(normalizedKey)) add("dimensions")
      else if (["productdimensions", "itemdimensions"].includes(
        normalizedKey,
      )) add("product_dimensions")
      else if (["packagedimensions", "shippingdimensions"].includes(
        normalizedKey,
      )) add("package_dimensions")
      else if (["weight", "shippingweight"].includes(normalizedKey)) add("weight")
      else if (["contents", "includeditems", "packagecontents"].includes(
        normalizedKey,
      )) add("contents")
      else if (["inflationmechanism", "inflationmethod"].includes(
        normalizedKey,
      )) add("inflation_mechanism")
      else if (["accessories", "includedaccessories"].includes(
        normalizedKey,
      )) add("accessories")
      else if (["warning", "warnings", "safetywarning"].includes(
        normalizedKey,
      )) add("warnings")
      else if (["quantityincluded", "includedquantity", "unitcount"]
        .includes(normalizedKey)) add("included_quantity")
      else if (["packquantity", "packcount"].includes(normalizedKey)) {
        add("pack_quantity")
      } else if (["price", "lowprice", "highprice"].includes(normalizedKey)) {
        add("supplier_price")
      } else if (["compareatprice", "regularprice", "listprice"]
        .includes(normalizedKey)) add("regular_price")
      else if (["saleprice", "discountprice"].includes(normalizedKey)) {
        add("sale_price")
      } else if (["pricecurrency", "currency"].includes(normalizedKey)) {
        add("currency", raw, null)
      } else if (["availability", "stock", "inventoryquantity"]
        .includes(normalizedKey)) add("visible_stock")
      else if (normalizedKey === "description") add("description", raw, null)
      else if (["bullet", "bullets", "feature", "features"]
        .includes(normalizedKey)) {
        const values = Array.isArray(raw) ? raw : [raw]
        values.forEach((value, index) => pushCandidate(candidates, {
          field: "bullet",
          rawValue: value,
          normalizedValue: value,
          extractionPath: `${path}[${index}]`,
          variantKey: localVariantKey,
        }))
      } else if (["claim", "claims", "marketingclaim", "marketingclaims"]
        .includes(normalizedKey)) {
        const values = Array.isArray(raw) ? raw : [raw]
        values.forEach((value, index) => pushCandidate(candidates, {
          field: "marketing_claim",
          rawValue: value,
          normalizedValue: value,
          extractionPath: `${path}[${index}]`,
          variantKey: localVariantKey,
          evidenceClass: "SUPPLIER_MARKETING_CLAIM",
        }))
      } else if (["image", "images", "imageurl"].includes(normalizedKey)) {
        const values = Array.isArray(raw) ? raw : [raw]
        values.forEach((entry, index) => {
          const value = typeof entry === "string"
            ? entry
            : record(entry).url ?? record(entry).contentUrl
          const url = safeImageUrl(value, sourceUrl)
          if (url) pushCandidate(candidates, {
            field: "source_image_url",
            rawValue: value,
            normalizedValue: url,
            extractionPath: `${path}[${index}]`,
            variantKey: localVariantKey,
          })
        })
      } else if ([
        "shippingdetails",
        "shippinginfo",
        "shippinginformation",
      ].includes(normalizedKey)) {
        add("product_shipping_statement", raw, null)
      } else if (["fulfillmentquote", "shippingquote"].includes(
        normalizedKey,
      )) {
        add("fulfillment_quote", raw, null)
      } else if (["unitcost", "supplierunitcost"].includes(
        normalizedKey,
      )) add("supplier_unit_cost")
      else if (normalizedKey === "packagingcost") add("packaging_cost")
      else if (["outboundshippingcost", "ordershippingcost"].includes(
        normalizedKey,
      )) add("outbound_shipping_cost")

      if (raw && typeof raw === "object") {
        queue.push({
          value: raw,
          path,
          depth: current.depth + 1,
          variantKey: localVariantKey,
        })
      }
    }
  }
  return { candidates, warnings: unique(warnings) }
}

const TEXT_LABELS: Array<{
  field: ProductCaseEvidenceField
  labels: string[]
}> = [
  {
    field: "title",
    labels: ["title", "product title", "product name", "nombre del producto"],
  },
  { field: "brand", labels: ["brand", "marca"] },
  { field: "model", labels: ["model", "modelo"] },
  { field: "mpn", labels: ["mpn", "manufacturer part number"] },
  {
    field: "supplier_product_id",
    labels: ["product id", "supplier product id", "id de producto"],
  },
  { field: "supplier_sku", labels: ["sku", "supplier sku"] },
  { field: "variant_id", labels: ["variant id", "variation id"] },
  {
    field: "option_value",
    labels: ["variants", "available variants", "declared variants"],
  },
  { field: "color", labels: ["color", "colour"] },
  { field: "material", labels: ["material"] },
  {
    field: "intended_users",
    labels: ["intended users", "target users", "audience"],
  },
  { field: "capacity", labels: ["capacity", "capacidad", "volume"] },
  { field: "dimensions", labels: ["dimensions", "dimensiones", "size"] },
  {
    field: "product_dimensions",
    labels: ["product dimensions", "item dimensions"],
  },
  {
    field: "package_dimensions",
    labels: ["package dimensions", "shipping dimensions"],
  },
  { field: "weight", labels: ["weight", "peso"] },
  {
    field: "contents",
    labels: ["contents", "included items", "package contents"],
  },
  {
    field: "inflation_mechanism",
    labels: ["inflation mechanism", "inflation method"],
  },
  {
    field: "accessories",
    labels: ["accessories", "included accessories"],
  },
  { field: "warnings", labels: ["warnings", "safety warning"] },
  {
    field: "included_quantity",
    labels: ["included quantity", "quantity included", "cantidad incluida"],
  },
  {
    field: "pack_quantity",
    labels: ["pack quantity", "pack count", "cantidad del pack"],
  },
  {
    field: "regular_price",
    labels: ["regular price", "list price", "precio normal"],
  },
  {
    field: "sale_price",
    labels: ["sale price", "offer price", "precio de oferta"],
  },
  {
    field: "supplier_price",
    labels: ["price", "precio", "supplier price"],
  },
  { field: "currency", labels: ["currency", "moneda"] },
  {
    field: "visible_stock",
    labels: ["stock", "availability", "available quantity"],
  },
  {
    field: "product_shipping_statement",
    labels: ["product shipping", "shipping information"],
  },
  {
    field: "fulfillment_quote",
    labels: ["fulfillment quote", "shipping quote"],
  },
  {
    field: "supplier_unit_cost",
    labels: ["supplier unit cost", "unit cost", "costo unitario"],
  },
  {
    field: "packaging_cost",
    labels: ["packaging cost", "costo de empaque"],
  },
  {
    field: "outbound_shipping_cost",
    labels: ["outbound shipping cost", "order shipping cost"],
  },
  {
    field: "marketing_claim",
    labels: [
      "marketing claim",
      "marketing claims",
      "promotional claim",
      "promotional claims",
      "claims",
    ],
  },
]

const SUPPLIER_SPECIFICATION_LABELS = new Set([
  "charging time",
  "charge time",
  "shave time per charge",
  "runtime",
  "autonomy",
  "battery life",
  "ip rating",
  "waterproof rated",
  "water resistance",
  "battery",
  "battery capacity",
  "power",
  "rated power",
  "wattage",
  "voltage",
  "frequency",
  "how to use",
  "charging",
])

function normalizedTextLabel(value: string) {
  return normalizeWhitespace(value)
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9 ]+/g, "")
}

const LUNA_MARKETING_SECTION_TITLES = new Map([
  ["close shave", "Close shave"],
  ["easy to clean", "Easy to clean"],
  ["popup sideburns", "Pop-up sideburns"],
  ["dry and wet shaving", "Dry and wet shaving"],
  ["fast charging and durable", "Fast charging and durable"],
])

function lunaMarketingSectionTitle(value: string) {
  const withoutOrdinal = normalizeWhitespace(value)
    .replace(/^[A-E]\s*[.)-]\s*/i, "")
    .replace(/:\s*$/, "")
  return LUNA_MARKETING_SECTION_TITLES.get(
    normalizedTextLabel(withoutOrdinal),
  ) ?? null
}

type LunaMarketingNarrative = {
  sectionTitle: string
  body: string
}

function lunaMarketingNarrative(
  candidate: Candidate,
): LunaMarketingNarrative | null {
  if (
    candidate.field !== "marketing_claim" ||
    !candidate.normalizedValue ||
    typeof candidate.normalizedValue !== "object"
  ) return null
  const value = candidate.normalizedValue as Record<string, unknown>
  if (
    typeof value.sectionTitle !== "string" ||
    typeof value.body !== "string" ||
    !value.sectionTitle ||
    !value.body
  ) return null
  return {
    sectionTitle: value.sectionTitle,
    body: value.body,
  }
}

function lunaPackingItem(value: string) {
  const match = normalizeWhitespace(value).match(
    /^(\d[\d,]*)\s*(?:\*|×|x)\s*(\S(?:.*\S)?)$/i,
  )
  if (!match) return null
  const quantity = Number(match[1].replaceAll(",", ""))
  if (!Number.isSafeInteger(quantity) || quantity < 1) return null
  return {
    quantity,
    item: normalizeWhitespace(match[2]),
  }
}

function lunaPackingItemIsAccessory(item: string) {
  return /\b(?:cable|brush|manual|case|comb|attachment|accessor)\b/i
    .test(item)
}

function lunaTransformerExclusionWarning(value: string) {
  return /^\(?\s*do\s+not\s+including\s+transformer\s*\/\s*adapter\s*\/\s*charger\s*\)?[.!]*$/i
    .test(normalizeWhitespace(value))
}

function visibleStockFromLine(line: string) {
  const normalized = normalizeWhitespace(line)
  const match = normalized.match(
    /^(?:(\d[\d,]*)\s+units?\s+available|(\d[\d,]*)\s+available|in\s+stock\s*:\s*(\d[\d,]*)(?:\s+units?\s+available)?|stock\s*:\s*(\d[\d,]*)(?:\s+units?\s+available)?)$/i,
  )
  const rawQuantity = match?.slice(1).find(Boolean)
  if (!rawQuantity) return null
  const quantity = Number(rawQuantity.replaceAll(",", ""))
  return Number.isSafeInteger(quantity) && quantity >= 0 ? quantity : null
}

function pushCompactLabeledPriceCandidates(
  target: Candidate[],
  line: string,
  extractionPath: string,
) {
  const pattern =
    /\b(regular\s+price|sale\s+price)\s*[:=-]?\s*([$€£Q]?\s*\d[\d,]*(?:\.\d{1,2})?)\s*([A-Z]{3})(?=\s*(?:regular\s+price|sale\s+price|sale\b|$))/gi
  let matched = false
  for (const match of line.matchAll(pattern)) {
    const field = /^regular/i.test(match[1])
      ? "regular_price"
      : "sale_price"
    const currency = match[3].toLocaleUpperCase("en-US")
    const rawPrice = `${normalizeWhitespace(match[2])} ${currency}`
    pushCandidate(target, {
      field,
      rawValue: rawPrice,
      normalizedValue: match[2],
      extractionPath: `${extractionPath}.${field}`,
      variantKey: null,
    })
    pushCandidate(target, {
      field: "currency",
      rawValue: currency,
      normalizedValue: currency,
      extractionPath: `${extractionPath}.${field}.currency`,
      variantKey: null,
    })
    matched = true
  }
  return matched
}

function isNonTitleInterfaceLine(line: string) {
  const normalized = normalizeWhitespace(line)
  if (
    !normalized ||
    visibleStockFromLine(normalized) !== null ||
    lunaMarketingSectionTitle(normalized) !== null ||
    /^more\s+information\b.*:?\s*$/i.test(normalized) ||
    /^packing\s+include\s*:?\s*$/i.test(normalized) ||
    lunaPackingItem(normalized) !== null ||
    lunaTransformerExclusionWarning(normalized)
  ) return true
  if (
    /^(?:sale(?:\s+\d{1,3}%\s+off)?|out\s+of\s+stock|sold\s+out|add\s+to\s+cart|add\s+to\s+wishlist|pay\s+over\s+time|shop\s+now|learn\s+more|view\s+all|continue\s+shopping)$/i
      .test(normalized)
  ) return true
  if (
    /^(?:home|shop|catalog|products?|collections?|menu|search|account|cart|wishlist|about\s+us|contact\s+us|faq|track\s+(?:my\s+)?order|featured|recommended|you\s+may\s+also\s+like|related\s+products?|frequently\s+bought\s+together|recently\s+viewed|trending\s+now|bundle\s*(?:&|and)\s*save|top\s+sellers?|best\s+sellers?|new\s+arrivals?(?:\s*(?:&|and)\s*restocks?)?)$/i
      .test(normalized)
  ) return true
  if (
    /^(?:(?:regular|sale|list|offer|supplier)?\s*price|currency)\s*[:=-]/i
      .test(normalized) ||
    /^(?:USD|GTQ|EUR|GBP|CAD|AUD)?\s*[$€£Q]\s*\d[\d,.]*(?:\s*[A-Z]{3})?$/i
      .test(normalized) ||
    /^(?:USD|GTQ|EUR|GBP|CAD|AUD)\s+\d[\d,.]*$/i.test(normalized)
  ) return true
  if (
    normalized.length <= 80 &&
    /(?:[$€£Q]\s*\d|\d[\d,.]*\s*(?:USD|GTQ|EUR|GBP|CAD|AUD)\b)/i.test(
      normalized,
    )
  ) return true
  if (/^(?:[-*•]\s*)?[a-z][a-z0-9 /_-]{1,60}\s*[:=-]\s*.+$/i.test(
    normalized,
  )) return true
  if (/[>›]\s*\S/.test(normalized) && normalized.length < 160) return true
  return false
}

function isProductTitleCandidateLine(line: string) {
  const normalized = normalizeWhitespace(line)
  if (
    normalized.length < 4 ||
    normalized.length > 300 ||
    isNonTitleInterfaceLine(normalized)
  ) return false
  const words = normalized.match(/[A-Za-z][A-Za-z0-9'’&+-]*/g) ?? []
  return words.length >= 2
}

type SourceTextLine = {
  rawValue: string
  normalized: string
  start: number
  end: number
}

function sourceTextLines(value: string): SourceTextLine[] {
  const lines: SourceTextLine[] = []
  const pattern = /[^\r\n]*(?:\r\n|\n|\r|$)/g
  for (const match of value.matchAll(pattern)) {
    const fullLine = match[0]
    if (!fullLine) continue
    const rawValue = fullLine.replace(/\r\n$|\n$|\r$/, "")
    const start = match.index ?? 0
    lines.push({
      rawValue,
      normalized: normalizeWhitespace(rawValue),
      start,
      end: start + rawValue.length,
    })
    if (lines.length >= 5_000) break
  }
  return lines
}

function lunaExplicitSpecificationLine(value: string) {
  const generic = normalizeWhitespace(value).match(
    /^(?:[-*•]\s*)?([A-Za-z][A-Za-z0-9 /_-]{1,60})\s*[:=-]\s*(.*)$/,
  )
  return SUPPLIER_SPECIFICATION_LABELS.has(
    normalizedTextLabel(generic?.[1] ?? ""),
  )
}

function lunaNarrativeBoundary(value: string) {
  const normalized = normalizeWhitespace(value)
  return (
    lunaMarketingSectionTitle(normalized) !== null ||
    /^more\s+information\b.*:?\s*$/i.test(normalized) ||
    /^packing\s+include\s*:?\s*$/i.test(normalized) ||
    lunaExplicitSpecificationLine(normalized) ||
    lunaTransformerExclusionWarning(normalized)
  )
}

function normalizedNarrativeBody(lines: SourceTextLine[]) {
  const paragraphs: string[] = []
  let paragraphLines: string[] = []
  const flushParagraph = () => {
    if (!paragraphLines.length) return
    paragraphs.push(paragraphLines.join(" "))
    paragraphLines = []
  }
  for (const line of lines) {
    if (!line.normalized) {
      flushParagraph()
      continue
    }
    paragraphLines.push(line.normalized)
  }
  flushParagraph()
  return paragraphs.join("\n\n")
}

function trimBlankSourceLines(lines: SourceTextLine[]) {
  let start = 0
  let end = lines.length
  while (start < end && !lines[start].normalized) start += 1
  while (end > start && !lines[end - 1].normalized) end -= 1
  return lines.slice(start, end)
}

function pushLunaMarketingNarrative(
  target: Candidate[],
  visibleText: string,
  lines: SourceTextLine[],
  sectionTitle: string,
  headingLineIndex: number | null,
  bodyStartIndex: number,
  bodyEndIndex: number,
  extractionPath: string,
) {
  const bodyLines = trimBlankSourceLines(
    lines.slice(bodyStartIndex, bodyEndIndex),
  )
  const body = normalizedNarrativeBody(bodyLines)
  if (!body || bodyLines.length === 0) return
  const rawStart = headingLineIndex === null
    ? bodyLines[0].start
    : lines[headingLineIndex].start
  const rawEnd = bodyLines.at(-1)?.end ?? rawStart
  pushCandidate(target, {
    field: "marketing_claim",
    rawValue: visibleText.slice(rawStart, rawEnd),
    normalizedValue: { sectionTitle, body },
    extractionPath,
    variantKey: null,
    evidenceClass: "SUPPLIER_MARKETING_CLAIM",
  })
}

function lunaMarketingNarrativeCandidates(
  visibleText: string,
  pathPrefix: string,
) {
  const candidates: Candidate[] = []
  const lines = sourceTextLines(visibleText)
  const firstNarrativeBoundaryIndex = lines.findIndex((line) =>
    lunaNarrativeBoundary(line.normalized)
  )
  const firstNarrativeBoundary = firstNarrativeBoundaryIndex >= 0
    ? firstNarrativeBoundaryIndex
    : lines.length
  const priceLineIndex = lines.findIndex((line) =>
    /\b(?:regular|sale)\s+price\b/i.test(line.normalized)
  )
  const titleLineIndex = lines.findIndex((line, index) =>
    index < firstNarrativeBoundary &&
    isProductTitleCandidateLine(line.normalized)
  )
  const introductionStart = Math.max(priceLineIndex, titleLineIndex) + 1
  if (
    priceLineIndex >= 0 &&
    titleLineIndex >= 0 &&
    introductionStart < firstNarrativeBoundary
  ) {
    pushLunaMarketingNarrative(
      candidates,
      visibleText,
      lines,
      "Supplier introduction",
      null,
      introductionStart,
      firstNarrativeBoundary,
      `${pathPrefix}.marketing_claim.introduction`,
    )
  }

  for (const [lineIndex, line] of lines.entries()) {
    const sectionTitle = lunaMarketingSectionTitle(line.normalized)
    if (!sectionTitle) continue
    let bodyEndIndex = lineIndex + 1
    while (
      bodyEndIndex < lines.length &&
      !lunaNarrativeBoundary(lines[bodyEndIndex].normalized)
    ) bodyEndIndex += 1
    pushLunaMarketingNarrative(
      candidates,
      visibleText,
      lines,
      sectionTitle,
      lineIndex,
      lineIndex + 1,
      bodyEndIndex,
      `${pathPrefix}.line[${lineIndex}].marketing_claim.section`,
    )
  }
  return candidates
}

function labeledTextCandidates(
  visibleText: string,
  pathPrefix: string,
): Candidate[] {
  const candidates = lunaMarketingNarrativeCandidates(
    visibleText,
    pathPrefix,
  )
  const lines = visibleText.split(/\r?\n|[|•]/)
    .map((rawValue) => ({
      rawValue: rawValue.trim(),
      line: normalizeWhitespace(rawValue),
    }))
    .filter((entry) => Boolean(entry.line))
    .slice(0, 5_000)
  let packingIncludeActive = false
  for (const [lineIndex, sourceLine] of lines.entries()) {
    const { line, rawValue } = sourceLine
    if (/^packing\s+include\s*:?\s*$/i.test(line)) {
      packingIncludeActive = true
      continue
    }
    if (packingIncludeActive) {
      const packingItem = lunaPackingItem(line)
      if (packingItem) {
        const itemPath =
          `${pathPrefix}.line[${lineIndex}].packing_include`
        pushCandidate(candidates, {
          field: "contents",
          rawValue,
          normalizedValue: packingItem,
          extractionPath: `${itemPath}.contents`,
          variantKey: null,
        })
        if (lunaPackingItemIsAccessory(packingItem.item)) {
          pushCandidate(candidates, {
            field: "accessories",
            rawValue,
            normalizedValue: packingItem,
            extractionPath: `${itemPath}.accessories`,
            variantKey: null,
          })
        }
        continue
      }
      packingIncludeActive = false
    }
    const visibleStock = visibleStockFromLine(line)
    if (visibleStock !== null) {
      pushCandidate(candidates, {
        field: "visible_stock",
        rawValue: line,
        normalizedValue: visibleStock,
        extractionPath: `${pathPrefix}.line[${lineIndex}].visible_stock`,
        variantKey: null,
      })
      continue
    }
    if (explicitOutOfStockSignal(line)) {
      pushCandidate(candidates, {
        field: "visible_stock",
        rawValue: line,
        normalizedValue: line,
        extractionPath:
          `${pathPrefix}.line[${lineIndex}].out_of_stock_signal`,
        variantKey: null,
      })
      continue
    }
    const marketingSectionTitle = lunaMarketingSectionTitle(line)
    if (marketingSectionTitle) {
      continue
    }
    if (lunaTransformerExclusionWarning(line)) {
      pushCandidate(candidates, {
        field: "warnings",
        rawValue,
        normalizedValue: line,
        extractionPath:
          `${pathPrefix}.line[${lineIndex}].transformer_exclusion_warning`,
        variantKey: null,
        evidenceClass: "SUPPLIER_STATED",
      })
      continue
    }
    if (pushCompactLabeledPriceCandidates(
      candidates,
      line,
      `${pathPrefix}.line[${lineIndex}]`,
    )) continue
    let knownLabelMatched = false
    for (const definition of TEXT_LABELS) {
      for (const label of definition.labels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        const match = line.match(
          new RegExp(`^(?:[-*•]\\s*)?${escaped}\\s*[:=\\-]\\s*(.+)$`, "i"),
        )
        if (!match?.[1]) continue
        pushCandidate(candidates, {
          field: definition.field,
          rawValue: match[1],
          normalizedValue: match[1],
          extractionPath: `${pathPrefix}.line[${lineIndex}].${definition.field}`,
          variantKey: null,
          evidenceClass: definition.field === "marketing_claim"
            ? "SUPPLIER_MARKETING_CLAIM"
            : undefined,
        })
        knownLabelMatched = true
        break
      }
      if (knownLabelMatched) break
    }
    if (knownLabelMatched) continue
    const generic = line.match(
      /^(?:[-*•]\s*)?([A-Za-z][A-Za-z0-9 /_-]{1,60})\s*[:=-]\s*(.+)$/,
    )
    const label = normalizedTextLabel(generic?.[1] ?? "")
    if (!generic?.[2] || !SUPPLIER_SPECIFICATION_LABELS.has(label)) continue
    pushCandidate(candidates, {
      field: "supplier_specification",
      rawValue: line,
      normalizedValue: `${normalizeWhitespace(generic[1])}: ${
        normalizeWhitespace(generic[2])
      }`,
      extractionPath:
        `${pathPrefix}.line[${lineIndex}].supplier_specification.${label.replaceAll(" ", "_")}`,
      variantKey: null,
      evidenceClass: "SUPPLIER_STATED",
    })
  }
  return candidates
}

function htmlCandidates(
  content: string,
  sourceUrl: string,
): { candidates: Candidate[]; warnings: string[] } {
  const candidates: Candidate[] = []
  const warnings: string[] = []
  const jsonLdPattern =
    /<script\b[^>]*\btype\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json)[^>]*>([\s\S]*?)<\/script\s*>/gi
  let jsonLdMatch: RegExpExecArray | null
  let jsonLdIndex = 0
  while ((jsonLdMatch = jsonLdPattern.exec(content)) && jsonLdIndex < 20) {
    try {
      const parsed: unknown = JSON.parse(jsonLdMatch[1])
      const extracted = structuredCandidates(
        parsed,
        `html.jsonld[${jsonLdIndex}]`,
        sourceUrl,
      )
      candidates.push(...extracted.candidates)
      warnings.push(...extracted.warnings)
    } catch {
      warnings.push(`JSON_LD_INVALID:${jsonLdIndex}`)
    }
    jsonLdIndex += 1
  }

  const title = textFromMarkup(
    content.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? "",
  )
  if (title && isProductTitleCandidateLine(title)) pushCandidate(candidates, {
    field: "title",
    rawValue: title,
    normalizedValue: title,
    extractionPath: "html.title",
  })
  const h1 = textFromMarkup(
    content.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i)?.[1] ?? "",
  )
  if (h1 && isProductTitleCandidateLine(h1)) pushCandidate(candidates, {
    field: "title",
    rawValue: h1,
    normalizedValue: h1,
    extractionPath: "html.h1[0]",
  })

  const metaTags = content.match(/<meta\b[^>]{0,4000}>/gi) ?? []
  metaTags.slice(0, 500).forEach((tag, index) => {
    const key = (attribute(tag, "property") || attribute(tag, "name"))
      .toLocaleLowerCase("en-US")
    const value = attribute(tag, "content")
    if (!value) return
    const fields: Partial<Record<string, ProductCaseEvidenceField>> = {
      "og:title": "title",
      "twitter:title": "title",
      "og:description": "description",
      description: "description",
      "product:price:amount": "supplier_price",
      "product:sale_price:amount": "sale_price",
      "product:original_price:amount": "regular_price",
      "product:price:currency": "currency",
      "product:availability": "visible_stock",
      "og:image": "source_image_url",
      "twitter:image": "source_image_url",
    }
    const field = fields[key]
    if (!field) return
    const normalized = field === "source_image_url"
      ? safeImageUrl(value, sourceUrl)
      : value
    pushCandidate(candidates, {
      field,
      rawValue: value,
      normalizedValue: normalized,
      extractionPath: `html.meta[${index}].${key}`,
    })
  })

  const imageTags = content.match(/<img\b[^>]{0,8000}>/gi) ?? []
  imageTags.slice(0, 48).forEach((tag, index) => {
    const raw = attribute(tag, "src") || attribute(tag, "data-src")
    const url = safeImageUrl(raw, sourceUrl)
    if (!url) return
    pushCandidate(candidates, {
      field: "source_image_url",
      rawValue: raw,
      normalizedValue: url,
      extractionPath: `html.img[${index}].src`,
    })
  })

  const listItems = content.match(/<li\b[^>]*>[\s\S]*?<\/li\s*>/gi) ?? []
  listItems.slice(0, 100).forEach((item, index) => {
    const text = textFromMarkup(item)
    if (!text) return
    pushCandidate(candidates, {
      field: "bullet",
      rawValue: text,
      normalizedValue: text,
      extractionPath: `html.li[${index}]`,
    })
  })

  const visibleText = content
    .replace(
      /<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      "\n",
    )
    .replace(/<\/(?:p|div|li|section|h[1-6]|tr|br)\s*>/gi, "\n")
    .replace(/<[^>]{0,4000}>/g, " ")
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(decodeHtmlEntities(line)))
    .filter(Boolean)
    .join("\n")
  candidates.push(...labeledTextCandidates(visibleText, "html.visibleText"))

  if (/\btop\s+sellers?\b/i.test(visibleText)) {
    pushCandidate(candidates, {
      field: "supplier_merchandising_signal",
      rawValue: "Top Sellers",
      normalizedValue: "TOP_SELLERS",
      extractionPath: "html.visibleText.merchandising",
      evidenceClass: "SUPPLIER_MERCHANDISING_SIGNAL",
    })
  }
  if (/\bnew\s+arrivals?\s*(?:&|and)\s*restocks?\b/i.test(
    visibleText,
  )) {
    pushCandidate(candidates, {
      field: "supplier_merchandising_signal",
      rawValue: "New Arrivals & Restocks",
      normalizedValue: "NEW_ARRIVALS_AND_RESTOCKS",
      extractionPath: "html.visibleText.merchandising",
      evidenceClass: "SUPPLIER_MERCHANDISING_SIGNAL",
    })
  }
  return { candidates, warnings: unique(warnings) }
}

function plainTextCandidates(content: string): Candidate[] {
  const normalized = content.split(/\r?\n/)
    .map(normalizeWhitespace)
    .filter(Boolean)
    .slice(0, 5_000)
  const candidates = labeledTextCandidates(
    content,
    "text",
  )
  const marketingNarrativeLines = new Set(
    candidates.filter((candidate) =>
      candidate.field === "marketing_claim" &&
      typeof candidate.rawValue === "string"
    ).flatMap((candidate) =>
      String(candidate.rawValue).split(/\r?\n/)
        .map(normalizeWhitespace)
        .filter(Boolean)
    ),
  )
  const titleLineIndex = normalized.findIndex((line) =>
    !marketingNarrativeLines.has(line) &&
    isProductTitleCandidateLine(line)
  )
  const titleLine = normalized[titleLineIndex]
  if (titleLineIndex >= 0 && titleLine) {
    pushCandidate(candidates, {
      field: "title",
      rawValue: titleLine,
      normalizedValue: titleLine,
      extractionPath: `text.line[${titleLineIndex}]`,
    })
  }
  normalized.forEach((line, index) => {
    if (/^[-*•]\s+/.test(line)) {
      pushCandidate(candidates, {
        field: "bullet",
        rawValue: line,
        normalizedValue: line.replace(/^[-*•]\s+/, ""),
        extractionPath: `text.line[${index}].bullet`,
      })
    }
  })
  if (/\btop\s+sellers?\b/i.test(content)) {
    pushCandidate(candidates, {
      field: "supplier_merchandising_signal",
      rawValue: "Top Sellers",
      normalizedValue: "TOP_SELLERS",
      extractionPath: "text.merchandising",
      evidenceClass: "SUPPLIER_MERCHANDISING_SIGNAL",
    })
  }
  if (/\bnew\s+arrivals?\s*(?:&|and)\s*restocks?\b/i.test(content)) {
    pushCandidate(candidates, {
      field: "supplier_merchandising_signal",
      rawValue: "New Arrivals & Restocks",
      normalizedValue: "NEW_ARRIVALS_AND_RESTOCKS",
      extractionPath: "text.merchandising",
      evidenceClass: "SUPPLIER_MERCHANDISING_SIGNAL",
    })
  }
  return candidates
}

function lunaStockStateFromCandidates(
  candidates: Candidate[],
): LunaStockState {
  const quantities = [...new Set(candidates
    .filter((candidate) => candidate.field === "visible_stock")
    .map((candidate) =>
      normalizeFieldValue("visible_stock", candidate.normalizedValue)
    )
    .filter((value): value is number =>
      typeof value === "number" && Number.isFinite(value)
    ))]
  const hasPositiveQuantity = quantities.some((quantity) => quantity > 0)
  const hasZeroQuantity = quantities.includes(0)
  const hasExplicitOutOfStock = candidates.some((candidate) =>
    candidate.stockSignal === "OUT_OF_STOCK"
  )
  if (
    quantities.length > 1 ||
    (hasPositiveQuantity && (hasZeroQuantity || hasExplicitOutOfStock))
  ) return "STOCK_CONFLICTED"
  if (hasPositiveQuantity) return "IN_STOCK_SIGNAL"
  if (hasZeroQuantity || hasExplicitOutOfStock) {
    return "OUT_OF_STOCK_SIGNAL"
  }
  return "STOCK_UNKNOWN"
}

const LUNA_REQUIRED_SPECIFICATION_LABELS = [
  ["SHAVE_TIME_PER_CHARGE", "shave time per charge"],
  ["WATERPROOF_RATED", "waterproof rated"],
  ["RATED_POWER", "rated power"],
  ["HOW_TO_USE", "how to use"],
  ["CHARGING", "charging"],
] as const

function lunaSourceContractLines(content: string) {
  return content.split(/\r?\n|[|•]/)
    .map(normalizeWhitespace)
    .filter(Boolean)
    .slice(0, 5_000)
}

function lineHasLunaLabel(line: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(
    `^(?:[-*•]\\s*)?${escaped}\\s*(?::|=|-)`,
    "i",
  ).test(line)
}

function candidatePreservesRawLine(
  candidates: Candidate[],
  field: ProductCaseEvidenceField,
  line: string,
) {
  return candidates.some((candidate) =>
    candidate.field === field &&
    typeof candidate.rawValue === "string" &&
    normalizeWhitespace(candidate.rawValue) === line
  )
}

function lunaSourceContractSignalFailures(
  content: string,
  presentCandidates: Candidate[],
  sourceCandidates: Candidate[],
  stockState: LunaStockState,
) {
  const fields = new Set(presentCandidates.map((candidate) => candidate.field))
  const lines = lunaSourceContractLines(content)
  const failures: string[] = []
  if (/\bregular\s+price\b/i.test(content) &&
    !fields.has("regular_price")) {
    failures.push("REGULAR_PRICE")
  }
  if (/\bsale\s+price\b/i.test(content) && !fields.has("sale_price")) {
    failures.push("SALE_PRICE")
  }
  if (/\bunits?\s+available\b/i.test(content) &&
    !fields.has("visible_stock")) {
    failures.push("VISIBLE_STOCK")
  }
  if (
    sourceCandidates.some((candidate) =>
      candidate.stockSignal === "OUT_OF_STOCK"
    ) &&
    !["OUT_OF_STOCK_SIGNAL", "STOCK_CONFLICTED"].includes(stockState)
  ) {
    failures.push("OUT_OF_STOCK")
  }
  for (const [failureCode, label] of LUNA_REQUIRED_SPECIFICATION_LABELS) {
    for (const line of lines.filter((entry) =>
      lineHasLunaLabel(entry, label)
    )) {
      if (!candidatePreservesRawLine(
        sourceCandidates,
        "supplier_specification",
        line,
      )) failures.push(failureCode)
    }
  }
  for (const line of lines) {
    if (
      lunaTransformerExclusionWarning(line) &&
      !candidatePreservesRawLine(sourceCandidates, "warnings", line)
    ) failures.push("TRANSFORMER_EXCLUSION_WARNING")

    const marketingSectionTitle = lunaMarketingSectionTitle(line)
    if (
      marketingSectionTitle &&
      !sourceCandidates.some((candidate) =>
        lunaMarketingNarrative(candidate)?.sectionTitle ===
          marketingSectionTitle
      )
    ) failures.push(
      `MARKETING_SECTION_${normalizedTextLabel(marketingSectionTitle)
        .replaceAll(" ", "_").toLocaleUpperCase("en-US")}`,
    )

    const packingItem = lunaPackingItem(line)
    if (
      packingItem &&
      !candidatePreservesRawLine(sourceCandidates, "contents", line)
    ) failures.push("PACKING_INCLUDE_ITEM")
    if (
      packingItem &&
      lunaPackingItemIsAccessory(packingItem.item) &&
      !candidatePreservesRawLine(sourceCandidates, "accessories", line)
    ) failures.push("PACKING_INCLUDE_ACCESSORY")
  }
  if (
    lines.some((line) => /^packing\s+include\s*:?\s*$/i.test(line)) &&
    !sourceCandidates.some((candidate) =>
      candidate.field === "contents" &&
      candidate.extractionPath.includes(".packing_include.")
    )
  ) failures.push("PACKING_INCLUDE")
  return unique(failures)
}

function candidateConflictKey(candidate: Candidate) {
  if (!CONFLICT_FIELDS.has(candidate.field)) return null
  return [
    candidate.field,
    canonicalVariantKey(candidate.variantKey) ?? "PRODUCT",
  ].join(":")
}

function conflictsForEvidence(
  evidence: ProductCaseEvidence[],
): ProductCaseConflict[] {
  const groups = new Map<string, ProductCaseEvidence[]>()
  for (const entry of evidence) {
    if (entry.evidenceStatus === "MISSING") continue
    const conflictKey = CONFLICT_FIELDS.has(entry.field)
      ? `canonical:${entry.field}:${
          canonicalVariantKey(entry.variantKey) ?? "PRODUCT"
        }`
      : entry.conflictKey
    if (!conflictKey) continue
    const group = groups.get(conflictKey) ?? []
    group.push(entry)
    groups.set(conflictKey, group)
  }
  const conflicts: ProductCaseConflict[] = []
  for (const [conflictKey, entries] of groups.entries()) {
    const active = entries.filter((entry) =>
      entry.humanVerdict !== "REJECT"
    )
    const activeValues = new Set(active.map((entry) =>
      stableValue(effectiveEvidenceValue(entry))
    ))
    const allValues = unique(entries.map((entry) =>
      stableValue(effectiveEvidenceValue(entry))
    ))
    if (allValues.length < 2) continue
    conflicts.push({
      conflictKey,
      field: entries[0].field,
      variantKey: entries[0].variantKey,
      evidenceIds: entries.map((entry) => entry.id),
      values: entries.map(effectiveEvidenceValue),
      status: activeValues.size <= 1 &&
          entries.some((entry) => entry.humanVerdict === "REJECT")
        ? "HUMAN_RESOLVED"
        : "OPEN",
    })
  }
  return conflicts.sort((left, right) =>
    left.conflictKey.localeCompare(right.conflictKey)
  )
}

function markConflicts(evidence: ProductCaseEvidence[]) {
  const conflicts = conflictsForEvidence(evidence)
  const open = new Set(
    conflicts.filter((entry) => entry.status === "OPEN")
      .map((entry) => entry.conflictKey),
  )
  return evidence.map((entry): ProductCaseEvidence => {
    if (entry.humanVerdict === "REJECT") return entry
    const canonicalConflictKey = CONFLICT_FIELDS.has(entry.field)
      ? `canonical:${entry.field}:${
          canonicalVariantKey(entry.variantKey) ?? "PRODUCT"
        }`
      : entry.conflictKey
    if (canonicalConflictKey && open.has(canonicalConflictKey)) {
      return {
        ...entry,
        evidenceClass: "CONFLICTED",
        evidenceStatus: "CONFLICTED",
      }
    }
    if (entry.evidenceStatus !== "CONFLICTED") return entry
    return {
      ...entry,
      evidenceClass: entry.sourceEvidenceClass,
      evidenceStatus: entry.humanVerdict === "ACCEPT"
        ? "ACCEPTED"
        : entry.humanVerdict === "CORRECT"
          ? "CORRECTED"
          : "PROPOSED",
    }
  })
}

export async function extractProductCaseEvidence(input: {
  sourceUrl: string
  capturedAt: string
  content: string
  format?: ProductCaseContentFormat
  sourceType?: ProductCaseSourceType
}): Promise<ProductCaseExtractionResult> {
  const validatedUrl = validateLunaProductUrl(input.sourceUrl)
  if (!validatedUrl.valid) throw new Error(validatedUrl.error)
  if (!validIsoInstant(input.capturedAt)) {
    throw new Error("PRODUCT_CASE_CAPTURED_AT_INVALID")
  }
  if (typeof input.content !== "string") {
    throw new Error("PRODUCT_CASE_CONTENT_REQUIRED")
  }
  const byteLength = utf8Length(input.content)
  if (byteLength > PRODUCT_CASE_CONTENT_MAX_BYTES) {
    throw new Error("PRODUCT_CASE_CONTENT_TOO_LARGE")
  }
  if (!input.content.trim()) throw new Error("PRODUCT_CASE_CONTENT_REQUIRED")

  const format = detectFormat(input.content, input.format)
  const contentHash = await hashProductCaseContent(input.content)
  const sourceType = input.sourceType ?? "LUNA_MANUAL_CAPTURE"
  let candidates: Candidate[] = []
  let parserWarnings: string[] = []

  if (format === "HTML_AS_TEXT") {
    const result = htmlCandidates(input.content, validatedUrl.canonicalUrl)
    candidates = result.candidates
    parserWarnings = result.warnings
  } else if (format === "JSON" || format === "JSON_LD") {
    try {
      const parsed: unknown = JSON.parse(input.content)
      const result = structuredCandidates(
        parsed,
        format === "JSON_LD" ? "jsonld" : "json",
        validatedUrl.canonicalUrl,
      )
      candidates = result.candidates
      parserWarnings = result.warnings
    } catch {
      parserWarnings.push("STRUCTURED_CONTENT_INVALID")
      candidates = plainTextCandidates(input.content)
    }
  } else {
    candidates = plainTextCandidates(input.content)
  }

  const stockState = lunaStockStateFromCandidates(candidates)
  const deduped = new Map<string, Candidate>()
  for (const candidate of candidates) {
    const normalizedValue = normalizeFieldValue(
      candidate.field,
      candidate.normalizedValue,
    )
    if (!nonempty(normalizedValue)) continue
    const key = [
      candidate.field,
      canonicalVariantKey(candidate.variantKey) ?? "",
      stableValue(normalizedValue),
    ].join("|")
    if (!deduped.has(key)) deduped.set(key, {
      ...candidate,
      normalizedValue,
    })
  }

  const present = [...deduped.values()]
  const sourceContractFailures = lunaSourceContractSignalFailures(
    input.content,
    present,
    candidates,
    stockState,
  )
  parserWarnings.push(...sourceContractFailures.map((failure) =>
    `LUNA_SOURCE_CONTRACT_UNEXTRACTED:${failure}`
  ))
  const parseHealth: LunaSourceParseHealth =
    sourceContractFailures.length > 0
      ? "SOURCE_FORMAT_CHANGED"
      : parserWarnings.length > 0 || present.length === 0
        ? "PARTIAL_EXTRACTION"
        : "PARSED_OK"
  const evidence: ProductCaseEvidence[] = present.map((candidate, index) => {
    const sourceEvidenceClass = candidate.evidenceClass ??
      "SUPPLIER_STATED"
    return {
      id: `pcr-${contentHash.slice(7, 19)}-${String(index + 1)
        .padStart(3, "0")}`,
      field: candidate.field,
      label: FIELD_LABELS[candidate.field],
      variantKey: canonicalVariantKey(candidate.variantKey),
      sourceType,
      sourceUrl: validatedUrl.canonicalUrl,
      capturedAt: input.capturedAt,
      contentHash,
      extractionPath: candidate.extractionPath,
      extractionMethod: format === "JSON" || format === "JSON_LD"
        ? "JSON_PATH"
        : format === "HTML_AS_TEXT"
          ? candidate.extractionPath.startsWith("html.meta")
            ? "HTML_META"
            : "HTML_TEXT_PATTERN"
          : "PLAIN_TEXT_PATTERN",
      rawValue: candidate.rawValue,
      normalizedValue: candidate.normalizedValue,
      evidenceClass: sourceEvidenceClass,
      sourceEvidenceClass,
      evidenceStatus: "PROPOSED",
      humanVerdict: "UNREVIEWED",
      humanReason: null,
      originalValue: candidate.rawValue,
      correctedValue: null,
      conflictKey: candidateConflictKey(candidate),
      availabilityPurpose: candidate.field === "visible_stock"
        ? "INVENTORY_SIGNAL"
        : null,
      demandEvidence: candidate.field === "visible_stock" ? "NONE" : null,
    }
  })

  for (const field of PRODUCT_CASE_EVIDENCE_FIELDS) {
    if (evidence.some((entry) => entry.field === field)) continue
    const missingIndex = evidence.length + 1
    evidence.push({
      id: `pcr-${contentHash.slice(7, 19)}-${String(missingIndex)
        .padStart(3, "0")}`,
      field,
      label: FIELD_LABELS[field],
      variantKey: null,
      sourceType,
      sourceUrl: validatedUrl.canonicalUrl,
      capturedAt: input.capturedAt,
      contentHash,
      extractionPath: `missing.${field}`,
      extractionMethod: "MISSING",
      rawValue: null,
      normalizedValue: null,
      evidenceClass: "MISSING",
      sourceEvidenceClass: "MISSING",
      evidenceStatus: "MISSING",
      humanVerdict: "UNREVIEWED",
      humanReason: null,
      originalValue: null,
      correctedValue: null,
      conflictKey: CONFLICT_FIELDS.has(field)
        ? `${field}:PRODUCT`
        : null,
      availabilityPurpose: field === "visible_stock"
        ? "INVENTORY_SIGNAL"
        : null,
      demandEvidence: field === "visible_stock" ? "NONE" : null,
    })
  }

  const withConflicts = markConflicts(evidence)
  return {
    capture: {
      sourceType,
      sourceUrl: validatedUrl.canonicalUrl,
      capturedAt: input.capturedAt,
      contentHash,
      parserVersion: PRODUCT_CASE_PARSER_VERSION,
      sourceContractVersion: LUNA_SOURCE_CONTRACT_VERSION,
      parseHealth,
      stockState,
      format,
      byteLength,
      fullContentStored: false,
      scriptsExecuted: false,
      resourcesLoaded: false,
    },
    parserVersion: PRODUCT_CASE_PARSER_VERSION,
    sourceContractVersion: LUNA_SOURCE_CONTRACT_VERSION,
    parseHealth,
    stockState,
    evidence: withConflicts,
    conflicts: conflictsForEvidence(withConflicts),
    missingFields: PRODUCT_CASE_EVIDENCE_FIELDS.filter((field) =>
      !withConflicts.some((entry) =>
        entry.field === field && nonempty(effectiveEvidenceValue(entry))
      )
    ),
    parserWarnings: unique(parserWarnings),
    safety: PRODUCT_CASE_ZERO_EFFECTS,
  }
}

export const analyzeProductCaseManualCapture = extractProductCaseEvidence

export function effectiveEvidenceValue(entry: ProductCaseEvidence) {
  return entry.humanVerdict === "CORRECT"
    ? entry.correctedValue
    : entry.normalizedValue
}

function reviewReason(value: unknown) {
  return typeof value === "string"
    ? normalizeWhitespace(value).slice(0, 1_000)
    : ""
}

export function applyProductCaseEvidenceReview(
  evidence: ProductCaseEvidence[],
  input: {
    evidenceId: string
    action: Exclude<ProductCaseHumanVerdict, "UNREVIEWED">
    reason?: string
    correctedValue?: unknown
  },
) {
  const index = evidence.findIndex((entry) => entry.id === input.evidenceId)
  if (index < 0) throw new Error("PRODUCT_CASE_EVIDENCE_NOT_FOUND")
  const reason = reviewReason(input.reason)
  if (["REJECT", "CORRECT"].includes(input.action) && !reason) {
    throw new Error("PRODUCT_CASE_HUMAN_REASON_REQUIRED")
  }
  if (input.action === "CORRECT" &&
    (input.correctedValue === undefined || input.correctedValue === null ||
      input.correctedValue === "")) {
    throw new Error("PRODUCT_CASE_CORRECTED_VALUE_REQUIRED")
  }
  const current = evidence[index]
  const next = [...evidence]
  if (input.action === "ACCEPT") {
    if (!nonempty(current.normalizedValue) ||
      current.evidenceStatus === "MISSING") {
      throw new Error("PRODUCT_CASE_MISSING_EVIDENCE_CANNOT_BE_ACCEPTED")
    }
    next[index] = {
      ...current,
      humanVerdict: "ACCEPT",
      humanReason: reason || null,
      correctedValue: null,
      evidenceStatus: current.evidenceStatus === "CONFLICTED"
        ? "CONFLICTED"
        : "ACCEPTED",
    }
  } else if (input.action === "REJECT") {
    next[index] = {
      ...current,
      humanVerdict: "REJECT",
      humanReason: reason,
      correctedValue: null,
      evidenceStatus: "REJECTED",
    }
  } else if (input.action === "CORRECT") {
    const normalizedCorrection = normalizeFieldValue(
      current.field,
      input.correctedValue,
    )
    if (!nonempty(normalizedCorrection)) {
      throw new Error("PRODUCT_CASE_CORRECTED_VALUE_INVALID")
    }
    next[index] = {
      ...current,
      humanVerdict: "CORRECT",
      humanReason: reason,
      correctedValue: normalizedCorrection,
      sourceType: "HUMAN_CORRECTION",
      sourceEvidenceClass: "HUMAN_HYPOTHESIS",
      evidenceClass: current.evidenceStatus === "CONFLICTED"
        ? "CONFLICTED"
        : "HUMAN_HYPOTHESIS",
      evidenceStatus: current.evidenceStatus === "CONFLICTED"
        ? "CONFLICTED"
        : "CORRECTED",
    }
  } else {
    next[index] = {
      ...current,
      humanVerdict: "NEEDS_MORE_EVIDENCE",
      humanReason: reason || null,
      correctedValue: null,
      evidenceStatus: "NEEDS_MORE_EVIDENCE",
    }
  }
  return markConflicts(next)
}

export const applyHumanEvidenceReview = applyProductCaseEvidenceReview

export function reevaluateProductCaseEvidence(
  evidence: ProductCaseEvidence[],
) {
  return markConflicts(evidence.map((entry) => ({ ...entry })))
}

export function mergeProductCaseEvidenceCaptures(
  current: ProductCaseEvidence[],
  added: ProductCaseEvidence[],
) {
  const merged = new Map<string, ProductCaseEvidence>()
  for (const entry of [...current, ...added]) {
    const key = [
      entry.sourceUrl,
      entry.contentHash,
      entry.extractionPath,
      entry.field,
      entry.variantKey ?? "",
    ].join("|")
    const existing = merged.get(key)
    if (!existing ||
      (existing.humanVerdict === "UNREVIEWED" &&
        entry.humanVerdict !== "UNREVIEWED")) {
      merged.set(key, { ...entry })
    }
  }
  return reevaluateProductCaseEvidence([...merged.values()])
}

export const mergeProductCaseEvidence = mergeProductCaseEvidenceCaptures

export function acceptedProductCaseEvidence(
  evidence: ProductCaseEvidence[],
) {
  return evidence.filter((entry) =>
    ["ACCEPT", "CORRECT"].includes(entry.humanVerdict) &&
    ["ACCEPTED", "CORRECTED"].includes(entry.evidenceStatus) &&
    !["CONFLICTED", "MISSING"].includes(entry.evidenceClass) &&
    nonempty(effectiveEvidenceValue(entry))
  )
}

function evidencePurpose(field: ProductCaseEvidenceField): EvidencePurpose[] {
  if ([
    "supplier_unit_cost",
    "packaging_cost",
    "outbound_shipping_cost",
  ].includes(field)) return ["ECONOMICS"]
  if ([
    "title",
    "brand",
    "model",
    "mpn",
    "supplier_product_id",
    "supplier_sku",
    "variant_id",
    "option_name",
    "option_value",
    "color",
    "material",
    "capacity",
    "pack_quantity",
  ].includes(field)) return ["IDENTITY"]
  if ([
    "dimensions",
    "product_dimensions",
    "package_dimensions",
    "weight",
  ].includes(field)) {
    return ["COMPATIBILITY", "ECONOMICS"]
  }
  if (["source_image_url"].includes(field)) return ["CREATIVE"]
  return []
}

function economicCostForField(
  field: ProductCaseEvidenceField,
  variantKey: string | null,
): EvidenceInput["economicCost"] {
  if (field === "supplier_unit_cost") {
    return {
      component: "PRODUCT_UNIT_COST",
      currency: "USD",
      basis: "PER_UNIT",
      variantKeys: variantKey ? [variantKey] : undefined,
    }
  }
  if (field === "packaging_cost") {
    return {
      component: "PACKAGING_COST",
      currency: "USD",
      basis: "PER_ORDER",
    }
  }
  if (field === "outbound_shipping_cost") {
    return {
      component: "OUTBOUND_SHIPPING_COST",
      currency: "USD",
      basis: "PER_ORDER",
    }
  }
  return null
}

function strategyEvidenceField(field: ProductCaseEvidenceField) {
  const mapping: Partial<Record<ProductCaseEvidenceField, string>> = {
    supplier_product_id: "supplier_product_id",
    supplier_sku: "supplier_sku",
    variant_id: "variant_id",
    supplier_unit_cost: "supplier_unit_cost",
    packaging_cost: "packaging_cost",
    outbound_shipping_cost: "outbound_shipping_cost",
  }
  return mapping[field] ?? field
}

function runnerEvidenceToStrategy(
  entry: ProductCaseEvidence,
): EvidenceInput | null {
  if ([
    "SUPPLIER_MERCHANDISING_SIGNAL",
    "SUPPLIER_MARKETING_CLAIM",
    "HUMAN_VISUAL_REVIEW",
  ].includes(entry.evidenceClass)) return null
  if (entry.field === "visible_stock") return null
  const sourceKind = entry.sourceType === "HUMAN_PRODUCT_INSPECTION"
    ? "PRODUCT_INSPECTION" as const
    : entry.sourceType === "HUMAN_CORRECTION"
      ? "HUMAN_REVIEW" as const
      : "SUPPLIER_CATALOG" as const
  return {
    id: entry.id,
    field: strategyEvidenceField(entry.field),
    label: entry.label,
    rawValue: entry.originalValue,
    normalizedValue: effectiveEvidenceValue(entry),
    scope: [
      "listing_price",
      "buyer_shipping_charge",
      "supplier_merchandising_signal",
    ].includes(entry.field)
      ? "STRATEGY"
      : "PRODUCT",
    sourceKind,
    sourceReference: `${entry.sourceUrl}#${entry.extractionPath}`,
    observedAt: entry.capturedAt,
    conflictKey: entry.conflictKey,
    requiredFor: evidencePurpose(entry.field),
    economicCost: economicCostForField(entry.field, entry.variantKey),
    humanReviewed: sourceKind === "HUMAN_REVIEW" ||
      sourceKind === "PRODUCT_INSPECTION",
  }
}

function evidenceById(
  entries: ProductCaseEvidence[],
  evidenceId: string,
) {
  return entries.find((entry) => entry.id === evidenceId) ?? null
}

function acceptedEvidenceByField(
  entries: ProductCaseEvidence[],
  field: ProductCaseEvidenceField,
) {
  return acceptedProductCaseEvidence(entries)
    .filter((entry) => entry.field === field)
}

function numericAcceptedEvidence(
  entries: ProductCaseEvidence[],
  evidenceId: string,
  expectedField: ProductCaseEvidenceField,
) {
  const entry = evidenceById(entries, evidenceId)
  if (!entry || entry.field !== expectedField ||
    !acceptedProductCaseEvidence(entries).some((candidate) =>
      candidate.id === entry.id
    )) return null
  const value = effectiveEvidenceValue(entry)
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? { entry, value }
    : null
}

function adapterNextAction(blockers: string[]) {
  const priorities: Array<[RegExp, string]> = [
    [/AUTHENTICATED|RAW_CAPTURE/, "CAPTURE_AUTHENTICATED_SUPPLIER_EVIDENCE"],
    [/IDENTITY|VARIANT/, "REVIEW_IDENTITY_AND_VARIANT_EVIDENCE"],
    [/PACK_QUANTITY/, "CONFIRM_PACK_QUANTITY"],
    [/PRODUCT_UNIT_COST/, "CAPTURE_SUPPLIER_UNIT_COST"],
    [/PACKAGING/, "CAPTURE_PACKAGING_COST"],
    [/OUTBOUND_SHIPPING/, "CAPTURE_PRODUCT_SPECIFIC_SHIPPING_COST"],
    [/DIMENSION|WEIGHT/, "CAPTURE_FULFILLMENT_MEASUREMENTS"],
    [/MARKET|SOLD_EXACT|CEILING/, "RUN_MARKET_EVIDENCE_REVIEW"],
    [/LISTING_PRICE|BUYER_SHIPPING/, "DEFINE_HUMAN_REVIEWED_OFFER_PRICE"],
  ]
  return priorities.find(([pattern]) =>
    blockers.some((blocker) => pattern.test(blocker))
  )?.[1] ?? "HUMAN_REVIEW_REQUIRED"
}

function hasStructuredIdentityConflict(document: ProductCaseDocument) {
  const supplierTextIds = new Set(document.evidence
    .filter((entry) =>
      ["title", "description", "product_type"].includes(entry.field) &&
      ["SUPPLIER_STATED", "PRODUCT_VERIFIED"].includes(
        entry.sourceEvidenceClass,
      )
    ).map((entry) => entry.id))
  return document.identityReview.status === "CONFLICTED" &&
    document.identityReview.supplierEvidenceIds.length > 0 &&
    document.identityReview.supplierEvidenceIds.every((id) =>
      supplierTextIds.has(id)
    ) &&
    document.identityReview.humanObservationEvidenceIds.length > 0 &&
    document.imageAnalysis.visualEvidenceStatus === "HUMAN_REVIEWED" &&
    document.imageAnalysis.conflictDetectedFrom.includes("SUPPLIER_TEXT") &&
    document.imageAnalysis.conflictDetectedFrom.includes(
      "HUMAN_VISUAL_REVIEW",
    ) &&
    document.imageAnalysis.observations.some((observation) => {
      const linkedEvidence = document.evidence.find((entry) =>
        entry.id === observation.evidenceId &&
        document.identityReview.humanObservationEvidenceIds.includes(
          entry.id,
        ) &&
        entry.sourceType === "HUMAN_VISUAL_OBSERVATION" &&
        entry.sourceEvidenceClass === "HUMAN_VISUAL_REVIEW" &&
        entry.contentHash === observation.contentHash
      )
      return Boolean(linkedEvidence) &&
        /^sha256:[0-9a-f]{64}$/.test(observation.contentHash) &&
        observation.possibleConflicts.length > 0 &&
        observation.contradictsEvidenceIds.length > 0 &&
        observation.contradictsEvidenceIds.every((id) =>
          supplierTextIds.has(id)
        )
    })
}

function identityReviewReady(document: ProductCaseDocument) {
  const verificationIds = document.identityReview
    .physicalVerificationEvidenceIds
  const humanIdentityReview = document.identityReview.humanReview
  const canonicalHumanReviewReady = Boolean(
    humanIdentityReview &&
    humanIdentityReview.contractVersion ===
      HUMAN_IDENTITY_REVIEW_CONTRACT_VERSION &&
    humanIdentityReview.decision === "IDENTITY_CONFIRMED" &&
    humanIdentityReview.status === "READY" &&
    humanIdentityReview.confidence === "HIGH" &&
    humanIdentityReview.exactIdentityConfirmed === true &&
    validateHumanIdentityReview(document).valid,
  )
  return document.identityReview.status === "READY" &&
    canonicalHumanReviewReady &&
    document.identityReview.confidence === "HIGH" &&
    document.identityReview.blockers.length === 0 &&
    visualContractIssuesForDocument(document).length === 0 &&
    (document.imageAnalysis.contractIssues ?? []).length === 0 &&
    validateProductCaseDocumentProvenance(document).valid &&
    document.identityReview.physicalProductVerified === true &&
    verificationIds.length > 0 &&
    verificationIds.every((id) =>
      document.evidence.some((entry) =>
        entry.id === id &&
        entry.sourceType === "HUMAN_PRODUCT_INSPECTION" &&
        entry.evidenceClass === "PRODUCT_VERIFIED" &&
        ["ACCEPT", "CORRECT"].includes(entry.humanVerdict) &&
        ["ACCEPTED", "CORRECTED"].includes(entry.evidenceStatus)
      )
    ) &&
    verificationIds.every((id) => {
      const evidence = document.evidence.find((entry) => entry.id === id)!
      return document.captures.some((capture) =>
        capture.sourceType === "HUMAN_PRODUCT_INSPECTION" &&
        capture.contentHash === evidence.contentHash
      )
    }) &&
    conflictsForEvidence(document.evidence).every((conflict) =>
      conflict.status === "HUMAN_RESOLVED"
    )
}

export function validateProductCaseImageAnalysis(
  document: ProductCaseDocument,
) {
  const errors: string[] = []
  if (!document.imageAnalysis.observations.length &&
    document.imageAnalysis.visualEvidenceStatus !== "NOT_REVIEWED") {
    errors.push("VISUAL_STATUS_REQUIRES_STRUCTURED_OBSERVATION")
  }
  for (const observation of document.imageAnalysis.observations) {
    const evidence = document.evidence.find((entry) =>
      entry.id === observation.evidenceId
    )
    const capture = document.captures.find((entry) =>
      entry.sourceType === "HUMAN_VISUAL_OBSERVATION" &&
      entry.contentHash === observation.contentHash
    )
    if (!evidence ||
      evidence.sourceType !== "HUMAN_VISUAL_OBSERVATION" ||
      evidence.sourceEvidenceClass !== "HUMAN_VISUAL_REVIEW" ||
      evidence.contentHash !== observation.contentHash) {
      errors.push(`VISUAL_EVIDENCE_LINK_INVALID:${observation.imageId}`)
    }
    if (!capture) {
      errors.push(`VISUAL_CAPTURE_PROVENANCE_MISSING:${observation.imageId}`)
    }
    for (const contradictedId of observation.contradictsEvidenceIds) {
      const contradicted = document.evidence.find((entry) =>
        entry.id === contradictedId
      )
      const staleIssue =
        `HUMAN_VISUAL_REVIEW_STALE_SUPPLIER_REFERENCE:${observation.imageId}:${contradictedId}`
      if (!contradicted) {
        if (!(document.imageAnalysis.contractIssues ?? []).includes(
          staleIssue,
        )) {
          errors.push(
            `VISUAL_CONTRADICTED_SUPPLIER_EVIDENCE_INVALID:${observation.imageId}:${contradictedId}`,
          )
        }
      } else if (
        !["title", "description", "product_type"].includes(
          contradicted.field,
        ) ||
        !["SUPPLIER_STATED", "PRODUCT_VERIFIED"].includes(
          contradicted.sourceEvidenceClass,
        )
      ) {
        errors.push(
          `VISUAL_CONTRADICTED_SUPPLIER_EVIDENCE_INVALID:${observation.imageId}:${contradictedId}`,
        )
      }
    }
  }
  return {
    valid: errors.length === 0,
    errors: unique(errors),
    visualEvidenceStatus: document.imageAnalysis.observations.length
      ? document.imageAnalysis.visualEvidenceStatus
      : "NOT_REVIEWED" as const,
  }
}

export function validateProductCaseDocumentProvenance(
  document: ProductCaseDocument,
) {
  const errors = [
    ...validateProductCaseImageAnalysis(document).errors,
    ...validateProductCaseSupplierSourceCapture(document).errors,
    ...validateHumanIdentityReview(document).errors,
  ]
  const evidenceIds = new Set(document.evidence.map((entry) => entry.id))
  for (const id of document.identityReview.supplierEvidenceIds) {
    if (!evidenceIds.has(id)) {
      errors.push(`IDENTITY_SUPPLIER_EVIDENCE_REFERENCE_MISSING:${id}`)
    }
  }
  for (const id of document.identityReview.humanObservationEvidenceIds) {
    if (!evidenceIds.has(id)) {
      errors.push(`IDENTITY_HUMAN_OBSERVATION_REFERENCE_MISSING:${id}`)
    }
  }
  for (const id of document.identityReview.physicalVerificationEvidenceIds) {
    if (!evidenceIds.has(id)) {
      errors.push(`IDENTITY_PHYSICAL_EVIDENCE_REFERENCE_MISSING:${id}`)
    }
  }
  if (
    document.identityReview.currentConflict !== null &&
    (
      document.identityReview.status !== "CONFLICTED" ||
      document.identityReview.supplierEvidenceIds.length === 0 ||
      document.identityReview.humanObservationEvidenceIds.length === 0
    )
  ) {
    errors.push("IDENTITY_ACTIVE_CONFLICT_REFERENCES_INVALID")
  }
  if (
    document.identityReview.status !== "CONFLICTED" &&
    document.identityReview.currentConflict !== null
  ) {
    errors.push("IDENTITY_CURRENT_CONFLICT_MUST_BE_HISTORICAL_ONLY")
  }
  for (const evidence of acceptedProductCaseEvidence(document.evidence)) {
    const matchingCapture = document.captures.some((capture) =>
      capture.sourceType === evidence.sourceType &&
      capture.sourceUrl === evidence.sourceUrl &&
      capture.contentHash === evidence.contentHash &&
      capture.capturedAt === evidence.capturedAt
    )
    if (!matchingCapture) {
      errors.push(`EVIDENCE_CAPTURE_PROVENANCE_MISMATCH:${evidence.id}`)
    }
    if (evidence.sourceType.startsWith("LUNA_") &&
      evidence.sourceEvidenceClass === "PRODUCT_VERIFIED") {
      errors.push(`SUPPLIER_SOURCE_CANNOT_BE_PRODUCT_VERIFIED:${evidence.id}`)
    }
    if (evidence.sourceType === "HUMAN_PRODUCT_INSPECTION" &&
      (evidence.sourceEvidenceClass !== "PRODUCT_VERIFIED" ||
        evidence.humanVerdict !== "ACCEPT")) {
      errors.push(`PRODUCT_INSPECTION_POLICY_INVALID:${evidence.id}`)
    }
    if (evidence.sourceType === "HUMAN_CORRECTION" &&
      (evidence.sourceEvidenceClass !== "HUMAN_HYPOTHESIS" ||
        evidence.humanVerdict !== "CORRECT" ||
        !nonempty(evidence.originalValue) ||
        !nonempty(evidence.correctedValue))) {
      errors.push(`HUMAN_CORRECTION_POLICY_INVALID:${evidence.id}`)
    }
    if (evidence.sourceType === "HUMAN_VISUAL_OBSERVATION" &&
      evidence.sourceEvidenceClass !== "HUMAN_VISUAL_REVIEW") {
      errors.push(`HUMAN_VISUAL_POLICY_INVALID:${evidence.id}`)
    }
    if (
      evidence.field === "ebay_optimized_title" &&
      (
        !["HUMAN_LISTING_DECISION", "HUMAN_CORRECTION"].includes(
          evidence.sourceType,
        ) ||
        evidence.sourceEvidenceClass !== "HUMAN_HYPOTHESIS"
      )
    ) {
      errors.push(`EBAY_OPTIMIZED_TITLE_POLICY_INVALID:${evidence.id}`)
    }
  }
  return {
    valid: errors.length === 0,
    errors: unique(errors),
  }
}

export function validateProductCaseSupplierSourceCapture(
  document: ProductCaseDocument,
) {
  const errors: string[] = []
  const sourceCapture = document.supplierSourceCapture
  if (!sourceCapture) return { valid: true, errors }
  const textValidation = validateManualAuthenticatedVisibleSourceText(
    sourceCapture.rawVisibleSourceText,
  )
  if (!textValidation.valid) {
    errors.push(`SUPPLIER_SOURCE_CAPTURE_${textValidation.error}`)
  }
  const validatedUrl = validateLunaProductUrl(sourceCapture.supplierUrl)
  if (
    !validatedUrl.valid ||
    validatedUrl.canonicalUrl !== document.sourceUrl ||
    sourceCapture.sourceAccessStatus !==
      "AUTHENTICATED_SOURCE_REQUIRED" ||
    sourceCapture.sourceCaptureMethod !== "MANUAL_AUTHENTICATED_PASTE" ||
    sourceCapture.fullHtmlAccepted !== false ||
    sourceCapture.sensitiveContentAssessment !==
      "NO_SENSITIVE_PATTERN_DETECTED" ||
    sourceCapture.humanVisibleProductTextConfirmed !== true ||
    sourceCapture.parserVersion !== PRODUCT_CASE_PARSER_VERSION ||
    sourceCapture.sourceContractVersion !==
      LUNA_SOURCE_CONTRACT_VERSION ||
    !([
      "PARSED_OK",
      "PARTIAL_EXTRACTION",
      "SOURCE_FORMAT_CHANGED",
    ] as LunaSourceParseHealth[]).includes(sourceCapture.parseHealth) ||
    !([
      "IN_STOCK_SIGNAL",
      "OUT_OF_STOCK_SIGNAL",
      "STOCK_UNKNOWN",
      "STOCK_CONFLICTED",
    ] as LunaStockState[]).includes(sourceCapture.stockState) ||
    !validIsoInstant(sourceCapture.capturedAt) ||
    !validSha256(sourceCapture.contentHash)
  ) {
    errors.push("SUPPLIER_SOURCE_CAPTURE_CONTRACT_INVALID")
  }
  const matchingCapture = document.captures.find((capture) =>
    capture.sourceType === "LUNA_AUTHENTICATED_MANUAL_CAPTURE" &&
    capture.sourceUrl === sourceCapture.supplierUrl &&
    capture.capturedAt === sourceCapture.capturedAt &&
    capture.contentHash === sourceCapture.contentHash
  )
  if (
    !matchingCapture ||
    matchingCapture.parserVersion !== sourceCapture.parserVersion ||
    matchingCapture.sourceContractVersion !==
      sourceCapture.sourceContractVersion ||
    matchingCapture.parseHealth !== sourceCapture.parseHealth ||
    matchingCapture.stockState !== sourceCapture.stockState ||
    (textValidation.valid &&
      matchingCapture.byteLength !== textValidation.byteLength)
  ) {
    errors.push("SUPPLIER_SOURCE_CAPTURE_PROVENANCE_MISSING")
  }
  const candidateIds = new Set(sourceCapture.evidenceCandidates.map((entry) =>
    entry.id
  ))
  if (
    sourceCapture.evidenceCandidates.some((entry) =>
      entry.evidenceStatus === "MISSING" ||
      entry.contentHash !== sourceCapture.contentHash ||
      !document.evidence.some((candidate) =>
        candidate.id === entry.id &&
        candidate.contentHash === entry.contentHash
      )
    ) ||
    candidateIds.size !== sourceCapture.evidenceCandidates.length
  ) {
    errors.push("SUPPLIER_SOURCE_EVIDENCE_CANDIDATES_INVALID")
  }
  return { valid: errors.length === 0, errors: unique(errors) }
}

export async function validateProductCaseSupplierSourceCaptureIntegrity(
  document: ProductCaseDocument,
) {
  const structural =
    validateProductCaseSupplierSourceCapture(document)
  const errors = [...structural.errors]
  const sourceCapture = document.supplierSourceCapture
  if (!sourceCapture) {
    return { valid: errors.length === 0, errors: unique(errors) }
  }
  const recalculatedContentHash = await hashProductCaseContent(
    sourceCapture.rawVisibleSourceText,
  )
  if (sourceCapture.contentHash !== recalculatedContentHash) {
    errors.push("SUPPLIER_SOURCE_CAPTURE_CONTENT_HASH_MISMATCH")
  }
  const correspondingCaptures = document.captures.filter((capture) =>
    capture.sourceType === "LUNA_AUTHENTICATED_MANUAL_CAPTURE" &&
    capture.sourceUrl === sourceCapture.supplierUrl &&
    capture.capturedAt === sourceCapture.capturedAt
  )
  if (
    correspondingCaptures.length !== 1 ||
    correspondingCaptures[0]?.contentHash !== recalculatedContentHash
  ) {
    errors.push("SUPPLIER_SOURCE_PRODUCT_CASE_CAPTURE_HASH_MISMATCH")
  }
  return { valid: errors.length === 0, errors: unique(errors) }
}

function canonicalHumanVisualReviewRecord(
  observation: ProductCaseImageObservation,
) {
  return {
    contractVersion: observation.contractVersion,
    imageId: observation.imageId,
    sourceUrl: observation.sourceUrl,
    sourceReference: observation.sourceReference,
    reviewerType: observation.reviewerType,
    observedProductType: observation.observedProductType,
    visibleFeatures: observation.visibleFeatures,
    visibleText: observation.visibleText,
    visibleBrands: observation.visibleBrands,
    visibleColors: observation.visibleColors,
    visibleQuantity: observation.visibleQuantity,
    observedVariant: observation.observedVariant,
    possibleConflicts: observation.possibleConflicts,
    contradictsEvidenceIds: observation.contradictsEvidenceIds,
    confidence: observation.confidence,
    humanDecision: observation.humanDecision,
    humanReason: observation.humanReason,
    reviewedAt: observation.reviewedAt,
    rawHumanInput: observation.rawHumanInput,
  }
}

function legacyHumanVisualReviewRecord(
  observation: ProductCaseImageObservation,
) {
  return {
    imageId: observation.imageId,
    sourceUrl: observation.sourceUrl,
    sourceReference: observation.sourceReference,
    reviewerType: observation.reviewerType,
    observedProductType: observation.observedProductType,
    visibleFeatures: observation.visibleFeatures,
    visibleText: observation.visibleText,
    visibleBrands: observation.visibleBrands,
    visibleColors: observation.visibleColors,
    visibleQuantity: observation.visibleQuantity,
    observedVariant: observation.observedVariant,
    possibleConflicts: observation.possibleConflicts,
    contradictsEvidenceIds: observation.contradictsEvidenceIds,
    confidence: observation.confidence,
    humanDecision: observation.humanDecision,
    humanReason: observation.humanReason,
    reviewedAt: observation.reviewedAt,
  }
}

function visualEvidenceId(contentHash: string, imageId: string) {
  return `visual-${contentHash.slice(7, 19)}-${imageId}`
}

function visualContractIssuesForDocument(document: ProductCaseDocument) {
  const issues = humanVisualReviewContractIssues(
    document.imageAnalysis.observations,
  )
  const evidenceIds = new Set(document.evidence.map((entry) => entry.id))
  for (const observation of document.imageAnalysis.observations) {
    for (const id of observation.contradictsEvidenceIds) {
      if (!evidenceIds.has(id)) {
        issues.push(
          `HUMAN_VISUAL_REVIEW_STALE_SUPPLIER_REFERENCE:${observation.imageId}:${id}`,
        )
      }
    }
  }
  return unique(issues)
}

function visualContractIssueMatchesImage(issue: string, imageId: string) {
  return [
    "HUMAN_VISUAL_REVIEW_IMAGE_ID_DUPLICATE_OR_MISSING",
    "HUMAN_VISUAL_REVIEW_HUMAN_CORRECTION_REQUIRED",
    "HUMAN_VISUAL_REVIEW_BRAND_PLACEHOLDER_INVALID",
    "HUMAN_VISUAL_REVIEW_LEGACY_EVIDENCE_UNVERIFIABLE",
  ].some((prefix) => issue === `${prefix}:${imageId}`) ||
    issue.startsWith(
      `HUMAN_VISUAL_REVIEW_STALE_SUPPLIER_REFERENCE:${imageId}:`,
    )
}

export async function validateHumanVisualReviewIntegrity(
  document: ProductCaseDocument,
) {
  const errors: string[] = []
  const observations = document.imageAnalysis.observations
  const persistedIssues = unique(
    document.imageAnalysis.contractIssues ?? [],
  )
  const derivedIssues = visualContractIssuesForDocument(document)
  if (
    Array.isArray(document.imageAnalysis.contractIssues) &&
    derivedIssues.some((issue) => !persistedIssues.includes(issue))
  ) {
    errors.push("HUMAN_VISUAL_REVIEW_CONTRACT_ISSUES_MISMATCH")
  }
  for (const observation of observations) {
    const legacy = observation.contractVersion !==
        HUMAN_VISUAL_REVIEW_CONTRACT_VERSION ||
      !observation.rawHumanInput
    if (legacy) {
      const canonical = legacyHumanVisualReviewRecord(observation)
      const evidence = document.evidence.find((entry) =>
        entry.id === observation.evidenceId &&
        entry.field === "visual_observation" &&
        entry.sourceType === "HUMAN_VISUAL_OBSERVATION"
      )
      const evidenceRaw = record(evidence?.rawValue)
      const legacyShapeVerifiable = Object.keys(canonical).every((key) =>
        Object.hasOwn(evidenceRaw, key)
      )
      if (!legacyShapeVerifiable) {
        const legacyCaptures = document.captures.filter((capture) =>
          capture.sourceType === "HUMAN_VISUAL_OBSERVATION" &&
          capture.contentHash === observation.contentHash &&
          capture.capturedAt === observation.reviewedAt
        )
        const legacyText = evidence?.rawValue
        const coherentUnverifiableLegacyRecord =
          Boolean(evidence) &&
          typeof legacyText === "string" &&
          legacyText.trim().length > 0 &&
          evidence?.id === observation.evidenceId &&
          evidence?.contentHash === observation.contentHash &&
          evidence?.capturedAt === observation.reviewedAt &&
          evidence?.sourceUrl === document.sourceUrl &&
          evidence?.extractionMethod === "HUMAN_STRUCTURED_REVIEW" &&
          evidence?.evidenceClass === "HUMAN_VISUAL_REVIEW" &&
          evidence?.sourceEvidenceClass === "HUMAN_VISUAL_REVIEW" &&
          evidence?.normalizedValue === legacyText &&
          evidence?.originalValue === legacyText &&
          evidence?.correctedValue === null &&
          validSha256(observation.contentHash) &&
          legacyCaptures.length === 1 &&
          legacyCaptures[0]?.sourceUrl === document.sourceUrl &&
          legacyCaptures[0]?.format === "JSON" &&
          Number.isInteger(legacyCaptures[0]?.byteLength) &&
          Number(legacyCaptures[0]?.byteLength) > 0
        errors.push(
          coherentUnverifiableLegacyRecord
            ? `HUMAN_VISUAL_REVIEW_LEGACY_EVIDENCE_UNVERIFIABLE:${observation.imageId}`
            : `HUMAN_VISUAL_REVIEW_LEGACY_INTEGRITY_MISMATCH:${observation.imageId}`,
        )
        continue
      }
      const serialized = stableValue(canonical)
      const contentHash = await hashProductCaseContent(serialized)
      const evidenceId = visualEvidenceId(contentHash, observation.imageId)
      const captures = document.captures.filter((capture) =>
        capture.sourceType === "HUMAN_VISUAL_OBSERVATION" &&
        capture.contentHash === contentHash &&
        capture.capturedAt === observation.reviewedAt
      )
      if (
        observation.contentHash !== contentHash ||
        observation.evidenceId !== evidenceId ||
        !evidence ||
        evidence.contentHash !== contentHash ||
        evidence.capturedAt !== observation.reviewedAt ||
        evidence.sourceUrl !== document.sourceUrl ||
        evidence.extractionPath !==
          `humanVisualReview.${observation.imageId}` ||
        evidence.evidenceClass !== "HUMAN_VISUAL_REVIEW" ||
        evidence.sourceEvidenceClass !== "HUMAN_VISUAL_REVIEW" ||
        evidence.humanReason !== observation.humanReason ||
        stableValue(evidence.rawValue) !== stableValue(canonical) ||
        stableValue(evidence.normalizedValue) !== stableValue(canonical) ||
        stableValue(evidence.originalValue) !== stableValue(canonical) ||
        evidence.correctedValue !== null ||
        captures.length !== 1 ||
        captures[0]?.sourceUrl !== document.sourceUrl ||
        captures[0]?.format !== "JSON" ||
        captures[0]?.byteLength !== utf8Length(serialized)
      ) {
        errors.push(
          `HUMAN_VISUAL_REVIEW_LEGACY_INTEGRITY_MISMATCH:${observation.imageId}`,
        )
      }
      continue
    }
    const canonical = canonicalHumanVisualReviewRecord(observation)
    const serialized = stableValue(canonical)
    const contentHash = await hashProductCaseContent(serialized)
    const evidenceId = visualEvidenceId(contentHash, observation.imageId)
    if (observation.contentHash !== contentHash) {
      errors.push(
        `HUMAN_VISUAL_REVIEW_CONTENT_HASH_MISMATCH:${observation.imageId}`,
      )
    }
    if (observation.evidenceId !== evidenceId) {
      errors.push(
        `HUMAN_VISUAL_REVIEW_EVIDENCE_ID_MISMATCH:${observation.imageId}`,
      )
    }
    const evidence = document.evidence.filter((entry) =>
      entry.id === observation.evidenceId &&
      entry.field === "visual_observation" &&
      entry.sourceType === "HUMAN_VISUAL_OBSERVATION"
    )
    if (
      evidence.length !== 1 ||
      evidence[0]?.contentHash !== contentHash ||
      evidence[0]?.capturedAt !== observation.reviewedAt ||
      evidence[0]?.sourceUrl !== document.sourceUrl ||
      evidence[0]?.extractionPath !==
        `humanVisualReview.${observation.imageId}` ||
      evidence[0]?.evidenceClass !== "HUMAN_VISUAL_REVIEW" ||
      evidence[0]?.sourceEvidenceClass !== "HUMAN_VISUAL_REVIEW" ||
      evidence[0]?.humanReason !== observation.humanReason ||
      stableValue(evidence[0]?.rawValue) !== stableValue(canonical) ||
      stableValue(evidence[0]?.normalizedValue) !== stableValue(canonical) ||
      stableValue(evidence[0]?.originalValue) !== stableValue(canonical) ||
      evidence[0]?.correctedValue !== null
    ) {
      errors.push(
        `HUMAN_VISUAL_REVIEW_EVIDENCE_MISMATCH:${observation.imageId}`,
      )
    }
    const captures = document.captures.filter((capture) =>
      capture.sourceType === "HUMAN_VISUAL_OBSERVATION" &&
      capture.contentHash === contentHash &&
      capture.capturedAt === observation.reviewedAt
    )
    if (
      captures.length !== 1 ||
      captures[0]?.sourceUrl !== document.sourceUrl ||
      captures[0]?.format !== "JSON" ||
      captures[0]?.byteLength !== utf8Length(serialized)
    ) {
      errors.push(
        `HUMAN_VISUAL_REVIEW_CAPTURE_MISMATCH:${observation.imageId}`,
      )
    }
  }
  const observationEvidenceIds = observations.map((entry) => entry.evidenceId)
  if (
    stableValue([...document.identityReview.humanObservationEvidenceIds].sort()) !==
      stableValue([...observationEvidenceIds].sort())
  ) {
    errors.push("HUMAN_VISUAL_REVIEW_IDENTITY_REFERENCES_MISMATCH")
  }
  return { valid: errors.length === 0, errors: unique(errors) }
}

function canonicalHumanIdentityReviewRecord(
  review: ProductCaseHumanIdentityReview,
) {
  return {
    contractVersion: review.contractVersion,
    reviewer: review.reviewer,
    reviewedAt: review.reviewedAt,
    decision: review.decision,
    status: review.status,
    confidence: review.confidence,
    humanReason: review.humanReason,
    evidenceIds: review.evidenceIds,
    sameGeneralProductTypeConfirmed:
      review.sameGeneralProductTypeConfirmed,
    exactIdentityConfirmed: review.exactIdentityConfirmed,
    brandConfirmed: review.brandConfirmed,
    brand: review.brand,
    model: review.model,
    mpn: review.mpn,
    supplierProductId: review.supplierProductId,
    supplierSku: review.supplierSku,
    variantId: review.variantId,
    color: review.color,
    packQuantity: review.packQuantity,
    availableFields: review.availableFields,
    missingFields: review.missingFields,
    physicalProductVerified: review.physicalProductVerified,
    physicalVerificationEvidenceIds:
      review.physicalVerificationEvidenceIds,
    rawHumanInput: review.rawHumanInput,
  }
}

function humanIdentityReviewId(contentHash: string) {
  return `identity-review-${contentHash.slice(7, 23)}`
}

function identityFieldValue(
  review: Pick<
    ProductCaseHumanIdentityReview,
    | "brand"
    | "model"
    | "mpn"
    | "supplierProductId"
    | "supplierSku"
    | "variantId"
    | "color"
    | "packQuantity"
  >,
  field: ProductCaseHumanIdentityField,
) {
  if (field === "supplier_product_id") return review.supplierProductId
  if (field === "supplier_sku") return review.supplierSku
  if (field === "variant_id") return review.variantId
  if (field === "pack_quantity") return review.packQuantity
  return review[field]
}

function availableHumanIdentityFields(
  review: Pick<
    ProductCaseHumanIdentityReview,
    | "brand"
    | "model"
    | "mpn"
    | "supplierProductId"
    | "supplierSku"
    | "variantId"
    | "color"
    | "packQuantity"
  >,
) {
  return PRODUCT_CASE_HUMAN_IDENTITY_FIELDS.filter((field) =>
    nonempty(identityFieldValue(review, field))
  )
}

function hasIndependentPhysicalVerification(
  document: ProductCaseDocument,
  evidenceIds: string[],
) {
  return evidenceIds.length > 0 &&
    evidenceIds.every((id) => {
      const evidence = document.evidence.find((entry) =>
        entry.id === id &&
        entry.sourceType === "HUMAN_PRODUCT_INSPECTION" &&
        entry.evidenceClass === "PRODUCT_VERIFIED" &&
        entry.sourceEvidenceClass === "PRODUCT_VERIFIED" &&
        ["ACCEPT", "CORRECT"].includes(entry.humanVerdict) &&
        ["ACCEPTED", "CORRECTED"].includes(entry.evidenceStatus)
      )
      return Boolean(evidence) &&
        document.captures.some((capture) =>
          capture.sourceType === "HUMAN_PRODUCT_INSPECTION" &&
          capture.sourceUrl === evidence?.sourceUrl &&
          capture.capturedAt === evidence?.capturedAt &&
          capture.contentHash === evidence?.contentHash
        )
    })
}

const HUMAN_IDENTITY_REVIEW_SELECTABLE_FIELDS =
  new Set<ProductCaseEvidenceField>([
    "title",
    "brand",
    "model",
    "mpn",
    "supplier_product_id",
    "supplier_sku",
    "variant_id",
    "option_name",
    "option_value",
    "color",
    "product_type",
    "selected_variant",
    "pack_quantity",
    "visual_observation",
  ])

function currentAcceptedHumanIdentityEvidence(
  document: ProductCaseDocument,
  evidenceId: string,
) {
  const matching = document.evidence.filter((entry) =>
    entry.id === evidenceId
  )
  if (matching.length !== 1) return null
  const evidence = matching[0]
  const visualObservation =
    evidence.sourceType === "HUMAN_VISUAL_OBSERVATION"
      ? document.imageAnalysis.observations.find((observation) =>
          observation.evidenceId === evidence.id &&
          observation.contentHash === evidence.contentHash
        ) ?? null
      : null
  const accepted = ["ACCEPT", "CORRECT"].includes(evidence.humanVerdict) &&
    ["ACCEPTED", "CORRECTED"].includes(evidence.evidenceStatus)
  const canonicalProposedVisual = Boolean(
    visualObservation &&
    evidence.humanVerdict === "UNREVIEWED" &&
    evidence.evidenceStatus === "PROPOSED" &&
    evidence.evidenceClass === "HUMAN_VISUAL_REVIEW" &&
    evidence.sourceEvidenceClass === "HUMAN_VISUAL_REVIEW" &&
    visualObservation.contractVersion ===
      HUMAN_VISUAL_REVIEW_CONTRACT_VERSION &&
    visualObservation.humanDecision === "ACCEPT_FOR_ANALYSIS" &&
    !(document.imageAnalysis.contractIssues ?? []).some((issue) =>
      visualContractIssueMatchesImage(issue, visualObservation.imageId)
    ),
  )
  if (
    !HUMAN_IDENTITY_REVIEW_SELECTABLE_FIELDS.has(evidence.field) ||
    (!accepted && !canonicalProposedVisual) ||
    ["CONFLICTED", "MISSING"].includes(evidence.evidenceClass) ||
    !nonempty(effectiveEvidenceValue(evidence))
  ) {
    return null
  }
  const matchingCapture = document.captures.some((capture) =>
    capture.sourceType === evidence.sourceType &&
    capture.sourceUrl === evidence.sourceUrl &&
    capture.capturedAt === evidence.capturedAt &&
    capture.contentHash === evidence.contentHash
  )
  if (!matchingCapture) return null
  if (
    evidence.sourceType === "HUMAN_VISUAL_OBSERVATION" &&
    !visualObservation
  ) {
    return null
  }
  return evidence
}

function selectedEvidenceSupportsIdentityField(
  document: ProductCaseDocument,
  selectedIds: Set<string>,
  field: ProductCaseHumanIdentityField,
  expectedValue: unknown,
) {
  return [...selectedIds].some((id) => {
    const entry = currentAcceptedHumanIdentityEvidence(document, id)
    if (!entry) return false
    const exactSourceAllowed = (
      (
        entry.sourceEvidenceClass === "SUPPLIER_STATED" &&
        entry.sourceType.startsWith("LUNA_")
      ) ||
      (
        entry.sourceEvidenceClass === "PRODUCT_VERIFIED" &&
        entry.sourceType === "HUMAN_PRODUCT_INSPECTION"
      )
    )
    return exactSourceAllowed &&
      entry.field === field &&
      stableValue(effectiveEvidenceValue(entry)) ===
        stableValue(expectedValue)
  })
}

function selectedEvidenceSupportsGeneralProductType(
  document: ProductCaseDocument,
  selectedIds: Set<string>,
) {
  const nonVisualContext = [...selectedIds].some((id) => {
    const evidence = currentAcceptedHumanIdentityEvidence(document, id)
    return Boolean(
      evidence &&
      evidence.sourceType !== "HUMAN_VISUAL_OBSERVATION" &&
      ["title", "product_type"].includes(evidence.field) &&
      (
        (
          evidence.sourceEvidenceClass === "SUPPLIER_STATED" &&
          evidence.sourceType.startsWith("LUNA_")
        ) ||
        (
          evidence.sourceEvidenceClass === "PRODUCT_VERIFIED" &&
          evidence.sourceType === "HUMAN_PRODUCT_INSPECTION"
        )
      ),
    )
  })
  const visualContext = document.imageAnalysis.observations.some(
    (observation) =>
      selectedIds.has(observation.evidenceId) &&
      Boolean(normalizeWhitespace(observation.observedProductType ?? "")) &&
      Boolean(currentAcceptedHumanIdentityEvidence(
        document,
        observation.evidenceId,
      )),
  )
  return nonVisualContext && visualContext
}

function canonicalHumanIdentitySupplierEvidenceIds(
  document: ProductCaseDocument,
  selectedEvidenceIds: string[],
) {
  const selectedSupplierIds = selectedEvidenceIds.filter((id) => {
    const evidence = currentAcceptedHumanIdentityEvidence(document, id)
    return Boolean(evidence?.sourceType.startsWith("LUNA_"))
  })
  const contradictedSupplierIds =
    document.imageAnalysis.observations.flatMap((observation) =>
      observation.contradictsEvidenceIds.filter((id) => {
        const evidence = document.evidence.find((entry) => entry.id === id)
        return Boolean(
          evidence?.sourceType.startsWith("LUNA_") &&
          ["SUPPLIER_STATED", "PRODUCT_VERIFIED"].includes(
            evidence.sourceEvidenceClass,
          ),
        )
      })
    )
  return unique([
    ...selectedSupplierIds,
    ...contradictedSupplierIds,
  ]).sort()
}

const HUMAN_IDENTITY_REVIEW_RESOLVABLE_BLOCKERS = new Set([
  "HUMAN_IDENTITY_REVIEW_REQUIRED",
  "HUMAN_IDENTITY_REVIEW_REQUIRED_AFTER_VISUAL_EVIDENCE_CHANGE",
  "IMPORTED_IDENTITY_REQUIRES_NEW_LOCAL_HUMAN_REVIEW",
  "GENERAL_PRODUCT_TYPE_NOT_CONFIRMED",
  "EXACT_IDENTITY_NOT_CONFIRMED",
  "PHYSICAL_PRODUCT_NOT_VERIFIED",
])

function humanIdentityReviewBlockerIsResolvable(blocker: string) {
  return HUMAN_IDENTITY_REVIEW_RESOLVABLE_BLOCKERS.has(blocker) ||
    blocker.startsWith("HUMAN_IDENTITY_REVIEW_REQUIRED:") ||
    blocker.startsWith("IDENTITY_EVIDENCE_MISSING:") ||
    blocker.startsWith("HUMAN_IDENTITY_REVIEW_CONFLICT:")
}

function persistentHumanIdentityBlockers(blockers: string[]) {
  return unique(
    blockers.filter((blocker) =>
      !humanIdentityReviewBlockerIsResolvable(blocker)
    ),
  )
}

export function validateHumanIdentityReview(
  document: ProductCaseDocument,
) {
  const errors: string[] = []
  const review = document.identityReview.humanReview
  if (!review) {
    if (document.identityReview.status === "PARTIAL") {
      errors.push("HUMAN_IDENTITY_REVIEW_PARTIAL_CONTRACT_REQUIRED")
    }
    return { valid: errors.length === 0, errors }
  }
  const evidenceIds = Array.isArray(review.evidenceIds)
    ? review.evidenceIds
    : []
  const physicalIds = Array.isArray(
      review.physicalVerificationEvidenceIds,
    )
    ? review.physicalVerificationEvidenceIds
    : []
  const availableFields = Array.isArray(review.availableFields)
    ? review.availableFields
    : []
  const missingFields = Array.isArray(review.missingFields)
    ? review.missingFields
    : []
  const raw = review.rawHumanInput
  if (
    review.contractVersion !==
      HUMAN_IDENTITY_REVIEW_CONTRACT_VERSION ||
    !validSha256(review.contentHash) ||
    typeof review.reviewId !== "string" ||
    !review.reviewId ||
    !normalizeWhitespace(review.reviewer) ||
    !validIsoInstant(review.reviewedAt) ||
    !([
      "NEEDS_MORE_EVIDENCE",
      "CONFLICT_CONFIRMED",
      "IDENTITY_CONFIRMED",
    ] as const).includes(review.decision) ||
    !(["PARTIAL", "CONFLICTED", "READY"] as const)
      .includes(review.status) ||
    !(["LOW", "MEDIUM", "HIGH"] as const).includes(review.confidence) ||
    !normalizeWhitespace(review.humanReason) ||
    !Array.isArray(review.evidenceIds) ||
    !Array.isArray(review.availableFields) ||
    !Array.isArray(review.missingFields) ||
    !Array.isArray(review.physicalVerificationEvidenceIds) ||
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    typeof raw.reviewer !== "string" ||
    typeof raw.decision !== "string" ||
    typeof raw.confidence !== "string" ||
    typeof raw.humanReason !== "string" ||
    !Array.isArray(raw.evidenceIds) ||
    typeof raw.sameGeneralProductTypeConfirmed !== "boolean" ||
    typeof raw.exactIdentityConfirmed !== "boolean" ||
    typeof raw.brandConfirmed !== "boolean" ||
    typeof raw.brand !== "string" ||
    typeof raw.model !== "string" ||
    typeof raw.mpn !== "string" ||
    typeof raw.supplierProductId !== "string" ||
    typeof raw.supplierSku !== "string" ||
    typeof raw.variantId !== "string" ||
    typeof raw.color !== "string" ||
    typeof raw.packQuantity !== "string" ||
    typeof raw.physicalProductVerified !== "boolean" ||
    !Array.isArray(raw.physicalVerificationEvidenceIds)
  ) {
    errors.push("HUMAN_IDENTITY_REVIEW_CONTRACT_INVALID")
    return { valid: false, errors: unique(errors) }
  }
  if (
    evidenceIds.length !== new Set(evidenceIds).size ||
    physicalIds.length !== new Set(physicalIds).size
  ) {
    errors.push("HUMAN_IDENTITY_REVIEW_EVIDENCE_ID_DUPLICATE")
  }
  if (review.reviewId !== humanIdentityReviewId(review.contentHash)) {
    errors.push("HUMAN_IDENTITY_REVIEW_ID_MISMATCH")
  }
  if (
    stableValue(evidenceIds) !==
      stableValue([...evidenceIds].sort()) ||
    stableValue(physicalIds) !==
      stableValue([...physicalIds].sort())
  ) {
    errors.push("HUMAN_IDENTITY_REVIEW_EVIDENCE_IDS_NOT_CANONICAL")
  }
  const evidenceById = new Map(
    document.evidence.map((entry) => [entry.id, entry]),
  )
  for (const id of evidenceIds) {
    const evidence = currentAcceptedHumanIdentityEvidence(document, id)
    if (!evidence) {
      errors.push(
        evidenceById.has(id)
          ? `HUMAN_IDENTITY_REVIEW_EVIDENCE_NOT_CURRENT_OR_ACCEPTED:${id}`
          : `HUMAN_IDENTITY_REVIEW_EVIDENCE_REFERENCE_MISSING:${id}`,
      )
      continue
    }
    if (
      evidence.field === "title" &&
      evidence.sourceType.startsWith("LUNA_") &&
      evidence.sourceEvidenceClass !== "SUPPLIER_STATED"
    ) {
      errors.push(
        `HUMAN_IDENTITY_REVIEW_SUPPLIER_TITLE_POLICY_INVALID:${id}`,
      )
    }
  }
  for (const id of physicalIds) {
    if (!evidenceIds.includes(id)) {
      errors.push(
        `HUMAN_IDENTITY_REVIEW_PHYSICAL_REFERENCE_NOT_SELECTED:${id}`,
      )
    }
  }
  const expectedAvailable = availableHumanIdentityFields(review)
  const expectedMissing = PRODUCT_CASE_HUMAN_IDENTITY_FIELDS.filter(
    (field) => !expectedAvailable.includes(field),
  )
  if (
    stableValue(availableFields) !== stableValue(expectedAvailable) ||
    stableValue(missingFields) !== stableValue(expectedMissing)
  ) {
    errors.push("HUMAN_IDENTITY_REVIEW_FIELD_STATUS_MISMATCH")
  }
  const expectedStatus = review.decision === "NEEDS_MORE_EVIDENCE"
    ? "PARTIAL"
    : review.decision === "CONFLICT_CONFIRMED"
      ? "CONFLICTED"
      : "READY"
  if (
    review.status !== expectedStatus ||
    document.identityReview.status !== review.status ||
    document.identityReview.confidence !== review.confidence
  ) {
    errors.push("HUMAN_IDENTITY_REVIEW_STATUS_MISMATCH")
  }
  if (
    review.decision === "IDENTITY_CONFIRMED" &&
    review.confidence !== "HIGH"
  ) {
    errors.push(
      "HUMAN_IDENTITY_REVIEW_READY_CONFIDENCE_INSUFFICIENT",
    )
  }
  const physicalVerified = hasIndependentPhysicalVerification(
    document,
    physicalIds,
  )
  if (
    review.physicalProductVerified !== physicalVerified ||
    document.identityReview.physicalProductVerified !== physicalVerified ||
    stableValue(document.identityReview.physicalVerificationEvidenceIds) !==
      stableValue(physicalIds)
  ) {
    errors.push("HUMAN_IDENTITY_REVIEW_PHYSICAL_VERIFICATION_MISMATCH")
  }
  const selectedIds = new Set(evidenceIds)
  if (
    review.sameGeneralProductTypeConfirmed &&
    !selectedEvidenceSupportsGeneralProductType(document, selectedIds)
  ) {
    errors.push(
      "HUMAN_IDENTITY_REVIEW_GENERAL_PRODUCT_TYPE_UNSUPPORTED",
    )
  }
  for (const field of expectedAvailable) {
    if (!selectedEvidenceSupportsIdentityField(
      document,
      selectedIds,
      field,
      identityFieldValue(review, field),
    )) {
      errors.push(
        `HUMAN_IDENTITY_REVIEW_FIELD_EVIDENCE_UNSUPPORTED:${field}`,
      )
    }
  }
  if (
    review.brandConfirmed &&
    (
      !review.brand ||
      !selectedEvidenceSupportsIdentityField(
        document,
        selectedIds,
        "brand",
        review.brand,
      )
    )
  ) {
    errors.push("HUMAN_IDENTITY_REVIEW_BRAND_CONFIRMATION_UNSUPPORTED")
  }
  const exactIdentityFields = [
    "brand",
    "model",
    "mpn",
    "supplier_product_id",
    "supplier_sku",
    "variant_id",
  ] as const
  const exactIdentitySupported = exactIdentityFields.every((field) => {
    const value = identityFieldValue(review, field)
    return nonempty(value) &&
      selectedEvidenceSupportsIdentityField(
        document,
        selectedIds,
        field,
        value,
      )
  })
  if (
    review.exactIdentityConfirmed &&
    (
      !review.sameGeneralProductTypeConfirmed ||
      !review.brandConfirmed ||
      !physicalVerified ||
      !exactIdentitySupported
    )
  ) {
    errors.push("HUMAN_IDENTITY_REVIEW_EXACT_IDENTITY_UNSUPPORTED")
  }
  if (
    review.decision === "IDENTITY_CONFIRMED" &&
    !review.exactIdentityConfirmed
  ) {
    errors.push("HUMAN_IDENTITY_REVIEW_READY_WITHOUT_EXACT_IDENTITY")
  }
  const rawEvidenceIds = Array.isArray(raw.evidenceIds)
    ? raw.evidenceIds.map((id) =>
        typeof id === "string" ? normalizeWhitespace(id) : ""
      )
    : []
  const rawPhysicalIds = Array.isArray(
      raw.physicalVerificationEvidenceIds,
    )
    ? raw.physicalVerificationEvidenceIds.map((id) =>
        typeof id === "string" ? normalizeWhitespace(id) : ""
      )
    : []
  const rawNullable = (value: unknown) => {
    if (typeof value !== "string") return null
    return normalizeWhitespace(value) || null
  }
  const rawPackQuantity = typeof raw.packQuantity === "string" &&
      raw.packQuantity.trim()
    ? Number(raw.packQuantity)
    : null
  if (
    normalizeWhitespace(
      typeof raw.reviewer === "string" ? raw.reviewer : "",
    ) !== review.reviewer ||
    raw.decision !== review.decision ||
    raw.confidence !== review.confidence ||
    normalizeWhitespace(
      typeof raw.humanReason === "string" ? raw.humanReason : "",
    ) !== review.humanReason ||
    stableValue([...rawEvidenceIds].sort()) !==
      stableValue(evidenceIds) ||
    raw.sameGeneralProductTypeConfirmed !==
      review.sameGeneralProductTypeConfirmed ||
    raw.exactIdentityConfirmed !== review.exactIdentityConfirmed ||
    raw.brandConfirmed !== review.brandConfirmed ||
    rawNullable(raw.brand) !== review.brand ||
    rawNullable(raw.model) !== review.model ||
    rawNullable(raw.mpn) !== review.mpn ||
    rawNullable(raw.supplierProductId) !== review.supplierProductId ||
    rawNullable(raw.supplierSku) !== review.supplierSku ||
    rawNullable(raw.variantId) !== review.variantId ||
    rawNullable(raw.color) !== review.color ||
    rawPackQuantity !== review.packQuantity ||
    raw.physicalProductVerified !== review.physicalProductVerified ||
    stableValue([...rawPhysicalIds].sort()) !==
      stableValue(physicalIds)
  ) {
    errors.push("HUMAN_IDENTITY_REVIEW_INTEGRITY_MISMATCH:RAW_INPUT")
  }
  const selectedSupplierIds = evidenceIds.filter((id) =>
    evidenceById.get(id)?.sourceType.startsWith("LUNA_")
  )
  const selectedVisualIds = evidenceIds.filter((id) =>
    evidenceById.get(id)?.sourceType === "HUMAN_VISUAL_OBSERVATION"
  )
  const supportedConflict = document.imageAnalysis.observations.some(
    (observation) =>
      selectedVisualIds.includes(observation.evidenceId) &&
      observation.possibleConflicts.length > 0 &&
      observation.contradictsEvidenceIds.some((id) =>
        selectedSupplierIds.includes(id)
      ),
  )
  if (
    review.decision === "CONFLICT_CONFIRMED" &&
    !supportedConflict
  ) {
    errors.push("HUMAN_IDENTITY_REVIEW_CONFLICT_UNSUPPORTED")
  }
  const expectedSupplierEvidenceIds =
    canonicalHumanIdentitySupplierEvidenceIds(document, evidenceIds)
  if (
    stableValue([...document.identityReview.supplierEvidenceIds].sort()) !==
      stableValue(expectedSupplierEvidenceIds)
  ) {
    errors.push("HUMAN_IDENTITY_REVIEW_SUPPLIER_REFERENCES_MISMATCH")
  }
  return { valid: errors.length === 0, errors: unique(errors) }
}

export async function validateHumanIdentityReviewIntegrity(
  document: ProductCaseDocument,
) {
  const structural = validateHumanIdentityReview(document)
  const errors = [...structural.errors]
  const review = document.identityReview.humanReview
  if (!review || !structural.valid) {
    return { valid: errors.length === 0, errors: unique(errors) }
  }
  const serialized = stableValue(canonicalHumanIdentityReviewRecord(review))
  const contentHash = await hashProductCaseContent(serialized)
  if (review.contentHash !== contentHash) {
    errors.push("HUMAN_IDENTITY_REVIEW_CONTENT_HASH_MISMATCH")
  }
  if (review.reviewId !== humanIdentityReviewId(contentHash)) {
    errors.push("HUMAN_IDENTITY_REVIEW_ID_MISMATCH")
  }
  return { valid: errors.length === 0, errors: unique(errors) }
}

export async function validateProductCaseDocumentProvenanceIntegrity(
  document: ProductCaseDocument,
) {
  const structural = validateProductCaseDocumentProvenance(document)
  const supplierIntegrity =
    await validateProductCaseSupplierSourceCaptureIntegrity(document)
  const visualIntegrity = await validateHumanVisualReviewIntegrity(document)
  const identityIntegrity =
    await validateHumanIdentityReviewIntegrity(document)
  const errors = unique([
    ...structural.errors,
    ...supplierIntegrity.errors,
    ...visualIntegrity.errors,
    ...identityIntegrity.errors,
  ])
  return { valid: errors.length === 0, errors }
}

const SUPPLIER_IDENTITY_FIELDS = new Set<ProductCaseEvidenceField>([
  "title",
  "description",
  "product_type",
  "supplier_product_id",
  "supplier_sku",
  "variant_id",
  "option_value",
])

export async function saveHumanIdentityReviewRecord(input: {
  document: ProductCaseDocument
  reviewer: string
  reviewedAt: string
  decision: ProductCaseHumanIdentityReview["decision"]
  confidence: ProductCaseHumanIdentityReview["confidence"]
  humanReason: string
  evidenceIds: string[]
  sameGeneralProductTypeConfirmed: boolean
  exactIdentityConfirmed: boolean
  brandConfirmed: boolean
  brand: string | null
  model: string | null
  mpn: string | null
  supplierProductId: string | null
  supplierSku: string | null
  variantId: string | null
  color: string | null
  packQuantity: number | null
  physicalProductVerified?: boolean
  physicalVerificationEvidenceIds?: string[]
  rawHumanInput: ProductCaseHumanIdentityReview["rawHumanInput"]
}) {
  const reviewer = normalizeWhitespace(input.reviewer)
  const humanReason = normalizeWhitespace(input.humanReason)
  if (!reviewer || !humanReason) {
    throw new Error("HUMAN_IDENTITY_REVIEW_REQUIRED_FIELD_MISSING")
  }
  if (!validIsoInstant(input.reviewedAt)) {
    throw new Error("HUMAN_IDENTITY_REVIEW_TIMESTAMP_INVALID")
  }
  const visualIntegrity = await validateHumanVisualReviewIntegrity(
    input.document,
  )
  if (!visualIntegrity.valid) {
    throw new Error(
      `HUMAN_IDENTITY_REVIEW_VISUAL_EVIDENCE_INTEGRITY_INVALID:${
        visualIntegrity.errors.join(",")
      }`,
    )
  }
  const normalizeNullable = (value: string | null) => {
    if (value === null) return null
    const normalized = normalizeWhitespace(value)
    return normalized || null
  }
  if (
    input.packQuantity !== null &&
    (
      !Number.isInteger(input.packQuantity) ||
      input.packQuantity <= 0
    )
  ) {
    throw new Error("HUMAN_IDENTITY_REVIEW_PACK_QUANTITY_INVALID")
  }
  const evidenceIds = input.evidenceIds.map(normalizeWhitespace)
  const physicalVerificationEvidenceIds =
    (input.physicalVerificationEvidenceIds ?? []).map(normalizeWhitespace)
  if (
    evidenceIds.some((id) => !id) ||
    physicalVerificationEvidenceIds.some((id) => !id) ||
    evidenceIds.length !== new Set(evidenceIds).size ||
    physicalVerificationEvidenceIds.length !==
      new Set(physicalVerificationEvidenceIds).size
  ) {
    throw new Error("HUMAN_IDENTITY_REVIEW_EVIDENCE_ID_DUPLICATE")
  }
  const evidenceById = new Map(
    input.document.evidence.map((entry) => [entry.id, entry]),
  )
  for (const id of evidenceIds) {
    const evidence = currentAcceptedHumanIdentityEvidence(input.document, id)
    if (!evidence) {
      throw new Error(
        evidenceById.has(id)
          ? `HUMAN_IDENTITY_REVIEW_EVIDENCE_NOT_CURRENT_OR_ACCEPTED:${id}`
          : `HUMAN_IDENTITY_REVIEW_EVIDENCE_REFERENCE_MISSING:${id}`,
      )
    }
    if (
      evidence.field === "title" &&
      evidence.sourceType.startsWith("LUNA_") &&
      evidence.sourceEvidenceClass !== "SUPPLIER_STATED"
    ) {
      throw new Error(
        `HUMAN_IDENTITY_REVIEW_SUPPLIER_TITLE_POLICY_INVALID:${id}`,
      )
    }
  }
  for (const id of physicalVerificationEvidenceIds) {
    if (!evidenceIds.includes(id)) {
      throw new Error(
        `HUMAN_IDENTITY_REVIEW_PHYSICAL_REFERENCE_NOT_SELECTED:${id}`,
      )
    }
  }
  const physicalProductVerified = hasIndependentPhysicalVerification(
    input.document,
    physicalVerificationEvidenceIds,
  )
  if (
    (input.physicalProductVerified === true ||
      input.rawHumanInput.physicalProductVerified === true) &&
    !physicalProductVerified
  ) {
    throw new Error(
      "HUMAN_IDENTITY_REVIEW_PHYSICAL_VERIFICATION_UNSUPPORTED",
    )
  }
  const normalizedValues = {
    brand: normalizeNullable(input.brand),
    model: normalizeNullable(input.model),
    mpn: normalizeNullable(input.mpn),
    supplierProductId: normalizeNullable(input.supplierProductId),
    supplierSku: normalizeNullable(input.supplierSku),
    variantId: normalizeNullable(input.variantId),
    color: normalizeNullable(input.color),
    packQuantity: input.packQuantity,
  }
  const availableFields = availableHumanIdentityFields(normalizedValues)
  const missingFields = PRODUCT_CASE_HUMAN_IDENTITY_FIELDS.filter(
    (field) => !availableFields.includes(field),
  )
  const selectedIds = new Set(evidenceIds)
  if (
    input.sameGeneralProductTypeConfirmed &&
    !selectedEvidenceSupportsGeneralProductType(
      input.document,
      selectedIds,
    )
  ) {
    throw new Error(
      "HUMAN_IDENTITY_REVIEW_GENERAL_PRODUCT_TYPE_UNSUPPORTED",
    )
  }
  for (const field of availableFields) {
    if (!selectedEvidenceSupportsIdentityField(
      input.document,
      selectedIds,
      field,
      identityFieldValue(normalizedValues, field),
    )) {
      throw new Error(
        `HUMAN_IDENTITY_REVIEW_FIELD_EVIDENCE_UNSUPPORTED:${field}`,
      )
    }
  }
  if (
    input.brandConfirmed &&
    (
      !normalizedValues.brand ||
      !selectedEvidenceSupportsIdentityField(
        input.document,
        selectedIds,
        "brand",
        normalizedValues.brand,
      )
    )
  ) {
    throw new Error(
      "HUMAN_IDENTITY_REVIEW_BRAND_CONFIRMATION_UNSUPPORTED",
    )
  }
  const exactIdentityFields = [
    "brand",
    "model",
    "mpn",
    "supplier_product_id",
    "supplier_sku",
    "variant_id",
  ] as const
  const exactIdentitySupported = exactIdentityFields.every((field) => {
    const value = identityFieldValue(normalizedValues, field)
    return nonempty(value) &&
      selectedEvidenceSupportsIdentityField(
        input.document,
        selectedIds,
        field,
        value,
      )
  })
  if (
    input.exactIdentityConfirmed &&
    (
      !input.sameGeneralProductTypeConfirmed ||
      !input.brandConfirmed ||
      !physicalProductVerified ||
      !exactIdentitySupported
    )
  ) {
    throw new Error("HUMAN_IDENTITY_REVIEW_EXACT_IDENTITY_UNSUPPORTED")
  }
  if (
    input.decision === "IDENTITY_CONFIRMED" &&
    !input.exactIdentityConfirmed
  ) {
    throw new Error("HUMAN_IDENTITY_REVIEW_READY_WITHOUT_EXACT_IDENTITY")
  }
  if (
    input.decision === "IDENTITY_CONFIRMED" &&
    input.confidence !== "HIGH"
  ) {
    throw new Error(
      "HUMAN_IDENTITY_REVIEW_READY_CONFIDENCE_INSUFFICIENT",
    )
  }
  const selectedSupplierIds = evidenceIds.filter((id) =>
    evidenceById.get(id)?.sourceType.startsWith("LUNA_")
  )
  const selectedVisualIds = evidenceIds.filter((id) =>
    evidenceById.get(id)?.sourceType === "HUMAN_VISUAL_OBSERVATION"
  )
  const selectedConflict = input.document.imageAnalysis.observations.find(
    (observation) =>
      selectedVisualIds.includes(observation.evidenceId) &&
      observation.possibleConflicts.length > 0 &&
      observation.contradictsEvidenceIds.some((id) =>
        selectedSupplierIds.includes(id)
      ),
  )
  if (
    input.decision === "CONFLICT_CONFIRMED" &&
    !selectedConflict
  ) {
    throw new Error("HUMAN_IDENTITY_REVIEW_CONFLICT_UNSUPPORTED")
  }
  const status: ProductCaseHumanIdentityReview["status"] =
    input.decision === "NEEDS_MORE_EVIDENCE"
      ? "PARTIAL"
      : input.decision === "CONFLICT_CONFIRMED"
        ? "CONFLICTED"
        : "READY"
  const canonical = {
    contractVersion: HUMAN_IDENTITY_REVIEW_CONTRACT_VERSION,
    reviewer,
    reviewedAt: input.reviewedAt,
    decision: input.decision,
    status,
    confidence: input.confidence,
    humanReason,
    evidenceIds: [...evidenceIds].sort(),
    sameGeneralProductTypeConfirmed:
      input.sameGeneralProductTypeConfirmed,
    exactIdentityConfirmed: input.exactIdentityConfirmed,
    brandConfirmed: input.brandConfirmed,
    ...normalizedValues,
    availableFields,
    missingFields,
    physicalProductVerified,
    physicalVerificationEvidenceIds:
      [...physicalVerificationEvidenceIds].sort(),
    rawHumanInput: structuredClone(input.rawHumanInput),
  }
  const contentHash = await hashProductCaseContent(stableValue(canonical))
  const review: ProductCaseHumanIdentityReview = {
    ...canonical,
    reviewId: humanIdentityReviewId(contentHash),
    contentHash: contentHash as `sha256:${string}`,
  }
  const missingBlockers = missingFields.map((field) =>
    `IDENTITY_EVIDENCE_MISSING:${field}`
  )
  const persistentBlockers = persistentHumanIdentityBlockers(
    input.document.identityReview.blockers,
  )
  const reviewSpecificBlockers = status === "READY"
    ? []
    : [
        ...(!input.sameGeneralProductTypeConfirmed
          ? ["GENERAL_PRODUCT_TYPE_NOT_CONFIRMED"] : []),
        ...(!input.exactIdentityConfirmed
          ? ["EXACT_IDENTITY_NOT_CONFIRMED"] : []),
        ...(!physicalProductVerified
          ? ["PHYSICAL_PRODUCT_NOT_VERIFIED"] : []),
        ...missingBlockers,
        ...(selectedConflict?.possibleConflicts.map((conflict) =>
          `HUMAN_IDENTITY_REVIEW_CONFLICT:${conflict}`
        ) ?? []),
      ]
  const blockers = unique([
    ...persistentBlockers,
    ...visualContractIssuesForDocument(input.document),
    ...reviewSpecificBlockers,
  ])
  const supplierEvidenceIds = canonicalHumanIdentitySupplierEvidenceIds(
    input.document,
    evidenceIds,
  )
  const currentConflict = status === "CONFLICTED"
    ? "SUPPLIER_TEXT_VS_HUMAN_VISUAL_REVIEW"
    : null
  const updatedDocument: ProductCaseDocument = {
    ...input.document,
    identityReview: {
      ...input.document.identityReview,
      status,
      confidence: input.confidence,
      physicalProductVerified,
      physicalVerificationEvidenceIds:
        [...physicalVerificationEvidenceIds].sort(),
      conflictHistory: unique([
        ...input.document.identityReview.conflictHistory,
        ...(currentConflict ? [currentConflict] : []),
      ]),
      currentConflict,
      supplierEvidenceIds,
      humanObservationEvidenceIds:
        input.document.imageAnalysis.observations.map((observation) =>
          observation.evidenceId
        ),
      blockers,
      nextAction: persistentBlockers.length > 0 &&
          normalizeWhitespace(input.document.identityReview.nextAction)
        ? input.document.identityReview.nextAction
        : status === "PARTIAL"
          ? "CAPTURE_MISSING_IDENTITY_EVIDENCE"
          : status === "CONFLICTED"
            ? "RESOLVE_IDENTITY_CONFLICT"
            : "REVIEW_MARKET_EVIDENCE",
      humanReview: review,
    },
  }
  const integrity = await validateHumanIdentityReviewIntegrity(
    updatedDocument,
  )
  if (!integrity.valid) {
    throw new Error(
      `HUMAN_IDENTITY_REVIEW_INTEGRITY_INVALID:${integrity.errors.join(",")}`,
    )
  }
  return {
    review,
    updatedDocument,
    safety: PRODUCT_CASE_ZERO_EFFECTS,
  }
}

export function deleteHumanIdentityReviewRecord(input: {
  document: ProductCaseDocument
}): ProductCaseDocument {
  const persistentBlockers = persistentHumanIdentityBlockers(
    input.document.identityReview.blockers,
  )
  return {
    ...input.document,
    identityReview: {
      ...input.document.identityReview,
      status: "NOT_REVIEWED",
      confidence: "LOW",
      physicalProductVerified: false,
      physicalVerificationEvidenceIds: [],
      currentConflict: null,
      supplierEvidenceIds: unique(
        input.document.evidence
          .filter((entry) =>
            entry.sourceType.startsWith("LUNA_") &&
            entry.evidenceStatus !== "MISSING" &&
            SUPPLIER_IDENTITY_FIELDS.has(entry.field)
          )
          .map((entry) => entry.id),
      ),
      humanObservationEvidenceIds:
        input.document.imageAnalysis.observations.map((entry) =>
          entry.evidenceId
        ),
      blockers: unique([
        ...persistentBlockers,
        "HUMAN_IDENTITY_REVIEW_REQUIRED",
        ...visualContractIssuesForDocument(input.document),
      ]),
      nextAction: persistentBlockers.length > 0 &&
          normalizeWhitespace(input.document.identityReview.nextAction)
        ? input.document.identityReview.nextAction
        : "REVIEW_IDENTITY_AND_VARIANTS",
      humanReview: null,
    },
  }
}

export function transitionProductCaseSupplierCapture(input: {
  document: ProductCaseDocument
  replacement: {
    supplierSourceCapture: ProductCaseSupplierSourceCapture
    extraction: ProductCaseExtractionResult
  } | null
}): ProductCaseDocument {
  const document = structuredClone(input.document)
  const previousCapture = document.supplierSourceCapture
  const previousCandidateById = new Map(
    (previousCapture?.evidenceCandidates ?? []).map((entry) => [
      entry.id,
      entry,
    ]),
  )
  const removedEvidenceIds = new Set(
    previousCapture
      ? document.evidence
          .filter((entry) => {
            const directSupplierEvidence =
              entry.sourceType.startsWith("LUNA_") &&
              entry.sourceUrl === previousCapture.supplierUrl &&
              entry.contentHash === previousCapture.contentHash
            const originalCandidate = previousCandidateById.get(entry.id)
            const derivedHumanCorrection =
              entry.sourceType === "HUMAN_CORRECTION" &&
              entry.sourceUrl === previousCapture.supplierUrl &&
              entry.contentHash === previousCapture.contentHash &&
              entry.capturedAt === previousCapture.capturedAt &&
              Boolean(
                originalCandidate &&
                originalCandidate.sourceUrl === entry.sourceUrl &&
                originalCandidate.contentHash === entry.contentHash &&
                originalCandidate.capturedAt === entry.capturedAt &&
                originalCandidate.field === entry.field &&
                originalCandidate.variantKey === entry.variantKey &&
                originalCandidate.extractionPath === entry.extractionPath,
              )
            return directSupplierEvidence || derivedHumanCorrection
          })
          .map((entry) => entry.id)
      : [],
  )
  let evidence = document.evidence.filter((entry) =>
    !removedEvidenceIds.has(entry.id)
  )
  let captures = document.captures.filter((capture) =>
    !previousCapture ||
    !(
      capture.sourceType === "LUNA_AUTHENTICATED_MANUAL_CAPTURE" &&
      capture.sourceUrl === previousCapture.supplierUrl &&
      capture.capturedAt === previousCapture.capturedAt &&
      capture.contentHash === previousCapture.contentHash
    )
  )
  if (input.replacement) {
    const replacementEvidenceIds = new Set(
      input.replacement.extraction.evidence.map((entry) => entry.id),
    )
    evidence = [
      ...evidence.filter((entry) => !replacementEvidenceIds.has(entry.id)),
      ...structuredClone(input.replacement.extraction.evidence),
    ]
    const replacementCapture =
      structuredClone(input.replacement.extraction.capture)
    captures = [
      ...captures.filter((capture) =>
        !(
          capture.sourceType === replacementCapture.sourceType &&
          capture.sourceUrl === replacementCapture.sourceUrl &&
          capture.capturedAt === replacementCapture.capturedAt &&
          capture.contentHash === replacementCapture.contentHash
        )
      ),
      replacementCapture,
    ]
  }
  const observations = document.imageAnalysis.observations
  const invalidatedVisualReferences = observations.flatMap((observation) =>
    observation.contradictsEvidenceIds
      .filter((id) => removedEvidenceIds.has(id))
      .map((id) =>
        `HUMAN_VISUAL_REVIEW_STALE_SUPPLIER_REFERENCE:${observation.imageId}:${id}`
      )
  )
  const contractIssues = unique([
    ...(document.imageAnalysis.contractIssues ?? []),
    ...invalidatedVisualReferences,
    ...visualContractIssuesForDocument({
      ...document,
      evidence,
      imageAnalysis: {
        ...document.imageAnalysis,
        observations,
      },
    }),
  ])
  const supplierEvidenceIds = input.replacement
    ? input.replacement.extraction.evidence
        .filter((entry) =>
          entry.evidenceStatus !== "MISSING" &&
          SUPPLIER_IDENTITY_FIELDS.has(entry.field)
        )
        .map((entry) => entry.id)
    : []
  const conflictHistory = unique([
    ...document.identityReview.conflictHistory,
    ...(document.identityReview.currentConflict
      ? [document.identityReview.currentConflict]
      : []),
  ])
  return {
    ...document,
    supplierSourceCapture: input.replacement
      ? structuredClone(input.replacement.supplierSourceCapture)
      : null,
    captures,
    evidence,
    imageAnalysis: {
      ...document.imageAnalysis,
      conflictDetectedFrom: [],
      contractIssues,
      observations,
    },
    identityReview: {
      ...document.identityReview,
      status: "NOT_REVIEWED",
      confidence: "LOW",
      physicalProductVerified: false,
      physicalVerificationEvidenceIds: [],
      conflictHistory,
      currentConflict: null,
      supplierEvidenceIds,
      humanObservationEvidenceIds: observations.map((entry) =>
        entry.evidenceId
      ),
      blockers: input.replacement
        ? unique([
            "HUMAN_IDENTITY_REVIEW_REQUIRED",
            ...contractIssues,
          ])
        : [
            "AUTHENTICATED_SUPPLIER_CAPTURE_REQUIRED",
            "HUMAN_IDENTITY_REVIEW_REQUIRED",
            ...contractIssues,
          ],
      nextAction: input.replacement
        ? "REVIEW_PRODUCT_EVIDENCE"
        : "CAPTURE_AUTHENTICATED_SUPPLIER_EVIDENCE",
      humanReview: null,
    },
  }
}

export async function createHumanVisualReviewRecord(input: {
  document: ProductCaseDocument
  replaceEvidenceId?: string | null
  imageId: string
  sourceUrl: string | null
  sourceReference: string
  reviewerType: ProductCaseImageObservation["reviewerType"]
  observedProductType: string | null
  visibleFeatures: string[]
  visibleText: string[]
  visibleBrands: string[]
  visibleColors: string[]
  visibleQuantity: number | null
  observedVariant: string | null
  possibleConflicts: string[]
  contradictsEvidenceIds: string[]
  confidence: ProductCaseImageObservation["confidence"]
  humanDecision: ProductCaseImageObservation["humanDecision"]
  humanReason: string
  reviewedAt: string
  rawHumanInput: ProductCaseImageObservation["rawHumanInput"]
}) {
  if (!validIsoInstant(input.reviewedAt)) {
    throw new Error("HUMAN_VISUAL_REVIEW_TIMESTAMP_INVALID")
  }
  const contradicted = input.contradictsEvidenceIds.map((id) =>
    input.document.evidence.find((entry) => entry.id === id) ?? null
  )
  if (contradicted.some((entry) =>
    !entry ||
    !["title", "description", "product_type"].includes(entry.field) ||
    !["SUPPLIER_STATED", "PRODUCT_VERIFIED"].includes(
      entry.sourceEvidenceClass,
    )
  )) {
    throw new Error("HUMAN_VISUAL_REVIEW_SUPPLIER_LINK_INVALID")
  }
  const normalizeList = (values: string[]) =>
    values.map(normalizeWhitespace).filter(Boolean)
  const visibleBrands = normalizeList(input.visibleBrands).filter((brand) =>
    !/^no brand visible$/i.test(brand)
  )
  const normalizedRecord = {
    contractVersion: HUMAN_VISUAL_REVIEW_CONTRACT_VERSION,
    imageId: normalizeWhitespace(input.imageId),
    sourceUrl: input.sourceUrl,
    sourceReference: normalizeWhitespace(input.sourceReference),
    reviewerType: "HUMAN" as const,
    observedProductType: input.observedProductType
      ? normalizeWhitespace(input.observedProductType)
      : null,
    visibleFeatures: normalizeList(input.visibleFeatures),
    visibleText: normalizeList(input.visibleText),
    visibleBrands,
    visibleColors: normalizeList(input.visibleColors),
    visibleQuantity: input.visibleQuantity,
    observedVariant: input.observedVariant
      ? normalizeWhitespace(input.observedVariant)
      : null,
    possibleConflicts: normalizeList(input.possibleConflicts),
    contradictsEvidenceIds: [...input.contradictsEvidenceIds].sort(),
    confidence: input.confidence,
    humanDecision: input.humanDecision,
    humanReason: normalizeWhitespace(input.humanReason),
    reviewedAt: input.reviewedAt,
    rawHumanInput: structuredClone(input.rawHumanInput),
  }
  if (!normalizedRecord.imageId || !normalizedRecord.sourceReference ||
    !normalizedRecord.humanReason) {
    throw new Error("HUMAN_VISUAL_REVIEW_REQUIRED_FIELD_MISSING")
  }
  const selectedObservation = input.replaceEvidenceId
    ? input.document.imageAnalysis.observations.find((entry) =>
        entry.evidenceId === input.replaceEvidenceId
      ) ?? null
    : null
  if (input.replaceEvidenceId && !selectedObservation) {
    throw new Error("HUMAN_VISUAL_REVIEW_EDIT_TARGET_STALE")
  }
  const collidingObservation =
    input.document.imageAnalysis.observations.find((entry) =>
      normalizeWhitespace(entry.imageId) === normalizedRecord.imageId &&
      entry.evidenceId !== selectedObservation?.evidenceId
    ) ?? null
  if (input.replaceEvidenceId && collidingObservation) {
    throw new Error("HUMAN_VISUAL_REVIEW_IMAGE_ID_COLLISION")
  }
  const conflictLinked =
    normalizedRecord.possibleConflicts.length > 0 &&
    normalizedRecord.contradictsEvidenceIds.length > 0
  const serialized = stableValue(normalizedRecord)
  const contentHash = await hashProductCaseContent(serialized)
  const evidenceId = visualEvidenceId(contentHash, normalizedRecord.imageId)
  const observation: ProductCaseImageObservation = {
    ...normalizedRecord,
    evidenceId,
    contentHash: contentHash as `sha256:${string}`,
    sourceType: "SUPPLIER_IMAGE",
    verificationStatus: "SOURCE_IMAGE_OBSERVED",
    physicalProductVerified: false,
    captureMethod: "HUMAN_VISUAL_REVIEW",
  }
  const evidence: ProductCaseEvidence = {
    id: evidenceId,
    field: "visual_observation",
    label: FIELD_LABELS.visual_observation,
    variantKey: input.observedVariant,
    sourceType: "HUMAN_VISUAL_OBSERVATION",
    sourceUrl: input.document.sourceUrl,
    capturedAt: input.reviewedAt,
    contentHash,
    extractionPath: `humanVisualReview.${normalizedRecord.imageId}`,
    extractionMethod: "HUMAN_STRUCTURED_REVIEW",
    rawValue: normalizedRecord,
    normalizedValue: normalizedRecord,
    evidenceClass: "HUMAN_VISUAL_REVIEW",
    sourceEvidenceClass: "HUMAN_VISUAL_REVIEW",
    evidenceStatus: input.humanDecision === "REJECT_FOR_EBAY_HANDOFF"
      ? "REJECTED"
      : input.humanDecision === "ACCEPT_FOR_ANALYSIS"
        ? "ACCEPTED"
        : "NEEDS_MORE_EVIDENCE",
    humanVerdict: input.humanDecision === "REJECT_FOR_EBAY_HANDOFF"
      ? "REJECT"
      : input.humanDecision === "ACCEPT_FOR_ANALYSIS"
        ? "ACCEPT"
        : "NEEDS_MORE_EVIDENCE",
    humanReason: normalizedRecord.humanReason,
    originalValue: normalizedRecord,
    correctedValue: null,
    conflictKey: null,
    availabilityPurpose: null,
    demandEvidence: null,
  }
  const capture: ProductCaseCapture = {
    sourceType: "HUMAN_VISUAL_OBSERVATION",
    sourceUrl: input.document.sourceUrl,
    capturedAt: input.reviewedAt,
    contentHash,
    parserVersion: null,
    sourceContractVersion: null,
    parseHealth: null,
    stockState: null,
    format: "JSON",
    byteLength: utf8Length(serialized),
    fullContentStored: false,
    scriptsExecuted: false,
    resourcesLoaded: false,
  }
  const replacedObservations = input.document.imageAnalysis.observations.filter(
    (entry) => selectedObservation
      ? entry.evidenceId === selectedObservation.evidenceId
      : normalizeWhitespace(entry.imageId) === normalizedRecord.imageId,
  )
  const replacedEvidenceIds = new Set(
    replacedObservations.map((entry) => entry.evidenceId),
  )
  const replacedHashes = new Set<string>(
    replacedObservations.map((entry) => entry.contentHash),
  )
  const retainedObservations = input.document.imageAnalysis.observations.filter(
    (entry) => !replacedEvidenceIds.has(entry.evidenceId),
  )
  const updatedEvidence = [
    ...input.document.evidence
      .filter((entry) => !replacedEvidenceIds.has(entry.id))
      .map((entry) => ({ ...entry })),
    evidence,
  ]
  const observations = [...retainedObservations, observation]
  const replacedImageIds = new Set([
    ...replacedObservations.map((entry) => entry.imageId),
    normalizedRecord.imageId,
  ])
  const retainedContractIssues =
    (input.document.imageAnalysis.contractIssues ?? []).filter((issue) =>
      ![...replacedImageIds].some((imageId) =>
        visualContractIssueMatchesImage(issue, imageId)
      )
    )
  const nextContractIssues = unique([
    ...retainedContractIssues,
    ...visualContractIssuesForDocument({
      ...input.document,
      evidence: updatedEvidence,
      imageAnalysis: {
        ...input.document.imageAnalysis,
        observations,
      },
    }),
  ])
  const captures = [
    ...input.document.captures.filter((entry) =>
      entry.sourceType !== "HUMAN_VISUAL_OBSERVATION" ||
      !replacedHashes.has(entry.contentHash)
    ),
    capture,
  ]
  const priorConflictHistory = input.document.identityReview.conflictHistory
  const currentVisualConflicts = observations.flatMap((entry) =>
    entry.possibleConflicts
  )
  const updatedDocument: ProductCaseDocument = {
    ...input.document,
    evidence: updatedEvidence,
    captures,
    imageAnalysis: {
      ...input.document.imageAnalysis,
      visualEvidenceStatus: "HUMAN_REVIEWED",
      contractIssues: nextContractIssues,
      conflictDetectedFrom: observations.some((entry) =>
          entry.possibleConflicts.length > 0 &&
          entry.contradictsEvidenceIds.length > 0
        )
        ? ["SUPPLIER_TEXT", "HUMAN_VISUAL_REVIEW"]
        : [],
      observations,
    },
    identityReview: {
      ...input.document.identityReview,
      status: "NOT_REVIEWED",
      confidence: "LOW",
      physicalProductVerified: false,
      physicalVerificationEvidenceIds: [],
      conflictHistory: unique([
        ...priorConflictHistory,
        ...currentVisualConflicts,
      ]),
      currentConflict: null,
      supplierEvidenceIds: unique(
        observations.flatMap((entry) => entry.contradictsEvidenceIds),
      ),
      humanObservationEvidenceIds: observations.map((entry) =>
        entry.evidenceId
      ),
      blockers: unique([
        "HUMAN_IDENTITY_REVIEW_REQUIRED_AFTER_VISUAL_EVIDENCE_CHANGE",
        ...nextContractIssues,
        ...currentVisualConflicts,
      ]),
      nextAction: "REVIEW_PRODUCT_EVIDENCE",
      humanReview: null,
    },
  }
  return {
    observation,
    evidence,
    capture,
    updatedEvidence,
    updatedDocument,
    conflicts: conflictsForEvidence(updatedEvidence),
    identityConflict: conflictLinked
      ? {
          status: "CONFLICTED" as const,
          confidence: "LOW" as const,
          physicalProductVerified: false,
          physicalVerificationEvidenceIds: [],
          supplierEvidenceIds: [...normalizedRecord.contradictsEvidenceIds],
          humanObservationEvidenceIds: [evidenceId],
          conflictHistory: ["SUPPLIER_TEXT_VS_HUMAN_VISUAL_REVIEW"],
          currentConflict: "SUPPLIER_TEXT_VS_HUMAN_VISUAL_REVIEW",
          blockers: unique([
            ...normalizedRecord.possibleConflicts,
            "PHYSICAL_PRODUCT_AND_VARIANT_VERIFICATION_REQUIRED",
          ]),
          nextAction: "VERIFY_PHYSICAL_PRODUCT_AND_VARIANT",
          conflictDetectedFrom: [
            "SUPPLIER_TEXT",
            "HUMAN_VISUAL_REVIEW",
          ] as const,
        }
      : null,
    safety: PRODUCT_CASE_ZERO_EFFECTS,
  }
}

export function deleteHumanVisualReviewRecord(input: {
  document: ProductCaseDocument
  imageId: string
}): ProductCaseDocument {
  const imageId = normalizeWhitespace(input.imageId)
  const removed = input.document.imageAnalysis.observations.filter((entry) =>
    normalizeWhitespace(entry.imageId) === imageId
  )
  if (removed.length === 0) return structuredClone(input.document)
  const removedEvidenceIds = new Set(removed.map((entry) => entry.evidenceId))
  const removedHashes = new Set<string>(
    removed.map((entry) => entry.contentHash),
  )
  const observations = input.document.imageAnalysis.observations.filter(
    (entry) => normalizeWhitespace(entry.imageId) !== imageId,
  )
  const retainedEvidence = input.document.evidence.filter((entry) =>
    !removedEvidenceIds.has(entry.id)
  )
  const retainedContractIssues =
    (input.document.imageAnalysis.contractIssues ?? []).filter((issue) =>
      !visualContractIssueMatchesImage(issue, imageId)
    )
  const nextContractIssues = unique([
    ...retainedContractIssues,
    ...visualContractIssuesForDocument({
      ...input.document,
      evidence: retainedEvidence,
      imageAnalysis: {
        ...input.document.imageAnalysis,
        observations,
      },
    }),
  ])
  const conflicts = observations.flatMap((entry) => entry.possibleConflicts)
  return {
    ...input.document,
    evidence: retainedEvidence,
    captures: input.document.captures.filter((entry) =>
      entry.sourceType !== "HUMAN_VISUAL_OBSERVATION" ||
      !removedHashes.has(entry.contentHash)
    ),
    imageAnalysis: {
      ...input.document.imageAnalysis,
      visualEvidenceStatus: observations.length > 0
        ? "HUMAN_REVIEWED"
        : "NOT_REVIEWED",
      contractIssues: nextContractIssues,
      conflictDetectedFrom: observations.some((entry) =>
          entry.possibleConflicts.length > 0 &&
          entry.contradictsEvidenceIds.length > 0
        )
        ? ["SUPPLIER_TEXT", "HUMAN_VISUAL_REVIEW"]
        : [],
      observations,
    },
    identityReview: {
      ...input.document.identityReview,
      status: "NOT_REVIEWED",
      confidence: "LOW",
      physicalProductVerified: false,
      physicalVerificationEvidenceIds: [],
      conflictHistory: unique([
        ...input.document.identityReview.conflictHistory,
        ...removed.flatMap((entry) => entry.possibleConflicts),
      ]),
      currentConflict: null,
      supplierEvidenceIds: unique(
        observations.flatMap((entry) => entry.contradictsEvidenceIds),
      ),
      humanObservationEvidenceIds: observations.map((entry) =>
        entry.evidenceId
      ),
      blockers: unique([
        "HUMAN_IDENTITY_REVIEW_REQUIRED_AFTER_VISUAL_EVIDENCE_CHANGE",
        ...nextContractIssues,
        ...conflicts,
      ]),
      nextAction: "REVIEW_PRODUCT_EVIDENCE",
      humanReview: null,
    },
  }
}

export function reviewHumanComparableCandidate(
  candidate: ProductCaseHumanComparableCandidate,
  review: {
    decision:
      | "KEEP_NOT_VALIDATED"
      | "REJECT"
      | "VALIDATE_ACTIVE_EXACT"
    reason: string
    reviewer: string
    reviewedAt: string
    identityVisualMatch: boolean
    variantMatch: boolean
    contentsMatch: boolean
    packQuantityMatch: boolean
    validatedTitle?: string | null
    validatedPackQuantity?: number | null
    validatedVariantComposition?: string[]
    buyerShipping?: number | null
    reasonCodes?: string[]
  },
): ProductCaseHumanComparableCandidate {
  const reason = normalizeWhitespace(review.reason)
  const reviewer = normalizeWhitespace(review.reviewer)
  if (!reason || !reviewer || !validIsoInstant(review.reviewedAt)) {
    throw new Error("COMPARABLE_HUMAN_REVIEW_PROVENANCE_REQUIRED")
  }
  const gatesPass = review.identityVisualMatch && review.variantMatch &&
    review.contentsMatch && review.packQuantityMatch
  const canValidate = review.decision === "VALIDATE_ACTIVE_EXACT" &&
    candidate.listingStatus === "ACTIVE_VISIBLE" &&
    Boolean(candidate.ebayItemId) &&
    Boolean(review.validatedTitle && normalizeWhitespace(
      review.validatedTitle,
    )) &&
    Number.isInteger(review.validatedPackQuantity) &&
    Number(review.validatedPackQuantity) > 0 &&
    typeof review.buyerShipping === "number" &&
    Number.isFinite(review.buyerShipping) &&
    review.buyerShipping >= 0 &&
    gatesPass
  if (review.decision === "VALIDATE_ACTIVE_EXACT" && !canValidate) {
    throw new Error("COMPARABLE_ACTIVE_EXACT_VALIDATION_INCOMPLETE")
  }
  const rejected = review.decision === "REJECT"
  return {
    ...candidate,
    validationStatus: canValidate
      ? "VALIDATED_ACTIVE_EXACT"
      : "NOT_VALIDATED",
    identityValidated: canValidate,
    variantValidated: canValidate,
    contentsValidated: canValidate,
    packQuantityValidated: canValidate,
    eligibleForStrategyLab: canValidate,
    provisionalCohort: canValidate
      ? "ACTIVE_EXACT"
      : rejected ? "REJECTED" : "SIMILAR_NOT_EXACT",
    review: {
      decision: review.decision,
      reason,
      reviewer,
      reviewedAt: review.reviewedAt,
      validatedTitle: canValidate
        ? normalizeWhitespace(review.validatedTitle!)
        : null,
      validatedPackQuantity: canValidate
        ? Number(review.validatedPackQuantity)
        : null,
      validatedVariantComposition: canValidate
        ? unique((review.validatedVariantComposition ?? [])
            .map(normalizeWhitespace).filter(Boolean))
        : [],
      buyerShipping: canValidate ? Number(review.buyerShipping) : null,
      reasonCodes: unique((review.reasonCodes ?? []).map(normalizeWhitespace)
        .filter(Boolean)),
    },
    validationBlockers: canValidate
      ? []
      : unique([
          ...(rejected ? ["HUMAN_REJECTED"] : []),
          ...(!review.identityVisualMatch
            ? ["EXACT_IDENTITY_NOT_VALIDATED"] : []),
          ...(!review.variantMatch ? ["VARIANT_NOT_VALIDATED"] : []),
          ...(!review.contentsMatch ? ["CONTENTS_NOT_VALIDATED"] : []),
          ...(!review.packQuantityMatch
            ? ["PACK_QUANTITY_NOT_VALIDATED"] : []),
          ...(!candidate.ebayItemId ? ["EBAY_ITEM_ID_MISSING"] : []),
          ...(candidate.listingStatus !== "ACTIVE_VISIBLE"
            ? ["ACTIVE_LISTING_REQUIRED"] : []),
        ]),
  }
}

export function humanComparableCandidateToStrategyComparable(
  candidate: ProductCaseHumanComparableCandidate,
): ComparableInput | null {
  if (
    candidate.validationStatus !== "VALIDATED_ACTIVE_EXACT" ||
    candidate.review.decision !== "VALIDATE_ACTIVE_EXACT" ||
    !candidate.eligibleForStrategyLab ||
    !candidate.ebayItemId ||
    !candidate.review.validatedTitle ||
    !candidate.review.validatedPackQuantity ||
    candidate.review.buyerShipping === null ||
    !candidate.identityValidated ||
    !candidate.variantValidated ||
    !candidate.contentsValidated ||
    !candidate.packQuantityValidated
  ) return null
  return {
    itemId: candidate.ebayItemId,
    title: candidate.review.validatedTitle,
    sourceKind: "EBAY_ACTIVE",
    sourceReference: candidate.sourceReference,
    observedAt: candidate.review.reviewedAt ?? candidate.observedAt,
    identityMatch: "EXACT",
    identityMatchBasis: ["HUMAN_VERIFIED"],
    offerScenario: candidate.review.validatedPackQuantity === 1
      ? "SINGLE"
      : candidate.review.validatedPackQuantity === 2
        ? "TWO_PACK"
        : candidate.review.validatedPackQuantity === 3
          ? "THREE_PACK"
          : candidate.review.validatedVariantComposition.length > 1
            ? "MIXED_VARIANT_BUNDLE"
            : "SINGLE",
    packQuantity: candidate.review.validatedPackQuantity,
    variantComposition: [...candidate.review.validatedVariantComposition],
    itemPrice: candidate.observedPriceApprox,
    buyerShipping: candidate.review.buyerShipping,
    currency: candidate.currency ?? "USD",
    saleConfirmed: false,
    confirmedSoldQuantity: null,
    estimatedSoldQuantity: candidate.visibleSoldSignal,
  }
}

export function buildStrategyLabAdapterPreview(
  input: ProductCaseStrategyAdapterInput,
): ProductCaseStrategyAdapterResult {
  const accepted = acceptedProductCaseEvidence(input.document.evidence)
  const acceptedInputs = accepted.flatMap((entry) => {
    const mapped = runnerEvidenceToStrategy(entry)
    return mapped ? [mapped] : []
  })
  const excludedEvidence = input.document.evidence.flatMap((entry) => {
    if (entry.evidenceClass === "SUPPLIER_MERCHANDISING_SIGNAL") {
      return [{
        evidenceId: entry.id,
        reason: "MERCHANDISING_SIGNAL_NOT_STRATEGY_EVIDENCE",
      }]
    }
    if (entry.evidenceClass === "SUPPLIER_MARKETING_CLAIM") {
      return [{
        evidenceId: entry.id,
        reason: "SUPPLIER_MARKETING_CLAIM_NOT_PRODUCT_FACT",
      }]
    }
    if (entry.evidenceClass === "HUMAN_VISUAL_REVIEW") {
      return [{
        evidenceId: entry.id,
        reason: "HUMAN_VISUAL_REVIEW_NOT_STRATEGY_PRODUCT_FACT",
      }]
    }
    if (entry.field === "visible_stock") {
      return [{
        evidenceId: entry.id,
        reason:
          "SUPPLIER_AVAILABILITY_IS_INVENTORY_SIGNAL_NOT_MARKET_EVIDENCE",
      }]
    }
    if (!accepted.some((candidate) => candidate.id === entry.id)) {
      return [{
        evidenceId: entry.id,
        reason: entry.evidenceStatus === "REJECTED"
          ? "HUMAN_REJECTED"
          : entry.evidenceStatus === "CONFLICTED"
            ? "CONFLICT_NOT_RESOLVED"
            : entry.evidenceStatus === "MISSING"
              ? "MISSING"
              : "HUMAN_ACCEPTANCE_REQUIRED",
      }]
    }
    return []
  })
  const validatedComparableInputs =
    input.document.marketEvidence.humanSuppliedComparableCandidates.flatMap(
      (candidate) => {
        const comparable = humanComparableCandidateToStrategyComparable(
          candidate,
        )
        return comparable ? [comparable] : []
      },
    )
  const excludedComparableCandidates =
    input.document.marketEvidence.humanSuppliedComparableCandidates
      .filter((candidate) =>
        !validatedComparableInputs.some((comparable) =>
          comparable.itemId === candidate.ebayItemId
        )
      )
      .map((candidate) => ({
          ebayItemId: candidate.ebayItemId,
          reason:
            "HUMAN_SUPPLIED_COMPARABLE_CANDIDATE_REQUIRES_VALIDATION" as const,
        }))
  const blockers: string[] = []
  const draft = input.scenarioDraft
  if (input.document.identityReview.status === "CONFLICTED" ||
    !identityReviewReady(input.document)) {
    const identityBlockers = unique(
      input.document.identityReview.blockers.length
        ? input.document.identityReview.blockers
        : ["IDENTITY_AND_PHYSICAL_PRODUCT_VERIFICATION_REQUIRED"],
    )
    return {
      status: "BLOCKED",
      acceptedEvidenceInputs: acceptedInputs,
      acceptedRunnerEvidenceIds: accepted.map((entry) => entry.id),
      excludedEvidence,
      excludedComparableCandidates,
      validatedComparableInputs,
      blockers: identityBlockers,
      strategyLabInput: null,
      osConclusion: "HOLD_IDENTITY",
      nextAction: input.document.identityReview.nextAction ||
        "VERIFY_PHYSICAL_PRODUCT_AND_VARIANT",
      marketEvidence: input.document.marketEvidence,
      currentEvidenceLeader: null,
      strategicHypothesisToValidate: null,
      safety: PRODUCT_CASE_ZERO_EFFECTS,
    }
  }
  const validSupplierAvailability = accepted.some((entry) => {
    const value = effectiveEvidenceValue(entry)
    return entry.field === "visible_stock" &&
      ["PRODUCT_VERIFIED", "SUPPLIER_STATED"].includes(entry.evidenceClass) &&
      typeof value === "number" && Number.isInteger(value) && value >= 0 &&
      entry.availabilityPurpose === "INVENTORY_SIGNAL" &&
      entry.demandEvidence === "NONE"
  })
  if (!validSupplierAvailability) {
    blockers.push("SUPPLIER_AVAILABILITY_EVIDENCE_MISSING_OR_INVALID")
  }
  if (!draft) blockers.push("SCENARIO_DRAFT_MISSING")
  if (!input.economicsPolicy) blockers.push("ECONOMICS_POLICY_MISSING")
  if (input.document.sourceAccess.status ===
    "AUTHENTICATED_SOURCE_REQUIRED" &&
    !input.document.captures.some((capture) =>
      capture.sourceType === "LUNA_AUTHENTICATED_MANUAL_CAPTURE"
    )) {
    blockers.push("AUTHENTICATED_SUPPLIER_CAPTURE_REQUIRED")
  }

  const requiredIdentity = draft?.requiredIdentityFields.length
    ? draft.requiredIdentityFields
    : ["title", "supplier_product_id", "variant_id"] as
      ProductCaseEvidenceField[]
  for (const field of requiredIdentity) {
    if (!acceptedEvidenceByField(input.document.evidence, field).some(
      (entry) => ["SUPPLIER_STATED", "PRODUCT_VERIFIED"].includes(
        entry.evidenceClass,
      ),
    )) blockers.push(`IDENTITY_EVIDENCE_MISSING:${field}`)
  }
  if (!acceptedEvidenceByField(input.document.evidence, "variant_id")
    .some((entry) => ["SUPPLIER_STATED", "PRODUCT_VERIFIED"].includes(
      entry.evidenceClass,
    ))) blockers.push("VARIANT_EVIDENCE_MISSING")

  const pack = draft
    ? numericAcceptedEvidence(
        input.document.evidence,
        draft.packQuantityEvidenceId,
        "pack_quantity",
      )
    : null
  if (!pack || !Number.isInteger(pack.value) || pack.value <= 0 ||
    !["PRODUCT_VERIFIED", "SUPPLIER_STATED"].includes(
      pack.entry.evidenceClass,
    )) {
    blockers.push("PACK_QUANTITY_EVIDENCE_MISSING")
  }

  const costLines = draft?.costLines.map((line) => {
    const cost = numericAcceptedEvidence(
      input.document.evidence,
      line.unitCostEvidenceId,
      "supplier_unit_cost",
    )
    if (!cost || !["SUPPLIER_STATED", "PRODUCT_VERIFIED"].includes(
      cost.entry.evidenceClass,
    )) {
      blockers.push(`PRODUCT_UNIT_COST_EVIDENCE_MISSING:${line.variantKey}`)
      return null
    }
    return {
      variantKey: line.variantKey,
      quantity: line.quantity,
      unitCost: cost.value,
      evidenceId: cost.entry.id,
    }
  }) ?? []
  if (!costLines.length) blockers.push("PRODUCT_UNIT_COST_EVIDENCE_MISSING")
  if (costLines.some((line) => !line) ||
    costLines.some((line) =>
      !Number.isInteger(line?.quantity) || Number(line?.quantity) <= 0
    ) ||
    (pack && costLines.reduce((total, line) =>
      total + Number(line?.quantity ?? 0), 0
    ) !== pack.value)) {
    blockers.push("PACK_COST_LINE_QUANTITY_CONFLICT")
  }

  const packaging = draft
    ? numericAcceptedEvidence(
        input.document.evidence,
        draft.packagingCostEvidenceId,
        "packaging_cost",
      )
    : null
  if (!packaging || !["SUPPLIER_STATED", "PRODUCT_VERIFIED"].includes(
    packaging.entry.evidenceClass,
  )) blockers.push("PACKAGING_COST_EVIDENCE_MISSING")
  const outboundShipping = draft
    ? numericAcceptedEvidence(
        input.document.evidence,
        draft.outboundShippingCostEvidenceId,
        "outbound_shipping_cost",
      )
    : null
  if (!outboundShipping ||
    !["SUPPLIER_STATED", "PRODUCT_VERIFIED"].includes(
      outboundShipping.entry.evidenceClass,
    )) blockers.push("OUTBOUND_SHIPPING_COST_EVIDENCE_MISSING")
  const listingPrice = draft
    ? numericAcceptedEvidence(
        input.document.evidence,
        draft.listingPriceEvidenceId,
        "listing_price",
      )
    : null
  if (!listingPrice) blockers.push("LISTING_PRICE_EVIDENCE_MISSING")
  const buyerShipping = draft
    ? numericAcceptedEvidence(
        input.document.evidence,
        draft.buyerShippingChargeEvidenceId,
        "buyer_shipping_charge",
      )
    : null
  if (!buyerShipping) blockers.push("BUYER_SHIPPING_CHARGE_EVIDENCE_MISSING")

  for (const field of draft?.requiredDimensionFields ?? []) {
    if (!acceptedEvidenceByField(input.document.evidence, field).some(
      (entry) => entry.evidenceClass === "PRODUCT_VERIFIED",
    )) blockers.push(`PRODUCT_VERIFIED_MEASUREMENT_MISSING:${field}`)
  }
  if (input.document.marketEvidence.runStatus !== "COMPLETE") {
    blockers.push("MARKET_EVIDENCE_NOT_RUN")
  }
  if (input.document.marketEvidence.soldExact !== "AVAILABLE") {
    blockers.push("SOLD_EXACT_MISSING")
  }
  if (input.document.marketEvidence.marketCeiling !== "AVAILABLE") {
    blockers.push("MARKET_CEILING_MISSING")
  }

  const uniqueBlockers = unique(blockers).sort()
  if (uniqueBlockers.length || !draft || !input.economicsPolicy ||
    !pack || !packaging || !outboundShipping || !listingPrice ||
    !buyerShipping || costLines.some((line) => !line)) {
    return {
      status: "BLOCKED",
      acceptedEvidenceInputs: acceptedInputs,
      acceptedRunnerEvidenceIds: accepted.map((entry) => entry.id),
      excludedEvidence,
      excludedComparableCandidates,
      validatedComparableInputs,
      blockers: uniqueBlockers,
      strategyLabInput: null,
      osConclusion: "HOLD_EVIDENCE_INCOMPLETE",
      nextAction: adapterNextAction(uniqueBlockers),
      marketEvidence: input.document.marketEvidence,
      currentEvidenceLeader: draft
        ? {
            scenarioId: draft.id,
            offerScenario: draft.offerScenario,
            label: "CURRENT EVIDENCE LEADER",
            subtitle:
              "Escenario actualmente mejor respaldado; no está aprobado para ejecutar.",
          }
        : null,
      strategicHypothesisToValidate:
        draft?.hypothesisEvidenceClass === "HUMAN_HYPOTHESIS"
          ? {
              scenarioId: draft.id,
              offerScenario: draft.offerScenario,
              evidenceClass: "HUMAN_HYPOTHESIS",
              label: "STRATEGIC HYPOTHESIS TO VALIDATE",
            }
          : null,
      safety: PRODUCT_CASE_ZERO_EFFECTS,
    }
  }

  const identityRequirements = requiredIdentity.map((field) => ({
    field: strategyEvidenceField(field),
    blockerCode: `IDENTITY_EVIDENCE_MISSING:${field}`,
    acceptedEvidenceClasses: [
      "PRODUCT_VERIFIED",
      "SUPPLIER_STATED",
    ] as EvidenceClass[],
    requiredPurpose: "IDENTITY" as const,
    requireProductFact: true,
  }))
  const scenario = {
    id: draft.id,
    offerScenario: draft.offerScenario,
    packQuantity: pack.value,
    variantComposition: [...draft.variantComposition],
    costLines: costLines.filter(
      (line): line is NonNullable<typeof line> => Boolean(line),
    ),
    packagingCost: packaging.value,
    packagingCostEvidenceId: packaging.entry.id,
    itemPrice: listingPrice.value,
    buyerShippingCharge: buyerShipping.value,
    outboundShippingCost: outboundShipping.value,
    outboundShippingCostEvidenceId: outboundShipping.entry.id,
    hypothesisEvidenceClass: draft.hypothesisEvidenceClass ?? null,
    requiredEvidence: draft.requiredDimensionFields.map((field) => ({
      field: strategyEvidenceField(field),
      blockerCode: `PRODUCT_VERIFIED_MEASUREMENT_MISSING:${field}`,
      acceptedEvidenceClasses: ["PRODUCT_VERIFIED"] as EvidenceClass[],
      requiredPurpose: "COMPATIBILITY" as const,
      requireProductFact: true,
    })),
    requiresExactSoldEvidence: draft.requiresExactSoldEvidence,
    creativeSeed: draft.creativeSeed,
  }
  const strategyLabInput: StrategyLabCaseInput = {
    fixtureVersion: PRODUCT_CASE_RUNNER_VERSION,
    caseId: input.document.caseId,
    productLabel: input.document.productLabel,
    evaluatedAt: input.evaluatedAt,
    currency: "USD",
    economicsPolicy: input.economicsPolicy,
    evidence: acceptedInputs,
    comparables: [
      ...input.document.marketEvidence.comparables,
      ...validatedComparableInputs,
    ],
    scenarios: [scenario],
    identityRequirements,
    compatibility: draft.requiredDimensionFields.length
      ? {
          required: true,
          requirements: scenario.requiredEvidence,
        }
      : { required: false, requirements: [] },
  }
  const evaluation = evaluateStrategyLabCase(strategyLabInput)
  return {
    status: "READY",
    acceptedEvidenceInputs: acceptedInputs,
    acceptedRunnerEvidenceIds: accepted.map((entry) => entry.id),
    excludedEvidence,
    excludedComparableCandidates,
    validatedComparableInputs,
    blockers: [],
    strategyLabInput,
    osConclusion: evaluation.recommendation.releaseGate,
    nextAction: evaluation.recommendation.nextAction,
    marketEvidence: input.document.marketEvidence,
    currentEvidenceLeader: {
      scenarioId: evaluation.recommendation.preferredScenarioId ?? draft.id,
      offerScenario:
        evaluation.recommendation.preferredScenario ?? draft.offerScenario,
      label: "CURRENT EVIDENCE LEADER",
      subtitle:
        "Escenario actualmente mejor respaldado; no está aprobado para ejecutar.",
    },
    strategicHypothesisToValidate:
      draft.hypothesisEvidenceClass === "HUMAN_HYPOTHESIS"
        ? {
            scenarioId: draft.id,
            offerScenario: draft.offerScenario,
            evidenceClass: "HUMAN_HYPOTHESIS",
            label: "STRATEGIC HYPOTHESIS TO VALIDATE",
          }
        : null,
    safety: PRODUCT_CASE_ZERO_EFFECTS,
  }
}

function acceptedFirst(
  evidence: ProductCaseEvidence[],
  field: ProductCaseEvidenceField,
) {
  return acceptedProductCaseEvidence(evidence)
    .find((entry) => entry.field === field) ?? null
}

function acceptedText(
  evidence: ProductCaseEvidence[],
  field: ProductCaseEvidenceField,
) {
  const value = effectiveEvidenceValue(acceptedFirst(evidence, field) ??
    {} as ProductCaseEvidence)
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function acceptedNumber(
  evidence: ProductCaseEvidence[],
  field: ProductCaseEvidenceField,
) {
  const entry = acceptedFirst(evidence, field)
  const value = entry ? effectiveEvidenceValue(entry) : null
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function buildProductCaseImageRegistry(input: {
  document: ProductCaseDocument
  approvals?: ProductCaseImageApproval[]
}): ProductCaseImageRegistry {
  const acceptedImages = acceptedProductCaseEvidence(input.document.evidence)
    .filter((entry) => entry.field === "source_image_url")
  const expectedPackQuantity = acceptedNumber(
    input.document.evidence,
    "pack_quantity",
  )
  const expectedVariantId = acceptedText(
    input.document.evidence,
    "variant_id",
  )
  const blockers: string[] = []
  const approvals = input.approvals ?? []
  const entries: ProductCaseImageRegistryEntry[] = approvals.flatMap(
    (approval, index) => {
      const sourceUrl = safeImageUrl(
        approval.sourceUrl,
        input.document.sourceUrl,
      )
      if (!sourceUrl) {
        blockers.push(`IMAGE_SOURCE_URL_INVALID:${index + 1}`)
        return []
      }
      const evidence = approval.evidenceId
        ? acceptedImages.find((entry) => entry.id === approval.evidenceId) ??
          null
        : null
      if (approval.sourceKind === "ORIGINAL_SUPPLIER" &&
        (!evidence ||
          effectiveEvidenceValue(evidence) !== sourceUrl)) {
        blockers.push(
          `ORIGINAL_SUPPLIER_IMAGE_EVIDENCE_REQUIRED:${index + 1}`,
        )
      }
      const assetHash = approval.assetHash &&
          /^sha256:[0-9a-f]{64}$/.test(approval.assetHash)
        ? approval.assetHash
        : null
      if (approval.assetHash && !assetHash) {
        blockers.push(`IMAGE_ASSET_HASH_INVALID:${index + 1}`)
      }
      const qaPassed = Object.values(approval.qa).every(Boolean)
      const approvalComplete = approval.status === "APPROVED" &&
        Boolean(assetHash) &&
        Boolean(normalizeWhitespace(approval.reviewer ?? "")) &&
        Boolean(approval.reviewedAt) &&
        validIsoInstant(approval.reviewedAt ?? "") &&
        Boolean(normalizeWhitespace(approval.reason ?? "")) &&
        Boolean(approval.humanNotes) &&
        qaPassed
      if (approval.status === "APPROVED" && !assetHash) {
        blockers.push(`IMAGE_ASSET_HASH_REQUIRED:${index + 1}`)
      }
      if (approval.status === "APPROVED" && !qaPassed) {
        blockers.push(`IMAGE_QA_INCOMPLETE:${index + 1}`)
      }
      return [{
        registryId: `image-${String(index + 1).padStart(2, "0")}`,
        evidenceId: evidence?.id ?? null,
        sourceKind: approval.sourceKind,
        sourceUrl,
        sourceCaptureHash: evidence?.contentHash ?? null,
        assetHash,
        productCaseId: input.document.caseId,
        packQuantity: approval.packQuantity,
        variantId: approval.variantId,
        purpose: normalizeWhitespace(approval.purpose),
        role: approval.role,
        order: approval.order,
        approvalStatus: approvalComplete
          ? "APPROVED"
          : approval.status === "REJECTED"
            ? "REJECTED"
            : approval.status === "SOURCE_REQUIRED"
              ? "SOURCE_REQUIRED"
              : "HUMAN_REVIEW",
        reviewer: approval.reviewer,
        reviewedAt: approval.reviewedAt,
        humanNotes: approval.humanNotes,
        qa: { ...approval.qa },
        sourceOnly: true,
        downloaded: false,
        transformed: false,
        generated: false,
      }]
    },
  )
  for (const [index, evidence] of acceptedImages.entries()) {
    if (entries.some((entry) => entry.evidenceId === evidence.id)) continue
    const sourceUrl = effectiveEvidenceValue(evidence)
    if (typeof sourceUrl !== "string") continue
    entries.push({
      registryId: `source-image-${String(index + 1).padStart(2, "0")}`,
      evidenceId: evidence.id,
      sourceKind: "ORIGINAL_SUPPLIER",
      sourceUrl,
      sourceCaptureHash: evidence.contentHash,
      assetHash: null,
      productCaseId: input.document.caseId,
      packQuantity: expectedPackQuantity,
      variantId: expectedVariantId,
      purpose: "UNASSIGNED",
      role: "SECONDARY",
      order: entries.length + 1,
      approvalStatus: "MANUAL_IMAGE_ATTACHED",
      reviewer: null,
      reviewedAt: null,
      humanNotes: null,
      qa: {
        productAndVariantMatch: false,
        packQuantityMatch: false,
        logosAndIpReviewed: false,
        claimsReviewed: false,
        ebayRoleCoherent: false,
      },
      sourceOnly: true,
      downloaded: false,
      transformed: false,
      generated: false,
    })
  }
  const approvedMain = entries.find((entry) =>
    entry.role === "MAIN" &&
    entry.order === 1 &&
    entry.approvalStatus === "APPROVED" &&
    Boolean(entry.assetHash) &&
    entry.variantId === expectedVariantId &&
    entry.packQuantity === expectedPackQuantity &&
    Object.values(entry.qa).every(Boolean)
  )
  if (entries.some((entry) =>
    entry.role === "MAIN" && entry.approvalStatus === "APPROVED"
  ) && !approvedMain) {
    blockers.push("APPROVED_MAIN_VARIANT_PACK_HASH_OR_QA_MISMATCH")
  }
  if (!entries.length) blockers.push("IMAGE_SOURCE_REQUIRED")
  if (!approvedMain) {
    blockers.push(
      "APPROVED_MAIN_WITH_EXPLICIT_ASSET_HASH_VARIANT_PACK_AND_QA_REQUIRED",
    )
  }
  const status: ProductCaseImageRegistry["status"] = approvedMain
    ? "APPROVED"
    : entries.some((entry) => entry.approvalStatus === "REJECTED")
      ? "REJECTED"
      : entries.some((entry) => entry.approvalStatus === "HUMAN_REVIEW")
        ? "HUMAN_REVIEW"
        : entries.length
          ? "MANUAL_IMAGE_ATTACHED"
          : "SOURCE_REQUIRED"
  return {
    status,
    entries: entries.sort((left, right) =>
      left.order - right.order ||
      left.registryId.localeCompare(right.registryId)
    ),
    approvedMainRegistryId: approvedMain?.registryId ?? null,
    approvedMainEvidenceId: approvedMain?.evidenceId ?? null,
    approvedMainAssetHash: approvedMain?.assetHash ?? null,
    blockers: unique(blockers),
    safety: PRODUCT_CASE_ZERO_EFFECTS,
  }
}

function listingGate(
  id: ProductCaseListingGateId,
  passed: boolean,
  blockers: string[],
  evidenceIds: string[] = [],
  notRun = false,
): ProductCaseListingGate {
  return {
    id,
    status: passed ? "PASS" : notRun ? "NOT_RUN" : "BLOCKED",
    evidenceIds: unique(evidenceIds),
    blockers: passed ? [] : unique(blockers),
  }
}

export function buildManualListingPackageDraft(input: {
  document: ProductCaseDocument
  adapter: ProductCaseStrategyAdapterResult
  imageRegistry: ProductCaseImageRegistry
  operations: ProductCaseListingOperations
  generatedAt: string
}): ProductCaseManualListingPackage {
  const accepted = acceptedProductCaseEvidence(input.document.evidence)
  const acceptedIds = accepted.map((entry) => entry.id)
  const sourceContractCapture = input.document.supplierSourceCapture
  const sourceContractHold = Boolean(
    sourceContractCapture &&
    (
      sourceContractCapture.parseHealth !== "PARSED_OK" ||
      sourceContractCapture.stockState !== "IN_STOCK_SIGNAL"
    ),
  )
  const visualContractIssues = unique([
    ...(input.document.imageAnalysis.contractIssues ?? []),
    ...visualContractIssuesForDocument(input.document),
  ])
  const identityHold = !identityReviewReady(input.document) ||
    sourceContractHold ||
    visualContractIssues.length > 0
  const acceptedLink = (id: string) => acceptedIds.includes(id)
  const linksAccepted = (ids: string[]) =>
    ids.length > 0 && ids.every(acceptedLink)
  const linkedValueMatches = (ids: string[], value: unknown) =>
    linksAccepted(ids) && ids.some((id) => {
      const entry = evidenceById(input.document.evidence, id)
      return entry && stableValue(effectiveEvidenceValue(entry)) ===
        stableValue(value)
    })
  const linkedFieldValueMatches = (
    ids: string[],
    fields: ProductCaseEvidenceField[],
    value: unknown,
  ) => linksAccepted(ids) && ids.some((id) => {
    const entry = evidenceById(input.document.evidence, id)
    return entry && fields.includes(entry.field) &&
      stableValue(effectiveEvidenceValue(entry)) === stableValue(value)
  })
  const rejectedIds = input.document.evidence
    .filter((entry) => entry.humanVerdict === "REJECT")
    .map((entry) => entry.id)
  const fieldIds = (field: ProductCaseEvidenceField) =>
    accepted.filter((entry) => entry.field === field)
      .map((entry) => entry.id)
  const sourceResolved = input.document.sourceAccess.status ===
      "PUBLIC_ACCESSIBLE" ||
    input.document.captures.some((capture) =>
      capture.sourceType === "LUNA_AUTHENTICATED_MANUAL_CAPTURE"
    )
  const humanReviewComplete = input.document.evidence.every((entry) =>
    entry.evidenceStatus === "MISSING" ||
    entry.humanVerdict !== "UNREVIEWED"
  ) && conflictsForEvidence(input.document.evidence)
    .every((entry) => entry.status === "HUMAN_RESOLVED")
  const identityFields: ProductCaseEvidenceField[] = [
    "title",
    "supplier_product_id",
  ]
  const identityReady = identityReviewReady(input.document) &&
    identityFields.every((field) => fieldIds(field).length > 0)
  const variantReady = fieldIds("variant_id").length > 0
  const packReady = accepted.some((entry) => {
    const value = effectiveEvidenceValue(entry)
    return entry.field === "pack_quantity" &&
      ["PRODUCT_VERIFIED", "SUPPLIER_STATED"].includes(entry.evidenceClass) &&
      typeof value === "number" && Number.isInteger(value) && value > 0
  })
  const supplierAvailabilityReady = accepted.some((entry) => {
    const value = effectiveEvidenceValue(entry)
    return entry.field === "visible_stock" &&
      ["PRODUCT_VERIFIED", "SUPPLIER_STATED"].includes(entry.evidenceClass) &&
      typeof value === "number" && Number.isInteger(value) && value >= 0 &&
      entry.availabilityPurpose === "INVENTORY_SIGNAL" &&
      entry.demandEvidence === "NONE"
  })
  const productCostReady = fieldIds("supplier_unit_cost")
    .some((id) => {
      const entry = evidenceById(input.document.evidence, id)
      return entry && ["SUPPLIER_STATED", "PRODUCT_VERIFIED"].includes(
        entry.evidenceClass,
      )
    })
  const packagingReady = fieldIds("packaging_cost").some((id) => {
    const entry = evidenceById(input.document.evidence, id)
    return entry && ["SUPPLIER_STATED", "PRODUCT_VERIFIED"].includes(
      entry.evidenceClass,
    )
  })
  const outboundReady = fieldIds("outbound_shipping_cost").some((id) => {
    const entry = evidenceById(input.document.evidence, id)
    return entry && ["SUPPLIER_STATED", "PRODUCT_VERIFIED"].includes(
      entry.evidenceClass,
    )
  })
  const measurementsReady = [
    "product_dimensions",
    "package_dimensions",
    "weight",
  ].every((field) =>
    accepted.some((entry) =>
      entry.field === field && entry.evidenceClass === "PRODUCT_VERIFIED"
    )
  )
  const marketReady = input.document.marketEvidence.runStatus === "COMPLETE" &&
    input.document.marketEvidence.soldExact === "AVAILABLE" &&
    input.document.marketEvidence.marketCeiling === "AVAILABLE"
  const humanStrategyApproved = Boolean(
    input.document.humanReview.conclusion.conclusion &&
    [
      "GO_SINGLE",
      "TEST_SINGLE",
      "EVALUATE_TWO_PACK",
      "EVALUATE_THREE_PACK",
      "MIXED_VARIANT_BUNDLE",
    ].includes(input.adapter.osConclusion) &&
    input.document.humanReview.conclusion.conclusion ===
      input.adapter.osConclusion &&
    input.document.humanReview.conclusion.scenario ===
      input.adapter.currentEvidenceLeader?.offerScenario &&
    Boolean(input.document.humanReview.conclusion.reviewedAt) &&
    validIsoInstant(input.document.humanReview.conclusion.reviewedAt ?? "") &&
    Boolean(normalizeWhitespace(
      input.document.humanReview.conclusion.reviewer ?? "",
    )) &&
    Boolean(normalizeWhitespace(
      input.document.humanReview.conclusion.reason ?? "",
    )),
  )
  const captureHasRealHash = input.document.captures.some((capture) =>
    /^sha256:[0-9a-f]{64}$/.test(capture.contentHash)
  )
  const optimizedTitleEvidenceReady =
    input.operations.evidenceLinks.title.length > 0 &&
    input.operations.evidenceLinks.title.every((id) => {
      const entry = evidenceById(input.document.evidence, id)
      return entry &&
        acceptedIds.includes(id) &&
        entry.field === "ebay_optimized_title" &&
        ["HUMAN_LISTING_DECISION", "HUMAN_CORRECTION"].includes(
          entry.sourceType,
        ) &&
        entry.sourceEvidenceClass === "HUMAN_HYPOTHESIS" &&
        stableValue(effectiveEvidenceValue(entry)) === stableValue(
          normalizeWhitespace(input.operations.title ?? ""),
        )
    })
  const titleReady = Boolean(
    input.operations.title &&
    normalizeWhitespace(input.operations.title).length > 0 &&
    normalizeWhitespace(input.operations.title).length <= 80 &&
    optimizedTitleEvidenceReady,
  )
  const descriptionReady = Boolean(
    input.operations.description &&
    linkedFieldValueMatches(
      input.operations.evidenceLinks.description,
      ["listing_description"],
      input.operations.description,
    ),
  )
  const categoryConditionReady = Boolean(
    input.operations.categoryId && input.operations.conditionId &&
    linkedFieldValueMatches(
      input.operations.evidenceLinks.category,
      ["ebay_category"],
      {
        id: input.operations.categoryId,
        name: input.operations.categoryName,
      },
    ) &&
    linkedFieldValueMatches(
      input.operations.evidenceLinks.condition,
      ["ebay_condition"],
      {
        id: input.operations.conditionId,
        description: input.operations.conditionDescription,
      },
    ),
  )
  const requiredSpecificsReady =
    input.operations.requiredItemSpecifics.length > 0 &&
    input.operations.requiredItemSpecifics.every((name) =>
      Array.isArray(input.operations.itemSpecifics[name]) &&
      input.operations.itemSpecifics[name].some((value) =>
        Boolean(normalizeWhitespace(value))
      ) &&
      linkedFieldValueMatches(
        input.operations.evidenceLinks.itemSpecifics[name] ?? [],
        ["ebay_item_specific"],
        {
          name,
          values: input.operations.itemSpecifics[name],
        },
      )
    )
  const rejectedVisualObservation =
    input.document.imageAnalysis.observations.some((observation) =>
      observation.humanDecision === "REJECT_FOR_EBAY_HANDOFF" ||
      observation.visibleBrands.length > 0
    )
  const brandIpClaimsReady =
    !rejectedVisualObservation &&
    input.operations.brandIpClaimsReview.status === "APPROVED" &&
    Boolean(normalizeWhitespace(
      input.operations.brandIpClaimsReview.reviewer ?? "",
    )) &&
    Boolean(input.operations.brandIpClaimsReview.reviewedAt) &&
    validIsoInstant(input.operations.brandIpClaimsReview.reviewedAt ?? "") &&
    Boolean(normalizeWhitespace(
      input.operations.brandIpClaimsReview.reason ?? "",
    ))
  const orderedImageIds = input.operations.imageEvidenceOrder
  const orderedImageEntries = orderedImageIds.map((id) =>
    input.imageRegistry.entries.find((entry) => entry.registryId === id) ??
      null
  )
  const imageOrderReady = Boolean(
    input.imageRegistry.approvedMainRegistryId &&
    input.imageRegistry.approvedMainAssetHash &&
    orderedImageIds.length > 0 &&
    orderedImageIds[0] === input.imageRegistry.approvedMainRegistryId &&
    new Set(orderedImageIds).size === orderedImageIds.length &&
    orderedImageEntries.every((entry, index) =>
      entry &&
      entry.approvalStatus === "APPROVED" &&
      entry.order === index + 1 &&
      entry.variantId === acceptedText(
        input.document.evidence,
        "variant_id",
      ) &&
      entry.packQuantity === acceptedNumber(
        input.document.evidence,
        "pack_quantity",
      ) &&
      Object.values(entry.qa).every(Boolean)
    ) &&
    !rejectedVisualObservation,
  )
  const priceQuantityReady = Boolean(
    typeof input.operations.listingPrice === "number" &&
    Number.isFinite(input.operations.listingPrice) &&
    input.operations.listingPrice > 0 &&
    Number.isInteger(input.operations.quantity) &&
    Number(input.operations.quantity) > 0 &&
    linkedFieldValueMatches(
      input.operations.evidenceLinks.listingPrice,
      ["listing_price"],
      input.operations.listingPrice,
    ) &&
    linkedFieldValueMatches(
      input.operations.evidenceLinks.quantity,
      ["listing_quantity"],
      input.operations.quantity,
    ),
  )
  const policyBundle = {
    fulfillmentPolicyId: input.operations.fulfillmentPolicyId,
    paymentPolicyId: input.operations.paymentPolicyId,
    returnPolicyId: input.operations.returnPolicyId,
    shippingPolicySummary: input.operations.shippingPolicySummary,
    returnPolicySummary: input.operations.returnPolicySummary,
    handlingTimeDays: input.operations.handlingTimeDays,
  }
  const policiesReady = Boolean(
    input.operations.fulfillmentPolicyId &&
    input.operations.paymentPolicyId &&
    input.operations.returnPolicyId &&
    input.operations.shippingPolicySummary &&
    input.operations.returnPolicySummary &&
    Number.isInteger(input.operations.handlingTimeDays) &&
    Number(input.operations.handlingTimeDays) >= 0 &&
    input.operations.itemLocation.country &&
    input.operations.itemLocation.postalCode &&
    linkedFieldValueMatches(
      input.operations.evidenceLinks.policies,
      ["listing_policy_bundle"],
      policyBundle,
    ) &&
    linkedFieldValueMatches(
      input.operations.evidenceLinks.itemLocation,
      ["item_location"],
      input.operations.itemLocation,
    ),
  )
  const strategyEvaluation = evaluateAdapterStrategy(input.adapter)
  const evaluatedScenario = strategyEvaluation?.scenarioAssessments.find(
    (assessment) =>
      assessment.scenario.id ===
        input.adapter.currentEvidenceLeader?.scenarioId,
  ) ?? strategyEvaluation?.scenarioAssessments[0] ?? null
  const evaluatedEconomics = evaluatedScenario?.economics ?? null
  const requiredEconomicsEvidenceIds = evaluatedScenario
    ? unique([
        ...evaluatedScenario.scenario.costLines.map((line) => line.evidenceId),
        evaluatedScenario.scenario.packagingCostEvidenceId ?? "",
        evaluatedScenario.scenario.outboundShippingCostEvidenceId ?? "",
      ].filter(Boolean))
    : []
  const economicsConcordant = Boolean(
    evaluatedEconomics &&
    evaluatedEconomics.investedCost !== null &&
    evaluatedEconomics.estimatedProfit !== null &&
    evaluatedEconomics.netMarginPercent !== null &&
    evaluatedEconomics.roiPercent !== null &&
    input.operations.totalInvestment === evaluatedEconomics.investedCost &&
    input.operations.estimatedProfit === evaluatedEconomics.estimatedProfit &&
    input.operations.marginPercent === evaluatedEconomics.netMarginPercent &&
    input.operations.roiPercent === evaluatedEconomics.roiPercent &&
    requiredEconomicsEvidenceIds.length > 0 &&
    requiredEconomicsEvidenceIds.every((id) =>
      input.operations.evidenceLinks.economics.includes(id)
    ),
  )
  const economicsReady = Boolean(
    input.adapter.status === "READY" &&
    productCostReady && packagingReady && outboundReady &&
    measurementsReady &&
    typeof input.operations.totalInvestment === "number" &&
    Number.isFinite(input.operations.totalInvestment) &&
    input.operations.totalInvestment > 0 &&
    typeof input.operations.estimatedProfit === "number" &&
    Number.isFinite(input.operations.estimatedProfit) &&
    typeof input.operations.marginPercent === "number" &&
    Number.isFinite(input.operations.marginPercent) &&
    typeof input.operations.roiPercent === "number" &&
    Number.isFinite(input.operations.roiPercent) &&
    economicsConcordant &&
    linksAccepted(input.operations.evidenceLinks.economics),
  )
  const evidenceAndDecisionRecordReady = Boolean(
    input.operations.supportingEvidenceIds.length > 0 &&
    input.operations.supportingEvidenceIds.every((id) =>
      acceptedIds.includes(id)
    ) &&
    input.operations.blockers.length === 0,
  )
  const explicitHumanApprovalReady = Boolean(
    input.operations.explicitHumanApproval.approved &&
    normalizeWhitespace(
      input.operations.explicitHumanApproval.reviewer ?? "",
    ) &&
    input.operations.explicitHumanApproval.reviewedAt &&
    validIsoInstant(input.operations.explicitHumanApproval.reviewedAt ?? "") &&
    normalizeWhitespace(
      input.operations.explicitHumanApproval.reason ?? "",
    ),
  )
  const gates: ProductCaseListingGate[] = [
    listingGate(
      "IDENTITY_AND_VARIANT_READY",
      sourceResolved && captureHasRealHash && humanReviewComplete &&
        identityReady && variantReady && !sourceContractHold,
      [
        ...(!sourceResolved
          ? ["AUTHENTICATED_SUPPLIER_CAPTURE_REQUIRED"] : []),
        ...(!captureHasRealHash ? ["RAW_CAPTURE_HASH_REQUIRED"] : []),
        ...(!humanReviewComplete ? ["HUMAN_FIELD_REVIEW_INCOMPLETE"] : []),
        ...(!identityReady ? ["IDENTITY_EVIDENCE_INCOMPLETE"] : []),
        ...(!variantReady ? ["VARIANT_EVIDENCE_INCOMPLETE"] : []),
        ...(sourceContractHold
          ? ["LUNA_SOURCE_CONTRACT_GUARD_BLOCKED"] : []),
        ...visualContractIssues,
      ],
      [...identityFields.flatMap(fieldIds), ...fieldIds("variant_id")],
    ),
    listingGate(
      "SUPPLIER_AVAILABILITY_READY",
      input.operations.supplierAvailabilityStatus ===
        "CONFIRMED_AVAILABLE" &&
        supplierAvailabilityReady &&
        !sourceContractHold,
      [
        "CURRENT_SUPPLIER_AVAILABILITY_CONFIRMATION_REQUIRED",
        ...(sourceContractHold
          ? ["LUNA_SOURCE_CONTRACT_GUARD_BLOCKED"] : []),
      ],
      fieldIds("visible_stock"),
    ),
    listingGate(
      "PACK_QUANTITY_READY",
      packReady,
      ["PACK_QUANTITY_EVIDENCE_INCOMPLETE"],
      fieldIds("pack_quantity"),
    ),
    listingGate(
      "MARKET_EVIDENCE_READY",
      marketReady,
      ["MARKET_EVIDENCE_NOT_RUN"],
      [],
      input.document.marketEvidence.runStatus !== "COMPLETE",
    ),
    listingGate(
      "ECONOMICS_READY",
      economicsReady,
      unique([
        ...input.adapter.blockers,
        ...(!productCostReady
          ? ["PRODUCT_UNIT_COST_EVIDENCE_INCOMPLETE"] : []),
        ...(!packagingReady
          ? ["PACKAGING_COST_EVIDENCE_INCOMPLETE"] : []),
        ...(!outboundReady
          ? ["OUTBOUND_SHIPPING_EVIDENCE_INCOMPLETE"] : []),
        ...(!measurementsReady
          ? ["PRODUCT_VERIFIED_DIMENSIONS_AND_WEIGHT_REQUIRED"] : []),
        ...(!economicsReady
          ? ["TOTAL_INVESTMENT_PROFIT_MARGIN_AND_ROI_REQUIRED"] : []),
        ...(!economicsConcordant
          ? ["LISTING_ECONOMICS_DO_NOT_MATCH_STRATEGY_SCENARIO"] : []),
      ]),
      input.operations.evidenceLinks.economics,
      input.document.marketEvidence.runStatus !== "COMPLETE",
    ),
    listingGate(
      "STRATEGY_HUMAN_REVIEW_READY",
      humanStrategyApproved,
      ["HUMAN_STRATEGY_APPROVAL_REQUIRED"],
    ),
    listingGate(
      "TITLE_READY",
      titleReady && descriptionReady,
      [
        "HUMAN_REVIEWED_TITLE_REQUIRED_MAX_80_CHARACTERS",
        "EBAY_OPTIMIZED_TITLE_EVIDENCE_REQUIRED",
        "EVIDENCE_LINKED_LISTING_DESCRIPTION_REQUIRED",
      ],
      [
        ...input.operations.evidenceLinks.title,
        ...input.operations.evidenceLinks.description,
      ],
    ),
    listingGate(
      "CATEGORY_AND_CONDITION_READY",
      categoryConditionReady,
      ["CATEGORY_AND_CONDITION_REQUIRED"],
      [
        ...input.operations.evidenceLinks.category,
        ...input.operations.evidenceLinks.condition,
      ],
    ),
    listingGate(
      "REQUIRED_ITEM_SPECIFICS_READY",
      requiredSpecificsReady,
      ["ALL_REQUIRED_ITEM_SPECIFICS_REQUIRED"],
      Object.values(input.operations.evidenceLinks.itemSpecifics).flat(),
    ),
    listingGate(
      "BRAND_IP_AND_CLAIMS_REVIEW_READY",
      brandIpClaimsReady,
      ["EXPLICIT_BRAND_IP_AND_CLAIMS_REVIEW_REQUIRED"],
      input.document.imageAnalysis.observations.map((entry) =>
        entry.evidenceId
      ),
    ),
    listingGate(
      "REAL_IMAGE_ORDER_READY",
      imageOrderReady,
      ["APPROVED_REAL_MAIN_IMAGE_AND_ORDER_REQUIRED"],
      orderedImageEntries.flatMap((entry) =>
        entry?.evidenceId ? [entry.evidenceId] : []
      ),
    ),
    listingGate(
      "PRICE_AND_QUANTITY_READY",
      priceQuantityReady,
      ["HUMAN_REVIEWED_LISTING_PRICE_AND_QUANTITY_REQUIRED"],
      [
        ...input.operations.evidenceLinks.listingPrice,
        ...input.operations.evidenceLinks.quantity,
      ],
    ),
    listingGate(
      "SHIPPING_RETURN_HANDLING_LOCATION_POLICIES_READY",
      policiesReady,
      [
        "SHIPPING_RETURN_PAYMENT_HANDLING_AND_ITEM_LOCATION_POLICIES_REQUIRED",
      ],
      [
        ...input.operations.evidenceLinks.policies,
        ...input.operations.evidenceLinks.itemLocation,
      ],
    ),
    listingGate(
      "EVIDENCE_ASSUMPTIONS_DIFFERENCES_READY",
      evidenceAndDecisionRecordReady,
      ["EVIDENCE_ASSUMPTIONS_BLOCKERS_DIFFERENCES_RECORD_REQUIRED"],
      input.operations.supportingEvidenceIds,
    ),
    listingGate(
      "EXPLICIT_HUMAN_HANDOFF_APPROVAL_READY",
      explicitHumanApprovalReady,
      ["EXPLICIT_HUMAN_HANDOFF_APPROVAL_REQUIRED"],
    ),
  ]
  const manualHandoffAllowed = !identityHold &&
    gates.every((gate) => gate.status === "PASS")
  const safeSpecificFields = new Set<ProductCaseEvidenceField>([
    "brand",
    "model",
    "mpn",
    "color",
    "material",
    "capacity",
    "dimensions",
    "product_dimensions",
    "package_dimensions",
    "weight",
    "contents",
    "inflation_mechanism",
    "accessories",
    "warnings",
    "included_quantity",
    "pack_quantity",
  ])
  const currency = acceptedText(input.document.evidence, "currency")
  const supplierPrices = accepted.flatMap((entry) => {
    if (!["supplier_price", "regular_price", "sale_price"].includes(
      entry.field,
    )) return []
    const value = effectiveEvidenceValue(entry)
    return typeof value === "number" && Number.isFinite(value)
      ? [{
          field: entry.field as
            "supplier_price" | "regular_price" | "sale_price",
          value,
          currency,
          evidenceId: entry.id,
        }]
      : []
  })
  const approvedImages = orderedImageEntries.flatMap((entry) =>
    entry &&
      entry.approvalStatus === "APPROVED" &&
      Object.values(entry.qa).every(Boolean)
      ? [{
          registryId: entry.registryId,
          evidenceId: entry.evidenceId,
          sourceUrl: entry.sourceUrl,
          sourceCaptureHash: entry.sourceCaptureHash,
          assetHash: entry.assetHash,
          approvalStatus: "APPROVED" as const,
          purpose: entry.purpose,
          role: entry.role,
          order: entry.order,
          reviewer: entry.reviewer,
          reviewedAt: entry.reviewedAt,
          variantId: entry.variantId,
          packQuantity: entry.packQuantity,
          qa: { ...entry.qa },
        }]
      : []
  )
  return {
    version: "PRODUCT_CASE_MANUAL_LISTING_PACKAGE_V1",
    productCaseId: input.document.caseId,
    supplierUrl: input.document.sourceUrl,
    osConclusion: input.adapter.osConclusion,
    humanConclusion: { ...input.document.humanReview.conclusion },
    decisionDifferences: shadowDifferences(
      input.adapter,
      input.document.humanReview.conclusion,
    ),
    packageStatus: identityHold
      ? "NOT_GENERATED_IDENTITY_HOLD"
      : manualHandoffAllowed
        ? "READY_FOR_HUMAN_SELLER_HUB_ENTRY"
        : "DRAFT_EVIDENCE_ONLY",
    generatedAt: input.generatedAt,
    acceptedEvidenceIds: acceptedIds,
    rejectedEvidenceIds: rejectedIds,
    identity: identityHold ? {
      title: null,
      brand: null,
      model: null,
      mpn: null,
      supplierProductId: null,
      supplierSku: null,
      variantId: null,
    } : {
      title: acceptedText(input.document.evidence, "title"),
      brand: acceptedText(input.document.evidence, "brand"),
      model: acceptedText(input.document.evidence, "model"),
      mpn: acceptedText(input.document.evidence, "mpn"),
      supplierProductId: acceptedText(
        input.document.evidence,
        "supplier_product_id",
      ),
      supplierSku: acceptedText(input.document.evidence, "supplier_sku"),
      variantId: acceptedText(input.document.evidence, "variant_id"),
    },
    packQuantity: identityHold ? null : acceptedNumber(
      input.document.evidence,
      "pack_quantity",
    ),
    supplierPrices: identityHold ? [] : supplierPrices,
    title: !identityHold && titleReady
      ? normalizeWhitespace(input.operations.title!)
      : null,
    category: {
      id: identityHold ? null : input.operations.categoryId,
      name: identityHold ? null : input.operations.categoryName,
    },
    condition: {
      id: identityHold ? null : input.operations.conditionId,
      description: identityHold ? null : input.operations.conditionDescription,
    },
    itemSpecifics: identityHold ? {} : Object.fromEntries(
      Object.entries(input.operations.itemSpecifics).map(([key, values]) => [
        key,
        values.map(normalizeWhitespace).filter(Boolean),
      ]),
    ),
    requiredItemSpecifics: identityHold
      ? []
      : [...input.operations.requiredItemSpecifics],
    description: identityHold || !descriptionReady
      ? null
      : input.operations.description,
    listingPrice: !identityHold && priceQuantityReady
      ? input.operations.listingPrice : null,
    quantity: !identityHold && priceQuantityReady
      ? input.operations.quantity : null,
    economics: {
      totalInvestment: identityHold ? null : input.operations.totalInvestment,
      estimatedProfit: identityHold ? null : input.operations.estimatedProfit,
      marginPercent: identityHold ? null : input.operations.marginPercent,
      roiPercent: identityHold ? null : input.operations.roiPercent,
    },
    policies: {
      fulfillmentPolicyId: input.operations.fulfillmentPolicyId,
      paymentPolicyId: input.operations.paymentPolicyId,
      returnPolicyId: input.operations.returnPolicyId,
      shippingPolicySummary: input.operations.shippingPolicySummary,
      returnPolicySummary: input.operations.returnPolicySummary,
      handlingTimeDays: input.operations.handlingTimeDays,
      itemLocation: { ...input.operations.itemLocation },
    },
    itemSpecificEvidence: accepted
      .filter((entry) => safeSpecificFields.has(entry.field))
      .map((entry) => ({
        field: entry.field,
        value: effectiveEvidenceValue(entry),
        evidenceId: entry.id,
      })),
    excludedClaims: accepted
      .filter((entry) =>
        ["description", "bullet", "marketing_claim"].includes(entry.field) &&
        entry.evidenceClass !== "PRODUCT_VERIFIED"
      )
      .map((entry) => ({
        evidenceId: entry.id,
        reason: "SUPPLIER_CLAIM_NOT_PRODUCT_VERIFIED",
      })),
    sourceImageUrls: approvedImages.map((entry) => entry.sourceUrl),
    approvedImages,
    imageEvidenceOrder: [...input.operations.imageEvidenceOrder],
    supportingEvidenceIds: [...input.operations.supportingEvidenceIds],
    evidenceLinks: structuredClone(input.operations.evidenceLinks),
    assumptions: [...input.operations.assumptions],
    blockers: unique([
      ...input.operations.blockers,
      ...input.adapter.blockers,
      ...gates.flatMap((gate) => gate.blockers),
    ]),
    differences: [...input.operations.differences],
    humanOverride: {
      ...input.operations.humanOverride,
      overriddenBlockers: [
        ...input.operations.humanOverride.overriddenBlockers,
      ],
    },
    gates,
    canPublishAutomatically: false,
    manualHandoffAllowed,
    handoffStatus: manualHandoffAllowed
      ? "READY_FOR_HUMAN_SELLER_HUB_ENTRY"
      : "BLOCKED_EVIDENCE_INCOMPLETE",
    safety: PRODUCT_CASE_ZERO_EFFECTS,
  }
}

export function buildPostPublicationRegistrationDraft(input: {
  document: ProductCaseDocument
  listingPackage: ProductCaseManualListingPackage
  candidateKey?: string | null
}): ProductCaseRegistrationDraft {
  return {
    version: "MANUAL_LISTING_REGISTRATION_DRAFT_V1",
    status: "MANUAL_LISTING_REGISTRATION_DRAFT",
    executionStatus: "DRAFT_NOT_SUBMITTED",
    canSubmit: false,
    productCaseId: input.document.caseId,
    listingPackageVersion: input.listingPackage.version,
    listingPackageStatus: input.listingPackage.packageStatus,
    postPublicationFields: {
      ebayItemId: null,
      listingUrl: null,
      marketplaceAccountKey: null,
      marketplace: null,
      ebaySku: null,
      productCaseReference: input.document.caseId,
      listingPackageId: null,
      listingPackageReference:
        `${input.document.caseId}:${input.listingPackage.version}`,
      lunaProductId: acceptedText(
        input.document.evidence,
        "supplier_product_id",
      ),
      lunaVariantId: acceptedText(
        input.document.evidence,
        "variant_id",
      ),
      variantFingerprint: null,
      packQuantity: input.listingPackage.packQuantity,
      supplierUnitCost: acceptedNumber(
        input.document.evidence,
        "supplier_unit_cost",
      ),
      publishedPrice: input.listingPackage.listingPrice,
      publishedQuantity: input.listingPackage.quantity,
      categoryId: input.listingPackage.category.id,
      conditionId: input.listingPackage.condition.id,
      shippingPolicyId:
        input.listingPackage.policies.fulfillmentPolicyId,
      returnPolicyId: input.listingPackage.policies.returnPolicyId,
      handlingTimeDays: input.listingPackage.policies.handlingTimeDays,
      publicationTimestamp: null,
    },
    existingRouteProjection: {
      targetRoute: "/api/admin/ebay/listings/register",
      payload: {
        ebayItemId: null,
        ebayUrl: null,
        opportunityId: null,
        candidateKey: input.candidateKey ?? null,
        supplierSku: null,
        supplierVariantId: null,
        safeDefaults: {},
      },
    },
    blockers: unique([
      "HUMAN_PUBLICATION_NOT_RECORDED",
      "EBAY_ITEM_ID_REQUIRED_AFTER_MANUAL_PUBLICATION",
      "CANONICAL_OPPORTUNITY_AND_LISTING_PACKAGE_REQUIRED",
      ...(input.listingPackage.manualHandoffAllowed
        ? []
        : ["MANUAL_LISTING_PACKAGE_NOT_READY"]),
    ]),
    reuseContract: "ManualListingRegistrationInput",
    existingRouteCompatibilityGap: [
      "CURRENT_ROUTE_REQUIRES_PERSISTED_OPPORTUNITY_OR_CANDIDATE",
      "CURRENT_ROUTE_REQUIRES_POST_PUBLICATION_EBAY_ITEM_ID",
      "CURRENT_ROUTE_WRITES_SUPABASE_AND_IS_NOT_CALLED_IN_PRODUCT_CASE_RUNNER_V1",
      "FULL_INSTRUMENTATION_FIELDS_ARE_NOT_ACCEPTED_BY_CURRENT_ROUTE_CONTRACT",
    ],
    safety: PRODUCT_CASE_ZERO_EFFECTS,
  }
}

export function buildProductCaseLearningObservation(input: {
  document: ProductCaseDocument
  adapter: ProductCaseStrategyAdapterResult
}): ProductCaseLearningObservation {
  const reasonCodes = unique([
    ...input.document.evidence.flatMap((entry) =>
      entry.humanReason ? [entry.humanReason] : []
    ),
    ...(input.document.humanReview.conclusion.reason
      ? [input.document.humanReview.conclusion.reason]
      : []),
  ]).map((reason) =>
    normalizeWhitespace(reason).toLocaleUpperCase("en-US")
      .replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")
      .slice(0, 120)
  ).filter(Boolean)
  return {
    osRecommendation: input.adapter.osConclusion,
    humanDecision: input.document.humanReview.conclusion,
    finalListingDecision: null,
    differences: shadowDifferences(
      input.adapter,
      input.document.humanReview.conclusion,
    ),
    humanReasonCodes: reasonCodes,
    evidenceAddedByHuman: input.document.evidence
      .filter((entry) =>
        entry.humanVerdict === "CORRECT" ||
        entry.sourceType === "HUMAN_VISUAL_OBSERVATION"
      )
      .map((entry) => entry.id),
    evidenceRejectedByHuman: input.document.evidence
      .filter((entry) => entry.humanVerdict === "REJECT")
      .map((entry) => entry.id),
    ruleCandidate: input.document.humanReview.proposedRuleObservation,
    ruleCandidateStatus: "OBSERVATION_ONLY",
    listingOutcomeStatus: "NOT_YET_MEASURED",
    engineRuleChanged: false,
    learningStatus: "HUMAN_REVIEW_DRAFT",
  }
}

export function buildFutureMeasurementStages():
  ProductCaseFutureMeasurementStage[] {
  const unavailableMetric = (): ProductCaseUnavailableMetric => ({
    value: null,
    status: "MISSING / UNAVAILABLE",
    source: null,
    observedAt: null,
  })
  return ([
    "DAY_0_LISTING_SNAPSHOT",
    "DAY_7_PERFORMANCE_REVIEW",
    "DAY_14_PERFORMANCE_REVIEW",
    "DAY_30_PERFORMANCE_REVIEW",
  ] as const)
    .map((stage) => ({
      stage,
      status: "BLOCKED",
      measurementStatus: "NOT_YET_MEASURED",
      reason: "MANUAL_LISTING_NOT_PUBLISHED_AND_REGISTERED",
      metrics: {
        impressions: unavailableMetric(),
        pageViews: unavailableMetric(),
        clicks: unavailableMetric(),
        ctr: unavailableMetric(),
        watchers: unavailableMetric(),
        quantitySold: unavailableMetric(),
        conversion: unavailableMetric(),
        promotedListingCost: unavailableMetric(),
        sellingFees: unavailableMetric(),
        realShipping: unavailableMetric(),
        refunds: unavailableMetric(),
        netProfit: unavailableMetric(),
      },
    }))
}

function confidenceFromCounts(
  accepted: number,
  missing: number,
  conflicts: number,
): "LOW" | "MEDIUM" | "HIGH" {
  if (conflicts > 0 || missing > 0 || accepted === 0) return "LOW"
  return accepted >= 5 ? "HIGH" : "MEDIUM"
}

export function buildProductCasePhaseSnapshots(input: {
  document: ProductCaseDocument
  adapter: ProductCaseStrategyAdapterResult
  imageRegistry: ProductCaseImageRegistry
  listingPackage: ProductCaseManualListingPackage
  registrationDraft: ProductCaseRegistrationDraft
  learningObservation: ProductCaseLearningObservation
}): ProductCasePhaseSnapshot[] {
  const accepted = acceptedProductCaseEvidence(input.document.evidence)
  const rejected = input.document.evidence.filter((entry) =>
    entry.humanVerdict === "REJECT"
  )
  const conflicts = conflictsForEvidence(input.document.evidence)
  const openConflicts = conflicts.filter((entry) => entry.status === "OPEN")
  const missing = PRODUCT_CASE_EVIDENCE_FIELDS.filter((field) =>
    !accepted.some((entry) => entry.field === field)
  )
  const shared = {
    acceptedEvidenceIds: accepted.map((entry) => entry.id),
    rejectedEvidenceIds: rejected.map((entry) => entry.id),
    conflicts,
    missingFields: missing,
    confidence: confidenceFromCounts(
      accepted.length,
      missing.length,
      openConflicts.length,
    ),
  } as const
  const sourceNext = input.document.sourceAccess.status ===
    "AUTHENTICATED_SOURCE_REQUIRED"
    ? "CAPTURE_AUTHENTICATED_SUPPLIER_EVIDENCE"
    : "PASTE_OR_REVIEW_SUPPLIER_EVIDENCE"
  const manualAuthenticatedSourceCaptured = Boolean(
    input.document.supplierSourceCapture &&
    input.document.supplierSourceCapture.sourceCaptureMethod ===
      "MANUAL_AUTHENTICATED_PASTE",
  )
  const phaseData: Array<Omit<ProductCasePhaseSnapshot,
    "index" | "name">> = [
    {
      ...shared,
      status: input.document.sourceAccess.status === "NOT_RUN"
        ? "NOT_RUN" : input.document.sourceAccess.status === "REJECTED"
          ? "BLOCKED"
          : input.document.sourceAccess.status ===
              "AUTHENTICATED_SOURCE_REQUIRED" &&
              !manualAuthenticatedSourceCaptured
            ? "BLOCKED"
            : "COMPLETE",
      input: { sourceUrl: input.document.sourceUrl },
      output: {
        sourceAccess: input.document.sourceAccess,
        supplierSourceCapture: input.document.supplierSourceCapture
          ? {
              sourceCaptureMethod:
                input.document.supplierSourceCapture.sourceCaptureMethod,
              contentHash: input.document.supplierSourceCapture.contentHash,
              parserVersion:
                input.document.supplierSourceCapture.parserVersion,
              sourceContractVersion:
                input.document.supplierSourceCapture.sourceContractVersion,
              parseHealth:
                input.document.supplierSourceCapture.parseHealth,
              stockState:
                input.document.supplierSourceCapture.stockState,
              evidenceCandidateCount:
                input.document.supplierSourceCapture.evidenceCandidates.length,
              missingFieldCount:
                input.document.supplierSourceCapture.missingFields.length,
            }
          : null,
      },
      blockers: input.document.sourceAccess.status ===
          "AUTHENTICATED_SOURCE_REQUIRED" &&
          !manualAuthenticatedSourceCaptured
        ? ["AUTHENTICATED_SOURCE_REQUIRED"]
        : [],
      appliedRules: [
        "HTTPS_LUNA_PRODUCT_URL_ONLY",
        "AUTHENTICATION_IS_NEVER_BYPASSED",
      ],
      nextAction: manualAuthenticatedSourceCaptured
        ? "REVIEW_PRODUCT_EVIDENCE"
        : sourceNext,
    },
    {
      ...shared,
      status: input.document.captures.length ? "COMPLETE" : "BLOCKED",
      input: {
        captures: input.document.captures.map((capture) => ({
          contentHash: capture.contentHash,
          byteLength: capture.byteLength,
          format: capture.format,
          parserVersion: capture.parserVersion,
          sourceContractVersion: capture.sourceContractVersion,
          parseHealth: capture.parseHealth,
          stockState: capture.stockState,
        })),
      },
      output: { proposedEvidenceCount: input.document.evidence.length },
      blockers: input.document.captures.length
        ? [] : ["RAW_SUPPLIER_CAPTURE_REQUIRED"],
      appliedRules: [
        "HTML_IS_TREATED_AS_TEXT",
        "SCRIPTS_AND_RESOURCES_ARE_NEVER_EXECUTED",
      ],
      nextAction: input.document.captures.length
        ? "REVIEW_IDENTITY_AND_VARIANTS"
        : sourceNext,
    },
    {
      ...shared,
      status: accepted.some((entry) =>
        ["title", "variant_id"].includes(entry.field)
      ) ? "IN_REVIEW" : "BLOCKED",
      input: {
        identityEvidence: input.document.evidence.filter((entry) =>
          evidencePurpose(entry.field).includes("IDENTITY")
        ).map((entry) => entry.id),
      },
      output: {
        acceptedIdentity: accepted.filter((entry) =>
          evidencePurpose(entry.field).includes("IDENTITY")
        ).map((entry) => entry.id),
      },
      blockers: input.adapter.blockers.filter((entry) =>
        /IDENTITY|VARIANT|PACK/.test(entry)
      ),
      appliedRules: [
        "VARIANTS_REMAIN_SEPARATE",
        "SUPPLIER_DATA_IS_NOT_PRODUCT_VERIFIED",
      ],
      nextAction: "REVIEW_IDENTITY_AND_VARIANT_EVIDENCE",
    },
    {
      ...shared,
      status: input.document.evidence.some((entry) =>
        entry.humanVerdict === "UNREVIEWED"
      ) ? "IN_REVIEW" : "COMPLETE",
      input: { evidenceCount: input.document.evidence.length },
      output: {
        classes: Object.fromEntries(input.document.evidence.map((entry) =>
          [entry.id, entry.evidenceClass]
        )),
      },
      blockers: [],
      appliedRules: [
        "LUNA_STARTS_AS_SUPPLIER_STATED",
        "TOP_SELLER_IS_ONLY_A_MERCHANDISING_SIGNAL",
      ],
      nextAction: "ACCEPT_REJECT_CORRECT_OR_REQUEST_EVIDENCE",
    },
    {
      ...shared,
      status: openConflicts.length ? "BLOCKED"
        : missing.length ? "IN_REVIEW" : "COMPLETE",
      input: { conflictCount: conflicts.length },
      output: { openConflicts, missingFields: missing },
      blockers: [
        ...openConflicts.map((entry) =>
          `OPEN_CONFLICT:${entry.conflictKey}`
        ),
        ...missing.map((field) => `MISSING:${field}`),
      ],
      appliedRules: [
        "CONTRADICTIONS_ARE_NEVER_RESOLVED_SILENTLY",
        "MISSING_IS_NEVER_ZERO",
      ],
      nextAction: openConflicts.length
        ? "HUMAN_RESOLVE_CONFLICTS"
        : "CAPTURE_MISSING_EVIDENCE",
    },
    {
      ...shared,
      status: input.adapter.status === "READY" ? "COMPLETE" : "BLOCKED",
      input: { acceptedEvidenceIds: accepted.map((entry) => entry.id) },
      output: {
        usableEvidenceInputs: input.adapter.acceptedEvidenceInputs.length,
      },
      blockers: input.adapter.blockers,
      appliedRules: [
        "ONLY_HUMAN_ACCEPTED_EVIDENCE_CAN_ADVANCE",
        "HUMAN_CORRECTIONS_REMAIN_HYPOTHESES",
      ],
      nextAction: input.adapter.nextAction,
    },
    {
      ...shared,
      status: input.adapter.status === "READY" ? "COMPLETE" : "BLOCKED",
      input: { acceptedRunnerEvidenceIds: input.adapter.acceptedRunnerEvidenceIds },
      output: {
        adapterStatus: input.adapter.status,
        strategyLabInput: input.adapter.strategyLabInput,
        marketEvidence: input.adapter.marketEvidence,
      },
      blockers: input.adapter.blockers,
      appliedRules: [
        "ADAPTER_FAILS_CLOSED",
        "SUPPLIER_PRICE_IS_NOT_MARKET_PRICE",
      ],
      nextAction: input.adapter.nextAction,
    },
    {
      ...shared,
      status: input.adapter.status === "READY" ? "IN_REVIEW" : "BLOCKED",
      input: { adapterStatus: input.adapter.status },
      output: {
        osConclusion: input.adapter.osConclusion,
        currentEvidenceLeader: input.adapter.currentEvidenceLeader,
        strategicHypothesisToValidate:
          input.adapter.strategicHypothesisToValidate,
      },
      blockers: input.adapter.blockers,
      appliedRules: [
        "HOLD_DOES_NOT_MEAN_PREFERRED",
        "CURRENT_EVIDENCE_LEADER_IS_NOT_EXECUTION_APPROVAL",
      ],
      nextAction: input.adapter.nextAction,
    },
    {
      ...shared,
      status: input.document.humanReview.conclusion.reviewedAt
        ? "COMPLETE" : "IN_REVIEW",
      input: { osConclusion: input.adapter.osConclusion },
      output: {
        humanConclusion: input.document.humanReview.conclusion,
        proposedRuleObservation:
          input.document.humanReview.proposedRuleObservation,
      },
      blockers: input.document.humanReview.conclusion.reviewedAt
        ? [] : ["HUMAN_CONCLUSION_REQUIRED"],
      appliedRules: [
        "OS_RUNS_BEFORE_HUMAN_COMPARISON",
        "OBSERVATION_IS_NOT_LEARNING",
      ],
      nextAction: "RECORD_HUMAN_CONCLUSION",
    },
    {
      ...shared,
      status: input.imageRegistry.status === "APPROVED"
        ? "COMPLETE" : "BLOCKED",
      input: {
        sourceImageEvidenceIds: fieldEvidenceIds(
          input.document.evidence,
          "source_image_url",
        ),
      },
      output: { imageRegistry: input.imageRegistry },
      blockers: input.imageRegistry.approvedMainRegistryId
        ? input.imageRegistry.blockers
        : unique([
            "APPROVED_REAL_MAIN_IMAGE_REFERENCE_AND_ASSET_HASH_REQUIRED",
            ...input.imageRegistry.blockers,
          ]),
      appliedRules: [
        "IMAGE_URLS_ARE_REFERENCES_ONLY",
        "NO_IMAGE_DOWNLOAD_TRANSFORM_OR_GENERATION",
      ],
      nextAction: "ATTACH_AND_REVIEW_REAL_MAIN_IMAGE_REFERENCE",
    },
    {
      ...shared,
      status: input.listingPackage.manualHandoffAllowed
        ? "COMPLETE" : "BLOCKED",
      input: {
        acceptedEvidenceIds: input.listingPackage.acceptedEvidenceIds,
      },
      output: {
        packageStatus: input.listingPackage.packageStatus,
        gates: input.listingPackage.gates,
      },
      blockers: input.listingPackage.gates.flatMap((gate) => gate.blockers),
      appliedRules: [
        "FIFTEEN_GATES_FAIL_CLOSED",
        "CAN_PUBLISH_AUTOMATICALLY_IS_ALWAYS_FALSE",
      ],
      nextAction: input.listingPackage.manualHandoffAllowed
        ? "HUMAN_SELLER_HUB_ENTRY_ONLY"
        : "COMPLETE_LISTING_HANDOFF_GATES",
    },
    {
      ...shared,
      status: "BLOCKED",
      input: { handoffStatus: input.listingPackage.handoffStatus },
      output: { registrationDraft: input.registrationDraft },
      blockers: input.registrationDraft.blockers,
      appliedRules: [
        "REGISTRATION_IS_DRAFT_ONLY",
        "NO_SUPABASE_OR_EBAY_WRITE",
      ],
      nextAction: "WAIT_FOR_FUTURE_MANUAL_PUBLICATION_AND_AUTHORIZATION",
    },
    {
      ...shared,
      status: "NOT_RUN",
      input: {
        humanObservation:
          input.document.humanReview.proposedRuleObservation,
      },
      output: { learningObservation: input.learningObservation },
      blockers: ["RESULT_NOT_YET_MEASURED"],
      appliedRules: [
        "OBSERVATION_ONLY",
        "ENGINE_RULES_CANNOT_CHANGE",
      ],
      nextAction: "WAIT_FOR_MANUALLY_REGISTERED_OUTCOMES",
    },
  ]
  return PRODUCT_CASE_PHASES.map((phase, index) => ({
    index: phase.index,
    name: phase.name,
    ...phaseData[index],
  }))
}

function fieldEvidenceIds(
  evidence: ProductCaseEvidence[],
  field: ProductCaseEvidenceField,
) {
  return evidence.filter((entry) => entry.field === field)
    .map((entry) => entry.id)
}

function shadowDifferences(
  adapter: ProductCaseStrategyAdapterResult,
  human: ProductCaseHumanConclusion,
) {
  const checks = [
    ["conclusion", adapter.osConclusion, human.conclusion],
    [
      "scenario",
      adapter.currentEvidenceLeader?.offerScenario ?? null,
      human.scenario,
    ],
  ] as const
  return checks.flatMap(([field, osValue, humanValue]) =>
    stableValue(osValue) === stableValue(humanValue)
      ? []
      : [{ field, osValue, humanValue }]
  )
}

function evaluateAdapterStrategy(
  adapter: ProductCaseStrategyAdapterResult,
) {
  if (!adapter.strategyLabInput) return null
  try {
    return evaluateStrategyLabCase(adapter.strategyLabInput)
  } catch {
    return null
  }
}

export function buildProductCaseOperationalPipeline(input: {
  document: ProductCaseDocument
  adapter: ProductCaseStrategyAdapterResult
  imageRegistry: ProductCaseImageRegistry
  listingPackage: ProductCaseManualListingPackage
}): ProductCaseOperationalPhaseSnapshot[] {
  const accepted = acceptedProductCaseEvidence(input.document.evidence)
  const authenticatedCapture = input.document.captures.some((capture) =>
    capture.sourceType === "LUNA_AUTHENTICATED_MANUAL_CAPTURE"
  )
  const localSupplierCaptureValid =
    Boolean(input.document.supplierSourceCapture) &&
    validateProductCaseSupplierSourceCapture(input.document).valid
  const supplierResolved = input.document.sourceAccess.status ===
      "PUBLIC_ACCESSIBLE" ||
    (authenticatedCapture && localSupplierCaptureValid)
  const visualConflict = hasStructuredIdentityConflict(input.document)
  const identityReady = identityReviewReady(input.document) &&
    ["title", "supplier_product_id", "variant_id"].every((field) =>
      accepted.some((entry) => entry.field === field)
    )
  const marketReady = input.document.marketEvidence.runStatus === "COMPLETE" &&
    input.document.marketEvidence.soldExact === "AVAILABLE" &&
    input.document.marketEvidence.marketCeiling === "AVAILABLE"
  const evaluation = evaluateAdapterStrategy(input.adapter)
  const assessment = evaluation?.scenarioAssessments[0] ?? null
  const economicsReady = input.adapter.status === "READY" &&
    assessment?.economics.status === "VIABLE"
  const strategyReady = Boolean(
    evaluation &&
    ![
      "HOLD_IDENTITY",
      "HOLD_COMPATIBILITY",
      "HOLD_ECONOMICS",
      "HOLD_EVIDENCE_INCOMPLETE",
      "NO_GO",
    ].includes(evaluation.recommendation.releaseGate),
  )
  const humanReviewed = Boolean(
    input.document.humanReview.conclusion.reviewedAt &&
    validIsoInstant(input.document.humanReview.conclusion.reviewedAt) &&
    normalizeWhitespace(
      input.document.humanReview.conclusion.reviewer ?? "",
    ) &&
    normalizeWhitespace(
      input.document.humanReview.conclusion.reason ?? "",
    ),
  )
  const commercialQaReady = input.imageRegistry.status === "APPROVED" &&
    input.document.imageAnalysis.visualEvidenceStatus === "HUMAN_REVIEWED"
  const rejectedEvidence = input.document.evidence.filter((entry) =>
    entry.humanVerdict === "REJECT"
  )
  const operationalConflicts = conflictsForEvidence(input.document.evidence)
  const operationalMissing = PRODUCT_CASE_EVIDENCE_FIELDS.filter((field) =>
    !accepted.some((entry) => entry.field === field)
  )
  const operationalConfidence = confidenceFromCounts(
    accepted.length,
    operationalMissing.length,
    operationalConflicts.filter((entry) => entry.status === "OPEN").length,
  )
  const natural: Array<Omit<
    ProductCaseOperationalPhaseSnapshot,
    | "input"
    | "output"
    | "acceptedEvidenceIds"
    | "rejectedEvidenceIds"
    | "conflicts"
    | "missingFields"
    | "confidence"
    | "appliedRules"
    | "publicationStatus"
    | "handoffArtifactGenerated"
  >> = [
    {
      phase: "SUPPLIER_SOURCE",
      status: supplierResolved ? "COMPLETED" : "BLOCKED",
      blockers: supplierResolved ? [] : ["SUPPLIER_SOURCE_NOT_RESOLVED"],
      nextAction: supplierResolved
        ? "REVIEW_PRODUCT_EVIDENCE"
        : "CAPTURE_AUTHENTICATED_SUPPLIER_EVIDENCE",
    },
    {
      phase: "PRODUCT_EVIDENCE",
      status: accepted.length ? "COMPLETED" : "HUMAN_REVIEW_REQUIRED",
      blockers: accepted.length ? [] : ["HUMAN_EVIDENCE_ACCEPTANCE_REQUIRED"],
      nextAction: "REVIEW_HUMAN_VISUAL_EVIDENCE",
    },
    {
      phase: "HUMAN_VISUAL_REVIEW",
      status: input.document.imageAnalysis.visualEvidenceStatus ===
          "NOT_REVIEWED"
        ? "HUMAN_REVIEW_REQUIRED"
        : visualConflict
          ? "HUMAN_REVIEW_REQUIRED"
          : "COMPLETED",
      blockers: visualConflict
        ? ["PHYSICAL_PRODUCT_AND_VARIANT_VERIFICATION_REQUIRED"]
        : input.document.imageAnalysis.visualEvidenceStatus === "NOT_REVIEWED"
          ? ["STRUCTURED_HUMAN_VISUAL_REVIEW_REQUIRED"]
          : [],
      nextAction: visualConflict
        ? "VERIFY_PHYSICAL_PRODUCT_AND_VARIANT"
        : "REVIEW_IDENTITY_AND_VARIANTS",
    },
    {
      phase: "IDENTITY_AND_VARIANTS",
      status: identityReady
        ? "COMPLETED"
        : input.document.identityReview.status === "PARTIAL"
          ? "HUMAN_REVIEW_REQUIRED"
          : "BLOCKED",
      blockers: identityReady
        ? []
        : unique(input.document.identityReview.blockers),
      nextAction: identityReady
        ? "REVIEW_MARKET_EVIDENCE"
        : input.document.identityReview.nextAction,
    },
    {
      phase: "MARKET_EVIDENCE",
      status: marketReady ? "COMPLETED" : "BLOCKED",
      blockers: marketReady ? [] : ["SOLD_EXACT_COHORT_MISSING"],
      nextAction: marketReady
        ? "CALCULATE_SCENARIO_ECONOMICS"
        : "VALIDATE_EXACT_MARKET_COHORT",
    },
    {
      phase: "SCENARIO_ECONOMICS",
      status: economicsReady ? "COMPLETED" : "BLOCKED",
      blockers: economicsReady
        ? []
        : assessment?.economics.blockers ?? input.adapter.blockers,
      nextAction: economicsReady
        ? "REVIEW_STRATEGY_RECOMMENDATION"
        : "COMPLETE_EVIDENCE_BACKED_ECONOMICS",
    },
    {
      phase: "STRATEGY_RECOMMENDATION",
      status: strategyReady ? "COMPLETED" : "BLOCKED",
      blockers: strategyReady
        ? []
        : evaluation?.recommendation.blockers ?? input.adapter.blockers,
      nextAction: strategyReady
        ? "RECORD_HUMAN_SHADOW_REVIEW"
        : input.adapter.nextAction,
    },
    {
      phase: "HUMAN_SHADOW_REVIEW",
      status: humanReviewed ? "COMPLETED" : "HUMAN_REVIEW_REQUIRED",
      blockers: humanReviewed ? [] : ["HUMAN_CONCLUSION_REQUIRED"],
      nextAction: humanReviewed
        ? "COMPLETE_IMAGE_AND_COMMERCIAL_QA"
        : "RECORD_HUMAN_CONCLUSION",
    },
    {
      phase: "IMAGE_AND_COMMERCIAL_QA",
      status: commercialQaReady ? "COMPLETED" : "HUMAN_REVIEW_REQUIRED",
      blockers: commercialQaReady ? [] : input.imageRegistry.blockers,
      nextAction: commercialQaReady
        ? "BUILD_MANUAL_LISTING_PACKAGE"
        : "COMPLETE_HUMAN_IMAGE_AND_COMMERCIAL_QA",
    },
    {
      phase: "MANUAL_LISTING_PACKAGE",
      status: input.listingPackage.packageStatus ===
          "READY_FOR_HUMAN_SELLER_HUB_ENTRY"
        ? "COMPLETED"
        : "BLOCKED",
      blockers: input.listingPackage.manualHandoffAllowed
        ? []
        : input.listingPackage.blockers,
      nextAction: input.listingPackage.manualHandoffAllowed
        ? "REQUEST_MANUAL_EBAY_HANDOFF"
        : "COMPLETE_MANUAL_LISTING_GATES",
    },
    {
      phase: "MANUAL_EBAY_HANDOFF",
      status: input.listingPackage.manualHandoffAllowed
        ? "COMPLETED"
        : "BLOCKED",
      blockers: input.listingPackage.manualHandoffAllowed
        ? []
        : ["MANUAL_LISTING_PACKAGE_NOT_READY"],
      nextAction: input.listingPackage.manualHandoffAllowed
        ? "HUMAN_MAY_ENTER_PACKAGE_IN_SELLER_HUB"
        : "COMPLETE_MANUAL_LISTING_PACKAGE",
    },
    {
      phase: "MANUAL_LISTING_REGISTRATION",
      status: "BLOCKED",
      blockers: ["MANUAL_LISTING_REGISTRATION_BLOCKED_UNTIL_ITEM_ID_EXISTS"],
      nextAction:
        "Después de publicar manualmente, registra el Item ID para iniciar el enlace y monitoreo read-only.",
    },
  ]
  let upstreamStopped = false
  return natural.map((phase) => {
    const output = upstreamStopped && phase.status === "COMPLETED"
      ? {
          ...phase,
          status: "BLOCKED" as const,
          blockers: unique([
            "UPSTREAM_PHASE_NOT_COMPLETED",
            ...phase.blockers,
          ]),
        }
      : phase
    if (output.status === "BLOCKED" ||
      output.status === "HUMAN_REVIEW_REQUIRED") {
      upstreamStopped = true
    }
    return {
      ...output,
      input: {
        productCaseId: input.document.caseId,
        phase: output.phase,
      },
      output: output.phase === "SUPPLIER_SOURCE"
        ? {
            sourceAccess: input.document.sourceAccess,
            sourceCaptureMethod:
              input.document.supplierSourceCapture?.sourceCaptureMethod ??
                null,
            evidenceCandidateCount:
              input.document.supplierSourceCapture?.evidenceCandidates.length ??
                0,
          }
        : output.phase === "PRODUCT_EVIDENCE"
          ? { acceptedEvidenceCount: accepted.length }
          : output.phase === "HUMAN_VISUAL_REVIEW"
            ? { imageAnalysis: input.document.imageAnalysis }
            : output.phase === "IDENTITY_AND_VARIANTS"
              ? { identityReview: input.document.identityReview }
              : output.phase === "MARKET_EVIDENCE"
                ? { marketEvidence: input.document.marketEvidence }
                : output.phase === "SCENARIO_ECONOMICS"
                  ? { economics: assessment?.economics ?? null }
                  : output.phase === "STRATEGY_RECOMMENDATION"
                    ? {
                        osConclusion: input.adapter.osConclusion,
                        nextAction: input.adapter.nextAction,
                      }
                    : output.phase === "HUMAN_SHADOW_REVIEW"
                      ? {
                          humanConclusion:
                            input.document.humanReview.conclusion,
                          differences: shadowDifferences(
                            input.adapter,
                            input.document.humanReview.conclusion,
                          ),
                        }
                      : output.phase === "IMAGE_AND_COMMERCIAL_QA"
                        ? { imageRegistry: input.imageRegistry }
                        : output.phase === "MANUAL_LISTING_PACKAGE"
                          ? {
                              packageStatus:
                                input.listingPackage.packageStatus,
                              gates: input.listingPackage.gates,
                            }
                          : output.phase === "MANUAL_EBAY_HANDOFF"
                            ? {
                                handoffArtifactGenerated:
                                  input.listingPackage.manualHandoffAllowed,
                              }
                            : {
                                publicationStatus: "NOT_PUBLISHED",
                                ebayItemId: null,
                              },
      acceptedEvidenceIds: accepted.map((entry) => entry.id),
      rejectedEvidenceIds: rejectedEvidence.map((entry) => entry.id),
      conflicts: operationalConflicts,
      missingFields: operationalMissing,
      confidence: operationalConfidence,
      appliedRules: [
        `PHASE_RULE:${output.phase}`,
        "FAIL_CLOSED",
        "NO_AUTOMATIC_EXTERNAL_ACTIONS",
      ],
      publicationStatus: "NOT_PUBLISHED" as const,
      handoffArtifactGenerated:
        output.phase === "MANUAL_EBAY_HANDOFF" &&
        input.listingPackage.manualHandoffAllowed,
    }
  })
}

export function calculateProductCaseReadiness(input: {
  document: ProductCaseDocument
  adapter: ProductCaseStrategyAdapterResult
}): ProductCaseRunnerOutput["readiness"] {
  const identityConflict = input.document.identityReview.status ===
    "CONFLICTED"
  const present = input.document.evidence.filter((entry) =>
    nonempty(entry.normalizedValue) &&
    !["MISSING", "CONFLICTED"].includes(entry.evidenceClass)
  )
  const accepted = acceptedProductCaseEvidence(input.document.evidence)
  const identityReady = identityReviewReady(input.document) &&
    ["title", "supplier_product_id", "variant_id"]
    .every((field) => accepted.some((entry) =>
      entry.field === field &&
      ["SUPPLIER_STATED", "PRODUCT_VERIFIED"].includes(entry.evidenceClass)
    ))
  const productIdentity = identityConflict
    ? "CONFLICTED" as const
    : identityReady
    ? "READY" as const
    : present.some((entry) => [
        "title",
        "brand",
        "model",
        "mpn",
        "supplier_product_id",
        "supplier_sku",
        "variant_id",
      ].includes(entry.field))
      ? "PARTIAL" as const
      : "MISSING" as const
  const authenticatedCapture = input.document.captures.some((capture) =>
    capture.sourceType === "LUNA_AUTHENTICATED_MANUAL_CAPTURE"
  )
  const supplierReady = authenticatedCapture &&
    ["supplier_unit_cost", "visible_stock", "pack_quantity"].every((field) =>
      accepted.some((entry) => entry.field === field)
    )
  const supplierEvidence = supplierReady
    ? "READY" as const
    : present.some((entry) =>
        entry.sourceType === "LUNA_PUBLIC_PREFLIGHT" ||
        entry.sourceType === "LUNA_AUTHENTICATED_MANUAL_CAPTURE" ||
        entry.sourceType === "LUNA_MANUAL_CAPTURE"
      )
      ? "PARTIAL" as const
      : "MISSING" as const
  const marketEvidence = input.document.marketEvidence.runStatus === "COMPLETE"
    ? "READY" as const
    : input.document.marketEvidence.runStatus === "INSUFFICIENT"
      ? "INSUFFICIENT" as const
    : input.document.marketEvidence.runStatus === "NOT_VALIDATED"
      ? "NOT_VALIDATED" as const
      : "NOT_RUN" as const
  return {
    productIdentity,
    identityConfidence: identityConflict
      ? "LOW"
      : productIdentity === "READY"
        ? input.document.identityReview.confidence
        : productIdentity === "PARTIAL"
          ? input.document.identityReview.humanReview ||
              input.document.identityReview.status === "PARTIAL" ||
              input.document.identityReview.status === "READY"
            ? input.document.identityReview.confidence
            : "MEDIUM"
          : "LOW",
    productFactsReadiness: identityConflict || productIdentity !== "READY"
      ? "NOT_READY"
      : "READY",
    supplierEvidence,
    marketEvidence,
    economics: input.adapter.status === "READY"
      ? "READY"
      : "MISSING_INPUT",
    strategy: input.adapter.osConclusion,
  }
}

export function buildProductCaseRunnerOutput(input: {
  document: ProductCaseDocument
  adapter: ProductCaseStrategyAdapterResult
  imageApprovals?: ProductCaseImageApproval[]
  listingOperations: ProductCaseListingOperations
  generatedAt: string
}): ProductCaseRunnerOutput {
  const imageRegistry = buildProductCaseImageRegistry({
    document: input.document,
    approvals: input.imageApprovals,
  })
  const listingPackage = buildManualListingPackageDraft({
    document: input.document,
    adapter: input.adapter,
    imageRegistry,
    operations: input.listingOperations,
    generatedAt: input.generatedAt,
  })
  const registrationDraft = buildPostPublicationRegistrationDraft({
    document: input.document,
    listingPackage,
    candidateKey: input.listingOperations.candidateKey,
  })
  const learningObservation = buildProductCaseLearningObservation({
    document: input.document,
    adapter: input.adapter,
  })
  const phases = buildProductCasePhaseSnapshots({
    document: input.document,
    adapter: input.adapter,
    imageRegistry,
    listingPackage,
    registrationDraft,
    learningObservation,
  })
  const operationalPipeline = buildProductCaseOperationalPipeline({
    document: input.document,
    adapter: input.adapter,
    imageRegistry,
    listingPackage,
  })
  const readiness = calculateProductCaseReadiness({
    document: input.document,
    adapter: input.adapter,
  })
  const listingPackageSuppressed =
    listingPackage.packageStatus === "NOT_GENERATED_IDENTITY_HOLD"
  return {
    version: PRODUCT_CASE_RUNNER_VERSION,
    document: input.document,
    adapter: input.adapter,
    imageRegistry,
    listingPackage: listingPackageSuppressed ? null : listingPackage,
    listingPackageStatus: listingPackage.packageStatus,
    registrationDraft,
    learningObservation,
    futureMeasurementStages: buildFutureMeasurementStages(),
    legacyPhaseDiagnostics: phases,
    operationalPipeline,
    readiness,
    canPublishAutomatically: false,
    publicationStatus: "NOT_PUBLISHED",
    handoffArtifactGenerated: listingPackage.manualHandoffAllowed,
    manualHandoffAllowed: listingPackage.manualHandoffAllowed,
    shadowMode: {
      osConclusion: input.adapter.osConclusion,
      humanConclusion: input.document.humanReview.conclusion,
      differences: shadowDifferences(
        input.adapter,
        input.document.humanReview.conclusion,
      ),
      proposedRuleObservation:
        input.document.humanReview.proposedRuleObservation,
      learningStatus: "HUMAN_REVIEW_DRAFT",
      canChangeEngineRules: false,
      canLinkListing: false,
    },
    safety: PRODUCT_CASE_ZERO_EFFECTS,
  }
}

export const PRODUCT_CASE_LEGACY_WORKSPACE_EXPORT_VERSION =
  "PRODUCT_CASE_WORKSPACE_EXPORT_V1" as const
export const PRODUCT_CASE_WORKSPACE_EXPORT_VERSION =
  "PRODUCT_CASE_WORKSPACE_EXPORT_V2" as const
export const PRODUCT_CASE_PRE_IDENTITY_OUTPUT_CONTRACT_VERSION =
  "PRODUCT_CASE_OUTPUT_CONTRACT_V1" as const
export const PRODUCT_CASE_OUTPUT_CONTRACT_VERSION =
  "PRODUCT_CASE_OUTPUT_CONTRACT_V2" as const
export const PRODUCT_CASE_PRE_IDENTITY_OUTPUT_WARNING =
  "PRE_IDENTITY_CONTRACT_OUTPUT_REBUILT_WITH_CURRENT_DOMAIN" as const
export const PRODUCT_CASE_LEGACY_OUTPUT_PROFILE =
  "PRE_PERSISTENT_HUMAN_VISUAL_CONTRACT_GATE_V1" as const
export const PRODUCT_CASE_LEGACY_OUTPUT_WARNING =
  "LEGACY_OUTPUT_REBUILT_WITH_CURRENT_DOMAIN" as const
export const PRODUCT_CASE_WORKSPACE_EXPORT_MAX_BYTES = 1_048_576

export type ProductCaseImportFileMetadata = {
  name: string
  size: number
  type: string
}

export function validateProductCaseImportFileMetadata(
  file: ProductCaseImportFileMetadata,
) {
  if (!file.name.trim()) {
    return "PRODUCT_CASE_IMPORT_FILE_NAME_REQUIRED"
  }
  if (
    file.type &&
    file.type !== "application/json" &&
    file.type !== "text/json" &&
    file.type !== "text/plain"
  ) {
    return "PRODUCT_CASE_IMPORT_CONTENT_TYPE_INVALID"
  }
  if (file.size > PRODUCT_CASE_WORKSPACE_EXPORT_MAX_BYTES) {
    return "PRODUCT_CASE_IMPORT_SIZE_LIMIT_EXCEEDED"
  }
  if (file.size === 0) {
    return "PRODUCT_CASE_IMPORT_FILE_EMPTY"
  }
  return null
}

export function validateProductCaseImportJsonCandidate(serialized: string) {
  if (typeof serialized !== "string" || !serialized.trim()) {
    return "PRODUCT_CASE_IMPORT_REQUIRED"
  }
  if (utf8Length(serialized) > PRODUCT_CASE_WORKSPACE_EXPORT_MAX_BYTES) {
    return "PRODUCT_CASE_IMPORT_SIZE_LIMIT_EXCEEDED"
  }
  try {
    JSON.parse(serialized)
  } catch {
    return "PRODUCT_CASE_IMPORT_JSON_INVALID"
  }
  return null
}

export type ProductCaseLegacyImportAudit = {
  warning: typeof PRODUCT_CASE_LEGACY_OUTPUT_WARNING
  legacyProfile: typeof PRODUCT_CASE_LEGACY_OUTPUT_PROFILE
  sourceWorkspaceExportVersion:
    typeof PRODUCT_CASE_LEGACY_WORKSPACE_EXPORT_VERSION
  sourceOutputContractVersion: "UNVERSIONED"
  validationMode: "CURRENT_DOMAIN_GATED_REBUILD"
  historicalOutput: ProductCaseRunnerOutput
  historicalOutputContentHash: `sha256:${string}`
  outputMismatchPaths: string[]
  outputMismatchPathCount: number
  outputMismatchPathsTruncated: boolean
  quarantinedLegacyVisualObservationIds: string[]
  historicalOutputTrusted: false
  historicalPackageTrusted: false
  historicalHandoffTrusted: false
  activeOutputRebuiltWithCurrentDomain: true
  auditOnly: true
}

export type ProductCaseWorkspaceState = {
  document: ProductCaseDocument
  economicsPolicy: EconomicsPolicy | null
  scenarioDraft: ProductCaseScenarioDraft | null
  listingOperations: ProductCaseListingOperations
  imageApprovals: ProductCaseImageApproval[]
  imageObservations: ProductCaseImageObservation[]
  evaluatedAt: string
  generatedAt: string
  legacyImportAudit?: ProductCaseLegacyImportAudit
}

export type ProductCaseWorkspaceExportEnvelope = {
  version: typeof PRODUCT_CASE_WORKSPACE_EXPORT_VERSION
  outputContractVersion: typeof PRODUCT_CASE_OUTPUT_CONTRACT_VERSION
  exportedAt: string
  workspaceState: ProductCaseWorkspaceState
  output: ProductCaseRunnerOutput
  safety: ProductCaseSafety
}

export function humanVisualReviewContractIssues(
  observations: ProductCaseImageObservation[],
) {
  const issues: string[] = []
  const imageIds = new Set<string>()
  for (const observation of observations) {
    const imageId = normalizeWhitespace(observation.imageId)
    if (!imageId || imageIds.has(imageId)) {
      issues.push(`HUMAN_VISUAL_REVIEW_IMAGE_ID_DUPLICATE_OR_MISSING:${imageId}`)
    }
    imageIds.add(imageId)
    if (
      observation.contractVersion !==
        HUMAN_VISUAL_REVIEW_CONTRACT_VERSION ||
      !observation.rawHumanInput
    ) {
      issues.push(`HUMAN_VISUAL_REVIEW_HUMAN_CORRECTION_REQUIRED:${imageId}`)
    }
    const visibleBrands = Array.isArray(observation.visibleBrands)
      ? observation.visibleBrands
      : []
    if (visibleBrands.some((brand) =>
      /^no brand visible$/i.test(normalizeWhitespace(brand))
    )) {
      issues.push(`HUMAN_VISUAL_REVIEW_BRAND_PLACEHOLDER_INVALID:${imageId}`)
    }
  }
  return unique(issues)
}

function assertSafeJsonTree(value: unknown) {
  let visited = 0
  const visit = (entry: unknown, depth: number) => {
    visited += 1
    if (visited > 50_000 || depth > 64) {
      throw new Error("PRODUCT_CASE_IMPORT_STRUCTURE_LIMIT_EXCEEDED")
    }
    if (!entry || typeof entry !== "object") return
    if (Array.isArray(entry)) {
      entry.forEach((item) => visit(item, depth + 1))
      return
    }
    for (const [key, child] of Object.entries(
      entry as Record<string, unknown>,
    )) {
      if (["__proto__", "prototype", "constructor"].includes(key)) {
        throw new Error("PRODUCT_CASE_IMPORT_UNSAFE_KEY")
      }
      visit(child, depth + 1)
    }
  }
  visit(value, 0)
}

function safeDiagnosticPath(parent: string, key: string) {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(key)
    ? `${parent}.${key}`
    : `${parent}.[REDACTED_KEY]`
}

const PRODUCT_CASE_OUTPUT_MISMATCH_DIAGNOSTIC_PATH_LIMIT = 256

function inspectProductCaseOutputMismatches(
  historicalOutput: unknown,
  currentOutput: unknown,
) {
  const paths: string[] = []
  const collectedPaths = new Set<string>()
  let pathCount = 0
  let allVersionedLegacyDerivedPaths = true
  const registerMismatch = (path: string) => {
    pathCount += 1
    if (!isVersionedLegacyDerivedPath(path)) {
      allVersionedLegacyDerivedPaths = false
    }
    if (
      paths.length < PRODUCT_CASE_OUTPUT_MISMATCH_DIAGNOSTIC_PATH_LIMIT &&
      !collectedPaths.has(path)
    ) {
      collectedPaths.add(path)
      paths.push(path)
    }
  }
  const visit = (historical: unknown, current: unknown, path: string) => {
    if (stableValue(historical) === stableValue(current)) return
    if (Array.isArray(historical) && Array.isArray(current)) {
      const length = Math.max(historical.length, current.length)
      for (let index = 0; index < length; index += 1) {
        visit(historical[index], current[index], `${path}[${index}]`)
      }
      return
    }
    if (
      historical && current &&
      typeof historical === "object" &&
      typeof current === "object" &&
      !Array.isArray(historical) &&
      !Array.isArray(current)
    ) {
      const keys = unique([
        ...Object.keys(historical as Record<string, unknown>),
        ...Object.keys(current as Record<string, unknown>),
      ]).sort()
      for (const key of keys) {
        visit(
          (historical as Record<string, unknown>)[key],
          (current as Record<string, unknown>)[key],
          safeDiagnosticPath(path, key),
        )
      }
      return
    }
    registerMismatch(path)
  }
  visit(historicalOutput, currentOutput, "output")
  return {
    paths,
    pathCount,
    truncated: pathCount > paths.length,
    allVersionedLegacyDerivedPaths,
  }
}

export function productCaseOutputMismatchPaths(
  historicalOutput: unknown,
  currentOutput: unknown,
) {
  return inspectProductCaseOutputMismatches(
    historicalOutput,
    currentOutput,
  ).paths
}

function outputMismatchErrorDetails(input: {
  paths: string[]
  pathCount: number
  truncated: boolean
}) {
  const visiblePaths = input.paths.length > 0
    ? input.paths.join(" · ")
    : "output"
  return input.truncated
    ? `${visiblePaths} · [DIAGNOSTIC_TRUNCATED:${
        input.pathCount - input.paths.length
      }_ADDITIONAL_PATHS]`
    : visiblePaths
}

const LEGACY_DERIVED_OUTPUT_PATHS = [
  "output.adapter",
  "output.handoffArtifactGenerated",
  "output.learningObservation",
  "output.legacyPhaseDiagnostics",
  "output.listingPackage",
  "output.listingPackageStatus",
  "output.manualHandoffAllowed",
  "output.operationalPipeline",
  "output.readiness",
  "output.registrationDraft",
  "output.shadowMode",
] as const

function isVersionedLegacyDerivedPath(path: string) {
  if (path.includes("[REDACTED_KEY]")) return false
  return LEGACY_DERIVED_OUTPUT_PATHS.some((prefix) =>
    path === prefix ||
    path.startsWith(`${prefix}.`) ||
    path.startsWith(`${prefix}[`)
  )
}

function safetySurfaceViolations(
  value: unknown,
  path: string,
) {
  const violations: string[] = []
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [path]
  }
  const safety = value as Record<string, unknown>
  const expected = PRODUCT_CASE_ZERO_EFFECTS as unknown as
    Record<string, unknown>
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (safety[key] !== expectedValue) {
      violations.push(safeDiagnosticPath(path, key))
    }
  }
  for (const key of Object.keys(safety)) {
    if (!(key in expected)) {
      violations.push(safeDiagnosticPath(path, key))
    }
  }
  return violations
}

function objectSurface(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function falseFlagViolation(
  value: Record<string, unknown> | null,
  key: string,
  path: string,
) {
  return value && value[key] !== false
    ? [safeDiagnosticPath(path, key)]
    : []
}

function literalFlagViolation(
  value: Record<string, unknown> | null,
  key: string,
  expected: unknown,
  path: string,
) {
  return value && value[key] !== expected
    ? [safeDiagnosticPath(path, key)]
    : []
}

function humanReviewEffectViolations(
  value: unknown,
  path: string,
) {
  const humanReview = objectSurface(value)
  if (!humanReview) return [path]
  return [
    ...falseFlagViolation(humanReview, "canPublishAutomatically", path),
    ...falseFlagViolation(humanReview, "canChangeEngineRules", path),
    ...falseFlagViolation(humanReview, "canLinkListing", path),
  ]
}

function imageRegistryEffectViolations(
  value: unknown,
  path: string,
) {
  const registry = objectSurface(value)
  if (!registry) return []
  const violations = safetySurfaceViolations(
    registry.safety,
    `${path}.safety`,
  )
  if (Array.isArray(registry.entries)) {
    registry.entries.forEach((entry, index) => {
      const image = objectSurface(entry)
      if (!image) return
      const imagePath = `${path}.entries[${index}]`
      violations.push(
        ...falseFlagViolation(image, "downloaded", imagePath),
        ...falseFlagViolation(image, "transformed", imagePath),
        ...falseFlagViolation(image, "generated", imagePath),
      )
    })
  }
  return violations
}

function registrationDraftEffectViolations(
  value: unknown,
  path: string,
) {
  const registration = objectSurface(value)
  if (!registration) return []
  return [
    ...safetySurfaceViolations(
      registration.safety,
      `${path}.safety`,
    ),
    ...falseFlagViolation(registration, "canSubmit", path),
    ...literalFlagViolation(
      registration,
      "executionStatus",
      "DRAFT_NOT_SUBMITTED",
      path,
    ),
  ]
}

function runnerOutputEffectViolations(
  value: unknown,
  path: string,
) {
  const output = objectSurface(value)
  if (!output) return []
  const document = objectSurface(output.document)
  const adapter = objectSurface(output.adapter)
  const listingPackage = objectSurface(output.listingPackage)
  const shadowMode = objectSurface(output.shadowMode)
  const learningObservation = objectSurface(output.learningObservation)
  const violations = [
    ...safetySurfaceViolations(output.safety, `${path}.safety`),
    ...safetySurfaceViolations(
      document?.safety,
      `${path}.document.safety`,
    ),
    ...humanReviewEffectViolations(
      document?.humanReview,
      `${path}.document.humanReview`,
    ),
    ...safetySurfaceViolations(
      adapter?.safety,
      `${path}.adapter.safety`,
    ),
    ...imageRegistryEffectViolations(
      output.imageRegistry,
      `${path}.imageRegistry`,
    ),
    ...registrationDraftEffectViolations(
      output.registrationDraft,
      `${path}.registrationDraft`,
    ),
    ...falseFlagViolation(output, "canPublishAutomatically", path),
    ...literalFlagViolation(
      output,
      "publicationStatus",
      "NOT_PUBLISHED",
      path,
    ),
    ...falseFlagViolation(
      shadowMode,
      "canChangeEngineRules",
      `${path}.shadowMode`,
    ),
    ...falseFlagViolation(
      shadowMode,
      "canLinkListing",
      `${path}.shadowMode`,
    ),
    ...literalFlagViolation(
      learningObservation,
      "engineRuleChanged",
      false,
      `${path}.learningObservation`,
    ),
  ]
  if (listingPackage) {
    violations.push(
      ...safetySurfaceViolations(
        listingPackage.safety,
        `${path}.listingPackage.safety`,
      ),
      ...falseFlagViolation(
        listingPackage,
        "canPublishAutomatically",
        `${path}.listingPackage`,
      ),
    )
  }
  if (Array.isArray(output.operationalPipeline)) {
    output.operationalPipeline.forEach((entry, index) => {
      const phase = objectSurface(entry)
      if (!phase) return
      const phasePath = `${path}.operationalPipeline[${index}]`
      violations.push(
        ...literalFlagViolation(
          phase,
          "publicationStatus",
          "NOT_PUBLISHED",
          phasePath,
        ),
      )
      if (phase.phase === "IMAGE_AND_COMMERCIAL_QA") {
        violations.push(
          ...imageRegistryEffectViolations(
            objectSurface(phase.output)?.imageRegistry,
            `${phasePath}.output.imageRegistry`,
          ),
        )
      }
      if (phase.phase === "MANUAL_LISTING_REGISTRATION") {
        violations.push(
          ...literalFlagViolation(
            objectSurface(phase.output),
            "publicationStatus",
            "NOT_PUBLISHED",
            `${phasePath}.output`,
          ),
        )
      }
    })
  }
  if (Array.isArray(output.legacyPhaseDiagnostics)) {
    output.legacyPhaseDiagnostics.forEach((entry, index) => {
      const phase = objectSurface(entry)
      const phaseOutput = objectSurface(phase?.output)
      if (!phase || !phaseOutput) return
      const phasePath = `${path}.legacyPhaseDiagnostics[${index}].output`
      if (phase.name === "IMAGE REGISTRY / QA") {
        violations.push(
          ...imageRegistryEffectViolations(
            phaseOutput.imageRegistry,
            `${phasePath}.imageRegistry`,
          ),
        )
      }
      if (phase.name === "MANUAL HANDOFF / REGISTRATION DRAFT") {
        violations.push(
          ...registrationDraftEffectViolations(
            phaseOutput.registrationDraft,
            `${phasePath}.registrationDraft`,
          ),
        )
      }
    })
  }
  return violations
}

function externalEffectViolations(value: unknown) {
  const envelope = objectSurface(value)
  if (!envelope) return ["envelope"]
  const workspaceState = objectSurface(envelope.workspaceState)
  const document = objectSurface(workspaceState?.document)
  const legacyImportAudit = objectSurface(workspaceState?.legacyImportAudit)
  const violations = [
    ...safetySurfaceViolations(envelope.safety, "envelope.safety"),
    ...safetySurfaceViolations(
      document?.safety,
      "envelope.workspaceState.document.safety",
    ),
    ...humanReviewEffectViolations(
      document?.humanReview,
      "envelope.workspaceState.document.humanReview",
    ),
    ...runnerOutputEffectViolations(envelope.output, "envelope.output"),
  ]
  if (legacyImportAudit?.historicalOutput) {
    violations.push(
      ...runnerOutputEffectViolations(
        legacyImportAudit.historicalOutput,
        "envelope.workspaceState.legacyImportAudit.historicalOutput",
      ),
    )
  }
  return unique(violations).slice(0, 100)
}

function legacyRawHumanInputAuditProjection(
  observation: ProductCaseImageObservation,
) {
  return {
    imageId: observation.imageId,
    sourceUrl: observation.sourceUrl,
    sourceReference: observation.sourceReference,
    observedProductType: observation.observedProductType ?? "",
    visibleFeatures: observation.visibleFeatures.join("\n"),
    visibleText: observation.visibleText.join("\n"),
    visibleBrands: observation.visibleBrands.join("\n"),
    visibleColors: observation.visibleColors.join("\n"),
    visibleQuantity: observation.visibleQuantity === null
      ? ""
      : String(observation.visibleQuantity),
    observedVariant: observation.observedVariant ?? "",
    possibleConflicts: observation.possibleConflicts.join("\n"),
    confidence: observation.confidence,
    humanDecision: observation.humanDecision,
    humanReason: observation.humanReason,
  }
}

function hasPreContractVisualObservation(
  workspaceState: ProductCaseWorkspaceState,
) {
  return workspaceState.imageObservations.some((observation) =>
    observation.contractVersion !== HUMAN_VISUAL_REVIEW_CONTRACT_VERSION ||
    !observation.rawHumanInput
  )
}

function buildLegacyHistoricalOutputAuditProjection(input: {
  workspaceState: ProductCaseWorkspaceState
  exportedAt: string
}) {
  const projectedState = structuredClone(input.workspaceState)
  const missingFields = projectedState.imageObservations.map(
    (observation) => ({
      contractVersion:
        observation.contractVersion !== HUMAN_VISUAL_REVIEW_CONTRACT_VERSION,
      rawHumanInput: !observation.rawHumanInput,
    }),
  )
  const projectObservation = (
    observation: ProductCaseImageObservation,
  ): ProductCaseImageObservation => ({
    ...observation,
    contractVersion: HUMAN_VISUAL_REVIEW_CONTRACT_VERSION,
    rawHumanInput: observation.rawHumanInput ??
      legacyRawHumanInputAuditProjection(observation),
  })
  projectedState.imageObservations =
    projectedState.imageObservations.map(projectObservation)
  projectedState.document.imageAnalysis.observations =
    projectedState.document.imageAnalysis.observations.map(projectObservation)
  const projectedOutput = structuredClone(createProductCaseWorkspaceExport({
    workspaceState: projectedState,
    exportedAt: input.exportedAt,
  }).output)
  projectedOutput.document.imageAnalysis.observations.forEach(
    (observation, index) => {
      const mutable = observation as unknown as Record<string, unknown>
      if (missingFields[index]?.contractVersion) {
        delete mutable.contractVersion
      }
      if (missingFields[index]?.rawHumanInput) {
        delete mutable.rawHumanInput
      }
    },
  )
  return projectedOutput
}

function legacyImportAuditHashPayload(
  audit: Omit<ProductCaseLegacyImportAudit, "historicalOutputContentHash">,
) {
  return stableValue(audit)
}

const LEGACY_VISUAL_QUARANTINE_ISSUE_PREFIX =
  "HUMAN_VISUAL_REVIEW_LEGACY_EVIDENCE_UNVERIFIABLE:"

function legacyVisualQuarantineIdsFromIssues(issues: string[]) {
  return unique(issues.flatMap((issue) =>
    issue.startsWith(LEGACY_VISUAL_QUARANTINE_ISSUE_PREFIX)
      ? [issue.slice(LEGACY_VISUAL_QUARANTINE_ISSUE_PREFIX.length)]
      : []
  )).sort()
}

function canonicalLegacyVisualQuarantineIds(imageIds: string[]) {
  return [...imageIds].sort()
}

function validateLegacyHistoricalAuditOutputStructure(
  output: unknown,
) {
  const historical = record(output)
  const historicalDocument = objectSurface(historical.document)
  const pipeline = Array.isArray(historical.operationalPipeline)
    ? historical.operationalPipeline as Array<Record<string, unknown>>
    : []
  if (
    historical.version !== PRODUCT_CASE_RUNNER_VERSION ||
    !historicalDocument ||
    historicalDocument.version !== PRODUCT_CASE_RUNNER_VERSION ||
    stableValue(historical.safety) !==
      stableValue(PRODUCT_CASE_ZERO_EFFECTS) ||
    historical.canPublishAutomatically !== false ||
    historical.publicationStatus !== "NOT_PUBLISHED" ||
    pipeline.length !== PRODUCT_CASE_OPERATIONAL_PHASES.length ||
    pipeline.some((phase, index) =>
      phase.phase !== PRODUCT_CASE_OPERATIONAL_PHASES[index]
    ) ||
    runnerOutputEffectViolations(
      output,
      "legacyImportAudit.historicalOutput",
    ).length > 0
  ) {
    throw new Error("PRODUCT_CASE_IMPORT_LEGACY_AUDIT_OUTPUT_INVALID")
  }
}

async function validateLegacyImportAuditSnapshotIntegrity(
  audit: ProductCaseLegacyImportAudit,
) {
  const {
    historicalOutputContentHash,
    ...hashPayload
  } = audit
  if (
    audit.warning !== PRODUCT_CASE_LEGACY_OUTPUT_WARNING ||
    audit.legacyProfile !== PRODUCT_CASE_LEGACY_OUTPUT_PROFILE ||
    audit.sourceWorkspaceExportVersion !==
      PRODUCT_CASE_LEGACY_WORKSPACE_EXPORT_VERSION ||
    audit.sourceOutputContractVersion !== "UNVERSIONED" ||
    audit.validationMode !== "CURRENT_DOMAIN_GATED_REBUILD" ||
    audit.historicalOutputTrusted !== false ||
    audit.historicalPackageTrusted !== false ||
    audit.historicalHandoffTrusted !== false ||
    audit.activeOutputRebuiltWithCurrentDomain !== true ||
    audit.auditOnly !== true ||
    !Array.isArray(audit.outputMismatchPaths) ||
    !Number.isInteger(audit.outputMismatchPathCount) ||
    audit.outputMismatchPathCount < audit.outputMismatchPaths.length ||
    audit.outputMismatchPaths.length >
      PRODUCT_CASE_OUTPUT_MISMATCH_DIAGNOSTIC_PATH_LIMIT ||
    audit.outputMismatchPathsTruncated !==
      (audit.outputMismatchPathCount > audit.outputMismatchPaths.length) ||
    !Array.isArray(audit.quarantinedLegacyVisualObservationIds) ||
    audit.quarantinedLegacyVisualObservationIds.some((imageId) =>
      typeof imageId !== "string" || !normalizeWhitespace(imageId)
    ) ||
    new Set(audit.quarantinedLegacyVisualObservationIds).size !==
      audit.quarantinedLegacyVisualObservationIds.length ||
    audit.outputMismatchPaths.some((path) =>
      typeof path !== "string" ||
      !path.startsWith("output")
    ) ||
    !validSha256(historicalOutputContentHash)
  ) {
    throw new Error("PRODUCT_CASE_IMPORT_LEGACY_AUDIT_INVALID")
  }
  const recalculatedHash = await hashProductCaseContent(
    legacyImportAuditHashPayload(hashPayload),
  )
  if (recalculatedHash !== historicalOutputContentHash) {
    throw new Error("PRODUCT_CASE_IMPORT_LEGACY_AUDIT_HASH_MISMATCH")
  }
  validateLegacyHistoricalAuditOutputStructure(
    audit.historicalOutput,
  )
  const historicalDocumentIntegrity =
    await validateProductCaseDocumentProvenanceIntegrity(
      audit.historicalOutput.document,
    )
  const historicalQuarantineIds = legacyVisualQuarantineIdsFromIssues(
    historicalDocumentIntegrity.errors,
  )
  if (
    historicalDocumentIntegrity.errors.length !==
      historicalQuarantineIds.length ||
    stableValue(historicalQuarantineIds) !== stableValue(
      canonicalLegacyVisualQuarantineIds(
        audit.quarantinedLegacyVisualObservationIds,
      ),
    )
  ) {
    throw new Error(
      "PRODUCT_CASE_IMPORT_LEGACY_AUDIT_PROVENANCE_INVALID",
    )
  }
}

async function validateLegacyImportAuditIntegrity(
  audit: ProductCaseLegacyImportAudit | undefined,
  input: {
    currentOutput: ProductCaseRunnerOutput
  },
) {
  if (!audit) return
  await validateLegacyImportAuditSnapshotIntegrity(audit)
  const expectedMismatch = inspectProductCaseOutputMismatches(
    audit.historicalOutput,
    input.currentOutput,
  )
  if (
    stableValue(audit.outputMismatchPaths) !==
      stableValue(expectedMismatch.paths) ||
    audit.outputMismatchPathCount !== expectedMismatch.pathCount ||
    audit.outputMismatchPathsTruncated !== expectedMismatch.truncated
  ) {
    throw new Error("PRODUCT_CASE_IMPORT_LEGACY_AUDIT_SEMANTICS_INVALID")
  }
}

function validateHistoricalOutputStructure(
  output: unknown,
  workspaceState: ProductCaseWorkspaceState,
) {
  const historical = record(output)
  const pipeline = Array.isArray(historical.operationalPipeline)
    ? historical.operationalPipeline as Array<Record<string, unknown>>
    : []
  if (
    historical.version !== PRODUCT_CASE_RUNNER_VERSION ||
    stableValue(historical.document) !==
      stableValue(workspaceState.document) ||
    stableValue(historical.safety) !==
      stableValue(PRODUCT_CASE_ZERO_EFFECTS) ||
    historical.canPublishAutomatically !== false ||
    historical.publicationStatus !== "NOT_PUBLISHED" ||
    pipeline.length !== PRODUCT_CASE_OPERATIONAL_PHASES.length ||
    pipeline.some((phase, index) =>
      phase.phase !== PRODUCT_CASE_OPERATIONAL_PHASES[index]
    )
  ) {
    throw new Error("PRODUCT_CASE_IMPORT_LEGACY_OUTPUT_STRUCTURE_INVALID")
  }
}

function workspaceStateFromUnknown(value: unknown): ProductCaseWorkspaceState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("PRODUCT_CASE_IMPORT_WORKSPACE_REQUIRED")
  }
  const state = value as Partial<ProductCaseWorkspaceState>
  if (
    !state.document ||
    state.document.version !== PRODUCT_CASE_RUNNER_VERSION ||
    !state.listingOperations ||
    !Array.isArray(state.imageApprovals) ||
    !Array.isArray(state.imageObservations) ||
    typeof state.evaluatedAt !== "string" ||
    !validIsoInstant(state.evaluatedAt) ||
    typeof state.generatedAt !== "string" ||
    !validIsoInstant(state.generatedAt)
  ) {
    throw new Error("PRODUCT_CASE_IMPORT_WORKSPACE_INVALID")
  }
  if (
    safetySurfaceViolations(
      state.document.safety,
      "workspaceState.document.safety",
    ).length > 0
  ) {
    throw new Error("PRODUCT_CASE_IMPORT_SAFETY_INVALID")
  }
  const cloned = structuredClone(state as ProductCaseWorkspaceState)
  if (stableValue(cloned.imageObservations) !== stableValue(
    cloned.document.imageAnalysis.observations,
  )) {
    throw new Error("PRODUCT_CASE_IMPORT_VISUAL_OBSERVATIONS_MISMATCH")
  }
  const provenance = validateProductCaseDocumentProvenance(cloned.document)
  if (!provenance.valid) {
    throw new Error(
      `PRODUCT_CASE_IMPORT_PROVENANCE_INVALID:${provenance.errors.join(",")}`,
    )
  }
  return cloned
}

export function createProductCaseWorkspaceExport(input: {
  workspaceState: ProductCaseWorkspaceState
  exportedAt: string
}): ProductCaseWorkspaceExportEnvelope {
  if (!validIsoInstant(input.exportedAt)) {
    throw new Error("PRODUCT_CASE_EXPORT_TIMESTAMP_INVALID")
  }
  const workspaceState = workspaceStateFromUnknown(input.workspaceState)
  const adapter = buildStrategyLabAdapterPreview({
    document: workspaceState.document,
    evaluatedAt: workspaceState.evaluatedAt,
    economicsPolicy: workspaceState.economicsPolicy,
    scenarioDraft: workspaceState.scenarioDraft,
  })
  const output = buildProductCaseRunnerOutput({
    document: workspaceState.document,
    adapter,
    imageApprovals: workspaceState.imageApprovals,
    listingOperations: workspaceState.listingOperations,
    generatedAt: workspaceState.generatedAt,
  })
  return {
    version: PRODUCT_CASE_WORKSPACE_EXPORT_VERSION,
    outputContractVersion: PRODUCT_CASE_OUTPUT_CONTRACT_VERSION,
    exportedAt: input.exportedAt,
    workspaceState,
    output,
    safety: PRODUCT_CASE_ZERO_EFFECTS,
  }
}

function legacyImportAuditMatchesCurrentOutput(
  audit: ProductCaseLegacyImportAudit,
  currentOutput: ProductCaseRunnerOutput,
) {
  const mismatch = inspectProductCaseOutputMismatches(
    audit.historicalOutput,
    currentOutput,
  )
  return stableValue(audit.outputMismatchPaths) ===
      stableValue(mismatch.paths) &&
    audit.outputMismatchPathCount === mismatch.pathCount &&
    audit.outputMismatchPathsTruncated === mismatch.truncated
}

export async function refreshProductCaseLegacyImportAuditForExport(input: {
  workspaceState: ProductCaseWorkspaceState
  exportedAt: string
}): Promise<ProductCaseWorkspaceState> {
  const current = createProductCaseWorkspaceExport(input)
  const audit = current.workspaceState.legacyImportAudit
  if (!audit) return current.workspaceState

  await validateLegacyImportAuditSnapshotIntegrity(audit)

  const activeProvenance =
    await validateProductCaseDocumentProvenanceIntegrity(
      current.workspaceState.document,
    )
  const activeQuarantineIssues = activeProvenance.errors.filter((error) =>
    error.startsWith(LEGACY_VISUAL_QUARANTINE_ISSUE_PREFIX)
  )
  const activeQuarantineIds = legacyVisualQuarantineIdsFromIssues(
    activeQuarantineIssues,
  )
  const activeQuarantineAllowed =
    activeQuarantineIssues.length === activeProvenance.errors.length &&
    activeQuarantineIds.every((imageId) =>
      audit.quarantinedLegacyVisualObservationIds.includes(imageId) &&
      (current.workspaceState.document.imageAnalysis.contractIssues ?? [])
        .includes(`${LEGACY_VISUAL_QUARANTINE_ISSUE_PREFIX}${imageId}`)
    )
  if (
    !activeProvenance.valid &&
    !activeQuarantineAllowed
  ) {
    throw new Error(
      `PRODUCT_CASE_EXPORT_CRYPTOGRAPHIC_PROVENANCE_INVALID:${
        activeProvenance.errors.join(",")
      }`,
    )
  }

  const mismatch = inspectProductCaseOutputMismatches(
    audit.historicalOutput,
    current.output,
  )
  const {
    historicalOutputContentHash: _staleHash,
    ...existingWithoutHash
  } = audit
  const refreshedWithoutHash:
    Omit<ProductCaseLegacyImportAudit, "historicalOutputContentHash"> = {
      ...existingWithoutHash,
      validationMode: "CURRENT_DOMAIN_GATED_REBUILD",
      historicalOutput: audit.historicalOutput,
      outputMismatchPaths: mismatch.paths,
      outputMismatchPathCount: mismatch.pathCount,
      outputMismatchPathsTruncated: mismatch.truncated,
      quarantinedLegacyVisualObservationIds:
        canonicalLegacyVisualQuarantineIds(
          audit.quarantinedLegacyVisualObservationIds,
        ),
    }
  const refreshedAudit: ProductCaseLegacyImportAudit = {
    ...refreshedWithoutHash,
    historicalOutputContentHash: await hashProductCaseContent(
      legacyImportAuditHashPayload(refreshedWithoutHash),
    ) as `sha256:${string}`,
  }
  const refreshedWorkspaceState = structuredClone(current.workspaceState)
  refreshedWorkspaceState.legacyImportAudit = refreshedAudit
  const refreshed = createProductCaseWorkspaceExport({
    workspaceState: refreshedWorkspaceState,
    exportedAt: input.exportedAt,
  })
  await validateLegacyImportAuditIntegrity(
    refreshed.workspaceState.legacyImportAudit,
    { currentOutput: refreshed.output },
  )
  return refreshed.workspaceState
}

export function serializeProductCaseWorkspaceExport(input: {
  workspaceState: ProductCaseWorkspaceState
  exportedAt: string
}) {
  const envelope = createProductCaseWorkspaceExport(input)
  const audit = envelope.workspaceState.legacyImportAudit
  if (
    audit &&
    !legacyImportAuditMatchesCurrentOutput(audit, envelope.output)
  ) {
    throw new Error(
      "PRODUCT_CASE_EXPORT_LEGACY_AUDIT_REFRESH_REQUIRED",
    )
  }
  const serialized = JSON.stringify(envelope)
  if (utf8Length(serialized) > PRODUCT_CASE_WORKSPACE_EXPORT_MAX_BYTES) {
    throw new Error("PRODUCT_CASE_EXPORT_TOO_LARGE")
  }
  return serialized
}

export async function importProductCaseWorkspaceExport(serialized: string) {
  if (typeof serialized !== "string" || !serialized.trim()) {
    throw new Error("PRODUCT_CASE_IMPORT_REQUIRED")
  }
  if (utf8Length(serialized) > PRODUCT_CASE_WORKSPACE_EXPORT_MAX_BYTES) {
    throw new Error("PRODUCT_CASE_IMPORT_TOO_LARGE")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    throw new Error("PRODUCT_CASE_IMPORT_JSON_INVALID")
  }
  assertSafeJsonTree(parsed)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("PRODUCT_CASE_IMPORT_ENVELOPE_INVALID")
  }
  const envelope = parsed as Partial<ProductCaseWorkspaceExportEnvelope>
  const envelopeVersion = (parsed as Record<string, unknown>).version
  if (
    typeof envelope.exportedAt !== "string" ||
    !validIsoInstant(envelope.exportedAt)
  ) {
    throw new Error("PRODUCT_CASE_IMPORT_VERSION_INVALID")
  }
  const currentExport =
    envelopeVersion === PRODUCT_CASE_WORKSPACE_EXPORT_VERSION
  const legacyExport =
    envelopeVersion === PRODUCT_CASE_LEGACY_WORKSPACE_EXPORT_VERSION
  const envelopeOutputContractVersion =
    (parsed as Record<string, unknown>).outputContractVersion
  if (!currentExport && !legacyExport) {
    throw new Error("PRODUCT_CASE_IMPORT_VERSION_INVALID")
  }
  const currentOutputContract =
    currentExport &&
    envelopeOutputContractVersion === PRODUCT_CASE_OUTPUT_CONTRACT_VERSION
  const preIdentityOutputContract =
    currentExport &&
    envelopeOutputContractVersion ===
      PRODUCT_CASE_PRE_IDENTITY_OUTPUT_CONTRACT_VERSION
  if (currentExport && !currentOutputContract &&
    !preIdentityOutputContract) {
    throw new Error("PRODUCT_CASE_IMPORT_OUTPUT_CONTRACT_VERSION_INVALID")
  }
  if (
    legacyExport &&
    envelopeOutputContractVersion !== undefined
  ) {
    throw new Error("PRODUCT_CASE_IMPORT_LEGACY_OUTPUT_CONTRACT_INVALID")
  }
  const effectViolations = externalEffectViolations(parsed)
  if (
    effectViolations.length > 0 ||
    stableValue(envelope.safety) !==
      stableValue(PRODUCT_CASE_ZERO_EFFECTS)
  ) {
    throw new Error(
      `PRODUCT_CASE_IMPORT_SAFETY_INVALID:${
        effectViolations.join(",") || "envelope.safety"
      }`,
    )
  }
  const workspaceState = workspaceStateFromUnknown(envelope.workspaceState)
  if (
    currentExport &&
    workspaceState.document.identityReview.blockers.includes(
      PRODUCT_CASE_LEGACY_OUTPUT_WARNING,
    ) &&
    !workspaceState.legacyImportAudit
  ) {
    throw new Error("PRODUCT_CASE_IMPORT_LEGACY_AUDIT_REQUIRED")
  }
  let visualReviewContractIssues = unique([
    ...(workspaceState.document.imageAnalysis.contractIssues ?? []),
    ...visualContractIssuesForDocument(workspaceState.document),
  ])
  const cryptographicProvenance =
    await validateProductCaseDocumentProvenanceIntegrity(
      workspaceState.document,
    )
  const legacyVisualQuarantineIssues =
    cryptographicProvenance.errors.filter((error) =>
      error.startsWith(LEGACY_VISUAL_QUARANTINE_ISSUE_PREFIX)
    )
  const quarantinedLegacyVisualObservationIds =
    legacyVisualQuarantineIdsFromIssues(legacyVisualQuarantineIssues)
  const onlyQuarantinableLegacyVisualErrors =
    legacyVisualQuarantineIssues.length > 0 &&
    legacyVisualQuarantineIssues.length ===
      cryptographicProvenance.errors.length
  const auditQuarantineIds =
    workspaceState.legacyImportAudit
      ?.quarantinedLegacyVisualObservationIds ?? []
  const currentAuditQuarantineMatches =
    currentExport &&
    Boolean(workspaceState.legacyImportAudit) &&
    quarantinedLegacyVisualObservationIds.every((imageId) =>
      auditQuarantineIds.includes(imageId) &&
      (workspaceState.document.imageAnalysis.contractIssues ?? [])
        .includes(
          `HUMAN_VISUAL_REVIEW_LEGACY_EVIDENCE_UNVERIFIABLE:${imageId}`,
        )
    )
  const legacyVisualQuarantineAllowed =
    onlyQuarantinableLegacyVisualErrors &&
    (
      legacyExport ||
      currentAuditQuarantineMatches
    )
  if (!cryptographicProvenance.valid && !legacyVisualQuarantineAllowed) {
    throw new Error(
      `PRODUCT_CASE_IMPORT_CRYPTOGRAPHIC_PROVENANCE_INVALID:${
        cryptographicProvenance.errors.join(",")
      }`,
    )
  }
  if (legacyVisualQuarantineAllowed) {
    visualReviewContractIssues = unique([
      ...visualReviewContractIssues,
      ...legacyVisualQuarantineIssues,
    ])
  }
  const recomputedOriginal = createProductCaseWorkspaceExport({
    workspaceState,
    exportedAt: envelope.exportedAt,
  })
  const outputMismatchDiagnostic = inspectProductCaseOutputMismatches(
    envelope.output,
    recomputedOriginal.output,
  )
  let outputMismatchPaths = outputMismatchDiagnostic.paths
  let historicalOutputAudit: ProductCaseLegacyImportAudit | null = null
  let legacyHistoricalOutput: ProductCaseRunnerOutput | null = null
  let legacyOutputRebuilt = false
  let preIdentityOutputRebuilt = false
  if (currentOutputContract && outputMismatchDiagnostic.pathCount > 0) {
    throw new Error(
      `PRODUCT_CASE_IMPORT_OUTPUT_MISMATCH:${
        outputMismatchErrorDetails(outputMismatchDiagnostic)
      }`,
    )
  }
  if (preIdentityOutputContract) {
    if (
      workspaceState.document.identityReview.humanReview ||
      !envelope.output
    ) {
      throw new Error(
        "PRODUCT_CASE_IMPORT_PRE_IDENTITY_OUTPUT_PROFILE_INVALID",
      )
    }
    validateHistoricalOutputStructure(envelope.output, workspaceState)
    if (
      outputMismatchDiagnostic.pathCount > 0 &&
      !outputMismatchDiagnostic.allVersionedLegacyDerivedPaths
    ) {
      throw new Error(
        `PRODUCT_CASE_IMPORT_OUTPUT_MISMATCH:${
          outputMismatchErrorDetails(outputMismatchDiagnostic)
        }`,
      )
    }
    preIdentityOutputRebuilt = true
    legacyOutputRebuilt = true
  }
  if (currentOutputContract) {
    await validateLegacyImportAuditIntegrity(
      workspaceState.legacyImportAudit,
      {
        currentOutput: recomputedOriginal.output,
      },
    )
  } else if (preIdentityOutputContract &&
    workspaceState.legacyImportAudit) {
    await validateLegacyImportAuditSnapshotIntegrity(
      workspaceState.legacyImportAudit,
    )
  }
  if (legacyExport) {
    if (
      !envelope.output ||
      workspaceState.legacyImportAudit ||
      !hasPreContractVisualObservation(workspaceState)
    ) {
      throw new Error("PRODUCT_CASE_IMPORT_LEGACY_PROFILE_INVALID")
    }
    validateHistoricalOutputStructure(envelope.output, workspaceState)
    const historicalProjection =
      buildLegacyHistoricalOutputAuditProjection({
        workspaceState,
        exportedAt: envelope.exportedAt,
      })
    const projectionMatches =
      stableValue(envelope.output) === stableValue(historicalProjection)
    const expectedDerivedPathsOnly =
      outputMismatchDiagnostic.pathCount > 0 &&
      outputMismatchDiagnostic.allVersionedLegacyDerivedPaths
    const currentDomainMatches = outputMismatchDiagnostic.pathCount === 0
    if (
      !currentDomainMatches &&
      !projectionMatches &&
      !(
        expectedDerivedPathsOnly &&
        quarantinedLegacyVisualObservationIds.length === 0
      )
    ) {
      throw new Error(
        `PRODUCT_CASE_IMPORT_OUTPUT_MISMATCH:${
          outputMismatchErrorDetails(outputMismatchDiagnostic)
        }`,
      )
    }
    legacyHistoricalOutput = structuredClone(envelope.output)
    legacyOutputRebuilt = true
  }
  const reviewRequiredState = structuredClone(workspaceState)
  const legacyAuditPresent = Boolean(
    legacyHistoricalOutput || workspaceState.legacyImportAudit,
  )
  reviewRequiredState.document.imageAnalysis.contractIssues =
    visualReviewContractIssues
  const canonicalHumanIdentityReview =
    currentExport &&
    reviewRequiredState.document.identityReview.humanReview
      ?.contractVersion === HUMAN_IDENTITY_REVIEW_CONTRACT_VERSION
  reviewRequiredState.document.identityReview =
    canonicalHumanIdentityReview
      ? {
          ...reviewRequiredState.document.identityReview,
          blockers: unique([
            ...(legacyAuditPresent
              ? [PRODUCT_CASE_LEGACY_OUTPUT_WARNING]
              : []),
            ...visualReviewContractIssues,
            ...reviewRequiredState.document.identityReview.blockers,
          ]),
        }
      : {
          ...reviewRequiredState.document.identityReview,
          status: "NOT_REVIEWED",
          confidence: "LOW",
          physicalProductVerified: false,
          physicalVerificationEvidenceIds: [],
          blockers: unique([
            "IMPORTED_IDENTITY_REQUIRES_NEW_LOCAL_HUMAN_REVIEW",
            ...(preIdentityOutputRebuilt
              ? [PRODUCT_CASE_PRE_IDENTITY_OUTPUT_WARNING]
              : []),
            ...(legacyAuditPresent
              ? [PRODUCT_CASE_LEGACY_OUTPUT_WARNING]
              : []),
            ...visualReviewContractIssues,
            ...reviewRequiredState.document.identityReview.blockers,
          ]),
          nextAction: "REVALIDATE_IMPORTED_PRODUCT_CASE_LOCALLY",
        }
  reviewRequiredState.document.humanReview = {
    ...reviewRequiredState.document.humanReview,
    conclusion: {
      ...reviewRequiredState.document.humanReview.conclusion,
      reviewedAt: null,
      reviewer: null,
    },
  }
  reviewRequiredState.listingOperations = {
    ...reviewRequiredState.listingOperations,
    brandIpClaimsReview: {
      status: "NOT_REVIEWED",
      reviewer: null,
      reviewedAt: null,
      reason: "IMPORTED_APPROVAL_IS_NOT_TRUSTED",
    },
    explicitHumanApproval: {
      approved: false,
      reviewer: null,
      reviewedAt: null,
      reason: "IMPORTED_APPROVAL_IS_NOT_TRUSTED",
    },
  }
  reviewRequiredState.imageApprovals =
    reviewRequiredState.imageApprovals.map((approval) => ({
      ...approval,
      status: "HUMAN_REVIEW",
      reviewer: null,
      reviewedAt: null,
      reason: "IMPORTED_IMAGE_APPROVAL_IS_NOT_TRUSTED",
      qa: {
        productAndVariantMatch: false,
        packQuantityMatch: false,
        logosAndIpReviewed: false,
        claimsReviewed: false,
        ebayRoleCoherent: false,
      },
    }))
  let rebuilt = createProductCaseWorkspaceExport({
    workspaceState: reviewRequiredState,
    exportedAt: envelope.exportedAt,
  })
  if (legacyHistoricalOutput) {
    const activeMismatch = inspectProductCaseOutputMismatches(
      legacyHistoricalOutput,
      rebuilt.output,
    )
    outputMismatchPaths = activeMismatch.paths
    const auditWithoutHash:
      Omit<ProductCaseLegacyImportAudit, "historicalOutputContentHash"> = {
        warning: PRODUCT_CASE_LEGACY_OUTPUT_WARNING,
        legacyProfile: PRODUCT_CASE_LEGACY_OUTPUT_PROFILE,
        sourceWorkspaceExportVersion:
          PRODUCT_CASE_LEGACY_WORKSPACE_EXPORT_VERSION,
        sourceOutputContractVersion: "UNVERSIONED",
        validationMode: "CURRENT_DOMAIN_GATED_REBUILD",
        historicalOutput: legacyHistoricalOutput,
        outputMismatchPaths: activeMismatch.paths,
        outputMismatchPathCount: activeMismatch.pathCount,
        outputMismatchPathsTruncated: activeMismatch.truncated,
        quarantinedLegacyVisualObservationIds:
          canonicalLegacyVisualQuarantineIds(
            quarantinedLegacyVisualObservationIds,
          ),
        historicalOutputTrusted: false,
        historicalPackageTrusted: false,
        historicalHandoffTrusted: false,
        activeOutputRebuiltWithCurrentDomain: true,
        auditOnly: true,
      }
    historicalOutputAudit = {
      ...auditWithoutHash,
      historicalOutputContentHash: await hashProductCaseContent(
        legacyImportAuditHashPayload(auditWithoutHash),
      ) as `sha256:${string}`,
    }
    reviewRequiredState.legacyImportAudit =
      structuredClone(historicalOutputAudit)
    rebuilt = createProductCaseWorkspaceExport({
      workspaceState: reviewRequiredState,
      exportedAt: envelope.exportedAt,
    })
    const auditOutputStability = inspectProductCaseOutputMismatches(
      legacyHistoricalOutput,
      rebuilt.output,
    )
    if (
      stableValue(auditOutputStability.paths) !==
        stableValue(historicalOutputAudit.outputMismatchPaths) ||
      auditOutputStability.pathCount !==
        historicalOutputAudit.outputMismatchPathCount ||
      auditOutputStability.truncated !==
        historicalOutputAudit.outputMismatchPathsTruncated
    ) {
      throw new Error(
        "PRODUCT_CASE_IMPORT_LEGACY_AUDIT_REBUILD_UNSTABLE",
      )
    }
    await validateLegacyImportAuditIntegrity(
      historicalOutputAudit,
      {
        currentOutput: rebuilt.output,
      },
    )
  }
  if (
    currentExport &&
    rebuilt.workspaceState.legacyImportAudit
  ) {
    const refreshedWorkspaceState =
      await refreshProductCaseLegacyImportAuditForExport({
        workspaceState: rebuilt.workspaceState,
        exportedAt: envelope.exportedAt,
      })
    rebuilt = createProductCaseWorkspaceExport({
      workspaceState: refreshedWorkspaceState,
      exportedAt: envelope.exportedAt,
    })
  }
  if (
    legacyOutputRebuilt &&
    (
      rebuilt.output.listingPackage !== null ||
      rebuilt.output.listingPackageStatus ===
        "READY_FOR_HUMAN_SELLER_HUB_ENTRY" ||
      rebuilt.output.manualHandoffAllowed !== false ||
      rebuilt.output.handoffArtifactGenerated !== false
    )
  ) {
    throw new Error("PRODUCT_CASE_IMPORT_LEGACY_REBUILD_NOT_BLOCKED")
  }
  const effectiveHistoricalOutputAudit =
    historicalOutputAudit ??
    rebuilt.workspaceState.legacyImportAudit ??
    null
  const preIdentityOutputWarningPresent =
    preIdentityOutputRebuilt ||
    rebuilt.workspaceState.document.identityReview.blockers.includes(
      PRODUCT_CASE_PRE_IDENTITY_OUTPUT_WARNING,
    )
  return {
    importMode: "VIEW_ONLY" as const,
    humanReviewStatus: "HUMAN_REVIEW_REQUIRED" as const,
    importedEnvelope: structuredClone(envelope),
    preservedWorkspaceState: workspaceState,
    workspaceState: rebuilt.workspaceState,
    rebuiltOutput: rebuilt.output,
    importedManualHandoffTrusted: false as const,
    visualReviewContractIssues,
    visualReviewCorrectionRequired: visualReviewContractIssues.length > 0,
    legacyOutputRebuilt,
    preIdentityOutputRebuilt,
    importWarnings: [
      ...(effectiveHistoricalOutputAudit
        ? [PRODUCT_CASE_LEGACY_OUTPUT_WARNING] : []),
      ...(preIdentityOutputWarningPresent
        ? [PRODUCT_CASE_PRE_IDENTITY_OUTPUT_WARNING] : []),
    ],
    outputMismatchPaths,
    historicalOutputAudit: effectiveHistoricalOutputAudit,
    sourceWorkspaceExportVersion: envelopeVersion as
      | typeof PRODUCT_CASE_WORKSPACE_EXPORT_VERSION
      | typeof PRODUCT_CASE_LEGACY_WORKSPACE_EXPORT_VERSION,
    currentOutputContractVersion: PRODUCT_CASE_OUTPUT_CONTRACT_VERSION,
    safety: PRODUCT_CASE_ZERO_EFFECTS,
  }
}

export function serializeProductCaseExport(output: ProductCaseRunnerOutput) {
  return JSON.stringify(output, null, 2)
}
