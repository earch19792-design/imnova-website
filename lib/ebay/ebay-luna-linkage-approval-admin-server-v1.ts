import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildSellerOsLunaLinkageReviewEntryV2,
  buildSellerOsLunaLinkageReviewSetV2,
  createSellerOsLunaLinkageApprovalCsrfBoundaryV1,
  parseSellerOsLunaLinkageApprovalRequestV1,
  type SellerOsLunaIdentityEvidenceProvenanceV1,
  type SellerOsLunaLinkageApprovalRequestV1,
  type SellerOsLunaLinkageModeV1,
  type SellerOsLunaLinkageReviewClassificationV2,
  type SellerOsLunaLinkageReviewComponentInputV2,
  type SellerOsLunaLinkageReviewSetV2,
} from "./ebay-luna-linkage-approval-control-plane-v1"

export const SELLER_OS_LUNA_LINKAGE_ADMIN_REVIEW_VERSION =
  "SELLER_OS_LUNA_LINKAGE_ADMIN_REVIEW_V1" as const
export const SELLER_OS_LUNA_LINKAGE_CURRENT_REVIEW_COUNT = 26 as const

const MAXIMUM_DECISION_ROWS = 100
const MAXIMUM_CLOCK_SKEW_MS = 5 * 60 * 1_000
const REVIEW_SET_ID =
  /^luna-linkage-review-set-v1:sha256:[0-9a-f]{64}$/
const REVIEW_CANDIDATE_ID =
  /^luna-linkage-review-candidate-v1:sha256:[0-9a-f]{64}$/
const DECISION_REFERENCE =
  /^luna-linkage-decision-v1:sha256:[0-9a-f]{64}$/
const DIGEST = /^sha256:[0-9a-f]{64}$/
const POST_KEYS = Object.freeze([
  "candidateEvidenceDigest",
  "currentCohortId",
  "decision",
  "decisionVersion",
  "ebayItemId",
  "reviewSetId",
] as const)

type AdminClient = Pick<SupabaseClient, "from" | "rpc">

type SafeDecision = Readonly<{
  ebayItemId: string
  decision: "APPROVE_EXACT_LINKAGE" | "REJECT_CANDIDATE" | "KEEP_UNPROVEN"
  decisionVersion: number
  decisionAt: string
  decisionReference: string
  evidenceDigest: string
}>

export type SellerOsLunaLinkageAdminReviewV1 = Readonly<{
  reviewSet: SellerOsLunaLinkageReviewSetV2
  latestDecisions: readonly SafeDecision[]
}>

export class SellerOsLunaLinkageApprovalAdminServerError extends Error {
  readonly code: string

  constructor(code: string) {
    const safe = /^[A-Z0-9_]{3,160}$/.test(code)
      ? code : "LUNA_LINKAGE_ADMIN_REVIEW_FAILED_CLOSED"
    super(safe)
    this.name = "SellerOsLunaLinkageApprovalAdminServerError"
    this.code = safe
  }
}

