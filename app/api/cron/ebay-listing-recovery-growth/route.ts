export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { randomUUID, timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"

import {
  runPersistedEbayListingRecoveryShadow,
} from "@/lib/ebay/ebay-listing-recovery-growth-service"
import {
  getEbaySellerAccountScopeConfiguration,
} from "@/lib/ebay/ebay-seller-account-scope"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

function authorized(req: Request) {
  const expected = process.env.EBAY_COMMERCIAL_PILOT_CRON_SECRET ?? ""
  const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    ?? req.headers.get("x-cron-secret")
    ?? ""
  if (!expected || expected.length !== supplied.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
}

function response(payload: unknown, status = 200) {
  const result = NextResponse.json(payload, { status })
  result.headers.set("Cache-Control", "private, no-store, max-age=0")
  return result
}

async function execute(req: Request) {
  if (!authorized(req)) return response({
    success: false,
    error: "EBAY_LISTING_RECOVERY_CRON_FORBIDDEN",
  }, 401)
  if (
    process.env.VERCEL_ENV !== "preview" ||
    process.env.EBAY_LISTING_RECOVERY_SHADOW_ENABLED !== "true"
  ) return response({
    success: true,
    status: "DISABLED",
    safety: { productionUnchanged: true, ebayWrites: 0 },
  })
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return response({
    success: false,
    error: "EBAY_LISTING_RECOVERY_ACCOUNT_SCOPE_REQUIRED",
  }, 409)
  try {
    return response({
      success: true,
      result: await runPersistedEbayListingRecoveryShadow({
        supabase: getSupabaseAdminClient(),
        marketplaceAccountKey: accountKey,
        marketplace: "EBAY_US",
        triggerSource: "schedule",
        workerId: `recovery-cron:${randomUUID()}`,
      }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    return response({
      success: false,
      error: /^[A-Z0-9_]+$/.test(message)
        ? message : "EBAY_LISTING_RECOVERY_CRON_FAILED",
      safety: { ebayWrites: 0 },
    }, 502)
  }
}

export async function GET(req: Request) {
  return execute(req)
}

export async function POST(req: Request) {
  return execute(req)
}
