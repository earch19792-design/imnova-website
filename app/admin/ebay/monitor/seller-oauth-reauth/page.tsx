"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"

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
  execution: {
    globalCallsBeforeInventory: number | null
    globalTimeRemainingBeforeInventoryMs: number | null
    inventoryRefreshExecuted: boolean
    inventoryGetUserExecuted: boolean
    inventoryGetItemsExecuted: boolean
    inventoryFailureFromBudget: boolean
    externalCalls: number
    maximumExternalCalls: 3
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

type InventoryConsumerDiagnosticPayload = {
  success?: boolean
  inventoryConsumer?: unknown
  error?: string
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
  "safety",
] as const
const INVENTORY_CONSUMER_EXECUTION_KEYS = [
  "externalCalls",
  "globalCallsBeforeInventory",
  "globalTimeRemainingBeforeInventoryMs",
  "inventoryFailureFromBudget",
  "inventoryGetItemsExecuted",
  "inventoryGetUserExecuted",
  "inventoryRefreshExecuted",
  "maximumExternalCalls",
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

  if (!record.execution || typeof record.execution !== "object" ||
      Array.isArray(record.execution)) return false
  const execution = record.execution as Record<string, unknown>
  if (Object.keys(execution).sort().join(",") !==
      [...INVENTORY_CONSUMER_EXECUTION_KEYS].sort().join(",") ||
      execution.maximumExternalCalls !== 3 ||
      !nullableInteger(execution.externalCalls) ||
      Number(execution.externalCalls) > 3 ||
      !nullableInteger(execution.globalCallsBeforeInventory) ||
      !nullableInteger(execution.globalTimeRemainingBeforeInventoryMs) ||
      ["inventoryFailureFromBudget", "inventoryGetItemsExecuted",
        "inventoryGetUserExecuted", "inventoryRefreshExecuted"].some(
        (key) => typeof execution[key] !== "boolean",
      )) return false

  if (!Array.isArray(record.calls) || record.calls.length > 3 ||
      record.calls.length !== execution.externalCalls) return false
  const operations = new Set([
    "OAUTH_REFRESH_INVENTORY",
    "TRADING_GET_USER",
    "INVENTORY_GET_ITEMS",
  ])
  if (!record.calls.every((candidate) => {
    if (!candidate || typeof candidate !== "object" ||
        Array.isArray(candidate)) return false
    const call = candidate as Record<string, unknown>
    return Object.keys(call).sort().join(",") === [
      "endpoint", "httpStatus", "marketplaceMutation", "method",
      "observedAt", "operation", "persisted", "status",
    ].sort().join(",") && operations.has(String(call.operation)) &&
      (call.method === "GET" || call.method === "POST") &&
      typeof call.endpoint === "string" &&
      String(call.endpoint).startsWith("/") &&
      (call.status === "SUCCEEDED" || call.status === "FAILED") &&
      nullableInteger(call.httpStatus) &&
      typeof call.observedAt === "string" &&
      Number.isFinite(Date.parse(call.observedAt)) &&
      call.marketplaceMutation === false && call.persisted === false
  })) return false

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
              certifyingInstalledRuntime || diagnosingInventoryConsumer}
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
              diagnosing || diagnosingInventoryConsumer || loading ||
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
            verifica GetUser y ejecuta exactamente inventory_item?limit=50&amp;offset=0. No
            llama offers, no devuelve SKUs, payloads, headers ni tokens y no crea ledger/cookie.
          </p>
          <button
            className="mt-4 rounded-2xl border border-fuchsia-300/50 px-5 py-2 text-sm font-black text-fuchsia-200 disabled:opacity-40"
            type="button"
            disabled={diagnosingInventoryConsumer || certifyingInstalledRuntime ||
              matchingCredentials || diagnosing || loading ||
              !runtimeCredentialMatchAllowsStart(credentialMatch)}
            onClick={diagnoseInventoryConsumer}
          >
            {diagnosingInventoryConsumer
              ? "Inspeccionando forma…"
              : "Diagnosticar consumer Inventory exacto"}
          </button>
          {inventoryConsumerDiagnostic ? (
            <dl className="mt-5 grid gap-2 text-xs text-white/75 sm:grid-cols-2">
              {[
                ["HTTP status", inventoryConsumerDiagnostic.inventoryItemsHttpStatus ?? "NONE"],
                ["Authorized", inventoryConsumerDiagnostic.inventoryItemsAuthorized ? "YES" : "NO"],
                ["Content type", inventoryConsumerDiagnostic.inventoryItemsContentType ?? "NONE"],
                ["Top-level keys", inventoryConsumerDiagnostic.inventoryItemsTopLevelKeys.join(", ") || "NONE"],
                ["Has array", inventoryConsumerDiagnostic.inventoryItemsHasArray ? "YES" : "NO"],
                ["Array count", inventoryConsumerDiagnostic.inventoryItemsArrayCount ?? "NONE"],
                ["Total present", inventoryConsumerDiagnostic.inventoryItemsTotalPresent ? "YES" : "NO"],
                ["Total", inventoryConsumerDiagnostic.inventoryItemsTotal ?? "NONE"],
                ["Next present", inventoryConsumerDiagnostic.inventoryItemsNextPresent ? "YES" : "NO"],
                ["Response shape", inventoryConsumerDiagnostic.inventoryItemsResponseShape],
                ["Catalog state", inventoryConsumerDiagnostic.inventoryCatalogState],
                ["Safe error", inventoryConsumerDiagnostic.inventoryItemsSafeErrorCategory],
                ["Calls before Inventory", inventoryConsumerDiagnostic.execution.globalCallsBeforeInventory ?? "NONE"],
                ["Time remaining before Inventory (ms)", inventoryConsumerDiagnostic.execution.globalTimeRemainingBeforeInventoryMs ?? "NONE"],
                ["Refresh / GetUser / Items", `${inventoryConsumerDiagnostic.execution.inventoryRefreshExecuted} / ${inventoryConsumerDiagnostic.execution.inventoryGetUserExecuted} / ${inventoryConsumerDiagnostic.execution.inventoryGetItemsExecuted}`],
                ["Failure from budget", inventoryConsumerDiagnostic.execution.inventoryFailureFromBudget ? "YES" : "NO"],
                ["External calls", inventoryConsumerDiagnostic.execution.externalCalls],
                ["Token / payload returned", "false / false"],
              ].map(([label, value]) => (
                <div className="rounded-lg bg-black/20 p-3" key={String(label)}>
                  <dt className="font-bold text-white/50">{label}</dt>
                  <dd className="mt-1 break-all">{String(value)}</dd>
                </div>
              ))}
            </dl>
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
