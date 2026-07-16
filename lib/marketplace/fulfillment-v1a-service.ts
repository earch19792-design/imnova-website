import { randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { getEbaySellerAccountScopeConfiguration } from "../ebay/ebay-seller-account-scope"
import { getEbayFulfillmentOrderGuard } from "../ebay/ebay-commercial-readers"
import {
  containsFulfillmentPrivateData,
  fulfillmentIdentityFingerprint,
  FULFILLMENT_SIMULATION_SCENARIOS,
  isAllowedLunaProductUrl,
  normalizePurchaseConfirmation,
  normalizeTrackingPayload,
  simulateMarketplaceFulfillmentSubmission,
  type FulfillmentSimulationScenario,
  type ShipmentItemInput,
} from "./fulfillment-v1a-domain"

const MARKETPLACE = "EBAY_US"
const STAGING_REF = "vsfthqydfrdzulldbfbe"

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
  product_title: string
  quantity: number
  workflow_state: string
  lock_version: number
  priority: number
  next_action_at: string | null
  last_error_code: string | null
  source_product_url: string | null
  seller_order_url: string | null
  supplier_unit_cost: number | null
  estimated_supplier_cost: number | null
  estimated_profit: number | null
  stock_available: number | null
  ship_by_at: string | null
  purchase_confirmed_at: string | null
  tracking_approved_at: string | null
  tracking_payload_hash: string | null
  current_shipment_id: string | null
  created_at: string
  updated_at: string
}

function enabled(name: string) {
  return process.env[name]?.trim().toLowerCase() === "true"
}

function stagingUrlMatches() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ""
  try {
    return new URL(value).hostname === `${STAGING_REF}.supabase.co`
  } catch {
    return false
  }
}

export function getMarketplaceFulfillmentV1AConfiguration() {
  const preview = process.env.VERCEL_ENV === "preview"
  const staging = stagingUrlMatches()
  const writeEnabled = enabled("EBAY_FULFILLMENT_TRACKING_WRITE_ENABLED")
  const realSubmitterEnabled = enabled("MARKETPLACE_FULFILLMENT_SUBMITTER_ENABLED")
  return {
    preview,
    staging,
    uiEnabled: preview && staging && enabled("MARKETPLACE_FULFILLMENT_UI_ENABLED"),
    simulatorEnabled: preview && staging && enabled("MARKETPLACE_FULFILLMENT_SIMULATOR_ENABLED"),
    realSubmitterEnabled,
    ebayTrackingWriteEnabled: writeEnabled,
    adapter: "simulated" as const,
    safetyReady: preview && staging && !writeEnabled && !realSubmitterEnabled,
    productionBlocked: !preview,
    ebayWrites: 0,
  }
}

function assertPreviewStaging() {
  const config = getMarketplaceFulfillmentV1AConfiguration()
  if (!config.preview || !config.staging) throw new Error("FULFILLMENT_V1A_PREVIEW_STAGING_ONLY")
  if (config.ebayTrackingWriteEnabled || config.realSubmitterEnabled) {
    throw new Error("FULFILLMENT_V1A_REAL_WRITER_MUST_REMAIN_DISABLED")
  }
  return config
}

function accountKey() {
  const value = getEbaySellerAccountScopeConfiguration().accountKey
  if (!value) throw new Error("FULFILLMENT_ACCOUNT_SCOPE_REQUIRED")
  return value
}

function idempotencyKey(value: unknown) {
  if (typeof value !== "string") throw new Error("FULFILLMENT_IDEMPOTENCY_KEY_REQUIRED")
  const normalized = value.trim()
  if (!/^[A-Za-z0-9:_-]{8,240}$/.test(normalized)) {
    throw new Error("FULFILLMENT_IDEMPOTENCY_KEY_INVALID")
  }
  return normalized
}

function lockVersion(value: unknown) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("FULFILLMENT_LOCK_VERSION_INVALID")
  return parsed
}

function safeActor(value: string | null | undefined) {
  return value?.slice(0, 160) || "admin"
}

function ensureUuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("FULFILLMENT_TASK_ID_INVALID")
  }
  return value
}

