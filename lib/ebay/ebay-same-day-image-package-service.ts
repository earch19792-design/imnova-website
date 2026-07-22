import { createHash } from "node:crypto"

import { z } from "zod"

// @ts-expect-error Node's native TypeScript test runner needs the extension.
import { prepareAuthorizedEbaySecondaryForeground, validateImageRightsEvidence } from "./ebay-image-optimization-service.ts"
// @ts-expect-error Node's native TypeScript test runner needs the extension.
import { productFactsHash } from "./ebay-product-facts-readiness.ts"
// @ts-expect-error Node's native TypeScript test runner needs the extension.
import { buildCurrentSameDayImageFactoryInput, type CurrentSameDayImageFactBinding } from "./ebay-same-day-image-factory-input.ts"
// @ts-expect-error Node's native TypeScript test runner needs the extension.
import { assertEbayImageEvidenceSufficiency, buildSafeOpenAiBackgroundPlatePlan, composeAuthorizedEbayListingImageSet, EBAY_AUTHORIZED_FOREGROUND_MATTE_VERSION, EBAY_IMAGE_COMPOSITOR_CONTRACT_VERSION, EBAY_IMAGE_TEXT_RENDERER_VERSION, EBAY_LISTING_IMAGE_SET_VERSION, EBAY_LISTING_IMAGE_SLOTS, EBAY_VISUAL_STRATEGY_VERSION, validateListingImageFactoryInput, type EbayListingImageComposition, type EbayListingImageFactoryInput, type EbayOpenAiBackgroundPlate, type EbayOpenAiBackgroundPlatePlan, type EbayOpenAiImageQuality } from "./ebay-listing-image-factory.ts"
// @ts-expect-error Node's native TypeScript test runner needs the extension.
import { ebayImageMarketBriefSchema, type EbayImageMarketBrief } from "./ebay-image-market-brief.ts"

export const SAME_DAY_IMAGE_PACKAGE_SERVICE_VERSION =
  "SAME_DAY_IMAGE_PACKAGE_SERVICE_V3_2026_07_21"
export const SAME_DAY_IMAGE_PACKAGE_MANIFEST_VERSION =
  "SAME_DAY_IMAGE_PACKAGE_METADATA_V3_2026_07_21"

const rawSha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
const prefixedSha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const imageSlotSchema = z.enum(EBAY_LISTING_IMAGE_SLOTS)
const rightsBasisSchema = z.enum(["supplier_authorized", "owned", "licensed"])

const persistenceAssetSchema = z.object({
  position: z.number().int().min(1).max(6),
  slot: imageSlotSchema,
  layoutId: z.string().trim().min(1).max(80).optional(),
  compositorContractVersion: z.literal(EBAY_IMAGE_COMPOSITOR_CONTRACT_VERSION).optional(),
  presentationMode: z.enum(["AUTHORIZED_MULTI_SOURCE", "SINGLE_SOURCE_INFORMATIONAL"]).optional(),
  authorizedSourceTreatment: z.enum([
    "NORMALIZED_LIGHT_NEUTRAL", "PRESERVED_FRAMED_SOURCE",
    "LOCAL_AUTHORIZED_FOREGROUND",
  ]).optional(),
  foregroundMatteVersion:
    z.literal(EBAY_AUTHORIZED_FOREGROUND_MATTE_VERSION).optional(),
  foregroundMatteMethod: z.enum([
    "NATIVE_ALPHA", "EDGE_CONNECTED_LIGHT_NEUTRAL_V1",
  ]).optional(),
  foregroundMatteSha256: rawSha256Schema.optional(),
  foregroundBackgroundRemovalRatio: z.number().min(0).max(1).optional(),
  foregroundTransparentBorderRatio: z.number().min(0).max(1).optional(),
  foregroundProtectedPixelRetentionRatio: z.number().min(0).max(1).optional(),
  foregroundOpaqueCornerRatio: z.number().min(0).max(1).optional(),
  textRendererVersion: z.literal(EBAY_IMAGE_TEXT_RENDERER_VERSION).optional(),
  visualEvidenceMode: z.enum([
    "MARKET_SIGNAL_PROMPT", "PROFESSIONAL_FALLBACK",
  ]).optional(),
  promptVersion: z.string().trim().min(1).max(100).optional(),
  promptHash: rawSha256Schema.optional(),
  marketSignalHash: rawSha256Schema.optional(),
  marketSignalConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  marketSignalVersion: z.string().trim().min(1).max(100).optional(),
  marketSignalObservedAt: z.string().datetime().optional(),
  marketSignalFreshUntil: z.string().datetime().optional(),
  productVariantFingerprint: prefixedSha256Schema.optional(),
  positionRuleHash: rawSha256Schema.optional(),
  sourceSha256: rawSha256Schema,
  outputSha256: rawSha256Schema,
  width: z.literal(1600),
  height: z.literal(1600),
  transformationVersion: z.literal(EBAY_LISTING_IMAGE_SET_VERSION),
  generativeAiUsed: z.boolean(),
  originalPackagePixelsPreserved: z.literal(true),
  competitorImageUsed: z.literal(false),
  verifiedFactsOnly: z.literal(true),
  automaticStatus: z.enum(["PASSED", "PARTIAL"]),
  humanApprovalRequired: z.literal(true),
  structuralDiversityVerified: z.literal(true).optional(),
  foregroundEdgeCoverage: z.number().min(0.004).max(1).optional(),
  deterministicBackgroundSelection: z.boolean(),
  foregroundMatteValidated: z.literal(true).optional(),
  opaqueSourceFrameRemoved: z.literal(true).optional(),
  textSafeAreaVerified: z.literal(true).optional(),
  textGlyphsValidated: z.literal(true).optional(),
  sourceEdgeLightNeutralRatio: z.number().min(0).max(1).optional(),
  outputEdgeWhiteRatio: z.number().min(0).max(1).optional(),
  ocrTextVerified: z.literal(true).optional(),
  mobileLegibilityVerified: z.literal(true).optional(),
  productCoverageRatio: z.number().min(0).max(1).optional(),
  productCoverageVerified: z.literal(true).optional(),
  cropSafe: z.literal(true).optional(),
  copyDuplicateFree: z.literal(true).optional(),
  commercialUtilityVerified: z.literal(true).optional(),
  textMinimumPixelSize: z.number().int().min(0).optional(),
  textLineCount: z.number().int().min(0).max(3).optional(),
  groundedPresentation: z.literal(true).optional(),
  promptCompliancePassed: z.literal(true).optional(),
  marketSignalCompliancePassed: z.literal(true).optional(),
  productFidelityPassed: z.literal(true).optional(),
  commercialQualityPassed: z.literal(true).optional(),
  visualStrategyVersion: z.literal(EBAY_VISUAL_STRATEGY_VERSION).optional(),
  backgroundPlateQuality: z.enum(["low", "high"]).optional(),
  selectedSceneBoardPanel: z.number().int().min(1).max(6).optional(),
  candidateSceneBoardPanels: z.array(z.number().int().min(1).max(6))
    .min(1).max(2).optional(),
  backgroundCompatibilityScore: z.number().min(0).max(100).optional(),
  sourceVisualProfile: z.object({
    brightness: z.enum(["DARK", "MID", "LIGHT"]),
    contrast: z.enum(["LOW", "MEDIUM", "HIGH"]),
    palette: z.enum(["COOL", "NEUTRAL", "WARM", "MIXED"]),
    productToneRisk: z.enum(["LIGHT_NEUTRAL_AMBIGUITY", "STANDARD"]),
  }).strict().optional(),
  manualChecksRequired: z.array(z.string().regex(/^[A-Z0-9_]+$/)).min(1).max(20),
}).strict()

