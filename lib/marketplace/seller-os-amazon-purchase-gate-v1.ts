import { createHash } from "node:crypto"

import { SELLER_OS_MINIMUM_NET_PROFIT_USD_V1,
  SELLER_OS_REORDER_COVERAGE_DAYS_V1,
  SELLER_OS_REORDER_MAX_UNITS_V1,
  SELLER_OS_SMALL_TEST_MAX_UNITS_V1 } from
  "./seller-os-commercial-policy-v1"

export const SELLER_OS_AMAZON_PURCHASE_GATE_V1 =
  "SELLER_OS_AMAZON_PURCHASE_GATE_V1" as const

export type SellerOsAmazonPurchaseDecisionV1 =
  | "BUY"
  | "SMALL_TEST"
  | "WAIT"
  | "REJECT"

export type SellerOsAmazonPurchaseNextEvidenceV1 =
  | "VERIFY_AMAZON_ASIN"
  | "VERIFY_AMAZON_ELIGIBILITY"
  | "GET_AMAZON_DEMAND"
  | "CAPTURE_SUPPLIER_AND_COST"
  | "COMPLETE_DELIVERED_COST"
  | "CAPTURE_AMAZON_PRICE"
  | "COMPLETE_AMAZON_FEES"
  | "WAIT_UPSTREAM"
  | "READY_FOR_OWNER_BUY_REVIEW"
  | "REVIEW_REORDER"
  | "REVIEW_REJECTION"

type Json = Record<string, unknown>

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Json : {}
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value : null
}

function integerOrNull(value: unknown) {
  const valueAsNumber = numberOrNull(value)
  return valueAsNumber !== null && Number.isSafeInteger(valueAsNumber)
    ? valueAsNumber : null
}

