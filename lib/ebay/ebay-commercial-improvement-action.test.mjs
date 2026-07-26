import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  COMMERCIAL_IMPROVEMENT_CONFIRMATION,
  endActiveListingOutOfStockRequestXml,
  reviseActiveListingPriceRequestXml,
} from "./ebay-commercial-improvement-action-domain.ts"

test("la revisión de precio escribe únicamente ItemID y StartPrice escapado", () => {
  const xml = reviseActiveListingPriceRequestXml({
    listingId: "366543596425",
    price: 32.55,
    currency: "USD",
  })
  assert.match(xml, /<ItemID>366543596425<\/ItemID>/)
  assert.match(xml, /<StartPrice currencyID="USD">32\.55<\/StartPrice>/)
  assert.doesNotMatch(xml, /Title|Quantity|Description|SKU/)
})

test("el retiro por stock cero escribe sólo ItemID y NotAvailable", () => {
  const xml = endActiveListingOutOfStockRequestXml({
    listingId: "366543596425",
  })
  assert.match(xml, /<EndFixedPriceItemRequest/)
  assert.match(xml, /<ItemID>366543596425<\/ItemID>/)
  assert.match(xml, /<EndingReason>NotAvailable<\/EndingReason>/)
  assert.doesNotMatch(xml, /StartPrice|Quantity|Title|Description|SKU/)
})

test("el ejecutor exige evidencia, aprobación, economía fresca y readback", () => {
  const source = readFileSync(
    "lib/ebay/ebay-commercial-improvement-action-service.ts",
    "utf8",
  )
  assert.equal(COMMERCIAL_IMPROVEMENT_CONFIRMATION,
    "AUTORIZO APLICAR UNA MEJORA COMERCIAL EN EBAY")
  assert.match(source, /COMMERCIAL_IMPROVEMENT_CONFIRMATION_REQUIRED/)
  assert.match(source, /readManualListingFromTradingApi/)
  assert.match(source, /COMMERCIAL_IMPROVEMENT_LUNA_FRESHNESS_REQUIRED/)
  assert.match(source, /economics\.passesProfitGate/)
  assert.match(source, /COMMERCIAL_IMPROVEMENT_PROMOTION_BLOCKED_TEN_PERCENT_MARGIN/)
  assert.match(source, /EBAY_MARKETING_GET_ADS_READBACK/)
  assert.match(source, /COMMERCIAL_IMPROVEMENT_PRICE_READBACK_MISMATCH/)
  assert.match(source, /COMMERCIAL_IMPROVEMENT_LUNA_OUT_OF_STOCK_REQUIRED/)
  assert.match(source, /COMMERCIAL_IMPROVEMENT_END_READBACK_MISMATCH/)
  assert.match(source, /EndFixedPriceItem/)
  assert.match(source, /getEbayWriteCredential/)
  assert.match(source, /useEbayWriteCredential/)
  assert.doesNotMatch(source, /getEbayTradingReadOnlyAccessToken/)
  assert.doesNotMatch(source, /automaticExecutionAllowed:\s*true/)
})

test("la migración habilita END_LISTING sin ejecución automática", () => {
  const migration = readFileSync(
    "supabase/migrations/20260724015000_enable_confirmed_luna_stock_actions.sql",
    "utf8",
  )
  assert.match(migration, /'END_LISTING'/)
  assert.match(migration, /fresh exact Luna out-of-stock observation/)
  assert.doesNotMatch(migration, /delete\s+from|truncate|drop\s+table/i)
})

test("el mercado activo heredado o manipulado queda bloqueado fail-closed", () => {
  const source = readFileSync(
    "lib/ebay/ebay-commercial-improvement-action-service.ts",
    "utf8",
  )
  assert.match(source, /COMPETITOR_ACTIVE_MARKET_PRICE_RECOMMENDATION/)
  assert.match(source, /throw new Error\("CONFIRMED_SOLD_EVIDENCE_REQUIRED"\)/)
  assert.match(source, /confirmedSoldPolicyFromEvent/)
  assert.match(source, /commercialPolicy\.decision === "EVALUATE_CONFIRMED_SOLD_PRICE"/)
  assert.doesNotMatch(source, /LOWER_TO_ACTIVE_MARKET_SAFE_PRICE/)
  assert.doesNotMatch(source, /LOWER_TO_ACTIVE_MARKET_CONTROLLED_RISK_PRICE/)
  assert.doesNotMatch(source, /ACTIVE_MARKET_CONTROLLED_RISK_10_PERCENT_V1/)
  assert.doesNotMatch(source, /controlledRiskEconomicsConfig/)
})

