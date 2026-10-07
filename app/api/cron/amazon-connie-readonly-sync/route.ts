export const runtime = "nodejs"
export const maxDuration = 300

import { NextResponse } from "next/server"

import { runSellerOsAmazonConnieAutomaticCaptureV1 } from
  "@/lib/marketplace/seller-os-amazon-connie-auto-sync-v1"
import { sellerOsPostOnlyGetResponseV1,
  sellerOsPostRuntimeAuthorizedV1 } from
  "@/lib/seller-os/post-only-runtime-route-v1"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? ""
  return Boolean(secret && req.headers.get("authorization") === `Bearer ${secret}`)
}

function safeCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_]{2,119}$/.test(message) ? message
    : "AMAZON_SP_API_AUTOMATIC_CAPTURE_FAILED"
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
    const result = await runSellerOsAmazonConnieAutomaticCaptureV1({ supabase })
    return NextResponse.json({ success: true, result }, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeCode(error),
      safety: { amazonReadOnly: true, amazonWrites: 0, publications: 0,
        repricing: 0, supplierPurchases: 0 } }, { status: 502 })
  }
}

export function GET() {
  return sellerOsPostOnlyGetResponseV1({
    capability: "AMAZON_CONNIE_READ_ONLY_SYNC",
  })
}
