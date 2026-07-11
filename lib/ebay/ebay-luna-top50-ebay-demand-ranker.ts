export const EBAY_LUNA_TOP50_EBAY_DEMAND_RANKER_VERSION = "EBAY_LUNA_TOP50_EBAY_DEMAND_RANKER_B2A_V1"

type Row = Record<string, unknown>
type Candidate = Row & { candidateId?: string; productName?: string; keywords?: unknown[]; riskFlags?: unknown[] }
type Demand = Row & { candidateId?: string; ebayDemandSignal?: Row }
type Fixture = Row & {
  previousCandidateConfirmed?: Row
  lunaScanTop50Candidates?: Candidate[]
  ebayObservedDemandSignals?: Demand[]
  rankingWeights?: Row
  humanTopProductSelection?: Row
}

const text = (value: unknown, fallback = "") => typeof value === "string" && value.trim() ? value.trim() : fallback
const number = (value: unknown, fallback = 0) => {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
const bool = (value: unknown) => value === true
const strings = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
const record = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {}
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value * 100) / 100))

export function buildEbayLunaTop50DemandRankerInput(fixture: Fixture, simulatedSelection?: string) {
  return {
    version: text(fixture.version, EBAY_LUNA_TOP50_EBAY_DEMAND_RANKER_VERSION),
    status: text(fixture.status),
    sourceRoute: text(fixture.sourceRoute),
    previousCandidateConfirmed: fixture.previousCandidateConfirmed ?? {},
    routeInsertedBefore: fixture.routeInsertedBefore ?? [],
    correctedRoute: fixture.correctedRoute ?? [],
    requiresRealLunaCatalogFile: bool(fixture.requiresRealLunaCatalogFile),
    requiresWarehouseConsultation: bool(fixture.requiresWarehouseConsultation),
    requiresManualProductSearch: bool(fixture.requiresManualProductSearch),
    usesLunaScanCandidates: bool(fixture.usesLunaScanCandidates),
    usesEbayMarketObservedData: bool(fixture.usesEbayMarketObservedData),
    usesHumanFinalSelection: bool(fixture.usesHumanFinalSelection),
    salesGuaranteeClaimAllowed: bool(fixture.salesGuaranteeClaimAllowed),
    imageCopyAllowed: bool(fixture.imageCopyAllowed),
    imageGenerationUsed: bool(fixture.imageGenerationUsed),
    realEbayApiUsedInThisLoop: bool(fixture.realEbayApiUsedInThisLoop),
    candidates: (fixture.lunaScanTop50Candidates ?? []).slice(0, 50),
    demandSignals: fixture.ebayObservedDemandSignals ?? [],
    weights: fixture.rankingWeights ?? {},
    humanSelection: { ...record(fixture.humanTopProductSelection), simulatedSelection: simulatedSelection ?? null },
  }
}

export function normalizeLunaTop50Candidate(candidate: Candidate) {
  return {
    candidateId: text(candidate.candidateId), productName: text(candidate.productName),
    normalizedName: text(candidate.normalizedName, text(candidate.productName).toLowerCase()),
    categoryHint: text(candidate.categoryHint), keywords: strings(candidate.keywords),
    packSignal: text(candidate.packSignal, "pack unclear"), colorSignal: text(candidate.colorSignal, "UNKNOWN"),
    materialSignal: text(candidate.materialSignal, "UNKNOWN"), availabilitySignal: text(candidate.availabilitySignal, "UNKNOWN"),
    imageReferencePresent: bool(candidate.imageReferencePresent), riskFlags: strings(candidate.riskFlags),
    source: "LUNA_SCAN_OBSERVED",
  }
}

export function buildTop50CandidateSetFromLunaScan(input: ReturnType<typeof buildEbayLunaTop50DemandRankerInput>) {
  const candidates = input.candidates.map(normalizeLunaTop50Candidate)
  return { top50Loaded: candidates.length === 50, candidatesLoaded: candidates.length, candidates }
}

export function buildEbayDemandQueryForLunaCandidate(candidate: ReturnType<typeof normalizeLunaTop50Candidate>) {
  return { candidateId: candidate.candidateId, queryBuilt: true, searchTerms: candidate.keywords, categoryHint: candidate.categoryHint, dataSource: "LUNA_SCAN_OBSERVED_QUERY_ONLY" }
}

