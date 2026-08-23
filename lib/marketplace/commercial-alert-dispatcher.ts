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

export const COMMERCIAL_WHATSAPP_DISPATCH_STARTED_MARKER =
  "META_DISPATCH_STARTED_OUTCOME_UNKNOWN" as const
const COMMERCIAL_WHATSAPP_OUTCOME_UNKNOWN_MANUAL_REVIEW =
  "META_DELIVERY_OUTCOME_UNKNOWN_MANUAL_REVIEW" as const

export function classifyCommercialWhatsappFailureV1(input: Readonly<{
  statusCode: number | null
  errorCode: string | null
  requestDispatched?: boolean
}>) {
  if ([408, 425, 429].includes(input.statusCode ?? 0)) {
    return Object.freeze({ workflowState: "RETRYABLE_FAILURE" as const,
      retryAllowed: true as const, outcomeKnown: true as const,
      storageErrorCode: `META_RETRYABLE_HTTP_${input.statusCode}` })
  }
  if (input.statusCode !== null && input.statusCode >= 400 &&
      input.statusCode < 500) {
    return Object.freeze({ workflowState: "TERMINAL_FAILURE" as const,
      retryAllowed: false as const, outcomeKnown: true as const,
      storageErrorCode: `META_TERMINAL_HTTP_${input.statusCode}` })
  }
  if (input.statusCode !== null && input.statusCode >= 500 &&
      input.statusCode < 600) {
    return Object.freeze({ workflowState: "RETRYABLE_FAILURE" as const,
      retryAllowed: true as const, outcomeKnown: true as const,
      // Deliberately distinct from META_HTTP_5xx: the existing DB safety
      // trigger reserves that code family for indeterminate outcomes.
      storageErrorCode: `META_RETRYABLE_HTTP_${input.statusCode}` })
  }
  if (["META_REQUEST_TIMEOUT", "META_REQUEST_FAILED"].includes(
    input.errorCode ?? "",
  )) {
    if (input.requestDispatched === false) {
      return Object.freeze({ workflowState: "RETRYABLE_FAILURE" as const,
        retryAllowed: true as const, outcomeKnown: true as const,
        storageErrorCode: "META_RETRYABLE_PRE_DISPATCH_FAILURE" })
    }
    return Object.freeze({ workflowState: "TERMINAL_FAILURE" as const,
      retryAllowed: false as const, outcomeKnown: false as const,
      storageErrorCode: input.errorCode ?? "META_REQUEST_FAILED" })
  }
  if ((input.errorCode ?? "").startsWith("SELLER_WHATSAPP_")) {
    return Object.freeze({ workflowState: "BLOCKED" as const,
      retryAllowed: false as const, outcomeKnown: true as const,
      storageErrorCode: input.errorCode ?? "SELLER_WHATSAPP_NOT_READY" })
  }
  return Object.freeze({ workflowState: "RETRYABLE_FAILURE" as const,
    retryAllowed: true as const, outcomeKnown: true as const,
    storageErrorCode: input.errorCode ?? "COMMERCIAL_ALERT_DELIVERY_FAILED" })
}

/**
 * A lease whose outbound Meta request had started is deliberately never
 * reclaimed automatically. The provider has no supported idempotency key, so
 * an expired lease after this durable marker is an indeterminate outcome and
 * must be reviewed instead of risking a duplicate operator notification.
 */
export async function quarantineExpiredCommercialWhatsappDispatchesV1(
  supabase: SupabaseClient,
  marketplaceAccountKey: string,
  observedAt = new Date().toISOString(),
) {
  const { data, error } = await supabase
    .from("alert_delivery_outbox")
    .update({
      status: "dead_letter",
      lease_owner: null,
      lease_expires_at: null,
      last_error_code: COMMERCIAL_WHATSAPP_OUTCOME_UNKNOWN_MANUAL_REVIEW,
      updated_at: observedAt,
    })
    .eq("marketplace_account_key", marketplaceAccountKey)
    .eq("marketplace", "EBAY_US")
    .eq("channel", "whatsapp")
    .eq("status", "leased")
    .eq("last_error_code", COMMERCIAL_WHATSAPP_DISPATCH_STARTED_MARKER)
    .lt("lease_expires_at", observedAt)
    .select("id,attempts")
    .limit(10)
  if (error) {
    throw new Error("COMMERCIAL_ALERT_INDETERMINATE_RECOVERY_FAILED")
  }
  const quarantined = (data ?? []) as Array<{
    id: string
    attempts: number
  }>
  for (const row of quarantined) {
    const { error: attemptError } = await supabase
      .from("alert_delivery_attempts")
      .update({
        status: "failed",
        error_code: COMMERCIAL_WHATSAPP_OUTCOME_UNKNOWN_MANUAL_REVIEW,
        completed_at: observedAt,
      })
      .eq("outbox_id", row.id)
      .eq("attempt_number", row.attempts)
      .eq("channel", "whatsapp")
      .eq("status", "started")
    if (attemptError) {
      throw new Error("COMMERCIAL_ALERT_INDETERMINATE_ATTEMPT_RECOVERY_FAILED")
    }
  }
  return quarantined.length
}

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
      indeterminateClaimsQuarantined: 0,
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
  const indeterminateClaimsQuarantined =
    await quarantineExpiredCommercialWhatsappDispatchesV1(
      supabase,
      input.marketplaceAccountKey,
    )
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
      for (const row of deliveryRows) {
        const markedAt = new Date().toISOString()
        const { data: marked, error: markError } = await supabase
          .from("alert_delivery_outbox")
          .update({
            last_error_code: COMMERCIAL_WHATSAPP_DISPATCH_STARTED_MARKER,
            updated_at: markedAt,
          })
          .eq("id", row.id)
          .eq("marketplace_account_key", input.marketplaceAccountKey)
          .eq("channel", "whatsapp")
          .eq("status", "leased")
          .eq("lease_owner", workerId)
          .select("id")
          .maybeSingle()
        if (markError || !marked?.id) {
          throw new Error("COMMERCIAL_ALERT_DISPATCH_MARKER_FAILED")
        }
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
      const failure = classifyCommercialWhatsappFailureV1({
        statusCode: result.statusCode,
        errorCode: result.errorCode,
      })
      for (const row of deliveryRows) {
        const { data: recorded, error: recordError } = await supabase.rpc(
          "fail_alert_delivery",
          {
            p_outbox_id: row.id,
            p_worker_id: workerId,
            p_error_code: failure.storageErrorCode,
            p_response_code: result.statusCode === null ? null : String(result.statusCode),
          },
        )
        if (recordError || recorded !== true) throw new Error("COMMERCIAL_ALERT_FAILURE_RECORD_FAILED")
        if (!failure.retryAllowed) {
          const { error: terminalError } = await supabase
            .from("alert_delivery_outbox")
            .update({
              status: "dead_letter",
              last_error_code: failure.storageErrorCode,
            })
            .eq("id", row.id)
            .eq("marketplace_account_key", input.marketplaceAccountKey)
            .eq("channel", "whatsapp")
            .eq("status", "failed")
          if (terminalError) {
            throw new Error("COMMERCIAL_ALERT_TERMINAL_FAILURE_RECORD_FAILED")
          }
        }
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
    indeterminateClaimsQuarantined,
    whatsappMessagesAttempted: immediateRows.length + (digestRows.length ? 1 : 0),
    safety: {
      previewOnlyDelivery: true,
      configuredRecipientOnly: true,
      productionDeliveryBlocked: true,
    },
  }
}
