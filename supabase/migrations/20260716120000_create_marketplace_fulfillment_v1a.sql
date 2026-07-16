-- Marketplace Fulfillment Manual Purchase & Automated Tracking Loop V1A.
-- Additive, marketplace-neutral and PII-free. V1A has no real marketplace
-- writer: its submission outbox is constrained to the simulated adapter.

create extension if not exists pgcrypto;

alter table public.fulfillment_tasks
  add column if not exists workflow_state text not null default 'PENDING_MANUAL_PURCHASE',
  add column if not exists marketplace_listing_sku text null,
  add column if not exists supplier_sku text null,
  add column if not exists supplier_variant_id text null,
  add column if not exists identity_fingerprint text null,
  add column if not exists identity_verified_at timestamptz null,
  add column if not exists lock_version bigint not null default 0,
  add column if not exists priority integer not null default 100,
  add column if not exists next_action_at timestamptz null,
  add column if not exists last_error_code text null,
  add column if not exists purchase_confirmed_at timestamptz null,
  add column if not exists tracking_approved_at timestamptz null,
  add column if not exists tracking_payload_hash text null,
  add column if not exists current_shipment_id uuid null;

alter table public.fulfillment_tasks
  add constraint fulfillment_tasks_workflow_state_v1a_check check (
    workflow_state in (
      'SALE_DETECTED', 'VALIDATING_ORDER', 'PENDING_MANUAL_PURCHASE',
      'LUNA_ORDER_PLACED', 'WAITING_FOR_TRACKING', 'TRACKING_RECEIVED',
      'TRACKING_VALIDATING', 'TRACKING_READY_FOR_SUBMISSION',
      'TRACKING_SUBMISSION_QUEUED', 'TRACKING_SUBMITTED_SIMULATED',
      'SHIPPED_SIMULATED', 'MANUAL_REVIEW_REQUIRED', 'CANCELLED',
      'RETURN_OR_ISSUE'
    )
  ) not valid;
alter table public.fulfillment_tasks validate constraint fulfillment_tasks_workflow_state_v1a_check;

alter table public.fulfillment_tasks
  add constraint fulfillment_tasks_lock_priority_v1a_check check (
    lock_version >= 0 and priority between 0 and 10000
  ) not valid;
alter table public.fulfillment_tasks validate constraint fulfillment_tasks_lock_priority_v1a_check;

alter table public.fulfillment_tasks
  add constraint fulfillment_tasks_identity_fingerprint_v1a_check check (
    identity_fingerprint is null or identity_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ) not valid;
alter table public.fulfillment_tasks validate constraint fulfillment_tasks_identity_fingerprint_v1a_check;

create table if not exists public.fulfillment_task_events (
  id uuid primary key default gen_random_uuid(),
  fulfillment_task_id uuid not null references public.fulfillment_tasks(id) on delete restrict,
  sequence_number bigint not null,
  event_type text not null,
  from_state text null,
  to_state text not null,
  actor_type text not null,
  actor_id text null,
  idempotency_key text not null,
  evidence jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  constraint fulfillment_task_events_sequence_unique unique (
    fulfillment_task_id, sequence_number
  ),
  constraint fulfillment_task_events_idempotency_unique unique (
    fulfillment_task_id, idempotency_key
  ),
  constraint fulfillment_task_events_evidence_check check (
    jsonb_typeof(evidence) = 'object'
  )
);

create table if not exists public.supplier_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  fulfillment_task_id uuid not null references public.fulfillment_tasks(id) on delete restrict,
  marketplace_account_key text not null,
  supplier text not null default 'LUNA_PORTEX',
  supplier_order_id text not null,
  product_cost numeric(14,2) not null,
  shipping_cost numeric(14,2) not null,
  tax_amount numeric(14,2) not null default 0,
  total_paid numeric(14,2) not null,
  currency text not null,
  product_url text not null,
  purchased_at timestamptz not null,
  confirmed_by text null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint supplier_purchase_orders_task_unique unique (fulfillment_task_id),
  constraint supplier_purchase_orders_supplier_order_unique unique (
    marketplace_account_key, supplier, supplier_order_id
  ),
  constraint supplier_purchase_orders_amount_check check (
    product_cost >= 0 and shipping_cost >= 0 and tax_amount >= 0
    and total_paid >= 0
    and abs(total_paid - product_cost - shipping_cost - tax_amount) <= 0.01
  ),
  constraint supplier_purchase_orders_currency_check check (currency in ('USD', 'GTQ')),
  constraint supplier_purchase_orders_luna_url_check check (
    product_url ~ '^https://([A-Za-z0-9-]+[.])*lunaportex[.]com(/|$)'
  )
);

create table if not exists public.supplier_purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  supplier_purchase_order_id uuid not null references public.supplier_purchase_orders(id) on delete restrict,
  fulfillment_task_id uuid not null references public.fulfillment_tasks(id) on delete restrict,
  marketplace_line_item_id text not null,
  supplier_sku text not null,
  supplier_variant_id text not null,
  quantity integer not null,
  unit_cost numeric(14,2) not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint supplier_purchase_order_items_task_unique unique (
    supplier_purchase_order_id, fulfillment_task_id
  ),
  constraint supplier_purchase_order_items_quantity_check check (quantity between 1 and 100000),
  constraint supplier_purchase_order_items_cost_check check (unit_cost >= 0)
);

