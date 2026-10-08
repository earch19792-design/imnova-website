import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import { buildSellerOsAmazonPurchaseGateV1,
  SELLER_OS_AMAZON_PURCHASE_GATE_V1 } from
  "./seller-os-amazon-purchase-gate-v1"
import { evaluateSellerOsRoiMarginPolicyV2,
  sellerOsRoiMarginPolicyContractV2 } from
  "./seller-os-roi-margin-policy-v2"

export const SELLER_OS_AMAZON_CONTRIBUTOR_PERFORMANCE_V1 =
  "SELLER_OS_AMAZON_CONTRIBUTOR_PERFORMANCE_MONITOR_V1" as const
export const SELLER_OS_CONNIE_COLLABORATOR_KEY_V1 =
  "connie-g-yape" as const

type Json = Record<string, unknown>

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Json : {}
}

function text(value: unknown, maximum = 500) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ")
  if (!normalized || /[\p{Cc}\p{Cf}]/u.test(normalized)) return null
  return normalized.slice(0, maximum)
}

function money(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const numeric = Number(typeof value === "string"
    ? value.replace(/[$,\s]/g, "") : value)
  return Number.isFinite(numeric) && numeric >= 0
    ? Number(numeric.toFixed(2)) : null
}

function integer(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const numeric = Number(typeof value === "string"
    ? value.replace(/[,\s]/g, "") : value)
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null
}

function iso(value: unknown) {
  if (!value) return null
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function safeHttps(value: unknown) {
  const candidate = text(value, 2_000)
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    return url.protocol === "https:" ? url.toString() : null
  } catch {
    return null
  }
}

function slug(value: string, maximum = 70) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, maximum).replace(/-+$/g, "")
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[],
  fallback: T) {
  return allowed.includes(value as T) ? value as T : fallback
}

function optionalOneOf<T extends string>(value: unknown,
  allowed: readonly T[]) {
  return allowed.includes(value as T) ? value as T : null
}

function sum(values: Array<number | null>) {
  return values.every((value): value is number => value !== null)
    ? Number(values.reduce((total, value) => total + value, 0).toFixed(2))
    : null
}

function sourceKey(name: string, url: string) {
  const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase()
  if (hostname === "888lots.com" || hostname.endsWith(".888lots.com")) {
    return "888lots"
  }
  if (hostname === "lunaportex.com" || hostname.endsWith(".lunaportex.com")) {
    return "lunaportex"
  }
  const base = slug(name, 62) || slug(hostname, 62)
  const suffix = createHash("sha256").update(hostname).digest("hex").slice(0, 8)
  return `supplier-${base}-${suffix}`.slice(0, 80).replace(/-+$/g, "")
}

function productHandle(asin: string | null, supplierSku: string) {
  // The supplier product is the durable Market Radar identity. ASIN alone is
  // not unique because one supplier may offer the same ASIN under many SKUs.
  const identity = `${asin ?? "no-asin"}:${supplierSku}`
  const base = slug(identity, 150) || "product"
  const suffix = createHash("sha256").update(identity).digest("hex").slice(0, 8)
  return `amazon-${base}-${suffix}`.slice(0, 200).replace(/-+$/g, "")
}

function freshness(observedAt: string | null, now: Date, maximumAgeDays: number) {
  if (!observedAt) return "MISSING" as const
  const ageDays = (now.getTime() - Date.parse(observedAt)) / 86_400_000
  if (ageDays < -(5 / 1_440)) return "INVALID_FUTURE" as const
  return ageDays <= maximumAgeDays ? "CURRENT" as const : "STALE" as const
}

export type AmazonContributorNextActionV1 =
  | "VERIFY_AMAZON_ASIN"
  | "VERIFY_AMAZON_ELIGIBILITY"
  | "GET_AMAZON_DEMAND"
  | "CAPTURE_DELIVERED_COST"
  | "COMPLETE_AMAZON_ECONOMICS"
  | "CAPTURE_AMAZON_LISTING_READBACK"
  | "MEASURE_RESULT"
  | "REVIEW_REORDER"
  | "REVIEW_REJECTION"

