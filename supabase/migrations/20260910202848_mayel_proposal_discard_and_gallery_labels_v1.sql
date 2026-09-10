begin;
create table public.seller_os_mayel_proposal_discards_v1 (
 id uuid primary key default gen_random_uuid(), account_key text not null,
 task_id uuid not null references public.ebay_mayel_visual_tasks_v1(id),
 actor_user_id uuid not null references auth.users(id), item_id text not null,
 base_digest text not null, asset_ids jsonb not null, before_manifest jsonb not null, after_manifest jsonb not null,
 created_at timestamptz not null default now(), unique(account_key,task_id,base_digest)
);
create index mayel_proposal_discard_actor_v1 on public.seller_os_mayel_proposal_discards_v1(actor_user_id);
create index mayel_proposal_discard_task_v1 on public.seller_os_mayel_proposal_discards_v1(task_id);
alter table public.seller_os_mayel_proposal_discards_v1 enable row level security;
revoke all on public.seller_os_mayel_proposal_discards_v1 from public,anon,authenticated;
grant select,insert on public.seller_os_mayel_proposal_discards_v1 to service_role;
create function public.guard_mayel_discard_history_v1() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin raise exception 'PROPOSAL_DISCARD_HISTORY_IMMUTABLE'; end $$;
create trigger guard_mayel_discard_history_v1 before update or delete on public.seller_os_mayel_proposal_discards_v1
 for each row execute function public.guard_mayel_discard_history_v1();
-- Old code and late requests cannot put a discarded asset back into a manifest.
create function public.guard_mayel_discarded_proposals_v1() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if not coalesce(new.selection_signal->'discardedVisualAssetIds','[]'::jsonb) @> coalesce(old.selection_signal->'discardedVisualAssetIds','[]'::jsonb)
 then raise exception 'PROPOSAL_DISCARD_HISTORY_IMMUTABLE'; end if;
 if exists(select 1 from jsonb_array_elements(coalesce(new.visual_manifest->'proposedOrderedImages','[]')) e
 where coalesce(new.selection_signal->'discardedVisualAssetIds','[]'::jsonb) ? (e->>'assetId'))
 then raise exception 'PROPOSAL_DISCARDED_ASSET_NOT_EXECUTABLE'; end if;
 return new;
end $$;
create trigger guard_mayel_discarded_proposals_v1 before update of visual_manifest,selection_signal on public.ebay_mayel_visual_tasks_v1
 for each row execute function public.guard_mayel_discarded_proposals_v1();
create function public.seller_os_discard_mayel_proposals_v1(p_account text,p_actor uuid,p_task uuid,p_item text,
 p_expected_digest text,p_asset_ids jsonb,p_manifest jsonb) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare t record; r record; prior record; old_ids jsonb; new_ids jsonb; affected integer:=0; saved_id uuid;
