export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import {
  completeEbayCommercialOrdersAuthorization,
  sanitizeEbayCommercialAuthorizationCallbackError,
} from "@/lib/ebay/ebay-commercial-orders-oauth-authorization"
import {
  isValidEbayCommercialAuthorizationCode,
  isValidEbayCommercialOAuthState,
} from "@/lib/ebay/ebay-commercial-orders-oauth-domain"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]{3,160}$/.test(code)
    ? code
    : "EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_CALLBACK_FAILED"
}

function redirect(req: Request, outcome: "ready" | "error", reason?: string) {
  const target = new URL("/admin/ebay/mobile-review", req.url)
  target.searchParams.set("commercialOrdersOAuth", outcome)
  if (reason) target.searchParams.set("reason", reason)
  return NextResponse.redirect(target, {
    status: 303,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  })
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const callbackError = url.searchParams.get("error")?.trim() ?? ""
  if (callbackError) {
    return redirect(
      req,
      "error",
      sanitizeEbayCommercialAuthorizationCallbackError(callbackError),
    )
  }
  const input = {
    code: url.searchParams.get("code")?.trim() ?? "",
    state: url.searchParams.get("state")?.trim() ?? "",
  }
  if (
    !isValidEbayCommercialOAuthState(input.state) ||
    !isValidEbayCommercialAuthorizationCode(input.code)
  ) {
    input.code = ""
    input.state = ""
    return redirect(
      req,
      "error",
      "EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_CALLBACK_INVALID",
    )
  }
  try {
    await completeEbayCommercialOrdersAuthorization(
      getSupabaseAdminClient(),
      input,
    )
    return redirect(req, "ready")
  } catch (error) {
    return redirect(req, "error", safeCode(error))
  }
}
