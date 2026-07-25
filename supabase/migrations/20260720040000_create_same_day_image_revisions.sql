-- Append-only image revisions for an already approved same-day image control.
-- A revision may replace only the preferred image projection of the internal
-- listing package. It never mutates the pilot state, its base control/handoff,
-- or any eBay resource.

create table if not exists public.ebay_same_day_pilot_image_revisions (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  base_control_id uuid not null references
    public.ebay_same_day_pilot_image_package_runs(id) on delete restrict,
  run_id uuid not null references public.ebay_same_day_pilot_runs(id) on delete restrict,
  candidate_id uuid not null references
    public.ebay_same_day_pilot_candidates(id) on delete restrict,
  listing_package_id uuid not null references
    public.ebay_listing_packages(id) on delete restrict,
  fact_run_id uuid not null references
    public.marketplace_product_fact_runs(id) on delete restrict,
  revision_number integer not null,
  revision_version text not null default 'EBAY_LISTING_IMAGE_REVISION_V1',
  status text not null default 'CLAIMED',
  attempt integer not null default 1,
  idempotency_key_hash text not null unique,
  lease_token uuid null,
  lease_expires_at timestamptz null,
  asset_ids uuid[] null,
  reused_asset_ids uuid[] not null default '{}'::uuid[],
  asset_manifest jsonb null,
  image_set_hash text null,
  authorized_source_count integer not null default 0,
  last_error_code text null,
  claimed_at timestamptz not null default now(),
  completed_at timestamptz null,
  failed_at timestamptz null,
  reviewed_at timestamptz null,
  reviewed_by uuid null references auth.users(id) on delete restrict,
  human_decision text null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  openai_calls integer not null default 0,
  competitor_image_count integer not null default 0,
  ebay_writes integer not null default 0,
  production_changed boolean not null default false,
  constraint ebay_same_day_image_revision_account_check check (
    marketplace_account_key <> 'default'
    and marketplace_account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
  ),
  constraint ebay_same_day_image_revision_number_check check (
    revision_number between 1 and 1000
  ),
  constraint ebay_same_day_image_revision_version_check check (
    revision_version = 'EBAY_LISTING_IMAGE_REVISION_V1'
  ),
  constraint ebay_same_day_image_revision_status_check check (
    status in (
      'CLAIMED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'PENDING_REVIEW',
      'APPROVED', 'REJECTED'
    )
  ),
  constraint ebay_same_day_image_revision_attempt_check check (
    attempt between 1 and 2
  ),
  constraint ebay_same_day_image_revision_idempotency_check check (
    idempotency_key_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_same_day_image_revision_lease_check check (
    (
      status = 'CLAIMED' and lease_token is not null
      and lease_expires_at is not null and lease_expires_at > claimed_at
    ) or (
      status <> 'CLAIMED' and lease_token is null and lease_expires_at is null
    )
  ),
  constraint ebay_same_day_image_revision_output_check check (
    (
      status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED')
      and cardinality(asset_ids) = 6
      and jsonb_typeof(asset_manifest) = 'array'
      and jsonb_array_length(asset_manifest) = 6
      and image_set_hash ~ '^[0-9a-f]{64}$'
      and authorized_source_count between 1 and 3
      and completed_at is not null
    ) or (
      status not in ('PENDING_REVIEW', 'APPROVED', 'REJECTED')
      and asset_ids is null and asset_manifest is null
      and image_set_hash is null and authorized_source_count = 0
      and completed_at is null
    )
  ),
  constraint ebay_same_day_image_revision_failure_check check (
    (
      status in ('FAILED_RETRYABLE', 'FAILED_FINAL')
      and last_error_code ~ '^[A-Z0-9_:.-]{3,200}$'
      and failed_at is not null
    ) or (
      status not in ('FAILED_RETRYABLE', 'FAILED_FINAL')
      and last_error_code is null and failed_at is null
    )
  ),
  constraint ebay_same_day_image_revision_review_check check (
    (
      status in ('APPROVED', 'REJECTED')
      and reviewed_at is not null and reviewed_by is not null
      and human_decision = status
    ) or (
      status not in ('APPROVED', 'REJECTED')
      and reviewed_at is null and reviewed_by is null
      and human_decision is null
    )
  ),
  constraint ebay_same_day_image_revision_safety_check check (
    openai_calls = 0 and competitor_image_count = 0
    and ebay_writes = 0 and production_changed = false
  ),
  constraint ebay_same_day_image_revision_base_number_unique unique (
    base_control_id, revision_number
  )
);

create index if not exists ebay_same_day_image_revision_package_idx
  on public.ebay_same_day_pilot_image_revisions(
    listing_package_id, status, created_at desc
  );
create index if not exists ebay_same_day_image_revision_base_idx
  on public.ebay_same_day_pilot_image_revisions(
    base_control_id, revision_number desc
  );

create or replace function public.enforce_same_day_pilot_image_revision_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and (
    new.marketplace_account_key is distinct from old.marketplace_account_key
    or new.created_by is distinct from old.created_by
    or new.base_control_id is distinct from old.base_control_id
    or new.run_id is distinct from old.run_id
    or new.candidate_id is distinct from old.candidate_id
    or new.listing_package_id is distinct from old.listing_package_id
    or new.fact_run_id is distinct from old.fact_run_id
    or new.revision_number is distinct from old.revision_number
    or new.revision_version is distinct from old.revision_version
    or new.idempotency_key_hash is distinct from old.idempotency_key_hash
    or new.created_at is distinct from old.created_at
    or new.openai_calls is distinct from old.openai_calls
    or new.competitor_image_count is distinct from old.competitor_image_count
    or new.ebay_writes is distinct from old.ebay_writes
    or new.production_changed is distinct from old.production_changed
  ) then
    raise exception 'SAME_DAY_IMAGE_REVISION_SCOPE_IMMUTABLE';
  end if;

  perform 1
  from public.ebay_same_day_pilot_image_package_runs base_control
  join public.ebay_same_day_pilot_runs pilot_run
    on pilot_run.id = base_control.run_id
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.id = base_control.candidate_id
    and candidate.run_id = pilot_run.id
  join public.ebay_listing_packages package
    on package.id = base_control.listing_package_id
  where base_control.id = new.base_control_id
    and base_control.status = 'APPROVED'
    and base_control.marketplace_account_key = new.marketplace_account_key
    and base_control.created_by = new.created_by
    and base_control.run_id = new.run_id
    and base_control.candidate_id = new.candidate_id
    and base_control.listing_package_id = new.listing_package_id
    and base_control.fact_run_id = new.fact_run_id
    and pilot_run.marketplace_account_key = new.marketplace_account_key
    and pilot_run.marketplace = 'EBAY_US'
    and pilot_run.created_by = new.created_by
    and package.account_key = new.marketplace_account_key
    and package.created_by = new.created_by
    and package.status <> 'archived';
  if not found then raise exception 'SAME_DAY_IMAGE_REVISION_BASE_INVALID'; end if;
  return new;
end;
$$;

create or replace function public.reject_same_day_pilot_image_revision_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'SAME_DAY_IMAGE_REVISION_APPEND_ONLY';
end;
$$;

drop trigger if exists enforce_same_day_pilot_image_revision_scope
  on public.ebay_same_day_pilot_image_revisions;
create trigger enforce_same_day_pilot_image_revision_scope
before insert or update of marketplace_account_key, created_by, base_control_id,
  run_id, candidate_id, listing_package_id, fact_run_id, revision_number,
  revision_version, idempotency_key_hash, created_at, openai_calls,
  competitor_image_count, ebay_writes, production_changed
on public.ebay_same_day_pilot_image_revisions
for each row execute function public.enforce_same_day_pilot_image_revision_scope();

drop trigger if exists reject_same_day_pilot_image_revision_delete
  on public.ebay_same_day_pilot_image_revisions;
create trigger reject_same_day_pilot_image_revision_delete
before delete on public.ebay_same_day_pilot_image_revisions
for each row execute function public.reject_same_day_pilot_image_revision_delete();

create or replace function public.claim_ebay_same_day_pilot_image_revision(
  p_account_key text,
  p_actor uuid,
  p_base_control_id uuid,
  p_idempotency_key_hash text,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_number integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_account_key is null or p_account_key = 'default'
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_actor is null or p_base_control_id is null
    or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
    or p_lease_token is null then
    raise exception 'SAME_DAY_IMAGE_REVISION_CLAIM_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_account_key || ':' || p_base_control_id::text, 0
  ));
  select control.* into v_base
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = p_base_control_id
    and control.marketplace_account_key = p_account_key
    and control.created_by = p_actor
    and control.status = 'APPROVED'
    and cardinality(control.asset_ids) = 6
    and control.ebay_writes = 0
    and control.production_changed = false
  for key share;
  if not found then raise exception 'SAME_DAY_IMAGE_REVISION_BASE_NOT_APPROVED'; end if;
  perform public.assert_ebay_listing_package_account_scope(
    v_base.listing_package_id, p_account_key, p_actor
  );

  select revision.* into v_revision
  from public.ebay_same_day_pilot_image_revisions revision
  where revision.idempotency_key_hash = p_idempotency_key_hash
  for update;
  if found then
    if v_revision.marketplace_account_key <> p_account_key
      or v_revision.created_by <> p_actor
      or v_revision.base_control_id <> p_base_control_id
      or v_revision.run_id <> v_base.run_id
      or v_revision.candidate_id <> v_base.candidate_id
      or v_revision.listing_package_id <> v_base.listing_package_id
      or v_revision.fact_run_id <> v_base.fact_run_id then
      raise exception 'SAME_DAY_IMAGE_REVISION_IDEMPOTENCY_CONFLICT';
    end if;
    if (
      v_revision.status = 'FAILED_RETRYABLE'
      or (
        v_revision.status = 'CLAIMED'
        and v_revision.lease_expires_at <= v_now
      )
    ) and v_revision.attempt < 2 then
      update public.ebay_same_day_pilot_image_revisions revision
      set status = 'CLAIMED',
          attempt = revision.attempt + 1,
          lease_token = p_lease_token,
          lease_expires_at = v_now + interval '4 minutes',
          claimed_at = v_now,
          last_error_code = null,
          failed_at = null,
          updated_at = v_now
      where revision.id = v_revision.id
      returning revision.* into v_revision;
      return jsonb_build_object(
        'revisionId', v_revision.id, 'revisionNumber', v_revision.revision_number,
        'status', v_revision.status, 'claimed', true,
        'attempt', v_revision.attempt
      );
    end if;
    return jsonb_build_object(
      'revisionId', v_revision.id, 'revisionNumber', v_revision.revision_number,
      'status', v_revision.status, 'claimed', false,
      'attempt', v_revision.attempt
    );
  end if;

  select coalesce(max(revision.revision_number), 0) + 1 into v_number
  from public.ebay_same_day_pilot_image_revisions revision
  where revision.base_control_id = p_base_control_id;
  insert into public.ebay_same_day_pilot_image_revisions (
    marketplace_account_key, created_by, base_control_id, run_id,
    candidate_id, listing_package_id, fact_run_id, revision_number,
    idempotency_key_hash, lease_token, lease_expires_at
  ) values (
    p_account_key, p_actor, p_base_control_id, v_base.run_id,
    v_base.candidate_id, v_base.listing_package_id, v_base.fact_run_id,
    v_number, p_idempotency_key_hash, p_lease_token,
    v_now + interval '4 minutes'
  ) returning * into v_revision;
  return jsonb_build_object(
    'revisionId', v_revision.id, 'revisionNumber', v_revision.revision_number,
    'status', v_revision.status, 'claimed', true, 'attempt', 1
  );
