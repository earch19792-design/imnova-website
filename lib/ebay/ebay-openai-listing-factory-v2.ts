import { createHash } from "node:crypto"

import { z } from "zod"

// @ts-expect-error Node test runtime imports the TypeScript source directly.
import { buildListingAiEvidenceDistillation, listingAiEvidenceDistillationSchema } from "./ebay-openai-listing-evidence-distillation.ts"
// @ts-expect-error Node test runtime imports the TypeScript source directly.
import { buildListingAiPackStrategy } from "./ebay-openai-listing-pack-strategy.ts"

export const LISTING_AI_SCHEMA_VERSION = "EBAY_LISTING_AI_OUTPUT_V2_1"
export const LISTING_AI_ENGINE_VERSION = "EBAY_LISTING_AI_ENGINE_V2_1"
export const LISTING_AI_VALIDATION_POLICY_VERSION = "EBAY_LISTING_AI_VALIDATION_V2_1"
export const LISTING_AI_DEFAULT_PROMPT_VERSION =
  "EBAY_LISTING_AI_PROMPT_V2_1_EVIDENCE_2026_07_16"
export const LISTING_AI_STAGING_REF = "vsfthqydfrdzulldbfbe"

const SYSTEM_PROMPT = [
  "You create original eBay US listing content from verified product facts only.",
  "Never invent identifiers, brand, manufacturer, compatibility, package quantity, variant, certification, warranty, shipping, returns, authenticity or medical claims.",
  "Never copy competitor titles or descriptions and never request competitor images or URLs.",
  "Treat evidenceDistillation as the canonical market evidence; do not treat productFacts alone as sufficient context.",
  "Use sold/completed exact evidence as confirmed demand evidence and active exact evidence as competition context; never merge them or present estimated signals as sales.",
  "Near matches, different packs and different variants are excluded and must never be described as exact evidence.",
  "Describe market observations as associations, never as causal proof.",
  "Use only authorized keywords and compact evidence summaries supplied in the structured input.",
  "Return only JSON that conforms to the supplied schema.",
].join(" ")

const GENERATION_PROMPT = [
  "Write clear factual listing copy for human approval.",
  "Provide exactly three distinct title candidates of at most 80 characters.",
  "Keep the recommended price at or above minimumSafePrice.",
  "Never recalculate, lower or reinterpret minimumSafePrice.",
  "Image briefs are planning text only, must use authorized product facts and images, and should apply the compact visual pattern evidence through an original execution.",
  "For each output area, report whether its support is strong, medium, low or insufficient.",
  "Report uncertain statements in unsupportedClaims instead of presenting them as facts.",
].join(" ")

const REVISION_PROMPT = [
  "Correct only the supplied sanitized validation error codes.",
  "Preserve every verified fact, identity field, package quantity, variant and price floor.",
  "Do not broaden claims or introduce new attributes during revision.",
].join(" ")

const UNIVERSAL_BLOCKED_TERMS = [
  "fda approved",
  "medical grade",
  "cures",
  "treats disease",
  "guaranteed results",
  "authenticity guaranteed",
  "100% authentic",
  "best on the market",
  "#1",
  "never fails",
  "free shipping",
  "same day shipping",
  "lifetime warranty",
]

const hashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const nullableText = z.string().trim().min(1).max(240).nullable()
const aspectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(240),
}).strict()

export const listingAiProductFactsSchema = z.object({
  manufacturerBrand: nullableText,
  manufacturer: nullableText,
  gtin: z.string().regex(/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/).nullable(),
  mpn: nullableText,
  model: nullableText,
  normalizedProductName: z.string().trim().min(1).max(240),
  packCount: z.number().int().positive().nullable(),
  unitCount: z.number().int().positive().nullable(),
  size: nullableText,
  color: nullableText,
  scent: nullableText,
  variant: nullableText,
  condition: z.literal("new"),
  includedContents: z.array(z.string().trim().min(1).max(240)).max(30),
}).strict()

export const listingAiInputSchema = z.object({
  packageVersion: z.string().trim().min(1).max(160),
  packageHash: hashSchema,
  candidateId: z.string().uuid().nullable(),
  productFacts: listingAiProductFactsSchema,
  identityFingerprint: hashSchema,
  identityEvidence: z.object({
    strong: z.literal(true),
    exactIdentifier: z.literal(true),
    evidenceCodes: z.array(z.string().regex(/^[A-Z0-9_]+$/)).min(1).max(30),
  }).strict(),
  verdict: z.enum(["GO", "GO_WITH_CHANGES"]),
  approvedKeywords: z.array(z.string().trim().min(1).max(80)).min(1).max(40),
  category: z.object({
    id: z.string().trim().min(1).max(32),
    name: z.string().trim().min(1).max(160),
  }).strict(),
  requiredAspects: z.array(aspectSchema).min(1).max(50),
  optionalAspects: z.array(aspectSchema).max(50),
  pricingScenario: z.object({
    currency: z.literal("USD"),
    name: z.string().trim().min(1).max(80),
  }).strict(),
  minimumSafePrice: z.number().finite().positive(),
  targetPrice: z.number().finite().positive(),
  complianceRestrictions: z.array(z.string().trim().min(1).max(300)).max(50),
  blockedClaims: z.array(z.string().trim().min(1).max(200)).max(50),
  allowedImageFacts: z.array(z.string().trim().min(1).max(240)).min(1).max(50),
  marketPatternSummary: z.object({
    activeExactCount: z.number().int().nonnegative(),
    soldOrCompletedExactCount: z.number().int().nonnegative(),
    estimatedDemandSignalCount: z.number().int().nonnegative(),
    weightedSoldMedian: z.number().finite().positive().nullable(),
    activeMarketMedian: z.number().finite().positive().nullable(),
  }).strict(),
  visualPatternSummary: z.object({
    status: z.enum(["AVAILABLE", "N/D"]),
    sampleSize: z.number().int().nonnegative(),
    confidence: z.enum(["HIGH", "MEDIUM", "LOW", "INSUFFICIENT"]),
    patterns: z.array(z.string().trim().min(1).max(300)).max(30),
    sixImageStrategy: z.array(z.string().trim().min(1).max(500)).length(6),
  }).strict(),
  evidenceConfidence: z.object({
    score: z.number().finite().min(0).max(100),
    level: z.enum(["HIGH", "MEDIUM", "LOW", "INSUFFICIENT"]),
  }).strict(),
  evidenceDistillation: listingAiEvidenceDistillationSchema,
  marketplace: z.literal("EBAY_US"),
  locale: z.literal("en-US"),
}).strict()

export type ListingAiInput = z.infer<typeof listingAiInputSchema>

const imageBriefSchema = z.object({
  slot: z.enum([
    "MAIN_WHITE_BACKGROUND",
    "PACK_AND_COUNT",
    "KEY_FEATURES",
    "SIZE_AND_CONTENT",
    "USE_CONTEXT",
    "PACKAGE_CONTENTS",
  ]),
  objective: z.string().trim().min(1).max(500),
  overlayText: z.string().trim().max(100).nullable(),
  allowedFacts: z.array(z.string().trim().min(1).max(240)).max(12),
  sourcePolicy: z.literal("AUTHORIZED_PRODUCT_IMAGE_ONLY"),
}).strict()

