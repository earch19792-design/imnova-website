-- Preserve initial migration/source receipts. Re-normalize multiline list items
-- and inspect only explicit downstream attribute containers (diagnostics only).
do $migration$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.derive_luna_field_truth_v1(jsonb,jsonb,jsonb,jsonb)'::regprocedure);
  updated:=replace(definition,
    $old$replace(coalesce(p_product->>'body_html',''),E'\\n',E'\n'),$old$,
    $new$replace(replace(coalesce(p_product->>'body_html',''),E'\\n',' '),E'\n',' '),$new$);
  if updated=definition then raise exception 'LUNA_MULTILINE_PATCH_PRECONDITION_FAILED'; end if;
  definition:=updated;
  updated:=replace(definition,
    $old$coalesce(p_package->'requiredItemSpecifics',p_package->'itemSpecifics','{}')$old$,
    $new$coalesce(p_package->'requiredItemSpecifics',p_package->'itemSpecifics',
          p_package->'aspects',p_package#>'{quickPickMarketTestPackageV1,itemSpecifics}','{}')$new$);
  if updated=definition then raise exception 'LUNA_DOWNSTREAM_DIAGNOSTIC_PATCH_PRECONDITION_FAILED'; end if;
  updated:=replace(updated,$old$'contractVersion','LUNA_FIELD_PRODUCT_TRUTH_V1',$old$,
    $new$'normalizationVersion','LUNA_FIELD_NORMALIZATION_V2','contractVersion','LUNA_FIELD_PRODUCT_TRUTH_V1',$new$);
  execute updated;
  definition:=pg_get_functiondef('public.materialize_luna_field_truth_assessment_v1(jsonb,jsonb)'::regprocedure);
  updated:=replace(definition,
    $old$select coalesce(package_data,'{}')||jsonb_build_object('id',id)$old$,
    $new$select jsonb_strip_nulls(jsonb_build_object('id',id,
      'brand',package_data->'brand','model',package_data->'model','mpn',package_data->'mpn',
      'aspects',package_data->'aspects','itemSpecifics',package_data->'itemSpecifics',
      'requiredItemSpecifics',package_data->'requiredItemSpecifics',
      'quickPickMarketTestPackageV1',jsonb_build_object('itemSpecifics',
        package_data#>'{quickPickMarketTestPackageV1,itemSpecifics}')))$new$);
  if updated=definition then raise exception 'LUNA_DIAGNOSTIC_INPUT_SCOPE_PRECONDITION_FAILED'; end if;
  execute updated;
end;
$migration$;
select public.recover_luna_product_truth_parity_v1(1000);
