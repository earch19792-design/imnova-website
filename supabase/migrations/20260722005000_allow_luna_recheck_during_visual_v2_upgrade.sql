-- Luna source freshness is independent from image-set approval. A historical
-- six-image control may be reconfirmed only to reopen Seller OS for the V2
-- correction; publication still requires the separate exact-seven PASSED gate.

create or replace function public.is_ebay_approved_visual_v2_revision_set(
  p_account_key text,
  p_actor uuid,
  p_listing_package_id uuid,
  p_candidate_id uuid,
  p_run_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.ebay_listing_packages package
    join public.ebay_same_day_pilot_image_revisions revision
      on revision.id = case
        when coalesce(package.package_data->>'preferredImageRevisionId', '')
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (package.package_data->>'preferredImageRevisionId')::uuid
        else null
      end
      and revision.marketplace_account_key = p_account_key
      and revision.created_by = p_actor
      and revision.listing_package_id = package.id
      and revision.candidate_id = p_candidate_id
      and revision.run_id = p_run_id
      and revision.status = 'APPROVED'
      and revision.reviewed_by = p_actor
      and revision.human_decision = 'APPROVED'
      and cardinality(revision.asset_ids) = 7
      and revision.image_set_hash ~ '^[0-9a-f]{64}$'
      and revision.ebay_writes = 0
      and not revision.production_changed
    where package.id = p_listing_package_id
      and package.account_key = p_account_key
      and package.created_by = p_actor
      and package.status in ('draft', 'ready_for_review')
      and jsonb_typeof(package.package_data->'imageUrls') = 'array'
      and jsonb_array_length(package.package_data->'imageUrls') = 7
      and jsonb_typeof(package.package_data->'imageAssetManifest') = 'array'
      and jsonb_array_length(package.package_data->'imageAssetManifest') = 7
      and (select count(distinct value)
        from jsonb_array_elements_text(package.package_data->'imageUrls') url(value)) = 7
      and not exists (
        select 1
        from jsonb_array_elements(package.package_data->'imageAssetManifest')
          with ordinality manifest(value, position)
        left join public.ebay_listing_image_assets asset
          on asset.id = case
            when coalesce(manifest.value->>'assetId', '')
              ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (manifest.value->>'assetId')::uuid
            else null
          end
        where asset.id is null
          or not (asset.id = any(revision.asset_ids))
          or asset.account_key <> p_account_key
          or asset.created_by <> p_actor
          or asset.listing_package_id <> p_listing_package_id
          or asset.status <> 'approved'
          or asset.approved_by is distinct from p_actor
          or asset.approved_at is null
          or asset.qa_result->>'automaticStatus' is distinct from 'PASSED'
          or asset.qa_result->>'qaEvaluatorVersion'
            is distinct from 'SELLER_OS_EBAY_VISUAL_QA_V2'
          or manifest.value->>'automaticQa' is distinct from 'PASSED'
          or asset.public_url is distinct from manifest.value->>'url'
          or asset.public_url is distinct from
            package.package_data->'imageUrls'->>(manifest.position::integer - 1)
      )
  );
$$;

revoke all on function public.is_ebay_approved_visual_v2_revision_set(
  text, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.is_ebay_approved_visual_v2_revision_set(
  text, uuid, uuid, uuid, uuid
) to service_role;

do $$
declare
  v_definition text;
  v_old_package_gate text := $gate$if jsonb_array_length(v_package.package_data->'imageUrls') <> 7
    or jsonb_array_length(v_package.package_data->'imageAssetManifest') <> 7 then$gate$;
  v_new_package_gate text := $gate$if jsonb_array_length(v_package.package_data->'imageUrls') not in (6, 7)
    or jsonb_array_length(v_package.package_data->'imageAssetManifest')
      <> jsonb_array_length(v_package.package_data->'imageUrls') then$gate$;
  v_old_binding_gate text := $gate$if jsonb_array_length(v_handoff_urls) <> 7
    or jsonb_array_length(v_approved_urls) <> 7
    or v_handoff_urls is distinct from v_package_urls
    or v_approved_urls is distinct from v_package_urls
    or (select count(distinct value)
        from jsonb_array_elements_text(v_package_urls) as url(value)) <> 7
    or (select count(*)
        from jsonb_array_elements_text(v_package_urls) as url(value)
        where value ~ '^https://') <> 7 then$gate$;
  v_new_binding_gate text := $gate$if not (
    (
      jsonb_array_length(v_package_urls) in (6, 7)
      and jsonb_array_length(v_handoff_urls) = jsonb_array_length(v_package_urls)
      and jsonb_array_length(v_approved_urls) = jsonb_array_length(v_package_urls)
      and v_handoff_urls = v_package_urls
      and v_approved_urls = v_package_urls
      and (select count(distinct value)
        from jsonb_array_elements_text(v_package_urls) as url(value))
          = jsonb_array_length(v_package_urls)
      and (select count(*)
        from jsonb_array_elements_text(v_package_urls) as url(value)
        where value ~ '^https://') = jsonb_array_length(v_package_urls)
    )
    or public.is_ebay_approved_visual_v2_revision_set(
      p_account_key, p_actor, v_package.id, v_candidate.id, v_run.id
    )
  ) then$gate$;
  v_old_control_start text := $gate$if not exists (
    select 1
    from public.ebay_same_day_pilot_image_package_runs control$gate$;
  v_new_control_start text := $gate$if not public.is_ebay_approved_visual_v2_revision_set(
      p_account_key, p_actor, v_package.id, v_candidate.id, v_run.id
    ) and not exists (
    select 1
    from public.ebay_same_day_pilot_image_package_runs control$gate$;
begin
  select pg_get_functiondef(
    'public.reconfirm_ebay_ready_publication_luna_v1(text,uuid,uuid,uuid,numeric,boolean,integer,timestamptz)'::regprocedure
  ) into v_definition;
  if position('is_ebay_approved_visual_v2_revision_set' in v_definition) = 0 then
    if position(v_old_package_gate in v_definition) = 0
      or position(v_old_binding_gate in v_definition) = 0
      or position(v_old_control_start in v_definition) = 0 then
      raise exception 'SELLER_OS_LUNA_RECHECK_VISUAL_V2_PATCH_TARGET_MISSING';
    end if;
    v_definition := replace(v_definition, v_old_package_gate, v_new_package_gate);
    v_definition := replace(v_definition, v_old_binding_gate, v_new_binding_gate);
    v_definition := replace(v_definition, v_old_control_start, v_new_control_start);
    v_definition := replace(v_definition,
      'and cardinality(control.asset_ids) = 7',
      'and cardinality(control.asset_ids) in (6, 7)');
    execute v_definition;
  end if;
end;
$$;

comment on function public.is_ebay_approved_visual_v2_revision_set(
  text, uuid, uuid, uuid, uuid
) is 'Validates the exact seven-image PASSED V2 revision projection without mutating historical six-image controls.';

notify pgrst, 'reload schema';
