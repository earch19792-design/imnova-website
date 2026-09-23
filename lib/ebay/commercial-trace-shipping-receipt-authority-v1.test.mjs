import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const { certifyCommercialTraceShippingReceiptV1 } = await import(
  "./commercial-trace-shipping-receipt-authority-v1.ts")
const now = Date.parse("2026-09-23T18:00:00.000Z")
const traceId = "11111111-1111-4111-8111-111111111111"
const priorTraceId = "22222222-2222-4222-8222-222222222222"
const receiptId = "33333333-3333-4333-8333-333333333333"
const expected = Object.freeze({ traceId,
  candidateId: `sha256:${"a".repeat(64)}`,
  lunaProductId: "9220832493792",
  lunaVariantId: "48809643540704",
  supplierSku: "ITEM-8049-ORA-LU-DE",
  sourceFingerprint: `sha256:${"b".repeat(64)}`,
  fieldTruthEvidenceDigest: `sha256:${"1".repeat(64)}`,
  destinationProfileDigest: `sha256:${"c".repeat(64)}` })
const receipt = () => ({
  contractVersion: "SELLER_OS_COMMERCIAL_TRACE_LUNA_SHIPPING_RECEIPT_V1",
  shippingContractVersion: "LUNA_SHIPPING_QUOTE_CAPTURE_V1",
  traceId: priorTraceId, candidateId: expected.candidateId,
  lunaProductId: expected.lunaProductId,
  lunaVariantId: expected.lunaVariantId,
  supplierSku: expected.supplierSku,
  sourceFingerprint: expected.sourceFingerprint,
  fieldTruthEvidenceDigest: expected.fieldTruthEvidenceDigest,
  destinationProfileDigest: expected.destinationProfileDigest,
  canonicalDestinationMatch: true, quantity: 1, currency: "USD",
  acquisitionMethod: "LUNA_AUTHENTICATED_HTTP_CART_SHIPPING",
  noPurchase: true, noCredentials: true, noRawDestinationAddress: true,
  evidenceDigest: `sha256:${"d".repeat(64)}`,
  observedAt: "2026-09-23T17:00:00.000Z", shippingUsd: 6.99,
})
const certify = (candidate, options = {}) =>
  certifyCommercialTraceShippingReceiptV1({ receipt: candidate,
    receiptId, capturedAt: "2026-09-23T17:00:02.000Z",
    expected, allowCrossTraceReuse: true, now, ...options })

test("fresh exact qty1 receipt is durable and reusable across traces", () => {
  const result = certify(receipt())
  assert.equal(result.amountUsd, 6.99)
  assert.equal(result.durableReceiptId, receiptId)
  assert.equal(result.sourceTraceId, priorTraceId)
  assert.equal(result.sourceFingerprint, expected.sourceFingerprint)
  assert.equal(result.fieldTruthEvidenceDigest,
    expected.fieldTruthEvidenceDigest)
  assert.equal(result.freshUntil, "2026-09-23T23:00:00.000Z")
  assert.equal(result.shippingServiceStatus, "UNKNOWN")
  assert.equal(certify(receipt(), { allowCrossTraceReuse: false }), null)
})

test("stale or missing observation cannot borrow an event/frontier timestamp", () => {
  assert.equal(certify({ ...receipt(), observedAt: "2026-09-23T12:00:00.000Z" }), null)
  assert.equal(certify({ ...receipt(), observedAt: null }), null)
  assert.equal(certify({ ...receipt(), shippingUsd: null }), null)
  assert.equal(certify({ ...receipt(), shippingUsd: 6.99 }, {
    capturedAt: "2026-09-23T16:00:00.000Z" }), null)
})

test("identity, destination, quantity and provenance fail closed", () => {
  for (const change of [
    { lunaVariantId: "48809643540705" }, { supplierSku: "OTHER" },
    { candidateId: `sha256:${"e".repeat(64)}` },
    { sourceFingerprint: `sha256:${"f".repeat(64)}` },
    { fieldTruthEvidenceDigest: `sha256:${"2".repeat(64)}` },
    { destinationProfileDigest: `sha256:${"0".repeat(64)}` },
    { quantity: 2 }, { currency: "EUR" }, { noPurchase: false },
    { noCredentials: false }, { acquisitionMethod: "UNVERIFIED" },
    { evidenceDigest: null },
  ]) assert.equal(certify({ ...receipt(), ...change }), null)
})

test("Trace uses only exact receipts and never the 24-hour frontier fallback", () => {
  const trace = readFileSync("lib/ebay/seller-os-live-commercial-trace-v1.ts", "utf8")
  const shipping = trace.slice(trace.indexOf("async function latestShipping"),
    trace.indexOf("async function completeFailure"))
  assert.match(shipping, /allowCrossTraceReuse: true/)
  assert.doesNotMatch(shipping, /get_seller_os_latest_profitability_frontiers_v1/)
  assert.doesNotMatch(trace, /SHIPPING_MAX_AGE_MS = 24/)
})
