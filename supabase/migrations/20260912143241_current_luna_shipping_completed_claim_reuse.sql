create or replace function public.claim_seller_os_luna_shipping_job_v1(
  p_account_key text,
  p_candidate_id text,
  p_snapshot_digest text,
  p_runtime_instance_id uuid,
  p_capture_session_id uuid
)
returns table (
  claimed boolean,
  claim_status text,
  lease_expires_at timestamptz
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_now timestamptz := statement_timestamp();
begin
  if p_account_key is null or
      p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$' or
      p_candidate_id is null or
      p_candidate_id !~ '^sha256:[0-9a-f]{64}$' or
      p_snapshot_digest is null or
      p_snapshot_digest !~ '^sha256:[0-9a-f]{64}$' or
      p_runtime_instance_id is null or p_capture_session_id is null then
    raise exception 'SELLER_OS_LUNA_SHIPPING_CLAIM_INPUT_INVALID';
  end if;

  return query
  insert into public.seller_os_luna_shipping_job_claims as claims (
    account_key, candidate_id, snapshot_digest, runtime_instance_id,
    capture_session_id, status, claimed_at, lease_expires_at, completed_at,
    updated_at
  ) values (
    p_account_key, p_candidate_id, p_snapshot_digest, p_runtime_instance_id,
    p_capture_session_id, 'CLAIMED', v_now, v_now + interval '15 minutes',
    null, v_now
  )
  on conflict (account_key, candidate_id) do update set
    snapshot_digest = excluded.snapshot_digest,
    runtime_instance_id = excluded.runtime_instance_id,
    capture_session_id = excluded.capture_session_id,
    status = 'CLAIMED',
    claimed_at = v_now,
    lease_expires_at = v_now + interval '15 minutes',
    completed_at = null,
    updated_at = v_now
  where claims.status = 'COMPLETED'
     or claims.snapshot_digest <> excluded.snapshot_digest
     or (claims.status = 'CLAIMED' and claims.lease_expires_at <= v_now)
  returning true, claims.status, claims.lease_expires_at;

  if found then return; end if;

  return query
  select false, claims.status, claims.lease_expires_at
  from public.seller_os_luna_shipping_job_claims as claims
  where claims.account_key = p_account_key
    and claims.candidate_id = p_candidate_id;
end;
$function$;

revoke all on function public.claim_seller_os_luna_shipping_job_v1(
  text, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_seller_os_luna_shipping_job_v1(
  text, text, text, uuid, uuid) to service_role;

comment on function public.claim_seller_os_luna_shipping_job_v1(
  text, text, text, uuid, uuid) is
  'Reuses the exact candidate claim row after a completed quote becomes stale; active leases remain single-flight.';
