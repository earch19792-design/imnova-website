import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { goldenRecord, goldenDigest, verifiedGoldenFields, type GoldenCandidateKey, type GoldenRecord, type GoldenAuthority } from "./commercial-golden-path-domain-v1"
import { buildEbayCategoryResolverProductTruthV1, loadEbayCategoryResolverLearningV1, resolveEbayCategoryV1 } from "./ebay-category-resolver-v1"
import { getEbayTaxonomyListingIntelligence } from "./ebay-seller-keyword-demand-gateway"
import { readEbayFeeCategoryAncestryReadonlyV1 } from "./ebay-package-fee-context-readonly-v1"
import { readEbaySellerStoreSubscriptionReadonly, preflightEbayAccountPoliciesReadonly } from "./ebay-account-policy-readonly-gateway"
import { readEbayFeePerformanceReadonlyV1, readCurrentCategoryServiceMetricsV1 } from "./ebay-seller-analytics-readonly-gateway"
import { readPublicationPayoutCurrencyV1 } from "./ebay-publication-fee-supplement-v1"
import { readCurrentOfficialFeePolicyV1 } from "./ebay-fee-policy-readonly-v1"
import { readSellingFeeTaxPolicyV1 } from "./ebay-selling-fee-tax-policy-v1"
import { resolveEbayFeeStoreContextV1 } from "./ebay-fee-context-domain-v1"
import { bindPackageCategoryFeeV1 } from "./ebay-package-category-fee-binding-v1"
import { knownBuyerShippingV1 } from "../seller-os/publication-prevalidation-boundary-v1"
import { produceEbayFeeAuthorityV1, feePackageRevisionV1 } from "../seller-os/ebay-fee-producer-v1"
import { getEbaySellerAccountScopeConfiguration } from "./ebay-seller-account-scope"

