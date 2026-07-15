export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import { executeEbayListingOptimizationLoop } from "@/lib/ebay/listing-optimization"
import { validateAdminApiRequest } from "@/lib/supabase-admin"

function response(payload: unknown, status = 200) {
  const result = NextResponse.json(payload, { status })
  result.headers.set("Cache-Control", "private, no-store, max-age=0")
  return result
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return response(
    { success: false, error: validation.error ?? "admin_forbidden" },
    validation.status || 403,
  )
  if (!validation.userId) return response(
    { success: false, error: "LISTING_OPTIMIZATION_HUMAN_ADMIN_REQUIRED" },
    403,
  )
  const length = Number(req.headers.get("content-length") ?? 0)
  if (length > 2_000_000) return response(
    { success: false, error: "LISTING_OPTIMIZATION_INPUT_TOO_LARGE" },
    413,
  )
  try {
    const input = await req.json()
    const output = executeEbayListingOptimizationLoop(input)
    return response({
      success: true,
      ...output,
      safety: { ebayWriteUsed: false, canPublish: false, persistenceUsed: false },
    })
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "LISTING_OPTIMIZATION_INPUT_INVALID"
    return response({ success: false, error: code }, 400)
  }
}
