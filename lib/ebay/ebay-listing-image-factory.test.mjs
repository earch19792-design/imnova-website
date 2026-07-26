import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

import sharp from "sharp"

import {
  EBAY_AUTHORIZED_FOREGROUND_MATTE_VERSION,
  assertEbayImageEvidenceSufficiency,
  buildSafeOpenAiBackgroundPlatePlan,
  buildEbayVisualPanelContracts,
  buildSellerOsEbaySetLevelCreativeBrief,
  buildSellerOsEbayVisualStrategyV2,
  buildVerifiedEbayImageCopy,
  composeAuthorizedEbayListingImageSet,
  EBAY_LISTING_IMAGE_SLOTS,
  EBAY_SQUARE_PRESENTATION_QA_VERSION,
  getListingImageFactoryConfiguration,
  requestSafeOpenAiBackgroundPlate,
  validateListingImageFactoryInput,
} from "./ebay-listing-image-factory.ts"

function input() {
  return {
    identityFingerprint: `sha256:${"a".repeat(64)}`,
    facts: {
      manufacturerBrand: "Lysol",
      normalizedProductName: "Lysol disinfecting wipes lemon",
      packCount: 3,
      unitCount: 15,
      size: "15 count",
      color: "yellow",
      scent: "lemon",
      variant: "disinfecting wipes",
      condition: "new",
    },
    briefs: EBAY_LISTING_IMAGE_SLOTS.map((slot) => ({
      slot,
      objective: `Verified objective for ${slot}`,
      overlayText: null,
      preserveOriginalPackage: true,
      sourcePolicy: "AUTHORIZED_PRODUCT_IMAGE_ONLY",
    })),
  }
}

function marketReadyInput(value = input()) {
  const observedAt = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString()
  const freshUntil = new Date(Date.now() + 29 * 24 * 60 * 60 * 1_000).toISOString()
  return {
    ...value,
    marketVisualBrief: {
      visualMarketBriefVersion: "VISUAL_MARKET_BRIEF_V2_2026_07_21",
      observedAt,
      freshUntil,
      confidence: "MEDIUM",
      sampleSize: 12,
      dominantBackgroundType: "WHITE_OR_NEUTRAL",
      recommendedFrameCoverage: "HIGH",
      recommendedComplexity: "LOW",
      packVisibilityPattern: "CLEAR",
      textOverlayPattern: "LOW",
      compositionPattern: "CENTERED",
      recommendedCopySpace: "RIGHT",
      contrastPattern: "HIGH",
      brightnessPattern: "LIGHT",
      palettePattern: "NEUTRAL",
      subjectGeometryPattern: "COMPACT",
      primaryCohort: "EXACT_PRODUCT",
      recencyWeightingApplied: true,
      supportingSignals: {
        whiteOrNeutralPercent: 75,
        highCoveragePercent: 66.67,
        lowComplexityPercent: 83.33,
        lowOrNoTextOverlayPercent: 91.67,
        clearMultipackPercent: 58.33,
        usableCopySpacePercent: 75,
        highContrastPercent: 66.67,
        lightBrightnessPercent: 75,
        neutralPalettePercent: 83.33,
        recentObservationPercent: 66.67,
      },
    },
  }
}

async function authorizedFixture() {
  return sharp({
    create: { width: 1600, height: 1600, channels: 3, background: "#ffffff" },
  }).composite([{
    input: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1400">' +
      '<rect x="20" y="20" width="1160" height="1360" rx="60" fill="#f6d146"/>' +
      '<text x="600" y="620" text-anchor="middle" font-size="144" font-family="Arial">SOURCE</text>' +
      '<text x="600" y="820" text-anchor="middle" font-size="84" font-family="Arial">3 × 15</text>' +
      '</svg>',
    ),
    left: 200,
    top: 100,
  }]).jpeg().toBuffer()
}

async function saturatedSceneBoardFixture() {
  return sharp(Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024">' +
    '<rect width="512" height="512" fill="#204080"/>' +
    '<rect x="512" width="512" height="512" fill="#207040"/>' +
    '<rect x="1024" width="512" height="512" fill="#804020"/>' +
    '<rect y="512" width="512" height="512" fill="#603080"/>' +
    '<rect x="512" y="512" width="512" height="512" fill="#207080"/>' +
    '<rect x="1024" y="512" width="512" height="512" fill="#805020"/>' +
    '</svg>',
  )).jpeg().toBuffer()
}

async function whiteEnamelwareFixture() {
  return sharp({
    create: { width: 1600, height: 1600, channels: 3, background: "#ffffff" },
  }).composite([{
    input: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600">' +
      '<path d="M300 250h1000c-36 690-215 1000-500 1000S336 940 300 250z" fill="#f4f4f4" stroke="#707070" stroke-width="14"/>' +
      '<ellipse cx="800" cy="250" rx="500" ry="108" fill="#fafafa" stroke="#555" stroke-width="14"/>' +
      '<path d="M300 360H120M1300 360h180" stroke="#606060" stroke-width="34" stroke-linecap="round"/>' +
      '<path d="M635 1250h330l64 220H571z" fill="#f6f6f6" stroke="#707070" stroke-width="14"/>' +
      '</svg>',
    ),
  }]).jpeg({ quality: 95 }).toBuffer()
}

