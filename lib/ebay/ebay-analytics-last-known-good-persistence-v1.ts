import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { EbayCommercialMonitorLiveReadonlyResult } from
  "./ebay-commercial-monitor-live-readonly"
import {
  ANALYTICS_LAST_KNOWN_GOOD_VERSION,
  analyticsLastKnownGoodItemSetDigestV1,
} from "./ebay-analytics-last-known-good-v1"

function validIso(value: unknown) {
  const candidate = typeof value === "string" ? value.trim() : ""
  return candidate && Number.isFinite(Date.parse(candidate))
    ? new Date(candidate).toISOString()
    : null
}

function deterministicUuid(...parts: string[]) {
  const hash = createHash("sha256").update(JSON.stringify(parts)).digest("hex")
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-` +
    `8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

export async function persistAnalyticsLastKnownGoodV1(input: {
  supabase: SupabaseClient
  accountKey: string
  live: EbayCommercialMonitorLiveReadonlyResult
}) {
  const analytics = input.live.analytics
  const currentLiveItemIds = [...new Set(input.live.discovery.currentLiveListings
    .filter((listing) =>
      listing.marketplaceCertification.status !== "NON_US_CERTIFIED")
    .map((listing) => listing.itemId))].sort()
  const observationItemIds = [...new Set(analytics.observations.map((row) =>
    row.itemId))].sort()
  const accountTraffic = analytics.accountTraffic
  const exactCertified = analytics.status === "CERTIFIED" &&
    analytics.analyticsCoverageStatus === "COMPLETE" &&
    accountTraffic.status === "AVAILABLE" &&
    Boolean(accountTraffic.accountTrafficSnapshotId) &&
    Boolean(validIso(accountTraffic.observedAt)) &&
    currentLiveItemIds.length > 0 &&
    JSON.stringify(currentLiveItemIds) === JSON.stringify(observationItemIds)
  if (!exactCertified) return {
    status: "NOT_PERSISTED_UNPROVEN" as const,
    rowsWritten: 0,
    durableReadback: false,
  }
  const capturedAt = validIso(accountTraffic.observedAt) as string
  const snapshotId = accountTraffic.accountTrafficSnapshotId as string
  const digest = analyticsLastKnownGoodItemSetDigestV1(currentLiveItemIds)
  const rows = analytics.observations.map((observation) => ({
    id: deterministicUuid(
      ANALYTICS_LAST_KNOWN_GOOD_VERSION,
      input.accountKey,
      snapshotId,
      observation.itemId,
      observation.windowStart,
      observation.windowEnd,
    ),
    monitor_run_id: null,
    marketplace_account_key: input.accountKey,
    marketplace: "EBAY_US",
    listing_id: observation.itemId,
    sku: null,
    listing_status: "active",
    impressions: observation.applicable.impressions
      ? observation.impressions : null,
    views: observation.applicable.totalListingViews
      ? observation.totalListingViews : null,
    ctr: observation.applicable.reportedCtr
      ? observation.reportedCtr : null,
    transactions: observation.applicable.transactions
      ? observation.transactions : null,
    sales_conversion_rate: observation.applicable.reportedConversion
      ? observation.reportedConversion : null,
    revenue: null,
    current_watchers: null,
    previous_watchers: null,
    delta_watchers: null,
    stock_available: null,
    supplier_cost: null,
    estimated_margin_percent: null,
    observed_at: capturedAt,
    window_start: observation.windowStart,
    window_end: observation.windowEnd,
    source: {
      analytics: observation.source,
      analyticsLkgContractVersion: ANALYTICS_LAST_KNOWN_GOOD_VERSION,
      analyticsSnapshotId: snapshotId,
      snapshotCapturedAt: capturedAt,
      liveReadOnlyProjection: true,
      durableLastKnownGood: true,
      syntheticFallbackUsed: false,
      fixtureEvidenceUsed: false,
      freshnessStatus: observation.freshnessStatus,
      lastUpdatedDate: observation.lastUpdatedDate,
      sourceUpdatedAt: observation.sourceUpdatedAt,
      impressionsApplicable: observation.applicable.impressions,
      externalViews: observation.externalViews,
      externalViewsApplicable: observation.applicable.externalViews,
      totalListingViewsApplicable:
        observation.applicable.totalListingViews,
      transactionsApplicable: observation.applicable.transactions,
      reportedCtrApplicable: observation.applicable.reportedCtr,
      reportedRateUnit: "EBAY_API_RATE_RAW",
      calculatedCtr: observation.calculatedCtr,
      calculatedCtrNumerator: observation.calculatedCtrNumerator,
      calculatedCtrDenominator: observation.calculatedCtrDenominator,
      calculatedCtrApplicable: observation.applicable.calculatedCtr,
      reportedConversionApplicable:
        observation.applicable.reportedConversion,
      currentLiveScope: {
        scope: "CURRENT_LIVE_PORTFOLIO",
        scopeCount: currentLiveItemIds.length,
        itemSetDigest: digest,
      },
      accountTrafficLastKnownGood: {
        ...accountTraffic,
        analyticsStatus: "CURRENT",
        currentSourceStatus: "AVAILABLE",
        snapshotDataStatus: "AVAILABLE_CURRENT",
        snapshotCapturedAt: capturedAt,
        snapshotAgeSeconds: 0,
      },
    },
    completeness_status: observation.completeness === "COMPLETE"
      ? "complete" : "incomplete",
  }))
  const { data, error } = await input.supabase
    .from("listing_commercial_snapshots")
    .upsert(rows, { onConflict: "id" })
    .select("id")
  if (error || (data ?? []).length !== rows.length) {
    return {
      status: "PERSISTENCE_FAILED" as const,
      rowsWritten: 0,
      durableReadback: false,
    }
  }
  return {
    status: "PERSISTED" as const,
    rowsWritten: rows.length,
    durableReadback: true,
  }
}
