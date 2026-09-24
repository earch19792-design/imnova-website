export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { getEbayOfficialLiveListingSweepReadonly } from
  "@/lib/ebay/ebay-commercial-monitor-live-readonly"
import type { EbayLiveListing } from
  "@/lib/ebay/ebay-commercial-monitor-live-readonly-domain"
import { readManualListingFromTradingApi } from
  "@/lib/ebay/ebay-manual-listing-trading-readonly"
import { parseManualListingRegistrationInput } from
  "@/lib/ebay/ebay-manual-listing-domain"
import { registerManualEbayListing } from
  "@/lib/ebay/ebay-manual-listing-service"
import { ensureStockguardAuthorityFromDecisionP0 } from
  "@/lib/ebay/stockguard-listing-link-authority-p0"
import { materializeCanonicalLunaOpportunityIdentityV1 } from
  "@/lib/ebay/ebay-luna-opportunity-identity-v1"
import { readCurrentListingOwnerReviewTargetV1 } from
  "@/lib/ebay/seller-os-listing-owner-review-v1"
import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { buildListingIdentityReviewQueueV1, packageIdFromCustomLabelV1 } from
  "@/lib/ebay/seller-os-listing-identity-review-v1"
import { persistListingCasesV1, projectSellerOsListingCasesV1,
  readListingRegistryEvidenceV1 } from
  "@/lib/ebay/seller-os-listing-registry-v1"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"

const headers = { "Cache-Control": "private, no-store, max-age=0" }
function fail(code: string, status = 503) {
  return NextResponse.json({ success: false, error: code,
    safety: { ebayWrites: 0, inventoryQuantityWrites: 0 } },
  { status, headers })
}
function safeError(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^(LISTING_REGISTRY|MANUAL_LISTING|LUNA_OPPORTUNITY|LISTING_LINK_AUTHORITY)_[A-Z0-9_]+$/.test(code) ? code :
    "LISTING_REGISTRY_REQUEST_FAILED"
}

async function recordOwnerReviewActionV1(
  supabase: ReturnType<typeof getSupabaseAdminClient>, input: {
    caseId: string; itemId: string; sweepId: string; actorUserId: string;
    action: "CONFIRM_EXACT_LINK" | "REJECT_CANDIDATE" |
      "KEEP_MANUAL_NO_LUNA" | "REVIEW_CONFLICT";
    candidate?: { productId: string; variantId: string; sku: string } | null
  },
) {
  const state = { action: input.action, marketplaceId: "EBAY_US",
    ebayItemId: input.itemId, reviewSweepId: input.sweepId,
    actorUserId: input.actorUserId,
    candidateProductId: input.candidate?.productId ?? null,
    candidateVariantId: input.candidate?.variantId ?? null,
    candidateSku: input.candidate?.sku ?? null }
  const saved = await supabase.from("seller_os_listing_case_events_v1")
    .insert({ case_id: input.caseId, event_type: "OWNER_REVIEW_ACTION",
      previous_state: null, current_state: state })
    .select("event_id").single()
  if (saved.error || !saved.data) {
    throw new Error("LISTING_REGISTRY_OWNER_ACTION_WRITE_FAILED")
  }
  const readback = await supabase.from("seller_os_listing_case_events_v1")
    .select("case_id,event_type,current_state").eq("event_id", saved.data.event_id)
    .single()
  if (readback.error || !readback.data ||
    readback.data.case_id !== input.caseId ||
    readback.data.event_type !== "OWNER_REVIEW_ACTION" ||
    !Object.entries(state).every(([key, value]) =>
      (readback.data.current_state as Record<string, unknown>)[key] === value)) {
    throw new Error("LISTING_REGISTRY_OWNER_ACTION_READBACK_FAILED")
  }
  return saved.data.event_id as number
}

