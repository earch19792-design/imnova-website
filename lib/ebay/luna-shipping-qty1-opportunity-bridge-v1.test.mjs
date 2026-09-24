import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value === "server-only") return {
    url: "data:text/javascript,export default {}", shortCircuit: true,
  }
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const { certifyLunaShippingQty1ReceiptV1,
  LUNA_SHIPPING_QTY1_RECEIPT_TYPE,
  persistLunaShippingQty1OpportunityCaptureV1 } = await import(
  "./luna-shipping-qty1-opportunity-bridge-v1.ts")
const { issueLunaShippingCaptureSessionV1 } = await import(
  "./ebay-luna-chrome-shipping-capture-server-v1.ts")
const { SELLER_OS_CANONICAL_LUNA_SHIPPING_DESTINATION_V1: destination } =
  await import("./ebay-luna-authoritative-shipping-server-v1.ts")
const { LUNA_HTTP_SHIPPING_SOURCE } =
  await import("./ebay-luna-authoritative-shipping-v1.ts")

const now = Date.parse("2026-09-24T02:30:00.000Z")
const observedAt = "2026-09-24T02:25:00.000Z"
const job = Object.freeze({
  job_id: "28a8a7d0-9910-4f6e-95be-354eb045f8ab",
  account_key: `seller:${"a".repeat(64)}`,
  marketplace: "EBAY_US",
  owner_user_id: "7904fd7e-97c0-4438-94c2-569a625dadb4",
  opportunity_id: "ad6671f6-81b1-4d76-a1fd-a3f6408e8842",
  candidate_key: "luna-portex:10211942072544:54943494865120",
  candidate_id: `sha256:${"b".repeat(64)}`,
  sku: "ITEM-8058-RED-LU-DE", product_id: "10211942072544",
  variant_id: "54943494865120",
  source_snapshot_id: "58a223c8-b2cc-4ff8-84ef-afeb2c1e8750",
  source_fingerprint: `sha256:${"c".repeat(64)}`,
  field_truth_evidence_digest: `sha256:${"d".repeat(64)}`,
})
const event = Object.freeze({
  id: "e4cbe1a0-8d4d-4518-81d4-48a6fc148c30",
  event_type: LUNA_SHIPPING_QTY1_RECEIPT_TYPE,
  event_payload: {
    contractVersion: LUNA_SHIPPING_QTY1_RECEIPT_TYPE,
    shippingContractVersion: "LUNA_SHIPPING_QUOTE_CAPTURE_V1",
    jobId: job.job_id, accountKey: job.account_key,
    marketplace: "EBAY_US",
    ownerUserId: job.owner_user_id, opportunityId: job.opportunity_id,
    candidateKey: job.candidate_key, candidateId: job.candidate_id,
    sku: job.sku, productId: job.product_id, variantId: job.variant_id,
    sourceSnapshotId: job.source_snapshot_id,
    sourceFingerprint: job.source_fingerprint,
    fieldTruthEvidenceDigest: job.field_truth_evidence_digest,
    destinationProfile: "LUNA_BOCA_RATON_US",
    destinationProfileDigest: destination.profileDigest,
    quantity: 1, currency: "USD", shippingUsd: 7.95,
    observedAt, sourceAuthority: LUNA_HTTP_SHIPPING_SOURCE,
    evidenceDigest: `sha256:${"e".repeat(64)}`,
    canonicalDestinationMatch: true,
    noPurchase: true, noCredentials: true, noRawDestinationAddress: true,
  },
})

test("exact durable receipt is fresh and preserves the prepackage identity", () => {
  const result = certifyLunaShippingQty1ReceiptV1(job, event,
    "2026-09-24T02:26:00.000Z", now)
  assert.equal(result?.status, "PROVEN")
  assert.equal(result?.receiptId, event.id)
  assert.equal(result?.shippingAmountUsd, 7.95)
  assert.equal(result?.freshUntil, "2026-09-24T08:25:00.000Z")
})

test("cross variant, account, destination and stale receipts fail closed", () => {
  const base = event.event_payload
  for (const change of [
    { variantId: "54943494865121" },
    { sku: "ITEM-8058-BLACK-LU-DE" },
    { accountKey: `other:${"a".repeat(64)}` },
    { destinationProfile: "OTHER_US" },
    { canonicalDestinationMatch: false },
    { sourceAuthority: "NORMAL_CHROME_EXTENSION_VISIBLE_DOM" },
    { quantity: 2 },
    { observedAt: "2026-09-23T20:29:59.000Z" },
  ]) {
    assert.equal(certifyLunaShippingQty1ReceiptV1(job,
      { ...event, event_payload: { ...base, ...change } },
      "2026-09-24T02:26:00.000Z", now), null)
  }
})

test("result submission rejects contradictory job binding and unclaimed job", async () => {
  const sessionSecret = "test-session-secret-with-at-least-thirty-two-characters"
  const sourceFingerprint = job.source_fingerprint
  const session = issueLunaShippingCaptureSessionV1({
    secret: sessionSecret, candidateId: job.candidate_id,
    snapshotDigest: sourceFingerprint, now,
  })
  const claimedJob = {
    ...job, idempotency_key: `luna-shipping-qty1-job-v1:sha256:${"f".repeat(64)}`,
    destination_profile: "LUNA_BOCA_RATON_US",
    destination_profile_digest: destination.profileDigest,
    lease_expires_at: "2026-09-24T02:35:00.000Z",
    expires_at: "2026-09-24T02:50:00.000Z",
    capture_session_id: session.captureSessionId,
    claimed_leader_session_id: "58a223c8-b2cc-4ff8-84ef-afeb2c1e8750",
    quantity: 1, status: "CLAIMED",
  }
  const supabase = { from: () => {
    const builder = {
      select: () => builder, eq: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: claimedJob, error: null }),
    }
    return builder
  } }
  const capture = {
    candidateId: job.candidate_id,
    captureSessionId: session.captureSessionId,
    nonce: session.nonce,
    supplierSku: job.sku, lunaProductId: job.product_id,
    lunaVariantId: job.variant_id, quantity: 1,
  }
  const binding = {
    jobId: job.job_id, jobType: "LUNA_SHIPPING_QTY1",
    accountKey: job.account_key, marketplace: "EBAY_US",
    ownerUserId: job.owner_user_id,
    opportunityId: job.opportunity_id,
    candidateKey: job.candidate_key,
    sku: job.sku, productId: job.product_id,
    variantId: job.variant_id, quantity: 1,
    destinationProfile: "LUNA_BOCA_RATON_US",
    idempotencyKey: claimedJob.idempotency_key,
    leaseExpiresAt: claimedJob.lease_expires_at,
  }
  const input = { supabase, accountKey: job.account_key,
    ownerUserId: job.owner_user_id, capture, binding,
    sessionSecret, now }
  await assert.rejects(() => persistLunaShippingQty1OpportunityCaptureV1({
    ...input, binding: { ...binding, sku: "WRONG-SKU" },
  }), /LUNA_SHIPPING_QTY1_RESULT_BINDING_INVALID/)
  claimedJob.status = "PENDING"
  await assert.rejects(() => persistLunaShippingQty1OpportunityCaptureV1(input),
    /LUNA_SHIPPING_QTY1_JOB_CLAIM_UNPROVEN/)
})
