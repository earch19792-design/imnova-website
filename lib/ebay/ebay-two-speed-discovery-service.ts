import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { LunaOpportunityCandidateInput } from "./ebay-luna-opportunity-types"
import { discoverEbayListingSignals, type EbayListingDiscoverySignals } from "./ebay-seller-keyword-demand-gateway"
import {
  buildEbayFamilyFingerprint,
  evaluateLocalDiscoveryGates,
} from "./ebay-two-speed-discovery-domain"
import {
  assertEbayLaneAvailable,
  recordPersistentEbayRateLimit,
} from "./ebay-persistent-quota-coordinator"

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function number(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function queryFingerprint(candidate: LunaOpportunityCandidateInput) {
  const identity = [
    candidate.gtin || candidate.upc || candidate.barcode,
    candidate.brand,
    candidate.mpn,
    candidate.productName || candidate.title,
    candidate.variantTitle,
    candidate.size,
    candidate.packQuantity,
  ].map((entry) => text(String(entry ?? "")).toLowerCase()).join("|")
  return createHash("sha256").update(identity).digest("hex")
}

function familyFingerprint(candidate: LunaOpportunityCandidateInput) {
  return buildEbayFamilyFingerprint({
    brand: candidate.brand || candidate.vendor,
    productLine: candidate.productType,
    mpn: candidate.mpn,
    normalizedName: candidate.productName || candidate.title,
    baseVariant: candidate.variantTitle,
    categoryId: candidate.categoryId,
    unitSize: candidate.size,
    packCount: number(candidate.packQuantity),
  })
}

export async function runLightweightFamilyDiscovery(
  supabase: SupabaseClient,
  candidate: LunaOpportunityCandidateInput,
  now = new Date(),
) {
  const local = evaluateLocalDiscoveryGates({
    available: candidate.available,
    supplierCost: number(candidate.supplierCost ?? candidate.price),
    supplierSku: candidate.sku,
    identityConfidence: [candidate.gtin || candidate.upc || candidate.barcode, candidate.brand, candidate.mpn]
      .filter(Boolean).length >= 2 ? 90 : candidate.brand ? 55 : 25,
    regulatedWithoutPath: (candidate.restrictionGuards ?? []).some((guard) =>
      /REGULAT|HAZMAT|RESTRICT/i.test(guard)),
    optimisticMarginPercent: null,
    lunaObservedAt: candidate.stockCapturedAt,
    now,
  })
  const family = familyFingerprint(candidate)
  const query = queryFingerprint(candidate)
  if (!local.eligible) return {
    stage: "LOCAL_FILTERED" as const,
    familyFingerprint: family,
    queryFingerprint: query,
    local,
    signals: null,
    cacheHit: false,
    promoteToDeep: false,
    sourceCallCount: 0,
  }

  const lane = await assertEbayLaneAvailable(supabase, "BROWSE", "LIGHTWEIGHT_DISCOVERY", now)
  if (!lane.available) return {
    stage: "QUOTA_PAUSED" as const,
    familyFingerprint: family,
    queryFingerprint: query,
    local,
    signals: null,
    cacheHit: false,
    promoteToDeep: false,
    sourceCallCount: 0,
    quota: lane,
  }
  const { data: cached, error: cacheError } = await supabase
    .from("ebay_discovery_family_cache")
    .select("aggregate_signals,observed_at,expires_at")
    .eq("family_fingerprint", family)
    .eq("query_fingerprint", query)
    .gt("expires_at", now.toISOString())
    .order("observed_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (cacheError) throw new Error("EBAY_DISCOVERY_CACHE_READ_FAILED")
  let signals = cached?.aggregate_signals as EbayListingDiscoverySignals | undefined
  if (!signals) {
    try {
      signals = await discoverEbayListingSignals({
      productName: candidate.productName || candidate.title,
      productTitle: candidate.title,
      variantTitle: candidate.variantTitle,
      supplierSku: candidate.sku,
      categoryId: candidate.categoryId,
      gtin: candidate.gtin || candidate.upc || candidate.barcode,
      brand: candidate.brand || candidate.vendor,
      mpn: candidate.mpn,
      color: candidate.color,
      size: candidate.size,
      packQuantity: number(candidate.packQuantity),
      productType: candidate.productType,
        description: candidate.description,
      })
    } catch (error) {
      const persisted = await recordPersistentEbayRateLimit(supabase, {
        error,
        apiFamily: "BROWSE",
        endpoint: "BUY_BROWSE_ITEM_SUMMARY_SEARCH",
        operation: "LIGHTWEIGHT_DISCOVERY",
        lane: "P2_DISCOVERY",
        checkpoint: { familyFingerprint: family, queryFingerprint: query },
      })
      if (persisted && error && typeof error === "object") {
        Object.assign(error, {
          quotaPersisted: true,
          quotaResumeAt: persisted.resumeAt,
          quotaApiFamily: "BROWSE",
          quotaOperation: "LIGHTWEIGHT_DISCOVERY",
          quotaLane: "P2_DISCOVERY",
        })
      }
      throw error
    }
  }
  if (!cached) {
    const expiresAt = new Date(now.getTime() + 48 * 60 * 60_000).toISOString()
    const { error } = await supabase.from("ebay_discovery_family_cache").insert({
      family_fingerprint: family,
      query_fingerprint: query,
      query_strategy: candidate.gtin || candidate.upc || candidate.barcode
        ? "GTIN" : candidate.brand && candidate.mpn ? "BRAND_MPN" : "NORMALIZED_IDENTITY",
      category_id: signals.categoryId,
      result_count: signals.candidateFoundCount,
      minimum_landed_price: signals.landedPriceRange?.minimum ?? null,
      maximum_landed_price: signals.landedPriceRange?.maximum ?? null,
      seller_count: signals.sellerCount,
      exact_compatible_signal_count: signals.identitySignalScore >= 85 ? 1 : 0,
      aggregate_signals: signals,
      source_call_count: 1,
      observed_at: signals.observedAt,
      expires_at: expiresAt,
    })
    if (error) throw new Error("EBAY_DISCOVERY_CACHE_WRITE_FAILED")
  }
  const cost = number(candidate.supplierCost ?? candidate.price)
  const minimum = signals.landedPriceRange?.minimum ?? null
  const plausibleEconomics = cost !== null && minimum !== null && minimum >= cost * 1.25
  const promoteToDeep = signals.returnedCandidateCount > 0 &&
    signals.identitySignalScore >= 65 && plausibleEconomics
  return {
    stage: promoteToDeep ? "PROMOTED_TO_DEEP" as const : "LIGHTWEIGHT_COMPLETE" as const,
    familyFingerprint: family,
    queryFingerprint: query,
    local,
    signals,
    cacheHit: Boolean(cached),
    promoteToDeep,
    sourceCallCount: cached ? 0 : 1,
  }
}
