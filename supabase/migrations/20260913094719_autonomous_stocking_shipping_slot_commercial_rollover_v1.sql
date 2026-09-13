create table public.seller_os_autonomous_stocking_shipping_slot_attempts_v1 (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references
    public.seller_os_autonomous_stocking_batch_children_v1(id) on delete restrict,
  batch_id uuid not null references
    public.seller_os_autonomous_stocking_batches_v1(id) on delete restrict,
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
  capture_session_id uuid not null,
  frontier_id text not null,
  shipping_amount numeric(12,2) not null,
  exact_durable_result_count integer not null,
  retirement_status text not null,
  retirement_reason text not null,
  foreign_receipt_adopted boolean not null,
  manual_identity_rebind boolean not null,
  codex_runtime_dependency boolean not null,
  retired_at timestamptz not null default clock_timestamp(),
  constraint autonomous_stocking_shipping_attempt_candidate_check check (
    canonical_candidate_id ~ '^sha256:[0-9a-f]{64}$'),
  constraint autonomous_stocking_shipping_attempt_frontier_check check (
    frontier_id ~ '^profitability-frontier-v1:sha256:[0-9a-f]{64}$'),
  constraint autonomous_stocking_shipping_attempt_result_check check (
    shipping_amount>=0 and exact_durable_result_count=1),
  constraint autonomous_stocking_shipping_attempt_retirement_check check (
    retirement_status in (
      'PARKED','PARKED_ECONOMICS','EXCLUDED_ALREADY_LIVE')
    and retirement_reason ~ '^[A-Z][A-Z0-9_]{3,159}$'),
  constraint autonomous_stocking_shipping_attempt_safety_check check (
    not foreign_receipt_adopted and not manual_identity_rebind
      and not codex_runtime_dependency),
  unique(child_id,canonical_candidate_id),
  unique(child_id,capture_session_id)
);

create or replace function public.reject_autonomous_stocking_shipping_attempt_mutation_v1()
returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  raise exception 'AUTONOMOUS_STOCKING_SHIPPING_ATTEMPT_APPEND_ONLY';
end; $$;

create trigger autonomous_stocking_shipping_attempt_append_only_v1
before update or delete on
  public.seller_os_autonomous_stocking_shipping_slot_attempts_v1
for each row execute function
  public.reject_autonomous_stocking_shipping_attempt_mutation_v1();

