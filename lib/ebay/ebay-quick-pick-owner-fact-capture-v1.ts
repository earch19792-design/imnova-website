import type { SupabaseClient } from "@supabase/supabase-js"

import { buildEbayCategoryResolverProductTruthV1 } from
  "./ebay-category-resolver-v1"
import {
  applyOwnerExplicitProductFactV1,
  buildOwnerExplicitProductFactV1,
  ownerExplicitProductTruthFactsV1,
} from "./ebay-human-product-truth-evidence-v1"
import { buildEbayListingTaxonomyPreflightV1 } from
  "./ebay-listing-taxonomy-preflight-v1"
import { assertListingPackageContextV1,
  assertTaxonomySnapshotContextV1 } from
  "./ebay-listing-context-isolation-v1"
import { buildOfficialEbayRequirementClassificationV1 } from
  "./ebay-minimum-truthful-listing-readiness-v1"
import { continueLunaQuickPickMinimumReadinessV1 } from
  "./ebay-quick-pick-minimum-readiness-continuation-v1"
import type { RadarProductIdentifierPolicyReaderV1 } from
  "./ebay-radar-canonical-marketplace-readiness-v1"
import type { EbayTaxonomyListingIntelligence } from
  "./ebay-seller-keyword-demand-gateway"
import { materializeSellerOsDeterministicFactoryCandidateV1 } from
  "./ebay-smart-stocking-durable-factory-v1"

export const QUICK_PICK_OWNER_LAST_MILE_FACT_CAPTURE_V1 =
  "QUICK_PICK_OWNER_LAST_MILE_FACT_CAPTURE_V1" as const

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().slice(0, maximum) : ""
}

function key(value: unknown) {
  return text(value, 120).normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ").trim()
}

function uuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(text(value, 80))
}

function taxonomyFromPersistedPreflightV1(
  preflight: JsonRecord,
): EbayTaxonomyListingIntelligence {
  const aspects = rows(preflight.aspects).map((aspect) => ({
    name: text(aspect.name, 120),
    required: aspect.required === true,
    enabledForVariations: aspect.enabledForVariations === true,
    usage: text(aspect.usage, 40) || null,
    mode: text(aspect.mode, 40) || null,
    cardinality: text(aspect.cardinality, 40) || null,
    maxLength: Number.isInteger(Number(aspect.maxLength))
      && Number(aspect.maxLength) > 0 ? Number(aspect.maxLength) : null,
    dataType: text(aspect.dataType, 40) || null,
    format: text(aspect.format, 80) || null,
    advancedDataType: text(aspect.advancedDataType, 80) || null,
    expectedRequiredByDate:
      text(aspect.expectedRequiredByDate, 40) || null,
    suggestedValues: Array.isArray(aspect.suggestedValues)
      ? aspect.suggestedValues.map((value) => text(value, 500))
        .filter(Boolean) : [],
    values: rows(aspect.values).flatMap((entry) => {
      const value = text(entry.value, 500)
      if (!value) return []
      return [{ value, valueConstraints: rows(entry.valueConstraints)
        .flatMap((constraint) => {
          const applicableForAspectName = text(
            constraint.applicableForAspectName, 120)
          const applicableForAspectValues = Array.isArray(
            constraint.applicableForAspectValues)
            ? constraint.applicableForAspectValues.map((candidate) =>
              text(candidate, 500)).filter(Boolean) : []
          return applicableForAspectName && applicableForAspectValues.length
            ? [{ applicableForAspectName, applicableForAspectValues }] : []
        }) }]
    }),
    valuesComplete: aspect.valuesComplete === true,
    constraintsComplete: aspect.constraintsComplete === true,
    officialConditionalRequirement: (() => {
      const conditional = record(aspect.officialConditionalRequirement)
      return conditional.source === "EBAY_TAXONOMY_OFFICIAL_READONLY"
        && conditional.machineEvaluable === true
        && ["APPLIES", "DOES_NOT_APPLY", "UNPROVEN"].includes(
          String(conditional.evaluation ?? ""))
        ? { source: "EBAY_TAXONOMY_OFFICIAL_READONLY" as const,
            machineEvaluable: true as const,
            evaluation: conditional.evaluation as
              "APPLIES" | "DOES_NOT_APPLY" | "UNPROVEN" }
        : null
    })(),
  })).filter((aspect) => aspect.name)
  if (!aspects.length) {
    throw new Error("OWNER_FACT_OFFICIAL_TAXONOMY_SNAPSHOT_UNAVAILABLE")
  }
  return {
    status: "AVAILABLE",
    categoryTreeId: text(preflight.categoryTreeId, 40),
    categoryTreeVersion: text(preflight.categoryTreeVersion, 40) || null,
    categoryId: text(preflight.categoryId, 20),
    categoryName: text(preflight.categoryName, 200) || null,
    taxonomyMarketplaceId: "EBAY_US",
    observedAt: text(preflight.observedAt, 80),
    aspects,
    requiredAspects: aspects.filter((aspect) => aspect.required),
    recommendedAspects: aspects.filter((aspect) =>
      !aspect.required && aspect.usage === "RECOMMENDED"),
    categoryResolution: "KNOWN_CATEGORY",
    failureCode: null,
    source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
  }
}

