import type { SupabaseClient } from "@supabase/supabase-js"

import type { EbayLiveListing } from "./ebay-commercial-monitor-live-readonly-domain"
import type { ListingLinkAuthorityRowV1, ListingIdentityQuarantineRowV1 } from
  "./stockguard-listing-link-authority-p0"

export const SELLER_OS_LISTING_REGISTRY_V1 = "SELLER_OS_LISTING_REGISTRY_V1" as const

export type ListingReconciliationStatusV1 = "LINKED_EXACT" | "LINKABLE_EXACT" |
  "AMBIGUOUS" | "MISSING_LUNA_IDENTITY" | "DUPLICATE_IDENTITY" |
  "NEEDS_OWNER_REVIEW"
export type StockguardLinkStatusV1 = "LINKED_ACTIVE" | "LINKED_MONITOR_ONLY" |
  "BLOCKED_IDENTITY" | "BLOCKED_STOCK_SOURCE" | "NEEDS_OWNER_REVIEW"
export type ListingOriginV1 = "SELLER_OS" | "MANUAL_EBAY" | "IMPORTED_LEGACY"

export type ListingCaseProjectionV1 = Readonly<{
  account_key: string
  marketplace_id: "EBAY_US"
  ebay_item_id: string
  ebay_title: string | null
  ebay_custom_label: string | null
  supplier_sku: string | null
  luna_product_id: string | null
  luna_variant_id: string | null
  opportunity_id: string | null
  listing_package_id: string | null
  origin: ListingOriginV1
  listing_status: "ACTIVE" | "ENDED" | "UNKNOWN"
  identity_status: ListingReconciliationStatusV1
  stockguard_link_status: StockguardLinkStatusV1
  stockguard_authority_id: string | null
  next_blocker: string | null
  identity_source: string
  ebay_observed_at: string
}>

type ManualLink = Readonly<{
  ebay_item_id: string
  connector_ebay_sku: string | null
  supplier_sku: string | null
  supplier_variant_id: string | null
  candidate_key: string | null
  opportunity_id: string | null
  verification_status: string
}>
type Publication = Readonly<{
  listing_id: string | null
  opportunity_id: string | null
  listing_package_id: string | null
  manual_registration_id: string | null
  publish_attempt_count: number | null
  phase: string
}>
type StockState = Readonly<{ itemId: string; stockState: string; stockSourceCertified: boolean }>

function normalized(value: string | null | undefined) {
  return value?.trim().toUpperCase() || null
}

function candidateTuple(candidateKey: string | null) {
  const match = candidateKey?.match(/^luna-portex:(\d{1,30}):(\d{1,30})$/)
  return match ? { productId: match[1], variantId: match[2] } : null
}