test("composes one main and six secondary JPEG assets from one authorized source", async () => {
  const source = await authorizedFixture()
  const assets = await composeAuthorizedEbayListingImageSet(source, input())
  assert.deepEqual(assets.map((asset) => asset.slot), EBAY_LISTING_IMAGE_SLOTS)
  assert.equal(new Set(assets.map((asset) => asset.outputSha256)).size, 7)
  assert.equal(new Set(assets.map((asset) => asset.sourceSha256)).size, 1)
  for (const asset of assets) {
    const metadata = await sharp(asset.output).metadata()
    assert.equal(metadata.format, "jpeg")
    assert.equal(metadata.width, 1600)
    assert.equal(metadata.height, 1600)
    assert.equal(asset.transformation.competitorImageUsed, false)
    assert.equal(asset.transformation.originalPackagePixelsPreserved, true)
    assert.equal(asset.transformation.sourceVisualPolicy,
      "EXACT_AUTHORIZED_PIXELS_ONLY")
    assert.equal(asset.transformation.authorizedSourceViewReused, true)
    assert.equal(asset.qa.sourceViewCapabilityPassed, true)
    assert.equal(asset.qa.marketSignalsLimitedToScene, true)
    assert.equal(asset.qa.hiddenProductGeometryGenerated, false)
    assert.equal(asset.qa.textPolicyPassed, true)
    assert.equal(asset.qa.textLineCount, 0)
    assert.equal(asset.qa.humanApprovalRequired, true)
    assert.equal(asset.transformation.squarePresentationVersion,
      EBAY_SQUARE_PRESENTATION_QA_VERSION)
    assert.equal(asset.transformation.artificialFrameAdded, false)
    assert.equal(asset.transformation.outputEncodingQuality, 94)
    assert.equal(asset.qa.squarePresentationQaVersion,
      EBAY_SQUARE_PRESENTATION_QA_VERSION)
    assert.equal(asset.qa.squareFormatPassed, true)
    assert.equal(asset.qa.artificialInsetFrameFree, true)
    assert.equal(asset.qa.sourceQualityPassed, true)
    assert.equal(asset.qa.safeCanvasPlacementPassed, true)
    assert.equal(asset.qa.mobileFocalPointPassed, true)
    if (asset.slot === "MAIN_WHITE_BACKGROUND") {
      assert.ok(asset.qa.productCoverageRatio >= .75 &&
        asset.qa.productCoverageRatio <= .85)
      assert.equal(asset.transformation.foregroundMatteVersion, undefined)
      assert.equal(asset.qa.foregroundMatteValidated, undefined)
    } else {
      assert.ok(asset.qa.productCoverageRatio >= .68 &&
        asset.qa.productCoverageRatio <= .82)
      assert.equal(asset.transformation.authorizedSourceTreatment,
        "LOCAL_AUTHORIZED_FOREGROUND")
      assert.notEqual(asset.transformation.foregroundMatteMethod,
        "FULL_AUTHORIZED_FRAME")
      assert.equal(asset.transformation.foregroundMatteVersion,
        EBAY_AUTHORIZED_FOREGROUND_MATTE_VERSION)
      assert.equal(asset.qa.foregroundMatteValidated, true)
      assert.equal(asset.qa.opaqueSourceFrameRemoved, true)
      assert.equal(asset.qa.textSafeAreaVerified, undefined)
    }
  }
})

test("main image has pure-white corners and no promotional overlay", async () => {
  const assets = await composeAuthorizedEbayListingImageSet(
    await authorizedFixture(),
    input(),
  )
  const main = assets[0]
  const pixel = await sharp(main.output).extract({ left: 0, top: 0, width: 1, height: 1 })
    .raw().toBuffer()
  assert.deepEqual([...pixel.slice(0, 3)], [255, 255, 255])
  assert.equal(main.slot, "MAIN_WHITE_BACKGROUND")
  assert.equal(main.qa.mainBackground, "PURE_WHITE")
})

test("Calypso copy collapses a 1-by-1 offer and uses a bounded product name", () => {
  const facts = {
    manufacturerBrand: "Reston Lloyd",
    normalizedProductName:
      "Calypso Basics by Reston Lloyd Powder Coated Enameled Colander, 1.5 Quart, White",
    packCount: 1,
    unitCount: 1,
    size: "1.5 Quart",
    color: "White",
    scent: null,
    variant: null,
    condition: "New",
  }
  const quantity = buildVerifiedEbayImageCopy("PACK_AND_COUNT", facts)
  assert.deepEqual(quantity.lines, ["Single Item"])
  assert.doesNotMatch(quantity.lines.join(" "), /1 Pack|1 Count Each/i)
  const context = buildVerifiedEbayImageCopy("USE_CONTEXT", facts)
  assert.deepEqual(context.lines, [
    "Reston Lloyd",
    "Calypso Basics Powder Coated",
    "Enameled Colander",
    "1.5 Quart • White",
  ])
  assert.ok(context.lines.every((line) => line.length <= 29))
})

test("verified image copy uses the packaged font in Vercel workers", () => {
  const factory = readFileSync(
    "lib/ebay/ebay-listing-image-factory.ts",
    "utf8",
  )
  const nextConfig = readFileSync("next.config.mjs", "utf8")
  const font = readFileSync("public/fonts/DejaVuSans.ttf")
  assert.deepEqual([...font.subarray(0, 4)], [0, 1, 0, 0])
  assert.equal(createHash("sha256").update(font).digest("hex"),
    "b4c632e3cdf9acc7f28758fb5a323c8524d7fc6660d46904d9b6cbe2809c419c")
  assert.match(factory,
    /LISTING_FONT_FILE = `\$\{process\.cwd\(\)\}\/public\/fonts\/DejaVuSans\.ttf`/)
  assert.match(factory, /fontfile: LISTING_FONT_FILE/)
  assert.match(factory, /assertPackagedListingFont\(\)/)
  assert.match(factory,
    /b4c632e3cdf9acc7f28758fb5a323c8524d7fc6660d46904d9b6cbe2809c419c/)
  assert.match(factory, /wrap: "none"/)
  assert.match(factory,
    /glyphMetadata\.width > input\.width - safeMargin \* 2/)
  assert.match(factory,
    /glyphMetadata\.height > input\.height - safeMargin \* 2/)
  assert.match(nextConfig,
    /"\/api\/cron\/ebay-same-day-pilot": \["\.\/public\/fonts\/DejaVuSans\.ttf"\]/)
  assert.match(nextConfig,
    /"\/api\/admin\/ebay\/images": \["\.\/public\/fonts\/DejaVuSans\.ttf"\]/)
  assert.match(nextConfig,
    /"\/api\/admin\/ebay\/same-day-pilot": \["\.\/public\/fonts\/DejaVuSans\.ttf"\]/)
})

