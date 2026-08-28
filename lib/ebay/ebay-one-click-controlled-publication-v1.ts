import { hashEbayDraftOnlyPayload, type JsonRecord } from
  "./ebay-draft-only-readiness"

export const EBAY_ONE_CLICK_CONTROLLED_PUBLICATION_VERSION =
  "SELLER_OS_ONE_CLICK_CONTROLLED_PUBLICATION_V1"
export const EBAY_ONE_CLICK_PUBLICATION_LABEL = "PUBLICAR EN EBAY"
export const EBAY_ONE_CLICK_PUBLICATION_SURFACE =
  "SELLER_OS_SMART_STOCKING_ONE_CLICK_PUBLICATION_V1"

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
