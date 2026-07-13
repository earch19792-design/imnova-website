export const runtime = "nodejs"
export const maxDuration = 60

import { NextResponse } from "next/server"

import {
  getEbayActiveListingReadonlySyncConfiguration,
  syncEbayActiveListingsReadonly,
} from "@/lib/ebay/ebay-active-listing-readonly-sync"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"
import { reconcileActiveListingProtectionRisks } from "@/lib/ebay/ebay-seller-command-center-automation"

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message)
    ? message
    : "EBAY_ACTIVE_LISTING_SYNC_FAILED"
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? ""
  const scheduled = Boolean(
    cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`,
  )
  if (scheduled) {
    try {
      const supabase = getSupabaseAdminClient()
      const sync = await syncEbayActiveListingsReadonly(supabase)
      const protection = await reconcileActiveListingProtectionRisks(supabase)
      return NextResponse.json({ success: true, sync, protection })
    } catch (error) {
      return NextResponse.json(
        { success: false, error: safeError(error) },
        { status: 502 },
      )
    }
  }
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 },
    )
  }
  return NextResponse.json({
    success: true,
    configuration: getEbayActiveListingReadonlySyncConfiguration(),
  })
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 },
    )
  }
  try {
    const supabase = getSupabaseAdminClient()
    const sync = await syncEbayActiveListingsReadonly(supabase)
    const protection = await reconcileActiveListingProtectionRisks(supabase)
    return NextResponse.json({ success: true, sync, protection })
  } catch (error) {
    const code = safeError(error)
    const status = /NOT_CONFIGURED|ENV_MISSING|OAUTH_40[013]/.test(code) ? 503 : 502
    return NextResponse.json({ success: false, error: code }, { status })
  }
}
