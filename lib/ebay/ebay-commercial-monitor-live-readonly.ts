import type { SupabaseClient } from "@supabase/supabase-js"

import { createHash } from "node:crypto"

import {
  reconcileEbayTrafficAnalyticsReport,
} from "./ebay-commercial-analytics-domain"
import {
  assertEbayMonitorReadonlyRequest,
  EBAY_MONITOR_LIVE_READONLY_CONTRACT_VERSION,
  normalizeLiveDiscoveryCoverage,
  parseEbayInventoryItemsPage,
  parseSafeEbayInventoryErrorMetadata,
  parseEbayTradingGetItemMarketplace,
  parseEbayTradingGetItemPrimaryImage,
  parseEbayTradingGetMyeBaySellingPage,
  parseEbayTradingGetSellerListPage,
  parseEbayTradingGetUser,
  sanitizeLiveEbayOrders,
  type EbayLiveListing,
  type EbayItemMarketplaceCertificationStatus,
  type EbayMonitorReadonlyCallEvidence,
  type EbayMonitorReadonlyOperation,
  type SafeEbayInventoryErrorMetadata,
  type SafeLiveEbayOrder,
} from "./ebay-commercial-monitor-live-readonly-domain"
import {
  ebayProductionAccountFingerprint,
  getEbaySellerAccountScopeConfiguration,
  getEbayProductionIdentityBindingConfiguration,
  normalizeEbaySellerAccountAlias,
} from "./ebay-seller-account-scope"
import {
  buildEbaySellerTrafficReportUrl,
  EBAY_SELLER_TRAFFIC_METRICS,
  normalizeEbaySellerTrafficRows,
} from "./ebay-seller-traffic-report"
import {
  summarizeAccountTrafficV1,
  unavailableAccountTrafficV1,
  type AccountTrafficEvidenceV1,
} from "./ebay-commercial-monitor-traffic-scope-v1"
import {
  readRegistry,
  readRegistrySyncKeyCollisions,
  type ReadonlyRegistryListingRow,
} from "./commercial-monitor-readonly-repository"
import {
  buildEbayRegistryRepairCreateSyncKey,
  buildEbayRegistryRepairEvidenceFingerprint,
  buildEbayRegistryRepairDryRun,
  buildUnprovenEbayRegistryRepairDryRun,
  type EbayRegistryRepairDryRun,
} from "./ebay-registry-repair-dry-run"
import { getSupabaseAdminClient } from "../supabase-admin"

const EBAY_API_ORIGIN = "https://api.ebay.com"
const OAUTH_ENDPOINT = `${EBAY_API_ORIGIN}/identity/v1/oauth2/token`
const TRADING_ENDPOINT = `${EBAY_API_ORIGIN}/ws/api.dll`
const INVENTORY_ITEMS_ENDPOINT =
  `${EBAY_API_ORIGIN}/sell/inventory/v1/inventory_item`
const INVENTORY_OFFERS_ENDPOINT =
  `${EBAY_API_ORIGIN}/sell/inventory/v1/offer`
const FULFILLMENT_ORDERS_ENDPOINT =
  `${EBAY_API_ORIGIN}/sell/fulfillment/v1/order`
const MARKETPLACE_ID = "EBAY_US"
const TRADING_COMPATIBILITY_LEVEL = "1423"
const REQUEST_TIMEOUT_MS = 7_500
const REQUEST_BUDGET_MS = 24_000
const REQUEST_MAX_CALLS = 60
const SELLER_WIDE_PAGE_SIZE = 200
const SELLER_WIDE_MAX_PAGES = 125
const INVENTORY_MAX_SKUS = 100
const ANALYTICS_MAX_LISTINGS = 400
const FULFILLMENT_MAX_PAGES = 10
const GET_ITEM_DOWNSTREAM_CALL_RESERVE = 9
const GET_ITEM_DOWNSTREAM_TIME_RESERVE_MS = 6_000
const GET_ITEM_MARKETPLACE_MAX_UNIQUE_ITEMS = 32
const GET_ITEM_MARKETPLACE_CONCURRENCY = 4
const INVENTORY_CONSUMER_DIAGNOSTIC_MAX_CALLS = 8
const INVENTORY_CONSUMER_DIAGNOSTIC_DEADLINE_MS = 21_000
const INVENTORY_CONSUMER_ERROR_BODY_MAX_BYTES = 16_384

const BASE_SCOPE = "https://api.ebay.com/oauth/api_scope"
const INVENTORY_READONLY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly"
const ACCOUNT_READONLY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly"
const ANALYTICS_READONLY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly"
const FULFILLMENT_READONLY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly"

type JsonRecord = Record<string, unknown>
type FetchLike = typeof fetch
type Clock = () => Date
type RequestBudget = {
  deadlineAt: number
  callsRemaining: number
  maximumCalls: number
  callsStarted: number
}

const requestBudgets = new WeakMap<
  EbayMonitorReadonlyCallEvidence[],
  RequestBudget
>()
const callEvidenceByResponse = new WeakMap<
  Response,
  EbayMonitorReadonlyCallEvidence
>()
let cumulativeAccountTrafficSnapshotAcquisitionCount = 0
export const ACCOUNT_TRAFFIC_SNAPSHOT_REUSE_MAX_AGE_MS = 5 * 60 * 1_000

type CachedAccountTrafficSnapshotV1 = {
  expiresAt: number
  evidence: AccountTrafficEvidenceV1
}

// The cache is partitioned by the injected fetch boundary so test/runtime
// identities cannot contaminate one another. The inner key binds the snapshot
// to the certified seller identity, marketplace and reporting window.
const accountTrafficSnapshotsByFetch = new WeakMap<FetchLike,
  Map<string, CachedAccountTrafficSnapshotV1>>()
const accountTrafficRateLimitBackoffsByFetch = new WeakMap<FetchLike,
  Map<string, number>>()
const ACCOUNT_TRAFFIC_429_FALLBACK_BACKOFF_MS = 60_000

function accountTrafficRetryAfterMilliseconds(
  value: string | null,
  nowMs: number,
) {
  const normalized = value?.trim() ?? ""
  if (/^\d+$/.test(normalized)) {
    return Math.min(Number(normalized), 7 * 24 * 60 * 60) * 1_000
  }
  const parsedDate = Date.parse(normalized)
  return Number.isFinite(parsedDate) && parsedDate > nowMs
    ? Math.min(parsedDate - nowMs, 7 * 24 * 60 * 60 * 1_000)
    : null
}

function accountTrafficSnapshotCacheV1(fetchImpl: FetchLike) {
  const existing = accountTrafficSnapshotsByFetch.get(fetchImpl)
  if (existing) return existing
  const created = new Map<string, CachedAccountTrafficSnapshotV1>()
  accountTrafficSnapshotsByFetch.set(fetchImpl, created)
  return created
}

function accountTrafficRateLimitBackoffCacheV1(fetchImpl: FetchLike) {
  const existing = accountTrafficRateLimitBackoffsByFetch.get(fetchImpl)
  if (existing) return existing
  const created = new Map<string, number>()
  accountTrafficRateLimitBackoffsByFetch.set(fetchImpl, created)
  return created
}

export type EbayMonitorScopeClassification =
  | "READ_REQUIRED"
  | "READ_AVAILABLE"
  | "WRITE_CAPABLE_BUT_NOT_USED"
  | "MISSING"

export type EbayMonitorScopeEvidence = {
  scope: string
  classifications: EbayMonitorScopeClassification[]
  evidenceOperation: string | null
}

export type EbayLiveAnalyticsObservation = {
  itemId: string
  impressions: number | null
  totalListingViews: number | null
  externalViews: number | null
  transactions: number | null
  reportedCtr: number | null
  calculatedCtr: number | null
  calculatedCtrNumerator: number | null
  calculatedCtrDenominator: number | null
  reportedConversion: number | null
  applicable: {
    impressions: boolean
    totalListingViews: boolean
    externalViews: boolean
    transactions: boolean
    reportedCtr: boolean
    calculatedCtr: boolean
    reportedConversion: boolean
  }
  windowStart: string
  windowEnd: string
  observedAt: string
  sourceUpdatedAt: string | null
  lastUpdatedDate: string | null
  completeness: "COMPLETE" | "PARTIAL"
  freshnessStatus: string
  source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT"
}

export type EbayLiveInventoryResult = {
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "ERROR"
  observedAt: string | null
  inventorySkuCount: number | null
  publishedListingIds: string[]
  publishedOffers: Array<{ itemId: string; sku: string }>
  gapCodes: string[]
}

export type EbayLiveInventoryRepresentation = {
  status: "COMPLETE" | "PARTIAL" | "UNPROVEN"
  classificationGrain: "ITEM_SKU"
  representedCount: number | null
  notRepresentedCount: number | null
  identityUnresolvedCount: number | null
  sourceUnprovenCount: number | null
}

export type EbaySellerWideEnumerationIdentity = {
  itemId: string
  sku: string | null
  variationKey: string | null
  identityAmbiguous: boolean
  representationEligible: false
  analyticsEligible: false
}

export type EbayMarketplaceCertificationCounters = {
  sellerWideItemsReported: number | null
  sellerWideItemsParsed: number | null
  sellerWideItemsMarketplaceCertifiedUs: number | null
  sellerWideItemsMarketplaceCertifiedNonUs: number | null
  sellerWideItemsMarketplaceUnresolved: number | null
  sellerWideItemsMarketplaceError: number | null
  sellerWideItemsMarketplaceBudgetExhausted: number | null
  sellerWideItemsMarketplaceItemIdMismatch: number | null
  sellerWideItemsRepresented: number | null
}

export type EbayMonitorOAuthSafeErrorCategory =
  | "INVALID_SCOPE"
  | "INVALID_GRANT"
  | "INVALID_CLIENT"
  | "INVALID_REQUEST"
  | "UNSUPPORTED_GRANT_TYPE"
  | "OAUTH_ERROR_UNCLASSIFIED"

export type EbayRegistryRuntimeReadStatus =
  | "AVAILABLE"
  | "MISSING"
  | "FAILED"

export type EbayRegistryRuntimeSourceStatus =
  | "AVAILABLE"
  | "CONFIGURATION_MISSING"
  | "READ_FAILED"

export type EbayRegistryRuntimeEnumerationStatus =
  | "AVAILABLE"
  | "AUTH_UNAVAILABLE"
  | "READ_FAILED"

export type EbayRegistryRuntimeCoverageCount = number | "UNPROVEN"

export type EbayManualListingDiscoveryRuntimeResult =
  | "PASS"
  | "PARTIAL"
  | "FAIL"
  | "UNPROVEN"

export type EbayRegistryIdentityRootCause =
  | "ITEM_ID_MISMATCH"
  | "SKU_MISMATCH"
  | "VARIATION_KEY_MISMATCH"
  | "COMPOSITE_KEY_OVERSTRICT"
  | "LEGACY_IDENTITY_CONTRACT"
  | "REGISTRY_ROWS_HISTORICAL_ONLY"
  | "MIXED_CAUSES"
  | "UNPROVEN"

export type EbaySafeBackfillWithoutDuplication =
  | "YES"
  | "NO"
  | "UNPROVEN"

export type EbayRegistryItemIdOnlyLifecycleClass =
  | "CURRENT_LISTING_STALE_REGISTRY_SKU"
  | "CONFLICTED_IDENTITY"
  | "HISTORICAL_RELATION"
  | "UNPROVEN"

export type EbayRegistrySkuOnlyLifecycleClass =
  | "RELIST_CANDIDATE"
  | "STALE_REGISTRY_ITEM_ID"
  | "SKU_REUSE_RISK"
  | "CONFLICTED_IDENTITY"
  | "UNPROVEN"

type EbayRegistryTopologyBucket =
  | "FULL_MATCH"
  | "ITEM_ID_ONLY_MATCH"
  | "SKU_ONLY_MATCH"
  | "ITEM_ID_AND_SKU_MATCH_DIFFERENT_LIVE_ROWS"
  | "MULTIPLE_ITEM_ID_CANDIDATES"
  | "MULTIPLE_SKU_CANDIDATES"
  | "NO_STABLE_IDENTIFIER_OVERLAP"
  | "UNPROVEN"

type EbayLivePresenceIndicator = "YES" | "NO" | "UNPROVEN"

export type EbayRegistryCoverageDiagnostic = {
  REGISTRY_RUNTIME_CONFIG: EbayRegistryRuntimeReadStatus
  SUPABASE_URL_PRESENT: "YES" | "NO"
  SUPABASE_SERVICE_ROLE_PRESENT: "YES" | "NO"
  REGISTRY_SOURCE_RUNTIME_STATUS: EbayRegistryRuntimeSourceStatus
  REGISTRY_RECORD_COUNT: EbayRegistryRuntimeCoverageCount
  LIVE_ENUMERATION_RUNTIME_STATUS: EbayRegistryRuntimeEnumerationStatus
  LIVE_EBAY_LISTING_COUNT: EbayRegistryRuntimeCoverageCount
  REGISTRY_LIFECYCLE_FIELDS: string
  REGISTRY_PROVENANCE_FIELDS: string
  REGISTRY_HAS_ACTIVE_STATE: "YES" | "NO" | "UNPROVEN"
  REGISTRY_HAS_LAST_SEEN_SIGNAL: "YES" | "NO" | "UNPROVEN"
  REGISTRY_HAS_PRODUCT_CASE_LINK: "YES" | "NO" | "UNPROVEN"
  REGISTRY_HAS_SOURCE_ORIGIN: "YES" | "NO" | "UNPROVEN"
  REGISTRY_MATCHED_COUNT: EbayRegistryRuntimeCoverageCount
  REGISTRY_MISSING_COUNT: EbayRegistryRuntimeCoverageCount
  REGISTRY_ORPHANED_COUNT: EbayRegistryRuntimeCoverageCount
  REGISTRY_AMBIGUOUS_COUNT: EbayRegistryRuntimeCoverageCount
  REGISTRY_COVERAGE_PERCENT: number | "UNPROVEN"
  LIVE_WITH_ITEM_ID_COUNT: EbayRegistryRuntimeCoverageCount
  LIVE_WITH_SKU_COUNT: EbayRegistryRuntimeCoverageCount
  LIVE_WITH_VARIATION_KEY_COUNT: EbayRegistryRuntimeCoverageCount
  LIVE_WITH_COMPLETE_COMPOSITE_IDENTITY_COUNT: EbayRegistryRuntimeCoverageCount
  REGISTRY_WITH_ITEM_ID_COUNT: EbayRegistryRuntimeCoverageCount
  REGISTRY_WITH_SKU_COUNT: EbayRegistryRuntimeCoverageCount
  REGISTRY_WITH_VARIATION_KEY_COUNT: EbayRegistryRuntimeCoverageCount
  REGISTRY_WITH_COMPLETE_COMPOSITE_IDENTITY_COUNT: EbayRegistryRuntimeCoverageCount
  ITEM_ID_EXACT_OVERLAP_COUNT: EbayRegistryRuntimeCoverageCount
  SKU_EXACT_OVERLAP_COUNT: EbayRegistryRuntimeCoverageCount
  VARIATION_KEY_EXACT_OVERLAP_COUNT: EbayRegistryRuntimeCoverageCount
  ITEM_ID_PLUS_SKU_OVERLAP_COUNT: EbayRegistryRuntimeCoverageCount
  ITEM_ID_PLUS_VARIATION_OVERLAP_COUNT: EbayRegistryRuntimeCoverageCount
  SKU_PLUS_VARIATION_OVERLAP_COUNT: EbayRegistryRuntimeCoverageCount
  FULL_COMPOSITE_OVERLAP_COUNT: EbayRegistryRuntimeCoverageCount
  REGISTRY_CURRENT_IDENTITY_COUNT: EbayRegistryRuntimeCoverageCount
  REGISTRY_LEGACY_IDENTITY_COUNT: EbayRegistryRuntimeCoverageCount
  REGISTRY_INCOMPLETE_IDENTITY_COUNT: EbayRegistryRuntimeCoverageCount
  REGISTRY_HISTORICAL_ONLY_COUNT: EbayRegistryRuntimeCoverageCount
  REGISTRY_IDENTITY_UNPROVEN_COUNT: EbayRegistryRuntimeCoverageCount
  REGISTRY_IDENTITY_ROOT_CAUSE: EbayRegistryIdentityRootCause
  SAFE_BACKFILL_WITHOUT_DUPLICATION: EbaySafeBackfillWithoutDuplication
  LIVE_PARTITION_VALID: "YES" | "NO"
  REGISTRY_PARTITION_VALID: "YES" | "NO"
  REGISTRY_FULL_MATCH_ROWS: EbayRegistryRuntimeCoverageCount
  REGISTRY_ITEM_ID_ONLY_ROWS: EbayRegistryRuntimeCoverageCount
  ITEM_ID_ONLY_ROW_COUNT: EbayRegistryRuntimeCoverageCount
  REGISTRY_SKU_ONLY_ROWS: EbayRegistryRuntimeCoverageCount
  REGISTRY_CROSS_LINKED_ROWS: EbayRegistryRuntimeCoverageCount
  REGISTRY_MULTIPLE_ITEM_ID_CANDIDATE_ROWS: EbayRegistryRuntimeCoverageCount
  REGISTRY_MULTIPLE_SKU_CANDIDATE_ROWS: EbayRegistryRuntimeCoverageCount
  REGISTRY_NO_STABLE_OVERLAP_ROWS: EbayRegistryRuntimeCoverageCount
  REGISTRY_TOPOLOGY_UNPROVEN_ROWS: EbayRegistryRuntimeCoverageCount
  REGISTRY_TOPOLOGY_PARTITION_VALID: "YES" | "NO"
  LIVE_REFERENCED_BY_REGISTRY_ITEM_ID_COUNT: EbayRegistryRuntimeCoverageCount
  LIVE_REFERENCED_BY_REGISTRY_SKU_COUNT: EbayRegistryRuntimeCoverageCount
  LIVE_REFERENCED_BY_BOTH_SAME_REGISTRY_ROW_COUNT: EbayRegistryRuntimeCoverageCount
  LIVE_REFERENCED_BY_CONFLICTING_REGISTRY_ROWS_COUNT:
    EbayRegistryRuntimeCoverageCount
  LIVE_WITH_NO_STABLE_REGISTRY_REFERENCE_COUNT:
    EbayRegistryRuntimeCoverageCount
  CROSS_LINK_CONFLICT_COUNT: EbayRegistryRuntimeCoverageCount
  ITEM_ID_ONLY_ITEM_ID_UNIQUE_BOTH_SIDES: "YES" | "NO" | "UNPROVEN"
  ITEM_ID_ONLY_REGISTRY_SKU_MATCHES_ANY_OTHER_LIVE_LISTING:
    "YES" | "NO" | "UNPROVEN"
  ITEM_ID_ONLY_LIVE_SKU_MATCHES_ANY_OTHER_REGISTRY_ROW:
    "YES" | "NO" | "UNPROVEN"
  ITEM_ID_ONLY_ACCOUNT_MARKETPLACE_COMPATIBLE:
    "YES" | "NO" | "UNPROVEN"
  ITEM_ID_ONLY_LIFECYCLE_CLASS:
    EbayRegistryItemIdOnlyLifecycleClass | "UNPROVEN"
  ITEM_ID_ONLY_DETERMINISTIC_RELINK_POSSIBLE:
    "YES" | "NO" | "UNPROVEN"
  SKU_ONLY_REGISTRY_ITEM_ID_NOT_LIVE_COUNT: EbayRegistryRuntimeCoverageCount
  SKU_ONLY_UNIQUE_SKU_BOTH_SIDES_COUNT: EbayRegistryRuntimeCoverageCount
  SKU_ONLY_NO_COMPETING_REGISTRY_RELATION_COUNT:
    EbayRegistryRuntimeCoverageCount
  SKU_ONLY_RELIST_CANDIDATE_COUNT: EbayRegistryRuntimeCoverageCount
  SKU_ONLY_STALE_REGISTRY_ITEM_ID_COUNT: EbayRegistryRuntimeCoverageCount
  SKU_ONLY_SKU_REUSE_RISK_COUNT: EbayRegistryRuntimeCoverageCount
  SKU_ONLY_CONFLICTED_IDENTITY_COUNT: EbayRegistryRuntimeCoverageCount
  SKU_ONLY_UNPROVEN_COUNT: EbayRegistryRuntimeCoverageCount
  SKU_ONLY_DETERMINISTIC_RELINK_CANDIDATE_COUNT:
    EbayRegistryRuntimeCoverageCount
  NO_OVERLAP_HISTORICAL_OR_STALE_COUNT: EbayRegistryRuntimeCoverageCount
  NO_OVERLAP_CURRENT_IDENTITY_DRIFT_COUNT: EbayRegistryRuntimeCoverageCount
  NO_OVERLAP_UNRELATED_COUNT: EbayRegistryRuntimeCoverageCount
  NO_OVERLAP_UNPROVEN_COUNT: EbayRegistryRuntimeCoverageCount
  REGISTRY_STALE_ACTIVE_ROWS_PRESENT: "YES" | "NO" | "UNPROVEN"
  CERTIFIED_EXISTING_RELATIONSHIP_COUNT: EbayRegistryRuntimeCoverageCount
  CERTIFIED_RELINK_CANDIDATE_COUNT: EbayRegistryRuntimeCoverageCount
  UNRESOLVED_RELATIONSHIP_COUNT: EbayRegistryRuntimeCoverageCount
  TRUE_NEW_ENTRY_CANDIDATE_COUNT: EbayRegistryRuntimeCoverageCount
  PLAN_RELINK_EXISTING_COUNT: EbayRegistryRuntimeCoverageCount
  PLAN_CREATE_NEW_COUNT: EbayRegistryRuntimeCoverageCount
  PLAN_MARK_STALE_OR_HISTORICAL_COUNT: EbayRegistryRuntimeCoverageCount
  PLAN_REQUIRE_HUMAN_REVIEW_COUNT: EbayRegistryRuntimeCoverageCount
  REGISTRY_REPAIR_PLAN_CERTIFIED: "YES" | "NO" | "UNPROVEN"
  AUTOMATED_MUTATION_SAFE: "YES" | "NO" | "UNPROVEN"
  ITEM_ID_ANCHORED_RELINK_CANDIDATE_COUNT: EbayRegistryRuntimeCoverageCount
  SKU_ANCHORED_RELINK_CANDIDATE_COUNT: EbayRegistryRuntimeCoverageCount
  CONFLICTED_RELINK_CANDIDATE_COUNT: EbayRegistryRuntimeCoverageCount
  NO_SAFE_RELINK_CANDIDATE_COUNT: EbayRegistryRuntimeCoverageCount
  SAFE_RELINK_CANDIDATE_COUNT: EbayRegistryRuntimeCoverageCount
  SAFE_AUTOMATED_RELINK: "YES" | "NO" | "UNPROVEN"
  LIVE_NEW_REGISTRY_ENTRY_CANDIDATE_COUNT: EbayRegistryRuntimeCoverageCount
  SAFE_NEW_ENTRY_BACKFILL_POSSIBLE: "YES" | "NO" | "UNPROVEN"
  VARIATION_KEY_REQUIRED_FOR_NON_VARIATION_LISTING:
    EbayLivePresenceIndicator
  EMPTY_VARIATION_IS_CANONIC_FOR_NON_VARIATION_LISTING:
    EbayLivePresenceIndicator
  VARIATION_SEMANTICS_CAUSE_CURRENT_ZERO_MATCH:
    "YES" | "NO" | "UNPROVEN"
  MANUAL_LISTING_RUNTIME_AUTODISCOVERY: EbayManualListingDiscoveryRuntimeResult
  IS_EBAY_ITEM_ID_AUTHORITATIVE_FOR_LISTING_IDENTITY: "YES" | "NO" | "UNPROVEN"
  IS_SKU_ALLOWED_AS_RELIST_CONTINUITY_SIGNAL:
    "YES" | "NO" | "UNPROVEN"
}

type RegistryRepairRuntimeEvidence = {
  accountKey: string
  observedAt: string
  liveListings: EbayLiveListing[]
  registryRows: ReadonlyRegistryListingRow[]
  syncKeyLookupStatus: "AVAILABLE"
  existingRegistrySyncKeys: string[]
}

type RegistryRuntimeReadInput = {
  environment?: NodeJS.ProcessEnv
  fetchImpl?: FetchLike
  clock?: Clock
  startedAt?: number
  supabaseClient?: Pick<SupabaseClient, "from">
  captureRegistryRepairEvidence?: (
    evidence: RegistryRepairRuntimeEvidence,
  ) => void
  captureRegistryRepairExecutionPlan?: NonNullable<
    Parameters<typeof buildEbayRegistryRepairDryRun>[1]
  >
  readRegistryRepairEvidenceSnapshot?: () => Promise<
    RegistryRepairRuntimeEvidence | undefined
  >
}

function computeRegistryCoveragePercent(
  matched: number,
  liveCount: number,
) {
  if (liveCount <= 0) {
    return liveCount === 0 ? 100 : 0
  }
  return Number(((matched / liveCount) * 100).toFixed(2))
}

function manualListingDiscoveryResult(input: {
  sourceStatus: EbayRegistryRuntimeSourceStatus
  liveStatus: EbayRegistryRuntimeEnumerationStatus
}) : EbayManualListingDiscoveryRuntimeResult {
  if (
    input.sourceStatus === "READ_FAILED" ||
    input.liveStatus === "READ_FAILED"
  ) {
    return "FAIL"
  }
  if (
    input.sourceStatus === "AVAILABLE" &&
    input.liveStatus === "AVAILABLE"
  ) {
    return "PASS"
  }
  return "PARTIAL"
}

function hasRequiredTradingCredentials(environment: NodeJS.ProcessEnv) {
  const credentials = generalCredentials(environment)
  const identity = getEbayProductionIdentityBindingConfiguration(environment)
  return Boolean(
    credentials.clientId &&
    credentials.clientSecret &&
    credentials.refreshToken &&
    identity.bound,
  )
}

