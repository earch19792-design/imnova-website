-- Align OWNER manual decisions with the existing linkage receipt validators.
-- Keep the OWNER selection in evidence references and actor fields. The Luna
-- identity itself comes from the exact current server-side catalog read.
do $migration$
declare
  v_function text;
  v_old text;
  v_new text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.confirm_seller_os_listing_manual_identity_v1(text,text,uuid,text,text,text,timestamptz,text,text,integer,numeric,text,uuid)'::pg_catalog.regprocedure)
    into v_function;
  v_old := $old$'quantityBasis','OWNER_SELECTED_EXACT_IDENTITY'$old$;
  v_new := $new$'quantityBasis','STRUCTURED_EVIDENCE'$new$;
  if pg_catalog.length(v_function)-pg_catalog.length(
      pg_catalog.replace(v_function,v_old,'')) <> pg_catalog.length(v_old) then
    raise exception 'MANUAL_IDENTITY_COMPONENT_SHAPE_ANCHOR_MISMATCH';
  end if;
  v_function := pg_catalog.replace(v_function,v_old,v_new);
  v_old := $old$'OWNER_SELECTED_CURRENT_LUNA_IDENTITY'$old$;
  v_new := $new$'CANONICAL_SERVER_READ_IDENTITY_ONLY'$new$;
  if pg_catalog.length(v_function)-pg_catalog.length(
      pg_catalog.replace(v_function,v_old,'')) <> pg_catalog.length(v_old) then
    raise exception 'MANUAL_IDENTITY_PROVENANCE_ANCHOR_MISMATCH';
  end if;
  v_function := pg_catalog.replace(v_function,v_old,v_new);
  v_old := $old$'identityEvidenceProvenance',v_provenance,
      'customLabelUsedAsIdentity',false)$old$;
  v_new := $new$'identityEvidenceProvenance',v_provenance)$new$;
  if pg_catalog.length(v_function)-pg_catalog.length(
      pg_catalog.replace(v_function,v_old,'')) <> pg_catalog.length(v_old) then
    raise exception 'MANUAL_IDENTITY_DECISION_SHAPE_ANCHOR_MISMATCH';
  end if;
  execute pg_catalog.replace(v_function,v_old,v_new);

  select pg_catalog.pg_get_functiondef(
    'public.transition_seller_os_listing_product_link_authority_v1(text,text,text,text,text,text,text,text)'::pg_catalog.regprocedure)
    into v_function;
  v_old := $old$'OWNER_SELECTED_CURRENT_LUNA_IDENTITY'$old$;
  v_new := $new$'CANONICAL_SERVER_READ_IDENTITY_ONLY'$new$;
  if pg_catalog.length(v_function)-pg_catalog.length(
      pg_catalog.replace(v_function,v_old,'')) <> pg_catalog.length(v_old) then
    raise exception 'MANUAL_IDENTITY_AUTHORITY_PROVENANCE_ANCHOR_MISMATCH';
  end if;
  v_function := pg_catalog.replace(v_function,v_old,v_new);
  v_old := $old$v_decision.provenance->>'customLabelUsedAsIdentity' = 'false'$old$;
  v_new := $new$v_decision.evidence_references @>
      array['OWNER_SELECTED_LUNA_IDENTITY']::text[]
    and v_decision.current_cohort_id like 'owner-listings:%'$new$;
  if pg_catalog.length(v_function)-pg_catalog.length(
      pg_catalog.replace(v_function,v_old,'')) <> pg_catalog.length(v_old) then
    raise exception 'MANUAL_IDENTITY_AUTHORITY_OWNER_ANCHOR_MISMATCH';
  end if;
  execute pg_catalog.replace(v_function,v_old,v_new);
end;
$migration$;