create or replace function public.rollover_autonomous_stocking_batch_shipping_slot_v1(
  p_account_key text,
  p_batch_id uuid,
  p_child_id uuid,
  p_prior_candidate_id text,
  p_retirement_status text,
  p_retirement_reason text,
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
  v_slot public.seller_os_autonomous_stocking_batch_shipping_slots_v1%rowtype;
  v_queue public.ebay_luna_opportunity_queue%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_canonical text;
  v_receipt_count integer;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_batch_id is null or p_child_id is null
      or p_prior_candidate_id !~ '^sha256:[0-9a-f]{64}$'
      or p_retirement_status not in (
        'PARKED','PARKED_ECONOMICS','EXCLUDED_ALREADY_LIVE')
      or p_retirement_reason !~ '^[A-Z][A-Z0-9_]{3,159}$'
      or p_opportunity_id is null or p_listing_package_id is null then
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_ROLLOVER_INPUT_INVALID';
  end if;
  v_canonical:=public.seller_os_current_commercial_candidate_id_v1(
    p_account_key,'EBAY_US','LUNAPORTEX',p_product_id,p_variant_id,
    p_supplier_sku);
  if v_canonical is null or v_canonical is distinct from
      p_canonical_candidate_id or v_canonical=p_prior_candidate_id then
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_ROLLOVER_CANONICAL_MISMATCH';
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
  if not found or exists(select 1
    from public.seller_os_autonomous_stocking_batch_children_v1 prior
    where prior.batch_id=p_batch_id and prior.sequence_no<v_child.sequence_no
      and prior.status<>'REPLAY_CONFIRMED') then
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_ROLLOVER_SEQUENCE_INVALID';
  end if;
  select * into v_slot
  from public.seller_os_autonomous_stocking_batch_shipping_slots_v1
  where child_id=p_child_id and batch_id=p_batch_id
    and account_key=p_account_key and status='SHIPPING_READY'
    and canonical_candidate_id=p_prior_candidate_id
  for update;
  if not found or v_slot.exact_durable_result_count<>1
      or v_slot.foreign_receipt_adopted
      or v_slot.manual_identity_rebind or v_slot.codex_runtime_dependency then
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_ROLLOVER_PRIOR_INVALID';
  end if;
  select count(*)::integer into v_receipt_count
  from public.seller_os_profitability_frontier_snapshots snapshot
  where snapshot.account_key=v_slot.account_key
    and snapshot.shipping_status='SHIPPING_DURABLY_PERSISTED'
    and snapshot.frontier_id=v_slot.frontier_id
    and snapshot.shipping_value=v_slot.shipping_amount
    and snapshot.frontier_payload#>>'{shippingCaptureEvidence,candidateId}'=
      v_slot.canonical_candidate_id
    and snapshot.frontier_payload#>>'{shippingCaptureEvidence,captureSessionId}'=
      v_slot.capture_session_id::text
    and snapshot.luna_product_id=v_slot.product_id
    and snapshot.luna_variant_id=v_slot.variant_id
    and snapshot.luna_sku=v_slot.supplier_sku;
  if v_receipt_count<>1 then
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_ROLLOVER_RECEIPT_INVALID';
  end if;
  select * into v_queue from public.ebay_luna_opportunity_queue
  where id=p_opportunity_id and supplier_product_id=p_product_id
    and supplier_variant_id=p_variant_id and supplier_sku=p_supplier_sku;
  if not found then
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_ROLLOVER_QUEUE_MISMATCH';
  end if;
  select * into v_package from public.ebay_listing_packages
  where id=p_listing_package_id and opportunity_id=p_opportunity_id
    and account_key=p_account_key;
  if not found then
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_ROLLOVER_PACKAGE_MISMATCH';
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
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_ROLLOVER_IDENTITY_NOT_DURABLE';
  end if;
  insert into public.seller_os_autonomous_stocking_shipping_slot_attempts_v1(
    child_id,batch_id,account_key,sequence_no,canonical_candidate_id,
    opportunity_id,listing_package_id,product_id,variant_id,supplier_sku,
    capture_session_id,frontier_id,shipping_amount,
    exact_durable_result_count,retirement_status,retirement_reason,
    foreign_receipt_adopted,manual_identity_rebind,codex_runtime_dependency)
  values(v_slot.child_id,v_slot.batch_id,v_slot.account_key,
    v_slot.sequence_no,v_slot.canonical_candidate_id,v_slot.opportunity_id,
    v_slot.listing_package_id,v_slot.product_id,v_slot.variant_id,
    v_slot.supplier_sku,v_slot.capture_session_id,v_slot.frontier_id,
    v_slot.shipping_amount,v_slot.exact_durable_result_count,
    p_retirement_status,p_retirement_reason,false,false,false)
  on conflict(child_id,canonical_candidate_id) do nothing;
  update public.seller_os_autonomous_stocking_batch_shipping_slots_v1 set
    canonical_candidate_id=v_canonical,opportunity_id=p_opportunity_id,
    listing_package_id=p_listing_package_id,product_id=p_product_id,
    variant_id=p_variant_id,supplier_sku=p_supplier_sku,
    status='WAITING_CAPTURE',capture_session_id=null,frontier_id=null,
    shipping_amount=null,exact_durable_result_count=0,
    foreign_receipt_adopted=false,manual_identity_rebind=false,
    codex_runtime_dependency=false,updated_at=clock_timestamp()
  where child_id=p_child_id and canonical_candidate_id=p_prior_candidate_id
  returning * into v_slot;
  if not found then
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_ROLLOVER_CONFLICT';
  end if;
  update public.seller_os_autonomous_stocking_batch_children_v1 set
    evidence=evidence||jsonb_build_object('currentShippingSlotV1',
      jsonb_build_object(
        'contractVersion','AUTONOMOUS_STOCKING_CURRENT_SHIPPING_SLOT_V1',
        'canonicalCandidateId',v_canonical,
        'productId',p_product_id,'variantId',p_variant_id,
        'supplierSku',p_supplier_sku,'opportunityId',p_opportunity_id,
        'listingPackageId',p_listing_package_id,
        'foreignReceiptAdopted',false,'manualIdentityRebind',false,
        'codexRuntimeDependency',false)),updated_at=clock_timestamp()
  where id=p_child_id and status='SELECTING';
  return to_jsonb(v_slot);
end; $$;

alter table public.seller_os_autonomous_stocking_shipping_slot_attempts_v1
  enable row level security;
alter table public.seller_os_autonomous_stocking_shipping_slot_attempts_v1
  force row level security;
revoke all on table
  public.seller_os_autonomous_stocking_shipping_slot_attempts_v1
  from public,anon,authenticated,service_role;
grant select,insert on table
  public.seller_os_autonomous_stocking_shipping_slot_attempts_v1
  to service_role;
revoke all on function public.reject_autonomous_stocking_shipping_attempt_mutation_v1()
  from public,anon,authenticated,service_role;
revoke all on function public.rollover_autonomous_stocking_batch_shipping_slot_v1(
  text,uuid,uuid,text,text,text,text,uuid,uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.rollover_autonomous_stocking_batch_shipping_slot_v1(
  text,uuid,uuid,text,text,text,text,uuid,uuid,text,text,text)
  to service_role;

comment on table public.seller_os_autonomous_stocking_shipping_slot_attempts_v1 is
  'Append-only exact Shipping receipts for autonomously retired commercial candidates; receipts are never rebound to a successor slot.';

notify pgrst,'reload schema';
