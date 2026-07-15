export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"

import {
  COMMERCIAL_MONITOR_LANES,
  getEbayCommercialMonitorDashboard,
  runEbayCommercialMonitor,
  updateCommercialThresholds,
  type CommercialMonitorLane,
} from "@/lib/ebay/ebay-commercial-monitor-service"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

function safeCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message) ? message : "COMMERCIAL_MONITOR_REQUEST_FAILED"
}

async function body(req: Request) {
  try {
    const value = await req.json()
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function lanes(value: unknown): CommercialMonitorLane[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((lane): lane is CommercialMonitorLane =>
        typeof lane === "string" &&
        COMMERCIAL_MONITOR_LANES.includes(lane as CommercialMonitorLane)
      ))]
    : [...COMMERCIAL_MONITOR_LANES]
}

function productionBlocked() {
  return process.env.VERCEL_ENV === "production"
}

export async function GET(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return NextResponse.json(
    { success: false, error: validation.error ?? "admin_forbidden" },
    { status: validation.status || 403 },
  )
  if (productionBlocked()) return NextResponse.json({
    success: false,
    error: "COMMERCIAL_MONITOR_PREVIEW_ONLY",
    safety: { productionUnchanged: true, ebayWriteUsed: false },
  }, { status: 403 })
  try {
    return NextResponse.json({
      success: true,
      dashboard: await getEbayCommercialMonitorDashboard(getSupabaseAdminClient()),
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeCode(error) }, { status: 502 })
  }
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return NextResponse.json(
    { success: false, error: validation.error ?? "admin_forbidden" },
    { status: validation.status || 403 },
  )
  if (productionBlocked()) return NextResponse.json({
    success: false,
    error: "COMMERCIAL_MONITOR_PREVIEW_ONLY",
    safety: { productionUnchanged: true, ebayWriteUsed: false },
  }, { status: 403 })
  const input = await body(req)
  if (!input) return NextResponse.json(
    { success: false, error: "COMMERCIAL_MONITOR_INVALID_JSON" },
    { status: 400 },
  )
  try {
    const supabase = getSupabaseAdminClient()
    if (input.action === "update_thresholds") {
      const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
      if (!accountKey) throw new Error("COMMERCIAL_MONITOR_ACCOUNT_SCOPE_REQUIRED")
      const version = typeof input.version === "string" ? input.version.trim() : ""
      const thresholds = await updateCommercialThresholds(supabase, {
        marketplaceAccountKey: accountKey,
        version,
        thresholds: input.thresholds,
        userId: validation.userId,
      })
      return NextResponse.json({ success: true, action: "update_thresholds", thresholds })
    }
    const result = await runEbayCommercialMonitor(supabase, {
      triggerSource: input.dryRun === true ? "dry_run" : "manual",
      lanes: lanes(input.lanes),
      workerId: `commercial-manual:${validation.userId ?? "service"}:${randomUUID()}`,
      dispatchWhatsApp: true,
      dryRunWhatsApp: input.dryRun === true || process.env.VERCEL_ENV !== "preview",
    })
    const dashboard = await getEbayCommercialMonitorDashboard(supabase)
    return NextResponse.json({ success: true, run: result, dashboard })
  } catch (error) {
    const code = safeCode(error)
    return NextResponse.json(
      { success: false, error: code },
      { status: code === "COMMERCIAL_MONITOR_ALREADY_RUNNING" ? 409 : 502 },
    )
  }
}
