import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import { readProductionStockGuardV1 } from "./ebay-production-stock-read-service-v1"
import { getEbayTradingReadOnlyAccessToken,
  readManualListingFromTradingApi, tradingXmlTagValue } from
  "./ebay-manual-listing-trading-readonly"
import { operationalUsMarketplaceFromOfficialSiteV1 } from
  "./seller-os-listing-registry-v1"

export const STOCKGUARD_OUT_OF_STOCK_PROTECTION_V1 =
  "STOCKGUARD_OUT_OF_STOCK_PROTECTION_V1" as const

type CanonicalRow = Awaited<ReturnType<typeof readProductionStockGuardV1>>["listings"][number]
type StockReceipt = {
  observation_id: string; account_key: string; ebay_item_id: string;
  luna_sku: string; luna_product_id: string; luna_variant_id: string | null;
  observation_state: string; source_status: string;
  observed_availability: boolean | null;
  evidence_class: string; acquisition_method: string;
  limitations: string[]; observed_at: string; maximum_age_seconds: number;
}
type FetchLike = typeof fetch

export function evaluateStockguardOosTriggerV1(input: {
  cohortComplete: boolean; currentLiveState: string;
  row: CanonicalRow | null; receipt: StockReceipt | null;
  accountKey: string; now: Date;
}) {
  const row = input.row
  const component = row?.components.length === 1 ? row.components[0] : null
  const receipt = input.receipt
  if (!input.cohortComplete || input.currentLiveState !== "CURRENT_FRESH")
    return "CURRENT_LIVE_COHORT_UNPROVEN"
  if (!row || row.liveStatus !== "LIVE_ACTIVE" ||
      row.supplierLinkage !== "CERTIFIED" || !component ||
      !component.supplierSku || !component.supplierProductId ||
      !component.supplierVariantId || row.identityQuarantine ||
      row.conflictingSupplierItemIds.length > 0)
    return "EXACT_CERTIFIED_SUPPLIER_LINK_REQUIRED"
  if (row.stockFreshness !== "FRESH" || !row.stockFreshUntil ||
      Date.parse(row.stockFreshUntil) <= input.now.getTime())
    return "FRESH_STOCK_EVIDENCE_REQUIRED"
  if (row.stockGuardState !== "CERTIFIED_OOS" ||
      row.supplierAvailability !== "OUT_OF_STOCK")
    return "EXPLICIT_PROVEN_OUT_OF_STOCK_REQUIRED"
  if (!receipt || receipt.account_key !== input.accountKey ||
      receipt.ebay_item_id !== row.itemId ||
      receipt.luna_sku !== component.supplierSku ||
      receipt.luna_product_id !== component.supplierProductId ||
      receipt.luna_variant_id !== component.supplierVariantId ||
      receipt.observation_state !== "OBSERVED_OUT_OF_STOCK" ||
      receipt.source_status !== "AVAILABLE" ||
      receipt.observed_availability !== false ||
      receipt.evidence_class !== "SUPPLIER_STATED" ||
      !["CANONICAL_SERVER_READ", "CANONICAL_BROWSER_AUTOMATION"]
        .includes(receipt.acquisition_method) ||
      !Array.isArray(receipt.limitations) ||
      !receipt.limitations.includes("PUBLIC_EXACT_CERTIFIED_OOS") ||
      !row.stockObservedAt ||
      Date.parse(receipt.observed_at) !== Date.parse(row.stockObservedAt) ||
      Date.parse(receipt.observed_at) > input.now.getTime() ||
      Date.parse(receipt.observed_at) +
        Number(receipt.maximum_age_seconds) * 1000 <= input.now.getTime())
    return "EXACT_DURABLE_OOS_SOURCE_RECEIPT_REQUIRED"
  return null
}

