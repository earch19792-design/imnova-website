import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { getSupabaseAdminClient } from "../supabase-admin"
import {
  diagnoseRegistryCoverageRuntime,
  previewEbayRegistryRepairRuntime,
} from "./ebay-commercial-monitor-live-readonly"
import type {
  EbayRegistryRepairCreateRpcCandidateV1,
  EbayRegistryRepairDryRun,
  EbayRegistryRepairExecutionPlanV1,
  EbayRegistryRepairPlanningResult,
  EbayRegistryRepairStaleRpcCandidateV1,
} from "./ebay-registry-repair-dry-run"

export type EbayRegistryRepairExecutorFailureCode =
  | "APPROVAL_BINDING_INVALID"
  | "CURRENT_PLAN_UNAVAILABLE"
  | "CURRENT_STATE_NOT_APPROVABLE"
  | "PRIVATE_PLAN_BINDING_MISMATCH"
  | "ACTION_COUNT_MISMATCH"
  | "REPAIR_OPERATION_NOT_SUPPORTED"
  | "HUMAN_REVIEW_EXCLUSION_FAILED"
  | "CREATE_PAYLOAD_UNSAFE"
  | "STALE_CAS_PAYLOAD_INVALID"
  | "RPC_FAILED"
  | "RPC_RESULT_INVALID"

export class EbayRegistryRepairExecutorError extends Error {
  readonly code: EbayRegistryRepairExecutorFailureCode

  constructor(code: EbayRegistryRepairExecutorFailureCode) {
    super(code)
    this.name = "EbayRegistryRepairExecutorError"
    this.code = code
  }
}

export type ApprovedEbayRegistryRepairV1 = {
  approvedPackageHandle: string
  approvedEvidenceFingerprint: string
  approvedCreateCount: number
  approvedStaleCount: number
  approvedHumanReviewCount: number
}

export type EbayRegistryRepairRpcArgumentsV1 = {
  p_account_key: string
  p_package_handle: string
  p_evidence_fingerprint: string
  p_expected_create_count: number
  p_expected_stale_count: number
  p_expected_human_review_count: number
  p_create_candidates: EbayRegistryRepairCreateRpcCandidateV1[]
  p_stale_candidates: EbayRegistryRepairStaleRpcCandidateV1[]
}

export type EbayRegistryRepairRpcResultV1 = {
  result_status: "APPLIED"
  create_inserted: number
  stale_updated: number
  repair_updated: 0
  human_review_mutated: 0
}

export type EbayRegistryRepairExecutionResultV1 = {
  EXECUTION_STATUS: "APPLIED"
  RPC_INVOCATION_COUNT: 1
  CREATE_COMMITTED: number
  STALE_COMMITTED: number
  REPAIR_COMMITTED: 0
  HUMAN_REVIEW_MUTATED: 0
  POST_WRITE_VERIFICATION_STATUS: "COMPLETED" | "UNPROVEN"
}

export type EbayRegistryRepairExecutorDependencies = {
  readCurrentPlanningResult: () => Promise<EbayRegistryRepairPlanningResult>
  invokeRpc: (
    arguments_: EbayRegistryRepairRpcArgumentsV1,
  ) => Promise<EbayRegistryRepairRpcResultV1>
  postWriteVerify: () => Promise<unknown>
  now?: () => Date
}

const ACCOUNT_KEY = /^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$/
const PACKAGE_HANDLE = /^rr_package_[0-9a-f]{24}$/
const EVIDENCE_FINGERPRINT = /^rr_evidence_[0-9a-f]{24}$/
const MEMBERSHIP_HANDLE = /^rr_(?:create|stale|repair|review)_[0-9a-f]{24}$/
const ITEM_ID = /^\d{9,20}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/
const CONTROL = /[\u0000-\u001f\u007f]/
const SECRET_OR_PII = /private key|\bsk-(?:proj-)?[\w-]{20,}|sb_secret_|bearer\s+[\w./+~-]{20,}|[\w.%+-]+@[\w.-]+\.[a-z]{2,}|buyer|shipping|address|payment|cookie|authorization|refresh.?token|access.?token|phone/i
const RAW_PAYLOAD_KEYS = new Set([
  "source",
  "marketplaceId",
  "listingState",
  "variationKey",
  "observedAt",
])

function fail(code: EbayRegistryRepairExecutorFailureCode): never {
  throw new EbayRegistryRepairExecutorError(code)
}

function integerCount(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 5000
}

