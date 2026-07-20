-- One-shot, human-authorized replacement of pictures on an already verified
-- ACTIVE fixed-price listing. The immutable scope is an APPROVED image revision;
-- price, quantity, promotions and every other listing field are outside it.

create or replace function public.is_exact_six_ebay_revision_urls(p_urls jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select jsonb_typeof(p_urls) = 'array'
    and jsonb_array_length(p_urls) = 6
    and (select count(distinct value) from jsonb_array_elements_text(p_urls)) = 6
    and not exists (
      select 1 from jsonb_array_elements_text(p_urls) image(value)
      where image.value !~ '^https://[^[:space:][:cntrl:]]{1,492}$'
    )
    and coalesce((
      select sum(char_length(value)) from jsonb_array_elements_text(p_urls)
    ), 0) <= 3975;
$$;

create table if not exists public.ebay_active_listing_image_revision_executions (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null unique references
    public.ebay_same_day_pilot_image_revisions(id) on delete restrict,
  base_control_id uuid not null references
    public.ebay_same_day_pilot_image_package_runs(id) on delete restrict,
  listing_package_id uuid not null references
    public.ebay_listing_packages(id) on delete restrict,
  candidate_id uuid not null references
    public.ebay_same_day_pilot_candidates(id) on delete restrict,
  opportunity_id uuid not null references
    public.ebay_luna_opportunity_queue(id) on delete restrict,
  manual_listing_link_id uuid not null references
    public.ebay_manual_listing_links(id) on delete restrict,
  active_listing_id uuid not null references
    public.ebay_active_listings(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  marketplace_account_key text not null,
  account_fingerprint text not null,
  ebay_item_id text not null,
  ebay_sku text not null,
  image_set_hash text not null,
  image_urls jsonb not null,
  request_hash text not null,
  idempotency_key_hash text not null unique,
  phase text not null default 'preview_ready',
  ebay_write_attempt_count integer not null default 0,
  ebay_write_dispatched boolean not null default false,
  claim_token uuid null,
  lease_expires_at timestamptz null,
  preflight_snapshot jsonb null,
  postflight_snapshot jsonb null,
  write_http_status integer null,
  write_ack text null,
  last_error_code text null,
  reconciled boolean not null default false,
  write_started_at timestamptz null,
  write_acknowledged_at timestamptz null,
  reconciled_at timestamptz null,
  applied_verified_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_active_image_exec_account_check check (
    marketplace_account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    and right(marketplace_account_key, 64) = account_fingerprint
    and account_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_active_image_exec_item_check check (
    ebay_item_id ~ '^[0-9]{9,20}$'
  ),
  constraint ebay_active_image_exec_sku_check check (
    char_length(ebay_sku) between 1 and 50
    and ebay_sku !~ '[[:space:][:cntrl:]]'
  ),
  constraint ebay_active_image_exec_hash_check check (
    image_set_hash ~ '^[0-9a-f]{64}$'
    and request_hash ~ '^[0-9a-f]{64}$'
    and idempotency_key_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_active_image_exec_urls_check check (
    public.is_exact_six_ebay_revision_urls(image_urls)
  ),
  constraint ebay_active_image_exec_phase_check check (phase in (
    'preview_ready', 'write_in_flight', 'write_acknowledged',
    'outcome_unknown', 'applied_verified', 'terminal_failure'
  )),
  constraint ebay_active_image_exec_attempt_check check (
    ebay_write_attempt_count between 0 and 1
  ),
  constraint ebay_active_image_exec_claim_check check (
    (claim_token is null) = (lease_expires_at is null)
  ),
  constraint ebay_active_image_exec_applied_check check (
    phase <> 'applied_verified' or (
      applied_verified_at is not null and postflight_snapshot is not null
    )
  )
);

create unique index if not exists ebay_active_image_exec_listing_revision_uidx
  on public.ebay_active_listing_image_revision_executions(
    marketplace_account_key, ebay_item_id, revision_id
  );

create or replace function public.enforce_ebay_active_image_exec_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and (
    new.revision_id is distinct from old.revision_id
    or new.base_control_id is distinct from old.base_control_id
    or new.listing_package_id is distinct from old.listing_package_id
    or new.candidate_id is distinct from old.candidate_id
    or new.opportunity_id is distinct from old.opportunity_id
    or new.manual_listing_link_id is distinct from old.manual_listing_link_id
    or new.active_listing_id is distinct from old.active_listing_id
    or new.actor_user_id is distinct from old.actor_user_id
    or new.marketplace_account_key is distinct from old.marketplace_account_key
    or new.account_fingerprint is distinct from old.account_fingerprint
    or new.ebay_item_id is distinct from old.ebay_item_id
    or new.ebay_sku is distinct from old.ebay_sku
    or new.image_set_hash is distinct from old.image_set_hash
    or new.image_urls is distinct from old.image_urls
    or new.request_hash is distinct from old.request_hash
    or new.idempotency_key_hash is distinct from old.idempotency_key_hash
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_SCOPE_IMMUTABLE';
  end if;
  return new;
end;
$$;

create or replace function public.reject_ebay_active_image_exec_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'EBAY_ACTIVE_IMAGE_REVISION_LEDGER_APPEND_ONLY';
end;
$$;

create trigger enforce_ebay_active_image_exec_scope
before update on public.ebay_active_listing_image_revision_executions
for each row execute function public.enforce_ebay_active_image_exec_scope();

create trigger reject_ebay_active_image_exec_delete
before delete on public.ebay_active_listing_image_revision_executions
for each row execute function public.reject_ebay_active_image_exec_delete();

create or replace function public.valid_ebay_active_image_snapshot(
  p_snapshot jsonb,
  p_item_id text,
  p_ebay_sku text,
  p_account_fingerprint text,
  p_image_set_hash text,
  p_require_image_match boolean
)
returns boolean
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select jsonb_typeof(p_snapshot) = 'object'
    and p_snapshot->>'version' = 'EBAY_ACTIVE_LISTING_IMAGE_SNAPSHOT_V1'
    and p_snapshot->>'itemId' = p_item_id
    and lower(p_snapshot->>'listingStatus') = 'active'
    and p_snapshot->>'ebaySku' = p_ebay_sku
    and p_snapshot->>'accountFingerprint' = p_account_fingerprint
    and p_snapshot->>'ownershipVerified' = 'true'
    and p_snapshot->>'approvedImageSetHash' = p_image_set_hash
    and (
      p_require_image_match is distinct from true
      or (
        p_snapshot->>'imageSetVerified' = 'true'
        and p_snapshot->>'pictureCount' = '6'
        and p_snapshot->>'verificationMethod' in (
          'EXACT_EXTERNAL_URLS', 'EXACT_PICTURE_URLS', 'PERCEPTUAL_EPS'
        )
      )
    );
$$;

create or replace function public.prepare_ebay_active_listing_image_revision(
  p_revision_id uuid,
  p_base_control_id uuid,
  p_actor uuid,
  p_account_key text,
  p_ebay_item_id text,
  p_idempotency_key_hash text
)
returns setof public.ebay_active_listing_image_revision_executions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_base public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_link public.ebay_manual_listing_links%rowtype;
  v_active public.ebay_active_listings%rowtype;
  v_execution public.ebay_active_listing_image_revision_executions%rowtype;
  v_urls jsonb;
  v_asset_count integer;
  v_request_hash text;
begin
  if p_revision_id is null or p_base_control_id is null or p_actor is null
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_ebay_item_id !~ '^[0-9]{9,20}$'
    or p_idempotency_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_PREPARE_INVALID';
  end if;

  select * into v_revision
  from public.ebay_same_day_pilot_image_revisions
  where id = p_revision_id
  for key share;
  if not found
    or v_revision.base_control_id is distinct from p_base_control_id
    or v_revision.marketplace_account_key is distinct from p_account_key
    or v_revision.created_by is distinct from p_actor
    or v_revision.reviewed_by is distinct from p_actor
    or v_revision.status <> 'APPROVED'
    or v_revision.human_decision <> 'APPROVED'
    or v_revision.revision_version <> 'EBAY_LISTING_IMAGE_REVISION_V1'
    or v_revision.ebay_writes <> 0
    or v_revision.production_changed is distinct from false then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_APPROVED_REVISION_REQUIRED';
  end if;

  select * into v_base
  from public.ebay_same_day_pilot_image_package_runs
  where id = p_base_control_id
  for key share;
  if not found
    or v_base.marketplace_account_key is distinct from p_account_key
    or v_base.created_by is distinct from p_actor
    or v_base.status <> 'APPROVED'
    or v_base.human_decision <> 'APPROVED'
    or v_base.run_id is distinct from v_revision.run_id
    or v_base.candidate_id is distinct from v_revision.candidate_id
    or v_base.listing_package_id is distinct from v_revision.listing_package_id
    or v_base.fact_run_id is distinct from v_revision.fact_run_id then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_BASE_CONTROL_MISMATCH';
  end if;

  select jsonb_agg(to_jsonb(asset.public_url) order by manifest.ordinality),
         count(*)
  into v_urls, v_asset_count
  from jsonb_array_elements(v_revision.asset_manifest)
    with ordinality manifest(value, ordinality)
  join public.ebay_listing_image_assets asset
    on asset.id = (manifest.value->>'assetId')::uuid
  where asset.id = any(v_revision.asset_ids)
    and asset.account_key = p_account_key
    and asset.created_by = p_actor
    and asset.listing_package_id = v_revision.listing_package_id
    and asset.status = 'approved'
    and asset.output_sha256 = manifest.value->>'sha256';
  if v_asset_count <> 6
    or not public.is_exact_six_ebay_revision_urls(v_urls) then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_EXACT_SIX_APPROVED_REQUIRED';
  end if;

  select * into v_package
  from public.ebay_listing_packages
  where id = v_revision.listing_package_id
    and account_key = p_account_key
    and created_by = p_actor
  for key share;
  if not found or v_package.status <> 'approved'
    or v_package.package_data->>'preferredImageRevisionId' <> p_revision_id::text
    or v_package.package_data->'imageUrls' is distinct from v_urls then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_PACKAGE_PROJECTION_MISMATCH';
  end if;

  select link.* into v_link
  from public.ebay_manual_listing_links link
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.id = v_revision.candidate_id
    and link.opportunity_id = candidate.opportunity_id
    and link.candidate_key = candidate.candidate_key
  where link.account_key = p_account_key
    and link.ebay_item_id = p_ebay_item_id
  limit 1;
  if not found
    or v_link.verification_status <> 'verified'
    or v_link.verification_method <> 'EBAY_TRADING_GET_ITEM_READONLY'
    or v_link.connector_listing_status <> 'active'
    or v_link.connector_listing_id is null
    or v_link.connector_ebay_sku is null
    or v_link.created_by is distinct from p_actor then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_VERIFIED_LINK_REQUIRED';
  end if;

  select * into v_active
  from public.ebay_active_listings
  where id = v_link.connector_listing_id
    and account_key = p_account_key
    and ebay_item_id = p_ebay_item_id
  for key share;
  if not found or v_active.listing_status <> 'active'
    or v_active.ebay_sku is distinct from v_link.connector_ebay_sku then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_ACTIVE_LISTING_REQUIRED';
  end if;

  v_request_hash := encode(digest(convert_to(concat_ws('|',
    'EBAY_ACTIVE_LISTING_IMAGE_REVISION_V1', p_revision_id::text,
    p_base_control_id::text, v_revision.listing_package_id::text,
    v_link.id::text, v_active.id::text, p_account_key, p_ebay_item_id,
    v_active.ebay_sku, v_revision.image_set_hash, v_urls::text
  ), 'UTF8'), 'sha256'), 'hex');

  select * into v_execution
  from public.ebay_active_listing_image_revision_executions
  where idempotency_key_hash = p_idempotency_key_hash
  for update;
  if found then
    if v_execution.revision_id is distinct from p_revision_id
      or v_execution.base_control_id is distinct from p_base_control_id
      or v_execution.actor_user_id is distinct from p_actor
      or v_execution.marketplace_account_key is distinct from p_account_key
      or v_execution.ebay_item_id is distinct from p_ebay_item_id
      or v_execution.request_hash is distinct from v_request_hash then
      raise exception 'EBAY_ACTIVE_IMAGE_REVISION_IDEMPOTENCY_MISMATCH';
    end if;
    return next v_execution;
    return;
  end if;

  select * into v_execution
  from public.ebay_active_listing_image_revision_executions
  where revision_id = p_revision_id
  for update;
  if found then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_ALREADY_BOUND';
  end if;

  insert into public.ebay_active_listing_image_revision_executions (
    revision_id, base_control_id, listing_package_id, candidate_id,
    opportunity_id, manual_listing_link_id, active_listing_id, actor_user_id,
    marketplace_account_key, account_fingerprint, ebay_item_id, ebay_sku,
    image_set_hash, image_urls, request_hash, idempotency_key_hash
  ) values (
    v_revision.id, v_base.id, v_package.id, v_revision.candidate_id,
    v_link.opportunity_id, v_link.id, v_active.id, p_actor,
    p_account_key, right(p_account_key, 64), p_ebay_item_id, v_active.ebay_sku,
    v_revision.image_set_hash, v_urls, v_request_hash, p_idempotency_key_hash
  ) returning * into v_execution;
  return next v_execution;
end;
$$;

create or replace function public.claim_ebay_active_listing_image_revision(
  p_execution_id uuid,
  p_actor uuid,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_confirmation text,
  p_claim_token uuid,
  p_preflight_snapshot jsonb
)
returns setof public.ebay_active_listing_image_revision_executions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_execution public.ebay_active_listing_image_revision_executions%rowtype;
begin
  if p_confirmation <> 'APLICAR 6 IMAGENES AL LISTING ACTIVO'
    or p_claim_token is null
    or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
    or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_CONFIRMATION_INVALID';
  end if;
  select * into v_execution
  from public.ebay_active_listing_image_revision_executions
  where id = p_execution_id
  for update;
  if not found
    or v_execution.actor_user_id is distinct from p_actor
    or v_execution.idempotency_key_hash is distinct from p_idempotency_key_hash
    or v_execution.request_hash is distinct from p_request_hash
    or not public.valid_ebay_active_image_snapshot(
      p_preflight_snapshot, v_execution.ebay_item_id, v_execution.ebay_sku,
      v_execution.account_fingerprint, v_execution.image_set_hash, false
    )
    or p_preflight_snapshot->>'imageSetVerified' <> 'false' then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_NOT_CLAIMABLE';
  end if;
  if v_execution.phase <> 'preview_ready' then
    return next v_execution;
    return;
  end if;
  if v_execution.ebay_write_attempt_count <> 0 then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_WRITE_LIMIT_REACHED';
  end if;
  update public.ebay_active_listing_image_revision_executions
  set phase = 'write_in_flight', ebay_write_attempt_count = 1,
      ebay_write_dispatched = true, claim_token = p_claim_token,
      lease_expires_at = clock_timestamp() + interval '2 minutes',
      preflight_snapshot = p_preflight_snapshot,
      write_started_at = clock_timestamp(), last_error_code = null,
      updated_at = clock_timestamp()
  where id = v_execution.id
  returning * into v_execution;
  return next v_execution;
end;
$$;

create or replace function public.ack_ebay_active_listing_image_revision(
  p_execution_id uuid,
  p_actor uuid,
  p_claim_token uuid,
  p_http_status integer,
  p_ack text
)
returns setof public.ebay_active_listing_image_revision_executions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_execution public.ebay_active_listing_image_revision_executions%rowtype;
begin
  if lower(coalesce(p_ack, '')) not in ('success', 'warning') then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_ACK_INVALID';
  end if;
  update public.ebay_active_listing_image_revision_executions
  set phase = 'write_acknowledged', write_http_status = p_http_status,
      write_ack = p_ack, write_acknowledged_at = clock_timestamp(),
      claim_token = null, lease_expires_at = null, last_error_code = null,
      updated_at = clock_timestamp()
  where id = p_execution_id and actor_user_id = p_actor
    and phase = 'write_in_flight' and claim_token = p_claim_token
    and ebay_write_attempt_count = 1 and ebay_write_dispatched = true
  returning * into v_execution;
  if not found then raise exception 'EBAY_ACTIVE_IMAGE_REVISION_ACK_CONFLICT'; end if;
  return next v_execution;
end;
$$;

create or replace function public.fail_ebay_active_listing_image_revision(
  p_execution_id uuid,
  p_actor uuid,
  p_claim_token uuid,
  p_http_status integer,
  p_error_code text
)
returns setof public.ebay_active_listing_image_revision_executions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_execution public.ebay_active_listing_image_revision_executions%rowtype;
begin
  if p_error_code !~ '^[A-Z0-9_]{3,160}$' then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_ERROR_INVALID';
  end if;
  update public.ebay_active_listing_image_revision_executions
  set phase = 'terminal_failure', write_http_status = p_http_status,
      last_error_code = p_error_code, claim_token = null,
      lease_expires_at = null, updated_at = clock_timestamp()
  where id = p_execution_id and actor_user_id = p_actor
    and phase = 'write_in_flight' and claim_token = p_claim_token
    and ebay_write_attempt_count = 1
  returning * into v_execution;
  if not found then raise exception 'EBAY_ACTIVE_IMAGE_REVISION_FAILURE_CONFLICT'; end if;
  return next v_execution;
end;
$$;

create or replace function public.mark_ebay_active_image_revision_unknown(
  p_execution_id uuid,
  p_actor uuid,
  p_claim_token uuid,
  p_http_status integer,
  p_error_code text,
  p_postflight_snapshot jsonb
)
returns setof public.ebay_active_listing_image_revision_executions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_execution public.ebay_active_listing_image_revision_executions%rowtype;
begin
  if p_error_code !~ '^[A-Z0-9_]{3,160}$' then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_ERROR_INVALID';
  end if;
  select * into v_execution
  from public.ebay_active_listing_image_revision_executions
  where id = p_execution_id
  for update;
  if not found or v_execution.actor_user_id is distinct from p_actor
    or v_execution.phase not in (
      'write_in_flight', 'write_acknowledged', 'outcome_unknown'
    )
    or (
      v_execution.phase = 'write_in_flight'
      and not (
        v_execution.claim_token = p_claim_token
        or (p_claim_token is null and v_execution.lease_expires_at <= clock_timestamp())
      )
    ) then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_OUTCOME_CONFLICT';
  end if;
  update public.ebay_active_listing_image_revision_executions
  set phase = 'outcome_unknown', write_http_status = coalesce(
        p_http_status, write_http_status
      ),
      last_error_code = p_error_code,
      postflight_snapshot = coalesce(p_postflight_snapshot, postflight_snapshot),
      reconciled_at = case when p_postflight_snapshot is not null
        then clock_timestamp() else reconciled_at end,
      claim_token = null, lease_expires_at = null,
      updated_at = clock_timestamp()
  where id = v_execution.id
  returning * into v_execution;
  return next v_execution;
end;
$$;

create or replace function public.complete_ebay_active_listing_image_revision(
  p_execution_id uuid,
  p_actor uuid,
  p_claim_token uuid,
  p_postflight_snapshot jsonb,
  p_reconciled boolean
)
returns setof public.ebay_active_listing_image_revision_executions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_execution public.ebay_active_listing_image_revision_executions%rowtype;
begin
  select * into v_execution
  from public.ebay_active_listing_image_revision_executions
  where id = p_execution_id
  for update;
  if not found or v_execution.actor_user_id is distinct from p_actor
    or v_execution.phase not in (
      'preview_ready', 'write_in_flight', 'write_acknowledged',
      'outcome_unknown', 'applied_verified'
    )
    or not public.valid_ebay_active_image_snapshot(
      p_postflight_snapshot, v_execution.ebay_item_id, v_execution.ebay_sku,
      v_execution.account_fingerprint, v_execution.image_set_hash, true
    )
    or (
      v_execution.phase = 'write_in_flight'
      and not (
        v_execution.claim_token = p_claim_token
        or (p_claim_token is null and v_execution.lease_expires_at <= clock_timestamp())
      )
    ) then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_VERIFICATION_CONFLICT';
  end if;
  if v_execution.phase = 'applied_verified' then
    return next v_execution;
    return;
  end if;
  update public.ebay_active_listing_image_revision_executions
  set phase = 'applied_verified', postflight_snapshot = p_postflight_snapshot,
      reconciled = coalesce(p_reconciled, false),
      reconciled_at = case when coalesce(p_reconciled, false)
        then clock_timestamp() else reconciled_at end,
      applied_verified_at = clock_timestamp(), last_error_code = null,
      claim_token = null, lease_expires_at = null,
      updated_at = clock_timestamp()
  where id = v_execution.id
  returning * into v_execution;
  return next v_execution;
end;
$$;

alter table public.ebay_active_listing_image_revision_executions
  enable row level security;
alter table public.ebay_active_listing_image_revision_executions
  force row level security;
revoke all on table public.ebay_active_listing_image_revision_executions
  from anon, authenticated;
revoke all on table public.ebay_active_listing_image_revision_executions
  from public, service_role;
grant select on table public.ebay_active_listing_image_revision_executions
  to service_role;

revoke all on function public.is_exact_six_ebay_revision_urls(jsonb)
  from public, anon, authenticated;
revoke all on function public.valid_ebay_active_image_snapshot(
  jsonb,text,text,text,text,boolean
) from public, anon, authenticated;
revoke all on function public.prepare_ebay_active_listing_image_revision(
  uuid,uuid,uuid,text,text,text
) from public, anon, authenticated;
revoke all on function public.claim_ebay_active_listing_image_revision(
  uuid,uuid,text,text,text,uuid,jsonb
) from public, anon, authenticated;
revoke all on function public.ack_ebay_active_listing_image_revision(
  uuid,uuid,uuid,integer,text
) from public, anon, authenticated;
revoke all on function public.fail_ebay_active_listing_image_revision(
  uuid,uuid,uuid,integer,text
) from public, anon, authenticated;
revoke all on function public.mark_ebay_active_image_revision_unknown(
  uuid,uuid,uuid,integer,text,jsonb
) from public, anon, authenticated;
revoke all on function public.complete_ebay_active_listing_image_revision(
  uuid,uuid,uuid,jsonb,boolean
) from public, anon, authenticated;

grant execute on function public.prepare_ebay_active_listing_image_revision(
  uuid,uuid,uuid,text,text,text
) to service_role;
grant execute on function public.claim_ebay_active_listing_image_revision(
  uuid,uuid,text,text,text,uuid,jsonb
) to service_role;
grant execute on function public.ack_ebay_active_listing_image_revision(
  uuid,uuid,uuid,integer,text
) to service_role;
grant execute on function public.fail_ebay_active_listing_image_revision(
  uuid,uuid,uuid,integer,text
) to service_role;
grant execute on function public.mark_ebay_active_image_revision_unknown(
  uuid,uuid,uuid,integer,text,jsonb
) to service_role;
grant execute on function public.complete_ebay_active_listing_image_revision(
  uuid,uuid,uuid,jsonb,boolean
) to service_role;

comment on table public.ebay_active_listing_image_revision_executions is
  'Append-only, one-attempt ledger for applying one APPROVED six-image revision to one ownership-verified ACTIVE eBay listing.';

notify pgrst, 'reload schema';
