import type {
  SellerOsLunaLinkageDurableDecisionInputV1,
  SellerOsLunaLinkageDurableDecisionReceiptV1,
  SellerOsLunaLinkageReviewSetV2,
} from "./ebay-luna-linkage-approval-control-plane-v1"

type RpcResult = Readonly<{ data: unknown; error: unknown }>
type ReadResult = Readonly<{
  data: unknown
  error: unknown
  count: number | null
}>
type ReadQuery = PromiseLike<ReadResult> & Readonly<{
  eq: (column: string, value: unknown) => ReadQuery
  order: (column: string, options: Readonly<{ ascending: boolean }>) => ReadQuery
  limit: (count: number) => ReadQuery
}>
type RpcClient = Readonly<{
  rpc: (
    name: string,
    parameters?: Record<string, unknown>,
  ) => PromiseLike<RpcResult>
  from: (relation: string) => Readonly<{
    select: (
      columns: string,
      options: Readonly<{ count: "exact" }>,
    ) => ReadQuery
  }>
}>

const REVIEW_READ_COLUMNS = [
  "review_candidate_id", "review_set_id", "current_cohort_id", "account_key",
  "account_binding", "marketplace_id", "ebay_item_id", "ebay_sku",
  "listing_title", "classification", "linkage_mode", "linkage_id",
  "luna_product_id", "luna_variant_id", "luna_sku", "components",
  "supplier_quantity_required", "match_signals", "conflict_signals",
  "evidence_references", "evidence_digest", "evidence_observed_at",
  "review_observed_at", "evidence_maximum_age_seconds",
  "identity_evidence_provenance", "evidence_freshness", "decision_version",
  "approval_eligible", "is_current", "retired_at", "contract_version",
].join(",")

function firstRow(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value
  return row && typeof row === "object" && !Array.isArray(row)
    ? row as Record<string, unknown> : null
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  const row = record(value)
  if (!row) return value
  return Object.fromEntries(Object.keys(row).sort().map((key) =>
    [key, canonical(row[key])]))
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

function isoTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString() : null
}

function reviewRowMatches(
  value: unknown,
  reviewSet: SellerOsLunaLinkageReviewSetV2,
) {
  const row = record(value)
  if (!row) return false
  const entry = reviewSet.entries.find((candidate) =>
    candidate.ebayItemId === row.ebay_item_id)
  if (!entry) return false
  const scalar = entry.components.length === 1 ? entry.components[0] : null
  return row.review_candidate_id === entry.reviewCandidateId &&
    row.review_set_id === reviewSet.reviewSetId &&
    row.current_cohort_id === reviewSet.currentCohortId &&
    row.account_key === reviewSet.accountKey &&
    row.account_binding === "CANONICAL_SELLER_ACCOUNT" &&
    row.marketplace_id === reviewSet.marketplaceId &&
    row.ebay_item_id === entry.ebayItemId &&
    row.ebay_sku === entry.ebaySku &&
    row.listing_title === entry.listingTitle &&
    row.classification === entry.classification &&
    row.linkage_mode === entry.linkageMode &&
    row.linkage_id === entry.linkageId &&
    row.luna_product_id === (scalar?.lunaProductId ?? null) &&
    row.luna_variant_id === (scalar?.lunaVariantId ?? null) &&
    row.luna_sku === (scalar?.lunaSku ?? null) &&
    sameJson(row.components, entry.components) &&
    row.supplier_quantity_required ===
      (scalar?.supplierQuantityRequired ?? null) &&
    sameJson(row.match_signals, entry.matchSignals) &&
    sameJson(row.conflict_signals, entry.conflictSignals) &&
    sameJson(row.evidence_references, entry.evidenceReferences) &&
    row.evidence_digest === entry.evidenceDigest &&
    isoTimestamp(row.evidence_observed_at) === entry.evidenceObservedAt &&
    isoTimestamp(row.review_observed_at) === entry.reviewObservedAt &&
    row.evidence_maximum_age_seconds === entry.evidenceMaximumAgeSeconds &&
    sameJson(row.identity_evidence_provenance,
      entry.identityEvidenceProvenance) &&
    row.evidence_freshness === entry.evidenceFreshness &&
    row.decision_version === entry.decisionVersion &&
    row.approval_eligible === entry.approvalEligibility.eligible &&
    row.is_current === true && row.retired_at === null &&
    row.contract_version === entry.contractVersion
}

