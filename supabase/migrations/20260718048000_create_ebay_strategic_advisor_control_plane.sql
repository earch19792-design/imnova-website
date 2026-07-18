-- Preview/staging-only durable control plane for the Seller OS strategic advisor.
-- OpenAI remains disabled by default. This migration creates no scheduler, network
-- call, eBay write, production toggle, competitor-content store, or PII store.

create table if not exists public.ebay_strategic_advisor_runs (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace_id text not null default 'EBAY_US',
  signal_event_id uuid not null
    references public.commercial_alert_events(id) on delete restrict,
  performance_snapshot_id uuid not null
    references public.listing_commercial_snapshots(id) on delete restrict,
  queue_item_id uuid not null
    references public.marketplace_listing_approval_queue_items(id) on delete restrict,
  readiness_event_id uuid not null
    references public.marketplace_product_fact_readiness_events(id) on delete restrict,
  listing_fingerprint text not null,
  signal_type text not null,
  classification text not null,
  authorized_variable text not null,
  state text not null,
  contract_version text not null,
  prompt_version text not null,
  output_schema_version text not null,
  evidence_hash text not null,
  input_hash text not null,
  deduplication_key text not null,
  sanitized_evidence jsonb not null,
  estimated_input_tokens integer not null,
  max_input_tokens integer not null,
  max_output_tokens integer not null,
  estimated_call_cost_micros bigint not null,
  max_call_cost_micros bigint not null,
  daily_budget_micros bigint not null,
  openai_call_count integer not null default 0,
  ebay_write_count integer not null default 0,
  production_changed boolean not null default false,
  created_by_hash text not null,
  last_error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint ebay_strategic_advisor_runs_marketplace_check
    check (marketplace_id = 'EBAY_US'),
  constraint ebay_strategic_advisor_runs_state_check check (state in (
    'SIGNAL_DETECTED',
    'DETERMINISTIC_EVIDENCE_READY',
    'AWAITING_OPERATOR_APPROVAL_TO_CALL',
    'OPENAI_CALL_QUEUED',
    'PROPOSAL_READY',
    'AWAITING_IMPROVEMENT_APPROVAL',
    'APPROVED_FOR_MANUAL_EXPERIMENT',
    'REJECTED'
  )),
  constraint ebay_strategic_advisor_runs_variable_check check (authorized_variable in (
    'CATEGORY', 'MAIN_IMAGE', 'TOTAL_OFFER_PRICE', 'SHIPPING_OFFER', 'LISTING_QUANTITY'
  )),
  constraint ebay_strategic_advisor_runs_hashes_check check (
    listing_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and evidence_hash ~ '^sha256:[0-9a-f]{64}$'
    and input_hash ~ '^sha256:[0-9a-f]{64}$'
    and deduplication_key ~ '^sha256:[0-9a-f]{64}$'
    and created_by_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint ebay_strategic_advisor_runs_budget_check check (
    estimated_input_tokens >= 0
    and max_input_tokens > 0
    and max_output_tokens > 0
    and estimated_call_cost_micros >= 0
    and max_call_cost_micros >= 0
    and daily_budget_micros >= 0
  ),
  constraint ebay_strategic_advisor_runs_safety_counters_check check (
    openai_call_count between 0 and 1
    and ebay_write_count = 0
    and production_changed = false
  ),
  constraint ebay_strategic_advisor_runs_evidence_check check (
    jsonb_typeof(sanitized_evidence) = 'object'
    and lower(sanitized_evidence::text) !~
      '(https?://|www\\.|data:image|base64|<[a-z]|@[a-z0-9.-]+\\.[a-z]{2,}|imageurl|thumbnailurl|sourceurl|rawhtml|rawsource|competitor(title|listing|price|seller|content|image)|buyername|buyeremail|shippingaddress|cookie|access_token|refresh_token)'
  ),
  constraint ebay_strategic_advisor_runs_dedup_unique unique (
    marketplace_account_key, marketplace_id, deduplication_key
  ),
  constraint ebay_strategic_advisor_runs_signal_unique unique (
    marketplace_account_key, marketplace_id, signal_event_id
  )
);

create table if not exists public.ebay_strategic_advisor_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ebay_strategic_advisor_runs(id) on delete restrict,
  previous_state text null,
  next_state text not null,
  reason_code text not null,
  triggered_by text not null,
  actor_hash text null,
  evidence_hash text not null,
  idempotency_key_hash text not null,
  created_at timestamptz not null default now(),
  constraint ebay_strategic_advisor_events_state_check check (
    (previous_state is null or previous_state in (
      'SIGNAL_DETECTED', 'DETERMINISTIC_EVIDENCE_READY',
      'AWAITING_OPERATOR_APPROVAL_TO_CALL', 'OPENAI_CALL_QUEUED',
      'PROPOSAL_READY', 'AWAITING_IMPROVEMENT_APPROVAL',
      'APPROVED_FOR_MANUAL_EXPERIMENT', 'REJECTED'
    ))
    and next_state in (
      'SIGNAL_DETECTED', 'DETERMINISTIC_EVIDENCE_READY',
      'AWAITING_OPERATOR_APPROVAL_TO_CALL', 'OPENAI_CALL_QUEUED',
      'PROPOSAL_READY', 'AWAITING_IMPROVEMENT_APPROVAL',
      'APPROVED_FOR_MANUAL_EXPERIMENT', 'REJECTED'
    )
  ),
  constraint ebay_strategic_advisor_events_trigger_check
    check (triggered_by in ('SYSTEM', 'USER', 'WORKER', 'RETRY')),
  constraint ebay_strategic_advisor_events_hashes_check check (
    evidence_hash ~ '^sha256:[0-9a-f]{64}$'
    and idempotency_key_hash ~ '^sha256:[0-9a-f]{64}$'
    and (actor_hash is null or actor_hash ~ '^sha256:[0-9a-f]{64}$')
  ),
  constraint ebay_strategic_advisor_events_idempotency_unique
    unique (run_id, idempotency_key_hash)
);

