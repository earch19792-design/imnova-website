-- Immutable authorities/receipts; bounded work is consumed by the existing economics lane.
create table public.seller_os_ebay_fee_bindings_v1 (
  binding_key text primary key,
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US' check (marketplace='EBAY_US'),
  package_id uuid,
  ebay_item_id text,
  sku text,
  input_revision jsonb not null default '{}'::jsonb,
  authority_id text,
  state text not null default 'PENDING_ORDER_CONTEXT' check (state in ('PROVEN_PRE_SALE','PENDING_ORDER_CONTEXT','STALE','CONFLICT','NOT_APPLICABLE')),
  next_due_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(marketplace_account_key,package_id)
);
create index seller_os_fee_binding_due_v1 on public.seller_os_ebay_fee_bindings_v1(marketplace_account_key,next_due_at,binding_key);
create index seller_os_fee_binding_item_v1 on public.seller_os_ebay_fee_bindings_v1(marketplace_account_key,ebay_item_id);

create table public.seller_os_ebay_fee_authorities_v1 (
  authority_id text primary key,
  binding_key text not null references public.seller_os_ebay_fee_bindings_v1(binding_key),
  marketplace_account_key text not null,
  ebay_item_id text,
  sku text,
  package_id uuid,
  input_fingerprint text not null,
  state text not null check (state in ('PROVEN_PRE_SALE','PENDING_ORDER_CONTEXT','STALE','CONFLICT','NOT_APPLICABLE')),
  authority jsonb not null,
  observed_at timestamptz not null,
  fresh_until timestamptz not null
);
create index seller_os_fee_authority_history_v1 on public.seller_os_ebay_fee_authorities_v1(marketplace_account_key,ebay_item_id,observed_at desc,authority_id);

create table public.seller_os_ebay_fee_reconciliation_receipts_v1 (
  receipt_id text primary key,
  marketplace_account_key text not null,
  order_id text not null,
  order_line_item_id text not null,
  ebay_item_id text not null,
  sku text,
  pre_sale_authority_id text references public.seller_os_ebay_fee_authorities_v1(authority_id),
  receipt jsonb not null,
  observed_at timestamptz not null,
  sold_at timestamptz not null
);
create index seller_os_fee_receipt_item_v1 on public.seller_os_ebay_fee_reconciliation_receipts_v1(marketplace_account_key,ebay_item_id,observed_at desc);
create index seller_os_fee_receipt_order_v1 on public.seller_os_ebay_fee_reconciliation_receipts_v1(marketplace_account_key,order_id,order_line_item_id);

alter table public.seller_os_ebay_fee_bindings_v1 enable row level security;
alter table public.seller_os_ebay_fee_authorities_v1 enable row level security;
alter table public.seller_os_ebay_fee_reconciliation_receipts_v1 enable row level security;
revoke all on public.seller_os_ebay_fee_bindings_v1, public.seller_os_ebay_fee_authorities_v1, public.seller_os_ebay_fee_reconciliation_receipts_v1 from public,anon,authenticated;
grant select,insert,update on public.seller_os_ebay_fee_bindings_v1 to service_role;
grant select,insert on public.seller_os_ebay_fee_authorities_v1,public.seller_os_ebay_fee_reconciliation_receipts_v1 to service_role;

create function public.seller_os_fee_immutable_v1() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin raise exception 'FEE_EVIDENCE_IMMUTABLE'; end;
$$;
revoke all on function public.seller_os_fee_immutable_v1() from public,anon,authenticated;
create trigger seller_os_fee_authority_immutable_v1 before update or delete on public.seller_os_ebay_fee_authorities_v1 for each row execute function public.seller_os_fee_immutable_v1();
create trigger seller_os_fee_receipt_immutable_v1 before update or delete on public.seller_os_ebay_fee_reconciliation_receipts_v1 for each row execute function public.seller_os_fee_immutable_v1();

create function public.seller_os_fee_package_handoff_v1() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if new.account_key is null then return new; end if;
  insert into public.seller_os_ebay_fee_bindings_v1(binding_key,marketplace_account_key,package_id,sku,input_revision)
  values (new.account_key||':package:'||new.id::text,new.account_key,new.id,new.package_data->>'sku',new.package_data)
  on conflict(binding_key) do update set input_revision=excluded.input_revision,
    sku=coalesce(excluded.sku,seller_os_ebay_fee_bindings_v1.sku),state='PENDING_ORDER_CONTEXT',next_due_at=now(),updated_at=now()
  where seller_os_ebay_fee_bindings_v1.input_revision is distinct from excluded.input_revision;
  return new;
