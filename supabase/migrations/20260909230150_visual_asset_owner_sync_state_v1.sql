begin;
-- Independent OWNER evidence; legacy Phase A QA flags retain their meaning.
alter table public.ebay_listing_image_assets add column owner_sync_approval jsonb;
alter table public.seller_os_ipad_outbox_v1 drop constraint seller_os_ipad_outbox_v1_state_check;
alter table public.seller_os_ipad_outbox_v1 add constraint seller_os_ipad_outbox_v1_state_check check(state in
 ('DRAFT','QA_READY','OWNER_APPROVAL_REQUIRED','APPROVED_FOR_EBAY_SYNC','PENDING_EBAY_SYNC','REVALIDATING','SYNCING','OFFICIAL_READBACK_REQUIRED','SYNCED','REQUIRES_ATTENTION','ATTENTION','SUPERSEDED','LEASED','UNKNOWN_COMMIT'));

create function public.seller_os_visual_asset_owner_approved_v1(a public.ebay_listing_image_assets,t public.ebay_mayel_visual_tasks_v1)
returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(a.status='approved' and a.mayel_approval_status='APPROVED'
 and a.qa_result->>'automaticStatus'='PASSED' and a.qa_result #>> '{humanReview,decision}'='APPROVE'
 and a.owner_sync_approval->>'confirmation'='APPROVE_THIS_ASSET_FOR_EBAY_SYNC_V1'
 and a.owner_sync_approval->>'assetId'=a.id::text
 and a.owner_sync_approval->>'generation'=a.id::text||':'||a.output_sha256
 and a.owner_sync_approval->>'idempotencyKey'='ipados:v1:'||encode(sha256(convert_to('visual-sync:'||a.id::text||':'||a.output_sha256,'UTF8')),'hex')
 and a.owner_sync_approval->>'ownerUserId' is not null and a.owner_sync_approval->>'approvedAt' is not null
 and a.source_image_set_digest=t.source_image_set_digest and a.product_truth_digest=t.product_truth_digest
 and a.owner_sync_approval->>'sourceImageSetDigest'=t.source_image_set_digest
 and a.owner_sync_approval->>'productTruthDigest'=t.product_truth_digest,false);
$$;
create function public.seller_os_visual_outbox_owner_ready_v1(o public.seller_os_ipad_outbox_v1)
returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select exists(select 1 from public.ebay_mayel_visual_tasks_v1 t
 where t.id::text=o.intent #>> '{requestedChanges,taskId}' and t.marketplace_account_key=o.account_key and t.ebay_item_id=o.item_id
 and t.source_image_set_digest=o.binding->>'sourceImageSetDigest' and t.status='OWNER_PREVIEW_READY'
 and t.visual_manifest_digest is not null
 and jsonb_array_length(coalesce(t.visual_manifest->'proposedOrderedImages','[]'))>0
 and exists(select 1 from jsonb_array_elements(t.visual_manifest->'proposedOrderedImages') e where e->>'assetId' is not null)
 and not exists(select 1 from jsonb_array_elements(t.visual_manifest->'proposedOrderedImages') e
   where e->>'assetId' is not null and not exists(select 1 from public.ebay_listing_image_assets a
   where a.id::text=e->>'assetId' and a.account_key=o.account_key and a.mayel_visual_task_id=t.id
   and a.output_sha256=e->>'outputSha256' and public.seller_os_visual_asset_owner_approved_v1(a,t)))
 and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(o.binding->'assets')='array' then o.binding->'assets'
   else jsonb_build_array(jsonb_build_object('assetId',o.binding->>'assetId','sourceSha256',o.binding->>'sourceSha256')) end) b
   where not exists(select 1 from public.ebay_listing_image_assets a where a.id::text=b->>'assetId'
     and a.source_sha256=b->>'sourceSha256' and a.account_key=o.account_key and a.mayel_visual_task_id=t.id
     and public.seller_os_visual_asset_owner_approved_v1(a,t)
     and exists(select 1 from jsonb_array_elements(t.visual_manifest->'proposedOrderedImages') e where e->>'assetId'=a.id::text)))
 );
$$;
-- A draft receipt is not a request to publish. Repair existing undispatched rows.
update public.seller_os_ipad_outbox_v1 set state='OWNER_APPROVAL_REQUIRED',reason_code='OWNER_VISUAL_REVIEW_REQUIRED',lease_token=null,lease_until=null
 where kind in ('IMAGE_DRAFT','IMAGE_SYNC','IMAGE_UPLOAD') and dispatch_count=0 and state not in ('SYNCED','SUPERSEDED')
 and not public.seller_os_visual_outbox_owner_ready_v1(seller_os_ipad_outbox_v1);

