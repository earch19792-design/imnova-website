import { hashEbayDraftOnlyPayload, type JsonRecord } from
  "./ebay-draft-only-readiness"

export const EBAY_ONE_CLICK_CONTROLLED_PUBLICATION_VERSION =
  "SELLER_OS_ONE_CLICK_CONTROLLED_PUBLICATION_V1"
export const EBAY_ONE_CLICK_PUBLICATION_LABEL = "PUBLICAR EN EBAY"
export const EBAY_ONE_CLICK_PUBLICATION_SURFACE =
  "SELLER_OS_SMART_STOCKING_ONE_CLICK_PUBLICATION_V1"
export const EBAY_AUTHENTICATED_PUBLICATION_RECOVERY_VERSION =
  "AUTHENTICATED_ONE_CLICK_RECOVERY_V1"

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function sha256(value: unknown) {
  return `sha256:${hashEbayDraftOnlyPayload(value)}`
}

function basePayload(value: JsonRecord) {
  const base = { ...value }
  delete base.controlledPublicationIntent
  return base
}

function imageUrls(payload: JsonRecord) {
  const product = record(record(payload.inventoryItemPayload).product)
  return Array.isArray(product.imageUrls)
    ? product.imageUrls.filter((url): url is string =>
        typeof url === "string" && Boolean(url.trim()))
    : []
}

function exactIntent(input: {
  approvedPayload: JsonRecord
  actorUserId: string
  listingPackage?: JsonRecord | null
}) {
  const payload = basePayload(input.approvedPayload)
  const listingPackage = record(payload.listingPackage)
  const packageData = record(listingPackage.packageData)
  const sourceEvidence = record(payload.sourceEvidence)
  const safety = record(payload.safety)
  const inventory = record(payload.inventoryItemPayload)
  const availability = record(record(inventory.availability)
    .shipToLocationAvailability)
  const offer = record(payload.offerPayload)
  const price = record(record(offer.pricingSummary).price)
  const policies = record(offer.listingPolicies)
  const images = imageUrls(payload)
  const currentListingPackage = record(input.listingPackage)
  const durablePackageData = Object.keys(currentListingPackage).length
    ? record(currentListingPackage.package_data)
    : packageData
  const intent: JsonRecord = {
    version: EBAY_ONE_CLICK_CONTROLLED_PUBLICATION_VERSION,
    authorityClass: "EXPLICIT_SINGLE_HUMAN_COMMERCIAL_INTENT",
    authorizationSurface: EBAY_ONE_CLICK_PUBLICATION_SURFACE,
    humanIntentLabel: EBAY_ONE_CLICK_PUBLICATION_LABEL,
    humanAuthorizationCount: 1,
    secondHumanAuthorizationRequired: false,
    oneTime: true,
    unattendedPublicationAllowed: false,
    actorUserId: input.actorUserId,
    listingPackageId: text(listingPackage.id),
    packageDigest: sha256(durablePackageData),
    approvedDraftPayloadDigest: sha256(payload),
    opportunityId: text(sourceEvidence.opportunityId),
    candidateKey: text(listingPackage.candidateKey),
    marketplaceTarget: text(safety.target),
    accountFingerprint: text(safety.accountFingerprint),
    marketplaceId: text(offer.marketplaceId),
    sku: text(payload.sku),
    categoryId: text(offer.categoryId),
    price: {
      value: text(price.value),
      currency: text(price.currency),
    },
    quantity: Number(offer.availableQuantity),
    inventoryQuantity: Number(availability.quantity),
    merchantLocationKey: text(offer.merchantLocationKey),
    policies,
    policiesDigest: sha256({
      marketplaceId: text(offer.marketplaceId),
      merchantLocationKey: text(offer.merchantLocationKey),
      policies,
    }),
    imageCount: images.length,
    imageSetDigest: sha256(images),
    machineContinuation: {
      inventoryItemWrite: true,
      unpublishedOfferWrite: true,
      unpublishedOfficialReadbackRequired: true,
      exactPayloadComparisonRequired: true,
      oneShotPublishAllowedAfterExactMatch: true,
      activeOfficialReadbackRequired: true,
      itemIdPersistenceRequired: true,
      stockguardActivationRequired: true,
    },
    mismatchPolicy: "STOP_NO_PUBLISH_AUTHORIZATION_CONSUMED_FAIL_CLOSED",
  }
  return intent
}

export function bindOneClickControlledPublicationIntentV1(input: {
  approvedPayload: JsonRecord
  actorUserId: string
  listingPackage?: JsonRecord | null
}) {
  const payload = basePayload(input.approvedPayload)
  const intent = exactIntent({
    approvedPayload: payload,
    actorUserId: input.actorUserId,
    listingPackage: input.listingPackage,
  })
  return {
    ...payload,
    controlledPublicationIntent: {
      ...intent,
      intentDigest: sha256(intent),
    },
  }
}

