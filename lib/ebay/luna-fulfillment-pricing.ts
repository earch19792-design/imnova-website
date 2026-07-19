import type { EbayUnitEconomicsConfig } from "./ebay-unit-economics"

export const LUNA_FULFILLMENT_RATE_CARD_VERSION =
  "LUNA_PORTEX_OPERATOR_CONFIRMED_2026_07_18_V1"

export const LUNA_PACK_DISCOUNT_SCENARIO_VERSION =
  "LUNA_PACK_DISCOUNT_SCENARIO_V1"

const PACK_SCENARIO_DEFAULT_ECONOMICS_CONFIG: EbayUnitEconomicsConfig = {
  estimatedEbayFeeRate: .153,
  fixedOrderFee: .4,
  estimatedOutboundShipping: 0,
  returnsReserveRate: .04,
  promotedListingsReserveRate: .05,
  minimumNetProfit: 5,
  minimumNetMarginPercent: 20,
  minimumRoiPercent: 30,
}

export type LunaFulfillmentSource =
  | "LUNA_NATIVE_PRESENTATION"
  | "LUNA_CUSTOM_PRESENTATION"
  | "EXTERNAL_WHOLESALER_VIA_LUNA"

export type LunaPackagingType = "POLYBAG" | "BOX" | "UNKNOWN"
export type LunaPackagingMaterial =
  | "NONE_CONFIRMED"
  | "POLY_MAILER"
  | "SMALL_BOX"
  | "MEDIUM_BOX"
  | "LARGE_BOX"
  | "UNKNOWN"

export type LunaFulfillmentQuoteStatus =
  | "CONTRACT_RATE_READY"
  | "CONSERVATIVE_RANGE_ONLY"
  | "QUOTE_REQUIRED"
  | "MISSING_BLOCKING"

type CostLine = {
  key: string
  label: string
  amountUsd: number | null
  minimumUsd: number | null
  maximumUsd: number | null
  verificationStatus: "VERIFIED" | "DERIVED_VERIFIED" | "ESTIMATED_INTERNAL" | "MISSING"
  source: "LUNA_CONTRACT_RATE_CARD" | "OPERATOR_CONFIRMED" | "DERIVED"
}

const PREPARATION_RATES = Object.freeze({
  POLYBAG: [
    { maximumUnits: 4, amountUsd: 1 },
    { maximumUnits: 8, amountUsd: 1.25 },
    { maximumUnits: 12, amountUsd: 1.5 },
    { maximumUnits: 24, amountUsd: 2 },
    { maximumUnits: 50, amountUsd: 3 },
  ],
  BOX: [
    { maximumUnits: 4, amountUsd: 1.5 },
    { maximumUnits: 8, amountUsd: 2 },
    { maximumUnits: 12, amountUsd: 2.5 },
    { maximumUnits: 24, amountUsd: 3 },
    { maximumUnits: 50, amountUsd: 4 },
  ],
})

const MATERIAL_RATES = Object.freeze({
  NONE_CONFIRMED: 0,
  POLY_MAILER: .5,
  SMALL_BOX: 2,
  MEDIUM_BOX: 3,
  LARGE_BOX: 4,
})

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function positiveInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function nonNegativeInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0
}

function nonNegativeMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? money(parsed) : null
}

function boundedPercent(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 50
    ? Math.round(parsed * 100) / 100
    : null
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, parsed))
    : fallback
}