async function loadTask(supabase: SupabaseClient, taskId: string) {
  const { data, error } = await supabase.from("fulfillment_tasks")
    .select("id,marketplace_account_key,marketplace,marketplace_order_id,marketplace_line_item_id,listing_id,marketplace_listing_sku,supplier_sku,supplier_variant_id,identity_fingerprint,identity_verified_at,product_title,quantity,workflow_state,lock_version,priority,next_action_at,last_error_code,source_product_url,seller_order_url,supplier_unit_cost,estimated_supplier_cost,estimated_profit,stock_available,ship_by_at,purchase_confirmed_at,tracking_approved_at,tracking_payload_hash,current_shipment_id,created_at,updated_at")
    .eq("id", ensureUuid(taskId))
    .eq("marketplace_account_key", accountKey())
    .eq("marketplace", MARKETPLACE)
    .maybeSingle()
  if (error) throw new Error("FULFILLMENT_TASK_READ_FAILED")
  if (!data) throw new Error("FULFILLMENT_TASK_NOT_FOUND")
  return data as TaskRow
}

function assertTaskIdentity(task: TaskRow) {
  const calculated = fulfillmentIdentityFingerprint({
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
  if (!task.identity_verified_at || task.identity_fingerprint !== calculated) {
    throw new Error("FULFILLMENT_IDENTITY_MISMATCH")
  }
  return calculated
}

function safety() {
  return {
    previewOnly: true,
    stagingRef: STAGING_REF,
    buyerPiiReturned: false,
    cardDataStored: false,
    whatsappSent: 0,
    ebayWrites: 0,
    realMarketplaceAdapterPresent: false,
  }
}

function allowlistedExternalUrl(value: unknown, domain: "luna" | "ebay") {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password) return null
    const allowed = domain === "luna"
      ? url.hostname === "lunaportex.com" || url.hostname.endsWith(".lunaportex.com")
      : url.hostname === "ebay.com" || url.hostname.endsWith(".ebay.com")
    return allowed ? url.toString() : null
  } catch {
    return null
  }
}

