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
  const service = await source("./ebay-same-day-pilot-service.ts")
  assert.match(service, /jobType: "GENERATE_SIX_IMAGE_PACKAGE"/)
  assert.match(service, /const visualEvidenceBatchId = text\(candidate\.product_research_capture_batch_id\)/)
  assert.match(service, /SAME_DAY_PILOT_IMAGE_VISUAL_EVIDENCE_BINDING_MISSING/)
  assert.match(service,
    /GENERATE_SIX_IMAGE_PACKAGE:VISUAL_V2:\$\{visualEvidenceBatchId\}:\$\{handoffSummary\.packageHash\}/)
  assert.match(service, /productResearchCaptureBatchId: visualEvidenceBatchId/)
  assert.match(service, /generationAttemptVersion: "VISUAL_V2_CAPTURE_BOUND_V1_2026_07_21"/)
  assert.doesNotMatch(service,
    /idempotencyKey: `\$\{state\.run\.id\}:\$\{candidate\.id\}:GENERATE_SIX_IMAGE_PACKAGE`,/)
  assert.match(service, /previousState: "PREPARING_IMAGE_PACKAGE",\s*nextState: "WAITING_IMAGE_APPROVAL"/)
  assert.match(service, /jobType: "APPROVE_SIX_IMAGE_SET"/)
  assert.match(service, /jobType: "FINALIZE_MANUAL_HANDOFF"/)
  assert.match(service, /continuationJobType: "APPROVE_SIX_IMAGE_SET"/)
  assert.doesNotMatch(service, /continuationJobType: "FINALIZE_MANUAL_HANDOFF"[^]*title: "Revisa el set completo/)
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
  assert.match(panel, /EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21/)
  assert.match(panel, /foregroundMatteValidated === true/)
  assert.match(panel, /opaqueSourceFrameRemoved === true/)
  assert.match(panel, /textSafeAreaVerified === true/)
  assert.match(panel, /asset\.backgroundPlateQuality === "high"/)
  assert.match(route, /foregroundMatteValidated: qa\.foregroundMatteValidated === true/)
})

test("runtime persists six review assets but never invokes an eBay write API", async () => {
  const runtime = await source("./ebay-same-day-image-package-runtime.ts")
  assert.match(runtime, /ebay_create_pending_listing_image_set/)
  assert.match(runtime, /persistedAssetIds\.length !== 6/)
  assert.match(runtime, /review_ebay_same_day_pilot_image_package_set/)
  assert.match(runtime, /ebayWrites: 0/)
  assert.doesNotMatch(runtime, /Inventory API|publishOffer|createOffer|createOrReplaceInventoryItem|reviseItem/i)
  assert.doesNotMatch(runtime, /recursive|\/api\/admin\/ebay\/images/)
})

test("AI generation fails closed when the seller visual brief is unavailable", async () => {
  const runtime = await source("./ebay-same-day-image-package-runtime.ts")
  assert.match(runtime, /if \(aiEnabled && !marketVisualBrief\)/)
  assert.match(runtime, /SAME_DAY_IMAGE_MARKET_BRIEF_REQUIRED/)
  assert.match(runtime, /loadEbayImageMarketBrief\([\s\S]*?buildSameDayImagePackagePlan/)
})

test("database boundary requires exact six, current human gate and safe partial context", async () => {
  const migration = await readFile(
    new URL("../../supabase/migrations/20260718054000_create_same_day_pilot_image_package_control.sql", import.meta.url),
    "utf8",
  )
  assert.match(migration, /cardinality\(p_asset_ids\).*<> 6/s)
  assert.match(migration, /gate_type = 'IMAGE_APPROVAL_REQUIRED'/)
  assert.match(migration, /task\.status = 'OPEN'/)
  assert.match(migration, /'USE_CONTEXT'/)
  assert.match(migration, /'EBAY_OPENAI_BACKGROUND_PLATE_V1'/)
  assert.match(migration, /rights_evidence_confirmed is distinct from true/)
  assert.match(migration, /competitor_image_count = 0/)
  assert.match(migration, /ebay_writes = 0/)
  assert.match(migration, /production_changed = false/)
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
