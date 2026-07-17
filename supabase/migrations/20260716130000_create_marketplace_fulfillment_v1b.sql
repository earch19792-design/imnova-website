-- Marketplace Fulfillment V1B: gated real eBay tracking adapter preparation.
-- Data preserving: no table or row is removed. Existing constraints are widened
-- only to add the real adapter and reconciled workflow states.

alter table public.fulfillment_tasks
  add column if not exists tracking_submission_mode text null,
  add column if not exists tracking_approval_expires_at timestamptz null,
  add column if not exists ebay_fulfillment_id text null,
  add column if not exists ebay_fulfillment_reconciled_at timestamptz null;

alter table public.fulfillment_tasks
  drop constraint if exists fulfillment_tasks_workflow_state_v1a_check;
alter table public.fulfillment_tasks
  add constraint fulfillment_tasks_workflow_state_v1b_check check (
    workflow_state in (
      'SALE_DETECTED', 'VALIDATING_ORDER', 'PENDING_MANUAL_PURCHASE',
      'LUNA_ORDER_PLACED', 'WAITING_FOR_TRACKING', 'TRACKING_RECEIVED',
      'TRACKING_VALIDATING', 'TRACKING_READY_FOR_SUBMISSION',
      'TRACKING_SUBMISSION_QUEUED', 'TRACKING_SUBMITTED_SIMULATED',
      'SHIPPED_SIMULATED', 'TRACKING_SUBMITTED_TO_EBAY', 'SHIPPED',
      'MANUAL_REVIEW_REQUIRED', 'CANCELLED', 'RETURN_OR_ISSUE'
    )
  ) not valid;
alter table public.fulfillment_tasks
  validate constraint fulfillment_tasks_workflow_state_v1b_check;

alter table public.fulfillment_tasks
  add constraint fulfillment_tasks_submission_mode_v1b_check check (
    tracking_submission_mode is null or
    tracking_submission_mode in ('simulated', 'ebay_real')
  ) not valid;
alter table public.fulfillment_tasks
  validate constraint fulfillment_tasks_submission_mode_v1b_check;

alter table public.marketplace_fulfillment_submission_outbox
  add column if not exists approval_context_hash text null,
  add column if not exists approval_expires_at timestamptz null,
  add column if not exists preflight_completed_at timestamptz null,
  add column if not exists preflight_code text null,
  add column if not exists post_started_at timestamptz null,
  add column if not exists post_completed_at timestamptz null,
  add column if not exists post_count integer not null default 0,
  add column if not exists last_http_status integer null,
  add column if not exists remote_fulfillment_id text null,
  add column if not exists remote_location_path text null,
  add column if not exists ambiguous_at timestamptz null,
  add column if not exists absence_confirmed_at timestamptz null,
  add column if not exists reconciliation_count integer not null default 0,
  add column if not exists terminal_failure_at timestamptz null;

alter table public.marketplace_fulfillment_submission_outbox
  drop constraint if exists marketplace_fulfillment_submission_outbox_adapter_check;
alter table public.marketplace_fulfillment_submission_outbox
  add constraint marketplace_fulfillment_submission_outbox_adapter_v1b_check check (
    adapter in ('simulated', 'ebay_real')
  ) not valid;
alter table public.marketplace_fulfillment_submission_outbox
  validate constraint marketplace_fulfillment_submission_outbox_adapter_v1b_check;

alter table public.marketplace_fulfillment_submission_outbox
  drop constraint if exists marketplace_fulfillment_submission_outbox_status_check;
alter table public.marketplace_fulfillment_submission_outbox
  add constraint marketplace_fulfillment_submission_outbox_status_v1b_check check (
    status in (
      'pending', 'leased', 'retry', 'awaiting_reconciliation',
      'simulated_submitted', 'real_submitted', 'dead_letter',
      'cancelled', 'blocked'
    )
  ) not valid;
alter table public.marketplace_fulfillment_submission_outbox
  validate constraint marketplace_fulfillment_submission_outbox_status_v1b_check;

alter table public.marketplace_fulfillment_submission_outbox
  drop constraint if exists marketplace_fulfillment_submission_outbox_hash_unique;
