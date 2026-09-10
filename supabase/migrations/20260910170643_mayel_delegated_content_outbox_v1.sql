begin;
-- Content intents share the existing operational runtime and sync engine.
-- This table is a durable queue, not an additional worker or polling schedule.
create table public.seller_os_mayel_content_outbox_v1 (
 id uuid primary key default gen_random_uuid(), account_key text not null,
 item_id text not null check(item_id ~ '^[0-9]{9,20}$'),
 task_id uuid not null references public.ebay_mayel_visual_tasks_v1(id),
 grant_id uuid not null references public.seller_os_mayel_optimization_grants_v1(id),
 idempotency_key text not null unique, source_digest text not null,
 base_hash text not null, audit jsonb not null,
 state text not null default 'PENDING_EBAY_SYNC' check(state in
 ('PENDING_EBAY_SYNC','REVALIDATING','SYNCING','OFFICIAL_READBACK_REQUIRED','SYNCED','REQUIRES_ATTENTION')),
 dispatch_count integer not null default 0 check(dispatch_count between 0 and 1),
 official_readback boolean not null default false,
 execution_receipt jsonb, reason_code text, lease_token uuid, lease_until timestamptz,
 next_attempt_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(source_digest ~ '^sha256:[a-f0-9]{64}$' and base_hash ~ '^sha256:[a-f0-9]{64}$'),
 check(not official_readback or (state='SYNCED' and execution_receipt is not null))
);
create unique index seller_os_content_one_pending_binding_v1 on public.seller_os_mayel_content_outbox_v1(account_key,item_id)
 where state not in ('SYNCED','REQUIRES_ATTENTION');
create index seller_os_content_due_v1 on public.seller_os_mayel_content_outbox_v1(account_key,next_attempt_at,created_at)
 where state not in ('SYNCED','REQUIRES_ATTENTION');
alter table public.seller_os_mayel_content_outbox_v1 enable row level security;
revoke all on public.seller_os_mayel_content_outbox_v1 from public,anon,authenticated;
grant select,insert,update on public.seller_os_mayel_content_outbox_v1 to service_role;

create function public.seller_os_content_grant_ready_v1(p_account text,p_grant uuid,p_audit jsonb)
returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(exists(select 1 from public.seller_os_mayel_optimization_grants_v1 g
 where g.id=p_grant and g.account_key=p_account and g.status='ACTIVE' and g.revoked_at is null
 and g.scope='FULL' and g.contract_version='MAYEL_AUTONOMOUS_LISTING_OPTIMIZATION_DELEGATION_V1'
 and p_audit #>> '{qa,pass}'='true' and p_audit #>> '{qa,unsupportedClaimCount}'='0'
 and p_audit #>> '{qa,competitorContaminationCount}'='0'
 and jsonb_array_length(p_audit->'actions') between 1 and 3
 and not exists(select 1 from jsonb_array_elements_text(p_audit->'actions') a
 where a not in ('TITLE_OPTIMIZATION','DESCRIPTION_OPTIMIZATION','ITEM_SPECIFICS_OPTIMIZATION') or not(g.allowed_actions ? a))
 and p_audit #>> '{evidenceUsed,keyword,STATUS}'='ACCEPTED'
 and p_audit #>> '{evidenceUsed,keyword,DECISION_VERSION}'='PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V2_1'
 and p_audit #>> '{evidenceUsed,keyword,LEGACY_FALLBACK_USED}'='false'),false);
$$;
create function public.seller_os_content_intent_guard_v1() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' and (new.account_key,new.item_id,new.task_id,new.grant_id,new.idempotency_key,new.source_digest,new.base_hash,new.audit,new.created_at)
 is distinct from (old.account_key,old.item_id,old.task_id,old.grant_id,old.idempotency_key,old.source_digest,old.base_hash,old.audit,old.created_at)
 then raise exception 'CONTENT_INTENT_IMMUTABLE'; end if;
 if tg_op='UPDATE' and (new.dispatch_count<old.dispatch_count or old.state='SYNCED' and new is distinct from old)
 then raise exception 'CONTENT_HISTORY_IMMUTABLE'; end if;
 if tg_op='INSERT' or new.dispatch_count>old.dispatch_count then
  if not public.seller_os_content_grant_ready_v1(new.account_key,new.grant_id,new.audit)
  or not exists(select 1 from public.ebay_mayel_visual_tasks_v1 t where t.id=new.task_id
    and t.marketplace_account_key=new.account_key and t.ebay_item_id=new.item_id)
  then raise exception 'CONTENT_OWNER_DELEGATION_REQUIRED'; end if;
 end if;
 if tg_op='INSERT' and (new.dispatch_count<>0 or new.state<>'PENDING_EBAY_SYNC' or new.official_readback)
 then raise exception 'CONTENT_INITIAL_STATE_INVALID'; end if;
 if tg_op='UPDATE' and new.dispatch_count>old.dispatch_count and
 (old.state<>'REVALIDATING' or new.state<>'SYNCING' or old.lease_token is null or old.lease_until<=now() or new.lease_token is distinct from old.lease_token)
 then raise exception 'CONTENT_DISPATCH_LEASE_REQUIRED'; end if;
 return new;
end $$;
create trigger seller_os_content_intent_guard_v1 before insert or update on public.seller_os_mayel_content_outbox_v1
 for each row execute function public.seller_os_content_intent_guard_v1();

create function public.seller_os_claim_content_outbox_v1(p_account_key text)
returns setof public.seller_os_mayel_content_outbox_v1 language sql volatile security invoker set search_path=public,pg_temp as $$
 with due as (select id from public.seller_os_mayel_content_outbox_v1
 where account_key=p_account_key and state not in ('SYNCED','REQUIRES_ATTENTION') and next_attempt_at<=now()
 and (lease_until is null or lease_until<now()) order by next_attempt_at,created_at limit 1 for update skip locked)
 update public.seller_os_mayel_content_outbox_v1 o set lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now()
 from due where o.id=due.id
 returning o.id,o.account_key,o.item_id,o.task_id,o.grant_id,o.idempotency_key,o.source_digest,o.base_hash,o.audit,o.state,
 o.dispatch_count,o.official_readback,o.execution_receipt,o.reason_code,o.lease_token,o.lease_until,o.next_attempt_at,o.created_at,o.updated_at;
$$;
revoke all on function public.seller_os_content_grant_ready_v1(text,uuid,jsonb),public.seller_os_content_intent_guard_v1(),public.seller_os_claim_content_outbox_v1(text)
 from public,anon,authenticated;
grant execute on function public.seller_os_content_grant_ready_v1(text,uuid,jsonb),public.seller_os_content_intent_guard_v1(),public.seller_os_claim_content_outbox_v1(text) to service_role;
notify pgrst,'reload schema';
commit;
