export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"
import { readSellerOsOperationalSnapshotV1 } from
  "@/lib/seller-os/operational-snapshot-v1"

export async function GET(request: Request) {
  const auth = await validateAdminApiRequest(request)
  if (!auth.ok) return NextResponse.json({ success: false,
    error: auth.error ?? "admin_forbidden" },
  { status: auth.status || 403 })
  const account = getEbaySellerAccountScopeConfiguration()
  if (!account.accountKey) return NextResponse.json({ success: false,
    error: "SELLER_OS_OPERATIONAL_SNAPSHOT_ACCOUNT_SCOPE_REQUIRED" },
  { status: 503 })
  try {
    const snapshot = await readSellerOsOperationalSnapshotV1({
      supabase: getSupabaseAdminClient(), accountKey: account.accountKey,
      accountAlias: account.accountAlias,
    })
    return NextResponse.json({ success: true, snapshot }, {
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch {
    return NextResponse.json({ success: false,
      error: "SELLER_OS_OPERATIONAL_SNAPSHOT_READ_FAILED",
      safety: { marketplaceWrites: 0, productDecisions: 0 } },
    { status: 503 })
  }
}
