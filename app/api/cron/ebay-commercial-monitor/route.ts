export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"

import {
  getCommercialMonitorScheduleConfiguration,
  getDueCommercialMonitorLanes,
  runEbayCommercialMonitor,
} from "@/lib/ebay/ebay-commercial-monitor-service"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { commercialPreviewCronAuthorized } from "@/lib/ebay/ebay-commercial-preview-pilot"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { readManualListingFromTradingApi } from
  "@/lib/ebay/ebay-manual-listing-trading-readonly"
import { readEbaySellerStoreSubscriptionReadonly } from
  "@/lib/ebay/ebay-account-policy-readonly-gateway"
import {
  readEbayPromotionStateReadonlyV1,
  type EbayPromotionStateReadonlyV1,
} from "@/lib/ebay/ebay-marketing-promotion-readonly-v1"
import {
  buildLiveListingPreSaleEconomicsV1,
  resolveOfficialPreSaleFeePolicyV1,
} from "@/lib/ebay/ebay-live-presale-economics-v1"
import { loadEbayPromotionRecommendationSafeExecutionV1 } from
  "@/lib/ebay/ebay-promotion-recommendation-safe-execution-v1"

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function safeText(value: unknown, maximum = 200) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : ""
}

function safeCode(error: unknown) {
  const value = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(value) ? value : "COMMERCIAL_MONITOR_CRON_FAILED"
}

