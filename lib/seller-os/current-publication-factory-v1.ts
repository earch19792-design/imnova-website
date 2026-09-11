import {keywordRecord as record} from './keyword-intelligence-handoff-v1'

export const CURRENT_PUBLICATION_FACTORY_V1='SELLER_OS_CURRENT_PUBLICATION_FACTORY_V1'
export function currentFactoryMarkerV1(value:unknown){
 const p=record(value),m=record(p.currentPublicationFactoryV1)
 return m.version===CURRENT_PUBLICATION_FACTORY_V1 && m.authorityPolicy==='CURRENT_ONLY' &&
  m.reuseLegacyPreparation===false && ['packageId','generation','accountKey','productId','variantId','supplierSku'].every(k=>typeof m[k]==='string' && String(m[k]).length>0) ? m : null
}

// Deliberately no spread of the historical package or the market-test seed.
// Category data survives only after the existing resolver binds this new ID.
// Keyword, Shipping, Fees, Preview, approval and execution have their own readers.
export function currentFactoryMaterializationV1(seed:unknown,existing:unknown){
 const p=record(existing),m=currentFactoryMarkerV1(p)
 if(!m)throw Error('CURRENT_FACTORY_GENERATION_REQUIRED')
 const resolver=record(p.categoryResolverV1)
 const categoryCurrent=resolver.listingPackageId===m.packageId && resolver.status==='AUTO_SELECTED'
 const s=record(seed),pricing=record(s.pricing)
 return {
  currentPublicationFactoryV1:m,
  ...(categoryCurrent?Object.fromEntries(['categoryId','categoryName','categoryResolverV1','taxonomyPreflight','aspects'].map(k=>[k,p[k]])):{}),
  // This is a proposed sale price, not an economics/fee/Shipping receipt.
  ...(typeof pricing.targetPrice==='number' && Number.isFinite(pricing.targetPrice) && pricing.targetPrice>0 && pricing.currency==='USD'
    ? {pricing:{targetPrice:pricing.targetPrice,currency:'USD',source:'CURRENT_FACTORY_PRICE_PROPOSAL',economicsProven:false}}:{}),
 }
}

export function currentFactoryPreparationStatusV1(input:{keywordReady:boolean;shippingReady:boolean;feeReady:boolean;
 previewAligned:boolean;executionValid:boolean;claimable:boolean}){
 const missing=Object.entries(input).filter(([,ready])=>!ready).map(([authority])=>authority)
 return {version:CURRENT_PUBLICATION_FACTORY_V1,status:missing.length?'WAITING_FOR_CURRENT_AUTHORITIES':'READY',
  missingCurrentAuthorities:missing,legacyRuntimeAuthorityCount:0,ownerActionRequired:false,
  readyToPublish:missing.length===0,publicationAuthorized:false,marketplaceWrites:0}
}
