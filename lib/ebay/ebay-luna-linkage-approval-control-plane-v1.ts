import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"

import { getSellerOsAdminOriginBindingV1 } from
  "../admin-session-origin-v1"

export const SELLER_OS_LUNA_LINKAGE_APPROVAL_CONTROL_PLANE_VERSION =
  "SELLER_OS_LUNA_LINKAGE_APPROVAL_CONTROL_PLANE_V1" as const
export const SELLER_OS_LUNA_LINKAGE_REVIEW_VERSION =
  "SELLER_OS_LUNA_LINKAGE_REVIEW_V2" as const
export const SELLER_OS_LUNA_LINKAGE_DECISION_VERSION =
  "SELLER_OS_LUNA_LINKAGE_DECISION_V1" as const
export const SELLER_OS_LUNA_LINKAGE_APPROVAL_CSRF_TTL_MS =
  10 * 60 * 1_000
export const SELLER_OS_LUNA_LINKAGE_IDENTITY_EVIDENCE_MAXIMUM_AGE_SECONDS =
  21_600

const MARKETPLACE_ID = "EBAY_US" as const
const MAXIMUM_REVIEW_ENTRIES = 50
const MAXIMUM_EVIDENCE_CLOCK_SKEW_MS = 5 * 60 * 1_000
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DIGEST = /^sha256:[0-9a-f]{64}$/
const CSRF_TOKEN = /^lc1\.[A-Za-z0-9_-]{43}$/
const INSTANCE_ID = /^[A-Za-z0-9_-]{22}$/
const SAFE_COHORT = /^[A-Za-z0-9_.:-]{8,240}$/
const SAFE_REFERENCE = /^[A-Za-z0-9_.:\/-]{1,240}$/
const SAFE_CODE = /^[A-Z0-9_]{3,120}$/
const LUNA_EXTERNAL_IDENTITY = /^\d{1,30}$/
const LUNA_IDENTITY_EVIDENCE_REFERENCE =
  /^luna-identity-v1:sha256:[0-9a-f]{64}$/
const REQUEST_KEYS = Object.freeze([
  "candidateEvidenceDigest",
  "currentCohortId",
  "decision",
  "decisionVersion",
  "ebayItemId",
  "reviewSetId",
] as const)

export type SellerOsLunaLinkageOperatorDecisionV1 =
  | "APPROVE_EXACT_LINKAGE"
  | "REJECT_CANDIDATE"
  | "KEEP_UNPROVEN"

export type SellerOsLunaLinkageReviewClassificationV2 =
  | "EXACT_UNIQUE_MATCH"
  | "AMBIGUOUS_MATCH"
  | "CONFLICTING_MATCH"
  | "NO_MATCH"
  | "BUNDLE_INCOMPLETE"
  | "IDENTITY_EVIDENCE_INCOMPLETE"

export type SellerOsLunaLinkageModeV1 =
  | "SINGLE_COMPONENT"
  | "SIMPLE_MULTIPLIER"
  | "MULTI_COMPONENT_BOM"
  | "UNRESOLVED"

export type SellerOsLunaLinkageQuantityBasisV1 =
  | "STRUCTURED_EVIDENCE"
  | "HUMAN_CONFIRMATION_REQUIRED"
  | "TITLE_ONLY"
  | "UNPROVEN"

export type SellerOsLunaIdentityEvidenceProvenanceV1 = Readonly<{
  contractVersion: "SELLER_OS_LUNA_IDENTITY_VERIFICATION_V1"
  sourceStatus: "AVAILABLE" | "UNAVAILABLE"
  acquisitionMethod: "CANONICAL_SERVER_READ_IDENTITY_ONLY" | "NONE"
}>

export type SellerOsLunaLinkageReviewComponentInputV2 = Readonly<{
  lunaProductId: string
  lunaVariantId: string
  lunaSku: string
  productTitle: string | null
  variantTitle: string | null
  supplierQuantityRequired: number
  quantityBasis: SellerOsLunaLinkageQuantityBasisV1
  variantPresence: "PRESENT" | "MISSING" | "UNPROVEN"
  exactProductIdentity: boolean
  exactVariantIdentity: boolean
  exactSupplierSku: boolean
  structuredVariantAttributesComplete: boolean
  identityConflict: boolean
}>

export type SellerOsLunaLinkageReviewEntryInputV2 = Readonly<{
  currentCohortId: string
  accountKey: string
  ebayItemId: string
  ebaySku: string | null
  listingTitle: string | null
  classification: SellerOsLunaLinkageReviewClassificationV2
  linkageMode: SellerOsLunaLinkageModeV1
  components: readonly SellerOsLunaLinkageReviewComponentInputV2[]
  matchSignals: readonly string[]
  conflictSignals: readonly string[]
  evidenceReferences: readonly string[]
  evidenceObservedAt: string
  reviewObservedAt: string
  identityEvidenceProvenance: SellerOsLunaIdentityEvidenceProvenanceV1
  decisionVersion: number
}>

type NormalizedComponent = Readonly<{
  lunaProductId: string
  lunaVariantId: string
  lunaSku: string
  productTitle: string | null
  variantTitle: string | null
  supplierQuantityRequired: number
  quantityBasis: SellerOsLunaLinkageQuantityBasisV1
  variantPresence: "PRESENT" | "MISSING" | "UNPROVEN"
  exactProductIdentity: boolean
  exactVariantIdentity: boolean
  exactSupplierSku: boolean
  structuredVariantAttributesComplete: boolean
  identityConflict: boolean
}>

