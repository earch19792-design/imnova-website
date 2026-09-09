-- Incident disposition is historical control-plane evidence, not Shipping
-- recovery. This append-only authority deliberately leaves the economic job,
-- its attempts, leases, and every recovery generation untouched.

create table public.seller_os_legacy_shipping_incident_dispositions_v1 (
  disposition_id text primary key,
  cohort_id text not null,
  job_id uuid not null,
  disposition text not null,
  incident_classification text not null,
  incident_membership_digest text not null,
  incident_evidence_digest text not null,
  source_receipt_id text not null,
  disposition_reason text not null,
  authority_version text not null,
  authority_identity text not null,
  disposition_digest text not null unique,
  created_at timestamptz not null default clock_timestamp(),
  constraint seller_os_legacy_shipping_incident_disposition_member_fk
    foreign key (cohort_id,job_id) references
      public.seller_os_legacy_shipping_incident_members_v1(cohort_id,job_id),
  constraint seller_os_legacy_shipping_incident_disposition_id_check check (
    disposition_id ~
      '^legacy-shipping-incident-disposition-v2:sha256:[0-9a-f]{64}$'),
  constraint seller_os_legacy_shipping_incident_disposition_check check (
    disposition='OUT_OF_SCOPE' and
    incident_classification='OUT_OF_SCOPE_NO_ACTIVE_LISTING'),
  constraint seller_os_legacy_shipping_incident_disposition_digest_check
    check (incident_membership_digest ~ '^sha256:[0-9a-f]{64}$' and
      incident_evidence_digest ~ '^sha256:[0-9a-f]{64}$' and
      disposition_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint seller_os_legacy_shipping_incident_disposition_reason_check
    check (disposition_reason=
      'LIVE_LISTING_SHIPPING_EXACT_CURRENT_LIVE_REQUIRED'),
  constraint seller_os_legacy_shipping_incident_disposition_authority_check
    check (authority_version=
      'SELLER_OS_LEGACY_SHIPPING_OUT_OF_SCOPE_DISPOSITION_CONTRACT_V2' and
      authority_identity='SELLER_OS_INCIDENT_DISPOSITION_AUTHORITY_V2'),
  unique (cohort_id,job_id,disposition)
);

create or replace function
public.prevent_seller_os_legacy_shipping_incident_disposition_mutation_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'SELLER_OS_LEGACY_SHIPPING_INCIDENT_DISPOSITION_IMMUTABLE';
end;
$$;

create trigger seller_os_legacy_shipping_incident_dispositions_immutable_v1
before update or delete
on public.seller_os_legacy_shipping_incident_dispositions_v1
for each row execute function
  public.prevent_seller_os_legacy_shipping_incident_disposition_mutation_v1();

revoke all on function
  public.prevent_seller_os_legacy_shipping_incident_disposition_mutation_v1()
  from public,anon,authenticated,service_role;

alter table public.seller_os_legacy_shipping_incident_dispositions_v1
  enable row level security;
alter table public.seller_os_legacy_shipping_incident_dispositions_v1
  force row level security;
revoke all on table
  public.seller_os_legacy_shipping_incident_dispositions_v1
  from public,anon,authenticated,service_role;
grant select on table
  public.seller_os_legacy_shipping_incident_dispositions_v1
  to service_role;

create or replace function
public.close_seller_os_economic_shipping_legacy_out_of_scope_v2(
  p_marketplace_account_key text,
  p_cohort_id text,
  p_job_id uuid
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_cohort public.seller_os_legacy_shipping_incident_cohorts_v1%rowtype;
  v_member public.seller_os_legacy_shipping_incident_members_v1%rowtype;
  v_job record;
  v_existing
    public.seller_os_legacy_shipping_incident_dispositions_v1%rowtype;
  v_disposition_id text;
  v_disposition_digest text;
  v_reason constant text :=
    'LIVE_LISTING_SHIPPING_EXACT_CURRENT_LIVE_REQUIRED';
  v_authority_version constant text :=
    'SELLER_OS_LEGACY_SHIPPING_OUT_OF_SCOPE_DISPOSITION_CONTRACT_V2';
  v_authority_identity constant text :=
    'SELLER_OS_INCIDENT_DISPOSITION_AUTHORITY_V2';
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(trim(coalesce(p_marketplace_account_key,'')))
        not between 8 and 200
      or p_cohort_id !~
        '^legacy-shipping-incident-v1:sha256:[0-9a-f]{64}$'
      or p_job_id is null then
    raise exception 'SELLER_OS_INCIDENT_OUT_OF_SCOPE_DISPOSITION_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'seller-os-incident-out-of-scope-disposition-v2:'||
      p_cohort_id||':'||p_job_id::text,0));

  select cohort.cohort_id,cohort.marketplace_account_key,
    cohort.contract_version,cohort.cohort_created_at,cohort.source_receipt_id,
    cohort.membership_digest,cohort.evidence_digest,cohort.member_count,
    cohort.source_boundary,cohort.created_at
  into v_cohort
  from public.seller_os_legacy_shipping_incident_cohorts_v1 cohort
  where cohort.cohort_id=p_cohort_id;
  if not found then
    raise exception 'SELLER_OS_INCIDENT_COHORT_NOT_FOUND';
  end if;
  if v_cohort.marketplace_account_key<>p_marketplace_account_key then
    raise exception 'SELLER_OS_INCIDENT_COHORT_ACCOUNT_BINDING_MISMATCH';
  end if;

  select member.cohort_id,member.job_id,member.incident_classification,
    member.snapshot_attempt_count,member.ebay_item_id,member.source_sku,
    member.snapshot_lease_owner,member.snapshot_lease_expires_at
  into v_member
  from public.seller_os_legacy_shipping_incident_members_v1 member
  where member.cohort_id=p_cohort_id and member.job_id=p_job_id;
  if not found or v_member.incident_classification<>
      'OUT_OF_SCOPE_NO_ACTIVE_LISTING' then
    raise exception 'SELLER_OS_INCIDENT_OUT_OF_SCOPE_MEMBERSHIP_REQUIRED';
  end if;

  select job.status,job.attempt_count,
    job.shipping_legacy_recovery_generation
  into v_job
  from public.seller_os_economic_evidence_refresh_jobs_v1 job
  where job.job_id=p_job_id
    and job.marketplace_account_key=v_cohort.marketplace_account_key
    and job.evidence_type='LUNA_CURRENT_SHIPPING';
  if not found then
    raise exception 'SELLER_OS_INCIDENT_ECONOMIC_JOB_NOT_FOUND';
  end if;
  if v_job.shipping_legacy_recovery_generation is not null
      or exists(select 1
        from public.seller_os_economic_shipping_legacy_recoveries_v1 recovery
        where recovery.marketplace_account_key=
          v_cohort.marketplace_account_key
          and recovery.job_id=p_job_id) then
    raise exception 'SELLER_OS_INCIDENT_RECOVERY_STATE_PRESENT';
  end if;

  v_disposition_digest:='sha256:'||encode(extensions.digest(convert_to(
    concat_ws(E'\n',p_cohort_id,p_job_id::text,'OUT_OF_SCOPE',
      v_member.incident_classification,v_cohort.membership_digest,
      v_cohort.evidence_digest,v_cohort.source_receipt_id,v_reason,
      v_authority_version,v_authority_identity),'UTF8'),'sha256'),'hex');
  v_disposition_id:=
    'legacy-shipping-incident-disposition-v2:'||v_disposition_digest;

  select disposition_row.disposition_id,disposition_row.cohort_id,
    disposition_row.job_id,disposition_row.disposition,
    disposition_row.incident_classification,
    disposition_row.incident_membership_digest,
    disposition_row.incident_evidence_digest,
    disposition_row.source_receipt_id,disposition_row.disposition_reason,
    disposition_row.authority_version,disposition_row.authority_identity,
    disposition_row.disposition_digest,disposition_row.created_at
  into v_existing
  from public.seller_os_legacy_shipping_incident_dispositions_v1
    disposition_row
  where disposition_row.cohort_id=p_cohort_id
    and disposition_row.job_id=p_job_id;
  if found then
    if v_existing.disposition_id<>v_disposition_id
        or v_existing.disposition<>'OUT_OF_SCOPE'
        or v_existing.incident_classification<>
          v_member.incident_classification
        or v_existing.incident_membership_digest<>
          v_cohort.membership_digest
        or v_existing.incident_evidence_digest<>v_cohort.evidence_digest
        or v_existing.source_receipt_id<>v_cohort.source_receipt_id
        or v_existing.disposition_reason<>v_reason
        or v_existing.authority_version<>v_authority_version
        or v_existing.authority_identity<>v_authority_identity
        or v_existing.disposition_digest<>v_disposition_digest then
      raise exception 'SELLER_OS_INCIDENT_DISPOSITION_CONFLICT';
    end if;
    return jsonb_build_object(
      'closed',true,'idempotent',true,
      'dispositionId',v_existing.disposition_id,
      'dispositionDigest',v_existing.disposition_digest,
      'disposition','OUT_OF_SCOPE','reasonCode',v_reason,
      'historicalAttemptCount',v_member.snapshot_attempt_count,
      'economicJobStateMutated',false,
      'recoveryRowCreated',false,'recoveryGenerationCreated',false,
      'shippingLegacyRecoveryGenerationCreated',false,
      'chromeDispatchCount',0,'marketplaceWriteCount',0);
  end if;

  insert into public.seller_os_legacy_shipping_incident_dispositions_v1(
    disposition_id,cohort_id,job_id,disposition,incident_classification,
    incident_membership_digest,incident_evidence_digest,source_receipt_id,
    disposition_reason,authority_version,authority_identity,
    disposition_digest)
  values(v_disposition_id,p_cohort_id,p_job_id,'OUT_OF_SCOPE',
    v_member.incident_classification,v_cohort.membership_digest,
    v_cohort.evidence_digest,v_cohort.source_receipt_id,v_reason,
    v_authority_version,v_authority_identity,v_disposition_digest);

  return jsonb_build_object(
    'closed',true,'idempotent',false,
    'dispositionId',v_disposition_id,
    'dispositionDigest',v_disposition_digest,
    'disposition','OUT_OF_SCOPE','reasonCode',v_reason,
    'historicalAttemptCount',v_member.snapshot_attempt_count,
    'economicJobStateMutated',false,
    'recoveryRowCreated',false,'recoveryGenerationCreated',false,
    'shippingLegacyRecoveryGenerationCreated',false,
    'chromeDispatchCount',0,'marketplaceWriteCount',0);
