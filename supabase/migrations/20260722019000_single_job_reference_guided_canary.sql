-- Single-job canary envelope. This migration creates no lease, reserves no
-- provider budget and performs no provider/eBay/production operation.

create or replace function public.claim_ebay_reference_guided_canary_job(
  p_attempt_id uuid,
  p_manifest_hash text,
  p_lease_owner text,
  p_feature_enabled boolean default false
) returns setof public.ebay_reference_guided_generation_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_job_count integer;
  v_active_leases integer;
begin
  if not p_feature_enabled then
    raise exception 'REFERENCE_GUIDED_GENERATION_DISABLED';
  end if;
  select * into v_attempt
  from public.ebay_reference_guided_generation_attempts
  where id = p_attempt_id
  for update;
  if not found then raise exception 'REFERENCE_GUIDED_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.status <> 'PENDING'
    or v_attempt.provider_calls <> 0
    or v_attempt.max_provider_calls <> 6
    or v_attempt.composition_manifest_hash <> p_manifest_hash
    or v_attempt.composition_manifest_text is null
    or v_attempt.composition_manifest_hash <> encode(
      extensions.digest(
        convert_to(v_attempt.composition_manifest_text, 'UTF8'), 'sha256'
      ), 'hex'
    ) then
    raise exception 'REFERENCE_GUIDED_CANARY_MANIFEST_MISMATCH';
  end if;
  select count(*), count(*) filter (
    where status in ('RESERVED','PROVIDER_CALLING')
      and lease_expires_at >= now()
  ) into v_job_count, v_active_leases
  from public.ebay_reference_guided_generation_jobs
  where generation_attempt_id = p_attempt_id;
  if v_job_count <> 6 or v_active_leases <> 0 then
    raise exception 'REFERENCE_GUIDED_CANARY_JOB_SET_INVALID';
  end if;
  if exists (
    select 1
    from public.ebay_reference_guided_generation_jobs j
    where j.generation_attempt_id = p_attempt_id
      and (
        j.status <> 'PENDING'
        or j.lease_owner is not null
        or j.lease_expires_at is not null
        or j.provider_request_id is not null
        or j.provider_call_started_at is not null
        or j.exact_prompt_text is null
        or j.prompt_hash <> encode(
          extensions.digest(convert_to(j.exact_prompt_text, 'UTF8'), 'sha256'),
          'hex'
        )
      )
  ) then
    raise exception 'REFERENCE_GUIDED_CANARY_JOB_SET_INVALID';
  end if;
  return query
  update public.ebay_reference_guided_generation_jobs j
  set status = 'RESERVED', lease_owner = p_lease_owner,
      lease_expires_at = now() + interval '5 minutes', updated_at = now()
  where j.generation_attempt_id = p_attempt_id
    and j.position = 1
    and j.commercial_role = 'MATERIAL_AND_FINISH_DETAIL'
    and j.status = 'PENDING'
  returning j.*;
end;
$$;

create or replace function public.reserve_ebay_reference_guided_canary_call(
  p_attempt_id uuid,
  p_job_id uuid,
  p_manifest_hash text,
  p_lease_owner text,
  p_exact_prompt_hash text,
  p_feature_enabled boolean default false
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_job public.ebay_reference_guided_generation_jobs%rowtype;
  v_provider_calls integer;
begin
  if not p_feature_enabled then
    raise exception 'REFERENCE_GUIDED_GENERATION_DISABLED';
  end if;
  select * into v_attempt
  from public.ebay_reference_guided_generation_attempts
  where id = p_attempt_id
  for update;
  if not found then raise exception 'REFERENCE_GUIDED_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.status <> 'PENDING'
    or v_attempt.provider_calls <> 0
    or v_attempt.max_provider_calls <> 6
    or v_attempt.composition_manifest_hash <> p_manifest_hash
    or v_attempt.composition_manifest_text is null
    or v_attempt.composition_manifest_hash <> encode(
      extensions.digest(
        convert_to(v_attempt.composition_manifest_text, 'UTF8'), 'sha256'
      ), 'hex'
    ) then
    raise exception 'REFERENCE_GUIDED_CANARY_MANIFEST_MISMATCH';
  end if;
  select * into v_job
  from public.ebay_reference_guided_generation_jobs
  where id = p_job_id and generation_attempt_id = p_attempt_id
  for update;
  if not found
    or v_job.position <> 1
    or v_job.commercial_role <> 'MATERIAL_AND_FINISH_DETAIL'
    or v_job.status <> 'RESERVED'
    or v_job.lease_owner is distinct from p_lease_owner
    or v_job.lease_expires_at < now()
    or v_job.prompt_hash <> p_exact_prompt_hash
    or v_job.exact_prompt_text is null
    or v_job.prompt_hash <> encode(
      extensions.digest(convert_to(v_job.exact_prompt_text, 'UTF8'), 'sha256'),
      'hex'
    ) then
    raise exception 'REFERENCE_GUIDED_CANARY_RESERVATION_INVALID';
  end if;
  if exists (
    select 1
    from public.ebay_reference_guided_generation_jobs j
    where j.generation_attempt_id = p_attempt_id
      and j.position between 2 and 6
      and (
        j.status <> 'PENDING'
        or j.lease_owner is not null
        or j.lease_expires_at is not null
        or j.provider_request_id is not null
        or j.provider_call_started_at is not null
      )
  ) then
    raise exception 'REFERENCE_GUIDED_CANARY_SECONDARY_JOB_TOUCHED';
  end if;
  update public.ebay_reference_guided_generation_attempts
  set provider_calls = provider_calls + 1, status = 'GENERATING',
      started_at = coalesce(started_at, now())
  where id = p_attempt_id
    and provider_calls = 0
    and max_provider_calls = 6
  returning provider_calls into v_provider_calls;
  if v_provider_calls <> 1 then
    raise exception 'REFERENCE_GUIDED_CANARY_PROVIDER_BUDGET_EXHAUSTED';
  end if;
  update public.ebay_reference_guided_generation_jobs
  set status = 'PROVIDER_CALLING', provider_call_started_at = now(),
      updated_at = now()
  where id = p_job_id;
  return v_provider_calls;
end;
$$;

-- During the canary window service_role cannot use the six-job claim/reserve
-- RPCs. A later reviewed migration must explicitly reopen the full E2E path.
revoke execute on function public.claim_ebay_reference_guided_generation_jobs(
  uuid, text, text, integer, boolean
) from service_role;
revoke execute on function public.reserve_ebay_reference_guided_provider_call(
  uuid, uuid, text, text, text, boolean
) from service_role;
revoke all on function public.claim_ebay_reference_guided_canary_job(
  uuid, text, text, boolean
) from public, anon, authenticated;
revoke all on function public.reserve_ebay_reference_guided_canary_call(
  uuid, uuid, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.claim_ebay_reference_guided_canary_job(
  uuid, text, text, boolean
) to service_role;
grant execute on function public.reserve_ebay_reference_guided_canary_call(
  uuid, uuid, text, text, text, boolean
) to service_role;

notify pgrst, 'reload schema';
