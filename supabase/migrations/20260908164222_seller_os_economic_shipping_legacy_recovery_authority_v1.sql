-- One-at-a-time recovery authority for the bounded legacy Shipping incident.
-- Historical attempt_count remains immutable throughout recovery. The marker
-- removes only an explicitly classified legacy job from the old generic claim
-- path; normal jobs and every non-Shipping evidence type retain V1 behavior.

alter table public.seller_os_economic_evidence_refresh_jobs_v1
  add column shipping_legacy_recovery_generation text null;

alter table public.seller_os_economic_evidence_refresh_jobs_v1
  add constraint seller_os_economic_shipping_legacy_recovery_generation_check
  check (shipping_legacy_recovery_generation is null or
    shipping_legacy_recovery_generation ~
      '^economic-shipping-legacy-recovery-v1:sha256:[0-9a-f]{64}$');

create table public.seller_os_economic_shipping_legacy_recoveries_v1 (
  recovery_id uuid primary key default extensions.gen_random_uuid(),
  marketplace_account_key text not null,
  job_id uuid not null references
    public.seller_os_economic_evidence_refresh_jobs_v1(job_id),
  recovery_generation text not null unique,
  classification text not null,
  classification_fingerprint text not null,
  runtime_commit_sha text not null,
  status text not null,
  historical_attempt_count integer not null,
  legacy_status text not null,
  legacy_lease_owner text null,
  legacy_lease_expires_at timestamptz null,
  legacy_failure_class text null,
  legacy_next_retry_at timestamptz null,
  legacy_first_detected_at timestamptz not null,
  legacy_last_detected_at timestamptz not null,
  legacy_updated_at timestamptz not null,
  recovery_attempt_count integer not null default 0,
  recovery_next_retry_at timestamptz null,
  recovery_dead_letter_at timestamptz null,
  active_worker_id text null,
  active_lease_expires_at timestamptz null,
  candidate_id text null,
  snapshot_digest text null,
  capture_session_id uuid null,
  shipping_freshness_generation text null,
  required_evidence_after timestamptz null,
  last_reason_code text null,
  gate_receipt jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (marketplace_account_key, job_id),
  constraint seller_os_shipping_legacy_recovery_generation_check check (
    recovery_generation ~
      '^economic-shipping-legacy-recovery-v1:sha256:[0-9a-f]{64}$'),
  constraint seller_os_shipping_legacy_recovery_fingerprint_check check (
    classification_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  constraint seller_os_shipping_legacy_recovery_runtime_check check (
    runtime_commit_sha =
      'b618350a9848e8b49f3c0590270afe2d0ec91c14'),
  constraint seller_os_shipping_legacy_recovery_classification_check check (
    classification in ('RECOVERABLE_VALID_SCOPE',
      'OUT_OF_SCOPE_NO_ACTIVE_LISTING')),
  constraint seller_os_shipping_legacy_recovery_status_check check (
    status in ('ACTIVE', 'FAILED_RETRYABLE', 'COMPLETED',
      'FAILED_TERMINAL')),
  constraint seller_os_shipping_legacy_recovery_attempt_check check (
    recovery_attempt_count between 0 and 5),
  constraint seller_os_shipping_legacy_recovery_binding_check check (
    (candidate_id is null or candidate_id ~ '^sha256:[0-9a-f]{64}$') and
    (snapshot_digest is null or
      snapshot_digest ~ '^sha256:[0-9a-f]{64}$') and
    (shipping_freshness_generation is null or
      shipping_freshness_generation ~
        '^economic-shipping-refresh-v1:sha256:[0-9a-f]{64}$')),
  constraint seller_os_shipping_legacy_recovery_active_check check (
    (status = 'ACTIVE' and active_worker_id is not null and
      active_lease_expires_at is not null and candidate_id is not null and
      snapshot_digest is not null and capture_session_id is not null and
      shipping_freshness_generation is not null and
      required_evidence_after is not null)
    or status <> 'ACTIVE')
);

create index seller_os_economic_shipping_legacy_recovery_due_v1_idx
  on public.seller_os_economic_shipping_legacy_recoveries_v1(
    marketplace_account_key, recovery_next_retry_at, updated_at)
  where status = 'FAILED_RETRYABLE';

alter table public.seller_os_economic_shipping_legacy_recoveries_v1
  enable row level security;
alter table public.seller_os_economic_shipping_legacy_recoveries_v1
  force row level security;
revoke all on table
  public.seller_os_economic_shipping_legacy_recoveries_v1
  from public, anon, authenticated, service_role;
grant select on table
  public.seller_os_economic_shipping_legacy_recoveries_v1 to service_role;

create or replace function
public.seller_os_economic_shipping_legacy_recovery_delay_v1(
  p_recovery_attempt integer
) returns interval
language sql immutable
set search_path = pg_catalog
as $$
  select make_interval(mins => case
    when p_recovery_attempt <= 1 then 1
    when p_recovery_attempt = 2 then 2
    when p_recovery_attempt = 3 then 4
    when p_recovery_attempt = 4 then 8
    else 15 end);
$$;

create or replace function
public.classify_seller_os_economic_shipping_legacy_job_v1(
  p_marketplace_account_key text,
  p_job_id uuid
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.seller_os_economic_evidence_refresh_jobs_v1%rowtype;
  v_active_count integer;
  v_active record;
  v_linkage record;
  v_variant_count integer;
  v_variant record;
  v_legacy boolean;
  v_exact boolean;
  v_classification text;
  v_reason text;
  v_fingerprint text;
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(trim(coalesce(p_marketplace_account_key,'')))
        not between 8 and 200
      or p_job_id is null then
    raise exception 'SELLER_OS_LEGACY_SHIPPING_CLASSIFIER_INVALID';
  end if;

  select * into v_job
  from public.seller_os_economic_evidence_refresh_jobs_v1
  where job_id=p_job_id
    and marketplace_account_key=p_marketplace_account_key;
  if not found then
    return jsonb_build_object('classification','OTHER_UNPROVEN',
      'reasonCode','LEGACY_SHIPPING_JOB_NOT_FOUND',
      'classificationProven',false);
  end if;

  v_legacy := v_job.evidence_type='LUNA_CURRENT_SHIPPING'
    and v_job.attempt_count>5
    and v_job.shipping_freshness_generation is null
    and v_job.shipping_legacy_recovery_generation is null
    and v_job.first_detected_at < timestamptz '2026-09-08 15:56:51+00';

  select count(*)::integer into v_active_count
  from public.ebay_active_listings listing
  where listing.account_key=p_marketplace_account_key
    and listing.ebay_item_id=v_job.ebay_item_id
    and listing.listing_status='active';
  select listing.id::text id,
      listing.market_radar_product_id::text market_radar_product_id,
      listing.supplier_variant_id::text supplier_variant_id,
      listing.supplier_sku
    into v_active
  from public.ebay_active_listings listing
  where listing.account_key=p_marketplace_account_key
    and listing.ebay_item_id=v_job.ebay_item_id
    and listing.listing_status='active'
  order by listing.updated_at desc limit 1;
  select decision_id::text decision_id,decision,linkage_id,
      luna_product_id::text luna_product_id,
      luna_variant_id::text luna_variant_id,luna_sku
    into v_linkage
  from public.seller_os_luna_linkage_decisions
  where account_key=p_marketplace_account_key
    and marketplace_id=v_job.marketplace_id
    and ebay_item_id=v_job.ebay_item_id
  order by decision_version desc limit 1;
  select count(*)::integer into v_variant_count
  from public.market_radar_latest_variants variant
  where variant.source_key='lunaportex'
    and variant.supplier_product_id::text=
      v_job.source_identity->>'lunaProductId'
    and variant.supplier_variant_id::text=
      v_job.source_identity->>'lunaVariantId'
    and variant.sku=v_job.source_identity->>'sourceSku';
  select variant.product_id::text product_id,variant.product_url
    into v_variant
  from public.market_radar_latest_variants variant
  where variant.source_key='lunaportex'
    and variant.supplier_product_id::text=
      v_job.source_identity->>'lunaProductId'
    and variant.supplier_variant_id::text=
      v_job.source_identity->>'lunaVariantId'
    and variant.sku=v_job.source_identity->>'sourceSku'
  order by variant.captured_at desc limit 1;

  v_exact := v_legacy and v_active_count=1
    and v_linkage.decision='APPROVE_EXACT_LINKAGE'
    and v_linkage.linkage_id=v_job.source_identity->>'linkageId'
    and v_linkage.luna_product_id=v_job.source_identity->>'lunaProductId'
    and v_linkage.luna_variant_id=v_job.source_identity->>'lunaVariantId'
    and v_linkage.luna_sku=v_job.source_identity->>'sourceSku'
    and v_variant_count=1 and nullif(v_variant.product_url,'') is not null
    and (v_active.market_radar_product_id is null or
      v_active.market_radar_product_id=v_variant.product_id)
    and (v_active.supplier_variant_id is null or
      v_active.supplier_variant_id=v_job.source_identity->>'lunaVariantId')
    and (v_active.supplier_sku is null or
      v_active.supplier_sku=v_job.source_identity->>'sourceSku');

  v_classification := case
    when not v_legacy then 'OTHER_UNPROVEN'
    when v_active_count=0 then 'OUT_OF_SCOPE_NO_ACTIVE_LISTING'
    when v_exact then 'RECOVERABLE_VALID_SCOPE'
    else 'OTHER_UNPROVEN' end;
  v_reason := case
    when not v_legacy then 'LEGACY_RECLAIM_LOOP_SIGNATURE_UNPROVEN'
    when v_active_count=0 then
      'LIVE_LISTING_SHIPPING_EXACT_CURRENT_LIVE_REQUIRED'
    when v_active_count<>1 then
      'LIVE_LISTING_SHIPPING_EXACT_CURRENT_LIVE_REQUIRED'
    when v_linkage.decision is distinct from 'APPROVE_EXACT_LINKAGE'
      then 'LIVE_LISTING_SHIPPING_CERTIFIED_LINKAGE_REQUIRED'
    when v_variant_count<>1 then
      'LIVE_LISTING_SHIPPING_EXACT_LUNA_VARIANT_REQUIRED'
    when not v_exact then 'LIVE_LISTING_SHIPPING_ACTIVE_LINEAGE_MISMATCH'
    else 'LEGACY_RECLAIM_LOOP_VALID_SCOPE_PROVEN' end;
  v_fingerprint := 'sha256:'||encode(extensions.digest(convert_to(
    jsonb_build_object(
      'contract','SELLER_OS_ECONOMIC_SHIPPING_LEGACY_RECOVERY_AUTHORITY_V1',
      'accountKey',p_marketplace_account_key,'jobId',p_job_id,
      'itemId',v_job.ebay_item_id,'historicalAttempts',v_job.attempt_count,
      'firstDetectedAt',v_job.first_detected_at,
      'classification',v_classification,'reasonCode',v_reason,
      'activeListingId',v_active.id,'linkageDecisionId',v_linkage.decision_id,
      'lunaProductId',v_job.source_identity->>'lunaProductId',
      'lunaVariantId',v_job.source_identity->>'lunaVariantId',
      'sourceSku',v_job.source_identity->>'sourceSku')::text,'UTF8'),
    'sha256'),'hex');
  return jsonb_build_object('classification',v_classification,
    'reasonCode',v_reason,'classificationProven',
      v_classification in ('RECOVERABLE_VALID_SCOPE',
        'OUT_OF_SCOPE_NO_ACTIVE_LISTING'),
    'classificationFingerprint',v_fingerprint,
    'historicalAttemptCount',v_job.attempt_count,
    'legacyStatus',v_job.status,'legacyLeaseOwner',v_job.lease_owner,
    'legacyLeaseExpiresAt',v_job.lease_expires_at,
    'legacyLastDetectedAt',v_job.last_detected_at,
    'itemId',v_job.ebay_item_id);
end;
$$;

create or replace function
public.close_seller_os_economic_shipping_legacy_out_of_scope_v1(
  p_marketplace_account_key text,
  p_job_id uuid,
  p_runtime_commit_sha text,
  p_legacy_shipping_runtime_active boolean,
  p_heartbeat_v1_total integer,
  p_phase_a_v2_active boolean,
  p_b618_runtime_active boolean,
  p_classification_fingerprint text,
  p_recovery_generation text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_job public.seller_os_economic_evidence_refresh_jobs_v1%rowtype;
  v_existing public.seller_os_economic_shipping_legacy_recoveries_v1%rowtype;
  v_classification jsonb;
  v_gate jsonb;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_runtime_commit_sha<>
        'b618350a9848e8b49f3c0590270afe2d0ec91c14'
      or p_legacy_shipping_runtime_active is distinct from false
      or p_heartbeat_v1_total<>0
      or p_phase_a_v2_active is distinct from true
      or p_b618_runtime_active is distinct from true
      or p_classification_fingerprint !~ '^sha256:[0-9a-f]{64}$'
      or p_recovery_generation !~
        '^economic-shipping-legacy-recovery-v1:sha256:[0-9a-f]{64}$' then
    raise exception 'SELLER_OS_LEGACY_SHIPPING_RECOVERY_GATE_FAILED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'seller-os-economic-shipping-legacy-recovery:'||
      p_marketplace_account_key||':'||p_job_id::text,0));
  select * into v_job
  from public.seller_os_economic_evidence_refresh_jobs_v1
  where job_id=p_job_id and marketplace_account_key=p_marketplace_account_key
  for update;
  if not found then
    return jsonb_build_object('closed',false,
      'reasonCode','LEGACY_SHIPPING_JOB_NOT_FOUND');
  end if;
  if v_job.lease_expires_at is not null and v_job.lease_expires_at>v_now then
    return jsonb_build_object('closed',false,
      'reasonCode','LEGACY_SHIPPING_JOB_NOT_RECOVERY_CLAIMABLE');
  end if;
  select * into v_existing
  from public.seller_os_economic_shipping_legacy_recoveries_v1
  where marketplace_account_key=p_marketplace_account_key and job_id=p_job_id
  for update;
  if found then
    if v_existing.recovery_generation<>p_recovery_generation
        or v_existing.classification_fingerprint<>
          p_classification_fingerprint then
      raise exception 'SELLER_OS_LEGACY_SHIPPING_RECOVERY_BINDING_MISMATCH';
    end if;
    return jsonb_build_object('closed',
        v_existing.status='FAILED_TERMINAL',
      'idempotent',v_existing.status='FAILED_TERMINAL',
      'reasonCode',coalesce(v_existing.last_reason_code,
        'LEGACY_SHIPPING_RECOVERY_ALREADY_CLASSIFIED'));
  end if;
  v_classification:=public.classify_seller_os_economic_shipping_legacy_job_v1(
    p_marketplace_account_key,p_job_id);
  if v_classification->>'classification'<>
        'OUT_OF_SCOPE_NO_ACTIVE_LISTING'
      or (v_classification->>'classificationProven')::boolean
        is distinct from true
      or v_classification->>'classificationFingerprint'<>
        p_classification_fingerprint then
    raise exception 'SELLER_OS_LEGACY_SHIPPING_OUT_OF_SCOPE_UNPROVEN';
  end if;
  v_gate:=jsonb_build_object(
    'LEGACY_SHIPPING_RUNTIME_ACTIVE',false,'HEARTBEAT_V1',0,
    'PHASE_A_V2_ACTIVE',true,'B618_RUNTIME_ACTIVE',true,
    'JOB_LEGACY_CLASSIFICATION_PROVEN',true,'observedAt',v_now);
  insert into public.seller_os_economic_shipping_legacy_recoveries_v1(
    marketplace_account_key,job_id,recovery_generation,classification,
    classification_fingerprint,runtime_commit_sha,status,
    historical_attempt_count,legacy_status,legacy_lease_owner,
    legacy_lease_expires_at,legacy_failure_class,legacy_next_retry_at,
    legacy_first_detected_at,legacy_last_detected_at,legacy_updated_at,
    recovery_dead_letter_at,last_reason_code,gate_receipt)
  values(p_marketplace_account_key,p_job_id,p_recovery_generation,
    'OUT_OF_SCOPE_NO_ACTIVE_LISTING',p_classification_fingerprint,
    p_runtime_commit_sha,'FAILED_TERMINAL',v_job.attempt_count,v_job.status,
    v_job.lease_owner,v_job.lease_expires_at,v_job.failure_class,
    v_job.next_retry_at,v_job.first_detected_at,v_job.last_detected_at,
    v_job.updated_at,v_now,
    'LIVE_LISTING_SHIPPING_EXACT_CURRENT_LIVE_REQUIRED',v_gate);
  update public.seller_os_economic_evidence_refresh_jobs_v1
  set shipping_legacy_recovery_generation=p_recovery_generation,
      status='FAILED_TERMINAL',
      failure_class='LIVE_LISTING_SHIPPING_EXACT_CURRENT_LIVE_REQUIRED',
      next_retry_at=null,lease_owner=null,lease_expires_at=null,
      dead_letter_at=v_now,updated_at=v_now
  where job_id=p_job_id and attempt_count=v_job.attempt_count;
  return jsonb_build_object('closed',true,'deadLetter',true,
    'reasonCode','LIVE_LISTING_SHIPPING_EXACT_CURRENT_LIVE_REQUIRED',
    'historicalAttemptCount',v_job.attempt_count);
end;
$$;

create or replace function
public.begin_seller_os_economic_shipping_legacy_recovery_v1(
  p_marketplace_account_key text,
  p_job_id uuid,
  p_worker_id text,
  p_leader_session_id uuid,
  p_runtime_commit_sha text,
  p_legacy_shipping_runtime_active boolean,
  p_heartbeat_v1_total integer,
  p_phase_a_v2_active boolean,
  p_b618_runtime_active boolean,
  p_classification_fingerprint text,
  p_recovery_generation text,
  p_candidate_id text,
  p_snapshot_digest text,
  p_capture_session_id uuid,
  p_shipping_freshness_generation text,
  p_required_evidence_after timestamptz,
  p_reuse_fresh_evidence boolean default false,
  p_lease_seconds integer default 900,
  p_max_recovery_attempts integer default 5
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_job public.seller_os_economic_evidence_refresh_jobs_v1%rowtype;
  v_existing public.seller_os_economic_shipping_legacy_recoveries_v1%rowtype;
  v_classification jsonb;
  v_attempt integer;
  v_secondary boolean:=false;
  v_terminal boolean;
  v_reason text;
  v_gate jsonb;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_runtime_commit_sha<>
        'b618350a9848e8b49f3c0590270afe2d0ec91c14'
      or p_legacy_shipping_runtime_active is distinct from false
      or p_heartbeat_v1_total<>0
      or p_phase_a_v2_active is distinct from true
      or p_b618_runtime_active is distinct from true
      or p_classification_fingerprint !~ '^sha256:[0-9a-f]{64}$'
      or p_recovery_generation !~
        '^economic-shipping-legacy-recovery-v1:sha256:[0-9a-f]{64}$'
      or p_worker_id !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or p_candidate_id !~ '^sha256:[0-9a-f]{64}$'
      or p_snapshot_digest !~ '^sha256:[0-9a-f]{64}$'
      or p_shipping_freshness_generation !~
        '^economic-shipping-refresh-v1:sha256:[0-9a-f]{64}$'
      or p_required_evidence_after is null
      or p_reuse_fresh_evidence is null
      or p_lease_seconds not between 30 and 900
      or p_max_recovery_attempts<>5 then
    raise exception 'SELLER_OS_LEGACY_SHIPPING_RECOVERY_GATE_FAILED';
  end if;
  if not exists (
    select 1
    from public.seller_os_browser_workload_leases_v1 lease
    join public.seller_os_browser_workload_leader_heartbeats_v1 heartbeat
      using (marketplace_account_key,worker_family,leader_session_id,
        worker_instance_id,lease_generation)
    where lease.marketplace_account_key=p_marketplace_account_key
      and lease.worker_family='LUNA_SHIPPING'
      and lease.leader_session_id=p_leader_session_id
      and lease.worker_instance_id=p_worker_id
      and lease.lease_expires_at>v_now and heartbeat.fresh_until>v_now
  ) then
    raise exception 'SELLER_OS_LEGACY_SHIPPING_RECOVERY_LEADER_UNPROVEN';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'seller-os-economic-shipping-legacy-recovery:'||
      p_marketplace_account_key||':'||p_job_id::text,0));
  select * into v_job
  from public.seller_os_economic_evidence_refresh_jobs_v1
  where job_id=p_job_id and marketplace_account_key=p_marketplace_account_key
  for update;
  if not found then
    return jsonb_build_object('admitted',false,
      'reasonCode','LEGACY_SHIPPING_JOB_NOT_RECOVERY_CLAIMABLE');
  end if;
  select * into v_existing
  from public.seller_os_economic_shipping_legacy_recoveries_v1
  where marketplace_account_key=p_marketplace_account_key
    and job_id=p_job_id for update;
  if found then
    if v_existing.recovery_generation<>p_recovery_generation
        or v_existing.classification_fingerprint<>
          p_classification_fingerprint
        or v_job.attempt_count<>v_existing.historical_attempt_count
        or v_job.shipping_legacy_recovery_generation<>
          p_recovery_generation
        or (v_existing.candidate_id is not null and
          v_existing.candidate_id<>p_candidate_id)
        or (v_existing.snapshot_digest is not null and
          v_existing.snapshot_digest<>p_snapshot_digest)
        or (v_existing.shipping_freshness_generation is not null and
          v_existing.shipping_freshness_generation<>
            p_shipping_freshness_generation)
        or (v_existing.required_evidence_after is not null and
          v_existing.required_evidence_after<>p_required_evidence_after) then
      raise exception 'SELLER_OS_LEGACY_SHIPPING_RECOVERY_BINDING_MISMATCH';
    end if;
    if v_existing.status='COMPLETED' then
      return jsonb_build_object('admitted',false,'alreadyCompleted',true,
        'reasonCode','LEGACY_SHIPPING_RECOVERY_ALREADY_COMPLETED');
    end if;
    if v_existing.status='FAILED_TERMINAL' then
      return jsonb_build_object('admitted',false,'deadLetter',true,
        'reasonCode',v_existing.last_reason_code);
    end if;
    if v_existing.status='ACTIVE' and
        v_existing.active_lease_expires_at>v_now then
      return jsonb_build_object('admitted',
        v_existing.active_worker_id=p_worker_id and
          v_existing.capture_session_id=p_capture_session_id,
        'idempotent',v_existing.active_worker_id=p_worker_id and
          v_existing.capture_session_id=p_capture_session_id,
        'reasonCode','LEGACY_SHIPPING_RECOVERY_ALREADY_ACTIVE',
        'recoveryAttemptOrdinal',v_existing.recovery_attempt_count);
    end if;
    if v_existing.recovery_next_retry_at is not null and
        v_existing.recovery_next_retry_at>v_now then
      return jsonb_build_object('admitted',false,
        'reasonCode','LEGACY_SHIPPING_RECOVERY_BACKOFF_ACTIVE');
    end if;
    if v_job.lease_expires_at is not null and
        v_job.lease_expires_at>v_now then
      return jsonb_build_object('admitted',false,
        'reasonCode','LEGACY_SHIPPING_JOB_NOT_RECOVERY_CLAIMABLE');
    end if;
  else
    v_classification:=public.classify_seller_os_economic_shipping_legacy_job_v1(
      p_marketplace_account_key,p_job_id);
    if (v_classification->>'classificationProven')::boolean is distinct from true
        or v_classification->>'classificationFingerprint'<>
          p_classification_fingerprint then
      raise exception 'SELLER_OS_LEGACY_SHIPPING_CLASSIFICATION_UNPROVEN';
    end if;
    v_gate:=jsonb_build_object(
      'LEGACY_SHIPPING_RUNTIME_ACTIVE',false,'HEARTBEAT_V1',0,
      'PHASE_A_V2_ACTIVE',true,'B618_RUNTIME_ACTIVE',true,
      'JOB_LEGACY_CLASSIFICATION_PROVEN',true,
      'leaderSessionId',p_leader_session_id,'workerId',p_worker_id,
      'observedAt',v_now);
    if v_classification->>'classification'<>'RECOVERABLE_VALID_SCOPE' then
      raise exception 'SELLER_OS_LEGACY_SHIPPING_RECOVERABLE_SCOPE_REQUIRED';
    end if;
    insert into public.seller_os_economic_shipping_legacy_recoveries_v1(
      marketplace_account_key,job_id,recovery_generation,classification,
      classification_fingerprint,runtime_commit_sha,status,
      historical_attempt_count,legacy_status,legacy_lease_owner,
      legacy_lease_expires_at,legacy_failure_class,legacy_next_retry_at,
      legacy_first_detected_at,legacy_last_detected_at,legacy_updated_at,
      gate_receipt)
    values(p_marketplace_account_key,p_job_id,p_recovery_generation,
      v_classification->>'classification',p_classification_fingerprint,
      p_runtime_commit_sha,'FAILED_RETRYABLE',
      v_job.attempt_count,v_job.status,v_job.lease_owner,
      v_job.lease_expires_at,v_job.failure_class,v_job.next_retry_at,
      v_job.first_detected_at,v_job.last_detected_at,v_job.updated_at,v_gate)
    returning * into v_existing;
    update public.seller_os_economic_evidence_refresh_jobs_v1
    set shipping_legacy_recovery_generation=p_recovery_generation
    where job_id=p_job_id;
  end if;

  v_attempt:=v_existing.recovery_attempt_count+1;
  if v_attempt>p_max_recovery_attempts then
    update public.seller_os_economic_shipping_legacy_recoveries_v1
    set status='FAILED_TERMINAL',recovery_next_retry_at=null,
        recovery_dead_letter_at=v_now,
        last_reason_code='LEGACY_SHIPPING_RECOVERY_MAX_ATTEMPTS_EXHAUSTED',
        active_worker_id=null,active_lease_expires_at=null,updated_at=v_now
    where recovery_id=v_existing.recovery_id;
    update public.seller_os_economic_evidence_refresh_jobs_v1
    set status='FAILED_TERMINAL',
        failure_class='LEGACY_SHIPPING_RECOVERY_MAX_ATTEMPTS_EXHAUSTED',
        next_retry_at=null,lease_owner=null,lease_expires_at=null,
        dead_letter_at=v_now,updated_at=v_now
    where job_id=p_job_id;
    return jsonb_build_object('admitted',false,'deadLetter',true,
      'reasonCode','LEGACY_SHIPPING_RECOVERY_MAX_ATTEMPTS_EXHAUSTED');
  end if;

  if p_reuse_fresh_evidence then
    v_secondary:=true;
  else
  insert into public.seller_os_luna_shipping_job_claims as claim(
    account_key,candidate_id,snapshot_digest,runtime_instance_id,
    capture_session_id,status,claimed_at,lease_expires_at,completed_at,
    updated_at,freshness_generation,required_evidence_after)
  values(p_marketplace_account_key,p_candidate_id,p_snapshot_digest,
    p_worker_id::uuid,p_capture_session_id,'CLAIMED',v_now,
    v_now+make_interval(secs=>p_lease_seconds),null,v_now,
    p_shipping_freshness_generation,p_required_evidence_after)
  on conflict(account_key,candidate_id) do update set
    snapshot_digest=excluded.snapshot_digest,
    runtime_instance_id=excluded.runtime_instance_id,
    capture_session_id=excluded.capture_session_id,status='CLAIMED',
    claimed_at=excluded.claimed_at,
    lease_expires_at=excluded.lease_expires_at,completed_at=null,
    updated_at=excluded.updated_at,
    freshness_generation=excluded.freshness_generation,
    required_evidence_after=excluded.required_evidence_after
  where (claim.status='COMPLETED' and claim.freshness_generation is distinct
      from excluded.freshness_generation)
    or (claim.status='CLAIMED' and claim.lease_expires_at<=v_now)
  returning true into v_secondary;
  end if;
  if not coalesce(v_secondary,false) then
    v_terminal:=v_attempt>=p_max_recovery_attempts;
    v_reason:='LEGACY_SHIPPING_RECOVERY_EXECUTOR_ADMISSION_CONFLICT';
    update public.seller_os_economic_shipping_legacy_recoveries_v1
    set status=case when v_terminal then 'FAILED_TERMINAL'
          else 'FAILED_RETRYABLE' end,
        recovery_attempt_count=v_attempt,
        recovery_next_retry_at=case when v_terminal then null else
          v_now+public.seller_os_economic_shipping_legacy_recovery_delay_v1(
            v_attempt) end,
        recovery_dead_letter_at=case when v_terminal then v_now else null end,
        last_reason_code=v_reason,active_worker_id=null,
        active_lease_expires_at=null,updated_at=v_now
    where recovery_id=v_existing.recovery_id;
    update public.seller_os_economic_evidence_refresh_jobs_v1
    set status=case when v_terminal then 'FAILED_TERMINAL'
          else 'FAILED_RETRYABLE' end,
        failure_class=v_reason,
        next_retry_at=case when v_terminal then null else
          v_now+public.seller_os_economic_shipping_legacy_recovery_delay_v1(
            v_attempt) end,
        lease_owner=null,lease_expires_at=null,
        dead_letter_at=case when v_terminal then v_now else null end,
        updated_at=v_now
    where job_id=p_job_id;
    return jsonb_build_object('admitted',false,'deadLetter',v_terminal,
      'reasonCode',v_reason,'recoveryAttemptOrdinal',v_attempt,
      'historicalAttemptCount',v_job.attempt_count);
  end if;

  update public.seller_os_economic_shipping_legacy_recoveries_v1
  set status='ACTIVE',recovery_attempt_count=v_attempt,
      recovery_next_retry_at=null,recovery_dead_letter_at=null,
      active_worker_id=p_worker_id,
      active_lease_expires_at=v_now+make_interval(secs=>p_lease_seconds),
      candidate_id=p_candidate_id,snapshot_digest=p_snapshot_digest,
      capture_session_id=p_capture_session_id,
      shipping_freshness_generation=p_shipping_freshness_generation,
      required_evidence_after=p_required_evidence_after,
      last_reason_code=null,updated_at=v_now
  where recovery_id=v_existing.recovery_id;
  update public.seller_os_economic_evidence_refresh_jobs_v1
  set status='REFRESHING',lease_owner=p_worker_id,
      lease_expires_at=v_now+make_interval(secs=>p_lease_seconds),
      failure_class=null,next_retry_at=null,dead_letter_at=null,
      shipping_freshness_generation=p_shipping_freshness_generation,
      shipping_required_evidence_after=p_required_evidence_after,
      updated_at=v_now
  where job_id=p_job_id;
  return jsonb_build_object('admitted',true,
    'reasonCode',case when p_reuse_fresh_evidence then
      'LEGACY_SHIPPING_RECOVERY_FRESH_EVIDENCE_REUSE_ADMITTED'
      else 'LEGACY_SHIPPING_RECOVERY_B618_HANDOFF_ADMITTED' end,
    'reuseFreshEvidence',p_reuse_fresh_evidence,
    'recoveryAttemptOrdinal',v_attempt,
    'historicalAttemptCount',v_job.attempt_count,
    'recoveryGeneration',p_recovery_generation,
    'freshnessGeneration',p_shipping_freshness_generation);
