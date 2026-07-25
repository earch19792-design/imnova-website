-- VISUAL_STRATEGY_V3 persistent six-job orchestrator (staging-first, additive).
create table if not exists public.ebay_reference_guided_generation_attempts (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null,
  composition_manifest_hash text not null check (composition_manifest_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'PENDING' check (status in ('PENDING','GENERATING','READY_FOR_HUMAN_REVIEW','FAILED_RETRYABLE','BLOCKED','PROVIDER_OUTCOME_UNKNOWN','QUARANTINED')),
  expected_job_count integer not null default 6 check (expected_job_count = 6),
  completed_job_count integer not null default 0 check (completed_job_count between 0 and 6),
  provider_calls integer not null default 0 check (provider_calls >= 0),
  retry_consumed boolean not null default false,
  ebay_writes integer not null default 0 check (ebay_writes = 0),
  production_changed boolean not null default false check (production_changed = false),
  created_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz
);

create unique index if not exists ebay_reference_guided_attempt_revision_manifest_uidx
  on public.ebay_reference_guided_generation_attempts(revision_id, composition_manifest_hash);

create table if not exists public.ebay_reference_guided_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  generation_attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id) on delete cascade,
  position integer not null check (position between 1 and 6),
  commercial_role text not null,
  status text not null default 'PENDING' check (status in ('PENDING','RESERVED','PROVIDER_CALLING','GENERATED','QA_PENDING','PASSED','REJECTED_RETRYABLE','BLOCKED_FIDELITY','BLOCKED_FACTS','PROVIDER_RETRYABLE_ERROR','PROVIDER_OUTCOME_UNKNOWN','QUARANTINED')),
  source_main_hash text not null check (source_main_hash ~ '^[0-9a-f]{64}$'),
  source_side_hash text not null check (source_side_hash ~ '^[0-9a-f]{64}$'),
  prompt_hash text not null check (prompt_hash ~ '^[0-9a-f]{64}$'),
  market_visual_brief_hash text,
  product_dossier_hash text,
  provider_request_id text,
  provider_call_started_at timestamptz,
  provider_call_completed_at timestamptz,
  output_storage_path text,
  output_sha256 text,
  qa_result jsonb,
  error_code text,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (generation_attempt_id, position)
);

create index if not exists ebay_reference_guided_jobs_claim_idx
  on public.ebay_reference_guided_generation_jobs(generation_attempt_id, status, lease_expires_at, position);

alter table public.ebay_reference_guided_generation_attempts enable row level security;
alter table public.ebay_reference_guided_generation_jobs enable row level security;
revoke all on public.ebay_reference_guided_generation_attempts from anon, authenticated, public;
revoke all on public.ebay_reference_guided_generation_jobs from anon, authenticated, public;
grant select, insert, update on public.ebay_reference_guided_generation_attempts to service_role;
grant select, insert, update on public.ebay_reference_guided_generation_jobs to service_role;

create or replace function public.create_ebay_reference_guided_generation_attempt(
  p_revision_id uuid, p_manifest_hash text, p_roles text[], p_main_hash text,
  p_side_hash text, p_prompt_hashes text[], p_market_brief_hash text default null,
  p_product_dossier_hash text default null
) returns public.ebay_reference_guided_generation_attempts
language plpgsql security definer set search_path = public as $$
declare v_attempt public.ebay_reference_guided_generation_attempts;
begin
  if coalesce(array_length(p_roles,1),0) <> 6 or coalesce(array_length(p_prompt_hashes,1),0) <> 6 then
    raise exception 'REFERENCE_GUIDED_JOB_COUNT_INVALID';
  end if;
  insert into public.ebay_reference_guided_generation_attempts(revision_id, composition_manifest_hash)
  values (p_revision_id, p_manifest_hash)
  on conflict (revision_id, composition_manifest_hash) do update set revision_id = excluded.revision_id
  returning * into v_attempt;
  insert into public.ebay_reference_guided_generation_jobs(generation_attempt_id, position, commercial_role, source_main_hash, source_side_hash, prompt_hash, market_visual_brief_hash, product_dossier_hash)
  select v_attempt.id, n, p_roles[n], p_main_hash, p_side_hash, p_prompt_hashes[n], p_market_brief_hash, p_product_dossier_hash
  from generate_series(1,6) n
  on conflict (generation_attempt_id, position) do nothing;
  return v_attempt;
end $$;

create or replace function public.claim_ebay_reference_guided_generation_jobs(
  p_attempt_id uuid, p_manifest_hash text, p_lease_owner text, p_limit integer default 2,
  p_feature_enabled boolean default false
) returns setof public.ebay_reference_guided_generation_jobs
language plpgsql security definer set search_path = public as $$
begin
  if not p_feature_enabled then raise exception 'REFERENCE_GUIDED_GENERATION_DISABLED'; end if;
  return query
  with candidates as (
    select j.id from public.ebay_reference_guided_generation_jobs j
    join public.ebay_reference_guided_generation_attempts a on a.id=j.generation_attempt_id
    where j.generation_attempt_id=p_attempt_id and a.composition_manifest_hash=p_manifest_hash
      and j.status in ('PENDING','REJECTED_RETRYABLE')
      and (j.lease_expires_at is null or j.lease_expires_at < now())
    order by j.position limit greatest(1, least(p_limit,2)) for update skip locked
  )
  update public.ebay_reference_guided_generation_jobs j
  set status='RESERVED', lease_owner=p_lease_owner, lease_expires_at=now()+interval '5 minutes', updated_at=now()
  from candidates c where j.id=c.id returning j.*;
end $$;

revoke all on function public.create_ebay_reference_guided_generation_attempt(uuid,text,text[],text,text,text[],text,text) from public, anon, authenticated;
revoke all on function public.claim_ebay_reference_guided_generation_jobs(uuid,text,text,integer,boolean) from public, anon, authenticated;
grant execute on function public.create_ebay_reference_guided_generation_attempt(uuid,text,text[],text,text,text[],text,text) to service_role;
grant execute on function public.claim_ebay_reference_guided_generation_jobs(uuid,text,text,integer,boolean) to service_role;
