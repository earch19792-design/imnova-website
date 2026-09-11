import { getSupabaseAdminClient } from '../supabase-admin'
import { getEbaySellerAccountScopeConfiguration } from './ebay-seller-account-scope'
import { keywordRecord as record, keywordWireDigestV1 as digest } from '../seller-os/keyword-intelligence-handoff-v1'
import { readSellOneLikeThisV1 } from '../seller-os/sell-one-like-this-runtime-v1'
import { preflightEbayDraftOnlyMobile, preflightEbayCategoryProductIdentifiers, verifyEbayDraftInventoryItem, verifyEbayUnpublishedOffer } from './ebay-draft-only-gateway'
import { publicationRevisionPublisherViewV1 } from '../seller-os/publication-revision-publisher-view-v1'

// Existing gateway GET preflights only. Never claim, create inventory/offer, or
// publish. A GET preflight cannot stand in for accepted current draft payloads.
export async function readPublicationRevisionPreflightV1(packageId:string) {
 const db=getSupabaseAdminClient(), accountKey=getEbaySellerAccountScopeConfiguration().accountKey
 if(!accountKey || !/^[a-f0-9-]{36}$/.test(packageId))throw Error('EXACT_PACKAGE_REQUIRED')
 const pubRead=await db.from('ebay_authorized_listing_publications')
  .select('id,actor_user_id,sanitized_result,phase,preview_hash,draft_execution_id,offer_id')
  .eq('listing_package_id',packageId).eq('marketplace_account_key',accountKey).limit(2).abortSignal(AbortSignal.timeout(8000)).retry(false)
 if(pubRead.error || pubRead.data?.length!==1)throw Error('ONE_PUBLICATION_INTENT_REQUIRED')
 const pub=pubRead.data[0], revision=record(record(record(pub.sanitized_result).publicationPreparationV1).current)
 const referenceId=record(record(revision.certifiedPackage).binding).REFERENCE_ITEM_ID ?? record(revision.certifiedPackage).referenceItemId
 if(!/^\d{9,19}$/.test(String(referenceId)))throw Error('CERTIFIED_REFERENCE_ID_REQUIRED')
 const current=await readSellOneLikeThisV1({supabase:db,accountKey,packageId,referenceItemId:String(referenceId)})
 if(!current.previewRevision.valid || current.brandAuthority.value==='Unbranded' && !current.brandAuthority.supported)
  throw Error('CURRENT_PREVIEW_BINDING_OR_PRODUCT_TRUTH_UNPROVEN')
 const p=record(record(current.previewRevision.revision).preview), offer=record(p.offerPayload), policies=record(offer.listingPolicies)
 const child=await db.from('seller_os_publisher_batch_children_v1').select('error_class').eq('marketplace_account_key',accountKey)
  .eq('candidate_id',record(record(revision.snapshot).binding).CANDIDATE_KEY).order('updated_at',{ascending:false}).limit(1).abortSignal(AbortSignal.timeout(4000)).retry(false).maybeSingle()
 const imageRead=await db.rpc('assess_publication_revision_images_v1',{p_publication_id:pub.id,p_actor:pub.actor_user_id,p_account_key:accountKey})
 const imageAuthority=imageRead.error?null:imageRead.data
 if(record(imageAuthority).pass!==true)throw Error('CURRENT_REVISION_IMAGE_AUTHORITY_UNPROVEN')
 const requested={fulfillmentPolicyId:String(policies.fulfillmentPolicyId??''),paymentPolicyId:String(policies.paymentPolicyId??''),returnPolicyId:String(policies.returnPolicyId??''),merchantLocationKey:String(offer.merchantLocationKey??'')}
 const results=await Promise.allSettled([
  preflightEbayDraftOnlyMobile(requested),
  preflightEbayCategoryProductIdentifiers({categoryId:String(offer.categoryId),marketplaceId:'EBAY_US',inventoryItemPayload:record(p.inventoryItemPayload)})])
 const values=results.map(r=>r.status==='fulfilled'?r.value:{safe:false,status:'UNAVAILABLE',reason:'OFFICIAL_PREFLIGHT_READ_UNAVAILABLE'})
 const mobile=record(values[0]), category=record(values[1])
 const selectionExact=Object.entries(requested).every(([k,v])=>v && record(mobile.selection)[k]===v)
 const preflightErrors=[...(!selectionExact?['CURRENT_PREVIEW_POLICY_SELECTION_MISMATCH']:[]),
  ...(mobile.snapshotStatus!=='READY'?['ACCOUNT_PREFLIGHT_NOT_READY']:[]),
  ...(category.safe!==true?[String(category.blocker??category.reason??'CATEGORY_PREFLIGHT_NOT_PROVEN')]:[])]
 // Exact existing SKU/Offer GETs compare CURRENT content. An old creation ACK
 // never supplies this result; mismatches must precede any preparation write.
 const preparationReads=await Promise.allSettled([
  verifyEbayDraftInventoryItem(String(p.sku),record(p.inventoryItemPayload)),
  typeof pub.offer_id==='string' && /^[0-9]+$/.test(pub.offer_id)
   ? verifyEbayUnpublishedOffer(pub.offer_id,String(p.sku),'EBAY_US',offer)
   : Promise.resolve({safe:false,blocker:'CURRENT_REVISION_OFFER_ID_UNAVAILABLE'})])
 const [currentInventoryReadback,currentOfferReadback]=preparationReads.map(r=>r.status==='fulfilled'?r.value:{safe:false,blocker:'CURRENT_PREPARATION_OFFICIAL_READ_UNAVAILABLE'})
 const warnings=(Array.isArray(mobile.warnings)?mobile.warnings:[]).map(code=>({code,classification:'BLOCKING'}))
 return {contractVersion:'SELLER_OS_CURRENT_REVISION_PREFLIGHT_READONLY_V1',packageId,publicationId:pub.id,
  packageHash:revision.packageHash,packageGeneration:revision.packageGeneration,previewHash:digest(p),observedAt:new Date().toISOString(),
  brandAuthority:current.brandAuthority,imageAuthority,publisherRevision:publicationRevisionPublisherViewV1(pub,imageAuthority,child.error?null:child.data?.error_class),
  officialAccountPreflight:{status:mobile.snapshotStatus??mobile.status,identity:mobile.identity,privilege:mobile.privilege,selection:mobile.selection,snapshotExpiresAt:mobile.snapshotExpiresAt},
  officialCategoryPreflight:category,warnings,
  preflightErrors:preflightErrors.map(code=>({code,classification:'BLOCKING'})),currentPolicySelectionExact:selectionExact,
  currentInventoryReadback,currentOfferReadback,
  currentPayloadAcceptance:'NOT_EXECUTED',ebayPrevalidationPass:false,
  blockers:[...current.publicationGate.blockingEvidence,...preflightErrors,...warnings.map(w=>String(w.code)),'CURRENT_DRAFT_PAYLOAD_NOT_ACCEPTED'],
  safety:{readOnly:true,marketplaceWrites:0,publicationWrites:0,adsWrites:0,databaseWrites:0}}
}