const manifestWithoutHashSchema = z.object({
  version: z.literal(SAME_DAY_IMAGE_PACKAGE_MANIFEST_VERSION),
  serviceVersion: z.literal(SAME_DAY_IMAGE_PACKAGE_SERVICE_VERSION),
  setVersion: z.literal(EBAY_LISTING_IMAGE_SET_VERSION),
  compositorContractVersion: z.literal(EBAY_IMAGE_COMPOSITOR_CONTRACT_VERSION).optional(),
  status: z.literal("PENDING_HUMAN_REVIEW"),
  binding: z.object({
    candidateId: z.string().trim().min(1).max(200),
    factRunId: z.string().trim().min(1).max(200),
    authoritativeFactPackageHash: prefixedSha256Schema,
    identityFingerprint: prefixedSha256Schema,
  }).strict(),
  rightsEvidence: z.object({
    rightsBasis: rightsBasisSchema,
    authorizationReferenceHash: prefixedSha256Schema,
    rightsEvidenceConfirmed: z.literal(true),
  }).strict(),
  assets: z.array(persistenceAssetSchema).length(6),
  ai: z.object({
    openAiCalls: z.union([z.literal(0), z.literal(1)]),
    backgroundPlateRequestHash: rawSha256Schema.nullable(),
    requestedQuality: z.enum(["low", "high"]).nullable(),
    productBytesSent: z.literal(0),
    productUrlsSent: z.literal(0),
    competitorDataSent: z.literal(0),
    verifiedProductFactsSent: z.union([z.literal(0), z.literal(1)]),
    aggregateMarketBriefsSent: z.union([z.literal(0), z.literal(1)]),
  }).strict(),
  safety: z.object({
    sourcePolicy: z.literal("AUTHORIZED_PRODUCT_IMAGE_ONLY"),
    rawImagePersistedInManifest: z.literal(false),
    sourceUrlPersistedInManifest: z.literal(false),
    competitorImagesUsed: z.literal(0),
    ebayWrites: z.literal(0),
    productionChanged: z.literal(false),
  }).strict(),
  idempotencyKeyHash: prefixedSha256Schema,
  generatedAt: z.string().datetime({ offset: true }),
}).strict()

const persistenceManifestSchema = manifestWithoutHashSchema.extend({
  manifestHash: prefixedSha256Schema,
}).strict()

export type SameDayImagePackagePersistenceManifest = z.infer<
  typeof persistenceManifestSchema
>

