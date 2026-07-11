export const EBAY_MOBILE_WHATSAPP_APPROVAL_CENTER_VERSION = "EBAY_MOBILE_WHATSAPP_APPROVAL_CENTER_B2A_V1"

type Row = Record<string, unknown>
type Fixture = Row & { top5Candidates?: Row[]; allowedCommands?: string[]; modeledMessages?: string[]; safetyFlags?: Record<string, boolean> }
type ApprovalState = {
  mobileApprovalState: string
  selectedCandidateRank: number | null
  selectedCandidateName: string | null
  selectedCandidate: Row | null
  sameProductConfirmed: boolean
  stockQuantityObservedByHuman: number | null
  imageReviewOk: boolean
  b2RunPreflightApproved: boolean
  rejectedAll: boolean
  refreshRequested: boolean
  holdForReview: boolean
  auditTrail: Row[]
}

const text = (value: unknown, fallback = "") => typeof value === "string" && value.trim() ? value.trim() : fallback
const bool = (value: unknown) => value === true
const number = (value: unknown, fallback = 0) => {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
const strings = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []

export function buildMobileWhatsappApprovalCenterInput(fixture: Fixture, commands: string[] = []) {
  return {
    version: text(fixture.version, EBAY_MOBILE_WHATSAPP_APPROVAL_CENTER_VERSION), status: text(fixture.status),
    sourceRoute: text(fixture.sourceRoute), mode: text(fixture.mode),
    realWhatsappSendUsed: bool(fixture.realWhatsappSendUsed), realSmsSendUsed: bool(fixture.realSmsSendUsed),
    realEbayApiUsedInThisLoop: bool(fixture.realEbayApiUsedInThisLoop), canPublish: false,
    mobileApprovalRequired: bool(fixture.mobileApprovalRequired), userChannel: text(fixture.userChannel),
    purpose: strings(fixture.approvalCenterPurpose), top5Candidates: (fixture.top5Candidates ?? []).slice(0, 5),
    previousSingleConfirmedCandidate: fixture.previousSingleConfirmedCandidate ?? {},
    allowedCommands: strings(fixture.allowedCommands), modeledMessages: strings(fixture.modeledMessages),
    safetyFlags: fixture.safetyFlags ?? {}, commands,
  }
}

export function buildTop5MobileSummaryCard(input: ReturnType<typeof buildMobileWhatsappApprovalCenterInput>) {
  return {
    top5SummaryCardBuilt: input.top5Candidates.length === 5,
    channel: "WHATSAPP_MODELED_ONLY", realWhatsappSendUsed: false,
    heading: "Top 5 eBay opportunity review",
    candidates: input.top5Candidates.map((candidate) => ({
      rank: number(candidate.candidateRank), productName: text(candidate.productName),
      opportunityScore: number(candidate.opportunityScore), recommendedAction: text(candidate.recommendedAction),
    })),
    responseHint: "Use SELECT_RANK_1 through SELECT_RANK_5, REJECT_ALL, REQUEST_REFRESH, HOLD_FOR_REVIEW, or HELP.",
  }
}

export function buildCandidateMobileDetailCard(input: ReturnType<typeof buildMobileWhatsappApprovalCenterInput>, rank = 1) {
  const candidate = input.top5Candidates.find((entry) => number(entry.candidateRank) === rank) ?? null
  return {
    candidateDetailCardBuilt: Boolean(candidate), channel: "WHATSAPP_MODELED_ONLY", realWhatsappSendUsed: false,
    candidate: candidate ? {
      rank, productName: text(candidate.productName), opportunityScore: number(candidate.opportunityScore),
      ebayDemandSignal: candidate.ebayDemandSignal ?? {}, listingBlueprintSummary: text(candidate.listingBlueprintSummary),
      riskFlags: strings(candidate.riskFlags), missingFields: strings(candidate.missingFields),
      imageBlueprintSummary: text(candidate.imageBlueprintSummary), recommendedAction: text(candidate.recommendedAction),
    } : null,
  }
}

export function buildSameProductConfirmationPrompt(candidate: Row | null) {
  return { promptBuilt: Boolean(candidate), messageType: "SAME_PRODUCT_CONFIRMATION_PROMPT", text: candidate ? `Confirma si ${text(candidate.productName)} es el mismo producto observado.` : "Selecciona un candidato primero.", positiveCommand: "CONFIRM_SAME_PRODUCT", negativeCommand: "REJECT_NOT_SAME_PRODUCT", realWhatsappSendUsed: false }
}
export function buildStockQuantityConfirmationPrompt(candidate: Row | null) {
  return { promptBuilt: Boolean(candidate), messageType: "STOCK_QUANTITY_CONFIRMATION_PROMPT", text: "Confirma únicamente la cantidad observada desde el teléfono.", commandFormat: "CONFIRM_STOCK_QTY:<number>", sourceWhenConfirmed: "HUMAN_MOBILE_CONFIRMED", realWhatsappSendUsed: false }
}
export function buildImageReviewConfirmationPrompt(candidate: Row | null) {
  return { promptBuilt: Boolean(candidate), messageType: "IMAGE_REVIEW_PROMPT", text: "Confirma si la referencia visual es aceptable para revisión; esto no autoriza publicación.", command: "CONFIRM_IMAGE_REVIEW_OK", realWhatsappSendUsed: false }
}
export function buildB2RunPreflightApprovalPrompt(candidate: Row | null) {
  return { promptBuilt: Boolean(candidate), messageType: "B2_RUN_PREFLIGHT_APPROVAL_PROMPT", text: "Aprueba únicamente preparar el B2-RUN Preflight sin write ni publicación.", command: "APPROVE_B2_RUN_PREFLIGHT", canPublish: false, realWhatsappSendUsed: false }
}

export function parseMobileApprovalCommand(rawCommand?: string) {
  const raw = text(rawCommand).toUpperCase()
  if (!raw) return { parsedCommand: null, commandType: "NO_COMMAND", valid: true, value: null }
  const stockMatch = raw.match(/^CONFIRM_STOCK_QTY:(.+)$/)
  if (stockMatch) {
    const value = Number(stockMatch[1])
    return { parsedCommand: raw, commandType: "CONFIRM_STOCK_QTY", valid: Number.isInteger(value) && value >= 1, value: Number.isInteger(value) && value >= 1 ? value : null }
  }
  const selectMatch = raw.match(/^SELECT_RANK_([1-5])$/)
  if (selectMatch) return { parsedCommand: raw, commandType: "SELECT_RANK", valid: true, value: Number(selectMatch[1]) }
  const allowed = ["TOP5_SHOW", "REJECT_ALL", "REQUEST_REFRESH", "CONFIRM_SAME_PRODUCT", "REJECT_NOT_SAME_PRODUCT", "CONFIRM_IMAGE_REVIEW_OK", "APPROVE_B2_RUN_PREFLIGHT", "HOLD_FOR_REVIEW", "HELP"]
  return { parsedCommand: raw, commandType: allowed.includes(raw) ? raw : "UNKNOWN_COMMAND", valid: allowed.includes(raw), value: null }
}

export function buildMobileApprovalState(): ApprovalState {
  return { mobileApprovalState: "MOBILE_APPROVAL_PENDING", selectedCandidateRank: null, selectedCandidateName: null, selectedCandidate: null, sameProductConfirmed: false, stockQuantityObservedByHuman: null, imageReviewOk: false, b2RunPreflightApproved: false, rejectedAll: false, refreshRequested: false, holdForReview: false, auditTrail: [] }
}

export function applyMobileApprovalCommand(state: ApprovalState, parsed: ReturnType<typeof parseMobileApprovalCommand>, input: ReturnType<typeof buildMobileWhatsappApprovalCenterInput>) {
  const next: ApprovalState = { ...state, auditTrail: [...state.auditTrail, { sequence: state.auditTrail.length + 1, command: parsed.parsedCommand, valid: parsed.valid, channel: "WHATSAPP_MODELED_ONLY", realMessageSent: false }] }
  if (!parsed.valid || parsed.commandType === "NO_COMMAND" || parsed.commandType === "UNKNOWN_COMMAND" || parsed.commandType === "HELP") return next
  if (parsed.commandType === "TOP5_SHOW") next.mobileApprovalState = "TOP5_REVIEWED"
  if (parsed.commandType === "SELECT_RANK") {
    const candidate = input.top5Candidates.find((entry) => number(entry.candidateRank) === parsed.value) ?? null
    next.selectedCandidateRank = parsed.value as number; next.selectedCandidateName = candidate ? text(candidate.productName) : null
    next.selectedCandidate = candidate; next.sameProductConfirmed = false; next.stockQuantityObservedByHuman = null
    next.imageReviewOk = false; next.b2RunPreflightApproved = false; next.mobileApprovalState = "CANDIDATE_SELECTED"
  }
  if (parsed.commandType === "CONFIRM_SAME_PRODUCT" && next.selectedCandidate) { next.sameProductConfirmed = true; next.mobileApprovalState = "SAME_PRODUCT_CONFIRMED" }
  if (parsed.commandType === "REJECT_NOT_SAME_PRODUCT" && next.selectedCandidate) { next.sameProductConfirmed = false; next.mobileApprovalState = "CANDIDATE_SELECTED" }
  if (parsed.commandType === "CONFIRM_STOCK_QTY" && next.selectedCandidate) { next.stockQuantityObservedByHuman = parsed.value as number; next.mobileApprovalState = "STOCK_QTY_CONFIRMED" }
  if (parsed.commandType === "CONFIRM_IMAGE_REVIEW_OK" && next.selectedCandidate) { next.imageReviewOk = true; next.mobileApprovalState = "IMAGE_REVIEW_CONFIRMED" }
  if (parsed.commandType === "APPROVE_B2_RUN_PREFLIGHT") {
    const highRisk = strings(next.selectedCandidate?.riskFlags).length > 0
    const ready = Boolean(next.selectedCandidate && next.sameProductConfirmed && number(next.stockQuantityObservedByHuman) >= 1 && next.imageReviewOk && !highRisk)
    next.b2RunPreflightApproved = ready
    next.mobileApprovalState = ready ? "B2_RUN_PREFLIGHT_APPROVED" : next.selectedCandidate ? "READY_FOR_B2_RUN_PREFLIGHT_APPROVAL" : "MOBILE_APPROVAL_PENDING"
  }
  if (parsed.commandType === "REJECT_ALL") { next.rejectedAll = true; next.mobileApprovalState = "REJECTED_ALL" }
  if (parsed.commandType === "REQUEST_REFRESH") { next.refreshRequested = true; next.mobileApprovalState = "REFRESH_REQUESTED" }
  if (parsed.commandType === "HOLD_FOR_REVIEW") { next.holdForReview = true; next.mobileApprovalState = "HOLD_FOR_REVIEW" }
  return next
}

export function buildMobileApprovalGateAssessment(state: ApprovalState) {
  const highRiskFlag = strings(state.selectedCandidate?.riskFlags).length > 0
  const gates = {
    candidateSelected: Boolean(state.selectedCandidate), sameProductConfirmed: state.sameProductConfirmed,
    stockQuantityConfirmed: number(state.stockQuantityObservedByHuman) >= 1, imageReviewOk: state.imageReviewOk,
    highRiskFlag, explicitPreflightApproval: state.b2RunPreflightApproved,
  }
  const mobileApprovalGatePassed = gates.candidateSelected && gates.sameProductConfirmed && gates.stockQuantityConfirmed && gates.imageReviewOk && !gates.highRiskFlag && gates.explicitPreflightApproval
  return { gates, mobileApprovalGatePassed, canProceedToB2RunPreflight: mobileApprovalGatePassed, canPublish: false }
}

export function buildMobileApprovalRouteRecommendation(state: ApprovalState, gate = buildMobileApprovalGateAssessment(state)) {
  let nextRecommendedRoute = "NEED_HUMAN_TOP_PRODUCT_SELECTION"
  if (state.holdForReview) nextRecommendedRoute = "EBAY-RESUME-HOLD"
  else if (state.rejectedAll || state.refreshRequested) nextRecommendedRoute = "NEED_LUNA_SCAN_REFRESH"
  else if (gate.mobileApprovalGatePassed) nextRecommendedRoute = "EBAY-RESUME-B2-RUN-PREFLIGHT"
  else if (state.selectedCandidate) nextRecommendedRoute = "NEED_MOBILE_CONFIRMATIONS"
  return { nextRecommendedRoute, canProceedToB2RunPreflight: nextRecommendedRoute === "EBAY-RESUME-B2-RUN-PREFLIGHT", canPublish: false }
}

export function buildMobileApprovalAuditTrail(state: ApprovalState) {
  return { auditTrailBuilt: true, simulatedOnly: true, realWhatsappSendUsed: false, realSmsSendUsed: false, entries: state.auditTrail }
}

export function buildMobileWhatsappApprovalCenterReport(fixture: Fixture, commands: string[] = []) {
  const input = buildMobileWhatsappApprovalCenterInput(fixture, commands)
  let state = buildMobileApprovalState()
  const parsedCommands = commands.map(parseMobileApprovalCommand)
  for (const parsed of parsedCommands) state = applyMobileApprovalCommand(state, parsed, input)
  const summaryCard = buildTop5MobileSummaryCard(input)
  const detailCard = buildCandidateMobileDetailCard(input, state.selectedCandidateRank ?? 1)
  const gate = buildMobileApprovalGateAssessment(state)
  const route = buildMobileApprovalRouteRecommendation(state, gate)
  const audit = buildMobileApprovalAuditTrail(state)
  return {
    mobileApprovalCenterReportBuilt: true,
    ...summaryCard, ...detailCard, allowedCommands: input.allowedCommands,
    parsedCommand: parsedCommands.at(-1)?.parsedCommand ?? null, parsedCommands,
    mobileApprovalState: state.mobileApprovalState, selectedCandidateRank: state.selectedCandidateRank,
    selectedCandidateName: state.selectedCandidateName, sameProductConfirmed: state.sameProductConfirmed,
    stockQuantityObservedByHuman: state.stockQuantityObservedByHuman, stockQuantitySource: state.stockQuantityObservedByHuman ? "HUMAN_MOBILE_CONFIRMED" : null,
    imageReviewOk: state.imageReviewOk, b2RunPreflightApproved: state.b2RunPreflightApproved,
    ...gate, ...route, ...audit,
    sameProductPrompt: buildSameProductConfirmationPrompt(state.selectedCandidate),
    stockPrompt: buildStockQuantityConfirmationPrompt(state.selectedCandidate),
    imagePrompt: buildImageReviewConfirmationPrompt(state.selectedCandidate),
    preflightPrompt: buildB2RunPreflightApprovalPrompt(state.selectedCandidate),
    productionWriteTouched: false, mainTouched: false, stagingWriteExecuted: false,
    ebayApiUsed: false, oauthUsed: false, tokenStored: false, tokensPrinted: false,
    draftCreated: false, listingCreated: false, offerCreated: false, publicationExecuted: false,
    imageGenerationUsed: false, imageDownloadUsed: false, imageCopyUsed: false, scraperUsed: false,
    amazonTrackTouched: false, whatsappRealSendUsed: false, smsRealSendUsed: false, openAiUsed: false,
    fullWarehouseStreetAddressCommitted: false,
  }
}

export function summarizeMobileWhatsappApprovalCenter(report: ReturnType<typeof buildMobileWhatsappApprovalCenterReport>) {
  return {
    mobileApprovalCenterReportBuilt: report.mobileApprovalCenterReportBuilt, realWhatsappSendUsed: report.realWhatsappSendUsed,
    realSmsSendUsed: report.realSmsSendUsed, top5SummaryCardBuilt: report.top5SummaryCardBuilt,
    candidateDetailCardBuilt: report.candidateDetailCardBuilt, parsedCommand: report.parsedCommand,
    mobileApprovalState: report.mobileApprovalState, selectedCandidateRank: report.selectedCandidateRank,
    selectedCandidateName: report.selectedCandidateName, sameProductConfirmed: report.sameProductConfirmed,
    stockQuantityObservedByHuman: report.stockQuantityObservedByHuman, imageReviewOk: report.imageReviewOk,
    b2RunPreflightApproved: report.b2RunPreflightApproved, mobileApprovalGatePassed: report.mobileApprovalGatePassed,
    canProceedToB2RunPreflight: report.canProceedToB2RunPreflight, canPublish: report.canPublish,
    nextRecommendedRoute: report.nextRecommendedRoute, auditTrailBuilt: report.auditTrailBuilt,
    auditTrailEntryCount: report.entries.length,
    productionWriteTouched: report.productionWriteTouched, mainTouched: report.mainTouched,
    stagingWriteExecuted: report.stagingWriteExecuted, ebayApiUsedInThisLoop: report.ebayApiUsed,
    oauthUsedInThisLoop: report.oauthUsed, tokenStored: report.tokenStored, tokensPrinted: report.tokensPrinted,
    draftCreated: report.draftCreated, listingCreated: report.listingCreated, offerCreated: report.offerCreated,
    publicationExecuted: report.publicationExecuted, imageGenerationUsed: report.imageGenerationUsed,
    imageDownloadUsed: report.imageDownloadUsed, imageCopyUsed: report.imageCopyUsed, scraperUsed: report.scraperUsed,
    amazonTrackTouched: report.amazonTrackTouched, whatsappRealSendUsed: report.whatsappRealSendUsed,
    smsRealSendUsed: report.smsRealSendUsed, openAiUsed: report.openAiUsed,
    fullWarehouseStreetAddressCommitted: report.fullWarehouseStreetAddressCommitted,
  }
}

export function getMobileWhatsappApprovalCenterChecklist(report: ReturnType<typeof buildMobileWhatsappApprovalCenterReport>) {
  return [
    { id: "top5", passed: report.top5SummaryCardBuilt },
    { id: "modeled-only", passed: !report.realWhatsappSendUsed && !report.realSmsSendUsed },
    { id: "approval-gates", passed: !report.canProceedToB2RunPreflight || report.mobileApprovalGatePassed },
    { id: "no-publish", passed: !report.canPublish },
    { id: "audit", passed: report.auditTrailBuilt },
  ]
}
