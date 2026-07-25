import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  isEbayImageMarketBriefUsable,
  resolveEbayImageMarketEvidencePolicy,
  selectCaptureBoundEbayImageMarketBrief,
} from "./ebay-image-market-brief.ts"

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8")
}

const storedBrief = (
  fingerprint,
  sampleSize,
  primaryCohort = "FAMILY_FALLBACK",
  options = {},
) => ({
  product_family_fingerprint: fingerprint,
  confidence: options.confidence ?? "LOW",
  sample_size: sampleSize,
  ...(options.createdAt ? { created_at: options.createdAt } : {}),
  brief: {
    productBaseFingerprint: fingerprint,
    primaryCohort,
    recencyWeightingApplied: true,
    dominantBackgroundType: "WHITE_OR_NEUTRAL",
    recommendedFrameCoverage: "HIGH",
    recommendedComplexity: "LOW",
    packVisibilityPattern: "CLEAR",
    textOverlayPattern: "NONE",
    compositionPattern: "CENTERED",
    recommendedCopySpace: "RIGHT",
    contrastPattern: "HIGH",
    brightnessPattern: "LIGHT",
    palettePattern: "NEUTRAL",
    subjectGeometryPattern: "COMPACT",
    dominantPresentationType: "PRODUCT_ONLY",
    supportingSignals: {
      whiteOrNeutralPercent: 100,
      highCoveragePercent: 100,
      lowComplexityPercent: 100,
      lowOrNoTextOverlayPercent: 100,
      clearMultipackPercent: 0,
      usableCopySpacePercent: 100,
      highContrastPercent: 100,
      lightBrightnessPercent: 100,
      neutralPalettePercent: 100,
      recentObservationPercent: 50,
    },
  },
})

test("market brief prefers exact identity then a self-consistent capture-bound family cohort", () => {
  const exactFingerprint = `sha256:${"a".repeat(64)}`
  const familyFingerprint = `sha256:${"b".repeat(64)}`
  const exact = selectCaptureBoundEbayImageMarketBrief([
    storedBrief(familyFingerprint, 5),
    storedBrief(exactFingerprint, 1, "EXACT_PRODUCT"),
  ], exactFingerprint)
  assert.equal(exact?.primaryCohort, "EXACT_PRODUCT")
  assert.equal(exact?.sampleSize, 1)

  const family = selectCaptureBoundEbayImageMarketBrief([
    storedBrief(familyFingerprint, 5),
  ], familyFingerprint)
  assert.equal(family?.primaryCohort, "FAMILY_FALLBACK")
  assert.equal(family?.sampleSize, 5)
  assert.equal(family?.marketEvidenceTier, "B_PRODUCT_FAMILY")

  assert.equal(selectCaptureBoundEbayImageMarketBrief([
    storedBrief(familyFingerprint, 5, "FAMILY_FALLBACK", {
      confidence: "MEDIUM",
    }),
  ], exactFingerprint), null)

  const inconsistent = storedBrief(familyFingerprint, 5)
  inconsistent.brief.productBaseFingerprint = `sha256:${"c".repeat(64)}`
  assert.equal(selectCaptureBoundEbayImageMarketBrief([
    inconsistent,
  ], exactFingerprint), null)
})

test("market brief safely aggregates fragmented query-family visual cohorts", () => {
  const expectedFingerprint = `sha256:${"f".repeat(64)}`
  const createdAt = "2026-07-23T12:00:00.000Z"
  const fragmented = Array.from({ length: 7 }, (_, index) => {
    const brief = storedBrief(
      `sha256:${String(index).repeat(64)}`,
      1,
      "FAMILY_FALLBACK",
      { createdAt },
    )
    brief.brief.supportingSignals.whiteOrNeutralPercent =
      index < 4 ? 100 : 0
    return brief
  })
  const aggregate = selectCaptureBoundEbayImageMarketBrief(
    fragmented,
    expectedFingerprint,
  )
  assert.equal(aggregate?.primaryCohort, "CATEGORY_FALLBACK")
  assert.equal(aggregate?.marketEvidenceTier, "C_CATEGORY")
  assert.equal(aggregate?.categoryEvidenceCount, 7)
  assert.equal(aggregate?.confidence, "MEDIUM")
  assert.equal(aggregate?.sampleSize, 7)
  assert.equal(aggregate?.supportingSignals.whiteOrNeutralPercent, 57.14)
  assert.equal(isEbayImageMarketBriefUsable(
    aggregate,
    new Date("2026-07-24T12:00:00.000Z"),
  ), true)
  const categoryPolicy = resolveEbayImageMarketEvidencePolicy(aggregate)
  assert.equal(categoryPolicy.influenceScope,
    "GENERAL_CATEGORY_ART_DIRECTION")
  assert.equal(categoryPolicy.commercialRolePrioritizationAllowed, false)
  assert.deepEqual(categoryPolicy.allowedUses, [
    "BACKGROUND",
    "LIGHTING",
    "FRAME_COVERAGE",
    "COMPOSITION",
    "PALETTE",
  ])

  const insufficient = selectCaptureBoundEbayImageMarketBrief(
    fragmented.slice(0, 2),
    expectedFingerprint,
  )
  assert.equal(insufficient, null)

  const exact = storedBrief(
    expectedFingerprint,
    1,
    "EXACT_PRODUCT",
    { createdAt },
  )
  const exactPreferred = selectCaptureBoundEbayImageMarketBrief(
    [...fragmented, exact],
    expectedFingerprint,
  )
  assert.equal(exactPreferred?.primaryCohort, "EXACT_PRODUCT")
  assert.equal(exactPreferred?.marketEvidenceTier, "A_EXACT_PRODUCT")
  assert.equal(exactPreferred?.confidence, "LOW")
  assert.equal(exactPreferred?.sampleSize, 1)
})

