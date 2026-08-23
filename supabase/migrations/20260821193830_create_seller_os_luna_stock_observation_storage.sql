-- P2-I02A artifact only. Do not apply until the global migration ledger and
-- schema-drift data gate are reconciled. This creates no scheduler or polling.

create table public.seller_os_luna_stock_check_jobs (
  stock_check_job_id text primary key,
  linkage_id text not null,
  account_key text not null,
  ebay_item_id text not null,
  observation_window_start timestamptz not null,
  observation_window_end timestamptz not null,
  contract_version text not null
    default 'SELLER_OS_LUNA_STOCK_OBSERVATION_V1',
  workflow_state text not null default 'NOT_STARTED',
  attempt_count integer not null default 0,
  due_at timestamptz not null,
  lease_owner text null,
  lease_expires_at timestamptz null,
  success_receipt_digest text null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint seller_os_luna_stock_check_jobs_id_check check (
    stock_check_job_id ~ '^luna-stock-check-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_luna_stock_check_jobs_linkage_check check (
    linkage_id ~ '^luna-linkage-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_luna_stock_check_jobs_account_check check (
    account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
  ),
  constraint seller_os_luna_stock_check_jobs_item_check check (
    ebay_item_id ~ '^[0-9]{9,19}$'
  ),
  constraint seller_os_luna_stock_check_jobs_window_check check (
    observation_window_end > observation_window_start
  ),
  constraint seller_os_luna_stock_check_jobs_contract_check check (
    contract_version = 'SELLER_OS_LUNA_STOCK_OBSERVATION_V1'
  ),
  constraint seller_os_luna_stock_check_jobs_workflow_check check (
    workflow_state in (
      'NOT_STARTED', 'IN_PROGRESS', 'SUCCEEDED', 'RETRYABLE_FAILURE',
      'TERMINAL_FAILURE', 'BLOCKED', 'SKIPPED', 'NOT_APPLICABLE'
    )
  ),
  constraint seller_os_luna_stock_check_jobs_attempt_check check (
    attempt_count between 0 and 5
  ),
  constraint seller_os_luna_stock_check_jobs_lease_check check (
    (
      workflow_state = 'IN_PROGRESS'
      and lease_owner is not null
      and length(lease_owner) between 8 and 160
      and lease_owner !~ '[[:cntrl:]]'
      and lease_expires_at is not null
    ) or (
      workflow_state <> 'IN_PROGRESS'
      and lease_owner is null
      and lease_expires_at is null
    )
  ),
  constraint seller_os_luna_stock_check_jobs_receipt_check check (
    (
      workflow_state = 'SUCCEEDED'
      and success_receipt_digest ~
        '^luna-stock-package-v1:sha256:[0-9a-f]{64}$'
    ) or (
      workflow_state <> 'SUCCEEDED'
      and success_receipt_digest is null
    )
  ),
  constraint seller_os_luna_stock_check_jobs_timestamps_check check (
    updated_at >= created_at
  ),
  constraint seller_os_luna_stock_check_jobs_logical_grain_unique unique (
    linkage_id, observation_window_start, contract_version
  ),
  constraint seller_os_luna_stock_check_jobs_identity_unique unique (
    stock_check_job_id, linkage_id, account_key, ebay_item_id
  )
);

create index seller_os_luna_stock_check_jobs_due_idx
  on public.seller_os_luna_stock_check_jobs (
    workflow_state, due_at, lease_expires_at
  );

