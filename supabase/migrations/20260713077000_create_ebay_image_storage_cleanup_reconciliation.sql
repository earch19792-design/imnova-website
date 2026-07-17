-- Durable, account-scoped reconciliation for private image objects whose
-- best-effort removal failed after a database review transaction committed.

create table if not exists public.ebay_image_storage_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  account_key text not null,
  image_asset_id uuid not null references public.ebay_listing_image_assets(id)
    on delete restrict,
  listing_package_id uuid not null references public.ebay_listing_packages(id)
    on delete restrict,
  cleanup_kind text not null,
  bucket_id text not null,
  storage_key text not null,
  expected_sha256 text null,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  next_attempt_at timestamptz not null default now(),
  lease_owner text null,
  lease_expires_at timestamptz null,
  last_error_code text null,
  last_attempt_at timestamptz null,
  completed_at timestamptz null,
  requested_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_image_cleanup_account_check check (
    account_key <> 'default'
    and account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
  ),
  constraint ebay_image_cleanup_kind_check check (
    cleanup_kind in ('approved_staging', 'rejected_staging', 'rejected_source')
  ),
  constraint ebay_image_cleanup_bucket_check check (
    bucket_id in ('ebay-listing-image-sources', 'ebay-listing-image-staging')
  ),
  constraint ebay_image_cleanup_kind_bucket_check check (
    (cleanup_kind in ('approved_staging', 'rejected_staging')
      and bucket_id = 'ebay-listing-image-staging')
    or (cleanup_kind = 'rejected_source'
      and bucket_id = 'ebay-listing-image-sources')
  ),
  constraint ebay_image_cleanup_storage_key_check check (
    length(storage_key) between 1 and 1000
    and storage_key ~ '^[A-Za-z0-9._/-]+$'
    and storage_key !~ '(^/|[.][.]|//)'
  ),
  constraint ebay_image_cleanup_hash_check check (
    expected_sha256 is null or expected_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_image_cleanup_status_check check (
    status in ('pending', 'leased', 'failed', 'succeeded', 'dead_letter')
  ),
  constraint ebay_image_cleanup_attempts_check check (
    attempts >= 0 and max_attempts between 1 and 20
  ),
  constraint ebay_image_cleanup_lease_check check (
    (status = 'leased' and lease_owner is not null and lease_expires_at is not null)
    or (status <> 'leased' and lease_owner is null and lease_expires_at is null)
  ),
  constraint ebay_image_cleanup_object_unique unique (
    account_key, image_asset_id, bucket_id, storage_key
  )
);

create table if not exists public.ebay_image_storage_cleanup_attempts (
  id uuid primary key default gen_random_uuid(),
  cleanup_job_id uuid not null references public.ebay_image_storage_cleanup_jobs(id)
    on delete cascade,
  attempt_number integer not null,
  worker_id text not null,
  outcome text not null,
  error_code text null,
  attempted_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  constraint ebay_image_cleanup_attempt_outcome_check check (
    outcome in ('deleted', 'already_missing', 'failed')
  ),
  constraint ebay_image_cleanup_attempt_number_check check (attempt_number > 0),
  constraint ebay_image_cleanup_attempt_unique unique (
    cleanup_job_id, attempt_number
  )
);

create index if not exists ebay_image_cleanup_claim_idx
  on public.ebay_image_storage_cleanup_jobs(
    account_key, status, next_attempt_at, created_at
  )
  where status in ('pending', 'failed', 'leased');
create index if not exists ebay_image_cleanup_asset_idx
  on public.ebay_image_storage_cleanup_jobs(
    account_key, listing_package_id, image_asset_id, created_at desc
  );