create table if not exists public.ebay_strategic_advisor_approvals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ebay_strategic_advisor_runs(id) on delete restrict,
  gate text not null,
  decision text not null,
  actor_hash text not null,
  bound_evidence_hash text not null,
  bound_proposal_hash text null,
  approved_budget jsonb not null default '{}'::jsonb,
  idempotency_key_hash text not null,
  created_at timestamptz not null default now(),
  constraint ebay_strategic_advisor_approvals_gate_check
    check (gate in ('OPENAI_SPEND', 'MANUAL_EXPERIMENT')),
  constraint ebay_strategic_advisor_approvals_decision_check
    check (decision in ('APPROVED', 'REJECTED')),
  constraint ebay_strategic_advisor_approvals_hashes_check check (
    actor_hash ~ '^sha256:[0-9a-f]{64}$'
    and bound_evidence_hash ~ '^sha256:[0-9a-f]{64}$'
    and (bound_proposal_hash is null or bound_proposal_hash ~ '^sha256:[0-9a-f]{64}$')
    and idempotency_key_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint ebay_strategic_advisor_approvals_binding_check check (
    (gate = 'OPENAI_SPEND' and bound_proposal_hash is null)
    or (gate = 'MANUAL_EXPERIMENT' and bound_proposal_hash is not null)
  ),
  constraint ebay_strategic_advisor_approvals_budget_check
    check (jsonb_typeof(approved_budget) = 'object'),
  constraint ebay_strategic_advisor_approvals_idempotency_unique
    unique (run_id, gate, idempotency_key_hash)
);

create table if not exists public.ebay_strategic_advisor_jobs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ebay_strategic_advisor_runs(id) on delete restrict,
  job_type text not null default 'OPENAI_RESPONSES_PROPOSAL',
  status text not null default 'PENDING',
  attempt_count integer not null default 0,
  -- A model call is intentionally never retried automatically. If a worker
  -- loses its lease after claiming the job, the remote outcome is ambiguous;
  -- blocking for operator review is safer than risking a second paid call.
  max_attempts integer not null default 1,
  available_at timestamptz not null default now(),
  lease_owner_hash text null,
  lease_expires_at timestamptz null,
  idempotency_key_hash text not null,
  last_error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint ebay_strategic_advisor_jobs_type_check
    check (job_type = 'OPENAI_RESPONSES_PROPOSAL'),
  constraint ebay_strategic_advisor_jobs_status_check
    check (status in ('PENDING', 'LEASED', 'COMPLETED', 'FAILED', 'CANCELLED')),
  constraint ebay_strategic_advisor_jobs_attempt_check
    check (attempt_count >= 0 and max_attempts = 1 and attempt_count <= max_attempts),
  constraint ebay_strategic_advisor_jobs_hashes_check check (
    idempotency_key_hash ~ '^sha256:[0-9a-f]{64}$'
    and (lease_owner_hash is null or lease_owner_hash ~ '^sha256:[0-9a-f]{64}$')
  ),
  constraint ebay_strategic_advisor_jobs_lease_check check (
    (status = 'LEASED' and lease_owner_hash is not null and lease_expires_at is not null)
    or status <> 'LEASED'
  ),
  constraint ebay_strategic_advisor_jobs_run_unique unique (run_id, job_type),
  constraint ebay_strategic_advisor_jobs_idempotency_unique unique (idempotency_key_hash)
);

create table if not exists public.ebay_strategic_advisor_proposals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ebay_strategic_advisor_runs(id) on delete restrict,
  job_id uuid not null references public.ebay_strategic_advisor_jobs(id) on delete restrict,
  output_schema_version text not null,
  output_hash text not null,
  proposal jsonb not null,
  response_id_hash text null,
  usage_summary jsonb not null default '{}'::jsonb,
  estimated_cost_micros bigint not null,
  created_at timestamptz not null default now(),
  constraint ebay_strategic_advisor_proposals_hashes_check check (
    output_hash ~ '^sha256:[0-9a-f]{64}$'
    and (response_id_hash is null or response_id_hash ~ '^sha256:[0-9a-f]{64}$')
  ),
  constraint ebay_strategic_advisor_proposals_json_check check (
    jsonb_typeof(proposal) = 'object'
    and jsonb_typeof(usage_summary) = 'object'
    and lower(proposal::text) !~
      '(https?://|www\\.|data:image|base64|<[a-z]|@[a-z0-9.-]+\\.[a-z]{2,}|imageurl|sourceurl|rawhtml|competitor(title|listing|price|seller|content|image)|buyername|buyeremail|shippingaddress|cookie|access_token|refresh_token)'
    and (usage_summary - 'inputTokens' - 'outputTokens') = '{}'::jsonb
    and proposal #>> '{safety,competitorDataUsed}' = 'false'
    and proposal #>> '{safety,ebayWriteAllowed}' = 'false'
    and proposal #>> '{safety,selfModificationAllowed}' = 'false'
    and proposal #>> '{experiment,automaticExecutionAllowed}' = 'false'
  ),
  constraint ebay_strategic_advisor_proposals_cost_check
    check (estimated_cost_micros >= 0),
  constraint ebay_strategic_advisor_proposals_output_unique unique (run_id, output_hash),
  constraint ebay_strategic_advisor_proposals_job_unique unique (job_id)
);

create index if not exists ebay_strategic_advisor_runs_state_idx
  on public.ebay_strategic_advisor_runs(
    marketplace_account_key, marketplace_id, state, updated_at desc
  );
