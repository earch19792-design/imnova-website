import type { EbayLiveListing } from "./ebay-commercial-monitor-live-readonly-domain"
import type { ReadonlyRegistryListingRow } from "./commercial-monitor-readonly-repository"
import { stableReadonlyCommercialKey } from "./commercial-monitor-readonly-utilities.mjs"

export type EbayRegistryRepairDryRunCount = number | "UNPROVEN"
export type EbayRegistryRepairPreconditionStatus =
  | "PASS"
  | "FAIL"
  | "UNPROVEN"
type YesNoUnproven = "YES" | "NO" | "UNPROVEN"
export type EbayRegistryRepairDryRunFreshnessStatus =
  | "CURRENT"
  | "STALE"
  | "UNPROVEN"
export type EbayRegistryRepairDryRunRejectionReason =
  | "REGISTRY_SOURCE_UNAVAILABLE"
  | "LIVE_ENUMERATION_UNAVAILABLE"
  | "ACCOUNT_BINDING_FAILED"
  | "IDENTITY_PARTITION_INVALID"
  | "REGISTRY_PARTITION_INVALID"
  | "AMBIGUOUS_IDENTITY"
  | "PRECONDITION_UNPROVEN"
  | "STATE_CHANGED_DURING_SAME_REQUEST"
  | "RESPONSE_CONTRACT_INVALID"
  | "BUDGET_EXHAUSTED"
  | "UNPROVEN"
export type EbayRegistryRepairAmbiguityClass =
  | "REVIEWABLE_ONLY"
  | "BLOCKING_MULTIPLE_CANDIDATES"
  | "BLOCKING_CROSS_LINK"
  | "BLOCKING_DUPLICATE_AUTHORITY"
  | "BLOCKING_PARTITION_CONFLICT"
  | "BLOCKING_UNPROVEN"
  | "NONE"
export type EbayRegistryRepairUnprovenComponent =
  | "NONE"
  | "REPAIR_EXISTING_MUTATION_GUARD"
  | "MARK_STALE_MUTATION_GUARD"
  | "CREATE_NEW_MATERIALIZATION"
  | "CREATE_NEW_ABSENCE_OR_UNIQUENESS_GUARD"
  | "LIFECYCLE_PRECONDITION"
  | "HUMAN_REVIEW_EVIDENCE"
  | "IDENTITY_PARTITION"
  | "SAME_REQUEST_STATE"
  | "MULTIPLE_COMPONENTS"
  | "EVIDENCE_UNAVAILABLE"
export type EbayRegistryRepairUnprovenSource =
  | "NONE"
  | "EXISTING_ROW_CAS"
  | "CREATE_MATERIALIZATION"
  | "ABSENCE_OR_UNIQUENESS_GUARD"
  | "REVIEW_EVIDENCE"
  | "IDENTITY_EVIDENCE"
  | "SAME_REQUEST_STATE"
  | "MULTIPLE"
  | "EVIDENCE_UNAVAILABLE"
export type EbayRegistryRepairBlockingUnprovenSource =
  | "NONE"
  | "SOURCE_READ"
  | "STATE_GUARD"
  | "IDENTITY_PARTITION"
  | "REPAIR_EXISTING"
  | "MARK_STALE"
  | "CREATE_NEW"
  | "HUMAN_REVIEW"
  | "OTHER"
export type EbayRegistryRepairUnprovenPrimaryReason =
  | "NONE"
  | "MISSING_AUTHORITATIVE_ITEM_ID"
  | "DUPLICATE_ITEM_ID"
  | "MULTIPLE_REGISTRY_CANDIDATES"
  | "CROSS_LINK_CONFLICT"
  | "ACCOUNT_SCOPE"
  | "PARTITION_OVERLAP"
  | "SOURCE_EVIDENCE"
  | "OTHER"
export type EbayRegistryRepairOtherUnprovenSubtype =
  | "LISTING_IDENTITY_SHAPE"
  | "CREATE_PAYLOAD_REQUIREMENT"
  | "REGISTRY_ABSENCE_PROOF"
  | "LIFECYCLE_REQUIREMENT"
  | "NORMALIZATION_FAILURE"
  | "UNEXPECTED_CLASSIFIER_BRANCH"
export type EbayRegistryRepairAbsenceProofCause =
  | "NONE"
  | "ITEM_ID_ALREADY_PRESENT"
  | "ITEM_ID_LOOKUP_UNPROVEN"
  | "SKU_RELATION"
  | "SYNC_KEY_COLLISION"
  | "ACCOUNT_SCOPE"
  | "MULTIPLE_REGISTRY_ROWS"
  | "SECOND_READ_INCONSISTENCY"
  | "OTHER"
  | "UNPROVEN"
export type EbayRegistryRepairLifecycleAction =
  | "NONE"
  | "REPAIR_EXISTING"
  | "CREATE_NEW"
  | "MARK_STALE"
  | "HUMAN_REVIEW"
  | "REGISTRY_PARTITION"
  | "OTHER"
  | "UNPROVEN"
export type EbayRegistryRepairLifecycleStage =
  | "NONE"
  | "EXISTING_REGISTRY_ROW_ACTIVE_GUARD"
  | "UNPROVEN"
export type EbayRegistryRepairLifecycleRequiredSignal =
  | "NONE"
  | "LISTING_STATUS_ACTIVE"
  | "UNPROVEN"
export type EbayRegistryRepairLifecycleFailureCause =
  | "NONE"
  | "REGISTRY_ROW_NOT_ACTIVE"
  | "REGISTRY_LISTING_STATUS_UNAVAILABLE"
  | "REACTIVATION_NOT_ALLOWED"
  | "MULTIPLE_FAILURES"
  | "UNPROVEN"
export type EbayRegistryRepairRowStatusClass =
  | "ACTIVE"
  | "PAUSED"
  | "DRAFT"
  | "STALE"
  | "ENDED"
  | "HISTORICAL"
  | "UNKNOWN"
  | "OTHER"
  | "UNPROVEN"
export type EbayRegistryRepairFutureWriteRejectionReason =
  | "NONE"
  | "EVIDENCE_UNAVAILABLE"
  | "FUTURE_WRITE_EVIDENCE_STALE"

export type EbayRegistryRepairHumanReviewCandidate = {
  CANDIDATE_HANDLE: string
  RELATIONSHIP_TYPE: "SKU_ONLY" | "ITEM_ID_ONLY_LIFECYCLE"
  REGISTRY_ITEM_ID_CURRENTLY_LIVE: YesNoUnproven
  SKU_UNIQUE_BOTH_SIDES: YesNoUnproven
  COMPETING_REGISTRY_RELATION: YesNoUnproven
  RECOMMENDED_ACTION: "REVIEW_REQUIRED"
}

