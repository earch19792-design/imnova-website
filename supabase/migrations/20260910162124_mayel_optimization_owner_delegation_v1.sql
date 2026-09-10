begin;
create table public.seller_os_mayel_optimization_grants_v1 (
 id uuid primary key default gen_random_uuid(), account_key text not null,
 owner_user_id uuid not null references auth.users(id),
 contract_version text not null check(contract_version='MAYEL_AUTONOMOUS_LISTING_OPTIMIZATION_DELEGATION_V1'),
 scope text not null check(scope='FULL'), status text not null check(status in ('ACTIVE','REVOKED')),
 allowed_actions jsonb not null, authority_digest text not null check(authority_digest ~ '^sha256:[a-f0-9]{64}$'),
 owner_instruction jsonb not null, confirmed_at timestamptz not null default now(), revoked_at timestamptz,
 check ((status='ACTIVE' and revoked_at is null) or (status='REVOKED' and revoked_at is not null))
);
create unique index mayel_optimization_one_active_grant_v1 on public.seller_os_mayel_optimization_grants_v1(account_key) where status='ACTIVE';
alter table public.seller_os_mayel_optimization_grants_v1 enable row level security;
revoke all on public.seller_os_mayel_optimization_grants_v1 from public,anon,authenticated;
grant select,insert,update on public.seller_os_mayel_optimization_grants_v1 to service_role;

