export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { readManualListingFromTradingApi } from
  "@/lib/ebay/ebay-manual-listing-trading-readonly"
import { materializeCanonicalLunaOpportunityIdentityV1 } from
  "@/lib/ebay/ebay-luna-opportunity-identity-v1"
import { ensureStockguardAuthorityFromDecisionP0 } from
  "@/lib/ebay/stockguard-listing-link-authority-p0"
import { readProductionStockGuardV1 } from
  "@/lib/ebay/ebay-production-stock-read-service-v1"
import { refreshStockAfterExactLinkV1 } from
  "@/lib/ebay/stockguard-post-link-refresh-v1"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"

const headers = { "Cache-Control": "private, no-store, max-age=0" }
const safeSearch = (value: string) => !value || /^[A-Za-z0-9][A-Za-z0-9 _-]{0,79}$/.test(value)
const officialThumbnail = (value: unknown) => typeof value === "string" &&
  /^https:\/\/i\.ebayimg\.com\/images\/[A-Za-z0-9/_-]+\.(?:png|jpe?g|webp)$/.test(value)
  ? value : null
const supplierImage = (value: unknown) => typeof value === "string" &&
  /^https:\/\/cdn\.shopify\.com\/s\/files\/1\/0798\/2520\/7520\//.test(value)
  ? value : null
const rpcBlocker = (value: unknown) => {
  const message = value && typeof value === "object" && "message" in value
    ? String(value.message) : ""
  return message.match(/\b(LISTING_OWNER_[A-Z0-9_]{3,110})\b/)?.[1] ??
    "MANUAL_IDENTITY_DURABLE_RECEIPT_FAILED"
}

function failure(error: string, status = 409, trace?: {
  requestTraceId: string | null; failedStage: string; linkReceiptId?: string | null }) {
  return NextResponse.json({ success: false, error,
    ...(trace ? { ...trace, httpStatus: status } : {}),
    safety: { ebayWrites: 0, quantityWrites: 0, publication: 0 } },
  { status, headers })
}

