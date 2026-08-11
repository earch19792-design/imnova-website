"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"
import type { EbayRegistryCoverageDiagnostic } from "@/lib/ebay/ebay-commercial-monitor-live-readonly"
import type {
  EbayRegistryRepairAmbiguityClass,
  EbayRegistryRepairAbsenceProofCause,
  EbayRegistryRepairBlockingUnprovenSource,
  EbayRegistryRepairDryRun,
  EbayRegistryRepairDryRunRejectionReason,
  EbayRegistryRepairOtherUnprovenSubtype,
  EbayRegistryRepairLifecycleAction,
  EbayRegistryRepairLifecycleFailureCause,
  EbayRegistryRepairLifecycleRequiredSignal,
  EbayRegistryRepairLifecycleStage,
  EbayRegistryRepairRowStatusClass,
  EbayRegistryRepairUnprovenComponent,
  EbayRegistryRepairUnprovenPrimaryReason,
  EbayRegistryRepairUnprovenSource,
} from "@/lib/ebay/ebay-registry-repair-dry-run"

const START_PATH = "/api/admin/ebay/monitor/seller-oauth-reauth"
const CALLBACK_PATH = "/api/admin/ebay/monitor/seller-oauth-reauth"
const REQUIRED_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
] as const

type StartPayload = {
  success?: boolean
  authorizationUrl?: string
  callbackPath?: string
  scopeCount?: number
  error?: string
  authorizationPreflight?: {
    rootCause?: string
    liveAccepted?: boolean
    scopeEncoding?: string
    stateAccepted?: boolean
    scopeContractExact?: boolean
    positiveInvariantsPassed?: boolean
    runtimeCredentialMatch?: boolean
  }
}

type PreflightState = {
  acceptedByAuthEndpoint: "YES" | "NO"
  safeErrorCategory:
    | "NONE"
    | "INVALID_REQUEST"
    | "AUTH_ENDPOINT_REJECTED"
    | "AUTH_ENDPOINT_UNAVAILABLE"
    | "AUTH_ENDPOINT_RESPONSE_UNPROVEN"
}

type Diagnosis = {
  rootCause:
    | "CLIENT_ID_RUNAME_BINDING"
    | "SCOPE_ACCOUNT_REJECTED"
    | "SCOPE_INVENTORY_REJECTED"
    | "SCOPE_ANALYTICS_REJECTED"
    | "URL_SERIALIZATION"
    | "STATE_PARAMETER"
    | "STILL_UNPROVEN"
  testBase: PreflightState
  testBaseAccount: PreflightState
  testBaseAccountInventory: PreflightState
  testFullFourScopes: PreflightState
  canonicalWithState: PreflightState
  previousPlusEncodingWithState: PreflightState
  runameSource: "EBAY_RuName"
  runameAppBinding: "PASS" | "FAIL" | "UNPROVEN"
  currentScopeEncoding: "RFC3986_PERCENT20"
  previousScopeEncoding: "FORM_URLENCODED_PLUS"
  encodingCausesInvalidRequest: "YES" | "NO" | "UNPROVEN"
  stateCausesInvalidRequest: "YES" | "NO" | "UNPROVEN"
  stateFormatValid: boolean
  scopeCount: number
  scopeContractExact: boolean
  parameterNames: string[]
  externalCalls: number
  ledgerRowsCreated: number
  cookiesSet: number
  humanRedirects: number
  oauthConsentLaunched: boolean
  authorizationCodeExchangeCalls: number
  secretsReturned: boolean
  startAllowed: boolean
}

type DiagnosisPayload = {
  success?: boolean
  diagnosis?: Diagnosis
  error?: string
}

type RuntimeCredentialMatch = {
  RUNTIME_EBAY_CLIENT_ID_PRESENT: boolean
  RUNTIME_EBAY_CLIENT_ID_LENGTH_MATCH: boolean
  RUNTIME_EBAY_CLIENT_ID_SHA256_MATCH: boolean
  RUNTIME_EBAY_RUNAME_PRESENT: boolean
  RUNTIME_EBAY_RUNAME_LENGTH_MATCH: boolean
  RUNTIME_EBAY_RUNAME_SHA256_MATCH: boolean
  APP_ID_PORTAL_RUNTIME_MATCH: boolean
  RUNAME_PORTAL_RUNTIME_MATCH: boolean
  FINAL_BINDING_DIAGNOSIS:
    | "BOTH_MATCH"
    | "APP_ID_MATCH_RUNAME_MISMATCH"
    | "APP_ID_MISMATCH_RUNAME_MATCH"
    | "BOTH_MISMATCH"
    | "RUNTIME_CONFIGURATION_MISSING"
}

type RuntimeCredentialMatchPayload = {
  success?: boolean
  credentialMatch?: unknown
  error?: string
}

type InstalledRuntimeCertification = {
  credentialSource: "GENERIC_ENV_TOKEN_ONLY"
  genericEnvironmentTokenFallback: false
  refreshTokenPresent: true
  oauthRefreshExchange: "AVAILABLE"
  capabilities: {
    tradingBase: "AVAILABLE"
    inventoryReadonly: "AVAILABLE"
    analyticsReadonly: "AVAILABLE"
    accountReadonly: "AVAILABLE"
  }
  calls: Array<{
    operation: string
    method: "GET" | "POST"
    endpoint: string
    status: "SUCCEEDED" | "FAILED"
    httpStatus: number | null
    marketplaceMutation: false
    persisted: false
  }>
  safety: Record<string, false | 0>
}

type InstalledRuntimeCertificationPayload = {
  success?: boolean
  certification?: unknown
  error?: string
}

type InventoryConsumerDiagnostic = {
  credentialSource: "GENERIC_ENV_TOKEN_ONLY"
  genericEnvironmentTokenFallback: false
  inventoryItemsHttpStatus: number | null
  inventoryItemsAuthorized: boolean
  inventoryItemsContentType: "application/json" | "OTHER" | null
  inventoryItemsTopLevelKeys: string[]
  inventoryItemsHasArray: boolean
  inventoryItemsArrayCount: number | null
  inventoryItemsTotalPresent: boolean
  inventoryItemsTotal: number | null
  inventoryItemsNextPresent: boolean
  inventoryItemsResponseShape:
    | "INVENTORY_ITEMS_ARRAY"
    | "CERTIFIED_EMPTY_OMITTED_ARRAY"
    | "INVALID"
    | "UNPROVEN"
  inventoryCatalogState: "EMPTY" | "NON_EMPTY" | "UNPROVEN"
  inventoryItemsSafeErrorCategory: string
  variants: Record<
    "currentCanonical" | "noMarketplaceHeader" | "limitOnly" | "noQuery",
    InventoryConsumerVariantEvidence
  >
  firstAcceptedVariant: InventoryConsumerVariant | null
  minimumDocumentedAcceptedVariant: InventoryConsumerVariant | null
  requestContractRootCause:
    | "CURRENT_CANONICAL_ACCEPTED"
    | "MARKETPLACE_HEADER_REJECTED"
    | "OFFSET_ZERO_REJECTED"
    | "LIMIT_QUERY_REJECTED"
    | "SCOPE_MINTING_DIFFERENCE"
    | "ALL_DOCUMENTED_VARIANTS_REJECTED"
    | "UNPROVEN"
  scopeControl: {
    subsetScopeRefresh: "AVAILABLE" | "FAILED"
    fourScopeRefresh: "AVAILABLE" | "FAILED" | "NOT_RUN"
    subsetScopeInventoryItemsStatus: number | null
    fourScopeInventoryItemsStatus: number | null
    scopeMintingDifferenceCauses400: "YES" | "NO" | "UNPROVEN"
  }
  execution: {
    globalCallsBeforeInventory: number | null
    globalTimeRemainingBeforeInventoryMs: number | null
    inventoryRefreshExecuted: boolean
    inventoryGetUserExecuted: boolean
    inventoryGetItemsExecuted: boolean
    fourScopeRefreshExecuted: boolean
    fourScopeInventoryGetItemsExecuted: boolean
    inventoryFailureFromBudget: boolean
    externalCalls: number
    maximumExternalCalls: 8
  }
  calls: Array<{
    operation: string
    method: "GET" | "POST"
    endpoint: string
    status: "SUCCEEDED" | "FAILED"
    httpStatus: number | null
    observedAt: string
    marketplaceMutation: false
    persisted: false
  }>
  safety: Record<string, false | 0>
}

type InventoryConsumerVariant =
  | "CURRENT_CANONICAL"
  | "NO_MARKETPLACE_HEADER"
  | "LIMIT_ONLY"
  | "NO_QUERY"

type InventoryConsumerVariantEvidence = {
  variant: InventoryConsumerVariant
  httpStatus: number | null
  acceptedByEndpoint: boolean
  contentType: "application/json" | "OTHER" | null
  responseShape:
    | "INVENTORY_ITEMS_ARRAY"
    | "CERTIFIED_EMPTY_OMITTED_ARRAY"
    | "INVALID"
    | "UNPROVEN"
  catalogState: "EMPTY" | "NON_EMPTY" | "UNPROVEN"
  safeErrorCategory: string
  errorMetadata: {
    status: "CLASSIFIED" | "UNPROVEN"
    errorObjectCount: number | null
    errorIds: string[]
    domains: string[]
    categories: string[]
    parameterNames: string[]
    ERROR_25709_SAFE_FIELD_CLASS: "LIMIT" | "OFFSET" |
      "CONTENT_LANGUAGE" | "MARKETPLACE_HEADER" |
      "AUTHORIZATION" | "DOCUMENTED_OTHER" |
      "LITERAL_FIELDNAME_PLACEHOLDER" | "UNRECOGNIZED"
    MESSAGE_PREFIX_CLASS: "EXACT_INVALID_VALUE_FOR" |
      "INVALID_VALUE_VARIANT" | "OTHER"
    MESSAGE_SUFFIX_CLASS: "PERIOD" | "NO_PERIOD" | "OTHER"
    MESSAGE_LENGTH_BUCKET: "0_31" | "32_63" | "64_127" | "128_PLUS"
    MESSAGE_CONTAINS_OFFICIAL_INVALID_VALUE_PREFIX: "YES" | "NO"
    MESSAGE_CONTAINS_KNOWN_DOCUMENTED_FIELD_TOKEN: "YES" | "NO"
    ERROR_25709_FIELD_NAME: string
    ERROR_25709_MESSAGE_FORM: "SUBSTITUTED_FIELD" | "LITERAL_PLACEHOLDER" |
      "OTHER" | "NO_MESSAGE"
    FIELD_NAME_EXTRACTED_FROM_CERTIFIED_TEMPLATE: "YES" | "NO"
  }
}

type InventoryConsumerDiagnosticPayload = {
  success?: boolean
  inventoryConsumer?: unknown
  error?: string
}

type RegistryCoverageDiagnosticPayload = {
  success?: boolean
  registryCoverageDiagnostic?: unknown
  error?: string
}

type RegistryRepairDryRunPayload = {
  success?: boolean
  registryRepairDryRun?: unknown
  error?: unknown
  REJECTION_REASON?: unknown
  AMBIGUITY_CLASS?: unknown
  UNPROVEN_COMPONENT?: unknown
  UNPROVEN_COUNT?: unknown
  UNPROVEN_TOTAL_COUNT?: unknown
  BLOCKING_UNPROVEN_PRIMARY_SOURCE?: unknown
  BLOCKING_UNPROVEN_SECONDARY_SOURCES?: unknown
  RAW_UNPROVEN_COUNT?: unknown
  UNPROVEN_PRIMARY_REASON?: unknown
  UNPROVEN_REASON_MISSING_AUTHORITATIVE_ITEM_ID?: unknown
  UNPROVEN_REASON_DUPLICATE_ITEM_ID?: unknown
  UNPROVEN_REASON_MULTIPLE_REGISTRY_CANDIDATES?: unknown
  UNPROVEN_REASON_CROSS_LINK_CONFLICT?: unknown
  UNPROVEN_REASON_ACCOUNT_SCOPE?: unknown
  UNPROVEN_REASON_PARTITION_OVERLAP?: unknown
  UNPROVEN_REASON_SOURCE_EVIDENCE?: unknown
  UNPROVEN_REASON_OTHER?: unknown
  OTHER_SUBTYPE_COUNTS?: unknown
  RAW_CREATE_IDENTITY_CANDIDATE_COUNT?: unknown
  CREATE_IDENTITY_DETERMINISTIC_COUNT?: unknown
  CREATE_IDENTITY_UNPROVEN_COUNT?: unknown
  CREATE_MATERIALIZATION_PASS_COUNT?: unknown
  CREATE_MATERIALIZATION_UNPROVEN_COUNT?: unknown
  CREATE_ABSENCE_CAS_PASS_COUNT?: unknown
  CREATE_ABSENCE_CAS_UNPROVEN_COUNT?: unknown
  CREATE_MATERIALIZATION_STATUS?: unknown
  ABSENCE_PROOF_UNPROVEN_COUNT?: unknown
  ABSENCE_PROOF_CAUSE_ITEM_ID_ALREADY_PRESENT?: unknown
  ABSENCE_PROOF_CAUSE_ITEM_ID_LOOKUP_UNPROVEN?: unknown
  ABSENCE_PROOF_CAUSE_SKU_RELATION?: unknown
  ABSENCE_PROOF_CAUSE_SYNC_KEY_COLLISION?: unknown
  ABSENCE_PROOF_CAUSE_ACCOUNT_SCOPE?: unknown
  ABSENCE_PROOF_CAUSE_MULTIPLE_REGISTRY_ROWS?: unknown
  ABSENCE_PROOF_CAUSE_SECOND_READ_INCONSISTENCY?: unknown
  ABSENCE_PROOF_CAUSE_OTHER?: unknown
  ABSENCE_PROOF_PRIMARY_CAUSE?: unknown
  LIFECYCLE_UNPROVEN_ACTION?: unknown
  LIFECYCLE_UNPROVEN_STAGE?: unknown
  LIFECYCLE_REQUIRED_SIGNAL?: unknown
  LIFECYCLE_SIGNAL_AVAILABLE?: unknown
  LIFECYCLE_FAILURE_CAUSE?: unknown
  REPAIR_ROW_CURRENT_STATUS_CLASS?: unknown
  REPAIR_ROW_STATUS_RAW_VALUE_RECOGNIZED?: unknown
  REPAIR_ROW_STATUS_REACTIVATABLE?: unknown
  REPAIR_ROW_ACCOUNT_SCOPE_MATCH?: unknown
  REPAIR_ROW_AUTHORITATIVE_ITEM_ID_STILL_LIVE?: unknown
  REPAIR_ROW_ITEM_ID_UNIQUE_BOTH_SIDES?: unknown
  REPAIR_ROW_COMPETING_RELATIONSHIP?: unknown
  REGISTRY_LIFECYCLE_SUPPORTS_REACTIVATION?: unknown
  REACTIVATION_ALLOWED_FROM_STALE?: unknown
  REACTIVATION_ALLOWED_FROM_ENDED?: unknown
  REACTIVATION_ALLOWED_FROM_HISTORICAL?: unknown
  REACTIVATION_ALLOWED_FROM_UNKNOWN?: unknown
  REACTIVATION_CAS_SUPPORTED?: unknown
  FINAL_IDENTITY_UNPROVEN_COUNT?: unknown
  FINAL_PRECONDITION_UNPROVEN_COUNT?: unknown
  FINAL_REJECTION_REASON?: unknown
  REPAIR_EXISTING_AUTOMATIC_COUNT?: unknown
  HUMAN_REVIEW_REASON_REACTIVATION_NOT_ALLOWED_COUNT?: unknown
  IDENTITY_UNPROVEN_COUNT?: unknown
  AUTOMATIC_PRECONDITION_UNPROVEN_COUNT?: unknown
  AUTOMATIC_TRANCHE_PRECONDITIONS_PASS?: unknown
  HUMAN_REVIEW_WRITE_ALLOWED?: unknown
  HUMAN_REVIEW_MUTATION_COUNT?: unknown
}

const REGISTRY_COVERAGE_DIAGNOSTIC_KEYS = [
  "REGISTRY_RUNTIME_CONFIG",
  "SUPABASE_URL_PRESENT",
  "SUPABASE_SERVICE_ROLE_PRESENT",
  "REGISTRY_SOURCE_RUNTIME_STATUS",
  "LIVE_ENUMERATION_RUNTIME_STATUS",
  "REGISTRY_RECORD_COUNT",
  "LIVE_EBAY_LISTING_COUNT",
  "REGISTRY_MATCHED_COUNT",
  "REGISTRY_MISSING_COUNT",
  "REGISTRY_ORPHANED_COUNT",
  "REGISTRY_AMBIGUOUS_COUNT",
  "REGISTRY_COVERAGE_PERCENT",
  "REGISTRY_LIFECYCLE_FIELDS",
  "REGISTRY_PROVENANCE_FIELDS",
  "REGISTRY_HAS_ACTIVE_STATE",
  "REGISTRY_HAS_LAST_SEEN_SIGNAL",
  "REGISTRY_HAS_PRODUCT_CASE_LINK",
  "REGISTRY_HAS_SOURCE_ORIGIN",
  "LIVE_WITH_ITEM_ID_COUNT",
  "LIVE_WITH_SKU_COUNT",
  "LIVE_WITH_VARIATION_KEY_COUNT",
  "LIVE_WITH_COMPLETE_COMPOSITE_IDENTITY_COUNT",
  "REGISTRY_WITH_ITEM_ID_COUNT",
  "REGISTRY_WITH_SKU_COUNT",
  "REGISTRY_WITH_VARIATION_KEY_COUNT",
  "REGISTRY_WITH_COMPLETE_COMPOSITE_IDENTITY_COUNT",
  "ITEM_ID_EXACT_OVERLAP_COUNT",
  "SKU_EXACT_OVERLAP_COUNT",
  "VARIATION_KEY_EXACT_OVERLAP_COUNT",
  "ITEM_ID_PLUS_SKU_OVERLAP_COUNT",
  "ITEM_ID_PLUS_VARIATION_OVERLAP_COUNT",
  "SKU_PLUS_VARIATION_OVERLAP_COUNT",
  "FULL_COMPOSITE_OVERLAP_COUNT",
  "REGISTRY_CURRENT_IDENTITY_COUNT",
  "REGISTRY_LEGACY_IDENTITY_COUNT",
  "REGISTRY_INCOMPLETE_IDENTITY_COUNT",
  "REGISTRY_HISTORICAL_ONLY_COUNT",
  "REGISTRY_IDENTITY_UNPROVEN_COUNT",
  "REGISTRY_IDENTITY_ROOT_CAUSE",
  "SAFE_BACKFILL_WITHOUT_DUPLICATION",
  "LIVE_PARTITION_VALID",
  "REGISTRY_PARTITION_VALID",
  "REGISTRY_FULL_MATCH_ROWS",
  "REGISTRY_ITEM_ID_ONLY_ROWS",
  "ITEM_ID_ONLY_ROW_COUNT",
  "REGISTRY_SKU_ONLY_ROWS",
  "REGISTRY_CROSS_LINKED_ROWS",
  "REGISTRY_MULTIPLE_ITEM_ID_CANDIDATE_ROWS",
  "REGISTRY_MULTIPLE_SKU_CANDIDATE_ROWS",
  "REGISTRY_NO_STABLE_OVERLAP_ROWS",
  "REGISTRY_TOPOLOGY_UNPROVEN_ROWS",
  "REGISTRY_TOPOLOGY_PARTITION_VALID",
  "LIVE_REFERENCED_BY_REGISTRY_ITEM_ID_COUNT",
  "LIVE_REFERENCED_BY_REGISTRY_SKU_COUNT",
  "LIVE_REFERENCED_BY_BOTH_SAME_REGISTRY_ROW_COUNT",
  "LIVE_REFERENCED_BY_CONFLICTING_REGISTRY_ROWS_COUNT",
  "LIVE_WITH_NO_STABLE_REGISTRY_REFERENCE_COUNT",
  "CROSS_LINK_CONFLICT_COUNT",
  "ITEM_ID_ONLY_ITEM_ID_UNIQUE_BOTH_SIDES",
  "ITEM_ID_ONLY_REGISTRY_SKU_MATCHES_ANY_OTHER_LIVE_LISTING",
  "ITEM_ID_ONLY_LIVE_SKU_MATCHES_ANY_OTHER_REGISTRY_ROW",
  "ITEM_ID_ONLY_ACCOUNT_MARKETPLACE_COMPATIBLE",
  "ITEM_ID_ONLY_LIFECYCLE_CLASS",
  "ITEM_ID_ONLY_DETERMINISTIC_RELINK_POSSIBLE",
  "ITEM_ID_ANCHORED_RELINK_CANDIDATE_COUNT",
  "SKU_ANCHORED_RELINK_CANDIDATE_COUNT",
  "SKU_ONLY_REGISTRY_ITEM_ID_NOT_LIVE_COUNT",
  "SKU_ONLY_UNIQUE_SKU_BOTH_SIDES_COUNT",
  "SKU_ONLY_NO_COMPETING_REGISTRY_RELATION_COUNT",
  "SKU_ONLY_RELIST_CANDIDATE_COUNT",
  "SKU_ONLY_STALE_REGISTRY_ITEM_ID_COUNT",
  "SKU_ONLY_SKU_REUSE_RISK_COUNT",
  "SKU_ONLY_CONFLICTED_IDENTITY_COUNT",
  "SKU_ONLY_UNPROVEN_COUNT",
  "SKU_ONLY_DETERMINISTIC_RELINK_CANDIDATE_COUNT",
  "CONFLICTED_RELINK_CANDIDATE_COUNT",
  "NO_SAFE_RELINK_CANDIDATE_COUNT",
  "SAFE_RELINK_CANDIDATE_COUNT",
  "SAFE_AUTOMATED_RELINK",
  "NO_OVERLAP_HISTORICAL_OR_STALE_COUNT",
  "NO_OVERLAP_CURRENT_IDENTITY_DRIFT_COUNT",
  "NO_OVERLAP_UNRELATED_COUNT",
  "NO_OVERLAP_UNPROVEN_COUNT",
  "REGISTRY_STALE_ACTIVE_ROWS_PRESENT",
  "LIVE_NEW_REGISTRY_ENTRY_CANDIDATE_COUNT",
  "SAFE_NEW_ENTRY_BACKFILL_POSSIBLE",
  "CERTIFIED_EXISTING_RELATIONSHIP_COUNT",
  "CERTIFIED_RELINK_CANDIDATE_COUNT",
  "UNRESOLVED_RELATIONSHIP_COUNT",
  "TRUE_NEW_ENTRY_CANDIDATE_COUNT",
  "PLAN_RELINK_EXISTING_COUNT",
  "PLAN_CREATE_NEW_COUNT",
  "PLAN_MARK_STALE_OR_HISTORICAL_COUNT",
  "PLAN_REQUIRE_HUMAN_REVIEW_COUNT",
  "REGISTRY_REPAIR_PLAN_CERTIFIED",
  "AUTOMATED_MUTATION_SAFE",
  "IS_EBAY_ITEM_ID_AUTHORITATIVE_FOR_LISTING_IDENTITY",
  "IS_SKU_ALLOWED_AS_RELIST_CONTINUITY_SIGNAL",
  "VARIATION_KEY_REQUIRED_FOR_NON_VARIATION_LISTING",
  "EMPTY_VARIATION_IS_CANONIC_FOR_NON_VARIATION_LISTING",
  "VARIATION_SEMANTICS_CAUSE_CURRENT_ZERO_MATCH",
  "MANUAL_LISTING_RUNTIME_AUTODISCOVERY",
] as const