export async function getMarketplaceFulfillmentDashboard(supabase: SupabaseClient) {
  const config = getMarketplaceFulfillmentV1AConfiguration()
  if (!config.uiEnabled) return { enabled: false, config, tasks: [], safety: safety() }
  const scopedAccount = accountKey()
  const { data: tasks, error: taskError } = await supabase.from("fulfillment_tasks")
    .select("id,marketplace_order_id,marketplace_line_item_id,listing_id,marketplace_listing_sku,supplier_sku,supplier_variant_id,product_title,quantity,workflow_state,lock_version,priority,next_action_at,last_error_code,source_product_url,seller_order_url,supplier_unit_cost,estimated_supplier_cost,estimated_profit,stock_available,ship_by_at,purchase_confirmed_at,tracking_approved_at,tracking_payload_hash,current_shipment_id,created_at,updated_at")
    .eq("marketplace_account_key", scopedAccount).eq("marketplace", MARKETPLACE)
    .order("priority", { ascending: true }).order("ship_by_at", { ascending: true, nullsFirst: false }).limit(200)
  if (taskError) throw new Error("FULFILLMENT_QUEUE_READ_FAILED")
  const safeTasks = (tasks ?? []).map((task) => ({
    ...task,
    source_product_url: allowlistedExternalUrl(task.source_product_url, "luna"),
    seller_order_url: allowlistedExternalUrl(task.seller_order_url, "ebay"),
  }))
  const taskIds = safeTasks.map((task) => task.id)
  const [events, purchases, shipments, outbox] = await Promise.all([
    taskIds.length
      ? supabase.from("fulfillment_task_events").select("id,fulfillment_task_id,sequence_number,event_type,from_state,to_state,actor_type,evidence,occurred_at").in("fulfillment_task_id", taskIds).order("sequence_number", { ascending: false }).limit(1000)
      : Promise.resolve({ data: [], error: null }),
    taskIds.length
      ? supabase.from("supplier_purchase_orders").select("id,fulfillment_task_id,supplier,supplier_order_id,product_cost,shipping_cost,tax_amount,total_paid,currency,purchased_at,created_at").in("fulfillment_task_id", taskIds)
      : Promise.resolve({ data: [], error: null }),
    taskIds.length
      ? supabase.from("marketplace_fulfillment_shipments").select("id,primary_fulfillment_task_id,marketplace_order_id,package_sequence,tracking_number,suggested_carrier,confirmed_carrier,shipped_at,partial_shipment,normalized_payload,payload_hash,approval_status,approved_at,superseded_at,created_at").in("primary_fulfillment_task_id", taskIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    taskIds.length
      ? supabase.from("marketplace_fulfillment_submission_outbox").select("id,fulfillment_task_id,shipment_id,payload_hash,adapter,simulation_scenario,order_guard_status,status,attempts,max_attempts,due_at,accepted_at,reconciled_at,dead_lettered_at,last_error_code,created_at,updated_at").in("fulfillment_task_id", taskIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ])
  if (events.error || purchases.error || shipments.error || outbox.error) {
    throw new Error("FULFILLMENT_QUEUE_DETAILS_READ_FAILED")
  }
  const result = { enabled: true, config, tasks: safeTasks, events: events.data ?? [], purchases: purchases.data ?? [], shipments: shipments.data ?? [], submissions: outbox.data ?? [], safety: safety() }
  if (containsFulfillmentPrivateData(result)) throw new Error("FULFILLMENT_PRIVATE_DATA_BLOCKED")
  return result
}

export async function confirmMarketplaceFulfillmentPurchase(
  supabase: SupabaseClient,
  taskId: string,
  input: Record<string, unknown>,
  actorId: string | null | undefined,
  requestKey: string,
) {
  assertPreviewStaging()
  const task = await loadTask(supabase, taskId)
  assertTaskIdentity(task)
  if (!isAllowedLunaProductUrl(task.source_product_url)) throw new Error("FULFILLMENT_LUNA_LINK_INVALID")
  const purchase = normalizePurchaseConfirmation(input)
  const { data: existingPurchase, error: existingPurchaseError } = await supabase
    .from("supplier_purchase_orders")
    .select("id,supplier_order_id,product_cost,shipping_cost,tax_amount,total_paid,currency,purchased_at")
    .eq("fulfillment_task_id", task.id).maybeSingle()
  if (existingPurchaseError) throw new Error("FULFILLMENT_PURCHASE_READ_FAILED")
  if (existingPurchase) {
    const same = existingPurchase.supplier_order_id === purchase.lunaOrderId &&
      Number(existingPurchase.product_cost) === purchase.productCost &&
      Number(existingPurchase.shipping_cost) === purchase.shippingCost &&
      Number(existingPurchase.tax_amount) === purchase.taxAmount &&
      Number(existingPurchase.total_paid) === purchase.totalPaid &&
      existingPurchase.currency === purchase.currency &&
      new Date(existingPurchase.purchased_at).toISOString() === purchase.purchasedAt
    if (!same) throw new Error("FULFILLMENT_PURCHASE_ALREADY_CONFIRMED_DIFFERENT_PAYLOAD")
    return { task, purchase, idempotentReplay: true, safety: safety() }
  }
  const { data, error } = await supabase.rpc("confirm_fulfillment_purchase_v1a", {
    p_task_id: task.id,
    p_expected_lock_version: lockVersion(input.lockVersion),
    p_luna_order_id: purchase.lunaOrderId,
    p_product_cost: purchase.productCost,
    p_shipping_cost: purchase.shippingCost,
    p_tax_amount: purchase.taxAmount,
    p_total_paid: purchase.totalPaid,
    p_currency: purchase.currency,
    p_purchased_at: purchase.purchasedAt,
    p_actor_id: safeActor(actorId),
    p_idempotency_key: idempotencyKey(requestKey),
  })
  if (error) throw new Error(sanitizeDatabaseCode(error.message, "FULFILLMENT_PURCHASE_CONFIRM_FAILED"))
  return { task: data, purchase: { ...purchase, lunaOrderId: purchase.lunaOrderId }, safety: safety() }
}

async function loadOrderTasks(supabase: SupabaseClient, task: TaskRow) {
  const { data, error } = await supabase.from("fulfillment_tasks")
    .select("id,marketplace_account_key,marketplace,marketplace_order_id,marketplace_line_item_id,listing_id,marketplace_listing_sku,supplier_sku,supplier_variant_id,identity_fingerprint,identity_verified_at,product_title,quantity,workflow_state,lock_version,source_product_url")
    .eq("marketplace_account_key", task.marketplace_account_key)
    .eq("marketplace", task.marketplace)
    .eq("marketplace_order_id", task.marketplace_order_id)
  if (error) throw new Error("FULFILLMENT_ORDER_TASKS_READ_FAILED")
  return (data ?? []) as TaskRow[]
}

async function officialOrderGuard(task: TaskRow, siblings: TaskRow[]) {
  for (const sibling of siblings) assertTaskIdentity(sibling)
  return getEbayFulfillmentOrderGuard({
    orderId: task.marketplace_order_id,
    expectedLines: siblings.map((row) => ({
      lineItemId: row.marketplace_line_item_id,
      listingId: row.listing_id,
      marketplaceListingSku: row.marketplace_listing_sku as string,
      quantity: row.quantity,
    })),
  })
}

export async function saveMarketplaceFulfillmentTracking(
  supabase: SupabaseClient,
  taskId: string,
  input: Record<string, unknown>,
  actorId: string | null | undefined,
  requestKey: string,
) {
  assertPreviewStaging()
  const task = await loadTask(supabase, taskId)
  assertTaskIdentity(task)
  const siblings = await loadOrderTasks(supabase, task)
  for (const sibling of siblings) assertTaskIdentity(sibling)
  const expectedItems: ShipmentItemInput[] = siblings.map((row) => ({
    lineItemId: row.marketplace_line_item_id,
    listingId: row.listing_id,
    marketplaceListingSku: row.marketplace_listing_sku as string,
    supplierSku: row.supplier_sku as string,
    quantity: row.quantity,
  }))
  const normalized = normalizeTrackingPayload(input, expectedItems)
  if (task.tracking_payload_hash === normalized.payloadHash && task.current_shipment_id) {
    const { data: existing, error: existingError } = await supabase
      .from("marketplace_fulfillment_shipments")
      .select("*").eq("id", task.current_shipment_id)
      .eq("payload_hash", normalized.payloadHash).maybeSingle()
    if (existingError) throw new Error("FULFILLMENT_SHIPMENT_READ_FAILED")
    if (existing) return {
      shipment: existing,
      normalizedPayload: normalized.payload,
      payloadHash: normalized.payloadHash,
      approvalInvalidated: false,
      idempotentReplay: true,
      safety: safety(),
    }
  }
  const { data, error } = await supabase.rpc("save_fulfillment_tracking_v1a", {
    p_task_id: task.id,
    p_expected_lock_version: lockVersion(input.lockVersion),
    p_payload: normalized.payload,
    p_payload_hash: normalized.payloadHash,
    p_actor_id: safeActor(actorId),
    p_idempotency_key: idempotencyKey(requestKey),
  })
  if (error) throw new Error(sanitizeDatabaseCode(error.message, "FULFILLMENT_TRACKING_SAVE_FAILED"))
  return { shipment: data, normalizedPayload: normalized.payload, payloadHash: normalized.payloadHash, approvalInvalidated: true, safety: safety() }
}

export async function approveMarketplaceFulfillmentTracking(
  supabase: SupabaseClient,
  taskId: string,
  input: Record<string, unknown>,
  actorId: string | null | undefined,
  requestKey: string,
) {
  assertPreviewStaging()
  if (input.confirmed !== true) throw new Error("FULFILLMENT_EXPLICIT_APPROVAL_REQUIRED")
  const task = await loadTask(supabase, taskId)
  assertTaskIdentity(task)
  if (typeof input.payloadHash !== "string" || input.payloadHash !== task.tracking_payload_hash) {
    throw new Error("FULFILLMENT_APPROVAL_PAYLOAD_MISMATCH")
  }
  if (["TRACKING_SUBMISSION_QUEUED", "TRACKING_SUBMITTED_SIMULATED", "SHIPPED_SIMULATED"].includes(task.workflow_state)) {
    const { data: existing, error: existingError } = await supabase
      .from("marketplace_fulfillment_submission_outbox").select("*")
      .eq("fulfillment_task_id", task.id).eq("payload_hash", input.payloadHash)
      .maybeSingle()
    if (existingError) throw new Error("FULFILLMENT_SUBMISSION_READ_FAILED")
    if (existing) return {
      submission: existing,
      approvedPayloadHash: input.payloadHash,
      directMarketplaceCall: false,
      idempotentReplay: true,
      safety: safety(),
    }
  }
  const guard = await officialOrderGuard(task, await loadOrderTasks(supabase, task))
  if (guard.blocked) throw new Error(`FULFILLMENT_${guard.blockCode}`)
  const { data: shipment, error: shipmentError } = await supabase.from("marketplace_fulfillment_shipments")
    .select("id,normalized_payload,payload_hash,approval_status,superseded_at")
    .eq("id", task.current_shipment_id).eq("payload_hash", input.payloadHash).maybeSingle()
  if (shipmentError || !shipment || shipment.superseded_at) throw new Error("FULFILLMENT_SHIPMENT_NOT_APPROVABLE")
  if (containsFulfillmentPrivateData(shipment.normalized_payload)) throw new Error("FULFILLMENT_PRIVATE_DATA_BLOCKED")
  const { data, error } = await supabase.rpc("approve_fulfillment_tracking_v1a", {
    p_task_id: task.id,
    p_expected_lock_version: lockVersion(input.lockVersion),
    p_payload_hash: input.payloadHash,
    p_actor_id: safeActor(actorId),
    p_idempotency_key: idempotencyKey(requestKey),
    p_simulation_scenario: "success",
  })
  if (error) throw new Error(sanitizeDatabaseCode(error.message, "FULFILLMENT_TRACKING_APPROVAL_FAILED"))
  return { submission: data, approvedPayloadHash: input.payloadHash, directMarketplaceCall: false, safety: safety() }
}

export async function runMarketplaceFulfillmentSimulator(
  supabase: SupabaseClient,
  options: { workerId?: string; limit?: number } = {},
) {
  const config = assertPreviewStaging()
  if (!config.simulatorEnabled) return { status: "disabled", processed: 0, ebayWrites: 0, safety: safety() }
  const workerId = options.workerId ?? `fulfillment-simulator:${randomUUID()}`
  const { data: claims, error: claimError } = await supabase.rpc("claim_fulfillment_submissions_v1a", {
    p_worker_id: workerId,
    p_limit: Math.max(1, Math.min(options.limit ?? 5, 25)),
    p_lease_seconds: 120,
  })
  if (claimError) throw new Error("FULFILLMENT_SUBMISSION_CLAIM_FAILED")
  const outcomes = []
  let adapterCalls = 0
  let officialOrderReads = 0
  for (const claim of claims ?? []) {
    let simulated: ReturnType<typeof simulateMarketplaceFulfillmentSubmission> | {
      outcome: "blocked" | "temporary_error"
      retryable: boolean
      acceptedRemotely: false
      remoteId: null
      code: string
    }
    try {
      const task = await loadTask(supabase, claim.fulfillment_task_id)
      const guard = await officialOrderGuard(task, await loadOrderTasks(supabase, task))
      officialOrderReads += 1
      if (guard.blocked) {
        simulated = { outcome: "blocked", retryable: false, acceptedRemotely: false, remoteId: null, code: guard.blockCode ?? "ORDER_GUARD_BLOCKED" }
      } else {
        adapterCalls += 1
        simulated = simulateMarketplaceFulfillmentSubmission(
          FULFILLMENT_SIMULATION_SCENARIOS.includes(claim.simulation_scenario as FulfillmentSimulationScenario)
            ? claim.simulation_scenario as FulfillmentSimulationScenario
            : "permanent_error",
          claim.payload_hash,
        )
      }
    } catch (guardError) {
      const identityMismatch = guardError instanceof Error &&
        /IDENTITY_MISMATCH/.test(guardError.message)
      simulated = identityMismatch
        ? { outcome: "blocked", retryable: false, acceptedRemotely: false, remoteId: null, code: "ORDER_IDENTITY_MISMATCH" }
        : { outcome: "temporary_error", retryable: true, acceptedRemotely: false, remoteId: null, code: "FULFILLMENT_ORDER_GUARD_READ_FAILED" }
    }
    const { data, error } = await supabase.rpc("record_fulfillment_simulation_outcome_v1a", {
      p_outbox_id: claim.id,
      p_worker_id: workerId,
      p_outcome: simulated.outcome,
      p_code: simulated.code,
      p_remote_id: simulated.remoteId,
      p_accepted_remotely: simulated.acceptedRemotely,
    })
    if (error) throw new Error("FULFILLMENT_SIMULATION_RESULT_WRITE_FAILED")
    outcomes.push({ id: claim.id, outcome: simulated.outcome, status: data?.status ?? null })
  }
  return { status: "completed", processed: outcomes.length, outcomes, adapterCalls, officialOrderReads, ebayWrites: 0, safety: safety() }
}

export async function reconcileMarketplaceFulfillmentSimulator(
  supabase: SupabaseClient,
  options: { workerId?: string; limit?: number } = {},
) {
  const config = assertPreviewStaging()
  if (!config.simulatorEnabled) return { status: "disabled", reconciled: 0, secondPosts: 0, ebayWrites: 0, safety: safety() }
  const { data, error } = await supabase.rpc("reconcile_fulfillment_submissions_v1a", {
    p_worker_id: options.workerId ?? `fulfillment-reconciler:${randomUUID()}`,
    p_limit: Math.max(1, Math.min(options.limit ?? 10, 50)),
  })
  if (error) throw new Error("FULFILLMENT_RECONCILIATION_FAILED")
  return { status: "completed", reconciled: data?.length ?? 0, secondPosts: 0, ebayWrites: 0, safety: safety() }
}

function sanitizeDatabaseCode(message: string, fallback: string) {
  const match = message.match(/FULFILLMENT_[A-Z0-9_]+/)
  return match?.[0] ?? fallback
}
