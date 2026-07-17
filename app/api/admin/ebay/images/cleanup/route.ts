export const runtime = "nodejs"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { reconcileEbayImageStorageCleanup } from "@/lib/ebay/ebay-image-storage-cleanup"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"

function safeError(error: unknown) {
  const value = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]{3,100}$/.test(value)
    ? value
    : "EBAY_IMAGE_CLEANUP_REQUEST_FAILED"
}

export async function GET(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 },
    )
  }
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) {
    return NextResponse.json(
      { success: false, error: "EBAY_IMAGE_CLEANUP_ACCOUNT_SCOPE_REQUIRED" },
      { status: 503 },
    )
  }
  const supabase = getSupabaseAdminClient()
  const { data, error } = await supabase
    .from("ebay_image_storage_cleanup_jobs")
    .select("id,image_asset_id,listing_package_id,cleanup_kind,bucket_id,status,attempts,max_attempts,next_attempt_at,last_error_code,last_attempt_at,completed_at,created_at")
    .eq("account_key", accountKey)
    .order("created_at", { ascending: false })
    .limit(50)
  if (error) {
    return NextResponse.json(
      { success: false, error: "EBAY_IMAGE_CLEANUP_STATUS_FAILED" },
      { status: 502 },
    )
  }
  return NextResponse.json({
    success: true,
    jobs: data ?? [],
    strategy: "ADMIN_MANUAL_ONLY",
    cronEnabled: false,
  })
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok || !validation.userId) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 },
    )
  }
  try {
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    if (!accountKey) {
      return NextResponse.json(
        { success: false, error: "EBAY_IMAGE_CLEANUP_ACCOUNT_SCOPE_REQUIRED" },
        { status: 503 },
      )
    }
    const body = await req.json().catch(() => ({})) as { limit?: unknown }
    const requestedLimit = Number(body.limit)
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(25, Math.max(1, requestedLimit))
      : 10
    const result = await reconcileEbayImageStorageCleanup(
      getSupabaseAdminClient(),
      { accountKey, limit, workerId: `admin:${validation.userId}` },
    )
    return NextResponse.json({ success: true, result })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeError(error) },
      { status: 502 },
    )
  }
}
