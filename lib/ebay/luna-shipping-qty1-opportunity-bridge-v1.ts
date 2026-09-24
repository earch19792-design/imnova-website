import "server-only"

import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { deriveCurrentCommercialCandidateIdentityV1 } from
  "./ebay-current-commercial-candidate-identity-v1"
import { SELLER_OS_CANONICAL_LUNA_SHIPPING_DESTINATION_V1 } from
  "./ebay-luna-authoritative-shipping-server-v1"
import {
  LUNA_SHIPPING_QUOTE_CAPTURE_VERSION,
  certifyLunaShippingCapturePostV1,
  normalizeLunaChromeShippingJobV1,
  type LunaShippingCapturePostV1,
} from "./ebay-luna-chrome-shipping-capture-v1"
import { LUNA_HTTP_SHIPPING_SOURCE } from
  "./ebay-luna-authoritative-shipping-v1"
import {
  issueLunaShippingCaptureSessionV1,
  verifyLunaShippingCaptureSessionV1,
} from "./ebay-luna-chrome-shipping-capture-server-v1"
import { LIVE_LISTING_SHIPPING_MAXIMUM_AGE_SECONDS } from
  "./ebay-live-listing-shipping-evidence-v1"

export const LUNA_SHIPPING_QTY1_JOB_TYPE = "LUNA_SHIPPING_QTY1" as const
export const LUNA_SHIPPING_QTY1_RECEIPT_TYPE =
  "SELLER_OS_LUNA_SHIPPING_QTY1_RECEIPT_V1" as const
const STORE = "seller_os_luna_shipping_qty1_jobs_v1"
const SHA256 = /^sha256:[0-9a-f]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ACCOUNT = /^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$/
const JOB_LIFETIME_MS = 30 * 60_000
const CLAIM_LIFETIME_MS = 9 * 60_000
const MAX_ATTEMPTS = 2

type Row = Record<string, any>
const row = (value: unknown): Row => value && typeof value === "object" &&
  !Array.isArray(value) ? value as Row : {}
const rows = (value: unknown): Row[] => Array.isArray(value)
  ? value.map(row) : []
const digest = (value: string) => `sha256:${createHash("sha256")
  .update(value, "utf8").digest("hex")}`
const nowIso = (now?: number) => new Date(now ?? Date.now()).toISOString()
const destination = SELLER_OS_CANONICAL_LUNA_SHIPPING_DESTINATION_V1

function validIdentity(value: Row) {
  return UUID.test(String(value.id ?? "")) &&
    /^luna-portex:\d{8,24}:\d{8,24}$/.test(String(value.candidate_key ?? "")) &&
    value.candidate_key === `luna-portex:${value.supplier_product_id}:${value.supplier_variant_id}` &&
    /^[A-Za-z0-9][A-Za-z0-9._:+/ -]{0,159}$/.test(
      String(value.supplier_sku ?? ""))
}

function validSource(value: Row, source: Row) {
  const truth = row(source.field_truth_v1)
  return source.product_id === value.supplier_product_id &&
    source.variant_id === value.supplier_variant_id &&
    source.sku === value.supplier_sku && source.availability === true &&
    SHA256.test(String(source.source_fingerprint ?? "")) &&
    SHA256.test(String(truth.evidenceDigest ?? "")) &&
    truth.sourceProductId === source.product_id &&
    truth.sourceVariantId === source.variant_id &&
    truth.sourceSupplierSku === source.sku &&
    truth.sourceCatalogFingerprint === source.source_fingerprint &&
    typeof source.canonical_url === "string" &&
    Number.isFinite(Number(source.price)) && Number(source.price) >= 0
}

