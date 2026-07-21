import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"

const unknownAware = <T extends [string, ...string[]]>(values: T) =>
  z.enum(values)

export const EBAY_IMAGE_MARKET_BRIEF_VERSION =
  "VISUAL_MARKET_BRIEF_V2_2026_07_21"

export const ebayImageMarketBriefSchema = z.object({
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  sampleSize: z.number().int().min(1).max(500),
  dominantBackgroundType: unknownAware([
    "WHITE_OR_NEUTRAL", "COLORED", "LIFESTYLE_LIKELY", "MIXED", "UNKNOWN",
  ]),
  recommendedFrameCoverage: unknownAware(["LOW", "MEDIUM", "HIGH", "UNKNOWN"]),
  recommendedComplexity: unknownAware(["LOW", "MEDIUM", "HIGH", "UNKNOWN"]),
  packVisibilityPattern: unknownAware(["CLEAR", "PARTIAL", "UNCLEAR", "UNKNOWN"]),
  textOverlayPattern: unknownAware(["NONE", "LOW", "MEDIUM", "HIGH", "UNKNOWN"]),
  compositionPattern: unknownAware([
    "CENTERED", "LEFT_WEIGHTED", "RIGHT_WEIGHTED", "FULL_FRAME", "UNKNOWN",
  ]),
  recommendedCopySpace: unknownAware([
    "LEFT", "RIGHT", "TOP", "BOTTOM", "NONE", "UNKNOWN",
  ]).default("UNKNOWN"),
  contrastPattern: unknownAware(["LOW", "MEDIUM", "HIGH", "UNKNOWN"])
    .default("UNKNOWN"),
  brightnessPattern: unknownAware(["DARK", "MID", "LIGHT", "MIXED", "UNKNOWN"])
    .default("UNKNOWN"),
  palettePattern: unknownAware(["COOL", "NEUTRAL", "WARM", "MIXED", "UNKNOWN"])
    .default("UNKNOWN"),
  subjectGeometryPattern: unknownAware([
    "COMPACT", "WIDE", "TALL", "FULL", "UNKNOWN",
  ]).default("UNKNOWN"),
  primaryCohort: z.enum(["EXACT_PRODUCT", "FAMILY_FALLBACK"])
    .default("FAMILY_FALLBACK"),
  recencyWeightingApplied: z.boolean().default(false),
  supportingSignals: z.object({
    whiteOrNeutralPercent: z.number().min(0).max(100).nullable(),
    highCoveragePercent: z.number().min(0).max(100).nullable(),
    lowComplexityPercent: z.number().min(0).max(100).nullable(),
    lowOrNoTextOverlayPercent: z.number().min(0).max(100).nullable(),
    clearMultipackPercent: z.number().min(0).max(100).nullable(),
    usableCopySpacePercent: z.number().min(0).max(100).nullable().default(null),
    highContrastPercent: z.number().min(0).max(100).nullable().default(null),
    lightBrightnessPercent: z.number().min(0).max(100).nullable().default(null),
    neutralPalettePercent: z.number().min(0).max(100).nullable().default(null),
    recentObservationPercent: z.number().min(0).max(100).nullable().default(null),
  }).strict(),
}).strict()

export type EbayImageMarketBrief = z.infer<typeof ebayImageMarketBriefSchema>

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function percent(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
    ? parsed
    : null
}

function normalizedFamilyFingerprint(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : ""
  if (/^sha256:[0-9a-f]{64}$/.test(normalized)) return normalized
  if (/^[0-9a-f]{64}$/.test(normalized)) return `sha256:${normalized}`
  return null
}

