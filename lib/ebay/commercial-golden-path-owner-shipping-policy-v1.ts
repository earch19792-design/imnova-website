import { goldenDigest, type GoldenCandidateKey, type GoldenRecord } from
  "./commercial-golden-path-domain-v1"

export const SELLER_OS_LUNA_FLAT_SHIPPING_POLICY_V1 = Object.freeze({
  contractVersion: "SELLER_OS_LUNA_FLAT_SHIPPING_POLICY_V1",
  policyVersion: "OWNER_LUNA_FLAT_SHIPPING_V1_20261003",
  marketplace: "EBAY_US",
  marketplaceAccountKey:
    "imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12",
  currency: "USD",
  amountUsdPerOrder: 9.99,
  destinationCoverage: "ALL_US_ADDRESSES",
  fulfillmentMode: "DIRECT_SUPPLIER_TO_BUYER",
  quantityBasis: "PER_ORDER_NOT_PER_UNIT",
  approvedByOwner: true,
  effectiveAt: "2026-10-03T00:00:00.000Z",
  approvalSource: "OWNER_EXPLICIT_CHAT_CONFIRMATION_2026_10_03",
  approvalStatement:
    "OWNER confirmó que la tarifa de Luna Portex es USD 9.99 por pedido para cualquier dirección en Estados Unidos y que Seller OS no debe volver a calcularla por producto.",
})

export function resolveOwnerLunaFlatShippingV1(input: Readonly<{
  accountKey: string
  candidate: GoldenCandidateKey
  source: GoldenRecord | null
  now: Date
}>) {
  const policy = SELLER_OS_LUNA_FLAT_SHIPPING_POLICY_V1
  if (input.accountKey !== policy.marketplaceAccountKey || !input.source ||
      input.source.product_id !== input.candidate.productId ||
      input.source.variant_id !== input.candidate.variantId ||
      input.source.sku !== input.candidate.supplierSku ||
      typeof input.source.source_fingerprint !== "string" ||
      !/^sha256:[0-9a-f]{64}$/.test(input.source.source_fingerprint) ||
      input.now.getTime() < Date.parse(policy.effectiveAt)) return null

  const observedAt = input.now.toISOString()
  const freshUntil = new Date(input.now.getTime() + 6 * 3600_000)
    .toISOString()
  const policyDigest = goldenDigest(policy)
  const candidateDigest = goldenDigest({ policyDigest,
    candidate: input.candidate,
    sourceFingerprint: input.source.source_fingerprint })
  const destinationProfileDigest = goldenDigest({
    policyDigest, coverage: policy.destinationCoverage })
  const buyerCoverageDigest = goldenDigest({
    policyDigest, fulfillmentMode: policy.fulfillmentMode,
    coverage: policy.destinationCoverage })
  const shippingReceiptId = `owner-luna-flat-shipping:${candidateDigest}`
  return Object.freeze({
    policy,
    shipping: Object.freeze({ status: "PROVEN", receiptId: shippingReceiptId,
      productId: input.candidate.productId,
      variantId: input.candidate.variantId,
      supplierSku: input.candidate.supplierSku,
      supplierQuantity: input.candidate.supplierQuantity,
      sourceFingerprint: input.source.source_fingerprint,
      amountUsd: policy.amountUsdPerOrder, currency: policy.currency,
      source: "OWNER_CERTIFIED_LUNA_FLAT_SHIPPING_POLICY_V1",
      destinationProfileId: "OWNER_ALL_US_ADDRESSES_V1",
      destinationProfileDigest, noPurchase: true, noPayment: true,
      observedAt, freshUntil, sourceDigest: policyDigest,
      policyDigest, quantityBasis: policy.quantityBasis,
      marketplaceWrites: 0, supplierPurchases: 0 }),
    fulfillment: Object.freeze({ status: "PROVEN",
      receiptId: `owner-direct-fulfillment:${candidateDigest}`,
      accountKey: input.accountKey,
      productId: input.candidate.productId,
      variantId: input.candidate.variantId,
      supplierSku: input.candidate.supplierSku,
      supplierQuantity: input.candidate.supplierQuantity,
      sourceFingerprint: input.source.source_fingerprint,
      supplierShippingReceiptId: shippingReceiptId,
      destinationProfileDigest, currency: policy.currency,
      buyerShipping: 0, buyerCoverageStatus: "PROVEN",
      buyerCoverageDigest, amountUsd: 0,
      source: "OWNER_CERTIFIED_DIRECT_SUPPLIER_FULFILLMENT_V1",
      coverage: "SUPPLIER_QUOTE_COVERS_ALL_OFFERED_BUYER_DESTINATIONS",
      observedAt, freshUntil, sourceDigest: policyDigest,
      marketplaceWrites: 0, supplierPurchases: 0 }),
  })
}
