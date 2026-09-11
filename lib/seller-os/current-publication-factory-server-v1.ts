import type {SupabaseClient} from '@supabase/supabase-js'
import {keywordRecord as record} from './keyword-intelligence-handoff-v1'
import {currentFactoryMarkerV1} from './current-publication-factory-v1'

// Exact identities only. SQL owns concurrency/dedup and never accepts a payload,
// Offer, historical approval or caller-provided evidence as preparation authority.
export async function beginCurrentPublicationPackageV1(input:{supabase:SupabaseClient;accountKey:string;opportunityId:string;candidateKey:string}){
 const r=await input.supabase.rpc('begin_current_publication_package_v1',{
  p_account_key:input.accountKey,p_opportunity_id:input.opportunityId,p_candidate_key:input.candidateKey,
 }).abortSignal(AbortSignal.timeout(8000)).retry(false)
 if(r.error)throw Error('CURRENT_FACTORY_INTAKE_UNAVAILABLE')
 const result=record(r.data),p=record(result.package),m=currentFactoryMarkerV1(p.package_data)
 if(!m || p.account_key!==input.accountKey || p.opportunity_id!==input.opportunityId || p.candidate_key!==input.candidateKey || m.packageId!==p.id){
  throw Error(String(result.reason??'CURRENT_FACTORY_INTAKE_READBACK_MISMATCH'))
 }
 return {listingPackage:p,packageCreated:result.packageCreated===true}
}
