import type { EbayLiveListing } from "./ebay-commercial-monitor-live-readonly-domain"
import type { ReadonlyRegistryListingRow } from "./commercial-monitor-readonly-repository"
import { stableReadonlyCommercialKey } from "./commercial-monitor-readonly-utilities.mjs"

export type EbayRegistryRepairDryRunCount = number | "UNPROVEN"
export type EbayRegistryRepairPreconditionStatus =
  | "PASS"
  | "FAIL"
  | "UNPROVEN"
type YesNoUnproven = "YES" | "NO" | "UNPROVEN"
export type EbayRegistryRepairDryRunFreshnessStatus =
  | "CURRENT"
  | "STALE"
  | "UNPROVEN"
export type EbayRegistryRepairDryRunRejectionReason =
  | "REGISTRY_SOURCE_UNAVAILABLE"
  | "LIVE_ENUMERATION_UNAVAILABLE"
  | "ACCOUNT_BINDING_FAILED"
  | "IDENTITY_PARTITION_INVALID"
  | "REGISTRY_PARTITION_INVALID"
  | "AMBIGUOUS_IDENTITY"
  | "PRECONDITION_UNPROVEN"
  | "STATE_CHANGED_DURING_SAME_REQUEST"
  | "RESPONSE_CONTRACT_INVALID"
  | "BUDGET_EXHAUSTED"
  | "UNPROVEN"
export type EbayRegistryRepairAmbiguityClass =
  | "REVIEWABLE_ONLY"
  | "BLOCKING_MULTIPLE_CANDIDATES"
  | "BLOCKING_CROSS_LINK"
  | "BLOCKING_DUPLICATE_AUTHORITY"
  | "BLOCKING_PARTITION_CONFLICT"
  | "BLOCKING_UNPROVEN"
  | "NONE"
export type EbayRegistryRepairFutureWriteRejectionReason =
  | "NONE"
  | "EVIDENCE_UNAVAILABLE"
  | "FUTURE_WRITE_EVIDENCE_STALE"

export type EbayRegistryRepairHumanReviewCandidate = {
  CANDIDATE_HANDLE: string
  RELATIONSHIP_TYPE: "SKU_ONLY"
  REGISTRY_ITEM_ID_CURRENTLY_LIVE: YesNoUnproven
  SKU_UNIQUE_BOTH_SIDES: YesNoUnproven
  COMPETING_REGISTRY_RELATION: YesNoUnproven
  RECOMMENDED_ACTION: "REVIEW_REQUIRED"
}

