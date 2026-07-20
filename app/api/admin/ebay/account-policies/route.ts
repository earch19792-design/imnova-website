export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { saveVerifiedEbayAccountPolicyProfile } from "@/lib/ebay/ebay-account-policy-profile"
import {
  getEbayAccountPolicyReadonlyAuthorizationConfiguration,
  startEbayAccountPolicyReadonlyAuthorization,
} from "@/lib/ebay/ebay-account-policy-oauth-authorization"
import {
  startEbayMerchantLocationOAuth,
} from "@/lib/ebay/ebay-merchant-location-oauth-authorization"
import {
  ebayAccountPolicyReadonlyRuntimeStatus,
  preflightEbayAccountPoliciesReadonly,
} from "@/lib/ebay/ebay-account-policy-readonly-gateway"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"

type JsonRecord = Record<string, unknown>

const PREFLIGHT_UNAVAILABLE = "EBAY_ACCOUNT_POLICY_PREFLIGHT_UNAVAILABLE"

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function target() {
  return "PRODUCTION"
}

function safety(responseTarget: string) {
  return {
    ebayWriteUsed: false,
    ebayResourceMethods: ["GET", "POST:GetUser(read-only)"],
    oauthTokenExchangeMethod: "POST",
    ebayWriteMethods: [],
    canPublish: false,
    target: responseTarget,
  }
}

function merchantLocationAuthorizationSafety() {
  return {
    ebayWriteUsed: false,
    ebayResourceMethods: ["POST:GetUser(identity verification)"],
    oauthTokenExchangeMethod: "POST",
    ebayWriteMethods: [
      "POST:createInventoryLocation(luna-boca-raton-fl only)",
    ],
    writeOccursOnlyAfterHumanEbayConsent: true,
    tokenPersisted: false,
    canCreateInventoryItem: false,
    canCreateOffer: false,
    canPublish: false,
    target: "PRODUCTION",
  }
}

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message.trim() : ""
  const name = error && typeof error === "object" && "name" in error
    ? String((error as { name?: unknown }).name ?? "")
    : ""
  if (
    name === "AbortError" ||
    message === "EBAY_DRAFT_ONLY_READ_PREFLIGHT_UNAVAILABLE" ||
    message === "EBAY_DRAFT_ONLY_REQUEST_FAILED" ||
    message === "EBAY_ACCOUNT_POLICY_READONLY_REQUEST_FAILED" ||
    message === "EBAY_ACCOUNT_POLICY_READONLY_PREFLIGHT_UNAVAILABLE"
  ) return PREFLIGHT_UNAVAILABLE
  return /^EBAY_[A-Z0-9_]+(?:_[0-9]{3})?$/.test(message)
    ? message
    : PREFLIGHT_UNAVAILABLE
}

function jsonError(error: unknown, status?: number) {
  const code = safeErrorCode(error)
  return NextResponse.json({
    success: false,
    error: code,
    safety: safety(target()),
  }, {
    status: status ?? (code === PREFLIGHT_UNAVAILABLE ? 503 : 502),
    headers: { "Cache-Control": "no-store" },
  })
}

export async function POST(req: Request) {
  try {
    const validation = await validateAdminApiRequest(req)
    if (!validation.ok) {
      return jsonError(
        new Error("EBAY_ACCOUNT_POLICY_ADMIN_FORBIDDEN"),
        validation.status === 401 ? 401 : 403,
      )
    }
    if (!validation.userId) {
      return jsonError(
        new Error("EBAY_ACCOUNT_POLICY_HUMAN_ADMIN_REQUIRED"),
        403,
      )
    }

    let body: JsonRecord
    try {
      const rawBody: unknown = await req.json()
      if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
        throw new Error("INVALID_JSON_OBJECT")
      }
      body = rawBody as JsonRecord
    } catch {
      return jsonError(new Error("EBAY_ACCOUNT_POLICY_JSON_INVALID"), 400)
    }

    const accountScope = getEbaySellerAccountScopeConfiguration()
    if (!accountScope.accountKey) {
      return jsonError(
        new Error("EBAY_ACCOUNT_POLICY_ACCOUNT_SCOPE_REQUIRED"),
        503,
      )
    }

    const supabase = getSupabaseAdminClient()
    if (body.action === "start_inventory_location_oauth") {
      if (
        Object.keys(body).length !== 1
        || Object.keys(body)[0] !== "action"
      ) {
        return jsonError(
          new Error("EBAY_MERCHANT_LOCATION_OAUTH_REQUEST_INVALID"),
          400,
        )
      }
      const authorization = await startEbayMerchantLocationOAuth(supabase, {
        actorUserId: validation.userId,
        accountKey: accountScope.accountKey,
      })
      return NextResponse.json({
        success: true,
        action: "start_inventory_location_oauth",
        authorization: {
          authorizationUrl: authorization.authorizationUrl,
          expiresAt: authorization.expiresAt,
        },
        safety: merchantLocationAuthorizationSafety(),
      }, { headers: { "Cache-Control": "no-store" } })
    }
    if (body.action === "start_oauth") {
      const authorization =
        await startEbayAccountPolicyReadonlyAuthorization(supabase, {
          actorUserId: validation.userId,
          accountKey: accountScope.accountKey,
        })
      return NextResponse.json({
        success: true,
        authorization,
        configuration:
          getEbayAccountPolicyReadonlyAuthorizationConfiguration(),
        safety: safety("PRODUCTION"),
      }, { headers: { "Cache-Control": "no-store" } })
    }

    const requested = record(body.selection)
    const { data: vaultRefreshToken, error: vaultReadError } =
      await supabase.rpc(
        "get_ebay_account_policy_readonly_refresh_token_v1",
        { p_account_key: accountScope.accountKey },
      )
    if (vaultReadError) {
      throw new Error("EBAY_ACCOUNT_POLICY_OAUTH_VAULT_READ_FAILED")
    }
    const preflight = await preflightEbayAccountPoliciesReadonly({
      fulfillmentPolicyId: text(requested.fulfillmentPolicyId),
      paymentPolicyId: text(requested.paymentPolicyId),
      returnPolicyId: text(requested.returnPolicyId),
      merchantLocationKey: text(requested.merchantLocationKey),
    }, fetch, text(vaultRefreshToken))
    const accountPolicyProfileSaved =
      await saveVerifiedEbayAccountPolicyProfile({
        supabase,
        accountKey: accountScope.accountKey,
        actorUserId: validation.userId,
        preflight,
      })

    return NextResponse.json({
      success: true,
      preflight,
      accountPolicyProfileSaved,
      runtime: ebayAccountPolicyReadonlyRuntimeStatus(),
      safety: safety(preflight.target),
    }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return jsonError(error)
  }
}
