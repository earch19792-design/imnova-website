import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export default {}", shortCircuit: true }
  }
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const domain = await import("./ebay-live-listing-shipping-evidence-v1.ts")
const server = await import(
  "./ebay-live-listing-shipping-evidence-server-v1.ts")
const chromeCaptureServer = await import(
  "./ebay-luna-chrome-shipping-capture-server-v1.ts")

const LINKAGE_ID = `luna-linkage-v1:sha256:${"1".repeat(64)}`
const target = Object.freeze({
  accountKey: "imnova-ebay-main",
  marketplaceId: "EBAY_US",
  ebayItemId: "366582586826",
  lunaProductId: "9220805755104",
  lunaVariantId: "48809607659744",
  sourceSku: "ITEM5810",
})

function quote(observedAt = "2026-08-30T01:00:00.000Z") {
  return Object.freeze({
    status: "AVAILABLE",
    subtotalUsd: 44.20,
    shippingAmountUsd: 9.99,
    currency: "USD",
    acquisitionMethod: "LUNA_AUTHENTICATED_HTTP_CART_SHIPPING",
    observedAt,
    evidenceDigest: `sha256:${"2".repeat(64)}`,
    exactLunaIdentity: true,
    destinationProfileId: "LUNA_BOCA_RATON_US",
    destinationProfileDigest: `sha256:${"3".repeat(64)}`,
    noPurchase: true,
    noPayment: true,
  })
}

function fakeSupabase(overrides = {}) {
  const tables = []
  const state = { evidence: null, inserts: 0 }
  const rows = {
    ebay_active_listings: [{ id: "active-1", ebay_item_id: target.ebayItemId,
      listing_status: "active", title: "Exact ITEM5810 product",
      ebay_price: 71.99, currency: "USD",
      market_radar_product_id: null, supplier_variant_id: null,
      supplier_sku: null, supplier_cost_at_linking: 44.20 }],
    seller_os_luna_linkage_decisions: [{
      decision_id: `luna-linkage-decision-v1:sha256:${"4".repeat(64)}`,
      decision_version: 1, decision: "APPROVE_EXACT_LINKAGE",
      linkage_id: LINKAGE_ID, luna_product_id: target.lunaProductId,
      luna_variant_id: target.lunaVariantId, luna_sku: target.sourceSku,
    }],
    market_radar_latest_variants: [{
      product_id: "7f8497f3-7f05-4fd5-b21a-b387089262d1",
      supplier_product_id: target.lunaProductId,
      supplier_variant_id: target.lunaVariantId, sku: target.sourceSku,
      price: 44.20,
      product_url: "https://www.lunaportex.com/products/exact-item-5810",
      captured_at: "2026-08-30T00:00:00.000Z" }],
    ...overrides,
  }
  class Query {
    constructor(table) { this.table = table; this.operation = "select" }
    select() { return this }
    eq() { return this }
    order() { return this }
    limit() { return this }
    insert(value) { this.operation = "insert"; this.inserted = value; return this }
    result() {
      if (this.table === "seller_os_live_listing_shipping_evidence") {
        if (this.operation === "insert") {
          state.inserts += 1
          if (state.evidence) return { data: null, error: { code: "23505" } }
          state.evidence = this.inserted
          return { data: null, error: null }
        }
        return { data: state.evidence ? { ...state.evidence,
          observed_at: state.evidence.observed_at
            .replace(/\.000Z$/, "+00:00") } : null, error: null }
      }
      return { data: rows[this.table] ?? [], error: null }
    }
    maybeSingle() { return Promise.resolve(this.result()) }
    then(resolve, reject) { return Promise.resolve(this.result()).then(resolve, reject) }
  }
  return { client: { from(table) { tables.push(table); return new Query(table) } },
    tables, state }
}

