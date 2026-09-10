begin;
-- Append-only OWNER scope extension. The original FULL grant is not rewritten.
create table public.seller_os_mayel_gallery_removal_grants_v1 (
 id uuid primary key default gen_random_uuid(), grant_id uuid not null references public.seller_os_mayel_optimization_grants_v1(id),
 account_key text not null, owner_user_id uuid not null references auth.users(id),
 owner_instruction jsonb not null, confirmed_at timestamptz not null default now(), revoked_at timestamptz,
 unique(grant_id)
);
create index mayel_gallery_removal_owner_v1 on public.seller_os_mayel_gallery_removal_grants_v1(owner_user_id);
alter table public.seller_os_mayel_gallery_removal_grants_v1 enable row level security;
revoke all on public.seller_os_mayel_gallery_removal_grants_v1 from public,anon,authenticated;
grant select,insert,update on public.seller_os_mayel_gallery_removal_grants_v1 to service_role;
create function public.guard_mayel_removal_grant_v1() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if (to_jsonb(new)-'revoked_at') is distinct from (to_jsonb(old)-'revoked_at') or old.revoked_at is not null or new.revoked_at is null
 then raise exception 'REMOVAL_GRANT_IMMUTABLE'; end if; return new;
end $$;
create trigger guard_mayel_removal_grant_v1 before update on public.seller_os_mayel_gallery_removal_grants_v1
 for each row execute function public.guard_mayel_removal_grant_v1();
create function public.seller_os_gallery_removal_granted_v1(p_grant uuid,p_account text) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select exists(select 1 from public.seller_os_mayel_gallery_removal_grants_v1 r
 join public.seller_os_mayel_optimization_grants_v1 g on g.id=r.grant_id and g.account_key=r.account_key and g.owner_user_id=r.owner_user_id
 where r.grant_id=p_grant and r.account_key=p_account and r.revoked_at is null and g.status='ACTIVE' and g.revoked_at is null);
