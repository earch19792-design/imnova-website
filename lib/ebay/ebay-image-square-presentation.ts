import sharp from "sharp"

export const EBAY_SQUARE_PRESENTATION_QA_VERSION =
  "SELLER_OS_EBAY_SQUARE_PRESENTATION_QA_V1_2026_07_24"

export type EbaySquarePresentationAudit = {
  version: typeof EBAY_SQUARE_PRESENTATION_QA_VERSION
  passed: boolean
  square1600Passed: boolean
  jpegQualityProfilePassed: boolean
  productFillPassed: boolean
  safeCanvasPlacementPassed: boolean
  mobileFocalPointPassed: boolean
  artificialInsetFrameFree: boolean
  sourceQualityPassed: boolean
  productCoverageRatio: number
  safeMarginRatio: number
  focalCenterOffsetRatio: number
  sourceUpscaleRatio: number
  detailSignalRatio: number
  artificialInsetFrameScore: number
  failureReasons: string[]
}

const OUTPUT_SIZE = 1600
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024
const SECONDARY_MINIMUM_COVERAGE = .68
const SECONDARY_MAXIMUM_COVERAGE = .82

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

async function detailSignalRatio(output: Buffer) {
  const { data, info } = await sharp(output).resize(128, 128, {
    fit: "fill",
  }).greyscale().raw().toBuffer({ resolveWithObject: true })
  let edges = 0
  let comparisons = 0
  for (let y = 0; y < info.height - 1; y += 1) {
    for (let x = 0; x < info.width - 1; x += 1) {
      const offset = y * info.width + x
      const delta = Math.max(
        Math.abs(data[offset] - data[offset + 1]),
        Math.abs(data[offset] - data[offset + info.width]),
      )
      if (delta >= 14) edges += 1
      comparisons += 1
    }
  }
  data.fill(0)
  return comparisons ? edges / comparisons : 0
}

/**
 * Detect the common failure where a rectangular supplier photo is placed as
 * a white "card" inside a second decorative canvas. It intentionally looks
 * only for a high-confidence light-neutral perimeter with a visibly different
 * outer ring; ordinary white product pixels and full-bleed white backgrounds
 * do not satisfy both conditions.
 */
async function artificialInsetFrameScore(output: Buffer) {
  const size = 256
  const { data, info } = await sharp(output).resize(size, size, {
    fit: "fill",
  }).removeAlpha().toColourspace("srgb").raw()
    .toBuffer({ resolveWithObject: true })
  const pixel = (x: number, y: number) => {
    const offset = (y * size + x) * info.channels
    return [data[offset], data[offset + 1], data[offset + 2]] as const
  }
  let best = 0
  const offset = Math.max(3, Math.round(size * .012))
  for (let marginX = 10; marginX <= 70; marginX += 3) {
    for (let marginY = 10; marginY <= 90; marginY += 3) {
      let lightNeutral = 0
      let samples = 0
      let outerDifference = 0
      const sample = (x: number, y: number, outerX: number, outerY: number) => {
        const current = pixel(x, y)
        const outer = pixel(outerX, outerY)
        const maximum = Math.max(...current)
        const minimum = Math.min(...current)
        if (minimum >= 238 && maximum - minimum <= 18) {
          lightNeutral += 1
        }
        outerDifference += (
          Math.abs(current[0] - outer[0]) +
          Math.abs(current[1] - outer[1]) +
          Math.abs(current[2] - outer[2])
        ) / 3
        samples += 1
      }
      for (let x = marginX; x < size - marginX; x += 2) {
        sample(x, marginY, x, Math.max(0, marginY - offset))
        sample(
          x,
          size - 1 - marginY,
          x,
          Math.min(size - 1, size - 1 - marginY + offset),
        )
      }
      for (let y = marginY + 2; y < size - marginY - 2; y += 2) {
        sample(marginX, y, Math.max(0, marginX - offset), y)
        sample(
          size - 1 - marginX,
          y,
          Math.min(size - 1, size - 1 - marginX + offset),
          y,
        )
      }
      const lightRatio = samples ? lightNeutral / samples : 0
      const difference = samples ? outerDifference / samples : 0
      if (lightRatio >= .68 && difference >= 8) {
        best = Math.max(best, lightRatio * difference)
      }
    }
  }
  data.fill(0)
  return best
}