create index if not exists ebay_strategic_advisor_events_run_idx
  on public.ebay_strategic_advisor_events(run_id, created_at asc);
create index if not exists ebay_strategic_advisor_jobs_claim_idx
  on public.ebay_strategic_advisor_jobs(status, available_at, created_at)
  where status in ('PENDING', 'LEASED');
create index if not exists ebay_strategic_advisor_approvals_run_idx
  on public.ebay_strategic_advisor_approvals(run_id, gate, created_at desc);

create or replace function public.prevent_ebay_strategic_advisor_append_only_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'EBAY_STRATEGIC_ADVISOR_APPEND_ONLY';
end;
$$;

drop trigger if exists ebay_strategic_advisor_events_immutable
  on public.ebay_strategic_advisor_events;
create trigger ebay_strategic_advisor_events_immutable
before update or delete on public.ebay_strategic_advisor_events
for each row execute function public.prevent_ebay_strategic_advisor_append_only_mutation();

drop trigger if exists ebay_strategic_advisor_approvals_immutable
  on public.ebay_strategic_advisor_approvals;
create trigger ebay_strategic_advisor_approvals_immutable
before update or delete on public.ebay_strategic_advisor_approvals
for each row execute function public.prevent_ebay_strategic_advisor_append_only_mutation();

drop trigger if exists ebay_strategic_advisor_proposals_immutable
  on public.ebay_strategic_advisor_proposals;
create trigger ebay_strategic_advisor_proposals_immutable
before update or delete on public.ebay_strategic_advisor_proposals
for each row execute function public.prevent_ebay_strategic_advisor_append_only_mutation();

