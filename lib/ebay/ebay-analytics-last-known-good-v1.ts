import { createHash } from "node:crypto"

import type {
  EbayCommercialMonitorLiveReadonlyResult,
  EbayLiveAnalyticsObservation,
} from "./ebay-commercial-monitor-live-readonly"
import type { AccountTrafficEvidenceV1 } from
  "./ebay-commercial-monitor-traffic-scope-v1"
import type { ReadonlyCommercialSnapshotRow } from
  "./commercial-monitor-readonly-repository"

export const ANALYTICS_LAST_KNOWN_GOOD_VERSION =
  "ANALYTICS_LAST_KNOWN_GOOD_FALLBACK_V1" as const

type JsonRecord = Record<string, unknown>

type DurableAccountTrafficV1 = AccountTrafficEvidenceV1 & {
  analyticsStatus?: "CURRENT" | "LAST_KNOWN_GOOD" | "UNAVAILABLE"
  currentSourceStatus?: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE_429" |
    "UNAVAILABLE_OTHER"
  snapshotDataStatus?: "AVAILABLE_CURRENT" | "AVAILABLE_STALE" |
    "UNAVAILABLE"
  snapshotCapturedAt?: string | null
  snapshotAgeSeconds?: number | null
}

export type AnalyticsLastKnownGoodResolutionV1 = {
  analytics: EbayCommercialMonitorLiveReadonlyResult["analytics"]
  analyticsStatus: "CURRENT" | "LAST_KNOWN_GOOD" | "UNAVAILABLE"
  currentSourceStatus: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE_429" |
    "UNAVAILABLE_OTHER"
  snapshotDataStatus: "AVAILABLE_CURRENT" | "AVAILABLE_STALE" |
    "UNAVAILABLE"
  snapshotCapturedAt: string | null
  snapshotAgeSeconds: number | null
  currentLiveSnapshotAvailable: boolean
  itemBaselineAvailable: (itemId: string) => boolean
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : ""
}

