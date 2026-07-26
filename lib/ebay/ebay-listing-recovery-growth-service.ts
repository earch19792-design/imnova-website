import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  diagnoseListingRecovery,
  runFiveListingRecoveryDryRun,
  type ListingRecoveryInput,
} from "./ebay-listing-recovery-growth-domain"
import {
  fiveListingRecoveryFixtures,
} from "./ebay-listing-recovery-growth-fixtures"

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown, maximum = 200) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximum)
    : ""
}

function numeric(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function iso(value: unknown) {
  const candidate = text(value, 40)
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

export async function getEbayListingRecoveryDashboard(
  supabase: SupabaseClient,
) {
  const [config, rows, experiments, runs, learning] = await Promise.all([
    supabase.from("ebay_listing_recovery_configs")
      .select("marketplace_account_key,marketplace,enabled,shadow_mode,scheduler_enabled,external_writes_enabled,policy_version,policy")
      .limit(5),
    supabase.from("ebay_listing_recovery_dashboard_v1")
      .select("*").order("updated_at", { ascending: false }).limit(200),
    supabase.from("commercial_experiment_controls")
      .select("id,listing_id,sku,status,variable,primary_kpi,measurement_due_at,cooldown_until,result,updated_at")
      .order("updated_at", { ascending: false }).limit(100),
    supabase.from("ebay_listing_recovery_runs")
      .select("id,status,trigger_source,selected_count,diagnosed_count,quarantined_count,started_at,completed_at")
      .order("started_at", { ascending: false }).limit(10),
    supabase.from("ebay_listing_recovery_learning_events")
      .select("commercially_reusable").limit(1_000),
  ])
  const error = config.error ?? rows.error ?? experiments.error ?? runs.error ??
    learning.error
  if (error) throw new Error("EBAY_LISTING_RECOVERY_DASHBOARD_READ_FAILED")
  const learningRows = learning.data ?? []
  return {
    configuration: config.data ?? [],
    listings: rows.data ?? [],
    experiments: experiments.data ?? [],
    runs: runs.data ?? [],
    metrics: {
      listingsInRecovery: rows.data?.length ?? 0,
      activeExperiments: (experiments.data ?? []).filter((row) =>
        ["APPROVED", "EXECUTED_MANUALLY", "MEASURING"].includes(row.status)
      ).length,
      reusableLearnings: learningRows.filter((row) =>
        row.commercially_reusable === true).length,
      externalWrites: 0,
    },
    safety: {
      ebayWrites: 0,
      automaticPriceChanges: 0,
      automaticPromotions: 0,
      automaticOffers: 0,
    },
  }
}

export function runEbayListingRecoveryFixtureDryRun() {
  return runFiveListingRecoveryDryRun(fiveListingRecoveryFixtures())
}

function recoveryInputFromSnapshot(input: {
  row: JsonRecord
  confirmedUnits: number
  paid: JsonRecord | null
}): ListingRecoveryInput {
  const row = input.row
  const source = record(row.source)
  const identity = record(source.identity)
  const economics = record(source.economics)
  const listingId = text(row.listing_id, 30)
  const observedAt = iso(row.observed_at) ?? new Date().toISOString()
  const complete = row.completeness_status === "complete"
  const officialMatched = row.analytics_reconciliation_status === "MATCHED"
  const publishedAt = iso(
    record(source.listingAgeEvidence).startedAt ??
    source.listingStartedAt,
  )
  const margin = numeric(row.estimated_margin_percent)
  const stock = numeric(row.stock_available)
  const paid = input.paid
  return {
    marketplaceAccountKey: text(row.marketplace_account_key, 160),
    marketplace: text(row.marketplace, 40),
    listingId,
    sku: text(row.sku, 100) || null,
    offerId: text(identity.offerId, 100) || null,
    itemId: listingId || null,
    dossierId: text(source.dossierId, 100) || null,
    observedAt,
    listing: {
      status: text(row.listing_status, 40).toUpperCase(),
      publishedAt,
      categoryId: text(identity.categoryId, 40) || null,
      condition: text(identity.condition, 40) || null,
      pack: text(identity.pack, 40) || null,
      productType: text(identity.productType, 100) || null,
      priceBand: null,
      activeVerified: text(row.listing_status, 40).toLowerCase() === "active",
      inventoryItemVerified: identity.inventoryItemVerified === true,
      offerVerified: identity.offerVerified === true,
      itemIdVerified: Boolean(listingId),
      categoryValid: identity.categoryValid === true,
      requiredAspectsComplete: identity.requiredAspectsComplete === true,
      policiesResolved: identity.policiesResolved === true,
      stockPositive: stock !== null && stock > 0,
      indexationIssueCodes: Array.isArray(source.indexationIssueCodes)
        ? source.indexationIssueCodes.filter((value): value is string =>
            typeof value === "string").slice(0, 20)
        : [],
    },
    metrics: {
      organic: {
        source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
        scope: "sell.analytics.readonly",
        capturedAt: observedAt,
        lastUpdatedDate: iso(row.analytics_last_updated_at),
        timezone: text(row.analytics_timezone, 80) || "UNKNOWN",
        windowStart: text(row.window_start, 20),
        windowEnd: text(row.window_end, 20),
        completeness: complete ? "COMPLETE" : row.completeness_status ===
          "unavailable" ? "UNAVAILABLE" : "INCOMPLETE",
        reconciliation: officialMatched ? "RECONCILED" :
          row.analytics_reconciliation_status ? "PENDING" : "UNKNOWN",
        impressions: numeric(row.impressions),
        searchImpressions: numeric(row.search_impressions),
        storeImpressions: numeric(row.store_impressions),
        views: numeric(row.views),
        searchViews: numeric(row.search_views),
        directViews: numeric(row.direct_views),
        externalViews: numeric(row.external_views),
        otherEbayViews: numeric(row.other_ebay_views),
        storeViews: numeric(row.store_views),
        ctrPercent: numeric(row.ctr),
        salesConversionRatePercent: numeric(row.sales_conversion_rate),
        transactions: numeric(row.transactions),
      },
      paid: paid ? {
        source: "EBAY_SELL_MARKETING_AD_REPORT",
        scope: paid.scope === "sell.marketing"
          ? "sell.marketing" : "sell.marketing.readonly",
        capturedAt: iso(paid.captured_at) ?? observedAt,
        lastUpdatedDate: iso(paid.last_updated_at),
        windowStart: text(paid.window_start, 20),
        windowEnd: text(paid.window_end, 20),
        completeness: paid.completeness_status === "complete"
          ? "COMPLETE" : paid.completeness_status === "unavailable"
            ? "UNAVAILABLE" : "INCOMPLETE",
        reconciliation: paid.reconciliation_status === "reconciled"
          ? "RECONCILED" : paid.reconciliation_status === "pending"
            ? "PENDING" : "UNKNOWN",
        fundingModel: paid.funding_model === "COST_PER_CLICK"
          ? "COST_PER_CLICK" : "COST_PER_SALE",
        campaignStatus: text(paid.campaign_status, 40),
        campaignId: text(paid.campaign_id, 100) || null,
        adGroupId: text(paid.ad_group_id, 100) || null,
        impressions: numeric(paid.impressions),
        clicks: numeric(paid.clicks),
        ctrPercent: numeric(paid.ctr),
        attributedSales: numeric(paid.attributed_sales),
        salesConversionRatePercent: numeric(paid.sales_conversion_rate),
        adFees: numeric(paid.ad_fees),
        costPerClick: numeric(paid.cost_per_click),
        roas: numeric(paid.roas),
      } : null,
    },
    baseline: null,
    evidence: {
      level: input.confirmedUnits > 0 ? "E3" : "E2",
      confidence: complete && officialMatched ? 1 : 0.5,
      fresh: complete,
      complete,
      salesClassification: input.confirmedUnits > 0
        ? "SOLD_CONFIRMED" : "INSUFFICIENT_EVIDENCE",
      confirmedUnitsSold: input.confirmedUnits,
      profitableConfirmedUnits: 0,
      sourceRefs: [
        `listing-commercial-snapshot:${text(row.id, 100)}`,
        ...(input.confirmedUnits > 0
          ? [`official-orders:${listingId}`] : []),
      ],
    },
    economics: {
      source: "EBAY_UNIT_ECONOMICS_V1",
      policyVersion: text(economics.policyVersion, 100) ||
        "UNAVAILABLE",
      calculationHash: text(economics.calculationHash, 64) ||
        hash([row.supplier_cost, row.estimated_margin_percent]),
      costsComplete: economics.costsComplete === true,
      currentPrice: numeric(economics.currentPrice),
      landedPrice: numeric(economics.landedPrice),
      safeFloor: numeric(economics.safeFloor),
      currentContribution: numeric(economics.currentContribution),
      currentMarginPercent: margin,
      currentRoiPercent: numeric(economics.currentRoiPercent),
      stockAvailable: stock,
      stockFresh: source.stockEvidenceFresh === true,
      costObservedAt: iso(source.costObservedAt),
      paidAdFeesIncluded: economics.paidAdFeesIncluded === true,
      returnReserveIncluded: economics.returnReserveIncluded === true,
      priceTestScenario: null,
    },
    promotionEligibility: null,
    interestedBuyerEligibility: {
      status: "UNAVAILABLE",
      source: "UNAVAILABLE",
      capturedAt: null,
      negotiationImplemented: false,
    },
    comparables: [],
    history: {
      completedActionLevels: [],
      activeExperiment: false,
      experimentCount: 0,
      lastExperimentAt: null,
      previousMainImageHash: null,
      previousTitleHash: null,
    },
  }
}

export async function runPersistedEbayListingRecoveryShadow(input: {
  supabase: SupabaseClient
  marketplaceAccountKey: string
  marketplace: string
  workerId?: string
  triggerSource: "schedule" | "manual_shadow"
  limit?: number
}) {
  const workerId = input.workerId ??
    `listing-recovery:${randomUUID()}`
  const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 25), 100))
  const { data: claimed, error: claimError } = await input.supabase.rpc(
    "start_ebay_listing_recovery_shadow_run_v1",
    {
      p_marketplace_account_key: input.marketplaceAccountKey,
      p_marketplace: input.marketplace,
      p_trigger_source: input.triggerSource,
      p_worker_id: workerId,
      p_limit: limit,
      p_lease_seconds: 240,
    },
  )
  if (claimError) throw new Error("EBAY_LISTING_RECOVERY_RUN_CLAIM_FAILED")
  const run = first(claimed as JsonRecord | JsonRecord[] | null)
  if (!run) return {
    status: "DISABLED_OR_ALREADY_RUNNING",
    diagnosed: 0,
    quarantined: 0,
    safety: { ebayWrites: 0, openAiCalls: 0, whatsappMessages: 0 },
  }
  const runId = text(run.id, 80)
  const { data: snapshots, error: snapshotError } = await input.supabase
    .from("listing_commercial_snapshots")
    .select("id,marketplace_account_key,marketplace,listing_id,sku,listing_status,impressions,search_impressions,store_impressions,views,search_views,direct_views,external_views,other_ebay_views,store_views,ctr,transactions,sales_conversion_rate,stock_available,supplier_cost,estimated_margin_percent,observed_at,window_start,window_end,source,completeness_status,analytics_last_updated_at,analytics_timezone,analytics_reconciliation_status,analytics_scope")
    .eq("marketplace_account_key", input.marketplaceAccountKey)
    .eq("marketplace", input.marketplace)
    .order("observed_at", { ascending: false })
    .limit(Math.max(limit * 5, limit))
  if (snapshotError) throw new Error("EBAY_LISTING_RECOVERY_SNAPSHOT_READ_FAILED")

  const latest = new Map<string, JsonRecord>()
  for (const row of snapshots ?? []) {
    if (!latest.has(row.listing_id)) latest.set(row.listing_id, row)
    if (latest.size >= limit) break
  }
  const listingIds = [...latest.keys()]
  const [orders, marketing] = await Promise.all([
    listingIds.length
      ? input.supabase.from("marketplace_order_line_items")
          .select("listing_id,quantity")
          .eq("marketplace_account_key", input.marketplaceAccountKey)
          .in("listing_id", listingIds)
      : Promise.resolve({ data: [], error: null }),
    listingIds.length
      ? input.supabase.from("ebay_listing_marketing_snapshots")
          .select("*")
          .eq("marketplace_account_key", input.marketplaceAccountKey)
          .eq("marketplace", input.marketplace)
          .in("listing_id", listingIds)
          .order("captured_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ])
  if (orders.error || marketing.error) {
    throw new Error("EBAY_LISTING_RECOVERY_SUPPORTING_EVIDENCE_READ_FAILED")
  }
  const units = new Map<string, number>()
  for (const row of orders.data ?? []) {
    units.set(row.listing_id,
      (units.get(row.listing_id) ?? 0) + (numeric(row.quantity) ?? 0))
  }
  const paid = new Map<string, JsonRecord>()
  for (const row of marketing.data ?? []) {
    if (!paid.has(row.listing_id)) paid.set(row.listing_id, row)
  }

  let diagnosed = 0
  let quarantined = 0
  for (const row of latest.values()) {
    try {
      const recoveryInput = recoveryInputFromSnapshot({
        row,
        confirmedUnits: units.get(text(row.listing_id, 30)) ?? 0,
        paid: paid.get(text(row.listing_id, 30)) ?? null,
      })
      const output = diagnoseListingRecovery(recoveryInput)
      const { error } = await input.supabase.rpc(
        "record_ebay_listing_recovery_shadow_result_v1",
        {
          p_run_id: runId,
          p_worker_id: workerId,
          p_listing_commercial_snapshot_id: text(row.id, 80),
          p_listing_id: recoveryInput.listingId,
          p_sku: recoveryInput.sku,
          p_state: output.state,
          p_diagnosis: output.diagnosis,
          p_action_level: output.actionLevel,
          p_action: output.action,
          p_evidence_hash: hash(recoveryInput.evidence),
          p_output_hash: hash(output),
          p_output: output,
        },
      )
      if (error) throw new Error("RECOVERY_RESULT_PERSIST_FAILED")
      diagnosed += 1
    } catch {
      quarantined += 1
      await input.supabase.rpc(
        "record_ebay_listing_recovery_shadow_error_v1",
        {
          p_run_id: runId,
          p_worker_id: workerId,
          p_listing_id: text(row.listing_id, 30),
          p_sku: text(row.sku, 100) || null,
          p_error_code: "RECOVERY_DIAGNOSIS_UNKNOWN_ERROR",
        },
      )
    }
  }
  const { error: finishError } = await input.supabase.rpc(
    "finish_ebay_listing_recovery_shadow_run_v1",
    {
      p_run_id: runId,
      p_worker_id: workerId,
      p_status: quarantined > 0
        ? "COMPLETED_WITH_QUARANTINE" : "COMPLETED",
      p_selected_count: latest.size,
      p_diagnosed_count: diagnosed,
      p_quarantined_count: quarantined,
    },
  )
  if (finishError) throw new Error("EBAY_LISTING_RECOVERY_RUN_FINISH_FAILED")
  return {
    status: quarantined > 0
      ? "COMPLETED_WITH_QUARANTINE" : "COMPLETED",
    runId,
    selected: latest.size,
    diagnosed,
    quarantined,
    safety: { ebayWrites: 0, openAiCalls: 0, whatsappMessages: 0 },
  }
}
