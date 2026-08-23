import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  EbayBuyerThankYouDeliveryError,
  SELLER_OS_BUYER_THANK_YOU_STORAGE_ADAPTER_VERSION,
  SELLER_OS_EBAY_BUYER_THANK_YOU_VERSION,
  type SellerOsBuyerThankYouCapabilityV1,
  type SellerOsBuyerThankYouStatusV1,
  prepareEbayBuyerThankYouDispatchV1,
} from "./ebay-post-purchase-buyer-message-v1"

const MARKETPLACE = "EBAY_US"
const EVENT_TYPE = "EBAY_BUYER_THANK_YOU_DELIVERY"
const LEASE_MILLISECONDS = 2 * 60_000
const MAXIMUM_DISPATCHES_PER_RUN = 5
const MAXIMUM_SAFE_RETRIES = 3

type JsonRecord = Record<string, unknown>
type FetchLike = typeof fetch

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function safeWorkerId(value: string) {
  return /^[A-Za-z0-9:_-]{8,160}$/.test(value) ? value : ""
}

function ledgerEvidence(input: Readonly<{
  entry: SellerOsBuyerThankYouStatusV1["entries"][number]
  workflowState: string
  attemptCount: number
  leaseId: string | null
  leaseExpiresAt: string | null
  dispatchStarted: boolean
  receiptStatus?: "ABSENT" | "PRESENT" | "UNKNOWN_OUTCOME"
  providerReferenceDigest?: string | null
  succeededAt?: string | null
  lastErrorCode?: string | null
  manualReviewRequired?: boolean
  observedAt: string
}>) {
  return {
    contractVersion: SELLER_OS_BUYER_THANK_YOU_STORAGE_ADAPTER_VERSION,
    deliveryContractVersion: SELLER_OS_EBAY_BUYER_THANK_YOU_VERSION,
    deliveryKey: input.entry.deliveryKey,
    orderId: input.entry.orderId,
    eventIds: input.entry.eventIds,
    lineItemIds: input.entry.lineItemIds,
    itemIds: input.entry.itemIds,
    templateVersion: input.entry.templateVersion,
    workflowState: input.workflowState,
    attemptCount: input.attemptCount,
    leaseId: input.leaseId,
    leaseExpiresAt: input.leaseExpiresAt,
    dispatchStarted: input.dispatchStarted,
    receiptStatus: input.receiptStatus ?? "ABSENT",
    providerReferenceDigest: input.providerReferenceDigest ?? null,
    succeededAt: input.succeededAt ?? null,
    lastErrorCode: input.lastErrorCode ?? null,
    manualReviewRequired: input.manualReviewRequired ?? false,
    updatedAt: input.observedAt,
    messageGrain: "ONE_BUYER_THANK_YOU_PER_EBAY_ORDER",
    sideEffectClass: "BUYER_MESSAGE_SEND",
    marketplaceWrite: true,
    buyerPiiIncluded: false,
    buyerIdentityIncluded: false,
    rawProviderPayloadIncluded: false,
    credentialsIncluded: false,
  }
}

async function readLedger(
  supabase: SupabaseClient,
  accountKey: string,
  deliveryKey: string,
) {
  const { data, error } = await supabase
    .from("commercial_alert_events")
    .select("id,evidence,created_at")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", MARKETPLACE)
    .eq("event_type", EVENT_TYPE)
    .eq("deduplication_key", deliveryKey)
    .maybeSingle()
  if (error) throw new Error("BUYER_THANK_YOU_LEDGER_READ_FAILED")
  return data as { id: string; evidence: unknown; created_at: string } | null
}

