import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { materializeSellerOsDeterministicFactoryCandidateV1 } from
  "./ebay-smart-stocking-durable-factory-v1"
import { officialSoldEvidenceComparablesForTarget,
  readReviewedOfficialSoldEvidence } from
  "./ebay-official-sold-evidence-import"
import { runEbaySellerKeywordDemandValidation,
  searchEbayCatalogIdentity } from
  "./ebay-seller-keyword-demand-gateway"
import type { EbaySellerKeywordCandidate } from
  "./ebay-seller-keyword-demand-validation"
import { quickPickActiveComparableObservationV1,
  QUICK_PICK_EXACT_SOLD_PRODUCT_TRUTH_V1,
  quickPickSoldComparableObservationV1,
  resolveQuickPickExactSoldProductTruthV1 } from
  "./ebay-quick-pick-exact-sold-product-truth-v1"
import type { ProductIdentityInput } from "./ebay-winner-evidence-v2"
import type { RadarMarketplaceTaxonomyReaderV1,
  RadarProductIdentifierPolicyReaderV1 } from
  "./ebay-radar-canonical-marketplace-readiness-v1"

export const QUICK_PICK_EXACT_SOLD_MARKET_ENRICHMENT_V1 =
  "QUICK_PICK_EXACT_SOLD_MARKET_ENRICHMENT_V2" as const

const MAXIMUM_QUICK_PICKS = 20
const STALE_CLAIM_MS = 5 * 60 * 1_000
const LOOKUP_CONCURRENCY = 2
type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum)
    : null
}

function normalized(value: unknown) {
  return text(value)?.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim() ?? ""
}

function canonical(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") return `{${Object.entries(
    value as JsonRecord).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`
  return JSON.stringify(value)
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`
}

function unique(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))]
}

function exactValue(values: JsonRecord, name: string) {
  const entry = Object.entries(values).find(([candidate]) =>
    normalized(candidate) === normalized(name))
  return text(entry?.[1], 500)
}

function resolvedBatchValue(assessment: JsonRecord, name: string) {
  const resolution = rows(record(assessment
    .marketplaceRequiredSpecificsBatchResolutionV1).resolutions)
    .find((entry) => normalized(entry.aspectName) === normalized(name)
      && entry.humanReviewRequired !== true)
  return text(resolution?.resolvedValue, 500)
}

export function quickPickExactSoldCandidateIdentityV1(
  row: JsonRecord,
): ProductIdentityInput {
  const assessment = record(row.assessment)
  const truth = record(assessment.productTruth)
  const values = record(truth.provenProductValues)
  const value = (name: string) => exactValue(values, name)
    ?? resolvedBatchValue(assessment, name)
  const pack = Number(value("Number in Pack") ?? value("Pack Quantity"))
  return Object.freeze({
    productName: text(truth.title ?? row.product_title, 350),
    manufacturerBrand: value("Brand"),
    gtin: text(row.gtin ?? truth.gtin, 40),
    mpn: value("MPN"), model: value("Model"),
    size: value("Size"), color: value("Color"),
    variant: value("Variant"),
    packCount: Number.isInteger(pack) && pack > 0 ? pack : null,
  })
}

function ownerResidualNames(assessment: JsonRecord) {
  const continuation = record(
    assessment.quickPickRequiredSpecificsContinuationV1)
  const actions = rows(continuation.residualOwnerActions)
  return unique(actions.flatMap((entry) =>
    text(entry.exactUnresolvedField ?? entry.productField, 120)
      ? [text(entry.exactUnresolvedField ?? entry.productField, 120)!] : []))
}

function safeErrorCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_]{2,119}$/.test(code)
    ? code : "EXACT_SOLD_MARKET_LOOKUP_FAILED"
}

async function mapWithConcurrency<T, R>(values: readonly T[], concurrency: number,
  mapper: (value: T) => Promise<R>) {
  const output = new Array<R>(values.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor++
        output[index] = await mapper(values[index])
      }
    }))
  return output
}

