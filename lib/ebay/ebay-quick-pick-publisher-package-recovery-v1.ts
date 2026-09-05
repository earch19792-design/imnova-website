import type { SupabaseClient } from "@supabase/supabase-js"

import { readLunaQuickPickProgressV1,
  type LunaQuickPickCardV1 } from "./ebay-luna-quick-pick-v1"
import { buildQuickPickRuntimeMaterializedPackageDataV1 } from
  "./ebay-quick-pick-market-test-package-v1"
import { ensureAutomaticLunaSupplierImagesV1 } from
  "./luna-supplier-image-auto-runtime-v1"
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

function actorId(value: unknown) {
  return uuid(value)
}

export function projectQuickPickPublisherPackageRecoveryV1(
  card: LunaQuickPickCardV1,
) {
  const actionability = quickPickPublisherActionabilityV1(card)
  const review = record(card.listingReview)
  const authorization = record(review.authorizationBinding)
  const eligible = actionability.technicalReady
    && review.finalListingPackageReady === true
    && Number(authorization.imageCount ?? 0) > 0
    && !card.alreadyLive
    && card.ownerTruePublicationBlockers.length === 0
    && Boolean(uuid(card.listingPackageId))
    && Boolean(uuid(card.opportunityId))
    && Boolean(candidateKey(card.candidateKey))
  return Object.freeze({ eligible,
    requiresMaterialization: eligible && !actionability.packageCurrent,
    candidateKey: eligible ? card.candidateKey : null,
    opportunityId: eligible ? card.opportunityId : null,
    listingPackageId: eligible ? card.listingPackageId : null,
    packageDigest: eligible && typeof review.packageDigest === "string"
      ? review.packageDigest : null,
    reasonCode: eligible && !actionability.packageCurrent
      ? "DOWNSTREAM_COMMERCIAL_PACKAGE_NOT_CURRENT"
      : eligible ? "PREAUTH_PACKAGE_FREEZE_VERIFICATION_REQUIRED"
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

async function readCandidateCardV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  candidateKey: string
}>) {
  const cards = await readLunaQuickPickProgressV1({ supabase: input.supabase,
    accountKey: input.accountKey, candidateKeys: [input.candidateKey],
    includeRecent: false })
  return cards.find((card) => card.candidateKey === input.candidateKey) ?? null
}

export async function recoverQuickPickPublisherPackagesV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  actorUserId?: string
  now?: Date
  dependencies?: Readonly<{
    readCards?: typeof readCardsV1
    readCandidate?: typeof readCandidateCardV1
    ensureImages?: typeof ensureAutomaticLunaSupplierImagesV1
  }>
}>) {
  const now = (input.now ?? new Date()).toISOString()
  let ownerActorId = actorId(input.actorUserId)
  if (!ownerActorId) {
    const profile = await input.supabase.from("ebay_account_policy_profiles")
      .select("selected_by").eq("account_key", input.accountKey)
      .eq("marketplace_id", "EBAY_US").gt("expires_at", now)
      .maybeSingle()
    if (profile.error) throw new Error(
      "PUBLISHER_PACKAGE_OWNER_AUTHORITY_READ_FAILED")
    ownerActorId = actorId(record(profile.data).selected_by)
  }
  if (!ownerActorId) return Object.freeze({
    contractVersion: QUICK_PICK_PUBLISHER_PACKAGE_RECOVERY_V1,
    status: "PARTIAL" as const, scannedCandidateCount: 0,
    eligiblePackageCount: 0, rematerializedPackageCount: 0,
    frozenPackageCount: 0, authorizedImmutablePackageCount: 0,
    failedPackageCount: 1,
    outcomes: Object.freeze([{ status: "BLOCKED",
      errorCode: "PUBLISHER_PACKAGE_OWNER_AUTHORITY_UNAVAILABLE" }]),
    boundedCadence: true as const, optimisticSingleFlight: true as const,
    ownerAuthorizationCreatedCount: 0 as const,
    marketplaceWrites: 0 as const, codexProductDecisions: 0 as const,
  })
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
    const exactCandidateKey = String(entry.projection.candidateKey)
    const read = await input.supabase.from("ebay_listing_packages")
      .select("id,account_key,opportunity_id,candidate_key,status,package_data,readiness,source_observed_at,created_by,updated_at")
      .eq("id", listingPackageId).eq("account_key", input.accountKey)
      .eq("opportunity_id", entry.projection.opportunityId)
      .eq("candidate_key", exactCandidateKey).maybeSingle()
    const current = record(read.data)
    if (read.error || !current.id) {
      outcomes.push(Object.freeze({ listingPackageId,
        candidateKey: entry.projection.candidateKey,
        status: "FAILED",
        errorCode: "PUBLISHER_PACKAGE_RECOVERY_READ_FAILED" }))
      continue
    }
    if (current.created_by !== null && current.created_by !== ownerActorId) {
      outcomes.push(Object.freeze({ listingPackageId,
        candidateKey: entry.projection.candidateKey, status: "BLOCKED",
        errorCode: "PUBLISHER_PACKAGE_OWNER_BINDING_CONFLICT" }))
      continue
    }
    const activeAuthorization = await input.supabase.from(
      "seller_os_publisher_batch_children_v1")
      .select("id,batch_authorization_id")
      .eq("package_id", listingPackageId)
      .in("status", ["AUTHORIZED", "CLAIMED", "RUNNING",
        "FAILED_RETRY_SAFE", "FAILED_BLOCKED",
        "AMBIGUOUS_FAIL_CLOSED", "COMPLETED"]).limit(1).maybeSingle()
    if (activeAuthorization.error) {
      outcomes.push(Object.freeze({ listingPackageId,
        candidateKey: entry.projection.candidateKey, status: "FAILED",
        errorCode: "PUBLISHER_PACKAGE_AUTHORIZATION_GUARD_READ_FAILED" }))
      continue
    }
    let activeBatch = null
    if (activeAuthorization.data) {
      const batchRead = await input.supabase.from(
        "seller_os_publisher_batch_authorizations_v1").select("id")
        .eq("id", activeAuthorization.data.batch_authorization_id)
        .in("status", ["AUTHORIZED", "RUNNING", "PARTIAL", "BLOCKED",
          "COMPLETED"])
        .maybeSingle()
      if (batchRead.error) {
        outcomes.push(Object.freeze({ listingPackageId,
          candidateKey: entry.projection.candidateKey, status: "FAILED",
          errorCode: "PUBLISHER_PACKAGE_AUTHORIZATION_GUARD_READ_FAILED" }))
        continue
      }
      activeBatch = batchRead.data
    }
    if (activeBatch) {
      outcomes.push(Object.freeze({ listingPackageId,
        candidateKey: entry.projection.candidateKey,
        status: "AUTHORIZED_PACKAGE_IMMUTABLE",
        packageMutationAllowed: false }))
      continue
    }
    if (current.created_by === null) {
      const claim = await input.supabase.from("ebay_listing_packages")
        .update({ created_by: ownerActorId, updated_at: now })
        .eq("id", listingPackageId).eq("account_key", input.accountKey)
        .eq("updated_at", current.updated_at).is("created_by", null)
        .select("id,account_key,opportunity_id,candidate_key,status,package_data,readiness,source_observed_at,created_by,updated_at")
        .maybeSingle()
      if (claim.error || !claim.data) {
        outcomes.push(Object.freeze({ listingPackageId,
          candidateKey: entry.projection.candidateKey, status: "FAILED",
          errorCode: "PUBLISHER_PACKAGE_OWNER_BINDING_CAS_LOST" }))
        continue
      }
      Object.assign(current, record(claim.data))
    }
    if (record(record(current.package_data).supplierImageReadiness)
        .imageReady !== true) {
      try {
        const prepared = await (input.dependencies?.ensureImages ??
          ensureAutomaticLunaSupplierImagesV1)({
          supabase: input.supabase as Parameters<
            typeof ensureAutomaticLunaSupplierImagesV1>[0]["supabase"],
          accountKey: input.accountKey, actor: ownerActorId,
          packageRow: current,
        })
        Object.assign(current, record(prepared.listingPackage))
      } catch (error) {
        outcomes.push(Object.freeze({ listingPackageId,
          candidateKey: entry.projection.candidateKey, status: "FAILED",
          errorCode: error instanceof Error &&
              /^[A-Z][A-Z0-9_]{2,159}$/.test(error.message)
            ? error.message : "PUBLISHER_PACKAGE_IMAGE_PREPARATION_FAILED" }))
        continue
      }
    }
    const refreshedCard = await (input.dependencies?.readCandidate ??
      readCandidateCardV1)({ supabase: input.supabase,
      accountKey: input.accountKey,
      candidateKey: exactCandidateKey })
    if (!refreshedCard) {
      outcomes.push(Object.freeze({ listingPackageId,
        candidateKey: entry.projection.candidateKey, status: "FAILED",
        errorCode: "PUBLISHER_PACKAGE_REFRESHED_PROJECTION_MISSING" }))
      continue
    }
    const refreshedProjection = projectQuickPickPublisherPackageRecoveryV1(
      refreshedCard)
    if (!refreshedProjection.eligible) {
      outcomes.push(Object.freeze({ listingPackageId,
        candidateKey: entry.projection.candidateKey, status: "FAILED",
        errorCode: "PUBLISHER_PACKAGE_REFRESHED_PROJECTION_NOT_READY" }))
      continue
    }
    const refreshedActionability = quickPickPublisherActionabilityV1(
      refreshedCard)
    const persistedBinding = record(record(record(current.package_data)
      .quickPickMarketTestPackageV1).authorizationBinding)
    const projectedBinding = record(record(refreshedCard.listingReview)
      .authorizationBinding)
    if (refreshedActionability.packageCurrent &&
        current.created_by === ownerActorId &&
        /^sha256:[0-9a-f]{64}$/.test(String(
          persistedBinding.imagesDigest ?? "")) &&
        persistedBinding.imagesDigest === projectedBinding.imagesDigest) {
      outcomes.push(Object.freeze({ listingPackageId,
        candidateKey: entry.projection.candidateKey,
        packageDigest: refreshedProjection.packageDigest,
        status: "FROZEN_PREAUTH_READY", packageMutationAllowed: false,
        ownerAuthorizationCreated: false, marketplaceWrites: 0 }))
      continue
    }
    const nextData = buildQuickPickRuntimeMaterializedPackageDataV1({
      currentPackageData: record(current.package_data),
      review: record(refreshedCard.listingReview) as Parameters<
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
      && materialization.packageDigest === refreshedProjection.packageDigest
      && materialization.ownerAuthorizationCreated === false
    outcomes.push(Object.freeze({ listingPackageId,
      candidateKey: entry.projection.candidateKey,
      packageDigest: refreshedProjection.packageDigest,
      status: success ? "REMATERIALIZED" : "CAS_LOST_OR_READBACK_FAILED",
      ownerAuthorizationCreated: false,
      marketplaceWrites: 0 }))
  }
  const recovered = outcomes.filter((entry) =>
    entry.status === "REMATERIALIZED").length
  const frozen = outcomes.filter((entry) =>
    entry.status === "FROZEN_PREAUTH_READY").length
  const guarded = outcomes.filter((entry) =>
    entry.status === "AUTHORIZED_PACKAGE_IMMUTABLE").length
  const failures = outcomes.length - recovered - frozen - guarded
  return Object.freeze({
    contractVersion: QUICK_PICK_PUBLISHER_PACKAGE_RECOVERY_V1,
    status: failures === 0 ? "PASS" as const : "PARTIAL" as const,
    scannedCandidateCount: cards.length,
    eligiblePackageCount: eligible.length,
    rematerializedPackageCount: recovered,
    frozenPackageCount: frozen,
    authorizedImmutablePackageCount: guarded,
    failedPackageCount: failures,
    outcomes: Object.freeze(outcomes),
    boundedCadence: true as const,
    optimisticSingleFlight: true as const,
    ownerAuthorizationCreatedCount: 0 as const,
    marketplaceWrites: 0 as const,
    codexProductDecisions: 0 as const,
  })
}
