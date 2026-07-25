-- Continue the one-shot publication path with an exact approved preferred
-- seven-image revision after the unpublished Offer has been verified.
-- The legacy base handoff/control remains immutable. This migration performs
-- no provider, eBay, or Production write.

do $migration$
declare
  v_signature regprocedure :=
    'public.is_ebay_approved_visual_v2_revision_set(text,uuid,uuid,uuid,uuid)'::regprocedure;
  v_definition text;
  v_old text :=
    'and package.status in (''draft'', ''ready_for_review'')';
  v_new text :=
    'and package.status in (''draft'', ''ready_for_review'', ''approved'')';
begin
  select pg_get_functiondef(v_signature) into strict v_definition;
  if strpos(v_definition, v_new) > 0 then
    return;
  end if;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'PREFERRED_REVISION_APPROVED_STATUS_PATCH_TARGET_MISSING';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;

do $migration$
declare
  v_signature regprocedure :=
    'public.sync_same_day_source_before_authorized_publication(uuid,uuid,text)'::regprocedure;
  v_definition text;
  v_old_handoff text := $old$
    or jsonb_array_length(coalesce(v_package.package_data->'imageUrls', '[]'::jsonb)) <> 6
    or jsonb_array_length(coalesce(v_package.package_data->'imageAssetManifest', '[]'::jsonb)) <> 6 then
    raise exception 'EBAY_SAME_DAY_PUBLICATION_HANDOFF_INVALID';
  end if;$old$;
  v_new_handoff text := $new$
    or not (
      (
        jsonb_array_length(coalesce(
          v_package.package_data->'imageUrls', '[]'::jsonb
        )) = 6
        and jsonb_array_length(coalesce(
          v_package.package_data->'imageAssetManifest', '[]'::jsonb
        )) = 6
      )
      or public.is_ebay_approved_visual_v2_revision_set(
        p_marketplace_account_key,
        p_actor_user_id,
        v_package.id,
        v_candidate.id,
        v_candidate.run_id
      )
    ) then
    raise exception 'EBAY_SAME_DAY_PUBLICATION_HANDOFF_INVALID';
  end if;$new$;
  v_old_binding text := $old$
  if coalesce(v_image_summary->'publicUrls', '[]'::jsonb)
      is distinct from coalesce(v_package.package_data->'imageUrls', '[]'::jsonb)
    or coalesce(v_handoff#>'{images,urls}', '[]'::jsonb)
      is distinct from coalesce(v_package.package_data->'imageUrls', '[]'::jsonb) then
    raise exception 'EBAY_SAME_DAY_PUBLICATION_IMAGE_BINDING_INVALID';
  end if;$old$;
  v_new_binding text := $new$
  if not (
    (
      coalesce(v_image_summary->'publicUrls', '[]'::jsonb)
        = coalesce(v_package.package_data->'imageUrls', '[]'::jsonb)
      and coalesce(v_handoff#>'{images,urls}', '[]'::jsonb)
        = coalesce(v_package.package_data->'imageUrls', '[]'::jsonb)
    )
    or public.is_ebay_approved_visual_v2_revision_set(
      p_marketplace_account_key,
      p_actor_user_id,
      v_package.id,
      v_candidate.id,
      v_candidate.run_id
    )
  ) then
    raise exception 'EBAY_SAME_DAY_PUBLICATION_IMAGE_BINDING_INVALID';
  end if;$new$;
begin
  select pg_get_functiondef(v_signature) into strict v_definition;
  if strpos(
      v_definition,
      'is_ebay_approved_visual_v2_revision_set'
    ) > 0 then
    return;
  end if;
  if strpos(v_definition, v_old_handoff) = 0
    or strpos(v_definition, v_old_binding) = 0 then
    raise exception 'PREFERRED_REVISION_SOURCE_SYNC_PATCH_TARGET_MISSING';
  end if;
  v_definition := replace(v_definition, v_old_handoff, v_new_handoff);
  v_definition := replace(v_definition, v_old_binding, v_new_binding);
  if strpos(
      v_definition,
      'is_ebay_approved_visual_v2_revision_set'
    ) = 0 then
    raise exception 'PREFERRED_REVISION_SOURCE_SYNC_PATCH_FAILED';
  end if;
  execute v_definition;
end;
$migration$;

do $migration$
declare
  v_signature regprocedure :=
    'public.prepare_ebay_authorized_listing_publication(uuid,uuid,text,text,jsonb,text,text)'::regprocedure;
  v_definition text;
  v_old text := $old$
  elsif jsonb_array_length(v_images) <> 6
    or coalesce((
      v_approval.approved_payload
        #>> '{compliance,imageAuthorization,protectedManifestAssetCount}'
    )::integer, 0) < 6 then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_SIX_APPROVED_IMAGES_REQUIRED';
  end if;$old$;
  v_new text := $new$
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
    end if;
  elsif jsonb_array_length(v_images) <> 6
    or coalesce((
      v_approval.approved_payload
        #>> '{compliance,imageAuthorization,protectedManifestAssetCount}'
    )::integer, 0) < 6 then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_SIX_APPROVED_IMAGES_REQUIRED';
  end if;$new$;
begin
  select pg_get_functiondef(v_signature) into strict v_definition;
  if strpos(
      v_definition,
      'EBAY_AUTHORIZED_PUBLICATION_PREFERRED_REVISION_INVALID'
    ) > 0 then
    return;
  end if;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'PREFERRED_REVISION_PUBLICATION_GATE_PATCH_TARGET_MISSING';
  end if;
  v_definition := replace(v_definition, v_old, v_new);
  if strpos(
      v_definition,
      'EBAY_AUTHORIZED_PUBLICATION_PREFERRED_REVISION_INVALID'
    ) = 0 then
    raise exception 'PREFERRED_REVISION_PUBLICATION_GATE_PATCH_FAILED';
  end if;
  execute v_definition;
end;
$migration$;

do $assertion$
declare
  v_revision_definition text;
  v_sync_definition text;
  v_prepare_definition text;
begin
  select pg_get_functiondef(
    'public.is_ebay_approved_visual_v2_revision_set(text,uuid,uuid,uuid,uuid)'::regprocedure
  ) into strict v_revision_definition;
  select pg_get_functiondef(
    'public.sync_same_day_source_before_authorized_publication(uuid,uuid,text)'::regprocedure
  ) into strict v_sync_definition;
  select pg_get_functiondef(
    'public.prepare_ebay_authorized_listing_publication(uuid,uuid,text,text,jsonb,text,text)'::regprocedure
  ) into strict v_prepare_definition;
  if strpos(
      v_revision_definition,
      'package.status in (''draft'', ''ready_for_review'', ''approved'')'
    ) = 0
    or strpos(
      v_sync_definition,
      'is_ebay_approved_visual_v2_revision_set'
    ) = 0
    or strpos(
      v_prepare_definition,
      'EBAY_AUTHORIZED_PUBLICATION_PREFERRED_REVISION_INVALID'
    ) = 0 then
    raise exception 'PREFERRED_REVISION_PUBLICATION_PATCH_ASSERTION_FAILED';
  end if;
end;
$assertion$;

comment on function
  public.sync_same_day_source_before_authorized_publication(
    uuid, uuid, text
  )
is 'Synchronizes fresh Luna evidence for a completed unpublished Offer using either the immutable legacy image binding or an exact approved preferred seven-image revision; performs zero eBay writes.';

comment on function public.prepare_ebay_authorized_listing_publication(
  uuid, uuid, text, text, jsonb, text, text
)
is 'Prepares the one-shot publication ledger for legacy six-image, reference-guided V3 seven-image, or exact approved preferred seven-image sets without calling eBay.';

notify pgrst, 'reload schema';
