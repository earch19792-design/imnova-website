import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildMinimumTruthfulListingReadinessV1,
  MINIMUM_TRUTHFUL_LISTING_READINESS_V1,
  type MinimumTruthfulGateStateV1,
} from "./ebay-minimum-truthful-listing-readiness-v1"

export const QUICK_PICK_MINIMUM_READINESS_CONTINUATION_V1 =
  "QUICK_PICK_MINIMUM_READINESS_CONTINUATION_V1" as const

const MAXIMUM_QUICK_PICKS = 20
type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().slice(0, maximum) : ""
}

function strings(value: unknown, maximum = 100) {
  return Array.isArray(value) ? value.flatMap((entry) => {
    const parsed = text(entry, 160)
    return parsed ? [parsed] : []
  }).slice(0, maximum) : []
}

function gate(value: boolean): MinimumTruthfulGateStateV1 {
  return value ? "PASS" : "FAIL"
}

function productIdentifierState(canonical: JsonRecord) {
  const policy = record(canonical.productIdentifierPolicy)
  const blockers = strings(canonical.blockers)
  if (canonical.productIdentifiersReady === true && policy.safe === true) {
    return "PASS" as const
  }
  if (blockers.includes("WAITING_FOR_EBAY_CAPABILITY")
      || policy.blocker ===
        "EBAY_CATEGORY_PRODUCT_IDENTIFIER_POLICY_UNAVAILABLE"
      || Number(policy.httpStatus ?? -1) === 0
      || Number(policy.httpStatus ?? 0) === 429
      || Number(policy.httpStatus ?? 0) >= 500) {
    return "UNPROVEN_CAPABILITY" as const
  }
  return "BLOCKED_REQUIRED_FACT" as const
}

export function projectQuickPickMinimumTruthfulReadinessV1(input: Readonly<{
  opportunity: JsonRecord
  listingPackage: JsonRecord
  evaluatedAt?: string
}>) {
  const opportunity = input.opportunity
  const assessment = record(opportunity.assessment)
  const factory = record(assessment.sellerOsDeterministicFactory)
  const stages = record(factory.stageStatuses)
  const candidate = record(assessment.radarFactoryCandidateV1)
  const shipping = record(assessment.radarAutomaticLunaShippingContinuationV1)
  const productTruth = record(assessment.productTruth)
  const canonical = record(assessment.canonicalMarketplaceReadinessV1)
  const taxonomyPreflight = record(canonical.taxonomyPreflight)
  const continuation = record(
    assessment.quickPickRequiredSpecificsContinuationV1)
  const existing = record(assessment.minimumTruthfulListingReadinessV1)
  const factoryBlockers = strings(factory.blockers)
  const canonicalBlockers = strings(canonical.blockers)
  const packageExact = input.listingPackage.opportunity_id === opportunity.id
    && input.listingPackage.candidate_key === opportunity.candidate_key
    && /^[0-9a-f-]{36}$/i.test(text(input.listingPackage.id, 80))
  const candidateExact = candidate.contractVersion ===
      "NIGHT_RADAR_AUTOMATIC_GOLDEN_PATH_HANDOFF_V1"
    && candidate.authority === "SELLER_OS_DETERMINISTIC_FACTORY"
    && candidate.candidateId === opportunity.candidate_key
  const exactTruth = /^sha256:[0-9a-f]{64}$/.test(
    text(productTruth.evidenceDigest, 80))
    && text(productTruth.lunaProductId, 80) ===
      text(opportunity.supplier_product_id, 80)
    && text(productTruth.lunaVariantId, 80) ===
      text(opportunity.supplier_variant_id, 80)
    && text(productTruth.supplierSku, 120) ===
      text(opportunity.supplier_sku, 120)
  const duplicatePassed = !factoryBlockers.some((blocker) =>
    blocker === "ACTIVE_DUPLICATE"
    || blocker === "ACTIVE_DUPLICATE_GUARD_UNAVAILABLE")
  const stockPassed = opportunity.supplier_available === true
    && Number(opportunity.supplier_price ?? 0) > 0
    && (opportunity.supplier_inventory_quantity === null
      || Number(opportunity.supplier_inventory_quantity ?? 0) > 0)
  const demandStagePassed = stages.DEMAND_READY === "READY"
  const demand = !demandStagePassed ? "FAIL" as const
    : factory.decisionPackageId === null
      ? "UNPROVEN_MARKET_TEST_ALLOWED" as const : "PASS" as const
  const complianceBlocked = [...factoryBlockers, ...canonicalBlockers]
    .some((blocker) => /COMPLIANCE|MATERIAL_FALSEHOOD|POLICY_BLOCKER/.test(
      blocker))
  return buildMinimumTruthfulListingReadinessV1({
    candidateKey: text(opportunity.candidate_key, 300),
    opportunityId: text(opportunity.id, 80),
    supplierProductId: text(opportunity.supplier_product_id, 80),
    supplierVariantId: text(opportunity.supplier_variant_id, 80),
    supplierSku: text(opportunity.supplier_sku, 120),
    listingPackageId: text(input.listingPackage.id, 80),
    taxonomyPreflight,
    ownerProposals: rows(continuation.residualOwnerActions),
    residualSpecificNames: Array.isArray(continuation.exactUnresolvedFields)
      ? continuation.exactUnresolvedFields.map((value) => text(value, 120))
        .filter(Boolean)
      : strings(canonical.unsupportedRequiredSpecifics),
    identity: gate(candidateExact),
    duplicate: gate(duplicatePassed),
    stock: gate(stockPassed),
    demand,
    shipping: gate(shipping.shippingJobStatus ===
      "SHIPPING_EVIDENCE_DURABLE"),
    economics: gate(stages.ECONOMICS_READY === "READY"),
    productTruthMaterial: gate(stages.PRODUCT_TRUTH_READY === "READY"
      && exactTruth),
    category: gate(packageExact && canonical.categoryReady === true),
    condition: gate(canonical.conditionReady === true),
    productIdentifiers: productIdentifierState(canonical),
    listingPolicy: gate(canonical.listingPolicyReady === true),
    compliance: gate(!complianceBlocked),
    // Reuse the prior timestamp so an unchanged GET is truly idempotent.
    evaluatedAt: input.evaluatedAt
      ?? (text(existing.evaluatedAt, 80) || undefined),
  })
}

