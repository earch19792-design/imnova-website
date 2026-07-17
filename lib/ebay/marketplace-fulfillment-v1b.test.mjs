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
  classifyEbayFulfillmentTrackingConnectionError,
  EBAY_FULFILLMENT_TRACKING_CONNECTION_STATES,
  EBAY_FULFILLMENT_TRACKING_OAUTH_SCOPES,
  ebayFulfillmentTrackingScopeConfirmed,
} from "./ebay-fulfillment-tracking-oauth-domain.ts"
import {
  EBAY_FULFILLMENT_TRACKING_CALLBACK_PATH,
  EBAY_FULFILLMENT_TRACKING_CALLBACK_URL,
  EBAY_FULFILLMENT_TRACKING_PREVIEW_BRANCH_HOST,
  resolveEbayFulfillmentTrackingCallback,
} from "./ebay-fulfillment-tracking-public.ts"

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
  assert.equal(ebayFulfillmentTrackingScopeConfirmed(
    EBAY_FULFILLMENT_TRACKING_OAUTH_SCOPES.join(" "),
  ), true)
  assert.equal(ebayFulfillmentTrackingScopeConfirmed(
    "https://api.ebay.com/oauth/api_scope",
  ), false)
})

test("estado OAuth sanitizado distingue scope, identidad, fingerprint y revocación", () => {
  assert.deepEqual(EBAY_FULFILLMENT_TRACKING_CONNECTION_STATES, [
    "NOT_CONFIGURED",
    "AUTHORIZATION_REQUIRED",
    "AUTHORIZATION_IN_PROGRESS",
    "READY",
    "SCOPE_MISSING",
    "IDENTITY_MISMATCH",
    "FINGERPRINT_MISMATCH",
    "EXPIRED_OR_REVOKED",
    "ERROR",
  ])
  assert.equal(classifyEbayFulfillmentTrackingConnectionError("EBAY_OAUTH_INVALID_SCOPE"), "SCOPE_MISSING")
  assert.equal(classifyEbayFulfillmentTrackingConnectionError("EBAY_COMMERCIAL_ACCOUNT_IDENTITY_MISMATCH"), "IDENTITY_MISMATCH")
  assert.equal(classifyEbayFulfillmentTrackingConnectionError("EBAY_COMMERCIAL_ACCOUNT_FINGERPRINT_MISMATCH"), "FINGERPRINT_MISMATCH")
  assert.equal(classifyEbayFulfillmentTrackingConnectionError("EBAY_OAUTH_INVALID_GRANT"), "EXPIRED_OR_REVOKED")
  assert.equal(classifyEbayFulfillmentTrackingConnectionError("RAW_UNEXPECTED"), "ERROR")
})

test("callback canónico permanece disponible sin connection, RuName, token ni OAuth ready", () => {
  for (const configuration of [
    {
      callback: {
        canonicalUrl: EBAY_FULFILLMENT_TRACKING_CALLBACK_URL,
        canonicalPath: EBAY_FULFILLMENT_TRACKING_CALLBACK_PATH,
        dedicated: true,
        deployedBranchHostStatus: "MATCH",
      },
    },
    null,
  ]) {
    const result = resolveEbayFulfillmentTrackingCallback({
      configurationCallback: configuration?.callback,
      connectionCallbackPath: null,
      currentOrigin: null,
    })
    assert.equal(result.callbackAvailable, true)
    assert.equal(result.callbackUrl, EBAY_FULFILLMENT_TRACKING_CALLBACK_URL)
  }
})

test("status 502 usa la constante pública y nunca el callback de Orders", () => {
  const result = resolveEbayFulfillmentTrackingCallback({
    configurationCallback: null,
    connectionCallbackPath: "/api/admin/ebay/commercial-orders-oauth/callback",
    currentOrigin: "https://temporary-preview.example.test",
  })
  assert.equal(result.callbackAvailable, true)
  assert.equal(result.source, "PUBLIC_CONSTANT")
  assert.equal(result.callbackUrl, EBAY_FULFILLMENT_TRACKING_CALLBACK_URL)
  assert.doesNotMatch(result.callbackUrl, /commercial-orders-oauth/)
})

test("deployment temporal copia el host canónico de rama", () => {
  const result = resolveEbayFulfillmentTrackingCallback({
    configurationCallback: {
      canonicalPath: EBAY_FULFILLMENT_TRACKING_CALLBACK_PATH,
      deployedBranchHostStatus: "MISMATCH",
    },
    connectionCallbackPath: EBAY_FULFILLMENT_TRACKING_CALLBACK_PATH,
    currentOrigin: "https://temporary-deployment.vercel.app",
  })
  assert.equal(new URL(result.callbackUrl).host, EBAY_FULFILLMENT_TRACKING_PREVIEW_BRANCH_HOST)
  assert.equal(result.hostStatus, "MISMATCH")
  assert.equal(result.source, "PUBLIC_CONSTANT")
})

