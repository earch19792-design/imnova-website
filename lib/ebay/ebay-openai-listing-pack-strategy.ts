import { createHash } from "node:crypto"

import { z } from "zod"

export const LISTING_AI_PACK_STRATEGY_VERSION =
  "EBAY_LISTING_AI_PACK_STRATEGY_V1_2026_07_16"

const hashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const confidenceSchema = z.enum(["STRONG", "MEDIUM", "LOW", "INSUFFICIENT"])
const nullableMoney = z.number().finite().nonnegative().nullable()
const nullablePercent = z.number().finite().nullable()

const packEconomicsSchema = z.object({
  minimumSafePrice: nullableMoney,
  idealSafePrice: nullableMoney,
  competitivePrice: nullableMoney,
  targetPrice: nullableMoney,
  premiumPrice: nullableMoney,
  buyerDiscountPercent: nullablePercent,
  sellerProfit: z.number().finite().nullable(),
  roiPercent: nullablePercent,
  netMarginPercent: nullablePercent,
  shippingEfficiency: nullablePercent,
  meetsMinimumProfit: z.boolean().nullable(),
  meetsMinimumRoi: z.boolean().nullable(),
  meetsMinimumMargin: z.boolean().nullable(),
}).strict()

export const listingAiPackMatrixRowSchema = z.object({
  offerPackFingerprint: hashSchema,
  packCount: z.number().int().positive(),
  unitCountPerItem: z.number().int().positive().nullable(),
  totalUnitCount: z.number().int().positive().nullable(),
  exactContents: z.array(z.string().trim().min(1).max(240)).max(30),
  cohorts: z.array(z.enum([
    "EXACT_OFFER_MATCHES", "ACTIVE_BASE_PRODUCT_PACK_VARIANTS",
    "SOLD_BASE_PRODUCT_PACK_VARIANTS", "ESTIMATED_PACK_DEMAND_SIGNALS",
    "INVALID_PACK_COMPARABLES",
  ])).min(1).max(5),
  activeListingCount: z.number().int().nonnegative(),
  activeSellerCount: z.number().int().nonnegative().nullable(),
  soldEvidenceCount: z.number().int().nonnegative(),
  verifiedSoldQuantity: z.number().finite().nonnegative().nullable(),
  evidenceConfidence: confidenceSchema,
  landedPriceRange: z.object({ minimum: z.number().finite().nonnegative(), maximum: z.number().finite().nonnegative() }).strict().nullable(),
  medianLandedPrice: nullableMoney,
  medianPricePerUnit: nullableMoney,
  medianShippingPrice: nullableMoney,
  freeShippingPrevalencePercent: nullablePercent,
  returnsPrevalencePercent: nullablePercent,
  handlingPatterns: z.array(z.string().trim().min(1).max(160)).max(20),
  competitionPressure: z.number().finite().min(0).max(100),
  titlePatterns: z.array(z.string().trim().min(1).max(200)).max(20),
  visualPatterns: z.array(z.string().trim().min(1).max(200)).max(20),
  cost: nullableMoney,
  shippingCost: nullableMoney,
  fees: nullableMoney,
  stockRequired: z.number().int().positive().nullable(),
  stockUnit: z.enum(["SUPPLIER_OFFER", "BASE_UNIT", "UNKNOWN"]),
  packageWeight: z.number().finite().positive().nullable(),
  packageDimensions: z.object({ length: z.number().positive(), width: z.number().positive(), height: z.number().positive(), unit: z.enum(["in", "cm"]) }).strict().nullable(),
  operationalRisk: z.array(z.string().regex(/^[A-Z0-9_]+$/)).max(30),
  economics: packEconomicsSchema,
  scores: z.object({
    demandConfidence: z.number().finite().min(0).max(100),
    competitionPressure: z.number().finite().min(0).max(100),
    marginSafety: z.number().finite().min(0).max(100),
    operationalFit: z.number().finite().min(0).max(100),
    visualClarityOpportunity: z.number().finite().min(0).max(100),
    overallPackStrategy: z.number().finite().min(0).max(100),
  }).strict(),
  decision: z.enum([
    "RECOMMENDED_PACK", "TEST_AS_SECONDARY_PACK", "NO_GO_PACK",
    "INSUFFICIENT_EVIDENCE", "OPERATIONALLY_UNSAFE",
  ]),
  explanation: z.string().trim().min(1).max(500),
}).strict()