export type EbayRegistryRepairDryRun = {
  DRY_RUN_LABEL: "DRY RUN — NO CHANGES WILL BE APPLIED"
  EVIDENCE_STATUS: "AVAILABLE" | "UNPROVEN"
  DRY_RUN_PACKAGE_HANDLE: string | "UNPROVEN"
  CURRENT_LIVE_COUNT: EbayRegistryRepairDryRunCount
  CURRENT_REGISTRY_COUNT: EbayRegistryRepairDryRunCount
  CURRENT_EVIDENCE_FINGERPRINT: string | "UNPROVEN"
  DRY_RUN_FRESHNESS_STATUS: EbayRegistryRepairDryRunFreshnessStatus
  DRY_RUN_REJECTION_REASON: EbayRegistryRepairDryRunRejectionReason | null
  AMBIGUITY_CLASS: EbayRegistryRepairAmbiguityClass
  UNPROVEN_COMPONENT: EbayRegistryRepairUnprovenComponent
  UNPROVEN_COUNT: EbayRegistryRepairDryRunCount
  REPAIR_EXISTING_UNPROVEN_COUNT: EbayRegistryRepairDryRunCount
  REPAIR_EXISTING_UNPROVEN_SOURCE: EbayRegistryRepairUnprovenSource
  MARK_STALE_UNPROVEN_COUNT: EbayRegistryRepairDryRunCount
  MARK_STALE_UNPROVEN_SOURCE: EbayRegistryRepairUnprovenSource
  CREATE_NEW_UNPROVEN_COUNT: EbayRegistryRepairDryRunCount
  CREATE_NEW_UNPROVEN_SOURCE: EbayRegistryRepairUnprovenSource
  HUMAN_REVIEW_UNPROVEN_COUNT: EbayRegistryRepairDryRunCount
  HUMAN_REVIEW_UNPROVEN_SOURCE: EbayRegistryRepairUnprovenSource
  IDENTITY_PARTITION_UNPROVEN_COUNT: EbayRegistryRepairDryRunCount
  IDENTITY_PARTITION_UNPROVEN_SOURCE: EbayRegistryRepairUnprovenSource
  UNPROVEN_REPAIR_EXISTING_COUNT: EbayRegistryRepairDryRunCount
  UNPROVEN_MARK_STALE_COUNT: EbayRegistryRepairDryRunCount
  UNPROVEN_CREATE_NEW_COUNT: EbayRegistryRepairDryRunCount
  UNPROVEN_HUMAN_REVIEW_COUNT: EbayRegistryRepairDryRunCount
  UNPROVEN_IDENTITY_PARTITION_COUNT: EbayRegistryRepairDryRunCount
  UNPROVEN_TOTAL_COUNT: EbayRegistryRepairDryRunCount
  UNPROVEN_STATE_GUARD_COUNT: EbayRegistryRepairDryRunCount
  UNPROVEN_SOURCE_READ_COUNT: EbayRegistryRepairDryRunCount
  UNPROVEN_OTHER_COUNT: EbayRegistryRepairDryRunCount
  BLOCKING_UNPROVEN_PRIMARY_SOURCE:
    EbayRegistryRepairBlockingUnprovenSource
  BLOCKING_UNPROVEN_SECONDARY_SOURCES:
    EbayRegistryRepairBlockingUnprovenSource[]
  RAW_ALREADY_MATCHED_COUNT: EbayRegistryRepairDryRunCount
  RAW_REPAIR_EXISTING_COUNT: EbayRegistryRepairDryRunCount
  RAW_CREATE_NEW_COUNT: EbayRegistryRepairDryRunCount
  RAW_HUMAN_REVIEW_COUNT: EbayRegistryRepairDryRunCount
  RAW_UNPROVEN_COUNT: EbayRegistryRepairDryRunCount
  LIVE_RAW_PARTITION_VALID: "YES" | "NO"
  RAW_KEEP_CURRENT_COUNT: EbayRegistryRepairDryRunCount
  RAW_REPAIR_EXISTING_REGISTRY_COUNT: EbayRegistryRepairDryRunCount
  RAW_MARK_STALE_COUNT: EbayRegistryRepairDryRunCount
  RAW_MARK_HISTORICAL_COUNT: EbayRegistryRepairDryRunCount
  RAW_HUMAN_REVIEW_REGISTRY_COUNT: EbayRegistryRepairDryRunCount
  RAW_UNPROVEN_REGISTRY_COUNT: EbayRegistryRepairDryRunCount
  REGISTRY_RAW_PARTITION_VALID: "YES" | "NO"
  UNPROVEN_REASON_MISSING_AUTHORITATIVE_ITEM_ID:
    EbayRegistryRepairDryRunCount
  UNPROVEN_REASON_DUPLICATE_ITEM_ID: EbayRegistryRepairDryRunCount
  UNPROVEN_REASON_MULTIPLE_REGISTRY_CANDIDATES:
    EbayRegistryRepairDryRunCount
  UNPROVEN_REASON_CROSS_LINK_CONFLICT: EbayRegistryRepairDryRunCount
  UNPROVEN_REASON_ACCOUNT_SCOPE: EbayRegistryRepairDryRunCount
  UNPROVEN_REASON_PARTITION_OVERLAP: EbayRegistryRepairDryRunCount
  UNPROVEN_REASON_SOURCE_EVIDENCE: EbayRegistryRepairDryRunCount
  UNPROVEN_REASON_OTHER: EbayRegistryRepairDryRunCount
  UNPROVEN_PRIMARY_REASON: EbayRegistryRepairUnprovenPrimaryReason
  OTHER_SUBTYPE_COUNTS: Record<
    EbayRegistryRepairOtherUnprovenSubtype,
    EbayRegistryRepairDryRunCount
  >
  OTHER_SUBTYPE_LISTING_IDENTITY_SHAPE_COUNT:
    EbayRegistryRepairDryRunCount
  OTHER_SUBTYPE_CREATE_PAYLOAD_REQUIREMENT_COUNT:
    EbayRegistryRepairDryRunCount
  OTHER_SUBTYPE_REGISTRY_ABSENCE_PROOF_COUNT:
    EbayRegistryRepairDryRunCount
  OTHER_SUBTYPE_LIFECYCLE_REQUIREMENT_COUNT:
    EbayRegistryRepairDryRunCount
  OTHER_SUBTYPE_NORMALIZATION_FAILURE_COUNT:
    EbayRegistryRepairDryRunCount
  OTHER_SUBTYPE_UNEXPECTED_CLASSIFIER_BRANCH_COUNT:
    EbayRegistryRepairDryRunCount
  RAW_CREATE_IDENTITY_CANDIDATE_COUNT: EbayRegistryRepairDryRunCount
  CREATE_IDENTITY_DETERMINISTIC_COUNT: EbayRegistryRepairDryRunCount
  CREATE_IDENTITY_UNPROVEN_COUNT: EbayRegistryRepairDryRunCount
  CREATE_MATERIALIZATION_PASS_COUNT: EbayRegistryRepairDryRunCount
  CREATE_MATERIALIZATION_UNPROVEN_COUNT: EbayRegistryRepairDryRunCount
  CREATE_ABSENCE_CAS_PASS_COUNT: EbayRegistryRepairDryRunCount
  CREATE_ABSENCE_CAS_UNPROVEN_COUNT: EbayRegistryRepairDryRunCount
  CREATE_MATERIALIZATION_STATUS: EbayRegistryRepairPreconditionStatus
  ABSENCE_PROOF_UNPROVEN_COUNT: EbayRegistryRepairDryRunCount
  ABSENCE_PROOF_CAUSE_ITEM_ID_ALREADY_PRESENT:
    EbayRegistryRepairDryRunCount
  ABSENCE_PROOF_CAUSE_ITEM_ID_LOOKUP_UNPROVEN:
    EbayRegistryRepairDryRunCount
  ABSENCE_PROOF_CAUSE_SKU_RELATION: EbayRegistryRepairDryRunCount
  ABSENCE_PROOF_CAUSE_SYNC_KEY_COLLISION: EbayRegistryRepairDryRunCount
  ABSENCE_PROOF_CAUSE_ACCOUNT_SCOPE: EbayRegistryRepairDryRunCount
  ABSENCE_PROOF_CAUSE_MULTIPLE_REGISTRY_ROWS:
    EbayRegistryRepairDryRunCount
  ABSENCE_PROOF_CAUSE_SECOND_READ_INCONSISTENCY:
    EbayRegistryRepairDryRunCount
  ABSENCE_PROOF_CAUSE_OTHER: EbayRegistryRepairDryRunCount
  ABSENCE_PROOF_PRIMARY_CAUSE: EbayRegistryRepairAbsenceProofCause
  LIFECYCLE_UNPROVEN_ACTION: EbayRegistryRepairLifecycleAction
  LIFECYCLE_UNPROVEN_STAGE: EbayRegistryRepairLifecycleStage
  LIFECYCLE_REQUIRED_SIGNAL: EbayRegistryRepairLifecycleRequiredSignal
  LIFECYCLE_SIGNAL_AVAILABLE: YesNoUnproven
  LIFECYCLE_FAILURE_CAUSE: EbayRegistryRepairLifecycleFailureCause
  REPAIR_ROW_CURRENT_STATUS_CLASS: EbayRegistryRepairRowStatusClass
  REPAIR_ROW_STATUS_RAW_VALUE_RECOGNIZED: YesNoUnproven
  REPAIR_ROW_STATUS_REACTIVATABLE: YesNoUnproven
  REPAIR_ROW_ACCOUNT_SCOPE_MATCH: YesNoUnproven
  REPAIR_ROW_AUTHORITATIVE_ITEM_ID_STILL_LIVE: YesNoUnproven
  REPAIR_ROW_ITEM_ID_UNIQUE_BOTH_SIDES: YesNoUnproven
  REPAIR_ROW_COMPETING_RELATIONSHIP: YesNoUnproven
  REGISTRY_LIFECYCLE_SUPPORTS_REACTIVATION: YesNoUnproven
  REACTIVATION_ALLOWED_FROM_STALE: YesNoUnproven
  REACTIVATION_ALLOWED_FROM_ENDED: YesNoUnproven
  REACTIVATION_ALLOWED_FROM_HISTORICAL: YesNoUnproven
  REACTIVATION_ALLOWED_FROM_UNKNOWN: YesNoUnproven
  REACTIVATION_CAS_SUPPORTED: YesNoUnproven
  REPAIR_EXISTING_AUTOMATIC_COUNT: EbayRegistryRepairDryRunCount
  HUMAN_REVIEW_REASON_REACTIVATION_NOT_ALLOWED_COUNT:
    EbayRegistryRepairDryRunCount
  IDENTITY_UNPROVEN_COUNT: EbayRegistryRepairDryRunCount
  AUTOMATIC_PRECONDITION_UNPROVEN_COUNT: EbayRegistryRepairDryRunCount
  AUTOMATIC_TRANCHE_PRECONDITIONS_PASS: YesNoUnproven
  HUMAN_REVIEW_WRITE_ALLOWED: "NO" | "UNPROVEN"
  HUMAN_REVIEW_MUTATION_COUNT: 0 | "UNPROVEN"
  FINAL_IDENTITY_UNPROVEN_COUNT: EbayRegistryRepairDryRunCount
  FINAL_PRECONDITION_UNPROVEN_COUNT: EbayRegistryRepairDryRunCount
  FINAL_REJECTION_REASON: EbayRegistryRepairDryRunRejectionReason | null
  DRY_RUN_STALE_LABEL:
    | "DRY RUN CURRENT — LIVE RECHECK REQUIRED BEFORE WRITE"
    | "DRY RUN STALE — REFRESH REQUIRED"
    | "UNPROVEN"
  DRY_RUN_STATE_BOUND: YesNoUnproven
  DRY_RUN_STATE_FINGERPRINT_PRESENT: YesNoUnproven
  APPROVAL_INVALIDATES_ON_EBAY_STATE_CHANGE: YesNoUnproven
  APPROVAL_INVALIDATES_ON_REGISTRY_STATE_CHANGE: YesNoUnproven
  REPAIR_EXISTING_COUNT: EbayRegistryRepairDryRunCount
  REPAIR_PRECONDITION_STATUS: EbayRegistryRepairPreconditionStatus
  REPAIR_FIELDS_TO_CHANGE: string[]
  CREATE_NEW_COUNT: EbayRegistryRepairDryRunCount
  CREATE_PRECONDITION_STATUS: EbayRegistryRepairPreconditionStatus
  CREATE_FIELDS_TO_POPULATE: string[]
  MARK_STALE_COUNT: EbayRegistryRepairDryRunCount
  STALE_PRECONDITION_STATUS: EbayRegistryRepairPreconditionStatus
  STALE_FIELDS_TO_CHANGE: string[]
  HUMAN_REVIEW_COUNT: EbayRegistryRepairDryRunCount
  HUMAN_REVIEW_CANDIDATES: EbayRegistryRepairHumanReviewCandidate[]
  LIVE_ALREADY_MATCHED_COUNT: EbayRegistryRepairDryRunCount
  LIVE_REPAIR_EXISTING_COUNT: EbayRegistryRepairDryRunCount
  LIVE_CREATE_NEW_COUNT: EbayRegistryRepairDryRunCount
  LIVE_HUMAN_REVIEW_COUNT: EbayRegistryRepairDryRunCount
  LIVE_UNPROVEN_COUNT: EbayRegistryRepairDryRunCount
  REGISTRY_KEEP_CURRENT_COUNT: EbayRegistryRepairDryRunCount
  REGISTRY_REPAIR_EXISTING_COUNT: EbayRegistryRepairDryRunCount
  REGISTRY_MARK_STALE_COUNT: EbayRegistryRepairDryRunCount
  REGISTRY_MARK_HISTORICAL_COUNT: EbayRegistryRepairDryRunCount
  REGISTRY_HUMAN_REVIEW_COUNT: EbayRegistryRepairDryRunCount
  REGISTRY_UNPROVEN_COUNT: EbayRegistryRepairDryRunCount
  LIVE_DRY_RUN_PARTITION_VALID: "YES" | "NO"
  REGISTRY_DRY_RUN_PARTITION_VALID: "YES" | "NO"
  WRITE_OPERATION_IDEMPOTENT: "YES"
  STALE_STATE_GUARD_SUPPORTED: YesNoUnproven
  LIVE_RECHECK_REQUIRED_BEFORE_WRITE: "YES"
  PARTIAL_FAILURE_POLICY: "ABORT_BEFORE_WRITE_OR_ROLL_BACK_ENTIRE_ACCOUNT_TRANCHE"
  ROLLBACK_STRATEGY: "SINGLE_ACCOUNT_SCOPED_DATABASE_TRANSACTION"
  EXPECTED_MATCHED_AFTER_SAFE_TRANCHE: EbayRegistryRepairDryRunCount
  EXPECTED_LIVE_COUNT: EbayRegistryRepairDryRunCount
  EXPECTED_PENDING_HUMAN_REVIEW: EbayRegistryRepairDryRunCount
  EXPECTED_COVERAGE_PERCENT: number | "UNPROVEN"
  DRY_RUN_READY_FOR_APPROVAL: "YES" | "NO"
  REGISTRY_MUTATIONS: 0
  EBAY_WRITES: 0
  PRODUCT_CASE_MUTATIONS: 0
  INVENTORY_WRITES: 0
  FULFILLMENT_WRITES: 0
  OAUTH_CHANGES: 0
  VERCEL_ENV_CHANGES: 0
}

export type EbayRegistryRepairDryRunInput = {
  accountKey: string
  accountVerified: "YES"
  marketplaceId: "EBAY_US"
  observedAt: string
  liveListings: readonly EbayLiveListing[]
  registryRows: readonly ReadonlyRegistryListingRow[]
  syncKeyLookupStatus: "AVAILABLE"
  existingRegistrySyncKeys: readonly string[]
  capturedEvidenceFingerprint: string
}

export type EbayRegistryRepairCreateRpcCandidateV1 = {
  source: "EBAY_TRADING_GET_MY_EBAY_SELLING"
  account_key: string
  sync_key: string
  ebay_item_id: string
  title: string
  ebay_sku: string | null
  ebay_quantity: number | null
  ebay_price: number | null
  currency: string
  last_ebay_sync_at: string
  raw_payload: {
    source: "EBAY_TRADING_GET_MY_EBAY_SELLING"
    marketplaceId: "EBAY_US"
    listingState: "ACTIVE"
    variationKey: string
    observedAt: string
  }
}

export type EbayRegistryRepairStaleRpcCandidateV1 = {
  id: string
  account_key: string
  expected_source: string
  expected_sync_key: string | null
  expected_listing_status: "active"
  expected_ebay_item_id: string
  expected_ebay_sku: string | null
  expected_sync_generation: number | string
  expected_updated_at: string
}

type EbayRegistryRepairExecutionMembership<T> = {
  membershipHandle: string
  rpcInput: T
}

export type EbayRegistryRepairExecutionPlanV1 = {
  version: "EBAY_REGISTRY_REPAIR_EXECUTION_PLAN_V1"
  accountKey: string
  evidenceFingerprint: string
  packageHandle: string
  createCandidates: ReadonlyArray<
    EbayRegistryRepairExecutionMembership<EbayRegistryRepairCreateRpcCandidateV1>
  >
  staleCandidates: ReadonlyArray<
    EbayRegistryRepairExecutionMembership<EbayRegistryRepairStaleRpcCandidateV1>
  >
  repairCandidates: ReadonlyArray<{ membershipHandle: string }>
  humanReviewCandidates: ReadonlyArray<{
    candidateHandle: string
    relationshipType: "SKU_ONLY" | "ITEM_ID_ONLY_LIFECYCLE"
  }>
}

export type EbayRegistryRepairPlanningResult = {
  dryRun: EbayRegistryRepairDryRun
  executionPlan: EbayRegistryRepairExecutionPlanV1 | null
}

export type EbayRegistryRepairExecutionPlanCapture = (
  plan: EbayRegistryRepairExecutionPlanV1,
) => void

export type EbayRegistryRepairEvidenceFingerprintInput = Pick<
  EbayRegistryRepairDryRunInput,
  "accountKey" | "marketplaceId" | "liveListings" | "registryRows" |
    "syncKeyLookupStatus" | "existingRegistrySyncKeys"
>

export type EbayRegistryRepairFutureWriteFreshness = {
  WRITE_STATE_STATUS: EbayRegistryRepairDryRunFreshnessStatus
  WRITE_ALLOWED: "YES" | "NO"
  REFRESH_REQUIRED: "YES" | "NO"
  DRY_RUN_FRESHNESS_STATUS: EbayRegistryRepairDryRunFreshnessStatus
  DRY_RUN_STALE_LABEL:
    | "DRY RUN CURRENT — LIVE RECHECK REQUIRED BEFORE WRITE"
    | "DRY RUN STALE — REFRESH REQUIRED"
    | "UNPROVEN"
  FUTURE_WRITE_REJECTION_REASON: EbayRegistryRepairFutureWriteRejectionReason
}

const REPAIR_FIELDS = ["ebay_sku"]
const STALE_FIELDS = ["listing_status"]
const CREATE_SOURCE = "EBAY_TRADING_GET_MY_EBAY_SELLING"
const CREATE_FIELDS = [
  "source",
  "account_key",
  "sync_key",
  "sync_run_id",
  "sync_generation",
  "ebay_item_id",
  "listing_status",
  "title",
  "ebay_sku",
  "ebay_quantity",
  "ebay_price",
  "currency",
  "last_ebay_sync_at",
  "raw_payload",
  "updated_at",
]

type NormalizedRegistryLifecycleStatus =
  | "active"
  | "paused"
  | "ended"
  | "draft"
  | "unknown"
  | "stale"
  | "historical"
  | "inactive"
  | "other"

function normalizedRegistryLifecycleStatus(
  value: unknown,
): NormalizedRegistryLifecycleStatus {
  const status = normalizedIdentity(value)?.toLowerCase()
  if (status === "active" || status === "paused" || status === "ended" ||
      status === "draft" || status === "unknown" || status === "stale" ||
      status === "historical" || status === "inactive") {
    return status
  }
  return "other"
}

function registryRepairStatusEvidence(value: unknown): {
  status: NormalizedRegistryLifecycleStatus
  statusClass: Exclude<EbayRegistryRepairRowStatusClass, "UNPROVEN">
  rawValueRecognized: "YES" | "NO"
} {
  const status = normalizedRegistryLifecycleStatus(value)
  if (status === "active") {
    return { status, statusClass: "ACTIVE", rawValueRecognized: "YES" }
  }
  if (status === "paused") {
    return { status, statusClass: "PAUSED", rawValueRecognized: "YES" }
  }
  if (status === "draft") {
    return { status, statusClass: "DRAFT", rawValueRecognized: "YES" }
  }
  if (status === "ended") {
    return { status, statusClass: "ENDED", rawValueRecognized: "YES" }
  }
  if (status === "unknown") {
    return { status, statusClass: "UNKNOWN", rawValueRecognized: "YES" }
  }
  if (status === "stale") {
    return { status, statusClass: "STALE", rawValueRecognized: "NO" }
  }
  if (status === "historical") {
    return { status, statusClass: "HISTORICAL", rawValueRecognized: "NO" }
  }
  if (status === "inactive") {
    return { status, statusClass: "OTHER", rawValueRecognized: "NO" }
  }
  return { status, statusClass: "OTHER", rawValueRecognized: "NO" }
}

