export const EBAY_PUBLISHED_ACQUISITION_POLICY_VERSION =
  "EBAY_PUBLISHED_ACQUISITION_POLICY_V1_2026_07_26" as const

export const EBAY_PUBLISHED_ACQUISITION_BLOCKER_CODE =
  "ALREADY_PUBLISHED_AND_MONITORED" as const

export type EbayPublishedAcquisitionPolicyMode = "SHADOW" | "ENFORCE"

export type EbayPublishedAcquisitionIntent =
  | "NEW_ACQUISITION"
  | "EXPLICIT_RELIST"
  | "NEW_GENERATION"

export type EbayPublishedAcquisitionIdentity = {
  id: string
  accountKey: string
  marketplace: string
  identityStatus: string
  marketRadarProductId: string | null
  supplierVariantId: string | null
  supplierSku: string | null
  ebaySku: string | null
  offerId: string | null
  ebayItemId: string | null
  commercialGeneration: number
  observedAt: string | null
  source: string
}

export type EbayPublishedAcquisitionAuthorization = {
  id: string
  accountKey: string
  marketplace: string
  identityId: string
  action: "EXPLICIT_RELIST" | "NEW_GENERATION"
  commercialGeneration: number
  status: "APPROVED" | "REVOKED" | "CONSUMED" | "EXPIRED"
  expiresAt: string
}

export type EbayAcquisitionCandidateIdentity = {
  accountKey: string
  marketplace: string
  marketRadarProductId: string | null
  supplierVariantId: string | null
  supplierSku: string | null
  ebaySku: string | null
  offerId: string | null
  ebayItemId: string | null
  acquisitionIntent?: EbayPublishedAcquisitionIntent
  commercialGeneration?: number
  authorizationId?: string | null
}

const PUBLISHED_IDENTITY_STATUSES = new Set([
  "active",
  "published_pending_verification",
  "monitor_registered",
  "monitoring",
  "published_verified",
  "verified_active",
])

const POST_PUBLICATION_RECONCILIATION_STATES = new Set([
  "WAITING_ITEM_ID",
  "VERIFYING_PUBLISHED_LISTING",
  "REGISTERING_COMMERCIAL_MONITOR",
  "VERIFIED_ACTIVE",
  "COMPLETED",
])

function normalizedScope(value: string) {
  return value.normalize("NFKC").trim()
}

function normalizedExact(value: string | null) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC").trim()
  return normalized || null
}

function normalizedSku(value: string | null) {
  return normalizedExact(value)?.toUpperCase() ?? null
}

function normalizedMarketplace(value: string) {
  return normalizedScope(value).toUpperCase()
}

function normalizedGeneration(value: number | undefined) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 1
}

function validAt(value: string, now: Date) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed > now.getTime()
}

export function resolveEbayPublishedAcquisitionPolicyMode(
  value = process.env.EBAY_PUBLISHED_ACQUISITION_EXCLUSION_MODE,
): EbayPublishedAcquisitionPolicyMode {
  return value?.trim().toUpperCase() === "ENFORCE" ? "ENFORCE" : "SHADOW"
}

function matchingReasons(
  candidate: EbayAcquisitionCandidateIdentity,
  identity: EbayPublishedAcquisitionIdentity,
) {
  const reasons: string[] = []
  const candidateItemId = normalizedExact(candidate.ebayItemId)
  const candidateOfferId = normalizedExact(candidate.offerId)
  const candidateProductId = normalizedExact(candidate.marketRadarProductId)
  const candidateVariantId = normalizedExact(candidate.supplierVariantId)
  const candidateSkus = new Set([
    normalizedSku(candidate.supplierSku),
    normalizedSku(candidate.ebaySku),
  ].filter((value): value is string => Boolean(value)))
  const identitySkus = new Set([
    normalizedSku(identity.supplierSku),
    normalizedSku(identity.ebaySku),
  ].filter((value): value is string => Boolean(value)))

  if (
    candidateItemId &&
    candidateItemId === normalizedExact(identity.ebayItemId)
  ) reasons.push("EBAY_ITEM_ID")
  if (
    candidateOfferId &&
    candidateOfferId === normalizedExact(identity.offerId)
  ) reasons.push("OFFER_ID")
  if ([...candidateSkus].some((sku) => identitySkus.has(sku))) {
    reasons.push("SUPPLIER_OR_EBAY_SKU")
  }
  if (
    candidateProductId &&
    candidateVariantId &&
    candidateProductId === normalizedExact(identity.marketRadarProductId) &&
    candidateVariantId === normalizedExact(identity.supplierVariantId)
  ) reasons.push("PRODUCT_AND_VARIANT")

  return reasons
}