export const listingAiModelOutputSchema = z.object({
  primaryKeywords: z.array(z.string().trim().min(1).max(80)).min(1).max(10),
  secondaryKeywords: z.array(z.string().trim().min(1).max(80)).max(30),
  blockedKeywords: z.array(z.string().trim().min(1).max(200)).max(50),
  titleCandidates: z.array(z.string().trim().min(1).max(80)).length(3),
  recommendedTitle: z.string().trim().min(1).max(80),
  factualBullets: z.array(z.string().trim().min(1).max(300)).min(3).max(8),
  itemSpecifics: z.array(aspectSchema).min(1).max(50),
  description: z.string().trim().min(80).max(5_000),
  faq: z.array(z.object({
    question: z.string().trim().min(1).max(240),
    answer: z.string().trim().min(1).max(500),
  }).strict()).min(2).max(8),
  imageBriefs: z.array(imageBriefSchema).length(6),
  imageText: z.array(z.string().trim().max(100)).max(12),
  complianceNotes: z.array(z.string().trim().min(1).max(500)).max(30),
  unsupportedClaims: z.array(z.string().trim().min(1).max(500)).max(30),
  differentiationStrategy: z.object({
    marketPositioning: z.string().trim().min(1).max(500),
    trustPresentation: z.string().trim().min(1).max(500),
    visualDifferentiation: z.string().trim().min(1).max(500),
    evidenceConfidence: z.enum(["STRONG", "MEDIUM", "LOW", "INSUFFICIENT"]),
    causalityClaimed: z.literal(false),
  }).strict(),
  evidenceAttribution: z.array(z.object({
    outputSection: z.enum([
      "TITLES", "KEYWORDS", "ITEM_SPECIFICS", "DESCRIPTION", "FAQ",
      "DIFFERENTIATION", "PRICE_PRESENTATION", "IMAGE_BRIEFS", "COMPLIANCE",
    ]),
    evidenceSources: z.array(z.enum([
      "PRODUCT_IDENTITY", "ACTIVE_EXACT_MATCHES", "SOLD_OR_COMPLETED_EXACT_MATCHES",
      "SELLER_PATTERNS", "VISUAL_PATTERNS", "CANONICAL_ECONOMICS", "COMPLIANCE",
    ])).min(1).max(7),
    confidence: z.enum(["STRONG", "MEDIUM", "LOW", "INSUFFICIENT"]),
    rationale: z.string().trim().min(1).max(400),
  }).strict()).min(6).max(12),
  pricePresentation: z.object({
    price: z.number().finite().positive(),
    currency: z.literal("USD"),
    minimumSafePrice: z.number().finite().positive(),
    packCount: z.number().int().positive(),
    totalUnitCount: z.number().int().positive().nullable(),
    pricePerUnit: z.number().finite().positive().nullable(),
    buyerDiscountPercent: z.number().finite().nullable(),
    buyerDiscountVerified: z.boolean(),
  }).strict(),
  experimentAlternatives: z.object({
    titleAlternatives: z.array(z.string().trim().min(1).max(80)).max(3),
    positioningAlternatives: z.array(z.string().trim().min(1).max(300)).max(3),
    priceExperimentAllowed: z.literal(false),
  }).strict(),
  factAssertions: listingAiProductFactsSchema,
}).strict()

export type ListingAiModelOutput = z.infer<typeof listingAiModelOutputSchema>

export const listingAiCanonicalOutputSchema = listingAiModelOutputSchema.extend({
  schemaVersion: z.literal(LISTING_AI_SCHEMA_VERSION),
  modelMetadata: z.object({
    provider: z.enum(["OPENAI", "FAKE"]),
    model: z.string().trim().min(1).max(160),
    revisionNumber: z.number().int().min(0).max(1),
    inputTokens: z.number().int().nonnegative().nullable(),
    cachedInputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    estimatedCostUsd: z.number().finite().nonnegative(),
  }).strict(),
  promptVersion: z.string().trim().min(1).max(160),
  inputHash: hashSchema,
  outputHash: hashSchema,
}).strict()

export type ListingAiCanonicalOutput = z.infer<typeof listingAiCanonicalOutputSchema>

export type ListingAiUsage = {
  inputTokens: number | null
  cachedInputTokens: number | null
  outputTokens: number | null
}

export type ListingAiAdapterResult = {
  output: unknown
  provider: "OPENAI" | "FAKE"
  model: string
  sanitizedRequestId: string | null
  usage: ListingAiUsage
}

