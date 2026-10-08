import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import { buildLunaPortexAmazonCatalogMatch } from
  "./luna-portex-amazon-catalog-matcher"
import { createAmazonSpApiReadOnlyClientV1,
  getAmazonSpApiReadOnlyConfigurationV1,
  readAmazonCatalogDemandSignalsV1, readAmazonCompetitiveSummariesV1,
  readAmazonFeeEstimatesV1, readAmazonListingRestrictionsV1,
  searchAmazonCatalogItemsV1, type AmazonSpApiReadOnlyClientV1 } from
  "./amazon-sp-api-readonly-v1"
import { getKeepaMarketDemandConfigurationV1, readKeepaMarketDemandV1 } from
  "./keepa-market-demand-readonly-v1"
import { calculateSellerOsPolicyLimitsV2,
  evaluateSellerOsRoiMarginPolicyV2,
  sellerOsRoiMarginPolicyContractV2 } from
  "./seller-os-roi-margin-policy-v2"

export const SELLER_OS_AMAZON_WHOLESALE_OPPORTUNITY_SCOUT_V1 =
  "SELLER_OS_AMAZON_WHOLESALE_OPPORTUNITY_SCOUT_V1" as const

type Json = Record<string, unknown>

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Json : {}
}

function text(value: unknown, maximum = 500) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ")
  return normalized && !/[\p{Cc}\p{Cf}]/u.test(normalized)
    ? normalized.slice(0, maximum) : null
}

function amount(value: unknown) {
  const parsed = typeof value === "number" ? value
    : typeof value === "string" && value.trim() ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0
    ? Number(parsed.toFixed(2)) : null
}

