import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  approvalQueueEconomicsHash,
  approvalQueueRankingScore,
  buildLunaOperatorConfirmation,
  evaluateApprovalQueueCatalogCandidate,
  evaluateApprovalQueueDecision,
  rankApprovalQueue,
  rankTop20OpportunityPool,
  type ApprovalQueueCatalogCandidate,
  type ApprovalQueueDecisionEvidence,
  type ApprovalQueueRankedCandidate,
  type LunaAvailabilityConfirmation,
} from "./ebay-listing-ai-approval-queue"
import {
  assessListingAiDecisionPackage,
  type ListingAiDecisionRow,
} from "./ebay-openai-listing-factory-v2"
import { buildListingAiPackStrategy } from "./ebay-openai-listing-pack-strategy"
import {
  createWinnerEvidenceDecisionPackage,
  winnerComparablesFromKeywordReport,
} from "./ebay-winner-evidence-v2-service"
import {
  validateGtinChecksum,
  type WinnerComparableInput,
  type WinnerEvidenceInput,
} from "./ebay-winner-evidence-v2"

type JsonRecord = Record<string, unknown>

const MARKETPLACE = "EBAY_US"
const DEFAULT_BATCH_SIZE = 50
const MAX_BATCH_SIZE = 100
const LEASE_MS = 2 * 60_000
const FRESHNESS_MS = 24 * 60 * 60_000
const DEFAULT_SUPPLIER_SHIPPING_RESERVE_USD = 8

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function positiveInteger(value: unknown) {
  const parsed = number(value)
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function strings(value: unknown, maximum = 30) {
  return [...new Set((Array.isArray(value) ? value : []).map(text)
    .filter((entry): entry is string => Boolean(entry)))].slice(0, maximum)
}

function safeCodes(value: unknown) {
  return strings(value).filter((entry) => /^[A-Z0-9_]+$/.test(entry))
}

function hash(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

function meaningfulVariant(value: unknown) {
  const normalized = text(value)
  return normalized && !/^default(?: title)?$/i.test(normalized) ? normalized : null
}

function dimensions(value: unknown) {
  const row = record(value)
  const length = number(row.length)
  const width = number(row.width)
  const height = number(row.height)
  const unit: "in" | "cm" | null = row.unit === "in" || row.unit === "cm" ? row.unit : null
  return length && width && height && unit ? { length, width, height, unit } : null
}

function freshnessScore(value: string | null, now: Date) {
  const timestamp = Date.parse(value ?? "")
  if (!Number.isFinite(timestamp)) return 0
  const age = Math.max(0, now.getTime() - timestamp)
  return Math.max(0, Math.min(100, 100 - age / FRESHNESS_MS * 100))
}

function supplierReserve(environment: NodeJS.ProcessEnv) {
  const parsed = number(environment.LUNA_SUPPLIER_SHIPPING_RESERVE_USD)
  return parsed !== null && parsed >= 0 ? parsed : DEFAULT_SUPPLIER_SHIPPING_RESERVE_USD
}

function exactContents(metadata: JsonRecord) {
  const explicit = strings(metadata.exactContents ?? metadata.exact_contents)
  return explicit
}

function candidateFromRows(
  variant: JsonRecord,
  queue: JsonRecord,
  environment: NodeJS.ProcessEnv,
): ApprovalQueueCatalogCandidate {
  const metadata = record(variant.metadata)
  const assessment = record(queue.assessment)
  const assessedEconomics = record(assessment.economics)
  const titleStrategy = record(record(assessment.listingIntelligencePackage).titleStrategy)
  const keywordStructure = record(queue.keyword_structure)
  const category = record(metadata.ebayCategory ?? metadata.ebay_category)
  const imageProvenance = record(metadata.imageProvenance ?? metadata.image_provenance)
  const packCount = positiveInteger(metadata.packCount ?? metadata.pack_count ?? metadata.packQuantity ?? metadata.pack_quantity)
  const unitCount = positiveInteger(metadata.unitCount ?? metadata.unit_count ?? metadata.countPerItem ?? metadata.count_per_item)
  const manufacturerBrand = text(metadata.manufacturerBrand ?? metadata.manufacturer_brand ?? metadata.brand)
  const gtin = text(variant.barcode ?? metadata.gtin ?? metadata.upc)
  const model = text(metadata.model)
  const mpn = text(metadata.mpn)
  const requiredAspects = records(metadata.requiredAspects ?? metadata.required_aspects)
    .map((entry) => ({ name: text(entry.name), value: text(entry.value) }))
    .filter((entry): entry is { name: string; value: string } => Boolean(entry.name && entry.value))
  const approvedKeywords = [...new Set([
    text(keywordStructure.primarySearchPhrase),
    ...strings(keywordStructure.secondarySearchTerms),
    ...strings(keywordStructure.confirmedAttributes),
  ].filter((entry): entry is string => Boolean(entry)))]
  const restrictions = safeCodes(metadata.restrictionGuards ?? metadata.restriction_guards)
  const productName = text(variant.title)
  const supplierShippingReserveUsd = supplierReserve(environment)
  return {
    marketRadarProductId: text(variant.product_id),
    supplierProductId: text(variant.supplier_product_id),
    supplierVariantId: text(variant.supplier_variant_id),
    supplierSku: text(variant.sku),
    productUrl: text(variant.product_url),
    imageUrl: text(variant.featured_image_url),
    imageAuthorized: metadata.imageAuthorized === true || metadata.image_authorized === true ||
      imageProvenance.authorized === true,
    supplierCost: number(variant.price),
    available: variant.available === true,
    inventoryQuantity: number(variant.inventory_quantity),
    capturedAt: text(variant.captured_at),
    manufacturerBrand,
    gtin,
    gtinValid: validateGtinChecksum(gtin),
    mpn,
    model,
    productName,
    packCount,
    unitCount,
    size: text(metadata.size),
    color: text(metadata.color),
    scent: text(metadata.scent ?? metadata.fragrance),
    variant: text(metadata.variant) ?? meaningfulVariant(variant.variant_title),
    condition: text(metadata.condition) ?? "new",
    weight: number(variant.weight),
    weightUnit: text(variant.weight_unit),
    dimensions: dimensions(metadata.dimensions),
    exactContents: exactContents(metadata),
    categoryId: text(category.id ?? metadata.ebayCategoryId ?? metadata.ebay_category_id ?? titleStrategy.categoryId),
    categoryName: text(category.name ?? metadata.ebayCategoryName ?? metadata.ebay_category_name ?? titleStrategy.categoryName),
    requiredAspects,
    approvedKeywords,
    outboundShippingCost: number(metadata.outboundShippingCost ?? metadata.outbound_shipping_cost ?? assessedEconomics.estimatedOutboundShipping),
    packagingCost: number(metadata.packagingCost ?? metadata.packaging_cost),
    fixedFulfillmentCost: number(metadata.fixedFulfillmentCost ?? metadata.fixed_fulfillment_cost),
    supplierShippingReserveUsd,
    complianceBlocked: restrictions.length > 0 || metadata.complianceBlocked === true,
    complianceFindings: restrictions,
  }
}

function winnerInput(candidate: ApprovalQueueCatalogCandidate, accountKey: string): WinnerEvidenceInput {
  const shipping = (candidate.outboundShippingCost ?? 0) + (candidate.supplierShippingReserveUsd ?? 0)
  const includedContents = candidate.exactContents
  const offerCapacity = candidate.inventoryQuantity !== null && candidate.packCount
    ? Math.floor(candidate.inventoryQuantity / candidate.packCount) : null
  return {
    marketplaceAccountKey: accountKey,
    candidateId: candidate.marketRadarProductId,
    supplierSku: candidate.supplierSku ?? "",
    supplierVariantId: candidate.supplierVariantId,
    identity: {
      manufacturerBrand: candidate.manufacturerBrand,
      gtin: candidate.gtin,
      mpn: candidate.mpn,
      model: candidate.model,
      productName: candidate.productName,
      packCount: candidate.packCount,
      unitCount: candidate.unitCount,
      size: candidate.size,
      color: candidate.color,
      scent: candidate.scent,
      variant: candidate.variant,
      condition: candidate.condition,
    },
    supplierPackageCost: candidate.supplierCost !== null && candidate.packCount !== null
      ? candidate.supplierCost * candidate.packCount : null,
    packagingCost: candidate.packagingCost,
    outboundShippingCost: shipping,
    fixedFulfillmentCost: candidate.fixedFulfillmentCost,
    authorizedKeywords: candidate.approvedKeywords,
    requiredKeywordCount: Math.max(1, candidate.approvedKeywords.length),
    complianceBlocked: candidate.complianceBlocked,
    complianceFindings: candidate.complianceFindings,
    stockAvailable: offerCapacity,
    stockObservedAt: candidate.capturedAt,
    costObservedAt: candidate.capturedAt,
    listingAiIntake: {
      approvedKeywords: candidate.approvedKeywords,
      category: { id: candidate.categoryId, name: candidate.categoryName },
      requiredAspects: candidate.requiredAspects,
      optionalAspects: [],
      pricingScenarioName: "TOP10_CANONICAL_TARGET_PRICE",
      includedContents,
      complianceRestrictions: candidate.complianceFindings,
      blockedClaims: candidate.complianceFindings,
      allowedImageFacts: [
        candidate.manufacturerBrand,
        candidate.productName,
        candidate.size,
        candidate.color,
        candidate.scent,
        candidate.variant,
        candidate.packCount ? `${candidate.packCount} pack` : null,
      ].filter((entry): entry is string => Boolean(entry)),
      locale: "en-US",
    },
    packStrategyEvidence: {
      offers: [{
        packCount: candidate.packCount,
        unitCountPerItem: candidate.unitCount,
        exactContents: includedContents,
        offerGtin: candidate.packCount === 1 && candidate.gtinValid ? candidate.gtin : null,
        offerGtinVerified: candidate.packCount === 1 && candidate.gtinValid,
        cost: candidate.supplierCost !== null && candidate.packCount !== null
          ? candidate.supplierCost * candidate.packCount : null,
        shippingCost: shipping,
        stockRequired: 1,
        stockAvailable: offerCapacity,
        packageWeight: candidate.weight,
        packageDimensions: candidate.dimensions,
      }],
    },
  }
}

function comparableInputFromPackage(payload: JsonRecord): WinnerComparableInput[] {
  return records(record(payload.comparables).classified).map((entry) => {
    const identity = record(entry.identity)
    const pricing = record(entry.pricing)
    const patterns = record(entry.patterns)
    return {
      source: entry.source as WinnerComparableInput["source"],
      sourceListingId: text(entry.sourceListingId),
      observedAt: text(entry.observedAt),
      identity: {
        manufacturerBrand: text(identity.manufacturerBrand),
        gtin: text(identity.gtin),
        mpn: text(identity.mpn),
        model: text(identity.model),
        productName: text(identity.normalizedProductName) ?? text(record(record(payload.productIdentity).identity).normalizedProductName),
        packCount: number(identity.packCount),
        unitCount: number(identity.unitCount),
        size: text(identity.size),
        color: text(identity.color),
        scent: text(identity.scent),
        variant: text(identity.variant),
        condition: text(identity.condition),
      },
      itemPrice: number(pricing.itemPrice),
      shippingCost: number(pricing.shippingCost),
      currency: text(pricing.currency),
      confirmedSoldQuantity: number(entry.confirmedSoldQuantity),
      estimatedSoldQuantity: number(entry.estimatedSoldQuantity),
      keywords: strings(entry.keywords),
      shippingPattern: text(patterns.shipping),
      returnsPattern: text(patterns.returns),
      imageCount: number(patterns.imageCount),
      visualEvidence: record(entry.visualEvidence),
      evidenceReviewed: true,
    }
  }).filter((entry) => entry.source)
}

function evidenceFromPackage(row: ListingAiDecisionRow, candidate: ApprovalQueueCatalogCandidate, now: Date) {
  const payload = record(row.package_payload)
  const economics = record(payload.economics)
  const target = record(economics.targetEconomics)
  const scores = record(payload.scores)
  const counts = record(record(payload.comparables).counts)
  const visual = record(payload.visualEvidenceAnalysis)
  const pack = buildListingAiPackStrategy(row)
  const recommendation = pack.recommendedPack
  const assessment = assessListingAiDecisionPackage(
    { ...row, status: "APPROVED", approved_at: now.toISOString() }, now,
    { integrityVerified: true },
  )
  const evidence: ApprovalQueueDecisionEvidence = {
    verdict: row.verdict as ApprovalQueueDecisionEvidence["verdict"],
    identityStrong: assessment.identityStrong,
    identityFingerprint: row.product_identity_fingerprint,
    baseProductFingerprint: pack.baseProductFingerprint,
    offerPackFingerprint: recommendation?.offerPackFingerprint ?? pack.currentOfferPackFingerprint,
    exactLunaMapping: Boolean(candidate.marketRadarProductId && candidate.supplierProductId &&
      candidate.supplierVariantId && candidate.supplierSku),
    costRecent: assessment.costRecent,
    stockRecent: assessment.stockRecent,
    minimumSafePrice: number(economics.minimumSafePrice),
    targetPrice: number(economics.targetPrice),
    estimatedProfit: number(target.estimatedProfit),
    roiPercent: number(target.estimatedRoiPercent),
    netMarginPercent: number(target.estimatedNetMarginPercent),
    stockAvailable: candidate.inventoryQuantity,
    recommendedPackCount: recommendation?.packCount ?? candidate.packCount,
    safePackStrategy: Boolean(recommendation),
    shippingComplete: Boolean(recommendation && !recommendation.operationalRisk.some((code) =>
      code.includes("SHIPPING") || code.includes("WEIGHT") || code.includes("DIMENSIONS"))),
    complianceBlocked: candidate.complianceBlocked,
    activeExactCount: number(counts.activeExact) ?? 0,
    soldExactCount: number(counts.soldOrCompletedExact) ?? 0,
    estimatedDemandCount: number(counts.estimatedDemandSignals) ?? 0,
    evidenceConfidence: recommendation?.evidenceConfidence ?? "INSUFFICIENT",
    categoryKey: candidate.categoryId,
    scores: {
      overallOpportunity: number(scores.overallOpportunity) ?? 0,
      demandConfidence: number(scores.demandConfidence) ?? 0,
      marginSafety: number(scores.marginSafety) ?? 0,
      packStrategy: recommendation?.scores.overallPackStrategy ?? 0,
      keywordOpportunity: number(scores.keywordOpportunity) ?? 0,
      visualOpportunity: number(visual.visualOpportunityScore) ?? 0,
      listingReadiness: number(scores.listingReadiness) ?? 0,
      competitionPressure: number(scores.competitionPressure) ?? 100,
      freshness: freshnessScore(candidate.capturedAt, now),
      operationalSimplicity: recommendation && recommendation.operationalRisk.length === 0 ? 100 : 0,
    },
  }
  return { evidence, pack, assessment }
}

function safeEvidenceSnapshot(input: {
  candidate: ApprovalQueueCatalogCandidate
  evidence?: ApprovalQueueDecisionEvidence
  pack?: ReturnType<typeof buildListingAiPackStrategy>
  productName?: string | null
}) {
  return {
    product: {
      name: input.productName ?? input.candidate.productName,
      supplierSku: input.candidate.supplierSku,
      supplierVariantId: input.candidate.supplierVariantId,
      supplierProductId: input.candidate.supplierProductId,
      lunaUrl: input.candidate.productUrl,
      authorizedImageUrl: input.candidate.imageAuthorized ? input.candidate.imageUrl : null,
      variant: input.candidate.variant,
      capturedAt: input.candidate.capturedAt,
    },
    logistics: {
      supplierUnitQuantity: input.candidate.inventoryQuantity,
      weight: input.candidate.weight,
      weightUnit: input.candidate.weightUnit,
      dimensions: input.candidate.dimensions,
      outboundShippingCost: input.candidate.outboundShippingCost,
      packagingCost: input.candidate.packagingCost,
      fixedFulfillmentCost: input.candidate.fixedFulfillmentCost,
      supplierShippingCostStatus: "ESTIMATED",
      supplierShippingReserveUsd: input.candidate.supplierShippingReserveUsd,
    },
    evidence: input.evidence ? {
      activeExactCount: input.evidence.activeExactCount,
      soldExactCount: input.evidence.soldExactCount,
      estimatedDemandCount: input.evidence.estimatedDemandCount,
      confidence: input.evidence.evidenceConfidence,
      scores: input.evidence.scores,
    } : null,
    economics: input.evidence ? {
      minimumSafePrice: input.evidence.minimumSafePrice,
      targetPrice: input.evidence.targetPrice,
      estimatedProfit: input.evidence.estimatedProfit,
      roiPercent: input.evidence.roiPercent,
      netMarginPercent: input.evidence.netMarginPercent,
    } : null,
    packStrategy: input.pack ? {
      baseProductFingerprint: input.pack.baseProductFingerprint,
      recommendedPack: input.pack.recommendedPack,
      alternativePack: input.pack.alternativePack,
      matrix: input.pack.packMatrix,
    } : null,
    operatorConfirmationRequired: true,
    technicalDataRequestedFromOperator: false,
    canPublish: false,
    openAiCalls: 0,
    ebayWrites: 0,
  }
}

async function readDecisionRow(supabase: SupabaseClient, accountKey: string, packageId: string) {
  const { data, error } = await supabase.from("marketplace_listing_decision_packages")
    .select("id,candidate_id,package_version,package_hash,product_identity_fingerprint,verdict,status,package_payload,approved_at")
    .eq("id", packageId).eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
    .single()
  if (error || !data) throw new Error("TOP10_DECISION_PACKAGE_READ_FAILED")
  return data as ListingAiDecisionRow
}

async function analyzeCandidate(input: {
  supabase: SupabaseClient
  accountKey: string
  candidate: ApprovalQueueCatalogCandidate
  now: Date
  comparables?: WinnerComparableInput[]
}) {
  const generated = await createWinnerEvidenceDecisionPackage(
    input.supabase,
    { ...winnerInput(input.candidate, input.accountKey), comparables: input.comparables },
    { useOfficialRead: input.comparables === undefined, persist: true },
  )
  if (!generated.packageId) throw new Error("TOP10_DECISION_PACKAGE_PERSIST_REQUIRED")
  const row = await readDecisionRow(input.supabase, input.accountKey, generated.packageId)
  const { evidence, pack } = evidenceFromPackage(row, input.candidate, input.now)
  const classification = evaluateApprovalQueueDecision(evidence)
  return { row, evidence, pack, classification }
}

async function loadQueueRows(supabase: SupabaseClient, productIds: string[]) {
  if (!productIds.length) return new Map<string, JsonRecord>()
  const { data, error } = await supabase.from("ebay_luna_opportunity_queue")
    .select("market_radar_product_id,supplier_variant_id,keyword_structure,assessment,decision,opportunity_score,hard_gates,evidence_guards")
    .in("market_radar_product_id", productIds)
  if (error) throw new Error("TOP10_EXISTING_QUEUE_READ_FAILED")
  return new Map((data ?? []).map((row) => [`${row.market_radar_product_id}:${row.supplier_variant_id ?? ""}`, record(row)]))
}

async function claimRun(supabase: SupabaseClient, accountKey: string, total: number, workerId: string, now: Date) {
  const { data: existing } = await supabase.from("marketplace_listing_approval_queue_runs")
    .select("*").eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
    .in("status", ["RUNNING", "PARTIAL"]).order("created_at", { ascending: false }).limit(1).maybeSingle()
  const leaseExpires = new Date(now.getTime() + LEASE_MS).toISOString()
  if (existing) {
    const activeLease = existing.status === "RUNNING" && Date.parse(existing.lease_expires_at ?? "") > now.getTime()
    if (activeLease && existing.lease_owner !== workerId) throw new Error("TOP10_SCAN_LEASE_ACTIVE")
    const { data, error } = await supabase.from("marketplace_listing_approval_queue_runs")
      .update({ status: "RUNNING", lease_owner: workerId, lease_expires_at: leaseExpires,
        catalog_total: total, lock_version: Number(existing.lock_version) + 1, updated_at: now.toISOString() })
      .eq("id", existing.id).eq("lock_version", existing.lock_version).select("*").maybeSingle()
    if (error || !data) throw new Error("TOP10_SCAN_CONCURRENT_UPDATE")
    return data
  }
  const { data, error } = await supabase.from("marketplace_listing_approval_queue_runs").insert({
    marketplace_account_key: accountKey,
    marketplace: MARKETPLACE,
    status: "RUNNING",
    catalog_total: total,
    lease_owner: workerId,
    lease_expires_at: leaseExpires,
    scheduling_enabled: false,
  }).select("*").single()
  if (error || !data) throw new Error("TOP10_SCAN_RUN_CREATE_FAILED")
  return data
}

async function recomputeRanks(supabase: SupabaseClient, accountKey: string, runId: string) {
  const { data, error } = await supabase.from("marketplace_listing_approval_queue_items")
    .select("id,market_radar_product_id,supplier_variant_id,supplier_sku,product_identity_fingerprint,base_product_fingerprint,offer_pack_fingerprint,cohort,ranking_score,evidence_snapshot")
    .eq("run_id", runId).eq("marketplace_account_key", accountKey)
    .eq("marketplace", MARKETPLACE).neq("cohort", "REJECTED")
  if (error) throw new Error("TOP10_RANKING_READ_FAILED")
  const candidates = (data ?? []).map((row): ApprovalQueueRankedCandidate => {
    const snapshot = record(row.evidence_snapshot)
    const product = record(snapshot.product)
    const evidence = record(snapshot.evidence)
    const scores = record(evidence.scores)
    const economics = record(snapshot.economics)
    const pack = record(snapshot.packStrategy)
    const recommended = record(pack.recommendedPack)
    return {
      id: row.id,
      marketRadarProductId: row.market_radar_product_id,
      supplierVariantId: row.supplier_variant_id,
      supplierSku: row.supplier_sku,
      productName: text(product.name) ?? "N/D",
      verdict: row.cohort === "READY_FOR_OPERATOR_APPROVAL" ? "GO_WITH_CHANGES" : "NO_GO",
      identityStrong: true,
      identityFingerprint: row.product_identity_fingerprint,
      baseProductFingerprint: row.base_product_fingerprint,
      offerPackFingerprint: row.offer_pack_fingerprint,
      exactLunaMapping: true,
      costRecent: true,
      stockRecent: true,
      minimumSafePrice: number(economics.minimumSafePrice),
      targetPrice: number(economics.targetPrice),
      estimatedProfit: number(economics.estimatedProfit),
      roiPercent: number(economics.roiPercent),
      netMarginPercent: number(economics.netMarginPercent),
      stockAvailable: number(record(snapshot.logistics).supplierUnitQuantity),
      recommendedPackCount: number(recommended.packCount),
      safePackStrategy: true,
      shippingComplete: true,
      complianceBlocked: false,
      activeExactCount: number(evidence.activeExactCount) ?? 0,
      soldExactCount: number(evidence.soldExactCount) ?? 0,
      estimatedDemandCount: number(evidence.estimatedDemandCount) ?? 0,
      evidenceConfidence: text(evidence.confidence) ?? "INSUFFICIENT",
      categoryKey: text(record(product).categoryId),
      scores: {
        overallOpportunity: number(scores.overallOpportunity) ?? 0,
        demandConfidence: number(scores.demandConfidence) ?? 0,
        marginSafety: number(scores.marginSafety) ?? 0,
        packStrategy: number(scores.packStrategy) ?? 0,
        keywordOpportunity: number(scores.keywordOpportunity) ?? 0,
        visualOpportunity: number(scores.visualOpportunity) ?? 0,
        listingReadiness: number(scores.listingReadiness) ?? 0,
        competitionPressure: number(scores.competitionPressure) ?? 100,
        freshness: number(scores.freshness) ?? 0,
        operationalSimplicity: number(scores.operationalSimplicity) ?? 0,
      },
      rankingScore: number(row.ranking_score) ?? 0,
      cohort: row.cohort as ApprovalQueueRankedCandidate["cohort"],
      reasonCodes: [],
      rank: null,
    }
  })
  const ranked = rankApprovalQueue(candidates)
  const pool = rankTop20OpportunityPool(candidates)
  await supabase.from("marketplace_listing_approval_queue_items").update({ rank: null, pool_rank: null })
    .eq("run_id", runId).eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
  for (const item of pool) {
    const { error: updateError } = await supabase.from("marketplace_listing_approval_queue_items")
      .update({ pool_rank: item.poolRank }).eq("id", item.id).eq("marketplace_account_key", accountKey)
    if (updateError) throw new Error("TOP20_POOL_RANKING_PERSIST_FAILED")
  }
  for (const item of ranked) {
    const { error: updateError } = await supabase.from("marketplace_listing_approval_queue_items")
      .update({ rank: item.rank }).eq("id", item.id).eq("marketplace_account_key", accountKey)
    if (updateError) throw new Error("TOP10_RANKING_PERSIST_FAILED")
  }
  return { readyRanked: ranked.length, poolRanked: pool.length }
}

export async function runListingAiApprovalQueueBatch(input: {
  supabase: SupabaseClient
  accountKey: string
  batchSize?: number
  now?: Date
  environment?: NodeJS.ProcessEnv
}) {
  const now = input.now ?? new Date()
  const environment = input.environment ?? process.env
  const batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(input.batchSize ?? DEFAULT_BATCH_SIZE)))
  const workerId = `top10:${randomUUID()}`
  const countQuery = await input.supabase.from("market_radar_latest_variants")
    .select("product_id", { count: "exact", head: true }).eq("source_key", "lunaportex")
  if (countQuery.error) throw new Error("TOP10_CATALOG_COUNT_FAILED")
  const total = countQuery.count ?? 0
  const run = await claimRun(input.supabase, input.accountKey, total, workerId, now)
  const offset = Number(run.checkpoint_offset ?? 0)
  const { data: variants, error: catalogError } = await input.supabase
    .from("market_radar_latest_variants")
    .select("product_id,supplier_product_id,supplier_variant_id,sku,barcode,title,variant_title,vendor,product_type,tags,product_url,featured_image_url,image_urls,metadata,snapshot_id,price,available,inventory_quantity,weight,weight_unit,captured_at,seller_scan_priority_score")
    .eq("source_key", "lunaportex")
    .order("seller_scan_priority_score", { ascending: false })
    .order("product_id", { ascending: true })
    .range(offset, offset + batchSize - 1)
  if (catalogError) throw new Error("TOP10_CATALOG_READ_FAILED")
  const queueRows = await loadQueueRows(input.supabase, (variants ?? []).map((row) => row.product_id))
  let analyzed = 0
  let retries = 0
  const itemPayloads: JsonRecord[] = []
  for (const rawVariant of variants ?? []) {
    const variant = record(rawVariant)
    const queue = queueRows.get(`${variant.product_id}:${variant.supplier_variant_id ?? ""}`) ?? {}
    const candidate = candidateFromRows(variant, queue, environment)
    const catalogGate = evaluateApprovalQueueCatalogCandidate(candidate, now)
    let cohort = catalogGate.cohort
    let reasons = catalogGate.reasonCodes
    let packageId: string | null = null
    let packageHash: string | null = null
    let identityFingerprint: string | null = null
    let baseFingerprint: string | null = null
    let offerFingerprint: string | null = null
    let rankingScore = number(queue.opportunity_score) ??
      number(variant.seller_scan_priority_score) ?? 0
    let snapshot = safeEvidenceSnapshot({ candidate })
    let lastError: string | null = null
    if (catalogGate.canRunOfficialMarketRead) {
      try {
        const result = await analyzeCandidate({
          supabase: input.supabase, accountKey: input.accountKey, candidate, now,
        })
        analyzed += 1
        cohort = result.classification.cohort
        reasons = result.classification.reasonCodes
        packageId = result.row.id
        packageHash = result.row.package_hash
        identityFingerprint = result.row.product_identity_fingerprint
        baseFingerprint = result.pack.baseProductFingerprint
        offerFingerprint = result.pack.recommendedPack?.offerPackFingerprint ?? result.pack.currentOfferPackFingerprint
        rankingScore = approvalQueueRankingScore(result.evidence.scores)
        snapshot = safeEvidenceSnapshot({ candidate, evidence: result.evidence, pack: result.pack })
      } catch (error) {
        const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
          ? error.message : "TOP10_CANDIDATE_ANALYSIS_FAILED"
        cohort = "NEEDS_DATA"
        reasons = [code]
        lastError = code
        retries += 1
      }
    }
    itemPayloads.push({
        run_id: run.id,
        marketplace_account_key: input.accountKey,
        marketplace: MARKETPLACE,
        market_radar_product_id: candidate.marketRadarProductId,
        supplier_product_id: candidate.supplierProductId ?? candidate.marketRadarProductId,
        supplier_variant_id: candidate.supplierVariantId ?? "UNKNOWN",
        supplier_sku: candidate.supplierSku ?? "UNKNOWN",
        product_identity_fingerprint: identityFingerprint,
        base_product_fingerprint: baseFingerprint,
        offer_pack_fingerprint: offerFingerprint,
        decision_package_id: packageId,
        package_hash: packageHash,
        cohort,
        internal_status: lastError ? "REANALYSIS_REQUIRED" : cohort,
        pool_rank: null,
        rank: null,
        ranking_score: rankingScore,
        reason_codes: safeCodes(reasons),
        evidence_snapshot: snapshot,
        retry_count: lastError ? 1 : 0,
        next_retry_at: lastError ? new Date(now.getTime() + 15 * 60_000).toISOString() : null,
        last_error_code: lastError,
        stale_after: new Date(now.getTime() + FRESHNESS_MS).toISOString(),
        supplier_shipping_cost_status: "ESTIMATED",
        supplier_shipping_reserve_usd: candidate.supplierShippingReserveUsd,
        analyzed_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
  }
  if (itemPayloads.length) {
    const { error: itemError } = await input.supabase.from("marketplace_listing_approval_queue_items")
      .upsert(itemPayloads, { onConflict: "run_id,market_radar_product_id,supplier_variant_id" })
    if (itemError) throw new Error("TOP10_QUEUE_ITEM_PERSIST_FAILED")
  }
  const newOffset = offset + (variants?.length ?? 0)
  const completed = newOffset >= total
  await recomputeRanks(input.supabase, input.accountKey, run.id)
  const { data: itemRows, error: itemCountError } = await input.supabase
    .from("marketplace_listing_approval_queue_items").select("cohort")
    .eq("run_id", run.id).eq("marketplace_account_key", input.accountKey)
  if (itemCountError) throw new Error("TOP10_QUEUE_COUNT_FAILED")
  const ready = (itemRows ?? []).filter((row) => row.cohort === "READY_FOR_OPERATOR_APPROVAL").length
  const needs = (itemRows ?? []).filter((row) => row.cohort === "NEEDS_DATA").length
  const rejected = (itemRows ?? []).filter((row) => row.cohort === "REJECTED").length
  const { error: finishError } = await input.supabase.from("marketplace_listing_approval_queue_runs")
    .update({
      status: completed ? "COMPLETED" : "PARTIAL",
      checkpoint_offset: newOffset,
      catalog_examined: newOffset,
      candidates_analyzed: Number(run.candidates_analyzed ?? 0) + analyzed,
      ready_count: ready,
      needs_data_count: needs,
      rejected_count: rejected,
      retry_count: Number(run.retry_count ?? 0) + retries,
      lease_owner: null,
      lease_expires_at: null,
      completed_at: completed ? now.toISOString() : null,
      updated_at: now.toISOString(),
    }).eq("id", run.id).eq("lease_owner", workerId)
  if (finishError) throw new Error("TOP10_SCAN_RUN_FINISH_FAILED")
  return {
    runId: run.id,
    status: completed ? "COMPLETED" : "PARTIAL",
    catalogTotal: total,
    catalogExamined: newOffset,
    candidatesAnalyzed: Number(run.candidates_analyzed ?? 0) + analyzed,
    ready,
    needsData: needs,
    rejected,
    retries: Number(run.retry_count ?? 0) + retries,
    openAiCalls: 0,
    ebayWrites: 0,
    canPublish: false,
    schedulingEnabled: false,
  }
}

export async function getListingAiApprovalQueueStatus(
  supabase: SupabaseClient,
  accountKey: string,
) {
  const { data: run, error: runError } = await supabase
    .from("marketplace_listing_approval_queue_runs").select("*")
    .eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (runError) throw new Error("TOP10_STATUS_READ_FAILED")
  const { data: items, error: itemsError } = run
    ? await supabase.from("marketplace_listing_approval_queue_items")
      .select("id,market_radar_product_id,supplier_product_id,supplier_variant_id,supplier_sku,product_identity_fingerprint,base_product_fingerprint,offer_pack_fingerprint,decision_package_id,package_hash,cohort,internal_status,pool_rank,rank,ranking_score,reason_codes,evidence_snapshot,retry_count,next_retry_at,last_error_code,stale_after,operator_action,supplier_price_observed,supplier_availability_confirmation,supplier_unit_quantity,stock_confidence,recommended_pack_count,available_offer_pack_capacity,ebay_listing_quantity,supplier_shipping_cost_status,supplier_shipping_reserve_usd,supplier_confirmed_at,approved_at,discarded_at,analyzed_at")
      .eq("run_id", run.id).eq("marketplace_account_key", accountKey)
      .order("cohort", { ascending: true }).order("rank", { ascending: true, nullsFirst: false })
      .order("ranking_score", { ascending: false }).limit(300)
    : { data: [], error: null }
  if (itemsError) throw new Error("TOP10_ITEMS_READ_FAILED")
  const currentItems = items ?? []
  const isFresh = (row: { stale_after: string }) => Date.parse(row.stale_after) > Date.now()
  return {
    run,
    pool: currentItems.filter((row) => row.pool_rank &&
      ["READY_FOR_OPERATOR_APPROVAL", "READY_FOR_OPENAI_APPROVAL"].includes(row.internal_status) &&
      isFresh(row)).sort((left, right) =>
      Number(left.pool_rank) - Number(right.pool_rank)),
    ready: currentItems.filter((row) => row.cohort === "READY_FOR_OPERATOR_APPROVAL" &&
      row.rank && isFresh(row)),
    internalCounts: {
      needsData: currentItems.filter((row) => row.internal_status === "NEEDS_DATA").length,
      rejected: currentItems.filter((row) => ["REJECTED", "REJECTED_AFTER_CONFIRMATION"].includes(row.internal_status)).length,
      stale: currentItems.filter((row) => row.internal_status === "STALE" || !isFresh(row)).length,
      reanalysisRequired: currentItems.filter((row) => row.internal_status === "REANALYSIS_REQUIRED").length,
    },
    safety: {
      activeLoop: "LOOP_2",
      openAiFactoryEnabled: false,
      openAiCalls: 0,
      loop3Started: false,
      draftsCreated: 0,
      publicationsCreated: 0,
      ebayWrites: 0,
      canPublish: false,
      schedulingEnabled: false,
      technicalDataRequestedFromOperator: false,
    },
  }
}

async function readQueueItem(supabase: SupabaseClient, accountKey: string, itemId: string) {
  const { data, error } = await supabase.from("marketplace_listing_approval_queue_items")
    .select("*").eq("id", itemId).eq("marketplace_account_key", accountKey)
    .eq("marketplace", MARKETPLACE).maybeSingle()
  if (error) throw new Error("TOP10_ITEM_READ_FAILED")
  if (!data) throw new Error("TOP10_ITEM_NOT_FOUND")
  return data
}

export async function confirmListingAiQueueLunaObservation(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  itemId: string
  idempotencyKey: string
  priceObserved: number
  availability: LunaAvailabilityConfirmation
  exactQuantity?: number | null
  now?: Date
  environment?: NodeJS.ProcessEnv
}) {
  const now = input.now ?? new Date()
  const item = await readQueueItem(input.supabase, input.accountKey, input.itemId)
  const snapshot = record(item.evidence_snapshot)
  const pack = record(record(snapshot.packStrategy).recommendedPack)
  const recommendedPackCount = positiveInteger(pack.packCount)
  if (!recommendedPackCount) throw new Error("TOP10_RECOMMENDED_PACK_REQUIRED")
  const reserve = number(item.supplier_shipping_reserve_usd) ??
    supplierReserve(input.environment ?? process.env)
  const confirmation = buildLunaOperatorConfirmation({
    priceObserved: input.priceObserved,
    availability: input.availability,
    exactQuantity: input.exactQuantity,
    recommendedPackCount,
    supplierShippingReserveUsd: reserve,
  })
  const idempotencyHash = hash({ accountKey: input.accountKey, key: input.idempotencyKey })
  const { data: existing } = await input.supabase.from("marketplace_listing_supplier_confirmations")
    .select("id").eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", MARKETPLACE).eq("idempotency_key_hash", idempotencyHash).maybeSingle()
  if (existing) return { duplicate: true, confirmation, openAiCalls: 0, ebayWrites: 0 }
  if (!confirmation.canRemainReady) {
    const { error: eventError } = await input.supabase.from("marketplace_listing_supplier_confirmations").insert({
      marketplace_account_key: input.accountKey, marketplace: MARKETPLACE,
      queue_item_id: item.id, decision_package_id: item.decision_package_id,
      package_hash: item.package_hash, supplier_price_observed: confirmation.supplierPriceObserved,
      availability_confirmation: confirmation.availabilityConfirmation,
      supplier_unit_quantity: confirmation.supplierUnitQuantity,
      stock_confidence: confirmation.stockConfidence,
      recommended_pack_count: confirmation.recommendedPackCount,
      available_offer_pack_capacity: confirmation.availableOfferPackCapacity,
      ebay_listing_quantity: confirmation.ebayListingQuantity,
      supplier_shipping_cost_status: confirmation.supplierShippingCostStatus,
      supplier_shipping_reserve_usd: confirmation.supplierShippingReserveUsd,
      actor_id: input.actorId, idempotency_key_hash: idempotencyHash,
    })
    if (eventError) throw new Error("TOP10_LUNA_CONFIRMATION_PERSIST_FAILED")
    await input.supabase.from("marketplace_listing_approval_queue_items").update({
      cohort: "REJECTED", internal_status: "REJECTED_AFTER_CONFIRMATION", rank: null,
      pool_rank: null, reason_codes: ["LUNA_OUT_OF_STOCK_OBSERVATION"],
      supplier_price_observed: confirmation.supplierPriceObserved,
      supplier_availability_confirmation: confirmation.availabilityConfirmation,
      supplier_unit_quantity: confirmation.supplierUnitQuantity,
      stock_confidence: confirmation.stockConfidence,
      recommended_pack_count: confirmation.recommendedPackCount,
      available_offer_pack_capacity: 0, ebay_listing_quantity: 0,
      supplier_confirmed_at: now.toISOString(), updated_at: now.toISOString(),
    }).eq("id", item.id).eq("marketplace_account_key", input.accountKey)
    await recomputeRanks(input.supabase, input.accountKey, item.run_id)
    return { duplicate: false, confirmation, cohort: "REJECTED_AFTER_CONFIRMATION", openAiCalls: 0, ebayWrites: 0 }
  }
  if (!item.decision_package_id) throw new Error("TOP10_DECISION_PACKAGE_REQUIRED")
  const previous = await readDecisionRow(input.supabase, input.accountKey, item.decision_package_id)
  const payload = record(previous.package_payload)
  const identity = record(record(payload.productIdentity).identity)
  const intake = record(payload.listingAiIntake)
  const logistics = record(snapshot.logistics)
  const dims = dimensions(logistics.dimensions)
  const outbound = number(logistics.outboundShippingCost)
  const packagingCost = number(logistics.packagingCost)
  const fixedFulfillmentCost = number(logistics.fixedFulfillmentCost)
  if (outbound === null || packagingCost === null || fixedFulfillmentCost === null) {
    throw new Error("TOP20_CANONICAL_COST_COMPONENTS_REQUIRED")
  }
  const refreshedInput: WinnerEvidenceInput = {
    marketplaceAccountKey: input.accountKey,
    candidateId: text(payload.candidateId), supplierSku: text(payload.supplierSku) ?? item.supplier_sku,
    supplierVariantId: text(payload.supplierVariantId) ?? item.supplier_variant_id,
    identity: {
      manufacturerBrand: text(identity.manufacturerBrand), gtin: text(identity.gtin),
      mpn: text(identity.mpn), model: text(identity.model),
      productName: text(identity.normalizedProductName), packCount: number(identity.packCount),
      unitCount: number(identity.unitCount), size: text(identity.size), color: text(identity.color),
      scent: text(identity.scent), variant: text(identity.variant), condition: text(identity.condition),
    },
    comparables: comparableInputFromPackage(payload),
    supplierPackageCost: confirmation.supplierPriceObserved * confirmation.recommendedPackCount,
    packagingCost,
    outboundShippingCost: outbound + confirmation.supplierShippingReserveUsd,
    fixedFulfillmentCost,
    authorizedKeywords: strings(intake.approvedKeywords),
    requiredKeywordCount: Math.max(1, strings(intake.approvedKeywords).length),
    complianceBlocked: record(payload.compliance).blocked === true,
    complianceFindings: strings(record(payload.compliance).findings),
    stockAvailable: confirmation.availableOfferPackCapacity,
    stockObservedAt: now.toISOString(), costObservedAt: now.toISOString(),
    listingAiIntake: intake as WinnerEvidenceInput["listingAiIntake"],
    packStrategyEvidence: { offers: [{
      packCount: confirmation.recommendedPackCount,
      unitCountPerItem: number(identity.unitCount),
      exactContents: strings(intake.includedContents),
      offerGtin: confirmation.recommendedPackCount === 1 && identity.gtinValid === true ? text(identity.gtin) : null,
      offerGtinVerified: confirmation.recommendedPackCount === 1 && identity.gtinValid === true,
      cost: confirmation.supplierPriceObserved * confirmation.recommendedPackCount,
      shippingCost: outbound + confirmation.supplierShippingReserveUsd,
      stockRequired: 1, stockAvailable: confirmation.availableOfferPackCapacity,
      packageWeight: number(logistics.weight), packageDimensions: dims,
    }] },
    now,
  }
  const generated = await createWinnerEvidenceDecisionPackage(input.supabase, refreshedInput,
    { useOfficialRead: false, persist: true })
  if (!generated.packageId) throw new Error("TOP10_REFRESHED_PACKAGE_REQUIRED")
  const refreshed = await readDecisionRow(input.supabase, input.accountKey, generated.packageId)
  const candidate: ApprovalQueueCatalogCandidate = {
    marketRadarProductId: item.market_radar_product_id,
    supplierProductId: item.supplier_product_id,
    supplierVariantId: item.supplier_variant_id,
    supplierSku: item.supplier_sku,
    productUrl: text(record(snapshot.product).lunaUrl), imageUrl: text(record(snapshot.product).authorizedImageUrl),
    imageAuthorized: Boolean(record(snapshot.product).authorizedImageUrl),
    supplierCost: confirmation.supplierPriceObserved, available: true,
    inventoryQuantity: confirmation.availableOfferPackCapacity, capturedAt: now.toISOString(),
    manufacturerBrand: text(identity.manufacturerBrand), gtin: text(identity.gtin), gtinValid: identity.gtinValid === true,
    mpn: text(identity.mpn), model: text(identity.model), productName: text(identity.normalizedProductName),
    packCount: confirmation.recommendedPackCount, unitCount: number(identity.unitCount), size: text(identity.size),
    color: text(identity.color), scent: text(identity.scent), variant: text(identity.variant), condition: text(identity.condition),
    weight: number(logistics.weight), weightUnit: text(logistics.weightUnit), dimensions: dims,
    exactContents: strings(intake.includedContents), categoryId: text(record(intake.category).id),
    categoryName: text(record(intake.category).name), requiredAspects: records(intake.requiredAspects)
      .map((entry) => ({ name: text(entry.name) ?? "", value: text(entry.value) ?? "" })).filter((entry) => entry.name && entry.value),
    approvedKeywords: strings(intake.approvedKeywords), outboundShippingCost: outbound,
    packagingCost, fixedFulfillmentCost, supplierShippingReserveUsd: confirmation.supplierShippingReserveUsd,
    complianceBlocked: record(payload.compliance).blocked === true,
    complianceFindings: strings(record(payload.compliance).findings),
  }
  const { evidence, pack: refreshedPack } = evidenceFromPackage(refreshed, candidate, now)
  const classification = evaluateApprovalQueueDecision(evidence)
  const refreshedSnapshot = safeEvidenceSnapshot({ candidate, evidence, pack: refreshedPack })
  const { error: eventError } = await input.supabase.from("marketplace_listing_supplier_confirmations").insert({
    marketplace_account_key: input.accountKey, marketplace: MARKETPLACE,
    queue_item_id: item.id, decision_package_id: refreshed.id, package_hash: refreshed.package_hash,
    supplier_price_observed: confirmation.supplierPriceObserved,
    availability_confirmation: confirmation.availabilityConfirmation,
    supplier_unit_quantity: confirmation.supplierUnitQuantity,
    stock_confidence: confirmation.stockConfidence,
    recommended_pack_count: confirmation.recommendedPackCount,
    available_offer_pack_capacity: confirmation.availableOfferPackCapacity,
    ebay_listing_quantity: confirmation.ebayListingQuantity,
    supplier_shipping_cost_status: confirmation.supplierShippingCostStatus,
    supplier_shipping_reserve_usd: confirmation.supplierShippingReserveUsd,
    actor_id: input.actorId, idempotency_key_hash: idempotencyHash,
  })
  if (eventError) throw new Error("TOP10_LUNA_CONFIRMATION_PERSIST_FAILED")
  await input.supabase.from("marketplace_listing_approval_queue_items").update({
    decision_package_id: refreshed.id, package_hash: refreshed.package_hash,
    product_identity_fingerprint: refreshed.product_identity_fingerprint,
    base_product_fingerprint: refreshedPack.baseProductFingerprint,
    offer_pack_fingerprint: refreshedPack.recommendedPack?.offerPackFingerprint ?? refreshedPack.currentOfferPackFingerprint,
    cohort: classification.cohort,
    internal_status: classification.cohort === "READY_FOR_OPERATOR_APPROVAL"
      ? "READY_FOR_OPENAI_APPROVAL" : "REJECTED_AFTER_CONFIRMATION",
    rank: null, pool_rank: null,
    ranking_score: approvalQueueRankingScore(evidence.scores), reason_codes: classification.reasonCodes,
    evidence_snapshot: refreshedSnapshot,
    supplier_price_observed: confirmation.supplierPriceObserved,
    supplier_availability_confirmation: confirmation.availabilityConfirmation,
    supplier_unit_quantity: confirmation.supplierUnitQuantity,
    stock_confidence: confirmation.stockConfidence,
    recommended_pack_count: confirmation.recommendedPackCount,
    available_offer_pack_capacity: confirmation.availableOfferPackCapacity,
    ebay_listing_quantity: confirmation.ebayListingQuantity,
    supplier_shipping_cost_status: confirmation.supplierShippingCostStatus,
    supplier_shipping_reserve_usd: confirmation.supplierShippingReserveUsd,
    supplier_confirmed_at: now.toISOString(), stale_after: new Date(now.getTime() + FRESHNESS_MS).toISOString(),
    updated_at: now.toISOString(),
  }).eq("id", item.id).eq("marketplace_account_key", input.accountKey)
  await recomputeRanks(input.supabase, input.accountKey, item.run_id)
  return { duplicate: false, confirmation, cohort: classification.cohort,
    economicsViable: classification.cohort === "READY_FOR_OPERATOR_APPROVAL",
    packageHash: refreshed.package_hash, openAiCalls: 0, ebayWrites: 0, canPublish: false }
}

export async function approveListingAiQueueItem(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  itemId: string
  packageHash: string
  confirmed: boolean
  idempotencyKey: string
  now?: Date
}) {
  if (!input.confirmed) throw new Error("TOP10_OPERATOR_CONFIRMATION_REQUIRED")
  const now = input.now ?? new Date()
  const item = await readQueueItem(input.supabase, input.accountKey, input.itemId)
  if (item.cohort !== "READY_FOR_OPERATOR_APPROVAL" || !item.rank) throw new Error("TOP10_ITEM_NOT_READY")
  if (!item.supplier_confirmed_at) throw new Error("TOP10_LUNA_CONFIRMATION_REQUIRED")
  if (item.package_hash !== input.packageHash || !item.decision_package_id) throw new Error("TOP10_PACKAGE_STALE")
  if ((item.ebay_listing_quantity ?? 0) !== 1 || (item.available_offer_pack_capacity ?? 0) < 1) {
    throw new Error("TOP10_OFFER_CAPACITY_REQUIRED")
  }
  const decision = await readDecisionRow(input.supabase, input.accountKey, item.decision_package_id)
  const assessment = assessListingAiDecisionPackage(
    { ...decision, status: "APPROVED", approved_at: now.toISOString() }, now,
    { integrityVerified: true },
  )
  if (!assessment.eligible) throw new Error(assessment.reasons[0] ?? "TOP10_PACKAGE_NOT_ELIGIBLE")
  const payload = record(decision.package_payload)
  const pack = buildListingAiPackStrategy(decision)
  const recommended = pack.recommendedPack
  if (!recommended || recommended.offerPackFingerprint !== item.offer_pack_fingerprint) {
    throw new Error("TOP10_PACK_STRATEGY_STALE")
  }
  const idempotencyHash = hash({ accountKey: input.accountKey, key: input.idempotencyKey })
  const economicsHash = approvalQueueEconomicsHash(record(payload.economics))
  const { data: existing } = await input.supabase.from("marketplace_listing_operator_approvals")
    .select("id").eq("marketplace_account_key", input.accountKey).eq("marketplace", MARKETPLACE)
    .eq("idempotency_key_hash", idempotencyHash).maybeSingle()
  if (existing) return { duplicate: true, packageId: decision.id, packageHash: decision.package_hash,
    openAiGenerationAuthorized: true, openAiCalls: 0, ebayWrites: 0, canPublish: false }
  const { error: approvalError } = await input.supabase.from("marketplace_listing_operator_approvals").insert({
    marketplace_account_key: input.accountKey, marketplace: MARKETPLACE,
    queue_item_id: item.id, decision_package_id: decision.id,
    package_hash: decision.package_hash, offer_pack_fingerprint: recommended.offerPackFingerprint,
    economics_hash: economicsHash, action: "APPROVED_FOR_OPENAI", actor_id: input.actorId,
    idempotency_key_hash: idempotencyHash,
  })
  if (approvalError) throw new Error("TOP10_OPERATOR_APPROVAL_PERSIST_FAILED")
  const { error: decisionError } = await input.supabase.from("marketplace_listing_decision_packages")
    .update({ status: "APPROVED", approved_at: now.toISOString(), approved_by: input.actorId,
      updated_at: now.toISOString() })
    .eq("id", decision.id).eq("marketplace_account_key", input.accountKey)
    .eq("package_hash", decision.package_hash).eq("status", "GENERATED")
  if (decisionError) throw new Error("TOP10_DECISION_APPROVAL_FAILED")
  await input.supabase.from("marketplace_listing_approval_queue_items").update({
    operator_action: "APPROVED", approved_at: now.toISOString(), updated_at: now.toISOString(),
  }).eq("id", item.id).eq("marketplace_account_key", input.accountKey)
  return { duplicate: false, packageId: decision.id, packageHash: decision.package_hash,
    offerPackFingerprint: recommended.offerPackFingerprint, economicsHash,
    listingAiIntakePresent: Boolean(payload.listingAiIntake), openAiGenerationAuthorized: true,
    openAiCalls: 0, ebayWrites: 0, canPublish: false }
}