function validTimestamp(value: string) {
  return TIMESTAMP.test(value) && Number.isFinite(Date.parse(value))
}

function createPayloadSafe(
  candidate: EbayRegistryRepairCreateRpcCandidateV1,
  accountKey: string,
  now: Date,
) {
  const raw = candidate.raw_payload
  const observedAt = Date.parse(candidate.last_ebay_sync_at)
  const nowMs = now.getTime()
  return candidate.source === "EBAY_TRADING_GET_MY_EBAY_SELLING" &&
    candidate.account_key === accountKey && ITEM_ID.test(candidate.ebay_item_id) &&
    candidate.sync_key ===
      `${candidate.source}:${accountKey}:${candidate.ebay_item_id}` &&
    candidate.sync_key.length <= 500 &&
    candidate.title.trim().length > 0 && candidate.title.length <= 1000 &&
    !CONTROL.test(candidate.title) &&
    (candidate.ebay_sku === null || (
      candidate.ebay_sku.length > 0 && candidate.ebay_sku.length <= 80 &&
      !CONTROL.test(candidate.ebay_sku)
    )) &&
    (candidate.ebay_quantity === null || (
      Number.isSafeInteger(candidate.ebay_quantity) &&
      candidate.ebay_quantity >= 0
    )) &&
    (candidate.ebay_price === null || (
      Number.isFinite(candidate.ebay_price) && candidate.ebay_price >= 0 &&
      /^\d+(?:\.\d{1,2})?$/.test(String(candidate.ebay_price))
    )) &&
    /^[A-Z]{3}$/.test(candidate.currency) &&
    validTimestamp(candidate.last_ebay_sync_at) &&
    observedAt <= nowMs + 5 * 60_000 && observedAt >= nowMs - 30 * 60_000 &&
    raw !== null && typeof raw === "object" && !Array.isArray(raw) &&
    Object.keys(raw).every((key) => RAW_PAYLOAD_KEYS.has(key)) &&
    Object.values(raw).every((value) =>
      value === null || ["string", "number", "boolean"].includes(typeof value)) &&
    raw.source === candidate.source && raw.marketplaceId === "EBAY_US" &&
    raw.listingState === "ACTIVE" && raw.observedAt ===
      candidate.last_ebay_sync_at &&
    !SECRET_OR_PII.test(JSON.stringify(raw))
}

function stalePayloadSafe(
  candidate: EbayRegistryRepairStaleRpcCandidateV1,
  accountKey: string,
) {
  const generation = String(candidate.expected_sync_generation)
  return UUID.test(candidate.id) && candidate.account_key === accountKey &&
    /^[A-Za-z0-9._:-]{1,100}$/.test(candidate.expected_source) &&
    (candidate.expected_sync_key === null || (
      candidate.expected_sync_key.length > 0 &&
      candidate.expected_sync_key.length <= 500 &&
      !CONTROL.test(candidate.expected_sync_key)
    )) &&
    candidate.expected_listing_status === "active" &&
    ITEM_ID.test(candidate.expected_ebay_item_id) &&
    (candidate.expected_ebay_sku === null || (
      candidate.expected_ebay_sku.length > 0 &&
      candidate.expected_ebay_sku.length <= 80 &&
      !CONTROL.test(candidate.expected_ebay_sku)
    )) && /^\d+$/.test(generation) &&
    validTimestamp(candidate.expected_updated_at)
}

function publicPlanReady(
  dryRun: EbayRegistryRepairDryRun,
  approved: ApprovedEbayRegistryRepairV1,
) {
  return dryRun.EVIDENCE_STATUS === "AVAILABLE" &&
    dryRun.CURRENT_EVIDENCE_FINGERPRINT ===
      approved.approvedEvidenceFingerprint &&
    dryRun.DRY_RUN_PACKAGE_HANDLE === approved.approvedPackageHandle &&
    dryRun.DRY_RUN_FRESHNESS_STATUS === "CURRENT" &&
    dryRun.DRY_RUN_STATE_BOUND === "YES" &&
    dryRun.DRY_RUN_REJECTION_REASON === null &&
    dryRun.FINAL_REJECTION_REASON === null &&
    dryRun.DRY_RUN_READY_FOR_APPROVAL === "YES" &&
    dryRun.LIVE_DRY_RUN_PARTITION_VALID === "YES" &&
    dryRun.REGISTRY_DRY_RUN_PARTITION_VALID === "YES" &&
    dryRun.AUTOMATIC_TRANCHE_PRECONDITIONS_PASS === "YES" &&
    dryRun.IDENTITY_UNPROVEN_COUNT === 0 &&
    dryRun.AUTOMATIC_PRECONDITION_UNPROVEN_COUNT === 0 &&
    dryRun.REPAIR_EXISTING_AUTOMATIC_COUNT === 0 &&
    dryRun.CREATE_PRECONDITION_STATUS === "PASS" &&
    dryRun.STALE_PRECONDITION_STATUS === "PASS" &&
    dryRun.HUMAN_REVIEW_WRITE_ALLOWED === "NO" &&
    dryRun.HUMAN_REVIEW_MUTATION_COUNT === 0
}

