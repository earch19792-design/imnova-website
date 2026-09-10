begin;
-- Historical pending state never suppresses a different current generation.
create function public.seller_os_current_gallery_preparation_due_v1(signal jsonb,current_digest text,p_now timestamptz)
returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select case when signal #>> '{pendingGalleryDecision,expectedManifestDigest}' is distinct from current_digest then true
 else public.seller_os_pending_gallery_due_v1(signal,p_now) end;
$$;
revoke all on function public.seller_os_current_gallery_preparation_due_v1(jsonb,text,timestamptz) from public,anon,authenticated;
grant execute on function public.seller_os_current_gallery_preparation_due_v1(jsonb,text,timestamptz) to service_role;
create or replace function public.seller_os_pending_mayel_visual_manifests_v1(p_account_key text)
returns table(id uuid,ebay_item_id text,visual_manifest_id uuid,visual_manifest_digest text,updated_at timestamptz)
language sql stable security invoker set search_path=public,pg_temp as $$
 select t.id,t.ebay_item_id,t.visual_manifest_id,t.visual_manifest_digest,t.updated_at
 from public.ebay_mayel_visual_tasks_v1 t where t.marketplace_account_key=p_account_key
 and public.seller_os_current_gallery_preparation_due_v1(t.selection_signal,t.visual_manifest_digest,now())
 and t.status='OWNER_PREVIEW_READY' and t.visual_manifest_id is not null and t.visual_manifest_digest is not null
 and (not exists(select 1 from public.seller_os_mayel_optimization_grants_v1 d where d.account_key=p_account_key and d.status='ACTIVE')
 or exists(select 1 from public.seller_os_mayel_optimization_grants_v1 d where d.account_key=p_account_key and d.status='ACTIVE'
 and (t.selection_signal->>'productTruthSupported'='true' or public.seller_os_visual_current_product_truth_v1(t) is not null)))
 and not exists(select 1 from public.ebay_mayel_visual_phase_b_executions_v1 e where e.marketplace_account_key=t.marketplace_account_key
 and e.visual_task_id=t.id and e.visual_manifest_digest=t.visual_manifest_digest and e.phase='APPLIED_AND_OFFICIALLY_VERIFIED')
 and not exists(select 1 from public.seller_os_ipad_outbox_v1 o where o.account_key=t.marketplace_account_key
 and o.kind in ('IMAGE_DRAFT','IMAGE_SYNC','IMAGE_UPLOAD') and o.state<>'SUPERSEDED'
 and o.intent #>> '{requestedChanges,taskId}'=t.id::text
 and (o.kind='IMAGE_SYNC' and o.intent #>> '{requestedChanges,manifestDigest}'=t.visual_manifest_digest
 or o.dispatch_count>0 or not exists(select 1 from public.seller_os_mayel_optimization_grants_v1 d
 where d.account_key=p_account_key and d.status='ACTIVE' and d.revoked_at is null
 and (t.selection_signal->>'productTruthSupported'='true' or public.seller_os_visual_current_product_truth_v1(t) is not null))))
 and not exists(select 1 from public.seller_os_mayel_content_outbox_v1 c where c.task_id=t.id and c.account_key=t.marketplace_account_key
  and c.audit #>> '{galleryMutation,visualManifestDigest}'=t.visual_manifest_digest)
 order by t.updated_at,t.id limit 3;
$$;
notify pgrst,'reload schema';
commit;
