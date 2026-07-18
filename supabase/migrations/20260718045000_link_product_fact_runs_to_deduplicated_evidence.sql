-- A product-fact rerun intentionally reuses identical candidate facts. The
-- canonical source/fact/requirement/gate remains immutable, while this
-- append-only junction records that the new run consumed that exact evidence.

create table if not exists public.marketplace_product_fact_run_evidence_links (
  id uuid primary key default gen_random_uuid(),
  fact_run_id uuid not null references public.marketplace_product_fact_runs(id) on delete restrict,
  queue_item_id uuid not null references public.marketplace_listing_approval_queue_items(id) on delete restrict,
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  artifact_type text not null,
  source_snapshot_id uuid null references public.marketplace_product_fact_source_snapshots(id) on delete restrict,
  observation_id uuid null references public.marketplace_product_fact_observations(id) on delete restrict,
  resolution_id uuid null references public.marketplace_product_fact_resolutions(id) on delete restrict,
  requirement_id uuid null references public.marketplace_product_fact_requirements(id) on delete restrict,
  readiness_event_id uuid null references public.marketplace_product_fact_readiness_events(id) on delete restrict,
  canonical_fact_run_id uuid not null references public.marketplace_product_fact_runs(id) on delete restrict,
  artifact_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_product_fact_run_evidence_links_marketplace_check check (marketplace = 'EBAY_US'),
  constraint marketplace_product_fact_run_evidence_links_artifact_check check (
    (artifact_type = 'SOURCE_SNAPSHOT' and source_snapshot_id is not null and observation_id is null and resolution_id is null and requirement_id is null and readiness_event_id is null)
    or
    (artifact_type = 'OBSERVATION' and source_snapshot_id is null and observation_id is not null and resolution_id is null and requirement_id is null and readiness_event_id is null)
    or
    (artifact_type = 'RESOLUTION' and source_snapshot_id is null and resolution_id is not null and observation_id is null and requirement_id is null and readiness_event_id is null)
    or
    (artifact_type = 'REQUIREMENT' and source_snapshot_id is null and resolution_id is null and observation_id is null and requirement_id is not null and readiness_event_id is null)
    or
    (artifact_type = 'READINESS_EVENT' and source_snapshot_id is null and resolution_id is null and observation_id is null and requirement_id is null and readiness_event_id is not null)
  ),
  constraint marketplace_product_fact_run_evidence_links_hash_check check (artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint marketplace_product_fact_run_evidence_links_unique unique (fact_run_id, artifact_type, artifact_hash)
);

create index if not exists marketplace_product_fact_run_evidence_links_candidate_idx
  on public.marketplace_product_fact_run_evidence_links
  (marketplace_account_key, queue_item_id, fact_run_id, artifact_type);

create or replace function public.validate_product_fact_run_evidence_link()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_fact_run_id uuid;
  v_queue_item_id uuid;
  v_account_key text;
  v_marketplace text;
  v_artifact_hash text;
  v_current_queue_run_id uuid;
  v_current_account_key text;
  v_current_marketplace text;
  v_item_queue_run_id uuid;
  v_item_account_key text;
  v_item_marketplace text;
begin
  select queue_run_id, marketplace_account_key, marketplace
    into v_current_queue_run_id, v_current_account_key, v_current_marketplace
  from public.marketplace_product_fact_runs
  where id = new.fact_run_id;

  select run_id, marketplace_account_key, marketplace
    into v_item_queue_run_id, v_item_account_key, v_item_marketplace
  from public.marketplace_listing_approval_queue_items
  where id = new.queue_item_id;

  if v_current_queue_run_id is null or v_item_queue_run_id is null then
    raise exception 'PRODUCT_FACT_RUN_EVIDENCE_CURRENT_SCOPE_MISSING';
  end if;
  if v_current_queue_run_id is distinct from v_item_queue_run_id
    or v_current_account_key is distinct from new.marketplace_account_key
    or v_current_marketplace is distinct from new.marketplace
    or v_item_account_key is distinct from new.marketplace_account_key
    or v_item_marketplace is distinct from new.marketplace then
    raise exception 'PRODUCT_FACT_RUN_EVIDENCE_CURRENT_SCOPE_MISMATCH';
  end if;

  if new.artifact_type = 'SOURCE_SNAPSHOT' then
    select fact_run_id, queue_item_id, marketplace_account_key, marketplace, evidence_hash
      into v_fact_run_id, v_queue_item_id, v_account_key, v_marketplace, v_artifact_hash
    from public.marketplace_product_fact_source_snapshots
    where id = new.source_snapshot_id;
  elsif new.artifact_type = 'OBSERVATION' then
    select fact_run_id, queue_item_id, marketplace_account_key, marketplace, evidence_hash
      into v_fact_run_id, v_queue_item_id, v_account_key, v_marketplace, v_artifact_hash
    from public.marketplace_product_fact_observations
    where id = new.observation_id;
  elsif new.artifact_type = 'RESOLUTION' then
    select fact_run_id, queue_item_id, marketplace_account_key, marketplace, resolution_hash
      into v_fact_run_id, v_queue_item_id, v_account_key, v_marketplace, v_artifact_hash
    from public.marketplace_product_fact_resolutions
    where id = new.resolution_id;
  elsif new.artifact_type = 'REQUIREMENT' then
    select fact_run_id, queue_item_id, marketplace_account_key, marketplace, requirement_hash
      into v_fact_run_id, v_queue_item_id, v_account_key, v_marketplace, v_artifact_hash
    from public.marketplace_product_fact_requirements
    where id = new.requirement_id;
  elsif new.artifact_type = 'READINESS_EVENT' then
    select fact_run_id, queue_item_id, marketplace_account_key, marketplace, event_hash
      into v_fact_run_id, v_queue_item_id, v_account_key, v_marketplace, v_artifact_hash
    from public.marketplace_product_fact_readiness_events
    where id = new.readiness_event_id;
  else
    raise exception 'PRODUCT_FACT_RUN_EVIDENCE_TYPE_INVALID';
  end if;

  if v_fact_run_id is null then
    raise exception 'PRODUCT_FACT_RUN_EVIDENCE_TARGET_MISSING';
  end if;
  if v_fact_run_id is distinct from new.canonical_fact_run_id
    or v_queue_item_id is distinct from new.queue_item_id
    or v_account_key is distinct from new.marketplace_account_key
    or v_marketplace is distinct from new.marketplace
    or v_artifact_hash is distinct from new.artifact_hash then
    raise exception 'PRODUCT_FACT_RUN_EVIDENCE_LINK_MISMATCH';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_product_fact_run_evidence_link() from public, anon, authenticated;

create trigger marketplace_product_fact_run_evidence_links_validate
before insert on public.marketplace_product_fact_run_evidence_links
for each row execute function public.validate_product_fact_run_evidence_link();

create trigger marketplace_product_fact_run_evidence_links_append_only
before update or delete on public.marketplace_product_fact_run_evidence_links
for each row execute function public.reject_product_fact_mutation();

alter table public.marketplace_product_fact_run_evidence_links enable row level security;
alter table public.marketplace_product_fact_run_evidence_links force row level security;
revoke all on table public.marketplace_product_fact_run_evidence_links from public, anon, authenticated, service_role;
grant select, insert on table public.marketplace_product_fact_run_evidence_links to service_role;

comment on table public.marketplace_product_fact_run_evidence_links is
  'Append-only run-to-canonical-fact evidence. Reprocessing reuses identical facts without losing current-run provenance.';

-- A run is created as RUNNING because its child facts require its id. It may
-- become terminal only through this audited RPC after the evidence links prove
-- that every processed candidate has a complete minimum provenance chain.
create or replace function public.reject_product_fact_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'marketplace_product_fact_runs'
    and tg_op = 'UPDATE'
    and current_setting('seller_os.product_fact_finalize', true) = 'authorized'
    and old.status = 'RUNNING'
    and new.status in ('COMPLETED', 'PARTIAL', 'FAILED')
    and new.id = old.id
    and new.queue_run_id = old.queue_run_id
    and new.marketplace_account_key = old.marketplace_account_key
    and new.marketplace = old.marketplace
    and new.engine_version = old.engine_version
    and new.candidate_limit = old.candidate_limit
    and new.candidates_requested = old.candidates_requested
    and new.openai_calls = 0
    and new.ebay_writes = 0
    and new.production_changed = false
    and new.started_at = old.started_at
    and new.created_at = old.created_at
    and new.completed_at is not null then
    return new;
  end if;
  raise exception 'PRODUCT_FACTS_APPEND_ONLY';
end;
$$;

create or replace function public.finalize_product_fact_run_v1(
  p_run_id uuid,
  p_status text,
  p_candidates_processed integer,
  p_candidates_excluded integer,
  p_source_reads jsonb,
  p_completed_at timestamptz default clock_timestamp()
)
returns public.marketplace_product_fact_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.marketplace_product_fact_runs%rowtype;
  v_ready_candidates integer := 0;
begin
  if p_status not in ('COMPLETED', 'PARTIAL', 'FAILED')
    or p_candidates_processed < 0
    or p_candidates_excluded < 0
    or jsonb_typeof(coalesce(p_source_reads, '{}'::jsonb)) <> 'object' then
    raise exception 'PRODUCT_FACT_RUN_FINALIZATION_INVALID';
  end if;

  select * into v_run
  from public.marketplace_product_fact_runs
  where id = p_run_id
  for update;
  if v_run.id is null then
    raise exception 'PRODUCT_FACT_RUN_FINALIZATION_MISSING';
  end if;
  if v_run.status <> 'RUNNING' then
    if v_run.status = p_status
      and v_run.candidates_processed = p_candidates_processed
      and v_run.candidates_excluded = p_candidates_excluded then
      return v_run;
    end if;
    raise exception 'PRODUCT_FACT_RUN_ALREADY_FINALIZED';
  end if;
  if p_candidates_processed + p_candidates_excluded > v_run.candidates_requested
    or (p_status in ('COMPLETED', 'PARTIAL')
      and p_candidates_processed + p_candidates_excluded <> v_run.candidates_requested) then
    raise exception 'PRODUCT_FACT_RUN_FINALIZATION_COUNT_MISMATCH';
  end if;

  if p_status in ('COMPLETED', 'PARTIAL') and p_candidates_processed > 0 then
    select count(*) into v_ready_candidates
    from (
      select link.queue_item_id
      from public.marketplace_product_fact_run_evidence_links link
      where link.fact_run_id = p_run_id
      group by link.queue_item_id
      having bool_or(link.artifact_type = 'SOURCE_SNAPSHOT')
        and bool_or(link.artifact_type = 'OBSERVATION')
        and bool_or(link.artifact_type = 'RESOLUTION')
        and bool_or(link.artifact_type = 'READINESS_EVENT')
    ) complete_candidate;
    if v_ready_candidates <> p_candidates_processed then
      raise exception 'PRODUCT_FACT_RUN_EVIDENCE_NOT_COMPLETE';
    end if;
  end if;

  perform set_config('seller_os.product_fact_finalize', 'authorized', true);
  update public.marketplace_product_fact_runs
  set candidates_processed = p_candidates_processed,
      candidates_excluded = p_candidates_excluded,
      source_reads = coalesce(p_source_reads, '{}'::jsonb),
      status = p_status,
      completed_at = p_completed_at
  where id = p_run_id
  returning * into v_run;
  return v_run;
end;
$$;

revoke all on function public.finalize_product_fact_run_v1(uuid,text,integer,integer,jsonb,timestamptz)
  from public, anon, authenticated;
grant execute on function public.finalize_product_fact_run_v1(uuid,text,integer,integer,jsonb,timestamptz)
  to service_role;

comment on function public.finalize_product_fact_run_v1(uuid,text,integer,integer,jsonb,timestamptz) is
  'Finalizes a RUNNING Product Facts run only after minimum current-run provenance exists for every processed candidate.';

notify pgrst, 'reload schema';
