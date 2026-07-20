export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { saveVerifiedEbayAccountPolicyProfile } from "@/lib/ebay/ebay-account-policy-profile"
import {
  ebayDraftOnlyRuntimeStatus,
  preflightEbayDraftOnlyMobile,
} from "@/lib/ebay/ebay-draft-only-gateway"
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
  const value = process.env.EBAY_DRAFT_ONLY_TARGET?.trim().toUpperCase()
  return value === "SANDBOX" || value === "PRODUCTION" ? value : "BLOCKED"
}

function safety(responseTarget: string) {
  return {
    ebayWriteUsed: false,
    ebayResourceMethods: ["GET"],
    oauthTokenExchangeMethod: "POST",
    ebayWriteMethods: [],
    canPublish: false,
    target: responseTarget,
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
    message === "EBAY_DRAFT_ONLY_REQUEST_FAILED"
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

    const requested = record(body.selection)
    const preflight = await preflightEbayDraftOnlyMobile({
      fulfillmentPolicyId: text(requested.fulfillmentPolicyId),
      paymentPolicyId: text(requested.paymentPolicyId),
      returnPolicyId: text(requested.returnPolicyId),
      merchantLocationKey: text(requested.merchantLocationKey),
    })
    const supabase = getSupabaseAdminClient()
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
      runtime: ebayDraftOnlyRuntimeStatus(),
      safety: safety(preflight.target),
    }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return jsonError(error)
  }
}
