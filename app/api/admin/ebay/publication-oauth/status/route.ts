export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import {
  getEbayPublicationOAuthConfiguration,
  getEbayPublicationOAuthStatus,
} from "@/lib/ebay/ebay-publication-oauth-authorization"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]{3,180}$/.test(code)
    ? code
    : "EBAY_PUBLICATION_OAUTH_STATUS_FAILED"
}

export async function GET(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 },
    )
  }
  try {
    return NextResponse.json({
      success: true,
      ...(await getEbayPublicationOAuthStatus(getSupabaseAdminClient())),
    }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: safeCode(error),
      configuration: getEbayPublicationOAuthConfiguration(),
    }, {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    })
  }
}
