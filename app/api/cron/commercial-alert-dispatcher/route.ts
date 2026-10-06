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
import { dispatchSellerOsBuyerThankYouV1 } from
  "@/lib/ebay/ebay-buyer-thank-you-dispatcher-v1"
import { collectSellerOsBuyerThankYouStatusV1 } from
  "@/lib/ebay/ebay-seller-os-assistant-runtime"
import { preflightEbayBuyerMessagingCapabilityV1 } from
  "@/lib/ebay/ebay-post-purchase-buyer-message-v1"
import {
  createUnavailableSellerOsBuyerThankYouPolicyV1,
  readSellerOsBuyerThankYouPolicyV1,
} from "@/lib/ebay/ebay-buyer-thank-you-policy-v1"
import { getSellerOsOperationalRuntimeBoundary } from
  "@/lib/ebay/environment-boundaries"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { sellerOsPostOnlyGetResponseV1 } from
  "@/lib/seller-os/post-only-runtime-route-v1"

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

function safeErrorCode(error: unknown, fallback: string) {
  const value = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]{3,160}$/.test(value) ? value : fallback
}

async function preflightCanonicalBuyerMessaging() {
  const observedAt = new Date().toISOString()
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  const policy = accountKey
    ? await readSellerOsBuyerThankYouPolicyV1(
        getSupabaseAdminClient(),
        accountKey,
        observedAt,
      )
    : createUnavailableSellerOsBuyerThankYouPolicyV1(
        "CANONICAL_SELLER_ACCOUNT_BINDING_UNAVAILABLE",
        observedAt,
      )
  return preflightEbayBuyerMessagingCapabilityV1({ policy })
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

const BUYER_THANK_YOU_CANARY_CONFIRMATION =
  "SEND_ONE_FIXED_EBAY_BUYER_THANK_YOU"

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

export async function POST(req: Request) {
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
  const runtimeBoundary = getSellerOsOperationalRuntimeBoundary()
  if (!runtimeBoundary.authorized) {
    return NextResponse.json({
      success: true,
      status: "disabled",
      schedule,
      safety: {
        previewOnly: runtimeBoundary.historicalPreviewAllowed,
        dedicatedPreprodOnly: runtimeBoundary.dedicatedPreprodAllowed,
        productionUnchanged: true,
      },
    })
  }
  const mode = new URL(req.url).searchParams.get("mode")
  if (mode === "buyer-thank-you-preflight") {
    const buyerMessaging = await preflightCanonicalBuyerMessaging()
    return NextResponse.json({
      success: buyerMessaging.commerceMessageScopeConfirmed &&
        buyerMessaging.accountBindingStatus === "MATCHED" &&
        ["READY", "NOT_ACTIVATED"].includes(buyerMessaging.status),
      mode,
      buyerMessaging,
      safety: {
        alertClaimed: false,
        realMessageSent: false,
        providerWriteUsed: false,
        whatsappPreflightUsed: false,
        secretsReturned: false,
      },
    })
  }
  if (mode === "buyer-thank-you-status") {
    const status = await collectSellerOsBuyerThankYouStatusV1()
    return NextResponse.json({
      success: status.sourceStatus !== "UNAVAILABLE",
      mode,
      status,
      safety: {
        readOnly: true,
        alertClaimed: false,
        realMessageSent: false,
        providerWriteUsed: false,
        buyerMessageSends: 0,
        whatsappAttempted: false,
        secretsReturned: false,
        buyerPiiIncluded: false,
      },
    })
  }
  if (mode === "buyer-thank-you-canary") {
    const confirmed = req.headers.get(
      "x-imnova-buyer-thank-you-canary-confirmation",
    ) === BUYER_THANK_YOU_CANARY_CONFIRMATION
    if (!confirmed) return NextResponse.json({
      success: false,
      error: "BUYER_THANK_YOU_CANARY_CONFIRMATION_REQUIRED",
      requiredConfirmation: BUYER_THANK_YOU_CANARY_CONFIRMATION,
      safety: {
        alertClaimed: false,
        realMessageSent: false,
        providerWriteUsed: false,
        secretsReturned: false,
      },
    }, { status: 428 })
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    if (!accountKey) return NextResponse.json(
      { success: false, error: "COMMERCIAL_MONITOR_ACCOUNT_SCOPE_REQUIRED" },
      { status: 503 },
    )
    const status = await collectSellerOsBuyerThankYouStatusV1()
    const result = await dispatchSellerOsBuyerThankYouV1({
      supabase: getSupabaseAdminClient(),
      accountKey,
      status,
      capability: status.capability,
      workerId: `buyer-thank-you-canary:${randomUUID()}`,
      maximumDispatches: 1,
      executionMode: "PREVIEW_CERTIFICATION_CANARY",
    })
    const oneMessageAccepted = result.buyerMessageSends === 1 &&
      result.accepted === 1
    return NextResponse.json({
      success: oneMessageAccepted,
      mode,
      result,
      certification: {
        fixedTemplateOnly: true,
        callerSelectedRecipient: false,
        maximumMessages: 1,
        durableReceiptRequired: true,
      },
      safety: {
        whatsappAttempted: false,
        secretsReturned: false,
      },
    }, { status: oneMessageAccepted ? 200 : 409 })
  }
  if (mode === "whatsapp-preflight" || mode === "post-sale-preflight") {
    const preflight = await preflightSellerWhatsAppGateway({ force: true })
    const buyerMessaging = mode === "post-sale-preflight"
      ? await preflightCanonicalBuyerMessaging()
      : null
    const buyerMessagingPreflightPassed = buyerMessaging === null || (
      buyerMessaging.commerceMessageScopeConfirmed &&
      buyerMessaging.accountBindingStatus === "MATCHED" &&
      ["READY", "NOT_ACTIVATED"].includes(buyerMessaging.status)
    )
    return NextResponse.json({
      success: preflight.success && buyerMessagingPreflightPassed,
      mode,
      configuration: getSellerWhatsAppGatewayConfiguration(),
      whatsapp: preflight,
      buyerMessaging,
      safety: {
        alertClaimed: false,
        realMessageSent: false,
        providerWriteUsed: false,
        secretsReturned: false,
        productionUnchanged: true,
      },
    })
  }
  const ownerSaleLaneEnabled =
    process.env.EBAY_OWNER_SALE_ALERT_LANE_ENABLED !== "false"
  const buyerThankYouLaneEnabled =
    process.env.EBAY_POST_PURCHASE_THANK_YOU_AUTOMATION_ENABLED !== "false"
  if (!schedule.enabled && !ownerSaleLaneEnabled &&
      !buyerThankYouLaneEnabled) {
    return NextResponse.json({
      success: true,
      status: "disabled",
      schedule,
      safety: {
        previewOnly: runtimeBoundary.historicalPreviewAllowed,
        dedicatedPreprodOnly: runtimeBoundary.dedicatedPreprodAllowed,
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
    let ownerSaleOnly = Boolean(gateError) || !schedule.enabled
    let heartbeat: Record<string, unknown> | null = null
    if (ownerSaleOnly) {
      heartbeat = {
        status: "SKIPPED_FOR_INDEPENDENT_OWNER_SALE_LANE",
        eventsCreated: 0,
        alertsCreated: 0,
        alertsCancelled: 0,
      }
    } else {
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
      heartbeat = record(heartbeatData)
      if (heartbeatError || !heartbeat ||
          heartbeat.status === "BLOCKED_INEXACT_ACTIVE_LISTING_STATE") {
        ownerSaleOnly = true
        heartbeat = {
          status: "SKIPPED_FOR_INDEPENDENT_OWNER_SALE_LANE",
          monitoringState: heartbeat?.status ?? "UNAVAILABLE",
          eventsCreated: 0,
          alertsCreated: 0,
          alertsCancelled: 0,
        }
      }
    }
    // Only a confirmed sale or a confirmed exact Luna stock-out is immediate.
    // Reclassify legacy pending rows once; rows already marked digest keep their
    // original due_at so the five-minute cron cannot postpone them forever.
    const deferredNonUrgent = ownerSaleOnly
      ? 0
      : await deferNonUrgentWhatsappAlerts(supabase, accountKey)
    let result: unknown
    try {
      result = await dispatchCommercialAlertOutbox(
        supabase,
        {
          marketplaceAccountKey: accountKey,
          workerId: `commercial-dispatch-schedule:${randomUUID()}`,
          // Immediate events remain individual. Due digest events are claimed
          // together and rendered as one WhatsApp summary by the dispatcher.
          limit: 10,
          dryRun: false,
          lane: ownerSaleOnly ? "owner_sale" : "all",
        },
      )
    } catch {
      // Sibling isolation: a WhatsApp provider failure must not mutate or
      // replay Dashboard state and must not suppress the independent eBay
      // thank-you step. The result is bounded and contains no provider body.
      result = {
        status: "FAILED",
        error: "WHATSAPP_DISPATCH_FAILED_ISOLATED",
        whatsappMessagesAttempted: null,
      }
    }
    let buyerThankYou: unknown
    if (!buyerThankYouLaneEnabled) {
      buyerThankYou = {
        status: "DISABLED",
        reason: "BUYER_THANK_YOU_OPERATIONAL_KILL_SWITCH_DISABLED",
        marketplaceWrites: 0,
        buyerMessageSends: 0,
      }
    } else try {
      const status = await collectSellerOsBuyerThankYouStatusV1()
      buyerThankYou = await dispatchSellerOsBuyerThankYouV1({
        supabase,
        accountKey,
        status,
        capability: status.capability,
        workerId: `buyer-thank-you:${randomUUID()}`,
      })
    } catch (error) {
      buyerThankYou = {
        status: "FAILED",
        error: safeErrorCode(
          error,
          "BUYER_THANK_YOU_DISPATCH_FAILED_CLOSED",
        ),
        marketplaceWrites: 0,
        buyerMessageSends: 0,
      }
    }
    return NextResponse.json({
      success: true,
      heartbeat,
      result,
      buyerThankYou,
      dispatchLane: ownerSaleOnly ? "owner_sale" : "all",
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
      safety: {
        exactActiveListingStateRequiredForOwnerSaleAlerts: false,
        exactActiveListingStateRequiredForBuyerThankYou: false,
        registryRequiredForBuyerThankYou: false,
        analyticsRequiredForBuyerThankYou: false,
        stockGuardRequiredForBuyerThankYou: false,
        nonSaleAlertsFailClosed: ownerSaleOnly,
        monitoringGateBlocked: Boolean(gateError),
        ebayWriteUsed: Number(record(buyerThankYou)?.buyerMessageSends) > 0,
        secretsReturned: false,
        buyerPiiIncluded: false,
      },
    })
  } catch {
    return NextResponse.json(
      { success: false, error: "COMMERCIAL_ALERT_DISPATCH_CRON_FAILED" },
      { status: 502 },
    )
  }
}

export function GET() {
  return sellerOsPostOnlyGetResponseV1()
}
