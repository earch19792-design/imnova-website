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

export const RADAR_CANONICAL_MARKETPLACE_READINESS_VERSION =
  "RADAR_CANONICAL_MARKETPLACE_READINESS_CONTINUATION_V1" as const

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
  const reusable = listingPackageId ? existingEvidence({
    opportunity: input.opportunity,
    productTruthDigest,
    listingPackageId,
    accountKey: input.accountKey,
    now,
  }) : null
  if (reusable) {
    return Object.freeze({
      evidence: Object.freeze(reusable),
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

  let taxonomyPreflight: JsonRecord = {}
  if (categoryReady && taxonomy && validUuid(listingPackageId)) {
    const exactValues = buildEbayCategoryResolverProductTruthV1({
      opportunity: input.opportunity,
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
    && requiredNames.length >= 0
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
    productTruthDigest,
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
    acquisitionRequired: true as const,
    reused: false as const,
  })
}