export async function diagnoseRegistryCoverageRuntime(
  input: RegistryRuntimeReadInput = {},
): Promise<EbayRegistryCoverageDiagnostic> {
  const environment = input.environment ?? process.env
  const fetchImpl = input.fetchImpl ?? fetch
  const clock = input.clock ?? (() => new Date())
  const startedAt = input.startedAt ?? Date.now()
  const configuration = getEbaySellerAccountScopeConfiguration(environment)
  const supabaseUrlPresent = isPresentAndTrimmed(
    environment.NEXT_PUBLIC_SUPABASE_URL,
  )
  const supabaseServiceRolePresent = isPresentAndTrimmed(
    environment.SUPABASE_SERVICE_ROLE_KEY,
  )
  let runtimeConfig: EbayRegistryRuntimeReadStatus =
    supabaseUrlPresent && supabaseServiceRolePresent
      ? "AVAILABLE"
      : "MISSING"
  const result: EbayRegistryCoverageDiagnostic = {
    REGISTRY_RUNTIME_CONFIG: runtimeConfig,
    SUPABASE_URL_PRESENT: supabaseUrlPresent ? "YES" : "NO",
    SUPABASE_SERVICE_ROLE_PRESENT: supabaseServiceRolePresent ? "YES" : "NO",
    REGISTRY_SOURCE_RUNTIME_STATUS: "CONFIGURATION_MISSING",
    REGISTRY_RECORD_COUNT: "UNPROVEN",
    LIVE_ENUMERATION_RUNTIME_STATUS: "AUTH_UNAVAILABLE",
    LIVE_EBAY_LISTING_COUNT: "UNPROVEN",
    REGISTRY_LIFECYCLE_FIELDS: "UNPROVEN",
    REGISTRY_PROVENANCE_FIELDS: "UNPROVEN",
    REGISTRY_HAS_ACTIVE_STATE: "UNPROVEN",
    REGISTRY_HAS_LAST_SEEN_SIGNAL: "UNPROVEN",
    REGISTRY_HAS_PRODUCT_CASE_LINK: "UNPROVEN",
    REGISTRY_HAS_SOURCE_ORIGIN: "UNPROVEN",
    REGISTRY_MATCHED_COUNT: "UNPROVEN",
    REGISTRY_MISSING_COUNT: "UNPROVEN",
    REGISTRY_ORPHANED_COUNT: "UNPROVEN",
    REGISTRY_AMBIGUOUS_COUNT: "UNPROVEN",
    REGISTRY_COVERAGE_PERCENT: "UNPROVEN",
    LIVE_WITH_ITEM_ID_COUNT: "UNPROVEN",
    LIVE_WITH_SKU_COUNT: "UNPROVEN",
    LIVE_WITH_VARIATION_KEY_COUNT: "UNPROVEN",
    LIVE_WITH_COMPLETE_COMPOSITE_IDENTITY_COUNT: "UNPROVEN",
    REGISTRY_WITH_ITEM_ID_COUNT: "UNPROVEN",
    REGISTRY_WITH_SKU_COUNT: "UNPROVEN",
    REGISTRY_WITH_VARIATION_KEY_COUNT: "UNPROVEN",
    REGISTRY_WITH_COMPLETE_COMPOSITE_IDENTITY_COUNT: "UNPROVEN",
    ITEM_ID_EXACT_OVERLAP_COUNT: "UNPROVEN",
    SKU_EXACT_OVERLAP_COUNT: "UNPROVEN",
    VARIATION_KEY_EXACT_OVERLAP_COUNT: "UNPROVEN",
    ITEM_ID_PLUS_SKU_OVERLAP_COUNT: "UNPROVEN",
    ITEM_ID_PLUS_VARIATION_OVERLAP_COUNT: "UNPROVEN",
    SKU_PLUS_VARIATION_OVERLAP_COUNT: "UNPROVEN",
    FULL_COMPOSITE_OVERLAP_COUNT: "UNPROVEN",
    REGISTRY_CURRENT_IDENTITY_COUNT: "UNPROVEN",
    REGISTRY_LEGACY_IDENTITY_COUNT: "UNPROVEN",
    REGISTRY_INCOMPLETE_IDENTITY_COUNT: "UNPROVEN",
    REGISTRY_HISTORICAL_ONLY_COUNT: "UNPROVEN",
    REGISTRY_IDENTITY_UNPROVEN_COUNT: "UNPROVEN",
    REGISTRY_IDENTITY_ROOT_CAUSE: "UNPROVEN",
    SAFE_BACKFILL_WITHOUT_DUPLICATION: "UNPROVEN",
    LIVE_PARTITION_VALID: "NO",
    REGISTRY_PARTITION_VALID: "NO",
    REGISTRY_FULL_MATCH_ROWS: "UNPROVEN",
    REGISTRY_ITEM_ID_ONLY_ROWS: "UNPROVEN",
    ITEM_ID_ONLY_ROW_COUNT: "UNPROVEN",
    REGISTRY_SKU_ONLY_ROWS: "UNPROVEN",
    REGISTRY_CROSS_LINKED_ROWS: "UNPROVEN",
    REGISTRY_MULTIPLE_ITEM_ID_CANDIDATE_ROWS: "UNPROVEN",
    REGISTRY_MULTIPLE_SKU_CANDIDATE_ROWS: "UNPROVEN",
    REGISTRY_NO_STABLE_OVERLAP_ROWS: "UNPROVEN",
    REGISTRY_TOPOLOGY_UNPROVEN_ROWS: "UNPROVEN",
    REGISTRY_TOPOLOGY_PARTITION_VALID: "NO",
    LIVE_REFERENCED_BY_REGISTRY_ITEM_ID_COUNT: "UNPROVEN",
    LIVE_REFERENCED_BY_REGISTRY_SKU_COUNT: "UNPROVEN",
    LIVE_REFERENCED_BY_BOTH_SAME_REGISTRY_ROW_COUNT: "UNPROVEN",
    LIVE_REFERENCED_BY_CONFLICTING_REGISTRY_ROWS_COUNT: "UNPROVEN",
    LIVE_WITH_NO_STABLE_REGISTRY_REFERENCE_COUNT: "UNPROVEN",
    CROSS_LINK_CONFLICT_COUNT: "UNPROVEN",
    ITEM_ID_ONLY_ITEM_ID_UNIQUE_BOTH_SIDES: "UNPROVEN",
    ITEM_ID_ONLY_REGISTRY_SKU_MATCHES_ANY_OTHER_LIVE_LISTING: "UNPROVEN",
    ITEM_ID_ONLY_LIVE_SKU_MATCHES_ANY_OTHER_REGISTRY_ROW: "UNPROVEN",
    ITEM_ID_ONLY_ACCOUNT_MARKETPLACE_COMPATIBLE: "UNPROVEN",
    ITEM_ID_ONLY_LIFECYCLE_CLASS: "UNPROVEN",
    ITEM_ID_ONLY_DETERMINISTIC_RELINK_POSSIBLE: "UNPROVEN",
    SKU_ONLY_REGISTRY_ITEM_ID_NOT_LIVE_COUNT: "UNPROVEN",
    SKU_ONLY_UNIQUE_SKU_BOTH_SIDES_COUNT: "UNPROVEN",
    SKU_ONLY_NO_COMPETING_REGISTRY_RELATION_COUNT: "UNPROVEN",
    SKU_ONLY_RELIST_CANDIDATE_COUNT: "UNPROVEN",
    SKU_ONLY_STALE_REGISTRY_ITEM_ID_COUNT: "UNPROVEN",
    SKU_ONLY_SKU_REUSE_RISK_COUNT: "UNPROVEN",
    SKU_ONLY_CONFLICTED_IDENTITY_COUNT: "UNPROVEN",
    SKU_ONLY_UNPROVEN_COUNT: "UNPROVEN",
    SKU_ONLY_DETERMINISTIC_RELINK_CANDIDATE_COUNT: "UNPROVEN",
    NO_OVERLAP_HISTORICAL_OR_STALE_COUNT: "UNPROVEN",
    NO_OVERLAP_CURRENT_IDENTITY_DRIFT_COUNT: "UNPROVEN",
    NO_OVERLAP_UNRELATED_COUNT: "UNPROVEN",
    NO_OVERLAP_UNPROVEN_COUNT: "UNPROVEN",
    REGISTRY_STALE_ACTIVE_ROWS_PRESENT: "UNPROVEN",
    CERTIFIED_EXISTING_RELATIONSHIP_COUNT: "UNPROVEN",
    CERTIFIED_RELINK_CANDIDATE_COUNT: "UNPROVEN",
    UNRESOLVED_RELATIONSHIP_COUNT: "UNPROVEN",
    TRUE_NEW_ENTRY_CANDIDATE_COUNT: "UNPROVEN",
    PLAN_RELINK_EXISTING_COUNT: "UNPROVEN",
    PLAN_CREATE_NEW_COUNT: "UNPROVEN",
    PLAN_MARK_STALE_OR_HISTORICAL_COUNT: "UNPROVEN",
    PLAN_REQUIRE_HUMAN_REVIEW_COUNT: "UNPROVEN",
    REGISTRY_REPAIR_PLAN_CERTIFIED: "UNPROVEN",
    AUTOMATED_MUTATION_SAFE: "UNPROVEN",
    ITEM_ID_ANCHORED_RELINK_CANDIDATE_COUNT: "UNPROVEN",
    SKU_ANCHORED_RELINK_CANDIDATE_COUNT: "UNPROVEN",
    CONFLICTED_RELINK_CANDIDATE_COUNT: "UNPROVEN",
    NO_SAFE_RELINK_CANDIDATE_COUNT: "UNPROVEN",
    SAFE_RELINK_CANDIDATE_COUNT: "UNPROVEN",
    SAFE_AUTOMATED_RELINK: "UNPROVEN",
    LIVE_NEW_REGISTRY_ENTRY_CANDIDATE_COUNT: "UNPROVEN",
    SAFE_NEW_ENTRY_BACKFILL_POSSIBLE: "UNPROVEN",
    VARIATION_KEY_REQUIRED_FOR_NON_VARIATION_LISTING: "UNPROVEN",
    EMPTY_VARIATION_IS_CANONIC_FOR_NON_VARIATION_LISTING: "UNPROVEN",
    VARIATION_SEMANTICS_CAUSE_CURRENT_ZERO_MATCH: "UNPROVEN",
    MANUAL_LISTING_RUNTIME_AUTODISCOVERY: "UNPROVEN",
    IS_EBAY_ITEM_ID_AUTHORITATIVE_FOR_LISTING_IDENTITY: "UNPROVEN",
    IS_SKU_ALLOWED_AS_RELIST_CONTINUITY_SIGNAL: "UNPROVEN",
  }
  const calls: EbayMonitorReadonlyCallEvidence[] = []
  requestBudgets.set(calls, {
    deadlineAt: clock().getTime() + REQUEST_BUDGET_MS,
    callsRemaining: REQUEST_MAX_CALLS,
    maximumCalls: REQUEST_MAX_CALLS,
    callsStarted: 0,
  })

  let registryRows: ReadonlyRegistryListingRow[] = []
  let liveListings: EbayLiveListing[] = []
  let registryReaderClient: Pick<SupabaseClient, "from"> | undefined

  let canAttemptRegistryRead = false
  if (configuration.accountKey && supabaseUrlPresent && supabaseServiceRolePresent) {
    canAttemptRegistryRead = true
  }
  if (!canAttemptRegistryRead) {
    result.REGISTRY_SOURCE_RUNTIME_STATUS = "CONFIGURATION_MISSING"
  } else {
    try {
      const supabaseClient = input.supabaseClient ?? getSupabaseAdminClient()
      registryReaderClient = supabaseClient
      const accountKey = configuration.accountKey ?? ""
      const reader = await readRegistry(
        supabaseClient,
        accountKey,
      )
      if (reader.status === "ERROR") {
        result.REGISTRY_SOURCE_RUNTIME_STATUS = "READ_FAILED"
      } else {
        result.REGISTRY_SOURCE_RUNTIME_STATUS = "AVAILABLE"
        registryRows = reader.rows
        result.REGISTRY_RECORD_COUNT = reader.rows.length
      }
    } catch {
      runtimeConfig = "FAILED"
      result.REGISTRY_SOURCE_RUNTIME_STATUS = "READ_FAILED"
    }
  }
  result.REGISTRY_RUNTIME_CONFIG = runtimeConfig

  if (!hasRequiredTradingCredentials(environment) || !configuration.configured) {
    result.LIVE_ENUMERATION_RUNTIME_STATUS = "AUTH_UNAVAILABLE"
  } else {
    try {
      const credentials = generalCredentials(environment)
      const minted = await accessToken({
        operation: "OAUTH_REFRESH_TRADING",
        credentials,
        scopes: [BASE_SCOPE],
        fetchImpl,
        calls,
        clock,
      })
      const identity = getEbayProductionIdentityBindingConfiguration(environment)
      await verifyAccount({
        token: minted.value,
        expectedUserId: identity.expectedUserId,
        expectedFingerprint: identity.expectedAccountFingerprint,
        fetchImpl,
        calls,
        clock,
      })
      const sellerWide = await sellerWideDiscovery({
        token: minted.value,
        fetchImpl,
        calls,
        clock,
      })
      const marketplace = await certifySellerWideItemMarketplaces({
        token: minted.value,
        listings: sellerWide.listings,
        totalEntries: sellerWide.totalEntries,
        fetchImpl,
        calls,
        clock,
      })
      const marketplaceEvidenceComplete = !marketplace.incomplete &&
        marketplace.currentLiveListings.length === sellerWide.listings.length &&
        marketplace.listings.length === sellerWide.listings.length
      if (!marketplaceEvidenceComplete) {
        throw new Error(
          "EBAY_REGISTRY_REPAIR_MARKETPLACE_EVIDENCE_UNPROVEN",
        )
      }
      liveListings = marketplace.listings
      result.LIVE_ENUMERATION_RUNTIME_STATUS = "AVAILABLE"
      result.LIVE_EBAY_LISTING_COUNT = liveListings.length
    } catch (error) {
      result.LIVE_ENUMERATION_RUNTIME_STATUS = "READ_FAILED"
      const failure = safeCode(error, "UNCLASSIFIED")
      if (failure === "UNCLASSIFIED") {
        result.LIVE_ENUMERATION_RUNTIME_STATUS = "AUTH_UNAVAILABLE"
      } else if (
        failure.includes("NETWORK") ||
        failure.includes("READ_TIMEOUT") ||
        failure.includes("REQUEST_BUDGET_EXHAUSTED") ||
        failure.includes("CONFIGURATION") ||
        failure.includes("TOKEN") ||
        failure.includes("ACCOUNT") ||
        failure.includes("IDENTITY") ||
        failure.includes("SCOPE") ||
        failure.includes("UNAUTHORIZED")
      ) {
        result.LIVE_ENUMERATION_RUNTIME_STATUS = "AUTH_UNAVAILABLE"
      }
    }
  }

  if (
    result.REGISTRY_SOURCE_RUNTIME_STATUS === "AVAILABLE" &&
    result.LIVE_ENUMERATION_RUNTIME_STATUS === "AVAILABLE"
  ) {
    const accountKey = configuration.accountKey
    if (accountKey) {
      if (input.captureRegistryRepairEvidence && registryReaderClient) {
        const plannedSyncKeys = liveListings.flatMap((listing) => {
          const syncKey = buildEbayRegistryRepairCreateSyncKey({
            accountKey,
            itemId: listing.itemId,
            sku: listing.sku,
          })
          return syncKey === "UNPROVEN" ? [] : [syncKey]
        })
        const syncKeyLookup = await readRegistrySyncKeyCollisions(
          registryReaderClient,
          plannedSyncKeys,
        )
        const plannedSyncKeySet = new Set(plannedSyncKeys)
        const existingRegistrySyncKeys = syncKeyLookup.rows.map((row) =>
          typeof row.sync_key === "string" && row.sync_key.trim()
            ? row.sync_key.trim()
            : null)
        const syncKeyLookupValid = existingRegistrySyncKeys.every(
          (syncKey) => syncKey !== null && plannedSyncKeySet.has(syncKey),
        )
        if (syncKeyLookup.status === "AVAILABLE" && syncKeyLookupValid) {
          input.captureRegistryRepairEvidence({
            accountKey,
            observedAt: clock().toISOString(),
            liveListings,
            registryRows,
            syncKeyLookupStatus: "AVAILABLE",
            existingRegistrySyncKeys: existingRegistrySyncKeys as string[],
          })
        }
      }
    }
    const reconciliation = buildReconciliationCounts({
      liveListings,
      registryRows,
    })
    result.REGISTRY_MATCHED_COUNT = reconciliation.matched
    result.REGISTRY_MISSING_COUNT = reconciliation.missing
    result.REGISTRY_ORPHANED_COUNT = reconciliation.orphaned
    result.REGISTRY_AMBIGUOUS_COUNT = reconciliation.ambiguous
    result.LIVE_WITH_ITEM_ID_COUNT = reconciliation.liveWithItemIdCount
    result.LIVE_WITH_SKU_COUNT = reconciliation.liveWithSkuCount
    result.LIVE_WITH_VARIATION_KEY_COUNT = reconciliation.liveWithVariationKeyCount
    result.LIVE_WITH_COMPLETE_COMPOSITE_IDENTITY_COUNT =
      reconciliation.liveWithCompleteCompositeCount
    result.REGISTRY_WITH_ITEM_ID_COUNT = reconciliation.registryWithItemIdCount
    result.REGISTRY_WITH_SKU_COUNT = reconciliation.registryWithSkuCount
    result.REGISTRY_WITH_VARIATION_KEY_COUNT =
      reconciliation.registryWithVariationKeyCount
    result.REGISTRY_WITH_COMPLETE_COMPOSITE_IDENTITY_COUNT =
      reconciliation.registryWithCompleteCompositeCount
    result.ITEM_ID_EXACT_OVERLAP_COUNT = reconciliation.itemIdExactOverlapCount
    result.SKU_EXACT_OVERLAP_COUNT = reconciliation.skuExactOverlapCount
    result.VARIATION_KEY_EXACT_OVERLAP_COUNT =
      reconciliation.variationKeyExactOverlapCount
    result.ITEM_ID_PLUS_SKU_OVERLAP_COUNT =
      reconciliation.itemIdPlusSkuOverlapCount
    result.ITEM_ID_PLUS_VARIATION_OVERLAP_COUNT =
      reconciliation.itemIdPlusVariationOverlapCount
    result.SKU_PLUS_VARIATION_OVERLAP_COUNT =
      reconciliation.skuPlusVariationOverlapCount
    result.FULL_COMPOSITE_OVERLAP_COUNT =
      reconciliation.fullCompositeOverlapCount
    result.REGISTRY_CURRENT_IDENTITY_COUNT =
      reconciliation.registryCurrentIdentityCount
    result.REGISTRY_LEGACY_IDENTITY_COUNT =
      reconciliation.registryLegacyIdentityCount
    result.REGISTRY_INCOMPLETE_IDENTITY_COUNT =
      reconciliation.registryIncompleteIdentityCount
    result.REGISTRY_HISTORICAL_ONLY_COUNT =
      reconciliation.registryHistoricalOnlyCount
    result.REGISTRY_IDENTITY_UNPROVEN_COUNT =
      reconciliation.registryIdentityUnprovenCount
    result.REGISTRY_IDENTITY_ROOT_CAUSE =
      reconciliation.registryIdentityRootCause
    result.SAFE_BACKFILL_WITHOUT_DUPLICATION =
      reconciliation.safeBackfillWithoutDuplication
    result.REGISTRY_FULL_MATCH_ROWS = reconciliation.fullMatchRows
    result.ITEM_ID_ONLY_ROW_COUNT = reconciliation.itemIdOnlyRows
    result.REGISTRY_ITEM_ID_ONLY_ROWS = reconciliation.itemIdOnlyRows
    result.REGISTRY_SKU_ONLY_ROWS = reconciliation.skuOnlyRows
    result.REGISTRY_CROSS_LINKED_ROWS = reconciliation.crossLinkedRows
    result.REGISTRY_MULTIPLE_ITEM_ID_CANDIDATE_ROWS =
      reconciliation.multipleItemIdCandidateRows
    result.REGISTRY_MULTIPLE_SKU_CANDIDATE_ROWS =
      reconciliation.multipleSkuIdCandidateRows
    result.REGISTRY_NO_STABLE_OVERLAP_ROWS =
      reconciliation.noStableIdentifierOverlapRows
    result.REGISTRY_TOPOLOGY_UNPROVEN_ROWS =
      reconciliation.topologyUnprovenRows
    result.REGISTRY_TOPOLOGY_PARTITION_VALID =
      reconciliation.topologyPartitionValid
    result.LIVE_REFERENCED_BY_REGISTRY_ITEM_ID_COUNT =
      reconciliation.liveReferencedByRegistryItemIdCount
    result.LIVE_REFERENCED_BY_REGISTRY_SKU_COUNT =
      reconciliation.liveReferencedByRegistrySkuCount
    result.LIVE_REFERENCED_BY_BOTH_SAME_REGISTRY_ROW_COUNT =
      reconciliation.liveReferencedByBothSameRegistryRowCount
    result.LIVE_REFERENCED_BY_CONFLICTING_REGISTRY_ROWS_COUNT =
      reconciliation.liveReferencedByConflictingRegistryRowsCount
    result.LIVE_WITH_NO_STABLE_REGISTRY_REFERENCE_COUNT =
      reconciliation.liveWithNoStableRegistryReferenceCount
    result.CROSS_LINK_CONFLICT_COUNT =
      reconciliation.crossLinkConflictCount
    result.ITEM_ID_ANCHORED_RELINK_CANDIDATE_COUNT =
      reconciliation.itemIdAnchoredRelinkCandidateCount
    result.SKU_ANCHORED_RELINK_CANDIDATE_COUNT =
      reconciliation.skuAnchoredRelinkCandidateCount
    result.CONFLICTED_RELINK_CANDIDATE_COUNT =
      reconciliation.conflictedRelinkCandidateCount
    result.NO_SAFE_RELINK_CANDIDATE_COUNT =
      reconciliation.noSafeRelinkCandidateCount
    result.SAFE_RELINK_CANDIDATE_COUNT =
      reconciliation.safeRelinkCandidateCount
    result.SAFE_AUTOMATED_RELINK = reconciliation.safeAutomatedRelink
    result.LIVE_NEW_REGISTRY_ENTRY_CANDIDATE_COUNT =
      reconciliation.liveNewRegistryEntryCandidateCount
    result.SAFE_NEW_ENTRY_BACKFILL_POSSIBLE =
      reconciliation.safeNewEntryBackfillPossible
    result.REGISTRY_COVERAGE_PERCENT = computeRegistryCoveragePercent(
      reconciliation.matched,
      reconciliation.liveCount,
    )
    result.REGISTRY_LIFECYCLE_FIELDS = reconciliation.registryLifecycleFields
    result.REGISTRY_PROVENANCE_FIELDS = reconciliation.registryProvenanceFields
    result.REGISTRY_HAS_ACTIVE_STATE = reconciliation.registryHasActiveState
    result.REGISTRY_HAS_LAST_SEEN_SIGNAL = reconciliation.registryHasLastSeenSignal
    result.REGISTRY_HAS_PRODUCT_CASE_LINK = reconciliation.registryHasProductCaseLink
    result.REGISTRY_HAS_SOURCE_ORIGIN = reconciliation.registryHasSourceOrigin
    result.LIVE_PARTITION_VALID = reconciliation.livePartitionValid
    result.REGISTRY_PARTITION_VALID = reconciliation.registryPartitionValid
    result.REGISTRY_RECORD_COUNT = reconciliation.registryCount
    result.LIVE_EBAY_LISTING_COUNT = reconciliation.liveCount
    result.NO_OVERLAP_HISTORICAL_OR_STALE_COUNT =
      reconciliation.noOverlapHistoricalOrStaleCount
    result.NO_OVERLAP_CURRENT_IDENTITY_DRIFT_COUNT =
      reconciliation.noOverlapCurrentIdentityDriftCount
    result.NO_OVERLAP_UNRELATED_COUNT =
      reconciliation.noOverlapUnrelatedCount
    result.NO_OVERLAP_UNPROVEN_COUNT = reconciliation.noOverlapUnprovenCount
    result.REGISTRY_STALE_ACTIVE_ROWS_PRESENT =
      reconciliation.registryStaleActiveRowsPresent
    result.ITEM_ID_ONLY_LIFECYCLE_CLASS =
      reconciliation.itemIdOnlyLifecycleClass
    result.ITEM_ID_ONLY_ITEM_ID_UNIQUE_BOTH_SIDES =
      reconciliation.itemIdOnlyItemIdUniqueBothSides
    result.ITEM_ID_ONLY_REGISTRY_SKU_MATCHES_ANY_OTHER_LIVE_LISTING =
      reconciliation.itemIdOnlyRegistrySkuMatchesAnyOtherLive
    result.ITEM_ID_ONLY_LIVE_SKU_MATCHES_ANY_OTHER_REGISTRY_ROW =
      reconciliation.itemIdOnlyLiveSkuMatchesAnyOtherRegistryRow
    result.ITEM_ID_ONLY_ACCOUNT_MARKETPLACE_COMPATIBLE =
      reconciliation.itemIdOnlyAccountMarketplaceCompatible
    result.ITEM_ID_ONLY_DETERMINISTIC_RELINK_POSSIBLE =
      reconciliation.itemIdOnlyDeterministicRelinkPossible
    result.SKU_ONLY_REGISTRY_ITEM_ID_NOT_LIVE_COUNT =
      reconciliation.skuOnlyRegistryItemIdNotLiveCount
    result.SKU_ONLY_UNIQUE_SKU_BOTH_SIDES_COUNT =
      reconciliation.skuOnlyUniqueSkuBothSidesCount
    result.SKU_ONLY_NO_COMPETING_REGISTRY_RELATION_COUNT =
      reconciliation.skuOnlyNoCompetingRegistryRelationCount
    result.SKU_ONLY_RELIST_CANDIDATE_COUNT =
      reconciliation.skuOnlyRelistCandidateCount
    result.SKU_ONLY_STALE_REGISTRY_ITEM_ID_COUNT =
      reconciliation.skuOnlyStaleRegistryItemIdCount
    result.SKU_ONLY_SKU_REUSE_RISK_COUNT =
      reconciliation.skuOnlySkuReuseRiskCount
    result.SKU_ONLY_CONFLICTED_IDENTITY_COUNT =
      reconciliation.skuOnlyConflictedIdentityCount
    result.SKU_ONLY_UNPROVEN_COUNT = reconciliation.skuOnlyUnprovenCount
    result.SKU_ONLY_DETERMINISTIC_RELINK_CANDIDATE_COUNT =
      reconciliation.skuOnlyDeterministicRelinkCandidateCount
    result.CERTIFIED_EXISTING_RELATIONSHIP_COUNT =
      reconciliation.certifiedExistingRelationshipCount
    result.CERTIFIED_RELINK_CANDIDATE_COUNT =
      reconciliation.certifiedRelinkCandidateCount
    result.UNRESOLVED_RELATIONSHIP_COUNT =
      reconciliation.unresolvedRelationshipCount
    result.TRUE_NEW_ENTRY_CANDIDATE_COUNT =
      reconciliation.trueNewEntryCandidateCount
    result.PLAN_RELINK_EXISTING_COUNT = reconciliation.planRelinkExistingCount
    result.PLAN_CREATE_NEW_COUNT = reconciliation.planCreateNewCount
    result.PLAN_MARK_STALE_OR_HISTORICAL_COUNT =
      reconciliation.planMarkStaleOrHistoricalCount
    result.PLAN_REQUIRE_HUMAN_REVIEW_COUNT =
      reconciliation.planRequireHumanReviewCount
    result.REGISTRY_REPAIR_PLAN_CERTIFIED =
      reconciliation.registryRepairPlanCertified
    result.AUTOMATED_MUTATION_SAFE =
      reconciliation.automatedMutationSafe
    result.VARIATION_KEY_REQUIRED_FOR_NON_VARIATION_LISTING =
      reconciliation.variationKeyRequiredForNonVariation
    result.EMPTY_VARIATION_IS_CANONIC_FOR_NON_VARIATION_LISTING =
      reconciliation.emptyVariationCanonicalForNonVariation
    result.VARIATION_SEMANTICS_CAUSE_CURRENT_ZERO_MATCH =
      reconciliation.variationSemanticsCauseCurrentZeroMatch
    result.IS_EBAY_ITEM_ID_AUTHORITATIVE_FOR_LISTING_IDENTITY =
      reconciliation.isEbayItemIdAuthoritative
    result.IS_SKU_ALLOWED_AS_RELIST_CONTINUITY_SIGNAL =
      reconciliation.isSkuAllowedAsRelistContinuitySignal
  }

  result.MANUAL_LISTING_RUNTIME_AUTODISCOVERY = manualListingDiscoveryResult({
    sourceStatus: result.REGISTRY_SOURCE_RUNTIME_STATUS,
    liveStatus: result.LIVE_ENUMERATION_RUNTIME_STATUS,
  })

  if (
    result.REGISTRY_SOURCE_RUNTIME_STATUS !== "AVAILABLE" ||
    result.LIVE_ENUMERATION_RUNTIME_STATUS !== "AVAILABLE"
  ) {
    result.LIVE_EBAY_LISTING_COUNT = "UNPROVEN"
    result.REGISTRY_RECORD_COUNT = "UNPROVEN"
    result.REGISTRY_MATCHED_COUNT = "UNPROVEN"
    result.REGISTRY_MISSING_COUNT = "UNPROVEN"
    result.REGISTRY_ORPHANED_COUNT = "UNPROVEN"
    result.REGISTRY_AMBIGUOUS_COUNT = "UNPROVEN"
    result.LIVE_WITH_ITEM_ID_COUNT = "UNPROVEN"
    result.LIVE_WITH_SKU_COUNT = "UNPROVEN"
    result.LIVE_WITH_VARIATION_KEY_COUNT = "UNPROVEN"
    result.LIVE_WITH_COMPLETE_COMPOSITE_IDENTITY_COUNT = "UNPROVEN"
    result.REGISTRY_WITH_ITEM_ID_COUNT = "UNPROVEN"
    result.REGISTRY_WITH_SKU_COUNT = "UNPROVEN"
    result.REGISTRY_WITH_VARIATION_KEY_COUNT = "UNPROVEN"
    result.REGISTRY_WITH_COMPLETE_COMPOSITE_IDENTITY_COUNT = "UNPROVEN"
    result.ITEM_ID_EXACT_OVERLAP_COUNT = "UNPROVEN"
    result.SKU_EXACT_OVERLAP_COUNT = "UNPROVEN"
    result.VARIATION_KEY_EXACT_OVERLAP_COUNT = "UNPROVEN"
    result.ITEM_ID_PLUS_SKU_OVERLAP_COUNT = "UNPROVEN"
    result.ITEM_ID_PLUS_VARIATION_OVERLAP_COUNT = "UNPROVEN"
    result.SKU_PLUS_VARIATION_OVERLAP_COUNT = "UNPROVEN"
    result.FULL_COMPOSITE_OVERLAP_COUNT = "UNPROVEN"
    result.REGISTRY_CURRENT_IDENTITY_COUNT = "UNPROVEN"
    result.REGISTRY_LEGACY_IDENTITY_COUNT = "UNPROVEN"
    result.REGISTRY_INCOMPLETE_IDENTITY_COUNT = "UNPROVEN"
    result.REGISTRY_HISTORICAL_ONLY_COUNT = "UNPROVEN"
    result.REGISTRY_IDENTITY_UNPROVEN_COUNT = "UNPROVEN"
    result.REGISTRY_IDENTITY_ROOT_CAUSE = "UNPROVEN"
    result.SAFE_BACKFILL_WITHOUT_DUPLICATION = "UNPROVEN"
    result.REGISTRY_FULL_MATCH_ROWS = "UNPROVEN"
    result.REGISTRY_ITEM_ID_ONLY_ROWS = "UNPROVEN"
    result.REGISTRY_SKU_ONLY_ROWS = "UNPROVEN"
    result.REGISTRY_CROSS_LINKED_ROWS = "UNPROVEN"
    result.REGISTRY_MULTIPLE_ITEM_ID_CANDIDATE_ROWS = "UNPROVEN"
    result.REGISTRY_MULTIPLE_SKU_CANDIDATE_ROWS = "UNPROVEN"
    result.REGISTRY_NO_STABLE_OVERLAP_ROWS = "UNPROVEN"
    result.REGISTRY_TOPOLOGY_UNPROVEN_ROWS = "UNPROVEN"
    result.REGISTRY_TOPOLOGY_PARTITION_VALID = "NO"
    result.LIVE_REFERENCED_BY_REGISTRY_ITEM_ID_COUNT = "UNPROVEN"
    result.LIVE_REFERENCED_BY_REGISTRY_SKU_COUNT = "UNPROVEN"
    result.LIVE_REFERENCED_BY_BOTH_SAME_REGISTRY_ROW_COUNT = "UNPROVEN"
    result.LIVE_REFERENCED_BY_CONFLICTING_REGISTRY_ROWS_COUNT = "UNPROVEN"
    result.LIVE_WITH_NO_STABLE_REGISTRY_REFERENCE_COUNT = "UNPROVEN"
    result.CROSS_LINK_CONFLICT_COUNT = "UNPROVEN"
    result.ITEM_ID_ANCHORED_RELINK_CANDIDATE_COUNT = "UNPROVEN"
    result.SKU_ANCHORED_RELINK_CANDIDATE_COUNT = "UNPROVEN"
    result.CONFLICTED_RELINK_CANDIDATE_COUNT = "UNPROVEN"
    result.NO_SAFE_RELINK_CANDIDATE_COUNT = "UNPROVEN"
    result.SAFE_RELINK_CANDIDATE_COUNT = "UNPROVEN"
    result.SAFE_AUTOMATED_RELINK = "UNPROVEN"
    result.LIVE_NEW_REGISTRY_ENTRY_CANDIDATE_COUNT = "UNPROVEN"
    result.SAFE_NEW_ENTRY_BACKFILL_POSSIBLE = "UNPROVEN"
    result.VARIATION_KEY_REQUIRED_FOR_NON_VARIATION_LISTING = "UNPROVEN"
    result.EMPTY_VARIATION_IS_CANONIC_FOR_NON_VARIATION_LISTING = "UNPROVEN"
    result.VARIATION_SEMANTICS_CAUSE_CURRENT_ZERO_MATCH = "UNPROVEN"
    result.REGISTRY_COVERAGE_PERCENT = "UNPROVEN"
    result.LIVE_PARTITION_VALID = "NO"
    result.REGISTRY_PARTITION_VALID = "NO"
  }
  return result
}

export async function previewEbayRegistryRepairRuntime(
  input: RegistryRuntimeReadInput = {},
): Promise<EbayRegistryRepairDryRun> {
  const {
    readRegistryRepairEvidenceSnapshot,
    captureRegistryRepairEvidence,
    captureRegistryRepairExecutionPlan,
    ...runtimeInput
  } = input
  const requestStartedAt = input.startedAt ?? Date.now()
  const readCanonicalSnapshot = async () => {
    let evidence: RegistryRepairRuntimeEvidence | undefined
    await diagnoseRegistryCoverageRuntime({
      ...runtimeInput,
      startedAt: requestStartedAt,
      captureRegistryRepairEvidence: (captured) => {
        evidence = captured
        captureRegistryRepairEvidence?.(captured)
      },
    })
    return evidence
  }
  const readSnapshot = readRegistryRepairEvidenceSnapshot ??
    readCanonicalSnapshot
  const firstEvidence = await readSnapshot()
  const currentEvidence = await readSnapshot()
  if (!firstEvidence || !currentEvidence) {
    return buildUnprovenEbayRegistryRepairDryRun()
  }
  const firstEvidenceFingerprint =
    buildEbayRegistryRepairEvidenceFingerprint({
      accountKey: firstEvidence.accountKey,
      marketplaceId: "EBAY_US",
      liveListings: firstEvidence.liveListings,
      registryRows: firstEvidence.registryRows,
      syncKeyLookupStatus: firstEvidence.syncKeyLookupStatus,
      existingRegistrySyncKeys: firstEvidence.existingRegistrySyncKeys,
    })
  const currentEvidenceFingerprint =
    buildEbayRegistryRepairEvidenceFingerprint({
      accountKey: currentEvidence.accountKey,
      marketplaceId: "EBAY_US",
      liveListings: currentEvidence.liveListings,
      registryRows: currentEvidence.registryRows,
      syncKeyLookupStatus: currentEvidence.syncKeyLookupStatus,
      existingRegistrySyncKeys: currentEvidence.existingRegistrySyncKeys,
    })
  if (firstEvidenceFingerprint === "UNPROVEN" ||
      currentEvidenceFingerprint === "UNPROVEN") {
    return buildUnprovenEbayRegistryRepairDryRun()
  }
  return buildEbayRegistryRepairDryRun({
    accountKey: currentEvidence.accountKey,
    accountVerified: "YES",
    marketplaceId: "EBAY_US",
    observedAt: currentEvidence.observedAt,
    liveListings: currentEvidence.liveListings,
    registryRows: currentEvidence.registryRows,
    syncKeyLookupStatus: currentEvidence.syncKeyLookupStatus,
    existingRegistrySyncKeys: currentEvidence.existingRegistrySyncKeys,
    capturedEvidenceFingerprint: firstEvidenceFingerprint,
  }, captureRegistryRepairExecutionPlan)
}

function isPresentAndTrimmed(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
}

function incrementCount(
  counts: Map<string, number>,
  key: string,
) {
  const previousCount = counts.get(key)
  counts.set(
    key,
    previousCount === undefined ? 1 : previousCount + 1,
  )
}

function getCount(
  counts: Map<string, number>,
  key: string,
) {
  const value = counts.get(key)
  return value === undefined ? 0 : value
}

