import {keywordWireDigestV1 as executionDigest} from './keyword-intelligence-handoff-v1'
import {currentPublicationExecutionContractV1,applyCurrentExecutionParityV1} from './current-publication-execution-contract-v1'
import { currentPrepublicationProofV1, knownBuyerShippingV1 } from './publication-prevalidation-boundary-v1'
import { publicationFeeStructureV1, publicationEconomicsV1 } from './publication-fee-structure-v1'
import variableCosts from '../../docs/owner-variable-cost-policy-v1.json' with { type: 'json' }
import { readPublicationBrandAuthorityV1 } from "./publication-brand-authority-v1"
import { listingPipelineConsistencyV1 } from "./listing-pipeline-consistency-v1"
import { listingPublicationE2eGateV1 } from "./listing-publication-e2e-gate-v1"
import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { readKeywordDecisionHandoffV1, keywordRecord as record, type KeywordBindingV1 } from "./keyword-intelligence-handoff-v1"
import { prepareSellOneLikeThisV1 } from "./sell-one-like-this-v1"
import { LIVE_LISTING_SHIPPING_MAXIMUM_AGE_SECONDS } from "../ebay/ebay-live-listing-shipping-evidence-v1"
import { SELLER_OS_CANONICAL_LUNA_SHIPPING_DESTINATION_V1 } from "../ebay/ebay-luna-authoritative-shipping-server-v1"
import { readEbayFeeHandoffV1 } from "./ebay-fee-runtime-v1"
import { createProductCaseReadBudgetV1 } from "./product-case-read-budget-v1"
import { currentPackagePreviewRevisionV1 } from "./publication-package-preparation-v1"
import {CURRENT_PUBLICATION_FACTORY_V1,currentFactoryPreparationStatusV1,currentFactoryMarkerV1} from './current-publication-factory-v1'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const bounded = <T extends { abortSignal: (s: AbortSignal) => T; retry: (b: boolean) => T }>(q: T) =>
  q.abortSignal(AbortSignal.timeout(8000)).retry(false)

