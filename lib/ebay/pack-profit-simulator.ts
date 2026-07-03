type PackProfitInput = {
  packSize?: number | string | null
  unitCost?: number | string | null
  packingFee?: number | string | null
  shippingEstimate?: number | string | null
  ebayFeeEstimate?: number | string | null
  targetSellPrice?: number | string | null
  minNetMarginPercent?: number | string | null
  returnsReserve?: number | string | null
  stockQuantity?: number | string | null
}

type PackSimulationStatus =
  | "PACKING_FEE_REQUIRED"
  | "PACK_REVIEW_REQUIRED"
  | "PACK_MARGIN_READY"
  | "PACK_NOT_PROFITABLE"
  | "PACK_CANDIDATE_FOR_LISTING"

function toRecord(
  input: unknown
): Record<string, unknown> {
  return input &&
    typeof input === "object"
    ? input as Record<string, unknown>
    : {}
}

function toNumber(
  value: unknown
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null
  }

  const numericValue =
    Number(value)

  return Number.isFinite(numericValue)
    ? numericValue
    : null
}

function roundMoney(
  value: number
) {
  return Math.round(value * 100) / 100
}

function normalizePackInput(
  input: unknown
): PackProfitInput {
  const record =
    toRecord(input)

  return {
    packSize:
      record.packSize as PackProfitInput["packSize"],
    unitCost:
      record.unitCost as PackProfitInput["unitCost"],
    packingFee:
      record.packingFee as PackProfitInput["packingFee"],
    shippingEstimate:
      record.shippingEstimate as PackProfitInput["shippingEstimate"],
    ebayFeeEstimate:
      record.ebayFeeEstimate as PackProfitInput["ebayFeeEstimate"],
    targetSellPrice:
      record.targetSellPrice as PackProfitInput["targetSellPrice"],
    minNetMarginPercent:
      record.minNetMarginPercent as PackProfitInput["minNetMarginPercent"],
    returnsReserve:
      record.returnsReserve as PackProfitInput["returnsReserve"],
    stockQuantity:
      record.stockQuantity as PackProfitInput["stockQuantity"],
  }
}

export function getRequiredPackFields(
  input: unknown
) {
  const pack =
    normalizePackInput(input)
  const missingFields: string[] = []

  if (toNumber(pack.packSize) === null) {
    missingFields.push("packSize")
  }

  if (toNumber(pack.unitCost) === null) {
    missingFields.push("unitCost")
  }

  if (toNumber(pack.packingFee) === null) {
    missingFields.push("packingFee")
  }

  if (toNumber(pack.shippingEstimate) === null) {
    missingFields.push("shippingEstimate")
  }

  if (toNumber(pack.ebayFeeEstimate) === null) {
    missingFields.push("ebayFeeEstimate")
  }

  if (toNumber(pack.targetSellPrice) === null) {
    missingFields.push("targetSellPrice")
  }

  return missingFields
}

export function getPackSimulationStatus(
  input: unknown
): PackSimulationStatus {
  const missingFields =
    getRequiredPackFields(input)

  if (missingFields.includes("packingFee")) {
    return "PACKING_FEE_REQUIRED"
  }

  if (missingFields.length > 0) {
    return "PACK_REVIEW_REQUIRED"
  }

  const result =
    simulatePackProfit(input)

  return result.canAdvanceToListing
    ? "PACK_CANDIDATE_FOR_LISTING"
    : "PACK_NOT_PROFITABLE"
}

