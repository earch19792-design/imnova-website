import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  approvalQueueEconomicsHash,
  approvalQueueRankingScore,
  buildDualSourceOpportunityIntelligence,
  buildLunaOperatorConfirmation,
  evaluateApprovalQueueCatalogCandidate,
  evaluateApprovalQueueDecision,
  evaluateApprovalQueueLoop1Eligibility,
  rankApprovalQueue,
  rankTop20OpportunityPool,
  resolveLunaPortexImageAuthorization,
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
  discoverEbayBestSellingProducts,
  discoverEbayListingSignals,
  getEbayTaxonomyListingIntelligence,
  runEbaySellerKeywordDemandValidation,
  searchEbayCatalogIdentity,
  type EbayCatalogIdentityProduct,
} from "./ebay-seller-keyword-demand-gateway"
import { getEbayReadonlyRateLimitMetadata } from "./ebay-readonly-rate-limit"
import {
  LUNA_PRODUCT_IDENTITY_ENRICHMENT_VERSION,
  automaticQualification,
  buildEbayCatalogIdentityEvidence,
  buildExactComparableConsensus,
  buildLunaStructuredIdentityEvidence,
  canonicalContentsFromPack,
  classifyComparableAgainstLunaSupply,
  conservativeLogistics,
  resolveProductIdentity,
  sanitizedSourceIdentifier,
  selectCatalogIdentityMatches,
  type CanonicalProductIdentity,
  type EbayComparableIdentityObservation,
  type IdentityAttributeEvidence,
} from "./ebay-luna-product-identity-enrichment"
import {
  createWinnerEvidenceDecisionPackage,
  winnerComparablesFromKeywordReport,
} from "./ebay-winner-evidence-v2-service"
import {
  officialSoldEvidenceComparablesForTarget,
  readReviewedOfficialSoldEvidence,
  type StoredOfficialSoldEvidence,
} from "./ebay-official-sold-evidence-import"
import {
  EBAY_WINNER_EVIDENCE_V2_VERSION,
  buildProductIdentityFingerprint,
  classifyWinnerComparable,
  validateGtinChecksum,
  type WinnerComparableInput,
  type WinnerEvidenceInput,
} from "./ebay-winner-evidence-v2"
import {
  buildTop20TargetManifest,
  calculateTop20RateLimitPause,
  createTop20ContinuationToken,
  evaluateTop20DiscoveryPreselection,
  getTop20AutomationConfiguration,
  hashTop20ContinuationToken,
  isTop20AutomationActive,
  isTop20RateLimitError,
  shouldRecoverEmptyTop20Completion,
  shouldRecoverIncompleteTop20Completion,
  shouldReanalyzeTop20ForPolicyUpgrade,
  top20ReanalysisScope,
  TOP20_AUTOMATION_POLICY_VERSION,
  top20ProgressPercent,
  top20ReleasedTargetStatus,
  verifyTop20ContinuationToken,
  type Top20AutomationStatus,
  type Top20RateLimitPause,
  type Top20TargetCandidate,
} from "./ebay-listing-ai-top20-automation"
import type { Top20DispatchDiagnostic } from "./ebay-listing-ai-top20-dispatch"
import {
  ebayFirstEvidenceSnapshot,
  matchEbayFirstProductsToLuna,
  type HybridEbayProduct,
  type HybridLunaCandidate,
} from "./ebay-listing-ai-hybrid-discovery"

type JsonRecord = Record<string, unknown>

const MARKETPLACE = "EBAY_US"
const LEASE_MS = 2 * 60_000
const FRESHNESS_MS = 24 * 60 * 60_000
const DEFAULT_SUPPLIER_SHIPPING_RESERVE_USD = 8
const DEFAULT_CONSERVATIVE_OUTBOUND_RESERVE_USD = 18
const DEFAULT_PACKAGING_COST_USD = 1.5
const DEFAULT_FIXED_FULFILLMENT_COST_USD = 1.5
export const TOP20_QUALIFICATION_POLICY_VERSION =
  `${LUNA_PRODUCT_IDENTITY_ENRICHMENT_VERSION}:${EBAY_WINNER_EVIDENCE_V2_VERSION}:` +
  TOP20_AUTOMATION_POLICY_VERSION
const RECOVERABLE_DISPATCH_ERRORS = new Set([
  "TOP20_CONTINUATION_DISPATCH_FAILED",
  "TOP20_CONTINUATION_QUEUE_FAILED",
])

function priorTop20RateLimitCount(target: JsonRecord) {
  const persisted = number(target.rate_limit_consecutive_count)
  if (persisted !== null && persisted > 0) return Math.min(persisted, 20)
  return isTop20RateLimitError(new Error(text(target.last_error_code) ?? ""))
    ? Math.min(Math.max(number(target.attempt_count) ?? 1, 1), 4)
    : 0
}

function top20RateLimitPause(error: unknown, target: JsonRecord, now: Date) {
  const metadata = getEbayReadonlyRateLimitMetadata(error)
  return calculateTop20RateLimitPause({
    now,
    previousConsecutiveCount: priorTop20RateLimitCount(target),
    retryAfterSeconds: metadata?.retryAfterSeconds ?? null,
    retryAfterSource: metadata?.retryAfterSource ?? "UNAVAILABLE",
  })
}

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
  enriched?: {
    identity: CanonicalProductIdentity
    logistics: ReturnType<typeof conservativeLogistics>
    requiredAspects: Array<{ name: string; value: string }>
    conflicts: string[]
  },
): ApprovalQueueCatalogCandidate {
  const metadata = record(variant.metadata)
  const assessment = record(queue.assessment)
  const assessedEconomics = record(assessment.economics)
  const titleStrategy = record(record(assessment.listingIntelligencePackage).titleStrategy)
  const keywordStructure = record(queue.keyword_structure)
  const category = record(metadata.ebayCategory ?? metadata.ebay_category)
  const imageProvenance = record(metadata.imageProvenance ?? metadata.image_provenance)
  const identity = enriched?.identity
  const packCount = identity?.packCount ?? positiveInteger(metadata.packCount ?? metadata.pack_count ?? metadata.packQuantity ?? metadata.pack_quantity)
  const unitCount = identity?.unitCount ?? positiveInteger(metadata.unitCount ?? metadata.unit_count ?? metadata.countPerItem ?? metadata.count_per_item)
  const manufacturerBrand = identity?.brand ?? text(metadata.manufacturerBrand ?? metadata.manufacturer_brand ?? metadata.brand)
  const gtin = identity?.validGtin ?? text(variant.barcode ?? metadata.gtin ?? metadata.upc)
  const model = identity?.model ?? text(metadata.model)
  const mpn = identity?.mpn ?? text(metadata.mpn)
  const requiredAspects = enriched?.requiredAspects ?? records(metadata.requiredAspects ?? metadata.required_aspects)
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
  const productUrl = text(variant.product_url)
  const imageUrl = text(variant.featured_image_url)
  const imageAuthorization = resolveLunaPortexImageAuthorization({
    metadataAuthorized: metadata.imageAuthorized === true || metadata.image_authorized === true ||
      imageProvenance.authorized === true,
    imageUrl,
    productUrl,
    environment,
  })
  return {
    marketRadarProductId: text(variant.product_id),
    supplierProductId: text(variant.supplier_product_id),
    supplierVariantId: text(variant.supplier_variant_id),
    supplierSku: text(variant.sku),
    productUrl,
    imageUrl,
    imageAuthorized: imageAuthorization.authorized,
    imageAuthorizationSource: imageAuthorization.source,
    supplierCost: number(variant.price),
    available: variant.available === true,
    inventoryQuantity: number(variant.inventory_quantity),
    capturedAt: text(variant.captured_at),
    manufacturerBrand,
    gtin,
    gtinValid: validateGtinChecksum(gtin),
    mpn,
    model,
    productName: identity?.normalizedProductName ?? productName,
    packCount,
    unitCount,
    size: identity?.size ?? text(metadata.size),
    color: identity?.color ?? text(metadata.color),
    scent: identity?.scent ?? text(metadata.scent ?? metadata.fragrance),
    variant: identity?.variant ?? text(metadata.variant) ?? meaningfulVariant(variant.variant_title),
    condition: identity?.condition ?? text(metadata.condition) ?? "new",
    weight: enriched?.logistics.weight.value ?? number(variant.weight),
    weightUnit: enriched?.logistics.weight.unit ?? text(variant.weight_unit),
    dimensions: enriched?.logistics.dimensions ?? dimensions(metadata.dimensions),
    logisticsStatus: enriched?.logistics.status ?? (dimensions(metadata.dimensions) && number(variant.weight) ? "CONFIRMED" : "INSUFFICIENT"),
    identityConflictAttributes: enriched?.conflicts ?? [],
    exactContents: identity?.totalContents.length ? identity.totalContents : exactContents(metadata),
    categoryId: identity?.categoryId ?? text(category.id ?? metadata.ebayCategoryId ?? metadata.ebay_category_id ?? titleStrategy.categoryId),
    categoryName: text(category.name ?? metadata.ebayCategoryName ?? metadata.ebay_category_name ?? titleStrategy.categoryName),
    requiredAspects,
    approvedKeywords,
    outboundShippingCost: number(metadata.outboundShippingCost ?? metadata.outbound_shipping_cost ?? assessedEconomics.estimatedOutboundShipping) ??
      (enriched?.logistics.status === "ESTIMATED" ? enriched.logistics.outboundReserveUsd : null),
    packagingCost: number(metadata.packagingCost ?? metadata.packaging_cost) ?? DEFAULT_PACKAGING_COST_USD,
    fixedFulfillmentCost: number(metadata.fixedFulfillmentCost ?? metadata.fixed_fulfillment_cost) ?? DEFAULT_FIXED_FULFILLMENT_COST_USD,
    supplierShippingReserveUsd,
    complianceBlocked: restrictions.length > 0 || metadata.complianceBlocked === true,
    complianceFindings: restrictions,
  }
}

function aspectValue(value: unknown, names: string[]) {
  const expected = new Set(names.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, "")))
  for (const entry of records(value)) {
    const name = (text(entry.name) ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
    if (expected.has(name)) return text(entry.value)
  }
  return null
}

function comparableObservations(report: unknown) {
  const root = record(report)
  return records(root.comparableEvidence).map((entry): EbayComparableIdentityObservation | null => {
    const listingId = text(entry.comparableId)
    if (!listingId || !["EBAY_BROWSE_ACTIVE_LISTING", "EBAY_BROWSE_ESTIMATED_SALES"]
      .includes(text(entry.evidenceSource) ?? "")) return null
    const aspects = records(entry.localizedAspects).map((aspect) => ({
      name: text(aspect.name) ?? "", value: text(aspect.value) ?? "",
    })).filter((aspect) => aspect.name && aspect.value)
    return {
      listingIdentifier: listingId,
      sellerIdentifier: text(entry.sellerUsername),
      productName: text(entry.title), brand: text(entry.brand) ?? aspectValue(aspects, ["brand"]),
      manufacturer: aspectValue(aspects, ["manufacturer"]),
      gtin: text(entry.gtin) ?? aspectValue(aspects, ["upc", "ean", "gtin"]),
      mpn: text(entry.mpn) ?? aspectValue(aspects, ["mpn", "manufacturer part number"]),
      model: aspectValue(aspects, ["model"]),
      packCount: positiveInteger(aspectValue(aspects, ["number in pack", "pack quantity", "pack size"])),
      unitCount: positiveInteger(aspectValue(aspects, ["unit count", "count per pack"])),
      size: text(entry.size) ?? aspectValue(aspects, ["size", "capacity", "volume"]),
      color: text(entry.color) ?? aspectValue(aspects, ["color", "colour"]),
      scent: aspectValue(aspects, ["scent", "fragrance"]),
      variant: aspectValue(aspects, ["variant", "type", "formulation"]),
      condition: text(entry.condition) ?? "new", categoryId: text(entry.categoryId), aspects,
    }
  }).filter((entry): entry is EbayComparableIdentityObservation => Boolean(entry))
}

function sourceCoverage(rows: IdentityAttributeEvidence[]) {
  return rows.reduce<Record<string, number>>((coverage, row) => {
    coverage[row.sourceType] = (coverage[row.sourceType] ?? 0) + 1
    return coverage
  }, {})
}

function mergeNumericCoverage(current: unknown, increment: Record<string, number>) {
  const existing = record(current)
  const keys = new Set([...Object.keys(existing), ...Object.keys(increment)])
  return Object.fromEntries([...keys].map((key) =>
    [key, (number(existing[key]) ?? 0) + (increment[key] ?? 0)]))
}

function evidenceHash(row: IdentityAttributeEvidence) {
  return hash({ attribute: row.attribute, normalizedValue: row.normalizedValue,
    sourceType: row.sourceType, sourceIdentifier: row.sourceIdentifier,
    observedAt: row.observedAt, rule: row.verifiedByRule })
}

function requiredAspectsFromTaxonomy(input: {
  required: Array<{ name: string }>
  identity: CanonicalProductIdentity
}) {
  const facts = new Map<string, string | null>([
    ["brand", input.identity.brand], ["manufacturer", input.identity.manufacturer],
    ["mpn", input.identity.mpn], ["model", input.identity.model],
    ["size", input.identity.size], ["color", input.identity.color],
    ["scent", input.identity.scent], ["fragrance", input.identity.scent],
    ["condition", input.identity.condition],
    ["number in pack", input.identity.packCount ? String(input.identity.packCount) : null],
    ["unit quantity", input.identity.unitCount ? String(input.identity.unitCount) : null],
  ])
  return input.required.map((aspect) => ({ name: aspect.name,
    value: facts.get(aspect.name.toLowerCase()) ?? null }))
    .filter((entry): entry is { name: string; value: string } => Boolean(entry.value))
}

async function enrichFromOfficialSources(input: {
  variant: JsonRecord
  queue: JsonRecord
  rawSnapshot: JsonRecord
  environment: NodeJS.ProcessEnv
  catalogReader: typeof searchEbayCatalogIdentity
}) {
  const raw = record(input.rawSnapshot.raw)
  const rawProduct = record(raw.product)
  const rawVariant = record(raw.variant)
  const observedAt = text(input.variant.captured_at) ?? new Date().toISOString()
  const lunaEvidence = buildLunaStructuredIdentityEvidence({
    sourceIdentifier: `${input.variant.product_id}:${input.variant.supplier_variant_id}`,
    observedAt, title: text(input.variant.title), variantTitle: meaningfulVariant(input.variant.variant_title),
    optionValues: [rawVariant.option1, rawVariant.option2, rawVariant.option3]
      .map(text).filter((entry): entry is string => Boolean(entry)),
    vendor: text(input.variant.vendor ?? rawProduct.vendor), barcode: text(input.variant.barcode),
    metadata: record(input.variant.metadata), weight: number(input.variant.weight),
    weightUnit: text(input.variant.weight_unit),
  })
  const supplyResolved = resolveProductIdentity(lunaEvidence)
  const supplyCandidate = candidateFromRows(input.variant, input.queue, input.environment, {
    identity: supplyResolved.identity,
    logistics: conservativeLogistics({ weight: supplyResolved.identity.weight,
      dimensions: supplyResolved.identity.dimensions,
      outboundReserveUsd: DEFAULT_CONSERVATIVE_OUTBOUND_RESERVE_USD }),
    requiredAspects: [], conflicts: supplyResolved.conflicts,
  })
  const report = await runEbaySellerKeywordDemandValidation({
    productName: supplyCandidate.productName, variantTitle: supplyCandidate.variant,
    supplierSku: supplyCandidate.supplierSku, gtin: supplyCandidate.gtin,
    brand: supplyCandidate.manufacturerBrand, mpn: supplyCandidate.mpn ?? supplyCandidate.model,
    color: supplyCandidate.color, size: supplyCandidate.size, packQuantity: supplyCandidate.packCount,
  })
  const observations = comparableObservations(report)
  const classified = observations.map((row) => ({ row,
    result: classifyComparableAgainstLunaSupply({ supplyTitle: supplyCandidate.productName,
      supplyVariant: supplyCandidate.variant, supplyPackCount: supplyCandidate.packCount,
      supplySize: supplyCandidate.size, supplyColor: supplyCandidate.color,
      supplyScent: supplyCandidate.scent }, row) }))
  const exact = classified.filter((entry) => entry.result.classification === "EXACT_MATCH")
    .map((entry) => entry.row)
  const preliminaryConsensus = buildExactComparableConsensus({ exactComparables: exact, observedAt })
  const preliminary = resolveProductIdentity([...lunaEvidence, ...preliminaryConsensus.evidence]).identity
  const catalog = await input.catalogReader({ query: preliminary.normalizedProductName ?? supplyCandidate.productName ?? "",
    gtin: preliminary.validGtin, mpn: preliminary.mpn, categoryId: preliminary.categoryId })
  const selectedCatalog = selectCatalogIdentityMatches({ title: preliminary.normalizedProductName,
    gtin: preliminary.validGtin, brand: preliminary.brand, mpn: preliminary.mpn,
    packCount: preliminary.packCount }, catalog.products)
  const catalogEvidence = buildEbayCatalogIdentityEvidence(selectedCatalog.products, catalog.observedAt)
  const consensus = buildExactComparableConsensus({ exactComparables: exact, catalogEvidence, observedAt })
  const resolved = resolveProductIdentity([...lunaEvidence, ...catalogEvidence, ...consensus.evidence])
  const taxonomy = resolved.identity.categoryId || resolved.identity.normalizedProductName
    ? await getEbayTaxonomyListingIntelligence(resolved.identity.normalizedProductName ?? "",
      resolved.identity.categoryId) : null
  const identity: CanonicalProductIdentity = { ...resolved.identity,
    categoryId: resolved.identity.categoryId ?? taxonomy?.categoryId ?? null }
  const requiredAspects = requiredAspectsFromTaxonomy({ required: taxonomy?.requiredAspects ?? [], identity })
  const taxonomyEvidence: IdentityAttributeEvidence[] = taxonomy?.status === "AVAILABLE" ? [
    ...(identity.categoryId ? [{ attribute: "categoryId" as const, rawValue: identity.categoryId,
      normalizedValue: identity.categoryId, sourceType: "EBAY_CATALOG" as const,
      sourceIdentifier: sanitizedSourceIdentifier("EBAY_CATALOG", `taxonomy:${identity.categoryId}`),
      observedAt: taxonomy.observedAt ?? observedAt, confidence: .95,
      verifiedByRule: "EBAY_TAXONOMY_CATEGORY", conflictStatus: "CLEAR" as const }] : []),
    ...(requiredAspects.length ? [{ attribute: "requiredAspects" as const, rawValue: requiredAspects,
      normalizedValue: requiredAspects, sourceType: "EBAY_CATALOG" as const,
      sourceIdentifier: sanitizedSourceIdentifier("EBAY_CATALOG", `taxonomy-aspects:${identity.categoryId}`),
      observedAt: taxonomy.observedAt ?? observedAt, confidence: .95,
      verifiedByRule: "EBAY_TAXONOMY_REQUIRED_ASPECTS", conflictStatus: "CLEAR" as const }] : []),
  ] : []
  const logistics = conservativeLogistics({ weight: identity.weight, dimensions: identity.dimensions,
    outboundReserveUsd: DEFAULT_CONSERVATIVE_OUTBOUND_RESERVE_USD })
  if (!identity.totalContents.length && identity.packCount && identity.normalizedProductName) {
    identity.totalContents = canonicalContentsFromPack({
      productName: identity.normalizedProductName,
      packCount: identity.packCount,
    })
  }
  const candidate = candidateFromRows(input.variant, input.queue, input.environment, {
    identity, logistics, requiredAspects, conflicts: resolved.conflicts,
  })
  return { candidate, identity, report, catalog, catalogMatchRule: selectedCatalog.matchRule,
    catalogMatchCount: selectedCatalog.products.length,
    exactComparables: exact, comparableClassifications: classified,
    consensus, evidence: [...resolved.evidence, ...taxonomyEvidence], conflicts: resolved.conflicts,
    logistics, taxonomyStatus: taxonomy?.status ?? "NOT_REQUESTED",
    sourceCoverage: sourceCoverage([...resolved.evidence, ...taxonomyEvidence]) }
}

