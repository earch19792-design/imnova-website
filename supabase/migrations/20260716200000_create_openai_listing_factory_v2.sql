-- Additive Preview/staging persistence for OpenAI Listing Intelligence Factory V2.
-- Contains product/listing content only. Buyer PII, credentials and competitor copy are forbidden.

create table if not exists public.ai_listing_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  prompt_version text not null,
  schema_version text not null,
  engine_version text not null,
  validation_policy_version text not null,
  system_prompt_hash text not null,
  generation_prompt_hash text not null,
  revision_prompt_hash text not null,
  prompt_templates jsonb not null,
  created_at timestamptz not null default now(),
  constraint ai_listing_prompt_versions_version_unique unique (prompt_version),
  constraint ai_listing_prompt_versions_hashes_check check (
    system_prompt_hash ~ '^sha256:[0-9a-f]{64}$'
    and generation_prompt_hash ~ '^sha256:[0-9a-f]{64}$'
    and revision_prompt_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint ai_listing_prompt_versions_templates_check check (
    jsonb_typeof(prompt_templates) = 'object'
  )
);

create table if not exists public.ai_listing_generation_runs (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  candidate_id uuid null,
  decision_package_id uuid not null references public.marketplace_listing_decision_packages(id),
  decision_package_hash text not null,
  identity_fingerprint text not null,
  input_hash text not null,
  schema_version text not null,
  prompt_version text not null references public.ai_listing_prompt_versions(prompt_version),
  model text not null,
  review_model text null,
  adapter text not null,
  status text not null,
  requested_by uuid null references auth.users(id) on delete set null,
  idempotency_key_hash text not null,
  current_version_id uuid null,
  revision_count integer not null default 0,
  max_revisions integer not null default 1,
  cache_hit boolean not null default false,
  budget_warning boolean not null default false,
  projected_cost_usd numeric(12,6) not null default 0,
  total_estimated_cost_usd numeric(12,6) not null default 0,
  last_error_code text null,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_listing_generation_runs_marketplace_check check (marketplace = 'EBAY_US'),
  constraint ai_listing_generation_runs_adapter_check check (adapter in ('OPENAI', 'FAKE')),
  constraint ai_listing_generation_runs_status_check check (
    status in (
      'GENERATING', 'GENERATED', 'HUMAN_REVIEW_REQUIRED', 'APPROVED',
      'REJECTED', 'FAILED', 'BUDGET_BLOCKED'
    )
  ),
  constraint ai_listing_generation_runs_hashes_check check (
    decision_package_hash ~ '^sha256:[0-9a-f]{64}$'
    and identity_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and input_hash ~ '^sha256:[0-9a-f]{64}$'
    and idempotency_key_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint ai_listing_generation_runs_revisions_check check (
    revision_count >= 0 and max_revisions between 0 and 1
    and revision_count <= max_revisions
  ),
  constraint ai_listing_generation_runs_cost_check check (
    projected_cost_usd >= 0 and total_estimated_cost_usd >= 0
  ),
  constraint ai_listing_generation_runs_input_unique unique (
    marketplace_account_key, marketplace, input_hash, model, prompt_version
  ),
  constraint ai_listing_generation_runs_idempotency_unique unique (
    marketplace_account_key, marketplace, idempotency_key_hash
  )
);

create table if not exists public.ai_listing_generation_versions (
  id uuid primary key default gen_random_uuid(),
  generation_run_id uuid not null references public.ai_listing_generation_runs(id),
  version_number integer not null,
  revision_number integer not null,
  output_hash text not null,
  generation_output jsonb not null,
  model_metadata jsonb not null,
  prompt_version text not null,
  prompt_hashes jsonb not null,
  created_at timestamptz not null default now(),
  constraint ai_listing_generation_versions_numbers_check check (
    version_number > 0 and revision_number between 0 and 1
  ),
  constraint ai_listing_generation_versions_hash_check check (
    output_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint ai_listing_generation_versions_json_check check (
    jsonb_typeof(generation_output) = 'object'
    and jsonb_typeof(model_metadata) = 'object'
    and jsonb_typeof(prompt_hashes) = 'object'
  ),
  constraint ai_listing_generation_versions_number_unique unique (
    generation_run_id, version_number
  ),
  constraint ai_listing_generation_versions_output_unique unique (
    generation_run_id, output_hash
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ai_listing_generation_runs'::regclass
      and conname = 'ai_listing_generation_runs_current_version_id_fkey'
  ) then
    alter table public.ai_listing_generation_runs
      add constraint ai_listing_generation_runs_current_version_id_fkey
      foreign key (current_version_id)
      references public.ai_listing_generation_versions(id)
      on delete set null;
  end if;
end $$;

create table if not exists public.ai_listing_validation_results (
  id uuid primary key default gen_random_uuid(),
  generation_run_id uuid not null references public.ai_listing_generation_runs(id),
  generation_version_id uuid null references public.ai_listing_generation_versions(id),
  revision_number integer not null,
  validation_kind text not null,
  passed boolean not null,
  error_codes jsonb not null default '[]'::jsonb,
  validation_policy_version text not null,
  created_at timestamptz not null default now(),
  constraint ai_listing_validation_results_revision_check check (
    revision_number between 0 and 1
  ),
  constraint ai_listing_validation_results_kind_check check (
    validation_kind in ('ELIGIBILITY', 'SCHEMA', 'FACTUAL', 'COMPLIANCE', 'BUDGET')
  ),
  constraint ai_listing_validation_results_errors_check check (
    jsonb_typeof(error_codes) = 'array'
  ),
  constraint ai_listing_validation_results_identity_unique unique (
    generation_run_id, revision_number, validation_kind
  )
);

create table if not exists public.ai_listing_budget_usage (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  generation_run_id uuid null references public.ai_listing_generation_runs(id),
  candidate_id uuid null,
  model text not null,
  idempotency_key_hash text not null,
  sanitized_request_id text null,
  input_tokens integer null,
  cached_input_tokens integer null,
  output_tokens integer null,
  estimated_cost_usd numeric(12,6) not null default 0,
  status text not null,
  cache_hit boolean not null default false,
  revision_number integer not null,
  started_at timestamptz not null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint ai_listing_budget_usage_marketplace_check check (marketplace = 'EBAY_US'),
  constraint ai_listing_budget_usage_idempotency_hash_check check (
    idempotency_key_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint ai_listing_budget_usage_tokens_check check (
    (input_tokens is null or input_tokens >= 0)
    and (cached_input_tokens is null or cached_input_tokens >= 0)
    and (output_tokens is null or output_tokens >= 0)
  ),
  constraint ai_listing_budget_usage_cost_check check (estimated_cost_usd >= 0),
  constraint ai_listing_budget_usage_status_check check (
    status in ('STARTED', 'COMPLETED', 'FAILED', 'CACHE_HIT', 'HARD_STOP_BLOCKED')
  ),
  constraint ai_listing_budget_usage_revision_check check (revision_number between 0 and 1),
  constraint ai_listing_budget_usage_request_unique unique (
    marketplace_account_key, marketplace, idempotency_key_hash, status
  )
);

create table if not exists public.ai_listing_approvals (
  id uuid primary key default gen_random_uuid(),
  generation_run_id uuid not null references public.ai_listing_generation_runs(id),
  generation_version_id uuid null references public.ai_listing_generation_versions(id),
  action text not null,
  actor_id uuid null references auth.users(id) on delete set null,
  output_hash text null,
  idempotency_key_hash text not null,
  reason_code text null,
  created_at timestamptz not null default now(),
  constraint ai_listing_approvals_action_check check (
    action in ('APPROVE', 'REJECT', 'REQUEST_REVISION', 'RESTORE_VERSION')
  ),
  constraint ai_listing_approvals_hashes_check check (
    (output_hash is null or output_hash ~ '^sha256:[0-9a-f]{64}$')
    and idempotency_key_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint ai_listing_approvals_idempotency_unique unique (
    generation_run_id, idempotency_key_hash
  )
);

create index if not exists ai_listing_generation_runs_candidate_idx
  on public.ai_listing_generation_runs(
    marketplace_account_key, marketplace, candidate_id, created_at desc
  );
create index if not exists ai_listing_generation_runs_package_idx
  on public.ai_listing_generation_runs(
    marketplace_account_key, marketplace, decision_package_hash, created_at desc
  );
create index if not exists ai_listing_generation_runs_input_idx
  on public.ai_listing_generation_runs(
    marketplace_account_key, marketplace, input_hash, created_at desc
  );
create index if not exists ai_listing_generation_runs_status_idx
  on public.ai_listing_generation_runs(
    marketplace_account_key, marketplace, status, updated_at desc
  );
create index if not exists ai_listing_generation_versions_run_idx
  on public.ai_listing_generation_versions(generation_run_id, version_number desc);
create index if not exists ai_listing_validation_results_run_idx
  on public.ai_listing_validation_results(generation_run_id, created_at desc);
create index if not exists ai_listing_budget_usage_month_idx
  on public.ai_listing_budget_usage(
    marketplace_account_key, marketplace, started_at desc, model, status
  );
create index if not exists ai_listing_budget_usage_candidate_idx
  on public.ai_listing_budget_usage(candidate_id, started_at desc);
create index if not exists ai_listing_approvals_run_idx
  on public.ai_listing_approvals(generation_run_id, created_at desc);

alter table public.ai_listing_prompt_versions enable row level security;
alter table public.ai_listing_generation_runs enable row level security;
alter table public.ai_listing_generation_versions enable row level security;
alter table public.ai_listing_validation_results enable row level security;
alter table public.ai_listing_budget_usage enable row level security;
alter table public.ai_listing_approvals enable row level security;

revoke all on table public.ai_listing_prompt_versions from anon, authenticated, service_role;
revoke all on table public.ai_listing_generation_runs from anon, authenticated, service_role;
revoke all on table public.ai_listing_generation_versions from anon, authenticated, service_role;
revoke all on table public.ai_listing_validation_results from anon, authenticated, service_role;
revoke all on table public.ai_listing_budget_usage from anon, authenticated, service_role;
revoke all on table public.ai_listing_approvals from anon, authenticated, service_role;

grant select, insert on table public.ai_listing_prompt_versions to service_role;
grant select, insert, update on table public.ai_listing_generation_runs to service_role;
grant select, insert on table public.ai_listing_generation_versions to service_role;
grant select, insert on table public.ai_listing_validation_results to service_role;
grant select, insert on table public.ai_listing_budget_usage to service_role;
grant select, insert on table public.ai_listing_approvals to service_role;

notify pgrst, 'reload schema';
