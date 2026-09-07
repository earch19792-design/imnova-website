export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { sellerOsPostOnlyGetResponseV1,
  sellerOsPostRuntimeAuthorizedV1 } from
  "@/lib/seller-os/post-only-runtime-route-v1"
import { persistSellerOsRuntimeHealthAuthorityV1 } from
  "@/lib/seller-os/runtime-health-authority-v1"

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_]{2,159}$/.test(code)
    ? code : "SELLER_OS_RUNTIME_HEALTH_ATTESTATION_FAILED"
}

export async function POST(request: Request) {
  const supabase = getSupabaseAdminClient()
  const authorized = await sellerOsPostRuntimeAuthorizedV1({
    request, supabase, environmentSecrets: [process.env.CRON_SECRET,
      process.env.SELLER_OS_RUNTIME_RECOVERY_SECRET],
  })
  if (!authorized) return NextResponse.json({ success: false,
    error: "RUNTIME_UNAUTHORIZED", safety: { marketplaceWrites: 0 } },
  { status: 401 })
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return NextResponse.json({ success: false,
    error: "SELLER_OS_RUNTIME_HEALTH_ACCOUNT_SCOPE_REQUIRED",
    safety: { marketplaceWrites: 0 } }, { status: 503 })
  try {
    const body = await request.json()
    const result = await persistSellerOsRuntimeHealthAuthorityV1({
      supabase, accountKey, runtimeHealth: body?.runtimeHealth,
    })
    return NextResponse.json({ success: true,
      receiptId: result.durableReceipt.runId,
      observedAt: result.runtimeHealth.observedAt,
      contractVersion: result.runtimeHealth.contractVersion,
      safety: { marketplaceWrites: 0, businessFactWrites: 0 } })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeCode(error),
      safety: { marketplaceWrites: 0, businessFactWrites: 0 } },
    { status: 503 })
  }
}

export function GET() {
  return sellerOsPostOnlyGetResponseV1()
}