function sanitizedMarketPatterns(input: {
  candidate: ApprovalQueueCatalogCandidate
  report?: unknown
  discovery?: {
    origin: "EBAY_FIRST" | "LUNA_FIRST"
    lunaMatchStatus: string | null
    ebayFirstEvidence?: unknown
  }
}) {
  const root = record(input.report)
  const rawById = new Map(records(root.comparableEvidence).map((row) => [text(row.comparableId), row]))
  const exact = winnerComparablesFromKeywordReport(input.report).filter((comparable) =>
    classifyWinnerComparable({
      manufacturerBrand: input.candidate.manufacturerBrand,
      gtin: input.candidate.gtin,
      mpn: input.candidate.mpn,
      model: input.candidate.model,
      productName: input.candidate.productName,
      packCount: input.candidate.packCount,
      unitCount: input.candidate.unitCount,
      size: input.candidate.size,
      color: input.candidate.color,
      scent: input.candidate.scent,
      variant: input.candidate.variant,
      condition: input.candidate.condition,
    }, comparable.identity).classification === "EXACT_MATCH")
  const exactRows = exact.map((entry) => ({ comparable: entry,
    raw: rawById.get(entry.sourceListingId ?? null) ?? {} }))
  const active = exactRows.filter(({ comparable }) => comparable.source !==
    "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY")
  const sold = exactRows.filter(({ comparable }) => comparable.source ===
    "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY")
  const sellerKey = (row: JsonRecord) => text(row.sellerUsername)?.toLocaleLowerCase("en-US") ?? null
  const sellerCounts = new Map<string, number>()
  for (const { raw } of active) {
    const key = sellerKey(raw)
    if (key) sellerCounts.set(key, (sellerCounts.get(key) ?? 0) + 1)
  }
  const activeSellerCount = sellerCounts.size
  const verifiedSoldSellerCount = new Set(sold.map(({ raw }) => sellerKey(raw)).filter(Boolean)).size
  const estimated = active.filter(({ comparable }) =>
    comparable.source === "EBAY_BROWSE_ESTIMATED_SALES")
  const estimatedSoldSellerCount = new Set(estimated.map(({ raw }) => sellerKey(raw)).filter(Boolean)).size
  const totalVerifiedSoldQuantity = sold.reduce((sum, { comparable }) =>
    sum + (comparable.confirmedSoldQuantity ?? 0), 0)
  const totalEstimatedSoldQuantity = estimated.reduce((sum, { comparable }) =>
    sum + (comparable.estimatedSoldQuantity ?? 0), 0)
  const percent = (count: number, total: number) => total
    ? Math.round(count / total * 10_000) / 100 : null
  const freeShipping = active.filter(({ raw }) => number(raw.shippingCost) === 0).length
  const returns = active.filter(({ raw }) => raw.returnsAccepted === true).length
  const sellerConcentrationPercent = active.length && sellerCounts.size
    ? percent(Math.max(...sellerCounts.values()), active.length) : null
  const titles = exactRows.map(({ raw }) => text(raw.title)).filter((value): value is string => Boolean(value))
  const brand = input.candidate.manufacturerBrand?.toLocaleLowerCase("en-US") ?? ""
  const structuralPatterns = [
    brand && titles.some((title) => title.toLocaleLowerCase("en-US").startsWith(brand))
      ? "BRAND_EARLY_IN_EXACT_TITLES" : null,
    titles.some((title) => /\b(?:pack|set|case)\s+of\s+\d+|\b\d+\s*(?:pack|pk|set)\b/i.test(title))
      ? "PACK_COUNT_EXPLICIT_IN_EXACT_TITLES" : null,
    titles.some((title) => /\b\d+(?:\.\d+)?\s*(?:oz|ml|lb|in|ct|count)\b/i.test(title))
      ? "SIZE_OR_COUNT_EXPLICIT_IN_EXACT_TITLES" : null,
  ].filter((value): value is string => Boolean(value))
  const ebayFirst = record(input.discovery?.ebayFirstEvidence)
  const crossSourceCorroborated = input.discovery?.origin === "EBAY_FIRST" &&
    input.discovery.lunaMatchStatus === "EXACT_LUNA_MATCH" && active.length > 0
  const evidenceBasis = sold.length
    ? "CONFIRMED_SOLD_EXACT"
    : estimated.length
      ? "ESTIMATED_MOVEMENT_EXACT_SEPARATED"
      : active.length ? "ACTIVE_EXACT_ONLY" : "INSUFFICIENT_EVIDENCE"
  return {
    marketEvidence: {
      activeSellerCount,
      verifiedSoldSellerCount,
      estimatedSoldSellerCount,
      totalVerifiedSoldQuantity,
      totalEstimatedSoldQuantity,
      evidenceBasis,
      discoveryOrigin: input.discovery?.origin ?? "LUNA_FIRST",
      ebayFirstDemandEvidence: text(ebayFirst.demandEvidence),
      crossSourceCorroborated,
      activeAndSoldSeparated: true,
    },
    sellerPatterns: {
      activeSellerCount,
      verifiedSoldSellerCount,
      freeShippingPrevalencePercent: percent(freeShipping, active.length),
      returnsPrevalencePercent: percent(returns, active.length),
      sellerConcentrationPercent,
      handlingPatterns: [],
      quantityDiscountPatterns: [],
      offerPatterns: [],
      visibleTrustElements: [
        activeSellerCount >= 2 ? "MULTI_SELLER_ACTIVE_MARKET" : null,
        active.some(({ raw }) => (number(raw.sellerFeedbackPercentage) ?? 0) >= 98)
          ? "HIGH_SELLER_FEEDBACK_VISIBLE" : null,
      ].filter((value): value is string => Boolean(value)),
    },
    titleStructurePatterns: structuralPatterns,
  }
}