create table public.seller_os_listing_manual_identity_request_traces_v1 (
  request_trace_id uuid primary key,
  link_receipt_id text not null unique references
    public.seller_os_luna_linkage_decisions(decision_id),
  account_key text not null check (char_length(account_key) between 3 and 200),
  marketplace_id text not null check (marketplace_id = 'EBAY_US'),
  ebay_item_id text not null check (ebay_item_id ~ '^[0-9]{9,20}$'),
  supplier_sku text not null check (char_length(supplier_sku) between 1 and 120),
  product_id text not null check (product_id ~ '^[0-9]{1,30}$'),
  variant_id text not null check (variant_id ~ '^[0-9]{1,30}$'),
  actor_user_id uuid not null references auth.users(id),
  confirmed_at timestamptz not null default pg_catalog.clock_timestamp()
);
create index seller_os_manual_identity_trace_item_idx
  on public.seller_os_listing_manual_identity_request_traces_v1
  (account_key, marketplace_id, ebay_item_id, confirmed_at desc);
alter table public.seller_os_listing_manual_identity_request_traces_v1
  enable row level security;
alter table public.seller_os_listing_manual_identity_request_traces_v1
  force row level security;
revoke all on public.seller_os_listing_manual_identity_request_traces_v1
  from public, anon, authenticated, service_role;
grant select, insert on public.seller_os_listing_manual_identity_request_traces_v1
  to service_role;
create policy seller_os_manual_identity_trace_service_role
  on public.seller_os_listing_manual_identity_request_traces_v1
  for all to service_role using (true) with check (true);

create function public.confirm_seller_os_listing_manual_identity_traced_v1(
  p_request_trace_id uuid,
  p_account_key text,
  p_ebay_item_id text,
  p_opportunity_id uuid,
  p_luna_product_id text,
  p_luna_variant_id text,
  p_luna_sku text,
  p_official_observed_at timestamptz,
  p_official_title text,
  p_official_custom_label text,
  p_official_quantity integer,
  p_official_price numeric,
  p_official_currency text,
  p_actor_user_id uuid
) returns jsonb language plpgsql security definer
set search_path = '' as $function$
declare
  v_result jsonb;
  v_receipt_id text;
  v_count integer;
begin
  if not public.is_seller_os_service_role_request_v1()
    or p_request_trace_id is null then
    raise exception 'LISTING_OWNER_REQUEST_TRACE_REQUIRED';
  end if;
  v_result := public.confirm_seller_os_listing_manual_identity_v1(
    p_account_key,p_ebay_item_id,p_opportunity_id,p_luna_product_id,
    p_luna_variant_id,p_luna_sku,p_official_observed_at,p_official_title,
    p_official_custom_label,p_official_quantity,p_official_price,
    p_official_currency,p_actor_user_id);
  v_receipt_id := v_result->>'decisionId';
  if v_result->>'status' <> 'PROVEN' or v_receipt_id is null then
    raise exception 'LISTING_OWNER_DURABLE_RECEIPT_UNPROVEN';
  end if;
  insert into public.seller_os_listing_manual_identity_request_traces_v1 (
    request_trace_id,link_receipt_id,account_key,marketplace_id,
    ebay_item_id,supplier_sku,product_id,variant_id,actor_user_id)
  select p_request_trace_id,d.decision_id,d.account_key,d.marketplace_id,
    d.ebay_item_id,d.luna_sku,d.luna_product_id,d.luna_variant_id,
    d.actor_user_id
  from public.seller_os_luna_linkage_decisions d
  where d.decision_id=v_receipt_id and d.account_key=p_account_key
    and d.ebay_item_id=p_ebay_item_id and d.luna_sku=p_luna_sku
    and d.luna_product_id=p_luna_product_id
    and d.luna_variant_id=p_luna_variant_id
    and d.actor_user_id=p_actor_user_id;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'LISTING_OWNER_TRACE_RECEIPT_WRITE_FAILED';
  end if;
  return v_result || pg_catalog.jsonb_build_object(
    'requestTraceId',p_request_trace_id::text,
    'linkReceiptId',v_receipt_id);
end;
$function$;
revoke all on function public.confirm_seller_os_listing_manual_identity_traced_v1(
  uuid,text,text,uuid,text,text,text,timestamptz,text,text,integer,numeric,text,uuid)
  from public,anon,authenticated;
grant execute on function public.confirm_seller_os_listing_manual_identity_traced_v1(
  uuid,text,text,uuid,text,text,text,timestamptz,text,text,integer,numeric,text,uuid)
  to service_role;