alter table public.seller_os_ipad_outbox_v1 add constraint seller_os_visual_sync_readback_v1 check(state<>'SYNCED' or official_readback);
create function public.guard_visual_outbox_owner_sync_v1() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.kind in ('IMAGE_DRAFT','IMAGE_SYNC','IMAGE_UPLOAD') and new.dispatch_count=0
 and new.state in ('APPROVED_FOR_EBAY_SYNC','PENDING_EBAY_SYNC','REVALIDATING','LEASED')
 and not public.seller_os_visual_outbox_owner_ready_v1(new) then
   new.state:='OWNER_APPROVAL_REQUIRED';new.reason_code:='OWNER_VISUAL_REVIEW_REQUIRED';new.lease_token:=null;new.lease_until:=null;
 end if;
 if new.state in ('SYNCING','OFFICIAL_READBACK_REQUIRED') and new.dispatch_count<>1 then raise exception 'VISUAL_SYNC_DISPATCH_STATE_INVALID';end if;
 if tg_op='UPDATE' and new.dispatch_count>old.dispatch_count and not public.seller_os_visual_outbox_owner_ready_v1(new) then
   raise exception 'VISUAL_OWNER_APPROVAL_REQUIRED';
 end if;
 return new;
end $$;
create trigger guard_visual_outbox_owner_sync_v1 before insert or update on public.seller_os_ipad_outbox_v1
 for each row execute function public.guard_visual_outbox_owner_sync_v1();

create or replace function public.seller_os_claim_ipad_outbox_v1(p_account_key text)
returns setof public.seller_os_ipad_outbox_v1 language sql security invoker set search_path=public,pg_temp as $$
 with candidate as (
 select id from public.seller_os_ipad_outbox_v1 where account_key=p_account_key
 and state in ('APPROVED_FOR_EBAY_SYNC','PENDING_EBAY_SYNC','REVALIDATING','SYNCING','OFFICIAL_READBACK_REQUIRED','UNKNOWN_COMMIT','LEASED')
 and (dispatch_count>0 or public.seller_os_visual_outbox_owner_ready_v1(seller_os_ipad_outbox_v1))
 and next_attempt_at<=now() and (lease_until is null or lease_until<now())
 order by next_attempt_at,received_at,id for update skip locked limit 1
 ) update public.seller_os_ipad_outbox_v1 o set lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now()
 from candidate c where o.id=c.id returning o.*;
$$;

