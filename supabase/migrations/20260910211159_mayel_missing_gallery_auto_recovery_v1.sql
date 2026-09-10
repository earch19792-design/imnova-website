begin;
-- Gallery hydration is read-only marketplace work, independent of a finished
-- proposal. Existing operational runtime owns this queue; no new worker.
create index if not exists mayel_missing_gallery_account_v1 on public.ebay_mayel_visual_tasks_v1(marketplace_account_key,created_at,id)
where nullif(selection_signal->'currentOfficialGallery','null'::jsonb) is null and status in ('PROMPT_READY','OUTPUTS_UPLOADED','MAYEL_REVIEW_PENDING','OWNER_PREVIEW_READY');
create function public.seller_os_pending_mayel_galleries_v1(p_account text)
returns table(id uuid,ebay_item_id text) language sql stable security invoker set search_path=public,pg_temp as $$
 select t.id,t.ebay_item_id from public.ebay_mayel_visual_tasks_v1 t where t.marketplace_account_key=p_account
 and t.status in ('PROMPT_READY','OUTPUTS_UPLOADED','MAYEL_REVIEW_PENDING','OWNER_PREVIEW_READY') and nullif(t.selection_signal->'currentOfficialGallery','null'::jsonb) is null
 and coalesce((t.selection_signal #>> '{galleryRecovery,nextAttemptAt}')::timestamptz,'-infinity')<=now()
 and coalesce((t.selection_signal #>> '{galleryRecovery,leaseUntil}')::timestamptz,'-infinity')<=now()
 order by t.created_at,t.id limit 1;
$$;
create function public.seller_os_defer_mayel_galleries_v1(p_account text,p_next timestamptz)
returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
declare changed integer;
begin
 if p_next is null or p_next<=now() then raise exception 'GALLERY_FUTURE_RETRY_REQUIRED'; end if;
 with due as (select id from public.ebay_mayel_visual_tasks_v1 where marketplace_account_key=p_account
 and status in ('PROMPT_READY','OUTPUTS_UPLOADED','MAYEL_REVIEW_PENDING','OWNER_PREVIEW_READY') and nullif(selection_signal->'currentOfficialGallery','null'::jsonb) is null
 and coalesce((selection_signal #>> '{galleryRecovery,nextAttemptAt}')::timestamptz,'-infinity')<p_next
 and coalesce((selection_signal #>> '{galleryRecovery,leaseUntil}')::timestamptz,'-infinity')<=now()
 order by created_at,id limit 50 for update skip locked)
 update public.ebay_mayel_visual_tasks_v1 t set selection_signal=coalesce(t.selection_signal,'{}')||jsonb_build_object('galleryRecovery',
 coalesce(t.selection_signal->'galleryRecovery','{}')||jsonb_build_object('state','WAITING_FOR_EBAY','nextAttemptAt',p_next,'reason','EBAY_QUOTA_HOLD'))
 from due where t.id=due.id;
 get diagnostics changed=row_count; return changed;
end $$;
create function public.seller_os_claim_mayel_gallery_v1(p_account text,p_task uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare t record; token uuid:=gen_random_uuid(); attempts integer;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('mayel-gallery:'||p_account,0)) then return null; end if;
 if exists(select 1 from public.ebay_mayel_visual_tasks_v1 where marketplace_account_key=p_account
 and nullif(selection_signal->'currentOfficialGallery','null'::jsonb) is null and status in ('PROMPT_READY','OUTPUTS_UPLOADED','MAYEL_REVIEW_PENDING','OWNER_PREVIEW_READY')
 and (selection_signal #>> '{galleryRecovery,leaseUntil}')::timestamptz>now()) then return null; end if;
 select id,ebay_item_id,selection_signal into t from public.ebay_mayel_visual_tasks_v1 where id=p_task and marketplace_account_key=p_account
 and status in ('PROMPT_READY','OUTPUTS_UPLOADED','MAYEL_REVIEW_PENDING','OWNER_PREVIEW_READY') and nullif(selection_signal->'currentOfficialGallery','null'::jsonb) is null
 and coalesce((selection_signal #>> '{galleryRecovery,nextAttemptAt}')::timestamptz,'-infinity')<=now() for update;
 if not found then return null; end if;
 attempts:=coalesce((t.selection_signal #>> '{galleryRecovery,attempts}')::integer,0)+1;
 update public.ebay_mayel_visual_tasks_v1 set selection_signal=coalesce(t.selection_signal,'{}')||jsonb_build_object('galleryRecovery',
 jsonb_build_object('state','RECOVERING','attempts',attempts,'leaseToken',token,'leaseUntil',now()+interval '5 minutes','nextAttemptAt',now()+interval '5 minutes')) where id=t.id;
 return jsonb_build_object('taskId',t.id,'itemId',t.ebay_item_id,'leaseToken',token,'attempt',attempts);
end $$;
create function public.seller_os_finish_mayel_gallery_v1(p_account text,p_task uuid,p_token uuid,p_gallery jsonb,p_next timestamptz,p_reason text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare t record; recovery jsonb;
begin
 select id,ebay_item_id,selection_signal into t from public.ebay_mayel_visual_tasks_v1 where id=p_task and marketplace_account_key=p_account for update;
 if not found or t.selection_signal #>> '{galleryRecovery,leaseToken}' is distinct from p_token::text
 or (t.selection_signal #>> '{galleryRecovery,leaseUntil}')::timestamptz<=now() then raise exception 'GALLERY_LEASE_CHANGED'; end if;
 if p_gallery is not null and (p_gallery->>'itemId' is distinct from t.ebay_item_id or p_gallery->>'authority' is distinct from 'CURRENT_OFFICIAL_ORDERED_IMAGE_SET'
 or jsonb_typeof(p_gallery->'images') is distinct from 'array' or jsonb_array_length(p_gallery->'images') not between 1 and 24
 or coalesce(p_gallery->>'digest','') !~ '^sha256:[a-f0-9]{64}$' or coalesce(p_gallery->>'ebaySku','')=''
 or exists(select 1 from jsonb_array_elements_text(p_gallery->'images') u where u !~ '^https://')
 or p_gallery->>'observedAt' is null or (p_gallery->>'observedAt')::timestamptz<now()-interval '5 minutes'
 or (p_gallery->>'observedAt')::timestamptz>now()+interval '1 minute') then raise exception 'GALLERY_OFFICIAL_BINDING_REQUIRED'; end if;
 if p_gallery is null and (p_next is null or p_next<=now()) then raise exception 'GALLERY_FUTURE_RETRY_REQUIRED'; end if;
 recovery:=((t.selection_signal->'galleryRecovery')-'leaseToken'-'leaseUntil')||jsonb_build_object('state',case when p_gallery is null then 'WAITING_FOR_EBAY' else 'COMPLETE' end,
 'nextAttemptAt',case when p_gallery is null then p_next end,'reason',p_reason,'completedAt',case when p_gallery is not null then now() end);
 -- Only observation metadata changes. Approved manifests, source provenance,
 -- QA, assets and historical evidence retain their original generation.
 update public.ebay_mayel_visual_tasks_v1 set selection_signal=coalesce(t.selection_signal,'{}')||jsonb_build_object('galleryRecovery',recovery)
 ||case when p_gallery is not null then jsonb_build_object('currentOfficialGallery',p_gallery) else '{}'::jsonb end where id=t.id;
 return jsonb_build_object('status',case when p_gallery is null then 'WAITING_FOR_DATA' else 'GALLERY_RECOVERED' end,'gallery',p_gallery,'marketplaceWrites',0);
end $$;
revoke all on function public.seller_os_pending_mayel_galleries_v1(text),public.seller_os_defer_mayel_galleries_v1(text,timestamptz),
 public.seller_os_claim_mayel_gallery_v1(text,uuid),public.seller_os_finish_mayel_gallery_v1(text,uuid,uuid,jsonb,timestamptz,text) from public,anon,authenticated;
grant execute on function public.seller_os_pending_mayel_galleries_v1(text),public.seller_os_defer_mayel_galleries_v1(text,timestamptz),
 public.seller_os_claim_mayel_gallery_v1(text,uuid),public.seller_os_finish_mayel_gallery_v1(text,uuid,uuid,jsonb,timestamptz,text) to service_role;
notify pgrst,'reload schema';
commit;
