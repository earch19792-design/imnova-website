import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { buildSmartStockingLearningProfileV1,
  updateSmartStockingDecisionSnapshotV1 } from
  // @ts-expect-error Node direct TypeScript tests require the explicit extension;
  // the production bundler resolves the same source module.
  "./ebay-smart-stocking-learning-profile-v1.ts"
import type { RadarMarketplaceTaxonomyReaderV1 } from
  "./ebay-radar-canonical-marketplace-readiness-v1"
import { lunaOwnerCertifiedNewMerchandiseConditionV1 } from
  // @ts-expect-error Node direct TypeScript tests require the explicit
  // extension; the production bundler resolves the same source module.
  "./ebay-manual-listing-domain.ts"

export const SELLER_OS_DETERMINISTIC_FACTORY =
  "SELLER_OS_DETERMINISTIC_FACTORY" as const
export const SELLER_OS_DURABLE_FACTORY_VERSION =
  "SELLER_OS_GENERAL_DURABLE_FACTORY_AUTHORITY_V1" as const
export const SMART_STOCKING_LISTING_INTAKE_VERSION =
  "SELLER_OS_SMART_STOCKING_LISTING_INTAKE_V1" as const
export const SELLER_OS_RADAR_DECISION_PACKAGE_BINDING_VERSION =
  "SELLER_OS_RADAR_DECISION_PACKAGE_BINDING_V1" as const

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function strings(value: unknown, limit = 50) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim()).filter(Boolean).slice(0, limit)
    : []
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function number(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

function canonical(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`
}

function unique(values: readonly string[]) {
  return [...new Set(values)]
}

const PRODUCT_TRUTH_CORE_FIELDS = new Set([
  "authorityClass", "candidateKey", "evidenceDigest", "lunaProductId",
  "lunaVariantId", "supplierSku", "gtin", "supplierPriceUsd", "title",
  "sourceUrl", "imageCount", "rawHtmlStored", "marketplaceWrites", "stock",
  "brand", "provenProductValues", "knownUnknownAspectNames",
  "unprovenAspectEvidenceRequirements", "sourceEvidence",
])

export function resolveSellerOsExactProductTruthV1(opportunity: JsonRecord) {
  const assessment = record(opportunity.assessment)
  const truth = record(assessment.productTruth)
  const stock = record(truth.stock)
  const radar = record(assessment.radarFactoryCandidateV1)
  const candidate = record(assessment.candidate)
  const queueCandidateBound = truth.candidateKey === opportunity.candidate_key
  const radarCandidateBound = radar.contractVersion ===
      "NIGHT_RADAR_AUTOMATIC_GOLDEN_PATH_HANDOFF_V1"
    && radar.authority === SELLER_OS_DETERMINISTIC_FACTORY
    && /^sha256:[0-9a-f]{64}$/.test(String(radar.candidateId ?? ""))
    && radar.demandEvidenceGrain === "FAMILY"
    && radar.exactProductDemandClaimed === false
    && truth.candidateKey === radar.candidateId
    && candidate.candidateKey === radar.candidateId
    && candidate.supplierProductId === opportunity.supplier_product_id
    && candidate.supplierVariantId === opportunity.supplier_variant_id
    && candidate.sku === opportunity.supplier_sku
    && candidate.gtin === opportunity.gtin
  const exact = truth.authorityClass === "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1"
    && /^sha256:[0-9a-f]{64}$/.test(String(truth.evidenceDigest ?? ""))
    && (queueCandidateBound || radarCandidateBound)
    && truth.lunaProductId === opportunity.supplier_product_id
    && truth.lunaVariantId === opportunity.supplier_variant_id
    && truth.supplierSku === opportunity.supplier_sku
    && truth.gtin === opportunity.gtin
    && stock.exactIdentityVerified === true
  const unsupportedAttributeCount = Object.keys(truth).filter((field) =>
    !PRODUCT_TRUTH_CORE_FIELDS.has(field)).length
  return Object.freeze({
    exact,
    truth,
    stock,
    bindingClass: queueCandidateBound ? "QUEUE_CANDIDATE_KEY" as const
      : radarCandidateBound ? "RADAR_CANDIDATE_ID" as const : "UNRESOLVED" as const,
    acquisitionRequired: !exact,
    reused: exact,
    source: exact ? String(truth.authorityClass) : null,
    durable: exact,
    readbackMatch: exact,
    unsupportedAttributeCount,
    unsupportedAttributesPersisted: unsupportedAttributeCount,
  })
}

function exactProductTruth(opportunity: JsonRecord) {
  return resolveSellerOsExactProductTruthV1(opportunity)
}

function familyDemand(frontier: JsonRecord) {
  return text(record(frontier.frontier_payload).familyDemandStatus)
}

export function getSellerOsRadarPriceDistributionEconomicsV1(value: unknown) {
  const frontier = record(value)
  const continuation = record(
    frontier.radarAutomaticPriceDistributionContinuationV1)
  const economics = record(continuation.targetEconomics)
  const targetPrice = number(continuation.targetPrice)
  const profit = number(economics.profit)
  const margin = number(economics.marginPercent)
  const roi = number(economics.roiPercent)
  const estimatedEbayFees = number(economics.estimatedEbayFees)
  const valid = continuation.contractVersion ===
      "RADAR_AUTOMATIC_PRICE_DISTRIBUTION_CONTINUATION_V1"
    && continuation.demandEvidenceGrain === "FAMILY"
    && continuation.exactProductDemandClaimed === false
    && /^sha256:[0-9a-f]{64}$/.test(String(continuation.evidenceDigest ?? ""))
    && continuation.targetPriceWithinSupportedDistribution === true
    && continuation.marginFloorPass === true
    && continuation.economicsReady === true
    && continuation.finalDisposition === "ECONOMICS_READY"
    && targetPrice !== null && targetPrice > 0
    && profit !== null && profit > 0 && margin !== null && margin >= 20
    && roi !== null && roi >= 30 && estimatedEbayFees !== null
  return valid ? Object.freeze({ economicsReady: true as const,
    targetPrice, profit, margin, roi, estimatedEbayFees }) : null
}

export function getSellerOsQuickPickMarketTestEconomicsV1(value: unknown) {
  const frontier = record(value)
  const marker = record(frontier.quickPickMarketTestV1)
  const targetPrice = number(marker.testPrice)
  const profit = number(marker.testPriceProfit)
  const margin = number(marker.testPriceMargin)
  const roi = number(marker.testPriceRoi)
  const estimatedEbayFees = number(marker.ebayFees)
  const valid = marker.contractVersion === "LUNA_QUICK_PICK_MARKET_TEST_PATH_V1"
    && marker.demandEvidenceClass ===
      "UNPROVEN_INSUFFICIENT_MARKET_EVIDENCE"
    && marker.demandNegativeEvidencePresent === false
    && marker.marketPriceSupport === "UNPROVEN"
    && marker.priceCompetitiveness === "UNPROVEN"
    && marker.testPriceBasis === "MINIMUM_MARGIN_SAFE_PRICE"
    && marker.economicsMarginFloorPass === true
    && marker.economicsReady === true
    && frontier.shippingStatus === "SHIPPING_DURABLY_PERSISTED"
    && frontier.nextBestEvidence === "NONE"
    && targetPrice !== null && targetPrice > 0 && profit !== null && profit > 0
    && margin !== null && margin >= 20 && roi !== null && roi >= 30
    && estimatedEbayFees !== null && estimatedEbayFees >= 0
  return valid ? Object.freeze({ economicsReady: true as const, targetPrice,
    profit, margin, roi, estimatedEbayFees }) : null
}

function normalizeProfitabilityFrontier(value: unknown) {
  const outer = record(value)
  const inner = record(outer.frontier)
  const target = getSellerOsRadarPriceDistributionEconomicsV1(inner)
  const marketTestTarget = getSellerOsQuickPickMarketTestEconomicsV1(inner)
  return {
    frontier_id: outer.frontierId,
    frontier_digest: inner.frontierDigest,
    snapshot_digest: outer.snapshotDigest,
    opportunity_case_id: outer.opportunityCaseId,
    market_price_evidence_reference: outer.marketPriceEvidenceReference,
    market_price_evidence_digest: outer.marketPriceEvidenceDigest,
    economic_policy_digest: outer.economicPolicyDigest,
    luna_product_id: inner.lunaProductId,
    luna_variant_id: inner.lunaVariantId,
    luna_sku: inner.lunaSku,
    frontier_payload: inner,
    economic_classification: inner.economicClassification,
    shipping_status: inner.shippingStatus,
    next_best_evidence: inner.nextBestEvidence,
    contribution_profit_median: inner.contributionProfitAtMarketMedian,
    contribution_margin_median: inner.contributionMarginAtMarketMedian,
    luna_cost: inner.lunaUnitCost,
    shipping_value: inner.shippingValue,
    market_price_median: inner.marketPriceMedian,
    ebay_fee_estimate_at_median: inner.ebayFeeEstimateAtMedian,
    radar_price_distribution_target: target,
    quick_pick_market_test_target: marketTestTarget,
    hard_blockers: inner.currentHardBlockers ?? inner.hardBlockers,
  }
}

function exactSupplierIdentity(opportunity: JsonRecord, frontier: JsonRecord) {
  return Boolean(
    text(opportunity.candidate_key)
    && text(opportunity.supplier_product_id)
    && text(opportunity.supplier_variant_id)
    && text(opportunity.supplier_sku)
    && opportunity.supplier_product_id === frontier.luna_product_id
    && opportunity.supplier_variant_id === frontier.luna_variant_id
    && opportunity.supplier_sku === frontier.luna_sku,
  )
}

function decisionPackageAuthority(
  opportunity: JsonRecord,
  frontier: JsonRecord,
  decisionPackage: unknown,
) {
  const row = record(decisionPackage)
  const payload = record(row.package_payload)
  const identity = record(record(payload.productIdentity).identity)
  const profile = record(row.smart_stocking_learning_profile)
  const entry = record(profile.entrySnapshot)
  const decision = record(profile.decisionSnapshot)
  const economics = record(decision.finalEconomics)
  const assessment = record(opportunity.assessment)
  const radar = record(assessment.radarFactoryCandidateV1)
  const truth = record(assessment.productTruth)
  const binding = record(payload.identityBinding)
  const frontierBinding = record(binding.economicsFrontier)
  const { packageHash: payloadPackageHash, ...payloadWithoutHash } = payload
  const radarBindingExact = payload.contractVersion ===
      SELLER_OS_RADAR_DECISION_PACKAGE_BINDING_VERSION
    && payload.authority === SELLER_OS_DETERMINISTIC_FACTORY
    && payload.serverOwned === true
    && payload.humanApproved === false
    && payload.queueCandidateKey === opportunity.candidate_key
    && payload.radarCandidateId === radar.candidateId
    && payload.supplierProductId === opportunity.supplier_product_id
    && payload.supplierVariantId === opportunity.supplier_variant_id
    && payload.supplierSku === opportunity.supplier_sku
    && binding.familyId === record(frontier.frontier_payload).familyId
    && binding.opportunityCaseId === frontier.opportunity_case_id
    && binding.demandEvidenceGrain === "FAMILY"
    && binding.exactProductDemandClaimed === false
    && binding.demandEvidenceDigest === frontier.market_price_evidence_digest
    && binding.priceEvidenceScope === "FAMILY"
    && binding.marketPriceEvidenceReference ===
      frontier.market_price_evidence_reference
    && binding.marketPriceEvidenceDigest ===
      frontier.market_price_evidence_digest
    && binding.productTruthDigest === truth.evidenceDigest
    && frontierBinding.frontierId === frontier.frontier_id
    && frontierBinding.frontierDigest === frontier.frontier_digest
    && frontierBinding.frontierSnapshotDigest === frontier.snapshot_digest
    && /^sha256:[0-9a-f]{64}$/.test(String(payload.identityBindingDigest ?? ""))
    && /^sha256:[0-9a-f]{64}$/.test(String(payload.packageHash ?? ""))
    && payload.identityBindingDigest === digest(binding)
    && payloadPackageHash === digest(payloadWithoutHash)
    && row.package_hash === payload.packageHash
  const legacyExact = payload.contractVersion !==
      SELLER_OS_RADAR_DECISION_PACKAGE_BINDING_VERSION
    && payload.supplierSku === opportunity.supplier_sku
    && payload.supplierVariantId === opportunity.supplier_variant_id
    && identity.gtin === opportunity.gtin
  const exact = /^[0-9a-f-]{36}$/i.test(String(row.id ?? ""))
    && row.status === "GENERATED"
    && (radarBindingExact || legacyExact)
    && profile.profileVersion === "SELLER_OS_SMART_STOCKING_LEARNING_PROFILE_V1"
    && /^sha256:[0-9a-f]{64}$/.test(String(profile.entrySnapshotHash ?? ""))
    && /^sha256:[0-9a-f]{64}$/.test(String(profile.decisionSnapshotHash ?? ""))
    && economics.status === "PASS"
    && economics.thresholdResult === "PASS"
  return { exact, radarBindingExact, row, profile, entry, decision, economics }
}

export function lunaQuickPickOwnerCertifiedConditionAuthorityV1(
  opportunity: JsonRecord,
  frontier: JsonRecord,
) {
  const assessment = record(opportunity.assessment)
  const intelligence = record(assessment.listingIntelligencePackage)
  const category = record(intelligence.categoryRecommendation)
  const quickPick = record(assessment.lunaQuickPickOperationV1)
  return quickPick.contractVersion ===
      "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1"
      && quickPick.candidateKey === opportunity.candidate_key
      && quickPick.lunaProductId === opportunity.supplier_product_id
      && quickPick.lunaVariantId === opportunity.supplier_variant_id
      && quickPick.supplierSku === opportunity.supplier_sku
    ? lunaOwnerCertifiedNewMerchandiseConditionV1({
      exactProductIdentityProven: exactSupplierIdentity(opportunity, frontier)
        && exactProductTruth(opportunity).exact,
      lunaProductId: opportunity.supplier_product_id,
      lunaVariantId: opportunity.supplier_variant_id,
      supplierSku: opportunity.supplier_sku,
      categoryId: category.categoryId,
    }) : null
}

function listingSeed(opportunity: JsonRecord, frontier: JsonRecord) {
  const assessment = record(opportunity.assessment)
  const intelligence = record(assessment.listingIntelligencePackage)
  const candidate = record(assessment.candidate)
  const category = record(intelligence.categoryRecommendation)
  const titleStrategy = record(intelligence.titleStrategy)
  const itemSpecifics = record(intelligence.itemSpecifics)
  const conditionAuthority =
    lunaQuickPickOwnerCertifiedConditionAuthorityV1(opportunity, frontier)
  return {
    title: String(intelligence.recommendedTitle ?? titleStrategy.titleFormula
      ?? opportunity.product_title ?? "").slice(0, 80),
    categoryId: text(category.categoryId),
    categoryName: text(category.categoryName),
    aspects: record(itemSpecifics.supplierConfirmed),
    ...(conditionAuthority ? {
      conditionId: conditionAuthority.conditionId,
      conditionLabel: conditionAuthority.conditionLabel,
      conditionAuthority,
    } : {}),
    description: String(candidate.description ?? ""),
    imageUrls: strings(candidate.imageUrls, 24),
    pricing: {
      supplierCost: number(opportunity.supplier_price),
      targetPrice: number(record(frontier.radar_price_distribution_target)
        .targetPrice) ?? number(opportunity.median_total_buyer_price),
    },
    evidenceSnapshot: {
      assessment,
      hardGates: strings(opportunity.hard_gates),
      evidenceGuards: strings(opportunity.evidence_guards),
    },
  }
}

export function buildSellerOsRadarDecisionPackageBindingV1(input: Readonly<{
  opportunity: JsonRecord
  frontier: JsonRecord
  existingLearningProfile?: unknown
}>) {
  const { opportunity, frontier } = input
  const assessment = record(opportunity.assessment)
  const radar = record(assessment.radarFactoryCandidateV1)
  const truth = record(assessment.productTruth)
  const stock = record(truth.stock)
  const frontierPayload = record(frontier.frontier_payload)
  const target = record(frontier.radar_price_distribution_target)
  const targetPrice = number(target.targetPrice) ??
    number(frontier.market_price_median)
  const profit = number(target.profit) ??
    number(frontier.contribution_profit_median)
  const margin = number(target.margin) ??
    number(frontier.contribution_margin_median)
  const supplierCost = number(frontier.luna_cost)
  const shipping = number(frontier.shipping_value)
  const ebayFees = number(target.estimatedEbayFees) ??
    number(frontier.ebay_fee_estimate_at_median)
  const roi = number(target.roi) ?? (profit !== null && supplierCost !== null &&
    shipping !== null && supplierCost + shipping > 0
    ? round(profit / (supplierCost + shipping) * 100) : null)
  const familyId = text(frontierPayload.familyId)
  const opportunityCaseId = text(frontier.opportunity_case_id)
  const demandEvidenceDigest = text(frontier.market_price_evidence_digest)
  const radarCandidateId = text(radar.candidateId)
  const productTruthDigest = text(truth.evidenceDigest)
  const exactIdentity = radar.contractVersion ===
      "NIGHT_RADAR_AUTOMATIC_GOLDEN_PATH_HANDOFF_V1"
    && radar.authority === SELLER_OS_DETERMINISTIC_FACTORY
    && radar.demandEvidenceGrain === "FAMILY"
    && radar.exactProductDemandClaimed === false
    && radar.familyId === familyId
    && /^sha256:[0-9a-f]{64}$/.test(radarCandidateId ?? "")
    && truth.authorityClass === "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1"
    && truth.candidateKey === radarCandidateId
    && truth.lunaProductId === opportunity.supplier_product_id
    && truth.lunaVariantId === opportunity.supplier_variant_id
    && truth.supplierSku === opportunity.supplier_sku
    && truth.gtin === opportunity.gtin
    && stock.exactIdentityVerified === true
  const evidenceExact = /^market-family-v1:sha256:[0-9a-f]{64}$/.test(
      familyId ?? "")
    && /^opportunity-case-v1:sha256:[0-9a-f]{64}$/.test(
      opportunityCaseId ?? "")
    && /^sha256:[0-9a-f]{64}$/.test(demandEvidenceDigest ?? "")
    && /^sha256:[0-9a-f]{64}$/.test(productTruthDigest ?? "")
    && /^profitability-frontier-v1:sha256:[0-9a-f]{64}$/.test(
      String(frontier.frontier_id ?? ""))
    && /^sha256:[0-9a-f]{64}$/.test(String(frontier.frontier_digest ?? ""))
    && /^sha256:[0-9a-f]{64}$/.test(String(frontier.snapshot_digest ?? ""))
    && text(frontier.market_price_evidence_reference) !== null
  const economicsExact = targetPrice !== null && targetPrice > 0
    && profit !== null && profit > 0 && margin !== null && margin >= 20
    && roi !== null && roi >= 30 && supplierCost !== null && supplierCost >= 0
    && shipping !== null && shipping >= 0 && ebayFees !== null && ebayFees >= 0
    && frontier.shipping_status === "SHIPPING_DURABLY_PERSISTED"
    && frontier.next_best_evidence === "NONE"
    && strings(frontier.hard_blockers).length === 0
  if (!exactIdentity || !evidenceExact || !economicsExact) {
    throw new Error("RADAR_DECISION_PACKAGE_BINDING_INPUT_UNPROVEN")
  }
  const identityBinding = Object.freeze({
    familyId,
    opportunityCaseId,
    demandEvidenceGrain: "FAMILY" as const,
    exactProductDemandClaimed: false as const,
    demandEvidenceDigest,
    priceEvidenceScope: "FAMILY" as const,
    marketPriceEvidenceReference: frontier.market_price_evidence_reference,
    marketPriceEvidenceDigest: demandEvidenceDigest,
    priceDistributionEvidenceDigest: text(record(frontierPayload
      .radarAutomaticPriceDistributionContinuationV1).evidenceDigest),
    productTruthDigest,
    economicsFrontier: Object.freeze({
      frontierId: frontier.frontier_id,
      frontierDigest: frontier.frontier_digest,
      frontierSnapshotDigest: frontier.snapshot_digest,
      economicPolicyDigest: frontier.economic_policy_digest,
    }),
  })
  const identityBindingDigest = digest(identityBinding)
  const finalEconomics = Object.freeze({
    status: "PASS" as const,
    salePriceUsd: targetPrice,
    ebayFeesUsd: ebayFees,
    lunaProductCostUsd: supplierCost,
    lunaShippingUsd: shipping,
    landedCostUsd: round(supplierCost + shipping),
    contributionProfitUsd: profit,
    contributionMarginPercent: margin,
    roiPercent: roi,
    thresholdResult: "PASS" as const,
  })
  const scoreBreakdown = {
    marketDemandScore: frontierPayload.familyDemandStatus ===
      "FAMILY_DEMAND_PROVEN" ? 25 : 18.75,
    economicsPotentialScore: 25,
    merchandisingScore: 0,
    lunaAdvantageScore: 15,
    operationalSimplicityScore: 5,
    portfolioDiversificationScore: 0,
    evidenceQualityScore: 5,
  }
  const launchPotentialScore = Object.values(scoreBreakdown)
    .reduce((total, score) => total + score, 0)
  const proposedProfile = buildSmartStockingLearningProfileV1({
    scoreBreakdown,
    riskPenalty: 0,
    whyPrioritized: [
      "EXACT_LUNA_IDENTITY_STOCK_SAFE_AND_ECONOMICS_READY",
      "FAMILY_DEMAND_AND_PRICE_DISTRIBUTION_SUPPORTED",
    ],
    knownUncertainties: [
      "EXACT_PRODUCT_DEMAND_NOT_CLAIMED_FAMILY_EVIDENCE_ONLY",
      "MERCHANDISING_AND_MARKETPLACE_READINESS_REMAIN_SEPARATE_GATES",
    ],
    entrySnapshotOrigin: "RECORDED_BEFORE_COMMERCIALIZATION",
    decisionSnapshot: {
      launchPotentialScore,
      launchTier: "CONTROLLED_MERCHANDISING_BET",
      evidenceProfile: [
        "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1",
        "FAMILY_DEMAND_SUPPORTED_OR_PROVEN",
        "RADAR_AUTOMATIC_PRICE_DISTRIBUTION_CONTINUATION_V1",
        "SHIPPING_DURABLY_PERSISTED",
      ],
      finalEconomics,
      rescueUsed: true,
      rescueType: "BETTER_PRICE_DISTRIBUTION",
      whyPublishedOrParked:
        "ECONOMICS_READY_PENDING_EXISTING_GOLDEN_PATH_GUARDS",
      parkReason: null,
      reopenCondition: null,
    },
  })
  const profile = input.existingLearningProfile
    ? updateSmartStockingDecisionSnapshotV1(
      input.existingLearningProfile as Parameters<
        typeof updateSmartStockingDecisionSnapshotV1>[0],
      proposedProfile.decisionSnapshot,
    )
    : proposedProfile
  const productIdentity = Object.freeze({
    version: "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1",
    fingerprint: digest({
      lunaProductId: opportunity.supplier_product_id,
      lunaVariantId: opportunity.supplier_variant_id,
      supplierSku: opportunity.supplier_sku,
      gtin: opportunity.gtin,
    }),
    identity: Object.freeze({ gtin: opportunity.gtin }),
  })
  const inputHash = digest({
    queueCandidateKey: opportunity.candidate_key,
    radarCandidateId,
    productIdentity,
    identityBinding,
    entrySnapshotHash: profile.entrySnapshotHash,
    decisionSnapshotHash: profile.decisionSnapshotHash,
  })
  const packageCore = {
    contractVersion: SELLER_OS_RADAR_DECISION_PACKAGE_BINDING_VERSION,
    authority: SELLER_OS_DETERMINISTIC_FACTORY,
    serverOwned: true as const,
    humanApproved: false as const,
    reviewerUserId: null,
    publicationAuthorized: false as const,
    marketplace: "EBAY_US" as const,
    queueCandidateKey: opportunity.candidate_key,
    radarCandidateId,
    supplierProductId: opportunity.supplier_product_id,
    supplierVariantId: opportunity.supplier_variant_id,
    supplierSku: opportunity.supplier_sku,
    productIdentity,
    identityBinding,
    identityBindingDigest,
    inputHash,
    entrySnapshotHash: profile.entrySnapshotHash,
    decisionSnapshotHash: profile.decisionSnapshotHash,
    marketplaceWrites: 0 as const,
  }
  const packageHash = digest(packageCore)
  return Object.freeze({
    payload: Object.freeze({ ...packageCore, packageHash }),
    profile: Object.freeze(profile),
    packageHash,
    inputHash,
    identityFingerprint: productIdentity.fingerprint,
    finalEconomics,
  })
}

async function ensureSellerOsRadarDecisionPackageBindingV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  opportunity: JsonRecord
  frontier: JsonRecord
}>) {
  const existingRead = await input.supabase
    .from("marketplace_listing_decision_packages")
    .select("id,status,package_hash,package_payload,smart_stocking_learning_profile")
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("supplier_variant_id", input.opportunity.supplier_variant_id)
    .not("smart_stocking_learning_profile", "is", null)
    .order("created_at", { ascending: false })
    .limit(2)
  if (existingRead.error) {
    throw new Error("RADAR_DECISION_PACKAGE_BINDING_READ_FAILED")
  }
  const existingRows = Array.isArray(existingRead.data)
    ? existingRead.data.map(record) : []
  if (existingRows.length > 1) {
    throw new Error("RADAR_DECISION_PACKAGE_BINDING_IDENTITY_AMBIGUOUS")
  }
  const existing = existingRows[0] ?? null
  if (existing && existing.status !== "GENERATED") {
    throw new Error("RADAR_DECISION_PACKAGE_BINDING_IMMUTABLE_STATUS")
  }
  const binding = buildSellerOsRadarDecisionPackageBindingV1({
    ...input,
    existingLearningProfile:
      existing?.smart_stocking_learning_profile ?? undefined,
  })
  const row = {
    marketplace_account_key: input.accountKey,
    marketplace: "EBAY_US",
    candidate_id: null,
    supplier_sku: input.opportunity.supplier_sku,
    supplier_variant_id: input.opportunity.supplier_variant_id,
    product_identity_fingerprint: binding.identityFingerprint,
    identity_version: "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1",
    package_version: SELLER_OS_RADAR_DECISION_PACKAGE_BINDING_VERSION,
    input_hash: binding.inputHash,
    package_hash: binding.packageHash,
    verdict: "GO_WITH_CHANGES",
    status: "GENERATED",
    package_payload: binding.payload,
    smart_stocking_learning_profile: binding.profile,
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const write = existing
    ? await input.supabase.from("marketplace_listing_decision_packages")
      .update(row)
      .eq("id", existing.id)
      .select("id,status,package_hash,package_payload,smart_stocking_learning_profile")
      .single()
    : await input.supabase.from("marketplace_listing_decision_packages")
      .upsert(row, {
        onConflict: "marketplace_account_key,marketplace,package_hash",
        ignoreDuplicates: false,
      })
      .select("id,status,package_hash,package_payload,smart_stocking_learning_profile")
      .single()
  if (write.error || !write.data) {
    throw new Error("RADAR_DECISION_PACKAGE_BINDING_WRITE_FAILED")
  }
  const stored = write.data as JsonRecord
  const authority = decisionPackageAuthority(
    input.opportunity, input.frontier, stored)
  if (!authority.exact || !authority.radarBindingExact ||
      stored.package_hash !== binding.packageHash) {
    throw new Error("RADAR_DECISION_PACKAGE_BINDING_READBACK_MISMATCH")
  }
  return Object.freeze({ row: stored, createdOrReused: true as const,
    identityAmbiguityReason: null, marketplaceWrites: 0 as const })
}

export function isSellerOsDeterministicFactoryPackageV1(value: unknown) {
  const authority = record(record(value).factoryPreparationAuthority)
  return authority.contractVersion === SELLER_OS_DURABLE_FACTORY_VERSION
    && authority.authority === SELLER_OS_DETERMINISTIC_FACTORY
    && authority.humanApproved === false
    && authority.reviewerUserId === null
    && /^sha256:[0-9a-f]{64}$/.test(String(authority.evidenceDigest ?? ""))
}

export function isGenericSmartStockingListingIntakeV1(value: unknown) {
  const marker = record(record(value).smartStockingListingIntakeV1)
  return isSmartStockingListingIntakeReadinessV1(value)
    && marker.factoryAuthority === SELLER_OS_DETERMINISTIC_FACTORY
    && typeof marker.candidateKey === "string"
    && typeof marker.supplierSku === "string"
    && /^\d{1,30}$/.test(String(marker.lunaProductId ?? ""))
    && /^\d{1,30}$/.test(String(marker.lunaVariantId ?? ""))
    && marker.productTruthReady === true
    && marker.demandReady === true
    && marker.duplicateGuardPassed === true
}

export function isSmartStockingListingIntakeReadinessV1(value: unknown) {
  const marker = record(record(value).smartStockingListingIntakeV1)
  return marker.contractVersion === SMART_STOCKING_LISTING_INTAKE_VERSION
    && marker.finalDecision === "LISTING_READY"
    && marker.finalEconomicsStatus === "PASS"
    && marker.exactIdentityVerified === true
    && marker.currentSupplierAvailabilityVerified === true
}

export function buildSellerOsDeterministicFactoryPlanV1(input: Readonly<{
  opportunity: JsonRecord
  frontier: JsonRecord
  activeDuplicateCount: number | null
  decisionPackage?: JsonRecord | null
}>) {
  const { opportunity, frontier } = input
  const assessment = record(opportunity.assessment)
  const readiness = record(assessment.canonicalReadiness)
  const productTruth = exactProductTruth(opportunity)
  const supplierIdentityReady = exactSupplierIdentity(opportunity, frontier)
  const demandStatus = familyDemand(frontier)
  const marketTestTarget = record(frontier.quick_pick_market_test_target)
  const marketTestPath = marketTestTarget.economicsReady === true &&
    ["FAMILY_DEMAND_UNPROVEN", "FAMILY_DEMAND_UNAVAILABLE"]
      .includes(demandStatus ?? "")
  const demandReady = demandStatus === "FAMILY_DEMAND_PROVEN"
    || demandStatus === "FAMILY_DEMAND_SUPPORTED"
  const hardBlockers = strings(frontier.hard_blockers)
  const targetEconomics = record(frontier.radar_price_distribution_target)
  const distributionReady = targetEconomics.economicsReady === true
    && (number(targetEconomics.profit) ?? 0) > 0
    && (number(targetEconomics.margin) ?? 0) >= 20
    && (number(targetEconomics.roi) ?? 0) >= 30
  const legacyEconomicsReady = frontier.economic_classification
      === "ECONOMICALLY_PROMISING"
    && frontier.shipping_status === "SHIPPING_DURABLY_PERSISTED"
    && frontier.next_best_evidence === "NONE"
    && (number(frontier.contribution_profit_median) ?? 0) > 0
    && (number(frontier.contribution_margin_median) ?? 0) > 0
    && hardBlockers.length === 0
  const marketTestEconomicsReady = marketTestPath &&
    (number(marketTestTarget.profit) ?? 0) > 0 &&
    (number(marketTestTarget.margin) ?? 0) >= 20 &&
    (number(marketTestTarget.roi) ?? 0) >= 30
  const economicsReady = (legacyEconomicsReady || distributionReady ||
    marketTestEconomicsReady)
    && frontier.shipping_status === "SHIPPING_DURABLY_PERSISTED"
    && frontier.next_best_evidence === "NONE" && hardBlockers.length === 0
  const duplicateGuardPassed = input.activeDuplicateCount === 0
  const stockReady = opportunity.supplier_available === true
    && opportunity.supplier_price !== null
    && (number(opportunity.supplier_price) ?? 0) > 0
    // Unknown supplier quantity is explicitly not OOS.
    && (opportunity.supplier_inventory_quantity === null
      || (number(opportunity.supplier_inventory_quantity) ?? 0) > 0)
  const seed = listingSeed(opportunity, frontier)
  const categoryReady = Boolean(seed.categoryId)
  const packageInputsReady = Boolean(seed.title && seed.imageUrls.length > 0
    && categoryReady)
  const demandPathReady = demandReady || marketTestPath
  const listingPackageReady = supplierIdentityReady && productTruth.exact
    && demandPathReady && economicsReady && stockReady && duplicateGuardPassed
    && packageInputsReady
  const canonicalMarketplaceReady = Array.isArray(readiness.blockers)
    && readiness.blockers.length === 0
  const canonicalMarketplaceBlockers = strings(readiness.blockers)
  const decisionPackage = decisionPackageAuthority(
    opportunity, frontier, input.decisionPackage,
  )
  const decisionPackageReady = decisionPackage.exact
  const blockers = unique([
    ...(!supplierIdentityReady ? ["SUPPLIER_IDENTITY_NOT_EXACT"] : []),
    ...(!productTruth.exact ? ["PRODUCT_TRUTH_NOT_READY"] : []),
    ...(!demandPathReady ? ["FAMILY_DEMAND_NOT_READY"] : []),
    ...(!economicsReady ? [
      hardBlockers[0] ?? `ECONOMICS_${String(frontier.economic_classification
        ?? "UNPROVEN")}`,
    ] : []),
    ...(!stockReady ? ["CANONICAL_STOCK_NOT_READY"] : []),
    ...(input.activeDuplicateCount === null
      ? ["ACTIVE_DUPLICATE_GUARD_UNAVAILABLE"]
      : !duplicateGuardPassed ? ["ACTIVE_DUPLICATE"] : []),
    ...(!categoryReady ? ["MARKETPLACE_CATEGORY_NOT_READY"] : []),
    ...(!packageInputsReady ? ["LISTING_PACKAGE_INPUTS_NOT_READY"] : []),
    ...(!canonicalMarketplaceReady
      ? canonicalMarketplaceBlockers.length
        ? canonicalMarketplaceBlockers
        : ["CANONICAL_MARKETPLACE_READINESS_REQUIRED"]
      : []),
    ...(!decisionPackageReady && !marketTestPath
      ? ["DECISION_PACKAGE_NOT_BOUND"] : []),
  ])
  const marketTestReady = marketTestPath && blockers.length === 0
  const listingReady = !marketTestPath && blockers.length === 0
  const stageStatuses = {
    SMART_STOCKING: "READY",
    PRODUCT_TRUTH_READY: productTruth.exact ? "READY" : "BLOCKED",
    DEMAND_READY: demandPathReady ? "READY" : "BLOCKED",
    ECONOMICS_READY: economicsReady ? "READY" : "BLOCKED",
    LISTING_PACKAGE_READY: listingPackageReady ? "READY" : "BLOCKED",
    LISTING_READY: listingReady ? "READY" : "BLOCKED",
    ...(marketTestPath ? {
      MARKET_TEST_READY: marketTestReady ? "READY" as const : "BLOCKED" as const,
    } : {}),
  } as const
  const evidenceCore = {
    contractVersion: SELLER_OS_DURABLE_FACTORY_VERSION,
    authority: SELLER_OS_DETERMINISTIC_FACTORY,
    candidateKey: opportunity.candidate_key,
    opportunityId: opportunity.id,
    supplierProductId: opportunity.supplier_product_id,
    supplierVariantId: opportunity.supplier_variant_id,
    supplierSku: opportunity.supplier_sku,
    gtin: opportunity.gtin,
    frontierId: frontier.frontier_id,
    frontierDigest: frontier.frontier_digest,
    frontierSnapshotDigest: frontier.snapshot_digest,
    decisionPackageId: decisionPackageReady ? decisionPackage.row.id : null,
    stageStatuses,
    blockers,
  }
  const evidenceDigest = digest(evidenceCore)
  const factoryPreparationAuthority = {
    ...evidenceCore,
    evidenceDigest,
    serverOwned: true,
    humanApproved: false,
    reviewerUserId: null,
    publicationAuthorized: false,
  }
  const smartStockingListingIntakeV1 = listingReady ? {
    contractVersion: SMART_STOCKING_LISTING_INTAKE_VERSION,
    factoryAuthority: SELLER_OS_DETERMINISTIC_FACTORY,
    decisionPackageId: decisionPackage.row.id,
    candidateKey: opportunity.candidate_key,
    supplierSku: opportunity.supplier_sku,
    lunaProductId: opportunity.supplier_product_id,
    lunaVariantId: opportunity.supplier_variant_id,
    finalDecision: "LISTING_READY",
    finalPriceUsd: number(targetEconomics.targetPrice) ??
      number(opportunity.median_total_buyer_price),
    finalEconomicsStatus: "PASS",
    productTruthReady: true,
    demandReady: true,
    duplicateGuardPassed: true,
    exactIdentityVerified: true,
    currentSupplierAvailabilityVerified: true,
    safeCapacity: null,
    frontierId: frontier.frontier_id,
    frontierDigest: frontier.frontier_digest,
    frontierSnapshotDigest: frontier.snapshot_digest,
    productTruthDigest: productTruth.truth.evidenceDigest,
    entrySnapshotHash: decisionPackage.profile.entrySnapshotHash,
    decisionSnapshotHash: decisionPackage.profile.decisionSnapshotHash,
    entryPotentialScore: number(decisionPackage.entry.entryPotentialScore),
    launchTier: decisionPackage.decision.launchTier,
    supplierCostUsd: number(frontier.luna_cost),
    supplierShippingUsd: number(frontier.shipping_value),
    salePriceUsd: number(targetEconomics.targetPrice) ??
      number(frontier.market_price_median),
    estimatedEbayFeesUsd: number(targetEconomics.estimatedEbayFees) ??
      number(frontier.ebay_fee_estimate_at_median),
    contributionProfitUsd: number(targetEconomics.profit) ??
      number(frontier.contribution_profit_median),
    contributionMarginPercent: number(targetEconomics.margin) ??
      number(frontier.contribution_margin_median),
    roiPercent: number(targetEconomics.roi) ??
      number(decisionPackage.economics.roiPercent),
  } : null
  const marketTestReviewV1 = marketTestReady ? Object.freeze({
    contractVersion: "LUNA_QUICK_PICK_MARKET_TEST_PATH_V1" as const,
    finalDecision: "MARKET_TEST_READY" as const,
    ownerAuthorizationRequired: true as const,
    demandEvidenceClass: "UNPROVEN_INSUFFICIENT_MARKET_EVIDENCE" as const,
    exactProductDemandClaimed: false as const,
    marketPriceSupport: "UNPROVEN" as const,
    priceCompetitiveness: "UNPROVEN" as const,
    testPriceBasis: "MINIMUM_MARGIN_SAFE_PRICE" as const,
    testPrice: number(marketTestTarget.targetPrice),
    supplierCost: number(frontier.luna_cost),
    shipping: number(frontier.shipping_value),
    ebayFees: number(marketTestTarget.estimatedEbayFees),
    profit: number(marketTestTarget.profit),
    margin: number(marketTestTarget.margin),
    roi: number(marketTestTarget.roi),
    marketplaceWrites: 0 as const,
  }) : null
  return Object.freeze({
    contractVersion: SELLER_OS_DURABLE_FACTORY_VERSION,
    authority: SELLER_OS_DETERMINISTIC_FACTORY,
    targetSpecificAllowlistUsed: false as const,
    humanSessionRequired: false as const,
    marketplaceWrites: 0 as const,
    publishCalls: 0 as const,
    listingReady,
    marketTestReady,
    firstBlocker: blockers[0] ?? null,
    blockers: Object.freeze(blockers),
    stageStatuses: Object.freeze(stageStatuses),
    factoryPreparationAuthority: Object.freeze(factoryPreparationAuthority),
    smartStockingListingIntakeV1: smartStockingListingIntakeV1
      ? Object.freeze(smartStockingListingIntakeV1) : null,
    marketTestReviewV1,
    packageSeed: Object.freeze({
      ...seed,
      factoryPreparationAuthority,
    }),
    readiness: listingReady || marketTestReady ? 100 : Math.round(
      Object.values(stageStatuses).filter((status) => status === "READY").length
      / Object.keys(stageStatuses).length * 100,
    ),
  })
}

export async function materializeSellerOsDeterministicFactoryCandidateV1(
  input: Readonly<{
    supabase: SupabaseClient
    accountKey: string
    opportunityId: string
    candidateKey: string
    decisionPackageId?: string | null
    taxonomyReader?: RadarMarketplaceTaxonomyReaderV1
  }>,
) {
  const opportunityRead = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("*").eq("id", input.opportunityId)
    .eq("candidate_key", input.candidateKey).maybeSingle()
  if (opportunityRead.error || !opportunityRead.data) {
    throw new Error("DETERMINISTIC_FACTORY_CANDIDATE_NOT_FOUND")
  }
  const opportunity = opportunityRead.data as JsonRecord
  const productId = text(opportunity.supplier_product_id)
  const variantId = text(opportunity.supplier_variant_id)
  const supplierSku = text(opportunity.supplier_sku)
  if (!productId || !variantId || !supplierSku) {
    throw new Error("DETERMINISTIC_FACTORY_SUPPLIER_IDENTITY_REQUIRED")
  }
  const [frontierRead, duplicateRead, packageRead, providedDecisionPackageRead] =
    await Promise.all([
    input.supabase.rpc("get_seller_os_latest_profitability_frontiers_v1", {
      p_account_key: input.accountKey,
      p_marketplace_id: "EBAY_US",
      p_family_ids: null,
      p_limit: 100,
    }),
    input.supabase.from("ebay_active_listings")
      .select("id,supplier_variant_id,supplier_sku,ebay_sku")
      .eq("account_key", input.accountKey).eq("listing_status", "active")
      .limit(1000),
    input.supabase.from("ebay_listing_packages").select("*")
      .eq("account_key", input.accountKey)
      .eq("opportunity_id", input.opportunityId).maybeSingle(),
    input.decisionPackageId
      ? input.supabase.from("marketplace_listing_decision_packages")
        .select("id,status,package_hash,package_payload,smart_stocking_learning_profile")
        .eq("id", input.decisionPackageId)
        .eq("marketplace_account_key", input.accountKey)
        .eq("marketplace", "EBAY_US").maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  const frontierOuter = Array.isArray(record(frontierRead.data).frontiers)
    ? (record(frontierRead.data).frontiers as unknown[]).find((value) => {
      const frontier = record(record(value).frontier)
      return frontier.lunaProductId === productId
        && frontier.lunaVariantId === variantId
        && frontier.lunaSku === supplierSku
    })
    : null
  if (frontierRead.error || !frontierOuter) {
    throw new Error("DETERMINISTIC_FACTORY_PROFITABILITY_FRONTIER_REQUIRED")
  }
  if (duplicateRead.error) {
    throw new Error("DETERMINISTIC_FACTORY_DUPLICATE_GUARD_FAILED")
  }
  if (packageRead.error) throw new Error("DETERMINISTIC_FACTORY_PACKAGE_READ_FAILED")
  if (providedDecisionPackageRead.error) {
    throw new Error("DETERMINISTIC_FACTORY_DECISION_PACKAGE_READ_FAILED")
  }
  const normalizedFrontier = normalizeProfitabilityFrontier(frontierOuter)
  const radarCandidate = record(record(opportunity.assessment)
    .radarFactoryCandidateV1)
  const radarCandidateEligibleForBinding = radarCandidate.contractVersion ===
      "NIGHT_RADAR_AUTOMATIC_GOLDEN_PATH_HANDOFF_V1"
    && radarCandidate.authority === SELLER_OS_DETERMINISTIC_FACTORY
  const activeDuplicateCount = (duplicateRead.data ?? []).filter((value) => {
    const listing = record(value)
    return listing.supplier_variant_id === variantId
      || listing.supplier_sku === supplierSku
      || listing.ebay_sku === supplierSku
  }).length
  const initialProductTruthContinuation =
    resolveSellerOsExactProductTruthV1(opportunity)
  const marketplaceReadinessContinuation = radarCandidateEligibleForBinding
      && input.taxonomyReader
    ? await (await import(
      // @ts-expect-error Node direct TypeScript tests require the explicit
      // extension; the production bundler resolves the same source module.
      "./ebay-radar-canonical-marketplace-readiness-v1.ts"
    )).resolveRadarCanonicalMarketplaceReadinessV1({
      supabase: input.supabase,
      accountKey: input.accountKey,
      opportunity,
      listingPackage: packageRead.data as JsonRecord | null,
      productTruthExact: initialProductTruthContinuation.exact,
      productTruth: initialProductTruthContinuation.truth,
      taxonomyReader: input.taxonomyReader,
    }) : null
  const currentAssessment = record(opportunity.assessment)
  const existingCanonicalBlockers = strings(
    record(currentAssessment.canonicalReadiness).blockers)
  const preservedCanonicalBlockers = existingCanonicalBlockers.filter(
    (blocker) => !blocker.startsWith("MARKETPLACE_")
      && !["SELLER_ACCOUNT_BINDING_NOT_READY", "FULFILLMENT_POLICY_NOT_READY",
        "PAYMENT_POLICY_NOT_READY", "RETURN_POLICY_NOT_READY",
        "LOCATION_OR_INVENTORY_CONTEXT_NOT_READY"]
        .includes(blocker),
  )
  const opportunityForPlan = marketplaceReadinessContinuation ? {
    ...opportunity,
    assessment: {
      ...currentAssessment,
      productTruth: marketplaceReadinessContinuation.productTruth,
      canonicalMarketplaceReadinessV1:
        marketplaceReadinessContinuation.evidence,
      canonicalReadiness: {
        blockers: unique([
          ...preservedCanonicalBlockers,
          ...strings(marketplaceReadinessContinuation.evidence.blockers),
        ]),
      },
    },
  } : opportunity
  const productTruthContinuation = resolveSellerOsExactProductTruthV1(
    opportunityForPlan)
  const providedDecisionPackage = providedDecisionPackageRead.data as
    JsonRecord | null
  const providedDecisionPackageExact = input.decisionPackageId
    ? decisionPackageAuthority(
      opportunityForPlan, normalizedFrontier, providedDecisionPackage).exact
    : false
  const marketTestBinding = record(
    normalizedFrontier.quick_pick_market_test_target).economicsReady === true
  const decisionPackageBinding = providedDecisionPackageExact
    ? { row: providedDecisionPackage,
      createdOrReused: false as const, identityAmbiguityReason: null }
    : radarCandidateEligibleForBinding && !marketTestBinding
      ? await ensureSellerOsRadarDecisionPackageBindingV1({
        supabase: input.supabase,
        accountKey: input.accountKey,
        opportunity: opportunityForPlan,
        frontier: normalizedFrontier,
      })
      : { row: null, createdOrReused: false as const,
        identityAmbiguityReason: null }
  const plan = buildSellerOsDeterministicFactoryPlanV1({
    opportunity: opportunityForPlan,
    frontier: normalizedFrontier,
    activeDuplicateCount,
    decisionPackage: decisionPackageBinding.row,
  })
  const updatedAssessment = record(opportunityForPlan.assessment)
  const assessment = {
    ...updatedAssessment,
    sellerOsDeterministicFactory: plan.factoryPreparationAuthority,
    ...(plan.smartStockingListingIntakeV1
      ? { smartStockingListingIntakeV1: plan.smartStockingListingIntakeV1 }
      : {}),
    ...(plan.marketTestReviewV1
      ? { quickPickMarketTestReviewV1: plan.marketTestReviewV1 }
      : {}),
  }
  const queueWrite = await input.supabase.from("ebay_luna_opportunity_queue")
    .update({
      assessment,
      ...(plan.listingReady
        ? { decision: "LISTING_READY", queue_status: "ready" }
        : plan.marketTestReady
          ? { decision: "MARKET_TEST_READY", queue_status: "ready" } : {}),
      updated_at: new Date().toISOString(),
    }).eq("id", input.opportunityId).eq("candidate_key", input.candidateKey)
    .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,gtin,decision,assessment")
    .single()
  if (queueWrite.error || !queueWrite.data) {
    throw new Error("DETERMINISTIC_FACTORY_SMART_STOCKING_WRITE_FAILED")
  }
  const productTruthReadback = resolveSellerOsExactProductTruthV1(
    queueWrite.data as JsonRecord)
  if (productTruthContinuation.exact && !productTruthReadback.exact) {
    throw new Error("DETERMINISTIC_FACTORY_PRODUCT_TRUTH_READBACK_MISMATCH")
  }

  const existingPackage = packageRead.data as JsonRecord | null
  let listingPackage: JsonRecord
  let packageCreated = false
  if (existingPackage) {
    listingPackage = existingPackage
    if (existingPackage.created_by === null
      && isSellerOsDeterministicFactoryPackageV1(existingPackage.package_data)) {
      const packageWrite = await input.supabase.from("ebay_listing_packages")
        .update({
          package_data: plan.packageSeed,
          status: plan.listingReady || plan.marketTestReady
            ? "ready_for_review" : "draft",
          readiness: plan.readiness,
          source_observed_at: opportunity.supplier_snapshot_at ?? null,
          updated_at: new Date().toISOString(),
        }).eq("id", existingPackage.id).eq("opportunity_id", input.opportunityId)
        .is("created_by", null).select("*").single()
      if (packageWrite.error || !packageWrite.data) {
        throw new Error("DETERMINISTIC_FACTORY_PACKAGE_REUSE_FAILED")
      }
      listingPackage = packageWrite.data as JsonRecord
    }
  } else {
    const packageWrite = await input.supabase.from("ebay_listing_packages")
      .insert({
        account_key: input.accountKey,
        opportunity_id: input.opportunityId,
        candidate_key: input.candidateKey,
        status: plan.listingReady || plan.marketTestReady
          ? "ready_for_review" : "draft",
        package_data: plan.packageSeed,
        readiness: plan.readiness,
        source_observed_at: opportunity.supplier_snapshot_at ?? null,
        created_by: null,
      }).select("*").single()
    if (packageWrite.error || !packageWrite.data) {
      throw new Error("DETERMINISTIC_FACTORY_PACKAGE_CREATE_FAILED")
    }
    listingPackage = packageWrite.data as JsonRecord
    packageCreated = true
  }
  const serverOwned = listingPackage.created_by === null
    && isSellerOsDeterministicFactoryPackageV1(listingPackage.package_data)
  const requiredSpecificsTruth = record(
    marketplaceReadinessContinuation?.requiredItemSpecificsTruth)
  const requiredSpecificResolutions = record(
    requiredSpecificsTruth.resolutions)
  const styleResolution = record(requiredSpecificResolutions.Style)
  const brandResolution = record(requiredSpecificResolutions.Brand)
  const typeResolution = record(requiredSpecificResolutions.Type)
  return Object.freeze({
    ...plan,
    opportunityId: input.opportunityId,
    candidateKey: input.candidateKey,
    smartStockingDurable: true as const,
    listingPackageId: String(listingPackage.id),
    serverOwnedFactoryAuthority: serverOwned,
    packageCreated,
    decisionPackageId: plan.factoryPreparationAuthority.decisionPackageId,
    decisionPackageIdentityResolved:
      plan.factoryPreparationAuthority.decisionPackageId !== null,
    decisionPackageCreatedOrReused:
      decisionPackageBinding.createdOrReused,
    identityAmbiguityReason: decisionPackageBinding.identityAmbiguityReason,
    productTruthAcquisitionRequired:
      productTruthContinuation.acquisitionRequired,
    productTruthReused: productTruthContinuation.reused,
    productTruthExactIdentityMatch: productTruthContinuation.exact,
    productTruthProductId: productTruthContinuation.exact ? productId : null,
    productTruthVariantId: productTruthContinuation.exact ? variantId : null,
    productTruthSource: productTruthContinuation.source,
    productTruthDurable: productTruthContinuation.durable,
    productTruthReadbackMatch: productTruthReadback.exact,
    unsupportedAttributeCount:
      productTruthContinuation.unsupportedAttributeCount,
    unsupportedAttributesPersisted:
      productTruthContinuation.unsupportedAttributesPersisted,
    marketplaceReadinessAcquisitionRequired:
      marketplaceReadinessContinuation?.acquisitionRequired ?? null,
    marketplaceReadinessReused:
      marketplaceReadinessContinuation?.reused ?? null,
    categoryId:
      marketplaceReadinessContinuation?.evidence.categoryId ?? null,
    categorySource:
      marketplaceReadinessContinuation?.evidence.categorySource ?? null,
    categoryReady:
      marketplaceReadinessContinuation?.evidence.categoryReady ?? false,
    conditionId:
      marketplaceReadinessContinuation?.evidence.conditionId ?? null,
    conditionSource:
      marketplaceReadinessContinuation?.evidence.conditionSource ?? null,
    conditionReady:
      marketplaceReadinessContinuation?.evidence.conditionReady ?? false,
    requiredItemSpecificsCount:
      marketplaceReadinessContinuation?.evidence
        .requiredItemSpecificsCount ?? null,
    requiredItemSpecificsSatisfied:
      marketplaceReadinessContinuation?.evidence
        .requiredItemSpecificsSatisfied ?? null,
    unsupportedRequiredSpecifics:
      marketplaceReadinessContinuation?.evidence
        .unsupportedRequiredSpecifics ?? [],
    requiredItemSpecificsReady:
      marketplaceReadinessContinuation?.evidence
        .requiredItemSpecificsReady ?? false,
    fulfillmentPolicyBound:
      marketplaceReadinessContinuation?.evidence
        .fulfillmentPolicyReady ?? false,
    paymentPolicyBound:
      marketplaceReadinessContinuation?.evidence.paymentPolicyReady ?? false,
    returnPolicyBound:
      marketplaceReadinessContinuation?.evidence.returnPolicyReady ?? false,
    listingPolicyReady:
      marketplaceReadinessContinuation?.evidence.listingPolicyReady ?? false,
    locationOrInventoryContextReady:
      marketplaceReadinessContinuation?.evidence
        .locationOrInventoryContextReady ?? false,
    sellerAccountBindingReady:
      marketplaceReadinessContinuation?.evidence
        .sellerAccountBindingReady ?? false,
    marketplaceIdentityReady:
      marketplaceReadinessContinuation?.evidence
        .marketplaceIdentityReady ?? false,
    canonicalMarketplaceReadinessReady:
      marketplaceReadinessContinuation?.evidence.ready ?? false,
    requiredItemSpecificAspectContracts:
      Array.isArray(requiredSpecificsTruth.aspectContracts)
        ? requiredSpecificsTruth.aspectContracts : [],
    requiredSpecificsBatchInput:
      marketplaceReadinessContinuation?.requiredSpecificsBatchInput ?? null,
    styleValue: styleResolution.value ?? null,
    styleSource: styleResolution.source ?? null,
    styleExactProductSupported:
      styleResolution.exactProductSupported === true,
    brandValue: brandResolution.value ?? null,
    brandSource: brandResolution.source ?? null,
    brandExactProductSupported:
      brandResolution.exactProductSupported === true,
    typeValue: typeResolution.value ?? null,
    typeSource: typeResolution.source ?? null,
    typeExactProductSupported:
      typeResolution.exactProductSupported === true,
    duplicateCreated: false as const,
    newEbayOffers: 0 as const,
    withdrawCalls: 0 as const,
  })
}
