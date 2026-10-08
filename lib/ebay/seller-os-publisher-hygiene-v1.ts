export const SELLER_OS_PUBLISHER_HYGIENE_V1 =
  "SELLER_OS_PUBLISHER_HYGIENE_V1" as const

const STALE_PREPARATION_MS = 15 * 60 * 1000

type PublicationRow = Readonly<{
  id?: unknown
  listing_package_id?: unknown
  sku?: unknown
  offer_id?: unknown
  phase?: unknown
  publish_attempt_count?: unknown
  publication_idempotency_key?: unknown
  claim_token?: unknown
  listing_id?: unknown
  last_error_code?: unknown
  updated_at?: unknown
  title?: unknown
}>

function text(value: unknown, maximum = 300) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : ""
}

function timestamp(value: unknown) {
  const raw = text(value, 80)
  const parsed = Date.parse(raw)
  return raw && Number.isFinite(parsed) ? { raw, parsed } : null
}

export function buildSellerOsPublisherHygieneV1(input: Readonly<{
  rows: readonly PublicationRow[]
  now?: Date
}>) {
  const now = input.now ?? new Date()
  const records = input.rows.map((row) => {
    const phase = text(row.phase, 80)
    const error = text(row.last_error_code, 180)
    const updatedAt = timestamp(row.updated_at)
    const ageMs = updatedAt ? Math.max(0, now.getTime() - updatedAt.parsed)
      : null
    const attemptCount = Number.isFinite(Number(row.publish_attempt_count))
      ? Math.max(0, Math.floor(Number(row.publish_attempt_count))) : 0
    const cleanPreview = phase === "preview_ready" && attemptCount === 0
      && !text(row.publication_idempotency_key)
      && !text(row.claim_token) && !text(row.listing_id)
    const staleUnpublished = cleanPreview && ageMs !== null
      && ageMs >= STALE_PREPARATION_MS
    const freshPrepared = cleanPreview && ageMs !== null
      && ageMs < STALE_PREPARATION_MS
    const quarantined = phase === "terminal_failure"
    const manuallySuperseded = quarantined
      && error === "SUPERSEDED_BY_MANUAL_LIVE_ITEM"
    const publishedConfirmed = phase === "monitor_registered"
      && Boolean(text(row.listing_id))
    const inFlight = ["publish_in_flight", "outcome_unknown",
      "published_pending_verification"].includes(phase)
      || (phase === "preview_ready" && !cleanPreview)
    const classification = inFlight ? "RECONCILIATION_REQUIRED"
      : staleUnpublished ? "HISTORICAL_UNPUBLISHED"
        : freshPrepared ? "FRESH_PREPARATION"
          : manuallySuperseded ? "SUPERSEDED_AND_QUARANTINED"
            : quarantined ? "TERMINAL_AND_QUARANTINED"
              : publishedConfirmed ? "PUBLISHED_CONFIRMED"
                : "UNPROVEN"
    const nextAction = inFlight ? "RECONCILE_OFFICIAL_READBACK"
      : staleUnpublished ? "REVIEW_HISTORICAL_UNPUBLISHED_OFFER"
        : freshPrepared ? "WAIT_CURRENT_PUBLICATION"
          : quarantined ? "KEEP_QUARANTINED"
            : publishedConfirmed ? "NONE" : "REVIEW_UNPROVEN_HISTORY"
    return Object.freeze({
      publicationId: text(row.id, 80) || null,
      packageId: text(row.listing_package_id, 80) || null,
      sku: text(row.sku, 100) || null,
      offerId: text(row.offer_id, 80) || null,
      title: text(row.title, 160) || null,
      phase: phase || "UNPROVEN",
      lastErrorCode: error || null,
      updatedAt: updatedAt?.raw ?? null,
      classification,
      nextAction,
      marketplaceDeleteRecommended: false,
    })
  })
  const count = (classification: string) => records.filter((record) =>
    record.classification === classification).length
  const inFlightCount = count("RECONCILIATION_REQUIRED")
  return Object.freeze({
    contractVersion: SELLER_OS_PUBLISHER_HYGIENE_V1,
    status: inFlightCount > 0 ? "RECONCILIATION_REQUIRED" : "CLEAN",
    newPublicationLaneAvailable: inFlightCount === 0,
    inFlightCount,
    freshPreparationCount: count("FRESH_PREPARATION"),
    historicalUnpublishedCount: count("HISTORICAL_UNPUBLISHED"),
    quarantinedFailureCount: count("TERMINAL_AND_QUARANTINED")
      + count("SUPERSEDED_AND_QUARANTINED"),
    supersededManualCount: count("SUPERSEDED_AND_QUARANTINED"),
    publishedConfirmedCount: count("PUBLISHED_CONFIRMED"),
    unprovenCount: count("UNPROVEN"),
    records: records.filter((record) => record.nextAction !== "NONE")
      .slice(0, 25),
    safety: Object.freeze({
      readOnly: true,
      marketplaceWrites: 0,
      marketplaceDeletes: 0,
      historyDeleted: false,
      falseZeroAllowed: false,
    }),
  })
}