test("exact CURRENT LIVE dispatch uses one transient Chrome job and the existing durable evidence store", async () => {
  const fake = fakeSupabase()
  const now = Date.parse("2026-08-30T01:00:01.000Z")
  const secret = "s".repeat(64)
  const job = await chromeCaptureServer
    .resolveLunaChromeShippingLiveListingJobV1({
      supabase: fake.client, target, sessionSecret: secret, now,
    })
  assert.match(job.identity.candidateId, /^sha256:[0-9a-f]{64}$/)
  assert.equal(job.identity.lunaProductId, target.lunaProductId)
  assert.equal(job.identity.lunaVariantId, target.lunaVariantId)
  assert.equal(job.identity.supplierSku, target.sourceSku)
  assert.equal(job.salePriceUsd, 71.99)
  assert.equal(job.supplierCostUsd, 44.20)
  const capture = {
    candidateId: job.identity.candidateId,
    lunaProductId: target.lunaProductId,
    lunaVariantId: target.lunaVariantId,
    supplierSku: target.sourceSku,
    quantity: 1,
    subtotalUsd: 44.20,
    shippingUsd: 9.99,
    totalUsd: 54.19,
    currency: "USD",
    observedAt: new Date(now).toISOString(),
    acquisitionMethod: "LUNA_AUTHENTICATED_HTTP_CART_SHIPPING",
    evidenceDigest: `sha256:${"9".repeat(64)}`,
    captureSessionId: job.captureSessionId,
    nonce: job.nonce,
    canonicalDestinationAuthority:
      "OPERATOR_BOUND_CANONICAL_US_DESTINATION_V1",
    canonicalDestinationFingerprint: job.destination.profileDigest,
    canonicalDestinationMatch: true,
    selectedShippingStateProof: "SINGLE_CANONICAL_RATE",
  }
  const result = await chromeCaptureServer
    .persistLunaChromeLiveListingShippingCaptureV1({
      supabase: fake.client, target, capture, sessionSecret: secret, now,
    })
  assert.equal(result.chromeShippingCaptureAttempts, 1)
  assert.equal(result.serverHttpLunaRequests, 0)
  assert.equal(result.shippingCost, 9.99)
  assert.equal(result.shippingCurrency, "USD")
  assert.equal(result.durableShippingEvidence, true)
  assert.equal(result.durableReadbackMatch, true)
  assert.equal(result.purchaseBoundaryEnforced, true)
  assert.equal(result.rawAddressPersisted, false)
  assert.equal(result.marketplaceWrites, 0)
  assert.equal(fake.state.inserts, 1)
  assert.equal(fake.tables.includes(
    "seller_os_profitability_frontier_snapshots"), false)
  assert.equal(fake.tables.includes("ebay_luna_opportunity_queue"), false)
  assert.equal(fake.tables.includes("ebay_listing_packages"), false)
})

test("CURRENT LIVE exact lineage uses the existing Luna reader and persists exact durable evidence", async () => {
  const fake = fakeSupabase()
  let readerCalls = 0
  const result = await server.captureLiveListingShippingEvidenceV1({
    supabase: fake.client,
    target,
    now: Date.parse("2026-08-30T01:00:01.000Z"),
    acquire: async (identity) => {
      readerCalls += 1
      assert.match(identity.readerScopeId,
        /^live-listing-shipping-reader-v1:sha256:[0-9a-f]{64}$/)
      assert.equal(identity.candidateId, undefined)
      assert.equal(identity.lunaProductId, target.lunaProductId)
      return { status: "AVAILABLE", quote: quote() }
    },
  })
  assert.equal(readerCalls, 1)
  assert.equal(result.exactLiveIdentity, true)
  assert.equal(result.supplierLinkage, "CERTIFIED")
  assert.equal(result.purchaseBoundaryEnforced, true)
  assert.equal(result.shippingCostStatus, "AVAILABLE")
  assert.equal(result.shippingCurrencyStatus, "AVAILABLE")
  assert.equal(result.shippingCost, 9.99)
  assert.equal(result.shippingCurrency, "USD")
  assert.equal(result.durableShippingEvidence, true)
  assert.equal(result.durableReadbackMatch, true)
  assert.equal(result.rawAddressPersisted, false)
  assert.equal(result.credentialsPersisted, false)
  assert.equal(result.marketplaceWrites, 0)
  assert.equal(fake.state.evidence.destination_fingerprint,
    `sha256:${"3".repeat(64)}`)
  assert.equal("raw_address" in fake.state.evidence, false)
  assert.equal("cookie" in fake.state.evidence, false)
  assert.equal("credentials" in fake.state.evidence, false)
  for (const forbidden of ["seller_os_profitability_frontier_snapshots",
    "ebay_luna_opportunity_queue", "ebay_listing_packages",
    "ebay_listing_experiments_v1"]) {
    assert.equal(fake.tables.includes(forbidden), false)
  }
})

