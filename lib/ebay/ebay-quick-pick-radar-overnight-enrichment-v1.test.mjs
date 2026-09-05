import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const { projectQuickPickOvernightEligibilityV1,
  runQuickPickRadarOvernightEnrichmentV1 } = await import(
  "./ebay-quick-pick-radar-overnight-enrichment-v1.ts")

const candidateKey = (character) => `sha256:${character.repeat(64)}`

function row(overrides = {}) {
  const base = {
    id: "queue-1", candidate_key: candidateKey("a"),
    supplier_product_id: "100", supplier_variant_id: "200",
    supplier_sku: "SKU-1", product_title: "Exact Luna product",
    queue_status: "review", decision: "FACTORY_PREPARED",
    active_comparables: 2, updated_at: "2026-09-01T08:00:00.000Z",
    assessment: {
      lunaQuickPickOperationV1: {
        contractVersion: "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1",
      },
      radarFactoryCandidateV1: { familyId: "family-1",
        demandEvidenceGrain: "FAMILY" },
      market: { familyDemandStatus: "FAMILY_DEMAND_SUPPORTED",
        soldComparableCount: 2, exactProductDemandClaimed: false },
      sellerOsDeterministicFactory: { stageStatuses: {
        DEMAND_READY: "READY", ECONOMICS_READY: "READY",
        PRODUCT_TRUTH_READY: "READY", LISTING_PACKAGE_READY: "READY",
      }, blockers: ["MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN:Brand",
        "MARKETPLACE_CONDITION_NOT_READY"] },
      canonicalMarketplaceReadinessV1: { ready: false,
        conditionReady: false, unsupportedRequiredSpecifics: ["Brand"],
        blockers: ["MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN:Brand",
          "MARKETPLACE_CONDITION_NOT_READY"] },
      quickPickRequiredSpecificsContinuationV1: {
        contractVersion: "QUICK_PICK_REQUIRED_SPECIFICS_CONTINUATION_V1",
        completedAt: "2026-09-01T07:00:00.000Z",
        finalDisposition: "OWNER_CONFIRMATION_REQUIRED",
        automaticResolutionExhausted: true,
        exactUnresolvedFields: ["Brand", "Condition"], aiCallCount: 1,
        residualOwnerActions: [{ productField: "Condition",
          ownerAction: "CONFIRM" }],
      },
      listingIntelligencePackage: { recommendedTitle: "Exact product" },
    },
  }
  return { ...base, ...overrides,
    assessment: { ...base.assessment, ...(overrides.assessment ?? {}) } }
}

test("overnight eligibility skips ready/live/hard outcomes and keeps metadata residuals", () => {
  assert.equal(projectQuickPickOvernightEligibilityV1({ row: row(),
    alreadyLive: false }).reasonCode, "OVERNIGHT_ENRICHMENT_PENDING")
  assert.equal(projectQuickPickOvernightEligibilityV1({ row: row({
    decision: "MARKET_TEST_READY",
  }), alreadyLive: false }).reasonCode, "READY_NOW_DO_NOT_WAIT_FOR_NIGHT")
  assert.equal(projectQuickPickOvernightEligibilityV1({ row: row(),
    alreadyLive: true }).reasonCode, "ALREADY_LIVE_EXACT_PRODUCT")
  assert.equal(projectQuickPickOvernightEligibilityV1({ row: row({
    assessment: { sellerOsDeterministicFactory: { stageStatuses: {},
      blockers: ["NO_SUPPORTED_PRICE_MEETS_MARGIN_FLOOR"] } },
  }), alreadyLive: false }).reasonCode,
  "NO_SUPPORTED_PRICE_MEETS_MARGIN_FLOOR")
})