export function buildAmazonContributorObservationV1(value: unknown,
  options: { now?: Date } = {}) {
  const input = record(value)
  const supplierInput = record(input.supplier)
  const productInput = record(input.product)
  const demandInput = record(input.demand)
  const eligibilityInput = record(input.eligibility)
  const economicsInput = record(input.economics)
  const listingInput = record(input.amazonListing)
  const marketInput = record(input.amazonMarket)
  const performanceInput = record(input.performance)
  const captureInput = record(input.capture)
  const now = options.now ?? new Date()
  const observedAt = iso(input.observedAt) ?? now.toISOString()
  if (Date.parse(observedAt) > now.getTime() + 5 * 60_000) {
    throw new Error("SELLER_OS_AMAZON_CONTRIBUTOR_OBSERVED_AT_INVALID")
  }

  const supplierName = text(supplierInput.name, 160)
  const supplierBaseUrl = safeHttps(supplierInput.baseUrl)
  const supplierSku = text(supplierInput.sku, 240)
  const title = text(productInput.title, 500)
  if (!supplierName || !supplierBaseUrl || !supplierSku || !title) {
    throw new Error("SELLER_OS_AMAZON_CONTRIBUTOR_CORE_FIELDS_REQUIRED")
  }
  const supplierProductId = text(supplierInput.productId, 240) ?? supplierSku
  const supplierVariantId = text(supplierInput.variantId, 240) ?? supplierSku
  const asinCandidate = text(productInput.asin, 20)?.toUpperCase() ?? null
  const asin = asinCandidate && /^[A-Z0-9]{10}$/.test(asinCandidate)
    ? asinCandidate : null
  const upcCandidate = text(productInput.upc, 40)?.replace(/\D/g, "") ?? null
  const upc = upcCandidate && [8, 12, 13, 14].includes(upcCandidate.length)
    ? upcCandidate : null
  const supplierInventoryQuantity = integer(supplierInput.inventoryQuantity)
  const supplierProductUrl = safeHttps(supplierInput.productUrl)
  const sourceKeyOverride = text(supplierInput.sourceKeyOverride, 80)
  const canonicalSourceKey = sourceKeyOverride &&
      /^[a-z0-9][a-z0-9-]{1,79}$/.test(sourceKeyOverride)
    ? sourceKeyOverride : sourceKey(supplierName, supplierBaseUrl)

  const demandEvidenceState = oneOf(demandInput.evidenceState,
    ["CONFIRMED", "SUPPORTED", "CONTRIBUTOR_ASSERTED", "UNPROVEN",
      "UNAVAILABLE"] as const,
    "UNPROVEN")
  const demandClaim = oneOf(demandInput.claim,
    ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const, "UNKNOWN")
  const eligibilityState = oneOf(eligibilityInput.state,
    ["CONFIRMED", "RESTRICTED", "UNPROVEN", "UNAVAILABLE"] as const,
    "UNPROVEN")
  const listingState = oneOf(listingInput.state,
    ["NOT_LISTED", "DRAFT", "ACTIVE", "INACTIVE", "SUPPRESSED"] as const,
    "NOT_LISTED")
  const resultAuthority = oneOf(performanceInput.authority,
    ["SELLER_CENTRAL_REPORT", "OWNER_ATTESTED", "CONTRIBUTOR_ATTESTED",
      "UNPROVEN"] as const, "UNPROVEN")
  const resultAuthoritative = ["SELLER_CENTRAL_REPORT", "OWNER_ATTESTED"]
    .includes(resultAuthority)
  const demandObservedAt = iso(demandInput.observedAt)
  const eligibilityObservedAt = iso(eligibilityInput.observedAt)
  const performanceObservedAt = iso(performanceInput.observedAt)
  const demandFreshness = freshness(demandObservedAt, now, 90)
  const eligibilityFreshness = freshness(eligibilityObservedAt, now, 90)
  const performanceFreshness = freshness(performanceObservedAt, now, 45)

  const unitCostUsd = money(economicsInput.unitCostUsd)
  const inboundShippingPerUnitUsd = money(
    economicsInput.inboundShippingPerUnitUsd)
  const prepCostPerUnitUsd = money(economicsInput.prepCostPerUnitUsd)
  const expectedSalePriceUsd = money(economicsInput.expectedSalePriceUsd)
  const referralFeePerUnitUsd = money(economicsInput.referralFeePerUnitUsd)
  const fbaFeePerUnitUsd = money(economicsInput.fbaFeePerUnitUsd)
  const otherVariableCostPerUnitUsd = money(
    economicsInput.otherVariableCostPerUnitUsd)
  const estimatedAmazonFeesPerUnitUsd = money(
    economicsInput.estimatedAmazonFeesPerUnitUsd)
  const feeEstimateObservedAt = iso(economicsInput.feeEstimateObservedAt)
  const feeEstimateFreshness = freshness(feeEstimateObservedAt, now, 14)
  const featuredOfferObservedAt = iso(marketInput.observedAt)
  const featuredOfferFreshness = freshness(featuredOfferObservedAt, now, 7)
  const featuredOfferPriceUsd = money(marketInput.featuredOfferPriceUsd)
  const featuredOfferPriceMaximumUsd = money(
    marketInput.featuredOfferPriceMaximumUsd)
  const projectedAmazonFeesPerUnitUsd = estimatedAmazonFeesPerUnitUsd ??
    sum([referralFeePerUnitUsd, fbaFeePerUnitUsd])
  const deliveredUnitCostUsd = sum([unitCostUsd,
    inboundShippingPerUnitUsd, prepCostPerUnitUsd])
  const projectedVariableCostUsd = sum([deliveredUnitCostUsd,
    projectedAmazonFeesPerUnitUsd, otherVariableCostPerUnitUsd])
  const projectedNetProfitPerUnitUsd = expectedSalePriceUsd !== null &&
      projectedVariableCostUsd !== null
    ? Number((expectedSalePriceUsd - projectedVariableCostUsd).toFixed(2))
    : null
  const projectedEconomicsComplete = projectedNetProfitPerUnitUsd !== null
  const contributionAfterAmazonFeesPerUnitUsd = expectedSalePriceUsd !== null &&
      unitCostUsd !== null && projectedAmazonFeesPerUnitUsd !== null
    ? Number((expectedSalePriceUsd - unitCostUsd -
      projectedAmazonFeesPerUnitUsd).toFixed(2)) : null
  const projectedPolicyEvaluation = evaluateSellerOsRoiMarginPolicyV2({
    revenueUsd: expectedSalePriceUsd,
    investmentBase: "AMAZON_INVENTORY_INVESTMENT",
    investmentBaseUsd: deliveredUnitCostUsd,
    costs: [
      { key: "delivered_inventory_cost", amountUsd: deliveredUnitCostUsd,
        authority: "CONFIRMED_SUPPLIER_INBOUND_AND_PREP_COST",
        state: deliveredUnitCostUsd === null ? "UNKNOWN" : "KNOWN" },
      { key: "amazon_fees", amountUsd: projectedAmazonFeesPerUnitUsd,
        authority: estimatedAmazonFeesPerUnitUsd === null
          ? "PROJECTED_OR_ACTUAL_FEES" : "AMAZON_PRODUCT_FEES_ESTIMATE",
        state: projectedAmazonFeesPerUnitUsd === null
          ? "UNKNOWN" : "ESTIMATED" },
      { key: "other_variable_cost", amountUsd: otherVariableCostPerUnitUsd,
        authority: "CONFIRMED_RESERVES_AND_OTHER_COSTS",
        state: otherVariableCostPerUnitUsd === null ? "UNKNOWN" : "KNOWN" },
    ],
  })

  const observationWindowDays = integer(performanceInput.observationWindowDays)
  const unitsPurchased = integer(performanceInput.unitsPurchased)
  const reportedUnitsSold = integer(performanceInput.unitsSold)
  const authoritativeUnitsSold = resultAuthoritative ? reportedUnitsSold : null
  const grossSalesUsd = money(performanceInput.grossSalesUsd)
  const amazonFeesUsd = money(performanceInput.amazonFeesUsd)
  const fulfillmentFeesUsd = money(performanceInput.fulfillmentFeesUsd)
  const refundsUsd = money(performanceInput.refundsUsd)
  const otherActualCostsUsd = money(performanceInput.otherActualCostsUsd)
  const soldInventoryCostUsd = resultAuthoritative &&
      authoritativeUnitsSold !== null && deliveredUnitCostUsd !== null
    ? Number((authoritativeUnitsSold * deliveredUnitCostUsd).toFixed(2)) : null
  const actualTotalCostsUsd = sum([soldInventoryCostUsd, amazonFeesUsd,
    fulfillmentFeesUsd, refundsUsd, otherActualCostsUsd])
  const actualNetProfitUsd = resultAuthoritative && grossSalesUsd !== null &&
      actualTotalCostsUsd !== null
    ? Number((grossSalesUsd - actualTotalCostsUsd).toFixed(2)) : null
  const actualNetProfitPerUnitUsd = actualNetProfitUsd !== null &&
      authoritativeUnitsSold !== null && authoritativeUnitsSold > 0
    ? Number((actualNetProfitUsd / authoritativeUnitsSold).toFixed(2)) : null
  const actualPolicyEvaluation = evaluateSellerOsRoiMarginPolicyV2({
    revenueUsd: grossSalesUsd,
    investmentBase: "AMAZON_INVENTORY_INVESTMENT",
    investmentBaseUsd: soldInventoryCostUsd,
    costs: [
      { key: "sold_inventory_cost", amountUsd: soldInventoryCostUsd,
        authority: "CONFIRMED_SOLD_INVENTORY_COST",
        state: soldInventoryCostUsd === null ? "UNKNOWN" : "KNOWN" },
      { key: "amazon_fees", amountUsd: amazonFeesUsd,
        authority: "AMAZON_FINANCES_ACTUAL", state: amazonFeesUsd === null
          ? "UNKNOWN" : "KNOWN" },
      { key: "fulfillment_fees", amountUsd: fulfillmentFeesUsd,
        authority: "AMAZON_FINANCES_ACTUAL",
        state: fulfillmentFeesUsd === null ? "UNKNOWN" : "KNOWN" },
      { key: "refunds", amountUsd: refundsUsd,
        authority: "AMAZON_FINANCES_ACTUAL", state: refundsUsd === null
          ? "UNKNOWN" : "KNOWN" },
      { key: "other_actual_costs", amountUsd: otherActualCostsUsd,
        authority: "OWNER_OR_FINANCE_ACTUAL",
        state: otherActualCostsUsd === null ? "UNKNOWN" : "KNOWN" },
    ],
  })
  const sellThroughRate = authoritativeUnitsSold !== null &&
      unitsPurchased !== null && unitsPurchased > 0
    ? Number(Math.min(1, authoritativeUnitsSold / unitsPurchased).toFixed(4))
    : null
  const velocityUnitsPerDay = authoritativeUnitsSold !== null &&
      observationWindowDays !== null && observationWindowDays > 0
    ? Number((authoritativeUnitsSold / observationWindowDays).toFixed(4))
    : null
  const daysToFirstSale = (() => {
    const listedAt = iso(listingInput.listedAt)
    const firstSaleAt = iso(performanceInput.firstSaleAt)
    if (!listedAt || !firstSaleAt || Date.parse(firstSaleAt) < Date.parse(listedAt)) {
      return null
    }
    return Number(((Date.parse(firstSaleAt) - Date.parse(listedAt)) /
      86_400_000).toFixed(2))
  })()

  const demandConfirmedByResearch = demandEvidenceState === "CONFIRMED" &&
    demandFreshness === "CURRENT"
  const demandSupported = demandEvidenceState === "SUPPORTED" &&
    demandFreshness === "CURRENT"
  const demandConfirmedByResult = resultAuthoritative &&
    authoritativeUnitsSold !== null && authoritativeUnitsSold > 0 &&
    performanceFreshness === "CURRENT"
  const demandConfirmed = demandConfirmedByResearch || demandConfirmedByResult
  const eligibilityConfirmed = eligibilityState === "CONFIRMED" &&
    eligibilityFreshness === "CURRENT"
  const profitableActual = actualPolicyEvaluation.passesPolicy
  const movementConfirmed = authoritativeUnitsSold !== null &&
    authoritativeUnitsSold > 0
  const winner = resultAuthoritative && demandConfirmed &&
    movementConfirmed && profitableActual
  const resultEvaluated = resultAuthoritative &&
    authoritativeUnitsSold !== null && actualNetProfitUsd !== null &&
    performanceObservedAt !== null && performanceFreshness !== "INVALID_FUTURE"
  const reorderReady = winner && listingState === "ACTIVE" &&
    eligibilityConfirmed && performanceFreshness === "CURRENT"

  const blockers: string[] = []
  if (!asin) blockers.push("AMAZON_ASIN_UNPROVEN")
  if (!eligibilityConfirmed) {
    blockers.push(eligibilityState === "RESTRICTED"
      ? "AMAZON_SELLING_RESTRICTED"
      : eligibilityFreshness === "STALE" ? "AMAZON_ELIGIBILITY_STALE"
        : "AMAZON_ELIGIBILITY_UNPROVEN")
  }
  if (!demandConfirmed) {
    blockers.push(demandFreshness === "STALE" ? "AMAZON_DEMAND_STALE"
      : demandEvidenceState === "CONTRIBUTOR_ASSERTED"
      ? "AMAZON_DEMAND_REQUIRES_INDEPENDENT_CONFIRMATION"
      : demandSupported ? "AMAZON_DEMAND_SUPPORTED_NOT_PROVEN"
        : "AMAZON_DEMAND_UNPROVEN")
  }
  if (deliveredUnitCostUsd === null) blockers.push("DELIVERED_UNIT_COST_UNPROVEN")
  if (!projectedEconomicsComplete) blockers.push("AMAZON_ECONOMICS_INCOMPLETE")
  if (listingState !== "ACTIVE") blockers.push("AMAZON_ACTIVE_LISTING_UNPROVEN")
  if (!resultEvaluated) blockers.push("AMAZON_RESULT_UNPROVEN")
  if (resultEvaluated && performanceFreshness === "STALE") {
    blockers.push("AMAZON_RESULT_STALE_FOR_REORDER")
  }
  if (resultEvaluated && !movementConfirmed) blockers.push("AMAZON_MOVEMENT_NOT_OBSERVED")
  if (actualNetProfitPerUnitUsd !== null && !profitableActual) {
    blockers.push(...actualPolicyEvaluation.blockerCodes)
  }

  let action: AmazonContributorNextActionV1
  let reasonCode: string
  if (!asin) {
    action = "VERIFY_AMAZON_ASIN"; reasonCode = "EXACT_ASIN_REQUIRED"
  } else if (!eligibilityConfirmed) {
    action = "VERIFY_AMAZON_ELIGIBILITY"
    reasonCode = eligibilityState === "RESTRICTED"
      ? "AMAZON_SELLING_RESTRICTION_REQUIRES_REVIEW"
      : eligibilityFreshness === "STALE"
        ? "SELLER_CENTRAL_ELIGIBILITY_REFRESH_REQUIRED"
        : "SELLER_CENTRAL_ELIGIBILITY_REQUIRED"
  } else if (!demandConfirmed) {
    action = "GET_AMAZON_DEMAND"
    reasonCode = demandFreshness === "STALE"
      ? "AMAZON_DEMAND_REFRESH_REQUIRED"
      : demandSupported ? "AMAZON_SALES_RANK_SUPPORTS_DEMAND_BUT_NOT_UNITS"
      : demandEvidenceState === "CONTRIBUTOR_ASSERTED"
      ? "CONTRIBUTOR_DEMAND_CLAIM_REQUIRES_CONFIRMATION"
      : "AMAZON_DEMAND_EVIDENCE_REQUIRED"
  } else if (deliveredUnitCostUsd === null) {
    action = "CAPTURE_DELIVERED_COST"
    reasonCode = "COMPLETE_LANDED_COST_REQUIRED"
  } else if (!projectedEconomicsComplete) {
    action = "COMPLETE_AMAZON_ECONOMICS"
    reasonCode = "AMAZON_FEES_AND_PRICE_REQUIRED"
  } else if (listingState !== "ACTIVE") {
    action = "CAPTURE_AMAZON_LISTING_READBACK"
    reasonCode = "ACTIVE_AMAZON_LISTING_READBACK_REQUIRED"
  } else if (!resultEvaluated) {
    action = "MEASURE_RESULT"
    reasonCode = "SELLER_CENTRAL_RESULT_REQUIRED"
  } else if (performanceFreshness === "STALE") {
    action = "MEASURE_RESULT"
    reasonCode = "FRESH_SELLER_CENTRAL_RESULT_REQUIRED_FOR_REORDER"
  } else if (reorderReady) {
    action = "REVIEW_REORDER"
    reasonCode = "PROFITABLE_MOVEMENT_CONFIRMED"
  } else {
    action = "REVIEW_REJECTION"
    reasonCode = profitableActual
      ? "MOVEMENT_OR_DEMAND_NOT_CONFIRMED"
      : actualPolicyEvaluation.blockerCodes[0] ?? "ROI_MARGIN_POLICY_NOT_MET"
  }

  const lifecycleStage = resultEvaluated ? "RESULT"
    : listingState === "ACTIVE" ? "PUBLISHED"
      : listingState === "DRAFT" ? "LISTING_READY"
        : projectedEconomicsComplete ? "ECONOMICS"
          : demandConfirmed ? "DEMAND_PROVEN"
            : demandEvidenceState === "CONTRIBUTOR_ASSERTED"
              ? "DEMAND_SUPPORTED" : "DISCOVERED"
  const skillOutcome = winner ? "WINNER"
    : resultEvaluated ? "NOT_WINNER"
      : listingState === "ACTIVE" ? "PENDING_RESULT" : "PENDING_EVIDENCE"
  const reorderDecision = reorderReady ? "REVIEW_REORDER"
    : resultEvaluated && (!movementConfirmed || !profitableActual)
      ? "DO_NOT_REORDER" : "UNPROVEN"
  const eventType = reorderReady ? "amazon_reorder_review_ready"
    : resultEvaluated ? "amazon_result_observed"
      : listingState !== "NOT_LISTED" ? "amazon_listing_observed"
        : "collaborator_product_submitted"

  const withoutDigest = {
    contractVersion: SELLER_OS_AMAZON_CONTRIBUTOR_PERFORMANCE_V1,
    contributor: { key: SELLER_OS_CONNIE_COLLABORATOR_KEY_V1,
      displayName: "Connie G. Yape", operatingRole: "AMAZON_STORE_OPERATOR",
      sellerCentralProductUploadAccessDeclaredByOwner: true },
    capture: { mode: oneOf(captureInput.mode,
      ["MANUAL_OWNER", "AMAZON_SP_API_READ_ONLY"] as const, "MANUAL_OWNER"),
      authority: text(captureInput.authority, 120),
      automated: captureInput.automated === true,
      listingApi: text(captureInput.listingApi, 160),
      demandReport: text(captureInput.demandReport, 160),
      financeApi: text(captureInput.financeApi, 160),
      pricingApi: text(captureInput.pricingApi, 160),
      catalogApi: text(captureInput.catalogApi, 160),
      feeEstimateApi: text(captureInput.feeEstimateApi, 160),
      reportStatus: text(captureInput.reportStatus, 120),
      financeStatus: text(captureInput.financeStatus, 120),
      pricingStatus: text(captureInput.pricingStatus, 120),
      catalogStatus: text(captureInput.catalogStatus, 120),
      feeEstimateStatus: text(captureInput.feeEstimateStatus, 120),
      reportWindowStart: iso(captureInput.reportWindowStart),
      reportWindowEnd: iso(captureInput.reportWindowEnd),
      amazonDoesNotExposeListingCreator:
        captureInput.amazonDoesNotExposeListingCreator === true,
      attributionBasis: text(captureInput.attributionBasis, 80) },
    supplier: { sourceKey: canonicalSourceKey,
      name: supplierName, baseUrl: supplierBaseUrl,
      productId: supplierProductId, variantId: supplierVariantId,
      sku: supplierSku, productUrl: supplierProductUrl,
      inventoryQuantity: supplierInventoryQuantity,
      evidenceBasis: text(supplierInput.evidenceBasis, 160),
      ownerConfirmedAt: iso(supplierInput.ownerConfirmedAt),
      evidenceState: oneOf(supplierInput.evidenceState,
        ["CONFIRMED", "UNPROVEN"] as const, "CONFIRMED") },
    product: { title, brand: text(productInput.brand, 160),
      category: text(productInput.category, 160), asin, upc,
      condition: text(productInput.condition, 80),
      handle: productHandle(asin, supplierSku) },
    demand: { claim: demandClaim, evidenceState: demandEvidenceState,
      source: text(demandInput.source, 120),
      observedAt: demandObservedAt, freshness: demandFreshness,
      notes: text(demandInput.notes, 2_000),
      confirmed: demandConfirmed,
      supported: demandSupported || demandConfirmed,
      displayGroupRank: integer(demandInput.displayGroupRank),
      displayGroupTitle: text(demandInput.displayGroupTitle, 200),
      classificationRank: integer(demandInput.classificationRank),
      classificationTitle: text(demandInput.classificationTitle, 200),
      confirmationBasis: demandConfirmedByResult
        ? "SELLER_CENTRAL_RESULT" : demandConfirmedByResearch
          ? "INDEPENDENT_RESEARCH" : "UNPROVEN",
      contributorClaimNotMarketplaceProof: true },
    eligibility: { state: eligibilityState,
      observedAt: eligibilityObservedAt, freshness: eligibilityFreshness,
      confirmed: eligibilityConfirmed },
    amazonMarket: {
      featuredOfferState: oneOf(marketInput.featuredOfferState,
        ["AVAILABLE", "NO_FEATURED_OFFER", "UNAVAILABLE"] as const,
        "UNAVAILABLE"),
      featuredOfferPriceUsd, featuredOfferPriceMaximumUsd,
      featuredOfferListingPriceUsd: money(
        marketInput.featuredOfferListingPriceUsd),
      featuredOfferShippingUsd: money(marketInput.featuredOfferShippingUsd),
      featuredOfferFulfillmentChannel: optionalOneOf(
        marketInput.featuredOfferFulfillmentChannel,
        ["FBA", "FBM"] as const),
      featuredOfferCount: integer(marketInput.featuredOfferCount),
      observedAt: featuredOfferObservedAt,
      freshness: featuredOfferFreshness,
      authority: text(marketInput.authority, 160),
      regionalPriceMayVary: featuredOfferPriceUsd !== null &&
        featuredOfferPriceMaximumUsd !== null &&
        featuredOfferPriceUsd !== featuredOfferPriceMaximumUsd,
    },
    economics: { unitCostUsd, inboundShippingPerUnitUsd,
      prepCostPerUnitUsd, deliveredUnitCostUsd, expectedSalePriceUsd,
      referralFeePerUnitUsd, fbaFeePerUnitUsd, otherVariableCostPerUnitUsd,
      estimatedAmazonFeesPerUnitUsd, projectedAmazonFeesPerUnitUsd,
      feeEstimateState: oneOf(economicsInput.feeEstimateState,
        ["AVAILABLE", "UNAVAILABLE"] as const, "UNAVAILABLE"),
      feeEstimateObservedAt, feeEstimateFreshness,
      feeEstimatePriceUsd: money(economicsInput.feeEstimatePriceUsd),
      feeEstimateFulfillmentChannel: optionalOneOf(
        economicsInput.feeEstimateFulfillmentChannel,
        ["FBA", "FBM"] as const),
      feeEstimateAuthority: text(economicsInput.feeEstimateAuthority, 160),
      contributionAfterAmazonFeesPerUnitUsd,
      projectedNetProfitPerUnitUsd, complete: projectedEconomicsComplete,
      contributionMarginPercent:
        projectedPolicyEvaluation.contributionMarginPercent,
      estimatedRoiPercent: projectedPolicyEvaluation.estimatedRoiPercent,
      investmentBase: projectedPolicyEvaluation.investmentBase,
      investmentBaseUsd: projectedPolicyEvaluation.investmentBaseUsd,
      policyEvaluation: projectedPolicyEvaluation },
    amazonListing: { state: listingState,
      sellerSku: text(listingInput.sellerSku, 160),
      listingPriceUsd: money(listingInput.listingPriceUsd),
      availableQuantity: integer(listingInput.availableQuantity),
      fulfillmentChannel: optionalOneOf(listingInput.fulfillmentChannel,
        ["FBA", "FBM"] as const),
      listedAt: iso(listingInput.listedAt),
      lastUpdatedAt: iso(listingInput.lastUpdatedAt) },
    performance: { authority: resultAuthority,
      authoritative: resultAuthoritative,
      observationWindowDays, unitsPurchased,
      reportedUnitsSold, observedUnitsSold: authoritativeUnitsSold,
      grossSalesUsd, amazonFeesUsd, fulfillmentFeesUsd, refundsUsd,
      otherActualCostsUsd, soldInventoryCostUsd, actualTotalCostsUsd,
      actualNetProfitUsd, actualNetProfitPerUnitUsd, sellThroughRate,
      contributionMarginPercent:
        actualPolicyEvaluation.contributionMarginPercent,
      estimatedRoiPercent: actualPolicyEvaluation.estimatedRoiPercent,
      investmentBase: actualPolicyEvaluation.investmentBase,
      investmentBaseUsd: actualPolicyEvaluation.investmentBaseUsd,
      policyEvaluation: actualPolicyEvaluation,
      velocityUnitsPerDay, firstSaleAt: iso(performanceInput.firstSaleAt),
      daysToFirstSale, observedAt: performanceObservedAt,
      sessions: integer(performanceInput.sessions),
      pageViews: integer(performanceInput.pageViews),
      unitSessionPercentage: money(performanceInput.unitSessionPercentage),
      financeMatchState: text(performanceInput.financeMatchState, 120),
      freshness: performanceFreshness,
      falseZeroGuard: reportedUnitsSold === 0 && !resultAuthoritative
        ? "ZERO_NOT_ACCEPTED_WITHOUT_AUTHORITY" : "PASS" },
    outcome: { skillOutcome, reorderDecision,
      winnerDefinition:
        "CONFIRMED_DEMAND_AND_MOVEMENT_AND_ROI_30_AND_CONTRIBUTION_MARGIN_15",
      automaticReorderAllowed: false },
    lifecycleStage,
    nextBestEvidence: { action, priority: 1, reasonCode,
      inventedEvidence: false },
    blockers,
    eventType,
    observedAt,
    safety: { internalDatabaseWrites: true, supplierPurchases: 0,
      marketplaceWrites: 0, publications: 0, repricing: 0,
      credentialsStored: false, personalContactDataStored: false },
  }
  const observationDigest = digest(withoutDigest)
  return Object.freeze({ ...withoutDigest, observationDigest,
    idempotencyKey: `amazon-contributor-observation:${observationDigest}` })
}

