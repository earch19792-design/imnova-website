import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildTop20TargetManifest,
  createTop20ContinuationToken,
  getTop20AutomationConfiguration,
  hashTop20ContinuationToken,
  isTop20RateLimitError,
  verifyTop20ContinuationToken,
} from "./ebay-listing-ai-top20-automation.ts"

function candidate(index, overrides = {}) {
  return {
    productId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    supplierProductId: `product-${index}`,
    supplierVariantId: `variant-${index}`,
    supplierSku: `SKU-${index}`,
    priorityScore: 2_000 - index,
    ...overrides,
  }
}

test("1,513 variants are deduplicated and ordered Radar, prior intelligence, then catalog", () => {
  const catalog = Array.from({ length: 1_513 }, (_, index) => candidate(index + 1))
  catalog.push(candidate(2, { productId: "duplicate-row" }))
  const radar = catalog.slice(10, 15).map((row) => row.productId)
  const prior = catalog.slice(100, 170).map((row) => row.productId)
  const manifest = buildTop20TargetManifest({
    catalog, radarProductIds: radar, priorIntelligenceProductIds: prior,
  })
  assert.equal(manifest.length, 1_513)
  assert.equal(manifest.filter((row) => row.source === "RADAR_TOP5").length, 5)
  assert.equal(manifest.filter((row) => row.source === "PRIOR_INTELLIGENCE").length, 70)
  assert.ok(manifest.slice(0, 5).every((row) => row.source === "RADAR_TOP5"))
  assert.ok(manifest.slice(5, 75).every((row) => row.source === "PRIOR_INTELLIGENCE"))
  assert.deepEqual(manifest.map((row) => row.ordinal),
    Array.from({ length: 1_513 }, (_, index) => index))
})

test("continuation token is unpredictable, hashed, and rejects reuse with another token", () => {
  const first = createTop20ContinuationToken()
  const second = createTop20ContinuationToken()
  assert.match(first, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(first, second)
  const hash = hashTop20ContinuationToken(first)
  assert.match(hash, /^sha256:[0-9a-f]{64}$/)
  assert.equal(verifyTop20ContinuationToken(first, hash), true)
  assert.equal(verifyTop20ContinuationToken(second, hash), false)
})

test("batch, time budget, preselection, and continuation limits are bounded server-side", () => {
  const configuration = getTop20AutomationConfiguration({
    EBAY_LISTING_TOP20_BATCH_SIZE: "999",
    EBAY_LISTING_TOP20_TIME_BUDGET_SECONDS: "999",
    EBAY_LISTING_TOP20_PRESELECTION_SIZE: "999",
    EBAY_LISTING_TOP20_MAX_CONTINUATIONS: "99999",
  })
  assert.equal(configuration.batchSize, 10)
  assert.equal(configuration.timeBudgetSeconds, 240)
  assert.equal(configuration.preselectionSize, 100)
  assert.equal(configuration.maxContinuations, 5_000)
  assert.equal(configuration.automaticCronEnabled, false)
})

test("eBay 429 and sanitized rate-limit errors pause the run", () => {
  assert.equal(isTop20RateLimitError(new Error("EBAY_READONLY_GET_429")), true)
  assert.equal(isTop20RateLimitError(new Error("LISTING_AI_RATE_LIMITED")), true)
  assert.equal(isTop20RateLimitError(new Error("EBAY_READONLY_GET_500")), false)
})

test("one-click route starts a server-side chain and never accepts client batch size", () => {
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/listing-ai/approval-queue/route.ts", import.meta.url,
  ), "utf8")
  const continuation = readFileSync(new URL(
    "../../app/api/admin/ebay/listing-ai/approval-queue/continue/route.ts", import.meta.url,
  ), "utf8")
  assert.match(route, /startListingAiApprovalQueueScan/)
  assert.match(route, /after\(async/)
  assert.doesNotMatch(route, /body\.batchSize/)
  assert.match(continuation, /validateListingAiApprovalQueueContinuation/)
  assert.match(continuation, /continueListingAiApprovalQueueScan/)
  assert.match(continuation, /maxDuration = 300/)
  assert.doesNotMatch(route, /continuationToken:\s*result\.continuationToken/)
})

test("migration provides phase-aware SKIP LOCKED claims, checkpoints, and no permanent cron", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260717010000_automate_listing_ai_top20_scan.sql",
    import.meta.url,
  ), "utf8")
  assert.match(migration, /scan_phase in \('DISCOVERY','PRESELECTION','LOOP1_ANALYSIS','COMPLETED'\)/)
  assert.match(migration, /for update skip locked/i)
  assert.match(migration, /RADAR_TOP5.*PRIOR_INTELLIGENCE.*LUNA_CATALOG/s)
  assert.match(migration, /continuation_token_hash/)
  assert.doesNotMatch(migration, /cron\.schedule|create extension.*pg_cron/i)
  assert.doesNotMatch(migration, /drop table|delete from|truncate/i)
})

test("Discovery Scanner precedes deep Loop 1 and stores only aggregate competitor evidence", () => {
  const service = readFileSync(new URL(
    "./ebay-listing-ai-approval-queue-service.ts", import.meta.url,
  ), "utf8")
  const gateway = readFileSync(new URL(
    "./ebay-seller-keyword-demand-gateway.ts", import.meta.url,
  ), "utf8")
  assert.match(service, /run\.scan_phase === "DISCOVERY"[\s\S]*runTop20DiscoveryBatch/)
  assert.match(service, /preselectTop20DiscoveryTargets/)
  assert.match(service, /run\.scan_phase !== "LOOP1_ANALYSIS"/)
  assert.match(gateway, /One Browse search per Luna variant/)
  assert.match(gateway, /fullCompetitorContentStored: false/)
  assert.doesNotMatch(gateway.match(/export async function discoverEbayListingSignals[\s\S]*?\n}\n/)?.[0] ?? "",
    /enrichActiveListing|searchSoldHistory/)
})

test("UI has one orchestration button, polling, READY-only results, and no PARTIAL click instruction", () => {
  const panel = readFileSync(new URL(
    "../../app/admin/ebay/mobile-review/loop2-top20-opportunity-pool.tsx", import.meta.url,
  ), "utf8")
  const parent = readFileSync(new URL(
    "../../app/admin/ebay/mobile-review/loop2-listing-ai-panel.tsx", import.meta.url,
  ), "utf8")
  assert.match(panel, /Analizar y actualizar oportunidades/)
  assert.match(panel, /window\.setInterval/)
  assert.match(panel, /Puedes cerrar esta página\. Seller OS continuará automáticamente/)
  assert.match(panel, /Procesados por Loop 1/)
  assert.doesNotMatch(panel, /vuelve a pulsar para continuar/i)
  assert.match(parent, /A · Radar anterior/)
  assert.match(parent, /B · Top 20 automatizado/)
  assert.match(parent, /Paquete Loop 1 actualmente seleccionado/)
  assert.match(parent, /Generaciones OpenAI/)
})

test("automation path has zero OpenAI calls, drafts, publications, and eBay writes", () => {
  const files = [
    "./ebay-listing-ai-top20-automation.ts",
    "./ebay-listing-ai-approval-queue-service.ts",
    "../../app/api/admin/ebay/listing-ai/approval-queue/route.ts",
    "../../app/api/admin/ebay/listing-ai/approval-queue/continue/route.ts",
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n")
  assert.doesNotMatch(files, /publishOffer|createDraft|shipping_fulfillment/)
  assert.doesNotMatch(files, /createRealOpenAi|generateListingAi/)
  assert.match(files, /openAiCalls: 0/)
  assert.match(files, /ebayWrites: 0/)
})