function money(value: number | null) {
  return value === null ? null : Number(value.toFixed(2))
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value))
    .digest("hex")}`
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function isPlaceholderSupplier(supplier: Json) {
  return supplier.evidenceState !== "CONFIRMED" ||
    supplier.sourceKey === "amazon-connie-products" ||
    /pendiente de vincular/i.test(String(supplier.name ?? ""))
}

function upstreamUnavailable(capture: Json) {
  return [capture.reportStatus, capture.financeStatus].some((value) =>
    /WAIT_UPSTREAM|UNAVAILABLE|RETRYABLE|QUOTA|THROTTL/i.test(
      String(value ?? "")))
}

export function buildSellerOsAmazonPurchaseGateV1(input: {
  observation: unknown
  now?: Date
}) {
  const observation = record(input.observation)
  const product = record(observation.product)
  const supplier = record(observation.supplier)
  const demand = record(observation.demand)
  const eligibility = record(observation.eligibility)
  const economics = record(observation.economics)
  const listing = record(observation.amazonListing)
  const performance = record(observation.performance)
  const outcome = record(observation.outcome)
  const capture = record(observation.capture)
  const evaluatedAt = (input.now ?? new Date()).toISOString()

  const asin = text(product.asin)
  const asinConfirmed = Boolean(asin && /^[A-Z0-9]{10}$/.test(asin))
  const eligibilityRestricted = eligibility.state === "RESTRICTED"
  const eligibilityConfirmed = eligibility.confirmed === true &&
    eligibility.freshness === "CURRENT"
  const demandConfirmed = demand.confirmed === true &&
    demand.freshness === "CURRENT"
  const authoritativeUnitsSold = performance.authoritative === true
    ? integerOrNull(performance.observedUnitsSold) : null
  const observationWindowDays = integerOrNull(
    performance.observationWindowDays)
  const authoritativeZeroDemand = authoritativeUnitsSold === 0 &&
    (observationWindowDays ?? 0) >= 14

  const supplierConfirmed = !isPlaceholderSupplier(supplier)
  const actualPerUnit = (value: unknown) => {
    const total = numberOrNull(value)
    return authoritativeUnitsSold !== null && authoritativeUnitsSold > 0 &&
        total !== null
      ? money(total / authoritativeUnitsSold) : null
  }
  const unitCostUsd = numberOrNull(economics.unitCostUsd)
  const inboundShippingPerUnitUsd = numberOrNull(
    economics.inboundShippingPerUnitUsd)
  const prepCostPerUnitUsd = numberOrNull(economics.prepCostPerUnitUsd)
  const expectedSalePriceUsd = numberOrNull(economics.expectedSalePriceUsd) ??
    numberOrNull(listing.listingPriceUsd)
  const projectedReferralFeePerUnitUsd = numberOrNull(
    economics.referralFeePerUnitUsd)
  const actualReferralFeePerUnitUsd = actualPerUnit(
    performance.amazonFeesUsd)
  const referralFeePerUnitUsd = projectedReferralFeePerUnitUsd ??
    actualReferralFeePerUnitUsd
  const projectedFbaFeePerUnitUsd = numberOrNull(
    economics.fbaFeePerUnitUsd)
  const actualFbaFeePerUnitUsd = actualPerUnit(
    performance.fulfillmentFeesUsd)
  const fbaFeePerUnitUsd = projectedFbaFeePerUnitUsd ??
    actualFbaFeePerUnitUsd
  const projectedOtherVariableCostPerUnitUsd = numberOrNull(
    economics.otherVariableCostPerUnitUsd)
  const actualOtherVariableCostPerUnitUsd = performance.authoritative === true &&
      authoritativeUnitsSold !== null && authoritativeUnitsSold > 0 &&
      numberOrNull(performance.refundsUsd) !== null &&
      numberOrNull(performance.otherActualCostsUsd) !== null
    ? money(((numberOrNull(performance.refundsUsd) ?? 0) +
      (numberOrNull(performance.otherActualCostsUsd) ?? 0)) /
      authoritativeUnitsSold) : null
  const otherVariableCostPerUnitUsd = projectedOtherVariableCostPerUnitUsd ??
    actualOtherVariableCostPerUnitUsd
  const deliveredCostComplete = unitCostUsd !== null &&
    inboundShippingPerUnitUsd !== null && prepCostPerUnitUsd !== null
  const feeEvidenceComplete = referralFeePerUnitUsd !== null &&
    fbaFeePerUnitUsd !== null && otherVariableCostPerUnitUsd !== null
  const economicsComplete = deliveredCostComplete &&
    expectedSalePriceUsd !== null && feeEvidenceComplete
  const maximumSupplierUnitCostUsd = expectedSalePriceUsd !== null &&
      inboundShippingPerUnitUsd !== null && prepCostPerUnitUsd !== null &&
      referralFeePerUnitUsd !== null && fbaFeePerUnitUsd !== null &&
      otherVariableCostPerUnitUsd !== null
    ? money(expectedSalePriceUsd - inboundShippingPerUnitUsd -
      prepCostPerUnitUsd - referralFeePerUnitUsd - fbaFeePerUnitUsd -
      otherVariableCostPerUnitUsd - SELLER_OS_MINIMUM_NET_PROFIT_USD_V1)
    : null
  const projectedNetProfitPerUnitUsd = economicsComplete
    ? money((expectedSalePriceUsd ?? 0) - (unitCostUsd ?? 0) -
      (inboundShippingPerUnitUsd ?? 0) - (prepCostPerUnitUsd ?? 0) -
      (referralFeePerUnitUsd ?? 0) - (fbaFeePerUnitUsd ?? 0) -
      (otherVariableCostPerUnitUsd ?? 0)) : null
  const minimumProfitMet = projectedNetProfitPerUnitUsd === null ? null
    : projectedNetProfitPerUnitUsd >= SELLER_OS_MINIMUM_NET_PROFIT_USD_V1
  const currentCostWithinCeiling = unitCostUsd !== null &&
      maximumSupplierUnitCostUsd !== null
    ? unitCostUsd <= maximumSupplierUnitCostUsd : null
  const winnerReorderReady = outcome.reorderDecision === "REVIEW_REORDER" &&
    outcome.skillOutcome === "WINNER"

  const blockers = unique([
    ...(!asinConfirmed ? ["EXACT_ASIN_UNPROVEN"] : []),
    ...(eligibilityRestricted ? ["AMAZON_SELLING_RESTRICTED"]
      : !eligibilityConfirmed ? [eligibility.freshness === "STALE"
        ? "AMAZON_ELIGIBILITY_STALE" : "AMAZON_ELIGIBILITY_UNPROVEN"] : []),
    ...(authoritativeZeroDemand ? ["AMAZON_AUTHORITATIVE_ZERO_DEMAND"]
      : !demandConfirmed ? [demand.freshness === "STALE"
        ? "AMAZON_DEMAND_STALE" : "AMAZON_DEMAND_UNPROVEN"] : []),
    ...(!supplierConfirmed || unitCostUsd === null
      ? ["SUPPLIER_AND_UNIT_COST_UNPROVEN"] : []),
    ...(supplierConfirmed && unitCostUsd !== null && !deliveredCostComplete
      ? ["DELIVERED_UNIT_COST_UNPROVEN"] : []),
    ...(expectedSalePriceUsd === null ? ["AMAZON_PRICE_UNPROVEN"] : []),
    ...(!feeEvidenceComplete ? ["AMAZON_FEES_UNPROVEN"] : []),
    ...(minimumProfitMet === false ? ["MINIMUM_4_USD_NET_NOT_MET"] : []),
    ...(currentCostWithinCeiling === false
      ? ["SUPPLIER_COST_ABOVE_MAXIMUM"] : []),
  ])

  const rejected = eligibilityRestricted || authoritativeZeroDemand ||
    minimumProfitMet === false || currentCostWithinCeiling === false
  const ready = asinConfirmed && eligibilityConfirmed && demandConfirmed &&
    supplierConfirmed && economicsComplete && minimumProfitMet === true &&
    currentCostWithinCeiling === true
  const decision: SellerOsAmazonPurchaseDecisionV1 = rejected ? "REJECT"
    : !ready ? "WAIT" : winnerReorderReady ? "BUY" : "SMALL_TEST"

  let nextAction: SellerOsAmazonPurchaseNextEvidenceV1
  let reasonCode: string
  if (decision === "REJECT") {
    nextAction = "REVIEW_REJECTION"
    reasonCode = eligibilityRestricted ? "AMAZON_SELLING_RESTRICTED"
      : authoritativeZeroDemand ? "AMAZON_AUTHORITATIVE_ZERO_DEMAND"
        : currentCostWithinCeiling === false
          ? "SUPPLIER_COST_ABOVE_MAXIMUM" : "MINIMUM_4_USD_NET_NOT_MET"
  } else if (!asinConfirmed) {
    nextAction = "VERIFY_AMAZON_ASIN"; reasonCode = "EXACT_ASIN_REQUIRED"
  } else if (!eligibilityConfirmed) {
    nextAction = "VERIFY_AMAZON_ELIGIBILITY"
    reasonCode = eligibility.freshness === "STALE"
      ? "FRESH_AMAZON_ELIGIBILITY_REQUIRED"
      : "AMAZON_ELIGIBILITY_REQUIRED"
  } else if (!demandConfirmed) {
    nextAction = upstreamUnavailable(capture)
      ? "WAIT_UPSTREAM" : "GET_AMAZON_DEMAND"
    reasonCode = demand.freshness === "STALE"
      ? "FRESH_AMAZON_DEMAND_REQUIRED"
      : upstreamUnavailable(capture) ? "AMAZON_UPSTREAM_UNAVAILABLE"
        : "AMAZON_DEMAND_REQUIRED"
  } else if (!supplierConfirmed || unitCostUsd === null) {
    nextAction = "CAPTURE_SUPPLIER_AND_COST"
    reasonCode = "SUPPLIER_AND_UNIT_COST_REQUIRED"
  } else if (!deliveredCostComplete) {
    nextAction = "COMPLETE_DELIVERED_COST"
    reasonCode = "INBOUND_AND_PREP_COST_REQUIRED"
  } else if (expectedSalePriceUsd === null) {
    nextAction = "CAPTURE_AMAZON_PRICE"
    reasonCode = "CURRENT_AMAZON_PRICE_REQUIRED"
  } else if (!feeEvidenceComplete) {
    nextAction = upstreamUnavailable(capture)
      ? "WAIT_UPSTREAM" : "COMPLETE_AMAZON_FEES"
    reasonCode = upstreamUnavailable(capture)
      ? "AMAZON_UPSTREAM_UNAVAILABLE" : "AMAZON_FEES_REQUIRED"
  } else if (decision === "BUY") {
    nextAction = "REVIEW_REORDER"
    reasonCode = "PROFITABLE_MOVEMENT_CONFIRMED"
  } else {
    nextAction = "READY_FOR_OWNER_BUY_REVIEW"
    reasonCode = "SMALL_TEST_EVIDENCE_COMPLETE"
  }

  const velocityUnitsPerDay = numberOrNull(performance.velocityUnitsPerDay)
  const supplierAvailableQuantity = integerOrNull(supplier.inventoryQuantity)
  const rawQuantity = decision === "BUY" && velocityUnitsPerDay !== null
    ? Math.max(1, Math.ceil(velocityUnitsPerDay *
      SELLER_OS_REORDER_COVERAGE_DAYS_V1))
    : decision === "SMALL_TEST" && velocityUnitsPerDay !== null
      ? Math.max(1, Math.ceil(velocityUnitsPerDay *
        SELLER_OS_REORDER_COVERAGE_DAYS_V1 * 0.1))
      : decision === "SMALL_TEST" ? SELLER_OS_SMALL_TEST_MAX_UNITS_V1 : null
  const policyMaximum = decision === "BUY"
    ? SELLER_OS_REORDER_MAX_UNITS_V1 : SELLER_OS_SMALL_TEST_MAX_UNITS_V1
  const recommendedPurchaseQuantity = rawQuantity === null ? null
    : Math.min(rawQuantity, policyMaximum,
      supplierAvailableQuantity ?? Number.POSITIVE_INFINITY)

  const withoutDigest = {
    contractVersion: SELLER_OS_AMAZON_PURCHASE_GATE_V1,
    evaluatedAt,
    sourceObservationDigest: text(observation.observationDigest),
    product: { asin, sellerSku: text(listing.sellerSku),
      title: text(product.title) },
    supplier: { sourceKey: text(supplier.sourceKey),
      name: text(supplier.name), sku: text(supplier.sku),
      inventoryQuantity: supplierAvailableQuantity,
      identityConfirmed: supplierConfirmed },
    market: { currentAmazonPriceUsd: expectedSalePriceUsd,
      priceAuthority: listing.listingPriceUsd !== null &&
        listing.listingPriceUsd !== undefined
        ? "AMAZON_LISTINGS_ITEMS_READONLY" as const
        : expectedSalePriceUsd !== null
          ? "SELLER_OS_PROJECTED_ECONOMICS" as const : null,
      competitionState: "UNAVAILABLE_NOT_CAPTURED" as const,
      competitionUsedForRepricing: false as const },
    evidence: { asinConfirmed, eligibilityConfirmed, demandConfirmed,
      authoritativeZeroDemand, supplierConfirmed, deliveredCostComplete,
      feeEvidenceComplete, economicsComplete,
      upstreamState: upstreamUnavailable(capture)
        ? "UNAVAILABLE" as const : "AVAILABLE_OR_UNPROVEN" as const },
    economics: { unitCostUsd, inboundShippingPerUnitUsd, prepCostPerUnitUsd,
      referralFeePerUnitUsd, fbaFeePerUnitUsd, otherVariableCostPerUnitUsd,
      feeAuthority: projectedReferralFeePerUnitUsd !== null &&
          projectedFbaFeePerUnitUsd !== null
        ? "PROJECTED_UNIT_ECONOMICS" as const
        : actualReferralFeePerUnitUsd !== null &&
            actualFbaFeePerUnitUsd !== null
          ? "AMAZON_FINANCES_ACTUAL_PER_UNIT" as const : "UNPROVEN" as const,
      projectedNetProfitPerUnitUsd, minimumNetProfitUsd:
        SELLER_OS_MINIMUM_NET_PROFIT_USD_V1,
      minimumProfitMet, maximumSupplierUnitCostUsd,
      currentCostWithinCeiling },
    decision,
    recommendedPurchaseQuantity,
    quantityBasis: decision === "BUY" ? "14_DAY_CONFIRMED_VELOCITY_REORDER"
      : decision === "SMALL_TEST" && velocityUnitsPerDay !== null
        ? "10_PERCENT_OF_14_DAY_CONFIRMED_VELOCITY_MAX_3"
        : decision === "SMALL_TEST" ? "POLICY_LIMITED_TEST_MAX_3" : null,
    blockers,
    nextBestEvidence: { action: nextAction, priority: 1 as const,
      reasonCode, inventedEvidence: false as const },
    provenance: { demandAuthority: text(demand.confirmationBasis),
      eligibilityAuthority: text(capture.authority),
      economicsAuthority: "SELLER_OS_AMAZON_CONTRIBUTOR_PERFORMANCE_MONITOR_V1",
      failClosed: true as const },
    safety: { ownerReviewRequired: true as const,
      automaticPurchaseAllowed: false as const, supplierPurchases: 0 as const,
      amazonWrites: 0 as const, publications: 0 as const,
      repricing: 0 as const },
  }
  return Object.freeze({ ...withoutDigest,
    gateDigest: digest({ ...withoutDigest, evaluatedAt: null }) })
}
