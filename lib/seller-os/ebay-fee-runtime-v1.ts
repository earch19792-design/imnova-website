import { readSellingFeeTaxPolicyV1, retainedSellingFeeTaxPolicyV1 } from "../ebay/ebay-selling-fee-tax-policy-v1"
import type { createProductCaseReadBudgetV1 } from "./product-case-read-budget-v1"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { SafeMarketplaceOrder } from "../marketplace/commercial-monitor-domain"
import { produceEbayFeeAuthorityV1, feeRecordV1, feeDigestV1, feePackageRevisionV1 } from "./ebay-fee-producer-v1"
import { reconcileObservedEbayFeesV1 } from "./ebay-fee-reconciliation-v1"
import { bindPackageCategoryFeeV1 } from "../ebay/ebay-package-category-fee-binding-v1"

const bounded = <T extends { abortSignal: (s: AbortSignal) => T; retry: (b: boolean) => T }>(q: T) =>
  q.abortSignal(AbortSignal.timeout(8000)).retry(false)

/** Exact package lookup in the existing producer; no eBay read, scan or invented Item ID. */
async function readPackageFeeInputV1(input: Scope & { packageId: string; sku: string | null;
  readBudget?: ReturnType<typeof createProductCaseReadBudgetV1> }) {
  const pq = bounded(input.supabase.from("ebay_listing_packages").select("id,account_key,opportunity_id,candidate_key,package_data")
    .eq("id", input.packageId).eq("account_key", input.accountKey).limit(1)).maybeSingle()
  const p = (input.readBudget ? await input.readBudget.read({ dependency: "FEE_HANDOFF", authority: "ebay_listing_packages", query: () => pq }) : await pq) as Awaited<typeof pq>
  if (p.error || !p.data) throw Error("FEE_PACKAGE_REQUIRED")
  const qq = bounded(input.supabase.from("ebay_luna_opportunity_queue").select("supplier_sku,supplier_product_id,supplier_variant_id")
    .eq("id", p.data.opportunity_id).eq("candidate_key", p.data.candidate_key).limit(1)).maybeSingle()
  const q = (input.readBudget ? await input.readBudget.read({ dependency: "FEE_HANDOFF", authority: "ebay_luna_opportunity_queue", query: () => qq }) : await qq) as Awaited<typeof qq>
  if (q.error || !q.data?.supplier_sku || input.sku && input.sku !== q.data.supplier_sku) throw Error("FEE_PACKAGE_SKU_CONFLICT")
  return { data: p.data.package_data, sku: String(q.data.supplier_sku), revision: feePackageRevisionV1(p.data.package_data),
    productId: q.data.supplier_product_id, variantId: q.data.supplier_variant_id }
}

const bindingColumns = "binding_key,marketplace_account_key,package_id,ebay_item_id,sku,input_revision,authority_id,state,updated_at"
type Scope = { supabase: SupabaseClient; accountKey: string }

