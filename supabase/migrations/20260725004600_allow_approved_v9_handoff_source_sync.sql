-- The final source-sync gate still recognized seven-image packages only when
-- they used the legacy preferred-revision table. Current same-day V9 packages
-- are approved directly through the immutable image control and manifest.
-- Validate that exact control before accepting the seven-image handoff.

do $migration$
declare
  v_signature regprocedure :=
    'public.sync_same_day_source_before_authorized_publication(uuid,uuid,text)'
      ::regprocedure;
  v_definition text;
  v_anchor text := $old$
  v_image_summary := v_candidate.image_package_summary;$old$;
  v_guard text := $new$
  v_image_summary := v_candidate.image_package_summary;
  if jsonb_array_length(coalesce(
      v_package.package_data->'imageUrls', '[]'::jsonb
    )) = 7
    and jsonb_array_length(coalesce(
      v_package.package_data->'imageAssetManifest', '[]'::jsonb
    )) = 7 then
    perform public.assert_ebay_same_day_approved_v9_control_v1(
      (v_image_summary->>'controlId')::uuid,
      p_marketplace_account_key,
      p_actor_user_id,
      array(
        select asset_id::uuid
        from jsonb_array_elements_text(coalesce(
          v_image_summary->'assetIds', '[]'::jsonb
        )) with ordinality requested(asset_id, display_order)
        order by display_order
      )
    );
  end if;$new$;
  v_old_gate text := $old$
      or public.is_ebay_approved_visual_v2_revision_set(
        p_marketplace_account_key,
        p_actor_user_id,
        v_package.id,
        v_candidate.id,
        v_candidate.run_id
      )
    ) then$old$;
  v_new_gate text := $new$
      or (
        jsonb_array_length(coalesce(
          v_package.package_data->'imageUrls', '[]'::jsonb
        )) = 7
        and jsonb_array_length(coalesce(
          v_package.package_data->'imageAssetManifest', '[]'::jsonb
        )) = 7
      )
      or public.is_ebay_approved_visual_v2_revision_set(
        p_marketplace_account_key,
        p_actor_user_id,
        v_package.id,
        v_candidate.id,
        v_candidate.run_id
      )
    ) then$new$;
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if v_definition is null then
    raise exception 'SAME_DAY_PUBLICATION_SOURCE_SYNC_FUNCTION_MISSING';
  end if;
  if strpos(v_definition, v_guard) > 0 then
    return;
  end if;
  if strpos(v_definition, v_anchor) = 0
    or strpos(v_definition, v_old_gate) = 0 then
    raise exception 'SAME_DAY_PUBLICATION_V9_HANDOFF_PATCH_TARGET_MISSING';
  end if;

  v_definition := replace(v_definition, v_anchor, v_guard);
  v_definition := replace(v_definition, v_old_gate, v_new_gate);
  if strpos(
      v_definition,
      'assert_ebay_same_day_approved_v9_control_v1'
    ) = 0 then
    raise exception 'SAME_DAY_PUBLICATION_V9_HANDOFF_PATCH_FAILED';
  end if;
  execute v_definition;
end;
$migration$;

comment on function
  public.sync_same_day_source_before_authorized_publication(
    uuid, uuid, text
  )
is
  'Revalidates Luna before publication and accepts six-image legacy, approved V2 revision, or exact approved same-day V9 seven-image handoffs.';