export async function ensureLunaShippingQty1OpportunityJobV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  ownerUserId: string
  opportunityId: string
  now?: number
}>) {
  if (!ACCOUNT.test(input.accountKey) || !UUID.test(input.ownerUserId) ||
      !UUID.test(input.opportunityId)) {
    throw new Error("LUNA_SHIPPING_QTY1_JOB_INPUT_INVALID")
  }
  const at = input.now ?? Date.now()
  const opportunity = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,product_title")
    .eq("id", input.opportunityId).limit(1).maybeSingle()
  if (opportunity.error || !validIdentity(row(opportunity.data))) {
    throw new Error("LUNA_SHIPPING_QTY1_OPPORTUNITY_IDENTITY_UNPROVEN")
  }
  const exact = row(opportunity.data)
  const snapshot = await input.supabase.from("luna_catalog_snapshots_v1")
    .select("snapshot_id,created_at").eq("snapshot_status", "COMPLETE")
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
  const snapshotId = String(row(snapshot.data).snapshot_id ?? "")
  if (snapshot.error || !UUID.test(snapshotId)) {
    throw new Error("LUNA_SHIPPING_QTY1_SOURCE_SNAPSHOT_UNAVAILABLE")
  }
  const source = await input.supabase.from("luna_catalog_snapshot_variants_v1")
    .select("snapshot_id,product_id,variant_id,sku,canonical_url,title,price,availability,source_fingerprint,field_truth_v1")
    .eq("snapshot_id", snapshotId)
    .eq("product_id", exact.supplier_product_id)
    .eq("variant_id", exact.supplier_variant_id)
    .eq("sku", exact.supplier_sku).limit(2)
  if (source.error || rows(source.data).length !== 1 ||
      !validSource(exact, row(source.data?.[0]))) {
    throw new Error("LUNA_SHIPPING_QTY1_EXACT_PRODUCT_TRUTH_UNPROVEN")
  }
  const variant = row(source.data?.[0])
  const candidate = deriveCurrentCommercialCandidateIdentityV1({
    accountKey: input.accountKey, productId: exact.supplier_product_id,
    variantId: exact.supplier_variant_id, supplierSku: exact.supplier_sku,
  })
  const freshReceipt = await readLunaShippingQty1OpportunityReceiptV1({
    supabase: input.supabase, accountKey: input.accountKey,
    opportunityId: input.opportunityId, now: at,
  })
  if (freshReceipt) {
    const complete = await input.supabase.from(STORE).select("*")
      .eq("job_id", freshReceipt.jobId).limit(1).maybeSingle()
    if (complete.error || !complete.data) throw new Error(
      "LUNA_SHIPPING_QTY1_COMPLETED_JOB_READ_FAILED")
    return Object.freeze(row(complete.data))
  }
  const idempotencyKey = `luna-shipping-qty1-job-v1:${digest([
    input.accountKey, input.opportunityId, snapshotId,
    destination.profileDigest, "1",
    String(Math.floor(at / JOB_LIFETIME_MS)),
  ].join("\n"))}`
  const prior = await input.supabase.from(STORE).select("*")
    .eq("idempotency_key", idempotencyKey).limit(1).maybeSingle()
  if (prior.error) throw new Error("LUNA_SHIPPING_QTY1_JOB_READ_FAILED")
  if (prior.data) return Object.freeze(row(prior.data))
  const active = await input.supabase.from(STORE).select("*")
    .eq("account_key", input.accountKey)
    .eq("opportunity_id", input.opportunityId)
    .in("status", ["PENDING", "CLAIMED"]).limit(1).maybeSingle()
  if (active.error) throw new Error("LUNA_SHIPPING_QTY1_JOB_READ_FAILED")
  if (active.data) return Object.freeze(row(active.data))
  const title = String(variant.title ?? exact.product_title ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240)
  if (title.length < 2) throw new Error("LUNA_SHIPPING_QTY1_PRODUCT_NAME_UNPROVEN")
  const payload = {
    job_type: LUNA_SHIPPING_QTY1_JOB_TYPE,
    account_key: input.accountKey,
    marketplace: "EBAY_US",
    owner_user_id: input.ownerUserId,
    opportunity_id: input.opportunityId,
    candidate_key: exact.candidate_key,
    candidate_id: candidate.canonicalCandidateId,
    sku: exact.supplier_sku,
    product_id: exact.supplier_product_id,
    variant_id: exact.supplier_variant_id,
    source_snapshot_id: snapshotId,
    source_fingerprint: variant.source_fingerprint,
    field_truth_evidence_digest: row(variant.field_truth_v1).evidenceDigest,
    canonical_product_url: variant.canonical_url,
    product_name: title,
    supplier_cost_usd: Number(variant.price),
    quantity: 1,
    destination_profile: destination.profileId,
    destination_profile_digest: destination.profileDigest,
    idempotency_key: idempotencyKey,
    status: "PENDING",
    created_at: nowIso(at),
    expires_at: nowIso(at + JOB_LIFETIME_MS),
    next_attempt_at: nowIso(at),
  }
  const created = await input.supabase.from(STORE).insert(payload)
    .select("*").single()
  if (created.error || !UUID.test(String(row(created.data).job_id ?? ""))) {
    throw new Error("LUNA_SHIPPING_QTY1_JOB_WRITE_FAILED")
  }
  return Object.freeze(row(created.data))
}