function registryRepairStatusReactivatable(
  status: NormalizedRegistryLifecycleStatus,
) {
  return status === "paused" || status === "draft" || status === "ended"
}

function normalizedIdentity(value: unknown) {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export function buildEbayRegistryRepairCreateSyncKey(input: {
  accountKey: string
  itemId: string | null
  sku: string | null
}): string | "UNPROVEN" {
  const accountKey = normalizedIdentity(input.accountKey)
  const itemId = normalizedIdentity(input.itemId)
  const sku = normalizedIdentity(input.sku)
  if (!accountKey || !itemId || !sku) return "UNPROVEN"
  return `${CREATE_SOURCE}:${accountKey}:${itemId}`
}

const RPC_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

function materializeCreateRpcCandidateV1(input: {
  accountKey: string
  listing: EbayLiveListing
  itemId: string
  sku: string
}): (EbayRegistryRepairCreateRpcCandidateV1 & { ebay_sku: string }) | null {
  const title = normalizedIdentity(input.listing.title)
  const currency = normalizedIdentity(input.listing.currency)?.toUpperCase()
  const observedAt = normalizedIdentity(input.listing.observedAt)
  const syncKey = buildEbayRegistryRepairCreateSyncKey({
    accountKey: input.accountKey,
    itemId: input.itemId,
    sku: input.sku,
  })
  const quantity = input.listing.availableQuantity
  const price = input.listing.price
  if (!/^\d{9,20}$/.test(input.itemId) ||
      !title || title.length > 1000 || CONTROL_CHARACTER.test(title) ||
      input.sku.length > 80 || CONTROL_CHARACTER.test(input.sku) ||
      !currency || !/^[A-Z]{3}$/.test(currency) ||
      !observedAt || !RPC_TIMESTAMP.test(observedAt) ||
      syncKey === "UNPROVEN" || syncKey.length > 500 ||
      (quantity !== null &&
        (!Number.isSafeInteger(quantity) || quantity < 0)) ||
      (price !== null &&
        (!Number.isFinite(price) || price < 0 ||
          !/^\d+(?:\.\d{1,2})?$/.test(String(price))))) {
    return null
  }
  return {
    source: input.listing.source,
    account_key: input.accountKey,
    sync_key: syncKey,
    ebay_item_id: input.itemId,
    title,
    ebay_sku: input.sku,
    ebay_quantity: quantity,
    ebay_price: price,
    currency,
    last_ebay_sync_at: observedAt,
    raw_payload: {
      source: input.listing.source,
      marketplaceId: "EBAY_US",
      listingState: input.listing.listingState,
      variationKey: normalizedIdentity(input.listing.variationKey) ?? "",
      observedAt,
    },
  }
}

function materializeStaleRpcCandidateV1(input: {
  accountKey: string
  row: ReadonlyRegistryListingRow
}): EbayRegistryRepairStaleRpcCandidateV1 | null {
  const id = normalizedIdentity(input.row.id)
  const source = normalizedIdentity(input.row.source)
  const itemId = normalizedIdentity(input.row.ebay_item_id)
  const sku = normalizedIdentity(input.row.ebay_sku)
  const syncKey = normalizedIdentity(input.row.sync_key)
  const updatedAt = normalizedIdentity(input.row.updated_at)
  const generation = input.row.sync_generation
  const generationSafe = typeof generation === "number"
    ? Number.isSafeInteger(generation) && generation >= 0
    : typeof generation === "string" && /^\d+$/.test(generation)
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ||
      input.row.account_key !== input.accountKey ||
      !source || !/^[A-Za-z0-9._:-]{1,100}$/.test(source) ||
      (syncKey !== null && (syncKey.length > 500 ||
        CONTROL_CHARACTER.test(syncKey))) ||
      input.row.listing_status !== "active" ||
      !itemId || !/^\d{9,20}$/.test(itemId) ||
      (sku !== null && (sku.length > 80 || CONTROL_CHARACTER.test(sku))) ||
      !generationSafe || generation === null ||
      !updatedAt || !RPC_TIMESTAMP.test(updatedAt)) {
    return null
  }
  return {
    id,
    account_key: input.accountKey,
    expected_source: source,
    expected_sync_key: syncKey,
    expected_listing_status: "active",
    expected_ebay_item_id: itemId,
    expected_ebay_sku: sku,
    expected_sync_generation: generation,
    expected_updated_at: updatedAt,
  }
}

function increment(values: Map<string, number>, key: string) {
  const current = values.get(key)
  values.set(key, current === undefined ? 1 : current + 1)
}

function evidenceCount(values: Map<string, number>, key: string) {
  const value = values.get(key)
  return value === undefined ? 0 : value
}

function opaqueHandle(namespace: string, evidence: unknown) {
  const stableKey = stableReadonlyCommercialKey(
    namespace,
    JSON.stringify(evidence),
  )
  const digestStart = stableKey.lastIndexOf(":") + 1
  const digest = stableKey.slice(digestStart, digestStart + 24)
  return `rr_${namespace}_${digest}`
}

function exactStateGuard(row: ReadonlyRegistryListingRow) {
  const id = normalizedIdentity(row.id)
  const accountKey = normalizedIdentity(row.account_key)
  const source = normalizedIdentity(row.source)
  const syncKey = normalizedIdentity(row.sync_key)
  const listingStatus = normalizedIdentity(row.listing_status)
  const updatedAt = normalizedIdentity(row.updated_at)
  const itemId = normalizedIdentity(row.ebay_item_id)
  const sku = normalizedIdentity(row.ebay_sku)
  const hasGeneration = Object.prototype.hasOwnProperty.call(
    row,
    "sync_generation",
  )
  if (
    !id || !accountKey || !source || !listingStatus || !updatedAt ||
    (!itemId && !sku) || !hasGeneration
  ) {
    return null
  }
  return [
    id,
    accountKey,
    source,
    syncKey,
    listingStatus,
    itemId,
    sku,
    row.sync_generation,
    updatedAt,
  ]
}

export function buildEbayRegistryRepairEvidenceFingerprint(
  input: EbayRegistryRepairEvidenceFingerprintInput,
): string | "UNPROVEN" {
  const accountKey = normalizedIdentity(input.accountKey)
  if (input.syncKeyLookupStatus !== "AVAILABLE" ||
      !Array.isArray(input.existingRegistrySyncKeys)) {
    return "UNPROVEN"
  }
  const existingRegistrySyncKeys = input.existingRegistrySyncKeys.map(
    normalizedIdentity,
  )
  if (!accountKey || input.marketplaceId !== "EBAY_US" ||
      existingRegistrySyncKeys.some((syncKey) => syncKey === null)) {
    return "UNPROVEN"
  }
  return opaqueHandle("evidence", {
    version: "EBAY_REGISTRY_REPAIR_EVIDENCE_V1",
    accountKey,
    marketplaceId: input.marketplaceId,
    existingRegistrySyncKeys: existingRegistrySyncKeys.sort(),
    live: input.liveListings.map((listing) => JSON.stringify([
      normalizedIdentity(listing.itemId),
      normalizedIdentity(listing.sku),
      normalizedIdentity(listing.variationKey),
      normalizedIdentity(listing.customLabel),
      listing.listingState,
      listing.identityAmbiguous,
      normalizedIdentity(listing.marketplaceSite),
      listing.marketplaceCertification.status,
      listing.marketplaceCertification.source,
      listing.source,
    ])).sort(),
    registry: input.registryRows.map((row) => JSON.stringify([
      normalizedIdentity(row.id),
      normalizedIdentity(row.account_key),
      normalizedIdentity(row.source),
      normalizedIdentity(row.sync_key),
      normalizedIdentity(row.listing_status),
      normalizedIdentity(row.ebay_item_id),
      normalizedIdentity(row.ebay_sku),
      normalizedIdentity(row.ebay_variation_key),
      row.sync_generation,
      normalizedIdentity(row.updated_at),
    ])).sort(),
  })
}

export function evaluateEbayRegistryRepairFutureWriteFreshness(input: {
  reviewedEvidenceFingerprint: string | "UNPROVEN" | null | undefined
  currentEvidenceFingerprint: string | "UNPROVEN" | null | undefined
}): EbayRegistryRepairFutureWriteFreshness {
  const reviewed = normalizedIdentity(input.reviewedEvidenceFingerprint)
  const current = normalizedIdentity(input.currentEvidenceFingerprint)
  const safeFingerprint = /^rr_evidence_[a-f0-9]{24}$/
  if (!reviewed || !current || !safeFingerprint.test(reviewed) ||
      !safeFingerprint.test(current)) {
    return {
      WRITE_STATE_STATUS: "UNPROVEN",
      WRITE_ALLOWED: "NO",
      REFRESH_REQUIRED: "YES",
      DRY_RUN_FRESHNESS_STATUS: "UNPROVEN",
      DRY_RUN_STALE_LABEL: "UNPROVEN",
      FUTURE_WRITE_REJECTION_REASON: "EVIDENCE_UNAVAILABLE",
    }
  }
  if (reviewed !== current) {
    return {
      WRITE_STATE_STATUS: "STALE",
      WRITE_ALLOWED: "NO",
      REFRESH_REQUIRED: "YES",
      DRY_RUN_FRESHNESS_STATUS: "STALE",
      DRY_RUN_STALE_LABEL: "DRY RUN STALE — REFRESH REQUIRED",
      FUTURE_WRITE_REJECTION_REASON: "FUTURE_WRITE_EVIDENCE_STALE",
    }
  }
  return {
    WRITE_STATE_STATUS: "CURRENT",
    WRITE_ALLOWED: "YES",
    REFRESH_REQUIRED: "NO",
    DRY_RUN_FRESHNESS_STATUS: "CURRENT",
    DRY_RUN_STALE_LABEL:
      "DRY RUN CURRENT — LIVE RECHECK REQUIRED BEFORE WRITE",
    FUTURE_WRITE_REJECTION_REASON: "NONE",
  }
}

function livePreconditionsProven(listing: EbayLiveListing) {
  return listing.listingState === "ACTIVE" &&
    listing.identityAmbiguous === false &&
    listing.marketplaceCertification.status === "US_CERTIFIED"
}

function preconditionStatus(
  unprovenCount: number,
): EbayRegistryRepairPreconditionStatus {
  if (unprovenCount > 0) return "UNPROVEN"
  return "PASS"
}

function safetyContract() {
  return {
    WRITE_OPERATION_IDEMPOTENT: "YES" as const,
    LIVE_RECHECK_REQUIRED_BEFORE_WRITE: "YES" as const,
    PARTIAL_FAILURE_POLICY:
      "ABORT_BEFORE_WRITE_OR_ROLL_BACK_ENTIRE_ACCOUNT_TRANCHE" as const,
    ROLLBACK_STRATEGY:
      "SINGLE_ACCOUNT_SCOPED_DATABASE_TRANSACTION" as const,
    REGISTRY_MUTATIONS: 0 as const,
    EBAY_WRITES: 0 as const,
    PRODUCT_CASE_MUTATIONS: 0 as const,
    INVENTORY_WRITES: 0 as const,
    FULFILLMENT_WRITES: 0 as const,
    OAUTH_CHANGES: 0 as const,
    VERCEL_ENV_CHANGES: 0 as const,
  }
}

