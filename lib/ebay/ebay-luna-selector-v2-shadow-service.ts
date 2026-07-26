import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import type {
  EbayDemandEvidenceClass,
  EbayLunaSelectorCandidateV2,
  EbayLunaSelectorV2Policy,
  SelectorLane,
  SupplierRotationClass,
} from "./ebay-luna-selector-v2-domain"

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function firstRecord(...values: unknown[]) {
  for (const value of values) {
    const parsed = record(value)
    if (Object.keys(parsed).length) return parsed
  }
  return {}
}

function textValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

function numberValue(...values: unknown[]) {
  for (const value of values) {
    const numeric = typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() ? Number(value) : Number.NaN
    if (Number.isFinite(numeric)) return numeric
  }
  return null
}

function rateValue(...values: unknown[]) {
  const value = numberValue(...values)
  if (value === null) return null
  return Math.abs(value) > 1 ? value / 100 : value
}

function booleanValue(...values: unknown[]) {
  for (const value of values) {
    if (value === true || value === "true") return true
    if (value === false || value === "false") return false
  }
  return false
}

function optionalBooleanValue(...values: unknown[]) {
  for (const value of values) {
    if (value === true || value === "true") return true
    if (value === false || value === "false") return false
  }
  return null
}

function textArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string =>
        typeof entry === "string" && Boolean(entry.trim()),
      ).map((entry) => entry.trim())
    : []
}

function demandEvidenceClass(value: unknown): EbayDemandEvidenceClass {
  switch (value) {
    case "CONFIRMED_SOLD_EXACT":
    case "OBSERVED_ESTIMATED_ROTATION":
    case "POPULARITY_OR_RELATED":
    case "ACTIVE_ONLY":
    case "INSUFFICIENT_EVIDENCE":
      return value
    default:
      return "INSUFFICIENT_EVIDENCE"
  }
}

function rotationClass(value: unknown): SupplierRotationClass {
  switch (value) {
    case "HIGH_CONFIDENCE":
    case "LOW_OR_UNSTABLE":
    case "UNKNOWN":
      return value
    default:
      return "UNKNOWN"
  }
}

