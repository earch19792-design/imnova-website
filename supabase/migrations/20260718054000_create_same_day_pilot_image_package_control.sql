-- Additive Preview/staging control plane for one exact six-image package per
-- same-day pilot handoff. It stores only durable metadata and hashes: no
-- prompts, image bytes, Base64, source URLs, competitor data or raw provider
-- responses. It grants no eBay write or Production capability.

-- Preserve every historical handoff while allowing the safe six-image
-- finalizer to append a derivative-set handoff. OpenAI remains bounded to a
-- single context-plate call; the handoff still cannot authorize eBay writes.
alter table public.ebay_same_day_pilot_handoffs
  drop constraint if exists ebay_same_day_pilot_handoffs_source_image_type_check;
alter table public.ebay_same_day_pilot_handoffs
  add constraint ebay_same_day_pilot_handoffs_source_image_type_check check (
    source_image_type = 'LUNA_AUTHORIZED_CATALOG'
    or (
      source_image_type = 'LUNA_AUTHORIZED_DERIVATIVE_SET'
      and image_count = 6
    )
  ) not valid;
alter table public.ebay_same_day_pilot_handoffs
  validate constraint ebay_same_day_pilot_handoffs_source_image_type_check;

alter table public.ebay_same_day_pilot_handoffs
  drop constraint if exists ebay_same_day_pilot_handoffs_openai_calls_check;
alter table public.ebay_same_day_pilot_handoffs
  add constraint ebay_same_day_pilot_handoffs_openai_calls_check check (
    openai_calls = 0
    or (
      source_image_type = 'LUNA_AUTHORIZED_DERIVATIVE_SET'
      and openai_calls = 1
    )
  ) not valid;
alter table public.ebay_same_day_pilot_handoffs
  validate constraint ebay_same_day_pilot_handoffs_openai_calls_check;

