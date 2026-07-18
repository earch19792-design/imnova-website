export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { confirmSameDayLuna, getSameDayPilot, processSameDayPilotJobs, startSameDayPilot } from "@/lib/ebay/ebay-same-day-pilot-service"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message) ? message : "SAME_DAY_PILOT_REQUEST_FAILED"
}
async function authorization(req: Request) {
  const auth = await validateAdminApiRequest(req)
  if (!auth.ok || !auth.userId) return { response: NextResponse.json({ success: false, error: auth.error ?? "admin_forbidden" }, { status: auth.status || 403 }) }
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return { response: NextResponse.json({ success: false, error: "SAME_DAY_PILOT_ACCOUNT_SCOPE_REQUIRED" }, { status: 503 }) }
  return { auth, accountKey, supabase: getSupabaseAdminClient() }
}

export async function GET(req: Request) {
  const access = await authorization(req)
  if ("response" in access) return access.response
  try {
    return NextResponse.json({ success: true, pilot: await getSameDayPilot({ supabase: access.supabase, accountKey: access.accountKey }),
      safety: { fullCatalogRescan: false, ebayWrites: 0, productionChanged: false } })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeError(error) }, { status: 502 })
  }
}

export async function POST(req: Request) {
  const access = await authorization(req)
  if ("response" in access) return access.response
  try {
    const body = object(await req.json())
    if (body.action === "start") {
      const pilot = await startSameDayPilot({ supabase: access.supabase, accountKey: access.accountKey, actorId: access.auth.userId })
      return NextResponse.json({ success: true, pilot, safety: { oneClickStarted: true, fullCatalogRescan: false, ebayWrites: 0, productionChanged: false } }, { status: pilot.created ? 201 : 200 })
    }
    if (body.action === "confirm_luna") {
      const availability = object(body.availability)
      const quantity = availability.quantity === null || availability.quantity === undefined || availability.quantity === ""
        ? null : Number(availability.quantity)
      const price = Number(body.price)
      if (typeof body.taskId !== "string" || !Number.isFinite(price) || price <= 0 || typeof availability.available !== "boolean" ||
        (quantity !== null && (!Number.isInteger(quantity) || quantity < 0))) {
        return NextResponse.json({ success: false, error: "SAME_DAY_PILOT_LUNA_CONFIRMATION_INVALID" }, { status: 400 })
      }
      await confirmSameDayLuna({ supabase: access.supabase, accountKey: access.accountKey, actorId: access.auth.userId,
        taskId: body.taskId, price, available: availability.available, quantity })
      const continuation = await processSameDayPilotJobs({ supabase: access.supabase, accountKey: access.accountKey,
        workerId: `user-confirmation:${access.auth.userId}` })
      const pilot = await getSameDayPilot({ supabase: access.supabase, accountKey: access.accountKey })
      return NextResponse.json({ success: true, pilot, continuation, autoResumed: true, safety: { ebayWrites: 0, productionChanged: false } })
    }
    return NextResponse.json({ success: false, error: "SAME_DAY_PILOT_ACTION_INVALID" }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeError(error) }, { status: 502 })
  }
}