function finite(value: unknown) {
  if (value === null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function validIso(value: unknown) {
  const candidate = text(value, 80)
  return candidate && Number.isFinite(Date.parse(candidate))
    ? new Date(candidate).toISOString()
    : null
}

export function analyticsLastKnownGoodItemSetDigestV1(itemIds: string[]) {
  const digest = createHash("sha256")
  digest.write(JSON.stringify([...new Set(itemIds)].sort()))
  digest.end()
  return `sha256:${digest.digest("hex")}`
}

function currentSourceStatus(
  analytics: EbayCommercialMonitorLiveReadonlyResult["analytics"],
): AnalyticsLastKnownGoodResolutionV1["currentSourceStatus"] {
  if (analytics.status === "CERTIFIED") return "AVAILABLE"
  if (analytics.status === "PARTIAL") return "PARTIAL"
  return analytics.gapCodes.some((code) => code.includes("429"))
    ? "UNAVAILABLE_429"
    : "UNAVAILABLE_OTHER"
}

function durableEnvelope(row: ReadonlyCommercialSnapshotRow) {
  const source = record(row.source)
  const scope = record(source.currentLiveScope)
  const accountTraffic = record(source.accountTrafficLastKnownGood)
  const snapshotId = text(source.analyticsSnapshotId, 240)
  const capturedAt = validIso(source.snapshotCapturedAt) ??
    validIso(row.observed_at)
  const windowStart = validIso(row.window_start)
  const windowEnd = validIso(row.window_end)
  const usable = source.analyticsLkgContractVersion ===
      ANALYTICS_LAST_KNOWN_GOOD_VERSION &&
    source.liveReadOnlyProjection === true &&
    source.analytics === "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT" &&
    source.syntheticFallbackUsed === false &&
    source.fixtureEvidenceUsed === false &&
    row.sku === null &&
    ["complete", "incomplete"].includes(row.completeness_status) &&
    Boolean(snapshotId && capturedAt && windowStart && windowEnd) &&
    scope.scope === "CURRENT_LIVE_PORTFOLIO" &&
    finite(scope.scopeCount) !== null &&
    text(scope.itemSetDigest, 100).startsWith("sha256:") &&
    accountTraffic.scope === "ACCOUNT_TRAFFIC" &&
    accountTraffic.source === "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT"
  return {
    usable,
    source,
    scope,
    accountTraffic,
    snapshotId,
    capturedAt,
    windowStart,
    windowEnd,
  }
}

function observationFromRow(
  row: ReadonlyCommercialSnapshotRow,
): EbayLiveAnalyticsObservation | null {
  const envelope = durableEnvelope(row)
  if (!envelope.usable || !envelope.capturedAt || !envelope.windowStart ||
      !envelope.windowEnd) return null
  const source = envelope.source
  const calculatedCtr = finite(source.calculatedCtr)
  const calculatedCtrNumerator = finite(source.calculatedCtrNumerator)
  const calculatedCtrDenominator = finite(source.calculatedCtrDenominator)
  return {
    itemId: row.listing_id,
    impressions: finite(row.impressions),
    totalListingViews: finite(row.views),
    externalViews: finite(source.externalViews),
    transactions: finite(row.transactions),
    reportedCtr: finite(row.ctr),
    calculatedCtr,
    calculatedCtrNumerator,
    calculatedCtrDenominator,
    reportedConversion: finite(row.sales_conversion_rate),
    applicable: {
      impressions: source.impressionsApplicable === true,
      totalListingViews: source.totalListingViewsApplicable === true,
      externalViews: source.externalViewsApplicable === true,
      transactions: source.transactionsApplicable === true,
      reportedCtr: source.reportedCtrApplicable === true,
      calculatedCtr: source.calculatedCtrApplicable === true,
      reportedConversion: source.reportedConversionApplicable === true,
    },
    windowStart: envelope.windowStart,
    windowEnd: envelope.windowEnd,
    observedAt: envelope.capturedAt,
    sourceUpdatedAt: validIso(source.sourceUpdatedAt),
    lastUpdatedDate: text(source.lastUpdatedDate, 80) || null,
    completeness: row.completeness_status === "complete"
      ? "COMPLETE"
      : "PARTIAL",
    freshnessStatus: "STALE_LAST_KNOWN_GOOD",
    source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
  }
}

function accountTrafficFromEnvelope(input: {
  accountTraffic: JsonRecord
  capturedAt: string
  ageSeconds: number
  currentStatus: AnalyticsLastKnownGoodResolutionV1["currentSourceStatus"]
  currentGapCodes: string[]
}): DurableAccountTrafficV1 | null {
  const candidate = input.accountTraffic
  const status = candidate.status === "AVAILABLE" || candidate.status === "PARTIAL"
    ? candidate.status
    : null
  const windowStart = validIso(candidate.windowStart)
  const windowEnd = validIso(candidate.windowEnd)
  if (!status || !windowStart || !windowEnd ||
      candidate.scope !== "ACCOUNT_TRAFFIC" ||
      candidate.source !== "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT") return null
  return {
    ...(candidate as unknown as AccountTrafficEvidenceV1),
    status,
    windowStart,
    windowEnd,
    observedAt: input.capturedAt,
    analyticsStatus: "LAST_KNOWN_GOOD",
    currentSourceStatus: input.currentStatus,
    snapshotDataStatus: "AVAILABLE_STALE",
    snapshotCapturedAt: input.capturedAt,
    snapshotAgeSeconds: input.ageSeconds,
    snapshotReuseStatus: "REUSED",
    snapshotReuseReasonCode: "DURABLE_LAST_KNOWN_GOOD",
    upstreamSnapshotAcquisitionCount: 0,
    gapCodes: [...new Set([
      ...input.currentGapCodes,
      "ANALYTICS_LAST_KNOWN_GOOD",
    ])],
  }
}

export function resolveAnalyticsLastKnownGoodV1(input: {
  analytics: EbayCommercialMonitorLiveReadonlyResult["analytics"]
  storedRows: ReadonlyCommercialSnapshotRow[]
  currentLiveItemIds: string[]
  now?: Date
}): AnalyticsLastKnownGoodResolutionV1 {
  const now = input.now ?? new Date()
  const sourceStatus = currentSourceStatus(input.analytics)
  const currentItemIds = [...new Set(input.currentLiveItemIds)].sort()
  if (input.analytics.status !== "UNAVAILABLE") {
    const capturedAt = validIso(input.analytics.observedAt)
    return {
      analytics: input.analytics,
      analyticsStatus: "CURRENT",
      currentSourceStatus: sourceStatus,
      snapshotDataStatus: "AVAILABLE_CURRENT",
      snapshotCapturedAt: capturedAt,
      snapshotAgeSeconds: capturedAt
        ? Math.max(0, Math.floor((now.getTime() - Date.parse(capturedAt)) / 1_000))
        : null,
      currentLiveSnapshotAvailable: input.analytics.observations.length > 0,
      itemBaselineAvailable: (itemId) => input.analytics.observations.some(
        (row) => row.itemId === itemId,
      ),
    }
  }

  const usableRows = input.storedRows.filter((row) => durableEnvelope(row).usable)
  const groups = new Map<string, ReadonlyCommercialSnapshotRow[]>()
  for (const row of usableRows) {
    const envelope = durableEnvelope(row)
    const key = JSON.stringify([
      envelope.snapshotId,
      envelope.windowStart,
      envelope.windowEnd,
      text(envelope.scope.itemSetDigest, 100),
    ])
    const rows = groups.get(key) ?? []
    rows.push(row)
    groups.set(key, rows)
  }
  const expectedDigest = analyticsLastKnownGoodItemSetDigestV1(currentItemIds)
  const compatible = [...groups.values()].filter((rows) => {
    const envelope = durableEnvelope(rows[0])
    const itemIds = [...new Set(rows.map((row) => row.listing_id))].sort()
    return text(envelope.scope.itemSetDigest, 100) === expectedDigest &&
      finite(envelope.scope.scopeCount) === currentItemIds.length &&
      JSON.stringify(itemIds) === JSON.stringify(currentItemIds)
  }).sort((left, right) => {
    const leftAt = Date.parse(durableEnvelope(left[0]).capturedAt ?? "")
    const rightAt = Date.parse(durableEnvelope(right[0]).capturedAt ?? "")
    return rightAt - leftAt
  })[0]

  if (!compatible?.length) {
    return {
      analytics: input.analytics,
      analyticsStatus: "UNAVAILABLE",
      currentSourceStatus: sourceStatus,
      snapshotDataStatus: "UNAVAILABLE",
      snapshotCapturedAt: null,
      snapshotAgeSeconds: null,
      currentLiveSnapshotAvailable: false,
      itemBaselineAvailable: () => false,
    }
  }
  const envelope = durableEnvelope(compatible[0])
  const observations = compatible.flatMap((row) => {
    const observation = observationFromRow(row)
    return observation ? [observation] : []
  })
  if (observations.length !== currentItemIds.length || !envelope.capturedAt ||
      !envelope.windowStart || !envelope.windowEnd) {
    return {
      analytics: input.analytics,
      analyticsStatus: "UNAVAILABLE",
      currentSourceStatus: sourceStatus,
      snapshotDataStatus: "UNAVAILABLE",
      snapshotCapturedAt: null,
      snapshotAgeSeconds: null,
      currentLiveSnapshotAvailable: false,
      itemBaselineAvailable: () => false,
    }
  }
  const ageSeconds = Math.max(0, Math.floor(
    (now.getTime() - Date.parse(envelope.capturedAt)) / 1_000,
  ))
  const accountTraffic = accountTrafficFromEnvelope({
    accountTraffic: envelope.accountTraffic,
    capturedAt: envelope.capturedAt,
    ageSeconds,
    currentStatus: sourceStatus,
    currentGapCodes: input.analytics.gapCodes,
  })
  if (!accountTraffic) {
    return {
      analytics: input.analytics,
      analyticsStatus: "UNAVAILABLE",
      currentSourceStatus: sourceStatus,
      snapshotDataStatus: "UNAVAILABLE",
      snapshotCapturedAt: null,
      snapshotAgeSeconds: null,
      currentLiveSnapshotAvailable: false,
      itemBaselineAvailable: () => false,
    }
  }
  return {
    analytics: {
      ...input.analytics,
      status: observations.every((row) => row.completeness === "COMPLETE")
        ? "CERTIFIED"
        : "PARTIAL",
      observedAt: envelope.capturedAt,
      windowStart: envelope.windowStart,
      windowEnd: envelope.windowEnd,
      analyticsRequestedItemCount: currentItemIds.length,
      analyticsRepresentedItemCount: observations.length,
      analyticsMissingItemCount: 0,
      analyticsCoverageStatus: observations.length === currentItemIds.length
        ? "COMPLETE"
        : "PARTIAL",
      accountTraffic,
      observations,
      gapCodes: [...new Set([
        ...input.analytics.gapCodes,
        "ANALYTICS_LAST_KNOWN_GOOD",
      ])],
    },
    analyticsStatus: "LAST_KNOWN_GOOD",
    currentSourceStatus: sourceStatus,
    snapshotDataStatus: "AVAILABLE_STALE",
    snapshotCapturedAt: envelope.capturedAt,
    snapshotAgeSeconds: ageSeconds,
    currentLiveSnapshotAvailable: true,
    itemBaselineAvailable: (itemId) => observations.some(
      (row) => row.itemId === itemId,
    ),
  }
}
