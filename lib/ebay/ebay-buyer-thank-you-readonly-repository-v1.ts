import type { SupabaseClient } from "@supabase/supabase-js"

import type {
  SellerOsBuyerThankYouAuditRowV1,
  SellerOsBuyerThankYouAuditV1,
} from "./ebay-post-purchase-buyer-message-v1.ts"

const MAXIMUM_DELIVERIES = 50
const STATES = new Set([
  "NOT_STARTED", "IN_PROGRESS", "SUCCEEDED", "RETRYABLE_FAILURE",
  "TERMINAL_FAILURE", "BLOCKED", "SKIPPED", "NOT_APPLICABLE",
])

type LedgerRow = Readonly<{
  id: string
  deduplication_key: string
  evidence: unknown
  created_at: string
}>

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function safeCode(value: unknown) {
  return typeof value === "string" && /^[A-Z0-9_]{3,160}$/.test(value)
    ? value : null
}

function safeIso(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString() : null
}

function unavailable(
  observedAt: string,
  code: string,
): SellerOsBuyerThankYouAuditV1 {
  return Object.freeze({
    source: "COMMERCIAL_ALERT_EVENTS_BUYER_MESSAGE_LEDGER" as const,
    status: "UNAVAILABLE" as const,
    observedAt,
    rows: Object.freeze([]),
    truncated: false,
    limitationCodes: Object.freeze([code]),
  })
}

/**
 * Fixed-table, fixed-column and fixed-account audit read. Delivery keys are
 * derived internally from canonical sale events; no caller can select an
 * account, table, query, recipient, token, URL or message text.
 */
export async function readSellerOsBuyerThankYouAuditV1(
  supabase: SupabaseClient,
  accountKey: string,
  deliveryKeys: readonly string[],
  observedAt = new Date().toISOString(),
): Promise<SellerOsBuyerThankYouAuditV1> {
  const keys = [...new Set(deliveryKeys)]
  if (!accountKey || keys.length > MAXIMUM_DELIVERIES || keys.some((key) =>
    !/^commercial-v1:[0-9a-f]{64}$/.test(key))) {
    return unavailable(observedAt, "BUYER_THANK_YOU_AUDIT_SCOPE_INVALID")
  }
  if (!keys.length) return Object.freeze({
    source: "COMMERCIAL_ALERT_EVENTS_BUYER_MESSAGE_LEDGER" as const,
    status: "AVAILABLE" as const,
    observedAt,
    rows: Object.freeze([]),
    truncated: false,
    limitationCodes: Object.freeze([]),
  })
  const { data, error } = await supabase
    .from("commercial_alert_events")
    .select("id,deduplication_key,evidence,created_at")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("event_type", "EBAY_BUYER_THANK_YOU_DELIVERY")
    .in("deduplication_key", keys)
    .order("created_at", { ascending: false })
    .limit(MAXIMUM_DELIVERIES + 1)
  if (error) return unavailable(observedAt,
    "BUYER_THANK_YOU_AUDIT_READ_FAILED")
  const sourceRows = (data ?? []) as LedgerRow[]
  const truncated = sourceRows.length > MAXIMUM_DELIVERIES
  const rows = sourceRows.slice(0, MAXIMUM_DELIVERIES).flatMap((row) => {
    const evidence = record(row.evidence)
    const workflowState = typeof evidence.workflowState === "string" &&
        STATES.has(evidence.workflowState)
      ? evidence.workflowState as SellerOsBuyerThankYouAuditRowV1[
        "workflowState"] : null
    const deliveryKey = typeof evidence.deliveryKey === "string" &&
        evidence.deliveryKey === row.deduplication_key &&
        keys.includes(evidence.deliveryKey)
      ? evidence.deliveryKey : null
    if (!workflowState || !deliveryKey) return []
    const receiptStatus = evidence.receiptStatus === "PRESENT" ||
        evidence.receiptStatus === "UNKNOWN_OUTCOME"
      ? evidence.receiptStatus : "ABSENT" as const
    const providerReferenceDigest = typeof evidence.providerReferenceDigest ===
        "string" && /^sha256:[0-9a-f]{64}$/.test(
          evidence.providerReferenceDigest)
      ? evidence.providerReferenceDigest : null
    return [Object.freeze({
      deliveryKey,
      ledgerEventId: row.id,
      workflowState,
      attemptCount: Number.isSafeInteger(evidence.attemptCount)
        ? Math.max(0, Math.min(Number(evidence.attemptCount), 1_000)) : 0,
      dispatchStarted: evidence.dispatchStarted === true,
      leaseExpiresAt: safeIso(evidence.leaseExpiresAt),
      receiptStatus,
      providerReferenceDigest,
      succeededAt: safeIso(evidence.succeededAt),
      lastErrorCode: safeCode(evidence.lastErrorCode),
      manualReviewRequired: evidence.manualReviewRequired === true,
      createdAt: row.created_at,
    })]
  })
  return Object.freeze({
    source: "COMMERCIAL_ALERT_EVENTS_BUYER_MESSAGE_LEDGER" as const,
    status: truncated ? "PARTIAL" as const : "AVAILABLE" as const,
    observedAt,
    rows: Object.freeze(rows),
    truncated,
    limitationCodes: Object.freeze(truncated
      ? ["BUYER_THANK_YOU_AUDIT_RESULT_LIMIT_REACHED"] : []),
  })
}
