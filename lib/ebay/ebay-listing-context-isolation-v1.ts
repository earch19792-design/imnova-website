export const EBAY_LISTING_CONTEXT_ISOLATION_V1 =
  "SELLER_OS_EBAY_LISTING_CONTEXT_ISOLATION_V1" as const

type JsonRecord = Record<string, unknown>

export type EbayListingContextIdentityV1 = Readonly<{
  marketplaceId: "EBAY_US"
  listingPackageId: string
  opportunityId: string
  candidateKey: string
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function validIdentity(value: EbayListingContextIdentityV1) {
  return value.marketplaceId === "EBAY_US"
    && /^[0-9a-f-]{36}$/i.test(value.listingPackageId)
    && /^[0-9a-f-]{36}$/i.test(value.opportunityId)
    && value.candidateKey.length > 0
    && value.candidateKey.length <= 300
}

export function listingPackageMatchesContextV1(input: Readonly<{
  expected: EbayListingContextIdentityV1
  listingPackage: unknown
  opportunity?: unknown
}>) {
  const listingPackage = record(input.listingPackage)
  const opportunity = record(input.opportunity)
  return validIdentity(input.expected)
    && text(listingPackage.id) === input.expected.listingPackageId
    && text(listingPackage.opportunity_id) === input.expected.opportunityId
    && text(listingPackage.candidate_key) === input.expected.candidateKey
    && (!Object.keys(opportunity).length || (
      text(opportunity.id) === input.expected.opportunityId
      && text(opportunity.candidate_key) === input.expected.candidateKey
    ))
}

export function taxonomySnapshotMatchesContextV1(input: Readonly<{
  expected: EbayListingContextIdentityV1
  taxonomyPreflight: unknown
  categoryId: unknown
}>) {
  const preflight = record(input.taxonomyPreflight)
  const categoryId = text(input.categoryId)
  return validIdentity(input.expected)
    && /^\d{1,12}$/.test(categoryId)
    && preflight.contextBindingVersion === EBAY_LISTING_CONTEXT_ISOLATION_V1
    && text(preflight.marketplaceId) === input.expected.marketplaceId
    && text(preflight.listingPackageId) === input.expected.listingPackageId
    && text(preflight.opportunityId) === input.expected.opportunityId
    && text(preflight.candidateKey) === input.expected.candidateKey
    && text(preflight.categoryId) === categoryId
}

export function lifecycleStateMatchesContextV1(input: Readonly<{
  expected: EbayListingContextIdentityV1
  approval?: unknown
  execution?: unknown
  publication?: unknown
}>) {
  if (!validIdentity(input.expected)) return false
  const approval = record(input.approval)
  const execution = record(input.execution)
  const publication = record(input.publication)
  if (Object.keys(approval).length && (
    text(approval.listing_package_id) !== input.expected.listingPackageId
    || text(approval.opportunity_id) !== input.expected.opportunityId
    || text(approval.candidate_key) !== input.expected.candidateKey
  )) return false
  if (Object.keys(execution).length && (
    text(execution.listing_package_id) !== input.expected.listingPackageId
    || text(execution.opportunity_id) !== input.expected.opportunityId
    || (text(approval.id) && text(execution.approval_id) !== text(approval.id))
  )) return false
  if (Object.keys(publication).length && (
    text(publication.listing_package_id) !== input.expected.listingPackageId
    || text(publication.opportunity_id) !== input.expected.opportunityId
    || (text(execution.id)
      && text(publication.draft_execution_id) !== text(execution.id))
  )) return false
  return true
}

export function assertListingPackageContextV1(input: Parameters<
  typeof listingPackageMatchesContextV1
>[0]) {
  if (!listingPackageMatchesContextV1(input)) {
    throw new Error("EBAY_LISTING_PACKAGE_CONTEXT_IDENTITY_MISMATCH")
  }
}

export function assertTaxonomySnapshotContextV1(input: Parameters<
  typeof taxonomySnapshotMatchesContextV1
>[0]) {
  if (!taxonomySnapshotMatchesContextV1(input)) {
    throw new Error("EBAY_LISTING_TAXONOMY_CONTEXT_IDENTITY_MISMATCH")
  }
}

export function assertLifecycleStateContextV1(input: Parameters<
  typeof lifecycleStateMatchesContextV1
>[0]) {
  if (!lifecycleStateMatchesContextV1(input)) {
    throw new Error("EBAY_DRAFT_ONLY_CONTEXT_IDENTITY_MISMATCH")
  }
}
