import { randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  containsPrivateBuyerData,
} from "./commercial-monitor-domain"
import {
  getSellerWhatsAppGatewayConfiguration,
  sendSellerWhatsAppApprovedTemplate,
  type SellerWhatsAppTemplateMessage,
} from "../ebay/ebay-seller-whatsapp-gateway"

type OutboxRow = {
  id: string
  marketplace_account_key: string
  marketplace: string
  channel: string
  delivery_class: "immediate" | "digest"
  severity: "critical" | "high" | "medium" | "low"
  status: string
  payload: Record<string, unknown>
  attempts: number
  due_at: string
}

function text(value: unknown, maximum: number) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum)
}

function priorityLabel(value: OutboxRow["severity"]) {
  if (value === "critical") return "CRÍTICA · actuar ahora"
  if (value === "high") return "ALTA · revisar pronto"
  if (value === "medium") return "RESUMEN · revisar hoy"
  return "SEÑAL INFORMATIVA"
}

export function renderCommercialWhatsAppMessage(row: OutboxRow): SellerWhatsAppTemplateMessage {
  if (containsPrivateBuyerData(row.payload)) {
    throw new Error("COMMERCIAL_ALERT_PRIVATE_BUYER_DATA_BLOCKED")
  }
  return {
    deliveryClass: row.delivery_class === "digest" ? "digest" : "immediate",
    priorityLabel: priorityLabel(row.severity),
    title: text(row.payload.title, 120),
    summary: text(row.payload.summary, 500),
    action: text(row.payload.action, 500),
  }
}

export async function previewCommercialAlertOutbox(
  supabase: SupabaseClient,
  marketplaceAccountKey: string,
  limit = 20,
) {
  const { data, error } = await supabase
    .from("alert_delivery_outbox")
    .select("id,marketplace_account_key,marketplace,channel,delivery_class,severity,status,payload,attempts,due_at")
    .eq("marketplace_account_key", marketplaceAccountKey)
    .eq("channel", "whatsapp")
    .in("status", ["pending", "failed", "dead_letter"])
    .order("due_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 50)))
  if (error) throw new Error("COMMERCIAL_ALERT_PREVIEW_FAILED")
  return ((data ?? []) as OutboxRow[]).map((row) => ({
    id: row.id,
    severity: row.severity,
    status: row.status,
    attempts: row.attempts,
    dueAt: row.due_at,
    message: renderCommercialWhatsAppMessage(row),
  }))
}

export async function dispatchCommercialAlertOutbox(
  supabase: SupabaseClient,
  input: {
    marketplaceAccountKey: string
    workerId?: string
    limit?: number
    dryRun?: boolean
  },
) {
  const configuration = getSellerWhatsAppGatewayConfiguration()
  const previewEnvironment = process.env.VERCEL_ENV === "preview"
  const realDeliveryAllowed = previewEnvironment && configuration.deliveryAttemptAllowed
  if (input.dryRun !== false || !realDeliveryAllowed) {
    return {
      mode: "preview" as const,
      environment: process.env.VERCEL_ENV ?? "development",
      configuration,
      claimed: 0,
      delivered: 0,
      failed: 0,
      previews: await previewCommercialAlertOutbox(
        supabase,
        input.marketplaceAccountKey,
        input.limit,
      ),
      safety: {
        previewOnlyDelivery: true,
        configuredRecipientOnly: true,
        productionDeliveryBlocked: true,
      },
    }
  }

  const workerId = text(input.workerId || `commercial-whatsapp:${randomUUID()}`, 160)
  const { data, error } = await supabase.rpc("claim_alert_delivery_outbox", {
    p_marketplace_account_key: input.marketplaceAccountKey,
    p_channel: "whatsapp",
    p_worker_id: workerId,
    p_limit: Math.max(1, Math.min(input.limit ?? 1, 1)),
    p_lease_seconds: 120,
  })
  if (error) throw new Error("COMMERCIAL_ALERT_CLAIM_FAILED")
  const rows = (data ?? []) as OutboxRow[]
  let delivered = 0
  let failed = 0
  for (const row of rows) {
    let result
    try {
      result = await sendSellerWhatsAppApprovedTemplate(
        renderCommercialWhatsAppMessage(row),
      )
    } catch (error) {
      result = {
        success: false,
        statusCode: null,
        providerMessageId: null,
        errorCode: error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
          ? error.message
          : "COMMERCIAL_ALERT_RENDER_FAILED",
      }
    }
    if (result.success) {
      const { data: completed, error: completeError } = await supabase.rpc(
        "complete_alert_delivery",
        {
          p_outbox_id: row.id,
          p_worker_id: workerId,
          p_provider_message_id: result.providerMessageId,
          p_response_code: result.statusCode === null ? null : String(result.statusCode),
        },
      )
      if (completeError || completed !== true) throw new Error("COMMERCIAL_ALERT_COMPLETE_FAILED")
      delivered += 1
    } else {
      const { data: recorded, error: recordError } = await supabase.rpc(
        "fail_alert_delivery",
        {
          p_outbox_id: row.id,
          p_worker_id: workerId,
          p_error_code: result.errorCode ?? "COMMERCIAL_ALERT_DELIVERY_FAILED",
          p_response_code: result.statusCode === null ? null : String(result.statusCode),
        },
      )
      if (recordError || recorded !== true) throw new Error("COMMERCIAL_ALERT_FAILURE_RECORD_FAILED")
      failed += 1
    }
  }
  return {
    mode: "delivery" as const,
    environment: "preview",
    configuration,
    claimed: rows.length,
    delivered,
    failed,
    safety: {
      previewOnlyDelivery: true,
      configuredRecipientOnly: true,
      productionDeliveryBlocked: true,
    },
  }
}
