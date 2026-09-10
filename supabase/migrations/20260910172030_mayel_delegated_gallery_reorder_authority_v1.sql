begin;
create index seller_os_content_task_binding_v1 on public.seller_os_mayel_content_outbox_v1(task_id);
create index seller_os_content_grant_binding_v1 on public.seller_os_mayel_content_outbox_v1(grant_id);
create or replace function public.seller_os_content_grant_ready_v1(p_account text,p_grant uuid,p_audit jsonb)
returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(exists(select 1 from public.seller_os_mayel_optimization_grants_v1 g
 where g.id=p_grant and g.account_key=p_account and g.status='ACTIVE' and g.revoked_at is null
 and g.scope='FULL' and g.contract_version='MAYEL_AUTONOMOUS_LISTING_OPTIMIZATION_DELEGATION_V1'
 and p_audit #>> '{qa,pass}'='true' and p_audit #>> '{qa,unsupportedClaimCount}'='0'
 and p_audit #>> '{qa,competitorContaminationCount}'='0'
 and jsonb_array_length(p_audit->'actions') between 1 and 3
 and not exists(select 1 from jsonb_array_elements_text(p_audit->'actions') a
 where a not in ('TITLE_OPTIMIZATION','DESCRIPTION_OPTIMIZATION','ITEM_SPECIFICS_OPTIMIZATION','IMAGE_REORDER') or not(g.allowed_actions ? a))
 and ((not(p_audit->'actions' ? 'IMAGE_REORDER')
   and p_audit #>> '{evidenceUsed,keyword,STATUS}'='ACCEPTED'
   and p_audit #>> '{evidenceUsed,keyword,DECISION_VERSION}'='PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V2_1'
   and p_audit #>> '{evidenceUsed,keyword,LEGACY_FALLBACK_USED}'='false')
 or (p_audit->'actions'='["IMAGE_REORDER"]'::jsonb
   and p_audit #>> '{evidenceUsed,authority}'='CURRENT_OFFICIAL_ORDERED_IMAGE_SET'
   and jsonb_typeof(p_audit->'beforeGallery')='array' and jsonb_typeof(p_audit->'afterGallery')='array'
   and jsonb_array_length(p_audit->'beforeGallery') between 1 and 24
   and jsonb_array_length(p_audit->'beforeGallery')=jsonb_array_length(p_audit->'afterGallery')
   and (select jsonb_agg(u order by u) from jsonb_array_elements_text(p_audit->'beforeGallery') u)=
       (select jsonb_agg(u order by u) from jsonb_array_elements_text(p_audit->'afterGallery') u)
   and p_audit->'before'=p_audit->'after' and p_audit->'patch'='{}'::jsonb))),false);
$$;
revoke all on function public.seller_os_content_grant_ready_v1(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.seller_os_content_grant_ready_v1(text,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