export function classifyStockguardOosReadbackV1(input: {
  writeAccepted: boolean; beforeItemId: string; afterItemId: string | null;
  beforeSku: string; afterSku: string | null;
  beforeTitle: string | null; afterTitle: string | null;
  afterOwnership: string; afterQuantity: number | null;
}) {
  return input.writeAccepted && input.afterOwnership === "verified" &&
    input.afterItemId === input.beforeItemId &&
    input.afterSku === input.beforeSku &&
    input.afterTitle === input.beforeTitle &&
    input.afterQuantity === 0
    ? "APPLIED_CONFIRMED" as const
    : "PROTECTION_WRITE_UNCONFIRMED" as const
}

export function stockguardOosActionFromOfficialQuantityV1(quantity: number | null) {
  return quantity === 0 ? "NO_OP" as const :
    quantity !== null && Number.isSafeInteger(quantity) && quantity > 0
      ? "WRITE_ZERO" as const : "BLOCKED" as const
}

export function projectStockguardOosProtectionStatusV1(input: {
  receiptStatus: string | null; freshness: string;
  supplierAvailability: string;
}) {
  const confirmed = input.receiptStatus === "APPLIED_CONFIRMED" ||
    input.receiptStatus === "NO_OP_CONFIRMED"
  return confirmed && input.freshness === "FRESH" &&
      input.supplierAvailability === "IN_STOCK"
    ? "RESTOCK_REVIEW_REQUIRED" : confirmed
      ? "PROTECTED_OUT_OF_STOCK" :
        input.receiptStatus ?? "NOT_PROTECTED"
}

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^STOCKGUARD_OOS_[A-Z0-9_]+$/.test(code)
    ? code : "STOCKGUARD_OOS_OFFICIAL_WRITE_OR_READBACK_FAILED"
}

async function tradingCall(input: { token: string; siteId: "0" | "100";
  call: "GetUserPreferences" | "ReviseInventoryStatus"; body: string;
  fetchImpl: FetchLike }) {
  const response = await input.fetchImpl("https://api.ebay.com/ws/api.dll", {
    method: "POST", headers: { "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": input.call,
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1423",
      "X-EBAY-API-SITEID": input.siteId,
      "X-EBAY-API-IAF-TOKEN": input.token },
    body: input.body, cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  })
  const xml = await response.text()
  if (!response.ok || !["success", "warning"].includes(
    tradingXmlTagValue(xml, "Ack")?.toLowerCase() ?? "")) {
    throw new Error("STOCKGUARD_OOS_OFFICIAL_CALL_REJECTED")
  }
  return xml
}