end;
$$;
revoke all on function public.seller_os_fee_package_handoff_v1() from public,anon,authenticated;
create trigger seller_os_fee_package_handoff_v1 after insert or update of package_data,account_key on public.ebay_listing_packages for each row execute function public.seller_os_fee_package_handoff_v1();

create function public.seller_os_fee_live_handoff_v1() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if new.verified_active_at is null or new.listing_id is null then return new; end if;
  insert into public.seller_os_ebay_fee_bindings_v1(binding_key,marketplace_account_key,package_id,ebay_item_id,sku)
  values(new.marketplace_account_key||':package:'||new.listing_package_id::text,new.marketplace_account_key,new.listing_package_id,new.listing_id,new.sku)
  on conflict(binding_key) do update set ebay_item_id=excluded.ebay_item_id,sku=excluded.sku,
    state='PENDING_ORDER_CONTEXT',next_due_at=now(),updated_at=now()
  where seller_os_ebay_fee_bindings_v1.ebay_item_id is distinct from excluded.ebay_item_id or seller_os_ebay_fee_bindings_v1.sku is distinct from excluded.sku;
  return new;
end;
$$;
revoke all on function public.seller_os_fee_live_handoff_v1() from public,anon,authenticated;
create trigger seller_os_fee_live_handoff_v1 after insert or update of verified_active_at,listing_id,sku on public.ebay_authorized_listing_publications for each row execute function public.seller_os_fee_live_handoff_v1();

alter table public.marketplace_order_snapshots add column fee_evidence jsonb;
comment on column public.marketplace_order_snapshots.fee_evidence is 'PII-free observed Fulfillment totalMarketplaceFee/totalFeeBasisAmount; never a pre-sale estimate.';

-- Compare-and-swap prevents an in-flight calculation from restoring an
-- authority invalidated by a package/context change. Both writes are atomic.
create function public.seller_os_record_fee_authority_v1(p_binding_key text,p_expected_updated_at timestamptz,p_authority jsonb)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public as $$
declare b public.seller_os_ebay_fee_bindings_v1%rowtype;
begin
  select binding_key,marketplace_account_key,marketplace,package_id,ebay_item_id,sku,input_revision,authority_id,state,next_due_at,updated_at into b from public.seller_os_ebay_fee_bindings_v1 where binding_key=p_binding_key for update;
  if not found or b.updated_at<>p_expected_updated_at then return false; end if;
  if p_authority->>'marketplaceAccountKey' is distinct from b.marketplace_account_key
    or p_authority->>'packageId' is distinct from b.package_id::text
    or (b.ebay_item_id is not null and p_authority->>'itemId' is distinct from b.ebay_item_id)
    or (b.sku is not null and p_authority->>'sku' is distinct from b.sku)
    or p_authority->>'contractVersion'<>'SELLER_OS_EBAY_FEE_AUTHORITY_V1'
    then raise exception 'FEE_BINDING_CONFLICT'; end if;
  insert into public.seller_os_ebay_fee_authorities_v1(authority_id,binding_key,marketplace_account_key,ebay_item_id,sku,package_id,input_fingerprint,state,authority,observed_at,fresh_until)
  values(p_authority->>'authorityId',b.binding_key,b.marketplace_account_key,p_authority->>'itemId',p_authority->>'sku',b.package_id,p_authority->>'inputFingerprint',p_authority->>'state',p_authority,(p_authority->>'observedAt')::timestamptz,(p_authority->>'freshUntil')::timestamptz)
  on conflict(authority_id) do nothing;
  update public.seller_os_ebay_fee_bindings_v1 set authority_id=p_authority->>'authorityId',
    ebay_item_id=p_authority->>'itemId',sku=p_authority->>'sku',state=p_authority->>'state',
    next_due_at=(p_authority->>'freshUntil')::timestamptz,updated_at=clock_timestamp()
  where binding_key=p_binding_key;
  return true;
end;
$$;
revoke all on function public.seller_os_record_fee_authority_v1(text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.seller_os_record_fee_authority_v1(text,timestamptz,jsonb) to service_role;
