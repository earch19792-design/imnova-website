import "server-only"

import { randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  createEbayFulfillmentTrackingAdapter,
  EbayFulfillmentTrackingAdapterError,
  type EbayFulfillmentTrackingAdapter,
} from "../ebay/ebay-fulfillment-tracking-adapter"
import {
  assertEbayFulfillmentTrackingWriterEnabled,
  getEbayFulfillmentTrackingConfiguration,
} from "../ebay/ebay-fulfillment-tracking-oauth"
import { getEbaySellerAccountScopeConfiguration } from "../ebay/ebay-seller-account-scope"
import {
  containsFulfillmentPrivateData,
  fulfillmentIdentityFingerprint,
  sha256Hex,
  type NormalizedTrackingPayload,
} from "./fulfillment-v1a-domain"
import {
  buildEbayShippingFulfillmentRequest,
  canConfirmRemoteAbsence,
  evaluateEbayTrackingPreflight,
  fulfillmentMatchesEbayRequest,
} from "./fulfillment-v1b-domain"

const MARKETPLACE = "EBAY_US"

type TaskRow = {
  id: string
  marketplace_account_key: string
  marketplace: string
  marketplace_order_id: string
  marketplace_line_item_id: string
  listing_id: string
  marketplace_listing_sku: string | null
  supplier_sku: string | null
  supplier_variant_id: string | null
  identity_fingerprint: string | null
  identity_verified_at: string | null
  quantity: number
  workflow_state: string
  lock_version: number
  tracking_payload_hash: string | null
  tracking_approved_at: string | null
  tracking_approval_expires_at: string | null
  current_shipment_id: string | null
}

type ShipmentRow = {
  id: string
  payload_hash: string
  normalized_payload: NormalizedTrackingPayload
  approval_status: string
  approved_at: string | null
  superseded_at: string | null
}

type OutboxRow = {
  id: string
  fulfillment_task_id: string
  shipment_id: string
  marketplace_order_id: string
  payload_hash: string
  approval_context_hash: string | null
  approval_expires_at: string | null
  status: string
  attempts: number
  max_attempts: number
  post_started_at: string | null
  remote_fulfillment_id: string | null
  reconciliation_count: number
}

function accountKey() {
  const value = getEbaySellerAccountScopeConfiguration().accountKey
  if (!value) throw new Error("FULFILLMENT_ACCOUNT_SCOPE_REQUIRED")
  return value
}

function ensureUuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("FULFILLMENT_TASK_ID_INVALID")
  }
  return value
}

function requestKey(value: string) {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9:_-]{8,240}$/.test(normalized)) {
    throw new Error("FULFILLMENT_IDEMPOTENCY_KEY_INVALID")
  }
  return normalized
}

function expectedLockVersion(value: unknown) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("FULFILLMENT_LOCK_VERSION_INVALID")
  }
  return parsed
}

function safeActor(value: string | null | undefined) {
  return value?.trim().slice(0, 160) || "admin"
}

function safeCode(error: unknown, fallback = "FULFILLMENT_REAL_ADAPTER_FAILED") {
  const value = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]{3,180}$/.test(value) ? value : fallback
}

function localIdentityFingerprint(task: TaskRow) {
  return fulfillmentIdentityFingerprint({
    marketplaceAccountKey: task.marketplace_account_key,
    marketplace: task.marketplace,
    orderId: task.marketplace_order_id,
    lineItemId: task.marketplace_line_item_id,
    listingId: task.listing_id,
    marketplaceListingSku: task.marketplace_listing_sku ?? undefined,
    supplierSku: task.supplier_sku ?? undefined,
    supplierVariantId: task.supplier_variant_id ?? undefined,
    quantity: task.quantity,
  })
}

function assertTaskIdentity(task: TaskRow) {
  const calculated = localIdentityFingerprint(task)
  if (!task.identity_verified_at || task.identity_fingerprint !== calculated) {
    throw new Error("FULFILLMENT_IDENTITY_MISMATCH")
  }
  return calculated
}

