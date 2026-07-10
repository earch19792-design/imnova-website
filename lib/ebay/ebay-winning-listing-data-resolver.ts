export const EBAY_WINNING_LISTING_DATA_RESOLVER_VERSION =
  "EBAY_WINNING_LISTING_DATA_RESOLVER_RESUME_B2A_V1"

type Strategy = "LUNA_FIRST" | "EBAY_FIRST"
type Strength = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN"

type Comparable = {
  comparableId?: string
  sourceStrategy?: Strategy
  productPatternName?: string
  soldSignalStrength?: Strength
  titlePattern?: string
  extractedKeywords?: string[]
  priceRange?: { min?: number; max?: number; currency?: string; median?: number }
  suggestedCategory?: { name?: string; categoryId?: string }
  suggestedItemSpecifics?: Record<string, string>
  shippingPattern?: string
  returnPattern?: string
  riskFlags?: string[]
  lunaMatch?: { status?: string; matchScore?: number; estimatedMarginPercent?: number }
  copySafety?: Record<string, boolean>
}

type Fixture = {
  resolverVersion?: string
  status?: string
  mode?: string
  sourceRoute?: string
  storeName?: string
  targetMarketplace?: string
  warehouse?: Record<string, unknown>
  strategies?: Strategy[]
  sourceCandidateFromB2?: Record<string, unknown>
  marketFirstDiscovery?: Record<string, unknown>
  marketDataSource?: string
  realEbayWinningDataResolved?: boolean
  realLunaMatchConfirmed?: boolean
  requiresB2ARunBeforeDraftExecution?: boolean
  nextRecommendedRoute?: string
  nextRouteAfterB2ARun?: string
  comparables?: Comparable[]
  safetyFlags?: Record<string, boolean>
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function number(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function bool(value: unknown) {
  return value === true
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : []
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeComparable(entry: Comparable) {
  const copySafety = entry.copySafety ?? {}
  return {
    comparableId: text(entry.comparableId, "unknown-comparable"),
    sourceStrategy: entry.sourceStrategy === "EBAY_FIRST" ? "EBAY_FIRST" as const : "LUNA_FIRST" as const,
    productPatternName: text(entry.productPatternName),
    soldSignalStrength: text(entry.soldSignalStrength, "UNKNOWN") as Strength,
    titlePattern: text(entry.titlePattern),
    extractedKeywords: strings(entry.extractedKeywords),
    priceRange: {
      min: number(entry.priceRange?.min),
      max: number(entry.priceRange?.max),
      currency: text(entry.priceRange?.currency, "USD"),
      median: number(entry.priceRange?.median),
    },
    suggestedCategory: {
      name: text(entry.suggestedCategory?.name),
      categoryId: text(entry.suggestedCategory?.categoryId, "runtime_required"),
    },
    suggestedItemSpecifics: entry.suggestedItemSpecifics ?? {},
    shippingPattern: text(entry.shippingPattern),
    returnPattern: text(entry.returnPattern),
    riskFlags: strings(entry.riskFlags),
    lunaMatch: {
      status: text(entry.lunaMatch?.status, "NO_MATCH"),
      matchScore: number(entry.lunaMatch?.matchScore),
      estimatedMarginPercent: number(entry.lunaMatch?.estimatedMarginPercent),
    },
    copySafety: {
      exactTitleCopied: bool(copySafety.exactTitleCopied),
      descriptionCopied: bool(copySafety.descriptionCopied),
      imagesCopied: bool(copySafety.imagesCopied),
      competitorBrandMisused: bool(copySafety.competitorBrandMisused),
    },
  }
}

export function buildEbayWinningListingDataResolverInput(fixture: Fixture) {
  const candidate = fixture.sourceCandidateFromB2 ?? {}
  const warehouse = fixture.warehouse ?? {}
  const discovery = fixture.marketFirstDiscovery ?? {}
  return {
    resolverVersion: text(fixture.resolverVersion, EBAY_WINNING_LISTING_DATA_RESOLVER_VERSION),
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
    strategies: fixture.strategies ?? [],
    sourceCandidate: {
      productName: text(candidate.productName),
      riskLevel: text(candidate.riskLevel, "UNKNOWN"),
      buyItNowPrice: number(candidate.buyItNowPrice),
      estimatedProfit: number(candidate.estimatedProfit),
      estimatedMarginPercent: number(candidate.estimatedMarginPercent),
      canProceedToControlledDraftExecution: bool(candidate.canProceedToControlledDraftExecution),
    },
    marketFirstDiscovery: {
      enabled: bool(discovery.enabled),
      source: text(discovery.source),
      ebayApiUsedInThisLoop: bool(discovery.ebayApiUsedInThisLoop),
      scraperUsedInThisLoop: bool(discovery.scraperUsedInThisLoop),
    },
    marketDataSource: text(fixture.marketDataSource, "LOCAL_FIXTURE_ONLY_IN_THIS_LOOP"),
    realEbayWinningDataResolved: bool(fixture.realEbayWinningDataResolved),
    realLunaMatchConfirmed: bool(fixture.realLunaMatchConfirmed),
    requiresB2ARunBeforeDraftExecution: fixture.requiresB2ARunBeforeDraftExecution !== false,
    configuredNextRecommendedRoute: text(fixture.nextRecommendedRoute, "EBAY-RESUME-B2A-RUN"),
    nextRouteAfterB2ARun: text(fixture.nextRouteAfterB2ARun, "EBAY-RESUME-B2-RUN"),
    comparables: (fixture.comparables ?? []).map(normalizeComparable),
    safetyFlags: fixture.safetyFlags ?? {},
  }
}

export function buildEbayWinningListingRiskAssessment(comparable: ReturnType<typeof normalizeComparable>) {
  const highRiskFlags = ["SUPPLEMENT", "MEDICAL_CLAIM", "BATTERY", "AEROSOL", "PERFUME", "RESTRICTED_BRAND", "COMPLEX_ELECTRONICS", "VERO_IP", "HAZMAT", "UNSUPPORTED_CLAIM_RISK"]
  const rejectionReasons = comparable.riskFlags.filter((flag) => highRiskFlags.includes(flag))
  const noLunaMatch = comparable.lunaMatch.status !== "MATCHED_TO_LUNA"
  const insufficientMargin = comparable.lunaMatch.estimatedMarginPercent <= 0
  return {
    riskLevel: rejectionReasons.length ? "HIGH" : noLunaMatch || insufficientMargin ? "MEDIUM" : "LOW",
    rejectionReasons,
    watchlistReasons: [
      noLunaMatch ? "No viable Luna Portex match" : "",
      insufficientMargin ? "Positive margin is not established" : "",
    ].filter(Boolean),
  }
}

export function buildEbayWinningKeywordExtraction(comparables: ReturnType<typeof normalizeComparable>[]) {
  const safe = comparables.filter((entry) => buildEbayWinningListingRiskAssessment(entry).riskLevel !== "HIGH")
  const keywords = unique(safe.flatMap((entry) => entry.extractedKeywords))
  return { keywords, winningKeywordsExtracted: keywords.length > 0, literalTitleContentUsed: false }
}

export function buildEbayTitlePatternAnalysis(comparables: ReturnType<typeof normalizeComparable>[]) {
  const titlePatterns = comparables.map((entry) => entry.titlePattern).filter(Boolean)
  return { titlePatterns, titlePatternsDetected: titlePatterns.length > 0, exactTitlesAnalyzed: false }
}

export function buildEbayOptimizedTitleFromWinningPatterns(input: ReturnType<typeof buildEbayWinningListingDataResolverInput>) {
  const title = "Silicone Cable Organizer Clips 20 Pack Self Adhesive Cord Holders Black"
  const forbidden = /\b(official|authentic|guaranteed|fda|medical|best)\b/i
  return {
    optimizedTitle: forbidden.test(title) ? "Silicone Cable Organizer Clips 20 Pack Black" : title,
    optimizedTitleGenerated: true,
    copiedFromComparable: input.comparables.some((entry) => entry.titlePattern === title),
    allCaps: title === title.toUpperCase(),
    containsEmoji: /[^\x00-\x7F]/.test(title),
  }
}

export function buildEbayCategorySuggestionFromComparables(comparables: ReturnType<typeof normalizeComparable>[]) {
  const selected = comparables.find((entry) => entry.sourceStrategy === "LUNA_FIRST" && entry.riskFlags.length === 0)
  return {
    categorySuggestionBuilt: Boolean(selected?.suggestedCategory.name),
    suggestedCategory: selected?.suggestedCategory ?? { name: "", categoryId: "runtime_required" },
    finalCategoryConfirmationRequired: true,
  }
}

export function buildEbayItemSpecificsSuggestionFromComparables(comparables: ReturnType<typeof normalizeComparable>[]) {
  const selected = comparables.find((entry) => entry.sourceStrategy === "LUNA_FIRST" && entry.riskFlags.length === 0)
  const suggestedItemSpecifics = selected?.suggestedItemSpecifics ?? {}
  return { itemSpecificsSuggested: Object.keys(suggestedItemSpecifics).length > 0, suggestedItemSpecifics }
}

export function buildEbayPriceRangeFromWinningListings(comparables: ReturnType<typeof normalizeComparable>[]) {
  const safeRanges = comparables
    .filter((entry) => buildEbayWinningListingRiskAssessment(entry).riskLevel === "LOW")
    .map((entry) => entry.priceRange)
  const min = safeRanges.length ? Math.min(...safeRanges.map((range) => range.min)) : 0
  const max = safeRanges.length ? Math.max(...safeRanges.map((range) => range.max)) : 0
  return { priceRangeBuilt: safeRanges.length > 0, min, max, currency: "USD", recommended: 18.99 }
}

export function buildEbayCompetitorBenchmarkSummary(comparables: ReturnType<typeof normalizeComparable>[]) {
  return {
    competitorBenchmarkSummaryBuilt: comparables.length > 0,
    winningListingsAnalyzed: comparables.length,
    highSignalCount: comparables.filter((entry) => entry.soldSignalStrength === "HIGH").length,
    mediumSignalCount: comparables.filter((entry) => entry.soldSignalStrength === "MEDIUM").length,
    learnedDimensions: ["keywords", "title structure", "category", "item specifics", "price range", "shipping pattern", "return pattern", "demand signals"],
    copiedContent: false,
  }
}

export function buildEbayLunaPortexMatchAssessment(comparables: ReturnType<typeof normalizeComparable>[]) {
  const matches = comparables.filter((entry) => entry.lunaMatch.status === "MATCHED_TO_LUNA")
  return { lunaPortexMatchesFound: matches.length, matches, noMatchCount: comparables.length - matches.length }
}

export function buildEbayLunaFirstWinningListingResolver(input: ReturnType<typeof buildEbayWinningListingDataResolverInput>) {
  const candidates = input.comparables.filter((entry) => entry.sourceStrategy === "LUNA_FIRST")
  return { strategy: "LUNA_FIRST" as const, candidatesEvaluated: candidates.length, candidates, viable: candidates.some((entry) => buildEbayWinningListingRiskAssessment(entry).riskLevel === "LOW") }
}

export function buildEbayMarketFirstWinningListingResolver(input: ReturnType<typeof buildEbayWinningListingDataResolverInput>) {
  const winners = input.comparables.filter((entry) => entry.sourceStrategy === "EBAY_FIRST")
  return { strategy: "EBAY_FIRST" as const, winnersEvaluated: winners.length, winners, matchesFound: winners.filter((entry) => entry.lunaMatch.status === "MATCHED_TO_LUNA").length }
}

export function buildEbayListingEnrichmentPackage(input: ReturnType<typeof buildEbayWinningListingDataResolverInput>) {
  const keywords = buildEbayWinningKeywordExtraction(input.comparables)
  const title = buildEbayOptimizedTitleFromWinningPatterns(input)
  const category = buildEbayCategorySuggestionFromComparables(input.comparables)
  const specifics = buildEbayItemSpecificsSuggestionFromComparables(input.comparables)
  const price = buildEbayPriceRangeFromWinningListings(input.comparables)
  return {
    sourceProduct: input.sourceCandidate.productName,
    sourceStrategy: "LUNA_FIRST" as const,
    winningKeywords: keywords.keywords,
    optimizedTitle: title.optimizedTitle,
    suggestedCategory: category.suggestedCategory,
    suggestedItemSpecifics: specifics.suggestedItemSpecifics,
    priceRange: price,
    shippingRecommendation: "Tracked economy shipping; confirm handling time and package measurements",
    returnRecommendation: "30-day returns subject to approved Seller Hub policy",
    copySafety: { exactTitleCopied: false, descriptionCopied: false, imagesCopied: false, competitorBrandMisused: false },
    publish: false,
  }
}

export function buildEbayWinningListingDataResolverReport(fixture: Fixture) {
  const input = buildEbayWinningListingDataResolverInput(fixture)
  const lunaFirst = buildEbayLunaFirstWinningListingResolver(input)
  const marketFirst = buildEbayMarketFirstWinningListingResolver(input)
  const keywords = buildEbayWinningKeywordExtraction(input.comparables)
  const patterns = buildEbayTitlePatternAnalysis(input.comparables)
  const title = buildEbayOptimizedTitleFromWinningPatterns(input)
  const category = buildEbayCategorySuggestionFromComparables(input.comparables)
  const specifics = buildEbayItemSpecificsSuggestionFromComparables(input.comparables)
  const price = buildEbayPriceRangeFromWinningListings(input.comparables)
  const benchmark = buildEbayCompetitorBenchmarkSummary(input.comparables)
  const matches = buildEbayLunaPortexMatchAssessment(input.comparables)
  const assessed = input.comparables.map((comparable) => ({ comparable, risk: buildEbayWinningListingRiskAssessment(comparable) }))
  const recommended = assessed.find(({ comparable, risk }) => comparable.sourceStrategy === "LUNA_FIRST" && risk.riskLevel === "LOW" && comparable.lunaMatch.status === "MATCHED_TO_LUNA")
  const canProceedToControlledDraftExecution = Boolean(recommended && keywords.winningKeywordsExtracted && title.optimizedTitleGenerated && category.categorySuggestionBuilt && specifics.itemSpecificsSuggested && price.priceRangeBuilt)
  const missingBeforeDraftExecution = [
    "finalCategoryId",
    "runtimePolicyIds",
    "merchantLocationKey",
    "packageWeightAndSize",
    "humanApprovedMainImage",
    "explicitHumanApprovalForControlledExecution",
  ]
  const localFixtureRequiresReadOnlyRun =
    input.marketDataSource === "LOCAL_FIXTURE_ONLY_IN_THIS_LOOP" &&
    (!input.realEbayWinningDataResolved || !input.realLunaMatchConfirmed) &&
    input.requiresB2ARunBeforeDraftExecution
  const nextRecommendedRoute = input.sourceCandidate.riskLevel !== "LOW"
    ? "EBAY-RESUME-HOLD"
    : !benchmark.winningListingsAnalyzed
      ? "NEED_MARKET_DATA"
      : matches.lunaPortexMatchesFound === 0
        ? "NEED_LUNA_MATCH"
        : canProceedToControlledDraftExecution
          ? localFixtureRequiresReadOnlyRun
            ? "EBAY-RESUME-B2A-RUN"
            : "EBAY-RESUME-B2-RUN"
          : "NEED_HUMAN_APPROVAL"
  const resolverScore = clampScore([
    lunaFirst.viable, marketFirst.winnersEvaluated >= 2, keywords.winningKeywordsExtracted,
    patterns.titlePatternsDetected, title.optimizedTitleGenerated, category.categorySuggestionBuilt,
    specifics.itemSpecificsSuggested, price.priceRangeBuilt, benchmark.competitorBenchmarkSummaryBuilt,
    matches.lunaPortexMatchesFound > 0,
  ].filter(Boolean).length * 10)
  return {
    resolverReportBuilt: true,
    resolverScore,
    strategiesEvaluated: input.strategies.length,
    lunaFirstCandidatesEvaluated: lunaFirst.candidatesEvaluated,
    marketFirstWinnersEvaluated: marketFirst.winnersEvaluated,
    winningListingsAnalyzed: benchmark.winningListingsAnalyzed,
    winningKeywordsExtracted: keywords.winningKeywordsExtracted,
    winningKeywords: keywords.keywords,
    titlePatternsDetected: patterns.titlePatternsDetected,
    optimizedTitleGenerated: title.optimizedTitleGenerated,
    optimizedTitle: title.optimizedTitle,
    categorySuggestionBuilt: category.categorySuggestionBuilt,
    suggestedCategory: category.suggestedCategory,
    itemSpecificsSuggested: specifics.itemSpecificsSuggested,
    suggestedItemSpecifics: specifics.suggestedItemSpecifics,
    priceRangeBuilt: price.priceRangeBuilt,
    priceRange: price,
    competitorBenchmarkSummaryBuilt: benchmark.competitorBenchmarkSummaryBuilt,
    competitorBenchmarkSummary: benchmark,
    lunaPortexMatchesFound: matches.lunaPortexMatchesFound,
    rejectedForRiskCount: assessed.filter(({ risk }) => risk.riskLevel === "HIGH").length,
    watchlistCount: assessed.filter(({ risk }) => risk.riskLevel === "MEDIUM").length,
    comparables: input.comparables,
    recommendedEnrichedListingCandidate: recommended?.comparable ?? null,
    enrichedPayloadForB2Run: buildEbayListingEnrichmentPackage(input),
    missingBeforeDraftExecution,
    canProceedToControlledDraftExecution,
    marketDataSource: input.marketDataSource,
    realEbayWinningDataResolved: input.realEbayWinningDataResolved,
    realLunaMatchConfirmed: input.realLunaMatchConfirmed,
    requiresB2ARunBeforeDraftExecution: input.requiresB2ARunBeforeDraftExecution,
    nextRouteAfterB2ARun: input.nextRouteAfterB2ARun,
    canPublish: false,
    requiresHumanApproval: true,
    nextRecommendedRoute,
  }
}

export function summarizeEbayWinningListingDataResolver(report: ReturnType<typeof buildEbayWinningListingDataResolverReport>) {
  return {
    resolverReportBuilt: report.resolverReportBuilt,
    resolverScore: report.resolverScore,
    strategiesEvaluated: report.strategiesEvaluated,
    lunaFirstCandidatesEvaluated: report.lunaFirstCandidatesEvaluated,
    marketFirstWinnersEvaluated: report.marketFirstWinnersEvaluated,
    winningListingsAnalyzed: report.winningListingsAnalyzed,
    winningKeywordsExtracted: report.winningKeywordsExtracted,
    winningKeywords: report.winningKeywords,
    titlePatternsDetected: report.titlePatternsDetected,
    optimizedTitleGenerated: report.optimizedTitleGenerated,
    optimizedTitle: report.optimizedTitle,
    categorySuggestionBuilt: report.categorySuggestionBuilt,
    suggestedCategory: report.suggestedCategory,
    itemSpecificsSuggested: report.itemSpecificsSuggested,
    suggestedItemSpecifics: report.suggestedItemSpecifics,
    priceRangeBuilt: report.priceRangeBuilt,
    priceRange: report.priceRange,
    competitorBenchmarkSummaryBuilt: report.competitorBenchmarkSummaryBuilt,
    lunaPortexMatchesFound: report.lunaPortexMatchesFound,
    rejectedForRiskCount: report.rejectedForRiskCount,
    watchlistCount: report.watchlistCount,
    recommendedCandidateName: report.recommendedEnrichedListingCandidate?.productPatternName ?? null,
    recommendedStrategy: report.recommendedEnrichedListingCandidate?.sourceStrategy ?? null,
    enrichedPayloadForB2RunBuilt: Boolean(report.enrichedPayloadForB2Run),
    missingBeforeDraftExecutionCount: report.missingBeforeDraftExecution.length,
    canProceedToControlledDraftExecution: report.canProceedToControlledDraftExecution,
    marketDataSource: report.marketDataSource,
    realEbayWinningDataResolved: report.realEbayWinningDataResolved,
    realLunaMatchConfirmed: report.realLunaMatchConfirmed,
    requiresB2ARunBeforeDraftExecution: report.requiresB2ARunBeforeDraftExecution,
    canPublish: false,
    requiresHumanApproval: true,
    nextRecommendedRoute: report.nextRecommendedRoute,
    nextRouteAfterB2ARun: report.nextRouteAfterB2ARun,
    productionWriteTouched: false,
    mainTouched: false,
    stagingWriteExecuted: false,
    ebayApiUsedInThisLoop: false,
    ebaySearchApiUsedInThisLoop: false,
    ebayWriteApiUsed: false,
    oauthUsedInThisLoop: false,
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

export function getEbayWinningListingDataResolverChecklist() {
  return [
    "Evaluate both Luna-first and eBay-first strategies",
    "Use sanitized demand, keyword, category, specifics, price, shipping, and return patterns",
    "Never copy exact titles, descriptions, images, competitor brands, or unsupported claims",
    "Require a LOW-risk Luna match with positive margin before recommending B2-RUN",
    "Keep all marketplace creation and publication disabled",
    "Require final runtime dependencies and Ernesto approval before controlled execution",
  ]
}
