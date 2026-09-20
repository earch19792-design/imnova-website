import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildLunaPreResearchIdentityKeyV1,
  buildLunaPreResearchProductTruthFingerprintV1,
  requestLunaPreResearchV1,
  type LunaPreResearchCandidateRequestV1,
} from "./luna-pre-research-intake-v1"

export const TEO_PRE_RESEARCH_CAPABILITY_V1 =
  "TEO_PRE_RESEARCH_NORMAL_BATCH_V1" as const
export const TEO_PRE_RESEARCH_CONTRACT_V1 =
  "LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19" as const
export const TEO_PRE_RESEARCH_MAXIMUM_CANDIDATES_V1 = 50 as const

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

function uuid(value: unknown) {
  const candidate = text(value, 80)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(candidate) ? candidate : null
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

function rpcRow(value: unknown) {
  return record(Array.isArray(value) ? value[0] : value)
}

function explicitUnavailable(value: unknown) {
  if (value === false) return true
  const normalized = text(value, 80).toUpperCase()
  return ["FALSE", "OUT_OF_STOCK", "UNAVAILABLE", "ENDED"].includes(normalized)
}

export type TeoPreResearchCommandPrincipalV1 = Readonly<{
  ownerUserId: string
  commandClientId: string
}>

export type TeoPreResearchBatchCandidateV1 = LunaPreResearchCandidateRequestV1

export class TeoPreResearchControlErrorV1 extends Error {
  readonly code: string

  constructor(code: string) {
    super(/^[A-Z0-9_]{3,180}$/.test(code)
      ? code : "TEO_PRE_RESEARCH_CONTROL_FAILED_CLOSED")
    this.name = "TeoPreResearchControlErrorV1"
    this.code = this.message
  }
}

function fail(code: string): never {
  throw new TeoPreResearchControlErrorV1(code)
}

export function parseTeoPreResearchCandidatesV1(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 ||
      value.length > TEO_PRE_RESEARCH_MAXIMUM_CANDIDATES_V1) {
    fail("TEO_PRE_RESEARCH_CANDIDATE_BOUNDS_INVALID")
  }
  const candidates = value.map((entry) => {
    const item = record(entry)
    if (Object.keys(item).sort().join(",") !== "productId,sku,variantId" ||
        !/^\d{1,30}$/.test(text(item.productId, 40)) ||
        !/^\d{1,30}$/.test(text(item.variantId, 40)) ||
        !/^[^\u0000\r\n]{1,160}$/.test(text(item.sku, 160))) {
      fail("TEO_PRE_RESEARCH_CANDIDATE_IDENTITY_INVALID")
    }
    return Object.freeze({ productId: text(item.productId, 40),
      variantId: text(item.variantId, 40), sku: text(item.sku, 160) })
  })
  if (new Set(candidates.map((entry) =>
    `${entry.productId}\u001f${entry.variantId}\u001f${entry.sku}`)).size !==
      candidates.length) fail("TEO_PRE_RESEARCH_DUPLICATE_CANDIDATE")
  return Object.freeze(candidates)
}

export function parseTeoPreResearchRequestV1(value: unknown) {
  const body = record(value)
  const expected = ["candidates", "clientIdempotencyKey", "snapshotId"]
  if (Object.keys(body).sort().join(",") !== expected.sort().join(",") ||
      !uuid(body.snapshotId) ||
      !/^[A-Za-z0-9._:-]{8,160}$/.test(text(body.clientIdempotencyKey, 180))) {
    fail("TEO_PRE_RESEARCH_BATCH_REQUEST_INVALID")
  }
  return Object.freeze({ snapshotId: uuid(body.snapshotId)!,
    clientIdempotencyKey: text(body.clientIdempotencyKey, 180),
    candidates: parseTeoPreResearchCandidatesV1(body.candidates) })
}

export function parseTeoPreResearchGetV1(value: unknown) {
  const body = record(value)
  if (Object.keys(body).join(",") !== "batchId" || !uuid(body.batchId)) {
    fail("TEO_PRE_RESEARCH_BATCH_ID_INVALID")
  }
  return Object.freeze({ batchId: uuid(body.batchId)! })
}