create table public.seller_os_luna_stock_observations (
  observation_id text primary key,
  stock_check_job_id text not null,
  linkage_id text not null,
  account_key text not null,
  ebay_item_id text not null,
  component_identity_id text not null,
  luna_product_id text not null,
  luna_variant_id text null,
  luna_sku text not null,
  supplier_quantity_required integer not null,
  contract_version text not null
    default 'SELLER_OS_LUNA_STOCK_OBSERVATION_V1',
  observation_state text not null,
  source_status text not null,
  observed_availability boolean null,
  observed_supplier_quantity integer null,
  evidence_class text not null,
  evidence_digest text not null,
  acquisition_method text not null,
  attempt_number integer not null,
  observed_at timestamptz not null,
  maximum_age_seconds integer not null,
  limitations text[] not null default '{}'::text[],
  created_at timestamptz not null default clock_timestamp(),
  constraint seller_os_luna_stock_observations_id_check check (
    observation_id ~ '^luna-stock-observation-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_luna_stock_observations_component_check check (
    component_identity_id ~
      '^luna-component-identity-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_luna_stock_observations_product_check check (
    length(luna_product_id) between 1 and 100
    and luna_product_id !~ '[[:cntrl:]]'
    and (luna_variant_id is null or (
      length(luna_variant_id) between 1 and 100
      and luna_variant_id !~ '[[:cntrl:]]'
    ))
    and length(luna_sku) between 1 and 120
    and luna_sku !~ '[[:cntrl:]]'
  ),
  constraint seller_os_luna_stock_observations_multiplier_check check (
    supplier_quantity_required between 1 and 1000000
  ),
  constraint seller_os_luna_stock_observations_contract_check check (
    contract_version = 'SELLER_OS_LUNA_STOCK_OBSERVATION_V1'
  ),
  constraint seller_os_luna_stock_observations_state_check check (
    observation_state in (
      'OBSERVED_IN_STOCK', 'OBSERVED_OUT_OF_STOCK', 'OBSERVED_QUANTITY',
      'SOURCE_UNAVAILABLE', 'OBSERVATION_FAILED', 'UNKNOWN'
    )
  ),
  constraint seller_os_luna_stock_observations_source_check check (
    source_status in ('AVAILABLE', 'AUTH_REQUIRED', 'UNAVAILABLE', 'FAILED')
  ),
  constraint seller_os_luna_stock_observations_quantity_check check (
    observed_supplier_quantity is null
    or observed_supplier_quantity between 0 and 1000000000
  ),
  constraint seller_os_luna_stock_observations_evidence_check check (
    evidence_class in ('SUPPLIER_STATED', 'UNAVAILABLE')
    and evidence_digest ~ '^luna-stock-evidence-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_luna_stock_observations_acquisition_check check (
    acquisition_method in (
      'CANONICAL_SERVER_READ', 'CANONICAL_BROWSER_AUTOMATION'
    )
  ),
  constraint seller_os_luna_stock_observations_attempt_check check (
    attempt_number between 1 and 5
  ),
  constraint seller_os_luna_stock_observations_freshness_check check (
    maximum_age_seconds between 60 and 604800
  ),
  constraint seller_os_luna_stock_observations_limitations_check check (
    cardinality(limitations) <= 40
    and array_position(limitations, null) is null
  ),
  constraint seller_os_luna_stock_observations_failure_semantics_check check (
    (
      source_status = 'AVAILABLE'
      and evidence_class = 'SUPPLIER_STATED'
      and observation_state in (
        'OBSERVED_IN_STOCK', 'OBSERVED_OUT_OF_STOCK',
        'OBSERVED_QUANTITY', 'UNKNOWN'
      )
    ) or (
      source_status <> 'AVAILABLE'
      and evidence_class = 'UNAVAILABLE'
      and observed_availability is null
      and observed_supplier_quantity is null
      and observation_state in (
        'SOURCE_UNAVAILABLE', 'OBSERVATION_FAILED', 'UNKNOWN'
      )
    )
  ),
  constraint seller_os_luna_stock_observations_value_semantics_check check (
    (observation_state <> 'UNKNOWN' or (
      observed_availability is null and observed_supplier_quantity is null
    ))
    and (observation_state <> 'OBSERVED_IN_STOCK'
      or observed_availability is true)
    and (observation_state <> 'OBSERVED_OUT_OF_STOCK'
      or observed_availability is false)
    and (observation_state <> 'OBSERVED_QUANTITY'
      or observed_supplier_quantity is not null)
  ),
  constraint seller_os_luna_stock_observations_logical_grain_unique unique (
    stock_check_job_id, component_identity_id, attempt_number
  ),
  constraint seller_os_luna_stock_observations_job_identity_fk foreign key (
    stock_check_job_id, linkage_id, account_key, ebay_item_id
  ) references public.seller_os_luna_stock_check_jobs (
    stock_check_job_id, linkage_id, account_key, ebay_item_id
  ) on delete restrict
);

