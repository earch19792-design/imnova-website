-- Extend the existing Product Research plan authority so a proven LIVE listing
-- can request the same bounded research worker without borrowing a Same-Day run.
-- The operational learning ledger remains the durable request/receipt authority.

alter table public.marketplace_product_research_query_plans
  alter column run_id drop not null;

alter table public.marketplace_product_research_query_plans
  add column source_context text not null default 'SAME_DAY_RUN',
  add column subject_listing_id uuid null
    references public.ebay_active_listings(id) on delete restrict,
  add column subject_item_id text null,
  add column subject_supplier_variant_id text null,
  add column request_receipt_id uuid null
    references public.seller_os_operational_learning_ledger_v1(id)
    on delete restrict;

alter table public.marketplace_product_research_query_plans
  add constraint marketplace_product_research_query_plans_context_check check (
    (source_context = 'SAME_DAY_RUN'
      and run_id is not null
      and subject_listing_id is null
      and subject_item_id is null
      and subject_supplier_variant_id is null
      and request_receipt_id is null)
    or
    (source_context = 'LIVE_LISTING_REVALIDATION'
      and run_id is null
      and subject_listing_id is not null
      and subject_item_id ~ '^[0-9]{9,20}$'
      and char_length(subject_supplier_variant_id) between 1 and 160
      and request_receipt_id is not null)
  );

create index marketplace_product_research_query_plans_live_subject_idx
  on public.marketplace_product_research_query_plans(
    marketplace_account_key, marketplace, subject_item_id, created_at desc
  ) where source_context = 'LIVE_LISTING_REVALIDATION';

create or replace function public.create_live_listing_product_research_plan_v1(
  p_plan_id uuid,
  p_marketplace_account_key text,
  p_plan_version text,
  p_input_hash text,
  p_listing_id uuid,
  p_item_id text,
  p_supplier_variant_id text,
  p_request_receipt_id uuid,
  p_queries jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_query_count integer := jsonb_array_length(coalesce(p_queries, '[]'::jsonb));
  v_plan_id uuid;
begin
  if length(trim(p_marketplace_account_key)) < 8
    or p_input_hash !~ '^sha256:[0-9a-f]{64}$'
    or length(trim(p_plan_version)) < 8
    or p_item_id !~ '^[0-9]{9,20}$'
    or char_length(trim(p_supplier_variant_id)) not between 1 and 160
    or v_query_count < 1 or v_query_count > 15
    or not exists (
      select 1 from public.ebay_active_listings listing
      where listing.id = p_listing_id
        and listing.account_key = p_marketplace_account_key
        and listing.ebay_item_id = p_item_id
        and listing.supplier_variant_id = p_supplier_variant_id
        and listing.listing_status = 'active'
    )
    or not exists (
      select 1 from public.seller_os_operational_learning_ledger_v1 receipt
      where receipt.id = p_request_receipt_id
        and receipt.marketplace_account_key = p_marketplace_account_key
        and receipt.invariant_code = 'LIVE_LISTING_RESEARCH_REQUIRED'
        and receipt.status = 'OPEN'
    ) then
    raise exception 'LIVE_LISTING_PRODUCT_RESEARCH_PLAN_INPUT_INVALID';
  end if;

  insert into public.marketplace_product_research_query_plans(
    id, marketplace_account_key, marketplace, run_id, plan_version,
    input_hash, status, query_count, candidate_count, source_context,
    subject_listing_id, subject_item_id, subject_supplier_variant_id,
    request_receipt_id
  ) values (
    p_plan_id, p_marketplace_account_key, 'EBAY_US', null, p_plan_version,
    p_input_hash, 'ACTIVE', v_query_count, 1,
    'LIVE_LISTING_REVALIDATION', p_listing_id, p_item_id,
    p_supplier_variant_id, p_request_receipt_id
  )
  on conflict (marketplace_account_key, marketplace, input_hash) do update
    set updated_at = clock_timestamp()
  returning id into v_plan_id;

  insert into public.marketplace_product_research_query_tasks(
    plan_id, marketplace_account_key, marketplace, ordinal, search_query,
    query_hash, cluster_key_hash, category_id, candidate_count,
    candidate_variant_hashes
  )
  select v_plan_id, p_marketplace_account_key, 'EBAY_US', row.ordinal,
    row.search_query, row.query_hash, row.cluster_key_hash, row.category_id,
    row.candidate_count, row.candidate_variant_hashes
  from jsonb_to_recordset(p_queries) as row(
    ordinal integer,
    search_query text,
    query_hash text,
    cluster_key_hash text,
    category_id text,
    candidate_count integer,
    candidate_variant_hashes text[]
  )
  on conflict (plan_id, query_hash) do nothing;

  return v_plan_id;
end;
$$;

revoke all on function public.create_live_listing_product_research_plan_v1(
  uuid,text,text,text,uuid,text,text,uuid,jsonb
) from public, anon, authenticated;
grant execute on function public.create_live_listing_product_research_plan_v1(
  uuid,text,text,text,uuid,text,text,uuid,jsonb
) to service_role;

comment on function public.create_live_listing_product_research_plan_v1(
  uuid,text,text,text,uuid,text,text,uuid,jsonb
) is 'Atomically binds one proven LIVE listing to the existing bounded Product Research plan runtime. Performs zero marketplace writes.';

notify pgrst, 'reload schema';
