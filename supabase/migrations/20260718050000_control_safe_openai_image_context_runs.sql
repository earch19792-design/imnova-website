-- Preview/staging-only control plane for one unbranded OpenAI background
-- plate per approved eBay listing package. The table intentionally stores no
-- prompt, image, URL, Base64, product bytes, competitor data or raw response.

create table if not exists public.ebay_openai_image_context_runs (
  id uuid primary key default gen_random_uuid(),
  account_key text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  listing_package_id uuid not null references public.ebay_listing_packages(id) on delete restrict,
  listing_generation_id uuid not null references public.marketplace_listing_generations(id) on delete restrict,
  identity_fingerprint text not null,
  context_kind text not null,
  model text not null,
  plate_version text not null,
  prompt_hash text not null,
  request_hash text not null,
  idempotency_key_hash text not null,
  status text not null default 'CLAIMED',
  attempt integer not null default 1,
  openai_call_count integer not null default 1,
  daily_call_limit integer not null,
  daily_budget_date date not null default ((now() at time zone 'utc')::date),
  requested_image_count integer not null default 1,
  requested_quality text not null default 'low',
  requested_size text not null default '1024x1024',
  lease_token uuid null,
  lease_expires_at timestamptz null,
  provider_request_id text null,
  output_sha256 text null,
  input_tokens integer null,
  output_tokens integer null,
  total_tokens integer null,
  last_error_code text null,
  completed_at timestamptz null,
  failed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  competitor_image_count integer not null default 0,
  product_byte_count_sent integer not null default 0,
  product_url_count_sent integer not null default 0,
  ebay_write_count integer not null default 0,
  production_changed boolean not null default false,
  constraint ebay_openai_image_context_account_check check (
    account_key <> 'default'
    and account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
  ),
  constraint ebay_openai_image_context_status_check check (
    status in ('CLAIMED', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_FINAL')
  ),
  constraint ebay_openai_image_context_kind_check check (
    context_kind in (
      'CLEAN_TECHNICAL_WORKBENCH', 'NEUTRAL_VANITY', 'CLEAN_HOME_SHELF',
      'CLEAN_KITCHEN_COUNTER', 'NEUTRAL_STUDIO'
    )
  ),
  constraint ebay_openai_image_context_model_check check (
    model = 'gpt-image-2'
  ),
  constraint ebay_openai_image_context_version_check check (
    plate_version = 'EBAY_OPENAI_BACKGROUND_PLATE_V1'
  ),
  constraint ebay_openai_image_context_hashes_check check (
    identity_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and prompt_hash ~ '^[0-9a-f]{64}$'
    and request_hash ~ '^[0-9a-f]{64}$'
    and idempotency_key_hash ~ '^[0-9a-f]{64}$'
    and (output_sha256 is null or output_sha256 ~ '^[0-9a-f]{64}$')
  ),
  constraint ebay_openai_image_context_attempt_check check (
    attempt between 1 and 2 and openai_call_count between 1 and 2
  ),
  constraint ebay_openai_image_context_budget_check check (
    daily_call_limit between 1 and 20
    and requested_image_count = 1
    and requested_quality = 'low'
    and requested_size = '1024x1024'
  ),
  constraint ebay_openai_image_context_usage_check check (
    (input_tokens is null or input_tokens >= 0)
    and (output_tokens is null or output_tokens >= 0)
    and (total_tokens is null or total_tokens >= 0)
  ),
  constraint ebay_openai_image_context_provider_id_check check (
    provider_request_id is null
    or provider_request_id ~ '^[A-Za-z0-9_-]{1,200}$'
  ),
  constraint ebay_openai_image_context_error_check check (
    last_error_code is null or last_error_code ~ '^[A-Z0-9_:.-]{1,200}$'
  ),
  constraint ebay_openai_image_context_lease_check check (
    (status = 'CLAIMED' and lease_token is not null and lease_expires_at is not null)
    or (status <> 'CLAIMED' and lease_token is null and lease_expires_at is null)
  ),
  constraint ebay_openai_image_context_completion_check check (
    (status = 'COMPLETED' and output_sha256 is not null and completed_at is not null)
    or (status <> 'COMPLETED' and completed_at is null)
  ),
  constraint ebay_openai_image_context_safety_check check (
    competitor_image_count = 0
    and product_byte_count_sent = 0
    and product_url_count_sent = 0
    and ebay_write_count = 0
    and production_changed = false
  ),
  constraint ebay_openai_image_context_request_unique unique (
    account_key, listing_package_id, listing_generation_id, request_hash
  ),
  constraint ebay_openai_image_context_idempotency_unique unique (
    idempotency_key_hash
  )
);

create index if not exists ebay_openai_image_context_budget_idx
  on public.ebay_openai_image_context_runs(account_key, daily_budget_date, created_at);

create or replace function public.claim_ebay_openai_image_context_run(
  p_account_key text,
  p_actor uuid,
  p_listing_package_id uuid,
  p_listing_generation_id uuid,
  p_identity_fingerprint text,
  p_context_kind text,
  p_model text,
  p_plate_version text,
  p_prompt_hash text,
  p_request_hash text,
  p_idempotency_key_hash text,
  p_lease_token uuid,
  p_daily_call_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.ebay_openai_image_context_runs%rowtype;
  v_daily_calls integer;
  v_today date := (now() at time zone 'utc')::date;
begin
  if p_daily_call_limit not between 1 and 20 then
    raise exception 'EBAY_IMAGE_OPENAI_DAILY_LIMIT_INVALID';
  end if;
  if p_identity_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    or p_prompt_hash !~ '^[0-9a-f]{64}$'
    or p_request_hash !~ '^[0-9a-f]{64}$'
    or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'EBAY_IMAGE_OPENAI_CLAIM_HASH_INVALID';
  end if;

  perform 1
  from public.ebay_listing_packages package_row
  join public.marketplace_listing_generations generation
    on generation.id = p_listing_generation_id
  where package_row.id = p_listing_package_id
    and package_row.account_key = p_account_key
    and package_row.created_by = p_actor
    and generation.marketplace_account_key = p_account_key
    and generation.marketplace = 'EBAY_US'
    and generation.status = 'APPROVED'
    and generation.identity_fingerprint = p_identity_fingerprint;
  if not found then
    raise exception 'EBAY_IMAGE_OPENAI_APPROVAL_SCOPE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_account_key || ':' || v_today::text, 0));

  select * into v_run
  from public.ebay_openai_image_context_runs
  where account_key = p_account_key
    and listing_package_id = p_listing_package_id
    and listing_generation_id = p_listing_generation_id
    and request_hash = p_request_hash
  for update;

  if found then
    if v_run.status = 'COMPLETED' then
      return jsonb_build_object(
        'claimed', false, 'status', v_run.status, 'runId', v_run.id,
        'requestHash', v_run.request_hash
      );
    end if;
    if v_run.status = 'CLAIMED' then
      return jsonb_build_object(
        'claimed', false,
        'status', case when v_run.lease_expires_at <= now()
          then 'LEASE_EXPIRED_REVIEW_REQUIRED' else v_run.status end,
        'runId', v_run.id, 'requestHash', v_run.request_hash
      );
    end if;
    if v_run.status = 'FAILED_FINAL' or v_run.attempt >= 2 then
      return jsonb_build_object(
        'claimed', false, 'status', 'FAILED_FINAL', 'runId', v_run.id,
        'requestHash', v_run.request_hash
      );
    end if;
  end if;

  select coalesce(sum(openai_call_count), 0)::integer into v_daily_calls
  from public.ebay_openai_image_context_runs
  where account_key = p_account_key and daily_budget_date = v_today;
  if v_daily_calls >= p_daily_call_limit then
    raise exception 'EBAY_IMAGE_OPENAI_DAILY_BUDGET_EXHAUSTED';
  end if;

  if v_run.id is null then
    insert into public.ebay_openai_image_context_runs (
      account_key, created_by, listing_package_id, listing_generation_id,
      identity_fingerprint, context_kind, model, plate_version, prompt_hash,
      request_hash, idempotency_key_hash, daily_call_limit,
      lease_token, lease_expires_at
    ) values (
      p_account_key, p_actor, p_listing_package_id, p_listing_generation_id,
      p_identity_fingerprint, p_context_kind, p_model, p_plate_version,
      p_prompt_hash, p_request_hash, p_idempotency_key_hash,
      p_daily_call_limit, p_lease_token,
      now() + interval '3 minutes'
    ) returning * into v_run;
  else
    update public.ebay_openai_image_context_runs
    set status = 'CLAIMED', attempt = attempt + 1,
      openai_call_count = openai_call_count + 1,
      daily_call_limit = p_daily_call_limit,
      daily_budget_date = v_today,
      lease_token = p_lease_token, lease_expires_at = now() + interval '3 minutes',
      last_error_code = null, failed_at = null, updated_at = now()
    where id = v_run.id
    returning * into v_run;
  end if;

  return jsonb_build_object(
    'claimed', true, 'status', v_run.status, 'runId', v_run.id,
    'requestHash', v_run.request_hash, 'attempt', v_run.attempt
  );
end;
$$;

create or replace function public.complete_ebay_openai_image_context_run(
  p_run_id uuid,
  p_actor uuid,
  p_lease_token uuid,
  p_output_sha256 text,
  p_provider_request_id text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_total_tokens integer
)
returns public.ebay_openai_image_context_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.ebay_openai_image_context_runs%rowtype;
begin
  if p_output_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'EBAY_IMAGE_OPENAI_OUTPUT_HASH_INVALID';
  end if;
  update public.ebay_openai_image_context_runs
  set status = 'COMPLETED', output_sha256 = p_output_sha256,
    provider_request_id = nullif(p_provider_request_id, ''),
    input_tokens = p_input_tokens, output_tokens = p_output_tokens,
    total_tokens = p_total_tokens, completed_at = now(),
    lease_token = null, lease_expires_at = null, updated_at = now()
  where id = p_run_id and created_by = p_actor and status = 'CLAIMED'
    and lease_token = p_lease_token
  returning * into v_run;
  if not found then raise exception 'EBAY_IMAGE_OPENAI_COMPLETION_CONFLICT'; end if;
  return v_run;
end;
$$;

create or replace function public.fail_ebay_openai_image_context_run(
  p_run_id uuid,
  p_actor uuid,
  p_lease_token uuid,
  p_error_code text,
  p_retryable boolean
)
returns public.ebay_openai_image_context_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.ebay_openai_image_context_runs%rowtype;
begin
  if p_error_code !~ '^[A-Z0-9_:.-]{1,200}$' then
    raise exception 'EBAY_IMAGE_OPENAI_ERROR_CODE_INVALID';
  end if;
  update public.ebay_openai_image_context_runs
  set status = case when p_retryable and attempt < 2
      then 'FAILED_RETRYABLE' else 'FAILED_FINAL' end,
    last_error_code = p_error_code, failed_at = now(),
    lease_token = null, lease_expires_at = null, updated_at = now()
  where id = p_run_id and created_by = p_actor and status = 'CLAIMED'
    and lease_token = p_lease_token
  returning * into v_run;
  if not found then raise exception 'EBAY_IMAGE_OPENAI_FAILURE_CONFLICT'; end if;
  return v_run;
end;
$$;

alter table public.ebay_openai_image_context_runs enable row level security;
alter table public.ebay_openai_image_context_runs force row level security;
revoke all on table public.ebay_openai_image_context_runs from anon, authenticated;
revoke all on table public.ebay_openai_image_context_runs from public, service_role;
grant select on table public.ebay_openai_image_context_runs to service_role;

revoke all on function public.claim_ebay_openai_image_context_run(
  text, uuid, uuid, uuid, text, text, text, text, text, text, text, uuid, integer
) from public, anon, authenticated;
revoke all on function public.complete_ebay_openai_image_context_run(
  uuid, uuid, uuid, text, text, integer, integer, integer
) from public, anon, authenticated;
revoke all on function public.fail_ebay_openai_image_context_run(
  uuid, uuid, uuid, text, boolean
) from public, anon, authenticated;
grant execute on function public.claim_ebay_openai_image_context_run(
  text, uuid, uuid, uuid, text, text, text, text, text, text, text, uuid, integer
) to service_role;
grant execute on function public.complete_ebay_openai_image_context_run(
  uuid, uuid, uuid, text, text, integer, integer, integer
) to service_role;
grant execute on function public.fail_ebay_openai_image_context_run(
  uuid, uuid, uuid, text, boolean
) to service_role;

comment on table public.ebay_openai_image_context_runs is
  'Metadata-only Preview control plane for one safe unbranded background plate. Stores no image, URL, Base64, product bytes, competitor data or raw provider response.';
