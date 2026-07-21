import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  COMMERCIAL_IMPROVEMENT_CONFIRMATION,
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
  assert.doesNotMatch(source, /automaticExecutionAllowed:\s*true/)
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
  assert.match(domain, /oauth\/api_scope\/sell\.marketing/)
})
