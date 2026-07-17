-- Additive Preview/staging persistence for OpenAI Listing Intelligence Factory.

create table if not exists public.marketplace_listing_generations (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  decision_package_id uuid not null references public.marketplace_listing_decision_packages(id),
  decision_package_hash text not null,
  identity_fingerprint text not null,
  input_hash text not null,
  output_hash text null,
  schema_version text not null,
  prompt_version text not null,
  model text not null,
  adapter text not null,
  status text not null,
  generation_output jsonb null,
  factual_validation jsonb not null default '{}'::jsonb,
  compliance_validation jsonb not null default '{}'::jsonb,
  usage_summary jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  revision_count integer not null default 0,
  response_fingerprint text null,
  last_error_code text null,
  generated_at timestamptz null,
  approved_at timestamptz null,
  approved_by uuid null references auth.users(id) on delete set null,
  rejected_at timestamptz null,
  rejected_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_listing_generations_marketplace_check check (
    marketplace = 'EBAY_US'
  ),
  constraint marketplace_listing_generations_adapter_check check (
    adapter in ('OPENAI', 'FAKE')
  ),
  constraint marketplace_listing_generations_status_check check (
    status in ('GENERATING', 'GENERATED', 'VALIDATION_FAILED', 'APPROVED', 'REJECTED', 'FAILED')
  ),
  constraint marketplace_listing_generations_hashes_check check (
    decision_package_hash ~ '^sha256:[0-9a-f]{64}$'
    and identity_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and input_hash ~ '^sha256:[0-9a-f]{64}$'
    and (output_hash is null or output_hash ~ '^sha256:[0-9a-f]{64}$')
    and (response_fingerprint is null or response_fingerprint ~ '^sha256:[0-9a-f]{64}$')
  ),
  constraint marketplace_listing_generations_json_check check (
    (generation_output is null or jsonb_typeof(generation_output) = 'object')
    and jsonb_typeof(factual_validation) = 'object'
    and jsonb_typeof(compliance_validation) = 'object'
    and jsonb_typeof(usage_summary) = 'object'
  ),
  constraint marketplace_listing_generations_attempts_check check (
    attempt_count >= 0 and revision_count >= 0 and revision_count <= attempt_count
  ),
  constraint marketplace_listing_generations_cache_unique unique (
    marketplace_account_key, marketplace, decision_package_id,
    input_hash, prompt_version, model, adapter
  )
);

create table if not exists public.marketplace_listing_generation_attempts (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.marketplace_listing_generations(id) on delete cascade,
  attempt_number integer not null,
  revision_number integer not null,
  status text not null,
  output_hash text null,
  factual_validation jsonb not null default '{}'::jsonb,
  compliance_validation jsonb not null default '{}'::jsonb,
  usage_summary jsonb not null default '{}'::jsonb,
  response_fingerprint text null,
  error_code text null,
  attempted_at timestamptz not null default now(),
  constraint marketplace_listing_generation_attempts_status_check check (
    status in ('GENERATED', 'VALIDATION_FAILED', 'FAILED')
  ),
  constraint marketplace_listing_generation_attempts_number_check check (
    attempt_number > 0 and revision_number >= 0
  ),
  constraint marketplace_listing_generation_attempts_hash_check check (
    (output_hash is null or output_hash ~ '^sha256:[0-9a-f]{64}$')
    and (response_fingerprint is null or response_fingerprint ~ '^sha256:[0-9a-f]{64}$')
  ),
  constraint marketplace_listing_generation_attempts_identity unique (
    generation_id, attempt_number
  )
);

create index if not exists marketplace_listing_generations_package_idx
  on public.marketplace_listing_generations(
    marketplace_account_key, marketplace, decision_package_id, created_at desc
  );

create index if not exists marketplace_listing_generations_status_idx
  on public.marketplace_listing_generations(
    marketplace_account_key, marketplace, status, updated_at desc
  );

create index if not exists marketplace_listing_generations_fingerprint_idx
  on public.marketplace_listing_generations(
    marketplace_account_key, marketplace, identity_fingerprint, created_at desc
  );

create index if not exists marketplace_listing_generation_attempts_generation_idx
  on public.marketplace_listing_generation_attempts(generation_id, attempted_at desc);

alter table public.marketplace_listing_generations enable row level security;
alter table public.marketplace_listing_generation_attempts enable row level security;

revoke all on table public.marketplace_listing_generations from anon, authenticated, service_role;
revoke all on table public.marketplace_listing_generation_attempts from anon, authenticated, service_role;
grant select, insert, update on table public.marketplace_listing_generations to service_role;
grant select, insert on table public.marketplace_listing_generation_attempts to service_role;

notify pgrst, 'reload schema';
