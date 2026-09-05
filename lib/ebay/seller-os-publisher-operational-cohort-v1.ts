import type { SupabaseClient } from "@supabase/supabase-js"

import { preflightEbayDraftOnlyMobile } from "./ebay-draft-only-gateway"
import { readLunaQuickPickProgressV1 } from "./ebay-luna-quick-pick-v1"
import { projectQuickPickOwnerCardV1,
  quickPickPublisherActionabilityV1,
  readRecentDurableQuickPickCandidateKeysV1 } from
  "./seller-os-quick-pick-owner-read-model-v1"

export const SELLER_OS_PUBLISHER_OPERATIONAL_COHORT_V1 =
  "SELLER_OS_PUBLISHER_OPERATIONAL_COHORT_V1" as const

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maximum) : null
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function latestByPackage(values: readonly JsonRecord[]) {
  const result = new Map<string, JsonRecord>()
  for (const value of [...values].sort((left, right) =>
    Date.parse(String(right.updated_at ?? right.created_at ?? ""))
      - Date.parse(String(left.updated_at ?? left.created_at ?? "")))) {
    const packageId = text(value.listing_package_id, 80)
    if (packageId && !result.has(packageId)) result.set(packageId, value)
  }
  return result
}

function mismatchFields(value: unknown) {
  const sanitized = record(value)
  const publisher = record(sanitized.publisherState)
  return Array.isArray(publisher.mismatchFields)
    ? publisher.mismatchFields.flatMap((entry) => text(entry, 240)
      ? [String(entry)] : []).slice(0, 40) : []
}

function authorizationBinding(input: Readonly<{
  accountKey: string
  candidateId: string
  packageId: string
  review: JsonRecord
  policy: JsonRecord
}>) {
  const authorization = record(input.review.authorizationBinding)
  const dollars = record(input.review.dollarCheck)
  const category = record(input.review.category)
  const condition = record(input.review.condition)
  return Object.freeze({
    contractVersion: "SELLER_OS_PUBLISHER_BATCH_CHILD_BINDING_V1",
    candidateId: input.candidateId,
    packageId: input.packageId,
    packageDigest: text(input.review.packageDigest, 100),
    accountId: input.accountKey,
    marketplaceId: "EBAY_US",
    price: number(dollars.targetPrice),
    quantity: number(authorization.quantity),
    category: text(category.id, 30),
    condition: text(condition.id, 30),
    businessPolicies: Object.freeze({
      fulfillmentPolicyId: text(input.policy.fulfillment_policy_id, 100),
      paymentPolicyId: text(input.policy.payment_policy_id, 100),
      returnPolicyId: text(input.policy.return_policy_id, 100),
    }),
    location: text(input.policy.merchant_location_key, 100),
    images: number(authorization.imageCount),
    itemSpecificsDigestBoundInPackageDigest: true,
    materialPackageChangeInvalidatesOnlyThisChild: true,
  })
}

