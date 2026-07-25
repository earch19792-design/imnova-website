import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  assertStoredSameDayImageSetQaPassed,
  currentAttemptPublicObjects,
  hasReviewableSameDaySecondaryAssetContracts,
} from "./ebay-image-approval-policy.ts"

const squarePresentationVersion =
  "SELLER_OS_EBAY_SQUARE_PRESENTATION_QA_V1_2026_07_24"
const passedAsset = (index) => ({
  source_sha256: index < 4 ? "a".repeat(64) : "b".repeat(64),
  transformation: {
    slot: slots[index],
    squarePresentationVersion,
    artificialFrameAdded: false,
    outputEncodingQuality: 94,
  },
  qa_result: {
    automaticStatus: "PASSED",
    structuralDiversityVerified: true,
      copyDuplicateFree: true,
      offerPackPresentationPassed: true,
    squarePresentationQaVersion: squarePresentationVersion,
    squareFormatPassed: true,
    artificialInsetFrameFree: true,
    sourceQualityPassed: true,
    safeCanvasPlacementPassed: true,
    mobileFocalPointPassed: true,
  },
})
const slots = [
  "MAIN_WHITE_BACKGROUND",
  "PACK_AND_COUNT",
  "KEY_FEATURES",
  "SIZE_AND_CONTENT",
  "USE_CONTEXT",
  "PACKAGE_CONTENTS",
  "SECONDARY_6",
]
const expectedVersions = {
  compositorContractVersion: "EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22",
  foregroundMatteVersion: "EBAY_AUTHORIZED_FOREGROUND_MATTE_V1_2026_07_21",
  textRendererVersion: "EBAY_IMAGE_TEXT_PANGO_FONTFILE_V2_2026_07_21",
  slots,
}
const currentSingleSourceAsset = (slot, index) => ({
  source_sha256: "a".repeat(64),
  transformation: {
    slot,
    compositorContractVersion: expectedVersions.compositorContractVersion,
    presentationMode: "SINGLE_SOURCE_INFORMATIONAL",
    generativeAiUsed: false,
    competitorImageUsed: false,
    verifiedFactsOnly: true,
    sourceVisualPolicy: "EXACT_AUTHORIZED_PIXELS_ONLY",
    authorizedSourceViewReused: true,
    visualEvidenceMode: "PROFESSIONAL_FALLBACK",
    squarePresentationVersion,
    artificialFrameAdded: false,
    outputEncodingQuality: 94,
    ...(slot === "MAIN_WHITE_BACKGROUND" ? {} : {
      authorizedSourceTreatment: "LOCAL_AUTHORIZED_FOREGROUND",
      foregroundMatteVersion: expectedVersions.foregroundMatteVersion,
      foregroundMatteMethod: "EDGE_CONNECTED_LIGHT_NEUTRAL_V1",
      visualStrategyPosition: { salesObjective: `OBJECTIVE_${index}` },
    }),
  },
  qa_result: {
    automaticStatus: "PASSED",
    productFidelityPassed: true,
    commercialQualityPassed: true,
    technicalQualityPassed: true,
    compositionPassed: true,
    textPolicyPassed: true,
    contextualPropsPassed: true,
    mobileReadabilityPassed: true,
    sourceViewCapabilityPassed: true,
    marketSignalsLimitedToScene: true,
    hiddenProductGeometryGenerated: false,
    squarePresentationQaVersion: squarePresentationVersion,
    squareFormatPassed: true,
    artificialInsetFrameFree: true,
    sourceQualityPassed: true,
    safeCanvasPlacementPassed: true,
    mobileFocalPointPassed: true,
    textLineCount: 0,
    manualChecksRequired: [
      "SINGLE_SOURCE_INFORMATIONAL_PANELS_NOT_MULTIPLE_PRODUCT_VIEWS",
    ],
    ...(slot === "MAIN_WHITE_BACKGROUND" ? {} : {
      foregroundMatteValidated: true,
      opaqueSourceFrameRemoved: true,
    }),
  },
})