export function buildUnprovenEbayRegistryRepairDryRun():
EbayRegistryRepairDryRun {
  return {
    DRY_RUN_LABEL: "DRY RUN — NO CHANGES WILL BE APPLIED",
    EVIDENCE_STATUS: "UNPROVEN",
    DRY_RUN_PACKAGE_HANDLE: "UNPROVEN",
    CURRENT_LIVE_COUNT: "UNPROVEN",
    CURRENT_REGISTRY_COUNT: "UNPROVEN",
    CURRENT_EVIDENCE_FINGERPRINT: "UNPROVEN",
    DRY_RUN_FRESHNESS_STATUS: "UNPROVEN",
    DRY_RUN_REJECTION_REASON: "UNPROVEN",
    AMBIGUITY_CLASS: "BLOCKING_UNPROVEN",
    UNPROVEN_COMPONENT: "EVIDENCE_UNAVAILABLE",
    UNPROVEN_COUNT: "UNPROVEN",
    REPAIR_EXISTING_UNPROVEN_COUNT: "UNPROVEN",
    REPAIR_EXISTING_UNPROVEN_SOURCE: "EVIDENCE_UNAVAILABLE",
    MARK_STALE_UNPROVEN_COUNT: "UNPROVEN",
    MARK_STALE_UNPROVEN_SOURCE: "EVIDENCE_UNAVAILABLE",
    CREATE_NEW_UNPROVEN_COUNT: "UNPROVEN",
    CREATE_NEW_UNPROVEN_SOURCE: "EVIDENCE_UNAVAILABLE",
    HUMAN_REVIEW_UNPROVEN_COUNT: "UNPROVEN",
    HUMAN_REVIEW_UNPROVEN_SOURCE: "EVIDENCE_UNAVAILABLE",
    IDENTITY_PARTITION_UNPROVEN_COUNT: "UNPROVEN",
    IDENTITY_PARTITION_UNPROVEN_SOURCE: "EVIDENCE_UNAVAILABLE",
    UNPROVEN_REPAIR_EXISTING_COUNT: "UNPROVEN",
    UNPROVEN_MARK_STALE_COUNT: "UNPROVEN",
    UNPROVEN_CREATE_NEW_COUNT: "UNPROVEN",
    UNPROVEN_HUMAN_REVIEW_COUNT: "UNPROVEN",
    UNPROVEN_IDENTITY_PARTITION_COUNT: "UNPROVEN",
    UNPROVEN_TOTAL_COUNT: "UNPROVEN",
    UNPROVEN_STATE_GUARD_COUNT: "UNPROVEN",
    UNPROVEN_SOURCE_READ_COUNT: "UNPROVEN",
    UNPROVEN_OTHER_COUNT: "UNPROVEN",
    BLOCKING_UNPROVEN_PRIMARY_SOURCE: "SOURCE_READ",
    BLOCKING_UNPROVEN_SECONDARY_SOURCES: [],
    RAW_ALREADY_MATCHED_COUNT: "UNPROVEN",
    RAW_REPAIR_EXISTING_COUNT: "UNPROVEN",
    RAW_CREATE_NEW_COUNT: "UNPROVEN",
    RAW_HUMAN_REVIEW_COUNT: "UNPROVEN",
    RAW_UNPROVEN_COUNT: "UNPROVEN",
    LIVE_RAW_PARTITION_VALID: "NO",
    RAW_KEEP_CURRENT_COUNT: "UNPROVEN",
    RAW_REPAIR_EXISTING_REGISTRY_COUNT: "UNPROVEN",
    RAW_MARK_STALE_COUNT: "UNPROVEN",
    RAW_MARK_HISTORICAL_COUNT: "UNPROVEN",
    RAW_HUMAN_REVIEW_REGISTRY_COUNT: "UNPROVEN",
    RAW_UNPROVEN_REGISTRY_COUNT: "UNPROVEN",
    REGISTRY_RAW_PARTITION_VALID: "NO",
    UNPROVEN_REASON_MISSING_AUTHORITATIVE_ITEM_ID: "UNPROVEN",
    UNPROVEN_REASON_DUPLICATE_ITEM_ID: "UNPROVEN",
    UNPROVEN_REASON_MULTIPLE_REGISTRY_CANDIDATES: "UNPROVEN",
    UNPROVEN_REASON_CROSS_LINK_CONFLICT: "UNPROVEN",
    UNPROVEN_REASON_ACCOUNT_SCOPE: "UNPROVEN",
    UNPROVEN_REASON_PARTITION_OVERLAP: "UNPROVEN",
    UNPROVEN_REASON_SOURCE_EVIDENCE: "UNPROVEN",
    UNPROVEN_REASON_OTHER: "UNPROVEN",
    UNPROVEN_PRIMARY_REASON: "SOURCE_EVIDENCE",
    OTHER_SUBTYPE_COUNTS: {
      LISTING_IDENTITY_SHAPE: "UNPROVEN",
      CREATE_PAYLOAD_REQUIREMENT: "UNPROVEN",
      REGISTRY_ABSENCE_PROOF: "UNPROVEN",
      LIFECYCLE_REQUIREMENT: "UNPROVEN",
      NORMALIZATION_FAILURE: "UNPROVEN",
      UNEXPECTED_CLASSIFIER_BRANCH: "UNPROVEN",
    },
    OTHER_SUBTYPE_LISTING_IDENTITY_SHAPE_COUNT: "UNPROVEN",
    OTHER_SUBTYPE_CREATE_PAYLOAD_REQUIREMENT_COUNT: "UNPROVEN",
    OTHER_SUBTYPE_REGISTRY_ABSENCE_PROOF_COUNT: "UNPROVEN",
    OTHER_SUBTYPE_LIFECYCLE_REQUIREMENT_COUNT: "UNPROVEN",
    OTHER_SUBTYPE_NORMALIZATION_FAILURE_COUNT: "UNPROVEN",
    OTHER_SUBTYPE_UNEXPECTED_CLASSIFIER_BRANCH_COUNT: "UNPROVEN",
    RAW_CREATE_IDENTITY_CANDIDATE_COUNT: "UNPROVEN",
    CREATE_IDENTITY_DETERMINISTIC_COUNT: "UNPROVEN",
    CREATE_IDENTITY_UNPROVEN_COUNT: "UNPROVEN",
    CREATE_MATERIALIZATION_PASS_COUNT: "UNPROVEN",
    CREATE_MATERIALIZATION_UNPROVEN_COUNT: "UNPROVEN",
    CREATE_ABSENCE_CAS_PASS_COUNT: "UNPROVEN",
    CREATE_ABSENCE_CAS_UNPROVEN_COUNT: "UNPROVEN",
    CREATE_MATERIALIZATION_STATUS: "UNPROVEN",
    ABSENCE_PROOF_UNPROVEN_COUNT: "UNPROVEN",
    ABSENCE_PROOF_CAUSE_ITEM_ID_ALREADY_PRESENT: "UNPROVEN",
    ABSENCE_PROOF_CAUSE_ITEM_ID_LOOKUP_UNPROVEN: "UNPROVEN",
    ABSENCE_PROOF_CAUSE_SKU_RELATION: "UNPROVEN",
    ABSENCE_PROOF_CAUSE_SYNC_KEY_COLLISION: "UNPROVEN",
    ABSENCE_PROOF_CAUSE_ACCOUNT_SCOPE: "UNPROVEN",
    ABSENCE_PROOF_CAUSE_MULTIPLE_REGISTRY_ROWS: "UNPROVEN",
    ABSENCE_PROOF_CAUSE_SECOND_READ_INCONSISTENCY: "UNPROVEN",
    ABSENCE_PROOF_CAUSE_OTHER: "UNPROVEN",
    ABSENCE_PROOF_PRIMARY_CAUSE: "UNPROVEN",
    LIFECYCLE_UNPROVEN_ACTION: "UNPROVEN",
    LIFECYCLE_UNPROVEN_STAGE: "UNPROVEN",
    LIFECYCLE_REQUIRED_SIGNAL: "UNPROVEN",
    LIFECYCLE_SIGNAL_AVAILABLE: "UNPROVEN",
    LIFECYCLE_FAILURE_CAUSE: "UNPROVEN",
    REPAIR_ROW_CURRENT_STATUS_CLASS: "UNPROVEN",
    REPAIR_ROW_STATUS_RAW_VALUE_RECOGNIZED: "UNPROVEN",
    REPAIR_ROW_STATUS_REACTIVATABLE: "UNPROVEN",
    REPAIR_ROW_ACCOUNT_SCOPE_MATCH: "UNPROVEN",
    REPAIR_ROW_AUTHORITATIVE_ITEM_ID_STILL_LIVE: "UNPROVEN",
    REPAIR_ROW_ITEM_ID_UNIQUE_BOTH_SIDES: "UNPROVEN",
    REPAIR_ROW_COMPETING_RELATIONSHIP: "UNPROVEN",
    REGISTRY_LIFECYCLE_SUPPORTS_REACTIVATION: "UNPROVEN",
    REACTIVATION_ALLOWED_FROM_STALE: "UNPROVEN",
    REACTIVATION_ALLOWED_FROM_ENDED: "UNPROVEN",
    REACTIVATION_ALLOWED_FROM_HISTORICAL: "UNPROVEN",
    REACTIVATION_ALLOWED_FROM_UNKNOWN: "UNPROVEN",
    REACTIVATION_CAS_SUPPORTED: "UNPROVEN",
    REPAIR_EXISTING_AUTOMATIC_COUNT: "UNPROVEN",
    HUMAN_REVIEW_REASON_REACTIVATION_NOT_ALLOWED_COUNT: "UNPROVEN",
    IDENTITY_UNPROVEN_COUNT: "UNPROVEN",
    AUTOMATIC_PRECONDITION_UNPROVEN_COUNT: "UNPROVEN",
    AUTOMATIC_TRANCHE_PRECONDITIONS_PASS: "UNPROVEN",
    HUMAN_REVIEW_WRITE_ALLOWED: "UNPROVEN",
    HUMAN_REVIEW_MUTATION_COUNT: "UNPROVEN",
    FINAL_IDENTITY_UNPROVEN_COUNT: "UNPROVEN",
    FINAL_PRECONDITION_UNPROVEN_COUNT: "UNPROVEN",
    FINAL_REJECTION_REASON: "UNPROVEN",
    DRY_RUN_STALE_LABEL: "UNPROVEN",
    DRY_RUN_STATE_BOUND: "UNPROVEN",
    DRY_RUN_STATE_FINGERPRINT_PRESENT: "UNPROVEN",
    APPROVAL_INVALIDATES_ON_EBAY_STATE_CHANGE: "YES",
    APPROVAL_INVALIDATES_ON_REGISTRY_STATE_CHANGE: "YES",
    REPAIR_EXISTING_COUNT: "UNPROVEN",
    REPAIR_PRECONDITION_STATUS: "UNPROVEN",
    REPAIR_FIELDS_TO_CHANGE: [...REPAIR_FIELDS],
    CREATE_NEW_COUNT: "UNPROVEN",
    CREATE_PRECONDITION_STATUS: "UNPROVEN",
    CREATE_FIELDS_TO_POPULATE: [...CREATE_FIELDS],
    MARK_STALE_COUNT: "UNPROVEN",
    STALE_PRECONDITION_STATUS: "UNPROVEN",
    STALE_FIELDS_TO_CHANGE: [...STALE_FIELDS],
    HUMAN_REVIEW_COUNT: "UNPROVEN",
    HUMAN_REVIEW_CANDIDATES: [],
    LIVE_ALREADY_MATCHED_COUNT: "UNPROVEN",
    LIVE_REPAIR_EXISTING_COUNT: "UNPROVEN",
    LIVE_CREATE_NEW_COUNT: "UNPROVEN",
    LIVE_HUMAN_REVIEW_COUNT: "UNPROVEN",
    LIVE_UNPROVEN_COUNT: "UNPROVEN",
    REGISTRY_KEEP_CURRENT_COUNT: "UNPROVEN",
    REGISTRY_REPAIR_EXISTING_COUNT: "UNPROVEN",
    REGISTRY_MARK_STALE_COUNT: "UNPROVEN",
    REGISTRY_MARK_HISTORICAL_COUNT: "UNPROVEN",
    REGISTRY_HUMAN_REVIEW_COUNT: "UNPROVEN",
    REGISTRY_UNPROVEN_COUNT: "UNPROVEN",
    LIVE_DRY_RUN_PARTITION_VALID: "NO",
    REGISTRY_DRY_RUN_PARTITION_VALID: "NO",
    STALE_STATE_GUARD_SUPPORTED: "UNPROVEN",
    EXPECTED_MATCHED_AFTER_SAFE_TRANCHE: "UNPROVEN",
    EXPECTED_LIVE_COUNT: "UNPROVEN",
    EXPECTED_PENDING_HUMAN_REVIEW: "UNPROVEN",
    EXPECTED_COVERAGE_PERCENT: "UNPROVEN",
    DRY_RUN_READY_FOR_APPROVAL: "NO",
    ...safetyContract(),
  }
}