export async function GET(request: Request) {
  const auth = await validateAdminApiRequest(request)
  if (!auth.ok) return failure(auth.error ?? "ADMIN_FORBIDDEN", auth.status || 403)
  const url = new URL(request.url)
  const itemId = url.searchParams.get("itemId") ?? ""
  const query = (url.searchParams.get("q") ?? "").trim()
  if (!/^\d{9,20}$/.test(itemId) || !safeSearch(query)) {
    return failure("MANUAL_IDENTITY_SEARCH_INPUT_INVALID", 400)
  }
  const scope = getEbaySellerAccountScopeConfiguration()
  if (!scope.accountKey) return failure("LISTING_REGISTRY_ACCOUNT_SCOPE_REQUIRED", 503)
  try {
    const supabase = getSupabaseAdminClient()
    const sweep = await supabase.from("seller_os_listing_registry_sweeps_v1")
      .select("sweep_id,official_observed_at,status")
      .eq("account_key", scope.accountKey).eq("marketplace_id", "EBAY_US")
      .eq("status", "COMPLETE").order("completed_at", { ascending: false })
      .limit(1).maybeSingle()
    const target = sweep.data ? await supabase.from("seller_os_listing_cases_v1")
      .select("ebay_item_id,ebay_title,ebay_image_url,ebay_custom_label,listing_status,last_reconciled_sweep_id")
      .eq("account_key", scope.accountKey).eq("marketplace_id", "EBAY_US")
      .eq("ebay_item_id", itemId).eq("last_reconciled_sweep_id", sweep.data.sweep_id)
      .maybeSingle() : null
    if (sweep.error || target?.error) throw new Error("MANUAL_IDENTITY_TARGET_READ_FAILED")
    if (!sweep.data || !target?.data || target.data.listing_status !== "ACTIVE") {
      return failure("MANUAL_IDENTITY_CURRENT_LIVE_TARGET_REQUIRED", 409)
    }
    const escaped = query.replace(/[\\%_,()]/g, " ").replace(/\s+/g, " ").trim()
    const search = escaped ? await supabase.from("market_radar_latest_variants")
      .select("supplier_product_id,supplier_variant_id,sku,title,variant_title,product_url,featured_image_url,image_urls,available,inventory_quantity,captured_at")
      .eq("source_key", "lunaportex")
      .or(`sku.ilike.%${escaped}%,supplier_product_id.eq.${escaped},supplier_variant_id.eq.${escaped},title.ilike.%${escaped}%`)
      .order("captured_at", { ascending: false }).limit(20) : { data: [], error: null }
    if (search.error) throw new Error("MANUAL_IDENTITY_LUNA_SEARCH_FAILED")
    const productIds = [...new Set((search.data ?? []).map((row) =>
      row.supplier_product_id))]
    const [claimRead, opportunityRead] = productIds.length ? await Promise.all([
      supabase.from("seller_os_luna_linkage_decisions")
        .select("decision_id,ebay_item_id,luna_product_id,luna_variant_id,luna_sku")
        .eq("account_key", scope.accountKey).eq("marketplace_id", "EBAY_US")
        .eq("decision", "APPROVE_EXACT_LINKAGE")
        .neq("ebay_item_id", itemId).in("luna_product_id", productIds)
        .limit(100),
      supabase.from("ebay_luna_opportunity_queue")
        .select("id,supplier_product_id,supplier_variant_id,supplier_sku")
        .in("supplier_product_id", productIds).limit(100),
    ]) : [{ data: [], error: null }, { data: [], error: null }]
    if (claimRead.error || opportunityRead.error ||
        (claimRead.data?.length ?? 0) >= 100 ||
        (opportunityRead.data?.length ?? 0) >= 100) {
      throw new Error("MANUAL_IDENTITY_CONFLICT_READ_FAILED")
    }
    const claimedItemIds = [...new Set((claimRead.data ?? []).map((row) =>
      row.ebay_item_id))]
    const [conflictCases, quarantines] = claimedItemIds.length
      ? await Promise.all([
        supabase.from("seller_os_listing_cases_v1")
          .select("ebay_item_id,ebay_title,ebay_image_url,ebay_custom_label,listing_status")
          .eq("account_key", scope.accountKey).eq("marketplace_id", "EBAY_US")
          .in("ebay_item_id", claimedItemIds).limit(100),
        supabase.from("seller_os_listing_identity_quarantines_v1")
          .select("ebay_item_id,reason_code,quarantine_state,conflicting_item_ids")
          .eq("account_key", scope.accountKey).eq("marketplace_id", "EBAY_US")
          .in("ebay_item_id", claimedItemIds).limit(100),
      ]) : [{ data: [], error: null }, { data: [], error: null }]
    if (conflictCases.error || quarantines.error) {
      throw new Error("MANUAL_IDENTITY_CONFLICT_READ_FAILED")
    }
    const candidates = (search.data ?? []).map((row) => ({
      productId: row.supplier_product_id,
      variantId: row.supplier_variant_id,
      sku: row.sku,
      title: row.title,
      variantTitle: row.variant_title,
      imageUrl: supplierImage(row.featured_image_url) ??
        supplierImage(Array.isArray(row.image_urls) ? row.image_urls[0] : null),
      productUrl: row.product_url,
      stockAvailability: row.available === true ? "IN_STOCK" :
        row.available === false ? "OUT_OF_STOCK" : "UNKNOWN",
      stockQuantity: Number.isFinite(Number(row.inventory_quantity)) &&
        row.inventory_quantity !== null ? Number(row.inventory_quantity) : null,
      stockObservedAt: row.captured_at,
      existingOpportunityId: (opportunityRead.data ?? []).find((entry) =>
        entry.supplier_product_id === row.supplier_product_id &&
        entry.supplier_variant_id === row.supplier_variant_id &&
        entry.supplier_sku === row.sku)?.id ?? null,
      conflictingRelationship: (() => {
        const claim = (claimRead.data ?? []).find((entry) =>
          entry.luna_product_id === row.supplier_product_id &&
          entry.luna_variant_id === row.supplier_variant_id &&
          entry.luna_sku === row.sku)
        if (!claim) return null
        const old = (conflictCases.data ?? []).find((entry) =>
          entry.ebay_item_id === claim.ebay_item_id)
        const quarantine = (quarantines.data ?? []).find((entry) =>
          entry.ebay_item_id === claim.ebay_item_id)
        return { itemId: claim.ebay_item_id,
          title: old?.ebay_title ?? null,
          imageUrl: officialThumbnail(old?.ebay_image_url),
          customLabel: old?.ebay_custom_label ?? null,
          status: old?.listing_status ?? "UNKNOWN",
          supplierSku: claim.luna_sku,
          productId: claim.luna_product_id,
          variantId: claim.luna_variant_id,
          decisionId: claim.decision_id,
          reasonCode: quarantine?.reason_code ?? "SUPPLIER_TUPLE_ALREADY_CLAIMED",
          supersessionEligible: quarantine?.quarantine_state === "ACTIVE" &&
            quarantine.reason_code === "CONTRADICTED_SUPPLIER_IDENTITY" &&
            quarantine.conflicting_item_ids.includes(itemId) }
      })(),
    }))
    return NextResponse.json({ success: true, item: {
      itemId: target.data.ebay_item_id, title: target.data.ebay_title,
      imageUrl: officialThumbnail(target.data.ebay_image_url),
      customLabel: target.data.ebay_custom_label,
      status: target.data.listing_status,
    }, candidates, bounded: true, limit: 20,
      safety: { ebayWrites: 0, quantityWrites: 0, publication: 0 } }, { headers })
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : "MANUAL_IDENTITY_SEARCH_FAILED"
    return failure(code, 503)
  }
}

