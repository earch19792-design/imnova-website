import type { SupabaseClient } from "@supabase/supabase-js"

import { readLunaQuickPickProgressV1,
  type LunaQuickPickCardV1 } from "./ebay-luna-quick-pick-v1"
import { buildQuickPickRuntimeMaterializedPackageDataV1 } from
  "./ebay-quick-pick-market-test-package-v1"
import { quickPickPublisherActionabilityV1,
  readRecentDurableQuickPickCandidateKeysV1 } from
  "./seller-os-quick-pick-owner-read-model-v1"

export const QUICK_PICK_PUBLISHER_PACKAGE_RECOVERY_V1 =
  "QUICK_PICK_PUBLISHER_PACKAGE_RECOVERY_V1" as const

const MAXIMUM_RECOVERY_ROWS = 20
type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function uuid(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value) ? value : null
}

function candidateKey(value: unknown) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value)
    ? value : null
}

export function projectQuickPickPublisherPackageRecoveryV1(
  card: LunaQuickPickCardV1,
) {
  const actionability = quickPickPublisherActionabilityV1(card)
  const review = record(card.listingReview)
  const authorization = record(review.authorizationBinding)
  const eligible = actionability.technicalReady
    && !actionability.packageCurrent
    && review.finalListingPackageReady === true
    && Number(authorization.imageCount ?? 0) > 0
    && !card.alreadyLive
    && card.ownerTruePublicationBlockers.length === 0
    && Boolean(uuid(card.listingPackageId))
    && Boolean(uuid(card.opportunityId))
    && Boolean(candidateKey(card.candidateKey))
  return Object.freeze({ eligible,
    candidateKey: eligible ? card.candidateKey : null,
    opportunityId: eligible ? card.opportunityId : null,
    listingPackageId: eligible ? card.listingPackageId : null,
    packageDigest: eligible && typeof review.packageDigest === "string"
      ? review.packageDigest : null,
    reasonCode: eligible ? "DOWNSTREAM_COMMERCIAL_PACKAGE_NOT_CURRENT"
      : actionability.packageCurrent ? "PACKAGE_ALREADY_CURRENT"
        : review.finalListingPackageReady !== true
          ? "PROJECTED_COMMERCIAL_PACKAGE_NOT_READY"
          : Number(authorization.imageCount ?? 0) < 1
            ? "AUTHORIZED_IMAGES_NOT_READY"
            : "PACKAGE_RECOVERY_NOT_ELIGIBLE",
  })
}

async function readCardsV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
}>) {
  const keys = await readRecentDurableQuickPickCandidateKeysV1({
    supabase: input.supabase, limit: MAXIMUM_RECOVERY_ROWS,
  })
  return readLunaQuickPickProgressV1({ supabase: input.supabase,
    accountKey: input.accountKey, candidateKeys: keys, includeRecent: false })
}

export async function recoverQuickPickPublisherPackagesV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  now?: Date
  dependencies?: Readonly<{
    readCards?: typeof readCardsV1
  }>
}>) {
  const now = (input.now ?? new Date()).toISOString()
  const cards = await (input.dependencies?.readCards ?? readCardsV1)({
    supabase: input.supabase, accountKey: input.accountKey,
  })
  const eligible = cards.map((card) => ({ card,
    projection: projectQuickPickPublisherPackageRecoveryV1(card) }))
    .filter((entry) => entry.projection.eligible)
    .slice(0, MAXIMUM_RECOVERY_ROWS)
  const outcomes: JsonRecord[] = []
  for (const entry of eligible) {
    const listingPackageId = String(entry.projection.listingPackageId)
    const read = await input.supabase.from("ebay_listing_packages")
      .select("id,account_key,opportunity_id,candidate_key,status,package_data,readiness,source_observed_at,created_by,updated_at")
      .eq("id", listingPackageId).eq("account_key", input.accountKey)
      .eq("opportunity_id", entry.projection.opportunityId)
      .eq("candidate_key", entry.projection.candidateKey).maybeSingle()
    const current = record(read.data)
    if (read.error || !current.id) {
      outcomes.push(Object.freeze({ listingPackageId,
        candidateKey: entry.projection.candidateKey,
        status: "FAILED",
        errorCode: "PUBLISHER_PACKAGE_RECOVERY_READ_FAILED" }))
      continue
    }
    const nextData = buildQuickPickRuntimeMaterializedPackageDataV1({
      currentPackageData: record(current.package_data),
      review: record(entry.card.listingReview) as Parameters<
        typeof buildQuickPickRuntimeMaterializedPackageDataV1>[0]["review"],
      now,
    })
    let write = input.supabase.from("ebay_listing_packages").update({
      package_data: nextData, status: "ready_for_review", readiness: 100,
      updated_at: now,
    }).eq("id", listingPackageId).eq("account_key", input.accountKey)
      .eq("opportunity_id", entry.projection.opportunityId)
      .eq("candidate_key", entry.projection.candidateKey)
      .eq("updated_at", current.updated_at)
    write = current.created_by === null ? write.is("created_by", null)
      : write.eq("created_by", current.created_by)
    const stored = await write.select("id,package_data,updated_at").maybeSingle()
    const storedData = record(record(stored.data).package_data)
    const materialization = record(
      storedData.quickPickRuntimePackageMaterializationV1)
    const success = !stored.error && Boolean(stored.data)
      && materialization.packageDigest === entry.projection.packageDigest
      && materialization.ownerAuthorizationCreated === false
    outcomes.push(Object.freeze({ listingPackageId,
      candidateKey: entry.projection.candidateKey,
      packageDigest: entry.projection.packageDigest,
      status: success ? "REMATERIALIZED" : "CAS_LOST_OR_READBACK_FAILED",
      ownerAuthorizationCreated: false,
      marketplaceWrites: 0 }))
  }
  const recovered = outcomes.filter((entry) =>
    entry.status === "REMATERIALIZED").length
  const failures = outcomes.length - recovered
  return Object.freeze({
    contractVersion: QUICK_PICK_PUBLISHER_PACKAGE_RECOVERY_V1,
    status: failures === 0 ? "PASS" as const : "PARTIAL" as const,
    scannedCandidateCount: cards.length,
    eligiblePackageCount: eligible.length,
    rematerializedPackageCount: recovered,
    failedPackageCount: failures,
    outcomes: Object.freeze(outcomes),
    boundedCadence: true as const,
    optimisticSingleFlight: true as const,
    ownerAuthorizationCreatedCount: 0 as const,
    marketplaceWrites: 0 as const,
    codexProductDecisions: 0 as const,
  })
}
