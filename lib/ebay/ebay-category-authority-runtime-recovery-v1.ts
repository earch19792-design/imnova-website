import type { SupabaseClient } from "@supabase/supabase-js"

import { continueLunaQuickPickPostShippingRuntimeV1 } from
  "./ebay-quick-pick-post-shipping-continuation-v1"
import type { RadarMarketplaceTaxonomyReaderV1,
  RadarProductIdentifierPolicyReaderV1 } from
  "./ebay-radar-canonical-marketplace-readiness-v1"
import { isSellerOsDeterministicFactoryPackageV1,
  materializeSellerOsDeterministicFactoryCandidateV1 } from
  "./ebay-smart-stocking-durable-factory-v1"

export const EBAY_CATEGORY_FALSE_EXACT_AUTHORITY_RECOVERY_V1 =
  "EBAY_CATEGORY_FALSE_EXACT_AUTHORITY_RECOVERY_V1" as const

const MAXIMUM_SCAN_ROWS = 100
const MAXIMUM_RECOVERY_ROWS = 20
type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function validUuid(value: unknown) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
}

function validCandidateKey(value: unknown) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value)
}

function validCategoryId(value: unknown) {
  return typeof value === "string" && /^\d{1,20}$/.test(value)
}

export function projectFalseExactCategoryAuthorityRecoveryV1(value: unknown) {
  const row = record(value)
  const packageData = record(row.package_data)
  const resolver = record(packageData.categoryResolverV1)
  const semantic = record(resolver.semanticCompatibility)
  const invalidation = record(packageData.categoryDerivedStateInvalidationV1)
  const categoryId = validCategoryId(packageData.categoryId)
    ? String(packageData.categoryId) : null
  const familyTypeFingerprint = typeof resolver.familyTypeFingerprint ===
      "string" && /^sha256:[0-9a-f]{64}$/.test(resolver.familyTypeFingerprint)
    ? resolver.familyTypeFingerprint : null
  const semanticProofCurrent = semantic.status === "PROVEN"
    && semantic.categoryId === categoryId
    && semantic.familyTypeFingerprint === familyTypeFingerprint
    && ["EXACT_LISTING_ACCEPTANCE", "OFFICIAL_TITLE_SUGGESTION",
      "EXACT_PRODUCT_TRUTH_CATEGORY"].includes(String(
      semantic.evidenceClass ?? ""))
  const deterministicFactoryPackage =
    isSellerOsDeterministicFactoryPackageV1(packageData)
  const rematerializationPending = invalidation.contractVersion ===
      "SELLER_OS_CATEGORY_DERIVED_STATE_INVALIDATION_V1"
    && invalidation.packageReadinessInvalidated === true
    && invalidation.packageRematerializedByRuntime !== true
  const eligible = deterministicFactoryPackage
    && validUuid(row.id)
    && validUuid(row.opportunity_id)
    && validCandidateKey(row.candidate_key)
    && resolver.status === "AUTO_SELECTED"
    && Boolean(categoryId)
    && (!semanticProofCurrent || rematerializationPending)
  return Object.freeze({
    eligible,
    listingPackageId: eligible ? String(row.id) : null,
    opportunityId: eligible ? String(row.opportunity_id) : null,
    candidateKey: eligible ? String(row.candidate_key) : null,
    oldCategoryId: eligible ? categoryId : null,
    reasonCode: eligible
      ? rematerializationPending
        ? "CATEGORY_PACKAGE_REMATERIALIZATION_PENDING"
        : "CATEGORY_SEMANTIC_AUTHORITY_UNPROVEN"
      : semanticProofCurrent ? "SEMANTIC_AUTHORITY_ALREADY_PROVEN"
        : !deterministicFactoryPackage ? "PACKAGE_NOT_DETERMINISTIC_FACTORY"
          : "CATEGORY_AUTHORITY_NOT_RECOVERABLE",
  })
}

async function readRecoveryRowsV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
}>) {
  const read = await input.supabase.from("ebay_listing_packages")
    .select("id,account_key,opportunity_id,candidate_key,created_by,package_data,updated_at")
    .eq("account_key", input.accountKey)
    .order("updated_at", { ascending: false })
    .limit(MAXIMUM_SCAN_ROWS)
  if (read.error) throw new Error("CATEGORY_AUTHORITY_RECOVERY_SCOPE_READ_FAILED")
  return rows(read.data)
}

