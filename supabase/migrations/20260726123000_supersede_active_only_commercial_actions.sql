begin;

alter table public.commercial_alert_events
  add column if not exists commercial_policy_status text null,
  add column if not exists commercial_policy_version text null,
  add column if not exists commercial_policy_blocker_codes text[] not null
    default '{}'::text[],
  add column if not exists commercial_policy_evaluated_at timestamptz null;

alter table public.ebay_commercial_improvement_executions
  add column if not exists prepared_policy_version text null,
  add column if not exists policy_decision text null,
  add column if not exists policy_blocker_codes text[] not null
    default '{}'::text[],
  add column if not exists policy_superseded_at timestamptz null,
  add column if not exists reconciliation_required boolean not null
    default false;

do $constraints$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.commercial_alert_events'::regclass
      and conname = 'commercial_alert_events_policy_status_check'
  ) then
    alter table public.commercial_alert_events
      add constraint commercial_alert_events_policy_status_check check (
        commercial_policy_status is null or commercial_policy_status in (
          'OBSERVE_ONLY', 'BLOCKED_POLICY', 'ACTIONABLE'
        )
      );
  end if;
end
$constraints$;

create table if not exists public.ebay_commercial_policy_supersessions (
  id uuid primary key default gen_random_uuid(),
  commercial_event_id uuid not null unique
    references public.commercial_alert_events(id) on delete restrict,
  execution_id uuid null
    references public.ebay_commercial_improvement_executions(id)
    on delete restrict,
  policy_version text not null,
  reason_code text not null,
  prior_event_type text not null,
  prior_recommended_action text not null,
  prior_evidence_class text null,
  prior_execution_phase text null,
  prior_ebay_write_dispatched boolean null,
  audit_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint ebay_commercial_policy_supersessions_snapshot_check check (
    jsonb_typeof(audit_snapshot) = 'object'
  )
);

create table if not exists
  public.ebay_commercial_improvement_reconciliation_queue (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null unique
    references public.ebay_commercial_improvement_executions(id)
    on delete restrict,
  commercial_event_id uuid not null
    references public.commercial_alert_events(id) on delete restrict,
  reason_code text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint ebay_commercial_improvement_reconciliation_status_check check (
    status in ('pending', 'leased', 'reconciled', 'manual_review')
  ),
  constraint ebay_commercial_improvement_reconciliation_attempts_check check (
    attempts between 0 and 20
  )
);

create index if not exists
  ebay_commercial_improvement_reconciliation_queue_claim_idx
  on public.ebay_commercial_improvement_reconciliation_queue(
    status, created_at
  )
  where status in ('pending', 'leased');

insert into public.ebay_commercial_policy_supersessions (
  commercial_event_id,
  execution_id,
  policy_version,
  reason_code,
  prior_event_type,
  prior_recommended_action,
  prior_evidence_class,
  prior_execution_phase,
  prior_ebay_write_dispatched,
  audit_snapshot
)
select
  event.id,
  execution.id,
  'SELLER_OS_ACTIVE_LISTING_COMMERCIAL_POLICY_V1',
  'COMMERCIAL_POLICY_SUPERSEDED_CONFIRMED_SALES_REQUIRED',
  event.event_type,
  event.recommended_action,
  coalesce(
    event.evidence #>> '{commercialPolicy,evidenceClass}',
    event.evidence ->> 'evidenceClass'
  ),
  execution.phase,
  execution.ebay_write_dispatched,
  jsonb_build_object(
    'eventType', event.event_type,
    'recommendationAction', coalesce(
      event.evidence #>> '{activeMarketPriceRecommendation,action}',
      event.evidence #>> '{priceRecommendation,action}'
    ),
    'comparisonBasis', coalesce(
      event.evidence
        #>> '{activeMarketPriceRecommendation,comparisonBasis}',
      event.evidence #>> '{priceRecommendation,comparisonBasis}'
    ),
    'executionPhase', execution.phase,
    'ebayWriteDispatched', execution.ebay_write_dispatched
  )
