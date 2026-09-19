import { createHash, randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  LUNA_CATALOG_PREFLIGHT_CONTRACT_VERSION_V1,
  LUNA_CATALOG_SNAPSHOT_IDENTITY_ENGINE_V1,
} from "./luna-catalog-snapshot-v1"
import { buildProductResearchCommercialQueryPlanV1 } from
  "./ebay-product-research-query-plan"

export const LUNA_PRE_RESEARCH_INTAKE_V1 =
  "LUNA_PRE_RESEARCH_INTAKE_V1_2026_09_15" as const
export const LUNA_PRE_RESEARCH_POLICY_VERSION_V1 =
  "LUNA_PRE_RESEARCH_POLICY_V1_2026_09_15" as const
export const LUNA_PRE_RESEARCH_SOURCE_CONTEXT_V1 =
  "LUNA_PRE_RESEARCH" as const
export const LUNA_PRE_RESEARCH_MAX_BATCH_SIZE_V1 = 10 as const

export type LunaPreResearchResultV1 =
  | "PRE_RESEARCH_HIGH"
  | "PRE_RESEARCH_MEDIUM"
  | "PRE_RESEARCH_LOW"
  | "INSUFFICIENT_MARKET_EVIDENCE"

export type LunaPreResearchCandidateRequestV1 = Readonly<{
  productId: string
  variantId: string
  sku: string
}>

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 240) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum)
    : ""
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value))
    .digest("hex")}`
}

export function buildLunaPreResearchProductTruthFingerprintV1(row: Readonly<{
  product_id: string
  variant_id: string
  sku: string
  title: string
  product_type?: string | null
  identity_result: unknown
}>) {
  return digest({
    contractVersion: LUNA_CATALOG_PREFLIGHT_CONTRACT_VERSION_V1,
    identityEngineVersion: LUNA_CATALOG_SNAPSHOT_IDENTITY_ENGINE_V1,
    productId: row.product_id,
    variantId: row.variant_id,
    sku: row.sku,
    title: row.title,
    productType: row.product_type ?? null,
    identity: row.identity_result,
  })
}

export function buildLunaPreResearchIdentityKeyV1(input: Readonly<{
  productId: string
  variantId: string
  sku: string
  productTruthFingerprint: string
}>) {
  return digest({
    intakeVersion: LUNA_PRE_RESEARCH_INTAKE_V1,
    productId: input.productId,
    variantId: input.variantId,
    sku: input.sku,
    productTruthFingerprint: input.productTruthFingerprint,
    policyVersion: LUNA_PRE_RESEARCH_POLICY_VERSION_V1,
  })
}

export function isLunaPreResearchCandidateV1(
  candidate: LunaPreResearchCandidateRequestV1,
) {
  return /^\d{1,30}$/.test(candidate.productId) &&
    /^\d{1,30}$/.test(candidate.variantId) &&
    /^[^\u0000\r\n]{1,160}$/.test(candidate.sku)
}

function rpcResult(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value
  return record(row)
}

export function classifyLunaPreResearchDispositionV1(input: Readonly<{
  preflightStatus: string
}>) {
  if (input.preflightStatus === "PREFLIGHT_PASS") {
    return Object.freeze({ disposition: "PRE_RESEARCH_ELIGIBLE" as const,
      researchAllowed: true as const })
  }
  if (input.preflightStatus === "SEMANTIC_IDENTITY_INCOMPLETE") {
    return Object.freeze({ disposition: "IDENTITY_RESCUE_PRIORITY" as const,
      researchAllowed: false as const })
  }
  if (input.preflightStatus === "SOURCE_IDENTITY_BLOCKED") {
    return Object.freeze({ disposition: "SOURCE_IDENTITY_BLOCKED" as const,
      researchAllowed: false as const })
  }
  if (input.preflightStatus === "CONTRADICTED") {
    return Object.freeze({ disposition: "QUARANTINE" as const,
      researchAllowed: false as const })
  }
  return Object.freeze({ disposition: "PREFLIGHT_STATUS_UNPROVEN" as const,
    researchAllowed: false as const })
}

export function buildLunaPreResearchQueryPayloadV1(row: JsonRecord) {
  const plan = buildProductResearchCommercialQueryPlanV1({
    candidate: {
      supplierVariantId: text(row.variant_id, 160),
      productName: text(row.title, 240),
      categoryId: null,
    },
    sourceField: "identity_result.queryPlan",
    sourceAuthority: LUNA_CATALOG_SNAPSHOT_IDENTITY_ENGINE_V1,
    structuredIdentity: record(row.identity_result),
  })
  if (!plan.queries.length) throw new Error("LUNA_PRE_RESEARCH_QUERY_EMPTY")
  return plan
}

export async function requestLunaPreResearchV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  snapshotId: string
  candidates: readonly LunaPreResearchCandidateRequestV1[]
}>) {
  if (!/^[0-9a-f-]{36}$/i.test(input.snapshotId) ||
      !input.candidates.length ||
      input.candidates.length > LUNA_PRE_RESEARCH_MAX_BATCH_SIZE_V1 ||
      input.candidates.some((candidate) => !isLunaPreResearchCandidateV1(candidate))) {
    throw new Error("LUNA_PRE_RESEARCH_REQUEST_BOUNDS_INVALID")
  }
  const unique = new Map(input.candidates.map((candidate) =>
    [`${candidate.productId}:${candidate.variantId}:${candidate.sku}`, candidate]))
  if (unique.size !== input.candidates.length) {
    throw new Error("LUNA_PRE_RESEARCH_DUPLICATE_CANDIDATE")
  }
  const results: JsonRecord[] = []
  for (const candidate of input.candidates) {
    const read = await input.supabase.from("luna_catalog_snapshot_variants_v1")
      .select("snapshot_id,product_id,variant_id,sku,title,product_type,source_fingerprint,observed_at,preflight_status,identity_result")
      .eq("snapshot_id", input.snapshotId).eq("product_id", candidate.productId)
      .eq("variant_id", candidate.variantId).limit(2)
    if (read.error) throw new Error("LUNA_PRE_RESEARCH_CATALOG_READ_FAILED")
    const rows = (read.data ?? []) as JsonRecord[]
    if (rows.length !== 1 || text(rows[0].sku, 160) !== candidate.sku) {
      results.push({ productId: candidate.productId, variantId: candidate.variantId,
        sku: candidate.sku, status: "SOURCE_IDENTITY_BLOCKED",
        reason: "CATALOG_VARIANT_BINDING_MISMATCH" })
      continue
    }
    const row = rows[0]
    const disposition = classifyLunaPreResearchDispositionV1({
      preflightStatus: text(row.preflight_status, 80),
    })
    if (!disposition.researchAllowed) {
      results.push({ productId: candidate.productId, variantId: candidate.variantId,
        sku: candidate.sku, status: disposition.disposition,
        preflightStatus: row.preflight_status, researchCreated: false })
      continue
    }
    const productTruthFingerprint = buildLunaPreResearchProductTruthFingerprintV1({
      product_id: text(row.product_id, 80), variant_id: text(row.variant_id, 120),
      sku: text(row.sku, 160), title: text(row.title, 500),
      product_type: text(row.product_type, 220) || null,
      identity_result: row.identity_result,
    })
    const identityKey = buildLunaPreResearchIdentityKeyV1({
      productId: candidate.productId, variantId: candidate.variantId,
      sku: candidate.sku, productTruthFingerprint,
    })
    const plan = buildLunaPreResearchQueryPayloadV1(row)
    const persisted = await input.supabase.rpc(
      "create_or_reuse_luna_pre_research_plan_v1", {
        p_plan_id: randomUUID(),
        p_marketplace_account_key: input.accountKey,
        p_plan_version: LUNA_PRE_RESEARCH_INTAKE_V1,
        p_input_hash: plan.inputHash,
        p_identity_key: identityKey,
        p_luna_snapshot_id: input.snapshotId,
        p_luna_product_id: candidate.productId,
        p_luna_variant_id: candidate.variantId,
        p_supplier_sku: candidate.sku,
        p_product_truth_fingerprint: productTruthFingerprint,
        p_pre_research_policy_version: LUNA_PRE_RESEARCH_POLICY_VERSION_V1,
        p_source_fingerprint: text(row.source_fingerprint, 140),
        p_observed_at: row.observed_at,
        p_queries: plan.queries.map((query) => ({
          ordinal: query.ordinal, search_query: query.searchQuery,
          query_hash: query.queryHash, cluster_key_hash: query.clusterKeyHash,
          category_id: query.categoryId, candidate_count: query.candidateCount,
          candidate_variant_hashes: query.candidateVariantHashes,
          query_intent: query.intent, evidence_basis: query.evidenceBasis,
          strategy_version: query.strategyVersion,
        })),
      })
    if (persisted.error) throw new Error("LUNA_PRE_RESEARCH_PLAN_PERSIST_FAILED")
    const result = rpcResult(persisted.data)
    results.push({ productId: candidate.productId, variantId: candidate.variantId,
      sku: candidate.sku, status: "PRE_RESEARCH_QUEUED",
      preflightStatus: "PREFLIGHT_PASS", researchCreated: result.created === true,
      planId: result.planId ?? null, pendingTaskCount: result.pendingTaskCount ?? null,
      idempotencyKey: identityKey, sourceSnapshotId: input.snapshotId,
      policyVersion: LUNA_PRE_RESEARCH_POLICY_VERSION_V1 })
  }
  return Object.freeze({ contractVersion: LUNA_PRE_RESEARCH_INTAKE_V1,
    snapshotId: input.snapshotId, results: Object.freeze(results),
    safety: { marketplaceWrites: 0, publicationWrites: 0, purchases: 0,
      shippingCaptures: 0, commercialTraces: 0 } })
}
