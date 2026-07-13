export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import { getEbaySellerOsEnvironmentPreflight } from "@/lib/ebay/ebay-seller-os-env-preflight"
import { validateAdminApiRequest } from "@/lib/supabase-admin"

export async function GET(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 },
    )
  }
  return NextResponse.json({
    variables: getEbaySellerOsEnvironmentPreflight(),
  })
}