async function requireCapability(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  principal: TeoPreResearchCommandPrincipalV1
}>) {
  const read = await input.supabase.from(
    "seller_os_pre_research_command_capabilities_v1")
    .select("capability_id,allowed_contract_version,maximum_candidates,enabled,expires_at")
    .eq("capability_code", TEO_PRE_RESEARCH_CAPABILITY_V1)
    .eq("marketplace_account_key", input.accountKey)
    .eq("owner_user_id", input.principal.ownerUserId)
    .eq("command_client_id", input.principal.commandClientId)
    .eq("enabled", true).limit(1).maybeSingle()
  if (read.error || !read.data ||
      read.data.allowed_contract_version !== TEO_PRE_RESEARCH_CONTRACT_V1 ||
      (read.data.expires_at && Date.parse(read.data.expires_at) <= Date.now())) {
    fail("TEO_PRE_RESEARCH_CAPABILITY_DENIED")
  }
  return read.data
}

async function prepareCandidates(input: Readonly<{
  supabase: SupabaseClient
  snapshotId: string
  candidates: readonly TeoPreResearchBatchCandidateV1[]
}>) {
  const snapshot = await input.supabase.from("luna_catalog_snapshots_v1")
    .select("snapshot_id,snapshot_status").eq("snapshot_id", input.snapshotId)
    .eq("snapshot_status", "COMPLETE").limit(1).maybeSingle()
  if (snapshot.error || !snapshot.data) fail("TEO_PRE_RESEARCH_SNAPSHOT_NOT_COMPLETE")
  const prepared: Array<JsonRecord> = []
  for (const candidate of input.candidates) {
    const read = await input.supabase.from("luna_catalog_snapshot_variants_v1")
      .select("snapshot_id,product_id,variant_id,sku,title,product_type,availability,source_fingerprint,observed_at,preflight_status,identity_result")
      .eq("snapshot_id", input.snapshotId).eq("product_id", candidate.productId)
      .eq("variant_id", candidate.variantId).limit(2)
    const rows = (read.data ?? []) as JsonRecord[]
    if (read.error || rows.length !== 1 || text(rows[0].sku, 160) !== candidate.sku ||
        rows[0].preflight_status !== "PREFLIGHT_PASS" ||
        explicitUnavailable(rows[0].availability)) {
      fail("TEO_PRE_RESEARCH_CANDIDATE_PREFLIGHT_FAILED")
    }
    const productTruthFingerprint = buildLunaPreResearchProductTruthFingerprintV1({
      product_id: candidate.productId, variant_id: candidate.variantId,
      sku: candidate.sku, title: text(rows[0].title, 500),
      product_type: text(rows[0].product_type, 220) || null,
      identity_result: rows[0].identity_result,
    })
    const sourceCandidateKey = buildLunaPreResearchIdentityKeyV1({
      productId: candidate.productId, variantId: candidate.variantId,
      sku: candidate.sku, productTruthFingerprint,
    })
    prepared.push({ productId: candidate.productId,
      productTruthFingerprint, sku: candidate.sku, sourceCandidateKey,
      variantId: candidate.variantId })
  }
  const canonical = [...prepared].sort((left, right) =>
    String(left.sourceCandidateKey).localeCompare(String(right.sourceCandidateKey)))
  return Object.freeze({ prepared: Object.freeze(prepared),
    candidateIdentityDigest: digest(canonical) })
}

