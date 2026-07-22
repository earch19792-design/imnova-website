create or replace function public.ensure_visual_strategy_v3_revision_from_binding(p_parent_revision_id uuid)
returns table(revision_id uuid, created boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent public.ebay_same_day_pilot_image_revisions%rowtype;
  v_binding public.luna_catalog_source_pack_dossier_bindings%rowtype;
  v_pack public.luna_catalog_authorized_source_packs%rowtype;
  v_brief record;
  v_fingerprint text;
  v_existing uuid;
  v_new uuid;
  v_main jsonb;
  v_side jsonb;
begin
  select * into v_parent from public.ebay_same_day_pilot_image_revisions where id = p_parent_revision_id for update;
  if not found then raise exception 'PARENT_REVISION_NOT_FOUND'; end if;
  if v_parent.strategy_version <> 'VISUAL_STRATEGY_V2' or v_parent.revision_contract <> 'LEGACY_VISUAL_STRATEGY_V2' then raise exception 'PARENT_REVISION_STRATEGY_INVALID'; end if;
  select * into v_binding from public.luna_catalog_source_pack_dossier_bindings where listing_package_id = v_parent.listing_package_id order by verified_at desc limit 1;
  if not found then raise exception 'SOURCE_PACK_DOSSIER_BINDING_REQUIRED'; end if;
  select * into v_pack from public.luna_catalog_authorized_source_packs where id = v_binding.source_pack_id and listing_package_id = v_parent.listing_package_id for share;
  if not found or v_pack.source_pack_hash <> v_binding.source_pack_manifest_hash then raise exception 'SOURCE_PACK_BINDING_INVALID'; end if;
  if v_binding.policy_version <> 'REFERENCE_GUIDED_PRODUCT_GENERATION_V1' then raise exception 'SOURCE_PACK_POLICY_INVALID'; end if;
  v_main := (select asset from jsonb_array_elements(v_pack.source_assets) asset where asset->>'sourceImageId' = 'MAIN' limit 1);
  v_side := (select asset from jsonb_array_elements(v_pack.source_assets) asset where asset->>'sourceImageId' = 'SIDE' limit 1);
  if v_main is null or v_side is null or v_main->>'sha256' <> '3e920855560159a9722cb54680f565beae9c41ff1cd247cd47af4cf626c5aed1' or v_side->>'sha256' <> 'f15c9e6e24018241290ded5a4838df1f9477f7b028fdf1f74c627b0780d42f21' then raise exception 'SOURCE_PACK_MEDIA_INVALID'; end if;
  select * into v_brief from public.marketplace_product_research_visual_market_briefs where marketplace_account_key = v_parent.marketplace_account_key and confidence in ('HIGH','MEDIUM') and sample_size >= 3 order by created_at desc limit 1;
  if not found then raise exception 'MARKET_VISUAL_BRIEF_REQUIRED'; end if;
  v_fingerprint := encode(digest(jsonb_build_object('parentRevisionId',v_parent.id,'listingPackageId',v_parent.listing_package_id,'strategyVersion','VISUAL_STRATEGY_V3','revisionContract','REFERENCE_GUIDED_PRODUCT_GENERATION_V1','sourcePackVersion',v_pack.source_pack_version,'sourcePackManifestHash',v_binding.source_pack_manifest_hash,'dossierHash',v_binding.dossier_hash,'marketVisualBriefHash',encode(digest(to_jsonb(v_brief)::text,'sha256'),'hex'))::text,'sha256'),'hex');
  select id into v_existing from public.ebay_same_day_pilot_image_revisions where revision_fingerprint = v_fingerprint limit 1;
  if v_existing is not null then revision_id := v_existing; created := false; return next; return; end if;
  v_new := gen_random_uuid();
  insert into public.ebay_same_day_pilot_image_revisions (id,marketplace_account_key,created_by,base_control_id,run_id,candidate_id,listing_package_id,fact_run_id,revision_number,revision_version,status,attempt,idempotency_key_hash,strategy_version,revision_contract,parent_revision_id,revision_fingerprint,source_pack_version,main_source_id,main_source_hash,side_source_id,side_source_hash,product_dossier_hash,market_visual_brief_hash,authorized_source_count,openai_calls,ebay_writes,production_changed)
  values (v_new,v_parent.marketplace_account_key,v_parent.created_by,v_parent.base_control_id,v_parent.run_id,v_parent.candidate_id,v_parent.listing_package_id,v_parent.fact_run_id,v_parent.revision_number+1,'EBAY_LISTING_IMAGE_REVISION_V1','READY_FOR_PREPARE',1,v_fingerprint,'VISUAL_STRATEGY_V3','REFERENCE_GUIDED_PRODUCT_GENERATION_V1',v_parent.id,v_fingerprint,coalesce(v_pack.source_pack_version,v_pack.resolver_version),'MAIN',v_main->>'sha256','SIDE',v_side->>'sha256',v_binding.dossier_hash,encode(digest(to_jsonb(v_brief)::text,'sha256'),'hex'),2,0,0,false);
  revision_id := v_new; created := true; return next;
exception when unique_violation then
  select id into revision_id from public.ebay_same_day_pilot_image_revisions where revision_fingerprint = v_fingerprint limit 1;
  if revision_id is null then raise; end if;
  created := false; return next;
end $$;
revoke all on function public.ensure_visual_strategy_v3_revision_from_binding(uuid) from public, anon, authenticated;
grant execute on function public.ensure_visual_strategy_v3_revision_from_binding(uuid) to service_role;
