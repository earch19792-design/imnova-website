import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  containsFulfillmentPrivateData,
  fulfillmentIdentityFingerprint,
  isAllowedLunaProductUrl,
  isFulfillmentTransitionAllowed,
  normalizePurchaseConfirmation,
  normalizeTrackingPayload,
  simulateMarketplaceFulfillmentSubmission,
} from "../marketplace/fulfillment-v1a-domain.ts"

const identity = {
  marketplaceAccountKey: "seller:" + "a".repeat(64),
  marketplace: "EBAY_US",
  orderId: "12-34567-89012",
  lineItemId: "line-1",
  listingId: "366543596425",
  marketplaceListingSku: "EBAY-CUSTOM-LABEL-3995",
  supplierSku: "ITEM3995",
  supplierVariantId: "luna-variant-3995",
  quantity: 2,
}

const expectedItems = [{
  lineItemId: "line-1",
  listingId: "366543596425",
  marketplaceListingSku: "EBAY-CUSTOM-LABEL-3995",
  supplierSku: "ITEM3995",
  quantity: 2,
}, {
  lineItemId: "line-2",
  listingId: "366543596426",
  marketplaceListingSku: "EBAY-CUSTOM-LABEL-4000",
  supplierSku: "ITEM4000",
  quantity: 1,
}]

function tracking(overrides = {}) {
  return {
    trackingNumber: "9400111899560000000000",
    suggestedCarrier: "US Postal Service",
    confirmedCarrier: "USPS",
    shippedDate: "2026-07-16T12:00:00.000Z",
    items: [
      { lineItemId: "line-1", quantity: 2 },
      { lineItemId: "line-2", quantity: 1 },
    ],
    ...overrides,
  }
}

test("state machine V1A permite sólo el flujo y estados laterales definidos", () => {
  const path = [
    "SALE_DETECTED", "VALIDATING_ORDER", "PENDING_MANUAL_PURCHASE",
    "LUNA_ORDER_PLACED", "WAITING_FOR_TRACKING", "TRACKING_RECEIVED",
    "TRACKING_VALIDATING", "TRACKING_READY_FOR_SUBMISSION",
    "TRACKING_SUBMISSION_QUEUED", "TRACKING_SUBMITTED_SIMULATED", "SHIPPED_SIMULATED",
  ]
  for (let index = 1; index < path.length; index += 1) {
    assert.equal(isFulfillmentTransitionAllowed(path[index - 1], path[index]), true)
  }
  assert.equal(isFulfillmentTransitionAllowed("PENDING_MANUAL_PURCHASE", "TRACKING_READY_FOR_SUBMISSION"), false)
  assert.equal(isFulfillmentTransitionAllowed("SHIPPED_SIMULATED", "CANCELLED"), false)
  assert.equal(isFulfillmentTransitionAllowed("SHIPPED_SIMULATED", "RETURN_OR_ISSUE"), true)
  assert.equal(isFulfillmentTransitionAllowed("CANCELLED", "PENDING_MANUAL_PURCHASE"), false)
})

test("identity fingerprint separa cuenta, item, Custom Label, supplier SKU, variant y cantidad", () => {
  const fingerprint = fulfillmentIdentityFingerprint(identity)
  assert.match(fingerprint, /^sha256:[0-9a-f]{64}$/)
  assert.equal(fingerprint, fulfillmentIdentityFingerprint({ ...identity }))
  assert.notEqual(fingerprint, fulfillmentIdentityFingerprint({ ...identity, marketplaceListingSku: "OTHER" }))
  assert.notEqual(fingerprint, fulfillmentIdentityFingerprint({ ...identity, supplierSku: "OTHER" }))
  assert.notEqual(fingerprint, fulfillmentIdentityFingerprint({ ...identity, quantity: 1 }))
  assert.throws(() => fulfillmentIdentityFingerprint({ ...identity, supplierVariantId: "" }), /FULFILLMENT_SUPPLIER_VARIANT_REQUIRED/)
})