export type SameDayImagePackagePlan = {
  version: typeof SAME_DAY_IMAGE_PACKAGE_SERVICE_VERSION
  binding: CurrentSameDayImageFactBinding
  factoryInput: EbayListingImageFactoryInput
  rightsEvidence: {
    rightsBasis: "supplier_authorized" | "owned" | "licensed"
    authorizationReferenceHash: string
    rightsEvidenceConfirmed: true
  }
  backgroundPlatePlan: EbayOpenAiBackgroundPlatePlan | null
  safety: {
    sourcePolicy: "AUTHORIZED_PRODUCT_IMAGE_ONLY"
    productBytesAvailableToOpenAi: false
    productUrlsAvailableToOpenAi: false
    competitorDataAvailableToOpenAi: false
    verifiedProductFactsAvailableToOpenAi: boolean
    aggregateMarketBriefAvailableToOpenAi: boolean
    maximumOpenAiCalls: 1
    ebayWrites: 0
  }
}

export type SameDayTransientImagePackage = {
  transientAssets: EbayListingImageComposition[]
  persistenceManifest: SameDayImagePackagePersistenceManifest
  counters: {
    assetsGenerated: 6
    openAiCalls: 0 | 1
    productBytesSentToOpenAi: 0
    productUrlsSentToOpenAi: 0
    competitorImagesUsed: 0
    ebayWrites: 0
  }
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex")
}

function assertIsoTimestamp(value: string) {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error("SAME_DAY_IMAGE_GENERATED_AT_INVALID")
  }
  return new Date(value).toISOString()
}

function assertReturnedBackgroundPlate(
  expected: EbayOpenAiBackgroundPlatePlan,
  value: EbayOpenAiBackgroundPlate,
) {
  if (!Buffer.isBuffer(value.output) || !value.output.length ||
    value.output.length > 12 * 1024 * 1024 ||
    value.outputSha256 !== sha256(value.output) ||
    value.plan.version !== expected.version ||
    value.plan.visualStrategyVersion !== expected.visualStrategyVersion ||
    value.plan.context !== expected.context ||
    value.plan.prompt !== expected.prompt ||
    value.plan.requestHash !== expected.requestHash ||
    value.plan.promptHash !== expected.promptHash ||
    value.plan.model !== expected.model ||
    value.plan.imageCount !== 1 ||
    value.plan.quality !== expected.quality ||
    value.plan.size !== "1536x1024" ||
    value.plan.sendsProductBytes !== false ||
    value.plan.sendsProductUrl !== false ||
    value.plan.sendsCompetitorData !== false ||
    value.plan.sendsVerifiedProductFacts !== true ||
    typeof value.plan.sendsAggregatedMarketPatterns !== "boolean") {
    throw new Error("SAME_DAY_IMAGE_BACKGROUND_PLATE_INVALID")
  }
  return value
}

export function buildSameDayImagePackagePlan(input: {
  handoffPackage: unknown
  authoritativeFactsPackage: unknown
  currentBinding: CurrentSameDayImageFactBinding
  rightsEvidence: {
    rightsBasis?: unknown
    authorizationReference?: unknown
    rightsEvidenceConfirmed?: unknown
  }
  aiContext: { enabled: false } | {
    enabled: true
    model: string
    quality?: EbayOpenAiImageQuality
  }
  marketVisualBrief?: EbayImageMarketBrief | null
  allowVerifiedActiveHistoricalHandoff?: boolean
}): SameDayImagePackagePlan {
  const factoryInput = buildCurrentSameDayImageFactoryInput({
    handoffPackage: input.handoffPackage,
    authoritativeFactsPackage: input.authoritativeFactsPackage,
    currentBinding: input.currentBinding,
    allowVerifiedActiveHistoricalHandoff:
      input.allowVerifiedActiveHistoricalHandoff,
  })
  const rights = validateImageRightsEvidence(input.rightsEvidence)
  const rightsBasis = rightsBasisSchema.parse(rights.rightsBasis)
  const marketVisualBrief = input.marketVisualBrief
    ? ebayImageMarketBriefSchema.parse(input.marketVisualBrief)
    : null
  const enrichedFactoryInput = validateListingImageFactoryInput({
    ...factoryInput,
    marketVisualBrief,
  })
  const backgroundPlatePlan = input.aiContext.enabled
    ? buildSafeOpenAiBackgroundPlatePlan(
      enrichedFactoryInput,
      input.aiContext.model,
      input.aiContext.quality,
    )
    : null
  return {
    version: SAME_DAY_IMAGE_PACKAGE_SERVICE_VERSION,
    binding: { ...input.currentBinding },
    factoryInput: enrichedFactoryInput,
    rightsEvidence: {
      rightsBasis,
      authorizationReferenceHash: productFactsHash(
        rights.authorizationReference,
      ),
      rightsEvidenceConfirmed: true,
    },
    backgroundPlatePlan,
    safety: {
      sourcePolicy: "AUTHORIZED_PRODUCT_IMAGE_ONLY",
      productBytesAvailableToOpenAi: false,
      productUrlsAvailableToOpenAi: false,
      competitorDataAvailableToOpenAi: false,
      verifiedProductFactsAvailableToOpenAi: input.aiContext.enabled,
      aggregateMarketBriefAvailableToOpenAi:
        input.aiContext.enabled && Boolean(marketVisualBrief),
      maximumOpenAiCalls: 1,
      ebayWrites: 0,
    },
  }
}