end;
$$;

create or replace function public.create_ebay_same_day_image_revision_asset_set(
  p_revision_id uuid,
  p_account_key text,
  p_actor uuid,
  p_lease_token uuid,
  p_opportunity_id uuid,
  p_candidate_key text,
  p_assets jsonb
)
returns setof public.ebay_listing_image_assets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_asset_json jsonb;
  v_asset public.ebay_listing_image_assets%rowtype;
  v_invalid integer;
begin
  if p_revision_id is null or p_actor is null or p_lease_token is null
    or p_account_key is null or nullif(trim(p_candidate_key), '') is null
    or jsonb_typeof(p_assets) <> 'array'
    or jsonb_array_length(p_assets) <> 6 then
    raise exception 'SAME_DAY_IMAGE_REVISION_ASSET_SET_INVALID';
  end if;
  select revision.* into v_revision
  from public.ebay_same_day_pilot_image_revisions revision
  where revision.id = p_revision_id
    and revision.marketplace_account_key = p_account_key
    and revision.created_by = p_actor
    and revision.status = 'CLAIMED'
    and revision.lease_token = p_lease_token
    and revision.lease_expires_at > clock_timestamp()
  for update;
  if not found then raise exception 'SAME_DAY_IMAGE_REVISION_LEASE_INVALID'; end if;

  select count(*) filter (where
    jsonb_typeof(item.value) <> 'object'
    or coalesce(item.value ->> 'id', '')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(item.value ->> 'output_sha256', '') !~ '^[0-9a-f]{64}$'
    or coalesce(item.value ->> 'source_sha256', '') !~ '^[0-9a-f]{64}$'
    or coalesce(item.value -> 'transformation' ->> 'sameDayImageRevisionId', '')
      <> p_revision_id::text
    or coalesce(item.value -> 'transformation' ->> 'slot', '') not in (
      'MAIN_WHITE_BACKGROUND', 'PACK_AND_COUNT', 'KEY_FEATURES',
      'SIZE_AND_CONTENT', 'USE_CONTEXT', 'PACKAGE_CONTENTS'
    )
    or nullif(item.value -> 'transformation' ->> 'layoutId', '') is null
  ) into v_invalid
  from jsonb_array_elements(p_assets) item(value);
  if v_invalid <> 0 or (
    select count(distinct item.value -> 'transformation' ->> 'slot')
    from jsonb_array_elements(p_assets) item(value)
  ) <> 6 or (
    select count(distinct item.value -> 'transformation' ->> 'layoutId')
    from jsonb_array_elements(p_assets) item(value)
  ) <> 6 then
    raise exception 'SAME_DAY_IMAGE_REVISION_ASSET_EVIDENCE_INVALID';
  end if;

  for v_asset_json in select value from jsonb_array_elements(p_assets)
  loop
    select asset.* into v_asset
    from public.ebay_listing_image_assets asset
    where asset.account_key = p_account_key
      and asset.created_by = p_actor
      and asset.listing_package_id = v_revision.listing_package_id
      and asset.output_sha256 = v_asset_json ->> 'output_sha256'
    limit 1
    for update;
    if found then
      if v_asset.status = 'rejected'
        or v_asset.candidate_key <> p_candidate_key
        or v_asset.opportunity_id is distinct from p_opportunity_id
        or v_asset.source_sha256 <> v_asset_json ->> 'source_sha256'
        or v_asset.output_width <> 1600 or v_asset.output_height <> 1600
        or v_asset.rights_evidence_confirmed is distinct from true
        or v_asset.transformation_version
          <> v_asset_json ->> 'transformation_version'
        or v_asset.transformation ->> 'slot'
          <> v_asset_json -> 'transformation' ->> 'slot'
        or v_asset.qa_result ->> 'automaticStatus' <> 'PASSED'
        or v_asset.transformation ->> 'generativeAiUsed' <> 'false'
        or (
          v_asset.status = 'pending_review'
          and v_asset.transformation ->> 'sameDayImageRevisionId'
            <> p_revision_id::text
        ) then
        raise exception 'SAME_DAY_IMAGE_REVISION_ASSET_REUSE_CONFLICT';
      end if;
      return next v_asset;
    else
      select created.* into v_asset
      from public.ebay_create_pending_listing_image(
        v_revision.listing_package_id, p_account_key, p_actor,
        p_opportunity_id, p_candidate_key, v_asset_json
      ) created
      limit 1;
      if v_asset.id is null then
        raise exception 'SAME_DAY_IMAGE_REVISION_ASSET_CREATE_FAILED';
      end if;
      return next v_asset;
    end if;
  end loop;
