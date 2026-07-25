-- Keep approval and publication aligned with the runtime text contract.
-- Secondary images must prove that their commercial copy was rendered with
-- the bounded Pango/font-file renderer and that glyph output passed QA. The
-- canonical main image must remain copy-free and therefore must not carry
-- either text marker. This migration changes validators only: it creates no
-- image bytes, provider calls, eBay writes, or Production capability.

do $migration$
declare
  v_definition text;
  v_updated_definition text;
  v_main_old text := $old$
      and not (asset.qa_result ? 'opaqueSourceFrameRemoved')
      and (
$old$;
  v_main_new text := $new$
      and not (asset.qa_result ? 'opaqueSourceFrameRemoved')
      and not (asset.transformation ? 'textRendererVersion')
      and not (asset.qa_result ? 'textGlyphsValidated')
      and (
$new$;
  v_secondary_old text := $old$
      and asset.qa_result ->> 'textSafeAreaVerified' = 'true'
      and asset.qa_result ->> 'structuralDiversityVerified' = 'true'
$old$;
  v_secondary_new text := $new$
      and asset.qa_result ->> 'textSafeAreaVerified' = 'true'
      and asset.transformation ->> 'textRendererVersion'
        = 'EBAY_IMAGE_TEXT_PANGO_FONTFILE_V2_2026_07_21'
      and asset.qa_result ->> 'textGlyphsValidated' = 'true'
      and asset.qa_result ->> 'structuralDiversityVerified' = 'true'
$new$;
begin
  select pg_get_functiondef(
    'public.assert_same_day_pilot_image_set_current_v6(uuid,uuid,uuid[])'::regprocedure
  ) into v_definition;
  if v_definition is null then
    raise exception 'IMAGE_TEXT_RENDERER_V6_BASE_CONTRACT_NOT_FOUND';
  end if;

  v_updated_definition := v_definition;
  if strpos(v_updated_definition, v_main_new) = 0 then
    if strpos(v_updated_definition, v_main_old) = 0 then
      raise exception 'IMAGE_TEXT_RENDERER_V6_MAIN_BASE_CONTRACT_NOT_FOUND';
    end if;
    v_updated_definition := replace(
      v_updated_definition, v_main_old, v_main_new
    );
  end if;

  if strpos(v_updated_definition, v_secondary_new) = 0 then
    if strpos(v_updated_definition, v_secondary_old) = 0 then
      raise exception 'IMAGE_TEXT_RENDERER_V6_SECONDARY_BASE_CONTRACT_NOT_FOUND';
    end if;
    v_updated_definition := replace(
      v_updated_definition, v_secondary_old, v_secondary_new
    );
  end if;

  if strpos(v_updated_definition, v_main_new) = 0
    or strpos(v_updated_definition, v_secondary_new) = 0 then
    raise exception 'IMAGE_TEXT_RENDERER_V6_PATCH_FAILED';
  end if;
  if v_updated_definition <> v_definition then
    execute v_updated_definition;
  end if;
end;
$migration$;

comment on function public.assert_same_day_pilot_image_set_current_v6(
  uuid, uuid, uuid[]
) is 'Requires one copy-free exact main plus five V6 locally-matted authorized foregrounds whose bounded Pango/font-file text and glyph QA evidence is current.';

do $migration$
declare
  v_definition text;
  v_updated_definition text;
  v_old text := $old$
      or asset.transformation ->> 'compositorContractVersion'
        is distinct from 'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21'
      or (
        asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
        and not coalesce((
          asset.transformation ->> 'authorizedSourceTreatment'
$old$;
  v_new text := $new$
      or asset.transformation ->> 'compositorContractVersion'
        is distinct from 'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21'
      or (
        asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
        and not coalesce((
          asset.transformation ->> 'textRendererVersion'
            = 'EBAY_IMAGE_TEXT_PANGO_FONTFILE_V2_2026_07_21'
          and asset.qa_result ->> 'textGlyphsValidated' = 'true'
        ), false)
      )
      or (
        asset.transformation ->> 'slot' = 'MAIN_WHITE_BACKGROUND'
        and (
          asset.transformation ? 'textRendererVersion'
          or asset.qa_result ? 'textGlyphsValidated'
        )
      )
      or (
        asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
        and not coalesce((
          asset.transformation ->> 'authorizedSourceTreatment'
$new$;
begin
  select pg_get_functiondef(
    'public.assert_ebay_publish_image_set_high_quality(uuid,uuid,text)'::regprocedure
  ) into v_definition;
  if v_definition is null then
    raise exception 'IMAGE_TEXT_RENDERER_PUBLICATION_BASE_CONTRACT_NOT_FOUND';
  end if;
  if strpos(v_definition, v_new) > 0 then
    return;
  end if;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'IMAGE_TEXT_RENDERER_PUBLICATION_BASE_CONTRACT_NOT_FOUND';
  end if;
  v_updated_definition := replace(v_definition, v_old, v_new);
  if v_updated_definition = v_definition
    or strpos(
      v_updated_definition,
      'EBAY_IMAGE_TEXT_PANGO_FONTFILE_V2_2026_07_21'
    ) = 0
    or strpos(v_updated_definition, 'textGlyphsValidated') = 0 then
    raise exception 'IMAGE_TEXT_RENDERER_PUBLICATION_PATCH_FAILED';
  end if;
  execute v_updated_definition;
end;
$migration$;

comment on function public.assert_ebay_publish_image_set_high_quality(
  uuid, uuid, text
) is 'Blocks an eBay publication claim unless its exact main is copy-free and all five V6 secondary assets carry current bounded Pango/font-file renderer and glyph QA evidence.';

notify pgrst, 'reload schema';