function validateTransientAssets(input: {
  assets: EbayListingImageComposition[]
  expectedSourceSha256s: ReadonlySet<string>
  openAiCalls: 0 | 1
  backgroundPlateRequestHash: string | null
  requestedQuality: EbayOpenAiImageQuality | null
}) {
  if (input.assets.length !== EBAY_LISTING_IMAGE_SLOTS.length) {
    throw new Error("SAME_DAY_IMAGE_SET_INCOMPLETE")
  }
  const bySlot = new Map(input.assets.map((asset) => [asset.slot, asset]))
  if (bySlot.size !== EBAY_LISTING_IMAGE_SLOTS.length ||
    EBAY_LISTING_IMAGE_SLOTS.some((slot) => !bySlot.has(slot))) {
    throw new Error("SAME_DAY_IMAGE_SET_SLOTS_INVALID")
  }
  const outputs = new Set<string>()
  const layoutIds = new Set<string>()
  let generativeAssets = 0
  const ordered = EBAY_LISTING_IMAGE_SLOTS.map((slot) => {
    const asset = bySlot.get(slot)!
    if (!Buffer.isBuffer(asset.output) || !asset.output.length ||
      asset.outputSha256 !== sha256(asset.output) ||
      !input.expectedSourceSha256s.has(asset.sourceSha256) ||
      asset.bytes !== asset.output.length ||
      asset.width !== 1600 || asset.height !== 1600 ||
      asset.transformation.version !== EBAY_LISTING_IMAGE_SET_VERSION ||
      asset.transformation.compositorContractVersion !==
        EBAY_IMAGE_COMPOSITOR_CONTRACT_VERSION ||
      asset.transformation.slot !== slot ||
      !/^[A-Z0-9_]{3,80}$/.test(asset.transformation.layoutId) ||
      !Number.isInteger(asset.transformation.authorizedSourceIndex) ||
      asset.transformation.authorizedSourceIndex < 0 ||
      asset.transformation.authorizedSourceIndex > 2 ||
      asset.transformation.originalPackagePixelsPreserved !== true ||
      asset.transformation.competitorImageUsed !== false ||
      asset.transformation.verifiedFactsOnly !== true ||
      !["AUTHORIZED_MULTI_SOURCE", "SINGLE_SOURCE_INFORMATIONAL"]
        .includes(asset.transformation.presentationMode) ||
      ![
        "NORMALIZED_LIGHT_NEUTRAL", "PRESERVED_FRAMED_SOURCE",
        "LOCAL_AUTHORIZED_FOREGROUND",
      ]
        .includes(asset.transformation.authorizedSourceTreatment) ||
      asset.qa.dimensionsValid !== true ||
      asset.qa.sourceHashRecorded !== true ||
      asset.qa.outputHashRecorded !== true ||
      asset.qa.textDerivedFromVerifiedFacts !== true ||
      asset.qa.humanApprovalRequired !== true ||
      asset.qa.structuralDiversityVerified !== true ||
      typeof asset.qa.deterministicBackgroundSelection !== "boolean" ||
      !Number.isFinite(asset.qa.foregroundEdgeCoverage) ||
      asset.qa.foregroundEdgeCoverage < 0.004 ||
      asset.qa.foregroundEdgeCoverage > 1) {
      throw new Error("SAME_DAY_IMAGE_SET_ASSET_INVALID")
    }
    if (asset.qa.automaticStatus !== "PASSED" ||
      asset.qa.ocrTextVerified !== true ||
      asset.qa.mobileLegibilityVerified !== true ||
      asset.qa.productCoverageVerified !== true ||
      asset.qa.cropSafe !== true ||
      asset.qa.copyDuplicateFree !== true ||
      asset.qa.commercialUtilityVerified !== true ||
      asset.qa.groundedPresentation !== true ||
      asset.qa.promptCompliancePassed !== true ||
      asset.qa.marketSignalCompliancePassed !== true ||
      asset.qa.productFidelityPassed !== true ||
      asset.qa.commercialQualityPassed !== true ||
      !Number.isFinite(asset.qa.productCoverageRatio) ||
      (slot === "MAIN_WHITE_BACKGROUND"
        ? asset.qa.productCoverageRatio < .7 ||
          asset.qa.productCoverageRatio > .85 ||
          !Number.isFinite(asset.qa.outputEdgeWhiteRatio) ||
          (asset.qa.outputEdgeWhiteRatio ?? 0) < .9 ||
          asset.qa.textLineCount !== 0 ||
          asset.qa.textMinimumPixelSize !== 0
        : asset.qa.productCoverageRatio < .45 ||
          asset.qa.productCoverageRatio > .7 ||
          asset.qa.textLineCount < 1 || asset.qa.textLineCount > 3 ||
          asset.qa.textMinimumPixelSize < 54)) {
      throw new Error("SAME_DAY_IMAGE_SET_QA_NOT_PASSED")
    }
    const secondary = slot !== "MAIN_WHITE_BACKGROUND"
    if (secondary) {
      if (asset.transformation.authorizedSourceTreatment !==
          "LOCAL_AUTHORIZED_FOREGROUND" ||
        asset.transformation.foregroundMatteVersion !==
          EBAY_AUTHORIZED_FOREGROUND_MATTE_VERSION ||
        !["NATIVE_ALPHA", "EDGE_CONNECTED_LIGHT_NEUTRAL_V1"].includes(
          asset.transformation.foregroundMatteMethod ?? "",
        ) ||
        !/^[0-9a-f]{64}$/.test(
          asset.transformation.foregroundMatteSha256 ?? "",
        ) ||
        !Number.isFinite(
          asset.transformation.foregroundBackgroundRemovalRatio,
        ) ||
        asset.transformation.foregroundBackgroundRemovalRatio! < .02 ||
        asset.transformation.foregroundBackgroundRemovalRatio! > .98 ||
        !Number.isFinite(
          asset.transformation.foregroundTransparentBorderRatio,
        ) ||
        asset.transformation.foregroundTransparentBorderRatio! < .99 ||
        !Number.isFinite(
          asset.transformation.foregroundProtectedPixelRetentionRatio,
        ) ||
        asset.transformation.foregroundProtectedPixelRetentionRatio! < .9999 ||
        !Number.isFinite(
          asset.transformation.foregroundOpaqueCornerRatio,
        ) ||
        asset.transformation.foregroundOpaqueCornerRatio! > .001 ||
        asset.qa.foregroundMatteValidated !== true ||
        asset.qa.opaqueSourceFrameRemoved !== true ||
        asset.qa.textSafeAreaVerified !== true ||
        asset.transformation.textRendererVersion !==
          EBAY_IMAGE_TEXT_RENDERER_VERSION ||
        asset.qa.textGlyphsValidated !== true ||
        !asset.qa.manualChecksRequired.includes(
          "AUTHORIZED_FOREGROUND_MATTE_HUMAN_ACCEPTANCE",
        )) {
        throw new Error("SAME_DAY_IMAGE_SET_FOREGROUND_EVIDENCE_INVALID")
      }
    } else if (asset.transformation.authorizedSourceTreatment ===
        "LOCAL_AUTHORIZED_FOREGROUND" ||
      asset.transformation.foregroundMatteVersion !== undefined ||
      asset.transformation.foregroundMatteMethod !== undefined ||
      asset.transformation.foregroundMatteSha256 !== undefined ||
      asset.qa.foregroundMatteValidated !== undefined ||
      asset.qa.opaqueSourceFrameRemoved !== undefined ||
      asset.qa.textSafeAreaVerified !== undefined ||
      asset.transformation.textRendererVersion !== undefined ||
      asset.qa.textGlyphsValidated !== undefined) {
      throw new Error("SAME_DAY_IMAGE_SET_MAIN_FOREGROUND_EVIDENCE_INVALID")
    }
    if (outputs.has(asset.outputSha256)) {
      throw new Error("SAME_DAY_IMAGE_SET_OUTPUT_DUPLICATED")
    }
    outputs.add(asset.outputSha256)
    if (layoutIds.has(asset.transformation.layoutId)) {
      throw new Error("SAME_DAY_IMAGE_SET_LAYOUT_DUPLICATED")
    }
    layoutIds.add(asset.transformation.layoutId)
    if (asset.transformation.generativeAiUsed) {
      generativeAssets += 1
      if (slot === "MAIN_WHITE_BACKGROUND" ||
        asset.transformation.backgroundPlateRequestHash !==
          input.backgroundPlateRequestHash ||
        asset.transformation.backgroundPlateQuality !== input.requestedQuality ||
        asset.transformation.visualStrategyVersion !== EBAY_VISUAL_STRATEGY_VERSION ||
        !Number.isInteger(asset.transformation.selectedSceneBoardPanel) ||
        !asset.transformation.candidateSceneBoardPanels?.includes(
          asset.transformation.selectedSceneBoardPanel!,
        ) ||
        !Number.isFinite(asset.transformation.backgroundCompatibilityScore) ||
        !asset.transformation.sourceVisualProfile ||
        asset.qa.deterministicBackgroundSelection !== true) {
        throw new Error("SAME_DAY_IMAGE_GENERATIVE_SLOT_INVALID")
      }
    } else if (asset.transformation.backgroundPlateQuality !== undefined ||
      asset.qa.deterministicBackgroundSelection !== false) {
      throw new Error("SAME_DAY_IMAGE_GENERATIVE_SLOT_INVALID")
    }
    return asset
  })
  if ((input.openAiCalls === 0 && generativeAssets !== 0) ||
    (input.openAiCalls === 1 && generativeAssets !== 5)) {
    throw new Error("SAME_DAY_IMAGE_OPENAI_CALL_ASSET_MISMATCH")
  }
  return ordered
}

