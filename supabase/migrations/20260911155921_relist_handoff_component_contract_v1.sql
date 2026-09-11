do $migration$
declare d text;
 anchor text := '''lunaVariantId'',v_opportunity.supplier_variant_id,''lunaSku'',v_opportunity.supplier_sku,''supplierQuantityRequired'',1';
 replacement text := '''lunaVariantId'',v_opportunity.supplier_variant_id,''lunaSku'',v_opportunity.supplier_sku,
  ''productTitle'',nullif(v_opportunity.product_title,''''),''variantTitle'',nullif(v_opportunity.variant_title,''''),''supplierQuantityRequired'',1';
begin
 select pg_get_functiondef('public.resolve_relist_supplier_handoff_v1(text,text,boolean)'::regprocedure) into d;
 if strpos(d,anchor)=0 then raise exception 'RELIST_COMPONENT_PATCH_TARGET_MISSING'; end if;
 execute replace(d,anchor,replacement);
end;
$migration$;
