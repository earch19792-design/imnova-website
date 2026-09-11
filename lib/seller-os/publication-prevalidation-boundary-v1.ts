import {keywordRecord as record,keywordWireDigestV1 as digest} from './keyword-intelligence-handoff-v1'

export const PREPUBLICATION_VALIDATION_V1='SELLER_OS_PREPUBLICATION_ATTAINABLE_EVIDENCE_V1'
const rows=(v:unknown)=>Array.isArray(v)?v.map(record):[]

/** The Inventory API has no full publishOffer dry run. This receipt proves
 * only performed reads and local checks, never a successful publish. */
export function currentPrepublicationProofV1(publication:unknown,proof:unknown,now=new Date()) {
 const p=record(publication),prep=record(record(p.sanitized_result).publicationPreparationV1 ?? p.preparation)
 const r=record(prep.current),v=record(proof),b=record(v.binding),checks=record(v.checks)
 return v.version===PREPUBLICATION_VALIDATION_V1 &&
  p.phase==='preview_ready' && p.listing_id==null && p.publication_idempotency_key==null &&
  b.publicationId===p.id && b.packageId===p.listing_package_id && b.accountKey===p.marketplace_account_key &&
  b.sku===p.sku && b.offerId===p.offer_id && b.draftExecutionId===p.draft_execution_id &&
  b.packageHash===r.packageHash && b.packageGeneration===r.packageGeneration &&
  b.previewHash===r.previewHash && r.previewHash===digest(r.preview) && b.previewGeneration===r.packageGeneration &&
  typeof v.observedAt==='string' && Date.parse(v.observedAt)<=now.getTime() &&
  now.getTime()-Date.parse(v.observedAt)<10*60*1000 &&
  ['currentOfferReadbackPass','currentInventoryReadbackPass','currentPolicyReadbackPass','currentFeesRequestPass',
    'prepublicationContractValidationPass','currentTaxonomyPass','currentAccountPass','currentImageAuthorityPass'].every(k=>checks[k]===true) &&
  v.fullOfficialDryRunAvailable===false && v.publishTimeOnlyValidationRequired===true &&
  v.ebayPrevalidationPass===false && v.publicationAuthorized===false &&
  Array.isArray(v.blockingErrors) && v.blockingErrors.length===0 && Array.isArray(v.warnings) &&
  rows(v.warnings).every(w=>w.classification==='NON_BLOCKING')
}

export function knownPublicationPayloadErrorsV1(preview:unknown) {
 const p=record(preview),i=record(p.inventoryItemPayload),o=record(p.offerPayload),product=record(i.product),policies=record(o.listingPolicies)
 const errors:string[]=[]
 if(!p.sku || o.sku!==p.sku || o.marketplaceId!=='EBAY_US' || o.format!=='FIXED_PRICE')errors.push('CURRENT_SKU_MARKETPLACE_FORMAT_REQUIRED')
 if(!/^\d+$/.test(String(o.categoryId)))errors.push('CATEGORY_REQUIRED')
 if(typeof product.title!=='string' || !product.title.trim() || [...product.title].length>80)errors.push('TITLE_INVALID')
 if(typeof product.description!=='string' || !product.description.trim())errors.push('DESCRIPTION_REQUIRED')
 if(!i.condition)errors.push('CONDITION_REQUIRED')
 const images=product.imageUrls
 if(!Array.isArray(images) || !images.length || images.length>24 || images.some(u=>{
   try{return typeof u!=='string'||new URL(u).protocol!=='https:'}catch{return true}
 }))errors.push('IMAGE_PAYLOAD_INVALID')
 const qty=o.availableQuantity ?? record(record(i.availability).shipToLocationAvailability).quantity
 if(typeof qty!=='number' || !Number.isInteger(qty) || qty<=0)errors.push('EXPOSURE_QUANTITY_INVALID')
 const price=record(record(o.pricingSummary).price)
 if(price.currency!=='USD' || !Number.isFinite(Number(price.value)) || Number(price.value)<=0)errors.push('PRICE_INVALID')
 if(!o.merchantLocationKey || ['paymentPolicyId','returnPolicyId','fulfillmentPolicyId'].some(k=>!policies[k]))errors.push('POLICIES_OR_LOCATION_REQUIRED')
 if(o.listingDuration && o.listingDuration!=='GTC')errors.push('LISTING_DURATION_UNSUPPORTED')
 return errors
}

/** Recognize the existing explicit free domestic policy, not supplier shipping.
 * Calculated/rate-table/handling amounts remain pending without a bound. */
export function knownBuyerShippingV1(value:unknown):number|null {
 const p=record(value),options=rows(p.shippingOptions)
 if(p.source!=='OFFICIAL_EBAY_FULFILLMENT_POLICY' || p.marketplaceId!=='EBAY_US')return null
 const domestic=options.filter(o=>o.optionType==='DOMESTIC')
 if(domestic.length!==1 || domestic[0].costType!=='FLAT_RATE' || domestic[0].rateTableId ||
   (domestic[0].handlingCost!=null && Number(record(domestic[0].handlingCost).value)!==0))return null
 return rows(domestic[0].shippingServices).some(s=>s.freeShipping===true && record(s.shippingCost).currency==='USD' && Number(record(s.shippingCost).value)===0)?0:null
}