test("rejects duplicated or missing image slots", () => {
  const value = input()
  value.briefs[5] = { ...value.briefs[5], slot: "PACK_AND_COUNT" }
  assert.throws(
    () => validateListingImageFactoryInput(value),
    /EBAY_IMAGE_SET_SLOTS_DUPLICATED/,
  )
})

test("one authorized source cannot stand in for six commercial product views", () => {
  assert.throws(() => assertEbayImageEvidenceSufficiency({
    facts: input().facts,
    briefs: input().briefs,
    sourceSha256s: ["b".repeat(64)],
  }), /NEEDS_ADDITIONAL_SOURCE_IMAGE:COMMERCIAL_DIVERSITY/)
})

test("a slot requiring an unavailable product view requests that exact source image", () => {
  const value = input()
  value.briefs = value.briefs.map((brief) => brief.slot === "USE_CONTEXT"
    ? { ...brief, objective: "Show a top-down interior view with hands" }
    : brief)
  assert.throws(
    () => assertEbayImageEvidenceSufficiency({
      facts: value.facts,
      briefs: value.briefs,
      sourceSha256s: ["b".repeat(64), "c".repeat(64)],
    }),
    /NEEDS_ADDITIONAL_SOURCE_IMAGE:USE_CONTEXT/,
  )
  assert.doesNotThrow(() => assertEbayImageEvidenceSufficiency({
    facts: value.facts,
    briefs: value.briefs,
    sourceSha256s: ["b".repeat(64), "c".repeat(64)],
    authorizedViewSlots: ["USE_CONTEXT"],
  }))
})

test("rejects unapproved source policy and package-redraw briefs", () => {
  const unsafe = input()
  unsafe.briefs[0] = {
    ...unsafe.briefs[0],
    preserveOriginalPackage: false,
    sourcePolicy: "COMPETITOR_IMAGE",
  }
  assert.throws(() => validateListingImageFactoryInput(unsafe))
})

test("sanitized configuration never returns an OpenAI key", () => {
  const configuration = getListingImageFactoryConfiguration({
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co",
    OPENAI_API_KEY: "secret-that-must-not-be-returned",
    OPENAI_IMAGE_FACTORY_ENABLED: "false",
    OPENAI_IMAGE_MODEL: "gpt-image-1",
  })
  assert.equal(configuration.deterministicComposition, "READY")
  assert.equal(configuration.aiGeneration, "DISABLED")
  assert.equal(configuration.openAiKey, "PRESENT")
  assert.equal(JSON.stringify(configuration).includes("secret-that"), false)
  assert.equal(configuration.ebayWrites, 0)
})

test("commercial scene-board plan uses verified dossier facts but sends no URL or pixels", () => {
  const plan = buildSafeOpenAiBackgroundPlatePlan(input(), "gpt-image-2")
  const normalized = plan.prompt.toLowerCase()
  assert.equal(normalized.includes("lysol"), true)
  assert.equal(normalized.includes("disinfecting wipes"), true)
  assert.equal(normalized.includes("lemon"), true)
  assert.equal(normalized.includes("yellow"), true)
  assert.equal(normalized.includes("http"), false)
  assert.equal(normalized.includes("base64"), false)
  assert.equal(plan.sendsProductBytes, false)
  assert.equal(plan.sendsProductUrl, false)
  assert.equal(plan.sendsCompetitorData, false)
  assert.equal(plan.sendsVerifiedProductFacts, true)
  assert.equal(plan.sendsAggregatedMarketPatterns, false)
  assert.equal(plan.imageCount, 1)
  assert.equal(plan.size, "1536x1024")
  assert.equal(plan.quality, "low")
  assert.match(plan.requestHash, /^[0-9a-f]{64}$/)
})

test("sanitized aggregate seller patterns influence the prompt without seller content", () => {
  const value = {
    ...input(),
    marketVisualBrief: {
      confidence: "MEDIUM",
      sampleSize: 12,
      dominantBackgroundType: "WHITE_OR_NEUTRAL",
      recommendedFrameCoverage: "HIGH",
      recommendedComplexity: "LOW",
      packVisibilityPattern: "CLEAR",
      textOverlayPattern: "LOW",
      compositionPattern: "CENTERED",
      recommendedCopySpace: "RIGHT",
      contrastPattern: "HIGH",
      brightnessPattern: "LIGHT",
      palettePattern: "NEUTRAL",
      subjectGeometryPattern: "COMPACT",
      primaryCohort: "EXACT_PRODUCT",
      recencyWeightingApplied: true,
      supportingSignals: {
        whiteOrNeutralPercent: 75,
        highCoveragePercent: 66.67,
        lowComplexityPercent: 83.33,
        lowOrNoTextOverlayPercent: 91.67,
        clearMultipackPercent: 58.33,
        usableCopySpacePercent: 75,
        highContrastPercent: 66.67,
        lightBrightnessPercent: 75,
        neutralPalettePercent: 83.33,
        recentObservationPercent: 66.67,
      },
    },
  }
  const plan = buildSafeOpenAiBackgroundPlatePlan(value, "gpt-image-2")
  assert.equal(plan.sendsAggregatedMarketPatterns, true)
  assert.match(plan.prompt, /WHITE_OR_NEUTRAL/)
  assert.match(plan.prompt, /"sampleSize":12/)
  assert.match(plan.prompt, /MEDIUM confidence from 12 comparable sold observations/)
  assert.match(plan.prompt, /predominantly white or light-neutral surfaces/)
  assert.match(plan.prompt, /reserved product zone the dominant area/)
  assert.match(plan.prompt, /props sparse and visual complexity low/)
  assert.match(plan.prompt,
    /exact authorized offer pack will remain fully visible/)
  assert.match(plan.prompt, /calm, high-contrast blank copy zones/)
  assert.match(plan.prompt, /balanced centered hierarchy/)
  assert.match(plan.prompt, /Panel 6 \/ SECONDARY_6/)
  assert.match(plan.prompt, /no copy zone and no text/)
  assert.match(plan.prompt, /observed brightness LIGHT/)
  assert.match(plan.prompt, /primary cohort EXACT_PRODUCT; recency weighting applied/)
  assert.match(plan.prompt, /market evidence may influence only the empty background/i)
  assert.match(plan.prompt, /Never reconstruct, reinterpret, rotate, redraw or modify the product/i)
  assert.match(plan.prompt, /^GOAL[\s\S]*PRODUCT TRUTH[\s\S]*SANITIZED MARKET EVIDENCE[\s\S]*PANEL CONTRACTS[\s\S]*INVARIANTS[\s\S]*ACCEPTANCE[\s\S]*No forbidden object, included-looking prop or text may appear\.$/)
  assert.doesNotMatch(plan.prompt, /sellerId|sellerName|itemId|https?:/i)
})

