-- Read only; latest evidence per component prevents frequent price snapshots
-- from crowding out fees/costs. Existing evidence/outbox remain authoritative.
create function public.seller_os_ads_activation_inputs_v1(p_account_key text, p_item_ids text[], p_actor_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
 if p_account_key is null or p_actor_id is null or p_item_ids is null or cardinality(p_item_ids) not between 1 and 20
   or exists(select 1 from unnest(p_item_ids) id where id is null or id !~ '^[0-9]{9,20}$')
   or cardinality(p_item_ids) <> (select count(distinct id) from unnest(p_item_ids) id) then
   raise exception 'ADS_BOUNDED_INPUT_REQUIRED';
 end if;
 select jsonb_agg(jsonb_build_object('itemId',targets.item_id,
   'listings',(select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) from
     (select ebay_item_id,title,ebay_sku,ebay_price,ebay_quantity,currency,last_ebay_sync_at,source
      from public.ebay_active_listings where account_key=p_account_key and ebay_item_id=targets.item_id limit 3) l),
   'evidence',(select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from
     (select distinct on(evidence_type) evidence_id,evidence_type,value_amount,value_currency,captured_at,fresh_until,
        freshness_status,limitation_code,evidence_metadata
      from public.seller_os_live_economic_evidence_v1
      where marketplace_account_key=p_account_key and marketplace_id='EBAY_US' and ebay_item_id=targets.item_id
      order by evidence_type,captured_at desc,created_at desc,evidence_id) e),
   'feeHeads',(select coalesce(jsonb_agg(jsonb_build_object('state',h.state,'sku',h.sku,'authority',a.authority)), '[]'::jsonb)
      from public.seller_os_ebay_fee_bindings_v1 h left join public.seller_os_ebay_fee_authorities_v1 a
      on a.authority_id=h.authority_id and a.marketplace_account_key=h.marketplace_account_key
      where h.marketplace_account_key=p_account_key and h.ebay_item_id=targets.item_id),
   'latestFeeReconciliation',(select r.receipt from public.seller_os_ebay_fee_reconciliation_receipts_v1 r
      where r.marketplace_account_key=p_account_key and r.ebay_item_id=targets.item_id order by r.observed_at desc,r.receipt_id limit 1),
   'policyDraft',(select jsonb_build_object('id',o.id,'receivedAt',o.received_at,'policy',o.intent->'requestedChanges'->'policy')
      from public.seller_os_ipad_outbox_v1 o where o.account_key=p_account_key and o.item_id=targets.item_id
      and o.actor_user_id=p_actor_id and o.kind='ADS_POLICY' order by o.received_at desc,o.id limit 1)
 )) into result from unnest(p_item_ids) as targets(item_id);
 return coalesce(result,'[]'::jsonb);
end $$;
revoke all on function public.seller_os_ads_activation_inputs_v1(text,text[],uuid) from public,anon,authenticated;
grant execute on function public.seller_os_ads_activation_inputs_v1(text,text[],uuid) to service_role;
