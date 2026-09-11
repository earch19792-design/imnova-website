-- Reconcile a projection erased by a prior LIVE reader without rewriting the
-- immutable linkage decision or minting a duplicate. All original proofs rerun.
do $migration$
declare d text; old_branch text; new_branch text;
begin
 select pg_get_functiondef('public.resolve_relist_supplier_handoff_v1(text,text,boolean)'::regprocedure) into d;
 d:=replace(d,'v_actor uuid; v_field_name text;', 'v_actor uuid; v_reuse boolean:=false; v_field_name text;');
 old_branch:=$old$
 if v_existing.decision_id is not null then
  if v_existing.decision='APPROVE_EXACT_LINKAGE' and v_existing.ebay_sku=v_active.ebay_sku then
   return jsonb_build_object('status','CERTIFIED','linkageId',v_existing.linkage_id,'decisionId',v_existing.decision_id,
    'productId',v_existing.luna_product_id,'variantId',v_existing.luna_variant_id,'supplierSku',v_existing.luna_sku,'idempotent',true,'ownerActionRequired',false);
  end if;
  return jsonb_build_object('status','REQUIRES_ATTENTION','reason','CURRENT_LINKAGE_DECISION_CONFLICT','ownerActionRequired',true);
 end if;
$old$;
 new_branch:=$new$
 if v_existing.decision_id is not null then
  if v_existing.decision<>'APPROVE_EXACT_LINKAGE' or v_existing.ebay_sku is distinct from v_active.ebay_sku then
   return jsonb_build_object('status','REQUIRES_ATTENTION','reason','CURRENT_LINKAGE_DECISION_CONFLICT','ownerActionRequired',true);
  end if;
  if v_active.raw_payload#>>'{canonicalSupplierLineage,status}'='CERTIFIED'
   and v_active.raw_payload#>>'{canonicalSupplierLineage,linkageId}'=v_existing.linkage_id
   and v_active.raw_payload#>>'{canonicalSupplierLineage,productId}'=v_existing.luna_product_id
   and v_active.raw_payload#>>'{canonicalSupplierLineage,variantId}'=v_existing.luna_variant_id
   and v_active.supplier_variant_id=v_existing.luna_variant_id and v_active.supplier_sku=v_existing.luna_sku then
   return jsonb_build_object('status','CERTIFIED','linkageId',v_existing.linkage_id,'decisionId',v_existing.decision_id,
    'productId',v_existing.luna_product_id,'variantId',v_existing.luna_variant_id,'supplierSku',v_existing.luna_sku,'idempotent',true,'ownerActionRequired',false);
  end if;
  v_reuse:=true;
 end if;
$new$;
 if strpos(d,old_branch)=0 then raise exception 'RELIST_REPLAY_PATCH_TARGET_MISSING'; end if;
 d:=replace(d,old_branch,new_branch);
 d:=replace(d,'    insert into public.seller_os_luna_linkage_review_candidates (',$before$
 if v_reuse and (v_existing.linkage_id is distinct from v_linkage_id
  or v_existing.luna_product_id is distinct from v_opportunity.supplier_product_id
  or v_existing.luna_variant_id is distinct from v_opportunity.supplier_variant_id
  or v_existing.luna_sku is distinct from v_opportunity.supplier_sku) then
  return jsonb_build_object('status','REQUIRES_ATTENTION','reason','CURRENT_CANONICAL_LINEAGE_CONFLICT','ownerActionRequired',true);
 end if;
 if not v_reuse then
    insert into public.seller_os_luna_linkage_review_candidates (
$before$);
 d:=replace(d,' update public.ebay_active_listings set market_radar_product_id=',
  ' end if; -- immutable decision reused on projection recovery
 update public.ebay_active_listings set market_radar_product_id=');
 d:=replace(d,'''durableReadbackMatch'',true,''idempotent'',false)', '''durableReadbackMatch'',true,''idempotent'',v_reuse)');
 execute d;
end;
$migration$;
