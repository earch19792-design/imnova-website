import assert from "node:assert/strict"
import test from "node:test"

import {
  buildSameDayImageGenerationJobSpec,
  isSameDayImagePreparationOrphan,
  SAME_DAY_IMAGE_JOB_LINEAGE_VERSION,
  SAME_DAY_IMAGE_AUTHORIZED_CATALOG_COMPLETION_RECOVERY_VERSION,
  SAME_DAY_IMAGE_ORPHAN_RECOVERY_VERSION,
  SAME_DAY_IMAGE_PROFESSIONAL_MARKET_FALLBACK_RECOVERY_VERSION,
  SAME_DAY_IMAGE_SOURCE_REUSE_RECOVERY_VERSION,
  SAME_DAY_IMAGE_VISUAL_STRATEGY_RECOVERY_VERSION,
} from "./ebay-same-day-image-job-lineage.ts"

const ids = {
  runId: "11111111-1111-4111-8111-111111111111",
  candidateId: "22222222-2222-4222-8222-222222222222",
  productResearchCaptureBatchId:
    "33333333-3333-4333-8333-333333333333",
  factRunId: "44444444-4444-4444-8444-444444444444",
  packageHash: "a".repeat(64),
}

test("image job idempotency is bound to capture, fact run and handoff package", () => {
  const spec = buildSameDayImageGenerationJobSpec(ids)
  assert.ok(spec)
  assert.equal(spec.jobType, "GENERATE_SIX_IMAGE_PACKAGE")
  assert.match(spec.idempotencyKey, new RegExp(SAME_DAY_IMAGE_JOB_LINEAGE_VERSION))
  assert.match(spec.idempotencyKey, new RegExp(ids.productResearchCaptureBatchId))
  assert.match(spec.idempotencyKey, new RegExp(ids.factRunId))
  assert.match(spec.idempotencyKey, new RegExp(ids.packageHash))
  assert.deepEqual(spec.checkpoint, {
    packageHash: ids.packageHash,
    factRunId: ids.factRunId,
    productResearchCaptureBatchId: ids.productResearchCaptureBatchId,
    generationAttemptVersion: SAME_DAY_IMAGE_JOB_LINEAGE_VERSION,
    maximumOpenAiCalls: 1,
    competitorImages: 0,
    ebayWrites: 0,
  })
})

test("a rebuilt fact run cannot collide with an earlier completed image job", () => {
  const first = buildSameDayImageGenerationJobSpec(ids)
  const rebuilt = buildSameDayImageGenerationJobSpec({
    ...ids,
    factRunId: "55555555-5555-4555-8555-555555555555",
  })
  assert.ok(first)
  assert.ok(rebuilt)
  assert.notEqual(first.idempotencyKey, rebuilt.idempotencyKey)
})

test("orphan recovery has one append-only lineage without weakening safety bounds", () => {
  const recovery = buildSameDayImageGenerationJobSpec({
    ...ids,
    orphanRecovery: true,
  })
  assert.ok(recovery)
  assert.match(recovery.idempotencyKey,
    new RegExp(`${SAME_DAY_IMAGE_ORPHAN_RECOVERY_VERSION}$`))
  assert.equal(
    recovery.checkpoint.orphanRecoveryVersion,
    SAME_DAY_IMAGE_ORPHAN_RECOVERY_VERSION,
  )
  assert.equal(recovery.checkpoint.maximumOpenAiCalls, 1)
  assert.equal(recovery.checkpoint.ebayWrites, 0)
})

test("a corrected single-unit visual strategy gets one distinct recovery job", () => {
  const recovery = buildSameDayImageGenerationJobSpec({
    ...ids,
    visualStrategyRecovery: true,
  })
  assert.ok(recovery)
  assert.match(recovery.idempotencyKey,
    new RegExp(`${SAME_DAY_IMAGE_VISUAL_STRATEGY_RECOVERY_VERSION}$`))
  assert.equal(
    recovery.checkpoint.visualStrategyRecoveryVersion,
    SAME_DAY_IMAGE_VISUAL_STRATEGY_RECOVERY_VERSION,
  )
  assert.equal(recovery.checkpoint.maximumOpenAiCalls, 1)
  assert.equal(recovery.checkpoint.ebayWrites, 0)
})