alter table public.marketplace_fulfillment_submission_outbox
  add constraint marketplace_fulfillment_submission_outbox_adapter_hash_v1b_unique
  unique (marketplace_account_key, marketplace, marketplace_order_id, payload_hash, adapter);

alter table public.marketplace_fulfillment_submission_outbox
  add constraint marketplace_fulfillment_submission_outbox_v1b_audit_check check (
    post_count >= 0 and reconciliation_count >= 0 and
    (approval_context_hash is null or approval_context_hash ~ '^sha256:[0-9a-f]{64}$') and
    (last_http_status is null or last_http_status between 100 and 599) and
    (remote_location_path is null or remote_location_path ~ '^/sell/fulfillment/v1/order/')
  ) not valid;
alter table public.marketplace_fulfillment_submission_outbox
  validate constraint marketplace_fulfillment_submission_outbox_v1b_audit_check;

alter table public.marketplace_fulfillment_submission_attempts
  add column if not exists adapter text not null default 'simulated',
  add column if not exists operation text not null default 'simulate',
  add column if not exists http_status integer null,
  add column if not exists post_started boolean not null default false,
  add column if not exists remote_fulfillment_id text null,
  add column if not exists reconciliation_required boolean not null default false,
  add column if not exists raw_response_stored boolean not null default false;

alter table public.marketplace_fulfillment_submission_attempts
  drop constraint if exists marketplace_fulfillment_submission_attempts_outcome_check;
alter table public.marketplace_fulfillment_submission_attempts
  add constraint marketplace_fulfillment_submission_attempts_outcome_v1b_check check (
    outcome in (
      'started', 'accepted', 'accepted_pending_reconciliation',
      'already_exists', 'temporary_error', 'permanent_error',
      'ambiguous_timeout', 'reconciled', 'absence_confirmed', 'blocked'
    )
  ) not valid;
alter table public.marketplace_fulfillment_submission_attempts
  validate constraint marketplace_fulfillment_submission_attempts_outcome_v1b_check;

alter table public.marketplace_fulfillment_submission_attempts
  add constraint marketplace_fulfillment_submission_attempts_v1b_safe_check check (
    adapter in ('simulated','ebay_real') and
    operation in ('simulate','create_shipping_fulfillment','reconcile_shipping_fulfillment') and
    (http_status is null or http_status between 100 and 599) and
    raw_response_stored = false
  ) not valid;
alter table public.marketplace_fulfillment_submission_attempts
  validate constraint marketplace_fulfillment_submission_attempts_v1b_safe_check;