function validatePrivatePlan(
  dryRun: EbayRegistryRepairDryRun,
  plan: EbayRegistryRepairExecutionPlanV1,
  approved: ApprovedEbayRegistryRepairV1,
  now: Date,
) {
  if (plan.version !== "EBAY_REGISTRY_REPAIR_EXECUTION_PLAN_V1" ||
      plan.evidenceFingerprint !== dryRun.CURRENT_EVIDENCE_FINGERPRINT ||
      plan.packageHandle !== dryRun.DRY_RUN_PACKAGE_HANDLE ||
      plan.evidenceFingerprint !== approved.approvedEvidenceFingerprint ||
      plan.packageHandle !== approved.approvedPackageHandle) {
    fail("PRIVATE_PLAN_BINDING_MISMATCH")
  }
  if (plan.createCandidates.length !== dryRun.CREATE_NEW_COUNT ||
      plan.staleCandidates.length !== dryRun.MARK_STALE_COUNT ||
      plan.repairCandidates.length !==
        dryRun.REPAIR_EXISTING_AUTOMATIC_COUNT ||
      plan.humanReviewCandidates.length !== dryRun.HUMAN_REVIEW_COUNT ||
      plan.createCandidates.length !== approved.approvedCreateCount ||
      plan.staleCandidates.length !== approved.approvedStaleCount ||
      plan.humanReviewCandidates.length !== approved.approvedHumanReviewCount) {
    fail("ACTION_COUNT_MISMATCH")
  }
  if (plan.repairCandidates.length !== 0) {
    fail("REPAIR_OPERATION_NOT_SUPPORTED")
  }
  const automaticHandles = [
    ...plan.createCandidates.map((candidate) => candidate.membershipHandle),
    ...plan.staleCandidates.map((candidate) => candidate.membershipHandle),
    ...plan.repairCandidates.map((candidate) => candidate.membershipHandle),
  ]
  const reviewHandles = plan.humanReviewCandidates.map(
    (candidate) => candidate.candidateHandle,
  )
  const allHandles = [...automaticHandles, ...reviewHandles]
  if (allHandles.some((handle) => !MEMBERSHIP_HANDLE.test(handle)) ||
      new Set(allHandles).size !== allHandles.length ||
      plan.humanReviewCandidates.some((candidate) =>
        candidate.relationshipType !== "SKU_ONLY" &&
        candidate.relationshipType !== "ITEM_ID_ONLY_LIFECYCLE")) {
    fail("HUMAN_REVIEW_EXCLUSION_FAILED")
  }
  if (plan.createCandidates.some((candidate) =>
    !createPayloadSafe(candidate.rpcInput, plan.accountKey, now))) {
    fail("CREATE_PAYLOAD_UNSAFE")
  }
  if (plan.staleCandidates.some((candidate) =>
    !stalePayloadSafe(candidate.rpcInput, plan.accountKey))) {
    fail("STALE_CAS_PAYLOAD_INVALID")
  }
  const createItems = new Set<string>()
  const createSyncKeys = new Set<string>()
  for (const candidate of plan.createCandidates) {
    if (createItems.has(candidate.rpcInput.ebay_item_id) ||
        createSyncKeys.has(candidate.rpcInput.sync_key)) {
      fail("ACTION_COUNT_MISMATCH")
    }
    createItems.add(candidate.rpcInput.ebay_item_id)
    createSyncKeys.add(candidate.rpcInput.sync_key)
  }
  const staleIds = new Set<string>()
  for (const candidate of plan.staleCandidates) {
    if (staleIds.has(candidate.rpcInput.id) ||
        createItems.has(candidate.rpcInput.expected_ebay_item_id) ||
        (candidate.rpcInput.expected_sync_key !== null &&
          createSyncKeys.has(candidate.rpcInput.expected_sync_key))) {
      fail("HUMAN_REVIEW_EXCLUSION_FAILED")
    }
    staleIds.add(candidate.rpcInput.id)
  }
}