export function scoreEbayDemandForCandidate(signal: Row) {
  if (!bool(signal.demandObserved)) return clamp(number(signal.movementSignalScore) * 0.35)
  return clamp(number(signal.movementSignalScore) * 0.6 + number(signal.successfulListingSignalScore) * 0.4)
}

export function scoreLunaCandidateMatchStrength(candidate: ReturnType<typeof normalizeLunaTop50Candidate>, signal: Row) {
  const observedKeywords = strings(signal.keywordClusters).map((word) => word.toLowerCase())
  const matches = candidate.keywords.filter((keyword) => observedKeywords.some((observed) => observed.includes(keyword.toLowerCase()) || keyword.toLowerCase().includes(observed)))
  const lexical = candidate.keywords.length ? matches.length / candidate.keywords.length * 65 : 0
  const category = text(signal.categorySignal).toLowerCase() === candidate.categoryHint.toLowerCase() ? 20 : 0
  const available = candidate.availabilitySignal === "AVAILABLE" ? 15 : 5
  return clamp(lexical + category + available)
}

export function scorePriceOpportunity(signal: Row) {
  const average = number(signal.averagePrice)
  const spread = Math.max(0, number(signal.priceRangeMax) - number(signal.priceRangeMin))
  const competition = text(signal.competitionLevel)
  return clamp((average >= 15 ? 55 : average >= 10 ? 40 : 25) + Math.min(25, spread * 2) + (competition === "LOW" ? 20 : competition === "MEDIUM" ? 10 : 0))
}

export function scoreListingQualityGap(signal: Row) { return clamp(number(signal.listingQualityGapScore)) }
export function scorePackClarity(candidate: ReturnType<typeof normalizeLunaTop50Candidate>, signal: Row) {
  const candidateClear = !/unclear|unknown/i.test(candidate.packSignal)
  const observedClear = !/unclear|unknown/i.test(text(signal.packWinningPattern))
  return candidateClear && observedClear ? 100 : candidateClear || observedClear ? 55 : 10
}
export function scoreImageReadiness(candidate: ReturnType<typeof normalizeLunaTop50Candidate>, signal: Row) {
  return candidate.imageReferencePresent && text(signal.imagePatternObservedForReviewOnly) ? 100 : text(signal.imagePatternObservedForReviewOnly) ? 45 : 0
}
export function buildRiskPenalty(candidate: ReturnType<typeof normalizeLunaTop50Candidate>) {
  const riskPenalty = Math.min(20, candidate.riskFlags.length * 10)
  return { riskPenalty, highRisk: candidate.riskFlags.length > 0, riskFlags: candidate.riskFlags }
}
export function buildSupplierUnknownPenalty(candidate: ReturnType<typeof normalizeLunaTop50Candidate>) {
  const unknowns = [candidate.availabilitySignal === "UNKNOWN", /unclear|unknown/i.test(candidate.packSignal), !candidate.imageReferencePresent].filter(Boolean).length
  return { supplierUnknownPenalty: Math.min(10, unknowns * 3.34), supplierUnknownSignals: unknowns }
}

export function buildTop50OpportunityScore(candidate: ReturnType<typeof normalizeLunaTop50Candidate>, demand: Row) {
  const ebayDemandScore = scoreEbayDemandForCandidate(demand)
  const lunaCandidateMatchScore = scoreLunaCandidateMatchStrength(candidate, demand)
  const priceOpportunityScore = scorePriceOpportunity(demand)
  const listingQualityGapScore = scoreListingQualityGap(demand)
  const packClarityScore = scorePackClarity(candidate, demand)
  const imageReadinessScore = scoreImageReadiness(candidate, demand)
  const risk = buildRiskPenalty(candidate)
  const supplier = buildSupplierUnknownPenalty(candidate)
  const opportunityScore = clamp(
    ebayDemandScore * 0.30 + lunaCandidateMatchScore * 0.20 + priceOpportunityScore * 0.15
    + listingQualityGapScore * 0.15 + packClarityScore * 0.10 + imageReadinessScore * 0.10
    - risk.riskPenalty - supplier.supplierUnknownPenalty,
  )
  return { opportunityScore, ebayDemandScore, lunaCandidateMatchScore, priceOpportunityScore, listingQualityGapScore, packClarityScore, imageReadinessScore, ...risk, ...supplier }
}