test("visual compiler selects six distinct evidence-backed commercial objectives", () => {
  const contracts = buildEbayVisualPanelContracts(input().facts, null)
  assert.equal(contracts.length, 6)
  assert.ok(contracts.every((contract) =>
    contract.commercialObjective && contract.objectionReduced &&
    contract.productZone && contract.copyZone))
  assert.equal(new Set(contracts.map((contract) =>
    contract.visualStrategyPosition.salesObjective)).size, 6)
  assert.ok(contracts.every((contract) =>
    contract.visualStrategyPosition.feasibilityStatus === "FEASIBLE" &&
    contract.visualStrategyPosition.contractHash.length === 64))
})

test("visual compiler balances six objectives across authorized catalog views", () => {
  const sourceIds = ["source-main", "source-side", "source-detail"]
  const value = validateListingImageFactoryInput({
    ...input(),
    authorizedSourceImageIds: sourceIds,
    authorizedSourceCapabilities: sourceIds.map((id, index) => ({
      id,
      nativeWidth: 1600,
      nativeHeight: 1600,
      effectiveWidth: 1600,
      effectiveHeight: 1600,
      qualityTier: "NATIVE_HIGH_RES",
      viewClassification: index === 0
        ? "PRIMARY"
        : index === 1
          ? "ALTERNATE_AUTHORIZED_ANGLE"
          : "PACKAGE_CONTENTS",
      enhancedDerivative: false,
    })),
  })
  const strategy = buildSellerOsEbayVisualStrategyV2(value)
  const chosen = strategy.map((position) =>
    position.authorizedSourceImageIds[0])
  assert.equal(strategy.every((position) =>
    position.authorizedSourceImageIds.length === 1), true)
  assert.equal(new Set(chosen).size, 3)
  for (const sourceId of sourceIds) {
    assert.ok(chosen.filter((chosenId) => chosenId === sourceId).length <= 3)
  }
})

test("a multi-pack strategy requires an authorized view of the exact package contents", () => {
  const sourceIds = ["source-main", "source-detail"]
  const value = validateListingImageFactoryInput({
    ...input(),
    authorizedSourceImageIds: sourceIds,
    authorizedSourceCapabilities: sourceIds.map((id, index) => ({
      id,
      nativeWidth: 1600,
      nativeHeight: 1600,
      effectiveWidth: 1600,
      effectiveHeight: 1600,
      qualityTier: "NATIVE_HIGH_RES",
      viewClassification: index === 0 ? "PRIMARY" : "DETAIL",
      enhancedDerivative: false,
    })),
  })
  assert.throws(
    () => buildSellerOsEbayVisualStrategyV2(value),
    /NEEDS_ADDITIONAL_SOURCE_IMAGE:CONFIRMED_PACKAGE_CONTENTS/,
  )
})

test("strong exact or family evidence may prioritize commercial roles while category evidence stays art-direction only", () => {
  const exactValue = validateListingImageFactoryInput(marketReadyInput())
  exactValue.marketVisualBrief.dominantPresentationType =
    "LIFESTYLE_LIKELY"
  const exactBrief = buildSellerOsEbaySetLevelCreativeBrief(exactValue)
  const exactStrategy = buildSellerOsEbayVisualStrategyV2(exactValue)
  assert.equal(exactBrief.evidencePolicy.tier, "A_EXACT_PRODUCT")
  assert.equal(exactBrief.evidencePolicy.evidenceCount, 12)
  assert.equal(exactBrief.commercialRolePrioritizationAllowed, true)
  assert.ok(exactStrategy.some((entry) =>
    entry.salesObjective === "ASPIRATIONAL_LIFESTYLE"))
  assert.ok(exactStrategy.every((entry) =>
    entry.marketToVisualStrategyTrace.evidenceTier === "A_EXACT_PRODUCT" &&
    entry.marketToVisualStrategyTrace.productFactsSource ===
      "PRODUCT_DOSSIER_AND_AUTHORIZED_SOURCES_ONLY" &&
    entry.marketToVisualStrategyTrace.competitorPixelsUsed === false &&
    entry.marketToVisualStrategyTrace.competitorClaimsUsedAsProductFacts ===
      false))
  assert.ok(exactStrategy.every((entry) =>
    entry.marketToVisualStrategyTrace.prohibitedMarketEvidenceUses.includes(
      "COMPATIBILITY",
    )))

  const categoryValue = validateListingImageFactoryInput({
    ...marketReadyInput(),
    marketVisualBrief: {
      ...marketReadyInput().marketVisualBrief,
      primaryCohort: "CATEGORY_FALLBACK",
      marketEvidenceTier: "C_CATEGORY",
      exactProductEvidenceCount: 0,
      productFamilyEvidenceCount: 0,
      categoryEvidenceCount: 12,
      dominantPresentationType: "LIFESTYLE_LIKELY",
    },
  })
  const categoryBrief = buildSellerOsEbaySetLevelCreativeBrief(categoryValue)
  const categoryStrategy = buildSellerOsEbayVisualStrategyV2(categoryValue)
  assert.equal(categoryBrief.evidencePolicy.tier, "C_CATEGORY")
  assert.equal(categoryBrief.evidencePolicy.influenceScope,
    "GENERAL_CATEGORY_ART_DIRECTION")
  assert.equal(categoryBrief.commercialRolePrioritizationAllowed, false)
  assert.equal(categoryStrategy.some((entry) =>
    entry.salesObjective === "ASPIRATIONAL_LIFESTYLE"), false)
  assert.ok(categoryStrategy.every((entry) =>
    entry.marketToVisualStrategyTrace.influenceScope ===
      "GENERAL_CATEGORY_ART_DIRECTION"))
})

