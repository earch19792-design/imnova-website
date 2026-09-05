import type { SupabaseClient } from "@supabase/supabase-js"

import { getProductResearchBrowserCaptureStatus } from
  "../ebay/ebay-product-research-browser-capture"
import { getProductResearchQueryPlanStatus } from
  "../ebay/ebay-product-research-query-plan"
import { getSellerOsDashboardCommercialHealthV1 } from
  "../ebay/seller-os-dashboard-commercial-health-v1"
import { readLunaQuickPickProgressV1 } from
  "../ebay/ebay-luna-quick-pick-v1"
import { projectQuickPickOwnerCardV1,
  readRecentDurableQuickPickCandidateKeysV1 } from
  "../ebay/seller-os-quick-pick-owner-read-model-v1"
import { readLatestLunaShippingRuntimeTraceV1,
  resolveLunaChromeShippingJobsV1 } from
  "../ebay/ebay-luna-chrome-shipping-capture-server-v1"
import { getMarketplaceFulfillmentDashboard } from
  "../marketplace/fulfillment-v1a-service"
import { auditSellerOsOperationalIntegrityV1,
  type SellerOsOperationalIntegrityInputV1 } from
  "./operational-integrity-auditor-v1"
import { sellerOsOperationalStateV1,
  type SellerOsOperationalStateV1 } from "./operational-status-v1"
import { readSellerOsOwnerOperationalInsightsV1 } from
  "./owner-operational-insights-v1"

export const SELLER_OS_OPERATIONAL_SNAPSHOT_V1 =
  "SELLER_OS_OPERATIONAL_SNAPSHOT_V1" as const
export const SELLER_OS_PUBLISHER_PHYSICAL_STATE_V1 =
  "FAILED_PHYSICAL_ACCEPTANCE" as const

type Result<T> = Readonly<{ available: true; value: T }> |
  Readonly<{ available: false; value: null }>

function settled<T>(result: PromiseSettledResult<T>): Result<T> {
  return result.status === "fulfilled"
    ? Object.freeze({ available: true as const, value: result.value })
    : Object.freeze({ available: false as const, value: null })
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function text(value: unknown, maximum = 160) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maximum) : null
}