const REGISTRY_REPAIR_DRY_RUN_KEYS = [
  "DRY_RUN_LABEL",
  "EVIDENCE_STATUS",
  "DRY_RUN_PACKAGE_HANDLE",
  "CURRENT_LIVE_COUNT",
  "CURRENT_REGISTRY_COUNT",
  "CURRENT_EVIDENCE_FINGERPRINT",
  "DRY_RUN_FRESHNESS_STATUS",
  "DRY_RUN_STALE_LABEL",
  "DRY_RUN_REJECTION_REASON",
  "AMBIGUITY_CLASS",
  "UNPROVEN_COMPONENT",
  "UNPROVEN_COUNT",
  "REPAIR_EXISTING_UNPROVEN_COUNT",
  "MARK_STALE_UNPROVEN_COUNT",
  "CREATE_NEW_UNPROVEN_COUNT",
  "HUMAN_REVIEW_UNPROVEN_COUNT",
  "IDENTITY_PARTITION_UNPROVEN_COUNT",
  "REPAIR_EXISTING_UNPROVEN_SOURCE",
  "MARK_STALE_UNPROVEN_SOURCE",
  "CREATE_NEW_UNPROVEN_SOURCE",
  "HUMAN_REVIEW_UNPROVEN_SOURCE",
  "IDENTITY_PARTITION_UNPROVEN_SOURCE",
  "UNPROVEN_REPAIR_EXISTING_COUNT",
  "UNPROVEN_MARK_STALE_COUNT",
  "UNPROVEN_CREATE_NEW_COUNT",
  "UNPROVEN_HUMAN_REVIEW_COUNT",
  "UNPROVEN_IDENTITY_PARTITION_COUNT",
  "UNPROVEN_TOTAL_COUNT",
  "UNPROVEN_STATE_GUARD_COUNT",
  "UNPROVEN_SOURCE_READ_COUNT",
  "UNPROVEN_OTHER_COUNT",
  "BLOCKING_UNPROVEN_PRIMARY_SOURCE",
  "BLOCKING_UNPROVEN_SECONDARY_SOURCES",
  "RAW_ALREADY_MATCHED_COUNT",
  "RAW_REPAIR_EXISTING_COUNT",
  "RAW_CREATE_NEW_COUNT",
  "RAW_HUMAN_REVIEW_COUNT",
  "RAW_UNPROVEN_COUNT",
  "LIVE_RAW_PARTITION_VALID",
  "RAW_KEEP_CURRENT_COUNT",
  "RAW_REPAIR_EXISTING_REGISTRY_COUNT",
  "RAW_MARK_STALE_COUNT",
  "RAW_MARK_HISTORICAL_COUNT",
  "RAW_HUMAN_REVIEW_REGISTRY_COUNT",
  "RAW_UNPROVEN_REGISTRY_COUNT",
  "REGISTRY_RAW_PARTITION_VALID",
  "UNPROVEN_REASON_MISSING_AUTHORITATIVE_ITEM_ID",
  "UNPROVEN_REASON_DUPLICATE_ITEM_ID",
  "UNPROVEN_REASON_MULTIPLE_REGISTRY_CANDIDATES",
  "UNPROVEN_REASON_CROSS_LINK_CONFLICT",
  "UNPROVEN_REASON_ACCOUNT_SCOPE",
  "UNPROVEN_REASON_PARTITION_OVERLAP",
  "UNPROVEN_REASON_SOURCE_EVIDENCE",
  "UNPROVEN_REASON_OTHER",
  "UNPROVEN_PRIMARY_REASON",
  "OTHER_SUBTYPE_COUNTS",
  "OTHER_SUBTYPE_LISTING_IDENTITY_SHAPE_COUNT",
  "OTHER_SUBTYPE_CREATE_PAYLOAD_REQUIREMENT_COUNT",
  "OTHER_SUBTYPE_REGISTRY_ABSENCE_PROOF_COUNT",
  "OTHER_SUBTYPE_LIFECYCLE_REQUIREMENT_COUNT",
  "OTHER_SUBTYPE_NORMALIZATION_FAILURE_COUNT",
  "OTHER_SUBTYPE_UNEXPECTED_CLASSIFIER_BRANCH_COUNT",
  "RAW_CREATE_IDENTITY_CANDIDATE_COUNT",
  "CREATE_IDENTITY_DETERMINISTIC_COUNT",
  "CREATE_IDENTITY_UNPROVEN_COUNT",
  "CREATE_MATERIALIZATION_PASS_COUNT",
  "CREATE_MATERIALIZATION_UNPROVEN_COUNT",
  "CREATE_ABSENCE_CAS_PASS_COUNT",
  "CREATE_ABSENCE_CAS_UNPROVEN_COUNT",
  "CREATE_MATERIALIZATION_STATUS",
  "ABSENCE_PROOF_UNPROVEN_COUNT",
  "ABSENCE_PROOF_CAUSE_ITEM_ID_ALREADY_PRESENT",
  "ABSENCE_PROOF_CAUSE_ITEM_ID_LOOKUP_UNPROVEN",
  "ABSENCE_PROOF_CAUSE_SKU_RELATION",
  "ABSENCE_PROOF_CAUSE_SYNC_KEY_COLLISION",
  "ABSENCE_PROOF_CAUSE_ACCOUNT_SCOPE",
  "ABSENCE_PROOF_CAUSE_MULTIPLE_REGISTRY_ROWS",
  "ABSENCE_PROOF_CAUSE_SECOND_READ_INCONSISTENCY",
  "ABSENCE_PROOF_CAUSE_OTHER",
  "ABSENCE_PROOF_PRIMARY_CAUSE",
  "LIFECYCLE_UNPROVEN_ACTION",
  "LIFECYCLE_UNPROVEN_STAGE",
  "LIFECYCLE_REQUIRED_SIGNAL",
  "LIFECYCLE_SIGNAL_AVAILABLE",
  "LIFECYCLE_FAILURE_CAUSE",
  "REPAIR_ROW_CURRENT_STATUS_CLASS",
  "REPAIR_ROW_STATUS_RAW_VALUE_RECOGNIZED",
  "REPAIR_ROW_STATUS_REACTIVATABLE",
  "REPAIR_ROW_ACCOUNT_SCOPE_MATCH",
  "REPAIR_ROW_AUTHORITATIVE_ITEM_ID_STILL_LIVE",
  "REPAIR_ROW_ITEM_ID_UNIQUE_BOTH_SIDES",
  "REPAIR_ROW_COMPETING_RELATIONSHIP",
  "REGISTRY_LIFECYCLE_SUPPORTS_REACTIVATION",
  "REACTIVATION_ALLOWED_FROM_STALE",
  "REACTIVATION_ALLOWED_FROM_ENDED",
  "REACTIVATION_ALLOWED_FROM_HISTORICAL",
  "REACTIVATION_ALLOWED_FROM_UNKNOWN",
  "REACTIVATION_CAS_SUPPORTED",
  "FINAL_IDENTITY_UNPROVEN_COUNT",
  "FINAL_PRECONDITION_UNPROVEN_COUNT",
  "FINAL_REJECTION_REASON",
  "REPAIR_EXISTING_AUTOMATIC_COUNT",
  "HUMAN_REVIEW_REASON_REACTIVATION_NOT_ALLOWED_COUNT",
  "IDENTITY_UNPROVEN_COUNT",
  "AUTOMATIC_PRECONDITION_UNPROVEN_COUNT",
  "AUTOMATIC_TRANCHE_PRECONDITIONS_PASS",
  "HUMAN_REVIEW_WRITE_ALLOWED",
  "HUMAN_REVIEW_MUTATION_COUNT",
  "DRY_RUN_STATE_BOUND",
  "DRY_RUN_STATE_FINGERPRINT_PRESENT",
  "APPROVAL_INVALIDATES_ON_EBAY_STATE_CHANGE",
  "APPROVAL_INVALIDATES_ON_REGISTRY_STATE_CHANGE",
  "REPAIR_EXISTING_COUNT",
  "REPAIR_PRECONDITION_STATUS",
  "REPAIR_FIELDS_TO_CHANGE",
  "CREATE_NEW_COUNT",
  "CREATE_PRECONDITION_STATUS",
  "CREATE_FIELDS_TO_POPULATE",
  "MARK_STALE_COUNT",
  "STALE_PRECONDITION_STATUS",
  "STALE_FIELDS_TO_CHANGE",
  "HUMAN_REVIEW_COUNT",
  "HUMAN_REVIEW_CANDIDATES",
  "LIVE_ALREADY_MATCHED_COUNT",
  "LIVE_REPAIR_EXISTING_COUNT",
  "LIVE_CREATE_NEW_COUNT",
  "LIVE_HUMAN_REVIEW_COUNT",
  "LIVE_UNPROVEN_COUNT",
  "REGISTRY_KEEP_CURRENT_COUNT",
  "REGISTRY_REPAIR_EXISTING_COUNT",
  "REGISTRY_MARK_STALE_COUNT",
  "REGISTRY_MARK_HISTORICAL_COUNT",
  "REGISTRY_HUMAN_REVIEW_COUNT",
  "REGISTRY_UNPROVEN_COUNT",
  "LIVE_DRY_RUN_PARTITION_VALID",
  "REGISTRY_DRY_RUN_PARTITION_VALID",
  "WRITE_OPERATION_IDEMPOTENT",
  "STALE_STATE_GUARD_SUPPORTED",
  "LIVE_RECHECK_REQUIRED_BEFORE_WRITE",
  "PARTIAL_FAILURE_POLICY",
  "ROLLBACK_STRATEGY",
  "EXPECTED_MATCHED_AFTER_SAFE_TRANCHE",
  "EXPECTED_LIVE_COUNT",
  "EXPECTED_PENDING_HUMAN_REVIEW",
  "EXPECTED_COVERAGE_PERCENT",
  "DRY_RUN_READY_FOR_APPROVAL",
  "REGISTRY_MUTATIONS",
  "EBAY_WRITES",
  "PRODUCT_CASE_MUTATIONS",
  "INVENTORY_WRITES",
  "FULFILLMENT_WRITES",
  "OAUTH_CHANGES",
  "VERCEL_ENV_CHANGES",
] as const

const REGISTRY_REPAIR_HUMAN_CANDIDATE_KEYS = [
  "CANDIDATE_HANDLE",
  "RELATIONSHIP_TYPE",
  "REGISTRY_ITEM_ID_CURRENTLY_LIVE",
  "SKU_UNIQUE_BOTH_SIDES",
  "COMPETING_REGISTRY_RELATION",
  "RECOMMENDED_ACTION",
] as const

const REGISTRY_REPAIR_DRY_RUN_REJECTION_REASONS = [
  "REGISTRY_SOURCE_UNAVAILABLE",
  "LIVE_ENUMERATION_UNAVAILABLE",
  "ACCOUNT_BINDING_FAILED",
  "IDENTITY_PARTITION_INVALID",
  "REGISTRY_PARTITION_INVALID",
  "AMBIGUOUS_IDENTITY",
  "PRECONDITION_UNPROVEN",
  "STATE_CHANGED_DURING_SAME_REQUEST",
  "RESPONSE_CONTRACT_INVALID",
  "BUDGET_EXHAUSTED",
  "UNPROVEN",
] as const

const REGISTRY_REPAIR_AMBIGUITY_CLASSES = [
  "REVIEWABLE_ONLY",
  "BLOCKING_MULTIPLE_CANDIDATES",
  "BLOCKING_CROSS_LINK",
  "BLOCKING_DUPLICATE_AUTHORITY",
  "BLOCKING_PARTITION_CONFLICT",
  "BLOCKING_UNPROVEN",
  "NONE",
] as const

const REGISTRY_REPAIR_UNPROVEN_COMPONENTS = [
  "NONE",
  "REPAIR_EXISTING_MUTATION_GUARD",
  "MARK_STALE_MUTATION_GUARD",
  "CREATE_NEW_ABSENCE_OR_UNIQUENESS_GUARD",
  "CREATE_NEW_MATERIALIZATION",
  "LIFECYCLE_PRECONDITION",
  "HUMAN_REVIEW_EVIDENCE",
  "IDENTITY_PARTITION",
  "SAME_REQUEST_STATE",
  "MULTIPLE_COMPONENTS",
  "EVIDENCE_UNAVAILABLE",
] as const

const REGISTRY_REPAIR_UNPROVEN_SOURCES = [
  "NONE",
  "EXISTING_ROW_CAS",
  "ABSENCE_OR_UNIQUENESS_GUARD",
  "CREATE_MATERIALIZATION",
  "REVIEW_EVIDENCE",
  "IDENTITY_EVIDENCE",
  "SAME_REQUEST_STATE",
  "MULTIPLE",
  "EVIDENCE_UNAVAILABLE",
] as const

const REGISTRY_REPAIR_BLOCKING_UNPROVEN_SOURCES = [
  "NONE",
  "SOURCE_READ",
  "STATE_GUARD",
  "IDENTITY_PARTITION",
  "REPAIR_EXISTING",
  "MARK_STALE",
  "CREATE_NEW",
  "HUMAN_REVIEW",
  "OTHER",
] as const

const REGISTRY_REPAIR_UNPROVEN_PRIMARY_REASONS = [
  "NONE",
  "MISSING_AUTHORITATIVE_ITEM_ID",
  "DUPLICATE_ITEM_ID",
  "MULTIPLE_REGISTRY_CANDIDATES",
  "CROSS_LINK_CONFLICT",
  "ACCOUNT_SCOPE",
  "PARTITION_OVERLAP",
  "SOURCE_EVIDENCE",
  "OTHER",
] as const

const REGISTRY_REPAIR_UNPROVEN_REASON_COUNT_KEYS = [
  "UNPROVEN_REASON_MISSING_AUTHORITATIVE_ITEM_ID",
  "UNPROVEN_REASON_DUPLICATE_ITEM_ID",
  "UNPROVEN_REASON_MULTIPLE_REGISTRY_CANDIDATES",
  "UNPROVEN_REASON_CROSS_LINK_CONFLICT",
  "UNPROVEN_REASON_ACCOUNT_SCOPE",
  "UNPROVEN_REASON_PARTITION_OVERLAP",
  "UNPROVEN_REASON_SOURCE_EVIDENCE",
  "UNPROVEN_REASON_OTHER",
] as const

type RegistryRepairUnprovenReasonCounts = Record<
  typeof REGISTRY_REPAIR_UNPROVEN_REASON_COUNT_KEYS[number],
  number | "UNPROVEN"
>

const REGISTRY_REPAIR_OTHER_UNPROVEN_SUBTYPES = [
  "LISTING_IDENTITY_SHAPE",
  "CREATE_PAYLOAD_REQUIREMENT",
  "REGISTRY_ABSENCE_PROOF",
  "LIFECYCLE_REQUIREMENT",
  "NORMALIZATION_FAILURE",
  "UNEXPECTED_CLASSIFIER_BRANCH",
] as const

const REGISTRY_REPAIR_CREATE_STAGE_COUNT_KEYS = [
  "RAW_CREATE_IDENTITY_CANDIDATE_COUNT",
  "CREATE_IDENTITY_DETERMINISTIC_COUNT",
  "CREATE_IDENTITY_UNPROVEN_COUNT",
  "CREATE_MATERIALIZATION_PASS_COUNT",
  "CREATE_MATERIALIZATION_UNPROVEN_COUNT",
  "CREATE_ABSENCE_CAS_PASS_COUNT",
  "CREATE_ABSENCE_CAS_UNPROVEN_COUNT",
] as const

type RegistryRepairOtherSubtypeCounts = Record<
  EbayRegistryRepairOtherUnprovenSubtype,
  number | "UNPROVEN"
>

type RegistryRepairCreateStageCounts = Record<
  typeof REGISTRY_REPAIR_CREATE_STAGE_COUNT_KEYS[number],
  number | "UNPROVEN"
>

const REGISTRY_REPAIR_ABSENCE_PROOF_CAUSES = [
  "NONE",
  "ITEM_ID_ALREADY_PRESENT",
  "ITEM_ID_LOOKUP_UNPROVEN",
  "SKU_RELATION",
  "SYNC_KEY_COLLISION",
  "ACCOUNT_SCOPE",
  "MULTIPLE_REGISTRY_ROWS",
  "SECOND_READ_INCONSISTENCY",
  "OTHER",
  "UNPROVEN",
] as const

const REGISTRY_REPAIR_ABSENCE_PROOF_CAUSE_COUNT_KEYS = [
  "ABSENCE_PROOF_CAUSE_ITEM_ID_ALREADY_PRESENT",
  "ABSENCE_PROOF_CAUSE_ITEM_ID_LOOKUP_UNPROVEN",
  "ABSENCE_PROOF_CAUSE_SKU_RELATION",
  "ABSENCE_PROOF_CAUSE_SYNC_KEY_COLLISION",
  "ABSENCE_PROOF_CAUSE_ACCOUNT_SCOPE",
  "ABSENCE_PROOF_CAUSE_MULTIPLE_REGISTRY_ROWS",
  "ABSENCE_PROOF_CAUSE_SECOND_READ_INCONSISTENCY",
  "ABSENCE_PROOF_CAUSE_OTHER",
] as const

const REGISTRY_REPAIR_LIFECYCLE_ACTIONS = [
  "NONE",
  "REPAIR_EXISTING",
  "CREATE_NEW",
  "MARK_STALE",
  "HUMAN_REVIEW",
  "REGISTRY_PARTITION",
  "OTHER",
  "UNPROVEN",
] as const

const REGISTRY_REPAIR_LIFECYCLE_STAGES = [
  "NONE",
  "EXISTING_REGISTRY_ROW_ACTIVE_GUARD",
  "UNPROVEN",
] as const

const REGISTRY_REPAIR_LIFECYCLE_REQUIRED_SIGNALS = [
  "NONE",
  "LISTING_STATUS_ACTIVE",
  "UNPROVEN",
] as const

const REGISTRY_REPAIR_LIFECYCLE_FAILURE_CAUSES = [
  "NONE",
  "REGISTRY_ROW_NOT_ACTIVE",
  "REGISTRY_LISTING_STATUS_UNAVAILABLE",
  "REACTIVATION_NOT_ALLOWED",
  "MULTIPLE_FAILURES",
  "UNPROVEN",
] as const

const REGISTRY_REPAIR_ROW_STATUS_CLASSES = [
  "ACTIVE",
  "PAUSED",
  "DRAFT",
  "STALE",
  "ENDED",
  "HISTORICAL",
  "UNKNOWN",
  "OTHER",
  "UNPROVEN",
] as const

type RegistryRepairRowDiagnostic = {
  statusClass: EbayRegistryRepairRowStatusClass
  statusRawValueRecognized: "YES" | "NO" | "UNPROVEN"
  statusReactivatable: "YES" | "NO" | "UNPROVEN"
  accountScopeMatch: "YES" | "NO" | "UNPROVEN"
  authoritativeItemIdStillLive: "YES" | "NO" | "UNPROVEN"
  itemIdUniqueBothSides: "YES" | "NO" | "UNPROVEN"
  competingRelationship: "YES" | "NO" | "UNPROVEN"
  lifecycleSupportsReactivation: "YES" | "NO" | "UNPROVEN"
  reactivationAllowedFromStale: "YES" | "NO" | "UNPROVEN"
  reactivationAllowedFromEnded: "YES" | "NO" | "UNPROVEN"
  reactivationAllowedFromHistorical: "YES" | "NO" | "UNPROVEN"
  reactivationAllowedFromUnknown: "YES" | "NO" | "UNPROVEN"
  reactivationCasSupported: "YES" | "NO" | "UNPROVEN"
}

type RegistryRepairAbsenceProofCauseCounts = Record<
  typeof REGISTRY_REPAIR_ABSENCE_PROOF_CAUSE_COUNT_KEYS[number],
  number | "UNPROVEN"
>

type RegistryRepairLifecycleDiagnostic = {
  action: EbayRegistryRepairLifecycleAction
  stage: EbayRegistryRepairLifecycleStage
  requiredSignal: EbayRegistryRepairLifecycleRequiredSignal
  signalAvailable: "YES" | "NO" | "UNPROVEN"
  failureCause: EbayRegistryRepairLifecycleFailureCause
}

type RegistryRepairFinalDiagnostic = {
  identityUnprovenCount: number | "UNPROVEN"
  preconditionUnprovenCount: number | "UNPROVEN"
  rejectionReason: EbayRegistryRepairDryRunRejectionReason | null
}

function validRegistryRepairDryRunRejectionReason(
  value: unknown,
): value is EbayRegistryRepairDryRunRejectionReason {
  return REGISTRY_REPAIR_DRY_RUN_REJECTION_REASONS.some((reason) =>
    reason === value
  )
}

function validRegistryRepairAmbiguityClass(
  value: unknown,
): value is EbayRegistryRepairAmbiguityClass {
  return REGISTRY_REPAIR_AMBIGUITY_CLASSES.some((ambiguityClass) =>
    ambiguityClass === value
  )
}

function validRegistryRepairUnprovenComponent(
  value: unknown,
): value is EbayRegistryRepairUnprovenComponent {
  return REGISTRY_REPAIR_UNPROVEN_COMPONENTS.some((component) =>
    component === value
  )
}

function validRegistryRepairUnprovenSource(
  value: unknown,
): value is EbayRegistryRepairUnprovenSource {
  return REGISTRY_REPAIR_UNPROVEN_SOURCES.some((source) => source === value)
}

function validRegistryRepairUnprovenCount(
  value: unknown,
): value is number | "UNPROVEN" {
  return value === "UNPROVEN" ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
}

function validRegistryRepairBlockingUnprovenSource(
  value: unknown,
): value is EbayRegistryRepairBlockingUnprovenSource {
  return REGISTRY_REPAIR_BLOCKING_UNPROVEN_SOURCES.some((source) =>
    source === value
  )
}

function validRegistryRepairBlockingUnprovenSecondarySources(
  value: unknown,
): value is EbayRegistryRepairBlockingUnprovenSource[] {
  if (!Array.isArray(value) ||
      !value.every(validRegistryRepairBlockingUnprovenSource)) return false
  const indexes = value.map((source) =>
    REGISTRY_REPAIR_BLOCKING_UNPROVEN_SOURCES.indexOf(source)
  )
  return !value.includes("NONE") && new Set(value).size === value.length &&
    indexes.every((index, position) => position === 0 || index > indexes[position - 1])
}

function validRegistryRepairUnprovenPrimaryReason(
  value: unknown,
): value is EbayRegistryRepairUnprovenPrimaryReason {
  return REGISTRY_REPAIR_UNPROVEN_PRIMARY_REASONS.some((reason) =>
    reason === value
  )
}

function parseRegistryRepairUnprovenReasonCounts(
  value: unknown,
): RegistryRepairUnprovenReasonCounts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!REGISTRY_REPAIR_UNPROVEN_REASON_COUNT_KEYS.every((key) =>
    validRegistryRepairUnprovenCount(record[key])
  )) return null
  return Object.fromEntries(
    REGISTRY_REPAIR_UNPROVEN_REASON_COUNT_KEYS.map((key) => [key, record[key]]),
  ) as RegistryRepairUnprovenReasonCounts
}

function unavailableRegistryRepairUnprovenReasonCounts():
RegistryRepairUnprovenReasonCounts {
  return {
    UNPROVEN_REASON_MISSING_AUTHORITATIVE_ITEM_ID: "UNPROVEN",
    UNPROVEN_REASON_DUPLICATE_ITEM_ID: "UNPROVEN",
    UNPROVEN_REASON_MULTIPLE_REGISTRY_CANDIDATES: "UNPROVEN",
    UNPROVEN_REASON_CROSS_LINK_CONFLICT: "UNPROVEN",
    UNPROVEN_REASON_ACCOUNT_SCOPE: "UNPROVEN",
    UNPROVEN_REASON_PARTITION_OVERLAP: "UNPROVEN",
    UNPROVEN_REASON_SOURCE_EVIDENCE: "UNPROVEN",
    UNPROVEN_REASON_OTHER: "UNPROVEN",
  }
}

function parseRegistryRepairOtherSubtypeCounts(
  value: unknown,
): RegistryRepairOtherSubtypeCounts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join(",") !==
      [...REGISTRY_REPAIR_OTHER_UNPROVEN_SUBTYPES].sort().join(",") ||
      !REGISTRY_REPAIR_OTHER_UNPROVEN_SUBTYPES.every((key) =>
        validRegistryRepairUnprovenCount(record[key])
      )) return null
  return Object.fromEntries(
    REGISTRY_REPAIR_OTHER_UNPROVEN_SUBTYPES.map((key) => [key, record[key]]),
  ) as RegistryRepairOtherSubtypeCounts
}

function unavailableRegistryRepairOtherSubtypeCounts():
RegistryRepairOtherSubtypeCounts {
  return {
    LISTING_IDENTITY_SHAPE: "UNPROVEN",
    CREATE_PAYLOAD_REQUIREMENT: "UNPROVEN",
    REGISTRY_ABSENCE_PROOF: "UNPROVEN",
    LIFECYCLE_REQUIREMENT: "UNPROVEN",
    NORMALIZATION_FAILURE: "UNPROVEN",
    UNEXPECTED_CLASSIFIER_BRANCH: "UNPROVEN",
  }
}

function parseRegistryRepairCreateStageCounts(
  value: unknown,
): RegistryRepairCreateStageCounts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!REGISTRY_REPAIR_CREATE_STAGE_COUNT_KEYS.every((key) =>
    validRegistryRepairUnprovenCount(record[key])
  )) return null
  return Object.fromEntries(
    REGISTRY_REPAIR_CREATE_STAGE_COUNT_KEYS.map((key) => [key, record[key]]),
  ) as RegistryRepairCreateStageCounts
}

function unavailableRegistryRepairCreateStageCounts():
RegistryRepairCreateStageCounts {
  return {
    RAW_CREATE_IDENTITY_CANDIDATE_COUNT: "UNPROVEN",
    CREATE_IDENTITY_DETERMINISTIC_COUNT: "UNPROVEN",
    CREATE_IDENTITY_UNPROVEN_COUNT: "UNPROVEN",
    CREATE_MATERIALIZATION_PASS_COUNT: "UNPROVEN",
    CREATE_MATERIALIZATION_UNPROVEN_COUNT: "UNPROVEN",
    CREATE_ABSENCE_CAS_PASS_COUNT: "UNPROVEN",
    CREATE_ABSENCE_CAS_UNPROVEN_COUNT: "UNPROVEN",
  }
}

function validRegistryRepairAbsenceProofCause(
  value: unknown,
): value is EbayRegistryRepairAbsenceProofCause {
  return REGISTRY_REPAIR_ABSENCE_PROOF_CAUSES.some((cause) => cause === value)
}

function parseRegistryRepairAbsenceProofCauseCounts(
  value: unknown,
): RegistryRepairAbsenceProofCauseCounts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!REGISTRY_REPAIR_ABSENCE_PROOF_CAUSE_COUNT_KEYS.every((key) =>
    validRegistryRepairUnprovenCount(record[key])
  )) return null
  return Object.fromEntries(
    REGISTRY_REPAIR_ABSENCE_PROOF_CAUSE_COUNT_KEYS.map((key) =>
      [key, record[key]]
    ),
  ) as RegistryRepairAbsenceProofCauseCounts
}

function unavailableRegistryRepairAbsenceProofCauseCounts():
RegistryRepairAbsenceProofCauseCounts {
  return {
    ABSENCE_PROOF_CAUSE_ITEM_ID_ALREADY_PRESENT: "UNPROVEN",
    ABSENCE_PROOF_CAUSE_ITEM_ID_LOOKUP_UNPROVEN: "UNPROVEN",
    ABSENCE_PROOF_CAUSE_SKU_RELATION: "UNPROVEN",
    ABSENCE_PROOF_CAUSE_SYNC_KEY_COLLISION: "UNPROVEN",
    ABSENCE_PROOF_CAUSE_ACCOUNT_SCOPE: "UNPROVEN",
    ABSENCE_PROOF_CAUSE_MULTIPLE_REGISTRY_ROWS: "UNPROVEN",
    ABSENCE_PROOF_CAUSE_SECOND_READ_INCONSISTENCY: "UNPROVEN",
    ABSENCE_PROOF_CAUSE_OTHER: "UNPROVEN",
  }
}

function parseRegistryRepairLifecycleDiagnostic(
  value: unknown,
): RegistryRepairLifecycleDiagnostic | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const action = record.LIFECYCLE_UNPROVEN_ACTION
  const stage = record.LIFECYCLE_UNPROVEN_STAGE
  const requiredSignal = record.LIFECYCLE_REQUIRED_SIGNAL
  const signalAvailable = record.LIFECYCLE_SIGNAL_AVAILABLE
  const failureCause = record.LIFECYCLE_FAILURE_CAUSE
  if (!REGISTRY_REPAIR_LIFECYCLE_ACTIONS.some((entry) => entry === action) ||
      !REGISTRY_REPAIR_LIFECYCLE_STAGES.some((entry) => entry === stage) ||
      !REGISTRY_REPAIR_LIFECYCLE_REQUIRED_SIGNALS.some((entry) =>
        entry === requiredSignal
      ) ||
      !["YES", "NO", "UNPROVEN"].includes(String(signalAvailable)) ||
      !REGISTRY_REPAIR_LIFECYCLE_FAILURE_CAUSES.some((entry) =>
        entry === failureCause
      )) return null
  return {
    action: action as EbayRegistryRepairLifecycleAction,
    stage: stage as EbayRegistryRepairLifecycleStage,
    requiredSignal: requiredSignal as EbayRegistryRepairLifecycleRequiredSignal,
    signalAvailable: signalAvailable as "YES" | "NO" | "UNPROVEN",
    failureCause: failureCause as EbayRegistryRepairLifecycleFailureCause,
  }
}

function unavailableRegistryRepairLifecycleDiagnostic():
RegistryRepairLifecycleDiagnostic {
  return {
    action: "UNPROVEN",
    stage: "UNPROVEN",
    requiredSignal: "UNPROVEN",
    signalAvailable: "UNPROVEN",
    failureCause: "UNPROVEN",
  }
}

function parseRegistryRepairFinalDiagnostic(
  value: unknown,
): RegistryRepairFinalDiagnostic | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const rejectionReason = record.FINAL_REJECTION_REASON
  if (!validRegistryRepairUnprovenCount(record.FINAL_IDENTITY_UNPROVEN_COUNT) ||
      !validRegistryRepairUnprovenCount(
        record.FINAL_PRECONDITION_UNPROVEN_COUNT,
      ) ||
      !(rejectionReason === null ||
        validRegistryRepairDryRunRejectionReason(rejectionReason))) return null
  return {
    identityUnprovenCount: record.FINAL_IDENTITY_UNPROVEN_COUNT as
      number | "UNPROVEN",
    preconditionUnprovenCount: record.FINAL_PRECONDITION_UNPROVEN_COUNT as
      number | "UNPROVEN",
    rejectionReason,
  }
}

function unavailableRegistryRepairFinalDiagnostic():
RegistryRepairFinalDiagnostic {
  return {
    identityUnprovenCount: "UNPROVEN",
    preconditionUnprovenCount: "UNPROVEN",
    rejectionReason: "UNPROVEN",
  }
}

const RUNTIME_CREDENTIAL_MATCH_KEYS = [
  "RUNTIME_EBAY_CLIENT_ID_PRESENT",
  "RUNTIME_EBAY_CLIENT_ID_LENGTH_MATCH",
  "RUNTIME_EBAY_CLIENT_ID_SHA256_MATCH",
  "RUNTIME_EBAY_RUNAME_PRESENT",
  "RUNTIME_EBAY_RUNAME_LENGTH_MATCH",
  "RUNTIME_EBAY_RUNAME_SHA256_MATCH",
  "APP_ID_PORTAL_RUNTIME_MATCH",
  "RUNAME_PORTAL_RUNTIME_MATCH",
  "FINAL_BINDING_DIAGNOSIS",
] as const
const DIAGNOSIS_KEYS = [
  "rootCause",
  "testBase",
  "testBaseAccount",
  "testBaseAccountInventory",
  "testFullFourScopes",
  "canonicalWithState",
  "previousPlusEncodingWithState",
  "runameSource",
  "runameAppBinding",
  "currentScopeEncoding",
  "previousScopeEncoding",
  "encodingCausesInvalidRequest",
  "stateCausesInvalidRequest",
  "stateFormatValid",
  "scopeCount",
  "scopeContractExact",
  "parameterNames",
  "externalCalls",
  "ledgerRowsCreated",
  "cookiesSet",
  "humanRedirects",
  "oauthConsentLaunched",
  "authorizationCodeExchangeCalls",
  "secretsReturned",
  "startAllowed",
] as const
const EXPECTED_PARAMETER_NAMES = [
  "client_id",
  "response_type",
  "redirect_uri",
  "scope",
  "state",
] as const