create table if not exists public.ebay_fulfillment_tracking_oauth_handoffs (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  public_key_pem text not null,
  encrypted_refresh_token text null,
  status text not null default 'pending',
  identity_match boolean null,
  fulfillment_scope_confirmed boolean null,
  error_code text null,
  expires_at timestamptz not null,
  claimed_at timestamptz null,
  ready_at timestamptz null,
  consumed_at timestamptz null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint ebay_fulfillment_tracking_oauth_state_hash_check check (
    state_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_fulfillment_tracking_oauth_public_key_check check (
    char_length(public_key_pem) between 700 and 1600 and
    public_key_pem like '-----BEGIN PUBLIC KEY-----%'
  ),
  constraint ebay_fulfillment_tracking_oauth_ciphertext_check check (
    encrypted_refresh_token is null or
    char_length(encrypted_refresh_token) between 100 and 12000
  ),
  constraint ebay_fulfillment_tracking_oauth_status_check check (
    status in ('pending','claimed','ready','consumed','failed','expired')
  ),
  constraint ebay_fulfillment_tracking_oauth_error_check check (
    error_code is null or error_code ~ '^[A-Z0-9_]{3,180}$'
  ),
  constraint ebay_fulfillment_tracking_oauth_expiry_check check (
    expires_at > created_at
  )
);

create index if not exists ebay_fulfillment_tracking_oauth_expiry_v1b_idx
  on public.ebay_fulfillment_tracking_oauth_handoffs(status, expires_at);
create index if not exists marketplace_fulfillment_real_claim_v1b_idx
  on public.marketplace_fulfillment_submission_outbox(status, due_at, attempts, created_at)
  where adapter = 'ebay_real' and status in ('pending','retry','leased','awaiting_reconciliation');
create index if not exists marketplace_fulfillment_remote_v1b_idx
  on public.marketplace_fulfillment_submission_outbox(
    marketplace_account_key, marketplace, marketplace_order_id, remote_fulfillment_id
  ) where adapter = 'ebay_real';

create or replace function public.fulfillment_transition_allowed_v1b(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select (p_from, p_to) in (
    values
      ('TRACKING_READY_FOR_SUBMISSION','TRACKING_SUBMISSION_QUEUED'),
      ('TRACKING_SUBMISSION_QUEUED','TRACKING_SUBMITTED_TO_EBAY'),
      ('TRACKING_SUBMITTED_TO_EBAY','SHIPPED'),
      ('TRACKING_SUBMISSION_QUEUED','MANUAL_REVIEW_REQUIRED'),
      ('TRACKING_SUBMITTED_TO_EBAY','MANUAL_REVIEW_REQUIRED'),
      ('SHIPPED','RETURN_OR_ISSUE'),
      ('SHIPPED','MANUAL_REVIEW_REQUIRED'),
      ('MANUAL_REVIEW_REQUIRED','TRACKING_READY_FOR_SUBMISSION'),
      ('RETURN_OR_ISSUE','MANUAL_REVIEW_REQUIRED')
  );
$$;

create or replace function public.apply_fulfillment_transition_v1b(
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
  if not public.fulfillment_transition_allowed_v1b(p_from_state,p_to_state) then
    raise exception 'FULFILLMENT_TRANSITION_NOT_ALLOWED';
  end if;
  if nullif(trim(p_idempotency_key),'') is null or
    not public.fulfillment_payload_safe_v1a(coalesce(p_evidence,'{}'::jsonb)) then
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
  perform set_config('seller_os.fulfillment_transition_engine','on',true);
  update public.fulfillment_tasks
  set workflow_state = p_to_state,
      status = case
        when p_to_state in ('TRACKING_SUBMISSION_QUEUED','TRACKING_SUBMITTED_TO_EBAY','SHIPPED')
          then 'TRACKING_READY'
        else 'PENDING_MANUAL_PURCHASE'
      end,
      status_history = status_history || jsonb_build_array(jsonb_build_object(
        'status',p_to_state,'at',v_now,'actor',left(coalesce(p_actor_type,'system'),80)
      )),
      lock_version = lock_version + 1,
      next_action_at = case when p_to_state in ('TRACKING_SUBMISSION_QUEUED','MANUAL_REVIEW_REQUIRED')
        then v_now else next_action_at end,
      last_error_code = case when p_to_state = 'MANUAL_REVIEW_REQUIRED'
        then left(coalesce(p_evidence->>'errorCode','FULFILLMENT_MANUAL_REVIEW_REQUIRED'),120)
        else null end,
      updated_at = v_now
  where id = p_task_id and workflow_state = p_from_state
  returning * into strict v_task;
  select coalesce(max(sequence_number),0)+1 into v_sequence
  from public.fulfillment_task_events where fulfillment_task_id = p_task_id;
  insert into public.fulfillment_task_events (
    fulfillment_task_id,sequence_number,event_type,from_state,to_state,
    actor_type,actor_id,idempotency_key,evidence,occurred_at
  ) values (
    p_task_id,v_sequence,p_to_state,p_from_state,p_to_state,
    left(coalesce(p_actor_type,'system'),80),nullif(left(coalesce(p_actor_id,''),160),''),
    left(p_idempotency_key,240),coalesce(p_evidence,'{}'::jsonb),v_now
  );
  return v_task;
end;
$$;

create or replace function public.approve_fulfillment_tracking_v1b(
  p_task_id uuid,
  p_expected_lock_version bigint,
  p_payload_hash text,
  p_approval_context_hash text,
  p_actor_id text,
  p_idempotency_key text
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
  v_now timestamptz := clock_timestamp();
begin
  if p_payload_hash !~ '^sha256:[0-9a-f]{64}$' or
    p_approval_context_hash !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'FULFILLMENT_APPROVAL_HASH_INVALID';
  end if;
  select * into strict v_primary from public.fulfillment_tasks where id = p_task_id for update;
  select * into v_outbox from public.marketplace_fulfillment_submission_outbox
  where marketplace_account_key = v_primary.marketplace_account_key
    and marketplace = v_primary.marketplace
    and marketplace_order_id = v_primary.marketplace_order_id
    and payload_hash = p_payload_hash and adapter = 'ebay_real';
  if found then return v_outbox; end if;
  if v_primary.lock_version <> p_expected_lock_version then
    raise exception 'FULFILLMENT_LOCK_VERSION_CONFLICT';
  end if;
  if v_primary.workflow_state <> 'TRACKING_READY_FOR_SUBMISSION' or
    v_primary.tracking_payload_hash <> p_payload_hash or
    v_primary.identity_verified_at is null or v_primary.identity_fingerprint is null then
    raise exception 'FULFILLMENT_APPROVAL_PAYLOAD_MISMATCH';
  end if;
  select * into strict v_shipment from public.marketplace_fulfillment_shipments
  where id = v_primary.current_shipment_id and payload_hash = p_payload_hash
    and approval_status = 'pending' and superseded_at is null;

  insert into public.marketplace_fulfillment_submission_outbox (
    fulfillment_task_id,shipment_id,marketplace_account_key,marketplace,
    marketplace_order_id,payload_hash,idempotency_key,adapter,
    simulation_scenario,order_guard_status,approval_context_hash,approval_expires_at
  ) values (
    v_primary.id,v_shipment.id,v_primary.marketplace_account_key,v_primary.marketplace,
    v_primary.marketplace_order_id,p_payload_hash,left(p_idempotency_key,240),'ebay_real',
    'success','clear',p_approval_context_hash,v_now + interval '30 minutes'
  ) returning * into v_outbox;

  update public.marketplace_fulfillment_shipments
  set approval_status = 'approved',approved_at = v_now,
      approved_by = nullif(left(coalesce(p_actor_id,''),160),''),updated_at = v_now
  where id = v_shipment.id;

  for v_task in
    select task.* from public.fulfillment_tasks task
    join public.marketplace_fulfillment_shipment_items item
      on item.fulfillment_task_id = task.id
    where item.shipment_id = v_shipment.id order by task.id for update of task
  loop
    if v_task.workflow_state <> 'TRACKING_READY_FOR_SUBMISSION' or
      v_task.tracking_payload_hash <> p_payload_hash or
      v_task.identity_verified_at is null or v_task.identity_fingerprint is null then
      raise exception 'FULFILLMENT_APPROVAL_ITEM_MISMATCH';
    end if;
    perform public.apply_fulfillment_transition_v1b(
      v_task.id,'TRACKING_READY_FOR_SUBMISSION','TRACKING_SUBMISSION_QUEUED',
      'admin',p_actor_id,p_idempotency_key || ':' || v_task.id || ':real-queued',
      jsonb_build_object('payloadHash',p_payload_hash,'submissionId',v_outbox.id,'adapter','ebay_real')
    );
    update public.fulfillment_tasks
    set tracking_approved_at = v_now,
        tracking_approval_expires_at = v_now + interval '30 minutes',
        tracking_submission_mode = 'ebay_real',updated_at = v_now
    where id = v_task.id;
  end loop;
  return v_outbox;
end;
$$;

create or replace function public.claim_fulfillment_real_submissions_v1b(
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
  set status = case
        when post_started_at is not null then 'awaiting_reconciliation'
        when attempts >= max_attempts then 'dead_letter'
        else 'retry' end,
      due_at = v_now,lease_owner = null,lease_expires_at = null,
      last_error_code = 'FULFILLMENT_SUBMISSION_LEASE_EXPIRED',updated_at = v_now,
      dead_lettered_at = case when post_started_at is null and attempts >= max_attempts
        then v_now else dead_lettered_at end
  where adapter = 'ebay_real' and status = 'leased' and lease_expires_at < v_now;

  return query
  with picked as (
    select id from public.marketplace_fulfillment_submission_outbox
    where adapter = 'ebay_real' and status in ('pending','retry')
      and due_at <= v_now and attempts < max_attempts and order_guard_status = 'clear'
      and (post_started_at is null or absence_confirmed_at >= post_started_at)
    order by due_at,created_at for update skip locked
    limit greatest(1,least(coalesce(p_limit,5),25))
  ), claimed as (
    update public.marketplace_fulfillment_submission_outbox outbox
    set status = 'leased',attempts = attempts + 1,lease_owner = left(p_worker_id,160),
        lease_expires_at = v_now + make_interval(secs => greatest(30,least(coalesce(p_lease_seconds,120),600))),
        updated_at = v_now
    where outbox.id in (select id from picked) returning outbox.*
  ), attempts as (
    insert into public.marketplace_fulfillment_submission_attempts (
      submission_outbox_id,attempt_number,worker_id,request_payload_hash,
      adapter,operation
    ) select id,attempts,left(p_worker_id,160),payload_hash,'ebay_real',
      'create_shipping_fulfillment' from claimed
    on conflict (submission_outbox_id,attempt_number) do nothing
    returning submission_outbox_id
  )
  select claimed.* from claimed join attempts
    on attempts.submission_outbox_id = claimed.id;
end;
$$;

create or replace function public.record_fulfillment_real_outcome_v1b(
  p_outbox_id uuid,
  p_worker_id text,
  p_outcome text,
  p_code text,
  p_http_status integer,
  p_remote_fulfillment_id text,
  p_remote_location_path text,
  p_post_started boolean
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
  where id = p_outbox_id and adapter = 'ebay_real' and status = 'leased'
    and lease_owner = p_worker_id for update;

  update public.marketplace_fulfillment_submission_attempts
  set outcome = case p_outcome
        when 'reconciled_success' then 'accepted'
        when 'existing_match' then 'already_exists'
        when 'accepted_pending_reconciliation' then 'accepted_pending_reconciliation'
        when 'ambiguous' then 'ambiguous_timeout'
        when 'temporary_before_post' then 'temporary_error'
        when 'permanent' then 'permanent_error'
        else 'blocked' end,
      response_code = left(coalesce(p_code,''),80),
      error_code = case when p_outcome in ('reconciled_success','existing_match') then null
        else left(coalesce(p_code,'FULFILLMENT_REAL_SUBMISSION_FAILED'),120) end,
      http_status = p_http_status,post_started = p_post_started,
      remote_fulfillment_id = nullif(left(coalesce(p_remote_fulfillment_id,''),160),''),
      reconciliation_required = p_outcome in ('accepted_pending_reconciliation','ambiguous'),
      raw_response_stored = false,completed_at = v_now
  where submission_outbox_id = v_outbox.id and attempt_number = v_outbox.attempts;

  if p_outcome in ('reconciled_success','existing_match') then
    update public.marketplace_fulfillment_submission_outbox
    set status = 'real_submitted',preflight_completed_at = coalesce(preflight_completed_at,v_now),
        preflight_code = case when p_outcome = 'existing_match' then 'EXISTING_FULFILLMENT_MATCH' else 'READY' end,
        post_started_at = case when p_post_started then coalesce(post_started_at,v_now) else post_started_at end,
        post_completed_at = case when p_post_started then v_now else post_completed_at end,
        post_count = post_count + case when p_post_started then 1 else 0 end,
        last_http_status = p_http_status,
        remote_fulfillment_id = nullif(left(coalesce(p_remote_fulfillment_id,''),160),''),
        remote_location_path = nullif(left(coalesce(p_remote_location_path,''),500),''),
        accepted_at = coalesce(accepted_at,v_now),reconciled_at = v_now,
        lease_owner = null,lease_expires_at = null,last_error_code = null,updated_at = v_now
    where id = v_outbox.id returning * into v_outbox;
  elsif p_outcome in ('accepted_pending_reconciliation','ambiguous') then
    update public.marketplace_fulfillment_submission_outbox
    set status = 'awaiting_reconciliation',preflight_completed_at = coalesce(preflight_completed_at,v_now),
        preflight_code = 'READY',post_started_at = coalesce(post_started_at,v_now),
        post_completed_at = case when p_http_status is not null then v_now else post_completed_at end,
        post_count = post_count + 1,last_http_status = p_http_status,
        remote_fulfillment_id = coalesce(nullif(left(coalesce(p_remote_fulfillment_id,''),160),''),remote_fulfillment_id),
        remote_location_path = coalesce(nullif(left(coalesce(p_remote_location_path,''),500),''),remote_location_path),
        accepted_at = case when p_outcome = 'accepted_pending_reconciliation' then v_now else accepted_at end,
        ambiguous_at = v_now,lease_owner = null,lease_expires_at = null,
        due_at = v_now,last_error_code = left(p_code,120),updated_at = v_now
    where id = v_outbox.id returning * into v_outbox;
    return v_outbox;
  elsif p_outcome = 'temporary_before_post' and v_outbox.attempts < v_outbox.max_attempts then
    update public.marketplace_fulfillment_submission_outbox
    set status = 'retry',due_at = v_now + make_interval(secs => least(3600,30*power(2,greatest(0,attempts-1))::integer)),
        lease_owner = null,lease_expires_at = null,last_error_code = left(p_code,120),updated_at = v_now
    where id = v_outbox.id returning * into v_outbox;
    return v_outbox;
  else
    update public.marketplace_fulfillment_submission_outbox
    set status = case when p_outcome = 'blocked' then 'blocked' else 'dead_letter' end,
        dead_lettered_at = case when p_outcome = 'blocked' then dead_lettered_at else v_now end,
        terminal_failure_at = v_now,lease_owner = null,lease_expires_at = null,
        last_http_status = p_http_status,last_error_code = left(p_code,120),updated_at = v_now
    where id = v_outbox.id returning * into v_outbox;
    for v_task in
      select task.* from public.fulfillment_tasks task
      join public.marketplace_fulfillment_shipment_items item
        on item.fulfillment_task_id = task.id
      where item.shipment_id = v_outbox.shipment_id
        and task.workflow_state = 'TRACKING_SUBMISSION_QUEUED'
      order by task.id for update of task
    loop
      perform public.apply_fulfillment_transition_v1b(
        v_task.id,'TRACKING_SUBMISSION_QUEUED','MANUAL_REVIEW_REQUIRED',
        'ebay_real_adapter',p_worker_id,v_outbox.id || ':' || v_task.id || ':real-blocked',
        jsonb_build_object('errorCode',left(p_code,120))
      );
    end loop;
    return v_outbox;
  end if;

  for v_task in
    select task.* from public.fulfillment_tasks task
    join public.marketplace_fulfillment_shipment_items item
      on item.fulfillment_task_id = task.id
    where item.shipment_id = v_outbox.shipment_id
      and task.workflow_state = 'TRACKING_SUBMISSION_QUEUED'
    order by task.id for update of task
  loop
    perform public.apply_fulfillment_transition_v1b(
      v_task.id,'TRACKING_SUBMISSION_QUEUED','TRACKING_SUBMITTED_TO_EBAY',
      'ebay_real_adapter',p_worker_id,v_outbox.id || ':' || v_task.id || ':real-submitted',
      jsonb_build_object('payloadHash',v_outbox.payload_hash,'reconciled',true)
    );
    perform public.apply_fulfillment_transition_v1b(
      v_task.id,'TRACKING_SUBMITTED_TO_EBAY','SHIPPED',
      'ebay_reconciler',p_worker_id,v_outbox.id || ':' || v_task.id || ':real-shipped',
      jsonb_build_object('secondPost',false)
    );
    update public.fulfillment_tasks
    set ebay_fulfillment_id = v_outbox.remote_fulfillment_id,
        ebay_fulfillment_reconciled_at = v_now,updated_at = v_now
    where id = v_task.id;
  end loop;
  return v_outbox;
end;
$$;

create or replace function public.claim_fulfillment_real_reconciliation_v1b(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 120
)
returns setof public.marketplace_fulfillment_submission_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_now timestamptz := clock_timestamp();
begin
  return query
  with picked as (
    select id from public.marketplace_fulfillment_submission_outbox
    where adapter = 'ebay_real' and status = 'awaiting_reconciliation'
      and due_at <= v_now and (lease_expires_at is null or lease_expires_at < v_now)
    order by due_at,updated_at for update skip locked
    limit greatest(1,least(coalesce(p_limit,10),50))
  ), claimed as (
    update public.marketplace_fulfillment_submission_outbox outbox
    set lease_owner = left(p_worker_id,160),
        lease_expires_at = v_now + make_interval(secs => greatest(30,least(coalesce(p_lease_seconds,120),600))),
        reconciliation_count = reconciliation_count + 1,updated_at = v_now
    where outbox.id in (select id from picked) returning outbox.*
  ) select * from claimed;
end;
$$;

create or replace function public.record_fulfillment_real_reconciliation_v1b(
  p_outbox_id uuid,
  p_worker_id text,
  p_outcome text,
  p_code text,
  p_remote_fulfillment_id text
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
  where id = p_outbox_id and adapter = 'ebay_real' and status = 'awaiting_reconciliation'
    and lease_owner = p_worker_id for update;
  if p_outcome = 'existing_match' then
    update public.marketplace_fulfillment_submission_outbox
    set status = 'real_submitted',remote_fulfillment_id = nullif(left(p_remote_fulfillment_id,160),''),
        accepted_at = coalesce(accepted_at,v_now),reconciled_at = v_now,
        lease_owner = null,lease_expires_at = null,last_error_code = null,updated_at = v_now
    where id = v_outbox.id returning * into v_outbox;
    update public.marketplace_fulfillment_submission_attempts
    set outcome = 'reconciled',response_code = 'EBAY_EXISTING_FULFILLMENT_RECOGNIZED',
        remote_fulfillment_id = v_outbox.remote_fulfillment_id,reconciliation_required = false,
        raw_response_stored = false,completed_at = v_now
    where submission_outbox_id = v_outbox.id and attempt_number = v_outbox.attempts;
  elsif p_outcome = 'absent' then
    update public.marketplace_fulfillment_submission_outbox
    set status = case when attempts >= max_attempts then 'dead_letter' else 'retry' end,
        absence_confirmed_at = v_now,reconciled_at = v_now,
        due_at = v_now + make_interval(secs => least(3600,60*power(2,greatest(0,attempts-1))::integer)),
        dead_lettered_at = case when attempts >= max_attempts then v_now else dead_lettered_at end,
        terminal_failure_at = case when attempts >= max_attempts then v_now else terminal_failure_at end,
        lease_owner = null,lease_expires_at = null,last_error_code = left(p_code,120),updated_at = v_now
    where id = v_outbox.id returning * into v_outbox;
    update public.marketplace_fulfillment_submission_attempts
    set outcome = 'absence_confirmed',response_code = left(p_code,80),
        reconciliation_required = false,raw_response_stored = false,completed_at = v_now
    where submission_outbox_id = v_outbox.id and attempt_number = v_outbox.attempts;
    return v_outbox;
  elsif p_outcome = 'temporary' then
    update public.marketplace_fulfillment_submission_outbox
    set due_at = v_now + interval '60 seconds',lease_owner = null,lease_expires_at = null,
        last_error_code = left(p_code,120),updated_at = v_now
    where id = v_outbox.id returning * into v_outbox;
    return v_outbox;
  else
    update public.marketplace_fulfillment_submission_outbox
    set status = 'blocked',terminal_failure_at = v_now,lease_owner = null,lease_expires_at = null,
        last_error_code = left(p_code,120),updated_at = v_now
    where id = v_outbox.id returning * into v_outbox;
    for v_task in
      select task.* from public.fulfillment_tasks task
      join public.marketplace_fulfillment_shipment_items item
        on item.fulfillment_task_id = task.id
      where item.shipment_id = v_outbox.shipment_id
        and task.workflow_state = 'TRACKING_SUBMISSION_QUEUED'
      order by task.id for update of task
    loop
      perform public.apply_fulfillment_transition_v1b(
        v_task.id,'TRACKING_SUBMISSION_QUEUED','MANUAL_REVIEW_REQUIRED',
        'ebay_reconciler',p_worker_id,v_outbox.id || ':' || v_task.id || ':reconcile-blocked',
        jsonb_build_object('errorCode',left(p_code,120))
      );
    end loop;
    return v_outbox;
  end if;

  for v_task in
    select task.* from public.fulfillment_tasks task
    join public.marketplace_fulfillment_shipment_items item
      on item.fulfillment_task_id = task.id
    where item.shipment_id = v_outbox.shipment_id
      and task.workflow_state = 'TRACKING_SUBMISSION_QUEUED'
    order by task.id for update of task
  loop
    perform public.apply_fulfillment_transition_v1b(
      v_task.id,'TRACKING_SUBMISSION_QUEUED','TRACKING_SUBMITTED_TO_EBAY',
      'ebay_reconciler',p_worker_id,v_outbox.id || ':' || v_task.id || ':reconciled-submitted',
      jsonb_build_object('payloadHash',v_outbox.payload_hash,'secondPost',false)
    );
    perform public.apply_fulfillment_transition_v1b(
      v_task.id,'TRACKING_SUBMITTED_TO_EBAY','SHIPPED',
      'ebay_reconciler',p_worker_id,v_outbox.id || ':' || v_task.id || ':reconciled-shipped',
      jsonb_build_object('secondPost',false)
    );
    update public.fulfillment_tasks
    set ebay_fulfillment_id = v_outbox.remote_fulfillment_id,
        ebay_fulfillment_reconciled_at = v_now,updated_at = v_now
    where id = v_task.id;
  end loop;
  return v_outbox;
end;
$$;

alter table public.ebay_fulfillment_tracking_oauth_handoffs enable row level security;
alter table public.ebay_fulfillment_tracking_oauth_handoffs force row level security;
revoke all on table public.ebay_fulfillment_tracking_oauth_handoffs from public;
revoke all on table public.ebay_fulfillment_tracking_oauth_handoffs from anon, authenticated;
grant select,insert,update,delete on table public.ebay_fulfillment_tracking_oauth_handoffs to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'ebay_fulfillment_tracking_oauth_handoffs'
      and policyname = 'ebay_fulfillment_tracking_oauth_service_role_v1b'
  ) then
    create policy ebay_fulfillment_tracking_oauth_service_role_v1b
      on public.ebay_fulfillment_tracking_oauth_handoffs for all to service_role
      using (true) with check (true);
  end if;
end $$;

revoke all on function public.fulfillment_transition_allowed_v1b(text,text) from public,anon,authenticated;
revoke all on function public.apply_fulfillment_transition_v1b(uuid,text,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.approve_fulfillment_tracking_v1b(uuid,bigint,text,text,text,text) from public,anon,authenticated;
revoke all on function public.claim_fulfillment_real_submissions_v1b(text,integer,integer) from public,anon,authenticated;
revoke all on function public.record_fulfillment_real_outcome_v1b(uuid,text,text,text,integer,text,text,boolean) from public,anon,authenticated;
revoke all on function public.claim_fulfillment_real_reconciliation_v1b(text,integer,integer) from public,anon,authenticated;
revoke all on function public.record_fulfillment_real_reconciliation_v1b(uuid,text,text,text,text) from public,anon,authenticated;

grant execute on function public.approve_fulfillment_tracking_v1b(uuid,bigint,text,text,text,text) to service_role;
grant execute on function public.claim_fulfillment_real_submissions_v1b(text,integer,integer) to service_role;
grant execute on function public.record_fulfillment_real_outcome_v1b(uuid,text,text,text,integer,text,text,boolean) to service_role;
grant execute on function public.claim_fulfillment_real_reconciliation_v1b(text,integer,integer) to service_role;
grant execute on function public.record_fulfillment_real_reconciliation_v1b(uuid,text,text,text,text) to service_role;

notify pgrst, 'reload schema';