export function rankLunaCandidatesAgainstEbayDemand(input: ReturnType<typeof buildEbayLunaTop50DemandRankerInput>) {
  const set = buildTop50CandidateSetFromLunaScan(input)
  const demandById = new Map(input.demandSignals.map((entry) => [text(entry.candidateId), record(entry.ebayDemandSignal)]))
  const ranked = set.candidates.map((candidate) => {
    const demand = demandById.get(candidate.candidateId) ?? {}
    return { candidate, demandQuery: buildEbayDemandQueryForLunaCandidate(candidate), demand, ...buildTop50OpportunityScore(candidate, demand) }
  }).sort((a, b) => b.opportunityScore - a.opportunityScore || a.candidate.candidateId.localeCompare(b.candidate.candidateId))
    .map((entry, index) => ({ rank: index + 1, ...entry, status: entry.highRisk ? "EBAY-RESUME-HOLD" : "RANKED_FOR_HUMAN_REVIEW" }))
  return { top50Ranked: ranked.length === 50, ebayDemandComparedCount: ranked.length, ranked }
}

export function buildTop10Recommendations(ranking: ReturnType<typeof rankLunaCandidatesAgainstEbayDemand>) {
  return { top10Built: ranking.ranked.length >= 10, top10Recommended: ranking.ranked.filter((entry) => !entry.highRisk).slice(0, 10) }
}

export function buildImageOptimizationBlueprintForReviewOnly(signal: Row, candidate: ReturnType<typeof normalizeLunaTop50Candidate>) {
  return {
    mainImagePattern: "Own or authorized product on a clean white background",
    secondaryImageAngles: ["front", "side", "adhesive or functional detail", "in-use context"],
    packQuantityVisualRequirement: candidate.packSignal,
    lifestyleImageNeeded: true, sizeDimensionImageNeeded: true,
    observedStructureForReviewOnly: text(signal.imagePatternObservedForReviewOnly),
    noCompetitorImageCopy: true,
    imageSourcePolicy: {
      lunaScanImageIfPresent: "LUNA_SCAN_OBSERVED_FOR_REVIEW",
      ebayImages: "EBAY_REFERENCE_FOR_STRUCTURE_ONLY",
      generatedOrOwnImageRequiredBeforePublish: true,
    },
  }
}

export function buildListingBlueprintFromEbayWinningStructure(entry: ReturnType<typeof rankLunaCandidatesAgainstEbayDemand>["ranked"][number]) {
  const keywords = strings(entry.demand.keywordClusters)
  const titleParts = [entry.candidate.productName, ...keywords].join(" ").split(/\s+/)
  const uniqueTitle = [...new Set(titleParts.map((part) => part.toLowerCase()))].map((part) => part.replace(/^\w/, (letter) => letter.toUpperCase())).join(" ").slice(0, 80)
  return {
    rank: entry.rank, candidateId: entry.candidate.candidateId, productName: entry.candidate.productName,
    recommendedTitle: uniqueTitle, titleSource: "EBAY_MARKET_OBSERVED",
    keywordCluster: keywords, categorySignal: text(entry.demand.categorySignal),
    itemSpecifics: record(entry.demand.itemSpecificsObserved), recommendedPrice: number(entry.demand.averagePrice),
    priceRange: { min: number(entry.demand.priceRangeMin), max: number(entry.demand.priceRangeMax), currency: "USD" },
    packStrategy: text(entry.demand.packWinningPattern),
    descriptionBulletStructure: ["primary use", "material and form", "pack quantity", "installation or handling", "compatibility limits"],
    imageOptimizationBlueprint: buildImageOptimizationBlueprintForReviewOnly(entry.demand, entry.candidate),
    riskFlags: entry.candidate.riskFlags,
    missingSupplierFields: ["supplierCost", "supplierStock"],
    readinessStatus: "HUMAN_TOP_PRODUCT_SELECTION_REQUIRED",
    routeRecommendation: "NEED_HUMAN_TOP_PRODUCT_SELECTION",
  }
}