const INSTALLED_CAPABILITY_KEYS = [
  "tradingBase",
  "inventoryReadonly",
  "analyticsReadonly",
  "accountReadonly",
] as const
const INSTALLED_SAFETY_KEYS = [
  "tokenPersisted",
  "tokenReturned",
  "authorizationCodeExchanged",
  "ledgerMutations",
  "ebayWrites",
  "inventoryWrites",
  "listingWrites",
  "promotionWrites",
  "fulfillmentWrites",
  "buyerMessageWrites",
  "whatsappDispatches",
  "businessDataMutations",
  "productCaseMutations",
  "registryMutations",
  "vaultMutations",
  "vercelMutations",
] as const
const INVENTORY_CONSUMER_KEYS = [
  "calls",
  "credentialSource",
  "execution",
  "genericEnvironmentTokenFallback",
  "inventoryCatalogState",
  "inventoryItemsArrayCount",
  "inventoryItemsAuthorized",
  "inventoryItemsContentType",
  "inventoryItemsHasArray",
  "inventoryItemsHttpStatus",
  "inventoryItemsNextPresent",
  "inventoryItemsResponseShape",
  "inventoryItemsSafeErrorCategory",
  "inventoryItemsTopLevelKeys",
  "inventoryItemsTotal",
  "inventoryItemsTotalPresent",
  "firstAcceptedVariant",
  "minimumDocumentedAcceptedVariant",
  "requestContractRootCause",
  "safety",
  "scopeControl",
  "variants",
] as const
const INVENTORY_CONSUMER_EXECUTION_KEYS = [
  "externalCalls",
  "fourScopeInventoryGetItemsExecuted",
  "fourScopeRefreshExecuted",
  "globalCallsBeforeInventory",
  "globalTimeRemainingBeforeInventoryMs",
  "inventoryFailureFromBudget",
  "inventoryGetItemsExecuted",
  "inventoryGetUserExecuted",
  "inventoryRefreshExecuted",
  "maximumExternalCalls",
] as const
const INVENTORY_CONSUMER_VARIANT_KEYS = [
  "acceptedByEndpoint",
  "catalogState",
  "contentType",
  "errorMetadata",
  "httpStatus",
  "responseShape",
  "safeErrorCategory",
  "variant",
] as const
const INVENTORY_ERROR_METADATA_KEYS = [
  "categories",
  "domains",
  "errorIds",
  "errorObjectCount",
  "ERROR_25709_FIELD_NAME",
  "ERROR_25709_MESSAGE_FORM",
  "ERROR_25709_SAFE_FIELD_CLASS",
  "FIELD_NAME_EXTRACTED_FROM_CERTIFIED_TEMPLATE",
  "MESSAGE_PREFIX_CLASS",
  "MESSAGE_SUFFIX_CLASS",
  "MESSAGE_LENGTH_BUCKET",
  "MESSAGE_CONTAINS_OFFICIAL_INVALID_VALUE_PREFIX",
  "MESSAGE_CONTAINS_KNOWN_DOCUMENTED_FIELD_TOKEN",
  "parameterNames",
  "status",
] as const
const INVENTORY_SCOPE_CONTROL_KEYS = [
  "fourScopeInventoryItemsStatus",
  "fourScopeRefresh",
  "scopeMintingDifferenceCauses400",
  "subsetScopeInventoryItemsStatus",
  "subsetScopeRefresh",
] as const
const INVENTORY_CONSUMER_SAFETY_KEYS = [
  "authorizationHeaderReturned",
  "businessDataMutations",
  "ebayWrites",
  "inventoryWrites",
  "ledgerMutations",
  "productCaseMutations",
  "rawPayloadReturned",
  "registryMutations",
  "tokenPersisted",
  "tokenReturned",
  "vaultMutations",
  "vercelMutations",
] as const

function validRegistryCoverageDiagnostic(
  value: unknown,
): value is EbayRegistryCoverageDiagnostic {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join(",") !==
      [...REGISTRY_COVERAGE_DIAGNOSTIC_KEYS].sort().join(",")) return false
  const countLike = (candidate: unknown) =>
    candidate === "UNPROVEN" ||
    (typeof candidate === "number" && Number.isSafeInteger(candidate) &&
      candidate >= 0)
  const nonEmptyText = (candidate: unknown) => typeof candidate === "string"
  const percent = (candidate: unknown) =>
    candidate === "UNPROVEN" ||
    (typeof candidate === "number" && Number.isFinite(candidate) &&
      candidate >= 0 && candidate <= 100)
  const yesNo = (candidate: unknown) => ["YES", "NO"].includes(String(candidate))
  const yesNoUnproven = (candidate: unknown) =>
    ["YES", "NO", "UNPROVEN"].includes(String(candidate))
  const itemIdMismatchClass = (candidate: unknown) =>
    ["CURRENT_LISTING_STALE_REGISTRY_SKU", "CONFLICTED_IDENTITY",
      "HISTORICAL_RELATION", "UNPROVEN"].includes(String(candidate))
  const lifecycleCause = (candidate: unknown) =>
    ["ITEM_ID_MISMATCH", "SKU_MISMATCH", "VARIATION_KEY_MISMATCH",
      "COMPOSITE_KEY_OVERSTRICT", "LEGACY_IDENTITY_CONTRACT",
      "REGISTRY_ROWS_HISTORICAL_ONLY", "MIXED_CAUSES", "UNPROVEN"
    ].includes(String(candidate))
  if (!["AVAILABLE", "MISSING", "FAILED"].includes(
    String(record.REGISTRY_RUNTIME_CONFIG),
  )) return false
  if (!["YES", "NO"].includes(String(record.SUPABASE_URL_PRESENT))) return false
  if (!["YES", "NO"].includes(
    String(record.SUPABASE_SERVICE_ROLE_PRESENT),
  )) return false
  if (!["AVAILABLE", "CONFIGURATION_MISSING", "READ_FAILED"].includes(
    String(record.REGISTRY_SOURCE_RUNTIME_STATUS),
  )) return false
  if (!countLike(record.REGISTRY_RECORD_COUNT) ||
    !countLike(record.LIVE_EBAY_LISTING_COUNT) ||
    !countLike(record.REGISTRY_MATCHED_COUNT) ||
    !countLike(record.REGISTRY_MISSING_COUNT) ||
    !countLike(record.REGISTRY_ORPHANED_COUNT) ||
    !countLike(record.REGISTRY_AMBIGUOUS_COUNT) ||
    !countLike(record.LIVE_WITH_ITEM_ID_COUNT) ||
    !countLike(record.LIVE_WITH_SKU_COUNT) ||
    !countLike(record.LIVE_WITH_VARIATION_KEY_COUNT) ||
    !countLike(record.LIVE_WITH_COMPLETE_COMPOSITE_IDENTITY_COUNT) ||
    !countLike(record.REGISTRY_WITH_ITEM_ID_COUNT) ||
    !countLike(record.REGISTRY_WITH_SKU_COUNT) ||
    !countLike(record.REGISTRY_WITH_VARIATION_KEY_COUNT) ||
    !countLike(record.REGISTRY_WITH_COMPLETE_COMPOSITE_IDENTITY_COUNT) ||
    !countLike(record.ITEM_ID_EXACT_OVERLAP_COUNT) ||
    !countLike(record.SKU_EXACT_OVERLAP_COUNT) ||
    !countLike(record.VARIATION_KEY_EXACT_OVERLAP_COUNT) ||
    !countLike(record.ITEM_ID_PLUS_SKU_OVERLAP_COUNT) ||
    !countLike(record.ITEM_ID_PLUS_VARIATION_OVERLAP_COUNT) ||
    !countLike(record.SKU_PLUS_VARIATION_OVERLAP_COUNT) ||
    !countLike(record.FULL_COMPOSITE_OVERLAP_COUNT) ||
    !nonEmptyText(record.REGISTRY_LIFECYCLE_FIELDS) ||
    !nonEmptyText(record.REGISTRY_PROVENANCE_FIELDS) ||
    !yesNo(record.REGISTRY_HAS_ACTIVE_STATE) ||
    !yesNo(record.REGISTRY_HAS_LAST_SEEN_SIGNAL) ||
    !yesNo(record.REGISTRY_HAS_PRODUCT_CASE_LINK) ||
    !yesNo(record.REGISTRY_HAS_SOURCE_ORIGIN) ||
    !countLike(record.REGISTRY_CURRENT_IDENTITY_COUNT) ||
    !countLike(record.REGISTRY_LEGACY_IDENTITY_COUNT) ||
    !countLike(record.REGISTRY_INCOMPLETE_IDENTITY_COUNT) ||
    !countLike(record.REGISTRY_HISTORICAL_ONLY_COUNT) ||
    !countLike(record.REGISTRY_IDENTITY_UNPROVEN_COUNT) ||
    !countLike(record.REGISTRY_FULL_MATCH_ROWS) ||
    !countLike(record.REGISTRY_ITEM_ID_ONLY_ROWS) ||
    !countLike(record.ITEM_ID_ONLY_ROW_COUNT) ||
    !countLike(record.REGISTRY_SKU_ONLY_ROWS) ||
    !countLike(record.REGISTRY_CROSS_LINKED_ROWS) ||
    !countLike(record.REGISTRY_MULTIPLE_ITEM_ID_CANDIDATE_ROWS) ||
    !countLike(record.REGISTRY_MULTIPLE_SKU_CANDIDATE_ROWS) ||
    !countLike(record.REGISTRY_NO_STABLE_OVERLAP_ROWS) ||
    !countLike(record.REGISTRY_TOPOLOGY_UNPROVEN_ROWS) ||
    !countLike(record.LIVE_REFERENCED_BY_REGISTRY_ITEM_ID_COUNT) ||
    !countLike(record.LIVE_REFERENCED_BY_REGISTRY_SKU_COUNT) ||
    !countLike(record.LIVE_REFERENCED_BY_BOTH_SAME_REGISTRY_ROW_COUNT) ||
    !countLike(record.LIVE_REFERENCED_BY_CONFLICTING_REGISTRY_ROWS_COUNT) ||
    !countLike(record.LIVE_WITH_NO_STABLE_REGISTRY_REFERENCE_COUNT) ||
    !countLike(record.CROSS_LINK_CONFLICT_COUNT) ||
    !yesNoUnproven(record.ITEM_ID_ONLY_ITEM_ID_UNIQUE_BOTH_SIDES) ||
    !yesNoUnproven(record.ITEM_ID_ONLY_REGISTRY_SKU_MATCHES_ANY_OTHER_LIVE_LISTING) ||
    !yesNoUnproven(record.ITEM_ID_ONLY_LIVE_SKU_MATCHES_ANY_OTHER_REGISTRY_ROW) ||
    !yesNoUnproven(record.ITEM_ID_ONLY_ACCOUNT_MARKETPLACE_COMPATIBLE) ||
    !itemIdMismatchClass(record.ITEM_ID_ONLY_LIFECYCLE_CLASS) ||
    !yesNoUnproven(record.ITEM_ID_ONLY_DETERMINISTIC_RELINK_POSSIBLE) ||
    !countLike(record.ITEM_ID_ANCHORED_RELINK_CANDIDATE_COUNT) ||
    !countLike(record.SKU_ANCHORED_RELINK_CANDIDATE_COUNT) ||
    !countLike(record.SKU_ONLY_REGISTRY_ITEM_ID_NOT_LIVE_COUNT) ||
    !countLike(record.SKU_ONLY_UNIQUE_SKU_BOTH_SIDES_COUNT) ||
    !countLike(record.SKU_ONLY_NO_COMPETING_REGISTRY_RELATION_COUNT) ||
    !countLike(record.SKU_ONLY_RELIST_CANDIDATE_COUNT) ||
    !countLike(record.SKU_ONLY_STALE_REGISTRY_ITEM_ID_COUNT) ||
    !countLike(record.SKU_ONLY_SKU_REUSE_RISK_COUNT) ||
    !countLike(record.SKU_ONLY_CONFLICTED_IDENTITY_COUNT) ||
    !countLike(record.SKU_ONLY_UNPROVEN_COUNT) ||
    !countLike(record.SKU_ONLY_DETERMINISTIC_RELINK_CANDIDATE_COUNT) ||
    !countLike(record.CONFLICTED_RELINK_CANDIDATE_COUNT) ||
    !countLike(record.NO_SAFE_RELINK_CANDIDATE_COUNT) ||
    !countLike(record.SAFE_RELINK_CANDIDATE_COUNT) ||
    !countLike(record.REGISTRY_IDENTITY_UNPROVEN_COUNT) ||
    !countLike(record.NO_OVERLAP_HISTORICAL_OR_STALE_COUNT) ||
    !countLike(record.NO_OVERLAP_CURRENT_IDENTITY_DRIFT_COUNT) ||
    !countLike(record.NO_OVERLAP_UNRELATED_COUNT) ||
    !countLike(record.NO_OVERLAP_UNPROVEN_COUNT) ||
    !yesNo(record.REGISTRY_STALE_ACTIVE_ROWS_PRESENT) ||
    !countLike(record.CERTIFIED_EXISTING_RELATIONSHIP_COUNT) ||
    !countLike(record.CERTIFIED_RELINK_CANDIDATE_COUNT) ||
    !countLike(record.UNRESOLVED_RELATIONSHIP_COUNT) ||
    !countLike(record.TRUE_NEW_ENTRY_CANDIDATE_COUNT) ||
    !countLike(record.PLAN_RELINK_EXISTING_COUNT) ||
    !countLike(record.PLAN_CREATE_NEW_COUNT) ||
    !countLike(record.PLAN_MARK_STALE_OR_HISTORICAL_COUNT) ||
    !countLike(record.PLAN_REQUIRE_HUMAN_REVIEW_COUNT) ||
    !yesNoUnproven(record.REGISTRY_REPAIR_PLAN_CERTIFIED) ||
    !yesNoUnproven(record.AUTOMATED_MUTATION_SAFE) ||
    !yesNoUnproven(record.IS_EBAY_ITEM_ID_AUTHORITATIVE_FOR_LISTING_IDENTITY) ||
    !yesNoUnproven(record.IS_SKU_ALLOWED_AS_RELIST_CONTINUITY_SIGNAL) ||
    !percent(record.REGISTRY_COVERAGE_PERCENT) ||
    !["AVAILABLE", "AUTH_UNAVAILABLE", "READ_FAILED"].includes(
      String(record.LIVE_ENUMERATION_RUNTIME_STATUS),
    )) return false
  if (!lifecycleCause(record.REGISTRY_IDENTITY_ROOT_CAUSE)) return false
  if (!["YES", "NO", "UNPROVEN"].includes(
    String(record.SAFE_BACKFILL_WITHOUT_DUPLICATION),
  )) return false
  if (!["YES", "NO"].includes(String(record.LIVE_PARTITION_VALID)) ||
    !["YES", "NO"].includes(String(record.REGISTRY_PARTITION_VALID)) ||
    !["YES", "NO"].includes(
      String(record.REGISTRY_TOPOLOGY_PARTITION_VALID),
    ) ||
    !["PASS", "PARTIAL", "FAIL", "UNPROVEN"].includes(
      String(record.MANUAL_LISTING_RUNTIME_AUTODISCOVERY),
    ) ||
    !["YES", "NO", "UNPROVEN"].includes(
      String(record.SAFE_AUTOMATED_RELINK),
    ) ||
    !["YES", "NO", "UNPROVEN"].includes(
      String(record.SAFE_NEW_ENTRY_BACKFILL_POSSIBLE),
    ) ||
    !["YES", "NO", "UNPROVEN"].includes(
      String(record.VARIATION_KEY_REQUIRED_FOR_NON_VARIATION_LISTING),
    ) ||
    !["YES", "NO", "UNPROVEN"].includes(
      String(record.EMPTY_VARIATION_IS_CANONIC_FOR_NON_VARIATION_LISTING),
    ) ||
    !["YES", "NO", "UNPROVEN"].includes(
      String(record.VARIATION_SEMANTICS_CAUSE_CURRENT_ZERO_MATCH),
    )) return false
  return true
}

function validRuntimeCredentialMatch(
  value: unknown,
): value is RuntimeCredentialMatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join(",") !==
      [...RUNTIME_CREDENTIAL_MATCH_KEYS].sort().join(",")) return false
  if (RUNTIME_CREDENTIAL_MATCH_KEYS.slice(0, -1).some(
    (key) => typeof record[key] !== "boolean",
  )) return false
  return [
    "BOTH_MATCH",
    "APP_ID_MATCH_RUNAME_MISMATCH",
    "APP_ID_MISMATCH_RUNAME_MATCH",
    "BOTH_MISMATCH",
    "RUNTIME_CONFIGURATION_MISSING",
  ].includes(String(record.FINAL_BINDING_DIAGNOSIS))
}

function runtimeCredentialMatchAllowsStart(
  value: RuntimeCredentialMatch | null,
) {
  return validRuntimeCredentialMatch(value) &&
    RUNTIME_CREDENTIAL_MATCH_KEYS.slice(0, -1).every(
      (key) => value[key] === true,
    ) && value.FINAL_BINDING_DIAGNOSIS === "BOTH_MATCH"
}

function validInstalledRuntimeCertification(
  value: unknown,
): value is InstalledRuntimeCertification {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join(",") !== [
    "calls",
    "capabilities",
    "credentialSource",
    "genericEnvironmentTokenFallback",
    "oauthRefreshExchange",
    "refreshTokenPresent",
    "safety",
  ].sort().join(",") ||
      record.credentialSource !== "GENERIC_ENV_TOKEN_ONLY" ||
      record.genericEnvironmentTokenFallback !== false ||
      record.refreshTokenPresent !== true ||
      record.oauthRefreshExchange !== "AVAILABLE") return false
  if (!record.capabilities || typeof record.capabilities !== "object" ||
      Array.isArray(record.capabilities)) return false
  const capabilities = record.capabilities as Record<string, unknown>
  if (Object.keys(capabilities).sort().join(",") !==
      [...INSTALLED_CAPABILITY_KEYS].sort().join(",") ||
      INSTALLED_CAPABILITY_KEYS.some((key) =>
        capabilities[key] !== "AVAILABLE")) return false
  if (!record.safety || typeof record.safety !== "object" ||
      Array.isArray(record.safety)) return false
  const safety = record.safety as Record<string, unknown>
  if (Object.keys(safety).sort().join(",") !==
      [...INSTALLED_SAFETY_KEYS].sort().join(",") ||
      INSTALLED_SAFETY_KEYS.some((key) =>
        safety[key] !== (key.endsWith("Mutations") ||
            key.endsWith("Writes") || key === "ledgerMutations" ||
            key === "whatsappDispatches" ? 0 : false))) return false
  if (!Array.isArray(record.calls) || record.calls.length !== 5) return false
  const operations = new Set([
    "OAUTH_EXACT_UNION_REFRESH",
    "TRADING_GET_USER",
    "INVENTORY_GET_LOCATIONS_SCOPE_PROBE",
    "ANALYTICS_TRAFFIC_REPORT_SCOPE_PROBE",
    "ACCOUNT_PRIVILEGE_SCOPE_PROBE",
  ])
  return record.calls.every((candidate) => {
    if (!candidate || typeof candidate !== "object" ||
        Array.isArray(candidate)) return false
    const call = candidate as Record<string, unknown>
    return Object.keys(call).sort().join(",") === [
      "endpoint",
      "httpStatus",
      "marketplaceMutation",
      "method",
      "operation",
      "persisted",
      "status",
    ].join(",") && operations.has(String(call.operation)) &&
      (call.method === "GET" || call.method === "POST") &&
      typeof call.endpoint === "string" &&
      String(call.endpoint).startsWith("/") &&
      call.status === "SUCCEEDED" &&
      typeof call.httpStatus === "number" &&
      call.marketplaceMutation === false && call.persisted === false
  })
}

