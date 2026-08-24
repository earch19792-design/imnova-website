import type {
  AlertCandidate,
  CommercialListingReadModel,
  CommercialMonitorGetDto,
} from "./commercial-monitor-readonly-contract"

export const SELLER_OS_CERTIFIED_OOS_EXECUTION_ADAPTER_V1 =
  "SELLER_OS_CERTIFIED_OOS_EXECUTION_ADAPTER_V1" as const

export const SELLER_OS_CERTIFIED_OOS_MARKETPLACE_OPERATION_V1 = Object.freeze({
  actionType: "END_LISTING" as const,
  tradingCall: "EndFixedPriceItem" as const,
  endingReason: "NotAvailable" as const,
})

export const SELLER_OS_CERTIFIED_OOS_APPROVED_STOCK_SOURCES_V1 =
  Object.freeze(["LUNA_PORTEX_PUBLIC_EXACT_PRODUCT_STOCK"] as const)

type Blocker =
  | "CERTIFIED_OOS_TARGET_IDENTITY_INVALID"
  | "CERTIFIED_OOS_TARGET_NOT_FOUND"
  | "CERTIFIED_OOS_TARGET_IDENTITY_MISMATCH"
  | "CERTIFIED_OOS_SUPPLIER_LINKAGE_REQUIRED"
  | "CERTIFIED_OOS_STOCK_STATE_REQUIRED"
  | "CERTIFIED_OOS_SOURCE_HEALTH_REQUIRED"
  | "CERTIFIED_OOS_FRESH_EVIDENCE_REQUIRED"
  | "CERTIFIED_OOS_SAFE_CAPACITY_REQUIRED"
  | "CERTIFIED_OOS_EXPLICIT_AUTHORITATIVE_ZERO_REQUIRED"
  | "CERTIFIED_OOS_APPROVED_SOURCE_REQUIRED"
  | "CERTIFIED_OOS_COMPOSITION_REQUIRED"
  | "CERTIFIED_OOS_CRITICAL_ALERT_REQUIRED"
  | "CERTIFIED_OOS_EXPERIMENT_PROTECTION_BLOCKED"
  | "CERTIFIED_OOS_MARKETPLACE_IDENTITY_UNPROVEN"
  | "CERTIFIED_OOS_MARKETPLACE_SAFETY_GATE_BLOCKED"

export type CertifiedOosExecutionPreflightV1 = Readonly<{
  contractVersion: typeof SELLER_OS_CERTIFIED_OOS_EXECUTION_ADAPTER_V1
  status: "ELIGIBLE" | "BLOCKED" | "NO_MUTATION_REQUIRED"
  executionEligible: boolean
  mutationRequired: boolean
  itemId: string
  sku: string
  supplierLinkage: string
  stockState: string
  sourceHealth: string
  freshness: string
  safeCapacity: number | null
  explicitAuthoritativeZero: boolean
  stockSource: string | null
  ebayState: string
  ebayQuantity: number | null
  compositionComplete: boolean
  criticalAlertCandidatePresent: boolean
  experimentProtectionBlocked: boolean
  marketplaceSafetyReady: boolean
  legacyLunaFieldsRequired: false
  legacyCommercialAlertEventRequired: false
  marketplaceOperation: typeof SELLER_OS_CERTIFIED_OOS_MARKETPLACE_OPERATION_V1
  blockerCodes: readonly Blocker[]
  safety: Readonly<{
    preflightOnly: true
    databaseWrites: 0
    ebayWrites: 0
    lunaWrites: 0
    whatsappSends: 0
  }>
}>

function safeItemId(value: string) {
  return /^\d{9,20}$/.test(value)
}

function safeSku(value: string) {
  return /^[A-Za-z0-9._:-]{1,100}$/.test(value)
}

function exactAlertCandidate(
  alerts: readonly AlertCandidate[],
  itemId: string,
  sku: string,
) {
  return alerts.some((alert) =>
    alert.reasonCode === "COMPONENT_OUT_OF_STOCK_CONFIRMED" &&
    alert.severity === "CRITICAL" &&
    alert.listingReference.scope === "LISTING" &&
    alert.listingReference.itemId === itemId &&
    alert.listingReference.sku === sku &&
    alert.supportingEvidence.length > 0 &&
    alert.candidateOnly === true &&
    alert.dispatchAllowed === false)
}

