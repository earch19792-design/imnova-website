-- Immutable membership boundary for the 19-job legacy Shipping incident.
-- Source receipt: isolated read-only classification captured at
-- 2026-09-08T16:32:21.838Z (receipt
-- ctco_01a081dd-094d-7400-bee9-21c9f8545268). The source query selected the
-- one LUNA_CURRENT_SHIPPING lease batch having exactly 19 members, common
-- lease owner e1c06c6e-87b1-4ee0-aa4b-08f72ba57730 and lease expiry second
-- 2026-09-08T16:38:51Z. New classifier matches are deliberately excluded.

create table public.seller_os_legacy_shipping_incident_cohorts_v1 (
  cohort_id text primary key,
  marketplace_account_key text not null,
  contract_version text not null,
  cohort_created_at timestamptz not null,
  source_receipt_id text not null unique,
  membership_digest text not null,
  evidence_digest text not null,
  member_count integer not null,
  source_boundary jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint seller_os_legacy_shipping_incident_cohort_id_check check (
    cohort_id ~ '^legacy-shipping-incident-v1:sha256:[0-9a-f]{64}$'),
  constraint seller_os_legacy_shipping_incident_contract_check check (
    contract_version = 'LEGACY_SHIPPING_INCIDENT_COHORT_BOUNDARY_V1'),
  constraint seller_os_legacy_shipping_incident_digest_check check (
    membership_digest ~ '^sha256:[0-9a-f]{64}$' and
    evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint seller_os_legacy_shipping_incident_member_count_check check (
    member_count = 19)
);

create table public.seller_os_legacy_shipping_incident_members_v1 (
  cohort_id text not null references
    public.seller_os_legacy_shipping_incident_cohorts_v1(cohort_id),
  job_id uuid not null,
  incident_classification text not null,
  snapshot_attempt_count integer not null,
  ebay_item_id text not null,
  source_sku text null,
  snapshot_lease_owner text not null,
  snapshot_lease_expires_at timestamptz not null,
  primary key (cohort_id, job_id),
  constraint seller_os_legacy_shipping_incident_member_class_check check (
    incident_classification in ('RECOVERABLE_VALID_SCOPE',
      'OUT_OF_SCOPE_NO_ACTIVE_LISTING'))
);

alter table public.seller_os_legacy_shipping_incident_cohorts_v1
  enable row level security;
alter table public.seller_os_legacy_shipping_incident_cohorts_v1
  force row level security;
alter table public.seller_os_legacy_shipping_incident_members_v1
  enable row level security;
alter table public.seller_os_legacy_shipping_incident_members_v1
  force row level security;

revoke all on table public.seller_os_legacy_shipping_incident_cohorts_v1
  from public, anon, authenticated, service_role;
revoke all on table public.seller_os_legacy_shipping_incident_members_v1
  from public, anon, authenticated, service_role;
grant select on table public.seller_os_legacy_shipping_incident_cohorts_v1
  to service_role;
grant select on table public.seller_os_legacy_shipping_incident_members_v1
  to service_role;

insert into public.seller_os_legacy_shipping_incident_cohorts_v1(
  cohort_id,marketplace_account_key,contract_version,cohort_created_at,
  source_receipt_id,membership_digest,evidence_digest,member_count,
  source_boundary)
values(
  'legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba',
  'imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12',
  'LEGACY_SHIPPING_INCIDENT_COHORT_BOUNDARY_V1',
  '2026-09-08T16:32:21.838Z',
  'ctco_01a081dd-094d-7400-bee9-21c9f8545268',
  'sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba',
  'sha256:53cdab991bfd79763b097dfd268f4f015b349d76fc08cec23c25a807263ad5c8',
  19,
  jsonb_build_object(
    'evidenceType','LUNA_CURRENT_SHIPPING',
    'snapshotStatus','REFRESHING',
    'leaseOwner','e1c06c6e-87b1-4ee0-aa4b-08f72ba57730',
    'leaseExpirySecond','2026-09-08T16:38:51Z',
    'selectionRule','LATEST_COMMON_LEASE_BATCH_WITH_EXACTLY_19_MEMBERS'));

insert into public.seller_os_legacy_shipping_incident_members_v1(
  cohort_id,job_id,incident_classification,snapshot_attempt_count,
  ebay_item_id,source_sku,snapshot_lease_owner,snapshot_lease_expires_at)
values
('legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba','089c26b0-4bed-410d-847f-8eefdeee6fa0','RECOVERABLE_VALID_SCOPE',20,'366649437609','ITEM4779','e1c06c6e-87b1-4ee0-aa4b-08f72ba57730','2026-09-08T16:38:51.762639Z'),
('legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba','0ee819a7-ab47-41e9-8601-432a069a858e','RECOVERABLE_VALID_SCOPE',20,'366650071972','FL-DIAMOND-3-LINE-ANKLET','e1c06c6e-87b1-4ee0-aa4b-08f72ba57730','2026-09-08T16:38:51.763071Z'),
('legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba','20de341a-9384-46f0-b912-1116cc40ee41','RECOVERABLE_VALID_SCOPE',20,'366635285436','ITEM3525','e1c06c6e-87b1-4ee0-aa4b-08f72ba57730','2026-09-08T16:38:51.762173Z'),
('legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba','2483007c-76bf-409d-927c-6c812caf53a4','RECOVERABLE_VALID_SCOPE',25,'366592485792','ITEM5803','e1c06c6e-87b1-4ee0-aa4b-08f72ba57730','2026-09-08T16:38:51.761601Z'),
('legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba','31d4a874-dd1a-48c2-ad9d-ee958a38d31c','RECOVERABLE_VALID_SCOPE',20,'366643555454','Alibaba-ScanReader-DigitalPen-B0CPHN5395','e1c06c6e-87b1-4ee0-aa4b-08f72ba57730','2026-09-08T16:38:51.762451Z'),
('legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba','3aed7ef0-e176-426e-a495-87c4f0fc69cf','RECOVERABLE_VALID_SCOPE',20,'366597434810','ITEM5195','e1c06c6e-87b1-4ee0-aa4b-08f72ba57730','2026-09-08T16:38:51.761933Z'),
('legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba','72d87023-822e-441c-a765-e0686b394315','RECOVERABLE_VALID_SCOPE',20,'366592919965','FL-LUXURY-MEN-RING','e1c06c6e-87b1-4ee0-aa4b-08f72ba57730','2026-09-08T16:38:51.761712Z'),
('legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba','7863fcfc-4229-487b-9173-aeb52e3d033f','OUT_OF_SCOPE_NO_ACTIVE_LISTING',31,'366643126310',null,'e1c06c6e-87b1-4ee0-aa4b-08f72ba57730','2026-09-08T16:38:51.762309Z'),
('legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba','7caebdd2-0a0a-4ade-8d0e-65d4e7575c12','RECOVERABLE_VALID_SCOPE',20,'366649508886','ITEM5391','e1c06c6e-87b1-4ee0-aa4b-08f72ba57730','2026-09-08T16:38:51.762737Z'),
('legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba','8f15ed3e-af01-4f75-bedb-7167b906f2e0','RECOVERABLE_VALID_SCOPE',25,'366582671136','ITEM3704','e1c06c6e-87b1-4ee0-aa4b-08f72ba57730','2026-09-08T16:38:51.759930Z'),
('legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba','93d7752f-8253-4298-bb94-1c20bf26ce06','RECOVERABLE_VALID_SCOPE',20,'366643190059','M-Smarthome-Toilet-Paper-Holder-B08DRKHV14','e1c06c6e-87b1-4ee0-aa4b-08f72ba57730','2026-09-08T16:38:51.762383Z'),
('legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba','9ff772e6-6731-40fd-a323-2b7b4a6296e0','RECOVERABLE_VALID_SCOPE',20,'366650054490','FL-NHRN1999804-Color-silver-bracelet','e1c06c6e-87b1-4ee0-aa4b-08f72ba57730','2026-09-08T16:38:51.762928Z'),
('legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba','b1fb48e4-a373-4afa-a446-a600a8e488d4','RECOVERABLE_VALID_SCOPE',20,'366634810965','ITEM3404','e1c06c6e-87b1-4ee0-aa4b-08f72ba57730','2026-09-08T16:38:51.762076Z'),
('legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba','c530396e-9267-4c38-abeb-35c713a07ff8','RECOVERABLE_VALID_SCOPE',20,'366643122092','FL-CUP-PHONE-MOUNT','e1c06c6e-87b1-4ee0-aa4b-08f72ba57730','2026-09-08T16:38:51.762241Z'),
('legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba','c8f02ccf-b030-428b-9e7b-9c45300ce345','RECOVERABLE_VALID_SCOPE',20,'366650065203','FL-NH4570606','e1c06c6e-87b1-4ee0-aa4b-08f72ba57730','2026-09-08T16:38:51.763004Z'),
('legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba','cebb3e18-6d71-4e24-bc2f-2a715730293b','RECOVERABLE_VALID_SCOPE',20,'366650121192','FL-PINK-MAKEUP-STAND','e1c06c6e-87b1-4ee0-aa4b-08f72ba57730','2026-09-08T16:38:51.763500Z'),
('legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba','ea779af2-7800-49e2-8e5b-4ad2543fd9ee','RECOVERABLE_VALID_SCOPE',20,'366650113488','FL-NH4771197','e1c06c6e-87b1-4ee0-aa4b-08f72ba57730','2026-09-08T16:38:51.763136Z'),
('legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba','f88915a9-c137-4418-8d58-315c64c829ff','RECOVERABLE_VALID_SCOPE',21,'366650047727','FL-NHSC1498006-180mm','e1c06c6e-87b1-4ee0-aa4b-08f72ba57730','2026-09-08T16:38:51.762846Z'),
('legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba','fc263719-7eb5-4187-b279-968846f2bfec','RECOVERABLE_VALID_SCOPE',20,'366647547173','ITEM3663','e1c06c6e-87b1-4ee0-aa4b-08f72ba57730','2026-09-08T16:38:51.762568Z');

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
  v_members jsonb;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_cohort_id !~
        '^legacy-shipping-incident-v1:sha256:[0-9a-f]{64}$' then
    raise exception 'SELLER_OS_LEGACY_SHIPPING_INCIDENT_COHORT_READ_INVALID';
  end if;
  select cohort.cohort_id,cohort.marketplace_account_key,
    cohort.contract_version,cohort.cohort_created_at,
    cohort.source_receipt_id,cohort.membership_digest,
    cohort.evidence_digest,cohort.member_count,cohort.source_boundary,
    cohort.created_at
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
      E'\n' order by member.job_id), 'UTF8'),'sha256'),'hex')
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
    coalesce(jsonb_agg(jsonb_build_object(
      'jobId',member.job_id,
      'incidentClassification',member.incident_classification,
      'snapshotAttemptCount',member.snapshot_attempt_count,
      'recoveryStatus',recovery.status,
      'recovered',recovery.status='COMPLETED')
      order by member.job_id),'[]'::jsonb)
  into v_recovered,v_unresolved,v_out_of_scope,v_members
  from public.seller_os_legacy_shipping_incident_members_v1 member
  left join public.seller_os_economic_shipping_legacy_recoveries_v1 recovery
    on recovery.marketplace_account_key=v_cohort.marketplace_account_key
   and recovery.job_id=member.job_id
  where member.cohort_id=p_cohort_id;

  return jsonb_build_object(
    'status','PROVEN','contractVersion',v_cohort.contract_version,
    'cohortId',v_cohort.cohort_id,
    'cohortCreatedAt',v_cohort.cohort_created_at,
    'cohortMemberCount',v_cohort.member_count,
    'recoveredMemberCount',v_recovered,
    'unresolvedMemberCount',v_unresolved,
    'outOfScopeMemberCount',v_out_of_scope,
    'newJobArrivalsExcluded',true,
    'recoveryWorkPerCycleMax',1,
    'membershipDigest',v_cohort.membership_digest,
    'sourceReceiptId',v_cohort.source_receipt_id,
    'members',v_members);
end;
$$;

revoke all on function
  public.read_seller_os_legacy_shipping_incident_cohort_v1(text)
  from public, anon, authenticated;
grant execute on function
  public.read_seller_os_legacy_shipping_incident_cohort_v1(text)
  to service_role;
