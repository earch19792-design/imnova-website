import { consumeListingFeeAuthorityV1,
  REQUIRED_FEE_COMPONENTS_V1 } from "../seller-os/listing-fee-authority-v1"

export const COMMERCIAL_TRACE_FINAL_PRICE_AUTHORITY_V1 =
  "SELLER_OS_COMMERCIAL_TRACE_FINAL_PRICE_AUTHORITY_V1" as const

type R = Record<string, unknown>
const record = (value: unknown): R => value && typeof value === "object" &&
  !Array.isArray(value) ? value as R : {}
const money = (value: unknown): number | null => typeof value === "number" &&
  Number.isFinite(value) && value >= 0 ? value : null
const positive = (value: unknown): number | null => {
  const parsed = money(value)
  return parsed !== null && parsed > 0 ? parsed : null
}
const sha = (value: unknown) => typeof value === "string" &&
  /^sha256:[0-9a-f]{64}$/.test(value)
const text = (value: unknown) => typeof value === "string" &&
  value.trim().length > 0 ? value.trim() : null
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const ceilCents = (value: number) => Math.ceil((value - 1e-9) * 100) / 100
const fresh = (value: R, now: number) => {
  const observed = Date.parse(String(value.observedAt ?? ""))
  const until = Date.parse(String(value.freshUntil ?? ""))
  return Number.isFinite(observed) && observed <= now &&
    Number.isFinite(until) && until > now
}
const officialEbaySource = (value: unknown) => {
  try { const url = new URL(String(value))
    return url.protocol === "https:" &&
      (url.hostname === "ebay.com" || url.hostname.endsWith(".ebay.com"))
  } catch { return false }
}

export type CommercialTraceFinalPriceInputV1 = Readonly<{
  marketplaceAccountKey: string
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
  sourceFingerprint: string
  fieldTruthEvidenceDigest: string
  salePrice: number | null
  categoryId: string | null
  productCost: unknown
  shippingQty1: unknown
  fee: unknown
  ownerPolicy: unknown
  fulfillment: unknown
  marketPricing: unknown
  now?: Date
}>

/** A checked-in UNKNOWN policy is intentionally not a zero-cost policy. Only
 * an explicit account-scoped OWNER decision can turn a reserve into money. */
function policyCost(value: unknown, policy: R, salePrice: number | null,
  now: number) {
  const component = record(value)
  const common = policy.contractVersion ===
      "SELLER_OS_COMMERCIAL_TRACE_OWNER_PRICE_POLICY_V1" &&
    policy.status === "PROVEN" && policy.currency === "USD" &&
    policy.marketplace === "EBAY_US" &&
    text(policy.policyVersion) !== null && policy.policyVersion !== "UNSET" &&
    sha(policy.authorizationReferenceDigest) &&
    policy.source === "OWNER_CERTIFIED_ACCOUNT_PRICE_POLICY_V1" &&
    policy.approvedByOwner === true &&
    Number.isFinite(Date.parse(String(policy.effectiveAt ?? ""))) &&
    Date.parse(String(policy.effectiveAt)) <= now &&
    (policy.freshUntil === null || policy.freshUntil === undefined ||
      Date.parse(String(policy.freshUntil)) > now)
  const provenance = { source: common ? text(policy.source) : null,
    policyVersion: common ? text(policy.policyVersion) : null,
    effectiveAt: common ? policy.effectiveAt : null,
    authorizationReferenceDigest: common ? policy.authorizationReferenceDigest : null }
  if (!common || !["CONFIGURED", "NOT_APPLICABLE"].includes(
    String(component.state)) || !text(component.reason) ||
    !text(component.provenance)) return { state: "UNKNOWN" as const,
      amountUsd: null, ratePercent: null, ...provenance }
  if (component.state === "NOT_APPLICABLE") {
    if (component.amountUsd !== undefined || component.ratePercent !== undefined) {
      return { state: "UNKNOWN" as const, amountUsd: null,
        ratePercent: null, ...provenance }
    }
    return { state: "NOT_APPLICABLE" as const, amountUsd: 0,
      ratePercent: 0, reason: component.reason, ...provenance }
  }
  const fixed = money(component.amountUsd)
  const rate = money(component.ratePercent)
  if ((fixed === null) === (rate === null) ||
      rate !== null && (rate > 100 || component.basis !== "SALE_PRICE") ||
      salePrice === null) {
    return { state: "UNKNOWN" as const, amountUsd: null,
      ratePercent: null, ...provenance }
  }
  return { state: "CONFIGURED" as const,
    amountUsd: fixed ?? ceilCents(salePrice * rate! / 100),
    ratePercent: rate, reason: component.reason, ...provenance }
}

