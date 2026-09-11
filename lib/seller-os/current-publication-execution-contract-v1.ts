import {keywordRecord as record,keywordWireDigestV1 as digest} from './keyword-intelligence-handoff-v1'
import {evaluatePublishWithStockguardContractV1} from '../ebay/ebay-current-future-listing-stockguard-wiring-v1'

/** Shared gate/executor projection. Legacy approval fields and Preview age are
 * not inputs. Exact CURRENT identity and fresh operational authorities are. */
export function currentPublicationExecutionContractV1(input:{authority:unknown;revision:unknown;inventory:unknown;
 economicsReady:boolean;materialReady:boolean;prepublicationValid:boolean;now?:Date}) {
 const a=record(input.authority),b=record(a.binding),r=record(input.revision),i=record(input.inventory)
 const now=input.now??new Date(), rb=record(record(r.snapshot).binding)
 const bindingValid=a.version==='CURRENT_PUBLICATION_EXECUTION_CONTRACT_V1' && a.valid===true &&
  b.publicationId===r.publicationId && b.packageId===r.packageId && b.accountKey===r.accountKey &&
  b.packageHash===r.packageHash && b.packageGeneration===r.packageGeneration && b.previewGeneration===r.packageGeneration &&
  b.previewHash===r.previewHash && r.previewHash===digest(r.preview) && r.packageHash===digest(r.snapshot) &&
  b.productId===rb.PRODUCT_ID && b.variantId===rb.VARIANT_ID && b.supplierSku===rb.SKU &&
  b.sku===record(r.preview).sku && b.opportunityId===rb.OPPORTUNITY_ID && b.candidateKey===rb.CANDIDATE_KEY
 const fresh=i.inventoryReady===true && i.availability==='IN_STOCK' && i.freshness==='FRESH' &&
  Date.parse(String(i.observedAt))<=now.getTime() && Date.parse(String(i.freshUntil))>now.getTime()
 // One supplier variant is the existing certified single-component package;
 // quantityRequiredPerBundle is consumption per unit, never supplier stock.
 const stockguard=evaluatePublishWithStockguardContractV1({sellerSku:String(b.sku??''),expectedComponentCount:1,
  economicsReady:input.economicsReady,monitorEnrollmentIntentPrepared:bindingValid,
  components:bindingValid?[{productId:String(b.productId),variantId:String(b.variantId),supplierSku:String(b.supplierSku),
   canonicalLunaUrl:String(b.canonicalLunaUrl),quantityRequiredPerBundle:1,identityCertified:true,
   stockIdentityResolved:true,stockState:fresh?'IN_STOCK':'STOCK_UNKNOWN',sourceHealth:fresh?'HEALTHY':'UNPROVEN',
   freshness:fresh?'FRESH':'STALE',safeCapacity:null}]:[]})
 const blockers=[...(Array.isArray(a.blockers)?a.blockers.map(String):['CURRENT_EXECUTION_AUTHORITY_UNAVAILABLE']),
  ...(!bindingValid?['CURRENT_EXECUTION_BINDING_INVALID']:[]),...(!input.materialReady?['CURRENT_MATERIAL_AUTHORITY_NOT_READY']:[]),
  ...(!input.prepublicationValid?['CURRENT_PREPUBLICATION_EVIDENCE_REQUIRED']:[]),...stockguard.blockers,
  ...(a.unclaimed!==true?['CURRENT_PUBLICATION_ALREADY_CLAIMED_OR_NOT_PENDING']:[])]
 return {CURRENT_REVISION_PUBLISHER_ACTIVE:bindingValid,CURRENT_EXECUTION_CONTRACT_VALID:bindingValid&&stockguard.publishAllowed&&input.materialReady,
  EXECUTOR_CLAIMABLE:blockers.length===0,INTERNAL_EXECUTION_BLOCKER_COUNT:blockers.length,blockers,
  binding:b,stockguard,previewAgeAuthority:'CURRENT_MATERIAL_BINDING',operationalEvidenceFreshnessRequired:true}
}

export function applyCurrentExecutionParityV1<T extends {READY_TO_PUBLISH:boolean;blockingEvidence:readonly string[]}>(gate:T,execution:ReturnType<typeof currentPublicationExecutionContractV1>) {
 return {...gate,...execution,READY_TO_PUBLISH:gate.READY_TO_PUBLISH&&execution.EXECUTOR_CLAIMABLE,
  blockingEvidence:[...new Set([...gate.blockingEvidence,...execution.blockers])]}
}