-- The authenticated route verifies OWNER_ADMIN; the RPC also binds the account's durable OWNER identity.
create function public.seller_os_approve_visual_asset_sync_v1(p_account_key text,p_actor_user_id uuid,p_task_id uuid,p_asset_id uuid,p_generation text,p_confirmation text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare t public.ebay_mayel_visual_tasks_v1;a public.ebay_listing_image_assets;approval jsonb;
begin
 if p_confirmation<>'APPROVE_THIS_ASSET_FOR_EBAY_SYNC_V1' or not exists(select 1 from public.ebay_mayel_visual_delegation_authorities_v1 d where d.owner_user_id=p_actor_user_id
 and d.marketplace_account_key=p_account_key and d.status='ACTIVE' and d.revoked_at is null) then raise exception 'VISUAL_SYNC_OWNER_REQUIRED';end if;
 select * into strict t from public.ebay_mayel_visual_tasks_v1 where id=p_task_id and marketplace_account_key=p_account_key for update;
 select * into strict a from public.ebay_listing_image_assets where id=p_asset_id and mayel_visual_task_id=p_task_id and account_key=p_account_key for update;
 if p_generation is distinct from a.id::text||':'||a.output_sha256 or a.status<>'approved' or a.mayel_approval_status<>'APPROVED'
 or a.qa_result->>'automaticStatus' is distinct from 'PASSED' or a.qa_result #>> '{humanReview,decision}' is distinct from 'APPROVE'
 or a.source_image_set_digest is distinct from t.source_image_set_digest or a.product_truth_digest is distinct from t.product_truth_digest
 then raise exception 'VISUAL_SYNC_QA_OR_GENERATION_CHANGED';end if;
 if exists(select 1 from public.seller_os_ipad_outbox_v1 o where o.account_key=p_account_key and o.intent #>> '{requestedChanges,taskId}'=p_task_id::text
 and (o.lease_until>now() or o.dispatch_count>0) and o.state not in ('SYNCED','SUPERSEDED','ATTENTION','REQUIRES_ATTENTION')) then raise exception 'VISUAL_SYNC_EXECUTION_IN_PROGRESS';end if;
 if public.seller_os_visual_asset_owner_approved_v1(a,t) then return a.owner_sync_approval;end if;
 approval:=jsonb_build_object('confirmation',p_confirmation,'assetId',a.id,'generation',p_generation,
   'idempotencyKey','ipados:v1:'||encode(sha256(convert_to('visual-sync:'||p_generation,'UTF8')),'hex'),
   'ownerUserId',p_actor_user_id,'approvedAt',now(),'sourceImageSetDigest',t.source_image_set_digest,'productTruthDigest',t.product_truth_digest);
 update public.ebay_listing_image_assets set owner_sync_approval=approval where id=p_asset_id;
 update public.seller_os_ipad_outbox_v1 o set state='APPROVED_FOR_EBAY_SYNC',reason_code='REVALIDATION_REQUIRED',next_attempt_at=now(),updated_at=now()
 where o.account_key=p_account_key and o.intent #>> '{requestedChanges,taskId}'=p_task_id::text and o.dispatch_count=0
 and o.state in ('DRAFT','QA_READY','OWNER_APPROVAL_REQUIRED','APPROVED_FOR_EBAY_SYNC','PENDING_EBAY_SYNC')
 and public.seller_os_visual_outbox_owner_ready_v1(o);
 return approval;
end $$;
revoke all on function public.seller_os_visual_asset_owner_approved_v1(public.ebay_listing_image_assets,public.ebay_mayel_visual_tasks_v1),
 public.seller_os_visual_outbox_owner_ready_v1(public.seller_os_ipad_outbox_v1),public.guard_visual_outbox_owner_sync_v1(),
 public.seller_os_approve_visual_asset_sync_v1(text,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.seller_os_visual_asset_owner_approved_v1(public.ebay_listing_image_assets,public.ebay_mayel_visual_tasks_v1),
 public.seller_os_visual_outbox_owner_ready_v1(public.seller_os_ipad_outbox_v1),public.guard_visual_outbox_owner_sync_v1(),
 public.seller_os_approve_visual_asset_sync_v1(text,uuid,uuid,uuid,text,text) to service_role;
-- Slot ownership is atomic even if two browser uploads finish together.
create unique index seller_os_visual_active_slot_v1 on public.ebay_listing_image_assets(mayel_visual_task_id,mayel_output_role)
 where mayel_visual_task_id is not null and status in ('pending_review','approved');
create function public.guard_visual_sync_generation_v1() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.mayel_visual_task_id is null then return new;end if;
 if new.output_sha256 is distinct from old.output_sha256 or new.source_sha256 is distinct from old.source_sha256
 or new.source_image_set_digest is distinct from old.source_image_set_digest or new.product_truth_digest is distinct from old.product_truth_digest
 or new.mayel_output_role is distinct from old.mayel_output_role or new.status is distinct from old.status
 or new.qa_result is distinct from old.qa_result then
   if exists(select 1 from public.seller_os_ipad_outbox_v1 o where o.account_key=new.account_key
     and o.intent #>> '{requestedChanges,taskId}'=new.mayel_visual_task_id::text
     and (o.lease_until>now() or o.dispatch_count>0) and o.state not in ('SYNCED','SUPERSEDED','ATTENTION','REQUIRES_ATTENTION'))
   then raise exception 'VISUAL_SYNC_EXECUTION_IN_PROGRESS';end if;
   new.owner_sync_approval:=null;
   update public.seller_os_ipad_outbox_v1 o set state='REQUIRES_ATTENTION',reason_code='STALE_ASSET_OR_QA_CHANGED',updated_at=now()
   where o.account_key=new.account_key and o.intent #>> '{requestedChanges,taskId}'=new.mayel_visual_task_id::text
     and o.dispatch_count=0 and o.state in ('APPROVED_FOR_EBAY_SYNC','PENDING_EBAY_SYNC','REVALIDATING');
 end if;
 return new;
end $$;
create trigger guard_visual_sync_generation_v1 before update on public.ebay_listing_image_assets
 for each row execute function public.guard_visual_sync_generation_v1();
create function public.guard_visual_sync_task_v1() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.visual_manifest_digest is distinct from old.visual_manifest_digest or new.source_image_set_digest is distinct from old.source_image_set_digest
 or new.product_truth_digest is distinct from old.product_truth_digest or new.status is distinct from old.status then
   if exists(select 1 from public.seller_os_ipad_outbox_v1 o where o.account_key=new.marketplace_account_key
     and o.intent #>> '{requestedChanges,taskId}'=new.id::text and (o.lease_until>now() or o.dispatch_count>0)
     and o.state not in ('SYNCED','SUPERSEDED','ATTENTION','REQUIRES_ATTENTION')) then raise exception 'VISUAL_SYNC_EXECUTION_IN_PROGRESS';end if;
 end if;
 return new;
end $$;
create trigger guard_visual_sync_task_v1 before update on public.ebay_mayel_visual_tasks_v1
 for each row execute function public.guard_visual_sync_task_v1();
revoke all on function public.guard_visual_sync_generation_v1(),public.guard_visual_sync_task_v1() from public,anon,authenticated;
grant execute on function public.guard_visual_sync_generation_v1(),public.guard_visual_sync_task_v1() to service_role;
drop index public.seller_os_ipad_outbox_due_v1;
create index seller_os_ipad_outbox_due_v1 on public.seller_os_ipad_outbox_v1(account_key,next_attempt_at,received_at)
 where state in ('APPROVED_FOR_EBAY_SYNC','PENDING_EBAY_SYNC','REVALIDATING','SYNCING','OFFICIAL_READBACK_REQUIRED','UNKNOWN_COMMIT','LEASED');
notify pgrst,'reload schema';
commit;
