begin;
alter table public.seller_os_ipad_outbox_v1 drop constraint seller_os_ipad_outbox_v1_kind_check;
alter table public.seller_os_ipad_outbox_v1 add constraint seller_os_ipad_outbox_v1_kind_check
 check(kind in ('IMAGE_DRAFT','IMAGE_SYNC','IMAGE_UPLOAD','ADS_POLICY','LISTING_DRAFT'));
drop index public.seller_os_ipad_outbox_task_v1;
create index seller_os_ipad_outbox_task_v1 on public.seller_os_ipad_outbox_v1(account_key,(intent #>> '{requestedChanges,taskId}'))
 where kind in ('IMAGE_DRAFT','IMAGE_SYNC','IMAGE_UPLOAD') and state <> 'SUPERSEDED';
-- Private transport parts. No anon/authenticated storage policies are added.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('seller-os-ipad-image-parts-v1','seller-os-ipad-image-parts-v1',false,1048576,array['application/octet-stream']);
create or replace function public.seller_os_put_ipad_outbox_v1(p_account_key text,p_actor_user_id uuid,p_intent jsonb,p_hash text,p_binding jsonb)
returns public.seller_os_ipad_outbox_v1 language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_row public.seller_os_ipad_outbox_v1;
begin
 insert into public.seller_os_ipad_outbox_v1(account_key,actor_user_id,item_id,kind,idempotency_key,payload_hash,intent,binding,state,reason_code)
 values(p_account_key,p_actor_user_id,p_intent->>'itemId',p_intent->>'kind',p_intent->>'idempotencyKey',p_hash,p_intent,p_binding,
 case when p_intent->>'kind' in ('IMAGE_DRAFT','IMAGE_SYNC','IMAGE_UPLOAD') then 'PENDING_EBAY_SYNC' else 'DRAFT' end,
 case when p_intent->>'kind' in ('IMAGE_DRAFT','IMAGE_SYNC','IMAGE_UPLOAD') then 'REVALIDATION_REQUIRED' else 'DRAFT_IS_NOT_WRITE_AUTHORITY' end)
 on conflict(account_key,actor_user_id,idempotency_key) do nothing;
 select * into strict v_row from public.seller_os_ipad_outbox_v1 where account_key=p_account_key and actor_user_id=p_actor_user_id and idempotency_key=p_intent->>'idempotencyKey';
 if v_row.payload_hash is distinct from p_hash then raise exception 'OUTBOX_IDEMPOTENCY_PAYLOAD_CONFLICT'; end if;
 return v_row;
end $$;
create or replace function public.seller_os_pending_mayel_visual_manifests_v1(p_account_key text)
returns table(id uuid,ebay_item_id text,visual_manifest_id uuid,visual_manifest_digest text,updated_at timestamptz)
language sql stable security invoker set search_path=public,pg_temp as $$
 select t.id,t.ebay_item_id,t.visual_manifest_id,t.visual_manifest_digest,t.updated_at
 from public.ebay_mayel_visual_tasks_v1 t where t.marketplace_account_key=p_account_key
 and t.status='OWNER_PREVIEW_READY' and t.visual_manifest_id is not null and t.visual_manifest_digest is not null
 and not exists(select 1 from public.ebay_mayel_visual_phase_b_executions_v1 e where e.marketplace_account_key=t.marketplace_account_key
 and e.visual_task_id=t.id and e.visual_manifest_digest=t.visual_manifest_digest and e.phase='APPLIED_AND_OFFICIALLY_VERIFIED')
 and not exists(select 1 from public.seller_os_ipad_outbox_v1 o where o.account_key=t.marketplace_account_key
 and o.kind in ('IMAGE_DRAFT','IMAGE_SYNC','IMAGE_UPLOAD') and o.state<>'SUPERSEDED' and o.intent #>> '{requestedChanges,taskId}'=t.id::text)
 order by t.updated_at,t.id limit 3;
$$;
create or replace function public.enforce_ebay_listing_image_account_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_package_account_key text;
  v_requested_account_key text;
  v_task_package_id uuid;
  v_task_candidate_key text;
  v_task_opportunity_id uuid;
begin
  if new.mayel_visual_task_id is not null then
    select task.marketplace_account_key, task.listing_package_id,
      task.candidate_key, task.opportunity_id
    into v_package_account_key, v_task_package_id,
      v_task_candidate_key, v_task_opportunity_id
    from public.ebay_mayel_visual_tasks_v1 task
    join public.ebay_listing_packages package_row
      on package_row.id = task.listing_package_id
      and package_row.account_key = task.marketplace_account_key
    where task.id = new.mayel_visual_task_id
    for key share of task, package_row;

    -- A saved generator proposal may belong to a task without a publishable
    -- Listing Package. Only its exact durable origin grants draft admission.
    if v_package_account_key is null and new.source_type = 'SELLER_OS_ASSISTANT_IMAGE_VARIANT' then
      select task.marketplace_account_key, task.listing_package_id,
        task.candidate_key, task.opportunity_id
      into v_package_account_key, v_task_package_id, v_task_candidate_key, v_task_opportunity_id
      from public.ebay_mayel_visual_tasks_v1 task
      where task.id = new.mayel_visual_task_id and task.listing_package_id is null
        and task.assigned_operator_user_id = new.uploaded_by
        and task.status in ('PROMPT_READY','OUTPUTS_UPLOADED','MAYEL_REVIEW_PENDING','OWNER_PREVIEW_READY')
        and task.source_image_set_digest = new.source_image_set_digest
        and task.product_truth_digest = new.product_truth_digest
        and exists (
          select 1 from public.ebay_listing_experiments_v1 experiment
          cross join lateral jsonb_array_elements(case
            when jsonb_typeof(experiment.baseline_evidence_ref #> '{sellerOsVisualVariant,variants}')='array'
            then experiment.baseline_evidence_ref #> '{sellerOsVisualVariant,variants}' else '[]'::jsonb end) variant
          where experiment.account_key = task.marketplace_account_key
            and experiment.marketplace = 'EBAY_US' and experiment.ebay_item_id = task.ebay_item_id
            and experiment.experiment_type = 'HERO_VISUAL_VARIANT' and experiment.lifecycle_status in ('DRAFT','READY')
            and experiment.experiment_id::text = new.provenance #>> '{generatedOrigin,experimentId}'
            and variant->>'assetId' = new.id::text and variant->>'outputSha256' = new.source_sha256
            and variant->>'outputStoragePath' = new.provenance #>> '{generatedOrigin,outputStoragePath}'
            and variant->>'status' = 'EXPERIMENT_READY' and variant->>'variantRejected' = 'false'
            and variant->>'productTruthPreserved' = 'true' and variant->>'protectedLayerRoundtripExact' = 'true'
            and variant->>'sourceImageFullResolutionCertified' = 'true' and variant #>> '{backgroundQa,passed}' = 'true'
            and exists (select 1 from jsonb_array_elements_text(task.current_image_set) image_url
              where public.seller_os_same_ebay_image_source_v1(image_url,
                experiment.baseline_evidence_ref #>> '{sellerOsVisualVariant,sourceImageUrl}'))
        )
      for share of task;
    end if;

    -- Existing manual ChatGPT workflow, scoped to the assigned operator and
    -- exact authorized task references even when no Listing Package exists.
    if v_package_account_key is null and new.source_type = 'CHATGPT_SUBSCRIPTION_MAYEL' then
      select task.marketplace_account_key, task.listing_package_id,
        task.candidate_key, task.opportunity_id
      into v_package_account_key, v_task_package_id, v_task_candidate_key, v_task_opportunity_id
      from public.ebay_mayel_visual_tasks_v1 task
      where task.id = new.mayel_visual_task_id and task.listing_package_id is null
        and task.assigned_operator_user_id = new.uploaded_by
        and task.status in ('PROMPT_READY','OUTPUTS_UPLOADED','MAYEL_REVIEW_PENDING','OWNER_PREVIEW_READY')
        and task.source_image_set_digest = new.source_image_set_digest
        and task.product_truth_digest = new.product_truth_digest
        and task.source_image_references = new.source_image_references
        and jsonb_array_length(task.source_image_references) > 0
        and new.source_sha256 ~ '^[a-f0-9]{64}$'
        and new.source_kind = 'owned_upload' and new.rights_basis = 'owned'
        and new.rights_evidence_confirmed is true
        and new.authorization_reference = 'MAYEL_CHATGPT_SUBSCRIPTION:' || task.id::text
        and new.transformation_version = 'MAYEL_CHATGPT_OUTPUT_NORMALIZATION_V1'
        and new.qa_result->>'automaticStatus' = 'PASSED'
      for share of task;
    end if;

    if v_package_account_key is null
      or v_package_account_key = 'default'
      or v_package_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
      or new.listing_package_id is not null
      or new.candidate_key is distinct from v_task_candidate_key
      or new.opportunity_id is distinct from v_task_opportunity_id then
      raise exception 'EBAY_IMAGE_MAYEL_TASK_SCOPE_MISMATCH';
    end if;
  else
    select package_row.account_key
    into v_package_account_key
    from public.ebay_listing_packages package_row
    where package_row.id = new.listing_package_id
    for key share;

    if v_package_account_key is null
      or v_package_account_key = 'default'
      or v_package_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$' then
      raise exception 'EBAY_IMAGE_PACKAGE_ACCOUNT_SCOPE_REQUIRED';
    end if;
  end if;

  v_requested_account_key := nullif(
    current_setting('app.ebay_seller_account_key', true),
    ''
  );
  new.account_key := coalesce(new.account_key, v_requested_account_key);

  if new.account_key is null
    or new.account_key = 'default'
    or new.account_key is distinct from v_package_account_key
    or (
      tg_op = 'UPDATE'
      and (
        new.account_key is distinct from old.account_key
        or new.listing_package_id is distinct from old.listing_package_id
        or new.mayel_visual_task_id is distinct from old.mayel_visual_task_id
        or new.candidate_key is distinct from old.candidate_key
        or new.opportunity_id is distinct from old.opportunity_id
      )
    ) then
    raise exception 'EBAY_IMAGE_ACCOUNT_SCOPE_MISMATCH';
  end if;

  return new;
end;
$$;
notify pgrst,'reload schema';
commit;
