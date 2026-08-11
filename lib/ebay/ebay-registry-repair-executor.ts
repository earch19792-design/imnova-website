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

export type EbayRegistryRepairPrewriteStaleReason =
  | "NONE"
  | "SOURCE_EVIDENCE_UNAVAILABLE"
  | "SEMANTIC_EVIDENCE_CHANGED"
  | "ACTION_PARTITION_CHANGED"
  | "HUMAN_REVIEW_CHANGED"
  | "PACKAGE_CANONICALIZATION_DRIFT"
  | "MULTIPLE_SEMANTIC_CHANGES"
  | "APPROVAL_READINESS_CHANGED"

export type EbayRegistryRepairPrewriteAssessmentV1 = {
  PREWRITE_STATE_STATUS: "CURRENT" | "STALE" | "UNPROVEN"
  STALE_REASON: EbayRegistryRepairPrewriteStaleReason
  CURRENT_LIVE_COUNT: number | "UNPROVEN"
  CURRENT_REGISTRY_COUNT: number | "UNPROVEN"
  CURRENT_CREATE_COUNT: number | "UNPROVEN"
  CURRENT_STALE_COUNT: number | "UNPROVEN"
  CURRENT_REPAIR_COUNT: number | "UNPROVEN"
  CURRENT_HUMAN_REVIEW_COUNT: number | "UNPROVEN"
  CURRENT_IDENTITY_UNPROVEN_COUNT: number | "UNPROVEN"
  CURRENT_PRECONDITION_UNPROVEN_COUNT: number | "UNPROVEN"
  CURRENT_EVIDENCE_FINGERPRINT: string | "UNPROVEN"
  CURRENT_PACKAGE_HANDLE: string | "UNPROVEN"
  APPROVED_EVIDENCE_FINGERPRINT_MATCH: "YES" | "NO" | "UNPROVEN"
  APPROVED_PACKAGE_HANDLE_MATCH: "YES" | "NO" | "UNPROVEN"
  APPROVED_ACTION_COUNTS_MATCH: "YES" | "NO" | "UNPROVEN"
  WRITE_ALLOWED: "YES" | "NO"
}

export class EbayRegistryRepairExecutorError extends Error {
  readonly code: EbayRegistryRepairExecutorFailureCode
  readonly prewriteAssessment: EbayRegistryRepairPrewriteAssessmentV1 | null
  readonly rpcInvocationCount: 0 | 1

