begin;
-- An OWNER approval for one use of an asset cannot authorize a different slot
-- or action. Existing history, assets and completed receipts remain untouched.
create function public.guard_mayel_visual_intent_owner_binding_v1() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.visual_manifest_digest is not distinct from old.visual_manifest_digest then return new; end if;
 if new.visual_manifest->>'intentContract'='MAYEL_VISUAL_INTENT_V1'
 or old.visual_manifest->>'intentContract'='MAYEL_VISUAL_INTENT_V1' then
  update public.ebay_listing_image_assets a set owner_sync_approval=null
  where a.mayel_visual_task_id=new.id and a.account_key=new.marketplace_account_key
    and a.owner_sync_approval is not null and (
     (select e from jsonb_array_elements(coalesce(old.visual_manifest->'proposedOrderedImages','[]')) e where e->>'assetId'=a.id::text limit 1)
       is distinct from
     (select e from jsonb_array_elements(coalesce(new.visual_manifest->'proposedOrderedImages','[]')) e where e->>'assetId'=a.id::text limit 1)
     or
     (select e from jsonb_array_elements(coalesce(old.visual_manifest->'visualIntents','[]')) e where e->>'assetId'=a.id::text limit 1)
       is distinct from
     (select e from jsonb_array_elements(coalesce(new.visual_manifest->'visualIntents','[]')) e where e->>'assetId'=a.id::text limit 1)
    );
 end if;
 return new;
end $$;
create trigger guard_mayel_visual_intent_owner_binding_v1 before update of visual_manifest_digest
 on public.ebay_mayel_visual_tasks_v1 for each row execute function public.guard_mayel_visual_intent_owner_binding_v1();
revoke all on function public.guard_mayel_visual_intent_owner_binding_v1() from public,anon,authenticated;
grant execute on function public.guard_mayel_visual_intent_owner_binding_v1() to service_role;
notify pgrst,'reload schema';
commit;
