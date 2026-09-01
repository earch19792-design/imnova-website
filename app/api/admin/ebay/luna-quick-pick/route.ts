export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { NextResponse } from "next/server"

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { getEbayTaxonomyListingIntelligence } from
  "@/lib/ebay/ebay-seller-keyword-demand-gateway"
import { processLunaQuickPickBatchV1, readLunaQuickPickProgressV1 } from
  "@/lib/ebay/ebay-luna-quick-pick-v1"
import { continueLunaQuickPickRequiredSpecificsV1 } from
  "@/lib/ebay/ebay-luna-quick-pick-required-specifics-v1"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function response(payload: unknown, status = 200) {
  const result = NextResponse.json(payload, { status })
  result.headers.set("Cache-Control", "private, no-store, max-age=0")
  return result
}

function safeError(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_]{2,119}$/.test(code)
    ? code : "LUNA_QUICK_PICK_REQUEST_FAILED"
}

export async function GET(req: Request) {
  const auth = await validateAdminApiRequest(req)
  if (!auth.ok || !auth.userId) return response({ success: false,
    error: auth.error ?? "LUNA_QUICK_PICK_ADMIN_REQUIRED" },
  auth.status || 403)
  try {
    const keys = new URL(req.url).searchParams.getAll("candidate")
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    if (!accountKey) return response({ success: false,
      error: "LUNA_QUICK_PICK_ACCOUNT_SCOPE_REQUIRED" }, 400)
    let progress = await readLunaQuickPickProgressV1({
      supabase: getSupabaseAdminClient(), candidateKeys: keys, accountKey,
      includeRecent: keys.length === 0,
    })
    const pendingSpecifics = progress.flatMap((card) =>
      card.candidateKey && card.exactBlocker?.startsWith(
        "MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN")
        ? [card.candidateKey] : [])
    let requiredSpecificsContinuation: unknown = null
    if (pendingSpecifics.length) {
      try {
        requiredSpecificsContinuation =
          await continueLunaQuickPickRequiredSpecificsV1({
            supabase: getSupabaseAdminClient(), accountKey,
            candidateKeys: pendingSpecifics,
            taxonomyReader: getEbayTaxonomyListingIntelligence,
          })
      } catch (error) {
        requiredSpecificsContinuation = { status: "BLOCKED",
          reasonCode: safeError(error), marketplaceWrites: 0 }
      }
      progress = await readLunaQuickPickProgressV1({
        supabase: getSupabaseAdminClient(), candidateKeys: keys, accountKey,
        includeRecent: keys.length === 0,
      })
    }
    return response({ success: true, progress,
      summary: { inProgress: progress.filter((card) =>
        card.state === "RUNNING").length,
      readyForReview: progress.filter((card) => card.state === "READY").length,
      blocked: progress.filter((card) => card.state === "BLOCKED").length,
      total: progress.length }, requiredSpecificsContinuation,
      safety: { marketplaceWrites: 0, canPublish: false } })
  } catch (error) {
    return response({ success: false, error: safeError(error) }, 400)
  }
}

export async function POST(req: Request) {
  const auth = await validateAdminApiRequest(req)
  if (!auth.ok || !auth.userId) return response({ success: false,
    error: auth.error ?? "LUNA_QUICK_PICK_ADMIN_REQUIRED" },
  auth.status || 403)
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return response({ success: false,
    error: "LUNA_QUICK_PICK_ACCOUNT_SCOPE_REQUIRED" }, 400)
  const length = Number(req.headers.get("content-length") ?? 0)
  if (length > 100_000) return response({ success: false,
    error: "LUNA_QUICK_PICK_INPUT_TOO_LARGE" }, 413)
  try {
    const body = record(await req.json())
    const result = await processLunaQuickPickBatchV1({
      supabase: getSupabaseAdminClient(), accountKey,
      urls: body.urls,
      selectedVariants: record(body.selectedVariants) as Record<string, string>,
      taxonomyReader: getEbayTaxonomyListingIntelligence,
    })
    return response({ success: true, result,
      safety: { marketplaceWrites: 0, canPublish: false,
        customerProductionTouched: false } })
  } catch (error) {
    return response({ success: false, error: safeError(error),
      safety: { marketplaceWrites: 0, canPublish: false } }, 400)
  }
}
