import type { SupabaseClient } from "@supabase/supabase-js"

import {
  createAmazonSalesTrafficReportV1,
  createAmazonSpApiReadOnlyClientV1,
  getAmazonSpApiReadOnlyConfigurationV1,
  parseAmazonSalesTrafficReportV1,
  readAmazonFinancesV1,
  readAmazonSalesTrafficReportStatusV1,
  searchAmazonListingsReadOnlyV1,
  type AmazonFinanceMetricV1,
  type AmazonSalesTrafficMetricV1,
} from "@/lib/marketplace/amazon-sp-api-readonly-v1"
import {
  buildAmazonContributorObservationV1,
  persistAmazonContributorObservationV1,
  readAmazonContributorPerformanceV1,
  SELLER_OS_CONNIE_COLLABORATOR_KEY_V1,
} from "@/lib/marketplace/seller-os-amazon-contributor-performance-v1"

export const SELLER_OS_AMAZON_CONNIE_AUTOMATIC_CAPTURE_V1 =
  "SELLER_OS_AMAZON_CONNIE_AUTOMATIC_CAPTURE_V1" as const

type Json = Record<string, unknown>

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Json : {}
}

function safeCode(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_]{2,119}$/.test(message) ? message : fallback
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function daysBetween(start: string, end: string) {
  return Math.max(1, Math.ceil((Date.parse(end) - Date.parse(start)) /
    86_400_000))
}

function reportWindow(now: Date) {
  const end = new Date(now.getTime() - 72 * 60 * 60 * 1_000)
  end.setUTCHours(23, 59, 59, 999)
  const start = new Date(end.getTime() - 27 * 86_400_000)
  start.setUTCHours(0, 0, 0, 0)
  return { start: start.toISOString(), end: end.toISOString() }
}

async function collaboratorId(supabase: SupabaseClient) {
  const result = await supabase.from("seller_os_sourcing_collaborators_v1")
    .select("id").eq("collaborator_key",
      SELLER_OS_CONNIE_COLLABORATOR_KEY_V1).limit(1).maybeSingle()
  if (result.error || !result.data?.id) {
    throw new Error("SELLER_OS_AMAZON_CONTRIBUTOR_PROFILE_UNAVAILABLE")
  }
  return String(result.data.id)
}

async function readSyncState(supabase: SupabaseClient, contributorId: string,
  marketplaceId: string) {
  const state = await supabase
    .from("seller_os_amazon_contributor_sync_state_v1")
    .select("*").eq("collaborator_id", contributorId)
    .eq("marketplace_id", marketplaceId).limit(1).maybeSingle()
  if (state.error) throw new Error("AMAZON_SP_API_SYNC_STATE_READ_FAILED")
  return record(state.data)
}

async function writeSyncState(supabase: SupabaseClient, value: Json) {
  const result = await supabase
    .from("seller_os_amazon_contributor_sync_state_v1")
    .upsert(value, { onConflict: "collaborator_id,marketplace_id" })
  if (result.error) throw new Error("AMAZON_SP_API_SYNC_STATE_WRITE_FAILED")
}

function sourceFromExisting(existing: Json, sellerSku: string, asin: string | null) {
  const supplier = record(existing.supplier)
  if (stringOrNull(supplier.name) && stringOrNull(supplier.baseUrl) &&
      stringOrNull(supplier.sku)) return { ...supplier,
        sourceKeyOverride: stringOrNull(supplier.sourceKey) ?? undefined }
  return {
    name: "Proveedor pendiente de vincular",
    baseUrl: "https://sellercentral.amazon.com",
    sourceKeyOverride: "amazon-connie-products",
    sku: sellerSku,
    productId: asin ?? sellerSku,
    variantId: sellerSku,
    productUrl: asin ? `https://www.amazon.com/dp/${asin}` : null,
    inventoryQuantity: null,
    evidenceState: "UNPROVEN",
  }
}

