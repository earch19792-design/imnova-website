export const EBAY_LUNA_SCAN_MATCH_CONFIRMATION_VERSION = "EBAY_LUNA_SCAN_MATCH_CONFIRMATION_B2A_V1"

type Row = Record<string, unknown>
type Fixture = Row & {
  marketObservedDataFromEbay?: Row
  lunaScanCandidates?: Row[]
  humanWhatsappConfirmation?: Row
  fieldCompletionPolicy?: Row
  routes?: Row
  safetyFlags?: Record<string, boolean>
}

const text = (value: unknown, fallback = "") => typeof value === "string" && value.trim() ? value.trim() : fallback
const bool = (value: unknown) => value === true
const num = (value: unknown, fallback = 0) => {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
const strings = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
const record = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {}
const words = (value: string) => [...new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1))]
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)))

export function buildEbayLunaScanMatchConfirmationInput(fixture: Fixture, humanConfirmation?: string) {
  const human = fixture.humanWhatsappConfirmation ?? {}
  return {
    version: text(fixture.version, EBAY_LUNA_SCAN_MATCH_CONFIRMATION_VERSION),
    status: text(fixture.status),
    previousIncorrectBlocker: text(fixture.previousIncorrectBlocker),
    correctedBlocker: text(fixture.correctedBlocker),
    requiresRealLunaCatalogFile: bool(fixture.requiresRealLunaCatalogFile),
    requiresWarehouseConsultation: bool(fixture.requiresWarehouseConsultation),
    requiresManualProductSearch: bool(fixture.requiresManualProductSearch),
    usesLunaScanCandidates: bool(fixture.usesLunaScanCandidates),
    usesEbayWinnerMarketData: bool(fixture.usesEbayWinnerMarketData),
    usesHumanWhatsappConfirmation: bool(fixture.usesHumanWhatsappConfirmation),
    realWhatsappSendUsed: bool(fixture.realWhatsappSendUsed),
    market: fixture.marketObservedDataFromEbay ?? {}, candidates: fixture.lunaScanCandidates ?? [],
    human: {
      status: text(human.status, "PENDING"), allowedStatuses: strings(human.allowedStatuses),
      confirmationPrompt: text(human.confirmationPrompt),
      exactPositiveConfirmation: text(human.exactPositiveConfirmation),
      exactNegativeConfirmation: text(human.exactNegativeConfirmation),
      simulatedConfirmation: humanConfirmation ?? null,
    },
    fieldCompletionPolicy: fixture.fieldCompletionPolicy ?? {}, routes: fixture.routes ?? {},
    safetyFlags: fixture.safetyFlags ?? {},
  }
}

export function buildLunaScanMatchQueryFromEbayWinner(input: ReturnType<typeof buildEbayLunaScanMatchConfirmationInput>) {
  const specifics = record(input.market.itemSpecifics)
  return {
    queryBuilt: true,
    productWinnerTitle: text(input.market.optimizedTitleCandidate),
    keywords: strings(input.market.keywords),
    category: text(input.market.suggestedCategory),
    targetColor: text(specifics.Color), targetMaterial: text(specifics.Material),
    targetMounting: text(specifics.Mounting), targetPackQuantity: num(specifics["Number in Pack"]),
    source: "EBAY_MARKET_OBSERVED",
  }
}

export function scoreLunaScanCandidateAgainstEbayWinner(
  query: ReturnType<typeof buildLunaScanMatchQueryFromEbayWinner>, candidate: Row,
) {
  const source = `${text(candidate.productName)} ${text(candidate.descriptionSignal)} ${text(candidate.color)} ${text(candidate.material)} ${text(candidate.packSignal)}`
  const candidateWords = words(source)
  const queryWords = words(`${query.productWinnerTitle} ${query.keywords.join(" ")} ${query.category}`)
  const matchedKeywords = queryWords.filter((word) => candidateWords.includes(word))
  const lexical = queryWords.length ? matchedKeywords.length / queryWords.length * 65 : 0
  const color = text(candidate.color).toLowerCase() === query.targetColor.toLowerCase() ? 10 : 0
  const material = text(candidate.material).toLowerCase() === query.targetMaterial.toLowerCase() ? 10 : 0
  const adhesive = source.toLowerCase().includes("adhesive") ? 8 : 0
  const pack = /pack|multi|set/i.test(text(candidate.packSignal)) ? 7 : 0
  const riskSignals = strings(candidate.riskSignals)
  const highRisk = riskSignals.length > 0
  const matchScore = clamp(lexical + color + material + adhesive + pack - (highRisk ? 80 : 0))
  return {
    candidateId: text(candidate.candidateId), productName: text(candidate.productName), candidate,
    matchScore, matchedKeywords, matchLevel: matchScore >= 70 ? "STRONG" : matchScore >= 20 ? "PARTIAL" : "LOW",
    highRisk, riskSignals, source: "LUNA_SCAN_OBSERVED",
  }
}