test("same quote is idempotent and reuses the append-only evidence identity", async () => {
  const fake = fakeSupabase()
  const acquire = async () => ({ status: "AVAILABLE", quote: quote() })
  const first = await server.captureLiveListingShippingEvidenceV1({
    supabase: fake.client, target, acquire })
  const second = await server.captureLiveListingShippingEvidenceV1({
    supabase: fake.client, target, acquire })
  assert.equal(first.evidenceId, second.evidenceId)
  assert.equal(fake.state.inserts, 2)
  assert.equal(second.durableReadbackMatch, true)
})

test("durable readback compares Postgres UTC offsets and JavaScript Z timestamps as the same instant", () => {
  const expected = domain.buildLiveListingShippingEvidenceV1({
    identity: { ...target, linkageId: LINKAGE_ID }, quote: quote(),
  })
  const postgresReadback = { ...expected,
    observed_at: expected.observed_at.replace(/\.000Z$/, "+00:00") }
  assert.notEqual(postgresReadback.observed_at, expected.observed_at)
  assert.equal(domain.liveListingShippingReadbackMatchesV1(
    expected, postgresReadback), true)
  assert.equal(domain.liveListingShippingReadbackMatchesV1(expected, {
    ...postgresReadback, observed_at: "2026-08-30T01:00:01+00:00",
  }), false)
})

test("identity mismatch fails closed before Luna reader execution", async () => {
  const fake = fakeSupabase({ seller_os_luna_linkage_decisions: [{
    decision_id: "decision", decision_version: 1,
    decision: "APPROVE_EXACT_LINKAGE", linkage_id: LINKAGE_ID,
    luna_product_id: target.lunaProductId,
    luna_variant_id: "48809607659745", luna_sku: target.sourceSku,
  }] })
  let readerCalls = 0
  await assert.rejects(server.captureLiveListingShippingEvidenceV1({
    supabase: fake.client, target,
    acquire: async () => { readerCalls += 1; return {
      status: "AVAILABLE", quote: quote() } },
  }), /LIVE_LISTING_SHIPPING_CERTIFIED_LINKAGE_REQUIRED/)
  assert.equal(readerCalls, 0)
  assert.equal(fake.state.inserts, 0)
})

test("missing exact catalog variant never falls back to title inference", async () => {
  const fake = fakeSupabase({ market_radar_latest_variants: [] })
  await assert.rejects(server.captureLiveListingShippingEvidenceV1({
    supabase: fake.client, target,
    acquire: async () => ({ status: "AVAILABLE", quote: quote() }),
  }), /LIVE_LISTING_SHIPPING_EXACT_LUNA_VARIANT_REQUIRED/)
  assert.equal(fake.state.inserts, 0)
})

test("browser fallback failure preserves bounded primary rate-limit evidence", async () => {
  const fake = fakeSupabase()
  let observed = null
  try {
    await server.captureLiveListingShippingEvidenceV1({
      supabase: fake.client,
      target,
      acquire: async () => ({
        status: "BLOCKED",
        quote: null,
        blocker: "LUNA_PROTECTED_BROWSER_UNAVAILABLE",
        rateLimitEvidence: {
          classificationOrigin: "CURRENT_HTTP_429",
          upstreamHttpStatusClass: "HTTP_429",
          retryAfterPresent: false,
          retryAfterClass: "ABSENT",
          retryAfterSafeValue: null,
          finalUrlHostClass: "LUNA_WWW",
          finalPathClass: "LUNA_CART_SNAPSHOT",
          cooldownRemainingClass: null,
        },
      }),
    })
  } catch (error) { observed = error }
  assert.ok(observed instanceof
    server.LiveListingShippingEvidenceCaptureErrorV1)
  assert.equal(observed.message, "LUNA_PROTECTED_BROWSER_UNAVAILABLE")
  assert.equal(observed.rateLimitEvidence.classificationOrigin,
    "CURRENT_HTTP_429")
  assert.equal(observed.rateLimitEvidence.retryAfterClass, "ABSENT")
  assert.equal(fake.state.inserts, 0)
})

