import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"

import sharp from "sharp"

import {
  buildOpenAiFactsInputPackage,
} from "./ebay-product-facts-readiness.ts"
import {
  buildSameDayImagePackagePersistenceManifest,
  buildSameDayImagePackagePlan,
  disposeTransientSameDayImageAssets,
  generateTransientSameDayImagePackage,
  parseSameDayImagePackagePersistenceManifest,
} from "./ebay-same-day-image-package-service.ts"
import { SAME_DAY_MANUAL_HANDOFF_VERSION } from "./ebay-same-day-manual-handoff.ts"

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function authoritativePackage() {
  const rows = [
    ["PRODUCT_UNIT", "exactProductName", "Lysol Disinfecting Wipes Lemon", null, "VERIFIED"],
    ["PRODUCT_UNIT", "brand", "Lysol", null, "VERIFIED"],
    ["PRODUCT_UNIT", "condition", "New", null, "VERIFIED"],
    ["PRODUCT_UNIT", "unitCount", 15, "count", "VERIFIED"],
    ["PRODUCT_UNIT", "netContent", 15, "count", "CORROBORATED"],
    ["PRODUCT_UNIT", "scent", "Lemon", null, "CORROBORATED"],
    ["OFFER_PACK", "offerPackCount", 3, "count", "VERIFIED"],
    ["OFFER_PACK", "unitsPerPack", 15, "count", "VERIFIED"],
    ["OFFER_PACK", "totalUnitCount", 45, "count", "DERIVED_VERIFIED"],
  ]
  return buildOpenAiFactsInputPackage({
    facts: rows.map(([scope, key, value, unit, status], index) => ({
      factScope: scope,
      factKey: key,
      selectedValue: value,
      selectedUnit: unit,
      supportingObservationIds: [`observation-${index}`],
      supportingSourceTypes: status === "DERIVED_VERIFIED"
        ? ["INTERNAL_DERIVATION"]
        : ["LUNA_EXACT_VARIANT"],
      supportingSourceAuthorities: ["SUPPLIER"],
      conflictingObservationIds: [],
      resolutionRule: status === "DERIVED_VERIFIED"
        ? "AUTHORIZED_DERIVATION"
        : "FIELD_AUTHORITY_MATRIX",
      confidence: 0.95,
      verificationStatus: status,
      resolvedAt: "2026-07-18T12:00:00.000Z",
      resolverVersion: "TEST",
    })),
    readiness: {
      gates: { OPENAI_INPUT_READY: true },
      regulatory: { status: "NOT_APPLICABLE", blocking: false, missing: [] },
      conflicted: false,
    },
  })
}

function fixture() {
  const facts = authoritativePackage()
  const currentBinding = {
    candidateId: "candidate-current",
    factRunId: "fact-run-current",
    factPackageHash: facts.factPackageHash,
  }
  return {
    authoritativeFactsPackage: facts,
    currentBinding,
    handoffPackage: {
      version: SAME_DAY_MANUAL_HANDOFF_VERSION,
      candidateId: currentBinding.candidateId,
      factRunId: currentBinding.factRunId,
      images: {
        urls: [
          "https://authorized.example/product-front.jpg",
          "https://authorized.example/product-alternate.jpg",
        ],
        count: 2,
        source: "LUNA_AUTHORIZED_CATALOG",
        competitorImages: 0,
      },
      safety: {
        factsOnly: true,
        openAiCalls: 0,
        ebayWrites: 0,
        competitorContentUsed: false,
        authoritativeFactPackageHash: facts.factPackageHash,
      },
    },
    rightsEvidence: {
      rightsBasis: "supplier_authorized",
      authorizationReference: "Luna supplier agreement 2026-01",
      rightsEvidenceConfirmed: true,
    },
  }
}

async function sourceFixture(color = "#f6d146") {
  return sharp({
    create: { width: 1600, height: 1600, channels: 3, background: "#ffffff" },
  }).composite([{
    input: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1400">' +
      `<rect x="20" y="20" width="1160" height="1360" rx="60" fill="${color}"/>` +
      '<text x="600" y="620" text-anchor="middle" font-size="144">SOURCE</text>' +
      '<text x="600" y="820" text-anchor="middle" font-size="84">3 × 15</text>' +
      '</svg>',
    ),
    left: 200,
    top: 100,
  }]).jpeg().toBuffer()
}

async function sourceSet() {
  return Promise.all([sourceFixture(), sourceFixture("#f2ca35")])
}