function count(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function exactZero(value: unknown) {
  if (value === null || value === undefined || value === "") return false
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed === 0
}

function workerCapabilityReceipt(events: readonly Readonly<{
  timestamp: string
  state: string
  success: boolean
}>[], now: Date) {
  const latest = events[events.length - 1]
  const observedAtMs = Date.parse(latest?.timestamp ?? "")
  const receiptPresent = Boolean(latest && Number.isFinite(observedAtMs))
  const receiptFresh = receiptPresent && now.getTime() >= observedAtMs
    && now.getTime() - observedAtMs <= 20 * 60 * 1_000
  const capabilityPass = receiptFresh && latest?.success === true
    && latest.state !== "FAIL" && events.some((event) => event.success && [
    "PRODUCTION_WORKER_READY", "BRIDGE_CONNECTED",
    "WORKER_IDLE_NO_ELIGIBLE_JOB", "PASS",
  ].includes(event.state))
  return Object.freeze({ receiptPresent, receiptFresh, capabilityPass,
    observedAt: receiptPresent ? new Date(observedAtMs).toISOString() : null,
    maximumAgeSeconds: 20 * 60 })
}

export async function readSellerOsOperationalSnapshotV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  accountAlias: string | null
  now?: Date
}>) {
  const now = input.now ?? new Date()
  const candidateKeysResult = await Promise.allSettled([
    readRecentDurableQuickPickCandidateKeysV1({
      supabase: input.supabase, limit: 20,
    }),
  ])
  const candidateKeys = candidateKeysResult[0].status === "fulfilled"
    ? candidateKeysResult[0].value : Object.freeze([] as string[])
  const [quickPickRaw, commercialRaw, fulfillmentRaw, researchRaw,
    researchPlanRaw, mayelRaw, lunaJobsRaw, lunaTraceRaw] =
    await Promise.allSettled([
      readLunaQuickPickProgressV1({ supabase: input.supabase,
        accountKey: input.accountKey, candidateKeys, includeRecent: false }),
      getSellerOsDashboardCommercialHealthV1({
        supabase: input.supabase, accountKey: input.accountKey,
        accountAlias: input.accountAlias, now,
      }),
      getMarketplaceFulfillmentDashboard(input.supabase),
      getProductResearchBrowserCaptureStatus({
        supabase: input.supabase, accountKey: input.accountKey,
      }),
      getProductResearchQueryPlanStatus({
        supabase: input.supabase, accountKey: input.accountKey,
      }),
      input.supabase.from("ebay_mayel_visual_tasks_v1")
        .select("status,updated_at")
        .eq("marketplace_account_key", input.accountKey)
        .order("updated_at", { ascending: false }).limit(100),
      resolveLunaChromeShippingJobsV1({ supabase: input.supabase,
        accountKey: input.accountKey,
        sessionSecret: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "",
        now: now.getTime(),
      }),
      readLatestLunaShippingRuntimeTraceV1({ supabase: input.supabase,
        accountKey: input.accountKey, now: now.getTime() }),
    ])

  const quickPick = settled(quickPickRaw)
  const rawCards = quickPick.available ? quickPick.value : []
  const ownerCards = rawCards.map((card) =>
    projectQuickPickOwnerCardV1(card))
  const authoritativeReadyCount = quickPick.available
    ? ownerCards.filter((card) =>
      card.publisherActionability.authoritativeReady).length : null
  const readModelReadyCount = quickPick.available
    ? ownerCards.filter((card) => card.state === "READY").length : null
  const actionableReadyCount = quickPick.available
    ? ownerCards.filter((card) =>
      card.publisherActionability.actionable).length : null
  const batchEligibleCount = quickPick.available
    ? ownerCards.filter((card) =>
      card.publisherActionability.batchEligible).length : null
  const technicalReadyCount = quickPick.available
    ? ownerCards.filter((card) =>
      card.publisherActionability.technicalReady).length : null
  const readyWithoutActionPathCount = quickPick.available
    ? ownerCards.filter((card) => card.state === "READY"
      && !card.publisherActionability.actionPath).length : null
  const readyWithStalePackageCount = quickPick.available
    ? ownerCards.filter((card) => card.state === "READY"
      && card.publisherActionability.packageCurrent !== true).length : null
  const readyWithContradictoryEconomicsCount = quickPick.available
    ? ownerCards.filter((card) => card.state === "READY"
      && card.shippingUsd !== null && card.shippingUsd > 0
      && exactZero(record(card.dollarCheck).shipping)).length : null
  const shippingProvenAndZeroCount = quickPick.available
    ? ownerCards.filter((card) => card.shippingUsd !== null
      && card.shippingUsd > 0 && exactZero(record(card.dollarCheck).shipping))
      .length : null
  const provenanceClassifiedCount = quickPick.available
    ? ownerCards.filter((card) => Boolean(card.provenance.sourceType)).length
    : null
  const ownerFactCount = quickPick.available ? ownerCards.filter((card) =>
    card.ownerResidualActions.length > 0).length : null
  const candidateBlockerCount = quickPick.available ? ownerCards.filter(
    (card) => card.state === "BLOCKED").length : null

  const commercial = settled(commercialRaw)
  const health = commercial.available ? commercial.value : null
  const stockGuard = record(health?.stockGuard)
  const orders = record(health?.orders)
  const postSale = record(health?.postSale)
  const whatsapp = record(postSale.whatsapp)
  const buyer = record(postSale.buyerThankYou)
  const liveAuthority = commercial.available &&
    typeof stockGuard.cohortAuthority === "string" &&
    stockGuard.cohortAuthority.length > 0 &&
    stockGuard.cohortReceiptFresh === true
  const postSaleAuthority = commercial.available &&
    postSale.authorityAvailable === true
  const whatsappExceptions = count(whatsapp.manualReviewCount)
  const buyerExceptions = count(buyer.manualReviewRequired)
  const postSaleExceptions = postSaleAuthority &&
      whatsappExceptions !== null && buyerExceptions !== null
    ? whatsappExceptions + buyerExceptions : null

  const fulfillment = settled(fulfillmentRaw)
  const fulfillmentTasks = fulfillment.available &&
      Array.isArray(fulfillment.value.tasks)
    ? fulfillment.value.tasks : null
  const mayel = settled(mayelRaw)
  const mayelRows = mayel.available && !mayel.value.error &&
      Array.isArray(mayel.value.data) ? mayel.value.data : null
  const mayelOpen = mayelRows?.filter((row) =>
    !["COMPLETED", "CLOSED"].includes(String(row.status))).length ?? null
  const mayelOwner = mayelRows?.filter((row) =>
    row.status === "OWNER_PREVIEW_READY").length ?? null
  const recentCutoff = now.getTime() - 24 * 60 * 60 * 1_000
  const mayelRecent = mayelRows?.filter((row) =>
    Number.isFinite(Date.parse(String(row.updated_at ?? ""))) &&
    Date.parse(String(row.updated_at)) >= recentCutoff).length ?? null

  const research = settled(researchRaw)
  const researchPlan = settled(researchPlanRaw)
  const planStatus = researchPlan.available
    ? String(researchPlan.value?.status ?? "") : ""
  const latestResearch = record(research.available
    ? research.value.latest : null)
  const latestResearchAt = Date.parse(String(latestResearch.captured_at ??
    latestResearch.created_at ?? ""))
  const recentResearch = Number.isFinite(latestResearchAt) &&
    now.getTime() >= latestResearchAt &&
    now.getTime() - latestResearchAt <= 30 * 60 * 1_000
  const productResearchAuthorityAvailable = research.available &&
    researchPlan.available
  const productResearchCapabilityReceiptPresent =
    Number.isFinite(latestResearchAt)
  const productResearchState: SellerOsOperationalStateV1 =
    !productResearchAuthorityAvailable || !recentResearch ? "DESCONOCIDO"
      : planStatus === "COMPLETE" ? "SIN_TRABAJO" : "OPERANDO"
  const productResearchPresentationCause = !productResearchAuthorityAvailable
    ? "PRODUCT_RESEARCH_AUTHORITY_UNAVAILABLE"
    : !productResearchCapabilityReceiptPresent
      ? "PRODUCT_RESEARCH_WORKER_CAPABILITY_RECEIPT_ABSENT"
      : !recentResearch ? "PRODUCT_RESEARCH_WORKER_CAPABILITY_RECEIPT_EXPIRED"
        : planStatus === "COMPLETE"
          ? "FRESH_CAPABILITY_AND_NO_PENDING_PLAN_WORK"
          : "FRESH_CAPABILITY_AND_PLAN_WORK_AVAILABLE"

  const lunaJobs = settled(lunaJobsRaw)
  const lunaTrace = settled(lunaTraceRaw)
  const lunaEvents = lunaTrace.available ? lunaTrace.value.events : []
  const lunaReceipt = workerCapabilityReceipt(lunaEvents, now)
  const lunaCapabilityProven = lunaTrace.available
    && lunaReceipt.capabilityPass
  const eligiblePendingJobCount = lunaJobs.available
    ? lunaJobs.value.length : null
  const lunaState: SellerOsOperationalStateV1 =
    eligiblePendingJobCount !== null && eligiblePendingJobCount > 0 &&
      !lunaCapabilityProven ? "BLOQUEADO"
      : !lunaCapabilityProven ? "DESCONOCIDO"
        : eligiblePendingJobCount === 0 ? "SIN_TRABAJO" : "RECUPERANDO"
  const lunaPresentationCause = !lunaTrace.available
    ? "LUNA_TRACE_AUTHORITY_UNAVAILABLE"
    : !lunaReceipt.receiptPresent ? "LUNA_WORKER_CAPABILITY_RECEIPT_ABSENT"
      : !lunaReceipt.receiptFresh
        ? "LUNA_WORKER_CAPABILITY_RECEIPT_EXPIRED"
        : !lunaReceipt.capabilityPass
          ? "LUNA_WORKER_CAPABILITY_NOT_PROVEN"
          : !lunaJobs.available ? "LUNA_PENDING_JOB_AUTHORITY_UNAVAILABLE"
            : eligiblePendingJobCount === 0
              ? "FRESH_CAPABILITY_AND_NO_ELIGIBLE_PENDING_WORK"
              : "FRESH_CAPABILITY_WITH_ELIGIBLE_PENDING_WORK"

  const orderAuthority = orders.sourceStatus === "AVAILABLE"
  const ebayState: SellerOsOperationalStateV1 = orderAuthority
    ? "OPERANDO" : orders.sourceStatus === "UNAVAILABLE"
      ? "BLOQUEADO" : "DESCONOCIDO"
  const mayelState = sellerOsOperationalStateV1({
    authorityAvailable: mayelRows !== null,
    pendingCount: mayelOpen,
    working: mayelOpen !== null && mayelOpen > 0,
  })
  // Keep this bounded projection after the existing high-fanout acquisition.
  // It avoids recreating the publisher's previous concurrent-read failure.
  const insightsRaw = await Promise.allSettled([
    readSellerOsOwnerOperationalInsightsV1({ supabase: input.supabase,
      accountKey: input.accountKey, now }),
  ])
  const insights = settled(insightsRaw[0])
  const latestLunaEvent = lunaEvents.at(-1)

  return Object.freeze({
    contractVersion: SELLER_OS_OPERATIONAL_SNAPSHOT_V1,
    observedAt: now.toISOString(),
    publication: Object.freeze({
      authorityAvailable: quickPick.available,
      authoritativeReadyCount,
      readModelReadyCount,
      visibleReadyCount: readModelReadyCount,
      actionableReadyCount,
      batchEligibleCount,
      batchButtonCount: batchEligibleCount,
      explicitLegitimateBlockerCount: 0,
      preparedReadyCount: technicalReadyCount,
      technicalReadyCount,
      readyWithoutActionPathCount,
      readyWithStalePackageCount,
      readyWithContradictoryEconomicsCount,
      shippingProvenAndZeroCount,
      candidateCount: quickPick.available ? ownerCards.length : null,
      provenanceClassifiedCount,
      ownerFactCount,
      candidateBlockerCount,
      publisherState: SELLER_OS_PUBLISHER_PHYSICAL_STATE_V1,
      publisherPhysicalAcceptance: false as const,
    }),
    business: Object.freeze({
      liveAuthority,
      activeListings: liveAuthority ? count(health?.activeListings) : null,
      liveAttention: liveAuthority ? count(stockGuard.riskCount) : null,
      orderAuthority,
      officialOrders: orderAuthority ? count(orders.officialOrderCount) : null,
      fulfillmentAuthority: fulfillmentTasks !== null,
      fulfillmentPending: fulfillmentTasks?.length ?? null,
      postSaleAuthority,
      postSaleExceptions,
      postSaleWorking: postSaleAuthority &&
        (["SUCCEEDED", "ARMED"].includes(String(whatsapp.status)) ||
          ["SUCCEEDED", "ARMED"].includes(String(buyer.status))),
    }),
    mayel: Object.freeze({ authorityAvailable: mayelRows !== null,
      delegatedCount: mayelOpen, ownerExceptionCount: mayelOwner,
      recentResultCount: mayelRecent }),
    capabilities: Object.freeze({
      lunaShipping: Object.freeze({ state: lunaState,
        connectionState: lunaReceipt.receiptFresh
          ? "CONECTADA" as const : "DESCONOCIDA" as const,
        authorityAvailable: lunaTrace.available && lunaJobs.available,
        connected: lunaCapabilityProven,
        capabilityProven: lunaCapabilityProven,
        capabilityFresh: lunaReceipt.receiptFresh,
        capabilityObservedAt: lunaReceipt.observedAt,
        extensionVersion: text(record(latestLunaEvent).extensionVersion, 40),
        lastSuccessfulActivity: [...lunaEvents].reverse().find((event) =>
          event.success)?.timestamp ?? null,
        lastError: [...lunaEvents].reverse().find((event) =>
          !event.success)?.state ?? null,
        capabilityMaximumAgeSeconds: lunaReceipt.maximumAgeSeconds,
        presentationCause: lunaPresentationCause,
        eligiblePendingJobCount,
        traceDurable: lunaTrace.available && lunaTrace.value.traceDurable }),
      productResearch: Object.freeze({ state: productResearchState,
        connectionState: recentResearch
          ? "CONECTADA" as const : "DESCONOCIDA" as const,
        authorityAvailable: productResearchAuthorityAvailable,
        capabilityProven: recentResearch,
        capabilityFresh: recentResearch,
        capabilityObservedAt: productResearchCapabilityReceiptPresent
          ? new Date(latestResearchAt).toISOString() : null,
        capabilityMaximumAgeSeconds: 30 * 60,
        extensionVersion: null,
        lastSuccessfulActivity: productResearchCapabilityReceiptPresent
          ? new Date(latestResearchAt).toISOString() : null,
        lastError: null,
        queuePlanState: planStatus || null,
        presentationCause: productResearchPresentationCause }),
      publisher: Object.freeze({ state: "BLOQUEADO" as const,
        blocker: SELLER_OS_PUBLISHER_PHYSICAL_STATE_V1 }),
      ebay: Object.freeze({ state: ebayState }),
      mayel: Object.freeze({ state: mayelState }),
    }),
    ownerInsights: insights.available ? insights.value : null,
    authorityFailures: Object.freeze([
      !quickPick.available ? "QUICK_PICK_AUTHORITY_UNAVAILABLE" : null,
      !commercial.available ? "COMMERCIAL_AUTHORITY_UNAVAILABLE" : null,
      !fulfillment.available ? "FULFILLMENT_AUTHORITY_UNAVAILABLE" : null,
      !research.available || !researchPlan.available
        ? "PRODUCT_RESEARCH_AUTHORITY_UNAVAILABLE" : null,
      mayelRows === null ? "MAYEL_AUTHORITY_UNAVAILABLE" : null,
      !lunaJobs.available ? "LUNA_PENDING_JOB_AUTHORITY_UNAVAILABLE" : null,
      !lunaTrace.available ? "LUNA_TRACE_AUTHORITY_UNAVAILABLE" : null,
      !insights.available ? "OWNER_OPERATIONAL_INSIGHTS_UNAVAILABLE" : null,
    ].filter((value): value is string => Boolean(value))),
    safety: Object.freeze({ readOnlyAuthorityAcquisition: true as const,
      marketplaceWrites: 0 as const, productDecisions: 0 as const,
      publisherDispatches: 0 as const }),
  })
}