test("a corrected source allocator gets one distinct recovery job", () => {
  const original = buildSameDayImageGenerationJobSpec(ids)
  const recovery = buildSameDayImageGenerationJobSpec({
    ...ids,
    sourceReuseRecovery: true,
  })
  assert.ok(original)
  assert.ok(recovery)
  assert.equal(recovery.jobType, "GENERATE_SIX_IMAGE_PACKAGE")
  assert.notEqual(recovery.idempotencyKey, original.idempotencyKey)
  assert.match(recovery.idempotencyKey,
    new RegExp(`${SAME_DAY_IMAGE_SOURCE_REUSE_RECOVERY_VERSION}$`))
  assert.equal(
    recovery.checkpoint.sourceReuseRecoveryVersion,
    SAME_DAY_IMAGE_SOURCE_REUSE_RECOVERY_VERSION,
  )
  assert.equal(recovery.checkpoint.maximumOpenAiCalls, 1)
  assert.equal(recovery.checkpoint.ebayWrites, 0)
})

test("authorized catalog completion recovery is stable and lineage-bound", () => {
  const first = buildSameDayImageGenerationJobSpec({
    ...ids,
    authorizedCatalogCompletionRecovery: true,
  })
  const replay = buildSameDayImageGenerationJobSpec({
    ...ids,
    authorizedCatalogCompletionRecovery: true,
  })
  assert.ok(first)
  assert.deepEqual(replay, first)
  assert.match(
    first.idempotencyKey,
    new RegExp(
      `${SAME_DAY_IMAGE_AUTHORIZED_CATALOG_COMPLETION_RECOVERY_VERSION}$`,
    ),
  )
  assert.equal(
    first.checkpoint.authorizedCatalogCompletionRecoveryVersion,
    SAME_DAY_IMAGE_AUTHORIZED_CATALOG_COMPLETION_RECOVERY_VERSION,
  )
  assert.equal(first.checkpoint.ebayWrites, 0)
})

test("a post-AI visual failure cannot create a deterministic clone fallback", () => {
  const recovery = buildSameDayImageGenerationJobSpec({
    ...ids,
    visualStrategyRecovery: true,
    deterministicFallbackRecovery: true,
  })
  assert.equal(recovery, null)
})

test("insufficient competitor visuals get a distinct professional prompt fallback", () => {
  const recovery = buildSameDayImageGenerationJobSpec({
    ...ids,
    professionalMarketFallbackRecovery: true,
  })
  assert.ok(recovery)
  assert.match(
    recovery.idempotencyKey,
    new RegExp(
      `${SAME_DAY_IMAGE_PROFESSIONAL_MARKET_FALLBACK_RECOVERY_VERSION}$`,
    ),
  )
  assert.equal(
    recovery.checkpoint.professionalMarketFallbackRecoveryVersion,
    SAME_DAY_IMAGE_PROFESSIONAL_MARKET_FALLBACK_RECOVERY_VERSION,
  )
  assert.equal(recovery.checkpoint.ebayWrites, 0)
})

test("only a valid image-preparation lane without active work is recoverable", () => {
  const eligible = {
    machineState: "PREPARING_IMAGE_PACKAGE",
    handoffStatus: "AWAITING_IMAGE_APPROVAL",
    packageHash: ids.packageHash,
    productResearchCaptureBatchId: ids.productResearchCaptureBatchId,
    factRunId: ids.factRunId,
    openPrimaryHumanTasks: 0,
    imageJobStatuses: ["COMPLETED"],
  }
  assert.equal(isSameDayImagePreparationOrphan(eligible), true)
  for (const patch of [
    { machineState: "WAITING_IMAGE_APPROVAL" },
    { handoffStatus: "READY_FOR_MANUAL_PUBLICATION" },
    { packageHash: "" },
    { productResearchCaptureBatchId: "" },
    { factRunId: "" },
    { openPrimaryHumanTasks: 1 },
    { imageJobStatuses: ["PENDING"] },
    { imageJobStatuses: ["WAITING_RETRY"] },
    { imageJobStatuses: ["LEASED"] },
    { imageJobStatuses: ["DEAD_LETTER"] },
  ]) {
    assert.equal(isSameDayImagePreparationOrphan({
      ...eligible,
      ...patch,
    }), false)
  }
})