export function buildEbayRegistryRepairDryRun(
  input: EbayRegistryRepairDryRunInput,
  captureExecutionPlan?: EbayRegistryRepairExecutionPlanCapture,
): EbayRegistryRepairDryRun {
  const accountKey = normalizedIdentity(input.accountKey)
  const observedAt = normalizedIdentity(input.observedAt)
  if (!accountKey || !observedAt || !Number.isFinite(Date.parse(observedAt)) ||
      input.accountVerified !== "YES" ||
      input.marketplaceId !== "EBAY_US" ||
      input.syncKeyLookupStatus !== "AVAILABLE") {
    return buildUnprovenEbayRegistryRepairDryRun()
  }

  const liveFacts = input.liveListings.map((listing, index) => ({
    index,
    listing,
    itemId: normalizedIdentity(listing.itemId),
    sku: normalizedIdentity(listing.sku),
    variationKey: normalizedIdentity(listing.variationKey),
  }))
  const registryFacts = input.registryRows.map((row, index) => ({
    index,
    row,
    syncKey: normalizedIdentity(row.sync_key),
    itemId: normalizedIdentity(row.ebay_item_id),
    sku: normalizedIdentity(row.ebay_sku),
    variationKey: normalizedIdentity(row.ebay_variation_key),
    guard: exactStateGuard(row),
  }))

  const liveItemCounts = new Map<string, number>()
  const liveSkuCounts = new Map<string, number>()
  const registryItemCounts = new Map<string, number>()
  const registrySkuCounts = new Map<string, number>()
  const registrySyncKeys = new Set<string>()
  let registrySyncKeyEvidenceComplete = true
  for (const live of liveFacts) {
    if (live.itemId) increment(liveItemCounts, live.itemId)
    if (live.sku) increment(liveSkuCounts, live.sku)
  }
  for (const registry of registryFacts) {
    if (registry.itemId) increment(registryItemCounts, registry.itemId)
    if (registry.sku) increment(registrySkuCounts, registry.sku)
    if (registry.syncKey) registrySyncKeys.add(registry.syncKey)
  }
  const existingRegistrySyncKeys = new Set<string>()
  for (const candidate of input.existingRegistrySyncKeys) {
    const syncKey = normalizedIdentity(candidate)
    if (!syncKey) {
      registrySyncKeyEvidenceComplete = false
      continue
    }
    existingRegistrySyncKeys.add(syncKey)
  }
  const hasDuplicateAuthority =
    [...liveItemCounts.values()].some((count) => count > 1) ||
    [...registryItemCounts.values()].some((count) => count > 1)

  const evidenceFingerprint = buildEbayRegistryRepairEvidenceFingerprint(input)
  if (evidenceFingerprint === "UNPROVEN") {
    return buildUnprovenEbayRegistryRepairDryRun()
  }
  const capturedEvidenceFingerprint = normalizedIdentity(
    input.capturedEvidenceFingerprint,
  )
  const sameRequestEvidenceCoherent =
    capturedEvidenceFingerprint === evidenceFingerprint
  const freshnessStatus: EbayRegistryRepairDryRunFreshnessStatus =
    sameRequestEvidenceCoherent ? "CURRENT" : "UNPROVEN"
  const staleLabel = sameRequestEvidenceCoherent
    ? "DRY RUN CURRENT — LIVE RECHECK REQUIRED BEFORE WRITE" as const
    : "UNPROVEN" as const

  const itemMatchesFor = (itemId: string | null) => itemId
    ? liveFacts.filter((live) => live.itemId === itemId).map((live) => live.index)
    : []
  const skuMatchesFor = (sku: string | null) => sku
    ? liveFacts.filter((live) => live.sku === sku).map((live) => live.index)
    : []
  const liveRegistryReferences = Array.from(
    { length: liveFacts.length },
    () => new Set<number>(),
  )
  for (const registry of registryFacts) {
    const references = new Set([
      ...itemMatchesFor(registry.itemId),
      ...skuMatchesFor(registry.sku),
    ])
    for (const liveIndex of references) {
      liveRegistryReferences[liveIndex]?.add(registry.index)
    }
  }
  const hasRegistryReferencePartitionConflict = liveRegistryReferences.some(
    (references) => references.size > 1,
  )

  const liveMatched = new Set<number>()
  const liveRepair = new Set<number>()
  const liveHumanReview = new Set<number>()
  const liveUnproven = new Set<number>()
  const liveUnprovenReasons = new Map<
    number,
    Exclude<EbayRegistryRepairUnprovenPrimaryReason, "NONE">
  >()
  const liveOtherUnprovenSubtypes = new Map<
    number,
    EbayRegistryRepairOtherUnprovenSubtype
  >()
  const actionOtherUnprovenSubtypeCounts = new Map<string, number>()
  const reasonPriority: Array<
    Exclude<EbayRegistryRepairUnprovenPrimaryReason, "NONE">
  > = [
    "CROSS_LINK_CONFLICT",
    "DUPLICATE_ITEM_ID",
    "MULTIPLE_REGISTRY_CANDIDATES",
    "PARTITION_OVERLAP",
    "MISSING_AUTHORITATIVE_ITEM_ID",
    "ACCOUNT_SCOPE",
    "SOURCE_EVIDENCE",
    "OTHER",
  ]
  const markLiveUnproven = (
    liveIndex: number,
    reason: Exclude<EbayRegistryRepairUnprovenPrimaryReason, "NONE">,
    otherSubtype?: EbayRegistryRepairOtherUnprovenSubtype,
  ) => {
    const previous = liveUnprovenReasons.get(liveIndex)
    if (!previous || reasonPriority.indexOf(reason) <
        reasonPriority.indexOf(previous)) {
      liveUnprovenReasons.set(liveIndex, reason)
      if (reason === "OTHER" && otherSubtype) {
        liveOtherUnprovenSubtypes.set(liveIndex, otherSubtype)
      }
    } else if (reason === "OTHER" && previous === "OTHER" &&
        otherSubtype && !liveOtherUnprovenSubtypes.has(liveIndex)) {
      liveOtherUnprovenSubtypes.set(liveIndex, otherSubtype)
    }
    liveUnproven.add(liveIndex)
  }
  const liveGateReason = (
    live: (typeof liveFacts)[number],
    rowAccountCorrect = true,
  ): Exclude<EbayRegistryRepairUnprovenPrimaryReason, "NONE"> => {
    if (!live.itemId) return "MISSING_AUTHORITATIVE_ITEM_ID"
    if (evidenceCount(liveItemCounts, live.itemId) > 1 ||
        evidenceCount(registryItemCounts, live.itemId) > 1) {
      return "DUPLICATE_ITEM_ID"
    }
    if (!rowAccountCorrect) return "ACCOUNT_SCOPE"
    const registryReferences = liveRegistryReferences[live.index]
    if (registryReferences && registryReferences.size > 1) {
      return "PARTITION_OVERLAP"
    }
    if (live.listing.marketplaceCertification.status !== "US_CERTIFIED" ||
        live.listing.listingState !== "ACTIVE") {
      return "SOURCE_EVIDENCE"
    }
    return "OTHER"
  }
  const liveGateOtherSubtype = (
    live: (typeof liveFacts)[number],
    rowActive: boolean,
    variationCompatible = true,
  ): EbayRegistryRepairOtherUnprovenSubtype => {
    if (!rowActive) return "LIFECYCLE_REQUIREMENT"
    if (live.listing.identityAmbiguous || !live.sku) {
      return "LISTING_IDENTITY_SHAPE"
    }
    if (!variationCompatible) return "NORMALIZATION_FAILURE"
    return "UNEXPECTED_CLASSIFIER_BRANCH"
  }
  const markLiveGateUnproven = (
    live: (typeof liveFacts)[number],
    rowAccountCorrect: boolean,
    rowActive: boolean,
    variationCompatible = true,
  ) => {
    const reason = liveGateReason(live, rowAccountCorrect)
    markLiveUnproven(
      live.index,
      reason,
      reason === "OTHER"
        ? liveGateOtherSubtype(live, rowActive, variationCompatible)
        : undefined,
    )
  }
  const keepHandles: string[] = []
  const repairHandles: string[] = []
  const repairFieldsToChange = new Set<string>(REPAIR_FIELDS)
  const repairRowDiagnostics: Array<{
    statusClass: Exclude<EbayRegistryRepairRowStatusClass, "UNPROVEN">
    rawValueRecognized: "YES" | "NO"
    statusReactivatable: boolean
    accountScopeMatch: boolean
    authoritativeItemIdStillLive: boolean
    itemIdUniqueBothSides: boolean
    competingRelationship: boolean
    reactivationCasSupported: boolean
  }> = []
  const staleHandles: string[] = []
  const staleExecutionCandidates: Array<
    EbayRegistryRepairExecutionMembership<EbayRegistryRepairStaleRpcCandidateV1>
  > = []
  const humanCandidates: EbayRegistryRepairHumanReviewCandidate[] = []
  let registryKeepCurrent = 0
  let registryRepairExisting = 0
  let registryMarkStale = 0
  const registryMarkHistorical = 0
  let registryHumanReview = 0
  let registryUnproven = 0
  let repairUnproven = 0
  let staleUnproven = 0
  let createUnproven = 0
  let humanReviewUnproven = 0
  let identityPartitionUnproven = 0
  let humanReviewEvidenceSafe = true
  let hasMultipleCandidates = false
  let hasCrossLink = false
  let hasActionPartitionConflict = false
  let lifecycleUnprovenCount = 0
  let registryPartitionLifecycleUnprovenCount = 0
  let lifecycleHumanReviewCount = 0
  const lifecycleActions = new Set<EbayRegistryRepairLifecycleAction>()
  const lifecycleFailureCauses =
    new Set<EbayRegistryRepairLifecycleFailureCause>()
  const recordLifecycleUnproven = (
    action: Exclude<EbayRegistryRepairLifecycleAction,
      "NONE" | "UNPROVEN">,
    signalAvailable: boolean,
    preciseFailureCause?: Exclude<EbayRegistryRepairLifecycleFailureCause,
      "NONE" | "MULTIPLE_FAILURES" | "UNPROVEN">,
  ) => {
    lifecycleUnprovenCount += 1
    lifecycleActions.add(action)
    lifecycleFailureCauses.add(preciseFailureCause ?? (signalAvailable
      ? "REGISTRY_ROW_NOT_ACTIVE"
      : "REGISTRY_LISTING_STATUS_UNAVAILABLE"))
    increment(actionOtherUnprovenSubtypeCounts, "LIFECYCLE_REQUIREMENT")
  }

  for (const registry of registryFacts) {
    const itemMatches = itemMatchesFor(registry.itemId)
    const skuMatches = skuMatchesFor(registry.sku)
    const fullMatches = itemMatches.filter((liveIndex) => {
      const live = liveFacts[liveIndex]
      return Boolean(live && live.sku === registry.sku &&
        live.variationKey === registry.variationKey)
    })
    const itemAndSkuReferenceSameLive = itemMatches.some(
      (liveIndex) => skuMatches.includes(liveIndex),
    )
    hasMultipleCandidates ||= itemMatches.length > 1 || skuMatches.length > 1
    hasCrossLink ||= itemMatches.length > 0 && skuMatches.length > 0 &&
      !itemAndSkuReferenceSameLive
    const rowAccountCorrect = registry.row.account_key === accountKey
    const rowListingStatus = normalizedIdentity(registry.row.listing_status)
    const rowStatusEvidence = registryRepairStatusEvidence(
      registry.row.listing_status,
    )
    const rowLifecycleSignalAvailable = rowListingStatus !== null
    const rowActive = rowStatusEvidence.status === "active"

    if (fullMatches.length === 1 && itemMatches.length === 1 &&
        skuMatches.length === 1) {
      const live = liveFacts[fullMatches[0]]
      const identitySafe = Boolean(live && rowAccountCorrect &&
        livePreconditionsProven(live.listing) &&
        registry.itemId && registry.sku &&
        evidenceCount(liveItemCounts, registry.itemId) === 1 &&
        evidenceCount(registryItemCounts, registry.itemId) === 1 &&
        evidenceCount(liveSkuCounts, registry.sku) === 1 &&
        evidenceCount(registrySkuCounts, registry.sku) === 1 &&
        liveRegistryReferences[live.index]?.size === 1)
      if (identitySafe && live) {
        liveMatched.add(live.index)
        if (rowActive) {
          registryKeepCurrent += 1
          keepHandles.push(opaqueHandle("keep", [
            accountKey,
            registry.itemId,
            registry.sku,
            registry.variationKey,
            live.itemId,
            live.sku,
            live.variationKey,
          ]))
        } else {
          registryUnproven += 1
          registryPartitionLifecycleUnprovenCount += 1
          recordLifecycleUnproven(
            "REGISTRY_PARTITION",
            rowLifecycleSignalAvailable,
          )
        }
      } else {
        registryUnproven += 1
        identityPartitionUnproven += 1
        if (live) markLiveGateUnproven(
          live,
          rowAccountCorrect,
          rowActive,
        )
      }
      continue
    }

    if (itemMatches.length === 1 && skuMatches.length === 0) {
      const live = liveFacts[itemMatches[0]]
      const itemIdUniqueBothSides = Boolean(registry.itemId &&
        evidenceCount(liveItemCounts, registry.itemId) === 1 &&
        evidenceCount(registryItemCounts, registry.itemId) === 1)
      const competingRelationship = live
        ? liveRegistryReferences[live.index]?.size !== 1
        : true
      const reactivationSupported = registryRepairStatusReactivatable(
        rowStatusEvidence.status,
      )
      repairRowDiagnostics.push({
        statusClass: rowStatusEvidence.statusClass,
        rawValueRecognized: rowStatusEvidence.rawValueRecognized,
        statusReactivatable: reactivationSupported,
        accountScopeMatch: rowAccountCorrect,
        authoritativeItemIdStillLive: Boolean(live &&
          livePreconditionsProven(live.listing)),
        itemIdUniqueBothSides,
        competingRelationship,
        reactivationCasSupported: Boolean(registry.guard &&
          (rowActive || reactivationSupported)),
      })
      const identitySafe = Boolean(live && registry.itemId &&
        registry.sku && live.sku && registry.sku !== live.sku &&
        registry.variationKey === live.variationKey && rowAccountCorrect &&
        livePreconditionsProven(live.listing) &&
        evidenceCount(liveItemCounts, registry.itemId) === 1 &&
        evidenceCount(registryItemCounts, registry.itemId) === 1 &&
        evidenceCount(registrySkuCounts, live.sku) === 0 &&
        liveRegistryReferences[live.index]?.size === 1)
      if (identitySafe && live) {
        if (registry.guard && !rowActive && !reactivationSupported) {
          lifecycleHumanReviewCount += 1
          registryHumanReview += 1
          liveHumanReview.add(live.index)
          lifecycleFailureCauses.add("REACTIVATION_NOT_ALLOWED")
          humanCandidates.push({
            CANDIDATE_HANDLE: opaqueHandle("review", {
              relationshipType: "ITEM_ID_ONLY_LIFECYCLE",
              evidenceFingerprint,
              existingRowCas: registry.guard,
              statusClass: rowStatusEvidence.statusClass,
            }),
            RELATIONSHIP_TYPE: "ITEM_ID_ONLY_LIFECYCLE",
            REGISTRY_ITEM_ID_CURRENTLY_LIVE: "YES",
            SKU_UNIQUE_BOTH_SIDES: "NO",
            COMPETING_REGISTRY_RELATION: "NO",
            RECOMMENDED_ACTION: "REVIEW_REQUIRED",
          })
        } else {
          registryRepairExisting += 1
          liveRepair.add(live.index)
          if (!registry.guard) {
            repairUnproven += 1
          } else {
            const candidateRepairFields = [...REPAIR_FIELDS]
            if (!rowActive) {
              candidateRepairFields.push("listing_status")
              repairFieldsToChange.add("listing_status")
            }
            repairHandles.push(opaqueHandle("repair", {
              evidenceFingerprint,
              existingRowCas: registry.guard,
              expectedStatus: rowStatusEvidence.status,
              fieldsToChange: candidateRepairFields,
              nextSku: live.sku,
              variationKey: live.variationKey,
            }))
          }
        }
      } else {
        registryUnproven += 1
        identityPartitionUnproven += 1
        if (live) markLiveGateUnproven(
          live,
          rowAccountCorrect,
          rowActive,
          registry.variationKey === live.variationKey,
        )
      }
      continue
    }

    if (itemMatches.length === 0 && skuMatches.length === 1) {
      const live = liveFacts[skuMatches[0]]
      const reviewEvidenceSafe = Boolean(live && registry.sku &&
        rowAccountCorrect &&
        livePreconditionsProven(live.listing))
      if (!reviewEvidenceSafe || !live || !registry.sku) {
        registryUnproven += 1
        humanReviewUnproven += 1
        if (live) markLiveGateUnproven(
          live,
          rowAccountCorrect,
          rowActive,
        )
        humanReviewEvidenceSafe = false
        continue
      }
      const skuUnique = evidenceCount(liveSkuCounts, registry.sku) === 1 &&
        evidenceCount(registrySkuCounts, registry.sku) === 1
      const liveReferences = liveRegistryReferences[live.index]
      const competing = liveReferences ? liveReferences.size > 1 : true
      if (!skuUnique || competing) {
        registryUnproven += 1
        identityPartitionUnproven += 1
        markLiveUnproven(live.index, "PARTITION_OVERLAP")
        humanReviewEvidenceSafe = false
        continue
      }
      registryHumanReview += 1
      liveHumanReview.add(live.index)
      if (!rowActive) {
        humanReviewUnproven += 1
        recordLifecycleUnproven(
          "HUMAN_REVIEW",
          rowLifecycleSignalAvailable,
        )
      }
      humanCandidates.push({
        CANDIDATE_HANDLE: opaqueHandle("review", [
          accountKey,
          registry.itemId,
          registry.sku,
          registry.variationKey,
          live.itemId,
          live.sku,
          live.variationKey,
        ]),
        RELATIONSHIP_TYPE: "SKU_ONLY",
        REGISTRY_ITEM_ID_CURRENTLY_LIVE: registry.itemId
          ? "NO"
          : "UNPROVEN",
        SKU_UNIQUE_BOTH_SIDES: skuUnique ? "YES" : "NO",
        COMPETING_REGISTRY_RELATION: competing ? "YES" : "NO",
        RECOMMENDED_ACTION: "REVIEW_REQUIRED",
      })
      continue
    }

    if (itemMatches.length === 0 && skuMatches.length === 0) {
      const identitySafe = Boolean(rowAccountCorrect && rowActive &&
        (registry.itemId || registry.sku))
      if (identitySafe) {
        registryMarkStale += 1
        const staleCandidate = registry.guard
          ? materializeStaleRpcCandidateV1({
              accountKey,
              row: registry.row,
            })
          : null
        if (registry.guard) {
          const membershipHandle = opaqueHandle("stale", registry.guard)
          staleHandles.push(membershipHandle)
          if (staleCandidate) {
            staleExecutionCandidates.push({
              membershipHandle,
              rpcInput: staleCandidate,
            })
          }
        } else {
          staleUnproven += 1
        }
      } else {
        registryUnproven += 1
        identityPartitionUnproven += 1
      }
      continue
    }

    registryUnproven += 1
    identityPartitionUnproven += 1
    const rowConflictReason = itemMatches.length > 0 &&
        skuMatches.length > 0 && !itemAndSkuReferenceSameLive
      ? "CROSS_LINK_CONFLICT" as const
      : itemMatches.length > 1 || skuMatches.length > 1
        ? "MULTIPLE_REGISTRY_CANDIDATES" as const
        : "OTHER" as const
    for (const liveIndex of new Set([...itemMatches, ...skuMatches])) {
      markLiveUnproven(
        liveIndex,
        rowConflictReason,
        rowConflictReason === "OTHER"
          ? "NORMALIZATION_FAILURE"
          : undefined,
      )
    }
  }

  for (const live of liveFacts) {
    const actionMemberships = [liveMatched, liveRepair, liveHumanReview]
      .filter((group) => group.has(live.index))
    if (liveUnproven.has(live.index) || actionMemberships.length > 1) {
      if (!liveUnproven.has(live.index) && actionMemberships.length > 1) {
        identityPartitionUnproven += 1
      }
      markLiveUnproven(
        live.index,
        actionMemberships.length > 1 ? "PARTITION_OVERLAP" :
          liveUnprovenReasons.get(live.index) ?? "OTHER",
      )
      hasActionPartitionConflict ||= actionMemberships.length > 1
    }
  }

  const resolvedLiveMatched = new Set([...liveMatched].filter(
    (liveIndex) => !liveUnproven.has(liveIndex),
  ))
  const resolvedLiveRepair = new Set([...liveRepair].filter(
    (liveIndex) => !liveUnproven.has(liveIndex),
  ))
  const resolvedLiveHumanReview = new Set([...liveHumanReview].filter(
    (liveIndex) => !liveUnproven.has(liveIndex),
  ))

  const liveCreate = new Set<number>()
  const rawLiveCreateIdentity = new Set<number>()
  const createHandles: string[] = []
  const createExecutionCandidates: Array<
    EbayRegistryRepairExecutionMembership<EbayRegistryRepairCreateRpcCandidateV1>
  > = []
  let rawCreateIdentityCandidateCount = 0
  let createIdentityDeterministicCount = 0
  let createIdentityUnprovenCount = 0
  let createMaterializationPassCount = 0
  let createMaterializationUnprovenCount = 0
  let createAbsenceCasPassCount = 0
  let createAbsenceCasUnprovenCount = 0
  let absenceItemIdAlreadyPresentCount = 0
  let absenceItemIdLookupUnprovenCount = 0
  let absenceSkuRelationCount = 0
  let absenceSyncKeyCollisionCount = 0
  let absenceAccountScopeCount = 0
  let absenceMultipleRegistryRowsCount = 0
  let absenceOtherCount = 0
  const plannedCreateSyncKeys = new Set<string>()
  for (const live of liveFacts) {
    if (resolvedLiveMatched.has(live.index) ||
        resolvedLiveRepair.has(live.index) ||
        resolvedLiveHumanReview.has(live.index) ||
        liveUnproven.has(live.index)) {
      continue
    }
    rawCreateIdentityCandidateCount += 1
    const createItemId = live.itemId
    const identityEvidenceSafe = Boolean(createItemId &&
      livePreconditionsProven(live.listing) &&
      evidenceCount(liveItemCounts, createItemId) === 1)
    if (!identityEvidenceSafe || !createItemId) {
      createIdentityUnprovenCount += 1
      identityPartitionUnproven += 1
      const createIdentityFailureReason = !createItemId
        ? "MISSING_AUTHORITATIVE_ITEM_ID" as const
        : evidenceCount(liveItemCounts, createItemId) > 1
          ? "DUPLICATE_ITEM_ID" as const
          : live.listing.marketplaceCertification.status !==
                "US_CERTIFIED" || live.listing.listingState !== "ACTIVE"
            ? "SOURCE_EVIDENCE" as const
            : "OTHER" as const
      markLiveUnproven(
        live.index,
        createIdentityFailureReason,
        createIdentityFailureReason === "OTHER"
          ? "LISTING_IDENTITY_SHAPE"
          : undefined,
      )
      continue
    }
    createIdentityDeterministicCount += 1
    rawLiveCreateIdentity.add(live.index)

    const createSku = live.sku
    const createCandidate = createSku
      ? materializeCreateRpcCandidateV1({
          accountKey,
          listing: live.listing,
          itemId: createItemId,
          sku: createSku,
        })
      : null
    if (!createSku || !createCandidate) {
      createMaterializationUnprovenCount += 1
      createUnproven += 1
      increment(actionOtherUnprovenSubtypeCounts,
        "CREATE_PAYLOAD_REQUIREMENT")
      continue
    }
    createMaterializationPassCount += 1

    const noRegistryReference = liveRegistryReferences[live.index]?.size === 0
    const plannedCreateSyncKey = createCandidate.sync_key
    const plannedSyncKeyProven = true
    const plannedSyncKeyCollision = plannedSyncKeyProven && (
      existingRegistrySyncKeys.has(plannedCreateSyncKey) ||
      registrySyncKeys.has(plannedCreateSyncKey) ||
      plannedCreateSyncKeys.has(plannedCreateSyncKey)
    )
    const absenceAndUniquenessSafe = Boolean(noRegistryReference &&
      evidenceCount(registryItemCounts, createItemId) === 0 &&
      evidenceCount(registrySkuCounts, createSku) === 0 &&
      registrySyncKeyEvidenceComplete &&
      plannedSyncKeyProven &&
      !plannedSyncKeyCollision)
    if (absenceAndUniquenessSafe) {
      plannedCreateSyncKeys.add(plannedCreateSyncKey as string)
      createAbsenceCasPassCount += 1
      liveCreate.add(live.index)
      const membershipHandle = opaqueHandle("create", [
        createItemId,
        createSku,
        live.variationKey,
        live.listing.title,
        live.listing.availableQuantity,
        live.listing.price,
        live.listing.currency,
      ])
      createHandles.push(membershipHandle)
      createExecutionCandidates.push({
        membershipHandle,
        rpcInput: createCandidate,
      })
    } else {
      createAbsenceCasUnprovenCount += 1
      createUnproven += 1
      const registryReferenceCount =
        liveRegistryReferences[live.index]?.size
      const registryReferenceEvidenceAvailable =
        registryReferenceCount !== undefined
      const registryItemCount = evidenceCount(
        registryItemCounts,
        createItemId,
      )
      const registrySkuCount = evidenceCount(registrySkuCounts, createSku)
      const referencedRows = [...(liveRegistryReferences[live.index] ?? [])]
        .map((registryIndex) => registryFacts[registryIndex])
        .filter((candidate) => candidate !== undefined)
      const multipleRegistryRows =
        (registryReferenceCount !== undefined && registryReferenceCount > 1) ||
        registryItemCount > 1 ||
        registrySkuCount > 1
      const accountScopeConflict = referencedRows.some(
        (candidate) => candidate.row.account_key !== accountKey,
      )
      if (!registryReferenceEvidenceAvailable ||
          !registrySyncKeyEvidenceComplete || !plannedSyncKeyProven) {
        absenceItemIdLookupUnprovenCount += 1
      } else if (multipleRegistryRows) {
        absenceMultipleRegistryRowsCount += 1
      } else if (accountScopeConflict) {
        absenceAccountScopeCount += 1
      } else if (registryItemCount > 0) {
        absenceItemIdAlreadyPresentCount += 1
      } else if (registrySkuCount > 0 ||
          (registryReferenceCount !== undefined &&
            registryReferenceCount > 0)) {
        absenceSkuRelationCount += 1
      } else if (plannedSyncKeyCollision) {
        absenceSyncKeyCollisionCount += 1
      } else {
        absenceOtherCount += 1
        increment(actionOtherUnprovenSubtypeCounts,
          "REGISTRY_ABSENCE_PROOF")
      }
    }
  }

  const livePartitionSum = resolvedLiveMatched.size + resolvedLiveRepair.size +
    rawLiveCreateIdentity.size + resolvedLiveHumanReview.size +
    liveUnproven.size
  const registryPartitionSum = registryKeepCurrent + registryRepairExisting +
    registryMarkStale + registryMarkHistorical + registryHumanReview +
    registryUnproven
  const livePartitionValid = livePartitionSum === liveFacts.length
    ? "YES" as const
    : "NO" as const
  const registryPartitionValid = registryPartitionSum === registryFacts.length
    ? "YES" as const
    : "NO" as const
  for (const liveIndex of liveUnproven) {
    if (!liveUnprovenReasons.has(liveIndex)) {
      liveUnprovenReasons.set(liveIndex, "OTHER")
    }
    if (liveUnprovenReasons.get(liveIndex) === "OTHER" &&
        !liveOtherUnprovenSubtypes.has(liveIndex)) {
      liveOtherUnprovenSubtypes.set(
        liveIndex,
        "UNEXPECTED_CLASSIFIER_BRANCH",
      )
    }
  }
  const unprovenReasonCount = (
    reason: Exclude<EbayRegistryRepairUnprovenPrimaryReason, "NONE">,
  ) => [...liveUnprovenReasons.values()].filter(
    (candidateReason) => candidateReason === reason,
  ).length
  const missingAuthoritativeItemIdReasonCount = unprovenReasonCount(
    "MISSING_AUTHORITATIVE_ITEM_ID",
  )
  const duplicateItemIdReasonCount = unprovenReasonCount("DUPLICATE_ITEM_ID")
  const multipleRegistryCandidatesReasonCount = unprovenReasonCount(
    "MULTIPLE_REGISTRY_CANDIDATES",
  )
  const crossLinkConflictReasonCount = unprovenReasonCount(
    "CROSS_LINK_CONFLICT",
  )
  const accountScopeReasonCount = unprovenReasonCount("ACCOUNT_SCOPE")
  const partitionOverlapReasonCount = unprovenReasonCount(
    "PARTITION_OVERLAP",
  )
  const sourceEvidenceReasonCount = unprovenReasonCount("SOURCE_EVIDENCE")
  const otherReasonCount = unprovenReasonCount("OTHER")
  const otherSubtypeCount = (
    subtype: EbayRegistryRepairOtherUnprovenSubtype,
  ) => [...liveUnprovenReasons.entries()].filter(([liveIndex, reason]) =>
    reason === "OTHER" &&
    liveOtherUnprovenSubtypes.get(liveIndex) === subtype
  ).length + evidenceCount(actionOtherUnprovenSubtypeCounts, subtype)
  const listingIdentityShapeOtherCount = otherSubtypeCount(
    "LISTING_IDENTITY_SHAPE",
  )
  const createPayloadRequirementOtherCount = otherSubtypeCount(
    "CREATE_PAYLOAD_REQUIREMENT",
  )
  const registryAbsenceProofOtherCount = otherSubtypeCount(
    "REGISTRY_ABSENCE_PROOF",
  )
  const lifecycleRequirementOtherCount = otherSubtypeCount(
    "LIFECYCLE_REQUIREMENT",
  )
  const normalizationFailureOtherCount = otherSubtypeCount(
    "NORMALIZATION_FAILURE",
  )
  const unexpectedClassifierBranchOtherCount = otherSubtypeCount(
    "UNEXPECTED_CLASSIFIER_BRANCH",
  )
  let unprovenPrimaryReason: EbayRegistryRepairUnprovenPrimaryReason = "NONE"
  let unprovenPrimaryReasonCount = 0
  for (const reason of reasonPriority) {
    const count = unprovenReasonCount(reason)
    if (count > unprovenPrimaryReasonCount) {
      unprovenPrimaryReason = reason
      unprovenPrimaryReasonCount = count
    }
  }
  const repairStatus = !sameRequestEvidenceCoherent
    ? "UNPROVEN" as const
    : preconditionStatus(repairUnproven)
  const createStatus = !sameRequestEvidenceCoherent
    ? "UNPROVEN" as const
    : preconditionStatus(createUnproven)
  const createMaterializationStatus = !sameRequestEvidenceCoherent
    ? "UNPROVEN" as const
    : preconditionStatus(createMaterializationUnprovenCount)
  const absenceSecondReadInconsistencyCount = sameRequestEvidenceCoherent
    ? 0
    : 1
  const absenceProofUnprovenCount = absenceItemIdAlreadyPresentCount +
    absenceItemIdLookupUnprovenCount + absenceSkuRelationCount +
    absenceSyncKeyCollisionCount + absenceAccountScopeCount +
    absenceMultipleRegistryRowsCount +
    absenceSecondReadInconsistencyCount + absenceOtherCount
  const absenceCauseEntries: Array<[
    EbayRegistryRepairAbsenceProofCause,
    number,
  ]> = [
    ["SECOND_READ_INCONSISTENCY", absenceSecondReadInconsistencyCount],
    ["MULTIPLE_REGISTRY_ROWS", absenceMultipleRegistryRowsCount],
    ["ACCOUNT_SCOPE", absenceAccountScopeCount],
    ["ITEM_ID_ALREADY_PRESENT", absenceItemIdAlreadyPresentCount],
    ["ITEM_ID_LOOKUP_UNPROVEN", absenceItemIdLookupUnprovenCount],
    ["SKU_RELATION", absenceSkuRelationCount],
    ["SYNC_KEY_COLLISION", absenceSyncKeyCollisionCount],
    ["OTHER", absenceOtherCount],
  ]
  const absenceProofPrimaryCause = absenceCauseEntries.find(
    ([, count]) => count > 0,
  )?.[0] ?? "NONE"
  const staleStatus = !sameRequestEvidenceCoherent
    ? "UNPROVEN" as const
    : preconditionStatus(staleUnproven)
  const stateGuardsSupported = repairHandles.length === registryRepairExisting &&
    staleHandles.length === registryMarkStale
      ? "YES" as const
      : "UNPROVEN" as const
  const expectedMatchedAfterSafeTranche = resolvedLiveMatched.size +
    repairHandles.length + liveCreate.size
  const expectedCoveragePercent = liveFacts.length > 0
    ? Number(((expectedMatchedAfterSafeTranche / liveFacts.length) * 100).toFixed(2))
    : "UNPROVEN" as const
  const basePreconditionsPass = liveUnproven.size === 0 &&
    registryUnproven === 0 &&
    registryMarkHistorical === 0 &&
    humanCandidates.length === registryHumanReview &&
    humanReviewEvidenceSafe && lifecycleUnprovenCount === 0 &&
    expectedCoveragePercent !== "UNPROVEN" &&
    repairStatus === "PASS" &&
    createStatus === "PASS" && staleStatus === "PASS" &&
    stateGuardsSupported === "YES"
  const ambiguityClass: EbayRegistryRepairAmbiguityClass =
    !sameRequestEvidenceCoherent
      ? "BLOCKING_UNPROVEN"
      : hasMultipleCandidates
        ? "BLOCKING_MULTIPLE_CANDIDATES"
        : hasCrossLink
          ? "BLOCKING_CROSS_LINK"
          : hasDuplicateAuthority
            ? "BLOCKING_DUPLICATE_AUTHORITY"
            : hasRegistryReferencePartitionConflict ||
                hasActionPartitionConflict ||
                livePartitionValid !== "YES" ||
                registryPartitionValid !== "YES"
              ? "BLOCKING_PARTITION_CONFLICT"
              : identityPartitionUnproven > 0 || liveUnproven.size > 0 ||
                  !humanReviewEvidenceSafe
                ? "BLOCKING_UNPROVEN"
                : humanCandidates.length > 0
                  ? "REVIEWABLE_ONLY"
                  : "NONE"
  const blockingAmbiguity = ambiguityClass !== "NONE" &&
    ambiguityClass !== "REVIEWABLE_ONLY"
  const provenIdentityBlocking = ambiguityClass ===
      "BLOCKING_MULTIPLE_CANDIDATES" ||
    ambiguityClass === "BLOCKING_CROSS_LINK" ||
    ambiguityClass === "BLOCKING_DUPLICATE_AUTHORITY" ||
    ambiguityClass === "BLOCKING_PARTITION_CONFLICT"
  const identityPartitionUnprovenCount = Math.max(
    identityPartitionUnproven,
    provenIdentityBlocking ? 1 : 0,
  )
  const unprovenComponents: EbayRegistryRepairUnprovenComponent[] = []
  if (repairUnproven > 0) {
    unprovenComponents.push("REPAIR_EXISTING_MUTATION_GUARD")
  }
  if (staleUnproven > 0) {
    unprovenComponents.push("MARK_STALE_MUTATION_GUARD")
  }
  if (createMaterializationUnprovenCount > 0) {
    unprovenComponents.push("CREATE_NEW_MATERIALIZATION")
  }
  if (createAbsenceCasUnprovenCount > 0) {
    unprovenComponents.push("CREATE_NEW_ABSENCE_OR_UNIQUENESS_GUARD")
  }
  if (humanReviewUnproven > 0) {
    unprovenComponents.push("HUMAN_REVIEW_EVIDENCE")
  }
  if (identityPartitionUnprovenCount > 0) {
    unprovenComponents.push("IDENTITY_PARTITION")
  }
  if (registryPartitionLifecycleUnprovenCount > 0) {
    unprovenComponents.push("LIFECYCLE_PRECONDITION")
  }
  const unprovenComponent: EbayRegistryRepairUnprovenComponent =
    !sameRequestEvidenceCoherent
      ? "SAME_REQUEST_STATE"
      : unprovenComponents.length === 0
        ? "NONE"
        : unprovenComponents.length === 1
          ? unprovenComponents[0]
          : "MULTIPLE_COMPONENTS"
  const unprovenStateGuardCount = sameRequestEvidenceCoherent ? 0 : 1
  const finalPreconditionUnprovenCount = repairUnproven + staleUnproven +
    createUnproven + humanReviewUnproven +
    registryPartitionLifecycleUnprovenCount + unprovenStateGuardCount
  const automaticPreconditionUnprovenCount = repairUnproven +
    staleUnproven + createUnproven + registryPartitionLifecycleUnprovenCount +
    unprovenStateGuardCount
  const automaticTranchePreconditionsPass = !sameRequestEvidenceCoherent
    ? "UNPROVEN" as const
    : identityPartitionUnprovenCount === 0 &&
        automaticPreconditionUnprovenCount === 0 &&
        livePartitionValid === "YES" && registryPartitionValid === "YES" &&
        stateGuardsSupported === "YES"
      ? "YES" as const
      : "NO" as const
  const unprovenCount = !sameRequestEvidenceCoherent
    ? 1
    : repairUnproven + staleUnproven + createUnproven +
      humanReviewUnproven + registryPartitionLifecycleUnprovenCount +
      identityPartitionUnprovenCount
  const unprovenSourceReadCount = 0
  const unprovenOtherCount = registryPartitionLifecycleUnprovenCount
  const activeUnprovenSources = ([
    ["SOURCE_READ", unprovenSourceReadCount],
    ["STATE_GUARD", unprovenStateGuardCount],
    ["IDENTITY_PARTITION", identityPartitionUnprovenCount],
    ["REPAIR_EXISTING", repairUnproven],
    ["MARK_STALE", staleUnproven],
    ["CREATE_NEW", createUnproven],
    ["HUMAN_REVIEW", humanReviewUnproven],
    ["OTHER", unprovenOtherCount],
  ] as const).filter(([, count]) => count > 0)
  const primaryUnprovenSource: EbayRegistryRepairBlockingUnprovenSource =
    activeUnprovenSources[0]?.[0] ?? "NONE"
  const secondaryUnprovenSources = activeUnprovenSources.slice(1).map(
    ([source]) => source,
  )
  const rejectionReason: EbayRegistryRepairDryRunRejectionReason | null =
    !sameRequestEvidenceCoherent
      ? "STATE_CHANGED_DURING_SAME_REQUEST"
      : livePartitionValid !== "YES"
        ? "IDENTITY_PARTITION_INVALID"
        : registryPartitionValid !== "YES"
          ? "REGISTRY_PARTITION_INVALID"
        : blockingAmbiguity
          ? "AMBIGUOUS_IDENTITY"
        : !basePreconditionsPass
          ? "PRECONDITION_UNPROVEN"
          : null
  const lifecycleAction: EbayRegistryRepairLifecycleAction =
    lifecycleActions.size === 0
      ? "NONE"
      : lifecycleActions.size === 1
        ? [...lifecycleActions][0]
        : "OTHER"
  const lifecycleFailureCause: EbayRegistryRepairLifecycleFailureCause =
    lifecycleFailureCauses.size === 0
      ? "NONE"
      : lifecycleFailureCauses.size === 1
        ? [...lifecycleFailureCauses][0]
        : "MULTIPLE_FAILURES"
  const ready = rejectionReason === null
      ? "YES" as const
      : "NO" as const
  const packageHandle = opaqueHandle("package", {
    evidenceFingerprint,
    keep: keepHandles.sort(),
    repair: repairHandles.sort(),
    create: createHandles.sort(),
    stale: staleHandles.sort(),
    review: humanCandidates.map((candidate) => candidate.CANDIDATE_HANDLE).sort(),
  })
  const createUnprovenSource: EbayRegistryRepairUnprovenSource =
    createMaterializationUnprovenCount > 0 &&
        createAbsenceCasUnprovenCount > 0
      ? "MULTIPLE"
      : createMaterializationUnprovenCount > 0
        ? "CREATE_MATERIALIZATION"
        : createAbsenceCasUnprovenCount > 0
          ? "ABSENCE_OR_UNIQUENESS_GUARD"
          : "NONE"
  const repairRowDiagnostic = repairRowDiagnostics.length === 1
    ? repairRowDiagnostics[0]
    : null

  const dryRun: EbayRegistryRepairDryRun = {
    DRY_RUN_LABEL: "DRY RUN — NO CHANGES WILL BE APPLIED",
    EVIDENCE_STATUS: "AVAILABLE",
    DRY_RUN_PACKAGE_HANDLE: packageHandle,
    CURRENT_LIVE_COUNT: liveFacts.length,
    CURRENT_REGISTRY_COUNT: registryFacts.length,
    CURRENT_EVIDENCE_FINGERPRINT: evidenceFingerprint,
    DRY_RUN_FRESHNESS_STATUS: freshnessStatus,
    DRY_RUN_REJECTION_REASON: rejectionReason,
    AMBIGUITY_CLASS: ambiguityClass,
    UNPROVEN_COMPONENT: unprovenComponent,
    UNPROVEN_COUNT: unprovenCount,
    REPAIR_EXISTING_UNPROVEN_COUNT: repairUnproven,
    REPAIR_EXISTING_UNPROVEN_SOURCE: repairUnproven > 0
      ? "EXISTING_ROW_CAS"
      : "NONE",
    MARK_STALE_UNPROVEN_COUNT: staleUnproven,
    MARK_STALE_UNPROVEN_SOURCE: staleUnproven > 0
      ? "EXISTING_ROW_CAS"
      : "NONE",
    CREATE_NEW_UNPROVEN_COUNT: createUnproven,
    CREATE_NEW_UNPROVEN_SOURCE: createUnprovenSource,
    HUMAN_REVIEW_UNPROVEN_COUNT: humanReviewUnproven,
    HUMAN_REVIEW_UNPROVEN_SOURCE: humanReviewUnproven > 0
      ? "REVIEW_EVIDENCE"
      : "NONE",
    IDENTITY_PARTITION_UNPROVEN_COUNT: identityPartitionUnprovenCount,
    IDENTITY_PARTITION_UNPROVEN_SOURCE:
      identityPartitionUnprovenCount > 0
        ? "IDENTITY_EVIDENCE"
        : "NONE",
    UNPROVEN_REPAIR_EXISTING_COUNT: repairUnproven,
    UNPROVEN_MARK_STALE_COUNT: staleUnproven,
    UNPROVEN_CREATE_NEW_COUNT: createUnproven,
    UNPROVEN_HUMAN_REVIEW_COUNT: humanReviewUnproven,
    UNPROVEN_IDENTITY_PARTITION_COUNT: identityPartitionUnprovenCount,
    UNPROVEN_TOTAL_COUNT: unprovenCount,
    UNPROVEN_STATE_GUARD_COUNT: unprovenStateGuardCount,
    UNPROVEN_SOURCE_READ_COUNT: unprovenSourceReadCount,
    UNPROVEN_OTHER_COUNT: unprovenOtherCount,
    BLOCKING_UNPROVEN_PRIMARY_SOURCE: primaryUnprovenSource,
    BLOCKING_UNPROVEN_SECONDARY_SOURCES: secondaryUnprovenSources,
    RAW_ALREADY_MATCHED_COUNT: resolvedLiveMatched.size,
    RAW_REPAIR_EXISTING_COUNT: resolvedLiveRepair.size,
    RAW_CREATE_NEW_COUNT: rawLiveCreateIdentity.size,
    RAW_HUMAN_REVIEW_COUNT: resolvedLiveHumanReview.size,
    RAW_UNPROVEN_COUNT: liveUnproven.size,
    LIVE_RAW_PARTITION_VALID: livePartitionValid,
    RAW_KEEP_CURRENT_COUNT: registryKeepCurrent,
    RAW_REPAIR_EXISTING_REGISTRY_COUNT: registryRepairExisting,
    RAW_MARK_STALE_COUNT: registryMarkStale,
    RAW_MARK_HISTORICAL_COUNT: registryMarkHistorical,
    RAW_HUMAN_REVIEW_REGISTRY_COUNT: registryHumanReview,
    RAW_UNPROVEN_REGISTRY_COUNT: registryUnproven,
    REGISTRY_RAW_PARTITION_VALID: registryPartitionValid,
    UNPROVEN_REASON_MISSING_AUTHORITATIVE_ITEM_ID:
      missingAuthoritativeItemIdReasonCount,
    UNPROVEN_REASON_DUPLICATE_ITEM_ID: duplicateItemIdReasonCount,
    UNPROVEN_REASON_MULTIPLE_REGISTRY_CANDIDATES:
      multipleRegistryCandidatesReasonCount,
    UNPROVEN_REASON_CROSS_LINK_CONFLICT: crossLinkConflictReasonCount,
    UNPROVEN_REASON_ACCOUNT_SCOPE: accountScopeReasonCount,
    UNPROVEN_REASON_PARTITION_OVERLAP: partitionOverlapReasonCount,
    UNPROVEN_REASON_SOURCE_EVIDENCE: sourceEvidenceReasonCount,
    UNPROVEN_REASON_OTHER: otherReasonCount,
    UNPROVEN_PRIMARY_REASON: unprovenPrimaryReason,
    OTHER_SUBTYPE_COUNTS: {
      LISTING_IDENTITY_SHAPE: listingIdentityShapeOtherCount,
      CREATE_PAYLOAD_REQUIREMENT: createPayloadRequirementOtherCount,
      REGISTRY_ABSENCE_PROOF: registryAbsenceProofOtherCount,
      LIFECYCLE_REQUIREMENT: lifecycleRequirementOtherCount,
      NORMALIZATION_FAILURE: normalizationFailureOtherCount,
      UNEXPECTED_CLASSIFIER_BRANCH: unexpectedClassifierBranchOtherCount,
    },
    OTHER_SUBTYPE_LISTING_IDENTITY_SHAPE_COUNT:
      listingIdentityShapeOtherCount,
    OTHER_SUBTYPE_CREATE_PAYLOAD_REQUIREMENT_COUNT:
      createPayloadRequirementOtherCount,
    OTHER_SUBTYPE_REGISTRY_ABSENCE_PROOF_COUNT:
      registryAbsenceProofOtherCount,
    OTHER_SUBTYPE_LIFECYCLE_REQUIREMENT_COUNT:
      lifecycleRequirementOtherCount,
    OTHER_SUBTYPE_NORMALIZATION_FAILURE_COUNT:
      normalizationFailureOtherCount,
    OTHER_SUBTYPE_UNEXPECTED_CLASSIFIER_BRANCH_COUNT:
      unexpectedClassifierBranchOtherCount,
    RAW_CREATE_IDENTITY_CANDIDATE_COUNT: rawCreateIdentityCandidateCount,
    CREATE_IDENTITY_DETERMINISTIC_COUNT: createIdentityDeterministicCount,
    CREATE_IDENTITY_UNPROVEN_COUNT: createIdentityUnprovenCount,
    CREATE_MATERIALIZATION_PASS_COUNT: createMaterializationPassCount,
    CREATE_MATERIALIZATION_UNPROVEN_COUNT:
      createMaterializationUnprovenCount,
    CREATE_ABSENCE_CAS_PASS_COUNT: createAbsenceCasPassCount,
    CREATE_ABSENCE_CAS_UNPROVEN_COUNT: createAbsenceCasUnprovenCount,
    CREATE_MATERIALIZATION_STATUS: createMaterializationStatus,
    ABSENCE_PROOF_UNPROVEN_COUNT: absenceProofUnprovenCount,
    ABSENCE_PROOF_CAUSE_ITEM_ID_ALREADY_PRESENT:
      absenceItemIdAlreadyPresentCount,
    ABSENCE_PROOF_CAUSE_ITEM_ID_LOOKUP_UNPROVEN:
      absenceItemIdLookupUnprovenCount,
    ABSENCE_PROOF_CAUSE_SKU_RELATION: absenceSkuRelationCount,
    ABSENCE_PROOF_CAUSE_SYNC_KEY_COLLISION:
      absenceSyncKeyCollisionCount,
    ABSENCE_PROOF_CAUSE_ACCOUNT_SCOPE: absenceAccountScopeCount,
    ABSENCE_PROOF_CAUSE_MULTIPLE_REGISTRY_ROWS:
      absenceMultipleRegistryRowsCount,
    ABSENCE_PROOF_CAUSE_SECOND_READ_INCONSISTENCY:
      absenceSecondReadInconsistencyCount,
    ABSENCE_PROOF_CAUSE_OTHER: absenceOtherCount,
    ABSENCE_PROOF_PRIMARY_CAUSE: absenceProofPrimaryCause,
    LIFECYCLE_UNPROVEN_ACTION: lifecycleAction,
    LIFECYCLE_UNPROVEN_STAGE: lifecycleUnprovenCount > 0
      ? "EXISTING_REGISTRY_ROW_ACTIVE_GUARD"
      : "NONE",
    LIFECYCLE_REQUIRED_SIGNAL: lifecycleUnprovenCount > 0
      ? "LISTING_STATUS_ACTIVE"
      : "NONE",
    LIFECYCLE_SIGNAL_AVAILABLE: lifecycleFailureCauses.has(
      "REGISTRY_LISTING_STATUS_UNAVAILABLE",
    ) ? "NO" : "YES",
    LIFECYCLE_FAILURE_CAUSE: lifecycleFailureCause,
    REPAIR_ROW_CURRENT_STATUS_CLASS:
      repairRowDiagnostic?.statusClass ?? "UNPROVEN",
    REPAIR_ROW_STATUS_RAW_VALUE_RECOGNIZED:
      repairRowDiagnostic?.rawValueRecognized ?? "UNPROVEN",
    REPAIR_ROW_STATUS_REACTIVATABLE: repairRowDiagnostic
      ? repairRowDiagnostic.statusReactivatable ? "YES" : "NO"
      : "UNPROVEN",
    REPAIR_ROW_ACCOUNT_SCOPE_MATCH: repairRowDiagnostic
      ? repairRowDiagnostic.accountScopeMatch ? "YES" : "NO"
      : "UNPROVEN",
    REPAIR_ROW_AUTHORITATIVE_ITEM_ID_STILL_LIVE: repairRowDiagnostic
      ? repairRowDiagnostic.authoritativeItemIdStillLive ? "YES" : "NO"
      : "UNPROVEN",
    REPAIR_ROW_ITEM_ID_UNIQUE_BOTH_SIDES: repairRowDiagnostic
      ? repairRowDiagnostic.itemIdUniqueBothSides ? "YES" : "NO"
      : "UNPROVEN",
    REPAIR_ROW_COMPETING_RELATIONSHIP: repairRowDiagnostic
      ? repairRowDiagnostic.competingRelationship ? "YES" : "NO"
      : "UNPROVEN",
    REGISTRY_LIFECYCLE_SUPPORTS_REACTIVATION: repairRowDiagnostic
      ? "YES"
      : "UNPROVEN",
    REACTIVATION_ALLOWED_FROM_STALE: repairRowDiagnostic
      ? "NO"
      : "UNPROVEN",
    REACTIVATION_ALLOWED_FROM_ENDED: repairRowDiagnostic
      ? "YES"
      : "UNPROVEN",
    REACTIVATION_ALLOWED_FROM_HISTORICAL: repairRowDiagnostic
      ? "NO"
      : "UNPROVEN",
    REACTIVATION_ALLOWED_FROM_UNKNOWN: repairRowDiagnostic
      ? "NO"
      : "UNPROVEN",
    REACTIVATION_CAS_SUPPORTED: repairRowDiagnostic
      ? repairRowDiagnostic.reactivationCasSupported ? "YES" : "NO"
      : "UNPROVEN",
    REPAIR_EXISTING_AUTOMATIC_COUNT: repairHandles.length,
    HUMAN_REVIEW_REASON_REACTIVATION_NOT_ALLOWED_COUNT:
      lifecycleHumanReviewCount,
    IDENTITY_UNPROVEN_COUNT: identityPartitionUnprovenCount,
    AUTOMATIC_PRECONDITION_UNPROVEN_COUNT:
      automaticPreconditionUnprovenCount,
    AUTOMATIC_TRANCHE_PRECONDITIONS_PASS:
      automaticTranchePreconditionsPass,
    HUMAN_REVIEW_WRITE_ALLOWED: "NO",
    HUMAN_REVIEW_MUTATION_COUNT: 0,
    FINAL_IDENTITY_UNPROVEN_COUNT: identityPartitionUnprovenCount,
    FINAL_PRECONDITION_UNPROVEN_COUNT: finalPreconditionUnprovenCount,
    FINAL_REJECTION_REASON: rejectionReason,
    DRY_RUN_STALE_LABEL: staleLabel,
    DRY_RUN_STATE_BOUND: sameRequestEvidenceCoherent ? "YES" : "NO",
    DRY_RUN_STATE_FINGERPRINT_PRESENT: "YES",
    APPROVAL_INVALIDATES_ON_EBAY_STATE_CHANGE: "YES",
    APPROVAL_INVALIDATES_ON_REGISTRY_STATE_CHANGE: "YES",
    REPAIR_EXISTING_COUNT: registryRepairExisting,
    REPAIR_PRECONDITION_STATUS: repairStatus,
    REPAIR_FIELDS_TO_CHANGE: [...repairFieldsToChange],
    CREATE_NEW_COUNT: liveCreate.size,
    CREATE_PRECONDITION_STATUS: createStatus,
    CREATE_FIELDS_TO_POPULATE: [...CREATE_FIELDS],
    MARK_STALE_COUNT: registryMarkStale,
    STALE_PRECONDITION_STATUS: staleStatus,
    STALE_FIELDS_TO_CHANGE: [...STALE_FIELDS],
    HUMAN_REVIEW_COUNT: humanCandidates.length,
    HUMAN_REVIEW_CANDIDATES: humanCandidates,
    LIVE_ALREADY_MATCHED_COUNT: resolvedLiveMatched.size,
    LIVE_REPAIR_EXISTING_COUNT: resolvedLiveRepair.size,
    LIVE_CREATE_NEW_COUNT: rawLiveCreateIdentity.size,
    LIVE_HUMAN_REVIEW_COUNT: resolvedLiveHumanReview.size,
    LIVE_UNPROVEN_COUNT: liveUnproven.size,
    REGISTRY_KEEP_CURRENT_COUNT: registryKeepCurrent,
    REGISTRY_REPAIR_EXISTING_COUNT: registryRepairExisting,
    REGISTRY_MARK_STALE_COUNT: registryMarkStale,
    REGISTRY_MARK_HISTORICAL_COUNT: registryMarkHistorical,
    REGISTRY_HUMAN_REVIEW_COUNT: registryHumanReview,
    REGISTRY_UNPROVEN_COUNT: registryUnproven,
    LIVE_DRY_RUN_PARTITION_VALID: livePartitionValid,
    REGISTRY_DRY_RUN_PARTITION_VALID: registryPartitionValid,
    STALE_STATE_GUARD_SUPPORTED: stateGuardsSupported,
    EXPECTED_MATCHED_AFTER_SAFE_TRANCHE: expectedMatchedAfterSafeTranche,
    EXPECTED_LIVE_COUNT: liveFacts.length,
    EXPECTED_PENDING_HUMAN_REVIEW: resolvedLiveHumanReview.size,
    EXPECTED_COVERAGE_PERCENT: expectedCoveragePercent,
    DRY_RUN_READY_FOR_APPROVAL: ready,
    ...safetyContract(),
  }
  captureExecutionPlan?.({
    version: "EBAY_REGISTRY_REPAIR_EXECUTION_PLAN_V1",
    accountKey,
    evidenceFingerprint,
    packageHandle,
    createCandidates: [...createExecutionCandidates].sort((left, right) =>
      left.membershipHandle.localeCompare(right.membershipHandle)),
    staleCandidates: [...staleExecutionCandidates].sort((left, right) =>
      left.membershipHandle.localeCompare(right.membershipHandle)),
    repairCandidates: [...repairHandles].sort().map((membershipHandle) => ({
      membershipHandle,
    })),
    humanReviewCandidates: humanCandidates.map((candidate) => ({
      candidateHandle: candidate.CANDIDATE_HANDLE,
      relationshipType: candidate.RELATIONSHIP_TYPE,
    })).sort((left, right) =>
      left.candidateHandle.localeCompare(right.candidateHandle)),
  })
  return dryRun
}

/** @internal Server-only callers must never serialize executionPlan. */
export function buildEbayRegistryRepairPlanningResult(
  input: EbayRegistryRepairDryRunInput,
): EbayRegistryRepairPlanningResult {
  let executionPlan: EbayRegistryRepairExecutionPlanV1 | null = null
  const dryRun = buildEbayRegistryRepairDryRun(input, (captured) => {
    executionPlan = captured
  })
  return { dryRun, executionPlan }
}