test("same-day state machine chains generation and batch approval automatically", async () => {
  const [service, lineage, route, panel] = await Promise.all([
    source("./ebay-same-day-pilot-service.ts"),
    source("./ebay-same-day-image-job-lineage.ts"),
    source("../../app/api/admin/ebay/same-day-pilot/route.ts"),
    source("../../app/admin/today-launch-panel.tsx"),
  ])
  assert.match(lineage, /jobType: "GENERATE_SIX_IMAGE_PACKAGE"/)
  assert.match(service, /const visualEvidenceBatchId = text\(candidate\.product_research_capture_batch_id\)/)
  assert.match(service, /SAME_DAY_PILOT_IMAGE_VISUAL_EVIDENCE_BINDING_MISSING/)
  assert.match(service, /buildSameDayImageGenerationJobSpec\(\{/)
  assert.match(service, /productResearchCaptureBatchId: visualEvidenceBatchId/)
  assert.match(service,
    /factRunId: record\(candidate\.product_facts_summary\)\.factRunId/)
  assert.match(lineage, /VISUAL_V3_FACT_RUN_BOUND_V1_2026_07_23/)
  assert.match(lineage, /productResearchCaptureBatchId/)
  assert.match(lineage, /factRunId/)
  assert.doesNotMatch(service,
    /idempotencyKey: `\$\{state\.run\.id\}:\$\{candidate\.id\}:GENERATE_SIX_IMAGE_PACKAGE`,/)
  assert.doesNotMatch(service, /GENERATE_SIX_IMAGE_PACKAGE:VISUAL_V2:/)
  assert.match(service, /previousState: "PREPARING_IMAGE_PACKAGE",\s*nextState: "WAITING_IMAGE_APPROVAL"/)
  assert.match(service, /jobType: "APPROVE_SIX_IMAGE_SET"/)
  assert.match(service, /jobType: "FINALIZE_MANUAL_HANDOFF"/)
  assert.match(service, /continuationJobType: "APPROVE_SIX_IMAGE_SET"/)
  assert.doesNotMatch(service, /continuationJobType: "FINALIZE_MANUAL_HANDOFF"[^]*title: "Revisa el set completo/)
  assert.match(service, /expectedImages: 7/)
  assert.match(service, /generatedImages: 7/)
  assert.doesNotMatch(service, /expectedImages: 6/)
  assert.match(route, /\]\.filter\(Boolean\)\)\]\.slice\(0, 7\)/)
  assert.doesNotMatch(route, /\]\.filter\(Boolean\)\)\]\.slice\(0, 6\)/)
  assert.match(panel, /Set de publicación para revisión · \{imageSet\.length\}\/7/)
  assert.match(panel, /imagen \$\{index \+ 1\} de 7/)
})

test("the scheduler repairs a preparation orphan before claiming the next job", async () => {
  const service = await source("./ebay-same-day-pilot-service.ts")
  const repair = service.match(
    /async function repairOrphanedImagePreparation[\s\S]*?\n}\n\nasync function recoverDeadLetterCandidates/,
  )?.[0] ?? ""
  assert.match(repair, /machine_state\) === "PREPARING_IMAGE_PACKAGE"/)
  assert.match(repair, /\.eq\("job_type", "GENERATE_SIX_IMAGE_PACKAGE"\)/)
  assert.match(repair, /isSameDayImagePreparationOrphan/)
  assert.match(repair, /orphanRecovery: true/)
  assert.match(repair, /IMAGE_PREPARATION_ORPHAN_RECOVERED/)
  assert.match(repair, /maximumOpenAiCalls: 1/)
  assert.match(repair, /ebay_writes: 0/)
  assert.match(repair, /production_changed: false/)
  assert.doesNotMatch(repair, /delete\s+from|truncate/i)
  assert.ok(
    service.indexOf("await repairOrphanedImagePreparation") <
      service.indexOf('rpc("claim_same_day_pilot_job"'),
  )
})

test("the scheduler safely resumes a rejected verified 1 x 1 visual strategy", async () => {
  const service = await source("./ebay-same-day-pilot-service.ts")
  const repair = service.match(
    /async function repairRejectedSingleUnitVisualStrategy[\s\S]*?\n}\n\nasync function repairOrphanedImagePreparation/,
  )?.[0] ?? ""
  assert.match(repair, /NEEDS_VERIFIED_PRODUCT_FACTS:VISUAL_STRATEGY/)
  assert.match(repair, /SAME_DAY_IMAGE_PACKAGE_IDEMPOTENCY_CONFLICT/)
  assert.match(repair, /buildCurrentSameDayImageFactoryInput/)
  assert.match(repair, /factoryInput\.facts\.packCount !== 1/)
  assert.match(repair, /factoryInput\.facts\.unitCount !== 1/)
  assert.match(repair, /visualStrategyRecovery: true/)
  assert.match(repair, /SINGLE_UNIT_VISUAL_STRATEGY_RECOVERED/)
  assert.match(repair, /previousState: "REJECTED"/)
  assert.match(repair, /nextState: "PREPARING_IMAGE_PACKAGE"/)
  assert.match(repair, /status: "CANCELLED"/)
  assert.match(repair, /historyDeleted: false/)
  assert.match(repair, /fabricatedFacts: false/)
  assert.match(repair, /productResearchRepeated: false/)
  assert.match(repair, /ebay_read_calls: 0/)
  assert.match(repair, /openai_calls: 0/)
  assert.match(repair, /ebay_writes: 0/)
  assert.match(repair, /production_changed: false/)
  assert.doesNotMatch(repair, /delete\s+from|truncate/i)
  assert.ok(
    service.indexOf("await repairRejectedSingleUnitVisualStrategy") <
      service.indexOf('rpc("claim_same_day_pilot_job"'),
  )
})

