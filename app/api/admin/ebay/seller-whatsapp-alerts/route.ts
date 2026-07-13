export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { randomUUID, timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"

import {
  deliverSellerWhatsAppAlerts,
  previewSellerWhatsAppAlerts,
} from "@/lib/ebay/ebay-seller-whatsapp-alerts"
import {
  getSellerWhatsAppGatewayConfiguration,
  getSellerWhatsAppPreflightSnapshot,
  preflightSellerWhatsAppGateway,
} from "@/lib/ebay/ebay-seller-whatsapp-gateway"
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
    const [pending, failed, deadLetter, previews] = await Promise.all([
      supabase
        .from("ebay_seller_alert_outbox")
        .select("id", { count: "exact", head: true })
        .eq("channel", "whatsapp")
        .eq("status", "pending"),
      supabase
        .from("ebay_seller_alert_outbox")
        .select("id", { count: "exact", head: true })
        .eq("channel", "whatsapp")
        .eq("status", "failed"),
      supabase
        .from("ebay_seller_alert_outbox")
        .select("id", { count: "exact", head: true })
        .eq("channel", "whatsapp")
        .eq("status", "dead_letter"),
      previewSellerWhatsAppAlerts(supabase, 10),
    ])
    const firstError = pending.error ?? failed.error ?? deadLetter.error
    if (firstError) throw new Error("SELLER_WHATSAPP_HEALTH_READ_FAILED")
    return NextResponse.json({
      success: true,
      configuration: getSellerWhatsAppGatewayConfiguration(),
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
    : body.action === "preflight"
      ? "preflight"
      : "preview"
  const limitValue = Number(body.limit)
  const limit = Number.isFinite(limitValue)
    ? Math.max(1, Math.min(Math.trunc(limitValue), 50))
    : 20

  try {
    const supabase = getSupabaseAdminClient()
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
