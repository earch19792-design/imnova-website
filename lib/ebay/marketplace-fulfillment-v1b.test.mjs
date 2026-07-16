import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildEbayShippingFulfillmentRequest,
  canConfirmRemoteAbsence,
  classifyEbayTrackingPostStatus,
  evaluateEbayTrackingPreflight,
  fulfillmentMatchesEbayRequest,
  normalizeEbayShippingFulfillments,
  normalizeEbayTrackingOrder,
} from "../marketplace/fulfillment-v1b-domain.ts"
import {
  buildEbayFulfillmentTrackingConsentUrl,
  EBAY_FULFILLMENT_TRACKING_OAUTH_SCOPES,
} from "./ebay-fulfillment-tracking-oauth-domain.ts"

const now = Date.parse("2026-07-16T12:10:00.000Z")
const payloadHash = `sha256:${"a".repeat(64)}`
const contextHash = `sha256:${"b".repeat(64)}`
const normalizedPayload = {
  trackingNumber: "9400111899560000000000",
  carrier: "USPS",
  suggestedCarrier: "USPS",
  shippedDate: "2026-07-16T12:00:00.000Z",
  partialShipment: false,
  items: [{
    lineItemId: "line-1",
    listingId: "366543596425",
    marketplaceListingSku: "CUSTOM-3995",
    supplierSku: "ITEM3995",
    quantity: 2,
  }],
}
const request = buildEbayShippingFulfillmentRequest(normalizedPayload)

function rawOrder(overrides = {}) {
  return {
    orderId: "12-34567-89012",
    orderPaymentStatus: "PAID",
    orderFulfillmentStatus: "NOT_STARTED",
    cancelStatus: { cancelState: "NONE_REQUESTED" },
    buyer: { username: "private-user", email: "private@example.com" },
    fulfillmentStartInstructions: [{ shippingStep: { shipTo: { fullName: "Private Buyer" } } }],
    lineItems: [{
      lineItemId: "line-1",
      legacyItemId: "366543596425",
      sku: "CUSTOM-3995",
      quantity: 2,
      lineItemFulfillmentStatus: "NOT_STARTED",
    }],
    ...overrides,
  }
}

function preflight(overrides = {}) {
  return evaluateEbayTrackingPreflight({
    order: normalizeEbayTrackingOrder(rawOrder()),
    fulfillments: [],
    expectedOrderId: "12-34567-89012",
    expectedLines: [{
      lineItemId: "line-1",
      listingId: "366543596425",
      marketplaceListingSku: "CUSTOM-3995",
      supplierSku: "ITEM3995",
      quantity: 2,
    }],
    supplierIdentityValid: true,
    identityFingerprint: contextHash,
    expectedIdentityFingerprint: contextHash,
    currentPayloadHash: payloadHash,
    approvedPayloadHash: payloadHash,
    approvedAt: "2026-07-16T12:00:00.000Z",
    now,
    request,
    ...overrides,
  })
}

test("payload real contiene sólo campos oficiales y tracking alfanumérico", () => {
  assert.deepEqual(request, {
    lineItems: [{ lineItemId: "line-1", quantity: 2 }],
    shippedDate: "2026-07-16T12:00:00.000Z",
    shippingCarrierCode: "USPS",
    trackingNumber: "9400111899560000000000",
  })
  assert.doesNotMatch(JSON.stringify(request), /listing|supplier|buyer|address|email|phone/i)
  assert.throws(() => buildEbayShippingFulfillmentRequest({
    ...normalizedPayload,
    trackingNumber: "1Z999-AA",
  }), /FULFILLMENT_EBAY_TRACKING_ALPHANUMERIC_REQUIRED/)
})

test("getOrder se reduce a identidad y estados sin PII", () => {
  const order = normalizeEbayTrackingOrder(rawOrder())
  assert.equal(order.buyerPiiReturned, false)
  assert.equal(order.paymentStatus, "PAID")
  assert.equal(order.lines[0].marketplaceListingSku, "CUSTOM-3995")
  assert.doesNotMatch(JSON.stringify(order), /private-user|private@example|Private Buyer/)
})

test("preflight exige pago, identidad, hash y aprobación vigente", () => {
  assert.equal(preflight().status, "READY")
  assert.equal(preflight({ order: normalizeEbayTrackingOrder(rawOrder({ orderPaymentStatus: "PENDING" })) }).code, "ORDER_NOT_PAID")
  assert.equal(preflight({ expectedOrderId: "wrong-order" }).code, "ORDER_IDENTITY_MISMATCH")
  assert.equal(preflight({ supplierIdentityValid: false }).code, "IDENTITY_MISMATCH")
  assert.equal(preflight({ currentPayloadHash: `sha256:${"c".repeat(64)}` }).code, "APPROVAL_PAYLOAD_MISMATCH")
  assert.equal(preflight({ approvedAt: "2026-07-16T11:00:00.000Z" }).code, "APPROVAL_EXPIRED")
})