test("compra manual valida Luna, montos, moneda y total coherente sin tarjeta", () => {
  assert.equal(isAllowedLunaProductUrl("https://lunaportex.com/products/lysol"), true)
  assert.equal(isAllowedLunaProductUrl("https://shop.lunaportex.com/products/lysol"), true)
  assert.equal(isAllowedLunaProductUrl("https://lunaportex.com.evil.example/products/lysol"), false)
  assert.deepEqual(normalizePurchaseConfirmation({
    lunaOrderId: "LUNA-1001",
    productCost: 10,
    shippingCost: 2,
    taxAmount: 0.7,
    totalPaid: 12.7,
    currency: "usd",
    purchasedAt: "2026-07-16T12:00:00Z",
  }), {
    lunaOrderId: "LUNA-1001",
    productCost: 10,
    shippingCost: 2,
    taxAmount: 0.7,
    totalPaid: 12.7,
    currency: "USD",
    purchasedAt: "2026-07-16T12:00:00.000Z",
  })
  assert.throws(() => normalizePurchaseConfirmation({
    lunaOrderId: "LUNA-1001", productCost: 10, shippingCost: 2,
    totalPaid: 11, currency: "USD", purchasedAt: "2026-07-16T12:00:00Z",
  }), /FULFILLMENT_TOTAL_INCOHERENT/)
})

test("tracking es idempotente por payload hash y un cambio invalida el hash aprobado", () => {
  const first = normalizeTrackingPayload(tracking(), expectedItems)
  const repeated = normalizeTrackingPayload(tracking(), expectedItems)
  assert.equal(first.payloadHash, repeated.payloadHash)
  assert.equal(first.payload.partialShipment, false)
  const changed = normalizeTrackingPayload(tracking({ shippedDate: "2026-07-16T13:00:00Z" }), expectedItems)
  assert.notEqual(first.payloadHash, changed.payloadHash)
  assert.match(first.payloadHash, /^sha256:[0-9a-f]{64}$/)
})

test("múltiples line items, paquetes parciales y cantidades están representados sin mezclar órdenes", () => {
  const partial = normalizeTrackingPayload(tracking({
    items: [{ lineItemId: "line-1", quantity: 1 }],
  }), expectedItems)
  assert.equal(partial.payload.partialShipment, true)
  assert.equal(partial.payload.items.length, 1)
  assert.throws(() => normalizeTrackingPayload(tracking({
    items: [{ lineItemId: "line-other-order", quantity: 1 }],
  }), expectedItems), /FULFILLMENT_SHIPMENT_LINE_NOT_IN_ORDER/)
  assert.throws(() => normalizeTrackingPayload(tracking({
    items: [{ lineItemId: "line-1", quantity: 3 }],
  }), expectedItems), /FULFILLMENT_SHIPMENT_QUANTITY_INVALID/)
})

test("carrier y tracking inválidos se rechazan antes de persistir", () => {
  assert.throws(() => normalizeTrackingPayload(tracking({ confirmedCarrier: "UNKNOWN" }), expectedItems), /FULFILLMENT_CARRIER_INVALID/)
  assert.throws(() => normalizeTrackingPayload(tracking({ trackingNumber: "bad!" }), expectedItems), /FULFILLMENT_TRACKING_INVALID/)
  assert.throws(() => normalizeTrackingPayload(tracking({ confirmedCarrier: "UPS" }), expectedItems), /FULFILLMENT_CARRIER_TRACKING_MISMATCH/)
})

