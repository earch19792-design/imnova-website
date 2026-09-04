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

function validSha256(value: unknown) {
  return /^sha256:[0-9a-f]{64}$/.test(text(value))
}

/**
 * Owner authorization binds to the exact material publication package.
 * Quick Pick owns a narrower, stable material digest which deliberately
 * excludes lifecycle/read-model metadata. Other publisher sources retain the
 * pre-existing durable package-data digest contract.
 *
 * A malformed Quick Pick binding never falls back to another digest: that
 * would silently change the object the owner is authorizing.
 */
export function ownerAuthorizationPackageDigestV1(
  listingPackageValue: JsonRecord | null | undefined,
) {
  const listingPackage = record(listingPackageValue)
  const packageData = record(listingPackage.package_data)
  const quickPickPackage = record(packageData.quickPickMarketTestPackageV1)
  if (Object.keys(quickPickPackage).length > 0) {
    const binding = record(quickPickPackage.authorizationBinding)
    const canonicalDigest = text(quickPickPackage.packageDigest)
    const bindingDigest = text(binding.packageDigest)
    const valid = quickPickPackage.contractVersion ===
        "QUICK_PICK_MARKET_TEST_PACKAGE_AND_REMOTE_OWNER_REVIEW_V1"
      && binding.contractVersion === "QUICK_PICK_MATERIAL_PACKAGE_DIGEST_V1"
      && validSha256(canonicalDigest)
      && canonicalDigest === bindingDigest
    return Object.freeze({
      digest: valid ? canonicalDigest : "",
      source: "QUICK_PICK_MATERIAL_PACKAGE_DIGEST_V1" as const,
      valid,
    })
  }
  const digest = sha256(packageData)
  return Object.freeze({
    digest,
    source: "DURABLE_PACKAGE_DATA_DIGEST_V1" as const,
    valid: validSha256(digest),
  })
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
  const ownerPackageDigest = Object.keys(currentListingPackage).length
    ? ownerAuthorizationPackageDigestV1(currentListingPackage).digest
    : sha256(packageData)
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
    packageDigest: ownerPackageDigest,
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

export type ExactDraftOnlyPublicationSelfLineageV1 = Readonly<{
  exact: boolean
  reasonCode: string
  excludeApprovalId: string | null
  excludeApprovalIds?: readonly string[]
  rearmedAwaitingHumanPublication: boolean
}>

function selfLineageResult(
  exact: boolean,
  reasonCode: string,
  approvalId: string | null = null,
  rearmedAwaitingHumanPublication = false,
  additionalApprovalIds: readonly string[] = [],
): ExactDraftOnlyPublicationSelfLineageV1 {
  const excludeApprovalIds = exact
    ? [...new Set([approvalId, ...additionalApprovalIds].filter(
      (value): value is string => Boolean(value),
    ))]
    : []
  return Object.freeze({
    exact,
    reasonCode,
    excludeApprovalId: exact ? approvalId : null,
    excludeApprovalIds: Object.freeze(excludeApprovalIds),
    rearmedAwaitingHumanPublication:
      exact && rearmedAwaitingHumanPublication,
  })
}

export type CrossApprovalExistingUnpublishedOfferV1 = Readonly<{
  exact: boolean
  reasonCode: string
  currentApprovalId: string | null
  priorApprovalId: string | null
  priorExecutionId: string | null
  offerId: string | null
  excludeApprovalIds: readonly string[]
  marketplacePayloadsEqual: boolean
}>

/**
 * Recognizes an eBay Inventory Item + UNPUBLISHED Offer created by an older
 * approval as belonging to the exact current package. The old authorization
 * is lineage evidence only: it never authorizes the current continuation.
 */
export function classifyCrossApprovalExistingUnpublishedOfferV1(input: Readonly<{
  currentApproval?: JsonRecord | null
  priorApproval?: JsonRecord | null
  priorExecution?: JsonRecord | null
  expected: Readonly<{
    actorUserId: string
    listingPackageId: string
    opportunityId: string
    candidateKey: string
    target: string
    accountFingerprint: string
    sku: string
  }>
}>): CrossApprovalExistingUnpublishedOfferV1 {
  const current = record(input.currentApproval)
  const prior = record(input.priorApproval)
  const execution = record(input.priorExecution)
  const expected = input.expected
  const currentApprovalId = text(current.id) || null
  const priorApprovalId = text(prior.id) || null
  const priorExecutionId = text(execution.id) || null
  const offerId = text(execution.offer_id) || null
  const result = (
    exact: boolean,
    reasonCode: string,
    marketplacePayloadsEqual = false,
  ): CrossApprovalExistingUnpublishedOfferV1 => Object.freeze({
    exact,
    reasonCode,
    currentApprovalId,
    priorApprovalId,
    priorExecutionId,
    offerId,
    excludeApprovalIds: Object.freeze(exact
      ? [currentApprovalId, priorApprovalId].filter(
        (value): value is string => Boolean(value),
      ) : []),
    marketplacePayloadsEqual,
  })
  if (!currentApprovalId || !priorApprovalId || !priorExecutionId || !offerId) {
    return result(false, "CROSS_APPROVAL_LINEAGE_INCOMPLETE")
  }
  if (currentApprovalId === priorApprovalId) {
    return result(false, "CROSS_APPROVAL_DISTINCT_APPROVAL_REQUIRED")
  }
  if (
    current.status !== "approved"
    || Boolean(current.consumed_at)
    || Boolean(current.revoked_at)
    || !Number.isFinite(Date.parse(text(current.expires_at)))
    || Date.parse(text(current.expires_at)) <= Date.now()
  ) return result(false, "CURRENT_OWNER_AUTHORIZATION_NOT_ACTIVE")
  if (
    prior.status !== "consumed"
    || !text(prior.consumed_at)
    || Boolean(prior.revoked_at)
    || execution.phase !== "completed"
    || text(execution.approval_id) !== priorApprovalId
    || text(execution.request_hash) !== text(prior.payload_hash)
  ) return result(false, "PRIOR_UNPUBLISHED_EXECUTION_NOT_DURABLE")
  const exactIdentity = [current, prior].every((approval) =>
    text(approval.actor_user_id) === expected.actorUserId
    && text(approval.listing_package_id) === expected.listingPackageId
    && text(approval.opportunity_id) === expected.opportunityId
    && text(approval.candidate_key) === expected.candidateKey
    && text(approval.target) === expected.target
    && text(approval.account_fingerprint) === expected.accountFingerprint)
    && text(execution.actor_user_id) === expected.actorUserId
    && text(execution.listing_package_id) === expected.listingPackageId
    && text(execution.opportunity_id) === expected.opportunityId
    && text(execution.target) === expected.target
    && text(execution.account_fingerprint) === expected.accountFingerprint
    && text(execution.sku) === expected.sku
  if (!exactIdentity) return result(false, "CROSS_APPROVAL_IDENTITY_MISMATCH")
  const currentPayload = record(current.approved_payload)
  const priorPayload = record(prior.approved_payload)
  const currentOffer = record(currentPayload.offerPayload)
  const priorOffer = record(priorPayload.offerPayload)
  if (
    text(currentPayload.sku) !== expected.sku
    || text(currentOffer.sku) !== expected.sku
    || text(priorPayload.sku) !== expected.sku
    || text(priorOffer.sku) !== expected.sku
    || text(currentOffer.marketplaceId) !== "EBAY_US"
    || text(priorOffer.marketplaceId) !== "EBAY_US"
  ) return result(false, "CROSS_APPROVAL_SKU_MISMATCH")
  const marketplacePayloadsEqual =
    hashEbayDraftOnlyPayload(currentPayload.inventoryItemPayload) ===
      hashEbayDraftOnlyPayload(priorPayload.inventoryItemPayload)
    && hashEbayDraftOnlyPayload(currentPayload.offerPayload) ===
      hashEbayDraftOnlyPayload(priorPayload.offerPayload)
  if (!marketplacePayloadsEqual) {
    return result(false, "CROSS_APPROVAL_MARKETPLACE_PAYLOAD_CHANGED")
  }
  return result(
    true,
    "SELF_LINEAGE_EXISTING_UNPUBLISHED_OFFER",
    true,
  )
}

/**
 * Certifies that a SKU ledger row belongs to the exact package lifecycle that
 * is currently being read or approved. This is the only authority allowed to
 * remove a ledger row from SKU-collision evaluation; active-listing and
 * official eBay duplicate guards remain independent and fail closed.
 */
export function classifyExactDraftOnlyPublicationSelfLineageV1(
  input: Readonly<{
    approval?: JsonRecord | null
    execution?: JsonRecord | null
    publication?: JsonRecord | null
    expected: Readonly<{
      actorUserId: string
      listingPackageId: string
      opportunityId: string
      candidateKey: string
      target: string
      accountFingerprint: string
      sku: string
    }>
  }>,
): ExactDraftOnlyPublicationSelfLineageV1 {
  const approval = record(input.approval)
  const execution = record(input.execution)
  const publication = record(input.publication)
  const expected = input.expected
  const approvalId = text(approval.id)
  const executionId = text(execution.id)
  if (!approvalId || !executionId) {
    return selfLineageResult(false, "SELF_LINEAGE_LEDGER_NOT_FOUND")
  }
  const approvalUsable = approval.status === "approved"
    ? !text(approval.consumed_at) && !Boolean(approval.revoked_at)
    : approval.status === "consumed"
      && Boolean(text(approval.consumed_at))
      && !Boolean(approval.revoked_at)
  if (!approvalUsable) {
    return selfLineageResult(false, "SELF_LINEAGE_APPROVAL_INVALID")
  }
  if (
    text(approval.actor_user_id) !== expected.actorUserId
    || text(approval.listing_package_id) !== expected.listingPackageId
    || text(approval.opportunity_id) !== expected.opportunityId
    || text(approval.candidate_key) !== expected.candidateKey
    || text(approval.target) !== expected.target
    || text(approval.account_fingerprint) !== expected.accountFingerprint
    || text(execution.actor_user_id) !== expected.actorUserId
    || text(execution.approval_id) !== approvalId
    || text(execution.listing_package_id) !== expected.listingPackageId
    || text(execution.opportunity_id) !== expected.opportunityId
    || text(execution.target) !== expected.target
    || text(execution.account_fingerprint) !== expected.accountFingerprint
    || text(execution.sku) !== expected.sku
  ) return selfLineageResult(false, "SELF_LINEAGE_IDENTITY_MISMATCH")
  const approvedPayload = record(approval.approved_payload)
  const approvedSafety = record(approvedPayload.safety)
  if (
    text(record(approvedPayload.listingPackage).id) !==
      expected.listingPackageId
    || text(record(approvedPayload.listingPackage).candidateKey) !==
      expected.candidateKey
    || text(record(approvedPayload.sourceEvidence).opportunityId) !==
      expected.opportunityId
    || text(approvedPayload.sku) !== expected.sku
    || text(record(approvedPayload.offerPayload).sku) !== expected.sku
    || text(approvedSafety.target) !== expected.target
    || text(approvedSafety.accountFingerprint) !==
      expected.accountFingerprint
  ) return selfLineageResult(false, "SELF_LINEAGE_APPROVED_PAYLOAD_MISMATCH")
  if (
    !text(approval.payload_hash)
    || text(execution.request_hash) !== text(approval.payload_hash)
  ) return selfLineageResult(false, "SELF_LINEAGE_REQUEST_MISMATCH")
  if (execution.phase !== "completed") {
    return selfLineageResult(
      true,
      "EXACT_IN_PROGRESS_EXECUTION_SELF_LINEAGE",
      approvalId,
    )
  }
  if (!text(execution.offer_id)) {
    return selfLineageResult(false, "SELF_LINEAGE_COMPLETED_OFFER_REQUIRED")
  }
  const crossApprovalResume = record(
    record(execution.sanitized_result).crossApprovalSameLineageResumeV1,
  )
  const priorApprovalId = text(crossApprovalResume.priorApprovalId)
  const crossApprovalResumeValid =
    crossApprovalResume.officialReadbackVerified === true
    && crossApprovalResume.marketplaceWrites === 0
    && crossApprovalResume.inventoryItemCreated === false
    && crossApprovalResume.offerCreated === false
    && text(crossApprovalResume.currentApprovalId) === approvalId
    && text(crossApprovalResume.currentExecutionId) === executionId
    && text(crossApprovalResume.existingOfferId) === text(execution.offer_id)
    && Boolean(priorApprovalId)
  if (!text(publication.id)) {
    return selfLineageResult(
      true,
      crossApprovalResumeValid
        ? "SELF_LINEAGE_EXISTING_UNPUBLISHED_OFFER"
        : "EXACT_EXECUTION_SELF_LINEAGE",
      approvalId,
      false,
      crossApprovalResumeValid ? [priorApprovalId] : [],
    )
  }
  if (
    text(publication.draft_execution_id) !== executionId
    || text(publication.draft_approval_id) !== approvalId
    || text(publication.listing_package_id) !== expected.listingPackageId
    || text(publication.opportunity_id) !== expected.opportunityId
    || text(publication.target) !== expected.target
    || text(publication.account_fingerprint) !== expected.accountFingerprint
    || text(publication.offer_id) !== text(execution.offer_id)
    || text(publication.sku) !== expected.sku
  ) return selfLineageResult(false, "SELF_LINEAGE_PUBLICATION_MISMATCH")
  const preview = record(publication.preview)
  if (
    text(preview.draftExecutionId) !== executionId
    || text(preview.draftApprovalId) !== approvalId
    || text(preview.listingPackageId) !== expected.listingPackageId
    || text(preview.opportunityId) !== expected.opportunityId
    || text(preview.candidateKey) !== expected.candidateKey
    || text(preview.approvedPayloadHash) !== text(approval.payload_hash)
    || text(preview.offerId) !== text(execution.offer_id)
    || text(preview.sku) !== expected.sku
    || hashEbayDraftOnlyPayload(preview.inventoryItemPayload) !==
      hashEbayDraftOnlyPayload(approvedPayload.inventoryItemPayload)
    || hashEbayDraftOnlyPayload(preview.offerPayload) !==
      hashEbayDraftOnlyPayload(approvedPayload.offerPayload)
  ) return selfLineageResult(false, "SELF_LINEAGE_PREVIEW_MISMATCH")
  const rearmedResult = record(publication.sanitized_result)
  const rearmed = publication.phase === "preview_ready"
    && Number(publication.publish_attempt_count) === 0
    && !text(publication.publication_idempotency_key)
    && !text(publication.listing_id)
    && Number(rearmedResult.compensatedRecoveryCount) === 1
    && Boolean(text(rearmedResult.compensatedRecoveryAuthorizedAt))
  return selfLineageResult(
    true,
    rearmed
      ? "REARMED_EXACT_OFFER_SELF_LINEAGE"
      : "EXACT_OFFER_SELF_LINEAGE",
    approvalId,
    rearmed,
    crossApprovalResumeValid ? [priorApprovalId] : [],
  )
}

export function validateExactRearmedPublicationMaterialV1(input: Readonly<{
  approvedPayload: JsonRecord
  currentPayload: JsonRecord
}>) {
  const approved = input.approvedPayload
  const current = input.currentPayload
  const approvedListingPackage = record(approved.listingPackage)
  const currentListingPackage = record(current.listingPackage)
  const approvedSource = record(approved.sourceEvidence)
  const currentSource = record(current.sourceEvidence)
  const approvedSafety = record(approved.safety)
  const currentSafety = record(current.safety)
  const exact =
    text(approvedListingPackage.id) === text(currentListingPackage.id)
    && text(approvedListingPackage.candidateKey) ===
      text(currentListingPackage.candidateKey)
    && text(approvedSource.opportunityId) === text(currentSource.opportunityId)
    && text(approved.sku) === text(current.sku)
    && text(approvedSafety.target) === text(currentSafety.target)
    && text(approvedSafety.accountFingerprint) ===
      text(currentSafety.accountFingerprint)
    && hashEbayDraftOnlyPayload(approved.inventoryItemPayload) ===
      hashEbayDraftOnlyPayload(current.inventoryItemPayload)
    && hashEbayDraftOnlyPayload(approved.offerPayload) ===
      hashEbayDraftOnlyPayload(current.offerPayload)
  return Object.freeze({
    exact,
    reasonCode: exact
      ? "EXACT_REARMED_PUBLICATION_MATERIAL"
      : "REARMED_PUBLICATION_MATERIAL_CHANGED",
  })
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
    autoResume: false,
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
  const currentOwnerPackageDigest = Object.keys(listingPackage).length
    ? ownerAuthorizationPackageDigestV1(listingPackage)
    : null
  if (Object.keys(listingPackage).length && (
    text(intent.listingPackageId) !== text(listingPackage.id)
    || text(intent.candidateKey) !== text(listingPackage.candidate_key)
    || currentOwnerPackageDigest?.valid !== true
    || text(intent.packageDigest) !== currentOwnerPackageDigest.digest
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
