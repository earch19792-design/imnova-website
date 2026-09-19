import { createHash, randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import { assertSellerOsOwnerAdminPreResearchV1 } from
  "./luna-pre-research-admin-api-v1"
import {
  LUNA_PRE_RESEARCH_INTAKE_V1,
  LUNA_PRE_RESEARCH_MAX_BATCH_SIZE_V1,
  LUNA_PRE_RESEARCH_POLICY_VERSION_V1,
  buildLunaPreResearchIdentityKeyV1,
  buildLunaPreResearchProductTruthFingerprintV1,
  buildLunaPreResearchQueryPayloadV1,
  isLunaPreResearchCandidateV1,
  type LunaPreResearchCandidateRequestV1,
} from "./luna-pre-research-intake-v1"

export const LUNA_PRE_RESEARCH_RESULT_CONTRACT_V2 =
  "LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19" as const
export const LUNA_PRE_RESEARCH_RERUN_COHORT_CONTRACT_V1 =
  "LUNA_PRE_RESEARCH_RERUN_COHORT_V1_2026_09_19" as const
export const LUNA_PRE_RESEARCH_RERUN_POLICY_V1 =
  "LUNA_PRE_RESEARCH_CONTROLLED_RERUN_POLICY_V1_2026_09_19" as const
type JsonRecord = Record<string, unknown>

type PreparedRerunMemberV1 = Readonly<{
  productId: string
  variantId: string
  lunaSku: string
  sourceCandidateKey: string
  productTruthFingerprint: string
  priorPlanId: string
  priorPlanInputHash: string
  rerunPlanId: string
  baseInputHash: string
  executionInputHash: string
  sourceFingerprint: string
  observedAt: string
  queries: readonly JsonRecord[]
}>

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
  return `sha256:${createHash("sha256").update(
    typeof value === "string" ? value : JSON.stringify(value),
  ).digest("hex")}`
}

export function buildLunaPreResearchRerunInputHashV1(input: Readonly<{
  baseInputHash: string
  rerunCohortId: string
  contractVersion: string
}>) {
  // Canonical encoding of { baseInputHash, rerunCohortId, contractVersion }.
  // The fixed field order is mirrored by the database RPC.
  return digest(["LUNA_PRE_RESEARCH_RERUN_INPUT_V1", input.baseInputHash,
    input.rerunCohortId, input.contractVersion].join("\n"))
}

function membershipLine(member: PreparedRerunMemberV1) {
  return [member.productId, member.variantId, member.lunaSku,
    member.sourceCandidateKey, member.productTruthFingerprint,
    member.priorPlanId, member.priorPlanInputHash, member.baseInputHash,
    member.executionInputHash].join("\u001f")
}

export function buildLunaPreResearchRerunMembershipDigestV1(
  members: readonly PreparedRerunMemberV1[],
) {
  return digest(["LUNA_PRE_RESEARCH_RERUN_MEMBERSHIP_V1",
    ...members.map(membershipLine).sort()].join("\n"))
}

function persistedQueries(plan: ReturnType<
  typeof buildLunaPreResearchQueryPayloadV1
>) {
  return plan.queries.map((query) => ({
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
  }))
}

async function readPriorNormalPlan(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  sourceCandidateKey: string
}>) {
  const read = await input.supabase
    .from("marketplace_product_research_query_plans")
    .select("id,input_hash,source_candidate_key,source_product_truth_fingerprint,pre_research_rerun_cohort_id")
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("source_context", "LUNA_PRE_RESEARCH")
    .eq("source_candidate_key", input.sourceCandidateKey)
    .is("pre_research_rerun_cohort_id", null)
    .order("created_at", { ascending: false }).limit(2)
  if (read.error) throw new Error("LUNA_PRE_RESEARCH_RERUN_PRIOR_PLAN_READ_FAILED")
  const rows = (read.data ?? []) as JsonRecord[]
  if (rows.length !== 1 ||
      !/^[0-9a-f-]{36}$/i.test(text(rows[0].id, 80)) ||
      !/^sha256:[0-9a-f]{64}$/.test(text(rows[0].input_hash, 80))) {
    throw new Error("LUNA_PRE_RESEARCH_RERUN_PRIOR_NORMAL_PLAN_REQUIRED")
  }
  return rows[0]
}

