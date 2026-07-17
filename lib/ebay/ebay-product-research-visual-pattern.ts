import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

export const PRODUCT_RESEARCH_VISUAL_PATTERN_SCHEMA_VERSION =
  "PRODUCT_RESEARCH_VISUAL_PATTERN_V1_2026_07_17"
export const PRODUCT_RESEARCH_VISUAL_PATTERN_ALGORITHM_VERSION =
  "PR_VISIBLE_THUMBNAIL_LOCAL_V1"
export const VISUAL_MARKET_BRIEF_VERSION = "VISUAL_MARKET_BRIEF_V1_2026_07_17"

type JsonRecord = Record<string, unknown>

export type VisualAnalysisStatus = "ANALYZED" | "PARTIAL" | "UNAVAILABLE" | "REJECTED"
type Confidence = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"
type Bucket = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN"
type Presence = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN"
type Background = "WHITE_OR_NEUTRAL" | "COLORED" | "LIFESTYLE_LIKELY" | "MIXED" | "UNKNOWN"
type Presentation = "PRODUCT_ONLY" | "MULTIPACK_LIKELY" | "PRODUCT_WITH_PACKAGING" |
  "LIFESTYLE_LIKELY" | "MIXED" | "UNKNOWN"
type Composition = "CENTERED" | "LEFT_WEIGHTED" | "RIGHT_WEIGHTED" | "FULL_FRAME" | "UNKNOWN"

export type ProductResearchVisualPattern = {
  imagePresent: boolean
  thumbnailAspectRatio: number | null
  thumbnailResolutionBucket: Bucket
  backgroundType: Background
  backgroundConfidence: Confidence
  frameCoverage: Bucket
  visualComplexity: Bucket
  textOverlayLikelihood: Presence
  badgeOrCalloutLikelihood: Presence
  presentationType: Presentation
  productCountVisible: number | null
  packClarity: "CLEAR" | "PARTIAL" | "UNCLEAR" | "UNKNOWN"
  dominantComposition: Composition
  visualPatternConfidence: Confidence
  analysisStatus: VisualAnalysisStatus
  algorithmVersion: string
  analyzedAt: string
  evidence: {
    visual: { presentationType: Presentation; confidence: Confidence }
    titleDerived: { detectedPackCount: number | null; detectedUnitCount: number | null }
    combinedConclusion: { presentationType: Presentation; confidence: Confidence; basis: string[] }
  }
}

