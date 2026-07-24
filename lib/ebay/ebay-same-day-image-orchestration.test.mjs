import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { selectCaptureBoundEbayImageMarketBrief } from "./ebay-image-market-brief.ts"

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8")
}

const storedBrief = (fingerprint, sampleSize, primaryCohort = "FAMILY_FALLBACK") => ({
  product_family_fingerprint: fingerprint,
  confidence: "LOW",
  sample_size: sampleSize,
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
  ], exactFingerprint)
  assert.equal(family?.primaryCohort, "FAMILY_FALLBACK")
  assert.equal(family?.sampleSize, 5)

  const inconsistent = storedBrief(familyFingerprint, 5)
  inconsistent.brief.productBaseFingerprint = `sha256:${"c".repeat(64)}`
  assert.equal(selectCaptureBoundEbayImageMarketBrief([
    inconsistent,
  ], exactFingerprint), null)
})

test("same-day state machine chains generation and batch approval automatically", async () => {
  const [service, lineage] = await Promise.all([
    source("./ebay-same-day-pilot-service.ts"),
    source("./ebay-same-day-image-job-lineage.ts"),
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
  assert.match(recovery, /isDeferredLegacyVisualMarketRecovery/)
  assert.match(recovery, /competingCandidateIds/)
  assert.match(recovery,
    /if \(visualMarketRecoveryPriorityCandidate\(state\)\) return 0/)
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
  assert.doesNotMatch(catchRecovery, /rejectAndPromote/)
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
  assert.match(panel, /EBAY_IMAGE_COMPOSITOR_FOREGROUND_V8_2026_07_22/)
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
  assert.match(runtime, /if \(!marketVisualBrief \|\| marketVisualBrief\.confidence === "LOW"/)
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
  assert.match(panel, /APROBAR IMÁGENES · SET DE 6/)
})
