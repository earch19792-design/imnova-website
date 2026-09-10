begin;
-- Archive a final rejection from the working view. QA/files remain immutable;
-- the action neither alters a manifest nor makes a marketplace request.
create function public.seller_os_archive_rejected_proposals_v1(p_account text,p_actor uuid,p_task uuid,p_item text,p_asset_ids jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare t record; prior record; archive_key text; new_ids jsonb; saved_id uuid;
begin
 select id,marketplace_account_key,ebay_item_id,assigned_operator_user_id,status,visual_manifest,visual_manifest_digest,selection_signal
 into t from public.ebay_mayel_visual_tasks_v1 where id=p_task and marketplace_account_key=p_account and ebay_item_id=p_item for update;
 if not found or not (p_actor=t.assigned_operator_user_id or exists(select 1 from public.seller_os_mayel_optimization_grants_v1 g
 where g.account_key=p_account and g.owner_user_id=p_actor and g.status='ACTIVE' and g.revoked_at is null))
 then raise exception 'PROPOSAL_ACTOR_OR_TASK_INVALID'; end if;
 if jsonb_typeof(p_asset_ids) is distinct from 'array' or jsonb_array_length(p_asset_ids) not between 1 and 6
 then raise exception 'PROPOSAL_ASSETS_INVALID'; end if;
 if exists(select 1 from jsonb_array_elements_text(p_asset_ids) x where not exists(select 1 from public.ebay_listing_image_assets a
   where a.id::text=x and a.account_key=p_account and a.mayel_visual_task_id=p_task and a.status='rejected' and a.mayel_approval_status='REJECTED'))
 or exists(select 1 from jsonb_array_elements(coalesce(t.visual_manifest->'proposedOrderedImages','[]')) e where p_asset_ids ? (e->>'assetId'))
 then raise exception 'PROPOSAL_FINAL_REJECTION_REQUIRED'; end if;
 select 'ARCHIVE_REJECTED:'||md5(string_agg(value,',' order by value)) into archive_key from jsonb_array_elements_text(p_asset_ids);
 select id into prior from public.seller_os_mayel_proposal_discards_v1 where account_key=p_account and task_id=p_task and base_digest=archive_key;
 if found then return jsonb_build_object('status','REJECTED_PROPOSALS_ARCHIVED','receiptId',prior.id,'idempotent',true,'marketplaceWrites',0); end if;
 select jsonb_agg(distinct value) into new_ids from jsonb_array_elements(coalesce(t.selection_signal->'discardedVisualAssetIds','[]'::jsonb)||p_asset_ids);
 insert into public.seller_os_mayel_proposal_discards_v1(account_key,task_id,actor_user_id,item_id,base_digest,asset_ids,before_manifest,after_manifest)
 values(p_account,p_task,p_actor,p_item,archive_key,p_asset_ids,coalesce(t.visual_manifest,'{}'::jsonb),coalesce(t.visual_manifest,'{}'::jsonb)) returning id into saved_id;
 update public.ebay_mayel_visual_tasks_v1 set selection_signal=coalesce(t.selection_signal,'{}'::jsonb)||jsonb_build_object('discardedVisualAssetIds',new_ids),updated_at=now() where id=p_task;
 return jsonb_build_object('status','REJECTED_PROPOSALS_ARCHIVED','receiptId',saved_id,'idempotent',false,'archivedAssetIds',p_asset_ids,'marketplaceWrites',0);
end $$;
revoke all on function public.seller_os_archive_rejected_proposals_v1(text,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.seller_os_archive_rejected_proposals_v1(text,uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
