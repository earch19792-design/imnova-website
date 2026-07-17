import { createHash } from "node:crypto"

import { z } from "zod"

// @ts-expect-error Node test runtime imports the TypeScript source directly.
import { buildListingAiPackStrategy, listingAiPackStrategySchema } from "./ebay-openai-listing-pack-strategy.ts"

export const LISTING_AI_EVIDENCE_DISTILLATION_VERSION =
  "EBAY_LISTING_AI_EVIDENCE_DISTILLATION_V1_2026_07_16"

const hashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const confidenceSchema = z.enum(["STRONG", "MEDIUM", "LOW", "INSUFFICIENT"])
const optionalTextSchema = z.string().trim().min(1).max(300).nullable()

const recurrenceSchema = z.object({
  value: z.string().trim().min(1).max(160),
  count: z.number().int().nonnegative(),
  sampleSize: z.number().int().nonnegative(),
  prevalencePercent: z.number().finite().min(0).max(100).nullable(),
}).strict()

const visualPatternSchema = z.object({
  pattern: z.string().trim().min(1).max(160),
  soldOrCompletedPercent: z.number().finite().min(0).max(100).nullable(),
  activePercent: z.number().finite().min(0).max(100).nullable(),
  association: z.string().trim().min(1).max(200),
}).strict()