function cachedIdentifierReaderV1(canonical: JsonRecord):
RadarProductIdentifierPolicyReaderV1 {
  const policy = record(canonical.productIdentifierPolicy)
  if (policy.source !== "EBAY_METADATA_GET_CATEGORY_POLICIES_READONLY") {
    throw new Error("OWNER_FACT_IDENTIFIER_POLICY_SNAPSHOT_UNAVAILABLE")
  }
  return async () => Object.freeze({
    safe: policy.safe === true,
    exactPolicyFound: policy.exactPolicyFound === true,
    policies: Array.isArray(policy.policies) ? policy.policies : [],
    missingRequiredIdentifiers: Array.isArray(
      policy.missingRequiredIdentifiers)
      ? policy.missingRequiredIdentifiers.map((entry) => text(entry, 80))
        .filter(Boolean) : [],
    blocker: text(policy.blocker, 120) || null,
    source: "EBAY_METADATA_GET_CATEGORY_POLICIES_READONLY",
    httpStatus: Number.isFinite(Number(policy.httpStatus))
      ? Number(policy.httpStatus) : 0,
    readAttempts: 0,
    errorIds: Array.isArray(policy.errorIds)
      ? policy.errorIds.map((entry) => text(entry, 40)).filter(Boolean) : [],
  })
}