test("adapter simulado cubre éxito, temporal, permanente, timeout, duplicado y existente", () => {
  const hash = "sha256:" + "b".repeat(64)
  assert.equal(simulateMarketplaceFulfillmentSubmission("success", hash).outcome, "accepted")
  assert.equal(simulateMarketplaceFulfillmentSubmission("temporary_error", hash).retryable, true)
  assert.equal(simulateMarketplaceFulfillmentSubmission("permanent_error", hash).retryable, false)
  const timeout = simulateMarketplaceFulfillmentSubmission("ambiguous_timeout", hash)
  assert.equal(timeout.outcome, "ambiguous_timeout")
  assert.equal(timeout.acceptedRemotely, true)
  assert.equal(simulateMarketplaceFulfillmentSubmission("duplicate_response", hash).outcome, "already_exists")
  assert.equal(simulateMarketplaceFulfillmentSubmission("fulfillment_already_exists", hash).outcome, "already_exists")
})

test("migración implementa append-only, optimistic locking, leases, SKIP LOCKED, backoff y dead-letter", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260716120000_create_marketplace_fulfillment_v1a.sql", import.meta.url), "utf8")
  assert.match(sql, /fulfillment_task_events_append_only_v1a/)
  assert.match(sql, /FULFILLMENT_EVENTS_APPEND_ONLY/)
  assert.match(sql, /FULFILLMENT_STATE_ENGINE_REQUIRED/)
  assert.match(sql, /p_expected_lock_version/)
  assert.match(sql, /for update skip locked/gi)
  assert.match(sql, /lease_expires_at/)
  assert.match(sql, /power\(2,/)
  assert.match(sql, /dead_letter/)
  assert.match(sql, /SIMULATED_TIMEOUT_AFTER_ACCEPTANCE|ambiguous_timeout/)
  assert.match(sql, /secondPost/)
  assert.match(sql, /adapter = 'simulated'/)
  assert.doesNotMatch(sql, /drop\s+(table|column|constraint)|truncate\s|delete\s+from/i)
})

test("RLS y grants bloquean navegador y dejan operación server-side", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260716120000_create_marketplace_fulfillment_v1a.sql", import.meta.url), "utf8")
  for (const table of [
    "fulfillment_task_events", "supplier_purchase_orders", "supplier_purchase_order_items",
    "marketplace_fulfillment_shipments", "marketplace_fulfillment_shipment_items",
    "marketplace_fulfillment_submission_outbox", "marketplace_fulfillment_submission_attempts",
  ]) assert.match(sql, new RegExp(`['\"]${table}['\"]|table public\\.${table}`))
  assert.match(sql, /enable row level security/)
  assert.match(sql, /revoke all on table public\.%I from anon, authenticated/)
  assert.match(sql, /to service_role/)
  assert.doesNotMatch(sql, /grant\s+(insert|update|delete).*authenticated/i)
})

test("idempotencia de compra, tracking y aprobación está dentro de RPC transaccional", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260716120000_create_marketplace_fulfillment_v1a.sql", import.meta.url), "utf8")
  const service = readFileSync(new URL("../marketplace/fulfillment-v1a-service.ts", import.meta.url), "utf8")
  assert.match(sql, /supplier_purchase_orders_task_unique/)
  assert.match(sql, /fulfillment_task_events_idempotency_unique/)
  assert.match(sql, /marketplace_fulfillment_shipments_payload_unique/)
  assert.match(sql, /marketplace_fulfillment_submission_outbox_hash_unique/)
  assert.match(sql, /approval_status = 'invalidated'/)
  assert.match(sql, /FULFILLMENT_PAYLOAD_CHANGED/)
  assert.match(sql, /FULFILLMENT_APPROVAL_PAYLOAD_MISMATCH/)
  assert.match(service, /FULFILLMENT_PURCHASE_ALREADY_CONFIRMED_DIFFERENT_PAYLOAD/)
  assert.match(service, /task\.tracking_payload_hash === normalized\.payloadHash/)
  assert.match(service, /idempotentReplay: true/g)
})

test("cancelled, refund y already fulfilled bloquean antes del adapter", () => {
  const service = readFileSync(new URL("../marketplace/fulfillment-v1a-service.ts", import.meta.url), "utf8")
  assert.match(service, /ORDER_CANCELLED/)
  assert.match(service, /ORDER_REFUNDED/)
  assert.match(service, /ORDER_ALREADY_FULFILLED/)
  assert.match(service, /const blocked = orderGuard[\s\S]*const simulated = blocked/)
})

