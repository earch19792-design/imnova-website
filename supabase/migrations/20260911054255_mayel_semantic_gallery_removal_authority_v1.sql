begin;
-- Semantic QA receipts use the existing assigned reviewer authority. They do not
-- grant OWNER approval or write authority. No scheduler or worker is added.
create table public.seller_os_mayel_removal_reviews_v1 (
 id uuid primary key default gen_random_uuid(), account_key text not null,
 task_id uuid not null references public.ebay_mayel_visual_tasks_v1(id), item_id text not null,
 reviewer_id uuid not null references auth.users(id), product_truth_digest text not null,
 source_image_set_digest text not null, base_manifest_digest text not null,
 current_images jsonb not null, final_images jsonb not null, source_position integer not null,
 reason text not null, evidence_references jsonb not null, checks jsonb not null,
 explanation text not null, review_key text not null, reviewed_at timestamptz not null default now(),
 revoked_at timestamptz, unique(task_id,review_key)
);
create index mayel_removal_reviews_account_task_v1 on public.seller_os_mayel_removal_reviews_v1(account_key,task_id);
create index mayel_removal_reviews_reviewer_v1 on public.seller_os_mayel_removal_reviews_v1(reviewer_id);
alter table public.seller_os_mayel_removal_reviews_v1 enable row level security;
revoke all on public.seller_os_mayel_removal_reviews_v1 from public,anon,authenticated;
grant select,insert on public.seller_os_mayel_removal_reviews_v1 to service_role;
grant update(revoked_at) on public.seller_os_mayel_removal_reviews_v1 to service_role;
create trigger mayel_removal_review_immutable_v1 before update on public.seller_os_mayel_removal_reviews_v1
 for each row execute function public.guard_mayel_removal_grant_v1();

create function public.seller_os_removal_checks_pass_v1(c jsonb) returns boolean
language sql immutable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_typeof(c)='object' and not exists(select 1 from unnest(array[
 'exactListingIdentity','productTruthPreserved','semanticQaPass','removalReasonProven',
 'requiredProductInformationNotLost','finalGalleryRemainsValid']) k where c->k is distinct from 'true'::jsonb)
 and c->'identityDrift'='false'::jsonb and c->'productUncertainty'='false'::jsonb
 and c->'unsupportedClaimCount'='0'::jsonb and c->'competitorContaminationCount'='0'::jsonb,false);
