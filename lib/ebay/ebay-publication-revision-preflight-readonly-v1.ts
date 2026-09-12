import { PREPUBLICATION_VALIDATION_V1, knownPublicationPayloadErrorsV1 } from '../seller-os/publication-prevalidation-boundary-v1'
import { getEbayTaxonomyListingIntelligence } from './ebay-seller-keyword-demand-gateway'
import { validateEbayTaxonomyAspectValues } from './ebay-draft-only-readiness'
import { currentUnpublishedPayloadAcceptedV1 } from "./ebay-current-package-preparation-v1"
import { getSupabaseAdminClient } from '../supabase-admin'
import { getEbaySellerAccountScopeConfiguration } from './ebay-seller-account-scope'
import { keywordRecord as record, keywordWireDigestV1 as digest } from '../seller-os/keyword-intelligence-handoff-v1'
import { readSellOneLikeThisV1 } from '../seller-os/sell-one-like-this-runtime-v1'
import { preflightEbayDraftOnlyMobile, preflightEbayCategoryProductIdentifiers, preflightEbayDraftDependencies, preflightCurrentUnpublishedOfferFeesV1, verifyEbayDraftInventoryItem, verifyEbayUnpublishedOffer } from './ebay-draft-only-gateway'
import { publicationRevisionPublisherViewV1 } from '../seller-os/publication-revision-publisher-view-v1'

