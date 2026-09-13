-- A batch Shipping result is consumable only through one durable CURRENT-slot
-- binding. The binding is selected by the normal Radar/Factory order and is
-- verified against the canonical account/product/variant/SKU identity before
-- a claim or immutable frontier receipt can advance the batch.

create table public.seller_os_autonomous_stocking_batch_shipping_slots_v1 (
  child_id uuid primary key references
    public.seller_os_autonomous_stocking_batch_children_v1(id)
    on delete restrict,
  batch_id uuid not null references
    public.seller_os_autonomous_stocking_batches_v1(id)
    on delete restrict,
  account_key text not null,
  sequence_no integer not null,
  canonical_candidate_id text not null,
  opportunity_id uuid not null references
    public.ebay_luna_opportunity_queue(id) on delete restrict,
  listing_package_id uuid not null references
    public.ebay_listing_packages(id) on delete restrict,
  product_id text not null,
  variant_id text not null,
  supplier_sku text not null,
  status text not null default 'WAITING_CAPTURE',
  capture_session_id uuid null,
  frontier_id text null,
  shipping_amount numeric(12,2) null,
  exact_durable_result_count integer not null default 0,
  foreign_receipt_adopted boolean not null default false,
  manual_identity_rebind boolean not null default false,
  codex_runtime_dependency boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint autonomous_stocking_shipping_slot_sequence_check check (
    sequence_no between 1 and 20),
  constraint autonomous_stocking_shipping_slot_candidate_check check (
    canonical_candidate_id ~ '^sha256:[0-9a-f]{64}$'),
  constraint autonomous_stocking_shipping_slot_status_check check (
    status in ('WAITING_CAPTURE','CAPTURE_ACTIVE','SHIPPING_READY')),
  constraint autonomous_stocking_shipping_slot_identity_check check (
    canonical_candidate_id =
      public.seller_os_current_commercial_candidate_id_v1(
        account_key,'EBAY_US','LUNAPORTEX',product_id,variant_id,supplier_sku)),
  constraint autonomous_stocking_shipping_slot_receipt_check check (
    (status <> 'SHIPPING_READY' and capture_session_id is null
      and frontier_id is null and shipping_amount is null
      and exact_durable_result_count = 0)
    or
    (status = 'SHIPPING_READY' and capture_session_id is not null
      and frontier_id ~ '^profitability-frontier-v1:sha256:[0-9a-f]{64}$'
      and shipping_amount >= 0 and exact_durable_result_count = 1)),
  constraint autonomous_stocking_shipping_slot_safety_check check (
    not foreign_receipt_adopted and not manual_identity_rebind
      and not codex_runtime_dependency),
  unique (batch_id, sequence_no),
  unique (batch_id, canonical_candidate_id)
);

create unique index autonomous_stocking_one_open_shipping_slot_uidx on
  public.seller_os_autonomous_stocking_batch_shipping_slots_v1(account_key)
  where status in ('WAITING_CAPTURE','CAPTURE_ACTIVE');

alter table public.seller_os_autonomous_stocking_batch_shipping_slots_v1
  enable row level security;
alter table public.seller_os_autonomous_stocking_batch_shipping_slots_v1
  force row level security;
revoke all on table
  public.seller_os_autonomous_stocking_batch_shipping_slots_v1
  from public,anon,authenticated,service_role;
grant select,insert,update on table
  public.seller_os_autonomous_stocking_batch_shipping_slots_v1
  to service_role;