function browserJob(source: Row, session: Readonly<{
  captureSessionId: string
  nonce: string
}>) {
  const core = normalizeLunaChromeShippingJobV1({
    contractVersion: LUNA_SHIPPING_QUOTE_CAPTURE_VERSION,
    ...session,
    snapshotDigest: source.source_fingerprint,
    identity: {
      candidateId: source.candidate_id,
      canonicalProductUrl: source.canonical_product_url,
      lunaProductId: source.product_id,
      lunaVariantId: source.variant_id,
      supplierSku: source.sku,
      quantity: 1,
    },
    destination,
    salePriceUsd: null,
    supplierCostUsd: Number(source.supplier_cost_usd),
    productName: source.product_name,
  })
  return Object.freeze({ ...core,
    jobId: source.job_id,
    jobType: LUNA_SHIPPING_QTY1_JOB_TYPE,
    accountKey: source.account_key,
    marketplace: source.marketplace,
    ownerUserId: source.owner_user_id,
    opportunityId: source.opportunity_id,
    candidateKey: source.candidate_key,
    sourceSnapshotId: source.source_snapshot_id,
    fieldTruthEvidenceDigest: source.field_truth_evidence_digest,
    createdAt: source.created_at,
    expiresAt: source.expires_at,
    attemptCount: source.attempt_count,
    leaseExpiresAt: source.lease_expires_at,
    idempotencyKey: source.idempotency_key,
  })
}