export function projectSellerOsListingCasesV1(input: Readonly<{
  accountKey: string
  listings: readonly EbayLiveListing[]
  authorities: readonly ListingLinkAuthorityRowV1[]
  quarantines: readonly ListingIdentityQuarantineRowV1[]
  manualLinks: readonly ManualLink[]
  publications: readonly Publication[]
  stockStates?: readonly StockState[]
  manualImportItemIds?: readonly string[]
  existingOrigins?: Readonly<Record<string, ListingOriginV1>>
  existingOpportunities?: Readonly<Record<string, { opportunityId: string;
    productId: string; variantId: string; sku: string }>>
}>): readonly ListingCaseProjectionV1[] {
  const byItem = new Map<string, EbayLiveListing[]>()
  for (const listing of input.listings) {
    byItem.set(listing.itemId, [...(byItem.get(listing.itemId) ?? []), listing])
  }
  const listings = [...byItem.values()].map((group) => {
    const labels = [...new Set(group.map((row) =>
      normalized(row.customLabel ?? row.sku)).filter(Boolean))]
    const first = group[0]
    const labelled = group.find((row) => row.customLabel || row.sku)
    return { ...first,
      customLabel: labels.length === 1 ? labelled?.customLabel ?? labelled?.sku ?? null : null,
      sku: labels.length === 1 ? labelled?.sku ?? labelled?.customLabel ?? null : null,
      identityAmbiguous: group.some((row) => row.identityAmbiguous) ||
        labels.length > 1,
    }
  })
  const labelCount = new Map<string, number>()
  for (const listing of listings) {
    const label = normalized(listing.customLabel ?? listing.sku)
    if (label) labelCount.set(label, (labelCount.get(label) ?? 0) + 1)
  }
  const stockByItem = new Map(input.stockStates?.map((state) => [state.itemId, state]) ?? [])
  return listings.map((listing) => {
    const label = listing.customLabel ?? listing.sku
    const itemAuthorities = input.authorities.filter((row) =>
      row.account_key === input.accountKey && row.marketplace_id === "EBAY_US" &&
      row.ebay_item_id === listing.itemId && row.lifecycle_state === "ACTIVE")
    const authority = itemAuthorities.length === 1 ? itemAuthorities[0] : null
    const itemManual = input.manualLinks.filter((row) => row.ebay_item_id === listing.itemId)
    const verifiedManual = itemManual.filter((row) => row.verification_status === "verified" &&
      normalized(row.connector_ebay_sku) === normalized(label))
    const itemPublications = input.publications.filter((row) =>
      row.listing_id === listing.itemId && row.phase === "monitor_registered")
    const publication = itemPublications.length === 1 ? itemPublications[0] : null
    const nativePublication = itemPublications.some((row) =>
      !row.manual_registration_id && (row.publish_attempt_count ?? 0) > 0)
    const manualPublication = itemPublications.some((row) =>
      Boolean(row.manual_registration_id))
    const origin: ListingOriginV1 = nativePublication && !manualPublication
      ? "SELLER_OS" : itemManual.length || manualPublication ||
        input.manualImportItemIds?.includes(listing.itemId)
        ? "MANUAL_EBAY" : input.existingOrigins?.[listing.itemId] ??
          "IMPORTED_LEGACY"
    const manual = verifiedManual.length === 1 ? verifiedManual[0] : null
    const manualTuple = manual ? candidateTuple(manual.candidate_key) : null
    const tuple = authority ? {
      productId: authority.luna_product_id,
      variantId: authority.luna_variant_id,
      sku: authority.luna_sku,
    } : manualTuple && manual?.supplier_sku &&
        manual.supplier_variant_id === manualTuple.variantId
      ? { ...manualTuple, sku: manual.supplier_sku } : null
    const previousOpportunity = input.existingOpportunities?.[listing.itemId]
    const inheritedOpportunityId = previousOpportunity && tuple &&
      previousOpportunity.productId === tuple.productId &&
      previousOpportunity.variantId === tuple.variantId &&
      previousOpportunity.sku === tuple.sku
      ? previousOpportunity.opportunityId : null
    const quarantine = input.quarantines.some((row) =>
      row.account_key === input.accountKey && row.marketplace_id === "EBAY_US" &&
      row.ebay_item_id === listing.itemId && row.quarantine_state === "ACTIVE")
    const duplicateLabel = Boolean(label && (labelCount.get(normalized(label) ?? "") ?? 0) > 1)
    const authorityMatches = Boolean(authority && label &&
      normalized(authority.ebay_sku) === normalized(label) &&
      normalized(authority.luna_sku) === normalized(tuple?.sku))
    const authorityCollision = authority && input.authorities.some((row) =>
      row !== authority && row.account_key === input.accountKey &&
      row.marketplace_id === "EBAY_US" && row.lifecycle_state === "ACTIVE" &&
      row.identity_key === authority.identity_key)
    const manualConflict = verifiedManual.length > 1 ||
      new Set(itemManual.filter((row) => row.verification_status === "verified")
        .map((row) => row.candidate_key)).size > 1
    let identityStatus: ListingReconciliationStatusV1
    if (duplicateLabel || authorityCollision) identityStatus = "DUPLICATE_IDENTITY"
    else if (quarantine || manualConflict || itemAuthorities.length > 1 ||
      itemPublications.length > 1 || listing.identityAmbiguous) identityStatus = "AMBIGUOUS"
    else if (authority && authorityMatches && tuple) identityStatus = "LINKED_EXACT"
    else if (tuple && label && manual && normalized(manual.supplier_sku) === normalized(label)) {
      identityStatus = "LINKABLE_EXACT"
    } else if (!tuple) identityStatus = "MISSING_LUNA_IDENTITY"
    else identityStatus = "NEEDS_OWNER_REVIEW"
    const stock = stockByItem.get(listing.itemId)
    const stockguardStatus: StockguardLinkStatusV1 =
      identityStatus === "AMBIGUOUS" || identityStatus === "DUPLICATE_IDENTITY" ||
      identityStatus === "NEEDS_OWNER_REVIEW" ? "NEEDS_OWNER_REVIEW"
      : identityStatus === "MISSING_LUNA_IDENTITY" ? "BLOCKED_IDENTITY"
      : identityStatus === "LINKABLE_EXACT" ? "BLOCKED_STOCK_SOURCE"
      : stock?.stockSourceCertified && stock.stockState === "IN_STOCK_SIGNAL"
        ? "LINKED_ACTIVE" : "LINKED_MONITOR_ONLY"
    const nextBlocker = identityStatus === "LINKED_EXACT"
      ? stockguardStatus === "LINKED_MONITOR_ONLY" ? "FRESH_SUPPLIER_STOCK_EVIDENCE_REQUIRED" : null
      : identityStatus === "LINKABLE_EXACT" ? "STOCKGUARD_AUTHORITY_REVIEW_REQUIRED"
      : identityStatus === "MISSING_LUNA_IDENTITY" ? "EXACT_LUNA_IDENTITY_REQUIRED"
      : "OWNER_IDENTITY_REVIEW_REQUIRED"
    return Object.freeze({
      account_key: input.accountKey,
      marketplace_id: "EBAY_US" as const,
      ebay_item_id: listing.itemId,
      ebay_title: listing.title ?? null,
      ebay_custom_label: label,
      supplier_sku: tuple?.sku ?? null,
      luna_product_id: tuple?.productId ?? null,
      luna_variant_id: tuple?.variantId ?? null,
      opportunity_id: publication?.opportunity_id ?? manual?.opportunity_id ??
        inheritedOpportunityId,
      listing_package_id: publication?.listing_package_id ?? null,
      origin,
      listing_status: "ACTIVE" as const,
      identity_status: identityStatus,
      stockguard_link_status: stockguardStatus,
      stockguard_authority_id: identityStatus === "LINKED_EXACT" ? authority?.authority_id ?? null : null,
      next_blocker: nextBlocker,
      identity_source: authorityMatches ? "STOCKGUARD_LINK_AUTHORITY_AND_OFFICIAL_EBAY" :
        manual ? "VERIFIED_MANUAL_LINK_AND_OFFICIAL_EBAY" : "OFFICIAL_EBAY_ONLY",
      ebay_observed_at: listing.observedAt,
    })
  })
}

