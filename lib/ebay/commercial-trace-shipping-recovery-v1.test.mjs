import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const server = readFileSync(
  "lib/ebay/ebay-luna-chrome-shipping-capture-server-v1.ts", "utf8")
const route = readFileSync(
  "app/api/admin/ebay/luna-shipping-capture/route.ts", "utf8")
const trace = readFileSync(
  "lib/ebay/seller-os-live-commercial-trace-v1.ts", "utf8")
const control = readFileSync(
  "lib/ebay/teo-commercial-trace-control-v1.ts", "utf8")
const mcp = readFileSync(
  "lib/ebay/teo-pre-research-control-mcp-v1.ts", "utf8")

test("Commercial Trace shipping reuses the canonical worker and claim lease", () => {
  assert.match(server, /resolveCommercialTraceShippingAuthoritiesV1/)
  assert.match(server, /claim_seller_os_luna_shipping_job_v2/)
  assert.match(server, /completeLunaChromeShippingJobClaimV1/)
  assert.match(server, /LUNA_SHIPPING_QUOTE_CAPTURE_VERSION/)
  assert.match(server, /LUNA_HTTP_SHIPPING_SOURCE/)
  assert.match(server, /quantity: 1/)
  assert.match(server, /canonicalDestinationMatch: true/)
})

test("receipt is fail-closed on exact Trace, identity, truth and freshness bindings", () => {
  for (const binding of ["traceId", "lunaProductId", "lunaVariantId",
    "supplierSku", "sourceFingerprint", "fieldTruthEvidenceDigest",
    "destinationProfileDigest", "evidenceDigest", "observedAt"]) {
    assert.match(server, new RegExp(`\\b${binding}\\b`))
  }
  assert.match(server, /trace\?\.state !== "COMPLETED"/)
  assert.match(server, /result\.FINAL_DECISION !== "HOLD_SHIPPING_UNPROVEN"/)
  assert.match(server, /age > LIVE_LISTING_SHIPPING_MAXIMUM_AGE_SECONDS/)
  assert.match(server, /marketplaceWrites: 0/)
  assert.match(server, /noRawDestinationAddress: true/)
})

test("authenticated capture route persists the consumer receipt before generic paths", () => {
  const consumer = route.indexOf("persistCommercialTraceShippingCaptureV1")
  const economic = route.indexOf("tryPersistEconomicLiveListingShippingCaptureV1", consumer)
  const generic = route.indexOf("persistLunaChromeShippingCaptureV1", consumer)
  assert.ok(consumer >= 0)
  assert.ok(economic > consumer)
  assert.ok(generic > economic)
  assert.match(route, /AWAITING_EXACT_IDEMPOTENT_CONTROL_REPLAY/)
})

test("exact idempotent replay reevaluates the same Trace and preserves prior result on failure", () => {
  assert.match(control, /readCommercialTraceShippingReceiptV1/)
  assert.match(control, /trace\.state === "COMPLETED"/)
  assert.match(control, /result\.FINAL_DECISION === "HOLD_SHIPPING_UNPROVEN"/)
  assert.match(control,
    /continuationReason:\s*"EXACT_IDEMPOTENT_REPLAY_AFTER_SHIPPING"/)
  assert.match(trace, /LIVE_COMMERCIAL_TRACE_CONTINUATION_CONFLICT/)
  assert.match(trace, /priorResultPreserved: true/)
  assert.match(trace, /traceId: input\.traceId/)
})

test("no new Control tool, Publisher path, marketplace write or DB migration is introduced", () => {
  assert.doesNotMatch(mcp, /seller_os_(?:request|get|resume)_luna_shipping/)
  assert.doesNotMatch(server, /publisher|createEbayListing|updateEbayListing/i)
  assert.doesNotMatch(control, /publisher|createEbayListing|updateEbayListing/i)
  assert.match(server, /ebay_writes: 0/)
  assert.match(server, /production_changed: false/)
})