export function buildTop5ListingBlueprints(ranking: ReturnType<typeof rankLunaCandidatesAgainstEbayDemand>) {
  const safe = ranking.ranked.filter((entry) => !entry.highRisk).slice(0, 5)
  return { top5BlueprintsBuilt: safe.length === 5, top5Recommended: safe, listingBlueprints: safe.map(buildListingBlueprintFromEbayWinningStructure) }
}

export function buildHumanTopProductSelectionCard(top5: ReturnType<typeof buildTop5ListingBlueprints>) {
  return { selectionCardBuilt: true, status: "PENDING", prompt: "Selecciona el producto final del Top 5 para el preflight B2-RUN.", options: top5.top5Recommended.map((entry) => ({ rank: entry.rank, candidateId: entry.candidate.candidateId, productName: entry.candidate.productName, opportunityScore: entry.opportunityScore })), realWhatsappSendUsed: false }
}

export function applyHumanTopProductSelection(input: ReturnType<typeof buildEbayLunaTop50DemandRankerInput>, ranking: ReturnType<typeof rankLunaCandidatesAgainstEbayDemand>) {
  const simulation = input.humanSelection.simulatedSelection
  if (simulation === "TOP50_HUMAN_SELECTED_RANK_1") return { humanTopProductSelectionStatus: "SELECTED_RANK_1", humanSelectedCandidate: ranking.ranked[0] ?? null }
  if (simulation === "TOP50_HUMAN_REJECTED_ALL") return { humanTopProductSelectionStatus: "REJECTED_ALL", humanSelectedCandidate: null }
  return { humanTopProductSelectionStatus: "PENDING", humanSelectedCandidate: null }
}

export function buildTop50RankerRouteRecommendation(selection: ReturnType<typeof applyHumanTopProductSelection>, ranking: ReturnType<typeof rankLunaCandidatesAgainstEbayDemand>) {
  const allHighRisk = ranking.ranked.every((entry) => entry.highRisk)
  const nextRecommendedRoute = allHighRisk ? "EBAY-RESUME-HOLD"
    : selection.humanTopProductSelectionStatus === "SELECTED_RANK_1" ? "EBAY-RESUME-B2-RUN-PREFLIGHT"
      : selection.humanTopProductSelectionStatus === "REJECTED_ALL" ? "NEED_LUNA_SCAN_REFRESH"
        : "NEED_HUMAN_TOP_PRODUCT_SELECTION"
  return { nextRecommendedRoute, canProceedToB2Run: nextRecommendedRoute === "EBAY-RESUME-B2-RUN-PREFLIGHT", canPublish: false, requiresHumanTopProductSelection: true }
}

export function buildEbayLunaTop50DemandRankerReport(fixture: Fixture, simulatedSelection?: string) {
  const input = buildEbayLunaTop50DemandRankerInput(fixture, simulatedSelection)
  const set = buildTop50CandidateSetFromLunaScan(input)
  const ranking = rankLunaCandidatesAgainstEbayDemand(input)
  const top10 = buildTop10Recommendations(ranking)
  const top5 = buildTop5ListingBlueprints(ranking)
  const selectionCard = buildHumanTopProductSelectionCard(top5)
  const selection = applyHumanTopProductSelection(input, ranking)
  const route = buildTop50RankerRouteRecommendation(selection, ranking)
  const previousName = text(input.previousCandidateConfirmed.candidateName)
  const previous = ranking.ranked.find((entry) => entry.candidate.productName === previousName)
  const selected = ranking.ranked[0] ?? null
  return {
    top50DemandRankerReportBuilt: true,
    top50CandidatesLoaded: set.candidatesLoaded, top50CandidatesNormalized: set.candidates.length,
    ebayDemandComparedCount: ranking.ebayDemandComparedCount, top50Ranked: ranking.top50Ranked,
    ...top10, ...top5,
    selectedRecommendedCandidate: selected?.candidate.productName ?? null,
    selectedRecommendedScore: selected?.opportunityScore ?? 0,
    previousSingleConfirmedCandidateRank: previous?.rank ?? null,
    previousSingleConfirmedCandidateStillRecommended: Boolean(previous && previous.rank <= 10 && !previous.highRisk),
    rankingReason: "Observed eBay demand, Luna candidate fit, price opportunity, listing quality gap, pack clarity, image readiness and explicit penalties.",
    ...selectionCard, ...selection, ...route,
    salesGuaranteeClaimAllowed: input.salesGuaranteeClaimAllowed,
    imageCopyAllowed: input.imageCopyAllowed, imageGenerationUsed: input.imageGenerationUsed,
    realEbayApiUsedInThisLoop: input.realEbayApiUsedInThisLoop,
    requiresRealLunaCatalogFile: input.requiresRealLunaCatalogFile,
    requiresWarehouseConsultation: input.requiresWarehouseConsultation,
    requiresManualProductSearch: input.requiresManualProductSearch,
    usesLunaScanCandidates: input.usesLunaScanCandidates, usesEbayMarketObservedData: input.usesEbayMarketObservedData,
    productionWriteTouched: false, mainTouched: false, stagingWriteExecuted: false,
    ebayApiUsed: false, oauthUsed: false, tokenStored: false, tokensPrinted: false,
    draftCreated: false, listingCreated: false, offerCreated: false, publicationExecuted: false,
    scraperUsed: false, amazonTrackTouched: false, whatsappRealSendUsed: false, openAiUsed: false,
    fullWarehouseStreetAddressCommitted: false,
  }
}