function approvalContextHash(
  tasks: TaskRow[],
  payloadHash: string,
  writtenConsentReferenceHash: string,
) {
  const identities = tasks.map(assertTaskIdentity).sort()
  return `sha256:${sha256Hex([
    payloadHash,
    writtenConsentReferenceHash,
    ...identities,
  ].join("\u001f"))}`
}

async function loadTask(supabase: SupabaseClient, taskId: string) {
  const { data, error } = await supabase.from("fulfillment_tasks")
    .select("id,marketplace_account_key,marketplace,marketplace_order_id,marketplace_line_item_id,listing_id,marketplace_listing_sku,supplier_sku,supplier_variant_id,identity_fingerprint,identity_verified_at,quantity,workflow_state,lock_version,tracking_payload_hash,tracking_approved_at,tracking_approval_expires_at,current_shipment_id")
    .eq("id", ensureUuid(taskId)).eq("marketplace_account_key", accountKey())
    .eq("marketplace", MARKETPLACE).maybeSingle()
  if (error) throw new Error("FULFILLMENT_TASK_READ_FAILED")
  if (!data) throw new Error("FULFILLMENT_TASK_NOT_FOUND")
  return data as TaskRow
}

async function loadOrderTasks(supabase: SupabaseClient, task: TaskRow) {
  const { data, error } = await supabase.from("fulfillment_tasks")
    .select("id,marketplace_account_key,marketplace,marketplace_order_id,marketplace_line_item_id,listing_id,marketplace_listing_sku,supplier_sku,supplier_variant_id,identity_fingerprint,identity_verified_at,quantity,workflow_state,lock_version,tracking_payload_hash,tracking_approved_at,tracking_approval_expires_at,current_shipment_id")
    .eq("marketplace_account_key", task.marketplace_account_key)
    .eq("marketplace", task.marketplace)
    .eq("marketplace_order_id", task.marketplace_order_id)
    .order("marketplace_line_item_id")
  if (error || !data?.length) throw new Error("FULFILLMENT_ORDER_TASKS_READ_FAILED")
  return data as TaskRow[]
}

async function loadShipment(
  supabase: SupabaseClient,
  shipmentId: string | null,
  payloadHash: string,
) {
  if (!shipmentId) throw new Error("FULFILLMENT_SHIPMENT_NOT_APPROVABLE")
  const { data, error } = await supabase.from("marketplace_fulfillment_shipments")
    .select("id,payload_hash,normalized_payload,approval_status,approved_at,superseded_at")
    .eq("id", shipmentId).eq("payload_hash", payloadHash).maybeSingle()
  if (error || !data || data.superseded_at) throw new Error("FULFILLMENT_SHIPMENT_NOT_APPROVABLE")
  if (containsFulfillmentPrivateData(data.normalized_payload)) {
    throw new Error("FULFILLMENT_PRIVATE_DATA_BLOCKED")
  }
  return data as ShipmentRow
}

async function loadBundle(
  supabase: SupabaseClient,
  outbox: OutboxRow,
  writtenConsentReferenceHash: string,
) {
  const task = await loadTask(supabase, outbox.fulfillment_task_id)
  const tasks = await loadOrderTasks(supabase, task)
  const shipment = await loadShipment(supabase, outbox.shipment_id, outbox.payload_hash)
  const contextHash = approvalContextHash(
    tasks,
    outbox.payload_hash,
    writtenConsentReferenceHash,
  )
  return { task, tasks, shipment, contextHash }
}

function expectedLines(tasks: TaskRow[]) {
  return tasks.map((task) => ({
    lineItemId: task.marketplace_line_item_id,
    listingId: task.listing_id,
    marketplaceListingSku: task.marketplace_listing_sku ?? "",
    supplierSku: task.supplier_sku ?? "",
    quantity: task.quantity,
  }))
}