async function reserveNewDelivery(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  entry: SellerOsBuyerThankYouStatusV1["entries"][number]
  leaseId: string
  now: Date
}>) {
  const expiresAt = new Date(input.now.getTime() + LEASE_MILLISECONDS)
    .toISOString()
  const evidence = ledgerEvidence({ entry: input.entry,
    workflowState: "IN_PROGRESS", attemptCount: 1,
    leaseId: input.leaseId, leaseExpiresAt: expiresAt,
    dispatchStarted: false, observedAt: input.now.toISOString() })
  const { data, error } = await input.supabase
    .from("commercial_alert_events")
    .insert({
      marketplace_account_key: input.accountKey,
      marketplace: MARKETPLACE,
      event_type: EVENT_TYPE,
      severity: "low",
      evidence,
      threshold_config_version: SELLER_OS_EBAY_BUYER_THANK_YOU_VERSION,
      detected_at: input.entry.orderCreatedAt,
      listing_id: input.entry.itemIds[0] ?? null,
      sku: null,
      marketplace_order_id: input.entry.orderId,
      marketplace_line_item_id: null,
      deduplication_key: input.entry.deliveryKey,
      recommended_action:
        "Send only the exact approved eBay thank-you once; unknown provider outcomes require manual review.",
    })
    .select("id,evidence,created_at")
    .maybeSingle()
  if (!error && data?.id) return { row: data as {
    id: string; evidence: unknown; created_at: string
  }, databaseWrites: 1, claimed: true }
  if (error?.code !== "23505") {
    throw new Error("BUYER_THANK_YOU_LEDGER_RESERVATION_FAILED")
  }
  const existing = await readLedger(input.supabase, input.accountKey,
    input.entry.deliveryKey)
  if (!existing) throw new Error("BUYER_THANK_YOU_LEDGER_RECOVERY_FAILED")
  return { row: existing, databaseWrites: 0, claimed: false }
}

async function updateLedger(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  rowId: string
  deliveryKey: string
  evidence: JsonRecord
  expectedLeaseId: string
}>) {
  const { data, error } = await input.supabase
    .from("commercial_alert_events")
    .update({ evidence: input.evidence })
    .eq("id", input.rowId)
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", MARKETPLACE)
    .eq("event_type", EVENT_TYPE)
    .eq("deduplication_key", input.deliveryKey)
    .eq("evidence->>leaseId", input.expectedLeaseId)
    .select("id")
    .maybeSingle()
  if (error || !data?.id) throw new Error(
    "BUYER_THANK_YOU_LEDGER_COMPARE_AND_SET_FAILED",
  )
}

function retryableExistingLedger(evidence: JsonRecord, now: Date) {
  if (evidence.workflowState !== "RETRYABLE_FAILURE" ||
      evidence.dispatchStarted === true) return false
  const attempts = Number(evidence.attemptCount)
  return Number.isSafeInteger(attempts) && attempts >= 1 &&
    attempts < MAXIMUM_SAFE_RETRIES &&
    (!evidence.leaseExpiresAt || Date.parse(String(evidence.leaseExpiresAt)) <=
      now.getTime())
}

async function reclaimSafeRetry(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  entry: SellerOsBuyerThankYouStatusV1["entries"][number]
  row: { id: string; evidence: unknown }
  leaseId: string
  now: Date
}>) {
  const previous = record(input.row.evidence)
  if (!retryableExistingLedger(previous, input.now)) {
    return { claimed: false as const, attemptCount: null }
  }
  const attempts = Number(previous.attemptCount) + 1
  const evidence = ledgerEvidence({ entry: input.entry,
    workflowState: "IN_PROGRESS", attemptCount: attempts,
    leaseId: input.leaseId,
    leaseExpiresAt: new Date(input.now.getTime() + LEASE_MILLISECONDS)
      .toISOString(), dispatchStarted: false,
    observedAt: input.now.toISOString() })
  const { data, error } = await input.supabase
    .from("commercial_alert_events")
    .update({ evidence })
    .eq("id", input.row.id)
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", MARKETPLACE)
    .eq("event_type", EVENT_TYPE)
    .eq("deduplication_key", input.entry.deliveryKey)
    .eq("evidence->>workflowState", "RETRYABLE_FAILURE")
    .eq("evidence->>dispatchStarted", "false")
    .select("id,evidence")
    .maybeSingle()
  if (error) throw new Error("BUYER_THANK_YOU_SAFE_RETRY_CLAIM_FAILED")
  return data?.id
    ? { claimed: true as const, attemptCount: attempts }
    : { claimed: false as const, attemptCount: null }
}

