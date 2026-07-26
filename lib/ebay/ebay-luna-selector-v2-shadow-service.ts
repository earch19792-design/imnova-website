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

function booleanValue(...values: unknown[]) {
  for (const value of values) {
    if (value === true || value === "true") return true
    if (value === false || value === "false") return false
  }
  return false
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
  const supplier = firstRecord(
    row.supplier,
    row.luna,
    row.supplier_evidence,
    row.luna_snapshot,
  )
  const demand = firstRecord(
    row.demand,
    row.demand_evidence,
    row.sold_evidence,
    row.ebay_market,
  )
  const identity = firstRecord(
    row.identity,
    demand.identity,
    row.identity_evidence,
  )
  const economics = firstRecord(
    row.economics,
    row.economic_evaluation,
    row.profitability,
  )
  const operational = firstRecord(
    row.operational,
    row.readiness,
    row.listing_readiness,
  )
  const risk = firstRecord(row.risk, row.risk_evaluation)
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
  return {
    candidateKey,
    productId,
    supplierProductId: textValue(
      row.supplier_product_id,
      supplier.supplierProductId,
    ),
    supplierVariantId: textValue(
      row.supplier_variant_id,
      supplier.supplierVariantId,
    ),
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
    supplier: {
      productCurrent: booleanValue(
        supplier.productCurrent,
        supplier.product_current,
        row.supplier_product_current,
      ),
      exactVariant: booleanValue(
        supplier.exactVariant,
        supplier.exact_variant,
        identity.exactSupplierVariant,
        row.exact_supplier_variant,
      ),
      numericStock: numberValue(
        supplier.numericStock,
        supplier.inventoryQuantity,
        supplier.inventory_quantity,
        row.inventory_quantity,
      ),
      costUsd: numberValue(
        supplier.costUsd,
        supplier.cost_usd,
        row.cost_usd,
        row.supplier_cost,
      ),
      observedAt: textValue(
        supplier.observedAt,
        supplier.observed_at,
        row.source_observed_at,
        row.snapshot_captured_at,
      ),
      rotationClass: rotationClass(
        supplier.rotationClass ??
        supplier.rotation_class ??
        row.supplier_rotation_class,
      ),
      readinessScore: numberValue(
        supplier.readinessScore,
        row.supplier_readiness_score,
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
      soldExactUnits: numberValue(
        demand.soldExactUnits,
        demand.sold_exact_units,
        row.sold_exact_units,
      ),
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
      score: numberValue(
        demand.score,
        demand.demandScore,
        row.ebay_demand_score,
      ),
      confidenceScore: numberValue(
        demand.confidenceScore,
        row.demand_confidence_score,
      ),
    },
    economics: {
      landedSoldPriceComplete: booleanValue(
        economics.landedSoldPriceComplete,
        economics.landed_sold_price_complete,
        row.landed_sold_price_complete,
      ),
      netProfitUsd: numberValue(
        economics.netProfitUsd,
        economics.net_profit_usd,
        row.net_profit_usd,
      ),
      marginRate: numberValue(
        economics.marginRate,
        economics.margin_rate,
        row.margin_rate,
      ),
      roiRate: numberValue(
        economics.roiRate,
        economics.roi_rate,
        row.roi_rate,
      ),
      safeFloorUsd: numberValue(
        economics.safeFloorUsd,
        economics.safe_floor_usd,
        row.safe_floor_usd,
      ),
      targetPriceUsd: numberValue(
        economics.targetPriceUsd,
        economics.target_price_usd,
        row.target_price_usd,
      ),
      score: numberValue(
        economics.score,
        economics.commercialViabilityScore,
        row.commercial_viability_score,
      ),
    },
    operational: {
      categoryValid: booleanValue(
        operational.categoryValid,
        operational.category_valid,
        row.category_valid,
      ),
      complianceResolved: booleanValue(
        operational.complianceResolved,
        operational.compliance_resolved,
        row.compliance_resolved,
      ),
      weightResolved: booleanValue(
        operational.weightResolved,
        operational.weight_resolved,
        row.weight_resolved,
      ),
      dimensionsResolved: booleanValue(
        operational.dimensionsResolved,
        operational.dimensions_resolved,
        row.dimensions_resolved,
      ),
      imagesAuthorized: booleanValue(
        operational.imagesAuthorized,
        operational.images_authorized,
        row.images_authorized,
      ),
      listingFactsComplete: booleanValue(
        operational.listingFactsComplete,
        operational.listing_facts_complete,
        row.listing_facts_complete,
      ),
      score: numberValue(
        operational.score,
        operational.operationalReadinessScore,
        row.operational_readiness_score,
      ),
    },
    risk: {
      score: numberValue(risk.score, row.risk_score),
      blockerCodes: textArray(
        risk.blockerCodes ??
        risk.blocker_codes ??
        row.blocker_codes,
      ),
    },
    confidenceScore: numberValue(
      row.confidence_score,
      row.overall_confidence_score,
    ),
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
      exploratory: 0,
      unfilledSlots: policy.targetBatchSize,
      queueRowsScanned: queueRead.scannedRows,
      queueTruncated: true,
      queueScopeColumns: queueRead.scopeColumns,
    }
  }
  const sourceRows = queueRead.rows
  const evaluations = sourceRows.map((row) =>
    evaluateEbayLunaSelectorCandidateV2(
      normalizeEbayLunaSelectorV2QueueRow(row),
      { now: capturedAt, policy },
    ),
  )
  const batch = selectEbayLunaBatchV2(evaluations, policy)
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
    batch.exploratory.map((row) => row.candidateKey),
  )
  const selectedKeys = new Set(batch.ready.map((row) => row.candidateKey))
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
      research_priority_score: evaluation.researchPriorityScore,
      fairness_boost: evaluation.fairnessBoost,
      hard_gate_codes: evaluation.hardGateCodes,
      ready_to_list: evaluation.readyToList,
      eligible_for_exploration: evaluation.eligibleForExploration,
      selected_for_ready_batch: selectedKeys.has(evaluation.candidateKey),
      selected_for_exploration: exploratoryKeys.has(evaluation.candidateKey),
      ready_position: readyPosition.get(evaluation.candidateKey) ?? null,
      research_position: researchPosition.get(evaluation.candidateKey) ?? null,
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
    exploratory: batch.exploratory.length,
    unfilledSlots: batch.unfilledSlots,
    explanation: batch.explanation,
    queueRowsScanned: queueRead.scannedRows,
    queueTruncated: false,
    queueScopeColumns: queueRead.scopeColumns,
  }
}
