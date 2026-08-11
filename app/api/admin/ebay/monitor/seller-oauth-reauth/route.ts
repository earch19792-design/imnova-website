export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

import { NextRequest, NextResponse } from "next/server"

import {
  diagnoseInstalledEbayInventoryConsumer,
  diagnoseRegistryCoverageRuntime,
  previewEbayRegistryRepairRuntime,
} from "@/lib/ebay/ebay-commercial-monitor-live-readonly"
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
import { getEbayProRuntimeBoundary } from "@/lib/ebay/environment-boundaries"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

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

function runtimeAllowed(request: NextRequest) {
  return !getEbayProRuntimeBoundary({
    pathname: request.nextUrl.pathname,
    method: request.method,
  }).blocked
}

export async function POST(request: NextRequest) {
  const requestStartedAt = Date.now()
  const fetchImpl = fetch
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
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        Object.keys(payload).sort().join(",") !== "action") {
      throw new EbaySellerOAuthReauthError(
        "EBAY_SELLER_OAUTH_REAUTH_ACTION_INVALID",
      )
    }
    const action = (payload as { action?: unknown }).action
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
        action !== "preview_registry_repair") {
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
    const ledger = createSupabaseEbaySellerOAuthReauthStateLedger(
      getSupabaseAdminClient(),
    )
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