type RegistryLiveReconciliation = {
  liveCount: number
  registryCount: number
  matched: number
  missing: number
  orphaned: number
  ambiguous: number
  liveWithItemIdCount: number
  liveWithSkuCount: number
  liveWithVariationKeyCount: number
  liveWithCompleteCompositeCount: number
  registryWithItemIdCount: number
  registryWithSkuCount: number
  registryWithVariationKeyCount: number
  registryWithCompleteCompositeCount: number
  itemIdExactOverlapCount: number
  skuExactOverlapCount: number
  variationKeyExactOverlapCount: number
  itemIdPlusSkuOverlapCount: number
  itemIdPlusVariationOverlapCount: number
  skuPlusVariationOverlapCount: number
  fullCompositeOverlapCount: number
  registryCurrentIdentityCount: number
  registryLegacyIdentityCount: number
  registryIncompleteIdentityCount: number
  registryHistoricalOnlyCount: number
  registryIdentityUnprovenCount: number
  registryIdentityRootCause: EbayRegistryIdentityRootCause
  safeBackfillWithoutDuplication: EbaySafeBackfillWithoutDuplication
  fullMatchRows: number
  itemIdOnlyRows: number
  skuOnlyRows: number
  crossLinkedRows: number
  multipleItemIdCandidateRows: number
  multipleSkuIdCandidateRows: number
  noStableIdentifierOverlapRows: number
  topologyUnprovenRows: number
  topologyPartitionValid: "YES" | "NO"
  liveReferencedByRegistryItemIdCount: number
  liveReferencedByRegistrySkuCount: number
  liveReferencedByBothSameRegistryRowCount: number
  liveReferencedByConflictingRegistryRowsCount: number
  liveWithNoStableRegistryReferenceCount: number
  crossLinkConflictCount: number
  itemIdAnchoredRelinkCandidateCount: number
  skuAnchoredRelinkCandidateCount: number
  conflictedRelinkCandidateCount: number
  noSafeRelinkCandidateCount: number
  safeRelinkCandidateCount: number
  safeAutomatedRelink: "YES" | "NO" | "UNPROVEN"
  liveNewRegistryEntryCandidateCount: number
  safeNewEntryBackfillPossible: "YES" | "NO" | "UNPROVEN"
  variationKeyRequiredForNonVariation: "YES" | "NO" | "UNPROVEN"
  emptyVariationCanonicalForNonVariation: "YES" | "NO" | "UNPROVEN"
  variationSemanticsCauseCurrentZeroMatch: "YES" | "NO" | "UNPROVEN"
  livePartitionValid: "YES" | "NO"
  registryPartitionValid: "YES" | "NO"
  registryLifecycleFields: string
  registryProvenanceFields: string
  registryHasActiveState: "YES" | "NO"
  registryHasLastSeenSignal: "YES" | "NO"
  registryHasProductCaseLink: "YES" | "NO"
  registryHasSourceOrigin: "YES" | "NO"
  noOverlapHistoricalOrStaleCount: number
  noOverlapCurrentIdentityDriftCount: number
  noOverlapUnrelatedCount: number
  noOverlapUnprovenCount: number
  registryStaleActiveRowsPresent: "YES" | "NO"
  itemIdOnlyLifecycleClass: EbayRegistryItemIdOnlyLifecycleClass | "UNPROVEN"
  itemIdOnlyItemIdUniqueBothSides: "YES" | "NO" | "UNPROVEN"
  itemIdOnlyRegistrySkuMatchesAnyOtherLive: "YES" | "NO" | "UNPROVEN"
  itemIdOnlyLiveSkuMatchesAnyOtherRegistryRow: "YES" | "NO" | "UNPROVEN"
  itemIdOnlyAccountMarketplaceCompatible: "YES" | "NO" | "UNPROVEN"
  itemIdOnlyDeterministicRelinkPossible: "YES" | "NO" | "UNPROVEN"
  skuOnlyRegistryItemIdNotLiveCount: number
  skuOnlyUniqueSkuBothSidesCount: number
  skuOnlyNoCompetingRegistryRelationCount: number
  skuOnlyRelistCandidateCount: number
  skuOnlyStaleRegistryItemIdCount: number
  skuOnlySkuReuseRiskCount: number
  skuOnlyConflictedIdentityCount: number
  skuOnlyUnprovenCount: number
  skuOnlyDeterministicRelinkCandidateCount: number
  certifiedExistingRelationshipCount: number
  certifiedRelinkCandidateCount: number
  unresolvedRelationshipCount: number
  trueNewEntryCandidateCount: number
  planRelinkExistingCount: number
  planCreateNewCount: number
  planMarkStaleOrHistoricalCount: number
  planRequireHumanReviewCount: number
  registryRepairPlanCertified: "YES" | "NO" | "UNPROVEN"
  automatedMutationSafe: "YES" | "NO" | "UNPROVEN"
  isEbayItemIdAuthoritative: "YES" | "NO" | "UNPROVEN"
  isSkuAllowedAsRelistContinuitySignal: "YES" | "NO" | "UNPROVEN"
}

type RegistryMatchAnalysis = {
  itemMatches: number[]
  skuMatches: number[]
  fullMatches: number[]
  itemSkuMatches: number[]
  topology: EbayRegistryTopologyBucket
  hasItemId: boolean
  hasSku: boolean
  hasVariationKey: boolean
  itemId: string | null
  sku: string | null
  variationKey: string | null
  listingStatus: string
  accountKey: string | null
  identityComplete: boolean
}

function buildReconciliationCounts(input: {
  liveListings: EbayLiveListing[]
  registryRows: ReadonlyRegistryListingRow[]
}) : RegistryLiveReconciliation {
  const liveItemCounts = new Map<string, number>()
  const liveSkuCounts = new Map<string, number>()
  const liveVariationCounts = new Map<string, number>()
  const liveItemSkuCounts = new Map<string, number>()
  const liveItemVariationCounts = new Map<string, number>()
  const liveSkuVariationCounts = new Map<string, number>()
  const liveCompositeCounts = new Map<string, number>()
  const liveItemToIndexes = new Map<string, Set<number>>()
  const liveSkuToIndexes = new Map<string, Set<number>>()
  const liveCompositeToIndexes = new Map<string, Set<number>>()
  const liveItemSkuToIndexes = new Map<string, Set<number>>()
  const liveItemVariationToIndexes = new Map<string, Set<number>>()
  const liveSkuVariationToIndexes = new Map<string, Set<number>>()
  const liveWithVariationKeyByIndex: boolean[] = []
  const liveHasCompleteIdentity: boolean[] = []
  let liveWithItemIdCount = 0
  let liveWithSkuCount = 0
  let liveWithVariationKeyCount = 0
  let liveWithCompleteCompositeCount = 0
  let liveIdentityMissingCount = 0

  input.liveListings.forEach((listing, liveIndex) => {
    const itemId = itemIdSkuVariationIdentityComponent(listing.itemId, 120)
    const sku = itemIdSkuVariationIdentityComponent(listing.sku, 120)
    const variationKey = itemIdSkuVariationIdentityComponent(
      listing.variationKey,
      120,
    )
    const hasItemId = itemId !== null
    const hasSku = sku !== null
    const hasVariationKey = variationKey !== null
    const hasCompleteIdentity = hasItemId && hasSku
    liveWithVariationKeyByIndex.push(hasVariationKey)
    liveHasCompleteIdentity.push(hasCompleteIdentity)

    if (hasItemId) {
      liveWithItemIdCount += 1
      incrementCount(liveItemCounts, itemId)
      addToIndexMap(liveItemToIndexes, itemId, liveIndex)
    }
    if (hasSku) {
      liveWithSkuCount += 1
      incrementCount(liveSkuCounts, sku)
      addToIndexMap(liveSkuToIndexes, sku, liveIndex)
    }
    if (hasVariationKey) {
      liveWithVariationKeyCount += 1
      incrementCount(liveVariationCounts, variationKey)
      addToIndexMap(liveItemVariationToIndexes, variationKey, liveIndex)
    }

    if (!hasCompleteIdentity) {
      liveIdentityMissingCount += 1
      return
    }

    liveWithCompleteCompositeCount += 1
    const compositeKey = itemIdSkuVariationIdentityKey({
      itemId,
      sku,
      variationKey,
    })
    incrementCount(liveCompositeCounts, compositeKey)
    addToIndexMap(liveCompositeToIndexes, compositeKey, liveIndex)
    const itemSkuKey = itemSkuIdentityKey(itemId, sku)
    incrementCount(liveItemSkuCounts, itemSkuKey)
    addToIndexMap(liveItemSkuToIndexes, itemSkuKey, liveIndex)
    if (hasVariationKey) {
      const itemVariationKey = JSON.stringify([itemId, variationKey])
      const skuVariationKey = JSON.stringify([sku, variationKey])
      incrementCount(liveItemVariationCounts, itemVariationKey)
      incrementCount(liveSkuVariationCounts, skuVariationKey)
      addToIndexMap(liveItemVariationToIndexes, itemVariationKey, liveIndex)
      addToIndexMap(liveSkuVariationToIndexes, skuVariationKey, liveIndex)
    }
  })

  const registryItemCounts = new Map<string, number>()
  const registrySkuCounts = new Map<string, number>()
  const registryVariationCounts = new Map<string, number>()
  const registryItemSkuCounts = new Map<string, number>()
  const registryItemVariationCounts = new Map<string, number>()
  const registrySkuVariationCounts = new Map<string, number>()
  const registryCompositeCounts = new Map<string, number>()
  const registryRowsByItemIdCount = new Map<string, number>()
  const registryRowsBySkuCount = new Map<string, number>()
  const registryRowsByVariationKeyCount = new Map<string, number>()
  let registryWithItemIdCount = 0
  let registryWithSkuCount = 0
  let registryWithVariationKeyCount = 0
  let registryWithCompleteCompositeCount = 0
  let registryCurrentIdentityCount = 0
  let registryLegacyIdentityCount = 0
  let registryIncompleteIdentityCount = 0
  let registryHistoricalOnlyCount = 0
  let registryMissingIdentityCount = 0
  let registryIdentityUnprovenCount = 0
  const liveReferencedByRegistryItemId = new Array<boolean>(
    input.liveListings.length,
  ).fill(false)
  const liveReferencedByRegistrySku = new Array<boolean>(
    input.liveListings.length,
  ).fill(false)
  const liveReferencedByBothSameRegistryRow = new Array<boolean>(
    input.liveListings.length,
  ).fill(false)
  const liveRegistryReferences = Array.from(
    { length: input.liveListings.length },
    () => new Set<number>(),
  )
  const matchAnalyses: RegistryMatchAnalysis[] = []
  let fullMatchRows = 0
  const liveIndexesWithFullMatch = new Set<number>()
  let itemIdOnlyRows = 0
  let skuOnlyRows = 0
  let crossLinkedRows = 0
  let multipleItemIdCandidateRows = 0
  let multipleSkuCandidateRows = 0
  let noStableIdentifierOverlapRows = 0
  let topologyUnprovenRows = 0
  let crossLinkConflictCount = 0
  const deterministicRelinkLiveIndexes = new Set<number>()

  input.registryRows.forEach((row, registryIndex) => {
    const itemId = itemIdSkuVariationIdentityComponent(row.ebay_item_id, 120)
    const sku = itemIdSkuVariationIdentityComponent(row.ebay_sku, 120)
    const variationKey = itemIdSkuVariationIdentityComponent(
      row.ebay_variation_key ?? null,
      120,
    )
    const hasItemId = itemId !== null
    const hasSku = sku !== null
    const hasVariationKey = variationKey !== null
    const hasAnyIdentity = hasItemId || hasSku || hasVariationKey
    const isLegacySource = row.source !== "EBAY_INVENTORY_API" &&
      !row.source.toLowerCase().includes("inventory_api")

    if (hasItemId) {
      registryWithItemIdCount += 1
      incrementCount(registryItemCounts, itemId)
      incrementCount(registryRowsByItemIdCount, itemId)
    }
    if (hasSku) {
      registryWithSkuCount += 1
      incrementCount(registrySkuCounts, sku)
      incrementCount(registryRowsBySkuCount, sku)
    }
    if (hasVariationKey) {
      registryWithVariationKeyCount += 1
      incrementCount(registryVariationCounts, variationKey)
      incrementCount(registryRowsByVariationKeyCount, variationKey)
    }

    if (hasItemId && hasSku) {
      registryCurrentIdentityCount += 1
    } else if (hasAnyIdentity) {
      registryIncompleteIdentityCount += 1
      if (isLegacySource) registryLegacyIdentityCount += 1
    } else if (isLegacySource) {
      registryLegacyIdentityCount += 1
    } else {
      registryHistoricalOnlyCount += 1
    }

    const itemMatches = hasItemId ? getIndexes(liveItemToIndexes, itemId) : []
    const skuMatches = hasSku ? getIndexes(liveSkuToIndexes, sku) : []
    const fullMatches = hasItemId && hasSku
      ? getIndexes(liveCompositeToIndexes, itemIdSkuVariationIdentityKey({
        itemId,
        sku,
        variationKey,
      }))
      : []
    const itemSkuMatches = hasItemId && hasSku
      ? getIndexes(
        liveItemSkuToIndexes,
        itemSkuIdentityKey(itemId, sku),
      )
      : []
    const intersectionItemSku = intersectIndexes(itemMatches, skuMatches)

    let topology: EbayRegistryTopologyBucket
    if (fullMatches.length > 0) {
      topology = fullMatches.length === 1
        ? "FULL_MATCH"
        : "ITEM_ID_AND_SKU_MATCH_DIFFERENT_LIVE_ROWS"
    } else if (hasItemId && hasSku && intersectionItemSku.length === 0 &&
      itemMatches.length > 0 && skuMatches.length > 0) {
      topology = "ITEM_ID_AND_SKU_MATCH_DIFFERENT_LIVE_ROWS"
    } else if (itemMatches.length === 0 && skuMatches.length === 0) {
      topology = "NO_STABLE_IDENTIFIER_OVERLAP"
    } else if (itemMatches.length === 1 && skuMatches.length === 0) {
      topology = "ITEM_ID_ONLY_MATCH"
    } else if (itemMatches.length === 0 && skuMatches.length === 1) {
      topology = "SKU_ONLY_MATCH"
    } else if (itemMatches.length > 1 && skuMatches.length === 0) {
      topology = "MULTIPLE_ITEM_ID_CANDIDATES"
    } else if (itemMatches.length === 0 && skuMatches.length > 1) {
      topology = "MULTIPLE_SKU_CANDIDATES"
    } else if (itemMatches.length > 0 && skuMatches.length > 0) {
      topology = "ITEM_ID_AND_SKU_MATCH_DIFFERENT_LIVE_ROWS"
    } else {
      topology = "UNPROVEN"
    }

    if (topology === "ITEM_ID_ONLY_MATCH") itemIdOnlyRows += 1
    else if (topology === "SKU_ONLY_MATCH") skuOnlyRows += 1
    else if (topology === "ITEM_ID_AND_SKU_MATCH_DIFFERENT_LIVE_ROWS") crossLinkedRows += 1
    else if (topology === "MULTIPLE_ITEM_ID_CANDIDATES") {
      multipleItemIdCandidateRows += 1
    } else if (topology === "MULTIPLE_SKU_CANDIDATES") {
      multipleSkuCandidateRows += 1
    } else if (topology === "NO_STABLE_IDENTIFIER_OVERLAP") {
      noStableIdentifierOverlapRows += 1
    } else if (topology === "UNPROVEN") {
      topologyUnprovenRows += 1
    } else if (topology === "FULL_MATCH") {
      fullMatchRows += 1
    }

    const referencedByTopology = new Set<number>([
      ...itemMatches,
      ...skuMatches,
    ])
    for (const liveIndex of referencedByTopology) {
      liveReferencedByRegistryItemId[liveIndex] ||= itemMatches.includes(liveIndex)
      liveReferencedByRegistrySku[liveIndex] ||= skuMatches.includes(liveIndex)
      liveRegistryReferences[liveIndex].add(registryIndex)
    }
    for (const liveIndex of itemSkuMatches) {
      if (liveIndex >= 0 && liveIndex < input.liveListings.length) {
        liveReferencedByBothSameRegistryRow[liveIndex] = true
      }
    }
    if (
      itemMatches.length > 0 &&
      skuMatches.length > 0 &&
      hasItemId &&
      hasSku &&
      itemMatches[0] !== undefined &&
      skuMatches[0] !== undefined &&
      intersectionItemSku.length === 0
    ) {
      crossLinkConflictCount += 1
    }

    if (topology === "FULL_MATCH") {
      for (const liveIndex of fullMatches) {
        liveIndexesWithFullMatch.add(liveIndex)
      }
      if (hasVariationKey) {
        const itemVariationKey = JSON.stringify([itemId, variationKey])
        const skuVariationKey = JSON.stringify([sku, variationKey])
        incrementCount(registryItemVariationCounts, itemVariationKey)
        incrementCount(registrySkuVariationCounts, skuVariationKey)
      }
      if (hasItemId && hasSku) {
        registryWithCompleteCompositeCount += 1
        const compositeKey = itemIdSkuVariationIdentityKey({
          itemId,
          sku,
          variationKey,
        })
        incrementCount(registryCompositeCounts, compositeKey)
      }
      matchAnalyses.push({
        itemMatches,
        skuMatches,
        fullMatches,
        itemSkuMatches,
        topology,
        hasItemId,
        hasSku,
        hasVariationKey,
        itemId,
        sku,
        variationKey,
        listingStatus: row.listing_status,
        accountKey: row.account_key,
        identityComplete: hasItemId && hasSku,
      })
      return
    }

    if (!hasItemId || !hasSku) {
      registryMissingIdentityCount += 1
      matchAnalyses.push({
        itemMatches,
        skuMatches,
        fullMatches,
        itemSkuMatches: [],
        topology,
        hasItemId,
        hasSku,
        hasVariationKey,
        itemId,
        sku,
        variationKey,
        listingStatus: row.listing_status,
        accountKey: row.account_key,
        identityComplete: hasItemId && hasSku,
      })
      return
    }

    registryWithCompleteCompositeCount += 1
    const compositeKey = itemIdSkuVariationIdentityKey({
      itemId,
      sku,
      variationKey,
    })
    incrementCount(registryCompositeCounts, compositeKey)
    const itemSkuKey = itemSkuIdentityKey(itemId, sku)
    incrementCount(registryItemSkuCounts, itemSkuKey)
    if (hasVariationKey) {
      const itemVariationKey = JSON.stringify([itemId, variationKey])
      const skuVariationKey = JSON.stringify([sku, variationKey])
      incrementCount(registryItemVariationCounts, itemVariationKey)
      incrementCount(registrySkuVariationCounts, skuVariationKey)
    }
    matchAnalyses.push({
      itemMatches,
      skuMatches,
      fullMatches,
      itemSkuMatches,
      topology,
      hasItemId,
      hasSku,
      hasVariationKey,
      itemId,
      sku,
      variationKey,
      listingStatus: row.listing_status,
      accountKey: row.account_key,
      identityComplete: hasItemId && hasSku,
    })
  })

  const unresolvedLegacyRows = input.registryRows.length - (
    registryCurrentIdentityCount +
    registryIncompleteIdentityCount +
    registryHistoricalOnlyCount +
    registryLegacyIdentityCount
  )
  if (unresolvedLegacyRows > 0) {
    registryIdentityUnprovenCount = unresolvedLegacyRows
  }

  const liveCompositeMatchCounts = new Map(registryCompositeCounts)
  let matched = 0
  for (const [key, liveCount] of liveCompositeCounts) {
    const registryCount = getCount(liveCompositeMatchCounts, key)
    const matchedOccurrence = Math.min(liveCount, registryCount)
    matched += matchedOccurrence
    liveCompositeMatchCounts.set(key, registryCount - matchedOccurrence)
  }
  const missing = input.liveListings.length - matched - liveIdentityMissingCount
  const fullCompositeOverlapCount = matched
  const registryOrphaned = [...liveCompositeMatchCounts.values()]
    .reduce((sum, value) => sum + value, 0)

  const itemIdExactOverlapCount = [...liveItemCounts.keys()].reduce(
    (sum, candidate) => (registryItemCounts.has(candidate)
      ? sum + getCount(liveItemCounts, candidate)
      : sum),
    0,
  )
  const skuExactOverlapCount = [...liveSkuCounts.keys()].reduce(
    (sum, candidate) => (registrySkuCounts.has(candidate)
      ? sum + getCount(liveSkuCounts, candidate)
      : sum),
    0,
  )
  const variationKeyExactOverlapCount = [...liveVariationCounts.keys()].reduce(
    (sum, candidate) => (registryVariationCounts.has(candidate)
      ? sum + getCount(liveVariationCounts, candidate)
      : sum),
    0,
  )
  const itemIdPlusSkuOverlapCount = [...liveItemSkuCounts.keys()].reduce(
    (sum, candidate) => (registryItemSkuCounts.has(candidate)
      ? sum + getCount(liveItemSkuCounts, candidate)
      : sum),
    0,
  )
  const itemIdPlusVariationOverlapCount = [...liveItemVariationCounts.keys()]
    .reduce((sum, candidate) => (registryItemVariationCounts.has(candidate)
      ? sum + getCount(liveItemVariationCounts, candidate)
      : sum),
    0)
  const skuPlusVariationOverlapCount = [...liveSkuVariationCounts.keys()].reduce(
    (sum, candidate) => (registrySkuVariationCounts.has(candidate)
      ? sum + getCount(liveSkuVariationCounts, candidate)
      : sum),
    0,
  )

  const duplicatedLiveComposite = [...liveCompositeCounts.values()]
    .reduce((sum, value) => sum + (value > 1 ? value - 1 : 0), 0)
  const duplicatedRegistryComposite = [...registryCompositeCounts.values()]
    .reduce((sum, value) => sum + (value > 1 ? value - 1 : 0), 0)

  const livePartitionValid = !liveIdentityMissingCount &&
    duplicatedLiveComposite === 0 ? "YES" : "NO"
  const registryPartitionValid = !registryMissingIdentityCount &&
    duplicatedRegistryComposite === 0 ? "YES" : "NO"

  const overlapSignal = {
    item: itemIdExactOverlapCount > 0,
    sku: skuExactOverlapCount > 0,
    variation: variationKeyExactOverlapCount > 0,
    itemSku: itemIdPlusSkuOverlapCount > 0,
    itemVariation: itemIdPlusVariationOverlapCount > 0,
    skuVariation: skuPlusVariationOverlapCount > 0,
  }
  const overlapSignalCount = Object.values(overlapSignal).filter(Boolean).length
  const hasAnyStableIdentifierOverlap = overlapSignalCount > 0

  let registryIdentityRootCause: EbayRegistryIdentityRootCause = "UNPROVEN"
  if (
    registryHistoricalOnlyCount > 0 &&
    registryCurrentIdentityCount === 0 &&
    registryIncompleteIdentityCount === 0 &&
    registryLegacyIdentityCount === 0
  ) {
    registryIdentityRootCause = "REGISTRY_ROWS_HISTORICAL_ONLY"
  } else if (
    registryLegacyIdentityCount > 0 &&
    registryCurrentIdentityCount === 0 &&
    registryIncompleteIdentityCount === 0
  ) {
    registryIdentityRootCause = "LEGACY_IDENTITY_CONTRACT"
  } else if (fullCompositeOverlapCount === 0 && overlapSignal.itemSku) {
    registryIdentityRootCause = "COMPOSITE_KEY_OVERSTRICT"
  } else if (
    fullCompositeOverlapCount === 0 &&
    overlapSignal.item &&
    !overlapSignal.sku &&
    !overlapSignal.variation &&
    overlapSignalCount === 1
  ) {
    registryIdentityRootCause = "ITEM_ID_MISMATCH"
  } else if (
    fullCompositeOverlapCount === 0 &&
    overlapSignal.sku &&
    !overlapSignal.item &&
    !overlapSignal.variation &&
    overlapSignalCount === 1
  ) {
    registryIdentityRootCause = "SKU_MISMATCH"
  } else if (
    fullCompositeOverlapCount === 0 &&
    overlapSignal.variation &&
    !overlapSignal.item &&
    !overlapSignal.sku &&
    overlapSignalCount === 1
  ) {
    registryIdentityRootCause = "VARIATION_KEY_MISMATCH"
  } else if (fullCompositeOverlapCount === 0 && overlapSignalCount > 1) {
    registryIdentityRootCause = "MIXED_CAUSES"
  }

  const safeBackfillWithoutDuplication =
    fullCompositeOverlapCount > 0
      ? "UNPROVEN"
      : !hasAnyStableIdentifierOverlap
      ? registryCurrentIdentityCount === 0 &&
        registryIncompleteIdentityCount === 0 &&
        registryLegacyIdentityCount === 0 &&
        registryHistoricalOnlyCount === input.registryRows.length
          ? "YES"
          : "UNPROVEN"
      : "NO"

  let itemIdAnchoredRelinkCandidateCount = 0
  let skuAnchoredRelinkCandidateCount = 0
  let conflictedRelinkCandidateCount = 0
  let noSafeRelinkCandidateCount = 0
  for (const analysis of matchAnalyses) {
    const registryHasSingleItemMatch = analysis.itemMatches.length === 1
    const registryHasSingleSkuMatch = analysis.skuMatches.length === 1
    if (analysis.topology === "NO_STABLE_IDENTIFIER_OVERLAP") {
      if (analysis.hasItemId || analysis.hasSku) noSafeRelinkCandidateCount += 1
      continue
    }
    if (analysis.topology === "FULL_MATCH") {
      continue
    }

    if (analysis.topology === "ITEM_ID_ONLY_MATCH" && registryHasSingleItemMatch) {
      const liveIndex = analysis.itemMatches[0]
      const itemIdUnique = getCount(registryRowsByItemIdCount,
        analysis.itemId ?? "") === 1
      const noCompetingMapping = liveRegistryReferences[liveIndex]?.size === 1
      const liveReferenceSafe = liveIndex !== undefined &&
        liveIndex >= 0 &&
        liveIndex < input.liveListings.length
      const identityComplete = liveReferenceSafe
        ? liveHasCompleteIdentity[liveIndex]
        : false
      const hasSingleIdentifier = !analysis.hasSku && !analysis.hasVariationKey
      if (
        liveReferenceSafe &&
        identityComplete &&
        hasSingleIdentifier &&
        itemIdUnique &&
        noCompetingMapping
      ) {
        itemIdAnchoredRelinkCandidateCount += 1
        if (liveIndex !== undefined) {
          deterministicRelinkLiveIndexes.add(liveIndex)
        }
      } else {
        conflictedRelinkCandidateCount += 1
      }
      continue
    }
    if (analysis.topology === "SKU_ONLY_MATCH" && registryHasSingleSkuMatch) {
      const liveIndex = analysis.skuMatches[0]
      const skuUnique = getCount(registryRowsBySkuCount, analysis.sku ?? "") === 1
      const noCompetingMapping = liveRegistryReferences[liveIndex]?.size === 1
      const liveReferenceSafe = liveIndex !== undefined &&
        liveIndex >= 0 &&
        liveIndex < input.liveListings.length
      const identityComplete = liveReferenceSafe
        ? liveHasCompleteIdentity[liveIndex]
        : false
      const hasSingleIdentifier = !analysis.hasItemId && !analysis.hasVariationKey
      if (
        liveReferenceSafe &&
        identityComplete &&
        hasSingleIdentifier &&
        skuUnique &&
        noCompetingMapping
      ) {
        skuAnchoredRelinkCandidateCount += 1
        if (liveIndex !== undefined) {
          deterministicRelinkLiveIndexes.add(liveIndex)
        }
      } else {
        conflictedRelinkCandidateCount += 1
      }
      continue
    }
    if (analysis.topology === "ITEM_ID_AND_SKU_MATCH_DIFFERENT_LIVE_ROWS" ||
      analysis.topology === "MULTIPLE_ITEM_ID_CANDIDATES" ||
      analysis.topology === "MULTIPLE_SKU_CANDIDATES"
    ) {
      conflictedRelinkCandidateCount += 1
      continue
    }
    if (analysis.topology === "UNPROVEN") {
      noSafeRelinkCandidateCount += 1
      continue
    }
    noSafeRelinkCandidateCount += 1
  }
  const safeRelinkCandidateCount =
    itemIdAnchoredRelinkCandidateCount + skuAnchoredRelinkCandidateCount

  const itemIdOnlyAnalyses = matchAnalyses.filter(
    (analysis) => analysis.topology === "ITEM_ID_ONLY_MATCH",
  )
  const skuOnlyAnalyses = matchAnalyses.filter(
    (analysis) => analysis.topology === "SKU_ONLY_MATCH",
  )
  const noOverlapAnalyses = matchAnalyses.filter(
    (analysis) => analysis.topology === "NO_STABLE_IDENTIFIER_OVERLAP",
  )

  const itemIdOnlyLifecycleClass = (() => {
    if (itemIdOnlyRows === 0) {
      return "UNPROVEN" as const
    }
    const classes: EbayRegistryItemIdOnlyLifecycleClass[] = []
    for (const analysis of itemIdOnlyAnalyses) {
      const liveIndex = analysis.itemMatches[0]
      const liveIndexSafe = liveIndex !== undefined &&
        liveIndex >= 0 &&
        liveIndex < input.liveListings.length
      const liveSku = liveIndexSafe
        ? itemIdSkuVariationIdentityComponent(input.liveListings[liveIndex]?.sku, 120)
        : null
      const liveHasCompleteIdentityForRow = liveIndexSafe
        ? liveHasCompleteIdentity[liveIndex]
        : false
      const conflictingMapping = liveIndexSafe
        ? liveRegistryReferences[liveIndex]?.size > 1
        : false
      if (conflictingMapping) {
        classes.push("CONFLICTED_IDENTITY")
        continue
      }
      if (liveHasCompleteIdentityForRow && analysis.sku !== liveSku && analysis.sku !== null) {
        classes.push("CURRENT_LISTING_STALE_REGISTRY_SKU")
        continue
      }
      if (analysis.sku === null) {
        classes.push("HISTORICAL_RELATION")
        continue
      }
      classes.push("CONFLICTED_IDENTITY")
    }
    const uniqueClassCount = new Set(classes).size
    if (uniqueClassCount === 1) {
      return classes[0]
    }
    return "CONFLICTED_IDENTITY"
  })()

  const itemIdOnlyItemIdUniqueBothSides = (() => {
    if (itemIdOnlyRows === 0) return "UNPROVEN" as const
    const allUnique = itemIdOnlyAnalyses.every((analysis) => {
      const itemId = analysis.itemId ?? ""
      return itemId.length > 0 &&
        getCount(liveItemCounts, itemId) === 1 &&
        getCount(registryRowsByItemIdCount, itemId) === 1
    })
    return allUnique ? "YES" : "NO"
  })()

  const itemIdOnlyRegistrySkuMatchesAnyOtherLive = (() => {
    if (itemIdOnlyRows === 0) return "UNPROVEN" as const
    const matchesAny = itemIdOnlyAnalyses.some((analysis) => {
      const sku = analysis.sku ?? ""
      return sku.length > 0 && getCount(liveSkuCounts, sku) > 0
    })
    return matchesAny ? "YES" : "NO"
  })()

  const itemIdOnlyLiveSkuMatchesAnyOtherRegistryRow = (() => {
    if (itemIdOnlyRows === 0) return "UNPROVEN" as const
    const matchesAny = itemIdOnlyAnalyses.some((analysis) => {
      const liveIndex = analysis.itemMatches[0]
      const liveSku = liveIndex !== undefined && liveIndex >= 0 &&
        liveIndex < input.liveListings.length
        ? itemIdSkuVariationIdentityComponent(input.liveListings[liveIndex]?.sku, 120)
        : null
      return liveSku !== null && getCount(registryRowsBySkuCount, liveSku) > 0
    })
    return matchesAny ? "YES" : "NO"
  })()

  const itemIdOnlyDeterministicRelinkPossible = itemIdOnlyRows === 0
    ? "UNPROVEN"
    : itemIdOnlyAnalyses.every((analysis) => {
      const liveIndex = analysis.itemMatches[0]
      if (liveIndex === undefined) return false
      const hasLiveCompleteIdentity = liveHasCompleteIdentity[liveIndex]
      const noCompetingMapping = (() => {
        const references = liveRegistryReferences[liveIndex]
        return references ? references.size <= 1 : true
      })()
      const singleIdentifier = !analysis.hasSku && !analysis.hasVariationKey
      return hasLiveCompleteIdentity &&
        noCompetingMapping &&
        singleIdentifier
    })
      ? "YES"
      : "NO"

  const skuOnlyRegistryItemIdNotLiveCount = skuOnlyAnalyses.reduce(
    (count, analysis) => (analysis.hasItemId && analysis.itemMatches.length === 0
      ? count + 1
      : count),
    0,
  )
  const skuOnlyUniqueSkuBothSidesCount = skuOnlyAnalyses.reduce(
    (count, analysis) => {
      const sku = analysis.sku ?? ""
      return sku.length > 0 &&
        getCount(liveSkuCounts, sku) === 1 &&
        getCount(registryRowsBySkuCount, sku) === 1 ? count + 1 : count
    },
    0,
  )
  const skuOnlyNoCompetingRegistryRelationCount = skuOnlyAnalyses.reduce(
    (count, analysis) => {
      const liveIndex = analysis.skuMatches[0]
      const competing = (() => {
        if (liveIndex !== undefined && liveIndex >= 0 &&
          liveIndex < input.liveListings.length) {
          const references = liveRegistryReferences[liveIndex]
          return references ? references.size : 0
        }
        return 0
      })()
      return competing <= 1 ? count + 1 : count
    },
    0,
  )

  const skuOnlyRelistCandidateCount = skuOnlyAnalyses.reduce((count, analysis) => {
    const liveIndex = analysis.skuMatches[0]
    if (liveIndex === undefined) return count
    const liveHasCompleteIdentityForRow = liveHasCompleteIdentity[liveIndex]
    const uniqueSku = analysis.sku !== null
      ? getCount(liveSkuCounts, analysis.sku) === 1 &&
        getCount(registryRowsBySkuCount, analysis.sku) === 1
      : false
    const competing = (() => {
      const references = liveRegistryReferences[liveIndex]
      return references ? references.size <= 1 : false
    })()
    const singleIdentifier = !analysis.hasItemId && !analysis.hasVariationKey
    return liveHasCompleteIdentityForRow && uniqueSku && competing && singleIdentifier
      ? count + 1
      : count
  }, 0)
  const skuOnlyStaleRegistryItemIdCount = skuOnlyAnalyses.reduce(
    (count, analysis) => (analysis.hasItemId && analysis.itemMatches.length === 0
      ? count + 1
      : count),
    0,
  )
  const skuOnlySkuReuseRiskCount = skuOnlyAnalyses.reduce((count, analysis) => {
    const sku = analysis.sku ?? ""
    const registrySkuMulti = getCount(registryRowsBySkuCount, sku) > 1
    const liveSkuMulti = sku.length > 0 ? getCount(liveSkuCounts, sku) > 1 : false
    return registrySkuMulti || liveSkuMulti ? count + 1 : count
  }, 0)
  const skuOnlyConflictedIdentityCount = skuOnlyAnalyses.reduce(
    (count, analysis) => {
      const liveIndex = analysis.skuMatches[0]
      const noSkuOnlyIdentity = !analysis.hasSku || analysis.sku === null
      const competing = (() => {
        if (liveIndex === undefined) return false
        const references = liveRegistryReferences[liveIndex]
        return references ? references.size > 1 : false
      })()
      const needsNoSku = noSkuOnlyIdentity || competing || analysis.hasItemId
      const skuReuse = analysis.sku !== null && (
        getCount(registryRowsBySkuCount, analysis.sku) > 1 ||
        getCount(liveSkuCounts, analysis.sku) > 1
      )
      return (needsNoSku || skuReuse) ? count + 1 : count
    },
    0,
  )
  const skuOnlyUnprovenCount = Math.max(
    skuOnlyRows - skuOnlyRelistCandidateCount - skuOnlyStaleRegistryItemIdCount -
      skuOnlySkuReuseRiskCount - skuOnlyConflictedIdentityCount,
    0,
  )
  const skuOnlyDeterministicRelinkCandidateCount = skuOnlyRows > 0
    ? skuOnlyRelistCandidateCount
    : 0

  const noOverlapHistoricalOrStaleCount = noOverlapAnalyses.reduce(
    (count, analysis) => {
      if (analysis.itemId || analysis.sku) {
        const listingStatus = (analysis.listingStatus ?? "").toLowerCase()
        return listingStatus !== "active" ? count + 1 : count
      }
      return count
    },
    0,
  )
  const noOverlapCurrentIdentityDriftCount = noOverlapAnalyses.reduce(
    (count, analysis) => {
      if (analysis.itemId || analysis.sku) {
        const listingStatus = (analysis.listingStatus ?? "").toLowerCase()
        return listingStatus === "active" &&
          (analysis.itemId !== null || analysis.sku !== null)
          ? count + 1
          : count
      }
      return count
    },
    0,
  )
  const noOverlapUnrelatedCount = noOverlapAnalyses.reduce(
    (count, analysis) => (!analysis.hasItemId && !analysis.hasSku ? count + 1 : count),
    0,
  )
  const noOverlapUnprovenCount = Math.max(
    noStableIdentifierOverlapRows -
      noOverlapHistoricalOrStaleCount -
      noOverlapCurrentIdentityDriftCount -
      noOverlapUnrelatedCount,
    0,
  )
  const registryStaleActiveRowsPresent = noOverlapAnalyses.some((analysis) => {
    const listingStatus = (analysis.listingStatus ?? "").toLowerCase()
    return listingStatus === "active" &&
      (analysis.itemId !== null || analysis.sku !== null)
  })
    ? "YES" as const
    : "NO" as const

  const certRelationshipIndexSet = new Set<number>([
    ...Array.from(liveIndexesWithFullMatch),
    ...Array.from(deterministicRelinkLiveIndexes),
  ])

  const certifiedExistingRelationshipCount = liveIndexesWithFullMatch.size
  const certifiedRelinkCandidateCount = safeRelinkCandidateCount
  const unresolvedRelationshipCount = Math.max(
    input.liveListings.length - (certifiedExistingRelationshipCount + certifiedRelinkCandidateCount),
    0,
  )
  const trueNewEntryCandidateCount = input.liveListings.length -
    certRelationshipIndexSet.size
  const registryRepairPlanCertified = certRelationshipIndexSet.size >= 0
    ? "YES"
    : "UNPROVEN"
  const planRelinkExistingCount = certifiedRelinkCandidateCount
  const planCreateNewCount = trueNewEntryCandidateCount
  const planMarkStaleOrHistoricalCount = Math.min(
    input.registryRows.length,
    noOverlapHistoricalOrStaleCount + noOverlapCurrentIdentityDriftCount,
  )
  const planRequireHumanReviewCount = unresolvedRelationshipCount
  const automatedMutationSafe = (
    crossLinkConflictCount === 0 &&
    conflictedRelinkCandidateCount === 0 &&
    noSafeRelinkCandidateCount === 0 &&
    planRequireHumanReviewCount === 0 &&
    unresolvedRelationshipCount === 0
  ) ? "YES" : "NO" as const

  const lifecycleFieldNames = [
    "listing_status",
    "source",
    "ebay_item_id",
    "ebay_sku",
    "ebay_variation_key",
    "created_at",
    "updated_at",
    "last_ebay_sync_at",
    "account_key",
  ].join(",")
  const provenanceFieldNames = [
    "source",
    "account_key",
    "created_at",
    "updated_at",
    "last_ebay_sync_at",
  ].join(",")
	const registryHasActiveState = input.registryRows.length === 0
	  ? "NO" : "YES"
  const registryHasLastSeenSignal = input.registryRows.some((row) => Boolean(
    row.last_ebay_sync_at,
  ))
    ? "YES"
    : "NO"
  const registryHasProductCaseLink = "NO" as const
  const registryHasSourceOrigin = input.registryRows.length === 0
    ? "NO"
    : "YES"

  const itemIdOnlyAccountMarketplaceCompatible = input.registryRows.length === 0
    ? "UNPROVEN" as const
    : "YES"
  const isEbayItemIdAuthoritative = input.liveListings.length > 0 &&
  input.registryRows.length > 0
    ? itemIdOnlyRows > 0 || fullMatchRows > 0 || skuOnlyRows > 0 ||
      noStableIdentifierOverlapRows > 0
      ? "YES"
      : "NO"
    : "UNPROVEN"
  const isSkuAllowedAsRelistContinuitySignal = input.registryRows.length === 0 ||
    input.liveListings.length === 0
    ? "UNPROVEN"
    : skuOnlySkuReuseRiskCount > 0 || skuOnlyConflictedIdentityCount > 0 ||
      skuOnlyDeterministicRelinkCandidateCount === 0
      ? "NO"
      : "YES"

  const liveReferencedByRegistryItemIdCount = liveReferencedByRegistryItemId
    .filter(Boolean).length
  const liveReferencedByRegistrySkuCount = liveReferencedByRegistrySku
    .filter(Boolean).length
  const liveReferencedByBothSameRegistryRowCount = liveReferencedByBothSameRegistryRow
    .filter(Boolean).length
  const liveReferencedByConflictingRegistryRowsCount = liveRegistryReferences
    .reduce((count, references) =>
      (references.size > 1 ? count + 1 : count), 0)
  const liveWithAnyStableReferenceCount = liveRegistryReferences
    .reduce((count, references) => (references.size > 0 ? count + 1 : count), 0)
  const liveWithNoStableRegistryReferenceCount =
    input.liveListings.length - liveWithAnyStableReferenceCount
  const liveNewRegistryEntryCandidateCount = liveWithNoStableRegistryReferenceCount

  const safeAutomatedRelink = crossLinkConflictCount > 0 ||
    conflictedRelinkCandidateCount > 0
      ? "NO"
      : safeRelinkCandidateCount > 0 ? "YES" : "NO"
  const safeNewEntryBackfillPossible = crossLinkConflictCount === 0 &&
    conflictedRelinkCandidateCount === 0 &&
    noSafeRelinkCandidateCount === 0 &&
    liveNewRegistryEntryCandidateCount > 0 ? "YES" : "NO"
  const liveNonVariationCount = liveWithVariationKeyByIndex
    .filter((value) => !value).length
  const registryNonVariationCount = input.registryRows.filter((row) => {
    return itemIdSkuVariationIdentityComponent(
      row.ebay_variation_key ?? null,
      120,
    ) === null
  }).length
  const variationKeyRequiredForNonVariation:
    "YES" | "NO" | "UNPROVEN" =
    liveNonVariationCount > 0 && registryNonVariationCount > 0
      ? "NO"
      : "UNPROVEN"
  const emptyVariationCanonicalForNonVariation:
    "YES" | "NO" | "UNPROVEN" =
    liveNonVariationCount > 0 && registryNonVariationCount > 0
      ? "YES"
      : "UNPROVEN"
  let variationSemanticsCauseCurrentZeroMatch:
    "YES" | "NO" | "UNPROVEN" = "NO"
  if (variationKeyRequiredForNonVariation === "UNPROVEN" ||
    emptyVariationCanonicalForNonVariation === "UNPROVEN") {
    variationSemanticsCauseCurrentZeroMatch = "UNPROVEN"
  } else {
    variationSemanticsCauseCurrentZeroMatch = "NO"
  }

  const topologyPartitionValid = (
    fullMatchRows +
    itemIdOnlyRows +
    skuOnlyRows +
    crossLinkedRows +
    multipleItemIdCandidateRows +
    multipleSkuCandidateRows +
    noStableIdentifierOverlapRows +
    topologyUnprovenRows
  ) === input.registryRows.length ? "YES" : "NO"

  return {
    liveCount: input.liveListings.length,
    registryCount: input.registryRows.length,
    matched,
    missing,
    orphaned: registryOrphaned + registryMissingIdentityCount,
    ambiguous: liveIdentityMissingCount + registryMissingIdentityCount +
      duplicatedLiveComposite + duplicatedRegistryComposite,
    liveWithItemIdCount,
    liveWithSkuCount,
    liveWithVariationKeyCount,
    liveWithCompleteCompositeCount,
    registryWithItemIdCount,
    registryWithSkuCount,
    registryWithVariationKeyCount,
    registryWithCompleteCompositeCount,
    itemIdExactOverlapCount,
    skuExactOverlapCount,
    variationKeyExactOverlapCount,
    itemIdPlusSkuOverlapCount,
    itemIdPlusVariationOverlapCount,
    skuPlusVariationOverlapCount,
    fullCompositeOverlapCount,
    registryCurrentIdentityCount,
    registryLegacyIdentityCount,
    registryIncompleteIdentityCount,
    registryHistoricalOnlyCount,
    registryIdentityUnprovenCount,
    registryIdentityRootCause,
    safeBackfillWithoutDuplication,
    fullMatchRows,
    itemIdOnlyRows,
    skuOnlyRows,
    crossLinkedRows,
    multipleItemIdCandidateRows,
    multipleSkuIdCandidateRows: multipleSkuCandidateRows,
    noStableIdentifierOverlapRows,
    topologyUnprovenRows,
    topologyPartitionValid,
    liveReferencedByRegistryItemIdCount,
    liveReferencedByRegistrySkuCount,
    liveReferencedByBothSameRegistryRowCount,
    liveReferencedByConflictingRegistryRowsCount,
    liveWithNoStableRegistryReferenceCount,
    crossLinkConflictCount,
    itemIdAnchoredRelinkCandidateCount,
    skuAnchoredRelinkCandidateCount,
    conflictedRelinkCandidateCount,
    noSafeRelinkCandidateCount,
    safeRelinkCandidateCount,
    safeAutomatedRelink,
    liveNewRegistryEntryCandidateCount,
    safeNewEntryBackfillPossible,
    variationKeyRequiredForNonVariation,
    emptyVariationCanonicalForNonVariation,
    variationSemanticsCauseCurrentZeroMatch,
    registryLifecycleFields: lifecycleFieldNames,
    registryProvenanceFields: provenanceFieldNames,
    registryHasActiveState,
    registryHasLastSeenSignal,
    registryHasProductCaseLink,
    registryHasSourceOrigin,
    noOverlapHistoricalOrStaleCount,
    noOverlapCurrentIdentityDriftCount,
    noOverlapUnrelatedCount,
    noOverlapUnprovenCount,
    registryStaleActiveRowsPresent,
    itemIdOnlyLifecycleClass,
    itemIdOnlyItemIdUniqueBothSides,
    itemIdOnlyRegistrySkuMatchesAnyOtherLive,
    itemIdOnlyLiveSkuMatchesAnyOtherRegistryRow,
    itemIdOnlyAccountMarketplaceCompatible,
    itemIdOnlyDeterministicRelinkPossible,
    skuOnlyRegistryItemIdNotLiveCount,
    skuOnlyUniqueSkuBothSidesCount,
    skuOnlyNoCompetingRegistryRelationCount,
	    skuOnlyRelistCandidateCount,
	    skuOnlyStaleRegistryItemIdCount,
	    skuOnlySkuReuseRiskCount,
	    skuOnlyConflictedIdentityCount,
	    skuOnlyUnprovenCount,
	    skuOnlyDeterministicRelinkCandidateCount,
	    certifiedExistingRelationshipCount,
    certifiedRelinkCandidateCount,
    unresolvedRelationshipCount,
    trueNewEntryCandidateCount,
    planRelinkExistingCount,
    planCreateNewCount,
    planMarkStaleOrHistoricalCount,
    planRequireHumanReviewCount,
    registryRepairPlanCertified,
    automatedMutationSafe,
    isEbayItemIdAuthoritative,
    isSkuAllowedAsRelistContinuitySignal,
    livePartitionValid,
    registryPartitionValid,
  }
}