test("reconciliación de timeout reconocido no ejecuta un segundo POST", () => {
  const service = readFileSync(new URL("../marketplace/fulfillment-v1a-service.ts", import.meta.url), "utf8")
  const sql = readFileSync(new URL("../../supabase/migrations/20260716120000_create_marketplace_fulfillment_v1a.sql", import.meta.url), "utf8")
  assert.match(service, /secondPosts: 0/)
  assert.match(sql, /accepted_at is not null and v_outbox\.simulated_remote_id is not null/)
  assert.match(sql, /SIMULATED_EXISTING_RECOGNIZED/)
})

test("no hay PII, tarjeta, secretos ni API real de escritura en servicio, rutas o UI", () => {
  assert.equal(containsFulfillmentPrivateData({ buyer: { email: "private@example.com" } }), true)
  assert.equal(containsFulfillmentPrivateData({ trackingNumber: "9400111899560000000000", carrier: "USPS" }), false)
  const files = [
    "../marketplace/fulfillment-v1a-service.ts",
    "../../app/admin/ebay/mobile-review/marketplace-fulfillment-panel.tsx",
    "../../app/api/cron/marketplace-fulfillment-submitter/route.ts",
    "../../app/api/cron/marketplace-fulfillment-reconciler/route.ts",
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n")
  assert.doesNotMatch(files, /api\.ebay\.com|shipping_fulfillment|authorizationCode|refreshToken|clientSecret/)
  assert.doesNotMatch(files, /fetch\([^\n]*ebay/i)
  assert.match(files, /ebayWrites: 0/)
  assert.match(files, /cardDataStored: false/)
})

test("Production y writer real quedan bloqueados aunque se configuren flags", () => {
  const service = readFileSync(new URL("../marketplace/fulfillment-v1a-service.ts", import.meta.url), "utf8")
  assert.match(service, /process\.env\.VERCEL_ENV === "preview"/)
  assert.match(service, /vsfthqydfrdzulldbfbe/)
  assert.match(service, /EBAY_FULFILLMENT_TRACKING_WRITE_ENABLED/)
  assert.match(service, /MARKETPLACE_FULFILLMENT_SUBMITTER_ENABLED/)
  assert.match(service, /FULFILLMENT_V1A_REAL_WRITER_MUST_REMAIN_DISABLED/)
})

test("Commercial Monitor exige vínculo Luna exacto y ya no usa Custom Label como supplier SKU", () => {
  const service = readFileSync(new URL("./ebay-commercial-monitor-service.ts", import.meta.url), "utf8")
  assert.doesNotMatch(service, /listing\.supplier_sku\s*\?\?\s*line\.sku/)
  assert.match(service, /SALE_EXACT_LUNA_IDENTITY_LINK_REQUIRED/)
  assert.match(service, /supplier_variant_id/)
  assert.match(service, /identity_fingerprint/)
})

test("UI expone cola, Luna, orden oficial, compra, tracking, payload y aprobación sin PII", () => {
  const ui = readFileSync(new URL("../../app/admin/ebay/mobile-review/marketplace-fulfillment-panel.tsx", import.meta.url), "utf8")
  assert.match(ui, /Abrir producto en Luna/)
  assert.match(ui, /Abrir orden oficial en eBay/)
  assert.match(ui, /Confirmar compra manual/)
  assert.match(ui, /Validar tracking y preparar payload/)
  assert.match(ui, /Aprobar submission simulada/)
  assert.match(ui, /Historial append-only/)
  assert.match(ui, /Esta acción sólo encolará una submission simulada y no escribirá tracking en eBay/)
  assert.doesNotMatch(ui, /buyer_name|buyer_email|shipping_address|address_line|phone_number/i)
})