test("only exact stored PASSED values can approve an atomic seven-image set", () => {
  assert.doesNotThrow(() => assertStoredSameDayImageSetQaPassed(
    Array.from({ length: 7 }, (_value, index) => passedAsset(index)),
  ))
  for (const invalid of ["PARTIAL", null, undefined, "passed", "UNKNOWN"]) {
    const assets = Array.from(
      { length: 7 },
      (_value, index) => passedAsset(index),
    )
    assets[6] = invalid === undefined
      ? { ...assets[6], qa_result: {} }
      : {
          ...assets[6],
          qa_result: { ...assets[6].qa_result, automaticStatus: invalid },
        }
    assert.throws(
      () => assertStoredSameDayImageSetQaPassed(assets),
      /SAME_DAY_IMAGE_SET_QA_NOT_PASSED/,
    )
  }
})

test("storage compensation selects only objects created by the current attempt", () => {
  const currentHash = "a".repeat(64)
  const objects = currentAttemptPublicObjects([
    { published_storage_path: "actor/item/new-1.jpg",
      output_sha256: currentHash, public_object_created: true },
    { published_storage_path: "actor/item/existing-identical.jpg",
      output_sha256: currentHash, public_object_created: false },
    { published_storage_path: "actor/item/untracked.jpg",
      output_sha256: "invalid", public_object_created: true },
  ])
  assert.deepEqual(objects, [{
    path: "actor/item/new-1.jpg",
    sha256: currentHash,
    createdByCurrentAttempt: true,
  }])
})

test("deterministic single-source informational sets fail the approval gate", () => {
  const assets = slots.map(currentSingleSourceAsset)
  assert.throws(
    () => assertStoredSameDayImageSetQaPassed(assets),
    /SAME_DAY_IMAGE_SET_SOURCE_DIVERSITY_NOT_PASSED/,
  )
})

test("secondary text contract distinguishes zero text from rendered text", () => {
  const noText = currentSingleSourceAsset("SECONDARY_6", 6)
  assert.equal(
    hasReviewableSameDaySecondaryAssetContracts(noText, expectedVersions),
    true,
  )
  const renderedText = currentSingleSourceAsset("SECONDARY_6", 6)
  renderedText.qa_result.textLineCount = 1
  renderedText.transformation.textRendererVersion =
    expectedVersions.textRendererVersion
  renderedText.qa_result.textSafeAreaVerified = true
  renderedText.qa_result.textGlyphsValidated = true
  assert.equal(
    hasReviewableSameDaySecondaryAssetContracts(
      renderedText,
      expectedVersions,
    ),
    true,
  )
  delete renderedText.transformation.textRendererVersion
  assert.equal(
    hasReviewableSameDaySecondaryAssetContracts(
      renderedText,
      expectedVersions,
    ),
    false,
  )
})