export type EbayRegistryRepairDryRun = {
  DRY_RUN_LABEL: "DRY RUN — NO CHANGES WILL BE APPLIED"
  EVIDENCE_STATUS: "AVAILABLE" | "UNPROVEN"
  DRY_RUN_PACKAGE_HANDLE: string | "UNPROVEN"
  CURRENT_LIVE_COUNT: EbayRegistryRepairDryRunCount
  CURRENT_REGISTRY_COUNT: EbayRegistryRepairDryRunCount
  CURRENT_EVIDENCE_FINGERPRINT: string | "UNPROVEN"
  DRY_RUN_FRESHNESS_STATUS: EbayRegistryRepairDryRunFreshnessStatus
  DRY_RUN_REJECTION_REASON: EbayRegistryRepairDryRunRejectionReason | null
  AMBIGUITY_CLASS: EbayRegistryRepairAmbiguityClass
  DRY_RUN_STALE_LABEL:
    | "DRY RUN CURRENT — LIVE RECHECK REQUIRED BEFORE WRITE"
    | "DRY RUN STALE — REFRESH REQUIRED"
    | "UNPROVEN"
  DRY_RUN_STATE_BOUND: YesNoUnproven
  DRY_RUN_STATE_FINGERPRINT_PRESENT: YesNoUnproven
  APPROVAL_INVALIDATES_ON_EBAY_STATE_CHANGE: YesNoUnproven
  APPROVAL_INVALIDATES_ON_REGISTRY_STATE_CHANGE: YesNoUnproven
  REPAIR_EXISTING_COUNT: EbayRegistryRepairDryRunCount
  REPAIR_PRECONDITION_STATUS: EbayRegistryRepairPreconditionStatus
  REPAIR_FIELDS_TO_CHANGE: string[]
  CREATE_NEW_COUNT: EbayRegistryRepairDryRunCount
  CREATE_PRECONDITION_STATUS: EbayRegistryRepairPreconditionStatus
  CREATE_FIELDS_TO_POPULATE: string[]
  MARK_STALE_COUNT: EbayRegistryRepairDryRunCount
  STALE_PRECONDITION_STATUS: EbayRegistryRepairPreconditionStatus
  STALE_FIELDS_TO_CHANGE: string[]
  HUMAN_REVIEW_COUNT: EbayRegistryRepairDryRunCount
  HUMAN_REVIEW_CANDIDATES: EbayRegistryRepairHumanReviewCandidate[]
  LIVE_ALREADY_MATCHED_COUNT: EbayRegistryRepairDryRunCount
  LIVE_REPAIR_EXISTING_COUNT: EbayRegistryRepairDryRunCount
  LIVE_CREATE_NEW_COUNT: EbayRegistryRepairDryRunCount
  LIVE_HUMAN_REVIEW_COUNT: EbayRegistryRepairDryRunCount
  LIVE_UNPROVEN_COUNT: EbayRegistryRepairDryRunCount
  REGISTRY_KEEP_CURRENT_COUNT: EbayRegistryRepairDryRunCount
  REGISTRY_REPAIR_EXISTING_COUNT: EbayRegistryRepairDryRunCount
  REGISTRY_MARK_STALE_COUNT: EbayRegistryRepairDryRunCount
  REGISTRY_MARK_HISTORICAL_COUNT: EbayRegistryRepairDryRunCount
  REGISTRY_HUMAN_REVIEW_COUNT: EbayRegistryRepairDryRunCount
  REGISTRY_UNPROVEN_COUNT: EbayRegistryRepairDryRunCount
  LIVE_DRY_RUN_PARTITION_VALID: "YES" | "NO"
  REGISTRY_DRY_RUN_PARTITION_VALID: "YES" | "NO"
  WRITE_OPERATION_IDEMPOTENT: "YES"
  STALE_STATE_GUARD_SUPPORTED: YesNoUnproven
  LIVE_RECHECK_REQUIRED_BEFORE_WRITE: "YES"
  PARTIAL_FAILURE_POLICY: "ABORT_BEFORE_WRITE_OR_ROLL_BACK_ENTIRE_ACCOUNT_TRANCHE"
  ROLLBACK_STRATEGY: "SINGLE_ACCOUNT_SCOPED_DATABASE_TRANSACTION"
  EXPECTED_MATCHED_AFTER_SAFE_TRANCHE: EbayRegistryRepairDryRunCount
  EXPECTED_LIVE_COUNT: EbayRegistryRepairDryRunCount
  EXPECTED_PENDING_HUMAN_REVIEW: EbayRegistryRepairDryRunCount
  EXPECTED_COVERAGE_PERCENT: number | "UNPROVEN"
  DRY_RUN_READY_FOR_APPROVAL: "YES" | "NO"
  REGISTRY_MUTATIONS: 0
  EBAY_WRITES: 0
  PRODUCT_CASE_MUTATIONS: 0
  INVENTORY_WRITES: 0
  FULFILLMENT_WRITES: 0
  OAUTH_CHANGES: 0
  VERCEL_ENV_CHANGES: 0
}

export type EbayRegistryRepairDryRunInput = {
  accountKey: string
  accountVerified: "YES"
  marketplaceId: "EBAY_US"
  observedAt: string
  liveListings: readonly EbayLiveListing[]
  registryRows: readonly ReadonlyRegistryListingRow[]
  capturedEvidenceFingerprint: string
}

export type EbayRegistryRepairEvidenceFingerprintInput = Pick<
  EbayRegistryRepairDryRunInput,
  "accountKey" | "marketplaceId" | "liveListings" | "registryRows"
>

export type EbayRegistryRepairFutureWriteFreshness = {
  WRITE_STATE_STATUS: EbayRegistryRepairDryRunFreshnessStatus
  WRITE_ALLOWED: "YES" | "NO"
  REFRESH_REQUIRED: "YES" | "NO"
  DRY_RUN_FRESHNESS_STATUS: EbayRegistryRepairDryRunFreshnessStatus
  DRY_RUN_STALE_LABEL:
    | "DRY RUN CURRENT — LIVE RECHECK REQUIRED BEFORE WRITE"
    | "DRY RUN STALE — REFRESH REQUIRED"
    | "UNPROVEN"
  FUTURE_WRITE_REJECTION_REASON: EbayRegistryRepairFutureWriteRejectionReason
}

const REPAIR_FIELDS = ["ebay_sku"]
const STALE_FIELDS = ["listing_status"]
const CREATE_FIELDS = [
  "source",
  "account_key",
  "sync_key",
  "sync_run_id",
  "sync_generation",
  "ebay_item_id",
  "listing_status",
  "title",
  "ebay_sku",
  "ebay_quantity",
  "ebay_price",
  "currency",
  "last_ebay_sync_at",
  "raw_payload",
  "updated_at",
]

