-- Loop 2 Product Research query plans for Preview/staging. Additive only.
-- Queries are derived from Luna product facts; no competitor titles, HTML,
-- images, credentials, buyer PII, OpenAI calls, or marketplace writes.

create table if not exists public.marketplace_product_research_query_plans (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  run_id uuid not null references public.marketplace_listing_approval_queue_runs(id) on delete restrict,
  plan_version text not null,
  input_hash text not null,
  status text not null default 'ACTIVE',
  query_count integer not null,
  candidate_count integer not null,
  raw_competitor_content_stored boolean not null default false,
  pii_stored boolean not null default false,
  openai_calls integer not null default 0,
  ebay_writes integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz null,
  constraint marketplace_product_research_query_plans_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint marketplace_product_research_query_plans_status_check
    check (status in ('ACTIVE','COMPLETED','SUPERSEDED')),
  constraint marketplace_product_research_query_plans_hash_check
    check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint marketplace_product_research_query_plans_counts_check
    check (query_count between 1 and 15 and candidate_count > 0
      and openai_calls = 0 and ebay_writes = 0),
  constraint marketplace_product_research_query_plans_safety_check
    check (raw_competitor_content_stored = false and pii_stored = false),
  constraint marketplace_product_research_query_plans_input_unique
    unique (marketplace_account_key, marketplace, input_hash)
);

create table if not exists public.marketplace_product_research_query_tasks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.marketplace_product_research_query_plans(id) on delete restrict,
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  ordinal integer not null,
  search_query text not null,
  query_hash text not null,
  cluster_key_hash text not null,
  category_id text null,
  candidate_count integer not null,
  candidate_variant_hashes text[] not null default '{}'::text[],
  status text not null default 'PENDING',
  capture_batch_id uuid null references public.marketplace_product_research_capture_batches(id) on delete restrict,
  captured_at timestamptz null,
  processed_at timestamptz null,
  last_error_code text null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint marketplace_product_research_query_tasks_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint marketplace_product_research_query_tasks_ordinal_check
    check (ordinal between 1 and 15),
  constraint marketplace_product_research_query_tasks_query_check
    check (length(trim(search_query)) between 3 and 100
      and search_query !~ '[[:cntrl:]]'),
  constraint marketplace_product_research_query_tasks_hashes_check check (
    query_hash ~ '^sha256:[0-9a-f]{64}$'
    and cluster_key_hash ~ '^sha256:[0-9a-f]{64}$'
    and array_to_string(candidate_variant_hashes, ',')
      ~ '^sha256:[0-9a-f]{64}(,sha256:[0-9a-f]{64})*$'
  ),
  constraint marketplace_product_research_query_tasks_category_check
    check (category_id is null or category_id ~ '^[0-9]+$'),
  constraint marketplace_product_research_query_tasks_candidate_count_check
    check (candidate_count > 0 and candidate_count = cardinality(candidate_variant_hashes)),
  constraint marketplace_product_research_query_tasks_status_check
    check (status in ('PENDING','CAPTURED','PROCESSED','SKIPPED')),
  constraint marketplace_product_research_query_tasks_capture_check check (
    (status = 'PENDING' and capture_batch_id is null and captured_at is null and processed_at is null)
    or (status in ('CAPTURED','PROCESSED') and capture_batch_id is not null and captured_at is not null)
    or (status = 'SKIPPED' and capture_batch_id is null)
  ),
  constraint marketplace_product_research_query_tasks_error_check
    check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]+$'),
  constraint marketplace_product_research_query_tasks_ordinal_unique unique (plan_id, ordinal),
  constraint marketplace_product_research_query_tasks_query_unique unique (plan_id, query_hash)
);

create index if not exists marketplace_product_research_query_plans_account_idx
  on public.marketplace_product_research_query_plans(
    marketplace_account_key, marketplace, status, created_at desc
  );
create index if not exists marketplace_product_research_query_tasks_next_idx
  on public.marketplace_product_research_query_tasks(
    marketplace_account_key, marketplace, plan_id, status, ordinal
  );
create index if not exists marketplace_product_research_query_tasks_capture_idx
  on public.marketplace_product_research_query_tasks(capture_batch_id)
  where capture_batch_id is not null;

alter table public.marketplace_product_research_query_plans enable row level security;
alter table public.marketplace_product_research_query_plans force row level security;
alter table public.marketplace_product_research_query_tasks enable row level security;
alter table public.marketplace_product_research_query_tasks force row level security;

revoke all on table public.marketplace_product_research_query_plans
  from public, anon, authenticated, service_role;
revoke all on table public.marketplace_product_research_query_tasks
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.marketplace_product_research_query_plans to service_role;
grant select, insert, update on table public.marketplace_product_research_query_tasks to service_role;

create or replace function public.create_product_research_query_plan_v1(
  p_plan_id uuid,
  p_marketplace_account_key text,
  p_run_id uuid,
  p_plan_version text,
  p_input_hash text,
  p_candidate_count integer,
  p_queries jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_query_count integer := jsonb_array_length(coalesce(p_queries, '[]'::jsonb));
  v_plan_id uuid;
begin
  if length(trim(p_marketplace_account_key)) < 3
    or p_input_hash !~ '^sha256:[0-9a-f]{64}$'
    or length(trim(p_plan_version)) < 3
    or p_candidate_count < 1
    or v_query_count < 1 or v_query_count > 15 then
    raise exception 'PRODUCT_RESEARCH_QUERY_PLAN_INPUT_INVALID';
  end if;

  update public.marketplace_product_research_query_plans
  set status = 'SUPERSEDED', updated_at = clock_timestamp()
  where marketplace_account_key = p_marketplace_account_key
    and marketplace = 'EBAY_US' and run_id = p_run_id and status = 'ACTIVE'
    and input_hash <> p_input_hash;

  insert into public.marketplace_product_research_query_plans(
    id,marketplace_account_key,marketplace,run_id,plan_version,input_hash,status,
    query_count,candidate_count
  ) values (
    p_plan_id,p_marketplace_account_key,'EBAY_US',p_run_id,p_plan_version,p_input_hash,
    'ACTIVE',v_query_count,p_candidate_count
  )
  on conflict (marketplace_account_key,marketplace,input_hash) do update
    set updated_at = clock_timestamp()
  returning id into v_plan_id;

  insert into public.marketplace_product_research_query_tasks(
    plan_id,marketplace_account_key,marketplace,ordinal,search_query,query_hash,
    cluster_key_hash,category_id,candidate_count,candidate_variant_hashes
  )
  select v_plan_id,p_marketplace_account_key,'EBAY_US',row.ordinal,row.search_query,
    row.query_hash,row.cluster_key_hash,row.category_id,row.candidate_count,
    row.candidate_variant_hashes
  from jsonb_to_recordset(p_queries) as row(
    ordinal integer,
    search_query text,
    query_hash text,
    cluster_key_hash text,
    category_id text,
    candidate_count integer,
    candidate_variant_hashes text[]
  )
  on conflict (plan_id,query_hash) do nothing;

  return v_plan_id;
end;
$$;

revoke all on function public.create_product_research_query_plan_v1(
  uuid,text,uuid,text,text,integer,jsonb
) from public, anon, authenticated;
grant execute on function public.create_product_research_query_plan_v1(
  uuid,text,uuid,text,text,integer,jsonb
) to service_role;

notify pgrst, 'reload schema';