export async function claimLunaShippingQty1OpportunityJobV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  ownerUserId: string
  runtimeInstanceId: string
  leaderSessionId: string
  sessionSecret: string
  now?: number
}>) {
  const at = input.now ?? Date.now()
  if (!ACCOUNT.test(input.accountKey) || !UUID.test(input.ownerUserId) ||
      !UUID.test(input.runtimeInstanceId) ||
      !UUID.test(input.leaderSessionId)) {
    throw new Error("LUNA_SHIPPING_QTY1_CLAIM_INPUT_INVALID")
  }
  const lease = await input.supabase.from("seller_os_browser_workload_leases_v1")
    .select("worker_instance_id,leader_session_id,lease_expires_at,shipping_capture_state,shipping_capability_worker_id,shipping_capability_observed_at")
    .eq("marketplace_account_key", input.accountKey)
    .eq("worker_family", "LUNA_SHIPPING").limit(1).maybeSingle()
  const authority = row(lease.data)
  if (lease.error || authority.worker_instance_id !== input.runtimeInstanceId ||
      authority.leader_session_id !== input.leaderSessionId ||
      Date.parse(String(authority.lease_expires_at ?? "")) <= at ||
      authority.shipping_capture_state !== "AVAILABLE" ||
      authority.shipping_capability_worker_id !== input.runtimeInstanceId ||
      Date.parse(String(authority.shipping_capability_observed_at ?? "")) <
        at - 5 * 60_000) return null
  const expired = await input.supabase.from(STORE).update({
    status: "EXPIRED", last_reason_code: "JOB_EXPIRED",
  }).eq("account_key", input.accountKey)
    .eq("owner_user_id", input.ownerUserId)
    .in("status", ["PENDING", "CLAIMED"])
    .lte("expires_at", nowIso(at))
  if (expired.error) throw new Error("LUNA_SHIPPING_QTY1_EXPIRY_FAILED")
  const exhausted = await input.supabase.from(STORE).update({
    status: "FAILED", last_reason_code: "LEASE_EXPIRED_ATTEMPTS_EXHAUSTED",
  }).eq("account_key", input.accountKey)
    .eq("owner_user_id", input.ownerUserId)
    .eq("status", "CLAIMED")
    .gte("attempt_count", MAX_ATTEMPTS)
    .lt("lease_expires_at", nowIso(at))
  if (exhausted.error) throw new Error("LUNA_SHIPPING_QTY1_EXHAUSTION_FAILED")
  const reclaim = await input.supabase.from(STORE).update({
    status: "PENDING", next_attempt_at: nowIso(at + 60_000),
    last_reason_code: "LEASE_EXPIRED",
  }).eq("account_key", input.accountKey)
    .eq("owner_user_id", input.ownerUserId)
    .eq("status", "CLAIMED")
    .lt("attempt_count", MAX_ATTEMPTS)
    .lt("lease_expires_at", nowIso(at))
  if (reclaim.error) throw new Error("LUNA_SHIPPING_QTY1_RECLAIM_FAILED")
  const pending = await input.supabase.from(STORE).select("*")
    .eq("account_key", input.accountKey)
    .eq("owner_user_id", input.ownerUserId)
    .eq("status", "PENDING")
    .lte("next_attempt_at", nowIso(at))
    .gt("expires_at", nowIso(at))
    .lt("attempt_count", MAX_ATTEMPTS)
    .order("created_at", { ascending: true }).limit(1).maybeSingle()
  if (pending.error) throw new Error("LUNA_SHIPPING_QTY1_JOB_READ_FAILED")
  if (!pending.data) return null
  const selected = row(pending.data)
  const session = issueLunaShippingCaptureSessionV1({
    secret: input.sessionSecret, candidateId: selected.candidate_id,
    snapshotDigest: selected.source_fingerprint, now: at,
  })
  const leaseExpiresAt = nowIso(Math.min(at + CLAIM_LIFETIME_MS,
    Date.parse(selected.expires_at)))
  const claimed = await input.supabase.from(STORE).update({
    status: "CLAIMED", attempt_count: Number(selected.attempt_count) + 1,
    claimed_at: nowIso(at), lease_expires_at: leaseExpiresAt,
    claimed_worker_id: input.runtimeInstanceId,
    claimed_leader_session_id: input.leaderSessionId,
    capture_session_id: session.captureSessionId,
  }).eq("job_id", selected.job_id).eq("status", "PENDING")
    .eq("attempt_count", selected.attempt_count)
    .eq("owner_user_id", input.ownerUserId)
    .gt("expires_at", nowIso(at)).select("*").maybeSingle()
  if (claimed.error) throw new Error("LUNA_SHIPPING_QTY1_CLAIM_FAILED")
  return claimed.data ? browserJob(row(claimed.data), session) : null
}