end;
$$;

create or replace function
public.fail_seller_os_economic_shipping_legacy_recovery_v1(
  p_marketplace_account_key text,
  p_job_id uuid,
  p_worker_id text,
  p_recovery_generation text,
  p_shipping_freshness_generation text,
  p_reason_code text,
  p_retryable boolean default true
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_recovery public.seller_os_economic_shipping_legacy_recoveries_v1%rowtype;
  v_terminal boolean;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_reason_code !~ '^[A-Z0-9_]{8,160}$' then
    raise exception 'SELLER_OS_LEGACY_SHIPPING_RECOVERY_FAILURE_INVALID';
  end if;
  select * into v_recovery
  from public.seller_os_economic_shipping_legacy_recoveries_v1
  where marketplace_account_key=p_marketplace_account_key
    and job_id=p_job_id and recovery_generation=p_recovery_generation
  for update;
  if not found or v_recovery.status<>'ACTIVE'
      or v_recovery.active_worker_id<>p_worker_id
      or v_recovery.shipping_freshness_generation<>
        p_shipping_freshness_generation then
    return jsonb_build_object('closed',false,
      'reasonCode','LEGACY_SHIPPING_RECOVERY_FAILURE_BINDING_MISMATCH');
  end if;
  v_terminal:=not p_retryable or v_recovery.recovery_attempt_count>=5;
  update public.seller_os_luna_shipping_job_claims
  set lease_expires_at=greatest(v_now,claimed_at+interval '1 millisecond'),
      updated_at=v_now
  where account_key=p_marketplace_account_key
    and candidate_id=v_recovery.candidate_id
    and freshness_generation=p_shipping_freshness_generation
    and runtime_instance_id=p_worker_id::uuid and status='CLAIMED';
  update public.seller_os_economic_shipping_legacy_recoveries_v1
  set status=case when v_terminal then 'FAILED_TERMINAL'
        else 'FAILED_RETRYABLE' end,
      recovery_next_retry_at=case when v_terminal then null else
        v_now+public.seller_os_economic_shipping_legacy_recovery_delay_v1(
          recovery_attempt_count) end,
      recovery_dead_letter_at=case when v_terminal then v_now else null end,
      last_reason_code=p_reason_code,active_worker_id=null,
      active_lease_expires_at=null,updated_at=v_now
  where recovery_id=v_recovery.recovery_id;
  update public.seller_os_economic_evidence_refresh_jobs_v1
  set status=case when v_terminal then 'FAILED_TERMINAL'
        else 'FAILED_RETRYABLE' end,
      failure_class=p_reason_code,
      next_retry_at=case when v_terminal then null else
        v_now+public.seller_os_economic_shipping_legacy_recovery_delay_v1(
          v_recovery.recovery_attempt_count) end,
      lease_owner=null,lease_expires_at=null,
      dead_letter_at=case when v_terminal then v_now else null end,
      updated_at=v_now
  where job_id=p_job_id and attempt_count=v_recovery.historical_attempt_count;
  return jsonb_build_object('closed',true,
    'status',case when v_terminal then 'FAILED_TERMINAL'
      else 'FAILED_RETRYABLE' end,'deadLetter',v_terminal,
    'reasonCode',p_reason_code,
    'recoveryAttemptOrdinal',v_recovery.recovery_attempt_count,
    'historicalAttemptCount',v_recovery.historical_attempt_count);
end;
$$;

create or replace function
public.finish_seller_os_economic_shipping_legacy_recovery_v1(
  p_marketplace_account_key text,
  p_job_id uuid,
  p_worker_id text,
  p_recovery_generation text,
  p_shipping_freshness_generation text,
  p_last_evidence_id text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_recovery public.seller_os_economic_shipping_legacy_recoveries_v1%rowtype;
  v_count integer;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_last_evidence_id !~
        '^economic-evidence-v1:sha256:[0-9a-f]{64}$' then
    raise exception 'SELLER_OS_LEGACY_SHIPPING_RECOVERY_FINISH_INVALID';
  end if;
  select * into v_recovery
  from public.seller_os_economic_shipping_legacy_recoveries_v1
  where marketplace_account_key=p_marketplace_account_key
    and job_id=p_job_id and recovery_generation=p_recovery_generation
  for update;
  if not found or v_recovery.status<>'ACTIVE'
      or v_recovery.active_worker_id<>p_worker_id
      or v_recovery.shipping_freshness_generation<>
        p_shipping_freshness_generation
      or v_recovery.active_lease_expires_at<=v_now then
    return jsonb_build_object('finished',false,
      'reasonCode','LEGACY_SHIPPING_RECOVERY_FINISH_BINDING_MISMATCH');
  end if;
  update public.seller_os_economic_evidence_refresh_jobs_v1
  set status='FRESH',last_evidence_id=p_last_evidence_id,
      failure_class=null,next_retry_at=null,lease_owner=null,
      lease_expires_at=null,dead_letter_at=null,updated_at=v_now
  where job_id=p_job_id and marketplace_account_key=p_marketplace_account_key
    and lease_owner=p_worker_id
    and shipping_legacy_recovery_generation=p_recovery_generation
    and shipping_freshness_generation=p_shipping_freshness_generation
    and attempt_count=v_recovery.historical_attempt_count;
  get diagnostics v_count=row_count;
  if v_count<>1 then
    return jsonb_build_object('finished',false,
      'reasonCode','LEGACY_SHIPPING_RECOVERY_JOB_CAS_MISMATCH');
  end if;
  update public.seller_os_economic_shipping_legacy_recoveries_v1
  set status='COMPLETED',recovery_next_retry_at=null,
      active_worker_id=null,active_lease_expires_at=null,
      last_reason_code=null,updated_at=v_now
  where recovery_id=v_recovery.recovery_id;
  return jsonb_build_object('finished',true,'status','COMPLETED',
    'recoveryAttemptOrdinal',v_recovery.recovery_attempt_count,
    'historicalAttemptCount',v_recovery.historical_attempt_count);
end;
$$;

-- Preserve the original claim contract while excluding only rows explicitly
-- owned by the recovery authority. External writes for every other job retain
-- advisory/SKIP LOCKED behavior and their historical attempt semantics.
create or replace function public.claim_seller_os_economic_refresh_jobs_v1(
  p_marketplace_account_key text,
  p_worker_id text,
  p_evidence_types text[] default null,
  p_limit integer default 4,
  p_lease_seconds integer default 180
)
returns setof public.seller_os_economic_evidence_refresh_jobs_v1
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
begin
  if p_marketplace_account_key is null
      or char_length(p_marketplace_account_key) not between 8 and 200
      or p_worker_id is null or char_length(p_worker_id) not between 8 and 160
      or p_limit not between 1 and 100
      or p_lease_seconds not between 30 and 900 then
    raise exception 'SELLER_OS_ECONOMIC_REFRESH_CLAIM_INVALID';
  end if;
  return query
  with selected as (
    select job_id from public.seller_os_economic_evidence_refresh_jobs_v1
    where marketplace_account_key=p_marketplace_account_key
      and status in ('STALE','MISSING','WAITING_FOR_WORKER',
        'FAILED_RETRYABLE')
      and (p_evidence_types is null or evidence_type=any(p_evidence_types))
      and (next_retry_at is null or next_retry_at<=clock_timestamp())
      and (lease_expires_at is null or lease_expires_at<=clock_timestamp())
      and not (evidence_type='LUNA_CURRENT_SHIPPING' and
        shipping_legacy_recovery_generation is not null)
    order by case status when 'MISSING' then 0 when 'STALE' then 1
      when 'FAILED_RETRYABLE' then 2 else 3 end,
      last_detected_at,ebay_item_id,evidence_type
    for update skip locked limit p_limit
  )
  update public.seller_os_economic_evidence_refresh_jobs_v1 job
  set status='REFRESHING',lease_owner=p_worker_id,
      lease_expires_at=clock_timestamp()+
        make_interval(secs=>p_lease_seconds),
      attempt_count=job.attempt_count+1,updated_at=clock_timestamp()
  from selected where job.job_id=selected.job_id
  returning job.*;
end;
$$;

revoke all on function
  public.seller_os_economic_shipping_legacy_recovery_delay_v1(integer)
  from public,anon,authenticated;
revoke all on function
  public.classify_seller_os_economic_shipping_legacy_job_v1(text,uuid)
  from public,anon,authenticated;
revoke all on function
  public.close_seller_os_economic_shipping_legacy_out_of_scope_v1(
    text,uuid,text,boolean,integer,boolean,boolean,text,text)
  from public,anon,authenticated;
revoke all on function
  public.begin_seller_os_economic_shipping_legacy_recovery_v1(
    text,uuid,text,uuid,text,boolean,integer,boolean,boolean,text,text,text,
    text,uuid,text,timestamptz,boolean,integer,integer)
  from public,anon,authenticated;
revoke all on function
  public.fail_seller_os_economic_shipping_legacy_recovery_v1(
    text,uuid,text,text,text,text,boolean)
  from public,anon,authenticated;
revoke all on function
  public.finish_seller_os_economic_shipping_legacy_recovery_v1(
    text,uuid,text,text,text,text)
  from public,anon,authenticated;
grant execute on function
  public.seller_os_economic_shipping_legacy_recovery_delay_v1(integer)
  to service_role;
grant execute on function
  public.classify_seller_os_economic_shipping_legacy_job_v1(text,uuid)
  to service_role;
grant execute on function
  public.close_seller_os_economic_shipping_legacy_out_of_scope_v1(
    text,uuid,text,boolean,integer,boolean,boolean,text,text)
  to service_role;
grant execute on function
  public.begin_seller_os_economic_shipping_legacy_recovery_v1(
    text,uuid,text,uuid,text,boolean,integer,boolean,boolean,text,text,text,
    text,uuid,text,timestamptz,boolean,integer,integer)
  to service_role;
grant execute on function
  public.fail_seller_os_economic_shipping_legacy_recovery_v1(
    text,uuid,text,text,text,text,boolean)
  to service_role;
grant execute on function
  public.finish_seller_os_economic_shipping_legacy_recovery_v1(
    text,uuid,text,text,text,text)
  to service_role;

notify pgrst,'reload schema';
