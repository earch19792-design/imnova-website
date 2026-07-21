import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"

const unknownAware = <T extends [string, ...string[]]>(values: T) =>
  z.enum(values)

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
  supportingSignals: z.object({
    whiteOrNeutralPercent: z.number().min(0).max(100).nullable(),
    highCoveragePercent: z.number().min(0).max(100).nullable(),
    lowComplexityPercent: z.number().min(0).max(100).nullable(),
    lowOrNoTextOverlayPercent: z.number().min(0).max(100).nullable(),
    clearMultipackPercent: z.number().min(0).max(100).nullable(),
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
    .select("brief,confidence,sample_size")
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("capture_batch_id", captureBatchId)
    .eq("product_family_fingerprint", familyFingerprint)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error("SAME_DAY_IMAGE_MARKET_BRIEF_READ_FAILED")
  if (!data) return null

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
    supportingSignals: {
      whiteOrNeutralPercent: percent(signals.whiteOrNeutralPercent),
      highCoveragePercent: percent(signals.highCoveragePercent),
      lowComplexityPercent: percent(signals.lowComplexityPercent),
      lowOrNoTextOverlayPercent: percent(signals.lowOrNoTextOverlayPercent),
      clearMultipackPercent: percent(signals.clearMultipackPercent),
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
  ]
  return patternValues.some((value) => value !== "UNKNOWN")
    ? parsed.data
    : null
}