create or replace function public.create_ebay_strategic_advisor_run(
  p_marketplace_account_key text,
  p_signal_event_id uuid,
  p_performance_snapshot_id uuid,
  p_queue_item_id uuid,
  p_readiness_event_id uuid,
  p_listing_fingerprint text,
  p_signal_type text,
  p_classification text,
  p_authorized_variable text,
  p_contract_version text,
  p_prompt_version text,
  p_output_schema_version text,
  p_evidence_hash text,
  p_input_hash text,
  p_deduplication_key text,
  p_sanitized_evidence jsonb,
  p_estimated_input_tokens integer,
  p_max_input_tokens integer,
  p_max_output_tokens integer,
  p_estimated_call_cost_micros bigint,
  p_max_call_cost_micros bigint,
  p_daily_budget_micros bigint,
  p_actor_hash text,
  p_idempotency_key_hash text,
  p_now timestamptz default now()
)
returns public.ebay_strategic_advisor_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.ebay_strategic_advisor_runs%rowtype;
begin
  perform 1
  from public.commercial_alert_events event
  join public.listing_commercial_snapshots snapshot
    on snapshot.id = p_performance_snapshot_id
    and snapshot.marketplace_account_key = event.marketplace_account_key
    and snapshot.marketplace = event.marketplace
    and snapshot.listing_id = event.listing_id
    and snapshot.sku is not distinct from event.sku
    and snapshot.observed_at = event.detected_at
  join public.marketplace_listing_approval_queue_items queue_item
    on queue_item.id = p_queue_item_id
    and queue_item.marketplace_account_key = event.marketplace_account_key
    and queue_item.marketplace = event.marketplace
    and queue_item.supplier_sku = event.sku
  join public.marketplace_product_fact_readiness_events readiness
    on readiness.id = p_readiness_event_id
    and readiness.queue_item_id = queue_item.id
    and readiness.marketplace_account_key = event.marketplace_account_key
    and readiness.marketplace = event.marketplace
    and readiness.gate_name = 'OPENAI_INPUT_READY'
    and readiness.ready = true
  where event.id = p_signal_event_id
    and event.marketplace_account_key = p_marketplace_account_key
    and event.marketplace = 'EBAY_US'
    and event.event_type = p_signal_type
    and event.event_type in (
      'LISTING_ZERO_VISIBILITY_REVIEW',
      'LISTING_IMPRESSIONS_NO_ENGAGEMENT_REVIEW',
      'LISTING_ENGAGEMENT_NO_CONVERSION_REVIEW',
      'LISTING_WATCHERS_NO_SALE_REVIEW',
      'LISTING_SALE_MARGIN_OR_STOCK_RISK'
    )
    and event.evidence ->> 'classification' = p_classification
    and event.evidence #>> '{experiment,variable}' = p_authorized_variable
    and event.evidence #>> '{experiment,changeCount}' = '1'
    and event.evidence #>> '{experiment,automaticChangeAllowed}' = 'false'
    and event.evidence #>> '{experiment,ebayWriteAllowed}' = 'false'
    and event.evidence #>> '{safety,ownListingEvidenceOnly}' = 'true'
    and event.evidence #>> '{safety,competitorRepricingUsed}' = 'false'
    and event.evidence #>> '{safety,openAiUsed}' = 'false'
    and event.evidence #>> '{safety,ebayWriteUsed}' = 'false'
    and p_sanitized_evidence #>> '{signal,eventType}' = event.event_type
    and p_sanitized_evidence #>> '{signal,classification}' = p_classification
    and p_sanitized_evidence #>> '{signal,authorizedVariable}' = p_authorized_variable
    and coalesce(p_sanitized_evidence #> '{ownListingPerformance,impressions}', 'null'::jsonb)
      = coalesce(to_jsonb(snapshot.impressions), 'null'::jsonb)
    and coalesce(p_sanitized_evidence #> '{ownListingPerformance,views}', 'null'::jsonb)
      = coalesce(to_jsonb(snapshot.views), 'null'::jsonb)
    and coalesce(p_sanitized_evidence #> '{ownListingPerformance,clickThroughRate}', 'null'::jsonb)
      = coalesce(to_jsonb(snapshot.ctr), 'null'::jsonb)
    and coalesce(p_sanitized_evidence #> '{ownListingPerformance,transactions}', 'null'::jsonb)
      = coalesce(to_jsonb(snapshot.transactions), 'null'::jsonb)
    and coalesce(p_sanitized_evidence #> '{ownListingPerformance,conversionRate}', 'null'::jsonb)
      = coalesce(to_jsonb(snapshot.sales_conversion_rate), 'null'::jsonb)
    and coalesce(p_sanitized_evidence #> '{ownListingPerformance,watchers}', 'null'::jsonb)
      = coalesce(to_jsonb(snapshot.current_watchers), 'null'::jsonb)
    and coalesce(p_sanitized_evidence #> '{ownListingPerformance,confirmedUnitsSold}', 'null'::jsonb)
      = 'null'::jsonb
    and coalesce(p_sanitized_evidence #> '{ownListingPerformance,netMarginPercent}', 'null'::jsonb)
      = 'null'::jsonb
    and coalesce(p_sanitized_evidence #> '{ownListingPerformance,stockAvailable}', 'null'::jsonb)
      = 'null'::jsonb
    and readiness.id = (
      select latest.id
      from public.marketplace_product_fact_readiness_events latest
      where latest.queue_item_id = queue_item.id
        and latest.marketplace_account_key = p_marketplace_account_key
        and latest.marketplace = 'EBAY_US'
        and latest.gate_name = 'OPENAI_INPUT_READY'
      order by latest.observed_at desc, latest.created_at desc
      limit 1
    );
  if not found then
    raise exception 'STRATEGIC_ADVISOR_SERVER_SOURCE_BINDING_INVALID';
  end if;
  if coalesce(jsonb_typeof(p_sanitized_evidence -> 'verifiedFacts'), 'null') <> 'array' then
    raise exception 'STRATEGIC_ADVISOR_SERVER_FACT_BINDING_INVALID';
  end if;
  if jsonb_array_length(p_sanitized_evidence -> 'verifiedFacts') = 0
    or exists (
      select 1
      from jsonb_array_elements(p_sanitized_evidence -> 'verifiedFacts') fact
      where not exists (
        select 1
        from public.marketplace_product_fact_resolutions resolution
        where resolution.queue_item_id = p_queue_item_id
          and resolution.marketplace_account_key = p_marketplace_account_key
          and resolution.marketplace = 'EBAY_US'
          and resolution.fact_key = fact ->> 'factKey'
          and resolution.resolution_hash = fact ->> 'evidenceHash'
          and resolution.verification_status = fact ->> 'verificationStatus'
          and resolution.verification_status in ('VERIFIED', 'CORROBORATED', 'DERIVED_VERIFIED')
          and resolution.selected_value = fact -> 'value'
          and coalesce(to_jsonb(resolution.selected_unit), 'null'::jsonb)
            = coalesce(fact -> 'unit', 'null'::jsonb)
          and resolution.id = (
            select latest_resolution.id
            from public.marketplace_product_fact_resolutions latest_resolution
            where latest_resolution.queue_item_id = p_queue_item_id
              and latest_resolution.marketplace_account_key = p_marketplace_account_key
              and latest_resolution.marketplace = 'EBAY_US'
              and latest_resolution.fact_key = resolution.fact_key
            order by latest_resolution.resolved_at desc, latest_resolution.created_at desc
            limit 1
          )
          and exists (
            select 1
            from public.marketplace_product_fact_observations observation
            where observation.id = any(resolution.supporting_observation_ids)
              and observation.queue_item_id = p_queue_item_id
              and observation.marketplace_account_key = p_marketplace_account_key
              and observation.marketplace = 'EBAY_US'
              and observation.verification_status in ('VERIFIED', 'CORROBORATED', 'DERIVED_VERIFIED')
              and observation.source_type in (
                'LUNA_EXACT_VARIANT', 'LUNA_FULFILLMENT',
                'MANUFACTURER_OFFICIAL_PUBLIC', 'OFFICIAL_LABEL',
                'EBAY_CATALOG_OFFICIAL_READONLY', 'EBAY_TAXONOMY_OFFICIAL_READONLY',
                'PHYSICAL_MEASUREMENT_CONFIRMED', 'INTERNAL_DERIVATION'
              )
              and (
                (fact ->> 'sourceAuthority' = 'LUNA_EXACT_VARIANT'
                  and observation.source_type = 'LUNA_EXACT_VARIANT')
                or (fact ->> 'sourceAuthority' = 'FULFILLMENT_CONFIRMED'
                  and observation.source_type = 'LUNA_FULFILLMENT')
                or (fact ->> 'sourceAuthority' = 'MANUFACTURER_OFFICIAL'
                  and observation.source_type = 'MANUFACTURER_OFFICIAL_PUBLIC')
                or (fact ->> 'sourceAuthority' = 'OFFICIAL_LABEL'
                  and observation.source_type = 'OFFICIAL_LABEL')
                or (fact ->> 'sourceAuthority' = 'EBAY_CATALOG'
                  and observation.source_type = 'EBAY_CATALOG_OFFICIAL_READONLY')
                or (fact ->> 'sourceAuthority' = 'EBAY_TAXONOMY'
                  and observation.source_type = 'EBAY_TAXONOMY_OFFICIAL_READONLY')
                or (fact ->> 'sourceAuthority' = 'PHYSICAL_MEASUREMENT'
                  and observation.source_type = 'PHYSICAL_MEASUREMENT_CONFIRMED')
                or (fact ->> 'sourceAuthority' = 'INTERNAL_LEDGER_VERIFIED'
                  and observation.source_type = 'INTERNAL_DERIVATION')
              )
          )
      )
  ) then
    raise exception 'STRATEGIC_ADVISOR_SERVER_FACT_BINDING_INVALID';
  end if;
  select * into v_run
  from public.ebay_strategic_advisor_runs
  where marketplace_account_key = p_marketplace_account_key
    and marketplace_id = 'EBAY_US'
    and (deduplication_key = p_deduplication_key or signal_event_id = p_signal_event_id);
  if found then return v_run; end if;

  insert into public.ebay_strategic_advisor_runs (
    marketplace_account_key, signal_event_id, performance_snapshot_id,
    queue_item_id, readiness_event_id, listing_fingerprint, signal_type, classification,
    authorized_variable, state, contract_version, prompt_version,
    output_schema_version, evidence_hash, input_hash, deduplication_key,
    sanitized_evidence, estimated_input_tokens, max_input_tokens,
    max_output_tokens, estimated_call_cost_micros, max_call_cost_micros,
    daily_budget_micros, created_by_hash, created_at, updated_at
  ) values (
    p_marketplace_account_key, p_signal_event_id, p_performance_snapshot_id,
    p_queue_item_id, p_readiness_event_id, p_listing_fingerprint, p_signal_type, p_classification,
    p_authorized_variable, 'SIGNAL_DETECTED', p_contract_version, p_prompt_version,
    p_output_schema_version, p_evidence_hash, p_input_hash, p_deduplication_key,
    p_sanitized_evidence, p_estimated_input_tokens, p_max_input_tokens,
    p_max_output_tokens, p_estimated_call_cost_micros, p_max_call_cost_micros,
    p_daily_budget_micros, p_actor_hash, p_now, p_now
  ) returning * into v_run;

  insert into public.ebay_strategic_advisor_events (
    run_id, previous_state, next_state, reason_code, triggered_by,
    actor_hash, evidence_hash, idempotency_key_hash, created_at
  ) values
    (v_run.id, null, 'SIGNAL_DETECTED', 'DETERMINISTIC_SIGNAL_ACCEPTED', 'SYSTEM',
      null, p_evidence_hash,
      'sha256:' || encode(extensions.digest(p_idempotency_key_hash || ':signal', 'sha256'), 'hex'), p_now),
    (v_run.id, 'SIGNAL_DETECTED', 'DETERMINISTIC_EVIDENCE_READY',
      'ALLOWLISTED_EVIDENCE_READY', 'SYSTEM', null, p_evidence_hash,
      'sha256:' || encode(extensions.digest(p_idempotency_key_hash || ':evidence', 'sha256'), 'hex'), p_now),
    (v_run.id, 'DETERMINISTIC_EVIDENCE_READY', 'AWAITING_OPERATOR_APPROVAL_TO_CALL',
      'OPENAI_SPEND_APPROVAL_REQUIRED', 'SYSTEM', null, p_evidence_hash,
      'sha256:' || encode(extensions.digest(p_idempotency_key_hash || ':await-spend', 'sha256'), 'hex'), p_now);

  update public.ebay_strategic_advisor_runs
  set state = 'AWAITING_OPERATOR_APPROVAL_TO_CALL', updated_at = p_now
  where id = v_run.id returning * into v_run;
  return v_run;
exception when unique_violation then
  select * into v_run
  from public.ebay_strategic_advisor_runs
  where marketplace_account_key = p_marketplace_account_key
    and marketplace_id = 'EBAY_US'
    and (deduplication_key = p_deduplication_key or signal_event_id = p_signal_event_id);
  return v_run;
end;
$$;

create or replace function public.decide_ebay_strategic_advisor_openai_spend(
  p_run_id uuid,
  p_marketplace_account_key text,
  p_actor_hash text,
  p_evidence_hash text,
  p_idempotency_key_hash text,
  p_approved boolean,
  p_now timestamptz default now()
)
returns public.ebay_strategic_advisor_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.ebay_strategic_advisor_runs%rowtype;
  v_next_state text;
  v_reserved_today bigint := 0;
begin
  select * into v_run from public.ebay_strategic_advisor_runs
  where id = p_run_id
    and marketplace_account_key = p_marketplace_account_key
    and marketplace_id = 'EBAY_US'
  for update;
  if not found then raise exception 'STRATEGIC_ADVISOR_RUN_NOT_FOUND'; end if;
  if exists (
    select 1 from public.ebay_strategic_advisor_approvals
    where run_id = p_run_id and gate = 'OPENAI_SPEND'
      and idempotency_key_hash = p_idempotency_key_hash
  ) then return v_run; end if;
  if v_run.state <> 'AWAITING_OPERATOR_APPROVAL_TO_CALL' then
    raise exception 'STRATEGIC_ADVISOR_OPENAI_SPEND_STATE_INVALID';
  end if;
  if v_run.evidence_hash <> p_evidence_hash then
    raise exception 'STRATEGIC_ADVISOR_OPENAI_SPEND_EVIDENCE_MISMATCH';
  end if;
  if p_approved then
    perform pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        v_run.marketplace_account_key || ':strategic-advisor:' || p_now::date::text,
        0
      )
    );
    select coalesce(sum(run.estimated_call_cost_micros), 0)::bigint
    into v_reserved_today
    from public.ebay_strategic_advisor_approvals approval
    join public.ebay_strategic_advisor_runs run on run.id = approval.run_id
    where run.marketplace_account_key = v_run.marketplace_account_key
      and run.marketplace_id = v_run.marketplace_id
      and approval.gate = 'OPENAI_SPEND'
      and approval.decision = 'APPROVED'
      and approval.created_at >= date_trunc('day', p_now)
      and approval.created_at < date_trunc('day', p_now) + interval '1 day';
  end if;
  if p_approved and (
    v_run.estimated_call_cost_micros <= 0
    or v_run.estimated_call_cost_micros > v_run.max_call_cost_micros
    or v_run.estimated_call_cost_micros > v_run.daily_budget_micros
    or v_reserved_today + v_run.estimated_call_cost_micros > v_run.daily_budget_micros
    or v_run.estimated_input_tokens > v_run.max_input_tokens
  ) then raise exception 'STRATEGIC_ADVISOR_OPENAI_SPEND_BUDGET_BLOCKED'; end if;

  v_next_state := case when p_approved then 'OPENAI_CALL_QUEUED' else 'REJECTED' end;
  insert into public.ebay_strategic_advisor_approvals (
    run_id, gate, decision, actor_hash, bound_evidence_hash,
    approved_budget, idempotency_key_hash, created_at
  ) values (
    p_run_id, 'OPENAI_SPEND', case when p_approved then 'APPROVED' else 'REJECTED' end,
    p_actor_hash, p_evidence_hash,
    jsonb_build_object(
      'estimatedInputTokens', v_run.estimated_input_tokens,
      'maxInputTokens', v_run.max_input_tokens,
      'maxOutputTokens', v_run.max_output_tokens,
      'estimatedCallCostMicros', v_run.estimated_call_cost_micros,
      'maxCallCostMicros', v_run.max_call_cost_micros,
      'dailyBudgetMicros', v_run.daily_budget_micros
    ), p_idempotency_key_hash, p_now
  );
  insert into public.ebay_strategic_advisor_events (
    run_id, previous_state, next_state, reason_code, triggered_by,
    actor_hash, evidence_hash, idempotency_key_hash, created_at
  ) values (
    p_run_id, v_run.state, v_next_state,
    case when p_approved then 'OPENAI_SPEND_APPROVED' else 'OPENAI_SPEND_REJECTED' end,
    'USER', p_actor_hash, p_evidence_hash,
    'sha256:' || encode(extensions.digest(p_idempotency_key_hash || ':transition', 'sha256'), 'hex'), p_now
  );
  if p_approved then
    insert into public.ebay_strategic_advisor_jobs (
      run_id, idempotency_key_hash, available_at, created_at, updated_at
    ) values (
      p_run_id,
      'sha256:' || encode(extensions.digest(p_idempotency_key_hash || ':openai-job', 'sha256'), 'hex'),
      p_now, p_now, p_now
    );
  end if;
  update public.ebay_strategic_advisor_runs
  set state = v_next_state, updated_at = p_now,
      completed_at = case when v_next_state = 'REJECTED' then p_now else null end
  where id = p_run_id returning * into v_run;
  return v_run;
end;
$$;

create or replace function public.record_ebay_strategic_advisor_proposal(
  p_run_id uuid,
  p_marketplace_account_key text,
  p_job_id uuid,
  p_worker_hash text,
  p_output_schema_version text,
  p_output_hash text,
  p_proposal jsonb,
  p_response_id_hash text,
  p_usage_summary jsonb,
  p_estimated_cost_micros bigint,
  p_idempotency_key_hash text,
  p_now timestamptz default now()
)
returns public.ebay_strategic_advisor_proposals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.ebay_strategic_advisor_runs%rowtype;
  v_job public.ebay_strategic_advisor_jobs%rowtype;
  v_proposal public.ebay_strategic_advisor_proposals%rowtype;
begin
  select * into v_run from public.ebay_strategic_advisor_runs
  where id = p_run_id
    and marketplace_account_key = p_marketplace_account_key
    and marketplace_id = 'EBAY_US'
  for update;
  if not found then raise exception 'STRATEGIC_ADVISOR_RUN_NOT_FOUND'; end if;
  select * into v_proposal from public.ebay_strategic_advisor_proposals
  where run_id = p_run_id and output_hash = p_output_hash;
  if found then return v_proposal; end if;
  if v_run.state <> 'OPENAI_CALL_QUEUED' then
    raise exception 'STRATEGIC_ADVISOR_PROPOSAL_STATE_INVALID';
  end if;
  if not exists (
    select 1 from public.ebay_strategic_advisor_approvals
    where run_id = p_run_id and gate = 'OPENAI_SPEND' and decision = 'APPROVED'
      and bound_evidence_hash = v_run.evidence_hash
  ) then raise exception 'STRATEGIC_ADVISOR_OPENAI_SPEND_APPROVAL_REQUIRED'; end if;
  select * into v_job
  from public.ebay_strategic_advisor_jobs
  where id = p_job_id and run_id = p_run_id
  for update;
  if not found
    or v_job.status <> 'LEASED'
    or v_job.lease_owner_hash <> p_worker_hash
    or v_job.lease_expires_at <= p_now then
    raise exception 'STRATEGIC_ADVISOR_JOB_LEASE_INVALID';
  end if;
  if p_estimated_cost_micros < 0
    or p_estimated_cost_micros > v_run.estimated_call_cost_micros
    or p_estimated_cost_micros > v_run.max_call_cost_micros then
    raise exception 'STRATEGIC_ADVISOR_PROPOSAL_COST_EXCEEDS_RESERVATION';
  end if;
  insert into public.ebay_strategic_advisor_proposals (
    run_id, job_id, output_schema_version, output_hash, proposal,
    response_id_hash, usage_summary, estimated_cost_micros, created_at
  ) values (
    p_run_id, p_job_id, p_output_schema_version, p_output_hash, p_proposal,
    p_response_id_hash, p_usage_summary, p_estimated_cost_micros, p_now
  ) returning * into v_proposal;
  insert into public.ebay_strategic_advisor_events (
    run_id, previous_state, next_state, reason_code, triggered_by,
    actor_hash, evidence_hash, idempotency_key_hash, created_at
  ) values
    (p_run_id, 'OPENAI_CALL_QUEUED', 'PROPOSAL_READY', 'STRICT_PROPOSAL_VALIDATED',
      'WORKER', null, v_run.evidence_hash,
      'sha256:' || encode(extensions.digest(p_idempotency_key_hash || ':proposal-ready', 'sha256'), 'hex'), p_now),
    (p_run_id, 'PROPOSAL_READY', 'AWAITING_IMPROVEMENT_APPROVAL',
      'MANUAL_EXPERIMENT_APPROVAL_REQUIRED', 'SYSTEM', null, v_run.evidence_hash,
      'sha256:' || encode(extensions.digest(p_idempotency_key_hash || ':await-experiment', 'sha256'), 'hex'), p_now);
  update public.ebay_strategic_advisor_jobs
  set status = 'COMPLETED', completed_at = p_now, updated_at = p_now,
      lease_owner_hash = null, lease_expires_at = null
  where id = p_job_id and run_id = p_run_id;
  update public.ebay_strategic_advisor_runs
  set state = 'AWAITING_IMPROVEMENT_APPROVAL', openai_call_count = 1,
      updated_at = p_now
  where id = p_run_id;
  return v_proposal;
end;
$$;

create or replace function public.decide_ebay_strategic_advisor_manual_experiment(
  p_run_id uuid,
  p_marketplace_account_key text,
  p_actor_hash text,
  p_evidence_hash text,
  p_proposal_hash text,
  p_idempotency_key_hash text,
  p_approved boolean,
  p_now timestamptz default now()
)
returns public.ebay_strategic_advisor_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.ebay_strategic_advisor_runs%rowtype;
  v_next_state text;
begin
  select * into v_run from public.ebay_strategic_advisor_runs
  where id = p_run_id
    and marketplace_account_key = p_marketplace_account_key
    and marketplace_id = 'EBAY_US'
  for update;
  if not found then raise exception 'STRATEGIC_ADVISOR_RUN_NOT_FOUND'; end if;
  if exists (
    select 1 from public.ebay_strategic_advisor_approvals
    where run_id = p_run_id and gate = 'MANUAL_EXPERIMENT'
      and idempotency_key_hash = p_idempotency_key_hash
  ) then return v_run; end if;
  if v_run.state <> 'AWAITING_IMPROVEMENT_APPROVAL' then
    raise exception 'STRATEGIC_ADVISOR_EXPERIMENT_STATE_INVALID';
  end if;
  if v_run.evidence_hash <> p_evidence_hash then
    raise exception 'STRATEGIC_ADVISOR_EXPERIMENT_EVIDENCE_MISMATCH';
  end if;
  if not exists (
    select 1 from public.ebay_strategic_advisor_proposals
    where run_id = p_run_id and output_hash = p_proposal_hash
  ) then raise exception 'STRATEGIC_ADVISOR_PROPOSAL_HASH_MISMATCH'; end if;
  if p_approved and not exists (
    select 1 from public.ebay_strategic_advisor_proposals proposal
    where proposal.run_id = p_run_id
      and proposal.output_hash = p_proposal_hash
      and proposal.proposal #>> '{recommendation,decision}' = 'TEST'
      and proposal.proposal ->> 'authorizedVariable' = v_run.authorized_variable
      and proposal.proposal #>> '{experiment,changeCount}' = '1'
      and proposal.proposal #>> '{experiment,automaticExecutionAllowed}' = 'false'
      and proposal.proposal #>> '{safety,ebayWriteAllowed}' = 'false'
      and proposal.proposal #>> '{safety,secondOperatorApprovalRequired}' = 'true'
  ) then raise exception 'STRATEGIC_ADVISOR_MANUAL_EXPERIMENT_NOT_APPROVABLE'; end if;
  v_next_state := case when p_approved
    then 'APPROVED_FOR_MANUAL_EXPERIMENT' else 'REJECTED' end;
  insert into public.ebay_strategic_advisor_approvals (
    run_id, gate, decision, actor_hash, bound_evidence_hash,
    bound_proposal_hash, idempotency_key_hash, created_at
  ) values (
    p_run_id, 'MANUAL_EXPERIMENT',
    case when p_approved then 'APPROVED' else 'REJECTED' end,
    p_actor_hash, p_evidence_hash, p_proposal_hash, p_idempotency_key_hash, p_now
  );
  insert into public.ebay_strategic_advisor_events (
    run_id, previous_state, next_state, reason_code, triggered_by,
    actor_hash, evidence_hash, idempotency_key_hash, created_at
  ) values (
    p_run_id, v_run.state, v_next_state,
    case when p_approved then 'MANUAL_EXPERIMENT_APPROVED' else 'MANUAL_EXPERIMENT_REJECTED' end,
    'USER', p_actor_hash, p_evidence_hash,
    'sha256:' || encode(extensions.digest(p_idempotency_key_hash || ':transition', 'sha256'), 'hex'), p_now
  );
  update public.ebay_strategic_advisor_runs
  set state = v_next_state, updated_at = p_now, completed_at = p_now
  where id = p_run_id returning * into v_run;
  return v_run;
end;
$$;

create or replace function public.claim_ebay_strategic_advisor_job(
  p_marketplace_account_key text,
  p_worker_hash text,
  p_lease_seconds integer default 120,
  p_now timestamptz default now()
)
returns public.ebay_strategic_advisor_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.ebay_strategic_advisor_jobs%rowtype;
begin
  if p_lease_seconds < 30 or p_lease_seconds > 300 then
    raise exception 'STRATEGIC_ADVISOR_JOB_LEASE_INVALID';
  end if;
  update public.ebay_strategic_advisor_jobs job
  set status = 'FAILED',
      last_error_code = 'STRATEGIC_ADVISOR_CALL_OUTCOME_AMBIGUOUS_NO_AUTO_RETRY',
      lease_owner_hash = null,
      lease_expires_at = null,
      updated_at = p_now
  from public.ebay_strategic_advisor_runs run
  where run.id = job.run_id
    and run.marketplace_account_key = p_marketplace_account_key
    and run.marketplace_id = 'EBAY_US'
    and job.status = 'LEASED'
    and job.lease_expires_at <= p_now
    and job.attempt_count >= job.max_attempts;
  select job.* into v_job
  from public.ebay_strategic_advisor_jobs job
  join public.ebay_strategic_advisor_runs run on run.id = job.run_id
  where run.state = 'OPENAI_CALL_QUEUED'
    and run.marketplace_account_key = p_marketplace_account_key
    and run.marketplace_id = 'EBAY_US'
    and job.attempt_count < job.max_attempts
    and (
      (job.status = 'PENDING' and job.available_at <= p_now)
      or (job.status = 'LEASED' and job.lease_expires_at <= p_now)
    )
  order by job.created_at
  for update of job skip locked
  limit 1;
  if not found then return null; end if;
  update public.ebay_strategic_advisor_jobs
  set status = 'LEASED', attempt_count = attempt_count + 1,
      lease_owner_hash = p_worker_hash,
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      updated_at = p_now
  where id = v_job.id returning * into v_job;
  return v_job;
end;
$$;

alter table public.ebay_strategic_advisor_runs enable row level security;
alter table public.ebay_strategic_advisor_runs force row level security;
alter table public.ebay_strategic_advisor_events enable row level security;
alter table public.ebay_strategic_advisor_events force row level security;
alter table public.ebay_strategic_advisor_approvals enable row level security;
alter table public.ebay_strategic_advisor_approvals force row level security;
alter table public.ebay_strategic_advisor_jobs enable row level security;
alter table public.ebay_strategic_advisor_jobs force row level security;
alter table public.ebay_strategic_advisor_proposals enable row level security;
alter table public.ebay_strategic_advisor_proposals force row level security;

revoke all on table public.ebay_strategic_advisor_runs from anon, authenticated;
revoke all on table public.ebay_strategic_advisor_events from anon, authenticated;
revoke all on table public.ebay_strategic_advisor_approvals from anon, authenticated;
revoke all on table public.ebay_strategic_advisor_jobs from anon, authenticated;
revoke all on table public.ebay_strategic_advisor_proposals from anon, authenticated;
revoke all on table public.ebay_strategic_advisor_runs from public, service_role;
revoke all on table public.ebay_strategic_advisor_events from public, service_role;
revoke all on table public.ebay_strategic_advisor_approvals from public, service_role;
revoke all on table public.ebay_strategic_advisor_jobs from public, service_role;
revoke all on table public.ebay_strategic_advisor_proposals from public, service_role;
grant select on table public.ebay_strategic_advisor_runs to service_role;
grant select on table public.ebay_strategic_advisor_events to service_role;
grant select on table public.ebay_strategic_advisor_approvals to service_role;
grant select on table public.ebay_strategic_advisor_jobs to service_role;
grant select on table public.ebay_strategic_advisor_proposals to service_role;

revoke all on function public.prevent_ebay_strategic_advisor_append_only_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.create_ebay_strategic_advisor_run(
  text, uuid, uuid, uuid, uuid,
  text, text, text, text, text, text, text, text, text, text,
  jsonb, integer, integer, integer, bigint, bigint, bigint, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.decide_ebay_strategic_advisor_openai_spend(
  uuid, text, text, text, text, boolean, timestamptz
) from public, anon, authenticated;
revoke all on function public.record_ebay_strategic_advisor_proposal(
  uuid, text, uuid, text, text, text, jsonb, text, jsonb, bigint, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.decide_ebay_strategic_advisor_manual_experiment(
  uuid, text, text, text, text, text, boolean, timestamptz
) from public, anon, authenticated;
revoke all on function public.claim_ebay_strategic_advisor_job(
  text, text, integer, timestamptz
) from public, anon, authenticated;

grant execute on function public.create_ebay_strategic_advisor_run(
  text, uuid, uuid, uuid, uuid,
  text, text, text, text, text, text, text, text, text, text,
  jsonb, integer, integer, integer, bigint, bigint, bigint, text, text, timestamptz
) to service_role;
grant execute on function public.decide_ebay_strategic_advisor_openai_spend(
  uuid, text, text, text, text, boolean, timestamptz
) to service_role;
grant execute on function public.record_ebay_strategic_advisor_proposal(
  uuid, text, uuid, text, text, text, jsonb, text, jsonb, bigint, text, timestamptz
) to service_role;
grant execute on function public.decide_ebay_strategic_advisor_manual_experiment(
  uuid, text, text, text, text, text, boolean, timestamptz
) to service_role;
grant execute on function public.claim_ebay_strategic_advisor_job(
  text, text, integer, timestamptz
) to service_role;

comment on table public.ebay_strategic_advisor_runs is
  'Sanitized deterministic evidence and durable state only; no competitor content, PII, URLs, images, raw source data, or eBay writes.';
comment on table public.ebay_strategic_advisor_approvals is
  'Two independent append-only approvals: OpenAI API spend, then one-variable manual experiment.';
comment on table public.ebay_strategic_advisor_jobs is
  'Durable disabled-by-default OpenAI Responses job queue. No scheduler is activated by this migration.';

notify pgrst, 'reload schema';