test("prepare y apply exigen grants exactos y ligan el hash a la política", () => {
  const source = readFileSync(
    "lib/ebay/ebay-commercial-improvement-action-service.ts",
    "utf8",
  )
  assert.match(source, /capabilityGrant:\s*EbayProductionCapabilityGrant/)
  assert.match(source, /prepareCapabilityGrant:/)
  assert.match(source, /stage: "service"/)
  assert.match(source, /stage: "effect"/)
  assert.match(source, /EBAY_ACTIVE_LISTING_COMMERCIAL_POLICY_VERSION/)
  assert.match(source, /commercialPolicyVersion:/)
  assert.match(source, /proposalHash: preview\.requestHash/)
  assert.match(source, /COMMERCIAL_IMPROVEMENT_PROTECTIVE_PRICE_APPLY_NOT_ENABLED/)
})

test("stock-out exige cero numérico exacto y el punto de no retorno es durable", () => {
  const source = readFileSync(
    "lib/ebay/ebay-commercial-improvement-action-service.ts",
    "utf8",
  )
  assert.match(source, /typeof value === "number"/)
  assert.match(source, /exactNumericZero\(luna\.inventory_quantity\)/)
  assert.match(source, /exactNumericZero\(lunaState\?\.inventory_quantity\)/)
  assert.match(source, /phase: "write_in_flight",[\s\S]*ebay_write_attempt_count: 1,[\s\S]*ebay_write_dispatched: true/)
  assert.match(source, /\.eq\("ebay_write_attempt_count", 0\)/)
  assert.match(source, /\.eq\("ebay_write_dispatched", false\)/)
  assert.match(source, /phase: "outcome_unknown"/)
  assert.doesNotMatch(source, /phase: dispatched \? "outcome_unknown" : "preview_ready"/)
})

test("la ruta interactiva exige admin real y emite grants por capacidad", () => {
  const route = readFileSync(
    "app/api/admin/ebay/commercial-monitor/route.ts",
    "utf8",
  )
  assert.match(route, /validation\.authenticationMode !== "admin_user"/)
  assert.match(route, /COMMERCIAL_MONITOR_ADMIN_USER_REQUIRED/)
  assert.match(route, /capability: "commercial_improvement\.prepare"/)
  assert.match(route, /requiredEbayCommercialImprovementApplyCapability/)
  assert.match(route, /confirmedHumanAction: true/)
  assert.match(route, /prepareCapabilityGrant/)
  assert.match(route, /capabilityGrant/)
})

test("la respuesta pública expone contrato servidor para la UI", () => {
  const source = readFileSync(
    "lib/ebay/ebay-commercial-improvement-action-service.ts",
    "utf8",
  )
  assert.match(source, /capability: text\(commercialPolicy\.capability/)
  assert.match(source, /blockerCodes:/)
  assert.match(source, /policyVersion:/)
  assert.match(source, /evidenceExpiresAt:/)
  assert.match(source, /requestHash:/)
})

test("el bloqueo de promoción también cubre listings registrados manualmente", () => {
  const migration = readFileSync(
    "supabase/migrations/20260721140000_store_active_listing_controlled_risk_policy.sql",
    "utf8",
  )
  assert.match(migration, /add column if not exists controlled_risk_policy jsonb/)
  assert.match(migration, /ACTIVE_MARKET_CONTROLLED_RISK_10_PERCENT_V1/)
  assert.match(migration, /promotion' = 'DO_NOT_PROMOTE/)
  assert.match(migration, /minimumNetMarginPercent' = '10/)
  assert.doesNotMatch(migration, /delete\s+from|truncate|drop\s+table/i)
})

test("la migración mantiene un ledger idempotente de una sola acción por alerta", () => {
  const migration = readFileSync(
    "supabase/migrations/20260721120000_create_ebay_commercial_improvement_executions.sql",
    "utf8",
  )
  assert.match(migration, /commercial_event_id uuid not null/)
  assert.match(migration, /unique \(commercial_event_id\)/)
  assert.match(migration, /idempotency_key_hash text not null unique/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /revoke all .* anon, authenticated/)
})

test("el OAuth de publicación solicita sell.marketing para ejecutar la promoción autorizada", () => {
  const domain = readFileSync("lib/ebay/ebay-publication-oauth-domain.ts", "utf8")
  const registry = readFileSync("lib/ebay/ebay-capability-registry.ts", "utf8")
  assert.match(domain, /EBAY_PUBLICATION_OAUTH_SCOPES/)
  assert.match(registry, /oauth\/api_scope\/sell\.marketing/)
})