export async function executeApprovedRegistryRepairV1WithDependencies(
  approved: ApprovedEbayRegistryRepairV1,
  dependencies: EbayRegistryRepairExecutorDependencies,
): Promise<EbayRegistryRepairExecutionResultV1> {
  if (!PACKAGE_HANDLE.test(approved.approvedPackageHandle) ||
      !EVIDENCE_FINGERPRINT.test(approved.approvedEvidenceFingerprint) ||
      !integerCount(approved.approvedCreateCount) ||
      !integerCount(approved.approvedStaleCount) ||
      !integerCount(approved.approvedHumanReviewCount)) {
    fail("APPROVAL_BINDING_INVALID")
  }
  const current = await dependencies.readCurrentPlanningResult()
  if (!current.executionPlan) fail("CURRENT_PLAN_UNAVAILABLE")
  if (!publicPlanReady(current.dryRun, approved)) {
    fail("CURRENT_STATE_NOT_APPROVABLE")
  }
  validatePrivatePlan(
    current.dryRun,
    current.executionPlan,
    approved,
    dependencies.now?.() ?? new Date(),
  )
  const arguments_: EbayRegistryRepairRpcArgumentsV1 = {
    p_account_key: current.executionPlan.accountKey,
    p_package_handle: approved.approvedPackageHandle,
    p_evidence_fingerprint: approved.approvedEvidenceFingerprint,
    p_expected_create_count: approved.approvedCreateCount,
    p_expected_stale_count: approved.approvedStaleCount,
    p_expected_human_review_count: approved.approvedHumanReviewCount,
    p_create_candidates: current.executionPlan.createCandidates.map(
      (candidate) => candidate.rpcInput,
    ),
    p_stale_candidates: current.executionPlan.staleCandidates.map(
      (candidate) => candidate.rpcInput,
    ),
  }
  let rpcResult: EbayRegistryRepairRpcResultV1
  try {
    rpcResult = await dependencies.invokeRpc(arguments_)
  } catch {
    fail("RPC_FAILED")
  }
  if (rpcResult.result_status !== "APPLIED" ||
      rpcResult.create_inserted !== approved.approvedCreateCount ||
      rpcResult.stale_updated !== approved.approvedStaleCount ||
      rpcResult.repair_updated !== 0 || rpcResult.human_review_mutated !== 0) {
    fail("RPC_RESULT_INVALID")
  }
  let postWriteVerificationStatus: "COMPLETED" | "UNPROVEN" = "COMPLETED"
  try {
    await dependencies.postWriteVerify()
  } catch {
    postWriteVerificationStatus = "UNPROVEN"
  }
  return {
    EXECUTION_STATUS: "APPLIED",
    RPC_INVOCATION_COUNT: 1,
    CREATE_COMMITTED: rpcResult.create_inserted,
    STALE_COMMITTED: rpcResult.stale_updated,
    REPAIR_COMMITTED: 0,
    HUMAN_REVIEW_MUTATED: 0,
    POST_WRITE_VERIFICATION_STATUS: postWriteVerificationStatus,
  }
}

async function readCurrentPlanningResult(): Promise<EbayRegistryRepairPlanningResult> {
  let executionPlan: EbayRegistryRepairExecutionPlanV1 | null = null
  const dryRun = await previewEbayRegistryRepairRuntime({
    captureRegistryRepairExecutionPlan: (captured) => {
      executionPlan = captured
    },
  })
  return { dryRun, executionPlan }
}

async function invokeAtomicRegistryRepairRpc(
  arguments_: EbayRegistryRepairRpcArgumentsV1,
  client: Pick<SupabaseClient, "rpc"> = getSupabaseAdminClient(),
): Promise<EbayRegistryRepairRpcResultV1> {
  const { data, error } = await client.rpc(
    "apply_ebay_registry_repair_v1",
    arguments_,
  )
  if (error) fail("RPC_FAILED")
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== "object") fail("RPC_RESULT_INVALID")
  return row as EbayRegistryRepairRpcResultV1
}

export async function executeApprovedRegistryRepairV1(
  approved: ApprovedEbayRegistryRepairV1,
): Promise<EbayRegistryRepairExecutionResultV1> {
  return executeApprovedRegistryRepairV1WithDependencies(approved, {
    readCurrentPlanningResult,
    invokeRpc: invokeAtomicRegistryRepairRpc,
    postWriteVerify: async () => diagnoseRegistryCoverageRuntime(),
  })
}
