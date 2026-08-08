export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

import { NextResponse } from "next/server"

import { getCommercialMonitorReadonly } from
  "@/lib/ebay/commercial-monitor-readonly-service"
import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { getEbayCommercialMonitorLiveReadonly } from
  "@/lib/ebay/ebay-commercial-monitor-live-readonly"
import { getEbayProRuntimeBoundary } from
  "@/lib/ebay/environment-boundaries"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

const READ_ONLY_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Commercial-Monitor-Mode": "READ_ONLY",
} as const

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message)
    ? message
    : "COMMERCIAL_MONITOR_READONLY_REQUEST_FAILED"
}

export async function GET(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      {
        status: validation.status || 403,
        headers: READ_ONLY_HEADERS,
      },
    )
  }
  const boundary = getEbayProRuntimeBoundary({
    pathname: new URL(req.url).pathname,
    method: "GET",
  })
  if (boundary.blocked) {
    return NextResponse.json({
      success: false,
      error: "COMMERCIAL_MONITOR_PREVIEW_ONLY",
      safety: {
        productionUnchanged: true,
        marketplaceWritesAllowed: false,
        dispatchAllowed: false,
      },
    }, { status: 403, headers: READ_ONLY_HEADERS })
  }
  try {
    const account = getEbaySellerAccountScopeConfiguration()
    const live = await getEbayCommercialMonitorLiveReadonly({
      accountKey: account.accountKey,
      accountAlias: account.accountAlias,
    })
    const monitor = await getCommercialMonitorReadonly(
      account.accountKey ? getSupabaseAdminClient() : null,
      {
        accountKey: account.accountKey,
        accountAlias: account.accountAlias,
        configurationReason: account.reason,
      },
      live,
    )
    return NextResponse.json(
      { success: true, monitor },
      { headers: READ_ONLY_HEADERS },
    )
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorCode(error) },
      { status: 502, headers: READ_ONLY_HEADERS },
    )
  }
}