function validInventoryConsumerDiagnostic(
  value: unknown,
): value is InventoryConsumerDiagnostic {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join(",") !==
      [...INVENTORY_CONSUMER_KEYS].sort().join(",") ||
      record.credentialSource !== "GENERIC_ENV_TOKEN_ONLY" ||
      record.genericEnvironmentTokenFallback !== false ||
      typeof record.inventoryItemsAuthorized !== "boolean" ||
      !["application/json", "OTHER", null].includes(
        record.inventoryItemsContentType as never,
      ) ||
      !["INVENTORY_ITEMS_ARRAY", "CERTIFIED_EMPTY_OMITTED_ARRAY",
        "INVALID", "UNPROVEN"].includes(
        String(record.inventoryItemsResponseShape),
      ) ||
      !["EMPTY", "NON_EMPTY", "UNPROVEN"].includes(
        String(record.inventoryCatalogState),
      ) ||
      !["NONE", "INVALID_SCOPE", "INVALID_GRANT", "INVALID_CLIENT",
        "INVALID_REQUEST", "UNSUPPORTED_GRANT_TYPE",
        "OAUTH_ERROR_UNCLASSIFIED", "HTTP_401", "HTTP_403", "HTTP_4XX",
        "HTTP_5XX", "RATE_LIMITED", "TIMEOUT", "NETWORK",
        "BUDGET_EXHAUSTED", "ACCOUNT_BINDING_FAILED",
        "RESPONSE_FORMAT_CHANGED", "CONFIGURATION_MISSING",
        "UNCLASSIFIED"].includes(String(
        record.inventoryItemsSafeErrorCategory,
      ))) return false
  const nullableInteger = (candidate: unknown) => candidate === null ||
    (typeof candidate === "number" && Number.isSafeInteger(candidate) &&
      candidate >= 0)
  const safeErrorCategories = new Set([
    "NONE", "INVALID_SCOPE", "INVALID_GRANT", "INVALID_CLIENT",
    "INVALID_REQUEST", "UNSUPPORTED_GRANT_TYPE",
    "OAUTH_ERROR_UNCLASSIFIED", "HTTP_401", "HTTP_403", "HTTP_4XX",
    "HTTP_5XX", "RATE_LIMITED", "TIMEOUT", "NETWORK",
    "BUDGET_EXHAUSTED", "ACCOUNT_BINDING_FAILED",
    "RESPONSE_FORMAT_CHANGED", "CONFIGURATION_MISSING", "UNCLASSIFIED",
  ])
  if (!nullableInteger(record.inventoryItemsHttpStatus) ||
      (typeof record.inventoryItemsHttpStatus === "number" &&
        (record.inventoryItemsHttpStatus < 100 ||
          record.inventoryItemsHttpStatus > 599)) ||
      !nullableInteger(record.inventoryItemsArrayCount) ||
      !nullableInteger(record.inventoryItemsTotal) ||
      typeof record.inventoryItemsHasArray !== "boolean" ||
      typeof record.inventoryItemsTotalPresent !== "boolean" ||
      typeof record.inventoryItemsNextPresent !== "boolean" ||
      !Array.isArray(record.inventoryItemsTopLevelKeys) ||
      record.inventoryItemsTopLevelKeys.length > 16 ||
      record.inventoryItemsTopLevelKeys.some((key) =>
        typeof key !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) ||
      [...record.inventoryItemsTopLevelKeys].sort().join(",") !==
        record.inventoryItemsTopLevelKeys.join(",")) return false

  if (!record.variants || typeof record.variants !== "object" ||
      Array.isArray(record.variants)) return false
  const variants = record.variants as Record<string, unknown>
  const variantEntries = [
    ["currentCanonical", "CURRENT_CANONICAL"],
    ["noMarketplaceHeader", "NO_MARKETPLACE_HEADER"],
    ["limitOnly", "LIMIT_ONLY"],
    ["noQuery", "NO_QUERY"],
  ] as const
  if (Object.keys(variants).sort().join(",") !==
      variantEntries.map(([key]) => key).sort().join(",")) return false
  const validSortedUniqueStrings = (
    candidate: unknown,
    pattern: RegExp,
    maximum: number,
  ) => Array.isArray(candidate) && candidate.length <= maximum &&
    candidate.every((entry) =>
      typeof entry === "string" && pattern.test(entry)) &&
    [...candidate].sort().join(",") === candidate.join(",") &&
    new Set(candidate).size === candidate.length
  const parsedVariants: InventoryConsumerVariantEvidence[] = []
  for (const [key, expectedVariant] of variantEntries) {
    const candidate = variants[key]
    if (!candidate || typeof candidate !== "object" ||
        Array.isArray(candidate)) return false
    const variant = candidate as Record<string, unknown>
    if (Object.keys(variant).sort().join(",") !==
        [...INVENTORY_CONSUMER_VARIANT_KEYS].sort().join(",") ||
        variant.variant !== expectedVariant ||
        typeof variant.acceptedByEndpoint !== "boolean" ||
        !nullableInteger(variant.httpStatus) ||
        (typeof variant.httpStatus === "number" &&
          (variant.httpStatus < 100 || variant.httpStatus > 599)) ||
        !["application/json", "OTHER", null].includes(
          variant.contentType as never,
        ) ||
        !["INVENTORY_ITEMS_ARRAY", "CERTIFIED_EMPTY_OMITTED_ARRAY",
          "INVALID", "UNPROVEN"].includes(String(variant.responseShape)) ||
        !["EMPTY", "NON_EMPTY", "UNPROVEN"].includes(
          String(variant.catalogState),
        ) || !safeErrorCategories.has(String(variant.safeErrorCategory)) ||
        (variant.acceptedByEndpoint &&
          (typeof variant.httpStatus !== "number" ||
            variant.httpStatus < 200 || variant.httpStatus > 299))) return false
    const errorMetadata = variant.errorMetadata
    if (!errorMetadata || typeof errorMetadata !== "object" ||
        Array.isArray(errorMetadata)) return false
    const error = errorMetadata as Record<string, unknown>
    if (Object.keys(error).sort().join(",") !==
        [...INVENTORY_ERROR_METADATA_KEYS].sort().join(",") ||
        !["CLASSIFIED", "UNPROVEN"].includes(String(error.status)) ||
        !nullableInteger(error.errorObjectCount) ||
        !validSortedUniqueStrings(error.errorIds, /^\d{1,10}$/, 10) ||
        !validSortedUniqueStrings(
          error.domains,
          /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/,
          10,
        ) ||
        !validSortedUniqueStrings(
          error.categories,
          /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/,
          10,
        ) ||
        !validSortedUniqueStrings(
          error.parameterNames,
          /^[A-Za-z][A-Za-z0-9_.\[\]-]{0,79}$/,
          200,
        )) return false
    if (typeof error.ERROR_25709_FIELD_NAME !== "string" ||
        !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.ERROR_25709_FIELD_NAME) &&
        error.ERROR_25709_FIELD_NAME !== "UNPROVEN") return false
    if (!["SUBSTITUTED_FIELD", "LITERAL_PLACEHOLDER", "OTHER",
      "NO_MESSAGE"].includes(String(error.ERROR_25709_MESSAGE_FORM))) return false
    if (!["LIMIT", "OFFSET", "CONTENT_LANGUAGE", "MARKETPLACE_HEADER",
      "AUTHORIZATION", "DOCUMENTED_OTHER", "LITERAL_FIELDNAME_PLACEHOLDER",
      "UNRECOGNIZED"].includes(String(error.ERROR_25709_SAFE_FIELD_CLASS))) return false
    if (!["EXACT_INVALID_VALUE_FOR", "INVALID_VALUE_VARIANT", "OTHER"].includes(
      String(error.MESSAGE_PREFIX_CLASS))) return false
    if (!["PERIOD", "NO_PERIOD", "OTHER"].includes(
      String(error.MESSAGE_SUFFIX_CLASS))) return false
    if (!["0_31", "32_63", "64_127", "128_PLUS"].includes(
      String(error.MESSAGE_LENGTH_BUCKET))) return false
    if (!["YES", "NO"].includes(
      String(error.MESSAGE_CONTAINS_OFFICIAL_INVALID_VALUE_PREFIX))) return false
    if (!["YES", "NO"].includes(
      String(error.MESSAGE_CONTAINS_KNOWN_DOCUMENTED_FIELD_TOKEN))) return false
    if (!["YES", "NO"].includes(
      String(error.FIELD_NAME_EXTRACTED_FROM_CERTIFIED_TEMPLATE),
    )) return false
    if (error.status === "CLASSIFIED") {
      if (typeof error.errorObjectCount !== "number" ||
          error.errorObjectCount < 1 || error.errorObjectCount > 10 ||
          (error.errorIds as string[]).length < 1 ||
          (error.domains as string[]).length < 1 ||
          (error.categories as string[]).length < 1 ||
          variant.contentType !== "application/json" ||
          variant.acceptedByEndpoint) return false
    } else if (error.errorObjectCount !== null ||
        (error.errorIds as string[]).length !== 0 ||
        (error.domains as string[]).length !== 0 ||
        (error.categories as string[]).length !== 0 ||
        (error.parameterNames as string[]).length !== 0) return false

    const status = variant.httpStatus as number | null
    if (status === null) {
      if (variant.acceptedByEndpoint || variant.contentType !== null ||
          variant.responseShape !== "UNPROVEN" ||
          variant.catalogState !== "UNPROVEN" ||
          !["TIMEOUT", "NETWORK", "BUDGET_EXHAUSTED", "UNCLASSIFIED"]
            .includes(String(variant.safeErrorCategory))) return false
    } else if (status < 200 || status > 599) {
      return false
    } else if (status === 200) {
      const shapeAccepted = variant.contentType === "application/json" &&
        ["INVENTORY_ITEMS_ARRAY", "CERTIFIED_EMPTY_OMITTED_ARRAY"]
          .includes(String(variant.responseShape))
      const shapeRejected = variant.responseShape === "INVALID" &&
        variant.catalogState === "UNPROVEN" &&
        variant.safeErrorCategory === "RESPONSE_FORMAT_CHANGED"
      if (!variant.acceptedByEndpoint || (!shapeAccepted && !shapeRejected) ||
          (shapeAccepted && variant.safeErrorCategory !== "NONE") ||
          (variant.responseShape === "CERTIFIED_EMPTY_OMITTED_ARRAY" &&
            variant.catalogState !== "EMPTY") ||
          error.status !== "UNPROVEN") return false
    } else if (status < 400) {
      if (variant.acceptedByEndpoint ||
          variant.responseShape !== "UNPROVEN" ||
          variant.catalogState !== "UNPROVEN" ||
          variant.safeErrorCategory !== "RESPONSE_FORMAT_CHANGED" ||
          error.status !== "UNPROVEN") return false
    } else {
      const expectedCategory = status === 401
        ? "HTTP_401"
        : status === 403
          ? "HTTP_403"
          : status === 429
            ? "RATE_LIMITED"
            : status >= 500
              ? "HTTP_5XX"
              : "HTTP_4XX"
      if (variant.acceptedByEndpoint || variant.responseShape !== "UNPROVEN" ||
          variant.catalogState !== "UNPROVEN" ||
          variant.safeErrorCategory !== expectedCategory ||
          (variant.contentType !== "application/json" &&
            error.status !== "UNPROVEN")) return false
    }
    parsedVariants.push(candidate as InventoryConsumerVariantEvidence)
  }
  const allowedVariants = [
    "CURRENT_CANONICAL",
    "NO_MARKETPLACE_HEADER",
    "LIMIT_ONLY",
    "NO_QUERY",
  ]
  if (![...allowedVariants, null].includes(record.firstAcceptedVariant as never) ||
      !["NO_MARKETPLACE_HEADER", "LIMIT_ONLY", "NO_QUERY", null].includes(
        record.minimumDocumentedAcceptedVariant as never,
      ) || ![
        "CURRENT_CANONICAL_ACCEPTED",
        "MARKETPLACE_HEADER_REJECTED",
        "OFFSET_ZERO_REJECTED",
        "LIMIT_QUERY_REJECTED",
        "SCOPE_MINTING_DIFFERENCE",
        "ALL_DOCUMENTED_VARIANTS_REJECTED",
        "UNPROVEN",
      ].includes(String(record.requestContractRootCause))) return false
  const computedFirst = parsedVariants.find((variant) =>
    variant.acceptedByEndpoint)?.variant ?? null
  const computedMinimum = parsedVariants.slice(1).reverse().find((variant) =>
    variant.acceptedByEndpoint)?.variant ?? null
  if (record.firstAcceptedVariant !== computedFirst ||
      record.minimumDocumentedAcceptedVariant !== computedMinimum) return false
  const canonical = parsedVariants[0]
  if (record.inventoryItemsHttpStatus !== canonical.httpStatus ||
      record.inventoryItemsAuthorized !== canonical.acceptedByEndpoint ||
      record.inventoryItemsContentType !== canonical.contentType ||
      record.inventoryItemsResponseShape !== canonical.responseShape ||
      record.inventoryCatalogState !== canonical.catalogState ||
      (canonical.safeErrorCategory !== "UNCLASSIFIED" &&
        record.inventoryItemsSafeErrorCategory !==
          canonical.safeErrorCategory)) {
    return false
  }

  if (!record.scopeControl || typeof record.scopeControl !== "object" ||
      Array.isArray(record.scopeControl)) return false
  const scopeControl = record.scopeControl as Record<string, unknown>
  if (Object.keys(scopeControl).sort().join(",") !==
      [...INVENTORY_SCOPE_CONTROL_KEYS].sort().join(",") ||
      !["AVAILABLE", "FAILED"].includes(
        String(scopeControl.subsetScopeRefresh),
      ) || !["AVAILABLE", "FAILED", "NOT_RUN"].includes(
        String(scopeControl.fourScopeRefresh),
      ) || !nullableInteger(scopeControl.subsetScopeInventoryItemsStatus) ||
      !nullableInteger(scopeControl.fourScopeInventoryItemsStatus) ||
      !["YES", "NO", "UNPROVEN"].includes(
        String(scopeControl.scopeMintingDifferenceCauses400),
      )) return false
  const allSubset400 = parsedVariants.every((variant) =>
    variant.httpStatus === 400)
  const anySubsetAccepted = parsedVariants.some((variant) =>
    variant.acceptedByEndpoint)
  const fourStatus = scopeControl.fourScopeInventoryItemsStatus as
    number | null
  const fourAccepted = fourStatus === 200
  const expectedScopeCause = anySubsetAccepted
    ? "NO"
    : allSubset400 && fourAccepted
      ? "YES"
      : allSubset400 && fourStatus === 400
        ? "NO"
        : "UNPROVEN"
  const expectedRootCause = canonical.acceptedByEndpoint
    ? "CURRENT_CANONICAL_ACCEPTED"
    : canonical.httpStatus === 400 && parsedVariants[1].acceptedByEndpoint
      ? "MARKETPLACE_HEADER_REJECTED"
      : canonical.httpStatus === 400 &&
          parsedVariants[1].httpStatus === 400 &&
          parsedVariants[2].acceptedByEndpoint
        ? "OFFSET_ZERO_REJECTED"
        : canonical.httpStatus === 400 &&
            parsedVariants[1].httpStatus === 400 &&
            parsedVariants[2].httpStatus === 400 &&
            parsedVariants[3].acceptedByEndpoint
          ? "LIMIT_QUERY_REJECTED"
          : allSubset400 && fourAccepted
            ? "SCOPE_MINTING_DIFFERENCE"
            : allSubset400 && fourStatus === 400
              ? "ALL_DOCUMENTED_VARIANTS_REJECTED"
              : "UNPROVEN"
  if (scopeControl.subsetScopeInventoryItemsStatus !==
        parsedVariants[3].httpStatus ||
      scopeControl.scopeMintingDifferenceCauses400 !== expectedScopeCause ||
      record.requestContractRootCause !== expectedRootCause ||
      (!allSubset400 && (scopeControl.fourScopeRefresh !== "NOT_RUN" ||
        fourStatus !== null))) return false

  if (!record.execution || typeof record.execution !== "object" ||
      Array.isArray(record.execution)) return false
  const execution = record.execution as Record<string, unknown>
  if (Object.keys(execution).sort().join(",") !==
      [...INVENTORY_CONSUMER_EXECUTION_KEYS].sort().join(",") ||
      execution.maximumExternalCalls !== 8 ||
      !nullableInteger(execution.externalCalls) ||
      Number(execution.externalCalls) > 8 ||
      !nullableInteger(execution.globalCallsBeforeInventory) ||
      !nullableInteger(execution.globalTimeRemainingBeforeInventoryMs) ||
      ["fourScopeInventoryGetItemsExecuted", "fourScopeRefreshExecuted",
        "inventoryFailureFromBudget", "inventoryGetItemsExecuted",
        "inventoryGetUserExecuted", "inventoryRefreshExecuted"].some(
        (key) => typeof execution[key] !== "boolean",
      )) return false
  if ((scopeControl.fourScopeRefresh === "NOT_RUN" &&
        (execution.fourScopeRefreshExecuted !== false ||
          execution.fourScopeInventoryGetItemsExecuted !== false ||
          fourStatus !== null)) ||
      (scopeControl.fourScopeRefresh === "AVAILABLE" &&
        execution.fourScopeRefreshExecuted !== true) ||
      (execution.fourScopeInventoryGetItemsExecuted === true &&
        scopeControl.fourScopeRefresh !== "AVAILABLE") ||
      (fourStatus !== null &&
        execution.fourScopeInventoryGetItemsExecuted !== true)) return false

  if (!Array.isArray(record.calls) || record.calls.length > 8 ||
      record.calls.length !== execution.externalCalls) return false
  const operations = new Set([
    "OAUTH_REFRESH_INVENTORY",
    "OAUTH_REFRESH_INVENTORY_FOUR_SCOPE",
    "TRADING_GET_USER",
    "INVENTORY_GET_ITEMS_MATRIX_A",
    "INVENTORY_GET_ITEMS_MATRIX_B",
    "INVENTORY_GET_ITEMS_MATRIX_C",
    "INVENTORY_GET_ITEMS_MATRIX_D",
    "INVENTORY_GET_ITEMS_FOUR_SCOPE_CONTROL",
  ])
  const expectedCallOperations = [
    "OAUTH_REFRESH_INVENTORY",
    "TRADING_GET_USER",
    "INVENTORY_GET_ITEMS_MATRIX_A",
    "INVENTORY_GET_ITEMS_MATRIX_B",
    "INVENTORY_GET_ITEMS_MATRIX_C",
    "INVENTORY_GET_ITEMS_MATRIX_D",
    "OAUTH_REFRESH_INVENTORY_FOUR_SCOPE",
    "INVENTORY_GET_ITEMS_FOUR_SCOPE_CONTROL",
  ]
  if (!record.calls.every((candidate, index) => {
    if (!candidate || typeof candidate !== "object" ||
        Array.isArray(candidate)) return false
    const call = candidate as Record<string, unknown>
    return Object.keys(call).sort().join(",") === [
      "endpoint", "httpStatus", "marketplaceMutation", "method",
      "observedAt", "operation", "persisted", "status",
    ].sort().join(",") && operations.has(String(call.operation)) &&
      call.operation === expectedCallOperations[index] &&
      (call.method === "GET" || call.method === "POST") &&
      typeof call.endpoint === "string" &&
      String(call.endpoint).startsWith("/") &&
      (String(call.operation).startsWith("OAUTH_REFRESH_")
        ? call.method === "POST" &&
          call.endpoint === "/identity/v1/oauth2/token"
        : call.operation === "TRADING_GET_USER"
          ? call.method === "POST" && call.endpoint === "/ws/api.dll"
          : call.method === "GET" &&
            call.endpoint === "/sell/inventory/v1/inventory_item") &&
      (call.status === "SUCCEEDED" || call.status === "FAILED") &&
      nullableInteger(call.httpStatus) &&
      typeof call.observedAt === "string" &&
      Number.isFinite(Date.parse(call.observedAt)) &&
      call.marketplaceMutation === false && call.persisted === false
  })) return false
  const calls = record.calls as Array<Record<string, unknown>>
  const subsetRefreshSucceeded = calls[0]?.operation ===
      "OAUTH_REFRESH_INVENTORY" && calls[0]?.status === "SUCCEEDED"
  if ((scopeControl.subsetScopeRefresh === "AVAILABLE") !==
        subsetRefreshSucceeded ||
      execution.inventoryRefreshExecuted !== calls.some((call) =>
        call.operation === "OAUTH_REFRESH_INVENTORY") ||
      execution.inventoryGetUserExecuted !== calls.some((call) =>
        call.operation === "TRADING_GET_USER") ||
      execution.inventoryGetItemsExecuted !== calls.some((call) =>
        String(call.operation).startsWith("INVENTORY_GET_ITEMS_MATRIX_")) ||
      execution.fourScopeRefreshExecuted !== calls.some((call) =>
        call.operation === "OAUTH_REFRESH_INVENTORY_FOUR_SCOPE") ||
      execution.fourScopeInventoryGetItemsExecuted !== calls.some((call) =>
        call.operation === "INVENTORY_GET_ITEMS_FOUR_SCOPE_CONTROL")) {
    return false
  }
  if (execution.inventoryGetItemsExecuted === true &&
      record.inventoryItemsSafeErrorCategory !==
        canonical.safeErrorCategory) return false

  if (!record.safety || typeof record.safety !== "object" ||
      Array.isArray(record.safety)) return false
  const safety = record.safety as Record<string, unknown>
  if (Object.keys(safety).sort().join(",") !==
      [...INVENTORY_CONSUMER_SAFETY_KEYS].sort().join(",") ||
      INVENTORY_CONSUMER_SAFETY_KEYS.some((key) =>
        safety[key] !== (key.endsWith("Mutations") || key.endsWith("Writes") ||
            key === "ledgerMutations" ? 0 : false))) return false

  if (record.inventoryCatalogState === "EMPTY") {
    return record.inventoryItemsAuthorized === true &&
      record.inventoryItemsContentType === "application/json" &&
      record.inventoryItemsSafeErrorCategory === "NONE" &&
      record.inventoryItemsTotalPresent === true &&
      record.inventoryItemsTotal === 0 &&
      record.inventoryItemsNextPresent === false &&
      (record.inventoryItemsResponseShape === "INVENTORY_ITEMS_ARRAY"
        ? record.inventoryItemsHasArray === true &&
          record.inventoryItemsArrayCount === 0
        : record.inventoryItemsResponseShape ===
            "CERTIFIED_EMPTY_OMITTED_ARRAY" &&
          record.inventoryItemsHasArray === false &&
          record.inventoryItemsArrayCount === null)
  }
  return true
}

function validPreflightState(value: unknown): value is PreflightState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).sort().join(",") ===
      "acceptedByAuthEndpoint,safeErrorCategory" &&
    (record.acceptedByAuthEndpoint === "YES" ||
      record.acceptedByAuthEndpoint === "NO") && [
      "NONE",
      "INVALID_REQUEST",
      "AUTH_ENDPOINT_REJECTED",
      "AUTH_ENDPOINT_UNAVAILABLE",
      "AUTH_ENDPOINT_RESPONSE_UNPROVEN",
    ].includes(String(record.safeErrorCategory))
}

function validDiagnosis(value: unknown): value is Diagnosis {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join(",") !==
      [...DIAGNOSIS_KEYS].sort().join(",")) return false
  if (![
    "CLIENT_ID_RUNAME_BINDING",
    "SCOPE_ACCOUNT_REJECTED",
    "SCOPE_INVENTORY_REJECTED",
    "SCOPE_ANALYTICS_REJECTED",
    "URL_SERIALIZATION",
    "STATE_PARAMETER",
    "STILL_UNPROVEN",
  ].includes(String(record.rootCause))) return false
  if ([
    record.testBase,
    record.testBaseAccount,
    record.testBaseAccountInventory,
    record.testFullFourScopes,
    record.canonicalWithState,
    record.previousPlusEncodingWithState,
  ].some((candidate) => !validPreflightState(candidate))) return false
  return record.runameSource === "EBAY_RuName" &&
    ["PASS", "FAIL", "UNPROVEN"].includes(String(record.runameAppBinding)) &&
    record.currentScopeEncoding === "RFC3986_PERCENT20" &&
    record.previousScopeEncoding === "FORM_URLENCODED_PLUS" &&
    ["YES", "NO", "UNPROVEN"].includes(
      String(record.encodingCausesInvalidRequest),
    ) && ["YES", "NO", "UNPROVEN"].includes(
      String(record.stateCausesInvalidRequest),
    ) && typeof record.stateFormatValid === "boolean" &&
    typeof record.scopeCount === "number" &&
    Number.isSafeInteger(record.scopeCount) &&
    typeof record.scopeContractExact === "boolean" &&
    Array.isArray(record.parameterNames) &&
    record.parameterNames.join(",") === EXPECTED_PARAMETER_NAMES.join(",") &&
    typeof record.externalCalls === "number" &&
    Number.isSafeInteger(record.externalCalls) &&
    record.externalCalls >= 0 && record.externalCalls <= 12 &&
    typeof record.ledgerRowsCreated === "number" &&
    Number.isSafeInteger(record.ledgerRowsCreated) &&
    typeof record.cookiesSet === "number" &&
    Number.isSafeInteger(record.cookiesSet) &&
    typeof record.humanRedirects === "number" &&
    Number.isSafeInteger(record.humanRedirects) &&
    typeof record.oauthConsentLaunched === "boolean" &&
    typeof record.authorizationCodeExchangeCalls === "number" &&
    Number.isSafeInteger(record.authorizationCodeExchangeCalls) &&
    typeof record.secretsReturned === "boolean" &&
    typeof record.startAllowed === "boolean"
}

function diagnosisAllowsStart(value: Diagnosis | null) {
  if (!value || !validDiagnosis(value)) return false
  const accepted = (result: PreflightState) =>
    result.acceptedByAuthEndpoint === "YES" &&
    result.safeErrorCategory === "NONE"
  return value.startAllowed === true &&
    accepted(value.testBase) && accepted(value.testBaseAccount) &&
    accepted(value.testBaseAccountInventory) &&
    accepted(value.testFullFourScopes) &&
    accepted(value.canonicalWithState) &&
    value.runameAppBinding === "PASS" &&
    value.stateCausesInvalidRequest === "NO" &&
    value.currentScopeEncoding === "RFC3986_PERCENT20" &&
    value.scopeCount === REQUIRED_SCOPES.length &&
    value.scopeContractExact === true && value.stateFormatValid === true &&
    value.externalCalls >= 6 && value.externalCalls <= 12 &&
    value.ledgerRowsCreated === 0 && value.cookiesSet === 0 &&
    value.humanRedirects === 0 && value.oauthConsentLaunched === false &&
    value.authorizationCodeExchangeCalls === 0 &&
    value.secretsReturned === false
}

function validAuthorizationUrl(value: string) {
  try {
    const url = new URL(value)
    const scopes = url.searchParams.get("scope")?.split(/\s+/)
      .filter(Boolean) ?? []
    const exactScopeSet = scopes.length === REQUIRED_SCOPES.length &&
      REQUIRED_SCOPES.every((scope) => scopes.includes(scope)) &&
      scopes.every((scope) => REQUIRED_SCOPES.includes(
        scope as typeof REQUIRED_SCOPES[number],
      ))
    return !value.includes("+") && !value.includes("%252F") &&
      /scope=[^&]+%20https%3A/.test(value) &&
      url.origin === "https://auth.ebay.com" &&
      url.pathname === "/oauth2/authorize" &&
      url.searchParams.get("response_type") === "code" &&
      Boolean(url.searchParams.get("client_id")) &&
      Boolean(url.searchParams.get("redirect_uri")) &&
      /^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("state") ?? "") &&
      [...url.searchParams.keys()].sort().join(",") ===
        "client_id,redirect_uri,response_type,scope,state" &&
      exactScopeSet
  } catch {
    return false
  }
}

function parseRegistryRepairRowDiagnostic(
  value: unknown,
): RegistryRepairRowDiagnostic | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const statusClass = record.REPAIR_ROW_CURRENT_STATUS_CLASS
  const flags = [
    record.REPAIR_ROW_STATUS_RAW_VALUE_RECOGNIZED,
    record.REPAIR_ROW_STATUS_REACTIVATABLE,
    record.REPAIR_ROW_ACCOUNT_SCOPE_MATCH,
    record.REPAIR_ROW_AUTHORITATIVE_ITEM_ID_STILL_LIVE,
    record.REPAIR_ROW_ITEM_ID_UNIQUE_BOTH_SIDES,
    record.REPAIR_ROW_COMPETING_RELATIONSHIP,
    record.REGISTRY_LIFECYCLE_SUPPORTS_REACTIVATION,
    record.REACTIVATION_ALLOWED_FROM_STALE,
    record.REACTIVATION_ALLOWED_FROM_ENDED,
    record.REACTIVATION_ALLOWED_FROM_HISTORICAL,
    record.REACTIVATION_ALLOWED_FROM_UNKNOWN,
    record.REACTIVATION_CAS_SUPPORTED,
  ]
  const flag = (candidate: unknown) =>
    candidate === "YES" || candidate === "NO" || candidate === "UNPROVEN"
  if (!REGISTRY_REPAIR_ROW_STATUS_CLASSES.some((entry) => entry === statusClass) ||
      !flags.every(flag)) return null

  const allUnproven = statusClass === "UNPROVEN" &&
    flags.every((candidate) => candidate === "UNPROVEN")
  const anyUnproven = statusClass === "UNPROVEN" ||
    flags.some((candidate) => candidate === "UNPROVEN")
  if (anyUnproven !== allUnproven) return null
  if (!allUnproven &&
      (record.REGISTRY_LIFECYCLE_SUPPORTS_REACTIVATION !== "YES" ||
        record.REACTIVATION_ALLOWED_FROM_STALE !== "NO" ||
        record.REACTIVATION_ALLOWED_FROM_ENDED !== "YES" ||
        record.REACTIVATION_ALLOWED_FROM_HISTORICAL !== "NO" ||
        record.REACTIVATION_ALLOWED_FROM_UNKNOWN !== "NO")) return null
  if (!allUnproven) {
    const expectedReactivatable =
      statusClass === "PAUSED" || statusClass === "DRAFT" || statusClass === "ENDED"
        ? "YES"
        : "NO"
    if (record.REPAIR_ROW_STATUS_REACTIVATABLE !== expectedReactivatable) return null
  }

  return {
    statusClass: statusClass as EbayRegistryRepairRowStatusClass,
    statusRawValueRecognized:
      record.REPAIR_ROW_STATUS_RAW_VALUE_RECOGNIZED as "YES" | "NO" | "UNPROVEN",
    statusReactivatable:
      record.REPAIR_ROW_STATUS_REACTIVATABLE as "YES" | "NO" | "UNPROVEN",
    accountScopeMatch:
      record.REPAIR_ROW_ACCOUNT_SCOPE_MATCH as "YES" | "NO" | "UNPROVEN",
    authoritativeItemIdStillLive:
      record.REPAIR_ROW_AUTHORITATIVE_ITEM_ID_STILL_LIVE as "YES" | "NO" | "UNPROVEN",
    itemIdUniqueBothSides:
      record.REPAIR_ROW_ITEM_ID_UNIQUE_BOTH_SIDES as "YES" | "NO" | "UNPROVEN",
    competingRelationship:
      record.REPAIR_ROW_COMPETING_RELATIONSHIP as "YES" | "NO" | "UNPROVEN",
    lifecycleSupportsReactivation:
      record.REGISTRY_LIFECYCLE_SUPPORTS_REACTIVATION as "YES" | "NO" | "UNPROVEN",
    reactivationAllowedFromStale:
      record.REACTIVATION_ALLOWED_FROM_STALE as "YES" | "NO" | "UNPROVEN",
    reactivationAllowedFromEnded:
      record.REACTIVATION_ALLOWED_FROM_ENDED as "YES" | "NO" | "UNPROVEN",
    reactivationAllowedFromHistorical:
      record.REACTIVATION_ALLOWED_FROM_HISTORICAL as "YES" | "NO" | "UNPROVEN",
    reactivationAllowedFromUnknown:
      record.REACTIVATION_ALLOWED_FROM_UNKNOWN as "YES" | "NO" | "UNPROVEN",
    reactivationCasSupported:
      record.REACTIVATION_CAS_SUPPORTED as "YES" | "NO" | "UNPROVEN",
  }
}

