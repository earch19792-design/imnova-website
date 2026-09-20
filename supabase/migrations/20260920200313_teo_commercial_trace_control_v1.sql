-- TEO_COMMERCIAL_TRACE_CONTROL_V1
-- Additive, OWNER-authorized orchestration for one exact canonical Luna
-- product per request. The existing SELLER_OS_LIVE_COMMERCIAL_TRACE_V1 engine
-- remains the execution and receipt authority. This migration cannot publish
-- listings or write to a marketplace.

create table public.seller_os_commercial_trace_command_capabilities_v1 (
  capability_id uuid primary key default gen_random_uuid(),
  capability_code text not null check (
    capability_code = 'TEO_COMMERCIAL_TRACE_V1'),
  marketplace_account_key text not null check (
    char_length(marketplace_account_key) between 8 and 160),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  command_client_id text not null check (
    char_length(command_client_id) between 8 and 240
    and command_client_id !~ '[[:cntrl:]]'),
  oauth_resource text not null check (
    oauth_resource ~ '^https://[^/?#]+/api/seller-os/control/mcp$'),
  allowed_contract_version text not null check (
    allowed_contract_version = 'SELLER_OS_LIVE_COMMERCIAL_TRACE_V1'),
  maximum_products_per_request integer not null default 1 check (
    maximum_products_per_request = 1),
  enabled boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  disabled_at timestamptz,
  expires_at timestamptz,
  constraint seller_os_commercial_trace_capability_state_v1 check (
    (enabled and disabled_at is null)
    or (not enabled and disabled_at is not null)),
  constraint seller_os_commercial_trace_capability_expiry_v1 check (
    expires_at is null or expires_at > created_at),
  unique (capability_code,marketplace_account_key,owner_user_id,
    command_client_id,oauth_resource)
);

