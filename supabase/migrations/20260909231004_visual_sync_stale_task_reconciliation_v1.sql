begin;
-- Reconcile a frozen draft when its saved task changes. An expired approval
-- cannot remain labeled pending while excluded from the scheduler.
create function public.reconcile_visual_sync_task_state_v1() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.source_image_set_digest is distinct from old.source_image_set_digest
 or new.product_truth_digest is distinct from old.product_truth_digest
 or new.current_image_set is distinct from old.current_image_set then
   update public.seller_os_ipad_outbox_v1 o set state='REQUIRES_ATTENTION',reason_code='BASE_GENERATION_OR_PRODUCT_IDENTITY_CHANGED',updated_at=now()
   where o.account_key=new.marketplace_account_key and o.intent #>> '{requestedChanges,taskId}'=new.id::text
   and o.dispatch_count=0 and o.kind in ('IMAGE_DRAFT','IMAGE_SYNC','IMAGE_UPLOAD') and o.state not in ('SYNCED','SUPERSEDED');
 elsif new.visual_manifest_digest is distinct from old.visual_manifest_digest or new.status is distinct from old.status then
   update public.seller_os_ipad_outbox_v1 o set
   state=case when public.seller_os_visual_outbox_owner_ready_v1(o) then 'APPROVED_FOR_EBAY_SYNC' else 'OWNER_APPROVAL_REQUIRED' end,
   reason_code=case when public.seller_os_visual_outbox_owner_ready_v1(o) then 'REVALIDATION_REQUIRED' else 'OWNER_VISUAL_REVIEW_REQUIRED' end,updated_at=now()
   where o.account_key=new.marketplace_account_key and o.intent #>> '{requestedChanges,taskId}'=new.id::text
   and o.dispatch_count=0 and o.kind in ('IMAGE_DRAFT','IMAGE_SYNC','IMAGE_UPLOAD')
   and o.state in ('DRAFT','QA_READY','OWNER_APPROVAL_REQUIRED','APPROVED_FOR_EBAY_SYNC','PENDING_EBAY_SYNC');
 end if;
 return new;
end $$;
create trigger reconcile_visual_sync_task_state_v1 after update on public.ebay_mayel_visual_tasks_v1
 for each row execute function public.reconcile_visual_sync_task_state_v1();
revoke all on function public.reconcile_visual_sync_task_state_v1() from public,anon,authenticated;
grant execute on function public.reconcile_visual_sync_task_state_v1() to service_role;
notify pgrst,'reload schema';
commit;