// Existing gateway GET preflights only. Never claim, create inventory/offer, or
// publish. A GET preflight cannot stand in for accepted current draft payloads.
export async function readPublicationRevisionPreflightV1(packageId:string) {
 const db=getSupabaseAdminClient(), accountKey=getEbaySellerAccountScopeConfiguration().accountKey
 if(!accountKey || !/^[a-f0-9-]{36}$/.test(packageId))throw Error('EXACT_PACKAGE_REQUIRED')
 const pubRead=await db.from('ebay_authorized_listing_publications')
  .select('id,actor_user_id,listing_package_id,marketplace_account_key,sanitized_result,phase,preview_hash,draft_execution_id,offer_id')
  .eq('listing_package_id',packageId).eq('marketplace_account_key',accountKey).limit(2).abortSignal(AbortSignal.timeout(8000)).retry(false)
 if(pubRead.error || pubRead.data?.length!==1)throw Error('ONE_PUBLICATION_INTENT_REQUIRED')
 const pub=pubRead.data[0], revision=record(record(record(pub.sanitized_result).publicationPreparationV1).current)
 const certified=record(revision.certifiedPackage)
 const referenceId=record(certified.binding).REFERENCE_ITEM_ID ?? certified.referenceItemId
 const currentOnlyWithoutReference=String(referenceId??'')==='' &&
  record(certified.referenceImport).currentOnlyAuthorityUsed===true &&
  record(certified.safety).legacyKeywordFallback===false
 if(!/^\d{9,19}$/.test(String(referenceId)) && !currentOnlyWithoutReference)throw Error('CERTIFIED_REFERENCE_ID_OR_CURRENT_ONLY_AUTHORITY_REQUIRED')
 const current=await readSellOneLikeThisV1({supabase:db,accountKey,packageId,referenceItemId:String(referenceId??'')})
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
 const accepted=currentUnpublishedPayloadAcceptedV1(pub,revision) && record(currentInventoryReadback).safe===true && record(currentOfferReadback).safe===true
 const activation=record(record(record(pub.sanitized_result).publicationPreparationV1).activation)
 const active=activation.publicationId===pub.id && activation.draftExecutionId===pub.draft_execution_id &&
  activation.previewHash===pub.preview_hash && activation.packageHash===revision.packageHash && activation.packageGeneration===revision.packageGeneration &&
  activation.historicalExecutionReused===false && activation.publicationAuthorized===false && accepted
 // Once CURRENT is active, exercise the already-integrated non-LIVE validation
 // operations. Neither accepted payload nor getListingFees proves publish-time
 // validation of every required field; preserve that distinction explicitly.
 const validations=active && selectionExact && mobile.snapshotStatus==='READY' ? await Promise.allSettled([
  preflightEbayDraftDependencies({...requested,preflightSnapshot:String(mobile.snapshot??'')}),
  preflightCurrentUnpublishedOfferFeesV1(String(pub.offer_id)),
 ]) : []
 const validationValues=validations.map(x=>x.status==='fulfilled'?x.value:{safe:false,ok:false,blocker:'CURRENT_VALIDATION_READ_UNAVAILABLE'})
 const currentDependencies=validationValues[0]??null,currentListingFeePrevalidation=validationValues[1]??null
 if(active && record(currentDependencies).safe!==true)preflightErrors.push(String(record(currentDependencies).blocker??'CURRENT_DEPENDENCY_VALIDATION_NOT_PROVEN'))
 if(active && record(currentListingFeePrevalidation).ok!==true)preflightErrors.push('CURRENT_LISTING_FEE_PREVALIDATION_FAILED')
 const taxonomy=await getEbayTaxonomyListingIntelligence(String(record(record(p.inventoryItemPayload).product).title),String(offer.categoryId),{allowTitleSuggestionFallback:false})
 const aspects=record(record(p.inventoryItemPayload).product).aspects
 const aspectValues=record(aspects) as Record<string,string[]>
 const taxonomyErrors=taxonomy.status==='AVAILABLE' && taxonomy.categoryId===offer.categoryId && taxonomy.categoryResolution==='KNOWN_CATEGORY'
  ? [...validateEbayTaxonomyAspectValues(aspectValues,{source:taxonomy.source,constraintSnapshotStatus:'AVAILABLE',categoryTreeId:taxonomy.categoryTreeId,
     categoryTreeVersion:taxonomy.categoryTreeVersion,aspectConstraints:taxonomy.aspects}),
     ...taxonomy.requiredAspects.filter(a=>!Array.isArray(aspectValues[a.name]) || !aspectValues[a.name].length).map(a=>`REQUIRED_ASPECT_MISSING:${a.name}`)]
  : ['CURRENT_OFFICIAL_ASPECT_CONSTRAINTS_UNAVAILABLE']
 const localErrors=[...knownPublicationPayloadErrorsV1(p),...taxonomyErrors]
 const feeErrors=record(record(currentListingFeePrevalidation).body).errors
 if(Array.isArray(feeErrors))for(const error of feeErrors)preflightErrors.push(`OFFICIAL_LISTING_FEE_ERROR:${String(record(error).errorId??record(error).message??'UNCLASSIFIED')}`)
 const summaries=Array.isArray(record(currentListingFeePrevalidation).feeSummaries)?record(currentListingFeePrevalidation).feeSummaries as unknown[]:[]
 const fees=summaries.map(record).filter(s=>s.marketplaceId==='EBAY_US').flatMap(s=>Array.isArray(s.fees)?s.fees.map(record):[])
 const listingFee=fees.filter(f=>f.feeType==='ListingFee')
 const listingFeeReserve=listingFee.length===1 && record(listingFee[0].amount).currency==='USD' &&
  Number.isFinite(Number(record(listingFee[0].amount).value)) && Number(record(listingFee[0].amount).value)>=0 ? Number(record(listingFee[0].amount).value):null
 if(listingFeeReserve===null)localErrors.push('CURRENT_LISTING_FEE_RESERVE_UNPROVEN')
 const warnings=[...(Array.isArray(mobile.warnings)?mobile.warnings:[]),
  ...(Array.isArray(record(record(currentListingFeePrevalidation).body).warnings)?record(record(currentListingFeePrevalidation).body).warnings as unknown[]:[]),
  ...summaries.map(record).flatMap(s=>Array.isArray(s.warnings)?s.warnings:[])].map(code=>({code,classification:'BLOCKING'}))
 const prepublicationEvidence={version:PREPUBLICATION_VALIDATION_V1,binding:{publicationId:pub.id,packageId,accountKey,
  sku:p.sku,offerId:pub.offer_id,draftExecutionId:pub.draft_execution_id,packageHash:revision.packageHash,packageGeneration:revision.packageGeneration,
  previewHash:digest(p),previewGeneration:revision.packageGeneration},observedAt:new Date().toISOString(),
  checks:{currentOfferReadbackPass:record(currentOfferReadback).safe===true,currentInventoryReadbackPass:record(currentInventoryReadback).safe===true,
   currentPolicyReadbackPass:record(currentDependencies).safe===true,currentFeesRequestPass:record(currentListingFeePrevalidation).ok===true,
   prepublicationContractValidationPass:localErrors.length===0 && active,currentTaxonomyPass:taxonomyErrors.length===0,
   currentAccountPass:mobile.snapshotStatus==='READY' && selectionExact,currentImageAuthorityPass:record(imageAuthority).pass===true},
  fullOfficialDryRunAvailable:false,publishTimeOnlyValidationRequired:true,ebayPrevalidationPass:false,publicationAuthorized:false,
  blockingErrors:[...preflightErrors,...localErrors],warnings,fulfillmentFeeBasis:mobile.fulfillmentFeeBasis,listingFeeReserve,
  taxonomy:{categoryId:taxonomy.categoryId,observedAt:taxonomy.observedAt,source:taxonomy.source,requiredAspects:taxonomy.requiredAspects.map(a=>a.name)},
  listingFees:currentListingFeePrevalidation}
 const evaluated=await readSellOneLikeThisV1({supabase:db,accountKey,packageId,referenceItemId:String(referenceId),prepublicationEvidence})
 return {contractVersion:'SELLER_OS_CURRENT_REVISION_PREFLIGHT_READONLY_V1',packageId,publicationId:pub.id,
  packageHash:revision.packageHash,packageGeneration:revision.packageGeneration,previewHash:digest(p),observedAt:new Date().toISOString(),
  brandAuthority:current.brandAuthority,imageAuthority,publisherRevision:publicationRevisionPublisherViewV1(pub,imageAuthority,child.error?null:child.data?.error_class),
  officialAccountPreflight:{status:mobile.snapshotStatus??mobile.status,identity:mobile.identity,privilege:mobile.privilege,selection:mobile.selection,snapshotExpiresAt:mobile.snapshotExpiresAt},
  officialCategoryPreflight:category,warnings,
  preflightErrors:preflightErrors.map(code=>({code,classification:'BLOCKING'})),currentPolicySelectionExact:selectionExact,
  currentInventoryReadback,currentOfferReadback,
  currentPreparationLedgerActivated:active,currentRevisionPublisherActive:active,historicalExecutionReused:false,
  currentDependencies,currentListingFeePrevalidation,
  fulfillmentFeeBasis:mobile.fulfillmentFeeBasis,
  currentPreparationReceiptBound:accepted,historicalAckReused:false,
  preparationReceiptBinding:accepted?record(record(record(pub.sanitized_result).currentUnpublishedPreparationV1).binding):null,
  currentPayloadAcceptance:accepted?'CURRENT_UNPUBLISHED_PAYLOAD_ACCEPTED':'NOT_PROVEN',ebayPrevalidationPass:false,
  fullPublishValidation:false,fullPublishValidationLimitation:'INVENTORY_API_UNPUBLISHED_ACCEPTANCE_AND_GET_LISTING_FEES_DO_NOT_VALIDATE_ALL_PUBLISH_REQUIRED_FIELDS',
  prepublicationEvidence,prepublicationContractValidationPass:evaluated.publicationGate.prepublicationContractValidationPass,
  feeStructure:evaluated.feeStructure,economics:evaluated.publicationEconomics,publicationGate:evaluated.publicationGate,
  executionReadiness:{ready:evaluated.validationReady,contractBinding:evaluated.currentExecution.binding,stockguard:evaluated.currentExecution.stockguard,
    validUntil:new Date(Math.min(Date.now()+10*60*1000,...[evaluated.consistency.evidence.inventory.freshUntil,
      evaluated.consistency.evidence.shipping.freshUntil,record(evaluated.feeStructure).freshUntil].map(v=>Date.parse(String(v))).filter(Number.isFinite))).toISOString()},
  blockers:[...evaluated.publicationGate.blockingEvidence,...preflightErrors,...localErrors,...warnings.map(w=>String(w.code)),...(!accepted?['CURRENT_DRAFT_PAYLOAD_NOT_ACCEPTED']:[])],
  safety:{readOnly:true,marketplaceWrites:0,publicationWrites:0,adsWrites:0,databaseWrites:0}}
}
