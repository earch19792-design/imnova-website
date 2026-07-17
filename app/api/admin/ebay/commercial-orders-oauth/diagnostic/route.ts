export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import {
  diagnoseEbayCommercialOrdersConsentRequest,
  EBAY_COMMERCIAL_ORDERS_DIAGNOSTIC_PHASES,
  type EbayCommercialOrdersDiagnosticPhase,
} from "@/lib/ebay/ebay-commercial-orders-oauth-authorization"
import { validateAdminApiRequest } from "@/lib/supabase-admin"

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]{3,160}$/.test(code)
    ? code
    : "EBAY_COMMERCIAL_ORDERS_DIAGNOSTIC_FAILED"
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 },
    )
  }
  let phase = ""
  try {
    const input = await req.json()
    phase = typeof input?.phase === "string" ? input.phase : ""
  } catch {
    return NextResponse.json(
      { success: false, error: "EBAY_COMMERCIAL_ORDERS_DIAGNOSTIC_INVALID_JSON" },
      { status: 400 },
    )
  }
  if (!EBAY_COMMERCIAL_ORDERS_DIAGNOSTIC_PHASES.includes(
    phase as EbayCommercialOrdersDiagnosticPhase,
  )) {
    return NextResponse.json(
      { success: false, error: "EBAY_COMMERCIAL_ORDERS_DIAGNOSTIC_PHASE_INVALID" },
      { status: 400 },
    )
  }
  try {
    return NextResponse.json({
      success: true,
      diagnostic: await diagnoseEbayCommercialOrdersConsentRequest(
        phase as EbayCommercialOrdersDiagnosticPhase,
      ),
    }, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeCode(error) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    )
  }
}