function laneValue(value: unknown): SelectorLane | null {
  switch (value) {
    case "protection":
    case "event":
    case "hot":
    case "baseline":
    case "coverage":
      return value
    default:
      return null
  }
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`
}

function safePolicy(
  value: unknown,
  defaults: EbayLunaSelectorV2Policy,
): EbayLunaSelectorV2Policy {
  const input = record(value)
  const integer = (key: keyof EbayLunaSelectorV2Policy, minimum: number, maximum: number) => {
    const value = numberValue(input[key])
    return value === null
      ? defaults[key] as number
      : Math.max(minimum, Math.min(maximum, Math.round(value)))
  }
  const numeric = (key: keyof EbayLunaSelectorV2Policy, minimum: number, maximum: number) => {
    const value = numberValue(input[key])
    return value === null
      ? defaults[key] as number
      : Math.max(minimum, Math.min(maximum, value))
  }
  return {
    policyVersion: textValue(input.policyVersion) ?? defaults.policyVersion,
    targetBatchSize: integer("targetBatchSize", 1, 5),
    minimumConfirmedDemandPreferred: integer(
      "minimumConfirmedDemandPreferred",
      0,
      5,
    ),
    maximumExploratory: integer("maximumExploratory", 0, 1),
    bootstrapCanaryEnabled: booleanValue(
      input.bootstrapCanaryEnabled,
      defaults.bootstrapCanaryEnabled,
    ),
    maximumBootstrapCanaries: integer(
      "maximumBootstrapCanaries",
      0,
      5,
    ),
    maximumPerFamily: integer("maximumPerFamily", 1, 5),
    maximumPerCategory: integer("maximumPerCategory", 1, 5),
    minimumFreshStockQuantity: integer("minimumFreshStockQuantity", 1, 100_000),
    minimumNetProfitUsd: numeric("minimumNetProfitUsd", 0, 1_000),
    minimumMarginRate: numeric("minimumMarginRate", 0, 1),
    minimumRoiRate: numeric("minimumRoiRate", 0, 10),
    minimumConfidenceScore: numeric("minimumConfidenceScore", 0, 100),
    minimumReadyScore: numeric("minimumReadyScore", 0, 100),
    maximumRiskScore: numeric("maximumRiskScore", 0, 100),
    maximumSupplierEvidenceAgeHours: numeric(
      "maximumSupplierEvidenceAgeHours",
      1,
      720,
    ),
    maximumSoldEvidenceAgeDays: numeric(
      "maximumSoldEvidenceAgeDays",
      1,
      365,
    ),
    explorationMinimumPotentialScore: numeric(
      "explorationMinimumPotentialScore",
      0,
      100,
    ),
    fairnessMaximumBoost: numeric("fairnessMaximumBoost", 0, 25),
  }
}

export function getEbayLunaSelectorV2ShadowConfiguration(
  env: NodeJS.ProcessEnv = process.env,
) {
  const environment = textValue(env.VERCEL_ENV) ??
    (env.NODE_ENV === "test" ? "test" : "development")
  const production = environment === "production"
  return {
    enabled:
      !production &&
      env.EBAY_LUNA_SELECTOR_V2_SHADOW_ENABLED === "true",
    shadowMode: true as const,
    environment,
    productionBlocked: production,
    ebayWritesAllowed: false as const,
  }
}

export function normalizeEbayLunaSelectorV2QueueRow(
  rowInput: unknown,
): EbayLunaSelectorCandidateV2 {
  const row = record(rowInput)
  const assessment = record(row.assessment)
  const assessmentCandidate = record(assessment.candidate)
  const assessmentDemand = record(assessment.demand)
  const assessmentDemandPolicy = record(assessment.demandEvidencePolicy)
  const assessmentIdentity = record(assessment.identity)
  const assessmentEconomics = record(assessment.economics)
  const assessmentScores = record(assessment.scores)
  const assessmentMarket = record(assessment.market)
  const taxonomyVerification = record(assessment.taxonomyVerification)
  const fulfillmentEvidence = record(assessment.fulfillmentEvidence)
  const listingPackage = record(assessment.listingIntelligencePackage)
  const categoryRecommendation = record(
    listingPackage.categoryRecommendation,
  )
  const imagePlan = record(listingPackage.imagePlan)
  const supplier = firstRecord(
    row.supplier,
    row.luna,
    row.supplier_evidence,
    row.luna_snapshot,
    assessmentCandidate,
  )
  const demand = firstRecord(
    row.demand,
    row.demand_evidence,
    row.sold_evidence,
    row.ebay_market,
    assessmentDemand,
    assessmentDemandPolicy,
  )
  const identity = firstRecord(
    row.identity,
    demand.identity,
    row.identity_evidence,
    assessmentIdentity,
  )
  const economics = firstRecord(
    row.economics,
    row.economic_evaluation,
    row.profitability,
    assessmentEconomics,
  )
  const operational = firstRecord(
    row.operational,
    row.readiness,
    row.listing_readiness,
  )
  const risk = firstRecord(row.risk, row.risk_evaluation)
  const rowHardGates = textArray(row.hard_gates)
  const assessmentHardGates = textArray(assessment.hardGates)
  const riskBlockerCodes = [...new Set([
    ...textArray(risk.blockerCodes ?? risk.blocker_codes),
    ...rowHardGates,
    ...assessmentHardGates,
  ])]
  const candidateKey = textValue(
    row.candidate_key,
    row.candidateKey,
    row.id,
  ) ?? "UNKNOWN_CANDIDATE"
  const productId = textValue(
    row.market_radar_product_id,
    row.product_id,
    row.productId,
  ) ?? candidateKey
  const familyKey = textValue(
    row.family_fingerprint,
    row.family_key,
    row.familyKey,
    row.supplier_product_id,
    productId,
  ) ?? productId
  const evidenceClass = demandEvidenceClass(
    demand.evidenceClass ??
    demand.evidence_class ??
    row.evidence_class ??
    row.demand_evidence_class,
  )
  const supplierVariantId = textValue(
    row.supplier_variant_id,
    supplier.supplierVariantId,
    assessmentCandidate.supplierVariantId,
  )
  const embeddedSupplierVariantId = textValue(
    assessmentCandidate.supplierVariantId,
  )
  const explicitExactVariant = optionalBooleanValue(
    supplier.exactVariant,
    supplier.exact_variant,
    identity.exactSupplierVariant,
    row.exact_supplier_variant,
  )
  const soldExactUnits = numberValue(
    demand.soldExactUnits,
    demand.sold_exact_units,
    row.sold_exact_units,
  )
  const observedMarketPrice = numberValue(
    assessmentMarket.conservativeTotalBuyerPrice,
    assessmentMarket.medianTotalBuyerPrice,
    row.median_total_buyer_price,
  )
  const taxonomyHardGuards = textArray(taxonomyVerification.hardGuards)
  const restrictionGuards = textArray(assessmentCandidate.restrictionGuards)
  const complianceFromAssessment =
    Array.isArray(assessmentCandidate.restrictionGuards) &&
    Array.isArray(taxonomyVerification.hardGuards) &&
    restrictionGuards.length === 0 &&
    taxonomyHardGuards.length === 0
  const categoryFromAssessment =
    taxonomyVerification.categoryConfirmed === true &&
    Array.isArray(taxonomyVerification.missingRequiredAspects) &&
    taxonomyVerification.missingRequiredAspects.length === 0
  const listingFactsFromAssessment =
    Array.isArray(row.hard_gates) &&
    rowHardGates.length === 0
  return {
    candidateKey,
    productId,
    supplierProductId: textValue(
      row.supplier_product_id,
      supplier.supplierProductId,
    ),
    supplierVariantId,
    supplierSku: textValue(
      row.supplier_sku,
      row.sku,
      supplier.sku,
    ),
    familyKey,
    categoryId: textValue(
      row.category_id,
      row.ebay_category_id,
      operational.categoryId,
      categoryRecommendation.categoryId,
      assessmentCandidate.categoryId,
    ),
    lane: laneValue(row.lane),
    currentOpportunityScore: numberValue(
      row.priority_score,
      row.opportunity_score,
      row.seller_priority_score,
    ),
    lastDeepAnalyzedAt: textValue(
      row.last_deep_analyzed_at,
      row.deep_analyzed_at,
    ),
    consumableResearchBoost: numberValue(
      row.consumable_research_boost,
      assessment.consumableResearchBoost,
    ),
    supplier: {
      productCurrent: booleanValue(
        supplier.productCurrent,
        supplier.product_current,
        row.supplier_product_current,
        row.supplier_available,
        assessmentCandidate.available,
      ),
      exactVariant: explicitExactVariant ??
        Boolean(
          supplierVariantId &&
          embeddedSupplierVariantId &&
          supplierVariantId === embeddedSupplierVariantId,
        ),
      numericStock: numberValue(
        supplier.numericStock,
        supplier.inventoryQuantity,
        supplier.inventory_quantity,
        row.inventory_quantity,
        row.supplier_inventory_quantity,
        assessmentCandidate.inventoryQuantity,
      ),
      costUsd: numberValue(
        supplier.costUsd,
        supplier.cost_usd,
        row.cost_usd,
        row.supplier_cost,
        row.supplier_price,
        assessmentCandidate.supplierCost,
      ),
      observedAt: textValue(
        supplier.observedAt,
        supplier.observed_at,
        row.source_observed_at,
        row.snapshot_captured_at,
        row.supplier_snapshot_at,
        assessmentCandidate.stockCapturedAt,
      ),
      rotationClass: rotationClass(
        supplier.rotationClass ??
        supplier.rotation_class ??
        row.supplier_rotation_class,
      ),
      readinessScore: numberValue(
        supplier.readinessScore,
        row.supplier_readiness_score,
        row.supply_score,
        assessmentScores.supplyScore,
      ),
      rotationScore: numberValue(
        supplier.rotationScore,
        row.supplier_rotation_score,
      ),
      confidenceScore: numberValue(
        supplier.confidenceScore,
        row.supplier_confidence_score,
      ),
    },
    demand: {
      evidenceClass,
      reviewed: booleanValue(
        demand.reviewed,
        demand.humanReviewed,
        demand.human_reviewed,
        row.sold_evidence_reviewed,
      ),
      exactIdentity: booleanValue(
        identity.exactIdentity,
        identity.exact_identity,
        demand.exactIdentity,
        row.exact_identity,
        assessmentIdentity.exactIdentityConfirmed,
      ),
      samePack: booleanValue(
        identity.samePack,
        identity.same_pack,
        demand.samePack,
        row.same_pack,
      ),
      sameSize: booleanValue(
        identity.sameSize,
        identity.same_size,
        demand.sameSize,
        row.same_size,
      ),
      sameVariant: booleanValue(
        identity.sameVariant,
        identity.same_variant,
        demand.sameVariant,
        row.same_variant,
      ),
      sameCondition: booleanValue(
        identity.sameCondition,
        identity.same_condition,
        demand.sameCondition,
        row.same_condition,
      ),
      soldExactUnits,
      soldExactSellerCount: numberValue(
        demand.soldExactSellerCount,
        demand.sold_exact_seller_count,
        row.sold_exact_seller_count,
      ),
      soldExactComparableCount: numberValue(
        demand.soldExactComparableCount,
        demand.sold_exact_comparable_count,
        row.sold_exact_comparable_count,
      ),
      observedAt: textValue(
        demand.observedAt,
        demand.observed_at,
        row.sold_evidence_observed_at,
      ),
      historicalMarketCheckCompleted: booleanValue(
        demand.historicalMarketCheckCompleted,
        assessmentDemandPolicy.historicalMarketCheckCompleted,
        assessmentDemandPolicy.evaluated,
        Boolean(textValue(row.demand_evaluated_at)),
      ),
      score: numberValue(
        demand.score,
        demand.demandScore,
        row.ebay_demand_score,
        row.demand_score,
        assessmentScores.demandScore,
      ),
      confidenceScore: numberValue(
        demand.confidenceScore,
        row.demand_confidence_score,
        assessmentScores.demandEvidenceConfidence,
      ),
    },
    economics: {
      landedSoldPriceComplete: booleanValue(
        economics.landedSoldPriceComplete,
        economics.landed_sold_price_complete,
        row.landed_sold_price_complete,
        Boolean((soldExactUnits ?? 0) > 0 && observedMarketPrice !== null),
      ),
      netProfitUsd: numberValue(
        economics.netProfitUsd,
        economics.net_profit_usd,
        row.net_profit_usd,
        row.estimated_net_profit,
        assessmentEconomics.estimatedNetProfit,
      ),
      marginRate: rateValue(
        economics.marginRate,
        economics.margin_rate,
        row.margin_rate,
        assessmentEconomics.estimatedNetMarginPercent,
      ),
      roiRate: rateValue(
        economics.roiRate,
        economics.roi_rate,
        row.roi_rate,
        assessmentEconomics.estimatedRoiPercent,
      ),
      safeFloorUsd: numberValue(
        economics.safeFloorUsd,
        economics.safe_floor_usd,
        row.safe_floor_usd,
        assessmentEconomics.minimumProfitablePrice,
        assessmentEconomics.minimumOperatorPrice,
      ),
      targetPriceUsd: numberValue(
        economics.targetPriceUsd,
        economics.target_price_usd,
        row.target_price_usd,
        assessmentEconomics.salePrice,
        observedMarketPrice,
      ),
      score: numberValue(
        economics.score,
        economics.commercialViabilityScore,
        row.commercial_viability_score,
        row.economics_score,
        assessmentScores.economicsScore,
      ),
    },
    operational: {
      categoryValid: booleanValue(
        operational.categoryValid,
        operational.category_valid,
        row.category_valid,
        categoryFromAssessment,
      ),
      complianceResolved: booleanValue(
        operational.complianceResolved,
        operational.compliance_resolved,
        row.compliance_resolved,
        complianceFromAssessment,
      ),
      weightResolved: booleanValue(
        operational.weightResolved,
        operational.weight_resolved,
        row.weight_resolved,
        fulfillmentEvidence.weightConfirmed,
      ),
      dimensionsResolved: booleanValue(
        operational.dimensionsResolved,
        operational.dimensions_resolved,
        row.dimensions_resolved,
        fulfillmentEvidence.dimensionsRequired === false ||
          fulfillmentEvidence.dimensionsConfirmed === true,
      ),
      imagesAuthorized: booleanValue(
        operational.imagesAuthorized,
        operational.images_authorized,
        row.images_authorized,
        imagePlan.authorizedLunaImagesAvailable,
      ),
      listingFactsComplete: booleanValue(
        operational.listingFactsComplete,
        operational.listing_facts_complete,
        row.listing_facts_complete,
        listingFactsFromAssessment,
      ),
      score: numberValue(
        operational.score,
        operational.operationalReadinessScore,
        row.operational_readiness_score,
        row.listing_readiness_score,
        assessmentScores.listingReadinessScore,
      ),
    },
    risk: {
      score: numberValue(risk.score, row.risk_score),
      blockerCodes: riskBlockerCodes,
    },
    confidenceScore: numberValue(
      row.confidence_score,
      row.overall_confidence_score,
      assessmentScores.confidenceScore,
      row.identity_score,
    ),
  }
}

async function loadSoldEvidenceCoverage(
  supabase: SupabaseClient,
  accountKey: string,
  marketplace: string,
) {
  try {
    const [
      observations,
      reviewed,
      canonical,
    ] = await Promise.all([
      supabase
        .from("marketplace_product_research_capture_observations")
        .select("id", { count: "exact", head: true })
        .eq("marketplace_account_key", accountKey)
        .eq("marketplace", marketplace),
      supabase
        .from("marketplace_product_research_capture_observations")
        .select(
          "matched_supplier_variant_id,match_classification",
          { count: "exact" },
        )
        .eq("marketplace_account_key", accountKey)
        .eq("marketplace", marketplace)
        .eq("evidence_reviewed", true)
        .limit(10_000),
      supabase
        .from("marketplace_product_research_canonical_demand_v2")
        .select("id", { count: "exact", head: true })
        .eq("marketplace_account_key", accountKey)
        .eq("marketplace", marketplace),
    ])
    if (observations.error || reviewed.error || canonical.error) {
      throw new Error("SOLD_EVIDENCE_COVERAGE_READ_FAILED")
    }
    const reviewedRows = (reviewed.data ?? []) as JsonRecord[]
    const matchedVariants = new Set(
      reviewedRows
        .map((row) => textValue(row.matched_supplier_variant_id))
        .filter((value): value is string => Boolean(value)),
    )
    const exactLunaMatchCount = reviewedRows.filter(
      (row) => row.match_classification === "EXACT_LUNA_MATCH",
    ).length
    const observationsCollected = observations.count ?? 0
    const canonicalDemandRows = canonical.count ?? 0
    return {
      status: canonicalDemandRows > 0
        ? "CANONICAL_SOLD_EVIDENCE_AVAILABLE"
        : observationsCollected > 0
          ? "SOLD_EVIDENCE_COLLECTED_IDENTITY_UNRESOLVED"
          : "SOLD_EVIDENCE_NOT_COLLECTED",
      observationsCollected,
      reviewedObservations: reviewed.count ?? 0,
      reviewedRowsSampled: reviewedRows.length,
      matchedSupplierVariantCountSampled: matchedVariants.size,
      exactLunaMatchCountSampled: exactLunaMatchCount,
      canonicalDemandRows,
      marketAbsenceClaimed: false as const,
    }
  } catch {
    return {
      status: "SOLD_EVIDENCE_COVERAGE_UNAVAILABLE" as const,
      observationsCollected: null,
      reviewedObservations: null,
      reviewedRowsSampled: 0,
      matchedSupplierVariantCountSampled: 0,
      exactLunaMatchCountSampled: 0,
      canonicalDemandRows: null,
      marketAbsenceClaimed: false as const,
    }
  }
}

const EBAY_LUNA_SELECTOR_V2_QUEUE_PAGE_SIZE = 1_000
export const EBAY_LUNA_SELECTOR_V2_MAX_QUEUE_ROWS = 10_000

type QueueScopeColumns = {
  account: "marketplace_account_key" | "account_key" | null
  marketplace: "marketplace" | "marketplace_id" | null
}

export async function loadEbayLunaSelectorV2QueueRows(input: {
  supabase: SupabaseClient
  accountKey: string
  marketplace: string
}) {
  const scopeColumns: QueueScopeColumns = {
    account: "marketplace_account_key",
    marketplace: "marketplace",
  }
  const rows: JsonRecord[] = []
  let offset = 0
  while (rows.length <= EBAY_LUNA_SELECTOR_V2_MAX_QUEUE_ROWS) {
    const requestedRows = Math.min(
      EBAY_LUNA_SELECTOR_V2_QUEUE_PAGE_SIZE,
      EBAY_LUNA_SELECTOR_V2_MAX_QUEUE_ROWS + 1 - rows.length,
    )
    const { data, error } = await input.supabase.rpc(
      "read_eligible_ebay_luna_opportunities_v2",
      {
        p_account_key: input.accountKey,
        p_marketplace: input.marketplace,
        p_limit: requestedRows,
        p_offset: offset,
      },
    )
    if (error) throw new Error("EBAY_LUNA_SELECTOR_V2_QUEUE_READ_FAILED")
    const page = (data ?? []) as JsonRecord[]
    rows.push(...page)
    if (page.length < requestedRows) break
    offset += page.length
  }
  const truncated = rows.length > EBAY_LUNA_SELECTOR_V2_MAX_QUEUE_ROWS
  return {
    rows: truncated ? [] : rows,
    scannedRows: rows.length,
    truncated,
    scopeColumns,
  }
}

async function loadPolicy(
  supabase: SupabaseClient,
  accountKey: string,
  marketplace: string,
) {
  const { data: exact, error: exactError } = await supabase
    .from("ebay_luna_selector_policies_v2")
    .select("policy_version,enabled,shadow_mode,policy")
    .eq("scope_key", accountKey)
    .eq("marketplace", marketplace)
    .maybeSingle()
  if (exactError) throw new Error("EBAY_LUNA_SELECTOR_V2_POLICY_READ_FAILED")
  if (exact) return exact
  const { data: fallback, error: fallbackError } = await supabase
    .from("ebay_luna_selector_policies_v2")
    .select("policy_version,enabled,shadow_mode,policy")
    .eq("scope_key", "DEFAULT")
    .eq("marketplace", marketplace)
    .maybeSingle()
  if (fallbackError) throw new Error("EBAY_LUNA_SELECTOR_V2_POLICY_READ_FAILED")
  return fallback
}

export async function runEbayLunaSelectorV2Shadow(input: {
  supabase: SupabaseClient
  runId?: string | null
  now?: Date
  env?: NodeJS.ProcessEnv
}) {
  const configuration = getEbayLunaSelectorV2ShadowConfiguration(input.env)
  if (!configuration.enabled) {
    return {
      ...configuration,
      evaluated: 0,
      persisted: 0,
      ready: 0,
      bootstrapCanaries: 0,
      exploratory: 0,
      unfilledSlots: 5,
    }
  }
  const [
    { getEbaySellerAccountScopeConfiguration },
    {
      DEFAULT_EBAY_LUNA_SELECTOR_V2_POLICY,
      evaluateEbayLunaSelectorCandidateV2,
      selectEbayLunaBatchV2,
    },
  ] = await Promise.all([
    import("./ebay-seller-account-scope"),
    import("./ebay-luna-selector-v2-domain"),
  ])
  const account = getEbaySellerAccountScopeConfiguration()
  if (!account.accountKey) throw new Error("EBAY_SELLER_ACCOUNT_SCOPE_REQUIRED")
  const marketplace = "EBAY_US"
  const persistedPolicy = await loadPolicy(
    input.supabase,
    account.accountKey,
    marketplace,
  )
  if (!persistedPolicy || persistedPolicy.enabled !== true) {
    return {
      ...configuration,
      enabled: false,
      reason: "SELECTOR_V2_DATABASE_POLICY_DISABLED",
      evaluated: 0,
      persisted: 0,
      ready: 0,
      bootstrapCanaries: 0,
      exploratory: 0,
      unfilledSlots: DEFAULT_EBAY_LUNA_SELECTOR_V2_POLICY.targetBatchSize,
    }
  }
  if (persistedPolicy.shadow_mode !== true) {
    throw new Error("EBAY_LUNA_SELECTOR_V2_SHADOW_MODE_REQUIRED")
  }
  const policy = safePolicy(
    {
      ...record(persistedPolicy.policy),
      policyVersion: persistedPolicy.policy_version,
    },
    DEFAULT_EBAY_LUNA_SELECTOR_V2_POLICY,
  )
  const capturedAt = input.now ?? new Date()
  const queueRead = await loadEbayLunaSelectorV2QueueRows({
    supabase: input.supabase,
    accountKey: account.accountKey,
    marketplace,
  })
  if (queueRead.truncated) {
    return {
      ...configuration,
      reason: "EBAY_LUNA_SELECTOR_V2_QUEUE_TRUNCATED_FAIL_CLOSED",
      evaluated: 0,
      persisted: 0,
      ready: 0,
      bootstrapCanaries: 0,
      exploratory: 0,
      unfilledSlots: policy.targetBatchSize,
      queueRowsScanned: queueRead.scannedRows,
      queueTruncated: true,
      queueScopeColumns: queueRead.scopeColumns,
    }
  }
  const sourceRows = queueRead.rows
  const candidates = sourceRows.map(normalizeEbayLunaSelectorV2QueueRow)
  const evaluations = candidates.map((candidate) =>
    evaluateEbayLunaSelectorCandidateV2(candidate, {
      now: capturedAt,
      policy,
    }),
  )
  const batch = selectEbayLunaBatchV2(evaluations, policy)
  const soldEvidencePipeline = await loadSoldEvidenceCoverage(
    input.supabase,
    account.accountKey,
    marketplace,
  )
  const queueDemandEvaluated = candidates.filter(
    (candidate) => candidate.demand.historicalMarketCheckCompleted,
  ).length
  const freshSupplierEvidence = candidates.filter((candidate) => {
    const observedAt = candidate.supplier.observedAt
      ? Date.parse(candidate.supplier.observedAt)
      : Number.NaN
    return Number.isFinite(observedAt) &&
      capturedAt.getTime() - observedAt <=
        policy.maximumSupplierEvidenceAgeHours * 3_600_000
  }).length
  const soldEvidenceCoverage = {
    ...soldEvidencePipeline,
    queueCandidates: candidates.length,
    queueDemandEvaluated,
    queueCoverageRate: candidates.length
      ? queueDemandEvaluated / candidates.length
      : 0,
  }
  const queueFreshness = {
    queueCandidates: candidates.length,
    freshSupplierEvidence,
    staleOrUnknownSupplierEvidence:
      candidates.length - freshSupplierEvidence,
    freshnessRate: candidates.length
      ? freshSupplierEvidence / candidates.length
      : 0,
    maximumSupplierEvidenceAgeHours:
      policy.maximumSupplierEvidenceAgeHours,
  }
  const readyPosition = new Map(
    batch.ready.map((row, index) => [row.candidateKey, index + 1]),
  )
  const researchOrder = [...evaluations].sort((left, right) =>
    right.researchPriorityScore - left.researchPriorityScore ||
    left.candidateKey.localeCompare(right.candidateKey),
  )
  const researchPosition = new Map(
    researchOrder.map((row, index) => [row.candidateKey, index + 1]),
  )
  const exploratoryKeys = new Set(
    batch.bootstrapCanaries.map((row) => row.candidateKey),
  )
  const bootstrapCanaryPosition = new Map(
    batch.bootstrapCanaries.map(
      (row, index) => [row.candidateKey, index + 1],
    ),
  )
  const selectedKeys = new Set(batch.ready.map((row) => row.candidateKey))
  const batchSelectionHash = sha256({
    policyVersion: policy.policyVersion,
    ready: batch.ready.map((row) => row.candidateKey),
    bootstrapCanaries: batch.bootstrapCanaries.map(
      (row) => row.candidateKey,
    ),
    unfilledSlots: batch.unfilledSlots,
  })
  const rows = evaluations.map((evaluation) => {
    const evidenceHash = sha256({
      policyVersion: evaluation.policyVersion,
      evaluation,
    })
    const snapshotKey = sha256({
      accountKey: account.accountKey,
      marketplace,
      runId: input.runId ?? null,
      candidateKey: evaluation.candidateKey,
      evidenceHash,
      batchSelectionHash,
      selectedForReadyBatch: selectedKeys.has(evaluation.candidateKey),
      selectedForBootstrapCanary:
        exploratoryKeys.has(evaluation.candidateKey),
      readyPosition: readyPosition.get(evaluation.candidateKey) ?? null,
      bootstrapCanaryPosition:
        bootstrapCanaryPosition.get(evaluation.candidateKey) ?? null,
    })
    return {
      snapshot_key: snapshotKey,
      run_id: input.runId ?? null,
      marketplace_account_key: account.accountKey,
      marketplace,
      policy_version: evaluation.policyVersion,
      candidate_key: evaluation.candidateKey,
      product_id: evaluation.productId,
      supplier_variant_id: evaluation.supplierVariantId,
      supplier_sku: evaluation.supplierSku,
      family_key: evaluation.familyKey,
      category_id: evaluation.categoryId,
      evidence_class: evaluation.evidenceClass,
      evidence_observed_at: evaluation.evidenceObservedAt,
      sold_exact_units: evaluation.soldExactUnits,
      sold_exact_seller_count: evaluation.soldExactSellerCount,
      sold_exact_comparable_count: evaluation.soldExactComparableCount,
      supplier_readiness_score: evaluation.supplierReadinessScore,
      supplier_rotation_score: evaluation.supplierRotationScore,
      ebay_demand_score: evaluation.ebayDemandScore,
      commercial_viability_score: evaluation.commercialViabilityScore,
      operational_readiness_score: evaluation.operationalReadinessScore,
      risk_score: evaluation.riskScore,
      confidence_score: evaluation.confidenceScore,
      final_selection_score: evaluation.finalSelectionScore,
      research_eligibility_score: evaluation.researchEligibilityScore,
      research_priority_score: evaluation.researchPriorityScore,
      consumable_research_boost: evaluation.consumableResearchBoost,
      fairness_boost: evaluation.fairnessBoost,
      hard_gate_codes: evaluation.hardGateCodes,
      ready_to_list: evaluation.readyToList,
      eligible_for_exploration: evaluation.eligibleForExploration,
      eligible_for_research: evaluation.eligibleForResearch,
      eligible_for_bootstrap_canary:
        evaluation.eligibleForBootstrapCanary,
      selected_for_ready_batch: selectedKeys.has(evaluation.candidateKey),
      selected_for_exploration: exploratoryKeys.has(evaluation.candidateKey),
      selected_for_bootstrap_canary:
        exploratoryKeys.has(evaluation.candidateKey),
      ready_position: readyPosition.get(evaluation.candidateKey) ?? null,
      bootstrap_canary_position:
        bootstrapCanaryPosition.get(evaluation.candidateKey) ?? null,
      research_position: researchPosition.get(evaluation.candidateKey) ?? null,
      selection_mode: evaluation.selectionMode,
      forced_listing_quantity: evaluation.forcedListingQuantity,
      promotion_rate_percent: evaluation.promotionRatePercent,
      price_decrease_allowed: evaluation.canDecreasePrice,
      external_writes_allowed: evaluation.externalWritesAllowed,
      commercial_monitor_required:
        evaluation.commercialMonitorRequired,
      one_variable_at_a_time: evaluation.oneVariableAtATime,
      execution_mode: "SHADOW",
      selection_reason: evaluation.selectionReason,
      evidence_hash: evidenceHash,
      captured_at: capturedAt.toISOString(),
    }
  })
  if (rows.length) {
    const { error } = await input.supabase
      .from("ebay_luna_selector_ranking_snapshots_v2")
      .upsert(rows, {
        onConflict: "snapshot_key",
        ignoreDuplicates: true,
      })
    if (error) throw new Error("EBAY_LUNA_SELECTOR_V2_SNAPSHOT_WRITE_FAILED")
  }
  return {
    ...configuration,
    policyVersion: policy.policyVersion,
    evaluated: evaluations.length,
    persisted: rows.length,
    ready: batch.ready.length,
    bootstrapCanaries: batch.bootstrapCanaries.length,
    exploratory: batch.exploratory.length,
    researchOnly: batch.researchOnly.length,
    unfilledSlots: batch.unfilledSlots,
    explanation: batch.explanation,
    diagnostic: soldEvidenceCoverage.status ===
        "SOLD_EVIDENCE_COLLECTED_IDENTITY_UNRESOLVED"
      ? "PIPELINE_HAS_SOLD_EVIDENCE_PENDING_EXACT_IDENTITY_RECONCILIATION"
      : soldEvidenceCoverage.queueCoverageRate < 1
        ? "PIPELINE_COVERAGE_INCOMPLETE_NOT_MARKET_ABSENCE"
        : batch.explanation,
    soldEvidenceCoverage,
    queueFreshness,
    marketAbsenceClaimed: false,
    queueRowsScanned: queueRead.scannedRows,
    queueTruncated: false,
    queueScopeColumns: queueRead.scopeColumns,
  }
}
