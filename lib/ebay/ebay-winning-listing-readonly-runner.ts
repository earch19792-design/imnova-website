export const EBAY_WINNING_LISTING_READONLY_RUNNER_VERSION =
  "EBAY_WINNING_LISTING_READONLY_RUNNER_RESUME_B2A_RUN_V1"

type ComparableInput = {
  itemId?: string | null
  title?: string | null
  price?: { value?: string | number | null; currency?: string | null } | null
  categories?: Array<{ categoryId?: string | null; categoryName?: string | null }> | null
  itemWebUrl?: string | null
  condition?: string | null
  buyingOptions?: string[] | null
  seller?: { feedbackPercentage?: string | number | null; feedbackScore?: number | null } | null
  itemLocation?: { country?: string | null } | null
  shippingOptions?: Array<{ shippingCost?: { value?: string | number | null } | null }> | null
}

type Fixture = {
  runnerVersion?: string
  status?: string
  mode?: string
  sourceRoute?: string
  storeName?: string
  targetMarketplace?: string
  warehouse?: Record<string, unknown>
  sourceCandidate?: Record<string, unknown>
  queryPlan?: string[]
  dryRunMarketData?: Record<string, unknown>
  safetyFlags?: Record<string, boolean>
}

type MarketData = {
  source?: string
  realEbayWinningDataResolved?: boolean
  realEbayComparableDataResolved?: boolean
  soldDataResolved?: boolean
  soldDataUnavailableReason?: string
  comparables?: ComparableInput[]
  realLunaMatchConfirmed?: boolean
  lunaPackQuantityConfirmed?: boolean
  lunaUnitCost?: number
  estimatedPackShippingCost?: number
  humanApprovalConfirmed?: boolean
  accountRiskKnown?: boolean
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function number(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value)
  return fallback
}