export async function GET(req: Request) {
  const auth = await validateAdminApiRequest(req)
  if (!auth.ok) return fail(auth.error ?? "ADMIN_FORBIDDEN", auth.status || 403)
  const scope = getEbaySellerAccountScopeConfiguration()
  if (!scope.accountKey) return fail("LISTING_REGISTRY_ACCOUNT_SCOPE_REQUIRED")
  try {
    const supabase = getSupabaseAdminClient()
    const [cases, sync, sweep] = await Promise.all([
      supabase.from("seller_os_listing_cases_v1").select("*")
        .eq("account_key", scope.accountKey).eq("marketplace_id", "EBAY_US")
        .order("ebay_item_id", { ascending: true }).limit(1000),
      supabase.from("ebay_active_listing_sync_state")
        .select("current_live_source_state,last_certified_live_count,last_certified_live_observed_at,last_certified_live_fresh_until")
        .eq("account_key", scope.accountKey).maybeSingle(),
      supabase.from("seller_os_listing_registry_sweeps_v1")
        .select("sweep_id,official_observed_at,official_live_item_count,reconciled_item_count,completed_at,status")
        .eq("account_key", scope.accountKey).eq("marketplace_id", "EBAY_US")
        .eq("status", "COMPLETE").order("completed_at", { ascending: false })
        .limit(1).maybeSingle(),
    ])
    if (cases.error || sync.error || sweep.error) {
      throw new Error("LISTING_REGISTRY_READ_FAILED")
    }
    if ((cases.data?.length ?? 0) >= 1000) {
      throw new Error("LISTING_REGISTRY_CASE_PAGINATION_REQUIRED")
    }
    const currentCases = (cases.data ?? []).filter((row) =>
      row.last_reconciled_sweep_id === sweep.data?.sweep_id)
    const labels = [...new Set(currentCases.flatMap((row) =>
      row.ebay_custom_label ? [String(row.ebay_custom_label)] : []))]
    const packageIds = [...new Set(labels.flatMap((label) => {
      const id = packageIdFromCustomLabelV1(label)
      return id ? [id] : []
    }))]
    const [snapshot, packageRead, decisionRead, skuOpportunityRead, ownerActionRead] = await Promise.all([
      supabase.from("luna_catalog_snapshots_v1")
        .select("snapshot_id").eq("snapshot_status", "COMPLETE")
        .order("snapshot_completed_at", { ascending: false }).limit(1).maybeSingle(),
      packageIds.length ? supabase.from("ebay_listing_packages")
        .select("id,opportunity_id,candidate_key").eq("account_key", scope.accountKey)
        .in("id", packageIds).limit(packageIds.length + 1) :
        Promise.resolve({ data: [], error: null }),
      currentCases.length ? supabase.from("seller_os_luna_linkage_decisions")
        .select("ebay_item_id,ebay_sku,luna_product_id,luna_variant_id,luna_sku,decision,decision_version,evidence_observed_at")
        .eq("account_key", scope.accountKey).eq("marketplace_id", "EBAY_US")
        .in("ebay_item_id", currentCases.map((row) => row.ebay_item_id))
        .order("decision_version", { ascending: false }).limit(500) :
        Promise.resolve({ data: [], error: null }),
      labels.length ? supabase.from("ebay_luna_opportunity_queue")
        .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku")
        .in("supplier_sku", labels).limit(200) :
        Promise.resolve({ data: [], error: null }),
      currentCases.length ? supabase.from("seller_os_listing_case_events_v1")
        .select("case_id,current_state,recorded_at,event_id")
        .eq("event_type", "OWNER_REVIEW_ACTION")
        .in("case_id", currentCases.map((row) => row.case_id))
        .order("event_id", { ascending: false }).limit(500) :
        Promise.resolve({ data: [], error: null }),
    ])
    if (snapshot.error || packageRead.error || decisionRead.error ||
        skuOpportunityRead.error || ownerActionRead.error ||
        (packageRead.data?.length ?? 0) > packageIds.length ||
        (decisionRead.data?.length ?? 0) >= 500 ||
        (skuOpportunityRead.data?.length ?? 0) >= 200 ||
        (ownerActionRead.data?.length ?? 0) >= 500) {
      throw new Error("LISTING_REGISTRY_REVIEW_EVIDENCE_READ_FAILED")
    }
    const opportunityIds = [...new Set((packageRead.data ?? []).map((row) =>
      row.opportunity_id))]
    const opportunityRead = opportunityIds.length
      ? await supabase.from("ebay_luna_opportunity_queue")
        .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku")
        .in("id", opportunityIds).limit(opportunityIds.length + 1)
      : { data: [], error: null }
    if (opportunityRead.error) {
      throw new Error("LISTING_REGISTRY_REVIEW_EVIDENCE_READ_FAILED")
    }
    const opportunities = [...new Map([...(opportunityRead.data ?? []),
      ...(skuOpportunityRead.data ?? [])].map((row) => [row.id, row])).values()]
    const catalogSkus = [...new Set([...labels,
      ...opportunities.flatMap((row) =>
        row.supplier_sku ? [String(row.supplier_sku)] : []),
      ...(decisionRead.data ?? []).flatMap((row) =>
        row.luna_sku ? [String(row.luna_sku)] : [])])]
    const catalogRead = snapshot.data?.snapshot_id && catalogSkus.length
      ? await supabase.from("luna_catalog_snapshot_variants_v1")
        .select("product_id,variant_id,sku,preflight_status")
        .eq("snapshot_id", snapshot.data.snapshot_id)
        .in("sku", catalogSkus).limit(500)
      : { data: [], error: null }
    if (catalogRead.error || (catalogRead.data?.length ?? 0) >= 500) {
      throw new Error("LISTING_REGISTRY_REVIEW_EVIDENCE_READ_FAILED")
    }
    const reviewQueue = buildListingIdentityReviewQueueV1({
      cases: currentCases,
      catalog: catalogRead.data ?? [],
      decisions: decisionRead.data ?? [],
      packages: packageRead.data ?? [],
      opportunities,
      ownerActions: (ownerActionRead.data ?? []).map((row) => {
        const state = row.current_state as Record<string, unknown>
        return { caseId: row.case_id, action: String(state.action ?? ""),
          candidateProductId: typeof state.candidateProductId === "string"
            ? state.candidateProductId : null,
          candidateVariantId: typeof state.candidateVariantId === "string"
            ? state.candidateVariantId : null,
          candidateSku: typeof state.candidateSku === "string"
            ? state.candidateSku : null, recordedAt: row.recorded_at }
      }).filter((row, index, rows) => rows.findIndex((entry) =>
        entry.caseId === row.caseId) === index),
    })
    const fresh = Boolean(sweep.data?.official_observed_at &&
      Date.now() - Date.parse(sweep.data.official_observed_at) <= 20 * 60_000 &&
      Date.parse(sweep.data.official_observed_at) - Date.now() <= 60_000 &&
      sweep.data.official_live_item_count === currentCases.length &&
      sweep.data.reconciled_item_count === currentCases.length)
    return NextResponse.json({ success: true, cases: cases.data ?? [],
      reviewQueue, reviewSweepId: sweep.data?.sweep_id ?? null,
      currentLiveCertified: fresh,
      currentLiveCaseCount: fresh ? currentCases.length : null,
      currentSweepId: fresh ? sweep.data?.sweep_id : null,
      lastCertifiedLiveCount: sweep.data?.official_live_item_count ??
        sync.data?.last_certified_live_count ?? null,
      lastCertifiedAt: sweep.data?.official_observed_at ??
        sync.data?.last_certified_live_observed_at ?? null,
      accountKey: scope.accountKey, marketplace: "EBAY_US",
      safety: { ebayWrites: 0, inventoryQuantityWrites: 0 } },
    { headers })
  } catch (error) { return fail(safeError(error)) }
}