function fulfillmentCost(value: unknown, input: CommercialTraceFinalPriceInputV1,
  now: number) {
  const proof = record(value), cost = record(proof.serviceCostAuthority)
  const exact = proof.marketplaceAccountKey === input.marketplaceAccountKey &&
    proof.marketplace === "EBAY_US" &&
    proof.lunaProductId === input.lunaProductId &&
    proof.lunaVariantId === input.lunaVariantId &&
    proof.supplierSku === input.supplierSku &&
    proof.sourceFingerprint === input.sourceFingerprint &&
    proof.fieldTruthEvidenceDigest === input.fieldTruthEvidenceDigest &&
    sha(proof.restrictionEvidenceDigest) &&
    proof.restrictionSource === "OWNER_PRODUCT_SPECIFIC_FULFILLMENT_REVIEW_V1" &&
    fresh(proof, now)
  if (!exact || proof.status !== "PROVEN") return {
    status: "UNKNOWN" as const, restrictionStatus: "UNKNOWN" as const,
    amountUsd: null, allowedCarrier: null, allowedService: null }
  if (proof.restrictionStatus === "RESTRICTED" &&
      text(proof.allowedCarrier) && text(proof.allowedService) &&
      proof.selectedCarrier === proof.allowedCarrier &&
      proof.selectedService === proof.allowedService &&
      cost.status === "PROVEN" &&
      cost.allowedCarrier === proof.allowedCarrier &&
      cost.allowedService === proof.allowedService &&
      cost.quantity === 1 && cost.currency === "USD" &&
      cost.destinationProfileDigest ===
        record(input.shippingQty1).destinationProfileDigest &&
      money(cost.amountUsd) !== null &&
      cost.source === "SUPPLIER_ALLOWED_SERVICE_QUOTE_V1" &&
      sha(cost.evidenceDigest) && fresh(cost, now)) {
    return { status: "PROVEN" as const,
      restrictionStatus: "RESTRICTED" as const,
      amountUsd: money(cost.amountUsd),
      allowedCarrier: proof.allowedCarrier, allowedService: proof.allowedService,
      restrictionSource: proof.restrictionSource,
      restrictionEvidenceDigest: proof.restrictionEvidenceDigest,
      serviceCostSource: cost.source, observedAt: cost.observedAt,
      freshUntil: cost.freshUntil }
  }
  if (proof.restrictionStatus === "UNRESTRICTED" &&
      cost.status === "NOT_APPLICABLE" &&
      cost.reason === "SUPPLIER_QTY1_SHIPPING_COVERS_FULFILLMENT" &&
      cost.source === "OWNER_CERTIFIED_DIRECT_SUPPLIER_FULFILLMENT_V1" &&
      sha(cost.evidenceDigest)) {
    return { status: "PROVEN" as const,
      restrictionStatus: "UNRESTRICTED" as const,
      amountUsd: 0, allowedCarrier: null, allowedService: null,
      restrictionSource: proof.restrictionSource,
      restrictionEvidenceDigest: proof.restrictionEvidenceDigest,
      serviceCostSource: cost.source, observedAt: proof.observedAt,
      freshUntil: proof.freshUntil }
  }
  return { status: "UNKNOWN" as const,
    restrictionStatus: proof.restrictionStatus === "RESTRICTED"
      ? "RESTRICTED" as const : "UNKNOWN" as const,
    amountUsd: null, allowedCarrier: text(proof.allowedCarrier),
    allowedService: text(proof.allowedService) }
}