function stockSource(listing: CommercialListingReadModel | null) {
  if (!listing) return null
  const safeCapacitySource = listing.composition.bundleCapacity.source.system
  if (SELLER_OS_CERTIFIED_OOS_APPROVED_STOCK_SOURCES_V1.includes(
    safeCapacitySource as never,
  )) return safeCapacitySource
  const stockSource = listing.stock.quantity.source.system
  return SELLER_OS_CERTIFIED_OOS_APPROVED_STOCK_SOURCES_V1.includes(
    stockSource as never,
  ) ? stockSource : safeCapacitySource || stockSource || null
}

function experimentBlocked(listing: CommercialListingReadModel | null) {
  return listing?.experiment.status === "AVAILABLE" &&
    (listing.experiment.lifecycleState === "RUNNING" ||
      listing.experiment.commercialAction === "NO_TOCAR")
}

function marketplaceSafetyReady(monitor: CommercialMonitorGetDto) {
  return monitor.liveCertification.status === "CERTIFIED" &&
    monitor.liveCertification.marketplaceId === "EBAY_US" &&
    monitor.liveCertification.account.bindingConfigured === true &&
    monitor.liveCertification.account.bindingMatched === true &&
    monitor.liveCertification.oauth.status === "AVAILABLE" &&
    monitor.liveCertification.oauth.tokenReceived === true &&
    monitor.liveCertification.safety.marketplaceWrites === 0
}

