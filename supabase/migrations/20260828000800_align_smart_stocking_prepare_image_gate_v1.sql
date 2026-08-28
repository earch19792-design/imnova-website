-- Smart Stocking already proves its exact durable canonical image set through
-- assert_ebay_smart_stocking_canonical_images_v1. Keep the legacy 6/7 gate for
-- Same-Day and V3, but do not apply that merchandising count a second time to
-- the separately certified Smart Stocking path.

do $migration$
declare
  v_signature regprocedure :=
    'public.prepare_ebay_authorized_listing_publication(uuid,uuid,text,text,jsonb,text,text)'::regprocedure;
  v_definition text;
  v_old text := $old$
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
  end if;$old$;
  v_new text := $new$
  if not v_smart_stocking and (
    jsonb_array_length(v_images) not in (6, 7)
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
        <> 'true'
  ) then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_APPROVED_IMAGES_REQUIRED';
  end if;$new$;
begin
  select pg_get_functiondef(v_signature) into strict v_definition;
  if strpos(v_definition, v_new) > 0 then
    return;
  end if;
  if strpos(v_definition, v_old) = 0
    or strpos(v_definition,
      'assert_ebay_smart_stocking_canonical_images_v1') = 0 then
    raise exception 'EBAY_SMART_STOCKING_IMAGE_GATE_PATCH_TARGET_MISSING';
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
  ) into strict v_definition;
  if strpos(v_definition,
      'if not v_smart_stocking and (' || E'\n' ||
      '    jsonb_array_length(v_images) not in (6, 7)') = 0
    or strpos(v_definition,
      'assert_ebay_smart_stocking_canonical_images_v1') = 0
    or strpos(v_definition,
      'EBAY_AUTHORIZED_PUBLICATION_V3_SEVEN_APPROVED_IMAGES_REQUIRED') = 0
    or strpos(v_definition,
      'EBAY_AUTHORIZED_PUBLICATION_SIX_APPROVED_IMAGES_REQUIRED') = 0 then
    raise exception 'EBAY_SMART_STOCKING_IMAGE_GATE_ALIGNMENT_FAILED';
  end if;
end;
$assertion$;