end;
$$;

create or replace function public.complete_ebay_same_day_image_revision(
  p_revision_id uuid,
  p_actor uuid,
  p_lease_token uuid,
  p_asset_ids uuid[],
  p_asset_manifest jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_manifest_ids uuid[];
  v_reused_ids uuid[];
  v_source_count integer;
  v_invalid integer;
  v_hash text;
  v_now timestamptz := clock_timestamp();
begin
  if p_revision_id is null or p_actor is null or p_lease_token is null
    or cardinality(p_asset_ids) <> 6
    or (select count(distinct id) from unnest(p_asset_ids) requested(id)) <> 6
    or jsonb_typeof(p_asset_manifest) <> 'array'
    or jsonb_array_length(p_asset_manifest) <> 6 then
    raise exception 'SAME_DAY_IMAGE_REVISION_COMPLETION_INVALID';
  end if;
  select revision.* into v_revision
  from public.ebay_same_day_pilot_image_revisions revision
  where revision.id = p_revision_id and revision.created_by = p_actor
  for update;
  if not found then raise exception 'SAME_DAY_IMAGE_REVISION_NOT_FOUND'; end if;
  if v_revision.status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED') then
    if v_revision.asset_ids @> p_asset_ids and v_revision.asset_ids <@ p_asset_ids
      and v_revision.asset_manifest = p_asset_manifest then
      return jsonb_build_object(
        'revisionId', v_revision.id, 'status', v_revision.status,
        'assetIds', v_revision.asset_ids,
        'imageSetHash', v_revision.image_set_hash
      );
    end if;
    raise exception 'SAME_DAY_IMAGE_REVISION_COMPLETION_CONFLICT';
  end if;
  if v_revision.status <> 'CLAIMED' or v_revision.lease_token <> p_lease_token
    or v_revision.lease_expires_at <= v_now then
    raise exception 'SAME_DAY_IMAGE_REVISION_LEASE_INVALID';
  end if;

  select array_agg((item.value ->> 'assetId')::uuid order by item.ordinality),
         count(distinct item.value ->> 'sourceSha256')
  into v_manifest_ids, v_source_count
  from jsonb_array_elements(p_asset_manifest) with ordinality item(value, ordinality)
  where coalesce(item.value ->> 'assetId', '')
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(item.value ->> 'sourceSha256', '') ~ '^[0-9a-f]{64}$'
    and coalesce(item.value ->> 'outputSha256', '') ~ '^[0-9a-f]{64}$'
    and nullif(item.value ->> 'layoutId', '') is not null
    and coalesce(item.value ->> 'slot', '') in (
      'MAIN_WHITE_BACKGROUND', 'PACK_AND_COUNT', 'KEY_FEATURES',
      'SIZE_AND_CONTENT', 'USE_CONTEXT', 'PACKAGE_CONTENTS'
    );
  if cardinality(v_manifest_ids) <> 6 or v_source_count not between 1 and 3
    or (select count(distinct item.value ->> 'slot')
        from jsonb_array_elements(p_asset_manifest) item(value)) <> 6
    or (select count(distinct item.value ->> 'layoutId')
        from jsonb_array_elements(p_asset_manifest) item(value)) <> 6
    or not (v_manifest_ids @> p_asset_ids)
    or not (v_manifest_ids <@ p_asset_ids) then
    raise exception 'SAME_DAY_IMAGE_REVISION_MANIFEST_INVALID';
  end if;

  select count(*) filter (where
    asset.id is null
    or asset.listing_package_id <> v_revision.listing_package_id
    or asset.account_key <> v_revision.marketplace_account_key
    or asset.created_by <> p_actor
    or asset.status not in ('pending_review', 'approved')
    or asset.output_width <> 1600 or asset.output_height <> 1600
    or asset.rights_evidence_confirmed is distinct from true
    or asset.output_sha256 <> item.value ->> 'outputSha256'
    or asset.source_sha256 <> item.value ->> 'sourceSha256'
    or asset.transformation ->> 'slot' <> item.value ->> 'slot'
    or asset.transformation ->> 'generativeAiUsed' <> 'false'
    or asset.qa_result ->> 'automaticStatus' <> 'PASSED'
  ) into v_invalid
  from jsonb_array_elements(p_asset_manifest) item(value)
  left join public.ebay_listing_image_assets asset
    on asset.id = (item.value ->> 'assetId')::uuid;
  if v_invalid <> 0 then
    raise exception 'SAME_DAY_IMAGE_REVISION_SET_UNSAFE';
  end if;

  select coalesce(array_agg(asset.id order by requested.ordinality), '{}'::uuid[])
  into v_reused_ids
  from unnest(p_asset_ids) with ordinality requested(id, ordinality)
  join public.ebay_listing_image_assets asset on asset.id = requested.id
  where asset.transformation ->> 'sameDayImageRevisionId'
    is distinct from p_revision_id::text;
  v_hash := encode(digest(p_asset_manifest::text, 'sha256'), 'hex');
  update public.ebay_same_day_pilot_image_revisions revision
  set status = 'PENDING_REVIEW', asset_ids = p_asset_ids,
      reused_asset_ids = v_reused_ids, asset_manifest = p_asset_manifest,
      image_set_hash = v_hash, authorized_source_count = v_source_count,
      completed_at = v_now, lease_token = null, lease_expires_at = null,
      updated_at = v_now
  where revision.id = p_revision_id and revision.status = 'CLAIMED'
    and revision.lease_token = p_lease_token;
  if not found then raise exception 'SAME_DAY_IMAGE_REVISION_COMPLETION_CONFLICT'; end if;
  return jsonb_build_object(
    'revisionId', p_revision_id, 'status', 'PENDING_REVIEW',
    'assetIds', p_asset_ids, 'imageSetHash', v_hash,
    'reusedAssetIds', v_reused_ids, 'ebayWrites', 0
  );
end;
$$;

create or replace function public.fail_ebay_same_day_image_revision(
  p_revision_id uuid,
  p_actor uuid,
  p_lease_token uuid,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_status text;
  v_now timestamptz := clock_timestamp();
begin
  if p_revision_id is null or p_actor is null or p_lease_token is null
    or p_error_code !~ '^[A-Z0-9_:.-]{3,200}$' then
    raise exception 'SAME_DAY_IMAGE_REVISION_FAILURE_INVALID';
  end if;
  select revision.* into v_revision
  from public.ebay_same_day_pilot_image_revisions revision
  where revision.id = p_revision_id and revision.created_by = p_actor
    and revision.status = 'CLAIMED' and revision.lease_token = p_lease_token
  for update;
  if not found then raise exception 'SAME_DAY_IMAGE_REVISION_FAILURE_CONFLICT'; end if;
  v_status := case when v_revision.attempt >= 2
    then 'FAILED_FINAL' else 'FAILED_RETRYABLE' end;
  update public.ebay_same_day_pilot_image_revisions revision
  set status = v_status, last_error_code = p_error_code, failed_at = v_now,
      lease_token = null, lease_expires_at = null, updated_at = v_now
  where revision.id = p_revision_id;
  return jsonb_build_object(
    'revisionId', p_revision_id, 'status', v_status, 'ebayWrites', 0
  );
end;
$$;

create or replace function public.review_ebay_same_day_image_revision(
  p_revision_id uuid,
  p_account_key text,
  p_actor uuid,
  p_decision text,
  p_confirmed boolean,
  p_publication_manifest jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_item jsonb;
  v_asset public.ebay_listing_image_assets%rowtype;
  v_asset_id uuid;
  v_manifest_ids uuid[] := '{}'::uuid[];
  v_image_urls jsonb := '[]'::jsonb;
  v_image_manifest jsonb := '[]'::jsonb;
  v_history jsonb;
  v_now timestamptz := clock_timestamp();
  v_final_status text;
begin
  if p_revision_id is null or p_actor is null
    or p_account_key is null or p_confirmed is distinct from true
    or p_decision not in ('APPROVE', 'REJECT')
    or jsonb_typeof(p_publication_manifest) <> 'array' then
    raise exception 'SAME_DAY_IMAGE_REVISION_REVIEW_INVALID';
  end if;
  v_final_status := case when p_decision = 'APPROVE'
    then 'APPROVED' else 'REJECTED' end;
  select revision.* into v_revision
  from public.ebay_same_day_pilot_image_revisions revision
  where revision.id = p_revision_id
    and revision.marketplace_account_key = p_account_key
    and revision.created_by = p_actor
  for update;
  if not found then raise exception 'SAME_DAY_IMAGE_REVISION_NOT_FOUND'; end if;
  if v_revision.status in ('APPROVED', 'REJECTED') then
    if v_revision.status <> v_final_status then
      raise exception 'SAME_DAY_IMAGE_REVISION_REVIEW_CONFLICT';
    end if;
    return jsonb_build_object(
      'revisionId', v_revision.id, 'status', v_revision.status,
      'preferred', coalesce((select package.package_data ->> 'preferredImageRevisionId'
        from public.ebay_listing_packages package
        where package.id = v_revision.listing_package_id), '') = v_revision.id::text,
      'ebayWrites', 0
    );
  end if;
  if v_revision.status <> 'PENDING_REVIEW' then
    raise exception 'SAME_DAY_IMAGE_REVISION_NOT_REVIEWABLE';
  end if;

  if p_decision = 'APPROVE' then
    if jsonb_array_length(p_publication_manifest) <> 6 then
      raise exception 'SAME_DAY_IMAGE_REVISION_EXACT_SIX_REQUIRED';
    end if;
    for v_item in select value from jsonb_array_elements(p_publication_manifest)
    loop
      if coalesce(v_item ->> 'asset_id', '')
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(v_item ->> 'public_url', '') !~ '^https://[^[:space:][:cntrl:]]+$'
        or coalesce(v_item ->> 'published_storage_path', '') !~ (
          '^' || p_actor::text || '/[0-9a-f]{24}/'
          || (v_item ->> 'asset_id') || '[.]jpg$'
        )
        or strpos(
          v_item ->> 'public_url',
          '/storage/v1/object/public/ebay-listing-images/'
          || (v_item ->> 'published_storage_path')
        ) = 0 then
        raise exception 'SAME_DAY_IMAGE_REVISION_PUBLICATION_INVALID';
      end if;
      v_manifest_ids := array_append(
        v_manifest_ids, (v_item ->> 'asset_id')::uuid
      );
    end loop;
    if (select count(distinct id) from unnest(v_manifest_ids) requested(id)) <> 6
      or not (v_manifest_ids @> v_revision.asset_ids)
      or not (v_manifest_ids <@ v_revision.asset_ids) then
      raise exception 'SAME_DAY_IMAGE_REVISION_PUBLICATION_SCOPE_INVALID';
    end if;

    for v_item in select value from jsonb_array_elements(p_publication_manifest)
    loop
      v_asset_id := (v_item ->> 'asset_id')::uuid;
      select asset.* into v_asset
      from public.ebay_listing_image_assets asset
      where asset.id = v_asset_id
        and asset.account_key = p_account_key
        and asset.created_by = p_actor
        and asset.listing_package_id = v_revision.listing_package_id
      for update;
      if not found or v_asset.status = 'rejected' then
        raise exception 'SAME_DAY_IMAGE_REVISION_ASSET_NOT_REVIEWABLE';
      end if;
      if v_asset.status = 'approved' then
        if v_asset.public_url <> v_item ->> 'public_url'
          or v_asset.published_storage_path
            <> v_item ->> 'published_storage_path' then
          raise exception 'SAME_DAY_IMAGE_REVISION_APPROVED_ASSET_CONFLICT';
        end if;
      else
        update public.ebay_listing_image_assets asset
        set status = 'approved', approved_at = v_now, approved_by = p_actor,
            rejected_at = null,
            public_url = v_item ->> 'public_url',
            published_storage_path = v_item ->> 'published_storage_path',
            updated_at = v_now
        where asset.id = v_asset_id and asset.status = 'pending_review';
        if not found then
          raise exception 'SAME_DAY_IMAGE_REVISION_ASSET_REVIEW_CONFLICT';
        end if;
      end if;
    end loop;

    update public.ebay_same_day_pilot_image_revisions revision
    set status = 'APPROVED', reviewed_at = v_now, reviewed_by = p_actor,
        human_decision = 'APPROVED', updated_at = v_now
    where revision.id = v_revision.id and revision.status = 'PENDING_REVIEW';
    if not found then raise exception 'SAME_DAY_IMAGE_REVISION_REVIEW_CONFLICT'; end if;

    for v_item in select value from jsonb_array_elements(v_revision.asset_manifest)
    loop
      v_asset_id := (v_item ->> 'assetId')::uuid;
      select asset.* into v_asset
      from public.ebay_listing_image_assets asset
      where asset.id = v_asset_id and asset.status = 'approved';
      if not found then raise exception 'SAME_DAY_IMAGE_REVISION_APPROVAL_ATOMICITY_FAILED'; end if;
      v_image_urls := v_image_urls || to_jsonb(v_asset.public_url);
      v_image_manifest := v_image_manifest || jsonb_build_array(jsonb_build_object(
        'assetId', v_asset.id, 'url', v_asset.public_url,
        'role', v_asset.asset_role, 'slot', v_item ->> 'slot',
        'layoutId', v_item ->> 'layoutId',
        'sha256', v_asset.output_sha256,
        'transformationVersion', v_asset.transformation_version,
        'automaticQa', v_asset.qa_result ->> 'automaticStatus',
        'humanApprovedAt', v_asset.approved_at,
        'reusedFromHistory', v_asset.id = any(v_revision.reused_asset_ids)
      ));
    end loop;
    if jsonb_array_length(v_image_urls) <> 6
      or jsonb_array_length(v_image_manifest) <> 6 then
      raise exception 'SAME_DAY_IMAGE_REVISION_APPROVAL_ATOMICITY_FAILED';
    end if;

    select package.* into v_package
    from public.ebay_listing_packages package
    where package.id = v_revision.listing_package_id
      and package.account_key = p_account_key
      and package.created_by = p_actor
      and package.status <> 'archived'
    for update;
    if not found then raise exception 'SAME_DAY_IMAGE_REVISION_PACKAGE_NOT_FOUND'; end if;
    v_history := coalesce(v_package.package_data -> 'imageRevisionHistory', '[]'::jsonb);
    if jsonb_typeof(v_history) <> 'array' then
      raise exception 'SAME_DAY_IMAGE_REVISION_HISTORY_INVALID';
    end if;
    v_history := v_history || jsonb_build_array(jsonb_build_object(
      'revisionId', v_revision.id,
      'baseControlId', v_revision.base_control_id,
      'revisionNumber', v_revision.revision_number,
      'imageSetHash', v_revision.image_set_hash,
      'approvedAt', v_now,
      'assetIds', to_jsonb(v_revision.asset_ids),
      'imageUrls', v_image_urls,
      'previousPreferredImageRevisionId',
        v_package.package_data ->> 'preferredImageRevisionId',
      'previousImageUrls', coalesce(v_package.package_data -> 'imageUrls', '[]'::jsonb)
    ));
    update public.ebay_listing_packages package
    set package_data = coalesce(package.package_data, '{}'::jsonb)
          || jsonb_build_object(
            'preferredImageRevisionId', v_revision.id,
            'imageUrls', v_image_urls,
            'imageAssetManifest', v_image_manifest,
            'imageRevisionHistory', v_history
          ),
        updated_at = v_now
    where package.id = v_revision.listing_package_id
      and package.account_key = p_account_key and package.created_by = p_actor;
  else
    if jsonb_array_length(p_publication_manifest) <> 0 then
      raise exception 'SAME_DAY_IMAGE_REVISION_REJECT_PUBLICATION_INVALID';
    end if;
    update public.ebay_listing_image_assets asset
    set status = 'rejected', approved_at = null, approved_by = null,
        rejected_at = v_now, public_url = null,
        published_storage_path = null, updated_at = v_now
    where asset.id = any(v_revision.asset_ids)
      and asset.account_key = p_account_key and asset.created_by = p_actor
      and asset.listing_package_id = v_revision.listing_package_id
      and asset.status = 'pending_review';
    update public.ebay_same_day_pilot_image_revisions revision
    set status = 'REJECTED', reviewed_at = v_now, reviewed_by = p_actor,
        human_decision = 'REJECTED', updated_at = v_now
    where revision.id = v_revision.id and revision.status = 'PENDING_REVIEW';
    if not found then raise exception 'SAME_DAY_IMAGE_REVISION_REVIEW_CONFLICT'; end if;
  end if;

  return jsonb_build_object(
    'revisionId', v_revision.id, 'status', v_final_status,
    'imageUrls', case when p_decision = 'APPROVE'
      then v_image_urls else '[]'::jsonb end,
    'ebayWrites', 0, 'productionChanged', false
  );
end;
$$;

alter table public.ebay_same_day_pilot_image_revisions enable row level security;
alter table public.ebay_same_day_pilot_image_revisions force row level security;
revoke all on table public.ebay_same_day_pilot_image_revisions
  from anon, authenticated;
revoke all on table public.ebay_same_day_pilot_image_revisions
  from public, service_role;
grant select on table public.ebay_same_day_pilot_image_revisions to service_role;

revoke all on function public.enforce_same_day_pilot_image_revision_scope()
  from public, anon, authenticated, service_role;
revoke all on function public.reject_same_day_pilot_image_revision_delete()
  from public, anon, authenticated, service_role;
revoke all on function public.claim_ebay_same_day_pilot_image_revision(
  text, uuid, uuid, text, uuid
) from public, anon, authenticated;
revoke all on function public.create_ebay_same_day_image_revision_asset_set(
  uuid, text, uuid, uuid, uuid, text, jsonb
) from public, anon, authenticated;
revoke all on function public.complete_ebay_same_day_image_revision(
  uuid, uuid, uuid, uuid[], jsonb
) from public, anon, authenticated;
revoke all on function public.fail_ebay_same_day_image_revision(
  uuid, uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.review_ebay_same_day_image_revision(
  uuid, text, uuid, text, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.claim_ebay_same_day_pilot_image_revision(
  text, uuid, uuid, text, uuid
) to service_role;
grant execute on function public.create_ebay_same_day_image_revision_asset_set(
  uuid, text, uuid, uuid, uuid, text, jsonb
) to service_role;
grant execute on function public.complete_ebay_same_day_image_revision(
  uuid, uuid, uuid, uuid[], jsonb
) to service_role;
grant execute on function public.fail_ebay_same_day_image_revision(
  uuid, uuid, uuid, text
) to service_role;
grant execute on function public.review_ebay_same_day_image_revision(
  uuid, text, uuid, text, boolean, jsonb
) to service_role;

notify pgrst, 'reload schema';
