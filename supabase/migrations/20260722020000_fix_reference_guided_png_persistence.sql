-- Additive repair for the consumed position-1 canary. This migration performs
-- no provider, eBay or production operation and never resets provider_calls.

do $$
declare
  v_bucket storage.buckets%rowtype;
begin
  select * into v_bucket
  from storage.buckets
  where id = 'ebay-listing-image-staging'
  for update;
  if not found
    or v_bucket.public
    or v_bucket.file_size_limit <> 12582912
    or not (coalesce(v_bucket.allowed_mime_types, '{}') <@
      array['image/jpeg','image/png']::text[]) then
    raise exception 'REFERENCE_GUIDED_STAGING_BUCKET_INVARIANT_FAILED';
  end if;
  update storage.buckets
  set allowed_mime_types = array['image/jpeg','image/png']::text[]
  where id = 'ebay-listing-image-staging';
end;
$$;

alter table public.ebay_reference_guided_generation_jobs
  drop constraint if exists ebay_reference_guided_generation_jobs_status_check;
alter table public.ebay_reference_guided_generation_jobs
  add constraint ebay_reference_guided_generation_jobs_status_check check (
    status in ('PENDING','RESERVED','PROVIDER_CALLING','GENERATED','QA_PENDING',
      'PASSED','REJECTED_RETRYABLE','BLOCKED_FIDELITY','BLOCKED_FACTS',
      'PROVIDER_RETRYABLE_ERROR','PROVIDER_OUTCOME_UNKNOWN','QUARANTINED',
      'PROVIDER_SUCCEEDED_PERSISTENCE_FAILED')
  );

do $$
declare
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_updated integer;
begin
  select * into v_attempt
  from public.ebay_reference_guided_generation_attempts
  where id = 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid
  for update;
  if not found
    or v_attempt.provider_calls <> 1
    or v_attempt.retry_consumed
    or v_attempt.ebay_writes <> 0
    or v_attempt.production_changed then
    raise exception 'REFERENCE_GUIDED_ORIGINAL_PROVIDER_CALL_HISTORY_INVALID';
  end if;
  update public.ebay_reference_guided_generation_jobs
  set status = 'PROVIDER_SUCCEEDED_PERSISTENCE_FAILED',
      error_code = 'STORAGE_MIME_CONFIGURATION_DEFECT',
      lease_owner = null,
      lease_expires_at = null,
      updated_at = now()
  where generation_attempt_id = v_attempt.id
    and position = 1
    and commercial_role = 'MATERIAL_AND_FINISH_DETAIL'
    and status = 'PROVIDER_OUTCOME_UNKNOWN'
    and provider_request_id = 'req_31cfc5b2287440f6844abd213c98aad4'
    and output_storage_path is null
    and output_sha256 is null
    and error_code = 'REFERENCE_GUIDED_CANARY_PRIVATE_STORAGE_UPLOAD_FAILED';
  get diagnostics v_updated = row_count;
  if v_updated = 0 and exists (
    select 1 from public.ebay_reference_guided_generation_jobs
    where generation_attempt_id = v_attempt.id
      and position = 1
      and status = 'PROVIDER_SUCCEEDED_PERSISTENCE_FAILED'
      and error_code = 'STORAGE_MIME_CONFIGURATION_DEFECT'
      and provider_request_id = 'req_31cfc5b2287440f6844abd213c98aad4'
  ) then
    v_updated := 1;
  end if;
  if v_updated <> 1 then
    raise exception 'REFERENCE_GUIDED_PERSISTENCE_FAILURE_RECLASSIFICATION_FAILED';
  end if;
end;
$$;

-- Append-only authorization ledger for a possible one-call replacement.
-- No AUTHORIZED event is inserted here, so every replacement RPC remains
-- disabled until a later, explicit human-authorized migration/event.
create table if not exists public.ebay_reference_guided_replacement_canary_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  job_id uuid not null references public.ebay_reference_guided_generation_jobs(id),
  event_type text not null check (event_type in ('DISABLED','AUTHORIZED','CONSUMED','REVOKED')),
  authorization_event_id uuid null references public.ebay_reference_guided_replacement_canary_events(id),
  human_authorized_by uuid null references auth.users(id),
  human_authorized_at timestamptz null,
  human_confirmation_hash text null,
  provider_call_ordinal integer null check (provider_call_ordinal is null or provider_call_ordinal = 2),
  reason text not null,
  created_at timestamptz not null default now(),
  check (
    (event_type = 'AUTHORIZED' and authorization_event_id is null
      and human_authorized_by is not null and human_authorized_at is not null
      and human_confirmation_hash ~ '^[0-9a-f]{64}$'
      and provider_call_ordinal = 2)
    or
    (event_type <> 'AUTHORIZED' and human_authorized_by is null
      and human_authorized_at is null and human_confirmation_hash is null)
  ),
  check (
    (event_type in ('DISABLED','AUTHORIZED') and authorization_event_id is null)
    or
    (event_type in ('CONSUMED','REVOKED') and authorization_event_id is not null)
  )
);