export type SellerOsLunaLinkageReviewEntryV2 = Readonly<{
  contractVersion: typeof SELLER_OS_LUNA_LINKAGE_REVIEW_VERSION
  reviewCandidateId: string
  currentCohortId: string
  accountBinding: "CANONICAL_SELLER_ACCOUNT"
  ebayItemId: string
  ebaySku: string | null
  listingTitle: string | null
  classification: SellerOsLunaLinkageReviewClassificationV2
  linkageMode: SellerOsLunaLinkageModeV1
  linkageId: string | null
  components: readonly NormalizedComponent[]
  supplierQuantityRequired: number | null
  matchSignals: readonly string[]
  conflictSignals: readonly string[]
  evidenceReferences: readonly string[]
  evidenceObservedAt: string
  reviewObservedAt: string
  evidenceMaximumAgeSeconds:
    typeof SELLER_OS_LUNA_LINKAGE_IDENTITY_EVIDENCE_MAXIMUM_AGE_SECONDS
  identityEvidenceProvenance: SellerOsLunaIdentityEvidenceProvenanceV1
  evidenceDigest: string
  evidenceFreshness: "CURRENT" | "STALE"
  decisionVersion: number
  allowedOperatorDecisions:
    readonly SellerOsLunaLinkageOperatorDecisionV1[]
  recommendedSafeDecision: "KEEP_UNPROVEN"
  approvalEligibility: Readonly<{
    eligible: boolean
    reasonCodes: readonly string[]
    exactProductVariantRequired: true
    titleOnlyCanApprove: false
    allBomComponentsRequired: true
  }>
  stockCertification: Readonly<{
    status: "NOT_EVALUATED"
    stockEvidenceUsedForIdentity: false
    automaticPauseAllowed: false
  }>
}>

export type SellerOsLunaLinkageReviewSetV2 = Readonly<{
  contractVersion: typeof SELLER_OS_LUNA_LINKAGE_REVIEW_VERSION
  reviewSetId: string
  currentCohortId: string
  accountKey: string
  marketplaceId: typeof MARKETPLACE_ID
  currentLiveCount: number
  entries: readonly SellerOsLunaLinkageReviewEntryV2[]
  reviewSetDigest: string
  bounded: true
  maximumEntries: typeof MAXIMUM_REVIEW_ENTRIES
  safety: Readonly<{
    humanApprovalRequired: true
    automaticCertificationEnabled: false
    stockEvaluated: false
    marketplaceWrites: 0
  }>
}>

export type SellerOsLunaLinkageApprovalRequestV1 = Readonly<{
  reviewSetId: string
  currentCohortId: string
  ebayItemId: string
  candidateEvidenceDigest: string
  decision: SellerOsLunaLinkageOperatorDecisionV1
  decisionVersion: number
}>

export type SellerOsLunaLinkageDurableDecisionInputV1 = Readonly<{
  contractVersion: typeof SELLER_OS_LUNA_LINKAGE_DECISION_VERSION
  reviewCandidateId: string
  reviewSetId: string
  actorUserId: string
  accountKey: string
  marketplaceId: typeof MARKETPLACE_ID
  currentCohortId: string
  ebayItemId: string
  ebaySku: string | null
  listingTitle: string | null
  linkageId: string | null
  lunaProductId: string | null
  lunaVariantId: string | null
  lunaSku: string | null
  components: readonly NormalizedComponent[]
  supplierQuantityRequired: number | null
  evidenceReferences: readonly string[]
  evidenceDigest: string
  evidenceObservedAt: string
  reviewObservedAt: string
  evidenceMaximumAgeSeconds:
    typeof SELLER_OS_LUNA_LINKAGE_IDENTITY_EVIDENCE_MAXIMUM_AGE_SECONDS
  evidenceFreshness: "CURRENT"
  identityEvidenceProvenance: SellerOsLunaIdentityEvidenceProvenanceV1
  provenance: Readonly<{
    authorityClass: "HUMAN_DECISION"
    identityEvidenceClass: "SUPPLIER_CURRENT_IDENTITY"
    stockEvidenceUsed: false
    identityEvidenceProvenance: SellerOsLunaIdentityEvidenceProvenanceV1
  }>
  decision: SellerOsLunaLinkageOperatorDecisionV1
  decisionVersion: number
  decisionAt: string
  decisionReference: string
  decisionPayloadDigest: string
}>

export type SellerOsLunaLinkageDurableDecisionReceiptV1 = Readonly<{
  outcome:
    | "CREATED"
    | "IDEMPOTENT_SUCCESS"
    | "CONFLICT_REQUIRES_NEW_DECISION_VERSION"
  decisionReference: string
}>

export class SellerOsLunaLinkageApprovalControlPlaneError extends Error {
  readonly code: string

  constructor(code: string) {
    const safe = SAFE_CODE.test(code)
      ? code : "LUNA_LINKAGE_APPROVAL_FAILED_CLOSED"
    super(safe)
    this.name = "SellerOsLunaLinkageApprovalControlPlaneError"
    this.code = safe
  }
}