export async function POST(req: Request) {
  const auth = await validateAdminApiRequest(req)
  if (!auth.ok) return fail(auth.error ?? "ADMIN_FORBIDDEN", auth.status || 403)
  const scope = getEbaySellerAccountScopeConfiguration()
  if (!scope.accountKey || !scope.accountAlias) {
    return fail("LISTING_REGISTRY_ACCOUNT_SCOPE_REQUIRED")
  }
  try {
    const body = await req.json() as { action?: string; ebayItemId?: string;
      opportunityId?: string; confirmation?: string; candidateSku?: string;
      candidateProductId?: string; candidateVariantId?: string }
    const supabase = getSupabaseAdminClient()
    let ownerConfirmation: { caseId: string; sweepId: string; directSku: boolean;
      candidate: { productId: string; variantId: string; sku: string } } | null = null
    if (["confirm_exact_link", "reject_candidate", "keep_manual_no_luna",
      "review_conflict"].includes(body.action ?? "")) {
      if (!auth.userId) return fail("LISTING_REGISTRY_OWNER_REQUIRED", 403)
      if (!/^\d{9,20}$/.test(body.ebayItemId ?? "")) {
        return fail("LISTING_REGISTRY_ITEM_ID_INVALID", 400)
      }
      const review = await readCurrentListingOwnerReviewTargetV1({
        supabase, accountKey: scope.accountKey, itemId: body.ebayItemId!,
      })
      if (body.action === "confirm_exact_link" || body.action === "reject_candidate") {
        if (body.confirmation !== "CONFIRM_EXACT_LISTING_LUNA" ||
          review.candidates.length !== 1 ||
          review.candidates[0].productId !== body.candidateProductId ||
          review.candidates[0].variantId !== body.candidateVariantId ||
          review.candidates[0].sku !== body.candidateSku) {
          return fail("LISTING_REGISTRY_OWNER_CANDIDATE_MISMATCH", 409)
        }
      }
      if (body.action === "confirm_exact_link") {
        if (!review.canConfirm) return fail("LISTING_REGISTRY_EXACT_CANDIDATE_BLOCKED", 409)
        const candidate = review.candidates[0]
        const opportunity = candidate.opportunityId ?
          { opportunityId: candidate.opportunityId } :
          await materializeCanonicalLunaOpportunityIdentityV1({ supabase,
            identity: { marketplaceId: "EBAY_US",
              supplierProductId: candidate.productId,
              supplierVariantId: candidate.variantId,
              supplierSku: candidate.sku } })
        body.opportunityId = opportunity.opportunityId
        ownerConfirmation = { caseId: review.target.case_id,
          sweepId: review.sweepId, candidate,
          directSku: candidate.source === "CURRENT_LUNA_CATALOG_EXACT_SKU" }
      } else {
        if (body.action === "keep_manual_no_luna" &&
          review.target.identity_status !== "MISSING_LUNA_IDENTITY") {
          return fail("LISTING_REGISTRY_MANUAL_DISPOSITION_BLOCKED", 409)
        }
        if (body.action === "reject_candidate" &&
          review.target.identity_status !== "MISSING_LUNA_IDENTITY") {
          return fail("LISTING_REGISTRY_CANDIDATE_REJECTION_BLOCKED", 409)
        }
        if (["keep_manual_no_luna", "review_conflict"].includes(body.action!) &&
          body.confirmation !== "CONFIRM_OWNER_REVIEW_ACTION") {
          return fail("LISTING_REGISTRY_OWNER_CONFIRMATION_REQUIRED", 400)
        }
        const action = body.action === "reject_candidate" ? "REJECT_CANDIDATE" :
          body.action === "keep_manual_no_luna" ? "KEEP_MANUAL_NO_LUNA" :
            "REVIEW_CONFLICT"
        const eventId = await recordOwnerReviewActionV1(supabase, {
          caseId: review.target.case_id, itemId: body.ebayItemId!,
          sweepId: review.sweepId, actorUserId: auth.userId, action,
          candidate: body.action === "reject_candidate" ? review.candidates[0] : null,
        })
        return NextResponse.json({ success: true, ownerAction: action,
          eventId, durableReadback: "PASS",
          safety: { ebayWrites: 0, inventoryQuantityWrites: 0 } }, { headers })
      }
    }
    let evidence = await readListingRegistryEvidenceV1(supabase, scope.accountKey)
    const prior = await supabase.from("seller_os_listing_cases_v1")
      .select("ebay_item_id,origin,opportunity_id,luna_product_id,luna_variant_id,supplier_sku")
      .eq("account_key", scope.accountKey)
      .eq("marketplace_id", "EBAY_US").limit(1000)
    if (prior.error) throw new Error("LISTING_REGISTRY_READ_FAILED")
    if ((prior.data?.length ?? 0) >= 1000) {
      throw new Error("LISTING_REGISTRY_CASE_PAGINATION_REQUIRED")
    }
    const existingOrigins = Object.fromEntries((prior.data ?? []).map((row) =>
      [row.ebay_item_id, row.origin])) as Record<string, "SELLER_OS" | "MANUAL_EBAY" | "IMPORTED_LEGACY">
    const existingOpportunities = Object.fromEntries((prior.data ?? [])
      .filter((row) => row.opportunity_id && row.luna_product_id &&
        row.luna_variant_id && row.supplier_sku)
      .map((row) => [row.ebay_item_id, { opportunityId: row.opportunity_id!,
        productId: row.luna_product_id!, variantId: row.luna_variant_id!,
        sku: row.supplier_sku! }]))
    let listings: EbayLiveListing[]
    let officialObservedAt: string | null = null
    if (body.action === "reconcile_current_live") {
      const live = await getEbayOfficialLiveListingSweepReadonly({
        accountKey: scope.accountKey, accountAlias: scope.accountAlias,
      })
      if (live.status !== "CERTIFIED_COMPLETE") {
        return NextResponse.json({ success: false,
          error: "LISTING_REGISTRY_OFFICIAL_LIVE_COVERAGE_UNPROVEN",
          failedOperation: live.failedOperation,
          errorDetail: live.errorCode,
          officialReadReached: live.officialReadReached,
          paginationComplete: live.paginationComplete,
          pagesRead: live.pagesRead, totalPages: live.totalPages,
          totalEntries: live.totalEntries, gapCodes: live.gapCodes,
          safety: { ebayWrites: 0, inventoryQuantityWrites: 0 } },
        { status: 409, headers })
      }
      listings = live.listings.filter((listing) =>
        listing.marketplaceCertification.status === "US_CERTIFIED")
      officialObservedAt = live.observedAt
    } else if (body.action === "link_existing" ||
      body.action === "confirm_exact_link") {
      if (!auth.userId) return fail("LISTING_REGISTRY_OWNER_REQUIRED", 403)
      if (body.confirmation !== (body.action === "confirm_exact_link"
        ? "CONFIRM_EXACT_LISTING_LUNA" : "VINCULAR_IDENTIDAD_CANONICA")) {
        return fail("LISTING_REGISTRY_OWNER_CONFIRMATION_REQUIRED", 400)
      }
      if (!/^\d{9,20}$/.test(body.ebayItemId ?? "") ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(body.opportunityId ?? "")) {
        return fail("LISTING_REGISTRY_LINK_INPUT_INVALID", 400)
      }
      const previous = await supabase.from("seller_os_listing_cases_v1")
        .select("ebay_item_id,ebay_custom_label,ebay_observed_at,origin,identity_status")
        .eq("account_key", scope.accountKey).eq("marketplace_id", "EBAY_US")
        .eq("ebay_item_id", body.ebayItemId!).maybeSingle()
      if (previous.error || !previous.data ||
        !previous.data.ebay_custom_label ||
        ["AMBIGUOUS", "DUPLICATE_IDENTITY", "NEEDS_OWNER_REVIEW"]
          .includes(previous.data.identity_status) ||
        Date.now() - Date.parse(previous.data.ebay_observed_at) > 20 * 60_000) {
        return fail("LISTING_REGISTRY_FRESH_IMPORTED_CASE_REQUIRED", 409)
      }
      let verifiedSku: string
      let verifiedTitle: string | null
      let verifiedQuantity: number | null
      let verifiedPrice: number | null
      let verifiedCurrency: string | null
      let verifiedObservedAt: string
      if (ownerConfirmation?.directSku) {
        const observed = await readManualListingFromTradingApi(body.ebayItemId!)
        if (observed.ownership !== "verified" ||
          observed.itemId !== body.ebayItemId ||
          observed.ebaySku !== ownerConfirmation.candidate.sku ||
          observed.listingStatus?.toLowerCase() !== "active" ||
          !["US", "0"].includes(observed.marketplaceSite ?? "") ||
          !observed.title || observed.availableQuantity === null ||
          observed.price === null || !observed.currency) {
          return fail("LISTING_REGISTRY_OFFICIAL_EXACT_ITEM_UNPROVEN", 409)
        }
        const admitted = await supabase.rpc(
          "confirm_seller_os_listing_owner_exact_sku_v1", {
            p_account_key: scope.accountKey,
            p_ebay_item_id: body.ebayItemId!,
            p_opportunity_id: body.opportunityId!,
            p_luna_product_id: ownerConfirmation.candidate.productId,
            p_luna_variant_id: ownerConfirmation.candidate.variantId,
            p_luna_sku: ownerConfirmation.candidate.sku,
            p_official_observed_at: observed.observedAt,
            p_official_title: observed.title,
            p_official_quantity: observed.availableQuantity,
            p_official_price: observed.price,
            p_official_currency: observed.currency,
            p_actor_user_id: auth.userId,
          })
        const receipt = admitted.data as Record<string, unknown> | null
        if (admitted.error || receipt?.status !== "PROVEN" ||
          typeof receipt.decisionId !== "string" ||
          !/^luna-linkage-decision-v1:sha256:[0-9a-f]{64}$/.test(receipt.decisionId)) {
          throw new Error("LISTING_REGISTRY_OWNER_EXACT_DECISION_UNPROVEN")
        }
        const authority = await ensureStockguardAuthorityFromDecisionP0({
          supabase, accountKey: scope.accountKey,
          ebayItemId: body.ebayItemId!, sourceDecisionId: receipt.decisionId,
          actorUserId: auth.userId, automatedDeterministic: false,
        })
        if (!authority.stockguardEligible) {
          throw new Error("LISTING_REGISTRY_STOCKGUARD_LINK_READBACK_UNPROVEN")
        }
        verifiedSku = observed.ebaySku
        verifiedTitle = observed.title
        verifiedQuantity = observed.availableQuantity
        verifiedPrice = observed.price
        verifiedCurrency = observed.currency
        verifiedObservedAt = observed.observedAt
      } else {
        const input = parseManualListingRegistrationInput({
          ebayItemId: body.ebayItemId, opportunityId: body.opportunityId,
          supplierSku: ownerConfirmation?.candidate.sku,
          supplierVariantId: ownerConfirmation?.candidate.variantId,
        })
        const linked = await registerManualEbayListing(supabase, input, auth.userId)
        const verification = linked.verification
        const snapshot = verification.connectorListingSnapshot
        if (verification.status !== "verified" ||
          !verification.connectorObservedAt || !verification.connectorEbaySku ||
          !snapshot) {
          return fail("LISTING_REGISTRY_EXACT_LINK_UNPROVEN", 409)
        }
        verifiedSku = verification.connectorEbaySku
        verifiedTitle = snapshot.title
        verifiedQuantity = snapshot.availableQuantity
        verifiedPrice = snapshot.price
        verifiedCurrency = snapshot.currency
        verifiedObservedAt = verification.connectorObservedAt
      }
      evidence = await readListingRegistryEvidenceV1(supabase, scope.accountKey)
      listings = [{ itemId: body.ebayItemId!, sku: verifiedSku,
        customLabel: verifiedSku, variationKey: null,
        title: verifiedTitle, primaryImageUrl: null, listingState: "ACTIVE",
        listingFormat: null, startTime: null,
        availableQuantity: verifiedQuantity, price: verifiedPrice,
        currency: verifiedCurrency, marketplaceSite: "US",
        marketplaceCertification: { status: "US_CERTIFIED", source: "EBAY_TRADING_GET_ITEM",
          observedAt: verifiedObservedAt }, identityAmbiguous: false,
        source: "EBAY_TRADING_GET_MY_EBAY_SELLING",
        observedAt: verifiedObservedAt }]
    } else if (body.action === "import_existing") {
      if (!auth.userId) return fail("LISTING_REGISTRY_OWNER_REQUIRED", 403)
      if (!/^\d{9,20}$/.test(body.ebayItemId ?? "")) {
        return fail("LISTING_REGISTRY_ITEM_ID_INVALID", 400)
      }
      const observed = await readManualListingFromTradingApi(body.ebayItemId!)
      if (observed.ownership !== "verified" ||
        observed.itemId !== body.ebayItemId ||
        observed.listingStatus?.toLowerCase() !== "active" ||
        !["US", "0"].includes(observed.marketplaceSite ?? "")) {
        return fail("LISTING_REGISTRY_OFFICIAL_ITEM_NOT_VERIFIED", 409)
      }
      listings = [{ itemId: observed.itemId, sku: observed.ebaySku,
        customLabel: observed.ebaySku, variationKey: null, title: observed.title,
        primaryImageUrl: null, listingState: "ACTIVE", listingFormat: null,
        startTime: null, availableQuantity: observed.availableQuantity,
        price: observed.price, currency: observed.currency, marketplaceSite: "US",
        marketplaceCertification: { status: "US_CERTIFIED", source: "EBAY_TRADING_GET_ITEM",
          observedAt: observed.observedAt }, identityAmbiguous: false,
        source: "EBAY_TRADING_GET_MY_EBAY_SELLING", observedAt: observed.observedAt }]
    } else return fail("LISTING_REGISTRY_ACTION_INVALID", 400)

    const projected = projectSellerOsListingCasesV1({ accountKey: scope.accountKey,
      listings, ...evidence, existingOrigins, existingOpportunities,
      manualImportItemIds: body.action === "import_existing" ||
        body.action === "confirm_exact_link" ? [body.ebayItemId!] : [] })
      .map((row) => ownerConfirmation?.directSku &&
        row.ebay_item_id === body.ebayItemId &&
        row.identity_status === "LINKED_EXACT" &&
        row.luna_product_id === ownerConfirmation.candidate.productId &&
        row.luna_variant_id === ownerConfirmation.candidate.variantId &&
        row.supplier_sku === ownerConfirmation.candidate.sku
        ? { ...row, opportunity_id: body.opportunityId! } : row)
    const sweepStart = body.action === "reconcile_current_live"
      ? await supabase.from("seller_os_listing_registry_sweeps_v1")
        .insert({ account_key: scope.accountKey, marketplace_id: "EBAY_US",
          source_authority: "EBAY_TRADING_GET_MY_EBAY_SELLING_PLUS_GET_ITEM_CERTIFICATION",
          official_observed_at: officialObservedAt,
          official_live_item_count: projected.length })
        .select("sweep_id").single() : null
    if (sweepStart?.error || sweepStart && !sweepStart.data) {
      throw new Error("LISTING_REGISTRY_SWEEP_WRITE_FAILED")
    }
    const newSweepId = sweepStart?.data?.sweep_id as string | undefined
    const sweepId = (newSweepId ??
      ownerConfirmation?.sweepId) as string | undefined
    const saved = await persistListingCasesV1(supabase, projected, sweepId)
    const ids = saved.map((row) => row.case_id as string)
    const readback = ids.length ? await supabase.from("seller_os_listing_cases_v1")
      .select("*").in("case_id", ids).eq("account_key", scope.accountKey) :
      { data: [], error: null }
    if (readback.error || readback.data?.length !== projected.length ||
      sweepId && readback.data.some((row) => row.last_reconciled_sweep_id !== sweepId)) {
      throw new Error("LISTING_REGISTRY_DURABLE_READBACK_FAILED")
    }
    if (ownerConfirmation) {
      const linkedCase = readback.data?.find((row) =>
        row.case_id === ownerConfirmation?.caseId)
      if (!linkedCase || linkedCase.identity_status !== "LINKED_EXACT" ||
        !String(linkedCase.stockguard_link_status).startsWith("LINKED_") ||
        linkedCase.luna_product_id !== ownerConfirmation.candidate.productId ||
        linkedCase.luna_variant_id !== ownerConfirmation.candidate.variantId ||
        linkedCase.supplier_sku !== ownerConfirmation.candidate.sku ||
        !linkedCase.stockguard_authority_id) {
        throw new Error("LISTING_REGISTRY_OWNER_LINK_READBACK_UNPROVEN")
      }
      await recordOwnerReviewActionV1(supabase, {
        caseId: ownerConfirmation.caseId, itemId: body.ebayItemId!,
        sweepId: ownerConfirmation.sweepId, actorUserId: auth.userId!,
        action: "CONFIRM_EXACT_LINK", candidate: ownerConfirmation.candidate,
      })
    }
    if (newSweepId) {
      const completed = await supabase.from("seller_os_listing_registry_sweeps_v1")
        .update({ status: "COMPLETE", reconciled_item_count: projected.length,
          completed_at: new Date().toISOString() })
        .eq("sweep_id", newSweepId).eq("account_key", scope.accountKey)
        .eq("status", "PENDING").select("sweep_id").single()
      if (completed.error || !completed.data) {
        throw new Error("LISTING_REGISTRY_SWEEP_WRITE_FAILED")
      }
    }
    return NextResponse.json({ success: true, cases: readback.data,
      reconciliationCount: projected.length,
      durableReadback: "PASS", currentLiveCertified:
        body.action === "reconcile_current_live",
      safety: { ebayWrites: 0, inventoryQuantityWrites: 0,
        stockguardLinkageMayWrite: body.action === "link_existing" ||
          body.action === "confirm_exact_link" } },
    { headers })
  } catch (error) { return fail(safeError(error)) }
}
