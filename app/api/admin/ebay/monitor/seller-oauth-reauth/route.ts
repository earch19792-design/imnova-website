export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { NextRequest, NextResponse } from "next/server"

import {
  diagnoseInstalledEbayInventoryConsumer,
  diagnoseRegistryCoverageRuntime,
  previewEbayRegistryRepairRuntime,
} from "@/lib/ebay/ebay-commercial-monitor-live-readonly"
import {
  completeEbayCommercialOrdersAuthorization,
  failPendingEbayCommercialOrdersAuthorization,
  hasPendingEbayCommercialOrdersAuthorization,
} from "@/lib/ebay/ebay-commercial-orders-oauth-authorization"
import {
  certifyInstalledEbaySellerOAuthRuntime,
  claimAndVerifyEbaySellerOAuthReauth,
  diagnoseEbaySellerOAuthReauthAuthorization,
  prepareEbaySellerOAuthReauthStart,
  verifyEbaySellerOAuthReauthCandidate,
} from "@/lib/ebay/ebay-seller-oauth-reauth"
import {
  assertEbaySellerOAuthReauthRuntimeCredentialMatchCertified,
  assertEbaySellerOAuthReauthAdmin,
  assertEbaySellerOAuthReauthSameOrigin,
  ebaySellerOAuthReauthCookieOptions,
  EBAY_SELLER_OAUTH_REAUTH_CALLBACK_PATH,
  EBAY_SELLER_OAUTH_REAUTH_COOKIE,
  EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
  EBAY_SELLER_OAUTH_REAUTH_INTERNAL_HARD_BUDGET_MS,
  EBAY_SELLER_OAUTH_REAUTH_RESPONSE_HEADERS,
  EBAY_SELLER_OAUTH_REAUTH_STATE_TTL_MS,
  EbaySellerOAuthReauthError,
  getEbaySellerOAuthReauthConfiguration,
  getEbaySellerOAuthReauthRuntimeCredentialMatch,
  parseEbaySellerOAuthReauthCallbackUrl,
  renderEbaySellerOAuthReauthFailureHtml,
  renderEbaySellerOAuthReauthSuccessHtml,
  safeEbaySellerOAuthReauthError,
  verifyEbaySellerOAuthReauthCookie,
} from "@/lib/ebay/ebay-seller-oauth-reauth-domain"
import {
  createSupabaseEbaySellerOAuthReauthStateLedger,
} from "@/lib/ebay/ebay-seller-oauth-reauth-ledger"
import {
  EbayRegistryRepairExecutorError,
  executeApprovedRegistryRepairV1,
} from "@/lib/ebay/ebay-registry-repair-executor"
import { getEbayProRuntimeBoundary } from "@/lib/ebay/environment-boundaries"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

const APPROVED_REGISTRY_REPAIR_PACKAGE_HANDLE =
  "rr_package_a907ead2fdbfcdff6a3d5b2e"
const APPROVED_REGISTRY_REPAIR_EVIDENCE_FINGERPRINT =
  "rr_evidence_11fe6081ddbfca09673f5e3d"
const EXECUTE_APPROVED_REGISTRY_REPAIR_ACTION =
  "execute_approved_registry_repair"