export type SellerOsOperationalSnapshotV1 = Awaited<ReturnType<
  typeof readSellerOsOperationalSnapshotV1>>

export function auditSellerOsOperationalSnapshotV1(
  snapshot: SellerOsOperationalSnapshotV1,
) {
  const insights = record(snapshot.ownerInsights)
  const sales = record(insights.sales)
  const categories = record(insights.categories)
  const marketOpportunity = record(insights.marketOpportunity)
  const salesWindows = Array.isArray(sales.windows)
    ? sales.windows.map(record) : []
  const ninetyDays = salesWindows.find((window) => window.days === 90)
  const integrityInput: SellerOsOperationalIntegrityInputV1 = {
    observedAt: snapshot.observedAt,
    ready: {
      authorityAvailable: snapshot.publication.authorityAvailable,
      authoritativeCount: snapshot.publication.authoritativeReadyCount,
      readModelCount: snapshot.publication.readModelReadyCount,
      visibleCount: snapshot.publication.visibleReadyCount,
      actionableCount: snapshot.publication.actionableReadyCount,
      batchEligibleCount: snapshot.publication.batchEligibleCount,
      batchButtonCount: snapshot.publication.batchButtonCount,
      explicitLegitimateBlockerCount:
        snapshot.publication.explicitLegitimateBlockerCount,
    },
    candidateIntegrity: {
      readyWithoutActionPathCount:
        snapshot.publication.readyWithoutActionPathCount,
      readyWithStalePackageCount:
        snapshot.publication.readyWithStalePackageCount,
      readyWithContradictoryEconomicsCount:
        snapshot.publication.readyWithContradictoryEconomicsCount,
      shippingProvenAndZeroCount:
        snapshot.publication.shippingProvenAndZeroCount,
      candidateCount: snapshot.publication.candidateCount,
      provenanceClassifiedCount:
        snapshot.publication.provenanceClassifiedCount,
      ownerRuntimeContinueRequiredCount: 0,
    },
    numericProjections: [
      { field: "activeListings",
        authorityAvailable: snapshot.business.liveAuthority,
        authoritativeValue: snapshot.business.activeListings,
        presentedValue: snapshot.business.activeListings },
      { field: "officialOrders",
        authorityAvailable: snapshot.business.orderAuthority,
        authoritativeValue: snapshot.business.officialOrders,
        presentedValue: snapshot.business.officialOrders },
      { field: "fulfillmentPending",
        authorityAvailable: snapshot.business.fulfillmentAuthority,
        authoritativeValue: snapshot.business.fulfillmentPending,
        presentedValue: snapshot.business.fulfillmentPending },
    ],
    workers: [{ worker: "LUNA_SHIPPING",
      authorityAvailable:
        snapshot.capabilities.lunaShipping.authorityAvailable,
      connected: snapshot.capabilities.lunaShipping.connected,
      connectionState: snapshot.capabilities.lunaShipping.connectionState,
      capabilityProven:
        snapshot.capabilities.lunaShipping.capabilityProven,
      capabilityFresh: snapshot.capabilities.lunaShipping.capabilityFresh,
      eligiblePendingJobCount:
        snapshot.capabilities.lunaShipping.eligiblePendingJobCount,
      presentationState: snapshot.capabilities.lunaShipping.state },
    { worker: "PRODUCT_RESEARCH",
      authorityAvailable:
        snapshot.capabilities.productResearch.authorityAvailable,
      connected: snapshot.capabilities.productResearch.capabilityProven,
      connectionState:
        snapshot.capabilities.productResearch.connectionState,
      capabilityProven:
        snapshot.capabilities.productResearch.capabilityProven,
      capabilityFresh: snapshot.capabilities.productResearch.capabilityFresh,
      eligiblePendingJobCount:
        snapshot.capabilities.productResearch.queuePlanState === "COMPLETE"
          ? 0 : null,
      presentationState: snapshot.capabilities.productResearch.state }],
    salesIntegrity: snapshot.ownerInsights ? {
      sourceIsOfficialOrders: sales.source === "OFFICIAL_EBAY_ORDERS",
      orderDedupeProven: sales.orderIdentityDeduplicated === true,
      unknownRevenueRenderedAsZero: false,
      cancelledUnpaidExcluded: true,
      refundIncreasesNetSales: false,
      chartTotalReconciles: ninetyDays
        ? typeof ninetyDays.grossSalesUsd === "number" : null,
      ownerTimeZone: typeof snapshot.ownerInsights.timeZone === "string"
        ? snapshot.ownerInsights.timeZone : null,
    } : undefined,
    categoryIntegrity: snapshot.ownerInsights ? {
      categoryTotalReconciles: typeof categories.totalReconciles === "boolean"
        ? categories.totalReconciles : null,
      unmappedSalesVisible: count(categories.unmappedCount) === 0 ||
        Array.isArray(categories.top) && categories.top.some((entry) =>
          record(entry).mappingStatus === "UNMAPPED"),
      marketOpportunitySeparate:
        marketOpportunity.separateFromAccountSales === true,
      insufficientSampleProducesTrend: false,
      staleDataPresentedCurrent: sales.freshness === "STALE" &&
        categories.status === "AVAILABLE",
    } : undefined,
    actions: [{ capability: "PUBLISHER",
      uiReady: false, actionable: false,
      explicitBlocker: snapshot.capabilities.publisher.blocker }],
    publisher: { internalPass:
        (snapshot.publication.preparedReadyCount ?? 0) > 0,
      physicalPass: false, presentationPhysicalPass: false,
      uiReady: false, publishable: false,
      explicitBlocker: snapshot.capabilities.publisher.blocker },
    marketplaceResults: [],
    getBusinessMutationCount: 0,
  }
  return auditSellerOsOperationalIntegrityV1(integrityInput)
}