export async function POST(request: Request) {
  const suppliedTraceId = request.headers.get("X-Request-Trace-Id")
  const requestTraceId = suppliedTraceId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(suppliedTraceId) ? suppliedTraceId.toLowerCase() : null
  let failedStage = "API_ROUTE"
  let tracedItemId: string | null = null
  let linkReceiptId: string | null = null
  const traceLog = (stage: string, blocker?: string) => console.info(JSON.stringify({
    event: "MANUAL_IDENTITY_CONFIRMATION_V1", requestTraceId,
    itemId: tracedItemId, stage, ...(blocker ? { blocker } : {}) }))
  const failAt = (code: string, status = 409, stage = failedStage) => {
    traceLog(stage, code)
    return failure(code, status, { requestTraceId, failedStage: stage,
      linkReceiptId })
  }
  const auth = await validateAdminApiRequest(request)
  if (!auth.ok) return failAt(auth.error ?? "ADMIN_FORBIDDEN",
    auth.status || 403, "OWNER_AUTHORIZATION")
  if (!auth.userId) return failAt("LISTING_REGISTRY_OWNER_REQUIRED", 403,
    "OWNER_AUTHORIZATION")
  let body: Record<string, unknown>
  try { body = await request.json() as Record<string, unknown> } catch {
    return failAt("MANUAL_IDENTITY_DECISION_INPUT_INVALID", 400, "API_VALIDATION")
  }
  const itemId = String(body.itemId ?? "")
  tracedItemId = /^\d{9,20}$/.test(itemId) ? itemId : null
  const action = String(body.action ?? "")
  if (!/^\d{9,20}$/.test(itemId) ||
      !["CONFIRM_EXACT_LUNA_LINK", "CONFIRM_SUPERSESSION",
        "KEEP_UNLINKED_NO_SOURCE_YET",
        "REJECT_CANDIDATE", "REVIEW_CONFLICT"].includes(action)) {
    return failAt("MANUAL_IDENTITY_DECISION_INPUT_INVALID", 400, "API_VALIDATION")
  }
  if (["CONFIRM_EXACT_LUNA_LINK", "CONFIRM_SUPERSESSION"].includes(action) &&
      (!requestTraceId || body.requestTraceId !== requestTraceId)) {
    return failAt("MANUAL_IDENTITY_REQUEST_TRACE_REQUIRED", 400,
      "API_VALIDATION")
  }
  traceLog("API_ROUTE_RECEIVED")
  const scope = getEbaySellerAccountScopeConfiguration()
  if (!scope.accountKey || !scope.accountAlias) {
    return failAt("LISTING_REGISTRY_ACCOUNT_SCOPE_REQUIRED", 503,
      "SERVICE_ROLE_BINDING")
  }
  const supabase = getSupabaseAdminClient()
  try {
    failedStage = "CURRENT_LIVE_TARGET"
    const sweep = await supabase.from("seller_os_listing_registry_sweeps_v1")
      .select("sweep_id,status").eq("account_key", scope.accountKey)
      .eq("marketplace_id", "EBAY_US").eq("status", "COMPLETE")
      .order("completed_at", { ascending: false }).limit(1).maybeSingle()
    const target = sweep.data ? await supabase.from("seller_os_listing_cases_v1")
      .select("case_id,ebay_item_id,ebay_custom_label,ebay_title,listing_status,last_reconciled_sweep_id")
      .eq("account_key", scope.accountKey).eq("marketplace_id", "EBAY_US")
      .eq("ebay_item_id", itemId).eq("last_reconciled_sweep_id", sweep.data.sweep_id)
      .maybeSingle() : null
    if (sweep.error || target?.error) throw new Error("MANUAL_IDENTITY_TARGET_READ_FAILED")
    if (!sweep.data || !target?.data || target.data.listing_status !== "ACTIVE") {
      return failAt("MANUAL_IDENTITY_CURRENT_LIVE_TARGET_REQUIRED")
    }

    if (!["CONFIRM_EXACT_LUNA_LINK", "CONFIRM_SUPERSESSION"].includes(action)) {
      if (action === "REJECT_CANDIDATE" &&
          (!/^\d{1,30}$/.test(String(body.productId ?? "")) ||
           !/^\d{1,30}$/.test(String(body.variantId ?? "")) ||
           !/^[A-Za-z0-9._-]{1,120}$/.test(String(body.sku ?? "")))) {
        return failAt("MANUAL_IDENTITY_REJECT_CANDIDATE_REQUIRED", 400)
      }
      if (action === "KEEP_UNLINKED_NO_SOURCE_YET") {
        const active = await supabase.from("seller_os_listing_product_link_authorities_v1")
          .select("authority_id").eq("account_key", scope.accountKey)
          .eq("marketplace_id", "EBAY_US").eq("ebay_item_id", itemId)
          .eq("lifecycle_state", "ACTIVE").limit(1)
        if (active.error) throw new Error("MANUAL_IDENTITY_AUTHORITY_READ_FAILED")
        if (active.data?.length) return failAt("MANUAL_IDENTITY_ALREADY_PROVEN")
      }
      const currentState = { action, marketplaceId: "EBAY_US", ebayItemId: itemId,
        reviewSweepId: sweep.data.sweep_id, actorUserId: auth.userId,
        candidateProductId: action === "REJECT_CANDIDATE" ? String(body.productId) : null,
        candidateVariantId: action === "REJECT_CANDIDATE" ? String(body.variantId) : null,
        candidateSku: action === "REJECT_CANDIDATE" ? String(body.sku) : null }
      const saved = await supabase.from("seller_os_listing_case_events_v1")
        .insert({ case_id: target.data.case_id, event_type: "OWNER_REVIEW_ACTION",
          previous_state: null, current_state: currentState }).select("event_id").single()
      if (saved.error || !saved.data) throw new Error("MANUAL_IDENTITY_KEEP_UNLINKED_WRITE_FAILED")
      const readback = await supabase.from("seller_os_listing_case_events_v1")
        .select("case_id,event_type,current_state").eq("event_id", saved.data.event_id).single()
      if (readback.error || readback.data?.case_id !== target.data.case_id ||
          readback.data?.event_type !== "OWNER_REVIEW_ACTION" ||
          JSON.stringify(readback.data.current_state) !== JSON.stringify(currentState)) {
        throw new Error("MANUAL_IDENTITY_KEEP_UNLINKED_READBACK_FAILED")
      }
      return NextResponse.json({ success: true, action, eventId: saved.data.event_id,
        durableReadback: "PASS", supplierLinkage: "UNPROVEN",
        safety: { ebayWrites: 0, quantityWrites: 0, publication: 0 } }, { headers })
    }

    if (body.confirmation !== (action === "CONFIRM_SUPERSESSION"
          ? "CONFIRM SUPERSESSION" : "CONFIRM EXACT LUNA LINK") ||
        !/^\d{1,30}$/.test(String(body.productId ?? "")) ||
        !/^\d{1,30}$/.test(String(body.variantId ?? "")) ||
        !/^[A-Za-z0-9._-]{1,120}$/.test(String(body.sku ?? ""))) {
      return failAt("MANUAL_IDENTITY_EXPLICIT_CONFIRMATION_REQUIRED", 400,
        "API_VALIDATION")
    }
    const identity = { productId: String(body.productId),
      variantId: String(body.variantId), sku: String(body.sku) }
    const competing = await supabase.from("seller_os_luna_linkage_decisions")
      .select("ebay_item_id,decision_id")
      .eq("account_key", scope.accountKey).eq("marketplace_id", "EBAY_US")
      .eq("decision", "APPROVE_EXACT_LINKAGE")
      .eq("luna_product_id", identity.productId)
      .eq("luna_variant_id", identity.variantId)
      .eq("luna_sku", identity.sku)
      .neq("ebay_item_id", itemId).limit(3)
    if (competing.error || (competing.data?.length ?? 0) >= 3) {
      throw new Error("MANUAL_IDENTITY_SUPPLIER_CLAIM_READ_FAILED")
    }
    if (competing.data?.length && action !== "CONFIRM_SUPERSESSION") {
      return failAt("MANUAL_IDENTITY_SUPERSESSION_CONFIRMATION_REQUIRED", 409,
        "API_VALIDATION")
    }
    if (action === "CONFIRM_SUPERSESSION") {
      const oldId = String(body.supersedeItemId ?? "")
      if (competing.data?.length !== 1 ||
          competing.data[0].ebay_item_id !== oldId) {
        return failAt("MANUAL_IDENTITY_EXACT_CONFLICT_REQUIRED", 409,
          "API_VALIDATION")
      }
      const quarantine = await supabase
        .from("seller_os_listing_identity_quarantines_v1")
        .select("reason_code,quarantine_state,conflicting_item_ids")
        .eq("account_key", scope.accountKey).eq("marketplace_id", "EBAY_US")
        .eq("ebay_item_id", oldId).maybeSingle()
      if (quarantine.error || quarantine.data?.quarantine_state !== "ACTIVE" ||
          quarantine.data.reason_code !== "CONTRADICTED_SUPPLIER_IDENTITY" ||
          !quarantine.data.conflicting_item_ids.includes(itemId)) {
        return failAt("MANUAL_IDENTITY_CONTRADICTED_SOURCE_QUARANTINE_REQUIRED",
          409, "API_VALIDATION")
      }
    }
    failedStage = "OFFICIAL_GET_ITEM_VERIFICATION"
    const observed = await readManualListingFromTradingApi(itemId)
    if (observed.ownership !== "verified" || observed.itemId !== itemId ||
        observed.listingStatus?.toLowerCase() !== "active" ||
        !["US", "0"].includes(observed.marketplaceSite ?? "") ||
        !observed.title || observed.availableQuantity === null ||
        observed.price === null || !observed.currency) {
      return failAt("MANUAL_IDENTITY_OFFICIAL_EBAY_READ_REQUIRED", 409)
    }
    traceLog("OFFICIAL_GET_ITEM_VERIFIED")
    failedStage = "LUNA_CANDIDATE_VALIDATION"
    const opportunity = await materializeCanonicalLunaOpportunityIdentityV1({
      supabase, identity: { marketplaceId: "EBAY_US",
        supplierProductId: identity.productId,
        supplierVariantId: identity.variantId, supplierSku: identity.sku },
    })
    traceLog("LUNA_CANDIDATE_VALIDATED")
    failedStage = "GUARDED_WRITE_RPC"
    const receiptCall = await supabase.rpc(
      "confirm_seller_os_listing_manual_identity_traced_v1", {
        p_request_trace_id: requestTraceId,
        p_account_key: scope.accountKey, p_ebay_item_id: itemId,
        p_opportunity_id: opportunity.opportunityId,
        p_luna_product_id: identity.productId,
        p_luna_variant_id: identity.variantId, p_luna_sku: identity.sku,
        p_official_observed_at: observed.observedAt,
        p_official_title: observed.title,
        p_official_custom_label: observed.ebaySku,
        p_official_quantity: observed.availableQuantity,
        p_official_price: observed.price,
        p_official_currency: observed.currency, p_actor_user_id: auth.userId,
      })
    const receipt = receiptCall.data as Record<string, unknown> | null
    if (receiptCall.error) throw new Error(rpcBlocker(receiptCall.error))
    if (receipt?.status !== "PROVEN" ||
        typeof receipt.decisionId !== "string" ||
        receipt.requestTraceId !== requestTraceId ||
        receipt.linkReceiptId !== receipt.decisionId) {
      throw new Error("MANUAL_IDENTITY_DURABLE_RECEIPT_FAILED")
    }
    linkReceiptId = receipt.decisionId
    traceLog("DURABLE_RECEIPT_COMMITTED")
    failedStage = "DURABLE_RECEIPT_READBACK"
    const traceRead = await supabase.from(
      "seller_os_listing_manual_identity_request_traces_v1")
      .select("request_trace_id,link_receipt_id,account_key,marketplace_id,ebay_item_id,supplier_sku,product_id,variant_id")
      .eq("request_trace_id", requestTraceId).single()
    if (traceRead.error ||
        traceRead.data?.link_receipt_id !== linkReceiptId ||
        traceRead.data?.account_key !== scope.accountKey ||
        traceRead.data?.marketplace_id !== "EBAY_US" ||
        traceRead.data?.ebay_item_id !== itemId ||
        traceRead.data?.supplier_sku !== identity.sku ||
        traceRead.data?.product_id !== identity.productId ||
        traceRead.data?.variant_id !== identity.variantId) {
      throw new Error("MANUAL_IDENTITY_TRACE_RECEIPT_READBACK_FAILED")
    }
    traceLog("DURABLE_RECEIPT_READBACK_PASSED")
    failedStage = "STOCKGUARD_AUTOLINK"
    const authority = await ensureStockguardAuthorityFromDecisionP0({
      supabase, accountKey: scope.accountKey, ebayItemId: itemId,
      sourceDecisionId: receipt.decisionId,
      actorUserId: auth.userId, automatedDeterministic: false,
    })
    if (!authority.stockguardEligible ||
        authority.authority?.luna_product_id !== identity.productId ||
        authority.authority?.luna_variant_id !== identity.variantId ||
        authority.authority?.luna_sku !== identity.sku) {
      throw new Error("MANUAL_IDENTITY_STOCKGUARD_READBACK_FAILED")
    }
    traceLog("STOCKGUARD_MONITORING_ACTIVE")
    failedStage = "CANONICAL_READBACK"
    const readback = await readProductionStockGuardV1({ supabase,
      accountKey: scope.accountKey, accountAlias: scope.accountAlias,
      itemId, includeKnownListingStockEvidence: true })
    const canonical = readback.listings.find((row) => row.itemId === itemId)
    if (!canonical || canonical.supplierLinkage !== "CERTIFIED" ||
        canonical.components[0]?.supplierProductId !== identity.productId ||
        canonical.components[0]?.supplierVariantId !== identity.variantId ||
        canonical.components[0]?.supplierSku !== identity.sku) {
      throw new Error("CANONICAL_READBACK_FAILED")
    }
    traceLog("CANONICAL_READBACK_PASSED")
    failedStage = "INITIAL_STOCK_REFRESH"
    const postLinkStock = await refreshStockAfterExactLinkV1({ supabase,
      accountKey: scope.accountKey, accountAlias: scope.accountAlias, itemId })
    traceLog("INITIAL_STOCK_REFRESH_REQUESTED",
      postLinkStock.stockBlocker ?? undefined)
    traceLog("SUCCESS")
    return NextResponse.json({ success: true, action, receipt,
      requestTraceId, linkReceiptId, receiptId: receipt.decisionId,
      itemId,
      supplierIdentity: { sku: identity.sku,
        productId: identity.productId, variantId: identity.variantId },
      supplierLinkage: canonical.supplierLinkage,
      stockguardMonitoring: authority.authority?.lifecycle_state,
      stockFreshness: postLinkStock.stockFreshness,
      postLinkStock,
      limitationCode: postLinkStock.stockBlocker ?? canonical.limitationCode,
      canonicalReadback: "PASS",
      safety: { ebayWrites: 0, quantityWrites: 0, publication: 0, pricing: 0 } },
    { headers })
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : "MANUAL_IDENTITY_DECISION_FAILED"
    return failAt(code, 409)
  }
}
