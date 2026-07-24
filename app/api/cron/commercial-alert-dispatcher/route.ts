export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"

import { getCommercialMonitorScheduleConfiguration } from "@/lib/ebay/ebay-commercial-monitor-service"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { commercialPreviewCronAuthorized } from "@/lib/ebay/ebay-commercial-preview-pilot"
import {
  getSellerWhatsAppGatewayConfiguration,
  preflightSellerWhatsAppGateway,
} from "@/lib/ebay/ebay-seller-whatsapp-gateway"
import { dispatchCommercialAlertOutbox } from "@/lib/marketplace/commercial-alert-dispatcher"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
    : fallback
}

function record(value: unknown) {
  const resolved = Array.isArray(value) ? value[0] : value
  return resolved && typeof resolved === "object" && !Array.isArray(resolved)
    ? resolved as Record<string, unknown>
    : null
}

function nextDigestAt(now = new Date()) {
  const configured = Number(
    process.env.EBAY_SELLER_WHATSAPP_DIGEST_HOUR_UTC ?? "0",
  )
  const hour = Number.isFinite(configured)
    ? Math.max(0, Math.min(23, Math.trunc(configured)))
    : 0
  const due = new Date(now)
  due.setUTCHours(hour, 0, 0, 0)
  if (due.getTime() <= now.getTime()) due.setUTCDate(due.getUTCDate() + 1)
  return due.toISOString()
}

const IMMEDIATE_WHATSAPP_EVENT_TYPES = new Set([
  "SALE_DETECTED",
  "ACTIVE_LISTING_OUT_OF_STOCK",
])

async function deferNonUrgentWhatsappAlerts(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  accountKey: string,
) {
  const { data: queued, error: queuedError } = await supabase
    .from("alert_delivery_outbox")
    .select("id,commercial_event_id")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("channel", "whatsapp")
    .eq("delivery_class", "immediate")
    .in("status", ["pending", "failed", "dead_letter"])
    .limit(100)
  if (queuedError) throw new Error("COMMERCIAL_WHATSAPP_POLICY_QUEUE_READ_FAILED")
  const eventIds = [...new Set((queued ?? [])
    .map((row) => row.commercial_event_id)
    .filter((id): id is string => typeof id === "string"))]
  if (!eventIds.length) return 0

  const { data: events, error: eventsError } = await supabase
    .from("commercial_alert_events")
    .select("id,event_type")
    .in("id", eventIds)
  if (eventsError) throw new Error("COMMERCIAL_WHATSAPP_POLICY_EVENT_READ_FAILED")
  const immediateEventIds = new Set((events ?? [])
    .filter((event) => IMMEDIATE_WHATSAPP_EVENT_TYPES.has(event.event_type))
    .map((event) => event.id))
  const digestOutboxIds = (queued ?? [])
    .filter((row) => !immediateEventIds.has(row.commercial_event_id))
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string")
  if (!digestOutboxIds.length) return 0

  const { error: deferError } = await supabase
    .from("alert_delivery_outbox")
    .update({
      delivery_class: "digest",
      due_at: nextDigestAt(),
    })
    .eq("delivery_class", "immediate")
    .in("status", ["pending", "failed", "dead_letter"])
    .in("id", digestOutboxIds)
  if (deferError) throw new Error("COMMERCIAL_WHATSAPP_POLICY_DEFER_FAILED")
  return digestOutboxIds.length
}

