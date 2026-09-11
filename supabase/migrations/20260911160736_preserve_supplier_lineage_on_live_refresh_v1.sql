-- Refresh marketplace facts without erasing the separately certified lineage.
-- No historical row is rewritten and no new acquisition/marketplace call occurs.
do $migration$
declare d text; anchor text := 'raw_payload = excluded.raw_payload,';
begin
 select pg_get_functiondef('public.record_ebay_current_live_authority_success_v1(text,uuid,text,timestamptz,timestamptz,jsonb,jsonb)'::regprocedure) into d;
 if strpos(d,anchor)=0 then raise exception 'LIVE_REFRESH_LINEAGE_PATCH_TARGET_MISSING'; end if;
 d:=replace(d,anchor,$replacement$
 raw_payload = excluded.raw_payload || case
  when target.account_key=excluded.account_key and target.ebay_item_id=excluded.ebay_item_id
   and target.ebay_sku is not distinct from excluded.ebay_sku
   and target.raw_payload#>>'{canonicalSupplierLineage,status}'='CERTIFIED'
   and target.raw_payload#>>'{canonicalSupplierLineage,accountKey}'=excluded.account_key
   and target.raw_payload#>>'{canonicalSupplierLineage,itemId}'=excluded.ebay_item_id
   and target.raw_payload#>>'{canonicalSupplierLineage,ebaySku}'=excluded.ebay_sku
  then jsonb_build_object('canonicalSupplierLineage',target.raw_payload->'canonicalSupplierLineage')
  else '{}'::jsonb end,
$replacement$);
 execute d;
end;
$migration$;