function economicsFromExisting(existing: Json, priceUsd: number | null) {
  const economics = record(existing.economics)
  return {
    unitCostUsd: numberOrNull(economics.unitCostUsd),
    inboundShippingPerUnitUsd:
      numberOrNull(economics.inboundShippingPerUnitUsd),
    prepCostPerUnitUsd: numberOrNull(economics.prepCostPerUnitUsd),
    expectedSalePriceUsd: priceUsd ??
      numberOrNull(economics.expectedSalePriceUsd),
    referralFeePerUnitUsd: numberOrNull(economics.referralFeePerUnitUsd),
    fbaFeePerUnitUsd: numberOrNull(economics.fbaFeePerUnitUsd),
    otherVariableCostPerUnitUsd:
      numberOrNull(economics.otherVariableCostPerUnitUsd),
  }
}

function financeForResult(metric: AmazonSalesTrafficMetricV1 | undefined,
  finance: AmazonFinanceMetricV1 | undefined) {
  if (!metric) return { amazonFeesUsd: null, fulfillmentFeesUsd: null,
    refundsUsd: null, financeMatchState: "NO_SALES_REPORT" }
  if (metric.unitsOrdered === 0) return { amazonFeesUsd: 0,
    fulfillmentFeesUsd: 0, refundsUsd: 0,
    financeMatchState: "AUTHORITATIVE_ZERO_SALES" }
  if (!finance || finance.matchedTransactions === 0) return {
    amazonFeesUsd: null, fulfillmentFeesUsd: null, refundsUsd: null,
    financeMatchState: "FINANCE_MATCH_UNAVAILABLE" }
  return { amazonFeesUsd: finance.amazonFeesUsd,
    fulfillmentFeesUsd: finance.fulfillmentFeesUsd,
    refundsUsd: finance.refundsUsd, financeMatchState: "MATCHED_BY_SELLER_SKU" }
}

