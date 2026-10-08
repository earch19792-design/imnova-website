import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import type { CommercialMonitorGetDto } from
  "./commercial-monitor-readonly-contract"
import { executeSellerOsAssistantToolV1 } from
  "./ebay-seller-os-assistant-gateway-v1"
import { getLunaCatalogCandidatesV1 } from "./luna-catalog-snapshot-v1"
import { readAmazonContributorPerformanceV1 } from
  "../marketplace/seller-os-amazon-contributor-performance-v1"
import { createUnavailableSellerOsSelfhostRuntimeStatusV1,
  readSellerOsSelfhostRuntimeStatusV1 } from
  "../seller-os/selfhost-runtime-status-v1"

export const TEO_ANALYTICAL_SALES_ADVISOR_V1 =
  "TEO_ANALYTICAL_SALES_ADVISOR_V1_2026_10_08" as const
export const TEO_ANALYTICAL_SALES_ADVISOR_TOOL_NAME_V1 =
  "seller_os_get_analytical_sales_advisor" as const

type JsonRecord = Record<string, unknown>

type SourceReadV1 = Readonly<{
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE"
  value: unknown
  limitationCode: string | null
}>

type AnalyticalOpportunityV1 = Readonly<{
  opportunityId: string
  rankScore: number
  kind: "PRODUCT" | "LISTING" | "INVENTORY" | "AUTOMATION"
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
  title: string
  source: string
  sourceObservedAt: string | null
  entityRefs: readonly string[]
  evidence: Readonly<Record<string, unknown>>
  nextSafeAction: string
  ownerApprovalRequired: boolean
  automaticExecutionAllowed: false
  blockers: readonly string[]
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, fallback: string, maximum = 300) {
  if (typeof value !== "string") return fallback
  const normalized = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
  return normalized ? normalized.slice(0, maximum) : fallback
}

function stringList(value: unknown, maximum = 12) {
  return Array.isArray(value) ? value.flatMap((item) =>
    typeof item === "string" && item.trim()
      ? [text(item, "", 160)] : []).slice(0, maximum) : []
}