export function buildSameDayImagePackagePersistenceManifest(input: {
  plan: SameDayImagePackagePlan
  assets: EbayListingImageComposition[]
  sourceSha256?: string
  sourceSha256s?: string[]
  openAiCalls: 0 | 1
  generatedAt: string
}): SameDayImagePackagePersistenceManifest {
  validateListingImageFactoryInput(input.plan.factoryInput)
  if (input.plan.version !== SAME_DAY_IMAGE_PACKAGE_SERVICE_VERSION ||
    input.plan.binding.factPackageHash !==
      input.plan.factoryInput.identityFingerprint ||
    input.plan.safety.sourcePolicy !== "AUTHORIZED_PRODUCT_IMAGE_ONLY" ||
    input.plan.safety.productBytesAvailableToOpenAi !== false ||
    input.plan.safety.productUrlsAvailableToOpenAi !== false ||
    input.plan.safety.competitorDataAvailableToOpenAi !== false ||
    typeof input.plan.safety.verifiedProductFactsAvailableToOpenAi !== "boolean" ||
    typeof input.plan.safety.aggregateMarketBriefAvailableToOpenAi !== "boolean" ||
    input.plan.safety.verifiedProductFactsAvailableToOpenAi !==
      Boolean(input.plan.backgroundPlatePlan) ||
    input.plan.safety.maximumOpenAiCalls !== 1 ||
    input.plan.safety.ebayWrites !== 0) {
    throw new Error("SAME_DAY_IMAGE_PACKAGE_PLAN_INVALID")
  }
  const requestHash = input.plan.backgroundPlatePlan?.requestHash ?? null
  if (input.plan.backgroundPlatePlan && (
    input.plan.backgroundPlatePlan.sendsProductBytes !== false ||
    input.plan.backgroundPlatePlan.sendsProductUrl !== false ||
    input.plan.backgroundPlatePlan.sendsCompetitorData !== false ||
    input.plan.backgroundPlatePlan.sendsVerifiedProductFacts !== true ||
    input.plan.backgroundPlatePlan.sendsAggregatedMarketPatterns !==
      input.plan.safety.aggregateMarketBriefAvailableToOpenAi
  )) throw new Error("SAME_DAY_IMAGE_PACKAGE_PLAN_INVALID")
  const authorizedSourceHashes = [...new Set(
    input.sourceSha256s?.length
      ? input.sourceSha256s
      : input.sourceSha256 ? [input.sourceSha256] : [],
  )]
  if (!authorizedSourceHashes.length || authorizedSourceHashes.length > 3 ||
    authorizedSourceHashes.some((value) => !/^[0-9a-f]{64}$/.test(value))) {
    throw new Error("SAME_DAY_IMAGE_AUTHORIZED_SOURCE_HASHES_INVALID")
  }
  const ordered = validateTransientAssets({
    assets: input.assets,
    expectedSourceSha256s: new Set(authorizedSourceHashes),
    openAiCalls: input.openAiCalls,
    backgroundPlateRequestHash: requestHash,
    requestedQuality: input.plan.backgroundPlatePlan?.quality ?? null,
  })
  if ((input.openAiCalls === 1) !== Boolean(input.plan.backgroundPlatePlan)) {
    throw new Error("SAME_DAY_IMAGE_OPENAI_PLAN_CALL_MISMATCH")
  }
  const generatedAt = assertIsoTimestamp(input.generatedAt)
  const withoutHash = manifestWithoutHashSchema.parse({
    version: SAME_DAY_IMAGE_PACKAGE_MANIFEST_VERSION,
    serviceVersion: SAME_DAY_IMAGE_PACKAGE_SERVICE_VERSION,
    setVersion: EBAY_LISTING_IMAGE_SET_VERSION,
    compositorContractVersion: EBAY_IMAGE_COMPOSITOR_CONTRACT_VERSION,
    status: "PENDING_HUMAN_REVIEW",
    binding: {
      candidateId: input.plan.binding.candidateId,
      factRunId: input.plan.binding.factRunId,
      authoritativeFactPackageHash: input.plan.binding.factPackageHash,
      identityFingerprint: input.plan.factoryInput.identityFingerprint,
    },
    rightsEvidence: input.plan.rightsEvidence,
    assets: ordered.map((asset, index) => ({
      position: index + 1,
      slot: asset.slot,
      layoutId: asset.transformation.layoutId,
      compositorContractVersion:
        asset.transformation.compositorContractVersion,
      presentationMode: asset.transformation.presentationMode,
      authorizedSourceTreatment:
        asset.transformation.authorizedSourceTreatment,
      foregroundMatteVersion:
        asset.transformation.foregroundMatteVersion,
      foregroundMatteMethod:
        asset.transformation.foregroundMatteMethod,
      foregroundMatteSha256:
        asset.transformation.foregroundMatteSha256,
      foregroundBackgroundRemovalRatio:
        asset.transformation.foregroundBackgroundRemovalRatio,
      foregroundTransparentBorderRatio:
        asset.transformation.foregroundTransparentBorderRatio,
      foregroundProtectedPixelRetentionRatio:
        asset.transformation.foregroundProtectedPixelRetentionRatio,
      foregroundOpaqueCornerRatio:
        asset.transformation.foregroundOpaqueCornerRatio,
      textRendererVersion: asset.transformation.textRendererVersion,
      visualEvidenceMode: asset.transformation.visualEvidenceMode,
      promptVersion: asset.transformation.promptVersion,
      promptHash: asset.transformation.promptHash,
      marketSignalHash: asset.transformation.marketSignalHash,
      marketSignalConfidence: asset.transformation.marketSignalConfidence,
      marketSignalVersion: asset.transformation.marketSignalVersion,
      marketSignalObservedAt: asset.transformation.marketSignalObservedAt,
      marketSignalFreshUntil: asset.transformation.marketSignalFreshUntil,
      productVariantFingerprint:
        asset.transformation.productVariantFingerprint,
      positionRuleHash: asset.transformation.positionRuleHash,
      sourceSha256: asset.sourceSha256,
      outputSha256: asset.outputSha256,
      width: asset.width,
      height: asset.height,
      transformationVersion: EBAY_LISTING_IMAGE_SET_VERSION,
      generativeAiUsed: asset.transformation.generativeAiUsed,
      originalPackagePixelsPreserved:
        asset.transformation.originalPackagePixelsPreserved,
      competitorImageUsed: asset.transformation.competitorImageUsed,
      verifiedFactsOnly: asset.transformation.verifiedFactsOnly,
      automaticStatus: asset.qa.automaticStatus,
      humanApprovalRequired: asset.qa.humanApprovalRequired,
      structuralDiversityVerified: asset.qa.structuralDiversityVerified,
      foregroundEdgeCoverage: asset.qa.foregroundEdgeCoverage,
      deterministicBackgroundSelection:
        asset.qa.deterministicBackgroundSelection,
      foregroundMatteValidated: asset.qa.foregroundMatteValidated,
      opaqueSourceFrameRemoved: asset.qa.opaqueSourceFrameRemoved,
      textSafeAreaVerified: asset.qa.textSafeAreaVerified,
      textGlyphsValidated: asset.qa.textGlyphsValidated,
      sourceEdgeLightNeutralRatio: asset.qa.sourceEdgeLightNeutralRatio,
      outputEdgeWhiteRatio: asset.qa.outputEdgeWhiteRatio,
      ocrTextVerified: asset.qa.ocrTextVerified,
      mobileLegibilityVerified: asset.qa.mobileLegibilityVerified,
      productCoverageRatio: asset.qa.productCoverageRatio,
      productCoverageVerified: asset.qa.productCoverageVerified,
      cropSafe: asset.qa.cropSafe,
      copyDuplicateFree: asset.qa.copyDuplicateFree,
      commercialUtilityVerified: asset.qa.commercialUtilityVerified,
      textMinimumPixelSize: asset.qa.textMinimumPixelSize,
      textLineCount: asset.qa.textLineCount,
      groundedPresentation: asset.qa.groundedPresentation,
      promptCompliancePassed: asset.qa.promptCompliancePassed,
      marketSignalCompliancePassed: asset.qa.marketSignalCompliancePassed,
      productFidelityPassed: asset.qa.productFidelityPassed,
      commercialQualityPassed: asset.qa.commercialQualityPassed,
      visualStrategyVersion: asset.transformation.visualStrategyVersion,
      backgroundPlateQuality: asset.transformation.backgroundPlateQuality,
      selectedSceneBoardPanel:
        asset.transformation.selectedSceneBoardPanel,
      candidateSceneBoardPanels:
        asset.transformation.candidateSceneBoardPanels,
      backgroundCompatibilityScore:
        asset.transformation.backgroundCompatibilityScore,
      sourceVisualProfile: asset.transformation.sourceVisualProfile,
      manualChecksRequired: asset.qa.manualChecksRequired,
    })),
    ai: {
      openAiCalls: input.openAiCalls,
      backgroundPlateRequestHash: requestHash,
      requestedQuality: input.plan.backgroundPlatePlan?.quality ?? null,
      productBytesSent: 0,
      productUrlsSent: 0,
      competitorDataSent: 0,
      verifiedProductFactsSent: input.openAiCalls,
      aggregateMarketBriefsSent: input.openAiCalls === 1 &&
          input.plan.safety.aggregateMarketBriefAvailableToOpenAi ? 1 : 0,
    },
    safety: {
      sourcePolicy: "AUTHORIZED_PRODUCT_IMAGE_ONLY",
      rawImagePersistedInManifest: false,
      sourceUrlPersistedInManifest: false,
      competitorImagesUsed: 0,
      ebayWrites: 0,
      productionChanged: false,
    },
    idempotencyKeyHash: productFactsHash({
      serviceVersion: SAME_DAY_IMAGE_PACKAGE_SERVICE_VERSION,
      compositorContractVersion: EBAY_IMAGE_COMPOSITOR_CONTRACT_VERSION,
      candidateId: input.plan.binding.candidateId,
      factRunId: input.plan.binding.factRunId,
      factPackageHash: input.plan.binding.factPackageHash,
      sourceSha256s: ordered.map((asset) => asset.sourceSha256),
      backgroundPlateRequestHash: requestHash,
    }),
    generatedAt,
  })
  return persistenceManifestSchema.parse({
    ...withoutHash,
    manifestHash: productFactsHash(withoutHash),
  })
}