create table public.seller_os_commercial_trace_command_requests_v1 (
  request_id uuid primary key default gen_random_uuid(),
  capability_id uuid not null references
    public.seller_os_commercial_trace_command_capabilities_v1(capability_id)
    on delete restrict,
  marketplace_account_key text not null,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  command_client_id text not null,
  oauth_resource text not null,
  client_idempotency_key text not null check (
    client_idempotency_key ~ '^[A-Za-z0-9._:-]{8,160}$'),
  contract_version text not null check (
    contract_version = 'SELLER_OS_LIVE_COMMERCIAL_TRACE_V1'),
  source_snapshot_id uuid not null references
    public.luna_catalog_snapshots_v1(snapshot_id) on delete restrict,
  luna_product_id text not null check (luna_product_id ~ '^[0-9]{1,30}$'),
  luna_variant_id text not null check (luna_variant_id ~ '^[0-9]{1,30}$'),
  supplier_sku text not null check (char_length(supplier_sku) between 1 and 160),
  canonical_url text not null check (
    canonical_url ~ '^https://(www\.)?lunaportex\.com/products/[^/?#]+$'),
  source_fingerprint text not null check (
    source_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  field_truth_evidence_digest text not null check (
    field_truth_evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_digest text not null check (
    request_digest ~ '^sha256:[0-9a-f]{64}$'),
  trace_id uuid not null unique references
    public.seller_os_live_commercial_traces_v1(trace_id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (capability_id,client_idempotency_key)
);

create index seller_os_commercial_trace_command_owner_v1_idx on
  public.seller_os_commercial_trace_command_requests_v1(
    owner_user_id,command_client_id,created_at desc);

alter table public.seller_os_commercial_trace_command_capabilities_v1
  enable row level security;
alter table public.seller_os_commercial_trace_command_capabilities_v1
  force row level security;
alter table public.seller_os_commercial_trace_command_requests_v1
  enable row level security;
alter table public.seller_os_commercial_trace_command_requests_v1
  force row level security;

revoke all on table public.seller_os_commercial_trace_command_capabilities_v1
  from public,anon,authenticated,service_role;
revoke all on table public.seller_os_commercial_trace_command_requests_v1
  from public,anon,authenticated,service_role;
grant select,insert,update on table
  public.seller_os_commercial_trace_command_capabilities_v1 to service_role;
grant select,insert,update on table
  public.seller_os_commercial_trace_command_requests_v1 to service_role;

create policy seller_os_commercial_trace_capabilities_service_role_v1 on
  public.seller_os_commercial_trace_command_capabilities_v1 for all
  to service_role using (true) with check (true);
create policy seller_os_commercial_trace_requests_service_role_v1 on
  public.seller_os_commercial_trace_command_requests_v1 for all
  to service_role using (true) with check (true);

create or replace function public.authorize_seller_os_commercial_trace_v1(
  p_marketplace_account_key text,p_owner_user_id uuid,p_command_client_id text,
  p_oauth_resource text,p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  v_capability public.seller_os_commercial_trace_command_capabilities_v1%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(coalesce(p_marketplace_account_key,'')) not between 8 and 160
      or p_owner_user_id is null
      or char_length(coalesce(p_command_client_id,'')) not between 8 and 240
      or p_command_client_id ~ '[[:cntrl:]]'
      or p_oauth_resource !~ '^https://[^/?#]+/api/seller-os/control/mcp$'
      or (p_expires_at is not null and p_expires_at <= clock_timestamp()) then
    raise exception 'TEO_COMMERCIAL_TRACE_CAPABILITY_INVALID';
  end if;
  insert into public.seller_os_commercial_trace_command_capabilities_v1(
    capability_code,marketplace_account_key,owner_user_id,command_client_id,
    oauth_resource,allowed_contract_version,enabled,expires_at)
  values ('TEO_COMMERCIAL_TRACE_V1',p_marketplace_account_key,p_owner_user_id,
    p_command_client_id,p_oauth_resource,'SELLER_OS_LIVE_COMMERCIAL_TRACE_V1',
    true,p_expires_at)
  on conflict (capability_code,marketplace_account_key,owner_user_id,
    command_client_id,oauth_resource) do update set enabled=true,
    disabled_at=null,expires_at=excluded.expires_at,updated_at=clock_timestamp()
  returning * into v_capability;
  return jsonb_build_object('capabilityId',v_capability.capability_id,
    'capabilityCode',v_capability.capability_code,'enabled',v_capability.enabled,
    'contractVersion',v_capability.allowed_contract_version,
    'commandClientId',v_capability.command_client_id,
    'oauthResource',v_capability.oauth_resource);
end $function$;

create or replace function public.disable_seller_os_commercial_trace_v1(
  p_marketplace_account_key text,p_owner_user_id uuid,p_command_client_id text,
  p_oauth_resource text)
returns boolean language plpgsql security definer set search_path='' as $function$
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_owner_user_id is null or coalesce(p_command_client_id,'')=''
      or coalesce(p_oauth_resource,'')='' then
    raise exception 'TEO_COMMERCIAL_TRACE_CAPABILITY_DISABLE_INVALID';
  end if;
  update public.seller_os_commercial_trace_command_capabilities_v1 capability
  set enabled=false,disabled_at=clock_timestamp(),updated_at=clock_timestamp()
  where capability.capability_code='TEO_COMMERCIAL_TRACE_V1'
    and capability.marketplace_account_key=p_marketplace_account_key
    and capability.owner_user_id=p_owner_user_id
    and capability.command_client_id=p_command_client_id
    and capability.oauth_resource=p_oauth_resource and capability.enabled;
  return found;
end $function$;

create or replace function public.request_seller_os_commercial_trace_v1(
  p_marketplace_account_key text,p_owner_user_id uuid,p_command_client_id text,
  p_oauth_resource text,p_client_idempotency_key text,p_contract_version text,
  p_source_snapshot_id uuid,p_luna_product_id text,p_luna_variant_id text,
  p_supplier_sku text,p_canonical_url text,p_source_fingerprint text,
  p_field_truth_evidence_digest text,p_request_digest text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  v_capability public.seller_os_commercial_trace_command_capabilities_v1%rowtype;
  v_request public.seller_os_commercial_trace_command_requests_v1%rowtype;
  v_variant public.luna_catalog_snapshot_variants_v1%rowtype;
  v_trace_id uuid;
  v_created boolean:=false;
  v_required text[]:=array['LUNA_PRODUCT_ID','LUNA_VARIANT_ID','SUPPLIER_SKU',
    'TITLE','SUPPLIER_COST','SUPPLIER_AVAILABILITY'];
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_contract_version<>'SELLER_OS_LIVE_COMMERCIAL_TRACE_V1'
      or p_client_idempotency_key !~ '^[A-Za-z0-9._:-]{8,160}$'
      or p_luna_product_id !~ '^[0-9]{1,30}$'
      or p_luna_variant_id !~ '^[0-9]{1,30}$'
      or coalesce(p_supplier_sku,'')='' or char_length(p_supplier_sku)>160
      or p_canonical_url !~ '^https://(www\.)?lunaportex\.com/products/[^/?#]+$'
      or p_source_fingerprint !~ '^sha256:[0-9a-f]{64}$'
      or p_field_truth_evidence_digest !~ '^sha256:[0-9a-f]{64}$'
      or p_request_digest !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'TEO_COMMERCIAL_TRACE_REQUEST_INVALID';
  end if;
  select capability.* into v_capability
  from public.seller_os_commercial_trace_command_capabilities_v1 capability
  where capability.capability_code='TEO_COMMERCIAL_TRACE_V1'
    and capability.marketplace_account_key=p_marketplace_account_key
    and capability.owner_user_id=p_owner_user_id
    and capability.command_client_id=p_command_client_id
    and capability.oauth_resource=p_oauth_resource
    and capability.allowed_contract_version=p_contract_version
    and capability.enabled and (capability.expires_at is null
      or capability.expires_at>clock_timestamp()) for update;
  if not found then raise exception 'TEO_COMMERCIAL_TRACE_CAPABILITY_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'teo-commercial-trace:'||v_capability.capability_id::text||':'||
    p_client_idempotency_key,0));
  select request.* into v_request
  from public.seller_os_commercial_trace_command_requests_v1 request
  where request.capability_id=v_capability.capability_id
    and request.client_idempotency_key=p_client_idempotency_key for update;
  if found then
    if v_request.request_digest is distinct from p_request_digest
      or v_request.source_snapshot_id is distinct from p_source_snapshot_id
      or v_request.luna_product_id is distinct from p_luna_product_id
      or v_request.luna_variant_id is distinct from p_luna_variant_id
      or v_request.supplier_sku is distinct from p_supplier_sku
      or v_request.canonical_url is distinct from p_canonical_url
      or v_request.source_fingerprint is distinct from p_source_fingerprint
      or v_request.field_truth_evidence_digest is distinct from
        p_field_truth_evidence_digest then
      raise exception 'TEO_COMMERCIAL_TRACE_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('requestId',v_request.request_id,
      'traceId',v_request.trace_id,'created',false);
  end if;
  if exists(select 1 from public.luna_catalog_snapshots_v1 snapshot
    where snapshot.snapshot_status='COMPLETE'
      and snapshot.snapshot_completed_at>(select s.snapshot_completed_at
        from public.luna_catalog_snapshots_v1 s
        where s.snapshot_id=p_source_snapshot_id)) then
    raise exception 'TEO_COMMERCIAL_TRACE_SNAPSHOT_STALE';
  end if;
  select variant.* into strict v_variant
  from public.luna_catalog_snapshot_variants_v1 variant
  where variant.snapshot_id=p_source_snapshot_id
    and variant.product_id=p_luna_product_id
    and variant.variant_id=p_luna_variant_id and variant.sku=p_supplier_sku
    and variant.canonical_url=p_canonical_url
    and variant.source_fingerprint=p_source_fingerprint
    and variant.preflight_status='PREFLIGHT_PASS';
  if (select count(*) from public.luna_catalog_snapshot_variants_v1 variant
      where variant.snapshot_id=p_source_snapshot_id
        and variant.canonical_url=p_canonical_url)<>1
    or v_variant.field_truth_v1->>'contractVersion'<>
      'LUNA_FIELD_PRODUCT_TRUTH_V1'
    or v_variant.field_truth_v1->>'sourceSnapshotId'<>
      p_source_snapshot_id::text
    or v_variant.field_truth_v1->>'sourceProductId'<>p_luna_product_id
    or v_variant.field_truth_v1->>'sourceVariantId'<>p_luna_variant_id
    or v_variant.field_truth_v1->>'sourceSupplierSku'<>p_supplier_sku
    or v_variant.field_truth_v1->>'sourceCatalogFingerprint'<>
      p_source_fingerprint
    or v_variant.field_truth_v1->>'evidenceDigest'<>
      p_field_truth_evidence_digest
    or jsonb_array_length(coalesce(v_variant.field_truth_v1->'fields','[]'))<>25
    or exists(select 1 from unnest(v_required) required(field_name)
      where (select count(*) from jsonb_array_elements(
        v_variant.field_truth_v1->'fields') field
        where field->>'FIELD'=required.field_name
          and field->>'SEMANTIC_CLASS'='FACT'
          and field->>'EVIDENCE_STATUS'='PROVEN'
          and coalesce((field->>'CONTRADICTION')::boolean,false)=false
          and field->'VALUE'<>'null'::jsonb
          and coalesce(field->>'EVIDENCE_ID','')~'^sha256:[0-9a-f]{64}$'
          and (required.field_name not in ('SUPPLIER_COST','SUPPLIER_AVAILABILITY')
            or field->>'FRESH_UNTIL' is null
            or (field->>'FRESH_UNTIL')::timestamptz>clock_timestamp()))<>1)
  then raise exception 'TEO_COMMERCIAL_TRACE_PRODUCT_TRUTH_DENIED'; end if;
  v_trace_id:=gen_random_uuid();
  insert into public.seller_os_live_commercial_traces_v1(
    trace_id,account_key,product_url,started_by)
  values(v_trace_id,p_marketplace_account_key,p_canonical_url,p_owner_user_id);
  insert into public.seller_os_commercial_trace_command_requests_v1(
    capability_id,marketplace_account_key,owner_user_id,command_client_id,
    oauth_resource,client_idempotency_key,contract_version,source_snapshot_id,
    luna_product_id,luna_variant_id,supplier_sku,canonical_url,
    source_fingerprint,field_truth_evidence_digest,request_digest,trace_id)
  values(v_capability.capability_id,p_marketplace_account_key,p_owner_user_id,
    p_command_client_id,p_oauth_resource,p_client_idempotency_key,
    p_contract_version,p_source_snapshot_id,p_luna_product_id,p_luna_variant_id,
    p_supplier_sku,p_canonical_url,p_source_fingerprint,
    p_field_truth_evidence_digest,p_request_digest,v_trace_id)
  returning * into v_request;
  v_created:=true;
  return jsonb_build_object('requestId',v_request.request_id,
    'traceId',v_request.trace_id,'created',v_created);
exception when no_data_found then
  raise exception 'TEO_COMMERCIAL_TRACE_PRODUCT_TRUTH_DENIED';
end $function$;

create or replace function public.fail_seller_os_commercial_trace_request_v1(
  p_trace_id uuid,p_owner_user_id uuid,p_command_client_id text,
  p_failure_code text)
returns boolean language plpgsql security definer set search_path='' as $function$
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_failure_code !~ '^[A-Z0-9_]{3,120}$' then
    raise exception 'TEO_COMMERCIAL_TRACE_FAILURE_INVALID';
  end if;
  update public.seller_os_live_commercial_traces_v1 trace set state='FAILED',
    current_stage='FINAL_DECISION',result=jsonb_build_object(
      'FINAL_DECISION','FAIL_CLOSED','failureCode',p_failure_code,
      'COMMERCIAL_TRACE_CERTIFICATION','FAIL'),completed_at=clock_timestamp(),
    updated_at=clock_timestamp()
  where trace.trace_id=p_trace_id and trace.state='RUNNING'
    and exists(select 1
      from public.seller_os_commercial_trace_command_requests_v1 request
      where request.trace_id=trace.trace_id
        and request.owner_user_id=p_owner_user_id
        and request.command_client_id=p_command_client_id);
  return found;
end $function$;

do $$ declare f record; begin
  for f in select oid::regprocedure signature from pg_proc
    where pronamespace='public'::regnamespace and proname in (
      'authorize_seller_os_commercial_trace_v1',
      'disable_seller_os_commercial_trace_v1',
      'request_seller_os_commercial_trace_v1',
      'fail_seller_os_commercial_trace_request_v1') loop
    execute format('revoke all on function %s from public,anon,authenticated',
      f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

comment on table public.seller_os_commercial_trace_command_capabilities_v1 is
  'Dedicated OWNER/client/account/resource capability for bounded Commercial Trace; no Publisher or marketplace-write authority.';
comment on table public.seller_os_commercial_trace_command_requests_v1 is
  'Idempotent binding between an authorized Teo command and the canonical durable Commercial Trace receipt.';
