import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

import {
  EBAY_STRATEGIC_ADVISOR_CONTRACT_VERSION,
  EBAY_STRATEGIC_ADVISOR_OUTPUT_SCHEMA_VERSION,
  assertEbayStrategicAdvisorTransition,
  buildEbayStrategicAdvisorResponsesRequest,
  ebayStrategicAdvisorHash,
  evaluateEbayStrategicAdvisorBudget,
  getEbayStrategicAdvisorConfiguration,
  invokeApprovedEbayStrategicAdvisor,
  prepareEbayStrategicAdvisorEvidence,
  validateEbayStrategicAdvisorProposal,
} from "./ebay-strategic-advisor.ts"

const hash = (value) => ebayStrategicAdvisorHash(value)

function evidence() {
  return {
    contractVersion: EBAY_STRATEGIC_ADVISOR_CONTRACT_VERSION,
    listingFingerprint: hash("own-listing-366543596425"),
    signal: {
      eventType: "LISTING_IMPRESSIONS_NO_ENGAGEMENT_REVIEW",
      classification: "IMPRESSIONS_WITHOUT_ENGAGEMENT",
      authorizedVariable: "MAIN_IMAGE",
      detectedAt: "2026-07-18T15:00:00.000Z",
      deterministicRulesetVersion: "SELLER OS POST PUBLICATION V ONE",
    },
    verifiedFacts: [
      {
        factKey: "brand",
        value: "Blue Sea Systems",
        unit: null,
        verificationStatus: "VERIFIED",
        sourceAuthority: "MANUFACTURER_OFFICIAL",
        evidenceHash: hash("brand"),
      },
      {
        factKey: "offerPackCount",
        value: 1,
        unit: "count",
        verificationStatus: "DERIVED_VERIFIED",
        sourceAuthority: "INTERNAL_LEDGER_VERIFIED",
        evidenceHash: hash("pack"),
      },
      {
        factKey: "currentImageCount",
        value: 6,
        unit: "count",
        verificationStatus: "CORROBORATED",
        sourceAuthority: "OWN_LISTING_READONLY",
        evidenceHash: hash("images"),
      },
    ],
    ownListingPerformance: {
      source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
      completeness: "COMPLETE",
      windowStart: "2026-07-11T00:00:00.000Z",
      windowEnd: "2026-07-18T00:00:00.000Z",
      observedAt: "2026-07-18T15:00:00.000Z",
      impressions: 125,
      views: 0,
      clickThroughRate: 0,
      transactions: 0,
      conversionRate: 0,
      watchers: 0,
      confirmedUnitsSold: 0,
      netMarginPercent: 24,
      stockAvailable: 8,
    },
  }
}

function proposal() {
  return {
    schemaVersion: EBAY_STRATEGIC_ADVISOR_OUTPUT_SCHEMA_VERSION,
    authorizedVariable: "MAIN_IMAGE",
    recommendation: {
      decision: "TEST",
      actionCode: "TEST_AUTHORIZED_MAIN_IMAGE_CLARITY",
      rationale: "Visibility exists while engagement remains absent in the complete observation window.",
      confidence: "MEDIUM",
    },
    evidenceReferences: {
      verifiedFactKeys: ["currentImageCount"],
      ownPerformanceMetrics: ["impressions", "views", "clickThroughRate"],
    },
    experiment: {
      changeCount: 1,
      measurementWindow: "SEVEN_COMPLETE_DAYS",
      primaryMetric: "clickThroughRate",
      successRule: "IMPROVE_PRIMARY_WITHOUT_CONVERSION_REGRESSION",
      automaticExecutionAllowed: false,
      manualOperatorActionRequired: true,
    },
    safety: {
      verifiedFactsOnly: true,
      ownListingPerformanceOnly: true,
      competitorDataUsed: false,
      causalConclusionAllowed: false,
      automaticPriceChangeAllowed: false,
      automaticListingChangeAllowed: false,
      ebayWriteAllowed: false,
      selfModificationAllowed: false,
      secondOperatorApprovalRequired: true,
    },
  }
}

