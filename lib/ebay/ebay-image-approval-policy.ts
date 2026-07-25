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

export function assertStoredSameDayImageSetQaPassed(assets: unknown) {
  if (!Array.isArray(assets) || assets.length !== 7) {
    throw new Error("SAME_DAY_IMAGE_SET_QA_NOT_PASSED")
  }
  const rows = assets.map(record)
  const secondary = rows.filter((asset) =>
    text(record(asset.transformation).slot, 80) !== "MAIN_WHITE_BACKGROUND")
  const secondarySourceCounts = new Map<string, number>()
  for (const asset of secondary) {
    const sourceHash = text(asset.source_sha256, 64)
    if (/^[0-9a-f]{64}$/.test(sourceHash)) {
      secondarySourceCounts.set(
        sourceHash,
        (secondarySourceCounts.get(sourceHash) ?? 0) + 1,
      )
    }
  }
  if (secondary.length !== 6 || secondarySourceCounts.size < 2 ||
    Math.max(...secondarySourceCounts.values()) > 3) {
    throw new Error("SAME_DAY_IMAGE_SET_SOURCE_DIVERSITY_NOT_PASSED")
  }
  if (rows.some((asset) => {
    const row = record(asset)
    const transformation = record(row.transformation)
    const qa = record(row.qa_result)
    return qa.automaticStatus !== "PASSED" ||
      qa.structuralDiversityVerified !== true ||
      qa.copyDuplicateFree !== true ||
      qa.offerPackPresentationPassed !== true ||
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