export const listingAiPackStrategySchema = z.object({
  version: z.literal(LISTING_AI_PACK_STRATEGY_VERSION),
  strategyHash: hashSchema,
  baseProductFingerprint: hashSchema,
  currentOfferPackFingerprint: hashSchema,
  cohortCounts: z.object({
    exactOfferMatches: z.number().int().nonnegative(),
    activeBaseProductPackVariants: z.number().int().nonnegative(),
    soldBaseProductPackVariants: z.number().int().nonnegative(),
    estimatedPackDemandSignals: z.number().int().nonnegative(),
    invalidPackComparables: z.number().int().nonnegative(),
  }).strict(),
  recommendedPack: listingAiPackMatrixRowSchema.nullable(),
  alternativePack: listingAiPackMatrixRowSchema.nullable(),
  packMatrix: z.array(listingAiPackMatrixRowSchema).max(30),
  safeguards: z.object({
    unitGtinUsedAsMultipackGtin: z.literal(false),
    inventedGtin: z.literal(false),
    differentVariantsIncluded: z.literal(false),
    varietyPackInvented: z.literal(false),
    demandWithoutEvidenceClaimed: z.literal(false),
    discountWithoutCalculationClaimed: z.literal(false),
    unsafeStockRecommended: z.literal(false),
    shippingIgnoredForRecommendation: z.literal(false),
    competitorContentIncluded: z.literal(false),
    ebayWrites: z.literal(0),
    publications: z.literal(0),
  }).strict(),
}).strict()

export type ListingAiPackStrategy = z.infer<typeof listingAiPackStrategySchema>

type JsonRecord = Record<string, unknown>
type DecisionRow = { product_identity_fingerprint: string; package_payload: unknown }

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function texts(value: unknown, maximum = 30) {
  return [...new Set((Array.isArray(value) ? value : []).map(text)
    .filter((entry): entry is string => Boolean(entry)))].slice(0, maximum)
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

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") return `{${Object.entries(value as JsonRecord)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`
  return JSON.stringify(value)
}