test("cancelación, refund y orden fulfilled bloquean antes del POST", () => {
  assert.equal(preflight({ order: normalizeEbayTrackingOrder(rawOrder({ cancelStatus: { cancelState: "CANCEL_REQUESTED" } })) }).code, "ORDER_CANCELLED")
  assert.equal(preflight({ order: normalizeEbayTrackingOrder(rawOrder({ orderPaymentStatus: "FULLY_REFUNDED" })) }).code, "ORDER_REFUNDED")
  assert.equal(preflight({ order: normalizeEbayTrackingOrder(rawOrder({
    lineItems: [{
      lineItemId: "line-1", legacyItemId: "366543596425", sku: "CUSTOM-3995",
      quantity: 2, refunds: [{ refundStatus: "COMPLETED" }],
    }],
  })) }).code, "ORDER_REFUNDED")
  assert.equal(preflight({ order: normalizeEbayTrackingOrder(rawOrder({ orderFulfillmentStatus: "FULFILLED" })) }).code, "ORDER_ALREADY_FULFILLED")
})

test("fulfillment previo exacto se reconcilia y tracking duplicado distinto se bloquea", () => {
  const exact = normalizeEbayShippingFulfillments({ fulfillments: [{
    fulfillmentId: "remote-1",
    shipmentTrackingNumber: request.trackingNumber,
    shippingCarrierCode: request.shippingCarrierCode,
    shippedDate: request.shippedDate,
    lineItems: request.lineItems,
  }] })
  assert.equal(fulfillmentMatchesEbayRequest(exact[0], request), true)
  const existing = preflight({ fulfillments: exact })
  assert.equal(existing.status, "EXISTING_MATCH")
  assert.equal(existing.existingFulfillmentId, "remote-1")
  const conflict = normalizeEbayShippingFulfillments({ fulfillments: [{
    fulfillmentId: "remote-2",
    shipmentTrackingNumber: request.trackingNumber,
    shippingCarrierCode: "UPS",
    lineItems: request.lineItems,
  }] })
  assert.equal(preflight({ fulfillments: conflict }).code, "TRACKING_DUPLICATE_CONFLICT")
})

test("múltiples paquetes y cantidades parciales respetan el saldo no fulfilled", () => {
  const prior = normalizeEbayShippingFulfillments({ fulfillments: [{
    fulfillmentId: "remote-prior",
    shipmentTrackingNumber: "9400111899560000000001",
    shippingCarrierCode: "USPS",
    lineItems: [{ lineItemId: "line-1", quantity: 1 }],
  }] })
  const oneUnitRequest = { ...request, lineItems: [{ lineItemId: "line-1", quantity: 1 }] }
  assert.equal(preflight({ fulfillments: prior, request: oneUnitRequest }).status, "READY")
  assert.equal(preflight({ fulfillments: prior }).code, "FULFILLMENT_QUANTITY_EXCEEDED")
})

test("HTTP 201 acepta; 409, 429 y 5xx exigen reconciliación; 4xx es permanente", () => {
  assert.equal(classifyEbayTrackingPostStatus(201), "ACCEPTED")
  assert.equal(classifyEbayTrackingPostStatus(409), "AMBIGUOUS_RECONCILIATION_REQUIRED")
  assert.equal(classifyEbayTrackingPostStatus(429), "AMBIGUOUS_RECONCILIATION_REQUIRED")
  assert.equal(classifyEbayTrackingPostStatus(503), "AMBIGUOUS_RECONCILIATION_REQUIRED")
  assert.equal(classifyEbayTrackingPostStatus(400), "PERMANENT_ERROR")
})

test("timeout posterior a aceptación requiere dos GET y 60s antes de habilitar un retry", () => {
  assert.equal(canConfirmRemoteAbsence({
    reconciliationCount: 1,
    postStartedAt: "2026-07-16T12:00:00.000Z",
    now,
  }), false)
  assert.equal(canConfirmRemoteAbsence({
    reconciliationCount: 2,
    postStartedAt: "2026-07-16T12:00:00.000Z",
    now,
  }), true)
})