// Explicit one-package reads; no monitor scans, imports from arbitrary URLs,
// capture initiation or marketplace clients. HTTP callers supply identities only.
export async function readSellOneLikeThisV1(input: {
  supabase: SupabaseClient; accountKey: string; packageId: string; referenceItemId: string; now?: Date; existingPackagePreview?: unknown; prepublicationEvidence?: unknown;
}) {
  if (!UUID.test(input.packageId) || (input.referenceItemId !== "" && !/^\d{9,19}$/.test(input.referenceItemId))) throw Error("REFERENCE_INPUT_INVALID")
  const db = input.supabase, now = input.now ?? new Date()
  const p = await bounded(db.from("ebay_current_listing_packages_v1").select(
    "id,opportunity_id,candidate_key,account_key,factory:package_data->currentPublicationFactoryV1,ownPrice:package_data->pricing->targetPrice,category:package_data->categoryResolverV1,quantityReview:package_data->quickPickOwnerReviewV1,quantityReviewProjection:package_data->quickPickMarketTestPackageV1")
    .eq("account_key", input.accountKey).eq("id", input.packageId).limit(1)).maybeSingle()
  if (p.error || !p.data) throw Error("REFERENCE_OWN_PACKAGE_UNAVAILABLE")
  const pkg = record(p.data)
  // A new CURRENT intake can report missing authorities before research has
  // supplied a reference. This never counts as reference import or readiness.
  if (!input.referenceItemId && !currentFactoryMarkerV1({currentPublicationFactoryV1:pkg.factory})) throw Error("REFERENCE_INPUT_INVALID")
  const q = await bounded(db.from("ebay_luna_opportunity_queue").select(
    "id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,brandApplication:assessment->ownerLunaUnbrandedPolicyApplicationV1,productTruthDigest:assessment->productTruth->evidenceDigest,truthFields:assessment->productTruth->fieldTruthV1->fields,requiredTruth:assessment->canonicalMarketplaceReadinessV1->requiredItemSpecificsTruth,aspectResolutions:assessment->marketplaceRequiredSpecificsBatchResolutionV1->resolutions,shippingFamily:assessment->radarFactoryCandidateV1->>familyId")
    .eq("id", pkg.opportunity_id).eq("candidate_key", pkg.candidate_key).limit(1)).maybeSingle()
  if (q.error || !q.data) throw Error("REFERENCE_OWN_PRODUCT_UNAVAILABLE")
  const own = record(q.data)
  const binding: KeywordBindingV1 = { ACCOUNT_KEY: input.accountKey, PRODUCT_ID: String(own.supplier_product_id),
    VARIANT_ID: String(own.supplier_variant_id), CANDIDATE_KEY: String(own.candidate_key), OPPORTUNITY_ID: String(own.id),
    PACKAGE_ID: input.packageId }
  const keyword = await readKeywordDecisionHandoffV1({ supabase: db, binding })
  const planId = record(record(keyword).BINDING).PLAN_ID
  // A missing/stale keyword decision is never replaced with legacy query terms.
  const feeBudget = createProductCaseReadBudgetV1()
  const feeRead = readEbayFeeHandoffV1({ supabase: db, accountKey: input.accountKey, itemId: null,
    packageId: input.packageId, sku: String(own.supplier_sku), now, readBudget: feeBudget })
    .catch(() => null).finally(() => feeBudget.close())
  const [ref, frontier, fee, policies, publication] = await Promise.all([
    input.referenceItemId && typeof planId === "string" && UUID.test(planId) ? bounded(db.from("seller_os_product_research_canonical_evidence_v2")
      .select("plan_id,marketplace_account_key,marketplace,item_id,bounded_title_evidence,source_observation_id,structural_classification,structural_compatibility,structural_evidence")
      .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US").eq("plan_id", planId)
      .eq("item_id", input.referenceItemId).order("source_observation_id", { ascending: false }).limit(1)).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    /^market-family-v1:sha256:[a-f0-9]{64}$/.test(String(own.shippingFamily))
      ? bounded(db.rpc("get_seller_os_latest_profitability_frontiers_v1", {
        p_account_key: input.accountKey, p_marketplace_id: "EBAY_US",
        p_family_ids: [own.shippingFamily], p_limit: 100,
      })) : Promise.resolve({ data: null, error: null }),
    feeRead,
    bounded(db.from("ebay_account_policy_profiles").select("account_key,marketplace_id,fulfillment_policy_id,payment_policy_id,return_policy_id,merchant_location_key,verified_at,expires_at")
      .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US").limit(1)).maybeSingle(),
    bounded(db.from("ebay_authorized_listing_publications")
      .select("id,actor_user_id,listing_package_id,marketplace_account_key,account_fingerprint,sku,phase,preview,preview_hash,draft_execution_id,offer_id,publication_idempotency_key,listing_id,active_listing_id,manual_registration_id,verified_active_at,monitor_registered_at,preparation:sanitized_result->publicationPreparationV1")
      .eq("marketplace_account_key", input.accountKey).eq("listing_package_id", input.packageId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1)).maybeSingle(),
  ])
  if (ref.error) throw Error("REFERENCE_EVIDENCE_UNAVAILABLE")
  // The frontier table intentionally denies direct service-role SELECT. Reuse
  // its authorized, family-bounded reader; never widen table permissions.
  const frontierRows = record(frontier.data).frontiers
  const exactFrontiers = (frontier.error || !Array.isArray(frontierRows) ? [] : frontierRows).map(record)
    .filter(row => row.accountKey === input.accountKey && row.marketplaceId === "EBAY_US")
    .map(row => record(row.frontier)).filter(row => row.familyId === own.shippingFamily &&
      row.lunaProductId === binding.PRODUCT_ID && row.lunaVariantId === binding.VARIANT_ID && row.lunaSku === own.supplier_sku)
  const raw = exactFrontiers.length === 1 ? exactFrontiers[0] : {}
  const f = { family_id: raw.familyId, shipping_status: raw.shippingStatus, shipping_value: raw.shippingValue }
  const s = record(raw.shippingCaptureEvidence)
  const observed = Date.parse(String(s.observedAt)), freshUntil = observed + LIVE_LISTING_SHIPPING_MAXIMUM_AGE_SECONDS * 1000
  // Capture candidate IDs use the existing family/product/variant/SKU contract,
  // which is distinct from the opportunity candidate key.
  const captureCandidate = `sha256:${createHash("sha256").update(JSON.stringify({
    familyId: f.family_id, productId: binding.PRODUCT_ID, variantId: binding.VARIANT_ID, sku: own.supplier_sku,
  })).digest("hex")}`
  const shippingProven = /^market-family-v1:sha256:[a-f0-9]{64}$/.test(String(f.family_id)) &&
    f.shipping_status === "SHIPPING_DURABLY_PERSISTED" && s.candidateId === captureCandidate &&
    s.lunaProductId === binding.PRODUCT_ID && s.lunaVariantId === binding.VARIANT_ID && s.supplierSku === own.supplier_sku &&
    s.canonicalDestinationMatch === true && s.canonicalDestinationFingerprint === SELLER_OS_CANONICAL_LUNA_SHIPPING_DESTINATION_V1.profileDigest &&
    s.currency === "USD" && s.quantity === 1 && typeof s.shippingUsd === "number" && Number.isFinite(s.shippingUsd) && s.shippingUsd >= 0 &&
    Number(f.shipping_value) === s.shippingUsd && s.noPurchase === true && s.noCredentials === true &&
    ["LUNA_AUTHENTICATED_HTTP_CART_SHIPPING", "LUNA_PROTECTED_BROWSER_CHECKOUT_SHIPPING"].includes(String(s.acquisitionMethod)) &&
    /^sha256:[a-f0-9]{64}$/.test(String(s.evidenceDigest)) && observed <= now.getTime() && freshUntil > now.getTime()
  const shipping = shippingProven ? { status: "PROVEN" as const, value: s.shippingUsd, reference: String(s.evidenceDigest),
    source: "LUNA_PORTEX_SHIPPING_AUTHORITY", observedAt: String(s.observedAt), freshUntil: new Date(freshUntil).toISOString() }
    : { status: "PENDING" as const, value: null, reference: null, source: "LUNA_PORTEX_SHIPPING_AUTHORITY" }
  const authority = { binding, accountKey: input.accountKey, sku: String(own.supplier_sku), packageId: input.packageId,
    reference: record(ref.data), truthFields: own.truthFields, requiredTruth: own.requiredTruth, aspectResolutions: own.aspectResolutions,
    category: pkg.category, keywordRead: keyword, ownPrice: pkg.ownPrice, now, feeHandoff: fee, shipping,
    sellerPolicies: policies.error ? null : policies.data }
  // Audit the supplied server-side generation without recreating its content.
  // Normal reference preparation uses the same gate on its existing read path.
  const prep = record(record(publication.data).preparation)
  const result = input.existingPackagePreview ?? record(prep.current).certifiedPackage ?? prepareSellOneLikeThisV1(authority)
  const content = record(record(record(result).listingPackage).content), reviewView = record(pkg.quantityReviewProjection)
  const economics = record(reviewView.dollarCheck), quantityReview = record(pkg.quantityReview)
  // Recompute the existing review's material binding using CURRENT certified
  // content. Stored `reviewedPackageDigestMatch` flags are never authority.
  // A changed title/image/description (or commercial amount) invalidates the
  // old whole-package exposure authorization; it cannot silently become a
  // reusable account-wide quantity policy.
  const currentQuantityMaterial = {
    contractVersion: "QUICK_PICK_MATERIAL_PACKAGE_DIGEST_V1", listingPackageId: input.packageId,
    opportunityId: own.id, candidateKey: own.candidate_key,
    exactProductLineage: { supplierSku: own.supplier_sku, lunaProductId: binding.PRODUCT_ID,
      lunaVariantId: binding.VARIANT_ID, productTruthDigest: own.productTruthDigest },
    title: content.title, description: content.description, itemSpecifics: content.itemSpecifics,
    categoryId: content.categoryId, categoryName: record(reviewView.category).name,
    conditionId: record(reviewView.condition).id, conditionLabel: record(reviewView.condition).label,
    price: content.price, quantity: quantityReview.authorizedQuantity, imageUrls: content.imageUrls,
    shipping: shippingProven ? s.shippingUsd : null,
    supplierCost: (Array.isArray(own.truthFields) ? own.truthFields.map(record) : []).find(f => f.FIELD === "SUPPLIER_COST")?.VALUE,
    ebayFees: record(fee).status === "PROVEN" ? record(record(fee).authority).amount : null,
    profit: economics.expectedContribution, margin: economics.expectedMargin, roi: economics.expectedRoi,
    ...(record(reviewView.productIdentifiers).upc ? { productIdentifiers: reviewView.productIdentifiers } : {}),
  }
  const brandAuthority = await readPublicationBrandAuthorityV1({supabase:db,accountKey:input.accountKey,now,aspects:content.itemSpecifics,
    opportunity:{...own,assessment:{ownerLunaUnbrandedPolicyApplicationV1:own.brandApplication,canonicalMarketplaceReadinessV1:{requiredItemSpecificsTruth:own.requiredTruth}}}})
  const proof=input.prepublicationEvidence ?? prep.prepublicationEvidenceV1
  const prepublicationValid=currentPrepublicationProofV1(publication.data,proof,now)
  const currentFeeFulfillment=record(record(record(fee).authority)
    .preSaleSourceContextV1).fulfillmentFeeBasis
  const currentBuyerShipping=knownBuyerShippingV1(currentFeeFulfillment)
  const feeStructure=publicationFeeStructureV1({authority:record(fee).authority,subjectMatched:record(fee).publicationSubjectMatched===true,
    accountKey:input.accountKey,packageId:input.packageId,sku:String(own.supplier_sku),categoryId:String(content.categoryId),
    salePrice:Number(content.price),buyerShipping:prepublicationValid
      ? knownBuyerShippingV1(record(proof).fulfillmentFeeBasis)
      : currentBuyerShipping,now})
  const consistency = listingPipelineConsistencyV1(result, { ...authority, quantityReview, currentQuantityMaterial,
    publicationFeeStructure:feeStructure, exposurePolicy: prep.exposurePolicy, productTruthDigest: String(own.productTruthDigest ?? ""),
    pinnedSnapshot:record(prep.current).snapshot,pinnedPackageHash:record(prep.current).packageHash })
  const revision = currentPackagePreviewRevisionV1(prep.current, consistency, publication.data, prep.activation)
  const basePublicationGate = listingPublicationE2eGateV1(consistency, publication.error ? null : revision.publication, !publication.error)
  const revisionNeedsPreparation = revision.valid && revision.publication.phase === "draft"
  const brandBlocked = record(content.itemSpecifics).Brand === "Unbranded" && !brandAuthority.supported
  const costPolicy=variableCosts.OWNER_VARIABLE_COST_POLICY_CONFIRMED && variableCosts.marketplaceAccountKey===input.accountKey
  const publicationEconomics=publicationEconomicsV1({fee:feeStructure,salePrice:content.price,
    productCost:consistency.evidence.productCost.value,shipping:shipping.value,
    otherCosts:costPolicy?variableCosts.OTHER_PROVEN_VARIABLE_COSTS:null,listingFees:record(proof).listingFeeReserve,
    materialCostsProven:consistency.evidence.productCost.status==='PROVEN' && shippingProven && costPolicy})
  const preliminaryPublicationGate = { ...basePublicationGate,
    READY_TO_PUBLISH:basePublicationGate.READY_TO_PUBLISH && !brandBlocked && prepublicationValid && publicationEconomics.positivePreSaleContribution,
    prepublicationContractValidationPass:prepublicationValid,fullOfficialDryRunAvailable:false,publishTimeOnlyValidationRequired:true,
    blockingEvidence:[...basePublicationGate.blockingEvidence,...(brandBlocked?['UNSUPPORTED_DOWNSTREAM_BRAND']:[]),
      ...(!prepublicationValid?['CURRENT_PREPUBLICATION_EVIDENCE_REQUIRED']:[]),
      ...(!publicationEconomics.economicsProven?['CURRENT_PRE_SALE_ECONOMICS_REQUIRED']:publicationEconomics.positivePreSaleContribution?[]:['NONPOSITIVE_PRE_SALE_CONTRIBUTION']),
      ...(revisionNeedsPreparation?['CURRENT_PREVIEW_EBAY_PREPARATION_PENDING']:[])] }
  const executionRead = publication.data && record(prep.current).publicationId ? await bounded(db.rpc(
    'read_current_publication_execution_contract_v1',{p_publication_id:publication.data.id,
      p_actor_user_id:publication.data.actor_user_id,p_account_key:input.accountKey})) : null
  const currentExecution = currentPublicationExecutionContractV1({authority:executionRead?.error?null:executionRead?.data,
    revision:revision.revision,inventory:consistency.evidence.inventory,economicsReady:publicationEconomics.positivePreSaleContribution,
    materialReady:basePublicationGate.READY_TO_PUBLISH&&!brandBlocked,prepublicationValid,now})
  const validationReady=preliminaryPublicationGate.READY_TO_PUBLISH && currentExecution.EXECUTOR_CLAIMABLE
  const committedReadiness=record(record(prep.prepublicationEvidenceV1).executionReadiness)
  const committed=committedReadiness.ready===true &&
    executionDigest(committedReadiness.stockguard)===executionDigest(currentExecution.stockguard) &&
    executionDigest(committedReadiness.contractBinding)===executionDigest(currentExecution.binding) &&
    executionDigest(record(prep.prepublicationEvidenceV1).binding)===executionDigest(record(proof).binding) &&
    Date.parse(String(committedReadiness.validUntil))>now.getTime()
  const executionProjection=committed?currentExecution:{...currentExecution,EXECUTOR_CLAIMABLE:false,
    INTERNAL_EXECUTION_BLOCKER_COUNT:currentExecution.INTERNAL_EXECUTION_BLOCKER_COUNT+1,
    blockers:[...currentExecution.blockers,'CURRENT_EXECUTION_VALIDATION_RECEIPT_REQUIRED']}
  const publicationGate=applyCurrentExecutionParityV1(preliminaryPublicationGate,executionProjection)
  const currentFactory=record(pkg.factory).version===CURRENT_PUBLICATION_FACTORY_V1
    ? currentFactoryPreparationStatusV1({keywordReady:keyword.STATUS==='READY',shippingReady:shippingProven,
      feeReady:feeStructure.feeAuthorityReady,previewAligned:revision.valid,executionValid:currentExecution.CURRENT_EXECUTION_CONTRACT_VALID,
      claimable:executionProjection.EXECUTOR_CLAIMABLE}) : null
  // An empty new CURRENT draft has missing authorities, not the former
  // package's failed Preview/execution. Keep the gate fail-closed without
  // projecting synthetic failures of downstream artifacts not created yet.
  const pendingFactory=currentFactory && !record(result).listingPackage
  const projectedGate=pendingFactory ? {...publicationGate,READY_TO_PUBLISH:false,
    blockingEvidence:currentFactory.missingCurrentAuthorities.map(k=>`CURRENT_FACTORY_${k.toUpperCase()}_REQUIRED`),
    blockerClassification:'SELLER_OS_CURRENT_FACTORY_DEFECT' as const} : publicationGate
  return { ...(result as ReturnType<typeof prepareSellOneLikeThisV1>), consistency, publicationGate:projectedGate, currentExecution, validationReady, brandAuthority, feeStructure, publicationEconomics,currentFactory,
    previewRevision: { valid: revision.valid, revision: revision.revision,
      ebayPrevalidated: false, prepublicationContractValidationPass:prepublicationValid },
    publicationEvidenceStatus: publication.error ? "WAITING_FOR_DATA" : "READ" }

}

// UI discovery uses only the current bounded page of existing packages. Missing
// keyword/reference evidence is an ordinary pending state, never a new research job.
export async function readReferenceDraftChoicesV1(input: { supabase: SupabaseClient; accountKey: string }) {
  const r = await bounded(input.supabase.from("ebay_current_listing_packages_v1")
    .select("id,title:package_data->>title").eq("account_key", input.accountKey)
    .order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(20))
  if (r.error) throw Error("REFERENCE_DRAFT_CHOICES_UNAVAILABLE")
  return r.data ?? []
}