begin
 select id,marketplace_account_key,ebay_item_id,assigned_operator_user_id,status,visual_manifest,visual_manifest_digest,selection_signal
 into t from public.ebay_mayel_visual_tasks_v1 where id=p_task and marketplace_account_key=p_account and ebay_item_id=p_item for update;
 if not found or t.status='CANCELLED' or not (p_actor=t.assigned_operator_user_id or exists(
   select 1 from public.seller_os_mayel_optimization_grants_v1 g where g.account_key=p_account and g.owner_user_id=p_actor and g.status='ACTIVE' and g.revoked_at is null))
 then raise exception 'PROPOSAL_ACTOR_OR_TASK_INVALID'; end if;
 if jsonb_typeof(p_asset_ids) is distinct from 'array' or jsonb_array_length(p_asset_ids) not between 1 and 6 then raise exception 'PROPOSAL_ASSETS_INVALID'; end if;
 select id,asset_ids into prior from public.seller_os_mayel_proposal_discards_v1 where account_key=p_account and task_id=p_task and base_digest=p_expected_digest;
 if found then
  if prior.asset_ids @> p_asset_ids and p_asset_ids @> prior.asset_ids then return jsonb_build_object('status','PROPOSALS_DISCARDED','receiptId',prior.id,'idempotent',true); end if;
  raise exception 'PROPOSAL_PREVIEW_CHANGED';
 end if;
 if t.visual_manifest_digest is distinct from p_expected_digest or p_manifest is null then raise exception 'PROPOSAL_PREVIEW_CHANGED'; end if;
 if exists(select 1 from jsonb_array_elements_text(p_asset_ids) a where not exists(
   select 1 from jsonb_array_elements(t.visual_manifest->'proposedOrderedImages') e where e->>'assetId'=a))
 or p_manifest->>'visualTaskId' is distinct from p_task::text or p_manifest->>'ebayItemId' is distinct from p_item
 or p_manifest->'currentMainImage' is distinct from t.visual_manifest->'currentMainImage'
 or p_manifest->'currentSecondaryImages' is distinct from t.visual_manifest->'currentSecondaryImages'
 or coalesce(p_manifest->>'visualManifestDigest','') !~ '^sha256:[a-f0-9]{64}$'
 or exists(select 1 from jsonb_array_elements(p_manifest->'proposedOrderedImages') e where p_asset_ids ? (e->>'assetId'))
 then raise exception 'PROPOSAL_DISCARD_BINDING_INVALID'; end if;
 -- No cancellation can hide an in-flight or unknown marketplace commit.
 if exists(select 1 from public.ebay_mayel_visual_phase_b_executions_v1 e where e.visual_task_id=p_task
   and e.visual_manifest_digest=p_expected_digest) then raise exception 'PROPOSAL_OFFICIAL_RECONCILIATION_REQUIRED'; end if;
 for r in select id,state,dispatch_count,lease_until from public.seller_os_ipad_outbox_v1 where account_key=p_account and item_id=p_item
   and kind in ('IMAGE_SYNC','IMAGE_DRAFT','IMAGE_UPLOAD') and intent #>> '{requestedChanges,taskId}'=p_task::text
   and state not in ('SYNCED','SUPERSEDED') order by id limit 101 for update loop
  affected:=affected+1; if affected>100 then raise exception 'PROPOSAL_OUTBOX_BOUND_EXCEEDED'; end if;
  if r.dispatch_count>0 or r.lease_until>now() or r.state in ('UNKNOWN_COMMIT','SYNCING','OFFICIAL_READBACK_REQUIRED')
   then raise exception 'PROPOSAL_OFFICIAL_RECONCILIATION_REQUIRED'; end if;
  update public.seller_os_ipad_outbox_v1 set state='SUPERSEDED',reason_code='OWNER_DISCARDED_PROPOSAL',updated_at=now(),lease_token=null,lease_until=null where id=r.id;
 end loop;
 for r in select id,state,dispatch_count,lease_until from public.seller_os_mayel_content_outbox_v1 where account_key=p_account and task_id=p_task
   and item_id=p_item and audit->'actions' ?| array['IMAGE_REORDER','IMAGE_REMOVAL'] and state<>'SYNCED' order by id limit 101 for update loop
  affected:=affected+1; if affected>100 then raise exception 'PROPOSAL_OUTBOX_BOUND_EXCEEDED'; end if;
  if r.dispatch_count>0 or r.lease_until>now() then raise exception 'PROPOSAL_OFFICIAL_RECONCILIATION_REQUIRED'; end if;
  update public.seller_os_mayel_content_outbox_v1 set state='REQUIRES_ATTENTION',reason_code='OWNER_DISCARDED_PROPOSAL',updated_at=now(),lease_token=null,lease_until=null where id=r.id;
 end loop;
 old_ids:=coalesce(t.selection_signal->'discardedVisualAssetIds','[]'::jsonb);
 select coalesce(jsonb_agg(distinct value),'[]'::jsonb) into new_ids from jsonb_array_elements(old_ids||p_asset_ids);
 insert into public.seller_os_mayel_proposal_discards_v1(account_key,task_id,actor_user_id,item_id,base_digest,asset_ids,before_manifest,after_manifest)
 values(p_account,p_task,p_actor,p_item,p_expected_digest,p_asset_ids,t.visual_manifest,p_manifest) returning id into saved_id;
 update public.ebay_mayel_visual_tasks_v1 set visual_manifest=p_manifest,visual_manifest_digest=p_manifest->>'visualManifestDigest',
  selection_signal=(coalesce(t.selection_signal,'{}'::jsonb)-'pendingGalleryDecision')||jsonb_build_object('discardedVisualAssetIds',new_ids),
  status=case when exists(select 1 from jsonb_array_elements(p_manifest->'proposedOrderedImages') e where e->>'assetId' is not null)
   then 'OWNER_PREVIEW_READY' else 'PROMPT_READY' end,updated_at=now() where id=p_task;
 return jsonb_build_object('status','PROPOSALS_DISCARDED','receiptId',saved_id,'idempotent',false,'discardedAssetIds',p_asset_ids,'marketplaceWrites',0);
end $$;
revoke all on function public.guard_mayel_discard_history_v1(),public.guard_mayel_discarded_proposals_v1(),
 public.seller_os_discard_mayel_proposals_v1(text,uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.guard_mayel_discard_history_v1(),public.guard_mayel_discarded_proposals_v1(),
 public.seller_os_discard_mayel_proposals_v1(text,uuid,uuid,text,text,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
