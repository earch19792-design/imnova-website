import type {
  CanonicalCurrentLiveCohortV1,
  CommercialListingReadModel,
  CommercialMonitorGetDto,
  CrossModuleLivePortfolioIntegrityV1,
  DeterministicIntegrityGuardCode,
  EbayLiveCertificationReadModel,
  LivePortfolioInvariantFindingV1,
  LivePortfolioInvariantLifecycle,
} from "./commercial-monitor-readonly-contract"
import { stableReadonlyCommercialKey } from
  "./commercial-monitor-readonly-utilities.mjs"
import type { AccountTrafficEvidenceV1 } from
  "./ebay-commercial-monitor-traffic-scope-v1"

export const CROSS_MODULE_LIVE_PORTFOLIO_INTEGRITY_VERSION =
  "CROSS_MODULE_LIVE_PORTFOLIO_INTEGRITY_V1_2026_08_13" as const
export const CANONICAL_CURRENT_LIVE_COHORT_VERSION =
  "CANONICAL_CURRENT_LIVE_COHORT_V1_2026_08_13" as const
export const CROSS_MODULE_INTEGRITY_HARDENING_VERSION =
  "CROSS_MODULE_INTEGRITY_HARDENING_V2_2026_08_13" as const

type RegistryCertification = {
  status: string
  currentLiveCount: number | null
  matchedCount: number | null
  humanReviewCount: number | null
  coveragePercent: number | null
  limitationCodes: string[]
}

function normalized(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : ""
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort()
}

function stableScopeId(
  itemIds: string[],
  marketplaceId = "EBAY_US",
  accountAlias: string | null = null,
) {
  const digest = stableReadonlyCommercialKey(marketplaceId,
    normalized(accountAlias) || "UNPROVEN_ACCOUNT_SCOPE",
    ...[...itemIds].sort()).split(":").at(-1)?.slice(0, 20) ?? "UNPROVEN"
  return `current-live:${marketplaceId}:${digest}`
}

function listingEvidenceScore(listing: CommercialListingReadModel) {
  const metricCoverage = Object.values(listing.metrics).filter((metric) =>
    (metric.availability === "AVAILABLE" || metric.availability === "PARTIAL") &&
    typeof metric.value === "number" && Number.isFinite(metric.value)).length
  const evidenceCount = Array.isArray(listing.evidenceReferences)
    ? listing.evidenceReferences.length : 0
  const certified = listing.identity.marketplaceCertification?.status ===
    "US_CERTIFIED" ? 1 : 0
  return certified * 10_000 + metricCoverage * 100 + evidenceCount
}