async function protectOne(input: { supabase: SupabaseClient; accountKey: string;
  accountAlias: string; row: CanonicalRow; receipt: StockReceipt;
  fetchImpl: FetchLike }) {
  const golden = await input.supabase.from("seller_os_golden_managed_listings_v1")
    .select("marketplace_actions_enabled").eq("account_key", input.accountKey)
    .eq("ebay_item_id", input.row.itemId).limit(1).maybeSingle()
  // Fail closed if management policy cannot be read. Golden Path is monitor-only.
  if (golden.error || golden.data?.marketplace_actions_enabled === false) {
    return { itemId: input.row.itemId, status: "BLOCKED" as const,
      blocker: golden.error ? "STOCKGUARD_OOS_MANAGEMENT_POLICY_UNPROVEN"
        : "STOCKGUARD_OOS_GOLDEN_PATH_MONITOR_ONLY",
      ebayWriteCount: 0 as const }
  }
  const component = input.row.components[0]
  const idempotencyKey = `stockguard-oos-v1:sha256:${createHash("sha256")
    .update(JSON.stringify([input.accountKey, "EBAY_US", input.row.itemId,
      component.supplierSku, component.supplierProductId,
      component.supplierVariantId, input.receipt.observation_id]))
    .digest("hex")}`
  const before = await readManualListingFromTradingApi(input.row.itemId,
    input.fetchImpl)
  const site = operationalUsMarketplaceFromOfficialSiteV1(before.marketplaceSite)
  if (before.ownership !== "verified" || before.itemId !== input.row.itemId ||
      before.ebaySku !== input.row.sku ||
      before.listingStatus?.toLowerCase() !== "active" ||
      before.saleFormat !== "FixedPriceItem" ||
      before.variationCount !== 0 ||
      before.availableQuantity === null ||
      site.siteCertificationStatus !== "PROVEN") {
    return { itemId: input.row.itemId, status: "BLOCKED" as const,
      blocker: "STOCKGUARD_OOS_OFFICIAL_EXACT_ITEM_OR_FORMAT_UNPROVEN",
      ebayWriteCount: 0 as const }
  }
  const { data: prior, error: priorError } = await input.supabase
    .from("seller_os_stockguard_oos_protection_v1")
    .select("receipt_id,protection_status")
    .eq("idempotency_key", idempotencyKey).maybeSingle()
  if (priorError) throw new Error("STOCKGUARD_OOS_RECEIPT_READ_FAILED")
  if (prior) {
    if (before.availableQuantity === 0 &&
        !["APPLIED_CONFIRMED", "NO_OP_CONFIRMED"].includes(
          prior.protection_status)) {
      const { data: reconciled, error: reconcileError } = await input.supabase
        .from("seller_os_stockguard_oos_protection_v1")
        .update({ protection_status: "NO_OP_CONFIRMED",
          official_readback_quantity: 0,
          protection_confirmed_at: new Date().toISOString(),
          limitation_code: null })
        .eq("receipt_id", prior.receipt_id)
        .eq("protection_status", prior.protection_status)
        .select("receipt_id").maybeSingle()
      if (reconcileError || !reconciled) return { itemId: input.row.itemId,
        status: "BLOCKED" as const,
        blocker: "STOCKGUARD_OOS_NOOP_RECEIPT_RECONCILIATION_FAILED",
        ebayWriteCount: 0 as const }
      return { itemId: input.row.itemId,
        status: "NO_OP_CONFIRMED" as const,
        receiptId: reconciled.receipt_id, ebayWriteCount: 0 as const }
    }
    return { itemId: input.row.itemId,
      status: before.availableQuantity === 0 &&
        ["APPLIED_CONFIRMED", "NO_OP_CONFIRMED"].includes(prior.protection_status)
        ? "ALREADY_PROTECTED" as const : "BLOCKED" as const,
      blocker: before.availableQuantity === 0 ? null :
        "STOCKGUARD_OOS_EXISTING_ATTEMPT_REVIEW_REQUIRED",
      ebayWriteCount: 0 as const }
  }

  const attemptedAt = new Date().toISOString()
  const noOp = stockguardOosActionFromOfficialQuantityV1(
    before.availableQuantity) === "NO_OP"
  const { data: saved, error: saveError } = await input.supabase
    .from("seller_os_stockguard_oos_protection_v1").insert({
      seller_account: input.accountKey, marketplace: "EBAY_US",
      item_id: input.row.itemId, supplier_sku: component.supplierSku,
      product_id: component.supplierProductId,
      variant_id: component.supplierVariantId,
      source_stock_receipt_id: input.receipt.observation_id,
      source_stock_state: "EXPLICIT_PROVEN_OUT_OF_STOCK",
      source_observed_at: input.receipt.observed_at,
      source_fresh_until: input.row.stockFreshUntil,
      previous_official_quantity: before.availableQuantity,
      requested_quantity: 0, official_readback_quantity: noOp ? 0 : null,
      protection_attempted_at: attemptedAt,
      protection_confirmed_at: noOp ? attemptedAt : null,
      protection_status: noOp ? "NO_OP_CONFIRMED" : "PENDING",
      idempotency_key: idempotencyKey,
    }).select("receipt_id").single()
  if (saveError || !saved) return { itemId: input.row.itemId,
    status: "BLOCKED" as const,
    blocker: "STOCKGUARD_OOS_RECEIPT_CLAIM_FAILED",
    ebayWriteCount: 0 as const }
  if (noOp) return { itemId: input.row.itemId,
    status: "NO_OP_CONFIRMED" as const, receiptId: saved.receipt_id,
    ebayWriteCount: 0 as const }

  let dispatched = false
  try {
    const token = await getEbayTradingReadOnlyAccessToken(input.fetchImpl)
    const siteId = before.marketplaceSite?.toUpperCase() === "EBAYMOTORS"
      ? "100" as const : "0" as const
    const preference = await tradingCall({ token, siteId,
      call: "GetUserPreferences", fetchImpl: input.fetchImpl,
      body: "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
        "<GetUserPreferencesRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
        "<ShowOutOfStockControlPreference>true</ShowOutOfStockControlPreference>" +
        "</GetUserPreferencesRequest>" })
    if (tradingXmlTagValue(preference,
      "OutOfStockControlPreference")?.toLowerCase() !== "true") {
      throw new Error("STOCKGUARD_OOS_OUT_OF_STOCK_CONTROL_UNPROVEN")
    }
    // A later quarantine or conflicting LIVE tuple must stop the write even
    // when the earlier portfolio read and official GetItem both passed.
    const current = await readProductionStockGuardV1({ supabase: input.supabase,
      accountKey: input.accountKey, accountAlias: input.accountAlias,
      itemId: input.row.itemId, includeKnownListingStockEvidence: true })
    const currentRow = current.listings.find((entry) =>
      entry.itemId === input.row.itemId) ?? null
    if (evaluateStockguardOosTriggerV1({ cohortComplete: current.cohortComplete,
      currentLiveState: current.currentLiveState, row: currentRow,
      receipt: input.receipt, accountKey: input.accountKey, now: new Date() })) {
      throw new Error("STOCKGUARD_OOS_IDENTITY_OR_SOURCE_CHANGED_BEFORE_WRITE")
    }
    dispatched = true
    await tradingCall({ token, siteId,
      call: "ReviseInventoryStatus", fetchImpl: input.fetchImpl,
      body: "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
        "<ReviseInventoryStatusRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
        `<InventoryStatus><ItemID>${input.row.itemId}</ItemID>` +
        "<Quantity>0</Quantity></InventoryStatus>" +
        "</ReviseInventoryStatusRequest>" })
    const after = await readManualListingFromTradingApi(input.row.itemId,
      input.fetchImpl)
    const status = classifyStockguardOosReadbackV1({ writeAccepted: true,
      beforeItemId: before.itemId, afterItemId: after.itemId,
      beforeSku: before.ebaySku!, afterSku: after.ebaySku,
      beforeTitle: before.title, afterTitle: after.title,
      afterOwnership: after.ownership,
      afterQuantity: after.availableQuantity })
    if (status !== "APPLIED_CONFIRMED") {
      throw new Error("STOCKGUARD_OOS_OFFICIAL_READBACK_MISMATCH")
    }
    const { data: completed, error: completeError } = await input.supabase
      .from("seller_os_stockguard_oos_protection_v1")
      .update({ protection_status: status, official_readback_quantity: 0,
        protection_confirmed_at: new Date().toISOString() })
      .eq("receipt_id", saved.receipt_id).eq("protection_status", "PENDING")
      .select("receipt_id,protection_status,official_readback_quantity")
      .single()
    if (completeError || completed?.protection_status !== status ||
        completed.official_readback_quantity !== 0) {
      throw new Error("STOCKGUARD_OOS_RECEIPT_FINALIZE_FAILED")
    }
    return { itemId: input.row.itemId, status, receiptId: saved.receipt_id,
      ebayWriteCount: 1 as const }
  } catch (error) {
    const blocker = safeCode(error)
    const status = dispatched ? "PROTECTION_WRITE_UNCONFIRMED" :
      "PROTECTION_BLOCKED"
    await input.supabase.from("seller_os_stockguard_oos_protection_v1")
      .update({ protection_status: status,
        limitation_code: blocker })
      .eq("receipt_id", saved.receipt_id).eq("protection_status", "PENDING")
    return { itemId: input.row.itemId,
      status,
      blocker, alert: dispatched
        ? "STOCKGUARD_OOS_PROTECTION_REVIEW_REQUIRED" as const : null,
      receiptId: saved.receipt_id,
      ebayWriteCount: Number(dispatched) as 0 | 1 }
  }
}