export function parseSameDayImagePackagePersistenceManifest(
  value: unknown,
): SameDayImagePackagePersistenceManifest | null {
  const parsed = persistenceManifestSchema.safeParse(value)
  if (!parsed.success) return null
  const { manifestHash, ...withoutHash } = parsed.data
  if (productFactsHash(withoutHash) !== manifestHash) return null
  const slots = parsed.data.assets.map((asset) => asset.slot)
  if (new Set(slots).size !== EBAY_LISTING_IMAGE_SLOTS.length ||
    EBAY_LISTING_IMAGE_SLOTS.some((slot, index) => slots[index] !== slot)) {
    return null
  }
  const outputHashes = parsed.data.assets.map((asset) => asset.outputSha256)
  const sourceHashes = parsed.data.assets.map((asset) => asset.sourceSha256)
  if (new Set(outputHashes).size !== EBAY_LISTING_IMAGE_SLOTS.length ||
    new Set(sourceHashes).size > 3) return null
  const layoutIds = parsed.data.assets
    .map((asset) => asset.layoutId)
    .filter((value): value is string => Boolean(value))
  if (layoutIds.length > 0 && (layoutIds.length !== EBAY_LISTING_IMAGE_SLOTS.length ||
    new Set(layoutIds).size !== EBAY_LISTING_IMAGE_SLOTS.length)) return null
  const generativeAssets = parsed.data.assets.filter((asset) =>
    asset.generativeAiUsed)
  if (parsed.data.ai.openAiCalls === 0) {
    if (parsed.data.ai.backgroundPlateRequestHash !== null ||
      parsed.data.ai.requestedQuality !== null ||
      generativeAssets.length !== 0) return null
  } else if (parsed.data.ai.backgroundPlateRequestHash === null ||
    parsed.data.ai.requestedQuality === null ||
    generativeAssets.length !== 5 ||
    generativeAssets.some((asset) =>
      asset.slot === "MAIN_WHITE_BACKGROUND" ||
      asset.backgroundPlateQuality !== parsed.data.ai.requestedQuality)) return null
  return parsed.data
}