export async function discardListingAiQueueItem(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  itemId: string
  idempotencyKey: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const item = await readQueueItem(input.supabase, input.accountKey, input.itemId)
  if (!item.decision_package_id || !item.package_hash || !item.offer_pack_fingerprint) {
    throw new Error("TOP10_DISCARD_PACKAGE_REQUIRED")
  }
  const idempotencyHash = hash({ accountKey: input.accountKey, key: input.idempotencyKey })
  const { error } = await input.supabase.from("marketplace_listing_operator_approvals").insert({
    marketplace_account_key: input.accountKey, marketplace: MARKETPLACE,
    queue_item_id: item.id, decision_package_id: item.decision_package_id,
    package_hash: item.package_hash, offer_pack_fingerprint: item.offer_pack_fingerprint,
    economics_hash: approvalQueueEconomicsHash(record(record(item.evidence_snapshot).economics)),
    action: "DISCARDED", actor_id: input.actorId, idempotency_key_hash: idempotencyHash,
  })
  if (error && error.code !== "23505") throw new Error("TOP10_DISCARD_PERSIST_FAILED")
  await input.supabase.from("marketplace_listing_approval_queue_items").update({
    cohort: "REJECTED", internal_status: "REJECTED", rank: null, pool_rank: null,
    operator_action: "DISCARDED",
    reason_codes: ["OPERATOR_DISCARDED"], discarded_at: now.toISOString(), updated_at: now.toISOString(),
  }).eq("id", item.id).eq("marketplace_account_key", input.accountKey)
  await recomputeRanks(input.supabase, input.accountKey, item.run_id)
  return { duplicate: error?.code === "23505", openAiCalls: 0, ebayWrites: 0, canPublish: false }
}

export { winnerComparablesFromKeywordReport }
