import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { evaluateVisualStrategyV3PublicationGate } from "./visual-strategy-v3-publication-gate.ts"

const revision = (status = "APPROVED") => ({
  id: "3a4a233e-d4bc-4a65-825f-c4882bceb9d1",
  status,
  strategy_version: "VISUAL_STRATEGY_V3",
  revision_contract: "REFERENCE_GUIDED_PRODUCT_GENERATION_V1",
})
const attempt = (completed = 6) => ({
  id: "11111111-1111-4111-8111-111111111111",
  revision_id: revision().id,
  expected_job_count: 6,
  completed_job_count: completed,
})
const jobs = (status = "PASSED") => Array.from({ length: 6 }, (_, index) => ({
  position: index + 1,
  status,
}))

test("V3 READY_FOR_PREPARE and V3 with 0/6 jobs block publication", () => {
  const ready = evaluateVisualStrategyV3PublicationGate({
    revision: revision("READY_FOR_PREPARE"), attempt: null, jobs: [],
  })
  assert.equal(ready.allowed, false)
  assert.equal(ready.reason, "VISUAL_STRATEGY_V3_NOT_APPROVED")
  const empty = evaluateVisualStrategyV3PublicationGate({
    revision: revision(), attempt: attempt(0), jobs: [],
  })
  assert.equal(empty.allowed, false)
  assert.equal(empty.reason, "VISUAL_STRATEGY_V3_JOBS_NOT_PASSED")
})

test("any non-PASSED V3 job blocks publication", () => {
  for (const status of ["PENDING", "RESERVED", "QA_PENDING", "REJECTED_RETRYABLE"]) {
    const candidateJobs = jobs()
    candidateJobs[3].status = status
    assert.equal(evaluateVisualStrategyV3PublicationGate({
      revision: revision(), attempt: attempt(5), jobs: candidateJobs,
    }).allowed, false)
  }
})

test("a historical V2 can never substitute for an active V3", () => {
  const historicalV2 = {
    ...revision("APPROVED"),
    strategy_version: "VISUAL_STRATEGY_V2",
    revision_contract: "LEGACY_VISUAL_STRATEGY_V2",
  }
  const gate = evaluateVisualStrategyV3PublicationGate({
    revision: historicalV2, attempt: attempt(), jobs: jobs(),
  })
  assert.equal(gate.allowed, false)
  assert.equal(gate.reason, "VISUAL_STRATEGY_V3_CONTRACT_INVALID")
})

test("only one approved V3 attempt with positions 1-6 PASSED opens publication", () => {
  assert.equal(evaluateVisualStrategyV3PublicationGate({
    revision: revision(), attempt: attempt(), jobs: jobs(),
  }).allowed, true)
  const duplicatePosition = jobs()
  duplicatePosition[5].position = 5
  assert.equal(evaluateVisualStrategyV3PublicationGate({
    revision: revision(), attempt: attempt(), jobs: duplicatePosition,
  }).allowed, false)
})

test("server and UI use the V3 gate; prepare does not accept a browser revision id", () => {
  const route = readFileSync("app/api/admin/ebay/draft-only/route.ts", "utf8")
  const images = readFileSync("app/api/admin/ebay/images/route.ts", "utf8")
  const ui = readFileSync("app/admin/ebay/listing-workspace/page.tsx", "utf8")
  assert.match(route, /assertVisualStrategyV3PublicationAllowed/g)
  assert.match(images, /action === "prepare_visual_review"[\s\S]*packageForActor/)
  assert.doesNotMatch(images, /action === "prepare_visual_review"[\s\S]{0,250}body\.revisionId/)
  assert.match(ui, /Preparar seis trabajos Visual Strategy V3/)
  assert.doesNotMatch(ui, /Continuar a autorización y publicación/)
})

test("flag-false prepare remains metadata-only and idempotent in SQL", () => {
  const route = readFileSync("app/api/admin/ebay/images/route.ts", "utf8")
  const migration = readFileSync(
    "supabase/migrations/20260722008000_reference_guided_generation_orchestrator.sql",
    "utf8",
  )
  assert.match(route, /providerCalls: 0/)
  assert.match(route, /job\.status === "PENDING"/)
  assert.match(route, /job\.lease_owner == null/)
  assert.match(route, /job\.lease_expires_at == null/)
  assert.doesNotMatch(route.match(/if \(action === "reference_guided_prepare"\)[\s\S]*?if \(action === "generate"\)/)?.[0] ?? "", /requestSafeOpenAiBackgroundPlate|claim_ebay_reference_guided_generation_jobs/)
  assert.match(migration, /on conflict \(revision_id, composition_manifest_hash\) do update/)
  assert.match(migration, /from generate_series\(1,6\)/)
  assert.match(migration, /on conflict \(generation_attempt_id, position\) do nothing/)
})