test("OpenAI strategic advisor is disabled by default and exposes no secret", () => {
  const configuration = getEbayStrategicAdvisorConfiguration({})
  assert.equal(configuration.status, "DISABLED")
  assert.equal(configuration.realReady, false)
  assert.equal(configuration.storeResponses, false)
  assert.equal(configuration.toolsEnabled, false)
  assert.equal(configuration.ebayWritesAllowed, false)
  assert.equal(JSON.stringify(configuration).includes("OPENAI_API_KEY"), false)
})

test("only allowlisted verified facts and own performance enter the payload", () => {
  const prepared = prepareEbayStrategicAdvisorEvidence(evidence())
  assert.equal(prepared.evidence.verifiedFacts.length, 3)
  assert.deepEqual(
    prepared.evidence.verifiedFacts.map((fact) => fact.factKey),
    ["brand", "currentImageCount", "offerPackCount"],
  )

  const withMissing = structuredClone(evidence())
  withMissing.verifiedFacts[0].verificationStatus = "MISSING"
  assert.throws(
    () => prepareEbayStrategicAdvisorEvidence(withMissing),
    /Invalid enum value|Invalid option/,
  )

  const withEstimate = structuredClone(evidence())
  withEstimate.verifiedFacts[0].verificationStatus = "ESTIMATED_INTERNAL"
  assert.throws(
    () => prepareEbayStrategicAdvisorEvidence(withEstimate),
    /Invalid enum value|Invalid option/,
  )

  const withRawCompetitorData = { ...evidence(), competitorListing: { title: "copied" } }
  assert.throws(() => prepareEbayStrategicAdvisorEvidence(withRawCompetitorData))

  const withUrl = structuredClone(evidence())
  withUrl.verifiedFacts[0].value = "https://example.com/raw-source"
  assert.throws(() => prepareEbayStrategicAdvisorEvidence(withUrl))

  const withPii = structuredClone(evidence())
  withPii.verifiedFacts[0].value = "buyer@example.com"
  assert.throws(() => prepareEbayStrategicAdvisorEvidence(withPii))
})

test("evidence and run deduplication are stable across fact order", () => {
  const first = prepareEbayStrategicAdvisorEvidence(evidence())
  const reordered = evidence()
  reordered.verifiedFacts.reverse()
  const second = prepareEbayStrategicAdvisorEvidence(reordered)
  assert.equal(first.evidenceHash, second.evidenceHash)
  assert.equal(first.inputHash, second.inputHash)
  assert.equal(first.deduplicationKey, second.deduplicationKey)
})

test("Responses request is strict, store false, tool-free and sanitized", () => {
  const request = buildEbayStrategicAdvisorResponsesRequest({
    model: "test-model",
    evidence: evidence(),
    maxOutputTokens: 800,
  })
  assert.equal(request.store, false)
  assert.deepEqual(request.tools, [])
  assert.equal(request.text.format.type, "json_schema")
  assert.equal(request.text.format.strict, true)
  assert.equal(request.text.format.schema.additionalProperties, false)
  const serializedInput = JSON.stringify(request.input)
  assert.doesNotMatch(serializedInput, /https?:\/\/|data:image|base64|buyer@example|competitorListing/i)
  assert.match(serializedInput, /EBAY_SELL_ANALYTICS_TRAFFIC_REPORT/)
})

test("transport calls remain zero without the explicit spend approval", async () => {
  let calls = 0
  const transport = async () => {
    calls += 1
    throw new Error("TRANSPORT_MUST_NOT_RUN")
  }
  await assert.rejects(
    invokeApprovedEbayStrategicAdvisor({
      state: "AWAITING_OPERATOR_APPROVAL_TO_CALL",
      spendApproval: {
        approved: false,
        evidenceHash: prepareEbayStrategicAdvisorEvidence(evidence()).evidenceHash,
        idempotencyKeyHash: hash("approval"),
      },
      evidence: evidence(),
      spentTodayMicros: 0,
      transport,
    }),
    /STRATEGIC_ADVISOR_OPENAI_SPEND_APPROVAL_REQUIRED/,
  )
  assert.equal(calls, 0)
})