export async function requestTeoPreResearchBatchV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  principal: TeoPreResearchCommandPrincipalV1
  snapshotId: string
  clientIdempotencyKey: string
  candidates: readonly TeoPreResearchBatchCandidateV1[]
}>) {
  const capability = await requireCapability(input)
  if (input.candidates.length > capability.maximum_candidates) {
    fail("TEO_PRE_RESEARCH_CANDIDATE_LIMIT_EXCEEDED")
  }
  const prepared = await prepareCandidates(input)
  const requested = await input.supabase.rpc(
    "request_seller_os_pre_research_batch_v1", {
      p_marketplace_account_key: input.accountKey,
      p_owner_user_id: input.principal.ownerUserId,
      p_command_client_id: input.principal.commandClientId,
      p_snapshot_id: input.snapshotId,
      p_contract_version: TEO_PRE_RESEARCH_CONTRACT_V1,
      p_candidate_identity_digest: prepared.candidateIdentityDigest,
      p_client_idempotency_key: input.clientIdempotencyKey,
      p_candidates: prepared.prepared,
    })
  if (requested.error) fail("TEO_PRE_RESEARCH_BATCH_PERSIST_FAILED")
  const batch = rpcRow(requested.data)
  const batchId = uuid(batch.batchId)
  if (!batchId) fail("TEO_PRE_RESEARCH_BATCH_READBACK_FAILED")

  const planBindings: JsonRecord[] = []
  for (let offset = 0; offset < input.candidates.length; offset += 10) {
    const chunk = input.candidates.slice(offset, offset + 10)
    const plans = await requestLunaPreResearchV1({ supabase: input.supabase,
      accountKey: input.accountKey, snapshotId: input.snapshotId,
      candidates: chunk })
    for (const resultValue of plans.results) {
      const result = record(resultValue)
      const planId = uuid(result.planId)
      if (result.status !== "PRE_RESEARCH_QUEUED" || !planId) {
        fail("TEO_PRE_RESEARCH_NORMAL_PLAN_CREATION_FAILED")
      }
      planBindings.push({ productId: result.productId, variantId: result.variantId,
        sku: result.sku, planId })
    }
  }
  const attached = await input.supabase.rpc(
    "attach_seller_os_pre_research_batch_plans_v1", {
      p_batch_id: batchId, p_owner_user_id: input.principal.ownerUserId,
      p_command_client_id: input.principal.commandClientId,
      p_plans: planBindings,
    })
  if (attached.error) fail("TEO_PRE_RESEARCH_BATCH_PLAN_ATTACH_FAILED")
  return readTeoPreResearchBatchV1({ supabase: input.supabase,
    accountKey: input.accountKey, principal: input.principal, batchId })
}

