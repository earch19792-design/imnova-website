import type { SupabaseClient } from "@supabase/supabase-js"

export const SELLER_OS_BROWSER_WORKER_LIVENESS_V1 =
  "INDEPENDENT_WORKER_LIVENESS" as const
export const SELLER_OS_BROWSER_WORKER_HEARTBEAT_INTERVAL_MS = 60_000
export const SELLER_OS_BROWSER_WORKER_CAPABILITY_TTL_SECONDS = 300
export const SELLER_OS_BROWSER_WORKLOAD_LEASE_SECONDS = 150

export type SellerOsBrowserWorkerFamilyV1 =
  "PRODUCT_RESEARCH" | "LUNA_SHIPPING"
export type SellerOsBrowserWorkerStateV1 = "AVAILABLE" | "IDLE" | "WORKING"

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 160) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum)
    : ""
}

export function projectSellerOsBrowserWorkerCapabilityV1(input: Readonly<{
  row: unknown
  now?: Date
}>) {
  const row = record(input.row)
  const now = input.now ?? new Date()
  const observedAtMs = Date.parse(String(row.observed_at ?? ""))
  const freshUntilMs = Date.parse(String(row.fresh_until ?? ""))
  const receiptPresent = /^[0-9a-f-]{36}$/i.test(
    text(row.heartbeat_receipt_id, 40))
  const authorityValid = row.heartbeat_source ===
      SELLER_OS_BROWSER_WORKER_LIVENESS_V1 &&
    row.physical_connection === "PROVEN_AVAILABLE" &&
    row.extension_identity_match === true && receiptPresent &&
    Number.isFinite(observedAtMs) && Number.isFinite(freshUntilMs) &&
    freshUntilMs > observedAtMs
  const fresh = authorityValid && now.getTime() >= observedAtMs &&
    now.getTime() < freshUntilMs
  return Object.freeze({
    capabilityId: text(row.capability_id, 80) || null,
    workerFamily: text(row.worker_family, 80) || null,
    workerState: text(row.worker_state, 40) || null,
    receiptId: receiptPresent ? text(row.heartbeat_receipt_id, 40) : null,
    heartbeatSource: authorityValid
      ? SELLER_OS_BROWSER_WORKER_LIVENESS_V1 : null,
    observedAt: Number.isFinite(observedAtMs)
      ? new Date(observedAtMs).toISOString() : null,
    freshUntil: Number.isFinite(freshUntilMs)
      ? new Date(freshUntilMs).toISOString() : null,
    extensionVersion: text(row.extension_version, 40) || null,
    authorityValid,
    fresh,
    connectionState: fresh ? "PROVEN_AVAILABLE" as const
      : "UNOBSERVABLE" as const,
  })
}

export async function readSellerOsBrowserWorkerCapabilitiesV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  now?: Date
}>) {
  const read = await input.supabase.from(
    "seller_os_browser_worker_capabilities_v1")
    .select("capability_id,worker_family,worker_state,heartbeat_receipt_id,heartbeat_source,physical_connection,extension_identity_match,extension_version,observed_at,fresh_until,last_heartbeat_at")
    .eq("marketplace_account_key", input.accountKey)
  if (read.error) {
    throw new Error("SELLER_OS_BROWSER_WORKER_LIVENESS_READ_FAILED")
  }
  const projected = (read.data ?? []).map((row) =>
    projectSellerOsBrowserWorkerCapabilityV1({ row, now: input.now }))
  return Object.freeze({
    sourceAuthority: SELLER_OS_BROWSER_WORKER_LIVENESS_V1,
    observedAt: (input.now ?? new Date()).toISOString(),
    capabilities: Object.freeze(projected),
    byId: new Map(projected.map((entry) =>
      [entry.capabilityId, entry] as const)),
  })
}

