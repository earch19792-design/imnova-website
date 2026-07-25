import assert from "node:assert/strict"
import test from "node:test"

import {
  evaluateApprovedImageRevisionAutomationGate,
  evaluateApprovedSameDayImageSetAutomationGate,
} from "./final-listing-review-publication-gate.ts"

const actor = "11111111-1111-4111-8111-111111111111"
const revisionId = "22222222-2222-4222-8222-222222222222"
const squarePresentationVersion =
  "SELLER_OS_EBAY_SQUARE_PRESENTATION_QA_V1_2026_07_24"
const slots = [
  "MAIN_WHITE_BACKGROUND",
  "SIZE_AND_CONTENT",
  "KEY_FEATURES",
  "USE_CONTEXT",
  "PACK_AND_COUNT",
  "PACKAGE_CONTENTS",
  "SECONDARY_6",
]
const objectives = [
  null,
  "ALTERNATE_AUTHORIZED_ANGLE",
  "QUALITY_DETAIL",
  "PRIMARY_USE",
  "PACKAGE_CONTENTS",
  "TRUST_OR_OBJECTION",
  "RETURN_RISK_CLARIFICATION",
]

function evidence() {
  const assets = slots.map((slot, index) => {
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
    const sourceSha = String((index % 5) + 1).repeat(64)
    const outputSha = String(index + 1).repeat(64)
    const url = `https://example.com/${id}.jpg`
    return {
      id,
      status: "approved",
      approved_by: actor,
      approved_at: "2026-07-24T12:00:00.000Z",
      public_url: url,
      source_sha256: sourceSha,
      output_sha256: outputSha,
      output_width: 1600,
      output_height: 1600,
      rights_evidence_confirmed: true,
      transformation: {
        slot,
        compositorContractVersion:
          "EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22",
        curationContractVersion:
          "SELLER_OS_AUTHORIZED_COMMERCIAL_CURATION_V1_2026_07_24",
        presentationMode: "AUTHORIZED_MULTI_SOURCE",
        ...(index === 0 ? {} : {
          authorizedSourceTreatment: "LOCAL_AUTHORIZED_FOREGROUND",
          foregroundMatteMethod: "EDGE_CONNECTED_LIGHT_NEUTRAL_V1",
        }),
        sourceVisualPolicy: "EXACT_AUTHORIZED_PIXELS_ONLY",
        authorizedSourceViewReused: true,
        originalPackagePixelsPreserved: true,
        competitorImageUsed: false,
        competitorPixelsUsed: false,
        verifiedFactsOnly: true,
        calypsoProductFactsUsed: false,
        productDossierFactsChanged: false,
        generativeAiUsed: false,
        squarePresentationVersion,
        artificialFrameAdded: false,
        outputEncodingQuality: 94,
        ...(objectives[index] ? {
          visualStrategyPosition: {
            salesObjective: objectives[index],
          },
        } : {}),
      },
      qa_result: {
        automaticStatus: "PASSED",
        mainBackground: index === 0 ? "PURE_WHITE" : "NOT_APPLICABLE",
        productFidelityPassed: true,
        commercialQualityPassed: true,
        technicalQualityPassed: true,
        compositionPassed: true,
        textPolicyPassed: true,
        contextualPropsPassed: true,
        mobileReadabilityPassed: true,
        squarePresentationQaVersion: squarePresentationVersion,
        squareFormatPassed: true,
        artificialInsetFrameFree: true,
        sourceQualityPassed: true,
        safeCanvasPlacementPassed: true,
        mobileFocalPointPassed: true,
        productCoverageRatio: index === 0 ? .8 : .7,
        sourceViewCapabilityPassed: true,
        marketSignalsLimitedToScene: true,
        hiddenProductGeometryGenerated: false,
        qaEvaluatorVersion: "SELLER_OS_EBAY_VISUAL_QA_V2",
        failureReasons: [],
        blockers: [],
      },
    }
  })
  const revisionManifest = assets.map((asset, index) => ({
    assetId: asset.id,
    outputSha256: asset.output_sha256,
    sourceSha256: asset.source_sha256,
    slot: slots[index],
  }))
  const packageManifest = assets.map((asset) => ({
    assetId: asset.id,
    sha256: asset.output_sha256,
    url: asset.public_url,
  }))
  return {
    listingPackage: {
      status: "draft",
      package_data: {
        preferredImageRevisionId: revisionId,
        imageUrls: assets.map((asset) => asset.public_url),
        imageAssetManifest: packageManifest,
      },
    },
    revision: {
      id: revisionId,
      status: "APPROVED",
      strategy_version: "VISUAL_STRATEGY_V2",
      revision_contract: "LEGACY_VISUAL_STRATEGY_V2",
      human_decision: "APPROVED",
      reviewed_by: actor,
      reviewed_at: "2026-07-24T12:00:00.000Z",
      openai_calls: 0,
      competitor_image_count: 0,
      ebay_writes: 0,
      production_changed: false,
      image_set_hash: "a".repeat(64),
      authorized_source_count: 5,
      asset_ids: assets.map((asset) => asset.id),
      asset_manifest: revisionManifest,
    },
    assets,
  }
}

