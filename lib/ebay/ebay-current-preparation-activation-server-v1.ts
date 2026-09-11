import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readPublicationRevisionPreflightV1 } from './ebay-publication-revision-preflight-readonly-v1'
import { currentPreparationActivationEvidenceV1, currentPreparationActivationReadbackV1 } from './ebay-current-preparation-activation-v1'

export async function activateCurrentPreparationV1(input:{supabase:SupabaseClient;packageId:string;accountKey:string;actor:string}) {
 const preflight=await readPublicationRevisionPreflightV1(input.packageId)
 const read=await input.supabase.from('ebay_authorized_listing_publications')
  .select('id,actor_user_id,listing_package_id,marketplace_account_key,account_fingerprint,sku,offer_id,phase,publish_attempt_count,publication_idempotency_key,claim_token,listing_id,sanitized_result')
  .eq('id',preflight.publicationId).eq('actor_user_id',input.actor).eq('marketplace_account_key',input.accountKey).single()
  .abortSignal(AbortSignal.timeout(8000)).retry(false)
 if(read.error)throw Error('CURRENT_ACTIVATION_PUBLICATION_READ_FAILED')
 const evidence=currentPreparationActivationEvidenceV1(read.data,preflight)
 const saved=await input.supabase.rpc('activate_current_publication_preparation_v1',{
  p_publication_id:preflight.publicationId,p_actor:input.actor,p_account_key:input.accountKey,p_evidence:evidence,
 }).abortSignal(AbortSignal.timeout(8000)).retry(false)
 if(saved.error)throw Error(String(saved.error.message).match(/^[A-Z0-9_]+$/)?saved.error.message:'CURRENT_ACTIVATION_PERSISTENCE_UNCONFIRMED_READBACK_REQUIRED')
 // A committed RPC response alone is not a readback. Timeout never retries.
 const after=await input.supabase.from('ebay_authorized_listing_publications')
  .select('id,actor_user_id,listing_package_id,marketplace_account_key,account_fingerprint,sku,offer_id,phase,publish_attempt_count,publication_idempotency_key,claim_token,listing_id,sanitized_result,preview,preview_hash,draft_execution_id,draft_approval_id')
  .eq('id',preflight.publicationId).eq('actor_user_id',input.actor).eq('marketplace_account_key',input.accountKey).single()
  .abortSignal(AbortSignal.timeout(8000)).retry(false)
 if(after.error)throw Error('CURRENT_ACTIVATION_DURABLE_READBACK_REQUIRED')
 const [execution,approval]=await Promise.all([
  input.supabase.from('ebay_draft_only_execution_ledger').select('id,approval_id,actor_user_id,listing_package_id,account_fingerprint,phase,sku,offer_id,request_hash,sanitized_result')
   .eq('id',after.data.draft_execution_id).single().abortSignal(AbortSignal.timeout(8000)).retry(false),
  input.supabase.from('ebay_draft_only_approvals').select('id,actor_user_id,listing_package_id,account_fingerprint,status,payload_hash,approved_payload,approval_phrase_version')
   .eq('id',after.data.draft_approval_id).single().abortSignal(AbortSignal.timeout(8000)).retry(false),
 ])
 if(execution.error || approval.error || !currentPreparationActivationReadbackV1(after.data,execution.data,approval.data))
  throw Error('CURRENT_ACTIVATION_DURABLE_READBACK_MISMATCH')
 return {activation:saved.data,currentPreparationLedgerActivated:true,currentRevisionPublisherActive:true,
  durableReadbackPass:true,historicalExecutionReused:false,preflight,publicationWrites:0,marketplaceWrites:0}
}