export async function persistSellerOsBrowserWorkerHeartbeatV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  workerFamily: SellerOsBrowserWorkerFamilyV1
  workerInstanceId: string
  extensionVersion: string
  extensionIdentityMatch: boolean
  workerState: SellerOsBrowserWorkerStateV1
  claimAuthoritySessionId: string
  observedAt?: Date
}>) {
  const observedAt = input.observedAt ?? new Date()
  const write = await input.supabase.rpc(
    "record_seller_os_browser_worker_heartbeat_v2", {
      p_marketplace_account_key: input.accountKey,
      p_worker_family: input.workerFamily,
      p_worker_instance_id: input.workerInstanceId,
      p_extension_version: input.extensionVersion,
      p_extension_identity_match: input.extensionIdentityMatch,
      p_worker_state: input.workerState,
      p_observed_at: observedAt.toISOString(),
      p_claim_authority_session_id: input.claimAuthoritySessionId,
      p_ttl_seconds: SELLER_OS_BROWSER_WORKER_CAPABILITY_TTL_SECONDS,
      p_claim_authority_lease_seconds:
        SELLER_OS_BROWSER_WORKLOAD_LEASE_SECONDS,
    })
  if (write.error || !write.data) {
    throw new Error("SELLER_OS_BROWSER_WORKER_HEARTBEAT_PERSIST_FAILED")
  }
  const receipt = record(write.data)
  if (receipt.heartbeatSource !== SELLER_OS_BROWSER_WORKER_LIVENESS_V1 ||
      receipt.capabilityFresh !== true || receipt.marketplaceWrites !== 0 ||
      receipt.claimAuthorityContractVersion !==
        "SELLER_OS_BROWSER_WORKLOAD_LEASE_V1") {
    throw new Error("SELLER_OS_BROWSER_WORKER_HEARTBEAT_READBACK_FAILED")
  }
  return Object.freeze({
    heartbeatReceiptId: text(receipt.heartbeatReceiptId, 40),
    heartbeatSource: SELLER_OS_BROWSER_WORKER_LIVENESS_V1,
    workerFamily: input.workerFamily,
    workerState: input.workerState,
    observedAt: text(receipt.observedAt, 80),
    freshUntil: text(receipt.freshUntil, 80),
    capabilityFresh: true as const,
    claimAuthorityGranted: receipt.claimAuthorityGranted === true,
    claimAuthorityLeaseExpiresAt:
      text(receipt.claimAuthorityLeaseExpiresAt, 80) || null,
    claimAuthorityLeaseGeneration:
      Number.isSafeInteger(receipt.claimAuthorityLeaseGeneration)
        ? Number(receipt.claimAuthorityLeaseGeneration) : null,
    marketplaceWrites: 0 as const,
  })
}

export async function verifySellerOsBrowserWorkloadLeaseV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  workerFamily: SellerOsBrowserWorkerFamilyV1
  workerInstanceId: string
  claimAuthoritySessionId: string
  observedAt?: Date
}>) {
  const read = await input.supabase.rpc(
    "verify_seller_os_browser_workload_lease_v1", {
      p_marketplace_account_key: input.accountKey,
      p_worker_family: input.workerFamily,
      p_worker_instance_id: input.workerInstanceId,
      p_claim_authority_session_id: input.claimAuthoritySessionId,
      p_observed_at: (input.observedAt ?? new Date()).toISOString(),
    })
  if (read.error || !read.data) {
    throw new Error("SELLER_OS_BROWSER_WORKLOAD_LEASE_VERIFY_FAILED")
  }
  const receipt = record(read.data)
  if (receipt.claimAuthorityContractVersion !==
      "SELLER_OS_BROWSER_WORKLOAD_LEASE_V1") {
    throw new Error("SELLER_OS_BROWSER_WORKLOAD_LEASE_READBACK_FAILED")
  }
  return Object.freeze({
    claimAuthorityGranted: receipt.claimAuthorityGranted === true,
    claimAuthorityLeaseExpiresAt:
      text(receipt.claimAuthorityLeaseExpiresAt, 80) || null,
    claimAuthorityLeaseGeneration:
      Number.isSafeInteger(receipt.claimAuthorityLeaseGeneration)
        ? Number(receipt.claimAuthorityLeaseGeneration) : null,
  })
}
