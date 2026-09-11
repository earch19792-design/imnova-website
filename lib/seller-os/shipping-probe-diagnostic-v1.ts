import type { SupabaseClient } from '@supabase/supabase-js'
import { keywordRecord as record } from './keyword-intelligence-handoff-v1'

// Diagnostics only. Never authorizes a claim, binding change or capture.
export function shippingProbeDiagnosticV1(value:unknown) {
 const p=record(value)
 const valid=p.contract==='LUNA_CAPTURE_READ_ONLY_PROBE_V1' &&
  ['captureAvailable','canonicalBindingPresent','checkoutDomReady'].every(k=>typeof p[k]==='boolean') &&
  Number.isFinite(Date.parse(String(p.observedAt))) && p.captureAvailable===(p.canonicalBindingPresent&&p.checkoutDomReady)
 if(!valid)return null
 return {version:'SHIPPING_EXISTING_PROBE_DIAGNOSTIC_V1',observedAt:String(p.observedAt),
  canonicalBindingPresent:p.canonicalBindingPresent,checkoutDomReady:p.checkoutDomReady,captureAvailable:p.captureAvailable,
  reason:p.captureAvailable?'AVAILABLE':p.canonicalBindingPresent?'SHOP_PAY_NOT_READY':'CANONICAL_BINDING_NOT_PROVEN',
  // Extension catch paths also report false binding; do not claim proven loss.
  captureAuthorized:false}
}

export async function persistExistingShippingProbeDiagnosticV1(input:{supabase:SupabaseClient;accountKey:string;workerId:string;leaderSessionId:string;probe:unknown;gate:unknown;now?:Date}) {
 const gate=record(input.gate),d=shippingProbeDiagnosticV1(input.probe)
 if(!d||gate.reasonCode||gate.state!==(d.captureAvailable?'AVAILABLE':'UNAVAILABLE'))return false
 const result=await input.supabase.from('seller_os_browser_workload_leases_v1')
  .update({shipping_probe_diagnostic:d}).eq('marketplace_account_key',input.accountKey)
  .eq('worker_family','LUNA_SHIPPING').eq('worker_instance_id',input.workerId)
  .eq('leader_session_id',input.leaderSessionId).eq('shipping_capability_worker_id',input.workerId)
  .eq('shipping_capability_observed_at',d.observedAt)
  .gt('lease_expires_at',(input.now??new Date()).toISOString())
  .select('shipping_probe_diagnostic').maybeSingle()
 return !result.error&&Boolean(result.data)
}