test("transport calls remain zero after approval while feature is disabled", async () => {
  let calls = 0
  const prepared = prepareEbayStrategicAdvisorEvidence(evidence())
  await assert.rejects(
    invokeApprovedEbayStrategicAdvisor({
      state: "OPENAI_CALL_QUEUED",
      spendApproval: {
        approved: true,
        evidenceHash: prepared.evidenceHash,
        idempotencyKeyHash: hash("approval"),
      },
      evidence: evidence(),
      spentTodayMicros: 0,
      environment: {},
      transport: async () => {
        calls += 1
        throw new Error("TRANSPORT_MUST_NOT_RUN")
      },
    }),
    /STRATEGIC_ADVISOR_OPENAI_DISABLED/,
  )
  assert.equal(calls, 0)
})

test("budget is a hard gate before transport", () => {
  assert.throws(() => evaluateEbayStrategicAdvisorBudget({
    estimatedInputTokens: 3_001,
    maxInputTokens: 3_000,
    maxOutputTokens: 800,
    estimatedCallCostMicros: 20_000,
    maxCallCostMicros: 50_000,
    spentTodayMicros: 0,
    dailyBudgetMicros: 200_000,
  }), /STRATEGIC_ADVISOR_INPUT_TOKEN_BUDGET_EXCEEDED/)
  assert.throws(() => evaluateEbayStrategicAdvisorBudget({
    estimatedInputTokens: 2_000,
    maxInputTokens: 3_000,
    maxOutputTokens: 800,
    estimatedCallCostMicros: 60_000,
    maxCallCostMicros: 50_000,
    spentTodayMicros: 0,
    dailyBudgetMicros: 200_000,
  }), /STRATEGIC_ADVISOR_CALL_COST_BUDGET_EXCEEDED/)
  assert.throws(() => evaluateEbayStrategicAdvisorBudget({
    estimatedInputTokens: 2_000,
    maxInputTokens: 3_000,
    maxOutputTokens: 800,
    estimatedCallCostMicros: 20_000,
    maxCallCostMicros: 50_000,
    spentTodayMicros: 190_000,
    dailyBudgetMicros: 200_000,
  }), /STRATEGIC_ADVISOR_DAILY_BUDGET_EXCEEDED/)
})

test("a fake transport can run only after approval and returns a second-gated proposal", async () => {
  let calls = 0
  const prepared = prepareEbayStrategicAdvisorEvidence(evidence())
  const result = await invokeApprovedEbayStrategicAdvisor({
    state: "OPENAI_CALL_QUEUED",
    spendApproval: {
      approved: true,
      evidenceHash: prepared.evidenceHash,
      idempotencyKeyHash: hash("approval"),
    },
    evidence: evidence(),
    spentTodayMicros: 0,
    environment: {
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feature/centralize-ebay-mobile-center",
      NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co",
      EBAY_STRATEGIC_ADVISOR_PREVIEW_ENABLED: "true",
      EBAY_STRATEGIC_ADVISOR_OPENAI_ENABLED: "true",
      EBAY_STRATEGIC_ADVISOR_MODEL: "test-model",
      OPENAI_API_KEY: "test-key-never-returned",
      EBAY_STRATEGIC_ADVISOR_MAX_INPUT_TOKENS: "8000",
      EBAY_STRATEGIC_ADVISOR_MAX_OUTPUT_TOKENS: "800",
      EBAY_STRATEGIC_ADVISOR_ESTIMATED_CALL_COST_MICROS: "20000",
      EBAY_STRATEGIC_ADVISOR_MAX_CALL_COST_MICROS: "50000",
      EBAY_STRATEGIC_ADVISOR_DAILY_BUDGET_MICROS: "200000",
    },
    transport: async ({ body, apiKey }) => {
      calls += 1
      assert.equal(body.store, false)
      assert.equal(apiKey, "test-key-never-returned")
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            id: "fake-response-id",
            status: "completed",
            output_text: JSON.stringify(proposal()),
            usage: { input_tokens: 400, output_tokens: 180 },
          }
        },
      }
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.safety.ebayWrites, 0)
  assert.equal(result.safety.secondOperatorApprovalRequired, true)
  assert.equal(result.proposal.experiment.changeCount, 1)
  assert.equal(JSON.stringify(result).includes("test-key-never-returned"), false)
})