export type OneClickPublicationIntentValidationV1 = {
  valid: boolean
  blocker: string | null
  intent: JsonRecord
}

export type AuthenticatedPublicationRecoveryStateV1 =
  | "NOT_APPLICABLE"
  | "RECOVERY_BLOCKED"
  | "RESUMABLE_AUTHORIZED_PUBLICATION"
  | "REARMED_AWAITING_HUMAN_PUBLICATION"
  | "PUBLISH_ALREADY_CLAIMED"
  | "ACTIVE_VERIFIED"

export type AuthenticatedPublicationRecoveryV1 = Readonly<{
  version: typeof EBAY_AUTHENTICATED_PUBLICATION_RECOVERY_VERSION
  state: AuthenticatedPublicationRecoveryStateV1
  autoResume: boolean
  blocker: string | null
  approvalId: string | null
  executionId: string | null
  publicationId: string | null
  listingPackageId: string | null
  opportunityId: string | null
  candidateKey: string | null
  offerId: string | null
  authorizedPayloadHash: string | null
  requestHash: string | null
  canonicalStockAuthorized: boolean
  reusesExistingHumanApproval: boolean
  newHumanApprovalAllowed: false
}>

function recoveryResult(input: {
  state: AuthenticatedPublicationRecoveryStateV1
  blocker?: string | null
  approval: JsonRecord
  execution: JsonRecord
  publication: JsonRecord
  canonicalStockAuthorized: boolean
}): AuthenticatedPublicationRecoveryV1 {
  const resumable = input.state === "RESUMABLE_AUTHORIZED_PUBLICATION"
  const rearmed = input.state === "REARMED_AWAITING_HUMAN_PUBLICATION"
  return Object.freeze({
    version: EBAY_AUTHENTICATED_PUBLICATION_RECOVERY_VERSION,
    state: input.state,
    autoResume: resumable,
    blocker: input.blocker ?? null,
    approvalId: text(input.approval.id) || null,
    executionId: text(input.execution.id) || null,
    publicationId: text(input.publication.id) || null,
    listingPackageId: text(input.approval.listing_package_id) || null,
    opportunityId: text(input.approval.opportunity_id) || null,
    candidateKey: text(input.approval.candidate_key) || null,
    offerId: text(input.execution.offer_id) || null,
    authorizedPayloadHash: text(input.approval.payload_hash) || null,
    requestHash: text(input.execution.request_hash) || null,
    canonicalStockAuthorized: input.canonicalStockAuthorized,
    reusesExistingHumanApproval: resumable || rearmed,
    newHumanApprovalAllowed: false,
  })
}

