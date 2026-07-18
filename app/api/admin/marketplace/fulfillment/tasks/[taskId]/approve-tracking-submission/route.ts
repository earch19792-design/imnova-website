export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import { approveMarketplaceFulfillmentTracking } from "@/lib/marketplace/fulfillment-v1a-service"
import { approveMarketplaceFulfillmentTrackingReal } from "@/lib/marketplace/fulfillment-v1b-service"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"

export async function POST(req: Request, context: { params: Promise<{ taskId: string }> }) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return NextResponse.json({ success: false, error: validation.error ?? "admin_forbidden" }, { status: validation.status || 403 })
  try {
    const input = await req.json()
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("FULFILLMENT_INVALID_JSON")
    const { taskId } = await context.params
    const body = input as Record<string, unknown>
    return NextResponse.json({
      success: true,
      result: body.submissionMode === "ebay_real"
        ? await approveMarketplaceFulfillmentTrackingReal(
          getSupabaseAdminClient(), taskId, body, validation.userId,
          req.headers.get("idempotency-key") ?? "",
        )
        : await approveMarketplaceFulfillmentTracking(
          getSupabaseAdminClient(), taskId, body, validation.userId,
          req.headers.get("idempotency-key") ?? "",
        ),
    })
  } catch (error) {
    const code = safeCode(error)
    return NextResponse.json({ success: false, error: code }, { status: /CONFLICT|STATE|MISMATCH/.test(code) ? 409 : 400 })
  }
}

function safeCode(error: unknown) {
  const value = error instanceof Error ? error.message : ""
  return /^(?:FULFILLMENT|EBAY_FULFILLMENT)_[A-Z0-9_]+$/.test(value) ? value : "FULFILLMENT_TRACKING_APPROVAL_FAILED"
}