function keywordCandidate(identity: ProductIdentityInput,
  row: JsonRecord): EbaySellerKeywordCandidate {
  const assessment = record(row.assessment)
  const readiness = record(assessment.canonicalMarketplaceReadinessV1)
  return Object.freeze({ productName: identity.productName,
    productTitle: identity.productName,
    supplierSku: text(row.supplier_sku, 120),
    categoryId: text(readiness.categoryId, 40), gtin: identity.gtin,
    brand: identity.manufacturerBrand, mpn: identity.mpn,
    model: identity.model, color: identity.color, size: identity.size,
    packQuantity: identity.packCount })
}

function applyPromotedFactsToTruth(assessment: JsonRecord,
  promoted: Readonly<Record<string, string>>, evidence: JsonRecord) {
  const truth = record(assessment.productTruth)
  const values = { ...record(truth.provenProductValues) }
  for (const [name, value] of Object.entries(promoted)) values[name] = value
  const resolvedKeys = new Set(Object.keys(promoted).map(normalized))
  const knownUnknownAspectNames = Array.isArray(truth.knownUnknownAspectNames)
    ? truth.knownUnknownAspectNames.filter((value) =>
      !resolvedKeys.has(normalized(value))) : []
  const requirements = { ...record(truth.unprovenAspectEvidenceRequirements) }
  for (const name of Object.keys(requirements)) {
    if (resolvedKeys.has(normalized(name))) delete requirements[name]
  }
  const { evidenceDigest: _previousDigest, ...previousTruth } = truth
  const truthCore = { ...previousTruth, provenProductValues: values,
    knownUnknownAspectNames,
    unprovenAspectEvidenceRequirements: requirements,
    sourceEvidence: { ...record(truth.sourceEvidence),
      exactSoldMarketEnrichmentV1: evidence } }
  return Object.freeze({ ...truthCore, evidenceDigest: digest(truthCore) })
}

function mergeRequiredSpecificsMarker(assessment: JsonRecord,
  promoted: Readonly<Record<string, string>>, factTraces: readonly JsonRecord[]) {
  const marker = record(assessment.quickPickRequiredSpecificsContinuationV1)
  const resolvedKeys = new Set(Object.keys(promoted).map(normalized))
  if (!resolvedKeys.size) return marker
  const residualOwnerActions = rows(marker.residualOwnerActions).filter((entry) =>
    !resolvedKeys.has(normalized(entry.exactUnresolvedField
      ?? entry.productField)))
  const exactUnresolvedFields = (Array.isArray(marker.exactUnresolvedFields)
    ? marker.exactUnresolvedFields : []).filter((value) =>
    !resolvedKeys.has(normalized(value)))
  const promotedTraces = factTraces.filter((trace) =>
    trace.promotionToProductTruthAllowed === true).map((trace) => ({
      specificName: trace.specificName, resolvedValue: trace.candidateValue,
      sourceAuthority: "EXACT_EBAY_MARKET_MULTI_SOURCE",
      sourceFieldOrText: "SANITIZED_MULTI_SOURCE_MARKET_FACT",
      resolutionClass: "EXACT_SOLD_MARKET_CORROBORATION",
      confidence: trace.identityConfidence,
      ownerConfirmationRequired: false, factInvented: false,
    }))
  return Object.freeze({ ...marker,
    exactUnresolvedFields, finalUnresolvedFieldCount: exactUnresolvedFields.length,
    residualOwnerActions,
    resolvedFieldAudits: [...rows(marker.resolvedFieldAudits),
      ...promotedTraces],
    requiredSpecificFactTraces: [...rows(marker.requiredSpecificFactTraces),
      ...promotedTraces],
    externalExactIdentityResolvedCount:
      Number(marker.externalExactIdentityResolvedCount ?? 0)
      + Object.keys(promoted).length,
    finalDisposition: residualOwnerActions.some((entry) =>
      entry.ownerAction === "ENTER_FACT") ? "OWNER_FACT_REQUIRED"
      : residualOwnerActions.length ? "OWNER_CONFIRMATION_REQUIRED"
        : "REQUIRED_SPECIFICS_REEVALUATION_PENDING",
    ownerLastMileOnly: residualOwnerActions.length > 0,
    factInvented: false, marketplaceWrites: 0 })
}