function marketVisualBrief() {
  return {
    visualMarketBriefVersion: "VISUAL_MARKET_BRIEF_V2_2026_07_21",
    observedAt: new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString(),
    freshUntil: new Date(Date.now() + 29 * 24 * 60 * 60 * 1_000).toISOString(),
    confidence: "MEDIUM", sampleSize: 12,
    dominantBackgroundType: "WHITE_OR_NEUTRAL",
    recommendedFrameCoverage: "HIGH", recommendedComplexity: "LOW",
    packVisibilityPattern: "CLEAR", textOverlayPattern: "LOW",
    compositionPattern: "CENTERED", recommendedCopySpace: "RIGHT",
    contrastPattern: "HIGH", brightnessPattern: "LIGHT",
    palettePattern: "NEUTRAL", subjectGeometryPattern: "COMPACT",
    primaryCohort: "EXACT_PRODUCT", recencyWeightingApplied: true,
    supportingSignals: {
      whiteOrNeutralPercent: 75, highCoveragePercent: 66,
      lowComplexityPercent: 83, lowOrNoTextOverlayPercent: 91,
      clearMultipackPercent: 58, usableCopySpacePercent: 75,
      highContrastPercent: 66, lightBrightnessPercent: 75,
      neutralPalettePercent: 83, recentObservationPercent: 66,
    },
  }
}

async function sceneBoardFixture() {
  const colors = ["#dce5ef", "#ece5dc", "#dcebdd", "#eee0e6", "#e4def0", "#dae8e8"]
  const panels = await Promise.all(colors.map((color, index) => sharp({
    create: { width: 512, height: 512, channels: 3, background: color },
  }).composite([{
    input: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">` +
      `<rect x="${40 + index * 9}" y="${55 + index * 7}" width="${300 - index * 12}" height="${260 + index * 15}" rx="${18 + index * 4}" fill="#ffffff" opacity=".35"/>` +
      `</svg>`,
    ),
  }]).jpeg().toBuffer()))
  return sharp({
    create: { width: 1536, height: 1024, channels: 3, background: "#ffffff" },
  }).composite(panels.map((input, index) => ({
    input,
    left: (index % 3) * 512,
    top: Math.floor(index / 3) * 512,
  }))).jpeg().toBuffer()
}