export const listingAiEvidenceDistillationSchema = z.object({
  version: z.literal(LISTING_AI_EVIDENCE_DISTILLATION_VERSION),
  distillationHash: hashSchema,
  source: z.object({
    packageHash: hashSchema,
    packageVersion: z.string().trim().min(1).max(160),
    generatedAt: z.string().datetime(),
    approvedAt: z.string().datetime().nullable(),
    freshnessStatus: z.literal("FRESH"),
  }).strict(),
  identity: z.object({
    fingerprint: hashSchema,
    brand: optionalTextSchema,
    gtin: optionalTextSchema,
    mpn: optionalTextSchema,
    model: optionalTextSchema,
    packCount: z.number().int().positive().nullable(),
    unitCount: z.number().int().positive().nullable(),
    size: optionalTextSchema,
    color: optionalTextSchema,
    scent: optionalTextSchema,
    variant: optionalTextSchema,
    condition: z.literal("new"),
    confidence: confidenceSchema,
  }).strict(),
  activeMarket: z.object({
    exactCount: z.number().int().nonnegative(),
    activeSellerCount: z.number().int().nonnegative().nullable(),
    landedPriceRange: z.object({
      minimum: z.number().finite().nonnegative(),
      maximum: z.number().finite().nonnegative(),
      currency: z.literal("USD"),
    }).strict().nullable(),
    activeMarketMedian: z.number().finite().positive().nullable(),
    shippingPatterns: z.array(recurrenceSchema).max(20),
    returnsPatterns: z.array(recurrenceSchema).max(20),
    sellerTrustSummary: z.object({
      status: z.enum(["AVAILABLE", "N/D"]),
      visibleTrustElements: z.array(z.string().trim().min(1).max(200)).max(20),
    }).strict(),
    competitionPressure: z.number().finite().min(0).max(100).nullable(),
    confidence: confidenceSchema,
  }).strict(),
  soldEvidence: z.object({
    exactCount: z.number().int().nonnegative(),
    verifiedSellerCount: z.number().int().nonnegative().nullable(),
    weightedSoldMedian: z.number().finite().positive().nullable(),
    latestObservedAt: z.string().datetime().nullable(),
    verifiedSoldQuantity: z.number().finite().nonnegative().nullable(),
    sources: z.array(z.string().trim().min(1).max(100)).max(10),
    confidence: confidenceSchema,
    estimatedDemandSignalsExcluded: z.literal(true),
  }).strict(),
  keywordsAndTitles: z.object({
    soldKeywordRecurrence: z.array(recurrenceSchema).max(30),
    activeKeywordRecurrence: z.array(recurrenceSchema).max(30),
    keywordOpportunity: z.number().finite().min(0).max(100).nullable(),
    titleStructurePatterns: z.array(z.string().trim().min(1).max(200)).max(20),
    blockedTerms: z.array(z.string().trim().min(1).max(200)).max(50),
    unsupportedTerms: z.array(z.string().trim().min(1).max(200)).max(50),
    confidence: confidenceSchema,
    competitorTitlesIncluded: z.literal(false),
  }).strict(),
  sellerPatterns: z.object({
    freeShippingPrevalencePercent: z.number().finite().min(0).max(100).nullable(),
    returnsPrevalencePercent: z.number().finite().min(0).max(100).nullable(),
    handlingPatterns: z.array(z.string().trim().min(1).max(200)).max(20),
    quantityDiscountPatterns: z.array(z.string().trim().min(1).max(200)).max(20),
    offerPatterns: z.array(z.string().trim().min(1).max(200)).max(20),
    sellerConcentrationPercent: z.number().finite().min(0).max(100).nullable(),
    visibleTrustElements: z.array(z.string().trim().min(1).max(200)).max(20),
    confidence: confidenceSchema,
    sellerIdentitiesIncluded: z.literal(false),
  }).strict(),
  visualPatterns: z.object({
    status: z.enum(["AVAILABLE", "N/D"]),
    mainImagePatterns: z.array(visualPatternSchema).max(20),
    secondaryImagePatterns: z.array(visualPatternSchema).max(20),
    packVisibility: visualPatternSchema.nullable(),
    unitCountVisibility: visualPatternSchema.nullable(),
    backgroundPatterns: z.array(visualPatternSchema).max(10),
    textDensityPatterns: z.array(visualPatternSchema).max(10),
    infographicPatterns: z.array(visualPatternSchema).max(10),
    dimensionsContentLifestylePatterns: z.array(visualPatternSchema).max(20),
    commonGallerySequence: z.array(z.string().trim().min(1).max(100)).max(12),
    weaknesses: z.array(z.string().trim().min(1).max(200)).max(20),
    differentiationOpportunities: z.array(z.string().trim().min(1).max(240)).max(20),
    recommendedSixImageStrategy: z.array(z.object({
      slot: z.string().trim().min(1).max(100),
      strategy: z.string().trim().min(1).max(500),
      evidenceAssociation: z.array(z.string().trim().min(1).max(160)).max(20),
    }).strict()).max(6),
    confidence: confidenceSchema,
    sampleSize: z.number().int().nonnegative(),
    causalityClaimed: z.literal(false),
  }).strict(),
  economics: z.object({
    minimumSafePrice: z.number().finite().positive(),
    aggressiveLaunchPrice: z.number().finite().positive().nullable(),
    competitivePrice: z.number().finite().positive().nullable(),
    targetPrice: z.number().finite().positive(),
    premiumPrice: z.number().finite().positive().nullable(),
    estimatedProfit: z.number().finite().nullable(),
    roiPercent: z.number().finite().nullable(),
    netMarginPercent: z.number().finite().nullable(),
    marketSupportsMinimumSafePrice: z.boolean().nullable(),
    costConfidence: confidenceSchema,
    minimumSafePriceImmutable: z.literal(true),
  }).strict(),
  packStrategy: listingAiPackStrategySchema,
  compliance: z.object({
    allowedClaims: z.array(z.string().trim().min(1).max(240)).max(50),
    blockedClaims: z.array(z.string().trim().min(1).max(240)).max(50),
    requiredAspects: z.array(z.object({
      name: z.string().trim().min(1).max(80),
      value: z.string().trim().min(1).max(240),
    }).strict()).max(50),
    missingFacts: z.array(z.string().trim().min(1).max(200)).max(50),
    restrictions: z.array(z.string().trim().min(1).max(300)).max(50),
    confidence: confidenceSchema,
  }).strict(),
  audit: z.object({
    sourceClassifiedComparableCount: z.number().int().nonnegative(),
    includedActiveExactCount: z.number().int().nonnegative(),
    includedSoldOrCompletedExactCount: z.number().int().nonnegative(),
    excludedNonExactCount: z.number().int().nonnegative(),
    nearMatchesIncluded: z.literal(false),
    differentPacksIncluded: z.literal(false),
    differentVariantsIncluded: z.literal(false),
    estimatedSignalsPresentedAsSold: z.literal(false),
    competitorTitlesIncluded: z.literal(false),
    competitorDescriptionsIncluded: z.literal(false),
    competitorImagesIncluded: z.literal(false),
    competitorUrlsIncluded: z.literal(false),
    rawComparablesIncluded: z.literal(false),
    ebayWrites: z.literal(0),
  }).strict(),
}).strict()