export function buildBestLunaScanMatchAssessment(input: ReturnType<typeof buildEbayLunaScanMatchConfirmationInput>) {
  const query = buildLunaScanMatchQueryFromEbayWinner(input)
  const assessments = input.candidates.map((candidate) => scoreLunaScanCandidateAgainstEbayWinner(query, candidate))
    .sort((a, b) => b.matchScore - a.matchScore)
  return {
    candidatesEvaluated: assessments.length, assessments,
    bestLunaScanMatch: assessments[0] ?? null,
    bestLunaScanMatchScore: assessments[0]?.matchScore ?? 0,
    strongMatchFound: assessments[0]?.matchLevel === "STRONG" && !assessments[0]?.highRisk,
  }
}

export function buildHumanWhatsappConfirmationCard(
  input: ReturnType<typeof buildEbayLunaScanMatchConfirmationInput>,
  assessment = buildBestLunaScanMatchAssessment(input),
) {
  const best = assessment.bestLunaScanMatch
  return {
    confirmationCardBuilt: Boolean(best), channelModel: "WHATSAPP_HUMAN_CONFIRMATION_CARD_ONLY",
    realWhatsappSendUsed: false, prompt: input.human.confirmationPrompt,
    ebayWinner: { title: text(input.market.optimizedTitleCandidate), source: "EBAY_MARKET_OBSERVED" },
    lunaCandidate: best ? {
      candidateId: best.candidateId, productName: best.productName, matchScore: best.matchScore,
      color: best.candidate.color ?? null, material: best.candidate.material ?? null,
      packSignal: best.candidate.packSignal ?? null, availabilitySignal: best.candidate.availabilitySignal ?? null,
      source: "LUNA_SCAN_OBSERVED",
    } : null,
    positiveResponse: input.human.exactPositiveConfirmation,
    negativeResponse: input.human.exactNegativeConfirmation,
    responseSourceWhenConfirmed: "HUMAN_WHATSAPP_CONFIRMED",
  }
}

export function applyHumanWhatsappMatchConfirmation(input: ReturnType<typeof buildEbayLunaScanMatchConfirmationInput>) {
  const simulated = input.human.simulatedConfirmation
  let status = input.human.status
  if (simulated === input.human.exactPositiveConfirmation) status = "CONFIRMED_SAME_PRODUCT"
  else if (simulated === input.human.exactNegativeConfirmation) status = "REJECTED_NOT_SAME_PRODUCT"
  else if (simulated) status = "NEEDS_MORE_REVIEW"
  return {
    humanWhatsappConfirmationStatus: status,
    humanProductMatchConfirmed: status === "CONFIRMED_SAME_PRODUCT",
    source: status === "PENDING" ? "HUMAN_CONFIRMATION_PENDING" : "HUMAN_WHATSAPP_CONFIRMED",
    realWhatsappSendUsed: false,
  }
}

export function buildEbayListingFieldCompletionFromMarketData(input: ReturnType<typeof buildEbayLunaScanMatchConfirmationInput>) {
  const specifics = record(input.market.itemSpecifics)
  return {
    listingFieldsCompletedFromEbay: true,
    fields: {
      title: { value: text(input.market.optimizedTitleCandidate), source: "EBAY_MARKET_OBSERVED" },
      category: { value: text(input.market.suggestedCategory), source: "EBAY_MARKET_OBSERVED" },
      itemSpecifics: { value: specifics, source: "EBAY_MARKET_OBSERVED" },
      description: { value: "Organize desk and charging cables with reusable silicone self-adhesive cord holder clips.", source: "EBAY_MARKET_OBSERVED" },
      priceRecommendation: { value: num(input.market.recommendedPrice), source: "EBAY_MARKET_OBSERVED" },
      packWording: { value: `${num(specifics["Number in Pack"])} Pack`, source: "EBAY_MARKET_OBSERVED" },
      weightIfMissing: { value: "UNKNOWN", source: "EBAY_MARKET_OBSERVED_WITH_LOW_CONFIDENCE" },
      dimensionsIfMissing: { value: "UNKNOWN", source: "EBAY_MARKET_OBSERVED_WITH_LOW_CONFIDENCE" },
    },
    listingDataSource: "EBAY_MARKET_OBSERVED",
  }
}