export async function persistQuickPickOwnerExplicitFactV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  actorUserId: string
  candidateKey: string
  listingPackageId: string
  specificName: string
  exactValue: string
}>) {
  if (!uuid(input.actorUserId)
      || !/^sha256:[0-9a-f]{64}$/.test(input.candidateKey)
      || !uuid(input.listingPackageId)
      || !text(input.specificName, 120)
      || !text(input.exactValue, 500)) {
    throw new Error("QUICK_PICK_OWNER_FACT_INPUT_INVALID")
  }
  const [opportunityRead, packageRead] = await Promise.all([
    input.supabase.from("ebay_luna_opportunity_queue").select("*")
      .eq("candidate_key", input.candidateKey).limit(2),
    input.supabase.from("ebay_listing_packages").select("*")
      .eq("id", input.listingPackageId)
      .eq("candidate_key", input.candidateKey)
      .eq("account_key", input.accountKey).maybeSingle(),
  ])
  const opportunities = Array.isArray(opportunityRead.data)
    ? opportunityRead.data.map(record) : []
  const opportunity = opportunities.length === 1 ? opportunities[0] : {}
  const listingPackage = record(packageRead.data)
  if (opportunityRead.error || packageRead.error || !opportunity.id
      || !listingPackage.id || opportunities.length !== 1) {
    throw new Error("QUICK_PICK_OWNER_FACT_EXACT_OPERATION_NOT_FOUND")
  }
  if (![null, input.actorUserId].includes(
    listingPackage.created_by as string | null)
      || !["draft", "ready_for_review"].includes(
        text(listingPackage.status, 40))) {
    throw new Error("QUICK_PICK_OWNER_FACT_PACKAGE_NOT_EDITABLE")
  }
  const context = {
    marketplaceId: "EBAY_US" as const,
    listingPackageId: input.listingPackageId,
    opportunityId: text(opportunity.id, 80),
    candidateKey: input.candidateKey,
  }
  assertListingPackageContextV1({ expected: context,
    listingPackage, opportunity })
  const assessment = record(opportunity.assessment)
  const canonical = record(assessment.canonicalMarketplaceReadinessV1)
  const preflight = record(canonical.taxonomyPreflight)
  const categoryId = text(canonical.categoryId, 20)
  assertTaxonomySnapshotContextV1({ expected: context,
    taxonomyPreflight: preflight, categoryId })
  const officialRequirements =
    buildOfficialEbayRequirementClassificationV1({
      taxonomyPreflight: preflight,
      ownerProposals: rows(record(
        assessment.quickPickRequiredSpecificsContinuationV1)
        .residualOwnerActions),
      specificNames: [
        ...(Array.isArray(record(
          assessment.quickPickRequiredSpecificsContinuationV1)
          .exactUnresolvedFields)
          ? record(assessment.quickPickRequiredSpecificsContinuationV1)
            .exactUnresolvedFields as unknown[] : []),
        input.specificName,
      ].map((value) => text(value, 120)).filter(Boolean),
    })
  if (!officialRequirements.officialRequirementClassification) {
    throw new Error("QUICK_PICK_OWNER_FACT_REQUIREMENT_AUTHORITY_UNPROVEN")
  }
  const requirement = officialRequirements.classifications.find((entry) =>
    key(entry.specificName) === key(input.specificName))
  const currentOwnerFacts = ownerExplicitProductTruthFactsV1(opportunity)
  const currentOwnerFact = currentOwnerFacts.find((entry) =>
    key(entry.specificName) === key(input.specificName))
  const actionableRequirement = requirement?.requirementClass ===
      "REQUIRED_TO_LIST"
    || (requirement?.requirementClass === "CONDITIONALLY_REQUIRED"
      && requirement.conditionEvaluation === "APPLIES")
  if (!requirement || !actionableRequirement
      || (!requirement.blocksMinimumTruthfulListing && !currentOwnerFact)) {
    throw new Error("QUICK_PICK_OWNER_FACT_NOT_TRUE_PUBLICATION_BLOCKER")
  }
  const officialAspect = rows(preflight.aspects).find((aspect) =>
    key(aspect.name) === key(requirement.specificName))
  if (!officialAspect || (officialAspect.required !== true
      && requirement.requirementClass !== "CONDITIONALLY_REQUIRED")) {
    throw new Error("QUICK_PICK_OWNER_FACT_OFFICIAL_ASPECT_MISMATCH")
  }
  const capturedAt = new Date().toISOString()
  const proposedEvidence = buildOwnerExplicitProductFactV1({
    opportunity,
    listingPackageId: input.listingPackageId,
    marketplaceId: "EBAY_US",
    actorId: input.actorUserId,
    aspect: {
      name: text(officialAspect.name, 120),
      required: officialAspect.required === true,
      officialRequirementClass: requirement.requirementClass,
      mode: text(officialAspect.mode, 40) || "FREE_TEXT",
      valuesComplete: officialAspect.valuesComplete === true,
      values: rows(officialAspect.values).map((entry) => ({
        value: text(entry.value, 500),
      })).filter((entry) => entry.value),
      maxLength: Number.isInteger(Number(officialAspect.maxLength))
        ? Number(officialAspect.maxLength) : null,
      dataType: text(officialAspect.dataType, 40) || "STRING",
    },
    exactValue: input.exactValue,
    officialPolicyEvidenceDigest: text(preflight.evidenceDigest, 100),
    categoryId,
    capturedAt,
    supersedesEvidenceDigest:
      text(currentOwnerFact?.evidenceDigest, 100) || null,
  })
  const applied = applyOwnerExplicitProductFactV1({ opportunity,
    evidence: proposedEvidence as unknown as JsonRecord })
  let updatedOpportunity = opportunity
  if (applied.created || applied.corrected) {
    const update = await input.supabase.from("ebay_luna_opportunity_queue")
      .update({ assessment: applied.assessment, updated_at: capturedAt })
      .eq("id", opportunity.id)
      .eq("candidate_key", input.candidateKey)
      .eq("updated_at", opportunity.updated_at)
      .select("*").maybeSingle()
    if (update.error || !update.data) {
      throw new Error("QUICK_PICK_OWNER_FACT_STALE_VERSION")
    }
    updatedOpportunity = record(update.data)
  }
  const durableFacts = ownerExplicitProductTruthFactsV1(updatedOpportunity)
  const durableFact = durableFacts.find((entry) =>
    key(entry.specificName) === key(requirement.specificName))
  if (!durableFact || key(durableFact.normalizedMarketplaceValue) !==
      key(applied.evidence.normalizedMarketplaceValue)) {
    throw new Error("QUICK_PICK_OWNER_FACT_DURABLE_READBACK_MISMATCH")
  }

  const taxonomy = taxonomyFromPersistedPreflightV1(preflight)
  const productTruth = buildEbayCategoryResolverProductTruthV1({
    opportunity: updatedOpportunity,
    packageData: record(listingPackage.package_data),
  })
  const refreshedPreflight = buildEbayListingTaxonomyPreflightV1({
    taxonomy,
    expectedCategoryId: categoryId,
    context,
    existingAspects: {},
    provenProductValues: productTruth.provenProductValues,
    marketplaceRequirementValues: record(
      preflight.marketplaceValuesAutoBound) as Record<string, string>,
    marketplaceRequirementEvidence:
      record(preflight.marketplaceRequirementEvidence),
    knownUnknownAspectNames: productTruth.knownUnknownAspectNames,
    unprovenAspectEvidenceRequirements:
      productTruth.unprovenAspectEvidenceRequirements,
  })
  if (key(refreshedPreflight.resolvedAspects[requirement.specificName]) !==
      key(durableFact.normalizedMarketplaceValue)
      || refreshedPreflight.unprovenRequiredAspectNames.some((name) =>
        key(name) === key(requirement.specificName))) {
    throw new Error("QUICK_PICK_OWNER_FACT_TAXONOMY_BINDING_FAILED")
  }
  const packageData = record(listingPackage.package_data)
  const nextPackageData = {
    ...packageData,
    aspects: refreshedPreflight.resolvedAspects,
    taxonomyPreflight: refreshedPreflight,
  }
  let packageUpdate = input.supabase.from("ebay_listing_packages").update({
    package_data: nextPackageData,
    updated_at: capturedAt,
  }).eq("id", listingPackage.id)
    .eq("opportunity_id", opportunity.id)
    .eq("candidate_key", input.candidateKey)
    .eq("account_key", input.accountKey)
    .eq("updated_at", listingPackage.updated_at)
  packageUpdate = listingPackage.created_by === null
    ? packageUpdate.is("created_by", null)
    : packageUpdate.eq("created_by", input.actorUserId)
  const packageWrite = await packageUpdate.select("*").maybeSingle()
  const storedPackage = record(packageWrite.data)
  const storedPreflight = record(record(storedPackage.package_data)
    .taxonomyPreflight)
  if (packageWrite.error || !storedPackage.id
      || storedPreflight.evidenceDigest !== refreshedPreflight.evidenceDigest) {
    throw new Error("QUICK_PICK_OWNER_FACT_PACKAGE_READBACK_MISMATCH")
  }

  const cachedTaxonomyReader = async () => taxonomy
  const cachedIdentifierReader = cachedIdentifierReaderV1(canonical)
  const materialized =
    await materializeSellerOsDeterministicFactoryCandidateV1({
      supabase: input.supabase,
      accountKey: input.accountKey,
      opportunityId: text(opportunity.id, 80),
      candidateKey: input.candidateKey,
      taxonomyReader: cachedTaxonomyReader,
      productIdentifierPolicyReader: cachedIdentifierReader,
    })
  const continuation = await continueLunaQuickPickMinimumReadinessV1({
    supabase: input.supabase,
    accountKey: input.accountKey,
    candidateKeys: [input.candidateKey],
  })
  return Object.freeze({
    contractVersion: QUICK_PICK_OWNER_LAST_MILE_FACT_CAPTURE_V1,
    candidateKey: input.candidateKey,
    opportunityId: text(opportunity.id, 80),
    listingPackageId: input.listingPackageId,
    supplierProductId: text(opportunity.supplier_product_id, 80),
    variantId: text(opportunity.supplier_variant_id, 80),
    supplierSku: text(opportunity.supplier_sku, 120),
    specificName: durableFact.specificName,
    exactValue: durableFact.exactValue,
    normalizedMarketplaceValue: durableFact.normalizedMarketplaceValue,
    ownerFactCaptured: true as const,
    durable: true as const,
    created: applied.created,
    corrected: applied.corrected,
    evidenceDigest: durableFact.evidenceDigest,
    officialPolicyEvidenceDigest: durableFact.officialPolicyEvidenceDigest,
    minimumTruthfulListingReady:
      materialized.canonicalMarketplaceReadinessReady === true
        && (materialized.listingReady === true
          || materialized.marketTestReady === true),
    safeResumePathReady: true as const,
    safeResumeFrom:
      "PRODUCT_TRUTH_REQUIRED_SPECIFICS_IDENTIFIER_POLICY_MARKETPLACE_READINESS",
    continuation,
    previousGateReexecution: {
      identity: false, duplicate: false, demand: false, stock: false,
      shipping: false, economics: false, category: false,
      soldResearch: false, browse: false, visualMatching: false,
    },
    officialEbayNetworkCalls: 0 as const,
    sellerWideTradingCalls: 0 as const,
    marketplaceWrites: 0 as const,
    listingPublications: 0 as const,
    listingMutations: 0 as const,
    factInvented: false as const,
  })
}
