export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import {
  getEbayPublicationOAuthConfiguration,
  startEbayPublicationOAuth,
} from "@/lib/ebay/ebay-publication-oauth-authorization"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]{3,180}$/.test(code)
    ? code
    : "EBAY_PUBLICATION_OAUTH_START_FAILED"
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 },
    )
  }
  let input: { publicKeyPem?: unknown } = {}
  try {
    input = await req.json()
  } catch {
    return NextResponse.json(
      { success: false, error: "EBAY_PUBLICATION_OAUTH_INVALID_JSON" },
      { status: 400 },
    )
  }
  if (typeof input.publicKeyPem !== "string") {
    return NextResponse.json(
      { success: false, error: "EBAY_PUBLICATION_OAUTH_PUBLIC_KEY_REQUIRED" },
      { status: 400 },
    )
  }
  try {
    const result = await startEbayPublicationOAuth(
      getSupabaseAdminClient(),
      {
        publicKeyPem: input.publicKeyPem,
        actorUserId: validation.userId,
      },
    )
    return NextResponse.json({ success: true, ...result }, {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    })
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
