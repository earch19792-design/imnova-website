begin;
create table public.seller_os_ipad_outbox_v1 (
 id uuid primary key default gen_random_uuid(), account_key text not null, actor_user_id uuid not null,
 item_id text not null check(item_id ~ '^[0-9]{9,20}$'), kind text not null check(kind in ('IMAGE_DRAFT','IMAGE_SYNC','ADS_POLICY','LISTING_DRAFT')),
 idempotency_key text not null check(idempotency_key ~ '^ipados:v1:[a-f0-9]{64}$'),
 payload_hash text not null, intent jsonb not null check(jsonb_typeof(intent)='object'), binding jsonb not null,
 state text not null check(state in ('DRAFT','PENDING_EBAY_SYNC','LEASED','UNKNOWN_COMMIT','SYNCED','ATTENTION','SUPERSEDED')),
 reason_code text, received_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 next_attempt_at timestamptz not null default now(), lease_token uuid, lease_until timestamptz,
 dispatch_count integer not null default 0 check(dispatch_count between 0 and 1),
 official_readback boolean not null default false, execution_receipt jsonb,
 unique(account_key,actor_user_id,idempotency_key)
);
alter table public.seller_os_ipad_outbox_v1 enable row level security;
revoke all on public.seller_os_ipad_outbox_v1 from public, anon, authenticated;
grant select,insert,update on public.seller_os_ipad_outbox_v1 to service_role;
create index seller_os_ipad_outbox_due_v1 on public.seller_os_ipad_outbox_v1(account_key,next_attempt_at,received_at)
 where state in ('PENDING_EBAY_SYNC','LEASED','UNKNOWN_COMMIT');
create index seller_os_ipad_outbox_actor_v1 on public.seller_os_ipad_outbox_v1(account_key,actor_user_id,received_at desc);
create index seller_os_ipad_outbox_task_v1 on public.seller_os_ipad_outbox_v1(account_key,(intent #>> '{requestedChanges,taskId}'))
 where kind in ('IMAGE_DRAFT','IMAGE_SYNC') and state <> 'SUPERSEDED';
create function public.seller_os_put_ipad_outbox_v1(p_account_key text,p_actor_user_id uuid,p_intent jsonb,p_hash text,p_binding jsonb)
returns public.seller_os_ipad_outbox_v1 language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_row public.seller_os_ipad_outbox_v1;
begin
 insert into public.seller_os_ipad_outbox_v1(account_key,actor_user_id,item_id,kind,idempotency_key,payload_hash,intent,binding,state,reason_code)
 values(p_account_key,p_actor_user_id,p_intent->>'itemId',p_intent->>'kind',p_intent->>'idempotencyKey',p_hash,p_intent,p_binding,
 case when p_intent->>'kind' in ('IMAGE_DRAFT','IMAGE_SYNC') then 'PENDING_EBAY_SYNC' else 'DRAFT' end,
 case when p_intent->>'kind' in ('IMAGE_DRAFT','IMAGE_SYNC') then 'REVALIDATION_REQUIRED' else 'DRAFT_IS_NOT_WRITE_AUTHORITY' end)
 on conflict(account_key,actor_user_id,idempotency_key) do nothing;
 select * into strict v_row from public.seller_os_ipad_outbox_v1 where account_key=p_account_key and actor_user_id=p_actor_user_id and idempotency_key=p_intent->>'idempotencyKey';
 if v_row.payload_hash is distinct from p_hash then raise exception 'OUTBOX_IDEMPOTENCY_PAYLOAD_CONFLICT'; end if;
 return v_row;
end $$;
create function public.seller_os_claim_ipad_outbox_v1(p_account_key text)
returns setof public.seller_os_ipad_outbox_v1 language sql security invoker set search_path=public,pg_temp as $$
 with candidate as (
 select id from public.seller_os_ipad_outbox_v1 where account_key=p_account_key
 and state in ('PENDING_EBAY_SYNC','LEASED','UNKNOWN_COMMIT') and next_attempt_at <= now()
 and (lease_until is null or lease_until < now()) order by next_attempt_at,received_at,id for update skip locked limit 1
 ) update public.seller_os_ipad_outbox_v1 o set state=case when o.state='UNKNOWN_COMMIT' then o.state else 'LEASED' end,
 lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now()
 from candidate c where o.id=c.id returning o.*;
$$;
revoke all on function public.seller_os_put_ipad_outbox_v1(text,uuid,jsonb,text,jsonb),public.seller_os_claim_ipad_outbox_v1(text) from public,anon,authenticated;
grant execute on function public.seller_os_put_ipad_outbox_v1(text,uuid,jsonb,text,jsonb),public.seller_os_claim_ipad_outbox_v1(text) to service_role;
create function public.guard_ipad_outbox_identity_v1() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.account_key is distinct from old.account_key or new.actor_user_id is distinct from old.actor_user_id
 or new.item_id is distinct from old.item_id or new.kind is distinct from old.kind
 or new.idempotency_key is distinct from old.idempotency_key or new.intent is distinct from old.intent
 or new.payload_hash is distinct from old.payload_hash or new.received_at is distinct from old.received_at
 or (new.binding - 'executionManifestDigest') is distinct from (old.binding - 'executionManifestDigest')
 or new.dispatch_count < old.dispatch_count
 then raise exception 'OUTBOX_IMMUTABLE_IDENTITY'; end if;
 return new;
end $$;
create trigger guard_ipad_outbox_identity_v1 before update on public.seller_os_ipad_outbox_v1
for each row execute function public.guard_ipad_outbox_identity_v1();
revoke all on function public.guard_ipad_outbox_identity_v1() from public,anon,authenticated;
grant execute on function public.guard_ipad_outbox_identity_v1() to service_role;
-- Outbox-bound tasks have one scheduler owner. Legacy rebase/execution cannot
-- bypass the outbox's original base version, drift or unknown-commit hold.
create or replace function public.seller_os_pending_mayel_visual_manifests_v1(p_account_key text)
returns table(id uuid,ebay_item_id text,visual_manifest_id uuid,visual_manifest_digest text,updated_at timestamptz)
language sql stable security invoker set search_path=public,pg_temp as $$
 select t.id,t.ebay_item_id,t.visual_manifest_id,t.visual_manifest_digest,t.updated_at
 from public.ebay_mayel_visual_tasks_v1 t where t.marketplace_account_key=p_account_key
 and t.status='OWNER_PREVIEW_READY' and t.visual_manifest_id is not null and t.visual_manifest_digest is not null
 and not exists(select 1 from public.ebay_mayel_visual_phase_b_executions_v1 e where e.marketplace_account_key=t.marketplace_account_key
 and e.visual_task_id=t.id and e.visual_manifest_digest=t.visual_manifest_digest and e.phase='APPLIED_AND_OFFICIALLY_VERIFIED')
 and not exists(select 1 from public.seller_os_ipad_outbox_v1 o where o.account_key=t.marketplace_account_key
 and o.kind in ('IMAGE_DRAFT','IMAGE_SYNC') and o.state<>'SUPERSEDED' and o.intent #>> '{requestedChanges,taskId}'=t.id::text)
 order by t.updated_at,t.id limit 3;
$$;
notify pgrst,'reload schema';
commit;
