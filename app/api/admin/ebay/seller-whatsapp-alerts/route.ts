export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { randomUUID, timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"

import {
  deliverSellerWhatsAppAlerts,
  enqueueSellerWhatsAppAlert,
  previewSellerWhatsAppAlerts,
} from "@/lib/ebay/ebay-seller-whatsapp-alerts"
import {
  getSellerWhatsAppGatewayConfiguration,
  getSellerWhatsAppPreflightSnapshot,
  preflightSellerWhatsAppGateway,
} from "@/lib/ebay/ebay-seller-whatsapp-gateway"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function hasCronAuthorization(req: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? ""
  const authorization = req.headers.get("authorization") ?? ""
  return Boolean(secret && safeEqual(authorization, `Bearer ${secret}`))
}

async function authorize(req: Request) {
  if (hasCronAuthorization(req)) {
    return { ok: true as const, mode: "cron" as const, status: 200, error: null }
  }
  const validation = await validateAdminApiRequest(req)
  return validation.ok
    ? { ok: true as const, mode: "admin" as const, status: 200, error: null }
    : {
        ok: false as const,
        mode: "none" as const,
        status: validation.status || 403,
        error: validation.error ?? "admin_forbidden",
      }
}

async function readBody(req: Request) {
  try {
    const body = await req.json()
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {}
  } catch {
    return null
  }
}

function safeError(error: unknown) {
  const value = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(value)
    ? value
    : "SELLER_WHATSAPP_REQUEST_FAILED"
}

const SELLER_WHATSAPP_TEST_CONFIRMATION =
  "SEND_ONE_SELLER_WHATSAPP_TEST_TO_CONFIGURED_RECIPIENT"

async function deliverControlledPreviewTest(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  authorizationMode: "admin" | "cron",
  confirmation: unknown,
) {
  if (process.env.VERCEL_ENV !== "preview") {
    throw new Error("SELLER_WHATSAPP_TEST_PREVIEW_ONLY")
  }
  if (confirmation !== SELLER_WHATSAPP_TEST_CONFIRMATION) {
    throw new Error("SELLER_WHATSAPP_TEST_CONFIRMATION_REQUIRED")
  }
  const configuration = getSellerWhatsAppGatewayConfiguration()
  if (!configuration.enabled) {
    throw new Error("SELLER_WHATSAPP_DISABLED")
  }
  if (!configuration.configurationComplete) {
    throw new Error("SELLER_WHATSAPP_NOT_READY")
  }

  const accountScope = getEbaySellerAccountScopeConfiguration()
  if (!accountScope.accountKey) {
    throw new Error("SELLER_WHATSAPP_ACCOUNT_SCOPE_REQUIRED")
  }
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1_000).toISOString()
  const pending = await previewSellerWhatsAppAlerts(supabase, 1)
  const recentTests = await supabase
    .from("ebay_seller_alert_outbox")
    .select("id")
    .eq("channel", "whatsapp")
    .eq("payload->>accountKey", accountScope.accountKey)
    .eq("alert_type", "system_test")
    .gte("created_at", fiveMinutesAgo)
    .limit(1)
  if (recentTests.error) {
    throw new Error("SELLER_WHATSAPP_TEST_PREFLIGHT_READ_FAILED")
  }
  if (pending.length > 0) {
    throw new Error("SELLER_WHATSAPP_TEST_QUEUE_NOT_EMPTY")
  }
  if ((recentTests.data?.length ?? 0) > 0) {
    throw new Error("SELLER_WHATSAPP_TEST_RATE_LIMITED")
  }

  const enqueued = await enqueueSellerWhatsAppAlert(supabase, {
    alertType: "system_test",
    entityType: "seller_whatsapp_configuration",
    entityId: `preview-test:${randomUUID()}`,
    title: "Prueba controlada Seller Command Center",
    summary:
      "La API oficial de WhatsApp quedó conectada al flujo de alertas de Seller OS.",
    mobileUrl: process.env.EBAY_SELLER_COMMAND_CENTER_URL,
  })
  if (!enqueued.enqueued) {
    throw new Error("SELLER_WHATSAPP_TEST_ENQUEUE_FAILED")
  }

  const delivered = await deliverSellerWhatsAppAlerts(supabase, {
    workerId: `seller-whatsapp-test:${authorizationMode}:${randomUUID()}`,
    limit: 1,
    dryRun: false,
  })
  if (delivered.mode !== "delivery" || delivered.delivered !== 1) {
    throw new Error("SELLER_WHATSAPP_TEST_DELIVERY_FAILED")
  }
  return {
    success: true,
    mode: "test_delivery" as const,
    enqueued: true,
    delivered: 1,
    failed: delivered.failed,
    safety: {
      configuredRecipientOnly: true,
      approvedTemplateOnly: true,
      outboxAuditUsed: true,
      previewOnly: true,
      ebayWriteUsed: false,
      secretsReturned: false,
    },
  }
}

