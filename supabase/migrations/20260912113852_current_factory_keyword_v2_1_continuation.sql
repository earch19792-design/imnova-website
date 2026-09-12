-- CURRENT Factory owns the transition into Keyword Intelligence V2.1. Keep
-- the existing plan/task/evidence authority, but bind it to the exact CURRENT
-- package and make a stale terminal plan safely re-enterable once per material
-- Product Truth generation.

alter table public.marketplace_product_research_query_plans
  add column if not exists current_listing_package_id uuid null
    references public.ebay_listing_packages(id) on delete restrict,
  add column if not exists current_keyword_truth_fingerprint text null,
  add column if not exists current_keyword_revalidation_key text null,
  add column if not exists current_keyword_revalidation_history jsonb
    not null default '[]'::jsonb;

alter table public.marketplace_product_research_query_plans
  add constraint marketplace_product_research_current_package_scope_v1_check
    check (current_listing_package_id is null
      or source_context = 'QUICK_PICK_RESEARCH_REQUIRED'),
  add constraint marketplace_product_research_current_truth_hash_v1_check
    check (current_keyword_truth_fingerprint is null
      or current_keyword_truth_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  add constraint marketplace_product_research_current_revalidation_key_v1_check
    check (current_keyword_revalidation_key is null
      or current_keyword_revalidation_key ~ '^sha256:[0-9a-f]{64}$'),
  add constraint marketplace_product_research_current_revalidation_history_v1_check
    check (jsonb_typeof(current_keyword_revalidation_history) = 'array');

create unique index if not exists
  marketplace_product_research_current_package_uidx
  on public.marketplace_product_research_query_plans(current_listing_package_id)
  where current_listing_package_id is not null;

create index if not exists marketplace_product_research_current_binding_idx
  on public.marketplace_product_research_query_plans(
    marketplace_account_key,current_listing_package_id,status)
  where current_listing_package_id is not null;

-- CURRENT intake keys are either the historical digest or the canonical
-- Luna/Portex identity key. Both forms are exact, bounded identities.
alter table public.marketplace_product_research_query_plans
  drop constraint marketplace_product_research_query_plans_context_check;
alter table public.marketplace_product_research_query_plans
  add constraint marketplace_product_research_query_plans_context_check check (
    (source_context = 'SAME_DAY_RUN' and run_id is not null
      and subject_listing_id is null and subject_item_id is null
      and subject_supplier_variant_id is null and request_receipt_id is null
      and source_candidate_key is null and source_luna_product_id is null
      and source_supplier_sku is null and source_opportunity_id is null)
    or
    (source_context = 'LIVE_LISTING_REVALIDATION' and run_id is null
      and subject_listing_id is not null and subject_item_id ~ '^[0-9]{9,20}$'
      and char_length(subject_supplier_variant_id) between 1 and 160
      and request_receipt_id is not null and source_candidate_key is null
      and source_luna_product_id is null and source_supplier_sku is null
      and source_opportunity_id is null)
    or
    (source_context = 'QUICK_PICK_RESEARCH_REQUIRED' and run_id is null
      and subject_listing_id is null and subject_item_id is null
      and request_receipt_id is null
      and (source_candidate_key ~ '^sha256:[0-9a-f]{64}$'
        or source_candidate_key ~ '^luna-portex:[0-9]{1,30}:[0-9]{1,30}$')
      and source_luna_product_id ~ '^[0-9]{1,30}$'
      and subject_supplier_variant_id ~ '^[0-9]{1,30}$'
      and char_length(source_supplier_sku) between 1 and 160
      and source_opportunity_id is not null));

create or replace function public.current_keyword_product_truth_semantics_v1(
  p_truth jsonb
) returns jsonb
language sql immutable parallel safe
set search_path=pg_catalog
as $$
  select jsonb_build_object(
    'contractVersion',p_truth->'contractVersion',
    'fields',coalesce(jsonb_agg(jsonb_build_object(
      'FIELD',f->'FIELD','VALUE',f->'VALUE',
      'SEMANTIC_CLASS',f->'SEMANTIC_CLASS',
      'EVIDENCE_STATUS',f->'EVIDENCE_STATUS',
      'CONTRADICTION',coalesce(f->'CONTRADICTION','false'::jsonb)
    ) order by f->>'FIELD',f->'VALUE'::text),'[]'::jsonb))
  from jsonb_array_elements(coalesce(p_truth->'fields','[]'::jsonb)) f;
$$;

create or replace function public.current_keyword_product_truth_fingerprint_v1(
  p_truth jsonb
) returns text
language sql immutable parallel safe
set search_path=pg_catalog,extensions
as $$
  select 'sha256:'||encode(digest(
    public.current_keyword_product_truth_semantics_v1(p_truth)::text,
    'sha256'),'hex');
$$;

-- Create/reuse, bind, and (only when needed) re-arm existing durable research.
-- Re-arming preserves the prior captures and a task manifest in the plan audit
-- receipt; it does not create a parallel plan or copy a historical decision.
create or replace function public.continue_current_factory_keyword_v2_1(
  p_account_key text,
  p_listing_package_id uuid,
  p_opportunity_id uuid,
  p_candidate_key text,
  p_requested_plan_id uuid,
  p_plan_version text,
  p_input_hash text,
  p_observed_at timestamptz,
  p_queries jsonb
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $$
declare
  v_package public.ebay_listing_packages%rowtype;
  v_queue public.ebay_luna_opportunity_queue%rowtype;
  v_plan public.marketplace_product_research_query_plans%rowtype;
  v_truth jsonb;
  v_truth_fingerprint text;
  v_revalidation_key text;
  v_variant_hash text;
  v_query_count integer:=jsonb_array_length(coalesce(p_queries,'[]'::jsonb));
  v_created boolean:=false;
  v_revalidated boolean:=false;
  v_added integer:=0;
  v_pending integer:=0;
  v_receipt jsonb;
  v_txid bigint:=txid_current();
  v_keyword_dirty boolean:=false;
begin
  if not public.is_seller_os_service_role_request_v1()
    or char_length(trim(coalesce(p_account_key,''))) not between 8 and 160
    or p_listing_package_id is null or p_opportunity_id is null
    or p_requested_plan_id is null or p_observed_at is null
    or p_observed_at > clock_timestamp()+interval '1 minute'
    or char_length(trim(coalesce(p_plan_version,'')))<8
    or coalesce(p_input_hash,'') !~ '^sha256:[0-9a-f]{64}$'
    or not (coalesce(p_candidate_key,'') ~ '^sha256:[0-9a-f]{64}$'
      or coalesce(p_candidate_key,'') ~ '^luna-portex:[0-9]{1,30}:[0-9]{1,30}$')
    or v_query_count not between 1 and 3 then
    raise exception 'CURRENT_KEYWORD_CONTINUATION_INPUT_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'current-keyword:'||p_account_key||':'||p_listing_package_id::text,0));
  create temporary table if not exists seller_os_product_research_coalesce_v1(
    transaction_id bigint not null,account_key text not null,
    candidate_key text not null,requested_plan_id uuid not null,
    resolved_plan_id uuid null,evidence_dirty boolean not null default false,
    keyword_dirty boolean not null default false,
    primary key(transaction_id,account_key,candidate_key)
  ) on commit delete rows;
  insert into pg_temp.seller_os_product_research_coalesce_v1(
    transaction_id,account_key,candidate_key,requested_plan_id)
  values(v_txid,p_account_key,p_candidate_key,p_requested_plan_id);

  select * into v_package from public.ebay_listing_packages p
  where p.id=p_listing_package_id and p.account_key=p_account_key
    and p.opportunity_id=p_opportunity_id and p.candidate_key=p_candidate_key
    and p.package_data#>>'{currentPublicationFactoryV1,version}'=
      'SELLER_OS_CURRENT_PUBLICATION_FACTORY_V1'
    and p.package_data#>>'{currentPublicationFactoryV1,packageId}'=p.id::text
    and p.package_data#>>'{currentPublicationFactoryV1,accountKey}'=p.account_key
    and p.package_data#>>'{currentPublicationFactoryV1,authorityPolicy}'='CURRENT_ONLY'
    and p.package_data#>>'{currentPublicationFactoryV1,reuseLegacyPreparation}'='false'
  for update;
  if not found then raise exception 'CURRENT_KEYWORD_PACKAGE_BINDING_INVALID'; end if;

  select * into v_queue from public.ebay_luna_opportunity_queue q
  where q.id=p_opportunity_id and q.candidate_key=p_candidate_key
    and q.supplier_product_id=v_package.package_data#>>'{currentPublicationFactoryV1,productId}'
    and q.supplier_variant_id=v_package.package_data#>>'{currentPublicationFactoryV1,variantId}'
    and q.supplier_sku=v_package.package_data#>>'{currentPublicationFactoryV1,supplierSku}'
  for update;
  if not found then raise exception 'CURRENT_KEYWORD_PRODUCT_TRUTH_BINDING_INVALID'; end if;
  v_truth:=v_queue.assessment#>'{productTruth,fieldTruthV1}';
  if v_truth is null
    or not exists(select 1 from jsonb_array_elements(v_truth->'fields') f
      where f->>'FIELD'='LUNA_PRODUCT_ID'
        and f->>'VALUE'=v_queue.supplier_product_id
        and f->>'SEMANTIC_CLASS'='FACT' and f->>'EVIDENCE_STATUS'='PROVEN')
    or not exists(select 1 from jsonb_array_elements(v_truth->'fields') f
      where f->>'FIELD'='LUNA_VARIANT_ID'
        and f->>'VALUE'=v_queue.supplier_variant_id
        and f->>'SEMANTIC_CLASS'='FACT' and f->>'EVIDENCE_STATUS'='PROVEN') then
    raise exception 'CURRENT_KEYWORD_PRODUCT_TRUTH_NOT_CURRENT';
  end if;

  v_variant_hash:='sha256:'||encode(digest(
    convert_to(v_queue.supplier_variant_id,'UTF8'),'sha256'),'hex');
  if exists(select 1 from jsonb_to_recordset(p_queries) q(
      ordinal integer,search_query text,query_hash text,cluster_key_hash text,
      category_id text,candidate_count integer,candidate_variant_hashes text[],
      query_intent text,evidence_basis jsonb,strategy_version text)
    where q.ordinal not between 1 and 3
      or char_length(trim(coalesce(q.search_query,''))) not between 3 and 100
      or q.query_hash !~ '^sha256:[0-9a-f]{64}$'
      or q.cluster_key_hash !~ '^sha256:[0-9a-f]{64}$'
      or q.candidate_count<>1
      or q.candidate_variant_hashes is distinct from array[v_variant_hash]
      or q.query_intent not in ('EXACT_PRODUCT_QUERY','CORE_FAMILY_QUERY',
        'SEMANTIC_EXPANSION_QUERY')
      or jsonb_typeof(coalesce(q.evidence_basis,'[]'::jsonb))<>'array'
      or char_length(trim(coalesce(q.strategy_version,'')))<8) then
    raise exception 'CURRENT_KEYWORD_QUERY_SCOPE_INVALID';
  end if;

  select * into v_plan from public.marketplace_product_research_query_plans p
  where p.marketplace_account_key=p_account_key and p.marketplace='EBAY_US'
    and p.source_context='QUICK_PICK_RESEARCH_REQUIRED'
    and p.source_opportunity_id=p_opportunity_id
    and p.source_candidate_key=p_candidate_key
    and p.source_luna_product_id=v_queue.supplier_product_id
    and p.subject_supplier_variant_id=v_queue.supplier_variant_id
  limit 1 for update;

  if not found then
    insert into public.marketplace_product_research_query_plans(
      id,marketplace_account_key,marketplace,run_id,plan_version,input_hash,
      status,query_count,candidate_count,source_context,subject_listing_id,
      subject_item_id,subject_supplier_variant_id,request_receipt_id,
      source_candidate_key,source_luna_product_id,source_supplier_sku,
      source_opportunity_id,research_intelligence_status,
      intelligence_contract_version,current_listing_package_id)
    values(p_requested_plan_id,p_account_key,'EBAY_US',null,p_plan_version,
      p_input_hash,'ACTIVE',v_query_count,1,'QUICK_PICK_RESEARCH_REQUIRED',
      null,null,v_queue.supplier_variant_id,null,p_candidate_key,
      v_queue.supplier_product_id,v_queue.supplier_sku,p_opportunity_id,
      'RESEARCH_IN_PROGRESS',p_plan_version,p_listing_package_id)
    returning * into v_plan;
    insert into public.marketplace_product_research_query_tasks(
      plan_id,marketplace_account_key,marketplace,ordinal,search_query,
      query_hash,cluster_key_hash,category_id,candidate_count,
      candidate_variant_hashes,query_intent,evidence_basis,strategy_version)
    select v_plan.id,p_account_key,'EBAY_US',q.ordinal,q.search_query,
      q.query_hash,q.cluster_key_hash,q.category_id,q.candidate_count,
      q.candidate_variant_hashes,q.query_intent,q.evidence_basis,q.strategy_version
    from jsonb_to_recordset(p_queries) q(
      ordinal integer,search_query text,query_hash text,cluster_key_hash text,
      category_id text,candidate_count integer,candidate_variant_hashes text[],
      query_intent text,evidence_basis jsonb,strategy_version text);
    v_created:=true; v_added:=v_query_count;
  elsif v_plan.current_listing_package_id is not null
      and v_plan.current_listing_package_id<>p_listing_package_id then
    raise exception 'CURRENT_KEYWORD_PLAN_ALREADY_BOUND';
  end if;
  update pg_temp.seller_os_product_research_coalesce_v1 set
    resolved_plan_id=v_plan.id
  where transaction_id=v_txid and account_key=p_account_key
    and candidate_key=p_candidate_key;
  if not found then raise exception 'CURRENT_KEYWORD_COALESCE_CONTEXT_LOST'; end if;

  v_truth_fingerprint:=public.current_keyword_product_truth_fingerprint_v1(v_truth);
  v_revalidation_key:='sha256:'||encode(digest(convert_to(
    'CURRENT_FACTORY_KEYWORD_REVALIDATION_V1:'||p_listing_package_id::text||':'||
      v_truth_fingerprint,'UTF8'),'sha256'),'hex');

  select count(*) into v_pending
  from public.marketplace_product_research_query_tasks t
  where t.plan_id=v_plan.id and t.status='PENDING';

  if not v_created and v_pending=0
      and v_plan.current_keyword_revalidation_key is distinct from
        v_revalidation_key then
    v_receipt:=jsonb_build_object(
      'contractVersion','CURRENT_FACTORY_KEYWORD_REVALIDATION_V1',
      'revalidationKey',v_revalidation_key,'observedAt',p_observed_at,
      'priorDecisionFingerprint',v_plan.keyword_intelligence_decision->'INPUT_FINGERPRINT',
      'priorTruthFingerprint',v_plan.current_keyword_truth_fingerprint,
      'taskManifest',(select coalesce(jsonb_agg(jsonb_build_object(
        'taskId',t.id,'status',t.status,'queryHash',t.query_hash,
        'captureBatchId',t.capture_batch_id) order by t.ordinal),'[]'::jsonb)
        from public.marketplace_product_research_query_tasks t where t.plan_id=v_plan.id),
      'marketplaceWrites',0);
    update public.marketplace_product_research_query_tasks t set
      status='PENDING',capture_batch_id=null,captured_at=null,processed_at=null,
      last_error_code=null,updated_at=p_observed_at
    where t.plan_id=v_plan.id;
    update public.marketplace_product_research_query_plans p set
      status='ACTIVE',completed_at=null,
      research_intelligence_status='RESEARCH_IN_PROGRESS',
      terminal_research_conclusion=null,worker_lease_owner=null,
      worker_lease_expires_at=null,worker_next_retry_at=p_observed_at,
      worker_last_release_code=null,
      worker_last_result=jsonb_build_object(
        'state','CURRENT_KEYWORD_REVALIDATION_QUEUED',
        'revalidationKey',v_revalidation_key,'marketplaceWrites',0),
      current_keyword_revalidation_history=
        p.current_keyword_revalidation_history||jsonb_build_array(v_receipt),
      updated_at=greatest(p.updated_at,p_observed_at)
    where p.id=v_plan.id;
    v_revalidated:=true;
  end if;

  update public.marketplace_product_research_query_plans p set
    current_listing_package_id=p_listing_package_id,
    current_keyword_truth_fingerprint=v_truth_fingerprint,
    current_keyword_revalidation_key=v_revalidation_key,
    plan_version=p_plan_version,intelligence_contract_version=p_plan_version,
    updated_at=greatest(p.updated_at,p_observed_at)
  where p.id=v_plan.id and (p.current_listing_package_id is distinct from p_listing_package_id
    or p.current_keyword_truth_fingerprint is distinct from v_truth_fingerprint
    or p.current_keyword_revalidation_key is distinct from v_revalidation_key
    or p.plan_version is distinct from p_plan_version
    or p.intelligence_contract_version is distinct from p_plan_version);

  update public.ebay_luna_opportunity_queue q set assessment=q.assessment||
    jsonb_build_object('currentFactoryKeywordContinuationV2_1',jsonb_build_object(
      'contractVersion','CURRENT_FACTORY_KEYWORD_CONTINUATION_V2_1',
      'listingPackageId',p_listing_package_id,'planId',v_plan.id,
      'truthFingerprint',v_truth_fingerprint,'observedAt',p_observed_at,
      'planCreated',v_created,'researchRevalidated',v_revalidated,
      'marketplaceWrites',0,'publicationWrites',0,'adsWrites',0)),
    updated_at=greatest(q.updated_at,p_observed_at)
  where q.id=v_queue.id;

  select keyword_dirty into v_keyword_dirty
  from pg_temp.seller_os_product_research_coalesce_v1
  where transaction_id=v_txid and account_key=p_account_key
    and candidate_key=p_candidate_key and resolved_plan_id=v_plan.id;
  delete from pg_temp.seller_os_product_research_coalesce_v1
  where transaction_id=v_txid and account_key=p_account_key
    and candidate_key=p_candidate_key and resolved_plan_id=v_plan.id;
  if not found then raise exception 'CURRENT_KEYWORD_COALESCE_CONTEXT_LOST'; end if;
  if v_keyword_dirty then
    perform public.refresh_product_research_keyword_intelligence_v1(v_plan.id);
  end if;

  return jsonb_build_object(
    'contractVersion','CURRENT_FACTORY_KEYWORD_CONTINUATION_V2_1',
    'listingPackageId',p_listing_package_id,'planId',v_plan.id,
    'planCreated',v_created,'researchRevalidated',v_revalidated,
    'addedQueryCount',v_added,'truthFingerprint',v_truth_fingerprint,
    'researchState',case when v_created or v_revalidated or v_pending>0
      then 'CLAIMABLE' else 'CURRENT_REUSED' end,
    'marketplaceWrites',0,'publicationWrites',0,'adsWrites',0,
    'ownerActionRequired',false);
end;
$$;

-- Package-bound reader: legacy or merely identity-matching plans cannot
-- satisfy CURRENT. The underlying handoff remains the sole decision reader.
create or replace function public.read_current_factory_keyword_handoff_v2_1(
  p_account_key text,p_listing_package_id uuid,p_product_id text,
  p_variant_id text,p_candidate_key text,p_opportunity_id uuid,
  p_plan_id uuid default null
) returns jsonb
language plpgsql stable security definer
set search_path=pg_catalog,public
as $$
declare
  v_plan_id uuid;
  v_stored_truth_fingerprint text;
  v_current_truth_fingerprint text;
  v_result jsonb;
  v_decision jsonb;
  v_validation_blockers jsonb;
begin
  if not public.is_seller_os_service_role_request_v1() then
    raise exception 'CURRENT_KEYWORD_READER_SERVICE_ROLE_REQUIRED';
  end if;
  select p.id,p.current_keyword_truth_fingerprint,
    public.current_keyword_product_truth_fingerprint_v1(
      q.assessment#>'{productTruth,fieldTruthV1}')
  into v_plan_id,v_stored_truth_fingerprint,v_current_truth_fingerprint
  from public.marketplace_product_research_query_plans p
  join public.ebay_current_listing_packages_v1 k
    on k.id=p.current_listing_package_id and k.account_key=p.marketplace_account_key
  join public.ebay_luna_opportunity_queue q on q.id=p.source_opportunity_id
  where p.marketplace_account_key=p_account_key
    and p.current_listing_package_id=p_listing_package_id
    and p.source_opportunity_id=p_opportunity_id
    and p.source_luna_product_id=p_product_id
    and p.subject_supplier_variant_id=p_variant_id
    and p.source_candidate_key=p_candidate_key
    and (p_plan_id is null or p.id=p_plan_id)
    and k.opportunity_id=p_opportunity_id and k.candidate_key=p_candidate_key
  limit 1;
  if v_plan_id is null then return jsonb_build_object(
    'READ_CONTRACT_VERSION','PRODUCT_RESEARCH_KEYWORD_HANDOFF_READ_V1',
    'STATUS','UNAVAILABLE','BLOCKERS',jsonb_build_array(
      'CURRENT_KEYWORD_PACKAGE_BINDING_NOT_FOUND'));
  end if;
  v_result:=public.read_product_research_keyword_handoff_v1(
    p_account_key,p_product_id,p_variant_id,p_candidate_key,p_opportunity_id,v_plan_id);
  -- Older V2.1 decisions fingerprinted transport/provenance metadata embedded
  -- in Product Truth. If the semantic truth and all evidence remain current,
  -- tolerate only those two legacy fingerprint mismatches. No blocker about
  -- research state, evidence, identity, expiry, or decision content is waived.
  v_decision:=(v_result->>'DECISION_SERIALIZED')::jsonb;
  v_validation_blockers:=coalesce(v_result->'VALIDATION_BLOCKERS','[]'::jsonb);
  if v_decision->>'KEYWORD_DECISION_READY'='true'
    and v_decision->'BLOCKERS'='[]'::jsonb
    and v_stored_truth_fingerprint=v_current_truth_fingerprint
    and not exists(select 1 from jsonb_array_elements_text(v_validation_blockers) b
      where b not in ('KEYWORD_DECISION_STALE_INPUT_FINGERPRINT',
        'KEYWORD_DECISION_FINGERPRINT_INVALID')) then
    v_result:=jsonb_set(v_result,'{STATUS}','"READY"'::jsonb,true);
    v_result:=jsonb_set(v_result,'{VALIDATION_BLOCKERS}','[]'::jsonb,true);
    v_result:=jsonb_set(v_result,'{BLOCKERS}','[]'::jsonb,true);
    v_result:=jsonb_set(v_result,'{VALIDATION,CURRENT_INPUTS_MATCH}',
      'true'::jsonb,true);
  end if;
  return jsonb_set(v_result,'{BINDING}',coalesce(v_result->'BINDING','{}'::jsonb)||
    jsonb_build_object('PACKAGE_ID',p_listing_package_id),true);
end;
$$;

-- Product Truth refreshes often rotate evidence receipts while preserving the
-- same facts. Such non-material changes must not supersede a CURRENT semantic
-- decision. Material field/value/classification changes still refresh every
-- bound plan through the original path.
create or replace function public.product_research_keyword_intelligence_trigger_v1()
returns trigger
language plpgsql security invoker
set search_path=pg_catalog,public
as $$
declare p record;
begin
  if tg_table_name='marketplace_product_research_query_plans' then
    if to_regclass('pg_temp.seller_os_product_research_coalesce_v1') is not null then
      update pg_temp.seller_os_product_research_coalesce_v1 context
      set keyword_dirty=true
      where context.transaction_id=txid_current()
        and context.account_key=new.marketplace_account_key
        and (context.resolved_plan_id=new.id or
          (context.resolved_plan_id is null and
            (context.requested_plan_id=new.id
              or context.candidate_key=new.source_candidate_key)));
      if found then return new; end if;
    end if;
    if new.source_opportunity_id is not null then
      perform public.refresh_product_research_keyword_intelligence_v1(new.id);
    end if;
  elsif tg_table_name='ebay_luna_opportunity_queue' then
    if tg_op='UPDATE' and
      public.current_keyword_product_truth_semantics_v1(
        new.assessment#>'{productTruth,fieldTruthV1}') is not distinct from
      public.current_keyword_product_truth_semantics_v1(
        old.assessment#>'{productTruth,fieldTruthV1}') then
      return new;
    end if;
    for p in select id from public.marketplace_product_research_query_plans
      where source_opportunity_id=new.id order by id
    loop
      perform public.refresh_product_research_keyword_intelligence_v1(p.id);
    end loop;
  elsif tg_table_name='marketplace_product_research_query_tasks' then
    if to_regclass('pg_temp.seller_os_product_research_coalesce_v1') is not null then
      update pg_temp.seller_os_product_research_coalesce_v1 context
      set keyword_dirty=true
      from public.marketplace_product_research_query_plans plan
      where plan.id=new.plan_id and context.transaction_id=txid_current()
        and context.account_key=new.marketplace_account_key
        and (context.resolved_plan_id=new.plan_id or
          (context.resolved_plan_id is null and
            (context.requested_plan_id=new.plan_id
              or context.candidate_key=plan.source_candidate_key)));
      if found then return new; end if;
    end if;
    perform public.refresh_product_research_keyword_intelligence_v1(new.plan_id);
  else
    for p in select distinct plan_id
      from public.marketplace_product_research_query_tasks
      where capture_batch_id=new.capture_batch_id order by plan_id
    loop
      if to_regclass('pg_temp.seller_os_product_research_coalesce_v1') is not null then
        update pg_temp.seller_os_product_research_coalesce_v1 context
        set keyword_dirty=true
        where context.transaction_id=txid_current()
          and context.resolved_plan_id=p.plan_id;
        if found then continue; end if;
      end if;
      update public.marketplace_product_research_query_plans
      set keyword_intelligence_decision=jsonb_build_object(
        'DECISION_VERSION','PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V2_1',
        'KEYWORD_INTELLIGENCE','UNPROVEN','KEYWORD_DECISION_READY',false,
        'PRIMARY_KEYWORD','UNPROVEN','TERMS','[]'::jsonb,
        'BLOCKERS',jsonb_build_array(
          'RESEARCH_EVIDENCE_CHANGED_RECOMPUTE_REQUIRED'))
      where id=p.plan_id
        and keyword_intelligence_decision->>'KEYWORD_DECISION_READY'='true';
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function public.current_keyword_product_truth_semantics_v1(jsonb),
  public.current_keyword_product_truth_fingerprint_v1(jsonb),
  public.continue_current_factory_keyword_v2_1(
    text,uuid,uuid,text,uuid,text,text,timestamptz,jsonb),
  public.read_current_factory_keyword_handoff_v2_1(
    text,uuid,text,text,text,uuid,uuid),
  public.product_research_keyword_intelligence_trigger_v1()
  from public,anon,authenticated;
grant execute on function public.current_keyword_product_truth_semantics_v1(jsonb),
  public.current_keyword_product_truth_fingerprint_v1(jsonb),
  public.continue_current_factory_keyword_v2_1(
    text,uuid,uuid,text,uuid,text,text,timestamptz,jsonb),
  public.read_current_factory_keyword_handoff_v2_1(
    text,uuid,text,text,text,uuid,uuid),
  public.product_research_keyword_intelligence_trigger_v1()
  to service_role;

comment on function public.continue_current_factory_keyword_v2_1(
  text,uuid,uuid,text,uuid,text,text,timestamptz,jsonb)
is 'Normal idempotent CURRENT Factory to Keyword Intelligence V2.1 plan continuation. It binds one exact CURRENT package, re-arms stale research once per semantic truth generation, and performs zero marketplace/publication/ads writes.';

notify pgrst,'reload schema';