export type ListingAiEvidenceDistillation = z.infer<
  typeof listingAiEvidenceDistillationSchema
>

type DecisionRow = {
  package_version: string
  package_hash: string
  product_identity_fingerprint: string
  package_payload: unknown
  approved_at?: string | null
}

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function texts(value: unknown, maximum = 50) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(text).filter((entry): entry is string => Boolean(entry)))]
    .slice(0, maximum)
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function positiveInteger(value: unknown) {
  const parsed = number(value)
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function percentage(value: unknown) {
  const parsed = number(value)
  return parsed === null ? null : Math.max(0, Math.min(100, parsed))
}

function confidence(sampleSize: number, strongAt: number, mediumAt: number) {
  if (sampleSize >= strongAt) return "STRONG" as const
  if (sampleSize >= mediumAt) return "MEDIUM" as const
  if (sampleSize > 0) return "LOW" as const
  return "INSUFFICIENT" as const
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function hash(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`
}

function frequency(values: Array<string | null>, sampleSize: number) {
  const counts = new Map<string, number>()
  for (const value of values) {
    const normalized = text(value)?.toLocaleLowerCase("en-US")
    if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 30)
    .map(([value, count]) => ({
      value,
      count,
      sampleSize,
      prevalencePercent: sampleSize ? Math.round(count / sampleSize * 10_000) / 100 : null,
    }))
}

function latestDate(values: Array<string | null>) {
  const usable = values.map((value) => ({ value, parsed: Date.parse(value ?? "") }))
    .filter((entry): entry is { value: string; parsed: number } =>
      Boolean(entry.value) && Number.isFinite(entry.parsed))
    .sort((left, right) => right.parsed - left.parsed)
  return usable[0]?.value ? new Date(usable[0].parsed).toISOString() : null
}

function optionalAggregate(source: JsonRecord, key: string) {
  const value = number(source[key])
  return value !== null && value >= 0 ? Math.round(value) : null
}

function visualPattern(value: unknown) {
  const pattern = record(value)
  const sold = record(pattern.soldOrCompletedExactMatches)
  const active = record(pattern.activeExactMatches)
  const name = text(pattern.pattern)
  return name ? {
    pattern: name,
    soldOrCompletedPercent: percentage(sold.percent),
    activePercent: percentage(active.percent),
    association: text(pattern.interpretation) ?? "INSUFFICIENT_EVIDENCE",
  } : null
}

function visualPatterns(value: unknown) {
  return rows(value).map(visualPattern)
    .filter((entry): entry is NonNullable<ReturnType<typeof visualPattern>> => Boolean(entry))
}

function findPattern(values: ReturnType<typeof visualPatterns>, name: string) {
  return values.find((entry) => entry.pattern === name) ?? null
}

export function buildListingAiEvidenceDistillation(
  row: DecisionRow,
  now = new Date(),
): ListingAiEvidenceDistillation {
  const payload = record(row.package_payload)
  const identity = record(record(payload.productIdentity).identity)
  const economics = record(payload.economics)
  const targetEconomics = record(economics.targetEconomics)
  const scores = record(payload.scores)
  const compliance = record(payload.compliance)
  const intake = record(payload.listingAiIntake)
  const decision = record(payload.decision)
  const comparables = record(payload.comparables)
  const classified = rows(comparables.classified)
  const activeExact = classified.filter((entry) =>
    entry.classification === "EXACT_MATCH" && entry.cohort === "ACTIVE_EXACT_MATCHES")
  const soldExact = classified.filter((entry) =>
    entry.classification === "EXACT_MATCH" && entry.cohort === "SOLD_OR_COMPLETED_EXACT_MATCHES")
  const activePrices = activeExact.map((entry) => number(record(entry.pricing).landedPrice))
    .filter((entry): entry is number => entry !== null && entry >= 0)
  const soldQuantities = soldExact.map((entry) => number(entry.confirmedSoldQuantity))
    .filter((entry): entry is number => entry !== null && entry >= 0)
  const activeKeywords = activeExact.flatMap((entry) => texts(entry.keywords, 50))
  const soldKeywords = soldExact.flatMap((entry) => texts(entry.keywords, 50))
  const activeShipping = activeExact.map((entry) => text(record(entry.patterns).shipping))
  const activeReturns = activeExact.map((entry) => text(record(entry.patterns).returns))
  const sellerEvidence = record(intake.sellerPatterns)
  const marketEvidence = record(payload.marketEvidence)
  const visual = record(payload.visualEvidenceAnalysis)
  const mainPatterns = visualPatterns(visual.mainImagePatterns)
  const secondaryPatterns = visualPatterns(visual.secondaryImagePatterns)
  const visualConfidence = record(visual.visualPatternConfidence)
  const visualConfidenceLevel = ["HIGH", "MEDIUM", "LOW"].includes(String(visualConfidence.level))
    ? String(visualConfidence.level) === "HIGH" ? "STRONG" as const
      : String(visualConfidence.level) === "MEDIUM" ? "MEDIUM" as const
        : "LOW" as const
    : "INSUFFICIENT" as const
  const requiredAspects = rows(intake.requiredAspects).map((entry) => ({
    name: text(entry.name),
    value: text(entry.value),
  })).filter((entry): entry is { name: string; value: string } => Boolean(entry.name && entry.value))
  const missingIdentityFacts = [
    !text(identity.manufacturerBrand) ? "BRAND_MISSING" : null,
    !text(identity.gtin) && !text(identity.mpn) && !text(identity.model)
      ? "GTIN_MPN_MODEL_MISSING" : null,
    !positiveInteger(identity.packCount) ? "PACK_COUNT_MISSING" : null,
    !text(identity.condition) ? "CONDITION_MISSING" : null,
  ].filter((entry): entry is string => Boolean(entry))
  const generatedAt = text(payload.generatedAt)
  if (!generatedAt || !Number.isFinite(Date.parse(generatedAt))) {
    throw new Error("LISTING_AI_EVIDENCE_GENERATED_AT_REQUIRED")
  }
  if (!Number.isFinite(now.getTime())) throw new Error("LISTING_AI_EVIDENCE_NOW_INVALID")
  const minimumSafePrice = number(economics.minimumSafePrice)
  const targetPrice = number(economics.targetPrice)
  if (minimumSafePrice === null || minimumSafePrice <= 0) {
    throw new Error("LISTING_AI_EVIDENCE_MINIMUM_SAFE_PRICE_REQUIRED")
  }
  if (targetPrice === null || targetPrice <= 0) {
    throw new Error("LISTING_AI_EVIDENCE_TARGET_PRICE_REQUIRED")
  }
  const exactSourceCount = activeExact.length + soldExact.length
  const activeConfidence = confidence(activeExact.length, 5, 2)
  const soldConfidence = confidence(soldExact.length, 3, 1)
  const keywordConfidence = soldExact.length
    ? soldConfidence
    : activeExact.length ? activeConfidence === "STRONG" ? "MEDIUM" as const : activeConfidence
      : "INSUFFICIENT" as const
  const costObservedAt = text(record(payload.inventoryEvidence).costObservedAt)
  const costRecent = costObservedAt && Number.isFinite(Date.parse(costObservedAt)) &&
    now.getTime() - Date.parse(costObservedAt) <= 24 * 60 * 60 * 1_000
  const withoutHash = {
    version: LISTING_AI_EVIDENCE_DISTILLATION_VERSION,
    source: {
      packageHash: row.package_hash,
      packageVersion: row.package_version,
      generatedAt: new Date(Date.parse(generatedAt)).toISOString(),
      approvedAt: row.approved_at && Number.isFinite(Date.parse(row.approved_at))
        ? new Date(Date.parse(row.approved_at)).toISOString() : null,
      freshnessStatus: "FRESH" as const,
    },
    identity: {
      fingerprint: row.product_identity_fingerprint,
      brand: text(identity.manufacturerBrand),
      gtin: text(identity.gtin),
      mpn: text(identity.mpn),
      model: text(identity.model),
      packCount: positiveInteger(identity.packCount),
      unitCount: positiveInteger(identity.unitCount),
      size: text(identity.size),
      color: text(identity.color),
      scent: text(identity.scent),
      variant: text(identity.variant),
      condition: "new" as const,
      confidence: "STRONG" as const,
    },
    activeMarket: {
      exactCount: activeExact.length,
      activeSellerCount: optionalAggregate(marketEvidence, "activeSellerCount") ??
        optionalAggregate(sellerEvidence, "activeSellerCount"),
      landedPriceRange: activePrices.length ? {
        minimum: Math.min(...activePrices),
        maximum: Math.max(...activePrices),
        currency: "USD" as const,
      } : null,
      activeMarketMedian: number(economics.activeMarketMedian),
      shippingPatterns: frequency(activeShipping, activeExact.length),
      returnsPatterns: frequency(activeReturns, activeExact.length),
      sellerTrustSummary: {
        status: texts(sellerEvidence.visibleTrustElements, 20).length ? "AVAILABLE" as const : "N/D" as const,
        visibleTrustElements: texts(sellerEvidence.visibleTrustElements, 20),
      },
      competitionPressure: number(scores.competitionPressure),
      confidence: activeConfidence,
    },
    soldEvidence: {
      exactCount: soldExact.length,
      verifiedSellerCount: optionalAggregate(marketEvidence, "verifiedSoldSellerCount") ??
        optionalAggregate(sellerEvidence, "verifiedSoldSellerCount"),
      weightedSoldMedian: number(economics.weightedSoldMedian),
      latestObservedAt: latestDate(soldExact.map((entry) => text(entry.observedAt))),
      verifiedSoldQuantity: soldQuantities.length
        ? soldQuantities.reduce((sum, entry) => sum + entry, 0) : null,
      sources: [...new Set(soldExact.map((entry) => text(entry.source))
        .filter((entry): entry is string => Boolean(entry)))].slice(0, 10),
      confidence: soldConfidence,
      estimatedDemandSignalsExcluded: true as const,
    },
    keywordsAndTitles: {
      soldKeywordRecurrence: frequency(soldKeywords, soldExact.length),
      activeKeywordRecurrence: frequency(activeKeywords, activeExact.length),
      keywordOpportunity: number(scores.keywordOpportunity),
      titleStructurePatterns: texts(intake.titleStructurePatterns, 20),
      blockedTerms: texts(intake.blockedClaims, 50),
      unsupportedTerms: texts(intake.unsupportedTerms, 50),
      confidence: keywordConfidence,
      competitorTitlesIncluded: false as const,
    },
    sellerPatterns: {
      freeShippingPrevalencePercent: percentage(sellerEvidence.freeShippingPrevalencePercent) ??
        (activeExact.length ? frequency(activeShipping, activeExact.length)
          .find((entry) => entry.value.includes("free"))?.prevalencePercent ?? null : null),
      returnsPrevalencePercent: percentage(sellerEvidence.returnsPrevalencePercent) ??
        (activeExact.length ? frequency(activeReturns, activeExact.length)
          .find((entry) => entry.value.includes("accept"))?.prevalencePercent ?? null : null),
      handlingPatterns: texts(sellerEvidence.handlingPatterns, 20),
      quantityDiscountPatterns: texts(sellerEvidence.quantityDiscountPatterns, 20),
      offerPatterns: texts(sellerEvidence.offerPatterns, 20),
      sellerConcentrationPercent: percentage(sellerEvidence.sellerConcentrationPercent),
      visibleTrustElements: texts(sellerEvidence.visibleTrustElements, 20),
      confidence: activeConfidence,
      sellerIdentitiesIncluded: false as const,
    },
    visualPatterns: {
      status: visual.status === "AVAILABLE" ? "AVAILABLE" as const : "N/D" as const,
      mainImagePatterns: mainPatterns,
      secondaryImagePatterns: secondaryPatterns,
      packVisibility: findPattern(mainPatterns, "FULL_PACK_VISIBLE"),
      unitCountVisibility: findPattern(mainPatterns, "UNIT_COUNT_VISIBLE"),
      backgroundPatterns: mainPatterns.filter((entry) => entry.pattern.includes("BACKGROUND") || entry.pattern.includes("WHITE")),
      textDensityPatterns: mainPatterns.filter((entry) => entry.pattern.includes("TEXT_DENSITY")),
      infographicPatterns: secondaryPatterns.filter((entry) => entry.pattern.includes("INFOGRAPHIC")),
      dimensionsContentLifestylePatterns: secondaryPatterns.filter((entry) =>
        ["DIMENSIONS_IMAGE", "CONTENTS_IMAGE", "LIFESTYLE_IMAGE", "USE_CONTEXT_IMAGE"]
          .includes(entry.pattern)),
      commonGallerySequence: rows(visual.commonGallerySequence)
        .map((entry) => text(entry.slot)).filter((entry): entry is string => Boolean(entry)).slice(0, 12),
      weaknesses: rows(visual.visualWeaknesses)
        .map((entry) => text(entry.weakness)).filter((entry): entry is string => Boolean(entry)).slice(0, 20),
      differentiationOpportunities: rows(visual.differentiationOpportunities)
        .map((entry) => text(entry.opportunity)).filter((entry): entry is string => Boolean(entry)).slice(0, 20),
      recommendedSixImageStrategy: rows(visual.recommendedSixImageStrategy).map((entry) => ({
        slot: text(entry.slot),
        strategy: text(entry.strategy),
        evidenceAssociation: texts(entry.evidenceAssociation, 20),
      })).filter((entry): entry is { slot: string; strategy: string; evidenceAssociation: string[] } =>
        Boolean(entry.slot && entry.strategy)).slice(0, 6),
      confidence: visualConfidenceLevel,
      sampleSize: Math.max(0, Math.round(number(visualConfidence.sampleSize) ?? exactSourceCount)),
      causalityClaimed: false as const,
    },
    economics: {
      minimumSafePrice,
      aggressiveLaunchPrice: number(economics.aggressiveLaunchPrice),
      competitivePrice: number(economics.competitivePrice),
      targetPrice,
      premiumPrice: number(economics.premiumPrice),
      estimatedProfit: number(targetEconomics.estimatedProfit),
      roiPercent: number(targetEconomics.estimatedRoiPercent),
      netMarginPercent: number(targetEconomics.estimatedNetMarginPercent),
      marketSupportsMinimumSafePrice: economics.marketSupportsMinimumSafePrice === true
        ? true : economics.marketSupportsMinimumSafePrice === false ? false : null,
      costConfidence: costRecent ? "STRONG" as const : "INSUFFICIENT" as const,
      minimumSafePriceImmutable: true as const,
    },
    packStrategy: buildListingAiPackStrategy(row),
    compliance: {
      allowedClaims: texts(intake.allowedClaims, 50),
      blockedClaims: texts(intake.blockedClaims, 50),
      requiredAspects,
      missingFacts: [...new Set([...missingIdentityFacts, ...texts(intake.missingFacts, 50),
        ...texts(decision.blockers, 50)])].slice(0, 50),
      restrictions: [...new Set([...texts(compliance.findings, 50),
        ...texts(intake.complianceRestrictions, 50)])].slice(0, 50),
      confidence: missingIdentityFacts.length ? "LOW" as const : "STRONG" as const,
    },
    audit: {
      sourceClassifiedComparableCount: classified.length,
      includedActiveExactCount: activeExact.length,
      includedSoldOrCompletedExactCount: soldExact.length,
      excludedNonExactCount: classified.length - exactSourceCount,
      nearMatchesIncluded: false as const,
      differentPacksIncluded: false as const,
      differentVariantsIncluded: false as const,
      estimatedSignalsPresentedAsSold: false as const,
      competitorTitlesIncluded: false as const,
      competitorDescriptionsIncluded: false as const,
      competitorImagesIncluded: false as const,
      competitorUrlsIncluded: false as const,
      rawComparablesIncluded: false as const,
      ebayWrites: 0 as const,
    },
  }
  return listingAiEvidenceDistillationSchema.parse({
    ...withoutHash,
    distillationHash: hash(withoutHash),
  })
}
