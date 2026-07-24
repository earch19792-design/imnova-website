import { randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  containsPrivateBuyerData,
} from "./commercial-monitor-domain"
import {
  getSellerWhatsAppGatewayConfiguration,
  sendSellerWhatsAppApprovedTemplate,
} from "../ebay/ebay-seller-whatsapp-gateway"
import {
  renderCommercialWhatsAppDigest,
  renderCommercialWhatsAppMessage,
  type CommercialWhatsappOutboxRow as OutboxRow,
} from "./commercial-whatsapp-format-domain"

export { renderCommercialWhatsAppMessage } from "./commercial-whatsapp-format-domain"

function text(value: unknown, maximum: number) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum)
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
  return ((data ?? []) as OutboxRow[]).map((row) => {
    if (containsPrivateBuyerData(row.payload)) {
      throw new Error("COMMERCIAL_ALERT_PRIVATE_BUYER_DATA_BLOCKED")
    }
    return {
      id: row.id,
      severity: row.severity,
      status: row.status,
      attempts: row.attempts,
      dueAt: row.due_at,
      message: renderCommercialWhatsAppMessage(row),
    }
  })
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
      metaAccepted: 0,
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
    p_limit: Math.max(1, Math.min(input.limit ?? 10, 10)),
    p_lease_seconds: 120,
  })
  if (error) throw new Error("COMMERCIAL_ALERT_CLAIM_FAILED")
  const rows = (data ?? []) as OutboxRow[]
  let metaAccepted = 0
  let failed = 0
  const immediateRows = rows.filter((row) => row.delivery_class !== "digest")
  const digestRows = rows.filter((row) => row.delivery_class === "digest")

  async function deliverRows(
    deliveryRows: OutboxRow[],
    message: ReturnType<typeof renderCommercialWhatsAppMessage>,
  ) {
    let result
    try {
      if (deliveryRows.some((row) => containsPrivateBuyerData(row.payload))) {
        throw new Error("COMMERCIAL_ALERT_PRIVATE_BUYER_DATA_BLOCKED")
      }
      result = await sendSellerWhatsAppApprovedTemplate(
        message,
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
      for (const row of deliveryRows) {
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
        metaAccepted += 1
      }
    } else {
      for (const row of deliveryRows) {
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
  }

  for (const row of immediateRows) {
    await deliverRows([row], renderCommercialWhatsAppMessage(row))
  }
  if (digestRows.length) {
    await deliverRows(
      digestRows,
      renderCommercialWhatsAppDigest(digestRows),
    )
  }
  return {
    mode: "delivery" as const,
    environment: "preview",
    configuration,
    claimed: rows.length,
    metaAccepted,
    // Meta accepting the template request is not proof that the handset
    // received it. Delivery remains zero until a provider webhook is verified.
    delivered: 0,
    failed,
    whatsappMessagesAttempted: immediateRows.length + (digestRows.length ? 1 : 0),
    safety: {
      previewOnlyDelivery: true,
      configuredRecipientOnly: true,
      productionDeliveryBlocked: true,
    },
  }
}
