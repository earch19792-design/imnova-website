import type { createProductCaseReadBudgetV1 } from "./product-case-read-budget-v1"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { SafeMarketplaceOrder } from "../marketplace/commercial-monitor-domain"
import { produceEbayFeeAuthorityV1, feeRecordV1 } from "./ebay-fee-producer-v1"
import { reconcileObservedEbayFeesV1 } from "./ebay-fee-reconciliation-v1"

const bindingColumns = "binding_key,marketplace_account_key,package_id,ebay_item_id,sku,input_revision,authority_id,state,updated_at"
type Scope = { supabase: SupabaseClient; accountKey: string }

/** Called inside the existing economics lane. No new scheduler or global scan. */
export async function persistProducedEbayFeeV1(input: Scope & { itemId: string | null; sku: string | null;
  packageId: string | null; context: unknown; resolutionInputs?: unknown; now: Date }) {
  if (!input.itemId && !input.packageId) throw Error("FEE_EXACT_BINDING_REQUIRED")
  const bindingKey = `${input.accountKey}:${input.packageId ? `package:${input.packageId}` : `item:${input.itemId}`}`
  const created = await input.supabase.from("seller_os_ebay_fee_bindings_v1").upsert({
    binding_key: bindingKey, marketplace_account_key: input.accountKey, package_id: input.packageId,
    ebay_item_id: input.itemId, sku: input.sku,
  }, { onConflict: "binding_key", ignoreDuplicates: true })
  if (created.error) throw Error("FEE_BINDING_CREATE_FAILED")
  const head = await input.supabase.from("seller_os_ebay_fee_bindings_v1").select(bindingColumns)
    .eq("marketplace_account_key", input.accountKey).eq("binding_key", bindingKey).single()
  if (head.error || !head.data || (head.data.ebay_item_id && head.data.ebay_item_id !== input.itemId) ||
      (head.data.sku && input.sku && head.data.sku !== input.sku)) throw Error("FEE_BINDING_CONFLICT")
  const authority = produceEbayFeeAuthorityV1(input)
  const written = await input.supabase.rpc("seller_os_record_fee_authority_v1", {
    p_binding_key: bindingKey, p_expected_updated_at: head.data.updated_at, p_authority: authority,
  })
  if (written.error || written.data !== true) throw Error("FEE_INPUT_CHANGED_RETRY")
  return authority
}

/** Package triggers queue pre-publication work. The existing economics lane
 * consumes at most two due packages; pending identity is a durable normal state. */
export async function runPendingPackageFeesV1(input: Scope & { now: Date }) {
  const read = await input.supabase.from("seller_os_ebay_fee_bindings_v1").select(bindingColumns)
    .eq("marketplace_account_key", input.accountKey).is("ebay_item_id", null)
    .lte("next_due_at", input.now.toISOString()).order("next_due_at").order("binding_key").limit(2)
  if (read.error) throw Error("FEE_PACKAGE_QUEUE_READ_FAILED")
  for (const row of read.data ?? []) {
    await persistProducedEbayFeeV1({ ...input, itemId: null, sku: row.sku, packageId: row.package_id,
      context: { packageData: row.input_revision, observedAt: input.now.toISOString() } })
  }
  return read.data?.length ?? 0
}

/** Read-only Mayel handoff. Newer pending/conflicting evidence invalidates an
 * older success. Actual fees remain a separate observation. */