function safety(ebayWrites = 0) {
  return {
    previewOnly: true,
    dedicatedWriteTokenOnly: true,
    readonlyOrdersTokenFallbackUsed: false,
    buyerPiiReturned: false,
    rawEbayPayloadStored: false,
    cardDataStored: false,
    whatsappSent: 0,
    ebayWrites,
  }
}

export function getMarketplaceFulfillmentV1BReadiness() {
  const configuration = getEbayFulfillmentTrackingConfiguration()
  return {
    adapter: "ebay_real" as const,
    executable: configuration.executable,
    flags: configuration.flags,
    token: configuration.token,
    requiredScope: configuration.requiredScope,
    identityBound: configuration.identityBound,
    trackingWriteReadiness: configuration.executable
      ? "API_TRACKING_WRITE_READY" as const
      : "MANUAL_SELLER_HUB_TRACKING_REQUIRED" as const,
    writtenConsentReference: configuration.writtenConsentReference,
    writtenConsentReferenceExposed: false as const,
    cronConfigured: false as const,
    safety: safety(),
  }
}

export async function approveMarketplaceFulfillmentTrackingReal(
  supabase: SupabaseClient,
  taskId: string,
  input: Record<string, unknown>,
  actorId: string | null | undefined,
  idempotencyKey: string,
) {
  const configuration = assertEbayFulfillmentTrackingWriterEnabled()
  const writtenConsentReferenceHash = configuration.writtenConsentReferenceHash
  if (!writtenConsentReferenceHash) throw new Error("EBAY_FULFILLMENT_WRITTEN_CONSENT_REQUIRED")
  if (input.confirmed !== true || input.submissionMode !== "ebay_real") {
    throw new Error("FULFILLMENT_REAL_EXPLICIT_APPROVAL_REQUIRED")
  }
  const task = await loadTask(supabase, taskId)
  const tasks = await loadOrderTasks(supabase, task)
  for (const sibling of tasks) assertTaskIdentity(sibling)
  if (typeof input.payloadHash !== "string" || input.payloadHash !== task.tracking_payload_hash) {
    throw new Error("FULFILLMENT_APPROVAL_PAYLOAD_MISMATCH")
  }
  await loadShipment(supabase, task.current_shipment_id, input.payloadHash)
  const contextHash = approvalContextHash(
    tasks,
    input.payloadHash,
    writtenConsentReferenceHash,
  )
  const { data, error } = await supabase.rpc("approve_fulfillment_tracking_v1b", {
    p_task_id: task.id,
    p_expected_lock_version: expectedLockVersion(input.lockVersion),
    p_payload_hash: input.payloadHash,
    p_approval_context_hash: contextHash,
    p_actor_id: safeActor(actorId),
    p_idempotency_key: requestKey(idempotencyKey),
  })
  if (error) throw new Error(safeCode(error, "FULFILLMENT_REAL_APPROVAL_FAILED"))
  return {
    submission: data,
    approvedPayloadHash: input.payloadHash,
    adapter: "ebay_real" as const,
    directMarketplaceCall: false as const,
    writtenConsentReferenceBound: true as const,
    writtenConsentReferenceExposed: false as const,
    safety: safety(),
  }
}

async function recordOutcome(
  supabase: SupabaseClient,
  input: {
    outboxId: string
    workerId: string
    outcome: string
    code: string
    httpStatus?: number | null
    remoteId?: string | null
    locationPath?: string | null
    postStarted?: boolean
  },
) {
  const { data, error } = await supabase.rpc("record_fulfillment_real_outcome_v1b", {
    p_outbox_id: input.outboxId,
    p_worker_id: input.workerId,
    p_outcome: input.outcome,
    p_code: input.code,
    p_http_status: input.httpStatus ?? null,
    p_remote_fulfillment_id: input.remoteId ?? null,
    p_remote_location_path: input.locationPath ?? null,
    p_post_started: input.postStarted ?? false,
  })
  if (error) throw new Error("FULFILLMENT_REAL_OUTCOME_WRITE_FAILED")
  return data
}

