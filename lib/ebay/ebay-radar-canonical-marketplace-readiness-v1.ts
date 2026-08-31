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
import { ebayConditionContractFromVerifiedFact } from
  // @ts-expect-error Node direct TypeScript tests require the explicit extension;
  // the production bundler resolves the same source module.
  "./ebay-manual-listing-domain.ts"
import type { EbayTaxonomyListingIntelligence } from
  "./ebay-seller-keyword-demand-gateway"
import type { EbayTaxonomyAspectIntelligence } from
  "./ebay-seller-keyword-demand-gateway"
import {
  MARKETPLACE_REQUIRED_SPECIFICS_BATCH_RESOLUTION_V1,
  requiredSpecificBatchEvidenceDigestV1,
} from "./ebay-marketplace-required-specifics-batch-resolution-v1"

export const RADAR_CANONICAL_MARKETPLACE_READINESS_VERSION =
  "RADAR_CANONICAL_MARKETPLACE_READINESS_CONTINUATION_V3" as const
export const RADAR_REQUIRED_ITEM_SPECIFICS_TRUTH_RESOLUTION_VERSION =
  "RADAR_REQUIRED_ITEM_SPECIFICS_TRUTH_RESOLUTION_V1" as const

const TAXONOMY_REVALIDATION_MS = 6 * 60 * 60 * 1_000

type JsonRecord = Record<string, unknown>

export type RadarMarketplaceTaxonomyReaderV1 = (
  query: string,
  categoryId?: string | null,
  options?: { allowTitleSuggestionFallback?: boolean },
) => Promise<EbayTaxonomyListingIntelligence>

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

