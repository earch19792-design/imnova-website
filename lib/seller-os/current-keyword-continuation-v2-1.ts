import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildProductResearchCommercialQueryPlanV1,
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
} from "../ebay/ebay-product-research-query-plan.ts"
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { currentFactoryMarkerV1 } from "./current-publication-factory-v1.ts"
import {
  consumeListingPackageKeywordHandoffV1,
  decodeKeywordReadV1,
  keywordRecord as record,
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
} from "./keyword-intelligence-handoff-v1.ts"

export const CURRENT_FACTORY_KEYWORD_CONTINUATION_V2_1 =
  "CURRENT_FACTORY_KEYWORD_CONTINUATION_V2_1" as const

type JsonRecord = Record<string, unknown>

function text(value: unknown, maximum = 350) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum)
    : ""
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(
    typeof value === "string" ? value : JSON.stringify(value),
  ).digest("hex")}`
}

function truthBrand(assessment: JsonRecord) {
  const truth = record(record(assessment.productTruth).fieldTruthV1)
  const fields = Array.isArray(truth.fields) ? truth.fields.map(record) : []
  const brand = fields.find((field) => field.FIELD === "BRAND" &&
    field.SEMANTIC_CLASS === "FACT" && field.EVIDENCE_STATUS === "PROVEN" &&
    field.CONTRADICTION !== true)
  return text(brand?.VALUE, 100) || null
}

export function projectCurrentFactoryKeywordIdentityV2_1(input: Readonly<{
  listingPackage: unknown
  opportunity: unknown
}>) {
  const listingPackage = record(input.listingPackage)
  const opportunity = record(input.opportunity)
  const marker = currentFactoryMarkerV1(listingPackage.package_data)
  const assessment = record(opportunity.assessment)
  const packageId = text(listingPackage.id, 40)
  const opportunityId = text(opportunity.id, 40)
  const candidateKey = text(opportunity.candidate_key, 120)
  const productId = text(opportunity.supplier_product_id, 30)
  const variantId = text(opportunity.supplier_variant_id, 30)
  const supplierSku = text(opportunity.supplier_sku, 160)
  const productTitle = text(opportunity.product_title, 350)
  const validCandidate = /^sha256:[0-9a-f]{64}$/.test(candidateKey) ||
    /^luna-portex:\d{1,30}:\d{1,30}$/.test(candidateKey)
  const exact = Boolean(marker && packageId && opportunityId && validCandidate &&
    /^\d{1,30}$/.test(productId) && /^\d{1,30}$/.test(variantId) &&
    supplierSku && productTitle && marker.packageId === packageId &&
    marker.accountKey === listingPackage.account_key &&
    marker.productId === productId && marker.variantId === variantId &&
    marker.supplierSku === supplierSku &&
    listingPackage.opportunity_id === opportunityId &&
    listingPackage.candidate_key === candidateKey)
  return Object.freeze({ exact, packageId, opportunityId, candidateKey,
    productId, variantId, supplierSku, productTitle,
    productBrand: truthBrand(assessment) })
}

export async function continueCurrentFactoryKeywordV2_1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  listingPackage: unknown
  now?: Date
}>) {
  const pkg = record(input.listingPackage)
  const opportunityId = text(pkg.opportunity_id, 40)
  const candidateKey = text(pkg.candidate_key, 120)
  if (!opportunityId || !candidateKey) {
    throw new Error("CURRENT_KEYWORD_PACKAGE_IDENTITY_REQUIRED")
  }
  const read = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,product_title,opportunity_score,assessment")
    .eq("id", opportunityId).eq("candidate_key", candidateKey)
    .limit(1).maybeSingle()
  if (read.error || !read.data) {
    throw new Error("CURRENT_KEYWORD_PRODUCT_TRUTH_READ_FAILED")
  }
  const identity = projectCurrentFactoryKeywordIdentityV2_1({
    listingPackage: pkg, opportunity: read.data,
  })
  if (!identity.exact) {
    throw new Error("CURRENT_KEYWORD_EXACT_IDENTITY_UNPROVEN")
  }
  const plan = buildProductResearchCommercialQueryPlanV1({ candidate: {
    supplierVariantId: identity.variantId,
    productName: identity.productTitle,
    brand: identity.productBrand,
    priorityScore: Number(read.data.opportunity_score ?? 0),
  }, sourceField: "ebay_luna_opportunity_queue.product_title",
  sourceAuthority: "LUNA_PRODUCT_TRUTH" })
  if (!plan.queries.length || plan.queries.length > 3 ||
      plan.candidateCount !== 1 || !plan.entity.productNoun) {
    throw new Error("CURRENT_KEYWORD_QUERY_PLAN_EMPTY")
  }
  const observedAt = (input.now ?? new Date()).toISOString()
  const persisted = await input.supabase.rpc(
    "continue_current_factory_keyword_v2_1", {
      p_account_key: input.accountKey,
      p_listing_package_id: identity.packageId,
      p_opportunity_id: identity.opportunityId,
      p_candidate_key: identity.candidateKey,
      p_requested_plan_id: randomUUID(),
      p_plan_version: plan.queries[0].strategyVersion,
      p_input_hash: sha256({
        contractVersion: CURRENT_FACTORY_KEYWORD_CONTINUATION_V2_1,
        productId: identity.productId,
        variantId: identity.variantId,
        planInputHash: plan.inputHash,
      }),
      p_observed_at: observedAt,
      p_queries: plan.queries.map((query) => ({
        ordinal: query.ordinal,
        search_query: query.searchQuery,
        query_hash: query.queryHash,
        cluster_key_hash: query.clusterKeyHash,
        category_id: query.categoryId,
        candidate_count: query.candidateCount,
        candidate_variant_hashes: query.candidateVariantHashes,
        query_intent: query.intent,
        evidence_basis: query.evidenceBasis,
        strategy_version: query.strategyVersion,
      })),
    })
  if (persisted.error || !persisted.data) {
    throw new Error("CURRENT_KEYWORD_PLAN_CONTINUATION_FAILED")
  }
  const receipt = record(persisted.data)
  const planId = text(receipt.planId, 40)
  if (!planId || receipt.listingPackageId !== identity.packageId ||
      receipt.marketplaceWrites !== 0 || receipt.publicationWrites !== 0 ||
      receipt.adsWrites !== 0) {
    throw new Error("CURRENT_KEYWORD_PLAN_READBACK_INVALID")
  }
  const repaired = await input.supabase.rpc(
    "repair_current_factory_keyword_revalidation_v1", {
      p_account_key: input.accountKey,
      p_listing_package_id: identity.packageId,
      p_plan_id: planId,
    })
  if (repaired.error || repaired.data?.marketplaceWrites !== 0 ||
      repaired.data?.publicationWrites !== 0 ||
      repaired.data?.adsWrites !== 0) {
    throw new Error("CURRENT_KEYWORD_REVALIDATION_REPAIR_FAILED")
  }
  const cumulative = await input.supabase.rpc(
    "reconcile_current_factory_keyword_cumulative_completion_v1", {
      p_account_key: input.accountKey,
      p_listing_package_id: identity.packageId,
      p_plan_id: planId,
    })
  if (cumulative.error || cumulative.data?.marketplaceWrites !== 0 ||
      cumulative.data?.publicationWrites !== 0 ||
      cumulative.data?.adsWrites !== 0) {
    throw new Error("CURRENT_KEYWORD_CUMULATIVE_RECONCILIATION_FAILED")
  }
  const handoffRead = await input.supabase.rpc(
    "read_current_factory_keyword_handoff_v2_1", {
      p_account_key: input.accountKey,
      p_listing_package_id: identity.packageId,
      p_product_id: identity.productId,
      p_variant_id: identity.variantId,
      p_candidate_key: identity.candidateKey,
      p_opportunity_id: identity.opportunityId,
      p_plan_id: planId,
    })
  const handoff = handoffRead.error
    ? { STATUS: "UNAVAILABLE", BLOCKERS: ["CURRENT_KEYWORD_READBACK_UNAVAILABLE"] }
    : decodeKeywordReadV1(handoffRead.data)
  const acceptance = consumeListingPackageKeywordHandoffV1(handoff, {
    ACCOUNT_KEY: input.accountKey,
    PACKAGE_ID: identity.packageId,
    PRODUCT_ID: identity.productId,
    VARIANT_ID: identity.variantId,
    CANDIDATE_KEY: identity.candidateKey,
    OPPORTUNITY_ID: identity.opportunityId,
    PLAN_ID: planId,
  })
  const classifications = record(acceptance.CLASSIFICATIONS)
  const acceptedTerms = ["PRIMARY_KEYWORD", "CORE_QUALIFIERS",
    "SEMANTIC_EXPANSIONS", "SECONDARY_KEYWORDS"].flatMap((key) =>
    Array.isArray(classifications[key]) ? classifications[key] as unknown[] : [])
  const ready = acceptance.STATUS === "ACCEPTED" &&
    Array.isArray(classifications.PRIMARY_KEYWORD) &&
    classifications.PRIMARY_KEYWORD.length === 1 && acceptedTerms.length > 0
  return Object.freeze({
    contractVersion: CURRENT_FACTORY_KEYWORD_CONTINUATION_V2_1,
    status: ready ? "CURRENT_READY" as const : "RESEARCH_PENDING" as const,
    packageId: identity.packageId, planId,
    planCreated: receipt.planCreated === true,
    researchRevalidated: receipt.researchRevalidated === true,
    handoff, acceptance, keywordCurrentReady: ready,
    ownerActionRequired: false as const,
    manualBindingCount: 0 as const,
    legacyKeywordAuthorityCount: 0 as const,
    marketplaceWrites: 0 as const,
    publicationWrites: 0 as const,
    adsWrites: 0 as const,
  })
}

export async function reconcileCurrentFactoryKeywordContinuationsV2_1(
  input: Readonly<{
    supabase: SupabaseClient
    accountKey: string
    packageIds?: readonly string[]
    now?: Date
  }>,
) {
  let query = input.supabase.from("ebay_current_listing_packages_v1")
    .select("id,account_key,opportunity_id,candidate_key,package_data")
    .eq("account_key", input.accountKey)
    .contains("package_data", { currentPublicationFactoryV1: {
      version: "SELLER_OS_CURRENT_PUBLICATION_FACTORY_V1",
      authorityPolicy: "CURRENT_ONLY", reuseLegacyPreparation: false,
    } })
    .order("created_at", { ascending: true }).limit(100)
  const ids = [...new Set((input.packageIds ?? []).filter((value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)))]
  if (ids.length) query = query.in("id", ids)
  const packages = await query
  if (packages.error) {
    throw new Error("CURRENT_KEYWORD_PACKAGE_SCAN_FAILED")
  }
  const outcomes = []
  for (const listingPackage of packages.data ?? []) {
    try {
      const outcome = await continueCurrentFactoryKeywordV2_1({
        supabase: input.supabase, accountKey: input.accountKey,
        listingPackage, now: input.now,
      })
      outcomes.push(outcome)
    } catch (error) {
      const code = error instanceof Error &&
        /^[A-Z][A-Z0-9_]{2,119}$/.test(error.message)
        ? error.message : "CURRENT_KEYWORD_CONTINUATION_FAILED"
      outcomes.push(Object.freeze({
        contractVersion: CURRENT_FACTORY_KEYWORD_CONTINUATION_V2_1,
        status: "RESEARCH_PENDING" as const,
        packageId: text(record(listingPackage).id, 40) || null,
        planId: null, keywordCurrentReady: false, blockers: [code],
        ownerActionRequired: false as const,
        legacyKeywordAuthorityCount: 0 as const,
        marketplaceWrites: 0 as const, publicationWrites: 0 as const,
        adsWrites: 0 as const,
      }))
    }
  }
  const failed = outcomes.filter((outcome) => !outcome.planId).length
  return Object.freeze({
    contractVersion: CURRENT_FACTORY_KEYWORD_CONTINUATION_V2_1,
    status: failed ? "PARTIAL" as const : "PASS" as const,
    scannedPackageCount: packages.data?.length ?? 0,
    continuedPackageCount: outcomes.length - failed,
    currentReadyCount: outcomes.filter((outcome) =>
      outcome.keywordCurrentReady === true).length,
    failedCount: failed, outcomes: Object.freeze(outcomes),
    ownerActionRequired: false as const,
    legacyKeywordAuthorityCount: 0 as const,
    marketplaceWrites: 0 as const, publicationWrites: 0 as const,
    adsWrites: 0 as const,
  })
}