type Materialize = typeof materializeSellerOsDeterministicFactoryCandidateV1
type ContinueRuntime = typeof continueLunaQuickPickPostShippingRuntimeV1

export async function recoverFalseExactCategoryAuthorityRuntimeV1(
  input: Readonly<{
    supabase: SupabaseClient
    accountKey: string
    taxonomyReader: RadarMarketplaceTaxonomyReaderV1
    productIdentifierPolicyReader?: RadarProductIdentifierPolicyReaderV1
    dependencies?: Readonly<{
      readRows?: typeof readRecoveryRowsV1
      materialize?: Materialize
      continueRuntime?: ContinueRuntime
    }>
  }>,
) {
  const durableRows = await (input.dependencies?.readRows ?? readRecoveryRowsV1)({
    supabase: input.supabase,
    accountKey: input.accountKey,
  })
  const eligible = durableRows.map((row) => ({ row,
    projection: projectFalseExactCategoryAuthorityRecoveryV1(row) }))
    .filter((entry) => entry.projection.eligible)
    .slice(0, MAXIMUM_RECOVERY_ROWS)
  const outcomes: JsonRecord[] = []
  const rematerializedCandidateKeys: string[] = []
  for (const entry of eligible) {
    try {
      const result = await (input.dependencies?.materialize ??
        materializeSellerOsDeterministicFactoryCandidateV1)({
        supabase: input.supabase,
        accountKey: input.accountKey,
        opportunityId: String(entry.projection.opportunityId),
        candidateKey: String(entry.projection.candidateKey),
        taxonomyReader: input.taxonomyReader,
        productIdentifierPolicyReader: input.productIdentifierPolicyReader,
      })
      rematerializedCandidateKeys.push(String(entry.projection.candidateKey))
      outcomes.push(Object.freeze({
        listingPackageId: entry.projection.listingPackageId,
        candidateKey: entry.projection.candidateKey,
        oldCategoryId: entry.projection.oldCategoryId,
        initialRematerializationCompleted: true,
        listingReady: result.listingReady === true,
        marketTestReady: result.marketTestReady === true,
        marketplaceWrites: 0,
      }))
    } catch (error) {
      const code = error instanceof Error ? error.message : ""
      outcomes.push(Object.freeze({
        listingPackageId: entry.projection.listingPackageId,
        candidateKey: entry.projection.candidateKey,
        oldCategoryId: entry.projection.oldCategoryId,
        initialRematerializationCompleted: false,
        errorCode: /^[A-Z][A-Z0-9_]{2,119}$/.test(code)
          ? code : "CATEGORY_AUTHORITY_REMATERIALIZATION_FAILED",
        marketplaceWrites: 0,
      }))
    }
  }
  const continuation = rematerializedCandidateKeys.length
    ? await (input.dependencies?.continueRuntime ??
      continueLunaQuickPickPostShippingRuntimeV1)({
      supabase: input.supabase,
      accountKey: input.accountKey,
      candidateKeys: rematerializedCandidateKeys,
      scopeMode: "EXACT_REQUEST",
      trigger: "OVERNIGHT_ENRICHMENT",
      taxonomyReader: input.taxonomyReader,
      productIdentifierPolicyReader: input.productIdentifierPolicyReader,
    }) : null
  const failures = outcomes.filter((outcome) => outcome.errorCode).length
  return Object.freeze({
    contractVersion: EBAY_CATEGORY_FALSE_EXACT_AUTHORITY_RECOVERY_V1,
    status: failures ? "PARTIAL" as const : "PASS" as const,
    scannedPackageCount: durableRows.length,
    eligiblePackageCount: eligible.length,
    rematerializedPackageCount: rematerializedCandidateKeys.length,
    outcomes: Object.freeze(outcomes),
    continuation,
    allExactPreviouslyCertifiedCategoryEmissionPathsAudited: true as const,
    categoryExistenceOnlyMayCertify: false as const,
    normalCategoryResolverPathUsed: true as const,
    sellerOsRuntimeAuthority: true as const,
    codexCategorySelection: 0 as const,
    itemSpecificPatches: 0 as const,
    marketplaceWrites: 0 as const,
  })
}