export async function readListingRegistryEvidenceV1(
  supabase: SupabaseClient, accountKey: string,
) {
  const [authorities, quarantines, manualLinks, publications] = await Promise.all([
    supabase.from("seller_os_listing_product_link_authorities_v1").select("*")
      .eq("account_key", accountKey).eq("marketplace_id", "EBAY_US").limit(1000),
    supabase.from("seller_os_listing_identity_quarantines_v1").select("*")
      .eq("account_key", accountKey).eq("marketplace_id", "EBAY_US").limit(1000),
    supabase.from("ebay_manual_listing_links")
      .select("ebay_item_id,connector_ebay_sku,supplier_sku,supplier_variant_id,candidate_key,opportunity_id,verification_status")
      .eq("account_key", accountKey).eq("marketplace_id", "EBAY_US").limit(1000),
    supabase.from("ebay_authorized_listing_publications")
      .select("listing_id,opportunity_id,listing_package_id,manual_registration_id,publish_attempt_count,phase")
      .eq("marketplace_account_key", accountKey).eq("target", "PRODUCTION").limit(1000),
  ])
  if (authorities.error || quarantines.error || manualLinks.error || publications.error) {
    throw new Error("LISTING_REGISTRY_EVIDENCE_READ_FAILED")
  }
  if ([authorities.data, quarantines.data, manualLinks.data, publications.data]
    .some((rows) => (rows?.length ?? 0) >= 1000)) {
    throw new Error("LISTING_REGISTRY_EVIDENCE_PAGINATION_REQUIRED")
  }
  return {
    authorities: (authorities.data ?? []) as ListingLinkAuthorityRowV1[],
    quarantines: (quarantines.data ?? []) as ListingIdentityQuarantineRowV1[],
    manualLinks: (manualLinks.data ?? []) as ManualLink[],
    publications: (publications.data ?? []) as Publication[],
  }
}

export async function persistListingCasesV1(supabase: SupabaseClient,
  projections: readonly ListingCaseProjectionV1[], sweepId?: string) {
  if (!projections.length) return []
  if (projections.length > 1000) {
    throw new Error("LISTING_REGISTRY_CASE_PAGINATION_REQUIRED")
  }
  const { data, error } = await supabase.from("seller_os_listing_cases_v1")
    .upsert(projections.map((projection) => sweepId
      ? { ...projection, last_reconciled_sweep_id: sweepId }
      : projection), { onConflict: "account_key,marketplace_id,ebay_item_id" })
    .select("*")
  if (error || !data || data.length !== projections.length) {
    throw new Error("LISTING_REGISTRY_DURABLE_WRITE_FAILED")
  }
  return data
}
