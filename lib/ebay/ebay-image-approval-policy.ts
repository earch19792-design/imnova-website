// @ts-expect-error Node's native TypeScript tests need the explicit extension.
import { EBAY_SQUARE_PRESENTATION_QA_VERSION } from "./ebay-image-square-presentation.ts"

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : ""
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => text(entry, 240)).filter(Boolean)
    : []
}

export function assertStoredSameDayImageSetQaPassed(assets: unknown) {
  if (!Array.isArray(assets) || assets.length !== 7 || assets.some((asset) => {
    const row = record(asset)
    const transformation = record(row.transformation)
    const qa = record(row.qa_result)
    return qa.automaticStatus !== "PASSED" ||
      transformation.squarePresentationVersion !==
        EBAY_SQUARE_PRESENTATION_QA_VERSION ||
      transformation.artificialFrameAdded !== false ||
      transformation.outputEncodingQuality !== 94 ||
      qa.squarePresentationQaVersion !==
        EBAY_SQUARE_PRESENTATION_QA_VERSION ||
      qa.squareFormatPassed !== true ||
      qa.artificialInsetFrameFree !== true ||
      qa.sourceQualityPassed !== true ||
      qa.safeCanvasPlacementPassed !== true ||
      qa.mobileFocalPointPassed !== true
  })) {
    throw new Error("SAME_DAY_IMAGE_SET_QA_NOT_PASSED")
  }
}

export function hasReviewableSameDaySecondaryAssetContracts(
  asset: unknown,
  expected: {
    foregroundMatteVersion: string
    textRendererVersion: string
  },
) {
  const row = record(asset)
  const transformation = record(row.transformation)
  const qa = record(row.qa_result)
  const textLineCount = typeof qa.textLineCount === "number"
    ? qa.textLineCount
    : Number.NaN
  const noRenderedText = textLineCount === 0 && qa.textPolicyPassed === true
  const renderedTextContract = Number.isInteger(textLineCount) &&
    textLineCount >= 1 && textLineCount <= 3 &&
    transformation.textRendererVersion === expected.textRendererVersion &&
    qa.textSafeAreaVerified === true &&
    qa.textGlyphsValidated === true
  return transformation.authorizedSourceTreatment ===
      "LOCAL_AUTHORIZED_FOREGROUND" &&
    transformation.foregroundMatteVersion ===
      expected.foregroundMatteVersion &&
    ["NATIVE_ALPHA", "EDGE_CONNECTED_LIGHT_NEUTRAL_V1",
      "PROTECTED_TRIMAP_MATTING_V1"].includes(
      text(transformation.foregroundMatteMethod, 80),
    ) &&
    transformation.squarePresentationVersion ===
      EBAY_SQUARE_PRESENTATION_QA_VERSION &&
    transformation.artificialFrameAdded === false &&
    qa.squarePresentationQaVersion ===
      EBAY_SQUARE_PRESENTATION_QA_VERSION &&
    qa.squareFormatPassed === true &&
    qa.artificialInsetFrameFree === true &&
    qa.sourceQualityPassed === true &&
    qa.safeCanvasPlacementPassed === true &&
    qa.mobileFocalPointPassed === true &&
    qa.foregroundMatteValidated === true &&
    qa.opaqueSourceFrameRemoved === true &&
    (noRenderedText || renderedTextContract)
}

/**
 * The V9 compositor intentionally supports a deterministic informational set
 * when exactly one catalog view can be separated without altering the
 * product. Keep that current, human-reviewed fallback distinct from legacy
 * single-source sets: it must be an exact seven-slot set, use one authorized
 * source hash, carry six different commercial objectives and satisfy every
 * stored professional QA contract.
 */
export function isReviewableDeterministicSingleSourceInformationalSet(
  assets: unknown,
  expected: {
    compositorContractVersion: string
    foregroundMatteVersion: string
    textRendererVersion: string
    slots: readonly string[]
  },
) {
  if (!Array.isArray(assets) || assets.length !== 7 ||
    expected.slots.length !== 7) return false
  const rows = assets.map(record)
  const transformations = rows.map((asset) => record(asset.transformation))
  const qaResults = rows.map((asset) => record(asset.qa_result))
  const slots = transformations.map((transformation) =>
    text(transformation.slot, 80))
  if (new Set(slots).size !== 7 ||
    expected.slots.some((slot) => !slots.includes(slot))) return false
  const sourceHashes = rows.map((asset) => text(asset.source_sha256, 64))
  if (sourceHashes.some((hash) => !/^[0-9a-f]{64}$/.test(hash)) ||
    new Set(sourceHashes).size !== 1) return false
  if (transformations.some((transformation) =>
    transformation.compositorContractVersion !==
      expected.compositorContractVersion ||
    transformation.presentationMode !== "SINGLE_SOURCE_INFORMATIONAL" ||
    transformation.generativeAiUsed !== false ||
    transformation.competitorImageUsed !== false ||
    transformation.verifiedFactsOnly !== true ||
    transformation.sourceVisualPolicy !== "EXACT_AUTHORIZED_PIXELS_ONLY" ||
    transformation.authorizedSourceViewReused !== true ||
    transformation.visualEvidenceMode !== "PROFESSIONAL_FALLBACK")) {
    return false
  }
  if (qaResults.some((qa) =>
    qa.automaticStatus !== "PASSED" ||
    qa.productFidelityPassed !== true ||
    qa.commercialQualityPassed !== true ||
    qa.technicalQualityPassed !== true ||
    qa.compositionPassed !== true ||
    qa.textPolicyPassed !== true ||
    qa.contextualPropsPassed !== true ||
    qa.mobileReadabilityPassed !== true ||
    qa.sourceViewCapabilityPassed !== true ||
    qa.marketSignalsLimitedToScene !== true ||
    qa.hiddenProductGeometryGenerated !== false ||
    !stringArray(qa.manualChecksRequired).includes(
      "SINGLE_SOURCE_INFORMATIONAL_PANELS_NOT_MULTIPLE_PRODUCT_VIEWS",
    ))) return false
  const secondaryIndexes = slots.flatMap((slot, index) =>
    slot === "MAIN_WHITE_BACKGROUND" ? [] : [index])
  if (secondaryIndexes.length !== 6 || secondaryIndexes.some((index) =>
    !hasReviewableSameDaySecondaryAssetContracts(rows[index], expected))) {
    return false
  }
  const objectives = secondaryIndexes.map((index) =>
    text(record(transformations[index].visualStrategyPosition).salesObjective, 120))
  return objectives.every(Boolean) && new Set(objectives).size === 6
}

export function currentAttemptPublicObjects(entries: unknown) {
  if (!Array.isArray(entries)) return []
  return entries.map(record).filter((entry) =>
    entry.public_object_created === true &&
    Boolean(text(entry.published_storage_path, 1_000)) &&
    /^[0-9a-f]{64}$/.test(text(entry.output_sha256, 64)))
    .map((entry) => ({
      path: text(entry.published_storage_path, 1_000),
      sha256: text(entry.output_sha256, 64),
      createdByCurrentAttempt: true as const,
    }))
}
