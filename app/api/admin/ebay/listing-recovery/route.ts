export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"

import {
  getEbayListingRecoveryDashboard,
  runEbayListingRecoveryFixtureDryRun,
  runPersistedEbayListingRecoveryShadow,
} from "@/lib/ebay/ebay-listing-recovery-growth-service"
import {
  getEbaySellerAccountScopeConfiguration,
} from "@/lib/ebay/ebay-seller-account-scope"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

function response(payload: unknown, status = 200) {
  const result = NextResponse.json(payload, { status })
  result.headers.set("Cache-Control", "private, no-store, max-age=0")
  return result
}

function safeCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message)
    ? message
    : "EBAY_LISTING_RECOVERY_REQUEST_FAILED"
}

function previewOnly() {
  return process.env.VERCEL_ENV !== "preview"
}

async function json(req: Request) {
  try {
    const value = await req.json()
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return response({
    success: false,
    error: validation.error ?? "admin_forbidden",
  }, validation.status || 403)
  if (previewOnly()) return response({
    success: false,
    error: "EBAY_LISTING_RECOVERY_PREVIEW_ONLY",
    safety: { productionUnchanged: true, ebayWrites: 0 },
  }, 403)
  try {
    return response({
      success: true,
      dashboard: await getEbayListingRecoveryDashboard(
        getSupabaseAdminClient(),
      ),
    })
  } catch (error) {
    return response({ success: false, error: safeCode(error) }, 502)
  }
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return response({
    success: false,
    error: validation.error ?? "admin_forbidden",
  }, validation.status || 403)
  if (!validation.userId) return response({
    success: false,
    error: "EBAY_LISTING_RECOVERY_HUMAN_ADMIN_REQUIRED",
  }, 403)
  if (previewOnly()) return response({
    success: false,
    error: "EBAY_LISTING_RECOVERY_PREVIEW_ONLY",
    safety: { productionUnchanged: true, ebayWrites: 0 },
  }, 403)
  const body = await json(req)
  if (!body) return response({
    success: false,
    error: "EBAY_LISTING_RECOVERY_INVALID_JSON",
  }, 400)
  try {
    if (body.action === "dry_run_five") {
      return response({
        success: true,
        action: "dry_run_five",
        result: await runEbayListingRecoveryFixtureDryRun(),
      })
    }
    if (body.action === "run_shadow") {
      if (
        body.confirmed !== true ||
        process.env.EBAY_LISTING_RECOVERY_SHADOW_ENABLED !== "true"
      ) return response({
        success: false,
        error: "EBAY_LISTING_RECOVERY_SHADOW_GATE_REQUIRED",
        safety: { ebayWrites: 0, productionUnchanged: true },
      }, 409)
      const accountKey =
        getEbaySellerAccountScopeConfiguration().accountKey
      if (!accountKey) return response({
        success: false,
        error: "EBAY_LISTING_RECOVERY_ACCOUNT_SCOPE_REQUIRED",
      }, 409)
      return response({
        success: true,
        action: "run_shadow",
        result: await runPersistedEbayListingRecoveryShadow({
          supabase: getSupabaseAdminClient(),
          marketplaceAccountKey: accountKey,
          marketplace: "EBAY_US",
          triggerSource: "manual_shadow",
          workerId: `recovery-admin:${validation.userId}:${randomUUID()}`,
        }),
      })
    }
    return response({
      success: false,
      error: "EBAY_LISTING_RECOVERY_ACTION_INVALID",
    }, 400)
  } catch (error) {
    return response({ success: false, error: safeCode(error) }, 502)
  }
}
