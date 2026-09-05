-- Durable mechanism learning for Seller OS operational projection integrity.
-- This ledger contains no Product Truth and has no marketplace mutation
-- primitive. Only the service runtime can read or write it.

create table public.seller_os_operational_integrity_runs_v1 (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  mechanism_version text not null,
  evidence_fingerprint text not null,
  status text not null,
  check_count integer not null,
  violation_count integer not null,
  unknown_count integer not null,
  audit_receipt jsonb not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint seller_os_operational_integrity_runs_account_check check (
    marketplace_account_key <> 'default'
    and char_length(marketplace_account_key) between 8 and 160
    and marketplace_account_key !~ '[[:cntrl:]]'
  ),
  constraint seller_os_operational_integrity_runs_version_check check (
    mechanism_version ~ '^[A-Z][A-Z0-9_]{7,119}$'
  ),
  constraint seller_os_operational_integrity_runs_fingerprint_check check (
    evidence_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_operational_integrity_runs_status_check check (
    status in ('PASS', 'VIOLATION', 'UNKNOWN')
  ),
  constraint seller_os_operational_integrity_runs_counts_check check (
    check_count >= 1
    and violation_count between 0 and check_count
    and unknown_count between 0 and check_count
    and violation_count + unknown_count <= check_count
  ),
  constraint seller_os_operational_integrity_runs_receipt_check check (
    jsonb_typeof(audit_receipt) = 'object'
  ),
  unique (
    marketplace_account_key,
    mechanism_version,
    evidence_fingerprint
  )
);

create index seller_os_operational_integrity_runs_latest_idx
  on public.seller_os_operational_integrity_runs_v1(
    marketplace_account_key, observed_at desc
  );

create table public.seller_os_operational_learning_ledger_v1 (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  failure_class text not null,
  invariant_code text not null,
  mechanism_version text not null,
  evidence_fingerprint text not null,
  recovery_policy_version text not null,
  retry_safety text not null,
  recovery_class text not null,
  recovery_outcome text not null default 'OBSERVED',
  regression_guard jsonb not null,
  evidence jsonb not null,
  status text not null default 'OPEN',
  lease_owner text null,
  lease_expires_at timestamptz null,
  recovery_attempt_count integer not null default 0,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_os_operational_learning_account_check check (
    marketplace_account_key <> 'default'
    and char_length(marketplace_account_key) between 8 and 160
    and marketplace_account_key !~ '[[:cntrl:]]'
  ),
  constraint seller_os_operational_learning_failure_check check (
    failure_class ~ '^[A-Z][A-Z0-9_:.-]{2,159}$'
    and invariant_code ~ '^[A-Z][A-Z0-9_:.-]{2,199}$'
  ),
  constraint seller_os_operational_learning_versions_check check (
    mechanism_version ~ '^[A-Z][A-Z0-9_]{7,119}$'
    and recovery_policy_version ~ '^[A-Z][A-Z0-9_]{7,119}$'
  ),
  constraint seller_os_operational_learning_fingerprint_check check (
    evidence_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_operational_learning_retry_check check (
    retry_safety in (
      'SAFE_READ_ONLY_RECONCILIATION',
      'SAFE_IDEMPOTENT_RUNTIME_RESUME',
      'OWNER_COMMERCIAL_AUTHORIZATION_REQUIRED',
      'ENGINEERING_REQUIRED',
      'NOT_APPLICABLE'
    )
    and recovery_class in (
      'AUTO_RECOVERABLE',
      'OWNER_COMMERCIAL',
      'ENGINEERING_REQUIRED',
      'OBSERVATION_ONLY'
    )
  ),
  constraint seller_os_operational_learning_outcome_check check (
    recovery_outcome in (
      'OBSERVED',
      'CLAIMED',
      'RECOVERED',
      'STILL_VIOLATED',
      'OWNER_REQUIRED',
      'ENGINEERING_REQUIRED',
      'RESOLVED_BY_READBACK'
    )
  ),
  constraint seller_os_operational_learning_payload_check check (
    jsonb_typeof(regression_guard) = 'object'
    and jsonb_typeof(evidence) = 'object'
  ),
  constraint seller_os_operational_learning_status_check check (
    status in ('OPEN', 'RESOLVED')
    and (
      (status = 'OPEN' and resolved_at is null)
      or (status = 'RESOLVED' and resolved_at is not null)
    )
  ),
  constraint seller_os_operational_learning_lease_check check (
    (lease_owner is null and lease_expires_at is null)
    or (
      lease_owner is not null
      and char_length(lease_owner) between 8 and 160
      and lease_owner !~ '[[:cntrl:]]'
      and lease_expires_at is not null
    )
  ),
  constraint seller_os_operational_learning_attempt_check check (
    recovery_attempt_count between 0 and 1000000
  ),
  unique (
    marketplace_account_key,
    invariant_code,
    evidence_fingerprint,
    mechanism_version
  )
);

create index seller_os_operational_learning_open_idx
  on public.seller_os_operational_learning_ledger_v1(
    marketplace_account_key, recovery_class, last_observed_at
  ) where status = 'OPEN';

create or replace function public.claim_seller_os_operational_integrity_v1(
  p_marketplace_account_key text,
  p_invariant_code text,
  p_evidence_fingerprint text,
  p_mechanism_version text,
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns table (
  claimed boolean,
  ledger_id uuid,
  recovery_class text,
  retry_safety text,
  recovery_attempt_count integer,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_marketplace_account_key is null
      or char_length(p_marketplace_account_key) not between 8 and 160
      or p_invariant_code is null
      or p_invariant_code !~ '^[A-Z][A-Z0-9_:.-]{2,199}$'
      or p_evidence_fingerprint is null
      or p_evidence_fingerprint !~ '^sha256:[0-9a-f]{64}$'
      or p_mechanism_version is null
      or p_mechanism_version !~ '^[A-Z][A-Z0-9_]{7,119}$'
      or p_worker_id is null
      or char_length(p_worker_id) not between 8 and 160
      or p_lease_seconds not between 30 and 900 then
    raise exception 'SELLER_OS_OPERATIONAL_INTEGRITY_CLAIM_INVALID';
  end if;

  return query
  with claimed_row as (
    update public.seller_os_operational_learning_ledger_v1 as ledger
    set lease_owner = p_worker_id,
        lease_expires_at = clock_timestamp() +
          make_interval(secs => p_lease_seconds),
        recovery_attempt_count = ledger.recovery_attempt_count + 1,
        recovery_outcome = 'CLAIMED',
        updated_at = clock_timestamp()
    where ledger.marketplace_account_key = p_marketplace_account_key
      and ledger.invariant_code = p_invariant_code
      and ledger.evidence_fingerprint = p_evidence_fingerprint
      and ledger.mechanism_version = p_mechanism_version
      and ledger.status = 'OPEN'
      and ledger.recovery_class = 'AUTO_RECOVERABLE'
      and ledger.retry_safety in (
        'SAFE_READ_ONLY_RECONCILIATION',
        'SAFE_IDEMPOTENT_RUNTIME_RESUME'
      )
      and (
        ledger.lease_expires_at is null
        or ledger.lease_expires_at <= clock_timestamp()
      )
    returning ledger.id, ledger.recovery_class, ledger.retry_safety,
      ledger.recovery_attempt_count, ledger.lease_expires_at
  )
  select true, claimed_row.id, claimed_row.recovery_class,
    claimed_row.retry_safety, claimed_row.recovery_attempt_count,
    claimed_row.lease_expires_at
  from claimed_row;

  if not found then
    return query select false, null::uuid, null::text, null::text,
      0::integer, null::timestamptz;
  end if;
end;
$$;

create or replace function public.finish_seller_os_operational_integrity_v1(
  p_ledger_id uuid,
  p_worker_id text,
  p_invariant_resolved boolean
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated integer;
begin
  if p_ledger_id is null or p_worker_id is null
      or char_length(p_worker_id) not between 8 and 160
      or p_invariant_resolved is null then
    raise exception 'SELLER_OS_OPERATIONAL_INTEGRITY_FINISH_INVALID';
  end if;

  update public.seller_os_operational_learning_ledger_v1
  set status = case when p_invariant_resolved then 'RESOLVED' else 'OPEN' end,
      recovery_outcome = case when p_invariant_resolved
        then 'RESOLVED_BY_READBACK' else 'STILL_VIOLATED' end,
      resolved_at = case when p_invariant_resolved
        then clock_timestamp() else null end,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = clock_timestamp()
  where id = p_ledger_id
    and lease_owner = p_worker_id
    and lease_expires_at > clock_timestamp();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

alter table public.seller_os_operational_integrity_runs_v1
  enable row level security;
alter table public.seller_os_operational_integrity_runs_v1
  force row level security;
alter table public.seller_os_operational_learning_ledger_v1
  enable row level security;
alter table public.seller_os_operational_learning_ledger_v1
  force row level security;

revoke all on table public.seller_os_operational_integrity_runs_v1
  from public, anon, authenticated;
revoke all on table public.seller_os_operational_learning_ledger_v1
  from public, anon, authenticated;
grant select, insert on table
  public.seller_os_operational_integrity_runs_v1 to service_role;
grant select, insert, update on table
  public.seller_os_operational_learning_ledger_v1 to service_role;

revoke all on function public.claim_seller_os_operational_integrity_v1(
  text, text, text, text, text, integer
) from public, anon, authenticated;
revoke all on function public.finish_seller_os_operational_integrity_v1(
  uuid, text, boolean
) from public, anon, authenticated;
grant execute on function public.claim_seller_os_operational_integrity_v1(
  text, text, text, text, text, integer
) to service_role;
grant execute on function public.finish_seller_os_operational_integrity_v1(
  uuid, text, boolean
) to service_role;

comment on table public.seller_os_operational_integrity_runs_v1 is
  'Durable read-only audit receipts for Seller OS state/read-model/presentation integrity. No Product Truth or marketplace mutation authority.';
comment on table public.seller_os_operational_learning_ledger_v1 is
  'Reusable mechanism-level failure and recovery learning. Never product memory, Product Truth, category selection, or owner authorization.';

notify pgrst, 'reload schema';