function addToIndexMap(indexBuckets: Map<string, Set<number>>, key: string, index: number) {
  const existing = indexBuckets.get(key)
  if (existing) {
    existing.add(index)
  } else {
    indexBuckets.set(key, new Set([index]))
  }
}

function getIndexes(indexBuckets: Map<string, Set<number>>, key: string) {
  return Array.from(indexBuckets.get(key) ?? [])
}

function intersectIndexes(first: number[], second: number[]) {
  if (first.length === 0 || second.length === 0) return []
  const secondSet = new Set(second)
  return first.filter((candidate) => secondSet.has(candidate))
}

function liveHasVariationKeyByNoVariation(
  _liveWithVariationKeyByIndex: boolean[],
  _liveListings: EbayLiveListing[],
  _registryRows: ReadonlyRegistryListingRow[],
  _itemIdPlusSkuOverlapCount: number,
) {
  return _itemIdPlusSkuOverlapCount > 0
}

export type EbayCommercialMonitorLiveReadonlyResult = {
  contractVersion: typeof EBAY_MONITOR_LIVE_READONLY_CONTRACT_VERSION
  mode: "READ_ONLY"
  environment: "PRODUCTION"
  marketplaceId: "EBAY_US"
  account: {
    status: "CERTIFIED" | "PARTIAL" | "BLOCKED"
    accountAlias: string | null
    bindingConfigured: boolean
    bindingMatched: boolean
    observedAt: string | null
    source:
      | "EBAY_TRADING_GET_USER"
      | "EBAY_SELL_FULFILLMENT_GET_ORDERS_SELLER_ID"
      | "LOCAL_CONFIGURATION"
    limitationCode: string | null
  }
  oauth: {
    status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "ERROR"
    tokenReceived: boolean
    tokenPersisted: false
    tokenReturned: false
    expiryKnown: boolean
    earliestAccessTokenExpiryAt: string | null
    scopes: EbayMonitorScopeEvidence[]
  }
  discovery: {
    status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "ERROR"
    coverage: "COMPLETE" | "PARTIAL" | "UNPROVEN"
    observedAt: string | null
    source: "EBAY_TRADING_GET_MY_EBAY_SELLING"
    sellerWideEnumeration: {
      identities: EbaySellerWideEnumerationIdentity[]
      itemSetComplete: boolean
      identitySetComplete: boolean
    }
    currentLiveListings: EbayLiveListing[]
    listings: EbayLiveListing[]
    pagesRead: number
    totalPages: number | null
    totalEntries: number | null
    marketplaceCertification: EbayMarketplaceCertificationCounters
    gapCodes: string[]
    inventory: EbayLiveInventoryResult
    inventoryRepresentation: EbayLiveInventoryRepresentation
  }
  analytics: {
    status: "CERTIFIED" | "PARTIAL" | "UNAVAILABLE"
    observedAt: string | null
    windowStart: string | null
    windowEnd: string | null
    analyticsRequestedItemCount: number | null
    analyticsRepresentedItemCount: number | null
    analyticsMissingItemCount: number | null
    analyticsCoverageStatus: "COMPLETE" | "PARTIAL" | "UNPROVEN"
    accountTraffic: AccountTrafficEvidenceV1
    observations: EbayLiveAnalyticsObservation[]
    gapCodes: string[]
  }
  orders: {
    status: "CERTIFIED" | "PARTIAL" | "UNAVAILABLE"
    observedAt: string | null
    windowStart: string | null
    windowEnd: string | null
    orders: SafeLiveEbayOrder[]
    pagesRead: number
    rawOrdersDiscardedAfterSanitization: number
    observedOrderEvidenceKeys: string[]
    gapCodes: string[]
  }
  calls: EbayMonitorReadonlyCallEvidence[]
  safety: {
    marketplaceWrites: 0
    databaseWrites: 0
    inventoryWrites: 0
    listingRevisions: 0
    listingEnds: 0
    fulfillmentWrites: 0
    buyerMessages: 0
    whatsappCalls: 0
    tokensReturned: false
    rawPayloadsReturned: false
    buyerPiiReturned: false
  }
}

export type EbayInventoryConsumerSafeErrorCategory =
  | "NONE"
  | EbayMonitorOAuthSafeErrorCategory
  | "HTTP_401"
  | "HTTP_403"
  | "HTTP_4XX"
  | "HTTP_5XX"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK"
  | "BUDGET_EXHAUSTED"
  | "ACCOUNT_BINDING_FAILED"
  | "RESPONSE_FORMAT_CHANGED"
  | "CONFIGURATION_MISSING"
  | "UNCLASSIFIED"

export type EbayInstalledInventoryConsumerDiagnostic = {
  credentialSource: "GENERIC_ENV_TOKEN_ONLY"
  genericEnvironmentTokenFallback: false
  inventoryItemsHttpStatus: number | null
  inventoryItemsAuthorized: boolean
  inventoryItemsContentType: "application/json" | "OTHER" | null
  inventoryItemsTopLevelKeys: string[]
  inventoryItemsHasArray: boolean
  inventoryItemsArrayCount: number | null
  inventoryItemsTotalPresent: boolean
  inventoryItemsTotal: number | null
  inventoryItemsNextPresent: boolean
  inventoryItemsResponseShape:
    | "INVENTORY_ITEMS_ARRAY"
    | "CERTIFIED_EMPTY_OMITTED_ARRAY"
    | "INVALID"
    | "UNPROVEN"
  inventoryCatalogState: "EMPTY" | "NON_EMPTY" | "UNPROVEN"
  inventoryItemsSafeErrorCategory: EbayInventoryConsumerSafeErrorCategory
  variants: {
    currentCanonical: EbayInventoryConsumerVariantEvidence
    noMarketplaceHeader: EbayInventoryConsumerVariantEvidence
    limitOnly: EbayInventoryConsumerVariantEvidence
    noQuery: EbayInventoryConsumerVariantEvidence
  }
  firstAcceptedVariant: EbayInventoryConsumerVariant | null
  minimumDocumentedAcceptedVariant: EbayInventoryConsumerVariant | null
  requestContractRootCause:
    | "CURRENT_CANONICAL_ACCEPTED"
    | "MARKETPLACE_HEADER_REJECTED"
    | "OFFSET_ZERO_REJECTED"
    | "LIMIT_QUERY_REJECTED"
    | "SCOPE_MINTING_DIFFERENCE"
    | "ALL_DOCUMENTED_VARIANTS_REJECTED"
    | "UNPROVEN"
  scopeControl: {
    subsetScopeRefresh: "AVAILABLE" | "FAILED"
    fourScopeRefresh: "AVAILABLE" | "FAILED" | "NOT_RUN"
    subsetScopeInventoryItemsStatus: number | null
    fourScopeInventoryItemsStatus: number | null
    scopeMintingDifferenceCauses400: "YES" | "NO" | "UNPROVEN"
  }
  execution: {
    globalCallsBeforeInventory: number | null
    globalTimeRemainingBeforeInventoryMs: number | null
    inventoryRefreshExecuted: boolean
    inventoryGetUserExecuted: boolean
    inventoryGetItemsExecuted: boolean
    fourScopeRefreshExecuted: boolean
    fourScopeInventoryGetItemsExecuted: boolean
    inventoryFailureFromBudget: boolean
    externalCalls: number
    maximumExternalCalls: 8
  }
  calls: EbayMonitorReadonlyCallEvidence[]
  safety: {
    tokenPersisted: false
    tokenReturned: false
    rawPayloadReturned: false
    authorizationHeaderReturned: false
    ledgerMutations: 0
    ebayWrites: 0
    inventoryWrites: 0
    businessDataMutations: 0
    registryMutations: 0
    productCaseMutations: 0
    vaultMutations: 0
    vercelMutations: 0
  }
}

export type EbayInventoryConsumerVariant =
  | "CURRENT_CANONICAL"
  | "NO_MARKETPLACE_HEADER"
  | "LIMIT_ONLY"
  | "NO_QUERY"

export type EbayInventoryConsumerVariantEvidence = {
  variant: EbayInventoryConsumerVariant
  httpStatus: number | null
  acceptedByEndpoint: boolean
  contentType: "application/json" | "OTHER" | null
  responseShape:
    | "INVENTORY_ITEMS_ARRAY"
    | "CERTIFIED_EMPTY_OMITTED_ARRAY"
    | "INVALID"
    | "UNPROVEN"
  catalogState: "EMPTY" | "NON_EMPTY" | "UNPROVEN"
  safeErrorCategory: EbayInventoryConsumerSafeErrorCategory
  errorMetadata: SafeEbayInventoryErrorMetadata
}

type TokenResult = {
  value: string
  expiresAt: string
  returnedScopes: string[]
  returnedScopeEntries: string[]
  scopeListReturned: boolean
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function text(value: unknown, maximum = 200) {
  if (typeof value !== "string") return ""
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum)
}

function listingIdentityComponent(value: string | null, maximum: number) {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maximum) : null
}

function itemIdSkuVariationIdentityKey(input: {
  itemId: string
  sku: string | null
  variationKey: string | null
}) {
  return JSON.stringify([
    itemIdSkuVariationIdentityComponent(input.itemId, 120),
    itemIdSkuVariationIdentityComponent(input.sku, 120),
    itemIdSkuVariationIdentityComponent(input.variationKey, 120),
  ])
}

function itemIdSkuVariationIdentityComponent(
  value: string | null,
  maximum: number,
) {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maximum) : null
}

function itemSkuIdentityKey(itemId: string, sku: string | null) {
  return JSON.stringify([
    itemId,
    listingIdentityComponent(sku, 120),
  ])
}

function number(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return null
  if (typeof value === "string" && !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function analyticsMetricNumber(value: unknown) {
  let candidate = value
  for (let depth = 0; depth < 4; depth += 1) {
    const nested = record(candidate)
    if (!Object.hasOwn(nested, "value")) break
    candidate = nested.value
  }
  const parsed = number(candidate)
  return parsed !== null && parsed >= 0 ? parsed : null
}

function nonNegativeInteger(value: unknown) {
  const parsed = number(value)
  return parsed !== null && parsed >= 0 && Number.isSafeInteger(parsed)
    ? parsed
    : null
}

function safeCode(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message) ? message : fallback
}

function monitorOAuthFailureCategory(
  payload: unknown,
): EbayMonitorOAuthSafeErrorCategory {
  const rawError = text(record(payload).error, 80).toLowerCase()
  if (rawError === "invalid_scope") return "INVALID_SCOPE"
  if (rawError === "invalid_grant") return "INVALID_GRANT"
  if (rawError === "invalid_client") return "INVALID_CLIENT"
  if (rawError === "invalid_request") return "INVALID_REQUEST"
  if (rawError === "unsupported_grant_type") return "UNSUPPORTED_GRANT_TYPE"
  return "OAUTH_ERROR_UNCLASSIFIED"
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function escapedXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;")
}

function emptyInventory(
  status: EbayLiveInventoryResult["status"] = "UNAVAILABLE",
  code = "INVENTORY_READ_NOT_ATTEMPTED",
): EbayLiveInventoryResult {
  return {
    status,
    observedAt: null,
    inventorySkuCount: null,
    publishedListingIds: [],
    publishedOffers: [],
    gapCodes: [code],
  }
}

function unavailableResult(input: {
  accountAlias: string | null
  limitationCode: string
  bindingConfigured: boolean
}): EbayCommercialMonitorLiveReadonlyResult {
  return {
    contractVersion: EBAY_MONITOR_LIVE_READONLY_CONTRACT_VERSION,
    mode: "READ_ONLY",
    environment: "PRODUCTION",
    marketplaceId: MARKETPLACE_ID,
    account: {
      status: "BLOCKED",
      accountAlias: input.accountAlias,
      bindingConfigured: input.bindingConfigured,
      bindingMatched: false,
      observedAt: null,
      source: "LOCAL_CONFIGURATION",
      limitationCode: input.limitationCode,
    },
    oauth: {
      status: "UNAVAILABLE",
      tokenReceived: false,
      tokenPersisted: false,
      tokenReturned: false,
      expiryKnown: false,
      earliestAccessTokenExpiryAt: null,
      scopes: [
        BASE_SCOPE,
        INVENTORY_READONLY_SCOPE,
        ANALYTICS_READONLY_SCOPE,
        FULFILLMENT_READONLY_SCOPE,
      ].map((scope) => ({
        scope,
        classifications: ["READ_REQUIRED"],
        evidenceOperation: null,
      })),
    },
    discovery: {
      status: "UNAVAILABLE",
      coverage: "UNPROVEN",
      observedAt: null,
      source: "EBAY_TRADING_GET_MY_EBAY_SELLING",
      sellerWideEnumeration: {
        identities: [],
        itemSetComplete: false,
        identitySetComplete: false,
      },
      currentLiveListings: [],
      listings: [],
      pagesRead: 0,
      totalPages: null,
      totalEntries: null,
      marketplaceCertification: {
        sellerWideItemsReported: null,
        sellerWideItemsParsed: null,
        sellerWideItemsMarketplaceCertifiedUs: null,
        sellerWideItemsMarketplaceCertifiedNonUs: null,
        sellerWideItemsMarketplaceUnresolved: null,
        sellerWideItemsMarketplaceError: null,
        sellerWideItemsMarketplaceBudgetExhausted: null,
        sellerWideItemsMarketplaceItemIdMismatch: null,
        sellerWideItemsRepresented: null,
      },
      gapCodes: [
        input.limitationCode,
        "COVERAGE_GAP_DOES_NOT_PROVE_ZERO_LISTINGS",
      ],
      inventory: emptyInventory(),
      inventoryRepresentation: {
        status: "UNPROVEN",
        classificationGrain: "ITEM_SKU",
        representedCount: null,
        notRepresentedCount: null,
        identityUnresolvedCount: null,
        sourceUnprovenCount: null,
      },
    },
    analytics: {
      status: "UNAVAILABLE",
      observedAt: null,
      windowStart: null,
      windowEnd: null,
      analyticsRequestedItemCount: null,
      analyticsRepresentedItemCount: null,
      analyticsMissingItemCount: null,
      analyticsCoverageStatus: "UNPROVEN",
      accountTraffic: unavailableAccountTrafficV1(
        "ANALYTICS_READ_NOT_AVAILABLE",
      ),
      observations: [],
      gapCodes: [input.limitationCode, "NO_EVIDENCE_DOES_NOT_PROVE_ZERO"],
    },
    orders: {
      status: "UNAVAILABLE",
      observedAt: null,
      windowStart: null,
      windowEnd: null,
      orders: [],
      pagesRead: 0,
      rawOrdersDiscardedAfterSanitization: 0,
      observedOrderEvidenceKeys: [],
      gapCodes: [input.limitationCode, "NO_EVIDENCE_DOES_NOT_PROVE_ZERO"],
    },
    calls: [],
    safety: {
      marketplaceWrites: 0,
      databaseWrites: 0,
      inventoryWrites: 0,
      listingRevisions: 0,
      listingEnds: 0,
      fulfillmentWrites: 0,
      buyerMessages: 0,
      whatsappCalls: 0,
      tokensReturned: false,
      rawPayloadsReturned: false,
      buyerPiiReturned: false,
    },
  }
}

function generalCredentials(environment: NodeJS.ProcessEnv) {
  return {
    clientId: environment.EBAY_CLIENT_ID?.trim() ?? "",
    clientSecret: environment.EBAY_CLIENT_SECRET?.trim() ?? "",
    refreshToken: environment.EBAY_SELLER_REFRESH_TOKEN?.trim() ?? "",
  }
}

function fulfillmentCredentials(environment: NodeJS.ProcessEnv) {
  const general = generalCredentials(environment)
  const dedicatedClientId =
    environment.EBAY_COMMERCIAL_ORDERS_CLIENT_ID?.trim() ?? ""
  const dedicatedClientSecret =
    environment.EBAY_COMMERCIAL_ORDERS_CLIENT_SECRET?.trim() ?? ""
  const dedicatedRefresh =
    environment.EBAY_COMMERCIAL_ORDERS_REFRESH_TOKEN?.trim() ?? ""
  return {
    clientId: dedicatedClientId || general.clientId,
    clientSecret: dedicatedClientSecret || general.clientSecret,
    refreshToken: dedicatedRefresh,
    partialDedicatedClient:
      Boolean(dedicatedClientId) !== Boolean(dedicatedClientSecret),
  }
}

function canonicalTradingCredentials(environment: NodeJS.ProcessEnv) {
  const fulfillment = fulfillmentCredentials(environment)
  if (fulfillment.refreshToken && !fulfillment.partialDedicatedClient) {
    return {
      clientId: fulfillment.clientId,
      clientSecret: fulfillment.clientSecret,
      refreshToken: fulfillment.refreshToken,
    }
  }
  return generalCredentials(environment)
}

function callEvidence(input: {
  operation: EbayMonitorReadonlyOperation
  method: "GET" | "POST"
  endpoint: string
  status: "SUCCEEDED" | "FAILED"
  httpStatus: number | null
  observedAt: string
}): EbayMonitorReadonlyCallEvidence {
  return {
    ...input,
    marketplaceMutation: false,
    persisted: false,
  }
}

async function allowlistedFetch(input: {
  operation: EbayMonitorReadonlyOperation
  method: "GET" | "POST"
  url: URL | string
  tradingCallName?:
    | "GetUser"
    | "GetMyeBaySelling"
    | "GetSellerList"
    | "GetItem"
  headers?: HeadersInit
  body?: BodyInit
  fetchImpl: FetchLike
  calls: EbayMonitorReadonlyCallEvidence[]
  clock: Clock
}) {
  const tradingHeaders = new Headers(input.headers)
  const tradingBody = typeof input.body === "string" ? input.body : null
  assertEbayMonitorReadonlyRequest({
    operation: input.operation,
    method: input.method,
    url: input.url,
    requestHeaderNames: [...tradingHeaders.keys()].map((name) =>
      name.toLowerCase()).sort(),
    marketplaceIdHeader: tradingHeaders.get("X-EBAY-C-MARKETPLACE-ID"),
    tradingCallName: input.tradingCallName,
    tradingHeaderCallName: tradingHeaders.get("X-EBAY-API-CALL-NAME"),
    tradingBody,
  })
  const budget = requestBudgets.get(input.calls)
  const remainingMs = budget ? budget.deadlineAt - Date.now() : REQUEST_TIMEOUT_MS
  if (budget && (budget.callsRemaining <= 0 || remainingMs < 250)) {
    throw new Error("EBAY_MONITOR_REQUEST_BUDGET_EXHAUSTED")
  }
  if (budget) {
    budget.callsRemaining -= 1
    budget.callsStarted += 1
  }
  try {
    const response = await input.fetchImpl(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(Math.max(
        1,
        Math.min(REQUEST_TIMEOUT_MS, remainingMs),
      )),
    })
    const evidence = callEvidence({
      operation: input.operation,
      method: input.method,
      endpoint: new URL(input.url).pathname,
      status: response.ok ? "SUCCEEDED" : "FAILED",
      httpStatus: response.status,
      observedAt: input.clock().toISOString(),
    })
    input.calls.push(evidence)
    callEvidenceByResponse.set(response, evidence)
    return response
  } catch (error) {
    input.calls.push(callEvidence({
      operation: input.operation,
      method: input.method,
      endpoint: new URL(input.url).pathname,
      status: "FAILED",
      httpStatus: null,
      observedAt: input.clock().toISOString(),
    }))
    throw new Error(error instanceof DOMException && error.name === "TimeoutError"
      ? "EBAY_MONITOR_READ_TIMEOUT"
      : "EBAY_MONITOR_READ_NETWORK_ERROR")
  }
}