function integer(value: unknown) {
  const parsed = amount(value)
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value))
    .digest("hex")}`
}

function words(value: string) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((part) =>
    part.length >= 3 && !["and", "for", "the", "with", "from", "pack"]
      .includes(part))
}

function catalogKeywords(title: string) {
  return words(title).slice(0, 8).join(" ") || title.slice(0, 200)
}

async function boundedMap<T, R>(values: readonly T[], concurrency: number,
  mapper: (value: T, index: number) => Promise<R>) {
  const output = new Array<R>(values.length)
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) },
    async () => {
      while (next < values.length) {
        const index = next
        next += 1
        output[index] = await mapper(values[index]!, index)
      }
    })
  await Promise.all(workers)
  return output
}

type SupplierSeedV1 = Readonly<{
  sourceKey: string
  sourceName: string
  sourceBaseUrl: string | null
  sourcePriority: "FLORIDA" | "OTHER_US" | "UNPROVEN"
  sourceLocationAuthority: string
  productId: string
  variantId: string
  sku: string
  title: string
  brand: string | null
  category: string | null
  barcode: string | null
  unitCostUsd: number
  available: boolean
  availableQuantity: number | null
  minimumOrderQuantity: number | null
  productUrl: string | null
  capturedAt: string
}>

async function readSupplierSeedsV1(input: { supabase: SupabaseClient;
  query?: string | null; maximum: number }) {
  const sources = await input.supabase.from("market_radar_sources")
    .select("id,key,name,base_url,is_active,sourcing_metadata")
    .eq("is_active", true).limit(50)
  if (sources.error) throw new Error("AMAZON_SCOUT_SUPPLIER_SOURCES_FAILED")
  const activeSources = (sources.data ?? []).filter((row) =>
    row.key !== "staging-demo")
  const sourceIds = activeSources.map((row) => row.id)
  if (!sourceIds.length) return []
  const products = await input.supabase.from("market_radar_products")
    .select("id,source_id,supplier_product_id,title,vendor,product_type,product_url,last_snapshot_at,metadata")
    .in("source_id", sourceIds).order("last_snapshot_at", { ascending: false })
    .limit(Math.min(400, Math.max(80, input.maximum * 20)))
  if (products.error) throw new Error("AMAZON_SCOUT_SUPPLIER_PRODUCTS_FAILED")
  const queryWords = words(input.query ?? "")
  const productRows = (products.data ?? []).filter((row) => {
    if (!queryWords.length) return true
    const haystack = `${row.title ?? ""} ${row.vendor ?? ""} ` +
      `${row.product_type ?? ""}`.toLowerCase()
    return queryWords.every((part) => haystack.includes(part))
  }).slice(0, Math.min(200, Math.max(40, input.maximum * 10)))
  if (!productRows.length) return []
  const productIds = productRows.map((row) => row.id)
  const idChunks = Array.from({ length: Math.ceil(productIds.length / 50) },
    (_, index) => productIds.slice(index * 50, index * 50 + 50))
  const snapshotReads = await boundedMap(idChunks, 2, async (ids) =>
    await input.supabase.from("market_radar_snapshots")
      .select("product_id,supplier_variant_id,variant_title,sku,barcode,price,available,inventory_quantity,raw,captured_at")
      .in("product_id", ids).order("captured_at", { ascending: false })
      .limit(1_000))
  if (snapshotReads.some((read) => read.error)) {
    throw new Error("AMAZON_SCOUT_SUPPLIER_QUOTES_FAILED")
  }
  const snapshots = snapshotReads.flatMap((read) => read.data ?? [])
  const latest = new Map<string, Json>()
  for (const row of snapshots) {
    if (!latest.has(String(row.product_id))) latest.set(String(row.product_id),
      row as Json)
  }
  const sourceById = new Map(activeSources.map((row) => [row.id, row]))
  return productRows.flatMap((product): SupplierSeedV1[] => {
    const snapshot = latest.get(String(product.id))
    const source = sourceById.get(product.source_id)
    const unitCostUsd = amount(snapshot?.price)
    const title = text(product.title)
    const variantId = text(snapshot?.supplier_variant_id, 240)
    const sku = text(snapshot?.sku, 240)
    if (!snapshot || !source || !title || !variantId || !sku ||
        unitCostUsd === null || unitCostUsd <= 0 || snapshot.available !== true) {
      return []
    }
    const rawProduct = record(record(snapshot.raw).product)
    const sourcePriority = source.key === "lunaportex"
      ? "FLORIDA" as const : String(record(source.sourcing_metadata).state ?? "")
          .toUpperCase() === "FL"
        ? "FLORIDA" as const : "UNPROVEN" as const
    return [Object.freeze({ sourceKey: source.key,
      sourceName: source.name, sourceBaseUrl: text(source.base_url, 2_000),
      sourcePriority,
      sourceLocationAuthority: source.key === "lunaportex"
        ? "LUNA_PORTEX_BOCA_RATON_SAFE_WAREHOUSE_ALIAS"
        : sourcePriority === "FLORIDA" ? "SOURCE_REGISTRY_METADATA"
          : "LOCATION_UNPROVEN",
      productId: String(product.supplier_product_id), variantId, sku, title,
      brand: text(product.vendor, 160),
      category: text(product.product_type, 160),
      barcode: text(snapshot.barcode, 40), unitCostUsd,
      available: true, availableQuantity: integer(snapshot.inventory_quantity),
      minimumOrderQuantity: integer(record(snapshot.raw).minimumOrderQuantity),
      productUrl: text(product.product_url, 2_000),
      capturedAt: String(snapshot.captured_at),
    })]
  }).sort((left, right) =>
    Number(right.sourcePriority === "FLORIDA") -
      Number(left.sourcePriority === "FLORIDA") ||
    Number(Boolean(right.barcode)) - Number(Boolean(left.barcode)) ||
    Date.parse(right.capturedAt) - Date.parse(left.capturedAt))
}

export function assertAmazonWholesaleScoutLimitV1(value: unknown) {
  const parsed = value === undefined ? 10 : Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
    throw new Error("AMAZON_WHOLESALE_SCOUT_LIMIT_INVALID")
  }
  return parsed
}

function ownSalesScenarios(monthlyMarketUnits: number | null) {
  if (monthlyMarketUnits === null) return Object.freeze({
    status: "UNPROVEN" as const, marketUnitsPerMonth: null,
    ownUnitsLow: null, ownUnitsBase: null, ownUnitsHigh: null,
    model: "MARKET_DEMAND_IS_NOT_OWN_SALES" as const,
  })
  return Object.freeze({ status: "SCENARIO_NOT_FORECAST" as const,
    marketUnitsPerMonth: monthlyMarketUnits,
    ownUnitsLow: Math.max(0, Math.floor(monthlyMarketUnits * 0.005)),
    ownUnitsBase: Math.max(0, Math.floor(monthlyMarketUnits * 0.01)),
    ownUnitsHigh: Math.max(0, Math.floor(monthlyMarketUnits * 0.02)),
    model: "MARKET_UNITS_X_EXPLICIT_0_5_1_2_PERCENT_CAPTURE" as const,
  })
}

export async function scoutAmazonWholesaleOpportunitiesV1(input: {
  supabase: SupabaseClient
  limit?: number
  query?: string | null
  environment?: NodeJS.ProcessEnv
  amazonClient?: AmazonSpApiReadOnlyClientV1
  now?: Date
}) {
  const limit = assertAmazonWholesaleScoutLimitV1(input.limit)
  const now = input.now ?? new Date()
  const environment = input.environment ?? process.env
  const connection = getAmazonSpApiReadOnlyConfigurationV1(environment)
  if (connection.status !== "READY") {
    return Object.freeze({
      contractVersion: SELLER_OS_AMAZON_WHOLESALE_OPPORTUNITY_SCOUT_V1,
      status: "AMAZON_AUTHORIZATION_REQUIRED" as const,
      requestedLimit: limit, returnedCount: 0, opportunities: [],
      economicPolicy: sellerOsRoiMarginPolicyContractV2(),
      connection, keepa: getKeepaMarketDemandConfigurationV1(environment),
      safety: { readOnly: true as const, amazonWrites: 0 as const,
        supplierPurchases: 0 as const, publications: 0 as const,
        repricing: 0 as const, paidServicesActivated: 0 as const },
    })
  }
  const client = input.amazonClient ?? createAmazonSpApiReadOnlyClientV1({
    environment })
  const seeds = await readSupplierSeedsV1({ supabase: input.supabase,
    query: input.query, maximum: Math.max(12, limit * 2) })
  const catalogReads = await boundedMap(seeds.slice(0, Math.max(12, limit * 2)),
    2, async (seed) => {
      try {
        const items = await searchAmazonCatalogItemsV1(client, {
          identifier: seed.barcode, keywords: seed.barcode ? null
            : catalogKeywords(seed.title), pageSize: 5 })
        const match = buildLunaPortexAmazonCatalogMatch({
          supplierSku: seed.sku, productTitle: seed.title, brand: seed.brand,
          upc: seed.barcode, productType: seed.category,
          category: seed.category,
        }, items.map((item) => ({ amazonCandidateAsin: item.asin,
          ...item })))
        return { seed, match, items }
      } catch (error) {
        return { seed, match: null, items: [], error: error instanceof Error
          ? error.message : "AMAZON_CATALOG_SEARCH_FAILED" }
      }
    })
  const matchRows = catalogReads.filter((row) => row.match?.bestMatchAsin)
    .sort((left, right) =>
      Number(right.match?.matchConfidenceScore ?? 0) -
      Number(left.match?.matchConfidenceScore ?? 0)).slice(0, limit)
  const asins = matchRows.map((row) => String(row.match!.bestMatchAsin))
  const upstreamFailures: string[] = catalogReads.some((row) => row.error)
    ? ["AMAZON_CATALOG_SEARCH_PARTIAL"] : []
  const [competitive, demand, restrictions, existing] = await Promise.all([
    readAmazonCompetitiveSummariesV1(client, asins, { now })
      .catch(() => {
        upstreamFailures.push("AMAZON_COMPETITIVE_PRICING_UNAVAILABLE")
        return new Map()
      }),
    readAmazonCatalogDemandSignalsV1(client, asins, { now })
      .catch(() => {
        upstreamFailures.push("AMAZON_CATALOG_DEMAND_UNAVAILABLE")
        return new Map()
      }),
    readAmazonListingRestrictionsV1(client, asins)
      .catch(() => {
        upstreamFailures.push("AMAZON_LISTING_RESTRICTIONS_UNAVAILABLE")
        return new Map()
      }),
    asins.length ? input.supabase
      .from("seller_os_amazon_contributor_sku_attribution_v1")
      .select("asin,seller_sku,status").in("asin", asins)
      : Promise.resolve({ data: [], error: null }),
  ])
  const feeInputs = matchRows.flatMap((row) => {
    const asin = String(row.match!.bestMatchAsin)
    const priceUsd = competitive.get(asin)?.featuredOfferPriceUsd
    return priceUsd === null || priceUsd === undefined ? [] : [{
      identifier: `scout:${row.seed.sourceKey}:${row.seed.sku}`,
      asin, priceUsd, fulfillmentChannel: "FBA" as const,
    }]
  })
  const fees = await readAmazonFeeEstimatesV1(client, feeInputs)
    .catch(() => {
      upstreamFailures.push("AMAZON_FEE_ESTIMATES_UNAVAILABLE")
      return new Map()
    })
  const keepaConfig = getKeepaMarketDemandConfigurationV1(environment)
  const keepa = keepaConfig.status === "READY"
    ? await readKeepaMarketDemandV1({ asins, environment, now })
      .catch(() => new Map()) : new Map()
  const existingAsins = new Set((existing.data ?? []).filter((row) =>
    row.status !== "RETIRED").map((row) => row.asin))
  const opportunities = matchRows.map((row, index) => {
    const asin = String(row.match!.bestMatchAsin)
    const market = competitive.get(asin)
    const fee = fees.get(`scout:${row.seed.sourceKey}:${row.seed.sku}`)
    const salePrice = market?.featuredOfferPriceUsd ?? null
    const amazonFees = fee?.status === "AVAILABLE" ? fee.totalFeesUsd : null
    const advertisingReserveUsd = salePrice === null ? null
      : Number((salePrice * 0.08).toFixed(2))
    const returnsReserveUsd = salePrice === null ? null
      : Number((salePrice * 0.04).toFixed(2))
    const policyEvaluation = evaluateSellerOsRoiMarginPolicyV2({
      revenueUsd: salePrice,
      investmentBase: "AMAZON_INVENTORY_INVESTMENT",
      investmentBaseUsd: null,
      costs: [
        { key: "supplier_unit_cost", amountUsd: row.seed.unitCostUsd,
          authority: "MARKET_RADAR_LATEST_SUPPLIER_OFFER",
          state: "ESTIMATED" },
        { key: "inbound_shipping", amountUsd: null,
          authority: "SUPPLIER_QUOTE_REQUIRED", state: "UNKNOWN" },
        { key: "prep", amountUsd: null,
          authority: "LUNA_PREP_QUOTE_REQUIRED", state: "UNKNOWN" },
        { key: "amazon_fees", amountUsd: amazonFees,
          authority: "AMAZON_PRODUCT_FEES_ESTIMATE",
          state: amazonFees === null ? "UNKNOWN" : "ESTIMATED" },
        { key: "advertising_reserve", amountUsd: advertisingReserveUsd,
          authority: "EXPLICIT_SCENARIO_RATE_8_PERCENT",
          state: advertisingReserveUsd === null ? "UNKNOWN" : "ESTIMATED" },
        { key: "returns_reserve", amountUsd: returnsReserveUsd,
          authority: "EXPLICIT_SCENARIO_RATE_4_PERCENT",
          state: returnsReserveUsd === null ? "UNKNOWN" : "ESTIMATED" },
      ],
    })
    const limits = calculateSellerOsPolicyLimitsV2({ revenueUsd: salePrice,
      purchaseCostUsd: row.seed.unitCostUsd, otherFixedCostUsd: null,
      variableCostRate: 0.12, investmentBaseAdditionalUsd: null })
    const marketDemand = keepa.get(asin)
    const ownSales = ownSalesScenarios(marketDemand?.monthlySoldEstimate ?? null)
    const prudentQuantity = ownSales.ownUnitsBase === null ||
        ownSales.ownUnitsBase < 1 ? null
      : Math.min(3, Math.max(1, Math.ceil(ownSales.ownUnitsBase / 2)),
        row.seed.availableQuantity ?? Number.POSITIVE_INFINITY)
    const restriction = restrictions.get(asin)
    const exact = ["EXACT_UPC_GTIN_MATCH", "STRONG_BRAND_MODEL_PART_MATCH",
      "STRONG_BRAND_MODEL_SIZE_MATCH"].includes(String(row.match!.matchType))
    const blockers = [...new Set([
      ...policyEvaluation.blockerCodes,
      ...(!exact ? ["EXACT_AMAZON_PRODUCT_MATCH_REQUIRES_REVIEW"] : []),
      ...(restriction?.state === "RESTRICTED"
        ? ["AMAZON_SELLING_RESTRICTED"]
        : restriction?.state !== "ELIGIBLE"
          ? ["AMAZON_ELIGIBILITY_UNPROVEN"] : []),
      ...(existingAsins.has(asin) ? ["DUPLICATE_EXISTING_ASIN"] : []),
      ...(existing.error ? ["DUPLICATE_CHECK_UNAVAILABLE"] : []),
      ...(ownSales.status === "UNPROVEN" ? ["OWN_SALES_UNPROVEN"] : []),
      ...(row.seed.availableQuantity === null
        ? ["SUPPLIER_QUANTITY_UNPROVEN"] : []),
      "FINANCING_TERMS_UNPROVEN",
      "HUMAN_AUTHORIZATION_REQUIRED",
    ])]
    const withoutDigest = {
      rank: index + 1, asin, title: row.seed.title,
      amazonTitle: text(row.match!.bestMatch?.title),
      identity: { matchType: row.match!.matchType,
        matchConfidenceScore: row.match!.matchConfidenceScore,
        exactProductMatch: exact, wrongAsinRisk: row.match!.wrongAsinRisk,
        duplicateAsinRisk: existingAsins.has(asin) ? "HIGH" :
          row.match!.duplicateAsinRisk,
        humanReviewRequired: row.match!.humanReviewRequired || !exact },
      supplier: { state: "POSSIBLE_SUPPLIER" as const,
        sourceKey: row.seed.sourceKey, name: row.seed.sourceName,
        locationPriority: row.seed.sourcePriority,
        locationAuthority: row.seed.sourceLocationAuthority,
        productId: row.seed.productId, variantId: row.seed.variantId,
        sku: row.seed.sku, productUrl: row.seed.productUrl,
        availability: row.seed.available,
        availableQuantity: row.seed.availableQuantity },
      offer: { state: "PENDING_VERIFICATION" as const,
        unitCostUsd: row.seed.unitCostUsd, capturedAt: row.seed.capturedAt,
        minimumOrderQuantity: row.seed.minimumOrderQuantity,
        moqRecommended: false as const,
        verifiedQuoteAuthority: null },
      amazon: { featuredOfferPriceUsd: salePrice,
        featuredOfferState: market?.state ?? "UNAVAILABLE",
        estimatedAmazonFeesUsd: amazonFees,
        feeAuthority: fee?.status === "AVAILABLE"
          ? "AMAZON_PRODUCT_FEES_ESTIMATE" : "UNPROVEN",
        eligibility: restriction?.state ?? "UNAVAILABLE",
        restrictionReasonCodes: restriction?.reasonCodes ?? [],
        salesRank: demand?.get?.(asin) ?? null,
        totalAsinMarketDemand: marketDemand ?? null,
        totalAsinSalesAreOwnSales: false as const },
      economics: { supplierUnitCostUsd: row.seed.unitCostUsd,
        inboundShippingPerUnitUsd: null, prepPerUnitUsd: null,
        amazonFeesPerUnitUsd: amazonFees, advertisingReserveUsd,
        returnsReserveUsd, contributionUsd: policyEvaluation.contributionUsd,
        contributionMarginPercent:
          policyEvaluation.contributionMarginPercent,
        estimatedRoiPercent: policyEvaluation.estimatedRoiPercent,
        maximumPurchasePriceUsd: limits.maximumPurchasePriceUsd,
        minimumViablePriceUsd: limits.minimumViablePriceUsd,
        investmentBase: "AMAZON_INVENTORY_INVESTMENT" as const,
        investmentPerUnitUsd: policyEvaluation.investmentBaseUsd,
        complete: policyEvaluation.evidenceComplete,
        passesPolicy: policyEvaluation.passesPolicy,
        policy: policyEvaluation.policy },
      ownSalesProbable: ownSales,
      prudentQuantity, investmentUsd: prudentQuantity === null ||
          policyEvaluation.investmentBaseUsd === null ? null
        : Number((prudentQuantity * policyEvaluation.investmentBaseUsd)
          .toFixed(2)),
      scenarios: [0.9, 1, 1.1].map((multiplier) => ({
        label: multiplier === 1 ? "CURRENT_PRICE" : multiplier < 1
          ? "PRICE_DOWN_10_PERCENT" : "PRICE_UP_10_PERCENT",
        salePriceUsd: salePrice === null ? null
          : Number((salePrice * multiplier).toFixed(2)),
        status: "STRUCTURAL_UNTIL_ALL_COSTS_ARE_KNOWN" as const,
      })),
      risks: blockers,
      recommendation: blockers.length === 1 &&
          blockers[0] === "HUMAN_AUTHORIZATION_REQUIRED"
        ? "READY_FOR_OWNER_REVIEW" as const : "CONTINUE_RESEARCH" as const,
      nextBestEvidence: blockers.includes("EXACT_AMAZON_PRODUCT_MATCH_REQUIRES_REVIEW")
        ? "VERIFY_EXACT_AMAZON_MATCH" as const
        : blockers.includes("AMAZON_ELIGIBILITY_UNPROVEN")
          ? "VERIFY_AMAZON_ELIGIBILITY" as const
          : blockers.includes("COMPLETE_COSTS_REQUIRED")
            ? "VERIFY_DELIVERED_INVENTORY_COST" as const
            : blockers.includes("OWN_SALES_UNPROVEN")
              ? "OBTAIN_AUTHORIZED_DEMAND_EVIDENCE" as const
              : "OWNER_REVIEW" as const,
      humanControl: { ownerReviewRequired: true as const,
        automaticPurchaseAllowed: false as const,
        automaticPublicationAllowed: false as const,
        automaticRepricingAllowed: false as const },
    }
    return Object.freeze({ ...withoutDigest,
      opportunityDigest: digest(withoutDigest) })
  })
  const result = {
    contractVersion: SELLER_OS_AMAZON_WHOLESALE_OPPORTUNITY_SCOUT_V1,
    status: opportunities.length ? "PARTIAL_OR_READY" as const
      : "NO_MATCHED_OPPORTUNITIES" as const,
    requestedLimit: limit, returnedCount: opportunities.length,
    query: text(input.query, 200), generatedAt: now.toISOString(),
    discovery: { asinInputRequired: false as const,
      supplierCatalogCandidatesRead: seeds.length,
      amazonCatalogSearches: catalogReads.length,
      floridaPriorityApplied: true as const,
      possibleSupplierSeparatedFromVerifiedOffer: true as const,
      upstreamFailures: [...new Set(upstreamFailures)] },
    economicPolicy: sellerOsRoiMarginPolicyContractV2(),
    keepa: { ...keepaConfig, used: keepaConfig.status === "READY",
      paidServiceActivated: false as const },
    opportunities,
    interpretation: {
      totalAsinDemandIsNotOwnSales: true as const,
      minimumOrderQuantityIsNeverDefaultRecommendation: true as const,
      unknownCostIsNeverZero: true as const,
      existingProductsReevaluatedWithoutMutations: true as const,
    },
    safety: { readOnly: true as const, databaseWrites: 0 as const,
      amazonWrites: 0 as const, supplierPurchases: 0 as const,
      publications: 0 as const, inventoryChanges: 0 as const,
      repricing: 0 as const, paidServicesActivated: 0 as const },
  }
  return Object.freeze({ ...result, scoutDigest: digest({ ...result,
    generatedAt: null }) })
}
