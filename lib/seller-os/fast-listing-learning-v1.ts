import type {SupabaseClient} from "@supabase/supabase-js"
import {goldenRecord as record} from "../ebay/commercial-golden-path-domain-v1"
import {projectGoldenMonitoringV1} from "../ebay/commercial-golden-path-monitoring-v1"

/** Join the existing post-sale authorities through the canonical package/case.
 * Read-only: this cannot create an order, purchase, publication or metric. */
export async function readFastListingOutcomesV1(input:{supabase:SupabaseClient;accountKey:string;packageId:string|null;now:Date}) {
  const waiting={status:"NOT_PUBLISHED",publishedPrice:null,actualShipping:null,actualFees:null,realizedProfit:null,
    impressions:null,views:null,watchers:null,sales:null,returns:null,cancellations:null,sourceReceipts:[],marketplaceWrites:0}
  if(!input.packageId) return waiting
  const linked=await input.supabase.from("seller_os_listing_cases_v1").select("ebay_item_id,ebay_custom_label,identity_status,listing_package_id")
    .eq("account_key",input.accountKey).eq("listing_package_id",input.packageId).eq("identity_status","LINKED_EXACT").limit(2)
    .abortSignal(AbortSignal.timeout(8000)).retry(false)
  if(linked.error) return {...waiting,status:"CANONICAL_POST_SALE_LINK_PENDING"}
  if(linked.data?.length!==1) return waiting
  const item=linked.data[0]
  const [live,metrics,lines,fees]=await Promise.all([
    input.supabase.from("ebay_active_listings").select("ebay_price,currency,last_ebay_sync_at").eq("account_key",input.accountKey).eq("ebay_item_id",item.ebay_item_id).limit(1).maybeSingle(),
    input.supabase.from("listing_commercial_snapshots").select("*").eq("marketplace_account_key",input.accountKey).eq("marketplace","EBAY_US").eq("listing_id",item.ebay_item_id).order("observed_at",{ascending:false}).limit(90),
    input.supabase.from("marketplace_order_line_items").select("marketplace_order_id,marketplace_line_item_id,quantity,line_item_amount,currency,last_observed_at")
      .eq("marketplace_account_key",input.accountKey).eq("marketplace","EBAY_US").eq("listing_id",item.ebay_item_id).order("last_observed_at",{ascending:false}).limit(100),
    input.supabase.from("seller_os_ebay_fee_reconciliation_receipts_v1").select("receipt_id,order_id,order_line_item_id,receipt,observed_at")
      .eq("marketplace_account_key",input.accountKey).eq("ebay_item_id",item.ebay_item_id).order("observed_at",{ascending:false}).limit(100),
  ])
  const orderIds=[...new Set((lines.data??[]).map(r=>r.marketplace_order_id))]
  const orders=orderIds.length?await input.supabase.from("marketplace_order_snapshots").select("marketplace_order_id,payment_status,fulfillment_status,source,observed_at")
    .eq("marketplace_account_key",input.accountKey).eq("marketplace","EBAY_US").in("marketplace_order_id",orderIds):{data:[],error:null}
  const tasks=orderIds.length?await input.supabase.from("fulfillment_tasks").select("id,marketplace_order_id,marketplace_line_item_id,workflow_state")
    .eq("marketplace_account_key",input.accountKey).in("marketplace_order_id",orderIds):{data:[],error:null}
  const taskIds=(tasks.data??[]).map(t=>t.id)
  const expenses=taskIds.length?await input.supabase.from("supplier_purchase_orders").select("id,fulfillment_task_id,product_cost,shipping_cost,tax_amount,total_paid,currency,purchased_at")
    .eq("marketplace_account_key",input.accountKey).in("fulfillment_task_id",taskIds):{data:[],error:null}
  const traffic=projectGoldenMonitoringV1({accountKey:input.accountKey,itemId:item.ebay_item_id,now:input.now,snapshots:metrics.data??[],readAvailable:!metrics.error,stock:{}})
  const window=record(traffic.windows["30D"])
  // Keep separate official revisions, forecast/actual, and per-order expenses.
  // Accrued fees exclude possible subsequent charges, refunds and advertising;
  // they must never be advertised as closed realized profit.
  return {status:"LINKED_POST_SALE_EVIDENCE",itemId:item.ebay_item_id,packageId:input.packageId,
    publishedPrice:!live.error&&live.data?.currency==="USD"?live.data.ebay_price:null,
    actualShipping:expenses.error?null:(expenses.data??[]).map(p=>({supplierReceiptId:p.id,taskId:p.fulfillment_task_id,amount:p.shipping_cost,currency:p.currency,observedAt:p.purchased_at})),
    actualFees:fees.error?null:(fees.data??[]).map(f=>f.receipt),actualExpenses:expenses.error?null:expenses.data,
    realizedProfit:null,realizedProfitStatus:"FINAL_ORDER_EXPENSE_AND_REFUND_AUTHORITY_REQUIRED",
    impressions:window.impressions??null,views:window.totalListingViews??null,watchers:window.watchers??null,
    sales:lines.error||orders.error?null:{lines:lines.data,orders:orders.data},
    returns:tasks.error?null:(tasks.data??[]).filter(t=>t.workflow_state==="RETURN_OR_ISSUE"),
    cancellations:orders.error?null:(orders.data??[]).filter(o=>/CANCEL|REFUND|VOID/i.test(`${o.payment_status} ${o.fulfillment_status}`)),
    fulfillment:tasks.error?null:tasks.data,sourceReceipts:[...(fees.data??[]).map(f=>f.receipt_id),...(expenses.data??[]).map(p=>p.id)],
    forecastOverwritten:false,marketplaceWrites:0}
}
