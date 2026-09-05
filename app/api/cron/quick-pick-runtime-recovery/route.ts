export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { NextResponse } from "next/server"

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { getEbayTaxonomyListingIntelligence } from
  "@/lib/ebay/ebay-seller-keyword-demand-gateway"
import { preflightEbayCategoryProductIdentifiers } from
  "@/lib/ebay/ebay-draft-only-gateway"
import { recoverInterruptedLunaQuickPickRuntimeV1 } from
  "@/lib/ebay/ebay-quick-pick-interrupted-runtime-recovery-v1"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

function authorized(req: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? ""
  const runtimeSecret = process.env.SELLER_OS_RUNTIME_RECOVERY_SECRET
    ?.trim() ?? ""
  return Boolean(
    cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`
    || runtimeSecret && req.headers.get(
      "x-seller-os-runtime-recovery-secret") === runtimeSecret,
  )
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ success: false,
    error: "CRON_UNAUTHORIZED" }, { status: 401 })
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return NextResponse.json({ success: false,
    error: "QUICK_PICK_RECOVERY_ACCOUNT_SCOPE_REQUIRED" }, { status: 500 })
  try {
    const recovery = await recoverInterruptedLunaQuickPickRuntimeV1({
      supabase: getSupabaseAdminClient(), accountKey,
      taxonomyReader: getEbayTaxonomyListingIntelligence,
      productIdentifierPolicyReader: preflightEbayCategoryProductIdentifiers,
    })
    return NextResponse.json({ success: recovery.status === "PASS", recovery,
      safety: { marketplaceWrites: 0, listingPublications: 0,
        manualFactInjection: 0, codexProductDecisions: 0 } },
    { status: recovery.status === "PASS" ? 200 : 503 })
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    return NextResponse.json({ success: false,
      error: /^[A-Z][A-Z0-9_]{2,119}$/.test(code) ? code
        : "QUICK_PICK_RECOVERY_FAILED",
      safety: { marketplaceWrites: 0, listingPublications: 0,
        manualFactInjection: 0, codexProductDecisions: 0 } }, { status: 503 })
  }
}
