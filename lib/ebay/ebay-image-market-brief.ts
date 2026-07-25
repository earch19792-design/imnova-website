import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"

const unknownAware = <T extends [string, ...string[]]>(values: T) =>
  z.enum(values)

export const EBAY_IMAGE_MARKET_BRIEF_VERSION =
  "VISUAL_MARKET_BRIEF_V2_2026_07_21"

export const EBAY_IMAGE_MARKET_EVIDENCE_POLICY_VERSION =
  "MARKET_TO_VISUAL_EVIDENCE_POLICY_V1_2026_07_24"

export const ebayImageMarketEvidenceTierSchema = z.enum([
  "A_EXACT_PRODUCT",
  "B_PRODUCT_FAMILY",
  "C_CATEGORY",
])

export const ebayImageMarketBriefSchema = z.object({
  visualMarketBriefVersion: z.literal(EBAY_IMAGE_MARKET_BRIEF_VERSION)
    .optional(),
  observedAt: z.string().datetime().optional(),
  freshUntil: z.string().datetime().optional(),
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
  dominantPresentationType: unknownAware([
    "PRODUCT_ONLY", "MULTIPACK_LIKELY", "PRODUCT_WITH_PACKAGING",
    "LIFESTYLE_LIKELY", "MIXED", "UNKNOWN",
  ]).default("UNKNOWN"),
  primaryCohort: z.enum([
    "EXACT_PRODUCT", "FAMILY_FALLBACK", "CATEGORY_FALLBACK",
  ])
    .default("FAMILY_FALLBACK"),
  marketEvidenceTier: ebayImageMarketEvidenceTierSchema
    .default("C_CATEGORY"),
  exactProductEvidenceCount: z.number().int().min(0).max(500).default(0),
  productFamilyEvidenceCount: z.number().int().min(0).max(500).default(0),
  categoryEvidenceCount: z.number().int().min(0).max(500).default(0),
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
export type EbayImageMarketEvidenceTier = z.infer<
  typeof ebayImageMarketEvidenceTierSchema
>

export type EbayImageMarketEvidencePolicy = {
  version: typeof EBAY_IMAGE_MARKET_EVIDENCE_POLICY_VERSION
  tier: EbayImageMarketEvidenceTier
  influenceScope: "PRODUCT_SPECIFIC_COMMERCIAL_DIRECTION" |
    "PRODUCT_FAMILY_COMMERCIAL_DIRECTION" |
    "GENERAL_CATEGORY_ART_DIRECTION" |
    "PROFESSIONAL_FALLBACK_ONLY"
  evidenceCount: number
  minimumEvidenceCount: number
  exactProductMarketEvidenceInsufficient: boolean
  commercialRolePrioritizationAllowed: boolean
  allowedUses: Array<
    "BACKGROUND" | "LIGHTING" | "FRAME_COVERAGE" | "COMPOSITION" |
    "PALETTE" | "CONTEXT_STYLE" | "COMMERCIAL_ROLE_PRIORITY"
  >
  prohibitedUses: [
    "PRODUCT_IDENTITY",
    "COMPATIBILITY",
    "GEOMETRY",
    "INCLUDED_ACCESSORIES",
    "DIMENSIONS",
    "MATERIALS",
    "PERFORMANCE_CLAIMS",
    "PACKAGE_CONTENTS",
  ]
  productFactsAllowedFromMarketEvidence: false
}

type JsonRecord = Record<string, unknown>
type WeightedFallbackBrief = {
  fingerprint: string
  brief: EbayImageMarketBrief
}

const SUPPORTING_SIGNAL_KEYS = [
  "whiteOrNeutralPercent",
  "highCoveragePercent",
  "lowComplexityPercent",
  "lowOrNoTextOverlayPercent",
  "clearMultipackPercent",
  "usableCopySpacePercent",
  "highContrastPercent",
  "lightBrightnessPercent",
  "neutralPalettePercent",
  "recentObservationPercent",
] as const

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

function parsedStoredBrief(
  value: unknown,
  evidenceTierOverride?: EbayImageMarketEvidenceTier,
): EbayImageMarketBrief | null {
  const data = record(value)
  const brief = record(data.brief)
  const signals = record(brief.supportingSignals)
  const sampleSize = Number(data.sample_size)
  const primaryCohort = brief.primaryCohort
  const evidenceTier = evidenceTierOverride ??
    (primaryCohort === "EXACT_PRODUCT"
      ? "A_EXACT_PRODUCT"
      : "C_CATEGORY")
  const exactProductEvidenceCount = evidenceTier === "A_EXACT_PRODUCT"
    ? Math.max(0, Math.min(500,
      Number.isInteger(Number(brief.exactCohortSize))
        ? Number(brief.exactCohortSize)
        : sampleSize))
    : 0
  const productFamilyEvidenceCount = evidenceTier === "B_PRODUCT_FAMILY"
    ? Math.max(0, Math.min(500, sampleSize))
    : 0
  const categoryEvidenceCount = evidenceTier === "C_CATEGORY"
    ? Math.max(0, Math.min(500, sampleSize))
    : 0
  const observedAt = typeof data.created_at === "string" &&
    Number.isFinite(Date.parse(data.created_at))
    ? new Date(data.created_at).toISOString()
    : null
  const freshUntil = observedAt
    ? new Date(Date.parse(observedAt) + 30 * 24 * 60 * 60 * 1_000).toISOString()
    : null
  const parsed = ebayImageMarketBriefSchema.safeParse({
    visualMarketBriefVersion: EBAY_IMAGE_MARKET_BRIEF_VERSION,
    ...(observedAt && freshUntil ? { observedAt, freshUntil } : {}),
    confidence: data.confidence,
    sampleSize,
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
    dominantPresentationType: brief.dominantPresentationType,
    primaryCohort,
    marketEvidenceTier: evidenceTier,
    exactProductEvidenceCount,
    productFamilyEvidenceCount,
    categoryEvidenceCount,
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
    parsed.data.dominantPresentationType,
  ]
  return patternValues.some((entry) => entry !== "UNKNOWN")
    ? parsed.data
    : null
}

function weightedMode<T extends string>(
  values: WeightedFallbackBrief[],
  select: (brief: EbayImageMarketBrief) => T,
  fallback: T,
) {
  const weights = new Map<T, number>()
  for (const value of values) {
    const selected = select(value.brief)
    weights.set(selected, (weights.get(selected) ?? 0) + value.brief.sampleSize)
  }
  return [...weights.entries()]
    .sort(([left, leftWeight], [right, rightWeight]) =>
      rightWeight - leftWeight || left.localeCompare(right))[0]?.[0] ?? fallback
}

function weightedPercent(
  values: WeightedFallbackBrief[],
  key: typeof SUPPORTING_SIGNAL_KEYS[number],
) {
  let weightedTotal = 0
  let totalWeight = 0
  for (const value of values) {
    const signal = value.brief.supportingSignals[key]
    if (signal === null) continue
    weightedTotal += signal * value.brief.sampleSize
    totalWeight += value.brief.sampleSize
  }
  return totalWeight > 0
    ? Math.round(weightedTotal / totalWeight * 100) / 100
    : null
}

/**
 * A prepared Product Research query can contain many legitimate seller-title
 * variants for one product family. The visual analyzer intentionally keeps
 * those identity cohorts separate, but that can leave every cohort below the
 * confidence threshold even when the capture contains enough independent
 * visual observations. Aggregate only disjoint, self-consistent fallback
 * cohorts from this one capture batch. The result is capped at MEDIUM and is
 * scenery guidance only; it cannot establish product identity or claims.
 */
function aggregateCaptureQueryFamilyFallbacks(
  values: WeightedFallbackBrief[],
): EbayImageMarketBrief | null {
  const byFingerprint = new Map<string, WeightedFallbackBrief>()
  for (const value of values) {
    const existing = byFingerprint.get(value.fingerprint)
    if (!existing || value.brief.sampleSize > existing.brief.sampleSize) {
      byFingerprint.set(value.fingerprint, value)
    }
  }
  const cohorts = [...byFingerprint.values()]
  const totalSampleSize = cohorts.reduce(
    (sum, value) => sum + value.brief.sampleSize,
    0,
  )
  if (cohorts.length < 3 || totalSampleSize < 6) return null

  const observedTimes = cohorts.map((value) =>
    Date.parse(value.brief.observedAt ?? "")).filter(Number.isFinite)
  const freshUntilTimes = cohorts.map((value) =>
    Date.parse(value.brief.freshUntil ?? "")).filter(Number.isFinite)
  const hasCompleteTimeBinding = observedTimes.length === cohorts.length &&
    freshUntilTimes.length === cohorts.length
  const supportingSignals = Object.fromEntries(SUPPORTING_SIGNAL_KEYS.map((key) =>
    [key, weightedPercent(cohorts, key)])) as EbayImageMarketBrief["supportingSignals"]
  const parsed = ebayImageMarketBriefSchema.safeParse({
    visualMarketBriefVersion: EBAY_IMAGE_MARKET_BRIEF_VERSION,
    ...(hasCompleteTimeBinding
      ? {
          observedAt: new Date(Math.max(...observedTimes)).toISOString(),
          freshUntil: new Date(Math.min(...freshUntilTimes)).toISOString(),
        }
      : {}),
    confidence: "MEDIUM",
    sampleSize: Math.min(500, totalSampleSize),
    dominantBackgroundType: weightedMode(
      cohorts,
      (brief) => brief.dominantBackgroundType,
      "UNKNOWN",
    ),
    recommendedFrameCoverage: weightedMode(
      cohorts,
      (brief) => brief.recommendedFrameCoverage,
      "UNKNOWN",
    ),
    recommendedComplexity: weightedMode(
      cohorts,
      (brief) => brief.recommendedComplexity,
      "UNKNOWN",
    ),
    packVisibilityPattern: weightedMode(
      cohorts,
      (brief) => brief.packVisibilityPattern,
      "UNKNOWN",
    ),
    textOverlayPattern: weightedMode(
      cohorts,
      (brief) => brief.textOverlayPattern,
      "UNKNOWN",
    ),
    compositionPattern: weightedMode(
      cohorts,
      (brief) => brief.compositionPattern,
      "UNKNOWN",
    ),
    recommendedCopySpace: weightedMode(
      cohorts,
      (brief) => brief.recommendedCopySpace,
      "UNKNOWN",
    ),
    contrastPattern: weightedMode(
      cohorts,
      (brief) => brief.contrastPattern,
      "UNKNOWN",
    ),
    brightnessPattern: weightedMode(
      cohorts,
      (brief) => brief.brightnessPattern,
      "UNKNOWN",
    ),
    palettePattern: weightedMode(
      cohorts,
      (brief) => brief.palettePattern,
      "UNKNOWN",
    ),
    subjectGeometryPattern: weightedMode(
      cohorts,
      (brief) => brief.subjectGeometryPattern,
      "UNKNOWN",
    ),
    dominantPresentationType: weightedMode(
      cohorts,
      (brief) => brief.dominantPresentationType,
      "UNKNOWN",
    ),
    primaryCohort: "CATEGORY_FALLBACK",
    marketEvidenceTier: "C_CATEGORY",
    exactProductEvidenceCount: 0,
    productFamilyEvidenceCount: 0,
    categoryEvidenceCount: Math.min(500, totalSampleSize),
    recencyWeightingApplied: cohorts.every((value) =>
      value.brief.recencyWeightingApplied),
    supportingSignals,
  })
  if (!parsed.success) return null
  return parsed.data
}

export function resolveEbayImageMarketEvidencePolicy(
  brief: EbayImageMarketBrief | null,
): EbayImageMarketEvidencePolicy {
  const prohibitedUses = [
    "PRODUCT_IDENTITY",
    "COMPATIBILITY",
    "GEOMETRY",
    "INCLUDED_ACCESSORIES",
    "DIMENSIONS",
    "MATERIALS",
    "PERFORMANCE_CLAIMS",
    "PACKAGE_CONTENTS",
  ] as const
  if (!brief) {
    return {
      version: EBAY_IMAGE_MARKET_EVIDENCE_POLICY_VERSION,
      tier: "C_CATEGORY",
      influenceScope: "PROFESSIONAL_FALLBACK_ONLY",
      evidenceCount: 0,
      minimumEvidenceCount: 6,
      exactProductMarketEvidenceInsufficient: true,
      commercialRolePrioritizationAllowed: false,
      allowedUses: [],
      prohibitedUses: [...prohibitedUses],
      productFactsAllowedFromMarketEvidence: false,
    }
  }
  const tier = brief.primaryCohort === "EXACT_PRODUCT"
    ? "A_EXACT_PRODUCT"
    : brief.marketEvidenceTier === "B_PRODUCT_FAMILY" &&
        brief.primaryCohort === "FAMILY_FALLBACK"
      ? "B_PRODUCT_FAMILY"
      : "C_CATEGORY"
  const evidenceCount = tier === "A_EXACT_PRODUCT"
    ? brief.exactProductEvidenceCount || brief.sampleSize
    : tier === "B_PRODUCT_FAMILY"
      ? brief.productFamilyEvidenceCount || brief.sampleSize
      : brief.categoryEvidenceCount || brief.sampleSize
  const minimumEvidenceCount = tier === "C_CATEGORY" ? 6 : 5
  const sufficientlySupported = brief.confidence !== "LOW" &&
    evidenceCount >= minimumEvidenceCount
  const exactProductMarketEvidenceInsufficient =
    tier !== "A_EXACT_PRODUCT" || evidenceCount < 5
  const allowedUses = tier === "C_CATEGORY"
    ? [
        "BACKGROUND", "LIGHTING", "FRAME_COVERAGE", "COMPOSITION", "PALETTE",
      ] as const
    : [
        "BACKGROUND", "LIGHTING", "FRAME_COVERAGE", "COMPOSITION", "PALETTE",
        "CONTEXT_STYLE", "COMMERCIAL_ROLE_PRIORITY",
      ] as const
  return {
    version: EBAY_IMAGE_MARKET_EVIDENCE_POLICY_VERSION,
    tier,
    influenceScope: !sufficientlySupported
      ? "PROFESSIONAL_FALLBACK_ONLY"
      : tier === "A_EXACT_PRODUCT"
        ? "PRODUCT_SPECIFIC_COMMERCIAL_DIRECTION"
        : tier === "B_PRODUCT_FAMILY"
          ? "PRODUCT_FAMILY_COMMERCIAL_DIRECTION"
          : "GENERAL_CATEGORY_ART_DIRECTION",
    evidenceCount,
    minimumEvidenceCount,
    exactProductMarketEvidenceInsufficient,
    commercialRolePrioritizationAllowed: sufficientlySupported &&
      tier !== "C_CATEGORY",
    allowedUses: sufficientlySupported ? [...allowedUses] : [],
    prohibitedUses: [...prohibitedUses],
    productFactsAllowedFromMarketEvidence: false,
  }
}

export function isEbayImageMarketBriefUsable(
  brief: EbayImageMarketBrief | null,
  now = new Date(),
) {
  const nowMs = now.getTime()
  const observedAt = Date.parse(brief?.observedAt ?? "")
  const freshUntil = Date.parse(brief?.freshUntil ?? "")
  const policy = resolveEbayImageMarketEvidencePolicy(brief)
  return Boolean(brief && brief.confidence !== "LOW" &&
    policy.influenceScope !== "PROFESSIONAL_FALLBACK_ONLY" &&
    brief.recencyWeightingApplied &&
    (brief.supportingSignals.recentObservationPercent ?? 0) >= 25 &&
    Number.isFinite(observedAt) && observedAt <= nowMs &&
    Number.isFinite(freshUntil) && freshUntil > nowMs)
}

/**
 * Exact candidate-family evidence wins. If seller wording produced different
 * normalized fingerprints, prefer one usable self-consistent FAMILY_FALLBACK
 * cohort from the same capture batch. If seller wording fragmented otherwise
 * valid evidence into several small cohorts, combine only those disjoint
 * capture-bound fallbacks under the conservative query-family rule above.
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
  const exactPrimaryCohort = record(exact?.brief).primaryCohort
  const parsedExact = exact ? parsedStoredBrief(
    exact,
    exactPrimaryCohort === "EXACT_PRODUCT"
      ? "A_EXACT_PRODUCT"
      : "B_PRODUCT_FAMILY",
  ) : null
  if (parsedExact) return parsedExact

  const fallbackBriefs: WeightedFallbackBrief[] = []
  for (const row of rows) {
    const fingerprint = normalizedFamilyFingerprint(row.product_family_fingerprint)
    const brief = record(row.brief)
    if (!fingerprint
      || brief.primaryCohort !== "FAMILY_FALLBACK"
      || normalizedFamilyFingerprint(brief.productBaseFingerprint) !== fingerprint) continue
    const parsed = parsedStoredBrief(row, "B_PRODUCT_FAMILY")
    if (parsed) fallbackBriefs.push({ fingerprint, brief: parsed })
  }
  return aggregateCaptureQueryFamilyFallbacks(fallbackBriefs)
    ?? null
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