from public.commercial_alert_events event
left join public.ebay_commercial_improvement_executions execution
  on execution.commercial_event_id = event.id
where
  event.event_type = 'COMPETITOR_ACTIVE_MARKET_PRICE_RECOMMENDATION'
  or (
    coalesce(
      event.evidence #>> '{commercialPolicy,evidenceClass}',
      event.evidence ->> 'evidenceClass'
    ) in ('ACTIVE_ONLY', 'ESTIMATED_ACTIVITY')
    and coalesce(
      event.evidence #>> '{activeMarketPriceRecommendation,action}',
      event.evidence #>> '{priceRecommendation,action}'
    ) in (
      'LOWER_TO_ACTIVE_MARKET_SAFE_PRICE',
      'LOWER_TO_ACTIVE_MARKET_CONTROLLED_RISK_PRICE',
      'RAISE_TO_SAFE_FLOOR'
    )
  )
on conflict (commercial_event_id) do nothing;

update public.commercial_alert_events event
set commercial_policy_status = 'BLOCKED_POLICY',
    commercial_policy_version =
      'SELLER_OS_ACTIVE_LISTING_COMMERCIAL_POLICY_V1',
    commercial_policy_blocker_codes =
      array['CONFIRMED_SOLD_EVIDENCE_REQUIRED']::text[],
    commercial_policy_evaluated_at = coalesce(
      event.commercial_policy_evaluated_at,
      clock_timestamp()
    )
where exists (
  select 1
  from public.ebay_commercial_policy_supersessions supersession
  where supersession.commercial_event_id = event.id
)
and (
  event.commercial_policy_status is distinct from 'BLOCKED_POLICY'
  or event.commercial_policy_version is distinct from
    'SELLER_OS_ACTIVE_LISTING_COMMERCIAL_POLICY_V1'
  or event.commercial_policy_blocker_codes is distinct from
    array['CONFIRMED_SOLD_EVIDENCE_REQUIRED']::text[]
  or event.commercial_policy_evaluated_at is null
);

update public.ebay_commercial_improvement_executions execution
set phase = 'terminal_failure',
    prepared_policy_version =
      'SELLER_OS_ACTIVE_LISTING_COMMERCIAL_POLICY_V1',
    policy_decision = 'HOLD_PRICE_NO_PROMOTION',
    policy_blocker_codes =
      array['CONFIRMED_SOLD_EVIDENCE_REQUIRED']::text[],
    policy_superseded_at = coalesce(
      execution.policy_superseded_at,
      clock_timestamp()
    ),
    last_error_code =
      'COMMERCIAL_POLICY_SUPERSEDED_CONFIRMED_SALES_REQUIRED',
    updated_at = clock_timestamp()
where execution.phase = 'preview_ready'
  and execution.ebay_write_dispatched = false
  and exists (
    select 1
    from public.ebay_commercial_policy_supersessions supersession
    where supersession.commercial_event_id =
      execution.commercial_event_id
  );

insert into public.ebay_commercial_improvement_reconciliation_queue (
  execution_id,
  commercial_event_id,
  reason_code
)
select
  execution.id,
  execution.commercial_event_id,
  'COMMERCIAL_POLICY_ACTIVE_MARKET_WRITE_RECONCILIATION_REQUIRED'
from public.ebay_commercial_improvement_executions execution
where execution.phase in ('write_in_flight', 'write_acknowledged')
  and exists (
    select 1
    from public.ebay_commercial_policy_supersessions supersession
    where supersession.commercial_event_id =
      execution.commercial_event_id
  )
on conflict (execution_id) do nothing;

update public.ebay_commercial_improvement_executions execution
set prepared_policy_version =
      'SELLER_OS_ACTIVE_LISTING_COMMERCIAL_POLICY_V1',
    policy_decision = 'HOLD_PRICE_NO_PROMOTION',
    policy_blocker_codes =
      array['CONFIRMED_SOLD_EVIDENCE_REQUIRED']::text[],
    reconciliation_required = true,
    reconciliation_code =
      'COMMERCIAL_POLICY_ACTIVE_MARKET_WRITE_RECONCILIATION_REQUIRED',
    updated_at = clock_timestamp()