test("visual compiler keeps a verified 1 x 1 replacement offer commercially complete", () => {
  const value = input()
  value.facts = {
    manufacturerBrand: "Moen",
    normalizedProductName:
      "One Handle Posi-Temp Faucet Cartridge Replacement",
    packCount: 1,
    unitCount: 1,
    size: null,
    color: null,
    scent: null,
    variant: null,
    condition: "New",
    dimensions: null,
    capacity: null,
    weight: null,
    material: null,
    verifiedUseCases: [],
  }
  value.authorizedSourceImageIds = ["catalog-primary", "catalog-hires", "catalog-third"]
  value.authorizedSourceCapabilities = [{
    id: "catalog-primary",
    nativeWidth: 580,
    nativeHeight: 580,
    effectiveWidth: 1160,
    effectiveHeight: 1160,
    qualityTier: "CONTROLLED_ENHANCEMENT",
    viewClassification: "PRIMARY",
    enhancedDerivative: true,
  }, {
    id: "catalog-hires",
    nativeWidth: 4284,
    nativeHeight: 5712,
    effectiveWidth: 4284,
    effectiveHeight: 5712,
    qualityTier: "NATIVE_HIGH_RES",
    viewClassification: "UNKNOWN",
    enhancedDerivative: false,
  }, {
    id: "catalog-third",
    nativeWidth: 580,
    nativeHeight: 580,
    effectiveWidth: 1160,
    effectiveHeight: 1160,
    qualityTier: "CONTROLLED_ENHANCEMENT",
    viewClassification: "UNKNOWN",
    enhancedDerivative: true,
  }]
  const validated = validateListingImageFactoryInput(value)
  const strategy = buildSellerOsEbayVisualStrategyV2(validated)
  assert.equal(strategy.length, 6)
  assert.equal(new Set(strategy.map((entry) => entry.salesObjective)).size, 6)
  const offerScope = strategy.find((entry) =>
    entry.salesObjective === "PACKAGE_CONTENTS")
  assert.ok(offerScope)
  assert.deepEqual(offerScope.evidenceReferences,
    ["FACT:packCount", "FACT:unitCount", "AUTHORIZED_SOURCE:OFFER"])
  assert.equal(offerScope.authorizedSourceImageIds.length, 1)
  const misclassifiedDetail = strategy.find((entry) =>
    entry.salesObjective === "QUALITY_DETAIL")
  assert.equal(Boolean(misclassifiedDetail), false)
  const condition = strategy.find((entry) =>
    entry.salesObjective === "CONDITION_CLARIFICATION")
  assert.ok(condition)
  assert.deepEqual(condition.authorizedSourceImageIds, ["catalog-primary"])
  assert.deepEqual(condition.evidenceReferences,
    ["FACT:condition", "AUTHORIZED_SOURCE:VISIBLE_CONDITION"])
  assert.match(condition.visualDirection, /do not invent, hide or repair/)
  assert.doesNotThrow(() => assertEbayImageEvidenceSufficiency({
    facts: validated.facts,
    sourceSha256s: ["a".repeat(64), "b".repeat(64), "c".repeat(64)],
    briefs: validated.briefs,
  }))
})

test("OpenAI request generates exactly one low-quality commercial scene board without an input image", async () => {
  const generated = await sharp({
    create: { width: 1536, height: 1024, channels: 3, background: "#dce5ef" },
  }).jpeg().toBuffer()
  let capturedUrl = ""
  let capturedInit
  const plan = buildSafeOpenAiBackgroundPlatePlan(input(), "gpt-image-2")
  const plate = await requestSafeOpenAiBackgroundPlate({
    plan,
    apiKey: "sk-test_only_123456789",
    fetchImpl: async (url, init) => {
      capturedUrl = String(url)
      capturedInit = init
      return new Response(JSON.stringify({
        data: [{ b64_json: generated.toString("base64") }],
        usage: { input_tokens: 12, output_tokens: 34, total_tokens: 46 },
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_safe_fixture",
        },
      })
    },
  })
  assert.equal(capturedUrl, "https://api.openai.com/v1/images/generations")
  const body = JSON.parse(String(capturedInit.body))
  assert.deepEqual(body, {
    model: "gpt-image-2",
    prompt: plan.prompt,
    n: 1,
    size: "1536x1024",
    quality: "low",
    output_format: "jpeg",
    output_compression: 85,
    background: "opaque",
    moderation: "auto",
  })
  const serialized = JSON.stringify(body).toLowerCase()
  assert.equal(serialized.includes("lysol"), true)
  assert.equal(serialized.includes("sourceurl"), false)
  assert.equal(serialized.includes("input_image"), false)
  assert.equal(serialized.includes("b64_json"), false)
  assert.equal(plate.providerRequestId, "req_safe_fixture")
  assert.deepEqual(plate.usage, {
    inputTokens: 12,
    outputTokens: 34,
    totalTokens: 46,
  })
  assert.match(plate.outputSha256, /^[0-9a-f]{64}$/)
  assert.equal((await sharp(plate.output).metadata()).width, 1536)
  assert.equal((await sharp(plate.output).metadata()).height, 1024)
})