/** Called inside the existing economics lane. No new scheduler or global scan. */
export async function persistProducedEbayFeeV1(input: Scope & { itemId: string | null; sku: string | null;
  packageId: string | null; context: unknown; resolutionInputs?: unknown; now: Date }) {
  if (!input.itemId && !input.packageId) throw Error("FEE_EXACT_BINDING_REQUIRED")
  const pkg = !input.itemId && input.packageId ? await readPackageFeeInputV1({ ...input, packageId: input.packageId }) : null
  const sku = pkg?.sku ?? input.sku
  const bindingKey = `${input.accountKey}:${input.packageId ? `package:${input.packageId}` : `item:${input.itemId}`}`
  const created = await input.supabase.from("seller_os_ebay_fee_bindings_v1").upsert({
    binding_key: bindingKey, marketplace_account_key: input.accountKey, package_id: input.packageId,
    ebay_item_id: input.itemId, sku, ...(pkg ? { input_revision: pkg.data } : {}),
  }, { onConflict: "binding_key", ignoreDuplicates: true })
  if (created.error) throw Error("FEE_BINDING_CREATE_FAILED")
  let head = await input.supabase.from("seller_os_ebay_fee_bindings_v1").select(bindingColumns)
    .eq("marketplace_account_key", input.accountKey).eq("binding_key", bindingKey).single()
  if (head.error || !head.data || (head.data.ebay_item_id && head.data.ebay_item_id !== input.itemId) ||
      (head.data.sku && sku && head.data.sku !== sku)) throw Error("FEE_BINDING_CONFLICT")
  // The package trigger owns revisions. Never restore an older package if it
  // changed between our package read and the binding read.
  if (pkg && feeDigestV1(head.data.input_revision) !== feeDigestV1(pkg.data)) throw Error("FEE_INPUT_CHANGED_RETRY")
  if (pkg && head.data.sku !== sku) {
    const updated = await input.supabase.from("seller_os_ebay_fee_bindings_v1")
      .update({ sku, state: "PENDING_ORDER_CONTEXT", updated_at: input.now.toISOString() })
      .eq("binding_key", bindingKey).eq("updated_at", head.data.updated_at).select(bindingColumns).single()
    if (updated.error || !updated.data) throw Error("FEE_INPUT_CHANGED_RETRY")
    head = updated
  }
  const provided = feeRecordV1(input.context)
  const packageData = feeRecordV1(pkg?.data)
  const previous = pkg && !packageData.feeContextV1 && head.data.authority_id
    ? await bounded(input.supabase.from("seller_os_ebay_fee_authorities_v1").select("authority")
      .eq("marketplace_account_key", input.accountKey).eq("authority_id", head.data.authority_id).limit(1)).maybeSingle() : null
  const previousAuthority = feeRecordV1(previous?.error ? null : previous?.data?.authority)
  const storedContext = feeRecordV1(packageData.feeContextV1 ??
    (previousAuthority.packageRevision === pkg?.revision ? previousAuthority.preSaleSourceContextV1 : null))
  const context: Record<string, unknown> = pkg ? { ...storedContext, ...provided,
    observedAt: provided.accountPerformance || provided.categoryFeePolicy ? provided.observedAt : storedContext.observedAt ?? provided.observedAt,
    marketplaceAccountKey: provided.marketplaceAccountKey ?? storedContext.marketplaceAccountKey ?? input.accountKey,
    identity: { accountBindingExact: true, marketplace: "EBAY_US", itemId: null,
      packageId: input.packageId, packageRevision: pkg.revision, sku, productId: pkg.productId, variantId: pkg.variantId,
      ...feeRecordV1(storedContext.identity), ...feeRecordV1(provided.identity) },
    listing: provided.listing ?? storedContext.listing ?? { categoryId: packageData.categoryId,
      price: feeRecordV1(packageData.pricing).targetPrice, currency: feeRecordV1(packageData.pricing).currency },
  } : provided
  if (pkg) {
    const listing = feeRecordV1(context.listing), pricing = feeRecordV1(packageData.pricing)
    if (listing.categoryId !== packageData.categoryId || listing.price !== pricing.targetPrice ||
      (listing.currency !== undefined && listing.currency !== pricing.currency)) throw Error("FEE_PACKAGE_CONTEXT_CONFLICT")
    if (listing.saleFormat === "FIXED_PRICE") context.listing = { ...listing, saleFormat: "FixedPriceItem" }
    if (!context.categoryFeePolicy || provided.categoryAuthority !== undefined) context.categoryFeePolicy = bindPackageCategoryFeeV1({
      ancestry: context.categoryAuthority, policySnapshot: context.officialFeePolicySnapshot, store: context.resolvedStoreContext,
      accountKey: input.accountKey, packageId: input.packageId!, packageRevision: pkg.revision, sku: pkg.sku,
      categoryId: String(listing.categoryId), now: input.now })
  }
  // Retain fresh official document evidence across server/browser lifecycles.
  // One exact-item history read; never refresh a still-current public policy.
  const taxHistory = input.itemId && feeRecordV1(context.identity).accountBindingExact === true
    ? await input.supabase.from("seller_os_ebay_fee_authorities_v1").select("authority")
      .eq("marketplace_account_key",input.accountKey).eq("ebay_item_id",input.itemId)
      .order("observed_at",{ascending:false}).order("authority_id").limit(2) : null
  const retainedTax = retainedSellingFeeTaxPolicyV1([context.feeTaxPolicy, ...(taxHistory?.error ? [] :
    (taxHistory?.data ?? []).map(row=>feeRecordV1(row.authority).feeTaxPolicy))],input.now)
  const feeTaxPolicy = retainedTax ?? (input.itemId && feeRecordV1(context.identity).accountBindingExact === true
    ? await readSellingFeeTaxPolicyV1(input.now) : null)
  const authority = produceEbayFeeAuthorityV1({...input, sku, packageRevision: pkg?.revision,
    context:{...context,feeTaxPolicy,packageData:head.data!.input_revision}})
  const written = await input.supabase.rpc("seller_os_record_fee_authority_v1", {
    p_binding_key: bindingKey, p_expected_updated_at: head.data!.updated_at, p_authority: authority,
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
  const mayUse = h.state === "PROVEN_PRE_SALE" && authority.state === "PROVEN_PRE_SALE"
  // Pending evidence cannot authorize money; no extra package read is needed
  // just to display that wait. A successful handoff must check the current revision.
  const pkg = mayUse && !input.itemId && input.packageId ? await readPackageFeeInputV1({ ...input, packageId: input.packageId }) : null
  const packageMatches = input.itemId !== null || Boolean(pkg && h.package_id === input.packageId &&
    authority.packageId === input.packageId && authority.packageRevision === pkg.revision && authority.sku === pkg.sku)
  if (mayUse && !packageMatches) return unavailable("STALE")
  const pending = h.state === "PENDING_ORDER_CONTEXT"
  const fresh = Date.parse(String(authority.freshUntil)) > input.now.getTime() && Date.parse(String(authority.observedAt)) <= input.now.getTime()
  const usable = packageMatches && !pending && h.state === "PROVEN_PRE_SALE" && authority.state === "PROVEN_PRE_SALE" &&
    authority.contractVersion === "SELLER_OS_EBAY_FEE_AUTHORITY_V1" && authority.marketplaceAccountKey === input.accountKey &&
    authority.itemId === input.itemId && authority.sku === input.sku && fresh
  const actual = input.itemId ? await run(input.supabase.from("seller_os_ebay_fee_reconciliation_receipts_v1")
    .select("receipt").eq("marketplace_account_key", input.accountKey).eq("ebay_item_id", input.itemId)
    .eq("sku", input.sku ?? "").order("observed_at", { ascending: false }).order("receipt_id").limit(1).maybeSingle(), "seller_os_ebay_fee_reconciliation_receipts_v1") : null
  return { authority: { ...authority, state: !fresh ? "STALE" : pending ? "PENDING_ORDER_CONTEXT" : h.state,
    feeEstimateMode: typeof authority.feeEstimateMode === "string" ? authority.feeEstimateMode : null,
    resolvedAuthority: usable ? authority.resolvedAuthority : null, amount: usable ? authority.amount : null },
    label: usable ? "Economía: estimación disponible" : !fresh ? "Economía: actualizando evidencia" : authority.economicsState === "PROMOTION_BLOCKED_EVIDENCE" ? "Economía: esperando evidencia de fees" : "Economía: esperando datos de la orden",
    resolvedAuthority: usable ? authority.resolvedAuthority : null,
    actualPostSaleFee: actual?.error ? null : actual?.data?.receipt ?? null,
    reference: h.authority_id, status: usable ? "PROVEN" : !fresh ? "STALE" : "PENDING" }
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