create index seller_os_luna_stock_observations_latest_idx
  on public.seller_os_luna_stock_observations (
    linkage_id, component_identity_id, observed_at desc
  );

create or replace function public.prevent_seller_os_luna_stock_observation_mutation_v1()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception 'SELLER_OS_LUNA_STOCK_OBSERVATION_IMMUTABLE';
end;
$$;

create trigger seller_os_luna_stock_observations_immutable
before update or delete on public.seller_os_luna_stock_observations
for each row execute function
  public.prevent_seller_os_luna_stock_observation_mutation_v1();

alter table public.seller_os_luna_stock_check_jobs enable row level security;
alter table public.seller_os_luna_stock_check_jobs force row level security;
alter table public.seller_os_luna_stock_observations enable row level security;
alter table public.seller_os_luna_stock_observations force row level security;

revoke all on table public.seller_os_luna_stock_check_jobs
  from public, anon, authenticated, service_role;
revoke all on table public.seller_os_luna_stock_observations
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.seller_os_luna_stock_check_jobs
  to service_role;
grant select, insert on table public.seller_os_luna_stock_observations
  to service_role;

create policy seller_os_luna_stock_check_jobs_service_role
  on public.seller_os_luna_stock_check_jobs
  for all to service_role using (true) with check (true);
create policy seller_os_luna_stock_observations_service_role
  on public.seller_os_luna_stock_observations
  for all to service_role using (true) with check (true);

create or replace function public.ensure_seller_os_luna_stock_check_job_v1(
  p_stock_check_job_id text,
  p_linkage_id text,
  p_account_key text,
  p_ebay_item_id text,
  p_observation_window_start timestamptz,
  p_observation_window_end timestamptz,
  p_due_at timestamptz,
  p_contract_version text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.seller_os_luna_stock_check_jobs%rowtype;
begin
  if auth.role() <> 'service_role'
    or p_stock_check_job_id !~
      '^luna-stock-check-v1:sha256:[0-9a-f]{64}$'
    or p_linkage_id !~ '^luna-linkage-v1:sha256:[0-9a-f]{64}$'
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_ebay_item_id !~ '^[0-9]{9,19}$'
    or p_observation_window_start is null
    or p_observation_window_end <= p_observation_window_start
    or p_due_at is null
    or p_contract_version <> 'SELLER_OS_LUNA_STOCK_OBSERVATION_V1' then
    raise exception 'SELLER_OS_LUNA_STOCK_CHECK_JOB_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_linkage_id || ':' || p_observation_window_start::text || ':' ||
      p_contract_version,
    0
  ));
  select * into v_job
  from public.seller_os_luna_stock_check_jobs job
  where job.linkage_id = p_linkage_id
    and job.observation_window_start = p_observation_window_start
    and job.contract_version = p_contract_version
  for update;
  if found then
    if v_job.stock_check_job_id is distinct from p_stock_check_job_id
      or v_job.account_key is distinct from p_account_key
      or v_job.ebay_item_id is distinct from p_ebay_item_id
      or v_job.observation_window_end is distinct from p_observation_window_end then
      raise exception 'SELLER_OS_LUNA_STOCK_CHECK_JOB_IDENTITY_CONFLICT';
    end if;
    return v_job.stock_check_job_id;
  end if;
  insert into public.seller_os_luna_stock_check_jobs (
    stock_check_job_id, linkage_id, account_key, ebay_item_id,
    observation_window_start, observation_window_end, contract_version,
    workflow_state, attempt_count, due_at
  ) values (
    p_stock_check_job_id, p_linkage_id, p_account_key, p_ebay_item_id,
    p_observation_window_start, p_observation_window_end, p_contract_version,
    'NOT_STARTED', 0, p_due_at
  );
  return p_stock_check_job_id;