async function runClaim(
  supabase: SupabaseClient,
  claim: OutboxRow,
  workerId: string,
  adapter: EbayFulfillmentTrackingAdapter,
  writtenConsentReferenceHash: string,
) {
  let postStarted = false
  try {
    const bundle = await loadBundle(
      supabase,
      claim,
      writtenConsentReferenceHash,
    )
    if (claim.approval_context_hash !== bundle.contextHash) {
      return recordOutcome(supabase, {
        outboxId: claim.id, workerId, outcome: "blocked",
        code: "FULFILLMENT_IDENTITY_MISMATCH",
      })
    }
    const request = buildEbayShippingFulfillmentRequest(bundle.shipment.normalized_payload)
    const [order, fulfillments] = await Promise.all([
      adapter.getOrder(claim.marketplace_order_id),
      adapter.getShippingFulfillments(claim.marketplace_order_id),
    ])
    const preflight = evaluateEbayTrackingPreflight({
      order,
      fulfillments,
      expectedOrderId: claim.marketplace_order_id,
      expectedLines: expectedLines(bundle.tasks),
      supplierIdentityValid: true,
      identityFingerprint: claim.approval_context_hash,
      expectedIdentityFingerprint: bundle.contextHash,
      currentPayloadHash: bundle.task.tracking_payload_hash,
      approvedPayloadHash: claim.payload_hash,
      approvedAt: bundle.task.tracking_approved_at,
      request,
    })
    if (preflight.status === "BLOCKED") {
      return recordOutcome(supabase, {
        outboxId: claim.id, workerId, outcome: "blocked",
        code: `FULFILLMENT_${preflight.code}`,
      })
    }
    if (preflight.status === "EXISTING_MATCH") {
      return recordOutcome(supabase, {
        outboxId: claim.id, workerId, outcome: "existing_match",
        code: "EBAY_EXISTING_FULFILLMENT_RECOGNIZED",
        remoteId: preflight.existingFulfillmentId,
      })
    }
    postStarted = true
    const created = await adapter.createShippingFulfillment(claim.marketplace_order_id, request)
    if (!created.fulfillmentId) {
      return recordOutcome(supabase, {
        outboxId: claim.id, workerId, outcome: "accepted_pending_reconciliation",
        code: "EBAY_201_LOCATION_UNAVAILABLE", httpStatus: 201,
        locationPath: created.locationPath, postStarted: true,
      })
    }
    try {
      const remote = await adapter.getShippingFulfillment(
        claim.marketplace_order_id,
        created.fulfillmentId,
      )
      if (!fulfillmentMatchesEbayRequest(remote, request)) {
        return recordOutcome(supabase, {
          outboxId: claim.id, workerId, outcome: "accepted_pending_reconciliation",
          code: "EBAY_201_FULFILLMENT_MISMATCH", httpStatus: 201,
          remoteId: created.fulfillmentId, locationPath: created.locationPath,
          postStarted: true,
        })
      }
      return recordOutcome(supabase, {
        outboxId: claim.id, workerId, outcome: "reconciled_success",
        code: "EBAY_201_RECONCILED", httpStatus: 201,
        remoteId: created.fulfillmentId, locationPath: created.locationPath,
        postStarted: true,
      })
    } catch {
      return recordOutcome(supabase, {
        outboxId: claim.id, workerId, outcome: "accepted_pending_reconciliation",
        code: "EBAY_201_RECONCILIATION_PENDING", httpStatus: 201,
        remoteId: created.fulfillmentId, locationPath: created.locationPath,
        postStarted: true,
      })
    }
  } catch (error) {
    if (error instanceof EbayFulfillmentTrackingAdapterError) {
      return recordOutcome(supabase, {
        outboxId: claim.id,
        workerId,
        outcome: error.category === "AMBIGUOUS"
          ? "ambiguous"
          : error.category === "TEMPORARY_BEFORE_POST"
            ? "temporary_before_post"
            : "permanent",
        code: safeCode(error),
        httpStatus: error.httpStatus,
        postStarted: error.postStarted || postStarted,
      })
    }
    return recordOutcome(supabase, {
      outboxId: claim.id, workerId, outcome: postStarted ? "ambiguous" : "temporary_before_post",
      code: safeCode(error), postStarted,
    })
  }
}