export async function continueLunaQuickPickMinimumReadinessV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  candidateKeys: readonly string[]
}>) {
  const candidateKeys = [...new Set(input.candidateKeys.filter((value) =>
    /^sha256:[0-9a-f]{64}$/.test(value)))].slice(0, MAXIMUM_QUICK_PICKS)
  if (!candidateKeys.length) return Object.freeze({ attempted: 0, updated: 0,
    unchanged: 0, ownerLastMileProductsCount: 0,
    ownerLastMileFactCount: 0, marketplaceWrites: 0 as const })
  const opportunityRead = await input.supabase
    .from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,supplier_available,supplier_price,supplier_inventory_quantity,assessment,updated_at")
    .in("candidate_key", candidateKeys).limit(MAXIMUM_QUICK_PICKS)
  if (opportunityRead.error) {
    throw new Error("QUICK_PICK_MINIMUM_READINESS_READ_FAILED")
  }
  const opportunities = rows(opportunityRead.data)
  const opportunityIds = opportunities.map((row) => text(row.id, 80))
    .filter(Boolean)
  const packageRead = opportunityIds.length
    ? await input.supabase.from("ebay_listing_packages")
      .select("id,account_key,opportunity_id,candidate_key,status,package_data,updated_at")
      .eq("account_key", input.accountKey)
      .in("opportunity_id", opportunityIds).limit(MAXIMUM_QUICK_PICKS)
    : { data: [], error: null }
  if (packageRead.error) {
    throw new Error("QUICK_PICK_MINIMUM_READINESS_PACKAGE_READ_FAILED")
  }
  const packages = new Map(rows(packageRead.data).map((row) =>
    [text(row.opportunity_id, 80), row]))
  let updated = 0
  let unchanged = 0
  let ownerLastMileProductsCount = 0
  let ownerLastMileFactCount = 0
  const results: JsonRecord[] = []
  for (const opportunity of opportunities) {
    const listingPackage = packages.get(text(opportunity.id, 80))
    if (!listingPackage) continue
    const assessment = record(opportunity.assessment)
    const current = record(assessment.minimumTruthfulListingReadinessV1)
    const projected = projectQuickPickMinimumTruthfulReadinessV1({
      opportunity,
      listingPackage,
      evaluatedAt: current.contractVersion ===
        MINIMUM_TRUTHFUL_LISTING_READINESS_V1
        ? text(current.evaluatedAt, 80) : undefined,
    })
    const ownerActions = rows(projected.ownerLastMileActions)
    if (ownerActions.length) ownerLastMileProductsCount += 1
    ownerLastMileFactCount += ownerActions.length
    if (current.contractVersion === MINIMUM_TRUTHFUL_LISTING_READINESS_V1
        && current.evidenceDigest === projected.evidenceDigest) {
      unchanged += 1
      results.push(projected as unknown as JsonRecord)
      continue
    }
    const now = new Date().toISOString()
    const marker = Object.freeze({ ...projected,
      continuationContractVersion:
        QUICK_PICK_MINIMUM_READINESS_CONTINUATION_V1,
      rehydratedAt: now,
      researchRerunCount: 0,
      soldResearchRerunCount: 0,
      visualRerunCount: 0,
      sellerWideTradingCalls: 0,
      newOperationCount: 0,
      duplicateOperationCount: 0,
    })
    const write = await input.supabase.from("ebay_luna_opportunity_queue")
      .update({ assessment: { ...assessment,
        minimumTruthfulListingReadinessV1: marker }, updated_at: now })
      .eq("id", opportunity.id)
      .eq("candidate_key", opportunity.candidate_key)
      .eq("supplier_product_id", opportunity.supplier_product_id)
      .eq("supplier_variant_id", opportunity.supplier_variant_id)
      .eq("supplier_sku", opportunity.supplier_sku)
      .eq("updated_at", opportunity.updated_at)
      .select("id,assessment").maybeSingle()
    const stored = record(record(record(write.data).assessment)
      .minimumTruthfulListingReadinessV1)
    if (write.error || !write.data
        || stored.evidenceDigest !== projected.evidenceDigest
        || stored.marketplaceWrites !== 0) {
      throw new Error("QUICK_PICK_MINIMUM_READINESS_DURABLE_WRITE_FAILED")
    }
    updated += 1
    results.push(marker as unknown as JsonRecord)
  }
  return Object.freeze({ attempted: candidateKeys.length, updated, unchanged,
    ownerLastMileProductsCount, ownerLastMileFactCount,
    results: Object.freeze(results),
    newOperationCount: 0 as const,
    duplicateOperationCount: 0 as const,
    soldResearchRerunCount: 0 as const,
    visualRerunCount: 0 as const,
    sellerWideTradingCalls: 0 as const,
    marketplaceWrites: 0 as const,
  })
}