function callbackHtml(code: string, status: number) {
  const response = new NextResponse(
    renderEbaySellerOAuthReauthFailureHtml(code),
    {
      status,
      headers: {
        ...EBAY_SELLER_OAUTH_REAUTH_RESPONSE_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  )
  response.cookies.set(
    EBAY_SELLER_OAUTH_REAUTH_COOKIE,
    "",
    ebaySellerOAuthReauthCookieOptions(0),
  )
  return response
}

function successHtml(refreshToken: string) {
  const response = new NextResponse(
    renderEbaySellerOAuthReauthSuccessHtml(refreshToken),
    {
      status: 200,
      headers: {
        ...EBAY_SELLER_OAUTH_REAUTH_RESPONSE_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  )
  response.cookies.set(
    EBAY_SELLER_OAUTH_REAUTH_COOKIE,
    "",
    ebaySellerOAuthReauthCookieOptions(0),
  )
  return response
}

function commercialOrdersSuccessHtml() {
  const response = new NextResponse(
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
      "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
      "<title>eBay Commercial Orders authorization ready</title></head><body>" +
      "<main><h1>Authorization completed</h1>" +
      "<p>The canonical account and required scopes were verified.</p>" +
      "<p>The refresh credential was persisted only as an encrypted one-time handoff. " +
      "No token, cookie, authorization code, or environment value is displayed.</p>" +
      "</main></body></html>",
    {
      status: 200,
      headers: {
        ...EBAY_SELLER_OAUTH_REAUTH_RESPONSE_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  )
  response.cookies.set(
    EBAY_SELLER_OAUTH_REAUTH_COOKIE,
    "",
    ebaySellerOAuthReauthCookieOptions(0),
  )
  return response
}

function runtimeAllowed(request: NextRequest) {
  return !getEbayProRuntimeBoundary({
    pathname: request.nextUrl.pathname,
    method: request.method,
  }).blocked
}

export async function POST(request: NextRequest) {
  const requestStartedAt = Date.now()
  const fetchImpl = fetch
  let requestedAction: unknown = null
  try {
    if (!runtimeAllowed(request)) {
      return NextResponse.json(
        { success: false, error: "EBAY_SELLER_OAUTH_REAUTH_RUNTIME_DENIED" },
        { status: 403, headers: { "Cache-Control": "private, no-store" } },
      )
    }
    assertEbaySellerOAuthReauthSameOrigin(request)
    const validation = await validateAdminApiRequest(request)
    const actorUserId = assertEbaySellerOAuthReauthAdmin(validation)
    const configuration = getEbaySellerOAuthReauthConfiguration({
      requestHost: request.nextUrl.host,
    })
    let payload: unknown
    try {
      payload = await request.json()
    } catch {
      throw new EbaySellerOAuthReauthError(
        "EBAY_SELLER_OAUTH_REAUTH_ACTION_INVALID",
      )
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new EbaySellerOAuthReauthError(
        "EBAY_SELLER_OAUTH_REAUTH_ACTION_INVALID",
      )
    }
    const actionPayload = payload as {
      action?: unknown
      reviewedEvidenceFingerprint?: unknown
      approvedPackageHandle?: unknown
      approvedEvidenceFingerprint?: unknown
    }
    const action = actionPayload.action
    requestedAction = action
    const payloadKeys = Object.keys(payload).sort().join(",")
    const reviewedEvidenceFingerprint =
      actionPayload.reviewedEvidenceFingerprint
    const registryRepairPreviewAction = "preview_registry_repair"
    const registryRepairExecutionPayloadValid =
      action === EXECUTE_APPROVED_REGISTRY_REPAIR_ACTION &&
      payloadKeys ===
        "action,approvedEvidenceFingerprint,approvedPackageHandle" &&
      actionPayload.approvedPackageHandle ===
        APPROVED_REGISTRY_REPAIR_PACKAGE_HANDLE &&
      actionPayload.approvedEvidenceFingerprint ===
        APPROVED_REGISTRY_REPAIR_EVIDENCE_FINGERPRINT
    const payloadShapeValid = payloadKeys === "action" ||
      registryRepairExecutionPayloadValid || (
      action === registryRepairPreviewAction &&
      payloadKeys === "action,reviewedEvidenceFingerprint" &&
      typeof reviewedEvidenceFingerprint === "string" &&
      /^rr_evidence_[a-f0-9]{24}$/.test(reviewedEvidenceFingerprint)
    )
    if (!payloadShapeValid) {
      throw new EbaySellerOAuthReauthError(
        "EBAY_SELLER_OAUTH_REAUTH_ACTION_INVALID",
      )
    }
    if (action === "compare_runtime_credentials") {
      if ([
        "EBAY_SELLER_OAUTH_REAUTH_PREVIEW_REQUIRED",
        "EBAY_SELLER_OAUTH_REAUTH_BRANCH_DENIED",
        "EBAY_SELLER_OAUTH_REAUTH_HOST_DENIED",
      ].includes(configuration.reason ?? "")) {
        throw new EbaySellerOAuthReauthError(
          configuration.reason ?? "EBAY_SELLER_OAUTH_REAUTH_RUNTIME_DENIED",
        )
      }
      return NextResponse.json({
        success: true,
        credentialMatch:
          getEbaySellerOAuthReauthRuntimeCredentialMatch(configuration),
      }, {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          Pragma: "no-cache",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      })
    }
    if (!configuration.ready) {
      throw new EbaySellerOAuthReauthError(
        configuration.reason ?? "EBAY_SELLER_OAUTH_REAUTH_CONFIGURATION_INVALID",
      )
    }
    if (action !== "diagnose" && action !== "start" &&
        action !== "certify_installed_runtime" &&
        action !== "diagnose_inventory_consumer" &&
        action !== "diagnose_registry_coverage_runtime" &&
        action !== "preview_registry_repair" &&
        action !== EXECUTE_APPROVED_REGISTRY_REPAIR_ACTION) {
      throw new EbaySellerOAuthReauthError(
        "EBAY_SELLER_OAUTH_REAUTH_ACTION_INVALID",
      )
    }
    const runtimeCredentialMatch =
      getEbaySellerOAuthReauthRuntimeCredentialMatch(configuration)
    assertEbaySellerOAuthReauthRuntimeCredentialMatchCertified(
      runtimeCredentialMatch,
    )
    if (action === "diagnose_inventory_consumer") {
      const inventoryConsumer = await diagnoseInstalledEbayInventoryConsumer({
        startedAt: requestStartedAt,
      })
      return NextResponse.json({
        success: true,
        inventoryConsumer,
      }, {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          Pragma: "no-cache",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      })
    }
    if (action === "diagnose_registry_coverage_runtime") {
      const registryCoverage = await diagnoseRegistryCoverageRuntime({
        startedAt: requestStartedAt,
        fetchImpl,
      })
      return NextResponse.json({
        success: true,
        registryCoverageDiagnostic: registryCoverage,
      }, {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          Pragma: "no-cache",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      })
    }
    if (action === "preview_registry_repair") {
      const registryRepairDryRun = await previewEbayRegistryRepairRuntime({
        startedAt: requestStartedAt,
        fetchImpl,
      })
      if (registryRepairDryRun.DRY_RUN_REJECTION_REASON !== null) {
        return NextResponse.json({
          success: false,
          error: "REGISTRY_REPAIR_DRY_RUN_REJECTED",
          REJECTION_REASON: registryRepairDryRun.DRY_RUN_REJECTION_REASON,
          AMBIGUITY_CLASS: registryRepairDryRun.AMBIGUITY_CLASS,
          UNPROVEN_COMPONENT: registryRepairDryRun.UNPROVEN_COMPONENT,
          UNPROVEN_COUNT: registryRepairDryRun.UNPROVEN_COUNT,
          UNPROVEN_TOTAL_COUNT: registryRepairDryRun.UNPROVEN_TOTAL_COUNT,
          BLOCKING_UNPROVEN_PRIMARY_SOURCE:
            registryRepairDryRun.BLOCKING_UNPROVEN_PRIMARY_SOURCE,
          BLOCKING_UNPROVEN_SECONDARY_SOURCES:
            registryRepairDryRun.BLOCKING_UNPROVEN_SECONDARY_SOURCES,
          RAW_UNPROVEN_COUNT: registryRepairDryRun.RAW_UNPROVEN_COUNT,
          UNPROVEN_PRIMARY_REASON:
            registryRepairDryRun.UNPROVEN_PRIMARY_REASON,
          UNPROVEN_REASON_MISSING_AUTHORITATIVE_ITEM_ID:
            registryRepairDryRun.UNPROVEN_REASON_MISSING_AUTHORITATIVE_ITEM_ID,
          UNPROVEN_REASON_DUPLICATE_ITEM_ID:
            registryRepairDryRun.UNPROVEN_REASON_DUPLICATE_ITEM_ID,
          UNPROVEN_REASON_MULTIPLE_REGISTRY_CANDIDATES:
            registryRepairDryRun.UNPROVEN_REASON_MULTIPLE_REGISTRY_CANDIDATES,
          UNPROVEN_REASON_CROSS_LINK_CONFLICT:
            registryRepairDryRun.UNPROVEN_REASON_CROSS_LINK_CONFLICT,
          UNPROVEN_REASON_ACCOUNT_SCOPE:
            registryRepairDryRun.UNPROVEN_REASON_ACCOUNT_SCOPE,
          UNPROVEN_REASON_PARTITION_OVERLAP:
            registryRepairDryRun.UNPROVEN_REASON_PARTITION_OVERLAP,
          UNPROVEN_REASON_SOURCE_EVIDENCE:
            registryRepairDryRun.UNPROVEN_REASON_SOURCE_EVIDENCE,
          UNPROVEN_REASON_OTHER: registryRepairDryRun.UNPROVEN_REASON_OTHER,
          OTHER_SUBTYPE_COUNTS: registryRepairDryRun.OTHER_SUBTYPE_COUNTS,
          RAW_CREATE_IDENTITY_CANDIDATE_COUNT:
            registryRepairDryRun.RAW_CREATE_IDENTITY_CANDIDATE_COUNT,
          CREATE_IDENTITY_DETERMINISTIC_COUNT:
            registryRepairDryRun.CREATE_IDENTITY_DETERMINISTIC_COUNT,
          CREATE_IDENTITY_UNPROVEN_COUNT:
            registryRepairDryRun.CREATE_IDENTITY_UNPROVEN_COUNT,
          CREATE_MATERIALIZATION_PASS_COUNT:
            registryRepairDryRun.CREATE_MATERIALIZATION_PASS_COUNT,
          CREATE_MATERIALIZATION_UNPROVEN_COUNT:
            registryRepairDryRun.CREATE_MATERIALIZATION_UNPROVEN_COUNT,
          CREATE_ABSENCE_CAS_PASS_COUNT:
            registryRepairDryRun.CREATE_ABSENCE_CAS_PASS_COUNT,
          CREATE_ABSENCE_CAS_UNPROVEN_COUNT:
            registryRepairDryRun.CREATE_ABSENCE_CAS_UNPROVEN_COUNT,
          CREATE_MATERIALIZATION_STATUS:
            registryRepairDryRun.CREATE_MATERIALIZATION_STATUS,
          ABSENCE_PROOF_UNPROVEN_COUNT:
            registryRepairDryRun.ABSENCE_PROOF_UNPROVEN_COUNT,
          ABSENCE_PROOF_CAUSE_ITEM_ID_ALREADY_PRESENT:
            registryRepairDryRun.ABSENCE_PROOF_CAUSE_ITEM_ID_ALREADY_PRESENT,
          ABSENCE_PROOF_CAUSE_ITEM_ID_LOOKUP_UNPROVEN:
            registryRepairDryRun.ABSENCE_PROOF_CAUSE_ITEM_ID_LOOKUP_UNPROVEN,
          ABSENCE_PROOF_CAUSE_SKU_RELATION:
            registryRepairDryRun.ABSENCE_PROOF_CAUSE_SKU_RELATION,
          ABSENCE_PROOF_CAUSE_SYNC_KEY_COLLISION:
            registryRepairDryRun.ABSENCE_PROOF_CAUSE_SYNC_KEY_COLLISION,
          ABSENCE_PROOF_CAUSE_ACCOUNT_SCOPE:
            registryRepairDryRun.ABSENCE_PROOF_CAUSE_ACCOUNT_SCOPE,
          ABSENCE_PROOF_CAUSE_MULTIPLE_REGISTRY_ROWS:
            registryRepairDryRun.ABSENCE_PROOF_CAUSE_MULTIPLE_REGISTRY_ROWS,
          ABSENCE_PROOF_CAUSE_SECOND_READ_INCONSISTENCY:
            registryRepairDryRun.ABSENCE_PROOF_CAUSE_SECOND_READ_INCONSISTENCY,
          ABSENCE_PROOF_CAUSE_OTHER:
            registryRepairDryRun.ABSENCE_PROOF_CAUSE_OTHER,
          ABSENCE_PROOF_PRIMARY_CAUSE:
            registryRepairDryRun.ABSENCE_PROOF_PRIMARY_CAUSE,
          LIFECYCLE_UNPROVEN_ACTION:
            registryRepairDryRun.LIFECYCLE_UNPROVEN_ACTION,
          LIFECYCLE_UNPROVEN_STAGE:
            registryRepairDryRun.LIFECYCLE_UNPROVEN_STAGE,
          LIFECYCLE_REQUIRED_SIGNAL:
            registryRepairDryRun.LIFECYCLE_REQUIRED_SIGNAL,
          LIFECYCLE_SIGNAL_AVAILABLE:
            registryRepairDryRun.LIFECYCLE_SIGNAL_AVAILABLE,
          LIFECYCLE_FAILURE_CAUSE:
            registryRepairDryRun.LIFECYCLE_FAILURE_CAUSE,
          REPAIR_ROW_CURRENT_STATUS_CLASS:
            registryRepairDryRun.REPAIR_ROW_CURRENT_STATUS_CLASS,
          REPAIR_ROW_STATUS_RAW_VALUE_RECOGNIZED:
            registryRepairDryRun.REPAIR_ROW_STATUS_RAW_VALUE_RECOGNIZED,
          REPAIR_ROW_STATUS_REACTIVATABLE:
            registryRepairDryRun.REPAIR_ROW_STATUS_REACTIVATABLE,
          REPAIR_ROW_ACCOUNT_SCOPE_MATCH:
            registryRepairDryRun.REPAIR_ROW_ACCOUNT_SCOPE_MATCH,
          REPAIR_ROW_AUTHORITATIVE_ITEM_ID_STILL_LIVE:
            registryRepairDryRun.REPAIR_ROW_AUTHORITATIVE_ITEM_ID_STILL_LIVE,
          REPAIR_ROW_ITEM_ID_UNIQUE_BOTH_SIDES:
            registryRepairDryRun.REPAIR_ROW_ITEM_ID_UNIQUE_BOTH_SIDES,
          REPAIR_ROW_COMPETING_RELATIONSHIP:
            registryRepairDryRun.REPAIR_ROW_COMPETING_RELATIONSHIP,
          REGISTRY_LIFECYCLE_SUPPORTS_REACTIVATION:
            registryRepairDryRun.REGISTRY_LIFECYCLE_SUPPORTS_REACTIVATION,
          REACTIVATION_ALLOWED_FROM_STALE:
            registryRepairDryRun.REACTIVATION_ALLOWED_FROM_STALE,
          REACTIVATION_ALLOWED_FROM_ENDED:
            registryRepairDryRun.REACTIVATION_ALLOWED_FROM_ENDED,
          REACTIVATION_ALLOWED_FROM_HISTORICAL:
            registryRepairDryRun.REACTIVATION_ALLOWED_FROM_HISTORICAL,
          REACTIVATION_ALLOWED_FROM_UNKNOWN:
            registryRepairDryRun.REACTIVATION_ALLOWED_FROM_UNKNOWN,
          REACTIVATION_CAS_SUPPORTED:
            registryRepairDryRun.REACTIVATION_CAS_SUPPORTED,
          FINAL_IDENTITY_UNPROVEN_COUNT:
            registryRepairDryRun.FINAL_IDENTITY_UNPROVEN_COUNT,
          FINAL_PRECONDITION_UNPROVEN_COUNT:
            registryRepairDryRun.FINAL_PRECONDITION_UNPROVEN_COUNT,
          FINAL_REJECTION_REASON: registryRepairDryRun.FINAL_REJECTION_REASON,
          REPAIR_EXISTING_AUTOMATIC_COUNT:
            registryRepairDryRun.REPAIR_EXISTING_AUTOMATIC_COUNT,
          HUMAN_REVIEW_REASON_REACTIVATION_NOT_ALLOWED_COUNT:
            registryRepairDryRun.HUMAN_REVIEW_REASON_REACTIVATION_NOT_ALLOWED_COUNT,
          IDENTITY_UNPROVEN_COUNT:
            registryRepairDryRun.IDENTITY_UNPROVEN_COUNT,
          AUTOMATIC_PRECONDITION_UNPROVEN_COUNT:
            registryRepairDryRun.AUTOMATIC_PRECONDITION_UNPROVEN_COUNT,
          AUTOMATIC_TRANCHE_PRECONDITIONS_PASS:
            registryRepairDryRun.AUTOMATIC_TRANCHE_PRECONDITIONS_PASS,
          HUMAN_REVIEW_WRITE_ALLOWED:
            registryRepairDryRun.HUMAN_REVIEW_WRITE_ALLOWED,
          HUMAN_REVIEW_MUTATION_COUNT:
            registryRepairDryRun.HUMAN_REVIEW_MUTATION_COUNT,
        }, {
          status: 409,
          headers: { "Cache-Control": "private, no-store, max-age=0" },
        })
      }
      return NextResponse.json({
        success: true,
        registryRepairDryRun,
      }, {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          Pragma: "no-cache",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      })
    }
    if (action === EXECUTE_APPROVED_REGISTRY_REPAIR_ACTION) {
      const registryRepairExecutionResult =
        await executeApprovedRegistryRepairV1({
          approvedPackageHandle: APPROVED_REGISTRY_REPAIR_PACKAGE_HANDLE,
          approvedEvidenceFingerprint:
            APPROVED_REGISTRY_REPAIR_EVIDENCE_FINGERPRINT,
          approvedCreateCount: 24,
          approvedStaleCount: 4,
          approvedHumanReviewCount: 3,
        })
      return NextResponse.json({
        success: true,
        registryRepairExecutionResult,
      }, {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          Pragma: "no-cache",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      })
    }
    if (action === "certify_installed_runtime") {
      const certification = await certifyInstalledEbaySellerOAuthRuntime({
        configuration,
        startedAt: requestStartedAt,
      })
      return NextResponse.json({
        success: true,
        certification,
      }, {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          Pragma: "no-cache",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      })
    }
    if (action === "diagnose") {
      const diagnosis = await diagnoseEbaySellerOAuthReauthAuthorization({
        configuration,
      })
      return NextResponse.json({
        success: true,
        diagnosis,
      }, {
        status: 200,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      })
    }
    const ledger = createSupabaseEbaySellerOAuthReauthStateLedger(
      getSupabaseAdminClient(),
    )
    const prepared = await prepareEbaySellerOAuthReauthStart({
      configuration,
      actorUserId,
      ledger,
    })
    const response = NextResponse.json({
      success: true,
      authorizationUrl: prepared.authorizationUrl,
      callbackPath: EBAY_SELLER_OAUTH_REAUTH_CALLBACK_PATH,
      scopeCount: 4,
      expiresAt: new Date(prepared.expiresAt).toISOString(),
      stateHashPersisted: true,
      rawStatePersisted: false,
      tokenGenerated: false,
      authorizationPreflight: prepared.authorizationPreflight,
    }, {
      status: 200,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
    response.cookies.set(
      EBAY_SELLER_OAUTH_REAUTH_COOKIE,
      prepared.cookie,
      ebaySellerOAuthReauthCookieOptions(
        Math.floor(EBAY_SELLER_OAUTH_REAUTH_STATE_TTL_MS / 1_000),
      ),
    )
    return response
  } catch (cause) {
    if (requestedAction === EXECUTE_APPROVED_REGISTRY_REPAIR_ACTION &&
        cause instanceof EbayRegistryRepairExecutorError) {
      return NextResponse.json({
        success: false,
        error: "REGISTRY_REPAIR_EXECUTION_REJECTED",
        EXECUTOR_FAILURE_CODE: cause.code,
        RPC_INVOCATION_COUNT: cause.rpcInvocationCount,
        PREWRITE_ASSESSMENT: cause.prewriteAssessment,
      }, {
        status: 409,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      })
    }
    if (requestedAction === "preview_registry_repair") {
      return NextResponse.json({
        success: false,
        error: "REGISTRY_REPAIR_DRY_RUN_REJECTED",
        REJECTION_REASON: "UNPROVEN",
        AMBIGUITY_CLASS: "BLOCKING_UNPROVEN",
        UNPROVEN_COMPONENT: "EVIDENCE_UNAVAILABLE",
        UNPROVEN_COUNT: "UNPROVEN",
        UNPROVEN_TOTAL_COUNT: "UNPROVEN",
        BLOCKING_UNPROVEN_PRIMARY_SOURCE: "SOURCE_READ",
        BLOCKING_UNPROVEN_SECONDARY_SOURCES: [],
        RAW_UNPROVEN_COUNT: "UNPROVEN",
        UNPROVEN_PRIMARY_REASON: "SOURCE_EVIDENCE",
        UNPROVEN_REASON_MISSING_AUTHORITATIVE_ITEM_ID: "UNPROVEN",
        UNPROVEN_REASON_DUPLICATE_ITEM_ID: "UNPROVEN",
        UNPROVEN_REASON_MULTIPLE_REGISTRY_CANDIDATES: "UNPROVEN",
        UNPROVEN_REASON_CROSS_LINK_CONFLICT: "UNPROVEN",
        UNPROVEN_REASON_ACCOUNT_SCOPE: "UNPROVEN",
        UNPROVEN_REASON_PARTITION_OVERLAP: "UNPROVEN",
        UNPROVEN_REASON_SOURCE_EVIDENCE: "UNPROVEN",
        UNPROVEN_REASON_OTHER: "UNPROVEN",
        OTHER_SUBTYPE_COUNTS: {
          LISTING_IDENTITY_SHAPE: "UNPROVEN",
          CREATE_PAYLOAD_REQUIREMENT: "UNPROVEN",
          REGISTRY_ABSENCE_PROOF: "UNPROVEN",
          LIFECYCLE_REQUIREMENT: "UNPROVEN",
          NORMALIZATION_FAILURE: "UNPROVEN",
          UNEXPECTED_CLASSIFIER_BRANCH: "UNPROVEN",
        },
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
        FINAL_IDENTITY_UNPROVEN_COUNT: "UNPROVEN",
        FINAL_PRECONDITION_UNPROVEN_COUNT: "UNPROVEN",
        FINAL_REJECTION_REASON: "UNPROVEN",
        REPAIR_EXISTING_AUTOMATIC_COUNT: "UNPROVEN",
        HUMAN_REVIEW_REASON_REACTIVATION_NOT_ALLOWED_COUNT: "UNPROVEN",
        IDENTITY_UNPROVEN_COUNT: "UNPROVEN",
        AUTOMATIC_PRECONDITION_UNPROVEN_COUNT: "UNPROVEN",
        AUTOMATIC_TRANCHE_PRECONDITIONS_PASS: "UNPROVEN",
        HUMAN_REVIEW_WRITE_ALLOWED: "UNPROVEN",
        HUMAN_REVIEW_MUTATION_COUNT: "UNPROVEN",
      }, {
        status: 403,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      })
    }
    return NextResponse.json({
      success: false,
      error: safeEbaySellerOAuthReauthError(cause),
    }, {
      status: 403,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  }
}

export async function GET(request: NextRequest) {
  const callbackStartedAt = Date.now()
  let candidateRefreshToken = ""
  try {
    if (!runtimeAllowed(request)) {
      return callbackHtml("EBAY_SELLER_OAUTH_REAUTH_RUNTIME_DENIED", 403)
    }
    const configuration = getEbaySellerOAuthReauthConfiguration({
      requestHost: request.nextUrl.host,
    })
    if (!configuration.ready) {
      return callbackHtml(
        configuration.reason ?? "EBAY_SELLER_OAUTH_REAUTH_CONFIGURATION_INVALID",
        403,
      )
    }
    assertEbaySellerOAuthReauthRuntimeCredentialMatchCertified(
      getEbaySellerOAuthReauthRuntimeCredentialMatch(configuration),
    )
    const callback = parseEbaySellerOAuthReauthCallbackUrl(request.url)
    const cookies = request.cookies.getAll(EBAY_SELLER_OAUTH_REAUTH_COOKIE)
    if (cookies.length !== 1) {
      return callbackHtml(
        "EBAY_SELLER_OAUTH_REAUTH_STATE_COOKIE_INVALID",
        400,
      )
    }
    const transaction = verifyEbaySellerOAuthReauthCookie({
      cookie: cookies[0]?.value ?? "",
      state: callback.state,
      now: callbackStartedAt,
      branchHost: configuration.branchHost,
      clientSecret: configuration.clientSecret,
      expectedAccountFingerprint: configuration.expectedAccountFingerprint,
    })
    const supabase = getSupabaseAdminClient()
    const ledger = createSupabaseEbaySellerOAuthReauthStateLedger(supabase)
    const commercialOrdersCeremony =
      await hasPendingEbayCommercialOrdersAuthorization(
        supabase,
        callback.state,
      )
    if (commercialOrdersCeremony) {
      const claimed = await ledger.claimPending({
        stateHash: transaction.stateHash,
        flowVersion: EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
      })
      if (!claimed) {
        await failPendingEbayCommercialOrdersAuthorization(
          supabase,
          callback.state,
          "EBAY_COMMERCIAL_ORDERS_BROWSER_START_STATE_NOT_CLAIMED",
        )
        return callbackHtml(
          "EBAY_COMMERCIAL_ORDERS_BROWSER_START_STATE_NOT_CLAIMED",
          409,
        )
      }
      if (callback.kind === "DENIED") {
        await failPendingEbayCommercialOrdersAuthorization(
          supabase,
          callback.state,
          "EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_CONSENT_DENIED",
        )
        return callbackHtml(
          "EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_CONSENT_DENIED",
          400,
        )
      }
      await completeEbayCommercialOrdersAuthorization(supabase, {
        state: callback.state,
        code: callback.code,
      })
      return commercialOrdersSuccessHtml()
    }
    const result = await claimAndVerifyEbaySellerOAuthReauth({
      callback,
      stateHash: transaction.stateHash,
      ledger,
      verifyCandidate: callback.kind === "CODE"
        ? (authorizationCode) => verifyEbaySellerOAuthReauthCandidate({
          authorizationCode,
          configuration,
          callbackStartedAt,
        })
        : undefined,
    })
    if (result.kind !== "HANDOFF") {
      return callbackHtml(result.code, result.claimSucceeded ? 400 : 409)
    }
    if (Date.now() - callbackStartedAt >=
        EBAY_SELLER_OAUTH_REAUTH_INTERNAL_HARD_BUDGET_MS) {
      return callbackHtml(
        "EBAY_SELLER_OAUTH_REAUTH_TIME_BUDGET_EXHAUSTED",
        504,
      )
    }
    candidateRefreshToken = result.verification.refreshToken
    const response = successHtml(candidateRefreshToken)
    candidateRefreshToken = ""
    return response
  } catch (cause) {
    return callbackHtml(safeEbaySellerOAuthReauthError(cause), 400)
  } finally {
    candidateRefreshToken = ""
  }
}