function winnerInput(
  candidate: ApprovalQueueCatalogCandidate,
  accountKey: string,
  report?: unknown,
  discovery?: {
    origin: "EBAY_FIRST" | "LUNA_FIRST"
    lunaMatchStatus: string | null
    ebayFirstEvidence?: unknown
  },
): WinnerEvidenceInput {
  const shipping = (candidate.outboundShippingCost ?? 0) + (candidate.supplierShippingReserveUsd ?? 0)
  const includedContents = candidate.exactContents
  const marketPatterns = sanitizedMarketPatterns({ candidate, report, discovery })
  // Luna price and inventory belong to one supplier offer. `packCount` is the
  // customer-visible content of that offer, not a multiplier for cost/stock.
  const supplierUnitsPerOffer = 1
  const offerCapacity = candidate.inventoryQuantity
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
    supplierPackageCost: candidate.supplierCost,
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
      titleStructurePatterns: marketPatterns.titleStructurePatterns,
      unsupportedTerms: [],
      sellerPatterns: marketPatterns.sellerPatterns,
      locale: "en-US",
    },
    marketEvidence: marketPatterns.marketEvidence,
    packStrategyEvidence: {
      offers: [{
        packCount: candidate.packCount,
        unitCountPerItem: candidate.unitCount,
        exactContents: includedContents,
        offerGtin: candidate.packCount === 1 && candidate.gtinValid ? candidate.gtin : null,
        offerGtinVerified: candidate.packCount === 1 && candidate.gtinValid,
        cost: candidate.supplierCost,
        shippingCost: shipping,
        stockRequired: supplierUnitsPerOffer,
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
      evidenceScope: entry.evidenceScope === "MARKET_WIDE_SOLD_EVIDENCE" ||
        entry.evidenceScope === "OWN_ACCOUNT_SOLD_EVIDENCE"
        ? entry.evidenceScope as NonNullable<WinnerComparableInput["evidenceScope"]>
        : null,
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

function separateActiveAndEstimatedComparables(report: unknown) {
  return winnerComparablesFromKeywordReport(report).flatMap((entry) =>
    entry.source === "EBAY_BROWSE_ESTIMATED_SALES"
      ? [{ ...entry, source: "EBAY_BROWSE_ACTIVE_LISTING" as const,
        estimatedSoldQuantity: null }, entry]
      : [entry])
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
  strategicIntelligence?: ReturnType<typeof buildDualSourceOpportunityIntelligence>
}) {
  return {
    product: {
      name: input.productName ?? input.candidate.productName,
      supplierSku: input.candidate.supplierSku,
      supplierVariantId: input.candidate.supplierVariantId,
      supplierProductId: input.candidate.supplierProductId,
      lunaUrl: input.candidate.productUrl,
      authorizedImageUrl: input.candidate.imageAuthorized ? input.candidate.imageUrl : null,
      imageAuthorizationSource: input.candidate.imageAuthorizationSource ?? null,
      variant: input.candidate.variant,
      categoryId: input.candidate.categoryId,
      categoryName: input.candidate.categoryName,
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
    strategicIntelligence: input.strategicIntelligence ?? null,
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
  marketReport?: unknown
  reviewedSoldEvidence?: StoredOfficialSoldEvidence[]
  discovery?: { origin: "EBAY_FIRST" | "LUNA_FIRST"; lunaMatchStatus: string | null;
    ebayFirstEvidence?: unknown }
}) {
  const targetIdentity = {
    manufacturerBrand: input.candidate.manufacturerBrand,
    gtin: input.candidate.gtin,
    mpn: input.candidate.mpn,
    model: input.candidate.model,
    productName: input.candidate.productName,
    packCount: input.candidate.packCount,
    unitCount: input.candidate.unitCount,
    size: input.candidate.size,
    color: input.candidate.color,
    scent: input.candidate.scent,
    variant: input.candidate.variant,
    condition: input.candidate.condition,
  }
  const importedSold = officialSoldEvidenceComparablesForTarget({
    targetIdentity,
    rows: input.reviewedSoldEvidence ?? [],
    targetSupplierVariantId: input.candidate.supplierVariantId,
  })
  const comparables = input.comparables === undefined
    ? undefined
    : [...input.comparables, ...importedSold]
  const generated = await createWinnerEvidenceDecisionPackage(
    input.supabase,
    { ...winnerInput(input.candidate, input.accountKey, input.marketReport, input.discovery),
      comparables },
    {
      useOfficialRead: comparables === undefined,
      persist: true,
      candidateRecordId: null,
    },
  )
  if (!generated.packageId) throw new Error("TOP10_DECISION_PACKAGE_PERSIST_REQUIRED")
  const row = await readDecisionRow(input.supabase, input.accountKey, generated.packageId)
  const { evidence, pack } = evidenceFromPackage(row, input.candidate, input.now)
  const strategicIntelligence = buildDualSourceOpportunityIntelligence({
    origin: input.discovery?.origin ?? "LUNA_FIRST",
    lunaMatchStatus: input.discovery?.lunaMatchStatus,
    activeExactCount: evidence.activeExactCount,
    soldExactCount: evidence.soldExactCount,
    estimatedDemandCount: evidence.estimatedDemandCount,
    activeSellerCount: number(record(input.marketReport).sellersAnalyzed),
  })
  evidence.scores.crossSourceCorroboration = strategicIntelligence.score
  const packagePayload = record(row.package_payload)
  const visualAnalysis = record(packagePayload.visualEvidenceAnalysis)
  const visualSummary = record(visualAnalysis.visualEvidenceSummary)
  const visualConfidence = record(visualAnalysis.visualPatternConfidence)
  const listingAiIntake = record(packagePayload.listingAiIntake)
  const optimizationEvidence = {
    marketEvidence: record(packagePayload.marketEvidence),
    sellerPatterns: record(listingAiIntake.sellerPatterns),
    titleStructurePatterns: strings(listingAiIntake.titleStructurePatterns),
    visualEvidence: {
      status: text(visualAnalysis.status) ?? "N/D",
      activeExactSampleSize: number(visualSummary.activeExactSampleSize) ?? 0,
      soldExactSampleSize: number(visualSummary.soldOrCompletedExactSampleSize) ?? 0,
      usableSampleSize: number(visualConfidence.sampleSize) ?? 0,
      confidence: text(visualConfidence.level) ?? "INSUFFICIENT",
      imageMetadataOnly: true,
      competitorImagesDownloaded: 0,
      competitorImagesCopied: 0,
    },
    competitorTitlesStored: false,
    competitorDescriptionsStored: false,
    competitorImagesStored: false,
  }
  const classification = evaluateApprovalQueueDecision(evidence)
  return { row, evidence, pack, classification, strategicIntelligence, optimizationEvidence }
}

async function loadQueueRows(supabase: SupabaseClient, productIds: string[]) {
  if (!productIds.length) return new Map<string, JsonRecord>()
  const { data, error } = await supabase.from("ebay_luna_opportunity_queue")
    .select("market_radar_product_id,supplier_variant_id,keyword_structure,assessment,decision,opportunity_score,hard_gates,evidence_guards")
    .in("market_radar_product_id", productIds)
  if (error) throw new Error("TOP10_EXISTING_QUEUE_READ_FAILED")
  return new Map((data ?? []).map((row) => [`${row.market_radar_product_id}:${row.supplier_variant_id ?? ""}`, record(row)]))
}

async function loadSnapshotRows(supabase: SupabaseClient, snapshotIds: string[]) {
  if (!snapshotIds.length) return new Map<string, JsonRecord>()
  const { data, error } = await supabase.from("market_radar_snapshots")
    .select("id,raw").in("id", snapshotIds)
  if (error) throw new Error("TOP20_LUNA_STRUCTURED_SOURCE_READ_FAILED")
  return new Map((data ?? []).map((row) => [String(row.id), record(row)]))
}

async function persistIdentityEnrichment(input: {
  supabase: SupabaseClient
  runId: string
  accountKey: string
  candidate: ApprovalQueueCatalogCandidate
  result: Awaited<ReturnType<typeof enrichFromOfficialSources>>
  now: Date
}) {
  const status = input.result.conflicts.length ? "CONFLICTED" : "RESOLVED"
  const identityFingerprint = buildProductIdentityFingerprint({
    manufacturerBrand: input.result.identity.brand,
    gtin: input.result.identity.validGtin, mpn: input.result.identity.mpn,
    model: input.result.identity.model, productName: input.result.identity.normalizedProductName,
    packCount: input.result.identity.packCount, unitCount: input.result.identity.unitCount,
    size: input.result.identity.size, color: input.result.identity.color,
    scent: input.result.identity.scent, variant: input.result.identity.variant,
    condition: input.result.identity.condition,
  }).fingerprint
  const { data, error } = await input.supabase.from("marketplace_product_identity_enrichments")
    .upsert({ run_id: input.runId, marketplace_account_key: input.accountKey, marketplace: MARKETPLACE,
      market_radar_product_id: input.candidate.marketRadarProductId,
      supplier_product_id: input.candidate.supplierProductId,
      supplier_variant_id: input.candidate.supplierVariantId,
      supplier_sku: input.candidate.supplierSku,
      enrichment_version: LUNA_PRODUCT_IDENTITY_ENRICHMENT_VERSION, status,
      identity_fingerprint: identityFingerprint,
      canonical_identity: input.result.identity, logistics: input.result.logistics,
      conflict_attributes: input.result.conflicts, reason_codes: [],
      source_coverage: input.result.sourceCoverage, retry_count: 0, next_retry_at: null,
      last_error_code: null, observed_at: input.now.toISOString(),
      stale_after: new Date(input.now.getTime() + FRESHNESS_MS).toISOString(),
      updated_at: input.now.toISOString() },
    { onConflict: "run_id,market_radar_product_id,supplier_variant_id" }).select("id").single()
  if (error || !data) throw new Error("TOP20_IDENTITY_ENRICHMENT_PERSIST_FAILED")
  if (input.result.evidence.length) {
    const rows = input.result.evidence.map((row) => ({ enrichment_id: data.id,
      marketplace_account_key: input.accountKey, marketplace: MARKETPLACE,
      attribute_name: row.attribute, raw_value: row.rawValue ?? null,
      normalized_value: row.normalizedValue ?? null, source_type: row.sourceType,
      source_identifier: row.sourceIdentifier, observed_at: row.observedAt,
      confidence: row.confidence, verified_by_rule: row.verifiedByRule,
      conflict_status: row.conflictStatus, evidence_hash: evidenceHash(row) }))
    const { error: evidenceError } = await input.supabase
      .from("marketplace_product_identity_attribute_evidence")
      .upsert(rows, { onConflict: "enrichment_id,evidence_hash", ignoreDuplicates: true })
    if (evidenceError) throw new Error("TOP20_IDENTITY_PROVENANCE_PERSIST_FAILED")
  }
  const { error: attemptsError } = await input.supabase.from("marketplace_product_identity_source_attempts")
    .insert([
      { enrichment_id: data.id, marketplace_account_key: input.accountKey, marketplace: MARKETPLACE,
        source_type: "LUNA_STRUCTURED", status: "AVAILABLE", retry_number: 0,
        started_at: input.now.toISOString(), completed_at: input.now.toISOString() },
      { enrichment_id: data.id, marketplace_account_key: input.accountKey, marketplace: MARKETPLACE,
        source_type: "EBAY_BROWSE", status: input.result.exactComparables.length ? "AVAILABLE" : "NO_MATCH",
        retry_number: 0, started_at: input.now.toISOString(), completed_at: input.now.toISOString() },
      { enrichment_id: data.id, marketplace_account_key: input.accountKey, marketplace: MARKETPLACE,
        source_type: "EBAY_CATALOG", status: input.result.catalog.status, retry_number: 0,
        started_at: input.now.toISOString(), completed_at: input.now.toISOString() },
    ])
  if (attemptsError) throw new Error("TOP20_IDENTITY_SOURCE_AUDIT_PERSIST_FAILED")
  return data.id as string
}

const TARGET_CATALOG_PAGE_SIZE = 1_000
const TARGET_INSERT_PAGE_SIZE = 250

async function loadTop20TargetCatalog(supabase: SupabaseClient) {
  const rows: JsonRecord[] = []
  for (let offset = 0; ; offset += TARGET_CATALOG_PAGE_SIZE) {
    const { data, error } = await supabase.from("market_radar_latest_variants")
      .select("product_id,supplier_product_id,supplier_variant_id,sku,barcode,title,variant_title,vendor,product_type,tags,product_url,featured_image_url,image_urls,metadata,snapshot_id,price,available,inventory_quantity,weight,weight_unit,captured_at,seller_scan_priority_score")
      .eq("source_key", "lunaportex")
      .order("seller_scan_priority_score", { ascending: false })
      .order("product_id", { ascending: true })
      .range(offset, offset + TARGET_CATALOG_PAGE_SIZE - 1)
    if (error) throw new Error("TOP20_TARGET_CATALOG_READ_FAILED")
    rows.push(...(data ?? []).map(record))
    if ((data ?? []).length < TARGET_CATALOG_PAGE_SIZE) break
  }
  return rows
}

async function loadPriorIntelligenceProductIds(supabase: SupabaseClient) {
  const ids: string[] = []
  for (let offset = 0; ; offset += TARGET_CATALOG_PAGE_SIZE) {
    const { data, error } = await supabase.from("ebay_luna_opportunity_queue")
      .select("market_radar_product_id,opportunity_score")
      .order("opportunity_score", { ascending: false, nullsFirst: false })
      .range(offset, offset + TARGET_CATALOG_PAGE_SIZE - 1)
    if (error) throw new Error("TOP20_PRIOR_INTELLIGENCE_READ_FAILED")
    ids.push(...(data ?? []).map((row) => text(row.market_radar_product_id)).filter(
      (value): value is string => Boolean(value),
    ))
    if ((data ?? []).length < TARGET_CATALOG_PAGE_SIZE) break
  }
  return ids
}

async function ensureTop20RunTargets(
  supabase: SupabaseClient,
  accountKey: string,
  runId: string,
  now: Date,
) {
  const { count, error: countError } = await supabase.from("marketplace_listing_approval_queue_scan_targets")
    .select("id", { count: "exact", head: true }).eq("run_id", runId)
    .eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
  if (countError) throw new Error("TOP20_TARGET_COUNT_FAILED")
  if ((count ?? 0) > 0) return count ?? 0

  const [catalogRows, priorIds] = await Promise.all([
    loadTop20TargetCatalog(supabase),
    loadPriorIntelligenceProductIds(supabase),
  ])
  const catalog: Top20TargetCandidate[] = catalogRows.map((row) => ({
    productId: text(row.product_id) ?? "",
    supplierProductId: text(row.supplier_product_id),
    supplierVariantId: text(row.supplier_variant_id),
    supplierSku: text(row.sku),
    priorityScore: number(row.seller_scan_priority_score) ?? 0,
  })).filter((row) => row.productId)
  const radarProductIds = [...catalog]
    .sort((left, right) => right.priorityScore - left.priorityScore || left.productId.localeCompare(right.productId))
    .slice(0, 5).map((row) => row.productId)
  const manifest = buildTop20TargetManifest({
    catalog,
    radarProductIds,
    priorIntelligenceProductIds: priorIds,
  })
  for (let offset = 0; offset < manifest.length; offset += TARGET_INSERT_PAGE_SIZE) {
    const page = manifest.slice(offset, offset + TARGET_INSERT_PAGE_SIZE).map((target) => ({
      run_id: runId,
      marketplace_account_key: accountKey,
      marketplace: MARKETPLACE,
      ordinal: target.ordinal,
      source_priority: target.source,
      market_radar_product_id: target.productId,
      supplier_product_id: target.supplierProductId,
      supplier_variant_id: target.supplierVariantId,
      supplier_sku: target.supplierSku,
      deduplication_key_hash: target.deduplicationKeyHash,
      status: "PENDING",
      updated_at: now.toISOString(),
    }))
    const { error } = await supabase.from("marketplace_listing_approval_queue_scan_targets")
      .upsert(page, { onConflict: "run_id,deduplication_key_hash", ignoreDuplicates: true })
    if (error) throw new Error("TOP20_TARGET_MANIFEST_PERSIST_FAILED")
  }

  const priorityCounts = manifest.reduce<Record<string, number>>((counts, target) => {
    counts[target.source] = (counts[target.source] ?? 0) + 1
    return counts
  }, {})
  const { error: runError } = await supabase.from("marketplace_listing_approval_queue_runs").update({
    catalog_total: manifest.length,
    priority_counts: priorityCounts,
    last_activity_at: now.toISOString(),
    updated_at: now.toISOString(),
  }).eq("id", runId).eq("marketplace_account_key", accountKey)
  if (runError) throw new Error("TOP20_TARGET_RUN_UPDATE_FAILED")
  return manifest.length
}

function ebayFirstCategorySeeds(environment: NodeJS.ProcessEnv) {
  return [...new Set((environment.EBAY_LISTING_TOP20_EBAY_FIRST_CATEGORY_IDS ??
    environment.EBAY_LUNA_BEST_SELLING_CATEGORY_IDS ?? "").split(",")
    .map((entry) => entry.trim()).filter((entry) => /^\d+$/.test(entry)))].slice(0, 8)
}

function hybridLunaCandidate(row: JsonRecord, environment: NodeJS.ProcessEnv): HybridLunaCandidate | null {
  const candidate = candidateFromRows(row, {}, environment)
  if (!candidate.marketRadarProductId || !candidate.supplierProductId ||
    !candidate.supplierVariantId || !candidate.supplierSku || !candidate.productName) return null
  return {
    productId: candidate.marketRadarProductId,
    supplierProductId: candidate.supplierProductId,
    supplierVariantId: candidate.supplierVariantId,
    supplierSku: candidate.supplierSku,
    productName: candidate.productName,
    brand: candidate.manufacturerBrand,
    gtin: candidate.gtinValid ? candidate.gtin : null,
    mpn: candidate.mpn,
    model: candidate.model,
    size: candidate.size,
    color: candidate.color,
    scent: candidate.scent,
    variant: candidate.variant,
    packCount: candidate.packCount,
    available: candidate.available === true &&
      (candidate.inventoryQuantity === null || candidate.inventoryQuantity > 0),
  }
}

function hybridEbayProduct(input: {
  signal: { categoryId: string; epid: string | null; title: string;
    averageRating: number | null; ratingCount: number | null; reviewCount: number | null }
  catalog: EbayCatalogIdentityProduct
  observedAt: string
}): HybridEbayProduct {
  const ratingEvidence = Math.min(20, Math.log10(Math.max(1,
    Number(input.signal.ratingCount ?? input.signal.reviewCount ?? 0))) * 8)
  return {
    sourceKey: `${input.signal.categoryId}:${input.signal.epid ?? hash(input.signal.title)}`,
    categoryId: input.catalog.categoryId ?? input.signal.categoryId,
    title: input.catalog.title ?? input.signal.title,
    brand: input.catalog.brand,
    gtins: input.catalog.gtins,
    mpns: input.catalog.mpns,
    aspects: input.catalog.aspects,
    // Marketing BEST_SELLING is a product-level demand signal, not a confirmed sale.
    demandEvidence: "ESTIMATED_MOVEMENT",
    demandConfidence: Math.round(Math.min(70, 40 + ratingEvidence)),
    sellerCount: null,
    activeListingCount: null,
    landedPriceRange: null,
    observedAt: input.observedAt,
  }
}

async function deriveEbayFirstCategories(input: {
  catalog: JsonRecord[]
  environment: NodeJS.ProcessEnv
}) {
  const configured = ebayFirstCategorySeeds(input.environment)
  if (configured.length) return configured
  const seeds = input.catalog.filter((row) => text(row.title))
    .sort((left, right) => (number(right.seller_scan_priority_score) ?? 0) -
      (number(left.seller_scan_priority_score) ?? 0) ||
      String(left.product_id).localeCompare(String(right.product_id)))
    .slice(0, 3)
  const results = await Promise.all(seeds.map((seed) =>
    getEbayTaxonomyListingIntelligence(text(seed.title) ?? "")))
  const derived = results.filter((taxonomy) => taxonomy.status === "AVAILABLE")
    .map((taxonomy) => taxonomy.categoryId).filter((entry): entry is string => Boolean(entry))
  return [...new Set(derived)]
}

async function ensureEbayFirstDiscovery(input: {
  supabase: SupabaseClient
  accountKey: string
  run: JsonRecord
  environment: NodeJS.ProcessEnv
  now: Date
}) {
  if (["COMPLETED", "UNAVAILABLE"]
    .includes(text(input.run.ebay_first_status) ?? "")) return
  const { error: startError } = await input.supabase.from("marketplace_listing_approval_queue_runs")
    .update({ ebay_first_status: "RUNNING", last_activity_at: input.now.toISOString(),
      updated_at: input.now.toISOString() })
    .eq("id", input.run.id).eq("marketplace_account_key", input.accountKey)
  if (startError) throw new Error("TOP20_EBAY_FIRST_START_FAILED")
  try {
    const catalog = await loadTop20TargetCatalog(input.supabase)
    const luna = catalog.map((row) => hybridLunaCandidate(row, input.environment))
      .filter((entry): entry is HybridLunaCandidate => Boolean(entry?.available))
    const categories = await deriveEbayFirstCategories({ catalog, environment: input.environment })
    if (!categories.length) {
      await input.supabase.from("marketplace_listing_approval_queue_runs").update({
        ebay_first_status: "UNAVAILABLE", ebay_first_category_count: 0,
        ebay_first_signal_count: 0, ebay_first_exact_luna_match_count: 0,
        ebay_first_match_counts: {}, ebay_first_observed_at: input.now.toISOString(),
        updated_at: input.now.toISOString(),
      }).eq("id", input.run.id).eq("marketplace_account_key", input.accountKey)
      return
    }
    const discoveries = await Promise.all(categories.map(async (categoryId) => ({
      categoryId, ...await discoverEbayBestSellingProducts(categoryId),
    })))
    const sourceStatusCounts = discoveries.reduce<Record<string, number>>((counts, entry) => {
      const key = `SOURCE_${entry.status}`
      counts[key] = (counts[key] ?? 0) + 1
      return counts
    }, {})
    const signals = discoveries.flatMap((entry) => entry.products).slice(0, 9)
    const products: HybridEbayProduct[] = []
    for (const page of chunks(signals, 3)) {
      const catalogResults = await Promise.all(page.map(async (signal) => ({ signal,
        result: await searchEbayCatalogIdentity({ query: signal.title,
          categoryId: signal.categoryId }) })))
      for (const { signal, result } of catalogResults) {
        for (const product of result.products.slice(0, 3)) {
          products.push(hybridEbayProduct({ signal, catalog: product,
            observedAt: result.observedAt }))
        }
      }
    }
    const matches = matchEbayFirstProductsToLuna(products, luna)
    const matchCounts = matches.reduce<Record<string, number>>((counts, entry) => {
      counts[entry.match.status] = (counts[entry.match.status] ?? 0) + 1
      return counts
    }, {})
    const exactByCandidate = new Map<string, (typeof matches)[number]>()
    for (const entry of matches.filter((candidate) =>
      candidate.match.status === "EXACT_LUNA_MATCH" && candidate.match.candidate)) {
      const key = `${entry.match.candidate?.productId}:${entry.match.candidate?.supplierVariantId}`
      const previous = exactByCandidate.get(key)
      if (!previous || entry.match.score > previous.match.score) exactByCandidate.set(key, entry)
    }
    const ranked = [...exactByCandidate.values()].sort((left, right) =>
      right.product.demandConfidence - left.product.demandConfidence ||
      right.match.score - left.match.score ||
      String(left.match.candidate?.supplierSku).localeCompare(String(right.match.candidate?.supplierSku)))
    const { count: currentPreselected, error: currentPreselectedError } = await input.supabase
      .from("marketplace_listing_approval_queue_scan_targets")
      .select("id", { count: "exact", head: true }).eq("run_id", input.run.id)
      .eq("marketplace_account_key", input.accountKey).eq("preselected", true)
    if (currentPreselectedError) throw new Error("TOP20_EBAY_FIRST_PRESELECTION_COUNT_FAILED")
    const promotionCapacity = Math.max(0, 100 - (currentPreselected ?? 0))
    for (const [index, entry] of ranked.entries()) {
      const candidate = entry.match.candidate
      if (!candidate) continue
      const { error } = await input.supabase.from("marketplace_listing_approval_queue_scan_targets")
        .update({ discovery_strategy: "EBAY_FIRST", ebay_first_rank: index + 1,
          ebay_first_luna_match_status: "EXACT_LUNA_MATCH",
          ebay_first_evidence_snapshot: ebayFirstEvidenceSnapshot({
            product: entry.product, match: entry.match, rank: index + 1,
          }), updated_at: input.now.toISOString() })
        .eq("run_id", input.run.id).eq("marketplace_account_key", input.accountKey)
        .eq("market_radar_product_id", candidate.productId)
        .eq("supplier_variant_id", candidate.supplierVariantId)
      if (error) throw new Error("TOP20_EBAY_FIRST_TARGET_PERSIST_FAILED")
      if (index < promotionCapacity) {
        const { error: promoteError } = await input.supabase
          .from("marketplace_listing_approval_queue_scan_targets")
          .update({ status: "PRESELECTED", preselected: true, processing_phase: null,
            lease_owner: null, lease_expires_at: null, next_retry_at: null,
            last_error_code: null, updated_at: input.now.toISOString() })
          .eq("run_id", input.run.id).eq("marketplace_account_key", input.accountKey)
          .eq("market_radar_product_id", candidate.productId)
          .eq("supplier_variant_id", candidate.supplierVariantId)
          .in("status", ["PENDING", "DISCOVERED", "SKIPPED"])
        if (promoteError) throw new Error("TOP20_EBAY_FIRST_PRESELECTION_FAILED")
      }
    }
    const { count: preselectedCount, error: preselectedError } = await input.supabase
      .from("marketplace_listing_approval_queue_scan_targets")
      .select("id", { count: "exact", head: true }).eq("run_id", input.run.id)
      .eq("marketplace_account_key", input.accountKey).eq("preselected", true)
    if (preselectedError) throw new Error("TOP20_EBAY_FIRST_PRESELECTION_COUNT_FAILED")
    const available = discoveries.some((entry) => entry.status === "AVAILABLE")
    const { error: finishError } = await input.supabase.from("marketplace_listing_approval_queue_runs")
      .update({ ebay_first_status: available ? "COMPLETED" : "UNAVAILABLE",
        ebay_first_category_count: categories.length, ebay_first_signal_count: products.length,
        ebay_first_exact_luna_match_count: ranked.length,
        preselected_count: preselectedCount ?? Number(input.run.preselected_count ?? 0),
        ebay_first_match_counts: { ...sourceStatusCounts, ...matchCounts },
        ebay_first_observed_at: input.now.toISOString(), last_activity_at: input.now.toISOString(),
        updated_at: input.now.toISOString() })
      .eq("id", input.run.id).eq("marketplace_account_key", input.accountKey)
    if (finishError) throw new Error("TOP20_EBAY_FIRST_RUN_PERSIST_FAILED")
  } catch (error) {
    await input.supabase.from("marketplace_listing_approval_queue_runs").update({
      ebay_first_status: "FAILED_RECOVERABLE", ebay_first_observed_at: input.now.toISOString(),
      last_activity_at: input.now.toISOString(), updated_at: input.now.toISOString(),
    }).eq("id", input.run.id).eq("marketplace_account_key", input.accountKey)
    // The official Luna-first direction remains available; eBay-first is retried on recovery.
    if (isTop20RateLimitError(error)) return
  }
}

async function claimRun(
  supabase: SupabaseClient,
  accountKey: string,
  total: number,
  workerId: string,
  now: Date,
  requestedRunId?: string,
  expectedBatch?: number,
) {
  const base = supabase.from("marketplace_listing_approval_queue_runs")
    .select("*").eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
  const { data: existing } = requestedRunId
    ? await base.eq("id", requestedRunId).maybeSingle()
    : await base.in("status", ["RUNNING", "PARTIAL"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
  const leaseExpires = new Date(now.getTime() + LEASE_MS).toISOString()
  if (existing) {
    const currentBatch = Number(existing.current_batch ?? 0)
    if (expectedBatch !== undefined) {
      if (!Number.isInteger(expectedBatch) || expectedBatch < 1) {
        throw new Error("TOP20_CONTINUATION_BATCH_REJECTED")
      }
      if (currentBatch >= expectedBatch) return { run: existing, duplicate: true }
      if (currentBatch + 1 !== expectedBatch) throw new Error("TOP20_CONTINUATION_BATCH_REJECTED")
    }
    const activeLease = existing.status === "RUNNING" && Date.parse(existing.lease_expires_at ?? "") > now.getTime()
    if (activeLease && existing.lease_owner !== workerId) throw new Error("TOP10_SCAN_LEASE_ACTIVE")
    const { data, error } = await supabase.from("marketplace_listing_approval_queue_runs")
      .update({ status: "RUNNING", lease_owner: workerId, lease_expires_at: leaseExpires,
        automation_status: "RUNNING", catalog_total: total,
        lock_version: Number(existing.lock_version) + 1,
        current_batch: expectedBatch ?? currentBatch + 1,
        continuation_attempt_count: Number(existing.continuation_attempt_count ?? 0) + 1,
        continuation_dispatch_status: "DISPATCHING",
        last_activity_at: now.toISOString(), updated_at: now.toISOString() })
      .eq("id", existing.id).eq("lock_version", existing.lock_version).select("*").maybeSingle()
    if (error || !data) throw new Error("TOP10_SCAN_CONCURRENT_UPDATE")
    return { run: data, duplicate: false }
  }
  const { data, error } = await supabase.from("marketplace_listing_approval_queue_runs").insert({
    marketplace_account_key: accountKey,
    marketplace: MARKETPLACE,
    status: "RUNNING",
    automation_status: "RUNNING",
    catalog_total: total,
    lease_owner: workerId,
    lease_expires_at: leaseExpires,
    current_batch: 1,
    continuation_attempt_count: 1,
    continuation_generation: 1,
    continuation_dispatch_status: "DISPATCHING",
    enrichment_version: TOP20_QUALIFICATION_POLICY_VERSION,
    last_activity_at: now.toISOString(),
    scheduling_enabled: false,
  }).select("*").single()
  if (error || !data) throw new Error("TOP10_SCAN_RUN_CREATE_FAILED")
  return { run: data, duplicate: false }
}

export async function startListingAiApprovalQueueScan(input: {
  supabase: SupabaseClient
  accountKey: string
  now?: Date
  environment?: NodeJS.ProcessEnv
}) {
  const now = input.now ?? new Date()
  const configuration = getTop20AutomationConfiguration(input.environment ?? process.env)
  const { data: latest, error } = await input.supabase.from("marketplace_listing_approval_queue_runs")
    .select("*").eq("marketplace_account_key", input.accountKey).eq("marketplace", MARKETPLACE)
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error("TOP20_SCAN_STATUS_READ_FAILED")

  const leaseActive = latest && Date.parse(latest.lease_expires_at ?? "") > now.getTime()
  if (latest && isTop20AutomationActive(latest.automation_status) && leaseActive) {
    return { runId: latest.id, status: latest.automation_status as Top20AutomationStatus,
      shouldSchedule: false, continuationToken: null, alreadyRunning: true,
      openAiCalls: 0, ebayWrites: 0, canPublish: false }
  }
  if (latest?.automation_status === "PAUSED_RATE_LIMIT" &&
    Date.parse(latest.next_continuation_at ?? "") > now.getTime()) {
    return { runId: latest.id, status: "PAUSED_RATE_LIMIT" as const,
      shouldSchedule: false, continuationToken: null,
      nextContinuationAt: latest.next_continuation_at,
      openAiCalls: 0, ebayWrites: 0, canPublish: false }
  }
  const emptyCompletionNeedsRecovery = Boolean(latest &&
    Number(record(latest.diagnostic_counts).PRESELECTION_POLICY_V2 ?? 0) !== 1 &&
    shouldRecoverEmptyTop20Completion({
      automationStatus: latest.automation_status,
      catalogTotal: Number(latest.catalog_total ?? 0),
      discoveryExamined: Number(latest.discovery_examined_count ?? 0),
      preselected: Number(latest.preselected_count ?? 0),
      deepAnalyzed: Number(latest.deep_analyzed_count ?? 0),
      ready: Number(latest.ready_count ?? 0),
    }))
  const incompleteLoop1NeedsRecovery = Boolean(latest &&
    shouldRecoverIncompleteTop20Completion({
      automationStatus: latest.automation_status,
      preselected: Number(latest.preselected_count ?? 0),
      deepAnalyzed: Number(latest.deep_analyzed_count ?? 0),
    }))
  const policyUpgradeNeedsReanalysis = Boolean(latest &&
    shouldReanalyzeTop20ForPolicyUpgrade({
      automationStatus: latest.automation_status,
      preselected: Number(latest.preselected_count ?? 0),
      persistedVersion: latest.enrichment_version,
      currentVersion: TOP20_QUALIFICATION_POLICY_VERSION,
    }))
  const soldEvidenceNeedsReanalysis = Boolean(latest?.sold_evidence_version &&
    latest.sold_evidence_version !== latest.sold_evidence_applied_version)
  const reanalysisScope = top20ReanalysisScope({
    policyUpgradeNeedsReanalysis,
    soldEvidenceNeedsReanalysis,
  })
  const resumeNeedsReanalysis = reanalysisScope !== "NONE"
  const latestFresh = latest?.automation_status === "COMPLETED" &&
    !emptyCompletionNeedsRecovery && !incompleteLoop1NeedsRecovery &&
    !resumeNeedsReanalysis &&
    Date.parse(latest.updated_at ?? "") > now.getTime() - FRESHNESS_MS
  if (latestFresh) {
    return { runId: latest.id, status: "COMPLETED" as const, shouldSchedule: false,
      continuationToken: null, reusedFresh: true,
      openAiCalls: 0, ebayWrites: 0, canPublish: false }
  }

  const token = createTop20ContinuationToken()
  const tokenHash = hashTop20ContinuationToken(token)
  const recoverableDispatch = Boolean(latest && latest.scan_phase !== "COMPLETED" && (
    latest.continuation_dispatch_status === "PAUSED_DISPATCH_RECOVERABLE" ||
    RECOVERABLE_DISPATCH_ERRORS.has(String(latest.last_error_code ?? ""))
  ))
  let run = latest && (["RUNNING", "PARTIAL"].includes(latest.status) || recoverableDispatch ||
    emptyCompletionNeedsRecovery || incompleteLoop1NeedsRecovery || resumeNeedsReanalysis)
    ? latest
    : null
  if (run) {
    if (reanalysisScope === "FULL_POLICY_UPGRADE") {
      // Restore work before advancing the run version. If the optimistic run
      // update loses a race, this update is safe to repeat on the next click.
      const { error: restorePolicyError } = await input.supabase
        .from("marketplace_listing_approval_queue_scan_targets")
        .update({ status: "PRESELECTED", processing_phase: null,
          lease_owner: null, lease_expires_at: null, processed_at: null,
          next_retry_at: null, last_error_code: null, updated_at: now.toISOString() })
        .eq("run_id", run.id).eq("marketplace_account_key", input.accountKey)
        .eq("marketplace", MARKETPLACE).eq("preselected", true).eq("status", "PROCESSED")
      if (restorePolicyError) throw new Error("TOP20_POLICY_REANALYSIS_RESTORE_FAILED")
    }
    const nextGeneration = Number(run.continuation_generation ?? 0) + 1
    const { data, error: updateError } = await input.supabase
      .from("marketplace_listing_approval_queue_runs").update({
        status: "PARTIAL", automation_status: "PARTIAL_AUTO_CONTINUING",
        continuation_token_hash: tokenHash, batch_size: configuration.batchSize,
        time_budget_seconds: configuration.timeBudgetSeconds,
        continuation_generation: nextGeneration,
        continuation_dispatch_status: "RETRY_SCHEDULED",
        dispatch_recovery_count: Number(run.dispatch_recovery_count ?? 0) + (recoverableDispatch ? 1 : 0),
        lock_version: Number(run.lock_version ?? 0) + 1,
        lease_owner: null, lease_expires_at: null, next_continuation_at: now.toISOString(),
        last_error_code: null, completed_at: null,
        ebay_first_status: emptyCompletionNeedsRecovery ? "NOT_STARTED" : run.ebay_first_status,
        scan_phase: incompleteLoop1NeedsRecovery || resumeNeedsReanalysis
          ? "LOOP1_ANALYSIS" : run.scan_phase,
        ...(reanalysisScope === "FULL_POLICY_UPGRADE" ? {
          deep_analyzed_count: 0, candidates_analyzed: 0, ready_count: 0,
          needs_data_count: 0, rejected_count: 0, go_count: 0,
          go_with_changes_count: 0, no_go_count: 0, exact_match_count: 0,
          excluded_internal_count: 0, retry_count: 0,
          identity_enriched_count: 0, identity_conflict_count: 0,
          catalog_read_count: 0, browse_read_count: 0,
          coverage_before: {}, coverage_after: {}, source_coverage: {},
          ...(policyUpgradeNeedsReanalysis ? {
            enrichment_version: TOP20_QUALIFICATION_POLICY_VERSION,
          } : {}),
        } : {}),
        last_checkpoint_at: run.last_checkpoint_at ?? run.last_activity_at ?? run.updated_at,
        last_activity_at: now.toISOString(), updated_at: now.toISOString(),
      }).eq("id", run.id).eq("lock_version", run.lock_version).select("*").maybeSingle()
    if (updateError || !data) throw new Error("TOP20_SCAN_RESUME_CONFLICT")
    run = data
    const { error: releaseError } = await input.supabase
      .from("marketplace_listing_approval_queue_scan_targets")
      .update({ status: top20ReleasedTargetStatus(
        run.scan_phase === "LOOP1_ANALYSIS" ? "LOOP1_ANALYSIS" : "DISCOVERY",
      ), processing_phase: null, lease_owner: null,
        lease_expires_at: null, updated_at: now.toISOString() })
      .eq("run_id", run.id).eq("status", "CLAIMED").lte("lease_expires_at", now.toISOString())
    if (releaseError) throw new Error("TOP20_SCAN_EXPIRED_LEASE_RELEASE_FAILED")
  } else {
    const { data, error: insertError } = await input.supabase
      .from("marketplace_listing_approval_queue_runs").insert({
        marketplace_account_key: input.accountKey, marketplace: MARKETPLACE,
        status: "PARTIAL", automation_status: "PARTIAL_AUTO_CONTINUING",
        continuation_token_hash: tokenHash, batch_size: configuration.batchSize,
        time_budget_seconds: configuration.timeBudgetSeconds,
        continuation_generation: 1, continuation_dispatch_status: "RETRY_SCHEDULED",
        enrichment_version: TOP20_QUALIFICATION_POLICY_VERSION,
        next_continuation_at: now.toISOString(), last_activity_at: now.toISOString(),
        scheduling_enabled: false,
      }).select("*").single()
    if (insertError || !data) throw new Error("TOP20_SCAN_RUN_CREATE_FAILED")
    run = data
  }
  const total = await ensureTop20RunTargets(input.supabase, input.accountKey, run.id, now)
  if (incompleteLoop1NeedsRecovery) {
    const { data: retryItems, error: retryReadError } = await input.supabase
      .from("marketplace_listing_approval_queue_items")
      .select("market_radar_product_id,supplier_variant_id,retry_count")
      .eq("run_id", run.id).eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", MARKETPLACE).eq("internal_status", "REANALYSIS_REQUIRED")
      .lt("retry_count", 3).limit(100)
    if (retryReadError) throw new Error("TOP20_REANALYSIS_RECOVERY_READ_FAILED")
    for (const item of retryItems ?? []) {
      const { error: retryRestoreError } = await input.supabase
        .from("marketplace_listing_approval_queue_scan_targets")
        .update({ status: "PRESELECTED", preselected: true, processing_phase: null,
          lease_owner: null, lease_expires_at: null, processed_at: null,
          next_retry_at: null, last_error_code: null, updated_at: now.toISOString() })
        .eq("run_id", run.id).eq("marketplace_account_key", input.accountKey)
        .eq("market_radar_product_id", item.market_radar_product_id)
        .eq("supplier_variant_id", item.supplier_variant_id).eq("status", "PROCESSED")
      if (retryRestoreError) throw new Error("TOP20_REANALYSIS_RECOVERY_PERSIST_FAILED")
    }
  }
  let emptyCompletionRecovered = false
  if (emptyCompletionNeedsRecovery) {
    const { error: restoreError } = await input.supabase
      .from("marketplace_listing_approval_queue_scan_targets")
      .update({ status: "DISCOVERED", preselected: false, processing_phase: null,
        lease_owner: null, lease_expires_at: null, processed_at: null,
        next_retry_at: null, last_error_code: null, updated_at: now.toISOString() })
      .eq("run_id", run.id).eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", MARKETPLACE).eq("status", "SKIPPED")
      .not("discovery_observed_at", "is", null)
    if (restoreError) throw new Error("TOP20_EMPTY_COMPLETION_RESTORE_FAILED")
    const preselection = await preselectTop20DiscoveryTargets({
      supabase: input.supabase, accountKey: input.accountKey, runId: run.id,
      limit: configuration.preselectionSize, now,
    })
    emptyCompletionRecovered = preselection.selected > 0
    if (!emptyCompletionRecovered) {
      const { error: noSelectionError } = await input.supabase
        .from("marketplace_listing_approval_queue_runs").update({
          status: "COMPLETED", automation_status: "COMPLETED", scan_phase: "COMPLETED",
          continuation_dispatch_status: "COMPLETED", continuation_token_hash: null,
          next_continuation_at: null, last_error_code: "TOP20_NO_PRESELECTION_ELIGIBLE",
          completed_at: now.toISOString(), updated_at: now.toISOString(),
        }).eq("id", run.id).eq("marketplace_account_key", input.accountKey)
      if (noSelectionError) throw new Error("TOP20_EMPTY_COMPLETION_FINALIZE_FAILED")
      return { runId: run.id, status: "COMPLETED" as const, shouldSchedule: false,
        continuationToken: null, recoveredEmptyCompletion: false,
        openAiCalls: 0, ebayWrites: 0, canPublish: false }
    }
  }
  return { runId: run.id, status: "PARTIAL_AUTO_CONTINUING" as const,
    catalogTotal: total, shouldSchedule: true, continuationToken: token,
    continuationGeneration: Number(run.continuation_generation ?? 1),
    expectedBatch: Number(run.current_batch ?? 0) + 1,
    recovered: recoverableDispatch || emptyCompletionRecovered || incompleteLoop1NeedsRecovery ||
      resumeNeedsReanalysis,
    recoveredEmptyCompletion: emptyCompletionRecovered,
    batchSize: configuration.batchSize, timeBudgetSeconds: configuration.timeBudgetSeconds,
    openAiCalls: 0, ebayWrites: 0, canPublish: false }
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
    const strategic = record(snapshot.strategicIntelligence)
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
        crossSourceCorroboration: number(strategic.score) ??
          number(scores.crossSourceCorroboration) ?? 0,
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

function chunks<T>(values: T[], size = 250) {
  const pages: T[][] = []
  for (let offset = 0; offset < values.length; offset += size) pages.push(values.slice(offset, offset + size))
  return pages
}

async function preselectTop20DiscoveryTargets(input: {
  supabase: SupabaseClient
  accountKey: string
  runId: string
  limit: number
  now: Date
}) {
  const rows: JsonRecord[] = []
  for (let offset = 0; ; offset += TARGET_CATALOG_PAGE_SIZE) {
    const { data, error } = await input.supabase
      .from("marketplace_listing_approval_queue_scan_targets")
      .select("id,ordinal,source_priority,discovery_strategy,ebay_first_rank,discovery_score,discovery_snapshot")
      .eq("run_id", input.runId).eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", MARKETPLACE).eq("status", "DISCOVERED")
      .order("ordinal", { ascending: true })
      .range(offset, offset + TARGET_CATALOG_PAGE_SIZE - 1)
    if (error) throw new Error("TOP20_PRESELECTION_READ_FAILED")
    rows.push(...(data ?? []).map(record))
    if ((data ?? []).length < TARGET_CATALOG_PAGE_SIZE) break
  }
  const sourceOrder: Record<string, number> = { RADAR_TOP5: 0, PRIOR_INTELLIGENCE: 1, LUNA_CATALOG: 2 }
  const evaluated = rows.map((row) => {
    const snapshot = record(row.discovery_snapshot)
    const riskCodes = safeCodes(snapshot.basicRiskCodes)
    return { row, evaluation: evaluateTop20DiscoveryPreselection({
      supplierAvailable: snapshot.supplierAvailable === true,
      returnedCandidateCount: Number(snapshot.returnedCandidateCount ?? 0),
      discoveryScore: Number(row.discovery_score ?? 0),
      identitySignalScore: Number(snapshot.identitySignalScore ?? 0),
      riskCodes,
    }) }
  })
  const eligible = evaluated.filter((entry) => entry.evaluation.eligible).map((entry) => entry.row)
    .sort((left, right) =>
    Number(right.discovery_strategy === "EBAY_FIRST") - Number(left.discovery_strategy === "EBAY_FIRST") ||
    Number(right.discovery_score ?? 0) - Number(left.discovery_score ?? 0) ||
    Number(left.ebay_first_rank ?? Number.MAX_SAFE_INTEGER) -
      Number(right.ebay_first_rank ?? Number.MAX_SAFE_INTEGER) ||
    (sourceOrder[String(left.source_priority)] ?? 9) -
      (sourceOrder[String(right.source_priority)] ?? 9) ||
    Number(left.ordinal) - Number(right.ordinal))
  const selectedIds = eligible.slice(0, input.limit).map((row) => row.id)
  const selectedSet = new Set(selectedIds)
  const skippedIds = rows.filter((row) => !selectedSet.has(row.id)).map((row) => row.id)
  for (const page of chunks(selectedIds)) {
    const { error: updateError } = await input.supabase
      .from("marketplace_listing_approval_queue_scan_targets")
      .update({ status: "PRESELECTED", preselected: true, processing_phase: null,
        updated_at: input.now.toISOString() }).in("id", page)
    if (updateError) throw new Error("TOP20_PRESELECTION_PERSIST_FAILED")
  }
  for (const page of chunks(skippedIds)) {
    const { error: updateError } = await input.supabase
      .from("marketplace_listing_approval_queue_scan_targets")
      .update({ status: "SKIPPED", preselected: false, processing_phase: null,
        processed_at: input.now.toISOString(), updated_at: input.now.toISOString() }).in("id", page)
    if (updateError) throw new Error("TOP20_DISCOVERY_EXCLUSION_PERSIST_FAILED")
  }
  const { error: runError } = await input.supabase.from("marketplace_listing_approval_queue_runs")
    .update({ scan_phase: "LOOP1_ANALYSIS", preselected_count: selectedIds.length,
      excluded_internal_count: skippedIds.length, next_continuation_at: input.now.toISOString(),
      diagnostic_counts: {
        PRESELECTION_POLICY_V2: 1,
        DISCOVERY_WITH_CANDIDATES: evaluated.filter((entry) =>
          Number(record(entry.row.discovery_snapshot).returnedCandidateCount ?? 0) > 0).length,
        DISCOVERY_SCORE_ELIGIBLE: evaluated.filter((entry) =>
          Number(entry.row.discovery_score ?? 0) >= 35).length,
        DISCOVERY_PROVISIONAL_IDENTITY: evaluated.filter((entry) =>
          entry.evaluation.identityStatus === "LOOP1_ENRICHMENT_REQUIRED").length,
        DISCOVERY_STRONG_IDENTITY: evaluated.filter((entry) =>
          entry.evaluation.identityStatus === "DISCOVERY_STRONG").length,
        DISCOVERY_PRESELECTED: selectedIds.length,
        DISCOVERY_HARD_EXCLUDED: evaluated.length - eligible.length,
      },
      last_activity_at: input.now.toISOString(), updated_at: input.now.toISOString() })
    .eq("id", input.runId).eq("marketplace_account_key", input.accountKey)
  if (runError) throw new Error("TOP20_PRESELECTION_RUN_UPDATE_FAILED")
  return { selected: selectedIds.length, excluded: skippedIds.length }
}

async function runTop20DiscoveryBatch(input: {
  supabase: SupabaseClient
  accountKey: string
  run: JsonRecord
  work: Array<{ target: JsonRecord; rawVariant: JsonRecord | null }>
  workerId: string
  total: number
  now: Date
  environment: NodeJS.ProcessEnv
  timeBudgetMs: number
}) {
  const startedAt = Date.now()
  const discoveredIds: string[] = []
  const skippedIds: string[] = []
  const releasedIds: string[] = []
  let rateLimitedTarget: JsonRecord | null = null
  let rateLimitCode: string | null = null
  let rateLimitPause: Top20RateLimitPause | null = null
  for (const [index, entry] of input.work.entries()) {
    if (index > 0 && Date.now() - startedAt >= input.timeBudgetMs) {
      releasedIds.push(...input.work.slice(index).map((remaining) => text(remaining.target.id))
        .filter((value): value is string => Boolean(value)))
      break
    }
    const targetId = text(entry.target.id)
    if (!targetId || !entry.rawVariant) {
      if (targetId) skippedIds.push(targetId)
      continue
    }
    const variant = record(entry.rawVariant)
    const candidate = candidateFromRows(variant, {}, input.environment)
    try {
      const supplierAvailable = candidate.available === true &&
        (candidate.inventoryQuantity === null || candidate.inventoryQuantity > 0)
      const signals = supplierAvailable && !candidate.complianceBlocked
        ? await discoverEbayListingSignals({
          productName: candidate.productName,
          variantTitle: candidate.variant,
          supplierSku: candidate.supplierSku,
          gtin: candidate.gtin,
          brand: candidate.manufacturerBrand,
          mpn: candidate.mpn ?? candidate.model,
          color: candidate.color,
          size: candidate.size,
          packQuantity: candidate.packCount,
          categoryId: candidate.categoryId,
        })
        : null
      const riskCodes = [
        ...signals?.basicRiskCodes ?? [],
        ...supplierAvailable ? [] : ["LUNA_OUT_OF_STOCK"],
        ...candidate.complianceBlocked ? ["COMPLIANCE_BLOCKED"] : [],
      ]
      const operationalAdjustment = candidate.productUrl && candidate.imageUrl ? 5 : 0
      const discoveryScore = Math.max(0, Math.min(100,
        (signals?.discoveryScore ?? 0) + operationalAdjustment -
        (!candidate.weight && !candidate.dimensions ? 5 : 0)))
      const preselection = evaluateTop20DiscoveryPreselection({
        supplierAvailable,
        returnedCandidateCount: signals?.returnedCandidateCount ?? 0,
        discoveryScore,
        identitySignalScore: signals?.identitySignalScore ?? 0,
        riskCodes,
      })
      const snapshot = {
        version: "EBAY_LUNA_DISCOVERY_V1",
        origin: entry.target.discovery_strategy === "EBAY_FIRST" ? "EBAY_FIRST" : "LUNA_FIRST",
        lunaMatchStatus: entry.target.ebay_first_luna_match_status ?? "NOT_APPLICABLE",
        ebayFirstEvidence: entry.target.discovery_strategy === "EBAY_FIRST"
          ? record(entry.target.ebay_first_evidence_snapshot) : null,
        source: signals?.source ?? "LUNA_SUPPLY_ONLY",
        observedAt: signals?.observedAt ?? input.now.toISOString(),
        supplierAvailable,
        candidateFoundCount: signals?.candidateFoundCount ?? 0,
        returnedCandidateCount: signals?.returnedCandidateCount ?? 0,
        sellerCount: signals?.sellerCount ?? 0,
        landedPriceRange: signals?.landedPriceRange ?? null,
        packsObserved: signals?.packsObserved ?? [],
        estimatedMovementSignals: signals?.estimatedMovementSignals ?? 0,
        demandSignalClass: signals?.demandSignalClass ?? "NONE",
        categoryId: signals?.categoryId ?? null,
        identitySignalScore: signals?.identitySignalScore ?? 0,
        preselectionIdentityStatus: preselection.identityStatus,
        preselectionEligible: preselection.eligible,
        basicRiskCodes: safeCodes(riskCodes),
        fullCompetitorContentStored: false,
        openAiCalls: 0,
        ebayWrites: 0,
      }
      const { error } = await input.supabase.from("marketplace_listing_approval_queue_scan_targets")
        .update({ status: "DISCOVERED", discovery_score: discoveryScore,
          discovery_snapshot: snapshot, discovery_observed_at: input.now.toISOString(),
          processing_phase: null, lease_owner: null, lease_expires_at: null,
          rate_limit_consecutive_count: 0,
          last_error_code: null, updated_at: input.now.toISOString() })
        .eq("id", targetId).eq("lease_owner", input.workerId)
      if (error) throw new Error("TOP20_DISCOVERY_TARGET_PERSIST_FAILED")
      discoveredIds.push(targetId)
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message : "TOP20_DISCOVERY_FAILED"
      if (isTop20RateLimitError(error)) {
        rateLimitedTarget = entry.target
        rateLimitCode = code
        rateLimitPause = top20RateLimitPause(error, entry.target, input.now)
        releasedIds.push(...input.work.slice(index + 1).map((remaining) => text(remaining.target.id))
          .filter((value): value is string => Boolean(value)))
        break
      }
      const { error: updateError } = await input.supabase
        .from("marketplace_listing_approval_queue_scan_targets")
        .update({ status: "DISCOVERED", discovery_score: 0,
          discovery_snapshot: { version: "EBAY_LUNA_DISCOVERY_V1", basicRiskCodes: [code],
            origin: entry.target.discovery_strategy === "EBAY_FIRST" ? "EBAY_FIRST" : "LUNA_FIRST",
            lunaMatchStatus: entry.target.ebay_first_luna_match_status ?? "NOT_APPLICABLE",
            fullCompetitorContentStored: false, openAiCalls: 0, ebayWrites: 0 },
          discovery_observed_at: input.now.toISOString(), processing_phase: null,
          lease_owner: null, lease_expires_at: null, last_error_code: code,
          rate_limit_consecutive_count: 0,
          updated_at: input.now.toISOString() }).eq("id", targetId).eq("lease_owner", input.workerId)
      if (updateError) throw new Error("TOP20_DISCOVERY_FAILURE_PERSIST_FAILED")
      discoveredIds.push(targetId)
    }
  }
  if (skippedIds.length) {
    const { error } = await input.supabase.from("marketplace_listing_approval_queue_scan_targets")
      .update({ status: "SKIPPED", processing_phase: null, lease_owner: null, lease_expires_at: null,
        processed_at: input.now.toISOString(), last_error_code: "TOP20_CATALOG_VARIANT_MISSING",
        updated_at: input.now.toISOString() }).in("id", skippedIds).eq("lease_owner", input.workerId)
    if (error) throw new Error("TOP20_DISCOVERY_SKIP_FAILED")
  }
  if (releasedIds.length) {
    const { error } = await input.supabase.from("marketplace_listing_approval_queue_scan_targets")
      .update({ status: "PENDING", processing_phase: null, lease_owner: null, lease_expires_at: null,
        updated_at: input.now.toISOString() }).in("id", releasedIds).eq("lease_owner", input.workerId)
    if (error) throw new Error("TOP20_DISCOVERY_RELEASE_FAILED")
  }
  if (rateLimitedTarget && rateLimitPause) {
    const { error } = await input.supabase.from("marketplace_listing_approval_queue_scan_targets")
      .update({ status: "RETRY_REQUIRED", processing_phase: "DISCOVERY", lease_owner: null,
        lease_expires_at: null, next_retry_at: rateLimitPause.nextRetryAt,
        rate_limit_consecutive_count: rateLimitPause.consecutiveCount,
        last_rate_limit_retry_after_seconds: rateLimitPause.retryAfterSeconds,
        last_rate_limit_backoff_seconds: rateLimitPause.backoffSeconds,
        last_rate_limit_source: rateLimitPause.source,
        last_rate_limit_observed_at: rateLimitPause.observedAt,
        last_error_code: rateLimitCode ?? "TOP20_RATE_LIMITED", updated_at: input.now.toISOString() })
      .eq("id", rateLimitedTarget.id).eq("lease_owner", input.workerId)
    if (error) throw new Error("TOP20_DISCOVERY_RATE_LIMIT_PERSIST_FAILED")
  }
  const discoveryExamined = Number(input.run.discovery_examined_count ?? 0) +
    discoveredIds.length + skippedIds.length
  const { count: remaining, error: countError } = await input.supabase
    .from("marketplace_listing_approval_queue_scan_targets")
    .select("id", { count: "exact", head: true }).eq("run_id", input.run.id)
    .in("status", ["PENDING", "CLAIMED", "RETRY_REQUIRED"])
  if (countError) throw new Error("TOP20_DISCOVERY_REMAINING_COUNT_FAILED")
  let preselection = { selected: Number(input.run.preselected_count ?? 0), excluded: 0 }
  if ((remaining ?? 0) === 0) {
    preselection = await preselectTop20DiscoveryTargets({
      supabase: input.supabase, accountKey: input.accountKey, runId: String(input.run.id),
      limit: getTop20AutomationConfiguration(input.environment).preselectionSize, now: input.now,
    })
  }
  const status: Top20AutomationStatus = rateLimitedTarget ? "PAUSED_RATE_LIMIT" : "PARTIAL_AUTO_CONTINUING"
  const { error: runError } = await input.supabase.from("marketplace_listing_approval_queue_runs")
    .update({ status: "PARTIAL", automation_status: status,
      scan_phase: (remaining ?? 0) === 0 ? "LOOP1_ANALYSIS" : "DISCOVERY",
      discovery_examined_count: discoveryExamined,
      catalog_examined: discoveryExamined,
      checkpoint_offset: discoveryExamined,
      last_checkpoint_at: input.now.toISOString(),
      preselected_count: preselection.selected,
      lease_owner: null, lease_expires_at: null,
      continuation_dispatch_status: status === "PARTIAL_AUTO_CONTINUING"
        ? "RETRY_SCHEDULED" : "NOT_SCHEDULED",
      next_continuation_at: status === "PARTIAL_AUTO_CONTINUING" ? input.now.toISOString()
        : rateLimitPause?.nextRetryAt ?? null,
      rate_limit_consecutive_count: rateLimitPause?.consecutiveCount ?? 0,
      last_rate_limit_retry_after_seconds: rateLimitPause?.retryAfterSeconds ?? null,
      last_rate_limit_backoff_seconds: rateLimitPause?.backoffSeconds ?? null,
      last_rate_limit_source: rateLimitPause?.source ?? null,
      last_rate_limit_observed_at: rateLimitPause?.observedAt ?? null,
      last_error_code: rateLimitCode, last_activity_at: input.now.toISOString(),
      updated_at: input.now.toISOString(),
    }).eq("id", input.run.id).eq("lease_owner", input.workerId)
  if (runError) throw new Error("TOP20_DISCOVERY_RUN_FINISH_FAILED")
  return {
    runId: input.run.id,
    status,
    phase: (remaining ?? 0) === 0 ? "LOOP1_ANALYSIS" : "DISCOVERY",
    catalogTotal: input.total,
    catalogExamined: discoveryExamined,
    progressPercent: top20ProgressPercent(discoveryExamined, input.total),
    preselected: preselection.selected,
    currentBatch: Number(input.run.current_batch ?? 0),
    nextContinuationAt: status === "PARTIAL_AUTO_CONTINUING"
      ? input.now.toISOString() : rateLimitPause?.nextRetryAt ?? null,
    openAiCalls: 0,
    ebayWrites: 0,
    canPublish: false,
    schedulingEnabled: false,
  }
}

export async function runListingAiApprovalQueueBatch(input: {
  supabase: SupabaseClient
  accountKey: string
  batchSize?: number
  timeBudgetMs?: number
  runId?: string
  now?: Date
  environment?: NodeJS.ProcessEnv
  catalogReader?: typeof searchEbayCatalogIdentity
  expectedBatch?: number
}) {
  const now = input.now ?? new Date()
  const environment = input.environment ?? process.env
  const configuration = getTop20AutomationConfiguration(environment)
  const batchSize = Math.max(1, Math.min(10, Math.floor(input.batchSize ?? configuration.batchSize)))
  const timeBudgetMs = Math.max(10_000, Math.min(240_000,
    input.timeBudgetMs ?? configuration.timeBudgetSeconds * 1_000))
  const workerId = `top20:${randomUUID()}`
  let total = 0
  if (input.runId) total = await ensureTop20RunTargets(input.supabase, input.accountKey, input.runId, now)
  const claim = await claimRun(
    input.supabase,
    input.accountKey,
    total,
    workerId,
    now,
    input.runId,
    input.expectedBatch,
  )
  const run = claim.run
  total = await ensureTop20RunTargets(input.supabase, input.accountKey, run.id, now)
  if (claim.duplicate) return {
    runId: run.id,
    status: run.automation_status as Top20AutomationStatus,
    phase: run.scan_phase,
    catalogTotal: total,
    catalogExamined: Number(run.discovery_examined_count ?? 0),
    progressPercent: top20ProgressPercent(Number(run.discovery_examined_count ?? 0), total),
    preselected: Number(run.preselected_count ?? 0),
    deepAnalyzed: Number(run.deep_analyzed_count ?? 0),
    currentBatch: Number(run.current_batch ?? 0),
    duplicateBatch: true,
    openAiCalls: 0,
    ebayWrites: 0,
    canPublish: false,
    schedulingEnabled: false,
  }
  if (run.scan_phase === "DISCOVERY" || run.ebay_first_status === "NOT_STARTED" ||
    run.ebay_first_status === "FAILED_RECOVERABLE") {
    await ensureEbayFirstDiscovery({ supabase: input.supabase, accountKey: input.accountKey,
      run, environment, now })
  }
  const { data: claimedTargets, error: claimError } = await input.supabase
    .rpc("claim_marketplace_listing_top20_targets", {
      p_run_id: run.id,
      p_marketplace_account_key: input.accountKey,
      p_worker_id: workerId,
      p_limit: batchSize,
      p_now: now.toISOString(),
    })
  if (claimError) throw new Error("TOP20_TARGET_CLAIM_FAILED")
  const targets: JsonRecord[] = ((claimedTargets ?? []) as unknown[])
    .map((entry) => record(entry))
  targets.sort((left: JsonRecord, right: JsonRecord) => Number(left.ordinal) - Number(right.ordinal))
  const productIds = [...new Set(targets.map((target) => text(target.market_radar_product_id))
    .filter((value): value is string => Boolean(value)))]
  const { data: catalogVariants, error: catalogError } = productIds.length
    ? await input.supabase
    .from("market_radar_latest_variants")
    .select("product_id,supplier_product_id,supplier_variant_id,sku,barcode,title,variant_title,vendor,product_type,tags,product_url,featured_image_url,image_urls,metadata,snapshot_id,price,available,inventory_quantity,weight,weight_unit,captured_at,seller_scan_priority_score")
    .eq("source_key", "lunaportex")
      .in("product_id", productIds)
    : { data: [], error: null }
  if (catalogError) throw new Error("TOP10_CATALOG_READ_FAILED")
  const normalizedCatalogVariants: JsonRecord[] = (catalogVariants ?? []).map((row: unknown) => record(row))
  const variantsByKey = new Map<string, JsonRecord>(normalizedCatalogVariants.map((row) => [
    `${row.product_id}:${row.supplier_variant_id ?? ""}`, row,
  ]))
  const work: Array<{ target: JsonRecord; rawVariant: JsonRecord | null }> = targets.map((target) => ({ target, rawVariant: variantsByKey.get(
    `${target.market_radar_product_id}:${target.supplier_variant_id ?? ""}`,
  ) ?? null }))
  if (run.scan_phase === "DISCOVERY") {
    return runTop20DiscoveryBatch({
      supabase: input.supabase, accountKey: input.accountKey, run,
      work: work.map((entry) => ({ target: entry.target, rawVariant: entry.rawVariant ? record(entry.rawVariant) : null })),
      workerId, total, now, environment, timeBudgetMs,
    })
  }
  if (run.scan_phase !== "LOOP1_ANALYSIS") throw new Error("TOP20_SCAN_PHASE_INVALID")
  const variants: JsonRecord[] = work.map((entry) => entry.rawVariant).filter(
    (entry): entry is JsonRecord => Boolean(entry),
  )
  const queueRows = await loadQueueRows(input.supabase, variants.map((row) => text(row.product_id))
    .filter((value): value is string => Boolean(value)))
  const snapshotRows = await loadSnapshotRows(input.supabase, (variants ?? [])
    .map((row) => String(row.snapshot_id)).filter(Boolean))
  const reviewedSoldEvidence = await readReviewedOfficialSoldEvidence({
    supabase: input.supabase, accountKey: input.accountKey, now,
  })
  const invocationStartedAt = Date.now()
  let analyzed = 0
  let retries = 0
  let enrichedCount = 0
  let conflictCount = 0
  let catalogReads = 0
  let browseReads = 0
  const coverageBefore = { total: 0, brand: 0, gtinOrMpn: 0, pack: 0, weight: 0, dimensions: 0 }
  const coverageAfter = { total: 0, brand: 0, gtinOrMpn: 0, pack: 0, weight: 0, dimensions: 0 }
  const sources: Record<string, number> = {}
  const itemPayloads: JsonRecord[] = []
  const processedTargetIds: string[] = []
  const retryTargetIds: string[] = []
  const skippedTargetIds: string[] = []
  const releasedTargetIds: string[] = []
  let rateLimitedTarget: JsonRecord | null = null
  let rateLimitCode: string | null = null
  let rateLimitPause: Top20RateLimitPause | null = null
  for (const [index, entry] of work.entries()) {
    if (index > 0 && Date.now() - invocationStartedAt >= timeBudgetMs) {
      releasedTargetIds.push(...work.slice(index).map((remaining) => text(remaining.target.id))
        .filter((value): value is string => Boolean(value)))
      break
    }
    const rawVariant = entry.rawVariant
    if (!rawVariant) {
      const targetId = text(entry.target.id)
      if (targetId) skippedTargetIds.push(targetId)
      continue
    }
    const variant = record(rawVariant)
    const queue = queueRows.get(`${variant.product_id}:${variant.supplier_variant_id ?? ""}`) ?? {}
    let candidate = candidateFromRows(variant, queue, environment)
    coverageBefore.total += 1
    if (candidate.manufacturerBrand) coverageBefore.brand += 1
    if (candidate.gtinValid || candidate.mpn || candidate.model) coverageBefore.gtinOrMpn += 1
    if (candidate.packCount) coverageBefore.pack += 1
    if (candidate.weight) coverageBefore.weight += 1
    if (candidate.dimensions) coverageBefore.dimensions += 1
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
    let snapshot: JsonRecord = safeEvidenceSnapshot({ candidate })
    let lastError: string | null = null
    let retryTarget = false
    let identityEnrichmentId: string | null = null
    const hasPriorIntelligence = Boolean(candidate.supplierProductId && candidate.supplierVariantId &&
      candidate.supplierSku && candidate.productName && candidate.productUrl)
    if (hasPriorIntelligence) {
      try {
        const enriched = await enrichFromOfficialSources({ variant, queue,
          rawSnapshot: snapshotRows.get(String(variant.snapshot_id)) ?? {}, environment,
          catalogReader: input.catalogReader ?? searchEbayCatalogIdentity })
        candidate = enriched.candidate
        enrichedCount += 1
        conflictCount += enriched.conflicts.length ? 1 : 0
        catalogReads += 1
        browseReads += 1
        for (const [source, count] of Object.entries(enriched.sourceCoverage)) {
          sources[source] = (sources[source] ?? 0) + count
        }
        identityEnrichmentId = await persistIdentityEnrichment({ supabase: input.supabase,
          runId: run.id, accountKey: input.accountKey, candidate, result: enriched, now })
        const loop1Gate = evaluateApprovalQueueLoop1Eligibility(candidate, now)
        if (!loop1Gate.canAnalyze) {
          cohort = loop1Gate.cohort
          reasons = [...loop1Gate.reasonCodes,
            ...enriched.conflicts.length ? ["IDENTITY_SOURCE_CONFLICT"] : []]
          snapshot = safeEvidenceSnapshot({ candidate })
        } else {
          const result = await analyzeCandidate({
            supabase: input.supabase, accountKey: input.accountKey, candidate, now,
            comparables: separateActiveAndEstimatedComparables(enriched.report),
            marketReport: enriched.report,
            reviewedSoldEvidence,
            discovery: {
              origin: entry.target.discovery_strategy === "EBAY_FIRST" ? "EBAY_FIRST" : "LUNA_FIRST",
              lunaMatchStatus: text(entry.target.ebay_first_luna_match_status),
              ebayFirstEvidence: entry.target.ebay_first_evidence_snapshot,
            },
          })
          analyzed += 1
          const preliminarySafe = result.evidence.estimatedProfit !== null && result.evidence.estimatedProfit >= 5 &&
            result.evidence.roiPercent !== null && result.evidence.roiPercent >= 30 &&
            result.evidence.netMarginPercent !== null && result.evidence.netMarginPercent >= 20
          const qualification = automaticQualification({ identity: enriched.identity,
            conflicts: enriched.conflicts, exactLunaMapping: result.evidence.exactLunaMapping,
            exactComparableCount: result.evidence.activeExactCount,
            imageAuthorized: candidate.imageAuthorized, currentUrl: Boolean(candidate.productUrl),
            logisticsStatus: candidate.logisticsStatus, conservativeEconomicsSafe: preliminarySafe,
            safePackStrategy: result.evidence.safePackStrategy,
            complianceBlocked: result.evidence.complianceBlocked,
            identityConsensusConfirmed: enriched.consensus.sellerCount >= 2 ||
              enriched.exactComparables.length >= 1 && enriched.catalogMatchCount >= 1 })
          cohort = qualification.visibleInTop20 ? result.classification.cohort : "NEEDS_DATA"
          reasons = qualification.visibleInTop20 ? result.classification.reasonCodes : qualification.reasons
          packageId = result.row.id
          packageHash = result.row.package_hash
          identityFingerprint = result.row.product_identity_fingerprint
          baseFingerprint = result.pack.baseProductFingerprint
          offerFingerprint = result.pack.recommendedPack?.offerPackFingerprint ?? result.pack.currentOfferPackFingerprint
          rankingScore = approvalQueueRankingScore(result.evidence.scores)
          snapshot = { ...safeEvidenceSnapshot({ candidate, evidence: result.evidence,
            pack: result.pack, strategicIntelligence: result.strategicIntelligence }),
            optimizationEvidence: result.optimizationEvidence,
            discovery: {
              origin: entry.target.discovery_strategy === "EBAY_FIRST" ? "EBAY_FIRST" : "LUNA_FIRST",
              lunaMatchStatus: entry.target.discovery_strategy === "EBAY_FIRST"
                ? entry.target.ebay_first_luna_match_status ?? "NO_LUNA_MATCH" : "NOT_APPLICABLE",
              ebayFirstEvidence: entry.target.discovery_strategy === "EBAY_FIRST"
                ? record(entry.target.ebay_first_evidence_snapshot) : null,
              activeAndSoldEvidenceSeparated: true,
            },
            loop1Verdict: result.row.verdict,
            identityEnrichment: {
              version: LUNA_PRODUCT_IDENTITY_ENRICHMENT_VERSION,
              winnerEvidenceVersion: EBAY_WINNER_EVIDENCE_V2_VERSION,
              identity: enriched.identity,
              conflicts: enriched.conflicts,
              exactComparableCount: enriched.exactComparables.length,
              comparableClassificationCounts: enriched.comparableClassifications.reduce<Record<string, number>>(
                (counts, entry) => { counts[entry.result.classification] =
                  (counts[entry.result.classification] ?? 0) + 1; return counts }, {}),
              consensus: enriched.consensus.fields,
              catalogMatchRule: enriched.catalogMatchRule,
              categoryStatus: enriched.taxonomyStatus,
              sourceCoverage: enriched.sourceCoverage,
              competitorContentStored: false,
            } }
        }
      } catch (error) {
        const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
          ? error.message : "TOP10_CANDIDATE_ANALYSIS_FAILED"
        if (isTop20RateLimitError(error)) {
          rateLimitedTarget = entry.target
          rateLimitCode = code
          rateLimitPause = top20RateLimitPause(error, entry.target, now)
          releasedTargetIds.push(...work.slice(index + 1).map((remaining) => text(remaining.target.id))
            .filter((value): value is string => Boolean(value)))
          break
        }
        cohort = "NEEDS_DATA"
        reasons = [code]
        lastError = code
        retryTarget = code === "WINNER_EVIDENCE_PACKAGE_PERSIST_FAILED" &&
          Number(entry.target.attempt_count ?? 1) < 3
        retries += 1
      }
    } else {
      cohort = "NEEDS_DATA"
      reasons = ["AUTOMATIC_MARKET_DISCOVERY_PENDING"]
    }
    coverageAfter.total += 1
    if (candidate.manufacturerBrand) coverageAfter.brand += 1
    if (candidate.gtinValid || candidate.mpn || candidate.model) coverageAfter.gtinOrMpn += 1
    if (candidate.packCount) coverageAfter.pack += 1
    if (candidate.weight) coverageAfter.weight += 1
    if (candidate.dimensions) coverageAfter.dimensions += 1
    itemPayloads.push({
        run_id: run.id,
        marketplace_account_key: input.accountKey,
        marketplace: MARKETPLACE,
        market_radar_product_id: candidate.marketRadarProductId,
        supplier_product_id: candidate.supplierProductId ?? candidate.marketRadarProductId,
        supplier_variant_id: candidate.supplierVariantId ?? "UNKNOWN",
        supplier_sku: candidate.supplierSku ?? "UNKNOWN",
        discovery_strategy: entry.target.discovery_strategy === "EBAY_FIRST" ? "EBAY_FIRST" : "LUNA_FIRST",
        luna_match_status: entry.target.discovery_strategy === "EBAY_FIRST"
          ? entry.target.ebay_first_luna_match_status ?? "NO_LUNA_MATCH" : "NOT_APPLICABLE",
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
        retry_count: lastError ? Number(entry.target.attempt_count ?? 1) : 0,
        next_retry_at: retryTarget ? now.toISOString() : null,
        last_error_code: lastError,
        identity_enrichment_id: identityEnrichmentId,
        stale_after: new Date(now.getTime() + FRESHNESS_MS).toISOString(),
        supplier_shipping_cost_status: "ESTIMATED",
        supplier_shipping_reserve_usd: candidate.supplierShippingReserveUsd,
        analyzed_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
    const targetId = text(entry.target.id)
    if (targetId) (retryTarget ? retryTargetIds : processedTargetIds).push(targetId)
  }
  if (itemPayloads.length) {
    const { error: itemError } = await input.supabase.from("marketplace_listing_approval_queue_items")
      .upsert(itemPayloads, { onConflict: "run_id,market_radar_product_id,supplier_variant_id" })
    if (itemError) throw new Error("TOP10_QUEUE_ITEM_PERSIST_FAILED")
  }
  if (processedTargetIds.length) {
    const { error } = await input.supabase.from("marketplace_listing_approval_queue_scan_targets")
      .update({ status: "PROCESSED", lease_owner: null, lease_expires_at: null,
        processed_at: now.toISOString(), deep_analyzed_at: now.toISOString(),
        processing_phase: null, rate_limit_consecutive_count: 0,
        evidence_reanalysis_priority: 0,
        evidence_reanalysis_completed_at: now.toISOString(),
        last_error_code: null, updated_at: now.toISOString() })
      .in("id", processedTargetIds).eq("lease_owner", workerId)
    if (error) throw new Error("TOP20_TARGET_COMPLETE_FAILED")
  }
  if (retryTargetIds.length) {
    const { error } = await input.supabase.from("marketplace_listing_approval_queue_scan_targets")
      .update({ status: "RETRY_REQUIRED", lease_owner: null, lease_expires_at: null,
        processing_phase: "LOOP1_ANALYSIS", next_retry_at: now.toISOString(),
        last_error_code: "WINNER_EVIDENCE_PACKAGE_PERSIST_FAILED",
        updated_at: now.toISOString() })
      .in("id", retryTargetIds).eq("lease_owner", workerId)
    if (error) throw new Error("TOP20_TARGET_RETRY_PERSIST_FAILED")
  }
  if (skippedTargetIds.length) {
    const { error } = await input.supabase.from("marketplace_listing_approval_queue_scan_targets")
      .update({ status: "SKIPPED", lease_owner: null, lease_expires_at: null,
        processed_at: now.toISOString(), processing_phase: null,
        last_error_code: "TOP20_CATALOG_VARIANT_MISSING",
        updated_at: now.toISOString() }).in("id", skippedTargetIds).eq("lease_owner", workerId)
    if (error) throw new Error("TOP20_TARGET_SKIP_FAILED")
  }
  if (releasedTargetIds.length) {
    const { error } = await input.supabase.from("marketplace_listing_approval_queue_scan_targets")
      .update({ status: top20ReleasedTargetStatus("LOOP1_ANALYSIS"),
        lease_owner: null, lease_expires_at: null,
        processing_phase: null, updated_at: now.toISOString() })
      .in("id", releasedTargetIds).eq("lease_owner", workerId)
    if (error) throw new Error("TOP20_TARGET_RELEASE_FAILED")
  }
  if (rateLimitedTarget && rateLimitPause) {
    const { error } = await input.supabase.from("marketplace_listing_approval_queue_scan_targets")
      .update({ status: "RETRY_REQUIRED", lease_owner: null, lease_expires_at: null,
        processing_phase: "LOOP1_ANALYSIS",
        next_retry_at: rateLimitPause.nextRetryAt,
        rate_limit_consecutive_count: rateLimitPause.consecutiveCount,
        last_rate_limit_retry_after_seconds: rateLimitPause.retryAfterSeconds,
        last_rate_limit_backoff_seconds: rateLimitPause.backoffSeconds,
        last_rate_limit_source: rateLimitPause.source,
        last_rate_limit_observed_at: rateLimitPause.observedAt,
        last_error_code: rateLimitCode ?? "TOP20_RATE_LIMITED",
        updated_at: now.toISOString() }).eq("id", rateLimitedTarget.id).eq("lease_owner", workerId)
    if (error) throw new Error("TOP20_TARGET_RATE_LIMIT_PAUSE_FAILED")
  }
  await recomputeRanks(input.supabase, input.accountKey, run.id)
  const { data: itemRows, error: itemCountError } = await input.supabase
    .from("marketplace_listing_approval_queue_items").select("cohort,reason_codes,evidence_snapshot")
    .eq("run_id", run.id).eq("marketplace_account_key", input.accountKey)
  if (itemCountError) throw new Error("TOP10_QUEUE_COUNT_FAILED")
  const ready = (itemRows ?? []).filter((row) => row.cohort === "READY_FOR_OPERATOR_APPROVAL").length
  const needs = (itemRows ?? []).filter((row) => row.cohort === "NEEDS_DATA").length
  const rejected = (itemRows ?? []).filter((row) => row.cohort === "REJECTED").length
  const exactMatches = (itemRows ?? []).filter((row) =>
    (number(record(record(row.evidence_snapshot).evidence).activeExactCount) ?? 0) > 0).length
  const goCount = (itemRows ?? []).filter((row) => record(row.evidence_snapshot).loop1Verdict === "GO").length
  const goWithChangesCount = (itemRows ?? []).filter((row) =>
    record(row.evidence_snapshot).loop1Verdict === "GO_WITH_CHANGES").length
  const noGoCount = (itemRows ?? []).filter((row) => row.cohort === "REJECTED" ||
    record(row.evidence_snapshot).loop1Verdict === "NO_GO").length
  const diagnosticCounts = (itemRows ?? []).reduce<Record<string, number>>((counts, row) => {
    for (const code of safeCodes(row.reason_codes)) {
      const bucket = code.includes("COMPARABLE") || code.includes("MARKET_DISCOVERY")
        ? "NO_EXACT_COMPARABLE"
        : code.includes("IDENTITY") || code.includes("GTIN") || code.includes("MPN")
          ? "IDENTITY_CONFLICT_OR_WEAK"
          : code.includes("PACK") || code.includes("CONTENTS")
            ? "PACK_UNRESOLVED"
            : code.includes("PROFIT") || code.includes("ROI") || code.includes("MARGIN")
              ? "MARKET_BELOW_SAFE_PRICE"
              : code.includes("COMPLIANCE") || code.includes("RESTRICTED")
                ? "COMPLIANCE_BLOCKED"
                : code.includes("WEIGHT") || code.includes("DIMENSION") || code.includes("SHIPPING")
                  ? "LOGISTICS_UNSAFE"
                  : "OTHER"
      counts[bucket] = (counts[bucket] ?? 0) + 1
    }
    return counts
  }, {})
  const { count: remainingCount, error: remainingError } = await input.supabase
    .from("marketplace_listing_approval_queue_scan_targets")
    .select("id", { count: "exact", head: true }).eq("run_id", run.id)
    .in("status", ["PENDING", "PRESELECTED", "CLAIMED", "RETRY_REQUIRED"])
  if (remainingError) throw new Error("TOP20_TARGET_REMAINING_COUNT_FAILED")
  const { count: deepAnalyzedCount, error: examinedError } = await input.supabase
    .from("marketplace_listing_approval_queue_scan_targets")
    .select("id", { count: "exact", head: true }).eq("run_id", run.id)
    .eq("status", "PROCESSED")
  if (examinedError) throw new Error("TOP20_TARGET_EXAMINED_COUNT_FAILED")
  const { count: evidenceReanalysisRemaining, error: evidenceRemainingError } = await input.supabase
    .from("marketplace_listing_approval_queue_scan_targets")
    .select("id", { count: "exact", head: true }).eq("run_id", run.id)
    .gt("evidence_reanalysis_priority", 0)
  if (evidenceRemainingError) throw new Error("TOP20_EVIDENCE_REANALYSIS_REMAINING_COUNT_FAILED")
  const catalogExamined = Number(run.discovery_examined_count ?? total)
  const deepAnalyzed = deepAnalyzedCount ?? 0
  const completed = (remainingCount ?? 0) === 0
  const automationStatus: Top20AutomationStatus = rateLimitedTarget
    ? "PAUSED_RATE_LIMIT" : completed ? "COMPLETED" : "PARTIAL_AUTO_CONTINUING"
  const { error: finishError } = await input.supabase.from("marketplace_listing_approval_queue_runs")
    .update({
      status: completed ? "COMPLETED" : "PARTIAL",
      automation_status: automationStatus,
      scan_phase: completed ? "COMPLETED" : "LOOP1_ANALYSIS",
      checkpoint_offset: catalogExamined,
      last_checkpoint_at: now.toISOString(),
      catalog_examined: catalogExamined,
      candidates_analyzed: deepAnalyzed,
      deep_analyzed_count: deepAnalyzed,
      ready_count: ready,
      needs_data_count: needs,
      rejected_count: rejected,
      go_count: goCount,
      go_with_changes_count: goWithChangesCount,
      no_go_count: noGoCount,
      exact_match_count: exactMatches,
      excluded_internal_count: needs + rejected,
      diagnostic_counts: { ...record(run.diagnostic_counts), ...diagnosticCounts },
      retry_count: Number(run.retry_count ?? 0) + retries,
      identity_enriched_count: Number(run.identity_enriched_count ?? 0) + enrichedCount,
      identity_conflict_count: Number(run.identity_conflict_count ?? 0) + conflictCount,
      catalog_read_count: Number(run.catalog_read_count ?? 0) + catalogReads,
      browse_read_count: Number(run.browse_read_count ?? 0) + browseReads,
      coverage_before: mergeNumericCoverage(run.coverage_before, coverageBefore),
      coverage_after: mergeNumericCoverage(run.coverage_after, coverageAfter),
      source_coverage: mergeNumericCoverage(run.source_coverage, sources),
      lease_owner: null,
      lease_expires_at: null,
      continuation_dispatch_status: completed ? "COMPLETED"
        : automationStatus === "PARTIAL_AUTO_CONTINUING" ? "RETRY_SCHEDULED" : "NOT_SCHEDULED",
      next_continuation_at: automationStatus === "PARTIAL_AUTO_CONTINUING"
        ? now.toISOString() : automationStatus === "PAUSED_RATE_LIMIT"
          ? rateLimitPause?.nextRetryAt ?? null : null,
      rate_limit_consecutive_count: rateLimitPause?.consecutiveCount ?? 0,
      last_rate_limit_retry_after_seconds: rateLimitPause?.retryAfterSeconds ?? null,
      last_rate_limit_backoff_seconds: rateLimitPause?.backoffSeconds ?? null,
      last_rate_limit_source: rateLimitPause?.source ?? null,
      last_rate_limit_observed_at: rateLimitPause?.observedAt ?? null,
      continuation_token_hash: completed ? null : run.continuation_token_hash,
      sold_evidence_applied_version: (evidenceReanalysisRemaining ?? 0) === 0
        ? run.sold_evidence_version ?? run.sold_evidence_applied_version
        : run.sold_evidence_applied_version,
      last_error_code: rateLimitCode,
      last_activity_at: now.toISOString(),
      completed_at: completed ? now.toISOString() : null,
      updated_at: now.toISOString(),
    }).eq("id", run.id).eq("lease_owner", workerId)
  if (finishError) throw new Error("TOP10_SCAN_RUN_FINISH_FAILED")
  return {
    runId: run.id,
    status: automationStatus,
    catalogTotal: total,
    catalogExamined,
    progressPercent: completed ? 100 : Math.round((top20ProgressPercent(catalogExamined, total) * .6 +
      top20ProgressPercent(deepAnalyzed, Number(run.preselected_count ?? 0)) * .4) * 10) / 10,
    phase: completed ? "COMPLETED" : "LOOP1_ANALYSIS",
    preselected: Number(run.preselected_count ?? 0),
    deepAnalyzed,
    go: goCount,
    goWithChanges: goWithChangesCount,
    noGo: noGoCount,
    currentBatch: Number(run.current_batch ?? 0),
    nextContinuationAt: automationStatus === "PARTIAL_AUTO_CONTINUING"
      ? now.toISOString() : rateLimitPause?.nextRetryAt ?? null,
    candidatesAnalyzed: deepAnalyzed,
    ready,
    needsData: needs,
    rejected,
    retries: Number(run.retry_count ?? 0) + retries,
    enriched: Number(run.identity_enriched_count ?? 0) + enrichedCount,
    conflicts: Number(run.identity_conflict_count ?? 0) + conflictCount,
    coverageBefore: mergeNumericCoverage(run.coverage_before, coverageBefore),
    coverageAfter: mergeNumericCoverage(run.coverage_after, coverageAfter),
    sourceCoverage: mergeNumericCoverage(run.source_coverage, sources),
    openAiCalls: 0,
    ebayWrites: 0,
    canPublish: false,
    schedulingEnabled: false,
  }
}

export async function continueListingAiApprovalQueueScan(input: {
  supabase: SupabaseClient
  runId: string
  continuationToken: string
  now?: Date
  environment?: NodeJS.ProcessEnv
  catalogReader?: typeof searchEbayCatalogIdentity
}) {
  const now = input.now ?? new Date()
  const configuration = getTop20AutomationConfiguration(input.environment ?? process.env)
  const run = await validateListingAiApprovalQueueContinuation({
    supabase: input.supabase, runId: input.runId, continuationToken: input.continuationToken,
  })
  if (!isTop20AutomationActive(run.automation_status)) {
    return { runId: run.id, status: run.automation_status as Top20AutomationStatus,
      shouldContinue: false, openAiCalls: 0, ebayWrites: 0 }
  }
  if (Number(run.continuation_attempt_count ?? 0) >= configuration.maxContinuations) {
    await markListingAiApprovalQueueScanFailed({ supabase: input.supabase, runId: run.id,
      continuationToken: input.continuationToken, errorCode: "TOP20_CONTINUATION_LIMIT_REACHED", now })
    throw new Error("TOP20_CONTINUATION_LIMIT_REACHED")
  }
  const result = await runListingAiApprovalQueueBatch({
    supabase: input.supabase, accountKey: run.marketplace_account_key,
    runId: run.id, batchSize: Number(run.batch_size ?? configuration.batchSize),
    timeBudgetMs: Number(run.time_budget_seconds ?? configuration.timeBudgetSeconds) * 1_000,
    now, environment: input.environment, catalogReader: input.catalogReader,
  })
  return { ...result, shouldContinue: result.status === "PARTIAL_AUTO_CONTINUING" }
}

export async function continueListingAiApprovalQueueScanFromQueue(input: {
  supabase: SupabaseClient
  runId: string
  continuationGeneration: number
  expectedBatch: number
  now?: Date
  environment?: NodeJS.ProcessEnv
  catalogReader?: typeof searchEbayCatalogIdentity
}) {
  const now = input.now ?? new Date()
  const configuration = getTop20AutomationConfiguration(input.environment ?? process.env)
  const run = await validateListingAiApprovalQueueQueueContinuation({
    supabase: input.supabase,
    runId: input.runId,
    continuationGeneration: input.continuationGeneration,
  })
  if (!isTop20AutomationActive(run.automation_status)) return {
    runId: run.id,
    status: run.automation_status as Top20AutomationStatus,
    currentBatch: Number(run.current_batch ?? 0),
    shouldContinue: false,
    openAiCalls: 0,
    ebayWrites: 0,
  }
  if (Number(run.continuation_attempt_count ?? 0) >= configuration.maxContinuations) {
    await markListingAiApprovalQueueScanFailedTrusted({
      supabase: input.supabase,
      runId: run.id,
      continuationGeneration: input.continuationGeneration,
      errorCode: "TOP20_CONTINUATION_LIMIT_REACHED",
      now,
    })
    throw new Error("TOP20_CONTINUATION_LIMIT_REACHED")
  }
  const result = await runListingAiApprovalQueueBatch({
    supabase: input.supabase,
    accountKey: run.marketplace_account_key,
    runId: run.id,
    batchSize: Number(run.batch_size ?? configuration.batchSize),
    timeBudgetMs: Number(run.time_budget_seconds ?? configuration.timeBudgetSeconds) * 1_000,
    expectedBatch: input.expectedBatch,
    now,
    environment: input.environment,
    catalogReader: input.catalogReader,
  })
  return { ...result, shouldContinue: result.status === "PARTIAL_AUTO_CONTINUING" }
}

export async function validateListingAiApprovalQueueContinuation(input: {
  supabase: SupabaseClient
  runId: string
  continuationToken: string
}) {
  const { data: run, error } = await input.supabase.from("marketplace_listing_approval_queue_runs")
    .select("*").eq("id", input.runId).eq("marketplace", MARKETPLACE).maybeSingle()
  if (error || !run) throw new Error("TOP20_CONTINUATION_RUN_NOT_FOUND")
  if (!verifyTop20ContinuationToken(input.continuationToken, run.continuation_token_hash)) {
    throw new Error("TOP20_CONTINUATION_TOKEN_REJECTED")
  }
  return run
}

export async function validateListingAiApprovalQueueQueueContinuation(input: {
  supabase: SupabaseClient
  runId: string
  continuationGeneration: number
}) {
  const { data: run, error } = await input.supabase.from("marketplace_listing_approval_queue_runs")
    .select("*").eq("id", input.runId).eq("marketplace", MARKETPLACE).maybeSingle()
  if (error || !run) throw new Error("TOP20_CONTINUATION_RUN_NOT_FOUND")
  if (!Number.isInteger(input.continuationGeneration) || input.continuationGeneration < 1 ||
    Number(run.continuation_generation ?? 0) !== input.continuationGeneration) {
    throw new Error("TOP20_CONTINUATION_TOKEN_REJECTED")
  }
  return run
}

export async function getListingAiApprovalQueueDispatchContext(input: {
  supabase: SupabaseClient
  runId: string
  continuationGeneration: number
}) {
  const run = await validateListingAiApprovalQueueQueueContinuation(input)
  return {
    accountKey: run.marketplace_account_key as string,
    continuationGeneration: Number(run.continuation_generation),
    attemptOffset: Number(run.dispatch_attempt_count ?? 0),
    currentBatch: Number(run.current_batch ?? 0),
    status: run.automation_status as Top20AutomationStatus,
  }
}

export async function persistListingAiApprovalQueueDispatchAttempt(input: {
  supabase: SupabaseClient
  runId: string
  continuationGeneration: number
  diagnostic: Top20DispatchDiagnostic
}) {
  const run = await validateListingAiApprovalQueueQueueContinuation({
    supabase: input.supabase,
    runId: input.runId,
    continuationGeneration: input.continuationGeneration,
  })
  const diagnostic = input.diagnostic
  const { error: insertError } = await input.supabase
    .from("marketplace_listing_approval_queue_dispatch_attempts")
    .upsert({
      run_id: run.id,
      marketplace_account_key: run.marketplace_account_key,
      marketplace: MARKETPLACE,
      continuation_generation: input.continuationGeneration,
      attempt_number: diagnostic.attemptNumber,
      transport: diagnostic.transport,
      outcome: diagnostic.outcome,
      http_status: diagnostic.httpStatus,
      error_class: diagnostic.errorClass,
      elapsed_ms: diagnostic.elapsedMs,
      host_fingerprint: diagnostic.hostFingerprint,
      bypass_configured: diagnostic.bypassConfigured,
      protection_cookie_present: diagnostic.protectionCookiePresent,
      x_vercel_id: diagnostic.xVercelId,
      queue_message_fingerprint: diagnostic.queueMessageFingerprint,
      observed_at: diagnostic.observedAt,
    }, {
      onConflict: "run_id,continuation_generation,attempt_number,transport",
      ignoreDuplicates: true,
    })
  if (insertError) throw new Error("TOP20_DISPATCH_DIAGNOSTIC_PERSIST_FAILED")
  const dispatchStatus = diagnostic.outcome === "ACCEPTED"
    ? "QUEUED"
    : diagnostic.outcome === "PAUSED_RECOVERABLE"
      ? "PAUSED_DISPATCH_RECOVERABLE"
      : "DISPATCHING"
  const { error: updateError } = await input.supabase
    .from("marketplace_listing_approval_queue_runs")
    .update({
      continuation_dispatch_status: dispatchStatus,
      dispatch_attempt_count: Math.max(Number(run.dispatch_attempt_count ?? 0), diagnostic.attemptNumber),
      last_dispatch_error_class: diagnostic.errorClass,
      last_dispatch_http_status: diagnostic.httpStatus,
      last_dispatch_elapsed_ms: diagnostic.elapsedMs,
      last_dispatch_observed_at: diagnostic.observedAt,
      last_dispatch_host_fingerprint: diagnostic.hostFingerprint,
      last_dispatch_bypass_configured: diagnostic.bypassConfigured,
      last_dispatch_protection_cookie_present: diagnostic.protectionCookiePresent,
      last_dispatch_x_vercel_id: diagnostic.xVercelId,
      last_queue_message_fingerprint: diagnostic.queueMessageFingerprint,
      updated_at: diagnostic.observedAt,
    })
    .eq("id", run.id)
    .eq("continuation_generation", input.continuationGeneration)
  if (updateError) throw new Error("TOP20_DISPATCH_DIAGNOSTIC_RUN_UPDATE_FAILED")
}

export async function markListingAiApprovalQueueDispatchRecoverable(input: {
  supabase: SupabaseClient
  runId: string
  continuationGeneration: number
  diagnostic?: Top20DispatchDiagnostic | null
  now?: Date
}) {
  const now = input.now ?? new Date()
  const run = await validateListingAiApprovalQueueQueueContinuation({
    supabase: input.supabase,
    runId: input.runId,
    continuationGeneration: input.continuationGeneration,
  })
  if (input.diagnostic) await persistListingAiApprovalQueueDispatchAttempt({
    supabase: input.supabase,
    runId: input.runId,
    continuationGeneration: input.continuationGeneration,
    diagnostic: { ...input.diagnostic, outcome: "PAUSED_RECOVERABLE" },
  })
  const { error } = await input.supabase.from("marketplace_listing_approval_queue_runs")
    .update({
      status: "PARTIAL",
      automation_status: "PARTIAL_AUTO_CONTINUING",
      continuation_dispatch_status: "PAUSED_DISPATCH_RECOVERABLE",
      lease_owner: null,
      lease_expires_at: null,
      next_continuation_at: null,
      last_error_code: "TOP20_CONTINUATION_DISPATCH_FAILED",
      last_checkpoint_at: run.last_checkpoint_at ?? run.last_activity_at ?? run.updated_at,
      last_activity_at: now.toISOString(),
      completed_at: null,
      updated_at: now.toISOString(),
    })
    .eq("id", run.id)
    .eq("continuation_generation", input.continuationGeneration)
  if (error) throw new Error("TOP20_DISPATCH_RECOVERABLE_PERSIST_FAILED")
}

async function markListingAiApprovalQueueScanFailedTrusted(input: {
  supabase: SupabaseClient
  runId: string
  continuationGeneration: number
  errorCode: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const run = await validateListingAiApprovalQueueQueueContinuation({
    supabase: input.supabase,
    runId: input.runId,
    continuationGeneration: input.continuationGeneration,
  })
  const safeCode = /^[A-Z0-9_]+$/.test(input.errorCode)
    ? input.errorCode
    : "TOP20_CONTINUATION_FAILED"
  const { error } = await input.supabase.from("marketplace_listing_approval_queue_runs")
    .update({
      status: "FAILED",
      automation_status: "FAILED",
      continuation_dispatch_status: "COMPLETED",
      continuation_token_hash: null,
      lease_owner: null,
      lease_expires_at: null,
      next_continuation_at: null,
      last_error_code: safeCode,
      last_activity_at: now.toISOString(),
      completed_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", run.id)
    .eq("continuation_generation", input.continuationGeneration)
  if (error) throw new Error("TOP20_CONTINUATION_FAILURE_PERSIST_FAILED")
}

export async function markListingAiApprovalQueueScanFailed(input: {
  supabase: SupabaseClient
  runId: string
  continuationToken: string
  errorCode: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const { data: run, error } = await input.supabase.from("marketplace_listing_approval_queue_runs")
    .select("continuation_token_hash").eq("id", input.runId).maybeSingle()
  if (error || !run || !verifyTop20ContinuationToken(
    input.continuationToken, run.continuation_token_hash,
  )) throw new Error("TOP20_CONTINUATION_TOKEN_REJECTED")
  const safeCode = /^[A-Z0-9_]+$/.test(input.errorCode) ? input.errorCode : "TOP20_CONTINUATION_FAILED"
  if (RECOVERABLE_DISPATCH_ERRORS.has(safeCode)) {
    const { error: recoverableError } = await input.supabase
      .from("marketplace_listing_approval_queue_runs")
      .update({ status: "PARTIAL", automation_status: "PARTIAL_AUTO_CONTINUING",
        continuation_dispatch_status: "PAUSED_DISPATCH_RECOVERABLE",
        lease_owner: null, lease_expires_at: null, next_continuation_at: null,
        last_error_code: safeCode, last_activity_at: now.toISOString(),
        completed_at: null, updated_at: now.toISOString() }).eq("id", input.runId)
    if (recoverableError) throw new Error("TOP20_DISPATCH_RECOVERABLE_PERSIST_FAILED")
    return
  }
  const { error: updateError } = await input.supabase.from("marketplace_listing_approval_queue_runs")
    .update({ status: "FAILED", automation_status: "FAILED",
      continuation_dispatch_status: "COMPLETED", continuation_token_hash: null,
      lease_owner: null, lease_expires_at: null, next_continuation_at: null,
      last_error_code: safeCode, last_activity_at: now.toISOString(),
      completed_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", input.runId)
  if (updateError) throw new Error("TOP20_CONTINUATION_FAILURE_PERSIST_FAILED")
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
      .select("id,market_radar_product_id,supplier_product_id,supplier_variant_id,supplier_sku,discovery_strategy,luna_match_status,product_identity_fingerprint,base_product_fingerprint,offer_pack_fingerprint,decision_package_id,package_hash,cohort,internal_status,pool_rank,rank,ranking_score,reason_codes,evidence_snapshot,retry_count,next_retry_at,last_error_code,stale_after,operator_action,supplier_price_observed,supplier_availability_confirmation,supplier_unit_quantity,stock_confidence,recommended_pack_count,available_offer_pack_capacity,ebay_listing_quantity,supplier_shipping_cost_status,supplier_shipping_reserve_usd,supplier_confirmed_at,approved_at,discarded_at,analyzed_at")
      .eq("run_id", run.id).eq("marketplace_account_key", accountKey)
      .order("cohort", { ascending: true }).order("rank", { ascending: true, nullsFirst: false })
      .order("ranking_score", { ascending: false }).limit(300)
    : { data: [], error: null }
  if (itemsError) throw new Error("TOP10_ITEMS_READ_FAILED")
  const currentItems = items ?? []
  const isFresh = (row: { stale_after: string }) => Date.parse(row.stale_after) > Date.now()
  const automationStatus = (run?.automation_status ?? (run?.status === "COMPLETED"
    ? "COMPLETED" : run ? "PARTIAL_AUTO_CONTINUING" : "NOT_STARTED")) as Top20AutomationStatus
  const dispatchStatus = text(run?.continuation_dispatch_status) ?? "NOT_SCHEDULED"
  const visibleAutomationStatus = dispatchStatus === "PAUSED_DISPATCH_RECOVERABLE"
    ? "PAUSED_DISPATCH_RECOVERABLE"
    : automationStatus
  const automationStarted = automationStatus !== "NOT_STARTED"
  const visibleResults = automationStatus === "COMPLETED"
  const discoveryProgress = top20ProgressPercent(
    automationStarted ? Number(run?.discovery_examined_count ?? 0) : 0,
    Number(run?.catalog_total ?? 0),
  )
  const loop1Progress = top20ProgressPercent(
    automationStarted ? Number(run?.deep_analyzed_count ?? 0) : 0,
    automationStarted ? Number(run?.preselected_count ?? 0) : 0,
  )
  const sanitizedRun = run ? {
    id: run.id,
    status: visibleAutomationStatus,
    automation_status: automationStatus,
    dispatch_status: dispatchStatus,
    phase: run.scan_phase ?? "DISCOVERY",
    catalog_total: Number(run.catalog_total ?? 0),
    catalog_examined: automationStarted ? Number(run.discovery_examined_count ?? 0) : 0,
    candidates_analyzed: automationStarted ? Number(run.deep_analyzed_count ?? 0) : 0,
    preselected_count: automationStarted ? Number(run.preselected_count ?? 0) : 0,
    ready_count: automationStarted ? Number(run.ready_count ?? 0) : 0,
    go_count: automationStarted ? Number(run.go_count ?? 0) : 0,
    go_with_changes_count: automationStarted ? Number(run.go_with_changes_count ?? 0) : 0,
    no_go_count: automationStarted ? Number(run.no_go_count ?? 0) : 0,
    needs_data_count: Number(run.needs_data_count ?? 0),
    rejected_count: Number(run.rejected_count ?? 0),
    retry_count: Number(run.retry_count ?? 0),
    identity_enriched_count: Number(run.identity_enriched_count ?? 0),
    identity_conflict_count: Number(run.identity_conflict_count ?? 0),
    catalog_read_count: Number(run.catalog_read_count ?? 0),
    browse_read_count: Number(run.browse_read_count ?? 0),
    exact_match_count: Number(run.exact_match_count ?? 0),
    excluded_internal_count: Number(run.excluded_internal_count ?? 0),
    current_batch: Number(run.current_batch ?? 0),
    continuation_attempt_count: Number(run.continuation_attempt_count ?? 0),
    dispatch_attempt_count: Number(run.dispatch_attempt_count ?? 0),
    dispatch_recovery_count: Number(run.dispatch_recovery_count ?? 0),
    progress_percent: automationStatus === "COMPLETED" ? 100
      : Math.round((discoveryProgress * .6 + loop1Progress * .4) * 10) / 10,
    last_activity_at: automationStarted ? run.last_activity_at ?? run.updated_at ?? null : null,
    last_checkpoint_at: automationStarted ? run.last_checkpoint_at ?? run.last_activity_at ?? null : null,
    next_continuation_at: automationStarted ? run.next_continuation_at ?? null : null,
    last_error_code: automationStarted ? text(run.last_error_code) : null,
    rate_limit: {
      consecutiveCount: Number(run.rate_limit_consecutive_count ?? 0),
      retryAfterSeconds: number(run.last_rate_limit_retry_after_seconds),
      backoffSeconds: number(run.last_rate_limit_backoff_seconds),
      source: text(run.last_rate_limit_source),
      observedAt: run.last_rate_limit_observed_at ?? null,
    },
    error_recoverable: dispatchStatus === "PAUSED_DISPATCH_RECOVERABLE",
    dispatch_diagnostic: {
      errorClass: text(run.last_dispatch_error_class),
      httpStatus: number(run.last_dispatch_http_status),
      elapsedMs: number(run.last_dispatch_elapsed_ms),
      observedAt: run.last_dispatch_observed_at ?? null,
      hostFingerprint: text(run.last_dispatch_host_fingerprint),
      bypassConfigured: run.last_dispatch_bypass_configured === true,
      protectionCookiePresent: run.last_dispatch_protection_cookie_present === true,
      xVercelId: text(run.last_dispatch_x_vercel_id),
      queueMessageFingerprint: text(run.last_queue_message_fingerprint),
    },
    priority_counts: record(run.priority_counts),
    diagnostic_counts: record(run.diagnostic_counts),
    coverage_before: record(run.coverage_before),
    coverage_after: record(run.coverage_after),
    source_coverage: record(run.source_coverage),
    ebay_first_status: text(run.ebay_first_status) ?? "NOT_STARTED",
    ebay_first_category_count: Number(run.ebay_first_category_count ?? 0),
    ebay_first_signal_count: Number(run.ebay_first_signal_count ?? 0),
    ebay_first_exact_luna_match_count: Number(run.ebay_first_exact_luna_match_count ?? 0),
    ebay_first_match_counts: record(run.ebay_first_match_counts),
    ebay_first_observed_at: run.ebay_first_observed_at ?? null,
    scheduling_enabled: false,
  } : null
  return {
    run: sanitizedRun,
    pool: visibleResults ? currentItems.filter((row) => row.pool_rank &&
      ["READY_FOR_OPERATOR_APPROVAL", "READY_FOR_OPENAI_APPROVAL"].includes(row.internal_status) &&
      isFresh(row)).sort((left, right) =>
      Number(left.pool_rank) - Number(right.pool_rank)) : [],
    ready: visibleResults ? currentItems.filter((row) => row.cohort === "READY_FOR_OPERATOR_APPROVAL" &&
      row.rank && isFresh(row)) : [],
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
  const supplierUnitsPerOffer = positiveInteger(pack.stockRequired) ?? 1
  const reserve = number(item.supplier_shipping_reserve_usd) ??
    supplierReserve(input.environment ?? process.env)
  const confirmation = buildLunaOperatorConfirmation({
    priceObserved: input.priceObserved,
    availability: input.availability,
    exactQuantity: input.exactQuantity,
    recommendedPackCount,
    supplierUnitsPerOffer,
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
  const marketEvidence = record(payload.marketEvidence)
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
    supplierPackageCost: confirmation.supplierPriceObserved * confirmation.supplierUnitsPerOffer,
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
    marketEvidence: {
      activeSellerCount: number(marketEvidence.activeSellerCount),
      verifiedSoldSellerCount: number(marketEvidence.verifiedSoldSellerCount),
      estimatedSoldSellerCount: number(marketEvidence.estimatedSoldSellerCount),
      totalVerifiedSoldQuantity: number(marketEvidence.totalVerifiedSoldQuantity),
      totalEstimatedSoldQuantity: number(marketEvidence.totalEstimatedSoldQuantity),
      evidenceBasis: text(marketEvidence.evidenceBasis),
      discoveryOrigin: marketEvidence.discoveryOrigin === "EBAY_FIRST"
        ? "EBAY_FIRST" : marketEvidence.discoveryOrigin === "LUNA_FIRST" ? "LUNA_FIRST" : null,
      ebayFirstDemandEvidence: text(marketEvidence.ebayFirstDemandEvidence),
      crossSourceCorroborated: marketEvidence.crossSourceCorroborated === true,
      activeAndSoldSeparated: marketEvidence.activeAndSoldSeparated !== false,
    },
    packStrategyEvidence: { offers: [{
      packCount: confirmation.recommendedPackCount,
      unitCountPerItem: number(identity.unitCount),
      exactContents: strings(intake.includedContents),
      offerGtin: confirmation.recommendedPackCount === 1 && identity.gtinValid === true ? text(identity.gtin) : null,
      offerGtinVerified: confirmation.recommendedPackCount === 1 && identity.gtinValid === true,
      cost: confirmation.supplierPriceObserved * confirmation.supplierUnitsPerOffer,
      shippingCost: outbound + confirmation.supplierShippingReserveUsd,
      stockRequired: confirmation.supplierUnitsPerOffer,
      stockAvailable: confirmation.supplierUnitQuantity ?? confirmation.availableOfferPackCapacity,
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
    imageAuthorizationSource: record(snapshot.product).imageAuthorizationSource === "PRODUCT_METADATA"
      ? "PRODUCT_METADATA"
      : record(snapshot.product).imageAuthorizationSource === "LUNA_PORTEX_PREVIEW_OPERATOR_AUTHORIZATION"
        ? "LUNA_PORTEX_PREVIEW_OPERATOR_AUTHORIZATION" : null,
    supplierCost: confirmation.supplierPriceObserved, available: true,
    inventoryQuantity: confirmation.availableOfferPackCapacity, capturedAt: now.toISOString(),
    manufacturerBrand: text(identity.manufacturerBrand), gtin: text(identity.gtin), gtinValid: identity.gtinValid === true,
    mpn: text(identity.mpn), model: text(identity.model), productName: text(identity.normalizedProductName),
    packCount: confirmation.recommendedPackCount, unitCount: number(identity.unitCount), size: text(identity.size),
    color: text(identity.color), scent: text(identity.scent), variant: text(identity.variant), condition: text(identity.condition),
    weight: number(logistics.weight), weightUnit: text(logistics.weightUnit), dimensions: dims,
    logisticsStatus: record(snapshot.logistics).supplierShippingCostStatus === "CONFIRMED" ? "CONFIRMED" : "ESTIMATED",
    identityConflictAttributes: [],
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
  const refreshedSnapshot = {
    ...safeEvidenceSnapshot({ candidate, evidence, pack: refreshedPack }),
    strategicIntelligence: snapshot.strategicIntelligence ?? null,
    optimizationEvidence: snapshot.optimizationEvidence ?? null,
    discovery: snapshot.discovery ?? null,
  }
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
