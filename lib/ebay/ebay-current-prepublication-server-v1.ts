import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readPublicationRevisionPreflightV1 } from './ebay-publication-revision-preflight-readonly-v1'
import { currentPrepublicationProofV1, currentPrepublicationBindingV1 } from '../seller-os/publication-prevalidation-boundary-v1'
import { keywordRecord as record,keywordWireDigestV1 as digest } from '../seller-os/keyword-intelligence-handoff-v1'

/** Existing preparation lane: one CURRENT evaluation, one compare-and-set of
 * its existing metadata, then durable readback. Never grants/claims publish. */
export async function certifyCurrentPrepublicationV1(input:{supabase:SupabaseClient;packageId:string;accountKey:string;actor:string}, readPreflight=readPublicationRevisionPreflightV1) {
 const columns='id,actor_user_id,listing_package_id,marketplace_account_key,sku,offer_id,phase,publication_idempotency_key,listing_id,draft_execution_id,sanitized_result,updated_at'
 const read=()=>input.supabase.from('ebay_authorized_listing_publications').select(columns)
  .eq('listing_package_id',input.packageId).eq('marketplace_account_key',input.accountKey).eq('actor_user_id',input.actor)
  .limit(2).abortSignal(AbortSignal.timeout(8000)).retry(false)
 const before=await read()
 if(before.error || before.data?.length!==1)throw Error('ONE_CURRENT_PUBLICATION_REQUIRED')
 const pub=before.data[0]
 const preflight=await readPreflight(input.packageId)
 const proof={...preflight.prepublicationEvidence,feeStructure:preflight.feeStructure,economics:preflight.economics}
 if(!currentPrepublicationBindingV1(pub,proof))return {pass:false,preflight,durableReadbackPass:false,publicationWrites:0}
 const sanitized=record(pub.sanitized_result),prep=record(sanitized.publicationPreparationV1)
 const next={...sanitized,publicationPreparationV1:{...prep,prepublicationEvidenceV1:proof}}
 const saved=await input.supabase.from('ebay_authorized_listing_publications').update({sanitized_result:next,updated_at:new Date().toISOString()})
  .eq('id',pub.id).eq('updated_at',pub.updated_at).eq('phase','preview_ready')
  .eq('draft_execution_id',pub.draft_execution_id).is('publication_idempotency_key',null).is('listing_id',null)
  .select('id').abortSignal(AbortSignal.timeout(8000)).retry(false)
 // Even on an ambiguous database response, read before reporting; never retry.
 const after=await read(),actual=after.data?.length===1?after.data[0]:null
 const stored=record(record(record(actual?.sanitized_result).publicationPreparationV1).prepublicationEvidenceV1)
 const durableReadbackPass=!after.error && currentPrepublicationBindingV1(actual,stored) && digest(stored)===digest(proof)
 if(!durableReadbackPass)throw Error(saved.error?'PREPUBLICATION_PERSISTENCE_UNCONFIRMED_READBACK_REQUIRED':'PREPUBLICATION_CONCURRENT_REVISION_OR_READBACK_MISMATCH')
 return {pass:currentPrepublicationProofV1(actual,stored),preflight,durableReadbackPass,currentPrepublicationEvidenceBound:true,publicationWrites:0,marketplaceWrites:0}
}