export function linkAmazonContributorSupplierCostV1(input: {
  existingObservation: unknown
  supplier: unknown
  economics: unknown
  unitsPurchased?: unknown
  otherActualCostsUsd?: unknown
  now?: Date
}) {
  const existing = record(input.existingObservation)
  const priorSupplier = record(existing.supplier)
  const supplier = record(input.supplier)
  const priorEconomics = record(existing.economics)
  const economics = record(input.economics)
  const performance = record(existing.performance)
  return buildAmazonContributorObservationV1({
    observedAt: (input.now ?? new Date()).toISOString(),
    capture: { ...record(existing.capture), mode: "MANUAL_OWNER",
      automated: false, supplierCostLinked: true },
    supplier: { ...priorSupplier, ...supplier,
      sourceKeyOverride: text(priorSupplier.sourceKey, 80) ??
        "amazon-connie-products",
      productId: text(supplier.productId, 240) ??
        text(priorSupplier.productId, 240) ?? text(supplier.sku, 240),
      variantId: text(supplier.variantId, 240) ??
        text(supplier.sku, 240), evidenceState: "CONFIRMED" },
    product: existing.product,
    demand: existing.demand,
    eligibility: existing.eligibility,
    amazonMarket: existing.amazonMarket,
    economics: { ...priorEconomics, ...economics },
    amazonListing: existing.amazonListing,
    performance: { authority: performance.authority,
      observationWindowDays: performance.observationWindowDays,
      unitsPurchased: input.unitsPurchased ?? performance.unitsPurchased,
      unitsSold: performance.reportedUnitsSold,
      grossSalesUsd: performance.grossSalesUsd,
      amazonFeesUsd: performance.amazonFeesUsd,
      fulfillmentFeesUsd: performance.fulfillmentFeesUsd,
      refundsUsd: performance.refundsUsd,
      otherActualCostsUsd: input.otherActualCostsUsd ??
        performance.otherActualCostsUsd,
      firstSaleAt: performance.firstSaleAt,
      observedAt: performance.observedAt,
      sessions: performance.sessions, pageViews: performance.pageViews,
      unitSessionPercentage: performance.unitSessionPercentage,
      financeMatchState: performance.financeMatchState },
  }, { now: input.now })
}

