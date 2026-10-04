-- Workflow context only. The product case and draft stay in the existing
-- opportunity queue and listing workspace. Service routes enforce OWNER scope.
create table public.seller_os_fast_listing_contexts_v1 (
  account_key text not null check (account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'),
  opportunity_id uuid not null references public.ebay_luna_opportunity_queue(id) on delete restrict,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  preferences jsonb not null default '{}' check (jsonb_typeof(preferences)='object' and octet_length(preferences::text)<=262144),
  projection jsonb not null default '{}' check (jsonb_typeof(projection)='object' and octet_length(projection::text)<=1048576),
  revision bigint not null default 0,
  pending_action text check (pending_action in ('EVALUATE','PREPARE','SHIPPING')),
  operation_key text,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(account_key,opportunity_id)
);
create index fast_listing_recovery_v1 on public.seller_os_fast_listing_contexts_v1(next_attempt_at,lease_expires_at)
  where pending_action is not null and attempt_count<3;
alter table public.seller_os_fast_listing_contexts_v1 enable row level security;
revoke all on public.seller_os_fast_listing_contexts_v1 from public,anon,authenticated;
grant select,insert,update on public.seller_os_fast_listing_contexts_v1 to service_role;
create policy fast_listing_service_v1 on public.seller_os_fast_listing_contexts_v1 for all to service_role using(true) with check(true);

create function public.ensure_seller_os_fast_listing_v1(p_account_key text,p_owner_user_id uuid,p_snapshot_id uuid,p_product_id text,p_variant_id text,p_sku text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_source public.luna_catalog_snapshot_variants_v1; v_case public.ebay_luna_opportunity_queue;
  v_key text; v_context public.seller_os_fast_listing_contexts_v1;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_account_key||':'||p_product_id||':'||p_variant_id||':'||p_sku,0));
  select * into strict v_source from public.luna_catalog_snapshot_variants_v1 where snapshot_id=p_snapshot_id
    and product_id=p_product_id and variant_id=p_variant_id and sku=p_sku;
  if not exists(select 1 from public.luna_catalog_snapshots_v1 where snapshot_id=p_snapshot_id and snapshot_status='COMPLETE') then
    raise exception 'FAST_LISTING_COMPLETE_SOURCE_REQUIRED'; end if;
  v_key:=public.seller_os_current_commercial_candidate_id_v1(p_account_key,'EBAY_US','LUNA_PORTEX',p_product_id,p_variant_id,p_sku);
  select * into v_case from public.ebay_luna_opportunity_queue where supplier_product_id=p_product_id and supplier_variant_id=p_variant_id
    and supplier_sku=p_sku order by (candidate_key=v_key) desc,created_at,id limit 1;
  if v_case.id is null then
    insert into public.ebay_luna_opportunity_queue(candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,product_title,
      queue_status,decision,supplier_price,supplier_available,supplier_snapshot_at,assessment)
    values(v_key,p_product_id,p_variant_id,p_sku,v_source.title,'review','FAST_LISTING_RESEARCH_DRAFT',v_source.price,v_source.availability,v_source.observed_at,
      jsonb_build_object('productTruth',jsonb_build_object('lunaProductId',p_product_id,'lunaVariantId',p_variant_id,'supplierSku',p_sku,'title',v_source.title,
      'sourceUrl',v_source.canonical_url,'fieldTruthV1',v_source.field_truth_v1),'fastListingV1',jsonb_build_object('contractVersion','SELLER_OS_FAST_LISTING_V1',
      'sourceSnapshotId',p_snapshot_id,'marketplaceWrites',0,'publicationAuthorized',false)))
    on conflict(candidate_key) do nothing;
    select * into strict v_case from public.ebay_luna_opportunity_queue where candidate_key=v_key;
  end if;
  insert into public.seller_os_fast_listing_contexts_v1(account_key,opportunity_id,owner_user_id)
    values(p_account_key,v_case.id,p_owner_user_id) on conflict do nothing;
  select * into strict v_context from public.seller_os_fast_listing_contexts_v1 where account_key=p_account_key and opportunity_id=v_case.id;
  if v_context.owner_user_id<>p_owner_user_id then raise exception 'FAST_LISTING_OWNER_CONFLICT'; end if;
  return jsonb_build_object('context',to_jsonb(v_context),'opportunity',to_jsonb(v_case));
end $$;