test("insufficient market visuals return to one exact recapture without discarding commercial work", async () => {
  const service = await source("./ebay-same-day-pilot-service.ts")
  const recovery = service.match(
    /async function resetVisualMarketRecaptureQueryPlan[\s\S]*?\n}\n\nasync function repairOrphanedImagePreparation/,
  )?.[0] ?? ""
  assert.match(service, /MARKET_VISUAL_SIGNALS_INSUFFICIENT/)
  assert.match(service, /SAME_DAY_IMAGE_MARKET_BRIEF_REQUIRED/)
  assert.match(recovery, /status: "PENDING"/)
  assert.match(recovery, /capture_batch_id: null/)
  assert.match(recovery, /status: "ACTIVE"/)
  assert.match(recovery, /completed_at: null/)
  assert.match(recovery, /nextState: "WAITING_PRODUCT_RESEARCH_CAPTURE"/)
  assert.match(recovery, /VISUAL_MARKET_EVIDENCE_REQUIRED/)
  assert.match(recovery, /commercialEvidencePreserved: true/)
  assert.match(recovery, /productFactsPreserved: true/)
  assert.match(recovery, /productApprovalPreservedForRevalidation: true/)
  assert.match(recovery, /SUPERSEDED_BY_VISUAL_MARKET_RECAPTURE/)
  assert.match(recovery, /historyDeleted: false/)
  assert.match(recovery, /\["DEAD_LETTER", "CANCELLED", "COMPLETED"\]/)
  assert.match(recovery, /EFFECT_ALREADY_APPLIED_RECOVERED/)
  assert.match(recovery, /visualMarketRecoveryPriorityCandidate/)
  assert.match(recovery, /VISUAL_MARKET_RECOVERY_SUCCESSOR_TASK_DEFERRED/)
  assert.match(recovery, /resumeOnlyAfterPriorityCandidateSettles: true/)
  assert.match(recovery, /status: "SUPERSEDED"/)
  assert.match(recovery,
    /VISUAL_MARKET_RECAPTURE_UNBOUND_CANDIDATE_CODES\.has\(code\)/)
  assert.match(recovery, /for \(const candidate of candidates\)/)
  assert.match(recovery, /if \(!failedJob\) continue/)
  assert.match(recovery, /await refreshRunProjection[\s\S]{0,100}return 1/)
  assert.match(recovery, /Preserve them unchanged and keep looking/)
  assert.match(recovery, /ebay_writes: 0/)
  assert.match(recovery, /production_changed: false/)
  assert.doesNotMatch(recovery, /delete\s+from|truncate/i)
  assert.match(service,
    /captureResolvedBlockers[\s\S]{0,180}VISUAL_MARKET_EVIDENCE_REQUIRED/)
  assert.match(service,
    /candidatePatch: \{ productResearchCaptureBatchId: input\.batchId,[\s\S]{0,100}blockers: captureResolvedBlockers/)
  assert.ok(
    service.indexOf("await repairRejectedVisualMarketRecapture") <
      service.indexOf('rpc("claim_same_day_pilot_job"'),
  )
  assert.match(service,
    /jobType === "GENERATE_SIX_IMAGE_PACKAGE"[\s\S]{0,120}machineState === "WAITING_PRODUCT_RESEARCH_CAPTURE"/)
  assert.match(service,
    /priorityVisualRecovery[\s\S]{0,350}text\(candidate\.id\) !== text\(priorityVisualRecovery\.id\)/)
  assert.match(recovery, /visualMarketRecaptureRecoveryOrigin/)
  assert.match(recovery, /ACTIVE_IMAGE_JOB/)
  assert.match(recovery, /REJECTED_HISTORY_REPAIR/)
  assert.match(recovery, /visualMarketRecaptureRequestedAt/)
  assert.match(recovery, /restoreUsableSupersededVisualCapture/)
  assert.match(recovery, /loadEbayImageMarketBrief/)
  assert.match(recovery, /isEbayImageMarketBriefUsable/)
  assert.match(recovery, /markProductResearchQueryCaptured/)
  assert.match(recovery, /QUERY_FAMILY_VISUAL_BRIEF_REUSED/)
  assert.match(recovery, /sameCaptureBatchOnly: true/)
  assert.match(recovery, /identityClaimsInferred: false/)
  assert.ok(recovery.includes(
    "!/^(?:sha256:)?[0-9a-f]{64}$/.test(familyFingerprint)",
  ))
  assert.match(recovery, /repairQueryFamilyVisualReconciliationOrphan/)
  assert.match(recovery,
    /QUERY_FAMILY_VISUAL_RECONCILIATION_ORPHAN_REPAIRED/)
  assert.match(recovery, /queryFamilyVisualBriefReused: true/)
  assert.match(recovery, /orphanRecovery: true/)
  assert.match(recovery, /priorCompletedJobPreserved: true/)
  assert.match(recovery, /isDeferredLegacyVisualMarketRecovery/)
  assert.match(recovery, /competingCandidateIds/)
  assert.match(recovery,
    /if \(visualMarketRecoveryPriorityCandidate\(state\)\) return 0/)
  assert.match(recovery, /activateNextDeferredVisualMarketRecovery/)
  assert.match(recovery, /hasOpenFreshCaptureGate/)
  assert.match(recovery, /repairStaleVisualAutoResumeOrphan/)
  assert.match(recovery, /STALE_VISUAL_AUTO_RESUME_ORPHAN_REPAIRED/)
  assert.match(service, /RECOVER_STALE_VISUAL_AUTO_RESUME_ORPHAN/)
  assert.match(recovery, /DEFERRED_VISUAL_CAPTURE_GATE_RECOVERY_V1_2026_07_24/)
  assert.match(recovery, /freshProcessedCapture/)
  assert.match(recovery, /capturedAt >= requestedAt/)
  assert.match(recovery, /resetForFreshCapture/)
  assert.match(recovery, /DEFERRED_VISUAL_CAPTURE_GATE_RECOVERED/)
  assert.match(recovery, /serializedOneAtATime: true/)
  assert.match(recovery, /productResearchPlanId: queryPlan\.planId/)
  assert.match(recovery,
    /VISUAL_MARKET_BACKGROUND_RECAPTURE_ERROR_CODES\.has\(blockers\[0\]\)/)
  const genericDeadLetterRecovery = service.match(
    /async function recoverDeadLetterCandidates[\s\S]*?\n}\n\nasync function acquirePilotRunLease/,
  )?.[0] ?? ""
  assert.match(genericDeadLetterRecovery,
    /VISUAL_MARKET_RECAPTURE_ERROR_CODES\.has\(candidateBlockers\[0\]\)[\s\S]{0,300}continue/)
  const rateLimitIndex = service.indexOf("const rateLimitMetadata =")
  const catchRecoveryStart = service.lastIndexOf(
    "} catch (error) {",
    rateLimitIndex,
  )
  const catchRecovery = service.slice(catchRecoveryStart, rateLimitIndex)
  assert.match(catchRecovery, /routeCandidateToVisualMarketRecapture/)
  assert.match(catchRecovery, /status: "COMPLETED"/)
  assert.match(catchRecovery, /waitingFor: "VISUAL_PRODUCT_RESEARCH_RECAPTURE"/)
  assert.match(catchRecovery, /priorVisualRecaptures >= 1/)
  assert.match(catchRecovery, /VISUAL_MARKET_RECAPTURE_LIMIT_REASON/)
  assert.match(catchRecovery, /rejectAndPromote/)
  assert.match(catchRecovery, /operatorRecaptureRequestedAgain: false/)
})

