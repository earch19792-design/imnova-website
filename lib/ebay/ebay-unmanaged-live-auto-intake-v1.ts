import type { SupabaseClient } from "@supabase/supabase-js"

import type { EbayLiveListing } from
  "@/lib/ebay/ebay-commercial-monitor-live-readonly-domain"
import { registerManualEbayListing } from
  "@/lib/ebay/ebay-manual-listing-service"
import { orderRelistHandoffCandidatesV1, reconcileRelistSupplierHandoffV1 } from "./ebay-relist-supplier-handoff-v1"
import { ensureStockguardAuthorityFromDecisionP0 } from
  "./stockguard-listing-link-authority-p0"

type JsonRecord = Record<string, unknown>

export const EBAY_UNMANAGED_LIVE_AUTO_INTAKE_CONTRACT_V1 =
  "SELLER_OS_AUTO_INGEST_UNMANAGED_LIVE_LISTINGS_V1" as const
export const EBAY_UNMANAGED_LIVE_AUTO_INTAKE_MAXIMUM_PER_CYCLE = 50

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

type ManualLinkRow = {
  ebay_item_id: string
  verification_status: string
  opportunity_id: string
  candidate_key: string
  supplier_sku: string | null
  supplier_variant_id: string | null
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
    manualRegistrationsRepaired: 0, existingDecisionAuthoritiesRepaired: 0,
    ambiguous: 0, conflicts: 0, deferred: 0,
    outcomes: Object.freeze([]),
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
  const [decisionRead, authorityRead, quarantineRead, manualRead, packageRead,
    skuOpportunityRead] =
    await Promise.all([
      supabase.from("seller_os_luna_linkage_decisions")
        .select("decision_id,ebay_item_id,ebay_sku,decision,luna_product_id,luna_variant_id,luna_sku")
        .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
        .in("ebay_item_id", itemIds).order("decision_version", { ascending: false })
        .limit(itemIds.length * 4),
      supabase.from("seller_os_listing_product_link_authorities_v1")
        .select("ebay_item_id,lifecycle_state,updated_at")
        .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
        .in("ebay_item_id", itemIds).order("updated_at", { ascending: false })
        .limit(itemIds.length * 4),
      supabase.from("seller_os_listing_identity_quarantines_v1")
        .select("ebay_item_id,quarantine_state,reason_code")
        .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
        .in("ebay_item_id", itemIds).limit(itemIds.length * 2),
      supabase.from("ebay_manual_listing_links")
        .select("ebay_item_id,verification_status,opportunity_id,candidate_key,supplier_sku,supplier_variant_id")
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
  if (decisionRead.error || authorityRead.error || quarantineRead.error ||
      manualRead.error || packageRead.error ||
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
  const latestAuthorityByItemId = new Map<string, JsonRecord>()
  for (const authority of (authorityRead.data ?? []) as Array<JsonRecord>) {
    const itemId = String(authority.ebay_item_id)
    if (!latestAuthorityByItemId.has(itemId)) {
      latestAuthorityByItemId.set(itemId, authority)
    }
  }
  const managedItemIds = new Set([...latestAuthorityByItemId.values()]
    .filter((authority) => authority.lifecycle_state === "ACTIVE")
    .map((authority) => String(authority.ebay_item_id)))
  const conflictingItemIds = new Set<string>()
  for (const authority of latestAuthorityByItemId.values()) {
    if (authority.lifecycle_state === "UNLINKED" ||
        authority.lifecycle_state === "INVALIDATED") {
      conflictingItemIds.add(String(authority.ebay_item_id))
    }
  }
  for (const quarantine of (quarantineRead.data ?? []) as Array<JsonRecord>) {
    if (quarantine.quarantine_state === "ACTIVE") {
      conflictingItemIds.add(String(quarantine.ebay_item_id))
    }
  }
  const manualLinks = (manualRead.data ?? []) as ManualLinkRow[]
  const preliminaryClassifications = listings.map((listing) =>
    classifyEbayUnmanagedLiveListingV1({
      listing, managedItemIds, conflictingItemIds, opportunities, packages,
      lunaVariants: (lunaRead.data ?? []) as LunaVariantRow[],
    }))
  const repairableDecisionByItemId = new Map<string, string>()
  for (const decision of latestDecisions) {
    const itemId = text(decision.ebay_item_id)
    if (!itemId || managedItemIds.has(itemId)) continue
    const classification = preliminaryClassifications.find((row) =>
      row.itemId === itemId)
    const candidate = classification?.classification ===
        "EXACT_DETERMINISTIC_MATCH"
      ? classification.candidate : null
    const decisionId = text(decision.decision_id)
    if (candidate && decisionId &&
        decision.decision === "APPROVE_EXACT_LINKAGE" &&
        text(decision.ebay_sku) === classification?.customLabel &&
        text(decision.luna_product_id) === candidate.supplierProductId &&
        text(decision.luna_variant_id) === candidate.supplierVariantId &&
        text(decision.luna_sku) === candidate.supplierSku) {
      repairableDecisionByItemId.set(itemId, decisionId)
    } else {
      conflictingItemIds.add(itemId)
    }
  }
  const repairableManualItemIds = new Set(manualLinks.flatMap((link) => {
    if (managedItemIds.has(link.ebay_item_id)) return []
    const classification = preliminaryClassifications.find((row) =>
      row.itemId === link.ebay_item_id)
    const candidate = classification?.classification ===
        "EXACT_DETERMINISTIC_MATCH"
      ? classification.candidate : null
    return candidate &&
      link.opportunity_id === candidate.opportunityId &&
      link.candidate_key === candidate.candidateKey &&
      link.supplier_sku === candidate.supplierSku &&
      link.supplier_variant_id === candidate.supplierVariantId
      ? [link.ebay_item_id] : []
  }))
  // A pending or legacy verified manual registration is repairable only when
  // the new official LIVE read independently proves the exact same canonical
  // opportunity and Luna tuple. Any mismatch remains a conflict; tombstones,
  // prior decisions and quarantines were already added above and stay closed.
  for (const link of manualLinks) {
    if (!managedItemIds.has(link.ebay_item_id) &&
        !repairableManualItemIds.has(link.ebay_item_id)) {
      conflictingItemIds.add(link.ebay_item_id)
    }
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
  // Exact deterministic identities always consume the bounded intake budget
  // before speculative relist recovery. Otherwise an unresolved listing can
  // repeatedly occupy the old two-item window and defer a proven exact match.
  const unresolved = orderRelistHandoffCandidatesV1(classifications.filter((row) =>
    row.classification !== "ALREADY_MANAGED" && !conflictingItemIds.has(row.itemId)), Date.now())
  const cycleOrder = [
    ...unresolved.filter((row) =>
      row.classification === "EXACT_DETERMINISTIC_MATCH"),
    ...unresolved.filter((row) =>
      row.classification !== "EXACT_DETERMINISTIC_MATCH"),
    ...classifications.filter((row) => row.classification === "ALREADY_MANAGED" ||
      conflictingItemIds.has(row.itemId)),
  ]
  for (const classification of cycleOrder) {
    if (classification.classification !== "ALREADY_MANAGED" &&
        !conflictingItemIds.has(classification.itemId) &&
        attempted >= maximumAutoLinks) {
      outcomes.push({ ...classification, status: "DEFERRED_TO_NEXT_CYCLE" })
      continue
    }
    if (classification.classification !== "ALREADY_MANAGED" &&
        !conflictingItemIds.has(classification.itemId)) {
      const repairDecisionId = repairableDecisionByItemId.get(
        classification.itemId)
      if (repairDecisionId) {
        attempted += 1
        try {
          const linkAuthority = await ensureStockguardAuthorityFromDecisionP0({
            supabase, accountKey: input.accountKey,
            ebayItemId: classification.itemId,
            sourceDecisionId: repairDecisionId,
            actorUserId: null,
            automatedDeterministic: true,
          })
          if (!linkAuthority.stockguardEligible || !linkAuthority.authority) {
            outcomes.push({ ...classification, status: "CONFLICT",
              reasonCode: "UNMANAGED_LIVE_EXISTING_DECISION_STOCKGUARD_AUTHORITY_REQUIRED" })
            continue
          }
          outcomes.push({ ...classification, status: "AUTO_LINKED",
            mode: "EXISTING_EXACT_DECISION", supplierLinkage: "CERTIFIED",
            stockGuard: "MONITORING_ENROLLED",
            stockguardAuthorityId: linkAuthority.authority.authority_id,
            existingDecisionAuthorityRepaired: true,
            durableReadbackMatch: true, ownerActionRequired: false,
            humanClicks: 0, marketplaceWrites: 0 })
        } catch {
          outcomes.push({ ...classification, status: "CONFLICT",
            reasonCode: "UNMANAGED_LIVE_EXISTING_DECISION_STOCKGUARD_AUTHORITY_REQUIRED" })
        }
        continue
      }
      // Reuse the same bounded intake slot. Relists inherit only database-
      // proven lineage; a legacy Product Truth projection cannot suppress it.
      const inherited = await reconcileRelistSupplierHandoffV1({
        supabase, accountKey: input.accountKey, itemId: classification.itemId,
      })
      if (inherited.status === "CERTIFIED") {
        attempted += 1
        const decisionId = typeof inherited.decisionId === "string"
          ? inherited.decisionId : null
        if (!decisionId) {
          outcomes.push({ ...classification, status: "CONFLICT",
            reasonCode: "UNMANAGED_LIVE_RELIST_DECISION_AUTHORITY_REQUIRED" })
          continue
        }
        try {
          const linkAuthority = await ensureStockguardAuthorityFromDecisionP0({
            supabase, accountKey: input.accountKey,
            ebayItemId: classification.itemId,
            sourceDecisionId: decisionId,
            actorUserId: null,
            automatedDeterministic: true,
          })
          if (!linkAuthority.stockguardEligible || !linkAuthority.authority) {
            outcomes.push({ ...classification, status: "CONFLICT",
              reasonCode: "UNMANAGED_LIVE_RELIST_STOCKGUARD_AUTHORITY_REQUIRED" })
            continue
          }
          outcomes.push({ ...classification, status: "AUTO_LINKED",
            mode: "DETERMINISTIC_RELIST", supplierLinkage: "CERTIFIED",
            stockGuard: "MONITORING_ENROLLED",
            stockguardAuthorityId: linkAuthority.authority.authority_id,
            durableReadbackMatch: true, ownerActionRequired: false,
            humanClicks: 0, marketplaceWrites: 0 })
        } catch {
          outcomes.push({ ...classification, status: "CONFLICT",
            reasonCode: "UNMANAGED_LIVE_RELIST_STOCKGUARD_AUTHORITY_REQUIRED" })
        }
        continue
      }
      if (classification.classification !== "EXACT_DETERMINISTIC_MATCH") {
        attempted += 1
        outcomes.push({ ...classification, handoff: inherited })
        continue
      }
    }
    if (classification.classification !== "EXACT_DETERMINISTIC_MATCH") {
      outcomes.push(classification)
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
          result.manualLiveLinkage?.status !== "CERTIFIED" ||
          result.linkAuthority?.stockguardEligible !== true) {
        outcomes.push({ ...classification, status: "CONFLICT",
          reasonCode: result.verification.status !== "verified"
            ? result.verification.reason
            : result.manualLiveLinkage?.status !== "CERTIFIED"
              ? "UNMANAGED_LIVE_CERTIFIED_LINKAGE_REQUIRED"
              : result.linkAuthority?.limitationCode ??
                "UNMANAGED_LIVE_STOCKGUARD_AUTHORITY_REQUIRED" })
        continue
      }
      outcomes.push({ ...classification, status: "AUTO_LINKED",
        mode: result.manualLiveLinkage.mode,
        supplierLinkage: "CERTIFIED",
        stockGuard: result.stockGuardRefresh?.status ?? null,
        manualRegistrationRepaired:
          repairableManualItemIds.has(classification.itemId),
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
    manualRegistrationsRepaired: outcomes.filter((row) =>
      row.status === "AUTO_LINKED" && row.manualRegistrationRepaired === true).length,
    existingDecisionAuthoritiesRepaired: outcomes.filter((row) =>
      row.status === "AUTO_LINKED" &&
      row.existingDecisionAuthorityRepaired === true).length,
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