test("publish-bound OpenAI request uses high quality and a quality-bound hash", async () => {
  const generated = await sharp({
    create: { width: 1536, height: 1024, channels: 3, background: "#dce5ef" },
  }).jpeg().toBuffer()
  const lowPlan = buildSafeOpenAiBackgroundPlatePlan(input(), "gpt-image-2")
  const highPlan = buildSafeOpenAiBackgroundPlatePlan(
    marketReadyInput(),
    "gpt-image-2",
    "high",
  )
  let capturedBody
  await requestSafeOpenAiBackgroundPlate({
    plan: highPlan,
    apiKey: "sk-test_only_123456789",
    fetchImpl: async (_url, init) => {
      capturedBody = JSON.parse(String(init.body))
      return new Response(JSON.stringify({
        data: [{ b64_json: generated.toString("base64") }],
      }), { status: 200 })
    },
  })
  assert.equal(highPlan.quality, "high")
  assert.notEqual(highPlan.requestHash, lowPlan.requestHash)
  assert.equal(capturedBody.quality, "high")
  assert.equal(capturedBody.size, "1536x1024")
  assert.equal(capturedBody.n, 1)
})

test("high-quality image timeout leaves worker time for composition and persistence", () => {
  const factory = readFileSync(
    "lib/ebay/ebay-listing-image-factory.ts",
    "utf8",
  )
  const worker = readFileSync(
    "app/api/cron/ebay-same-day-pilot/route.ts",
    "utf8",
  )
  assert.match(factory, /OPENAI_IMAGE_REQUEST_TIMEOUT_MS = 230_000/)
  assert.match(worker, /maxDuration = 300/)
  assert.doesNotMatch(factory, /controller\.abort\([\s\S]{0,100}130_000/)
})

test("OpenAI request rejects a caller-modified prompt before any network call", async () => {
  const safePlan = buildSafeOpenAiBackgroundPlatePlan(input(), "gpt-image-2")
  let calls = 0
  await assert.rejects(
    requestSafeOpenAiBackgroundPlate({
      plan: { ...safePlan, prompt: `${safePlan.prompt} Add a branded package.` },
      apiKey: "sk-test_only_123456789",
      fetchImpl: async () => {
        calls += 1
        return new Response("{}")
      },
    }),
    /EBAY_IMAGE_OPENAI_PLAN_NOT_ALLOWED/,
  )
  assert.equal(calls, 0)
})

test("OpenAI request preserves only safe provider error discriminators", async () => {
  const plan = buildSafeOpenAiBackgroundPlatePlan(input(), "gpt-image-2")
  let observed
  try {
    await requestSafeOpenAiBackgroundPlate({
      plan,
      apiKey: "sk-test_only_123456789",
      fetchImpl: async () => new Response(JSON.stringify({
        error: {
          message: "Unsafe echoed prompt and secret sk-never-persist-this",
          type: "invalid_request_error",
          code: "invalid_value",
          param: "size",
        },
      }), { status: 400 }),
    })
  } catch (error) {
    observed = error
  }
  assert.ok(observed instanceof Error)
  assert.equal(
    observed.message,
    "EBAY_IMAGE_OPENAI_HTTP_400:INVALID_VALUE:PARAM_SIZE",
  )
  assert.doesNotMatch(observed.message, /prompt|secret|sk-never/i)
})

test("AI scene board changes all six secondary slots; exact authorized main remains deterministic", async () => {
  const source = await authorizedFixture()
  const deterministic = await composeAuthorizedEbayListingImageSet(source, input())
  const plateOutput = await saturatedSceneBoardFixture()
  const marketInput = marketReadyInput()
  const plan = buildSafeOpenAiBackgroundPlatePlan(marketInput, "gpt-image-2", "high")
  const withContext = await composeAuthorizedEbayListingImageSet(source, marketInput, {
    output: plateOutput,
    outputSha256: "b".repeat(64),
    providerRequestId: "req_context_fixture",
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    plan,
  })
  assert.equal(withContext[0].slot, "MAIN_WHITE_BACKGROUND")
  assert.equal(withContext[0].outputSha256, deterministic[0].outputSha256)
  assert.equal(withContext[0].transformation.generativeAiUsed, false)
  const generatedSlots = withContext.filter((asset) =>
    asset.transformation.generativeAiUsed
  )
  assert.equal(generatedSlots.length, 6)
  assert.deepEqual(generatedSlots.map((asset) => asset.slot),
    EBAY_LISTING_IMAGE_SLOTS.slice(1))
  for (const asset of generatedSlots) {
    assert.equal(asset.qa.automaticStatus, "PASSED")
    assert.equal(asset.qa.promptCompliancePassed, true)
    assert.equal(asset.qa.marketSignalCompliancePassed, true)
    assert.equal(asset.qa.productFidelityPassed, true)
    assert.equal(asset.qa.commercialQualityPassed, true)
    assert.equal(asset.qa.humanApprovalRequired, true)
    assert.equal(asset.transformation.competitorImageUsed, false)
    assert.equal(asset.transformation.sourceVisualPolicy,
      "EXACT_AUTHORIZED_PIXELS_ONLY")
    assert.equal(asset.transformation.authorizedSourceViewReused, true)
    assert.equal(asset.qa.sourceViewCapabilityPassed, true)
    assert.equal(asset.qa.marketSignalsLimitedToScene, true)
    assert.equal(asset.qa.hiddenProductGeometryGenerated, false)
    assert.equal(asset.transformation.backgroundPlateRequestHash, plan.requestHash)
    assert.equal(asset.transformation.backgroundPlateQuality, "high")
    assert.equal(asset.qa.deterministicBackgroundSelection, true)
    assert.equal(asset.qa.foregroundMatteValidated, true)
    assert.equal(asset.qa.opaqueSourceFrameRemoved, true)
    assert.equal(asset.qa.textSafeAreaVerified, undefined)
    assert.equal(asset.transformation.authorizedSourceTreatment,
      "LOCAL_AUTHORIZED_FOREGROUND")
    assert.equal(asset.transformation.foregroundMatteVersion,
      EBAY_AUTHORIZED_FOREGROUND_MATTE_VERSION)
    assert.match(asset.transformation.foregroundMatteSha256, /^[0-9a-f]{64}$/)
    assert.equal(asset.transformation.foregroundTransparentBorderRatio, 1)
    assert.equal(asset.transformation.foregroundProtectedPixelRetentionRatio, 1)
    assert.equal(asset.transformation.foregroundOpaqueCornerRatio, 0)
    assert.ok(asset.transformation.backgroundCompatibilityScore >= 0)
    assert.ok(asset.transformation.backgroundCompatibilityScore <= 100)
    assert.ok(asset.transformation.candidateSceneBoardPanels.includes(
      asset.transformation.selectedSceneBoardPanel,
    ))
  }
  const packageContents = generatedSlots.find((asset) =>
    asset.slot === "PACKAGE_CONTENTS")
  assert.deepEqual(packageContents.transformation.candidateSceneBoardPanels, [5])
  assert.ok(generatedSlots.filter((asset) => asset.slot !== "PACKAGE_CONTENTS")
    .every((asset) => asset.transformation.candidateSceneBoardPanels.length === 1))
})

test("RGBA foreground leaves the generated plate visible instead of pasting a white source rectangle", async () => {
  const source = await authorizedFixture()
  const marketInput = marketReadyInput()
  const plan = buildSafeOpenAiBackgroundPlatePlan(marketInput, "gpt-image-2", "high")
  const assets = await composeAuthorizedEbayListingImageSet(source, marketInput, {
    output: await saturatedSceneBoardFixture(),
    outputSha256: "d".repeat(64),
    providerRequestId: "req_rgba_fixture",
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    plan,
  })
  const pack = assets.find((asset) => asset.slot === "PACK_AND_COUNT")
  const outsideProduct = await sharp(pack.output)
    .extract({ left: 60, top: 320, width: 1, height: 1 }).raw().toBuffer()
  assert.ok(outsideProduct[0] < 60 && outsideProduct[2] > 100,
    `expected blue scene plate, received ${[...outsideProduct.slice(0, 3)]}`)
  const product = await sharp(pack.output)
    .extract({ left: 500, top: 400, width: 1, height: 1 }).raw().toBuffer()
  assert.ok(product[0] > 220 && product[1] > 170 && product[2] < 120,
    "authorized yellow product pixels must remain visible")

  const context = assets.find((asset) => asset.slot === "USE_CONTEXT")
  const outsideContextProduct = await sharp(context.output)
    .extract({ left: 320, top: 150, width: 1, height: 1 }).raw().toBuffer()
  assert.ok(outsideContextProduct[0] < 130 && outsideContextProduct[2] > 90,
    "USE_CONTEXT must not add the former opaque white product panel")
})

test("white Calypso-style enamel stays intact while its opaque source frame is removed", async () => {
  const value = input()
  value.facts = {
    manufacturerBrand: "Reston Lloyd",
    normalizedProductName:
      "Calypso Basics by Reston Lloyd Powder Coated Enameled Colander, 1.5 Quart, White",
    packCount: 1,
    unitCount: 1,
    size: "1.5 Quart",
    color: "White",
    scent: null,
    variant: null,
    condition: "New",
  }
  const marketValue = marketReadyInput(value)
  const plan = buildSafeOpenAiBackgroundPlatePlan(marketValue, "gpt-image-2", "high")
  const assets = await composeAuthorizedEbayListingImageSet(
    await whiteEnamelwareFixture(),
    marketValue,
    {
      output: await saturatedSceneBoardFixture(),
      outputSha256: "e".repeat(64),
      providerRequestId: "req_white_enamel_fixture",
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      plan,
    },
  )
  const main = assets[0]
  assert.equal(main.transformation.authorizedSourceTreatment,
    "PRESERVED_FRAMED_SOURCE")
  assert.ok(main.qa.manualChecksRequired.includes(
    "AUTHORIZED_SOURCE_FRAME_PRESERVED_WITHOUT_BACKGROUND_REMOVAL"))
  const pack = assets[1]
  assert.equal(pack.transformation.authorizedSourceTreatment,
    "LOCAL_AUTHORIZED_FOREGROUND")
  assert.equal(pack.transformation.foregroundProtectedPixelRetentionRatio, 1)
  assert.equal(pack.qa.manualChecksRequired.includes(
    "AUTHORIZED_SOURCE_FRAME_PRESERVED_WITHOUT_BACKGROUND_REMOVAL"), false)
  const platePixel = await sharp(pack.output)
    .extract({ left: 60, top: 320, width: 1, height: 1 }).raw().toBuffer()
  assert.ok(platePixel[0] < 60 && platePixel[2] > 100,
    "the generated plate must remain visible around the white product")
  const enamelPixel = await sharp(pack.output)
    .extract({ left: 540, top: 800, width: 1, height: 1 }).raw().toBuffer()
  assert.ok(enamelPixel[0] >= 235 && enamelPixel[1] >= 235 &&
    enamelPixel[2] >= 235, "white enamel must remain visible")
  assert.equal(pack.qa.textPolicyPassed, true)
  assert.equal(pack.qa.textLineCount, 0)
  assert.equal(pack.qa.textMinimumPixelSize, 0)
  assert.equal(pack.transformation.textRendererVersion, undefined)
})

test("dynamic six-objective strategy maps each secondary to one scene-board panel", async () => {
  const source = await authorizedFixture()
  const board = await sharp(Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024">' +
    '<rect width="512" height="512" fill="#d9e0e5"/>' +
    '<rect x="512" width="512" height="512" fill="#d8e3dc"/>' +
    '<rect x="1024" width="512" height="512" fill="#e4ddd4"/>' +
    '<rect y="512" width="512" height="512" fill="#cdd9df"/>' +
    '<rect x="512" y="512" width="512" height="512" fill="#ffffff"/>' +
    '<rect x="1024" y="512" width="512" height="512" fill="#666666"/>' +
    '</svg>',
  )).jpeg().toBuffer()
  const plan = buildSafeOpenAiBackgroundPlatePlan(input(), "gpt-image-2")
  const assets = await composeAuthorizedEbayListingImageSet(source, input(), {
    output: board,
    outputSha256: "c".repeat(64),
    providerRequestId: "req_selection_fixture",
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    plan,
  })
  const selected = assets.find((asset) => asset.slot === "SECONDARY_6")
  assert.equal(selected.transformation.selectedSceneBoardPanel, 6)
  assert.deepEqual(selected.transformation.candidateSceneBoardPanels, [6])
})