export async function auditEbaySquareImagePresentation(input: {
  output: Buffer
  slot: string
  productCoverageRatio: number
  placement: { left: number; top: number; width: number; height: number }
  sourceEffectiveLongSide: number
  productPixelLongSide: number
  placedProductLongSide: number
  jpegQuality: number
  artificialFrameAdded: boolean
}) {
  const metadata = await sharp(input.output).metadata()
  const square1600Passed = metadata.format === "jpeg" &&
    metadata.width === OUTPUT_SIZE && metadata.height === OUTPUT_SIZE &&
    input.output.length > 20_000 && input.output.length <= MAX_OUTPUT_BYTES
  const jpegQualityProfilePassed = input.jpegQuality >= 90
  const main = input.slot === "MAIN_WHITE_BACKGROUND"
  const productFillPassed = main
    ? input.productCoverageRatio >= .75 && input.productCoverageRatio <= .85
    : input.productCoverageRatio >= SECONDARY_MINIMUM_COVERAGE &&
      input.productCoverageRatio <= SECONDARY_MAXIMUM_COVERAGE
  const right = OUTPUT_SIZE -
    (input.placement.left + input.placement.width)
  const bottom = OUTPUT_SIZE -
    (input.placement.top + input.placement.height)
  const safeMarginRatio = Math.min(
    input.placement.left,
    input.placement.top,
    right,
    bottom,
  ) / OUTPUT_SIZE
  const safeCanvasPlacementPassed = input.placement.left >= 0 &&
    input.placement.top >= 0 && right >= 0 && bottom >= 0 &&
    (main || safeMarginRatio >= .04)
  const centerX = input.placement.left + input.placement.width / 2
  const centerY = input.placement.top + input.placement.height / 2
  const focalCenterOffsetRatio = Math.hypot(
    centerX - OUTPUT_SIZE / 2,
    centerY - OUTPUT_SIZE / 2,
  ) / OUTPUT_SIZE
  const mobileFocalPointPassed = focalCenterOffsetRatio <= .14
  const sourceUpscaleRatio = input.productPixelLongSide > 0
    ? input.placedProductLongSide / input.productPixelLongSide
    : Number.POSITIVE_INFINITY
  const sourceQualityPassed = input.sourceEffectiveLongSide >= 1_100 &&
    sourceUpscaleRatio <= 1.25
  const [signal, insetScore] = await Promise.all([
    detailSignalRatio(input.output),
    main ? Promise.resolve(0) : artificialInsetFrameScore(input.output),
  ])
  // Pixel scoring is a secondary anomaly signal. The deterministic
  // transformation contract remains authoritative because reflective or
  // white products can naturally form bright rectangular edge patterns.
  const artificialInsetFrameFree = input.artificialFrameAdded === false &&
    insetScore < 32
  const detailPassed = signal >= .004
  const failureReasons = [
    !square1600Passed ? "EBAY_SQUARE_1600_INVALID" : null,
    !jpegQualityProfilePassed ? "EBAY_JPEG_QUALITY_INVALID" : null,
    !productFillPassed ? "EBAY_PRODUCT_FILL_INVALID" : null,
    !safeCanvasPlacementPassed ? "EBAY_SAFE_MARGIN_INVALID" : null,
    !mobileFocalPointPassed ? "EBAY_MOBILE_FOCAL_POINT_INVALID" : null,
    !artificialInsetFrameFree ? "EBAY_ARTIFICIAL_INSET_FRAME_DETECTED" : null,
    !sourceQualityPassed ? "EBAY_SOURCE_QUALITY_INSUFFICIENT" : null,
    !detailPassed ? "EBAY_DETAIL_SIGNAL_INSUFFICIENT" : null,
  ].filter((value): value is string => Boolean(value))
  return {
    version: EBAY_SQUARE_PRESENTATION_QA_VERSION,
    passed: failureReasons.length === 0,
    square1600Passed,
    jpegQualityProfilePassed,
    productFillPassed,
    safeCanvasPlacementPassed,
    mobileFocalPointPassed,
    artificialInsetFrameFree,
    sourceQualityPassed,
    productCoverageRatio: Number(
      clamp(input.productCoverageRatio, 0, 1).toFixed(4),
    ),
    safeMarginRatio: Number(safeMarginRatio.toFixed(4)),
    focalCenterOffsetRatio: Number(focalCenterOffsetRatio.toFixed(4)),
    sourceUpscaleRatio: Number(sourceUpscaleRatio.toFixed(4)),
    detailSignalRatio: Number(signal.toFixed(6)),
    artificialInsetFrameScore: Number(insetScore.toFixed(4)),
    failureReasons,
  } satisfies EbaySquarePresentationAudit
}