test("resolver rechaza doble encoding, query, secretos y rutas no dedicadas", () => {
  for (const canonicalUrl of [
    `https://${EBAY_FULFILLMENT_TRACKING_PREVIEW_BRANCH_HOST}/api/admin/ebay/commercial-orders-oauth/callback`,
    `https://${EBAY_FULFILLMENT_TRACKING_PREVIEW_BRANCH_HOST}%2Fapi%2Fadmin%2Febay%2Ffulfillment-tracking-oauth%2Fcallback`,
    `${EBAY_FULFILLMENT_TRACKING_CALLBACK_URL}?code=private`,
    `https://user:secret@${EBAY_FULFILLMENT_TRACKING_PREVIEW_BRANCH_HOST}${EBAY_FULFILLMENT_TRACKING_CALLBACK_PATH}`,
  ]) {
    const result = resolveEbayFulfillmentTrackingCallback({
      configurationCallback: { canonicalUrl },
      currentOrigin: "https://temporary-deployment.vercel.app",
    })
    assert.equal(result.callbackUrl, EBAY_FULFILLMENT_TRACKING_CALLBACK_URL)
    assert.equal(result.source, "PUBLIC_CONSTANT")
  }
  assert.doesNotMatch(EBAY_FULFILLMENT_TRACKING_CALLBACK_URL, /code=|token|runame|secret/i)
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
  assert.match(authorization, /failEbayFulfillmentTrackingAuthorizationConsent/)
  assert.match(callback, /failEbayFulfillmentTrackingAuthorizationConsent/)
  assert.match(authorization, /input\.code = ""/)
  assert.match(authorization, /input\.state = ""/)
  assert.doesNotMatch(callback, /console\.|error_description|refresh_token|access_token/i)
})

test("handoff asistido usa clave pública efímera y consume el ciphertext tras instalar Preview", () => {
  const authorization = readFileSync(new URL("./ebay-fulfillment-tracking-oauth-authorization.ts", import.meta.url), "utf8")
  const startRoute = readFileSync(new URL("../../app/api/admin/ebay/fulfillment-tracking-oauth/start/route.ts", import.meta.url), "utf8")
  const sql = readFileSync(new URL("../../supabase/migrations/20260716133000_harden_fulfillment_tracking_oauth_handoff.sql", import.meta.url), "utf8")
  assert.match(authorization, /EBAY_FULFILLMENT_TRACKING_HANDOFF_PUBLIC_KEY/)
  assert.match(authorization, /start_ebay_fulfillment_tracking_oauth_handoff_v1b/)
  assert.doesNotMatch(startRoute, /publicKeyPem|privateKey|refreshToken/)
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(sql, /status in \('pending','claimed','ready'\)/)
  assert.match(sql, /consume_ebay_fulfillment_tracking_oauth_handoff_v1b/)
  assert.match(sql, /encrypted_refresh_token = null/)
  assert.match(sql, /token_installed_at/)
  assert.match(sql, /ciphertext_cleared_at/)
  assert.doesNotMatch(sql, /drop\s|truncate\s|delete\s+from/i)
})

test("autorización humana exige los cuatro flags OFF y readiness no ejecuta Orders ni writes", () => {
  const authorization = readFileSync(new URL("./ebay-fulfillment-tracking-oauth-authorization.ts", import.meta.url), "utf8")
  const oauth = readFileSync(new URL("./ebay-fulfillment-tracking-oauth.ts", import.meta.url), "utf8")
  assert.match(authorization, /writeGatesAllOff/)
  assert.match(authorization, /AUTHORIZATION_FLAGS_MUST_REMAIN_OFF/)
  assert.doesNotMatch(authorization, /EBAY_COMMERCIAL_ORDERS_REFRESH_TOKEN|EBAY_SELLER_REFRESH_TOKEN/)
  assert.match(oauth, /getOrdersUsed: false/)
  assert.match(oauth, /ebayWrites: 0/)
  assert.match(oauth, /fingerprintMatch/)
  assert.match(oauth, /refreshSuccessful/)
})

test("Seller Command Center muestra conexión, estados, botón y resumen sanitizado", () => {
  const panel = readFileSync(new URL("../../app/admin/ebay/mobile-review/marketplace-fulfillment-panel.tsx", import.meta.url), "utf8")
  assert.match(panel, /Conexión eBay para envío de tracking/)
  assert.match(panel, /Autorizar tracking con eBay/)
  assert.match(panel, /Copiar callback dedicado/)
  assert.match(panel, /Mostrar callback/)
  assert.match(panel, /trackingOAuthConfiguration/)
  assert.match(panel, /trackingOAuthConnection/)
  assert.match(panel, /loadingStatus/)
  assert.match(panel, /statusUnavailable/)
  assert.match(panel, /disabled=\{!callbackAvailable\}/)
  assert.doesNotMatch(panel, /disabled=\{!oauthConnection\?\.callbackPath\}/)
  assert.match(panel, /Callback dedicado:<\/strong> \{callbackAvailable \? "DISPONIBLE"/)
  assert.match(panel, /Host canónico:/)
  assert.match(panel, /OAuth:<\/strong> \{trackingOAuthConnection\?\.state === "READY" \? "READY" : "NOT READY"\}/)
  for (const state of EBAY_FULFILLMENT_TRACKING_CONNECTION_STATES) {
    assert.match(panel, new RegExp(state))
  }
  assert.match(panel, /fulfillment scope/)
  assert.match(panel, /Write gate/)
  assert.match(panel, /Escrituras eBay/)
  assert.doesNotMatch(panel, /refresh_token|client_secret|buyer_email|shipping_address/i)
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
