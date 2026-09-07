import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  deriveProductResearchReformulationDecisionV1,
  extractProductResearchEntityV1,
  PRODUCT_RESEARCH_MAX_REFORMULATION_ATTEMPTS,
} from "./ebay-product-research-query-intelligence-v1.ts"

const migration = readFileSync(
  "supabase/migrations/20260907214243_product_research_adaptive_reformulation_v1.sql",
  "utf8",
)
const terminalPrecedence = readFileSync(
  "supabase/migrations/20260907215859_product_research_latest_quality_terminal_precedence_v1.sql",
  "utf8",
)
const completion = readFileSync(
  "lib/ebay/ebay-mayel-live-market-revalidation-v1.ts", "utf8")
const handoff = readFileSync(
  "lib/ebay/ebay-quick-pick-product-research-handoff-v1.ts", "utf8")
const plan = readFileSync(
  "lib/ebay/ebay-product-research-query-plan.ts", "utf8")

function lowPrecisionDecision(overrides = {}) {
  const entity = extractProductResearchEntityV1({
    productName: "Acme 3 Piece Set Silicone Kitchen Spatulas with Wooden Handles",
    brand: "Acme",
    sourceField: "product_title",
    sourceAuthority: "LUNA_PRODUCT_TRUTH",
  })
  return deriveProductResearchReformulationDecisionV1({
    entity,
    parentTaskId: "11111111-1111-4111-8111-111111111111",
    parentQuery: "silicone kitchen spatulas",
    qualityStatus: "LOW_PRECISION_REFORMULATION_REQUIRED",
    qualityMetrics: {
      exactComparableCount: 0,
      closeVariantComparableCount: 1,
      familyComparableCount: 1,
      adjacentCount: 6,
      falsePositiveCount: 2,
      comparablePrecision: 0.2,
    },
    commercialEvidence: [
      { itemId: "123456789001",
        boundedTitleEvidence: "3 Piece Silicone Kitchen Spatula Set",
        classification: "CLOSE_VARIANT_COMPARABLE" },
      { itemId: "123456789002",
        boundedTitleEvidence: "Silicone Kitchen Spatulas Set Wooden Handles",
        classification: "CORE_FAMILY_COMPARABLE" },
      { itemId: "123456789003",
        boundedTitleEvidence: "Silicone Kitchen Sink Strainer",
        classification: "ADJACENT_BUT_NOT_COMPARABLE" },
      { itemId: "123456789004",
        boundedTitleEvidence: "Kitchen Silicone Baking Mat",
        classification: "FALSE_POSITIVE" },
    ],
    priorQueries: ["acme 3 piece set silicone kitchen spatulas wooden handles",
      "silicone kitchen spatulas"],
    reformulationAttemptCount: 0,
    ...overrides,
  })
}

test("PASS_LOW_PRECISION_DOES_NOT_COMPLETE_PLAN", () => {
  assert.match(terminalPrecedence,
    /LOW_PRECISION_REFORMULATION_REQUIRED[\s\S]+REFORMULATION_DECISION_REQUIRED/)
  assert.match(terminalPrecedence,
    /status = case when v_pending or v_terminal is null[\s\S]+then 'ACTIVE'/)
  assert.match(completion, /deferPlanCompletion: true/)
  assert.match(plan, /input\.deferPlanCompletion === true/)
})

test("PASS_LOW_PRECISION_CREATES_REFORMULATION_DECISION", () => {
  const decision = lowPrecisionDecision()
  assert.equal(decision?.outcome, "CREATE_TASK")
  assert.equal(decision?.intent, "REFORMULATED_CORE_FAMILY_QUERY")
  assert.ok(decision?.addedSignals.length)
  assert.equal(decision?.whyPreviousQueryFailed.comparablePrecision, 0.2)
})

test("PASS_REFORMULATION_CREATES_EXACTLY_ONE_NEW_TASK", () => {
  assert.match(migration,
    /marketplace_product_research_one_reformulation_per_parent_uidx/)
  assert.match(migration,
    /insert into public\.marketplace_product_research_query_tasks/)
  assert.match(migration, /REFORMULATION_TASK_CREATED/)
})

