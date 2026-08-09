"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"
import type { EbayRegistryCoverageDiagnostic } from "@/lib/ebay/ebay-commercial-monitor-live-readonly"

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

const REGISTRY_COVERAGE_DIAGNOSTIC_KEYS = [
  "REGISTRY_RUNTIME_CONFIG",
  "SUPABASE_URL_PRESENT",
  "SUPABASE_SERVICE_ROLE_PRESENT",
  "REGISTRY_SOURCE_RUNTIME_STATUS",
  "REGISTRY_RECORD_COUNT",
  "LIVE_ENUMERATION_RUNTIME_STATUS",
  "LIVE_EBAY_LISTING_COUNT",
  "REGISTRY_MATCHED_COUNT",
  "REGISTRY_MISSING_COUNT",
  "REGISTRY_ORPHANED_COUNT",
  "REGISTRY_AMBIGUOUS_COUNT",
  "REGISTRY_COVERAGE_PERCENT",
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
  "ITEM_ID_ANCHORED_RELINK_CANDIDATE_COUNT",
  "SKU_ANCHORED_RELINK_CANDIDATE_COUNT",
  "CONFLICTED_RELINK_CANDIDATE_COUNT",
  "NO_SAFE_RELINK_CANDIDATE_COUNT",
  "SAFE_RELINK_CANDIDATE_COUNT",
  "SAFE_AUTOMATED_RELINK",
  "LIVE_NEW_REGISTRY_ENTRY_CANDIDATE_COUNT",
  "SAFE_NEW_ENTRY_BACKFILL_POSSIBLE",
  "VARIATION_KEY_REQUIRED_FOR_NON_VARIATION_LISTING",
  "EMPTY_VARIATION_IS_CANONIC_FOR_NON_VARIATION_LISTING",
  "VARIATION_SEMANTICS_CAUSE_CURRENT_ZERO_MATCH",
  "MANUAL_LISTING_RUNTIME_AUTODISCOVERY",
] as const

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
  const percent = (candidate: unknown) =>
    candidate === "UNPROVEN" ||
    (typeof candidate === "number" && Number.isFinite(candidate) &&
      candidate >= 0 && candidate <= 100)
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
    !countLike(record.REGISTRY_CURRENT_IDENTITY_COUNT) ||
    !countLike(record.REGISTRY_LEGACY_IDENTITY_COUNT) ||
    !countLike(record.REGISTRY_INCOMPLETE_IDENTITY_COUNT) ||
    !countLike(record.REGISTRY_HISTORICAL_ONLY_COUNT) ||
    !countLike(record.REGISTRY_IDENTITY_UNPROVEN_COUNT) ||
    !countLike(record.REGISTRY_FULL_MATCH_ROWS) ||
    !countLike(record.REGISTRY_ITEM_ID_ONLY_ROWS) ||
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
    !countLike(record.ITEM_ID_ANCHORED_RELINK_CANDIDATE_COUNT) ||
    !countLike(record.SKU_ANCHORED_RELINK_CANDIDATE_COUNT) ||
    !countLike(record.CONFLICTED_RELINK_CANDIDATE_COUNT) ||
    !countLike(record.NO_SAFE_RELINK_CANDIDATE_COUNT) ||
    !countLike(record.SAFE_RELINK_CANDIDATE_COUNT) ||
    !countLike(record.REGISTRY_IDENTITY_UNPROVEN_COUNT) ||
    !percent(record.REGISTRY_COVERAGE_PERCENT) ||
    !["AVAILABLE", "AUTH_UNAVAILABLE", "READ_FAILED"].includes(
      String(record.LIVE_ENUMERATION_RUNTIME_STATUS),
    )) return false
  if (![
    "ITEM_ID_MISMATCH",
    "SKU_MISMATCH",
    "VARIATION_KEY_MISMATCH",
    "COMPOSITE_KEY_OVERSTRICT",
    "LEGACY_IDENTITY_CONTRACT",
    "REGISTRY_ROWS_HISTORICAL_ONLY",
    "MIXED_CAUSES",
    "UNPROVEN",
  ].includes(String(record.REGISTRY_IDENTITY_ROOT_CAUSE))) return false
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
              diagnosingRegistryCoverage}
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
              loading ||
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
              loading ||
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
              loading || !runtimeCredentialMatchAllowsStart(credentialMatch)}
            onClick={diagnoseRegistryCoverageRuntime}
          >
            Diagnosticar cobertura Registry
          </button>
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
                  ["Live partition valid",
                    registryCoverageDiagnostic.LIVE_PARTITION_VALID],
                  ["Registry partition valid",
                    registryCoverageDiagnostic.REGISTRY_PARTITION_VALID],
                  ["Manual listing runtime autodiscovery",
                    registryCoverageDiagnostic.MANUAL_LISTING_RUNTIME_AUTODISCOVERY],
                ].map(([label, value]) => (
                  <div className="rounded-lg bg-black/20 p-3" key={String(label)}>
                    <dt className="break-all font-bold text-white/50">{label}</dt>
                    <dd className="mt-1 break-all">{String(value)}</dd>
                  </div>
                ))}
              </dl>
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
              diagnosingRegistryCoverage ||
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
            diagnosingRegistryCoverage ||
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
