export const EBAY_PUBLICATION_OAUTH_START_DIAGNOSTIC_EVENT =
  "EBAY_PRODUCTION_OAUTH_OWNER_PHYSICAL_START_DIAGNOSTIC_V2" as const

export type EbayPublicationOAuthStartGuard =
  | "ADMIN_AUTH"
  | "HOST"
  | "ENVIRONMENT"
  | "FEATURE_BOUNDARY"
  | "CLIENT_CONFIG"
  | "RUNAME"
  | "CALLBACK"
  | "STATE_SECRET"
  | "COOKIE"
  | "OWNER_AUTHORITY"
  | "PERSISTENCE"
  | "UNKNOWN"

export type EbayPublicationOAuthStartFailureStage =
  | "ADMIN_AUTH"
  | "HOST_BOUNDARY"
  | "ENVIRONMENT_BOUNDARY"
  | "FEATURE_ENABLEMENT"
  | "EBAY_CLIENT_CONFIG"
  | "RUNAME_CONFIG"
  | "CALLBACK_CONFIG"
  | "STATE_SECRET"
  | "STATE_GENERATION"
  | "COOKIE_ISSUANCE"
  | "REDIRECT_BUILD"
  | "UNKNOWN_INTERNAL"

const SAFE_CODE = /^[A-Z0-9_]{3,180}$/

function safeTextField(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ""
  const field = (value as Record<string, unknown>)[key]
  return typeof field === "string" ? field : ""
}

export function safeEbayPublicationOAuthHandoffPersistenceCode(
  cause: unknown,
) {
  const databaseCode = safeTextField(cause, "code")
  const descriptor = [
    safeTextField(cause, "message"),
    safeTextField(cause, "details"),
    safeTextField(cause, "hint"),
  ].join(" ")
  if (databaseCode === "23505" &&
      descriptor.includes("ebay_publication_oauth_one_active_uidx")) {
    return "EBAY_PUBLICATION_OAUTH_ACTIVE_HANDOFF_EXISTS"
  }
  if (databaseCode === "23505") {
    return "EBAY_PUBLICATION_OAUTH_STATE_COLLISION"
  }
  if (databaseCode === "23514") {
    return "EBAY_PUBLICATION_OAUTH_HANDOFF_CONTRACT_REJECTED"
  }
  if (databaseCode === "42501") {
    return "EBAY_PUBLICATION_OAUTH_HANDOFF_PERMISSION_DENIED"
  }
  if (databaseCode.startsWith("PGRST")) {
    return "EBAY_PUBLICATION_OAUTH_HANDOFF_DATA_API_UNAVAILABLE"
  }
  return "EBAY_PUBLICATION_OAUTH_HANDOFF_PERSISTENCE_FAILED"
}

export function safeEbayPublicationOAuthStartCode(cause: unknown) {
  const code = cause instanceof Error ? cause.message : ""
  return SAFE_CODE.test(code)
    ? code
    : "EBAY_PUBLICATION_OAUTH_BROWSER_START_FAILED"
}

export function ebayPublicationOAuthStartFailedGuard(
  failureCode: string | null,
): EbayPublicationOAuthStartGuard | null {
  if (!failureCode) return null
  if (/ADMIN|UNAUTHORIZED|FORBIDDEN/.test(failureCode)) return "ADMIN_AUTH"
  if (/SAME_ORIGIN|HOST_DENIED|HOST_MISMATCH/.test(failureCode)) return "HOST"
  if (/ENVIRONMENT|PREVIEW_REQUIRED|BRANCH/.test(failureCode)) {
    return "ENVIRONMENT"
  }
  if (/WRITE_GATES|FEATURE|BOUNDARY/.test(failureCode)) {
    return "FEATURE_BOUNDARY"
  }
  if (/RUNAME/.test(failureCode)) return "RUNAME"
  if (/CALLBACK/.test(failureCode)) return "CALLBACK"
  if (/COOKIE/.test(failureCode)) return "COOKIE"
  if (/PUBLIC_KEY|CLIENT|APP_CONFIGURATION|CREDENTIAL_MISMATCH/.test(
    failureCode,
  )) return "CLIENT_CONFIG"
  if (/ACCOUNT_BINDING|IDENTITY_UNBOUND|OWNER_AUTHORITY/.test(failureCode)) {
    return "OWNER_AUTHORITY"
  }
  if (/STATE_COLLISION|STATE_SECRET/.test(failureCode)) return "STATE_SECRET"
  if (/HANDOFF|LEDGER|SUPABASE|PERSIST/.test(failureCode)) {
    return "PERSISTENCE"
  }
  return "UNKNOWN"
}