test("the advisor cannot replace the deterministic variable or skip states", () => {
  const wrongVariable = proposal()
  wrongVariable.authorizedVariable = "CATEGORY"
  assert.throws(
    () => validateEbayStrategicAdvisorProposal(wrongVariable, evidence()),
    /STRATEGIC_ADVISOR_VARIABLE_CHANGED/,
  )
  assert.throws(
    () => assertEbayStrategicAdvisorTransition(
      "AWAITING_OPERATOR_APPROVAL_TO_CALL",
      "APPROVED_FOR_MANUAL_EXPERIMENT",
    ),
    /STRATEGIC_ADVISOR_STATE_TRANSITION_INVALID/,
  )
})

test("migration enforces append-only audit, two approvals, durable dedupe and RLS", () => {
  const migration = fs.readFileSync(
    "supabase/migrations/20260718048000_create_ebay_strategic_advisor_control_plane.sql",
    "utf8",
  )
  assert.match(migration, /ebay_strategic_advisor_events_immutable/)
  assert.match(migration, /ebay_strategic_advisor_approvals_immutable/)
  assert.match(migration, /ebay_strategic_advisor_proposals_immutable/)
  assert.match(migration, /force row level security/g)
  assert.match(migration, /OPENAI_SPEND/)
  assert.match(migration, /MANUAL_EXPERIMENT/)
  assert.match(migration, /deduplication_key/)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /skip locked/)
  assert.match(migration, /OPENAI_CALL_QUEUED/)
  assert.match(migration, /AWAITING_IMPROVEMENT_APPROVAL/)
  assert.match(migration, /APPROVED_FOR_MANUAL_EXPERIMENT/)
  assert.match(migration, /https\?\:\/\//)
  assert.match(migration, /competitor/)
})

test("route has approvals only and contains no OpenAI or eBay write executor", () => {
  const route = fs.readFileSync(
    "app/api/admin/ebay/strategic-advisor/route.ts",
    "utf8",
  )
  assert.match(route, /DECIDE_OPENAI_API_SPEND/)
  assert.match(route, /DECIDE_MANUAL_EXPERIMENT/)
  assert.match(route, /signalEventId/)
  assert.match(route, /performanceSnapshotId/)
  assert.match(route, /queueItemId/)
  assert.doesNotMatch(route, /evidence:\s*body\.evidence\b/)
  assert.doesNotMatch(route, /invokeApprovedEbayStrategicAdvisor|api\.openai\.com|publishOffer|createOffer|shipping_fulfillment/)
})

test("server binds evidence to persisted facts, own metrics, account and exact event time", () => {
  const service = fs.readFileSync(
    "lib/ebay/ebay-strategic-advisor-service.ts",
    "utf8",
  )
  const migration = fs.readFileSync(
    "supabase/migrations/20260718048000_create_ebay_strategic_advisor_control_plane.sql",
    "utf8",
  )
  assert.match(service, /commercial_alert_events/)
  assert.match(service, /listing_commercial_snapshots/)
  assert.match(service, /marketplace_product_fact_readiness_events/)
  assert.match(service, /marketplace_product_fact_resolutions/)
  assert.match(service, /marketplace_product_fact_observations/)
  assert.match(service, /OPENAI_INPUT_READY/)
  assert.match(service, /event\.detected_at.*snapshot\.observed_at/s)
  assert.doesNotMatch(service, /EBAY_BROWSE_OFFICIAL_READONLY:\s*"/)
  assert.doesNotMatch(service, /EBAY_TRADING_GET_ITEM_READONLY:\s*"/)
  assert.match(migration, /snapshot\.observed_at = event\.detected_at/)
  assert.match(migration, /marketplace_account_key = p_marketplace_account_key/g)
  assert.match(migration, /v_job\.status <> 'LEASED'/)
  assert.match(migration, /v_job\.lease_owner_hash <> p_worker_hash/)
  assert.match(migration, /PROPOSAL_COST_EXCEEDS_RESERVATION/)
  assert.match(migration, /max_attempts integer not null default 1/)
  assert.match(migration, /STRATEGIC_ADVISOR_CALL_OUTCOME_AMBIGUOUS_NO_AUTO_RETRY/)
  assert.match(migration, /approval\.created_at >= date_trunc\('day', p_now\)/)
  assert.doesNotMatch(migration, /and created_at >= date_trunc\('day', p_now\)/)
  assert.doesNotMatch(migration, /and run\.state in \(/)
})