test("UI, API, SQL and publication gates all fail closed on non-PASSED QA", () => {
  const ui = readFileSync("app/admin/ebay/listing-workspace/page.tsx", "utf8")
  const api = readFileSync("app/api/admin/ebay/images/route.ts", "utf8")
  const migration = readFileSync(
    "supabase/migrations/20260722003000_require_passed_professional_image_qa.sql",
    "utf8",
  )
  const publication = readFileSync(
    "lib/ebay/ebay-same-day-authorized-publication.ts",
    "utf8",
  )
  assert.match(ui,
    /disabled=\{imageBusy \|\| asset\.qa_result\?\.automaticStatus !== "PASSED"\}/)
  assert.match(api,
    /record\(reviewAsset\.qa_result\)\.automaticStatus !== "PASSED"/)
  assert.match(migration,
    /automaticStatus' is distinct from 'PASSED'/)
  assert.match(migration, /for update/)
  assert.match(migration, /before insert or update of status/)
  assert.match(publication, /asset\.automaticQa === "PASSED"/)
})

test("failed RPC compensation is explicit and no eBay write exists in review runtime", () => {
  const runtime = readFileSync(
    "lib/ebay/ebay-same-day-image-package-runtime.ts",
    "utf8",
  )
  assert.match(runtime, /Promise\.allSettled/)
  assert.match(runtime, /PUBLIC_STORAGE_COMPENSATION_FAILED/)
  assert.match(runtime, /public_object_created: !uploaded\.error/)
  assert.match(runtime, /ebayWrites: 0/)
  assert.doesNotMatch(runtime, /publishOffer|createOffer|bulkCreateOffer/)
})

test("SQL approval and publication require exact authorized product pixels", () => {
  const migration = readFileSync(
    "supabase/migrations/20260722004000_require_exact_authorized_source_pixels.sql",
    "utf8",
  )
  assert.match(migration, /EXACT_AUTHORIZED_PIXELS_ONLY/g)
  assert.match(migration, /authorizedSourceViewReused/g)
  assert.match(migration, /sourceViewCapabilityPassed/g)
  assert.match(migration, /marketSignalsLimitedToScene/g)
  assert.match(migration, /hiddenProductGeometryGenerated/g)
  assert.match(migration, /assert_same_day_pilot_image_set_safe/)
  assert.match(migration, /assert_ebay_publish_image_set_high_quality/)
  assert.match(migration, /zero eBay/)
})

test("the current seven-image AI review contract requires all six secondaries", () => {
  const runtime = readFileSync(
    "lib/ebay/ebay-same-day-image-package-runtime.ts",
    "utf8",
  )
  assert.match(runtime, /const aiBoardSet = generated\.length === 6/)
  assert.doesNotMatch(runtime, /const aiBoardSet = generated\.length === 5/)
})

test("legacy six-image packages can open only for a seven-image V2 correction", () => {
  const publication = readFileSync(
    "lib/ebay/ebay-same-day-authorized-publication.ts",
    "utf8",
  )
  assert.match(publication, /recoverableLegacySixImageSet/)
  assert.match(publication, /allowRecoverablePackageImages === true/)
  assert.match(publication, /legacyImageRevisionRequired/)
  assert.match(publication, /approvedPreferredImageRevision/)
  assert.match(publication, /\.eq\("status", "APPROVED"\)/)
  assert.match(publication,
    /validatedManifest\(input\.packageData, input\.packageImageUrls,[\s\S]*referenceGuidedV3/)
  assert.match(publication, /approvedImageCount: 7/)
})

test("account policies reuse the unexpired account profile automatically", () => {
  const route = readFileSync(
    "app/api/admin/ebay/account-policies/route.ts",
    "utf8",
  )
  const workspace = readFileSync(
    "app/admin/ebay/listing-workspace/page.tsx",
    "utf8",
  )
  assert.match(route, /from\("ebay_account_policy_profiles"\)/)
  assert.match(route, /\.gt\("expires_at", new Date\(\)\.toISOString\(\)\)/)
  assert.match(route, /text\(requested\.fulfillmentPolicyId\)[\s\S]*savedProfile\?\.fulfillment_policy_id/)
  assert.match(route, /text\(requested\.merchantLocationKey\)[\s\S]*savedProfile\?\.merchant_location_key/)
  assert.match(workspace,
    /setDraftState\(\(current\) => \(\{ preflight: current\.preflight \}\)\)/)
})

test("Luna freshness recheck cannot deadlock a historical six-to-seven V2 upgrade", () => {
  const migration = readFileSync(
    "supabase/migrations/20260722005000_allow_luna_recheck_during_visual_v2_upgrade.sql",
    "utf8",
  )
  assert.match(migration, /imageUrls'\) not in \(6, 7\)/)
  assert.match(migration, /is_ebay_approved_visual_v2_revision_set/)
  assert.match(migration, /automaticStatus' is distinct from 'PASSED'/)
  assert.match(migration, /SELLER_OS_EBAY_VISUAL_QA_V2/)
  assert.match(migration, /cardinality\(control\.asset_ids\) in \(6, 7\)/)
  assert.match(migration, /ebay_writes = 0/)
  assert.match(migration, /not revision\.production_changed/)
})

test("legacy V2 upgrade skips premature publication preflight and hides rejected clutter", () => {
  const workspace = readFileSync(
    "app/admin/ebay/listing-workspace/page.tsx",
    "utf8",
  )
  const imagesRoute = readFileSync(
    "app/api/admin/ebay/images/route.ts",
    "utf8",
  )
  assert.match(workspace, /legacyVisualUpgradeRequired/)
  assert.match(workspace,
    /Completa y aprueba la revisión visual activa de siete imágenes/)
  assert.match(workspace, /currentPackageImageAssets/)
  assert.match(workspace, /activos rechazados o versiones anteriores permanecen en el historial técnico/)
  assert.match(workspace, /Conjunto histórico actual · 6 · no publicable/)
  assert.match(imagesRoute, /exactSevenHumanReviewRequired: true/)
  assert.doesNotMatch(imagesRoute, /exactSixHumanReviewRequired: true/)
})