create unique index if not exists ebay_reference_guided_one_replacement_authorization_uidx
  on public.ebay_reference_guided_replacement_canary_events(attempt_id, job_id)
  where event_type = 'AUTHORIZED';
create unique index if not exists ebay_reference_guided_one_replacement_consumption_uidx
  on public.ebay_reference_guided_replacement_canary_events(authorization_event_id)
  where event_type = 'CONSUMED';

create or replace function public.prevent_reference_guided_replacement_event_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'REFERENCE_GUIDED_REPLACEMENT_EVENTS_APPEND_ONLY';
end;
$$;
drop trigger if exists ebay_reference_guided_replacement_events_append_only
  on public.ebay_reference_guided_replacement_canary_events;
create trigger ebay_reference_guided_replacement_events_append_only
before update or delete on public.ebay_reference_guided_replacement_canary_events
for each row execute function public.prevent_reference_guided_replacement_event_mutation();

alter table public.ebay_reference_guided_replacement_canary_events enable row level security;
alter table public.ebay_reference_guided_replacement_canary_events force row level security;
revoke all on table public.ebay_reference_guided_replacement_canary_events
  from public, anon, authenticated, service_role;
grant select, insert on table public.ebay_reference_guided_replacement_canary_events
  to service_role;

insert into public.ebay_reference_guided_replacement_canary_events(
  attempt_id, job_id, event_type, reason
)
select a.id, j.id, 'DISABLED', 'AWAITING_EXPLICIT_HUMAN_AUTHORIZATION'
from public.ebay_reference_guided_generation_attempts a
join public.ebay_reference_guided_generation_jobs j
  on j.generation_attempt_id = a.id and j.position = 1
where a.id = 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid
  and not exists (
    select 1 from public.ebay_reference_guided_replacement_canary_events e
    where e.attempt_id = a.id and e.job_id = j.id and e.event_type = 'DISABLED'
  );

create or replace function public.claim_ebay_reference_guided_replacement_canary(
  p_attempt_id uuid,
  p_authorization_event_id uuid,
  p_human_confirmation_hash text,
  p_manifest_hash text,
  p_lease_owner text,
  p_feature_enabled boolean default false
) returns setof public.ebay_reference_guided_generation_jobs
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_authorization public.ebay_reference_guided_replacement_canary_events%rowtype;
begin
  if not p_feature_enabled then
    raise exception 'REFERENCE_GUIDED_REPLACEMENT_CANARY_DISABLED';
  end if;
  select * into v_authorization
  from public.ebay_reference_guided_replacement_canary_events
  where id = p_authorization_event_id and event_type = 'AUTHORIZED'
    and attempt_id = p_attempt_id
    and human_confirmation_hash = p_human_confirmation_hash
    and provider_call_ordinal = 2
  for share;
  if not found or exists (
    select 1 from public.ebay_reference_guided_replacement_canary_events e
    where e.authorization_event_id = v_authorization.id
      and e.event_type in ('CONSUMED','REVOKED')
  ) then
    raise exception 'REFERENCE_GUIDED_REPLACEMENT_HUMAN_AUTHORIZATION_REQUIRED';
  end if;
  if exists (
    select 1 from public.ebay_reference_guided_generation_jobs j
    where j.generation_attempt_id = p_attempt_id and j.position between 2 and 6
      and (j.status <> 'PENDING' or j.lease_owner is not null
        or j.lease_expires_at is not null or j.provider_request_id is not null
        or j.provider_call_started_at is not null)
  ) then
    raise exception 'REFERENCE_GUIDED_REPLACEMENT_SECONDARY_JOB_TOUCHED';
  end if;
  return query
  update public.ebay_reference_guided_generation_jobs j
  set status = 'RESERVED', lease_owner = p_lease_owner,
      lease_expires_at = now() + interval '5 minutes', updated_at = now()
  from public.ebay_reference_guided_generation_attempts a
  where a.id = p_attempt_id and a.id = j.generation_attempt_id
    and a.provider_calls = 1
    and a.composition_manifest_hash = p_manifest_hash
    and j.id = v_authorization.job_id
    and j.position = 1 and j.commercial_role = 'MATERIAL_AND_FINISH_DETAIL'
    and (j.status = 'PROVIDER_SUCCEEDED_PERSISTENCE_FAILED'
      or (j.status = 'RESERVED' and j.lease_expires_at < now()))
  returning j.*;