export function linkAmazonContributorCostAndQuantityV1(input: {
  existingObservation: unknown
  unitCostUsd: unknown
  supplierInventoryQuantity: unknown
  now?: Date
}) {
  const existing = record(input.existingObservation)
  const priorSupplier = record(existing.supplier)
  const unitCostUsd = money(input.unitCostUsd)
  const supplierInventoryQuantity = integer(input.supplierInventoryQuantity)
  if (unitCostUsd === null || unitCostUsd <= 0) {
    throw new Error("SELLER_OS_AMAZON_UNIT_COST_REQUIRED")
  }
  if (supplierInventoryQuantity === null || supplierInventoryQuantity <= 0) {
    throw new Error("SELLER_OS_AMAZON_SUPPLIER_QUANTITY_REQUIRED")
  }
  const now = input.now ?? new Date()
  const priorName = text(priorSupplier.name, 160)
  return linkAmazonContributorSupplierCostV1({
    existingObservation: existing,
    supplier: { name: priorName && !/pendiente de vincular/i.test(priorName)
        ? priorName : "Proveedor de Connie",
      baseUrl: safeHttps(priorSupplier.baseUrl) ??
        "https://sellercentral.amazon.com",
      sku: text(priorSupplier.sku, 240) ??
        text(record(existing.amazonListing).sellerSku, 160),
      productId: text(priorSupplier.productId, 240),
      variantId: text(priorSupplier.variantId, 240),
      productUrl: safeHttps(priorSupplier.productUrl),
      inventoryQuantity: supplierInventoryQuantity,
      evidenceBasis: "OWNER_COST_AND_QUANTITY_CONFIRMATION",
      ownerConfirmedAt: now.toISOString() },
    economics: { unitCostUsd }, now,
  })
}