test("freshness preserves FRESH, STALE and UNPROVEN as distinct states", () => {
  const row = { observed_at: "2026-08-30T01:00:00.000Z",
    maximum_age_seconds: 21600 }
  assert.equal(domain.readLiveListingShippingFreshnessV1({ row,
    now: Date.parse("2026-08-30T06:59:59.000Z") }).status, "FRESH")
  assert.equal(domain.readLiveListingShippingFreshnessV1({ row,
    now: Date.parse("2026-08-30T07:00:01.000Z") }).status, "STALE")
  assert.equal(domain.readLiveListingShippingFreshnessV1({ row: {
    ...row, maximum_age_seconds: 1 }, now: Date.now() }).status, "UNPROVEN")
})

test("migration creates one protected semantic store and no scheduler or parallel pipeline", async () => {
  const migration = await readFile(new URL("../../supabase/migrations/20260830012105_create_live_listing_luna_shipping_evidence_v1.sql", import.meta.url), "utf8")
  assert.equal((migration.match(/create table public\./gi) ?? []).length, 1)
  assert.match(migration, /seller_os_live_listing_shipping_evidence/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /force row level security/)
  assert.match(migration, /purchase_performed is false/)
  assert.match(migration, /raw_address_persisted is false/)
  assert.doesNotMatch(migration, /pg_cron|cron\.schedule|create pipeline|state machine/i)
})

test("existing admin route exposes bounded capture with normal admin auth and zero marketplace writes", async () => {
  const route = await readFile(new URL("../../app/api/admin/ebay/operational-readiness/route.ts", import.meta.url), "utf8")
  assert.match(route, /validateAdminApiRequest\(req\)/)
  assert.match(route, /CAPTURE_LIVE_LISTING_SHIPPING_EVIDENCE/)
  assert.match(route, /captureLiveListingShippingEvidenceV1/)
  assert.match(route, /LiveListingShippingEvidenceCaptureErrorV1/)
  assert.match(route, /rateLimitEvidence: error\.rateLimitEvidence/)
  assert.match(route, /marketplaceWrites: 0/)
})

test("existing Chrome route dispatches and certifies exact LIVE evidence without the server HTTP reader", async () => {
  const [route, page, bridge] = await Promise.all([
    readFile(new URL(
      "../../app/api/admin/ebay/luna-shipping-capture/route.ts",
      import.meta.url), "utf8"),
    readFile(new URL(
      "../../app/admin/ebay/luna-shipping-capture/luna-shipping-capture-control-plane.tsx",
      import.meta.url), "utf8"),
    readFile(new URL(
      "./ebay-luna-chrome-shipping-capture-server-v1.ts",
      import.meta.url), "utf8"),
  ])
  assert.match(route, /resolve_live_listing_job/)
  assert.match(route, /certify_live_listing_capture/)
  assert.match(route, /persistLunaChromeLiveListingShippingCaptureV1/)
  assert.match(route, /serverHttpLunaRequests: 0/)
  assert.match(page, /Capturar envío del listing LIVE exacto/)
  assert.match(page, /mode === "LIVE"/)
  assert.match(page, /LIVE_LISTING_SHIPPING_EVIDENCE_PERSISTED/)
  assert.match(bridge, /persistLiveListingShippingQuoteV1/)
  assert.match(bridge,
    /durableStore: "seller_os_live_listing_shipping_evidence"/)
  const liveBridge = bridge.match(
    /export async function resolveLunaChromeShippingLiveListingJobV1[\s\S]*?export async function resolveLunaChromeShippingJobsV1/)?.[0] ?? ""
  assert.doesNotMatch(liveBridge, /acquireCanonicalLunaShippingV1/)
  assert.doesNotMatch(liveBridge,
    /put_seller_os_profitability_frontier_v1/)
  assert.doesNotMatch(liveBridge, /ebay_listing_packages/)
})