export function certifyLunaShippingQty1ReceiptV1(job: Row, event: Row,
  capturedAt: string, now: number) {
  const payload = row(event.event_payload)
  const observed = Date.parse(String(payload.observedAt ?? ""))
  const captured = Date.parse(capturedAt)
  const amount = Number(payload.shippingUsd)
  if (event.event_type !== LUNA_SHIPPING_QTY1_RECEIPT_TYPE ||
      payload.contractVersion !== LUNA_SHIPPING_QTY1_RECEIPT_TYPE ||
      payload.jobId !== job.job_id ||
      payload.accountKey !== job.account_key ||
      payload.marketplace !== "EBAY_US" || job.marketplace !== "EBAY_US" ||
      payload.ownerUserId !== job.owner_user_id ||
      payload.opportunityId !== job.opportunity_id ||
      payload.candidateKey !== job.candidate_key ||
      payload.candidateId !== job.candidate_id ||
      payload.sku !== job.sku ||
      payload.productId !== job.product_id ||
      payload.variantId !== job.variant_id ||
      payload.sourceSnapshotId !== job.source_snapshot_id ||
      payload.sourceFingerprint !== job.source_fingerprint ||
      payload.fieldTruthEvidenceDigest !== job.field_truth_evidence_digest ||
      payload.destinationProfile !== "LUNA_BOCA_RATON_US" ||
      payload.destinationProfileDigest !== destination.profileDigest ||
      payload.quantity !== 1 || payload.currency !== "USD" ||
      payload.shippingContractVersion !== LUNA_SHIPPING_QUOTE_CAPTURE_VERSION ||
      payload.canonicalDestinationMatch !== true ||
      payload.sourceAuthority !== LUNA_HTTP_SHIPPING_SOURCE ||
      payload.noPurchase !== true || payload.noCredentials !== true ||
      payload.noRawDestinationAddress !== true ||
      !SHA256.test(String(payload.evidenceDigest ?? "")) ||
      !Number.isFinite(amount) || amount < 0 ||
      !Number.isFinite(observed) || observed > now + 60_000 ||
      observed + LIVE_LISTING_SHIPPING_MAXIMUM_AGE_SECONDS * 1000 <= now ||
      !Number.isFinite(captured) || captured + 60_000 < observed ||
      captured > now + 60_000) return null
  return Object.freeze({
    status: "PROVEN" as const,
    jobId: job.job_id as string,
    receiptId: event.id as string,
    shippingAmountUsd: amount,
    currency: "USD" as const,
    quantity: 1 as const,
    destinationProfile: "LUNA_BOCA_RATON_US" as const,
    observedAt: payload.observedAt as string,
    freshUntil: new Date(observed +
      LIVE_LISTING_SHIPPING_MAXIMUM_AGE_SECONDS * 1000).toISOString(),
    sourceAuthority: payload.sourceAuthority as string,
    evidenceDigest: payload.evidenceDigest as string,
    durableReadback: true as const,
  })
}

export async function readLunaShippingQty1OpportunityReceiptV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  opportunityId: string
  now?: number
}>) {
  const jobs = await input.supabase.from(STORE).select("*")
    .eq("account_key", input.accountKey)
    .eq("opportunity_id", input.opportunityId)
    .eq("status", "COMPLETED")
    .order("completed_at", { ascending: false }).limit(10)
  if (jobs.error) throw new Error("LUNA_SHIPPING_QTY1_RECEIPT_READ_FAILED")
  for (const job of rows(jobs.data)) {
    if (!UUID.test(String(job.receipt_event_id ?? ""))) continue
    const event = await input.supabase.from("ebay_same_day_pilot_events")
      .select("id,run_id,event_type,event_payload,created_at")
      .eq("id", job.receipt_event_id).limit(1).maybeSingle()
    if (event.error) throw new Error("LUNA_SHIPPING_QTY1_RECEIPT_READ_FAILED")
    const run = await input.supabase.from("ebay_same_day_pilot_runs")
      .select("marketplace_account_key,marketplace")
      .eq("id", row(event.data).run_id).limit(1).maybeSingle()
    if (run.error || row(run.data).marketplace_account_key !==
        input.accountKey || row(run.data).marketplace !== "EBAY_US") continue
    const certified = certifyLunaShippingQty1ReceiptV1(job, row(event.data),
      String(row(event.data).created_at ?? ""), input.now ?? Date.now())
    if (certified) return certified
  }
  return null
}

