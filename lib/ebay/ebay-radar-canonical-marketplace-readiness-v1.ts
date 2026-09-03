import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { buildEbayCategoryResolverProductTruthV1 } from
  // @ts-expect-error Node direct TypeScript tests require the explicit extension;
  // the production bundler resolves the same source module.
  "./ebay-category-resolver-v1.ts"
import { buildEbayListingTaxonomyPreflightV1 } from
  // @ts-expect-error Node direct TypeScript tests require the explicit extension;
  // the production bundler resolves the same source module.
  "./ebay-listing-taxonomy-preflight-v1.ts"
import { ebayConditionContractFromVerifiedFact,
  LUNA_OWNER_CERTIFIED_NEW_MERCHANDISE_V1 } from
  // @ts-expect-error Node direct TypeScript tests require the explicit extension;
  // the production bundler resolves the same source module.
  "./ebay-manual-listing-domain.ts"
import { validateOwnerSupplierPolicyApplicationV1 } from
  // @ts-expect-error Node direct TypeScript tests require the explicit
  // extension; the production bundler resolves the same source module.
  "./ebay-owner-supplier-merchandise-policy-v1.ts"
import { ownerExplicitProductTruthValuesV1 } from
  "./ebay-human-product-truth-evidence-v1"
import { buildLunaExactProductEvidenceSetV1,
  LUNA_EXACT_PRODUCT_EVIDENCE_SET_VERSION,
  resolveLunaFullPageRequiredFactV1 } from
  "./ebay-luna-full-page-required-facts-v1"
import type { EbayTaxonomyListingIntelligence } from
  "./ebay-seller-keyword-demand-gateway"
import type { EbayTaxonomyAspectIntelligence } from
  "./ebay-seller-keyword-demand-gateway"
import {
  MARKETPLACE_REQUIRED_SPECIFICS_BATCH_RESOLUTION_V1,
  REQUIRED_SPECIFICS_DIGEST_VERSION,
  requiredSpecificBatchEvidenceDigestV1,
} from "./ebay-marketplace-required-specifics-batch-resolution-v1"

export const RADAR_CANONICAL_MARKETPLACE_READINESS_VERSION =
  "RADAR_CANONICAL_MARKETPLACE_READINESS_CONTINUATION_V3" as const
export const RADAR_REQUIRED_ITEM_SPECIFICS_TRUTH_RESOLUTION_VERSION =
  "RADAR_REQUIRED_ITEM_SPECIFICS_TRUTH_RESOLUTION_V4" as const

const TAXONOMY_REVALIDATION_MS = 6 * 60 * 60 * 1_000
const REQUIRED_ASPECT_SCOPE = "ALL_OFFICIAL_REQUIRED_ASPECTS" as const

type JsonRecord = Record<string, unknown>

export type RadarMarketplaceTaxonomyReaderV1 = (
  query: string,
  categoryId?: string | null,
  options?: { allowTitleSuggestionFallback?: boolean },
) => Promise<EbayTaxonomyListingIntelligence>

export type RadarProductIdentifierPolicyReaderV1 = (input: Readonly<{
  categoryId: string
  marketplaceId: "EBAY_US"
  inventoryItemPayload: JsonRecord
}>) => Promise<Readonly<{
  safe: boolean
  exactPolicyFound: boolean
  policies: unknown[]
  missingRequiredIdentifiers: string[]
  blocker: string | null
  source: string
  httpStatus?: number
  readAttempts?: number
  errorIds?: string[]
}>>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().slice(0, maximum) : ""
}

function strings(value: unknown, maximum = 100) {
  return Array.isArray(value)
    ? value.map((entry) => text(entry, 160)).filter(Boolean).slice(0, maximum)
    : []
}

function stringRecord(value: unknown, maximumEntries = 80) {
  return Object.fromEntries(Object.entries(record(value)).flatMap(
    ([name, entry]) => {
      const normalizedName = text(name, 120)
      const normalizedValue = text(entry, 500)
      return normalizedName && normalizedValue
        ? [[normalizedName, normalizedValue] as const] : []
    }).slice(0, maximumEntries))
}

