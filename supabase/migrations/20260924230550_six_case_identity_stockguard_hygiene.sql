-- Reuse exact legacy opportunity rows without weakening the supplier tuple
-- and allow a quarantined contradictory decision to be superseded by OWNER.
do $migration$
declare
  v_function text;
  v_old text;
  v_new text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.confirm_seller_os_listing_manual_identity_v1(text,text,uuid,text,text,text,timestamptz,text,text,integer,numeric,text,uuid)'::pg_catalog.regprocedure)
    into v_function;
  v_old := $old$  if not exists (select 1 from public.ebay_luna_opportunity_queue o
    where o.id=p_opportunity_id and o.candidate_key=
      'luna-portex:'||p_luna_product_id||':'||p_luna_variant_id
      and o.market_radar_product_id=v_market_product_id
      and o.supplier_product_id=p_luna_product_id
      and o.supplier_variant_id=p_luna_variant_id and o.supplier_sku=p_luna_sku) then
    raise exception 'LISTING_OWNER_CANONICAL_OPPORTUNITY_REQUIRED';
  end if;$old$;
  v_new := $new$  select count(*) into v_count from public.ebay_luna_opportunity_queue o
  where o.market_radar_product_id=v_market_product_id
    and o.supplier_product_id=p_luna_product_id
    and o.supplier_variant_id=p_luna_variant_id and o.supplier_sku=p_luna_sku;
  if v_count<>1 or not exists (select 1 from public.ebay_luna_opportunity_queue o
    where o.id=p_opportunity_id
      and (o.candidate_key='luna-portex:'||p_luna_product_id||':'||p_luna_variant_id
        or o.candidate_key ~ '^sha256:[0-9a-f]{64}$')
      and o.market_radar_product_id=v_market_product_id
      and o.supplier_product_id=p_luna_product_id
      and o.supplier_variant_id=p_luna_variant_id and o.supplier_sku=p_luna_sku) then
    raise exception 'LISTING_OWNER_CANONICAL_OPPORTUNITY_REQUIRED';
  end if;$new$;
  if pg_catalog.length(v_function)-pg_catalog.length(
      pg_catalog.replace(v_function,v_old,'')) <> pg_catalog.length(v_old) then
    raise exception 'SIX_CASE_OPPORTUNITY_ANCHOR_MISMATCH';
  end if;
  v_function := pg_catalog.replace(v_function,v_old,v_new);
  v_old := $old$      and d.ebay_item_id<>p_ebay_item_id)
    or exists (select 1 from public.seller_os_listing_product_link_authorities_v1 a$old$;
  v_new := $new$      and d.ebay_item_id<>p_ebay_item_id
      and not exists (select 1 from public.seller_os_listing_identity_quarantines_v1 q
        where q.account_key=d.account_key and q.marketplace_id='EBAY_US'
          and q.ebay_item_id=d.ebay_item_id
          and q.quarantine_state='ACTIVE'
          and q.reason_code='CONTRADICTED_SUPPLIER_IDENTITY'
          and p_ebay_item_id=any(q.conflicting_item_ids)))
    or exists (select 1 from public.seller_os_listing_product_link_authorities_v1 a$new$;
  if pg_catalog.length(v_function)-pg_catalog.length(
      pg_catalog.replace(v_function,v_old,'')) <> pg_catalog.length(v_old) then
    raise exception 'SIX_CASE_SUPERSESSION_ANCHOR_MISMATCH';
  end if;
  execute pg_catalog.replace(v_function,v_old,v_new);
end;
$migration$;

-- Preserve the immutable original observation while correcting its numeric
-- interpretation when OWNER reports that no number was entered or visible.
create table public.seller_os_owner_luna_stock_quantity_corrections_v1 (
  observation_id uuid primary key references
    public.seller_os_owner_luna_stock_observations_v1(observation_id)
    on delete restrict,
  original_reported_quantity integer not null check
    (original_reported_quantity between 0 and 1000000),
  corrected_quantity integer null check (corrected_quantity is null),
  reason_code text not null check
    (reason_code = 'OWNER_REPORTED_NUMERIC_QUANTITY_NOT_ENTERED'),
  recorded_at timestamptz not null default clock_timestamp()
);
alter table public.seller_os_owner_luna_stock_quantity_corrections_v1
  enable row level security;
alter table public.seller_os_owner_luna_stock_quantity_corrections_v1
  force row level security;
revoke all on public.seller_os_owner_luna_stock_quantity_corrections_v1
  from public, anon, authenticated, service_role;
grant select, insert on public.seller_os_owner_luna_stock_quantity_corrections_v1
  to service_role;
create policy seller_os_owner_stock_quantity_correction_service_role
  on public.seller_os_owner_luna_stock_quantity_corrections_v1
  for all to service_role using (true) with check (true);
create trigger seller_os_owner_stock_quantity_correction_immutable
  before update or delete on
    public.seller_os_owner_luna_stock_quantity_corrections_v1
  for each row execute function
    public.prevent_seller_os_luna_stock_observation_mutation_v1();