export type VisualComparableRow = {
  evidenceDeduplicationKey: string
  identityHash: string
  productFamilyFingerprint: string
  matchClassification: string
  detectedOfferPackCount: number | null
  confirmedSoldQuantity: number
  visualPattern: ProductResearchVisualPattern
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 120) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum) : ""
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(
    typeof value === "string" ? value : JSON.stringify(value),
  ).digest("hex")}`
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? value as T : fallback
}

function nullableNumber(value: unknown, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null
}

function nullableInteger(value: unknown, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null
}

function safeTimestamp(value: unknown, fallback: Date) {
  const parsed = new Date(typeof value === "string" ? value : "")
  return Number.isFinite(parsed.getTime()) && parsed.getTime() <= Date.now() + 300_000
    ? parsed.toISOString() : fallback.toISOString()
}

function containsForbiddenVisualContent(value: unknown, depth = 0): boolean {
  if (depth > 8) return true
  if (typeof value === "string") return /(?:data:image|https?:|\/\/|base64|blob:|<img|<html|<svg)/i.test(value)
  if (!value || typeof value !== "object") return false
  return Object.entries(value as JsonRecord).some(([key, entry]) =>
    /(url|src|base64|blob|screenshot|imagebytes|imagedata|pixels?|canvas|buffer|binary|rawhtml|html)/i.test(key) ||
      containsForbiddenVisualContent(entry, depth + 1))
}

export function sanitizeProductResearchVisualPattern(value: unknown, now = new Date()): ProductResearchVisualPattern | null {
  if (!value || typeof value !== "object" || containsForbiddenVisualContent(value)) return null
  const source = record(value)
  const evidence = record(source.evidence)
  const visual = record(evidence.visual)
  const titleDerived = record(evidence.titleDerived)
  const combined = record(evidence.combinedConclusion)
  const confidence = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const
  const bucket = ["LOW", "MEDIUM", "HIGH", "UNKNOWN"] as const
  const presence = ["NONE", "LOW", "MEDIUM", "HIGH", "UNKNOWN"] as const
  const background = ["WHITE_OR_NEUTRAL", "COLORED", "LIFESTYLE_LIKELY", "MIXED", "UNKNOWN"] as const
  const presentation = ["PRODUCT_ONLY", "MULTIPACK_LIKELY", "PRODUCT_WITH_PACKAGING", "LIFESTYLE_LIKELY", "MIXED", "UNKNOWN"] as const
  const composition = ["CENTERED", "LEFT_WEIGHTED", "RIGHT_WEIGHTED", "FULL_FRAME", "UNKNOWN"] as const
  const status = ["ANALYZED", "PARTIAL", "UNAVAILABLE", "REJECTED"] as const
  const packClarity = ["CLEAR", "PARTIAL", "UNCLEAR", "UNKNOWN"] as const
  const algorithmVersion = text(source.algorithmVersion, 100)
  if (!/^[A-Z0-9._-]{3,100}$/.test(algorithmVersion)) return null
  const detectedPackCount = nullableInteger(titleDerived.detectedPackCount, 1, 999)
  const detectedUnitCount = nullableInteger(titleDerived.detectedUnitCount, 1, 99_999)
  const visualPresentation = enumValue(visual.presentationType, presentation, "UNKNOWN")
  const visualConfidence = enumValue(visual.confidence, confidence, "UNKNOWN")
  const combinedPresentation = enumValue(combined.presentationType, presentation, "UNKNOWN")
  const combinedConfidence = enumValue(combined.confidence, confidence, "UNKNOWN")
  const basis = (Array.isArray(combined.basis) ? combined.basis : []).map((entry) => text(entry, 32))
    .filter((entry) => ["VISUAL", "TITLE_DERIVED", "STRUCTURAL"].includes(entry)).slice(0, 3)
  return {
    imagePresent: source.imagePresent === true,
    thumbnailAspectRatio: nullableNumber(source.thumbnailAspectRatio, .1, 10),
    thumbnailResolutionBucket: enumValue(source.thumbnailResolutionBucket, bucket, "UNKNOWN"),
    backgroundType: enumValue(source.backgroundType, background, "UNKNOWN"),
    backgroundConfidence: enumValue(source.backgroundConfidence, confidence, "UNKNOWN"),
    frameCoverage: enumValue(source.frameCoverage, bucket, "UNKNOWN"),
    visualComplexity: enumValue(source.visualComplexity, bucket, "UNKNOWN"),
    textOverlayLikelihood: enumValue(source.textOverlayLikelihood, presence, "UNKNOWN"),
    badgeOrCalloutLikelihood: enumValue(source.badgeOrCalloutLikelihood, presence, "UNKNOWN"),
    presentationType: enumValue(source.presentationType, presentation, "UNKNOWN"),
    productCountVisible: nullableInteger(source.productCountVisible, 1, 99),
    packClarity: enumValue(source.packClarity, packClarity, "UNKNOWN"),
    dominantComposition: enumValue(source.dominantComposition, composition, "UNKNOWN"),
    visualPatternConfidence: enumValue(source.visualPatternConfidence, confidence, "UNKNOWN"),
    analysisStatus: enumValue(source.analysisStatus, status, "REJECTED"),
    algorithmVersion,
    analyzedAt: safeTimestamp(source.analyzedAt, now),
    evidence: {
      visual: { presentationType: visualPresentation, confidence: visualConfidence },
      titleDerived: { detectedPackCount, detectedUnitCount },
      combinedConclusion: { presentationType: combinedPresentation, confidence: combinedConfidence, basis },
    },
  }
}

export function rejectedProductResearchVisualPattern(input: {
  detectedPackCount: number | null
  detectedUnitCount: number | null
  analyzedAt: Date
}): ProductResearchVisualPattern {
  return {
    imagePresent: false, thumbnailAspectRatio: null, thumbnailResolutionBucket: "UNKNOWN",
    backgroundType: "UNKNOWN", backgroundConfidence: "UNKNOWN", frameCoverage: "UNKNOWN",
    visualComplexity: "UNKNOWN", textOverlayLikelihood: "UNKNOWN", badgeOrCalloutLikelihood: "UNKNOWN",
    presentationType: "UNKNOWN", productCountVisible: null, packClarity: "UNKNOWN",
    dominantComposition: "UNKNOWN", visualPatternConfidence: "UNKNOWN", analysisStatus: "REJECTED",
    algorithmVersion: PRODUCT_RESEARCH_VISUAL_PATTERN_ALGORITHM_VERSION,
    analyzedAt: input.analyzedAt.toISOString(),
    evidence: {
      visual: { presentationType: "UNKNOWN", confidence: "UNKNOWN" },
      titleDerived: { detectedPackCount: input.detectedPackCount, detectedUnitCount: input.detectedUnitCount },
      combinedConclusion: { presentationType: "UNKNOWN", confidence: "UNKNOWN", basis: [] },
    },
  }
}

function mode<T extends string>(values: T[], fallback: T) {
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort(([left, leftCount], [right, rightCount]) =>
    rightCount - leftCount || left.localeCompare(right))[0]?.[0] ?? fallback
}

function percentage(rows: VisualComparableRow[], predicate: (row: VisualComparableRow) => boolean) {
  return rows.length ? Math.round(rows.filter(predicate).length / rows.length * 100) : 0
}

function aggregateConfidence(rows: VisualComparableRow[], exactCount: number): Confidence {
  const analyzed = rows.filter((row) => row.visualPattern.analysisStatus === "ANALYZED").length
  if (rows.length >= 16 && analyzed / rows.length >= .75 && exactCount >= 4) return "HIGH"
  if (rows.length >= 6 && analyzed / rows.length >= .5) return "MEDIUM"
  return rows.length ? "LOW" : "UNKNOWN"
}

export function buildVisualMarketBriefs(rows: VisualComparableRow[], context: {
  queryContextHash: string
  captureRunId: string | null
  categoryId: string | null
  capturedAt: string
}) {
  const usable = rows.filter((row) => ["ANALYZED", "PARTIAL"].includes(row.visualPattern.analysisStatus))
  const groups = new Map<string, VisualComparableRow[]>()
  for (const row of usable) groups.set(row.productFamilyFingerprint,
    [...(groups.get(row.productFamilyFingerprint) ?? []), row])
  return [...groups.entries()].map(([productFamilyFingerprint, group]) => {
    const sorted = [...group].sort((left, right) => right.confirmedSoldQuantity - left.confirmedSoldQuantity)
    const topCount = Math.max(1, Math.ceil(sorted.length / 4))
    const topQuartile = sorted.slice(0, topCount)
    const remainder = sorted.slice(topCount)
    const exact = group.filter((row) => row.matchClassification === "EXACT_LUNA_MATCH")
    const relatedPack = group.filter((row) => row.matchClassification === "SAME_PRODUCT_DIFFERENT_PACK")
    const relatedSize = group.filter((row) => row.matchClassification === "SAME_PRODUCT_DIFFERENT_SIZE")
    const dominantBackgroundType = mode(group.map((row) => row.visualPattern.backgroundType), "UNKNOWN" as Background)
    const recommendedFrameCoverage = mode(topQuartile.map((row) => row.visualPattern.frameCoverage), "UNKNOWN" as Bucket)
    const recommendedComplexity = mode(topQuartile.map((row) => row.visualPattern.visualComplexity), "UNKNOWN" as Bucket)
    const packVisibilityPattern = mode(topQuartile.map((row) => row.visualPattern.packClarity), "UNKNOWN" as "CLEAR" | "PARTIAL" | "UNCLEAR" | "UNKNOWN")
    const textOverlayPattern = mode(topQuartile.map((row) => row.visualPattern.textOverlayLikelihood), "UNKNOWN" as Presence)
    const compositionPattern = mode(topQuartile.map((row) => row.visualPattern.dominantComposition), "UNKNOWN" as Composition)
    const confidence = aggregateConfidence(group, exact.length)
    return {
      productFamilyFingerprint,
      productBaseFingerprint: productFamilyFingerprint,
      categoryId: context.categoryId,
      exactCohortSize: exact.length,
      relatedPackCohortSize: relatedPack.length,
      relatedSizeCohortSize: relatedSize.length,
      dominantBackgroundType,
      recommendedFrameCoverage,
      recommendedComplexity,
      packVisibilityPattern,
      textOverlayPattern,
      compositionPattern,
      supportingSignals: {
        sampleSize: group.length,
        topQuartileSize: topQuartile.length,
        remainderSize: remainder.length,
        whiteOrNeutralPercent: percentage(group, (row) => row.visualPattern.backgroundType === "WHITE_OR_NEUTRAL"),
        highCoveragePercent: percentage(group, (row) => row.visualPattern.frameCoverage === "HIGH"),
        lowComplexityPercent: percentage(group, (row) => row.visualPattern.visualComplexity === "LOW"),
        lowOrNoTextOverlayPercent: percentage(group, (row) => ["NONE", "LOW"].includes(row.visualPattern.textOverlayLikelihood)),
        clearMultipackPercent: percentage(group, (row) => row.visualPattern.presentationType === "MULTIPACK_LIKELY" && row.visualPattern.packClarity === "CLEAR"),
        topQuartileWhiteOrNeutralPercent: percentage(topQuartile, (row) => row.visualPattern.backgroundType === "WHITE_OR_NEUTRAL"),
      },
      conflictingSignals: {
        coloredOrLifestylePercent: percentage(group, (row) => ["COLORED", "LIFESTYLE_LIKELY", "MIXED"].includes(row.visualPattern.backgroundType)),
        unavailableOrUnknownPercent: percentage(rows.filter((row) => row.productFamilyFingerprint === productFamilyFingerprint), (row) =>
          ["UNAVAILABLE", "REJECTED"].includes(row.visualPattern.analysisStatus)),
      },
      cohortComparison: {
        exact: exact.length,
        relatedPack: relatedPack.length,
        relatedSize: relatedSize.length,
        salesRange: "TOP_QUARTILE_VS_REST",
        queryContextHash: context.queryContextHash,
      },
      confidence,
      prohibitedConclusions: [
        "VISUAL_PATTERN_DOES_NOT_PROVE_CAUSALITY",
        "VISUAL_PATTERN_DOES_NOT_PROVE_DEMAND",
        "DO_NOT_COPY_COMPETITOR_IMAGES",
      ],
      generatedAt: new Date().toISOString(),
      version: VISUAL_MARKET_BRIEF_VERSION,
      capturePeriod: context.capturedAt,
      captureRunId: context.captureRunId,
    }
  })
}

export async function persistProductResearchVisualPatterns(input: {
  supabase: SupabaseClient
  accountKey: string
  captureBatchId: string
  captureRunId: string | null
  queryContextHash: string
  categoryId: string | null
  capturedAt: string
  rows: VisualComparableRow[]
}) {
  const keys = [...new Set(input.rows.map((row) => row.evidenceDeduplicationKey))]
  if (!keys.length) return { captureSupported: false, thumbnailDetectedCount: 0, analyzedCount: 0,
    partialCount: 0, unavailableCount: 0, rejectedCount: 0, persistedCount: 0,
    existingVisualCount: 0, visualBriefs: [], error: null }
  const { data: observations, error: observationError } = await input.supabase
    .from("marketplace_product_research_capture_observations")
    .select("id,evidence_deduplication_key").eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US").in("evidence_deduplication_key", keys)
  if (observationError) throw new Error("PRODUCT_RESEARCH_VISUAL_OBSERVATION_LOOKUP_FAILED")
  const observationByKey = new Map((observations ?? []).map((observation) => [
    observation.evidence_deduplication_key, observation.id,
  ]))
  const observationIds = [...observationByKey.values()]
  const { data: existing, error: existingError } = observationIds.length
    ? await input.supabase.from("marketplace_product_research_visual_pattern_observations")
      .select("sold_observation_id").eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", "EBAY_US").in("sold_observation_id", observationIds)
    : { data: [], error: null }
  if (existingError) throw new Error("PRODUCT_RESEARCH_VISUAL_EXISTING_LOOKUP_FAILED")
  const alreadyObserved = new Set((existing ?? []).map((entry) => entry.sold_observation_id))
  const rowsWithObservation = input.rows.flatMap((row) => {
    const soldObservationId = observationByKey.get(row.evidenceDeduplicationKey)
    return soldObservationId ? [{ ...row, soldObservationId }] : []
  })
  const insertRows = rowsWithObservation.filter((row) => !alreadyObserved.has(row.soldObservationId))
  if (insertRows.length) {
    const { error: insertError } = await input.supabase
      .from("marketplace_product_research_visual_pattern_observations").insert(insertRows.map((row) => ({
        sold_observation_id: row.soldObservationId,
        capture_batch_id: input.captureBatchId,
        capture_run_id: input.captureRunId,
        marketplace_account_key: input.accountKey,
        marketplace: "EBAY_US",
        query_context_hash: input.queryContextHash,
        visual_pattern_schema_version: PRODUCT_RESEARCH_VISUAL_PATTERN_SCHEMA_VERSION,
        algorithm_version: row.visualPattern.algorithmVersion,
        structured_features: row.visualPattern,
        analysis_status: row.visualPattern.analysisStatus,
        confidence: row.visualPattern.visualPatternConfidence,
        observed_at: input.capturedAt,
        analyzed_at: row.visualPattern.analyzedAt,
      })))
    if (insertError) throw new Error("PRODUCT_RESEARCH_VISUAL_PATTERN_INSERT_FAILED")
  }
  const visualBriefs = buildVisualMarketBriefs(rowsWithObservation, {
    queryContextHash: input.queryContextHash, captureRunId: input.captureRunId,
    categoryId: input.categoryId, capturedAt: input.capturedAt,
  })
  if (visualBriefs.length && insertRows.length) {
    const { error: briefError } = await input.supabase
      .from("marketplace_product_research_visual_market_briefs").insert(visualBriefs.map((brief) => ({
        marketplace_account_key: input.accountKey,
        marketplace: "EBAY_US",
        capture_batch_id: input.captureBatchId,
        capture_run_id: input.captureRunId,
        query_context_hash: input.queryContextHash,
        product_family_fingerprint: brief.productFamilyFingerprint,
        category_id: brief.categoryId,
        visual_market_brief_version: brief.version,
        brief,
        confidence: brief.confidence,
        sample_size: brief.supportingSignals.sampleSize,
      })))
    if (briefError) throw new Error("PRODUCT_RESEARCH_VISUAL_BRIEF_INSERT_FAILED")
  }
  const counts = (status: VisualAnalysisStatus) => rowsWithObservation.filter((row) =>
    row.visualPattern.analysisStatus === status).length
  return {
    captureSupported: true,
    thumbnailDetectedCount: rowsWithObservation.filter((row) => row.visualPattern.imagePresent).length,
    analyzedCount: counts("ANALYZED"), partialCount: counts("PARTIAL"),
    unavailableCount: counts("UNAVAILABLE"), rejectedCount: counts("REJECTED"),
    persistedCount: insertRows.length, existingVisualCount: rowsWithObservation.length - insertRows.length,
    visualBriefs, error: null,
  }
}

export async function getProductResearchVisualPatternStatus(input: {
  supabase: SupabaseClient
  accountKey: string
}) {
  const [{ data: observations, error: observationError }, { data: visuals, error: visualError },
    { data: latestBrief, error: briefError }] = await Promise.all([
    input.supabase.from("marketplace_product_research_capture_observations").select("id")
      .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US"),
    input.supabase.from("marketplace_product_research_visual_pattern_observations")
      .select("sold_observation_id,analysis_status,confidence,structured_features,created_at")
      .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US"),
    input.supabase.from("marketplace_product_research_visual_market_briefs")
      .select("brief,confidence,sample_size,created_at").eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", "EBAY_US").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ])
  if (observationError || visualError || briefError) throw new Error("PRODUCT_RESEARCH_VISUAL_STATUS_READ_FAILED")
  const entries = visuals ?? []
  const uniqueVisualObservations = new Set(entries.map((entry) => entry.sold_observation_id)).size
  const count = (status: VisualAnalysisStatus) => entries.filter((entry) => entry.analysis_status === status).length
  const thumbnailsVisible = entries.filter((entry) => record(entry.structured_features).imagePresent === true).length
  return {
    configured: true,
    visualPatternSchemaVersion: PRODUCT_RESEARCH_VISUAL_PATTERN_SCHEMA_VERSION,
    commercialObservationCount: (observations ?? []).length,
    visualObservationCount: uniqueVisualObservations,
    legacyWithoutVisualCount: Math.max(0, (observations ?? []).length - uniqueVisualObservations),
    visualNotCapturedLegacyStatus: "VISUAL_NOT_CAPTURED_LEGACY",
    thumbnailDetectedCount: thumbnailsVisible,
    analyzedCount: count("ANALYZED"), partialCount: count("PARTIAL"),
    unavailableCount: count("UNAVAILABLE"), rejectedCount: count("REJECTED"),
    latestBrief: latestBrief?.brief ?? null,
    latestBriefConfidence: latestBrief?.confidence ?? "UNKNOWN",
    latestBriefSampleSize: latestBrief?.sample_size ?? 0,
    rawImageBytesStored: false, imageUrlsStored: false, screenshotsStored: false,
    base64Stored: false, blobsStored: false, rawHtmlStored: false, piiStored: false,
    openAiCalls: 0, ebayWrites: 0, productionChanged: false,
  }
}
