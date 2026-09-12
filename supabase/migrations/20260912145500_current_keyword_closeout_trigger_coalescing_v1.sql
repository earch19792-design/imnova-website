-- The closeout already owns a complete V2.1 decision. Suppress the plan's
-- refresh trigger only for that exact transaction/plan, persist the decision,
-- and clear the coalesced dirty bit so no equivalent second derivation runs.

create or replace function public.reconcile_current_factory_keyword_cumulative_completion_v1(
  p_account_key text,p_listing_package_id uuid,p_plan_id uuid
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare
  v_plan public.marketplace_product_research_query_plans%rowtype;
  v_decision jsonb;
  v_reconciled boolean:=false;
  v_context_existed boolean:=false;
  v_txid bigint:=txid_current();
begin
  if not public.is_seller_os_service_role_request_v1() then
    raise exception 'CURRENT_KEYWORD_CUMULATIVE_RECONCILE_SERVICE_ROLE_REQUIRED';
  end if;
  select p.* into v_plan
  from public.marketplace_product_research_query_plans p
  join public.ebay_current_listing_packages_v1 k
    on k.id=p.current_listing_package_id
    and k.account_key=p.marketplace_account_key
  where p.id=p_plan_id and p.marketplace_account_key=p_account_key
    and p.current_listing_package_id=p_listing_package_id
  for update of p;
  if not found then raise exception 'CURRENT_KEYWORD_CUMULATIVE_BINDING_INVALID'; end if;
  if not exists(select 1 from public.marketplace_product_research_query_tasks t
      where t.plan_id=v_plan.id and t.status='PENDING')
      and (v_plan.worker_lease_expires_at is null
        or v_plan.worker_lease_expires_at<=clock_timestamp()) then
    v_decision:=public.derive_current_plan_keyword_candidate_v2_1(v_plan.id);
    if v_decision->>'KEYWORD_DECISION_READY'='true'
        and v_decision->>'PRIMARY_KEYWORD' is distinct from 'UNPROVEN'
        and v_decision->'BLOCKERS'='[]'::jsonb then
      create temporary table if not exists seller_os_product_research_coalesce_v1(
        transaction_id bigint not null,account_key text not null,
        candidate_key text not null,requested_plan_id uuid not null,
        resolved_plan_id uuid null,evidence_dirty boolean not null default false,
        keyword_dirty boolean not null default false,
        primary key(transaction_id,account_key,candidate_key)
      ) on commit delete rows;
      select exists(select 1 from pg_temp.seller_os_product_research_coalesce_v1 c
        where c.transaction_id=v_txid and c.account_key=p_account_key
          and c.candidate_key=v_plan.source_candidate_key)
      into v_context_existed;
      insert into pg_temp.seller_os_product_research_coalesce_v1(
        transaction_id,account_key,candidate_key,requested_plan_id,
        resolved_plan_id,keyword_dirty)
      values(v_txid,p_account_key,v_plan.source_candidate_key,v_plan.id,
        v_plan.id,false)
      on conflict(transaction_id,account_key,candidate_key) do update set
        resolved_plan_id=excluded.resolved_plan_id;

      update public.marketplace_product_research_query_plans p set
        status='COMPLETED',completed_at=coalesce(p.completed_at,clock_timestamp()),
        research_intelligence_status='COMMERCIALLY_SUFFICIENT',
        terminal_research_conclusion='EVIDENCE_SUFFICIENT',
        worker_lease_owner=null,worker_lease_expires_at=null,
        worker_next_retry_at=null,worker_last_release_code=null,
        keyword_intelligence_decision=case
          when p.keyword_intelligence_decision is distinct from v_decision
          then v_decision else p.keyword_intelligence_decision end,
        worker_last_result=p.worker_last_result||jsonb_build_object(
          'state','CURRENT_KEYWORD_CUMULATIVE_EVIDENCE_ACCEPTED',
          'cumulativeDecisionFingerprint',v_decision->'INPUT_FINGERPRINT',
          'marketplaceWrites',0),updated_at=clock_timestamp()
      where p.id=v_plan.id;

      if v_context_existed then
        update pg_temp.seller_os_product_research_coalesce_v1
        set keyword_dirty=false
        where transaction_id=v_txid and account_key=p_account_key
          and candidate_key=v_plan.source_candidate_key;
      else
        delete from pg_temp.seller_os_product_research_coalesce_v1
        where transaction_id=v_txid and account_key=p_account_key
          and candidate_key=v_plan.source_candidate_key;
      end if;
      v_reconciled:=true;
    end if;
  end if;
  return jsonb_build_object('planId',v_plan.id,'reconciled',v_reconciled,
    'keywordDecisionReady',coalesce(v_decision->'KEYWORD_DECISION_READY','false'::jsonb),
    'marketplaceWrites',0,'publicationWrites',0,'adsWrites',0);
end;
$$;

create or replace function public.complete_quick_pick_product_research_claim_v1(
  p_marketplace_account_key text,p_plan_id uuid,p_worker_id text,
  p_capture_batch_id uuid,p_completed_at timestamptz
) returns boolean
language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare
  v_updated integer;
  v_plan public.marketplace_product_research_query_plans%rowtype;
  v_pending boolean;
  v_latest_quality text;
  v_state text;
  v_intelligence_status text;
  v_terminal text;
  v_cumulative_decision jsonb;
  v_context_existed boolean:=false;
  v_txid bigint:=txid_current();
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(coalesce(p_marketplace_account_key,'')) not between 8 and 160
      or p_plan_id is null
      or p_worker_id !~ '^product-research-browser:[0-9a-f-]{36}$'
      or p_capture_batch_id is null or p_completed_at is null
      or p_completed_at>clock_timestamp()+interval '1 minute' then
    raise exception 'QUICK_PICK_PRODUCT_RESEARCH_COMPLETION_INVALID';
  end if;
  select * into v_plan from public.marketplace_product_research_query_plans p
  where p.id=p_plan_id and p.marketplace_account_key=p_marketplace_account_key
    and p.marketplace='EBAY_US'
    and p.source_context='QUICK_PICK_RESEARCH_REQUIRED'
    and p.worker_lease_owner=p_worker_id
    and p.worker_lease_expires_at>clock_timestamp()
  for update;
  if not found or not exists(select 1
    from public.marketplace_product_research_query_tasks t
    where t.plan_id=p_plan_id and t.capture_batch_id=p_capture_batch_id
      and t.status in ('CAPTURED','PROCESSED')) then return false; end if;

  select exists(select 1 from public.marketplace_product_research_query_tasks t
    where t.plan_id=p_plan_id and t.status='PENDING') into v_pending;
  select t.quality_status into v_latest_quality
  from public.marketplace_product_research_query_tasks t
  where t.plan_id=p_plan_id
    and t.strategy_version=v_plan.intelligence_contract_version
    and t.status in ('CAPTURED','PROCESSED')
  order by t.ordinal desc limit 1;
  if not v_pending then
    v_cumulative_decision:=
      public.derive_current_plan_keyword_candidate_v2_1(p_plan_id);
  end if;

  if v_pending then
    v_state:='QUERY_RECEIPT_CREATED';
    v_intelligence_status:='RESEARCH_IN_PROGRESS'; v_terminal:=null;
  elsif v_cumulative_decision->>'KEYWORD_DECISION_READY'='true'
      and v_cumulative_decision->>'PRIMARY_KEYWORD' is distinct from 'UNPROVEN'
      and v_cumulative_decision->'BLOCKERS'='[]'::jsonb then
    v_state:='CUMULATIVE_RESEARCH_RECEIPT_CREATED';
    v_intelligence_status:='COMMERCIALLY_SUFFICIENT';
    v_terminal:='EVIDENCE_SUFFICIENT';
  elsif v_plan.terminal_research_conclusion is not null then
    v_state:='RESEARCH_RECEIPT_CREATED';
    v_intelligence_status:=case
      when v_plan.terminal_research_conclusion='EVIDENCE_SUFFICIENT'
        then 'COMMERCIALLY_SUFFICIENT'
      else 'RESEARCH_EXECUTED_BUT_COMMERCIAL_EVIDENCE_INSUFFICIENT' end;
    v_terminal:=v_plan.terminal_research_conclusion;
  elsif v_latest_quality='COMMERCIALLY_SUFFICIENT' then
    v_state:='RESEARCH_RECEIPT_CREATED';
    v_intelligence_status:='COMMERCIALLY_SUFFICIENT';
    v_terminal:='EVIDENCE_SUFFICIENT';
  elsif v_latest_quality='NO_EVIDENCE_UNPROVEN' then
    v_state:='RESEARCH_RECEIPT_CREATED';
    v_intelligence_status:='RESEARCH_EXECUTED_BUT_COMMERCIAL_EVIDENCE_INSUFFICIENT';
    v_terminal:='NO_EVIDENCE_AFTER_BOUNDED_ATTEMPTS';
  elsif v_latest_quality='LOW_PRECISION_REFORMULATION_REQUIRED'
      and v_plan.reformulation_attempt_count>=v_plan.max_reformulation_attempts then
    v_state:='RESEARCH_RECEIPT_CREATED';
    v_intelligence_status:='RESEARCH_EXECUTED_BUT_COMMERCIAL_EVIDENCE_INSUFFICIENT';
    v_terminal:='DEMAND_REMAINS_UNPROVEN_AFTER_BOUNDED_RESEARCH';
  else
    v_state:='REFORMULATION_DECISION_REQUIRED';
    v_intelligence_status:='RESEARCH_IN_PROGRESS'; v_terminal:=null;
  end if;

  create temporary table if not exists seller_os_product_research_coalesce_v1(
    transaction_id bigint not null,account_key text not null,
    candidate_key text not null,requested_plan_id uuid not null,
    resolved_plan_id uuid null,evidence_dirty boolean not null default false,
    keyword_dirty boolean not null default false,
    primary key(transaction_id,account_key,candidate_key)
  ) on commit delete rows;
  select exists(select 1 from pg_temp.seller_os_product_research_coalesce_v1 c
    where c.transaction_id=v_txid
      and c.account_key=p_marketplace_account_key
      and c.candidate_key=v_plan.source_candidate_key)
  into v_context_existed;
  insert into pg_temp.seller_os_product_research_coalesce_v1(
    transaction_id,account_key,candidate_key,requested_plan_id,
    resolved_plan_id,keyword_dirty)
  values(v_txid,p_marketplace_account_key,v_plan.source_candidate_key,
    v_plan.id,v_plan.id,false)
  on conflict(transaction_id,account_key,candidate_key) do update set
    resolved_plan_id=excluded.resolved_plan_id;

  update public.marketplace_product_research_query_plans p set
    status=case when v_pending or v_terminal is null then 'ACTIVE' else 'COMPLETED' end,
    completed_at=case when v_pending or v_terminal is null then null else p_completed_at end,
    terminal_research_conclusion=v_terminal,
    worker_lease_owner=null,worker_lease_expires_at=null,
    worker_next_retry_at=case when v_pending or v_terminal is null
      then p_completed_at else null end,
    worker_last_release_code=null,research_intelligence_status=v_intelligence_status,
    keyword_intelligence_decision=case
      when v_cumulative_decision->>'KEYWORD_DECISION_READY'='true'
        and p.keyword_intelligence_decision is distinct from v_cumulative_decision
      then v_cumulative_decision else p.keyword_intelligence_decision end,
    worker_last_result=jsonb_build_object(
      'state',v_state,'captureBatchId',p_capture_batch_id,'completedAt',p_completed_at,
      'intelligenceStatus',v_intelligence_status,'terminalConclusion',v_terminal,
      'latestQualityStatus',v_latest_quality,
      'cumulativeKeywordDecisionReady',coalesce(
        v_cumulative_decision->'KEYWORD_DECISION_READY','false'::jsonb),
      'retrySafety',case when v_pending or v_terminal is null
        then 'SAFE_IDEMPOTENT_RUNTIME_RESUME' else 'NOT_APPLICABLE' end,
      'marketplaceWrites',0),updated_at=greatest(p.updated_at,p_completed_at)
  where p.id=p_plan_id;
  get diagnostics v_updated=row_count;

  if v_context_existed then
    update pg_temp.seller_os_product_research_coalesce_v1
    set keyword_dirty=false
    where transaction_id=v_txid
      and account_key=p_marketplace_account_key
      and candidate_key=v_plan.source_candidate_key;
  else
    delete from pg_temp.seller_os_product_research_coalesce_v1
    where transaction_id=v_txid
      and account_key=p_marketplace_account_key
      and candidate_key=v_plan.source_candidate_key;
  end if;
  return v_updated=1;
end;
$$;

revoke all on function public.reconcile_current_factory_keyword_cumulative_completion_v1(
  text,uuid,uuid),public.complete_quick_pick_product_research_claim_v1(
  text,uuid,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.reconcile_current_factory_keyword_cumulative_completion_v1(
  text,uuid,uuid),public.complete_quick_pick_product_research_claim_v1(
  text,uuid,text,uuid,timestamptz) to service_role;

comment on function public.reconcile_current_factory_keyword_cumulative_completion_v1(
  text,uuid,uuid) is 'Persists one derived CURRENT Keyword V2.1 decision and transactionally coalesces the equivalent plan refresh; no marketplace, publication, or Ads writes.';

notify pgrst,'reload schema';