export async function GET(req: Request) {
  const authorization = await authorize(req)
  if (!authorization.ok) {
    return NextResponse.json(
      { success: false, error: authorization.error },
      { status: authorization.status },
    )
  }

  try {
    const supabase = getSupabaseAdminClient()
    const accountScope = getEbaySellerAccountScopeConfiguration()
    const scopedAccountKey = accountScope.accountKey ?? "__unconfigured__"
    const [pending, failed, deadLetter, previews] = await Promise.all([
      supabase
        .from("ebay_seller_alert_outbox")
        .select("id", { count: "exact", head: true })
        .eq("channel", "whatsapp")
        .eq("payload->>accountKey", scopedAccountKey)
        .eq("status", "pending"),
      supabase
        .from("ebay_seller_alert_outbox")
        .select("id", { count: "exact", head: true })
        .eq("channel", "whatsapp")
        .eq("payload->>accountKey", scopedAccountKey)
        .eq("status", "failed"),
      supabase
        .from("ebay_seller_alert_outbox")
        .select("id", { count: "exact", head: true })
        .eq("channel", "whatsapp")
        .eq("payload->>accountKey", scopedAccountKey)
        .eq("status", "dead_letter"),
      previewSellerWhatsAppAlerts(supabase, 10),
    ])
    const firstError = pending.error ?? failed.error ?? deadLetter.error
    if (firstError) throw new Error("SELLER_WHATSAPP_HEALTH_READ_FAILED")
    return NextResponse.json({
      success: true,
      configuration: getSellerWhatsAppGatewayConfiguration(),
      accountScope: {
        configured: accountScope.configured,
        reason: accountScope.reason,
        accountAlias: accountScope.accountAlias,
      },
      health: {
        pending: pending.count ?? 0,
        failed: failed.count ?? 0,
        deadLetter: deadLetter.count ?? 0,
      },
      previews,
      preflight: getSellerWhatsAppPreflightSnapshot(),
      safety: {
        recipientServerSideOnly: true,
        approvedTemplatesOnly: true,
        secretsReturned: false,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeError(error) },
      { status: 502 },
    )
  }
}

export async function POST(req: Request) {
  const authorization = await authorize(req)
  if (!authorization.ok) {
    return NextResponse.json(
      { success: false, error: authorization.error },
      { status: authorization.status },
    )
  }
  const body = await readBody(req)
  if (!body) {
    return NextResponse.json(
      { success: false, error: "SELLER_WHATSAPP_INVALID_JSON" },
      { status: 400 },
    )
  }
  const action = body.action === "deliver"
    ? "deliver"
    : body.action === "test"
      ? "test"
    : body.action === "preflight"
      ? "preflight"
      : "preview"
  const limitValue = Number(body.limit)
  const limit = Number.isFinite(limitValue)
    ? Math.max(1, Math.min(Math.trunc(limitValue), 50))
    : 20

  try {
    const supabase = getSupabaseAdminClient()
    if (action === "test") {
      return NextResponse.json(await deliverControlledPreviewTest(
        supabase,
        authorization.mode,
        body.confirmation,
      ))
    }
    if (action === "preflight") {
      const preflight = await preflightSellerWhatsAppGateway({
        force: body.force !== false,
      })
      return NextResponse.json({
        success: preflight.success,
        mode: "preflight",
        configuration: getSellerWhatsAppGatewayConfiguration(),
        preflight,
        safety: {
          realMessageSent: false,
          providerWriteUsed: false,
          secretsReturned: false,
          templateContentReturned: false,
        },
      })
    }
    if (action === "preview") {
      return NextResponse.json({
        success: true,
        mode: "preview",
        configuration: getSellerWhatsAppGatewayConfiguration(),
        previews: await previewSellerWhatsAppAlerts(supabase, limit),
        safety: { realMessageSent: false, secretsReturned: false },
      })
    }

    const result = await deliverSellerWhatsAppAlerts(supabase, {
      workerId: `seller-whatsapp:${authorization.mode}:${randomUUID()}`,
      limit,
      dryRun: body.dryRun !== false,
    })
    return NextResponse.json({
      success: true,
      ...result,
      safety: {
        realMessageSent: result.mode === "delivery" && result.delivered > 0,
        approvedTemplatesOnly: true,
        secretsReturned: false,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeError(error) },
      { status: 502 },
    )
  }
}
