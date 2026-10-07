export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { SELLER_OS_888LOTS_SOURCE_KEY } from
  "@/lib/marketplace/seller-os-888lots-supplier-onboarding-v1"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"

const RETIREMENT_REASON = "SUPPLIER_CLOSING" as const

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status,
    headers: { "Cache-Control": "private, no-store, max-age=0" } })
}

async function authorized(req: Request) {
  const auth = await validateAdminApiRequest(req)
  return auth.ok && auth.authenticationMode === "admin_user" && auth.userId
    ? auth : null
}

export async function GET(req: Request) {
  if (!await authorized(req)) {
    return json({ success: false, error: "OWNER_SELLER_OS_AUTH_REQUIRED" }, 403)
  }
  const account = getEbaySellerAccountScopeConfiguration()
  if (!account.accountKey) {
    return json({ success: false,
      error: "SELLER_OS_CANONICAL_ACCOUNT_REQUIRED" }, 503)
  }
  const recent = await getSupabaseAdminClient()
    .from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,product_title,commercial_lifecycle_stage,commercial_decision,commercial_next_best_evidence,commercial_evidence_freshness,commercial_updated_at")
    .eq("commercial_account_key", account.accountKey)
    .like("candidate_key", `${SELLER_OS_888LOTS_SOURCE_KEY}:%`)
    .order("commercial_updated_at", { ascending: false }).limit(25)
  if (recent.error) {
    return json({ success: false,
      error: "SELLER_OS_888LOTS_HISTORY_READ_FAILED" }, 503)
  }
  return json({ success: true, sourceKey: SELLER_OS_888LOTS_SOURCE_KEY,
    supplierStatus: "RETIRED" as const, retirementReason: RETIREMENT_REASON,
    integrationMode: "READ_ONLY_HISTORY" as const,
    activeCandidateCount: 0, recommendations: [],
    recentCandidates: recent.data ?? [],
    replacementRoute: "/admin/marketplace/amazon/connie",
    safety: { supplierReads: 0, supplierPurchases: 0, marketplaceWrites: 0,
      publications: 0, repricing: 0, historyPreserved: true } })
}

export async function POST(req: Request) {
  if (!await authorized(req)) {
    return json({ success: false, error: "OWNER_SELLER_OS_AUTH_REQUIRED" }, 403)
  }
  return json({ success: false, error: "SELLER_OS_888LOTS_SUPPLIER_RETIRED",
    supplierStatus: "RETIRED", retirementReason: RETIREMENT_REASON,
    nextStep: "USE_AMAZON_CONNIE_SOURCING",
    replacementRoute: "/admin/marketplace/amazon/connie",
    safety: { supplierReads: 0, supplierPurchases: 0,
      marketplaceWrites: 0 } }, 410)
}