create or replace function public.enqueue_ebay_image_storage_cleanup(
  p_account_key text,
  p_image_asset_id uuid,
  p_listing_package_id uuid,
  p_cleanup_kind text,
  p_bucket_id text,
  p_storage_key text,
  p_expected_sha256 text,
  p_requested_by uuid
)
returns setof public.ebay_image_storage_cleanup_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset public.ebay_listing_image_assets%rowtype;
begin
  if p_account_key is null
    or p_account_key = 'default'
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_image_asset_id is null
    or p_listing_package_id is null
    or p_cleanup_kind not in (
      'approved_staging', 'rejected_staging', 'rejected_source'
    )
    or p_bucket_id not in (
      'ebay-listing-image-sources', 'ebay-listing-image-staging'
    )
    or nullif(trim(p_storage_key), '') is null
    or p_storage_key !~ '^[A-Za-z0-9._/-]+$'
    or p_storage_key ~ '(^/|[.][.]|//)'
    or (
      p_expected_sha256 is not null
      and p_expected_sha256 !~ '^[0-9a-f]{64}$'
    ) then
    raise exception 'EBAY_IMAGE_CLEANUP_REQUEST_INVALID';
  end if;

  select asset.* into v_asset
  from public.ebay_listing_image_assets asset
  join public.ebay_listing_packages package_row
    on package_row.id = asset.listing_package_id
    and package_row.account_key = asset.account_key
  where asset.id = p_image_asset_id
    and asset.listing_package_id = p_listing_package_id
    and asset.account_key = p_account_key
    and package_row.account_key = p_account_key
  for update of asset;
  if not found then
    raise exception 'EBAY_IMAGE_CLEANUP_ACCOUNT_SCOPE_MISMATCH';
  end if;

  if (
    p_cleanup_kind = 'approved_staging'
    and (
      v_asset.status <> 'approved'
      or p_bucket_id <> 'ebay-listing-image-staging'
      or p_storage_key is distinct from v_asset.output_storage_path
      or p_expected_sha256 is distinct from v_asset.output_sha256
    )
  ) or (
    p_cleanup_kind = 'rejected_staging'
    and (
      v_asset.status <> 'rejected'
      or p_bucket_id <> 'ebay-listing-image-staging'
      or p_storage_key is distinct from v_asset.output_storage_path
      or p_expected_sha256 is distinct from v_asset.output_sha256
    )
  ) or (
    p_cleanup_kind = 'rejected_source'
    and (
      v_asset.status <> 'rejected'
      or p_bucket_id <> 'ebay-listing-image-sources'
      or p_storage_key is distinct from v_asset.source_storage_path
      or p_expected_sha256 is distinct from v_asset.source_sha256
    )
  ) then
    raise exception 'EBAY_IMAGE_CLEANUP_ASSET_STATE_INVALID';
  end if;

  return query
  insert into public.ebay_image_storage_cleanup_jobs as cleanup_job (
    account_key, image_asset_id, listing_package_id, cleanup_kind,
    bucket_id, storage_key, expected_sha256, requested_by
  ) values (
    p_account_key, p_image_asset_id, p_listing_package_id, p_cleanup_kind,
    p_bucket_id, p_storage_key, p_expected_sha256, p_requested_by
  )
  on conflict (account_key, image_asset_id, bucket_id, storage_key)
  do update set
    status = case
      when cleanup_job.status in ('failed', 'dead_letter') then 'pending'
      else cleanup_job.status
    end,
    attempts = case
      when cleanup_job.status = 'dead_letter' then 0
      else cleanup_job.attempts
    end,
    next_attempt_at = case
      when cleanup_job.status in ('failed', 'dead_letter') then now()
      else cleanup_job.next_attempt_at
    end,
    last_error_code = case
      when cleanup_job.status in ('failed', 'dead_letter') then null
      else cleanup_job.last_error_code
    end,
    updated_at = now()
  returning cleanup_job.*;
end;
$$;

create or replace function public.claim_ebay_image_storage_cleanup_jobs(
  p_account_key text,
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 120
)
returns setof public.ebay_image_storage_cleanup_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_account_key is null
    or p_account_key = 'default'
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or nullif(trim(p_worker_id), '') is null
    or length(p_worker_id) > 160
    or p_limit is null
    or p_limit not between 1 and 25
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 600 then
    raise exception 'EBAY_IMAGE_CLEANUP_CLAIM_INVALID';
  end if;

  update public.ebay_image_storage_cleanup_jobs cleanup_job
  set status = 'failed',
      lease_owner = null,
      lease_expires_at = null,
      last_error_code = 'LEASE_EXPIRED',
      next_attempt_at = now(),
      updated_at = now()
  where cleanup_job.account_key = p_account_key
    and cleanup_job.status = 'leased'
    and cleanup_job.lease_expires_at <= now();

  return query
  with claimable as (
    select cleanup_job.id
    from public.ebay_image_storage_cleanup_jobs cleanup_job
    where cleanup_job.account_key = p_account_key
      and cleanup_job.status in ('pending', 'failed')
      and cleanup_job.next_attempt_at <= now()
      and cleanup_job.attempts < cleanup_job.max_attempts
    order by cleanup_job.next_attempt_at, cleanup_job.created_at, cleanup_job.id
    for update skip locked
    limit p_limit
  )
  update public.ebay_image_storage_cleanup_jobs cleanup_job
  set status = 'leased',
      attempts = cleanup_job.attempts + 1,
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_attempt_at = now(),
      updated_at = now()
  from claimable
  where cleanup_job.id = claimable.id
  returning cleanup_job.*;
end;
$$;