export function ebayPublicationOAuthStartFailureStage(
  failedGuard: EbayPublicationOAuthStartGuard | null,
  failureCode: string | null,
): EbayPublicationOAuthStartFailureStage | null {
  if (!failureCode) return null
  if (failedGuard === "ADMIN_AUTH") return "ADMIN_AUTH"
  if (failedGuard === "HOST") return "HOST_BOUNDARY"
  if (failedGuard === "ENVIRONMENT") return "ENVIRONMENT_BOUNDARY"
  if (failedGuard === "FEATURE_BOUNDARY") return "FEATURE_ENABLEMENT"
  if (failedGuard === "CLIENT_CONFIG") return "EBAY_CLIENT_CONFIG"
  if (failedGuard === "RUNAME") return "RUNAME_CONFIG"
  if (failedGuard === "CALLBACK") return "CALLBACK_CONFIG"
  if (failedGuard === "STATE_SECRET") return "STATE_SECRET"
  if (failedGuard === "COOKIE") return "COOKIE_ISSUANCE"
  if (failedGuard === "PERSISTENCE" || /STATE_/.test(failureCode)) {
    return "STATE_GENERATION"
  }
  if (/REDIRECT/.test(failureCode)) return "REDIRECT_BUILD"
  return "UNKNOWN_INTERNAL"
}

export function ebayPublicationOAuthHostClass(
  requestHost: string,
  expectedHost: string,
) {
  const actual = requestHost.trim().toLowerCase()
  const expected = expectedHost.trim().toLowerCase()
  if (actual && expected && actual === expected) {
    return "SELLER_OS_DEDICATED_PREPROD" as const
  }
  if (actual.endsWith(".vercel.app")) return "OTHER_VERCEL_HOST" as const
  return "OTHER_HOST" as const
}

export type EbayPublicationOAuthStartSafeDiagnostic = Readonly<{
  REQUEST_REACHED_NODE_HANDLER: true
  START_HTTP_STATUS: number
  EXACT_FAILURE_CODE: string | null
  INTERNAL_SAFE_FAILURE_CODE: string | null
  FAILED_GUARD_NAME: EbayPublicationOAuthStartGuard | null
  FAILURE_STAGE: EbayPublicationOAuthStartFailureStage | null
  ADMIN_SESSION_PRESENT: boolean
  ADMIN_SESSION_VALID: boolean
  OWNER_AUTHORITY_MATCH: boolean
  REQUEST_HOST_CLASS:
    | "SELLER_OS_DEDICATED_PREPROD"
    | "OTHER_VERCEL_HOST"
    | "OTHER_HOST"
  EXPECTED_HOST_CLASS: "SELLER_OS_DEDICATED_PREPROD"
  HOST_MATCH: boolean
  DEPLOYMENT_ENVIRONMENT: string
  EXPECTED_DEPLOYMENT_ENVIRONMENT: "SELLER_OS_DEDICATED_PREPROD"
  ENVIRONMENT_MATCH: boolean
  PUBLISH_TARGET: "EBAY_US_PRODUCTION"
  PRODUCTION_OAUTH_ENABLED: boolean
  EBAY_PRODUCTION_CLIENT_CONFIG_PRESENT: boolean
  RUNAME_CONFIG_PRESENT: boolean
  CALLBACK_CONFIG_PRESENT: boolean
  STATE_SECRET_PRESENT: boolean
  COOKIE_CAN_BE_ISSUED: boolean
  STATE_CREATED: boolean
  STATE_COOKIE_SET: boolean
  SET_COOKIE_HEADER_PRESENT: boolean
  REDIRECT_HOST: "auth.ebay.com" | null
  ADMIN_AUTH_PASS: boolean
  HOST_PASS: boolean
  ENVIRONMENT_PASS: boolean
  CONFIG_PASS: boolean
  STATE_SECRET_PASS: boolean
  COOKIE_SERIALIZED: boolean
  REDIRECT_BUILT: boolean
}>

export function createEbayPublicationOAuthStartSafeDiagnostic(input: Omit<
  EbayPublicationOAuthStartSafeDiagnostic,
  "REQUEST_REACHED_NODE_HANDLER" | "EXPECTED_HOST_CLASS" |
  "EXPECTED_DEPLOYMENT_ENVIRONMENT" | "PUBLISH_TARGET" |
  "INTERNAL_SAFE_FAILURE_CODE" | "FAILURE_STAGE"
>): EbayPublicationOAuthStartSafeDiagnostic {
  const failureStage = ebayPublicationOAuthStartFailureStage(
    input.FAILED_GUARD_NAME,
    input.EXACT_FAILURE_CODE,
  )
  return {
    REQUEST_REACHED_NODE_HANDLER: true,
    EXPECTED_HOST_CLASS: "SELLER_OS_DEDICATED_PREPROD",
    EXPECTED_DEPLOYMENT_ENVIRONMENT: "SELLER_OS_DEDICATED_PREPROD",
    PUBLISH_TARGET: "EBAY_US_PRODUCTION",
    ...input,
    INTERNAL_SAFE_FAILURE_CODE: input.EXACT_FAILURE_CODE,
    FAILURE_STAGE: failureStage,
  }
}
