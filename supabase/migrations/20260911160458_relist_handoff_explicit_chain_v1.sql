-- Multiple ended rows are not ambiguous when a single certified successor
-- chain covers them all. Bound traversal to one account/SKU and 32 predecessors.
do $migration$
declare d text; anchor text; replacement text;
begin
 select pg_get_functiondef('public.resolve_relist_supplier_handoff_v1(text,text,boolean)'::regprocedure) into d;
 d:=replace(d,'v_ids uuid[]; v_packages uuid[];',
  'v_ids uuid[]; v_heads uuid[]; v_chain uuid[]; v_cursor uuid; v_previous text; v_packages uuid[];');
 anchor:=' select array_agg(id) into v_ids from (select id from public.ebay_active_listings';
 if strpos(d,anchor)=0 then raise exception 'RELIST_CHAIN_PATCH_TARGET_MISSING'; end if;
 d:=replace(d,'and id<>v_active.id limit 2) h;', 'and id<>v_active.id limit 33) h;');
 anchor:=' if coalesce(cardinality(v_ids),0)<>1 then';
 replacement:=$chain$
 if cardinality(v_ids)>32 then
  return jsonb_build_object('status','WAITING_FOR_DATA','reason','RELIST_LINEAGE_BOUND_EXCEEDED','ownerActionRequired',false);
 end if;
 if cardinality(v_ids)>1 then
  select array_agg(a.id) into v_heads from public.ebay_active_listings a
  where a.id=any(v_ids) and not exists(select 1 from public.ebay_active_listings successor
   where successor.id=any(v_ids)
   and successor.raw_payload#>>'{canonicalSupplierLineage,status}'='CERTIFIED'
   and successor.raw_payload#>>'{canonicalSupplierLineage,supersedesItemId}'=a.ebay_item_id);
  if cardinality(v_heads)=1 then
   v_cursor:=v_heads[1]; v_chain:='{}'::uuid[];
   while v_cursor is not null and not v_cursor=any(v_chain) loop
    v_chain:=array_append(v_chain,v_cursor);
    select case when raw_payload#>>'{canonicalSupplierLineage,status}'='CERTIFIED'
     then raw_payload#>>'{canonicalSupplierLineage,supersedesItemId}' end
     into v_previous from public.ebay_active_listings where id=v_cursor;
    select id into v_cursor from public.ebay_active_listings where id=any(v_ids) and ebay_item_id=v_previous;
   end loop;
   if cardinality(v_chain)=cardinality(v_ids) and v_cursor is null
   and not exists(select 1 from public.ebay_active_listings a join public.ebay_active_listings tip on tip.id=v_heads[1]
    where a.id=any(v_ids) and (a.market_radar_product_id is distinct from tip.market_radar_product_id
      or a.supplier_variant_id is distinct from tip.supplier_variant_id or a.supplier_sku is distinct from tip.supplier_sku)) then
    v_ids:=v_heads;
   end if;
  end if;
 end if;
$chain$||anchor;
 d:=replace(d,anchor,replacement);
 -- An approval for a different exact supplier identity cannot fall back to an
 -- older manual certificate for this identity either.
 d:=replace(d,'select decision from public.seller_os_luna_linkage_decisions',
  'select decision,luna_product_id,luna_variant_id,luna_sku from public.seller_os_luna_linkage_decisions');
 d:=replace(d,') current_decision where decision is distinct from ''APPROVE_EXACT_LINKAGE'') then',
  ') current_decision where decision is distinct from ''APPROVE_EXACT_LINKAGE''
   or luna_product_id is distinct from v_opportunity.supplier_product_id
   or luna_variant_id is distinct from v_opportunity.supplier_variant_id
   or luna_sku is distinct from v_opportunity.supplier_sku) then');
 execute d;
end;
$migration$;
