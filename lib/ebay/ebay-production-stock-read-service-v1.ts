import type { SupabaseClient } from "@supabase/supabase-js"
import { readRegistry, readCanonicalLunaLinkageDecisions,
  readCanonicalLunaStockJobs,
  readCanonicalLunaStockObservations } from
  "./commercial-monitor-readonly-repository"
import { readCurrentLiveAuthorityV1 } from "./ebay-current-live-authority-v1"
import type { EbayCommercialMonitorLiveReadonlyResult } from
  "./ebay-commercial-monitor-live-readonly"
import { projectSellerOsCanonicalLunaStockReadModelV1 } from
  "./ebay-luna-canonical-stock-read-model-adapter-v1"
import type { ReadonlyLunaLinkageDecisionRowV1 } from
  "./ebay-luna-canonical-stock-read-model-adapter-v1"
import { projectStockguardListingAuthorityP0,
  type ListingIdentityQuarantineRowV1,
  type ListingLinkAuthorityRowV1 } from
  "./stockguard-listing-link-authority-p0"

type LiveRow = Readonly<{
  ebay_item_id: string
  ebay_sku: string | null
  title: string | null
  listing_status: string
}>

function exactDecisionIdentity(row: ReadonlyLunaLinkageDecisionRowV1) {
  if (row.decision !== "APPROVE_EXACT_LINKAGE" ||
      !/^luna-linkage-v1:sha256:[0-9a-f]{64}$/.test(row.linkage_id) ||
      !Array.isArray(row.components) || row.components.length !== 1) return null
  const component = row.components[0] as Record<string, unknown>
  const productId = component.lunaProductId
  const variantId = component.lunaVariantId
  const sku = component.lunaSku
  return typeof productId === "string" && /^\d{1,30}$/.test(productId) &&
    typeof variantId === "string" && /^\d{1,30}$/.test(variantId) &&
    typeof sku === "string" && sku.length > 0 &&
    row.luna_product_id === productId &&
    row.luna_variant_id === variantId && row.luna_sku === sku &&
    component.exactProductIdentity === true &&
    component.exactVariantIdentity === true &&
    component.exactSupplierSku === true &&
    component.structuredVariantAttributesComplete === true &&
    component.identityConflict === false
    ? { productId, variantId, sku } : null
}

