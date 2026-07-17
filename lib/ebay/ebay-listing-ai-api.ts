import { NextResponse } from "next/server"

import { getEbaySellerAccountScopeConfiguration } from "./ebay-seller-account-scope"
import { getListingAiConfiguration } from "./ebay-openai-listing-factory-v2"
import { getSupabaseAdminClient, validateAdminApiRequest } from "../supabase-admin"

const routeBuckets = new Map<string, number[]>()

export function enforceListingAiRouteRateLimit(
  actorId: string,
  lane: "READ" | "WRITE",
  now = Date.now(),
) {
  const key = `${actorId}:${lane}`
  const windowStart = now - 60_000
  const recent = (routeBuckets.get(key) ?? []).filter((entry) => entry >= windowStart)
  const limit = lane === "WRITE" ? 20 : 120
  if (recent.length >= limit) throw new Error("LISTING_AI_RATE_LIMITED")
  recent.push(now)
  routeBuckets.set(key, recent)
}

export function listingAiResponse(payload: unknown, status = 200) {
  const response = NextResponse.json(payload, { status })
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  response.headers.set("X-Content-Type-Options", "nosniff")
  return response
}

export function listingAiSafeCode(error: unknown) {
  const value = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_:.-]+$/.test(value) ? value : "LISTING_AI_REQUEST_FAILED"
}

export function listingAiErrorStatus(code: string) {
  if (code.includes("NOT_FOUND")) return 404
  if (code.includes("RATE_LIMIT")) return 429
  if (code.includes("HARD_STOP")) return 402
  if (code.includes("DISABLED") || code.includes("MISSING") || code.includes("REQUIRED")) return 409
  if (code.includes("PREVIEW_STAGING")) return 403
  return 400
}

export function listingAiRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

export function listingAiText(value: unknown, maximum = 240) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : ""
}

export function listingAiCodes(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => /^[A-Z0-9_]+$/.test(entry))
    .slice(0, 20)
}

export function listingAiIdempotencyKey(req: Request) {
  const value = req.headers.get("idempotency-key")?.trim() ?? ""
  if (!value || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("LISTING_AI_IDEMPOTENCY_KEY_REQUIRED")
  }
  return value
}

export async function authorizeListingAiRequest(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok || !validation.userId) return {
    ok: false as const,
    response: listingAiResponse(
      { success: false, error: validation.error ?? "LISTING_AI_ADMIN_REQUIRED" },
      validation.status || 403,
    ),
  }
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return {
    ok: false as const,
    response: listingAiResponse({ success: false, error: "LISTING_AI_ACCOUNT_REQUIRED" }, 409),
  }
  const boundary = getListingAiConfiguration()
  if (!boundary.preview || !boundary.staging) return {
    ok: false as const,
    response: listingAiResponse({
      success: false,
      error: "LISTING_AI_PREVIEW_STAGING_REQUIRED",
      safety: { canPublish: false, ebayWrites: 0 },
    }, 403),
  }
  return {
    ok: true as const,
    actorId: validation.userId,
    accountKey,
    supabase: getSupabaseAdminClient(),
  }
}

export async function listingAiJson(req: Request) {
  const length = Number(req.headers.get("content-length") ?? 0)
  if (length > 100_000) throw new Error("LISTING_AI_INPUT_TOO_LARGE")
  return listingAiRecord(await req.json())
}

export function listingAiFailure(error: unknown) {
  const code = listingAiSafeCode(error)
  return listingAiResponse({
    success: false,
    error: code,
    safety: {
      secretsExposed: false,
      piiExposed: false,
      canPublish: false,
      ebayWrites: 0,
    },
  }, listingAiErrorStatus(code))
}