create or replace function public.complete_ebay_image_storage_cleanup_job(
  p_job_id uuid,
  p_worker_id text,
  p_outcome text
)
returns setof public.ebay_image_storage_cleanup_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.ebay_image_storage_cleanup_jobs%rowtype;
begin
  if p_job_id is null
    or nullif(trim(p_worker_id), '') is null
    or p_outcome not in ('deleted', 'already_missing') then
    raise exception 'EBAY_IMAGE_CLEANUP_COMPLETE_INVALID';
  end if;

  select * into v_job
  from public.ebay_image_storage_cleanup_jobs cleanup_job
  where cleanup_job.id = p_job_id
    and cleanup_job.status = 'leased'
    and cleanup_job.lease_owner = p_worker_id
    and cleanup_job.lease_expires_at > now()
  for update;
  if not found then raise exception 'EBAY_IMAGE_CLEANUP_LEASE_NOT_OWNED'; end if;

  insert into public.ebay_image_storage_cleanup_attempts (
    cleanup_job_id, attempt_number, worker_id, outcome
  ) values (v_job.id, v_job.attempts, p_worker_id, p_outcome);

  update public.ebay_image_storage_cleanup_jobs cleanup_job
  set status = 'succeeded',
      lease_owner = null,
      lease_expires_at = null,
      last_error_code = null,
      completed_at = now(),
      updated_at = now()
  where cleanup_job.id = v_job.id
  returning cleanup_job.* into v_job;
  return next v_job;
end;
$$;

create or replace function public.fail_ebay_image_storage_cleanup_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_retry_after_seconds integer default 300
)
returns setof public.ebay_image_storage_cleanup_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.ebay_image_storage_cleanup_jobs%rowtype;
begin
  if p_job_id is null
    or nullif(trim(p_worker_id), '') is null
    or p_error_code is null
    or p_error_code !~ '^[A-Z0-9_]{3,100}$'
    or p_retry_after_seconds is null
    or p_retry_after_seconds not between 30 and 86400 then
    raise exception 'EBAY_IMAGE_CLEANUP_FAIL_INVALID';
  end if;

  select * into v_job
  from public.ebay_image_storage_cleanup_jobs cleanup_job
  where cleanup_job.id = p_job_id
    and cleanup_job.status = 'leased'
    and cleanup_job.lease_owner = p_worker_id
  for update;
  if not found then raise exception 'EBAY_IMAGE_CLEANUP_LEASE_NOT_OWNED'; end if;

  insert into public.ebay_image_storage_cleanup_attempts (
    cleanup_job_id, attempt_number, worker_id, outcome, error_code
  ) values (v_job.id, v_job.attempts, p_worker_id, 'failed', p_error_code);

  update public.ebay_image_storage_cleanup_jobs cleanup_job
  set status = case
        when cleanup_job.attempts >= cleanup_job.max_attempts
          then 'dead_letter'
        else 'failed'
      end,
      lease_owner = null,
      lease_expires_at = null,
      last_error_code = p_error_code,
      next_attempt_at = now() + make_interval(secs => p_retry_after_seconds),
      updated_at = now()
  where cleanup_job.id = v_job.id
  returning cleanup_job.* into v_job;
  return next v_job;
end;
$$;

alter table public.ebay_image_storage_cleanup_jobs enable row level security;
alter table public.ebay_image_storage_cleanup_attempts enable row level security;
revoke all on table public.ebay_image_storage_cleanup_jobs
  from public, anon, authenticated;
revoke all on table public.ebay_image_storage_cleanup_attempts
  from public, anon, authenticated;
grant select, insert, update, delete
  on public.ebay_image_storage_cleanup_jobs to service_role;
grant select, insert, update, delete
  on public.ebay_image_storage_cleanup_attempts to service_role;

revoke all on function public.enqueue_ebay_image_storage_cleanup(
  text, uuid, uuid, text, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.enqueue_ebay_image_storage_cleanup(
  text, uuid, uuid, text, text, text, text, uuid
) to service_role;
revoke all on function public.claim_ebay_image_storage_cleanup_jobs(
  text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.claim_ebay_image_storage_cleanup_jobs(
  text, text, integer, integer
) to service_role;
revoke all on function public.complete_ebay_image_storage_cleanup_job(
  uuid, text, text
) from public, anon, authenticated;
grant execute on function public.complete_ebay_image_storage_cleanup_job(
  uuid, text, text
) to service_role;
revoke all on function public.fail_ebay_image_storage_cleanup_job(
  uuid, text, text, integer
) from public, anon, authenticated;
grant execute on function public.fail_ebay_image_storage_cleanup_job(
  uuid, text, text, integer
) to service_role;

comment on table public.ebay_image_storage_cleanup_jobs is
  'Durable private-object cleanup ledger. Public approved objects are structurally excluded.';

notify pgrst, 'reload schema';