$$;
-- All final positions, omissions and movements must be represented explicitly.
create function public.seller_os_full_gallery_shape_v1(m jsonb,current_images jsonb) returns boolean
language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare d jsonb; e jsonb; src integer; dst integer; seen_src integer[]:='{}'; seen_dst integer[]:='{}'; n integer; previous_src integer:=-1;
begin
 if m->>'galleryMutationContract' is distinct from 'MAYEL_FULL_GALLERY_MUTATION_V1' or jsonb_typeof(current_images) is distinct from 'array'
 or jsonb_typeof(m->'galleryDecisions') is distinct from 'array' or jsonb_typeof(m->'proposedOrderedImages') is distinct from 'array' then return false; end if;
 n:=jsonb_array_length(current_images);
 if n not between 1 and 24 or jsonb_array_length(m->'galleryDecisions') not between 1 and 48
 or jsonb_array_length(m->'proposedOrderedImages') not between 1 and 24
 or m->'currentOfficialImageSet' is distinct from current_images then return false; end if;
 for d in select value from jsonb_array_elements(m->'galleryDecisions') loop
  if coalesce(d->>'intentReason','')='' or coalesce(d->>'visualRole','')='' or coalesce(d->>'action','') not in ('KEEP','REPLACE','REMOVE','ADD','REORDER','REPLACE_MAIN') then return false; end if;
  src:=(d->>'sourcePosition')::integer; dst:=(d->>'targetPosition')::integer;
  if d->>'action'='ADD' then
   if src is not null then return false; end if;
  else
   if src is null or src<0 or src>=n or src=any(seen_src) or d->>'beforeImage' is distinct from current_images->>src then return false; end if;
   seen_src:=array_append(seen_src,src);
  end if;
  if d->>'action'='REMOVE' then
   if dst is not null or d->>'assetId' is not null or d #>> '{removalEvidence,productTruthDigest}' is distinct from m->>'productTruthDigest'
   or d #>> '{removalEvidence,noRequiredEvidenceLost}' is distinct from 'true' or d #>> '{removalEvidence,semanticQaPassed}' is distinct from 'true'
   or jsonb_array_length(coalesce(d #> '{removalEvidence,evidenceReferences}','[]'))<1 then return false; end if;
  else
   if dst is null or dst<0 or dst>=jsonb_array_length(m->'proposedOrderedImages') or dst=any(seen_dst) then return false; end if;
   seen_dst:=array_append(seen_dst,dst); e:=m->'proposedOrderedImages'->dst;
   if (e->>'position')::integer is distinct from dst or e->>'publicUrl' is distinct from d->>'afterImage' then return false; end if;
   if d->>'action' in ('KEEP','REORDER') then
    if d->>'assetId' is not null or e->>'assetId' is not null or e->>'publicUrl' is distinct from current_images->>src then return false; end if;
   elsif d->>'assetId' is null or e->>'assetId' is distinct from d->>'assetId' or e->>'outputSha256' is distinct from d->>'expectedSha256' then return false;
   end if;
   if d->>'action'='REPLACE_MAIN' and (src<>0 or dst<>0) then return false; end if;
  end if;
 end loop;
 if cardinality(seen_src)<>n or cardinality(seen_dst)<>jsonb_array_length(m->'proposedOrderedImages') then return false; end if;
 for d in select value from jsonb_array_elements(m->'galleryDecisions') where value->>'action' in ('KEEP','REPLACE','REPLACE_MAIN') order by (value->>'targetPosition')::integer loop
  src:=(d->>'sourcePosition')::integer;
  if src<previous_src then return false; end if; previous_src:=src;
 end loop;
 return true;
exception when others then return false;
end $$;
create function public.seller_os_full_gallery_authority_v1(t public.ebay_mayel_visual_tasks_v1,m jsonb,p_grant uuid)
returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(public.seller_os_full_gallery_shape_v1(m,t.current_image_set)
 and (t.selection_signal->>'productTruthSupported'='true' or public.seller_os_visual_current_product_truth_v1(t) is not null)
 and m->>'accountKey'=t.marketplace_account_key and m->>'visualTaskId'=t.id::text and m->>'ebayItemId'=t.ebay_item_id
 and m->>'productTruthDigest'=t.product_truth_digest and m->>'sourceImageSetDigest'=t.source_image_set_digest
 and not exists(select 1 from jsonb_array_elements(m->'galleryDecisions') d where d->>'action'='REMOVE' and
  (not public.seller_os_gallery_removal_granted_v1(p_grant,t.marketplace_account_key)
  or not exists(select 1 from jsonb_array_elements(t.source_image_references) removed_ref,
    jsonb_array_elements(t.source_image_references) kept_ref,
    jsonb_array_elements(m->'galleryDecisions') k
    where removed_ref->>'url'=d->>'beforeImage' and removed_ref->>'sha256' ~ '^[a-f0-9]{64}$'
    and kept_ref->>'sha256'=removed_ref->>'sha256' and kept_ref->>'url'=k->>'afterImage'
    and k->>'action' in ('KEEP','REORDER') and d #> '{removalEvidence,evidenceReferences}' ? (kept_ref->>'url'))))
 and exists(select 1 from public.seller_os_mayel_optimization_grants_v1 g where g.id=p_grant and g.account_key=t.marketplace_account_key
  and g.status='ACTIVE' and g.revoked_at is null and not exists(select 1 from jsonb_array_elements(m->'galleryDecisions') d
  where case d->>'action' when 'KEEP' then false when 'REMOVE' then not public.seller_os_gallery_removal_granted_v1(p_grant,t.marketplace_account_key)
   when 'REORDER' then not(g.allowed_actions ? 'IMAGE_REORDER') when 'ADD' then not(g.allowed_actions ? 'IMAGE_ADDITION')
   when 'REPLACE_MAIN' then not(g.allowed_actions ? 'MAIN_IMAGE_REPLACEMENT')
   when 'REPLACE' then not(g.allowed_actions ? case when d->>'sourcePosition'='0' then 'MAIN_IMAGE_REPLACEMENT' else 'SECONDARY_IMAGE_REPLACEMENT' end)
   else true end)),false);
$$;
create function public.seller_os_visual_delegated_before_full_gallery_v1(t public.ebay_mayel_visual_tasks_v1,p_grant_id text)
returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(t.status='OWNER_PREVIEW_READY'
 and (t.selection_signal->>'productTruthSupported'='true' or public.seller_os_visual_current_product_truth_v1(t) is not null)
 and t.selection_signal #>> '{currentOfficialGallery,authority}'='CURRENT_OFFICIAL_ORDERED_IMAGE_SET'
 and t.selection_signal #> '{currentOfficialGallery,images}'=t.current_image_set
 and t.visual_manifest->>'visualTaskId'=t.id::text and t.visual_manifest->>'ebayItemId'=t.ebay_item_id
 and t.visual_manifest->>'productTruthDigest'=t.product_truth_digest
 and t.visual_manifest->>'sourceImageSetDigest'=t.source_image_set_digest
 and t.visual_manifest->>'intentContract'='MAYEL_VISUAL_INTENT_V1'
 and jsonb_array_length(coalesce(t.visual_manifest->'visualIntents','[]')) between 1 and 6
 and jsonb_array_length(coalesce(t.source_image_references,'[]'))>0
 and not exists(select 1 from jsonb_array_elements(t.source_image_references) r
  where not coalesce((r->>'authority'='OFFICIAL_EBAY_CURRENT_LISTING_IMAGE' and r->>'referenceId'='EBAY_ITEM_'||t.ebay_item_id)
   or (r->>'authority' in ('AUTHORIZED_LUNA_SOURCE_PACK','APPROVED_CANONICAL_LISTING_ASSET','SAVED_AUTHORIZED_GENERATOR_SOURCE')
     and t.evidence_pack->'sourceImageSet'=t.source_image_references
     and t.evidence_pack->>'lunaProductId' ~ '^[0-9]+$' and t.evidence_pack->>'lunaVariantId' ~ '^[0-9]+$'),false)
  or coalesce(r->>'sha256','') !~ '^[a-f0-9]{64}$')
 and exists(select 1 from public.seller_os_mayel_optimization_grants_v1 d
  where d.id::text=p_grant_id and d.account_key=t.marketplace_account_key and d.status='ACTIVE' and d.revoked_at is null
  and d.scope='FULL' and d.contract_version='MAYEL_AUTONOMOUS_LISTING_OPTIMIZATION_DELEGATION_V1'
  and exists(select 1 from public.ebay_mayel_visual_delegation_authorities_v1 v where v.marketplace_account_key=d.account_key
   and v.owner_user_id=d.owner_user_id and v.status='ACTIVE' and v.revoked_at is null)
  and not exists(select 1 from jsonb_array_elements(t.visual_manifest->'visualIntents') i
   where not(d.allowed_actions ? case i->>'visualIntent' when 'REPLACE_MAIN' then 'MAIN_IMAGE_REPLACEMENT'
   when 'REPLACE_SLOT' then 'SECONDARY_IMAGE_REPLACEMENT' when 'ADD_SECONDARY' then 'IMAGE_ADDITION' else 'UNSUPPORTED' end)))
 and exists(select 1 from jsonb_array_elements(t.visual_manifest->'proposedOrderedImages') e where e->>'assetId' is not null)
 and not exists(select 1 from jsonb_array_elements(t.visual_manifest->'proposedOrderedImages') e
  where e->>'assetId' is not null and not exists(select 1 from public.ebay_listing_image_assets a
   where a.id::text=e->>'assetId' and a.account_key=t.marketplace_account_key and a.mayel_visual_task_id=t.id
   and a.status='approved' and a.mayel_approval_status='APPROVED' and a.output_sha256=e->>'outputSha256'
   and a.public_url=e->>'publicUrl' and a.source_image_set_digest=t.source_image_set_digest and a.product_truth_digest=t.product_truth_digest
   and a.qa_result->>'automaticStatus'='PASSED' and a.qa_result #>> '{humanReview,decision}'='APPROVE'
   and a.qa_result #>> '{humanReview,checks,productIdentityPreserved}'='true'
   and a.qa_result #>> '{humanReview,checks,noUnsupportedClaims}'='true'
   and a.qa_result #>> '{humanReview,checks,noInventedAccessories}'='true'
   and a.qa_result #>> '{humanReview,checks,noUnauthorizedText}'='true')),false);
$$;
create or replace function public.seller_os_visual_delegated_ready_v1(t public.ebay_mayel_visual_tasks_v1,p_grant_id text)
returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select public.seller_os_visual_delegated_before_full_gallery_v1(t,p_grant_id)
 and (t.visual_manifest->>'galleryMutationContract' is null or
 public.seller_os_full_gallery_authority_v1(t,t.visual_manifest,p_grant_id::uuid));
$$;
create function public.seller_os_content_grant_before_full_gallery_v1(p_account text,p_grant uuid,p_audit jsonb)
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
create or replace function public.seller_os_content_grant_ready_v1(p_account text,p_grant uuid,p_audit jsonb)
returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select case when p_audit #>> '{galleryMutation,galleryMutationContract}'='MAYEL_FULL_GALLERY_MUTATION_V1' then
 coalesce(p_audit #>> '{qa,pass}'='true' and p_audit #>> '{qa,unsupportedClaimCount}'='0' and p_audit #>> '{qa,competitorContaminationCount}'='0'
 and p_audit->'before'=p_audit->'after' and p_audit->'patch'='{}'::jsonb
 and p_audit #>> '{evidenceUsed,authority}'='CURRENT_OFFICIAL_ORDERED_IMAGE_SET'
 and p_audit #> '{galleryMutation,currentOfficialImageSet}'=p_audit->'beforeGallery'
 and (select jsonb_agg(e->'publicUrl' order by (e->>'position')::integer) from jsonb_array_elements(p_audit #> '{galleryMutation,proposedOrderedImages}') e)=p_audit->'afterGallery'
 and not exists(select 1 from jsonb_array_elements(p_audit #> '{galleryMutation,galleryDecisions}') d where d->>'action' not in ('KEEP','REMOVE','REORDER'))
 and exists(select 1 from public.ebay_mayel_visual_tasks_v1 t where t.id::text=p_audit #>> '{proof,taskId}' and t.marketplace_account_key=p_account
 and public.seller_os_full_gallery_authority_v1(t,p_audit->'galleryMutation',p_grant)),false)
 else public.seller_os_content_grant_before_full_gallery_v1(p_account,p_grant,p_audit) end;
$$;
insert into public.seller_os_mayel_gallery_removal_grants_v1(grant_id,account_key,owner_user_id,owner_instruction)
select id,account_key,owner_user_id,jsonb_build_object('contract','MAYEL_FULL_EBAY_GALLERY_MUTATION_CONTROL_V1',
 'authorizedAction','IMAGE_REMOVAL','productTruthRequired',true,'semanticQaRequired',true,'noRequiredProductEvidenceLoss',true,
 'publicationAuthorized',false,'adsAuthorized',false)
from public.seller_os_mayel_optimization_grants_v1 g where account_key='imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12'
 and status='ACTIVE' and revoked_at is null and exists(select 1 from public.ebay_mayel_visual_delegation_authorities_v1 v
 where v.marketplace_account_key=g.account_key and v.owner_user_id=g.owner_user_id and v.status='ACTIVE' and v.revoked_at is null)
on conflict(grant_id) do nothing;
revoke all on function public.guard_mayel_removal_grant_v1() from public,anon,authenticated;
grant execute on function public.guard_mayel_removal_grant_v1() to service_role;
revoke all on function public.seller_os_gallery_removal_granted_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.seller_os_gallery_removal_granted_v1(uuid,text) to service_role;
revoke all on function public.seller_os_full_gallery_shape_v1(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.seller_os_full_gallery_shape_v1(jsonb,jsonb) to service_role;
revoke all on function public.seller_os_full_gallery_authority_v1(public.ebay_mayel_visual_tasks_v1,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.seller_os_full_gallery_authority_v1(public.ebay_mayel_visual_tasks_v1,jsonb,uuid) to service_role;
revoke all on function public.seller_os_visual_delegated_before_full_gallery_v1(public.ebay_mayel_visual_tasks_v1,text) from public,anon,authenticated;
grant execute on function public.seller_os_visual_delegated_before_full_gallery_v1(public.ebay_mayel_visual_tasks_v1,text) to service_role;
revoke all on function public.seller_os_content_grant_before_full_gallery_v1(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.seller_os_content_grant_before_full_gallery_v1(text,uuid,jsonb) to service_role;
revoke all on function public.seller_os_visual_delegated_ready_v1(public.ebay_mayel_visual_tasks_v1,text) from public,anon,authenticated;
grant execute on function public.seller_os_visual_delegated_ready_v1(public.ebay_mayel_visual_tasks_v1,text) to service_role;
revoke all on function public.seller_os_content_grant_ready_v1(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.seller_os_content_grant_ready_v1(text,uuid,jsonb) to service_role;
create or replace function public.seller_os_pending_mayel_visual_manifests_v1(p_account_key text)
returns table(id uuid,ebay_item_id text,visual_manifest_id uuid,visual_manifest_digest text,updated_at timestamptz)
language sql stable security invoker set search_path=public,pg_temp as $$
 select t.id,t.ebay_item_id,t.visual_manifest_id,t.visual_manifest_digest,t.updated_at
 from public.ebay_mayel_visual_tasks_v1 t where t.marketplace_account_key=p_account_key
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