export async function GET(req: Request) {
  if (!commercialPreviewCronAuthorized(req)) return NextResponse.json(
    {
      success: false,
      error: "CRON_UNAUTHORIZED",
      authorizationHeaders: {
        standardPresent: Boolean(req.headers.get("authorization")),
        dedicatedPresent: Boolean(
          req.headers.get("x-ebay-commercial-authorization"),
        ),
      },
      secretsReturned: false,
    },
    { status: 401 },
  )
  const schedule = getCommercialMonitorScheduleConfiguration()
  if (process.env.VERCEL_ENV !== "preview" || !schedule.enabled) {
    return NextResponse.json({
      success: true,
      status: "disabled",
      schedule,
      safety: { previewOnly: true, productionUnchanged: true },
    })
  }
  if (new URL(req.url).searchParams.get("mode") === "whatsapp-preflight") {
    const preflight = await preflightSellerWhatsAppGateway({ force: true })
    return NextResponse.json({
      success: preflight.success,
      mode: "whatsapp-preflight",
      configuration: getSellerWhatsAppGatewayConfiguration(),
      preflight,
      safety: {
        alertClaimed: false,
        realMessageSent: false,
        providerWriteUsed: false,
        secretsReturned: false,
        productionUnchanged: true,
      },
    })
  }
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return NextResponse.json(
    { success: false, error: "COMMERCIAL_MONITOR_ACCOUNT_SCOPE_REQUIRED" },
    { status: 503 },
  )
  try {
    const supabase = getSupabaseAdminClient()
    const { error: gateError } = await supabase.rpc(
      "require_active_commercial_monitor_scheduler_authorization",
      {
        p_marketplace_account_key: accountKey,
        p_marketplace: "EBAY_US",
      },
    )
    if (gateError) return NextResponse.json({
      success: false,
      error: "COMMERCIAL_MONITOR_SCHEDULER_GATE_REQUIRED",
      safety: {
        alertClaimed: false,
        whatsappAttempted: false,
        productionUnchanged: true,
      },
    }, { status: 423 })
    const { data: heartbeatData, error: heartbeatError } = await supabase.rpc(
      "enqueue_ebay_monitoring_heartbeat_alerts",
      {
        p_marketplace_account_key: accountKey,
        p_marketplace: "EBAY_US",
        p_ebay_stale_minutes: boundedInteger(
          process.env.EBAY_COMMERCIAL_HEARTBEAT_STALE_MINUTES,
          20,
          10,
          1_440,
        ),
        p_luna_stale_minutes: boundedInteger(
          process.env.EBAY_TARGETED_LUNA_HEARTBEAT_STALE_MINUTES,
          45,
          15,
          1_440,
        ),
      },
    )
    const heartbeat = record(heartbeatData)
    if (heartbeatError || !heartbeat) return NextResponse.json({
      success: false,
      error: "COMMERCIAL_MONITOR_HEARTBEAT_RECONCILE_FAILED",
      safety: {
        alertClaimed: false,
        whatsappAttempted: false,
        productionUnchanged: true,
      },
    }, { status: 502 })
    if (heartbeat.status === "BLOCKED_INEXACT_ACTIVE_LISTING_STATE") {
      return NextResponse.json({
        success: false,
        error: "COMMERCIAL_MONITOR_EXACT_ACTIVE_LISTING_STATE_REQUIRED",
        heartbeat,
        safety: {
          alertClaimed: false,
          whatsappAttempted: false,
          productionUnchanged: true,
        },
      }, { status: 423 })
    }
    // Only a confirmed sale or a confirmed exact Luna stock-out is immediate.
    // Reclassify legacy pending rows once; rows already marked digest keep their
    // original due_at so the five-minute cron cannot postpone them forever.
    const deferredNonUrgent = await deferNonUrgentWhatsappAlerts(
      supabase,
      accountKey,
    )
    const result = await dispatchCommercialAlertOutbox(
      supabase,
      {
        marketplaceAccountKey: accountKey,
        workerId: `commercial-dispatch-schedule:${randomUUID()}`,
        // Immediate events remain individual. Due digest events are claimed
        // together and rendered as one WhatsApp summary by the dispatcher.
        limit: 10,
        dryRun: false,
      },
    )
    return NextResponse.json({
      success: true,
      heartbeat,
      result,
      whatsappPolicy: {
        immediateEventTypes: [...IMMEDIATE_WHATSAPP_EVENT_TYPES],
        deferredNonUrgent,
        digestHourUtc: boundedInteger(
          process.env.EBAY_SELLER_WHATSAPP_DIGEST_HOUR_UTC,
          0,
          0,
          23,
        ),
      },
    })
  } catch {
    return NextResponse.json(
      { success: false, error: "COMMERCIAL_ALERT_DISPATCH_CRON_FAILED" },
      { status: 502 },
    )
  }
}