function markResponseCallFailed(response: Response) {
  const call = callEvidenceByResponse.get(response)
  if (call) call.status = "FAILED"
}

async function readJsonResponse(input: {
  response: Response
  calls: EbayMonitorReadonlyCallEvidence[]
  operation: EbayMonitorReadonlyOperation
  errorCode: string
}) {
  try {
    return await input.response.json() as unknown
  } catch {
    markResponseCallFailed(input.response)
    throw new Error(input.errorCode)
  }
}

async function readTextResponse(
  response: Response,
  errorCode: string,
) {
  try {
    return await response.text()
  } catch {
    markResponseCallFailed(response)
    throw new Error(errorCode)
  }
}

type ScopeGrantEvidence = {
  granted: Set<string>
  missing: Set<string>
  bindingVerified: boolean
}

function scopeGrantEvidence(): ScopeGrantEvidence {
  return {
    granted: new Set<string>(),
    missing: new Set<string>(),
    bindingVerified: false,
  }
}

function registerScopeEvidence(input: {
  ledger: ScopeGrantEvidence
  token: TokenResult
  requestedScopes: string[]
}) {
  for (const scope of input.token.returnedScopes) {
    input.ledger.granted.add(scope)
  }
  if (!input.token.scopeListReturned) return []
  const missing = input.requestedScopes.filter((scope) =>
    !input.token.returnedScopes.includes(scope))
  for (const scope of missing) {
    if (!input.ledger.granted.has(scope)) input.ledger.missing.add(scope)
  }
  return missing
}

function returnedScopeSetIsExact(
  token: TokenResult,
  expectedScopes: string[],
) {
  if (!token.scopeListReturned) return true
  const returned = new Set(token.returnedScopeEntries)
  return token.returnedScopeEntries.length === expectedScopes.length &&
    returned.size === expectedScopes.length &&
    expectedScopes.every((scope) => returned.has(scope))
}

function assertExactReadonlyRefreshScopes(input: {
  operation: "OAUTH_REFRESH_TRADING" | "OAUTH_REFRESH_INVENTORY" |
    "OAUTH_REFRESH_INVENTORY_FOUR_SCOPE" |
    "OAUTH_REFRESH_ANALYTICS" | "OAUTH_REFRESH_FULFILLMENT"
  scopes: string[]
}) {
  const expected = input.operation === "OAUTH_REFRESH_TRADING"
    ? [BASE_SCOPE]
    : input.operation === "OAUTH_REFRESH_INVENTORY"
      ? [BASE_SCOPE, INVENTORY_READONLY_SCOPE]
      : input.operation === "OAUTH_REFRESH_INVENTORY_FOUR_SCOPE"
        ? [
            BASE_SCOPE,
            ACCOUNT_READONLY_SCOPE,
            INVENTORY_READONLY_SCOPE,
            ANALYTICS_READONLY_SCOPE,
          ]
        : input.operation === "OAUTH_REFRESH_ANALYTICS"
          ? [BASE_SCOPE, ANALYTICS_READONLY_SCOPE]
          : [BASE_SCOPE, FULFILLMENT_READONLY_SCOPE]
  if (input.scopes.length !== expected.length ||
      input.scopes.some((scope, index) => scope !== expected[index])) {
    throw new Error("EBAY_MONITOR_BLOCKED_OAUTH_SCOPE_REQUEST")
  }
}

async function accessToken(input: {
  operation: "OAUTH_REFRESH_TRADING" | "OAUTH_REFRESH_INVENTORY" |
    "OAUTH_REFRESH_INVENTORY_FOUR_SCOPE" |
    "OAUTH_REFRESH_ANALYTICS" | "OAUTH_REFRESH_FULFILLMENT"
  credentials: { clientId: string; clientSecret: string; refreshToken: string }
  scopes: string[]
  fetchImpl: FetchLike
  calls: EbayMonitorReadonlyCallEvidence[]
  clock: Clock
}) : Promise<TokenResult> {
  assertExactReadonlyRefreshScopes(input)
  if (!input.credentials.clientId || !input.credentials.clientSecret ||
      !input.credentials.refreshToken) {
    throw new Error("EBAY_MONITOR_OAUTH_CONFIGURATION_MISSING")
  }
  const basic = Buffer.from(
    `${input.credentials.clientId}:${input.credentials.clientSecret}`,
    "utf8",
  ).toString("base64")
  const response = await allowlistedFetch({
    operation: input.operation,
    method: "POST",
    url: OAUTH_ENDPOINT,
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.credentials.refreshToken,
      scope: input.scopes.join(" "),
    }),
    fetchImpl: input.fetchImpl,
    calls: input.calls,
    clock: input.clock,
  })
  if (!response.ok) {
    let failurePayload: unknown = {}
    try {
      failurePayload = await response.json() as unknown
    } catch {
      failurePayload = {}
    }
    const category = monitorOAuthFailureCategory(failurePayload)
    failurePayload = null
    throw new Error(`EBAY_MONITOR_${input.operation}_${category}`)
  }
  const payload = record(await readJsonResponse({
    response,
    calls: input.calls,
    operation: input.operation,
    errorCode: "EBAY_MONITOR_OAUTH_RESPONSE_INVALID",
  }))
  const value = text(payload.access_token, 20_000)
  const expiresIn = nonNegativeInteger(payload.expires_in)
  if (!value || expiresIn === null || expiresIn < 60) {
    markResponseCallFailed(response)
    throw new Error("EBAY_MONITOR_OAUTH_RESPONSE_INVALID")
  }
  const scopePresent = Object.hasOwn(payload, "scope")
  const rawScope = payload.scope
  if (scopePresent && (typeof rawScope !== "string" ||
      rawScope.length > 4_000 || !rawScope.trim() ||
      /[\u0000-\u001f\u007f]/.test(rawScope))) {
    markResponseCallFailed(response)
    throw new Error("EBAY_MONITOR_OAUTH_SCOPE_FORMAT_INVALID")
  }
  const scopeText = scopePresent ? (rawScope as string).trim() : ""
  const returnedScopeEntries = scopeText.split(/\s+/).filter(Boolean)
  const returnedScopes = returnedScopeEntries.filter((scope) =>
    scope.startsWith("https://api.ebay.com/oauth/api_scope"))
  return {
    value,
    expiresAt: new Date(
      input.clock().getTime() + expiresIn * 1_000,
    ).toISOString(),
    returnedScopes,
    returnedScopeEntries,
    scopeListReturned: scopePresent,
  }
}

function tradingHeaders(token: string, callName: string) {
  return {
    "Content-Type": "text/xml",
    "X-EBAY-API-CALL-NAME": callName,
    "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_COMPATIBILITY_LEVEL,
    "X-EBAY-API-SITEID": "0",
    "X-EBAY-API-IAF-TOKEN": token,
  }
}

async function verifyAccount(input: {
  token: string
  expectedUserId: string
  expectedFingerprint: string
  fetchImpl: FetchLike
  calls: EbayMonitorReadonlyCallEvidence[]
  clock: Clock
  fulfillmentSellerIdentityFallback?: boolean
}) {
  const response = await allowlistedFetch({
    operation: "TRADING_GET_USER",
    method: "POST",
    url: TRADING_ENDPOINT,
    tradingCallName: "GetUser",
    headers: tradingHeaders(input.token, "GetUser"),
    body: "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
      "<GetUserRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
      "<OutputSelector>User.UserID</OutputSelector>" +
      "<OutputSelector>User.Site</OutputSelector>" +
      "</GetUserRequest>",
    fetchImpl: input.fetchImpl,
    calls: input.calls,
    clock: input.clock,
  })
  const xml = await readTextResponse(
    response,
    "EBAY_MONITOR_ACCOUNT_IDENTITY_RESPONSE_INVALID",
  )
  const parsed = parseEbayTradingGetUser(xml)
  if (!response.ok) {
    markResponseCallFailed(response)
    throw new Error(
      `EBAY_MONITOR_ACCOUNT_IDENTITY_HTTP_${response.status}`,
    )
  }
  if (!parsed.accepted) {
    markResponseCallFailed(response)
    const providerCode = xml.match(
      /<ErrorCode(?:\s[^>]*)?>(\d{1,12})<\/ErrorCode>/i,
    )?.[1]
    if (providerCode === "518" &&
        input.fulfillmentSellerIdentityFallback === true) {
      const window = orderWindow(input.clock())
      const identityUrl = new URL(FULFILLMENT_ORDERS_ENDPOINT)
      identityUrl.searchParams.set(
        "filter",
        `lastmodifieddate:[${window.start}..${window.end}]`,
      )
      identityUrl.searchParams.set("limit", "1")
      identityUrl.searchParams.set("offset", "0")
      const identityResponse = await allowlistedFetch({
        operation: "FULFILLMENT_GET_ORDERS",
        method: "GET",
        url: identityUrl,
        headers: {
          Authorization: `Bearer ${input.token}`,
          "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
        },
        fetchImpl: input.fetchImpl,
        calls: input.calls,
        clock: input.clock,
      })
      if (!identityResponse.ok) {
        markResponseCallFailed(identityResponse)
        throw new Error(
          `EBAY_MONITOR_ACCOUNT_IDENTITY_FULFILLMENT_HTTP_${
            identityResponse.status
          }`,
        )
      }
      const identityPayload = record(await readJsonResponse({
        response: identityResponse,
        calls: input.calls,
        operation: "FULFILLMENT_GET_ORDERS",
        errorCode:
          "EBAY_MONITOR_ACCOUNT_IDENTITY_FULFILLMENT_RESPONSE_INVALID",
      }))
      if (!Array.isArray(identityPayload.orders) ||
          identityPayload.orders.length !== 1) {
        markResponseCallFailed(identityResponse)
        throw new Error(
          "EBAY_MONITOR_ACCOUNT_IDENTITY_FULFILLMENT_EVIDENCE_UNAVAILABLE",
        )
      }
      const identityOrder = record(identityPayload.orders[0])
      const sellerId = text(identityOrder.sellerId, 100)
      const lineItems = Array.isArray(identityOrder.lineItems)
        ? identityOrder.lineItems.map(record)
        : []
      const marketplaceIds = lineItems
        .map((lineItem) => text(lineItem.listingMarketplaceId, 40))
        .filter(Boolean)
      if (!sellerId || marketplaceIds.length === 0) {
        markResponseCallFailed(identityResponse)
        throw new Error(
          "EBAY_MONITOR_ACCOUNT_IDENTITY_FULFILLMENT_EVIDENCE_UNAVAILABLE",
        )
      }
      const fingerprintMatch = ebayProductionAccountFingerprint(sellerId) ===
        input.expectedFingerprint
      const userMatch = !input.expectedUserId ||
        sellerId.toLocaleLowerCase("en-US") ===
          input.expectedUserId.toLocaleLowerCase("en-US")
      if (!fingerprintMatch || !userMatch) {
        throw new Error("EBAY_MONITOR_ACCOUNT_IDENTITY_MISMATCH")
      }
      return {
        observedAt: input.clock().toISOString(),
        fingerprintMatch: true,
        site: marketplaceIds.every((marketplaceId) =>
          marketplaceId === MARKETPLACE_ID)
          ? "US"
          : null,
        source: "EBAY_SELL_FULFILLMENT_GET_ORDERS_SELLER_ID" as const,
      }
    }
    throw new Error(providerCode
      ? `EBAY_MONITOR_ACCOUNT_IDENTITY_TRADING_ERROR_${providerCode}`
      : "EBAY_MONITOR_ACCOUNT_IDENTITY_REJECTED")
  }
  if (!parsed.userId) {
    markResponseCallFailed(response)
    throw new Error("EBAY_MONITOR_ACCOUNT_IDENTITY_RESPONSE_INVALID")
  }
  const fingerprintMatch = ebayProductionAccountFingerprint(parsed.userId) ===
    input.expectedFingerprint
  const userMatch = !input.expectedUserId ||
    parsed.userId.toLocaleLowerCase("en-US") ===
      input.expectedUserId.toLocaleLowerCase("en-US")
  if (!fingerprintMatch || !userMatch) {
    throw new Error("EBAY_MONITOR_ACCOUNT_IDENTITY_MISMATCH")
  }
  return {
    observedAt: input.clock().toISOString(),
    fingerprintMatch: true,
    site: parsed.site,
    source: "EBAY_TRADING_GET_USER" as const,
  }
}

function getMyeBaySellingBody(page: number) {
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<GetMyeBaySellingRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    "<ActiveList><Include>true</Include><IncludeNotes>false</IncludeNotes>" +
    "<Pagination>" +
    `<EntriesPerPage>${SELLER_WIDE_PAGE_SIZE}</EntriesPerPage>` +
    `<PageNumber>${page}</PageNumber>` +
    "</Pagination></ActiveList>" +
    "<HideVariations>false</HideVariations>" +
    "<DetailLevel>ReturnAll</DetailLevel>" +
    "</GetMyeBaySellingRequest>"
}

function getSellerListBody(input: {
  page: number
  endTimeFrom: string
  endTimeTo: string
}) {
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<GetSellerListRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    `<EndTimeFrom>${input.endTimeFrom}</EndTimeFrom>` +
    `<EndTimeTo>${input.endTimeTo}</EndTimeTo>` +
    "<GranularityLevel>Fine</GranularityLevel>" +
    "<IncludeVariations>true</IncludeVariations>" +
    "<Pagination>" +
    `<EntriesPerPage>${SELLER_WIDE_PAGE_SIZE}</EntriesPerPage>` +
    `<PageNumber>${input.page}</PageNumber>` +
    "</Pagination>" +
    "</GetSellerListRequest>"
}

function getItemMarketplaceBody(itemId: string) {
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<GetItemRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    `<ItemID>${escapedXml(itemId)}</ItemID>` +
    "<OutputSelector>Item.ItemID</OutputSelector>" +
    "<OutputSelector>Item.Site</OutputSelector>" +
    "<OutputSelector>Item.GalleryURL</OutputSelector>" +
    "<OutputSelector>Item.PictureDetails.PictureURL</OutputSelector>" +
    "</GetItemRequest>"
}

async function sellerWideDiscovery(input: {
  token: string
  fetchImpl: FetchLike
  calls: EbayMonitorReadonlyCallEvidence[]
  clock: Clock
}) {
  const listings: EbayLiveListing[] = []
  let totalPages: number | null = null
  let totalEntries: number | null = null
  let pagesRead = 0
  let reachedPageLimit = false
  let pageFailed = false
  let limitationCode: string | null = null
  let paginationMetadataConflict = false
  let ambiguousVariationIdentity = false
  let sourceIdentityConflict = false
  let operation:
    | "TRADING_GET_MY_EBAY_SELLING"
    | "TRADING_GET_SELLER_LIST" = "TRADING_GET_MY_EBAY_SELLING"
  const sellerListEndTimeFrom = input.clock().toISOString()
  const sellerListEndTimeTo = new Date(
    Date.parse(sellerListEndTimeFrom) + 119 * 24 * 60 * 60 * 1_000,
  ).toISOString()
  for (let page = 1; page <= SELLER_WIDE_MAX_PAGES; page += 1) {
    try {
      const tradingCallName = operation === "TRADING_GET_SELLER_LIST"
        ? "GetSellerList" as const
        : "GetMyeBaySelling" as const
      const response = await allowlistedFetch({
        operation,
        method: "POST",
        url: TRADING_ENDPOINT,
        tradingCallName,
        headers: tradingHeaders(input.token, tradingCallName),
        body: operation === "TRADING_GET_SELLER_LIST"
          ? getSellerListBody({ page, endTimeFrom: sellerListEndTimeFrom,
              endTimeTo: sellerListEndTimeTo })
          : getMyeBaySellingBody(page),
        fetchImpl: input.fetchImpl,
        calls: input.calls,
        clock: input.clock,
      })
      const observedAt = input.clock().toISOString()
      const xml = await readTextResponse(
        response,
        "EBAY_MONITOR_SELLER_DISCOVERY_RESPONSE_INVALID",
      )
      const parsed = operation === "TRADING_GET_SELLER_LIST"
        ? parseEbayTradingGetSellerListPage(xml, observedAt)
        : parseEbayTradingGetMyeBaySellingPage(xml, observedAt)
      if (!response.ok || !parsed.accepted) {
        markResponseCallFailed(response)
        const providerCode = xml.match(
          /<ErrorCode(?:\s[^>]*)?>(\d{1,12})<\/ErrorCode>/i,
        )?.[1]
        if (providerCode === "518" && page === 1 &&
            operation === "TRADING_GET_MY_EBAY_SELLING") {
          operation = "TRADING_GET_SELLER_LIST"
          limitationCode =
            "SELLER_WIDE_ENUMERATION_GET_SELLER_LIST_FALLBACK"
          page = 0
          continue
        }
        throw new Error(providerCode
          ? operation === "TRADING_GET_SELLER_LIST"
            ? `EBAY_MONITOR_SELLER_LIST_TRADING_ERROR_${providerCode}`
            : `EBAY_MONITOR_SELLER_DISCOVERY_TRADING_ERROR_${providerCode}`
          : operation === "TRADING_GET_SELLER_LIST"
            ? `EBAY_MONITOR_SELLER_LIST_${response.status}`
            : `EBAY_MONITOR_SELLER_DISCOVERY_${response.status}`)
      }
      pagesRead += 1
      const parsedTotalPages = parsed.totalPages === 0 &&
          parsed.totalEntries === 0
        ? 1
        : parsed.totalPages
      if (totalPages !== null && parsedTotalPages !== null &&
          totalPages !== parsedTotalPages) {
        paginationMetadataConflict = true
      }
      if (totalEntries !== null && parsed.totalEntries !== null &&
          totalEntries !== parsed.totalEntries) {
        paginationMetadataConflict = true
      }
      totalPages = parsedTotalPages
      totalEntries = parsed.totalEntries
      sourceIdentityConflict = sourceIdentityConflict ||
        parsed.sourceIdentityConflict
      paginationMetadataConflict = paginationMetadataConflict ||
        parsed.paginationMetadataConflict
      listings.push(...parsed.listings)
      const reachedReportedEnd = totalPages !== null && page >= totalPages
      if (parsed.hasMoreItems === true && reachedReportedEnd) {
        paginationMetadataConflict = true
      }
      if (parsed.hasMoreItems === false && totalPages !== null &&
          page < totalPages) {
        paginationMetadataConflict = true
      }
      const done = parsed.hasMoreItems === false ||
        (parsed.hasMoreItems !== true && reachedReportedEnd)
      if (done) break
      if (page === SELLER_WIDE_MAX_PAGES) reachedPageLimit = true
    } catch (error) {
      if (pagesRead === 0) throw error
      pageFailed = true
      limitationCode = safeCode(error, "SELLER_WIDE_DISCOVERY_PAGE_FAILED")
      break
    }
  }
  const uniqueMap = new Map(listings.map((listing) => [
    JSON.stringify([
      listing.itemId,
      listing.variationKey,
      listing.sku,
    ]),
    listing,
  ]))
  const uniqueBeforeItemCheck = [...uniqueMap.values()]
  const itemMultiplicity = new Map<string, number>()
  for (const listing of uniqueBeforeItemCheck) {
    const previous = itemMultiplicity.get(listing.itemId)
    itemMultiplicity.set(
      listing.itemId,
      previous === undefined ? 1 : previous + 1,
    )
  }
  const ambiguousItems = new Set(uniqueBeforeItemCheck
    .filter((listing) =>
      listing.variationKey === null &&
      (itemMultiplicity.get(listing.itemId) || 1) > 1)
    .map((listing) => listing.itemId))
  const unique = uniqueBeforeItemCheck.map((listing) => ({
    ...listing,
    identityAmbiguous: listing.identityAmbiguous ||
      ambiguousItems.has(listing.itemId),
  }))
  ambiguousVariationIdentity = uniqueMap.size !== listings.length ||
    unique.some((listing) => listing.identityAmbiguous)
  return {
    listings: unique,
    pagesRead,
    totalPages,
    totalEntries,
    reachedPageLimit,
    pageFailed,
    limitationCode,
    paginationMetadataConflict,
    ambiguousVariationIdentity,
    sourceIdentityConflict,
    observedAt: unique
      .map((listing) => listing.observedAt)
      .sort()
      .at(-1) ?? input.clock().toISOString(),
  }
}

type ItemMarketplaceCertification = {
  status: EbayItemMarketplaceCertificationStatus
  marketplaceSite: string | null
  source:
    | "EBAY_TRADING_GET_MY_EBAY_SELLING"
    | "EBAY_TRADING_GET_ITEM"
    | null
  observedAt: string | null
  limitationCode: string | null
  primaryImageUrl?: string | null
}

function marketplaceVerificationBudgetAvailable(
  calls: EbayMonitorReadonlyCallEvidence[],
  batchSize: number,
) {
  const budget = requestBudgets.get(calls)
  if (!budget) return true
  return batchSize > 0 &&
    budget.callsRemaining - batchSize >= GET_ITEM_DOWNSTREAM_CALL_RESERVE &&
    budget.deadlineAt - Date.now() >=
      GET_ITEM_DOWNSTREAM_TIME_RESERVE_MS + REQUEST_TIMEOUT_MS
}

function exhaustedMarketplaceCertification(): ItemMarketplaceCertification {
  return {
    status: "BUDGET_EXHAUSTED",
    marketplaceSite: null,
    source: null,
    observedAt: null,
    limitationCode:
      "SELLER_WIDE_MARKETPLACE_CERTIFICATION_BUDGET_EXHAUSTED",
  }
}

async function getItemMarketplaceCertification(input: {
  token: string
  itemId: string
  sellerWideMarketplaceSite: string | null
  fetchImpl: FetchLike
  calls: EbayMonitorReadonlyCallEvidence[]
  clock: Clock
}): Promise<ItemMarketplaceCertification> {
  let response: Response | null = null
  try {
    response = await allowlistedFetch({
      operation: "TRADING_GET_ITEM_MARKETPLACE",
      method: "POST",
      url: TRADING_ENDPOINT,
      tradingCallName: "GetItem",
      headers: tradingHeaders(input.token, "GetItem"),
      body: getItemMarketplaceBody(input.itemId),
      fetchImpl: input.fetchImpl,
      calls: input.calls,
      clock: input.clock,
    })
    const observedAt = input.clock().toISOString()
    if (!response.ok) {
      return {
        status: "ERROR",
        marketplaceSite: null,
        source: "EBAY_TRADING_GET_ITEM",
        observedAt,
        limitationCode: "TRADING_GET_ITEM_MARKETPLACE_HTTP_FAILED",
      }
    }
    const responseXml = await readTextResponse(
      response,
      "TRADING_GET_ITEM_MARKETPLACE_RESPONSE_INVALID",
    )
    const parsed = parseEbayTradingGetItemMarketplace(responseXml, input.itemId)
    const image = parseEbayTradingGetItemPrimaryImage(responseXml, input.itemId)
    if (parsed.status !== "US_CERTIFIED" &&
        parsed.status !== "NON_US_CERTIFIED") {
      markResponseCallFailed(response)
    }
    if ((parsed.status === "US_CERTIFIED" ||
        parsed.status === "NON_US_CERTIFIED") &&
        input.sellerWideMarketplaceSite !== null &&
        parsed.marketplaceSite !== input.sellerWideMarketplaceSite) {
      markResponseCallFailed(response)
      return {
        status: "ERROR",
        marketplaceSite: null,
        source: "EBAY_TRADING_GET_ITEM",
        observedAt,
        limitationCode: "SELLER_WIDE_ITEM_MARKETPLACE_CONFLICT",
      }
    }
    return {
      status: parsed.status,
      marketplaceSite: parsed.marketplaceSite,
      source: "EBAY_TRADING_GET_ITEM",
      observedAt,
      primaryImageUrl: image.status === "AVAILABLE"
        ? image.primaryImageUrl
        : null,
      limitationCode: parsed.status === "ITEM_ID_MISMATCH"
        ? "TRADING_GET_ITEM_IDENTITY_MISMATCH"
        : parsed.status === "UNRESOLVED" || parsed.status === "ERROR"
          ? "TRADING_GET_ITEM_MARKETPLACE_RESPONSE_INVALID"
          : null,
    }
  } catch (error) {
    if (response) markResponseCallFailed(response)
    const code = safeCode(error, "TRADING_GET_ITEM_MARKETPLACE_READ_FAILED")
    if (code === "EBAY_MONITOR_REQUEST_BUDGET_EXHAUSTED") {
      return exhaustedMarketplaceCertification()
    }
    return {
      status: "ERROR",
      marketplaceSite: null,
      source: "EBAY_TRADING_GET_ITEM",
      observedAt: input.clock().toISOString(),
      limitationCode: "TRADING_GET_ITEM_MARKETPLACE_READ_FAILED",
    }
  }
}

async function certifySellerWideItemMarketplaces(input: {
  token: string
  listings: EbayLiveListing[]
  totalEntries: number | null
  fetchImpl: FetchLike
  calls: EbayMonitorReadonlyCallEvidence[]
  clock: Clock
}) {
  const rowsByItem = new Map<string, EbayLiveListing[]>()
  for (const listing of input.listings) {
    const rows = rowsByItem.get(listing.itemId) ?? []
    rows.push(listing)
    rowsByItem.set(listing.itemId, rows)
  }
  const certifications = new Map<string, ItemMarketplaceCertification>()
  const pending: Array<{
    itemId: string
    sellerWideMarketplaceSite: string | null
  }> = []
  for (const itemId of [...rowsByItem.keys()].sort()) {
    const rows = rowsByItem.get(itemId) ?? []
    const explicitSites = new Set(rows
      .map((row) => row.marketplaceSite)
      .filter((site): site is string => Boolean(site)))
    if (explicitSites.size > 1) {
      certifications.set(itemId, {
        status: "ERROR",
        marketplaceSite: null,
        source: "EBAY_TRADING_GET_MY_EBAY_SELLING",
        observedAt: rows.map((row) => row.observedAt).sort().at(-1) ?? null,
        limitationCode: "SELLER_WIDE_ITEM_MARKETPLACE_CONFLICT",
      })
      continue
    }
    pending.push({
      itemId,
      sellerWideMarketplaceSite: explicitSites.size === 1
        ? [...explicitSites][0]
        : null,
    })
  }
  const scheduled = pending.slice(0, GET_ITEM_MARKETPLACE_MAX_UNIQUE_ITEMS)
  for (const entry of pending.slice(GET_ITEM_MARKETPLACE_MAX_UNIQUE_ITEMS)) {
    certifications.set(entry.itemId, exhaustedMarketplaceCertification())
  }
  for (let offset = 0; offset < scheduled.length;
      offset += GET_ITEM_MARKETPLACE_CONCURRENCY) {
    const batch = scheduled.slice(
      offset,
      offset + GET_ITEM_MARKETPLACE_CONCURRENCY,
    )
    if (!marketplaceVerificationBudgetAvailable(input.calls, batch.length)) {
      for (const entry of scheduled.slice(offset)) {
        certifications.set(entry.itemId, exhaustedMarketplaceCertification())
      }
      break
    }
    const results = await Promise.all(batch.map(async (entry) => ({
      itemId: entry.itemId,
      certification: await getItemMarketplaceCertification({
        token: input.token,
        itemId: entry.itemId,
        sellerWideMarketplaceSite: entry.sellerWideMarketplaceSite,
        fetchImpl: input.fetchImpl,
        calls: input.calls,
        clock: input.clock,
      }),
    })))
    for (const result of results) {
      certifications.set(result.itemId, result.certification)
    }
    if (results.some((result) =>
        result.certification.status === "BUDGET_EXHAUSTED")) {
      for (const entry of scheduled.slice(offset + batch.length)) {
        certifications.set(entry.itemId, exhaustedMarketplaceCertification())
      }
      break
    }
  }
  for (const itemId of rowsByItem.keys()) {
    if (certifications.has(itemId)) continue
    certifications.set(itemId, {
      status: "ERROR",
      marketplaceSite: null,
      source: null,
      observedAt: null,
      limitationCode: "SELLER_WIDE_MARKETPLACE_PARTITION_INVARIANT_FAILED",
    })
  }
  const count = (status: EbayItemMarketplaceCertificationStatus) =>
    [...certifications.values()].filter((entry) => entry.status === status)
      .length
  const certifiedUs = count("US_CERTIFIED")
  const certifiedNonUs = count("NON_US_CERTIFIED")
  const unresolved = count("UNRESOLVED")
  const directErrors = count("ERROR")
  const itemIdMismatches = count("ITEM_ID_MISMATCH")
  const exhausted = count("BUDGET_EXHAUSTED")
  const partitionItemCount = certifiedUs + certifiedNonUs + unresolved +
    directErrors + itemIdMismatches + exhausted
  const currentLiveListings = input.listings.map((listing) => {
    const certification = certifications.get(listing.itemId)
    const fallbackImageUrl = certification?.primaryImageUrl ?? null
    return {
      ...listing,
      primaryImageUrl: listing.primaryImageUrl ?? fallbackImageUrl,
      primaryImageSource: listing.primaryImageSource ??
        (fallbackImageUrl ? "EBAY_TRADING_GET_ITEM" : null),
      marketplaceSite: certification?.marketplaceSite ?? listing.marketplaceSite,
      marketplaceCertification: {
        status: certification?.status ?? "ERROR",
        source: certification?.source ?? null,
        observedAt: certification?.observedAt ?? null,
      },
    }
  })
  const certifiedListings = currentLiveListings.filter((listing) =>
    listing.marketplaceCertification.status === "US_CERTIFIED")
  const represented = new Set(certifiedListings.map((row) => row.itemId)).size
  const parsed = rowsByItem.size
  const terminal = certifiedUs + certifiedNonUs
  const incomplete = unresolved > 0 || directErrors > 0 ||
    itemIdMismatches > 0 || exhausted > 0 ||
    partitionItemCount !== parsed || input.totalEntries === null ||
    terminal !== input.totalEntries
  const gapCodes = [...new Set([
    ...(unresolved > 0 ? ["SELLER_WIDE_ITEM_MARKETPLACE_UNRESOLVED"] : []),
    ...[...certifications.values()].flatMap((certification) =>
      certification.limitationCode ? [certification.limitationCode] : []),
  ])]
  return {
    currentLiveListings,
    listings: certifiedListings,
    marketplaceCertification: {
      sellerWideItemsReported: input.totalEntries,
      sellerWideItemsParsed: parsed,
      sellerWideItemsMarketplaceCertifiedUs: certifiedUs,
      sellerWideItemsMarketplaceCertifiedNonUs: certifiedNonUs,
      sellerWideItemsMarketplaceUnresolved: unresolved,
      sellerWideItemsMarketplaceError: directErrors,
      sellerWideItemsMarketplaceBudgetExhausted: exhausted,
      sellerWideItemsMarketplaceItemIdMismatch: itemIdMismatches,
      sellerWideItemsRepresented: represented,
    } satisfies EbayMarketplaceCertificationCounters,
    terminalItemCount: terminal,
    incomplete,
    gapCodes,
  }
}

