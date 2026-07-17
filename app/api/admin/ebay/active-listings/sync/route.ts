export const runtime = "nodejs"
export const maxDuration = 60

import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"

import {
  getEbayActiveListingReadonlySyncConfiguration,
  syncEbayActiveListingsReadonly,
} from "@/lib/ebay/ebay-active-listing-readonly-sync"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { reconcileActiveListingProtectionRisks } from "@/lib/ebay/ebay-seller-command-center-automation"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message)
    ? message
    : "EBAY_ACTIVE_LISTING_SYNC_FAILED"
}

function row(value: unknown) {
  const resolved = Array.isArray(value) ? value[0] : value
  return resolved && typeof resolved === "object" && !Array.isArray(resolved)
    ? resolved as Record<string, unknown>
    : null
}

async function syncState() {
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return { accountKey: null, state: null }
  const { data, error } = await getSupabaseAdminClient()
    .from("ebay_active_listing_sync_state")
    .select("account_key,latest_started_run_id,latest_started_at,latest_committed_generation,latest_committed_at,active_run_id,active_run_started_at,active_run_lease_expires_at,last_success_run_id,last_success_at,last_error_run_id,last_error_at,last_error_code")
    .eq("account_key", accountKey)
    .maybeSingle()
  if (error) throw new Error("EBAY_ACTIVE_LISTING_SYNC_STATE_FAILED")
  return { accountKey, state: data }
}

export async function GET(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 },
    )
  }
  try {
    const current = await syncState()
    return NextResponse.json({
      success: true,
      configuration: getEbayActiveListingReadonlySyncConfiguration(),
      state: current.state,
      strategy: {
        mode: "ADMIN_MANUAL_ONLY",
        cronEnabled: false,
        runAfterManualRegistration: true,
        runBeforeOperationalReview: true,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeError(error) },
      { status: 502 },
    )
  }
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok || !validation.userId) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 },
    )
  }
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) {
    return NextResponse.json(
      { success: false, error: "EBAY_ACTIVE_LISTING_ACCOUNT_SCOPE_REQUIRED" },
      { status: 503 },
    )
  }
  const supabase = getSupabaseAdminClient()
  const syncRunId = randomUUID()
  const { data: claimData, error: claimError } = await supabase.rpc(
    "claim_ebay_active_listing_sync_run",
    {
      p_account_key: accountKey,
      p_run_id: syncRunId,
      p_lease_seconds: 180,
    },
  )
  const claim = row(claimData)
  if (claimError || !claim) {
    return NextResponse.json(
      { success: false, error: "EBAY_ACTIVE_LISTING_SYNC_CLAIM_FAILED" },
      { status: 502 },
    )
  }
  if (claim.claimed !== true) {
    return NextResponse.json({
      success: false,
      error: "EBAY_ACTIVE_LISTING_SYNC_ALREADY_RUNNING",
      activeRunStartedAt: claim.active_run_started_at ?? null,
      activeRunLeaseExpiresAt: claim.active_run_lease_expires_at ?? null,
    }, { status: 409 })
  }

  try {
    const sync = await syncEbayActiveListingsReadonly(supabase, { syncRunId })
    const protection = await reconcileActiveListingProtectionRisks(supabase)
    const { error: finishError } = await supabase.rpc(
      "finish_ebay_active_listing_sync_run",
      {
        p_account_key: accountKey,
        p_run_id: syncRunId,
        p_success: true,
        p_error_code: null,
      },
    )
    if (finishError) throw new Error("EBAY_ACTIVE_LISTING_SYNC_FINISH_FAILED")
    return NextResponse.json({ success: true, sync, protection })
  } catch (error) {
    const code = safeError(error)
    await supabase.rpc("finish_ebay_active_listing_sync_run", {
      p_account_key: accountKey,
      p_run_id: syncRunId,
      p_success: false,
      p_error_code: code,
    })
    const status = /NOT_CONFIGURED|ENV_MISSING|OAUTH_40[013]|ACCOUNT_SCOPE/.test(code)
      ? 503
      : code === "EBAY_ACTIVE_LISTING_ACCOUNT_IDENTITY_MISMATCH" ? 409 : 502
    return NextResponse.json({ success: false, error: code }, { status })
  }
}
