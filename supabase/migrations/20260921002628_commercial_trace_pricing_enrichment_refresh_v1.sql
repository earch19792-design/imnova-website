-- COMMERCIAL_TRACE_PRICING_ENRICHMENT_REFRESH_V1
-- Preserve immutable terminal receipts while allowing at most two bounded,
-- version-aware refresh generations for the same exact Commercial Trace.

alter table public.seller_os_commercial_trace_pricing_enrichment_jobs_v1
  add column mechanism_version text not null default 'LEGACY_UNVERSIONED',
  add column generation integer not null default 1,
  add column refresh_reason text not null default 'INITIAL',
  add column predecessor_job_id uuid,
  add column predecessor_receipt_digest text;

alter table public.seller_os_commercial_trace_pricing_enrichment_jobs_v1
  drop constraint if exists seller_os_commercial_trace_pricing_enrichment_jobs_trace_id_key,
  drop constraint if exists seller_os_commercial_trace_pricing_enric_command_request_id_key;

alter table public.seller_os_commercial_trace_pricing_enrichment_jobs_v1
  add constraint seller_os_commercial_trace_pricing_mechanism_v1 check (
    char_length(mechanism_version) between 8 and 120
    and mechanism_version !~ '[[:cntrl:][:space:]]'),
  add constraint seller_os_commercial_trace_pricing_generation_v1 check (
    generation between 1 and 3),
  add constraint seller_os_commercial_trace_pricing_refresh_reason_v1 check (
    refresh_reason in ('INITIAL','MECHANISM_UPGRADE','EVIDENCE_STALE')),
  add constraint seller_os_commercial_trace_pricing_predecessor_digest_v1 check (
    predecessor_receipt_digest is null or
    predecessor_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  add constraint seller_os_commercial_trace_pricing_predecessor_v1 foreign key (
    predecessor_job_id) references
    public.seller_os_commercial_trace_pricing_enrichment_jobs_v1(job_id)
    on delete restrict,
  add constraint seller_os_commercial_trace_pricing_refresh_shape_v1 check (
    (generation=1 and refresh_reason='INITIAL' and predecessor_job_id is null
      and predecessor_receipt_digest is null)
    or (generation>1 and refresh_reason<>'INITIAL' and
      predecessor_job_id is not null and
      predecessor_receipt_digest is not null));

create unique index seller_os_commercial_trace_pricing_generation_v1_uidx on
  public.seller_os_commercial_trace_pricing_enrichment_jobs_v1(
    trace_id,generation);
create unique index seller_os_commercial_trace_pricing_mechanism_reason_v1_uidx on
  public.seller_os_commercial_trace_pricing_enrichment_jobs_v1(
    trace_id,mechanism_version,refresh_reason);
create unique index seller_os_commercial_trace_pricing_active_trace_v1_uidx on
  public.seller_os_commercial_trace_pricing_enrichment_jobs_v1(trace_id)
  where state in ('PENDING','CLAIMED');
create index seller_os_commercial_trace_pricing_predecessor_v1_idx on
  public.seller_os_commercial_trace_pricing_enrichment_jobs_v1(
    predecessor_job_id) where predecessor_job_id is not null;
create index seller_os_commercial_trace_pricing_command_request_v1_idx on
  public.seller_os_commercial_trace_pricing_enrichment_jobs_v1(
    command_request_id);
create index seller_os_commercial_trace_pricing_trace_generation_v1_idx on
  public.seller_os_commercial_trace_pricing_enrichment_jobs_v1(
    trace_id,generation desc);

create or replace function public.enqueue_seller_os_commercial_trace_pricing_enrichment_v2(
  p_trace_id uuid,p_marketplace_account_key text,p_luna_product_id text,
  p_luna_variant_id text,p_supplier_sku text,p_canonical_url text,
  p_source_fingerprint text,p_task_spec jsonb,p_task_spec_digest text,
  p_mechanism_version text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  v_request public.seller_os_commercial_trace_command_requests_v1%rowtype;
  v_trace public.seller_os_live_commercial_traces_v1%rowtype;
  v_latest public.seller_os_commercial_trace_pricing_enrichment_jobs_v1%rowtype;
  v_job public.seller_os_commercial_trace_pricing_enrichment_jobs_v1%rowtype;
  v_generation integer;
  v_refresh_reason text;
  v_pricing_eligible integer := 0;
  v_distinct_sellers integer := 0;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_trace_id is null
      or p_luna_product_id !~ '^[0-9]{1,30}$'
      or p_luna_variant_id !~ '^[0-9]{1,30}$'
      or coalesce(p_supplier_sku,'')='' or char_length(p_supplier_sku)>160
      or p_canonical_url !~ '^https://(www\.)?lunaportex\.com/products/[^/?#]+$'
      or p_source_fingerprint !~ '^sha256:[0-9a-f]{64}$'
      or p_task_spec_digest !~ '^sha256:[0-9a-f]{64}$'
      or p_mechanism_version<>
        'COMMERCIAL_TRACE_PRICING_BROWSER_CAPTURE_V2_EXTENSION_1_2_40'
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

  perform pg_advisory_xact_lock(hashtextextended(
    'seller-os-commercial-trace-pricing-refresh:'||p_trace_id::text,0));

  select request.* into strict v_request
  from public.seller_os_commercial_trace_command_requests_v1 request
  where request.trace_id=p_trace_id
    and request.marketplace_account_key=p_marketplace_account_key
    and request.luna_product_id=p_luna_product_id
    and request.luna_variant_id=p_luna_variant_id
    and request.supplier_sku=p_supplier_sku
    and request.canonical_url=p_canonical_url
    and request.source_fingerprint=p_source_fingerprint;

  select trace.* into strict v_trace
  from public.seller_os_live_commercial_traces_v1 trace
  where trace.trace_id=p_trace_id
    and trace.account_key=p_marketplace_account_key
    and trace.state='COMPLETED'
    and trace.result->>'FINAL_DECISION'='HOLD_PRICING_EVIDENCE_QUALITY';

  select job.* into v_latest
  from public.seller_os_commercial_trace_pricing_enrichment_jobs_v1 job
  where job.trace_id=p_trace_id
  order by job.generation desc
  limit 1 for update;

  if not found then
    v_generation := 1;
    v_refresh_reason := 'INITIAL';
  elsif v_latest.mechanism_version=p_mechanism_version and not (
      v_latest.state='COMPLETED'
      and v_latest.completed_at<=clock_timestamp()-interval '30 days'
      and v_latest.refresh_reason<>'EVIDENCE_STALE'
      and v_latest.generation<3) then
    if v_latest.marketplace_account_key is distinct from p_marketplace_account_key
        or v_latest.luna_product_id is distinct from p_luna_product_id
        or v_latest.luna_variant_id is distinct from p_luna_variant_id
        or v_latest.supplier_sku is distinct from p_supplier_sku
        or v_latest.canonical_url is distinct from p_canonical_url
        or v_latest.source_fingerprint is distinct from p_source_fingerprint
        or v_latest.task_spec_digest is distinct from p_task_spec_digest
        or v_latest.task_spec is distinct from p_task_spec then
      raise exception 'COMMERCIAL_TRACE_PRICING_ENRICHMENT_BINDING_CONFLICT';
    end if;
    return jsonb_build_object('jobId',v_latest.job_id,
      'traceId',v_latest.trace_id,'state',v_latest.state,
      'taskCount',jsonb_array_length(v_latest.task_spec),
      'generation',v_latest.generation,
      'refreshReason',v_latest.refresh_reason,
      'predecessorReceiptDigest',v_latest.predecessor_receipt_digest,
      'created',false,'marketplaceWrites',0);
  else
    if v_latest.state not in ('COMPLETED','FAILED')
        or v_latest.generation>=3 then
      raise exception 'COMMERCIAL_TRACE_PRICING_ENRICHMENT_REFRESH_EXHAUSTED';
    end if;
    if v_latest.state='COMPLETED' then
      if v_trace.updated_at<v_latest.completed_at then
        raise exception 'COMMERCIAL_TRACE_PRICING_ENRICHMENT_REEVALUATION_REQUIRED';
      end if;
      select count(*)::integer,
        count(distinct row->>'sellerReferenceHash')::integer
      into v_pricing_eligible,v_distinct_sellers
      from jsonb_array_elements(coalesce(v_latest.receipt->'rows','[]'::jsonb)) row
      where row->>'pricingEligibility'=
          'SUBJECT_TO_COMMERCIAL_IDENTITY_VALIDATION'
        and row->>'sellerIdentityStatus'='PROVEN'
        and row->>'realizedPriceStatus'='REALIZED_PRICE_CONFIRMED';
      if v_pricing_eligible>=2 and v_distinct_sellers>=2 then
        raise exception 'COMMERCIAL_TRACE_PRICING_ENRICHMENT_MATERIAL_IMPROVEMENT_NOT_PROVEN';
      end if;
    end if;
    v_generation := v_latest.generation+1;
    v_refresh_reason := case
      when v_latest.mechanism_version<>p_mechanism_version
        then 'MECHANISM_UPGRADE'
      else 'EVIDENCE_STALE' end;
  end if;

  insert into public.seller_os_commercial_trace_pricing_enrichment_jobs_v1(
    trace_id,command_request_id,marketplace_account_key,owner_user_id,
    command_client_id,contract_version,luna_product_id,luna_variant_id,
    supplier_sku,canonical_url,source_fingerprint,task_spec,task_spec_digest,
    mechanism_version,generation,refresh_reason,predecessor_job_id,
    predecessor_receipt_digest)
  values(p_trace_id,v_request.request_id,p_marketplace_account_key,
    v_request.owner_user_id,v_request.command_client_id,
    'SELLER_OS_COMMERCIAL_TRACE_PRICING_ENRICHMENT_V1',p_luna_product_id,
    p_luna_variant_id,p_supplier_sku,p_canonical_url,p_source_fingerprint,
    p_task_spec,p_task_spec_digest,p_mechanism_version,v_generation,
    v_refresh_reason,v_latest.job_id,v_latest.receipt_digest)
  returning * into v_job;

  return jsonb_build_object('jobId',v_job.job_id,'traceId',v_job.trace_id,
    'state',v_job.state,'taskCount',jsonb_array_length(v_job.task_spec),
    'generation',v_job.generation,'refreshReason',v_job.refresh_reason,
    'predecessorReceiptDigest',v_job.predecessor_receipt_digest,
    'created',true,'marketplaceWrites',0);
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
    and job.mechanism_version=
      'COMMERCIAL_TRACE_PRICING_BROWSER_CAPTURE_V2_EXTENSION_1_2_40'
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
    'contractVersion',v_job.contract_version,
    'mechanismVersion',v_job.mechanism_version,
    'generation',v_job.generation,'refreshReason',v_job.refresh_reason,
    'predecessorReceiptDigest',v_job.predecessor_receipt_digest,
    'lunaProductId',v_job.luna_product_id,
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
      or p_receipt->>'taskSpecDigest'<>v_job.task_spec_digest
      or p_receipt->>'mechanismVersion'<>v_job.mechanism_version
      or p_receipt->>'extensionVersion'<>'1.2.40'
      or p_receipt->>'extensionId'<>'llngdlffmjbnbmbffkfbknkkddjoknka'
      or coalesce((p_receipt->>'generation')::integer,-1)<>v_job.generation
      or (p_receipt->>'predecessorJobId') is distinct from
        v_job.predecessor_job_id::text
      or (p_receipt->>'predecessorReceiptDigest') is distinct from
        v_job.predecessor_receipt_digest then
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

revoke all on function public.enqueue_seller_os_commercial_trace_pricing_enrichment_v2(
  uuid,text,text,text,text,text,text,jsonb,text,text)
  from public,anon,authenticated;
grant execute on function public.enqueue_seller_os_commercial_trace_pricing_enrichment_v2(
  uuid,text,text,text,text,text,text,jsonb,text,text) to service_role;

comment on function public.enqueue_seller_os_commercial_trace_pricing_enrichment_v2(
  uuid,text,text,text,text,text,text,jsonb,text,text) is
  'Creates one immutable bounded pricing refresh generation only after terminal insufficient evidence, a newer mechanism or expiry, and remaining refresh budget.';