export function evaluateCommercialTraceFinalPriceV1(
  input: CommercialTraceFinalPriceInputV1) {
  const now = (input.now ?? new Date()).getTime()
  const price = positive(input.salePrice)
  const cost = record(input.productCost), shipping = record(input.shippingQty1)
  const costReady = cost.status === "PROVEN" &&
    cost.marketplaceAccountKey === input.marketplaceAccountKey &&
    cost.lunaProductId === input.lunaProductId &&
    cost.lunaVariantId === input.lunaVariantId &&
    cost.supplierSku === input.supplierSku &&
    cost.sourceFingerprint === input.sourceFingerprint &&
    cost.fieldTruthEvidenceDigest === input.fieldTruthEvidenceDigest &&
    positive(cost.amountUsd) !== null && sha(cost.evidenceDigest) &&
    cost.source === "LUNA_FIELD_PRODUCT_TRUTH_V1" && fresh(cost, now)
  const shippingReady = shipping.status === "PROVEN" &&
    shipping.marketplaceAccountKey === input.marketplaceAccountKey &&
    shipping.lunaProductId === input.lunaProductId &&
    shipping.lunaVariantId === input.lunaVariantId &&
    shipping.supplierSku === input.supplierSku &&
    shipping.sourceFingerprint === input.sourceFingerprint &&
    shipping.fieldTruthEvidenceDigest === input.fieldTruthEvidenceDigest &&
    shipping.quantity === 1 && shipping.currency === "USD" &&
    shipping.canonicalDestinationMatch === true &&
    shipping.noPurchase === true && shipping.noCredentials === true &&
    sha(shipping.destinationProfileDigest) &&
    money(shipping.amountUsd) !== null &&
    text(shipping.durableReceiptId) && sha(shipping.evidenceDigest) &&
    shipping.acquisitionMethod === "LUNA_AUTHENTICATED_HTTP_CART_SHIPPING" &&
    fresh(shipping, now)
  const feeInput = record(input.fee), packageIdentity = record(feeInput.packageIdentity)
  const feeMetadata = record(feeInput.metadata)
  const feeSubjectReady = feeInput.itemId === null &&
    packageIdentity.marketplaceAccountKey === input.marketplaceAccountKey &&
    packageIdentity.lunaProductId === input.lunaProductId &&
    packageIdentity.lunaVariantId === input.lunaVariantId &&
    packageIdentity.supplierSku === input.supplierSku &&
    packageIdentity.packageId === feeInput.packageId &&
    packageIdentity.packageRevision === feeInput.packageRevision &&
    feeInput.sku === input.supplierSku
  const fee = feeSubjectReady && price !== null ?
    consumeListingFeeAuthorityV1({ itemId: null,
      packageId: typeof feeInput.packageId === "string" ? feeInput.packageId : null,
      packageRevision: typeof feeInput.packageRevision === "string"
        ? feeInput.packageRevision : null,
      sku: input.supplierSku, accountKey: input.marketplaceAccountKey,
      categoryId: input.categoryId, salePrice: price,
      metadata: feeMetadata, now: new Date(now) }) : null
  const rawFee = record(feeMetadata.feeAuthorityV1)
  const feeReady = fee?.status === "PROVEN" &&
    record(rawFee.feeBasis).method === "PROVEN_UPPER_BOUND" &&
    money(fee.amount) !== null
  const components = Array.isArray(rawFee.components)
    ? rawFee.components.map(record) : []
  const componentAmount = (type: string) => {
    const matches = components.filter((entry) => entry.type === type)
    return matches.length === 1 ? money(matches[0].amount) : null
  }
  const variableFee = feeReady ? componentAmount("FINAL_VALUE_PERCENT") : null
  const fixedFee = feeReady ? componentAmount("PER_ORDER") : null
  const otherSellerFees = feeReady &&
    REQUIRED_FEE_COMPONENTS_V1.every((type) => componentAmount(type) !== null)
    ? cents(REQUIRED_FEE_COMPONENTS_V1.filter((type) =>
      !["FINAL_VALUE_PERCENT", "PER_ORDER"].includes(type))
      .reduce((sum, type) => sum + componentAmount(type)!, 0)) : null
  const completeFee = feeReady && variableFee !== null &&
    fixedFee !== null && otherSellerFees !== null &&
    cents(variableFee + fixedFee + otherSellerFees) === fee!.amount
  const interval = record(feeInput.floorFeeIntervalBound)
  const intervalFee = money(interval.maximumFeeUsd)
  const floorFeeBoundReady = completeFee &&
    interval.status === "PROVEN" &&
    interval.method === "OFFICIAL_INTERVAL_MAXIMUM" &&
    interval.marketplaceAccountKey === input.marketplaceAccountKey &&
    interval.categoryId === input.categoryId &&
    interval.packageId === feeInput.packageId &&
    interval.packageRevision === feeInput.packageRevision &&
    interval.supplierSku === input.supplierSku &&
    interval.minimumPrice === 0 && interval.maximumPrice === price &&
    intervalFee !== null && intervalFee >= fee!.amount! &&
    officialEbaySource(interval.source) &&
    text(interval.sourceVersion) !== null && text(interval.reference) !== null &&
    sha(interval.evidenceDigest) && fresh(interval, now)
  const feeAuthority = { status: completeFee ? "PROVEN" as const :
      feeInput.status === "STALE" || rawFee.freshUntil &&
        Date.parse(String(rawFee.freshUntil)) <= now
        ? "STALE" as const : feeInput.estimatedFee !== undefined
          ? "ESTIMATED" as const : "MISSING" as const,
    source: completeFee ? fee!.source : null,
    observedAt: completeFee ? rawFee.observedAt : null,
    sourceVersion: completeFee ? rawFee.sourceVersion : null,
    freshUntil: completeFee ? rawFee.freshUntil : null,
    reference: completeFee ? fee!.reference : null,
    feeRate: completeFee ? record(components.find((entry) =>
      entry.type === "FINAL_VALUE_PERCENT")).ratePct : null,
    ebayVariableFee: completeFee ? variableFee : null,
    ebayFixedFee: completeFee ? fixedFee : null,
    otherSellerFees: completeFee ? otherSellerFees : null,
    calculatedFee: completeFee ? fee!.amount : null,
    actualPostSaleFee: null }
  const owner = record(input.ownerPolicy)
  const policyScoped = owner.marketplaceAccountKey === input.marketplaceAccountKey
  const promotion = policyCost(owner.promotedListings,
    policyScoped ? owner : {}, price, now)
  const returns = policyCost(owner.returnsReserve,
    policyScoped ? owner : {}, price, now)
  const other = policyCost(owner.otherExplicitCosts,
    policyScoped ? owner : {}, price, now)
  const gate = record(owner.profitabilityGates)
  const gatePolicyReady = policyScoped &&
    owner.contractVersion === "SELLER_OS_COMMERCIAL_TRACE_OWNER_PRICE_POLICY_V1" &&
    owner.status === "PROVEN" && owner.currency === "USD" &&
    owner.policyVersion !== "UNSET" && sha(owner.authorizationReferenceDigest) &&
    Date.parse(String(owner.effectiveAt)) <= now &&
    (owner.freshUntil === null || owner.freshUntil === undefined ||
      Date.parse(String(owner.freshUntil)) > now) &&
    gate.state === "CONFIGURED" && text(gate.provenance) &&
    money(gate.minNetProfit) !== null &&
    money(gate.minNetMarginPercent) !== null &&
    money(gate.minRoiPercent) !== null &&
    Number(gate.minNetMarginPercent) < 100
  const fulfillment = fulfillmentCost(input.fulfillment, input, now)
  const market = record(input.marketPricing)
  const marketReady = market.sufficient === true &&
    positive(market.marketSupportedTargetPrice) === price &&
    ["SOLD_PRICE_STRONG", "AGGREGATE_SOLD_PRICING"]
      .includes(String(market.pricingMode))
  const blockers = [
    !costReady ? "PRODUCT_COST_UNPROVEN" : null,
    !shippingReady ? "HOLD_SHIPPING_UNPROVEN" : null,
    !completeFee ? "HOLD_FEE_AUTHORITY_UNPROVEN" : null,
    !floorFeeBoundReady ? "ECONOMIC_FLOOR_FEE_INTERVAL_UNPROVEN" : null,
    promotion.state === "UNKNOWN" ? "PROMOTED_LISTINGS_POLICY_UNKNOWN" : null,
    returns.state === "UNKNOWN" ? "RETURNS_RESERVE_POLICY_UNKNOWN" : null,
    other.state === "UNKNOWN" ? "OTHER_EXPLICIT_COSTS_POLICY_UNKNOWN" : null,
    fulfillment.status !== "PROVEN" ? "FULFILLMENT_AUTHORITY_UNPROVEN" : null,
    !gatePolicyReady ? "PROFITABILITY_POLICY_UNPROVEN" : null,
    !marketReady ? "HOLD_MARKET_PRICING_UNPROVEN" : null,
    price === null ? "SALE_PRICE_UNPROVEN" : null,
  ].filter((value): value is string => value !== null)
  const base = { contractVersion: COMMERCIAL_TRACE_FINAL_PRICE_AUTHORITY_V1,
    marketplace: "EBAY_US" as const,
    marketplaceAccountKey: input.marketplaceAccountKey,
    productCost: { status: costReady ? "PROVEN" : "MISSING",
      amountUsd: costReady ? cost.amountUsd : null,
      source: costReady ? cost.source : null,
      evidenceDigest: costReady ? cost.evidenceDigest : null,
      observedAt: costReady ? cost.observedAt : null,
      freshUntil: costReady ? cost.freshUntil : null },
    shippingQty1: { status: shippingReady ? "PROVEN" :
        shipping.freshUntil && Date.parse(String(shipping.freshUntil)) <= now
          ? "STALE" : "MISSING",
      amountUsd: shippingReady ? shipping.amountUsd : null,
      durableReceiptId: shippingReady ? shipping.durableReceiptId : null,
      source: shippingReady ? shipping.acquisitionMethod : null,
      evidenceDigest: shippingReady ? shipping.evidenceDigest : null,
      destinationProfileDigest:
        shippingReady ? shipping.destinationProfileDigest : null,
      observedAt: shippingReady ? shipping.observedAt : null,
      freshUntil: shippingReady ? shipping.freshUntil : null },
    preListingFeeAuthority: feeAuthority,
    ownerPolicyAuthority: { status: gatePolicyReady &&
      promotion.state !== "UNKNOWN" && returns.state !== "UNKNOWN" &&
      other.state !== "UNKNOWN" ? "PROVEN" : "UNKNOWN",
      policyVersion: owner.policyVersion ?? null,
      policyDigest: owner.policyDigest ?? null,
      currency: owner.currency ?? null,
      source: owner.source ?? null,
      authorizationReferenceDigest:
        owner.authorizationReferenceDigest ?? null,
      effectiveAt: owner.effectiveAt ?? null,
      createdAt: owner.createdAt ?? null,
      updatedAt: owner.updatedAt ?? null },
    economicFloorFeeIntervalAuthority: { status: floorFeeBoundReady
      ? "PROVEN" : "MISSING", maximumFeeUsd: floorFeeBoundReady
        ? intervalFee : null, source: floorFeeBoundReady
        ? interval.source : null,
      sourceVersion: floorFeeBoundReady ? interval.sourceVersion : null,
      observedAt: floorFeeBoundReady ? interval.observedAt : null,
      freshUntil: floorFeeBoundReady ? interval.freshUntil : null },
    promotedListingsPolicy: promotion, returnsReservePolicy: returns,
    otherExplicitCostsPolicy: other, fulfillmentAuthority: fulfillment,
    marketPricingAuthority: { sufficient: marketReady,
      pricingMode: market.pricingMode ?? null },
    salePrice: price, marketSupportedTargetPrice:
      positive(market.marketSupportedTargetPrice),
    roiBasis: "PRODUCT_COST_ONLY" as const,
    formula: "salePrice-productCost-supplierShippingQty1-ebayVariableFee-ebayFixedFee-otherSellerFees-promotedListingsCost-returnsReserve-otherExplicitCosts-fulfillmentCost" as const }
  if (blockers.length) return { ...base, status: "INCOMPLETE" as const,
    economics: null, economicFloor: null,
    profitabilityGate: { status: "UNPROVEN" as const, gatePass: false },
    priceAuthorized: false as const, finalAuthorizedPrice: null,
    blockers }
  const productCost = Number(cost.amountUsd)
  const shippingCost = Number(shipping.amountUsd)
  const promotionCost = Number(promotion.amountUsd)
  const returnsCost = Number(returns.amountUsd)
  const otherCost = Number(other.amountUsd)
  const serviceCost = Number(fulfillment.amountUsd)
  const totalCosts = cents(productCost + shippingCost + fee!.amount! +
    promotionCost + returnsCost + otherCost + serviceCost)
  const profit = cents(price! - totalCosts)
  const margin = profit / price! * 100
  const roi = profit / productCost * 100
  const gatePass = profit + 1e-9 >= Number(gate.minNetProfit) &&
    margin + 1e-9 >= Number(gate.minNetMarginPercent) &&
    roi + 1e-9 >= Number(gate.minRoiPercent)
  // A quote for one sale price does not bound fees at lower prices when a
  // category schedule has discontinuities. Only an interval maximum does.
  const fixedCosts = productCost + shippingCost + intervalFee! + otherCost + serviceCost +
    (promotion.ratePercent === null ? promotionCost : 0) +
    (returns.ratePercent === null ? returnsCost : 0)
  const variableReserveRate = Number(promotion.ratePercent ?? 0) / 100 +
    Number(returns.ratePercent ?? 0) / 100
  const retained = 1 - variableReserveRate
  const marginRetained = retained - Number(gate.minNetMarginPercent) / 100
  const floor = retained > 0 && marginRetained > 0
    ? ceilCents(Math.max((fixedCosts + Number(gate.minNetProfit)) / retained,
        fixedCosts / marginRetained,
        (fixedCosts + productCost * Number(gate.minRoiPercent) / 100) / retained))
    : null
  const economics = { salePrice: price, productCost,
    supplierShippingQty1: shippingCost, ebayVariableFee: variableFee,
    ebayFixedFee: fixedFee, otherSellerFees,
    promotedListingsCost: promotionCost, returnsReserve: returnsCost,
    otherExplicitCosts: otherCost, fulfillmentCost: serviceCost,
    totalCosts, netProfit: profit,
    netMarginPercent: cents(margin), roiPercent: cents(roi) }
  const profitabilityGate = { status: "PROVEN" as const,
    minNetProfit: Number(gate.minNetProfit),
    minNetMarginPercent: Number(gate.minNetMarginPercent),
    minRoiPercent: Number(gate.minRoiPercent),
    actualNetProfit: profit, actualNetMarginPercent: cents(margin),
    actualRoiPercent: cents(roi), gatePass }
  const authorized = gatePass && floor !== null && price! >= floor
  return { ...base, status: authorized ? "PROVEN" as const :
      "ECONOMICS_FAIL" as const,
    economics, economicFloor: floor,
    economicFloorBasis: "OFFICIAL_FEE_INTERVAL_MAXIMUM" as const,
    profitabilityGate, priceAuthorized: authorized,
    finalAuthorizedPrice: authorized ? price : null,
    blockers: authorized ? [] : ["HOLD_ECONOMICS_FAIL"] }
}