test("adapter falso demuestra una sola submission y reconciliación sin segundo POST", async () => {
  let posts = 0
  const fakeAdapter = {
    async getOrder() { return normalizeEbayTrackingOrder(rawOrder()) },
    async getShippingFulfillments() { return [] },
    async createShippingFulfillment() {
      posts += 1
      return { outcome: "ACCEPTED", httpStatus: 201, fulfillmentId: "remote-fake", locationPath: "/safe", postStarted: true }
    },
    async getShippingFulfillment() {
      return normalizeEbayShippingFulfillments({ fulfillments: [{
        fulfillmentId: "remote-fake",
        shipmentTrackingNumber: request.trackingNumber,
        shippingCarrierCode: request.shippingCarrierCode,
        shippedDate: request.shippedDate,
        lineItems: request.lineItems,
      }] })[0]
    },
  }
  await fakeAdapter.getOrder()
  await fakeAdapter.getShippingFulfillments()
  const created = await fakeAdapter.createShippingFulfillment()
  const reconciled = await fakeAdapter.getShippingFulfillment(created.fulfillmentId)
  assert.equal(fulfillmentMatchesEbayRequest(reconciled, request), true)
  await fakeAdapter.getShippingFulfillments()
  assert.equal(posts, 1)
})

test("OAuth dedicado usa sólo base + sell.fulfillment y callback state exacto", () => {
  assert.deepEqual(EBAY_FULFILLMENT_TRACKING_OAUTH_SCOPES, [
    "https://api.ebay.com/oauth/api_scope",
    "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  ])
  const state = "A".repeat(43)
  const url = buildEbayFulfillmentTrackingConsentUrl({
    clientId: "client-safe-fixture",
    runame: "runame-safe-fixture",
    state,
  })
  const parsed = new URL(url)
  assert.equal(parsed.searchParams.get("redirect_uri"), "runame-safe-fixture")
  assert.equal(parsed.searchParams.get("state"), state)
  assert.equal(parsed.searchParams.get("scope"), EBAY_FULFILLMENT_TRACKING_OAUTH_SCOPES.join(" "))
  assert.equal(parsed.searchParams.has("prompt"), false)
  assert.doesNotMatch(url, /\+|%252F/)
})

test("token writer no tiene fallback a Orders ni al token seller general", () => {
  const source = readFileSync(new URL("./ebay-fulfillment-tracking-oauth.ts", import.meta.url), "utf8")
  assert.match(source, /EBAY_FULFILLMENT_TRACKING_REFRESH_TOKEN/)
  assert.doesNotMatch(source, /EBAY_COMMERCIAL_ORDERS_REFRESH_TOKEN|EBAY_SELLER_REFRESH_TOKEN/)
  assert.match(source, /readonlyOrdersTokenFallbackAllowed: false/)
  assert.match(source, /genericSellerTokenFallbackAllowed: false/)
})

test("cuatro flags, Preview, staging, rama e identidad bloquean el adapter real", () => {
  const oauth = readFileSync(new URL("./ebay-fulfillment-tracking-oauth.ts", import.meta.url), "utf8")
  const adapter = readFileSync(new URL("./ebay-fulfillment-tracking-adapter.ts", import.meta.url), "utf8")
  for (const flag of [
    "EBAY_FULFILLMENT_TRACKING_OAUTH_ENABLED",
    "EBAY_FULFILLMENT_TRACKING_WRITE_ENABLED",
    "MARKETPLACE_FULFILLMENT_REAL_ADAPTER_ENABLED",
    "MARKETPLACE_FULFILLMENT_SUBMITTER_ENABLED",
  ]) assert.match(oauth, new RegExp(flag))
  assert.match(oauth, /VERCEL_ENV === "preview"/)
  assert.match(oauth, /vsfthqydfrdzulldbfbe/)
  assert.match(oauth, /feature\/centralize-ebay-mobile-command-center/)
  assert.match(oauth, /identity\.bound/)
  assert.match(oauth, /EBAY_FULFILLMENT_TRACKING_PRODUCTION_BLOCKED/)
  assert.match(adapter, /assertEbayFulfillmentTrackingWriterEnabled\(\)/)
  assert.match(oauth, /assertEbayFulfillmentTrackingOAuthPreflightEnabled/)
})

test("adapter real hace un único POST exacto y nunca reintenta ciegamente", () => {
  const adapter = readFileSync(new URL("./ebay-fulfillment-tracking-adapter.ts", import.meta.url), "utf8")
  assert.match(adapter, /\/sell\/fulfillment\/v1/)
  assert.equal((adapter.match(/method: "POST"/g) ?? []).length, 1)
  assert.match(adapter, /EBAY_FULFILLMENT_TRACKING_POST_AMBIGUOUS/)
  assert.match(adapter, /AMBIGUOUS_RECONCILIATION_REQUIRED/)
  assert.doesNotMatch(adapter, /error_description|console\./)
})

test("migración V1B implementa locks, leases, SKIP LOCKED, backoff, DLQ y no blind retry", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260716130000_create_marketplace_fulfillment_v1b.sql", import.meta.url), "utf8")
  assert.match(sql, /for update skip locked/gi)
  assert.match(sql, /lease_expires_at/)
  assert.match(sql, /dead_letter/)
  assert.match(sql, /power\(2,/)
  assert.match(sql, /absence_confirmed_at >= post_started_at/)
  assert.match(sql, /awaiting_reconciliation/)
  assert.match(sql, /TRACKING_SUBMITTED_TO_EBAY/)
  assert.match(sql, /SHIPPED/)
  assert.doesNotMatch(sql, /drop\s+(table|column)|truncate\s|delete\s+from/i)
})

test("V1A conserva aprobación simulada con deduplicación ampliada por adapter", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260716131000_preserve_marketplace_fulfillment_v1a_approval.sql", import.meta.url), "utf8")
  assert.match(sql, /create or replace function public\.approve_fulfillment_tracking_v1a/)
  assert.match(sql, /payload_hash, adapter/)
  assert.match(sql, /'simulated'/)
  assert.doesNotMatch(sql, /drop\s|truncate\s|delete\s+from/i)
})

test("cada nuevo POST invalida la ausencia confirmada de la generación anterior", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260716132000_harden_marketplace_fulfillment_post_generation.sql", import.meta.url), "utf8")
  assert.match(sql, /new\.post_count > old\.post_count/)
  assert.match(sql, /new\.post_started_at := clock_timestamp\(\)/)
  assert.match(sql, /new\.absence_confirmed_at := null/)
  assert.doesNotMatch(sql, /drop\s|truncate\s|delete\s+from/i)
})