function normalizedIdentity(value: unknown) {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function increment(values: Map<string, number>, key: string) {
  const current = values.get(key)
  values.set(key, current === undefined ? 1 : current + 1)
}

function evidenceCount(values: Map<string, number>, key: string) {
  const value = values.get(key)
  return value === undefined ? 0 : value
}

function opaqueHandle(namespace: string, evidence: unknown) {
  const stableKey = stableReadonlyCommercialKey(
    namespace,
    JSON.stringify(evidence),
  )
  const digestStart = stableKey.lastIndexOf(":") + 1
  const digest = stableKey.slice(digestStart, digestStart + 24)
  return `rr_${namespace}_${digest}`
}

function exactStateGuard(row: ReadonlyRegistryListingRow) {
  const id = normalizedIdentity(row.id)
  const accountKey = normalizedIdentity(row.account_key)
  const source = normalizedIdentity(row.source)
  const listingStatus = normalizedIdentity(row.listing_status)
  const updatedAt = normalizedIdentity(row.updated_at)
  const itemId = normalizedIdentity(row.ebay_item_id)
  const sku = normalizedIdentity(row.ebay_sku)
  const hasGeneration = Object.prototype.hasOwnProperty.call(
    row,
    "sync_generation",
  )
  if (
    !id || !accountKey || !source || !listingStatus || !updatedAt ||
    (!itemId && !sku) || !hasGeneration
  ) {
    return null
  }
  return [
    id,
    accountKey,
    source,
    listingStatus,
    itemId,
    sku,
    row.sync_generation,
    updatedAt,
  ]
}

export function buildEbayRegistryRepairEvidenceFingerprint(
  input: EbayRegistryRepairEvidenceFingerprintInput,
): string | "UNPROVEN" {
  const accountKey = normalizedIdentity(input.accountKey)
  if (!accountKey || input.marketplaceId !== "EBAY_US") return "UNPROVEN"
  return opaqueHandle("evidence", {
    version: "EBAY_REGISTRY_REPAIR_EVIDENCE_V1",
    accountKey,
    marketplaceId: input.marketplaceId,
    live: input.liveListings.map((listing) => JSON.stringify([
      normalizedIdentity(listing.itemId),
      normalizedIdentity(listing.sku),
      normalizedIdentity(listing.variationKey),
      normalizedIdentity(listing.customLabel),
      listing.listingState,
      listing.identityAmbiguous,
      normalizedIdentity(listing.marketplaceSite),
      listing.marketplaceCertification.status,
      listing.marketplaceCertification.source,
      listing.source,
    ])).sort(),
    registry: input.registryRows.map((row) => JSON.stringify([
      normalizedIdentity(row.id),
      normalizedIdentity(row.account_key),
      normalizedIdentity(row.source),
      normalizedIdentity(row.listing_status),
      normalizedIdentity(row.ebay_item_id),
      normalizedIdentity(row.ebay_sku),
      normalizedIdentity(row.ebay_variation_key),
      row.sync_generation,
      normalizedIdentity(row.updated_at),
    ])).sort(),
  })
}

export function evaluateEbayRegistryRepairFutureWriteFreshness(input: {
  reviewedEvidenceFingerprint: string | "UNPROVEN" | null | undefined
  currentEvidenceFingerprint: string | "UNPROVEN" | null | undefined
}): EbayRegistryRepairFutureWriteFreshness {
  const reviewed = normalizedIdentity(input.reviewedEvidenceFingerprint)
  const current = normalizedIdentity(input.currentEvidenceFingerprint)
  const safeFingerprint = /^rr_evidence_[a-f0-9]{24}$/
  if (!reviewed || !current || !safeFingerprint.test(reviewed) ||
      !safeFingerprint.test(current)) {
    return {
      WRITE_STATE_STATUS: "UNPROVEN",
      WRITE_ALLOWED: "NO",
      REFRESH_REQUIRED: "YES",
      DRY_RUN_FRESHNESS_STATUS: "UNPROVEN",
      DRY_RUN_STALE_LABEL: "UNPROVEN",
      FUTURE_WRITE_REJECTION_REASON: "EVIDENCE_UNAVAILABLE",
    }
  }
  if (reviewed !== current) {
    return {
      WRITE_STATE_STATUS: "STALE",
      WRITE_ALLOWED: "NO",
      REFRESH_REQUIRED: "YES",
      DRY_RUN_FRESHNESS_STATUS: "STALE",
      DRY_RUN_STALE_LABEL: "DRY RUN STALE — REFRESH REQUIRED",
      FUTURE_WRITE_REJECTION_REASON: "FUTURE_WRITE_EVIDENCE_STALE",
    }
  }
  return {
    WRITE_STATE_STATUS: "CURRENT",
    WRITE_ALLOWED: "YES",
    REFRESH_REQUIRED: "NO",
    DRY_RUN_FRESHNESS_STATUS: "CURRENT",
    DRY_RUN_STALE_LABEL:
      "DRY RUN CURRENT — LIVE RECHECK REQUIRED BEFORE WRITE",
    FUTURE_WRITE_REJECTION_REASON: "NONE",
  }
}

function livePreconditionsProven(listing: EbayLiveListing) {
  return listing.listingState === "ACTIVE" &&
    listing.identityAmbiguous === false &&
    listing.marketplaceCertification.status === "US_CERTIFIED"
}

function preconditionStatus(
  unprovenCount: number,
): EbayRegistryRepairPreconditionStatus {
  if (unprovenCount > 0) return "UNPROVEN"
  return "PASS"
}

function safetyContract() {
  return {
    WRITE_OPERATION_IDEMPOTENT: "YES" as const,
    LIVE_RECHECK_REQUIRED_BEFORE_WRITE: "YES" as const,
    PARTIAL_FAILURE_POLICY:
      "ABORT_BEFORE_WRITE_OR_ROLL_BACK_ENTIRE_ACCOUNT_TRANCHE" as const,
    ROLLBACK_STRATEGY:
      "SINGLE_ACCOUNT_SCOPED_DATABASE_TRANSACTION" as const,
    REGISTRY_MUTATIONS: 0 as const,
    EBAY_WRITES: 0 as const,
    PRODUCT_CASE_MUTATIONS: 0 as const,
    INVENTORY_WRITES: 0 as const,
    FULFILLMENT_WRITES: 0 as const,
    OAUTH_CHANGES: 0 as const,
    VERCEL_ENV_CHANGES: 0 as const,
  }
}

export function buildUnprovenEbayRegistryRepairDryRun():
EbayRegistryRepairDryRun {
  return {
    DRY_RUN_LABEL: "DRY RUN — NO CHANGES WILL BE APPLIED",
    EVIDENCE_STATUS: "UNPROVEN",
    DRY_RUN_PACKAGE_HANDLE: "UNPROVEN",
    CURRENT_LIVE_COUNT: "UNPROVEN",
    CURRENT_REGISTRY_COUNT: "UNPROVEN",
    CURRENT_EVIDENCE_FINGERPRINT: "UNPROVEN",
    DRY_RUN_FRESHNESS_STATUS: "UNPROVEN",
    DRY_RUN_REJECTION_REASON: "UNPROVEN",
    AMBIGUITY_CLASS: "BLOCKING_UNPROVEN",
    DRY_RUN_STALE_LABEL: "UNPROVEN",
    DRY_RUN_STATE_BOUND: "UNPROVEN",
    DRY_RUN_STATE_FINGERPRINT_PRESENT: "UNPROVEN",
    APPROVAL_INVALIDATES_ON_EBAY_STATE_CHANGE: "YES",
    APPROVAL_INVALIDATES_ON_REGISTRY_STATE_CHANGE: "YES",
    REPAIR_EXISTING_COUNT: "UNPROVEN",
    REPAIR_PRECONDITION_STATUS: "UNPROVEN",
    REPAIR_FIELDS_TO_CHANGE: [...REPAIR_FIELDS],
    CREATE_NEW_COUNT: "UNPROVEN",
    CREATE_PRECONDITION_STATUS: "UNPROVEN",
    CREATE_FIELDS_TO_POPULATE: [...CREATE_FIELDS],
    MARK_STALE_COUNT: "UNPROVEN",
    STALE_PRECONDITION_STATUS: "UNPROVEN",
    STALE_FIELDS_TO_CHANGE: [...STALE_FIELDS],
    HUMAN_REVIEW_COUNT: "UNPROVEN",
    HUMAN_REVIEW_CANDIDATES: [],
    LIVE_ALREADY_MATCHED_COUNT: "UNPROVEN",
    LIVE_REPAIR_EXISTING_COUNT: "UNPROVEN",
    LIVE_CREATE_NEW_COUNT: "UNPROVEN",
    LIVE_HUMAN_REVIEW_COUNT: "UNPROVEN",
    LIVE_UNPROVEN_COUNT: "UNPROVEN",
    REGISTRY_KEEP_CURRENT_COUNT: "UNPROVEN",
    REGISTRY_REPAIR_EXISTING_COUNT: "UNPROVEN",
    REGISTRY_MARK_STALE_COUNT: "UNPROVEN",
    REGISTRY_MARK_HISTORICAL_COUNT: "UNPROVEN",
    REGISTRY_HUMAN_REVIEW_COUNT: "UNPROVEN",
    REGISTRY_UNPROVEN_COUNT: "UNPROVEN",
    LIVE_DRY_RUN_PARTITION_VALID: "NO",
    REGISTRY_DRY_RUN_PARTITION_VALID: "NO",
    STALE_STATE_GUARD_SUPPORTED: "UNPROVEN",
    EXPECTED_MATCHED_AFTER_SAFE_TRANCHE: "UNPROVEN",
    EXPECTED_LIVE_COUNT: "UNPROVEN",
    EXPECTED_PENDING_HUMAN_REVIEW: "UNPROVEN",
    EXPECTED_COVERAGE_PERCENT: "UNPROVEN",
    DRY_RUN_READY_FOR_APPROVAL: "NO",
    ...safetyContract(),
  }
}

export function buildEbayRegistryRepairDryRun(
  input: EbayRegistryRepairDryRunInput,
): EbayRegistryRepairDryRun {
  const accountKey = normalizedIdentity(input.accountKey)
  const observedAt = normalizedIdentity(input.observedAt)
  if (!accountKey || !observedAt || !Number.isFinite(Date.parse(observedAt)) ||
      input.accountVerified !== "YES" ||
      input.marketplaceId !== "EBAY_US") {
    return buildUnprovenEbayRegistryRepairDryRun()
  }

  const liveFacts = input.liveListings.map((listing, index) => ({
    index,
    listing,
    itemId: normalizedIdentity(listing.itemId),
    sku: normalizedIdentity(listing.sku),
    variationKey: normalizedIdentity(listing.variationKey),
  }))
  const registryFacts = input.registryRows.map((row, index) => ({
    index,
    row,
    itemId: normalizedIdentity(row.ebay_item_id),
    sku: normalizedIdentity(row.ebay_sku),
    variationKey: normalizedIdentity(row.ebay_variation_key),
    guard: exactStateGuard(row),
  }))

  const liveItemCounts = new Map<string, number>()
  const liveSkuCounts = new Map<string, number>()
  const registryItemCounts = new Map<string, number>()
  const registrySkuCounts = new Map<string, number>()
  for (const live of liveFacts) {
    if (live.itemId) increment(liveItemCounts, live.itemId)
    if (live.sku) increment(liveSkuCounts, live.sku)
  }
  for (const registry of registryFacts) {
    if (registry.itemId) increment(registryItemCounts, registry.itemId)
    if (registry.sku) increment(registrySkuCounts, registry.sku)
  }
  const hasDuplicateAuthority =
    [...liveItemCounts.values()].some((count) => count > 1) ||
    [...registryItemCounts.values()].some((count) => count > 1)

  const evidenceFingerprint = buildEbayRegistryRepairEvidenceFingerprint(input)
  if (evidenceFingerprint === "UNPROVEN") {
    return buildUnprovenEbayRegistryRepairDryRun()
  }
  const capturedEvidenceFingerprint = normalizedIdentity(
    input.capturedEvidenceFingerprint,
  )
  const sameRequestEvidenceCoherent =
    capturedEvidenceFingerprint === evidenceFingerprint
  const freshnessStatus: EbayRegistryRepairDryRunFreshnessStatus =
    sameRequestEvidenceCoherent ? "CURRENT" : "UNPROVEN"
  const staleLabel = sameRequestEvidenceCoherent
    ? "DRY RUN CURRENT — LIVE RECHECK REQUIRED BEFORE WRITE" as const
    : "UNPROVEN" as const

  const itemMatchesFor = (itemId: string | null) => itemId
    ? liveFacts.filter((live) => live.itemId === itemId).map((live) => live.index)
    : []
  const skuMatchesFor = (sku: string | null) => sku
    ? liveFacts.filter((live) => live.sku === sku).map((live) => live.index)
    : []
  const liveRegistryReferences = Array.from(
    { length: liveFacts.length },
    () => new Set<number>(),
  )
  for (const registry of registryFacts) {
    const references = new Set([
      ...itemMatchesFor(registry.itemId),
      ...skuMatchesFor(registry.sku),
    ])
    for (const liveIndex of references) {
      liveRegistryReferences[liveIndex]?.add(registry.index)
    }
  }
  const hasRegistryReferencePartitionConflict = liveRegistryReferences.some(
    (references) => references.size > 1,
  )

  const liveMatched = new Set<number>()
  const liveRepair = new Set<number>()
  const liveHumanReview = new Set<number>()
  const liveUnproven = new Set<number>()
  const keepHandles: string[] = []
  const repairHandles: string[] = []
  const staleHandles: string[] = []
  const humanCandidates: EbayRegistryRepairHumanReviewCandidate[] = []
  let registryKeepCurrent = 0
  let registryRepairExisting = 0
  let registryMarkStale = 0
  const registryMarkHistorical = 0
  let registryHumanReview = 0
  let registryUnproven = 0
  let repairUnproven = 0
  let staleUnproven = 0
  let humanReviewEvidenceSafe = true
  let hasMultipleCandidates = false
  let hasCrossLink = false
  let hasActionPartitionConflict = false

  for (const registry of registryFacts) {
    const itemMatches = itemMatchesFor(registry.itemId)
    const skuMatches = skuMatchesFor(registry.sku)
    const fullMatches = itemMatches.filter((liveIndex) => {
      const live = liveFacts[liveIndex]
      return Boolean(live && live.sku === registry.sku &&
        live.variationKey === registry.variationKey)
    })
    const itemAndSkuReferenceSameLive = itemMatches.some(
      (liveIndex) => skuMatches.includes(liveIndex),
    )
    hasMultipleCandidates ||= itemMatches.length > 1 || skuMatches.length > 1
    hasCrossLink ||= itemMatches.length > 0 && skuMatches.length > 0 &&
      !itemAndSkuReferenceSameLive
    const rowAccountCorrect = registry.row.account_key === accountKey
    const rowActive = registry.row.listing_status.toLowerCase() === "active"

    if (fullMatches.length === 1 && itemMatches.length === 1 &&
        skuMatches.length === 1) {
      const live = liveFacts[fullMatches[0]]
      const safe = Boolean(live && registry.guard && rowAccountCorrect &&
        rowActive && livePreconditionsProven(live.listing) &&
        registry.itemId && registry.sku &&
        evidenceCount(liveItemCounts, registry.itemId) === 1 &&
        evidenceCount(registryItemCounts, registry.itemId) === 1 &&
        evidenceCount(liveSkuCounts, registry.sku) === 1 &&
        evidenceCount(registrySkuCounts, registry.sku) === 1 &&
        liveRegistryReferences[live.index]?.size === 1)
      if (safe && live && registry.guard) {
        registryKeepCurrent += 1
        liveMatched.add(live.index)
        keepHandles.push(opaqueHandle("keep", registry.guard))
      } else {
        registryUnproven += 1
        if (live) liveUnproven.add(live.index)
      }
      continue
    }

    if (itemMatches.length === 1 && skuMatches.length === 0) {
      const live = liveFacts[itemMatches[0]]
      const safe = Boolean(live && registry.guard && registry.itemId &&
        registry.sku && live.sku && registry.sku !== live.sku &&
        registry.variationKey === live.variationKey && rowAccountCorrect &&
        rowActive && livePreconditionsProven(live.listing) &&
        evidenceCount(liveItemCounts, registry.itemId) === 1 &&
        evidenceCount(registryItemCounts, registry.itemId) === 1 &&
        evidenceCount(registrySkuCounts, live.sku) === 0 &&
        liveRegistryReferences[live.index]?.size === 1)
      if (safe && live && registry.guard) {
        registryRepairExisting += 1
        liveRepair.add(live.index)
        repairHandles.push(opaqueHandle("repair", [
          registry.guard,
          live.sku,
          live.variationKey,
        ]))
      } else {
        registryUnproven += 1
        repairUnproven += 1
        if (live) liveUnproven.add(live.index)
      }
      continue
    }

    if (itemMatches.length === 0 && skuMatches.length === 1) {
      const live = liveFacts[skuMatches[0]]
      const reviewEvidenceSafe = Boolean(live && registry.sku &&
        rowAccountCorrect && rowActive &&
        livePreconditionsProven(live.listing))
      if (!reviewEvidenceSafe || !live || !registry.sku) {
        registryUnproven += 1
        if (live) liveUnproven.add(live.index)
        humanReviewEvidenceSafe = false
        continue
      }
      const skuUnique = evidenceCount(liveSkuCounts, registry.sku) === 1 &&
        evidenceCount(registrySkuCounts, registry.sku) === 1
      const liveReferences = liveRegistryReferences[live.index]
      const competing = liveReferences ? liveReferences.size > 1 : true
      if (!skuUnique || competing) {
        registryUnproven += 1
        liveUnproven.add(live.index)
        humanReviewEvidenceSafe = false
        continue
      }
      registryHumanReview += 1
      liveHumanReview.add(live.index)
      humanCandidates.push({
        CANDIDATE_HANDLE: opaqueHandle("review", [
          accountKey,
          registry.itemId,
          registry.sku,
          registry.variationKey,
          live.itemId,
          live.sku,
          live.variationKey,
        ]),
        RELATIONSHIP_TYPE: "SKU_ONLY",
        REGISTRY_ITEM_ID_CURRENTLY_LIVE: registry.itemId
          ? "NO"
          : "UNPROVEN",
        SKU_UNIQUE_BOTH_SIDES: skuUnique ? "YES" : "NO",
        COMPETING_REGISTRY_RELATION: competing ? "YES" : "NO",
        RECOMMENDED_ACTION: "REVIEW_REQUIRED",
      })
      continue
    }

    if (itemMatches.length === 0 && skuMatches.length === 0) {
      const safe = Boolean(registry.guard && rowAccountCorrect && rowActive &&
        (registry.itemId || registry.sku))
      if (safe && registry.guard) {
        registryMarkStale += 1
        staleHandles.push(opaqueHandle("stale", registry.guard))
      } else {
        registryUnproven += 1
        staleUnproven += 1
      }
      continue
    }

    registryUnproven += 1
    for (const liveIndex of new Set([...itemMatches, ...skuMatches])) {
      liveUnproven.add(liveIndex)
    }
  }

  for (const live of liveFacts) {
    const actionMemberships = [liveMatched, liveRepair, liveHumanReview]
      .filter((group) => group.has(live.index))
    if (liveUnproven.has(live.index) || actionMemberships.length > 1) {
      liveUnproven.add(live.index)
      hasActionPartitionConflict ||= actionMemberships.length > 1
    }
  }

  const resolvedLiveMatched = new Set([...liveMatched].filter(
    (liveIndex) => !liveUnproven.has(liveIndex),
  ))
  const resolvedLiveRepair = new Set([...liveRepair].filter(
    (liveIndex) => !liveUnproven.has(liveIndex),
  ))
  const resolvedLiveHumanReview = new Set([...liveHumanReview].filter(
    (liveIndex) => !liveUnproven.has(liveIndex),
  ))

  const liveCreate = new Set<number>()
  const createHandles: string[] = []
  let createUnproven = 0
  for (const live of liveFacts) {
    if (resolvedLiveMatched.has(live.index) ||
        resolvedLiveRepair.has(live.index) ||
        resolvedLiveHumanReview.has(live.index) ||
        liveUnproven.has(live.index)) {
      continue
    }
    const noRegistryReference = liveRegistryReferences[live.index]?.size === 0
    const safe = Boolean(live.itemId && live.sku && noRegistryReference &&
      livePreconditionsProven(live.listing) &&
      evidenceCount(liveItemCounts, live.itemId) === 1 &&
      evidenceCount(liveSkuCounts, live.sku) === 1 &&
      evidenceCount(registryItemCounts, live.itemId) === 0 &&
      evidenceCount(registrySkuCounts, live.sku) === 0)
    if (safe) {
      liveCreate.add(live.index)
      createHandles.push(opaqueHandle("create", [
        live.itemId,
        live.sku,
        live.variationKey,
        live.listing.title,
        live.listing.availableQuantity,
        live.listing.price,
        live.listing.currency,
      ]))
    } else {
      liveUnproven.add(live.index)
      createUnproven += 1
    }
  }

  const livePartitionSum = resolvedLiveMatched.size + resolvedLiveRepair.size +
    liveCreate.size + resolvedLiveHumanReview.size + liveUnproven.size
  const registryPartitionSum = registryKeepCurrent + registryRepairExisting +
    registryMarkStale + registryMarkHistorical + registryHumanReview +
    registryUnproven
  const livePartitionValid = livePartitionSum === liveFacts.length
    ? "YES" as const
    : "NO" as const
  const registryPartitionValid = registryPartitionSum === registryFacts.length
    ? "YES" as const
    : "NO" as const
  const repairStatus = !sameRequestEvidenceCoherent
    ? "UNPROVEN" as const
    : preconditionStatus(repairUnproven)
  const createStatus = !sameRequestEvidenceCoherent
    ? "UNPROVEN" as const
    : preconditionStatus(createUnproven)
  const staleStatus = !sameRequestEvidenceCoherent
    ? "UNPROVEN" as const
    : preconditionStatus(staleUnproven)
  const stateGuardsSupported = repairHandles.length === registryRepairExisting &&
    staleHandles.length === registryMarkStale
      ? "YES" as const
      : "UNPROVEN" as const
  const expectedMatchedAfterSafeTranche = resolvedLiveMatched.size +
    resolvedLiveRepair.size + liveCreate.size
  const expectedCoveragePercent = liveFacts.length > 0
    ? Number(((expectedMatchedAfterSafeTranche / liveFacts.length) * 100).toFixed(2))
    : "UNPROVEN" as const
  const basePreconditionsPass = liveUnproven.size === 0 &&
    registryUnproven === 0 &&
    registryMarkHistorical === 0 &&
    humanCandidates.length === registryHumanReview &&
    humanReviewEvidenceSafe && expectedCoveragePercent !== "UNPROVEN" &&
    repairStatus === "PASS" &&
    createStatus === "PASS" && staleStatus === "PASS" &&
    stateGuardsSupported === "YES"
  const ambiguityClass: EbayRegistryRepairAmbiguityClass =
    !sameRequestEvidenceCoherent
      ? "BLOCKING_UNPROVEN"
      : hasMultipleCandidates
        ? "BLOCKING_MULTIPLE_CANDIDATES"
        : hasCrossLink
          ? "BLOCKING_CROSS_LINK"
          : hasDuplicateAuthority
            ? "BLOCKING_DUPLICATE_AUTHORITY"
            : hasRegistryReferencePartitionConflict ||
                hasActionPartitionConflict ||
                livePartitionValid !== "YES" ||
                registryPartitionValid !== "YES"
              ? "BLOCKING_PARTITION_CONFLICT"
              : liveUnproven.size > 0 || registryUnproven > 0 ||
                  !humanReviewEvidenceSafe
                ? "BLOCKING_UNPROVEN"
                : humanCandidates.length > 0
                  ? "REVIEWABLE_ONLY"
                  : "NONE"
  const blockingAmbiguity = ambiguityClass !== "NONE" &&
    ambiguityClass !== "REVIEWABLE_ONLY"
  const rejectionReason: EbayRegistryRepairDryRunRejectionReason | null =
    !sameRequestEvidenceCoherent
      ? "STATE_CHANGED_DURING_SAME_REQUEST"
      : livePartitionValid !== "YES"
        ? "IDENTITY_PARTITION_INVALID"
        : registryPartitionValid !== "YES"
          ? "REGISTRY_PARTITION_INVALID"
        : blockingAmbiguity
          ? "AMBIGUOUS_IDENTITY"
        : !basePreconditionsPass
          ? "PRECONDITION_UNPROVEN"
          : null
  const ready = rejectionReason === null
      ? "YES" as const
      : "NO" as const
  const packageHandle = opaqueHandle("package", {
    evidenceFingerprint,
    keep: keepHandles.sort(),
    repair: repairHandles.sort(),
    create: createHandles.sort(),
    stale: staleHandles.sort(),
    review: humanCandidates.map((candidate) => candidate.CANDIDATE_HANDLE).sort(),
  })

  return {
    DRY_RUN_LABEL: "DRY RUN — NO CHANGES WILL BE APPLIED",
    EVIDENCE_STATUS: "AVAILABLE",
    DRY_RUN_PACKAGE_HANDLE: packageHandle,
    CURRENT_LIVE_COUNT: liveFacts.length,
    CURRENT_REGISTRY_COUNT: registryFacts.length,
    CURRENT_EVIDENCE_FINGERPRINT: evidenceFingerprint,
    DRY_RUN_FRESHNESS_STATUS: freshnessStatus,
    DRY_RUN_REJECTION_REASON: rejectionReason,
    AMBIGUITY_CLASS: ambiguityClass,
    DRY_RUN_STALE_LABEL: staleLabel,
    DRY_RUN_STATE_BOUND: sameRequestEvidenceCoherent ? "YES" : "NO",
    DRY_RUN_STATE_FINGERPRINT_PRESENT: "YES",
    APPROVAL_INVALIDATES_ON_EBAY_STATE_CHANGE: "YES",
    APPROVAL_INVALIDATES_ON_REGISTRY_STATE_CHANGE: "YES",
    REPAIR_EXISTING_COUNT: registryRepairExisting,
    REPAIR_PRECONDITION_STATUS: repairStatus,
    REPAIR_FIELDS_TO_CHANGE: [...REPAIR_FIELDS],
    CREATE_NEW_COUNT: liveCreate.size,
    CREATE_PRECONDITION_STATUS: createStatus,
    CREATE_FIELDS_TO_POPULATE: [...CREATE_FIELDS],
    MARK_STALE_COUNT: registryMarkStale,
    STALE_PRECONDITION_STATUS: staleStatus,
    STALE_FIELDS_TO_CHANGE: [...STALE_FIELDS],
    HUMAN_REVIEW_COUNT: humanCandidates.length,
    HUMAN_REVIEW_CANDIDATES: humanCandidates,
    LIVE_ALREADY_MATCHED_COUNT: resolvedLiveMatched.size,
    LIVE_REPAIR_EXISTING_COUNT: resolvedLiveRepair.size,
    LIVE_CREATE_NEW_COUNT: liveCreate.size,
    LIVE_HUMAN_REVIEW_COUNT: resolvedLiveHumanReview.size,
    LIVE_UNPROVEN_COUNT: liveUnproven.size,
    REGISTRY_KEEP_CURRENT_COUNT: registryKeepCurrent,
    REGISTRY_REPAIR_EXISTING_COUNT: registryRepairExisting,
    REGISTRY_MARK_STALE_COUNT: registryMarkStale,
    REGISTRY_MARK_HISTORICAL_COUNT: registryMarkHistorical,
    REGISTRY_HUMAN_REVIEW_COUNT: registryHumanReview,
    REGISTRY_UNPROVEN_COUNT: registryUnproven,
    LIVE_DRY_RUN_PARTITION_VALID: livePartitionValid,
    REGISTRY_DRY_RUN_PARTITION_VALID: registryPartitionValid,
    STALE_STATE_GUARD_SUPPORTED: stateGuardsSupported,
    EXPECTED_MATCHED_AFTER_SAFE_TRANCHE: expectedMatchedAfterSafeTranche,
    EXPECTED_LIVE_COUNT: liveFacts.length,
    EXPECTED_PENDING_HUMAN_REVIEW: resolvedLiveHumanReview.size,
    EXPECTED_COVERAGE_PERCENT: expectedCoveragePercent,
    DRY_RUN_READY_FOR_APPROVAL: ready,
    ...safetyContract(),
  }
}
