import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const continuous = readFileSync(
  "lib/ebay/ebay-mayel-continuous-live-portfolio-v1.ts", "utf8")
const workstationServer = readFileSync(
  "lib/ebay/ebay-mayel-visual-workstation-server-v1.ts", "utf8")
const revalidation = readFileSync(
  "lib/ebay/ebay-mayel-live-market-revalidation-v1.ts", "utf8")
const runtime = readFileSync(
  "lib/seller-os/operational-integrity-runtime-v1.ts", "utf8")
const priceAuthority = readFileSync(
  "lib/ebay/ebay-mayel-price-optimization-delegation-v1.ts", "utf8")
const route = readFileSync(
  "app/api/admin/ebay/mayel-visual-workstation/route.ts", "utf8")
const ui = readFileSync(
  "app/admin/mayel-visual-workstation.tsx", "utf8")
const migration = readFileSync(
  "supabase/migrations/20260906054723_mayel_continuous_live_portfolio_optimization_v1.sql",
  "utf8")

test("continuous portfolio reuses the existing task queue and normal runtime", () => {
  assert.match(continuous, /ensureMayelVisualPortfolioTasksV1/)
  assert.match(continuous, /startMayelLiveMarketRevalidationV1/)
  assert.match(continuous, /seller_os_operational_learning_ledger_v1/)
  assert.match(runtime, /runMayelContinuousLivePortfolioOptimizationV1/)
  assert.match(workstationServer, /ebay_mayel_visual_tasks_v1/)
  assert.match(workstationServer, /targetItemId/)
  assert.doesNotMatch(continuous, /setInterval|setTimeout|cron|scheduler/i)
  assert.match(continuous, /state: "COMMERCIAL_FEED_DEGRADED"/)
  assert.match(continuous, /visualWorkBlocked: false/)
  assert.match(continuous, /commercialFeedFailureBlocksVisualWork: false/)
})

test("portfolio discovery is bounded, duplicate-safe and marketplace read-only", () => {
  assert.match(continuous, /MAX_PORTFOLIO = 200/)
  assert.match(continuous, /MAX_NEW_RESEARCH_PLANS_PER_CYCLE = 3/)
  assert.match(workstationServer, /duplicateTaskCount:/)
  assert.match(workstationServer, /marketplaceWrites: 0/)
  assert.match(continuous, /marketplaceWrites: 0/)
  assert.doesNotMatch(continuous,
    /publishOffer|createOffer|updateOffer|reviseItem|bulkUpdatePriceQuantity/i)
})

test("market revalidation uses exact Sold evidence and cannot invent market price", () => {
  assert.match(continuous, /EXACT_LUNA_MATCH/)
  assert.match(continuous, /evidence_reviewed === true/)
  assert.match(continuous, /quality_status === "VALID"/)
  assert.match(continuous, /targetProfitMaySetMarketPrice: false/)
  assert.doesNotMatch(revalidation,
    /latestResearchAt: latest, idempotencyKey:/)
})

test("price delegation is separate, owner-authorized and validated", () => {
  for (const gate of ["marketEvidenceFresh", "defensibleMarketPriceProven",
    "economicsProven", "stockSafe", "noActiveExperimentConflict",
    "pricePolicyPass", "officialPrewriteReadbackRequired",
    "officialPostwriteReadbackRequired"]) {
    assert.match(priceAuthority, new RegExp(gate))
  }
  assert.match(priceAuthority, /targetProfitMaySetMarketPrice: false/)
  assert.match(priceAuthority, /mayelDirectPriceWrite: false/)
  assert.match(route, /AUTHORIZE_VALIDATED_PRICE_DELEGATION/)
  assert.match(route, /MAYEL_PRICE_OWNER_AUTHORITY_REQUIRED/)
  assert.match(ui, /Optimización validada de precio/)
  assert.match(ui, /Todavía no autorizada/)
})

test("price authority storage is service-role-only, immutable and revocable", () => {
  assert.match(migration, /force row level security/)
  assert.match(migration, /from public, anon, authenticated/)
  assert.match(migration, /to service_role/)
  assert.match(migration, /MAYEL_PRICE_DELEGATION_SCOPE_IMMUTABLE/)
  assert.match(migration, /MAYEL_PRICE_DELEGATION_LEDGER_APPEND_ONLY/)
  assert.match(migration, /PRICE_ONLY/)
  assert.match(migration, /targetProfitMaySetMarketPrice/)
})

test("Mayel can see the full bounded queue and truthful portfolio states", () => {
  assert.match(workstationServer, /limit\(input\.ownerView \? 50 : 50\)/)
  for (const status of ["MEJORANDO", "LISTO PARA REVALIDAR",
    "LISTO PARA APLICAR", "ESPERANDO EBAY",
    "APLICADO"]) {
    assert.match(ui, new RegExp(status))
  }
  assert.match(continuous, /mayelCanWorkWhileEbayUnavailable: true/)
  assert.match(continuous, /autoApplyVisualUnderDelegation: false/)
  assert.match(continuous, /SHARED_MANAGEMENT_MODEL_EXECUTOR_NOT_CERTIFIED/)
})