export async function continueLunaQuickPickExactSoldEnrichmentV1(
  input: Readonly<{
    supabase: SupabaseClient
    accountKey: string
    candidateKeys: readonly string[]
    taxonomyReader: RadarMarketplaceTaxonomyReaderV1
    productIdentifierPolicyReader?: RadarProductIdentifierPolicyReaderV1
    soldEvidenceReader?: typeof readReviewedOfficialSoldEvidence
    marketReader?: typeof runEbaySellerKeywordDemandValidation
    catalogReader?: typeof searchEbayCatalogIdentity
  }>) {
  const candidateKeys = unique(input.candidateKeys.filter((value) =>
    /^sha256:[0-9a-f]{64}$/.test(value))).slice(0, MAXIMUM_QUICK_PICKS)
  if (!candidateKeys.length) return Object.freeze({ attempted: 0, claimed: 0,
    exactSoldProductsFound: 0, soldMarketFactsAutoResolved: 0,
    marketplaceWrites: 0 as const })
  const read = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,product_title,gtin,assessment,updated_at")
    .in("candidate_key", candidateKeys).limit(MAXIMUM_QUICK_PICKS)
  if (read.error) throw new Error("LUNA_QUICK_PICK_EXACT_SOLD_READ_FAILED")
  const claimed: JsonRecord[] = []
  let reconciledMarkers = 0
  for (const row of rows(read.data)) {
    const assessment = record(row.assessment)
    const specifics = record(
      assessment.quickPickRequiredSpecificsContinuationV1)
    const current = record(assessment.quickPickExactSoldMarketEnrichmentV1)
    const claimedAt = Date.parse(String(current.claimedAt ?? ""))
    const stale = Boolean(current.contractVersion ===
      QUICK_PICK_EXACT_SOLD_MARKET_ENRICHMENT_V1 && !current.completedAt
      && Number.isFinite(claimedAt) && Date.now() - claimedAt >= STALE_CLAIM_MS)
    const residualNames = ownerResidualNames(assessment)
    if (current.completedAt && current.contractVersion ===
        QUICK_PICK_EXACT_SOLD_PRODUCT_TRUTH_V1 && !residualNames.length) {
      const reconciled = await input.supabase.from(
        "ebay_luna_opportunity_queue").update({ assessment: { ...assessment,
          quickPickExactSoldMarketEnrichmentV1: { ...current,
            contractVersion: QUICK_PICK_EXACT_SOLD_MARKET_ENRICHMENT_V1,
            resolverContractVersion: QUICK_PICK_EXACT_SOLD_PRODUCT_TRUTH_V1,
            markerReconciledAt: new Date().toISOString(),
          } }, updated_at: new Date().toISOString() })
        .eq("id", row.id).eq("candidate_key", row.candidate_key)
        .eq("updated_at", row.updated_at).select("id").maybeSingle()
      if (!reconciled.error && reconciled.data) reconciledMarkers += 1
      continue
    }
    const systemicVersionUpgrade = Boolean(current.completedAt
      && current.contractVersion !==
        QUICK_PICK_EXACT_SOLD_MARKET_ENRICHMENT_V1)
    if (!specifics.completedAt || !residualNames.length ||
      (current.completedAt && !systemicVersionUpgrade) ||
      (current.claimedAt && !current.completedAt && !stale)) continue
    const now = new Date().toISOString()
    const marker = { contractVersion:
      QUICK_PICK_EXACT_SOLD_MARKET_ENRICHMENT_V1,
    claimedAt: now, completedAt: null,
    priorCompletedAt: systemicVersionUpgrade ? current.completedAt : null,
    systemicVersionUpgrade,
    stageAuthority: "REQUIRED_SPECIFICS_PRODUCT_TRUTH_CONTINUATION",
    residualSpecificNamesBefore: residualNames,
    internalResolversRepeated: false,
    identityDuplicateDemandShippingEconomicsCategoryRepeated: false,
    marketLookupBounded: true, maximumCandidates: MAXIMUM_QUICK_PICKS,
    lookupConcurrency: LOOKUP_CONCURRENCY,
    factInvented: false, marketplaceWrites: 0 }
    const claim = await input.supabase.from("ebay_luna_opportunity_queue")
      .update({ assessment: { ...assessment,
        quickPickExactSoldMarketEnrichmentV1: marker }, updated_at: now })
      .eq("id", row.id).eq("candidate_key", row.candidate_key)
      .eq("updated_at", row.updated_at).select("*").maybeSingle()
    if (!claim.error && claim.data) claimed.push(record(claim.data))
  }
  if (!claimed.length) return Object.freeze({ attempted: candidateKeys.length,
    claimed: 0, reconciledMarkers, exactSoldProductsFound: 0,
    soldMarketFactsAutoResolved: 0,
    futureQuickPickExactSoldEnrichment: true as const,
    skuSpecialCases: 0 as const,
    historicalBatchSpecialCase: false as const,
    familyEvidencePromotedToProductTruth: false as const,
    aiCallCount: 0 as const, factInvented: false as const,
    newOperationCount: 0 as const, duplicateOperationCount: 0 as const,
    marketplaceWrites: 0 as const })

  const soldRows = await (input.soldEvidenceReader
    ?? readReviewedOfficialSoldEvidence)({ supabase: input.supabase,
      accountKey: input.accountKey })
  const results = await mapWithConcurrency(claimed, LOOKUP_CONCURRENCY,
    async (row) => {
      const assessment = record(row.assessment)
      const requiredSpecificNames = ownerResidualNames(assessment)
      const candidate = quickPickExactSoldCandidateIdentityV1(row)
      const soldComparables = officialSoldEvidenceComparablesForTarget({
        targetIdentity: candidate, rows: soldRows,
        targetSupplierVariantId: text(row.supplier_variant_id, 80),
      })
      const searchableNames = requiredSpecificNames.filter((name) =>
        !["condition", "upc", "ean", "gtin", "isbn"]
          .includes(normalized(name)))
      const exactAnchorPresent = Boolean(text(candidate.gtin, 40)
        || text(candidate.mpn, 120) || text(candidate.model, 120))
      let market: JsonRecord = {}
      let catalog: Awaited<ReturnType<typeof searchEbayCatalogIdentity>> = {
        status: "NO_MATCH", products: [], observedAt: new Date().toISOString(),
        source: "EBAY_CATALOG_OFFICIAL_READONLY" }
      let safeFailureCode: string | null = null
      if (searchableNames.length && exactAnchorPresent) {
        try {
          const query = keywordCandidate(candidate, row)
          const [marketResult, catalogResult] = await Promise.all([
            (input.marketReader ?? runEbaySellerKeywordDemandValidation)(query),
            (input.catalogReader ?? searchEbayCatalogIdentity)({
              query: text(candidate.productName, 350) ?? "",
              gtin: candidate.gtin, mpn: candidate.mpn ?? candidate.model,
              categoryId: query.categoryId,
            }),
          ])
          market = record(marketResult)
          catalog = catalogResult
        } catch (error) {
          safeFailureCode = safeErrorCode(error)
        }
      }
      const active = rows(market.comparableEvidence).flatMap((entry) => {
        const observation = quickPickActiveComparableObservationV1(entry)
        return observation ? [observation] : []
      })
      const enrichment = resolveQuickPickExactSoldProductTruthV1({
        candidate, requiredSpecificNames,
        observations: [
          ...soldComparables.map(quickPickSoldComparableObservationV1),
          ...active,
        ],
        catalogProducts: catalog.products,
      })
      const { contractVersion: resolverContractVersion,
        ...enrichmentEvidence } = enrichment
      const evidenceCore = { ...enrichmentEvidence,
        resolverContractVersion,
        sourceOrder: ["DURABLE_OFFICIAL_SOLD_AND_RESEARCH",
          "OFFICIAL_EBAY_MARKETPLACE_READONLY", "NIGHT_RADAR_FAMILY_CONTEXT"],
        durableSoldEvidenceCandidateCount: soldComparables.length,
        activeEvidenceCandidateCount: active.length,
        officialCatalogStatus: catalog.status,
        marketLookupAttempted: Boolean(searchableNames.length
          && exactAnchorPresent),
        safeFailureCode,
        nightRadarUsage: "FAMILY_CATEGORY_DEMAND_KEYWORDS_ONLY",
        familyEvidencePromotedToProductTruth: false,
        residualFactTraces: enrichment.factTraces.filter((trace) =>
          trace.promotionToProductTruthAllowed !== true).map((trace) => ({
            specificName: trace.specificName,
            exactMarketMatchFound: trace.exactMatchCount > 0,
            whyNotResolved: trace.resolutionReason,
            exactEvidenceStillMissing:
              trace.resolutionReason === "CONDITION_REQUIRES_INVENTORY_AUTHORITY"
                ? "AUTHORITATIVE_EXACT_INVENTORY_CONDITION"
                : trace.resolutionReason ===
                    "MARKET_IDENTIFIER_CANDIDATE_REQUIRES_CATEGORY_POLICY"
                  ? "OFFICIAL_CATEGORY_PRODUCT_IDENTIFIER_POLICY"
                  : trace.resolutionReason === "MATERIAL_MARKET_FACT_CONFLICT"
                    ? "CONFLICT_FREE_EXACT_MARKET_CORROBORATION"
                    : "TWO_INDEPENDENT_EXACT_MARKET_SELLERS_AND_EXACT_IDENTITY",
          })),
        aiCallCount: 0, boundedAiExtractionOnly: true,
        factInvented: false, marketplaceWrites: 0 }
      const evidence = Object.freeze({ ...evidenceCore,
        evidenceDigest: digest(evidenceCore) })
      const promoted = enrichment.promotedProductTruth
      const currentRead = await input.supabase.from(
        "ebay_luna_opportunity_queue")
        .select("id,candidate_key,assessment,updated_at")
        .eq("id", row.id).eq("candidate_key", row.candidate_key).single()
      if (currentRead.error || !currentRead.data) {
        throw new Error("LUNA_QUICK_PICK_EXACT_SOLD_READBACK_FAILED")
      }
      const currentRow = record(currentRead.data)
      const currentAssessment = record(currentRow.assessment)
      const currentMarker = record(
        currentAssessment.quickPickExactSoldMarketEnrichmentV1)
      const promotedCount = Object.keys(promoted).length
      const nextRequiredSpecificsMarker = mergeRequiredSpecificsMarker(
        currentAssessment, promoted,
        enrichment.factTraces as unknown as JsonRecord[])
      const nextAssessment = { ...currentAssessment,
        ...(promotedCount ? { productTruth: applyPromotedFactsToTruth(
          currentAssessment, promoted, evidence as unknown as JsonRecord) } : {}),
        quickPickRequiredSpecificsContinuationV1:
          nextRequiredSpecificsMarker,
        quickPickExactSoldMarketEnrichmentV1: { ...currentMarker,
          ...evidence, promotedProductTruth: promoted,
          residualSpecificNamesAfter: requiredSpecificNames.filter((name) =>
            !Object.keys(promoted).some((candidateName) =>
              normalized(candidateName) === normalized(name))),
          status: promotedCount ? "PRODUCT_TRUTH_PROMOTED" :
            safeFailureCode ? "COMPLETED_WITH_SAFE_RESIDUAL" :
              "COMPLETED_NO_PROMOTION",
          completedAt: new Date().toISOString() } }
      const write = await input.supabase.from("ebay_luna_opportunity_queue")
        .update({ assessment: nextAssessment,
          updated_at: new Date().toISOString() })
        .eq("id", currentRow.id).eq("candidate_key", currentRow.candidate_key)
        .eq("updated_at", currentRow.updated_at)
        .select("id,candidate_key,assessment").single()
      if (write.error || !write.data) {
        throw new Error("LUNA_QUICK_PICK_EXACT_SOLD_WRITE_FAILED")
      }
      let readinessReevaluated = false
      let ownerDispositionAfter = String(
        nextRequiredSpecificsMarker.finalDisposition ?? "OWNER_FACT_REQUIRED")
      if (promotedCount) {
        const refreshed = await materializeSellerOsDeterministicFactoryCandidateV1({
          supabase: input.supabase, accountKey: input.accountKey,
          opportunityId: String(row.id), candidateKey: String(row.candidate_key),
          taxonomyReader: input.taxonomyReader,
          productIdentifierPolicyReader: input.productIdentifierPolicyReader,
        })
        readinessReevaluated = true
        if (refreshed.marketTestReady === true || refreshed.listingReady === true) {
          const finalRead = await input.supabase.from(
            "ebay_luna_opportunity_queue")
            .select("id,candidate_key,assessment,updated_at").eq("id", row.id)
            .eq("candidate_key", row.candidate_key).single()
          if (finalRead.error || !finalRead.data) {
            throw new Error("LUNA_QUICK_PICK_EXACT_SOLD_FINALIZE_READ_FAILED")
          }
          const finalAssessment = record(record(finalRead.data).assessment)
          const finalSpecifics = record(
            finalAssessment.quickPickRequiredSpecificsContinuationV1)
          ownerDispositionAfter = refreshed.marketTestReady === true
            ? "MARKET_TEST_READY" : "LISTING_READY"
          const finalWrite = await input.supabase.from(
            "ebay_luna_opportunity_queue")
            .update({ assessment: { ...finalAssessment,
              quickPickRequiredSpecificsContinuationV1: {
                ...finalSpecifics,
                finalDisposition: ownerDispositionAfter,
                ownerLastMileOnly: false,
              } }, updated_at: new Date().toISOString() })
            .eq("id", row.id).eq("candidate_key", row.candidate_key)
            .eq("updated_at", record(finalRead.data).updated_at)
            .select("id").single()
          if (finalWrite.error || !finalWrite.data) {
            throw new Error("LUNA_QUICK_PICK_EXACT_SOLD_FINALIZE_FAILED")
          }
        }
      }
      return Object.freeze({ supplierSku: text(row.supplier_sku, 120),
        exactSoldProductFound: enrichment.exactSoldProductFound,
        promotedCount, readinessReevaluated,
        factTraces: enrichment.factTraces,
        residualSpecificNames: requiredSpecificNames.filter((name) =>
          !Object.keys(promoted).some((candidateName) =>
            normalized(candidateName) === normalized(name))),
        ownerDispositionAfter,
        safeFailureCode })
    })
  return Object.freeze({ attempted: candidateKeys.length,
    claimed: claimed.length, reconciledMarkers,
    productsEvaluated: results.length,
    exactSoldProductsFound: results.filter((result) =>
      result.exactSoldProductFound).length,
    soldMarketFactsAutoResolved: results.reduce((sum, result) =>
      sum + result.promotedCount, 0),
    ownerFactRequiredAfter: results.filter((result) =>
      result.ownerDispositionAfter === "OWNER_FACT_REQUIRED").length,
    ownerConfirmationRequiredAfter: results.filter((result) =>
      result.ownerDispositionAfter === "OWNER_CONFIRMATION_REQUIRED").length,
    results: Object.freeze(results),
    futureQuickPickExactSoldEnrichment: true as const,
    skuSpecialCases: 0 as const,
    historicalBatchSpecialCase: false as const,
    familyEvidencePromotedToProductTruth: false as const,
    aiCallCount: 0 as const,
    factInvented: false as const,
    newOperationCount: 0 as const,
    duplicateOperationCount: 0 as const,
    marketplaceWrites: 0 as const })
}
