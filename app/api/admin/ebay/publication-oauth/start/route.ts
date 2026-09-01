export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"

import {
  getEbayPublicationOAuthConfiguration,
  startEbayPublicationOAuthBrowserCeremony,
} from "@/lib/ebay/ebay-publication-oauth-authorization"
import {
  createEbayPublicationOAuthStartSafeDiagnostic,
  EBAY_PUBLICATION_OAUTH_START_DIAGNOSTIC_EVENT,
  ebayPublicationOAuthHostClass,
  ebayPublicationOAuthStartFailedGuard,
  safeEbayPublicationOAuthStartCode,
} from "@/lib/ebay/ebay-publication-oauth-start-diagnostic"
import {
  assertEbaySellerOAuthReauthAdmin,
  assertEbaySellerOAuthReauthSameOrigin,
  ebaySellerOAuthReauthCookieOptions,
  EBAY_MARKETING_READONLY_OAUTH_COOKIE,
  EBAY_PUBLICATION_PRODUCTION_OAUTH_COOKIE,
  EBAY_SELLER_OAUTH_REAUTH_COOKIE,
  EBAY_SELLER_OAUTH_REAUTH_STATE_TTL_MS,
  getEbaySellerOAuthReauthConfiguration,
  getEbaySellerOAuthReauthRuntimeCredentialMatch,
  isEbaySellerOAuthReauthRuntimeCredentialMatchCertified,
} from "@/lib/ebay/ebay-seller-oauth-reauth-domain"
import { validateEbayPublicationOAuthPublicKey } from
  "@/lib/ebay/ebay-publication-oauth-domain"
import {
  createSupabaseEbaySellerOAuthReauthStateLedger,
} from "@/lib/ebay/ebay-seller-oauth-reauth-ledger"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