test("an approved commercial curation can replace the mandatory visual preview", () => {
  const gate = evaluateApprovedImageRevisionAutomationGate(evidence())
  assert.equal(gate.allowed, true)
  assert.equal(gate.reason, null)
  assert.equal(gate.source, "APPROVED_IMAGE_REVISION_AUTOMATED_QA")
  assert.equal(gate.selectedAssets, 7)
  assert.equal(gate.passedAssets, 7)
  assert.equal(gate.readyForUnpublishedOfferAuthorization, true)
})

test("automatic publication pauses on commercial, identity, or source-diversity exceptions", () => {
  const weak = evidence()
  weak.assets[3].qa_result.commercialQualityPassed = false
  assert.equal(
    evaluateApprovedImageRevisionAutomationGate(weak).allowed,
    false,
  )

  const singleSource = evidence()
  for (const asset of singleSource.assets) {
    asset.source_sha256 = "f".repeat(64)
  }
  singleSource.revision.authorized_source_count = 1
  singleSource.revision.asset_manifest.forEach((entry) => {
    entry.sourceSha256 = "f".repeat(64)
  })
  assert.equal(
    evaluateApprovedImageRevisionAutomationGate(singleSource).allowed,
    false,
  )

  const wrongIdentityContract = evidence()
  wrongIdentityContract.assets[0].transformation
    .productDossierFactsChanged = true
  assert.equal(
    evaluateApprovedImageRevisionAutomationGate(wrongIdentityContract).allowed,
    false,
  )

  const framedSecondary = evidence()
  framedSecondary.assets[4].transformation.authorizedSourceTreatment =
    "PRESERVED_FRAMED_SOURCE"
  assert.equal(
    evaluateApprovedImageRevisionAutomationGate(framedSecondary).allowed,
    false,
  )
})

test("the automated route cannot substitute for the protected Calypso V3 review", () => {
  const protectedV3 = evidence()
  protectedV3.revision.strategy_version = "VISUAL_STRATEGY_V3"
  protectedV3.revision.revision_contract =
    "REFERENCE_GUIDED_PRODUCT_GENERATION_V1"
  assert.equal(
    evaluateApprovedImageRevisionAutomationGate(protectedV3).allowed,
    false,
  )
})

function sameDayEvidence() {
  const base = evidence()
  const runId = "33333333-3333-4333-8333-333333333333"
  const candidateId = "44444444-4444-4444-8444-444444444444"
  const controlId = "55555555-5555-4555-8555-555555555555"
  const sameSourceHash = "f".repeat(64)
  base.assets.forEach((asset, index) => {
    asset.source_sha256 = sameSourceHash
    asset.created_by = actor
    asset.transformation.version =
      "EBAY_LISTING_IMAGE_COMPOSITION_SET_V2"
    asset.transformation.presentationMode =
      "SINGLE_SOURCE_INFORMATIONAL"
    asset.transformation.authorizedSourceTreatment = index === 0
      ? "PRESERVED_FRAMED_SOURCE"
      : "LOCAL_AUTHORIZED_FOREGROUND"
    asset.transformation.sameDayPilotRunId = runId
    asset.transformation.sameDayPilotCandidateId = candidateId
    asset.transformation.sameDayImageControlId = controlId
  })
  const manifest = base.assets.map((asset, index) => ({
    assetId: asset.id,
    position: index,
    sha256: asset.output_sha256,
    url: asset.public_url,
    automaticQa: "PASSED",
    humanApprovedAt: "2026-07-24T12:00:00.000Z",
    generativeAiUsed: false,
  }))
  return {
    listingPackage: {
      status: "draft",
      created_by: actor,
      package_data: {
        sameDayPilot: { runId, candidateId },
        imageUrls: base.assets.map((asset) => asset.public_url),
        imageAssetManifest: manifest,
      },
    },
    assets: base.assets,
  }
}

test("an approved same-day seven-image set can replace the orphaned final review", () => {
  const gate = evaluateApprovedSameDayImageSetAutomationGate(
    sameDayEvidence(),
  )
  assert.equal(gate.allowed, true)
  assert.equal(gate.reason, null)
  assert.equal(gate.source, "APPROVED_SAME_DAY_IMAGE_SET_AUTOMATED_QA")
  assert.equal(gate.selectedAssets, 7)
  assert.equal(gate.passedAssets, 7)
})

test("the same-day gate accepts one authorized Luna source but not a failed asset", () => {
  const safeSingleSource = sameDayEvidence()
  assert.equal(
    new Set(safeSingleSource.assets.map((asset) => asset.source_sha256)).size,
    1,
  )
  assert.equal(
    evaluateApprovedSameDayImageSetAutomationGate(safeSingleSource).allowed,
    true,
  )

  const failed = sameDayEvidence()
  failed.assets[4].qa_result.commercialQualityPassed = false
  assert.equal(
    evaluateApprovedSameDayImageSetAutomationGate(failed).allowed,
    false,
  )
})