$$;
create function public.seller_os_record_removal_review_v1(p_account text,p_actor uuid,p_task uuid,p_review jsonb)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare t public.ebay_mayel_visual_tasks_v1%rowtype; result uuid; src integer; n integer; key text;
begin
 select * into t from public.ebay_mayel_visual_tasks_v1 where id=p_task and marketplace_account_key=p_account
 and assigned_operator_user_id=p_actor and status in ('MAYEL_REVIEW_PENDING','OWNER_PREVIEW_READY') for update;
 if not found then raise exception 'EXACT_VISUAL_TASK_REQUIRED'; end if;
 if octet_length(p_review::text)>64000 then raise exception 'REMOVAL_REVIEW_BOUND_EXCEEDED'; end if;
 if not exists(select 1 from public.seller_os_mayel_optimization_grants_v1 g
 where g.account_key=p_account and g.scope='FULL' and g.status='ACTIVE' and g.revoked_at is null
 and g.contract_version='MAYEL_AUTONOMOUS_LISTING_OPTIMIZATION_DELEGATION_V1'
 and public.seller_os_gallery_removal_granted_v1(g.id,p_account)
 and exists(select 1 from public.ebay_mayel_visual_delegation_authorities_v1 v
 where v.marketplace_account_key=g.account_key and v.owner_user_id=g.owner_user_id and v.status='ACTIVE' and v.revoked_at is null))
 then raise exception 'ACTIVE_REMOVAL_DELEGATION_REQUIRED'; end if;
 if not coalesce(t.selection_signal->>'productTruthSupported'='true' or public.seller_os_visual_current_product_truth_v1(t) is not null,false)
 then raise exception 'PRODUCT_TRUTH_REQUIRED'; end if;
 src:=(p_review->>'sourcePosition')::integer;
 n:=jsonb_array_length(t.current_image_set);
 if p_review->>'contract' is distinct from 'MAYEL_SEMANTIC_REMOVAL_REVIEW_V1'
 or p_review->>'itemId' is distinct from t.ebay_item_id
 or p_review->>'productTruthDigest' is distinct from t.product_truth_digest
 or p_review->>'sourceImageSetDigest' is distinct from t.source_image_set_digest
 or p_review->>'baseManifestDigest' is distinct from t.visual_manifest_digest
 or t.visual_manifest_digest is null
 or t.selection_signal #>> '{currentOfficialGallery,authority}' is distinct from 'CURRENT_OFFICIAL_ORDERED_IMAGE_SET'
 or p_review->'currentImages' is distinct from t.current_image_set
 or p_review->'currentImages' is distinct from t.selection_signal #> '{currentOfficialGallery,images}'
 or n not between 1 and 24 or src is null or src<0 or src>=n
 or coalesce(p_review->>'reason','') not in ('LOW_QUALITY','REDUNDANT','MISLEADING','OBSOLETE','WEAK_CONVERSION_VALUE','VISUAL_DUPLICATE','REPLACED_BY_BETTER_AUTHORIZED_ASSET')
 or not public.seller_os_removal_checks_pass_v1(p_review->'checks')
 or length(trim(coalesce(p_review->>'explanation',''))) not between 20 and 4000
 or jsonb_typeof(p_review->'finalImages') is distinct from 'array'
 or jsonb_array_length(p_review->'finalImages') not between 1 and 24
 or p_review->'finalImages' ? (t.current_image_set->>src)
 or jsonb_typeof(p_review->'evidenceReferences') is distinct from 'array'
 or jsonb_array_length(p_review->'evidenceReferences') not between 1 and 24
 then raise exception 'REMOVAL_SEMANTIC_REVIEW_INVALID'; end if;
 -- Both the removed image and retained evidence must actually be inspected.
 if not(p_review->'evidenceReferences' ? (t.current_image_set->>src))
 or not exists(select 1 from jsonb_array_elements_text(p_review->'finalImages') u where p_review->'evidenceReferences' ? u)
 or exists(select 1 from jsonb_array_elements_text(p_review->'finalImages') u group by u having count(*)>1)
 then raise exception 'REMOVAL_EVIDENCE_REFERENCES_REQUIRED'; end if;
 -- A review cannot launder a foreign or QA-rejected proposed image.
 if exists(select 1 from (select value as url from jsonb_array_elements_text(p_review->'finalImages')
 union select value from jsonb_array_elements_text(p_review->'evidenceReferences')) urls
 where url !~ '^https://' or not(t.current_image_set ? url) and not exists(
 select 1 from public.ebay_listing_image_assets a where a.account_key=p_account and a.mayel_visual_task_id=p_task
 and a.public_url=url and a.status='approved' and a.mayel_approval_status='APPROVED'
 and a.product_truth_digest=t.product_truth_digest and a.source_image_set_digest=t.source_image_set_digest
 and a.qa_result->>'automaticStatus'='PASSED' and a.qa_result #>> '{humanReview,decision}'='APPROVE'
 and public.seller_os_visual_semantic_checks_pass_v1(a.qa_result #> '{humanReview,checks}',a.mayel_output_role)
 and not coalesce(t.selection_signal->'discardedVisualAssetIds' ? a.id::text,false)))
 then raise exception 'REMOVAL_UNAUTHORIZED_IMAGE_EVIDENCE'; end if;
 -- MD5 is only a database replay key, never an evidence/content identity.
 key:=md5(p_review::text);
 insert into public.seller_os_mayel_removal_reviews_v1(account_key,task_id,item_id,reviewer_id,
 product_truth_digest,source_image_set_digest,base_manifest_digest,current_images,final_images,
 source_position,reason,evidence_references,checks,explanation,review_key)
 values(p_account,p_task,t.ebay_item_id,p_actor,t.product_truth_digest,t.source_image_set_digest,t.visual_manifest_digest,
 p_review->'currentImages',p_review->'finalImages',src,p_review->>'reason',p_review->'evidenceReferences',p_review->'checks',p_review->>'explanation',key)
 on conflict(task_id,review_key) do nothing returning id into result;
 if result is null then select id into result from public.seller_os_mayel_removal_reviews_v1 where task_id=p_task and review_key=key and revoked_at is null; end if;
 if result is null then raise exception 'REMOVAL_REVIEW_REVOKED'; end if;
 return result;
end $$;

create function public.seller_os_removal_evidence_pass_v1(t public.ebay_mayel_visual_tasks_v1,m jsonb,d jsonb)
returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(case when d #>> '{removalEvidence,reviewId}' is not null then exists(
 select 1 from public.seller_os_mayel_removal_reviews_v1 r
 where r.id::text=d #>> '{removalEvidence,reviewId}' and r.revoked_at is null
 and r.account_key=t.marketplace_account_key and r.task_id=t.id and r.item_id=t.ebay_item_id
 and r.product_truth_digest=t.product_truth_digest and r.source_image_set_digest=t.source_image_set_digest
 and r.base_manifest_digest=d #>> '{removalEvidence,baseManifestDigest}'
 and r.current_images=m->'currentOfficialImageSet'
 and r.final_images=(select jsonb_agg(e->'publicUrl' order by (e->>'position')::integer) from jsonb_array_elements(m->'proposedOrderedImages') e)
 and r.source_position=(d->>'sourcePosition')::integer and r.reason=d #>> '{removalEvidence,reason}'
 and r.evidence_references=d #> '{removalEvidence,evidenceReferences}'
 and public.seller_os_removal_checks_pass_v1(r.checks))
 else exists(select 1 from jsonb_array_elements(t.source_image_references) removed_ref,
 jsonb_array_elements(t.source_image_references) kept_ref,jsonb_array_elements(m->'galleryDecisions') k
 where removed_ref->>'url'=d->>'beforeImage' and removed_ref->>'sha256' ~ '^[a-f0-9]{64}$'
 and kept_ref->>'sha256'=removed_ref->>'sha256' and kept_ref->>'url'=k->>'afterImage'
 and k->>'action' in ('KEEP','REORDER') and d #> '{removalEvidence,evidenceReferences}' ? (kept_ref->>'url')) end,false);
$$;
create or replace function public.seller_os_full_gallery_authority_v1(t public.ebay_mayel_visual_tasks_v1,m jsonb,p_grant uuid)
returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(public.seller_os_full_gallery_shape_v1(m,t.current_image_set)
 and (t.selection_signal->>'productTruthSupported'='true' or public.seller_os_visual_current_product_truth_v1(t) is not null)
 and m->>'accountKey'=t.marketplace_account_key and m->>'visualTaskId'=t.id::text and m->>'ebayItemId'=t.ebay_item_id
 and m->>'productTruthDigest'=t.product_truth_digest and m->>'sourceImageSetDigest'=t.source_image_set_digest
 and not exists(select 1 from jsonb_array_elements(m->'galleryDecisions') d where d->>'action'='REMOVE' and
  (not public.seller_os_gallery_removal_granted_v1(p_grant,t.marketplace_account_key)
  or not public.seller_os_removal_evidence_pass_v1(t,m,d)))
 and exists(select 1 from public.seller_os_mayel_optimization_grants_v1 g where g.id=p_grant and g.account_key=t.marketplace_account_key
  and g.status='ACTIVE' and g.revoked_at is null and not exists(select 1 from jsonb_array_elements(m->'galleryDecisions') d
  where case d->>'action' when 'KEEP' then false when 'REMOVE' then not public.seller_os_gallery_removal_granted_v1(p_grant,t.marketplace_account_key)
   when 'REORDER' then not(g.allowed_actions ? 'IMAGE_REORDER') when 'ADD' then not(g.allowed_actions ? 'IMAGE_ADDITION')
   when 'REPLACE_MAIN' then not(g.allowed_actions ? 'MAIN_IMAGE_REPLACEMENT')
   when 'REPLACE' then not(g.allowed_actions ? case when d->>'sourcePosition'='0' then 'MAIN_IMAGE_REPLACEMENT' else 'SECONDARY_IMAGE_REPLACEMENT' end)
   else true end)),false);
$$;
revoke all on function public.seller_os_removal_checks_pass_v1(jsonb) from public,anon,authenticated;
grant execute on function public.seller_os_removal_checks_pass_v1(jsonb) to service_role;
revoke all on function public.seller_os_record_removal_review_v1(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.seller_os_record_removal_review_v1(text,uuid,uuid,jsonb) to service_role;
revoke all on function public.seller_os_removal_evidence_pass_v1(public.ebay_mayel_visual_tasks_v1,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.seller_os_removal_evidence_pass_v1(public.ebay_mayel_visual_tasks_v1,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