export async function persistAmazonContributorObservationV1(input: {
  supabase: SupabaseClient
  recordedByUserId: string | null
  observation: ReturnType<typeof buildAmazonContributorObservationV1>
}) {
  const write = await input.supabase.rpc(
    "put_seller_os_amazon_contributor_observation_v1", {
      p_observation: input.observation,
      p_recorded_by_user_id: input.recordedByUserId,
    })
  if (write.error || !write.data) {
    throw new Error("SELLER_OS_AMAZON_CONTRIBUTOR_WRITE_FAILED")
  }
  const receipt = record(write.data)
  if (receipt.observationDigest !== input.observation.observationDigest ||
      receipt.readbackVerified !== true) {
    throw new Error("SELLER_OS_AMAZON_CONTRIBUTOR_READBACK_FAILED")
  }
  return Object.freeze(receipt)
}

export async function readAmazonContributorPerformanceV1(input: {
  supabase: SupabaseClient
  limit?: number
  now?: Date
}) {
  const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 50)))
  const collaborator = await input.supabase
    .from("seller_os_sourcing_collaborators_v1")
    .select("id,collaborator_key,display_name,operating_role,status,marketplaces,declared_capabilities,evidence_policy,updated_at")
    .eq("collaborator_key", SELLER_OS_CONNIE_COLLABORATOR_KEY_V1)
    .limit(1).maybeSingle()
  if (collaborator.error || !collaborator.data) {
    throw new Error("SELLER_OS_AMAZON_CONTRIBUTOR_PROFILE_UNAVAILABLE")
  }
  const [products, syncState, attribution] = await Promise.all([
    input.supabase.from("market_radar_products")
      .select("id,source_id,supplier_product_id,title,vendor,product_type,product_url,last_snapshot_at,metadata")
      .eq("sourcing_collaborator_id", collaborator.data.id)
      .order("last_snapshot_at", { ascending: false }).limit(limit),
    input.supabase.from("seller_os_amazon_contributor_sync_state_v1")
      .select("marketplace_id,seller_sku_prefix,connection_status,run_status,last_attempt_at,last_success_at,last_listing_sync_at,last_finance_sync_at,last_report_requested_at,last_report_completed_at,pending_report_id,report_window_start,report_window_end,last_error_code,listings_seen,listings_attributed,observations_written,metadata,updated_at")
      .eq("collaborator_id", collaborator.data.id)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    input.supabase.from("seller_os_amazon_contributor_sku_attribution_v1")
      .select("id,marketplace_id,seller_sku,asin,attribution_basis,status,title,listing_state,first_observed_at,last_observed_at,listing_price_usd,listing_available_quantity,listing_fulfillment_channel,featured_offer_state,featured_offer_price_usd,featured_offer_listing_price_usd,featured_offer_shipping_usd,featured_offer_fulfillment_channel,featured_offer_count,pricing_observed_at,pricing_authority,estimated_amazon_fees_usd,fee_estimate_state,fee_estimate_observed_at,fee_estimate_price_usd,fee_estimate_fulfillment_channel,fee_estimate_authority,demand_signal_state,display_group_rank,display_group_title,classification_rank,classification_title,catalog_observed_at,catalog_authority,seller_units_ordered_30d,seller_sales_30d_state,seller_sales_window_start,seller_sales_window_end,seller_sales_authority,market_monthly_sold_estimate,market_sales_rank_drops_30,market_sales_rank_drops_90,market_sales_rank_drops_180,market_demand_estimate_state,market_demand_estimate_method,market_demand_observed_at,market_demand_authority")
      .eq("collaborator_id", collaborator.data.id)
      .order("last_observed_at", { ascending: false }).limit(100),
  ])
  if (products.error || syncState.error || attribution.error) {
    throw new Error("SELLER_OS_AMAZON_CONTRIBUTOR_PRODUCTS_READ_FAILED")
  }
  const productRows = products.data ?? []
  const productIds = productRows.map((row) => String(row.id))
  const sourceIds = [...new Set(productRows.map((row) => String(row.source_id)))]
  const [sources, snapshots] = await Promise.all([
    sourceIds.length ? input.supabase.from("market_radar_sources")
      .select("id,key,name,base_url,sourcing_metadata")
      .in("id", sourceIds) : Promise.resolve({ data: [], error: null }),
    productIds.length ? input.supabase.from("market_radar_snapshots")
      .select("id,product_id,captured_at,raw")
      .in("product_id", productIds)
      .order("captured_at", { ascending: false }).limit(limit * 10)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (sources.error || snapshots.error) {
    throw new Error("SELLER_OS_AMAZON_CONTRIBUTOR_EVIDENCE_READ_FAILED")
  }
  const sourceById = new Map((sources.data ?? []).map((row) =>
    [String(row.id), row]))
  const latestByProduct = new Map<string, Json>()
  for (const row of snapshots.data ?? []) {
    const productId = String(row.product_id)
    if (!latestByProduct.has(productId)) latestByProduct.set(productId, row)
  }
  const cards = productRows.flatMap((product) => {
    const snapshot = latestByProduct.get(String(product.id))
    const observation = record(record(snapshot?.raw).contributorObservation)
    if (!observation.contractVersion) return []
    return [{ id: product.id, title: product.title, brand: product.vendor,
      category: product.product_type, productUrl: product.product_url,
      supplier: sourceById.get(String(product.source_id)) ?? null,
      snapshotId: snapshot?.id ?? null,
      capturedAt: snapshot?.captured_at ?? product.last_snapshot_at,
      observation, purchaseGate: buildSellerOsAmazonPurchaseGateV1({
        observation, now: input.now,
      }) }]
  })
  const outcome = (card: (typeof cards)[number]) => record(card.observation.outcome)
  const performance = (card: (typeof cards)[number]) =>
    record(card.observation.performance)
  const demand = (card: (typeof cards)[number]) => record(card.observation.demand)
  const listing = (card: (typeof cards)[number]) =>
    record(card.observation.amazonListing)
  const purchaseDecision = (card: (typeof cards)[number]) =>
    card.purchaseGate.decision
  const evaluated = cards.filter((card) => performance(card).authoritative === true &&
    performance(card).actualNetProfitUsd !== null &&
    performance(card).actualNetProfitUsd !== undefined)
  const winners = evaluated.filter((card) => outcome(card).skillOutcome === "WINNER")
  const knownProfit = evaluated.reduce((total, card) => total +
    Number(performance(card).actualNetProfitUsd ?? 0), 0)
  const fastestMovement = cards.filter((card) =>
    typeof performance(card).velocityUnitsPerDay === "number")
    .sort((left, right) => Number(performance(right).velocityUnitsPerDay) -
      Number(performance(left).velocityUnitsPerDay)).slice(0, 10)
  return Object.freeze({
    contractVersion: SELLER_OS_AMAZON_CONTRIBUTOR_PERFORMANCE_V1,
    collaborator: collaborator.data,
    automation: { sync: syncState.data ?? null,
      attributedSellerSkus: (attribution.data ?? [])
        .filter((row) => row.status === "ACTIVE").length,
      pendingProposalCandidates: (attribution.data ?? [])
        .filter((row) => row.status === "PENDING_REVIEW").length,
      creatorAttributionRule: "SELLER_SKU_PREFIX_OR_OWNER_CONFIRMED",
      amazonExposesListingCreator: false,
      credentialsIncluded: false },
    proposalInbox: (attribution.data ?? []).filter((row) =>
      row.status === "PENDING_REVIEW"),
    summary: {
      productsProposed: cards.length,
      demandConfirmed: cards.filter((card) => demand(card).confirmed === true).length,
      activeListings: cards.filter((card) => listing(card).state === "ACTIVE").length,
      resultsEvaluated: evaluated.length,
      winners: winners.length,
      winnerRate: evaluated.length > 0
        ? Number((winners.length / evaluated.length).toFixed(4)) : null,
      realizedNetProfitUsd: evaluated.length > 0
        ? Number(knownProfit.toFixed(2)) : null,
      reorderReviewReady: cards.filter((card) =>
        outcome(card).reorderDecision === "REVIEW_REORDER").length,
      purchaseGate: {
        buy: cards.filter((card) => purchaseDecision(card) === "BUY").length,
        smallTest: cards.filter((card) =>
          purchaseDecision(card) === "SMALL_TEST").length,
        wait: cards.filter((card) => purchaseDecision(card) === "WAIT").length,
        reject: cards.filter((card) =>
          purchaseDecision(card) === "REJECT").length,
      },
      evidenceCoverage: cards.length > 0
        ? Number((evaluated.length / cards.length).toFixed(4)) : null,
    },
    cards,
    fastestMovement,
    interpretation: {
      contributorClaimsAreMarketplaceProof: false,
      winnerRequiresConfirmedDemandMovementAndRoiMarginPolicy: true,
      economicPolicy: sellerOsRoiMarginPolicyContractV2(),
      zeroWithoutAuthorityRemainsUnknown: true,
      reorderIsReviewOnly: true,
      purchaseGateContractVersion: SELLER_OS_AMAZON_PURCHASE_GATE_V1,
      purchaseGateNeverBuysAutomatically: true,
    },
    safety: { readOnly: true, marketplaceWrites: 0, supplierPurchases: 0,
      publications: 0, repricing: 0, credentialsIncluded: false,
      personalContactDataIncluded: false },
  })
}