export async function generateTransientSameDayImagePackage(input: {
  handoffPackage: unknown
  authoritativeFactsPackage: unknown
  currentBinding: CurrentSameDayImageFactBinding
  rightsEvidence: {
    rightsBasis?: unknown
    authorizationReference?: unknown
    rightsEvidenceConfirmed?: unknown
  }
  aiContext: { enabled: false } | {
    enabled: true
    model: string
    quality?: EbayOpenAiImageQuality
  }
  marketVisualBrief?: EbayImageMarketBrief | null
  source: Buffer | Buffer[]
  generatedAt?: string
  allowVerifiedActiveHistoricalHandoff?: boolean
  requestBackgroundPlate?: (
    plan: EbayOpenAiBackgroundPlatePlan,
  ) => Promise<EbayOpenAiBackgroundPlate>
}): Promise<SameDayTransientImagePackage> {
  const plan = buildSameDayImagePackagePlan(input)
  const sources = (Array.isArray(input.source) ? input.source : [input.source]).slice(0, 3)
  if (!sources.length || sources.some((source) =>
    !Buffer.isBuffer(source) || !source.length)) {
    throw new Error("SAME_DAY_IMAGE_AUTHORIZED_SOURCES_INVALID")
  }
  const sourceSha256s = sources.map(sha256)
  assertEbayImageEvidenceSufficiency({
    facts: plan.factoryInput.facts,
    sourceSha256s,
  })
  const preflightForegrounds: Buffer[] = []
  try {
    for (const source of sources) {
      const foreground = await prepareAuthorizedEbaySecondaryForeground(source)
      if (!foreground) throw new Error("EBAY_IMAGE_FOREGROUND_EXTRACTION_UNSAFE")
      preflightForegrounds.push(foreground.output)
    }
  } finally {
    for (const foreground of preflightForegrounds) foreground.fill(0)
  }
  let backgroundPlate: EbayOpenAiBackgroundPlate | null = null
  let assets: EbayListingImageComposition[] = []
  const openAiCalls: 0 | 1 = plan.backgroundPlatePlan ? 1 : 0
  try {
    if (plan.backgroundPlatePlan) {
      if (!input.requestBackgroundPlate) {
        throw new Error("SAME_DAY_IMAGE_BACKGROUND_PROVIDER_REQUIRED")
      }
      // Deliberately pass only the empty-scene plan. Product facts, source
      // bytes, source URLs and handoff data are not in this function argument.
      const returnedPlate = await input.requestBackgroundPlate(
        plan.backgroundPlatePlan,
      )
      try {
        backgroundPlate = assertReturnedBackgroundPlate(
          plan.backgroundPlatePlan,
          returnedPlate,
        )
      } catch (error) {
        // A rejected provider response is just as transient as an accepted
        // plate and must not leave raw pixels available to another layer.
        if (Buffer.isBuffer(returnedPlate.output)) returnedPlate.output.fill(0)
        throw error
      }
    }
    assets = await composeAuthorizedEbayListingImageSet(
      sources,
      plan.factoryInput,
      backgroundPlate,
    )
    const persistenceManifest = buildSameDayImagePackagePersistenceManifest({
      plan,
      assets,
      sourceSha256s,
      openAiCalls,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
    })
    return {
      transientAssets: assets,
      persistenceManifest,
      counters: {
        assetsGenerated: 6,
        openAiCalls,
        productBytesSentToOpenAi: 0,
        productUrlsSentToOpenAi: 0,
        competitorImagesUsed: 0,
        ebayWrites: 0,
      },
    }
  } catch (error) {
    disposeTransientSameDayImageAssets(assets)
    throw error
  } finally {
    // Provider pixels are never returned or persisted independently.
    backgroundPlate?.output.fill(0)
  }
}

export function disposeTransientSameDayImageAssets(
  assets: EbayListingImageComposition[],
) {
  for (const asset of assets) asset.output.fill(0)
}