create function public.seller_os_visual_delegated_ready_v1(t public.ebay_mayel_visual_tasks_v1,p_grant_id text)
returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(t.status='OWNER_PREVIEW_READY'
 and t.selection_signal->>'productTruthSupported'='true'
 and t.selection_signal #>> '{currentOfficialGallery,authority}'='CURRENT_OFFICIAL_ORDERED_IMAGE_SET'
 and t.selection_signal #> '{currentOfficialGallery,images}'=t.current_image_set
 and t.visual_manifest->>'visualTaskId'=t.id::text and t.visual_manifest->>'ebayItemId'=t.ebay_item_id
 and t.visual_manifest->>'productTruthDigest'=t.product_truth_digest
 and t.visual_manifest->>'sourceImageSetDigest'=t.source_image_set_digest
 and t.visual_manifest->>'intentContract'='MAYEL_VISUAL_INTENT_V1'
 and jsonb_array_length(coalesce(t.visual_manifest->'visualIntents','[]')) between 1 and 6
 and jsonb_array_length(coalesce(t.source_image_references,'[]'))>0
 and not exists(select 1 from jsonb_array_elements(t.source_image_references) r
  where r->>'authority' is distinct from 'OFFICIAL_EBAY_CURRENT_LISTING_IMAGE'
  or r->>'referenceId' is distinct from 'EBAY_ITEM_'||t.ebay_item_id
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
create function public.seller_os_visual_outbox_individual_owner_ready_v1(o public.seller_os_ipad_outbox_v1)
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

create or replace function public.seller_os_visual_outbox_owner_ready_v1(o public.seller_os_ipad_outbox_v1)
returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select case when o.binding ? 'ownerDelegation' then exists (
 select 1 from public.ebay_mayel_visual_tasks_v1 t
 where t.id::text=o.intent #>> '{requestedChanges,taskId}' and t.marketplace_account_key=o.account_key
 and t.ebay_item_id=o.item_id and o.kind='IMAGE_SYNC'
 and t.visual_manifest_digest=o.intent #>> '{requestedChanges,manifestDigest}'
 and t.source_image_set_digest=o.binding->>'sourceImageSetDigest'
 and o.binding #>> '{ownerDelegation,manifestDigest}'=t.visual_manifest_digest
 and o.binding #>> '{ownerDelegation,authority}'='AUTO_AUTHORIZED_BY_OWNER_DELEGATION'
 and public.seller_os_visual_delegated_ready_v1(t,o.binding #>> '{ownerDelegation,grantId}')
 and jsonb_array_length(coalesce(o.binding->'assets','[]'))>0
 and not exists(select 1 from jsonb_array_elements(o.binding->'assets') b where not exists(
 select 1 from public.ebay_listing_image_assets a where a.id::text=b->>'assetId' and a.source_sha256=b->>'sourceSha256'
 and a.account_key=o.account_key and a.mayel_visual_task_id=t.id
 and exists(select 1 from jsonb_array_elements(t.visual_manifest->'proposedOrderedImages') e where e->>'assetId'=a.id::text))))
 else public.seller_os_visual_outbox_individual_owner_ready_v1(o) end;
$$;
create or replace function public.seller_os_pending_mayel_visual_manifests_v1(p_account_key text)
returns table(id uuid,ebay_item_id text,visual_manifest_id uuid,visual_manifest_digest text,updated_at timestamptz)
language sql stable security invoker set search_path=public,pg_temp as $$
 select t.id,t.ebay_item_id,t.visual_manifest_id,t.visual_manifest_digest,t.updated_at
 from public.ebay_mayel_visual_tasks_v1 t where t.marketplace_account_key=p_account_key
 and t.status='OWNER_PREVIEW_READY' and t.visual_manifest_id is not null and t.visual_manifest_digest is not null
 and not exists(select 1 from public.ebay_mayel_visual_phase_b_executions_v1 e where e.marketplace_account_key=t.marketplace_account_key
 and e.visual_task_id=t.id and e.visual_manifest_digest=t.visual_manifest_digest and e.phase='APPLIED_AND_OFFICIALLY_VERIFIED')
 and not exists(select 1 from public.seller_os_ipad_outbox_v1 o where o.account_key=t.marketplace_account_key
 and o.kind in ('IMAGE_DRAFT','IMAGE_SYNC','IMAGE_UPLOAD') and o.state<>'SUPERSEDED'
 and o.intent #>> '{requestedChanges,taskId}'=t.id::text
 and (o.kind='IMAGE_SYNC' and o.intent #>> '{requestedChanges,manifestDigest}'=t.visual_manifest_digest
 or o.dispatch_count>0 or not exists(select 1 from public.seller_os_mayel_optimization_grants_v1 d
 where d.account_key=p_account_key and d.status='ACTIVE' and d.revoked_at is null
 and public.seller_os_visual_delegated_ready_v1(t,d.id::text))))
 order by t.updated_at,t.id limit 3;
$$;
revoke all on function public.seller_os_visual_delegated_ready_v1(public.ebay_mayel_visual_tasks_v1,text),
 public.seller_os_visual_outbox_individual_owner_ready_v1(public.seller_os_ipad_outbox_v1) from public,anon,authenticated;
grant execute on function public.seller_os_visual_delegated_ready_v1(public.ebay_mayel_visual_tasks_v1,text),
 public.seller_os_visual_outbox_individual_owner_ready_v1(public.seller_os_ipad_outbox_v1) to service_role;
create function public.seller_os_grant_mayel_optimization_v1(p_account_key text,p_owner_user_id uuid,p_confirmation text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare material jsonb; result jsonb;
begin
 if p_confirmation is distinct from 'MAYEL_LISTING_OPTIMIZATION_DELEGATION=FULL'
 or not exists(select 1 from public.ebay_mayel_visual_delegation_authorities_v1 v where v.marketplace_account_key=p_account_key
 and v.owner_user_id=p_owner_user_id and v.status='ACTIVE' and v.revoked_at is null)
 or not exists(select 1 from public.ebay_mayel_commercial_optimization_delegation_authorities_v1 c where c.marketplace_account_key=p_account_key
 and c.owner_user_id=p_owner_user_id and c.status='ACTIVE' and c.revoked_at is null)
 then raise exception 'OWNER_OPTIMIZATION_DELEGATION_SCOPE_REQUIRED'; end if;
 material:=jsonb_build_object('ownerUserId',p_owner_user_id,'accountKey',p_account_key,'confirmation',p_confirmation,
 'contractVersion','MAYEL_AUTONOMOUS_LISTING_OPTIMIZATION_DELEGATION_V1','scope','LIVE_LISTINGS_ONLY',
 'excluded',jsonb_build_array('NEW_LISTING_PUBLICATION','EBAY_ADS_SPEND','PRICE','INVENTORY'),
 'guards',jsonb_build_array('EXACT_LISTING_IDENTITY','PRODUCT_TRUTH_PROVEN','CURRENT_LIVE_READBACK','BASE_GENERATION_COMPATIBLE','QA_PASS','NO_UNSUPPORTED_CLAIMS','NO_COMPETITOR_CONTAMINATION'));
 insert into public.seller_os_mayel_optimization_grants_v1(account_key,owner_user_id,contract_version,scope,status,allowed_actions,authority_digest,owner_instruction)
 values(p_account_key,p_owner_user_id,'MAYEL_AUTONOMOUS_LISTING_OPTIMIZATION_DELEGATION_V1','FULL','ACTIVE',
 '["MAIN_IMAGE_REPLACEMENT","SECONDARY_IMAGE_REPLACEMENT","IMAGE_ADDITION","IMAGE_REORDER","TITLE_OPTIMIZATION","DESCRIPTION_OPTIMIZATION","ITEM_SPECIFICS_OPTIMIZATION","KEYWORD_V2_1_OPTIMIZATION","LISTING_QUALITY_REMEDIATION"]',
 'sha256:'||encode(sha256(convert_to(material::text,'UTF8')),'hex'),material)
 on conflict(account_key) where status='ACTIVE' do nothing;
 select jsonb_build_object('id',id,'scope',scope,'status',status,'authorityDigest',authority_digest,'confirmedAt',confirmed_at)
 into result from public.seller_os_mayel_optimization_grants_v1 where account_key=p_account_key and owner_user_id=p_owner_user_id and status='ACTIVE';
 if result is null then raise exception 'OWNER_OPTIMIZATION_DELEGATION_CONFLICT'; end if;
 return result;
end $$;
create function public.guard_mayel_optimization_grant_immutable_v1() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if (to_jsonb(new)-'status'-'revoked_at') is distinct from (to_jsonb(old)-'status'-'revoked_at')
 or old.status='REVOKED' or new.status<>'REVOKED' or new.revoked_at is null
 then raise exception 'MAYEL_OPTIMIZATION_GRANT_IMMUTABLE'; end if;
 return new;
end $$;
create trigger guard_mayel_optimization_grant_immutable_v1 before update on public.seller_os_mayel_optimization_grants_v1
 for each row execute function public.guard_mayel_optimization_grant_immutable_v1();
revoke all on function public.seller_os_grant_mayel_optimization_v1(text,uuid,text),public.guard_mayel_optimization_grant_immutable_v1() from public,anon,authenticated;
grant execute on function public.seller_os_grant_mayel_optimization_v1(text,uuid,text),public.guard_mayel_optimization_grant_immutable_v1() to service_role;
notify pgrst,'reload schema';
commit;