function fail(code: string): never {
  throw new SellerOsLunaLinkageApprovalControlPlaneError(code)
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value), "utf8").digest("hex")}`
}

function stableIdentity(prefix: string, value: unknown) {
  return `${prefix}:${sha256(value)}`
}

function equalText(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8")
  const rightBytes = Buffer.from(right, "utf8")
  return leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
}

function text(value: unknown, maximum: number) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim()
  return normalized && normalized.length <= maximum ? normalized : null
}

function timestamp(value: unknown) {
  const normalized = text(value, 50)
  return normalized && Number.isFinite(Date.parse(normalized))
    ? new Date(normalized).toISOString() : null
}

function safeCodes(values: readonly string[], maximum = 32) {
  if (!Array.isArray(values) || values.length > maximum) {
    fail("LUNA_LINKAGE_REVIEW_EVIDENCE_INVALID")
  }
  const normalized = values.map((value) => text(value, 120))
  if (normalized.some((value) => !value || !SAFE_CODE.test(value))) {
    fail("LUNA_LINKAGE_REVIEW_EVIDENCE_INVALID")
  }
  return Object.freeze([...new Set(normalized as string[])].sort())
}

function safeReferences(values: readonly string[], maximum = 64) {
  if (!Array.isArray(values) || values.length > maximum) {
    fail("LUNA_LINKAGE_REVIEW_EVIDENCE_INVALID")
  }
  const normalized = values.map((value) => text(value, 240))
  if (normalized.some((value) => !value || !SAFE_REFERENCE.test(value))) {
    fail("LUNA_LINKAGE_REVIEW_EVIDENCE_INVALID")
  }
  return Object.freeze([...new Set(normalized as string[])].sort())
}

function normalizeComponent(
  value: SellerOsLunaLinkageReviewComponentInputV2,
) : NormalizedComponent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("LUNA_LINKAGE_REVIEW_COMPONENT_INVALID")
  }
  const productId = text(value.lunaProductId, 100)
  const variantId = text(value.lunaVariantId, 100)
  const sku = text(value.lunaSku, 120)
  const productTitle = value.productTitle === null
    ? null : text(value.productTitle, 240)
  const variantTitle = value.variantTitle === null
    ? null : text(value.variantTitle, 160)
  const quantity = value.supplierQuantityRequired
  if (!productId || !variantId || !sku ||
      !LUNA_EXTERNAL_IDENTITY.test(productId) ||
      !LUNA_EXTERNAL_IDENTITY.test(variantId) ||
      (value.productTitle !== null && !productTitle) ||
      (value.variantTitle !== null && !variantTitle) ||
      !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10_000 ||
      !new Set<SellerOsLunaLinkageQuantityBasisV1>([
        "STRUCTURED_EVIDENCE", "HUMAN_CONFIRMATION_REQUIRED",
        "TITLE_ONLY", "UNPROVEN",
      ]).has(value.quantityBasis) ||
      !new Set(["PRESENT", "MISSING", "UNPROVEN"])
        .has(value.variantPresence) ||
      [value.exactProductIdentity, value.exactVariantIdentity,
        value.exactSupplierSku, value.structuredVariantAttributesComplete,
        value.identityConflict].some((flag) => typeof flag !== "boolean")) {
    fail("LUNA_LINKAGE_REVIEW_COMPONENT_INVALID")
  }
  return Object.freeze({
    lunaProductId: productId,
    lunaVariantId: variantId,
    lunaSku: sku,
    productTitle,
    variantTitle,
    supplierQuantityRequired: quantity,
    quantityBasis: value.quantityBasis,
    variantPresence: value.variantPresence,
    exactProductIdentity: value.exactProductIdentity,
    exactVariantIdentity: value.exactVariantIdentity,
    exactSupplierSku: value.exactSupplierSku,
    structuredVariantAttributesComplete:
      value.structuredVariantAttributesComplete,
    identityConflict: value.identityConflict,
  })
}

function normalizeIdentityEvidenceProvenance(
  value: SellerOsLunaIdentityEvidenceProvenanceV1,
): SellerOsLunaIdentityEvidenceProvenanceV1 {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== [
        "acquisitionMethod", "contractVersion", "sourceStatus",
      ].sort().join(",") ||
      value.contractVersion !== "SELLER_OS_LUNA_IDENTITY_VERIFICATION_V1" ||
      !new Set(["AVAILABLE", "UNAVAILABLE"]).has(value.sourceStatus) ||
      !new Set(["CANONICAL_SERVER_READ_IDENTITY_ONLY", "NONE"])
        .has(value.acquisitionMethod) || !(
        (value.sourceStatus === "AVAILABLE" && value.acquisitionMethod ===
          "CANONICAL_SERVER_READ_IDENTITY_ONLY") ||
        (value.sourceStatus === "UNAVAILABLE" && value.acquisitionMethod ===
          "NONE")
      )) {
    fail("LUNA_LINKAGE_REVIEW_IDENTITY_PROVENANCE_INVALID")
  }
  return Object.freeze({
    contractVersion: value.contractVersion,
    sourceStatus: value.sourceStatus,
    acquisitionMethod: value.acquisitionMethod,
  })
}

function identityEvidenceFreshness(
  evidenceObservedAt: string,
  reviewObservedAt: string,
) {
  const ageMilliseconds = Date.parse(reviewObservedAt) -
    Date.parse(evidenceObservedAt)
  if (ageMilliseconds < -MAXIMUM_EVIDENCE_CLOCK_SKEW_MS) {
    fail("LUNA_LINKAGE_REVIEW_EVIDENCE_FUTURE_REJECTED")
  }
  return ageMilliseconds <=
    SELLER_OS_LUNA_LINKAGE_IDENTITY_EVIDENCE_MAXIMUM_AGE_SECONDS * 1_000
    ? "CURRENT" as const : "STALE" as const
}

function assertIdentityEvidenceCurrentAtDecision(
  evidenceObservedAt: string,
  decisionAt: string,
) {
  const ageMilliseconds = Date.parse(decisionAt) -
    Date.parse(evidenceObservedAt)
  if (ageMilliseconds < -MAXIMUM_EVIDENCE_CLOCK_SKEW_MS) {
    fail("LUNA_LINKAGE_APPROVAL_CLOCK_INVALID")
  }
  if (ageMilliseconds >
      SELLER_OS_LUNA_LINKAGE_IDENTITY_EVIDENCE_MAXIMUM_AGE_SECONDS * 1_000) {
    fail("LUNA_LINKAGE_APPROVAL_STALE_REVIEW_REJECTED")
  }
}

function componentIdentity(component: NormalizedComponent) {
  return JSON.stringify([
    component.lunaProductId,
    component.lunaVariantId,
    component.lunaSku,
    component.supplierQuantityRequired,
  ])
}

function approvalEligibility(input: Readonly<{
  classification: SellerOsLunaLinkageReviewClassificationV2
  linkageMode: SellerOsLunaLinkageModeV1
  components: readonly NormalizedComponent[]
  conflictSignals: readonly string[]
  evidenceReferences: readonly string[]
  evidenceFreshness: "CURRENT" | "STALE"
  identityEvidenceProvenance: SellerOsLunaIdentityEvidenceProvenanceV1
}>) {
  const reasons: string[] = []
  if (input.classification !== "EXACT_UNIQUE_MATCH") {
    reasons.push("EXACT_UNIQUE_MATCH_REQUIRED")
  }
  if (!input.components.length) reasons.push("LUNA_COMPONENT_REQUIRED")
  if (input.conflictSignals.length) reasons.push("CONFLICT_SIGNALS_PRESENT")
  if (input.evidenceFreshness !== "CURRENT") {
    reasons.push("CURRENT_LUNA_IDENTITY_EVIDENCE_REQUIRED")
  }
  if (input.identityEvidenceProvenance.contractVersion !==
      "SELLER_OS_LUNA_IDENTITY_VERIFICATION_V1" ||
      input.identityEvidenceProvenance.sourceStatus !== "AVAILABLE" ||
      input.identityEvidenceProvenance.acquisitionMethod !==
        "CANONICAL_SERVER_READ_IDENTITY_ONLY") {
    reasons.push("CANONICAL_LUNA_IDENTITY_PROVENANCE_REQUIRED")
  }
  if (!input.evidenceReferences.some((reference) =>
    LUNA_IDENTITY_EVIDENCE_REFERENCE.test(reference))) {
    reasons.push("CURRENT_LUNA_IDENTITY_REFERENCE_REQUIRED")
  }
  if (input.linkageMode === "UNRESOLVED" && input.components.length !== 0) {
    reasons.push("UNRESOLVED_COMPONENT_GRAIN_INVALID")
  }
  if (input.linkageMode === "SINGLE_COMPONENT" &&
      (input.components.length !== 1 ||
       input.components[0]?.supplierQuantityRequired !== 1)) {
    reasons.push("SINGLE_COMPONENT_GRAIN_INVALID")
  }
  if (input.linkageMode === "SIMPLE_MULTIPLIER" &&
      (input.components.length !== 1 ||
       (input.components[0]?.supplierQuantityRequired ?? 0) <= 1)) {
    reasons.push("SIMPLE_MULTIPLIER_GRAIN_INVALID")
  }
  if (input.linkageMode === "MULTI_COMPONENT_BOM" &&
      input.components.length < 2) {
    reasons.push("MULTI_COMPONENT_BOM_INCOMPLETE")
  }
  if (new Set(input.components.map(componentIdentity)).size !==
      input.components.length) {
    reasons.push("DUPLICATE_BOM_COMPONENT")
  }
  for (const component of input.components) {
    if (component.variantPresence !== "PRESENT") {
      reasons.push("CURRENT_LUNA_VARIANT_REQUIRED")
    }
    if (!component.exactProductIdentity || !component.exactVariantIdentity ||
        !component.exactSupplierSku ||
        !component.structuredVariantAttributesComplete) {
      reasons.push("EXACT_PRODUCT_VARIANT_EVIDENCE_REQUIRED")
    }
    if (component.identityConflict) reasons.push("IDENTITY_CONFLICT_PRESENT")
    if (["TITLE_ONLY", "UNPROVEN"].includes(component.quantityBasis)) {
      reasons.push("SUPPLIER_QUANTITY_PROOF_REQUIRED")
    }
  }
  return Object.freeze({
    eligible: reasons.length === 0,
    reasonCodes: Object.freeze([...new Set(reasons)].sort()),
    exactProductVariantRequired: true as const,
    titleOnlyCanApprove: false as const,
    allBomComponentsRequired: true as const,
  })
}

export function buildSellerOsLunaLinkageReviewEntryV2(
  input: SellerOsLunaLinkageReviewEntryInputV2,
) : SellerOsLunaLinkageReviewEntryV2 {
  const cohort = text(input.currentCohortId, 240)
  const accountKey = text(input.accountKey, 200)
  const itemId = text(input.ebayItemId, 20)
  const sku = input.ebaySku === null ? null : text(input.ebaySku, 160)
  const title = input.listingTitle === null
    ? null : text(input.listingTitle, 350)
  const observedAt = timestamp(input.evidenceObservedAt)
  const reviewObservedAt = timestamp(input.reviewObservedAt)
  if (!cohort || !SAFE_COHORT.test(cohort) || !accountKey ||
      !itemId || !/^\d{9,19}$/.test(itemId) ||
      (input.ebaySku !== null && !sku) ||
      (input.listingTitle !== null && !title) || !observedAt ||
      !reviewObservedAt ||
      !Number.isSafeInteger(input.decisionVersion) ||
      input.decisionVersion < 1 || input.decisionVersion > 1_000_000 ||
      !new Set<SellerOsLunaLinkageReviewClassificationV2>([
        "EXACT_UNIQUE_MATCH", "AMBIGUOUS_MATCH", "CONFLICTING_MATCH",
        "NO_MATCH", "BUNDLE_INCOMPLETE", "IDENTITY_EVIDENCE_INCOMPLETE",
      ]).has(input.classification) ||
      !new Set<SellerOsLunaLinkageModeV1>([
        "SINGLE_COMPONENT", "SIMPLE_MULTIPLIER", "MULTI_COMPONENT_BOM",
        "UNRESOLVED",
      ]).has(input.linkageMode) || !Array.isArray(input.components) ||
      input.components.length > 24) {
    fail("LUNA_LINKAGE_REVIEW_INPUT_INVALID")
  }
  const components = Object.freeze(input.components.map(normalizeComponent)
    .sort((left, right) => componentIdentity(left)
      .localeCompare(componentIdentity(right))))
  const matchSignals = safeCodes(input.matchSignals)
  const conflictSignals = safeCodes(input.conflictSignals)
  const evidenceReferences = safeReferences(input.evidenceReferences)
  const identityEvidenceProvenance = normalizeIdentityEvidenceProvenance(
    input.identityEvidenceProvenance,
  )
  const evidenceFreshness = identityEvidenceFreshness(
    observedAt,
    reviewObservedAt,
  )
  const eligibility = approvalEligibility({
    classification: input.classification,
    linkageMode: input.linkageMode,
    components,
    conflictSignals,
    evidenceReferences,
    evidenceFreshness,
    identityEvidenceProvenance,
  })
  const linkageId = components.length && components.every((component) =>
    component.lunaProductId && component.lunaVariantId && component.lunaSku)
    ? stableIdentity("luna-linkage-v1", [
        accountKey, MARKETPLACE_ID, itemId,
        components.map((component) => [
          component.lunaProductId, component.lunaVariantId,
          component.lunaSku, component.supplierQuantityRequired,
        ]),
        "SELLER_OS_LUNA_SUPPLIER_LINKAGE_STATUS_V1",
      ])
    : null
  const supplierQuantityRequired = components.length === 1
    ? components[0].supplierQuantityRequired : null
  const digestSubject = {
    contractVersion: SELLER_OS_LUNA_LINKAGE_REVIEW_VERSION,
    currentCohortId: cohort,
    accountKey,
    marketplaceId: MARKETPLACE_ID,
    ebayItemId: itemId,
    ebaySku: sku,
    listingTitle: title,
    classification: input.classification,
    linkageMode: input.linkageMode,
    components,
    matchSignals,
    conflictSignals,
    evidenceReferences,
    evidenceObservedAt: observedAt,
    reviewObservedAt,
    evidenceMaximumAgeSeconds:
      SELLER_OS_LUNA_LINKAGE_IDENTITY_EVIDENCE_MAXIMUM_AGE_SECONDS,
    identityEvidenceProvenance,
    evidenceFreshness,
    decisionVersion: input.decisionVersion,
  }
  const allowed = [
    ...(eligibility.eligible ? ["APPROVE_EXACT_LINKAGE" as const] : []),
    ...(components.length ? ["REJECT_CANDIDATE" as const] : []),
    "KEEP_UNPROVEN" as const,
  ]
  const evidenceDigest = sha256(digestSubject)
  const reviewCandidateId = stableIdentity(
    "luna-linkage-review-candidate-v1",
    [accountKey, MARKETPLACE_ID, cohort, itemId, evidenceDigest],
  )
  return Object.freeze({
    contractVersion: SELLER_OS_LUNA_LINKAGE_REVIEW_VERSION,
    reviewCandidateId,
    currentCohortId: cohort,
    accountBinding: "CANONICAL_SELLER_ACCOUNT" as const,
    ebayItemId: itemId,
    ebaySku: sku,
    listingTitle: title,
    classification: input.classification,
    linkageMode: input.linkageMode,
    linkageId,
    components,
    supplierQuantityRequired,
    matchSignals,
    conflictSignals,
    evidenceReferences,
    evidenceObservedAt: observedAt,
    reviewObservedAt,
    evidenceMaximumAgeSeconds:
      SELLER_OS_LUNA_LINKAGE_IDENTITY_EVIDENCE_MAXIMUM_AGE_SECONDS,
    identityEvidenceProvenance,
    evidenceDigest,
    evidenceFreshness,
    decisionVersion: input.decisionVersion,
    allowedOperatorDecisions: Object.freeze(allowed),
    recommendedSafeDecision: "KEEP_UNPROVEN" as const,
    approvalEligibility: eligibility,
    stockCertification: Object.freeze({
      status: "NOT_EVALUATED" as const,
      stockEvidenceUsedForIdentity: false as const,
      automaticPauseAllowed: false as const,
    }),
  })
}

export function buildSellerOsLunaLinkageReviewSetV2(input: Readonly<{
  currentCohortId: string
  accountKey: string
  currentLiveCount: number
  entries: readonly SellerOsLunaLinkageReviewEntryV2[]
}>) : SellerOsLunaLinkageReviewSetV2 {
  const cohort = text(input.currentCohortId, 240)
  const accountKey = text(input.accountKey, 200)
  if (!cohort || !SAFE_COHORT.test(cohort) || !accountKey ||
      !Number.isSafeInteger(input.currentLiveCount) ||
      input.currentLiveCount < 0 ||
      input.currentLiveCount > MAXIMUM_REVIEW_ENTRIES ||
      !Array.isArray(input.entries) ||
      input.entries.length !== input.currentLiveCount ||
      input.entries.some((entry) => entry.currentCohortId !== cohort) ||
      new Set(input.entries.map((entry) => entry.ebayItemId)).size !==
        input.entries.length) {
    fail("LUNA_LINKAGE_REVIEW_SET_INVALID")
  }
  const sortedEntries = Object.freeze([...input.entries]
    .sort((left, right) => left.ebayItemId.localeCompare(right.ebayItemId)))
  const reviewSetDigest = sha256({
    contractVersion: SELLER_OS_LUNA_LINKAGE_REVIEW_VERSION,
    currentCohortId: cohort,
    accountKey,
    marketplaceId: MARKETPLACE_ID,
    currentLiveCount: input.currentLiveCount,
    entries: sortedEntries.map((entry) => [
      entry.ebayItemId, entry.evidenceDigest, entry.decisionVersion,
    ]),
  })
  const reviewSetId = stableIdentity("luna-linkage-review-set-v1", [
    cohort, accountKey, MARKETPLACE_ID, reviewSetDigest,
  ])
  const entries = Object.freeze(sortedEntries.map((entry) => Object.freeze({
    ...entry,
    reviewCandidateId: stableIdentity(
      "luna-linkage-review-candidate-v1",
      [reviewSetId, entry.ebayItemId, entry.evidenceDigest],
    ),
  })))
  return Object.freeze({
    contractVersion: SELLER_OS_LUNA_LINKAGE_REVIEW_VERSION,
    reviewSetId,
    currentCohortId: cohort,
    accountKey,
    marketplaceId: MARKETPLACE_ID,
    currentLiveCount: input.currentLiveCount,
    entries,
    reviewSetDigest,
    bounded: true as const,
    maximumEntries: MAXIMUM_REVIEW_ENTRIES,
    safety: Object.freeze({
      humanApprovalRequired: true as const,
      automaticCertificationEnabled: false as const,
      stockEvaluated: false as const,
      marketplaceWrites: 0 as const,
    }),
  })
}

export function parseSellerOsLunaLinkageApprovalRequestV1(
  value: unknown,
) : SellerOsLunaLinkageApprovalRequestV1 {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail("LUNA_LINKAGE_APPROVAL_CALLER_INPUT_REJECTED")
  }
  const input = value as Record<string, unknown>
  if (Object.keys(input).sort().join(",") !== [...REQUEST_KEYS].sort()
    .join(",")) {
    fail("LUNA_LINKAGE_APPROVAL_CALLER_INPUT_REJECTED")
  }
  const currentCohortId = text(input.currentCohortId, 240)
  const reviewSetId = text(input.reviewSetId, 110)
  const ebayItemId = text(input.ebayItemId, 20)
  const candidateEvidenceDigest = text(input.candidateEvidenceDigest, 71)
  const decision = input.decision
  const decisionVersion = input.decisionVersion
  if (!reviewSetId ||
      !/^luna-linkage-review-set-v1:sha256:[0-9a-f]{64}$/.test(reviewSetId) ||
      !currentCohortId || !SAFE_COHORT.test(currentCohortId) ||
      !ebayItemId || !/^\d{9,19}$/.test(ebayItemId) ||
      !candidateEvidenceDigest || !DIGEST.test(candidateEvidenceDigest) ||
      !new Set<SellerOsLunaLinkageOperatorDecisionV1>([
        "APPROVE_EXACT_LINKAGE", "REJECT_CANDIDATE", "KEEP_UNPROVEN",
      ]).has(decision as SellerOsLunaLinkageOperatorDecisionV1) ||
      !Number.isSafeInteger(decisionVersion) || Number(decisionVersion) < 1 ||
      Number(decisionVersion) > 1_000_000) {
    fail("LUNA_LINKAGE_APPROVAL_CALLER_INPUT_REJECTED")
  }
  return Object.freeze({
    reviewSetId,
    currentCohortId,
    ebayItemId,
    candidateEvidenceDigest,
    decision: decision as SellerOsLunaLinkageOperatorDecisionV1,
    decisionVersion: Number(decisionVersion),
  })
}

export function assertSellerOsLunaLinkageApprovalAdminV1(
  validation: Readonly<{
    ok: boolean
    userId?: string | null
    authenticationMode?: string | null
  }>,
) {
  if (!validation.ok || validation.authenticationMode !== "admin_user" ||
      !validation.userId || !UUID.test(validation.userId)) {
    fail("LUNA_LINKAGE_APPROVAL_ADMIN_USER_REQUIRED")
  }
  return validation.userId
}

type CsrfContext = Readonly<{
  actorUserId: string
  adminSessionToken: string
  requestUrl: string
  origin: string | null
  secFetchSite: string | null
  currentCohortId: string
  reviewSetDigest: string
}>

type CsrfRecord = {
  token: string
  tokenDigest: string
  subjectDigest: string
  expiresAt: number
}

const VERIFIED_CSRF = Symbol("SELLER_OS_LUNA_LINKAGE_APPROVAL_CSRF")

export type SellerOsLunaLinkageApprovalCsrfReceiptV1 = Readonly<{
  actorUserId: string
  currentCohortId: string
  reviewSetDigest: string
  instanceId: string
  [VERIFIED_CSRF]: true
}>

function csrfSubject(input: CsrfContext, instanceId: string,
  requireOrigin: boolean) {
  if (!UUID.test(input.actorUserId) ||
      input.adminSessionToken.length < 32 ||
      input.adminSessionToken.length > 16_384 ||
      !INSTANCE_ID.test(instanceId) ||
      !SAFE_COHORT.test(input.currentCohortId) ||
      !DIGEST.test(input.reviewSetDigest)) {
    fail("LUNA_LINKAGE_APPROVAL_CSRF_REJECTED")
  }
  const originBinding = getSellerOsAdminOriginBindingV1({
    requestUrl: input.requestUrl,
    origin: input.origin,
    secFetchSite: input.secFetchSite,
    requireOrigin,
  })
  if (!originBinding) fail("LUNA_LINKAGE_APPROVAL_CSRF_REJECTED")
  return sha256([
    SELLER_OS_LUNA_LINKAGE_APPROVAL_CONTROL_PLANE_VERSION,
    input.actorUserId,
    sha256(["admin-session", input.adminSessionToken]),
    instanceId,
    originBinding,
    input.currentCohortId,
    input.reviewSetDigest,
  ])
}

export function createSellerOsLunaLinkageApprovalCsrfBoundaryV1(
  options: Readonly<{
    now?: () => number
    random?: (bytes: number) => Buffer
  }> = {},
) {
  const now = options.now ?? Date.now
  const random = options.random ?? randomBytes
  const instanceId = random(16).toString("base64url")
  if (!INSTANCE_ID.test(instanceId)) {
    fail("LUNA_LINKAGE_APPROVAL_CSRF_ENTROPY_UNAVAILABLE")
  }
  const records = new Map<string, CsrfRecord>()
  const consumed = new Map<string, number>()

  function clean(at: number) {
    for (const [digest, record] of records) {
      if (record.expiresAt <= at) records.delete(digest)
    }
    for (const [digest, expiresAt] of consumed) {
      if (expiresAt <= at) consumed.delete(digest)
    }
  }

  function issue(input: CsrfContext) {
    const at = now()
    clean(at)
    const subjectDigest = csrfSubject(input, instanceId, false)
    const existing = [...records.values()].find((record) =>
      record.subjectDigest === subjectDigest && record.expiresAt > at)
    if (existing) return Object.freeze({
      csrfToken: existing.token,
      expiresAt: new Date(existing.expiresAt).toISOString(),
      singleUse: true as const,
      adminSessionBound: true as const,
      originBound: true as const,
      cohortBound: true as const,
      reviewSetBound: true as const,
      instanceBound: true as const,
    })
    const token = `lc1.${random(32).toString("base64url")}`
    if (!CSRF_TOKEN.test(token)) {
      fail("LUNA_LINKAGE_APPROVAL_CSRF_ENTROPY_UNAVAILABLE")
    }
    const tokenDigest = sha256(["csrf-token", token])
    const record: CsrfRecord = {
      token,
      tokenDigest,
      subjectDigest,
      expiresAt: at + SELLER_OS_LUNA_LINKAGE_APPROVAL_CSRF_TTL_MS,
    }
    records.set(tokenDigest, record)
    return Object.freeze({
      csrfToken: token,
      expiresAt: new Date(record.expiresAt).toISOString(),
      singleUse: true as const,
      adminSessionBound: true as const,
      originBound: true as const,
      cohortBound: true as const,
      reviewSetBound: true as const,
      instanceBound: true as const,
    })
  }

  function consume(input: CsrfContext & Readonly<{
    contentType: string | null
    csrfHeader: string | null
    csrfCookie: string | null
  }>) : SellerOsLunaLinkageApprovalCsrfReceiptV1 {
    if (input.contentType?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/json") {
      fail("LUNA_LINKAGE_APPROVAL_CSRF_REJECTED")
    }
    const subjectDigest = csrfSubject(input, instanceId, true)
    const header = input.csrfHeader ?? ""
    const cookie = input.csrfCookie ?? ""
    if (!CSRF_TOKEN.test(header) || !CSRF_TOKEN.test(cookie) ||
        !equalText(header, cookie)) {
      fail("LUNA_LINKAGE_APPROVAL_CSRF_REJECTED")
    }
    const tokenDigest = sha256(["csrf-token", header])
    const at = now()
    if (consumed.has(tokenDigest)) {
      fail("LUNA_LINKAGE_APPROVAL_CSRF_REUSED")
    }
    const record = records.get(tokenDigest)
    if (!record) fail("LUNA_LINKAGE_APPROVAL_CSRF_REJECTED")
    if (record.expiresAt <= at) {
      records.delete(tokenDigest)
      fail("LUNA_LINKAGE_APPROVAL_CSRF_EXPIRED")
    }
    if (!equalText(record.subjectDigest, subjectDigest)) {
      fail("LUNA_LINKAGE_APPROVAL_CSRF_SUBJECT_MISMATCH")
    }
    records.delete(tokenDigest)
    consumed.set(tokenDigest, record.expiresAt)
    return Object.freeze({
      actorUserId: input.actorUserId,
      currentCohortId: input.currentCohortId,
      reviewSetDigest: input.reviewSetDigest,
      instanceId,
      [VERIFIED_CSRF]: true as const,
    })
  }

  return Object.freeze({ instanceId, issue, consume })
}

function assertCsrfReceipt(
  receipt: SellerOsLunaLinkageApprovalCsrfReceiptV1,
  actorUserId: string,
  reviewSet: SellerOsLunaLinkageReviewSetV2,
) {
  if (!receipt || receipt[VERIFIED_CSRF] !== true ||
      receipt.actorUserId !== actorUserId ||
      receipt.currentCohortId !== reviewSet.currentCohortId ||
      receipt.reviewSetDigest !== reviewSet.reviewSetDigest) {
    fail("LUNA_LINKAGE_APPROVAL_CSRF_SUBJECT_MISMATCH")
  }
}

export async function executeSellerOsLunaLinkageApprovalDecisionV1(
  input: Readonly<{
    adminValidation: Readonly<{
      ok: boolean
      userId?: string | null
      authenticationMode?: string | null
    }>
    csrfReceipt: SellerOsLunaLinkageApprovalCsrfReceiptV1
    request: unknown
    currentReviewSet: SellerOsLunaLinkageReviewSetV2
    durableStore: (
      decision: SellerOsLunaLinkageDurableDecisionInputV1,
    ) => Promise<SellerOsLunaLinkageDurableDecisionReceiptV1>
    now?: () => string
  }>,
) {
  const actorUserId = assertSellerOsLunaLinkageApprovalAdminV1(
    input.adminValidation,
  )
  assertCsrfReceipt(input.csrfReceipt, actorUserId, input.currentReviewSet)
  const request = parseSellerOsLunaLinkageApprovalRequestV1(input.request)
  if (request.reviewSetId !== input.currentReviewSet.reviewSetId) {
    fail("LUNA_LINKAGE_APPROVAL_STALE_REVIEW_REJECTED")
  }
  if (request.currentCohortId !== input.currentReviewSet.currentCohortId) {
    fail("LUNA_LINKAGE_APPROVAL_STALE_COHORT_REJECTED")
  }
  const entry = input.currentReviewSet.entries.find((candidate) =>
    candidate.ebayItemId === request.ebayItemId)
  if (!entry) fail("LUNA_LINKAGE_APPROVAL_CURRENT_COHORT_ITEM_REQUIRED")
  if (entry.evidenceDigest !== request.candidateEvidenceDigest ||
      entry.decisionVersion !== request.decisionVersion) {
    fail("LUNA_LINKAGE_APPROVAL_STALE_REVIEW_REJECTED")
  }
  if (!entry.allowedOperatorDecisions.includes(request.decision)) {
    fail("LUNA_LINKAGE_APPROVAL_DECISION_NOT_ALLOWED")
  }
  if (request.decision === "APPROVE_EXACT_LINKAGE" &&
      !entry.approvalEligibility.eligible) {
    fail("LUNA_LINKAGE_APPROVAL_EXACT_EVIDENCE_REQUIRED")
  }
  const decisionReference = stableIdentity("luna-linkage-decision-v1", [
    input.currentReviewSet.accountKey,
    MARKETPLACE_ID,
    request.currentCohortId,
    request.ebayItemId,
    request.candidateEvidenceDigest,
    request.decision,
    request.decisionVersion,
  ])
  const decisionPayloadDigest = sha256({
    decisionReference,
    linkageId: entry.linkageId,
    components: entry.components,
    supplierQuantityRequired: entry.supplierQuantityRequired,
    evidenceReferences: entry.evidenceReferences,
    reviewObservedAt: entry.reviewObservedAt,
    evidenceMaximumAgeSeconds: entry.evidenceMaximumAgeSeconds,
    identityEvidenceProvenance: entry.identityEvidenceProvenance,
  })
  const decisionAtValue = input.now?.() ?? new Date().toISOString()
  const decisionAt = timestamp(decisionAtValue)
  if (!decisionAt) fail("LUNA_LINKAGE_APPROVAL_CLOCK_INVALID")
  if (entry.evidenceFreshness !== "CURRENT") {
    fail("LUNA_LINKAGE_APPROVAL_STALE_REVIEW_REJECTED")
  }
  assertIdentityEvidenceCurrentAtDecision(entry.evidenceObservedAt, decisionAt)
  const scalarComponent = entry.components.length === 1
    ? entry.components[0] : null
  const durableInput = Object.freeze({
    contractVersion: SELLER_OS_LUNA_LINKAGE_DECISION_VERSION,
    reviewCandidateId: entry.reviewCandidateId,
    reviewSetId: input.currentReviewSet.reviewSetId,
    actorUserId,
    accountKey: input.currentReviewSet.accountKey,
    marketplaceId: MARKETPLACE_ID,
    currentCohortId: request.currentCohortId,
    ebayItemId: entry.ebayItemId,
    ebaySku: entry.ebaySku,
    listingTitle: entry.listingTitle,
    linkageId: entry.linkageId,
    lunaProductId: scalarComponent?.lunaProductId ?? null,
    lunaVariantId: scalarComponent?.lunaVariantId ?? null,
    lunaSku: scalarComponent?.lunaSku ?? null,
    components: entry.components,
    supplierQuantityRequired: entry.supplierQuantityRequired,
    evidenceReferences: entry.evidenceReferences,
    evidenceDigest: entry.evidenceDigest,
    evidenceObservedAt: entry.evidenceObservedAt,
    reviewObservedAt: entry.reviewObservedAt,
    evidenceMaximumAgeSeconds: entry.evidenceMaximumAgeSeconds,
    evidenceFreshness: "CURRENT" as const,
    identityEvidenceProvenance: entry.identityEvidenceProvenance,
    provenance: Object.freeze({
      authorityClass: "HUMAN_DECISION" as const,
      identityEvidenceClass: "SUPPLIER_CURRENT_IDENTITY" as const,
      stockEvidenceUsed: false as const,
      identityEvidenceProvenance: entry.identityEvidenceProvenance,
    }),
    decision: request.decision,
    decisionVersion: request.decisionVersion,
    decisionAt,
    decisionReference,
    decisionPayloadDigest,
  })
  const receipt = await input.durableStore(durableInput)
  if (!receipt || !new Set([
    "CREATED", "IDEMPOTENT_SUCCESS",
    "CONFLICT_REQUIRES_NEW_DECISION_VERSION",
  ]).has(receipt.outcome) || receipt.decisionReference !== decisionReference) {
    fail("LUNA_LINKAGE_APPROVAL_DURABLE_RECEIPT_INVALID")
  }
  if (receipt.outcome === "CONFLICT_REQUIRES_NEW_DECISION_VERSION") {
    fail("LUNA_LINKAGE_APPROVAL_CONFLICT_REQUIRES_NEW_DECISION_VERSION")
  }
  return Object.freeze({
    status: receipt.outcome,
    decisionReference,
    decision: request.decision,
    decisionVersion: request.decisionVersion,
    idempotent: receipt.outcome === "IDEMPOTENT_SUCCESS",
    humanApprovalRecorded: request.decision === "APPROVE_EXACT_LINKAGE",
    safety: Object.freeze({
      automaticCertification: false as const,
      stockEvaluated: false as const,
      ebayWrites: 0 as const,
      marketplaceWrites: 0 as const,
    }),
  })
}