export async function runSellerOsAmazonConnieAutomaticCaptureV1(input: {
  supabase: SupabaseClient
  environment?: NodeJS.ProcessEnv
  fetcher?: typeof fetch
  now?: Date
}) {
  const now = input.now ?? new Date()
  const nowIso = now.toISOString()
  const config = getAmazonSpApiReadOnlyConfigurationV1(input.environment)
  const contributorId = await collaboratorId(input.supabase)
  const state = await readSyncState(input.supabase, contributorId,
    config.marketplaceId)
  const baseState = { collaborator_id: contributorId,
    marketplace_id: config.marketplaceId,
    seller_sku_prefix: config.skuPrefix, last_attempt_at: nowIso }

  if (config.status !== "READY") {
    await writeSyncState(input.supabase, { ...baseState,
      connection_status: "NOT_CONFIGURED", run_status: "FAILED",
      last_error_code: config.status === "INVALID_CONFIG"
        ? "AMAZON_SP_API_CONFIGURATION_INVALID"
        : "AMAZON_SP_API_CONNECTION_REQUIRED",
      metadata: { contractVersion:
        SELLER_OS_AMAZON_CONNIE_AUTOMATIC_CAPTURE_V1,
        missingConfigurationKeys: config.missing,
        credentialsStored: false, marketplaceWrites: 0 } })
    return Object.freeze({
      contractVersion: SELLER_OS_AMAZON_CONNIE_AUTOMATIC_CAPTURE_V1,
      status: "BLOCKED_CONNECTION" as const,
      reasonCode: config.status === "INVALID_CONFIG"
        ? "AMAZON_SP_API_CONFIGURATION_INVALID"
        : "AMAZON_SP_API_CONNECTION_REQUIRED",
      connection: config, listingsSeen: 0, listingsAttributed: 0,
      observationsWritten: 0, reportStatus: "UNAVAILABLE",
      financeStatus: "UNAVAILABLE",
      safety: { amazonReadOnly: true, amazonWrites: 0,
        supplierPurchases: 0, credentialsStored: false,
        buyerPersonalDataStored: false },
    })
  }

  await writeSyncState(input.supabase, { ...baseState,
    connection_status: "READY", run_status: "RUNNING",
    last_error_code: null, metadata: { contractVersion:
      SELLER_OS_AMAZON_CONNIE_AUTOMATIC_CAPTURE_V1,
      credentialsStored: false, marketplaceWrites: 0 } })

  try {
    const client = createAmazonSpApiReadOnlyClientV1({
      environment: input.environment, fetcher: input.fetcher,
      now: () => now,
    })
    const listings = await searchAmazonListingsReadOnlyV1(client)
    const existingAttribution = await input.supabase
      .from("seller_os_amazon_contributor_sku_attribution_v1")
      .select("seller_sku,attribution_basis,status")
      .eq("collaborator_id", contributorId)
      .eq("marketplace_id", config.marketplaceId)
      .eq("status", "ACTIVE")
    if (existingAttribution.error) {
      throw new Error("AMAZON_SP_API_ATTRIBUTION_READ_FAILED")
    }
    const explicitlyAttributed = new Set((existingAttribution.data ?? [])
      .filter((row) => row.attribution_basis === "OWNER_CONFIRMED")
      .map((row) => String(row.seller_sku).toUpperCase()))
    const prefix = config.skuPrefix.toUpperCase()
    const attributed = listings.filter((listing) =>
      listing.sellerSku.toUpperCase().startsWith(prefix) ||
      explicitlyAttributed.has(listing.sellerSku.toUpperCase()))

    const window = reportWindow(now)
    let sales = new Map<string, AmazonSalesTrafficMetricV1>()
    let salesWindowStart: string | null = null
    let salesWindowEnd: string | null = null
    let reportStatus = "NOT_REQUESTED"
    let reportCompleted = false
    let pendingReportId = stringOrNull(state.pending_report_id)
    if (pendingReportId) {
      const report = await readAmazonSalesTrafficReportStatusV1(client,
        pendingReportId)
      reportStatus = report.status
      if (report.status === "DONE" && report.reportDocumentId) {
        const parsed = parseAmazonSalesTrafficReportV1(
          await client.downloadReportDocument(report.reportDocumentId))
        sales = parsed.metrics
        reportCompleted = true
        salesWindowStart = parsed.dataStartTime ?? report.dataStartTime
        salesWindowEnd = parsed.dataEndTime ?? report.dataEndTime
        pendingReportId = null
      } else if (["CANCELLED", "FATAL"].includes(report.status)) {
        pendingReportId = null
      }
    }

    if (!pendingReportId) {
      pendingReportId = await createAmazonSalesTrafficReportV1(client, {
        dataStartTime: window.start, dataEndTime: window.end,
      })
      reportStatus = reportCompleted ? "DONE_AND_REFRESH_REQUESTED"
        : "IN_QUEUE"
    }

    let finances = new Map<string, AmazonFinanceMetricV1>()
    let financeStatus = "AVAILABLE"
    try {
      finances = await readAmazonFinancesV1(client, { postedAfter: window.start,
        postedBefore: window.end })
    } catch (error) {
      financeStatus = safeCode(error, "AMAZON_SP_API_FINANCES_UNAVAILABLE")
    }

    const monitor = await readAmazonContributorPerformanceV1({
      supabase: input.supabase, limit: 100,
    })
    const existingBySellerSku = new Map(monitor.cards.flatMap((card) => {
      const observation = record(card.observation)
      const sellerSku = stringOrNull(record(observation.amazonListing).sellerSku)
      return sellerSku ? [[sellerSku.toUpperCase(), observation] as const] : []
    }))

    let observationsWritten = 0
    let idempotentReplays = 0
    for (const listing of attributed) {
      const existing = existingBySellerSku.get(
        listing.sellerSku.toUpperCase()) ?? {}
      const salesMetric = listing.asin ? sales.get(listing.asin) : undefined
      const financeMetric = finances.get(listing.sellerSku)
      const finance = financeForResult(salesMetric, financeMetric)
      const observedAt = salesMetric && salesWindowEnd
        ? salesWindowEnd : listing.lastUpdatedAt ?? nowIso
      const existingPerformance = record(existing.performance)
      const observation = buildAmazonContributorObservationV1({
        observedAt,
        capture: { mode: "AMAZON_SP_API_READ_ONLY",
          authority: "AMAZON_SELLER_CENTRAL", automated: true,
          listingApi: "Listings Items API v2021-08-01",
          demandReport: "GET_SALES_AND_TRAFFIC_REPORT",
          financeApi: "Finances API v2024-06-19",
          reportStatus, financeStatus,
          reportWindowStart: salesWindowStart ?? window.start,
          reportWindowEnd: salesWindowEnd ?? window.end,
          amazonDoesNotExposeListingCreator: true,
          attributionBasis: listing.sellerSku.toUpperCase().startsWith(prefix)
            ? "SKU_PREFIX" : "OWNER_CONFIRMED" },
        supplier: sourceFromExisting(existing, listing.sellerSku, listing.asin),
        product: { title: listing.title, brand: listing.brand,
          category: listing.productType, asin: listing.asin,
          upc: record(existing.product).upc,
          condition: listing.condition },
        demand: { claim: salesMetric && salesMetric.unitsOrdered > 0
            ? "HIGH" : "UNKNOWN",
          evidenceState: salesMetric && salesMetric.unitsOrdered > 0
            ? "CONFIRMED" : salesMetric ? "UNPROVEN" : "UNAVAILABLE",
          source: "Amazon SP-API GET_SALES_AND_TRAFFIC_REPORT",
          observedAt: salesMetric ? salesWindowEnd : null,
          notes: salesMetric && salesMetric.unitsOrdered === 0
            ? "AUTHORITATIVE_ZERO_IN_REPORT_WINDOW" : null },
        eligibility: { state: listing.state === "ACTIVE"
            ? "CONFIRMED" : "UNPROVEN",
          observedAt: listing.lastUpdatedAt ?? nowIso },
        economics: economicsFromExisting(existing, listing.priceUsd),
        amazonListing: { state: listing.state,
          sellerSku: listing.sellerSku, listingPriceUsd: listing.priceUsd,
          availableQuantity: listing.availableQuantity,
          listedAt: listing.createdAt, lastUpdatedAt: listing.lastUpdatedAt },
        performance: { authority: salesMetric
            ? "SELLER_CENTRAL_REPORT" : "UNPROVEN",
          observationWindowDays: salesWindowStart && salesWindowEnd
            ? daysBetween(salesWindowStart, salesWindowEnd) : null,
          unitsPurchased: numberOrNull(existingPerformance.unitsPurchased),
          unitsSold: salesMetric?.unitsOrdered ?? null,
          grossSalesUsd: salesMetric?.grossSalesUsd ?? null,
          sessions: salesMetric?.sessions ?? null,
          pageViews: salesMetric?.pageViews ?? null,
          unitSessionPercentage: salesMetric?.unitSessionPercentage ?? null,
          amazonFeesUsd: finance.amazonFeesUsd,
          fulfillmentFeesUsd: finance.fulfillmentFeesUsd,
          refundsUsd: finance.refundsUsd,
          financeMatchState: finance.financeMatchState,
          otherActualCostsUsd:
            numberOrNull(existingPerformance.otherActualCostsUsd),
          firstSaleAt: stringOrNull(existingPerformance.firstSaleAt),
          observedAt: salesMetric ? salesWindowEnd : null },
      }, { now })
      const persisted = await persistAmazonContributorObservationV1({
        supabase: input.supabase, recordedByUserId: null, observation,
      })
      if (persisted.replay === true) idempotentReplays += 1
      else observationsWritten += 1
      const attribution = await input.supabase
        .from("seller_os_amazon_contributor_sku_attribution_v1")
        .upsert({ collaborator_id: contributorId,
          marketplace_id: config.marketplaceId,
          seller_sku: listing.sellerSku, asin: listing.asin,
          attribution_basis: listing.sellerSku.toUpperCase().startsWith(prefix)
            ? "SKU_PREFIX" : "OWNER_CONFIRMED",
          status: "ACTIVE", title: listing.title,
          listing_state: listing.state,
          first_observed_at: listing.createdAt ?? observedAt,
          last_observed_at: observedAt, listing_digest: listing.digest },
        { onConflict: "marketplace_id,seller_sku" })
      if (attribution.error) {
        throw new Error("AMAZON_SP_API_ATTRIBUTION_WRITE_FAILED")
      }
    }

    const partial = reportStatus !== "DONE_AND_REFRESH_REQUESTED" ||
      financeStatus !== "AVAILABLE"
    await writeSyncState(input.supabase, { ...baseState,
      connection_status: partial ? "DEGRADED" : "READY",
      run_status: reportCompleted ? partial ? "PARTIAL" : "SUCCESS"
        : "WAITING_REPORT",
      last_success_at: nowIso, last_listing_sync_at: nowIso,
      last_finance_sync_at: financeStatus === "AVAILABLE" ? nowIso : null,
      last_report_requested_at: nowIso,
      last_report_completed_at: reportCompleted ? nowIso : null,
      pending_report_id: pendingReportId,
      pending_report_created_at: nowIso,
      report_window_start: window.start, report_window_end: window.end,
      last_error_code: financeStatus === "AVAILABLE" ? null : financeStatus,
      listings_seen: listings.length, listings_attributed: attributed.length,
      observations_written: observationsWritten,
      metadata: { contractVersion:
        SELLER_OS_AMAZON_CONNIE_AUTOMATIC_CAPTURE_V1,
        reportStatus, financeStatus, idempotentReplays,
        credentialsStored: false, buyerPersonalDataStored: false,
        marketplaceWrites: 0 } })

    return Object.freeze({
      contractVersion: SELLER_OS_AMAZON_CONNIE_AUTOMATIC_CAPTURE_V1,
      status: reportCompleted ? partial ? "PARTIAL" as const
        : "SUCCESS" as const : "WAITING_REPORT" as const,
      reasonCode: reportCompleted ? partial
        ? "AMAZON_CAPTURE_PARTIAL_EVIDENCE" : "AMAZON_CAPTURE_COMPLETE"
        : "AMAZON_SALES_REPORT_PENDING",
      connection: config, listingsSeen: listings.length,
      listingsAttributed: attributed.length, observationsWritten,
      idempotentReplays, reportStatus, financeStatus,
      safety: { amazonReadOnly: true, amazonWrites: 0,
        reportRequests: 1, listingMutations: 0, priceChanges: 0,
        publications: 0, supplierPurchases: 0, credentialsStored: false,
        buyerPersonalDataStored: false },
    })
  } catch (error) {
    const reasonCode = safeCode(error, "AMAZON_SP_API_AUTOMATIC_CAPTURE_FAILED")
    if (reasonCode === "AMAZON_SP_API_UPSTREAM_RETRYABLE") {
      await writeSyncState(input.supabase, { ...baseState,
        connection_status: "DEGRADED",
        run_status: state.pending_report_id ? "WAITING_REPORT" : "PARTIAL",
        last_error_code: reasonCode,
        metadata: { ...record(state.metadata), contractVersion:
          SELLER_OS_AMAZON_CONNIE_AUTOMATIC_CAPTURE_V1,
          upstreamState: "WAIT_UPSTREAM", credentialsStored: false,
          buyerPersonalDataStored: false, marketplaceWrites: 0 } })
      return Object.freeze({
        contractVersion: SELLER_OS_AMAZON_CONNIE_AUTOMATIC_CAPTURE_V1,
        status: "WAITING_UPSTREAM" as const, reasonCode,
        connection: config,
        listingsSeen: numberOrNull(state.listings_seen) ?? 0,
        listingsAttributed: numberOrNull(state.listings_attributed) ?? 0,
        observationsWritten: 0,
        reportStatus: "WAIT_UPSTREAM",
        financeStatus: "UNAVAILABLE",
        safety: { amazonReadOnly: true, amazonWrites: 0,
          reportRequests: 0, listingMutations: 0, priceChanges: 0,
          publications: 0, supplierPurchases: 0, credentialsStored: false,
          buyerPersonalDataStored: false, pendingReportPreserved:
            Boolean(state.pending_report_id) },
      })
    }
    await writeSyncState(input.supabase, { ...baseState,
      connection_status: reasonCode === "AMAZON_SP_API_AUTHORIZATION_REQUIRED"
        ? "NOT_CONFIGURED" : "UNAVAILABLE",
      run_status: "FAILED", last_error_code: reasonCode,
      metadata: { contractVersion:
        SELLER_OS_AMAZON_CONNIE_AUTOMATIC_CAPTURE_V1,
        credentialsStored: false, buyerPersonalDataStored: false,
        marketplaceWrites: 0 } }).catch(() => undefined)
    throw new Error(reasonCode)
  }
}