export function summarizeEbayLunaTop50DemandRanker(report: ReturnType<typeof buildEbayLunaTop50DemandRankerReport>) {
  return {
    top50DemandRankerReportBuilt: report.top50DemandRankerReportBuilt,
    top50CandidatesLoaded: report.top50CandidatesLoaded, top50CandidatesNormalized: report.top50CandidatesNormalized,
    ebayDemandComparedCount: report.ebayDemandComparedCount, top50Ranked: report.top50Ranked,
    top10Built: report.top10Built, top5BlueprintsBuilt: report.top5BlueprintsBuilt,
    selectedRecommendedCandidate: report.selectedRecommendedCandidate, selectedRecommendedScore: report.selectedRecommendedScore,
    previousSingleConfirmedCandidateRank: report.previousSingleConfirmedCandidateRank,
    previousSingleConfirmedCandidateStillRecommended: report.previousSingleConfirmedCandidateStillRecommended,
    humanTopProductSelectionStatus: report.humanTopProductSelectionStatus,
    canProceedToB2Run: report.canProceedToB2Run, canPublish: report.canPublish,
    requiresHumanTopProductSelection: report.requiresHumanTopProductSelection,
    salesGuaranteeClaimAllowed: report.salesGuaranteeClaimAllowed,
    imageCopyAllowed: report.imageCopyAllowed, imageGenerationUsed: report.imageGenerationUsed,
    realEbayApiUsedInThisLoop: report.realEbayApiUsedInThisLoop,
    nextRecommendedRoute: report.nextRecommendedRoute,
    productionWriteTouched: report.productionWriteTouched, mainTouched: report.mainTouched,
    stagingWriteExecuted: report.stagingWriteExecuted, ebayApiUsedInThisLoop: report.ebayApiUsed,
    oauthUsedInThisLoop: report.oauthUsed, tokenStored: report.tokenStored, tokensPrinted: report.tokensPrinted,
    draftCreated: report.draftCreated, listingCreated: report.listingCreated, offerCreated: report.offerCreated,
    publicationExecuted: report.publicationExecuted, scraperUsed: report.scraperUsed,
    amazonTrackTouched: report.amazonTrackTouched, whatsappRealSendUsed: report.whatsappRealSendUsed,
    openAiUsed: report.openAiUsed, fullWarehouseStreetAddressCommitted: report.fullWarehouseStreetAddressCommitted,
  }
}

export function getEbayLunaTop50DemandRankerChecklist(report: ReturnType<typeof buildEbayLunaTop50DemandRankerReport>) {
  return [
    { id: "top50", passed: report.top50CandidatesLoaded === 50 && report.ebayDemandComparedCount === 50 },
    { id: "ranking", passed: report.top50Ranked && report.top10Built && report.top5BlueprintsBuilt },
    { id: "human-selection", passed: report.humanTopProductSelectionStatus !== "PENDING" },
    { id: "no-guarantee", passed: !report.salesGuaranteeClaimAllowed },
    { id: "image-safety", passed: !report.imageCopyAllowed && !report.imageGenerationUsed },
    { id: "no-publish", passed: !report.canPublish },
  ]
}