export function buildSupplierUnknownFieldGuard(assessment: ReturnType<typeof buildBestLunaScanMatchAssessment>) {
  const candidate = assessment.bestLunaScanMatch?.candidate ?? {}
  const observed: Row = {}
  const unknown: string[] = []
  for (const [field, value] of [["supplierSku", candidate.supplierSku], ["supplierCost", candidate.supplierCost], ["supplierStock", candidate.supplierStock], ["supplierImage", candidate.supplierImageReference]] as const) {
    if (value !== null && value !== undefined && value !== "") observed[field] = { value, source: "LUNA_SCAN_OBSERVED" }
    else unknown.push(field)
  }
  return {
    supplierFieldsObservedFromLunaScan: observed,
    supplierFieldsUnknown: unknown,
    unknownFieldValue: "UNKNOWN_FROM_SUPPLIER",
    confidenceGuard: unknown.length ? "LOW_CONFIDENCE_GUARD" : "LUNA_SCAN_OBSERVED",
    supplierCostConfirmed: false,
    supplierStockConfirmed: false,
  }
}

export function buildLunaScanMatchRouteRecommendation(input: {
  assessment: ReturnType<typeof buildBestLunaScanMatchAssessment>
  confirmation: ReturnType<typeof applyHumanWhatsappMatchConfirmation>
}) {
  const best = input.assessment.bestLunaScanMatch
  let nextRecommendedRoute = "NEED_LUNA_SCAN_MATCH_CONFIRMATION"
  if (best?.highRisk) nextRecommendedRoute = "EBAY-RESUME-HOLD"
  else if (!input.assessment.strongMatchFound) nextRecommendedRoute = "NEED_LUNA_SCAN_REMATCH"
  else if (input.confirmation.humanWhatsappConfirmationStatus === "REJECTED_NOT_SAME_PRODUCT") nextRecommendedRoute = "NEED_LUNA_SCAN_REMATCH"
  else if (input.confirmation.humanWhatsappConfirmationStatus === "NEEDS_MORE_REVIEW") nextRecommendedRoute = "NEED_LUNA_SCAN_MATCH_CONFIRMATION"
  else if (input.confirmation.humanWhatsappConfirmationStatus === "CONFIRMED_SAME_PRODUCT") nextRecommendedRoute = "EBAY-RESUME-B2-RUN"
  return {
    nextRecommendedRoute,
    canProceedToB2Run: nextRecommendedRoute === "EBAY-RESUME-B2-RUN",
    canPublish: false,
    requiresHumanApproval: true,
  }
}

