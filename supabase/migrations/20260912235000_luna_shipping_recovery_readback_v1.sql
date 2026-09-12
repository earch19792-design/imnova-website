-- Service-role readback for one exact Shipping recovery attempt. The source
-- frontier ledger is immutable and forced-RLS; callers receive only a bounded
-- identity/count receipt, never raw checkout or credential material.
create or replace function public.get_seller_os_luna_shipping_recovery_readback_v1(
  p_account_key text,
  p_candidate_id text,
  p_capture_session_id uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_count integer;
  v_frontier_id text;
begin
  if not public.is_seller_os_service_role_request_v1()
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_candidate_id !~ '^sha256:[0-9a-f]{64}$'
    or p_capture_session_id is null then
    raise exception 'SELLER_OS_LUNA_SHIPPING_RECOVERY_READBACK_INVALID';
  end if;
  select count(*)::integer,max(frontier_id)
  into v_count,v_frontier_id
  from public.seller_os_profitability_frontier_snapshots
  where account_key=p_account_key
    and shipping_status='SHIPPING_DURABLY_PERSISTED'
    and frontier_payload->'shippingCaptureEvidence'->>'candidateId'=
      p_candidate_id
    and frontier_payload->'shippingCaptureEvidence'->>'captureSessionId'=
      p_capture_session_id::text;
  return jsonb_build_object(
    'exactResultCount',v_count,
    'exactDurableReadbackMatch',v_count=1,
    'frontierId',case when v_count=1 then v_frontier_id else null end,
    'captureResultDurable',v_count=1,
    'rawCheckoutMaterialReturned',false,
    'credentialMaterialReturned',false
  );
end; $$;

revoke all on function
  public.get_seller_os_luna_shipping_recovery_readback_v1(text,text,uuid)
  from public,anon,authenticated;
grant execute on function
  public.get_seller_os_luna_shipping_recovery_readback_v1(text,text,uuid)
  to service_role;

comment on function
  public.get_seller_os_luna_shipping_recovery_readback_v1(text,text,uuid)
is 'Fail-closed service-role readback of exactly one immutable durable Shipping result for an exact candidate/capture attempt.';
