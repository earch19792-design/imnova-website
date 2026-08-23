import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { SellerOsWhatsappDeliveryAuditV1, SellerOsWhatsappDeliveryAuditRowV1 } from "./ebay-whatsapp-sale-alert-v1.ts"

const MAXIMUM_DELIVERIES = 50

type OutboxRow = Readonly<{
  id: string
  deduplication_key: string
  status: string
  attempts: number
  lease_expires_at: string | null
  provider_message_id: string | null
  delivered_at: string | null
  last_error_code: string | null
  created_at: string
  updated_at: string
}>

function providerReferenceDigest(value: string | null) {
  return value
    ? `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`
    : null
}

function safeStatus(value: string): SellerOsWhatsappDeliveryAuditRowV1["status"] | null {
  return ["pending", "leased", "delivered", "failed", "dead_letter",
    "cancelled"].includes(value)
    ? value as SellerOsWhatsappDeliveryAuditRowV1["status"] : null
}

function unavailable(
  observedAt: string,
  code: string,
): SellerOsWhatsappDeliveryAuditV1 {
  return Object.freeze({
    source: "ALERT_DELIVERY_OUTBOX" as const,
    status: "UNAVAILABLE" as const,
    observedAt,
    rows: Object.freeze([]),
    truncated: false,
    limitationCodes: Object.freeze([code]),
  })
}

/**
 * Fixed-account, fixed-table, fixed-column audit read. Delivery keys are
 * derived internally from the bounded canonical Dashboard alert projection;
 * no caller-controlled account, table, filter, SQL, URL or credential enters
 * this repository.
 */
export async function readSellerOsWhatsappSaleAlertAuditV1(
  supabase: SupabaseClient,
  accountKey: string,
  deliveryKeys: readonly string[],
  observedAt = new Date().toISOString(),
): Promise<SellerOsWhatsappDeliveryAuditV1> {
  const keys = [...new Set(deliveryKeys)]
  if (!accountKey || keys.length > MAXIMUM_DELIVERIES || keys.some((key) =>
    !/^commercial-v1:[0-9a-f]{64}$/.test(key))) {
    return unavailable(observedAt, "WHATSAPP_SALE_ALERT_AUDIT_SCOPE_INVALID")
  }
  if (!keys.length) {
    return Object.freeze({
      source: "ALERT_DELIVERY_OUTBOX" as const,
      status: "AVAILABLE" as const,
      observedAt,
      rows: Object.freeze([]),
      truncated: false,
      limitationCodes: Object.freeze([]),
    })
  }
  const outboxKeys = keys.map((key) => `whatsapp:${key}`)
  const { data, error } = await supabase
    .from("alert_delivery_outbox")
    .select("id,deduplication_key,status,attempts,lease_expires_at,provider_message_id,delivered_at,last_error_code,created_at,updated_at")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("channel", "whatsapp")
    .in("deduplication_key", outboxKeys)
    .order("created_at", { ascending: false })
    .limit(MAXIMUM_DELIVERIES + 1)
  if (error) {
    return unavailable(observedAt, "WHATSAPP_SALE_ALERT_AUDIT_READ_FAILED")
  }
  const sourceRows = (data ?? []) as OutboxRow[]
  const truncated = sourceRows.length > MAXIMUM_DELIVERIES
  const rows = sourceRows.slice(0, MAXIMUM_DELIVERIES).flatMap((row) => {
    const status = safeStatus(row.status)
    const prefix = "whatsapp:"
    const deliveryKey = row.deduplication_key.startsWith(prefix)
      ? row.deduplication_key.slice(prefix.length) : ""
    if (!status || !keys.includes(deliveryKey)) return []
    return [Object.freeze({
      deliveryKey,
      outboxId: row.id,
      status,
      attempts: Number.isSafeInteger(row.attempts)
        ? Math.max(0, Math.min(row.attempts, 1_000)) : 0,
      leaseExpiresAt: row.lease_expires_at,
      providerReferenceDigest: providerReferenceDigest(
        row.provider_message_id,
      ),
      deliveredAt: row.delivered_at,
      lastErrorCode: /^[A-Z0-9_]{3,160}$/.test(row.last_error_code ?? "")
        ? row.last_error_code : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })]
  })
  return Object.freeze({
    source: "ALERT_DELIVERY_OUTBOX" as const,
    status: truncated ? "PARTIAL" as const : "AVAILABLE" as const,
    observedAt,
    rows: Object.freeze(rows),
    truncated,
    limitationCodes: Object.freeze(truncated
      ? ["WHATSAPP_SALE_ALERT_AUDIT_RESULT_LIMIT_REACHED"] : []),
  })
}
