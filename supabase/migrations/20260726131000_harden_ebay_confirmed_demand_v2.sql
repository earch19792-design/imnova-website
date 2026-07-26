begin;

alter table if exists public.ebay_luna_opportunity_assessments
  add column if not exists demand_policy_version text null,
  add column if not exists demand_policy_mode text null,
  add column if not exists demand_evidence_class text null,
  add column if not exists sold_exact_units integer null,
  add column if not exists sold_exact_seller_count integer null,
  add column if not exists sold_exact_comparable_count integer null,
  add column if not exists demand_validation_passed boolean null;

create table if not exists public.ebay_demand_evidence_policy_configs (
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  policy_version text not null default 'EBAY_CONFIRMED_DEMAND_V2',
  enabled boolean not null default false,
  shadow_mode boolean not null default true,
  evidence_max_age_days integer not null default 90
    check (evidence_max_age_days between 1 and 365),
  minimum_sold_exact_units integer not null default 3
    check (minimum_sold_exact_units > 0),
  minimum_sold_exact_seller_count integer not null default 2
    check (minimum_sold_exact_seller_count > 0),
  minimum_sold_exact_comparable_count integer not null default 1
    check (minimum_sold_exact_comparable_count > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null,
  primary key (marketplace_account_key, marketplace)
);

create table if not exists public.ebay_demand_evidence_policy_evaluations (
  id uuid primary key default gen_random_uuid(),
  candidate_key text not null,
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  policy_version text not null,
  policy_mode text not null,
  evidence_class text not null,
  evidence_observed_at timestamptz null,
  evidence_expires_at timestamptz null,
  sold_exact_units integer not null default 0
    check (sold_exact_units >= 0),
  sold_exact_seller_count integer not null default 0
    check (sold_exact_seller_count >= 0),
  sold_exact_comparable_count integer not null default 0
    check (sold_exact_comparable_count >= 0),
  shadow_demand_validated boolean not null default false,
  demand_validated boolean not null default false,
  blocker_codes text[] not null default '{}'::text[],
  evidence_hash text not null,
  evaluated_at timestamptz not null default now(),
  unique (
    candidate_key,
    marketplace_account_key,
    marketplace,
    policy_version,
    evidence_hash
  )
);

create index if not exists ebay_demand_evidence_policy_eval_candidate_idx
  on public.ebay_demand_evidence_policy_evaluations(
    candidate_key,
    evaluated_at desc
  );

create or replace function
  public.reject_ebay_demand_evidence_evaluation_mutation_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'EBAY_DEMAND_EVIDENCE_EVALUATION_IMMUTABLE';
end;
$$;

drop trigger if exists ebay_demand_evidence_evaluation_immutable
  on public.ebay_demand_evidence_policy_evaluations;
create trigger ebay_demand_evidence_evaluation_immutable
before update or delete
on public.ebay_demand_evidence_policy_evaluations
for each row execute function
  public.reject_ebay_demand_evidence_evaluation_mutation_v1();

alter table public.ebay_demand_evidence_policy_configs
  enable row level security;
alter table public.ebay_demand_evidence_policy_evaluations
  enable row level security;

revoke all on table public.ebay_demand_evidence_policy_configs
  from anon, authenticated;
revoke all on table public.ebay_demand_evidence_policy_evaluations
  from anon, authenticated;
grant select, insert, update
  on table public.ebay_demand_evidence_policy_configs
  to service_role;
grant select, insert
  on table public.ebay_demand_evidence_policy_evaluations
  to service_role;

comment on table public.ebay_demand_evidence_policy_configs is
  'Fail-closed, service-role-only eBay confirmed-demand policy. Defaults to disabled shadow mode.';
comment on column
  public.ebay_demand_evidence_policy_configs.evidence_max_age_days is
  'Preserves the existing 90-day reviewed sold-evidence window; changes require a separately reviewed policy update.';

notify pgrst, 'reload schema';

commit;
