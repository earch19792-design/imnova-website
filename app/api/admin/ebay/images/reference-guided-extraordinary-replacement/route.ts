export const runtime = "nodejs"

import { NextResponse } from "next/server"

import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

const ATTEMPT_ID = "f166b395-8d3a-4921-b273-1a62a6032707"

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function safeCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return message.match(/[A-Z][A-Z0-9_:.-]{2,180}/)?.[0]
    ?? "EXTRAORDINARY_REPLACEMENT_AUTHORIZATION_FAILED"
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok || validation.authenticationMode !== "admin_user" ||
    !validation.userId) {
    return NextResponse.json({ success: false,
      error: validation.error ?? "admin_user_required" },
    { status: validation.status && validation.status !== 200
      ? validation.status : 403 })
  }
  try {
    const body = record(await req.json())
    const attemptId = body.attemptId === ATTEMPT_ID ? ATTEMPT_ID : ""
    const position = body.action === "AUTHORIZE_POSITION_4" ? 4
      : body.action === "AUTHORIZE_POSITION_6" ? 6 : 0
    if (!attemptId || !position) {
      throw new Error("EXTRAORDINARY_REPLACEMENT_AUTHORIZATION_SCOPE_INVALID")
    }
    // The browser supplies no plan, prompt, amendment, hash, ordinal, budget,
    // reference, or feature flag. The database resolves and validates them.
    const { data, error } = await getSupabaseAdminClient().rpc(
      "authorize_ebay_reference_guided_extraordinary_replacement",
      { p_attempt_id: attemptId, p_position: position,
        p_human_authorized_by: validation.userId },
    )
    if (error) throw new Error(safeCode(error))
    const result = Array.isArray(data) ? data[0] : data
    if (!result) throw new Error("EXTRAORDINARY_REPLACEMENT_AUTHORIZATION_NOT_PERSISTED")
    const response = NextResponse.json({ success: true,
      authorizationId: result.authorization_id,
      position: result.authorized_position,
      extraordinaryOrdinal: result.extraordinary_ordinal,
      reused: result.reused === true,
      providerCallConsumed: false,
      providerCallsCreated: 0,
      activeLeasesCreated: 0,
      providerReservationsCreated: 0,
      featureFlagEnabled: false,
      ebayWrites: 0,
      productionChanged: false })
    response.headers.set("Cache-Control", "no-store")
    return response
  } catch (error) {
    return NextResponse.json({ success: false, error: safeCode(error),
      providerCallConsumed: false, providerCallsCreated: 0,
      activeLeasesCreated: 0, providerReservationsCreated: 0,
      featureFlagEnabled: false, ebayWrites: 0,
      productionChanged: false }, { status: 409 })
  }
}
