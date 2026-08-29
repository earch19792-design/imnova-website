import type { SupabaseClient } from "@supabase/supabase-js"

import type { EbayLiveListing } from
  "@/lib/ebay/ebay-commercial-monitor-live-readonly-domain"
import { registerManualEbayListing } from
  "@/lib/ebay/ebay-manual-listing-service"

type JsonRecord = Record<string, unknown>

export const EBAY_UNMANAGED_LIVE_AUTO_INTAKE_CONTRACT_V1 =
  "SELLER_OS_AUTO_INGEST_UNMANAGED_LIVE_LISTINGS_V1" as const
export const EBAY_UNMANAGED_LIVE_AUTO_INTAKE_MAXIMUM_PER_CYCLE = 2

type OpportunityRow = {
  id: string
  candidate_key: string
  supplier_product_id: string | null
  supplier_variant_id: string | null
  supplier_sku: string | null
  gtin: string | null
  assessment: unknown
}

type PackageRow = {
  id: string
  opportunity_id: string
  candidate_key: string
  account_key: string
}

type LunaVariantRow = {
  supplier_product_id: string | null
  supplier_variant_id: string | null
  sku: string | null
}

export type EbayUnmanagedLiveIdentityCandidateV1 = Readonly<{
  opportunityId: string
  candidateKey: string
  supplierProductId: string
  supplierVariantId: string
  supplierSku: string
  gtin: string | null
  packageId: string
}>

