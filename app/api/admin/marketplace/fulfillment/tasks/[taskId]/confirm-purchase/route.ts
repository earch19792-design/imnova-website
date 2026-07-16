export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import { confirmMarketplaceFulfillmentPurchase } from "@/lib/marketplace/fulfillment-v1a-service"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"

export async function POST(req: Request, context: { params: Promise<{ taskId: string }> }) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return NextResponse.json({ success: false, error: validation.error ?? "admin_forbidden" }, { status: validation.status || 403 })
  try {
    const input = await safeBody(req)
    const { taskId } = await context.params
    return NextResponse.json({
      success: true,
      result: await confirmMarketplaceFulfillmentPurchase(
        getSupabaseAdminClient(), taskId, input, validation.userId,
        req.headers.get("idempotency-key") ?? "",
      ),
    })
  } catch (error) {
    const code = safeCode(error, "FULFILLMENT_PURCHASE_CONFIRM_FAILED")
    return NextResponse.json({ success: false, error: code }, { status: statusFor(code) })
  }
}

async function safeBody(req: Request) {
  const value = await req.json()
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("FULFILLMENT_INVALID_JSON")
  return value as Record<string, unknown>
}

function safeCode(error: unknown, fallback: string) {
  const value = error instanceof Error ? error.message : ""
  return /^FULFILLMENT_[A-Z0-9_]+$/.test(value) ? value : fallback
}

function statusFor(code: string) {
  return /CONFLICT|STATE|ALREADY|MISMATCH/.test(code) ? 409 : /INVALID|REQUIRED|INCOHERENT|NOT_ALLOWED/.test(code) ? 400 : 403
}
