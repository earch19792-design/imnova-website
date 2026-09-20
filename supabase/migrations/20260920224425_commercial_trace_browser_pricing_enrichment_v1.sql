-- COMMERCIAL_TRACE_BROWSER_PRICING_ENRICHMENT_V1
-- Durable, bounded handoff from an existing Commercial Trace pricing HOLD to
-- the already-certified Product Research browser worker. This authority can
-- capture public SOLD evidence only; it cannot publish or mutate eBay.

create table public.seller_os_commercial_trace_pricing_enrichment_jobs_v1 (
  job_id uuid primary key default gen_random_uuid(),
  trace_id uuid not null unique references
    public.seller_os_live_commercial_traces_v1(trace_id) on delete restrict,
  command_request_id uuid not null unique references
    public.seller_os_commercial_trace_command_requests_v1(request_id)
    on delete restrict,
  marketplace_account_key text not null check (
    char_length(marketplace_account_key) between 8 and 160),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  command_client_id text not null check (
    char_length(command_client_id) between 8 and 240),
  contract_version text not null check (
    contract_version = 'SELLER_OS_COMMERCIAL_TRACE_PRICING_ENRICHMENT_V1'),
  luna_product_id text not null check (luna_product_id ~ '^[0-9]{1,30}$'),
  luna_variant_id text not null check (luna_variant_id ~ '^[0-9]{1,30}$'),
  supplier_sku text not null check (char_length(supplier_sku) between 1 and 160),
  canonical_url text not null check (
    canonical_url ~ '^https://(www\.)?lunaportex\.com/products/[^/?#]+$'),
  source_fingerprint text not null check (
    source_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  task_spec jsonb not null,
  task_spec_digest text not null check (
    task_spec_digest ~ '^sha256:[0-9a-f]{64}$'),
  state text not null default 'PENDING',
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  lease_owner text,
  lease_expires_at timestamptz,
  receipt jsonb,
  receipt_digest text check (
    receipt_digest is null or receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  last_error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  constraint seller_os_commercial_trace_pricing_job_state_v1 check (
    state in ('PENDING','CLAIMED','COMPLETED','FAILED')
    and ((state='CLAIMED' and lease_owner is not null and
          lease_expires_at is not null)
      or (state<>'CLAIMED' and lease_owner is null and
          lease_expires_at is null))
    and ((state='COMPLETED' and receipt is not null and
          receipt_digest is not null and completed_at is not null)
      or (state<>'COMPLETED' and receipt is null and
          receipt_digest is null and completed_at is null))),
  constraint seller_os_commercial_trace_pricing_task_spec_v1 check (
    jsonb_typeof(task_spec)='array'
    and jsonb_array_length(task_spec) between 1 and 6),
  constraint seller_os_commercial_trace_pricing_receipt_v1 check (
    receipt is null or jsonb_typeof(receipt)='object')
);

create index seller_os_commercial_trace_pricing_pending_v1_idx on
  public.seller_os_commercial_trace_pricing_enrichment_jobs_v1(
    created_at,job_id) where state in ('PENDING','CLAIMED');

alter table public.seller_os_commercial_trace_pricing_enrichment_jobs_v1
  enable row level security;
alter table public.seller_os_commercial_trace_pricing_enrichment_jobs_v1
  force row level security;
revoke all on table
  public.seller_os_commercial_trace_pricing_enrichment_jobs_v1
  from public,anon,authenticated,service_role;
grant select,insert,update on table
  public.seller_os_commercial_trace_pricing_enrichment_jobs_v1
  to service_role;
create policy seller_os_commercial_trace_pricing_service_role_v1 on
  public.seller_os_commercial_trace_pricing_enrichment_jobs_v1 for all
  to service_role using (true) with check (true);

create or replace function public.enqueue_seller_os_commercial_trace_pricing_enrichment_v1(
  p_trace_id uuid,p_marketplace_account_key text,p_luna_product_id text,
  p_luna_variant_id text,p_supplier_sku text,p_canonical_url text,
  p_source_fingerprint text,p_task_spec jsonb,p_task_spec_digest text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  v_request public.seller_os_commercial_trace_command_requests_v1%rowtype;
  v_job public.seller_os_commercial_trace_pricing_enrichment_jobs_v1%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_trace_id is null
      or p_luna_product_id !~ '^[0-9]{1,30}$'
      or p_luna_variant_id !~ '^[0-9]{1,30}$'
      or coalesce(p_supplier_sku,'')='' or char_length(p_supplier_sku)>160
      or p_canonical_url !~ '^https://(www\.)?lunaportex\.com/products/[^/?#]+$'
      or p_source_fingerprint !~ '^sha256:[0-9a-f]{64}$'
      or p_task_spec_digest !~ '^sha256:[0-9a-f]{64}$'
      or jsonb_typeof(p_task_spec)<>'array'
      or jsonb_array_length(p_task_spec) not between 1 and 6
      or exists(select 1 from jsonb_array_elements(p_task_spec) task
        where jsonb_typeof(task)<>'object'
          or (select count(*) from jsonb_object_keys(task))<>4
          or (task->>'ordinal') !~ '^[1-6]$'
          or char_length(coalesce(task->>'sourceComparableId','')) not between 1 and 160
          or char_length(coalesce(task->>'searchQuery','')) not between 3 and 100
          or task->>'searchQuery' <> btrim(task->>'searchQuery')
          or task->>'searchQuery' ~ '[[:cntrl:]]'
          or task->>'acquisitionPath' not in (
            'PRODUCT_RESEARCH_NEAR_EXACT_SOLD',
            'PUBLIC_EBAY_SOLD_COMPLETED')) then
    raise exception 'COMMERCIAL_TRACE_PRICING_ENRICHMENT_REQUEST_INVALID';
  end if;
  select request.* into strict v_request
  from public.seller_os_commercial_trace_command_requests_v1 request
  where request.trace_id=p_trace_id
    and request.marketplace_account_key=p_marketplace_account_key
    and request.luna_product_id=p_luna_product_id
    and request.luna_variant_id=p_luna_variant_id
    and request.supplier_sku=p_supplier_sku
    and request.canonical_url=p_canonical_url
    and request.source_fingerprint=p_source_fingerprint;
  insert into public.seller_os_commercial_trace_pricing_enrichment_jobs_v1(
    trace_id,command_request_id,marketplace_account_key,owner_user_id,
    command_client_id,contract_version,luna_product_id,luna_variant_id,
    supplier_sku,canonical_url,source_fingerprint,task_spec,task_spec_digest)
  values(p_trace_id,v_request.request_id,p_marketplace_account_key,
    v_request.owner_user_id,v_request.command_client_id,
    'SELLER_OS_COMMERCIAL_TRACE_PRICING_ENRICHMENT_V1',p_luna_product_id,
    p_luna_variant_id,p_supplier_sku,p_canonical_url,p_source_fingerprint,
    p_task_spec,p_task_spec_digest)
  on conflict (trace_id) do nothing;
  select job.* into strict v_job
  from public.seller_os_commercial_trace_pricing_enrichment_jobs_v1 job
  where job.trace_id=p_trace_id;
  if v_job.command_request_id is distinct from v_request.request_id
      or v_job.marketplace_account_key is distinct from p_marketplace_account_key
      or v_job.luna_product_id is distinct from p_luna_product_id
      or v_job.luna_variant_id is distinct from p_luna_variant_id
      or v_job.supplier_sku is distinct from p_supplier_sku
      or v_job.canonical_url is distinct from p_canonical_url
      or v_job.source_fingerprint is distinct from p_source_fingerprint
      or v_job.task_spec_digest is distinct from p_task_spec_digest
      or v_job.task_spec is distinct from p_task_spec then
    raise exception 'COMMERCIAL_TRACE_PRICING_ENRICHMENT_BINDING_CONFLICT';
  end if;
  return jsonb_build_object('jobId',v_job.job_id,'traceId',v_job.trace_id,
    'state',v_job.state,'taskCount',jsonb_array_length(v_job.task_spec),
    'marketplaceWrites',0);
exception when no_data_found then
  raise exception 'COMMERCIAL_TRACE_PRICING_ENRICHMENT_TRACE_BINDING_INVALID';
end $function$;

create or replace function public.claim_seller_os_commercial_trace_pricing_enrichment_v1(
  p_marketplace_account_key text,p_owner_user_id uuid,p_worker_id text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  v_job public.seller_os_commercial_trace_pricing_enrichment_jobs_v1%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_owner_user_id is null
      or char_length(coalesce(p_worker_id,'')) not between 8 and 180
      or p_worker_id ~ '[[:cntrl:]]' then
    raise exception 'COMMERCIAL_TRACE_PRICING_ENRICHMENT_CLAIM_INVALID';
  end if;
  update public.seller_os_commercial_trace_pricing_enrichment_jobs_v1 job
  set state=case when job.attempt_count>=3 then 'FAILED' else 'PENDING' end,
    lease_owner=null,lease_expires_at=null,updated_at=clock_timestamp(),
    last_error_code=case when job.attempt_count>=3
      then 'COMMERCIAL_TRACE_PRICING_ENRICHMENT_RETRY_EXHAUSTED'
      else job.last_error_code end
  where job.marketplace_account_key=p_marketplace_account_key
    and job.owner_user_id=p_owner_user_id and job.state='CLAIMED'
    and job.lease_expires_at<=clock_timestamp();
  select job.* into v_job
  from public.seller_os_commercial_trace_pricing_enrichment_jobs_v1 job
  join public.seller_os_live_commercial_traces_v1 trace
    on trace.trace_id=job.trace_id
  where job.marketplace_account_key=p_marketplace_account_key
    and job.owner_user_id=p_owner_user_id and job.state='PENDING'
    and job.attempt_count<3 and trace.state='COMPLETED'
    and trace.result->>'FINAL_DECISION'='HOLD_PRICING_EVIDENCE_QUALITY'
  order by job.created_at,job.job_id for update of job skip locked limit 1;
  if not found then return jsonb_build_object('claimed',false,
    'jobId',null,'traceId',null,'marketplaceWrites',0); end if;
  update public.seller_os_commercial_trace_pricing_enrichment_jobs_v1 job
  set state='CLAIMED',attempt_count=job.attempt_count+1,
    lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+interval '5 minutes',
    updated_at=clock_timestamp(),last_error_code=null
  where job.job_id=v_job.job_id returning * into v_job;
  return jsonb_build_object('claimed',true,'jobId',v_job.job_id,
    'traceId',v_job.trace_id,'leaseExpiresAt',v_job.lease_expires_at,
    'contractVersion',v_job.contract_version,'lunaProductId',v_job.luna_product_id,
    'lunaVariantId',v_job.luna_variant_id,'supplierSku',v_job.supplier_sku,
    'tasks',v_job.task_spec,'remainingRows',60,'marketplaceWrites',0);
end $function$;

create or replace function public.complete_seller_os_commercial_trace_pricing_enrichment_v1(
  p_job_id uuid,p_marketplace_account_key text,p_owner_user_id uuid,
  p_worker_id text,p_receipt jsonb,p_receipt_digest text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  v_job public.seller_os_commercial_trace_pricing_enrichment_jobs_v1%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_job_id is null or p_owner_user_id is null
      or p_receipt_digest !~ '^sha256:[0-9a-f]{64}$'
      or jsonb_typeof(p_receipt)<>'object'
      or p_receipt->>'contractVersion'<>
        'SELLER_OS_COMMERCIAL_TRACE_PRICING_ENRICHMENT_RECEIPT_V1'
      or p_receipt->>'jobId'<>p_job_id::text
      or coalesce((p_receipt->>'marketplaceWrites')::integer,-1)<>0
      or jsonb_typeof(p_receipt->'rows')<>'array'
      or jsonb_array_length(p_receipt->'rows')>60 then
    raise exception 'COMMERCIAL_TRACE_PRICING_ENRICHMENT_RECEIPT_INVALID';
  end if;
  select job.* into strict v_job
  from public.seller_os_commercial_trace_pricing_enrichment_jobs_v1 job
  where job.job_id=p_job_id
    and job.marketplace_account_key=p_marketplace_account_key
    and job.owner_user_id=p_owner_user_id for update;
  if v_job.state='COMPLETED' then
    if v_job.receipt_digest is distinct from p_receipt_digest
        or v_job.receipt is distinct from p_receipt then
      raise exception 'COMMERCIAL_TRACE_PRICING_ENRICHMENT_RECEIPT_CONFLICT';
    end if;
    return jsonb_build_object('completed',true,'jobId',v_job.job_id,
      'traceId',v_job.trace_id,'idempotent',true,'marketplaceWrites',0);
  end if;
  if v_job.state<>'CLAIMED' or v_job.lease_owner is distinct from p_worker_id
      or v_job.lease_expires_at<=clock_timestamp()
      or p_receipt->>'traceId'<>v_job.trace_id::text
      or p_receipt->>'lunaProductId'<>v_job.luna_product_id
      or p_receipt->>'lunaVariantId'<>v_job.luna_variant_id
      or p_receipt->>'supplierSku'<>v_job.supplier_sku
      or p_receipt->>'sourceFingerprint'<>v_job.source_fingerprint
      or p_receipt->>'taskSpecDigest'<>v_job.task_spec_digest then
    raise exception 'COMMERCIAL_TRACE_PRICING_ENRICHMENT_RECEIPT_BINDING_INVALID';
  end if;
  update public.seller_os_commercial_trace_pricing_enrichment_jobs_v1 job
  set state='COMPLETED',receipt=p_receipt,receipt_digest=p_receipt_digest,
    lease_owner=null,lease_expires_at=null,completed_at=clock_timestamp(),
    updated_at=clock_timestamp(),last_error_code=null
  where job.job_id=v_job.job_id returning * into v_job;
  return jsonb_build_object('completed',true,'jobId',v_job.job_id,
    'traceId',v_job.trace_id,'idempotent',false,'marketplaceWrites',0);
end $function$;

create or replace function public.release_seller_os_commercial_trace_pricing_enrichment_v1(
  p_job_id uuid,p_marketplace_account_key text,p_owner_user_id uuid,
  p_worker_id text,p_error_code text)
returns boolean language plpgsql security definer set search_path='' as $function$
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_job_id is null or p_owner_user_id is null
      or p_error_code !~ '^[A-Z0-9_]{3,120}$' then
    raise exception 'COMMERCIAL_TRACE_PRICING_ENRICHMENT_RELEASE_INVALID';
  end if;
  update public.seller_os_commercial_trace_pricing_enrichment_jobs_v1 job
  set state=case when job.attempt_count>=3 then 'FAILED' else 'PENDING' end,
    lease_owner=null,lease_expires_at=null,last_error_code=p_error_code,
    updated_at=clock_timestamp()
  where job.job_id=p_job_id
    and job.marketplace_account_key=p_marketplace_account_key
    and job.owner_user_id=p_owner_user_id and job.state='CLAIMED'
    and job.lease_owner=p_worker_id;
  return found;
end $function$;

do $$ declare f record; begin
  for f in select oid::regprocedure signature from pg_proc
    where pronamespace='public'::regnamespace and proname in (
      'enqueue_seller_os_commercial_trace_pricing_enrichment_v1',
      'claim_seller_os_commercial_trace_pricing_enrichment_v1',
      'complete_seller_os_commercial_trace_pricing_enrichment_v1',
      'release_seller_os_commercial_trace_pricing_enrichment_v1') loop
    execute format('revoke all on function %s from public,anon,authenticated',
      f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

comment on table public.seller_os_commercial_trace_pricing_enrichment_jobs_v1 is
  'Bounded trace-specific browser SOLD enrichment queue and durable receipt; no arbitrary URL, Publisher, or marketplace-write authority.';
