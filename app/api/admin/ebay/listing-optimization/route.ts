import { revenueFailureV1, revenueTraceIdV1 } from "@/lib/seller-os/revenue-first-diagnostics-v1"
import { ZodError } from "zod"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { executeEbayListingOptimizationLoop } from "@/lib/ebay/listing-optimization"
import { validateAdminApiRequest } from "@/lib/supabase-admin"

function response(payload: unknown, status = 200) {
  const result = NextResponse.json(payload, { status })
  result.headers.set("Cache-Control", "private, no-store, max-age=0")
  return result
}

export async function POST(req: Request) {
  const traceId = revenueTraceIdV1(req.headers.get("x-seller-os-trace-id"))
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
    if (input?.mode === "PREPARE_PREVIEW") {
      if (typeof input.itemId !== "string" || !/^\d{9,19}$/.test(input.itemId) ||
          Object.keys(input).some(key => !["mode", "itemId"].includes(key))) {
        throw new Error("LISTING_OPTIMIZATION_INPUT_INVALID")
      }
      const { loadRevenueFirstListingPreviewV1 } = await import("@/lib/seller-os/revenue-first-preview-v1")
      return response({ success: true, result: await loadRevenueFirstListingPreviewV1(input.itemId, traceId) })
    }
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
    return response({ success: false, error: code,
      ...revenueFailureV1(error, "INPUT_VALIDATION", "LISTING_OPTIMIZATION_INPUT_INVALID", traceId),
      invalidFields: error instanceof ZodError ? error.issues.slice(0, 30).map(issue =>
        issue.path.filter(part => typeof part === "string" && /^[a-zA-Z0-9_]{1,60}$/.test(part)).join(".")) : [],
    }, 400)
  }
}