export async function readSellerOsPublisherOperationalCohortV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  actorUserId: string
  now?: Date
  preflightReader?: typeof preflightEbayDraftOnlyMobile
}>) {
  const now = input.now ?? new Date()
  const candidateKeys = await readRecentDurableQuickPickCandidateKeysV1({
    supabase: input.supabase, limit: 20,
  })
  const cards = await readLunaQuickPickProgressV1({ supabase: input.supabase,
    accountKey: input.accountKey, candidateKeys, includeRecent: false })
  const projectedCards = cards.map((card) => projectQuickPickOwnerCardV1(card))
  const packageIds = cards.flatMap((card) => text(card.listingPackageId, 80)
    ? [String(card.listingPackageId)] : [])
  const candidateIds = cards.flatMap((card) => text(card.candidateKey, 100)
    ? [String(card.candidateKey)] : [])
  const [packageRead, approvalRead, executionRead, publicationRead,
    profileRead, batchChildRead] = await Promise.all([
    packageIds.length ? input.supabase.from("ebay_listing_packages")
      .select("id,opportunity_id,candidate_key,status,readiness,created_by,package_data,updated_at")
      .eq("account_key", input.accountKey).in("id", packageIds) :
      Promise.resolve({ data: [], error: null }),
    packageIds.length ? input.supabase.from("ebay_draft_only_approvals")
      .select("id,listing_package_id,status,payload_hash,approved_at,expires_at,updated_at")
      .in("listing_package_id", packageIds).order("updated_at",
        { ascending: false }).limit(100) :
      Promise.resolve({ data: [], error: null }),
    packageIds.length ? input.supabase.from("ebay_draft_only_execution_ledger")
      .select("id,approval_id,listing_package_id,phase,attempt_count,offer_id,last_error_code,sanitized_result,updated_at")
      .in("listing_package_id", packageIds).order("updated_at",
        { ascending: false }).limit(100) :
      Promise.resolve({ data: [], error: null }),
    packageIds.length ? input.supabase.from("ebay_authorized_listing_publications")
      .select("id,listing_package_id,draft_execution_id,phase,publish_attempt_count,offer_id,listing_id,active_listing_id,last_error_code,publish_http_status,sanitized_result,updated_at")
      .in("listing_package_id", packageIds).order("updated_at",
        { ascending: false }).limit(100) :
      Promise.resolve({ data: [], error: null }),
    input.supabase.from("ebay_account_policy_profiles")
      .select("account_key,marketplace_id,fulfillment_policy_id,payment_policy_id,return_policy_id,merchant_location_key,verified_at,expires_at")
      .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
      .gt("expires_at", now.toISOString()).order("verified_at",
        { ascending: false }).limit(1).maybeSingle(),
    candidateIds.length ? input.supabase.from(
      "seller_os_publisher_batch_children_v1")
      .select("id,batch_authorization_id,candidate_id,package_id,package_digest,status,stage,result,error_class,ebay_error_codes,mismatch_fields,retry_safety,duplicate_risk,official_readback_state,approval_id,execution_id,offer_id,item_id,marketplace_write_count,attempt_count,receipt_digest,updated_at")
      .eq("marketplace_account_key", input.accountKey)
      .in("candidate_id", candidateIds).order("updated_at",
        { ascending: false }).limit(100) :
      Promise.resolve({ data: [], error: null }),
  ])
  const failedAuthority = [
    ["PACKAGE", packageRead.error], ["APPROVAL", approvalRead.error],
    ["EXECUTION", executionRead.error],
    ["PUBLICATION", publicationRead.error], ["PROFILE", profileRead.error],
    ["BATCH_CHILD", batchChildRead.error],
  ].find(([, error]) => Boolean(error))
  if (failedAuthority) throw new Error(
    `SELLER_OS_PUBLISHER_COHORT_${failedAuthority[0]}_READ_FAILED`)
  const profile = record(profileRead.data)
  const requested = {
    fulfillmentPolicyId: text(profile.fulfillment_policy_id, 100) ?? "",
    paymentPolicyId: text(profile.payment_policy_id, 100) ?? "",
    returnPolicyId: text(profile.return_policy_id, 100) ?? "",
    merchantLocationKey: text(profile.merchant_location_key, 100) ?? "",
  }
  let preflight: JsonRecord = {}
  let preflightFailure: string | null = null
  try {
    preflight = record(await (input.preflightReader ??
      preflightEbayDraftOnlyMobile)(requested))
  } catch (error) {
    preflightFailure = error instanceof Error ? error.message
      : "EBAY_PUBLISHER_PREFLIGHT_UNAVAILABLE"
  }
  const selection = record(preflight.selection)
  const preflightEligible = preflight.target === "PRODUCTION"
    && record(preflight.identity).status === "BOUND"
    && record(preflight.privilege).usable === true
    && preflight.selectionComplete === true
    && preflight.snapshotStatus === "READY"
    && Object.entries(requested).every(([key, value]) => value
      && selection[key] === value)
  const packages = new Map(rows(packageRead.data).map((row) =>
    [String(row.id), row]))
  const approvals = latestByPackage(rows(approvalRead.data))
  const executions = latestByPackage(rows(executionRead.data))
  const publications = latestByPackage(rows(publicationRead.data))
  const batchChildren = new Map<string, JsonRecord>()
  for (const child of rows(batchChildRead.data)) {
    const candidateId = text(child.candidate_id, 100)
    if (candidateId && !batchChildren.has(candidateId)) {
      batchChildren.set(candidateId, child)
    }
  }
  const cohort = projectedCards.map((card) => {
    const packageId = text(card.listingPackageId, 80) ?? ""
    const candidateId = text(card.candidateKey, 100) ?? ""
    const packageRow = packages.get(packageId) ?? {}
    const approval = approvals.get(packageId) ?? {}
    const execution = executions.get(packageId) ?? {}
    const publication = publications.get(packageId) ?? {}
    const batchChild = batchChildren.get(candidateId) ?? {}
    const actionability = card.publisherActionability
    const review = record(card.listingReview)
    const packageClaimable = packageRow.created_by === null
      || packageRow.created_by === input.actorUserId
    const childStatus = text(batchChild.status, 100)
    const currentBatchOwnsCandidate = batchChild.package_id === packageId
      && batchChild.package_digest === text(review.packageDigest, 100)
      && Boolean(childStatus)
    const runtimeInProgress = currentBatchOwnsCandidate && [
      "AUTHORIZED", "CLAIMED", "RUNNING", "FAILED_RETRY_SAFE",
    ].includes(childStatus ?? "")
    const runtimePublished = currentBatchOwnsCandidate
      && childStatus === "COMPLETED"
      && batchChild.official_readback_state === "PUBLISHED_CONFIRMED"
    const runtimeBlocked = currentBatchOwnsCandidate && [
      "FAILED_BLOCKED", "AMBIGUOUS_FAIL_CLOSED",
    ].includes(childStatus ?? "")
    const authoritativeReady = actionability.authoritativeReady
      && !currentBatchOwnsCandidate
    const publisherRuntimeEligible = actionability.batchEligible
      && preflightEligible && packageClaimable && !runtimePublished
      && !runtimeBlocked
    const batchEligible = authoritativeReady && preflightEligible
      && packageClaimable
    const publicationPhase = text(publication.phase, 100)
    const executionPhase = text(execution.phase, 100)
    const errorClass = text(batchChild.error_class, 160)
      ?? text(publication.last_error_code, 160)
      ?? text(execution.last_error_code, 160)
      ?? (!batchEligible ? actionability.failureClass : null)
    const sanitized = record(execution.sanitized_result)
    const officialState = text(batchChild.official_readback_state, 100)
      ?? text(record(sanitized.publisherState)
      .officialCurrentState, 100)
      ?? (publicationPhase === "monitor_registered"
        ? "PUBLISHED_CONFIRMED" : executionPhase === "completed"
          ? "UNPUBLISHED_CONFIRMED" : "NOT_STARTED")
    return Object.freeze({ candidateId, packageId,
      currentPackageDigest: text(review.packageDigest, 100),
      readinessState: runtimePublished ? "PUBLISHED"
        : runtimeInProgress ? "PUBLISHER_RUNNING"
          : runtimeBlocked ? "PUBLISHER_BLOCKED"
            : authoritativeReady ? "AUTHORITATIVE_READY" : actionability.technicalReady
          ? "PREPARING_OWNER_REVIEW_PACKAGE" : card.state,
      provenance: card.provenance,
      ownerAuthorizationState: currentBatchOwnsCandidate
        ? "BATCH_AUTHORIZED" : text(approval.status, 80) ?? "NOT_AUTHORIZED",
      executionId: text(batchChild.execution_id, 80)
        ?? text(execution.id, 80),
      offerId: text(batchChild.offer_id, 80)
        ?? text(execution.offer_id ?? publication.offer_id, 80),
      offerCurrentStatus: officialState === "PUBLISHED_CONFIRMED"
        ? "PUBLISHED" : officialState === "UNPUBLISHED_CONFIRMED"
          ? "UNPUBLISHED" : "UNKNOWN",
      publishAttemptCount: number(publication.publish_attempt_count) ?? 0,
      publishedItemId: text(batchChild.item_id, 80)
        ?? text(publication.active_listing_id
        ?? publication.listing_id, 80),
      lastPublisherStage: text(batchChild.stage, 120)
        ?? publicationPhase ?? executionPhase ?? "NOT_STARTED",
      lastErrorClass: errorClass,
      ebayErrorId: Array.isArray(record(publication.sanitized_result).errors)
        ? text(record((record(publication.sanitized_result).errors as
          unknown[])[0]).errorId, 40) : null,
      mismatchFields: Array.isArray(batchChild.mismatch_fields)
        ? batchChild.mismatch_fields : mismatchFields(execution.sanitized_result),
      safeResumeAvailable: ["completed", "offer_outcome_unknown"]
        .includes(executionPhase ?? "") && !publication.active_listing_id,
      duplicateRisk: text(batchChild.duplicate_risk, 80)
        ?? text(record(sanitized.publisherState).duplicateRisk, 80)
        ?? (execution.offer_id ? "SELF_LINEAGE_REUSE_REQUIRED" : "NONE_PROVEN"),
      authoritativeReady,
      visibleReady: authoritativeReady,
      actionableReady: authoritativeReady,
      publisherPreflightEligible: preflightEligible,
      publisherRuntimeEligible,
      batchEligible,
      failureClass: runtimePublished ? null
        : runtimeInProgress ? "PUBLISHER_BATCH_RUNTIME_IN_PROGRESS"
          : runtimeBlocked ? errorClass ?? "PUBLISHER_BATCH_BLOCKED"
            : batchEligible ? null
        : !preflightEligible ? preflightFailure
          ?? "PUBLISHER_PREFLIGHT_NOT_ELIGIBLE"
          : !packageClaimable ? "PACKAGE_OWNED_BY_OTHER_ACTOR"
            : actionability.failureClass,
      authorizationBinding: publisherRuntimeEligible ? authorizationBinding({
        accountKey: input.accountKey, candidateId, packageId,
        review, policy: profile,
      }) : null,
      batchRuntime: Object.freeze({
        childId: text(batchChild.id, 80),
        batchAuthorizationId: text(batchChild.batch_authorization_id, 80),
        status: childStatus, stage: text(batchChild.stage, 120),
        result: text(batchChild.result, 120),
        retrySafety: text(batchChild.retry_safety, 120),
        officialReadbackState: text(batchChild.official_readback_state, 120),
        marketplaceWriteCount: number(batchChild.marketplace_write_count) ?? 0,
        attemptCount: number(batchChild.attempt_count) ?? 0,
        receiptDigest: text(batchChild.receipt_digest, 100),
        inProgress: runtimeInProgress, published: runtimePublished,
        blocked: runtimeBlocked,
      }),
    })
  })
  const batchEligibleMembers = cohort.filter((entry) => entry.batchEligible)
  const failureClassCounts = Object.fromEntries([...new Set(cohort.flatMap(
    (entry) => entry.failureClass ? [entry.failureClass] : []))].map((code) =>
    [code, cohort.filter((entry) => entry.failureClass === code).length]))
  return Object.freeze({
    contractVersion: SELLER_OS_PUBLISHER_OPERATIONAL_COHORT_V1,
    observedAt: now.toISOString(),
    candidates: Object.freeze(cohort),
    summary: Object.freeze({
      totalCohortCount: cohort.length,
      technicalReadyCount: cohort.filter((entry) =>
        !["WAITING", "BLOCKED", "RUNNING"].includes(entry.readinessState))
        .length,
      authoritativeReadyCount: cohort.filter((entry) =>
        entry.authoritativeReady).length,
      visibleReadyCount: cohort.filter((entry) => entry.visibleReady).length,
      actionableReadyCount: cohort.filter((entry) =>
        entry.actionableReady).length,
      batchEligibleCount: batchEligibleMembers.length,
      batchButtonN: batchEligibleMembers.length,
      falseDisabledReadyCount: cohort.filter((entry) =>
        entry.authoritativeReady && !entry.batchEligible).length,
      trueBlockerCount: cohort.filter((entry) => !entry.batchEligible).length,
      safeResumeCount: cohort.filter((entry) =>
        entry.safeResumeAvailable).length,
      existingOfferCount: cohort.filter((entry) => entry.offerId).length,
      newOfferRequiredCount: batchEligibleMembers.filter((entry) =>
        !entry.offerId).length,
      duplicateRiskCount: cohort.filter((entry) =>
        !["NONE_PROVEN", "SELF_LINEAGE_REUSE_REQUIRED"].includes(
          entry.duplicateRisk)).length,
      failureClassCounts: Object.freeze(failureClassCounts),
      preflightEligible,
      preflightFailure,
    }),
    safety: Object.freeze({ readOnly: true as const,
      marketplaceWrites: 0 as const, databaseMutations: 0 as const,
      codexProductDecisions: 0 as const }),
  })
}