async function inventoryRead(input: {
  credentials: { clientId: string; clientSecret: string; refreshToken: string }
  expectedUserId: string
  expectedFingerprint: string
  fetchImpl: FetchLike
  calls: EbayMonitorReadonlyCallEvidence[]
  clock: Clock
  expiries: string[]
  scopeGrant: ScopeGrantEvidence
}) : Promise<EbayLiveInventoryResult> {
  let token = ""
  try {
    const minted = await accessToken({
      operation: "OAUTH_REFRESH_INVENTORY",
      credentials: input.credentials,
      scopes: [BASE_SCOPE, INVENTORY_READONLY_SCOPE],
      fetchImpl: input.fetchImpl,
      calls: input.calls,
      clock: input.clock,
    })
    token = minted.value
    input.expiries.push(minted.expiresAt)
    const missingRequestedScopes = registerScopeEvidence({
      ledger: input.scopeGrant,
      token: minted,
      requestedScopes: [BASE_SCOPE, INVENTORY_READONLY_SCOPE],
    })
    await verifyAccount({
      token,
      expectedUserId: input.expectedUserId,
      expectedFingerprint: input.expectedFingerprint,
      fetchImpl: input.fetchImpl,
      calls: input.calls,
      clock: input.clock,
    })
    input.scopeGrant.bindingVerified = true
    if (missingRequestedScopes.includes(INVENTORY_READONLY_SCOPE)) {
      throw new Error("EBAY_MONITOR_INVENTORY_SCOPE_MISSING")
    }
    const inventoryItems: JsonRecord[] = []
    let offset = 0
    let total: number | null = null
    let itemEnumerationExhausted = false
    let inventoryEvidenceObserved = false
    const gapCodes: string[] = []
    while (inventoryItems.length < INVENTORY_MAX_SKUS) {
      try {
        const url = new URL(INVENTORY_ITEMS_ENDPOINT)
        url.searchParams.set("limit", "50")
        url.searchParams.set("offset", String(offset))
        const response = await allowlistedFetch({
          operation: "INVENTORY_GET_ITEMS",
          method: "GET",
          url,
          headers: {
            Authorization: `Bearer ${token}`,
            "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
          },
          fetchImpl: input.fetchImpl,
          calls: input.calls,
          clock: input.clock,
        })
        if (!response.ok) {
          throw new Error(`EBAY_MONITOR_INVENTORY_${response.status}`)
        }
        const mediaType = (response.headers.get("content-type") ?? "")
          .split(";", 1)[0].trim().toLowerCase()
        if (mediaType !== "application/json") {
          markResponseCallFailed(response)
          throw new Error("INVENTORY_SOURCE_FORMAT_CHANGED")
        }
        const rawPayload = await readJsonResponse({
          response,
          calls: input.calls,
          operation: "INVENTORY_GET_ITEMS",
          errorCode: "INVENTORY_SOURCE_FORMAT_CHANGED",
        })
        const payload = parseEbayInventoryItemsPage(rawPayload, {
          expectedLimit: 50,
          expectedOffset: offset,
        })
        if (!payload.accepted) {
          markResponseCallFailed(response)
          throw new Error("INVENTORY_SOURCE_FORMAT_CHANGED")
        }
        const page = payload.inventoryItems.map(record)
        inventoryEvidenceObserved = true
        inventoryItems.push(...page)
        const reportedTotal = payload.total
        if (reportedTotal === null) {
          gapCodes.push("INVENTORY_TOTAL_UNPROVEN")
        } else if (total !== null && total !== reportedTotal) {
          gapCodes.push("INVENTORY_TOTAL_CHANGED_DURING_READ")
        } else {
          total = reportedTotal
        }
        const nextUrl = payload.next ?? ""
        const terminalByRows = !page.length || page.length < 50 ||
          (total !== null && inventoryItems.length >= total)
        if (nextUrl) {
          let nextValid = false
          try {
            const parsedNext = new URL(nextUrl, EBAY_API_ORIGIN)
            nextValid = parsedNext.origin === EBAY_API_ORIGIN &&
              parsedNext.pathname === "/sell/inventory/v1/inventory_item" &&
              nonNegativeInteger(parsedNext.searchParams.get("offset")) ===
                offset + 1
          } catch {
            nextValid = false
          }
          if (!nextValid || terminalByRows) {
            gapCodes.push("INVENTORY_PAGINATION_METADATA_CONFLICT")
          }
        }
        if (terminalByRows) {
          itemEnumerationExhausted = true
          break
        }
        if (!nextUrl && total !== null && inventoryItems.length < total) {
          gapCodes.push("INVENTORY_PAGINATION_METADATA_CONFLICT")
        }
        offset += 1
      } catch (error) {
        gapCodes.push(safeCode(error, "INVENTORY_PAGE_READ_FAILED"))
        break
      }
    }
    if (!inventoryEvidenceObserved) {
      return emptyInventory("UNAVAILABLE", gapCodes[0] ??
        "INVENTORY_READ_FAILED")
    }
    const skus = [...new Set(inventoryItems
      .map((entry) => text(entry.sku, 120))
      .filter(Boolean))].slice(0, INVENTORY_MAX_SKUS)
    const publishedListingIds: string[] = []
    const publishedOffers: Array<{ itemId: string; sku: string }> = []
    let offerEnumerationTruncated = false
    for (const group of chunks(skus, 5)) {
      const results = await Promise.allSettled(group.map(async (sku) => {
        const url = new URL(INVENTORY_OFFERS_ENDPOINT)
        url.searchParams.set("sku", sku)
        url.searchParams.set("limit", "100")
        const response = await allowlistedFetch({
          operation: "INVENTORY_GET_OFFERS",
          method: "GET",
          url,
          headers: {
            Authorization: `Bearer ${token}`,
            "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
          },
          fetchImpl: input.fetchImpl,
          calls: input.calls,
          clock: input.clock,
        })
        if (!response.ok) {
          throw new Error(`EBAY_MONITOR_INVENTORY_OFFERS_${response.status}`)
        }
        const payload = record(await readJsonResponse({
          response,
          calls: input.calls,
          operation: "INVENTORY_GET_OFFERS",
          errorCode: "INVENTORY_OFFER_SOURCE_FORMAT_CHANGED",
        }))
        if (!Array.isArray(payload.offers)) {
          markResponseCallFailed(response)
          throw new Error("INVENTORY_OFFER_SOURCE_FORMAT_CHANGED")
        }
        const offers = payload.offers.map(record)
        const offerTotal = nonNegativeInteger(payload.total)
        if (offerTotal === null) offerEnumerationTruncated = true
        if (Boolean(payload.next) ||
            (offerTotal !== null && offerTotal !== offers.length)) {
          offerEnumerationTruncated = true
          gapCodes.push("INVENTORY_OFFER_TOTAL_COUNT_MISMATCH")
        }
        return { sku, offers }
      }))
      for (const result of results) {
        if (result.status === "rejected") {
          offerEnumerationTruncated = true
          gapCodes.push(safeCode(
            result.reason,
            "INVENTORY_OFFER_READ_FAILED",
          ))
          continue
        }
        for (const offer of result.value.offers) {
        const listingId = text(record(offer.listing).listingId, 20)
        const status = text(offer.status, 40).toUpperCase()
        const marketplaceId = text(offer.marketplaceId, 40).toUpperCase()
        const returnedSku = text(offer.sku, 120)
        if (status === "PUBLISHED" &&
            (!/^\d{9,20}$/.test(listingId) ||
              marketplaceId !== MARKETPLACE_ID ||
              returnedSku !== result.value.sku)) {
          offerEnumerationTruncated = true
          gapCodes.push("INVENTORY_PUBLISHED_OFFER_IDENTITY_UNPROVEN")
          continue
        }
        if (status === "PUBLISHED") {
          publishedListingIds.push(listingId)
          publishedOffers.push({ itemId: listingId, sku: returnedSku })
        }
        }
      }
    }
    if (itemEnumerationExhausted && total !== null &&
        total !== inventoryItems.length) {
      gapCodes.push("INVENTORY_TOTAL_COUNT_MISMATCH")
    }
    if (total !== null && total !== skus.length) {
      gapCodes.push("INVENTORY_DISTINCT_VALID_SKU_COUNT_MISMATCH")
    }
    const truncated = !itemEnumerationExhausted || offerEnumerationTruncated ||
      total === null || (total !== null && total !== inventoryItems.length) ||
      (total !== null && total !== skus.length) ||
      gapCodes.length > 0
    if (!itemEnumerationExhausted) gapCodes.push("INVENTORY_SKU_LIMIT_REACHED")
    if (offerEnumerationTruncated) {
      gapCodes.push("INVENTORY_OFFER_PAGINATION_INCOMPLETE")
    }
    return {
      status: truncated ? "PARTIAL" : "AVAILABLE",
      observedAt: input.clock().toISOString(),
      inventorySkuCount: total,
      publishedListingIds: [...new Set(publishedListingIds)].sort(),
      publishedOffers: [...new Map(publishedOffers.map((offer) => [
        JSON.stringify([offer.itemId, offer.sku]),
        offer,
      ])).values()].sort((left, right) =>
        JSON.stringify([left.itemId, left.sku]).localeCompare(
          JSON.stringify([right.itemId, right.sku]),
        )),
      gapCodes: truncated ? [...new Set(gapCodes)] : [],
    }
  } catch (error) {
    return emptyInventory("UNAVAILABLE", safeCode(
      error,
      "INVENTORY_READ_FAILED",
    ))
  } finally {
    token = ""
  }
}

function analyticsDayWindow(now: Date) {
  const end = new Date(now)
  end.setUTCHours(0, 0, 0, 0)
  end.setUTCDate(end.getUTCDate() - 1)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 29)
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

