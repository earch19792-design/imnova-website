import { feeDigestV1, feeRecordV1 } from "./ebay-fee-producer-v1"
import type { SafeMarketplaceOrder } from "../marketplace/commercial-monitor-domain"

export const EBAY_FEE_RECONCILIATION_V1 = "SELLER_OS_EBAY_POST_SALE_FEE_RECONCILIATION_V1"
const money = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0
/** Fulfillment exposes the order aggregate. Never allocate it arbitrarily to
 * lines, imply that it includes every subsequent charge, or rewrite a forecast. */
export function reconcileObservedEbayFeesV1(input: { accountKey: string; order: SafeMarketplaceOrder;
  preSaleAuthority: unknown; observedAt: string }) {
  const { order } = input, fee = order.feeEvidence, a = feeRecordV1(input.preSaleAuthority)
  if (!fee || !money(fee.totalMarketplaceFee) || !money(fee.totalFeeBasisAmount) || fee.currency !== "USD") return null
  if (order.marketplaceId !== "EBAY_US" || order.lineItems.length !== 1 || order.lineItems[0].quantity !== 1) return null
  const line = order.lineItems[0]
  const bound = a.marketplaceAccountKey === input.accountKey && a.itemId === line.listingId &&
    Boolean(line.sku) && a.sku === line.sku && typeof a.authorityId === "string" &&
    Date.parse(String(a.observedAt)) <= Date.parse(order.creationDate)
  const original = bound ? a : null
  const estimate = original?.state === "PROVEN_PRE_SALE" && money(original.amount) ? original.amount : null
  const basis = feeRecordV1(feeRecordV1(original?.resolvedAuthority).feeBasis)
  const comparable = estimate !== null && order.currency === fee.currency &&
    Date.parse(String(original?.freshUntil)) >= Date.parse(order.creationDate) &&
    (basis.method === "PROVEN_UPPER_BOUND" || basis.amount === fee.totalFeeBasisAmount)
  const delta = comparable ? Math.round((fee.totalMarketplaceFee - estimate!) * 100) / 100 : null
  const evidence = { contractVersion: EBAY_FEE_RECONCILIATION_V1, marketplaceAccountKey: input.accountKey,
    marketplace: "EBAY_US", orderId: order.ebayOrderId, lineItemId: line.lineItemId,
    itemId: line.listingId, sku: line.sku, soldAt: order.creationDate,
    orderModifiedAt: order.lastModifiedDate, source: fee.source,
    evidenceClass: "ACTUAL_POST_SALE_FEE", actualEbayFeesTotal: fee.totalMarketplaceFee,
    actualOrderBasis: fee.totalFeeBasisAmount, actualEbayFeeComponents: fee.components,
    actualCoverage: "FULFILLMENT_ACCRUED_MARKETPLACE_FEES", subsequentChargesMayReviseActual: true,
    preSaleAuthorityId: original?.authorityId ?? null, preSaleEstimate: estimate,
    delta, comparisonStatus: !comparable ? "INSUFFICIENT_COMPARABLE_EVIDENCE" :
      basis.method === "PROVEN_UPPER_BOUND" ? delta! > 0 ? "BOUND_EXCEEDED" : "WITHIN_BOUND" : "ESTIMATE_ACTUAL_DELTA",
    preSaleEvidenceOverwritten: false, actualSubstitutedForPreSale: false,
    marketplaceWrites: 0, ebayAdsWrites: 0 }
  // Repeated observations of the same official revision create no extra receipt.
  return { ...evidence, receiptId: feeDigestV1(evidence), observedAt: input.observedAt }
}