export async function GET(req: Request) {
  if (!commercialPreviewCronAuthorized(req)) return NextResponse.json(
    { success: false, error: "CRON_UNAUTHORIZED" },
    { status: 401 },
  )
  const promotionRecommendationItemId = new URL(req.url).searchParams.get(
    "promotionRecommendationItemId",
  )?.trim() ?? ""
  if (promotionRecommendationItemId) {
    if (!/^\d{9,20}$/.test(promotionRecommendationItemId)) {
      return NextResponse.json({ success: false,
        error: "PROMOTION_RECOMMENDATION_ITEM_ID_INVALID",
        marketplaceWrites: 0 }, { status: 400 })
    }
    try {
      const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
      if (!accountKey) throw new Error("COMMERCIAL_MONITOR_ACCOUNT_SCOPE_REQUIRED")
      const result = await loadEbayPromotionRecommendationSafeExecutionV1({
        supabase: getSupabaseAdminClient(), accountKey,
        ebayItemId: promotionRecommendationItemId,
      })
      return NextResponse.json({ success: true,
        status: "promotion_recommendation_readonly_completed",
        promotionRecommendation: result,
        safety: { analyticsRequests: 0, lunaRequests: 0,
          promotionWrites: 0, priceChanges: 0, marketplaceWrites: 0,
          databaseWrites: 0 } },
      { headers: { "Cache-Control": "private, no-store",
        "X-Seller-OS-Promotion-Recommendation": "READ_ONLY" } })
    } catch (error) {
      return NextResponse.json({ success: false, error: safeCode(error),
        safety: { analyticsRequests: 0, lunaRequests: 0,
          promotionWrites: 0, priceChanges: 0, marketplaceWrites: 0,
          databaseWrites: 0 } }, { status: 502 })
    }
  }
  const feeAuthorityItemId = new URL(req.url).searchParams.get(
    "feeAuthorityItemId",
  )?.trim() ?? ""
  if (feeAuthorityItemId) {
    if (!/^\d{9,20}$/.test(feeAuthorityItemId)) {
      return NextResponse.json({
        success: false,
        error: "EBAY_FEE_AUTHORITY_ITEM_ID_INVALID",
        marketplaceWrites: 0,
      }, { status: 400 })
    }
    try {
      const [listing, subscription] = await Promise.all([
        readManualListingFromTradingApi(feeAuthorityItemId),
        readEbaySellerStoreSubscriptionReadonly(),
      ])
      let promotion: EbayPromotionStateReadonlyV1
      try {
        promotion = await readEbayPromotionStateReadonlyV1(feeAuthorityItemId)
      } catch (error) {
        promotion = {
          status: "UNPROVEN",
          promotionState: "UNPROVEN",
          promotionType: "UNPROVEN",
          adRatePercent: null,
          promotionFeeBasis: "UNPROVEN",
          priceDiscountState: "SEPARATE_NOT_EVALUATED",
          authority: "EBAY_MARKETING_FIND_CAMPAIGN_AND_AD_READONLY",
          limitationCode: safeCode(error),
          observedAt: new Date().toISOString(),
          marketplaceId: "EBAY_US",
        }
      }
      const categoryId = listing.safeDefaults.categoryId ?? ""
      const feePolicy = resolveOfficialPreSaleFeePolicyV1({
        categoryId,
        storeSubscriptionLevel: subscription.storeSubscriptionLevel ?? "",
        orderSubtotalUsd: listing.price ?? 0,
      })
      const experimentId = new URL(req.url).searchParams.get(
        "economicsExperimentId",
      )?.trim() ?? ""
      let economics: ReturnType<typeof buildLiveListingPreSaleEconomicsV1> | null = null
      let durableReadback = false
      let databaseWrites = 0
      if (experimentId) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          experimentId,
        )) throw new Error("PRE_SALE_ECONOMICS_EXPERIMENT_ID_INVALID")
        const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
        if (!accountKey) throw new Error("COMMERCIAL_MONITOR_ACCOUNT_SCOPE_REQUIRED")
        const supabase = getSupabaseAdminClient()
        const [{ data: experiment, error: experimentError },
          { data: shipping, error: shippingError }] = await Promise.all([
          supabase.from("ebay_listing_experiments_v1")
            .select("experiment_id,ebay_item_id,lifecycle_status,baseline_evidence_ref")
            .eq("account_key", accountKey).eq("marketplace", "EBAY_US")
            .eq("experiment_id", experimentId).maybeSingle(),
          supabase.from("seller_os_live_listing_shipping_evidence")
            .select("evidence_id,ebay_item_id,luna_product_id,luna_variant_id,source_sku,supplier_subtotal,supplier_currency,shipping_cost,shipping_currency,observed_at,maximum_age_seconds,source_authority,source_evidence_digest,raw_address_persisted,purchase_performed,payment_performed")
            .eq("account_key", accountKey).eq("marketplace_id", "EBAY_US")
            .eq("ebay_item_id", feeAuthorityItemId)
            .order("observed_at", { ascending: false }).limit(1).maybeSingle(),
        ])
        if (experimentError || !experiment) {
          throw new Error("PRE_SALE_ECONOMICS_EXACT_EXPERIMENT_REQUIRED")
        }
        if (shippingError || !shipping) {
          throw new Error("PRE_SALE_ECONOMICS_SHIPPING_EVIDENCE_REQUIRED")
        }
        const baseline = record(experiment.baseline_evidence_ref)
        const visual = record(baseline.sellerOsVisualVariant)
        const exactLineage = experiment.ebay_item_id === feeAuthorityItemId &&
          safeText(visual.ebayItemId, 20) === feeAuthorityItemId &&
          safeText(visual.lunaProductId, 24) === shipping.luna_product_id &&
          safeText(visual.lunaVariantId, 24) === shipping.luna_variant_id &&
          safeText(visual.lunaSku, 160) === shipping.source_sku &&
          shipping.ebay_item_id === feeAuthorityItemId &&
          shipping.supplier_currency === "USD" &&
          shipping.shipping_currency === "USD" &&
          shipping.raw_address_persisted === false &&
          shipping.purchase_performed === false &&
          shipping.payment_performed === false
        if (!exactLineage) {
          throw new Error("PRE_SALE_ECONOMICS_EXACT_LINEAGE_MISMATCH")
        }
        if (
          listing.ownership !== "verified" ||
          listing.currency !== "USD" ||
          listing.price === null ||
          feePolicy.status !== "AVAILABLE"
        ) throw new Error("PRE_SALE_ECONOMICS_OFFICIAL_INPUT_UNPROVEN")
        economics = buildLiveListingPreSaleEconomicsV1({
          ebayItemId: feeAuthorityItemId,
          marketplaceId: "EBAY_US",
          categoryId,
          storeSubscriptionLevel: subscription.storeSubscriptionLevel ?? "",
          livePriceUsd: listing.price,
          supplierCostUsd: Number(shipping.supplier_subtotal),
          supplierShippingUsd: Number(shipping.shipping_cost),
          buyerShippingChargeUsd: listing.buyerShippingCharge,
          buyerShippingChargeStatus: listing.buyerShippingChargeStatus,
          baseFinalValueFeeRatePercent: feePolicy.finalValueFeeRatePercent,
          perOrderFixedFeeUsd: feePolicy.perOrderFixedFeeUsd,
          promotion,
          observedAt: new Date().toISOString(),
        })
        const evidence = {
          ...economics,
          identity: {
            experimentId,
            ebayItemId: feeAuthorityItemId,
            lunaProductId: shipping.luna_product_id,
            lunaVariantId: shipping.luna_variant_id,
            sourceSku: shipping.source_sku,
          },
          sourceEvidence: {
            listing: `EBAY_TRADING_GET_ITEM_READONLY:${feeAuthorityItemId}`,
            shipping: shipping.evidence_id,
            promotion: promotion.authority,
            accountSubscription: "EBAY_ACCOUNT_GET_SUBSCRIPTION_READONLY",
          },
          shippingEvidenceFreshness: Number.isFinite(Date.parse(shipping.observed_at))
            ? Date.now() - Date.parse(shipping.observed_at) <=
              Number(shipping.maximum_age_seconds) * 1_000
              ? "FRESH"
              : "STALE"
            : "UNPROVEN",
          safety: {
            analyticsRequests: 0,
            lunaRequests: 0,
            marketplaceWrites: 0,
            realizedFeeClaimed: false,
          },
        }
        const { error: updateError } = await supabase
          .from("ebay_listing_experiments_v1")
          .update({ baseline_evidence_ref: {
            ...baseline,
            sellerOsPreSaleEconomicsEvidence: evidence,
          } })
          .eq("account_key", accountKey).eq("marketplace", "EBAY_US")
          .eq("experiment_id", experimentId)
          .eq("ebay_item_id", feeAuthorityItemId)
          .eq("lifecycle_status", experiment.lifecycle_status)
        if (updateError) throw new Error("PRE_SALE_ECONOMICS_PERSIST_FAILED")
        databaseWrites = 1
        const { data: readback, error: readbackError } = await supabase
          .from("ebay_listing_experiments_v1")
          .select("baseline_evidence_ref")
          .eq("account_key", accountKey).eq("marketplace", "EBAY_US")
          .eq("experiment_id", experimentId).single()
        const persisted = record(record(readback?.baseline_evidence_ref)
          .sellerOsPreSaleEconomicsEvidence)
        durableReadback = !readbackError &&
          persisted.contractVersion === economics.contractVersion &&
          persisted.ebayItemId === feeAuthorityItemId &&
          persisted.feeEvidenceClass ===
            "PROVEN_RATE_PRE_SALE_FEE_MODEL"
        if (!durableReadback) {
          throw new Error("PRE_SALE_ECONOMICS_DURABLE_READBACK_MISMATCH")
        }
      }
      return NextResponse.json({
        success: true,
        status: "fee_authority_readonly_completed",
        item: {
          itemId: listing.itemId,
          ownership: listing.ownership,
          listingStatus: listing.listingStatus,
          categoryId: categoryId || null,
          marketplaceId: "EBAY_US",
          livePrice: listing.price,
          currency: listing.currency,
          buyerShippingCharge: listing.buyerShippingCharge,
          buyerShippingCurrency: listing.buyerShippingCurrency,
          buyerShippingChargeStatus: listing.buyerShippingChargeStatus,
          buyerShippingChargeBasis: listing.buyerShippingChargeBasis,
        },
        accountFeeContext: subscription,
        officialFeePolicy: feePolicy,
        promotion,
        economics,
        durableReadback,
        authority: {
          category: "EBAY_TRADING_GET_ITEM_READONLY",
          storeSubscription: "EBAY_ACCOUNT_GET_SUBSCRIPTION_READONLY",
          buyerShipping: "EBAY_TRADING_GET_ITEM_READONLY",
          promotion: "EBAY_MARKETING_FIND_CAMPAIGN_AND_AD_READONLY",
        },
        safety: {
          analyticsRequests: 0,
          lunaRequests: 0,
          marketplaceWrites: 0,
          databaseWrites,
        },
      })
    } catch (error) {
      return NextResponse.json({
        success: false,
        error: safeCode(error),
        safety: {
          analyticsRequests: 0,
          lunaRequests: 0,
          marketplaceWrites: 0,
          databaseWrites: 0,
        },
      }, { status: 502 })
    }
  }
  const schedule = getCommercialMonitorScheduleConfiguration()
  if (process.env.VERCEL_ENV !== "preview" || !schedule.enabled) {
    return NextResponse.json({
      success: true,
      status: "disabled",
      schedule,
      safety: {
        previewOnly: true,
        productionUnchanged: true,
        ebayWriteUsed: false,
      },
    })
  }
  try {
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    if (!accountKey) throw new Error("COMMERCIAL_MONITOR_ACCOUNT_SCOPE_REQUIRED")
    const supabase = getSupabaseAdminClient()
    const lanes = await getDueCommercialMonitorLanes(supabase, accountKey)
    const run = await runEbayCommercialMonitor(supabase, {
      triggerSource: "schedule",
      lanes,
      workerId: `commercial-schedule:${randomUUID()}`,
      dispatchWhatsApp: false,
      dryRunWhatsApp: true,
    })
    return NextResponse.json({ success: true, schedule, lanes, run })
  } catch (error) {
    const code = safeCode(error)
    return NextResponse.json(
      {
        success: false,
        error: code,
        schedule,
        safety: code === "COMMERCIAL_MONITOR_SCHEDULER_GATE_REQUIRED"
          ? {
              externalReadersStarted: false,
              productionUnchanged: true,
              ebayWriteUsed: false,
            }
          : {
              productionUnchanged: true,
              ebayWriteUsed: false,
            },
      },
      { status: code === "COMMERCIAL_MONITOR_SCHEDULER_GATE_REQUIRED" ? 423 : 502 },
    )
  }
}