function analyticsCalendarDay(value: string | null) {
  const day = value?.slice(0, 10) ?? ""
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const parsed = new Date(`${day}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === day
    ? day
    : null
}

export function validateAccountTrafficDateMetadataV1(input: {
  startDate: string | null
  endDate: string | null
  lastUpdatedDate: string | null
}) {
  const startDay = analyticsCalendarDay(input.startDate)
  const endDay = analyticsCalendarDay(input.endDate)
  const updatedDay = analyticsCalendarDay(input.lastUpdatedDate)
  const reasonCode = !startDay ? "ACCOUNT_TRAFFIC_START_DATE_INVALID"
    : !endDay ? "ACCOUNT_TRAFFIC_END_DATE_INVALID"
      : !updatedDay ? "ACCOUNT_TRAFFIC_LAST_UPDATED_DATE_INVALID"
        : startDay > endDay ? "ACCOUNT_TRAFFIC_DATE_RANGE_INVALID" : null
  return Object.freeze({
    status: reasonCode ? "INVALID" as const : "VALID" as const,
    reasonCode,
    startDay,
    endDay,
    updatedDay,
  })
}

function analyticsItemId(value: string) {
  if (/^\d{9,20}$/.test(value)) return value
  return value.match(/^v1\|(\d{9,20})\|0$/i)?.[1] ?? null
}

async function analyticsRead(input: {
  credentials: { clientId: string; clientSecret: string; refreshToken: string }
  expectedUserId: string
  expectedFingerprint: string
  listingIds: string[]
  fetchImpl: FetchLike
  calls: EbayMonitorReadonlyCallEvidence[]
  clock: Clock
  expiries: string[]
  scopeGrant: ScopeGrantEvidence
}) : Promise<EbayCommercialMonitorLiveReadonlyResult["analytics"]> {
  const ids = [...new Set(input.listingIds)]
  const selected = ids.slice(0, ANALYTICS_MAX_LISTINGS)
  let accountTraffic = unavailableAccountTrafficV1(
    "ACCOUNT_TRAFFIC_READ_NOT_COMPLETED",
  )
  let accountTrafficUpstreamCallCount = 0
  if (!input.listingIds.length) {
    return {
      status: "UNAVAILABLE",
      observedAt: null,
      windowStart: null,
      windowEnd: null,
      analyticsRequestedItemCount: 0,
      analyticsRepresentedItemCount: null,
      analyticsMissingItemCount: null,
      analyticsCoverageStatus: "UNPROVEN",
      accountTraffic,
      observations: [],
      gapCodes: ["NO_DISCOVERED_LISTING_IDS_NO_ZERO_INFERENCE"],
    }
  }
  let token = ""
  const window = analyticsDayWindow(input.clock())
  const auditStartedAt = input.clock().toISOString()
  const auditSpanId = `account-traffic-audit:${hashEbayMonitorEvidenceIdentifier(
    `audit:${window.start}:${window.end}:${auditStartedAt}:${input.calls.length}`,
  ).slice(0, 20)}`
  const accountScopeId = `account-traffic:UTC:${window.start}:${window.end}`
  const accountTrafficCacheKey = hashEbayMonitorEvidenceIdentifier([
    MARKETPLACE_ID,
    input.expectedFingerprint,
    window.start,
    window.end,
    "ACCOUNT_DAY_AGGREGATE",
  ].join(":"))
  let metadataValidationStatus: AccountTrafficEvidenceV1[
    "metadataValidationStatus"] = "NOT_ATTEMPTED"
  let metadataValidationReasonCode: string | null = null
  let accountTrafficSnapshotId: string | null = null
  let accountTrafficRetryCount = 0
  try {
    const minted = await accessToken({
      operation: "OAUTH_REFRESH_ANALYTICS",
      credentials: input.credentials,
      scopes: [BASE_SCOPE, ANALYTICS_READONLY_SCOPE],
      fetchImpl: input.fetchImpl,
      calls: input.calls,
      clock: input.clock,
    })
    token = minted.value
    input.expiries.push(minted.expiresAt)
    const missingRequestedScopes = registerScopeEvidence({
      ledger: input.scopeGrant,
      token: minted,
      requestedScopes: [BASE_SCOPE, ANALYTICS_READONLY_SCOPE],
    })
    await verifyAccount({
      token,
      expectedUserId: input.expectedUserId,
      expectedFingerprint: input.expectedFingerprint,
      fetchImpl: input.fetchImpl,
      calls: input.calls,
      clock: input.clock,
    })
    input.scopeGrant.bindingVerified = true
    if (missingRequestedScopes.includes(ANALYTICS_READONLY_SCOPE)) {
      throw new Error("EBAY_MONITOR_ANALYTICS_SCOPE_MISSING")
    }
    const snapshotCache = accountTrafficSnapshotCacheV1(input.fetchImpl)
    const rateLimitBackoffs = accountTrafficRateLimitBackoffCacheV1(
      input.fetchImpl,
    )
    const cacheNow = input.clock().getTime()
    // Serverless processes are ephemeral, but keep the process-local cache
    // bounded even across many account/window partitions.
    if (snapshotCache.size > 128) snapshotCache.clear()
    const cachedSnapshot = snapshotCache.get(accountTrafficCacheKey)
    const rateLimitBackoffUntil = rateLimitBackoffs.get(
      accountTrafficCacheKey,
    )
    if (cachedSnapshot && cachedSnapshot.expiresAt > cacheNow &&
        cachedSnapshot.evidence.metadataValidationStatus === "VALID" &&
        ["AVAILABLE", "PARTIAL"].includes(cachedSnapshot.evidence.status)) {
      const cacheHitCount = cachedSnapshot.evidence.cacheHitCount + 1
      accountTraffic = {
        ...cachedSnapshot.evidence,
        auditSpanId,
        upstreamSnapshotAcquisitionCount: 0,
        cumulativeAcquisitionCount:
          cumulativeAccountTrafficSnapshotAcquisitionCount,
        cacheHitCount,
        snapshotReuseStatus: "REUSED",
        snapshotReuseReasonCode: "FRESH_MATCHING_ACCOUNT_WINDOW",
      }
      snapshotCache.set(accountTrafficCacheKey, {
        expiresAt: cachedSnapshot.expiresAt,
        evidence: accountTraffic,
      })
    } else if (typeof rateLimitBackoffUntil === "number" &&
        rateLimitBackoffUntil > cacheNow) {
      accountTraffic = unavailableAccountTrafficV1(
        "EBAY_MONITOR_ACCOUNT_TRAFFIC_429_BACKOFF_ACTIVE",
        0,
        {
          scopeId: accountScopeId,
          auditSpanId,
          cumulativeAcquisitionCount:
            cumulativeAccountTrafficSnapshotAcquisitionCount,
          retryPolicy: "NO_RETRY",
          snapshotReuseStatus: "UNAVAILABLE",
          snapshotReuseReasonCode: "SOURCE_UNAVAILABLE",
        },
      )
    } else {
      rateLimitBackoffs.set(accountTrafficCacheKey, 0)
      try {
        const { url } = buildEbaySellerTrafficReportUrl({
          dateFrom: window.start,
          dateTo: window.end,
          timeZone: "UTC",
        })
        for (let attempt = 0; attempt < 2; attempt += 1) {
          accountTrafficUpstreamCallCount += 1
          cumulativeAccountTrafficSnapshotAcquisitionCount += 1
          const response = await allowlistedFetch({
            operation: "ANALYTICS_GET_TRAFFIC_REPORT",
            method: "GET",
            url,
            headers: {
              Authorization: `Bearer ${token}`,
              "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
            },
            fetchImpl: input.fetchImpl,
            calls: input.calls,
            clock: input.clock,
          })
          if (response.status === 429) {
            const retryAfterMs = accountTrafficRetryAfterMilliseconds(
              response.headers.get("retry-after"),
              input.clock().getTime(),
            )
            const backoffMs = retryAfterMs === null
              ? ACCOUNT_TRAFFIC_429_FALLBACK_BACKOFF_MS
              : Math.max(1_000, retryAfterMs)
            rateLimitBackoffs.set(
              accountTrafficCacheKey,
              input.clock().getTime() + backoffMs,
            )
            throw new Error("EBAY_MONITOR_ACCOUNT_TRAFFIC_429")
          }
          if (!response.ok) {
            throw new Error(`EBAY_MONITOR_ACCOUNT_TRAFFIC_${response.status}`)
          }
          const payload = await readJsonResponse({
            response,
            calls: input.calls,
            operation: "ANALYTICS_GET_TRAFFIC_REPORT",
            errorCode: "ACCOUNT_TRAFFIC_SOURCE_FORMAT_CHANGED",
          })
          const normalized = normalizeEbaySellerTrafficRows(payload)
          if (normalized.dimension !== "DAY") {
            markResponseCallFailed(response)
            throw new Error("ACCOUNT_TRAFFIC_GRAIN_MISMATCH")
          }
          const metadata = validateAccountTrafficDateMetadataV1({
            startDate: normalized.startDate,
            endDate: normalized.endDate,
            lastUpdatedDate: normalized.lastUpdatedDate,
          })
          metadataValidationStatus = metadata.status
          metadataValidationReasonCode = metadata.reasonCode
          if (metadata.status === "INVALID") {
            markResponseCallFailed(response)
            if (attempt === 0) {
              accountTrafficRetryCount = 1
              continue
            }
            throw new Error("ACCOUNT_TRAFFIC_DATE_METADATA_INVALID")
          }
          const observedAt = input.clock().toISOString()
          accountTrafficSnapshotId = `account-traffic-snapshot:${
            hashEbayMonitorEvidenceIdentifier(
              `snapshot:${metadata.startDay}:${metadata.endDay}:${metadata.updatedDay}:${observedAt}`,
            ).slice(0, 20)}`
          accountTraffic = summarizeAccountTrafficV1({
            rows: normalized.rows,
            windowStart: `${metadata.startDay}T00:00:00.000Z`,
            windowEnd: `${metadata.endDay}T23:59:59.999Z`,
            requestedWindowStart: window.start,
            requestedWindowEnd: window.end,
            observedAt,
            sourceUpdatedAt: `${metadata.updatedDay}T00:00:00.000Z`,
            warnings: normalized.warnings,
            accountTrafficSnapshotId,
            auditSpanId,
            upstreamSnapshotAcquisitionCount: accountTrafficUpstreamCallCount,
            cumulativeAcquisitionCount:
              cumulativeAccountTrafficSnapshotAcquisitionCount,
            cacheHitCount: 0,
            retryCount: accountTrafficRetryCount,
            retryPolicy: "ONE_RETRY_ON_DATE_METADATA_INVALID",
            snapshotReuseStatus: "ACQUIRED",
            snapshotReuseReasonCode: "CACHE_MISS_ACQUIRED",
          })
          snapshotCache.set(accountTrafficCacheKey, {
            expiresAt: input.clock().getTime() +
              ACCOUNT_TRAFFIC_SNAPSHOT_REUSE_MAX_AGE_MS,
            evidence: accountTraffic,
          })
          break
        }
      } catch (error) {
        accountTraffic = unavailableAccountTrafficV1(
          safeCode(error, "ACCOUNT_TRAFFIC_READ_FAILED"),
          accountTrafficUpstreamCallCount,
          {
            scopeId: accountScopeId,
            accountTrafficSnapshotId,
            auditSpanId,
            metadataValidationStatus,
            metadataValidationReasonCode,
            cumulativeAcquisitionCount:
              cumulativeAccountTrafficSnapshotAcquisitionCount,
            cacheHitCount: 0,
            retryCount: accountTrafficRetryCount,
            retryPolicy: "ONE_RETRY_ON_DATE_METADATA_INVALID",
            snapshotReuseStatus: "UNAVAILABLE",
            snapshotReuseReasonCode: "SOURCE_UNAVAILABLE",
          },
        )
      }
    }
    const observations: EbayLiveAnalyticsObservation[] = []
    const gapCodes = ids.length > selected.length
      ? ["ANALYTICS_LISTING_LIMIT_REACHED"]
      : []
    if (accountTraffic.gapCodes.some((code) => code.includes("429"))) {
      return {
        status: "UNAVAILABLE",
        observedAt: null,
        windowStart: null,
        windowEnd: null,
        analyticsRequestedItemCount: selected.length,
        analyticsRepresentedItemCount: null,
        analyticsMissingItemCount: null,
        analyticsCoverageStatus: "UNPROVEN",
        accountTraffic,
        observations,
        gapCodes: [...new Set([...gapCodes, ...accountTraffic.gapCodes])],
      }
    }
    let observedAt: string | null = null
    let actualWindowStart: string | null = null
    let actualWindowEnd: string | null = null
    for (const listingChunk of chunks(selected, 200)) {
      try {
        const { url } = buildEbaySellerTrafficReportUrl({
          dateFrom: window.start,
          dateTo: window.end,
          listingIds: listingChunk,
          timeZone: "UTC",
        })
        const response = await allowlistedFetch({
          operation: "ANALYTICS_GET_TRAFFIC_REPORT",
          method: "GET",
          url,
          headers: {
            Authorization: `Bearer ${token}`,
            "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
          },
          fetchImpl: input.fetchImpl,
          calls: input.calls,
          clock: input.clock,
        })
        if (!response.ok) {
          throw new Error(`EBAY_MONITOR_ANALYTICS_${response.status}`)
        }
        const payload = await readJsonResponse({
          response,
          calls: input.calls,
          operation: "ANALYTICS_GET_TRAFFIC_REPORT",
          errorCode: "ANALYTICS_SOURCE_FORMAT_CHANGED",
        })
        if (!Array.isArray(record(payload).records)) {
          markResponseCallFailed(response)
          throw new Error("ANALYTICS_SOURCE_FORMAT_CHANGED")
        }
        const payloadRecord = record(payload)
        const rawWarnings = payloadRecord.warnings
        if (Object.prototype.hasOwnProperty.call(payloadRecord, "warnings") &&
            (!Array.isArray(rawWarnings) || rawWarnings.length > 0)) {
          gapCodes.push("ANALYTICS_SOURCE_WARNING_REPORTED")
        }
        const header = record(payloadRecord.header)
        const rawDimensionDefinitions = array(header.dimensionKeys)
        const rawDimensionKeys = rawDimensionDefinitions.map((definition) =>
          text(record(definition).key, 100).toUpperCase())
        const rawRecords = array(record(payload).records).map(record)
        if (rawDimensionKeys.length !== 1 ||
            !["LISTING", "LISTING_ID"].includes(rawDimensionKeys[0]) ||
            rawRecords.some((row) =>
              !Array.isArray(row.dimensionValues) ||
              row.dimensionValues.length !== 1)) {
          markResponseCallFailed(response)
          throw new Error("ANALYTICS_DIMENSION_DEFINITIONS_AMBIGUOUS")
        }
        const normalized = normalizeEbaySellerTrafficRows(payload)
        if (normalized.warnings.length > 0) {
          gapCodes.push("ANALYTICS_SOURCE_WARNING_REPORTED")
        }
        if (normalized.dimension !== "LISTING") {
          markResponseCallFailed(response)
          throw new Error("ANALYTICS_GRAIN_MISMATCH")
        }
        const rawMetricDefinitions = array(
          header.metrics,
        )
        const rawMetricKeys = rawMetricDefinitions.map((definition) =>
          text(record(definition).key, 100).toUpperCase())
        const returnedMetricKeys = new Set(rawMetricKeys)
        if (rawMetricKeys.some((key) => !key) ||
            returnedMetricKeys.size !== rawMetricKeys.length) {
          markResponseCallFailed(response)
          throw new Error("ANALYTICS_METRIC_DEFINITIONS_AMBIGUOUS")
        }
        if (EBAY_SELLER_TRAFFIC_METRICS.some((key) =>
            !returnedMetricKeys.has(key))) {
          markResponseCallFailed(response)
          throw new Error("ANALYTICS_REQUIRED_METRICS_MISSING")
        }
        const invalidMetricCells = rawRecords.some((row) => {
          const metricValues = row.metricValues
          if (!Array.isArray(metricValues) ||
              metricValues.length !== rawMetricDefinitions.length) {
            return true
          }
          return rawMetricDefinitions.some((_, index) => {
            const cell = record(metricValues[index])
            if (typeof cell.applicable !== "boolean") return true
            return cell.applicable === true &&
              analyticsMetricNumber(cell.value) === null
          })
        })
        if (invalidMetricCells) {
          markResponseCallFailed(response)
          throw new Error("ANALYTICS_METRIC_CELLS_INCOMPLETE")
        }
        const reportStartDay = analyticsCalendarDay(normalized.startDate)
        const reportEndDay = analyticsCalendarDay(normalized.endDate)
        const sourceUpdatedDay = analyticsCalendarDay(
          normalized.lastUpdatedDate,
        )
        const currentDay = input.clock().toISOString().slice(0, 10)
        if (!reportStartDay || !reportEndDay || !sourceUpdatedDay ||
            reportStartDay > reportEndDay || sourceUpdatedDay > currentDay) {
          markResponseCallFailed(response)
          throw new Error("ANALYTICS_DATE_METADATA_INVALID")
        }
        const responseWindowStart = `${reportStartDay}T00:00:00.000Z`
        const responseWindowEnd = `${reportEndDay}T23:59:59.999Z`
        if (actualWindowStart !== null &&
            (actualWindowStart !== responseWindowStart ||
              actualWindowEnd !== responseWindowEnd)) {
          gapCodes.push("ANALYTICS_RESPONSE_WINDOWS_CONFLICT")
        } else {
          actualWindowStart = responseWindowStart
          actualWindowEnd = responseWindowEnd
        }
        const exactRequestedWindow = reportStartDay === window.start &&
          reportEndDay === window.end
        if (!exactRequestedWindow) {
          gapCodes.push("ANALYTICS_RESPONSE_WINDOW_DIFFERS_FROM_REQUEST")
        }
        const normalizedItemIds = normalized.rows.map((row) =>
          analyticsItemId(row.dimension))
        if (normalizedItemIds.some((value) => value === null)) {
          markResponseCallFailed(response)
          throw new Error("ANALYTICS_VARIATION_GRAIN_UNSUPPORTED")
        }
        const validReturnedItemIds = normalizedItemIds.filter(
          (value): value is string => Boolean(value),
        )
        if (new Set(validReturnedItemIds).size !==
            validReturnedItemIds.length) {
          markResponseCallFailed(response)
          throw new Error("ANALYTICS_DUPLICATE_LISTING_GRAIN")
        }
        const reconciled = reconcileEbayTrafficAnalyticsReport({
          listingIds: listingChunk,
          dateFrom: window.start,
          dateTo: window.end,
          timeZone: "UTC",
        }, normalized)
        observedAt = input.clock().toISOString()
        const sourceUpdatedAt = `${sourceUpdatedDay}T00:00:00.000Z`
        if (reconciled.status !== "AVAILABLE") {
          gapCodes.push(reconciled.dataFreshnessStatus)
        }
        if (!normalized.rows.length) {
          gapCodes.push("ANALYTICS_LISTINGS_WITHOUT_EXPLICIT_ROWS")
        }
        for (const row of normalized.rows) {
        const itemId = analyticsItemId(row.dimension) ?? ""
        if (!itemId || !listingChunk.includes(itemId)) continue
        const metric = (key: string) => row.applicability[key] === true &&
            typeof row.metrics[key] === "number"
          ? row.metrics[key]
          : null
        const searchImpressions = metric(
          "LISTING_IMPRESSION_SEARCH_RESULTS_PAGE",
        )
        const searchViews = metric(
          "LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE",
        )
        const calculatedCtr = searchImpressions !== null &&
            searchViews !== null && searchImpressions > 0
          ? Number(((searchViews / searchImpressions) * 100).toFixed(4))
          : null
          observations.push({
          itemId,
          impressions: metric("TOTAL_IMPRESSION_TOTAL"),
          totalListingViews: metric("LISTING_VIEWS_TOTAL"),
          externalViews: metric("LISTING_VIEWS_SOURCE_OFF_EBAY"),
          transactions: metric("TRANSACTION"),
          reportedCtr: metric("CLICK_THROUGH_RATE"),
          calculatedCtr,
          calculatedCtrNumerator: calculatedCtr === null ? null : searchViews,
          calculatedCtrDenominator:
            calculatedCtr === null ? null : searchImpressions,
          reportedConversion: metric("SALES_CONVERSION_RATE"),
          applicable: {
            impressions: row.applicability.TOTAL_IMPRESSION_TOTAL === true,
            totalListingViews: row.applicability.LISTING_VIEWS_TOTAL === true,
            externalViews:
              row.applicability.LISTING_VIEWS_SOURCE_OFF_EBAY === true,
            transactions: row.applicability.TRANSACTION === true,
            reportedCtr: row.applicability.CLICK_THROUGH_RATE === true,
            calculatedCtr: calculatedCtr !== null,
            reportedConversion:
              row.applicability.SALES_CONVERSION_RATE === true,
          },
          windowStart: responseWindowStart,
          windowEnd: responseWindowEnd,
          observedAt,
          sourceUpdatedAt,
          lastUpdatedDate: normalized.lastUpdatedDate,
          completeness: reconciled.status === "AVAILABLE" &&
              exactRequestedWindow
            ? "COMPLETE"
            : "PARTIAL",
          freshnessStatus: reconciled.dataFreshnessStatus,
          source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
          })
        }
      } catch (error) {
        gapCodes.push(safeCode(error, "ANALYTICS_CHUNK_READ_FAILED"))
        break
      }
    }
    if (!observedAt) {
      return {
        status: "UNAVAILABLE",
        observedAt: null,
        windowStart: null,
        windowEnd: null,
        analyticsRequestedItemCount: selected.length,
        analyticsRepresentedItemCount: null,
        analyticsMissingItemCount: null,
        analyticsCoverageStatus: "UNPROVEN",
        accountTraffic,
        observations: [],
        gapCodes: [...new Set(gapCodes.length
          ? gapCodes
          : ["ANALYTICS_READ_FAILED"])],
      }
    }
    const representedItemCount = new Set(observations.map((row) => row.itemId))
      .size
    const missingItemCount = Math.max(
      0,
      selected.length - representedItemCount,
    )
    const partial = gapCodes.length > 0 || missingItemCount > 0
    return {
      status: partial ? "PARTIAL" : "CERTIFIED",
      observedAt,
      windowStart: actualWindowStart,
      windowEnd: actualWindowEnd,
      analyticsRequestedItemCount: selected.length,
      analyticsRepresentedItemCount: representedItemCount,
      analyticsMissingItemCount: missingItemCount,
      analyticsCoverageStatus: partial ? "PARTIAL" : "COMPLETE",
      accountTraffic,
      observations,
      gapCodes: [...new Set(gapCodes)],
    }
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      observedAt: null,
      windowStart: null,
      windowEnd: null,
      analyticsRequestedItemCount: selected.length,
      analyticsRepresentedItemCount: null,
      analyticsMissingItemCount: null,
      analyticsCoverageStatus: "UNPROVEN",
      accountTraffic,
      observations: [],
      gapCodes: [safeCode(error, "ANALYTICS_READ_FAILED")],
    }
  } finally {
    token = ""
  }
}

function orderWindow(now: Date) {
  const end = new Date(now)
  const start = new Date(now)
  start.setUTCDate(start.getUTCDate() - 30)
  return { start: start.toISOString(), end: end.toISOString() }
}

async function ordersRead(input: {
  credentials: ReturnType<typeof fulfillmentCredentials>
  expectedUserId: string
  expectedFingerprint: string
  fetchImpl: FetchLike
  calls: EbayMonitorReadonlyCallEvidence[]
  clock: Clock
  expiries: string[]
  scopeGrant: ScopeGrantEvidence
}) : Promise<EbayCommercialMonitorLiveReadonlyResult["orders"]> {
  const window = orderWindow(input.clock())
  if (input.credentials.partialDedicatedClient) {
    return {
      status: "UNAVAILABLE",
      observedAt: null,
      windowStart: window.start,
      windowEnd: window.end,
      orders: [],
      pagesRead: 0,
      rawOrdersDiscardedAfterSanitization: 0,
      observedOrderEvidenceKeys: [],
      gapCodes: ["FULFILLMENT_DEDICATED_CLIENT_PAIR_INCOMPLETE"],
    }
  }
  let token = ""
  try {
    const minted = await accessToken({
      operation: "OAUTH_REFRESH_FULFILLMENT",
      credentials: input.credentials,
      scopes: [BASE_SCOPE, FULFILLMENT_READONLY_SCOPE],
      fetchImpl: input.fetchImpl,
      calls: input.calls,
      clock: input.clock,
    })
    token = minted.value
    input.expiries.push(minted.expiresAt)
    const missingRequestedScopes = registerScopeEvidence({
      ledger: input.scopeGrant,
      token: minted,
      requestedScopes: [BASE_SCOPE, FULFILLMENT_READONLY_SCOPE],
    })
    await verifyAccount({
      token,
      expectedUserId: input.expectedUserId,
      expectedFingerprint: input.expectedFingerprint,
      fetchImpl: input.fetchImpl,
      calls: input.calls,
      clock: input.clock,
      fulfillmentSellerIdentityFallback: true,
    })
    input.scopeGrant.bindingVerified = true
    if (missingRequestedScopes.includes(FULFILLMENT_READONLY_SCOPE)) {
      throw new Error("EBAY_MONITOR_FULFILLMENT_SCOPE_MISSING")
    }
    const orders: SafeLiveEbayOrder[] = []
    let rawCount = 0
    const rawOrderIds = new Set<string>()
    let reportedTotal: number | null = null
    let pagesRead = 0
    let evidenceObserved = false
    const gapCodes: string[] = []
    let next: URL | null = new URL(FULFILLMENT_ORDERS_ENDPOINT)
    const orderFilter = `lastmodifieddate:[${window.start}..${window.end}]`
    let currentOffset = 0
    next.searchParams.set(
      "filter",
      orderFilter,
    )
    next.searchParams.set("limit", "100")
    next.searchParams.set("offset", "0")
    while (next && pagesRead < FULFILLMENT_MAX_PAGES) {
      try {
        const response = await allowlistedFetch({
          operation: "FULFILLMENT_GET_ORDERS",
          method: "GET",
          url: next,
          headers: {
            Authorization: `Bearer ${token}`,
            "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
          },
          fetchImpl: input.fetchImpl,
          calls: input.calls,
          clock: input.clock,
        })
        if (!response.ok) {
          throw new Error(`EBAY_MONITOR_ORDERS_${response.status}`)
        }
        const payload = record(await readJsonResponse({
          response,
          calls: input.calls,
          operation: "FULFILLMENT_GET_ORDERS",
          errorCode: "FULFILLMENT_SOURCE_FORMAT_CHANGED",
        }))
        if (!Array.isArray(payload.orders)) {
          markResponseCallFailed(response)
          throw new Error("FULFILLMENT_SOURCE_FORMAT_CHANGED")
        }
        const pageTotal = nonNegativeInteger(payload.total)
        if (pageTotal === null) {
          gapCodes.push("FULFILLMENT_TOTAL_UNPROVEN")
        } else if (reportedTotal !== null && reportedTotal !== pageTotal) {
          gapCodes.push("FULFILLMENT_TOTAL_CHANGED_DURING_READ")
        } else {
          reportedTotal = pageTotal
        }
        const rawOrders = payload.orders
        for (const rawOrder of rawOrders) {
          const rawOrderId = text(record(rawOrder).orderId, 100)
          if (rawOrderId && rawOrderIds.has(rawOrderId)) {
            gapCodes.push("FULFILLMENT_DUPLICATE_ORDER_ACROSS_PAGES")
          }
          if (rawOrderId) rawOrderIds.add(rawOrderId)
        }
        const sanitizedPayload = sanitizeLiveEbayOrders(payload)
        const sanitized = sanitizedPayload.filter((order) =>
          order.lastModifiedDate >= window.start &&
          order.lastModifiedDate <= window.end)
        if (sanitized.length !== sanitizedPayload.length) {
          gapCodes.push("FULFILLMENT_ORDER_OUTSIDE_REQUESTED_WINDOW")
        }
        const rawLineCount = rawOrders.reduce((count, order) => {
          const lines = record(order).lineItems
          return count + (Array.isArray(lines) ? lines.length : 0)
        }, 0)
        const sanitizedLineCount = sanitized.reduce((count, order) =>
          count + order.lineItems.length, 0)
        evidenceObserved = true
        rawCount += rawOrders.length
        orders.push(...sanitized)
        if (sanitized.length < rawOrders.length) {
          gapCodes.push("FULFILLMENT_ROWS_DISCARDED_AFTER_SANITIZATION")
        }
        if (sanitizedLineCount < rawLineCount) {
          gapCodes.push("FULFILLMENT_LINES_DISCARDED_AFTER_SANITIZATION")
        }
        pagesRead += 1
        const nextUrl = text(payload.next, 2_000)
        next = nextUrl ? new URL(nextUrl, EBAY_API_ORIGIN) : null
        if (next) {
          const nextOffset = nonNegativeInteger(
            next.searchParams.get("offset"),
          )
          const continuationValid = next.origin === EBAY_API_ORIGIN &&
            next.pathname === "/sell/fulfillment/v1/order" &&
            next.searchParams.get("filter") === orderFilter &&
            next.searchParams.get("limit") === "100" &&
            nextOffset === currentOffset + 100
          if (!continuationValid) {
            gapCodes.push("EBAY_MONITOR_ORDERS_PAGINATION_BLOCKED")
            next = null
          } else {
            currentOffset = nextOffset
          }
        }
      } catch (error) {
        gapCodes.push(safeCode(error, "FULFILLMENT_ORDER_PAGE_FAILED"))
        break
      }
    }
    if (!evidenceObserved) {
      return {
        status: "UNAVAILABLE",
        observedAt: null,
        windowStart: window.start,
        windowEnd: window.end,
        orders: [],
        pagesRead: 0,
        rawOrdersDiscardedAfterSanitization: 0,
        observedOrderEvidenceKeys: [],
        gapCodes: [...new Set(gapCodes.length
          ? gapCodes
          : ["FULFILLMENT_ORDER_READ_FAILED"])],
      }
    }
    const truncated = Boolean(next)
    if (truncated) gapCodes.push("FULFILLMENT_ORDER_PAGE_LIMIT_REACHED")
    if (!truncated && reportedTotal !== null &&
        rawOrderIds.size !== reportedTotal) {
      gapCodes.push("FULFILLMENT_PAGINATION_UNPROVEN")
    }
    const dedupedOrders = [...new Map(orders.map((order) => [
      order.ebayOrderId,
      {
        ...order,
        lineItems: [...new Map(order.lineItems.map((line) => [
          line.lineItemId,
          line,
        ])).values()],
      },
    ])).values()]
    if (dedupedOrders.length !== orders.length || dedupedOrders.some(
      (order) => order.lineItems.length !==
        orders.find((candidate) =>
          candidate.ebayOrderId === order.ebayOrderId)?.lineItems.length,
    )) gapCodes.push("FULFILLMENT_DUPLICATE_EVIDENCE_DEDUPED")
    gapCodes.push("ORDERS_WINDOW_CHECKOUT_COMPLETE_ONLY")
    return {
      status: truncated || gapCodes.some((code) =>
        code !== "ORDERS_WINDOW_CHECKOUT_COMPLETE_ONLY")
        ? "PARTIAL"
        : "CERTIFIED",
      observedAt: input.clock().toISOString(),
      windowStart: window.start,
      windowEnd: window.end,
      orders: dedupedOrders,
      pagesRead,
      rawOrdersDiscardedAfterSanitization: Math.max(
        0,
        rawCount - dedupedOrders.length,
      ),
      observedOrderEvidenceKeys: [...rawOrderIds]
        .map(hashEbayMonitorEvidenceIdentifier).sort(),
      gapCodes: [...new Set(gapCodes)],
    }
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      observedAt: null,
      windowStart: window.start,
      windowEnd: window.end,
      orders: [],
      pagesRead: 0,
      rawOrdersDiscardedAfterSanitization: 0,
      observedOrderEvidenceKeys: [],
      gapCodes: [safeCode(error, "FULFILLMENT_ORDER_READ_FAILED")],
    }
  } finally {
    token = ""
  }
}

export type EbayOfficialOrdersLiveReadonlyEvidenceV1 = {
  orders: EbayCommercialMonitorLiveReadonlyResult["orders"]
  canonicalAccountBinding: "MATCHED" | "UNAVAILABLE"
  refreshCapability: boolean
  accountIdentitySource:
    | "EBAY_TRADING_GET_USER"
    | "EBAY_SELL_FULFILLMENT_GET_ORDERS_SELLER_ID"
    | null
  calls: EbayMonitorReadonlyCallEvidence[]
  safety: {
    marketplaceWrites: 0
    inventoryWrites: 0
    fulfillmentWrites: 0
    buyerMessages: 0
    whatsappCalls: 0
    tokensReturned: false
    rawPayloadsReturned: false
    buyerPiiReturned: false
  }
}

/**
 * Dedicated fixed-account Orders read. Official Orders must not depend on
 * seller-wide listing discovery, Inventory, or Analytics availability.
 */
export async function getEbayOfficialOrdersLiveReadonly(input: {
  accountKey: string | null
  accountAlias: string | null
  environment?: NodeJS.ProcessEnv
  fetchImpl?: FetchLike
  clock?: Clock
}): Promise<EbayOfficialOrdersLiveReadonlyEvidenceV1> {
  const environment = input.environment ?? process.env
  const fetchImpl = input.fetchImpl ?? fetch
  const clock = input.clock ?? (() => new Date())
  const configuration = getEbayCommercialMonitorLiveConfigurationState(
    environment,
  )
  const identity = getEbayProductionIdentityBindingConfiguration(environment)
  const expectedAccountKey = configuration.accountAlias && identity.bound
    ? `${configuration.accountAlias}:${identity.expectedAccountFingerprint}`
    : null
  const calls: EbayMonitorReadonlyCallEvidence[] = []
  const safety = {
    marketplaceWrites: 0 as const,
    inventoryWrites: 0 as const,
    fulfillmentWrites: 0 as const,
    buyerMessages: 0 as const,
    whatsappCalls: 0 as const,
    tokensReturned: false as const,
    rawPayloadsReturned: false as const,
    buyerPiiReturned: false as const,
  }
  if (!configuration.configured || !input.accountKey ||
      input.accountKey !== expectedAccountKey ||
      input.accountAlias !== configuration.accountAlias) {
    const unavailable = unavailableResult({
      accountAlias: configuration.accountAlias,
      bindingConfigured: identity.bound,
      limitationCode: !configuration.configured
        ? "LOCAL_EBAY_AUTH_CONTEXT_UNAVAILABLE"
        : "EBAY_MONITOR_ACCOUNT_SCOPE_CONFIGURATION_MISMATCH",
    })
    return {
      orders: unavailable.orders,
      canonicalAccountBinding: "UNAVAILABLE",
      refreshCapability: false,
      accountIdentitySource: null,
      calls,
      safety,
    }
  }

  const maximumCalls = FULFILLMENT_MAX_PAGES + 4
  requestBudgets.set(calls, {
    deadlineAt: Date.now() + REQUEST_BUDGET_MS,
    callsRemaining: maximumCalls,
    maximumCalls,
    callsStarted: 0,
  })
  const expiries: string[] = []
  const fulfillmentGrant = scopeGrantEvidence()
  const orders = await ordersRead({
    credentials: fulfillmentCredentials(environment),
    expectedUserId: identity.expectedUserId,
    expectedFingerprint: identity.expectedAccountFingerprint,
    fetchImpl,
    calls,
    clock,
    expiries,
    scopeGrant: fulfillmentGrant,
  })
  const refreshCapability = calls.some((call) =>
    call.operation === "OAUTH_REFRESH_FULFILLMENT" &&
    call.status === "SUCCEEDED")
  const accountIdentitySource = fulfillmentGrant.bindingVerified
    ? calls.some((call) => call.operation === "TRADING_GET_USER" &&
        call.status === "SUCCEEDED")
      ? "EBAY_TRADING_GET_USER" as const
      : "EBAY_SELL_FULFILLMENT_GET_ORDERS_SELLER_ID" as const
    : null
  return {
    orders,
    canonicalAccountBinding: fulfillmentGrant.bindingVerified
      ? "MATCHED"
      : "UNAVAILABLE",
    refreshCapability,
    accountIdentitySource,
    calls: [...calls],
    safety,
  }
}

function scopeEvidence(input: {
  baseAvailable: boolean
  inventoryAvailable: boolean
  analyticsAvailable: boolean
  fulfillmentAvailable: boolean
  tradingGrant: ScopeGrantEvidence
  inventoryGrant: ScopeGrantEvidence
  analyticsGrant: ScopeGrantEvidence
  fulfillmentGrant: ScopeGrantEvidence
  calls: EbayMonitorReadonlyCallEvidence[]
}) : EbayMonitorScopeEvidence[] {
  const succeeded = new Set(input.calls
    .filter((call) => call.status === "SUCCEEDED")
    .map((call) => call.operation))
  const evidenceOperation = (...operations: EbayMonitorReadonlyOperation[]) => {
    const proven = operations.filter((operation) => succeeded.has(operation))
    return proven.length ? proven.join("+") : null
  }
  const classifications = (
    scope: string,
    readerAvailable: boolean,
    grant: ScopeGrantEvidence,
    writeCapable = false,
  ): EbayMonitorScopeClassification[] => [
    "READ_REQUIRED",
    ...(readerAvailable ||
        (grant.bindingVerified && grant.granted.has(scope))
      ? ["READ_AVAILABLE" as const]
      : []),
    ...(!readerAvailable && grant.bindingVerified &&
        !(grant.bindingVerified && grant.granted.has(scope)) &&
        grant.missing.has(scope)
      ? ["MISSING" as const]
      : []),
    ...(writeCapable && (readerAvailable ||
        (grant.bindingVerified && grant.granted.has(scope)))
      ? ["WRITE_CAPABLE_BUT_NOT_USED" as const]
      : []),
  ]
  return [
    {
      scope: BASE_SCOPE,
      classifications: classifications(
        BASE_SCOPE,
        input.baseAvailable,
        input.tradingGrant,
        true,
      ),
      evidenceOperation: evidenceOperation(
        "TRADING_GET_USER",
        "TRADING_GET_MY_EBAY_SELLING",
        "TRADING_GET_ITEM_MARKETPLACE",
      ),
    },
    {
      scope: INVENTORY_READONLY_SCOPE,
      classifications: classifications(
        INVENTORY_READONLY_SCOPE,
        input.inventoryAvailable,
        input.inventoryGrant,
      ),
      evidenceOperation: evidenceOperation(
        "INVENTORY_GET_ITEMS",
        "INVENTORY_GET_OFFERS",
      ),
    },
    {
      scope: ANALYTICS_READONLY_SCOPE,
      classifications: classifications(
        ANALYTICS_READONLY_SCOPE,
        input.analyticsAvailable,
        input.analyticsGrant,
      ),
      evidenceOperation: evidenceOperation("ANALYTICS_GET_TRAFFIC_REPORT"),
    },
    {
      scope: FULFILLMENT_READONLY_SCOPE,
      classifications: classifications(
        FULFILLMENT_READONLY_SCOPE,
        input.fulfillmentAvailable,
        input.fulfillmentGrant,
      ),
      evidenceOperation: evidenceOperation("FULFILLMENT_GET_ORDERS"),
    },
  ]
}

export function getEbayCommercialMonitorLiveConfigurationState(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const credentials = generalCredentials(environment)
  const accountAlias = normalizeEbaySellerAccountAlias(
    environment.EBAY_SELLER_ACCOUNT_KEY,
  )
  const accountAliasValid = /^[A-Za-z0-9._-]{1,80}$/.test(accountAlias)
  const identity = getEbayProductionIdentityBindingConfiguration(environment)
  return {
    configured: Boolean(
      credentials.clientId && credentials.clientSecret &&
      credentials.refreshToken && accountAliasValid && identity.bound,
    ),
    accountAlias: accountAliasValid ? accountAlias : null,
    identityBound: identity.bound,
    identityConsistent: identity.consistent,
    clientIdPresent: Boolean(credentials.clientId),
    clientSecretPresent: Boolean(credentials.clientSecret),
    refreshTokenPresent: Boolean(credentials.refreshToken),
    secretValuesReturned: false,
    missingConfiguration: [
      ...(!credentials.clientId ? ["EBAY_CLIENT_ID"] : []),
      ...(!credentials.clientSecret ? ["EBAY_CLIENT_SECRET"] : []),
      ...(!credentials.refreshToken ? ["EBAY_SELLER_REFRESH_TOKEN"] : []),
      ...(!accountAliasValid ? ["EBAY_SELLER_ACCOUNT_KEY"] : []),
      ...(!identity.bound ? ["EBAY_OFFICIAL_ACCOUNT_IDENTITY"] : []),
    ],
  }
}

function inventoryConsumerDiagnosticErrorCategory(
  error: unknown,
): EbayInventoryConsumerSafeErrorCategory {
  const code = safeCode(error, "UNCLASSIFIED")
  if (code === "EBAY_MONITOR_INVENTORY_SCOPE_MISSING") {
    return "INVALID_SCOPE"
  }
  if (code.endsWith("_SCOPE_SET_MISMATCH")) return "INVALID_SCOPE"
  for (const category of [
    "INVALID_SCOPE",
    "INVALID_GRANT",
    "INVALID_CLIENT",
    "INVALID_REQUEST",
    "UNSUPPORTED_GRANT_TYPE",
    "OAUTH_ERROR_UNCLASSIFIED",
  ] as const) {
    if (code.endsWith(`_${category}`)) return category
  }
  if (code === "EBAY_MONITOR_REQUEST_BUDGET_EXHAUSTED") {
    return "BUDGET_EXHAUSTED"
  }
  if (code === "EBAY_MONITOR_READ_TIMEOUT") return "TIMEOUT"
  if (code === "EBAY_MONITOR_READ_NETWORK_ERROR") return "NETWORK"
  if (code.includes("ACCOUNT") || code.includes("IDENTITY") ||
      code.includes("FINGERPRINT") || code.includes("MARKETPLACE")) {
    return "ACCOUNT_BINDING_FAILED"
  }
  if (code.includes("CONFIGURATION") || code.includes("TOKEN_MISSING")) {
    return "CONFIGURATION_MISSING"
  }
  if (code.includes("FORMAT")) return "RESPONSE_FORMAT_CHANGED"
  return "UNCLASSIFIED"
}

function inventoryConsumerHttpErrorCategory(status: number) {
  if (status >= 200 && status < 400) {
    return "RESPONSE_FORMAT_CHANGED" as const
  }
  if (status === 401) return "HTTP_401" as const
  if (status === 403) return "HTTP_403" as const
  if (status === 429) return "RATE_LIMITED" as const
  if (status >= 500) return "HTTP_5XX" as const
  return "HTTP_4XX" as const
}

async function readBoundedInventoryErrorMetadata(response: Response) {
  const unproven = () => parseSafeEbayInventoryErrorMetadata(null)
  const declaredLength = response.headers.get("content-length")
  if (declaredLength && (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > INVENTORY_CONSUMER_ERROR_BODY_MAX_BYTES)) {
    try {
      await response.body?.cancel()
    } catch {
      // Shape remains unproven; provider bytes are deliberately discarded.
    }
    return unproven()
  }
  if (!response.body) return unproven()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let observedBytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      observedBytes += chunk.value.byteLength
      if (observedBytes > INVENTORY_CONSUMER_ERROR_BODY_MAX_BYTES) {
        await reader.cancel()
        return unproven()
      }
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(observedBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    if (!body) return unproven()
    return parseSafeEbayInventoryErrorMetadata(JSON.parse(body) as unknown)
  } catch {
    return unproven()
  } finally {
    reader.releaseLock()
  }
}

/**
 * Protected callers use this to exercise the exact generic-token Inventory
 * consumer request without invoking Analytics, Orders, offers, or any write.
 * It deliberately returns shape metadata only; the payload is discarded.
 */
export async function diagnoseInstalledEbayInventoryConsumer(input: {
  fetchImpl?: FetchLike
  clock?: Clock
  startedAt?: number
} = {}): Promise<EbayInstalledInventoryConsumerDiagnostic> {
  const environment = process.env
  const fetchImpl = input.fetchImpl ?? fetch
  const clock = input.clock ?? (() => new Date())
  const startedAt = input.startedAt ?? Date.now()
  const credentials = generalCredentials(environment)
  const identity = getEbayProductionIdentityBindingConfiguration(environment)
  const calls: EbayMonitorReadonlyCallEvidence[] = []
  requestBudgets.set(calls, {
    deadlineAt: startedAt + INVENTORY_CONSUMER_DIAGNOSTIC_DEADLINE_MS,
    callsRemaining: INVENTORY_CONSUMER_DIAGNOSTIC_MAX_CALLS,
    maximumCalls: INVENTORY_CONSUMER_DIAGNOSTIC_MAX_CALLS,
    callsStarted: 0,
  })
  let subsetToken = ""
  let fourScopeToken = ""
  let httpStatus: number | null = null
  let authorized = false
  let contentType: "application/json" | "OTHER" | null = null
  let topLevelKeys: string[] = []
  let hasArray = false
  let arrayCount: number | null = null
  let totalPresent = false
  let total: number | null = null
  let nextPresent = false
  let responseShape: EbayInstalledInventoryConsumerDiagnostic[
    "inventoryItemsResponseShape"
  ] = "UNPROVEN"
  let catalogState: EbayInstalledInventoryConsumerDiagnostic[
    "inventoryCatalogState"
  ] = "UNPROVEN"
  let safeErrorCategory: EbayInventoryConsumerSafeErrorCategory = "NONE"
  let globalCallsBeforeInventory: number | null = null
  let globalTimeRemainingBeforeInventoryMs: number | null = null
  let subsetScopeRefresh: "AVAILABLE" | "FAILED" = "FAILED"
  let fourScopeRefresh: "AVAILABLE" | "FAILED" | "NOT_RUN" = "NOT_RUN"
  let fourScopeControlBudgetExhausted = false
  const emptyVariant = (
    variant: EbayInventoryConsumerVariant,
  ): EbayInventoryConsumerVariantEvidence => ({
    variant,
    httpStatus: null,
    acceptedByEndpoint: false,
    contentType: null,
    responseShape: "UNPROVEN",
    catalogState: "UNPROVEN",
    safeErrorCategory: "UNCLASSIFIED",
    errorMetadata: parseSafeEbayInventoryErrorMetadata(null),
  })
  let currentCanonical = emptyVariant("CURRENT_CANONICAL")
  let noMarketplaceHeader = emptyVariant("NO_MARKETPLACE_HEADER")
  let limitOnly = emptyVariant("LIMIT_ONLY")
  let noQuery = emptyVariant("NO_QUERY")
  let fourScopeControl: EbayInventoryConsumerVariantEvidence | null = null
  try {
    if (!credentials.clientId || !credentials.clientSecret ||
        !credentials.refreshToken || !identity.bound || !identity.consistent) {
      throw new Error("EBAY_MONITOR_OAUTH_CONFIGURATION_MISSING")
    }
    const scopeGrant = scopeGrantEvidence()
    const minted = await accessToken({
      operation: "OAUTH_REFRESH_INVENTORY",
      credentials,
      scopes: [BASE_SCOPE, INVENTORY_READONLY_SCOPE],
      fetchImpl,
      calls,
      clock,
    })
    subsetScopeRefresh = "AVAILABLE"
    subsetToken = minted.value
    const subsetScopes = [BASE_SCOPE, INVENTORY_READONLY_SCOPE]
    if (!returnedScopeSetIsExact(minted, subsetScopes)) {
      throw new Error("EBAY_MONITOR_INVENTORY_SCOPE_SET_MISMATCH")
    }
    const missingRequestedScopes = registerScopeEvidence({
      ledger: scopeGrant,
      token: minted,
      requestedScopes: subsetScopes,
    })
    const account = await verifyAccount({
      token: subsetToken,
      expectedUserId: identity.expectedUserId,
      expectedFingerprint: identity.expectedAccountFingerprint,
      fetchImpl,
      calls,
      clock,
    })
    if (account.site !== "US") {
      throw new Error("EBAY_MONITOR_ACCOUNT_MARKETPLACE_MISMATCH")
    }
    scopeGrant.bindingVerified = true
    if (missingRequestedScopes.includes(INVENTORY_READONLY_SCOPE)) {
      throw new Error("EBAY_MONITOR_INVENTORY_SCOPE_MISSING")
    }

    const budget = requestBudgets.get(calls)
    globalCallsBeforeInventory = budget?.callsStarted ?? null
    globalTimeRemainingBeforeInventoryMs = budget
      ? Math.max(0, budget.deadlineAt - Date.now())
      : null
    const variantA = new URL(INVENTORY_ITEMS_ENDPOINT)
    variantA.searchParams.set("limit", "50")
    variantA.searchParams.set("offset", "0")
    const variantB = new URL(variantA)
    const variantC = new URL(INVENTORY_ITEMS_ENDPOINT)
    variantC.searchParams.set("limit", "50")
    const variantD = new URL(INVENTORY_ITEMS_ENDPOINT)

    const currentResult = await probeVariant({
      variant: "CURRENT_CANONICAL",
      operation: "INVENTORY_GET_ITEMS_MATRIX_A",
      token: subsetToken,
      url: variantA,
      marketplaceHeader: true,
      expectedLimit: 50,
      expectedOffset: 0,
    })
    currentCanonical = currentResult.evidence
    httpStatus = currentCanonical.httpStatus
    authorized = currentCanonical.acceptedByEndpoint
    contentType = currentCanonical.contentType
    safeErrorCategory = currentCanonical.safeErrorCategory
    responseShape = currentCanonical.responseShape
    catalogState = currentCanonical.catalogState
    topLevelKeys = currentResult.shapeMetadata.topLevelKeys
    hasArray = currentResult.shapeMetadata.hasArray
    arrayCount = currentResult.shapeMetadata.arrayCount
    totalPresent = currentResult.shapeMetadata.totalPresent
    total = currentResult.shapeMetadata.total
    nextPresent = currentResult.shapeMetadata.nextPresent

    noMarketplaceHeader = (await probeVariant({
      variant: "NO_MARKETPLACE_HEADER",
      operation: "INVENTORY_GET_ITEMS_MATRIX_B",
      token: subsetToken,
      url: variantB,
      marketplaceHeader: false,
      expectedLimit: 50,
      expectedOffset: 0,
    })).evidence
    limitOnly = (await probeVariant({
      variant: "LIMIT_ONLY",
      operation: "INVENTORY_GET_ITEMS_MATRIX_C",
      token: subsetToken,
      url: variantC,
      marketplaceHeader: false,
      expectedLimit: 50,
      expectedOffset: 0,
    })).evidence
    noQuery = (await probeVariant({
      variant: "NO_QUERY",
      operation: "INVENTORY_GET_ITEMS_MATRIX_D",
      token: subsetToken,
      url: variantD,
      marketplaceHeader: false,
      expectedLimit: 25,
      expectedOffset: 0,
    })).evidence

    if ([currentCanonical, noMarketplaceHeader, limitOnly, noQuery]
      .every((variant) => variant.httpStatus === 400)) {
      const controlBudget = requestBudgets.get(calls)
      if (!controlBudget || controlBudget.callsRemaining < 2 ||
          controlBudget.deadlineAt - Date.now() < REQUEST_TIMEOUT_MS * 2) {
        fourScopeControlBudgetExhausted = true
      } else {
        fourScopeRefresh = "FAILED"
        try {
          const fourScopeMinted = await accessToken({
            operation: "OAUTH_REFRESH_INVENTORY_FOUR_SCOPE",
            credentials,
            scopes: [
              BASE_SCOPE,
              ACCOUNT_READONLY_SCOPE,
              INVENTORY_READONLY_SCOPE,
              ANALYTICS_READONLY_SCOPE,
            ],
            fetchImpl,
            calls,
            clock,
          })
          fourScopeToken = fourScopeMinted.value
          const fourScopes = [
            BASE_SCOPE,
            ACCOUNT_READONLY_SCOPE,
            INVENTORY_READONLY_SCOPE,
            ANALYTICS_READONLY_SCOPE,
          ]
          if (!returnedScopeSetIsExact(fourScopeMinted, fourScopes)) {
            throw new Error(
              "EBAY_MONITOR_FOUR_SCOPE_CONTROL_SCOPE_SET_MISMATCH",
            )
          }
          const fourScopeEvidence = scopeGrantEvidence()
          const missingFourScopes = registerScopeEvidence({
            ledger: fourScopeEvidence,
            token: fourScopeMinted,
            requestedScopes: fourScopes,
          })
          if (missingFourScopes.length > 0) {
            throw new Error("EBAY_MONITOR_FOUR_SCOPE_CONTROL_MISSING_SCOPE")
          }
          fourScopeRefresh = "AVAILABLE"
          fourScopeControl = (await probeVariant({
            variant: "NO_QUERY",
            operation: "INVENTORY_GET_ITEMS_FOUR_SCOPE_CONTROL",
            token: fourScopeToken,
            url: variantD,
            marketplaceHeader: false,
            expectedLimit: 25,
            expectedOffset: 0,
          })).evidence
        } catch (error) {
          fourScopeControlBudgetExhausted =
            inventoryConsumerDiagnosticErrorCategory(error) ===
              "BUDGET_EXHAUSTED"
          // The fixed control is evidence-only. Its failure never falls back
          // to, replaces, or changes any subset-token result.
        }
      }
    }
    return diagnosticResult()
  } catch (error) {
    safeErrorCategory = inventoryConsumerDiagnosticErrorCategory(error)
    if (authorized && safeErrorCategory === "RESPONSE_FORMAT_CHANGED") {
      responseShape = "INVALID"
    }
    return diagnosticResult()
  } finally {
    subsetToken = ""
    fourScopeToken = ""
  }

  async function probeVariant(input: {
    variant: EbayInventoryConsumerVariant
    operation:
      | "INVENTORY_GET_ITEMS_MATRIX_A"
      | "INVENTORY_GET_ITEMS_MATRIX_B"
      | "INVENTORY_GET_ITEMS_MATRIX_C"
      | "INVENTORY_GET_ITEMS_MATRIX_D"
      | "INVENTORY_GET_ITEMS_FOUR_SCOPE_CONTROL"
    token: string
    url: URL
    marketplaceHeader: boolean
    expectedLimit: number
    expectedOffset: number
  }) {
    const emptyShapeMetadata = {
      topLevelKeys: [] as string[],
      hasArray: false,
      arrayCount: null as number | null,
      totalPresent: false,
      total: null as number | null,
      nextPresent: false,
    }
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${input.token}`,
      }
      if (input.marketplaceHeader) {
        headers["X-EBAY-C-MARKETPLACE-ID"] = MARKETPLACE_ID
      }
      const response = await allowlistedFetch({
        operation: input.operation,
        method: "GET",
        url: input.url,
        headers,
        fetchImpl,
        calls,
        clock,
      })
      const mediaType = (response.headers.get("content-type") ?? "")
        .split(";", 1)[0].trim().toLowerCase()
      const variantContentType = mediaType === "application/json"
        ? "application/json" as const
        : "OTHER" as const
      if (response.status !== 200) {
        markResponseCallFailed(response)
        const errorMetadata = response.status >= 400 &&
            variantContentType === "application/json"
          ? await readBoundedInventoryErrorMetadata(response)
          : parseSafeEbayInventoryErrorMetadata(null)
        return {
          evidence: {
            variant: input.variant,
            httpStatus: response.status,
            acceptedByEndpoint: false,
            contentType: variantContentType,
            responseShape: "UNPROVEN" as const,
            catalogState: "UNPROVEN" as const,
            safeErrorCategory: inventoryConsumerHttpErrorCategory(
              response.status,
            ),
            errorMetadata,
          },
          shapeMetadata: emptyShapeMetadata,
        }
      }
      if (variantContentType !== "application/json") {
        markResponseCallFailed(response)
        return {
          evidence: {
            variant: input.variant,
            httpStatus: response.status,
            acceptedByEndpoint: true,
            contentType: variantContentType,
            responseShape: "INVALID" as const,
            catalogState: "UNPROVEN" as const,
            safeErrorCategory: "RESPONSE_FORMAT_CHANGED" as const,
            errorMetadata: parseSafeEbayInventoryErrorMetadata(null),
          },
          shapeMetadata: emptyShapeMetadata,
        }
      }
      let rawPayload: unknown
      try {
        rawPayload = await readJsonResponse({
          response,
          calls,
          operation: input.operation,
          errorCode: "INVENTORY_SOURCE_FORMAT_CHANGED",
        })
      } catch {
        return {
          evidence: {
            variant: input.variant,
            httpStatus: response.status,
            acceptedByEndpoint: true,
            contentType: variantContentType,
            responseShape: "INVALID" as const,
            catalogState: "UNPROVEN" as const,
            safeErrorCategory: "RESPONSE_FORMAT_CHANGED" as const,
            errorMetadata: parseSafeEbayInventoryErrorMetadata(null),
          },
          shapeMetadata: emptyShapeMetadata,
        }
      }
      const parsed = parseEbayInventoryItemsPage(rawPayload, {
        expectedLimit: input.expectedLimit,
        expectedOffset: input.expectedOffset,
      })
      const shapeMetadata = {
        topLevelKeys: parsed.metadata.topLevelKeys,
        hasArray: parsed.metadata.hasArray,
        arrayCount: parsed.metadata.arrayCount,
        totalPresent: parsed.metadata.totalPresent,
        total: parsed.total,
        nextPresent: parsed.metadata.nextPresent,
      }
      if (!parsed.accepted) {
        markResponseCallFailed(response)
        return {
          evidence: {
            variant: input.variant,
            httpStatus: response.status,
            acceptedByEndpoint: true,
            contentType: variantContentType,
            responseShape: "INVALID" as const,
            catalogState: "UNPROVEN" as const,
            safeErrorCategory: "RESPONSE_FORMAT_CHANGED" as const,
            errorMetadata: parseSafeEbayInventoryErrorMetadata(null),
          },
          shapeMetadata,
        }
      }
      return {
        evidence: {
          variant: input.variant,
          httpStatus: response.status,
          acceptedByEndpoint: true,
          contentType: variantContentType,
          responseShape: parsed.responseShape,
          catalogState: parsed.inventoryItems.length === 0
            ? parsed.total === 0 ? "EMPTY" as const : "UNPROVEN" as const
            : "NON_EMPTY" as const,
          safeErrorCategory: "NONE" as const,
          errorMetadata: parseSafeEbayInventoryErrorMetadata(null),
        },
        shapeMetadata,
      }
    } catch (error) {
      return {
        evidence: {
          variant: input.variant,
          httpStatus: null,
          acceptedByEndpoint: false,
          contentType: null,
          responseShape: "UNPROVEN" as const,
          catalogState: "UNPROVEN" as const,
          safeErrorCategory: inventoryConsumerDiagnosticErrorCategory(error),
          errorMetadata: parseSafeEbayInventoryErrorMetadata(null),
        },
        shapeMetadata: emptyShapeMetadata,
      }
    }
  }

  function diagnosticResult(): EbayInstalledInventoryConsumerDiagnostic {
    const budget = requestBudgets.get(calls)
    const subsetVariants = [
      currentCanonical,
      noMarketplaceHeader,
      limitOnly,
      noQuery,
    ]
    const firstAcceptedVariant = subsetVariants.find((variant) =>
      variant.acceptedByEndpoint)?.variant ?? null
    const minimumDocumentedAcceptedVariant = [
      noQuery,
      limitOnly,
      noMarketplaceHeader,
    ].find((variant) => variant.acceptedByEndpoint)?.variant ?? null
    const allSubsetVariantsReturned400 = subsetVariants.every((variant) =>
      variant.httpStatus === 400)
    const anySubsetVariantAccepted = subsetVariants.some((variant) =>
      variant.acceptedByEndpoint)
    const scopeMintingDifferenceCauses400 = anySubsetVariantAccepted
      ? "NO" as const
      : allSubsetVariantsReturned400 && fourScopeControl?.acceptedByEndpoint
        ? "YES" as const
        : allSubsetVariantsReturned400 && fourScopeControl?.httpStatus === 400
          ? "NO" as const
          : "UNPROVEN" as const
    const requestContractRootCause = currentCanonical.acceptedByEndpoint
      ? "CURRENT_CANONICAL_ACCEPTED" as const
      : currentCanonical.httpStatus === 400 &&
          noMarketplaceHeader.acceptedByEndpoint
        ? "MARKETPLACE_HEADER_REJECTED" as const
        : currentCanonical.httpStatus === 400 &&
            noMarketplaceHeader.httpStatus === 400 &&
            limitOnly.acceptedByEndpoint
          ? "OFFSET_ZERO_REJECTED" as const
          : currentCanonical.httpStatus === 400 &&
              noMarketplaceHeader.httpStatus === 400 &&
              limitOnly.httpStatus === 400 && noQuery.acceptedByEndpoint
            ? "LIMIT_QUERY_REJECTED" as const
            : allSubsetVariantsReturned400 &&
                fourScopeControl?.acceptedByEndpoint
              ? "SCOPE_MINTING_DIFFERENCE" as const
              : allSubsetVariantsReturned400 &&
                  fourScopeControl?.httpStatus === 400
                ? "ALL_DOCUMENTED_VARIANTS_REJECTED" as const
                : "UNPROVEN" as const
    const failureFromBudget = Boolean(
      safeErrorCategory === "BUDGET_EXHAUSTED" ||
      subsetVariants.some((variant) =>
        variant.safeErrorCategory === "BUDGET_EXHAUSTED") ||
      fourScopeControl?.safeErrorCategory === "BUDGET_EXHAUSTED" ||
      fourScopeControlBudgetExhausted,
    )
    return {
      credentialSource: "GENERIC_ENV_TOKEN_ONLY",
      genericEnvironmentTokenFallback: false,
      inventoryItemsHttpStatus: httpStatus,
      inventoryItemsAuthorized: authorized,
      inventoryItemsContentType: contentType,
      inventoryItemsTopLevelKeys: [...topLevelKeys],
      inventoryItemsHasArray: hasArray,
      inventoryItemsArrayCount: arrayCount,
      inventoryItemsTotalPresent: totalPresent,
      inventoryItemsTotal: total,
      inventoryItemsNextPresent: nextPresent,
      inventoryItemsResponseShape: responseShape,
      inventoryCatalogState: catalogState,
      inventoryItemsSafeErrorCategory: safeErrorCategory,
      variants: {
        currentCanonical,
        noMarketplaceHeader,
        limitOnly,
        noQuery,
      },
      firstAcceptedVariant,
      minimumDocumentedAcceptedVariant,
      requestContractRootCause,
      scopeControl: {
        subsetScopeRefresh,
        fourScopeRefresh,
        subsetScopeInventoryItemsStatus: noQuery.httpStatus,
        fourScopeInventoryItemsStatus: fourScopeControl?.httpStatus ?? null,
        scopeMintingDifferenceCauses400,
      },
      execution: {
        globalCallsBeforeInventory,
        globalTimeRemainingBeforeInventoryMs,
        inventoryRefreshExecuted: calls.some((call) =>
          call.operation === "OAUTH_REFRESH_INVENTORY"),
        inventoryGetUserExecuted: calls.some((call) =>
          call.operation === "TRADING_GET_USER"),
        inventoryGetItemsExecuted: calls.some((call) =>
          call.operation.startsWith("INVENTORY_GET_ITEMS_MATRIX_")),
        fourScopeRefreshExecuted: calls.some((call) =>
          call.operation === "OAUTH_REFRESH_INVENTORY_FOUR_SCOPE"),
        fourScopeInventoryGetItemsExecuted: calls.some((call) =>
          call.operation === "INVENTORY_GET_ITEMS_FOUR_SCOPE_CONTROL"),
        inventoryFailureFromBudget: failureFromBudget,
        externalCalls: budget?.callsStarted ?? calls.length,
        maximumExternalCalls: 8,
      },
      calls: calls.map((call) => ({ ...call })),
      safety: {
        tokenPersisted: false,
        tokenReturned: false,
        rawPayloadReturned: false,
        authorizationHeaderReturned: false,
        ledgerMutations: 0,
        ebayWrites: 0,
        inventoryWrites: 0,
        businessDataMutations: 0,
        registryMutations: 0,
        productCaseMutations: 0,
        vaultMutations: 0,
        vercelMutations: 0,
      },
    }
  }
}