function urls(value: unknown, maximum = 20) {
  return Array.isArray(value)
    ? value.map((entry) => text(entry, 2_000))
      .filter((entry) => /^https:\/\//.test(entry)).slice(0, maximum)
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

function plainText(value: unknown, maximum = 8_000) {
  return text(typeof value === "string"
    ? value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ") : "", maximum)
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
  return Object.freeze({
    name: aspect.name,
    required: aspect.required,
    dataType: aspect.dataType,
    mode: aspect.mode,
    freeTextAllowed: aspect.mode !== "SELECTION_ONLY",
    cardinality: aspect.cardinality,
    allowedValues: values.length <= 50 ? values : aspect.suggestedValues,
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
  const byName = new Map(required.map((aspect) => [aspectKey(aspect.name), aspect]))
  const exactIdentity = Boolean(input.catalogRow
    && input.catalogRow.supplier_product_id ===
      input.opportunity.supplier_product_id
    && input.catalogRow.supplier_variant_id ===
      input.opportunity.supplier_variant_id
    && input.catalogRow.sku === input.opportunity.supplier_sku)
  const existingValues = record(input.productTruth.provenProductValues)
  const provenProductValues: Record<string, string> = {}
  for (const [name, value] of Object.entries(existingValues)) {
    const normalized = text(value, 500)
    if (normalized) provenProductValues[text(name, 120)] = normalized
  }
  const exactTitle = exactIdentity ? text(input.catalogRow?.title, 350) : ""
  const structuredVendor = exactIdentity
    ? text(input.catalogRow?.vendor, 160) : ""
  const resolutions: Record<string, Readonly<{
    value: string | null
    source: string | null
    exactProductSupported: boolean
  }>> = {}
  for (const requestedName of ["Style", "Brand", "Type"] as const) {
    const aspect = byName.get(aspectKey(requestedName))
    let value: string | null = null
    let source: string | null = null
    if (aspect && exactIdentity && requestedName === "Brand") {
      const allowed = exactOfficialValue(aspect, structuredVendor)
      if (allowed && !SUPPLIER_VENDOR_IDENTITIES.has(
        normalizedPhrase(structuredVendor))) {
        value = allowed
        source = "LUNA_EXACT_STRUCTURED_VENDOR"
      }
    } else if (aspect && exactIdentity) {
      value = firstExactTitleValue(aspect, exactTitle)
      if (value) source = "LUNA_EXACT_PRODUCT_TITLE"
    }
    if (value) provenProductValues[aspect?.name ?? requestedName] = value
    resolutions[requestedName] = Object.freeze({
      value,
      source,
      exactProductSupported: Boolean(value),
    })
  }
  const unresolved = Object.entries(resolutions)
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
  const aspectContracts = ["Style", "Brand", "Type"].flatMap((name) => {
    const aspect = byName.get(aspectKey(name))
    return aspect ? [compactAspectContract(aspect)] : []
  })
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
  } : {}
  const exactVariantData = exactIdentity ? {
    title: text(input.catalogRow?.variant_title, 240),
    sku: text(input.catalogRow?.sku, 120),
    ...stringRecord(input.catalogRow?.variant_metadata),
  } : {}
  const batchInputCore = {
    radarCandidateId: text(record(record(input.opportunity.assessment)
      .radarFactoryCandidateV1).candidateId, 80),
    lunaProductId: text(input.opportunity.supplier_product_id, 80),
    lunaVariantId: text(input.opportunity.supplier_variant_id, 80),
    supplierSku: text(input.opportunity.supplier_sku, 120),
    marketplaceId: "EBAY_US" as const,
    categoryId: input.taxonomy.categoryId ?? "",
    exactProductTitle: exactTitle,
    exactDescription: exactIdentity
      ? plainText(input.catalogRow?.body_html) : "",
    exactSpecs,
    exactVariantData,
    exactImageUrls: exactIdentity
      ? unique([text(input.catalogRow?.featured_image_url, 2_000),
        ...urls(input.catalogRow?.image_urls, 20)]) : [],
    unresolvedRequiredAspects: unresolved,
    officialAspectDefinitions: aspectContracts,
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
}>) {
  const assessment = record(input.opportunity.assessment)
  const value = record(assessment.canonicalMarketplaceReadinessV1)
  const { evidenceDigest: storedDigest, ...core } = value
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
    && (value.requiredSpecificsBatchResolutionDigest ?? null) ===
      input.requiredSpecificsBatchResolutionDigest
    && validCandidateId(value.radarCandidateId)
    && value.demandEvidenceGrain === "FAMILY"
    && value.exactProductDemandClaimed === false
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
  const reusable = listingPackageId ? existingEvidence({
    opportunity: input.opportunity,
    productTruthDigest,
    listingPackageId,
    accountKey: input.accountKey,
    now,
    requiredSpecificsBatchResolutionDigest,
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
  const categoryId = packageExact && validCategoryId(packageData.categoryId)
    ? text(packageData.categoryId, 20) : ""
  const categorySource = categoryId
    ? "EXISTING_DURABLE_LISTING_PACKAGE_EXACT_OPPORTUNITY_BINDING" : null
  const conditionContract = packageExact
    ? ebayConditionContractFromVerifiedFact(packageData.conditionLabel) : null
  const conditionId = conditionContract
    && text(packageData.conditionId, 20) === conditionContract.conditionId
    ? conditionContract.conditionId : ""
  const conditionSource = conditionId
    ? "EXISTING_DURABLE_LISTING_PACKAGE_EXACT_OPPORTUNITY_BINDING" : null

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

  const blockers = unique([
    ...(!sellerAccountBindingReady ? ["SELLER_ACCOUNT_BINDING_NOT_READY"] : []),
    ...(!marketplaceIdentityReady ? ["MARKETPLACE_IDENTITY_NOT_READY"] : []),
    ...(!categoryReady ? ["MARKETPLACE_CATEGORY_NOT_READY"] : []),
    ...(!conditionReady ? ["MARKETPLACE_CONDITION_NOT_READY"] : []),
    ...(!requiredItemSpecificsReady ? [
      unsupportedRequiredSpecifics.length
        ? `MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN:${unsupportedRequiredSpecifics.join("|")}`
        : "MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN",
    ] : []),
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
    categoryReady,
    conditionId: conditionId || null,
    conditionLabel: conditionContract?.canonicalLabel ?? null,
    conditionSource,
    conditionReady,
    requiredItemSpecificsCount: requiredNames.length,
    requiredItemSpecificsSatisfied,
    unsupportedRequiredSpecifics,
    requiredItemSpecificsReady,
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