end;
$$;

create or replace function public.ensure_seller_os_luna_stock_observation_v1(
  p_observation_id text,
  p_stock_check_job_id text,
  p_linkage_id text,
  p_account_key text,
  p_ebay_item_id text,
  p_component_identity_id text,
  p_luna_product_id text,
  p_luna_variant_id text,
  p_luna_sku text,
  p_supplier_quantity_required integer,
  p_observation_state text,
  p_source_status text,
  p_observed_availability boolean,
  p_observed_supplier_quantity integer,
  p_evidence_class text,
  p_evidence_digest text,
  p_acquisition_method text,
  p_attempt_number integer,
  p_observed_at timestamptz,
  p_maximum_age_seconds integer,
  p_limitations text[],
  p_lease_owner text,
  p_now timestamptz default clock_timestamp()
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.seller_os_luna_stock_check_jobs%rowtype;
  v_observation public.seller_os_luna_stock_observations%rowtype;
begin
  if auth.role() <> 'service_role'
    or p_observation_id !~
      '^luna-stock-observation-v1:sha256:[0-9a-f]{64}$'
    or p_stock_check_job_id !~
      '^luna-stock-check-v1:sha256:[0-9a-f]{64}$'
    or p_component_identity_id !~
      '^luna-component-identity-v1:sha256:[0-9a-f]{64}$'
    or length(trim(coalesce(p_lease_owner, ''))) not between 8 and 160
    or p_now is null then
    raise exception 'SELLER_OS_LUNA_STOCK_OBSERVATION_INPUT_INVALID';
  end if;
  select * into v_job
  from public.seller_os_luna_stock_check_jobs job
  where job.stock_check_job_id = p_stock_check_job_id
  for update;
  if not found then
    raise exception 'SELLER_OS_LUNA_STOCK_CHECK_JOB_NOT_FOUND';
  end if;
  if v_job.workflow_state <> 'IN_PROGRESS'
    or v_job.lease_owner is distinct from trim(p_lease_owner)
    or v_job.lease_expires_at <= p_now
    or v_job.attempt_count <> p_attempt_number
    or v_job.linkage_id is distinct from p_linkage_id
    or v_job.account_key is distinct from p_account_key
    or v_job.ebay_item_id is distinct from p_ebay_item_id then
    raise exception 'SELLER_OS_LUNA_STOCK_OBSERVATION_LEASE_OR_IDENTITY_INVALID';
  end if;
  select * into v_observation
  from public.seller_os_luna_stock_observations observation
  where observation.stock_check_job_id = p_stock_check_job_id
    and observation.component_identity_id = p_component_identity_id
    and observation.attempt_number = p_attempt_number;
  if found then
    if v_observation.observation_id is distinct from p_observation_id
      or v_observation.linkage_id is distinct from p_linkage_id
      or v_observation.account_key is distinct from p_account_key
      or v_observation.ebay_item_id is distinct from p_ebay_item_id
      or v_observation.luna_product_id is distinct from p_luna_product_id
      or v_observation.luna_variant_id is distinct from p_luna_variant_id
      or v_observation.luna_sku is distinct from p_luna_sku
      or v_observation.supplier_quantity_required is distinct from
        p_supplier_quantity_required
      or v_observation.evidence_digest is distinct from p_evidence_digest
      or v_observation.evidence_class is distinct from p_evidence_class
      or v_observation.observation_state is distinct from p_observation_state
      or v_observation.source_status is distinct from p_source_status
      or v_observation.observed_availability is distinct from
        p_observed_availability
      or v_observation.observed_supplier_quantity is distinct from
        p_observed_supplier_quantity
      or v_observation.acquisition_method is distinct from p_acquisition_method
      or v_observation.observed_at is distinct from p_observed_at
      or v_observation.maximum_age_seconds is distinct from
        p_maximum_age_seconds
      or v_observation.limitations is distinct from
        coalesce(p_limitations, '{}'::text[]) then
      raise exception 'SELLER_OS_LUNA_STOCK_OBSERVATION_IDENTITY_CONFLICT';
    end if;
    return v_observation.observation_id;
  end if;
  insert into public.seller_os_luna_stock_observations (
    observation_id, stock_check_job_id, linkage_id, account_key, ebay_item_id,
    component_identity_id, luna_product_id, luna_variant_id, luna_sku,
    supplier_quantity_required, observation_state, source_status,
    observed_availability, observed_supplier_quantity, evidence_class,
    evidence_digest, acquisition_method, attempt_number, observed_at,
    maximum_age_seconds, limitations
  ) values (
    p_observation_id, p_stock_check_job_id, p_linkage_id, p_account_key,
    p_ebay_item_id, p_component_identity_id, p_luna_product_id,
    p_luna_variant_id, p_luna_sku, p_supplier_quantity_required,
    p_observation_state, p_source_status, p_observed_availability,
    p_observed_supplier_quantity, p_evidence_class, p_evidence_digest,
    p_acquisition_method, p_attempt_number, p_observed_at,
    p_maximum_age_seconds, coalesce(p_limitations, '{}'::text[])
  );
  return p_observation_id;
end;
$$;

create or replace function public.claim_seller_os_luna_stock_check_job_v1(
  p_stock_check_job_id text,
  p_worker_id text,
  p_now timestamptz default clock_timestamp(),
  p_lease_seconds integer default 180
)
returns table(
  claimed boolean,
  reason text,
  attempt_number integer,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.seller_os_luna_stock_check_jobs%rowtype;
begin
  if auth.role() <> 'service_role'
    or coalesce(p_stock_check_job_id, '') !~
      '^luna-stock-check-v1:sha256:[0-9a-f]{64}$'
    or length(trim(coalesce(p_worker_id, ''))) not between 8 and 160
    or p_worker_id ~ '[[:cntrl:]]'
    or p_now is null
    or p_lease_seconds not between 60 and 600 then
    raise exception 'SELLER_OS_LUNA_STOCK_CHECK_CLAIM_INVALID';
  end if;

  select * into v_job
  from public.seller_os_luna_stock_check_jobs job
  where job.stock_check_job_id = p_stock_check_job_id
  for update;
  if not found then
    raise exception 'SELLER_OS_LUNA_STOCK_CHECK_JOB_NOT_FOUND';
  end if;
  if v_job.success_receipt_digest is not null then
    return query select false, 'SUCCESS_RECEIPT_PRESENT'::text,
      v_job.attempt_count, null::timestamptz;
    return;
  end if;
  if v_job.workflow_state = 'IN_PROGRESS'
    and v_job.lease_expires_at > p_now then
    return query select false, 'ACTIVE_LEASE'::text,
      v_job.attempt_count, v_job.lease_expires_at;
    return;
  end if;
  if v_job.workflow_state not in (
      'NOT_STARTED', 'RETRYABLE_FAILURE', 'IN_PROGRESS'
    ) then
    return query select false, 'WORKFLOW_STATE_BLOCKED'::text,
      v_job.attempt_count, null::timestamptz;
    return;
  end if;
  if v_job.due_at > p_now then
    return query select false, 'NOT_DUE'::text,
      v_job.attempt_count, null::timestamptz;
    return;
  end if;
  if v_job.attempt_count >= 5 then
    return query select false, 'ATTEMPTS_EXHAUSTED'::text,
      v_job.attempt_count, null::timestamptz;
    return;
  end if;

  update public.seller_os_luna_stock_check_jobs job
  set workflow_state = 'IN_PROGRESS',
      attempt_count = job.attempt_count + 1,
      lease_owner = trim(p_worker_id),
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      updated_at = p_now
  where job.stock_check_job_id = p_stock_check_job_id
  returning * into v_job;
  return query select true, 'CLAIMED'::text, v_job.attempt_count,
    v_job.lease_expires_at;
end;
$$;

create or replace function public.verify_seller_os_luna_stock_check_lease_v1(
  p_stock_check_job_id text,
  p_worker_id text,
  p_now timestamptz default clock_timestamp()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.role() = 'service_role' and exists (
    select 1
    from public.seller_os_luna_stock_check_jobs job
    where job.stock_check_job_id = p_stock_check_job_id
      and job.workflow_state = 'IN_PROGRESS'
      and job.lease_owner = trim(p_worker_id)
      and job.lease_expires_at > p_now
      and job.success_receipt_digest is null
  );
$$;

create or replace function public.complete_seller_os_luna_stock_check_job_v1(
  p_stock_check_job_id text,
  p_worker_id text,
  p_success_receipt_digest text,
  p_now timestamptz default clock_timestamp()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.seller_os_luna_stock_check_jobs%rowtype;
begin
  if auth.role() <> 'service_role'
    or coalesce(p_success_receipt_digest, '') !~
      '^luna-stock-package-v1:sha256:[0-9a-f]{64}$'
    or p_now is null then
    raise exception 'SELLER_OS_LUNA_STOCK_CHECK_COMPLETE_INVALID';
  end if;
  select * into v_job
  from public.seller_os_luna_stock_check_jobs job
  where job.stock_check_job_id = p_stock_check_job_id
  for update;
  if not found then
    raise exception 'SELLER_OS_LUNA_STOCK_CHECK_JOB_NOT_FOUND';
  end if;
  if v_job.workflow_state = 'SUCCEEDED' then
    if v_job.success_receipt_digest = p_success_receipt_digest then
      return true;
    end if;
    raise exception 'SELLER_OS_LUNA_STOCK_CHECK_RECEIPT_CONFLICT';
  end if;
  if v_job.workflow_state <> 'IN_PROGRESS'
    or v_job.lease_owner is distinct from trim(p_worker_id)
    or v_job.lease_expires_at <= p_now then
    raise exception 'SELLER_OS_LUNA_STOCK_CHECK_LEASE_NOT_OWNED';
  end if;
  update public.seller_os_luna_stock_check_jobs job
  set workflow_state = 'SUCCEEDED',
      lease_owner = null,
      lease_expires_at = null,
      success_receipt_digest = p_success_receipt_digest,
      updated_at = p_now
  where job.stock_check_job_id = p_stock_check_job_id;
  return true;
end;
$$;

create or replace function public.store_seller_os_luna_protected_session_v1(
  p_actor uuid,
  p_session_payload text,
  p_now timestamptz default clock_timestamp()
)
returns boolean
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_payload jsonb;
  v_secret_id uuid;
  v_secret_name constant text := 'imnova_seller_os_luna_session_v1';
  v_captured_at timestamptz;
  v_validated_at timestamptz;
  v_expires_at timestamptz;
begin
  if auth.role() <> 'service_role'
    or p_actor is null
    or length(coalesce(p_session_payload, '')) not between 80 and 12000
    or p_session_payload ~ '[[:cntrl:]]'
    or p_now is null then
    raise exception 'SELLER_OS_LUNA_PROTECTED_SESSION_INPUT_INVALID';
  end if;
  begin
    v_payload := p_session_payload::jsonb;
  exception when others then
    raise exception 'SELLER_OS_LUNA_PROTECTED_SESSION_INPUT_INVALID';
  end;
  if jsonb_typeof(v_payload) <> 'object'
    or (select count(*) from jsonb_object_keys(v_payload)) <> 5
    or not (v_payload ?& array[
      'contractVersion', 'cookieHeader', 'capturedAt', 'validatedAt', 'expiresAt'
    ])
    or v_payload->>'contractVersion' <> 'SELLER_OS_LUNA_PROTECTED_SESSION_V1'
    or length(coalesce(v_payload->>'cookieHeader', '')) not between 8 and 8192
    or v_payload->>'cookieHeader' !~
      '^[^=;[:space:]]+=[^;[:cntrl:]]*(;[[:space:]]*[^=;[:space:]]+=[^;[:cntrl:]]*)*$'
    or v_payload->>'cookieHeader' ~* '(authorization|bearer|password|cookie[[:space:]]*:)' then
    raise exception 'SELLER_OS_LUNA_PROTECTED_SESSION_INPUT_INVALID';
  end if;
  begin
    v_captured_at := (v_payload->>'capturedAt')::timestamptz;
    v_validated_at := (v_payload->>'validatedAt')::timestamptz;
    v_expires_at := (v_payload->>'expiresAt')::timestamptz;
  exception when others then
    raise exception 'SELLER_OS_LUNA_PROTECTED_SESSION_INPUT_INVALID';
  end;
  if v_captured_at > v_validated_at
    or v_validated_at > p_now + interval '5 minutes'
    or v_expires_at <= v_validated_at
    or v_expires_at - v_captured_at > interval '45 days' then
    raise exception 'SELLER_OS_LUNA_PROTECTED_SESSION_INPUT_INVALID';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('seller_os_luna_protected_session_v1', 0)
  );
  select secret.id into v_secret_id
  from vault.decrypted_secrets secret
  where secret.name = v_secret_name
  order by secret.updated_at desc nulls last, secret.created_at desc
  limit 1;
  if v_secret_id is null then
    perform vault.create_secret(
      p_session_payload,
      v_secret_name,
      'Seller OS server-owned Luna read-only web session'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      p_session_payload,
      v_secret_name,
      'Seller OS server-owned Luna read-only web session'
    );
  end if;
  return true;
end;
$$;

create or replace function public.get_seller_os_luna_protected_session_v1()
returns text
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_payload text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SELLER_OS_LUNA_PROTECTED_SESSION_ACCESS_DENIED';
  end if;
  select secret.decrypted_secret into v_payload
  from vault.decrypted_secrets secret
  where secret.name = 'imnova_seller_os_luna_session_v1'
  order by secret.updated_at desc nulls last, secret.created_at desc
  limit 1;
  return nullif(v_payload, '');
end;
$$;

revoke all on function
  public.prevent_seller_os_luna_stock_observation_mutation_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.ensure_seller_os_luna_stock_check_job_v1(
  text, text, text, text, timestamptz, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function public.ensure_seller_os_luna_stock_observation_v1(
  text, text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, text, text, text, integer, timestamptz, integer, text[],
  text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.claim_seller_os_luna_stock_check_job_v1(
  text, text, timestamptz, integer
) from public, anon, authenticated, service_role;
revoke all on function public.verify_seller_os_luna_stock_check_lease_v1(
  text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.complete_seller_os_luna_stock_check_job_v1(
  text, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.store_seller_os_luna_protected_session_v1(
  uuid, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.get_seller_os_luna_protected_session_v1()
  from public, anon, authenticated, service_role;

grant execute on function public.claim_seller_os_luna_stock_check_job_v1(
  text, text, timestamptz, integer
) to service_role;
grant execute on function public.ensure_seller_os_luna_stock_check_job_v1(
  text, text, text, text, timestamptz, timestamptz, timestamptz, text
) to service_role;
grant execute on function public.ensure_seller_os_luna_stock_observation_v1(
  text, text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, text, text, text, integer, timestamptz, integer, text[],
  text, timestamptz
) to service_role;
grant execute on function public.verify_seller_os_luna_stock_check_lease_v1(
  text, text, timestamptz
) to service_role;
grant execute on function public.complete_seller_os_luna_stock_check_job_v1(
  text, text, text, timestamptz
) to service_role;
grant execute on function public.store_seller_os_luna_protected_session_v1(
  uuid, text, timestamptz
) to service_role;
grant execute on function public.get_seller_os_luna_protected_session_v1()
  to service_role;

comment on table public.seller_os_luna_stock_check_jobs is
  'P2-I02 durable logical stock-check windows. No production scheduler is created by this artifact.';
comment on table public.seller_os_luna_stock_observations is
  'Immutable sanitized supplier-stated Luna observations; never stores HTML, cookies, credentials, or buyer PII.';
comment on function public.get_seller_os_luna_protected_session_v1() is
  'Returns the server-owned Luna session only to service_role for a fixed canonical read; never browser-callable.';

notify pgrst, 'reload schema';