function validRegistryRepairDryRun(
  value: unknown,
): value is EbayRegistryRepairDryRun {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join(",") !==
      [...REGISTRY_REPAIR_DRY_RUN_KEYS].sort().join(",")) return false

  const count = (candidate: unknown) =>
    candidate === "UNPROVEN" ||
    (typeof candidate === "number" && Number.isSafeInteger(candidate) &&
      candidate >= 0)
  const percent = (candidate: unknown) =>
    candidate === "UNPROVEN" ||
    (typeof candidate === "number" && Number.isFinite(candidate) &&
      candidate >= 0 && candidate <= 100)
  const yesNoUnproven = (candidate: unknown) =>
    candidate === "YES" || candidate === "NO" || candidate === "UNPROVEN"
  const yesNo = (candidate: unknown) =>
    candidate === "YES" || candidate === "NO"
  const precondition = (candidate: unknown) =>
    candidate === "PASS" || candidate === "FAIL" || candidate === "UNPROVEN"
  const controlledText = (candidate: unknown) =>
    typeof candidate === "string" && candidate.length > 0 && candidate.length <= 500
  const fieldNames = (candidate: unknown) =>
    Array.isArray(candidate) && candidate.every((field) =>
      typeof field === "string" && /^[a-z][a-z0-9_]*$/.test(field)
    )
  const countKeys = [
    "CURRENT_LIVE_COUNT",
    "CURRENT_REGISTRY_COUNT",
    "UNPROVEN_COUNT",
    "REPAIR_EXISTING_UNPROVEN_COUNT",
    "MARK_STALE_UNPROVEN_COUNT",
    "CREATE_NEW_UNPROVEN_COUNT",
    "HUMAN_REVIEW_UNPROVEN_COUNT",
    "IDENTITY_PARTITION_UNPROVEN_COUNT",
    "UNPROVEN_REPAIR_EXISTING_COUNT",
    "UNPROVEN_MARK_STALE_COUNT",
    "UNPROVEN_CREATE_NEW_COUNT",
    "UNPROVEN_HUMAN_REVIEW_COUNT",
    "UNPROVEN_IDENTITY_PARTITION_COUNT",
    "UNPROVEN_TOTAL_COUNT",
    "UNPROVEN_STATE_GUARD_COUNT",
    "UNPROVEN_SOURCE_READ_COUNT",
    "UNPROVEN_OTHER_COUNT",
    "RAW_ALREADY_MATCHED_COUNT",
    "RAW_REPAIR_EXISTING_COUNT",
    "RAW_CREATE_NEW_COUNT",
    "RAW_HUMAN_REVIEW_COUNT",
    "RAW_UNPROVEN_COUNT",
    "RAW_KEEP_CURRENT_COUNT",
    "RAW_REPAIR_EXISTING_REGISTRY_COUNT",
    "RAW_MARK_STALE_COUNT",
    "RAW_MARK_HISTORICAL_COUNT",
    "RAW_HUMAN_REVIEW_REGISTRY_COUNT",
    "RAW_UNPROVEN_REGISTRY_COUNT",
    ...REGISTRY_REPAIR_UNPROVEN_REASON_COUNT_KEYS,
    "OTHER_SUBTYPE_LISTING_IDENTITY_SHAPE_COUNT",
    "OTHER_SUBTYPE_CREATE_PAYLOAD_REQUIREMENT_COUNT",
    "OTHER_SUBTYPE_REGISTRY_ABSENCE_PROOF_COUNT",
    "OTHER_SUBTYPE_LIFECYCLE_REQUIREMENT_COUNT",
    "OTHER_SUBTYPE_NORMALIZATION_FAILURE_COUNT",
    "OTHER_SUBTYPE_UNEXPECTED_CLASSIFIER_BRANCH_COUNT",
    ...REGISTRY_REPAIR_CREATE_STAGE_COUNT_KEYS,
    "ABSENCE_PROOF_UNPROVEN_COUNT",
    ...REGISTRY_REPAIR_ABSENCE_PROOF_CAUSE_COUNT_KEYS,
    "FINAL_IDENTITY_UNPROVEN_COUNT",
    "FINAL_PRECONDITION_UNPROVEN_COUNT",
    "REPAIR_EXISTING_AUTOMATIC_COUNT",
    "HUMAN_REVIEW_REASON_REACTIVATION_NOT_ALLOWED_COUNT",
    "IDENTITY_UNPROVEN_COUNT",
    "AUTOMATIC_PRECONDITION_UNPROVEN_COUNT",
    "HUMAN_REVIEW_MUTATION_COUNT",
    "REPAIR_EXISTING_COUNT",
    "CREATE_NEW_COUNT",
    "MARK_STALE_COUNT",
    "HUMAN_REVIEW_COUNT",
    "LIVE_ALREADY_MATCHED_COUNT",
    "LIVE_REPAIR_EXISTING_COUNT",
    "LIVE_CREATE_NEW_COUNT",
    "LIVE_HUMAN_REVIEW_COUNT",
    "LIVE_UNPROVEN_COUNT",
    "REGISTRY_KEEP_CURRENT_COUNT",
    "REGISTRY_REPAIR_EXISTING_COUNT",
    "REGISTRY_MARK_STALE_COUNT",
    "REGISTRY_MARK_HISTORICAL_COUNT",
    "REGISTRY_HUMAN_REVIEW_COUNT",
    "REGISTRY_UNPROVEN_COUNT",
    "EXPECTED_MATCHED_AFTER_SAFE_TRANCHE",
    "EXPECTED_LIVE_COUNT",
    "EXPECTED_PENDING_HUMAN_REVIEW",
    "REGISTRY_MUTATIONS",
    "EBAY_WRITES",
    "PRODUCT_CASE_MUTATIONS",
    "INVENTORY_WRITES",
    "FULFILLMENT_WRITES",
    "OAUTH_CHANGES",
    "VERCEL_ENV_CHANGES",
  ] as const
  if (!countKeys.every((key) => count(record[key])) ||
      !percent(record.EXPECTED_COVERAGE_PERCENT) ||
      record.DRY_RUN_LABEL !== "DRY RUN — NO CHANGES WILL BE APPLIED" ||
      !["CURRENT", "CHANGED", "UNPROVEN"].includes(
        String(record.EVIDENCE_STATUS),
      ) ||
      typeof record.DRY_RUN_PACKAGE_HANDLE !== "string" ||
      !/^[A-Za-z0-9._:-]{1,200}$/.test(record.DRY_RUN_PACKAGE_HANDLE) ||
      !(record.CURRENT_EVIDENCE_FINGERPRINT === "UNPROVEN" ||
        (typeof record.CURRENT_EVIDENCE_FINGERPRINT === "string" &&
          /^rr_evidence_[a-f0-9]{24}$/.test(
            record.CURRENT_EVIDENCE_FINGERPRINT,
          ))) ||
      !["CURRENT", "STALE", "UNPROVEN"].includes(
        String(record.DRY_RUN_FRESHNESS_STATUS),
      ) ||
      ![
        "DRY RUN CURRENT — LIVE RECHECK REQUIRED BEFORE WRITE",
        "DRY RUN STALE — REFRESH REQUIRED",
        "UNPROVEN",
      ].includes(String(record.DRY_RUN_STALE_LABEL)) ||
      !(record.DRY_RUN_REJECTION_REASON === null ||
        validRegistryRepairDryRunRejectionReason(
          record.DRY_RUN_REJECTION_REASON,
        )) ||
      !validRegistryRepairAmbiguityClass(record.AMBIGUITY_CLASS) ||
      !validRegistryRepairUnprovenComponent(record.UNPROVEN_COMPONENT) ||
      !validRegistryRepairUnprovenSource(
        record.REPAIR_EXISTING_UNPROVEN_SOURCE,
      ) ||
      !validRegistryRepairUnprovenSource(record.MARK_STALE_UNPROVEN_SOURCE) ||
      !validRegistryRepairUnprovenSource(record.CREATE_NEW_UNPROVEN_SOURCE) ||
      !validRegistryRepairUnprovenSource(record.HUMAN_REVIEW_UNPROVEN_SOURCE) ||
      !validRegistryRepairUnprovenSource(
        record.IDENTITY_PARTITION_UNPROVEN_SOURCE,
      ) ||
      !validRegistryRepairBlockingUnprovenSource(
        record.BLOCKING_UNPROVEN_PRIMARY_SOURCE,
      ) ||
      !validRegistryRepairBlockingUnprovenSecondarySources(
        record.BLOCKING_UNPROVEN_SECONDARY_SOURCES,
      ) ||
      !validRegistryRepairUnprovenPrimaryReason(
        record.UNPROVEN_PRIMARY_REASON,
      ) ||
      !parseRegistryRepairUnprovenReasonCounts(record) ||
      !yesNo(record.LIVE_RAW_PARTITION_VALID) ||
      !yesNo(record.REGISTRY_RAW_PARTITION_VALID) ||
      !parseRegistryRepairOtherSubtypeCounts(record.OTHER_SUBTYPE_COUNTS) ||
      !parseRegistryRepairCreateStageCounts(record) ||
      !["PASS", "FAIL", "UNPROVEN"].includes(
        String(record.CREATE_MATERIALIZATION_STATUS),
      ) ||
      !validRegistryRepairAbsenceProofCause(
        record.ABSENCE_PROOF_PRIMARY_CAUSE,
      ) ||
      !parseRegistryRepairAbsenceProofCauseCounts(record) ||
      !parseRegistryRepairLifecycleDiagnostic(record) ||
      !parseRegistryRepairRowDiagnostic(record) ||
      !parseRegistryRepairFinalDiagnostic(record) ||
      !precondition(record.REPAIR_PRECONDITION_STATUS) ||
      !precondition(record.CREATE_PRECONDITION_STATUS) ||
      !precondition(record.STALE_PRECONDITION_STATUS) ||
      !fieldNames(record.REPAIR_FIELDS_TO_CHANGE) ||
      !fieldNames(record.CREATE_FIELDS_TO_POPULATE) ||
      !fieldNames(record.STALE_FIELDS_TO_CHANGE) ||
      !yesNoUnproven(record.LIVE_DRY_RUN_PARTITION_VALID) ||
      !yesNoUnproven(record.REGISTRY_DRY_RUN_PARTITION_VALID) ||
      !yesNoUnproven(record.WRITE_OPERATION_IDEMPOTENT) ||
      !yesNoUnproven(record.STALE_STATE_GUARD_SUPPORTED) ||
      !yesNoUnproven(record.LIVE_RECHECK_REQUIRED_BEFORE_WRITE) ||
      !controlledText(record.PARTIAL_FAILURE_POLICY) ||
      !controlledText(record.ROLLBACK_STRATEGY) ||
      !yesNoUnproven(record.AUTOMATIC_TRANCHE_PRECONDITIONS_PASS) ||
      !(record.HUMAN_REVIEW_WRITE_ALLOWED === "NO" ||
        record.HUMAN_REVIEW_WRITE_ALLOWED === "UNPROVEN") ||
      !yesNoUnproven(record.DRY_RUN_READY_FOR_APPROVAL) ||
      !Array.isArray(record.HUMAN_REVIEW_CANDIDATES)) return false

  if ((record.DRY_RUN_FRESHNESS_STATUS === "CURRENT" &&
        record.DRY_RUN_STALE_LABEL !==
          "DRY RUN CURRENT — LIVE RECHECK REQUIRED BEFORE WRITE") ||
      (record.DRY_RUN_FRESHNESS_STATUS === "STALE" &&
        record.DRY_RUN_STALE_LABEL !== "DRY RUN STALE — REFRESH REQUIRED") ||
      (record.DRY_RUN_FRESHNESS_STATUS === "UNPROVEN" &&
        record.DRY_RUN_STALE_LABEL !== "UNPROVEN")) return false

  if (!yesNoUnproven(record.DRY_RUN_STATE_BOUND) ||
      !yesNoUnproven(record.DRY_RUN_STATE_FINGERPRINT_PRESENT) ||
      !yesNoUnproven(record.APPROVAL_INVALIDATES_ON_EBAY_STATE_CHANGE) ||
      !yesNoUnproven(record.APPROVAL_INVALIDATES_ON_REGISTRY_STATE_CHANGE)) {
    return false
  }

  const ambiguityClass = record.AMBIGUITY_CLASS
  const blockingAmbiguity = typeof ambiguityClass === "string" &&
    ambiguityClass.startsWith("BLOCKING_")
  const blockingReasons = [
    "AMBIGUOUS_IDENTITY",
    "STATE_CHANGED_DURING_SAME_REQUEST",
    "REGISTRY_SOURCE_UNAVAILABLE",
    "LIVE_ENUMERATION_UNAVAILABLE",
    "ACCOUNT_BINDING_FAILED",
    "BUDGET_EXHAUSTED",
    "UNPROVEN",
  ]
  if ((blockingAmbiguity &&
        !blockingReasons.includes(String(record.DRY_RUN_REJECTION_REASON))) ||
      (ambiguityClass === "REVIEWABLE_ONLY" &&
        record.DRY_RUN_REJECTION_REASON !== null &&
        record.DRY_RUN_REJECTION_REASON !== "PRECONDITION_UNPROVEN")) return false

  const unprovenComponent = record.UNPROVEN_COMPONENT
  const unprovenCount = record.UNPROVEN_COUNT
  const unprovenSources = [
    record.REPAIR_EXISTING_UNPROVEN_SOURCE,
    record.MARK_STALE_UNPROVEN_SOURCE,
    record.CREATE_NEW_UNPROVEN_SOURCE,
    record.HUMAN_REVIEW_UNPROVEN_SOURCE,
    record.IDENTITY_PARTITION_UNPROVEN_SOURCE,
  ]
  const blockingPrimarySource = record.BLOCKING_UNPROVEN_PRIMARY_SOURCE
  const blockingSecondarySources =
    record.BLOCKING_UNPROVEN_SECONDARY_SOURCES as string[]
  const phaseOneCounts = [
    record.UNPROVEN_REPAIR_EXISTING_COUNT,
    record.UNPROVEN_MARK_STALE_COUNT,
    record.UNPROVEN_CREATE_NEW_COUNT,
    record.UNPROVEN_HUMAN_REVIEW_COUNT,
    record.UNPROVEN_IDENTITY_PARTITION_COUNT,
    record.UNPROVEN_STATE_GUARD_COUNT,
    record.UNPROVEN_SOURCE_READ_COUNT,
    record.UNPROVEN_OTHER_COUNT,
  ]
  const reasonCounts = parseRegistryRepairUnprovenReasonCounts(record)
  if (!reasonCounts) return false
  const reasonCountValues = Object.values(reasonCounts)
  const rawUnavailableCounts = [
    record.RAW_ALREADY_MATCHED_COUNT,
    record.RAW_REPAIR_EXISTING_COUNT,
    record.RAW_CREATE_NEW_COUNT,
    record.RAW_HUMAN_REVIEW_COUNT,
    record.RAW_UNPROVEN_COUNT,
    record.RAW_KEEP_CURRENT_COUNT,
    record.RAW_REPAIR_EXISTING_REGISTRY_COUNT,
    record.RAW_MARK_STALE_COUNT,
    record.RAW_MARK_HISTORICAL_COUNT,
    record.RAW_HUMAN_REVIEW_REGISTRY_COUNT,
    record.RAW_UNPROVEN_REGISTRY_COUNT,
  ]
  const numericReasonCountSum = reasonCountValues.every((value) =>
    typeof value === "number"
  )
    ? reasonCountValues.reduce<number>((sum, value) =>
      sum + (value as number), 0)
    : null
  const otherSubtypeCounts = parseRegistryRepairOtherSubtypeCounts(
    record.OTHER_SUBTYPE_COUNTS,
  )
  const createStageCounts = parseRegistryRepairCreateStageCounts(record)
  const absenceProofCauseCounts =
    parseRegistryRepairAbsenceProofCauseCounts(record)
  const lifecycleDiagnostic = parseRegistryRepairLifecycleDiagnostic(record)
  const finalDiagnostic = parseRegistryRepairFinalDiagnostic(record)
  if (!otherSubtypeCounts || !createStageCounts || !absenceProofCauseCounts ||
      !lifecycleDiagnostic || !finalDiagnostic) return false
  const lifecycleReviewIsolated =
    record.HUMAN_REVIEW_REASON_REACTIVATION_NOT_ALLOWED_COUNT === 1 &&
    record.AUTOMATIC_PRECONDITION_UNPROVEN_COUNT === 0 &&
    lifecycleDiagnostic.action === "NONE" &&
    lifecycleDiagnostic.stage === "NONE" &&
    lifecycleDiagnostic.requiredSignal === "NONE" &&
    lifecycleDiagnostic.signalAvailable === "YES" &&
    lifecycleDiagnostic.failureCause === "REACTIVATION_NOT_ALLOWED"
  const otherSubtypeValues = Object.values(otherSubtypeCounts)
  const createIdentityPartitionConsistent = [
    createStageCounts.RAW_CREATE_IDENTITY_CANDIDATE_COUNT,
    createStageCounts.CREATE_IDENTITY_DETERMINISTIC_COUNT,
    createStageCounts.CREATE_IDENTITY_UNPROVEN_COUNT,
  ].some((value) => value === "UNPROVEN") ||
    createStageCounts.RAW_CREATE_IDENTITY_CANDIDATE_COUNT ===
      Number(createStageCounts.CREATE_IDENTITY_DETERMINISTIC_COUNT) +
      Number(createStageCounts.CREATE_IDENTITY_UNPROVEN_COUNT)
  const createMaterializationPartitionConsistent = [
    createStageCounts.CREATE_IDENTITY_DETERMINISTIC_COUNT,
    createStageCounts.CREATE_MATERIALIZATION_PASS_COUNT,
    createStageCounts.CREATE_MATERIALIZATION_UNPROVEN_COUNT,
  ].some((value) => value === "UNPROVEN") ||
    createStageCounts.CREATE_IDENTITY_DETERMINISTIC_COUNT ===
      Number(createStageCounts.CREATE_MATERIALIZATION_PASS_COUNT) +
      Number(createStageCounts.CREATE_MATERIALIZATION_UNPROVEN_COUNT)
  const createAbsenceCasPartitionConsistent = [
    createStageCounts.CREATE_MATERIALIZATION_PASS_COUNT,
    createStageCounts.CREATE_ABSENCE_CAS_PASS_COUNT,
    createStageCounts.CREATE_ABSENCE_CAS_UNPROVEN_COUNT,
  ].some((value) => value === "UNPROVEN") ||
    createStageCounts.CREATE_MATERIALIZATION_PASS_COUNT ===
      Number(createStageCounts.CREATE_ABSENCE_CAS_PASS_COUNT) +
      Number(createStageCounts.CREATE_ABSENCE_CAS_UNPROVEN_COUNT)
  const absenceProofCauseValues = Object.values(absenceProofCauseCounts)
  const numericAbsenceProofCauseSum = absenceProofCauseValues.every((value) =>
    typeof value === "number"
  )
    ? absenceProofCauseValues.reduce<number>((sum, value) =>
      sum + (value as number), 0)
    : null
  if ((unprovenComponent === "NONE" && unprovenCount !== 0) ||
      (record.DRY_RUN_READY_FOR_APPROVAL === "YES" &&
        (unprovenComponent !== "NONE" || unprovenCount !== 0 ||
          unprovenSources.some((source) => source !== "NONE"))) ||
      (ambiguityClass === "BLOCKING_UNPROVEN" &&
        (unprovenComponent === "NONE" || unprovenCount === 0)) ||
      (unprovenComponent === "EVIDENCE_UNAVAILABLE" &&
        (unprovenCount !== "UNPROVEN" ||
          unprovenSources.some((source) => source !== "EVIDENCE_UNAVAILABLE") ||
          record.UNPROVEN_TOTAL_COUNT !== "UNPROVEN" ||
          phaseOneCounts.some((value) => value !== "UNPROVEN") ||
          blockingPrimarySource !== "SOURCE_READ" ||
          blockingSecondarySources.length !== 0)) ||
      (record.UNPROVEN_REPAIR_EXISTING_COUNT !==
        record.REPAIR_EXISTING_UNPROVEN_COUNT) ||
      (record.UNPROVEN_MARK_STALE_COUNT !==
        record.MARK_STALE_UNPROVEN_COUNT) ||
      (record.UNPROVEN_CREATE_NEW_COUNT !==
        record.CREATE_NEW_UNPROVEN_COUNT) ||
      (record.UNPROVEN_HUMAN_REVIEW_COUNT !==
        record.HUMAN_REVIEW_UNPROVEN_COUNT) ||
      (record.UNPROVEN_IDENTITY_PARTITION_COUNT !==
        record.IDENTITY_PARTITION_UNPROVEN_COUNT) ||
      (record.UNPROVEN_TOTAL_COUNT === 0 &&
        (blockingPrimarySource !== "NONE" ||
          blockingSecondarySources.length !== 0)) ||
      (typeof record.UNPROVEN_TOTAL_COUNT === "number" &&
        record.UNPROVEN_TOTAL_COUNT > 0 && blockingPrimarySource === "NONE") ||
      blockingSecondarySources.includes(String(blockingPrimarySource))) {
    return false
  }
  if ((numericReasonCountSum !== null &&
        typeof record.RAW_UNPROVEN_COUNT === "number" &&
        numericReasonCountSum !== record.RAW_UNPROVEN_COUNT) ||
      (record.RAW_UNPROVEN_COUNT === 0 &&
        record.UNPROVEN_PRIMARY_REASON !== "NONE") ||
      (typeof record.RAW_UNPROVEN_COUNT === "number" &&
        record.RAW_UNPROVEN_COUNT > 0 &&
        record.UNPROVEN_PRIMARY_REASON === "NONE") ||
      (record.DRY_RUN_READY_FOR_APPROVAL === "YES" &&
        (record.RAW_UNPROVEN_COUNT !== 0 ||
          record.RAW_UNPROVEN_REGISTRY_COUNT !== 0 ||
          reasonCountValues.some((value) => value !== 0) ||
          record.UNPROVEN_PRIMARY_REASON !== "NONE")) ||
      (unprovenComponent === "EVIDENCE_UNAVAILABLE" &&
        (rawUnavailableCounts.some((value) => value !== "UNPROVEN") ||
          reasonCountValues.some((value) => value !== "UNPROVEN") ||
          record.LIVE_RAW_PARTITION_VALID !== "NO" ||
          record.REGISTRY_RAW_PARTITION_VALID !== "NO" ||
          record.UNPROVEN_PRIMARY_REASON !== "SOURCE_EVIDENCE")) ||
      !createIdentityPartitionConsistent ||
      !createMaterializationPartitionConsistent ||
      !createAbsenceCasPartitionConsistent ||
      (record.OTHER_SUBTYPE_LISTING_IDENTITY_SHAPE_COUNT !==
        otherSubtypeCounts.LISTING_IDENTITY_SHAPE) ||
      (record.OTHER_SUBTYPE_CREATE_PAYLOAD_REQUIREMENT_COUNT !==
        otherSubtypeCounts.CREATE_PAYLOAD_REQUIREMENT) ||
      (record.OTHER_SUBTYPE_REGISTRY_ABSENCE_PROOF_COUNT !==
        otherSubtypeCounts.REGISTRY_ABSENCE_PROOF) ||
      (record.OTHER_SUBTYPE_LIFECYCLE_REQUIREMENT_COUNT !==
        otherSubtypeCounts.LIFECYCLE_REQUIREMENT) ||
      (record.OTHER_SUBTYPE_NORMALIZATION_FAILURE_COUNT !==
        otherSubtypeCounts.NORMALIZATION_FAILURE) ||
      (record.OTHER_SUBTYPE_UNEXPECTED_CLASSIFIER_BRANCH_COUNT !==
        otherSubtypeCounts.UNEXPECTED_CLASSIFIER_BRANCH) ||
      (record.DRY_RUN_READY_FOR_APPROVAL === "YES" &&
        (createStageCounts.CREATE_IDENTITY_UNPROVEN_COUNT !== 0 ||
          createStageCounts.CREATE_MATERIALIZATION_UNPROVEN_COUNT !== 0 ||
          createStageCounts.CREATE_ABSENCE_CAS_UNPROVEN_COUNT !== 0 ||
          otherSubtypeValues.some((value) => value !== 0) ||
          record.CREATE_MATERIALIZATION_STATUS !== "PASS")) ||
      (unprovenComponent === "EVIDENCE_UNAVAILABLE" &&
        (Object.values(createStageCounts).some((value) => value !== "UNPROVEN") ||
          otherSubtypeValues.some((value) => value !== "UNPROVEN") ||
          record.CREATE_MATERIALIZATION_STATUS !== "UNPROVEN")) ||
      (numericAbsenceProofCauseSum !== null &&
        typeof record.ABSENCE_PROOF_UNPROVEN_COUNT === "number" &&
        numericAbsenceProofCauseSum !== record.ABSENCE_PROOF_UNPROVEN_COUNT) ||
      (record.ABSENCE_PROOF_UNPROVEN_COUNT === 0 &&
        record.ABSENCE_PROOF_PRIMARY_CAUSE !== "NONE") ||
      (typeof record.ABSENCE_PROOF_UNPROVEN_COUNT === "number" &&
        record.ABSENCE_PROOF_UNPROVEN_COUNT > 0 &&
        record.ABSENCE_PROOF_PRIMARY_CAUSE === "NONE") ||
      finalDiagnostic.rejectionReason !== record.DRY_RUN_REJECTION_REASON ||
      (record.DRY_RUN_READY_FOR_APPROVAL === "YES" &&
        (record.ABSENCE_PROOF_UNPROVEN_COUNT !== 0 ||
          absenceProofCauseValues.some((value) => value !== 0) ||
          record.ABSENCE_PROOF_PRIMARY_CAUSE !== "NONE" ||
          (!lifecycleReviewIsolated &&
            (lifecycleDiagnostic.action !== "NONE" ||
              lifecycleDiagnostic.stage !== "NONE" ||
              lifecycleDiagnostic.requiredSignal !== "NONE" ||
              lifecycleDiagnostic.signalAvailable !== "YES" ||
              lifecycleDiagnostic.failureCause !== "NONE")) ||
          finalDiagnostic.identityUnprovenCount !== 0 ||
          finalDiagnostic.preconditionUnprovenCount !== 0)) ||
      (unprovenComponent === "EVIDENCE_UNAVAILABLE" &&
        (record.ABSENCE_PROOF_UNPROVEN_COUNT !== "UNPROVEN" ||
          absenceProofCauseValues.some((value) => value !== "UNPROVEN") ||
          record.ABSENCE_PROOF_PRIMARY_CAUSE !== "UNPROVEN" ||
          lifecycleDiagnostic.action !== "UNPROVEN" ||
          lifecycleDiagnostic.stage !== "UNPROVEN" ||
          lifecycleDiagnostic.requiredSignal !== "UNPROVEN" ||
          lifecycleDiagnostic.signalAvailable !== "UNPROVEN" ||
          lifecycleDiagnostic.failureCause !== "UNPROVEN" ||
          finalDiagnostic.identityUnprovenCount !== "UNPROVEN" ||
          finalDiagnostic.preconditionUnprovenCount !== "UNPROVEN" ||
          finalDiagnostic.rejectionReason !== "UNPROVEN"))) return false

  const candidates = record.HUMAN_REVIEW_CANDIDATES
  if (!candidates.every((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return false
    }
    const candidateRecord = candidate as Record<string, unknown>
    return Object.keys(candidateRecord).sort().join(",") ===
        [...REGISTRY_REPAIR_HUMAN_CANDIDATE_KEYS].sort().join(",") &&
      typeof candidateRecord.CANDIDATE_HANDLE === "string" &&
      /^[A-Za-z0-9._:-]{1,200}$/.test(candidateRecord.CANDIDATE_HANDLE) &&
      (candidateRecord.RELATIONSHIP_TYPE === "SKU_ONLY" ||
        candidateRecord.RELATIONSHIP_TYPE === "ITEM_ID_ONLY_LIFECYCLE") &&
      yesNoUnproven(candidateRecord.REGISTRY_ITEM_ID_CURRENTLY_LIVE) &&
      yesNoUnproven(candidateRecord.SKU_UNIQUE_BOTH_SIDES) &&
      yesNoUnproven(candidateRecord.COMPETING_REGISTRY_RELATION) &&
      candidateRecord.RECOMMENDED_ACTION === "REVIEW_REQUIRED"
  })) return false
  const lifecycleReviewCount = candidates.filter((candidate) =>
    (candidate as Record<string, unknown>).RELATIONSHIP_TYPE ===
      "ITEM_ID_ONLY_LIFECYCLE"
  ).length
  const aggregateCounts = [
    record.REPAIR_EXISTING_AUTOMATIC_COUNT,
    record.HUMAN_REVIEW_REASON_REACTIVATION_NOT_ALLOWED_COUNT,
    record.IDENTITY_UNPROVEN_COUNT,
    record.AUTOMATIC_PRECONDITION_UNPROVEN_COUNT,
    record.HUMAN_REVIEW_MUTATION_COUNT,
  ]
  const aggregateUnavailable = aggregateCounts.every((value) => value === "UNPROVEN") &&
    record.AUTOMATIC_TRANCHE_PRECONDITIONS_PASS === "UNPROVEN" &&
    record.HUMAN_REVIEW_WRITE_ALLOWED === "UNPROVEN"
  const aggregateAvailable = aggregateCounts.every((value) => typeof value === "number") &&
    record.AUTOMATIC_TRANCHE_PRECONDITIONS_PASS !== "UNPROVEN" &&
    record.HUMAN_REVIEW_WRITE_ALLOWED === "NO" &&
    record.HUMAN_REVIEW_MUTATION_COUNT === 0
  if (!aggregateUnavailable && !aggregateAvailable) return false
  if (aggregateUnavailable) {
    return record.HUMAN_REVIEW_COUNT === "UNPROVEN" && candidates.length === 0
  }
  return record.HUMAN_REVIEW_COUNT === candidates.length &&
    record.HUMAN_REVIEW_REASON_REACTIVATION_NOT_ALLOWED_COUNT ===
      lifecycleReviewCount &&
    record.REPAIR_EXISTING_AUTOMATIC_COUNT === record.REPAIR_EXISTING_COUNT &&
    record.IDENTITY_UNPROVEN_COUNT === record.FINAL_IDENTITY_UNPROVEN_COUNT &&
    record.AUTOMATIC_PRECONDITION_UNPROVEN_COUNT ===
      record.FINAL_PRECONDITION_UNPROVEN_COUNT &&
    record.AUTOMATIC_TRANCHE_PRECONDITIONS_PASS ===
      (record.AUTOMATIC_PRECONDITION_UNPROVEN_COUNT === 0 ? "YES" : "NO")
}