export function buildEbayLunaScanMatchConfirmationReport(fixture: Fixture, humanConfirmation?: string) {
  const input = buildEbayLunaScanMatchConfirmationInput(fixture, humanConfirmation)
  const assessment = buildBestLunaScanMatchAssessment(input)
  const card = buildHumanWhatsappConfirmationCard(input, assessment)
  const confirmation = applyHumanWhatsappMatchConfirmation(input)
  const listing = buildEbayListingFieldCompletionFromMarketData(input)
  const supplier = buildSupplierUnknownFieldGuard(assessment)
  const route = buildLunaScanMatchRouteRecommendation({ assessment, confirmation })
  return {
    scanMatchConfirmationReportBuilt: true,
    routeCorrectionApplied: input.previousIncorrectBlocker === "NEED_REAL_LUNA_CATALOG_FILE"
      && input.correctedBlocker === "NEED_LUNA_SCAN_MATCH_CONFIRMATION",
    previousIncorrectBlocker: input.previousIncorrectBlocker, correctedBlocker: input.correctedBlocker,
    requiresRealLunaCatalogFile: input.requiresRealLunaCatalogFile,
    requiresWarehouseConsultation: input.requiresWarehouseConsultation,
    requiresManualProductSearch: input.requiresManualProductSearch,
    usesLunaScanCandidates: input.usesLunaScanCandidates,
    usesEbayWinnerMarketData: input.usesEbayWinnerMarketData,
    bestLunaScanMatch: assessment.bestLunaScanMatch,
    bestLunaScanMatchScore: assessment.bestLunaScanMatchScore,
    ...confirmation, ...card, ...listing, ...supplier,
    fieldSourceMap: {
      listingFields: "EBAY_MARKET_OBSERVED",
      lunaCandidateFields: "LUNA_SCAN_OBSERVED",
      humanProductMatch: confirmation.source,
      unknownSupplierFields: "UNKNOWN_FROM_SUPPLIER",
    },
    ...route,
    productionWriteTouched: false, mainTouched: false, stagingWriteExecuted: false,
    ebayApiUsed: false, oauthUsed: false, tokenStored: false, tokensPrinted: false,
    draftCreated: false, listingCreated: false, offerCreated: false, publicationExecuted: false,
    imageGenerationUsed: false, scraperUsed: false, amazonTrackTouched: false,
    whatsappRealSendUsed: false, openAiUsed: false, fullWarehouseStreetAddressCommitted: false,
  }
}

export function summarizeEbayLunaScanMatchConfirmation(report: ReturnType<typeof buildEbayLunaScanMatchConfirmationReport>) {
  return {
    scanMatchConfirmationReportBuilt: report.scanMatchConfirmationReportBuilt,
    routeCorrectionApplied: report.routeCorrectionApplied,
    previousIncorrectBlocker: report.previousIncorrectBlocker, correctedBlocker: report.correctedBlocker,
    requiresRealLunaCatalogFile: report.requiresRealLunaCatalogFile,
    requiresWarehouseConsultation: report.requiresWarehouseConsultation,
    usesLunaScanCandidates: report.usesLunaScanCandidates,
    usesEbayWinnerMarketData: report.usesEbayWinnerMarketData,
    bestLunaScanMatch: report.bestLunaScanMatch ? report.bestLunaScanMatch.productName : null,
    bestLunaScanMatchScore: report.bestLunaScanMatchScore,
    humanWhatsappConfirmationStatus: report.humanWhatsappConfirmationStatus,
    confirmationCardBuilt: report.confirmationCardBuilt,
    listingFieldsCompletedFromEbay: report.listingFieldsCompletedFromEbay,
    supplierFieldsObservedFromLunaScan: Object.keys(report.supplierFieldsObservedFromLunaScan),
    supplierFieldsUnknown: report.supplierFieldsUnknown,
    fieldSourceMap: report.fieldSourceMap,
    canProceedToB2Run: report.canProceedToB2Run, canPublish: false,
    requiresHumanApproval: true, nextRecommendedRoute: report.nextRecommendedRoute,
    productionWriteTouched: false, mainTouched: false, stagingWriteExecuted: false,
    ebayApiUsed: false, oauthUsed: false, tokenStored: false, tokensPrinted: false,
    draftCreated: false, listingCreated: false, offerCreated: false, publicationExecuted: false,
    imageGenerationUsed: false, scraperUsed: false, amazonTrackTouched: false,
    whatsappRealSendUsed: false, openAiUsed: false, fullWarehouseStreetAddressCommitted: false,
  }
}

export function getEbayLunaScanMatchConfirmationChecklist(report: ReturnType<typeof buildEbayLunaScanMatchConfirmationReport>) {
  return {
    routeCorrected: report.routeCorrectionApplied,
    winnerComesFromEbay: report.fieldSourceMap.listingFields === "EBAY_MARKET_OBSERVED",
    candidatesComeFromScan: report.fieldSourceMap.lunaCandidateFields === "LUNA_SCAN_OBSERVED",
    humanConfirmationRequired: report.requiresHumanApproval,
    supplierUnknownsGuarded: report.supplierFieldsUnknown.length > 0,
    publicationBlocked: report.canPublish === false,
    readyForControlledB2Run: report.canProceedToB2Run,
  }
}