test("a completed legacy image job can be followed by one capture-bound Visual V2 job", async () => {
  const migration = await readFile(
    new URL("../../supabase/migrations/20260721220000_resume_visual_v2_image_generation.sql", import.meta.url),
    "utf8",
  )
  assert.match(migration, /resume_same_day_visual_v2_image_generation_v1/)
  assert.match(migration, /p_expected_capture_batch_id uuid/)
  assert.match(migration, /p_expected_completed_job_id uuid/)
  assert.match(migration, /v_capture\.captured_at <= v_old_job\.completed_at/)
  assert.match(migration, /v_handoff\.created_at <= v_old_job\.completed_at/)
  assert.match(migration,
    /GENERATE_SIX_IMAGE_PACKAGE:VISUAL_V2:'[\s\S]*p_expected_capture_batch_id::text/)
  assert.match(migration, /insert into public\.ebay_same_day_pilot_jobs/)
  assert.match(migration, /'PENDING'/)
  assert.match(migration, /VISUAL_V2_IMAGE_GENERATION_RESUMED/)
  assert.match(migration, /'openAiCalls', 0/)
  assert.match(migration, /'ebayWrites', 0/)
  assert.match(migration, /'productionChanged', false/)
  assert.doesNotMatch(migration, /delete\s+from|truncate/i)
  assert.doesNotMatch(migration, /update public\.ebay_same_day_pilot_jobs/i)
})

test("a pre-network single-source configuration rejection has one append-only recovery", async () => {
  const migration = await readFile(
    new URL("../../supabase/migrations/20260721221000_resume_single_source_image_after_openai_config.sql", import.meta.url),
    "utf8",
  )
  assert.match(migration,
    /resume_same_day_single_source_image_after_openai_config_v1/)
  assert.match(migration, /SAME_DAY_IMAGE_SINGLE_SOURCE_AI_REQUIRED/)
  assert.match(migration, /EFFECT_ALREADY_APPLIED_RECOVERED/)
  assert.match(migration, /OPENAI_IMAGE_FACTORY_CONFIGURATION_RECOVERED/)
  assert.match(migration, /advance_same_day_pilot_candidate/)
  assert.match(migration, /'REJECTED',[\s\S]*'PREPARING_IMAGE_PACKAGE'/)
  assert.match(migration, /OPENAI_CONFIG_RECOVERY/)
  assert.match(migration, /historyPreserved', true/)
  assert.match(migration, /'openAiCalls', 0/)
  assert.match(migration, /'ebayWrites', 0/)
  assert.match(migration, /'productionChanged', false/)
  assert.doesNotMatch(migration, /delete\s+from|truncate/i)
  assert.doesNotMatch(migration, /update public\.ebay_same_day_pilot_jobs/i)
})

test("a capture-bound family brief can recover the exact failed image job", async () => {
  const migration = await readFile(
    new URL("../../supabase/migrations/20260721222000_resume_image_after_family_brief_binding.sql", import.meta.url),
    "utf8",
  )
  assert.match(migration, /resume_same_day_image_after_family_brief_binding_v1/)
  assert.match(migration, /SAME_DAY_IMAGE_MARKET_BRIEF_REQUIRED/)
  assert.match(migration, /VISUAL_MARKET_BRIEF_V2_2026_07_21/)
  assert.match(migration, /primaryCohort/)
  assert.match(migration, /productBaseFingerprint/)
  assert.match(migration, /MARKET_BRIEF_FAMILY_FALLBACK_RECOVERED/)
  assert.match(migration, /advance_same_day_pilot_candidate/)
  assert.match(migration, /'REJECTED',[\s\S]*'PREPARING_IMAGE_PACKAGE'/)
  assert.match(migration, /set status = 'CANCELLED'/)
  assert.match(migration, /historyPreserved', true/)
  assert.match(migration, /'openAiCalls', 0/)
  assert.match(migration, /'ebayWrites', 0/)
  assert.match(migration, /'productionChanged', false/)
  assert.doesNotMatch(migration, /delete\s+from|truncate/i)
})

test("one product approval contains rights and one-call spend authorization", async () => {
  const [service, route, panel] = await Promise.all([
    source("./ebay-same-day-pilot-service.ts"),
    readFile(new URL("../../app/api/admin/ebay/same-day-pilot/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/today-launch-panel.tsx", import.meta.url), "utf8"),
  ])
  for (const value of [service, route, panel]) {
    assert.match(value, /imageRightsConfirmed/)
    assert.match(value, /openAiImageSpendApproved/)
  }
  assert.match(service, /openAiImageMaximumCallsApproved: 1/)
  assert.match(panel, /hasta 1 llamada OpenAI de calidad high/)
  assert.match(panel, /EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22/)
  assert.match(panel, /foregroundMatteValidated === true/)
  assert.match(panel, /opaqueSourceFrameRemoved === true/)
  assert.match(panel, /textPolicyPassed === true/)
  assert.match(panel, /asset\.backgroundPlateQuality === "high"/)
  assert.match(route, /foregroundMatteValidated: qa\.foregroundMatteValidated === true/)
})

test("runtime persists seven review assets but never invokes an eBay write API", async () => {
  const runtime = await source("./ebay-same-day-image-package-runtime.ts")
  assert.match(runtime, /ebay_create_pending_listing_image_set/)
  assert.match(runtime, /persistedAssetIds\.length !== 7/)
  assert.match(runtime, /review_ebay_same_day_pilot_image_package_set/)
  assert.match(runtime, /ebayWrites: 0/)
  assert.doesNotMatch(runtime, /Inventory API|publishOffer|createOffer|createOrReplaceInventoryItem|reviseItem/i)
  assert.doesNotMatch(runtime, /recursive|\/api\/admin\/ebay\/images/)
})

test("a zero-effect legacy OpenAI control can reconcile to the current deterministic compositor", async () => {
  const [runtime, migration] = await Promise.all([
    source("./ebay-same-day-image-package-runtime.ts"),
    readFile(
      new URL(
        "../../supabase/migrations/20260724004000_reconcile_safe_pregeneration_image_mode.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ])
  assert.match(runtime, /SAME_DAY_IMAGE_PACKAGE_IDEMPOTENCY_CONFLICT/)
  assert.match(runtime, /generationMode === "DETERMINISTIC_ONLY"/)
  assert.match(runtime, /reconcile_same_day_pregeneration_image_mode_v1/)
  assert.equal(
    runtime.match(/claim_ebay_same_day_pilot_image_package_run/g)?.length,
    3,
  )
  assert.match(migration, /PREGENERATION_OPENAI_TO_DETERMINISTIC_V1_2026_07_24/)
  assert.match(migration, /EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22/)
  assert.match(migration, /old\.generation_mode = 'OPENAI_CONTEXT_PLATE'/)
  assert.match(migration, /new\.generation_mode = 'DETERMINISTIC_ONLY'/)
  assert.match(migration, /v_control\.status <> 'FAILED_RETRYABLE'/)
  assert.match(migration, /v_control\.attempt <> 1/)
  assert.match(migration, /v_control\.openai_calls <> 0/)
  assert.match(migration, /v_control\.provider_request_id is not null/)
  assert.match(migration, /v_control\.asset_ids is not null/)
  assert.match(migration, /v_control\.product_byte_count_sent <> 0/)
  assert.match(migration, /v_control\.product_url_count_sent <> 0/)
  assert.match(migration, /v_control\.ebay_writes <> 0/)
  assert.match(migration, /v_control\.production_changed/)
  assert.match(migration, /sameDayImageControlId/)
  assert.match(migration,
    /grant execute on function public\.reconcile_same_day_pregeneration_image_mode_v1[\s\S]*to service_role/)
  assert.doesNotMatch(migration, /delete\s+from|truncate/i)
})

test("V9 generation, seven-asset persistence and the human review gate share one contract", async () => {
  const [runtime, service, panel, migration] = await Promise.all([
    source("./ebay-same-day-image-package-runtime.ts"),
    source("./ebay-same-day-pilot-service.ts"),
    readFile(
      new URL("../../app/admin/today-launch-panel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../../supabase/migrations/20260724005000_align_v9_seven_image_gate.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ])
  assert.match(runtime, /reconcile_same_day_visual_gate_version_v1/)
  assert.match(service, /SAME_DAY_IMAGE_SET_VISUAL_STRATEGY_V2_INVALID/)
  assert.match(panel, /EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22/)
  assert.match(panel, /APROBAR IMÁGENES · SET DE 7/)
  assert.doesNotMatch(panel, /EBAY_IMAGE_COMPOSITOR_FOREGROUND_V8_2026_07_22/)
  assert.match(migration, /SELLER_OS_V9_GATE_PATCH_TARGET_MISSING/)
  assert.match(migration, /EBAY_IMAGE_COMPOSITOR_FOREGROUND_V8_2026_07_22/)
  assert.match(migration, /EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22/)
  assert.match(migration, /attempt between 1 and 3/)
  assert.match(migration, /cardinality\(asset_ids\) in \(6, 7\)/)
  assert.match(migration, /image_count in \(6, 7\)/)
  assert.match(migration,
    /jsonb_array_length\(asset_manifest\) = cardinality\(asset_ids\)/)
  assert.match(migration,
    /SAME_DAY_IMAGE_SET_VISUAL_STRATEGY_V2_INVALID/)
  assert.match(migration, /SAME_DAY_IMAGE_GATE_VERSION_RECONCILED/)
  assert.match(migration, /v_control\.attempt <> 2/)
  assert.match(migration, /v_control\.openai_calls <> 0/)
  assert.match(migration, /v_control\.provider_request_id is not null/)
  assert.match(migration, /v_control\.asset_ids is not null/)
  assert.match(migration, /v_control\.product_byte_count_sent <> 0/)
  assert.match(migration, /v_control\.product_url_count_sent <> 0/)
  assert.match(migration, /v_control\.ebay_writes <> 0/)
  assert.match(migration, /v_control\.production_changed/)
  assert.match(migration,
    /grant execute on function public\.reconcile_same_day_visual_gate_version_v1[\s\S]*to service_role/)
  assert.doesNotMatch(migration, /delete\s+from|truncate/i)
})

test("an approved current V9 zero-text fallback has one append-only recovery", async () => {
  const [runtime, policy, migration] = await Promise.all([
    source("./ebay-same-day-image-package-runtime.ts"),
    source("./ebay-image-approval-policy.ts"),
    readFile(
      new URL(
        "../../supabase/migrations/20260724007000_recover_current_v9_single_source_approval.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ])
  assert.match(runtime,
    /isReviewableDeterministicSingleSourceInformationalSet/)
  assert.match(runtime, /deterministicSingleSourceInformationalSet/)
  assert.match(policy, /textLineCount === 0/)
  assert.match(policy, /SINGLE_SOURCE_INFORMATIONAL_PANELS_NOT_MULTIPLE_PRODUCT_VIEWS/)
  assert.match(migration,
    /recover_current_v9_single_source_approval_v1/)
  assert.match(migration,
    /V9_SINGLE_SOURCE_ZERO_TEXT_REVIEW_CONTRACT_V1_2026_07_24/)
  assert.match(migration,
    /SAME_DAY_IMAGE_LEGACY_SET_REGENERATION_REQUIRED/)
  assert.match(migration, /cardinality\(v_control\.asset_ids\) <> 7/)
  assert.match(migration, /v_asset_count <> 7/)
  assert.match(migration, /v_objective_count <> 6/)
  assert.match(migration, /v_source_count <> 1/)
  assert.match(migration, /SIX_IMAGE_SET_APPROVAL_CONFIRMED/)
  assert.match(migration,
    /'REJECTED',[\s\S]*'BUILDING_SELLER_HUB_HANDOFF'/)
  assert.match(migration, /'APPROVE_SIX_IMAGE_SET'/)
  assert.match(migration, /'researchRepeated', false/)
  assert.match(migration, /'imagesRegenerated', false/)
  assert.match(migration, /'openAiCalls', 0/)
  assert.match(migration, /'ebayWrites', 0/)
  assert.match(migration, /'productionChanged', false/)
  assert.match(migration,
    /grant execute on function public\.recover_current_v9_single_source_approval_v1[\s\S]*to service_role/)
  assert.doesNotMatch(migration, /delete\s+from|truncate/i)
})

test("the stale V6 approval assertion is retired by an exact V9 seven-image gate", async () => {
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20260724008000_replace_stale_v6_review_gate_with_v9.sql",
      import.meta.url,
    ),
    "utf8",
  )
  assert.match(migration, /assert_same_day_pilot_image_set_current_v9/)
  assert.match(migration, /SAME_DAY_IMAGE_V9_EXACT_SEVEN_REQUIRED/)
  assert.match(migration, /v_secondary_count <> 6/)
  assert.match(migration, /v_generative_count <> 6/)
  assert.match(migration, /EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V4/)
  assert.match(migration, /textLineCount'\)::integer = 0/)
  assert.match(migration, /not \(asset\.transformation \? 'textRendererVersion'\)/)
  assert.match(migration,
    /replace\(v_definition, v_old, v_new\)/)
  assert.match(migration,
    /recover_current_v9_exact_seven_sql_gate_v1/)
  assert.match(migration, /SAME_DAY_IMAGE_V6_EXACT_SIX_REQUIRED/)
  assert.match(migration, /V9_EXACT_SEVEN_SQL_REVIEW_GATE_V1_2026_07_24/)
  assert.match(migration, /'researchRepeated', false/)
  assert.match(migration, /'imagesRegenerated', false/)
  assert.match(migration, /'openAiCalls', 0/)
  assert.match(migration, /'ebayWrites', 0/)
  assert.match(migration, /'productionChanged', false/)
  assert.doesNotMatch(migration, /delete\s+from|truncate/i)
})

test("a retired V6 dead letter cannot reject a live V9 replacement approval job", async () => {
  const [service, migration] = await Promise.all([
    source("./ebay-same-day-pilot-service.ts"),
    readFile(
      new URL(
        "../../supabase/migrations/20260724009000_recover_v9_dead_letter_collision.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ])
  const supersededGuard = service.match(
    /function isSupersededRetiredV6ApprovalDeadLetter[\s\S]*?\n}\n\nasync function verifiedBusinessPoliciesFromOwnActiveListing/,
  )?.[0] ?? ""
  assert.match(
    service,
    /RETIRED_V6_IMAGE_APPROVAL_ERROR\s*=\s*\n?\s*"SAME_DAY_IMAGE_V6_EXACT_SIX_REQUIRED"/,
  )
  assert.match(
    service,
    /V9_EXACT_SEVEN_SQL_GATE_RECOVERY_REASON\s*=\s*\n?\s*"V9_EXACT_SEVEN_SQL_GATE_RECOVERED"/,
  )
  assert.match(supersededGuard, /RETIRED_V6_IMAGE_APPROVAL_ERROR/)
  assert.match(supersededGuard, /V9_EXACT_SEVEN_SQL_GATE_RECOVERY_REASON/)
  assert.match(supersededGuard, /hasReplacementApprovalJob/)
  assert.match(supersededGuard, /PENDING", "WAITING_RETRY", "LEASED/)
  assert.match(supersededGuard, /BUILDING_SELLER_HUB_HANDOFF/)
  assert.match(supersededGuard, /READY_FOR_IMAGE_REVIEW/)
  assert.match(supersededGuard, /assetIds\.length === 7/)
  assert.match(supersededGuard, /SAME_DAY_MANUAL_HANDOFF_VERSION/)

  const genericDeadLetterRecovery = service.match(
    /async function recoverDeadLetterCandidates[\s\S]*?\n}\n\nasync function acquirePilotRunLease/,
  )?.[0] ?? ""
  const retiredGuardIndex = genericDeadLetterRecovery.indexOf(
    "isSupersededRetiredV6ApprovalDeadLetter",
  )
  assert.ok(retiredGuardIndex >= 0)
  assert.ok(retiredGuardIndex < genericDeadLetterRecovery.indexOf(
    "jobEffectAlreadyApplied",
  ))
  assert.ok(retiredGuardIndex < genericDeadLetterRecovery.indexOf(
    "rejectAndPromote",
  ))
  assert.match(
    genericDeadLetterRecovery,
    /SAME_DAY_PILOT_RETIRED_V6_DEAD_LETTER_CANCEL_FAILED/,
  )

  assert.match(migration, /recover_current_v9_dead_letter_collision_v1/)
  assert.match(migration, /V9_EXACT_SEVEN_DEAD_LETTER_COLLISION_RECOVERED/)
  assert.match(migration, /SAME_DAY_IMAGE_V6_EXACT_SIX_REQUIRED/)
  assert.match(migration, /V9_EXACT_SEVEN_SQL_GATE_RECOVERED/)
  assert.match(migration, /assert_same_day_pilot_image_set_current_v9/)
  assert.match(migration, /cardinality\(v_control\.asset_ids\) <> 7/)
  assert.match(migration, /'researchRepeated', false/)
  assert.match(migration, /'imagesRegenerated', false/)
  assert.match(migration, /'openAiCalls', 0/)
  assert.match(migration, /'ebayWrites', 0/)
  assert.match(migration, /'productionChanged', false/)
  assert.match(
    migration,
    /grant execute on function public\.recover_current_v9_dead_letter_collision_v1[\s\S]*to service_role/,
  )
  assert.doesNotMatch(migration, /delete\s+from|truncate/i)
})

test("workspace refresh accepts the approved V9 seven-image control without weakening V6 history", async () => {
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20260724010000_align_workspace_refresh_with_v9.sql",
      import.meta.url,
    ),
    "utf8",
  )
  assert.match(
    migration,
    /assert_ebay_same_day_approved_v9_control_v1/,
  )
  assert.match(
    migration,
    /v_control\.status <> 'APPROVED'/,
  )
  assert.match(
    migration,
    /v_control\.reviewed_by is distinct from p_actor/,
  )
  assert.match(
    migration,
    /v_control\.human_decision <> 'APPROVED'/,
  )
  assert.match(
    migration,
    /coalesce\(cardinality\(p_asset_ids\), 0\) <> 7/,
  )
  assert.match(migration, /v_position_count <> 7/)
  assert.match(migration, /v_main_count <> 1/)
  assert.match(migration, /v_secondary_count <> 6/)
  assert.match(
    migration,
    /asset\.status <> 'approved'[\s\S]*asset\.approved_by is distinct from p_actor/,
  )
  assert.match(
    migration,
    /asset\.transformation ->> 'compositorContractVersion'[\s\S]*EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22/,
  )
  assert.match(
    migration,
    /asset\.transformation ->> 'sourceVisualPolicy'[\s\S]*EXACT_AUTHORIZED_PIXELS_ONLY/,
  )
  assert.match(
    migration,
    /cardinality\(control\.asset_ids\) in \(6, 7\)/,
  )
  assert.match(
    migration,
    /if cardinality\(v_control\.asset_ids\) = 7 then[\s\S]*assert_ebay_same_day_approved_v9_control_v1[\s\S]*else[\s\S]*assert_ebay_same_day_approved_v6_control_v1/,
  )
  assert.match(
    migration,
    /<> cardinality\(v_control\.asset_ids\)/,
  )
  assert.match(
    migration,
    /protectedManifestAssetCount'', cardinality\(v_control\.asset_ids\)/,
  )
  assert.match(
    migration,
    /SAME_DAY_WORKSPACE_APPROVED_V6_EVIDENCE_INVALID/,
  )
  assert.doesNotMatch(migration, /delete\s+from|truncate/i)
  assert.doesNotMatch(
    migration,
    /Inventory API|createOrReplaceInventoryItem|createOffer|publishOffer/i,
  )
})

test("commercial curation revisions preserve seven distinct outputs and up to five authorized views", async () => {
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20260724011000_enable_authorized_commercial_curation_revision.sql",
      import.meta.url,
    ),
    "utf8",
  )
  assert.match(
    migration,
    /cardinality\(control\.asset_ids\) in \(6, 7\)/,
  )
  assert.match(
    migration,
    /SAME_DAY_IMAGE_REVISION_ASSET_EVIDENCE_INVALID/,
  )
  assert.match(migration, /\) <> 7 then/)
  assert.match(migration, /v_source_count not between 1 and 5/)
  assert.match(migration, /authorized_source_count between 1 and 5/)
  assert.match(migration, /cardinality\(asset_ids\) in \(6, 7\)/)
  assert.match(migration, /performs zero eBay writes/)
  assert.match(migration, /competitor pixels and eBay writes remain forbidden/)
  assert.doesNotMatch(migration, /delete\s+from|truncate/i)
  assert.doesNotMatch(
    migration,
    /Inventory API|createOrReplaceInventoryItem|createOffer|publishOffer/i,
  )
})

test("catalog originals and all six feasibility gates run before an image attempt is claimed", async () => {
  const [runtime, revision, migration] = await Promise.all([
    source("./ebay-same-day-image-package-runtime.ts"),
    source("./ebay-same-day-image-revision-runtime.ts"),
    readFile(new URL("../../supabase/migrations/20260722006000_create_luna_catalog_original_source_packs_v2.sql", import.meta.url), "utf8"),
  ])
  for (const value of [runtime, revision]) {
    assert.match(value, /resolveLunaCatalogOriginalSourcePack/)
    assert.match(value, /persistAuthorizedCatalogSourcePack/)
    assert.match(value, /buildSellerOsEbayVisualStrategyV2/)
    assert.ok(value.indexOf("resolveLunaCatalogOriginalSourcePack") <
      value.indexOf("claim_ebay_same_day"))
    assert.ok(value.indexOf("persistAuthorizedCatalogSourcePack") <
      value.indexOf("claim_ebay_same_day"))
    assert.doesNotMatch(value,
      /Inventory API|publishOffer|createOffer|createOrReplaceInventoryItem/i)
  }
  assert.match(migration, /LUNA_CATALOG_ORIGINAL_SOURCE_RESOLVER_V2/)
  assert.match(migration, /CATALOG_ORIGINAL_DISCOVERY_COMPLETED/)
  assert.match(migration, /ALL_CATALOG_MEDIA_INSPECTED/)
  assert.match(migration, /SIX_SECONDARY_JOBS_FEASIBLE/)
  assert.match(migration, /openai_calls = 0 and ebay_writes = 0 and production_changed = false/)
  assert.doesNotMatch(migration, /delete\s+from|truncate/i)
})

test("AI generation fails closed when the seller visual brief is unavailable", async () => {
  const runtime = await source("./ebay-same-day-image-package-runtime.ts")
  assert.match(runtime, /if \(!isEbayImageMarketBriefUsable\(marketVisualBrief\)\)/)
  assert.match(runtime, /MARKET_VISUAL_SIGNALS_INSUFFICIENT/)
  assert.match(runtime, /loadEbayImageMarketBrief\([\s\S]*?buildSameDayImagePackagePlan/)
})

test("database boundary requires exact seven and the current human gate", async () => {
  const migration = await readFile(
    new URL("../../supabase/migrations/20260722004000_require_exact_authorized_source_pixels.sql", import.meta.url),
    "utf8",
  )
  assert.match(migration, /cardinality\(p_asset_ids\).*<> 7/s)
  assert.match(migration, /SELLER_OS_EBAY_VISUAL_QA_V2/)
  assert.match(migration, /textPolicyPassed/)
  assert.match(migration, /visualStrategyPosition,salesObjective/)
  assert.match(migration, /rights_evidence_confirmed is distinct from true/)
  assert.match(migration, /zero eBay writes/)
})

test("the browser receives temporary previews only and cannot approve an incomplete set", async () => {
  const [route, panel] = await Promise.all([
    readFile(new URL("../../app/api/admin/ebay/same-day-pilot/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/today-launch-panel.tsx", import.meta.url), "utf8"),
  ])
  assert.match(route, /createSignedUrl\(text\(asset\.output_storage_path, 1_000\), 300\)/)
  assert.doesNotMatch(route, /source_storage_path[^]*return \{/)
  assert.match(panel, /assets\.length === IMAGE_REVIEW_SLOTS\.length/)
  assert.match(panel, /disabled=\{working \|\| !imageSetReady\}/)
  assert.match(panel, /APROBAR IMÁGENES · SET DE 7/)
})
