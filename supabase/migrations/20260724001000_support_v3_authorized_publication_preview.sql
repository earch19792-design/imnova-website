-- The final V3 package contains seven exact, approval-bound assets. The
-- publication ledger predates V3 and still rejects every set that is not the
-- legacy six-image shape. Upgrade only that image gate while preserving the
-- legacy contract and every one-shot publication control.

do $migration$
declare
  v_signature regprocedure :=
    'public.prepare_ebay_authorized_listing_publication(uuid,uuid,text,text,jsonb,text,text)'::regprocedure;
  v_definition text;
  v_old text := $old$
  v_images := v_approval.approved_payload #> '{inventoryItemPayload,product,imageUrls}';
  if jsonb_typeof(v_images) <> 'array'
    or jsonb_array_length(v_images) <> 6
    or (select count(distinct image.value) from jsonb_array_elements_text(v_images) image(value)) <> 6
    or exists (
      select 1 from jsonb_array_elements_text(v_images) image(value)
      where image.value !~ '^https://'
    )
    or v_approval.approved_payload #>> '{compliance,imageAuthorization,approved}' <> 'true'
    or v_approval.approved_payload #>> '{compliance,imageAuthorization,protectedManifestVerified}' <> 'true'
    or coalesce((v_approval.approved_payload #>> '{compliance,imageAuthorization,protectedManifestAssetCount}')::integer, 0) < 6 then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_SIX_APPROVED_IMAGES_REQUIRED';
  end if;$old$;
  v_new text := $new$
  v_images := v_approval.approved_payload #> '{inventoryItemPayload,product,imageUrls}';
  if jsonb_typeof(v_images) is distinct from 'array' then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_APPROVED_IMAGES_REQUIRED';
  end if;
  if jsonb_array_length(v_images) not in (6, 7)
    or (
      select count(distinct image.value)
      from jsonb_array_elements_text(v_images) image(value)
    ) <> jsonb_array_length(v_images)
    or exists (
      select 1
      from jsonb_array_elements_text(v_images) image(value)
      where image.value !~ '^https://'
    )
    or v_approval.approved_payload
      #>> '{compliance,imageAuthorization,approved}' <> 'true'
    or v_approval.approved_payload
      #>> '{compliance,imageAuthorization,protectedManifestVerified}'
        <> 'true' then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_APPROVED_IMAGES_REQUIRED';
  end if;

  if jsonb_typeof(
    v_approval.approved_payload
      #> '{compliance,v3FinalSetAuthorization}'
  ) is not distinct from 'object' then
    if jsonb_array_length(v_images) <> 7
      or coalesce((
        v_approval.approved_payload
          #>> '{compliance,imageAuthorization,protectedManifestAssetCount}'
      )::integer, 0) <> 7
      or jsonb_typeof(
        v_approval.approved_payload
          #> '{compliance,v3FinalSetAuthorization,selectedAssets}'
      ) is distinct from 'array' then
      raise exception
        'EBAY_AUTHORIZED_PUBLICATION_V3_SEVEN_APPROVED_IMAGES_REQUIRED';
    end if;
    if jsonb_array_length(
      v_approval.approved_payload
        #> '{compliance,v3FinalSetAuthorization,selectedAssets}'
    ) <> 7
      or (
        select count(distinct asset->>'position')
        from jsonb_array_elements(
          v_approval.approved_payload
            #> '{compliance,v3FinalSetAuthorization,selectedAssets}'
        ) asset
      ) <> 7
      or exists (
        select 1
        from jsonb_array_elements(
          v_approval.approved_payload
            #> '{compliance,v3FinalSetAuthorization,selectedAssets}'
        ) asset
        where jsonb_typeof(asset) is distinct from 'object'
          or coalesce(asset->>'position', '') !~ '^[0-6]$'
          or coalesce(asset->>'url', '') !~ '^https://'
          or coalesce(asset->>'sha256', '') !~ '^[0-9a-f]{64}$'
          or case
            when coalesce(asset->>'position', '') ~ '^[0-6]$' then
              coalesce(asset->>'assetRole', '') is distinct from (
                array[
                  'PRIMARY_MAIN',
                  'SECONDARY_MATERIAL_DETAIL',
                  'SECONDARY_PACKAGE_CONTENTS',
                  'SECONDARY_SCALE_CAPACITY',
                  'SECONDARY_USE_CONTEXT',
                  'SECONDARY_ASPIRATIONAL_LIFESTYLE',
                  'SECONDARY_HUMAN_CONTEXT'
                ]
              )[((asset->>'position')::integer) + 1]
            else true
          end
      ) then
      raise exception
        'EBAY_AUTHORIZED_PUBLICATION_V3_SEVEN_APPROVED_IMAGES_REQUIRED';
    end if;
    if v_images is distinct from (
      select jsonb_agg(
        asset->'url'
        order by (asset->>'position')::integer
      )
      from jsonb_array_elements(
        v_approval.approved_payload
          #> '{compliance,v3FinalSetAuthorization,selectedAssets}'
      ) asset
    ) then
      raise exception
        'EBAY_AUTHORIZED_PUBLICATION_V3_SEVEN_APPROVED_IMAGES_REQUIRED';
    end if;
  elsif jsonb_array_length(v_images) <> 6
    or coalesce((
      v_approval.approved_payload
        #>> '{compliance,imageAuthorization,protectedManifestAssetCount}'
    )::integer, 0) < 6 then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_SIX_APPROVED_IMAGES_REQUIRED';
  end if;$new$;
begin
  select pg_get_functiondef(v_signature)
  into strict v_definition;

  if position(
    'EBAY_AUTHORIZED_PUBLICATION_V3_SEVEN_APPROVED_IMAGES_REQUIRED'
    in v_definition
  ) > 0 then
    return;
  end if;
  if position(v_old in v_definition) = 0 then
    raise exception
      'EBAY_AUTHORIZED_PUBLICATION_IMAGE_GATE_REWRITE_NOT_APPLIED';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$migration$;

do $assertion$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.prepare_ebay_authorized_listing_publication(uuid,uuid,text,text,jsonb,text,text)'::regprocedure
  )
  into strict v_definition;
  if position(
    'EBAY_AUTHORIZED_PUBLICATION_V3_SEVEN_APPROVED_IMAGES_REQUIRED'
    in v_definition
  ) = 0
    or position(
      '#> ''{compliance,v3FinalSetAuthorization,selectedAssets}'''
      in v_definition
    ) = 0
    or position(
      'EBAY_AUTHORIZED_PUBLICATION_SIX_APPROVED_IMAGES_REQUIRED'
      in v_definition
    ) = 0 then
    raise exception
      'EBAY_AUTHORIZED_PUBLICATION_IMAGE_GATE_ASSERTION_FAILED';
  end if;
end;
$assertion$;

comment on function public.prepare_ebay_authorized_listing_publication(
  uuid, uuid, text, text, jsonb, text, text
) is
  'Prepares the one-shot publication ledger for legacy exact-six or V3 exact-seven approval-bound image sets without calling eBay.';

notify pgrst, 'reload schema';
