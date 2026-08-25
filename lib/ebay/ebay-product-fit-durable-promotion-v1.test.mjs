import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const subject = await import("./ebay-product-fit-durable-promotion-v1.ts")

const FAMILY_ID = `market-family-v1:sha256:${"a".repeat(64)}`
const ACCOUNT_KEY = `seller:${"b".repeat(64)}`
const RUN_ID = "00000000-0000-4000-8000-000000000001"

function revalidation(overrides = {}) {
  const identity = {
    familyId: FAMILY_ID,
    lunaProductId: "9220832329952",
    lunaVariantId: "48809643376864",
    supplierSku: "ITEM3760",
  }
  return {
    contractVersion: subject.SELLER_OS_PRODUCT_FIT_STRONG_REVALIDATION_VERSION,
    candidateId: subject.sellerOsShippingCandidateIdV1(identity),
    ...identity,
    productFitBefore: "MEDIUM",
    productFitAfter: "STRONG",
    exactLunaProductId: true,
    exactLunaVariantId: true,
    exactSupplierSku: true,
    exactProductSemantics: true,
    variantCompatibility: true,
    noTitleOnlyInference: true,
    evidenceComplete: true,
    evidenceReference: "luna-public-product-json-v1:9220832329952",
    evidenceDigest: `sha256:${"c".repeat(64)}`,
    evidenceVersion: "SELLER_OS_PRODUCT_FIT_REVALIDATION_EVIDENCE_V1",
    evidenceObservedAt: "2026-08-24T12:00:00.000Z",
    evaluatedAt: "2026-08-24T12:00:01.000Z",
    ...overrides,
  }
}

function fakeSupabase(options = {}) {
  const state = {
    runs: [{ id: RUN_ID, marketplace_account_key: ACCOUNT_KEY,
      marketplace: "EBAY_US", created_at: "2026-08-24T12:00:00.000Z" }],
    candidates: [],
    events: [],
  }
  class Query {
    constructor(table) { this.table = table; this.filters = [] }
    select() { return this }
    eq(key, value) { this.filters.push(["eq", key, value]); return this }
    in(key, value) { this.filters.push(["in", key, value]); return this }
    order() { return this }
    limit(value) { this.maximum = value; return this }
    upsert(value) {
      if (options.writeFails) return Promise.resolve({ error: new Error("write") })
      const values = Array.isArray(value) ? value : [value]
      for (const row of values) {
        if (!state.events.some((event) =>
          event.idempotency_key === row.idempotency_key)) {
          state.events.push({ ...row, created_at: new Date().toISOString() })
        }
      }
      return Promise.resolve({ error: null })
    }
    rows() {
      let rows = this.table === "ebay_same_day_pilot_runs" ? state.runs
        : this.table === "ebay_same_day_pilot_candidates" ? state.candidates
          : state.events
      for (const [operator, key, value] of this.filters) {
        rows = rows.filter((row) => operator === "eq"
          ? row[key] === value : value.includes(row[key]))
      }
      return rows.slice(0, this.maximum ?? rows.length)
    }
    then(resolve, reject) {
      return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject)
    }
    async maybeSingle() {
      if (options.readbackFails && this.table === "ebay_same_day_pilot_events") {
        return { data: null, error: new Error("readback") }
      }
      const rows = this.rows()
      return { data: rows[0] ?? null, error: rows.length > 1
        ? new Error("multiple") : null }
    }
  }
  return { state, client: { from: (table) => new Query(table) } }
}

test("MEDIUM to valid STRONG persists, reads back, and overrides stale MEDIUM", async () => {
  const database = fakeSupabase()
  const saved = await subject.persistProductFitStrongPromotionV1({
    supabase: database.client,
    accountKey: ACCOUNT_KEY,
    revalidation: revalidation(),
  })
  assert.equal(saved.productFitStrongDurable, true)
  assert.equal(saved.durableWriteVerified, true)
  assert.equal(saved.durableReadbackMatch, true)
  const promotions = await subject.readProductFitStrongPromotionsV1({
    supabase: database.client,
    accountKey: ACCOUNT_KEY,
    candidateIds: [revalidation().candidateId],
  })
  const authority = subject.resolveDurableProductFitStrongV1({
    candidateId: revalidation().candidateId,
    familyId: FAMILY_ID,
    lunaProductId: "9220832329952",
    lunaVariantId: "48809643376864",
    supplierSku: "ITEM3760",
    frontierProductFit: "MEDIUM",
    frontierCalculatedAt: "2026-08-23T12:00:00.000Z",
    promotion: promotions.get(revalidation().candidateId),
  })
  assert.equal(authority.productFitStrongDurable, true)
  assert.equal(authority.authority,
    subject.SELLER_OS_PRODUCT_FIT_DURABLE_PROMOTION_VERSION)
})

test("STRONG without a durable receipt remains ineligible and stale promotion loses", () => {
  const input = {
    candidateId: revalidation().candidateId,
    familyId: FAMILY_ID,
    lunaProductId: "9220832329952",
    lunaVariantId: "48809643376864",
    supplierSku: "ITEM3760",
    frontierProductFit: "MEDIUM",
    frontierCalculatedAt: "2026-08-25T12:00:00.000Z",
  }
  assert.equal(subject.resolveDurableProductFitStrongV1(input)
    .productFitStrongDurable, false)
  assert.equal(subject.resolveDurableProductFitStrongV1({ ...input,
    promotion: subject.buildProductFitDurablePromotionV1(revalidation()) })
    .productFitStrongDurable, false)
})

test("durable failures and identity mismatches fail closed", async () => {
  await assert.rejects(() => subject.persistProductFitStrongPromotionV1({
    supabase: fakeSupabase({ writeFails: true }).client,
    accountKey: ACCOUNT_KEY,
    revalidation: revalidation(),
  }), /PRODUCT_FIT_DURABLE_WRITE_FAILED/)
  await assert.rejects(() => subject.persistProductFitStrongPromotionV1({
    supabase: fakeSupabase({ readbackFails: true }).client,
    accountKey: ACCOUNT_KEY,
    revalidation: revalidation(),
  }), /PRODUCT_FIT_DURABLE_READBACK_FAILED/)
  assert.throws(() => subject.buildProductFitDurablePromotionV1(revalidation({
    lunaVariantId: "48809643376865",
  })), /PRODUCT_FIT_STRONG_REVALIDATION_INVALID/)
  assert.throws(() => subject.buildProductFitDurablePromotionV1(revalidation({
    exactProductSemantics: false,
  })), /PRODUCT_FIT_STRONG_REVALIDATION_INVALID/)
})

test("production resolver consumes the same durable authority without new infra", async () => {
  const [resolver, route, module] = await Promise.all([
    readFile(new URL("./ebay-luna-chrome-shipping-capture-server-v1.ts",
      import.meta.url), "utf8"),
    readFile(new URL("../../app/api/admin/ebay/luna-shipping-capture/route.ts",
      import.meta.url), "utf8"),
    readFile(new URL("./ebay-product-fit-durable-promotion-v1.ts",
      import.meta.url), "utf8"),
  ])
  assert.match(resolver, /readProductFitStrongPromotionsV1/)
  assert.match(resolver, /resolveDurableProductFitStrongV1/)
  assert.match(route, /promote_product_fit_strong/)
  assert.match(module, /ebay_same_day_pilot_events/)
  assert.doesNotMatch(resolver + route + module,
    /create table|alter table|create migration/i)
})