test("RLS y grants dejan OAuth y outbox sólo server-side", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260716130000_create_marketplace_fulfillment_v1b.sql", import.meta.url), "utf8")
  assert.match(sql, /ebay_fulfillment_tracking_oauth_handoffs.*enable row level security/is)
  assert.match(sql, /force row level security/)
  assert.match(sql, /revoke all on table public\.ebay_fulfillment_tracking_oauth_handoffs from anon, authenticated/)
  assert.match(sql, /to service_role/)
  assert.doesNotMatch(sql, /grant\s+(insert|update|delete).*authenticated/i)
  assert.match(sql, /raw_response_stored = false/)
})

test("callback dedicado valida state y nunca devuelve code o token al navegador", () => {
  const callback = readFileSync(new URL("../../app/api/admin/ebay/fulfillment-tracking-oauth/callback/route.ts", import.meta.url), "utf8")
  const authorization = readFileSync(new URL("./ebay-fulfillment-tracking-oauth-authorization.ts", import.meta.url), "utf8")
  assert.match(callback, /isValidEbayFulfillmentTrackingOAuthState/)
  assert.match(callback, /isValidEbayFulfillmentTrackingAuthorizationCode/)
  assert.match(callback, /NextResponse\.redirect/)
  assert.doesNotMatch(callback, /NextResponse\.json\([^\n]*(code|token)/i)
  assert.match(authorization, /encrypted_refresh_token/)
  assert.match(authorization, /input\.code = ""/)
  assert.match(authorization, /input\.state = ""/)
})

test("no cron V1B, no PII/secretos y worker real sólo se selecciona si executable", () => {
  const vercel = readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")
  const submitter = readFileSync(new URL("../../app/api/cron/marketplace-fulfillment-submitter/route.ts", import.meta.url), "utf8")
  const reconciler = readFileSync(new URL("../../app/api/cron/marketplace-fulfillment-reconciler/route.ts", import.meta.url), "utf8")
  const service = readFileSync(new URL("../marketplace/fulfillment-v1b-service.ts", import.meta.url), "utf8")
  assert.doesNotMatch(vercel, /marketplace-fulfillment-(submitter|reconciler)/)
  assert.match(submitter, /readiness\.executable/)
  assert.match(reconciler, /readiness\.executable/)
  assert.match(service, /secondPosts: 0/)
  assert.match(service, /buyerPiiReturned: false/)
  assert.match(service, /rawEbayPayloadStored: false/)
  assert.doesNotMatch(service, /buyer_name|buyer_email|shipping_address|address_line|phone_number|card_number/i)
})