function explicitAuthorization(input: {
  candidate: EbayAcquisitionCandidateIdentity
  matches: EbayPublishedAcquisitionIdentity[]
  authorizations: EbayPublishedAcquisitionAuthorization[]
  now: Date
}) {
  const intent = input.candidate.acquisitionIntent ?? "NEW_ACQUISITION"
  if (intent !== "EXPLICIT_RELIST" && intent !== "NEW_GENERATION") return null
  const authorizationId = normalizedExact(input.candidate.authorizationId ?? null)
  if (!authorizationId) return null
  const requestedGeneration = normalizedGeneration(
    input.candidate.commercialGeneration,
  )
  const highestPublishedGeneration = Math.max(
    0,
    ...input.matches.map((match) =>
      normalizedGeneration(match.commercialGeneration)),
  )
  return input.authorizations.find((authorization) =>
    normalizedExact(authorization.id) === authorizationId &&
    normalizedScope(authorization.accountKey) ===
      normalizedScope(input.candidate.accountKey) &&
    normalizedMarketplace(authorization.marketplace) ===
      normalizedMarketplace(input.candidate.marketplace) &&
    authorization.action === intent &&
    authorization.status === "APPROVED" &&
    authorization.commercialGeneration === requestedGeneration &&
    requestedGeneration > highestPublishedGeneration &&
    input.matches.some((match) => match.id === authorization.identityId) &&
    validAt(authorization.expiresAt, input.now)
  ) ?? null
}

/**
 * This policy protects the acquisition lane only. Published products belong to
 * verification, monitoring and recovery. A relist or new generation requires a
 * durable server-side authorization; candidate JSON alone never grants it.
 */
export function evaluateEbayPublishedAcquisitionPolicy(input: {
  candidate: EbayAcquisitionCandidateIdentity
  identities: EbayPublishedAcquisitionIdentity[]
  authorizations?: EbayPublishedAcquisitionAuthorization[]
  machineState?: string
  mode?: EbayPublishedAcquisitionPolicyMode
  now?: Date
}) {
  const now = input.now ?? new Date()
  const mode = input.mode ?? resolveEbayPublishedAcquisitionPolicyMode()
  const accountKey = normalizedScope(input.candidate.accountKey)
  const marketplace = normalizedMarketplace(input.candidate.marketplace)
  const matchReasonByIdentity = new Map<string, string[]>()
  const matches = input.identities.filter((identity) => {
    if (
      normalizedScope(identity.accountKey) !== accountKey ||
      normalizedMarketplace(identity.marketplace) !== marketplace ||
      !PUBLISHED_IDENTITY_STATUSES.has(
        normalizedScope(identity.identityStatus).toLowerCase(),
      )
    ) return false
    const reasons = matchingReasons(input.candidate, identity)
    if (!reasons.length) return false
    matchReasonByIdentity.set(identity.id, reasons)
    return true
  })
  const postPublicationReconciliation = Boolean(
    input.machineState &&
    POST_PUBLICATION_RECONCILIATION_STATES.has(input.machineState),
  )
  const authorization = explicitAuthorization({
    candidate: input.candidate,
    matches,
    authorizations: input.authorizations ?? [],
    now,
  })
  const wouldBlock = matches.length > 0 &&
    !postPublicationReconciliation &&
    !authorization
  const enforced = wouldBlock && mode === "ENFORCE"
  const matchReasons = [...new Set(
    [...matchReasonByIdentity.values()].flat(),
  )]

  return {
    decision: authorization
      ? "ALLOW_EXPLICIT_RELIST_OR_NEW_GENERATION"
      : enforced
        ? "BLOCK_ALREADY_PUBLISHED"
        : wouldBlock
          ? "SHADOW_MATCH_ALREADY_PUBLISHED"
          : postPublicationReconciliation && matches.length
            ? "ALLOW_POST_PUBLICATION_RECONCILIATION"
            : "ALLOW_NEW_ACQUISITION",
    mode,
    wouldBlock,
    enforced,
    canEnterAcquisition: !enforced,
    blockerCodes: wouldBlock
      ? [EBAY_PUBLISHED_ACQUISITION_BLOCKER_CODE] as const
      : [] as const,
    policyVersion: EBAY_PUBLISHED_ACQUISITION_POLICY_VERSION,
    matchedIdentityIds: matches.map((match) => match.id),
    matchedRegistryRowIds: matches
      .filter((match) => match.source === "EBAY_ACTIVE_LISTING")
      .map((match) => match.id),
    matchedEbayItemIds: [...new Set(matches
      .map((match) => normalizedExact(match.ebayItemId))
      .filter((value): value is string => Boolean(value)))],
    matchedOfferIds: [...new Set(matches
      .map((match) => normalizedExact(match.offerId))
      .filter((value): value is string => Boolean(value)))],
    matchReasons,
    explicitAuthorizationId: authorization?.id ?? null,
    commercialGeneration: normalizedGeneration(
      input.candidate.commercialGeneration,
    ),
    ebayWrites: 0,
  }
}