export default function EbaySellerOAuthReauthPage() {
  const [callbackUrl, setCallbackUrl] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [diagnosing, setDiagnosing] = useState(false)
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null)
  const [matchingCredentials, setMatchingCredentials] = useState(false)
  const [credentialMatch, setCredentialMatch] =
    useState<RuntimeCredentialMatch | null>(null)
  const [certifyingInstalledRuntime, setCertifyingInstalledRuntime] =
    useState(false)
  const [installedRuntimeCertification, setInstalledRuntimeCertification] =
    useState<InstalledRuntimeCertification | null>(null)
  const [diagnosingInventoryConsumer, setDiagnosingInventoryConsumer] =
    useState(false)
  const [inventoryConsumerDiagnostic, setInventoryConsumerDiagnostic] =
    useState<InventoryConsumerDiagnostic | null>(null)
  const [diagnosingRegistryCoverage, setDiagnosingRegistryCoverage] = useState(false)
  const [registryCoverageDiagnostic, setRegistryCoverageDiagnostic] =
    useState<EbayRegistryCoverageDiagnostic | null>(null)
  const [previewingRegistryRepair, setPreviewingRegistryRepair] = useState(false)
  const [registryRepairDryRun, setRegistryRepairDryRun] =
    useState<EbayRegistryRepairDryRun | null>(null)
  const [registryRepairDryRunRejectionReason,
    setRegistryRepairDryRunRejectionReason] =
    useState<EbayRegistryRepairDryRunRejectionReason | null>(null)
  const [registryRepairDryRunAmbiguityClass,
    setRegistryRepairDryRunAmbiguityClass] =
    useState<EbayRegistryRepairAmbiguityClass | null>(null)
  const [registryRepairUnprovenComponent,
    setRegistryRepairUnprovenComponent] =
    useState<EbayRegistryRepairUnprovenComponent | null>(null)
  const [registryRepairUnprovenCount, setRegistryRepairUnprovenCount] =
    useState<number | "UNPROVEN" | null>(null)
  const [registryRepairUnprovenTotalCount, setRegistryRepairUnprovenTotalCount] =
    useState<number | "UNPROVEN" | null>(null)
  const [registryRepairBlockingUnprovenPrimarySource,
    setRegistryRepairBlockingUnprovenPrimarySource] =
    useState<EbayRegistryRepairBlockingUnprovenSource | null>(null)
  const [registryRepairBlockingUnprovenSecondarySources,
    setRegistryRepairBlockingUnprovenSecondarySources] =
    useState<EbayRegistryRepairBlockingUnprovenSource[]>([])
  const [registryRepairRawUnprovenCount, setRegistryRepairRawUnprovenCount] =
    useState<number | "UNPROVEN" | null>(null)
  const [registryRepairUnprovenPrimaryReason,
    setRegistryRepairUnprovenPrimaryReason] =
    useState<EbayRegistryRepairUnprovenPrimaryReason | null>(null)
  const [registryRepairUnprovenReasonCounts,
    setRegistryRepairUnprovenReasonCounts] =
    useState<RegistryRepairUnprovenReasonCounts | null>(null)
  const [registryRepairOtherSubtypeCounts,
    setRegistryRepairOtherSubtypeCounts] =
    useState<RegistryRepairOtherSubtypeCounts | null>(null)
  const [registryRepairCreateStageCounts,
    setRegistryRepairCreateStageCounts] =
    useState<RegistryRepairCreateStageCounts | null>(null)
  const [registryRepairCreateMaterializationStatus,
    setRegistryRepairCreateMaterializationStatus] =
    useState<"PASS" | "FAIL" | "UNPROVEN" | null>(null)
  const [registryRepairAbsenceProofUnprovenCount,
    setRegistryRepairAbsenceProofUnprovenCount] =
    useState<number | "UNPROVEN" | null>(null)
  const [registryRepairAbsenceProofPrimaryCause,
    setRegistryRepairAbsenceProofPrimaryCause] =
    useState<EbayRegistryRepairAbsenceProofCause | null>(null)
  const [registryRepairAbsenceProofCauseCounts,
    setRegistryRepairAbsenceProofCauseCounts] =
    useState<RegistryRepairAbsenceProofCauseCounts | null>(null)
  const [registryRepairLifecycleDiagnostic,
    setRegistryRepairLifecycleDiagnostic] =
    useState<RegistryRepairLifecycleDiagnostic | null>(null)
  const [registryRepairFinalDiagnostic, setRegistryRepairFinalDiagnostic] =
    useState<RegistryRepairFinalDiagnostic | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setCallbackUrl(`${window.location.origin}${CALLBACK_PATH}`)
  }, [])

  async function adminBearer() {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !data.session) throw new Error("ADMIN_SESSION_REQUIRED")
    return data.session.access_token
  }

  async function diagnose() {
    setDiagnosing(true)
    setDiagnosis(null)
    setError("")
    try {
      if (!runtimeCredentialMatchAllowsStart(credentialMatch)) {
        throw new Error("RUNTIME_CREDENTIAL_MATCH_REQUIRED")
      }
      const bearer = await adminBearer()
      const response = await fetch(START_PATH, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "diagnose" }),
      })
      const payload = await response.json() as DiagnosisPayload
      if (!response.ok || payload.success !== true ||
          !validDiagnosis(payload.diagnosis)) {
        throw new Error(payload.error || "OAUTH_DIAGNOSTIC_REJECTED")
      }
      setDiagnosis(payload.diagnosis)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "OAUTH_DIAGNOSTIC_REJECTED")
    } finally {
      setDiagnosing(false)
    }
  }

  async function compareRuntimeCredentials() {
    setMatchingCredentials(true)
    setCredentialMatch(null)
    setDiagnosis(null)
    setInstalledRuntimeCertification(null)
    setInventoryConsumerDiagnostic(null)
    setError("")
    try {
      const bearer = await adminBearer()
      const response = await fetch(START_PATH, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "compare_runtime_credentials" }),
      })
      const payload = await response.json() as RuntimeCredentialMatchPayload
      if (!response.ok || payload.success !== true ||
          !validRuntimeCredentialMatch(payload.credentialMatch)) {
        throw new Error(payload.error || "RUNTIME_CREDENTIAL_MATCH_REJECTED")
      }
      setCredentialMatch(payload.credentialMatch)
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message
        : "RUNTIME_CREDENTIAL_MATCH_REJECTED")
    } finally {
      setMatchingCredentials(false)
    }
  }

  async function certifyInstalledRuntime() {
    setCertifyingInstalledRuntime(true)
    setInstalledRuntimeCertification(null)
    setError("")
    try {
      if (!runtimeCredentialMatchAllowsStart(credentialMatch)) {
        throw new Error("RUNTIME_CREDENTIAL_MATCH_REQUIRED")
      }
      const bearer = await adminBearer()
      const response = await fetch(START_PATH, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "certify_installed_runtime" }),
      })
      const payload = await response.json() as
        InstalledRuntimeCertificationPayload
      if (!response.ok || payload.success !== true ||
          !validInstalledRuntimeCertification(payload.certification)) {
        throw new Error(payload.error ||
          "INSTALLED_RUNTIME_CERTIFICATION_REJECTED")
      }
      setInstalledRuntimeCertification(payload.certification)
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message
        : "INSTALLED_RUNTIME_CERTIFICATION_REJECTED")
    } finally {
      setCertifyingInstalledRuntime(false)
    }
  }

  async function diagnoseInventoryConsumer() {
    setDiagnosingInventoryConsumer(true)
    setInventoryConsumerDiagnostic(null)
    setError("")
    try {
      if (!runtimeCredentialMatchAllowsStart(credentialMatch)) {
        throw new Error("RUNTIME_CREDENTIAL_MATCH_REQUIRED")
      }
      const bearer = await adminBearer()
      const response = await fetch(START_PATH, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "diagnose_inventory_consumer" }),
      })
      const payload = await response.json() as
        InventoryConsumerDiagnosticPayload
      if (!response.ok || payload.success !== true ||
          !validInventoryConsumerDiagnostic(payload.inventoryConsumer)) {
        throw new Error(payload.error ||
          "INVENTORY_CONSUMER_DIAGNOSTIC_REJECTED")
      }
      setInventoryConsumerDiagnostic(payload.inventoryConsumer)
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message
        : "INVENTORY_CONSUMER_DIAGNOSTIC_REJECTED")
    } finally {
      setDiagnosingInventoryConsumer(false)
    }
  }

  async function diagnoseRegistryCoverageRuntime() {
    setDiagnosingRegistryCoverage(true)
    setRegistryCoverageDiagnostic(null)
    setError("")
    try {
      if (!runtimeCredentialMatchAllowsStart(credentialMatch)) {
        throw new Error("RUNTIME_CREDENTIAL_MATCH_REQUIRED")
      }
      const bearer = await adminBearer()
      const response = await fetch(START_PATH, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "diagnose_registry_coverage_runtime" }),
      })
      const payload = await response.json() as
        RegistryCoverageDiagnosticPayload
      if (!response.ok || payload.success !== true ||
          !validRegistryCoverageDiagnostic(payload.registryCoverageDiagnostic)) {
        throw new Error(payload.error ||
          "REGISTRY_COVERAGE_DIAGNOSTIC_REJECTED")
      }
      setRegistryCoverageDiagnostic(payload.registryCoverageDiagnostic)
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message
        : "REGISTRY_COVERAGE_DIAGNOSTIC_REJECTED")
    } finally {
      setDiagnosingRegistryCoverage(false)
    }
  }

  async function previewRegistryRepair() {
    setPreviewingRegistryRepair(true)
    setRegistryRepairDryRun(null)
    setRegistryRepairDryRunRejectionReason(null)
    setRegistryRepairDryRunAmbiguityClass(null)
    setRegistryRepairUnprovenComponent(null)
    setRegistryRepairUnprovenCount(null)
    setRegistryRepairUnprovenTotalCount(null)
    setRegistryRepairBlockingUnprovenPrimarySource(null)
    setRegistryRepairBlockingUnprovenSecondarySources([])
    setRegistryRepairRawUnprovenCount(null)
    setRegistryRepairUnprovenPrimaryReason(null)
    setRegistryRepairUnprovenReasonCounts(null)
    setRegistryRepairOtherSubtypeCounts(null)
    setRegistryRepairCreateStageCounts(null)
    setRegistryRepairCreateMaterializationStatus(null)
    setRegistryRepairAbsenceProofUnprovenCount(null)
    setRegistryRepairAbsenceProofPrimaryCause(null)
    setRegistryRepairAbsenceProofCauseCounts(null)
    setRegistryRepairLifecycleDiagnostic(null)
    setRegistryRepairFinalDiagnostic(null)
    setError("")
    try {
      if (!runtimeCredentialMatchAllowsStart(credentialMatch)) {
        throw new Error("RUNTIME_CREDENTIAL_MATCH_REQUIRED")
      }
      const bearer = await adminBearer()
      const response = await fetch(START_PATH, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "preview_registry_repair" }),
      })
      const payload = await response.json() as RegistryRepairDryRunPayload
      if (!response.ok || payload.success !== true) {
        setError("REGISTRY_REPAIR_DRY_RUN_REJECTED")
        setRegistryRepairDryRunRejectionReason(
          validRegistryRepairDryRunRejectionReason(
            payload.REJECTION_REASON,
          )
            ? payload.REJECTION_REASON
            : "UNPROVEN",
        )
        setRegistryRepairDryRunAmbiguityClass(
          validRegistryRepairAmbiguityClass(payload.AMBIGUITY_CLASS)
            ? payload.AMBIGUITY_CLASS
            : "BLOCKING_UNPROVEN",
        )
        setRegistryRepairUnprovenComponent(
          validRegistryRepairUnprovenComponent(payload.UNPROVEN_COMPONENT)
            ? payload.UNPROVEN_COMPONENT
            : "EVIDENCE_UNAVAILABLE",
        )
        setRegistryRepairUnprovenCount(
          validRegistryRepairUnprovenCount(payload.UNPROVEN_COUNT)
            ? payload.UNPROVEN_COUNT
            : "UNPROVEN",
        )
        setRegistryRepairUnprovenTotalCount(
          validRegistryRepairUnprovenCount(payload.UNPROVEN_TOTAL_COUNT)
            ? payload.UNPROVEN_TOTAL_COUNT
            : "UNPROVEN",
        )
        setRegistryRepairBlockingUnprovenPrimarySource(
          validRegistryRepairBlockingUnprovenSource(
            payload.BLOCKING_UNPROVEN_PRIMARY_SOURCE,
          )
            ? payload.BLOCKING_UNPROVEN_PRIMARY_SOURCE
            : "SOURCE_READ",
        )
        setRegistryRepairBlockingUnprovenSecondarySources(
          validRegistryRepairBlockingUnprovenSecondarySources(
            payload.BLOCKING_UNPROVEN_SECONDARY_SOURCES,
          )
            ? payload.BLOCKING_UNPROVEN_SECONDARY_SOURCES
            : [],
        )
        setRegistryRepairRawUnprovenCount(
          validRegistryRepairUnprovenCount(payload.RAW_UNPROVEN_COUNT)
            ? payload.RAW_UNPROVEN_COUNT
            : "UNPROVEN",
        )
        setRegistryRepairUnprovenPrimaryReason(
          validRegistryRepairUnprovenPrimaryReason(
            payload.UNPROVEN_PRIMARY_REASON,
          )
            ? payload.UNPROVEN_PRIMARY_REASON
            : "SOURCE_EVIDENCE",
        )
        setRegistryRepairUnprovenReasonCounts(
          parseRegistryRepairUnprovenReasonCounts(payload) ??
            unavailableRegistryRepairUnprovenReasonCounts(),
        )
        setRegistryRepairOtherSubtypeCounts(
          parseRegistryRepairOtherSubtypeCounts(payload.OTHER_SUBTYPE_COUNTS) ??
            unavailableRegistryRepairOtherSubtypeCounts(),
        )
        setRegistryRepairCreateStageCounts(
          parseRegistryRepairCreateStageCounts(payload) ??
            unavailableRegistryRepairCreateStageCounts(),
        )
        setRegistryRepairCreateMaterializationStatus(
          ["PASS", "FAIL", "UNPROVEN"].includes(
            String(payload.CREATE_MATERIALIZATION_STATUS),
          )
            ? payload.CREATE_MATERIALIZATION_STATUS as
              "PASS" | "FAIL" | "UNPROVEN"
            : "UNPROVEN",
        )
        setRegistryRepairAbsenceProofUnprovenCount(
          validRegistryRepairUnprovenCount(payload.ABSENCE_PROOF_UNPROVEN_COUNT)
            ? payload.ABSENCE_PROOF_UNPROVEN_COUNT
            : "UNPROVEN",
        )
        setRegistryRepairAbsenceProofPrimaryCause(
          validRegistryRepairAbsenceProofCause(
            payload.ABSENCE_PROOF_PRIMARY_CAUSE,
          )
            ? payload.ABSENCE_PROOF_PRIMARY_CAUSE
            : "UNPROVEN",
        )
        setRegistryRepairAbsenceProofCauseCounts(
          parseRegistryRepairAbsenceProofCauseCounts(payload) ??
            unavailableRegistryRepairAbsenceProofCauseCounts(),
        )
        setRegistryRepairLifecycleDiagnostic(
          parseRegistryRepairLifecycleDiagnostic(payload) ??
            unavailableRegistryRepairLifecycleDiagnostic(),
        )
        setRegistryRepairFinalDiagnostic(
          parseRegistryRepairFinalDiagnostic(payload) ??
            unavailableRegistryRepairFinalDiagnostic(),
        )
        return
      }
      if (!validRegistryRepairDryRun(payload.registryRepairDryRun)) {
        setError("REGISTRY_REPAIR_DRY_RUN_REJECTED")
        setRegistryRepairDryRunRejectionReason(
          "RESPONSE_CONTRACT_INVALID",
        )
        setRegistryRepairDryRunAmbiguityClass("BLOCKING_UNPROVEN")
        setRegistryRepairUnprovenComponent("EVIDENCE_UNAVAILABLE")
        setRegistryRepairUnprovenCount("UNPROVEN")
        setRegistryRepairUnprovenTotalCount("UNPROVEN")
        setRegistryRepairBlockingUnprovenPrimarySource("SOURCE_READ")
        setRegistryRepairBlockingUnprovenSecondarySources([])
        setRegistryRepairRawUnprovenCount("UNPROVEN")
        setRegistryRepairUnprovenPrimaryReason("SOURCE_EVIDENCE")
        setRegistryRepairUnprovenReasonCounts(
          unavailableRegistryRepairUnprovenReasonCounts(),
        )
        setRegistryRepairOtherSubtypeCounts(
          unavailableRegistryRepairOtherSubtypeCounts(),
        )
        setRegistryRepairCreateStageCounts(
          unavailableRegistryRepairCreateStageCounts(),
        )
        setRegistryRepairCreateMaterializationStatus("UNPROVEN")
        setRegistryRepairAbsenceProofUnprovenCount("UNPROVEN")
        setRegistryRepairAbsenceProofPrimaryCause("UNPROVEN")
        setRegistryRepairAbsenceProofCauseCounts(
          unavailableRegistryRepairAbsenceProofCauseCounts(),
        )
        setRegistryRepairLifecycleDiagnostic(
          unavailableRegistryRepairLifecycleDiagnostic(),
        )
        setRegistryRepairFinalDiagnostic(
          unavailableRegistryRepairFinalDiagnostic(),
        )
        return
      }
      if (payload.registryRepairDryRun.DRY_RUN_REJECTION_REASON !== null) {
        setError("REGISTRY_REPAIR_DRY_RUN_REJECTED")
        setRegistryRepairDryRunRejectionReason(
          payload.registryRepairDryRun.DRY_RUN_REJECTION_REASON,
        )
        setRegistryRepairDryRunAmbiguityClass(
          payload.registryRepairDryRun.AMBIGUITY_CLASS,
        )
        setRegistryRepairUnprovenComponent(
          payload.registryRepairDryRun.UNPROVEN_COMPONENT,
        )
        setRegistryRepairUnprovenCount(
          payload.registryRepairDryRun.UNPROVEN_COUNT,
        )
        setRegistryRepairUnprovenTotalCount(
          payload.registryRepairDryRun.UNPROVEN_TOTAL_COUNT,
        )
        setRegistryRepairBlockingUnprovenPrimarySource(
          payload.registryRepairDryRun.BLOCKING_UNPROVEN_PRIMARY_SOURCE,
        )
        setRegistryRepairBlockingUnprovenSecondarySources(
          payload.registryRepairDryRun.BLOCKING_UNPROVEN_SECONDARY_SOURCES,
        )
        setRegistryRepairRawUnprovenCount(
          payload.registryRepairDryRun.RAW_UNPROVEN_COUNT,
        )
        setRegistryRepairUnprovenPrimaryReason(
          payload.registryRepairDryRun.UNPROVEN_PRIMARY_REASON,
        )
        setRegistryRepairUnprovenReasonCounts(
          parseRegistryRepairUnprovenReasonCounts(payload.registryRepairDryRun),
        )
        setRegistryRepairOtherSubtypeCounts(
          parseRegistryRepairOtherSubtypeCounts(
            payload.registryRepairDryRun.OTHER_SUBTYPE_COUNTS,
          ),
        )
        setRegistryRepairCreateStageCounts(
          parseRegistryRepairCreateStageCounts(payload.registryRepairDryRun),
        )
        setRegistryRepairCreateMaterializationStatus(
          payload.registryRepairDryRun.CREATE_MATERIALIZATION_STATUS,
        )
        setRegistryRepairAbsenceProofUnprovenCount(
          payload.registryRepairDryRun.ABSENCE_PROOF_UNPROVEN_COUNT,
        )
        setRegistryRepairAbsenceProofPrimaryCause(
          payload.registryRepairDryRun.ABSENCE_PROOF_PRIMARY_CAUSE,
        )
        setRegistryRepairAbsenceProofCauseCounts(
          parseRegistryRepairAbsenceProofCauseCounts(
            payload.registryRepairDryRun,
          ),
        )
        setRegistryRepairLifecycleDiagnostic(
          parseRegistryRepairLifecycleDiagnostic(payload.registryRepairDryRun),
        )
        setRegistryRepairFinalDiagnostic(
          parseRegistryRepairFinalDiagnostic(payload.registryRepairDryRun),
        )
        return
      }
      setRegistryRepairDryRunAmbiguityClass(
        payload.registryRepairDryRun.AMBIGUITY_CLASS,
      )
      setRegistryRepairUnprovenComponent(
        payload.registryRepairDryRun.UNPROVEN_COMPONENT,
      )
      setRegistryRepairUnprovenCount(payload.registryRepairDryRun.UNPROVEN_COUNT)
      setRegistryRepairUnprovenTotalCount(
        payload.registryRepairDryRun.UNPROVEN_TOTAL_COUNT,
      )
      setRegistryRepairBlockingUnprovenPrimarySource(
        payload.registryRepairDryRun.BLOCKING_UNPROVEN_PRIMARY_SOURCE,
      )
      setRegistryRepairBlockingUnprovenSecondarySources(
        payload.registryRepairDryRun.BLOCKING_UNPROVEN_SECONDARY_SOURCES,
      )
      setRegistryRepairRawUnprovenCount(
        payload.registryRepairDryRun.RAW_UNPROVEN_COUNT,
      )
      setRegistryRepairUnprovenPrimaryReason(
        payload.registryRepairDryRun.UNPROVEN_PRIMARY_REASON,
      )
      setRegistryRepairUnprovenReasonCounts(
        parseRegistryRepairUnprovenReasonCounts(payload.registryRepairDryRun),
      )
      setRegistryRepairOtherSubtypeCounts(
        parseRegistryRepairOtherSubtypeCounts(
          payload.registryRepairDryRun.OTHER_SUBTYPE_COUNTS,
        ),
      )
      setRegistryRepairCreateStageCounts(
        parseRegistryRepairCreateStageCounts(payload.registryRepairDryRun),
      )
      setRegistryRepairCreateMaterializationStatus(
        payload.registryRepairDryRun.CREATE_MATERIALIZATION_STATUS,
      )
      setRegistryRepairAbsenceProofUnprovenCount(
        payload.registryRepairDryRun.ABSENCE_PROOF_UNPROVEN_COUNT,
      )
      setRegistryRepairAbsenceProofPrimaryCause(
        payload.registryRepairDryRun.ABSENCE_PROOF_PRIMARY_CAUSE,
      )
      setRegistryRepairAbsenceProofCauseCounts(
        parseRegistryRepairAbsenceProofCauseCounts(payload.registryRepairDryRun),
      )
      setRegistryRepairLifecycleDiagnostic(
        parseRegistryRepairLifecycleDiagnostic(payload.registryRepairDryRun),
      )
      setRegistryRepairFinalDiagnostic(
        parseRegistryRepairFinalDiagnostic(payload.registryRepairDryRun),
      )
      setRegistryRepairDryRun(payload.registryRepairDryRun)
    } catch {
      setError("REGISTRY_REPAIR_DRY_RUN_REJECTED")
      setRegistryRepairDryRunRejectionReason("UNPROVEN")
      setRegistryRepairDryRunAmbiguityClass("BLOCKING_UNPROVEN")
      setRegistryRepairUnprovenComponent("EVIDENCE_UNAVAILABLE")
      setRegistryRepairUnprovenCount("UNPROVEN")
      setRegistryRepairUnprovenTotalCount("UNPROVEN")
      setRegistryRepairBlockingUnprovenPrimarySource("SOURCE_READ")
      setRegistryRepairBlockingUnprovenSecondarySources([])
      setRegistryRepairRawUnprovenCount("UNPROVEN")
      setRegistryRepairUnprovenPrimaryReason("SOURCE_EVIDENCE")
      setRegistryRepairUnprovenReasonCounts(
        unavailableRegistryRepairUnprovenReasonCounts(),
      )
      setRegistryRepairOtherSubtypeCounts(
        unavailableRegistryRepairOtherSubtypeCounts(),
      )
      setRegistryRepairCreateStageCounts(
        unavailableRegistryRepairCreateStageCounts(),
      )
      setRegistryRepairCreateMaterializationStatus("UNPROVEN")
      setRegistryRepairAbsenceProofUnprovenCount("UNPROVEN")
      setRegistryRepairAbsenceProofPrimaryCause("UNPROVEN")
      setRegistryRepairAbsenceProofCauseCounts(
        unavailableRegistryRepairAbsenceProofCauseCounts(),
      )
      setRegistryRepairLifecycleDiagnostic(
        unavailableRegistryRepairLifecycleDiagnostic(),
      )
      setRegistryRepairFinalDiagnostic(
        unavailableRegistryRepairFinalDiagnostic(),
      )
    } finally {
      setPreviewingRegistryRepair(false)
    }
  }

  async function begin() {
    setLoading(true)
    setError("")
    try {
      if (!runtimeCredentialMatchAllowsStart(credentialMatch) ||
          !diagnosisAllowsStart(diagnosis)) {
        throw new Error("AUTH_REQUEST_LIVE_PREFLIGHT_REQUIRED")
      }
      const bearer = await adminBearer()
      const response = await fetch(START_PATH, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "start" }),
      })
      const payload = await response.json() as StartPayload
      if (!response.ok || payload.success !== true ||
          !payload.authorizationUrl ||
          payload.callbackPath !== CALLBACK_PATH ||
          payload.scopeCount !== REQUIRED_SCOPES.length ||
          payload.authorizationPreflight?.liveAccepted !== true ||
          payload.authorizationPreflight?.scopeEncoding !==
            "RFC3986_PERCENT20" ||
          payload.authorizationPreflight?.stateAccepted !== true ||
          payload.authorizationPreflight?.scopeContractExact !== true ||
          payload.authorizationPreflight?.positiveInvariantsPassed !== true ||
          payload.authorizationPreflight?.runtimeCredentialMatch !== true ||
          !validAuthorizationUrl(payload.authorizationUrl)) {
        throw new Error(payload.error || "OAUTH_START_REJECTED")
      }
      window.location.assign(payload.authorizationUrl)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "OAUTH_START_REJECTED")
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#07111f] px-5 py-10 text-white">
      <div className="mx-auto max-w-3xl space-y-7">
        <Link className="text-sm text-cyan-300 underline" href="/admin/ebay/monitor">
          Volver al Commercial Monitor
        </Link>
        <header>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-amber-300">
            Helper temporal · Preview canónico solamente
          </p>
          <h1 className="mt-3 text-3xl font-black">
            Reautorizar OAuth seller genérico
          </h1>
          <p className="mt-3 text-sm leading-6 text-white/65">
            Este flujo guarda únicamente un hash de estado no secreto. Nunca guarda códigos,
            tokens, cookies, identidad del seller ni datos de negocio.
          </p>
        </header>

        <section className="rounded-3xl border border-amber-300/30 bg-amber-300/10 p-6">
          <h2 className="font-black">Antes de iniciar</h2>
          <p className="mt-3 text-sm leading-6">
            En eBay Developer, el Auth Accepted URL del RuName Production debe ser exactamente:
          </p>
          <code className="mt-3 block break-all rounded-xl bg-black/30 p-3 text-xs">
            {callbackUrl || "Cargando alias canónico…"}
          </code>
          <p className="mt-3 text-sm leading-6">
            No continúe si todavía apunta al callback histórico de Commercial Orders.
          </p>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.045] p-6">
          <h2 className="font-black">Scopes exactos</h2>
          <ul className="mt-3 space-y-2 text-xs text-white/70">
            {REQUIRED_SCOPES.map((scope) => (
              <li className="break-all" key={scope}>{scope}</li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-white/60">
            Fulfillment, Marketing y todos los scopes write están excluidos.
          </p>
        </section>

        <section className="rounded-3xl border border-red-300/25 bg-red-300/[0.06] p-6 text-sm leading-6">
          <strong>Entrega no recuperable:</strong> el estado se reclama atómicamente antes del
          exchange. Si la respuesta se pierde, debe iniciar una ceremonia completamente nueva.
          Reload o Back nunca rearman el estado.
        </section>

        <section className="rounded-3xl border border-emerald-300/25 bg-emerald-300/[0.06] p-6">
          <h2 className="font-black">Portal Production ↔ runtime protegido</h2>
          <p className="mt-3 text-sm leading-6 text-white/70">
            Compara localmente SHA-256 completo y longitud UTF-8 contra la evidencia humana
            certificada. No devuelve fingerprints ni valores y no contacta eBay, Supabase ledger
            o Vercel.
          </p>
          <button
            className="mt-4 rounded-2xl border border-emerald-300/50 px-5 py-2 text-sm font-black text-emerald-200 disabled:opacity-40"
            type="button"
            disabled={matchingCredentials || diagnosing || loading ||
              certifyingInstalledRuntime || diagnosingInventoryConsumer ||
              diagnosingRegistryCoverage || previewingRegistryRepair}
            onClick={compareRuntimeCredentials}
          >
            {matchingCredentials
              ? "Comparando…"
              : "Comparar credenciales protegidas"}
          </button>
          {credentialMatch ? (
            <dl className="mt-5 grid gap-2 text-xs text-white/75 sm:grid-cols-2">
              {RUNTIME_CREDENTIAL_MATCH_KEYS.map((label) => (
                <div className="rounded-lg bg-black/20 p-3" key={label}>
                  <dt className="break-all font-bold text-white/50">{label}</dt>
                  <dd className="mt-1 break-all">
                    {typeof credentialMatch[label] === "boolean"
                      ? credentialMatch[label] ? "YES" : "NO"
                      : String(credentialMatch[label] ?? "UNPROVEN")}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>

        <section className="rounded-3xl border border-violet-300/25 bg-violet-300/[0.06] p-6">
          <h2 className="font-black">Credencial instalada · sólo lectura</h2>
          <p className="mt-3 text-sm leading-6 text-white/70">
            Certifica directamente EBAY_SELLER_REFRESH_TOKEN del Preview con el union exacto:
            GetUser, Inventory locations, Analytics traffic y Account privilege. No usa fallback,
            no crea ledger/cookie y no devuelve ni persiste tokens.
          </p>
          <button
            className="mt-4 rounded-2xl border border-violet-300/50 px-5 py-2 text-sm font-black text-violet-200 disabled:opacity-40"
            type="button"
            disabled={certifyingInstalledRuntime || matchingCredentials ||
              diagnosing || diagnosingInventoryConsumer || diagnosingRegistryCoverage ||
              previewingRegistryRepair || loading ||
              !runtimeCredentialMatchAllowsStart(credentialMatch)}
            onClick={certifyInstalledRuntime}
          >
            {certifyingInstalledRuntime
              ? "Certificando…"
              : "Certificar token instalado sin consentimiento"}
          </button>
          {installedRuntimeCertification ? (
            <dl className="mt-5 grid gap-2 text-xs text-white/75 sm:grid-cols-2">
              {[
                ["Credential source", installedRuntimeCertification.credentialSource],
                ["OAuth refresh", installedRuntimeCertification.oauthRefreshExchange],
                ["Trading / binding", installedRuntimeCertification.capabilities.tradingBase],
                ["Inventory readonly", installedRuntimeCertification.capabilities.inventoryReadonly],
                ["Analytics readonly", installedRuntimeCertification.capabilities.analyticsReadonly],
                ["Account readonly", installedRuntimeCertification.capabilities.accountReadonly],
                ["External calls", installedRuntimeCertification.calls.length],
                ["Token persisted / returned", "false / false"],
              ].map(([label, value]) => (
                <div className="rounded-lg bg-black/20 p-3" key={String(label)}>
                  <dt className="font-bold text-white/50">{label}</dt>
                  <dd className="mt-1 break-all">{String(value)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>

        <section className="rounded-3xl border border-fuchsia-300/25 bg-fuchsia-300/[0.06] p-6">
          <h2 className="font-black">Inventory consumer exacto · sólo metadata</h2>
          <p className="mt-3 text-sm leading-6 text-white/70">
            Usa únicamente el token genérico instalado, refresca base + Inventory readonly,
            verifica GetUser y ejecuta secuencialmente las cuatro formas A–D cerradas del
            request inventory_item. Sólo si las cuatro responden exactamente 400 ejecuta el
            control D con el union de cuatro scopes certificado. Scope metadata presente debe
            coincidir exactamente y sólo HTTP 200 cuenta como aceptación. No llama offers, no devuelve
            SKUs, payloads, mensajes, valores de parámetros, headers ni tokens y no crea
            ledger/cookie.
          </p>
          <button
            className="mt-4 rounded-2xl border border-fuchsia-300/50 px-5 py-2 text-sm font-black text-fuchsia-200 disabled:opacity-40"
            type="button"
            disabled={diagnosingInventoryConsumer || certifyingInstalledRuntime ||
              matchingCredentials || diagnosing || diagnosingRegistryCoverage ||
              previewingRegistryRepair || loading ||
              !runtimeCredentialMatchAllowsStart(credentialMatch)}
            onClick={diagnoseInventoryConsumer}
          >
            {diagnosingInventoryConsumer
              ? "Inspeccionando forma…"
              : "Diagnosticar consumer Inventory exacto"}
          </button>
          {inventoryConsumerDiagnostic ? (
            <div className="mt-5 space-y-4 text-xs text-white/75">
              <dl className="grid gap-2 sm:grid-cols-2">
                {[
                  ["A · HTTP status", inventoryConsumerDiagnostic.inventoryItemsHttpStatus ?? "NONE"],
                  ["A · Authorized", inventoryConsumerDiagnostic.inventoryItemsAuthorized ? "YES" : "NO"],
                  ["A · Content type", inventoryConsumerDiagnostic.inventoryItemsContentType ?? "NONE"],
                  ["A · Top-level keys", inventoryConsumerDiagnostic.inventoryItemsTopLevelKeys.join(", ") || "NONE"],
                  ["A · Has array", inventoryConsumerDiagnostic.inventoryItemsHasArray ? "YES" : "NO"],
                  ["A · Array count", inventoryConsumerDiagnostic.inventoryItemsArrayCount ?? "NONE"],
                  ["A · Total present", inventoryConsumerDiagnostic.inventoryItemsTotalPresent ? "YES" : "NO"],
                  ["A · Total", inventoryConsumerDiagnostic.inventoryItemsTotal ?? "NONE"],
                  ["A · Next present", inventoryConsumerDiagnostic.inventoryItemsNextPresent ? "YES" : "NO"],
                  ["A · Response shape", inventoryConsumerDiagnostic.inventoryItemsResponseShape],
                  ["A · Catalog state", inventoryConsumerDiagnostic.inventoryCatalogState],
                  ["A · Safe error", inventoryConsumerDiagnostic.inventoryItemsSafeErrorCategory],
                  ["First accepted variant", inventoryConsumerDiagnostic.firstAcceptedVariant ?? "NONE"],
                  ["Minimum documented accepted", inventoryConsumerDiagnostic.minimumDocumentedAcceptedVariant ?? "NONE"],
                  ["Request-contract root cause", inventoryConsumerDiagnostic.requestContractRootCause],
                  ["Subset scope refresh", inventoryConsumerDiagnostic.scopeControl.subsetScopeRefresh],
                  ["Subset-scope D status", inventoryConsumerDiagnostic.scopeControl.subsetScopeInventoryItemsStatus ?? "NONE"],
                  ["Four-scope refresh", inventoryConsumerDiagnostic.scopeControl.fourScopeRefresh],
                  ["Four-scope D status", inventoryConsumerDiagnostic.scopeControl.fourScopeInventoryItemsStatus ?? "NONE"],
                  ["Scope minting causes 400", inventoryConsumerDiagnostic.scopeControl.scopeMintingDifferenceCauses400],
                  ["Calls before Inventory", inventoryConsumerDiagnostic.execution.globalCallsBeforeInventory ?? "NONE"],
                  ["Time remaining before Inventory (ms)", inventoryConsumerDiagnostic.execution.globalTimeRemainingBeforeInventoryMs ?? "NONE"],
                  ["Refresh / GetUser / A–D", `${inventoryConsumerDiagnostic.execution.inventoryRefreshExecuted} / ${inventoryConsumerDiagnostic.execution.inventoryGetUserExecuted} / ${inventoryConsumerDiagnostic.execution.inventoryGetItemsExecuted}`],
                  ["Four refresh / control", `${inventoryConsumerDiagnostic.execution.fourScopeRefreshExecuted} / ${inventoryConsumerDiagnostic.execution.fourScopeInventoryGetItemsExecuted}`],
                  ["Failure from budget", inventoryConsumerDiagnostic.execution.inventoryFailureFromBudget ? "YES" : "NO"],
                  ["External calls", `${inventoryConsumerDiagnostic.execution.externalCalls} / ${inventoryConsumerDiagnostic.execution.maximumExternalCalls}`],
                  ["Token / payload returned", "false / false"],
                ].map(([label, value]) => (
                  <div className="rounded-lg bg-black/20 p-3" key={String(label)}>
                    <dt className="font-bold text-white/50">{label}</dt>
                    <dd className="mt-1 break-all">{String(value)}</dd>
                  </div>
                ))}
              </dl>
              <div className="grid gap-2 lg:grid-cols-2">
                {([
                  ["A · CURRENT_CANONICAL", inventoryConsumerDiagnostic.variants.currentCanonical],
                  ["B · NO_MARKETPLACE_HEADER", inventoryConsumerDiagnostic.variants.noMarketplaceHeader],
                  ["C · LIMIT_ONLY", inventoryConsumerDiagnostic.variants.limitOnly],
                  ["D · NO_QUERY", inventoryConsumerDiagnostic.variants.noQuery],
                ] as const).map(([label, variant]) => (
                  <dl className="rounded-lg bg-black/20 p-3" key={label}>
                    <dt className="font-black text-fuchsia-100">{label}</dt>
                    <dd className="mt-2 space-y-1 break-all">
                      <div>Status: {variant.httpStatus ?? "NONE"}</div>
                      <div>Accepted: {variant.acceptedByEndpoint ? "YES" : "NO"}</div>
                      <div>Safe error: {variant.safeErrorCategory}</div>
                      <div>Error metadata: {variant.errorMetadata.status}</div>
                      <div>Error objects: {variant.errorMetadata.errorObjectCount ?? "NONE"}</div>
                      <div>Error IDs: {variant.errorMetadata.errorIds.join(", ") || "NONE"}</div>
                      <div>Domains: {variant.errorMetadata.domains.join(", ") || "NONE"}</div>
                      <div>Categories: {variant.errorMetadata.categories.join(", ") || "NONE"}</div>
                      <div>Parameter names: {variant.errorMetadata.parameterNames.join(", ") || "NONE"}</div>
                      <div>25709 field name: {variant.errorMetadata.ERROR_25709_FIELD_NAME}</div>
                      <div>25709 message form: {variant.errorMetadata.ERROR_25709_MESSAGE_FORM}</div>
                      <div>Field extracted: {variant.errorMetadata.FIELD_NAME_EXTRACTED_FROM_CERTIFIED_TEMPLATE}</div>
                      <div>Safe field class: {variant.errorMetadata.ERROR_25709_SAFE_FIELD_CLASS}</div>
                      <div>Message prefix class: {variant.errorMetadata.MESSAGE_PREFIX_CLASS}</div>
                      <div>Message suffix class: {variant.errorMetadata.MESSAGE_SUFFIX_CLASS}</div>
                      <div>Message length bucket: {variant.errorMetadata.MESSAGE_LENGTH_BUCKET}</div>
                      <div>Contains official invalid-value prefix: {variant.errorMetadata.MESSAGE_CONTAINS_OFFICIAL_INVALID_VALUE_PREFIX}</div>
                      <div>Contains known documented field token: {variant.errorMetadata.MESSAGE_CONTAINS_KNOWN_DOCUMENTED_FIELD_TOKEN}</div>
                    </dd>
                  </dl>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-3xl border border-orange-300/25 bg-orange-300/[0.06] p-6">
          <h2 className="font-black">Registry coverage runtime</h2>
          <p className="mt-3 text-sm leading-6 text-white/70">
            Ejecuta una comprobación protegida y de solo lectura contra la source de cobertura
            Registry y la enumeración Trading viva para medir partición y brechas. No devuelve
            tokens, URLs, headers ni filas brutas.
          </p>
          <button
            className="mt-4 rounded-2xl border border-orange-300/50 px-5 py-2 text-sm font-black text-orange-200 disabled:opacity-40"
            type="button"
            disabled={diagnosingRegistryCoverage || certifyingInstalledRuntime ||
              matchingCredentials || diagnosing || diagnosingInventoryConsumer ||
              previewingRegistryRepair || loading ||
              !runtimeCredentialMatchAllowsStart(credentialMatch)}
            onClick={diagnoseRegistryCoverageRuntime}
          >
            Diagnosticar cobertura Registry
          </button>
          <p className="mt-5 rounded-2xl border border-amber-200/35 bg-amber-200/[0.08] p-4 text-sm font-black text-amber-100">
            DRY RUN — NO CHANGES WILL BE APPLIED
          </p>
          <button
            className="mt-3 rounded-2xl border border-amber-200/50 px-5 py-2 text-sm font-black text-amber-100 disabled:opacity-40"
            type="button"
            disabled={previewingRegistryRepair || diagnosingRegistryCoverage ||
              certifyingInstalledRuntime || matchingCredentials || diagnosing ||
              diagnosingInventoryConsumer || loading ||
              !runtimeCredentialMatchAllowsStart(credentialMatch)}
            onClick={previewRegistryRepair}
          >
            {previewingRegistryRepair
              ? "Preparing Registry repair preview…"
              : "Preview Registry repair"}
          </button>
          {registryRepairDryRunRejectionReason ? (
            <p aria-live="polite" className="mt-3 rounded-xl border border-red-300/30 bg-red-300/[0.06] p-3 text-sm font-black text-red-100">
              Rejection reason: {registryRepairDryRunRejectionReason}
            </p>
          ) : null}
          {registryRepairDryRunAmbiguityClass ? (
            <p aria-live="polite" className="mt-3 rounded-xl border border-amber-300/30 bg-amber-300/[0.06] p-3 text-sm font-black text-amber-100">
              Ambiguity class: {registryRepairDryRunAmbiguityClass}
            </p>
          ) : null}
          {registryRepairUnprovenComponent &&
              registryRepairUnprovenCount !== null ? (
            <p aria-live="polite" className="mt-3 rounded-xl border border-orange-300/30 bg-orange-300/[0.06] p-3 text-sm font-black text-orange-100">
              Unproven component: {registryRepairUnprovenComponent} · Unproven count: {String(registryRepairUnprovenCount)}
            </p>
          ) : null}
          {registryRepairBlockingUnprovenPrimarySource &&
              registryRepairUnprovenTotalCount !== null ? (
            <p aria-live="polite" className="mt-3 rounded-xl border border-orange-300/30 bg-orange-300/[0.06] p-3 text-sm font-black text-orange-100">
              Unproven total: {String(registryRepairUnprovenTotalCount)} · Primary source: {registryRepairBlockingUnprovenPrimarySource} · Secondary sources: {registryRepairBlockingUnprovenSecondarySources.join(", ") || "NONE"}
            </p>
          ) : null}
          {registryRepairUnprovenPrimaryReason &&
              registryRepairRawUnprovenCount !== null ? (
            <p aria-live="polite" className="mt-3 rounded-xl border border-orange-300/30 bg-orange-300/[0.06] p-3 text-sm font-black text-orange-100">
              Raw pre-gate unproven count: {String(registryRepairRawUnprovenCount)} · Primary reason: {registryRepairUnprovenPrimaryReason}
            </p>
          ) : null}
          {registryRepairUnprovenReasonCounts ? (
            <section className="mt-3 rounded-xl border border-orange-300/20 bg-orange-300/[0.04] p-3 text-xs text-orange-50/80">
              <h3 className="font-black">Raw pre-gate unproven reason counts</h3>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                {REGISTRY_REPAIR_UNPROVEN_REASON_COUNT_KEYS.map((key) => (
                  <div className="flex justify-between gap-3" key={key}>
                    <dt>{key.replace("UNPROVEN_REASON_", "").replaceAll("_", " ")}</dt>
                    <dd>{String(registryRepairUnprovenReasonCounts[key])}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
          {registryRepairCreateStageCounts &&
              registryRepairCreateMaterializationStatus ? (
            <section className="mt-3 rounded-xl border border-lime-300/20 bg-lime-300/[0.04] p-3 text-xs text-lime-50/80">
              <h3 className="font-black">
                Create identity → materialization → absence-CAS gates
              </h3>
              <p className="mt-2 font-bold">
                Materialization status: {registryRepairCreateMaterializationStatus}
              </p>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                {REGISTRY_REPAIR_CREATE_STAGE_COUNT_KEYS.map((key) => (
                  <div className="flex justify-between gap-3" key={key}>
                    <dt>{key.replaceAll("_", " ")}</dt>
                    <dd>{String(registryRepairCreateStageCounts[key])}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
          {registryRepairOtherSubtypeCounts ? (
            <section className="mt-3 rounded-xl border border-lime-300/20 bg-lime-300/[0.04] p-3 text-xs text-lime-50/80">
              <h3 className="font-black">OTHER unproven subtype counts</h3>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                {REGISTRY_REPAIR_OTHER_UNPROVEN_SUBTYPES.map((subtype) => (
                  <div className="flex justify-between gap-3" key={subtype}>
                    <dt>{subtype.replaceAll("_", " ")}</dt>
                    <dd>{String(registryRepairOtherSubtypeCounts[subtype])}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
          {registryRepairAbsenceProofCauseCounts &&
              registryRepairAbsenceProofPrimaryCause &&
              registryRepairAbsenceProofUnprovenCount !== null ? (
            <section className="mt-3 rounded-xl border border-lime-300/20 bg-lime-300/[0.04] p-3 text-xs text-lime-50/80">
              <h3 className="font-black">Absence-proof cause counts</h3>
              <p className="mt-2 font-bold">
                Unproven: {String(registryRepairAbsenceProofUnprovenCount)} · Primary cause: {registryRepairAbsenceProofPrimaryCause}
              </p>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                {REGISTRY_REPAIR_ABSENCE_PROOF_CAUSE_COUNT_KEYS.map((key) => (
                  <div className="flex justify-between gap-3" key={key}>
                    <dt>{key.replace("ABSENCE_PROOF_CAUSE_", "").replaceAll("_", " ")}</dt>
                    <dd>{String(registryRepairAbsenceProofCauseCounts[key])}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
          {registryRepairLifecycleDiagnostic ? (
            <section className="mt-3 rounded-xl border border-lime-300/20 bg-lime-300/[0.04] p-3 text-xs text-lime-50/80">
              <h3 className="font-black">Lifecycle precondition diagnostic</h3>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                {[
                  ["Action", registryRepairLifecycleDiagnostic.action],
                  ["Stage", registryRepairLifecycleDiagnostic.stage],
                  ["Required signal", registryRepairLifecycleDiagnostic.requiredSignal],
                  ["Signal available", registryRepairLifecycleDiagnostic.signalAvailable],
                  ["Failure cause", registryRepairLifecycleDiagnostic.failureCause],
                ].map(([label, value]) => (
                  <div className="flex justify-between gap-3" key={String(label)}>
                    <dt>{label}</dt><dd>{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
          {registryRepairFinalDiagnostic ? (
            <section className="mt-3 rounded-xl border border-lime-300/20 bg-lime-300/[0.04] p-3 text-xs text-lime-50/80">
              <h3 className="font-black">Final identity vs precondition taxonomy</h3>
              <dl className="mt-2 grid gap-2 sm:grid-cols-3">
                <div><dt>Identity unproven</dt><dd>{String(registryRepairFinalDiagnostic.identityUnprovenCount)}</dd></div>
                <div><dt>Precondition unproven</dt><dd>{String(registryRepairFinalDiagnostic.preconditionUnprovenCount)}</dd></div>
                <div><dt>Final rejection reason</dt><dd>{String(registryRepairFinalDiagnostic.rejectionReason)}</dd></div>
              </dl>
            </section>
          ) : null}
          {registryCoverageDiagnostic ? (
            <div className="mt-5 space-y-2 text-xs text-white/75">
              <dl className="grid gap-2 text-xs text-white/75 sm:grid-cols-2">
                {[
                  ["Runtime config",
                    registryCoverageDiagnostic.REGISTRY_RUNTIME_CONFIG],
                  ["Supabase URL present",
                    registryCoverageDiagnostic.SUPABASE_URL_PRESENT],
                  ["Supabase service role present",
                    registryCoverageDiagnostic.SUPABASE_SERVICE_ROLE_PRESENT],
                  ["Registry source status",
                    registryCoverageDiagnostic.REGISTRY_SOURCE_RUNTIME_STATUS],
                  ["Registry record count",
                    registryCoverageDiagnostic.REGISTRY_RECORD_COUNT],
                  ["Live enumeration status",
                    registryCoverageDiagnostic.LIVE_ENUMERATION_RUNTIME_STATUS],
                  ["Live eBay listing count",
                    registryCoverageDiagnostic.LIVE_EBAY_LISTING_COUNT],
                  ["Live with itemId count",
                    registryCoverageDiagnostic.LIVE_WITH_ITEM_ID_COUNT],
                  ["Live with sku count",
                    registryCoverageDiagnostic.LIVE_WITH_SKU_COUNT],
                  ["Live with variation key count",
                    registryCoverageDiagnostic.LIVE_WITH_VARIATION_KEY_COUNT],
                  ["Live with complete composite count",
                    registryCoverageDiagnostic.LIVE_WITH_COMPLETE_COMPOSITE_IDENTITY_COUNT],
                  ["Registry with itemId count",
                    registryCoverageDiagnostic.REGISTRY_WITH_ITEM_ID_COUNT],
                  ["Registry with sku count",
                    registryCoverageDiagnostic.REGISTRY_WITH_SKU_COUNT],
                  ["Registry with variation key count",
                    registryCoverageDiagnostic.REGISTRY_WITH_VARIATION_KEY_COUNT],
                  ["Registry with complete composite count",
                    registryCoverageDiagnostic.REGISTRY_WITH_COMPLETE_COMPOSITE_IDENTITY_COUNT],
                  ["Item ID exact overlap count",
                    registryCoverageDiagnostic.ITEM_ID_EXACT_OVERLAP_COUNT],
                  ["SKU exact overlap count",
                    registryCoverageDiagnostic.SKU_EXACT_OVERLAP_COUNT],
                  ["Variation key exact overlap count",
                    registryCoverageDiagnostic.VARIATION_KEY_EXACT_OVERLAP_COUNT],
                  ["Item+sku overlap count",
                    registryCoverageDiagnostic.ITEM_ID_PLUS_SKU_OVERLAP_COUNT],
                  ["Item+variation overlap count",
                    registryCoverageDiagnostic.ITEM_ID_PLUS_VARIATION_OVERLAP_COUNT],
                  ["Sku+variation overlap count",
                    registryCoverageDiagnostic.SKU_PLUS_VARIATION_OVERLAP_COUNT],
                  ["Full composite overlap count",
                    registryCoverageDiagnostic.FULL_COMPOSITE_OVERLAP_COUNT],
                  ["Registry current identity",
                    registryCoverageDiagnostic.REGISTRY_CURRENT_IDENTITY_COUNT],
                  ["Registry legacy identity",
                    registryCoverageDiagnostic.REGISTRY_LEGACY_IDENTITY_COUNT],
                  ["Registry incomplete identity",
                    registryCoverageDiagnostic.REGISTRY_INCOMPLETE_IDENTITY_COUNT],
                  ["Registry historical-only",
                    registryCoverageDiagnostic.REGISTRY_HISTORICAL_ONLY_COUNT],
                  ["Registry identity unproven",
                    registryCoverageDiagnostic.REGISTRY_IDENTITY_UNPROVEN_COUNT],
                  ["Registry identity root cause",
                    registryCoverageDiagnostic.REGISTRY_IDENTITY_ROOT_CAUSE],
                  ["Safe backfill without duplication",
                    registryCoverageDiagnostic.SAFE_BACKFILL_WITHOUT_DUPLICATION],
                  ["Registry full-match rows",
                    registryCoverageDiagnostic.REGISTRY_FULL_MATCH_ROWS],
                  ["Registry item-id-only rows",
                    registryCoverageDiagnostic.REGISTRY_ITEM_ID_ONLY_ROWS],
                  ["Registry sku-only rows",
                    registryCoverageDiagnostic.REGISTRY_SKU_ONLY_ROWS],
                  ["Registry cross-linked rows",
                    registryCoverageDiagnostic.REGISTRY_CROSS_LINKED_ROWS],
                  ["Registry multiple item-id candidates rows",
                    registryCoverageDiagnostic.REGISTRY_MULTIPLE_ITEM_ID_CANDIDATE_ROWS],
                  ["Registry multiple sku candidates rows",
                    registryCoverageDiagnostic.REGISTRY_MULTIPLE_SKU_CANDIDATE_ROWS],
                  ["Registry no stable overlap rows",
                    registryCoverageDiagnostic.REGISTRY_NO_STABLE_OVERLAP_ROWS],
                  ["Registry topology unproven rows",
                    registryCoverageDiagnostic.REGISTRY_TOPOLOGY_UNPROVEN_ROWS],
                  ["Registry topology partition valid",
                    registryCoverageDiagnostic.REGISTRY_TOPOLOGY_PARTITION_VALID],
                  ["Live referenced by registry item-id count",
                    registryCoverageDiagnostic.LIVE_REFERENCED_BY_REGISTRY_ITEM_ID_COUNT],
                  ["Live referenced by registry sku count",
                    registryCoverageDiagnostic.LIVE_REFERENCED_BY_REGISTRY_SKU_COUNT],
                  ["Live referenced by both same registry row count",
                    registryCoverageDiagnostic.LIVE_REFERENCED_BY_BOTH_SAME_REGISTRY_ROW_COUNT],
                  ["Live referenced by conflicting registry rows count",
                    registryCoverageDiagnostic.LIVE_REFERENCED_BY_CONFLICTING_REGISTRY_ROWS_COUNT],
                  ["Live with no stable registry reference count",
                    registryCoverageDiagnostic.LIVE_WITH_NO_STABLE_REGISTRY_REFERENCE_COUNT],
                  ["Cross-link conflict count",
                    registryCoverageDiagnostic.CROSS_LINK_CONFLICT_COUNT],
                  ["Item-id anchored relink candidates",
                    registryCoverageDiagnostic.ITEM_ID_ANCHORED_RELINK_CANDIDATE_COUNT],
                  ["Sku anchored relink candidates",
                    registryCoverageDiagnostic.SKU_ANCHORED_RELINK_CANDIDATE_COUNT],
                  ["Conflicted relink candidates",
                    registryCoverageDiagnostic.CONFLICTED_RELINK_CANDIDATE_COUNT],
                  ["No safe relink candidates",
                    registryCoverageDiagnostic.NO_SAFE_RELINK_CANDIDATE_COUNT],
                  ["Safe relink candidates",
                    registryCoverageDiagnostic.SAFE_RELINK_CANDIDATE_COUNT],
                  ["Safe automated relink",
                    registryCoverageDiagnostic.SAFE_AUTOMATED_RELINK],
                  ["Live new registry entry candidates",
                    registryCoverageDiagnostic.LIVE_NEW_REGISTRY_ENTRY_CANDIDATE_COUNT],
                  ["Safe new entry backfill possible",
                    registryCoverageDiagnostic.SAFE_NEW_ENTRY_BACKFILL_POSSIBLE],
                  ["Variation key required for non-variation listing",
                    registryCoverageDiagnostic.VARIATION_KEY_REQUIRED_FOR_NON_VARIATION_LISTING],
                  ["Empty variation is canonical for non-variation listing",
                    registryCoverageDiagnostic.EMPTY_VARIATION_IS_CANONIC_FOR_NON_VARIATION_LISTING],
                  ["Variation semantics cause current zero match",
                    registryCoverageDiagnostic.VARIATION_SEMANTICS_CAUSE_CURRENT_ZERO_MATCH],
                  ["Registry matched",
                    registryCoverageDiagnostic.REGISTRY_MATCHED_COUNT],
                  ["Registry missing",
                    registryCoverageDiagnostic.REGISTRY_MISSING_COUNT],
                  ["Registry orphaned",
                    registryCoverageDiagnostic.REGISTRY_ORPHANED_COUNT],
                  ["Registry ambiguous",
                    registryCoverageDiagnostic.REGISTRY_AMBIGUOUS_COUNT],
                  ["Registry coverage %",
                    registryCoverageDiagnostic.REGISTRY_COVERAGE_PERCENT],
                  ["Registry lifecycle fields",
                    registryCoverageDiagnostic.REGISTRY_LIFECYCLE_FIELDS],
                  ["Registry provenance fields",
                    registryCoverageDiagnostic.REGISTRY_PROVENANCE_FIELDS],
                  ["Registry has active-state concept",
                    registryCoverageDiagnostic.REGISTRY_HAS_ACTIVE_STATE],
                  ["Registry has last-seen signal",
                    registryCoverageDiagnostic.REGISTRY_HAS_LAST_SEEN_SIGNAL],
                  ["Registry has Product Case link",
                    registryCoverageDiagnostic.REGISTRY_HAS_PRODUCT_CASE_LINK],
                  ["Registry has source/origin",
                    registryCoverageDiagnostic.REGISTRY_HAS_SOURCE_ORIGIN],
                  ["Live partition valid",
                    registryCoverageDiagnostic.LIVE_PARTITION_VALID],
                  ["Registry partition valid",
                    registryCoverageDiagnostic.REGISTRY_PARTITION_VALID],
                  ["Item-id-only row count",
                    registryCoverageDiagnostic.ITEM_ID_ONLY_ROW_COUNT],
                  ["Item-id-only row itemId unique both sides",
                    registryCoverageDiagnostic.ITEM_ID_ONLY_ITEM_ID_UNIQUE_BOTH_SIDES],
                  ["Item-id-only row registry SKU matches any other live",
                    registryCoverageDiagnostic.ITEM_ID_ONLY_REGISTRY_SKU_MATCHES_ANY_OTHER_LIVE_LISTING],
                  ["Item-id-only row live SKU matches any other Registry row",
                    registryCoverageDiagnostic.ITEM_ID_ONLY_LIVE_SKU_MATCHES_ANY_OTHER_REGISTRY_ROW],
                  ["Item-id-only marketplace/account compatible",
                    registryCoverageDiagnostic.ITEM_ID_ONLY_ACCOUNT_MARKETPLACE_COMPATIBLE],
                  ["Item-id-only lifecycle class",
                    registryCoverageDiagnostic.ITEM_ID_ONLY_LIFECYCLE_CLASS],
                  ["Item-id-only deterministic relink possible",
                    registryCoverageDiagnostic.ITEM_ID_ONLY_DETERMINISTIC_RELINK_POSSIBLE],
                  ["Manual listing runtime autodiscovery",
                    registryCoverageDiagnostic.MANUAL_LISTING_RUNTIME_AUTODISCOVERY],
                  ["SKU-only registry itemId not live",
                    registryCoverageDiagnostic.SKU_ONLY_REGISTRY_ITEM_ID_NOT_LIVE_COUNT],
                  ["SKU-only unique sku both sides",
                    registryCoverageDiagnostic.SKU_ONLY_UNIQUE_SKU_BOTH_SIDES_COUNT],
                  ["SKU-only no competing registry relation",
                    registryCoverageDiagnostic.SKU_ONLY_NO_COMPETING_REGISTRY_RELATION_COUNT],
                  ["SKU-only relist candidates",
                    registryCoverageDiagnostic.SKU_ONLY_RELIST_CANDIDATE_COUNT],
                  ["SKU-only stale registry itemId",
                    registryCoverageDiagnostic.SKU_ONLY_STALE_REGISTRY_ITEM_ID_COUNT],
                  ["SKU-only SKU reuse risk",
                    registryCoverageDiagnostic.SKU_ONLY_SKU_REUSE_RISK_COUNT],
                  ["SKU-only conflicted identity",
                    registryCoverageDiagnostic.SKU_ONLY_CONFLICTED_IDENTITY_COUNT],
                  ["SKU-only unproven count",
                    registryCoverageDiagnostic.SKU_ONLY_UNPROVEN_COUNT],
                  ["SKU-only deterministic relink candidates",
                    registryCoverageDiagnostic.SKU_ONLY_DETERMINISTIC_RELINK_CANDIDATE_COUNT],
                  ["No-overlap historical/stale",
                    registryCoverageDiagnostic.NO_OVERLAP_HISTORICAL_OR_STALE_COUNT],
                  ["No-overlap identity drift",
                    registryCoverageDiagnostic.NO_OVERLAP_CURRENT_IDENTITY_DRIFT_COUNT],
                  ["No-overlap unrelated",
                    registryCoverageDiagnostic.NO_OVERLAP_UNRELATED_COUNT],
                  ["No-overlap unproven",
                    registryCoverageDiagnostic.NO_OVERLAP_UNPROVEN_COUNT],
                  ["Registry stale active rows present",
                    registryCoverageDiagnostic.REGISTRY_STALE_ACTIVE_ROWS_PRESENT],
                  ["Certified existing relationship count",
                    registryCoverageDiagnostic.CERTIFIED_EXISTING_RELATIONSHIP_COUNT],
                  ["Certified relink candidate count",
                    registryCoverageDiagnostic.CERTIFIED_RELINK_CANDIDATE_COUNT],
                  ["Unresolved relationship count",
                    registryCoverageDiagnostic.UNRESOLVED_RELATIONSHIP_COUNT],
                  ["True new entry candidate count",
                    registryCoverageDiagnostic.TRUE_NEW_ENTRY_CANDIDATE_COUNT],
                  ["Plan relink existing count",
                    registryCoverageDiagnostic.PLAN_RELINK_EXISTING_COUNT],
                  ["Plan create new count",
                    registryCoverageDiagnostic.PLAN_CREATE_NEW_COUNT],
                  ["Plan mark stale or historical",
                    registryCoverageDiagnostic.PLAN_MARK_STALE_OR_HISTORICAL_COUNT],
                  ["Plan require human review",
                    registryCoverageDiagnostic.PLAN_REQUIRE_HUMAN_REVIEW_COUNT],
                  ["Registry repair plan certified",
                    registryCoverageDiagnostic.REGISTRY_REPAIR_PLAN_CERTIFIED],
                  ["Automated mutation safe",
                    registryCoverageDiagnostic.AUTOMATED_MUTATION_SAFE],
                  ["eBay Item ID authoritative for identity",
                    registryCoverageDiagnostic.IS_EBAY_ITEM_ID_AUTHORITATIVE_FOR_LISTING_IDENTITY],
                  ["SKU allowed as relist continuity signal",
                    registryCoverageDiagnostic.IS_SKU_ALLOWED_AS_RELIST_CONTINUITY_SIGNAL],
                ].map(([label, value]) => (
                  <div className="rounded-lg bg-black/20 p-3" key={String(label)}>
                    <dt className="break-all font-bold text-white/50">{label}</dt>
                    <dd className="mt-1 break-all">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          {registryRepairDryRun ? (
            <div className="mt-6 space-y-5 text-xs text-white/75">
              <section className="rounded-2xl border border-amber-200/25 bg-black/20 p-4">
                <p className="font-black text-amber-100">{registryRepairDryRun.DRY_RUN_LABEL}</p>
                <p className={`mt-3 rounded-xl border p-3 font-black ${
                  registryRepairDryRun.DRY_RUN_FRESHNESS_STATUS === "STALE"
                    ? "border-red-300/40 bg-red-300/[0.08] text-red-100"
                    : "border-cyan-200/25 bg-cyan-200/[0.06] text-cyan-50"
                }`}>
                  {registryRepairDryRun.DRY_RUN_STALE_LABEL}
                </p>
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[
                    ["Evidence status", registryRepairDryRun.EVIDENCE_STATUS],
                    ["Dry-run freshness", registryRepairDryRun.DRY_RUN_FRESHNESS_STATUS],
                    ["Ambiguity class", registryRepairDryRun.AMBIGUITY_CLASS],
                    ["Unproven component", registryRepairDryRun.UNPROVEN_COMPONENT],
                    ["Unproven count", registryRepairDryRun.UNPROVEN_COUNT],
                    ["Unproven total count", registryRepairDryRun.UNPROVEN_TOTAL_COUNT],
                    ["Blocking unproven primary source", registryRepairDryRun.BLOCKING_UNPROVEN_PRIMARY_SOURCE],
                    ["Blocking unproven secondary sources", registryRepairDryRun.BLOCKING_UNPROVEN_SECONDARY_SOURCES.join(", ") || "NONE"],
                    ["Raw pre-gate unproven count", registryRepairDryRun.RAW_UNPROVEN_COUNT],
                    ["Unproven primary reason", registryRepairDryRun.UNPROVEN_PRIMARY_REASON],
                    ["Current live count", registryRepairDryRun.CURRENT_LIVE_COUNT],
                    ["Current Registry count", registryRepairDryRun.CURRENT_REGISTRY_COUNT],
                    ["Current evidence fingerprint", registryRepairDryRun.CURRENT_EVIDENCE_FINGERPRINT],
                    ["Dry run state bound", registryRepairDryRun.DRY_RUN_STATE_BOUND],
                    ["State fingerprint present", registryRepairDryRun.DRY_RUN_STATE_FINGERPRINT_PRESENT],
                    ["Invalidates on eBay state change", registryRepairDryRun.APPROVAL_INVALIDATES_ON_EBAY_STATE_CHANGE],
                    ["Invalidates on Registry state change", registryRepairDryRun.APPROVAL_INVALIDATES_ON_REGISTRY_STATE_CHANGE],
                    ["Dry-run package handle", registryRepairDryRun.DRY_RUN_PACKAGE_HANDLE],
                    ["Ready for human approval", registryRepairDryRun.DRY_RUN_READY_FOR_APPROVAL],
                  ].map(([label, value]) => (
                    <div className="rounded-lg bg-black/25 p-3" key={String(label)}>
                      <dt className="font-bold text-white/50">{label}</dt>
                      <dd className="mt-1 break-all">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <p className="font-black text-white">
                Current action groups from this live recheck
              </p>
              <section className="rounded-2xl border border-orange-200/20 bg-orange-200/[0.04] p-4">
                <h3 className="font-black text-orange-50">
                  Action guard / precondition diagnostics
                </h3>
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[
                    ["Repair existing", registryRepairDryRun.REPAIR_EXISTING_UNPROVEN_COUNT, registryRepairDryRun.REPAIR_EXISTING_UNPROVEN_SOURCE],
                    ["Mark stale", registryRepairDryRun.MARK_STALE_UNPROVEN_COUNT, registryRepairDryRun.MARK_STALE_UNPROVEN_SOURCE],
                    ["Create new", registryRepairDryRun.CREATE_NEW_UNPROVEN_COUNT, registryRepairDryRun.CREATE_NEW_UNPROVEN_SOURCE],
                    ["Human review", registryRepairDryRun.HUMAN_REVIEW_UNPROVEN_COUNT, registryRepairDryRun.HUMAN_REVIEW_UNPROVEN_SOURCE],
                    ["Identity partition", registryRepairDryRun.IDENTITY_PARTITION_UNPROVEN_COUNT, registryRepairDryRun.IDENTITY_PARTITION_UNPROVEN_SOURCE],
                  ].map(([label, diagnosticCount, source]) => (
                    <div className="rounded-lg bg-black/20 p-3" key={String(label)}>
                      <dt className="font-bold text-white/50">{label}</dt>
                      <dd className="mt-1">
                        Unproven: {String(diagnosticCount)} · Source: {String(source)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section className="rounded-2xl border border-sky-200/20 bg-sky-200/[0.04] p-4">
                <h3 className="font-black text-sky-50">
                  Raw pre-gate partitions · diagnostic only
                </h3>
                <p className="mt-2 text-white/50">
                  These raw counts do not replace certified action counts.
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <dl className="space-y-2 rounded-xl bg-black/20 p-3">
                    {[
                      ["Already matched", registryRepairDryRun.RAW_ALREADY_MATCHED_COUNT],
                      ["Repair existing", registryRepairDryRun.RAW_REPAIR_EXISTING_COUNT],
                      ["Create new", registryRepairDryRun.RAW_CREATE_NEW_COUNT],
                      ["Human review", registryRepairDryRun.RAW_HUMAN_REVIEW_COUNT],
                      ["Unproven", registryRepairDryRun.RAW_UNPROVEN_COUNT],
                      ["Live raw partition valid", registryRepairDryRun.LIVE_RAW_PARTITION_VALID],
                    ].map(([label, value]) => (
                      <div className="flex justify-between gap-3" key={String(label)}>
                        <dt className="font-bold text-white/50">{label}</dt>
                        <dd>{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                  <dl className="space-y-2 rounded-xl bg-black/20 p-3">
                    {[
                      ["Keep current", registryRepairDryRun.RAW_KEEP_CURRENT_COUNT],
                      ["Repair existing", registryRepairDryRun.RAW_REPAIR_EXISTING_REGISTRY_COUNT],
                      ["Mark stale", registryRepairDryRun.RAW_MARK_STALE_COUNT],
                      ["Mark historical", registryRepairDryRun.RAW_MARK_HISTORICAL_COUNT],
                      ["Human review", registryRepairDryRun.RAW_HUMAN_REVIEW_REGISTRY_COUNT],
                      ["Unproven", registryRepairDryRun.RAW_UNPROVEN_REGISTRY_COUNT],
                      ["Registry raw partition valid", registryRepairDryRun.REGISTRY_RAW_PARTITION_VALID],
                    ].map(([label, value]) => (
                      <div className="flex justify-between gap-3" key={String(label)}>
                        <dt className="font-bold text-white/50">{label}</dt>
                        <dd>{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </section>
              <section className="rounded-2xl border border-orange-200/20 bg-orange-200/[0.04] p-4">
                <h3 className="font-black text-orange-50">
                  Phase 1 unproven aggregate aliases
                </h3>
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[
                    ["Repair existing", registryRepairDryRun.UNPROVEN_REPAIR_EXISTING_COUNT],
                    ["Mark stale", registryRepairDryRun.UNPROVEN_MARK_STALE_COUNT],
                    ["Create new", registryRepairDryRun.UNPROVEN_CREATE_NEW_COUNT],
                    ["Human review", registryRepairDryRun.UNPROVEN_HUMAN_REVIEW_COUNT],
                    ["Identity partition", registryRepairDryRun.UNPROVEN_IDENTITY_PARTITION_COUNT],
                    ["State guard", registryRepairDryRun.UNPROVEN_STATE_GUARD_COUNT],
                    ["Source read", registryRepairDryRun.UNPROVEN_SOURCE_READ_COUNT],
                    ["Other", registryRepairDryRun.UNPROVEN_OTHER_COUNT],
                  ].map(([label, diagnosticCount]) => (
                    <div className="flex justify-between gap-3 rounded-lg bg-black/20 p-3" key={String(label)}>
                      <dt className="font-bold text-white/50">{label}</dt>
                      <dd>{String(diagnosticCount)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section aria-label="Registry repair dry-run groups" className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-sm font-semibold text-slate-900">
                    Repair-row lifecycle diagnostic
                  </p>
                  <dl className="mt-3 space-y-1 text-xs text-slate-700">
                    <div>Status class: {registryRepairDryRun.REPAIR_ROW_CURRENT_STATUS_CLASS}</div>
                    <div>Raw status recognized: {registryRepairDryRun.REPAIR_ROW_STATUS_RAW_VALUE_RECOGNIZED}</div>
                    <div>Status reactivatable: {registryRepairDryRun.REPAIR_ROW_STATUS_REACTIVATABLE}</div>
                    <div>Account scope match: {registryRepairDryRun.REPAIR_ROW_ACCOUNT_SCOPE_MATCH}</div>
                    <div>Authoritative Item ID still live: {registryRepairDryRun.REPAIR_ROW_AUTHORITATIVE_ITEM_ID_STILL_LIVE}</div>
                    <div>Item ID unique both sides: {registryRepairDryRun.REPAIR_ROW_ITEM_ID_UNIQUE_BOTH_SIDES}</div>
                    <div>Competing relationship: {registryRepairDryRun.REPAIR_ROW_COMPETING_RELATIONSHIP}</div>
                    <div>Registry lifecycle supports reactivation: {registryRepairDryRun.REGISTRY_LIFECYCLE_SUPPORTS_REACTIVATION}</div>
                    <div>Reactivation allowed from STALE: {registryRepairDryRun.REACTIVATION_ALLOWED_FROM_STALE}</div>
                    <div>Reactivation allowed from ENDED: {registryRepairDryRun.REACTIVATION_ALLOWED_FROM_ENDED}</div>
                    <div>Reactivation allowed from HISTORICAL: {registryRepairDryRun.REACTIVATION_ALLOWED_FROM_HISTORICAL}</div>
                    <div>Reactivation allowed from UNKNOWN: {registryRepairDryRun.REACTIVATION_ALLOWED_FROM_UNKNOWN}</div>
                    <div>Reactivation CAS supported: {registryRepairDryRun.REACTIVATION_CAS_SUPPORTED}</div>
                  </dl>
                </div>
                {[
                  {
                    title: "REPAIR EXISTING",
                    count: registryRepairDryRun.REPAIR_EXISTING_COUNT,
                    status: registryRepairDryRun.REPAIR_PRECONDITION_STATUS,
                    fields: registryRepairDryRun.REPAIR_FIELDS_TO_CHANGE,
                    fieldsLabel: "Fields to change",
                  },
                  {
                    title: "CREATE NEW",
                    count: registryRepairDryRun.CREATE_NEW_COUNT,
                    status: registryRepairDryRun.CREATE_PRECONDITION_STATUS,
                    fields: registryRepairDryRun.CREATE_FIELDS_TO_POPULATE,
                    fieldsLabel: "Fields to populate",
                  },
                  {
                    title: "MARK STALE",
                    count: registryRepairDryRun.MARK_STALE_COUNT,
                    status: registryRepairDryRun.STALE_PRECONDITION_STATUS,
                    fields: registryRepairDryRun.STALE_FIELDS_TO_CHANGE,
                    fieldsLabel: "Fields to change",
                  },
                ].map((group) => (
                  <article className="rounded-2xl border border-white/10 bg-black/20 p-4" key={group.title}>
                    <h3 className="font-black text-white">{group.title}</h3>
                    <p className="mt-2">Count: {String(group.count)}</p>
                    <p>Preconditions: {String(group.status)}</p>
                    <p className="mt-2 text-white/50">{group.fieldsLabel}</p>
                    <p className="mt-1 break-all">{group.fields.join(", ") || "NONE"}</p>
                  </article>
                ))}
              </section>

              <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <h3 className="font-black text-white">
                  HUMAN REVIEW · {String(registryRepairDryRun.HUMAN_REVIEW_COUNT)}
                </h3>
                <p className="mt-2 text-white/55">
                  SKU equality alone does not authorize relinking. Candidate handles are opaque.
                </p>
                <p className="mt-3 font-black text-amber-200">
                  HUMAN REVIEW ITEMS WILL NOT BE MODIFIED
                </p>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  {[
                    ["Automatic repair existing", registryRepairDryRun.REPAIR_EXISTING_AUTOMATIC_COUNT],
                    ["Review reason: reactivation not allowed", registryRepairDryRun.HUMAN_REVIEW_REASON_REACTIVATION_NOT_ALLOWED_COUNT],
                    ["Identity unproven", registryRepairDryRun.IDENTITY_UNPROVEN_COUNT],
                    ["Automatic precondition unproven", registryRepairDryRun.AUTOMATIC_PRECONDITION_UNPROVEN_COUNT],
                    ["Automatic tranche preconditions pass", registryRepairDryRun.AUTOMATIC_TRANCHE_PRECONDITIONS_PASS],
                    ["Human review write allowed", registryRepairDryRun.HUMAN_REVIEW_WRITE_ALLOWED],
                    ["Human review mutation count", registryRepairDryRun.HUMAN_REVIEW_MUTATION_COUNT],
                  ].map(([label, value]) => (
                    <div className="flex justify-between gap-3 rounded-lg bg-black/20 p-3" key={String(label)}>
                      <dt className="font-bold text-white/50">{label}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {registryRepairDryRun.HUMAN_REVIEW_CANDIDATES.map((candidate) => (
                    <article className="rounded-xl border border-white/10 p-3" key={candidate.CANDIDATE_HANDLE}>
                      <dl className="space-y-2">
                        {[
                          ["Candidate handle", candidate.CANDIDATE_HANDLE],
                          ["Relationship type", candidate.RELATIONSHIP_TYPE],
                          ["Registry Item ID currently live", candidate.REGISTRY_ITEM_ID_CURRENTLY_LIVE],
                          ["SKU unique both sides", candidate.SKU_UNIQUE_BOTH_SIDES],
                          ["Competing Registry relation", candidate.COMPETING_REGISTRY_RELATION],
                          ["Recommended action", candidate.RECOMMENDED_ACTION],
                        ].map(([label, value]) => (
                          <div key={String(label)}>
                            <dt className="font-bold text-white/50">{label}</dt>
                            <dd className="mt-1 break-all">{String(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    </article>
                  ))}
                </div>
              </section>

              <section className="grid gap-3 md:grid-cols-2">
                <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <h3 className="font-black text-white">Live listing partition</h3>
                  <dl className="mt-3 space-y-2">
                    {[
                      ["Already matched", registryRepairDryRun.LIVE_ALREADY_MATCHED_COUNT],
                      ["Repair existing", registryRepairDryRun.LIVE_REPAIR_EXISTING_COUNT],
                      ["Create new", registryRepairDryRun.LIVE_CREATE_NEW_COUNT],
                      ["Human review", registryRepairDryRun.LIVE_HUMAN_REVIEW_COUNT],
                      ["Unproven", registryRepairDryRun.LIVE_UNPROVEN_COUNT],
                      ["Partition valid", registryRepairDryRun.LIVE_DRY_RUN_PARTITION_VALID],
                    ].map(([label, value]) => (
                      <div className="flex justify-between gap-3" key={String(label)}>
                        <dt className="font-bold text-white/50">{label}</dt>
                        <dd>{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
                <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <h3 className="font-black text-white">Registry row partition</h3>
                  <dl className="mt-3 space-y-2">
                    {[
                      ["Keep current", registryRepairDryRun.REGISTRY_KEEP_CURRENT_COUNT],
                      ["Repair existing", registryRepairDryRun.REGISTRY_REPAIR_EXISTING_COUNT],
                      ["Mark stale", registryRepairDryRun.REGISTRY_MARK_STALE_COUNT],
                      ["Mark historical", registryRepairDryRun.REGISTRY_MARK_HISTORICAL_COUNT],
                      ["Human review", registryRepairDryRun.REGISTRY_HUMAN_REVIEW_COUNT],
                      ["Unproven", registryRepairDryRun.REGISTRY_UNPROVEN_COUNT],
                      ["Partition valid", registryRepairDryRun.REGISTRY_DRY_RUN_PARTITION_VALID],
                    ].map(([label, value]) => (
                      <div className="flex justify-between gap-3" key={String(label)}>
                        <dt className="font-bold text-white/50">{label}</dt>
                        <dd>{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              </section>

              <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <h3 className="font-black text-white">Future write design · not executable here</h3>
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[
                    ["Write operation idempotent", registryRepairDryRun.WRITE_OPERATION_IDEMPOTENT],
                    ["Stale-state guard supported", registryRepairDryRun.STALE_STATE_GUARD_SUPPORTED],
                    ["Live recheck required before write", registryRepairDryRun.LIVE_RECHECK_REQUIRED_BEFORE_WRITE],
                    ["Partial-failure policy", registryRepairDryRun.PARTIAL_FAILURE_POLICY],
                    ["Rollback strategy", registryRepairDryRun.ROLLBACK_STRATEGY],
                  ].map(([label, value]) => (
                    <div className="rounded-lg bg-black/25 p-3" key={String(label)}>
                      <dt className="font-bold text-white/50">{label}</dt>
                      <dd className="mt-1 break-all">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.05] p-4">
                <h3 className="font-black text-cyan-50">EXPECTATION ONLY · NOT OBSERVED RUNTIME STATE</h3>
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[
                    ["Expected matched after safe tranche", registryRepairDryRun.EXPECTED_MATCHED_AFTER_SAFE_TRANCHE],
                    ["Expected live count", registryRepairDryRun.EXPECTED_LIVE_COUNT],
                    ["Expected pending human review", registryRepairDryRun.EXPECTED_PENDING_HUMAN_REVIEW],
                    ["Expected coverage percent", registryRepairDryRun.EXPECTED_COVERAGE_PERCENT],
                  ].map(([label, value]) => (
                    <div className="rounded-lg bg-black/20 p-3" key={String(label)}>
                      <dt className="font-bold text-white/50">{label}</dt>
                      <dd className="mt-1">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="rounded-2xl border border-emerald-200/20 bg-emerald-200/[0.05] p-4">
                <h3 className="font-black text-emerald-50">Zero-write safety counters</h3>
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[
                    ["Registry mutations", registryRepairDryRun.REGISTRY_MUTATIONS],
                    ["eBay writes", registryRepairDryRun.EBAY_WRITES],
                    ["Product Case mutations", registryRepairDryRun.PRODUCT_CASE_MUTATIONS],
                    ["Inventory writes", registryRepairDryRun.INVENTORY_WRITES],
                    ["Fulfillment writes", registryRepairDryRun.FULFILLMENT_WRITES],
                    ["OAuth changes", registryRepairDryRun.OAUTH_CHANGES],
                    ["Vercel env changes", registryRepairDryRun.VERCEL_ENV_CHANGES],
                  ].map(([label, value]) => (
                    <div className="flex justify-between gap-3 rounded-lg bg-black/20 p-3" key={String(label)}>
                      <dt className="font-bold text-white/50">{label}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </div>
          ) : null}
        </section>

        <section className="rounded-3xl border border-cyan-300/25 bg-cyan-300/[0.06] p-6">
          <h2 className="font-black">Preflight no interactivo</h2>
          <p className="mt-3 text-sm leading-6 text-white/70">
            Comprueba Client ID/RuName, scopes, state y serialización directamente contra el
            endpoint de autorización. No inicia sesión, no crea ledger/cookie, no redirige y no
            intercambia códigos.
          </p>
          <button
            className="mt-4 rounded-2xl border border-cyan-300/50 px-5 py-2 text-sm font-black text-cyan-200 disabled:opacity-40"
            type="button"
            disabled={diagnosing || loading || matchingCredentials ||
              certifyingInstalledRuntime || diagnosingInventoryConsumer ||
              diagnosingRegistryCoverage || previewingRegistryRepair ||
              !runtimeCredentialMatchAllowsStart(credentialMatch)}
            onClick={diagnose}
          >
            {diagnosing ? "Diagnosticando…" : "Diagnosticar sin iniciar OAuth"}
          </button>
          {diagnosis ? (
            <dl className="mt-5 grid gap-2 text-xs text-white/75 sm:grid-cols-2">
              {[
                ["Root cause", diagnosis.rootCause],
                ["Base", `${diagnosis.testBase?.acceptedByAuthEndpoint ?? "NO"} · ${diagnosis.testBase?.safeErrorCategory ?? "UNKNOWN"}`],
                ["Base + Account", `${diagnosis.testBaseAccount?.acceptedByAuthEndpoint ?? "NO"} · ${diagnosis.testBaseAccount?.safeErrorCategory ?? "UNKNOWN"}`],
                ["Base + Account + Inventory", `${diagnosis.testBaseAccountInventory?.acceptedByAuthEndpoint ?? "NO"} · ${diagnosis.testBaseAccountInventory?.safeErrorCategory ?? "UNKNOWN"}`],
                ["Four scopes", `${diagnosis.testFullFourScopes?.acceptedByAuthEndpoint ?? "NO"} · ${diagnosis.testFullFourScopes?.safeErrorCategory ?? "UNKNOWN"}`],
                ["State", diagnosis.stateCausesInvalidRequest],
                ["Encoding +", diagnosis.previousPlusEncodingWithState?.safeErrorCategory],
                ["Encoding cause", diagnosis.encodingCausesInvalidRequest],
                ["RuName source", diagnosis.runameSource],
                ["RuName/app binding", diagnosis.runameAppBinding],
                ["Ledger rows", diagnosis.ledgerRowsCreated],
                ["Human redirects", diagnosis.humanRedirects],
              ].map(([label, value]) => (
                <div className="rounded-lg bg-black/20 p-3" key={String(label)}>
                  <dt className="font-bold text-white/50">{label}</dt>
                  <dd className="mt-1 break-all">{String(value ?? "UNPROVEN")}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>

        <label className="flex items-start gap-3 rounded-2xl border border-white/10 p-4 text-sm">
          <input
            className="mt-1"
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          Confirmo que el Auth Accepted URL coincide exactamente con el callback mostrado y que
          usaré la misma cuenta seller Production certificada.
        </label>

        {error ? (
          <p className="rounded-xl bg-red-500/15 p-4 text-sm text-red-200">
            {error}
          </p>
        ) : null}

        <button
          className="rounded-2xl bg-cyan-300 px-6 py-3 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
          type="button"
          disabled={!confirmed || loading || diagnosing || matchingCredentials ||
            certifyingInstalledRuntime || diagnosingInventoryConsumer ||
            diagnosingRegistryCoverage || previewingRegistryRepair ||
            !callbackUrl ||
            !runtimeCredentialMatchAllowsStart(credentialMatch) ||
            !diagnosisAllowsStart(diagnosis)}
          aria-disabled={!runtimeCredentialMatchAllowsStart(credentialMatch) ||
            !diagnosisAllowsStart(diagnosis)}
          onClick={begin}
        >
          {loading ? "Preparando…" : "Iniciar consentimiento eBay una vez"}
        </button>
      </div>
    </main>
  )
}
