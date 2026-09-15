export const runtime = "nodejs"
export const maxDuration = 300

import { NextResponse } from "next/server"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { runLunaCatalogSnapshotV1 } from "@/lib/ebay/luna-catalog-snapshot-v1"
import { sellerOsPostOnlyGetResponseV1,
  sellerOsPostRuntimeAuthorizedV1 } from
  "@/lib/seller-os/post-only-runtime-route-v1"

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? ""
  return Boolean(secret && req.headers.get("authorization") === `Bearer ${secret}`)
}

export async function POST(req: Request) {
  const supabase = getSupabaseAdminClient()
  if (!authorized(req) && !await sellerOsPostRuntimeAuthorizedV1({
    request: req, supabase,
  })) {
    return NextResponse.json({ success: false, error: "CRON_UNAUTHORIZED" },
      { status: 401 })
  }
  try {
    const snapshot = await runLunaCatalogSnapshotV1({ supabase })
    if (snapshot.status === "ALREADY_RUNNING") {
      return NextResponse.json({ success: true, status: snapshot.status,
        snapshot, safety: { newRealTraces: 0, newOwnerAuthorizations: 0,
          newChildren: 0, marketplaceWrites: 0, publicationWrites: 0,
          purchases: 0, eBayResearchCalls: 0, shippingCaptures: 0 } })
    }
    return NextResponse.json({ success: true, snapshot,
      safety: { newRealTraces: 0, newOwnerAuthorizations: 0, newChildren: 0,
        marketplaceWrites: 0, publicationWrites: 0, purchases: 0,
        eBayResearchCalls: 0, shippingCaptures: 0 } })
  } catch (error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,119}$/.test(error.message)
      ? error.message : "LUNA_CATALOG_SNAPSHOT_FAILED"
    return NextResponse.json({ success: false, error: code,
      safety: { newRealTraces: 0, newOwnerAuthorizations: 0, newChildren: 0,
        marketplaceWrites: 0, publicationWrites: 0, purchases: 0,
        eBayResearchCalls: 0, shippingCaptures: 0 } }, { status: 502 })
  }
}

export function GET() {
  return sellerOsPostOnlyGetResponseV1()
}