end;
$$;

create or replace function public.reserve_ebay_reference_guided_replacement_call(
  p_attempt_id uuid,
  p_job_id uuid,
  p_authorization_event_id uuid,
  p_human_confirmation_hash text,
  p_manifest_hash text,
  p_lease_owner text,
  p_exact_prompt_hash text,
  p_feature_enabled boolean default false
) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_authorization public.ebay_reference_guided_replacement_canary_events%rowtype;
  v_job public.ebay_reference_guided_generation_jobs%rowtype;
  v_calls integer;
begin
  if not p_feature_enabled then
    raise exception 'REFERENCE_GUIDED_REPLACEMENT_CANARY_DISABLED';
  end if;
  select * into v_authorization
  from public.ebay_reference_guided_replacement_canary_events
  where id = p_authorization_event_id and event_type = 'AUTHORIZED'
    and attempt_id = p_attempt_id and job_id = p_job_id
    and human_confirmation_hash = p_human_confirmation_hash
    and provider_call_ordinal = 2
  for update;
  if not found or exists (
    select 1 from public.ebay_reference_guided_replacement_canary_events e
    where e.authorization_event_id = v_authorization.id
      and e.event_type in ('CONSUMED','REVOKED')
  ) then
    raise exception 'REFERENCE_GUIDED_REPLACEMENT_HUMAN_AUTHORIZATION_REQUIRED';
  end if;
  select * into v_job from public.ebay_reference_guided_generation_jobs
  where id = p_job_id and generation_attempt_id = p_attempt_id for update;
  if not found or v_job.position <> 1
    or v_job.commercial_role <> 'MATERIAL_AND_FINISH_DETAIL'
    or v_job.status <> 'RESERVED'
    or v_job.lease_owner is distinct from p_lease_owner
    or v_job.lease_expires_at < now()
    or v_job.prompt_hash <> p_exact_prompt_hash
    or v_job.prompt_hash <> encode(
      extensions.digest(convert_to(v_job.exact_prompt_text, 'UTF8'), 'sha256'), 'hex')
    or exists (
      select 1 from public.ebay_reference_guided_generation_jobs j
      where j.generation_attempt_id = p_attempt_id and j.position between 2 and 6
        and (j.status <> 'PENDING' or j.lease_owner is not null
          or j.lease_expires_at is not null or j.provider_request_id is not null
          or j.provider_call_started_at is not null)
    ) then
    raise exception 'REFERENCE_GUIDED_REPLACEMENT_RESERVATION_INVALID';
  end if;
  update public.ebay_reference_guided_generation_attempts
  set provider_calls = provider_calls + 1
  where id = p_attempt_id and provider_calls = 1
    and composition_manifest_hash = p_manifest_hash
  returning provider_calls into v_calls;
  if v_calls <> 2 then
    raise exception 'REFERENCE_GUIDED_REPLACEMENT_BUDGET_INVALID';
  end if;
  insert into public.ebay_reference_guided_replacement_canary_events(
    attempt_id, job_id, event_type, authorization_event_id,
    provider_call_ordinal, reason
  ) values (
    p_attempt_id, p_job_id, 'CONSUMED', v_authorization.id,
    2, 'ATOMIC_PROVIDER_CALL_RESERVED'
  );
  update public.ebay_reference_guided_generation_jobs
  set status = 'PROVIDER_CALLING', provider_call_started_at = now(),
      provider_call_completed_at = null, provider_request_id = null,
      error_code = null, updated_at = now()
  where id = p_job_id;
  return v_calls;
end;
$$;

revoke all on function public.claim_ebay_reference_guided_replacement_canary(
  uuid, uuid, text, text, text, boolean
) from public, anon, authenticated;
revoke all on function public.reserve_ebay_reference_guided_replacement_call(
  uuid, uuid, uuid, text, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.claim_ebay_reference_guided_replacement_canary(
  uuid, uuid, text, text, text, boolean
) to service_role;
grant execute on function public.reserve_ebay_reference_guided_replacement_call(
  uuid, uuid, uuid, text, text, text, text, boolean
) to service_role;

notify pgrst, 'reload schema';
