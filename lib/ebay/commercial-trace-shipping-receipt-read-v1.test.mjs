import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return {
    url: "data:text/javascript,export%20%7B%7D", shortCircuit: true,
  }
  if (specifier.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(specifier)) {
    try { return nextResolve(`${specifier}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const { readCommercialTraceShippingReceiptV1 } = await import(
  "./ebay-luna-chrome-shipping-capture-server-v1.ts")
const { deriveCurrentCommercialCandidateIdentityV1 } = await import(
  "./ebay-current-commercial-candidate-identity-v1.ts")

const accountKey = "test-account"
const productId = "9220832493792"
const variantId = "48809643540704"
const supplierSku = "ITEM-8049-ORA-LU-DE"
const traceId = "11111111-1111-4111-8111-111111111111"
const priorTraceId = "22222222-2222-4222-8222-222222222222"
const sourceFingerprint = `sha256:${"b".repeat(64)}`
const fieldTruthEvidenceDigest = `sha256:${"1".repeat(64)}`
const receiptId = "33333333-3333-4333-8333-333333333333"
const now = Date.parse("2026-09-23T18:00:00Z")

function mockSupabase(changes = {}) {
  const calls = []
  return { calls, from(table) {
    const query = { table, filters: {}, select(value) {
      this.columns = value; return this
    }, eq(key, value) { this.filters[key] = value; return this },
    gte(key, value) { this.filters[`${key}:gte`] = value; return this },
    in(key, value) { this.filters[key] = value; return this },
    contains(key, value) { this.filters[key] = value; return this },
    order() { return this },
    limit(count) {
      calls.push({ table, count, filters: this.filters, columns: this.columns })
      if (table === "ebay_same_day_pilot_runs") return Promise.resolve({
        data: changes.noRuns ? [] : [{ id: "44444444-4444-4444-8444-444444444444" }],
        error: null,
      })
      const identity = this.filters.event_payload
      const payload = { contractVersion:
          "SELLER_OS_COMMERCIAL_TRACE_LUNA_SHIPPING_RECEIPT_V1",
        shippingContractVersion: "LUNA_SHIPPING_QUOTE_CAPTURE_V1",
        traceId: priorTraceId,
        candidateId: deriveCurrentCommercialCandidateIdentityV1({
          accountKey, productId, variantId, supplierSku }).canonicalCandidateId,
        lunaProductId: productId, lunaVariantId: variantId, supplierSku,
        sourceFingerprint, fieldTruthEvidenceDigest,
        destinationProfileDigest: identity.destinationProfileDigest,
        canonicalDestinationMatch: true, quantity: 1, currency: "USD",
        acquisitionMethod: "LUNA_AUTHENTICATED_HTTP_CART_SHIPPING",
        noPurchase: true, noCredentials: true, noRawDestinationAddress: true,
        evidenceDigest: `sha256:${"d".repeat(64)}`,
        observedAt: "2026-09-23T17:00:00Z", shippingUsd: 6.99,
        ...changes.receipt,
      }
      return Promise.resolve({ data: [{ id: receiptId,
        created_at: "2026-09-23T17:00:02Z", event_payload: payload }],
        error: null })
    } }
    return query
  } }
}

function read(supabase, extra = {}) {
  return readCommercialTraceShippingReceiptV1({ supabase, accountKey,
    traceId, lunaProductId: productId, lunaVariantId: variantId,
    supplierSku, sourceFingerprint, fieldTruthEvidenceDigest,
    allowCrossTraceReuse: true, now, ...extra })
}

test("reader reuses one exact fresh durable receipt, account scoped and read-only", async () => {
  const db = mockSupabase()
  const result = await read(db)
  assert.equal(result.amountUsd, 6.99)
  assert.equal(result.durableReceiptId, receiptId)
  assert.equal(result.sourceTraceId, priorTraceId)
  assert.equal(result.freshUntil, "2026-09-23T23:00:00.000Z")
  assert.equal(db.calls.length, 2)
  assert.equal(db.calls[0].filters.marketplace_account_key, accountKey)
  assert.equal(db.calls[1].filters.event_payload.fieldTruthEvidenceDigest,
    fieldTruthEvidenceDigest)
  assert.equal(db.calls[1].filters.event_payload.quantity, 1)
  assert.equal(db.calls[1].filters["created_at:gte"],
    "2026-09-23T11:59:00.000Z")
  assert.deepEqual(db.calls.map((call) => call.table),
    ["ebay_same_day_pilot_runs", "ebay_same_day_pilot_events"])
})

test("reader rejects cross-trace receipt without opt-in and stale evidence", async () => {
  assert.equal(await read(mockSupabase(), { allowCrossTraceReuse: false }), null)
  assert.equal(await read(mockSupabase({ receipt: {
    observedAt: "2026-09-23T11:00:00Z" } })), null)
  assert.equal(await read(mockSupabase({ receipt: {
    fieldTruthEvidenceDigest: `sha256:${"2".repeat(64)}` } })), null)
  assert.equal(await read(mockSupabase({ noRuns: true })), null)
})