function calculatePackScenarioEconomics(
  salePrice: number,
  exactPackCostUsd: number,
  overrides: Partial<EbayUnitEconomicsConfig> = {},
) {
  const config: EbayUnitEconomicsConfig = {
    estimatedEbayFeeRate: boundedNumber(overrides.estimatedEbayFeeRate,
      PACK_SCENARIO_DEFAULT_ECONOMICS_CONFIG.estimatedEbayFeeRate, 0, .5),
    fixedOrderFee: boundedNumber(overrides.fixedOrderFee,
      PACK_SCENARIO_DEFAULT_ECONOMICS_CONFIG.fixedOrderFee, 0, 25),
    // quoteLunaFulfillment already contains outbound shipping.
    estimatedOutboundShipping: 0,
    returnsReserveRate: boundedNumber(overrides.returnsReserveRate,
      PACK_SCENARIO_DEFAULT_ECONOMICS_CONFIG.returnsReserveRate, 0, .5),
    promotedListingsReserveRate: boundedNumber(overrides.promotedListingsReserveRate,
      PACK_SCENARIO_DEFAULT_ECONOMICS_CONFIG.promotedListingsReserveRate, 0, .5),
    minimumNetProfit: boundedNumber(overrides.minimumNetProfit,
      PACK_SCENARIO_DEFAULT_ECONOMICS_CONFIG.minimumNetProfit, 0, 10_000),
    minimumNetMarginPercent: boundedNumber(overrides.minimumNetMarginPercent,
      PACK_SCENARIO_DEFAULT_ECONOMICS_CONFIG.minimumNetMarginPercent, 0, 95),
    minimumRoiPercent: boundedNumber(overrides.minimumRoiPercent,
      PACK_SCENARIO_DEFAULT_ECONOMICS_CONFIG.minimumRoiPercent, 0, 10_000),
  }
  const appliedFixedOrderFee = salePrice <= 10
    ? Math.min(config.fixedOrderFee, .3)
    : Math.max(config.fixedOrderFee, .4)
  const estimatedEbayFees = salePrice * config.estimatedEbayFeeRate + appliedFixedOrderFee
  const returnsReserve = salePrice * config.returnsReserveRate
  const promotedListingsReserve = salePrice * config.promotedListingsReserveRate
  const estimatedNetProfit = salePrice - exactPackCostUsd - estimatedEbayFees -
    returnsReserve - promotedListingsReserve
  const estimatedNetMarginPercent = (estimatedNetProfit / salePrice) * 100
  const estimatedRoiPercent = exactPackCostUsd > 0
    ? (estimatedNetProfit / exactPackCostUsd) * 100
    : estimatedNetProfit > 0 ? null : 0
  const passesProfitGate = estimatedNetProfit >= config.minimumNetProfit &&
    estimatedNetMarginPercent >= config.minimumNetMarginPercent &&
    (estimatedRoiPercent === null || estimatedRoiPercent >= config.minimumRoiPercent)
  return {
    ready: true as const,
    salePrice: money(salePrice),
    exactPackCostUsd: money(exactPackCostUsd),
    estimatedEbayFees: money(estimatedEbayFees),
    returnsReserve: money(returnsReserve),
    promotedListingsReserve: money(promotedListingsReserve),
    estimatedNetProfit: money(estimatedNetProfit),
    estimatedNetMarginPercent: money(estimatedNetMarginPercent),
    estimatedRoiPercent: estimatedRoiPercent === null ? null : money(estimatedRoiPercent),
    passesProfitGate,
    config,
    calculationSource: "SERVER_OWN_COST_PACK_DISCOUNT_SCENARIO_V1" as const,
  }
}

function preparationRate(packagingType: Exclude<LunaPackagingType, "UNKNOWN">, units: number) {
  return PREPARATION_RATES[packagingType].find((tier) => units <= tier.maximumUnits)?.amountUsd ?? null
}

function line(input: Omit<CostLine, "minimumUsd" | "maximumUsd"> & {
  minimumUsd?: number | null
  maximumUsd?: number | null
}): CostLine {
  return {
    ...input,
    minimumUsd: input.minimumUsd ?? input.amountUsd,
    maximumUsd: input.maximumUsd ?? input.amountUsd,
  }
}

