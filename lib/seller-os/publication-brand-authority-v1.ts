import type { SupabaseClient } from '@supabase/supabase-js'
import { keywordRecord as record, keywordWireDigestV1 as digest } from './keyword-intelligence-handoff-v1'
import { validateLunaUnbrandedAfterFullPageReviewPolicyRowV1 } from '../ebay/ebay-owner-supplier-merchandise-policy-v1'
import { resolveLunaFullPageRequiredFactV1, type buildLunaExactProductEvidenceSetV1 } from '../ebay/ebay-luna-full-page-required-facts-v1'

// A marketplace value is never promoted into the supplier BRAND field.
export function publicationBrandAuthorityV1(input: {opportunity: unknown; aspects: unknown; policyRow: unknown; accountKey:string; now:Date}) {
 const o=record(input.opportunity), a=record(o.assessment), rt=record(record(a.canonicalMarketplaceReadinessV1).requiredItemSpecificsTruth)
 const value=record(input.aspects).Brand, e=record(rt.lunaExactProductEvidenceSetV1), app=record(a.ownerLunaUnbrandedPolicyApplicationV1)
 const policy=validateLunaUnbrandedAfterFullPageReviewPolicyRowV1(input.policyRow,input.accountKey)
 const contract=(Array.isArray(rt.aspectContracts)?rt.aspectContracts.map(record):[]).find(c=>c.name==='Brand')
 const core={...e};delete core.evidenceDigest
 const exact=policy && policy.id===app.policyId && policy.evidenceDigest===app.policyDigest &&
  Date.parse(policy.certifiedAt)<=input.now.getTime() && Date.parse(String(app.policyAppliedAt))<=input.now.getTime() &&
  rt.supplierProductId===o.supplier_product_id && rt.supplierVariantId===o.supplier_variant_id && rt.candidateKey===o.candidate_key &&
  e.lunaProductId===o.supplier_product_id && e.lunaVariantId===o.supplier_variant_id && e.supplierSku===o.supplier_sku &&
  e.evidenceDigest===digest(core) && e.allExactProductImagesReviewed===true && e.imageBrandEvidenceStatus==='NO_EXPLICIT_BRAND' &&
  contract?.source==='EBAY_TAXONOMY_OFFICIAL_READONLY' && Array.isArray(contract.allowedValues) && contract.allowedValues.includes('Unbranded')
 let resolved=null
 if(exact) try { resolved=resolveLunaFullPageRequiredFactV1({opportunity:o,
  evidence:e as ReturnType<typeof buildLunaExactProductEvidenceSetV1>,specificName:'Brand',freeTextAllowed:contract.freeTextAllowed===true,
  allowedValues:contract.allowedValues as string[],allowedValuesComplete:contract.allowedValuesComplete===true}) } catch { /* malformed evidence fails closed */ }
 const accepted=value==='Unbranded' && resolved?.value===value && resolved.source==='OWNER_LUNA_UNBRANDED_POLICY'
 return {field:'BRAND',value:value??null,authorityClass:accepted?'MARKETPLACE_POLICY_VALUE':'UNPROVEN',
  supported:accepted,supplierFactProven:false,productTruthChanged:false,
  source:accepted?'https://developer.ebay.com/api-docs/user-guides/static/trading-user-guide/item-specifics-product-ids.html':null,
  policyId:accepted?policy!.id:null,policyDigest:accepted?policy!.evidenceDigest:null,
  productEvidenceDigest:accepted?e.evidenceDigest:null,applicationDigest:accepted?app.applicationDigest:null,
  reason:accepted?'EXACT_FULL_PAGE_AND_IMAGE_NO_BRAND_REVIEW_WITH_ACTIVE_POLICY':'MARKETPLACE_BRAND_AUTHORITY_UNPROVEN'}
}

export async function readPublicationBrandAuthorityV1(input:{supabase:SupabaseClient;accountKey:string;opportunity:unknown;aspects:unknown;now:Date}) {
 const app=record(record(record(input.opportunity).assessment).ownerLunaUnbrandedPolicyApplicationV1)
 const r=typeof app.policyId==='string' && /^[a-f0-9-]{36}$/.test(app.policyId) ? await input.supabase
  .from('seller_os_owner_supplier_policies_v1').select('id,marketplace_account_key,marketplace,supplier_code,policy_code,policy_version,decision,policy_payload,evidence_digest,authorization_reference_digest,certified_at,revoked_at')
  .eq('id',app.policyId).eq('marketplace_account_key',input.accountKey).limit(1).abortSignal(AbortSignal.timeout(4000)).retry(false).maybeSingle() : null
 return publicationBrandAuthorityV1({...input,policyRow:r?.error?null:r?.data})
}