create or replace function public.bind_autonomous_stocking_batch_shipping_slot_v1(
  p_account_key text,
  p_batch_id uuid,
  p_child_id uuid,
  p_canonical_candidate_id text,
  p_opportunity_id uuid,
  p_listing_package_id uuid,
  p_product_id text,
  p_variant_id text,
  p_supplier_sku text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_child public.seller_os_autonomous_stocking_batch_children_v1%rowtype;
  v_queue public.ebay_luna_opportunity_queue%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_slot public.seller_os_autonomous_stocking_batch_shipping_slots_v1%rowtype;
  v_canonical text;
begin
  if not public.is_seller_os_service_role_request_v1()
    or p_batch_id is null or p_child_id is null
    or p_opportunity_id is null or p_listing_package_id is null then
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_INPUT_INVALID';
  end if;
  v_canonical:=public.seller_os_current_commercial_candidate_id_v1(
    p_account_key,'EBAY_US','LUNAPORTEX',p_product_id,p_variant_id,p_supplier_sku);
  if v_canonical is null or v_canonical is distinct from p_canonical_candidate_id then
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_CANONICAL_MISMATCH';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'autonomous-stocking-shipping-slot:'||p_account_key,0));
  select child.* into v_child
  from public.seller_os_autonomous_stocking_batch_children_v1 child
  join public.seller_os_autonomous_stocking_batches_v1 batch
    on batch.id=child.batch_id
  where child.id=p_child_id and child.batch_id=p_batch_id
    and child.account_key=p_account_key and child.status='SELECTING'
    and batch.account_key=p_account_key and batch.status='ACTIVE'
  for update of child;
  if not found then
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_CHILD_NOT_CURRENT';
  end if;
  if exists(select 1
    from public.seller_os_autonomous_stocking_batch_children_v1 prior
    where prior.batch_id=p_batch_id and prior.sequence_no<v_child.sequence_no
      and prior.status<>'REPLAY_CONFIRMED') then
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_SEQUENCE_VIOLATION';
  end if;
  select * into v_queue from public.ebay_luna_opportunity_queue
  where id=p_opportunity_id and supplier_product_id=p_product_id
    and supplier_variant_id=p_variant_id and supplier_sku=p_supplier_sku;
  if not found then
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_QUEUE_MISMATCH';
  end if;
  select * into v_package from public.ebay_listing_packages
  where id=p_listing_package_id and opportunity_id=p_opportunity_id
    and account_key=p_account_key;
  if not found then
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_PACKAGE_MISMATCH';
  end if;
  perform public.reconcile_seller_os_current_candidate_identity_v1(
    p_account_key,p_opportunity_id,v_canonical);
  if not exists(select 1
    from public.seller_os_current_candidate_identities_v1 identity
    where identity.canonical_candidate_id=v_canonical
      and identity.account_key=p_account_key
      and identity.marketplace_id='EBAY_US'
      and identity.supplier_authority='LUNAPORTEX'
      and identity.product_id=p_product_id
      and identity.variant_id=p_variant_id
      and identity.supplier_sku=p_supplier_sku) then
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_IDENTITY_NOT_DURABLE';
  end if;
  select * into v_slot
  from public.seller_os_autonomous_stocking_batch_shipping_slots_v1
  where child_id=p_child_id for update;
  if found then
    if v_slot.batch_id is distinct from p_batch_id
      or v_slot.account_key is distinct from p_account_key
      or v_slot.canonical_candidate_id is distinct from v_canonical
      or v_slot.opportunity_id is distinct from p_opportunity_id
      or v_slot.listing_package_id is distinct from p_listing_package_id
      or v_slot.product_id is distinct from p_product_id
      or v_slot.variant_id is distinct from p_variant_id
      or v_slot.supplier_sku is distinct from p_supplier_sku then
      raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_BINDING_CONTRADICTION';
    end if;
    return to_jsonb(v_slot);
  end if;
  insert into public.seller_os_autonomous_stocking_batch_shipping_slots_v1(
    child_id,batch_id,account_key,sequence_no,canonical_candidate_id,
    opportunity_id,listing_package_id,product_id,variant_id,supplier_sku)
  values(p_child_id,p_batch_id,p_account_key,v_child.sequence_no,v_canonical,
    p_opportunity_id,p_listing_package_id,p_product_id,p_variant_id,p_supplier_sku)
  returning * into v_slot;
  update public.seller_os_autonomous_stocking_batch_children_v1 set
    evidence=evidence||jsonb_build_object('currentShippingSlotV1',
      jsonb_build_object(
        'contractVersion','AUTONOMOUS_STOCKING_CURRENT_SHIPPING_SLOT_V1',
        'canonicalCandidateId',v_canonical,
        'productId',p_product_id,'variantId',p_variant_id,
        'supplierSku',p_supplier_sku,'opportunityId',p_opportunity_id,
        'listingPackageId',p_listing_package_id,
        'foreignReceiptAdopted',false,'manualIdentityRebind',false,
        'codexRuntimeDependency',false)),
    updated_at=clock_timestamp()
  where id=p_child_id and status='SELECTING';
  return to_jsonb(v_slot);
end; $$;

create or replace function public.get_autonomous_stocking_batch_shipping_slot_readback_v1(
  p_account_key text,
  p_batch_id uuid default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_slot public.seller_os_autonomous_stocking_batch_shipping_slots_v1%rowtype;
  v_claim public.seller_os_luna_shipping_job_claims%rowtype;
  v_exact_count integer:=0;
  v_mismatch_count integer:=0;
  v_capture_count integer:=0;
  v_frontier_id text;
  v_shipping_amount numeric;
  v_active_count integer:=0;
begin
  if not public.is_seller_os_service_role_request_v1() then
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_SERVICE_ROLE_REQUIRED';
  end if;
  select slot.* into v_slot
  from public.seller_os_autonomous_stocking_batch_shipping_slots_v1 slot
  join public.seller_os_autonomous_stocking_batches_v1 batch
    on batch.id=slot.batch_id
  join public.seller_os_autonomous_stocking_batch_children_v1 child
    on child.id=slot.child_id and child.batch_id=slot.batch_id
  where slot.account_key=p_account_key
    and (p_batch_id is null or slot.batch_id=p_batch_id)
    and batch.status in ('ACTIVE','BLOCKED')
    and child.status='SELECTING'
  order by batch.started_at,slot.sequence_no limit 1;
  if not found then return jsonb_build_object('slotPresent',false); end if;
  if v_slot.canonical_candidate_id is distinct from
      public.seller_os_current_commercial_candidate_id_v1(
        v_slot.account_key,'EBAY_US','LUNAPORTEX',v_slot.product_id,
        v_slot.variant_id,v_slot.supplier_sku) then
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_DERIVATION_CONTRADICTION';
  end if;
  select count(*)::integer into v_active_count
  from public.seller_os_luna_shipping_job_claims claim
  where claim.account_key=v_slot.account_key
    and claim.candidate_id=v_slot.canonical_candidate_id
    and claim.status='CLAIMED' and claim.lease_expires_at>v_now;
  if v_active_count>1 then
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_ACTIVE_CAPTURE_AMBIGUOUS';
  end if;
  select * into v_claim
  from public.seller_os_luna_shipping_job_claims claim
  where claim.account_key=v_slot.account_key
    and claim.candidate_id=v_slot.canonical_candidate_id;
  if found and v_claim.status='COMPLETED' then
    select count(*)::integer,max(snapshot.frontier_id),
      max(snapshot.shipping_value)
    into v_exact_count,v_frontier_id,v_shipping_amount
    from public.seller_os_profitability_frontier_snapshots snapshot
    where snapshot.account_key=v_slot.account_key
      and snapshot.shipping_status='SHIPPING_DURABLY_PERSISTED'
      and snapshot.frontier_payload#>>'{shippingCaptureEvidence,candidateId}'=
        v_slot.canonical_candidate_id
      and snapshot.frontier_payload#>>'{shippingCaptureEvidence,captureSessionId}'=
        v_claim.capture_session_id::text
      and snapshot.luna_product_id=v_slot.product_id
      and snapshot.luna_variant_id=v_slot.variant_id
      and snapshot.luna_sku=v_slot.supplier_sku;
    select count(distinct
      snapshot.frontier_payload#>>'{shippingCaptureEvidence,captureSessionId}')::integer
    into v_capture_count
    from public.seller_os_profitability_frontier_snapshots snapshot
    where snapshot.account_key=v_slot.account_key
      and snapshot.shipping_status='SHIPPING_DURABLY_PERSISTED'
      and snapshot.frontier_payload#>>'{shippingCaptureEvidence,candidateId}'=
        v_slot.canonical_candidate_id
      and snapshot.luna_product_id=v_slot.product_id
      and snapshot.luna_variant_id=v_slot.variant_id
      and snapshot.luna_sku=v_slot.supplier_sku;
    select count(*)::integer into v_mismatch_count
    from public.seller_os_profitability_frontier_snapshots snapshot
    where snapshot.account_key=v_slot.account_key
      and snapshot.shipping_status='SHIPPING_DURABLY_PERSISTED'
      and snapshot.frontier_payload#>>'{shippingCaptureEvidence,candidateId}'=
        v_slot.canonical_candidate_id
      and snapshot.frontier_payload#>>'{shippingCaptureEvidence,captureSessionId}'=
        v_claim.capture_session_id::text
      and (snapshot.luna_product_id is distinct from v_slot.product_id
        or snapshot.luna_variant_id is distinct from v_slot.variant_id
        or snapshot.luna_sku is distinct from v_slot.supplier_sku);
    if v_mismatch_count>0 or v_exact_count>1 then
      raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_RECEIPT_AMBIGUOUS';
    end if;
    if v_exact_count=1 then
      update public.seller_os_autonomous_stocking_batch_shipping_slots_v1 set
        status='SHIPPING_READY',capture_session_id=v_claim.capture_session_id,
        frontier_id=v_frontier_id,shipping_amount=v_shipping_amount,
        exact_durable_result_count=1,updated_at=v_now
      where child_id=v_slot.child_id and status<>'SHIPPING_READY'
      returning * into v_slot;
    end if;
  end if;
  if v_slot.status<>'SHIPPING_READY' then
    update public.seller_os_autonomous_stocking_batch_shipping_slots_v1 set
      status=case when v_active_count=1 then 'CAPTURE_ACTIVE'
        else 'WAITING_CAPTURE' end,updated_at=v_now
    where child_id=v_slot.child_id and status<>'SHIPPING_READY'
    returning * into v_slot;
  end if;
  return jsonb_build_object(
    'slotPresent',true,'batchId',v_slot.batch_id,'childId',v_slot.child_id,
    'sequenceNo',v_slot.sequence_no,
    'canonicalCandidateId',v_slot.canonical_candidate_id,
    'productId',v_slot.product_id,'variantId',v_slot.variant_id,
    'supplierSku',v_slot.supplier_sku,'status',v_slot.status,
    'targetActiveCaptureCount',v_active_count,
    'targetCurrentShippingCaptureExecuted',v_slot.status='SHIPPING_READY',
    'currentExactBoundQuote',v_slot.status='SHIPPING_READY',
    'captureResultDurable',v_slot.status='SHIPPING_READY',
    'durableReadbackMatch',v_slot.status='SHIPPING_READY',
    'shippingReceiptCommercialIdentityMatch',v_slot.status='SHIPPING_READY',
    'shippingDuplicateCaptureCount',case when v_slot.status='SHIPPING_READY'
      then greatest(v_capture_count-1,0) else 0 end,
    'shippingReady',v_slot.status='SHIPPING_READY',
    'shippingAmount',v_slot.shipping_amount,
    'captureSessionId',v_slot.capture_session_id,
    'frontierId',v_slot.frontier_id,
    'exactDurableResultCount',v_slot.exact_durable_result_count,
    'foreignReceiptAdopted',false,'manualIdentityRebind',false,
    'codexRuntimeDependency',false);
end; $$;

revoke all on function public.bind_autonomous_stocking_batch_shipping_slot_v1(
  text,uuid,uuid,text,uuid,uuid,text,text,text)
  from public,anon,authenticated;
revoke all on function public.get_autonomous_stocking_batch_shipping_slot_readback_v1(
  text,uuid) from public,anon,authenticated;
grant execute on function public.bind_autonomous_stocking_batch_shipping_slot_v1(
  text,uuid,uuid,text,uuid,uuid,text,text,text) to service_role;
grant execute on function public.get_autonomous_stocking_batch_shipping_slot_readback_v1(
  text,uuid) to service_role;

comment on table public.seller_os_autonomous_stocking_batch_shipping_slots_v1 is
  'Exact CURRENT commercial identity gate between autonomous batch slots and Luna Shipping claims/receipts; foreign receipts are immutable but unconsumable.';

notify pgrst,'reload schema';