export type ListingAiAdapter = {
  generate(input: ListingAiInput, context: {
    promptVersion: string
    revisionNumber: number
    validationErrors: string[]
  }): Promise<ListingAiAdapterResult>
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function listingAiHash(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`
}

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function stringArray(value: unknown, maximum = 50) {
  return [...new Set(array(value).map(optionalText)
    .filter((entry): entry is string => Boolean(entry)))].slice(0, maximum)
}

function aspects(value: unknown) {
  return array(value).map(record).map((entry) => ({
    name: optionalText(entry.name),
    value: optionalText(entry.value),
  })).filter((entry): entry is { name: string; value: string } => Boolean(entry.name && entry.value))
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value)
}

const ELIGIBILITY_RECENCY_MS = 24 * 60 * 60 * 1_000
const FUTURE_CLOCK_TOLERANCE_MS = 5 * 60 * 1_000

function freshness(value: unknown, now: Date) {
  const parsed = Date.parse(String(value ?? ""))
  if (!Number.isFinite(parsed)) return false
  return parsed <= now.getTime() + FUTURE_CLOCK_TOLERANCE_MS &&
    now.getTime() - parsed <= ELIGIBILITY_RECENCY_MS
}

function confidenceLevel(score: number | null) {
  if (score === null) return "INSUFFICIENT" as const
  if (score >= 75) return "HIGH" as const
  if (score >= 50) return "MEDIUM" as const
  if (score > 0) return "LOW" as const
  return "INSUFFICIENT" as const
}

export type ListingAiDecisionRow = {
  id: string
  candidate_id?: string | null
  package_version: string
  package_hash: string
  product_identity_fingerprint: string
  verdict: string
  status: string
  package_payload: unknown
  approved_at?: string | null
}

function verifyDecisionPackageIntegrity(row: ListingAiDecisionRow) {
  const payload = record(row.package_payload)
  const { inputHash: _inputHash, packageHash, ...packagePayload } = payload
  return validHash(row.package_hash) &&
    packageHash === row.package_hash &&
    payload.packageVersion === row.package_version &&
    payload.marketplace === "EBAY_US" &&
    packageHash === listingAiHash({ ...packagePayload, generatedAt: undefined })
}

export function assessListingAiDecisionPackage(
  row: ListingAiDecisionRow,
  now = new Date(),
  options: { integrityVerified?: boolean } = {},
) {
  const payload = record(row.package_payload)
  const productIdentity = record(payload.productIdentity)
  const identity = record(productIdentity.identity)
  const economics = record(payload.economics)
  const inventory = record(payload.inventoryEvidence)
  const decision = record(payload.decision)
  const safety = record(payload.safety)
  const intake = record(payload.listingAiIntake)
  let packStrategyReady = false
  try {
    packStrategyReady = Boolean(buildListingAiPackStrategy(row).recommendedPack)
  } catch {
    packStrategyReady = false
  }
  const blockers = stringArray(decision.blockers)
  const exactIdentifier = identity.gtinValid === true || Boolean(
    optionalText(identity.manufacturerBrand) &&
    (optionalText(identity.mpn) || optionalText(identity.model)),
  )
  const strongIdentity = exactIdentifier && Boolean(
    numberOrNull(identity.packCount) && optionalText(identity.condition),
  ) && [
    optionalText(identity.normalizedProductName), numberOrNull(identity.packCount),
    numberOrNull(identity.unitCount), optionalText(identity.size), optionalText(identity.variant),
    optionalText(identity.condition),
  ].filter((value) => value !== null).length >= 4 &&
    !blockers.includes("PRODUCT_IDENTITY_NOT_STRONG")
  const integrityValid = options.integrityVerified === true || verifyDecisionPackageIntegrity(row)
  const reasons = [
    row.status !== "APPROVED" ? "LOOP1_PACKAGE_NOT_APPROVED" : null,
    !["GO", "GO_WITH_CHANGES"].includes(row.verdict) ? "LOOP1_VERDICT_NOT_ELIGIBLE" : null,
    payload.decision && decision.verdict !== row.verdict ? "LOOP1_VERDICT_MISMATCH" : null,
    !integrityValid ? "LOOP1_PACKAGE_INTEGRITY_INVALID" : null,
    !freshness(payload.generatedAt, now) ? "LOOP1_PACKAGE_STALE" : null,
    !validHash(row.product_identity_fingerprint) ||
      productIdentity.fingerprint !== row.product_identity_fingerprint
      ? "IDENTITY_FINGERPRINT_INVALID" : null,
    !strongIdentity ? "PRODUCT_IDENTITY_NOT_STRONG" : null,
    economics.viable !== true ? "ECONOMICS_NOT_VIABLE" : null,
    !numberOrNull(economics.minimumSafePrice) ? "MINIMUM_SAFE_PRICE_REQUIRED" : null,
    !numberOrNull(economics.targetPrice) ? "TARGET_PRICE_REQUIRED" : null,
    !numberOrNull(economics.supplierPackageCost) ? "SUPPLIER_COST_REQUIRED" : null,
    !freshness(inventory.stockObservedAt, now) ? "STOCK_EVIDENCE_STALE" : null,
    !freshness(inventory.costObservedAt, now) ? "COST_EVIDENCE_STALE" : null,
    (numberOrNull(inventory.stockAvailable) ?? 0) <= 0 ? "STOCK_NOT_AVAILABLE" : null,
    safety.canPublish !== false ? "LOOP1_CAN_PUBLISH_MUST_BE_FALSE" : null,
    !payload.listingAiIntake ? "LISTING_AI_INTAKE_REQUIRED" : null,
    !stringArray(intake.approvedKeywords).length ? "APPROVED_KEYWORDS_REQUIRED" : null,
    !optionalText(record(intake.category).id) || !optionalText(record(intake.category).name)
      ? "CATEGORY_REQUIRED" : null,
    !aspects(intake.requiredAspects).length ? "REQUIRED_ASPECTS_REQUIRED" : null,
    !stringArray(intake.includedContents).length ? "INCLUDED_CONTENTS_REQUIRED" : null,
    !stringArray(intake.allowedImageFacts).length ? "ALLOWED_IMAGE_FACTS_REQUIRED" : null,
    intake.locale !== "en-US" ? "LOCALE_EN_US_REQUIRED" : null,
    !packStrategyReady ? "PACK_STRATEGY_RECOMMENDATION_REQUIRED" : null,
  ].filter((value): value is string => Boolean(value))
  return {
    eligible: reasons.length === 0,
    reasons,
    verdict: row.verdict,
    packageStatus: row.status,
    identityStrong: strongIdentity,
    fingerprintValid: validHash(row.product_identity_fingerprint) &&
      productIdentity.fingerprint === row.product_identity_fingerprint,
    economicsViable: economics.viable === true,
    minimumSafePrice: numberOrNull(economics.minimumSafePrice),
    targetPrice: numberOrNull(economics.targetPrice),
    stockRecent: freshness(inventory.stockObservedAt, now),
    costRecent: freshness(inventory.costObservedAt, now),
    canPublish: false,
  }
}

function buildVisualSummary(value: unknown) {
  const visual = record(value)
  const summary = record(visual.visualEvidenceSummary)
  const confidence = record(visual.visualPatternConfidence)
  const patterns = [...array(visual.mainImagePatterns), ...array(visual.secondaryImagePatterns)]
    .map(record).map((entry) => optionalText(entry.pattern))
    .filter((entry): entry is string => Boolean(entry))
  const strategy = array(visual.recommendedSixImageStrategy).map(record)
    .map((entry) => optionalText(entry.strategy))
    .filter((entry): entry is string => Boolean(entry))
  return {
    status: visual.status === "AVAILABLE" ? "AVAILABLE" as const : "N/D" as const,
    sampleSize: numberOrNull(confidence.sampleSize) ??
      (numberOrNull(summary.activeExactSampleSize) ?? 0) +
      (numberOrNull(summary.soldOrCompletedExactSampleSize) ?? 0),
    confidence: ["HIGH", "MEDIUM", "LOW"].includes(String(confidence.level))
      ? confidence.level as "HIGH" | "MEDIUM" | "LOW"
      : "INSUFFICIENT" as const,
    patterns: [...new Set(patterns)].slice(0, 30),
    sixImageStrategy: strategy.length === 6 ? strategy : [],
  }
}

export function buildListingAiInputFromDecisionPackage(
  row: ListingAiDecisionRow,
  now = new Date(),
  options: { integrityVerified?: boolean } = {},
): ListingAiInput {
  const assessment = assessListingAiDecisionPackage(row, now, options)
  if (!assessment.eligible) throw new Error(assessment.reasons[0] ?? "LISTING_AI_PACKAGE_NOT_ELIGIBLE")
  const payload = record(row.package_payload)
  const productIdentity = record(payload.productIdentity)
  const identity = record(productIdentity.identity)
  const economics = record(payload.economics)
  const counts = record(record(payload.comparables).counts)
  const scores = record(payload.scores)
  const intake = record(payload.listingAiIntake)
  const category = record(intake.category)
  const compliance = record(payload.compliance)
  const currentPackCount = numberOrNull(identity.packCount)
  const currentUnitCount = numberOrNull(identity.unitCount)
  const verifiedOffer = array(record(payload.packStrategyEvidence).offers).map(record)
    .find((entry) => numberOrNull(entry.packCount) === currentPackCount &&
      numberOrNull(entry.unitCountPerItem) === currentUnitCount &&
      entry.offerGtinVerified === true)
  const safeOfferGtin = currentPackCount !== null && currentPackCount > 1
    ? optionalText(verifiedOffer?.offerGtin)
    : optionalText(identity.gtin)
  const demandScore = numberOrNull(scores.demandConfidence)
  const exactIdentifier = identity.gtinValid === true || Boolean(
    optionalText(identity.manufacturerBrand) &&
    (optionalText(identity.mpn) || optionalText(identity.model)),
  )
  const evidenceCodes = [
    identity.gtinValid === true ? "GTIN_CHECKSUM_VALID" : null,
    optionalText(identity.manufacturerBrand) ? "MANUFACTURER_BRAND_VERIFIED" : null,
    optionalText(identity.mpn) ? "MPN_VERIFIED" : null,
    optionalText(identity.model) ? "MODEL_VERIFIED" : null,
    numberOrNull(identity.packCount) ? "PACK_COUNT_VERIFIED" : null,
    optionalText(identity.variant) ? "VARIANT_VERIFIED" : null,
  ].filter((value): value is string => Boolean(value))
  return listingAiInputSchema.parse({
    packageVersion: row.package_version,
    packageHash: row.package_hash,
    candidateId: row.candidate_id ?? null,
    productFacts: {
      manufacturerBrand: optionalText(identity.manufacturerBrand),
      manufacturer: null,
      gtin: safeOfferGtin,
      mpn: optionalText(identity.mpn),
      model: optionalText(identity.model),
      normalizedProductName: optionalText(identity.normalizedProductName),
      packCount: numberOrNull(identity.packCount),
      unitCount: numberOrNull(identity.unitCount),
      size: optionalText(identity.size),
      color: optionalText(identity.color),
      scent: optionalText(identity.scent),
      variant: optionalText(identity.variant),
      condition: String(identity.condition).toLowerCase(),
      includedContents: stringArray(intake.includedContents, 30),
    },
    identityFingerprint: row.product_identity_fingerprint,
    identityEvidence: { strong: true, exactIdentifier, evidenceCodes },
    verdict: row.verdict,
    approvedKeywords: stringArray(intake.approvedKeywords, 40),
    category: { id: optionalText(category.id), name: optionalText(category.name) },
    requiredAspects: aspects(intake.requiredAspects),
    optionalAspects: aspects(intake.optionalAspects),
    pricingScenario: {
      currency: "USD",
      name: optionalText(intake.pricingScenarioName) ?? "TARGET_PRICE",
    },
    minimumSafePrice: numberOrNull(economics.minimumSafePrice),
    targetPrice: numberOrNull(economics.targetPrice),
    complianceRestrictions: [
      ...stringArray(compliance.findings), ...stringArray(intake.complianceRestrictions),
    ],
    blockedClaims: stringArray(intake.blockedClaims),
    allowedImageFacts: stringArray(intake.allowedImageFacts),
    marketPatternSummary: {
      activeExactCount: numberOrNull(counts.activeExact) ?? 0,
      soldOrCompletedExactCount: numberOrNull(counts.soldOrCompletedExact) ?? 0,
      estimatedDemandSignalCount: numberOrNull(counts.estimatedDemandSignals) ?? 0,
      weightedSoldMedian: numberOrNull(economics.weightedSoldMedian),
      activeMarketMedian: numberOrNull(economics.activeMarketMedian),
    },
    visualPatternSummary: buildVisualSummary(payload.visualEvidenceAnalysis),
    evidenceConfidence: {
      score: demandScore ?? 0,
      level: confidenceLevel(demandScore),
    },
    evidenceDistillation: buildListingAiEvidenceDistillation(row, now),
    marketplace: "EBAY_US",
    locale: "en-US",
  })
}

function finiteNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback
}

export function getListingAiConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  let detectedRef: string | null = null
  try {
    detectedRef = new URL(environment.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "")
      .hostname.split(".")[0] || null
  } catch {
    detectedRef = null
  }
  const preview = environment.VERCEL_ENV === "preview"
  const staging = detectedRef === LISTING_AI_STAGING_REF
  const enabled = environment.OPENAI_LISTING_FACTORY_ENABLED?.trim() === "true"
  const apiKeyPresent = Boolean(environment.OPENAI_API_KEY?.trim())
  const model = environment.OPENAI_LISTING_MODEL?.trim() ?? ""
  const reviewModelRaw = environment.OPENAI_LISTING_REVIEW_MODEL?.trim() ?? ""
  const reviewModelEnabled = Boolean(reviewModelRaw && reviewModelRaw.toUpperCase() !== "OFF")
  const promptVersion = environment.OPENAI_LISTING_PROMPT_VERSION?.trim() ||
    LISTING_AI_DEFAULT_PROMPT_VERSION
  const promptVersionSupported = promptVersion === LISTING_AI_DEFAULT_PROMPT_VERSION
  const maxRevisions = boundedInteger(environment.OPENAI_LISTING_MAX_REVISIONS, 1, 0, 1)
  const monthlyBudgetUsd = finiteNumber(environment.OPENAI_LISTING_MONTHLY_BUDGET_USD, 10, 0, 10_000)
  const warningBudgetUsd = finiteNumber(environment.OPENAI_LISTING_WARNING_BUDGET_USD, 5, 0, monthlyBudgetUsd)
  const hardStopUsd = finiteNumber(environment.OPENAI_LISTING_HARD_STOP_USD, 8, 0, monthlyBudgetUsd)
  let status: "READY" | "DISABLED" | "MISSING_API_KEY" | "MISSING_MODEL" |
    "PROMPT_VERSION_UNSUPPORTED" | "PREVIEW_STAGING_REQUIRED"
  if (!preview || !staging) status = "PREVIEW_STAGING_REQUIRED"
  else if (!enabled) status = "DISABLED"
  else if (!apiKeyPresent) status = "MISSING_API_KEY"
  else if (!model) status = "MISSING_MODEL"
  else if (!promptVersionSupported) status = "PROMPT_VERSION_UNSUPPORTED"
  else status = "READY"
  return {
    status,
    enabled,
    apiKey: apiKeyPresent ? "PRESENT" as const : "MISSING" as const,
    model: model || null,
    reviewModel: reviewModelEnabled ? "CONFIGURED" as const : "OFF" as const,
    promptVersion,
    promptVersionSupported,
    maxRevisions,
    monthlyBudgetUsd,
    warningBudgetUsd,
    hardStopUsd,
    preview,
    staging,
    realReady: status === "READY",
    fakeAdapterReady: preview && staging,
    serverSideOnly: true,
    apiKeyReturned: false,
    secretsReturned: false,
    productionBlocked: true,
    ebayWrites: 0,
  }
}

export function getListingAiPromptDefinition(promptVersion = LISTING_AI_DEFAULT_PROMPT_VERSION) {
  if (promptVersion !== LISTING_AI_DEFAULT_PROMPT_VERSION) {
    throw new Error("OPENAI_LISTING_PROMPT_VERSION_UNSUPPORTED")
  }
  return {
    promptVersion,
    schemaVersion: LISTING_AI_SCHEMA_VERSION,
    engineVersion: LISTING_AI_ENGINE_VERSION,
    validationPolicyVersion: LISTING_AI_VALIDATION_POLICY_VERSION,
    systemPrompt: SYSTEM_PROMPT,
    generationPrompt: GENERATION_PROMPT,
    revisionPrompt: REVISION_PROMPT,
    hashes: {
      system: listingAiHash(SYSTEM_PROMPT),
      generation: listingAiHash(GENERATION_PROMPT),
      revision: listingAiHash(REVISION_PROMPT),
    },
  }
}

export function buildListingAiInputHash(
  input: ListingAiInput,
  promptVersion: string,
  model: string,
) {
  return listingAiHash({
    loop1PackageHash: input.packageHash,
    identityFingerprint: input.identityFingerprint,
    normalizedProductFacts: input.productFacts,
    evidenceDistillationHash: input.evidenceDistillation.distillationHash,
    pricingScenario: input.pricingScenario,
    minimumSafePrice: input.minimumSafePrice,
    targetPrice: input.targetPrice,
    promptVersion,
    model,
    schemaVersion: LISTING_AI_SCHEMA_VERSION,
  })
}

export function buildListingAiPrompt(
  input: ListingAiInput,
  context: { promptVersion: string; revisionNumber: number; validationErrors: string[] },
) {
  const definition = getListingAiPromptDefinition(context.promptVersion)
  const sanitizedErrors = context.validationErrors
    .filter((code) => /^[A-Z0-9_:.-]+$/.test(code))
    .slice(0, 30)
  return {
    system: definition.systemPrompt,
    instruction: context.revisionNumber === 0
      ? definition.generationPrompt
      : `${definition.revisionPrompt} Validation errors: ${sanitizedErrors.join(", ") || "NONE"}.`,
    structuredInput: JSON.stringify(input),
    competitorTitlesIncluded: false,
    competitorDescriptionsIncluded: false,
    competitorImagesIncluded: false,
    competitorUrlsIncluded: false,
    nearMatchesIncluded: false,
    differentPacksIncluded: false,
    differentVariantsIncluded: false,
    estimatedSignalsPresentedAsSales: false,
    rawComparablePayloadIncluded: false,
    promptHashes: definition.hashes,
  }
}

function titleCase(value: string | null) {
  if (!value) return ""
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function safeTitle(value: string) {
  const normalized = value.normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s&+.,'()/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
  return normalized.length <= 80
    ? normalized
    : normalized.slice(0, 80).replace(/\s+\S*$/, "").trim()
}

export function createFakeListingAiModelOutput(input: ListingAiInput): ListingAiModelOutput {
  const facts = input.productFacts
  const evidence = input.evidenceDistillation
  const recommendedPack = evidence.packStrategy.recommendedPack
  const brand = titleCase(facts.manufacturerBrand)
  const product = titleCase(facts.normalizedProductName)
  const pack = facts.packCount ? `${facts.packCount} Pack` : ""
  const units = facts.unitCount ? `${facts.unitCount} Count` : ""
  const variant = titleCase(facts.scent ?? facts.color ?? facts.variant)
  const approvedKeywordMap = new Map(input.approvedKeywords.map((keyword) => [
    String(normalized(keyword)), keyword,
  ]))
  const soldKeywords = evidence.keywordsAndTitles.soldKeywordRecurrence
    .map((entry) => approvedKeywordMap.get(String(normalized(entry.value))))
    .filter((entry): entry is string => Boolean(entry))
  const activeKeywords = evidence.keywordsAndTitles.activeKeywordRecurrence
    .map((entry) => approvedKeywordMap.get(String(normalized(entry.value))))
    .filter((entry): entry is string => Boolean(entry))
  const evidenceOrderedKeywords = [...new Set([
    ...soldKeywords,
    ...activeKeywords,
    ...input.approvedKeywords,
  ])]
  const soldLead = soldKeywords.find((keyword) => !activeKeywords.includes(keyword)) ?? soldKeywords[0] ?? ""
  const activeLead = activeKeywords.find((keyword) => !soldKeywords.includes(keyword)) ?? activeKeywords[0] ?? ""
  const titles = [
    safeTitle(`${brand} ${product} ${soldLead} ${variant} ${units} ${pack}`),
    safeTitle(`${product} ${brand} ${activeLead} ${pack} ${variant} ${units}`),
    safeTitle(`${brand} ${product} ${units} ${variant} ${pack} ${evidenceOrderedKeywords[2] ?? ""}`),
  ]
  const unique = [...new Set(titles)]
  while (unique.length < 3) unique.push(safeTitle(`${titles[0]} ${unique.length + 1}`))
  const factsSummary = [
    facts.packCount ? `${facts.packCount} package units` : null,
    facts.unitCount ? `${facts.unitCount} units per package` : null,
    facts.size ? `size ${facts.size}` : null,
    facts.color ? `color ${facts.color}` : null,
    facts.scent ? `scent ${facts.scent}` : null,
    facts.variant ? `variant ${facts.variant}` : null,
  ].filter((value): value is string => Boolean(value))
  const aspectMap = new Map<string, string>()
  for (const aspect of [...input.requiredAspects, ...input.optionalAspects]) {
    if (!aspectMap.has(aspect.name.toLowerCase())) aspectMap.set(aspect.name.toLowerCase(), aspect.value)
  }
  const itemSpecifics = [...aspectMap].map(([name, value]) => ({
    name: name.replace(/\b\w/g, (letter) => letter.toUpperCase()),
    value,
  }))
  const primaryKeywords = evidenceOrderedKeywords.slice(0, Math.min(3, evidenceOrderedKeywords.length))
  const secondaryKeywords = evidenceOrderedKeywords.slice(primaryKeywords.length)
  const description = `${brand} ${product} is offered in verified ${facts.condition} condition. ` +
    `Verified product details: ${factsSummary.join(", ")}. ` +
    `The package includes only ${facts.includedContents.join(", ")}. ` +
    "Review the approved item specifics and authorized product photographs for exact package details."
  return {
    primaryKeywords,
    secondaryKeywords,
    blockedKeywords: [...new Set(input.blockedClaims)],
    titleCandidates: unique.slice(0, 3),
    recommendedTitle: unique[0],
    factualBullets: [
      `Manufacturer brand: ${brand}`,
      `Product: ${product}`,
      `Package: ${factsSummary.join(", ")}`,
      `Condition: ${facts.condition}`,
    ],
    itemSpecifics,
    description,
    faq: [
      { question: "What is included?", answer: `Only ${facts.includedContents.join(", ")} is included.` },
      { question: "What is the item condition?", answer: `The verified condition is ${facts.condition}.` },
      ...(recommendedPack ? [{
        question: "How many units are included?",
        answer: recommendedPack.totalUnitCount
          ? `This offer contains exactly ${recommendedPack.packCount} pack units and ${recommendedPack.totalUnitCount} total units.`
          : `This offer contains exactly ${recommendedPack.packCount} pack units; no unsupported total-unit claim is added.`,
      }] : []),
    ],
    imageBriefs: [
      ["MAIN_WHITE_BACKGROUND", "Center the unchanged authorized product package on pure white."],
      ["PACK_AND_COUNT", "Show the verified pack and unit count without altering the package."],
      ["KEY_FEATURES", "Present only verified product facts around the authorized package photo."],
      ["SIZE_AND_CONTENT", "Clarify verified size and included contents."],
      ["USE_CONTEXT", "Show a truthful context that does not imply unsupported performance."],
      ["PACKAGE_CONTENTS", "Show exactly what the buyer receives and no additional items."],
    ].map(([slot, objective]) => {
      const evidenceStrategy = evidence.visualPatterns.recommendedSixImageStrategy
        .find((entry) => entry.slot === slot)?.strategy
      const packInstruction = slot === "PACK_AND_COUNT" && recommendedPack
        ? ` Show exactly ${recommendedPack.packCount} pack units${recommendedPack.totalUnitCount ? ` and ${recommendedPack.totalUnitCount} total units` : ""}; do not show extra units.`
        : ""
      return {
      slot: slot as ListingAiModelOutput["imageBriefs"][number]["slot"],
      objective: evidenceStrategy
        ? `${objective}${packInstruction} Evidence-informed original execution: ${evidenceStrategy}`.slice(0, 500)
        : `${objective}${packInstruction}`.slice(0, 500),
      overlayText: null,
      allowedFacts: input.allowedImageFacts.slice(0, 12),
      sourcePolicy: "AUTHORIZED_PRODUCT_IMAGE_ONLY" as const,
    }}),
    imageText: [...factsSummary,
      recommendedPack ? `${recommendedPack.packCount} pack` : null,
      recommendedPack?.totalUnitCount ? `${recommendedPack.totalUnitCount} total units` : null,
    ].filter((entry): entry is string => Boolean(entry)).slice(0, 12),
    complianceNotes: [
      "Use verified facts only.",
      "Do not alter brand, package quantity, variant, identifiers or certifications.",
    ],
    unsupportedClaims: [],
    differentiationStrategy: {
      marketPositioning: evidence.soldEvidence.exactCount
        ? "Prioritize verified sold-exact keyword recurrence while keeping active-exact terms as competition context."
        : "Use active-exact competition patterns cautiously; verified sold evidence is unavailable.",
      trustPresentation: evidence.sellerPatterns.freeShippingPrevalencePercent !== null ||
        evidence.sellerPatterns.returnsPrevalencePercent !== null ||
        evidence.sellerPatterns.visibleTrustElements.length
        ? "Present only configured fulfillment and return facts clearly; market seller patterns are context, not promises."
        : "Seller trust pattern evidence is insufficient; rely only on configured policies and verified product facts.",
      visualDifferentiation: evidence.visualPatterns.differentiationOpportunities[0] ??
        "Use an original, uncluttered gallery based only on authorized product assets.",
      evidenceConfidence: evidence.soldEvidence.exactCount
        ? evidence.soldEvidence.confidence : evidence.activeMarket.confidence,
      causalityClaimed: false,
    },
    evidenceAttribution: [
      {
        outputSection: "TITLES",
        evidenceSources: evidence.soldEvidence.exactCount
          ? ["PRODUCT_IDENTITY", "SOLD_OR_COMPLETED_EXACT_MATCHES", "ACTIVE_EXACT_MATCHES"]
          : ["PRODUCT_IDENTITY", "ACTIVE_EXACT_MATCHES"],
        confidence: evidence.keywordsAndTitles.confidence,
        rationale: evidence.soldEvidence.exactCount
          ? "Original titles prioritize recurring sold-exact terms and use active terms as competition context."
          : "Original titles use identity and active-exact terms; sold evidence is unavailable.",
      },
      {
        outputSection: "KEYWORDS",
        evidenceSources: evidence.soldEvidence.exactCount
          ? ["SOLD_OR_COMPLETED_EXACT_MATCHES", "ACTIVE_EXACT_MATCHES"]
          : ["ACTIVE_EXACT_MATCHES"],
        confidence: evidence.keywordsAndTitles.confidence,
        rationale: "Only approved recurring terms are included; competitor title text is not present.",
      },
      { outputSection: "ITEM_SPECIFICS", evidenceSources: ["PRODUCT_IDENTITY"], confidence: "STRONG", rationale: "Item specifics come from verified product identity and approved aspects." },
      { outputSection: "DESCRIPTION", evidenceSources: ["PRODUCT_IDENTITY", "COMPLIANCE"], confidence: "STRONG", rationale: "Description uses verified facts and compliance restrictions only." },
      { outputSection: "FAQ", evidenceSources: ["PRODUCT_IDENTITY", "COMPLIANCE"], confidence: "STRONG", rationale: "FAQ answers are limited to included contents and condition." },
      { outputSection: "DIFFERENTIATION", evidenceSources: ["SELLER_PATTERNS", "VISUAL_PATTERNS", "ACTIVE_EXACT_MATCHES"], confidence: evidence.visualPatterns.confidence, rationale: "Strategy uses observed associations and does not claim causality." },
      { outputSection: "PRICE_PRESENTATION", evidenceSources: ["CANONICAL_ECONOMICS"], confidence: evidence.economics.costConfidence, rationale: "Price preserves the immutable canonical minimumSafePrice." },
      { outputSection: "IMAGE_BRIEFS", evidenceSources: ["PRODUCT_IDENTITY", "VISUAL_PATTERNS"], confidence: evidence.visualPatterns.confidence, rationale: "Briefs adapt the six-image evidence strategy through original execution and authorized assets." },
      { outputSection: "COMPLIANCE", evidenceSources: ["COMPLIANCE", "PRODUCT_IDENTITY"], confidence: evidence.compliance.confidence, rationale: "Compliance notes reflect blocked claims and verified product facts." },
    ],
    pricePresentation: {
      price: input.targetPrice,
      currency: "USD",
      minimumSafePrice: input.minimumSafePrice,
      packCount: recommendedPack?.packCount ?? facts.packCount ?? 1,
      totalUnitCount: recommendedPack?.totalUnitCount ?? null,
      pricePerUnit: recommendedPack?.totalUnitCount
        ? Math.round(input.targetPrice / recommendedPack.totalUnitCount * 100) / 100 : null,
      buyerDiscountPercent: recommendedPack?.economics.buyerDiscountPercent ?? null,
      buyerDiscountVerified: recommendedPack?.economics.buyerDiscountPercent !== null &&
        recommendedPack?.economics.buyerDiscountPercent !== undefined,
    },
    experimentAlternatives: {
      titleAlternatives: unique.slice(1, 3),
      positioningAlternatives: [],
      priceExperimentAllowed: false,
    },
    factAssertions: { ...facts },
  }
}

function normalized(value: unknown) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ")
    : value
}

function flattenedOutput(output: ListingAiModelOutput) {
  return [
    ...output.titleCandidates,
    output.recommendedTitle,
    ...output.factualBullets,
    ...output.itemSpecifics.flatMap((entry) => [entry.name, entry.value]),
    output.description,
    ...output.faq.flatMap((entry) => [entry.question, entry.answer]),
    ...output.imageText,
    ...output.imageBriefs.flatMap((entry) => [entry.objective, entry.overlayText ?? ""]),
    output.differentiationStrategy.marketPositioning,
    output.differentiationStrategy.trustPresentation,
    output.differentiationStrategy.visualDifferentiation,
    ...output.evidenceAttribution.map((entry) => entry.rationale),
  ].join("\n").toLocaleLowerCase("en-US")
}

export function validateListingAiModelOutput(input: ListingAiInput, value: unknown) {
  const parsed = listingAiModelOutputSchema.safeParse(value)
  if (!parsed.success) return {
    valid: false,
    output: null,
    schemaErrors: ["LISTING_AI_SCHEMA_INVALID"],
    factualErrors: [] as string[],
    complianceErrors: [] as string[],
  }
  const output = parsed.data
  const factualErrors: string[] = []
  const expected = input.productFacts
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    const left = Array.isArray(expected[key])
      ? JSON.stringify(expected[key].map(normalized))
      : normalized(expected[key])
    const right = Array.isArray(output.factAssertions[key])
      ? JSON.stringify((output.factAssertions[key] as string[]).map(normalized))
      : normalized(output.factAssertions[key])
    if (left !== right) factualErrors.push(`FACT_ASSERTION_${String(key).toUpperCase()}_MISMATCH`)
  }
  if (output.pricePresentation.price < input.minimumSafePrice) {
    factualErrors.push("PRICE_BELOW_MINIMUM_SAFE_PRICE")
  }
  if (output.pricePresentation.minimumSafePrice !== input.minimumSafePrice) {
    factualErrors.push("MINIMUM_SAFE_PRICE_CHANGED")
  }
  if (!output.titleCandidates.some((title) => normalized(title) === normalized(output.recommendedTitle))) {
    factualErrors.push("RECOMMENDED_TITLE_NOT_A_CANDIDATE")
  }
  if (new Set(output.titleCandidates.map(normalized)).size !== 3) {
    factualErrors.push("TITLE_CANDIDATES_NOT_UNIQUE")
  }
  const recommendedPack = input.evidenceDistillation.packStrategy.recommendedPack
  if (recommendedPack && output.titleCandidates.some((title) =>
    !new RegExp(`\\b${recommendedPack.packCount}\\s*[- ]?pack\\b`, "i").test(title))) {
    factualErrors.push("PACK_COUNT_MISSING_FROM_TITLE")
  }
  const packBrief = output.imageBriefs.find((entry) => entry.slot === "PACK_AND_COUNT")
  if (recommendedPack && (!packBrief || !packBrief.objective.includes(String(recommendedPack.packCount)))) {
    factualErrors.push("PACK_COUNT_MISSING_FROM_IMAGE_BRIEF")
  }
  if (recommendedPack?.totalUnitCount &&
    (!packBrief || !packBrief.objective.includes(String(recommendedPack.totalUnitCount)))) {
    factualErrors.push("TOTAL_UNIT_COUNT_MISSING_FROM_IMAGE_BRIEF")
  }
  if (recommendedPack && output.pricePresentation.packCount !== recommendedPack.packCount) {
    factualErrors.push("PRICE_PRESENTATION_PACK_COUNT_MISMATCH")
  }
  if (recommendedPack && output.pricePresentation.totalUnitCount !== recommendedPack.totalUnitCount) {
    factualErrors.push("PRICE_PRESENTATION_TOTAL_UNIT_COUNT_MISMATCH")
  }
  if (recommendedPack && output.pricePresentation.buyerDiscountPercent !==
    recommendedPack.economics.buyerDiscountPercent) {
    factualErrors.push("BUYER_DISCOUNT_CHANGED_OR_INVENTED")
  }
  if (output.pricePresentation.buyerDiscountVerified !==
    (recommendedPack?.economics.buyerDiscountPercent !== null &&
      recommendedPack?.economics.buyerDiscountPercent !== undefined)) {
    factualErrors.push("BUYER_DISCOUNT_VERIFICATION_MISMATCH")
  }
  if (input.evidenceDistillation.soldEvidence.exactCount === 0 &&
    output.evidenceAttribution.some((entry) =>
      entry.evidenceSources.includes("SOLD_OR_COMPLETED_EXACT_MATCHES"))) {
    factualErrors.push("SOLD_EVIDENCE_ATTRIBUTION_UNSUPPORTED")
  }
  const generatedKeywords = [...output.primaryKeywords, ...output.secondaryKeywords]
  const allowedKeywords = new Set(input.approvedKeywords.map(normalized))
  if (generatedKeywords.some((keyword) => !allowedKeywords.has(normalized(keyword)))) {
    factualErrors.push("UNAUTHORIZED_KEYWORD")
  }
  for (const aspect of input.requiredAspects) {
    const found = output.itemSpecifics.some((item) =>
      normalized(item.name) === normalized(aspect.name) &&
      normalized(item.value) === normalized(aspect.value)
    )
    if (!found) factualErrors.push(`REQUIRED_ASPECT_MISSING:${aspect.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`)
  }
  const content = flattenedOutput(output)
  const generatedGtins = content.match(/\b\d{8,14}\b/g) ?? []
  if (generatedGtins.some((gtin) => gtin !== expected.gtin)) {
    factualErrors.push("UNVERIFIED_GTIN_OR_NUMERIC_IDENTIFIER")
  }
  const compatibilityAllowed = input.complianceRestrictions.some((entry) =>
    normalized(entry) === "compatibility verified"
  )
  if (!compatibilityAllowed && /\b(?:compatible with|fits|works with)\b/i.test(content)) {
    factualErrors.push("UNVERIFIED_COMPATIBILITY")
  }
  const complianceErrors = [...UNIVERSAL_BLOCKED_TERMS, ...input.blockedClaims]
    .map((term) => String(normalized(term)))
    .filter(Boolean)
    .filter((term) => content.includes(term))
    .map((term) => `BLOCKED_CLAIM:${term}`)
  if (output.unsupportedClaims.length) complianceErrors.push("UNSUPPORTED_CLAIMS_PRESENT")
  return {
    valid: factualErrors.length === 0 && complianceErrors.length === 0,
    output,
    schemaErrors: [] as string[],
    factualErrors: [...new Set(factualErrors)],
    complianceErrors: [...new Set(complianceErrors)],
  }
}

const COST_POLICY = {
  version: "OPENAI_LISTING_CONSERVATIVE_COST_V1",
  inputPerMillionUsd: 5,
  cachedInputPerMillionUsd: 5,
  outputPerMillionUsd: 30,
}

export function estimateListingAiCost(usage: ListingAiUsage) {
  const input = Math.max(0, usage.inputTokens ?? 0)
  const cached = Math.min(input, Math.max(0, usage.cachedInputTokens ?? 0))
  const uncached = input - cached
  const output = Math.max(0, usage.outputTokens ?? 0)
  const cost = uncached / 1_000_000 * COST_POLICY.inputPerMillionUsd +
    cached / 1_000_000 * COST_POLICY.cachedInputPerMillionUsd +
    output / 1_000_000 * COST_POLICY.outputPerMillionUsd
  return Math.round(cost * 1_000_000) / 1_000_000
}

export function estimateListingAiPreflightCost(input: ListingAiInput, promptVersion: string) {
  const prompt = buildListingAiPrompt(input, { promptVersion, revisionNumber: 0, validationErrors: [] })
  const estimatedInputTokens = Math.ceil(
    (prompt.system.length + prompt.instruction.length + prompt.structuredInput.length) / 4,
  )
  return {
    estimatedInputTokens,
    maxOutputTokens: 6_000,
    estimatedCostUsd: estimateListingAiCost({
      inputTokens: estimatedInputTokens,
      cachedInputTokens: 0,
      outputTokens: 6_000,
    }),
    costPolicyVersion: COST_POLICY.version,
  }
}

export function evaluateListingAiBudget(input: {
  spentUsd: number
  projectedCostUsd: number
  warningBudgetUsd: number
  hardStopUsd: number
}) {
  const spent = Math.max(0, input.spentUsd)
  const projected = Math.max(0, input.projectedCostUsd)
  return {
    warningReached: spent >= input.warningBudgetUsd || spent + projected >= input.warningBudgetUsd,
    hardStopReached: spent >= input.hardStopUsd || spent + projected > input.hardStopUsd,
    projectedTotalUsd: Math.round((spent + projected) * 1_000_000) / 1_000_000,
    clientBypassAllowed: false,
  }
}

export function listingAiCacheDisposition(status: string) {
  if (["GENERATED", "HUMAN_REVIEW_REQUIRED", "APPROVED"].includes(status)) {
    return "CACHE_HIT" as const
  }
  if (status === "GENERATING") return "IN_PROGRESS" as const
  return "TERMINAL_NO_RETRY" as const
}

export function finalizeListingAiOutput(input: {
  modelOutput: ListingAiModelOutput
  provider: "OPENAI" | "FAKE"
  model: string
  revisionNumber: number
  usage: ListingAiUsage
  promptVersion: string
  inputHash: string
}) {
  const withoutHash = {
    ...input.modelOutput,
    schemaVersion: LISTING_AI_SCHEMA_VERSION as typeof LISTING_AI_SCHEMA_VERSION,
    modelMetadata: {
      provider: input.provider,
      model: input.model,
      revisionNumber: input.revisionNumber,
      inputTokens: input.usage.inputTokens,
      cachedInputTokens: input.usage.cachedInputTokens,
      outputTokens: input.usage.outputTokens,
      estimatedCostUsd: estimateListingAiCost(input.usage),
    },
    promptVersion: input.promptVersion,
    inputHash: input.inputHash,
  }
  return listingAiCanonicalOutputSchema.parse({
    ...withoutHash,
    outputHash: listingAiHash(withoutHash),
  })
}

export function createFakeListingAiAdapter(input: {
  scenario?: "SUCCESS" | "MALFORMED_JSON" | "SCHEMA_ERROR" | "FACTUAL_FAILURE" |
    "COMPLIANCE_FAILURE" | "TEMPORARY_ERROR" | "TIMEOUT" | "UNAVAILABLE_MODEL"
} = {}): ListingAiAdapter {
  const scenario = input.scenario ?? "SUCCESS"
  return {
    async generate(factoryInput, context) {
      if (scenario === "TEMPORARY_ERROR") throw new Error("OPENAI_LISTING_TEMPORARY_ERROR")
      if (scenario === "TIMEOUT") throw new Error("OPENAI_LISTING_TIMEOUT")
      if (scenario === "UNAVAILABLE_MODEL") throw new Error("OPENAI_LISTING_MODEL_UNAVAILABLE")
      if (scenario === "MALFORMED_JSON") return {
        output: "{not-json",
        provider: "FAKE",
        model: "fake-listing-ai-v2",
        sanitizedRequestId: null,
        usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null },
      }
      if (scenario === "SCHEMA_ERROR") return {
        output: {},
        provider: "FAKE",
        model: "fake-listing-ai-v2",
        sanitizedRequestId: null,
        usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null },
      }
      const output = createFakeListingAiModelOutput(factoryInput)
      if (scenario === "FACTUAL_FAILURE") output.factAssertions.packCount =
        (factoryInput.productFacts.packCount ?? 1) + 1
      if (scenario === "COMPLIANCE_FAILURE") output.description += " FDA approved."
      return {
        output,
        provider: "FAKE",
        model: "fake-listing-ai-v2",
        sanitizedRequestId: listingAiHash({ scenario, revision: context.revisionNumber }),
        usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      }
    },
  }
}

const listingAiModelJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "primaryKeywords", "secondaryKeywords", "blockedKeywords", "titleCandidates",
    "recommendedTitle", "factualBullets", "itemSpecifics", "description", "faq",
    "imageBriefs", "imageText", "complianceNotes", "unsupportedClaims",
    "differentiationStrategy", "evidenceAttribution", "pricePresentation",
    "experimentAlternatives", "factAssertions",
  ],
  properties: {
    primaryKeywords: { type: "array", minItems: 1, maxItems: 10, items: { type: "string" } },
    secondaryKeywords: { type: "array", maxItems: 30, items: { type: "string" } },
    blockedKeywords: { type: "array", maxItems: 50, items: { type: "string" } },
    titleCandidates: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
    recommendedTitle: { type: "string" },
    factualBullets: { type: "array", minItems: 3, maxItems: 8, items: { type: "string" } },
    itemSpecifics: {
      type: "array", minItems: 1, maxItems: 50,
      items: { type: "object", additionalProperties: false, required: ["name", "value"], properties: { name: { type: "string" }, value: { type: "string" } } },
    },
    description: { type: "string" },
    faq: {
      type: "array", minItems: 2, maxItems: 8,
      items: { type: "object", additionalProperties: false, required: ["question", "answer"], properties: { question: { type: "string" }, answer: { type: "string" } } },
    },
    imageBriefs: {
      type: "array", minItems: 6, maxItems: 6,
      items: {
        type: "object", additionalProperties: false,
        required: ["slot", "objective", "overlayText", "allowedFacts", "sourcePolicy"],
        properties: {
          slot: { type: "string", enum: ["MAIN_WHITE_BACKGROUND", "PACK_AND_COUNT", "KEY_FEATURES", "SIZE_AND_CONTENT", "USE_CONTEXT", "PACKAGE_CONTENTS"] },
          objective: { type: "string" },
          overlayText: { type: ["string", "null"] },
          allowedFacts: { type: "array", maxItems: 12, items: { type: "string" } },
          sourcePolicy: { type: "string", enum: ["AUTHORIZED_PRODUCT_IMAGE_ONLY"] },
        },
      },
    },
    imageText: { type: "array", maxItems: 12, items: { type: "string" } },
    complianceNotes: { type: "array", maxItems: 30, items: { type: "string" } },
    unsupportedClaims: { type: "array", maxItems: 30, items: { type: "string" } },
    differentiationStrategy: {
      type: "object", additionalProperties: false,
      required: ["marketPositioning", "trustPresentation", "visualDifferentiation", "evidenceConfidence", "causalityClaimed"],
      properties: {
        marketPositioning: { type: "string" }, trustPresentation: { type: "string" },
        visualDifferentiation: { type: "string" },
        evidenceConfidence: { type: "string", enum: ["STRONG", "MEDIUM", "LOW", "INSUFFICIENT"] },
        causalityClaimed: { type: "boolean", enum: [false] },
      },
    },
    evidenceAttribution: {
      type: "array", minItems: 6, maxItems: 12,
      items: {
        type: "object", additionalProperties: false,
        required: ["outputSection", "evidenceSources", "confidence", "rationale"],
        properties: {
          outputSection: { type: "string", enum: ["TITLES", "KEYWORDS", "ITEM_SPECIFICS", "DESCRIPTION", "FAQ", "DIFFERENTIATION", "PRICE_PRESENTATION", "IMAGE_BRIEFS", "COMPLIANCE"] },
          evidenceSources: { type: "array", minItems: 1, maxItems: 7, items: { type: "string", enum: ["PRODUCT_IDENTITY", "ACTIVE_EXACT_MATCHES", "SOLD_OR_COMPLETED_EXACT_MATCHES", "SELLER_PATTERNS", "VISUAL_PATTERNS", "CANONICAL_ECONOMICS", "COMPLIANCE"] } },
          confidence: { type: "string", enum: ["STRONG", "MEDIUM", "LOW", "INSUFFICIENT"] },
          rationale: { type: "string" },
        },
      },
    },
    pricePresentation: {
      type: "object", additionalProperties: false,
      required: ["price", "currency", "minimumSafePrice", "packCount", "totalUnitCount", "pricePerUnit", "buyerDiscountPercent", "buyerDiscountVerified"],
      properties: {
        price: { type: "number" }, currency: { type: "string", enum: ["USD"] },
        minimumSafePrice: { type: "number" }, packCount: { type: "integer" },
        totalUnitCount: { type: ["integer", "null"] }, pricePerUnit: { type: ["number", "null"] },
        buyerDiscountPercent: { type: ["number", "null"] }, buyerDiscountVerified: { type: "boolean" },
      },
    },
    experimentAlternatives: {
      type: "object", additionalProperties: false,
      required: ["titleAlternatives", "positioningAlternatives", "priceExperimentAllowed"],
      properties: {
        titleAlternatives: { type: "array", maxItems: 3, items: { type: "string" } },
        positioningAlternatives: { type: "array", maxItems: 3, items: { type: "string" } },
        priceExperimentAllowed: { type: "boolean", enum: [false] },
      },
    },
    factAssertions: {
      type: "object", additionalProperties: false,
      required: ["manufacturerBrand", "manufacturer", "gtin", "mpn", "model", "normalizedProductName", "packCount", "unitCount", "size", "color", "scent", "variant", "condition", "includedContents"],
      properties: {
        manufacturerBrand: { type: ["string", "null"] }, manufacturer: { type: ["string", "null"] },
        gtin: { type: ["string", "null"] }, mpn: { type: ["string", "null"] }, model: { type: ["string", "null"] },
        normalizedProductName: { type: "string" }, packCount: { type: ["integer", "null"] }, unitCount: { type: ["integer", "null"] },
        size: { type: ["string", "null"] }, color: { type: ["string", "null"] }, scent: { type: ["string", "null"] },
        variant: { type: ["string", "null"] }, condition: { type: "string", enum: ["new"] },
        includedContents: { type: "array", maxItems: 30, items: { type: "string" } },
      },
    },
  },
} as const

function extractResponseText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    if (!item || typeof item !== "object") continue
    for (const content of Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as unknown[] : []) {
      if (!content || typeof content !== "object") continue
      const entry = content as Record<string, unknown>
      if (entry.type === "output_text" && typeof entry.text === "string") return entry.text
    }
  }
  return null
}

export function createRealOpenAiListingAdapter(environment: NodeJS.ProcessEnv = process.env): ListingAiAdapter {
  const configuration = getListingAiConfiguration(environment)
  const apiKey = environment.OPENAI_API_KEY?.trim() ?? ""
  const model = environment.OPENAI_LISTING_MODEL?.trim() ?? ""
  const timeoutMs = boundedInteger(environment.OPENAI_LISTING_TIMEOUT_MS, 25_000, 5_000, 55_000)
  const maxRetries = boundedInteger(environment.OPENAI_LISTING_MAX_RETRIES, 1, 0, 1)
  if (!configuration.realReady || !apiKey || !model) {
    throw new Error("OPENAI_LISTING_CONFIGURATION_MISSING")
  }
  return {
    async generate(input, context) {
      const prompt = buildListingAiPrompt(input, context)
      let lastCode = "OPENAI_LISTING_REQUEST_FAILED"
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          const response = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              store: false,
              max_output_tokens: 6_000,
              input: [
                { role: "system", content: prompt.system },
                { role: "user", content: `${prompt.instruction}\n${prompt.structuredInput}` },
              ],
              text: {
                format: {
                  type: "json_schema",
                  name: "ebay_listing_ai_factory_v2",
                  strict: true,
                  schema: listingAiModelJsonSchema,
                },
              },
            }),
            cache: "no-store",
            signal: AbortSignal.timeout(timeoutMs),
          })
          if (!response.ok) {
            const code = `OPENAI_LISTING_HTTP_${response.status}`
            if (![429, 500, 502, 503, 504].includes(response.status) || attempt === maxRetries) {
              throw new Error(code)
            }
            lastCode = code
            continue
          }
          const payload = await response.json() as Record<string, unknown>
          if (payload.status !== "completed") throw new Error("OPENAI_LISTING_RESPONSE_INCOMPLETE")
          const outputText = extractResponseText(payload)
          if (!outputText) throw new Error("OPENAI_LISTING_OUTPUT_MISSING")
          let output: unknown
          try {
            output = JSON.parse(outputText)
          } catch {
            throw new Error("OPENAI_LISTING_OUTPUT_JSON_INVALID")
          }
          const usage = payload.usage && typeof payload.usage === "object"
            ? payload.usage as Record<string, unknown> : {}
          const inputDetails = usage.input_tokens_details && typeof usage.input_tokens_details === "object"
            ? usage.input_tokens_details as Record<string, unknown> : {}
          return {
            output,
            provider: "OPENAI",
            model,
            sanitizedRequestId: typeof payload.id === "string" ? listingAiHash(payload.id) : null,
            usage: {
              inputTokens: Number.isFinite(Number(usage.input_tokens)) ? Number(usage.input_tokens) : null,
              cachedInputTokens: Number.isFinite(Number(inputDetails.cached_tokens)) ? Number(inputDetails.cached_tokens) : null,
              outputTokens: Number.isFinite(Number(usage.output_tokens)) ? Number(usage.output_tokens) : null,
            },
          }
        } catch (error) {
          const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
            ? error.message
            : error instanceof DOMException && error.name === "TimeoutError"
              ? "OPENAI_LISTING_TIMEOUT"
              : "OPENAI_LISTING_REQUEST_FAILED"
          lastCode = code
          if (attempt === maxRetries || ![
            "OPENAI_LISTING_REQUEST_FAILED", "OPENAI_LISTING_TIMEOUT",
            "OPENAI_LISTING_HTTP_429", "OPENAI_LISTING_HTTP_500",
            "OPENAI_LISTING_HTTP_502", "OPENAI_LISTING_HTTP_503", "OPENAI_LISTING_HTTP_504",
          ].includes(code)) throw new Error(code)
        }
      }
      throw new Error(lastCode)
    },
  }
}