function canonical(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function normalizedPhrase(value: unknown) {
  return text(value, 500).normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
}

function phrasePosition(haystack: string, needle: string) {
  if (!haystack || !needle) return -1
  return ` ${haystack} `.indexOf(` ${needle} `)
}

function aspectKey(value: unknown) {
  return normalizedPhrase(value)
}

function exactOfficialValue(
  aspect: EbayTaxonomyAspectIntelligence,
  proposed: unknown,
) {
  const key = aspectKey(proposed)
  return aspect.values.find((entry) => aspectKey(entry.value) === key)
    ?.value ?? null
}

function compactAspectContract(aspect: EbayTaxonomyAspectIntelligence) {
  const values = aspect.values.map((entry) => entry.value)
  const marketplaceFallbackValues = values.filter((value) => [
    "unbranded", "does not apply", "not applicable", "none",
  ].includes(normalizedPhrase(value)))
  return Object.freeze({
    name: aspect.name,
    required: aspect.required,
    dataType: aspect.dataType,
    mode: aspect.mode,
    inputMode: aspect.mode === "FREE_TEXT" ? "FREE_TEXT" as const
      : aspect.mode === "SELECTION_ONLY" ? "SELECTION_ONLY" as const
        : "UNPROVEN" as const,
    freeTextAllowed: aspect.mode === "FREE_TEXT",
    cardinality: aspect.cardinality,
    maxLength: aspect.maxLength,
    format: aspect.format,
    constraintsComplete: aspect.constraintsComplete,
    constraints: aspect.values.flatMap((value) =>
      value.valueConstraints.map((constraint) => ({
        allowedValue: value.value,
        applicableForAspectName: constraint.applicableForAspectName,
        applicableForAspectValues: constraint.applicableForAspectValues,
      }))),
    allowedValues: values.length <= 50 ? values : unique([
      ...aspect.suggestedValues, ...marketplaceFallbackValues,
    ]),
    allowedValueCount: values.length,
    allowedValuesComplete: aspect.valuesComplete,
    allowedValuesTruncated: values.length > 50,
    source: "EBAY_TAXONOMY_OFFICIAL_READONLY" as const,
  })
}

function firstExactTitleValue(
  aspect: EbayTaxonomyAspectIntelligence,
  exactTitle: string,
) {
  const title = normalizedPhrase(exactTitle)
  return aspect.values.map((entry, index) => ({
    value: entry.value,
    index,
    position: phrasePosition(title, normalizedPhrase(entry.value)),
  })).filter((entry) => entry.position >= 0)
    .sort((left, right) => left.position - right.position
      || right.value.length - left.value.length || left.index - right.index)[0]
    ?.value ?? null
}

const SUPPLIER_VENDOR_IDENTITIES = new Set([
  "luna warehouse", "luna portex", "lunaportex",
])

export function resolveRadarRequiredItemSpecificsTruthV1(input: Readonly<{
  opportunity: JsonRecord
  productTruth: JsonRecord
  taxonomy: EbayTaxonomyListingIntelligence
  catalogRow: JsonRecord | null
}>) {
  const required = input.taxonomy.aspects.filter((aspect) => aspect.required)
  const quickPickOperation = record(record(input.opportunity.assessment)
    .lunaQuickPickOperationV1)
  const optionalBrand =
    quickPickOperation.fullLunaBrandEvidenceReviewRequired === true
      ? input.taxonomy.aspects.find((aspect) =>
        aspectKey(aspect.name) === "brand" && !aspect.required)
      : undefined
  // Brand is Product Truth even when a category does not require it to list.
  // Evaluate it through the same Luna evidence resolver, while keeping it out
  // of required-item-specific counts and publication blockers.
  const resolutionAspects = optionalBrand
    ? [...required, optionalBrand] : required
  const requiredAspectKeys = new Set(required.map((aspect) =>
    aspectKey(aspect.name)))
  const exactIdentity = Boolean(input.catalogRow
    && input.catalogRow.supplier_product_id ===
      input.opportunity.supplier_product_id
    && input.catalogRow.supplier_variant_id ===
      input.opportunity.supplier_variant_id
    && input.catalogRow.sku === input.opportunity.supplier_sku)
  const existingValues = record(input.productTruth.provenProductValues)
  const fullLunaEvidence = buildLunaExactProductEvidenceSetV1({
    opportunity: input.opportunity, catalogRow: input.catalogRow,
  })
  const provenProductValues: Record<string, string> = {}
  for (const [name, value] of Object.entries(existingValues)) {
    const normalized = text(value, 500)
    if (normalized) provenProductValues[text(name, 120)] = normalized
  }
  // The original owner expression remains in its evidence record. The
  // marketplace-normalized value is projected here and may correct an earlier
  // owner value before publication without becoming a supplier-wide rule.
  for (const [name, value] of Object.entries(
    ownerExplicitProductTruthValuesV1(input.opportunity))) {
    for (const existingName of Object.keys(provenProductValues)) {
      if (aspectKey(existingName) === aspectKey(name)) {
        delete provenProductValues[existingName]
      }
    }
    provenProductValues[name] = value
  }
  const exactTitle = exactIdentity ? text(input.catalogRow?.title, 350) : ""
  const structuredVendor = exactIdentity
    ? text(input.catalogRow?.vendor, 160) : ""
  const resolutions: Record<string, Readonly<{
    value: string | null
    source: string | null
    exactProductSupported: boolean
    resolutionClass?: string | null
    sourceField?: string | null
    sourceExcerpt?: string | null
    fullPageGapDiagnostic?: string | null
  }>> = {}
  for (const aspect of resolutionAspects) {
    const requestedName = aspect.name
    const requestedAspectKey = aspectKey(requestedName)
    let value: string | null = null
    let source: string | null = null
    let resolutionClass: string | null = null
    let sourceField: string | null = null
    let sourceExcerpt: string | null = null
    let fullPageGapDiagnostic: string | null = null
    const priorEntry = Object.entries(provenProductValues).find(([name]) =>
      aspectKey(name) === requestedAspectKey)
    const prior = priorEntry?.[1]
    const priorTruth = record(record(record(input.productTruth.sourceEvidence)
      .requiredItemSpecificsTruthV1).resolutions)
    const priorResolution = record(Object.entries(priorTruth).find(
      ([name]) => aspectKey(name) === requestedAspectKey)?.[1])
    // A marketplace Brand vocabulary phrase occurring in a product title is
    // not explicit manufacturer-brand evidence. Invalidate values previously
    // produced by that legacy matcher so the full Luna evidence review and
    // durable owner policy remain the only Brand authorities.
    const legacyTitleBrand = requestedAspectKey === "brand"
      && priorResolution.source === "LUNA_EXACT_PRODUCT_TITLE"
      && fullLunaEvidence.imageBrandEvidenceStatus === "NO_EXPLICIT_BRAND"
    const staleUnbrandedPolicy = requestedAspectKey === "brand"
      && priorResolution.source === "OWNER_LUNA_UNBRANDED_POLICY"
      && aspectKey(prior) === "unbranded"
      && fullLunaEvidence.imageBrandEvidenceStatus !== "NO_EXPLICIT_BRAND"
    const invalidPriorBrand = legacyTitleBrand || staleUnbrandedPolicy
    if (invalidPriorBrand && priorEntry) {
      delete provenProductValues[priorEntry[0]]
    }
    if (exactIdentity && prior && !invalidPriorBrand) {
      value = exactOfficialValue(aspect, prior)
        ?? (aspect.mode === "FREE_TEXT" ? text(prior, 500) : null)
      if (value) {
        const durableSource = text(priorResolution.source, 120)
        source = priorResolution.exactProductSupported === true
          && text(priorResolution.value, 500) === value && durableSource
          ? durableSource : "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1"
        resolutionClass = text(priorResolution.resolutionClass, 120) || null
        sourceField = text(priorResolution.sourceField, 80) || null
        sourceExcerpt = text(priorResolution.sourceExcerpt, 500) || null
        fullPageGapDiagnostic = text(
          priorResolution.fullPageGapDiagnostic, 120) || null
      }
    }
    if (!value && exactIdentity && requestedAspectKey === "brand") {
      const allowed = exactOfficialValue(aspect, structuredVendor)
      if (allowed && !SUPPLIER_VENDOR_IDENTITIES.has(
        normalizedPhrase(structuredVendor))) {
        value = allowed
        source = "LUNA_EXACT_STRUCTURED_VENDOR"
      }
    }
    if (!value && exactIdentity && requestedAspectKey !== "brand") {
      value = firstExactTitleValue(aspect, exactTitle)
      if (value) source = "LUNA_EXACT_PRODUCT_TITLE"
    }
    const fullPageResolution = !value && exactIdentity
      ? resolveLunaFullPageRequiredFactV1({
        opportunity: input.opportunity, evidence: fullLunaEvidence,
        specificName: requestedName,
        freeTextAllowed: aspect.mode === "FREE_TEXT",
        allowedValues: aspect.values.map((entry) => entry.value),
        allowedValuesComplete: aspect.valuesComplete,
        maxLength: aspect.maxLength,
      }) : null
    if (fullPageResolution) {
      value = fullPageResolution.value
      source = fullPageResolution.source
      resolutionClass = fullPageResolution.source
      sourceField = fullPageResolution.sourceField
      sourceExcerpt = fullPageResolution.sourceExcerpt
      fullPageGapDiagnostic = fullPageResolution.fullPageGapDiagnostic
    }
    if (value) provenProductValues[aspect.name] = value
    resolutions[requestedName] = Object.freeze({
      value,
      source,
      exactProductSupported: Boolean(value),
      ...(resolutionClass || sourceField || sourceExcerpt
          || fullPageGapDiagnostic ? {
        resolutionClass,
        sourceField,
        sourceExcerpt,
        fullPageGapDiagnostic,
      } : {}),
    })
  }
  const unresolved = Object.entries(resolutions)
    .filter(([name, resolution]) => requiredAspectKeys.has(aspectKey(name))
      && !resolution.exactProductSupported)
    .map(([name]) => name)
  const unresolvedEvidenceAspects = Object.entries(resolutions)
    .filter(([, resolution]) => !resolution.exactProductSupported)
    .map(([name]) => name)
  const existingUnknown = strings(input.productTruth.knownUnknownAspectNames)
  const knownUnknownAspectNames = unique([
    ...existingUnknown.filter((name) => !Object.entries(resolutions)
      .some(([candidate, resolution]) => resolution.exactProductSupported
        && aspectKey(candidate) === aspectKey(name))),
    ...unresolved,
  ])
  const unprovenAspectEvidenceRequirements = {
    ...record(input.productTruth.unprovenAspectEvidenceRequirements),
    ...Object.fromEntries(unresolved.map((name) => [name,
      `AUTHORITATIVE_PRODUCT_${name.toUpperCase()}_EVIDENCE_REQUIRED`])),
  }
  for (const [name, resolution] of Object.entries(resolutions)) {
    if (resolution.exactProductSupported) {
      delete unprovenAspectEvidenceRequirements[name]
    }
  }
  const aspectContracts = required.map(compactAspectContract)
  const evidenceAspectContracts = resolutionAspects.map(compactAspectContract)
  const evidenceCore = {
    contractVersion: RADAR_REQUIRED_ITEM_SPECIFICS_TRUTH_RESOLUTION_VERSION,
    authority: "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1",
    marketplaceId: "EBAY_US",
    categoryId: input.taxonomy.categoryId,
    candidateKey: input.opportunity.candidate_key,
    supplierProductId: input.opportunity.supplier_product_id,
    supplierVariantId: input.opportunity.supplier_variant_id,
    supplierSku: input.opportunity.supplier_sku,
    exactIdentity,
    catalogObservedAt: input.catalogRow?.captured_at ?? null,
    taxonomyObservedAt: input.taxonomy.observedAt,
    aspectContracts,
    resolutions,
    unsupportedRequiredSpecifics: unresolved,
    demandEvidenceGrain: "FAMILY",
    exactProductDemandClaimed: false,
    fullLunaPageIsPrimaryProductEvidence: true,
    lunaExactProductEvidenceSetV1: fullLunaEvidence,
    marketplaceWrites: 0,
  }
  const requiredItemSpecificsTruthV1 = Object.freeze({
    ...evidenceCore,
    evidenceDigest: digest(evidenceCore),
  })
  const exactSpecs = exactIdentity ? {
    ...stringRecord(input.catalogRow?.product_metadata),
    ...stringRecord(input.catalogRow?.metadata),
    productType: text(input.catalogRow?.product_type, 160),
    tags: strings(input.catalogRow?.tags, 40).join(" | "),
    ...(() => {
      const brand = record(input.productTruth.brand)
      return {
        productTruthNoManufacturerBrandClaim:
          text(brand.noManufacturerBrandClaim, 80),
        productTruthEbayBrandSemantics:
          text(brand.ebayBrandSemantics, 80),
        productTruthVisibleManufacturerBrandingPresent:
          typeof brand.visibleManufacturerBrandingPresent === "boolean"
            ? String(brand.visibleManufacturerBrandingPresent) : "",
        productTruthSupplierImageBrandConflictFound:
          typeof brand.supplierImageBrandConflictFound === "boolean"
            ? String(brand.supplierImageBrandConflictFound) : "",
      }
    })(),
  } : {}
  const exactVariantData = exactIdentity ? {
    title: text(input.catalogRow?.variant_title, 240),
    sku: text(input.catalogRow?.sku, 120),
    ...stringRecord(input.catalogRow?.metadata),
  } : {}
  const batchInputCore = {
    operationId: text(input.opportunity.id, 80),
    radarCandidateId: text(record(record(input.opportunity.assessment)
      .radarFactoryCandidateV1).candidateId, 80),
    lunaProductId: text(input.opportunity.supplier_product_id, 80),
    lunaVariantId: text(input.opportunity.supplier_variant_id, 80),
    supplierSku: text(input.opportunity.supplier_sku, 120),
    marketplaceId: "EBAY_US" as const,
    categoryId: input.taxonomy.categoryId ?? "",
    exactProductIdentityProven: exactIdentity,
    exactProductTitle: exactTitle,
    exactDescription: fullLunaEvidence.description,
    exactSpecs,
    exactVariantData,
    exactImageUrls: fullLunaEvidence.exactImageUrls,
    compactLunaEvidence: {
      evidenceSetDigest: fullLunaEvidence.evidenceDigest,
      sectionCoverage: fullLunaEvidence.sectionCoverage,
      title: fullLunaEvidence.title,
      variantTitle: fullLunaEvidence.variantTitle,
      description: fullLunaEvidence.description,
      productMetadata: fullLunaEvidence.productMetadata,
      variantMetadata: fullLunaEvidence.variantMetadata,
      structuredVendor: fullLunaEvidence.structuredVendor,
      existingDurableProductTruth:
        fullLunaEvidence.existingDurableProductTruth,
      exactImageCount: fullLunaEvidence.exactImageCount,
      imageSetDigest: fullLunaEvidence.imageSetDigest,
      allExactProductImagesReviewed:
        fullLunaEvidence.allExactProductImagesReviewed,
      imageBrandEvidenceStatus:
        fullLunaEvidence.imageBrandEvidenceStatus,
      sourceConflicts: fullLunaEvidence.sourceConflicts,
    },
    unresolvedRequiredAspects: unresolvedEvidenceAspects,
    officialAspectDefinitions: evidenceAspectContracts,
  }
  const requiredSpecificsBatchInput = Object.freeze({
    ...batchInputCore,
    inputEvidenceDigest: requiredSpecificBatchEvidenceDigestV1(batchInputCore),
  })
  const sourceEvidence = {
    ...record(input.productTruth.sourceEvidence),
    requiredItemSpecificsTruthV1,
  }
  const { evidenceDigest: _previousDigest, ...previousTruth } = input.productTruth
  const productTruthCore = {
    ...previousTruth,
    provenProductValues,
    knownUnknownAspectNames,
    unprovenAspectEvidenceRequirements,
    sourceEvidence,
  }
  return Object.freeze({
    productTruth: Object.freeze({
      ...productTruthCore,
      evidenceDigest: digest(productTruthCore),
    }),
    evidence: requiredItemSpecificsTruthV1,
    resolutions: Object.freeze(resolutions),
    aspectContracts: Object.freeze(aspectContracts),
    requiredSpecificsBatchInput,
    exactIdentity,
  })
}

function compatibleBatchResolution(input: Readonly<{
  opportunity: JsonRecord
  batchInput: JsonRecord
}>) {
  const assessment = record(input.opportunity.assessment)
  const stored = record(assessment.marketplaceRequiredSpecificsBatchResolutionV1)
  const { evidenceDigest, ...core } = stored
  if (stored.contractVersion !==
      MARKETPLACE_REQUIRED_SPECIFICS_BATCH_RESOLUTION_V1
      || stored.aspectScope !== REQUIRED_ASPECT_SCOPE
      || stored.digestVersion !== REQUIRED_SPECIFICS_DIGEST_VERSION
      || stored.authority !== "SELLER_OS_DETERMINISTIC_FACTORY"
      || stored.radarCandidateId !== input.batchInput.radarCandidateId
      || stored.lunaProductId !== input.batchInput.lunaProductId
      || stored.lunaVariantId !== input.batchInput.lunaVariantId
      || stored.supplierSku !== input.batchInput.supplierSku
      || stored.marketplaceId !== input.batchInput.marketplaceId
      || stored.categoryId !== input.batchInput.categoryId
      || stored.inputEvidenceDigest !== input.batchInput.inputEvidenceDigest
      || evidenceDigest !== requiredSpecificBatchEvidenceDigestV1(core)) {
    return Object.freeze({ values: {}, evidence: {} })
  }
  const definitions = Array.isArray(input.batchInput.officialAspectDefinitions)
    ? input.batchInput.officialAspectDefinitions.map(record) : []
  const unresolved = new Set(strings(
    input.batchInput.unresolvedRequiredAspects).map(aspectKey))
  const values: Record<string, string> = {}
  const accepted: JsonRecord[] = []
  for (const raw of Array.isArray(stored.resolutions)
    ? stored.resolutions : []) {
    const resolution = record(raw)
    const definition = definitions.find((entry) =>
      aspectKey(entry.name) === aspectKey(resolution.aspectName))
    const name = text(definition?.name, 120)
    const value = text(resolution.resolvedValue, 500)
    if (!name || !value || !unresolved.has(aspectKey(name))
        || resolution.factInvented !== false
        || resolution.humanReviewRequired !== false
        || resolution.resolutionClass === "HUMAN_REVIEW") continue
    const allowedValues = strings(definition?.allowedValues, 10_000)
    const compatible = definition?.freeTextAllowed === true
      || definition?.allowedValuesComplete !== true
      || allowedValues.some((entry) => aspectKey(entry) === aspectKey(value))
    if (!compatible) continue
    values[name] = allowedValues.find((entry) =>
      aspectKey(entry) === aspectKey(value)) ?? value
    accepted.push(resolution)
  }
  return Object.freeze({ values: Object.freeze(values),
    evidence: Object.freeze({ ...stored, resolutions: Object.freeze(accepted) }) })
}

function validUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(text(value, 80))
}