function bool(value: unknown) {
  return value === true
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : []
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function buildEbayWinningListingReadonlyRunnerInput(fixture: Fixture, marketDataOverride?: MarketData) {
  const candidate = fixture.sourceCandidate ?? {}
  const warehouse = fixture.warehouse ?? {}
  const market = marketDataOverride ?? fixture.dryRunMarketData ?? {}
  return {
    runnerVersion: text(fixture.runnerVersion, EBAY_WINNING_LISTING_READONLY_RUNNER_VERSION),
    status: text(fixture.status),
    mode: text(fixture.mode),
    sourceRoute: text(fixture.sourceRoute),
    storeName: text(fixture.storeName),
    targetMarketplace: text(fixture.targetMarketplace, "EBAY_US"),
    warehouse: {
      warehouseAlias: text(warehouse.warehouseAlias),
      city: text(warehouse.city),
      state: text(warehouse.state),
      postalCode: text(warehouse.postalCode),
      country: text(warehouse.country),
      fullWarehouseStreetAddressCommitted: bool(warehouse.fullWarehouseStreetAddressCommitted),
    },
    sourceCandidate: {
      productName: text(candidate.productName),
      optimizedTitleFromB2A: text(candidate.optimizedTitleFromB2A),
      recommendedPriceFromB2A: number(candidate.recommendedPriceFromB2A),
      currency: text(candidate.currency, "USD"),
      riskLevel: text(candidate.riskLevel, "UNKNOWN"),
    },
    queryPlan: strings(fixture.queryPlan),
    marketData: {
      source: text(market.source, "NO_REAL_MARKET_DATA_IN_DRY_RUN"),
      realEbayWinningDataResolved: bool(market.realEbayWinningDataResolved),
      realEbayComparableDataResolved: bool(market.realEbayComparableDataResolved),
      soldDataResolved: bool(market.soldDataResolved),
      soldDataUnavailableReason: text(market.soldDataUnavailableReason, "unavailable_or_scope_missing"),
      comparables: Array.isArray(market.comparables) ? market.comparables : [],
      realLunaMatchConfirmed: bool(market.realLunaMatchConfirmed),
      lunaPackQuantityConfirmed: bool(market.lunaPackQuantityConfirmed),
      lunaUnitCost: number(market.lunaUnitCost),
      estimatedPackShippingCost: number(market.estimatedPackShippingCost),
      humanApprovalConfirmed: bool(market.humanApprovalConfirmed),
      accountRiskKnown: bool(market.accountRiskKnown),
    },
    safetyFlags: fixture.safetyFlags ?? {},
  }
}

export function buildEbayReadonlyMarketResolverGate(input: ReturnType<typeof buildEbayWinningListingReadonlyRunnerInput>) {
  const queryPlanBuilt = input.queryPlan.length === 3
  const safeWarehouseAlias = input.warehouse.warehouseAlias === "LUNA_PORTEX_BOCA_RATON" && !input.warehouse.fullWarehouseStreetAddressCommitted
  const sourceCandidateReady = input.sourceCandidate.productName.length > 0 && input.sourceCandidate.riskLevel === "LOW"
  return {
    gateReady: queryPlanBuilt && safeWarehouseAlias && sourceCandidateReady,
    queryPlanBuilt,
    safeWarehouseAlias,
    sourceCandidateReady,
  }
}

export function buildEbayWinningListingQueryPlan(input: ReturnType<typeof buildEbayWinningListingReadonlyRunnerInput>) {
  return {
    queryPlanBuilt: input.queryPlan.length > 0,
    queries: input.queryPlan,
    endpointClass: "OFFICIAL_EBAY_BROWSE_SEARCH_READ_ONLY",
    soldCompletedQueryPlanned: false,
  }
}

export function buildEbayReadonlyMarketDataSourceAssessment(input: ReturnType<typeof buildEbayWinningListingReadonlyRunnerInput>) {
  return {
    source: input.marketData.source,
    realEbayWinningDataResolved: input.marketData.realEbayWinningDataResolved,
    realEbayComparableDataResolved: input.marketData.realEbayComparableDataResolved,
    soldDataResolved: input.marketData.soldDataResolved,
    soldDataUnavailableReason: input.marketData.soldDataResolved ? "" : input.marketData.soldDataUnavailableReason,
    officialReadOnlySource: input.marketData.source === "OFFICIAL_EBAY_BROWSE_API_READ_ONLY",
  }
}

export function buildEbayComparableListingNormalizer(comparable: ComparableInput, index = 0) {
  const category = comparable.categories?.[0] ?? {}
  return {
    comparableId: text(comparable.itemId, `sanitized-comparable-${index + 1}`),
    titleForAnalysis: text(comparable.title),
    titleCopiedToOutput: false,
    descriptionCopied: false,
    imagesCopied: false,
    competitorBrandMisused: false,
    price: number(comparable.price?.value),
    currency: text(comparable.price?.currency, "USD"),
    categoryId: text(category.categoryId),
    categoryName: text(category.categoryName),
    condition: text(comparable.condition),
    buyingOptions: strings(comparable.buyingOptions),
    sellerFeedbackPercentage: number(comparable.seller?.feedbackPercentage),
    sellerFeedbackScore: number(comparable.seller?.feedbackScore),
    itemCountry: text(comparable.itemLocation?.country),
    shippingCost: number(comparable.shippingOptions?.[0]?.shippingCost?.value),
    sourceUrlRetained: false,
  }
}

const safeKeywordVocabulary = [
  "silicone", "cable", "organizer", "clips", "20", "pack", "self", "adhesive", "cord", "holder", "desk", "black",
]

export function buildEbayReadonlyKeywordSignalAnalysis(comparables: ReturnType<typeof buildEbayComparableListingNormalizer>[]) {
  const tokens = comparables.flatMap((entry) => entry.titleForAnalysis.toLowerCase().split(/[^a-z0-9]+/))
  const keywords = unique(tokens.filter((token) => safeKeywordVocabulary.includes(token)))
  return { winningKeywordsConfirmed: keywords.length >= 4, keywords, exactTitleCopied: false }
}

export function buildEbayReadonlyPriceRangeAnalysis(comparables: ReturnType<typeof buildEbayComparableListingNormalizer>[]) {
  const prices = comparables.map((entry) => entry.price).filter((price) => price > 0)
  return {
    priceRangeConfirmed: prices.length >= 2,
    min: prices.length ? Math.min(...prices) : 0,
    max: prices.length ? Math.max(...prices) : 0,
    currency: "USD",
    sampleSize: prices.length,
  }
}

const packLabels = ["pack", "multi pack", "multipack", "bulk pack", "value pack", "bundle", "set"]

function detectPackSize(title: string) {
  const normalized = title.toLowerCase()
  const numbered = normalized.match(/\b(1|2|3|4|6|10|12|20)\s*(?:pack|pk|count|ct|piece|pc|set)\b/)
  if (numbered) return Number(numbered[1])
  if (packLabels.some((label) => normalized.includes(label))) return 0
  return null
}

export function buildEbayPackSizeSignalAnalysis(comparables: ReturnType<typeof buildEbayComparableListingNormalizer>[]) {
  const detected = comparables
    .map((entry) => ({ comparableId: entry.comparableId, packSize: detectPackSize(entry.titleForAnalysis) }))
    .filter((entry): entry is { comparableId: string; packSize: number } => entry.packSize !== null)
  const packSizesDetected = detected.map((entry) => entry.packSize)
  const counts = new Map<number, number>()
  for (const size of packSizesDetected) counts.set(size, (counts.get(size) ?? 0) + 1)
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const dominantPackSize = ranked[0]?.[0] ?? null
  return {
    packSignalsDetected: detected.length > 0,
    packSizesDetected: unique(packSizesDetected.map(String)).map(Number),
    dominantPackSize,
    winningPackSizes: ranked.filter(([, count]) => count >= 1).map(([size]) => size),
    signalCountByPack: Object.fromEntries(ranked.map(([size, count]) => [String(size), count])),
  }
}

export function buildEbayPackPricingAnalysis(comparables: ReturnType<typeof buildEbayComparableListingNormalizer>[]) {
  const rows = comparables
    .map((entry) => ({ ...entry, packSize: detectPackSize(entry.titleForAnalysis) }))
    .filter((entry) => entry.price > 0)
  const singlePrices = rows.filter((entry) => entry.packSize === 1 || entry.packSize === null).map((entry) => entry.price)
  const multiPackPriceRanges: Record<string, { min: number; max: number; sampleSize: number }> = {}
  const estimatedPricePerUnitByPack: Record<string, number> = {}
  for (const packSize of unique(rows.map((entry) => String(entry.packSize ?? 1))).map(Number)) {
    if (packSize <= 1) continue
    const prices = rows.filter((entry) => entry.packSize === packSize).map((entry) => entry.price)
    multiPackPriceRanges[String(packSize)] = { min: Math.min(...prices), max: Math.max(...prices), sampleSize: prices.length }
    estimatedPricePerUnitByPack[String(packSize)] = Math.round((prices.reduce((sum, price) => sum + price, 0) / prices.length / packSize) * 100) / 100
  }
  return {
    packPriceRangeBuilt: rows.length >= 2,
    singleUnitPriceRange: singlePrices.length ? { min: Math.min(...singlePrices), max: Math.max(...singlePrices), sampleSize: singlePrices.length } : null,
    multiPackPriceRanges,
    estimatedPricePerUnitByPack,
  }
}

export function buildEbayPackMarginGuard(input: ReturnType<typeof buildEbayWinningListingReadonlyRunnerInput>, comparables: ReturnType<typeof buildEbayComparableListingNormalizer>[]) {
  const signals = buildEbayPackSizeSignalAnalysis(comparables)
  const pricing = buildEbayPackPricingAnalysis(comparables)
  const size = signals.dominantPackSize ?? 0
  const range = size > 1 ? pricing.multiPackPriceRanges[String(size)] : undefined
  const expectedPrice = range ? (range.min + range.max) / 2 : 0
  const estimatedCost = size > 0 ? input.marketData.lunaUnitCost * size + input.marketData.estimatedPackShippingCost : 0
  const estimatedMargin = expectedPrice > 0 ? ((expectedPrice - estimatedCost) / expectedPrice) * 100 : 0
  const packMarginRisk = !input.marketData.lunaPackQuantityConfirmed || expectedPrice <= 0 || estimatedMargin < 15
  return {
    packMarginGuardPassed: !packMarginRisk,
    packMarginRisk,
    estimatedPackMarginPercent: Math.round(estimatedMargin * 100) / 100,
    lunaPackQuantityConfirmed: input.marketData.lunaPackQuantityConfirmed,
    missingQuantityReason: input.marketData.lunaPackQuantityConfirmed ? "" : "NEED_LUNA_PACK_QUANTITY_CONFIRMATION",
  }
}

export function buildEbayPackTitleKeywordStrategy(comparables: ReturnType<typeof buildEbayComparableListingNormalizer>[], productName = "Silicone Cable Organizer Clips") {
  const signals = buildEbayPackSizeSignalAnalysis(comparables)
  const packKeywordsExtracted = unique(comparables.flatMap((entry) => {
    const title = entry.titleForAnalysis.toLowerCase()
    const keywords = []
    for (const size of [1, 2, 3, 4, 6, 10, 12, 20]) {
      if (new RegExp(`\\b${size}\\s*(?:pack|pk|count|ct|set)\\b`, "i").test(title)) keywords.push(`${size} pack`)
    }
    for (const label of ["multi pack", "bulk pack", "value pack", "bundle", "set"]) {
      if (title.includes(label)) keywords.push(label)
    }
    return keywords
  }))
  const primary = signals.dominantPackSize && signals.dominantPackSize > 1 ? signals.dominantPackSize : null
  return {
    packKeywordsExtracted,
    packTitlePattern: primary ? "product type + pack size + material + mounting feature + color" : "product type + unit count if confirmed",
    optimizedPackTitleCandidate: primary ? `${productName} ${primary} Pack Self Adhesive Black` : `${productName} Black`,
    exactCompetitorTitleCopied: false,
  }
}

export function buildEbayRecommendedBundleStrategy(input: ReturnType<typeof buildEbayWinningListingReadonlyRunnerInput>, comparables: ReturnType<typeof buildEbayComparableListingNormalizer>[]) {
  const signals = buildEbayPackSizeSignalAnalysis(comparables)
  const margin = buildEbayPackMarginGuard(input, comparables)
  const primary = signals.dominantPackSize && signals.dominantPackSize > 1 ? signals.dominantPackSize : 1
  const secondary = signals.winningPackSizes.find((size) => size !== primary && size > 1) ?? null
  const shippingCosts = comparables.map((entry) => entry.shippingCost).filter((cost) => cost > 0)
  const packShippingRisk = primary >= 12 && shippingCosts.length > 0 && Math.max(...shippingCosts) > 10
  const strategyBySize: Record<number, string> = { 1: "SINGLE_UNIT", 3: "THREE_PACK", 6: "SIX_PACK", 12: "TWELVE_PACK", 20: "TWENTY_PACK" }
  const recommendedPackStrategy = !signals.packSignalsDetected
    ? "DO_NOT_BUNDLE"
    : !margin.packMarginGuardPassed || packShippingRisk
      ? "DO_NOT_BUNDLE"
      : secondary
        ? "MIXED_PACK_TEST"
        : strategyBySize[primary] ?? "MIXED_PACK_TEST"
  return {
    recommendedPrimaryPackSize: primary,
    recommendedSecondaryPackSize: secondary,
    recommendedPackStrategy,
    packShippingRisk,
    packMarginRisk: margin.packMarginRisk,
    packReadinessForDraft: signals.packSignalsDetected && margin.packMarginGuardPassed && !packShippingRisk,
    packHumanApprovalRequired: true,
    packRecommendationReason: !input.marketData.lunaPackQuantityConfirmed
      ? "NEED_LUNA_PACK_QUANTITY_CONFIRMATION"
      : !signals.packSignalsDetected
        ? "Insufficient comparable pack signals"
        : packShippingRisk
          ? "Pack shipping cost may erase the ticket-size benefit"
          : margin.packMarginRisk
            ? "Pack margin is below the safety threshold"
            : `Pack ${primary} has the strongest safe comparable signal`,
  }
}

export function buildEbayReadonlyCategorySignalAnalysis(comparables: ReturnType<typeof buildEbayComparableListingNormalizer>[]) {
  const categories = comparables.filter((entry) => entry.categoryId || entry.categoryName)
  const first = categories[0]
  return {
    categorySignalConfirmed: categories.length >= 1,
    suggestedCategoryId: first?.categoryId ?? "",
    suggestedCategoryName: first?.categoryName ?? "",
    finalHumanConfirmationRequired: true,
  }
}

export function buildEbayReadonlyItemSpecificsSignalAnalysis(comparables: ReturnType<typeof buildEbayComparableListingNormalizer>[]) {
  const keywords = buildEbayReadonlyKeywordSignalAnalysis(comparables).keywords
  const suggestedItemSpecifics = {
    Brand: "Unbranded",
    Type: keywords.includes("organizer") ? "Cable Organizer Clip" : "runtime_required",
    Material: keywords.includes("silicone") ? "Silicone" : "runtime_required",
    Color: keywords.includes("black") ? "Black" : "runtime_required",
    "Number in Pack": keywords.includes("20") || keywords.includes("pack") ? "20" : "runtime_required",
    Mounting: keywords.includes("adhesive") ? "Self-Adhesive" : "runtime_required",
  }
  return {
    itemSpecificsSignalConfirmed: Object.values(suggestedItemSpecifics).filter((value) => value !== "runtime_required").length >= 4,
    suggestedItemSpecifics,
  }
}

export function buildEbayReadonlyLunaMatchConfirmation(input: ReturnType<typeof buildEbayWinningListingReadonlyRunnerInput>) {
  return {
    realLunaMatchConfirmed: input.marketData.realLunaMatchConfirmed,
    sourceProduct: input.sourceCandidate.productName,
    confirmationSource: input.marketData.realLunaMatchConfirmed ? "CONTROLLED_LUNA_CONFIRMATION" : "NOT_CONFIRMED",
  }
}

export function buildEbayReadonlyRiskSignalAssessment(input: ReturnType<typeof buildEbayWinningListingReadonlyRunnerInput>, comparables: ReturnType<typeof buildEbayComparableListingNormalizer>[]) {
  const searchable = `${input.sourceCandidate.productName} ${comparables.map((entry) => entry.titleForAnalysis).join(" ")}`.toLowerCase()
  const prohibited = ["supplement", "medical", "battery", "aerosol", "perfume"]
  const riskSignals = prohibited.filter((signal) => searchable.includes(signal))
  if (input.marketData.accountRiskKnown) riskSignals.push("ACCOUNT_RISK")
  return { riskSignals, highRisk: riskSignals.length > 0 }
}

export function buildEbayReadonlyMarketResolverReport(fixture: Fixture, marketDataOverride?: MarketData) {
  const input = buildEbayWinningListingReadonlyRunnerInput(fixture, marketDataOverride)
  const gate = buildEbayReadonlyMarketResolverGate(input)
  const source = buildEbayReadonlyMarketDataSourceAssessment(input)
  const comparables = input.marketData.comparables.map(buildEbayComparableListingNormalizer)
  const keywords = buildEbayReadonlyKeywordSignalAnalysis(comparables)
  const price = buildEbayReadonlyPriceRangeAnalysis(comparables)
  const category = buildEbayReadonlyCategorySignalAnalysis(comparables)
  const specifics = buildEbayReadonlyItemSpecificsSignalAnalysis(comparables)
  const luna = buildEbayReadonlyLunaMatchConfirmation(input)
  const risk = buildEbayReadonlyRiskSignalAssessment(input, comparables)
  const packSignals = buildEbayPackSizeSignalAnalysis(comparables)
  const packPricing = buildEbayPackPricingAnalysis(comparables)
  const packTitle = buildEbayPackTitleKeywordStrategy(comparables)
  const packMargin = buildEbayPackMarginGuard(input, comparables)
  const packStrategy = buildEbayRecommendedBundleStrategy(input, comparables)
  const titlePatternConfirmed = keywords.winningKeywordsConfirmed && comparables.length >= 2
  const sufficientMarketData = source.realEbayComparableDataResolved && comparables.length >= 2 && keywords.winningKeywordsConfirmed && price.priceRangeConfirmed
  const missingBeforeB2Run = [
    !source.realEbayComparableDataResolved ? "realEbayComparableData" : "",
    !source.soldDataResolved ? "soldDataUnavailableOrScopeMissing" : "",
    !keywords.winningKeywordsConfirmed ? "winningKeywords" : "",
    !price.priceRangeConfirmed ? "priceRange" : "",
    !category.categorySignalConfirmed ? "categorySignal" : "",
    !specifics.itemSpecificsSignalConfirmed ? "itemSpecificsSignal" : "",
    !luna.realLunaMatchConfirmed ? "realLunaMatch" : "",
    !input.marketData.humanApprovalConfirmed ? "humanApproval" : "",
  ].filter(Boolean)
  const packGateReady = !packSignals.packSignalsDetected || packStrategy.packReadinessForDraft
  const canProceedToB2Run = sufficientMarketData && category.categorySignalConfirmed && specifics.itemSpecificsSignalConfirmed && luna.realLunaMatchConfirmed && packGateReady && !risk.highRisk && input.marketData.humanApprovalConfirmed
  const nextRecommendedRoute = risk.highRisk
    ? "EBAY-RESUME-HOLD"
    : !sufficientMarketData
      ? "NEED_MARKET_DATA"
      : !luna.realLunaMatchConfirmed || !packGateReady
        ? "NEED_LUNA_MATCH"
        : !input.marketData.humanApprovalConfirmed
          ? "NEED_HUMAN_APPROVAL"
          : "EBAY-RESUME-B2-RUN"
  const checks = [gate.gateReady, source.realEbayComparableDataResolved, comparables.length >= 2, keywords.winningKeywordsConfirmed, titlePatternConfirmed, price.priceRangeConfirmed, category.categorySignalConfirmed, specifics.itemSpecificsSignalConfirmed, luna.realLunaMatchConfirmed, !risk.highRisk]
  return {
    readonlyRunnerBuilt: true,
    runnerScore: clampScore(checks.filter(Boolean).length * 10),
    gateReady: gate.gateReady,
    queryPlanBuilt: gate.queryPlanBuilt,
    realEbayWinningDataResolved: source.realEbayWinningDataResolved,
    realEbayComparableDataResolved: source.realEbayComparableDataResolved,
    soldDataResolved: source.soldDataResolved,
    soldDataUnavailableReason: source.soldDataUnavailableReason,
    comparableListingsAnalyzed: comparables.length,
    winningKeywordsConfirmed: keywords.winningKeywordsConfirmed,
    winningKeywords: keywords.keywords,
    titlePatternConfirmed,
    priceRangeConfirmed: price.priceRangeConfirmed,
    priceRange: price,
    categorySignalConfirmed: category.categorySignalConfirmed,
    categorySignal: category,
    itemSpecificsSignalConfirmed: specifics.itemSpecificsSignalConfirmed,
    itemSpecificsSignal: specifics,
    realLunaMatchConfirmed: luna.realLunaMatchConfirmed,
    riskSignals: risk.riskSignals,
    ...packSignals,
    ...packPricing,
    ...packTitle,
    ...packMargin,
    ...packStrategy,
    enrichedCandidateForB2Run: {
      productName: input.sourceCandidate.productName,
      optimizedTitle: input.sourceCandidate.optimizedTitleFromB2A,
      keywords: keywords.keywords,
      priceRange: price,
      category: category,
      itemSpecifics: specifics.suggestedItemSpecifics,
      bundleRecommendation: {
        recommendedPrimaryPackSize: packStrategy.recommendedPrimaryPackSize,
        recommendedSecondaryPackSize: packStrategy.recommendedSecondaryPackSize,
        recommendedPackStrategy: packStrategy.recommendedPackStrategy,
        optimizedPackTitleCandidate: packTitle.optimizedPackTitleCandidate,
        packReadinessForDraft: packStrategy.packReadinessForDraft,
        packHumanApprovalRequired: true,
      },
      copySafety: { exactTitleCopied: false, descriptionCopied: false, imagesCopied: false, competitorBrandMisused: false },
      publish: false,
    },
    missingBeforeB2Run,
    canProceedToB2Run,
    canPublish: false,
    requiresHumanApproval: true,
    nextRecommendedRoute,
  }
}

export function summarizeEbayWinningListingReadonlyRunner(report: ReturnType<typeof buildEbayReadonlyMarketResolverReport>, mode = "dry-run") {
  return {
    readonlyRunnerBuilt: report.readonlyRunnerBuilt,
    runnerScore: report.runnerScore,
    mode,
    gateReady: report.gateReady,
    queryPlanBuilt: report.queryPlanBuilt,
    realEbayWinningDataResolved: report.realEbayWinningDataResolved,
    realEbayComparableDataResolved: report.realEbayComparableDataResolved,
    soldDataResolved: report.soldDataResolved,
    soldDataUnavailableReason: report.soldDataUnavailableReason,
    comparableListingsAnalyzed: report.comparableListingsAnalyzed,
    winningKeywordsConfirmed: report.winningKeywordsConfirmed,
    titlePatternConfirmed: report.titlePatternConfirmed,
    priceRangeConfirmed: report.priceRangeConfirmed,
    categorySignalConfirmed: report.categorySignalConfirmed,
    itemSpecificsSignalConfirmed: report.itemSpecificsSignalConfirmed,
    realLunaMatchConfirmed: report.realLunaMatchConfirmed,
    riskSignals: report.riskSignals,
    packSignalsDetected: report.packSignalsDetected,
    packSizesDetected: report.packSizesDetected,
    dominantPackSize: report.dominantPackSize,
    recommendedPrimaryPackSize: report.recommendedPrimaryPackSize,
    recommendedSecondaryPackSize: report.recommendedSecondaryPackSize,
    recommendedPackStrategy: report.recommendedPackStrategy,
    packKeywordsExtracted: report.packKeywordsExtracted,
    optimizedPackTitleCandidate: report.optimizedPackTitleCandidate,
    packPriceRangeBuilt: report.packPriceRangeBuilt,
    packMarginGuardPassed: report.packMarginGuardPassed,
    packShippingRisk: report.packShippingRisk,
    packRecommendationReason: report.packRecommendationReason,
    missingBeforeB2Run: report.missingBeforeB2Run,
    canProceedToB2Run: report.canProceedToB2Run,
    canPublish: false,
    requiresHumanApproval: true,
    nextRecommendedRoute: report.nextRecommendedRoute,
    productionWriteTouched: false,
    mainTouched: false,
    stagingWriteExecuted: false,
    ebayReadOnlyApiUsed: mode === "gated-readonly-executed",
    ebayWriteApiUsed: false,
    oauthUsedInThisLoop: mode === "gated-readonly-executed",
    tokenExchangeExecuted: mode === "gated-readonly-executed",
    tokenStored: false,
    tokensPrinted: false,
    draftCreated: false,
    listingCreated: false,
    offerCreated: false,
    publicationExecuted: false,
    imageGenerationUsed: false,
    scraperUsed: false,
    amazonTrackTouched: false,
    whatsappRealSendUsed: false,
    openAiUsed: false,
    fullWarehouseStreetAddressCommitted: false,
  }
}

export function getEbayWinningListingReadonlyRunnerChecklist() {
  return [
    "Default to safe mode without OAuth or eBay calls",
    "Require exact environment approval and interactive confirmation",
    "Use only official eBay Browse search GET requests after in-memory application-token exchange",
    "Treat sold/completed data as unavailable when the official endpoint does not provide it",
    "Normalize comparable signals without copying titles, descriptions, images, URLs, or brands",
    "Require real Luna match and human approval before recommending B2-RUN",
    "Keep all draft, offer, listing, write, and publication capabilities disabled",
  ]
}