async function verifyReviewSetReadback(
  client: RpcClient,
  reviewSet: SellerOsLunaLinkageReviewSetV2,
) {
  const [reviewRead, decisionRead] = await Promise.all([
    client.from("seller_os_luna_linkage_review_candidates")
      .select(REVIEW_READ_COLUMNS, { count: "exact" })
      .eq("account_key", reviewSet.accountKey)
      .eq("marketplace_id", reviewSet.marketplaceId)
      .eq("is_current", true)
      .order("ebay_item_id", { ascending: true })
      .limit(reviewSet.entries.length + 1),
    client.from("seller_os_luna_linkage_decisions")
      .select("decision_id", { count: "exact" })
      .eq("account_key", reviewSet.accountKey)
      .eq("marketplace_id", reviewSet.marketplaceId)
      .eq("current_cohort_id", reviewSet.currentCohortId)
      .eq("review_set_id", reviewSet.reviewSetId)
      .limit(1),
  ])
  if (reviewRead.error || decisionRead.error) {
    throw new Error("LUNA_LINKAGE_REVIEW_READBACK_FAILED_CLOSED")
  }
  const reviewRows = Array.isArray(reviewRead.data) ? reviewRead.data : null
  if (!reviewRows || reviewRead.count !== reviewSet.entries.length ||
      reviewRows.length !== reviewSet.entries.length ||
      !reviewRows.every((row) => reviewRowMatches(row, reviewSet)) ||
      new Set(reviewRows.map((row) => record(row)?.ebay_item_id)).size !==
        reviewSet.entries.length) {
    throw new Error("LUNA_LINKAGE_REVIEW_READBACK_MISMATCH")
  }
  const decisionRows = Array.isArray(decisionRead.data) ? decisionRead.data : null
  if (!decisionRows || decisionRead.count !== 0 || decisionRows.length !== 0) {
    throw new Error("LUNA_LINKAGE_DECISION_COUNT_NOT_ZERO")
  }
  return Object.freeze({
    reviewSetId: reviewSet.reviewSetId,
    candidateCount: reviewSet.entries.length,
    decisionCount: 0 as const,
    readbackVerified: true as const,
  })
}

/**
 * Service-role-only adapter for the targeted P2-I01B artifact. Constructing it
 * is inert. The browser decision never supplies Luna identities, components,
 * URLs, SQL, account keys, or evidence; recordDecision sends only the exact
 * server-bound review identifiers accepted by the fixed RPC.
 */
export function createSellerOsLunaLinkageApprovalRepositoryV1(
  client: RpcClient,
) {
  return Object.freeze({
    async replaceReviewSet(reviewSet: SellerOsLunaLinkageReviewSetV2) {
      const candidates = reviewSet.entries
      const result = await client.rpc(
        "replace_seller_os_luna_linkage_review_set_v1",
        {
          p_account_key: reviewSet.accountKey,
          p_marketplace_id: reviewSet.marketplaceId,
          p_current_cohort_id: reviewSet.currentCohortId,
          p_review_set_id: reviewSet.reviewSetId,
          p_contract_version: reviewSet.contractVersion,
          p_candidates: candidates,
        },
      )
      if (result.error) {
        throw new Error("LUNA_LINKAGE_REVIEW_PERSISTENCE_FAILED_CLOSED")
      }
      const row = firstRow(result.data)
      if (!row || !new Set(["CREATED", "IDEMPOTENT_SUCCESS"])
        .has(String(row.outcome)) ||
        row.reviewSetId !== reviewSet.reviewSetId ||
        row.candidateCount !== reviewSet.entries.length) {
        throw new Error("LUNA_LINKAGE_REVIEW_PERSISTENCE_RECEIPT_INVALID")
      }
      const readback = await verifyReviewSetReadback(client, reviewSet)
      return Object.freeze({
        status: row.outcome as "CREATED" | "IDEMPOTENT_SUCCESS",
        reviewSetId: reviewSet.reviewSetId,
        candidateCount: reviewSet.entries.length,
        decisionCount: readback.decisionCount,
        readbackVerified: readback.readbackVerified,
      })
    },

    async recordDecision(
      decision: SellerOsLunaLinkageDurableDecisionInputV1,
    ): Promise<SellerOsLunaLinkageDurableDecisionReceiptV1> {
      const result = await client.rpc(
        "record_seller_os_luna_linkage_decision_v1",
        {
          p_review_candidate_id: decision.reviewCandidateId,
          p_review_set_id: decision.reviewSetId,
          p_current_cohort_id: decision.currentCohortId,
          p_ebay_item_id: decision.ebayItemId,
          p_evidence_digest: decision.evidenceDigest,
          p_decision: decision.decision,
          p_decision_version: decision.decisionVersion,
          p_decision_at: decision.decisionAt,
          p_decision_reference: decision.decisionReference,
          p_actor_user_id: decision.actorUserId,
        },
      )
      if (result.error) {
        throw new Error("LUNA_LINKAGE_DECISION_PERSISTENCE_FAILED_CLOSED")
      }
      const row = firstRow(result.data)
      const outcome = String(row?.outcome ?? "")
      if (!row || !new Set([
        "CREATED", "IDEMPOTENT_SUCCESS",
        "CONFLICT_REQUIRES_NEW_DECISION_VERSION",
      ]).has(outcome) || row.decisionReference !== decision.decisionReference) {
        throw new Error("LUNA_LINKAGE_DECISION_PERSISTENCE_RECEIPT_INVALID")
      }
      return Object.freeze({
        outcome: outcome as SellerOsLunaLinkageDurableDecisionReceiptV1["outcome"],
        decisionReference: decision.decisionReference,
      })
    },
  })
}