export async function readEbayFeeHandoffV1(input: Scope & { itemId: string | null; packageId?: string | null; sku: string | null; now: Date; readBudget?: ReturnType<typeof createProductCaseReadBudgetV1> }) {
  type Query = ReturnType<Parameters<ReturnType<typeof createProductCaseReadBudgetV1>["read"]>[0]["query"]>
  const run = async <T extends Query>(q: T, authority: string): Promise<Awaited<T>> =>
    (input.readBudget ? await input.readBudget.read({ dependency: "FEE_HANDOFF", authority, query: () => q }) : await q) as Awaited<T>
  const unavailable = (state: "CONFLICT" | "STALE") => ({ authority: { state, feeEstimateMode: null,
    resolvedAuthority: null, amount: null }, label: state === "CONFLICT" ? "Economía: revisar identidad" : "Economía: actualizando evidencia",
    resolvedAuthority: null, actualPostSaleFee: null, reference: null, status: "STALE" })
  if (!input.itemId && !input.packageId) return null
  let query = input.supabase.from("seller_os_ebay_fee_bindings_v1").select(bindingColumns)
    .eq("marketplace_account_key", input.accountKey)
  query = input.packageId ? query.eq("package_id", input.packageId) : query.eq("ebay_item_id", input.itemId!)
  const heads = await run(query.limit(2), "seller_os_ebay_fee_bindings_v1")
  if (heads.error) return unavailable("STALE")
  if (!heads.data?.length) return null
  if (heads.data.length !== 1) return unavailable("CONFLICT")
  const h = heads.data[0]
  if ((input.itemId && h.ebay_item_id !== input.itemId) || (input.sku && h.sku !== input.sku)) return unavailable("CONFLICT")
  const a = h.authority_id ? await run(input.supabase.from("seller_os_ebay_fee_authorities_v1")
    .select("authority").eq("marketplace_account_key", input.accountKey).eq("authority_id", h.authority_id).limit(1).maybeSingle(), "seller_os_ebay_fee_authorities_v1") : null
  const authority = feeRecordV1(a?.data?.authority)
  const pending = h.state === "PENDING_ORDER_CONTEXT"
  const fresh = Date.parse(String(authority.freshUntil)) > input.now.getTime() && Date.parse(String(authority.observedAt)) <= input.now.getTime()
  const usable = !pending && h.state === "PROVEN_PRE_SALE" && fresh
  const actual = input.itemId ? await run(input.supabase.from("seller_os_ebay_fee_reconciliation_receipts_v1")
    .select("receipt").eq("marketplace_account_key", input.accountKey).eq("ebay_item_id", input.itemId)
    .eq("sku", input.sku ?? "").order("observed_at", { ascending: false }).order("receipt_id").limit(1).maybeSingle(), "seller_os_ebay_fee_reconciliation_receipts_v1") : null
  return { authority: { ...authority, state: pending ? "PENDING_ORDER_CONTEXT" : !fresh ? "STALE" : h.state,
    feeEstimateMode: typeof authority.feeEstimateMode === "string" ? authority.feeEstimateMode : null,
    resolvedAuthority: usable ? authority.resolvedAuthority : null, amount: usable ? authority.amount : null },
    label: usable ? "Economía: estimación disponible" : pending || fresh ? "Economía: esperando datos de la orden" : "Economía: actualizando evidencia",
    resolvedAuthority: usable ? authority.resolvedAuthority : null,
    actualPostSaleFee: actual?.error ? null : actual?.data?.receipt ?? null,
    reference: h.authority_id, status: usable ? "PROVEN" : pending || fresh ? "PENDING" : "STALE" }
}

export async function reconcileEbayOrderFeesV1(input: Scope & { order: SafeMarketplaceOrder; observedAt: string }) {
  const order = input.order
  if (!order.feeEvidence || order.lineItems.length !== 1 || order.lineItems[0].quantity !== 1) return { status: "PENDING_COMPARABLE_ORDER_EVIDENCE" }
  const line = order.lineItems[0]
  // Select by sale time, not observation time, so a later estimate can never
  // masquerade as the original pre-sale evidence.
  const read = await input.supabase.from("seller_os_ebay_fee_authorities_v1").select("authority")
    .eq("marketplace_account_key", input.accountKey).eq("ebay_item_id", line.listingId).eq("sku", line.sku ?? "")
    .lte("observed_at", order.creationDate).order("observed_at", { ascending: false }).order("authority_id").limit(1).maybeSingle()
  if (read.error) throw Error("FEE_PRE_SALE_HISTORY_READ_FAILED")
  const receipt = reconcileObservedEbayFeesV1({ ...input, preSaleAuthority: read.data?.authority })
  if (!receipt) return { status: "PENDING_OFFICIAL_FEE_TOTAL" }
  const write = await input.supabase.from("seller_os_ebay_fee_reconciliation_receipts_v1").upsert({
    receipt_id: receipt.receiptId, marketplace_account_key: input.accountKey, order_id: order.ebayOrderId,
    order_line_item_id: line.lineItemId, ebay_item_id: line.listingId, sku: line.sku,
    pre_sale_authority_id: receipt.preSaleAuthorityId, receipt, observed_at: input.observedAt, sold_at: order.creationDate,
  }, { onConflict: "receipt_id", ignoreDuplicates: true })
  if (write.error) throw Error("FEE_RECONCILIATION_RECEIPT_WRITE_FAILED")
  return { status: "RECORDED", receiptId: receipt.receiptId }
}