export function quoteLunaFulfillment(input: {
  source: LunaFulfillmentSource
  nativePackCount: number | null
  offerPackCount: number
  physicalUnitsPerOffer?: number | null
  unitCostUsd: number | null
  shippingCostUsd?: number | null
  packagingType?: LunaPackagingType
  packagingMaterial?: LunaPackagingMaterial
  bubbleWrapRequired?: boolean
  confirmedBubbleWrapCostUsd?: number | null
  externalStorageAllocationUsd?: number | null
}) {
  const offerPackCount = positiveInteger(input.offerPackCount)
  const nativePackCount = positiveInteger(input.nativePackCount)
  const physicalUnits = positiveInteger(input.physicalUnitsPerOffer) ?? offerPackCount
  const unitCostUsd = nonNegativeMoney(input.unitCostUsd)
  const shippingCostUsd = nonNegativeMoney(input.shippingCostUsd)
  const sameNativePresentation = input.source === "LUNA_NATIVE_PRESENTATION" &&
    nativePackCount !== null && offerPackCount === nativePackCount
  const blockers: string[] = []
  const assumptions: string[] = []
  const costs: CostLine[] = []

  if (!offerPackCount || !physicalUnits || unitCostUsd === null) {
    return {
      version: LUNA_FULFILLMENT_RATE_CARD_VERSION,
      status: "MISSING_BLOCKING" as const,
      blockers: ["OFFER_PACK_OR_UNIT_COST_REQUIRED"],
      assumptions,
      costs,
      minimumFulfillmentCostUsd: null,
      maximumFulfillmentCostUsd: null,
      exactFulfillmentCostUsd: null,
      sameNativePresentation: false,
      receivingFeeApplied: false,
      customPreparationApplied: false,
      provenance: "OPERATOR_CONFIRMED_LUNA_CONTRACT_RATE_CARD",
    }
  }

  costs.push(line({
    key: "PRODUCT_COST",
    label: "Costo de las unidades",
    amountUsd: money(unitCostUsd * physicalUnits),
    verificationStatus: "DERIVED_VERIFIED",
    source: "DERIVED",
  }))

  if (input.source === "EXTERNAL_WHOLESALER_VIA_LUNA") {
    costs.push(line({
      key: "RECEIVING",
      label: "Recepción de inventario Luna ($0.20 por unidad)",
      amountUsd: money(.2 * physicalUnits),
      verificationStatus: "DERIVED_VERIFIED",
      source: "LUNA_CONTRACT_RATE_CARD",
    }))
    const storage = nonNegativeMoney(input.externalStorageAllocationUsd)
    if (storage === null) blockers.push("EXTERNAL_STORAGE_RATE_REQUIRED")
    else costs.push(line({
      key: "STORAGE",
      label: "Almacenamiento asignado a la oferta",
      amountUsd: storage,
      verificationStatus: "VERIFIED",
      source: "OPERATOR_CONFIRMED",
    }))
  }

  const customPresentation = !sameNativePresentation
  if (customPresentation) {
    const packagingType = input.packagingType ?? "UNKNOWN"
    if (packagingType === "UNKNOWN") blockers.push("PACKAGING_TYPE_REQUIRED")
    else {
      const rate = preparationRate(packagingType, physicalUnits)
      if (rate === null) blockers.push("LUNA_PREPARATION_QUOTE_REQUIRED_OVER_50_UNITS")
      else costs.push(line({
        key: "PREPARATION",
        label: `Preparación de orden en ${packagingType === "BOX" ? "caja" : "polybag"}`,
        amountUsd: rate,
        verificationStatus: "VERIFIED",
        source: "LUNA_CONTRACT_RATE_CARD",
      }))
    }

    const material = input.packagingMaterial ?? "UNKNOWN"
    if (material === "UNKNOWN") blockers.push("PACKAGING_MATERIAL_REQUIRED")
    else costs.push(line({
      key: "PACKAGING_MATERIAL",
      label: "Material de empaque",
      amountUsd: MATERIAL_RATES[material],
      verificationStatus: "VERIFIED",
      source: "LUNA_CONTRACT_RATE_CARD",
    }))

    if (input.bubbleWrapRequired) {
      const confirmed = nonNegativeMoney(input.confirmedBubbleWrapCostUsd)
      if (confirmed === null) {
        costs.push(line({
          key: "BUBBLE_WRAP",
          label: "Bubble wrap",
          amountUsd: null,
          minimumUsd: .5,
          maximumUsd: 1,
          verificationStatus: "ESTIMATED_INTERNAL",
          source: "LUNA_CONTRACT_RATE_CARD",
        }))
        assumptions.push("Bubble wrap usa el rango contractual $0.50–$1.00 hasta confirmar el cargo exacto.")
      } else costs.push(line({
        key: "BUBBLE_WRAP",
        label: "Bubble wrap confirmado",
        amountUsd: confirmed,
        verificationStatus: "VERIFIED",
        source: "OPERATOR_CONFIRMED",
      }))
    }
  }

  if (shippingCostUsd === null) blockers.push("SHIPPING_COST_REQUIRED")
  else costs.push(line({
    key: "SHIPPING",
    label: "Envío",
    amountUsd: shippingCostUsd,
    verificationStatus: "VERIFIED",
    source: "OPERATOR_CONFIRMED",
  }))

  const minimumFulfillmentCostUsd = costs.every((entry) => entry.minimumUsd !== null)
    ? money(costs.reduce((sum, entry) => sum + Number(entry.minimumUsd), 0))
    : null
  const maximumFulfillmentCostUsd = costs.every((entry) => entry.maximumUsd !== null)
    ? money(costs.reduce((sum, entry) => sum + Number(entry.maximumUsd), 0))
    : null
  const exactFulfillmentCostUsd = blockers.length === 0 && costs.every((entry) => entry.amountUsd !== null)
    ? money(costs.reduce((sum, entry) => sum + Number(entry.amountUsd), 0))
    : null
  const quoteRequired = blockers.includes("LUNA_PREPARATION_QUOTE_REQUIRED_OVER_50_UNITS")
  const hasRange = costs.some((entry) => entry.amountUsd === null && entry.minimumUsd !== null && entry.maximumUsd !== null)

  return {
    version: LUNA_FULFILLMENT_RATE_CARD_VERSION,
    status: quoteRequired
      ? "QUOTE_REQUIRED" as const
      : blockers.length
        ? "MISSING_BLOCKING" as const
        : hasRange
          ? "CONSERVATIVE_RANGE_ONLY" as const
          : "CONTRACT_RATE_READY" as const,
    blockers: [...new Set(blockers)],
    assumptions,
    costs,
    minimumFulfillmentCostUsd,
    maximumFulfillmentCostUsd,
    exactFulfillmentCostUsd,
    sameNativePresentation,
    receivingFeeApplied: input.source === "EXTERNAL_WHOLESALER_VIA_LUNA",
    customPreparationApplied: customPresentation,
    provenance: "OPERATOR_CONFIRMED_LUNA_CONTRACT_RATE_CARD",
  }
}