test("existing nightly runner reevaluates only the eligible exact Quick Pick", async () => {
  const unresolved = row()
  const ready = row({ id: "queue-2", candidate_key: candidateKey("b"),
    supplier_product_id: "101", supplier_variant_id: "201",
    supplier_sku: "SKU-2", decision: "MARKET_TEST_READY" })
  const hard = row({ id: "queue-3", candidate_key: candidateKey("c"),
    supplier_product_id: "102", supplier_variant_id: "202",
    supplier_sku: "SKU-3", assessment: {
      sellerOsDeterministicFactory: { stageStatuses: {},
        blockers: ["NO_SUPPORTED_PRICE_MEETS_MARGIN_FLOOR"] },
    } })
  const after = row({ decision: "MARKET_TEST_READY",
    updated_at: "2026-09-01T09:00:00.000Z", assessment: {
      sellerOsDeterministicFactory: { stageStatuses: {
        DEMAND_READY: "READY", ECONOMICS_READY: "READY",
        PRODUCT_TRUTH_READY: "READY", LISTING_PACKAGE_READY: "READY",
        MARKET_TEST_READY: "READY",
      }, blockers: [] },
      canonicalMarketplaceReadinessV1: { ready: true,
        conditionReady: true, unsupportedRequiredSpecifics: [], blockers: [] },
      market: { familyDemandStatus: "FAMILY_DEMAND_PROVEN",
        soldComparableCount: 4, exactProductDemandClaimed: false },
      quickPickRequiredSpecificsContinuationV1: {
        contractVersion: "QUICK_PICK_REQUIRED_SPECIFICS_CONTINUATION_V1",
        completedAt: "2026-09-01T09:00:00.000Z",
        finalDisposition: "MARKET_TEST_READY",
        automaticResolutionExhausted: true,
        exactUnresolvedFields: [], aiCallCount: 1,
        residualOwnerActions: [],
      },
      quickPickMarketTestReviewV1: { finalDecision: "MARKET_TEST_READY" },
      listingIntelligencePackage: { recommendedTitle:
        "Enriched exact product" },
    } })
  const calls = { materialize: 0, continuation: 0, audit: 0,
    trigger: null }
  const result = await runQuickPickRadarOvernightEnrichmentV1({
    supabase: {}, accountKey: "seller-account",
    taxonomyReader: async () => ({}), runId: "night-run-1",
    dependencies: {
      now: () => new Date("2026-09-01T09:00:00.000Z"),
      readRows: async () => [unresolved, ready, hard],
      readRowsByIds: async () => [after],
      readLive: async () => ({ status: "AVAILABLE", matches: new Map(),
        reasonCode: null }),
      materialize: async () => { calls.materialize += 1
        return { marketTestReady: false, listingReady: false } },
      continueSpecifics: async (input) => { calls.continuation += 1
        calls.trigger = input.trigger
        return { attempted: 1, claimed: 1, aiCallCount: 0,
          marketplaceWrites: 0 } },
      persistAudit: async (_row, audit) => { calls.audit += 1
        assert.equal(audit.comparableFactPromotedToProductTruth, false)
        assert.equal(audit.factInvented, false) },
    },
  })
  assert.equal(result.quickPickCount, 3)
  assert.equal(result.unresolvedEligibleCount, 1)
  assert.equal(result.unresolvedEligibleProductCount, 1)
  assert.equal(result.unresolvedEligibleProductsReevaluated, true)
  assert.equal(result.readyNowNotDelayedCount, 1)
  assert.equal(result.provenHardBlockerExcludedCount, 1)
  assert.equal(result.readyAfterCount, 1)
  assert.deepEqual(result.outcomes[0].fieldsResolvedOvernight,
    ["Brand", "Condition"])
  assert.equal(result.newMarketEvidenceConsumed, true)
  assert.equal(result.listingIntelligenceEnriched, true)
  assert.equal(result.comparableFactPromotedToProductTruth, false)
  assert.equal(result.existingRadarReused, true)
  assert.equal(result.existingSchedulerReused, true)
  assert.equal(result.existingQuickPickResolversReused, true)
  assert.equal(result.quickPickDoesNotRequireOvernightWait, true)
  assert.equal(result.radarSignalsNotCountedAsReady, true)
  assert.equal(result.remoteOwnerLastMileReady, true)
  assert.equal(result.overnightEnrichmentReuseCertified, true)
  assert.deepEqual(calls, { materialize: 1, continuation: 1, audit: 1,
    trigger: "OVERNIGHT_ENRICHMENT" })
})

test("cron and Dashboard reuse the existing route, resolver and owner runtime", async () => {
  const cron = await readFile(new URL(
    "../../app/api/cron/market-radar-luna-sync/route.ts", import.meta.url),
  "utf8")
  const scheduler = await readFile(new URL(
    "../../supabase/migrations/20260905090044_seller_os_post_only_runtime_dispatch_v1.sql",
    import.meta.url),
    "utf8")
  const provider = await readFile(new URL(
    "../../app/admin/admin-owner-runtime-provider.tsx", import.meta.url),
  "utf8")
  const dashboard = await readFile(new URL(
    "../../app/admin/seller-os-operational-dashboard.tsx", import.meta.url),
  "utf8")
  const adapter = await readFile(new URL(
    "./ebay-quick-pick-radar-overnight-enrichment-v1.ts", import.meta.url),
  "utf8")
  assert.match(cron, /runQuickPickRadarOvernightEnrichmentV1/)
  assert.match(cron, /runSellerOsDemandFirstBroadNetNightlyV1/)
  assert.match(cron, /runRadarLunaQuickPickHandoffCycleV1/)
  assert.match(cron, /export async function POST\(/)
  assert.match(cron,
    /export function GET\(\)[\s\S]*sellerOsPostOnlyGetResponseV1\(\)/)
  assert.match(scheduler,
    /MARKET_RADAR_LUNA_SYNC[\s\S]*\/api\/cron\/market-radar-luna-sync/)
  assert.match(provider, /parseOwnerRuntimeQuickPickOvernightSummary/)
  assert.match(dashboard, /Trabajo nocturno/)
  assert.match(dashboard, /Los productos listos durante el día no esperan/)
  assert.match(adapter, /\.contains\("assessment"/)
  assert.match(adapter, /QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1/)
  assert.doesNotMatch(cron, /create table|new scheduler|new state machine/i)
})