create table if not exists public.marketplace_fulfillment_shipments (
  id uuid primary key default gen_random_uuid(),
  primary_fulfillment_task_id uuid not null references public.fulfillment_tasks(id) on delete restrict,
  marketplace_account_key text not null,
  marketplace text not null,
  marketplace_order_id text not null,
  package_sequence integer not null,
  tracking_number text not null,
  suggested_carrier text null,
  confirmed_carrier text not null,
  shipped_at timestamptz not null,
  partial_shipment boolean not null,
  normalized_payload jsonb not null,
  payload_hash text not null,
  approval_status text not null default 'pending',
  approved_at timestamptz null,
  approved_by text null,
  superseded_at timestamptz null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint marketplace_fulfillment_shipments_package_unique unique (
    marketplace_account_key, marketplace, marketplace_order_id,
    package_sequence
  ),
  constraint marketplace_fulfillment_shipments_payload_unique unique (
    marketplace_account_key, marketplace, marketplace_order_id, payload_hash
  ),
  constraint marketplace_fulfillment_shipments_hash_check check (
    payload_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint marketplace_fulfillment_shipments_payload_check check (
    jsonb_typeof(normalized_payload) = 'object'
  ),
  constraint marketplace_fulfillment_shipments_approval_check check (
    approval_status in ('pending', 'approved', 'invalidated')
  )
);

create table if not exists public.marketplace_fulfillment_shipment_items (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.marketplace_fulfillment_shipments(id) on delete restrict,
  fulfillment_task_id uuid not null references public.fulfillment_tasks(id) on delete restrict,
  marketplace_line_item_id text not null,
  listing_id text not null,
  marketplace_listing_sku text not null,
  supplier_sku text not null,
  quantity integer not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_fulfillment_shipment_items_line_unique unique (
    shipment_id, marketplace_line_item_id
  ),
  constraint marketplace_fulfillment_shipment_items_quantity_check check (
    quantity between 1 and 100000
  )
);

alter table public.fulfillment_tasks
  add constraint fulfillment_tasks_current_shipment_v1a_fk
  foreign key (current_shipment_id)
  references public.marketplace_fulfillment_shipments(id)
  on delete restrict
  not valid;
alter table public.fulfillment_tasks validate constraint fulfillment_tasks_current_shipment_v1a_fk;

create table if not exists public.marketplace_fulfillment_submission_outbox (
  id uuid primary key default gen_random_uuid(),
  fulfillment_task_id uuid not null references public.fulfillment_tasks(id) on delete restrict,
  shipment_id uuid not null references public.marketplace_fulfillment_shipments(id) on delete restrict,
  marketplace_account_key text not null,
  marketplace text not null,
  marketplace_order_id text not null,
  payload_hash text not null,
  idempotency_key text not null,
  adapter text not null default 'simulated',
  simulation_scenario text not null default 'success',
  order_guard_status text not null default 'clear',
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  due_at timestamptz not null default clock_timestamp(),
  lease_owner text null,
  lease_expires_at timestamptz null,
  simulated_remote_id text null,
  accepted_at timestamptz null,
  reconciled_at timestamptz null,
  dead_lettered_at timestamptz null,
  last_error_code text null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint marketplace_fulfillment_submission_outbox_hash_unique unique (
    marketplace_account_key, marketplace, marketplace_order_id, payload_hash
  ),
  constraint marketplace_fulfillment_submission_outbox_idempotency_unique unique (
    idempotency_key
  ),
  constraint marketplace_fulfillment_submission_outbox_adapter_check check (
    adapter = 'simulated'
  ),
  constraint marketplace_fulfillment_submission_outbox_scenario_check check (
    simulation_scenario in (
      'success', 'temporary_error', 'permanent_error', 'ambiguous_timeout',
      'duplicate_response', 'fulfillment_already_exists'
    )
  ),
  constraint marketplace_fulfillment_submission_outbox_guard_check check (
    order_guard_status in ('clear', 'cancelled', 'refunded', 'already_fulfilled')
  ),
  constraint marketplace_fulfillment_submission_outbox_status_check check (
    status in (
      'pending', 'leased', 'retry', 'awaiting_reconciliation',
      'simulated_submitted', 'dead_letter', 'cancelled', 'blocked'
    )
  ),
  constraint marketplace_fulfillment_submission_outbox_attempts_check check (
    attempts >= 0 and max_attempts between 1 and 20
  )
);

create table if not exists public.marketplace_fulfillment_submission_attempts (
  id uuid primary key default gen_random_uuid(),
  submission_outbox_id uuid not null references public.marketplace_fulfillment_submission_outbox(id) on delete restrict,
  attempt_number integer not null,
  worker_id text not null,
  request_payload_hash text not null,
  outcome text not null default 'started',
  response_code text null,
  error_code text null,
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz null,
  constraint marketplace_fulfillment_submission_attempts_unique unique (
    submission_outbox_id, attempt_number
  ),
  constraint marketplace_fulfillment_submission_attempts_outcome_check check (
    outcome in (
      'started', 'accepted', 'already_exists', 'temporary_error',
      'permanent_error', 'ambiguous_timeout', 'reconciled', 'blocked'
    )
  )
);

create index if not exists fulfillment_tasks_work_queue_v1a_idx
  on public.fulfillment_tasks(
    marketplace_account_key, marketplace, workflow_state, priority,
    next_action_at, ship_by_at
  );
create index if not exists fulfillment_tasks_order_identity_v1a_idx
  on public.fulfillment_tasks(
    marketplace_account_key, marketplace, marketplace_order_id,
    marketplace_line_item_id, listing_id, marketplace_listing_sku, supplier_sku
  );
create index if not exists fulfillment_task_events_task_time_v1a_idx
  on public.fulfillment_task_events(fulfillment_task_id, sequence_number desc);
create index if not exists supplier_purchase_orders_account_time_v1a_idx
  on public.supplier_purchase_orders(marketplace_account_key, purchased_at desc);
create index if not exists marketplace_fulfillment_shipments_order_v1a_idx
  on public.marketplace_fulfillment_shipments(
    marketplace_account_key, marketplace, marketplace_order_id, created_at desc
  );
create index if not exists marketplace_fulfillment_shipment_items_task_v1a_idx
  on public.marketplace_fulfillment_shipment_items(fulfillment_task_id, created_at desc);
create index if not exists marketplace_fulfillment_submission_claim_v1a_idx
  on public.marketplace_fulfillment_submission_outbox(
    status, due_at, attempts, created_at
  ) where status in ('pending', 'retry', 'leased', 'awaiting_reconciliation');
create index if not exists marketplace_fulfillment_submission_attempts_time_v1a_idx
  on public.marketplace_fulfillment_submission_attempts(submission_outbox_id, started_at desc);

create or replace function public.fulfillment_payload_safe_v1a(p_payload jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_typeof(p_payload) = 'object', false)
    and lower(coalesce(p_payload::text, '')) !~
      '"(buyer|shipto|shippingaddress|addressline|fullname|email|phone|cardnumber|cvv|paymentmethod)"[[:space:]]*:';
$$;

create or replace function public.fulfillment_transition_allowed_v1a(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select (p_from, p_to) in (
    values
      ('SALE_DETECTED','VALIDATING_ORDER'),
      ('VALIDATING_ORDER','PENDING_MANUAL_PURCHASE'),
      ('PENDING_MANUAL_PURCHASE','LUNA_ORDER_PLACED'),
      ('LUNA_ORDER_PLACED','WAITING_FOR_TRACKING'),
      ('WAITING_FOR_TRACKING','TRACKING_RECEIVED'),
      ('TRACKING_RECEIVED','TRACKING_VALIDATING'),
      ('TRACKING_VALIDATING','TRACKING_READY_FOR_SUBMISSION'),
      ('TRACKING_READY_FOR_SUBMISSION','TRACKING_RECEIVED'),
      ('TRACKING_READY_FOR_SUBMISSION','TRACKING_SUBMISSION_QUEUED'),
      ('TRACKING_SUBMISSION_QUEUED','TRACKING_RECEIVED'),
      ('TRACKING_SUBMISSION_QUEUED','TRACKING_SUBMITTED_SIMULATED'),
      ('TRACKING_SUBMITTED_SIMULATED','SHIPPED_SIMULATED'),
      ('MANUAL_REVIEW_REQUIRED','PENDING_MANUAL_PURCHASE'),
      ('MANUAL_REVIEW_REQUIRED','WAITING_FOR_TRACKING'),
      ('MANUAL_REVIEW_REQUIRED','TRACKING_READY_FOR_SUBMISSION'),
      ('RETURN_OR_ISSUE','MANUAL_REVIEW_REQUIRED')
  ) or (
    p_to in ('MANUAL_REVIEW_REQUIRED','CANCELLED','RETURN_OR_ISSUE')
    and p_from not in ('CANCELLED','RETURN_OR_ISSUE')
    and not (p_from = 'SHIPPED_SIMULATED' and p_to = 'CANCELLED')
  );
$$;

create or replace function public.prevent_fulfillment_event_mutation_v1a()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'FULFILLMENT_EVENTS_APPEND_ONLY';
end;
$$;

create trigger fulfillment_task_events_append_only_v1a
before update or delete on public.fulfillment_task_events
for each row execute function public.prevent_fulfillment_event_mutation_v1a();

create or replace function public.guard_fulfillment_workflow_state_v1a()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.workflow_state is distinct from old.workflow_state and
    coalesce(current_setting('seller_os.fulfillment_transition_engine', true), '') <> 'on' then
    raise exception 'FULFILLMENT_STATE_ENGINE_REQUIRED';
  end if;
  if new.lock_version < old.lock_version then
    raise exception 'FULFILLMENT_LOCK_VERSION_REGRESSION';
  end if;
  return new;
end;
$$;

create trigger fulfillment_tasks_state_engine_only_v1a
before update on public.fulfillment_tasks
for each row execute function public.guard_fulfillment_workflow_state_v1a();

create or replace function public.initialize_fulfillment_task_events_v1a()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  insert into public.fulfillment_task_events (
    fulfillment_task_id, sequence_number, event_type, from_state, to_state,
    actor_type, idempotency_key, evidence, occurred_at
  ) values
    (new.id, 1, 'SALE_DETECTED', null, 'SALE_DETECTED', 'commercial_monitor',
      'task-created:sale', jsonb_build_object('identityFingerprint',new.identity_fingerprint), new.created_at),
    (new.id, 2, 'VALIDATING_ORDER', 'SALE_DETECTED', 'VALIDATING_ORDER', 'commercial_monitor',
      'task-created:validation', jsonb_build_object('identityVerified',new.identity_verified_at is not null), new.created_at),
    (new.id, 3, new.workflow_state, 'VALIDATING_ORDER', new.workflow_state, 'commercial_monitor',
      'task-created:ready', jsonb_build_object('nextAction','CONFIRM_MANUAL_PURCHASE'), new.created_at);
  return new;
end;
$$;

create trigger fulfillment_tasks_initialize_events_v1a
after insert on public.fulfillment_tasks
for each row execute function public.initialize_fulfillment_task_events_v1a();

create or replace function public.apply_fulfillment_transition_v1a(
  p_task_id uuid,
  p_from_state text,
  p_to_state text,
  p_actor_type text,
  p_actor_id text,
  p_idempotency_key text,
  p_evidence jsonb default '{}'::jsonb
)
returns public.fulfillment_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task public.fulfillment_tasks;
  v_sequence bigint;
  v_now timestamptz := clock_timestamp();
begin
  if not public.fulfillment_transition_allowed_v1a(p_from_state, p_to_state) then
    raise exception 'FULFILLMENT_TRANSITION_NOT_ALLOWED';
  end if;
  if nullif(trim(p_idempotency_key), '') is null or
    not public.fulfillment_payload_safe_v1a(coalesce(p_evidence, '{}'::jsonb)) then
    raise exception 'FULFILLMENT_TRANSITION_INPUT_UNSAFE';
  end if;

  if exists (
    select 1 from public.fulfillment_task_events
    where fulfillment_task_id = p_task_id and idempotency_key = p_idempotency_key
  ) then
    select * into strict v_task from public.fulfillment_tasks where id = p_task_id;
    return v_task;
  end if;

  select * into strict v_task from public.fulfillment_tasks where id = p_task_id for update;
  if v_task.workflow_state <> p_from_state then
    raise exception 'FULFILLMENT_EXPECTED_STATE_MISMATCH';
  end if;

  perform set_config('seller_os.fulfillment_transition_engine', 'on', true);
  update public.fulfillment_tasks
  set workflow_state = p_to_state,
      status = case
        when p_to_state in ('LUNA_ORDER_PLACED','WAITING_FOR_TRACKING','TRACKING_RECEIVED','TRACKING_VALIDATING')
          then 'PURCHASED_AWAITING_TRACKING'
        when p_to_state in ('TRACKING_READY_FOR_SUBMISSION','TRACKING_SUBMISSION_QUEUED','TRACKING_SUBMITTED_SIMULATED','SHIPPED_SIMULATED')
          then 'TRACKING_READY'
        when p_to_state = 'CANCELLED' then 'CANCELLED'
        else 'PENDING_MANUAL_PURCHASE'
      end,
      status_history = status_history || jsonb_build_array(jsonb_build_object(
        'status', p_to_state, 'at', v_now, 'actor', left(coalesce(p_actor_type, 'system'), 80)
      )),
      lock_version = lock_version + 1,
      next_action_at = case p_to_state
        when 'WAITING_FOR_TRACKING' then v_now
        when 'TRACKING_READY_FOR_SUBMISSION' then v_now
        when 'TRACKING_SUBMISSION_QUEUED' then v_now
        else next_action_at
      end,
      last_error_code = case when p_to_state = 'MANUAL_REVIEW_REQUIRED'
        then left(coalesce(p_evidence->>'errorCode', 'FULFILLMENT_MANUAL_REVIEW_REQUIRED'), 120)
        else null end,
      updated_at = v_now
  where id = p_task_id and workflow_state = p_from_state
  returning * into strict v_task;

  select coalesce(max(sequence_number), 0) + 1 into v_sequence
  from public.fulfillment_task_events where fulfillment_task_id = p_task_id;
  insert into public.fulfillment_task_events (
    fulfillment_task_id, sequence_number, event_type, from_state, to_state,
    actor_type, actor_id, idempotency_key, evidence, occurred_at
  ) values (
    p_task_id, v_sequence, p_to_state, p_from_state, p_to_state,
    left(coalesce(p_actor_type, 'system'), 80), nullif(left(coalesce(p_actor_id, ''), 160), ''),
    left(p_idempotency_key, 240), coalesce(p_evidence, '{}'::jsonb), v_now
  );
  return v_task;
end;
$$;

create or replace function public.transition_fulfillment_task_v1a(
  p_task_id uuid,
  p_expected_state text,
  p_target_state text,
  p_expected_lock_version bigint,
  p_actor_type text,
  p_actor_id text,
  p_idempotency_key text,
  p_evidence jsonb default '{}'::jsonb
)
returns public.fulfillment_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task public.fulfillment_tasks;
begin
  if exists (
    select 1 from public.fulfillment_task_events
    where fulfillment_task_id = p_task_id and idempotency_key = p_idempotency_key
  ) then
    select * into strict v_task from public.fulfillment_tasks where id = p_task_id;
    return v_task;
  end if;
  select * into strict v_task from public.fulfillment_tasks where id = p_task_id for update;
  if v_task.workflow_state <> p_expected_state then raise exception 'FULFILLMENT_EXPECTED_STATE_MISMATCH'; end if;
  if v_task.lock_version <> p_expected_lock_version then raise exception 'FULFILLMENT_LOCK_VERSION_CONFLICT'; end if;
  return public.apply_fulfillment_transition_v1a(
    p_task_id, p_expected_state, p_target_state, p_actor_type, p_actor_id,
    p_idempotency_key, p_evidence
  );
end;
$$;

create or replace function public.confirm_fulfillment_purchase_v1a(
  p_task_id uuid,
  p_expected_lock_version bigint,
  p_luna_order_id text,
  p_product_cost numeric,
  p_shipping_cost numeric,
  p_tax_amount numeric,
  p_total_paid numeric,
  p_currency text,
  p_purchased_at timestamptz,
  p_actor_id text,
  p_idempotency_key text
)
returns public.fulfillment_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task public.fulfillment_tasks;
  v_existing public.supplier_purchase_orders;
begin
  select * into strict v_task from public.fulfillment_tasks where id = p_task_id for update;
  select * into v_existing from public.supplier_purchase_orders where fulfillment_task_id = p_task_id;
  if found then
    if v_existing.supplier_order_id <> trim(p_luna_order_id) then
      raise exception 'FULFILLMENT_PURCHASE_ORDER_CONFLICT';
    end if;
    return v_task;
  end if;
  if v_task.workflow_state <> 'PENDING_MANUAL_PURCHASE' then raise exception 'FULFILLMENT_PURCHASE_STATE_INVALID'; end if;
  if v_task.lock_version <> p_expected_lock_version then raise exception 'FULFILLMENT_LOCK_VERSION_CONFLICT'; end if;
  if v_task.identity_verified_at is null or v_task.identity_fingerprint is null or
    v_task.marketplace_listing_sku is null or v_task.supplier_sku is null or
    v_task.supplier_variant_id is null then
    raise exception 'FULFILLMENT_IDENTITY_NOT_VERIFIED';
  end if;
  if v_task.source_product_url is null or v_task.source_product_url !~ '^https://([A-Za-z0-9-]+[.])*lunaportex[.]com(/|$)' then
    raise exception 'FULFILLMENT_LUNA_LINK_INVALID';
  end if;
  if least(p_product_cost,p_shipping_cost,coalesce(p_tax_amount,0),p_total_paid) < 0 or
    abs(p_total_paid - p_product_cost - p_shipping_cost - coalesce(p_tax_amount,0)) > 0.01 then
    raise exception 'FULFILLMENT_TOTAL_INCOHERENT';
  end if;

  insert into public.supplier_purchase_orders (
    fulfillment_task_id, marketplace_account_key, supplier_order_id,
    product_cost, shipping_cost, tax_amount, total_paid, currency,
    product_url, purchased_at, confirmed_by
  ) values (
    v_task.id, v_task.marketplace_account_key, left(trim(p_luna_order_id), 120),
    p_product_cost, p_shipping_cost, coalesce(p_tax_amount,0), p_total_paid,
    upper(p_currency), v_task.source_product_url, p_purchased_at,
    nullif(left(coalesce(p_actor_id,''),160),'')
  ) returning * into v_existing;

  insert into public.supplier_purchase_order_items (
    supplier_purchase_order_id, fulfillment_task_id, marketplace_line_item_id,
    supplier_sku, supplier_variant_id, quantity, unit_cost
  ) values (
    v_existing.id, v_task.id, v_task.marketplace_line_item_id,
    v_task.supplier_sku, v_task.supplier_variant_id, v_task.quantity,
    case when v_task.quantity > 0 then round(p_product_cost / v_task.quantity, 2) else p_product_cost end
  );

  v_task := public.apply_fulfillment_transition_v1a(
    p_task_id, 'PENDING_MANUAL_PURCHASE', 'LUNA_ORDER_PLACED', 'admin', p_actor_id,
    p_idempotency_key || ':placed', jsonb_build_object('supplier','LUNA_PORTEX')
  );
  v_task := public.apply_fulfillment_transition_v1a(
    p_task_id, 'LUNA_ORDER_PLACED', 'WAITING_FOR_TRACKING', 'system', p_actor_id,
    p_idempotency_key || ':waiting', jsonb_build_object('purchaseOrderId',v_existing.id)
  );
  update public.fulfillment_tasks set purchase_confirmed_at = p_purchased_at, updated_at = clock_timestamp()
  where id = p_task_id returning * into v_task;
  return v_task;
end;
$$;

create or replace function public.save_fulfillment_tracking_v1a(
  p_task_id uuid,
  p_expected_lock_version bigint,
  p_payload jsonb,
  p_payload_hash text,
  p_actor_id text,
  p_idempotency_key text
)
returns public.marketplace_fulfillment_shipments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_primary public.fulfillment_tasks;
  v_task public.fulfillment_tasks;
  v_shipment public.marketplace_fulfillment_shipments;
  v_item jsonb;
  v_sequence integer;
  v_from text;
begin
  if not public.fulfillment_payload_safe_v1a(p_payload) or
    p_payload_hash !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'FULFILLMENT_TRACKING_PAYLOAD_UNSAFE';
  end if;
  select * into strict v_primary from public.fulfillment_tasks where id = p_task_id for update;
  if v_primary.lock_version <> p_expected_lock_version then raise exception 'FULFILLMENT_LOCK_VERSION_CONFLICT'; end if;
  if v_primary.workflow_state not in ('WAITING_FOR_TRACKING','TRACKING_READY_FOR_SUBMISSION','TRACKING_SUBMISSION_QUEUED') then
    raise exception 'FULFILLMENT_TRACKING_STATE_INVALID';
  end if;
  if v_primary.identity_verified_at is null or v_primary.identity_fingerprint is null then
    raise exception 'FULFILLMENT_IDENTITY_NOT_VERIFIED';
  end if;

  select * into v_shipment from public.marketplace_fulfillment_shipments
  where marketplace_account_key = v_primary.marketplace_account_key
    and marketplace = v_primary.marketplace
    and marketplace_order_id = v_primary.marketplace_order_id
    and payload_hash = p_payload_hash;
  if found then return v_shipment; end if;

  update public.marketplace_fulfillment_shipments
  set approval_status = 'invalidated', superseded_at = clock_timestamp(), updated_at = clock_timestamp()
  where marketplace_account_key = v_primary.marketplace_account_key
    and marketplace = v_primary.marketplace
    and marketplace_order_id = v_primary.marketplace_order_id
    and superseded_at is null;
  update public.marketplace_fulfillment_submission_outbox
  set status = 'cancelled', last_error_code = 'FULFILLMENT_PAYLOAD_CHANGED', updated_at = clock_timestamp()
  where marketplace_account_key = v_primary.marketplace_account_key
    and marketplace = v_primary.marketplace
    and marketplace_order_id = v_primary.marketplace_order_id
    and status in ('pending','retry','leased','awaiting_reconciliation');

  select coalesce(max(package_sequence),0)+1 into v_sequence
  from public.marketplace_fulfillment_shipments
  where marketplace_account_key = v_primary.marketplace_account_key
    and marketplace = v_primary.marketplace
    and marketplace_order_id = v_primary.marketplace_order_id;
  insert into public.marketplace_fulfillment_shipments (
    primary_fulfillment_task_id, marketplace_account_key, marketplace,
    marketplace_order_id, package_sequence, tracking_number,
    suggested_carrier, confirmed_carrier, shipped_at, partial_shipment,
    normalized_payload, payload_hash
  ) values (
    v_primary.id, v_primary.marketplace_account_key, v_primary.marketplace,
    v_primary.marketplace_order_id, v_sequence, p_payload->>'trackingNumber',
    nullif(p_payload->>'suggestedCarrier',''), p_payload->>'carrier',
    (p_payload->>'shippedDate')::timestamptz,
    coalesce((p_payload->>'partialShipment')::boolean,false), p_payload, p_payload_hash
  ) returning * into v_shipment;

  for v_item in select value from jsonb_array_elements(p_payload->'items') loop
    select * into strict v_task from public.fulfillment_tasks
    where marketplace_account_key = v_primary.marketplace_account_key
      and marketplace = v_primary.marketplace
      and marketplace_order_id = v_primary.marketplace_order_id
      and marketplace_line_item_id = v_item->>'lineItemId'
    for update;
    if v_task.listing_id <> v_item->>'listingId' or
      v_task.marketplace_listing_sku <> v_item->>'marketplaceListingSku' or
      v_task.supplier_sku <> v_item->>'supplierSku' or
      v_task.quantity < (v_item->>'quantity')::integer or
      v_task.identity_verified_at is null then
      raise exception 'FULFILLMENT_SHIPMENT_IDENTITY_MISMATCH';
    end if;
    if v_task.workflow_state not in ('WAITING_FOR_TRACKING','TRACKING_READY_FOR_SUBMISSION','TRACKING_SUBMISSION_QUEUED') then
      raise exception 'FULFILLMENT_SHIPMENT_ITEM_STATE_INVALID';
    end if;
    insert into public.marketplace_fulfillment_shipment_items (
      shipment_id, fulfillment_task_id, marketplace_line_item_id, listing_id,
      marketplace_listing_sku, supplier_sku, quantity
    ) values (
      v_shipment.id, v_task.id, v_task.marketplace_line_item_id, v_task.listing_id,
      v_task.marketplace_listing_sku, v_task.supplier_sku, (v_item->>'quantity')::integer
    );
    v_from := v_task.workflow_state;
    perform public.apply_fulfillment_transition_v1a(
      v_task.id, v_from, 'TRACKING_RECEIVED', 'admin', p_actor_id,
      p_idempotency_key || ':' || v_task.id || ':received', jsonb_build_object('payloadHash',p_payload_hash)
    );
    perform public.apply_fulfillment_transition_v1a(
      v_task.id, 'TRACKING_RECEIVED', 'TRACKING_VALIDATING', 'system', p_actor_id,
      p_idempotency_key || ':' || v_task.id || ':validating', jsonb_build_object('payloadHash',p_payload_hash)
    );
    perform public.apply_fulfillment_transition_v1a(
      v_task.id, 'TRACKING_VALIDATING', 'TRACKING_READY_FOR_SUBMISSION', 'system', p_actor_id,
      p_idempotency_key || ':' || v_task.id || ':ready', jsonb_build_object('payloadHash',p_payload_hash)
    );
    update public.fulfillment_tasks
    set current_shipment_id = v_shipment.id, tracking_payload_hash = p_payload_hash,
        tracking_approved_at = null, tracking_number = p_payload->>'trackingNumber',
        updated_at = clock_timestamp()
    where id = v_task.id;
  end loop;
  return v_shipment;
end;
$$;

create or replace function public.approve_fulfillment_tracking_v1a(
  p_task_id uuid,
  p_expected_lock_version bigint,
  p_payload_hash text,
  p_actor_id text,
  p_idempotency_key text,
  p_simulation_scenario text default 'success'
)
returns public.marketplace_fulfillment_submission_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_primary public.fulfillment_tasks;
  v_task public.fulfillment_tasks;
  v_shipment public.marketplace_fulfillment_shipments;
  v_outbox public.marketplace_fulfillment_submission_outbox;
  v_guard text := 'clear';
begin
  select * into strict v_primary from public.fulfillment_tasks where id = p_task_id for update;
  if v_primary.lock_version <> p_expected_lock_version then raise exception 'FULFILLMENT_LOCK_VERSION_CONFLICT'; end if;
  if v_primary.workflow_state <> 'TRACKING_READY_FOR_SUBMISSION' or
    v_primary.tracking_payload_hash <> p_payload_hash then
    raise exception 'FULFILLMENT_APPROVAL_PAYLOAD_MISMATCH';
  end if;
  select * into strict v_shipment from public.marketplace_fulfillment_shipments
  where id = v_primary.current_shipment_id and payload_hash = p_payload_hash
    and approval_status = 'pending' and superseded_at is null;

  select case
    when lower(coalesce(payment_status,'')) like '%refund%' then 'refunded'
    when lower(coalesce(fulfillment_status,'')) in ('fulfilled','shipped') then 'already_fulfilled'
    when lower(coalesce(fulfillment_status,'')) like '%cancel%' then 'cancelled'
    else 'clear' end into v_guard
  from public.marketplace_order_snapshots
  where marketplace_account_key = v_primary.marketplace_account_key
    and marketplace = v_primary.marketplace
    and marketplace_order_id = v_primary.marketplace_order_id;
  v_guard := coalesce(v_guard, 'clear');
  if v_guard <> 'clear' then raise exception 'FULFILLMENT_ORDER_GUARD_BLOCKED'; end if;

  insert into public.marketplace_fulfillment_submission_outbox (
    fulfillment_task_id, shipment_id, marketplace_account_key, marketplace,
    marketplace_order_id, payload_hash, idempotency_key, simulation_scenario,
    order_guard_status
  ) values (
    v_primary.id, v_shipment.id, v_primary.marketplace_account_key,
    v_primary.marketplace, v_primary.marketplace_order_id, p_payload_hash,
    left(p_idempotency_key,240), p_simulation_scenario, v_guard
  ) on conflict (marketplace_account_key, marketplace, marketplace_order_id, payload_hash)
    do update set updated_at = excluded.updated_at
  returning * into v_outbox;

  update public.marketplace_fulfillment_shipments
  set approval_status = 'approved', approved_at = clock_timestamp(),
      approved_by = nullif(left(coalesce(p_actor_id,''),160),''), updated_at = clock_timestamp()
  where id = v_shipment.id;

  for v_task in
    select task.* from public.fulfillment_tasks task
    join public.marketplace_fulfillment_shipment_items item on item.fulfillment_task_id = task.id
    where item.shipment_id = v_shipment.id order by task.id for update of task
  loop
    if v_task.workflow_state <> 'TRACKING_READY_FOR_SUBMISSION' or
      v_task.tracking_payload_hash <> p_payload_hash then
      raise exception 'FULFILLMENT_APPROVAL_ITEM_MISMATCH';
    end if;
    perform public.apply_fulfillment_transition_v1a(
      v_task.id, 'TRACKING_READY_FOR_SUBMISSION', 'TRACKING_SUBMISSION_QUEUED',
      'admin', p_actor_id, p_idempotency_key || ':' || v_task.id || ':queued',
      jsonb_build_object('payloadHash',p_payload_hash,'submissionId',v_outbox.id)
    );
    update public.fulfillment_tasks set tracking_approved_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_task.id;
  end loop;
  return v_outbox;
end;
$$;

create or replace function public.claim_fulfillment_submissions_v1a(
  p_worker_id text,
  p_limit integer default 5,
  p_lease_seconds integer default 120
)
returns setof public.marketplace_fulfillment_submission_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_now timestamptz := clock_timestamp();
begin
  update public.marketplace_fulfillment_submission_outbox
  set status = case when attempts >= max_attempts then 'dead_letter' else 'retry' end,
      due_at = v_now, lease_owner = null, lease_expires_at = null,
      last_error_code = 'FULFILLMENT_SUBMISSION_LEASE_EXPIRED', updated_at = v_now,
      dead_lettered_at = case when attempts >= max_attempts then v_now else dead_lettered_at end
  where status = 'leased' and lease_expires_at < v_now;

  return query
  with picked as (
    select id from public.marketplace_fulfillment_submission_outbox
    where status in ('pending','retry') and due_at <= v_now
      and attempts < max_attempts and adapter = 'simulated' and order_guard_status = 'clear'
    order by due_at, created_at for update skip locked
    limit greatest(1,least(coalesce(p_limit,5),25))
  ), claimed as (
    update public.marketplace_fulfillment_submission_outbox outbox
    set status = 'leased', attempts = attempts + 1,
        lease_owner = left(p_worker_id,160),
        lease_expires_at = v_now + make_interval(secs => greatest(30,least(coalesce(p_lease_seconds,120),600))),
        updated_at = v_now
    where outbox.id in (select id from picked) returning outbox.*
  ), attempts as (
    insert into public.marketplace_fulfillment_submission_attempts (
      submission_outbox_id, attempt_number, worker_id, request_payload_hash
    ) select id, attempts, left(p_worker_id,160), payload_hash from claimed
    on conflict (submission_outbox_id,attempt_number) do nothing returning submission_outbox_id
  )
  select claimed.* from claimed join attempts on attempts.submission_outbox_id = claimed.id;
end;
$$;

create or replace function public.record_fulfillment_simulation_outcome_v1a(
  p_outbox_id uuid,
  p_worker_id text,
  p_outcome text,
  p_code text,
  p_remote_id text,
  p_accepted_remotely boolean
)
returns public.marketplace_fulfillment_submission_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_outbox public.marketplace_fulfillment_submission_outbox;
  v_task public.fulfillment_tasks;
  v_now timestamptz := clock_timestamp();
begin
  select * into strict v_outbox from public.marketplace_fulfillment_submission_outbox
  where id = p_outbox_id and status = 'leased' and lease_owner = p_worker_id for update;

  update public.marketplace_fulfillment_submission_attempts
  set outcome = p_outcome, response_code = left(coalesce(p_code,''),80),
      error_code = case when p_outcome in ('temporary_error','permanent_error','ambiguous_timeout')
        then left(coalesce(p_code,'FULFILLMENT_SIMULATION_FAILED'),120) else null end,
      completed_at = v_now
  where submission_outbox_id = v_outbox.id and attempt_number = v_outbox.attempts and outcome = 'started';

  if p_outcome in ('accepted','already_exists') then
    update public.marketplace_fulfillment_submission_outbox
    set status = 'simulated_submitted', simulated_remote_id = nullif(left(coalesce(p_remote_id,''),160),''),
        accepted_at = v_now, reconciled_at = v_now, lease_owner = null, lease_expires_at = null,
        last_error_code = null, updated_at = v_now
    where id = v_outbox.id returning * into v_outbox;
  elsif p_outcome = 'ambiguous_timeout' then
    update public.marketplace_fulfillment_submission_outbox
    set status = 'awaiting_reconciliation',
        simulated_remote_id = case when p_accepted_remotely then nullif(left(coalesce(p_remote_id,''),160),'') else null end,
        accepted_at = case when p_accepted_remotely then v_now else null end,
        lease_owner = null, lease_expires_at = null, last_error_code = left(p_code,120), updated_at = v_now
    where id = v_outbox.id returning * into v_outbox;
    return v_outbox;
  elsif p_outcome = 'temporary_error' and v_outbox.attempts < v_outbox.max_attempts then
    update public.marketplace_fulfillment_submission_outbox
    set status = 'retry', due_at = v_now + make_interval(secs => least(3600,30*power(2,greatest(0,attempts-1))::integer)),
        lease_owner = null, lease_expires_at = null, last_error_code = left(p_code,120), updated_at = v_now
    where id = v_outbox.id returning * into v_outbox;
    return v_outbox;
  elsif p_outcome = 'blocked' then
    update public.marketplace_fulfillment_submission_outbox
    set status = 'blocked', order_guard_status = case p_code
          when 'ORDER_CANCELLED' then 'cancelled'
          when 'ORDER_REFUNDED' then 'refunded'
          when 'ORDER_ALREADY_FULFILLED' then 'already_fulfilled'
          else order_guard_status end,
        lease_owner = null, lease_expires_at = null,
        last_error_code = left(p_code,120), updated_at = v_now
    where id = v_outbox.id returning * into v_outbox;
    for v_task in
      select task.* from public.fulfillment_tasks task
      join public.marketplace_fulfillment_shipment_items item on item.fulfillment_task_id = task.id
      where item.shipment_id = v_outbox.shipment_id and task.workflow_state = 'TRACKING_SUBMISSION_QUEUED'
      order by task.id for update of task
    loop
      perform public.apply_fulfillment_transition_v1a(
        v_task.id, 'TRACKING_SUBMISSION_QUEUED', 'MANUAL_REVIEW_REQUIRED', 'simulator', p_worker_id,
        v_outbox.id || ':' || v_task.id || ':blocked', jsonb_build_object('errorCode',left(p_code,120))
      );
    end loop;
    return v_outbox;
  else
    update public.marketplace_fulfillment_submission_outbox
    set status = 'dead_letter', dead_lettered_at = v_now, lease_owner = null,
        lease_expires_at = null, last_error_code = left(p_code,120), updated_at = v_now
    where id = v_outbox.id returning * into v_outbox;
    for v_task in
      select task.* from public.fulfillment_tasks task
      join public.marketplace_fulfillment_shipment_items item on item.fulfillment_task_id = task.id
      where item.shipment_id = v_outbox.shipment_id and task.workflow_state = 'TRACKING_SUBMISSION_QUEUED'
      order by task.id for update of task
    loop
      perform public.apply_fulfillment_transition_v1a(
        v_task.id, 'TRACKING_SUBMISSION_QUEUED', 'MANUAL_REVIEW_REQUIRED', 'simulator', p_worker_id,
        v_outbox.id || ':' || v_task.id || ':dead-letter', jsonb_build_object('errorCode',left(p_code,120))
      );
    end loop;
    return v_outbox;
  end if;

  for v_task in
    select task.* from public.fulfillment_tasks task
    join public.marketplace_fulfillment_shipment_items item on item.fulfillment_task_id = task.id
    where item.shipment_id = v_outbox.shipment_id and task.workflow_state = 'TRACKING_SUBMISSION_QUEUED'
    order by task.id for update of task
  loop
    perform public.apply_fulfillment_transition_v1a(
      v_task.id, 'TRACKING_SUBMISSION_QUEUED', 'TRACKING_SUBMITTED_SIMULATED', 'simulator', p_worker_id,
      v_outbox.id || ':' || v_task.id || ':submitted', jsonb_build_object('payloadHash',v_outbox.payload_hash)
    );
    perform public.apply_fulfillment_transition_v1a(
      v_task.id, 'TRACKING_SUBMITTED_SIMULATED', 'SHIPPED_SIMULATED', 'simulator', p_worker_id,
      v_outbox.id || ':' || v_task.id || ':shipped', jsonb_build_object('simulation',true)
    );
  end loop;
  return v_outbox;
end;
$$;

create or replace function public.reconcile_fulfillment_submissions_v1a(
  p_worker_id text,
  p_limit integer default 10
)
returns setof public.marketplace_fulfillment_submission_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_outbox public.marketplace_fulfillment_submission_outbox;
  v_task public.fulfillment_tasks;
  v_now timestamptz := clock_timestamp();
begin
  for v_outbox in
    select * from public.marketplace_fulfillment_submission_outbox
    where status = 'awaiting_reconciliation'
    order by updated_at for update skip locked
    limit greatest(1,least(coalesce(p_limit,10),50))
  loop
    if v_outbox.accepted_at is not null and v_outbox.simulated_remote_id is not null then
      update public.marketplace_fulfillment_submission_outbox
      set status = 'simulated_submitted', reconciled_at = v_now,
          last_error_code = null, updated_at = v_now
      where id = v_outbox.id returning * into v_outbox;
      update public.marketplace_fulfillment_submission_attempts
      set outcome = 'reconciled', response_code = 'SIMULATED_EXISTING_RECOGNIZED'
      where submission_outbox_id = v_outbox.id and attempt_number = v_outbox.attempts;
      for v_task in
        select task.* from public.fulfillment_tasks task
        join public.marketplace_fulfillment_shipment_items item on item.fulfillment_task_id = task.id
        where item.shipment_id = v_outbox.shipment_id and task.workflow_state = 'TRACKING_SUBMISSION_QUEUED'
        order by task.id for update of task
      loop
        perform public.apply_fulfillment_transition_v1a(
          v_task.id, 'TRACKING_SUBMISSION_QUEUED', 'TRACKING_SUBMITTED_SIMULATED', 'reconciler', p_worker_id,
          v_outbox.id || ':' || v_task.id || ':reconciled-submitted', jsonb_build_object('secondPost',false)
        );
        perform public.apply_fulfillment_transition_v1a(
          v_task.id, 'TRACKING_SUBMITTED_SIMULATED', 'SHIPPED_SIMULATED', 'reconciler', p_worker_id,
          v_outbox.id || ':' || v_task.id || ':reconciled-shipped', jsonb_build_object('simulation',true)
        );
      end loop;
    else
      update public.marketplace_fulfillment_submission_outbox
      set status = case when attempts >= max_attempts then 'dead_letter' else 'retry' end,
          due_at = v_now + interval '60 seconds', reconciled_at = v_now,
          dead_lettered_at = case when attempts >= max_attempts then v_now else dead_lettered_at end,
          last_error_code = 'SIMULATED_REMOTE_NOT_FOUND_AFTER_TIMEOUT', updated_at = v_now
      where id = v_outbox.id returning * into v_outbox;
    end if;
    return next v_outbox;
  end loop;
  return;
end;
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'fulfillment_task_events', 'supplier_purchase_orders',
    'supplier_purchase_order_items', 'marketplace_fulfillment_shipments',
    'marketplace_fulfillment_shipment_items',
    'marketplace_fulfillment_submission_outbox',
    'marketplace_fulfillment_submission_attempts'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from anon, authenticated', v_table);
  end loop;
end $$;

grant select, insert on table public.fulfillment_task_events to service_role;
grant select, insert, update on table public.supplier_purchase_orders to service_role;
grant select, insert on table public.supplier_purchase_order_items to service_role;
grant select, insert, update on table public.marketplace_fulfillment_shipments to service_role;
grant select, insert on table public.marketplace_fulfillment_shipment_items to service_role;
grant select, insert, update on table public.marketplace_fulfillment_submission_outbox to service_role;
grant select, insert, update on table public.marketplace_fulfillment_submission_attempts to service_role;

revoke all on function public.fulfillment_payload_safe_v1a(jsonb) from public, anon, authenticated;
revoke all on function public.fulfillment_transition_allowed_v1a(text,text) from public, anon, authenticated;
revoke all on function public.apply_fulfillment_transition_v1a(uuid,text,text,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.transition_fulfillment_task_v1a(uuid,text,text,bigint,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.confirm_fulfillment_purchase_v1a(uuid,bigint,text,numeric,numeric,numeric,numeric,text,timestamptz,text,text) from public, anon, authenticated;
revoke all on function public.save_fulfillment_tracking_v1a(uuid,bigint,jsonb,text,text,text) from public, anon, authenticated;
revoke all on function public.approve_fulfillment_tracking_v1a(uuid,bigint,text,text,text,text) from public, anon, authenticated;
revoke all on function public.claim_fulfillment_submissions_v1a(text,integer,integer) from public, anon, authenticated;
revoke all on function public.record_fulfillment_simulation_outcome_v1a(uuid,text,text,text,text,boolean) from public, anon, authenticated;
revoke all on function public.reconcile_fulfillment_submissions_v1a(text,integer) from public, anon, authenticated;

grant execute on function public.transition_fulfillment_task_v1a(uuid,text,text,bigint,text,text,text,jsonb) to service_role;
grant execute on function public.confirm_fulfillment_purchase_v1a(uuid,bigint,text,numeric,numeric,numeric,numeric,text,timestamptz,text,text) to service_role;
grant execute on function public.save_fulfillment_tracking_v1a(uuid,bigint,jsonb,text,text,text) to service_role;
grant execute on function public.approve_fulfillment_tracking_v1a(uuid,bigint,text,text,text,text) to service_role;
grant execute on function public.claim_fulfillment_submissions_v1a(text,integer,integer) to service_role;
grant execute on function public.record_fulfillment_simulation_outcome_v1a(uuid,text,text,text,text,boolean) to service_role;
grant execute on function public.reconcile_fulfillment_submissions_v1a(text,integer) to service_role;

notify pgrst, 'reload schema';
