export type EbayUnitEconomicsConfig = {
  estimatedEbayFeeRate: number
  fixedOrderFee: number
  estimatedOutboundShipping: number
  returnsReserveRate: number
  promotedListingsReserveRate: number
  minimumNetProfit: number
  minimumNetMarginPercent: number
  minimumRoiPercent: number
}

export const DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG: EbayUnitEconomicsConfig = {
  estimatedEbayFeeRate: 0.15,
  fixedOrderFee: 0.30,
  estimatedOutboundShipping: 6.99,
  returnsReserveRate: 0.04,
  promotedListingsReserveRate: 0.05,
  minimumNetProfit: 5,
  minimumNetMarginPercent: 20,
  minimumRoiPercent: 30,
}

function finite(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function bounded(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = finite(value)
  return parsed === null
    ? fallback
    : Math.max(minimum, Math.min(maximum, parsed))
}

function money(value: number) {
  return Math.round(value * 100) / 100
}

function minimumMoney(value: number) {
  // A price floor that lands exactly on a cent can otherwise miss its own
  // gate by a floating-point fraction (for example 4.999999999999999 profit).
  // The tiny guard makes that boundary one cent conservative without changing
  // ordinary non-boundary values.
  return Math.ceil((value + 1e-9) * 100) / 100
}

export function normalizeEbayUnitEconomicsConfig(
  input: Partial<EbayUnitEconomicsConfig> = {},
): EbayUnitEconomicsConfig {
  return {
    estimatedEbayFeeRate: bounded(
      input.estimatedEbayFeeRate,
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.estimatedEbayFeeRate,
      0,
      0.50,
    ),
    fixedOrderFee: bounded(
      input.fixedOrderFee,
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.fixedOrderFee,
      0,
      25,
    ),
    estimatedOutboundShipping: bounded(
      input.estimatedOutboundShipping,
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.estimatedOutboundShipping,
      0,
      500,
    ),
    returnsReserveRate: bounded(
      input.returnsReserveRate,
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.returnsReserveRate,
      0,
      0.50,
    ),
    promotedListingsReserveRate: bounded(
      input.promotedListingsReserveRate,
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.promotedListingsReserveRate,
      0,
      0.50,
    ),
    minimumNetProfit: bounded(
      input.minimumNetProfit,
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.minimumNetProfit,
      0,
      10_000,
    ),
    minimumNetMarginPercent: bounded(
      input.minimumNetMarginPercent,
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.minimumNetMarginPercent,
      0,
      95,
    ),
    minimumRoiPercent: bounded(
      input.minimumRoiPercent,
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.minimumRoiPercent,
      0,
      10_000,
    ),
  }
}

export function calculateEbayUnitEconomics(
  input: { salePrice: unknown; supplierCost: unknown },
  overrides: Partial<EbayUnitEconomicsConfig> = {},
) {
  const config = normalizeEbayUnitEconomicsConfig(overrides)
  const salePrice = finite(input.salePrice)
  const supplierCost = finite(input.supplierCost)
  if (salePrice === null || salePrice <= 0 || supplierCost === null || supplierCost < 0) {
    return {
      ready: false as const,
      salePrice,
      supplierCost,
      estimatedEbayFees: null,
      estimatedOutboundShipping: money(config.estimatedOutboundShipping),
      returnsReserve: null,
      promotedListingsReserve: null,
      estimatedNetProfit: null,
      estimatedNetMarginPercent: null,
      estimatedRoiPercent: null,
      minimumProfitablePrice: null,
      passesProfitGate: false,
      config,
      calculationSource: "SERVER_CANONICAL_EBAY_UNIT_ECONOMICS_V1" as const,
    }
  }

  const estimatedEbayFees = salePrice * config.estimatedEbayFeeRate + config.fixedOrderFee
  const returnsReserve = salePrice * config.returnsReserveRate
  const promotedListingsReserve = salePrice * config.promotedListingsReserveRate
  const estimatedNetProfit = salePrice - supplierCost - config.estimatedOutboundShipping -
    estimatedEbayFees - returnsReserve - promotedListingsReserve
  const estimatedNetMarginPercent = (estimatedNetProfit / salePrice) * 100
  const estimatedRoiPercent = supplierCost > 0
    ? (estimatedNetProfit / supplierCost) * 100
    : estimatedNetProfit > 0
      ? Number.POSITIVE_INFINITY
      : 0
  const variableRate = config.estimatedEbayFeeRate + config.returnsReserveRate +
    config.promotedListingsReserveRate
  const minimumProfitablePrice = (
    supplierCost + config.estimatedOutboundShipping + config.fixedOrderFee + config.minimumNetProfit
  ) / Math.max(0.01, 1 - variableRate)
  const passesProfitGate = estimatedNetProfit >= config.minimumNetProfit &&
    estimatedNetMarginPercent >= config.minimumNetMarginPercent &&
    estimatedRoiPercent >= config.minimumRoiPercent

  return {
    ready: true as const,
    salePrice: money(salePrice),
    supplierCost: money(supplierCost),
    estimatedEbayFees: money(estimatedEbayFees),
    estimatedOutboundShipping: money(config.estimatedOutboundShipping),
    returnsReserve: money(returnsReserve),
    promotedListingsReserve: money(promotedListingsReserve),
    estimatedNetProfit: money(estimatedNetProfit),
    estimatedNetMarginPercent: money(estimatedNetMarginPercent),
    estimatedRoiPercent: Number.isFinite(estimatedRoiPercent)
      ? money(estimatedRoiPercent)
      : null,
    minimumProfitablePrice: money(minimumProfitablePrice),
    passesProfitGate,
    config,
    calculationSource: "SERVER_CANONICAL_EBAY_UNIT_ECONOMICS_V1" as const,
  }
}

export function calculateEbayMinimumOperatorPrice(
  input: { supplierCost: unknown },
  overrides: Partial<EbayUnitEconomicsConfig> = {},
) {
  const config = normalizeEbayUnitEconomicsConfig(overrides)
  const supplierCost = finite(input.supplierCost)
  if (supplierCost === null || supplierCost < 0) {
    return {
      ready: false as const,
      supplierCost,
      minimumOperatorPrice: null,
      config,
      calculationSource: "SERVER_OWN_COST_PRICE_FLOOR_V1" as const,
    }
  }

  const variableRate = config.estimatedEbayFeeRate + config.returnsReserveRate +
    config.promotedListingsReserveRate
  const fixedBase = supplierCost + config.estimatedOutboundShipping + config.fixedOrderFee
  const profitFloor = (fixedBase + config.minimumNetProfit) / Math.max(0.01, 1 - variableRate)
  const marginRate = config.minimumNetMarginPercent / 100
  const marginFloor = fixedBase / Math.max(0.01, 1 - variableRate - marginRate)
  const roiRate = config.minimumRoiPercent / 100
  const roiFloor = (supplierCost * (1 + roiRate) + config.estimatedOutboundShipping + config.fixedOrderFee) /
    Math.max(0.01, 1 - variableRate)

  return {
    ready: true as const,
    supplierCost: money(supplierCost),
    minimumOperatorPrice: minimumMoney(Math.max(profitFloor, marginFloor, roiFloor)),
    components: {
      minimumNetProfitPrice: minimumMoney(profitFloor),
      minimumNetMarginPrice: minimumMoney(marginFloor),
      minimumRoiPrice: minimumMoney(roiFloor),
    },
    config,
    calculationSource: "SERVER_OWN_COST_PRICE_FLOOR_V1" as const,
  }
}