where execution.phase in ('write_in_flight', 'write_acknowledged')
  and exists (
    select 1
    from public.ebay_commercial_policy_supersessions supersession
    where supersession.commercial_event_id =
      execution.commercial_event_id
  )
  and (
    execution.prepared_policy_version is distinct from
      'SELLER_OS_ACTIVE_LISTING_COMMERCIAL_POLICY_V1'
    or execution.policy_decision is distinct from
      'HOLD_PRICE_NO_PROMOTION'
    or execution.policy_blocker_codes is distinct from
      array['CONFIRMED_SOLD_EVIDENCE_REQUIRED']::text[]
    or execution.reconciliation_required is distinct from true
    or execution.reconciliation_code is distinct from
      'COMMERCIAL_POLICY_ACTIVE_MARKET_WRITE_RECONCILIATION_REQUIRED'
  );

update public.alert_delivery_outbox outbox
set status = 'cancelled',
    lease_owner = null,
    lease_expires_at = null,
    last_error_code =
      'COMMERCIAL_POLICY_SUPERSEDED_CONFIRMED_SALES_REQUIRED',
    updated_at = clock_timestamp()
where outbox.status in ('pending', 'failed')
  and exists (
    select 1
    from public.ebay_commercial_policy_supersessions supersession
    where supersession.commercial_event_id = outbox.commercial_event_id
  );

create or replace function
  public.reject_ebay_commercial_policy_supersession_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception
    'EBAY_COMMERCIAL_POLICY_SUPERSESSION_IMMUTABLE';
end;
$$;

do $immutable_trigger$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid =
      'public.ebay_commercial_policy_supersessions'::regclass
      and tgname =
        'reject_ebay_commercial_policy_supersession_mutation'
      and not tgisinternal
  ) then
    execute $trigger$
      create trigger
        reject_ebay_commercial_policy_supersession_mutation
      before update or delete
      on public.ebay_commercial_policy_supersessions
      for each row execute function
        public.reject_ebay_commercial_policy_supersession_mutation()
    $trigger$;
  end if;
end
$immutable_trigger$;

alter table public.ebay_commercial_policy_supersessions
  enable row level security;
alter table public.ebay_commercial_policy_supersessions
  force row level security;
alter table public.ebay_commercial_improvement_reconciliation_queue
  enable row level security;
alter table public.ebay_commercial_improvement_reconciliation_queue
  force row level security;

revoke all on table public.ebay_commercial_policy_supersessions
  from public;
revoke all on table public.ebay_commercial_policy_supersessions from anon, authenticated;
revoke all on table public.ebay_commercial_improvement_reconciliation_queue
  from public;
revoke all on table public.ebay_commercial_improvement_reconciliation_queue from anon, authenticated;
grant all on table public.ebay_commercial_policy_supersessions
  to service_role;
grant all on table public.ebay_commercial_improvement_reconciliation_queue
  to service_role;
revoke all on function
  public.reject_ebay_commercial_policy_supersession_mutation()
  from public, anon, authenticated;

comment on table public.ebay_commercial_policy_supersessions is
  'Immutable audit of legacy ACTIVE_ONLY commercial actions superseded by the '
  'confirmed-sales-required active-listing policy. No historical event or '
  'execution is deleted.';
comment on table
  public.ebay_commercial_improvement_reconciliation_queue is
  'Non-destructive reconciliation queue for legacy commercial actions whose '
  'eBay outcome may already be in flight or acknowledged.';

-- Candidate state machines are intentionally not rewritten here. Their status
-- vocabularies differ by generation, so speculative SQL could corrupt durable
-- history. Runtime selection now excludes exact active listing identities
-- before a new candidate is created while leaving all prior runs untouched.

commit;