export async function getEbayCommercialMonitorLiveReadonly(input: {
  accountKey: string | null
  accountAlias: string | null
  environment?: NodeJS.ProcessEnv
  fetchImpl?: FetchLike
  clock?: Clock
  readLimits?: {
    maximumCalls?: number
    budgetMs?: number
  }
}): Promise<EbayCommercialMonitorLiveReadonlyResult> {
  const environment = input.environment ?? process.env
  const fetchImpl = input.fetchImpl ?? fetch
  const clock = input.clock ?? (() => new Date())
  const configuration = getEbayCommercialMonitorLiveConfigurationState(
    environment,
  )
  const identity = getEbayProductionIdentityBindingConfiguration(environment)
  const expectedAccountKey = configuration.accountAlias && identity.bound
    ? `${configuration.accountAlias}:${identity.expectedAccountFingerprint}`
    : null
  if (!configuration.configured || !input.accountKey ||
      input.accountKey !== expectedAccountKey ||
      input.accountAlias !== configuration.accountAlias) {
    return unavailableResult({
      accountAlias: configuration.accountAlias,
      bindingConfigured: identity.bound,
      limitationCode: !configuration.configured
        ? "LOCAL_EBAY_AUTH_CONTEXT_UNAVAILABLE"
        : "EBAY_MONITOR_ACCOUNT_SCOPE_CONFIGURATION_MISMATCH",
    })
  }

  const calls: EbayMonitorReadonlyCallEvidence[] = []
  const requestedBudgetMs = input.readLimits?.budgetMs
  const requestedMaximumCalls = input.readLimits?.maximumCalls
  const maximumCalls = Math.min(
    REQUEST_MAX_CALLS,
    Math.max(1, requestedMaximumCalls ?? REQUEST_MAX_CALLS),
  )
  requestBudgets.set(calls, {
    deadlineAt: Date.now() + Math.min(
      REQUEST_BUDGET_MS,
      Math.max(250, requestedBudgetMs ?? REQUEST_BUDGET_MS),
    ),
    callsRemaining: maximumCalls,
    maximumCalls,
    callsStarted: 0,
  })
  const expiries: string[] = []
  const tradingGrant = scopeGrantEvidence()
  const inventoryGrant = scopeGrantEvidence()
  const analyticsGrant = scopeGrantEvidence()
  const fulfillmentGrant = scopeGrantEvidence()
  const credentials = generalCredentials(environment)
  const tradingCredentials = canonicalTradingCredentials(environment)
  let tradingToken = ""
  let verifiedAccount: {
    observedAt: string
    fingerprintMatch: boolean
    site: string | null
    source:
      | "EBAY_TRADING_GET_USER"
      | "EBAY_SELL_FULFILLMENT_GET_ORDERS_SELLER_ID"
  } | null = null
  try {
    const minted = await accessToken({
      operation: "OAUTH_REFRESH_FULFILLMENT",
      credentials: tradingCredentials,
      scopes: [BASE_SCOPE, FULFILLMENT_READONLY_SCOPE],
      fetchImpl,
      calls,
      clock,
    })
    tradingToken = minted.value
    expiries.push(minted.expiresAt)
    const missingRequestedScopes = registerScopeEvidence({
      ledger: tradingGrant,
      token: minted,
      requestedScopes: [BASE_SCOPE, FULFILLMENT_READONLY_SCOPE],
    })
    const account = await verifyAccount({
      token: tradingToken,
      expectedUserId: identity.expectedUserId,
      expectedFingerprint: identity.expectedAccountFingerprint,
      fetchImpl,
      calls,
      clock,
      fulfillmentSellerIdentityFallback: true,
    })
    verifiedAccount = account
    tradingGrant.bindingVerified = true
    if (missingRequestedScopes.includes(BASE_SCOPE)) {
      throw new Error("EBAY_MONITOR_BASE_SCOPE_MISSING")
    }
    const sellerWide = await sellerWideDiscovery({
      token: tradingToken,
      fetchImpl,
      calls,
      clock,
    })
    const marketplace = await certifySellerWideItemMarketplaces({
      token: tradingToken,
      listings: sellerWide.listings,
      totalEntries: sellerWide.totalEntries,
      fetchImpl,
      calls,
      clock,
    })
    const parsedSellerWideItemCount =
      marketplace.marketplaceCertification.sellerWideItemsParsed
    const sellerWideItemSetComplete =
      parsedSellerWideItemCount !== null &&
      sellerWide.totalEntries !== null &&
      parsedSellerWideItemCount === sellerWide.totalEntries &&
      sellerWide.totalEntries < 25_000 &&
      sellerWide.totalPages !== null &&
      sellerWide.pagesRead === sellerWide.totalPages &&
      !sellerWide.reachedPageLimit &&
      !sellerWide.pageFailed &&
      !sellerWide.paginationMetadataConflict &&
      !sellerWide.sourceIdentityConflict
    const sellerWideEnumeration = {
      identities: sellerWide.listings.map((listing) => ({
        itemId: listing.itemId,
        sku: listing.sku,
        variationKey: listing.variationKey,
        identityAmbiguous: listing.identityAmbiguous,
        representationEligible: false as const,
        analyticsEligible: false as const,
      })),
      itemSetComplete: sellerWideItemSetComplete,
      identitySetComplete: sellerWideItemSetComplete &&
        !sellerWide.ambiguousVariationIdentity,
    }
    const discovery = {
      ...sellerWide,
      sellerWideEnumeration,
      currentLiveListings: marketplace.currentLiveListings,
      listings: marketplace.listings,
      marketplaceCertification: marketplace.marketplaceCertification,
      marketplaceScopeConflict: marketplace.incomplete ||
        sellerWide.sourceIdentityConflict,
      marketplaceGapCodes: [
        ...marketplace.gapCodes,
        ...(sellerWide.sourceIdentityConflict
          ? ["SELLER_WIDE_SOURCE_IDENTITY_CONFLICT"]
          : []),
      ],
      marketplaceTerminalItemCount: marketplace.terminalItemCount,
    }
    tradingToken = ""
    const marketplaceProven = account.site === "US"
    const listingIds = [...new Set(discovery.listings
      .map((listing) => listing.itemId))]
    const [inventory, analyticsReadResult, orders] = await Promise.all([
      inventoryRead({
        credentials,
        expectedUserId: identity.expectedUserId,
        expectedFingerprint: identity.expectedAccountFingerprint,
        fetchImpl,
        calls,
        clock,
        expiries,
        scopeGrant: inventoryGrant,
      }),
      analyticsRead({
        credentials,
        expectedUserId: identity.expectedUserId,
        expectedFingerprint: identity.expectedAccountFingerprint,
        listingIds,
        fetchImpl,
        calls,
        clock,
        expiries,
        scopeGrant: analyticsGrant,
      }),
      ordersRead({
        credentials: fulfillmentCredentials(environment),
        expectedUserId: identity.expectedUserId,
        expectedFingerprint: identity.expectedAccountFingerprint,
        fetchImpl,
        calls,
        clock,
        expiries,
        scopeGrant: fulfillmentGrant,
      }),
    ])
    const analytics = marketplace.incomplete &&
        analyticsReadResult.status !== "UNAVAILABLE"
      ? {
          ...analyticsReadResult,
          status: "PARTIAL" as const,
          analyticsCoverageStatus: "PARTIAL" as const,
          gapCodes: [...new Set([
            ...analyticsReadResult.gapCodes,
            "ANALYTICS_LISTING_SCOPE_PARTIAL_DUE_TO_MARKETPLACE_UNPROVEN",
          ])],
        }
      : analyticsReadResult
    const sellerIdentityKeys = new Set(
      discovery.sellerWideEnumeration.identities.map((listing) =>
        itemSkuIdentityKey(listing.itemId, listing.sku)))
    const inventoryIdentityKeys = new Set(inventory.publishedOffers.map(
      (offer) => itemSkuIdentityKey(offer.itemId, offer.sku)))
    const inventoryOnly = discovery.sellerWideEnumeration.identitySetComplete &&
        inventory.status === "AVAILABLE"
      ? inventory.publishedOffers.filter((offer) =>
          !sellerIdentityKeys.has(itemSkuIdentityKey(offer.itemId, offer.sku)))
      : null
    const inventoryRepresentationSubjects = discovery.currentLiveListings.filter(
      (listing) => listing.marketplaceCertification.status === "US_CERTIFIED",
    )
    const marketplaceUnprovenInventoryIdentityKeys = new Set(
      discovery.currentLiveListings.flatMap((listing) =>
        ["US_CERTIFIED", "NON_US_CERTIFIED"].includes(
          listing.marketplaceCertification.status,
        )
          ? []
          : [itemSkuIdentityKey(listing.itemId, listing.sku)]),
    )
    const sellerWideResolvableIdentityKeys = new Set(
      inventoryRepresentationSubjects.flatMap((listing) =>
        listingIdentityComponent(listing.sku, 120)
          ? [itemSkuIdentityKey(listing.itemId, listing.sku)]
          : []),
    )
    const sellerWideUnresolvedIdentityKeys = new Set(
      inventoryRepresentationSubjects.flatMap((listing) =>
        listingIdentityComponent(listing.sku, 120)
          ? []
          : [itemSkuIdentityKey(listing.itemId, null)]),
    )
    const representedInventoryIdentityKeys = new Set(
      [...sellerWideResolvableIdentityKeys].filter((identity) =>
        inventoryIdentityKeys.has(identity)),
    )
    const unmatchedInventoryIdentityKeys = [...sellerWideResolvableIdentityKeys]
      .filter((identity) => !inventoryIdentityKeys.has(identity))
    const inventoryRepresentation: EbayLiveInventoryRepresentation =
      inventory.status === "AVAILABLE"
        ? {
            status: discovery.sellerWideEnumeration.itemSetComplete &&
                discovery.sellerWideEnumeration.identitySetComplete &&
                sellerWideUnresolvedIdentityKeys.size === 0 &&
                marketplaceUnprovenInventoryIdentityKeys.size === 0
              ? "COMPLETE"
              : "PARTIAL",
            classificationGrain: "ITEM_SKU",
            representedCount: representedInventoryIdentityKeys.size,
            notRepresentedCount: unmatchedInventoryIdentityKeys.length,
            identityUnresolvedCount: sellerWideUnresolvedIdentityKeys.size,
            sourceUnprovenCount:
              marketplaceUnprovenInventoryIdentityKeys.size,
          }
        : inventory.status === "PARTIAL"
          ? {
              status: "PARTIAL",
              classificationGrain: "ITEM_SKU",
              representedCount: representedInventoryIdentityKeys.size,
              notRepresentedCount: null,
              identityUnresolvedCount: sellerWideUnresolvedIdentityKeys.size,
              sourceUnprovenCount: unmatchedInventoryIdentityKeys.length +
                marketplaceUnprovenInventoryIdentityKeys.size,
            }
          : {
              status: "UNPROVEN",
              classificationGrain: "ITEM_SKU",
              representedCount: null,
              notRepresentedCount: null,
              identityUnresolvedCount: sellerWideUnresolvedIdentityKeys.size,
              sourceUnprovenCount: sellerWideResolvableIdentityKeys.size +
                marketplaceUnprovenInventoryIdentityKeys.size,
            }
    const certification = discovery.marketplaceCertification
    const certificationCounts = [
      certification.sellerWideItemsMarketplaceCertifiedUs,
      certification.sellerWideItemsMarketplaceCertifiedNonUs,
      certification.sellerWideItemsMarketplaceUnresolved,
      certification.sellerWideItemsMarketplaceError,
      certification.sellerWideItemsMarketplaceItemIdMismatch,
      certification.sellerWideItemsMarketplaceBudgetExhausted,
    ]
    const certificationPartitionItemCount = certificationCounts.every(
        (value) => typeof value === "number")
      ? certificationCounts.reduce((total, value) => total + Number(value), 0)
      : null
    const sellerWideCountMismatch = discovery.totalEntries !== null &&
      certification.sellerWideItemsParsed !== discovery.totalEntries
    const marketplacePartitionMismatch =
      certification.sellerWideItemsParsed !== null &&
      (certificationPartitionItemCount === null ||
        certificationPartitionItemCount !== certification.sellerWideItemsParsed)
    const coverage = normalizeLiveDiscoveryCoverage({
      pagesRead: discovery.pagesRead,
      totalPages: discovery.totalPages,
      totalEntries: discovery.totalEntries,
      reachedPageLimit: discovery.reachedPageLimit,
      pageFailed: discovery.pageFailed,
      paginationMetadataConflict: discovery.paginationMetadataConflict,
      sourceIdentityConflict: discovery.sourceIdentityConflict,
      reportedItemCountMismatch: sellerWideCountMismatch,
    })
    const oauthAvailable = calls.some((entry) =>
      entry.operation.startsWith("OAUTH_REFRESH_") &&
      entry.status === "SUCCEEDED")
    const failedOAuth = calls.some((entry) =>
      entry.operation.startsWith("OAUTH_REFRESH_") && entry.status === "FAILED")
    const inventoryScopeAvailable = inventory.status === "AVAILABLE" ||
      inventory.status === "PARTIAL" ||
      (inventoryGrant.bindingVerified &&
        inventoryGrant.granted.has(INVENTORY_READONLY_SCOPE))
    const analyticsScopeAvailable = analytics.status === "CERTIFIED" ||
      analytics.status === "PARTIAL" ||
      (analyticsGrant.bindingVerified &&
        analyticsGrant.granted.has(ANALYTICS_READONLY_SCOPE))
    const fulfillmentScopeAvailable = orders.status === "CERTIFIED" ||
      orders.status === "PARTIAL" ||
      (fulfillmentGrant.bindingVerified &&
        fulfillmentGrant.granted.has(FULFILLMENT_READONLY_SCOPE))
    const anyMissingScope = [
      tradingGrant,
      inventoryGrant,
      analyticsGrant,
      fulfillmentGrant,
    ].some((grant) => grant.missing.size > 0)
    const allRequiredScopesAvailable = inventoryScopeAvailable &&
      analyticsScopeAvailable && fulfillmentScopeAvailable
    return {
      contractVersion: EBAY_MONITOR_LIVE_READONLY_CONTRACT_VERSION,
      mode: "READ_ONLY",
      environment: "PRODUCTION",
      marketplaceId: MARKETPLACE_ID,
      account: {
        status: marketplaceProven ? "CERTIFIED" : "PARTIAL",
        accountAlias: configuration.accountAlias,
        bindingConfigured: true,
        bindingMatched: account.fingerprintMatch,
        observedAt: account.observedAt,
        source: account.source,
        limitationCode: marketplaceProven
          ? null
          : "EBAY_US_MARKETPLACE_BINDING_UNPROVEN",
      },
      oauth: {
        status: oauthAvailable
          ? failedOAuth || anyMissingScope || !allRequiredScopesAvailable
            ? "PARTIAL"
            : "AVAILABLE"
          : "UNAVAILABLE",
        tokenReceived: oauthAvailable,
        tokenPersisted: false,
        tokenReturned: false,
        expiryKnown: expiries.length > 0,
        earliestAccessTokenExpiryAt: expiries.sort()[0] ?? null,
        scopes: scopeEvidence({
          baseAvailable: true,
          inventoryAvailable: inventoryScopeAvailable,
          analyticsAvailable: analyticsScopeAvailable,
          fulfillmentAvailable: fulfillmentScopeAvailable,
          tradingGrant,
          inventoryGrant,
          analyticsGrant,
          fulfillmentGrant,
          calls,
        }),
      },
      discovery: {
        status: coverage.status === "COMPLETE" ? "AVAILABLE" : "PARTIAL",
        coverage: coverage.status,
        observedAt: discovery.observedAt,
        source: "EBAY_TRADING_GET_MY_EBAY_SELLING",
        sellerWideEnumeration: discovery.sellerWideEnumeration,
        currentLiveListings: discovery.currentLiveListings,
        listings: discovery.listings,
        pagesRead: discovery.pagesRead,
        totalPages: discovery.totalPages,
        totalEntries: discovery.totalEntries,
        marketplaceCertification: discovery.marketplaceCertification,
        gapCodes: [
          ...coverage.gapCodes,
          ...(discovery.ambiguousVariationIdentity
            ? ["SELLER_WIDE_VARIATION_IDENTITY_AMBIGUOUS"]
            : []),
          ...(discovery.limitationCode ? [discovery.limitationCode] : []),
          ...discovery.marketplaceGapCodes,
          ...(discovery.marketplaceScopeConflict
            ? ["SELLER_WIDE_LISTING_MARKETPLACE_UNPROVEN_OR_NON_US"]
            : []),
          ...(!marketplaceProven
            ? ["EBAY_US_MARKETPLACE_BINDING_UNPROVEN"]
            : []),
          ...(inventoryOnly && inventoryOnly.length
            ? ["INVENTORY_PUBLISHED_LISTING_NOT_IN_SELLER_WIDE_RESULT"]
            : []),
          ...(marketplacePartitionMismatch
            ? ["SELLER_WIDE_MARKETPLACE_PARTITION_INVARIANT_FAILED"]
            : []),
        ],
        inventory,
        inventoryRepresentation,
      },
      analytics,
      orders,
      calls: [...calls].sort((left, right) =>
        Date.parse(left.observedAt) - Date.parse(right.observedAt)),
      safety: {
        marketplaceWrites: 0,
        databaseWrites: 0,
        inventoryWrites: 0,
        listingRevisions: 0,
        listingEnds: 0,
        fulfillmentWrites: 0,
        buyerMessages: 0,
        whatsappCalls: 0,
        tokensReturned: false,
        rawPayloadsReturned: false,
        buyerPiiReturned: false,
      },
    }
  } catch (error) {
    tradingToken = ""
    const result = unavailableResult({
      accountAlias: configuration.accountAlias,
      bindingConfigured: identity.bound,
      limitationCode: safeCode(error, "EBAY_MONITOR_LIVE_READ_FAILED"),
    })
    result.calls = calls
    if (verifiedAccount) {
      result.account = {
        status: verifiedAccount.site === "US" ? "CERTIFIED" : "PARTIAL",
        accountAlias: configuration.accountAlias,
        bindingConfigured: true,
        bindingMatched: true,
        observedAt: verifiedAccount.observedAt,
        source: verifiedAccount.source,
        limitationCode: verifiedAccount.site === "US"
          ? null
          : "EBAY_US_MARKETPLACE_BINDING_UNPROVEN",
      }
    } else {
      result.account.status = "BLOCKED"
    }
    result.oauth.status = expiries.length > 0 ? "PARTIAL" : "ERROR"
    result.oauth.tokenReceived = expiries.length > 0
    result.oauth.expiryKnown = expiries.length > 0
    result.oauth.earliestAccessTokenExpiryAt = expiries.sort()[0] ?? null
    result.oauth.scopes = scopeEvidence({
      baseAvailable: Boolean(verifiedAccount),
      inventoryAvailable: false,
      analyticsAvailable: false,
      fulfillmentAvailable: false,
      tradingGrant,
      inventoryGrant,
      analyticsGrant,
      fulfillmentGrant,
      calls,
    })
    return result
  } finally {
    tradingToken = ""
  }
}

export function hashEbayMonitorEvidenceIdentifier(value: string) {
  return createHash("sha256")
    .update(`EBAY_MONITOR_EVIDENCE:${value}`)
    .digest("hex")
}
