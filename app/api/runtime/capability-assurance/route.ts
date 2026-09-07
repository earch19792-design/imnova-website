export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

import { NextResponse } from "next/server"

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { sellerOsPostOnlyGetResponseV1,
  sellerOsPostRuntimeAuthorizedV1 } from
  "@/lib/seller-os/post-only-runtime-route-v1"
import { runSellerOsRuntimeCapabilityAssuranceV1 } from
  "@/lib/seller-os/runtime-capability-assurance-v1"

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_]{2,159}$/.test(code)
    ? code : "SELLER_OS_RUNTIME_CAPABILITY_ASSURANCE_FAILED"
}

export async function POST(request: Request) {
  const supabase = getSupabaseAdminClient()
  const authorized = await sellerOsPostRuntimeAuthorizedV1({
    request, supabase, environmentSecrets: [process.env.CRON_SECRET,
      process.env.SELLER_OS_RUNTIME_RECOVERY_SECRET],
  })
  if (!authorized) return NextResponse.json({ success: false,
    error: "RUNTIME_UNAUTHORIZED",
    safety: { marketplaceWrites: 0, executorInvoked: false } },
  { status: 401 })
  const account = getEbaySellerAccountScopeConfiguration()
  if (!account.accountKey) return NextResponse.json({ success: false,
    error: "SELLER_OS_RUNTIME_CAPABILITY_ACCOUNT_SCOPE_REQUIRED",
    safety: { marketplaceWrites: 0, executorInvoked: false } },
  { status: 503 })
  try {
    const result = await runSellerOsRuntimeCapabilityAssuranceV1({
      supabase, accountKey: account.accountKey,
    })
    return NextResponse.json({ success: true, result })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeCode(error),
      safety: { marketplaceWrites: 0, productDecisions: 0,
        publisherDispatches: 0 } }, { status: 503 })
  }
}

export function GET() {
  return sellerOsPostOnlyGetResponseV1()
}