export function preflightCertifiedOosExecutionV1(input: Readonly<{
  monitor: CommercialMonitorGetDto
  targetItemId: string
  targetSku: string
  operatorAuthorized?: boolean
  automationAuthorized?: boolean
}>): CertifiedOosExecutionPreflightV1 {
  const targetIdentityValid = safeItemId(input.targetItemId) &&
    safeSku(input.targetSku)
  const itemListing = targetIdentityValid
    ? input.monitor.listings.find((candidate) =>
        candidate.identity.itemId === input.targetItemId) ?? null
    : null
  const listing = targetIdentityValid
    ? input.monitor.listings.find((candidate) =>
        candidate.identity.itemId === input.targetItemId &&
        candidate.identity.sku === input.targetSku) ?? null
    : null
  const exactIdentity = listing !== null
  const source = stockSource(listing)
  const safeCapacity = listing?.composition.bundleCapacity.value ?? null
  const explicitAuthoritativeZero =
    listing?.composition.bundleCapacity.explicitAuthoritativeZero === true
  const compositionComplete = Boolean(listing &&
    listing.composition.status === "AVAILABLE" &&
    listing.composition.components.length > 0 &&
    listing.composition.limitingComponentId &&
    listing.composition.bundleCapacity.availability === "AVAILABLE" &&
    listing.composition.bundleCapacity.completeness === "COMPLETE")
  const criticalAlertCandidatePresent = targetIdentityValid && exactAlertCandidate(
    input.monitor.alertCandidates,
    input.targetItemId,
    input.targetSku,
  )
  const protectedExperiment = experimentBlocked(listing)
  const marketplaceReady = marketplaceSafetyReady(input.monitor) &&
    (input.operatorAuthorized === true || input.automationAuthorized === true)
  const ebayState = listing?.discovery.livePresence.status ?? "NOT_FOUND"
  const supplierLinkage = listing?.stock.supplierLinkageStatus ?? "UNPROVEN"
  const state = listing?.stock.state ?? "STOCK_UNKNOWN"
  const sourceHealth = listing?.stock.sourceContractStatus ?? "UNPROVEN"
  const freshness = listing?.stock.freshness.status ?? "UNKNOWN"
  const blockers: Blocker[] = []

  if (!targetIdentityValid) blockers.push(
    "CERTIFIED_OOS_TARGET_IDENTITY_INVALID",
  )
  if (targetIdentityValid && !listing) blockers.push(itemListing
    ? "CERTIFIED_OOS_TARGET_IDENTITY_MISMATCH"
    : "CERTIFIED_OOS_TARGET_NOT_FOUND")

  if (listing && ebayState !== "LIVE_ACTIVE") {
    return Object.freeze({
      contractVersion: SELLER_OS_CERTIFIED_OOS_EXECUTION_ADAPTER_V1,
      status: "NO_MUTATION_REQUIRED",
      executionEligible: false,
      mutationRequired: false,
      itemId: input.targetItemId,
      sku: input.targetSku,
      supplierLinkage,
      stockState: state,
      sourceHealth,
      freshness,
      safeCapacity,
      explicitAuthoritativeZero,
      stockSource: source,
      ebayState,
      ebayQuantity: listing.identity.listedQuantity,
      compositionComplete,
      criticalAlertCandidatePresent,
      experimentProtectionBlocked: protectedExperiment,
      marketplaceSafetyReady: marketplaceReady,
      legacyLunaFieldsRequired: false,
      legacyCommercialAlertEventRequired: false,
      marketplaceOperation: SELLER_OS_CERTIFIED_OOS_MARKETPLACE_OPERATION_V1,
      blockerCodes: Object.freeze(blockers),
      safety: Object.freeze({ preflightOnly: true, databaseWrites: 0,
        ebayWrites: 0, lunaWrites: 0, whatsappSends: 0 }),
    })
  }

  if (supplierLinkage !== "CERTIFIED") blockers.push(
    "CERTIFIED_OOS_SUPPLIER_LINKAGE_REQUIRED",
  )
  if (state !== "CERTIFIED_OOS") blockers.push(
    "CERTIFIED_OOS_STOCK_STATE_REQUIRED",
  )
  if (sourceHealth !== "HEALTHY") blockers.push(
    "CERTIFIED_OOS_SOURCE_HEALTH_REQUIRED",
  )
  if (freshness !== "FRESH") blockers.push(
    "CERTIFIED_OOS_FRESH_EVIDENCE_REQUIRED",
  )
  if (safeCapacity !== 0) blockers.push(
    "CERTIFIED_OOS_SAFE_CAPACITY_REQUIRED",
  )
  if (!explicitAuthoritativeZero) blockers.push(
    "CERTIFIED_OOS_EXPLICIT_AUTHORITATIVE_ZERO_REQUIRED",
  )
  if (!source || !SELLER_OS_CERTIFIED_OOS_APPROVED_STOCK_SOURCES_V1
    .includes(source as never)) blockers.push(
      "CERTIFIED_OOS_APPROVED_SOURCE_REQUIRED",
    )
  if (!compositionComplete) blockers.push(
    "CERTIFIED_OOS_COMPOSITION_REQUIRED",
  )
  if (!criticalAlertCandidatePresent) blockers.push(
    "CERTIFIED_OOS_CRITICAL_ALERT_REQUIRED",
  )
  if (protectedExperiment) blockers.push(
    "CERTIFIED_OOS_EXPERIMENT_PROTECTION_BLOCKED",
  )
  if (listing?.identity.marketplaceCertification.status !== "US_CERTIFIED") {
    blockers.push("CERTIFIED_OOS_MARKETPLACE_IDENTITY_UNPROVEN")
  }
  if (!marketplaceReady) blockers.push(
    "CERTIFIED_OOS_MARKETPLACE_SAFETY_GATE_BLOCKED",
  )

  const executionEligible = blockers.length === 0
  return Object.freeze({
    contractVersion: SELLER_OS_CERTIFIED_OOS_EXECUTION_ADAPTER_V1,
    status: executionEligible ? "ELIGIBLE" : "BLOCKED",
    executionEligible,
    mutationRequired: executionEligible,
    itemId: input.targetItemId,
    sku: input.targetSku,
    supplierLinkage,
    stockState: state,
    sourceHealth,
    freshness,
    safeCapacity,
    explicitAuthoritativeZero,
    stockSource: source,
    ebayState,
    ebayQuantity: listing?.identity.listedQuantity ?? null,
    compositionComplete,
    criticalAlertCandidatePresent,
    experimentProtectionBlocked: protectedExperiment,
    marketplaceSafetyReady: marketplaceReady,
    legacyLunaFieldsRequired: false,
    legacyCommercialAlertEventRequired: false,
    marketplaceOperation: SELLER_OS_CERTIFIED_OOS_MARKETPLACE_OPERATION_V1,
    blockerCodes: Object.freeze(blockers),
    safety: Object.freeze({ preflightOnly: true, databaseWrites: 0,
      ebayWrites: 0, lunaWrites: 0, whatsappSends: 0 }),
  })
}