export async function runMarketplaceFulfillmentRealSubmitter(
  supabase: SupabaseClient,
  options: {
    workerId?: string
    limit?: number
    adapterFactory?: () => Promise<EbayFulfillmentTrackingAdapter>
  } = {},
) {
  const configuration = assertEbayFulfillmentTrackingWriterEnabled()
  const writtenConsentReferenceHash = configuration.writtenConsentReferenceHash
  if (!writtenConsentReferenceHash) throw new Error("EBAY_FULFILLMENT_WRITTEN_CONSENT_REQUIRED")
  const workerId = options.workerId ?? `fulfillment-ebay-real:${randomUUID()}`
  const { data, error } = await supabase.rpc("claim_fulfillment_real_submissions_v1b", {
    p_worker_id: workerId,
    p_limit: Math.max(1, Math.min(options.limit ?? 5, 25)),
    p_lease_seconds: 120,
  })
  if (error) throw new Error("FULFILLMENT_REAL_SUBMISSION_CLAIM_FAILED")
  const claims = (data ?? []) as OutboxRow[]
  if (!claims.length) return { status: "completed", processed: 0, ebayWrites: 0, safety: safety() }
  const adapter = await (options.adapterFactory?.() ?? createEbayFulfillmentTrackingAdapter())
  const outcomes = []
  let ebayWrites = 0
  for (const claim of claims) {
    const before = claim.post_started_at
    const outcome = await runClaim(
      supabase,
      claim,
      workerId,
      adapter,
      writtenConsentReferenceHash,
    )
    if (!before && outcome?.post_started_at) ebayWrites += 1
    outcomes.push({ id: claim.id, status: outcome?.status ?? null })
  }
  return { status: "completed", processed: outcomes.length, outcomes, ebayWrites, safety: safety(ebayWrites) }
}

async function recordReconciliation(
  supabase: SupabaseClient,
  input: { outboxId: string; workerId: string; outcome: string; code: string; remoteId?: string | null },
) {
  const { data, error } = await supabase.rpc("record_fulfillment_real_reconciliation_v1b", {
    p_outbox_id: input.outboxId,
    p_worker_id: input.workerId,
    p_outcome: input.outcome,
    p_code: input.code,
    p_remote_fulfillment_id: input.remoteId ?? null,
  })
  if (error) throw new Error("FULFILLMENT_REAL_RECONCILIATION_WRITE_FAILED")
  return data
}