/**
 * Write-capable worker boundary. It is never exported through MCP. Only a
 * fixed-account scheduler may call it, and it receives already-derived
 * canonical order-level plans rather than a caller-selected recipient.
 */
export async function dispatchSellerOsBuyerThankYouV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  status: SellerOsBuyerThankYouStatusV1
  capability: SellerOsBuyerThankYouCapabilityV1
  workerId: string
  fetchImpl?: FetchLike
  prepareDispatch?: typeof prepareEbayBuyerThankYouDispatchV1
  now?: () => Date
}>) {
  const workerId = safeWorkerId(input.workerId)
  if (!workerId || !input.accountKey || input.status.sourceStatus ===
      "UNAVAILABLE") throw new Error("BUYER_THANK_YOU_DISPATCH_SCOPE_INVALID")
  if (input.capability.status !== "READY" ||
      !input.capability.deliveryAttemptAllowed ||
      input.capability.automaticExecutionAuthority !==
        "AUTO_EXECUTION_ALLOWED") {
    return Object.freeze({ status: "BLOCKED" as const,
      reason: "BUYER_MESSAGE_CAPABILITY_OR_AUTHORITY_NOT_READY" as const,
      eligibleOrders: input.status.entries.filter((entry) =>
        entry.detectionClass === "NEWLY_DETECTED_AFTER_ACTIVATION").length,
      claimed: 0, attempted: 0, accepted: 0, failed: 0,
      manualReviewRequired: 0, databaseMaintenanceWrites: 0,
      marketplaceWrites: 0, buyerMessageSends: 0,
    })
  }
  const now = input.now ?? (() => new Date())
  const eligible = input.status.entries.filter((entry) =>
    entry.eligibleForBuyerThankYou &&
    entry.detectionClass === "NEWLY_DETECTED_AFTER_ACTIVATION")
    .slice(0, MAXIMUM_DISPATCHES_PER_RUN)
  let claimed = 0
  let attempted = 0
  let accepted = 0
  let failed = 0
  let manualReviewRequired = 0
  let databaseMaintenanceWrites = 0
  for (const entry of eligible) {
    const timestamp = now()
    const leaseId = `${workerId}:${entry.deliveryKey.slice(-24)}`
    const reservation = await reserveNewDelivery({ supabase: input.supabase,
      accountKey: input.accountKey, entry, leaseId, now: timestamp })
    databaseMaintenanceWrites += reservation.databaseWrites
    let ownsClaim = reservation.claimed
    let attemptCount = Number(record(reservation.row.evidence).attemptCount) || 1
    if (!ownsClaim) {
      const reclaimed = await reclaimSafeRetry({ supabase: input.supabase,
        accountKey: input.accountKey, entry, row: reservation.row,
        leaseId, now: timestamp })
      ownsClaim = reclaimed.claimed
      if (reclaimed.attemptCount !== null) {
        attemptCount = reclaimed.attemptCount
      }
      if (ownsClaim) databaseMaintenanceWrites += 1
    }
    if (!ownsClaim) continue
    claimed += 1
    let prepared: Awaited<ReturnType<
      typeof prepareEbayBuyerThankYouDispatchV1
    >>
    try {
      prepared = await (input.prepareDispatch ??
        prepareEbayBuyerThankYouDispatchV1)({
        orderId: entry.orderId,
        expectedLineItemIds: entry.lineItemIds,
        expectedItemIds: entry.itemIds,
        fetchImpl: input.fetchImpl,
        now,
      })
    } catch (error) {
      const failure = error instanceof EbayBuyerThankYouDeliveryError
        ? error : new EbayBuyerThankYouDeliveryError({
          code: "BUYER_THANK_YOU_PRE_DISPATCH_FAILED",
          phase: "PRE_DISPATCH", retrySafe: true,
          acceptanceOutcome: "NOT_ATTEMPTED",
        })
      const evidence = ledgerEvidence({ entry,
        workflowState: failure.retrySafe
          ? "RETRYABLE_FAILURE" : "BLOCKED",
        attemptCount,
        leaseId, leaseExpiresAt: timestamp.toISOString(),
        dispatchStarted: false, receiptStatus: "ABSENT",
        lastErrorCode: failure.code,
        manualReviewRequired: !failure.retrySafe,
        observedAt: timestamp.toISOString() })
      await updateLedger({ supabase: input.supabase,
        accountKey: input.accountKey, rowId: reservation.row.id,
        deliveryKey: entry.deliveryKey, evidence,
        expectedLeaseId: leaseId })
      databaseMaintenanceWrites += 1
      failed += 1
      if (!failure.retrySafe) manualReviewRequired += 1
      continue
    }
    const startedAt = now()
    await updateLedger({ supabase: input.supabase,
      accountKey: input.accountKey, rowId: reservation.row.id,
      deliveryKey: entry.deliveryKey,
      evidence: ledgerEvidence({ entry, workflowState: "IN_PROGRESS",
        attemptCount, leaseId,
        leaseExpiresAt: new Date(startedAt.getTime() + LEASE_MILLISECONDS)
          .toISOString(), dispatchStarted: true,
        observedAt: startedAt.toISOString() }),
      expectedLeaseId: leaseId })
    databaseMaintenanceWrites += 1
    attempted += 1
    try {
      const receipt = await prepared.send()
      await updateLedger({ supabase: input.supabase,
        accountKey: input.accountKey, rowId: reservation.row.id,
        deliveryKey: entry.deliveryKey,
        evidence: ledgerEvidence({ entry, workflowState: "SUCCEEDED",
          attemptCount, leaseId: null, leaseExpiresAt: null,
          dispatchStarted: true, receiptStatus: "PRESENT",
          providerReferenceDigest: receipt.providerReferenceDigest,
          succeededAt: receipt.acceptedAt,
          observedAt: now().toISOString() }),
        expectedLeaseId: leaseId })
      databaseMaintenanceWrites += 1
      accepted += 1
    } catch (error) {
      const failure = error instanceof EbayBuyerThankYouDeliveryError
        ? error : new EbayBuyerThankYouDeliveryError({
          code: "EBAY_BUYER_MESSAGE_ACCEPTANCE_OUTCOME_UNKNOWN",
          phase: "POST_DISPATCH", retrySafe: false,
          acceptanceOutcome: "UNKNOWN",
        })
      const unknown = failure.acceptanceOutcome === "UNKNOWN"
      await updateLedger({ supabase: input.supabase,
        accountKey: input.accountKey, rowId: reservation.row.id,
        deliveryKey: entry.deliveryKey,
        evidence: ledgerEvidence({ entry,
          workflowState: unknown ? "BLOCKED" : "TERMINAL_FAILURE",
          attemptCount, leaseId: null, leaseExpiresAt: null,
          dispatchStarted: true,
          receiptStatus: unknown ? "UNKNOWN_OUTCOME" : "ABSENT",
          lastErrorCode: failure.code,
          manualReviewRequired: true,
          observedAt: now().toISOString() }),
        expectedLeaseId: leaseId })
      databaseMaintenanceWrites += 1
      failed += 1
      manualReviewRequired += 1
    }
  }
  return Object.freeze({
    status: failed ? accepted ? "PARTIAL" as const : "FAILED" as const
      : "AVAILABLE" as const,
    eligibleOrders: eligible.length,
    claimed, attempted, accepted, failed, manualReviewRequired,
    databaseMaintenanceWrites,
    marketplaceWrites: accepted,
    buyerMessageSends: accepted,
    deliverySemantics: "AT_MOST_ONCE_BEST_EFFORT" as const,
    unknownOutcomeAutomaticRetryAllowed: false as const,
    whatsappSends: 0 as const,
    inventoryWrites: 0 as const,
    productCaseMutations: 0 as const,
    lunaLinkMutations: 0 as const,
    paymentTransactions: 0 as const,
  })
}
