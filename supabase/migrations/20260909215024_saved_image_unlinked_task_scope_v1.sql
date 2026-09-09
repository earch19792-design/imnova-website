-- Fix saved-image draft admission only. Keep normal package-scoped assets and
-- all publication/QA guards unchanged. No marketplace operation occurs here.
begin;
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


create or replace function public.guard_mayel_unused_task_assignment_v1()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if old.assigned_operator_user_id is distinct from new.assigned_operator_user_id and (
    old.status <> 'PROMPT_READY' or old.visual_manifest_digest is not null
    or exists(select 1 from public.ebay_listing_image_assets where mayel_visual_task_id=old.id)
    or exists(select 1 from public.ebay_mayel_visual_phase_b_executions_v1 where visual_task_id=old.id)
  ) then raise exception 'MAYEL_TASK_ASSIGNMENT_ACTIVE_WORK_CONFLICT'; end if;
  return new;
end;
$$;
drop trigger if exists guard_mayel_unused_task_assignment_v1 on public.ebay_mayel_visual_tasks_v1;
create trigger guard_mayel_unused_task_assignment_v1 before update of assigned_operator_user_id
on public.ebay_mayel_visual_tasks_v1 for each row execute function public.guard_mayel_unused_task_assignment_v1();
revoke all on function public.guard_mayel_unused_task_assignment_v1() from public, anon, authenticated;
grant execute on function public.guard_mayel_unused_task_assignment_v1() to service_role;
notify pgrst, 'reload schema';
commit;