-- Each write appends to the existing canonical opportunity event history.
create function public.write_seller_os_fast_listing_v1(p_account_key text,p_owner_user_id uuid,p_opportunity_id uuid,p_revision bigint,
  p_event_key text,p_event_type text,p_patch jsonb,p_projection jsonb,p_lease_token uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_context public.seller_os_fast_listing_contexts_v1;
begin
  select * into strict v_context from public.seller_os_fast_listing_contexts_v1 where account_key=p_account_key
    and opportunity_id=p_opportunity_id and owner_user_id=p_owner_user_id for update;
  if exists(select 1 from public.ebay_luna_opportunity_queue_events where idempotency_key=p_event_key and opportunity_id=p_opportunity_id) then
    return to_jsonb(v_context); end if;
  if v_context.revision<>p_revision then raise exception 'FAST_LISTING_REVISION_CONFLICT'; end if;
  if (v_context.lease_token is not null and v_context.lease_expires_at>clock_timestamp() and v_context.lease_token is distinct from p_lease_token)
    or (p_lease_token is not null and (v_context.lease_token is distinct from p_lease_token or v_context.lease_expires_at<=clock_timestamp())) then
    raise exception 'FAST_LISTING_OPERATION_LEASE_CONFLICT'; end if;
  insert into public.ebay_luna_opportunity_queue_events(opportunity_id,event_type,old_value,new_value,idempotency_key)
    values(p_opportunity_id,'status_changed',jsonb_build_object('revision',v_context.revision,'projection',v_context.projection),
      jsonb_build_object('contractVersion','SELLER_OS_FAST_LISTING_V1','event',p_event_type,'actorId',p_owner_user_id,
        'accountKey',p_account_key,'patch',p_patch,'projection',p_projection,'marketplaceWrites',0),p_event_key);
  -- Reuse the operational learning ledger. Each distinct observation is a new
  -- immutable historical source event; no past correction/forecast is rewritten.
  if p_projection->>'learningEvidenceDigest' ~ '^sha256:[0-9a-f]{64}$' then
    insert into public.seller_os_operational_learning_ledger_v1(marketplace_account_key,failure_class,invariant_code,mechanism_version,
      evidence_fingerprint,recovery_policy_version,retry_safety,recovery_class,recovery_outcome,regression_guard,evidence,status,
      first_observed_at,last_observed_at,resolved_at)
    values(p_account_key,'FAST_LISTING_DECISION_OR_RESULT','FAST_LISTING_PRODUCT_CASE_LEARNING','SELLER_OS_FAST_LISTING_V1',
      p_projection->>'learningEvidenceDigest','SELLER_OS_FAST_LISTING_RECOVERY_V1','NOT_APPLICABLE','OBSERVATION_ONLY','OBSERVED',
      jsonb_build_object('sourceEventKey',p_event_key,'marketplaceWrites',0),jsonb_build_object('opportunityId',p_opportunity_id,
        'event',p_event_type,'patch',p_patch,'projection',p_projection),'RESOLVED',clock_timestamp(),clock_timestamp(),clock_timestamp())
    on conflict(marketplace_account_key,invariant_code,evidence_fingerprint,mechanism_version) do nothing;
  end if;
  update public.seller_os_fast_listing_contexts_v1 set preferences=preferences||p_patch,projection=coalesce(p_projection,projection),
    revision=revision+1,updated_at=clock_timestamp(),pending_action=null,lease_token=null,lease_expires_at=null,last_error=null
    where account_key=p_account_key and opportunity_id=p_opportunity_id returning * into v_context;
  return to_jsonb(v_context);
end $$;

create function public.claim_seller_os_fast_listing_v1(p_account_key text,p_owner_user_id uuid,p_opportunity_id uuid,p_action text,p_operation_key text,p_token uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_context public.seller_os_fast_listing_contexts_v1;
begin
  if p_action not in ('EVALUATE','PREPARE','SHIPPING') then raise exception 'FAST_LISTING_ACTION_INVALID'; end if;
  select * into strict v_context from public.seller_os_fast_listing_contexts_v1 where account_key=p_account_key and opportunity_id=p_opportunity_id
    and owner_user_id=p_owner_user_id for update;
  if exists(select 1 from public.ebay_luna_opportunity_queue_events where opportunity_id=p_opportunity_id and idempotency_key=p_operation_key) then
    return jsonb_build_object('claimed',false,'completed',true,'context',to_jsonb(v_context)); end if;
  if v_context.lease_expires_at>clock_timestamp() then return jsonb_build_object('claimed',false,'context',to_jsonb(v_context)); end if;
  if v_context.operation_key is distinct from p_operation_key and v_context.pending_action is not null then
    return jsonb_build_object('claimed',false,'context',to_jsonb(v_context)); end if;
  if v_context.operation_key=p_operation_key and v_context.attempt_count>=3 then raise exception 'FAST_LISTING_RETRY_EXHAUSTED'; end if;
  update public.seller_os_fast_listing_contexts_v1 set pending_action=p_action,operation_key=p_operation_key,
    lease_token=p_token,lease_expires_at=clock_timestamp()+interval '4 minutes',
    attempt_count=case when operation_key=p_operation_key then attempt_count+1 else 1 end,updated_at=clock_timestamp()
    where account_key=p_account_key and opportunity_id=p_opportunity_id returning * into v_context;
  return jsonb_build_object('claimed',true,'context',to_jsonb(v_context));
end $$;

create function public.reject_fast_listing_event_mutation_v1() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.new_value->>'contractVersion'='SELLER_OS_FAST_LISTING_V1' then raise exception 'FAST_LISTING_HISTORY_IMMUTABLE'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger fast_listing_history_immutable_v1 before update or delete on public.ebay_luna_opportunity_queue_events
  for each row execute function public.reject_fast_listing_event_mutation_v1();
revoke all on function public.ensure_seller_os_fast_listing_v1(text,uuid,uuid,text,text,text),
  public.write_seller_os_fast_listing_v1(text,uuid,uuid,bigint,text,text,jsonb,jsonb,uuid),
  public.claim_seller_os_fast_listing_v1(text,uuid,uuid,text,text,uuid),public.reject_fast_listing_event_mutation_v1() from public,anon,authenticated;
grant execute on function public.ensure_seller_os_fast_listing_v1(text,uuid,uuid,text,text,text),
  public.write_seller_os_fast_listing_v1(text,uuid,uuid,bigint,text,text,jsonb,jsonb,uuid),
  public.claim_seller_os_fast_listing_v1(text,uuid,uuid,text,text,uuid),public.reject_fast_listing_event_mutation_v1() to service_role;