export function rankRelatedPackStrategies(input: {
  nativePackCount: number
  relatedPackEvidence: Array<{
    packCount: number
    observationCount: number
    confirmedSoldQuantity: number
    confidence: "HIGH" | "MEDIUM" | "LOW"
  }>
  feasiblePackCounts?: number[]
}) {
  const feasibleValues = input.feasiblePackCounts
    ?.map(positiveInteger).filter((value): value is number => value !== null)
  const feasible = feasibleValues ? new Set(feasibleValues) : null
  const candidates = input.relatedPackEvidence
    .map((entry) => ({ ...entry, packCount: positiveInteger(entry.packCount),
      observationCount: Math.max(0, Math.trunc(entry.observationCount)),
      confirmedSoldQuantity: Math.max(0, Math.trunc(entry.confirmedSoldQuantity)) }))
    .filter((entry): entry is typeof entry & { packCount: number } =>
      entry.packCount !== null && (!feasible || feasible.has(entry.packCount)) &&
      entry.observationCount > 0)
    .map((entry) => ({ ...entry,
      evidenceScore: entry.confirmedSoldQuantity * 2 + entry.observationCount +
        (entry.confidence === "HIGH" ? 3 : entry.confidence === "MEDIUM" ? 1 : 0),
      presentationKind: entry.packCount === input.nativePackCount
        ? "NATIVE_PRESENTATION" as const : "CUSTOM_PRESENTATION" as const }))
    .sort((left, right) => right.evidenceScore - left.evidenceScore ||
      left.packCount - right.packCount)
  const leader = candidates[0] ?? null
  return {
    version: "LUNA_RELATED_PACK_STRATEGY_V1",
    candidates,
    suggestedPackCountForEvaluation: leader?.packCount ?? null,
    requiresCustomPreparation: leader ? leader.packCount !== input.nativePackCount : false,
    conclusion: leader
      ? "Este pack aparece con mayor fuerza descriptiva en la muestra relacionada; requiere validar costos y aprobación humana."
      : "No existe una cohorte relacionada suficiente para sugerir otra presentación.",
    prohibitedConclusions: [
      "La presentación causó las ventas.",
      "El precio observado debe convertirse automáticamente en precio del listing.",
    ],
  }
}