create table if not exists public.ebay_same_day_pilot_image_package_runs (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  run_id uuid not null references public.ebay_same_day_pilot_runs(id) on delete restrict,
  candidate_id uuid not null references public.ebay_same_day_pilot_candidates(id) on delete restrict,
  listing_package_id uuid not null references public.ebay_listing_packages(id) on delete restrict,
  fact_run_id uuid not null references public.marketplace_product_fact_runs(id) on delete restrict,
  handoff_id uuid not null references public.ebay_same_day_pilot_handoffs(id) on delete restrict,
  handoff_hash text not null,
  generation_mode text not null,
  image_set_version text not null default 'EBAY_LISTING_IMAGE_COMPOSITION_SET_V1',
  status text not null default 'CLAIMED',
  attempt integer not null default 1,
  idempotency_key_hash text not null,
  lease_token uuid null,
  lease_expires_at timestamptz null,
  asset_ids uuid[] null,
  image_set_hash text null,
  provider_request_id text null,
  openai_calls integer not null default 0,
  last_error_code text null,
  claimed_at timestamptz not null default now(),
  completed_at timestamptz null,
  failed_at timestamptz null,
  reviewed_at timestamptz null,
  reviewed_by uuid null references auth.users(id) on delete restrict,
  human_decision text null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  competitor_image_count integer not null default 0,
  product_byte_count_sent integer not null default 0,
  product_url_count_sent integer not null default 0,
  ebay_writes integer not null default 0,
  production_changed boolean not null default false,
  constraint ebay_same_day_image_account_check check (
    marketplace_account_key <> 'default'
    and marketplace_account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
  ),
  constraint ebay_same_day_image_handoff_hash_check check (
    handoff_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_same_day_image_idempotency_hash_check check (
    idempotency_key_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_same_day_image_mode_check check (
    generation_mode in ('DETERMINISTIC_ONLY', 'OPENAI_CONTEXT_PLATE')
  ),
  constraint ebay_same_day_image_version_check check (
    image_set_version = 'EBAY_LISTING_IMAGE_COMPOSITION_SET_V1'
  ),
  constraint ebay_same_day_image_status_check check (
    status in (
      'CLAIMED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'PENDING_REVIEW',
      'APPROVED', 'REJECTED'
    )
  ),
  constraint ebay_same_day_image_attempt_check check (attempt between 1 and 2),
  constraint ebay_same_day_image_openai_calls_check check (openai_calls between 0 and 1),
  constraint ebay_same_day_image_lease_check check (
    (
      status = 'CLAIMED'
      and lease_token is not null
      and lease_expires_at is not null
      and lease_expires_at > claimed_at
    )
    or (
      status <> 'CLAIMED'
      and lease_token is null
      and lease_expires_at is null
    )
  ),
  constraint ebay_same_day_image_output_check check (
    (
      status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED')
      and cardinality(asset_ids) = 6
      and image_set_hash ~ '^[0-9a-f]{64}$'
      and completed_at is not null
    )
    or (
      status not in ('PENDING_REVIEW', 'APPROVED', 'REJECTED')
      and asset_ids is null
      and image_set_hash is null
      and completed_at is null
    )
  ),
  constraint ebay_same_day_image_failure_check check (
    (
      status in ('FAILED_RETRYABLE', 'FAILED_FINAL')
      and last_error_code ~ '^[A-Z0-9_:.-]{3,200}$'
      and failed_at is not null
    )
    or (
      status not in ('FAILED_RETRYABLE', 'FAILED_FINAL')
      and last_error_code is null
      and failed_at is null
    )
  ),
  constraint ebay_same_day_image_review_check check (
    (
      status in ('APPROVED', 'REJECTED')
      and reviewed_at is not null
      and reviewed_by is not null
      and human_decision = status
    )
    or (
      status not in ('APPROVED', 'REJECTED')
      and reviewed_at is null
      and reviewed_by is null
      and human_decision is null
    )
  ),
  constraint ebay_same_day_image_provider_id_check check (
    provider_request_id is null
    or provider_request_id ~ '^[A-Za-z0-9_-]{1,200}$'
  ),
  constraint ebay_same_day_image_mode_usage_check check (
    generation_mode <> 'DETERMINISTIC_ONLY' or openai_calls = 0
  ),
  constraint ebay_same_day_image_safety_check check (
    competitor_image_count = 0
    and product_byte_count_sent = 0
    and product_url_count_sent = 0
    and ebay_writes = 0
    and production_changed = false
  ),
  constraint ebay_same_day_image_candidate_handoff_unique unique (
    marketplace_account_key, candidate_id, handoff_hash
  ),
  constraint ebay_same_day_image_idempotency_unique unique (idempotency_key_hash)
);

create index if not exists ebay_same_day_image_run_status_idx
  on public.ebay_same_day_pilot_image_package_runs(
    run_id, status, created_at desc
  );
create index if not exists ebay_same_day_image_candidate_idx
  on public.ebay_same_day_pilot_image_package_runs(
    candidate_id, created_at desc
  );

create or replace function public.enforce_same_day_pilot_image_package_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and (
    new.marketplace_account_key is distinct from old.marketplace_account_key
    or new.created_by is distinct from old.created_by
    or new.run_id is distinct from old.run_id
    or new.candidate_id is distinct from old.candidate_id
    or new.listing_package_id is distinct from old.listing_package_id
    or new.fact_run_id is distinct from old.fact_run_id
    or new.handoff_id is distinct from old.handoff_id
    or new.handoff_hash is distinct from old.handoff_hash
    or new.generation_mode is distinct from old.generation_mode
    or new.image_set_version is distinct from old.image_set_version
    or new.idempotency_key_hash is distinct from old.idempotency_key_hash
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'SAME_DAY_IMAGE_PACKAGE_SCOPE_IMMUTABLE';
  end if;

  perform 1
  from public.ebay_same_day_pilot_runs pilot_run
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.run_id = pilot_run.id
  join public.ebay_listing_packages listing_package
    on listing_package.opportunity_id = candidate.opportunity_id
    and listing_package.candidate_key = candidate.candidate_key
  join public.marketplace_product_fact_runs fact_run
    on fact_run.id = new.fact_run_id
  join public.ebay_same_day_pilot_handoffs handoff
    on handoff.run_id = pilot_run.id
    and handoff.candidate_id = candidate.id
    and handoff.fact_run_id = fact_run.id
  where pilot_run.id = new.run_id
    and pilot_run.marketplace_account_key = new.marketplace_account_key
    and pilot_run.marketplace = 'EBAY_US'
    and pilot_run.created_by = new.created_by
    and candidate.id = new.candidate_id
    and candidate.machine_state in ('PREPARING_IMAGE_PACKAGE', 'WAITING_IMAGE_APPROVAL')
    and listing_package.id = new.listing_package_id
    and listing_package.account_key = new.marketplace_account_key
    and listing_package.created_by = new.created_by
    and listing_package.status <> 'archived'
    and fact_run.marketplace_account_key = new.marketplace_account_key
    and fact_run.marketplace = 'EBAY_US'
    and fact_run.status in ('COMPLETED', 'PARTIAL')
    and handoff.id = new.handoff_id
    and handoff.package_hash = new.handoff_hash
    and handoff.status = 'AWAITING_IMAGE_APPROVAL'
    and handoff.openai_calls = 0
    and handoff.ebay_writes = 0
    and handoff.production_changed = false;
  if not found then
    raise exception 'SAME_DAY_IMAGE_PACKAGE_SCOPE_INVALID';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_same_day_pilot_image_package_scope
  on public.ebay_same_day_pilot_image_package_runs;
create trigger enforce_same_day_pilot_image_package_scope
before insert or update of marketplace_account_key, created_by, run_id,
  candidate_id, listing_package_id, fact_run_id, handoff_id, handoff_hash,
  generation_mode, image_set_version, idempotency_key_hash, created_at
on public.ebay_same_day_pilot_image_package_runs
for each row execute function public.enforce_same_day_pilot_image_package_scope();

create or replace function public.reject_same_day_pilot_image_package_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'SAME_DAY_IMAGE_PACKAGE_APPEND_ONLY';
end;
$$;

drop trigger if exists reject_same_day_pilot_image_package_delete
  on public.ebay_same_day_pilot_image_package_runs;
create trigger reject_same_day_pilot_image_package_delete
before delete on public.ebay_same_day_pilot_image_package_runs
for each row execute function public.reject_same_day_pilot_image_package_delete();

create or replace function public.assert_same_day_pilot_image_set_safe(
  p_control_id uuid,
  p_actor uuid,
  p_asset_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_control public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_asset_count integer;
  v_slot_count integer;
  v_partial_count integer;
  v_generative_count integer;
  v_safe_partial_count integer;
  v_invalid_count integer;
begin
  if p_control_id is null
    or p_actor is null
    or coalesce(cardinality(p_asset_ids), 0) <> 6
    or (
      select count(distinct requested.asset_id)
      from unnest(p_asset_ids) requested(asset_id)
    ) <> 6 then
    raise exception 'SAME_DAY_IMAGE_SET_EXACT_SIX_REQUIRED';
  end if;

  select control.* into v_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = p_control_id
    and control.created_by = p_actor;
  if not found then raise exception 'SAME_DAY_IMAGE_CONTROL_NOT_FOUND'; end if;

  select
    count(asset.id),
    count(distinct asset.transformation ->> 'slot'),
    count(*) filter (
      where asset.qa_result ->> 'automaticStatus' = 'PARTIAL'
    ),
    count(*) filter (
      where asset.transformation ->> 'generativeAiUsed' = 'true'
    ),
    count(*) filter (
      where asset.qa_result ->> 'automaticStatus' = 'PARTIAL'
        and asset.transformation ->> 'slot' = 'USE_CONTEXT'
        and asset.transformation ->> 'generativeAiUsed' = 'true'
        and asset.transformation ->> 'backgroundPlateVersion'
          = 'EBAY_OPENAI_BACKGROUND_PLATE_V1'
        and coalesce(asset.transformation ->> 'backgroundPlateRequestHash', '')
          ~ '^[0-9a-f]{64}$'
        and coalesce(asset.transformation ->> 'backgroundPlateOutputSha256', '')
          ~ '^[0-9a-f]{64}$'
        and asset.qa_result ->> 'humanApprovalRequired' = 'true'
    ),
    count(*) filter (where
      asset.id is null
      or asset.listing_package_id is distinct from v_control.listing_package_id
      or asset.account_key is distinct from v_control.marketplace_account_key
      or asset.created_by is distinct from p_actor
      or asset.candidate_key is distinct from (
        select candidate.candidate_key
        from public.ebay_same_day_pilot_candidates candidate
        where candidate.id = v_control.candidate_id
      )
      or asset.status <> 'pending_review'
      or asset.rights_evidence_confirmed is distinct from true
      or asset.output_width <> 1600
      or asset.output_height <> 1600
      or asset.output_sha256 !~ '^[0-9a-f]{64}$'
      or asset.transformation_version <> 'EBAY_LISTING_IMAGE_COMPOSITION_SET_V1'
      or coalesce(asset.transformation ->> 'slot', '') <> all(array[
        'MAIN_WHITE_BACKGROUND', 'PACK_AND_COUNT', 'KEY_FEATURES',
        'SIZE_AND_CONTENT', 'USE_CONTEXT', 'PACKAGE_CONTENTS'
      ])
      or asset.transformation ->> 'competitorImageUsed' is distinct from 'false'
      or asset.transformation ->> 'originalPackagePixelsPreserved' is distinct from 'true'
      or asset.transformation ->> 'verifiedFactsOnly' is distinct from 'true'
      or asset.qa_result ->> 'humanApprovalRequired' is distinct from 'true'
      or coalesce(asset.qa_result ->> 'automaticStatus', '')
        not in ('PASSED', 'PARTIAL')
      or (
        asset.qa_result ->> 'automaticStatus' = 'PARTIAL'
        and not (
          asset.transformation ->> 'slot' = 'USE_CONTEXT'
          and asset.transformation ->> 'generativeAiUsed' = 'true'
          and asset.transformation ->> 'backgroundPlateVersion'
            = 'EBAY_OPENAI_BACKGROUND_PLATE_V1'
          and coalesce(asset.transformation ->> 'backgroundPlateRequestHash', '')
            ~ '^[0-9a-f]{64}$'
          and coalesce(asset.transformation ->> 'backgroundPlateOutputSha256', '')
            ~ '^[0-9a-f]{64}$'
          and asset.qa_result ->> 'humanApprovalRequired' = 'true'
        )
      )
    )
  into v_asset_count, v_slot_count, v_partial_count, v_generative_count,
    v_safe_partial_count, v_invalid_count
  from unnest(p_asset_ids) requested(asset_id)
  left join public.ebay_listing_image_assets asset
    on asset.id = requested.asset_id;

  if v_asset_count <> 6 or v_slot_count <> 6 or v_invalid_count <> 0 then
    raise exception 'SAME_DAY_IMAGE_SET_EVIDENCE_INVALID';
  end if;
  if v_control.generation_mode = 'OPENAI_CONTEXT_PLATE' and (
    v_partial_count <> 1
    or v_generative_count <> 1
    or v_safe_partial_count <> 1
  ) then
    raise exception 'SAME_DAY_IMAGE_SET_AI_CONTEXT_INVALID';
  end if;
  if v_control.generation_mode = 'DETERMINISTIC_ONLY' and (
    v_partial_count <> 0 or v_generative_count <> 0
  ) then
    raise exception 'SAME_DAY_IMAGE_SET_DETERMINISTIC_INVALID';
  end if;
end;
$$;

create or replace function public.claim_ebay_same_day_pilot_image_package_run(
  p_account_key text,
  p_actor uuid,
  p_run_id uuid,
  p_candidate_id uuid,
  p_listing_package_id uuid,
  p_fact_run_id uuid,
  p_handoff_id uuid,
  p_handoff_hash text,
  p_generation_mode text,
  p_idempotency_key_hash text,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_control public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_account_key is null
    or p_account_key = 'default'
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_actor is null
    or p_run_id is null
    or p_candidate_id is null
    or p_listing_package_id is null
    or p_fact_run_id is null
    or p_handoff_id is null
    or p_handoff_hash is null
    or p_handoff_hash !~ '^[0-9a-f]{64}$'
    or p_generation_mode is null
    or p_generation_mode not in ('DETERMINISTIC_ONLY', 'OPENAI_CONTEXT_PLATE')
    or p_idempotency_key_hash is null
    or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
    or p_lease_token is null then
    raise exception 'SAME_DAY_IMAGE_PACKAGE_CLAIM_INVALID';
  end if;

  perform public.assert_ebay_listing_package_account_scope(
    p_listing_package_id, p_account_key, p_actor
  );
  perform 1
  from public.ebay_same_day_pilot_runs pilot_run
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.run_id = pilot_run.id
  join public.ebay_listing_packages listing_package
    on listing_package.opportunity_id = candidate.opportunity_id
    and listing_package.candidate_key = candidate.candidate_key
  join public.marketplace_product_fact_runs fact_run
    on fact_run.id = p_fact_run_id
  join public.ebay_same_day_pilot_handoffs handoff
    on handoff.run_id = pilot_run.id
    and handoff.candidate_id = candidate.id
    and handoff.fact_run_id = fact_run.id
  where pilot_run.id = p_run_id
    and pilot_run.marketplace_account_key = p_account_key
    and pilot_run.marketplace = 'EBAY_US'
    and pilot_run.created_by = p_actor
    and candidate.id = p_candidate_id
    and candidate.machine_state in ('PREPARING_IMAGE_PACKAGE', 'WAITING_IMAGE_APPROVAL')
    and listing_package.id = p_listing_package_id
    and listing_package.account_key = p_account_key
    and listing_package.created_by = p_actor
    and listing_package.status <> 'archived'
    and fact_run.marketplace_account_key = p_account_key
    and fact_run.marketplace = 'EBAY_US'
    and fact_run.status in ('COMPLETED', 'PARTIAL')
    and handoff.id = p_handoff_id
    and handoff.package_hash = p_handoff_hash
    and handoff.status = 'AWAITING_IMAGE_APPROVAL'
    and handoff.openai_calls = 0
    and handoff.ebay_writes = 0
    and handoff.production_changed = false;
  if not found then raise exception 'SAME_DAY_IMAGE_PACKAGE_SCOPE_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_account_key || ':' || p_candidate_id::text || ':' || p_handoff_hash, 0
  ));

  select control.* into v_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.marketplace_account_key = p_account_key
    and control.candidate_id = p_candidate_id
    and control.handoff_hash = p_handoff_hash
  for update;

  if found then
    if v_control.idempotency_key_hash <> p_idempotency_key_hash
      or v_control.run_id <> p_run_id
      or v_control.listing_package_id <> p_listing_package_id
      or v_control.fact_run_id <> p_fact_run_id
      or v_control.handoff_id <> p_handoff_id
      or v_control.created_by <> p_actor
      or v_control.generation_mode <> p_generation_mode then
      raise exception 'SAME_DAY_IMAGE_PACKAGE_IDEMPOTENCY_CONFLICT';
    end if;
    if v_control.status = 'FAILED_RETRYABLE'
      and v_control.openai_calls = 0
      and v_control.attempt < 2 then
      update public.ebay_same_day_pilot_image_package_runs control
      set status = 'CLAIMED',
          attempt = control.attempt + 1,
          lease_token = p_lease_token,
          lease_expires_at = v_now + interval '3 minutes',
          claimed_at = v_now,
          last_error_code = null,
          failed_at = null,
          updated_at = v_now
      where control.id = v_control.id
      returning control.* into v_control;
      insert into public.ebay_same_day_pilot_events (
        run_id, candidate_id, event_type, event_payload, idempotency_key,
        openai_calls, ebay_writes, production_changed
      ) values (
        v_control.run_id, v_control.candidate_id,
        'SAME_DAY_IMAGE_PACKAGE_CLAIMED',
        jsonb_build_object(
          'controlId', v_control.id, 'attempt', v_control.attempt,
          'generationMode', v_control.generation_mode
        ),
        'same-day-image:' || v_control.id::text || ':claim:' || v_control.attempt,
        0, 0, false
      ) on conflict (idempotency_key) do nothing;
      return jsonb_build_object(
        'claimed', true, 'status', v_control.status,
        'controlId', v_control.id, 'attempt', v_control.attempt
      );
    end if;
    return jsonb_build_object(
      'claimed', false,
      'status', case
        when v_control.status = 'CLAIMED'
          and v_control.lease_expires_at <= v_now
          then 'LEASE_EXPIRED_REVIEW_REQUIRED'
        else v_control.status
      end,
      'controlId', v_control.id,
      'attempt', v_control.attempt
    );
  end if;

  insert into public.ebay_same_day_pilot_image_package_runs (
    marketplace_account_key, created_by, run_id, candidate_id,
    listing_package_id, fact_run_id, handoff_id, handoff_hash,
    generation_mode, idempotency_key_hash, lease_token, lease_expires_at,
    claimed_at
  ) values (
    p_account_key, p_actor, p_run_id, p_candidate_id,
    p_listing_package_id, p_fact_run_id, p_handoff_id, p_handoff_hash,
    p_generation_mode, p_idempotency_key_hash, p_lease_token,
    v_now + interval '3 minutes', v_now
  ) returning * into v_control;

  insert into public.ebay_same_day_pilot_events (
    run_id, candidate_id, event_type, event_payload, idempotency_key,
    openai_calls, ebay_writes, production_changed
  ) values (
    v_control.run_id, v_control.candidate_id,
    'SAME_DAY_IMAGE_PACKAGE_CLAIMED',
    jsonb_build_object(
      'controlId', v_control.id, 'attempt', v_control.attempt,
      'generationMode', v_control.generation_mode
    ),
    'same-day-image:' || v_control.id::text || ':claim:1',
    0, 0, false
  ) on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'claimed', true, 'status', v_control.status,
    'controlId', v_control.id, 'attempt', v_control.attempt
  );
end;
$$;

create or replace function public.complete_ebay_same_day_pilot_image_package_run(
  p_control_id uuid,
  p_actor uuid,
  p_lease_token uuid,
  p_asset_ids uuid[],
  p_openai_calls integer,
  p_provider_request_id text default null
)
returns public.ebay_same_day_pilot_image_package_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_control public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_image_set_hash text;
  v_now timestamptz := clock_timestamp();
begin
  if p_control_id is null
    or p_actor is null
    or p_lease_token is null
    or coalesce(cardinality(p_asset_ids), 0) <> 6
    or p_openai_calls is null
    or p_openai_calls not between 0 and 1
    or (
      p_provider_request_id is not null
      and p_provider_request_id !~ '^[A-Za-z0-9_-]{1,200}$'
    ) then
    raise exception 'SAME_DAY_IMAGE_PACKAGE_COMPLETION_INVALID';
  end if;

  select control.* into v_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = p_control_id
    and control.created_by = p_actor
  for update;
  if not found then raise exception 'SAME_DAY_IMAGE_CONTROL_NOT_FOUND'; end if;

  if v_control.status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED') then
    if v_control.openai_calls = p_openai_calls
      and v_control.asset_ids @> p_asset_ids
      and v_control.asset_ids <@ p_asset_ids then
      return v_control;
    end if;
    raise exception 'SAME_DAY_IMAGE_PACKAGE_COMPLETION_CONFLICT';
  end if;
  if v_control.status <> 'CLAIMED'
    or v_control.lease_token <> p_lease_token then
    raise exception 'SAME_DAY_IMAGE_PACKAGE_LEASE_NOT_OWNED';
  end if;
  perform 1
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = v_control.candidate_id
    and candidate.run_id = v_control.run_id
    and candidate.machine_state = 'PREPARING_IMAGE_PACKAGE'
  for key share;
  if not found then raise exception 'SAME_DAY_IMAGE_PACKAGE_STATE_STALE'; end if;
  if (v_control.generation_mode = 'OPENAI_CONTEXT_PLATE' and p_openai_calls <> 1)
    or (v_control.generation_mode = 'DETERMINISTIC_ONLY' and p_openai_calls <> 0)
    or (p_openai_calls = 0 and p_provider_request_id is not null) then
    raise exception 'SAME_DAY_IMAGE_PACKAGE_USAGE_INVALID';
  end if;

  perform public.assert_same_day_pilot_image_set_safe(
    p_control_id, p_actor, p_asset_ids
  );
  select encode(extensions.digest(
    string_agg(asset.output_sha256, ':' order by asset.position, asset.id),
    'sha256'
  ), 'hex')
  into v_image_set_hash
  from public.ebay_listing_image_assets asset
  where asset.id = any(p_asset_ids)
    and asset.listing_package_id = v_control.listing_package_id
    and asset.account_key = v_control.marketplace_account_key
    and asset.created_by = p_actor;
  if v_image_set_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'SAME_DAY_IMAGE_PACKAGE_HASH_FAILED';
  end if;

  update public.ebay_same_day_pilot_image_package_runs control
  set status = 'PENDING_REVIEW',
      asset_ids = p_asset_ids,
      image_set_hash = v_image_set_hash,
      provider_request_id = p_provider_request_id,
      openai_calls = p_openai_calls,
      lease_token = null,
      lease_expires_at = null,
      completed_at = v_now,
      updated_at = v_now
  where control.id = p_control_id
    and control.status = 'CLAIMED'
    and control.lease_token = p_lease_token
  returning control.* into v_control;
  if not found then raise exception 'SAME_DAY_IMAGE_PACKAGE_COMPLETION_CONFLICT'; end if;

  insert into public.ebay_same_day_pilot_events (
    run_id, candidate_id, event_type, event_payload, idempotency_key,
    openai_calls, ebay_writes, production_changed
  ) values (
    v_control.run_id, v_control.candidate_id,
    'SAME_DAY_IMAGE_PACKAGE_PENDING_REVIEW',
    jsonb_build_object(
      'controlId', v_control.id,
      'imageSetHash', v_control.image_set_hash,
      'imageCount', 6,
      'generationMode', v_control.generation_mode
    ),
    'same-day-image:' || v_control.id::text || ':pending-review',
    p_openai_calls, 0, false
  ) on conflict (idempotency_key) do nothing;
  return v_control;
end;
$$;

create or replace function public.fail_ebay_same_day_pilot_image_package_run(
  p_control_id uuid,
  p_actor uuid,
  p_lease_token uuid,
  p_error_code text,
  p_openai_call_made boolean
)
returns public.ebay_same_day_pilot_image_package_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_control public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_status text;
  v_now timestamptz := clock_timestamp();
begin
  if p_control_id is null
    or p_actor is null
    or p_lease_token is null
    or p_error_code is null
    or p_error_code !~ '^[A-Z0-9_:.-]{3,200}$'
    or p_openai_call_made is null then
    raise exception 'SAME_DAY_IMAGE_PACKAGE_FAILURE_INVALID';
  end if;
  select control.* into v_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = p_control_id
    and control.created_by = p_actor
  for update;
  if not found then raise exception 'SAME_DAY_IMAGE_CONTROL_NOT_FOUND'; end if;
  if v_control.status in ('FAILED_RETRYABLE', 'FAILED_FINAL') then
    if v_control.last_error_code = p_error_code
      and v_control.openai_calls = (
        case when p_openai_call_made then 1 else 0 end
      ) then
      return v_control;
    end if;
    raise exception 'SAME_DAY_IMAGE_PACKAGE_FAILURE_CONFLICT';
  end if;
  if v_control.status <> 'CLAIMED'
    or v_control.lease_token <> p_lease_token then
    raise exception 'SAME_DAY_IMAGE_PACKAGE_LEASE_NOT_OWNED';
  end if;
  if v_control.generation_mode = 'DETERMINISTIC_ONLY'
    and p_openai_call_made then
    raise exception 'SAME_DAY_IMAGE_PACKAGE_USAGE_INVALID';
  end if;
  v_status := case
    when p_openai_call_made or v_control.attempt >= 2
      then 'FAILED_FINAL'
    else 'FAILED_RETRYABLE'
  end;
  update public.ebay_same_day_pilot_image_package_runs control
  set status = v_status,
      openai_calls = case when p_openai_call_made then 1 else 0 end,
      last_error_code = p_error_code,
      failed_at = v_now,
      lease_token = null,
      lease_expires_at = null,
      updated_at = v_now
  where control.id = p_control_id
    and control.status = 'CLAIMED'
    and control.lease_token = p_lease_token
  returning control.* into v_control;
  if not found then raise exception 'SAME_DAY_IMAGE_PACKAGE_FAILURE_CONFLICT'; end if;

  insert into public.ebay_same_day_pilot_events (
    run_id, candidate_id, event_type, event_payload, idempotency_key,
    openai_calls, ebay_writes, production_changed
  ) values (
    v_control.run_id, v_control.candidate_id,
    'SAME_DAY_IMAGE_PACKAGE_FAILED',
    jsonb_build_object(
      'controlId', v_control.id, 'status', v_control.status,
      'errorCode', v_control.last_error_code, 'attempt', v_control.attempt
    ),
    'same-day-image:' || v_control.id::text || ':failed:' || v_control.attempt,
    v_control.openai_calls, 0, false
  ) on conflict (idempotency_key) do nothing;
  return v_control;
end;
$$;

create or replace function public.review_ebay_same_day_pilot_image_package_set(
  p_control_id uuid,
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
  v_control public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_item jsonb;
  v_asset_id uuid;
  v_public_url text;
  v_published_path text;
  v_manifest_asset_ids uuid[] := '{}'::uuid[];
  v_image_urls jsonb := '[]'::jsonb;
  v_image_manifest jsonb := '[]'::jsonb;
  v_approved_count integer;
  v_final_status text;
  v_now timestamptz := clock_timestamp();
begin
  if p_control_id is null
    or p_actor is null
    or p_decision is null
    or p_decision not in ('APPROVE', 'REJECT')
    or p_confirmed is distinct from true
    or p_publication_manifest is null
    or jsonb_typeof(p_publication_manifest) <> 'array' then
    raise exception 'SAME_DAY_IMAGE_REVIEW_DECISION_INVALID';
  end if;
  v_final_status := case when p_decision = 'APPROVE'
    then 'APPROVED' else 'REJECTED' end;

  select control.* into v_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = p_control_id
    and control.created_by = p_actor
  for update;
  if not found then raise exception 'SAME_DAY_IMAGE_CONTROL_NOT_FOUND'; end if;
  if v_control.status in ('APPROVED', 'REJECTED') then
    if v_control.status = v_final_status then
      return jsonb_build_object(
        'controlId', v_control.id, 'status', v_control.status,
        'imageSetHash', v_control.image_set_hash,
        'imageUrls', coalesce(
          (select package.package_data -> 'imageUrls'
           from public.ebay_listing_packages package
           where package.id = v_control.listing_package_id),
          '[]'::jsonb
        )
      );
    end if;
    raise exception 'SAME_DAY_IMAGE_REVIEW_CONFLICT';
  end if;
  if v_control.status <> 'PENDING_REVIEW' then
    raise exception 'SAME_DAY_IMAGE_SET_NOT_REVIEWABLE';
  end if;

  perform 1
  from public.ebay_same_day_pilot_human_tasks task
  where task.run_id = v_control.run_id
    and task.candidate_id = v_control.candidate_id
    and task.gate_type = 'IMAGE_APPROVAL_REQUIRED'
    and (
      (p_decision = 'REJECT' and task.status = 'OPEN')
      or (
        p_decision = 'APPROVE'
        and task.status = 'COMPLETED'
        and task.completed_at is not null
        and exists (
          select 1
          from public.ebay_same_day_pilot_transitions transition_row
          where transition_row.run_id = v_control.run_id
            and transition_row.candidate_id = v_control.candidate_id
            and transition_row.previous_state = 'WAITING_IMAGE_APPROVAL'
            and transition_row.next_state = 'BUILDING_SELLER_HUB_HANDOFF'
            and transition_row.reason_code = 'SIX_IMAGE_SET_APPROVAL_CONFIRMED'
            and transition_row.triggered_by = 'USER'
            and transition_row.checkpoint ->> 'controlId' = v_control.id::text
            and transition_row.checkpoint ->> 'imageApproval' = 'true'
        )
      )
    )
  for key share;
  if not found then raise exception 'SAME_DAY_IMAGE_HUMAN_GATE_REQUIRED'; end if;

  select package.* into v_package
  from public.ebay_listing_packages package
  where package.id = v_control.listing_package_id
    and package.account_key = v_control.marketplace_account_key
    and package.created_by = p_actor
    and package.status <> 'archived'
  for update;
  if not found then raise exception 'SAME_DAY_IMAGE_PACKAGE_NOT_FOUND'; end if;

  perform 1
  from public.ebay_listing_image_assets asset
  where asset.id = any(v_control.asset_ids)
  for update;
  perform public.assert_same_day_pilot_image_set_safe(
    v_control.id, p_actor, v_control.asset_ids
  );

  if p_decision = 'APPROVE' then
    if jsonb_array_length(p_publication_manifest) <> 6 then
      raise exception 'SAME_DAY_IMAGE_PUBLICATION_EXACT_SIX_REQUIRED';
    end if;
    for v_item in
      select item.value from jsonb_array_elements(p_publication_manifest) item(value)
    loop
      if jsonb_typeof(v_item) <> 'object'
        or coalesce(v_item ->> 'asset_id', '')
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'SAME_DAY_IMAGE_PUBLICATION_MANIFEST_INVALID';
      end if;
      v_asset_id := (v_item ->> 'asset_id')::uuid;
      v_public_url := nullif(trim(v_item ->> 'public_url'), '');
      v_published_path := nullif(trim(v_item ->> 'published_storage_path'), '');
      if v_public_url is null
        or v_public_url !~ '^https://[^[:space:][:cntrl:]]+$'
        or v_published_path is null
        or v_published_path !~ (
          '^' || p_actor::text || '/[0-9a-f]{24}/' || v_asset_id::text
          || '[.]jpg$'
        )
        or strpos(
          v_public_url,
          '/storage/v1/object/public/ebay-listing-images/' || v_published_path
        ) = 0 then
        raise exception 'SAME_DAY_IMAGE_PUBLICATION_MANIFEST_INVALID';
      end if;
      v_manifest_asset_ids := array_append(v_manifest_asset_ids, v_asset_id);
    end loop;
    if (
      select count(distinct requested.asset_id)
      from unnest(v_manifest_asset_ids) requested(asset_id)
    ) <> 6
      or not (v_manifest_asset_ids @> v_control.asset_ids)
      or not (v_manifest_asset_ids <@ v_control.asset_ids) then
      raise exception 'SAME_DAY_IMAGE_PUBLICATION_OWNERSHIP_MISMATCH';
    end if;

    select count(*) into v_approved_count
    from public.ebay_listing_image_assets asset
    where asset.listing_package_id = v_control.listing_package_id
      and asset.account_key = v_control.marketplace_account_key
      and asset.created_by = p_actor
      and asset.status = 'approved'
      and not (asset.id = any(v_control.asset_ids));
    if v_approved_count + 6 > 24 then
      raise exception 'EBAY_IMAGE_APPROVED_CAP_REACHED';
    end if;

    for v_item in
      select item.value from jsonb_array_elements(p_publication_manifest) item(value)
    loop
      v_asset_id := (v_item ->> 'asset_id')::uuid;
      v_public_url := trim(v_item ->> 'public_url');
      v_published_path := trim(v_item ->> 'published_storage_path');
      update public.ebay_listing_image_assets asset
      set status = 'approved',
          approved_at = v_now,
          approved_by = p_actor,
          rejected_at = null,
          published_storage_path = v_published_path,
          public_url = v_public_url,
          updated_at = v_now
      where asset.id = v_asset_id
        and asset.listing_package_id = v_control.listing_package_id
        and asset.account_key = v_control.marketplace_account_key
        and asset.created_by = p_actor
        and asset.status = 'pending_review';
      if not found then raise exception 'SAME_DAY_IMAGE_ASSET_NOT_REVIEWABLE'; end if;
    end loop;

    select
      jsonb_agg(asset.public_url order by asset.position, asset.created_at, asset.id),
      jsonb_agg(jsonb_build_object(
        'assetId', asset.id,
        'url', asset.public_url,
        'role', asset.asset_role,
        'slot', asset.transformation ->> 'slot',
        'position', asset.position,
        'sha256', asset.output_sha256,
        'transformationVersion', asset.transformation_version,
        'automaticQa', asset.qa_result ->> 'automaticStatus',
        'generativeAiUsed', asset.transformation ->> 'generativeAiUsed' = 'true',
        'humanApprovedAt', asset.approved_at
      ) order by asset.position, asset.created_at, asset.id)
    into v_image_urls, v_image_manifest
    from public.ebay_listing_image_assets asset
    where asset.id = any(v_control.asset_ids)
      and asset.listing_package_id = v_control.listing_package_id
      and asset.account_key = v_control.marketplace_account_key
      and asset.created_by = p_actor
      and asset.status = 'approved';
    if jsonb_array_length(coalesce(v_image_urls, '[]'::jsonb)) <> 6 then
      raise exception 'SAME_DAY_IMAGE_APPROVAL_ATOMICITY_FAILED';
    end if;

    update public.ebay_listing_packages package
    set package_data = jsonb_set(
          jsonb_set(
            coalesce(package.package_data, '{}'::jsonb),
            '{imageUrls}', v_image_urls, true
          ),
          '{imageAssetManifest}', v_image_manifest, true
        ),
        status = 'draft',
        readiness = 0,
        updated_at = v_now
    where package.id = v_control.listing_package_id
      and package.account_key = v_control.marketplace_account_key
      and package.created_by = p_actor;
  else
    if jsonb_array_length(p_publication_manifest) <> 0 then
      raise exception 'SAME_DAY_IMAGE_REJECT_PUBLICATION_INVALID';
    end if;
    update public.ebay_listing_image_assets asset
    set status = 'rejected',
        approved_at = null,
        approved_by = null,
        rejected_at = v_now,
        published_storage_path = null,
        public_url = null,
        updated_at = v_now
    where asset.id = any(v_control.asset_ids)
      and asset.listing_package_id = v_control.listing_package_id
      and asset.account_key = v_control.marketplace_account_key
      and asset.created_by = p_actor
      and asset.status = 'pending_review';
    if not found then raise exception 'SAME_DAY_IMAGE_ASSET_NOT_REVIEWABLE'; end if;
  end if;

  update public.ebay_same_day_pilot_image_package_runs control
  set status = v_final_status,
      reviewed_at = v_now,
      reviewed_by = p_actor,
      human_decision = v_final_status,
      updated_at = v_now
  where control.id = v_control.id
    and control.status = 'PENDING_REVIEW'
  returning control.* into v_control;
  if not found then raise exception 'SAME_DAY_IMAGE_REVIEW_CONFLICT'; end if;

  insert into public.ebay_same_day_pilot_events (
    run_id, candidate_id, event_type, event_payload, idempotency_key,
    openai_calls, ebay_writes, production_changed
  ) values (
    v_control.run_id, v_control.candidate_id,
    case when p_decision = 'APPROVE'
      then 'SAME_DAY_IMAGE_PACKAGE_APPROVED'
      else 'SAME_DAY_IMAGE_PACKAGE_REJECTED' end,
    jsonb_build_object(
      'controlId', v_control.id, 'imageSetHash', v_control.image_set_hash,
      'imageCount', 6, 'humanDecision', v_final_status
    ),
    'same-day-image:' || v_control.id::text || ':review:' || lower(v_final_status),
    0, 0, false
  ) on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'controlId', v_control.id,
    'status', v_control.status,
    'imageSetHash', v_control.image_set_hash,
    'imageUrls', case when p_decision = 'APPROVE'
      then v_image_urls else '[]'::jsonb end,
    'ebayWrites', 0,
    'productionChanged', false
  );
end;
$$;

alter table public.ebay_same_day_pilot_image_package_runs enable row level security;
alter table public.ebay_same_day_pilot_image_package_runs force row level security;
revoke all on table public.ebay_same_day_pilot_image_package_runs
  from anon, authenticated;
revoke all on table public.ebay_same_day_pilot_image_package_runs
  from public, service_role;
grant select on table public.ebay_same_day_pilot_image_package_runs
  to service_role;

revoke all on function public.enforce_same_day_pilot_image_package_scope()
  from public, anon, authenticated, service_role;
revoke all on function public.reject_same_day_pilot_image_package_delete()
  from public, anon, authenticated, service_role;
revoke all on function public.assert_same_day_pilot_image_set_safe(
  uuid, uuid, uuid[]
) from public, anon, authenticated, service_role;
revoke all on function public.claim_ebay_same_day_pilot_image_package_run(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.complete_ebay_same_day_pilot_image_package_run(
  uuid, uuid, uuid, uuid[], integer, text
) from public, anon, authenticated;
revoke all on function public.fail_ebay_same_day_pilot_image_package_run(
  uuid, uuid, uuid, text, boolean
) from public, anon, authenticated;
revoke all on function public.review_ebay_same_day_pilot_image_package_set(
  uuid, uuid, text, boolean, jsonb
) from public, anon, authenticated;

grant execute on function public.claim_ebay_same_day_pilot_image_package_run(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, uuid
) to service_role;
grant execute on function public.complete_ebay_same_day_pilot_image_package_run(
  uuid, uuid, uuid, uuid[], integer, text
) to service_role;
grant execute on function public.fail_ebay_same_day_pilot_image_package_run(
  uuid, uuid, uuid, text, boolean
) to service_role;
grant execute on function public.review_ebay_same_day_pilot_image_package_set(
  uuid, uuid, text, boolean, jsonb
) to service_role;

comment on table public.ebay_same_day_pilot_image_package_runs is
  'Preview/staging metadata-only control for one exact six-image same-day pilot package. No prompts, image bytes, Base64, source URLs, competitor content or eBay writes.';
comment on function public.review_ebay_same_day_pilot_image_package_set(
  uuid, uuid, text, boolean, jsonb
) is
  'Atomically reviews an exact six-image pilot set. PARTIAL is allowed only for the single generated USE_CONTEXT plate with strict provenance and explicit human approval.';

notify pgrst, 'reload schema';