function numeric(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

export async function readTeoPreResearchBatchV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  principal: TeoPreResearchCommandPrincipalV1
  batchId: string
}>) {
  await requireCapability(input)
  const batchRead = await input.supabase.from("seller_os_pre_research_batches_v1")
    .select("batch_id,source_snapshot_id,candidate_identity_digest,candidate_count,contract_version,batch_state,created_at,started_at,completed_at,updated_at")
    .eq("batch_id", input.batchId).eq("marketplace_account_key", input.accountKey)
    .eq("owner_user_id", input.principal.ownerUserId)
    .eq("command_client_id", input.principal.commandClientId)
    .limit(1).maybeSingle()
  if (batchRead.error || !batchRead.data) fail("TEO_PRE_RESEARCH_BATCH_NOT_FOUND")
  const membersRead = await input.supabase.from(
    "seller_os_pre_research_batch_members_v1")
    .select("member_id,ordinal,luna_product_id,luna_variant_id,luna_sku,source_candidate_key,product_truth_fingerprint,plan_id,execution_state,bounded_failure_reason,retry_safety,started_at,completed_at,updated_at")
    .eq("batch_id", input.batchId).order("ordinal")
  if (membersRead.error) fail("TEO_PRE_RESEARCH_BATCH_READ_FAILED")
  const members: JsonRecord[] = []
  for (const member of membersRead.data ?? []) {
    const planId = uuid(member.plan_id)
    let plan: JsonRecord = {}
    let evidenceRows: JsonRecord[] = []
    if (planId) {
      const planRead = await input.supabase.from(
        "marketplace_product_research_query_plans")
        .select("id,status,pre_research_result,pre_research_trace_eligible,pre_research_evidence,pre_research_evidence_digest,pre_research_completed_at,worker_claim_count,worker_lease_owner,worker_lease_expires_at,worker_last_result")
        .eq("id", planId).eq("marketplace_account_key", input.accountKey)
        .eq("source_context", "LUNA_PRE_RESEARCH").limit(1).maybeSingle()
      if (planRead.error || !planRead.data) fail("TEO_PRE_RESEARCH_PLAN_READ_FAILED")
      plan = planRead.data as JsonRecord
      const taskRead = await input.supabase.from("marketplace_product_research_query_tasks")
        .select("capture_batch_id").eq("plan_id", planId).not("capture_batch_id", "is", null)
      if (taskRead.error) fail("TEO_PRE_RESEARCH_TASK_READ_FAILED")
      const batchIds = [...new Set((taskRead.data ?? [])
        .map((task) => uuid(task.capture_batch_id)).filter(Boolean))] as string[]
      if (batchIds.length) {
        const evidenceRead = await input.supabase.from(
          "marketplace_product_research_capture_observations")
          .select("source_listing_id,bounded_title_evidence,average_sold_price,confirmed_sold_quantity,commercial_comparable_classification,commercial_classification_reasons")
          .in("capture_batch_id", batchIds).in("commercial_comparable_classification",
            ["EXACT_PRODUCT_COMPARABLE", "CLOSE_VARIANT_COMPARABLE",
              "CORE_FAMILY_COMPARABLE"]).limit(100)
        if (evidenceRead.error) fail("TEO_PRE_RESEARCH_EVIDENCE_READ_FAILED")
        evidenceRows = (evidenceRead.data ?? []).slice(0, 10).map((row) => ({
          itemId: row.source_listing_id, title: row.bounded_title_evidence,
          price: numeric(row.average_sold_price),
          soldQuantity: numeric(row.confirmed_sold_quantity),
          classification: row.commercial_comparable_classification,
          acceptanceReason: row.commercial_classification_reasons,
        }))
      }
    }
    const evidence = record(plan.pre_research_evidence)
    members.push({ ordinal: member.ordinal, productId: member.luna_product_id,
      variantId: member.luna_variant_id, sku: member.luna_sku,
      planId, executionState: member.execution_state,
      blocker: member.bounded_failure_reason,
      retrySafety: member.retry_safety,
      planStatus: plan.status ?? null,
      disposition: plan.pre_research_result ?? "PENDING",
      traceEligible: plan.pre_research_trace_eligible === true,
      exactComparableCount: numeric(evidence.exactComparableCount),
      closeVariantComparableCount: numeric(evidence.closeVariantComparableCount),
      familyComparableCount: numeric(evidence.familyComparableCount),
      acceptedComparableCount: numeric(evidence.acceptedComparableCount),
      acceptedComparableSoldQuantity:
        numeric(evidence.acceptedComparableSoldQuantity),
      acceptedPriceDistribution: evidence.acceptedPriceDistribution ??
        evidence.priceCluster ?? null,
      durableProvenanceStatus: plan.status === "COMPLETED"
        ? "PASS" : "PENDING",
      acceptedEvidence: evidenceRows })
  }
  return Object.freeze({ contractVersion: "TEO_PRE_RESEARCH_CONTROL_PLANE_V1",
    batch: { batchId: batchRead.data.batch_id,
      state: batchRead.data.batch_state,
      sourceSnapshotId: batchRead.data.source_snapshot_id,
      candidateIdentityDigest: batchRead.data.candidate_identity_digest,
      candidateCount: batchRead.data.candidate_count,
      preResearchContractVersion: batchRead.data.contract_version,
      createdAt: batchRead.data.created_at, startedAt: batchRead.data.started_at,
      completedAt: batchRead.data.completed_at }, members,
    safety: { rawSoldAuthority: false, globalQueueFallback: 0,
      commercialTraces: 0, publisherWrites: 0, marketplaceWrites: 0,
      stockGuardMutations: 0 } })
}

export async function resumeTeoPreResearchBatchV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  principal: TeoPreResearchCommandPrincipalV1
  batchId: string
}>) {
  await requireCapability(input)
  const resumed = await input.supabase.rpc(
    "resume_seller_os_pre_research_batch_v1", {
      p_batch_id: input.batchId,
      p_owner_user_id: input.principal.ownerUserId,
      p_command_client_id: input.principal.commandClientId,
    })
  if (resumed.error) fail("TEO_PRE_RESEARCH_BATCH_RESUME_REJECTED")
  return readTeoPreResearchBatchV1(input)
}

export async function nextAuthorizedTeoPreResearchPlanV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
}>) {
  const next = await input.supabase.rpc(
    "next_seller_os_pre_research_batch_plan_v1", {
      p_marketplace_account_key: input.accountKey,
    })
  if (next.error) fail("TEO_PRE_RESEARCH_BATCH_RUNNER_UNAVAILABLE")
  const row = rpcRow(next.data)
  return Object.freeze({ batchId: uuid(row.batchId), memberId: uuid(row.memberId),
    planId: uuid(row.planId), globalQueueFallback: 0 as const })
}