export type RelatedPackMarketEvidence = {
  packCount: number
  evidenceTier: "CONFIRMED_SOLD_RELATED_PACK" | "ACTIVE_RELATED" | "BROAD_SEARCH_ONLY"
  activeListingCount?: number
  activeSellerCount?: number
  activeResultSampleSize?: number
  confirmedSoldObservationCount?: number
  confirmedSoldQuantity?: number
  confidence?: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"
  observedAt?: string | null
}

/**
 * Evaluates owner-controlled pack discount scenarios without deriving a price
 * from competitor content. Active listings remain descriptive; only confirmed
 * sold related-pack evidence can support an operator review recommendation.
 */
export function evaluatePackDiscountScenarios(input: {
  source: LunaFulfillmentSource
  nativePackCount: number
  targetPackCount: number
  lunaPurchaseUnitsPerOffer: number
  lunaPurchaseUnitCostUsd: number | null
  approvedBaselinePricePerNativePresentationUsd: number | null
  shippingCostUsd?: number | null
  packagingType?: LunaPackagingType
  packagingMaterial?: LunaPackagingMaterial
  bubbleWrapRequired?: boolean
  confirmedBubbleWrapCostUsd?: number | null
  externalStorageAllocationUsd?: number | null
  discountPercentScenarios?: number[]
  economicsConfig?: Partial<EbayUnitEconomicsConfig>
  marketEvidence?: RelatedPackMarketEvidence | null
}) {
  const nativePackCount = positiveInteger(input.nativePackCount)
  const targetPackCount = positiveInteger(input.targetPackCount)
  const lunaPurchaseUnitsPerOffer = positiveInteger(input.lunaPurchaseUnitsPerOffer)
  const approvedBaselinePrice = nonNegativeMoney(
    input.approvedBaselinePricePerNativePresentationUsd,
  )
  const discountPercentScenarios = [...new Set(
    (input.discountPercentScenarios ?? [10, 15, 20])
      .map(boundedPercent)
      .filter((value): value is number => value !== null),
  )].sort((left, right) => left - right)
  const blockers: string[] = []

  if (!nativePackCount || !targetPackCount || !lunaPurchaseUnitsPerOffer) {
    blockers.push("PACK_CONFIGURATION_REQUIRED")
  } else if (nativePackCount * lunaPurchaseUnitsPerOffer !== targetPackCount) {
    blockers.push("PACK_CONFIGURATION_CONFLICT")
  }
  if (approvedBaselinePrice === null || approvedBaselinePrice <= 0) {
    blockers.push("OWNER_APPROVED_BASELINE_PRICE_REQUIRED")
  }
  if (!discountPercentScenarios.length) blockers.push("DISCOUNT_SCENARIO_REQUIRED")

  const quote = quoteLunaFulfillment({
    source: input.source,
    nativePackCount,
    offerPackCount: targetPackCount ?? 0,
    physicalUnitsPerOffer: lunaPurchaseUnitsPerOffer,
    unitCostUsd: input.lunaPurchaseUnitCostUsd,
    shippingCostUsd: input.shippingCostUsd,
    packagingType: input.packagingType,
    packagingMaterial: input.packagingMaterial,
    bubbleWrapRequired: input.bubbleWrapRequired,
    confirmedBubbleWrapCostUsd: input.confirmedBubbleWrapCostUsd,
    externalStorageAllocationUsd: input.externalStorageAllocationUsd,
  })
  if (quote.exactFulfillmentCostUsd === null) {
    blockers.push(...quote.blockers, "EXACT_PACK_COST_REQUIRED")
  }

  const marketEvidence = input.marketEvidence?.packCount === targetPackCount
    ? input.marketEvidence
    : null
  const activeListingCount = nonNegativeInteger(marketEvidence?.activeListingCount)
  const activeSellerCount = nonNegativeInteger(marketEvidence?.activeSellerCount)
  const activeResultSampleSize = nonNegativeInteger(marketEvidence?.activeResultSampleSize)
  const confirmedSoldObservationCount = nonNegativeInteger(
    marketEvidence?.confirmedSoldObservationCount,
  )
  const confirmedSoldQuantity = nonNegativeInteger(marketEvidence?.confirmedSoldQuantity)
  const hasConfirmedSoldSupport =
    marketEvidence?.evidenceTier === "CONFIRMED_SOLD_RELATED_PACK" &&
    confirmedSoldObservationCount > 0 &&
    confirmedSoldQuantity > 0
  const hasActiveDescriptiveSignal = activeListingCount > 0 || activeSellerCount > 0
  const strategyClassification = hasConfirmedSoldSupport
    ? "SUPPORTED_BY_CONFIRMED_SOLD_RELATED_PACK" as const
    : hasActiveDescriptiveSignal
      ? "PRELIMINARY_ACTIVE_PATTERN_ONLY" as const
      : "INSUFFICIENT_MARKET_EVIDENCE" as const
  const activePackPrevalencePercent = activeResultSampleSize > 0
    ? money((activeListingCount / activeResultSampleSize) * 100)
    : null

  const undiscountedPackPrice = approvedBaselinePrice !== null &&
    lunaPurchaseUnitsPerOffer !== null
    ? money(approvedBaselinePrice * lunaPurchaseUnitsPerOffer)
    : null
  const scenarios = discountPercentScenarios.map((discountPercent) => {
    const candidateSalePrice = undiscountedPackPrice === null
      ? null
      : money(undiscountedPackPrice * (1 - discountPercent / 100))
    const economics = quote.exactFulfillmentCostUsd === null || candidateSalePrice === null
      ? null
      : calculatePackScenarioEconomics(
          candidateSalePrice,
          quote.exactFulfillmentCostUsd,
          input.economicsConfig,
        )
    const scenarioBlockers = [
      ...blockers,
      economics?.passesProfitGate === false ? "PROFIT_ROI_OR_MARGIN_GATE_FAILED" : "",
    ].filter(Boolean)
    return {
      discountPercent,
      undiscountedPackPriceUsd: undiscountedPackPrice,
      candidateSalePriceUsd: candidateSalePrice,
      effectivePricePerConsumerUnitUsd: candidateSalePrice !== null && targetPackCount
        ? money(candidateSalePrice / targetPackCount)
        : null,
      economics,
      viableForOperatorReview: scenarioBlockers.length === 0 &&
        economics?.passesProfitGate === true,
      blockers: [...new Set(scenarioBlockers)],
      priceBasis: "OWNER_APPROVED_BASELINE_PRICE" as const,
      competitorPriceUsed: false,
    }
  })
  const viableScenarios = scenarios.filter((scenario) => scenario.viableForOperatorReview)
  const deepestViableScenario = viableScenarios.at(-1) ?? null
  const scenarioForOperatorReview = hasConfirmedSoldSupport
    ? deepestViableScenario
    : null

  return {
    version: LUNA_PACK_DISCOUNT_SCENARIO_VERSION,
    nativePackCount,
    targetPackCount,
    lunaPurchaseUnitsPerOffer,
    quote,
    strategyClassification,
    observedMarketPattern: {
      descriptiveOnly: true,
      evidenceTier: marketEvidence?.evidenceTier ?? null,
      activeListingCount,
      activeSellerCount,
      activeResultSampleSize,
      activePackPrevalencePercent,
      confirmedSoldObservationCount,
      confirmedSoldQuantity,
      confidence: marketEvidence?.confidence ?? "UNKNOWN",
      observedAt: marketEvidence?.observedAt ?? null,
    },
    scenarios,
    scenarioForOperatorReview,
    blockers: [...new Set(blockers)],
    interpretation: hasConfirmedSoldSupport
      ? "Este pack aparece en evidencia vendida relacionada; los descuentos son escenarios calculados sólo con costos propios."
      : hasActiveDescriptiveSignal
        ? "Este pack aparece entre listings activos, pero esa presencia no demuestra ventas y no recomienda un precio."
        : "No existe evidencia suficiente para respaldar esta presentación.",
    controls: {
      humanApprovalRequired: true,
      automaticPricingAllowed: false,
      competitorPricesUsed: false,
      ebayWrites: 0,
      activeEvidenceCanRecommend: false,
      confirmedSoldRelatedPackCanSupportReview: true,
    },
    prohibitedConclusions: [
      "La presentación o el descuento causaron las ventas.",
      "El precio de un competidor debe convertirse en nuestro precio.",
      "Un patrón de listings activos demuestra demanda vendida.",
    ],
  }
}