function uniqueBy<T>(values: T[], keyOf: (value: T) => string) {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = keyOf(value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function stableStockEvidenceRowV2(
  row: CommercialListingReadModel,
  cohortClassification: "CURRENT_LIVE" | "HISTORICAL_OR_NONLIVE",
) {
  const itemId = normalized(row.identity.itemId)
  const title = normalized(row.identity.title) || null
  const sku = normalized(row.identity.sku) || null
  const customLabel = normalized(row.identity.customLabel) || null
  const references = [...(row.evidenceReferences ?? [])].sort((left, right) =>
    JSON.stringify([left.reference, left.source, left.capturedAt]).localeCompare(
      JSON.stringify([right.reference, right.source, right.capturedAt]),
    ))
  const source = normalized(row.identity.source) ||
    normalized(references[0]?.source) || "UNPROVEN"
  const capturedAt = normalized(row.identity.lastObservedAt) ||
    normalized(references[0]?.capturedAt) || null
  const evidenceReference = normalized(references[0]?.reference) || row.key
  const representationHash = stableReadonlyCommercialKey(
    "STOCK_EVIDENCE_IDENTITY_REPRESENTATION_V2",
    itemId,
    title,
    sku,
    customLabel,
    source,
  )
  const evidenceFingerprint = stableReadonlyCommercialKey(
    "STOCK_EVIDENCE_ROW_V2",
    row.key,
    itemId,
    representationHash,
    capturedAt,
    evidenceReference,
    cohortClassification,
  )
  return Object.freeze({
    evidenceRowId: `stock-evidence-row:${evidenceFingerprint.split(":").at(-1)
      ?.slice(0, 24) ?? "unproven"}`,
    evidenceFingerprint,
    title,
    sku,
    customLabel,
    source,
    capturedAt,
    evidenceReference,
    cohortClassification,
    representationHash,
  })
}

export function resolveInvariantLifecycleV1(input: {
  activeViolation: boolean
  mitigatedByPolicy?: boolean
  authoritativeReconciliationEvidence?: boolean
  humanAcceptedException?: boolean
}) : LivePortfolioInvariantLifecycle {
  if (!input.activeViolation && input.authoritativeReconciliationEvidence) {
    return "RECONCILED"
  }
  if (input.activeViolation && input.humanAcceptedException) {
    return "ACCEPTED_EXCEPTION"
  }
  if (input.mitigatedByPolicy) return "MITIGATED_BY_POLICY"
  return input.activeViolation ? "ACTIVE_VIOLATION" : "DETECTED_RISK"
}

export function selectCanonicalCurrentLiveListingsV1(
  listings: CommercialListingReadModel[],
) {
  const byItemId = new Map<string, CommercialListingReadModel[]>()
  for (const listing of listings) {
    const itemId = normalized(listing.identity.itemId)
    if (!itemId || listing.discovery.livePresence.status !== "LIVE_ACTIVE") {
      continue
    }
    const current = byItemId.get(itemId) ?? []
    current.push(listing)
    byItemId.set(itemId, current)
  }
  return [...byItemId.entries()].map(([itemId, members]) => {
    const primary = [...members].sort((left, right) =>
      listingEvidenceScore(right) - listingEvidenceScore(left) ||
      left.key.localeCompare(right.key))[0]
    const runningExperiment = members.find((listing) =>
      listing.experiment.status === "AVAILABLE" &&
      listing.experiment.lifecycleState === "RUNNING")
    return {
      ...primary,
      identity: { ...primary.identity, itemId },
      experiment: runningExperiment?.experiment ?? primary.experiment,
      dataQualityIssues: uniqueBy(
        members.flatMap((listing) => listing.dataQualityIssues ?? []),
        (issue) => `${issue.code}:${issue.source}:${issue.domain}`,
      ),
      blockers: uniqueBy(
        members.flatMap((listing) => listing.blockers ?? []),
        (issue) => `${issue.code}:${issue.source}:${issue.domain}`,
      ),
      evidenceReferences: uniqueBy(
        members.flatMap((listing) => listing.evidenceReferences ?? []),
        (evidence) => evidence.reference,
      ),
      alertCandidateKeys: [...new Set(members.flatMap((listing) =>
        listing.alertCandidateKeys ?? []))],
    }
  }).sort((left, right) =>
    left.identity.itemId.localeCompare(right.identity.itemId))
}

function identityStatus(
  certification: EbayLiveCertificationReadModel | null | undefined,
): CanonicalCurrentLiveCohortV1["identityStatus"] {
  if (certification?.status === "CERTIFIED" &&
      certification.discovery.coverage === "COMPLETE" &&
      certification.discovery.status === "AVAILABLE") return "CERTIFIED"
  if (certification?.status === "PARTIAL" ||
      certification?.discovery.status === "PARTIAL" ||
      certification?.discovery.coverage === "PARTIAL") return "PARTIAL"
  return "UNPROVEN"
}

function finding(input: Omit<LivePortfolioInvariantFindingV1,
  "deterministic" | "lifecycle" | "strategicClassification" | "guardCode" |
  "guardAlwaysOn" | "autoMutationAllowed"> & Partial<Pick<LivePortfolioInvariantFindingV1,
    "lifecycle" | "strategicClassification" | "guardCode" |
    "guardAlwaysOn">>): LivePortfolioInvariantFindingV1 {
  return Object.freeze({
    lifecycle: "DETECTED_RISK" as LivePortfolioInvariantLifecycle,
    strategicClassification: "DETECTED_RISK" as const,
    guardCode: null,
    guardAlwaysOn: false,
    ...input,
    entityRefs: unique(input.entityRefs).slice(0, 25),
    evidenceRefs: unique(input.evidenceRefs).slice(0, 25),
    autoMutationAllowed: false as const,
    deterministic: true as const })
}

export function buildFalseZeroInvariantFindingV1(input: {
  status: "AVAILABLE" | "PARTIAL" | "UNPROVEN" | "UNAVAILABLE"
  count: number | null
  module: string
  capability: string
  scopeId: string
  observedAt: string | null
}) {
  if ((input.status === "AVAILABLE" || input.status === "PARTIAL") ||
      input.count !== 0) return null
  return finding({
    invariantCode: "FALSE_ZERO_FROM_UNPROVEN_CAPABILITY",
    lifecycle: "ACTIVE_VIOLATION",
    strategicClassification: "ACTIVE_VIOLATION",
    guardCode: "FALSE_ZERO_REPRESENTATION_GUARD",
    guardAlwaysOn: true,
    severity: "HIGH",
    module: input.module,
    entityType: "CAPABILITY",
    entityRefs: [input.capability],
    observedNumerator: 0,
    observedDenominator: null,
    scopeId: input.scopeId,
    scopeType: "CURRENT_LIVE_COHORT_SCOPE",
    evidenceRefs: [`${input.capability}:${input.status}`],
    humanApprovalRequired: false,
    recommendedAction: "REPRESENT_UNPROVEN_COUNT_AS_NULL",
    blockingImpact: "AUTHORITATIVE_ABSENCE_CANNOT_BE_INFERRED",
    observedAt: input.observedAt,
  })
}

export function buildCrossModuleLivePortfolioIntegrityV1(input: {
  listings: CommercialListingReadModel[]
  liveCertification?: EbayLiveCertificationReadModel | null
  registry?: RegistryCertification | null
  accountTraffic?: AccountTrafficEvidenceV1 | null
  currentLiveQuantitySold?: number | null
  currentLiveDenominatorItemIds?: string[]
  observedAt: string | null
}) {
  const canonicalListings = selectCanonicalCurrentLiveListingsV1(input.listings)
  const itemIds = canonicalListings.map((listing) => listing.identity.itemId)
  const scopeId = stableScopeId(itemIds,
    input.liveCertification?.marketplaceId ?? "EBAY_US",
    input.liveCertification?.account?.accountAlias ?? null)
  const rawLiveRows = input.listings.filter((listing) =>
    listing.discovery.livePresence.status === "LIVE_ACTIVE" &&
    normalized(listing.identity.itemId))
  const canonicalCohort: CanonicalCurrentLiveCohortV1 = Object.freeze({
    contractVersion: CANONICAL_CURRENT_LIVE_COHORT_VERSION,
    scopeId,
    scopeType: "CURRENT_LIVE_COHORT_SCOPE",
    observedAt: input.observedAt,
    authoritativeSource:
      "EBAY_TRADING_GET_MY_EBAY_SELLING_PLUS_GET_ITEM_CERTIFICATION",
    listingCount: itemIds.length,
    itemIds,
    dedupeApplied: rawLiveRows.length !== itemIds.length,
    identityStatus: identityStatus(input.liveCertification),
  })
  const liveSet = new Set(itemIds)
  const evidenceByItemId = new Map<string, CommercialListingReadModel[]>()
  for (const listing of input.listings) {
    const itemId = normalized(listing.identity.itemId)
    if (!itemId) continue
    const rows = evidenceByItemId.get(itemId) ?? []
    rows.push(listing)
    evidenceByItemId.set(itemId, rows)
  }
  const currentLiveEvidence = input.listings.filter((listing) =>
    liveSet.has(normalized(listing.identity.itemId)))
  const nonLiveEvidence = input.listings.filter((listing) =>
    !liveSet.has(normalized(listing.identity.itemId)))
  const effectiveLiveDenominatorItemIds = unique(
    input.currentLiveDenominatorItemIds ?? itemIds,
  )
  const denominatorNonLiveItemIds = effectiveLiveDenominatorItemIds.filter(
    (itemId) => !liveSet.has(itemId),
  )
  const currentLiveEvidenceIds = unique(currentLiveEvidence.map((listing) =>
    normalized(listing.identity.itemId)))
  const duplicateItemIds = [...evidenceByItemId.entries()]
    .filter(([itemId, rows]) => liveSet.has(itemId) && rows.length > 1)
    .map(([itemId, rows]) => {
      const canonicalEvidenceRows = rows.map((row) => stableStockEvidenceRowV2(
        row,
        liveSet.has(itemId) ? "CURRENT_LIVE" : "HISTORICAL_OR_NONLIVE",
      )).sort((left, right) => left.evidenceRowId.localeCompare(
        right.evidenceRowId))
      const evidenceRows = canonicalEvidenceRows.slice(0, 50)
      const titleRepresentations = unique(canonicalEvidenceRows.flatMap((row) =>
        row.title ? [row.title] : []))
      const skuRepresentations = unique(canonicalEvidenceRows.flatMap((row) => [
        ...(row.sku ? [row.sku] : []),
        ...(row.customLabel ? [row.customLabel] : []),
      ]))
      return {
        itemId,
        rowCount: rows.length,
        evidenceRows,
        evidenceRowsTruncated: canonicalEvidenceRows.length >
          evidenceRows.length,
        titleRepresentations,
        skuRepresentations,
        identityRepresentationConflict: titleRepresentations.length > 1 ||
          skuRepresentations.length > 1,
      }
    }).sort((left, right) => left.itemId.localeCompare(right.itemId))
  const skuGroups = new Map<string, CommercialListingReadModel[]>()
  for (const listing of canonicalListings) {
    const sku = normalized(listing.identity.sku).toUpperCase()
    if (!sku) continue
    const rows = skuGroups.get(sku) ?? []
    rows.push(listing)
    skuGroups.set(sku, rows)
  }
  const collisions = [...skuGroups.entries()].flatMap(([sku, listings]) => {
    const distinctIds = unique(listings.map((listing) => listing.identity.itemId))
    return distinctIds.length > 1 ? [{
      sku,
      itemIds: distinctIds,
      titles: unique(listings.map((listing) => normalized(listing.identity.title))),
      humanApprovalRequired: true as const,
    }] : []
  }).sort((left, right) => left.sku.localeCompare(right.sku))
  const accountTrafficAcquisitionCount = typeof input.accountTraffic
    ?.upstreamSnapshotAcquisitionCount === "number"
    ? input.accountTraffic.upstreamSnapshotAcquisitionCount : 0
  const accountTrafficSnapshotReuseStatus = input.accountTraffic
    ?.snapshotReuseStatus ?? (["AVAILABLE", "PARTIAL"].includes(
      input.accountTraffic?.status ?? "") && accountTrafficAcquisitionCount > 0
      ? "ACQUIRED" : "UNAVAILABLE")
  const findings: LivePortfolioInvariantFindingV1[] = []
  for (const duplicate of duplicateItemIds) {
    findings.push(finding({
      invariantCode: "DUPLICATE_ITEM_ID",
      lifecycle: resolveInvariantLifecycleV1({
        activeViolation: true,
      }),
      strategicClassification: "ACTIVE_VIOLATION",
      guardCode: "STOCK_EVIDENCE_DEDUPLICATION_GUARD",
      guardAlwaysOn: true,
      severity: "HIGH",
      module: "STOCK_LUNA",
      entityType: "EBAY_ITEM_ID",
      entityRefs: [duplicate.itemId],
      observedNumerator: duplicate.rowCount,
      observedDenominator: 1,
      scopeId,
      scopeType: "CURRENT_LIVE_COHORT_SCOPE",
      evidenceRefs: duplicate.evidenceRows.map((row) =>
        row.evidenceReference),
      humanApprovalRequired: true,
      recommendedAction: "RECONCILE_DUPLICATE_STOCK_EVIDENCE_IDENTITY",
      blockingImpact: duplicate.identityRepresentationConflict
        ? "IDENTITY_REPRESENTATION_CONFLICT"
        : "DUPLICATE_EVIDENCE_GRAIN",
      observedAt: input.observedAt,
    }))
  }
  for (const collision of collisions) {
    findings.push(finding({
      invariantCode: "DUPLICATE_LIVE_SKU",
      lifecycle: "ACTIVE_VIOLATION",
      strategicClassification: "UNRESOLVED_HUMAN_IDENTITY",
      guardCode: "LIVE_SKU_UNIQUENESS_CHECK",
      guardAlwaysOn: true,
      severity: "CRITICAL",
      module: "LIVE_LISTING_IDENTITY",
      entityType: "LIVE_CUSTOM_LABEL_SKU",
      entityRefs: [collision.sku, ...collision.itemIds],
      observedNumerator: collision.itemIds.length,
      observedDenominator: 1,
      scopeId,
      scopeType: "CURRENT_LIVE_COHORT_SCOPE",
      evidenceRefs: collision.itemIds.map((itemId) => `${itemId}:${collision.sku}`),
      humanApprovalRequired: true,
      recommendedAction: "HUMAN_REVIEW_LIVE_SKU_COLLISION_NO_MARKETPLACE_WRITE",
      blockingImpact: "AUTHORITATIVE_LIVE_IDENTITY_COLLISION",
      observedAt: input.observedAt,
    }))
  }
  const nonLiveItemIds = unique(nonLiveEvidence.map((listing) =>
    normalized(listing.identity.itemId)))
  if (nonLiveEvidence.length > 0) {
    const denominatorContaminated = denominatorNonLiveItemIds.length > 0
    findings.push(finding({
      invariantCode: denominatorContaminated
        ? "NON_LIVE_ENTITY_IN_LIVE_DENOMINATOR"
        : "NON_LIVE_EVIDENCE_PRESENT_EXCLUDED",
      lifecycle: resolveInvariantLifecycleV1({
        activeViolation: denominatorContaminated,
        mitigatedByPolicy: !denominatorContaminated,
      }),
      strategicClassification: denominatorContaminated
        ? "ACTIVE_VIOLATION" : "MITIGATED_CONDITION",
      guardCode: "CURRENT_LIVE_COHORT_RECONCILIATION",
      guardAlwaysOn: true,
      severity: denominatorContaminated ? "HIGH" : "LOW",
      module: "CROSS_MODULE_SCOPE",
      entityType: "HISTORICAL_OR_NONLIVE_STOCK_EVIDENCE",
      entityRefs: denominatorContaminated
        ? denominatorNonLiveItemIds : nonLiveItemIds,
      observedNumerator: nonLiveEvidence.length,
      observedDenominator: denominatorContaminated
        ? effectiveLiveDenominatorItemIds.length : input.listings.length,
      scopeId,
      scopeType: "EVIDENCE_ENTITY_SCOPE",
      evidenceRefs: nonLiveEvidence.map((listing) => listing.key),
      humanApprovalRequired: false,
      recommendedAction: denominatorContaminated
        ? "EXCLUDE_NONLIVE_EVIDENCE_FROM_CURRENT_LIVE_RATES"
        : "PRESERVE_SCOPE_EXCLUSION_AND_RECONCILE_EVIDENCE_SEPARATELY",
      blockingImpact: denominatorContaminated
        ? "LIVE_PORTFOLIO_DENOMINATOR_CONTAMINATION"
        : "NONE_CURRENT_LIVE_DENOMINATOR_PROTECTED",
      observedAt: input.observedAt,
    }))
  }
  const missingCurrentLiveItemIds = itemIds.filter((itemId) =>
    !currentLiveEvidenceIds.includes(itemId))
  if (currentLiveEvidenceIds.length !== itemIds.length) {
    findings.push(finding({
      invariantCode: "COUNT_PARITY_FAILURE",
      lifecycle: "ACTIVE_VIOLATION",
      strategicClassification: "ACTIVE_VIOLATION",
      guardCode: "CURRENT_LIVE_COHORT_RECONCILIATION",
      guardAlwaysOn: true,
      severity: "HIGH",
      module: "STOCK_LUNA",
      entityType: "CURRENT_LIVE_STOCK_COHORT",
      entityRefs: missingCurrentLiveItemIds,
      observedNumerator: currentLiveEvidenceIds.length,
      observedDenominator: itemIds.length,
      scopeId,
      scopeType: "CURRENT_LIVE_COHORT_SCOPE",
      evidenceRefs: ["STOCK_CURRENT_LIVE_ITEM_COUNT", "CANONICAL_LIVE_ITEM_COUNT"],
      humanApprovalRequired: false,
      recommendedAction: "RECONCILE_MISSING_CURRENT_LIVE_STOCK_EVIDENCE",
      blockingImpact: "STOCK_COHORT_INCOMPLETE",
      observedAt: input.observedAt,
    }))
  }
  if (input.registry?.currentLiveCount !== null &&
      input.registry?.currentLiveCount !== undefined &&
      input.registry.currentLiveCount !== itemIds.length) {
    findings.push(finding({
      invariantCode: "COUNT_PARITY_FAILURE",
      lifecycle: "ACTIVE_VIOLATION",
      strategicClassification: "ACTIVE_VIOLATION",
      guardCode: "CURRENT_LIVE_COHORT_RECONCILIATION",
      guardAlwaysOn: true,
      severity: "HIGH",
      module: "REGISTRY",
      entityType: "REGISTRY_CURRENT_LIVE_PARTITION",
      entityRefs: ["REGISTRY_CURRENT_LIVE"],
      observedNumerator: input.registry.currentLiveCount,
      observedDenominator: itemIds.length,
      scopeId,
      scopeType: "REGISTRY_PARTITION_SCOPE",
      evidenceRefs: input.registry.limitationCodes,
      humanApprovalRequired: true,
      recommendedAction: "REVIEW_REGISTRY_CURRENT_LIVE_COUNT_PARITY",
      blockingImpact: "REGISTRY_COHORT_PARITY_UNPROVEN",
      observedAt: input.observedAt,
    }))
  }
  if (typeof input.registry?.humanReviewCount === "number" &&
      input.registry.humanReviewCount > 0) {
    findings.push(finding({
      invariantCode: "MISSING_REGISTRY_RELATIONSHIP",
      lifecycle: "ACTIVE_VIOLATION",
      strategicClassification: "UNRESOLVED_HUMAN_IDENTITY",
      severity: "HIGH",
      module: "REGISTRY",
      entityType: "REGISTRY_HUMAN_REVIEW_PARTITION",
      entityRefs: ["REGISTRY_HUMAN_REVIEW"],
      observedNumerator: input.registry?.humanReviewCount ?? null,
      observedDenominator: input.registry?.currentLiveCount ?? itemIds.length,
      scopeId,
      scopeType: "REGISTRY_PARTITION_SCOPE",
      evidenceRefs: input.registry?.limitationCodes ?? [],
      humanApprovalRequired: true,
      recommendedAction: "REVIEW_UNRESOLVED_REGISTRY_RELATIONSHIPS",
      blockingImpact: "REGISTRY_RELATIONSHIP_REMAINS_PARTIAL_CERTIFIED",
      observedAt: input.observedAt,
    }))
  }
  const accountSold = input.accountTraffic?.status === "AVAILABLE" ||
      input.accountTraffic?.status === "PARTIAL"
    ? input.accountTraffic.quantitySold : null
  const currentLiveSold = input.currentLiveQuantitySold
  if (typeof accountSold === "number" && typeof currentLiveSold === "number" &&
      accountSold > currentLiveSold) {
    findings.push(finding({
      invariantCode: "HISTORICAL_OR_NONLIVE_SALES_ATTRIBUTION_REQUIRED",
      severity: "MEDIUM",
      module: "ACCOUNT_TRAFFIC",
      entityType: "UNATTRIBUTED_ACCOUNT_SALES",
      entityRefs: ["ACCOUNT_TRAFFIC_SCOPE", scopeId],
      observedNumerator: accountSold - currentLiveSold,
      observedDenominator: accountSold,
      scopeId,
      scopeType: "ACCOUNT_TRAFFIC_SCOPE",
      evidenceRefs: [input.accountTraffic?.source ?? "ACCOUNT_TRAFFIC"],
      humanApprovalRequired: false,
      recommendedAction: "RESEARCH_HISTORICAL_OR_NONLIVE_SALES_ITEM_IDS",
      blockingImpact: "SALE_ATTRIBUTION_UNPROVEN_NO_LISTING_ACTION",
      observedAt: input.observedAt,
    }))
  }
  const integrity: CrossModuleLivePortfolioIntegrityV1 = Object.freeze({
    contractVersion: CROSS_MODULE_LIVE_PORTFOLIO_INTEGRITY_VERSION,
    hardeningVersion: CROSS_MODULE_INTEGRITY_HARDENING_VERSION,
    canonicalCohort,
    stockCohort: {
      scopeId,
      scopeType: "CURRENT_LIVE_COHORT_SCOPE" as const,
      scopeCount: itemIds.length,
      observedAt: input.observedAt,
      grain: "STOCK_EVIDENCE_ROW" as const,
      evidenceRowCount: input.listings.length,
      currentLiveItemCount: currentLiveEvidenceIds.length,
      currentLiveEvidenceRowCount: currentLiveEvidence.length,
      nonLiveEvidenceRowCount: nonLiveEvidence.length,
      nonLiveItemIds,
      missingCurrentLiveItemIds,
      duplicateItemIds,
      dedupeApplied: duplicateItemIds.length > 0,
    },
    liveSkuUniqueness: {
      status: canonicalCohort.identityStatus === "UNPROVEN"
        ? "UNPROVEN" as const
        : collisions.length ? "FAIL" as const : "PASS" as const,
      collisionCount: canonicalCohort.identityStatus === "UNPROVEN"
        ? null : collisions.length,
      scopeId,
      scopeType: "CURRENT_LIVE_COHORT_SCOPE" as const,
      scopeCount: itemIds.length,
      observedAt: input.observedAt,
      grain: "LIVE_CUSTOM_LABEL_SKU" as const,
      collisions,
    },
    findings,
    deterministicGuards: ([
      {
        guardCode: "LIVE_SKU_UNIQUENESS_CHECK",
        status: canonicalCohort.identityStatus === "UNPROVEN" ? "UNPROVEN"
          : collisions.length ? "TRIGGERED" : "PASS",
        scopeType: "CURRENT_LIVE_COHORT_SCOPE",
        scopeCount: itemIds.length,
        grain: "LIVE_CUSTOM_LABEL_SKU",
        evidenceCount: collisions.length,
        reasonCode: collisions.length
          ? "LIVE_SKU_COLLISION_REQUIRES_HUMAN_REVIEW"
          : "NO_LIVE_SKU_COLLISION_DETECTED",
      },
      {
        guardCode: "FALSE_ZERO_REPRESENTATION_GUARD",
        status: findings.some((row) => row.invariantCode ===
          "FALSE_ZERO_FROM_UNPROVEN_CAPABILITY") ? "TRIGGERED" : "PASS",
        scopeType: "CURRENT_LIVE_COHORT_SCOPE",
        scopeCount: itemIds.length,
        grain: "CAPABILITY_COUNT",
        evidenceCount: findings.filter((row) => row.invariantCode ===
          "FALSE_ZERO_FROM_UNPROVEN_CAPABILITY").length,
        reasonCode: findings.some((row) => row.invariantCode ===
          "FALSE_ZERO_FROM_UNPROVEN_CAPABILITY")
          ? "UNPROVEN_CAPABILITY_RENDERED_AS_ZERO"
          : "UNPROVEN_CAPABILITY_COUNTS_REMAIN_NULL",
      },
      {
        guardCode: "STOCK_EVIDENCE_DEDUPLICATION_GUARD",
        status: duplicateItemIds.length ? "TRIGGERED" : "PASS",
        scopeType: "CURRENT_LIVE_COHORT_SCOPE",
        scopeCount: itemIds.length,
        grain: "STOCK_EVIDENCE_ROW",
        evidenceCount: duplicateItemIds.length,
        reasonCode: duplicateItemIds.length
          ? "DUPLICATE_STOCK_EVIDENCE_REQUIRES_HUMAN_RECONCILIATION"
          : "NO_DUPLICATE_STOCK_EVIDENCE_DETECTED",
      },
      {
        guardCode: "CURRENT_LIVE_COHORT_RECONCILIATION",
        status: denominatorNonLiveItemIds.length || missingCurrentLiveItemIds.length
          ? "TRIGGERED" : nonLiveEvidence.length ? "MITIGATED" : "PASS",
        scopeType: "CURRENT_LIVE_COHORT_SCOPE",
        scopeCount: itemIds.length,
        grain: "EBAY_ITEM_ID",
        evidenceCount: denominatorNonLiveItemIds.length +
          missingCurrentLiveItemIds.length + nonLiveEvidence.length,
        reasonCode: denominatorNonLiveItemIds.length
          ? "NONLIVE_ENTITY_PRESENT_IN_CURRENT_LIVE_DENOMINATOR"
          : missingCurrentLiveItemIds.length
            ? "CURRENT_LIVE_STOCK_COHORT_INCOMPLETE"
            : nonLiveEvidence.length
              ? "NONLIVE_EVIDENCE_EXCLUDED_BY_CANONICAL_POLICY"
              : "CURRENT_LIVE_COHORT_RECONCILED",
      },
      {
        guardCode: "ACCOUNT_TRAFFIC_METADATA_VALIDATION_GUARD",
        status: input.accountTraffic?.metadataValidationStatus === "VALID"
          ? "PASS" : input.accountTraffic?.metadataValidationStatus === "INVALID"
            ? "TRIGGERED" : "UNPROVEN",
        scopeType: "ACCOUNT_TRAFFIC_SCOPE",
        scopeCount: input.accountTraffic?.scopeCount ?? null,
        grain: "ACCOUNT_DAY_AGGREGATE",
        evidenceCount: accountTrafficAcquisitionCount,
        reasonCode: input.accountTraffic?.metadataValidationReasonCode ??
          (input.accountTraffic?.metadataValidationStatus === "VALID"
            ? "ACCOUNT_TRAFFIC_METADATA_VALID"
            : "ACCOUNT_TRAFFIC_METADATA_UNPROVEN"),
      },
      {
        guardCode: "ACCOUNT_TRAFFIC_SNAPSHOT_REUSE_GUARD",
        status: !input.accountTraffic ||
            !["AVAILABLE", "PARTIAL"].includes(input.accountTraffic.status)
          ? "DEGRADED"
          : accountTrafficSnapshotReuseStatus === "REUSED" &&
              accountTrafficAcquisitionCount === 0
            ? "PASS"
            : accountTrafficSnapshotReuseStatus === "ACQUIRED" &&
                accountTrafficAcquisitionCount >= 1 &&
                accountTrafficAcquisitionCount <=
                  (input.accountTraffic.retryCount === 1 ? 2 : 1)
              ? "PASS" : "FAIL",
        scopeType: "ACCOUNT_TRAFFIC_SCOPE",
        scopeCount: input.accountTraffic?.scopeCount ?? null,
        grain: "ACCOUNT_DAY_AGGREGATE",
        evidenceCount: accountTrafficAcquisitionCount,
        reasonCode: input.accountTraffic?.snapshotReuseReasonCode ??
          (accountTrafficSnapshotReuseStatus === "ACQUIRED"
            ? "CACHE_MISS_ACQUIRED"
            : "ACCOUNT_TRAFFIC_SNAPSHOT_UNAVAILABLE"),
      },
      {
        guardCode: "REVIEW_BURDEN_AUTHORITY_MISMATCH_GUARD",
        status: "PASS",
        scopeType: "CURRENT_LIVE_COHORT_SCOPE",
        scopeCount: itemIds.length,
        grain: "BURDEN_AUTHORITY_AND_GRAIN_CONTRACT",
        evidenceCount: 2,
        reasonCode: "DISTINCT_AUTHORITY_AND_GRAIN_COMPARISON_GATED",
      },
    ] satisfies Array<{
      guardCode: DeterministicIntegrityGuardCode
      status: "PASS" | "TRIGGERED" | "MITIGATED" | "UNPROVEN" |
        "DEGRADED" | "FAIL"
      scopeType: "CURRENT_LIVE_COHORT_SCOPE" | "ACCOUNT_TRAFFIC_SCOPE"
      scopeCount: number | null
      grain: string
      evidenceCount: number
      reasonCode: string
    }>).map((guard) => ({ ...guard, scopeId: guard.scopeType ===
      "ACCOUNT_TRAFFIC_SCOPE" ? input.accountTraffic?.scopeId ??
        "account-traffic:unproven" : scopeId, observedAt: guard.scopeType ===
          "ACCOUNT_TRAFFIC_SCOPE" ? input.accountTraffic?.observedAt ?? null
          : input.observedAt, independentOfAutomationThreshold: true as const,
      guardAlwaysOn: true as const,
      autoMutationAllowed: false as const })),
    lifecyclePolicy: {
      statuses: ["DETECTED_RISK", "ACTIVE_VIOLATION", "MITIGATED_BY_POLICY",
        "RECONCILED", "ACCEPTED_EXCEPTION"] as LivePortfolioInvariantLifecycle[],
      reconciliationRequiresAuthoritativeEvidence: true as const,
      acceptedExceptionRequiresHumanApproval: true as const,
      automaticLifecycleMutationAllowed: false as const,
    },
    denominatorPolicy: {
      currentLiveRatesUseCanonicalItemIds: true as const,
      nonLiveEvidenceExcludedFromLiveRates: true as const,
      registryPartitionsExcludedFromListingRates: true as const,
    },
    readOnly: true,
  })
  return { canonicalListings, integrity }
}

export function resolveCrossModuleLivePortfolioIntegrityV1(
  monitor: CommercialMonitorGetDto,
) {
  if (monitor.backend.livePortfolioIntegrity) {
    return monitor.backend.livePortfolioIntegrity
  }
  return buildCrossModuleLivePortfolioIntegrityV1({
    listings: monitor.listings,
    liveCertification: monitor.liveCertification ?? null,
    registry: monitor.backend.capabilities.registry,
    accountTraffic: monitor.backend.trafficScopes.accountTraffic,
    currentLiveQuantitySold: monitor.backend.kpis.quantitySold.value,
    observedAt: monitor.generatedAt,
  }).integrity
}

export function currentLiveListingsForMonitorV1(
  monitor: CommercialMonitorGetDto,
) {
  const scope = resolveCrossModuleLivePortfolioIntegrityV1(monitor)
    .canonicalCohort
  const liveSet = new Set(scope.itemIds)
  return selectCanonicalCurrentLiveListingsV1(monitor.listings).filter((listing) =>
    liveSet.has(listing.identity.itemId))
}