test("AI context is Preview/staging-only, separately flagged, and call-budget capped", () => {
  const ready = getListingImageFactoryConfiguration({
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "feature/centralize-ebay-mobile-center",
    NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co",
    OPENAI_API_KEY: "sk-test_only_123456789",
    OPENAI_IMAGE_FACTORY_ENABLED: "true",
    OPENAI_IMAGE_CONTEXT_PLATE_ENABLED: "true",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    OPENAI_IMAGE_DAILY_CALL_LIMIT: "999",
  })
  assert.equal(ready.aiGeneration, "READY")
  assert.equal(ready.dailyCallLimit, 20)
  assert.equal(ready.maxContextPlatesPerSet, 1)
  const production = getListingImageFactoryConfiguration({
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: "feature/centralize-ebay-mobile-center",
    NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co",
    OPENAI_API_KEY: "sk-test_only_123456789",
    OPENAI_IMAGE_FACTORY_ENABLED: "true",
    OPENAI_IMAGE_CONTEXT_PLATE_ENABLED: "true",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
  })
  assert.notEqual(production.aiGeneration, "READY")
  const otherPreviewBranch = getListingImageFactoryConfiguration({
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "main",
    NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co",
    OPENAI_API_KEY: "sk-test_only_123456789",
    OPENAI_IMAGE_FACTORY_ENABLED: "true",
    OPENAI_IMAGE_CONTEXT_PLATE_ENABLED: "true",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
  })
  assert.equal(otherPreviewBranch.aiGeneration, "BLOCKED_ENVIRONMENT")
})