export function classifyAuthenticatedPublicationRecoveryV1(input: Readonly<{
  readiness?: Readonly<{
    ready?: boolean
    blockers?: readonly string[]
    payloadHash?: string | null
  }> | null
  approval?: JsonRecord | null
  execution?: JsonRecord | null
  publication?: JsonRecord | null
  controlledIntentValidation?: OneClickPublicationIntentValidationV1 | null
  canonicalStockAuthorized: boolean
  expected: Readonly<{
    listingPackageId: string
    opportunityId: string
    candidateKey: string
    target: string
    accountFingerprint: string
  }>
}>): AuthenticatedPublicationRecoveryV1 {
  const approval = record(input.approval)
  const execution = record(input.execution)
  const publication = record(input.publication)
  const base = {
    approval,
    execution,
    publication,
    canonicalStockAuthorized: input.canonicalStockAuthorized,
  }
  if (!text(approval.id) || !text(execution.id)) {
    return recoveryResult({ ...base, state: "NOT_APPLICABLE" })
  }
  const blocked = (blocker: string) => recoveryResult({
    ...base,
    state: "RECOVERY_BLOCKED",
    blocker,
  })
  if (
    approval.status !== "consumed"
    || !text(approval.consumed_at)
    || Boolean(approval.revoked_at)
  ) return blocked("EBAY_AUTHENTICATED_RECOVERY_APPROVAL_INVALID")
  const expected = input.expected
  if (
    text(approval.listing_package_id) !== expected.listingPackageId
    || text(approval.opportunity_id) !== expected.opportunityId
    || text(approval.candidate_key) !== expected.candidateKey
    || text(approval.target) !== expected.target
    || text(approval.account_fingerprint) !== expected.accountFingerprint
    || text(execution.approval_id) !== text(approval.id)
    || text(execution.listing_package_id) !== expected.listingPackageId
    || text(execution.opportunity_id) !== expected.opportunityId
    || text(execution.target) !== expected.target
    || text(execution.account_fingerprint) !== expected.accountFingerprint
  ) return blocked("EBAY_AUTHENTICATED_RECOVERY_IDENTITY_CHANGED")
  const authorizedHash = text(approval.payload_hash)
  const requestHash = text(execution.request_hash)
  if (
    !authorizedHash
    || requestHash !== authorizedHash
  ) return blocked("APPROVED_PAYLOAD_CHANGED")
  const offerId = text(execution.offer_id)
  const sku = text(execution.sku)
  if (execution.phase !== "completed" || !offerId || !sku) {
    return blocked("EBAY_AUTHENTICATED_RECOVERY_COMPLETED_OFFER_REQUIRED")
  }
  if (text(publication.id)) {
    if (
      text(publication.draft_execution_id) !== text(execution.id)
      || text(publication.draft_approval_id) !== text(approval.id)
      || text(publication.listing_package_id) !== expected.listingPackageId
      || text(publication.opportunity_id) !== expected.opportunityId
      || text(publication.target) !== expected.target
      || text(publication.account_fingerprint) !== expected.accountFingerprint
      || text(publication.offer_id) !== offerId
      || text(publication.sku) !== sku
    ) return blocked("EBAY_AUTHENTICATED_RECOVERY_PUBLICATION_CHANGED")
    const rearmedResult = record(publication.sanitized_result)
    if (
      publication.phase === "preview_ready"
      && Number(publication.publish_attempt_count) === 0
      && !text(publication.listing_id)
      && Number(rearmedResult.compensatedRecoveryCount) === 1
      && Boolean(text(rearmedResult.compensatedRecoveryAuthorizedAt))
    ) {
      return recoveryResult({
        ...base,
        state: "REARMED_AWAITING_HUMAN_PUBLICATION",
      })
    }
  }
  if (input.controlledIntentValidation?.valid !== true) {
    return blocked(input.controlledIntentValidation?.blocker
      ?? "EBAY_ONE_CLICK_PUBLICATION_INTENT_MISSING")
  }
  const canonicalBlockers = Array.isArray(input.readiness?.blockers)
    ? input.readiness.blockers.filter((value): value is string =>
        typeof value === "string" && Boolean(value.trim()))
    : []
  const finalPreflightRefreshable = new Set([
    "EBAY_PREFLIGHT_SNAPSHOT_REQUIRED",
    "EBAY_PREFLIGHT_SNAPSHOT_STALE",
  ])
  const materialCanonicalBlockers = canonicalBlockers.filter((blocker) =>
    !finalPreflightRefreshable.has(blocker))
  if (
    materialCanonicalBlockers.length > 0
    || (input.readiness?.ready !== true && canonicalBlockers.length === 0)
  ) {
    return blocked(materialCanonicalBlockers[0]
      ?? "EBAY_AUTHENTICATED_RECOVERY_CANONICAL_READINESS_REQUIRED")
  }
  if (!input.canonicalStockAuthorized) {
    return blocked("EBAY_AUTHENTICATED_RECOVERY_CANONICAL_STOCK_REQUIRED")
  }
  if (!text(publication.id)) {
    return recoveryResult({
      ...base,
      state: "RESUMABLE_AUTHORIZED_PUBLICATION",
    })
  }
  if (
    text(publication.draft_execution_id) !== text(execution.id)
    || text(publication.draft_approval_id) !== text(approval.id)
    || text(publication.listing_package_id) !== expected.listingPackageId
    || text(publication.opportunity_id) !== expected.opportunityId
    || text(publication.target) !== expected.target
    || text(publication.account_fingerprint) !== expected.accountFingerprint
    || text(publication.offer_id) !== offerId
    || text(publication.sku) !== sku
  ) return blocked("EBAY_AUTHENTICATED_RECOVERY_PUBLICATION_CHANGED")
  if (
    publication.phase === "monitor_registered"
    && /^[0-9]{9,20}$/.test(text(publication.listing_id))
    && text(publication.verified_active_at)
    && text(publication.monitor_registered_at)
  ) {
    return recoveryResult({ ...base, state: "ACTIVE_VERIFIED" })
  }
  if (
    Number(publication.publish_attempt_count) > 0
    || Boolean(text(publication.publication_idempotency_key))
    || Boolean(text(publication.listing_id))
    || [
      "publish_in_flight",
      "outcome_unknown",
      "published_pending_verification",
    ].includes(text(publication.phase))
  ) {
    return recoveryResult({
      ...base,
      state: "PUBLISH_ALREADY_CLAIMED",
      blocker: "EBAY_FINAL_PUBLICATION_RECONCILIATION_REQUIRED",
    })
  }
  if (publication.phase === "terminal_failure") {
    return blocked(text(publication.last_error_code)
      || "EBAY_FINAL_PUBLICATION_TERMINAL_FAILURE")
  }
  if (
    publication.phase !== "preview_ready"
    || Number(publication.publish_attempt_count) !== 0
    || Boolean(text(publication.listing_id))
  ) return blocked("EBAY_AUTHENTICATED_RECOVERY_PUBLICATION_NOT_RESUMABLE")
  return recoveryResult({
    ...base,
    state: "RESUMABLE_AUTHORIZED_PUBLICATION",
  })
}