function validCandidateId(value: unknown) {
  return /^sha256:[0-9a-f]{64}$/.test(text(value, 80))
}

function validCategoryId(value: unknown) {
  return /^\d{1,20}$/.test(text(value, 20))
}

function exactPackageBinding(input: Readonly<{
  opportunity: JsonRecord
  listingPackage: JsonRecord
  accountKey: string
}>) {
  return validUuid(input.listingPackage.id)
    && input.listingPackage.account_key === input.accountKey
    && input.listingPackage.opportunity_id === input.opportunity.id
    && input.listingPackage.candidate_key === input.opportunity.candidate_key
}

function existingEvidence(input: Readonly<{
  opportunity: JsonRecord
  productTruthDigest: string
  listingPackageId: string
  accountKey: string
  now: Date
  requiredSpecificsBatchResolutionDigest: string | null
  requiredSpecificsBatchResolutionCompleteScope: boolean
  listingPackageConditionId: string | null
}>) {
  const assessment = record(input.opportunity.assessment)
  const value = record(assessment.canonicalMarketplaceReadinessV1)
  const { evidenceDigest: storedDigest, ...core } = value
  const requiredTruth = record(value.requiredItemSpecificsTruth)
  const fullLunaEvidence = record(
    requiredTruth.lunaExactProductEvidenceSetV1)
  const currentImageReview = record(assessment.lunaFullPageImageReviewV1)
  const currentImageReviewDigest = /^sha256:[0-9a-f]{64}$/.test(text(
    currentImageReview.evidenceDigest, 80))
    ? text(currentImageReview.evidenceDigest, 80) : null
  const cachedImageReviewDigest = /^sha256:[0-9a-f]{64}$/.test(text(
    fullLunaEvidence.imageReviewMarkerDigest, 80))
    ? text(fullLunaEvidence.imageReviewMarkerDigest, 80) : null
  const unresolvedRequiredSpecifics = strings(
    value.unsupportedRequiredSpecifics, 100)
  // A blocked cached readiness row is never a substitute for the exact batch
  // input needed by the Required Specifics resolver. This also closes the race
  // where another read refreshes the cache after the continuation claims the
  // row but before it builds its bounded batch. Ready rows remain reusable.
  const unresolvedSpecificsNeedBatchInput =
    unresolvedRequiredSpecifics.length > 0
  const exact = value.contractVersion ===
      RADAR_CANONICAL_MARKETPLACE_READINESS_VERSION
    && value.authority === "SELLER_OS_DETERMINISTIC_FACTORY"
    && value.marketplaceId === "EBAY_US"
    && value.accountKey === input.accountKey
    && value.queueCandidateKey === input.opportunity.candidate_key
    && value.supplierProductId === input.opportunity.supplier_product_id
    && value.supplierVariantId === input.opportunity.supplier_variant_id
    && value.supplierSku === input.opportunity.supplier_sku
    && value.productTruthDigest === input.productTruthDigest
    && value.listingPackageId === input.listingPackageId
    && (value.conditionId ?? null) === input.listingPackageConditionId
    && (value.requiredSpecificsBatchResolutionDigest ?? null) ===
      input.requiredSpecificsBatchResolutionDigest
    && (!input.requiredSpecificsBatchResolutionDigest
      || input.requiredSpecificsBatchResolutionCompleteScope)
    && !unresolvedSpecificsNeedBatchInput
    && validCandidateId(value.radarCandidateId)
    && value.demandEvidenceGrain === "FAMILY"
    && value.exactProductDemandClaimed === false
    && requiredTruth.contractVersion ===
      RADAR_REQUIRED_ITEM_SPECIFICS_TRUTH_RESOLUTION_VERSION
    && fullLunaEvidence.contractVersion ===
      LUNA_EXACT_PRODUCT_EVIDENCE_SET_VERSION
    && cachedImageReviewDigest === currentImageReviewDigest
    && /^sha256:[0-9a-f]{64}$/.test(text(storedDigest, 80))
    && storedDigest === digest(core)
    && Date.parse(text(value.revalidateAfter, 64)) > input.now.getTime()
    && Date.parse(text(value.policyExpiresAt, 64)) > input.now.getTime()
  return exact ? value : null
}

