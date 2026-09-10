-- Use the existing evidence index to read one head per component and listing.
-- No marketplace calls and no changes to the shipping worker or outbox.
create function public.seller_os_latest_economic_evidence_v1(p_account_key text,p_item_ids text[])
returns setof public.seller_os_live_economic_evidence_v1
language plpgsql stable security invoker set search_path='' as $$
begin
 if p_account_key is null or p_item_ids is null or cardinality(p_item_ids)>100
   or exists(select 1 from unnest(p_item_ids) id where id is null or id !~ '^[0-9]{9,20}$')
   or cardinality(p_item_ids)<>(select count(distinct id) from unnest(p_item_ids) id) then
   raise exception 'ECONOMIC_BOUNDED_SCOPE_REQUIRED';
 end if;
 return query select e.* from unnest(p_item_ids) as targets(item_id)
 cross join lateral (
   select distinct on(evidence_type) * from public.seller_os_live_economic_evidence_v1
   where marketplace_account_key=p_account_key and marketplace_id='EBAY_US' and ebay_item_id=targets.item_id
   order by evidence_type,captured_at desc,created_at desc,evidence_id
 ) e;
end $$;
revoke all on function public.seller_os_latest_economic_evidence_v1(text,text[]) from public,anon,authenticated;
grant execute on function public.seller_os_latest_economic_evidence_v1(text,text[]) to service_role;

create table public.seller_os_ads_report_observations_v1 (
 receipt_id text primary key check(receipt_id ~ '^[a-f0-9]{64}$'),
 account_key text not null, ebay_item_id text not null check(ebay_item_id ~ '^[0-9]{9,20}$'),
 campaign_id text not null, ad_id text not null, report_id text not null, report_revision text not null,
 window_start timestamptz not null, window_end timestamptz not null, observed_at timestamptz not null,
 receipt jsonb not null check(jsonb_typeof(receipt)='object'),
 unique(account_key,report_id,report_revision,ebay_item_id,campaign_id,ad_id,window_start,window_end),
 check(window_start<window_end and window_end<=observed_at)
);
alter table public.seller_os_ads_report_observations_v1 enable row level security;
revoke all on public.seller_os_ads_report_observations_v1 from public,anon,authenticated,service_role;
grant select,insert on public.seller_os_ads_report_observations_v1 to service_role;
create policy service_read on public.seller_os_ads_report_observations_v1 for select to service_role using(true);
create policy service_insert on public.seller_os_ads_report_observations_v1 for insert to service_role with check(true);
create index seller_os_ads_report_listing_v1_idx on public.seller_os_ads_report_observations_v1(account_key,ebay_item_id,window_end desc,observed_at desc);
create trigger seller_os_ads_report_immutable_v1 before update or delete on public.seller_os_ads_report_observations_v1
 for each row execute function public.seller_os_fee_immutable_v1();

create function public.seller_os_record_ads_report_observation_v1(p_receipt jsonb) returns text
language plpgsql security invoker set search_path='' as $$
declare existing_id text;
begin
 if p_receipt->>'contractVersion' is distinct from 'SELLER_OS_ADS_POST_SALE_REPORT_INGESTION_CONTRACT_V1'
   or p_receipt->>'marketplace' is distinct from 'EBAY_US' or p_receipt->>'currency' is distinct from 'USD'
   or p_receipt->>'causalAttribution' is distinct from 'false'
   or not exists(select 1 from public.ebay_active_listings where account_key=p_receipt->>'accountKey'
     and ebay_item_id=p_receipt->>'itemId') then raise exception 'ADS_REPORT_EXACT_OFFICIAL_SCOPE_REQUIRED'; end if;
 insert into public.seller_os_ads_report_observations_v1
  (receipt_id,account_key,ebay_item_id,campaign_id,ad_id,report_id,report_revision,window_start,window_end,observed_at,receipt)
 values(p_receipt->>'receiptId',p_receipt->>'accountKey',p_receipt->>'itemId',p_receipt->>'campaignId',coalesce(p_receipt->>'adId',''),
   p_receipt->>'reportId',p_receipt->>'reportRevision',(p_receipt->>'windowStart')::timestamptz,(p_receipt->>'windowEnd')::timestamptz,
   (p_receipt->>'observedAt')::timestamptz,p_receipt) on conflict do nothing;
 select receipt_id into existing_id from public.seller_os_ads_report_observations_v1
 where account_key=p_receipt->>'accountKey' and ebay_item_id=p_receipt->>'itemId'
   and campaign_id=p_receipt->>'campaignId' and ad_id=coalesce(p_receipt->>'adId','')
   and report_id=p_receipt->>'reportId' and report_revision=p_receipt->>'reportRevision'
   and window_start=(p_receipt->>'windowStart')::timestamptz and window_end=(p_receipt->>'windowEnd')::timestamptz;
 if existing_id is distinct from p_receipt->>'receiptId' then raise exception 'ADS_REPORT_REVISION_CONFLICT'; end if;
 return existing_id;
end $$;
revoke all on function public.seller_os_record_ads_report_observation_v1(jsonb) from public,anon,authenticated;
grant execute on function public.seller_os_record_ads_report_observation_v1(jsonb) to service_role;

-- Read only; latest evidence per component prevents frequent price snapshots
-- from crowding out fees/costs. Existing evidence/outbox remain authoritative.
create or replace function public.seller_os_ads_activation_inputs_v1(p_account_key text, p_item_ids text[], p_actor_id uuid)
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
   'latestAdsReport',(select r.receipt from public.seller_os_ads_report_observations_v1 r
      where r.account_key=p_account_key and r.ebay_item_id=targets.item_id
      order by r.window_end desc,r.observed_at desc,r.receipt_id limit 1),
   'policyDraft',(select jsonb_build_object('id',o.id,'receivedAt',o.received_at,'policy',o.intent->'requestedChanges'->'policy')
      from public.seller_os_ipad_outbox_v1 o where o.account_key=p_account_key and o.item_id=targets.item_id
      and o.actor_user_id=p_actor_id and o.kind='ADS_POLICY' order by o.received_at desc,o.id limit 1)
 )) into result from unnest(p_item_ids) as targets(item_id);
 return coalesce(result,'[]'::jsonb);
end $$;
revoke all on function public.seller_os_ads_activation_inputs_v1(text,text[],uuid) from public,anon,authenticated;
grant execute on function public.seller_os_ads_activation_inputs_v1(text,text[],uuid) to service_role;