function fail(code: string): never {
  throw new SellerOsLunaLinkageApprovalAdminServerError(code)
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

function timestamp(value: unknown) {
  if (typeof value !== "string" || value.length > 50 ||
      !Number.isFinite(Date.parse(value))) return null
  return new Date(value).toISOString()
}

function nullableString(value: unknown) {
  return value === null ? null : typeof value === "string" ? value : undefined
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value as string[] : null
}

function scalarIdentity(components: readonly { lunaProductId: string
  lunaVariantId: string; lunaSku: string; supplierQuantityRequired: number }[]) {
  return components.length === 1 ? components[0] : null
}

function rebuildEntry(row: Record<string, unknown>) {
  const components = Array.isArray(row.components)
    ? row.components as SellerOsLunaLinkageReviewComponentInputV2[] : null
  const matchSignals = stringArray(row.match_signals)
  const conflictSignals = stringArray(row.conflict_signals)
  const evidenceReferences = stringArray(row.evidence_references)
  const provenance = record(row.identity_evidence_provenance)
  if (!components || !matchSignals || !conflictSignals ||
      !evidenceReferences || !provenance) {
    fail("LUNA_LINKAGE_ADMIN_REVIEW_ROW_INVALID")
  }
  try {
    return buildSellerOsLunaLinkageReviewEntryV2({
      currentCohortId: String(row.current_cohort_id ?? ""),
      accountKey: String(row.account_key ?? ""),
      ebayItemId: String(row.ebay_item_id ?? ""),
      ebaySku: nullableString(row.ebay_sku) as string | null,
      listingTitle: nullableString(row.listing_title) as string | null,
      classification: String(row.classification ?? "") as
        SellerOsLunaLinkageReviewClassificationV2,
      linkageMode: String(row.linkage_mode ?? "") as SellerOsLunaLinkageModeV1,
      components,
      matchSignals,
      conflictSignals,
      evidenceReferences,
      evidenceObservedAt: String(row.evidence_observed_at ?? ""),
      reviewObservedAt: String(row.review_observed_at ?? ""),
      identityEvidenceProvenance: provenance as
        SellerOsLunaIdentityEvidenceProvenanceV1,
      decisionVersion: Number(row.decision_version),
    })
  } catch {
    fail("LUNA_LINKAGE_ADMIN_REVIEW_ROW_INVALID")
  }
}

function assertSourceRowMatches(row: Record<string, unknown>, entry: ReturnType<
  typeof buildSellerOsLunaLinkageReviewEntryV2>) {
  const scalar = scalarIdentity(entry.components)
  if (row.account_binding !== "CANONICAL_SELLER_ACCOUNT" ||
      row.marketplace_id !== "EBAY_US" || row.is_current !== true ||
      row.contract_version !== entry.contractVersion ||
      row.evidence_digest !== entry.evidenceDigest ||
      row.linkage_id !== entry.linkageId ||
      row.approval_eligible !== entry.approvalEligibility.eligible ||
      row.evidence_freshness !== entry.evidenceFreshness ||
      Number(row.evidence_maximum_age_seconds) !==
        entry.evidenceMaximumAgeSeconds ||
      row.luna_product_id !== (scalar?.lunaProductId ?? null) ||
      row.luna_variant_id !== (scalar?.lunaVariantId ?? null) ||
      row.luna_sku !== (scalar?.lunaSku ?? null) ||
      row.supplier_quantity_required !==
        (scalar?.supplierQuantityRequired ?? null)) {
    fail("LUNA_LINKAGE_ADMIN_REVIEW_ROW_MISMATCH")
  }
}

function parseDecisionRow(value: unknown,
  itemEvidenceDigests: ReadonlyMap<string, string>) {
  const row = record(value)
  if (!row) fail("LUNA_LINKAGE_ADMIN_DECISION_ROW_INVALID")
  const ebayItemId = String(row.ebay_item_id ?? "")
  const decision = String(row.decision ?? "")
  const decisionVersion = Number(row.decision_version)
  const decisionAt = timestamp(row.decision_at)
  const decisionReference = String(row.decision_reference ?? "")
  const evidenceDigest = String(row.evidence_digest ?? "")
  if (!itemEvidenceDigests.has(ebayItemId) || !new Set([
    "APPROVE_EXACT_LINKAGE", "REJECT_CANDIDATE", "KEEP_UNPROVEN",
  ]).has(decision) || !Number.isSafeInteger(decisionVersion) ||
      decisionVersion < 1 || decisionVersion > 1_000_000 || !decisionAt ||
      !DECISION_REFERENCE.test(decisionReference) ||
      !DIGEST.test(evidenceDigest) ||
      evidenceDigest !== itemEvidenceDigests.get(ebayItemId)) {
    fail("LUNA_LINKAGE_ADMIN_DECISION_ROW_INVALID")
  }
  return Object.freeze({ ebayItemId,
    decision: decision as SafeDecision["decision"], decisionVersion,
    decisionAt, decisionReference, evidenceDigest })
}

/** Fixed-table, server-owned, bounded reconstruction; accepts no caller scope. */
export async function loadSellerOsLunaLinkageAdminReviewV1(
  client: Pick<AdminClient, "from">,
): Promise<SellerOsLunaLinkageAdminReviewV1> {
  const candidateRead = await client
    .from("seller_os_luna_linkage_review_candidates")
    .select("review_candidate_id,review_set_id,current_cohort_id,account_key,account_binding,marketplace_id,ebay_item_id,ebay_sku,listing_title,classification,linkage_mode,linkage_id,luna_product_id,luna_variant_id,luna_sku,components,supplier_quantity_required,match_signals,conflict_signals,evidence_references,evidence_digest,evidence_observed_at,review_observed_at,evidence_maximum_age_seconds,identity_evidence_provenance,evidence_freshness,decision_version,approval_eligible,is_current,contract_version")
    .eq("marketplace_id", "EBAY_US")
    .eq("is_current", true)
    .order("ebay_item_id", { ascending: true })
    .limit(SELLER_OS_LUNA_LINKAGE_CURRENT_REVIEW_COUNT + 1)
  if (candidateRead.error || !Array.isArray(candidateRead.data)) {
    fail("LUNA_LINKAGE_ADMIN_REVIEW_READ_UNAVAILABLE")
  }
  if (candidateRead.data.length !==
      SELLER_OS_LUNA_LINKAGE_CURRENT_REVIEW_COUNT) {
    fail("LUNA_LINKAGE_ADMIN_REVIEW_COMPLETE_SET_REQUIRED")
  }
  const rows = candidateRead.data.map((value) => {
    const row = record(value)
    if (!row) fail("LUNA_LINKAGE_ADMIN_REVIEW_ROW_INVALID")
    return row
  })
  const accountKeys = new Set(rows.map((row) => row.account_key))
  const cohortIds = new Set(rows.map((row) => row.current_cohort_id))
  const reviewSetIds = new Set(rows.map((row) => row.review_set_id))
  const itemIds = new Set(rows.map((row) => String(row.ebay_item_id ?? "")))
  if (accountKeys.size !== 1 || cohortIds.size !== 1 ||
      reviewSetIds.size !== 1 || itemIds.size !== rows.length ||
      !REVIEW_SET_ID.test(String(rows[0]?.review_set_id ?? "")) ||
      rows.some((row) => !REVIEW_CANDIDATE_ID.test(
        String(row.review_candidate_id ?? "")))) {
    fail("LUNA_LINKAGE_ADMIN_REVIEW_MIXED_OR_DUPLICATE_SET")
  }
  const entries = rows.map((row) => {
    const entry = rebuildEntry(row)
    assertSourceRowMatches(row, entry)
    return entry
  })
  let reviewSet: SellerOsLunaLinkageReviewSetV2
  try {
    reviewSet = buildSellerOsLunaLinkageReviewSetV2({
      currentCohortId: String(rows[0]?.current_cohort_id ?? ""),
      accountKey: String(rows[0]?.account_key ?? ""),
      currentLiveCount: SELLER_OS_LUNA_LINKAGE_CURRENT_REVIEW_COUNT,
      entries,
    })
  } catch {
    fail("LUNA_LINKAGE_ADMIN_REVIEW_SET_INVALID")
  }
  if (reviewSet.reviewSetId !== rows[0]?.review_set_id ||
      reviewSet.entries.some((entry) => rows.find((row) =>
        row.ebay_item_id === entry.ebayItemId)?.review_candidate_id !==
          entry.reviewCandidateId)) {
    fail("LUNA_LINKAGE_ADMIN_REVIEW_SET_DIGEST_MISMATCH")
  }

  const decisionRead = await client.from("seller_os_luna_linkage_decisions")
    .select("ebay_item_id,decision,decision_version,decision_at,decision_reference,evidence_digest")
    .eq("account_key", reviewSet.accountKey)
    .eq("marketplace_id", "EBAY_US")
    .eq("current_cohort_id", reviewSet.currentCohortId)
    .eq("review_set_id", reviewSet.reviewSetId)
    .in("ebay_item_id", [...itemIds])
    .order("decision_version", { ascending: false })
    .limit(MAXIMUM_DECISION_ROWS + 1)
  if (decisionRead.error || !Array.isArray(decisionRead.data) ||
      decisionRead.data.length > MAXIMUM_DECISION_ROWS) {
    fail("LUNA_LINKAGE_ADMIN_DECISION_READ_UNAVAILABLE")
  }
  const latest = new Map<string, SafeDecision>()
  const itemEvidenceDigests = new Map(reviewSet.entries.map((entry) =>
    [entry.ebayItemId, entry.evidenceDigest]))
  for (const value of decisionRead.data) {
    const decision = parseDecisionRow(value, itemEvidenceDigests)
    const existing = latest.get(decision.ebayItemId)
    if (!existing || decision.decisionVersion > existing.decisionVersion) {
      latest.set(decision.ebayItemId, decision)
    }
  }
  return Object.freeze({ reviewSet,
    latestDecisions: Object.freeze([...latest.values()]
      .sort((left, right) => left.ebayItemId.localeCompare(right.ebayItemId))) })
}

export function parseSellerOsLunaLinkageAdminDecisionRequestV1(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail("LUNA_LINKAGE_ADMIN_DECISION_CALLER_INPUT_REJECTED")
  }
  const input = value as Record<string, unknown>
  if (Object.keys(input).sort().join(",") !== [...POST_KEYS].sort().join(",") ||
      typeof input.reviewSetId !== "string" ||
      !REVIEW_SET_ID.test(input.reviewSetId)) {
    fail("LUNA_LINKAGE_ADMIN_DECISION_CALLER_INPUT_REJECTED")
  }
  let request: SellerOsLunaLinkageApprovalRequestV1
  try {
    request = parseSellerOsLunaLinkageApprovalRequestV1({
      reviewSetId: input.reviewSetId,
      currentCohortId: input.currentCohortId,
      ebayItemId: input.ebayItemId,
      candidateEvidenceDigest: input.candidateEvidenceDigest,
      decision: input.decision,
      decisionVersion: input.decisionVersion,
    })
  } catch {
    fail("LUNA_LINKAGE_ADMIN_DECISION_CALLER_INPUT_REJECTED")
  }
  return request
}

