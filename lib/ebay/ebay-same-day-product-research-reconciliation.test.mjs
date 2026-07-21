import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  projectSameDayProductResearchReconciliationBudget,
} from "./ebay-same-day-pilot-domain.ts"

const service = readFileSync(new URL(
  "./ebay-same-day-pilot-service.ts",
  import.meta.url,
), "utf8")

test("five completed capture batches cover all 84 rows with bounded shared reads", () => {
  assert.deepEqual(
    projectSameDayProductResearchReconciliationBudget([7, 2, 29, 9, 37]),
    {
      batchCount: 5,
      totalObservations: 84,
      observationsCovered: 84,
      allRowsCovered: true,
      decisionReferences: 38,
      maximumOfficialReaderInvocations: {
        trading: 10,
        browse: 5,
        catalog: 5,
        taxonomy: 5,
        total: 25,
        unit: "READER_INVOCATIONS_NOT_HTTP_REQUESTS",
      },
    },
  )
})

test("a captured family is reconciled before any exact-match rejection", () => {
  const resume = service.match(
    /export async function resumeSameDayPilotAfterProductResearchCapture[\s\S]*?\n}\n\nfunction retryable/,
  )?.[0] ?? ""
  assert.match(resume, /authorizedObservationCount/)
  assert.match(resume, /nextState: "RECONCILING_IDENTITY"/)
  assert.match(resume, /job: \{ jobType: "RECONCILE_PRODUCT_RESEARCH_CAPTURE"/)
  assert.doesNotMatch(resume, /NO_EXACT_LUNA_MATCH_IN_AUTHORIZED_CAPTURE/)
  assert.doesNotMatch(
    resume,
    /if \([^)]*exact[^)]*<= 0\)[\s\S]*?nextState: "REJECTED"/i,
  )
})

test("a completed table with zero valid sold rows continues as a controlled test", () => {
  const resume = service.match(
    /export async function resumeSameDayPilotAfterProductResearchCapture[\s\S]*?\n}\n\nfunction retryable/,
  )?.[0] ?? ""
  assert.match(resume, /COMPLETED_ZERO_VALID_SOLD_ROWS/)
  assert.match(resume, /PRODUCT_RESEARCH_COMPLETED_ZERO_VALID_SOLD_AUTO_RESUME/)
  assert.match(resume, /commercialEvidenceMode: "CONTROLLED_EXPLORATORY_TEST"/)
  assert.match(resume, /activeMarketVerificationRequired: true/)
  assert.match(resume, /rejectedRowsUsedForCommercialDecisions: false/)
  assert.doesNotMatch(
    resume,
    /if \(authorizedObservationCount <= 0\)[\s\S]*?nextState: "REJECTED"/,
  )
})

test("the worker reconciles every reviewed row in the authorized batch and keeps decision reads bounded", () => {
  const worker = service.match(
    /if \(leased\.job_type === "RECONCILE_PRODUCT_RESEARCH_CAPTURE"\)[\s\S]*?} else if \(leased\.job_type === "WAIT_FOR_LOOP1_REANALYSIS"\)/,
  )?.[0] ?? ""
  assert.match(worker, /\.eq\("capture_batch_id", batchId\)/)
  assert.match(worker, /\.eq\("marketplace_account_key", input\.accountKey\)/)
  assert.match(worker, /\.eq\("marketplace", MARKETPLACE\)/)
  assert.match(worker, /\.eq\("evidence_reviewed", true\)/)
  assert.doesNotMatch(worker, /\.eq\("matched_supplier_variant_id"/)
  assert.match(worker, /\.limit\(SAME_DAY_RECONCILIATION_DECISION_REFERENCE_LIMIT\)/)
  assert.match(worker, /\.limit\(SAME_DAY_RECONCILIATION_COVERAGE_ROW_LIMIT\)/)
  assert.match(worker, /targetSupplierVariantIds: plannedTargetVariantIds/)
  assert.match(worker, /plannedTargetVariantIds\.includes\(supplierVariantId\)/)
  assert.match(
    worker,
    /tradingObservationIds: decisionObservationIds\.slice\([\s\S]*SAME_DAY_TRADING_DETAIL_READ_LIMIT_PER_BATCH/,
  )
  assert.match(worker, /decisionObservationIdSet\.has\(observationId\)/)
  assert.match(worker, /eventsProcessed: reconciled\.observationsProcessed/)
})

test("legacy premature rejections are repaired only with exact durable bindings", () => {
  const repair = service.match(
    /async function repairLegacyPrematureProductResearchRejections[\s\S]*?\n}\n\nasync function repairSameDayPilotBootstrap/,
  )?.[0] ?? ""
  assert.match(repair, /blockers\.length === 1/)
  assert.match(repair, /blockers\[0\] === LEGACY_PREMATURE_NO_EXACT_REASON/)
  assert.match(repair, /\.eq\("status", "COMPLETED"\)/)
  assert.match(repair, /\.eq\("status", "PROCESSED"\)/)
  assert.match(repair, /text\(entry\.capture_batch_id\) === captureBatchId/)
  assert.match(repair, /productResearchPlannedQueryHash\(entry\.search_query\) === queryHash/)
  assert.match(repair, /text\(queueItem\.supplier_variant_id\) !== supplierVariantId/)
  assert.match(repair, /previousState: "REJECTED", nextState: "RECONCILING_IDENTITY"/)
})

test("a generic brand that hid active comparables is reprocessed without Product Research", () => {
  assert.match(service, /OFFICIAL_BRAND_MARKET_PRICING_RECOVERY_VERSION/)
  const repair = service.match(
    /async function repairOfficialBrandMarketPricingGap[\s\S]*?\n}\n\nasync function refreshCandidateDecisionBeforeProductFacts/,
  )?.[0] ?? ""
  assert.match(repair, /INSUFFICIENT_EQUIVALENT_MARKET_DATA/)
  assert.match(repair, /reviewedOfficialManufacturerIdentity/)
  assert.match(repair, /previousState: "WAITING_PRODUCT_APPROVAL"/)
  assert.match(repair, /nextState: "ENRICHING_PRODUCT_FACTS"/)
  assert.match(repair, /jobType: "ENRICH_PRODUCT_FACTS"/)
  assert.match(repair, /productResearchRepeated: false/)
  assert.match(repair, /ebayWrites: 0/)
})