function parsedStoredBrief(value: unknown): EbayImageMarketBrief | null {
  const data = record(value)
  const brief = record(data.brief)
  const signals = record(brief.supportingSignals)
  const parsed = ebayImageMarketBriefSchema.safeParse({
    confidence: data.confidence,
    sampleSize: Number(data.sample_size),
    dominantBackgroundType: brief.dominantBackgroundType,
    recommendedFrameCoverage: brief.recommendedFrameCoverage,
    recommendedComplexity: brief.recommendedComplexity,
    packVisibilityPattern: brief.packVisibilityPattern,
    textOverlayPattern: brief.textOverlayPattern,
    compositionPattern: brief.compositionPattern,
    recommendedCopySpace: brief.recommendedCopySpace,
    contrastPattern: brief.contrastPattern,
    brightnessPattern: brief.brightnessPattern,
    palettePattern: brief.palettePattern,
    subjectGeometryPattern: brief.subjectGeometryPattern,
    primaryCohort: brief.primaryCohort,
    recencyWeightingApplied: brief.recencyWeightingApplied,
    supportingSignals: {
      whiteOrNeutralPercent: percent(signals.whiteOrNeutralPercent),
      highCoveragePercent: percent(signals.highCoveragePercent),
      lowComplexityPercent: percent(signals.lowComplexityPercent),
      lowOrNoTextOverlayPercent: percent(signals.lowOrNoTextOverlayPercent),
      clearMultipackPercent: percent(signals.clearMultipackPercent),
      usableCopySpacePercent: percent(signals.usableCopySpacePercent),
      highContrastPercent: percent(signals.highContrastPercent),
      lightBrightnessPercent: percent(signals.lightBrightnessPercent),
      neutralPalettePercent: percent(signals.neutralPalettePercent),
      recentObservationPercent: percent(signals.recentObservationPercent),
    },
  })
  if (!parsed.success) return null
  const patternValues = [
    parsed.data.dominantBackgroundType,
    parsed.data.recommendedFrameCoverage,
    parsed.data.recommendedComplexity,
    parsed.data.packVisibilityPattern,
    parsed.data.textOverlayPattern,
    parsed.data.compositionPattern,
    parsed.data.recommendedCopySpace,
    parsed.data.contrastPattern,
    parsed.data.brightnessPattern,
    parsed.data.palettePattern,
    parsed.data.subjectGeometryPattern,
  ]
  return patternValues.some((entry) => entry !== "UNKNOWN")
    ? parsed.data
    : null
}

/**
 * Exact candidate-family evidence wins. If seller wording produced different
 * normalized fingerprints, use only a self-consistent FAMILY_FALLBACK cohort
 * from the same capture batch. The database query orders fallback cohorts by
 * sample size and recency before this selector runs.
 */
export function selectCaptureBoundEbayImageMarketBrief(
  values: unknown,
  expectedFamilyFingerprint: unknown,
) {
  const expected = normalizedFamilyFingerprint(expectedFamilyFingerprint)
  if (!expected || !Array.isArray(values)) return null
  const rows = values.map(record)
  const exact = rows.find((row) =>
    normalizedFamilyFingerprint(row.product_family_fingerprint) === expected)
  const parsedExact = exact ? parsedStoredBrief(exact) : null
  if (parsedExact) return parsedExact

  for (const row of rows) {
    const fingerprint = normalizedFamilyFingerprint(row.product_family_fingerprint)
    const brief = record(row.brief)
    if (!fingerprint
      || brief.primaryCohort !== "FAMILY_FALLBACK"
      || normalizedFamilyFingerprint(brief.productBaseFingerprint) !== fingerprint) continue
    const parsed = parsedStoredBrief(row)
    if (parsed) return parsed
  }
  return null
}

/**
 * Reads only the allow-listed aggregate visual signals. Seller identities,
 * titles, URLs, thumbnails and image bytes never cross this boundary.
 */
export async function loadEbayImageMarketBrief(input: {
  supabase: SupabaseClient
  accountKey: string
  captureBatchId: unknown
  familyFingerprint: unknown
}): Promise<EbayImageMarketBrief | null> {
  const captureBatchId = typeof input.captureBatchId === "string"
    && /^[0-9a-f-]{36}$/i.test(input.captureBatchId.trim())
    ? input.captureBatchId.trim()
    : null
  const familyFingerprint = normalizedFamilyFingerprint(input.familyFingerprint)
  if (!captureBatchId || !familyFingerprint) return null

  const { data, error } = await input.supabase
    .from("marketplace_product_research_visual_market_briefs")
    .select("brief,confidence,sample_size,product_family_fingerprint,created_at")
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("capture_batch_id", captureBatchId)
    .eq("visual_market_brief_version", EBAY_IMAGE_MARKET_BRIEF_VERSION)
    .order("sample_size", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(20)
  if (error) throw new Error("SAME_DAY_IMAGE_MARKET_BRIEF_READ_FAILED")
  return selectCaptureBoundEbayImageMarketBrief(data, familyFingerprint)
}