function iso(value: unknown) {
  const parsed = Date.parse(String(value ?? ""))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function stableId(parts: readonly unknown[]) {
  return `teo-advice-v1:sha256:${createHash("sha256")
    .update(JSON.stringify(parts)).digest("hex")}`
}

function priority(value: unknown): AnalyticalOpportunityV1["priority"] {
  return ["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(String(value))
    ? value as AnalyticalOpportunityV1["priority"] : "MEDIUM"
}

function priorityScore(value: AnalyticalOpportunityV1["priority"]) {
  return { CRITICAL: 100, HIGH: 82, MEDIUM: 62, LOW: 42 }[value]
}

function classifyPortfolioOpportunity(row: JsonRecord) {
  const signal = [row.entityType, row.classification, row.recommendedAction,
    ...stringList(row.reasonCodes)].join(" ").toUpperCase()
  if (/STOCK|SUPPLIER|OVERSELL|REORDER|INVENTORY/.test(signal)) {
    return "INVENTORY" as const
  }
  if (/CAPABILITY|AUTOMAT|SYNC|SCHEDUL|RETRY|RESTORE|RECAPTURE/.test(signal)) {
    return "AUTOMATION" as const
  }
  if (/LISTING|CTR|TITLE|PHOTO|IMAGE|KEYWORD|PRICE|QUALITY/.test(signal) ||
      row.entityType === "EBAY_LIVE_LISTING") return "LISTING" as const
  return "PRODUCT" as const
}

function portfolioOpportunities(context: JsonRecord) {
  return rows(context.todaysPriorities).map((row) => {
    const level = priority(row.priority)
    const entityKey = text(row.entityKey, "PORTFOLIO", 180)
    const action = text(row.recommendedAction, "REVIEW_EVIDENCE", 180)
    const kind = classifyPortfolioOpportunity(row)
    const reasonCodes = stringList(row.reasonCodes)
    return {
      opportunityId: stableId(["PORTFOLIO", entityKey, action]),
      rankScore: priorityScore(level) + (row.confidence === "HIGH" ? 8 : 0),
      kind, priority: level,
      title: text(row.title, `${kind} · ${entityKey}`),
      source: "SELLER_OS_CURRENT_LIVE_PORTFOLIO",
      sourceObservedAt: iso(row.lastObservationTime),
      entityRefs: [entityKey],
      evidence: { classification: text(row.classification, "UNPROVEN", 80),
        confidence: text(row.confidence, "UNPROVEN", 40), reasonCodes,
        evidenceBlocked: row.actionBlockedByEvidence === true,
        experimentProtected: row.experimentProtectionExists === true },
      nextSafeAction: action,
      ownerApprovalRequired: row.humanApprovalRequired === true ||
        ["PRODUCT", "LISTING", "INVENTORY"].includes(kind),
      automaticExecutionAllowed: false as const,
      blockers: row.actionBlockedByEvidence === true ? reasonCodes : [],
    }
  })
}

function qualityOpportunities(context: JsonRecord) {
  const quality = record(context.qualityGuidance)
  if (!["AVAILABLE", "PARTIAL", "COMPLETE"].includes(String(quality.status))) {
    return []
  }
  return rows(quality.recommendations).filter((row) =>
    row.actionState === "ACTIONABLE" && row.freshness !== "STALE")
    .map((row) => {
      const listingKey = text(row.listingKey, "UNRESOLVED_LISTING", 180)
      const recommendationType = text(row.recommendationType,
        "LISTING_QUALITY_REVIEW", 120)
      return {
        opportunityId: stableId(["QUALITY", listingKey, recommendationType]),
        rankScore: 78,
        kind: "LISTING" as const,
        priority: "HIGH" as const,
        title: text(row.recommendationText,
          `Improve listing · ${recommendationType}`),
        source: "EBAY_LISTING_QUALITY_REPORT",
        sourceObservedAt: iso(row.observedAt),
        entityRefs: [listingKey],
        evidence: { recommendationCategory: text(row.recommendationCategory,
            "UNCLASSIFIED", 120), recommendationType,
          associationStatus: text(row.associationStatus, "UNPROVEN", 80),
          reportedBenchmark: number(row.reportedBenchmark),
          topCategoryBenchmark: number(row.topCategoryBenchmark) },
        nextSafeAction: "PREPARE_LISTING_OPTIMIZATION_PREVIEW",
        ownerApprovalRequired: true,
        automaticExecutionAllowed: false as const,
        blockers: row.associationStatus === "UNPROVEN"
          ? ["LISTING_ASSOCIATION_UNPROVEN"] : [],
      }
    })
}

function amazonOpportunities(read: SourceReadV1) {
  if (read.status === "UNAVAILABLE") return []
  const result = record(read.value)
  return rows(result.cards).map((card) => {
    const observation = record(card.observation)
    const outcome = record(observation.outcome)
    const performance = record(observation.performance)
    const product = record(observation.product)
    const next = record(observation.nextBestEvidence)
    const gate = record(card.purchaseGate)
    const decision = text(gate.decision, "WAIT", 30)
    const reorder = outcome.reorderDecision === "REVIEW_REORDER"
    const score = reorder ? 96 : decision === "BUY" ? 90
      : decision === "SMALL_TEST" ? 82 : decision === "REJECT" ? 25 : 52
    const level = score >= 90 ? "HIGH" as const
      : score >= 70 ? "MEDIUM" as const : "LOW" as const
    const entity = text(card.id, text(record(observation.supplier).sku,
      "AMAZON_PRODUCT", 180), 180)
    return {
      opportunityId: stableId(["AMAZON_CONNIE", entity,
        outcome.skillOutcome, decision]),
      rankScore: score,
      kind: reorder ? "INVENTORY" as const : "PRODUCT" as const,
      priority: level,
      title: text(card.title, text(product.title, "Amazon product")),
      source: "AMAZON_CONNIE_CONTRIBUTOR_PERFORMANCE",
      sourceObservedAt: iso(card.capturedAt),
      entityRefs: [entity],
      evidence: { purchaseGateDecision: decision,
        skillOutcome: text(outcome.skillOutcome, "UNPROVEN", 60),
        reorderDecision: text(outcome.reorderDecision, "WAIT", 60),
        demandConfirmed: record(observation.demand).confirmed === true,
        performanceAuthoritative: performance.authoritative === true,
        observedUnitsSold: number(performance.observedUnitsSold),
        actualNetProfitPerUnitUsd: number(performance.actualNetProfitPerUnitUsd) },
      nextSafeAction: reorder ? "OWNER_REVIEW_REORDER"
        : text(next.action, "REVIEW_AMAZON_EVIDENCE", 120),
      ownerApprovalRequired: true,
      automaticExecutionAllowed: false as const,
      blockers: stringList(observation.blockers),
    }
  })
}

function lunaOpportunities(read: SourceReadV1) {
  if (read.status === "UNAVAILABLE") return []
  return rows(record(read.value).candidates).map((candidate) => {
    const approved = candidate.opportunityStatus ===
      "COMMERCIAL_TRACE_APPROVED_OPPORTUNITY"
    const productId = text(candidate.productId, "LUNA_PRODUCT", 80)
    const variantId = text(candidate.variantId, "LUNA_VARIANT", 80)
    const historical = record(candidate.historicalCommercialEvidence)
    const economics = record(candidate.economicFloors)
    return {
      opportunityId: stableId(["LUNA", productId, variantId]),
      rankScore: approved ? 84 : historical.decision === "ADVANCE" ? 72 : 46,
      kind: "PRODUCT" as const,
      priority: approved ? "HIGH" as const : historical.decision === "ADVANCE"
        ? "MEDIUM" as const : "LOW" as const,
      title: text(candidate.title, `Luna ${productId}:${variantId}`),
      source: "LUNA_STRUCTURED_CATALOG_AND_COMMERCIAL_EVIDENCE",
      sourceObservedAt: iso(record(candidate.freshness).observedAt),
      entityRefs: [productId, variantId,
        text(candidate.sku, "SKU_UNPROVEN", 160)],
      evidence: { opportunityStatus: text(candidate.opportunityStatus,
          "PRE_SCREEN_ONLY", 80),
        demandValidationPassed: historical.demand_validation_passed === true,
        exactIdentity: historical.exact_identity === true,
        soldExactUnits: number(historical.sold_exact_units),
        supplierAvailable: candidate.availability === true,
        economicsAvailable: Object.keys(economics).length > 0,
        landedCostStatus: text(record(candidate.landedCost).status,
          "UNPROVEN", 40) },
      nextSafeAction: approved ? "OWNER_REVIEW_LUNA_OPPORTUNITY"
        : "COMPLETE_LUNA_COMMERCIAL_EVIDENCE",
      ownerApprovalRequired: true,
      automaticExecutionAllowed: false as const,
      blockers: approved ? [] : ["COMMERCIAL_EVIDENCE_NOT_YET_APPROVED"],
    }
  })
}

function automationOpportunities(systemReview: JsonRecord,
  workstation: SourceReadV1, amazon: SourceReadV1) {
  const candidates = rows(record(systemReview.automationCandidates).entries)
    .map<AnalyticalOpportunityV1>((candidate) => {
      const action = text(candidate.manualOperation,
        "REVIEW_AUTOMATION_CANDIDATE", 180)
      const risk = text(candidate.riskClass, "MEDIUM", 30)
      const level = risk === "HIGH" ? "HIGH" as const : "MEDIUM" as const
      return {
        opportunityId: stableId(["AUTOMATION", candidate.candidateId, action]),
        rankScore: priorityScore(level), kind: "AUTOMATION" as const,
        priority: level,
        title: text(candidate.deterministicPattern, action),
        source: "SELLER_OS_DETERMINISTIC_AUTOMATION_CANDIDATES",
        sourceObservedAt: null,
        entityRefs: stringList(candidate.evidenceRefs, 8),
        evidence: { evidenceCount: number(candidate.evidenceCount), riskClass: risk,
          boundary: text(candidate.proposedAutomationBoundary,
            "PREPARATION_ONLY", 120) },
        nextSafeAction: action,
        ownerApprovalRequired: true,
        automaticExecutionAllowed: false as const,
        blockers: [],
      }
    })
  const runtime = record(workstation.value)
  const counts = record(runtime.counts)
  const session = record(runtime.session)
  const deferredJobs = rows(runtime.jobs).filter((job) =>
    /PARTIAL|BLOCKED|WAITING|DEFERRED/.test(String(job.outcomeCode ?? "")) &&
    job.outcomeCode !== "DEFERRED_POLICY_GATE")
  if (workstation.status !== "UNAVAILABLE" &&
      (Number(counts.stale ?? 0) > 0 || Number(counts.failedLast24Hours ?? 0) > 0 ||
        Number(session.catchUpCandidateCount ?? 0) > 0 ||
        deferredJobs.length > 0)) {
    candidates.push({
      opportunityId: stableId(["AUTOMATION", "WORKSTATION_RECOVERY"]),
      rankScore: Number(counts.stale ?? 0) > 0 ? 94 : 76,
      kind: "AUTOMATION", priority: Number(counts.stale ?? 0) > 0
        ? "HIGH" : "MEDIUM",
      title: "Review durable workstation recovery and catch-up work",
      source: "SELLER_OS_SELFHOST_RUNTIME_STATUS",
      sourceObservedAt: iso(runtime.observedAt), entityRefs: [],
      evidence: { runtimeStatus: text(runtime.runtimeStatus, "UNAVAILABLE", 40),
        staleJobs: number(counts.stale),
        failedJobsLast24Hours: number(counts.failedLast24Hours),
        catchUpCandidateCount: number(session.catchUpCandidateCount),
        deferredJobs: deferredJobs.slice(0, 8).map((job) => ({
          name: text(job.name, "UNKNOWN_JOB", 80),
          outcomeCode: text(job.outcomeCode, "DEFERRED", 80),
        })) },
      nextSafeAction: "REVIEW_SELFHOST_RECOVERY_QUEUE",
      ownerApprovalRequired: false, automaticExecutionAllowed: false,
      blockers: [],
    })
  }
  const amazonAutomation = record(record(amazon.value).automation)
  const sync = record(amazonAutomation.sync)
  if (amazon.status !== "UNAVAILABLE" &&
      !["SUCCEEDED", "AVAILABLE", "HEALTHY"].includes(String(sync.run_status ??
        sync.runStatus ?? "UNAVAILABLE"))) {
    candidates.push({
      opportunityId: stableId(["AUTOMATION", "AMAZON_CONNIE_SYNC"]),
      rankScore: 72, kind: "AUTOMATION", priority: "MEDIUM",
      title: "Restore or certify the Amazon/Connie analytical sync",
      source: "AMAZON_CONNIE_SYNC_STATE",
      sourceObservedAt: iso(sync.updated_at ?? sync.updatedAt), entityRefs: [],
      evidence: { connectionStatus: text(sync.connection_status ??
          sync.connectionStatus, "UNAVAILABLE", 60),
        runStatus: text(sync.run_status ?? sync.runStatus, "UNAVAILABLE", 60),
        lastSuccessAt: iso(sync.last_success_at ?? sync.lastSuccessAt) },
      nextSafeAction: "REVIEW_AMAZON_CONNIE_SYNC_HEALTH",
      ownerApprovalRequired: false, automaticExecutionAllowed: false,
      blockers: [text(sync.last_error_code ?? sync.lastErrorCode,
        "AMAZON_SYNC_NOT_CERTIFIED", 120)],
    })
  }
  return candidates
}

function sourceStatus(name: string, read: SourceReadV1) {
  return { name, status: read.status, limitationCode: read.limitationCode }
}

function dedupeAndRank(entries: AnalyticalOpportunityV1[], limit: number) {
  return [...new Map(entries.map((entry) =>
    [entry.opportunityId, entry])).values()]
    .sort((left, right) => right.rankScore - left.rankScore ||
      left.opportunityId.localeCompare(right.opportunityId)).slice(0, limit)
    .map((entry, index) => ({ ...entry, rank: index + 1 }))
}

export function buildTeoAnalyticalSalesAdvisorV1(input: Readonly<{
  observedAt: string
  limit: number
  commercialContext: JsonRecord
  systemReview: JsonRecord
  amazon: SourceReadV1
  luna: SourceReadV1
  workstation: SourceReadV1
}>) {
  const maximum = Math.min(20, Math.max(1, Math.trunc(input.limit)))
  const portfolio = { status: "AVAILABLE" as const, value: input.commercialContext,
    limitationCode: null }
  const listingQuality = record(input.commercialContext.qualityGuidance)
  const recentSales = record(input.commercialContext.recentSales)
  const opportunities = dedupeAndRank([
    ...portfolioOpportunities(input.commercialContext),
    ...qualityOpportunities(input.commercialContext),
    ...amazonOpportunities(input.amazon),
    ...lunaOpportunities(input.luna),
    ...automationOpportunities(input.systemReview, input.workstation,
      input.amazon),
  ], maximum)
  const byKind = (kind: AnalyticalOpportunityV1["kind"]) =>
    opportunities.filter((entry) => entry.kind === kind).length
  const unavailableSources = [
    sourceStatus("CURRENT_LIVE_PORTFOLIO", portfolio),
    sourceStatus("AMAZON_CONNIE", input.amazon),
    sourceStatus("LUNA_CATALOG", input.luna),
    sourceStatus("SELFHOST_AUTOMATION", input.workstation),
  ].filter((source) => source.status === "UNAVAILABLE")
  const dataGaps = [
    ...unavailableSources.map((source) => source.limitationCode ??
      `${source.name}_UNAVAILABLE`),
    ...(!["AVAILABLE", "PARTIAL", "COMPLETE"].includes(
      String(listingQuality.status))
      ? [text(listingQuality.limitationCode,
          "LISTING_QUALITY_REPORT_UNAVAILABLE", 160)] : []),
    ...(!["AVAILABLE", "PARTIAL"].includes(String(recentSales.status))
      ? ["RECENT_OFFICIAL_SALES_UNAVAILABLE"] : []),
  ]
  const sourceReads = [sourceStatus("CURRENT_LIVE_PORTFOLIO", portfolio),
    { name: "LISTING_QUALITY", status: text(listingQuality.status,
        "UNAVAILABLE", 40),
      limitationCode: listingQuality.limitationCode ?? null },
    { name: "RECENT_OFFICIAL_SALES", status: text(recentSales.status,
        "UNAVAILABLE", 40),
      limitationCode: stringList(recentSales.limitationCodes).join(",") || null },
    sourceStatus("AMAZON_CONNIE", input.amazon),
    sourceStatus("LUNA_CATALOG", input.luna),
    sourceStatus("SELFHOST_AUTOMATION", input.workstation)]
  const availableCount = sourceReads.filter((source) =>
    source.status === "AVAILABLE" || source.status === "COMPLETE").length
  return Object.freeze({
    contractVersion: TEO_ANALYTICAL_SALES_ADVISOR_V1,
    status: availableCount === sourceReads.length ? "AVAILABLE"
      : availableCount > 0 ? "PARTIAL" : "UNAVAILABLE",
    observedAt: iso(input.observedAt) ?? new Date(0).toISOString(),
    executiveSummary: {
      rankedOpportunityCount: opportunities.length,
      productOpportunities: byKind("PRODUCT"),
      listingImprovements: byKind("LISTING"),
      inventoryActions: byKind("INVENTORY"),
      automationImprovements: byKind("AUTOMATION"),
      recommendedFocus: opportunities[0]?.nextSafeAction ??
        "RESTORE_REQUIRED_EVIDENCE_CAPABILITIES",
      topOpportunityId: opportunities[0]?.opportunityId ?? null,
    },
    opportunities,
    automationIdeas: opportunities.filter((entry) =>
      entry.kind === "AUTOMATION"),
    productAndListingWatchlist: opportunities.filter((entry) =>
      entry.kind === "PRODUCT" || entry.kind === "LISTING" ||
      entry.kind === "INVENTORY"),
    sourceReads,
    dataGaps: [...new Set(dataGaps)].slice(0, 30),
    guidancePolicy: {
      rankingIsDeterministic: true,
      missingDataNeverBecomesZero: true,
      contributorClaimsAreNotMarketplaceProof: true,
      ownerApprovalRequiredBeforeCommercialMutation: true,
      TEOCanPrepareButCannotPublishBuyRepriceOrEndListings: true,
    },
    safety: { readOnly: true, credentialsIncluded: false,
      buyerPiiIncluded: false, marketplaceWrites: 0, publications: 0,
      repricing: 0, supplierPurchases: 0, automaticReorders: 0,
      automationEnablements: 0 },
  })
}

async function safeRead(loader: () => Promise<unknown>, code: string):
Promise<SourceReadV1> {
  try {
    return { status: "AVAILABLE", value: await loader(),
      limitationCode: null }
  } catch {
    return { status: "UNAVAILABLE", value: null, limitationCode: code }
  }
}

function boundedLimit(value: unknown, fallback = 10) {
  return Math.min(100, Math.max(1, Number.isInteger(value)
    ? Number(value) : fallback))
}

export function buildTeoPortfolioActionsV1(
  monitor: CommercialMonitorGetDto,
  limit = 10,
) {
  const result = executeSellerOsAssistantToolV1({
    toolName: "seller_os_get_exception_queue",
    arguments: { limit: boundedLimit(limit) }, monitor,
  }) as JsonRecord
  const entries = rows(result.entries)
  return Object.freeze({
    contractVersion: "TEO_PORTFOLIO_ACTIONS_V1_2026_10_08",
    status: entries.length ? "AVAILABLE" : "PARTIAL",
    observedAt: monitor.generatedAt,
    portfolioCount: entries.length || null,
    rows: entries,
    noFalseZero: entries.length === 0,
    safety: { readOnly: true, tradingReads: 0, marketplaceWrites: 0,
      publications: 0, repricing: 0, listingEnds: 0 },
  })
}

export function buildTeoOperationsGatewayV1(
  monitor: CommercialMonitorGetDto,
  args: Record<string, unknown>,
) {
  const view = text(args.view, "TODAY_PRIORITIES", 40)
  const limit = boundedLimit(args.limit)
  let data: unknown
  if (view === "TODAY_PRIORITIES") {
    const context = executeSellerOsAssistantToolV1({
      toolName: "seller_os_get_commercial_context", arguments: { limit },
      monitor,
    }) as JsonRecord
    data = { priorities: rows(context.todaysPriorities).slice(0, limit),
      capabilityBlockers: Array.isArray(context.capabilityBlockers)
        ? context.capabilityBlockers.slice(0, limit) : [],
      recentSales: context.recentSales ?? null }
  } else if (view === "PORTFOLIO_STATE") {
    data = executeSellerOsAssistantToolV1({
      toolName: "seller_os_get_operational_readiness", arguments: { limit },
      monitor,
    })
  } else if (view === "PORTFOLIO_ACTIONS") {
    data = buildTeoPortfolioActionsV1(monitor, limit)
  } else if (view === "BEST_CANDIDATES") {
    data = executeSellerOsAssistantToolV1({
      toolName: "seller_os_get_opportunity_radar", arguments: { limit },
      monitor,
    })
  } else if (view === "STOCK_RISKS") {
    data = executeSellerOsAssistantToolV1({
      toolName: "seller_os_get_stock_status", arguments: { limit }, monitor,
    })
  } else if (view === "ACTIVE_EXPERIMENTS") {
    data = executeSellerOsAssistantToolV1({
      toolName: "seller_os_get_experiments", arguments: { limit }, monitor,
    })
  } else if (view === "LISTING_DRAFT") {
    data = { status: "PREPARATION_REQUIRES_CERTIFIED_PRODUCT_EVIDENCE",
      identity: { sku: text(args.sku, "", 160),
        productId: text(args.productId, "", 30),
        variantId: text(args.variantId, "", 30) },
      nextSafeAction: "READ_LUNA_CANDIDATE_THEN_PREPARE_DRAFT",
      automaticPublicationAllowed: false }
  } else {
    throw new Error("TEO_GATEWAY_VIEW_INVALID")
  }
  return Object.freeze({
    contractVersion: "TEO_OPERATIONS_GATEWAY_V1_2026_10_08",
    status: "AVAILABLE", view, observedAt: monitor.generatedAt, data,
    safety: { readOnly: true, tradingReads: 0, marketplaceWrites: 0,
      publications: 0, repricing: 0, listingEnds: 0,
      supplierPurchases: 0 },
  })
}

export function buildTeoDailyOperatingCycleV1(
  monitor: CommercialMonitorGetDto,
  limit = 10,
) {
  const maximum = boundedLimit(limit)
  const actions = buildTeoPortfolioActionsV1(monitor, Math.min(100,
    maximum * 4)).rows
  const doNow = actions.filter((entry) => entry.priority === "CRITICAL" ||
    entry.classification === "CRITICAL_OPERATIONAL").slice(0, maximum)
  const doNowIds = new Set(doNow.map((entry) => entry.dedupeIdentity))
  const today = actions.filter((entry) => !doNowIds.has(entry.dedupeIdentity) &&
    (entry.priority === "HIGH" ||
      entry.classification === "ACTIONABLE_COMMERCIAL"))
    .slice(0, maximum)
  const selected = new Set([...doNow, ...today].map((entry) =>
    entry.dedupeIdentity))
  const watch = actions.filter((entry) => !selected.has(entry.dedupeIdentity))
    .slice(0, maximum)
  const activeExperiments = monitor.backend.decisions.filter((decision) =>
    decision.experimentOperationalState !== "INACTIVE").slice(0, maximum)
  return Object.freeze({
    contractVersion: "TEO_DAILY_OPERATING_CYCLE_V1_2026_10_08",
    status: actions.length ? "AVAILABLE" : "PARTIAL",
    observedAt: monitor.generatedAt,
    agenda: { DO_NOW: doNow, TODAY: today, WATCH: watch,
      HEALTHY: actions.length ? [] : [{ status: "NO_MATERIAL_ACTION_PROVEN" }] },
    activeExperiments,
    safety: { readOnly: true, tradingReads: 0, marketplaceWrites: 0,
      publications: 0, repricing: 0, listingEnds: 0,
      supplierPurchases: 0 },
  })
}

export async function collectTeoAnalyticalSalesAdvisorV1(input: Readonly<{
  supabase: SupabaseClient
  monitor: CommercialMonitorGetDto
  limit?: number
  now?: Date
}>) {
  const limit = Math.min(20, Math.max(1, Math.trunc(input.limit ?? 10)))
  const commercialContext = executeSellerOsAssistantToolV1({
    toolName: "seller_os_get_commercial_context", arguments: { limit },
    monitor: input.monitor,
  }) as JsonRecord
  const systemReview = executeSellerOsAssistantToolV1({
    toolName: "seller_os_get_system_review_bundle", arguments: { limit },
    monitor: input.monitor,
  }) as JsonRecord
  const [amazon, luna, workstation] = await Promise.all([
    safeRead(() => readAmazonContributorPerformanceV1({
      supabase: input.supabase, limit, now: input.now,
    }), "AMAZON_CONNIE_PERFORMANCE_UNAVAILABLE"),
    safeRead(() => getLunaCatalogCandidatesV1(input.supabase, limit),
      "LUNA_CANDIDATES_UNAVAILABLE"),
    safeRead(() => readSellerOsSelfhostRuntimeStatusV1(input.supabase),
      "SELFHOST_RUNTIME_STATUS_UNAVAILABLE"),
  ])
  return buildTeoAnalyticalSalesAdvisorV1({
    observedAt: input.now?.toISOString() ?? input.monitor.generatedAt,
    limit, commercialContext, systemReview, amazon, luna,
    workstation: workstation.status === "UNAVAILABLE"
      ? { ...workstation,
          value: createUnavailableSellerOsSelfhostRuntimeStatusV1(
            input.now?.toISOString()) }
      : workstation,
  })
}