export async function runStockguardOosQuantityProtectionV1(input: {
  supabase: SupabaseClient; accountKey: string; accountAlias: string;
  allowedItemIds?: readonly string[]; maxMarketplaceWrites?: number;
  fetchImpl?: FetchLike; now?: Date;
}) {
  const now = input.now ?? new Date()
  const stock = await readProductionStockGuardV1({ supabase: input.supabase,
    accountKey: input.accountKey, accountAlias: input.accountAlias,
    itemId: null, includeKnownListingStockEvidence: true, now })
  const maximumWrites = Math.max(0, Math.min(
    Math.trunc(input.maxMarketplaceWrites ?? 1), 1))
  const allowed = input.allowedItemIds ? new Set(input.allowedItemIds) : null
  const candidates = stock.listings.filter((row) =>
    (!allowed || allowed.has(row.itemId)) &&
    row.supplierLinkage === "CERTIFIED" &&
    row.stockGuardState === "CERTIFIED_OOS")
  const eligibleItemIds: string[] = []
  const blockedCandidates: Array<{ itemId: string; blocker: string }> = []
  const executions: Array<Awaited<ReturnType<typeof protectOne>>> = []
  let ebayWriteCount = 0
  for (const row of candidates) {
    const component = row.components.length === 1 ? row.components[0] : null
    const source = component ? await input.supabase
      .from("seller_os_luna_stock_observations")
      .select("observation_id,account_key,ebay_item_id,luna_sku,luna_product_id,luna_variant_id,observation_state,source_status,observed_availability,evidence_class,acquisition_method,limitations,observed_at,maximum_age_seconds")
      .eq("account_key", input.accountKey).eq("ebay_item_id", row.itemId)
      .eq("luna_sku", component.supplierSku)
      .eq("luna_product_id", component.supplierProductId)
      .eq("luna_variant_id", component.supplierVariantId)
      .order("observed_at", { ascending: false }).limit(1).maybeSingle()
      : { data: null, error: null }
    const blocker = source.error ? "EXACT_STOCK_RECEIPT_READ_FAILED" :
      evaluateStockguardOosTriggerV1({ cohortComplete: stock.cohortComplete,
        currentLiveState: stock.currentLiveState, row,
        receipt: source.data as StockReceipt | null,
        accountKey: input.accountKey, now })
    if (blocker) { blockedCandidates.push({ itemId: row.itemId, blocker }); continue }
    eligibleItemIds.push(row.itemId)
    if (ebayWriteCount >= maximumWrites) continue
    const result = await protectOne({ supabase: input.supabase,
      accountKey: input.accountKey, accountAlias: input.accountAlias, row,
      receipt: source.data as StockReceipt,
      fetchImpl: input.fetchImpl ?? fetch })
    executions.push(result)
    ebayWriteCount += result.ebayWriteCount
  }
  return { contractVersion: STOCKGUARD_OUT_OF_STOCK_PROTECTION_V1,
    status: !stock.cohortComplete ? "CURRENT_LIVE_COHORT_UNPROVEN" :
      executions.some((entry) => entry.status === "APPLIED_CONFIRMED")
        ? "APPLIED_CONFIRMED" : "NO_CONFIRMED_WRITE",
    eligibleItemIds, blockedCandidates, executions, ebayWriteCount,
    maximumMarketplaceWritesPerRun: maximumWrites,
    marketplaceOperation: "ReviseInventoryStatus.Quantity=0" as const,
    endItemWrites: 0 as const, automaticRestockWrites: 0 as const }
}