export function simulatePackProfit(
  input: unknown
) {
  const pack =
    normalizePackInput(input)
  const packSize =
    toNumber(pack.packSize)
  const unitCost =
    toNumber(pack.unitCost)
  const packingFee =
    toNumber(pack.packingFee)
  const shippingEstimate =
    toNumber(pack.shippingEstimate)
  const ebayFeeEstimate =
    toNumber(pack.ebayFeeEstimate)
  const targetSellPrice =
    toNumber(pack.targetSellPrice)
  const minNetMarginPercent =
    toNumber(pack.minNetMarginPercent) ?? 10
  const returnsReserve =
    toNumber(pack.returnsReserve) ?? 0
  const stockQuantity =
    toNumber(pack.stockQuantity)
  const missingFields =
    getRequiredPackFields(pack)

  if (missingFields.includes("packingFee")) {
    return {
      status:
        "PACKING_FEE_REQUIRED" as PackSimulationStatus,
      canAdvanceToListing:
        false,
      missingFields,
      packSize,
      reason:
        "Luna Portex packing fee must be confirmed before pack margin can be evaluated.",
    }
  }

  if (missingFields.length > 0) {
    return {
      status:
        "PACK_REVIEW_REQUIRED" as PackSimulationStatus,
      canAdvanceToListing:
        false,
      missingFields,
      packSize,
      reason:
        "Pack size, unit cost, packing fee, shipping, eBay fees and target sell price are required.",
    }
  }

  const productCost =
    roundMoney((unitCost || 0) * (packSize || 0))
  const totalCost =
    roundMoney(
      productCost +
        (packingFee || 0) +
        (shippingEstimate || 0) +
        (ebayFeeEstimate || 0) +
        returnsReserve
    )
  const netProfit =
    roundMoney((targetSellPrice || 0) - totalCost)
  const netMarginPercent =
    targetSellPrice && targetSellPrice > 0
      ? roundMoney((netProfit / targetSellPrice) * 100)
      : 0
  const canAdvanceToListing =
    netProfit > 0 &&
    netMarginPercent >= minNetMarginPercent

  return {
    status:
      canAdvanceToListing
        ? "PACK_CANDIDATE_FOR_LISTING"
        : "PACK_NOT_PROFITABLE",
    canAdvanceToListing,
    missingFields,
    packSize,
    productCost,
    packingFee,
    shippingEstimate,
    ebayFeeEstimate,
      returnsReserve,
      stockQuantity,
      totalCost,
      targetSellPrice,
      netProfit,
      netMarginPercent,
    minNetMarginPercent,
    reason:
      canAdvanceToListing
        ? "Pack passes margin gate and can move to internal Listing review as a pack."
        : "Pack does not pass margin gate.",
  }
}

export function simulatePackOptions(
  input: unknown
) {
  const record =
    toRecord(input)

  return [3, 6, 12].map(packSize =>
    simulatePackProfit({
      ...record,
      packSize,
      packingFee:
        record[`packingFeePack${packSize}`] ??
        record.packingFee,
    })
  )
}

export function buildMultiPackListingStrategy(
  input: unknown
) {
  const record =
    toRecord(input)
  const stockQuantity =
    toNumber(record.stockQuantity)
  const packOptions =
    simulatePackOptions(input)
  const candidateListings =
    packOptions
      .filter(option =>
        option.canAdvanceToListing &&
        (
          stockQuantity === null ||
          stockQuantity >= (option.packSize || 0)
        )
      )
      .map(option => ({
        listingFormat:
          `PACK_X${option.packSize}`,
        packSize:
          option.packSize,
        status:
          "PACK_CANDIDATE_FOR_LISTING",
        canPrepareListing:
          true,
        mustPrepareAsPack:
          true,
        unitListing:
          false,
        netProfit:
          option.netProfit,
        netMarginPercent:
          option.netMarginPercent,
      }))
  const blockedPackOptions =
    packOptions.filter(option =>
      !candidateListings.some(candidate =>
        candidate.packSize === option.packSize
      )
    )

  return {
    strategyStatus:
      candidateListings.length > 1
        ? "MULTI_PACK_LISTING_STRATEGY_AVAILABLE"
        : candidateListings.length === 1
        ? "SINGLE_PACK_LISTING_CANDIDATE_AVAILABLE"
        : "PACK_REVIEW_REQUIRED",
    canCreateMultiplePackListingCandidates:
      candidateListings.length > 1,
    listingVariantsAreSeparateOffers:
      true,
    unitListingAllowed:
      false,
    listingMustUsePackPresentation:
      true,
    stockQuantity,
    candidateListings,
    blockedPackOptions,
    safetyRule:
      "Multiple pack listings are internal candidates only. Each pack must pass stock, packing fee, shipping, eBay fees, target price, margin and review gates.",
  }
}

export function getBlockedPackSimulationResponse() {
  return {
    status:
      "PACKING_FEE_REQUIRED",
    canAdvanceToListing:
      false,
    draftImpact:
      "DO_NOT_CREATE_EBAY_DRAFT",
    publicationImpact:
      "DO_NOT_PUBLISH",
    reason:
      "Pack simulation is internal only. Packing fee, shipping, fees, target price and margin must be confirmed first.",
  }
}