export async function runMarketplaceFulfillmentRealReconciler(
  supabase: SupabaseClient,
  options: {
    workerId?: string
    limit?: number
    adapterFactory?: () => Promise<EbayFulfillmentTrackingAdapter>
    now?: number
  } = {},
) {
  const configuration = assertEbayFulfillmentTrackingWriterEnabled()
  const writtenConsentReferenceHash = configuration.writtenConsentReferenceHash
  if (!writtenConsentReferenceHash) throw new Error("EBAY_FULFILLMENT_WRITTEN_CONSENT_REQUIRED")
  const workerId = options.workerId ?? `fulfillment-ebay-reconciler:${randomUUID()}`
  const { data, error } = await supabase.rpc("claim_fulfillment_real_reconciliation_v1b", {
    p_worker_id: workerId,
    p_limit: Math.max(1, Math.min(options.limit ?? 10, 50)),
    p_lease_seconds: 120,
  })
  if (error) throw new Error("FULFILLMENT_REAL_RECONCILIATION_CLAIM_FAILED")
  const claims = (data ?? []) as OutboxRow[]
  if (!claims.length) return { status: "completed", reconciled: 0, secondPosts: 0, ebayWrites: 0, safety: safety() }
  const adapter = await (options.adapterFactory?.() ?? createEbayFulfillmentTrackingAdapter())
  const outcomes = []
  for (const claim of claims) {
    try {
      const bundle = await loadBundle(
        supabase,
        claim,
        writtenConsentReferenceHash,
      )
      const request = buildEbayShippingFulfillmentRequest(bundle.shipment.normalized_payload)
      if (claim.remote_fulfillment_id) {
        try {
          const remote = await adapter.getShippingFulfillment(
            claim.marketplace_order_id,
            claim.remote_fulfillment_id,
          )
          if (fulfillmentMatchesEbayRequest(remote, request)) {
            const result = await recordReconciliation(supabase, {
              outboxId: claim.id, workerId, outcome: "existing_match",
              code: "EBAY_EXISTING_FULFILLMENT_RECOGNIZED",
              remoteId: remote.fulfillmentId,
            })
            outcomes.push({ id: claim.id, status: result?.status ?? null })
            continue
          }
        } catch {
          // Fall through to the full order fulfillment collection.
        }
      }
      const [order, fulfillments] = await Promise.all([
        adapter.getOrder(claim.marketplace_order_id),
        adapter.getShippingFulfillments(claim.marketplace_order_id),
      ])
      const preflight = evaluateEbayTrackingPreflight({
        order,
        fulfillments,
        expectedOrderId: claim.marketplace_order_id,
        expectedLines: expectedLines(bundle.tasks),
        supplierIdentityValid: true,
        identityFingerprint: claim.approval_context_hash,
        expectedIdentityFingerprint: bundle.contextHash,
        currentPayloadHash: bundle.task.tracking_payload_hash,
        approvedPayloadHash: claim.payload_hash,
        approvedAt: bundle.task.tracking_approved_at,
        enforceApprovalFreshness: false,
        request,
      })
      if (preflight.status === "EXISTING_MATCH") {
        const result = await recordReconciliation(supabase, {
          outboxId: claim.id, workerId, outcome: "existing_match",
          code: "EBAY_EXISTING_FULFILLMENT_RECOGNIZED",
          remoteId: preflight.existingFulfillmentId,
        })
        outcomes.push({ id: claim.id, status: result?.status ?? null })
      } else if (preflight.status === "BLOCKED") {
        const result = await recordReconciliation(supabase, {
          outboxId: claim.id, workerId, outcome: "blocked",
          code: `FULFILLMENT_${preflight.code}`,
        })
        outcomes.push({ id: claim.id, status: result?.status ?? null })
      } else {
        const now = options.now ?? Date.now()
        const absenceProven = canConfirmRemoteAbsence({
          reconciliationCount: claim.reconciliation_count,
          postStartedAt: claim.post_started_at,
          now,
        })
        const result = await recordReconciliation(supabase, {
          outboxId: claim.id,
          workerId,
          outcome: absenceProven ? "absent" : "temporary",
          code: absenceProven
            ? "EBAY_FULFILLMENT_ABSENCE_CONFIRMED"
            : "EBAY_FULFILLMENT_EVENTUAL_CONSISTENCY_WAIT",
        })
        outcomes.push({ id: claim.id, status: result?.status ?? null })
      }
    } catch (error) {
      const result = await recordReconciliation(supabase, {
        outboxId: claim.id, workerId, outcome: "temporary",
        code: safeCode(error, "EBAY_FULFILLMENT_RECONCILIATION_READ_FAILED"),
      })
      outcomes.push({ id: claim.id, status: result?.status ?? null })
    }
  }
  return {
    status: "completed",
    reconciled: outcomes.length,
    outcomes,
    secondPosts: 0,
    ebayWrites: 0,
    safety: safety(),
  }
}