const csrfBoundary = createSellerOsLunaLinkageApprovalCsrfBoundaryV1()

export function getSellerOsLunaLinkageApprovalAdminCsrfBoundaryV1() {
  return csrfBoundary
}

export function buildSellerOsLunaLinkageAdminReviewPayloadV1(input: Readonly<{
  loaded: SellerOsLunaLinkageAdminReviewV1
  csrf: ReturnType<ReturnType<
    typeof createSellerOsLunaLinkageApprovalCsrfBoundaryV1>["issue"]>
  observedAt?: string
}>) {
  const observedAt = timestamp(input.observedAt ?? new Date().toISOString())
  if (!observedAt) fail("LUNA_LINKAGE_ADMIN_REVIEW_CLOCK_INVALID")
  const at = Date.parse(observedAt)
  const decisions = new Map(input.loaded.latestDecisions.map((decision) =>
    [decision.ebayItemId, decision]))
  const reviewSet = input.loaded.reviewSet
  const entries = reviewSet.entries.map((entry) => {
    const evidenceAt = Date.parse(entry.evidenceObservedAt)
    const expiresAtMs = evidenceAt + entry.evidenceMaximumAgeSeconds * 1_000
    const decisionWindowStatus = at < evidenceAt - MAXIMUM_CLOCK_SKEW_MS
      ? "CLOCK_INVALID" as const : at > expiresAtMs ||
        entry.evidenceFreshness !== "CURRENT"
        ? "STALE" as const : "CURRENT" as const
    return Object.freeze({
      reviewCandidateId: entry.reviewCandidateId,
      currentCohortId: entry.currentCohortId,
      ebayItemId: entry.ebayItemId,
      ebaySku: entry.ebaySku,
      listingTitle: entry.listingTitle,
      classification: entry.classification,
      linkageMode: entry.linkageMode,
      linkageId: entry.linkageId,
      components: entry.components,
      supplierQuantityRequired: entry.supplierQuantityRequired,
      matchSignals: entry.matchSignals,
      conflictSignals: entry.conflictSignals,
      evidenceReferences: entry.evidenceReferences,
      evidenceObservedAt: entry.evidenceObservedAt,
      evidenceMaximumAgeSeconds: entry.evidenceMaximumAgeSeconds,
      evidenceExpiresAt: new Date(expiresAtMs).toISOString(),
      evidenceDigest: entry.evidenceDigest,
      evidenceFreshness: entry.evidenceFreshness,
      decisionWindowStatus,
      decisionVersion: entry.decisionVersion,
      allowedOperatorDecisions: decisionWindowStatus === "CURRENT"
        ? entry.allowedOperatorDecisions : Object.freeze([]),
      recommendedSafeDecision: entry.recommendedSafeDecision,
      approvalEligibility: entry.approvalEligibility,
      latestDecision: decisions.get(entry.ebayItemId) ?? null,
      stockCertification: entry.stockCertification,
    })
  })
  return Object.freeze({
    success: true as const,
    contractVersion: SELLER_OS_LUNA_LINKAGE_ADMIN_REVIEW_VERSION,
    observedAt,
    reviewSet: Object.freeze({
      contractVersion: reviewSet.contractVersion,
      reviewSetId: reviewSet.reviewSetId,
      currentCohortId: reviewSet.currentCohortId,
      marketplaceId: reviewSet.marketplaceId,
      currentLiveCount: reviewSet.currentLiveCount,
      reviewSetDigest: reviewSet.reviewSetDigest,
      bounded: reviewSet.bounded,
      maximumEntries: reviewSet.maximumEntries,
      entries: Object.freeze(entries),
    }),
    csrf: input.csrf,
    safety: Object.freeze({
      humanApprovalRequired: true as const,
      automaticCertificationEnabled: false as const,
      stockEvaluated: false as const,
      productionLunaPolling: 0 as const,
      lunaStockJobsCreated: 0 as const,
      certifiedOosProduced: false as const,
      ebayWrites: 0 as const,
      marketplaceWrites: 0 as const,
      credentialsIncluded: false as const,
      cookiesIncluded: false as const,
      buyerPiiIncluded: false as const,
    }),
  })
}