export type EbayUnmanagedLiveIntakeClassificationV1 = Readonly<{
  itemId: string
  customLabel: string | null
  classification:
    | "ALREADY_MANAGED"
    | "EXACT_DETERMINISTIC_MATCH"
    | "AMBIGUOUS_MATCH"
    | "CONFLICT"
  matchAuthority:
    | "EXACT_KNOWN_LINEAGE"
    | "EXACT_LUNA_IDENTITY"
    | null
  candidate: EbayUnmanagedLiveIdentityCandidateV1 | null
  reasonCode: string
  titleInferenceUsed: false
  marketplaceWrites: 0
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function canonicalPackageId(customLabel: string | null) {
  const match = customLabel?.match(
    /^IMNOVA([0-9A-F]{8})([0-9A-F]{4})([0-9A-F]{4})([0-9A-F]{4})([0-9A-F]{12})$/,
  )
  return match
    ? `${match[1]}-${match[2]}-${match[3]}-${match[4]}-${match[5]}`
      .toLowerCase()
    : null
}

function productTruthExact(opportunity: OpportunityRow) {
  const truth = record(record(opportunity.assessment).productTruth)
  return text(truth.evidenceDigest)?.match(/^sha256:[0-9a-f]{64}$/) &&
    text(truth.candidateKey) === opportunity.candidate_key &&
    text(truth.lunaProductId) === opportunity.supplier_product_id &&
    text(truth.lunaVariantId) === opportunity.supplier_variant_id &&
    text(truth.supplierSku) === opportunity.supplier_sku &&
    text(truth.gtin) === opportunity.gtin
}

function currentLunaIdentityExact(
  opportunity: OpportunityRow,
  variants: readonly LunaVariantRow[],
) {
  return variants.some((variant) =>
    text(variant.supplier_product_id) === opportunity.supplier_product_id &&
    text(variant.supplier_variant_id) === opportunity.supplier_variant_id &&
    text(variant.sku) === opportunity.supplier_sku)
}

function candidateFor(
  opportunity: OpportunityRow,
  packages: readonly PackageRow[],
): EbayUnmanagedLiveIdentityCandidateV1 | null {
  const matchingPackages = packages.filter((listingPackage) =>
    listingPackage.opportunity_id === opportunity.id &&
    listingPackage.candidate_key === opportunity.candidate_key)
  if (matchingPackages.length !== 1 ||
      !opportunity.supplier_product_id ||
      !opportunity.supplier_variant_id ||
      !opportunity.supplier_sku) return null
  return Object.freeze({
    opportunityId: opportunity.id,
    candidateKey: opportunity.candidate_key,
    supplierProductId: opportunity.supplier_product_id,
    supplierVariantId: opportunity.supplier_variant_id,
    supplierSku: opportunity.supplier_sku,
    gtin: opportunity.gtin,
    packageId: matchingPackages[0].id,
  })
}

export function classifyEbayUnmanagedLiveListingV1(input: Readonly<{
  listing: Pick<EbayLiveListing, "itemId" | "sku" | "customLabel" |
    "identityAmbiguous" | "marketplaceCertification">
  managedItemIds: ReadonlySet<string>
  conflictingItemIds: ReadonlySet<string>
  opportunities: readonly OpportunityRow[]
  packages: readonly PackageRow[]
  lunaVariants: readonly LunaVariantRow[]
}>): EbayUnmanagedLiveIntakeClassificationV1 {
  const customLabel = text(input.listing.customLabel) ?? text(input.listing.sku)
  const base = {
    itemId: input.listing.itemId,
    customLabel,
    titleInferenceUsed: false as const,
    marketplaceWrites: 0 as const,
  }
  if (input.managedItemIds.has(input.listing.itemId)) {
    return Object.freeze({ ...base, classification: "ALREADY_MANAGED",
      matchAuthority: null, candidate: null,
      reasonCode: "CURRENT_LIVE_ALREADY_MANAGED" })
  }
  if (input.conflictingItemIds.has(input.listing.itemId)) {
    return Object.freeze({ ...base, classification: "CONFLICT",
      matchAuthority: null, candidate: null,
      reasonCode: "UNMANAGED_LIVE_EXISTING_LINEAGE_CONFLICT" })
  }
  if (input.listing.marketplaceCertification.status !== "US_CERTIFIED" ||
      input.listing.identityAmbiguous) {
    return Object.freeze({ ...base, classification: "CONFLICT",
      matchAuthority: null, candidate: null,
      reasonCode: "UNMANAGED_LIVE_OFFICIAL_IDENTITY_UNPROVEN" })
  }
  if (!customLabel) {
    return Object.freeze({ ...base, classification: "AMBIGUOUS_MATCH",
      matchAuthority: null, candidate: null,
      reasonCode: "UNMANAGED_LIVE_CUSTOM_LABEL_REQUIRED" })
  }

  const packageId = canonicalPackageId(customLabel)
  if (customLabel.startsWith("IMNOVA") && !packageId) {
    return Object.freeze({ ...base, classification: "CONFLICT",
      matchAuthority: null, candidate: null,
      reasonCode: "UNMANAGED_LIVE_RESERVED_LABEL_INVALID" })
  }
  const possibleOpportunities = packageId
    ? input.packages.filter((listingPackage) => listingPackage.id === packageId)
      .flatMap((listingPackage) => input.opportunities.filter((opportunity) =>
        opportunity.id === listingPackage.opportunity_id &&
        opportunity.candidate_key === listingPackage.candidate_key))
    : input.opportunities.filter((opportunity) =>
        opportunity.supplier_sku === customLabel)
  const exactOpportunities = possibleOpportunities.filter((opportunity) =>
    Boolean(productTruthExact(opportunity)) &&
    currentLunaIdentityExact(opportunity, input.lunaVariants) &&
    candidateFor(opportunity, input.packages) !== null)
  if (possibleOpportunities.length === 1 && exactOpportunities.length === 1) {
    return Object.freeze({ ...base,
      classification: "EXACT_DETERMINISTIC_MATCH",
      matchAuthority: packageId
        ? "EXACT_KNOWN_LINEAGE" as const
        : "EXACT_LUNA_IDENTITY" as const,
      candidate: candidateFor(exactOpportunities[0], input.packages),
      reasonCode: packageId
        ? "UNMANAGED_LIVE_EXACT_KNOWN_LINEAGE"
        : "UNMANAGED_LIVE_EXACT_LUNA_IDENTITY",
    })
  }
  if (possibleOpportunities.length > 1) {
    return Object.freeze({ ...base, classification: "AMBIGUOUS_MATCH",
      matchAuthority: null, candidate: null,
      reasonCode: "UNMANAGED_LIVE_MULTIPLE_EXACT_IDENTITY_CANDIDATES" })
  }
  if (possibleOpportunities.length === 1) {
    return Object.freeze({ ...base, classification: "CONFLICT",
      matchAuthority: null, candidate: null,
      reasonCode: "UNMANAGED_LIVE_PRODUCT_TRUTH_OR_LUNA_IDENTITY_CONFLICT" })
  }
  return Object.freeze({ ...base, classification: "AMBIGUOUS_MATCH",
    matchAuthority: null, candidate: null,
    reasonCode: "UNMANAGED_LIVE_EXACT_IDENTITY_NOT_FOUND" })
}

export async function autoIngestUnmanagedEbayLiveListingsV1(
  supabase: SupabaseClient,
  input: Readonly<{
    accountKey: string
    listings: readonly EbayLiveListing[]
    maximumAutoLinks?: number
  }>,
) {
  const listings = [...new Map(input.listings
    .filter((listing) => listing.listingState === "ACTIVE")
    .map((listing) => [listing.itemId, listing])).values()]
  if (!listings.length) return Object.freeze({
    contractVersion: EBAY_UNMANAGED_LIVE_AUTO_INTAKE_CONTRACT_V1,
    currentLiveInspected: 0, unmanagedDetected: 0, autoLinked: 0,
    ambiguous: 0, conflicts: 0, deferred: 0, outcomes: Object.freeze([]),
    humanClicks: 0, titleInferenceUsed: false, marketplaceWrites: 0,
  })
  const itemIds = listings.map((listing) => listing.itemId)
  const labels = [...new Set(listings.flatMap((listing) => {
    const label = text(listing.customLabel) ?? text(listing.sku)
    return label ? [label] : []
  }))]
  const packageIds = [...new Set(labels.flatMap((label) => {
    const id = canonicalPackageId(label)
    return id ? [id] : []
  }))]
  const [decisionRead, manualRead, packageRead, skuOpportunityRead] =
    await Promise.all([
      supabase.from("seller_os_luna_linkage_decisions")
        .select("ebay_item_id,decision,luna_product_id,luna_variant_id,luna_sku")
        .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
        .in("ebay_item_id", itemIds).order("decision_version", { ascending: false })
        .limit(itemIds.length * 4),
      supabase.from("ebay_manual_listing_links")
        .select("ebay_item_id,verification_status,candidate_key")
        .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
        .in("ebay_item_id", itemIds).limit(itemIds.length * 2),
      packageIds.length
        ? supabase.from("ebay_listing_packages")
          .select("id,opportunity_id,candidate_key,account_key")
          .eq("account_key", input.accountKey).in("id", packageIds)
          .limit(packageIds.length + 1)
        : Promise.resolve({ data: [], error: null }),
      labels.length
        ? supabase.from("ebay_luna_opportunity_queue")
          .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,gtin,assessment")
          .in("supplier_sku", labels).limit(201)
        : Promise.resolve({ data: [], error: null }),
    ])
  if (decisionRead.error || manualRead.error || packageRead.error ||
      skuOpportunityRead.error) {
    throw new Error("UNMANAGED_LIVE_AUTO_INTAKE_AUTHORITY_READ_FAILED")
  }
  const canonicalPackages = (packageRead.data ?? []) as PackageRow[]
  const packageOpportunityIds = [...new Set(canonicalPackages.map((row) =>
    row.opportunity_id))]
  const packageOpportunityRead = packageOpportunityIds.length
    ? await supabase.from("ebay_luna_opportunity_queue")
      .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,gtin,assessment")
      .in("id", packageOpportunityIds).limit(packageOpportunityIds.length + 1)
    : { data: [], error: null }
  if (packageOpportunityRead.error) {
    throw new Error("UNMANAGED_LIVE_AUTO_INTAKE_AUTHORITY_READ_FAILED")
  }
  const opportunities = [...new Map([
    ...((skuOpportunityRead.data ?? []) as OpportunityRow[]),
    ...((packageOpportunityRead.data ?? []) as OpportunityRow[]),
  ].map((row) => [row.id, row])).values()]
  const opportunityIds = opportunities.map((opportunity) => opportunity.id)
  const opportunityPackageRead = opportunityIds.length
    ? await supabase.from("ebay_listing_packages")
      .select("id,opportunity_id,candidate_key,account_key")
      .eq("account_key", input.accountKey).in("opportunity_id", opportunityIds)
      .limit(opportunityIds.length * 2 + 1)
    : { data: [], error: null }
  if (opportunityPackageRead.error) {
    throw new Error("UNMANAGED_LIVE_AUTO_INTAKE_AUTHORITY_READ_FAILED")
  }
  const packages = [...new Map([
    ...canonicalPackages,
    ...((opportunityPackageRead.data ?? []) as PackageRow[]),
  ].map((row) => [row.id, row])).values()]
  const productIds = [...new Set(opportunities.flatMap((opportunity) =>
    opportunity.supplier_product_id ? [opportunity.supplier_product_id] : []))]
  const lunaRead = productIds.length
    ? await supabase.from("market_radar_latest_variants")
      .select("supplier_product_id,supplier_variant_id,sku")
      .eq("source_key", "lunaportex").in("supplier_product_id", productIds)
      .limit(501)
    : { data: [], error: null }
  if (lunaRead.error) {
    throw new Error("UNMANAGED_LIVE_AUTO_INTAKE_LUNA_IDENTITY_READ_FAILED")
  }
  const decisions = (decisionRead.data ?? []) as Array<JsonRecord>
  const latestDecisionByItemId = new Map<string, JsonRecord>()
  for (const decision of decisions) {
    const itemId = String(decision.ebay_item_id)
    if (!latestDecisionByItemId.has(itemId)) {
      latestDecisionByItemId.set(itemId, decision)
    }
  }
  const latestDecisions = [...latestDecisionByItemId.values()]
  const managedItemIds = new Set(latestDecisions.filter((decision) =>
    decision.decision === "APPROVE_EXACT_LINKAGE")
    .map((decision) => String(decision.ebay_item_id)))
  const decidedItemIds = new Set(latestDecisions.map((decision) =>
    String(decision.ebay_item_id)))
  const conflictingItemIds = new Set(
    ((manualRead.data ?? []) as Array<JsonRecord>)
      .map((link) => String(link.ebay_item_id))
      .filter((itemId) => !managedItemIds.has(itemId)),
  )
  for (const itemId of decidedItemIds) {
    if (!managedItemIds.has(itemId)) conflictingItemIds.add(itemId)
  }
  const classifications = listings.map((listing) =>
    classifyEbayUnmanagedLiveListingV1({
      listing, managedItemIds, conflictingItemIds, opportunities, packages,
      lunaVariants: (lunaRead.data ?? []) as LunaVariantRow[],
    }))
  const maximumAutoLinks = Math.max(0, Math.min(
    input.maximumAutoLinks ?? EBAY_UNMANAGED_LIVE_AUTO_INTAKE_MAXIMUM_PER_CYCLE,
    EBAY_UNMANAGED_LIVE_AUTO_INTAKE_MAXIMUM_PER_CYCLE,
  ))
  let attempted = 0
  const outcomes: Array<JsonRecord> = []
  for (const classification of classifications) {
    if (classification.classification !== "EXACT_DETERMINISTIC_MATCH") {
      outcomes.push(classification)
      continue
    }
    if (attempted >= maximumAutoLinks) {
      outcomes.push({ ...classification, status: "DEFERRED_TO_NEXT_CYCLE" })
      continue
    }
    attempted += 1
    try {
      const candidate = classification.candidate as
        EbayUnmanagedLiveIdentityCandidateV1
      const result = await registerManualEbayListing(supabase, {
        ebayItemId: classification.itemId,
        ebayUrl: `https://www.ebay.com/itm/${classification.itemId}`,
        opportunityId: candidate.opportunityId,
        candidateKey: candidate.candidateKey,
        supplierSku: candidate.supplierSku,
        supplierVariantId: candidate.supplierVariantId,
        safeDefaults: {},
      }, null, { automatedDeterministic: true })
      if (result.verification.status !== "verified" ||
          result.manualLiveLinkage?.status !== "CERTIFIED") {
        outcomes.push({ ...classification, status: "CONFLICT",
          reasonCode: result.verification.reason })
        continue
      }
      outcomes.push({ ...classification, status: "AUTO_LINKED",
        mode: result.manualLiveLinkage.mode,
        supplierLinkage: "CERTIFIED",
        stockGuard: result.stockGuardRefresh?.status ?? null,
        humanClicks: 0, marketplaceWrites: 0 })
    } catch (error) {
      outcomes.push({ ...classification, status: "CONFLICT",
        reasonCode: error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
          ? error.message : "UNMANAGED_LIVE_AUTO_LINK_FAILED" })
    }
  }
  const unmanaged = classifications.filter((row) =>
    row.classification !== "ALREADY_MANAGED")
  return Object.freeze({
    contractVersion: EBAY_UNMANAGED_LIVE_AUTO_INTAKE_CONTRACT_V1,
    currentLiveInspected: listings.length,
    unmanagedDetected: unmanaged.length,
    autoLinked: outcomes.filter((row) => row.status === "AUTO_LINKED").length,
    ambiguous: classifications.filter((row) =>
      row.classification === "AMBIGUOUS_MATCH").length,
    conflicts: outcomes.filter((row) =>
      row.classification === "CONFLICT" || row.status === "CONFLICT").length,
    deferred: outcomes.filter((row) =>
      row.status === "DEFERRED_TO_NEXT_CYCLE").length,
    outcomes: Object.freeze(outcomes),
    humanClicks: 0 as const,
    titleInferenceUsed: false as const,
    marketplaceWrites: 0 as const,
  })
}