  constructor(
    code: EbayRegistryRepairExecutorFailureCode,
    prewriteAssessment: EbayRegistryRepairPrewriteAssessmentV1 | null = null,
    rpcInvocationCount: 0 | 1 = 0,
  ) {
    super(code)
    this.name = "EbayRegistryRepairExecutorError"
    this.code = code
    this.prewriteAssessment = prewriteAssessment
    this.rpcInvocationCount = rpcInvocationCount
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

export type EbayRegistryRepairPostWriteVerificationV1 = {
  POST_WRITE_VERIFICATION_STATUS: "PASS" | "FAILED" | "UNPROVEN"
  POST_WRITE_LIVE_COUNT: number | "UNPROVEN"
  POST_WRITE_REGISTRY_RECORD_COUNT: number | "UNPROVEN"
  POST_WRITE_MATCHED_COUNT: number | "UNPROVEN"
  POST_WRITE_MISSING_COUNT: number | "UNPROVEN"
  POST_WRITE_ORPHANED_COUNT: number | "UNPROVEN"
  POST_WRITE_AMBIGUOUS_COUNT: number | "UNPROVEN"
  POST_WRITE_COVERAGE_PERCENT: number | "UNPROVEN"
  POST_WRITE_HUMAN_REVIEW_COUNT: number | "UNPROVEN"
  POST_WRITE_CREATE_RELATIONS_PRESENT: number | "UNPROVEN"
  POST_WRITE_ENDED_ROWS_CONFIRMED: number | "UNPROVEN"
  POST_WRITE_DUPLICATE_ITEM_ID_RELATIONS: number | "UNPROVEN"
  POST_WRITE_PARTITION_VALID: "YES" | "NO" | "UNPROVEN"
  HUMAN_REVIEW_ROWS_MUTATED: 0
  HUMAN_REVIEW_RELATIONSHIPS_PRESERVED: "YES" | "NO" | "UNPROVEN"
}

export type EbayRegistryRepairExecutionResultV1 =
  EbayRegistryRepairPostWriteVerificationV1 & {
  EXECUTION_STATUS: "APPLIED"
  RPC_INVOCATION_COUNT: 1
  CREATE_COMMITTED: number
  STALE_COMMITTED: number
  REPAIR_COMMITTED: 0
  HUMAN_REVIEW_MUTATED: 0
  TRANSACTION_STATUS: "COMMITTED"
  ROLLBACK_OCCURRED: "NO"
  DATABASE_COMMIT_STATUS: "COMMITTED"
  WRITE_EXECUTED: "YES"
}

export type EbayRegistryRepairExecutorDependencies = {
  readCurrentPlanningResult: () => Promise<EbayRegistryRepairPlanningResult>
  invokeRpc: (
    arguments_: EbayRegistryRepairRpcArgumentsV1,
  ) => Promise<EbayRegistryRepairRpcResultV1>
  postWriteVerify: (input: {
    prewritePlanningResult: EbayRegistryRepairPlanningResult
    rpcArguments: EbayRegistryRepairRpcArgumentsV1
  }) => Promise<EbayRegistryRepairPostWriteVerificationV1>
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

function fail(
  code: EbayRegistryRepairExecutorFailureCode,
  prewriteAssessment: EbayRegistryRepairPrewriteAssessmentV1 | null = null,
  rpcInvocationCount: 0 | 1 = 0,
): never {
  throw new EbayRegistryRepairExecutorError(
    code,
    prewriteAssessment,
    rpcInvocationCount,
  )
}

function unprovenPostWriteVerification(): EbayRegistryRepairPostWriteVerificationV1 {
  return {
    POST_WRITE_VERIFICATION_STATUS: "UNPROVEN",
    POST_WRITE_LIVE_COUNT: "UNPROVEN",
    POST_WRITE_REGISTRY_RECORD_COUNT: "UNPROVEN",
    POST_WRITE_MATCHED_COUNT: "UNPROVEN",
    POST_WRITE_MISSING_COUNT: "UNPROVEN",
    POST_WRITE_ORPHANED_COUNT: "UNPROVEN",
    POST_WRITE_AMBIGUOUS_COUNT: "UNPROVEN",
    POST_WRITE_COVERAGE_PERCENT: "UNPROVEN",
    POST_WRITE_HUMAN_REVIEW_COUNT: "UNPROVEN",
    POST_WRITE_CREATE_RELATIONS_PRESENT: "UNPROVEN",
    POST_WRITE_ENDED_ROWS_CONFIRMED: "UNPROVEN",
    POST_WRITE_DUPLICATE_ITEM_ID_RELATIONS: "UNPROVEN",
    POST_WRITE_PARTITION_VALID: "UNPROVEN",
    HUMAN_REVIEW_ROWS_MUTATED: 0,
    HUMAN_REVIEW_RELATIONSHIPS_PRESERVED: "UNPROVEN",
  }
}

function integerCount(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 5000
}

function safeCurrentCount(value: unknown): number | "UNPROVEN" {
  return integerCount(value) ? Number(value) : "UNPROVEN"
}

function approvalBindingValid(approved: ApprovedEbayRegistryRepairV1) {
  return PACKAGE_HANDLE.test(approved.approvedPackageHandle) &&
    EVIDENCE_FINGERPRINT.test(approved.approvedEvidenceFingerprint) &&
    integerCount(approved.approvedCreateCount) &&
    integerCount(approved.approvedStaleCount) &&
    integerCount(approved.approvedHumanReviewCount)
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

export function assessApprovedRegistryRepairPlanningResultV1(
  approved: ApprovedEbayRegistryRepairV1,
  current: EbayRegistryRepairPlanningResult,
): EbayRegistryRepairPrewriteAssessmentV1 {
  const dryRun = current.dryRun
  const liveCount = safeCurrentCount(dryRun.CURRENT_LIVE_COUNT)
  const registryCount = safeCurrentCount(dryRun.CURRENT_REGISTRY_COUNT)
  const createCount = safeCurrentCount(dryRun.CREATE_NEW_COUNT)
  const staleCount = safeCurrentCount(dryRun.MARK_STALE_COUNT)
  const repairCount = safeCurrentCount(
    dryRun.REPAIR_EXISTING_AUTOMATIC_COUNT,
  )
  const humanReviewCount = safeCurrentCount(dryRun.HUMAN_REVIEW_COUNT)
  const identityUnprovenCount = safeCurrentCount(
    dryRun.IDENTITY_UNPROVEN_COUNT,
  )
  const preconditionUnprovenCount = safeCurrentCount(
    dryRun.AUTOMATIC_PRECONDITION_UNPROVEN_COUNT,
  )
  const evidenceFingerprint = EVIDENCE_FINGERPRINT.test(
    String(dryRun.CURRENT_EVIDENCE_FINGERPRINT),
  )
    ? dryRun.CURRENT_EVIDENCE_FINGERPRINT
    : "UNPROVEN"
  const packageHandle = PACKAGE_HANDLE.test(String(dryRun.DRY_RUN_PACKAGE_HANDLE))
    ? dryRun.DRY_RUN_PACKAGE_HANDLE
    : "UNPROVEN"
  const evidenceAvailable = dryRun.EVIDENCE_STATUS === "AVAILABLE" &&
    current.executionPlan !== null && evidenceFingerprint !== "UNPROVEN" &&
    packageHandle !== "UNPROVEN" && liveCount !== "UNPROVEN" &&
    registryCount !== "UNPROVEN" && createCount !== "UNPROVEN" &&
    staleCount !== "UNPROVEN" && repairCount !== "UNPROVEN" &&
    humanReviewCount !== "UNPROVEN" && identityUnprovenCount !== "UNPROVEN" &&
    preconditionUnprovenCount !== "UNPROVEN"
  const base = {
    CURRENT_LIVE_COUNT: liveCount,
    CURRENT_REGISTRY_COUNT: registryCount,
    CURRENT_CREATE_COUNT: createCount,
    CURRENT_STALE_COUNT: staleCount,
    CURRENT_REPAIR_COUNT: repairCount,
    CURRENT_HUMAN_REVIEW_COUNT: humanReviewCount,
    CURRENT_IDENTITY_UNPROVEN_COUNT: identityUnprovenCount,
    CURRENT_PRECONDITION_UNPROVEN_COUNT: preconditionUnprovenCount,
    CURRENT_EVIDENCE_FINGERPRINT: evidenceFingerprint,
    CURRENT_PACKAGE_HANDLE: packageHandle,
  }
  if (!evidenceAvailable) {
    return {
      PREWRITE_STATE_STATUS: "UNPROVEN",
      STALE_REASON: "SOURCE_EVIDENCE_UNAVAILABLE",
      ...base,
      APPROVED_EVIDENCE_FINGERPRINT_MATCH: "UNPROVEN",
      APPROVED_PACKAGE_HANDLE_MATCH: "UNPROVEN",
      APPROVED_ACTION_COUNTS_MATCH: "UNPROVEN",
      WRITE_ALLOWED: "NO",
    }
  }

  const fingerprintMatches = evidenceFingerprint ===
    approved.approvedEvidenceFingerprint
  const packageMatches = packageHandle === approved.approvedPackageHandle
  const automaticActionCountsMatch =
    createCount === approved.approvedCreateCount &&
    staleCount === approved.approvedStaleCount && repairCount === 0
  const humanReviewCountMatches = humanReviewCount ===
    approved.approvedHumanReviewCount
  const actionCountsMatch = automaticActionCountsMatch &&
    humanReviewCountMatches
  if (!fingerprintMatches || !packageMatches || !actionCountsMatch) {
    const changedGroups = [
      ...(!automaticActionCountsMatch ? ["ACTION_PARTITION_CHANGED" as const] : []),
      ...(!humanReviewCountMatches ? ["HUMAN_REVIEW_CHANGED" as const] : []),
    ]
    const staleReason: EbayRegistryRepairPrewriteStaleReason =
      changedGroups.length > 1
        ? "MULTIPLE_SEMANTIC_CHANGES"
        : changedGroups[0] ?? (!fingerprintMatches
          ? "SEMANTIC_EVIDENCE_CHANGED"
          : "PACKAGE_CANONICALIZATION_DRIFT")
    return {
      PREWRITE_STATE_STATUS: "STALE",
      STALE_REASON: staleReason,
      ...base,
      APPROVED_EVIDENCE_FINGERPRINT_MATCH: fingerprintMatches ? "YES" : "NO",
      APPROVED_PACKAGE_HANDLE_MATCH: packageMatches ? "YES" : "NO",
      APPROVED_ACTION_COUNTS_MATCH: actionCountsMatch ? "YES" : "NO",
      WRITE_ALLOWED: "NO",
    }
  }
  if (!publicPlanReady(dryRun, approved)) {
    return {
      PREWRITE_STATE_STATUS: "STALE",
      STALE_REASON: "APPROVAL_READINESS_CHANGED",
      ...base,
      APPROVED_EVIDENCE_FINGERPRINT_MATCH: "YES",
      APPROVED_PACKAGE_HANDLE_MATCH: "YES",
      APPROVED_ACTION_COUNTS_MATCH: "YES",
      WRITE_ALLOWED: "NO",
    }
  }
  return {
    PREWRITE_STATE_STATUS: "CURRENT",
    STALE_REASON: "NONE",
    ...base,
    APPROVED_EVIDENCE_FINGERPRINT_MATCH: "YES",
    APPROVED_PACKAGE_HANDLE_MATCH: "YES",
    APPROVED_ACTION_COUNTS_MATCH: "YES",
    WRITE_ALLOWED: "YES",
  }
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
  if (!approvalBindingValid(approved)) {
    fail("APPROVAL_BINDING_INVALID")
  }
  const current = await dependencies.readCurrentPlanningResult()
  const prewriteAssessment = assessApprovedRegistryRepairPlanningResultV1(
    approved,
    current,
  )
  if (prewriteAssessment.PREWRITE_STATE_STATUS === "UNPROVEN") {
    fail("CURRENT_PLAN_UNAVAILABLE", prewriteAssessment)
  }
  if (prewriteAssessment.WRITE_ALLOWED !== "YES") {
    fail("CURRENT_STATE_NOT_APPROVABLE", prewriteAssessment)
  }
  if (!current.executionPlan) fail("CURRENT_PLAN_UNAVAILABLE", prewriteAssessment)
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
    fail("RPC_FAILED", prewriteAssessment, 1)
  }
  if (rpcResult.result_status !== "APPLIED" ||
      rpcResult.create_inserted !== approved.approvedCreateCount ||
      rpcResult.stale_updated !== approved.approvedStaleCount ||
      rpcResult.repair_updated !== 0 || rpcResult.human_review_mutated !== 0) {
    fail("RPC_RESULT_INVALID", prewriteAssessment, 1)
  }
  let postWriteVerification = unprovenPostWriteVerification()
  try {
    postWriteVerification = await dependencies.postWriteVerify({
      prewritePlanningResult: current,
      rpcArguments: arguments_,
    })
  } catch {}
  return {
    EXECUTION_STATUS: "APPLIED",
    RPC_INVOCATION_COUNT: 1,
    CREATE_COMMITTED: rpcResult.create_inserted,
    STALE_COMMITTED: rpcResult.stale_updated,
    REPAIR_COMMITTED: 0,
    HUMAN_REVIEW_MUTATED: 0,
    TRANSACTION_STATUS: "COMMITTED",
    ROLLBACK_OCCURRED: "NO",
    DATABASE_COMMIT_STATUS: "COMMITTED",
    WRITE_EXECUTED: "YES",
    ...postWriteVerification,
  }
}

function observedNumber(value: unknown): number | "UNPROVEN" {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : "UNPROVEN"
}

async function verifyAppliedRegistryRepairV1(input: {
  prewritePlanningResult: EbayRegistryRepairPlanningResult
  client?: SupabaseClient
}): Promise<EbayRegistryRepairPostWriteVerificationV1> {
  const prewritePlan = input.prewritePlanningResult.executionPlan
  if (!prewritePlan) return unprovenPostWriteVerification()
  const coverage = await diagnoseRegistryCoverageRuntime() as unknown as
    Record<string, unknown>
  const postWritePlanCapture: {
    value: EbayRegistryRepairExecutionPlanV1 | null
  } = { value: null }
  const postWriteDryRun = await previewEbayRegistryRepairRuntime({
    captureRegistryRepairExecutionPlan: (captured) => {
      postWritePlanCapture.value = captured
    },
  })
  const client = input.client ?? getSupabaseAdminClient()
  const { data, error } = await client
    .from("ebay_active_listings")
    .select("id,account_key,listing_status,ebay_item_id")
    .eq("account_key", prewritePlan.accountKey)
  if (error || !Array.isArray(data)) throw new Error("POST_WRITE_REGISTRY_READ_FAILED")
  const rows = data as Array<{
    id?: unknown
    account_key?: unknown
    listing_status?: unknown
    ebay_item_id?: unknown
  }>
  const normalizedRows = rows.map((row) => ({
    id: typeof row.id === "string" ? row.id.trim() : "",
    accountKey: typeof row.account_key === "string"
      ? row.account_key.trim()
      : "",
    status: typeof row.listing_status === "string"
      ? row.listing_status.trim().toLowerCase()
      : "",
    itemId: typeof row.ebay_item_id === "string"
      ? row.ebay_item_id.trim()
      : "",
  }))
  const createRelationsPresent = prewritePlan.createCandidates.filter(
    (candidate) => normalizedRows.filter((row) =>
      row.accountKey === prewritePlan.accountKey && row.status === "active" &&
      row.itemId === candidate.rpcInput.ebay_item_id).length === 1,
  ).length
  const endedRowsConfirmed = prewritePlan.staleCandidates.filter(
    (candidate) => normalizedRows.some((row) =>
      row.id === candidate.rpcInput.id &&
      row.accountKey === prewritePlan.accountKey && row.status === "ended" &&
      row.itemId === candidate.rpcInput.expected_ebay_item_id),
  ).length
  const itemIdCounts = new Map<string, number>()
  for (const row of normalizedRows) {
    if (!row.itemId) continue
    itemIdCounts.set(row.itemId, (itemIdCounts.get(row.itemId) ?? 0) + 1)
  }
  const duplicateItemIdRelations = [...itemIdCounts.values()].filter(
    (count) => count > 1,
  ).length
  const postWriteHumanReviewCount = observedNumber(
    postWriteDryRun.HUMAN_REVIEW_COUNT,
  )
  const expectedReviewTypes = prewritePlan.humanReviewCandidates.map(
    (candidate) => candidate.relationshipType,
  ).sort()
  const postReviewTypes = postWritePlanCapture.value?.humanReviewCandidates.map(
    (candidate) => candidate.relationshipType,
  ).sort() ?? []
  const humanReviewRelationshipsPreserved =
    postWriteHumanReviewCount === expectedReviewTypes.length &&
    JSON.stringify(postReviewTypes) === JSON.stringify(expectedReviewTypes)
      ? "YES" as const
      : "NO" as const
  const postWritePartitionValid =
    postWriteDryRun.LIVE_DRY_RUN_PARTITION_VALID === "YES" &&
      postWriteDryRun.REGISTRY_DRY_RUN_PARTITION_VALID === "YES"
      ? "YES" as const
      : "NO" as const
  const verification = {
    POST_WRITE_LIVE_COUNT: observedNumber(coverage.LIVE_EBAY_LISTING_COUNT),
    POST_WRITE_REGISTRY_RECORD_COUNT: rows.length,
    POST_WRITE_MATCHED_COUNT: observedNumber(coverage.REGISTRY_MATCHED_COUNT),
    POST_WRITE_MISSING_COUNT: observedNumber(coverage.REGISTRY_MISSING_COUNT),
    POST_WRITE_ORPHANED_COUNT: observedNumber(coverage.REGISTRY_ORPHANED_COUNT),
    POST_WRITE_AMBIGUOUS_COUNT: observedNumber(coverage.REGISTRY_AMBIGUOUS_COUNT),
    POST_WRITE_COVERAGE_PERCENT: observedNumber(coverage.REGISTRY_COVERAGE_PERCENT),
    POST_WRITE_HUMAN_REVIEW_COUNT: postWriteHumanReviewCount,
    POST_WRITE_CREATE_RELATIONS_PRESENT: createRelationsPresent,
    POST_WRITE_ENDED_ROWS_CONFIRMED: endedRowsConfirmed,
    POST_WRITE_DUPLICATE_ITEM_ID_RELATIONS: duplicateItemIdRelations,
    POST_WRITE_PARTITION_VALID: postWritePartitionValid,
    HUMAN_REVIEW_ROWS_MUTATED: 0 as const,
    HUMAN_REVIEW_RELATIONSHIPS_PRESERVED: humanReviewRelationshipsPreserved,
  }
  const observationsAvailable = [
    verification.POST_WRITE_LIVE_COUNT,
    verification.POST_WRITE_MATCHED_COUNT,
    verification.POST_WRITE_MISSING_COUNT,
    verification.POST_WRITE_ORPHANED_COUNT,
    verification.POST_WRITE_AMBIGUOUS_COUNT,
    verification.POST_WRITE_COVERAGE_PERCENT,
    verification.POST_WRITE_HUMAN_REVIEW_COUNT,
  ].every((value) => value !== "UNPROVEN")
  const invariantsPass =
    createRelationsPresent === prewritePlan.createCandidates.length &&
    endedRowsConfirmed === prewritePlan.staleCandidates.length &&
    duplicateItemIdRelations === 0 && postWritePartitionValid === "YES" &&
    humanReviewRelationshipsPreserved === "YES"
  return {
    POST_WRITE_VERIFICATION_STATUS: !observationsAvailable
      ? "UNPROVEN"
      : invariantsPass ? "PASS" : "FAILED",
    ...verification,
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
    postWriteVerify: async ({ prewritePlanningResult }) =>
      verifyAppliedRegistryRepairV1({ prewritePlanningResult }),
  })
}