test("deterministic runtime creates one main and six secondary assets", async () => {
  const input = fixture()
  const result = await generateTransientSameDayImagePackage({
    ...input,
    aiContext: { enabled: false },
    source: await sourceSet(),
    generatedAt: "2026-07-18T12:00:00.000Z",
  })
  assert.equal(result.transientAssets.length, 7)
  assert.ok(result.transientAssets.every((asset) => Buffer.isBuffer(asset.output)))
  assert.equal(result.counters.openAiCalls, 0)
  assert.equal(result.counters.assetsGenerated, 7)
  assert.deepEqual(
    parseSameDayImagePackagePersistenceManifest(result.persistenceManifest),
    result.persistenceManifest,
  )
  const persisted = JSON.stringify(result.persistenceManifest)
  assert.doesNotMatch(persisted, /authorized\.example|https?:|base64|Lysol|Lemon|Wipes/)
  assert.doesNotMatch(persisted, /authorizationReference"|sourceUrl"|output"/)
  assert.equal(result.persistenceManifest.assets.length, 7)
  assert.equal(result.persistenceManifest.safety.rawImagePersistedInManifest, false)
  disposeTransientSameDayImageAssets(result.transientAssets)
  assert.ok(result.transientAssets.every((asset) =>
    asset.output.every((byte) => byte === 0)))
})

test("AI mode makes one dossier-aware scene-board call and zeroes provider pixels", async () => {
  const input = fixture()
  const source = await sourceSet()
  let calls = 0
  let receivedPlan
  let providerPixels
  const result = await generateTransientSameDayImagePackage({
    ...input,
    aiContext: { enabled: true, model: "gpt-image-2", quality: "high" },
    marketVisualBrief: marketVisualBrief(),
    source,
    generatedAt: "2026-07-18T12:00:00.000Z",
    requestBackgroundPlate: async (...args) => {
      assert.equal(args.length, 1)
      const [plan] = args
      assert.equal(Buffer.isBuffer(plan), false)
      calls += 1
      receivedPlan = structuredClone(plan)
      providerPixels = await sceneBoardFixture()
      return {
        output: providerPixels,
        outputSha256: sha256(providerPixels),
        providerRequestId: "req-test",
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        plan,
      }
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.counters.openAiCalls, 1)
  assert.equal(result.counters.productBytesSentToOpenAi, 0)
  assert.equal(result.counters.productUrlsSentToOpenAi, 0)
  assert.equal(result.transientAssets.filter((asset) =>
    asset.transformation.generativeAiUsed).length, 6)
  assert.equal(result.transientAssets[0].transformation.generativeAiUsed, false)
  const outbound = JSON.stringify(receivedPlan).toLowerCase()
  assert.match(outbound, /lysol/)
  assert.match(outbound, /lemon/)
  assert.doesNotMatch(outbound, /authorized\.example|https?:|base64/)
  assert.equal(receivedPlan.sendsProductBytes, false)
  assert.equal(receivedPlan.sendsProductUrl, false)
  assert.equal(receivedPlan.quality, "high")
  assert.equal(result.persistenceManifest.ai.requestedQuality, "high")
  assert.ok(result.transientAssets.filter((asset) =>
    asset.transformation.generativeAiUsed).every((asset) =>
    asset.transformation.backgroundPlateQuality === "high"))
  assert.ok(result.transientAssets.slice(1).every((asset) =>
    asset.transformation.authorizedSourceTreatment ===
      "LOCAL_AUTHORIZED_FOREGROUND" &&
    asset.transformation.foregroundMatteVersion ===
      "EBAY_AUTHORIZED_FOREGROUND_MATTE_V1_2026_07_21" &&
    asset.qa.foregroundMatteValidated === true &&
    asset.qa.opaqueSourceFrameRemoved === true &&
    asset.qa.textSafeAreaVerified === undefined &&
    asset.qa.textPolicyPassed === true &&
    asset.qa.textLineCount === 0))
  assert.ok(result.persistenceManifest.assets.slice(1).every((asset) =>
    asset.foregroundMatteValidated === true &&
    asset.opaqueSourceFrameRemoved === true &&
    asset.textSafeAreaVerified === undefined &&
    asset.textPolicyPassed === true &&
    asset.textLineCount === 0))
  const alternate = result.transientAssets.find((asset) =>
    asset.transformation.visualStrategyPosition?.salesObjective ===
      "ALTERNATE_AUTHORIZED_ANGLE")
  assert.equal(alternate?.transformation.authorizedSourceIndex, 1)
  const detail = result.transientAssets.find((asset) =>
    asset.transformation.visualStrategyPosition?.salesObjective ===
      "QUALITY_DETAIL")
  assert.equal(detail?.transformation.authorizedCropMode,
    "REAL_SOURCE_CROP_NO_UPSCALING")
  assert.ok(providerPixels.every((byte) => byte === 0))
  disposeTransientSameDayImageAssets(result.transientAssets)
})

test("unsafe foreground fails before any paid image-provider call", async () => {
  const input = fixture()
  const ambiguousSource = await sharp({
    create: { width: 1600, height: 1600, channels: 3, background: "#ffffff" },
  }).jpeg().toBuffer()
  let calls = 0
  await assert.rejects(generateTransientSameDayImagePackage({
    ...input,
    aiContext: { enabled: true, model: "gpt-image-2", quality: "high" },
    marketVisualBrief: marketVisualBrief(),
    source: [ambiguousSource, await sharp({
      create: { width: 1601, height: 1600, channels: 3, background: "#ffffff" },
    }).jpeg().toBuffer()],
    requestBackgroundPlate: async () => {
      calls += 1
      throw new Error("MUST_NOT_RUN")
    },
  }), /EBAY_IMAGE_FOREGROUND_EXTRACTION_UNSAFE/)
  assert.equal(calls, 0)
})

test("a small visible product requests a higher-resolution Luna view before provider spend", async () => {
  const input = fixture()
  const smallProduct = await sharp({
    create: { width: 1600, height: 1600, channels: 3, background: "#ffffff" },
  }).composite([{
    input: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420">' +
      '<rect x="10" y="10" width="400" height="400" rx="30" fill="#f6d146"/>' +
      '</svg>',
    ),
    left: 590,
    top: 590,
  }]).jpeg().toBuffer()
  let calls = 0
  await assert.rejects(generateTransientSameDayImagePackage({
    ...input,
    aiContext: { enabled: true, model: "gpt-image-2", quality: "high" },
    marketVisualBrief: marketVisualBrief(),
    source: [smallProduct],
    requestBackgroundPlate: async () => {
      calls += 1
      throw new Error("MUST_NOT_RUN")
    },
  }), /NEEDS_ADDITIONAL_SOURCE_IMAGE:HIGH_RESOLUTION_PRODUCT_VIEW/)
  assert.equal(calls, 0)
})

test("a transient provider failure is attempted once and never retried internally", async () => {
  const input = fixture()
  let calls = 0
  await assert.rejects(generateTransientSameDayImagePackage({
    ...input,
    aiContext: { enabled: true, model: "gpt-image-2" },
    marketVisualBrief: marketVisualBrief(),
    source: await sourceSet(),
    requestBackgroundPlate: async () => {
      calls += 1
      throw new Error("TRANSIENT_TEST_FAILURE")
    },
  }), /TRANSIENT_TEST_FAILURE/)
  assert.equal(calls, 1)
})

test("a malformed provider plate is rejected once and its pixels are erased", async () => {
  const input = fixture()
  let calls = 0
  let rejectedPixels
  await assert.rejects(generateTransientSameDayImagePackage({
    ...input,
    aiContext: { enabled: true, model: "gpt-image-2" },
    marketVisualBrief: marketVisualBrief(),
    source: await sourceSet(),
    requestBackgroundPlate: async (plan) => {
      calls += 1
      rejectedPixels = await sharp({
        create: { width: 1536, height: 1024, channels: 3, background: "#dce5ef" },
      }).jpeg().toBuffer()
      return {
        output: rejectedPixels,
        outputSha256: "f".repeat(64),
        providerRequestId: "req-invalid",
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        plan,
      }
    },
  }), /SAME_DAY_IMAGE_BACKGROUND_PLATE_INVALID/)
  assert.equal(calls, 1)
  assert.ok(rejectedPixels.every((byte) => byte === 0))
})

test("rights validation occurs before any image-provider call", async () => {
  const input = fixture()
  let calls = 0
  await assert.rejects(generateTransientSameDayImagePackage({
    ...input,
    rightsEvidence: { ...input.rightsEvidence, rightsEvidenceConfirmed: false },
    aiContext: { enabled: true, model: "gpt-image-2" },
    source: await sourceSet(),
    requestBackgroundPlate: async () => {
      calls += 1
      throw new Error("MUST_NOT_RUN")
    },
  }), /EBAY_IMAGE_RIGHTS_EVIDENCE_CONFIRMATION_REQUIRED/)
  assert.equal(calls, 0)
})

test("manifest parser rejects tampering, duplicate slots and raw persistence fields", async () => {
  const input = fixture()
  const source = await sourceSet()
  const result = await generateTransientSameDayImagePackage({
    ...input,
    aiContext: { enabled: false },
    source,
    generatedAt: "2026-07-18T12:00:00.000Z",
  })
  const tampered = structuredClone(result.persistenceManifest)
  tampered.assets[0].outputSha256 = "f".repeat(64)
  assert.equal(parseSameDayImagePackagePersistenceManifest(tampered), null)
  const duplicated = structuredClone(result.persistenceManifest)
  duplicated.assets[5].slot = duplicated.assets[0].slot
  assert.equal(parseSameDayImagePackagePersistenceManifest(duplicated), null)
  const raw = { ...structuredClone(result.persistenceManifest), sourceUrl: "https://example.test" }
  assert.equal(parseSameDayImagePackagePersistenceManifest(raw), null)
  const bytes = structuredClone(result.persistenceManifest)
  bytes.assets[0].rawBytes = "base64-data"
  assert.equal(parseSameDayImagePackagePersistenceManifest(bytes), null)
  const forgedForeground = structuredClone(result.persistenceManifest)
  forgedForeground.assets[1].foregroundMatteValidated = false
  assert.equal(parseSameDayImagePackagePersistenceManifest(forgedForeground), null)

  const forgedPlan = buildSameDayImagePackagePlan({
    ...input,
    aiContext: { enabled: false },
  })
  forgedPlan.factoryInput.identityFingerprint = `sha256:${"e".repeat(64)}`
  assert.throws(() => buildSameDayImagePackagePersistenceManifest({
    plan: forgedPlan,
    assets: result.transientAssets,
    sourceSha256s: source.map(sha256),
    openAiCalls: 0,
    generatedAt: "2026-07-18T12:00:00.000Z",
  }), /SAME_DAY_IMAGE_PACKAGE_PLAN_INVALID/)
  disposeTransientSameDayImageAssets(result.transientAssets)
})

test("runtime service has no database, environment, network or generation-table dependency", async () => {
  const source = await readFile(
    new URL("./ebay-same-day-image-package-service.ts", import.meta.url),
    "utf8",
  )
  assert.doesNotMatch(source, /supabase|\.from\(|fetch\(|process\.env/)
  assert.doesNotMatch(source, /marketplace_listing_generations/)
  assert.doesNotMatch(source, /same-day-pilot-service/)
})