const responseHeaders = {
  "Cache-Control": "private, no-store, no-cache, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const

const EXPECTED_HOST = "imnova-seller-os-preprod.vercel.app"

function callbackConfigured(callbackUrl: string) {
  try {
    const parsed = new URL(callbackUrl)
    return parsed.protocol === "https:" &&
      parsed.host === EXPECTED_HOST &&
      parsed.pathname === "/api/admin/ebay/monitor/seller-oauth-reauth"
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  const requestHost = request.nextUrl.host.trim().toLowerCase()
  const authorization = request.headers.get("authorization")?.trim() ?? ""
  let hostMatch = false
  let callbackConfigPresent = false
  let deploymentEnvironment = "UNPROVEN"
  let environmentMatch = false
  let productionOauthEnabled = false
  let writeGatesAllOff = false
  let clientConfigPresent = false
  let runameConfigPresent = false
  let stateSecretPresent = false
  let operatorPublicKeyPresent = false
  let credentialMatchCertified = false
  let accountScopeReady = false
  let identityBound = false
  let adminSessionValid = false
  let ownerAuthorityMatch = false
  let stateCreated = false
  let stateCookieSet = false
  let responseStatus = 403
  let redirectHost: "auth.ebay.com" | null = null

  const emitDiagnostic = (failureCode: string | null) => {
    let failedGuardName = ebayPublicationOAuthStartFailedGuard(failureCode)
    if (failedGuardName === "UNKNOWN" && failureCode ===
        "EBAY_PUBLICATION_OAUTH_NOT_CONFIGURED") {
      failedGuardName = !environmentMatch
        ? "ENVIRONMENT"
        : !writeGatesAllOff
          ? "FEATURE_BOUNDARY"
          : !clientConfigPresent
            ? "CLIENT_CONFIG"
            : !runameConfigPresent
              ? "RUNAME"
              : !accountScopeReady || !identityBound
                ? "OWNER_AUTHORITY"
                : !callbackConfigPresent
                  ? "CALLBACK"
                  : !stateSecretPresent
                    ? "STATE_SECRET"
                    : "UNKNOWN"
    }
    if (failureCode === "EBAY_PUBLICATION_OAUTH_BROWSER_BINDING_MISMATCH") {
      failedGuardName = hostMatch ? "CALLBACK" : "HOST"
    }
    const diagnostic = createEbayPublicationOAuthStartSafeDiagnostic({
      START_HTTP_STATUS: responseStatus,
      EXACT_FAILURE_CODE: failureCode,
      FAILED_GUARD_NAME: failedGuardName,
      ADMIN_SESSION_PRESENT: /^Bearer\s+\S+$/i.test(authorization),
      ADMIN_SESSION_VALID: adminSessionValid,
      OWNER_AUTHORITY_MATCH: ownerAuthorityMatch,
      REQUEST_HOST_CLASS: ebayPublicationOAuthHostClass(
        requestHost,
        EXPECTED_HOST,
      ),
      HOST_MATCH: hostMatch,
      DEPLOYMENT_ENVIRONMENT: deploymentEnvironment,
      ENVIRONMENT_MATCH: environmentMatch,
      PRODUCTION_OAUTH_ENABLED: productionOauthEnabled,
      EBAY_PRODUCTION_CLIENT_CONFIG_PRESENT: clientConfigPresent,
      RUNAME_CONFIG_PRESENT: runameConfigPresent,
      CALLBACK_CONFIG_PRESENT: callbackConfigPresent,
      STATE_SECRET_PRESENT: stateSecretPresent,
      COOKIE_CAN_BE_ISSUED: adminSessionValid && ownerAuthorityMatch &&
        hostMatch && environmentMatch &&
        productionOauthEnabled && clientConfigPresent &&
        runameConfigPresent && callbackConfigPresent && stateSecretPresent &&
        operatorPublicKeyPresent && credentialMatchCertified,
      STATE_CREATED: stateCreated,
      STATE_COOKIE_SET: stateCookieSet,
      SET_COOKIE_HEADER_PRESENT: stateCookieSet,
      REDIRECT_HOST: redirectHost,
    })
    console.info(EBAY_PUBLICATION_OAUTH_START_DIAGNOSTIC_EVENT,
      JSON.stringify(diagnostic))
  }

  try {
    const publicationConfiguration = getEbayPublicationOAuthConfiguration()
    const sellerConfiguration = getEbaySellerOAuthReauthConfiguration({
      requestHost,
    })
    const credentialMatch =
      getEbaySellerOAuthReauthRuntimeCredentialMatch(sellerConfiguration)
    hostMatch = requestHost === sellerConfiguration.branchHost &&
      requestHost === EXPECTED_HOST
    callbackConfigPresent = callbackConfigured(
      sellerConfiguration.callbackUrl,
    )
    deploymentEnvironment = publicationConfiguration.environmentClass
    environmentMatch = publicationConfiguration.environmentClass ===
        "SELLER_OS_DEDICATED_PREPROD" &&
      publicationConfiguration.environmentAllowed === true
    productionOauthEnabled = publicationConfiguration.configured
    writeGatesAllOff = publicationConfiguration.writeGatesAllOff
    clientConfigPresent = publicationConfiguration.clientPair === "PRESENT" &&
      publicationConfiguration.clientPairComplete &&
      Boolean(sellerConfiguration.clientId)
    runameConfigPresent = publicationConfiguration.runame === "PRESENT" &&
      Boolean(sellerConfiguration.runame)
    stateSecretPresent = Boolean(sellerConfiguration.clientSecret)
    accountScopeReady = publicationConfiguration.accountScopeReady
    identityBound = publicationConfiguration.identityBound
    credentialMatchCertified =
      isEbaySellerOAuthReauthRuntimeCredentialMatchCertified(credentialMatch)
    operatorPublicKeyPresent = validateEbayPublicationOAuthPublicKey(
      process.env.EBAY_PUBLICATION_OAUTH_OPERATOR_PUBLIC_KEY?.trim() ?? "",
    )
    assertEbaySellerOAuthReauthSameOrigin(request)
    let validation: Awaited<ReturnType<typeof validateAdminApiRequest>>
    try {
      validation = await validateAdminApiRequest(request)
    } catch {
      responseStatus = 503
      throw new Error("EBAY_PUBLICATION_OAUTH_ADMIN_AUTH_UNAVAILABLE")
    }
    adminSessionValid = validation.ok === true &&
      validation.authenticationMode === "admin_user"
    responseStatus = validation.ok ? 403 : validation.status || 403
    const actorUserId = assertEbaySellerOAuthReauthAdmin(validation)
    ownerAuthorityMatch = Boolean(actorUserId) &&
      accountScopeReady && identityBound
    let supabase: ReturnType<typeof getSupabaseAdminClient>
    try {
      supabase = getSupabaseAdminClient()
    } catch {
      responseStatus = 503
      throw new Error(
        "EBAY_PUBLICATION_OAUTH_SERVER_PERSISTENCE_CONFIG_MISSING",
      )
    }
    const prepared = await startEbayPublicationOAuthBrowserCeremony(
      supabase,
      {
        actorUserId,
        requestHost: request.nextUrl.host,
        ledger: createSupabaseEbaySellerOAuthReauthStateLedger(supabase),
      },
    )
    stateCreated = true
    const response = NextResponse.json({
      success: true,
      authorizationUrl: prepared.authorizationUrl,
      expiresAt: new Date(prepared.expiresAt).toISOString(),
      ceremony: prepared.ceremony,
    }, { status: 200, headers: responseHeaders })
    response.cookies.set(
      EBAY_SELLER_OAUTH_REAUTH_COOKIE,
      "",
      ebaySellerOAuthReauthCookieOptions(0),
    )
    response.cookies.set(
      EBAY_MARKETING_READONLY_OAUTH_COOKIE,
      "",
      ebaySellerOAuthReauthCookieOptions(0),
    )
    response.cookies.set(
      EBAY_PUBLICATION_PRODUCTION_OAUTH_COOKIE,
      prepared.cookie,
      ebaySellerOAuthReauthCookieOptions(
        Math.floor(EBAY_SELLER_OAUTH_REAUTH_STATE_TTL_MS / 1_000),
      ),
    )
    stateCookieSet = true
    responseStatus = 200
    redirectHost = "auth.ebay.com"
    emitDiagnostic(null)
    return response
  } catch (cause) {
    const failureCode = safeEbayPublicationOAuthStartCode(cause)
    emitDiagnostic(failureCode)
    return NextResponse.json({
      success: false,
      error: failureCode,
      failureClass: ebayPublicationOAuthStartFailedGuard(failureCode),
    }, { status: responseStatus, headers: responseHeaders })
  }
}