/** Candidate-bound pre-sale authority. Internal fee subject IDs never represent a listing package or an Item ID. */
export async function readGoldenPresaleAuthorityV1(input: { supabase: SupabaseClient; accountKey: string; candidate: GoldenCandidateKey; source: GoldenRecord | null; price: number | null; selectedCategory?: GoldenAuthority }) {
  const now = new Date(), truth = verifiedGoldenFields(input.source, now)
  const missing = (reasonCode: string): GoldenAuthority => ({ status: "UNPROVEN", receiptId: null, reasonCode })
  if (!truth.gate.traceProductTruthSufficient || typeof truth.values.TITLE !== "string") return { category: missing("CATEGORY_EXACT_PRODUCT_TRUTH_REQUIRED"), fee: missing("FEE_EXACT_PRODUCT_TRUTH_REQUIRED") }
  let category = input.selectedCategory
  if (category?.status !== "PROVEN") {
    // Family/category learning selects a platform leaf; it never supplies demand, price or supplier facts.
    const productTruth = buildEbayCategoryResolverProductTruthV1({ opportunity: { assessment: { productTruth: { title: truth.values.TITLE, productType: truth.values.PRODUCT_TYPE ?? null } } } })
    const learningRows = await loadEbayCategoryResolverLearningV1({ supabase: input.supabase, accountKey: input.accountKey, productTruth }).catch(() => [])
    const resolution = await resolveEbayCategoryV1({ productTruth, learningRows, taxonomyReader: getEbayTaxonomyListingIntelligence, now }).catch(() => null)
    if (resolution?.status !== "AUTO_SELECTED" || !resolution.selectedCategory) return { category: { ...missing("CANONICAL_PLATFORM_CATEGORY_UNPROVEN"), resolution }, fee: missing("FEE_SELECTED_PLATFORM_CATEGORY_REQUIRED") }
    const selected = resolution.selectedCategory
    const body = { source: resolution.authorityClass, resolution, categoryId: selected.categoryId, productId: input.candidate.productId, variantId: input.candidate.variantId, supplierSku: input.candidate.supplierSku, sourceFingerprint: input.source?.source_fingerprint, observedAt: now.toISOString() }
    category = { ...body, status: "PROVEN", receiptId: goldenDigest(body), receipt: body }
  }
  const categoryId = String(category.categoryId ?? goldenRecord(category.receipt).categoryId ?? "")
  if (input.price === null || !Number.isFinite(input.price) || input.price <= 0) return { category, fee: missing("EXACT_CLOSE_REALIZED_PRICE_REQUIRED_FOR_FEE_SUBJECT") }
  const account = getEbaySellerAccountScopeConfiguration()
  if (!account.configured || account.accountKey !== input.accountKey) return { category, fee: missing("FEE_AUTHENTICATED_CANONICAL_ACCOUNT_REQUIRED") }
  const ancestry = await readEbayFeeCategoryAncestryReadonlyV1(categoryId, truth.values.TITLE).catch(() => null)
  if (!ancestry) return { category, fee: missing("FEE_EXACT_OFFICIAL_CATEGORY_ANCESTRY_REQUIRED") }
  const settled = await Promise.allSettled([
    readEbaySellerStoreSubscriptionReadonly(), readEbayFeePerformanceReadonlyV1(), readCurrentOfficialFeePolicyV1(), readSellingFeeTaxPolicyV1(), readPublicationPayoutCurrencyV1(),
    readCurrentCategoryServiceMetricsV1(categoryId, ancestry.ancestorIds),
    preflightEbayAccountPoliciesReadonly({ fulfillmentPolicyId: "", paymentPolicyId: "", returnPolicyId: "", merchantLocationKey: "" }),
  ])
  const component = (i: number) => settled[i].status === "fulfilled" ? settled[i].value : { status: "UNPROVEN" }
  const store = resolveEbayFeeStoreContextV1(component(0), component(1)), service = goldenRecord(component(5))
  const performance = service.httpStatus === 200 ? { ...goldenRecord(component(1)), serviceMetrics: service.profile } : component(1)
  const fulfillment = goldenRecord(goldenRecord(component(6)).fulfillmentFeeBasis), buyerShipping = knownBuyerShippingV1(fulfillment)
  const feeSubjectId = randomUUID(), revision = feePackageRevisionV1({ candidate: input.candidate, sourceFingerprint: input.source?.source_fingerprint, categoryId, price: input.price, buyerShipping })
  const context = { marketplaceAccountKey: input.accountKey, observedAt: new Date().toISOString(), identity: { accountBindingExact: goldenRecord(performance).accountBindingExact === true, marketplace: "EBAY_US", itemId: null, packageId: feeSubjectId, packageRevision: revision, sku: input.candidate.supplierSku, productId: input.candidate.productId, variantId: input.candidate.variantId },
    listing: { categoryId, price: input.price, currency: "USD", saleFormat: "FixedPriceItem", buyerShippingCharge: buyerShipping, buyerShippingChargeStatus: buyerShipping === null ? "UNPROVEN" : "AVAILABLE" },
    categoryAuthority: ancestry, resolvedStoreContext: store, accountPerformance: performance, subscription: component(0), officialFeePolicySnapshot: component(2), feeTaxPolicy: component(3), payoutCurrencyAuthority: component(4), currentCategoryServiceAuthority: component(5), fulfillmentFeeBasis: fulfillment,
    categoryFeePolicy: bindPackageCategoryFeeV1({ ancestry, policySnapshot: component(2), store, accountKey: input.accountKey, packageId: feeSubjectId, packageRevision: revision, sku: input.candidate.supplierSku, categoryId, now: new Date() }) }
  const produced = produceEbayFeeAuthorityV1({ accountKey: input.accountKey, itemId: null, sku: input.candidate.supplierSku, packageId: feeSubjectId, packageRevision: revision, context, now: new Date() })
  const resolved = goldenRecord(produced.resolvedAuthority), basis = goldenRecord(resolved.feeBasis)
  const proven = produced.state === "PROVEN_PRE_SALE" && basis.salePrice === input.price && basis.buyerShipping === 0 && buyerShipping === 0
  const fee: GoldenAuthority = { status: proven ? "PROVEN" : "UNPROVEN", receiptId: goldenDigest(produced), accountKey: input.accountKey, ...input.candidate, price: basis.salePrice ?? input.price, buyerShipping, currency: "USD", amountUsd: proven ? produced.amount : null, observedAt: produced.observedAt, freshUntil: produced.freshUntil, source: "OFFICIAL_CANDIDATE_PRE_SALE_PRODUCER", feeSubject: { id: feeSubjectId, class: "INTERNAL_CANDIDATE_FEE_SUBJECT", listingPackageCreated: false, itemId: null }, authority: produced, reasonCode: proven ? null : "OFFICIAL_PRE_SALE_EXPOSURE_BOUND_UNPROVEN", marketplaceWrites: 0 }
  return { category, fee }
}