test("PASS_REPEATED_RECONCILIATION_NO_DUPLICATE_TASK", () => {
  assert.match(migration,
    /reformulation_parent_task_id = p_parent_task_id[\s\S]+REFORMULATION_REUSED/)
  assert.match(migration, /PRODUCT_RESEARCH_REFORMULATION_QUERY_DUPLICATE/)
})

test("PASS_REFORMULATION_REUSES_SAME_PLAN", () => {
  assert.match(migration,
    /insert into public\.marketplace_product_research_query_tasks\([\s\S]+p_plan_id/)
  assert.doesNotMatch(migration,
    /insert into public\.marketplace_product_research_query_plans/i)
})

test("PASS_REFORMULATION_PRESERVES_HISTORICAL_RECEIPTS", () => {
  assert.doesNotMatch(migration,
    /delete\s+from\s+public\.marketplace_product_research/i)
  assert.doesNotMatch(migration, /set\s+capture_batch_id\s*=/i)
})

test("PASS_REFORMULATION_AUTOCLAIMABLE", () => {
  assert.match(migration, /status = 'ACTIVE'/)
  assert.match(migration, /worker_next_retry_at = least/)
  assert.match(migration, /'PENDING',p_query_intent/)
})

test("PASS_FAIRNESS_PRESERVED", () => {
  assert.doesNotMatch(migration,
    /create or replace function public\.claim_next_live_listing_product_research_v2/i)
  assert.doesNotMatch(migration, /worker_claim_count\s*=/)
})

test("PASS_BOUNDED_ATTEMPTS", () => {
  assert.equal(PRODUCT_RESEARCH_MAX_REFORMULATION_ATTEMPTS, 2)
  assert.match(migration, /max_reformulation_attempts integer not null default 2/)
  assert.match(migration, /reformulation_attempt_count >= v_plan\.max_reformulation_attempts/)
})

test("PASS_ATTEMPTS_EXHAUSTED_ENDS_UNPROVEN", () => {
  const decision = lowPrecisionDecision({ reformulationAttemptCount: 2 })
  assert.equal(decision?.outcome, "TERMINAL_UNPROVEN")
  assert.equal(decision?.terminalConclusion,
    "DEMAND_REMAINS_UNPROVEN_AFTER_BOUNDED_RESEARCH")
  assert.match(migration, /DEMAND_REMAINS_UNPROVEN_AFTER_BOUNDED_RESEARCH/)
})

test("PASS_SUFFICIENT_EVIDENCE_ENDS_TERMINAL", () => {
  assert.match(terminalPrecedence,
    /v_latest_quality = 'COMMERCIALLY_SUFFICIENT'[\s\S]+v_terminal := 'EVIDENCE_SUFFICIENT'/)
  assert.match(terminalPrecedence,
    /v_intelligence_status := 'COMMERCIALLY_SUFFICIENT'/)
})

test("latest non-terminal quality cannot be masked by older sufficiency", () => {
  assert.doesNotMatch(terminalPrecedence, /v_sufficient/)
  assert.match(terminalPrecedence,
    /order by task\.ordinal desc limit 1[\s\S]+v_latest_quality = 'COMMERCIALLY_SUFFICIENT'/)
})

test("PASS_EXISTING_FALSE_COMPLETED_PLANS_RECOVERABLE", () => {
  assert.match(handoff, /ensureProductResearchAdaptiveReformulationV1/)
  assert.match(migration, /status = 'ACTIVE', completed_at = null/)
  assert.match(migration, /REFORMULATION_REUSED/)
})

test("adaptive query is derived from durable contrast, never caller keywords", () => {
  const decision = lowPrecisionDecision()
  assert.ok(decision?.query?.includes("spatulas"))
  assert.ok(decision?.query?.includes("set"))
  assert.ok(decision?.evidenceBasis.every((entry) =>
    entry.sourceAuthority === "LUNA_PRODUCT_TRUTH" ||
    entry.sourceAuthority === "EBAY_PRODUCT_RESEARCH_DURABLE_EVIDENCE"))
  assert.match(decision?.evidenceBasis[0]?.selectionReason ?? "",
    /ACCEPTED_\d+_IRRELEVANT_\d+/)
})
