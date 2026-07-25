-- The publication-preview ledger inherited the same preferred-revision-only
-- assumption as source sync. Accept a current seven-image same-day handoff
-- only after the exact approved V9 control validates all seven asset IDs.

do $migration$
declare
  v_signature regprocedure :=
    'public.prepare_ebay_authorized_listing_publication(uuid,uuid,text,text,jsonb,text,text)'
      ::regprocedure;
  v_definition text;
  v_old text := $old$
  elsif jsonb_array_length(v_images) = 7 then
    if coalesce((
        v_approval.approved_payload
          #>> '{compliance,imageAuthorization,protectedManifestAssetCount}'
      )::integer, 0) <> 7
      or v_images is distinct from
        v_package.package_data->'imageUrls'
      or not public.is_ebay_approved_visual_v2_revision_set(
        p_marketplace_account_key,
        p_actor_user_id,
        v_package.id,
        v_candidate.id,
        v_candidate.run_id
      ) then
      raise exception
        'EBAY_AUTHORIZED_PUBLICATION_PREFERRED_REVISION_INVALID';
    end if;$old$;
  v_new text := $new$
  elsif jsonb_array_length(v_images) = 7 then
    if coalesce((
        v_approval.approved_payload
          #>> '{compliance,imageAuthorization,protectedManifestAssetCount}'
      )::integer, 0) <> 7
      or v_images is distinct from
        v_package.package_data->'imageUrls' then
      raise exception
        'EBAY_AUTHORIZED_PUBLICATION_SEVEN_IMAGE_BINDING_INVALID';
    end if;
    if not public.is_ebay_approved_visual_v2_revision_set(
        p_marketplace_account_key,
        p_actor_user_id,
        v_package.id,
        v_candidate.id,
        v_candidate.run_id
      ) then
      perform public.assert_ebay_same_day_approved_v9_control_v1(
        (v_candidate.image_package_summary->>'controlId')::uuid,
        p_marketplace_account_key,
        p_actor_user_id,
        array(
          select asset_id::uuid
          from jsonb_array_elements_text(coalesce(
            v_candidate.image_package_summary->'assetIds',
            '[]'::jsonb
          )) with ordinality requested(asset_id, display_order)
          order by display_order
        )
      );
    end if;$new$;
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if v_definition is null then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_PREPARE_FUNCTION_MISSING';
  end if;
  if strpos(
      v_definition,
      'EBAY_AUTHORIZED_PUBLICATION_SEVEN_IMAGE_BINDING_INVALID'
    ) > 0 then
    return;
  end if;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_V9_PATCH_TARGET_MISSING';
  end if;

  v_definition := replace(v_definition, v_old, v_new);
  if strpos(
      v_definition,
      'assert_ebay_same_day_approved_v9_control_v1'
    ) = 0 then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_V9_PATCH_FAILED';
  end if;
  execute v_definition;
end;
$migration$;

comment on function public.prepare_ebay_authorized_listing_publication(
  uuid, uuid, text, text, jsonb, text, text
)
is
  'Prepares a one-shot publication preview for legacy, preferred-revision, V3, or exact approved same-day V9 seven-image sets without calling eBay.';
