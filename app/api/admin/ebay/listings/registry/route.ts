export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { getEbayCommercialMonitorLiveReadonly } from
  "@/lib/ebay/ebay-commercial-monitor-live-readonly"
import type { EbayLiveListing } from
  "@/lib/ebay/ebay-commercial-monitor-live-readonly-domain"
import { readManualListingFromTradingApi } from
  "@/lib/ebay/ebay-manual-listing-trading-readonly"
import { parseManualListingRegistrationInput } from
  "@/lib/ebay/ebay-manual-listing-domain"
import { registerManualEbayListing } from
  "@/lib/ebay/ebay-manual-listing-service"
import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
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
  return /^(LISTING_REGISTRY|MANUAL_LISTING)_[A-Z0-9_]+$/.test(code) ? code :
    "LISTING_REGISTRY_REQUEST_FAILED"
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
    const fresh = Boolean(sweep.data?.official_observed_at &&
      Date.now() - Date.parse(sweep.data.official_observed_at) <= 20 * 60_000 &&
      Date.parse(sweep.data.official_observed_at) - Date.now() <= 60_000 &&
      sweep.data.official_live_item_count === currentCases.length &&
      sweep.data.reconciled_item_count === currentCases.length)
    return NextResponse.json({ success: true, cases: cases.data ?? [],
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
      opportunityId?: string; confirmation?: string }
    const supabase = getSupabaseAdminClient()
    let evidence = await readListingRegistryEvidenceV1(supabase, scope.accountKey)
    const prior = await supabase.from("seller_os_listing_cases_v1")
      .select("ebay_item_id,origin").eq("account_key", scope.accountKey)
      .eq("marketplace_id", "EBAY_US").limit(1000)
    if (prior.error) throw new Error("LISTING_REGISTRY_READ_FAILED")
    if ((prior.data?.length ?? 0) >= 1000) {
      throw new Error("LISTING_REGISTRY_CASE_PAGINATION_REQUIRED")
    }
    const existingOrigins = Object.fromEntries((prior.data ?? []).map((row) =>
      [row.ebay_item_id, row.origin])) as Record<string, "SELLER_OS" | "MANUAL_EBAY" | "IMPORTED_LEGACY">
    let listings: EbayLiveListing[]
    let officialObservedAt: string | null = null
    if (body.action === "reconcile_current_live") {
      const live = await getEbayCommercialMonitorLiveReadonly({
        accountKey: scope.accountKey, accountAlias: scope.accountAlias,
      })
      if (live.account.status !== "CERTIFIED" ||
        live.discovery.coverage !== "COMPLETE" ||
        !live.discovery.sellerWideEnumeration.itemSetComplete ||
        !live.discovery.sellerWideEnumeration.identitySetComplete ||
        live.discovery.gapCodes.length ||
        !live.discovery.observedAt ||
        !Number.isFinite(Date.parse(live.discovery.observedAt)) ||
        Date.now() - Date.parse(live.discovery.observedAt) > 20 * 60_000 ||
        Date.parse(live.discovery.observedAt) - Date.now() > 60_000 ||
        live.discovery.currentLiveListings.some((listing) =>
          !["US_CERTIFIED", "NON_US_CERTIFIED"].includes(
            listing.marketplaceCertification.status))) {
        return fail("LISTING_REGISTRY_OFFICIAL_LIVE_COVERAGE_UNPROVEN", 409)
      }
      listings = live.discovery.currentLiveListings.filter((listing) =>
        listing.marketplaceCertification.status === "US_CERTIFIED")
      officialObservedAt = live.discovery.observedAt
    } else if (body.action === "link_existing") {
      if (!auth.userId) return fail("LISTING_REGISTRY_OWNER_REQUIRED", 403)
      if (body.confirmation !== "VINCULAR_IDENTIDAD_CANONICA") {
        return fail("LISTING_REGISTRY_OWNER_CONFIRMATION_REQUIRED", 400)
      }
      if (!/^\d{9,20}$/.test(body.ebayItemId ?? "") ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(body.opportunityId ?? "")) {
        return fail("LISTING_REGISTRY_LINK_INPUT_INVALID", 400)
      }
      const previous = await supabase.from("seller_os_listing_cases_v1")
        .select("ebay_item_id,ebay_custom_label,ebay_observed_at,origin")
        .eq("account_key", scope.accountKey).eq("marketplace_id", "EBAY_US")
        .eq("ebay_item_id", body.ebayItemId!).maybeSingle()
      if (previous.error || !previous.data ||
        !previous.data.ebay_custom_label ||
        Date.now() - Date.parse(previous.data.ebay_observed_at) > 20 * 60_000) {
        return fail("LISTING_REGISTRY_FRESH_IMPORTED_CASE_REQUIRED", 409)
      }
      const input = parseManualListingRegistrationInput({
        ebayItemId: body.ebayItemId, opportunityId: body.opportunityId,
      })
      const linked = await registerManualEbayListing(supabase, input, auth.userId)
      const verification = linked.verification
      const snapshot = verification.connectorListingSnapshot
      if (verification.status !== "verified" ||
        !verification.connectorObservedAt || !verification.connectorEbaySku ||
        !snapshot) {
        return fail("LISTING_REGISTRY_EXACT_LINK_UNPROVEN", 409)
      }
      evidence = await readListingRegistryEvidenceV1(supabase, scope.accountKey)
      listings = [{ itemId: body.ebayItemId!, sku: verification.connectorEbaySku,
        customLabel: verification.connectorEbaySku, variationKey: null,
        title: snapshot.title, primaryImageUrl: null, listingState: "ACTIVE",
        listingFormat: null, startTime: null,
        availableQuantity: snapshot.availableQuantity, price: snapshot.price,
        currency: snapshot.currency, marketplaceSite: "US",
        marketplaceCertification: { status: "US_CERTIFIED", source: "EBAY_TRADING_GET_ITEM",
          observedAt: verification.connectorObservedAt }, identityAmbiguous: false,
        source: "EBAY_TRADING_GET_MY_EBAY_SELLING",
        observedAt: verification.connectorObservedAt }]
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
      listings, ...evidence, existingOrigins,
      manualImportItemIds: body.action === "import_existing" ? [body.ebayItemId!] : [] })
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
    const sweepId = sweepStart?.data?.sweep_id as string | undefined
    const saved = await persistListingCasesV1(supabase, projected, sweepId)
    const ids = saved.map((row) => row.case_id as string)
    const readback = ids.length ? await supabase.from("seller_os_listing_cases_v1")
      .select("*").in("case_id", ids).eq("account_key", scope.accountKey) :
      { data: [], error: null }
    if (readback.error || readback.data?.length !== projected.length ||
      sweepId && readback.data.some((row) => row.last_reconciled_sweep_id !== sweepId)) {
      throw new Error("LISTING_REGISTRY_DURABLE_READBACK_FAILED")
    }
    if (sweepId) {
      const completed = await supabase.from("seller_os_listing_registry_sweeps_v1")
        .update({ status: "COMPLETE", reconciled_item_count: projected.length,
          completed_at: new Date().toISOString() })
        .eq("sweep_id", sweepId).eq("account_key", scope.accountKey)
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
        stockguardLinkageMayWrite: body.action === "link_existing" } },
    { headers })
  } catch (error) { return fail(safeError(error)) }
}