export function validateOneClickControlledPublicationIntentV1(input: {
  approvedPayload: JsonRecord
  actorUserId: string
  listingPackage?: JsonRecord | null
  opportunity?: JsonRecord | null
  accountFingerprint?: string | null
}): OneClickPublicationIntentValidationV1 {
  const intent = record(input.approvedPayload.controlledPublicationIntent)
  if (!Object.keys(intent).length) {
    return {
      valid: false,
      blocker: "EBAY_ONE_CLICK_PUBLICATION_INTENT_MISSING",
      intent,
    }
  }
  const expected = exactIntent({
    approvedPayload: input.approvedPayload,
    actorUserId: input.actorUserId,
  })
  // The durable package digest is produced from the database package_data at
  // authorization time. Recompute every other field from the approved payload,
  // then compare that stored digest to the live package independently below so
  // a legitimate package change receives the precise fail-closed reason.
  expected.packageDigest = text(intent.packageDigest)
  const expectedIntent: JsonRecord = {
    ...expected,
    intentDigest: sha256(expected),
  }
  const expectedMachineContinuation = record(
    expectedIntent.machineContinuation,
  )
  if (
    text(expectedIntent.marketplaceTarget) !== "PRODUCTION"
    || text(expectedIntent.marketplaceId) !== "EBAY_US"
    || !/^[0-9a-f]{64}$/.test(text(expectedIntent.accountFingerprint))
    || !/^sha256:[0-9a-f]{64}$/.test(text(expectedIntent.packageDigest))
    || !text(expectedIntent.listingPackageId)
    || !text(expectedIntent.opportunityId)
    || !text(expectedIntent.candidateKey)
    || !text(expectedIntent.sku)
    || !text(expectedIntent.categoryId)
    || Number(expectedIntent.quantity) !== 1
    || Number(expectedIntent.inventoryQuantity) !== 1
    || Number(expectedIntent.imageCount) < 1
    || expectedMachineContinuation.exactPayloadComparisonRequired !== true
    || expectedMachineContinuation.activeOfficialReadbackRequired !== true
  ) {
    return {
      valid: false,
      blocker: "EBAY_ONE_CLICK_PUBLICATION_INTENT_SCOPE_INVALID",
      intent,
    }
  }
  if (
    hashEbayDraftOnlyPayload(intent) !==
      hashEbayDraftOnlyPayload(expectedIntent)
  ) {
    return {
      valid: false,
      blocker: "EBAY_ONE_CLICK_PUBLICATION_INTENT_DIGEST_MISMATCH",
      intent,
    }
  }
  const listingPackage = record(input.listingPackage)
  if (Object.keys(listingPackage).length && (
    text(intent.listingPackageId) !== text(listingPackage.id)
    || text(intent.candidateKey) !== text(listingPackage.candidate_key)
    || text(intent.packageDigest) !== sha256(record(listingPackage.package_data))
  )) {
    return {
      valid: false,
      blocker: "EBAY_ONE_CLICK_PUBLICATION_PACKAGE_CHANGED",
      intent,
    }
  }
  const opportunity = record(input.opportunity)
  if (Object.keys(opportunity).length && (
    text(intent.opportunityId) !== text(opportunity.id)
    || text(intent.candidateKey) !== text(opportunity.candidate_key)
  )) {
    return {
      valid: false,
      blocker: "EBAY_ONE_CLICK_PUBLICATION_CANDIDATE_CHANGED",
      intent,
    }
  }
  if (
    input.accountFingerprint
    && text(intent.accountFingerprint) !== text(input.accountFingerprint)
  ) {
    return {
      valid: false,
      blocker: "EBAY_ONE_CLICK_PUBLICATION_ACCOUNT_CHANGED",
      intent,
    }
  }
  return { valid: true, blocker: null, intent }
}

export function assertOneClickControlledPublicationIntentV1(input: {
  approvedPayload: JsonRecord
  actorUserId: string
  listingPackage?: JsonRecord | null
  opportunity?: JsonRecord | null
  accountFingerprint?: string | null
}) {
  const validation = validateOneClickControlledPublicationIntentV1(input)
  if (!validation.valid) {
    throw new Error(validation.blocker ??
      "EBAY_ONE_CLICK_PUBLICATION_INTENT_INVALID")
  }
  return validation.intent
}