end;
$$;

revoke all on function
  public.close_seller_os_economic_shipping_legacy_out_of_scope_v2(
    text,text,uuid)
  from public,anon,authenticated;
grant execute on function
  public.close_seller_os_economic_shipping_legacy_out_of_scope_v2(
    text,text,uuid)
  to service_role;

-- The V1 out-of-scope path mixed disposition with recovery. Existing recovery
-- records remain readable, but new service-role calls must use V2.
revoke execute on function
  public.close_seller_os_economic_shipping_legacy_out_of_scope_v1(
    text,uuid,text,boolean,integer,boolean,boolean,text,text)
  from service_role;

create or replace function
public.read_seller_os_legacy_shipping_incident_cohort_v1(
  p_cohort_id text
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_cohort public.seller_os_legacy_shipping_incident_cohorts_v1%rowtype;
  v_actual_count integer;
  v_membership_digest text;
  v_recovered integer;
  v_unresolved integer;
  v_out_of_scope integer;
  v_out_of_scope_disposed integer;
  v_pending integer;
  v_members jsonb;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_cohort_id !~
        '^legacy-shipping-incident-v1:sha256:[0-9a-f]{64}$' then
    raise exception 'SELLER_OS_LEGACY_SHIPPING_INCIDENT_COHORT_READ_INVALID';
  end if;
  select cohort.cohort_id,cohort.marketplace_account_key,
    cohort.contract_version,cohort.cohort_created_at,cohort.source_receipt_id,
    cohort.membership_digest,cohort.evidence_digest,cohort.member_count,
    cohort.source_boundary,cohort.created_at
  into v_cohort
  from public.seller_os_legacy_shipping_incident_cohorts_v1 cohort
  where cohort.cohort_id=p_cohort_id;
  if not found then
    return jsonb_build_object('status','UNPROVEN',
      'blocker','INCIDENT_COHORT_NOT_FOUND');
  end if;

  select count(*)::integer,
    'sha256:'||encode(extensions.digest(convert_to(string_agg(
      member.job_id::text||'|'||member.incident_classification,
      E'\n' order by member.job_id),'UTF8'),'sha256'),'hex')
  into v_actual_count,v_membership_digest
  from public.seller_os_legacy_shipping_incident_members_v1 member
  where member.cohort_id=p_cohort_id;
  if v_actual_count<>v_cohort.member_count
      or v_membership_digest<>v_cohort.membership_digest then
    raise exception 'SELLER_OS_LEGACY_SHIPPING_INCIDENT_COHORT_DRIFT';
  end if;

  select
    count(*) filter(where member.incident_classification=
      'RECOVERABLE_VALID_SCOPE' and recovery.status='COMPLETED')::integer,
    count(*) filter(where member.incident_classification=
      'RECOVERABLE_VALID_SCOPE' and
      recovery.status is distinct from 'COMPLETED')::integer,
    count(*) filter(where member.incident_classification=
      'OUT_OF_SCOPE_NO_ACTIVE_LISTING')::integer,
    count(*) filter(where member.incident_classification=
      'OUT_OF_SCOPE_NO_ACTIVE_LISTING' and
      disposition.disposition='OUT_OF_SCOPE')::integer,
    count(*) filter(where
      (member.incident_classification='RECOVERABLE_VALID_SCOPE' and
        recovery.status is distinct from 'COMPLETED') or
      (member.incident_classification='OUT_OF_SCOPE_NO_ACTIVE_LISTING' and
        disposition.disposition is distinct from 'OUT_OF_SCOPE'))::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'jobId',member.job_id,
      'incidentClassification',member.incident_classification,
      'snapshotAttemptCount',member.snapshot_attempt_count,
      'recoveryStatus',recovery.status,
      'recovered',recovery.status='COMPLETED',
      'incidentDisposition',disposition.disposition,
      'incidentDispositionId',disposition.disposition_id,
      'incidentDisposed',disposition.disposition='OUT_OF_SCOPE')
      order by member.job_id),'[]'::jsonb)
  into v_recovered,v_unresolved,v_out_of_scope,v_out_of_scope_disposed,
    v_pending,v_members
  from public.seller_os_legacy_shipping_incident_members_v1 member
  left join public.seller_os_economic_shipping_legacy_recoveries_v1 recovery
    on recovery.marketplace_account_key=v_cohort.marketplace_account_key
   and recovery.job_id=member.job_id
  left join public.seller_os_legacy_shipping_incident_dispositions_v1
    disposition
    on disposition.cohort_id=member.cohort_id
   and disposition.job_id=member.job_id
  where member.cohort_id=p_cohort_id;

  return jsonb_build_object(
    'status','PROVEN','contractVersion',v_cohort.contract_version,
    'cohortId',v_cohort.cohort_id,
    'cohortCreatedAt',v_cohort.cohort_created_at,
    'cohortMemberCount',v_cohort.member_count,
    'recoveredMemberCount',v_recovered,
    'unresolvedMemberCount',v_unresolved,
    'outOfScopeMemberCount',v_out_of_scope,
    'outOfScopeDisposedCount',v_out_of_scope_disposed,
    'pendingIncidentMemberCount',v_pending,
    'newJobArrivalsExcluded',true,
    'recoveryWorkPerCycleMax',1,
    'membershipDigest',v_cohort.membership_digest,
    'sourceReceiptId',v_cohort.source_receipt_id,
    'members',v_members);
end;
$$;

revoke all on function
  public.read_seller_os_legacy_shipping_incident_cohort_v1(text)
  from public,anon,authenticated;
grant execute on function
  public.read_seller_os_legacy_shipping_incident_cohort_v1(text)
  to service_role;

notify pgrst,'reload schema';
