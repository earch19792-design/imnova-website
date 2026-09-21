import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { registerHooks } from "node:module"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const control = await import("./teo-commercial-trace-control-v1.ts")
const mcp = readFileSync("lib/ebay/teo-pre-research-control-mcp-v1.ts", "utf8")
const engine = readFileSync("lib/ebay/seller-os-live-commercial-trace-v1.ts", "utf8")
const migration = readFileSync(
  "supabase/migrations/20260920200313_teo_commercial_trace_control_v1.sql",
  "utf8")

const request = { productId: "9220790976736", variantId: "48809590227168",
  sku: "ITEM6952", clientIdempotencyKey: "teo.trace.6952.001" }

test("Commercial Trace request accepts only exact identity and idempotency", () => {
  assert.deepEqual(control.parseTeoCommercialTraceRequestV1(request), request)
  for (const forbidden of ["url", "sql", "path", "ownerUserId",
    "commandClientId", "publisher", "marketplaceWrite"]) {
    assert.throws(() => control.parseTeoCommercialTraceRequestV1({ ...request,
      [forbidden]: "spoofed" }), /TEO_COMMERCIAL_TRACE_REQUEST_INVALID/)
  }
  assert.throws(() => control.parseTeoCommercialTraceRequestV1({ ...request,
    sku: "ITEM6952\nDROP" }), /TEO_COMMERCIAL_TRACE_REQUEST_INVALID/)
  assert.throws(() => control.parseTeoCommercialTraceRequestV1({ ...request,
    clientIdempotencyKey: "short" }), /TEO_COMMERCIAL_TRACE_REQUEST_INVALID/)
})

test("Control exposes request/get only and deliberately has no Trace resume", () => {
  assert.match(mcp, /seller_os_request_commercial_trace/)
  assert.match(mcp, /seller_os_get_commercial_trace/)
  assert.doesNotMatch(mcp, /seller_os_resume_commercial_trace/)
  assert.match(mcp, /readOnlyHint: false[\s\S]*idempotentHint: true/)
  assert.doesNotMatch(mcp, /inputSchema:[\s\S]{0,180}(?:url|sql|path):/i)
})

test("dedicated capability is owner/client/account/resource bound", () => {
  for (const binding of ["owner_user_id", "command_client_id",
    "marketplace_account_key", "oauth_resource", "allowed_contract_version",
    "client_idempotency_key", "request_digest"]) {
    assert.match(migration, new RegExp(`\\b${binding}\\b`))
  }
  assert.match(migration, /TEO_COMMERCIAL_TRACE_V1/)
  assert.match(migration, /SELLER_OS_LIVE_COMMERCIAL_TRACE_V1/)
  assert.match(migration, /force row level security/g)
  assert.match(migration, /is_seller_os_service_role_request_v1\(\)/)
  assert.doesNotMatch(migration,
    /ebay_active_listings|seller_os_publisher_|stockguard|delete\s+from|truncate\s+/i)
})

test("database gate validates current canonical Product Truth and exact binding", () => {
  for (const value of ["LUNA_FIELD_PRODUCT_TRUTH_V1", "sourceSnapshotId",
    "sourceProductId", "sourceVariantId", "sourceSupplierSku",
    "sourceCatalogFingerprint", "evidenceDigest", "SEMANTIC_CLASS",
    "EVIDENCE_STATUS", "CONTRADICTION", "FRESH_UNTIL"]) {
    assert.match(migration, new RegExp(value))
  }
  for (const field of ["LUNA_PRODUCT_ID", "LUNA_VARIANT_ID", "SUPPLIER_SKU",
    "TITLE", "SUPPLIER_COST", "SUPPLIER_AVAILABILITY"]) {
    assert.match(migration, new RegExp(field))
  }
})

test("canonical engine accepts only an unused row or exact bounded replay", () => {
  assert.match(engine, /LIVE_COMMERCIAL_TRACE_PREAUTHORIZATION_INVALID/)
  assert.match(engine, /reserved\.data\.account_key !== input\.accountKey/)
  assert.match(engine, /reserved\.data\.product_url !== canonicalUrl/)
  assert.match(engine, /reserved\.data\.started_by !==/)
  assert.match(engine, /EXACT_IDEMPOTENT_REPLAY_AFTER_SHIPPING/)
  assert.match(engine,
    /EXACT_IDEMPOTENT_REPLAY_AFTER_PRICING_ENRICHMENT/)
  assert.match(engine, /HOLD_SHIPPING_UNPROVEN/)
  assert.match(engine, /HOLD_PRICING_EVIDENCE_QUALITY/)
  assert.match(engine, /LIVE_COMMERCIAL_TRACE_CONTINUATION_CONFLICT/)
  assert.match(engine, /priorResultPreserved: true/)
})

test("exact replay dispatches an eligible refresh before reopening the Trace", () => {
  assert.equal(control.decideTeoCommercialTracePricingReplayV1(null),
    "DISPATCH_INITIAL")
  assert.equal(control.decideTeoCommercialTracePricingReplayV1({
    refreshEligible: true }), "DISPATCH_REFRESH")
  assert.equal(control.decideTeoCommercialTracePricingReplayV1({
    refreshEligible: false }), "REEVALUATE_TRACE")
  const source = readFileSync(
    "lib/ebay/teo-commercial-trace-control-v1.ts", "utf8")
  const branch = source.slice(source.indexOf(
    "const pricingReplayAction = decideTeoCommercialTracePricingReplayV1"),
  source.indexOf("return getTeoCommercialTraceV1", source.indexOf(
    "const pricingReplayAction = decideTeoCommercialTracePricingReplayV1")))
  assert.match(branch,
    /pricingReplayAction === "REEVALUATE_TRACE"[\s\S]*runSellerOsLiveCommercialTraceV1/)
  assert.match(branch,
    /else \{[\s\S]*enqueueCommercialTracePricingEnrichmentV1/)
  assert.ok(branch.indexOf("enqueueCommercialTracePricingEnrichmentV1") >
    branch.indexOf("else {"))
})

test("control failure remains generic while durable Trace stays fail closed", () => {
  const source = readFileSync(
    "lib/ebay/teo-commercial-trace-control-v1.ts", "utf8")
  assert.match(source, /fail_seller_os_commercial_trace_request_v1/)
  assert.match(source, /TEO_COMMERCIAL_TRACE_EXECUTION_FAILED/)
  assert.match(source, /publicationWrites: Number/)
  assert.match(source, /marketplaceWrites: Number/)
  assert.match(source, /readCommercialTraceShippingReceiptV1/)
  assert.match(source,
    /continuationReason:\s*"EXACT_IDEMPOTENT_REPLAY_AFTER_SHIPPING"/)
  assert.match(source,
    /EXACT_IDEMPOTENT_REPLAY_AFTER_PRICING_ENRICHMENT/)
  assert.doesNotMatch(source, /runPublisher|publishListing|createEbayListing/i)
})