export async function resolveRadarCanonicalMarketplaceReadinessV1(
  input: Readonly<{
    supabase: SupabaseClient
    accountKey: string
    opportunity: JsonRecord
    listingPackage: JsonRecord | null
    productTruthExact: boolean
    productTruth: JsonRecord
    taxonomyReader: RadarMarketplaceTaxonomyReaderV1
    productIdentifierPolicyReader?: RadarProductIdentifierPolicyReaderV1
    now?: Date
  }>,
) {
  const now = input.now ?? new Date()
  const assessment = record(input.opportunity.assessment)
  const radar = record(assessment.radarFactoryCandidateV1)
  const productTruthDigest = text(input.productTruth.evidenceDigest, 80)
  const listingPackage = input.listingPackage ?? {}
  const listingPackageId = text(listingPackage.id, 80)
  const storedBatchResolution = record(
    assessment.marketplaceRequiredSpecificsBatchResolutionV1)
  const requiredSpecificsBatchResolutionDigest =
    /^sha256:[0-9a-f]{64}$/.test(text(
      storedBatchResolution.evidenceDigest, 80))
      ? text(storedBatchResolution.evidenceDigest, 80) : null
  const requiredSpecificsBatchResolutionCompleteScope =
    storedBatchResolution.aspectScope === REQUIRED_ASPECT_SCOPE
    && storedBatchResolution.digestVersion === REQUIRED_SPECIFICS_DIGEST_VERSION
  const reusable = listingPackageId ? existingEvidence({
    opportunity: input.opportunity,
    productTruthDigest,
    listingPackageId,
    accountKey: input.accountKey,
    now,
    requiredSpecificsBatchResolutionDigest,
    requiredSpecificsBatchResolutionCompleteScope,
    listingPackageConditionId: (() => {
      const packageData = record(input.listingPackage?.package_data)
      const contract = ebayConditionContractFromVerifiedFact(
        packageData.conditionLabel)
      return contract
        && text(packageData.conditionId, 20) === contract.conditionId
        ? contract.conditionId : null
    })(),
  }) : null
  if (reusable) {
    const truthEvidence = record(record(input.productTruth.sourceEvidence)
      .requiredItemSpecificsTruthV1)
    return Object.freeze({
      evidence: Object.freeze(reusable),
      productTruth: Object.freeze(input.productTruth),
      requiredItemSpecificsTruth: Object.freeze(truthEvidence),
      requiredSpecificsBatchInput: null,
      acquisitionRequired: false as const,
      reused: true as const,
    })
  }

  const packageExact = exactPackageBinding({
    opportunity: input.opportunity,
    listingPackage,
    accountKey: input.accountKey,
  })
  const packageData = record(listingPackage.package_data)
  const categoryResolver = record(packageData.categoryResolverV1)
  const categoryId = packageExact && validCategoryId(packageData.categoryId)
    ? text(packageData.categoryId, 20) : ""
  const categorySource = categoryId
    ? strings(categoryResolver.categorySource, 10)[0]
      ?? "EXISTING_DURABLE_LISTING_PACKAGE_EXACT_OPPORTUNITY_BINDING" : null
  const waitingForCategoryCapability = !categoryId
    && categoryResolver.categoryResolutionAttempted === true
    && categoryResolver.capabilityUnavailable === true
  const conditionContract = packageExact
    ? ebayConditionContractFromVerifiedFact(packageData.conditionLabel) : null
  const conditionId = conditionContract
    && text(packageData.conditionId, 20) === conditionContract.conditionId
    ? conditionContract.conditionId : ""
  const conditionAuthority = record(packageData.conditionAuthority)
  const supplierPolicyApplication = record(
    assessment.ownerSupplierMerchandisePolicyApplicationV1)
  const ownerCertifiedLunaCondition = conditionId
    && conditionAuthority.contractVersion ===
      LUNA_OWNER_CERTIFIED_NEW_MERCHANDISE_V1
    && conditionAuthority.lunaProductId ===
      input.opportunity.supplier_product_id
    && conditionAuthority.lunaVariantId ===
      input.opportunity.supplier_variant_id
    && conditionAuthority.supplierSku === input.opportunity.supplier_sku
    && conditionAuthority.categoryId === categoryId
    && conditionAuthority.conditionId === conditionId
    && validateOwnerSupplierPolicyApplicationV1(
      supplierPolicyApplication, {
        lunaProductId: input.opportunity.supplier_product_id,
        lunaVariantId: input.opportunity.supplier_variant_id,
        supplierSku: input.opportunity.supplier_sku,
      })
    && conditionAuthority.policyId === supplierPolicyApplication.policyId
    && conditionAuthority.policyDigest ===
      supplierPolicyApplication.policyDigest
    && conditionAuthority.policyApplicationDigest ===
      supplierPolicyApplication.applicationDigest
    && conditionAuthority.factInvented === false
  const conditionSource = conditionId
    ? ownerCertifiedLunaCondition
      ? LUNA_OWNER_CERTIFIED_NEW_MERCHANDISE_V1
      : "EXISTING_DURABLE_LISTING_PACKAGE_EXACT_OPPORTUNITY_BINDING"
    : null

  const profileRead = await input.supabase.from("ebay_account_policy_profiles")
    .select("account_key,marketplace_id,fulfillment_policy_id,payment_policy_id,return_policy_id,merchant_location_key,verification_source,verified_at,expires_at")
    .eq("account_key", input.accountKey)
    .eq("marketplace_id", "EBAY_US")
    .gt("expires_at", now.toISOString())
    .order("verified_at", { ascending: false })
    .limit(1).maybeSingle()
  const profile = profileRead.error ? {} : record(profileRead.data)
  const sellerAccountBindingReady = packageExact
    && profile.account_key === input.accountKey
  const marketplaceIdentityReady = sellerAccountBindingReady
    && profile.marketplace_id === "EBAY_US"
  const fulfillmentPolicyId = text(profile.fulfillment_policy_id, 100)
  const paymentPolicyId = text(profile.payment_policy_id, 100)
  const returnPolicyId = text(profile.return_policy_id, 100)
  const merchantLocationKey = text(profile.merchant_location_key, 100)
  const fulfillmentPolicyReady = Boolean(fulfillmentPolicyId)
  const paymentPolicyReady = Boolean(paymentPolicyId)
  const returnPolicyReady = Boolean(returnPolicyId)
  const locationOrInventoryContextReady = Boolean(merchantLocationKey)
  const listingPolicyReady = fulfillmentPolicyReady && paymentPolicyReady
    && returnPolicyReady && locationOrInventoryContextReady

  let taxonomy: EbayTaxonomyListingIntelligence | null = null
  if (categoryId && input.productTruthExact) {
    try {
      taxonomy = await input.taxonomyReader(
        text(input.productTruth.title, 350)
          || text(input.opportunity.product_title, 350),
        categoryId,
        { allowTitleSuggestionFallback: false },
      )
    } catch {
      taxonomy = null
    }
  }
  const categoryReady = Boolean(taxonomy
    && taxonomy.status === "AVAILABLE"
    && taxonomy.source === "EBAY_TAXONOMY_OFFICIAL_READONLY"
    && taxonomy.taxonomyMarketplaceId === "EBAY_US"
    && taxonomy.categoryResolution === "KNOWN_CATEGORY"
    && taxonomy.categoryId === categoryId
    && taxonomy.categoryTreeId
    && taxonomy.observedAt)

  let catalogRow: JsonRecord | null = null
  if (categoryReady && input.productTruthExact) {
    const catalogRead = await input.supabase.from("market_radar_latest_variants")
      .select("product_id,supplier_product_id,supplier_variant_id,sku,title,variant_title,vendor,product_type,tags,metadata,featured_image_url,image_urls,captured_at")
      .eq("source_key", "lunaportex")
      .eq("supplier_product_id", input.opportunity.supplier_product_id)
      .eq("supplier_variant_id", input.opportunity.supplier_variant_id)
      .eq("sku", input.opportunity.supplier_sku)
      .limit(2)
    const catalogRows = catalogRead.error || !Array.isArray(catalogRead.data)
      ? [] : catalogRead.data.map(record)
    catalogRow = catalogRows.length === 1 ? catalogRows[0] : null
    if (catalogRow && text(catalogRow.product_id, 80)) {
      const productRead = await input.supabase.from("market_radar_products")
        .select("id,body_html,metadata")
        .eq("id", catalogRow.product_id).limit(1).maybeSingle()
      if (!productRead.error && productRead.data) {
        catalogRow = { ...catalogRow,
          body_html: record(productRead.data).body_html,
          product_metadata: record(productRead.data).metadata }
      }
    }
  }
  const specificsTruth = categoryReady && taxonomy
    ? resolveRadarRequiredItemSpecificsTruthV1({
      opportunity: input.opportunity,
      productTruth: input.productTruth,
      taxonomy,
      catalogRow,
    }) : null
  const resolvedProductTruth = specificsTruth?.productTruth
    ?? input.productTruth
  const resolvedProductTruthDigest = text(
    resolvedProductTruth.evidenceDigest, 80)
  const opportunityWithProductTruth = specificsTruth ? {
    ...input.opportunity,
    assessment: {
      ...assessment,
      productTruth: resolvedProductTruth,
    },
  } : input.opportunity
  const batchResolution = specificsTruth
    ? compatibleBatchResolution({ opportunity: input.opportunity,
      batchInput: specificsTruth.requiredSpecificsBatchInput as unknown as JsonRecord })
    : Object.freeze({ values: {}, evidence: {} })

  let taxonomyPreflight: JsonRecord = {}
  if (categoryReady && taxonomy && validUuid(listingPackageId)) {
    const exactValues = buildEbayCategoryResolverProductTruthV1({
      opportunity: opportunityWithProductTruth,
      packageData,
    })
    try {
      taxonomyPreflight = buildEbayListingTaxonomyPreflightV1({
        taxonomy,
        expectedCategoryId: categoryId,
        context: {
          marketplaceId: "EBAY_US",
          listingPackageId,
          opportunityId: text(input.opportunity.id, 80),
          candidateKey: text(input.opportunity.candidate_key, 300),
        },
        // A legacy package may contain inferred/family values. Only exact
        // Product Truth values are eligible for automatic readiness.
        existingAspects: {},
        provenProductValues: exactValues.provenProductValues,
        marketplaceRequirementValues: batchResolution.values,
        marketplaceRequirementEvidence: batchResolution.evidence,
        knownUnknownAspectNames: exactValues.knownUnknownAspectNames,
        unprovenAspectEvidenceRequirements:
          exactValues.unprovenAspectEvidenceRequirements,
      }) as unknown as JsonRecord
    } catch {
      taxonomyPreflight = {}
    }
  }
  const requiredNames = Array.isArray(taxonomyPreflight.requiredAspects)
    ? (taxonomyPreflight.requiredAspects as unknown[])
      .map((value) => text(record(value).name, 120)).filter(Boolean) : []
  const unsupportedRequiredSpecifics = strings(
    taxonomyPreflight.unprovenRequiredAspectNames, 100)
  const requiredItemSpecificsSatisfied = requiredNames.length
    - unsupportedRequiredSpecifics.length
  const requiredItemSpecificsReady = categoryReady
    && taxonomyPreflight.status === "CONSULTADO"
    && unsupportedRequiredSpecifics.length === 0
  const conditionReady = Boolean(conditionId)
  const packageIdentifiers = record(packageData.productIdentifiers)
  const exactGtin = input.productTruthExact
    ? text(input.opportunity.gtin ?? input.productTruth.gtin, 32)
      .replace(/[\s-]/g, "") : ""
  const resolvedMarketplaceValues = record(batchResolution.values)
  const exactProductValues = record(resolvedProductTruth.provenProductValues)
  const exactMpn = text(packageIdentifiers.mpn, 80)
    || text(resolvedMarketplaceValues.MPN, 80)
    || text(exactProductValues.MPN, 80)
  const availableProductIdentifiers = Object.freeze({
    upc: exactGtin.length === 12 ? exactGtin
      : text(packageIdentifiers.upc, 32) || null,
    ean: exactGtin.length === 13 ? exactGtin
      : text(packageIdentifiers.ean, 32) || null,
    mpn: exactMpn || null,
  })
  const inventoryItemPayload = { product: {
    ...(exactGtin.length === 12 ? { upc: [exactGtin] } : {}),
    ...(exactGtin.length === 13 ? { ean: [exactGtin] } : {}),
    ...(text(packageIdentifiers.upc, 32) ? {
      upc: [text(packageIdentifiers.upc, 32)],
    } : {}),
    ...(text(packageIdentifiers.ean, 32) ? {
      ean: [text(packageIdentifiers.ean, 32)],
    } : {}),
    ...(text(packageIdentifiers.isbn, 32) ? {
      isbn: [text(packageIdentifiers.isbn, 32)],
    } : {}),
    ...(exactMpn ? { mpn: exactMpn } : {}),
  } }
  let productIdentifierPolicy: Awaited<ReturnType<
    NonNullable<typeof input.productIdentifierPolicyReader>>> | null = null
  if (categoryReady && input.productIdentifierPolicyReader) {
    try {
      productIdentifierPolicy = await input.productIdentifierPolicyReader({
        categoryId, marketplaceId: "EBAY_US", inventoryItemPayload,
      })
    } catch {
      productIdentifierPolicy = {
        safe: false, exactPolicyFound: false, policies: [],
        missingRequiredIdentifiers: [],
        blocker: "EBAY_CATEGORY_PRODUCT_IDENTIFIER_POLICY_UNAVAILABLE",
        source: "EBAY_METADATA_GET_CATEGORY_POLICIES_READONLY",
        httpStatus: 0, readAttempts: 0, errorIds: [],
      }
    }
  }
  const productIdentifierCapabilityWaiting = Boolean(productIdentifierPolicy
    && (productIdentifierPolicy.blocker ===
      "EBAY_CATEGORY_PRODUCT_IDENTIFIER_POLICY_UNAVAILABLE"
      || productIdentifierPolicy.httpStatus === 0
      || productIdentifierPolicy.httpStatus === 429
      || Number(productIdentifierPolicy.httpStatus ?? 0) >= 500))
  const missingRequiredIdentifiers = productIdentifierPolicy
    ?.missingRequiredIdentifiers ?? []
  const productIdentifiersReady = productIdentifierPolicy
    ? productIdentifierPolicy.safe : null

  const blockers = unique([
    ...(!sellerAccountBindingReady ? ["SELLER_ACCOUNT_BINDING_NOT_READY"] : []),
    ...(!marketplaceIdentityReady ? ["MARKETPLACE_IDENTITY_NOT_READY"] : []),
    ...(!categoryReady ? [waitingForCategoryCapability
      ? "WAITING_FOR_EBAY_CAPABILITY" : "MARKETPLACE_CATEGORY_NOT_READY"] : []),
    ...(!conditionReady ? ["MARKETPLACE_CONDITION_NOT_READY"] : []),
    ...(!requiredItemSpecificsReady ? [
      unsupportedRequiredSpecifics.length
        ? `MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN:${unsupportedRequiredSpecifics.join("|")}`
        : "MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN",
    ] : []),
    ...(productIdentifierCapabilityWaiting
      ? ["WAITING_FOR_EBAY_CAPABILITY"] : []),
    ...(!productIdentifierCapabilityWaiting
      && missingRequiredIdentifiers.length
      ? [`OWNER_FACT_REQUIRED:${missingRequiredIdentifiers.join("|")}`] : []),
    ...(!fulfillmentPolicyReady ? ["FULFILLMENT_POLICY_NOT_READY"] : []),
    ...(!paymentPolicyReady ? ["PAYMENT_POLICY_NOT_READY"] : []),
    ...(!returnPolicyReady ? ["RETURN_POLICY_NOT_READY"] : []),
    ...(!locationOrInventoryContextReady
      ? ["LOCATION_OR_INVENTORY_CONTEXT_NOT_READY"] : []),
  ])
  const ready = blockers.length === 0
  const observedAt = taxonomy?.observedAt ?? now.toISOString()
  const revalidateAfter = new Date(
    Date.parse(observedAt) + TAXONOMY_REVALIDATION_MS,
  ).toISOString()
  const core = {
    contractVersion: RADAR_CANONICAL_MARKETPLACE_READINESS_VERSION,
    authority: "SELLER_OS_DETERMINISTIC_FACTORY",
    marketplaceId: "EBAY_US",
    accountKey: input.accountKey,
    radarCandidateId: radar.candidateId,
    queueCandidateKey: input.opportunity.candidate_key,
    supplierProductId: input.opportunity.supplier_product_id,
    supplierVariantId: input.opportunity.supplier_variant_id,
    supplierSku: input.opportunity.supplier_sku,
    productTruthDigest: resolvedProductTruthDigest,
    demandEvidenceGrain: "FAMILY",
    exactProductDemandClaimed: false,
    listingPackageId,
    categoryId: categoryId || null,
    categoryName: taxonomy?.categoryName ?? packageData.categoryName ?? null,
    categorySource,
    categoryResolutionAttempted:
      categoryResolver.categoryResolutionAttempted === true,
    categoryCandidateCount:
      Number(categoryResolver.categoryCandidateCount ?? 0),
    categoryConfidence: categoryResolver.categoryConfidence ?? null,
    categoryBlockerReason: categoryReady
      ? null : categoryResolver.categoryBlockerReason
        ?? (waitingForCategoryCapability
          ? "WAITING_FOR_EBAY_CAPABILITY" : "CATEGORY_UNRESOLVED"),
    categoryReady,
    conditionId: conditionId || null,
    conditionLabel: conditionContract?.canonicalLabel ?? null,
    conditionSource,
    conditionReady,
    requiredItemSpecificsCount: requiredNames.length,
    requiredItemSpecificsSatisfied,
    unsupportedRequiredSpecifics,
    requiredItemSpecificsReady,
    productIdentifierPolicy,
    availableProductIdentifiers,
    productIdentifiersReady,
    missingRequiredIdentifiers,
    requiredItemSpecificsTruth:
      specificsTruth?.evidence ?? null,
    requiredSpecificsBatchResolutionDigest,
    taxonomyPreflight,
    fulfillmentPolicyId: fulfillmentPolicyId || null,
    paymentPolicyId: paymentPolicyId || null,
    returnPolicyId: returnPolicyId || null,
    merchantLocationKey: merchantLocationKey || null,
    fulfillmentPolicyReady,
    paymentPolicyReady,
    returnPolicyReady,
    locationOrInventoryContextReady,
    listingPolicyReady,
    sellerAccountBindingReady,
    marketplaceIdentityReady,
    policyVerificationSource: profile.verification_source ?? null,
    policyVerifiedAt: profile.verified_at ?? null,
    policyExpiresAt: profile.expires_at ?? null,
    ready,
    blockers,
    observedAt,
    revalidateAfter,
    marketplaceWrites: 0,
  }
  return Object.freeze({
    evidence: Object.freeze({ ...core, evidenceDigest: digest(core) }),
    productTruth: Object.freeze(resolvedProductTruth),
    requiredItemSpecificsTruth:
      Object.freeze(specificsTruth?.evidence ?? {}),
    requiredSpecificsBatchInput:
      specificsTruth?.requiredSpecificsBatchInput ?? null,
    acquisitionRequired: true as const,
    reused: false as const,
  })
}