export async function persistLunaShippingQty1OpportunityCaptureV1(input:
  Readonly<{
    supabase: SupabaseClient
    accountKey: string
    ownerUserId: string
    capture: LunaShippingCapturePostV1
    binding?: Readonly<Record<string, unknown>>
    sessionSecret: string
    now?: number
  }>) {
  const at = input.now ?? Date.now()
  const result = await input.supabase.from(STORE).select("*")
    .eq("account_key", input.accountKey)
    .eq("owner_user_id", input.ownerUserId)
    .eq("candidate_id", input.capture.candidateId)
    .eq("capture_session_id", input.capture.captureSessionId)
    .limit(1).maybeSingle()
  if (result.error) throw new Error("LUNA_SHIPPING_QTY1_JOB_READ_FAILED")
  if (!result.data) return null
  const job = row(result.data)
  const binding = row(input.binding)
  if (binding.jobId !== job.job_id ||
      binding.jobType !== LUNA_SHIPPING_QTY1_JOB_TYPE ||
      binding.accountKey !== input.accountKey ||
      binding.marketplace !== "EBAY_US" ||
      binding.ownerUserId !== input.ownerUserId ||
      binding.opportunityId !== job.opportunity_id ||
      binding.candidateKey !== job.candidate_key ||
      binding.sku !== job.sku ||
      binding.productId !== job.product_id ||
      binding.variantId !== job.variant_id ||
      binding.quantity !== 1 ||
      binding.destinationProfile !== job.destination_profile ||
      binding.idempotencyKey !== job.idempotency_key ||
      binding.leaseExpiresAt !== job.lease_expires_at) {
    throw new Error("LUNA_SHIPPING_QTY1_RESULT_BINDING_INVALID")
  }
  verifyLunaShippingCaptureSessionV1({
    secret: input.sessionSecret, candidateId: job.candidate_id,
    snapshotDigest: job.source_fingerprint,
    captureSessionId: input.capture.captureSessionId,
    nonce: input.capture.nonce, now: at,
  })
  if (job.status === "COMPLETED") {
    const duplicateEvent = await input.supabase.from(
      "ebay_same_day_pilot_events")
      .select("event_payload")
      .eq("id", job.receipt_event_id).limit(1).maybeSingle()
    const prior = await readLunaShippingQty1OpportunityReceiptV1({
      supabase: input.supabase, accountKey: input.accountKey,
      opportunityId: job.opportunity_id, now: at,
    })
    if (duplicateEvent.error || !prior ||
        row(row(duplicateEvent.data).event_payload)
          .extensionEvidenceDigest !== input.capture.evidenceDigest ||
        prior.receiptId !== job.receipt_event_id ||
        row(job).capture_session_id !== input.capture.captureSessionId ||
        row(job).candidate_id !== input.capture.candidateId ||
        prior.shippingAmountUsd !== input.capture.shippingUsd ||
        prior.observedAt !== input.capture.observedAt ||
        prior.sourceAuthority !== input.capture.acquisitionMethod ||
        row(job).sku !== input.capture.supplierSku ||
        row(job).product_id !== input.capture.lunaProductId ||
        row(job).variant_id !== input.capture.lunaVariantId ||
        input.capture.quantity !== 1) {
      throw new Error("LUNA_SHIPPING_QTY1_DUPLICATE_CONFLICT")
    }
    return Object.freeze({ ...prior, capturePostAccepted: true as const,
      captureResultDurable: true as const, durableReadbackMatch: true as const,
      quote: Object.freeze({ exactLunaIdentity: true as const,
        shippingAmountUsd: prior.shippingAmountUsd,
        observedAt: prior.observedAt,
        acquisitionMethod: prior.sourceAuthority }),
      capture: Object.freeze({ shippingUsd: prior.shippingAmountUsd }),
      economics: null, jobId: job.job_id })
  }
  if (job.status !== "CLAIMED" ||
      Date.parse(String(job.lease_expires_at ?? "")) <= at ||
      Date.parse(String(job.expires_at ?? "")) <= at ||
      !UUID.test(String(job.claimed_leader_session_id ?? "")) ||
      job.destination_profile !== destination.profileId ||
      job.destination_profile_digest !== destination.profileDigest ||
      job.quantity !== 1) {
    throw new Error("LUNA_SHIPPING_QTY1_JOB_CLAIM_UNPROVEN")
  }
  const core = browserJob(job, {
    captureSessionId: input.capture.captureSessionId,
    nonce: input.capture.nonce,
  })
  const certified = certifyLunaShippingCapturePostV1({
    job: core, capture: input.capture, now: at,
  })
  if (certified.economics !== null ||
      certified.quote.exactLunaIdentity !== true ||
      certified.quote.destinationProfileDigest !== destination.profileDigest ||
      certified.quote.destinationProfileId !== destination.profileId ||
      certified.quote.currency !== "USD" ||
      certified.quote.acquisitionMethod !== LUNA_HTTP_SHIPPING_SOURCE ||
      input.capture.canonicalDestinationMatch !== true ||
      input.capture.canonicalDestinationFingerprint !==
        destination.profileDigest) {
    throw new Error("LUNA_SHIPPING_QTY1_CAPTURE_AUTHORITY_UNPROVEN")
  }
  const opportunity = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku")
    .eq("id", job.opportunity_id).limit(1).maybeSingle()
  const exact = row(opportunity.data)
  if (opportunity.error || exact.candidate_key !== job.candidate_key ||
      exact.supplier_product_id !== job.product_id ||
      exact.supplier_variant_id !== job.variant_id ||
      exact.supplier_sku !== job.sku) {
    throw new Error("LUNA_SHIPPING_QTY1_OPPORTUNITY_DRIFT")
  }
  const run = await input.supabase.from("ebay_same_day_pilot_runs")
    .select("id").eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US")
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
  const runId = String(row(run.data).id ?? "")
  if (run.error || !UUID.test(runId)) {
    throw new Error("LUNA_SHIPPING_QTY1_DURABLE_RUN_UNAVAILABLE")
  }
  const payload = Object.freeze({
    contractVersion: LUNA_SHIPPING_QTY1_RECEIPT_TYPE,
    shippingContractVersion: LUNA_SHIPPING_QUOTE_CAPTURE_VERSION,
    jobId: job.job_id, jobType: LUNA_SHIPPING_QTY1_JOB_TYPE,
    accountKey: job.account_key, ownerUserId: job.owner_user_id,
    marketplace: job.marketplace,
    opportunityId: job.opportunity_id, candidateKey: job.candidate_key,
    candidateId: job.candidate_id, sku: job.sku,
    productId: job.product_id, variantId: job.variant_id,
    sourceSnapshotId: job.source_snapshot_id,
    sourceFingerprint: job.source_fingerprint,
    fieldTruthEvidenceDigest: job.field_truth_evidence_digest,
    quantity: 1, destinationProfile: destination.profileId,
    destinationProfileDigest: destination.profileDigest,
    shippingUsd: certified.quote.shippingAmountUsd,
    subtotalUsd: certified.quote.subtotalUsd,
    currency: certified.quote.currency,
    observedAt: certified.quote.observedAt,
    sourceAuthority: certified.quote.acquisitionMethod,
    evidenceDigest: certified.quote.evidenceDigest,
    extensionEvidenceDigest: input.capture.evidenceDigest,
    captureSessionId: job.capture_session_id,
    canonicalDestinationMatch: true,
    noPurchase: true, noCredentials: true,
    noRawDestinationAddress: true, marketplaceWrites: 0,
  })
  const eventKey = [runId, LUNA_SHIPPING_QTY1_RECEIPT_TYPE,
    job.job_id].join(":")
  const write = await input.supabase.from("ebay_same_day_pilot_events")
    .upsert({ run_id: runId, candidate_id: null,
      event_type: LUNA_SHIPPING_QTY1_RECEIPT_TYPE,
      event_payload: payload, idempotency_key: eventKey,
      ebay_read_calls: 0, openai_calls: 0, ebay_writes: 0,
      production_changed: false,
    }, { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (write.error) throw new Error("LUNA_SHIPPING_QTY1_RECEIPT_WRITE_FAILED")
  const event = await input.supabase.from("ebay_same_day_pilot_events")
    .select("id,run_id,event_type,event_payload,created_at")
    .eq("idempotency_key", eventKey).limit(1).maybeSingle()
  const stored = row(event.data)
  const certifiedReadback = certifyLunaShippingQty1ReceiptV1(job, stored,
    String(stored.created_at ?? ""), at)
  if (event.error || !certifiedReadback ||
      certifiedReadback.evidenceDigest !== certified.quote.evidenceDigest ||
      row(stored.event_payload).extensionEvidenceDigest !==
        input.capture.evidenceDigest) {
    throw new Error("LUNA_SHIPPING_QTY1_RECEIPT_CONFLICT_OR_READBACK_FAILED")
  }
  const completed = await input.supabase.from(STORE).update({
    status: "COMPLETED", completed_at: nowIso(at),
    receipt_event_id: certifiedReadback.receiptId,
  }).eq("job_id", job.job_id).eq("account_key", input.accountKey)
    .eq("owner_user_id", input.ownerUserId)
    .eq("status", "CLAIMED")
    .eq("capture_session_id", job.capture_session_id)
    .gt("lease_expires_at", nowIso(at))
    .select("job_id,receipt_event_id").maybeSingle()
  if (completed.error || row(completed.data).receipt_event_id !==
      certifiedReadback.receiptId) {
    throw new Error("LUNA_SHIPPING_QTY1_JOB_COMPLETION_FAILED")
  }
  const finalReadback = await readLunaShippingQty1OpportunityReceiptV1({
    supabase: input.supabase, accountKey: input.accountKey,
    opportunityId: job.opportunity_id, now: at,
  })
  if (!finalReadback || finalReadback.receiptId !==
      certifiedReadback.receiptId) {
    throw new Error("LUNA_SHIPPING_QTY1_FINAL_READBACK_FAILED")
  }
  return Object.freeze({ ...finalReadback,
    capturePostAccepted: true as const, captureResultDurable: true as const,
    durableReadbackMatch: true as const,
    quote: certified.quote, capture: Object.freeze({
      subtotalUsd: input.capture.subtotalUsd,
      shippingUsd: input.capture.shippingUsd,
      totalUsd: input.capture.totalUsd,
    }), economics: null, jobId: job.job_id,
  })
}

export async function failLunaShippingQty1OpportunityJobV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  ownerUserId: string
  jobId: string
  captureSessionId: string
  reasonCode: string
  now?: number
}>) {
  const at = input.now ?? Date.now()
  if (!UUID.test(input.jobId) || !UUID.test(input.captureSessionId) ||
      !/^[A-Z0-9_]{3,120}$/.test(input.reasonCode)) {
    throw new Error("LUNA_SHIPPING_QTY1_FAILURE_INPUT_INVALID")
  }
  const found = await input.supabase.from(STORE).select("*")
    .eq("job_id", input.jobId).eq("account_key", input.accountKey)
    .eq("owner_user_id", input.ownerUserId)
    .eq("capture_session_id", input.captureSessionId)
    .limit(1).maybeSingle()
  if (found.error || !found.data) throw new Error(
    "LUNA_SHIPPING_QTY1_JOB_CLAIM_UNPROVEN")
  const job = row(found.data)
  if (job.status !== "CLAIMED") return Object.freeze({
    jobId: input.jobId, status: job.status })
  const retry = Number(job.attempt_count) < MAX_ATTEMPTS &&
    Date.parse(job.expires_at) > at + 60_000
  const update = await input.supabase.from(STORE).update({
    status: retry ? "PENDING" : "FAILED",
    next_attempt_at: nowIso(at + 60_000),
    last_reason_code: input.reasonCode,
  }).eq("job_id", input.jobId).eq("status", "CLAIMED")
    .eq("capture_session_id", input.captureSessionId)
    .select("job_id,status").maybeSingle()
  if (update.error || !update.data) throw new Error(
    "LUNA_SHIPPING_QTY1_FAILURE_CLOSE_FAILED")
  return Object.freeze({ jobId: input.jobId,
    status: row(update.data).status })
}