export async function requestControlledLunaPreResearchRerunV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  adminValidation: Readonly<{
    ok: boolean
    userId?: string | null
    authenticationMode?: string | null
    accessRole?: string | null
  }>
  rerunCohortId: string
  snapshotId: string
  reasonCode: string
  expectedContractVersion: string
  candidates: readonly LunaPreResearchCandidateRequestV1[]
}>) {
  const actor = assertSellerOsOwnerAdminPreResearchV1(input.adminValidation)
  if (!/^[0-9a-f-]{36}$/i.test(input.rerunCohortId) ||
      !/^[0-9a-f-]{36}$/i.test(input.snapshotId) ||
      !/^[A-Z0-9_]{3,80}$/.test(input.reasonCode) ||
      input.expectedContractVersion !== LUNA_PRE_RESEARCH_RESULT_CONTRACT_V2 ||
      !input.candidates.length ||
      input.candidates.length > LUNA_PRE_RESEARCH_MAX_BATCH_SIZE_V1 ||
      input.candidates.some((candidate) =>
        !isLunaPreResearchCandidateV1(candidate))) {
    throw new Error("LUNA_PRE_RESEARCH_RERUN_REQUEST_BOUNDS_INVALID")
  }
  const unique = new Map(input.candidates.map((candidate) =>
    [`${candidate.productId}:${candidate.variantId}:${candidate.sku}`, candidate]))
  if (unique.size !== input.candidates.length) {
    throw new Error("LUNA_PRE_RESEARCH_RERUN_DUPLICATE_CANDIDATE")
  }

  const members: PreparedRerunMemberV1[] = []
  for (const candidate of input.candidates) {
    const read = await input.supabase.from("luna_catalog_snapshot_variants_v1")
      .select("snapshot_id,product_id,variant_id,sku,title,product_type,source_fingerprint,observed_at,preflight_status,identity_result")
      .eq("snapshot_id", input.snapshotId)
      .eq("product_id", candidate.productId)
      .eq("variant_id", candidate.variantId).limit(2)
    if (read.error) throw new Error("LUNA_PRE_RESEARCH_RERUN_CATALOG_READ_FAILED")
    const rows = (read.data ?? []) as JsonRecord[]
    if (rows.length !== 1 || text(rows[0].sku, 160) !== candidate.sku ||
        text(rows[0].preflight_status, 80) !== "PREFLIGHT_PASS") {
      throw new Error("LUNA_PRE_RESEARCH_RERUN_PREFLIGHT_PASS_REQUIRED")
    }
    const row = rows[0]
    const productTruthFingerprint = buildLunaPreResearchProductTruthFingerprintV1({
      product_id: text(row.product_id, 80),
      variant_id: text(row.variant_id, 120),
      sku: text(row.sku, 160),
      title: text(row.title, 500),
      product_type: text(row.product_type, 220) || null,
      identity_result: row.identity_result,
    })
    const sourceCandidateKey = buildLunaPreResearchIdentityKeyV1({
      productId: candidate.productId,
      variantId: candidate.variantId,
      sku: candidate.sku,
      productTruthFingerprint,
    })
    const prior = await readPriorNormalPlan({ supabase: input.supabase,
      accountKey: input.accountKey, sourceCandidateKey })
    if (prior.source_candidate_key !== sourceCandidateKey ||
        prior.source_product_truth_fingerprint !== productTruthFingerprint) {
      throw new Error("LUNA_PRE_RESEARCH_RERUN_PRIOR_TRUTH_MISMATCH")
    }
    const plan = buildLunaPreResearchQueryPayloadV1(row)
    const executionInputHash = buildLunaPreResearchRerunInputHashV1({
      baseInputHash: plan.inputHash,
      rerunCohortId: input.rerunCohortId,
      contractVersion: input.expectedContractVersion,
    })
    members.push(Object.freeze({
      productId: candidate.productId,
      variantId: candidate.variantId,
      lunaSku: candidate.sku,
      sourceCandidateKey,
      productTruthFingerprint,
      priorPlanId: text(prior.id, 80),
      priorPlanInputHash: text(prior.input_hash, 80),
      rerunPlanId: randomUUID(),
      baseInputHash: plan.inputHash,
      executionInputHash,
      sourceFingerprint: text(row.source_fingerprint, 140),
      observedAt: text(row.observed_at, 80),
      queries: persistedQueries(plan),
    }))
  }

  const membershipDigest = buildLunaPreResearchRerunMembershipDigestV1(members)
  const persisted = await input.supabase.rpc(
    "create_or_reuse_luna_pre_research_rerun_cohort_v1", {
      p_cohort_id: input.rerunCohortId,
      p_marketplace_account_key: input.accountKey,
      p_marketplace: "EBAY_US",
      p_contract_version: input.expectedContractVersion,
      p_reason_code: input.reasonCode,
      p_actor_subject: actor.actorSubject,
      p_actor_client_id: actor.actorClientId,
      p_snapshot_id: input.snapshotId,
      p_policy_version: LUNA_PRE_RESEARCH_RERUN_POLICY_V1,
      p_maximum_members: members.length,
      p_membership_digest: membershipDigest,
      p_members: members.map((member) => ({
        product_id: member.productId,
        variant_id: member.variantId,
        luna_sku: member.lunaSku,
        source_candidate_key: member.sourceCandidateKey,
        product_truth_fingerprint: member.productTruthFingerprint,
        prior_plan_id: member.priorPlanId,
        prior_plan_input_hash: member.priorPlanInputHash,
        rerun_plan_id: member.rerunPlanId,
        base_input_hash: member.baseInputHash,
        execution_input_hash: member.executionInputHash,
        source_fingerprint: member.sourceFingerprint,
        observed_at: member.observedAt,
        queries: member.queries,
      })),
    },
  )
  if (persisted.error) {
    throw new Error("LUNA_PRE_RESEARCH_RERUN_COHORT_PERSIST_FAILED")
  }
  const result = record(Array.isArray(persisted.data)
    ? persisted.data[0] : persisted.data)
  return Object.freeze({
    contractVersion: LUNA_PRE_RESEARCH_RERUN_COHORT_CONTRACT_V1,
    expectedResultContractVersion: input.expectedContractVersion,
    rerunCohortId: input.rerunCohortId,
    snapshotId: input.snapshotId,
    reasonCode: input.reasonCode,
    membershipDigest,
    maximumMembers: members.length,
    cohortCreated: result.cohortCreated === true,
    newPlanCount: Number(result.newPlanCount ?? 0),
    existingPlanCount: Number(result.existingPlanCount ?? 0),
    plans: Array.isArray(result.plans) ? result.plans : [],
    actor: { subject: actor.actorSubject, clientId: actor.actorClientId },
    safety: { marketplaceWrites: 0, publicationWrites: 0, purchases: 0,
      shippingCaptures: 0, commercialTraces: 0, autonomousClaims: 0 },
  })
}