test("route and migration enforce durable idempotency, budget, review, and zero raw images", () => {
  const route = readFileSync(
    new URL("../../app/api/admin/ebay/images/route.ts", import.meta.url),
    "utf8",
  )
  const migration = readFileSync(
    new URL(
      "../../supabase/migrations/20260718050000_control_safe_openai_image_context_runs.sql",
      import.meta.url,
    ),
    "utf8",
  )
  const atomicMigration = readFileSync(
    new URL(
      "../../supabase/migrations/20260718051000_atomic_safe_openai_image_sets.sql",
      import.meta.url,
    ),
    "utf8",
  )
  assert.match(route, /validateAdminApiRequest/)
  assert.match(route, /approvedGenerationForPackage/)
  assert.match(route, /validateImageRightsEvidence/)
  assert.match(route, /claim_ebay_openai_image_context_run/)
  assert.match(route, /complete_ebay_openai_image_context_run/)
  assert.match(route, /backgroundPlate\.output\.fill\(0\)/)
  assert.match(route, /providerRequestDispatched = true[\s\S]*?requestSafeOpenAiBackgroundPlate/)
  assert.match(route, /p_retryable: !providerRequestDispatched/)
  assert.match(route, /ebay_create_pending_listing_image_set/)
  assert.match(route, /EBAY_IMAGE_PARTIAL_SET_CLEANUP_REQUIRED/)
  assert.match(route, /status: "PENDING_HUMAN_REVIEW"/)
  assert.match(route, /ebayWrites: 0/)
  assert.match(migration, /EBAY_IMAGE_OPENAI_DAILY_BUDGET_EXHAUSTED/)
  assert.match(migration, /idempotency_key_hash/)
  assert.match(migration, /product_byte_count_sent = 0/)
  assert.match(migration, /product_url_count_sent = 0/)
  assert.match(migration, /competitor_image_count = 0/)
  assert.match(migration, /production_changed = false/)
  assert.match(migration, /enable row level security/)
  assert.doesNotMatch(migration, /\b(image_url|base64|raw_response|image_bytes)\s+(text|bytea|jsonb)/i)
  assert.match(atomicMigration, /enforce_ebay_openai_image_context_scope/)
  assert.match(atomicMigration, /decision\.supplier_sku = opportunity\.supplier_sku/)
  assert.match(atomicMigration, /ebay_create_pending_listing_image_set/)
  assert.match(atomicMigration, /jsonb_array_length\(p_assets\)/)
  assert.match(atomicMigration, /grant execute[\s\S]*to service_role/)
})