export async function readProductionStockGuardV1(input: {
  supabase: SupabaseClient; accountKey: string; accountAlias: string;
  itemId: string | null; now?: Date;
  includeKnownListingStockEvidence?: boolean
  officialLive?: EbayCommercialMonitorLiveReadonlyResult | null
}) {
  const now = input.now ?? new Date()
  const scope = input.itemId ? { itemIds: [input.itemId], stockCheckJobIds: [] } : undefined
  const [registry, jobs, observations, decisionsRead, live, authorityRead, quarantineRead,
    caseRead, sweepRead, ownerStockRead, ownerQuantityCorrectionRead] =
    await Promise.all([
      readRegistry(input.supabase, input.accountKey),
      readCanonicalLunaStockJobs(input.supabase, input.accountKey, scope),
      readCanonicalLunaStockObservations(input.supabase, input.accountKey, scope),
      readCanonicalLunaLinkageDecisions(input.supabase, input.accountKey),
      readCurrentLiveAuthorityV1({ supabase: input.supabase,
        accountKey: input.accountKey, now, live: input.officialLive }),
      input.supabase.from("seller_os_listing_product_link_authorities_v1")
        .select("*").eq("account_key", input.accountKey)
        .order("updated_at", { ascending: false }),
      input.supabase.from("seller_os_listing_identity_quarantines_v1")
        .select("*").eq("account_key", input.accountKey)
        .order("observed_at", { ascending: false }),
      input.supabase.from("seller_os_listing_cases_v1").select("*")
        .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
        .limit(1000),
      input.supabase.from("seller_os_listing_registry_sweeps_v1")
        .select("sweep_id,official_observed_at,official_live_item_count,reconciled_item_count")
        .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
        .eq("status", "COMPLETE").order("completed_at", { ascending: false })
        .limit(1).maybeSingle(),
      input.supabase.from("seller_os_owner_luna_stock_observations_v1")
        .select("observation_id,account_key,marketplace_id,ebay_item_id,linkage_id,luna_sku,luna_product_id,luna_variant_id,observed_stock_state,observed_supplier_quantity,observed_at,maximum_age_seconds")
        .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
        .order("observed_at", { ascending: false }).limit(1000),
      input.supabase.from("seller_os_owner_luna_stock_quantity_corrections_v1")
        .select("observation_id").limit(1000),
    ])
  // Registry is enrichment, not the authority for the official LIVE scope.
  if (registry.status === "ERROR" && live.currentState !== "CURRENT_FRESH" &&
      !input.officialLive) throw Error("PRODUCTION_STOCK_REGISTRY_UNAVAILABLE")
  if (authorityRead.error || quarantineRead.error || ownerStockRead.error ||
      ownerQuantityCorrectionRead.error ||
      (ownerStockRead.data?.length ?? 0) >= 1000 ||
      (ownerQuantityCorrectionRead.data?.length ?? 0) >= 1000 ||
      decisionsRead.status === "ERROR" ||
      decisionsRead.truncated) {
    throw Error("PRODUCTION_STOCK_LINK_AUTHORITY_UNAVAILABLE")
  }
  const ids = new Set(live.currentItemIds)
  const liveListings = registry.rows.filter((row): row is typeof row &
    { ebay_item_id: string } => row.account_key === input.accountKey &&
      Boolean(row.ebay_item_id)).map((row) => ({ ebay_item_id: row.ebay_item_id,
        ebay_sku: row.ebay_sku, title: row.title ?? null,
        listing_status: row.listing_status })) as LiveRow[]
  const authorities = (authorityRead.data ?? []) as ListingLinkAuthorityRowV1[]
  const quarantines = (quarantineRead.data ?? []) as ListingIdentityQuarantineRowV1[]
  const decisionHistory = decisionsRead.rows
  const ownerStockRows = ownerStockRead.data ?? []
  const correctedOwnerQuantityIds = new Set(
    (ownerQuantityCorrectionRead.data ?? []).map((row) => row.observation_id))
  const sweep = sweepRead.error ? null : sweepRead.data as {
    sweep_id: string; official_observed_at: string;
    official_live_item_count: number; reconciled_item_count: number
  } | null
  const sweepCases = (caseRead.error ? [] : caseRead.data ?? []) as {
    case_id: string; ebay_item_id: string; ebay_custom_label: string | null;
    ebay_title: string | null;
    listing_status: string;
    identity_status: string; stockguard_link_status: string;
    stockguard_authority_id: string | null; origin: string;
    last_reconciled_sweep_id: string | null
  }[]
  const currentCases = sweepCases.filter((row) =>
    row.last_reconciled_sweep_id === sweep?.sweep_id)
  const canonicalFresh = Boolean(sweep && !caseRead.error &&
    sweepCases.length < 1000 &&
    now.getTime() - Date.parse(sweep.official_observed_at) <= 20 * 60_000 &&
    Date.parse(sweep.official_observed_at) - now.getTime() <= 60_000 &&
    currentCases.length === sweep.official_live_item_count &&
    currentCases.length === sweep.reconciled_item_count)
  // The complete official registry sweep is the current LIVE cohort. The
  // older independent sync marker may expire without invalidating this sweep
  // or any durable supplier link. Never use case identity_status as a link
  // authority: it is only a presentation projection.
  const officialFresh = Boolean(input.officialLive &&
    live.currentState === "CURRENT_FRESH")
  const currentIds = officialFresh ? ids : canonicalFresh
    ? new Set(currentCases.map((row) => row.ebay_item_id)) : ids
  const officialByItem = new Map((input.officialLive?.discovery.currentLiveListings ?? [])
    .filter((row) => row.marketplaceCertification.status === "US_CERTIFIED")
    .map((row) => [row.itemId, row]))
  const caseByItem = new Map(currentCases
    .map((row) => [row.ebay_item_id, row]))
  const gateLiveListings: LiveRow[] = officialFresh
    ? [...officialByItem.values()].map((row) => ({
      ebay_item_id: row.itemId, ebay_sku: row.customLabel ?? row.sku,
      title: row.title, listing_status: "active",
    })) : canonicalFresh ? currentCases.map((row) => ({
    ebay_item_id: row.ebay_item_id, ebay_sku: row.ebay_custom_label,
    title: row.ebay_title, listing_status: row.listing_status?.toLowerCase() ?? "unknown",
  })) : officialByItem.size ? [...officialByItem.values()].map((row) => ({
    ebay_item_id: row.itemId, ebay_sku: row.customLabel ?? row.sku,
    title: row.title, listing_status: "active",
  })) : liveListings
  const registryByItem = new Map<string, typeof registry.rows[number]>()
  for (const row of registry.rows) {
    if (row.account_key !== input.accountKey || !row.ebay_item_id) continue
    const previous = registryByItem.get(row.ebay_item_id)
    const expectedLabel = caseByItem.get(row.ebay_item_id)?.ebay_custom_label
    const rowMatches = expectedLabel && row.ebay_sku === expectedLabel
    const previousMatches = expectedLabel && previous?.ebay_sku === expectedLabel
    if (!previous || rowMatches && !previousMatches ||
        rowMatches === previousMatches &&
        Date.parse(row.updated_at ?? "") > Date.parse(previous.updated_at ?? "")) {
      registryByItem.set(row.ebay_item_id, row)
    }
  }
  const historicalExactIds = input.includeKnownListingStockEvidence &&
    !canonicalFresh ? currentCases.filter((row) =>
      row.identity_status === "LINKED_EXACT" && Boolean(row.stockguard_authority_id))
      .map((row) => row.ebay_item_id) : []
  const selectedIds = input.itemId ? [input.itemId] :
    [...new Set([...currentIds, ...historicalExactIds])]
  const rows: LiveRow[] = selectedIds.map((itemId) => {
    const currentCase = canonicalFresh && !officialFresh
      ? caseByItem.get(itemId) : null
    const official = officialByItem.get(itemId)
    const cached = registryByItem.get(itemId)
    return currentCase ? { ebay_item_id: itemId,
      ebay_sku: currentCase.ebay_custom_label,
      title: currentCase.ebay_title,
      listing_status: currentCase.listing_status?.toLowerCase() ?? "unknown" }
      : official ? { ebay_item_id: itemId,
        ebay_sku: official.customLabel ?? official.sku,
        title: official.title, listing_status: "active" }
      : cached ? { ebay_item_id: itemId, ebay_sku: cached.ebay_sku,
        title: cached.title ?? null, listing_status: cached.listing_status }
      : null
  }).filter((row): row is LiveRow => Boolean(row))
  // Portfolio-wide newest-first limits can omit older but still durable
  // observations. Read only the missing exact linked identities by Item ID.
  const missingEvidenceIds = rows.flatMap((row) => {
    const authority = authorities.find((entry) => entry.ebay_item_id === row.ebay_item_id &&
      entry.lifecycle_state === "ACTIVE")
    const decision = decisionHistory.filter((entry) => entry.ebay_item_id === row.ebay_item_id)
      .sort((a, b) => Number(b.decision_version) - Number(a.decision_version))[0]
    const linkageId = authority?.linkage_id ??
      (decision && exactDecisionIdentity(decision) ? decision.linkage_id : null)
    const latestJob = jobs.rows.filter((entry) =>
      entry.ebay_item_id === row.ebay_item_id && entry.linkage_id === linkageId)
      .sort((a, b) => Date.parse(b.observation_window_end) -
        Date.parse(a.observation_window_end))[0]
    return linkageId && (!latestJob || !observations.rows.some((entry) =>
      entry.ebay_item_id === row.ebay_item_id &&
      entry.stock_check_job_id === latestJob.stock_check_job_id))
      ? [row.ebay_item_id] : []
  })
  // A portfolio read must not fan out into one database pair per listing.
  // The initial bounded reads remain authoritative for rows they cover; one
  // additional bounded cohort read fills older linked rows omitted by the
  // newest-first window. Truncation stays visible as unknown evidence.
  const [missingJobsRead, missingObservationsRead] = missingEvidenceIds.length
    ? await Promise.all([
      input.supabase.from("seller_os_luna_stock_check_jobs")
        .select("stock_check_job_id,linkage_id,ebay_item_id,observation_window_start,observation_window_end,workflow_state,attempt_count,success_receipt_digest")
        .eq("account_key", input.accountKey).eq("workflow_state", "SUCCEEDED")
        .in("ebay_item_id", missingEvidenceIds)
        .order("observation_window_end", { ascending: false }).limit(1501),
      input.supabase.from("seller_os_luna_stock_observations")
        .select("observation_id,stock_check_job_id,linkage_id,ebay_item_id,component_identity_id,luna_product_id,luna_variant_id,luna_sku,supplier_quantity_required,observation_state,source_status,observed_availability,observed_supplier_quantity,evidence_class,evidence_digest,acquisition_method,attempt_number,observed_at,maximum_age_seconds,limitations")
        .eq("account_key", input.accountKey)
        .in("ebay_item_id", missingEvidenceIds)
        .order("observed_at", { ascending: false }).limit(1501),
    ]) : [null, null]
  const scopedEvidence = new Map(missingEvidenceIds.map((itemId) => [itemId, {
    jobs: missingJobsRead?.error || (missingJobsRead?.data?.length ?? 0) >= 1501
      ? { ...jobs, rows: [], status: "ERROR" as const } : {
        ...jobs, rows: (missingJobsRead?.data ?? []).filter((entry) =>
          entry.ebay_item_id === itemId) as typeof jobs.rows },
    observations: missingObservationsRead?.error ||
        (missingObservationsRead?.data?.length ?? 0) >= 1501
      ? { ...observations, rows: [], status: "ERROR" as const } : {
        ...observations, rows: (missingObservationsRead?.data ?? []).filter((entry) =>
          entry.ebay_item_id === itemId) as typeof observations.rows },
  }] as const))
  const listings = rows.map(row => {
    const itemId = row.ebay_item_id!
    const authorityGate = projectStockguardListingAuthorityP0({
      listing: { ebay_item_id: itemId, ebay_sku: row.ebay_sku,
      listing_status: row.listing_status }, liveListings: gateLiveListings,
      authorities, quarantines,
    })
    const listingCase = caseByItem.get(itemId) ?? null
    // The active canonical listing authority is the linkage source of truth.
    // Registry cases remain useful presentation data, but an older or
    // contradictory case projection cannot demote a currently certified
    // authority after its account, marketplace, Item ID, SKU, cardinality and
    // quarantine checks have passed above.
    const authority = authorityGate.stockguardEligible
      ? authorityGate.authority : null
    // Approved durable decisions predate the newer active-authority table.
    // Use them only when the latest decision is exact, uncontradicted, and
    // bound to this account's current Item ID and observed eBay SKU.
    const latestDecision = decisionHistory.filter((entry) =>
      entry.ebay_item_id === itemId).sort((a, b) =>
        Number(b.decision_version) - Number(a.decision_version))[0] ?? null
    const legacyTuple = latestDecision ? exactDecisionIdentity(latestDecision) : null
    const separateCertifiedLabelIdentities = Boolean(legacyTuple &&
      authorityGate.quarantine?.reason_code === "DUPLICATE_LIVE_EBAY_SKU" &&
      authorityGate.conflictingLiveItemIds.length > 0 &&
      authorityGate.conflictingLiveItemIds.every((otherId) => {
        const otherAuthority = authorities.find((entry) =>
          entry.ebay_item_id === otherId && entry.lifecycle_state === "ACTIVE")
        const otherDecision = decisionHistory.filter((entry) =>
          entry.ebay_item_id === otherId).sort((a, b) =>
            Number(b.decision_version) - Number(a.decision_version))[0]
        const otherTuple = otherAuthority ? {
          sku: otherAuthority.luna_sku,
          productId: otherAuthority.luna_product_id,
          variantId: otherAuthority.luna_variant_id,
        } : otherDecision ? exactDecisionIdentity(otherDecision) : null
        return otherTuple && (otherTuple.sku !== legacyTuple.sku ||
          otherTuple.productId !== legacyTuple.productId ||
          otherTuple.variantId !== legacyTuple.variantId)
      }))
    const blockingQuarantine = authorityGate.quarantine &&
      !(authority && authorityGate.quarantine.reason_code ===
        "DUPLICATE_LIVE_EBAY_SKU") &&
      !separateCertifiedLabelIdentities ? authorityGate.quarantine : null
    const legacyDecision = !authorityGate.latestAuthority && !blockingQuarantine &&
      row.listing_status === "active" && latestDecision && legacyTuple &&
      latestDecision.ebay_sku === row.ebay_sku
      ? latestDecision : null
    const linked = Boolean(authority || legacyDecision)
    const exactTuple = authority ? { sku: authority.luna_sku,
      productId: authority.luna_product_id,
      variantId: authority.luna_variant_id } : legacyDecision ? legacyTuple : null
    const conflictingSupplierItemIds = exactTuple ? rows.flatMap((other) => {
      if (other.ebay_item_id === itemId || !currentIds.has(other.ebay_item_id))
        return []
      const otherQuarantine = quarantines.find((entry) =>
        entry.ebay_item_id === other.ebay_item_id &&
        entry.quarantine_state === "ACTIVE" &&
        entry.reason_code !== "DUPLICATE_LIVE_EBAY_SKU")
      if (otherQuarantine) return []
      const otherAuthority = authorities.find((entry) =>
        entry.ebay_item_id === other.ebay_item_id &&
        entry.lifecycle_state === "ACTIVE")
      const otherDecision = decisionHistory.filter((entry) =>
        entry.ebay_item_id === other.ebay_item_id).sort((a, b) =>
          Number(b.decision_version) - Number(a.decision_version))[0]
      const otherTuple = otherAuthority ? { sku: otherAuthority.luna_sku,
        productId: otherAuthority.luna_product_id,
        variantId: otherAuthority.luna_variant_id } : otherDecision &&
        otherDecision.ebay_sku === other.ebay_sku
          ? exactDecisionIdentity(otherDecision) : null
      return otherTuple?.sku === exactTuple.sku &&
        otherTuple.productId === exactTuple.productId &&
        otherTuple.variantId === exactTuple.variantId
        ? [other.ebay_item_id] : []
    }) : []
    const decisionRows = authority ? [{
      decision_id: authority.source_decision_id,
      decision_version: 1,
      decision: "APPROVE_EXACT_LINKAGE",
      decision_at: authority.activated_at,
      ebay_item_id: authority.ebay_item_id,
      ebay_sku: authority.ebay_sku,
      linkage_id: authority.linkage_id,
      components: authority.components,
      evidence_digest: authority.source_fingerprint ?? "",
      evidence_references: [{ authorityId: authority.authority_id }],
    }] : legacyDecision ? [legacyDecision] : []
    const decisions = { status: "AVAILABLE" as const, rows: decisionRows }
    const rowJobs = scopedEvidence.get(itemId)?.jobs ?? jobs
    const rowObservations = scopedEvidence.get(itemId)?.observations ?? observations
    const projection = projectSellerOsCanonicalLunaStockReadModelV1({ itemId,
      identity: { itemId, sku: row.ebay_sku, variationKey: null },
      marketplace: { marketplaceId: "EBAY_US", accountAlias: input.accountAlias }, now,
      decisions, jobs: rowJobs, observations: rowObservations })
    const stock = projection.stock
    const stockObservedAt = linked
      ? stock?.evidenceReferences?.at(-1)?.capturedAt ?? null : null
    const maximumAgeSeconds = stock?.freshness.maximumAgeSeconds
    const stockFreshUntil = stockObservedAt && maximumAgeSeconds &&
      Number.isFinite(Date.parse(stockObservedAt))
      ? new Date(Date.parse(stockObservedAt) + maximumAgeSeconds * 1_000).toISOString()
      : null
    const rawComponents = authority?.components ?? legacyDecision?.components
    const components = linked && Array.isArray(rawComponents)
      ? rawComponents.map((component) => ({
          supplierProductId: component.lunaProductId ?? component.luna_product_id,
          supplierVariantId: component.lunaVariantId ?? component.luna_variant_id,
          supplierSku: component.lunaSku ?? component.luna_sku,
        })) : []
    const exactProductId = authority?.luna_product_id ?? legacyTuple?.productId
    const exactVariantId = authority?.luna_variant_id ?? legacyTuple?.variantId
    const exactSku = authority?.luna_sku ?? legacyTuple?.sku
    const latestExactObservation = linked && components.length === 1
      ? rowObservations.rows.filter((observation) =>
          observation.ebay_item_id === itemId &&
          observation.luna_product_id === exactProductId &&
          observation.luna_variant_id === exactVariantId &&
          observation.luna_sku === exactSku &&
          observation.source_status === "AVAILABLE")
        .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0]
      : null
    const observedQuantity = latestExactObservation?.observed_supplier_quantity
    const supplierStockQuantity = observedQuantity === null ||
      observedQuantity === undefined || !Number.isSafeInteger(Number(observedQuantity))
      ? null : Number(observedQuantity)
    const ownerObservation = linked && components.length === 1
      ? ownerStockRows.find((entry) =>
          entry.ebay_item_id === itemId &&
          entry.linkage_id === (authority?.linkage_id ?? legacyDecision?.linkage_id) &&
          entry.luna_product_id === exactProductId &&
          entry.luna_variant_id === exactVariantId &&
          entry.luna_sku === exactSku) ?? null : null
    const ownerQuantityCorrected = Boolean(ownerObservation &&
      correctedOwnerQuantityIds.has(ownerObservation.observation_id))
    const ownerQuantity = ownerQuantityCorrected ? null :
      ownerObservation?.observed_supplier_quantity ?? null
    const ownerObservedAt = ownerObservation?.observed_at ?? null
    const newestAutomaticAt = Math.max(Date.parse(stockObservedAt ?? "") || 0,
      Date.parse(latestExactObservation?.observed_at ?? "") || 0)
    const useOwnerObservation = Boolean(ownerObservedAt &&
      Date.parse(ownerObservedAt) > newestAutomaticAt)
    const ownerFreshUntil = useOwnerObservation && ownerObservation
      ? new Date(Date.parse(ownerObservation.observed_at) +
          ownerObservation.maximum_age_seconds * 1000).toISOString() : null
    const ownerFreshness = ownerFreshUntil && Date.parse(ownerFreshUntil) > now.getTime()
      ? "FRESH" : "STALE"
    return { itemId, sku: row.ebay_sku, title: row.title ?? null,
      canonicalCaseId: listingCase?.case_id ?? null,
      listingOrigin: listingCase?.origin ?? null,
      identityStatus: listingCase?.identity_status ?? null,
      stockguardLinkStatus: listingCase?.stockguard_link_status ?? null,
      liveStatus: currentIds.has(itemId) && row.listing_status === "active"
        ? "LIVE_ACTIVE" : "CURRENT_LIVE_UNPROVEN",
      supplierLinkage: linked ? projection.supplierLinkageStatus : "UNPROVEN",
      linkAuthorityState: authority ? authorityGate.lifecycleState :
        legacyDecision ? "APPROVED_DURABLE_DECISION" : authorityGate.lifecycleState,
      identityQuarantine: blockingQuarantine?.reason_code ?? null,
      dataQualityWarnings: authorityGate.conflictingLiveItemIds.length
        ? ["DUPLICATE_CUSTOM_LABEL"] : [],
      conflictingSupplierItemIds,
      conflictingLiveItemIds: authorityGate.conflictingLiveItemIds,
      components,
      supplierAvailability: useOwnerObservation
        ? ownerObservation?.observed_stock_state :
        stock?.state === "IN_STOCK_SIGNAL" ? "IN_STOCK"
        : stock?.state === "CERTIFIED_OOS" ? "OUT_OF_STOCK" : "UNKNOWN",
      certifiedListingCapacity: linked &&
        stock?.freshness.status === "FRESH" &&
        projection.composition?.bundleCapacity.availability === "AVAILABLE"
        ? projection.composition.bundleCapacity.value : null,
      stockGuardState: useOwnerObservation
        ? ownerObservation?.observed_stock_state === "IN_STOCK"
          ? "IN_STOCK_SIGNAL" : "OWNER_VERIFIED_OUT_OF_STOCK"
        : linked ? stock?.state ?? "STOCK_UNKNOWN" : "STOCK_UNKNOWN",
      stockFreshness: useOwnerObservation ? ownerFreshness
        : linked ? stock?.freshness.status ?? "UNKNOWN" : "UNKNOWN",
      stockObservedAt: useOwnerObservation ? ownerObservedAt : stockObservedAt,
      stockFreshUntil: useOwnerObservation ? ownerFreshUntil : stockFreshUntil,
      supplierStockQuantity: useOwnerObservation
        ? ownerQuantity : supplierStockQuantity,
      lastSuccessfulSource: useOwnerObservation
        ? "LUNA_OWNER_VISIBLE_SOURCE" : latestExactObservation?.acquisition_method ?? null,
      limitationCode: useOwnerObservation
        ? ownerFreshness === "STALE" ? "LUNA_STOCK_EVIDENCE_STALE"
          : ownerObservation?.observed_stock_state === "IN_STOCK" &&
            ownerQuantity === null
            ? "NUMERIC_SAFE_CAPACITY_UNPROVEN" : null
        : linked ? projection.limitationCode : authorityGate.limitationCode,
    }
  })
  const currentLiveState = officialFresh || canonicalFresh
    ? "CURRENT_FRESH" : live.currentState
  return { observedAt: now.toISOString(), currentLiveState,
    cohortComplete: currentLiveState === "CURRENT_FRESH" &&
      (input.itemId ? listings.length === 1 : listings.length === currentIds.size) &&
      listings.every(row => row.liveStatus === "LIVE_ACTIVE"),
    sourceStatus: { registry: registry.status, linkAuthority: "AVAILABLE" as const,
      listingRegistry: canonicalFresh ? "CURRENT_FRESH" as const :
        "CURRENT_UNAVAILABLE" as const,
      jobs: jobs.status, observations: observations.status }, listings }
}
