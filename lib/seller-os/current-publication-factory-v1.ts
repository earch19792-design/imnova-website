// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import {keywordRecord as record} from './keyword-intelligence-handoff-v1.ts'

export const CURRENT_PUBLICATION_FACTORY_V1='SELLER_OS_CURRENT_PUBLICATION_FACTORY_V1'
export const CURRENT_FACTORY_ROUTINE_EXPOSURE_AUTHORITY_V1=
 'SELLER_OS_CURRENT_FACTORY_ROUTINE_EXPOSURE_AUTHORITY_V1'
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
 const s=record(seed),pricing=record(s.pricing),factory=record(s.factoryPreparationAuthority)
 const suppliedExposure=record(s.packageExposurePolicyV1),suppliedBinding=record(suppliedExposure.binding)
 const suppliedExposureExact=suppliedExposure.sourcePolicy===CURRENT_FACTORY_ROUTINE_EXPOSURE_AUTHORITY_V1 &&
  suppliedExposure.version==='SELLER_OS_PACKAGE_LISTING_EXPOSURE_V1' && suppliedExposure.quantity===1 &&
  suppliedExposure.publicationAuthorized===false && suppliedExposure.supplierQuantityInferred===false &&
  suppliedBinding.accountKey===m.accountKey && suppliedBinding.packageId===m.packageId &&
  suppliedBinding.productId===m.productId && suppliedBinding.variantId===m.variantId && suppliedBinding.sku===m.supplierSku
 const candidateTruthDigest=factory.productTruthDigest??(suppliedExposureExact?suppliedBinding.productTruthDigest:null)
 const productTruthDigest=typeof candidateTruthDigest==='string' &&
  /^sha256:[a-f0-9]{64}$/.test(candidateTruthDigest)
  ?candidateTruthDigest:null
 const binding=productTruthDigest?{
  accountKey:m.accountKey,packageId:m.packageId,productId:m.productId,
  variantId:m.variantId,sku:m.supplierSku,productTruthDigest,
 }:null
 return {
  currentPublicationFactoryV1:m,
  ...(binding?{packageExposurePolicyV1:{
   version:'SELLER_OS_PACKAGE_LISTING_EXPOSURE_V1',status:'ACTIVE',
   scope:'EXACT_NEW_PACKAGE_EXPOSURE',quantity:1,supplierQuantityInferred:false,
   publicationAuthorized:false,sourcePolicy:CURRENT_FACTORY_ROUTINE_EXPOSURE_AUTHORITY_V1,
   authorizedBy:CURRENT_PUBLICATION_FACTORY_V1,authorizedAt:m.createdAt,
   authorizationReference:`CURRENT_FACTORY_GENERATION:${m.generation}`,
   binding,
  }}:{}),
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