function hash(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`
}

function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function rounded(value: number | null) {
  return value === null ? null : Math.round(value * 100) / 100
}

function confidence(active: number, sold: number) {
  const sample = active + sold
  if (sold >= 3 && sample >= 6) return "STRONG" as const
  if (sold >= 1 || sample >= 3) return "MEDIUM" as const
  if (sample) return "LOW" as const
  return "INSUFFICIENT" as const
}

function sourceCohort(source: string | null) {
  if (source === "EBAY_BROWSE_ACTIVE_LISTING") return "ACTIVE"
  if (source === "EBAY_BROWSE_ESTIMATED_SALES") return "ESTIMATED"
  if (["EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY", "EBAY_OFFICIAL_CSV_IMPORT",
    "EBAY_OFFICIAL_JSON_IMPORT", "HUMAN_REVIEWED_IMPORT"].includes(source ?? "")) return "SOLD"
  return "INVALID"
}

function packKey(packCount: number, unitCount: number | null) {
  return `${packCount}:${unitCount ?? "N/D"}`
}

function observedVisualPatterns(rows: JsonRecord[]) {
  const patterns = new Set<string>()
  for (const row of rows) {
    const visual = record(row.visualEvidence)
    if (visual.fullPackVisible === true) patterns.add("FULL_PACK_VISIBLE")
    if (visual.unitCountVisible === true) patterns.add("UNIT_COUNT_VISIBLE")
    if (["WHITE", "LIGHT_NEUTRAL"].includes(String(visual.mainImageBackground))) {
      patterns.add("WHITE_OR_LIGHT_NEUTRAL_MAIN")
    }
    if (visual.infographicPresence === true) patterns.add("INFOGRAPHIC_PRESENT")
    if (visual.dimensionsImage === true) patterns.add("DIMENSIONS_IMAGE")
    if (visual.contentsImage === true) patterns.add("CONTENTS_IMAGE")
    if (visual.lifestyleImage === true) patterns.add("LIFESTYLE_IMAGE")
    if (visual.useContextImage === true) patterns.add("USE_CONTEXT_IMAGE")
  }
  return [...patterns].slice(0, 20)
}

export function buildListingAiPackStrategy(row: DecisionRow): ListingAiPackStrategy {
  const payload = record(row.package_payload)
  const identity = record(record(payload.productIdentity).identity)
  const economics = record(payload.economics)
  const targetEconomics = record(economics.targetEconomics)
  const inventory = record(payload.inventoryEvidence)
  const intake = record(payload.listingAiIntake)
  const classified = records(record(payload.comparables).classified)
  const supplemental = records(record(payload.packStrategyEvidence).offers)
  const currentPackCount = positiveInteger(identity.packCount)
  if (!currentPackCount) throw new Error("LISTING_AI_PACK_COUNT_REQUIRED")
  const currentUnitCount = positiveInteger(identity.unitCount)
  const baseIdentity = {
    version: "BASE_PRODUCT_FINGERPRINT_V1",
    brand: text(identity.manufacturerBrand),
    gtin: text(identity.gtin),
    mpn: text(identity.mpn),
    model: text(identity.model),
    productName: text(identity.normalizedProductName),
    size: text(identity.size),
    color: text(identity.color),
    scent: text(identity.scent),
    variant: text(identity.variant),
    condition: text(identity.condition),
  }
  const baseProductFingerprint = hash(baseIdentity)
  const groups = new Map<string, { packCount: number; unitCount: number | null; rows: JsonRecord[] }>()
  for (const comparable of classified) {
    if (!["EXACT_MATCH", "DIFFERENT_PACK"].includes(String(comparable.classification))) continue
    const comparableIdentity = record(comparable.identity)
    const packCount = positiveInteger(comparableIdentity.packCount)
    if (!packCount) continue
    const unitCount = positiveInteger(comparableIdentity.unitCount)
    const key = packKey(packCount, unitCount)
    const group = groups.get(key) ?? { packCount, unitCount, rows: [] }
    group.rows.push(comparable)
    groups.set(key, group)
  }
  if (!groups.has(packKey(currentPackCount, currentUnitCount))) {
    groups.set(packKey(currentPackCount, currentUnitCount), {
      packCount: currentPackCount, unitCount: currentUnitCount, rows: [],
    })
  }
  const matrix = [...groups.values()].map((group) => {
    const isCurrentOffer = group.packCount === currentPackCount && group.unitCount === currentUnitCount
    const active = group.rows.filter((entry) => sourceCohort(text(entry.source)) === "ACTIVE")
    const sold = group.rows.filter((entry) => sourceCohort(text(entry.source)) === "SOLD")
    const estimated = group.rows.filter((entry) => sourceCohort(text(entry.source)) === "ESTIMATED")
    const invalid = group.rows.filter((entry) => sourceCohort(text(entry.source)) === "INVALID")
    const offerEvidence = supplemental.find((entry) =>
      positiveInteger(entry.packCount) === group.packCount &&
      positiveInteger(entry.unitCountPerItem) === group.unitCount)
    const exactContents = isCurrentOffer
      ? texts(intake.includedContents)
      : texts(offerEvidence?.exactContents)
    const offerFingerprint = hash({
      version: "OFFER_PACK_FINGERPRINT_V1",
      baseProductFingerprint,
      packCount: group.packCount,
      unitCountPerItem: group.unitCount,
      totalUnitCount: group.unitCount ? group.packCount * group.unitCount : null,
      exactContents,
    })
    const landedPrices = [...active, ...sold].map((entry) => number(record(entry.pricing).landedPrice))
      .filter((entry): entry is number => entry !== null && entry >= 0)
    const shippingPrices = active.map((entry) => number(record(entry.pricing).shippingCost))
      .filter((entry): entry is number => entry !== null && entry >= 0)
    const returns = active.map((entry) => text(record(entry.patterns).returns)).filter(Boolean)
    const soldQuantityValues = sold.map((entry) => number(entry.confirmedSoldQuantity))
      .filter((entry): entry is number => entry !== null && entry >= 0)
    const verifiedSoldQuantity = soldQuantityValues.length
      ? soldQuantityValues.reduce((sum, value) => sum + value, 0) : null
    const minimumSafePrice = isCurrentOffer ? number(economics.minimumSafePrice) : number(offerEvidence?.minimumSafePrice)
    const targetPrice = isCurrentOffer ? number(economics.targetPrice) : number(offerEvidence?.targetPrice)
    const sellerProfit = isCurrentOffer ? number(targetEconomics.estimatedProfit) : number(offerEvidence?.estimatedProfit)
    const roiPercent = isCurrentOffer ? number(targetEconomics.estimatedRoiPercent) : number(offerEvidence?.estimatedRoiPercent)
    const netMarginPercent = isCurrentOffer ? number(targetEconomics.estimatedNetMarginPercent) : number(offerEvidence?.estimatedNetMarginPercent)
    const cost = isCurrentOffer ? number(economics.supplierPackageCost) : number(offerEvidence?.cost)
    const shippingCost = number(offerEvidence?.shippingCost)
    const packageWeight = number(offerEvidence?.packageWeight)
    const dimensionsRaw = record(offerEvidence?.packageDimensions)
    const dimensions = number(dimensionsRaw.length) && number(dimensionsRaw.width) && number(dimensionsRaw.height) && ["in", "cm"].includes(String(dimensionsRaw.unit))
      ? { length: number(dimensionsRaw.length) as number, width: number(dimensionsRaw.width) as number, height: number(dimensionsRaw.height) as number, unit: dimensionsRaw.unit as "in" | "cm" }
      : null
    const stockRequired = isCurrentOffer ? 1 : positiveInteger(offerEvidence?.stockRequired)
    const stockAvailable = isCurrentOffer ? number(inventory.stockAvailable) : number(offerEvidence?.stockAvailable)
    const operationalRisk = [
      !isCurrentOffer && !offerEvidence ? "PACK_SUPPLY_MAPPING_MISSING" : null,
      shippingCost === null ? "PACK_SHIPPING_COST_MISSING" : null,
      shippingCost !== null && targetPrice !== null && shippingCost / targetPrice > 0.35
        ? "PACK_SHIPPING_COST_HIGH" : null,
      packageWeight === null ? "PACKAGE_WEIGHT_MISSING" : null,
      dimensions === null ? "PACKAGE_DIMENSIONS_MISSING" : null,
      stockRequired === null || stockAvailable === null ? "PACK_STOCK_EVIDENCE_MISSING" : null,
      stockRequired !== null && stockAvailable !== null && stockRequired > stockAvailable ? "PACK_STOCK_INSUFFICIENT" : null,
      !exactContents.length ? "EXACT_CONTENTS_MISSING" : null,
    ].filter((entry): entry is string => Boolean(entry))
    const single = [...groups.values()].find((entry) => entry.packCount === 1 && entry.unitCount === group.unitCount)
    const singlePrices = single?.rows.map((entry) => number(record(entry.pricing).landedPrice))
      .filter((entry): entry is number => entry !== null && entry >= 0) ?? []
    const medianLandedPrice = rounded(median(landedPrices))
    const singleMedian = rounded(median(singlePrices))
    const pricePerBaseItem = medianLandedPrice === null ? null : medianLandedPrice / group.packCount
    const buyerDiscount = singleMedian && pricePerBaseItem !== null
      ? rounded((1 - pricePerBaseItem / singleMedian) * 100) : null
    const packTitlePatterns = [
      group.rows.some((entry) => texts(entry.keywords).some((keyword) =>
        new RegExp(`\\b${group.packCount}\\s*[- ]?pack\\b`, "i").test(keyword)))
        ? "PACK_COUNT_TOKEN_OBSERVED" : null,
      group.unitCount && group.rows.some((entry) => texts(entry.keywords).some((keyword) =>
        keyword.includes(String(group.unitCount)))) ? "UNIT_COUNT_TOKEN_OBSERVED" : null,
    ].filter((entry): entry is string => Boolean(entry))
    const meetsProfit = sellerProfit === null ? null : sellerProfit >= 5
    const meetsRoi = roiPercent === null ? null : roiPercent >= 30
    const meetsMargin = netMarginPercent === null ? null : netMarginPercent >= 20
    const evidenceLevel = confidence(active.length, sold.length)
    const demandScore = Math.min(100, sold.length * 25 + (verifiedSoldQuantity ?? 0) * 3 + active.length * 4)
    const competitionScore = Math.min(100, active.length * 12)
    const marginScore = meetsProfit && meetsRoi && meetsMargin ? 100 : 0
    const operationalFit = operationalRisk.length ? 0 : 100
    const visualScore = group.rows.some((entry) => record(entry.visualEvidence).usable === true) ? 70 : 20
    const overall = Math.round((demandScore * 0.3 + (100 - competitionScore) * 0.15 + marginScore * 0.25 + operationalFit * 0.2 + visualScore * 0.1) * 100) / 100
    let decision: "RECOMMENDED_PACK" | "TEST_AS_SECONDARY_PACK" | "NO_GO_PACK" | "INSUFFICIENT_EVIDENCE" | "OPERATIONALLY_UNSAFE"
    if (operationalRisk.some((risk) => [
      "PACK_STOCK_INSUFFICIENT", "PACK_SUPPLY_MAPPING_MISSING", "PACK_SHIPPING_COST_HIGH",
      "PACK_SHIPPING_COST_MISSING", "PACKAGE_WEIGHT_MISSING", "PACKAGE_DIMENSIONS_MISSING",
      "PACK_STOCK_EVIDENCE_MISSING", "EXACT_CONTENTS_MISSING",
    ].includes(risk))) decision = "OPERATIONALLY_UNSAFE"
    else if (minimumSafePrice === null || targetPrice === null || meetsProfit === null || meetsRoi === null || meetsMargin === null) decision = "INSUFFICIENT_EVIDENCE"
    else if (!meetsProfit || !meetsRoi || !meetsMargin) decision = "NO_GO_PACK"
    else if (evidenceLevel === "INSUFFICIENT") decision = "INSUFFICIENT_EVIDENCE"
    else decision = isCurrentOffer ? "RECOMMENDED_PACK" : "TEST_AS_SECONDARY_PACK"
    const cohorts = [
      isCurrentOffer ? "EXACT_OFFER_MATCHES" as const : null,
      !isCurrentOffer && active.length ? "ACTIVE_BASE_PRODUCT_PACK_VARIANTS" as const : null,
      !isCurrentOffer && sold.length ? "SOLD_BASE_PRODUCT_PACK_VARIANTS" as const : null,
      estimated.length ? "ESTIMATED_PACK_DEMAND_SIGNALS" as const : null,
      invalid.length ? "INVALID_PACK_COMPARABLES" as const : null,
    ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    if (!cohorts.length) cohorts.push(isCurrentOffer ? "EXACT_OFFER_MATCHES" : "INVALID_PACK_COMPARABLES")
    return listingAiPackMatrixRowSchema.parse({
      offerPackFingerprint: offerFingerprint,
      packCount: group.packCount,
      unitCountPerItem: group.unitCount,
      totalUnitCount: group.unitCount ? group.packCount * group.unitCount : null,
      exactContents,
      cohorts,
      activeListingCount: active.length,
      activeSellerCount: null,
      soldEvidenceCount: sold.length,
      verifiedSoldQuantity,
      evidenceConfidence: evidenceLevel,
      landedPriceRange: landedPrices.length ? { minimum: Math.min(...landedPrices), maximum: Math.max(...landedPrices) } : null,
      medianLandedPrice,
      medianPricePerUnit: medianLandedPrice !== null && group.unitCount
        ? rounded(medianLandedPrice / (group.packCount * group.unitCount)) : null,
      medianShippingPrice: rounded(median(shippingPrices)),
      freeShippingPrevalencePercent: shippingPrices.length
        ? rounded(shippingPrices.filter((value) => value === 0).length / shippingPrices.length * 100) : null,
      returnsPrevalencePercent: active.length && returns.length
        ? rounded(returns.filter((value) => /accept/i.test(value ?? "")).length / active.length * 100) : null,
      handlingPatterns: [...new Set(active.map((entry) => text(record(entry.patterns).handling))
        .filter((entry): entry is string => Boolean(entry)))].slice(0, 20),
      competitionPressure: competitionScore,
      titlePatterns: packTitlePatterns,
      visualPatterns: observedVisualPatterns(group.rows),
      cost,
      shippingCost,
      fees: isCurrentOffer ? number(targetEconomics.estimatedMarketplaceFees) : number(offerEvidence?.fees),
      stockRequired,
      stockUnit: isCurrentOffer ? "SUPPLIER_OFFER" : offerEvidence ? "BASE_UNIT" : "UNKNOWN",
      packageWeight,
      packageDimensions: dimensions,
      operationalRisk,
      economics: {
        minimumSafePrice,
        idealSafePrice: isCurrentOffer ? number(economics.idealSafePrice) : number(offerEvidence?.idealSafePrice),
        competitivePrice: isCurrentOffer ? number(economics.competitivePrice) : number(offerEvidence?.competitivePrice),
        targetPrice,
        premiumPrice: isCurrentOffer ? number(economics.premiumPrice) : number(offerEvidence?.premiumPrice),
        buyerDiscountPercent: buyerDiscount,
        sellerProfit,
        roiPercent,
        netMarginPercent,
        shippingEfficiency: targetPrice && shippingCost !== null ? rounded((1 - shippingCost / targetPrice) * 100) : null,
        meetsMinimumProfit: meetsProfit,
        meetsMinimumRoi: meetsRoi,
        meetsMinimumMargin: meetsMargin,
      },
      scores: { demandConfidence: demandScore, competitionPressure: competitionScore, marginSafety: marginScore, operationalFit, visualClarityOpportunity: visualScore, overallPackStrategy: overall },
      decision,
      explanation: decision === "RECOMMENDED_PACK" ? "Current exact offer meets canonical economics and has exact market evidence."
        : decision === "TEST_AS_SECONDARY_PACK" ? "Alternative pack is viable but should be tested separately from the exact offer."
          : decision === "NO_GO_PACK" ? "Pack fails at least one canonical profit, ROI or margin gate."
            : decision === "OPERATIONALLY_UNSAFE" ? `Operationally blocked: ${operationalRisk.join(", ")}.`
              : "Evidence or pack-level economics are insufficient for a recommendation.",
    })
  }).sort((left, right) => right.scores.overallPackStrategy - left.scores.overallPackStrategy || left.packCount - right.packCount)
  const recommendedPack = matrix.find((entry) => entry.decision === "RECOMMENDED_PACK") ?? null
  const alternativePack = matrix.find((entry) => entry.decision === "TEST_AS_SECONDARY_PACK") ?? null
  const currentOfferPackFingerprint = matrix.find((entry) => entry.packCount === currentPackCount && entry.unitCountPerItem === currentUnitCount)?.offerPackFingerprint
  if (!currentOfferPackFingerprint) throw new Error("LISTING_AI_CURRENT_PACK_FINGERPRINT_MISSING")
  const withoutHash = {
    version: LISTING_AI_PACK_STRATEGY_VERSION,
    baseProductFingerprint,
    currentOfferPackFingerprint,
    cohortCounts: {
      exactOfferMatches: classified.filter((entry) => entry.classification === "EXACT_MATCH").length,
      activeBaseProductPackVariants: classified.filter((entry) => entry.classification === "DIFFERENT_PACK" && sourceCohort(text(entry.source)) === "ACTIVE").length,
      soldBaseProductPackVariants: classified.filter((entry) => entry.classification === "DIFFERENT_PACK" && sourceCohort(text(entry.source)) === "SOLD").length,
      estimatedPackDemandSignals: classified.filter((entry) => entry.classification === "DIFFERENT_PACK" && sourceCohort(text(entry.source)) === "ESTIMATED").length,
      invalidPackComparables: classified.filter((entry) => !["EXACT_MATCH", "DIFFERENT_PACK"].includes(String(entry.classification))).length,
    },
    recommendedPack,
    alternativePack,
    packMatrix: matrix,
    safeguards: {
      unitGtinUsedAsMultipackGtin: false as const,
      inventedGtin: false as const,
      differentVariantsIncluded: false as const,
      varietyPackInvented: false as const,
      demandWithoutEvidenceClaimed: false as const,
      discountWithoutCalculationClaimed: false as const,
      unsafeStockRecommended: false as const,
      shippingIgnoredForRecommendation: false as const,
      competitorContentIncluded: false as const,
      ebayWrites: 0 as const,
      publications: 0 as const,
    },
  }
  return listingAiPackStrategySchema.parse({ ...withoutHash, strategyHash: hash(withoutHash) })
}
