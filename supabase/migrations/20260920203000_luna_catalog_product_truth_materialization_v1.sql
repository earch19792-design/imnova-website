-- Materialize the existing LUNA_FIELD_PRODUCT_TRUTH_V1 contract directly on
-- the complete Luna catalog snapshot authority. This does not create a second
-- truth system: legacy opportunity rows keep their existing assessment receipt,
-- while snapshot-native candidates retain the same receipt beside their source.

alter table public.luna_catalog_snapshot_variants_v1
  add column if not exists field_truth_v1 jsonb null;

create or replace function public.derive_luna_catalog_snapshot_field_truth_v1(
  p_variant jsonb
) returns jsonb
language plpgsql
immutable
set search_path=pg_catalog,public,extensions
as $$
declare
  v_snapshot_id text := p_variant->>'snapshot_id';
  v_product_id text := p_variant->>'product_id';
  v_variant_id text := p_variant->>'variant_id';
  v_sku text := p_variant->>'sku';
  v_observed_at text := p_variant->>'observed_at';
  v_product_receipt_id text;
  v_variant_receipt_id text;
  v_compare_at jsonb := 'null'::jsonb;
  v_product jsonb;
  v_snapshot jsonb;
  v_receipt jsonb;
  v_core jsonb;
begin
  if coalesce(p_variant->>'preflight_status','') <> 'PREFLIGHT_PASS'
    or coalesce(v_snapshot_id,'') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(v_product_id,'') !~ '^[0-9]+$'
    or coalesce(v_variant_id,'') !~ '^[0-9]+$'
    or coalesce(v_sku,'') = ''
    or coalesce(p_variant->>'canonical_url','') !~
      '^https://(www\.)?lunaportex\.com/products/[^/?#]+'
    or coalesce(p_variant->>'source_fingerprint','') !~ '^sha256:[0-9a-f]{64}$'
    or v_observed_at is null
  then
    raise exception 'LUNA_CATALOG_FIELD_TRUTH_SOURCE_BINDING_INVALID';
  end if;

  v_product_receipt_id := format('luna_catalog:%s:%s',
    v_snapshot_id,v_product_id);
  v_variant_receipt_id := format('luna_catalog:%s:%s:%s',
    v_snapshot_id,v_product_id,v_variant_id);

  if jsonb_typeof(p_variant->'compare_at_price') = 'number'
    and (p_variant->>'compare_at_price')::numeric > 0
  then
    v_compare_at := p_variant->'compare_at_price';
  end if;

  v_product := jsonb_build_object(
    'id',v_product_receipt_id,
    'supplier_product_id',v_product_id,
    'product_url',p_variant->>'canonical_url',
    'title',p_variant->>'title',
    'body_html',p_variant#>>'{source_fields,body_html}',
    'metadata',jsonb_build_object('source_product_fields_v1',
      coalesce(p_variant->'source_fields','{}'::jsonb)),
    'image_urls',coalesce(p_variant->'images','[]'::jsonb),
    'last_snapshot_at',v_observed_at,
    'updated_at_source',v_observed_at);

  v_snapshot := jsonb_build_object(
    'id',v_variant_receipt_id,
    'product_id',v_product_receipt_id,
    'supplier_variant_id',v_variant_id,
    'sku',v_sku,
    'price',p_variant->'price',
    'compare_at_price',v_compare_at,
    'barcode',p_variant->'barcode_gtin',
    'available',p_variant->'availability',
    'inventory_quantity',null,
    'weight',p_variant->'weight',
    'weight_unit',p_variant->>'weight_unit',
    'raw',jsonb_build_object(
      'product',jsonb_build_object('title',p_variant->'title'),
      'variant',jsonb_build_object(
        'price',p_variant->'price',
        'compare_at_price',v_compare_at,
        'barcode',p_variant->'barcode_gtin',
        'available',p_variant->'availability')),
    'captured_at',v_observed_at,
    'source_observed_at',v_observed_at);

  v_receipt := public.derive_luna_field_truth_v1(v_product,v_snapshot,
    jsonb_build_object('lunaProductId',v_product_id,
      'lunaVariantId',v_variant_id,'supplierSku',v_sku),'{}'::jsonb);
  v_core := (v_receipt-'evidenceDigest') || jsonb_build_object(
    'sourceSnapshotId',v_snapshot_id,
    'sourceProductId',v_product_id,
    'sourceVariantId',v_variant_id,
    'sourceSupplierSku',v_sku,
    'sourceCatalogFingerprint',p_variant->>'source_fingerprint',
    'sourceCatalogAuthority','LUNA_SHOPIFY_PRODUCTS_JSON_STRUCTURED_FEED');
  return v_core || jsonb_build_object('evidenceDigest','sha256:'||encode(
    digest(v_core::text,'sha256'),'hex'));
end;
$$;

create or replace function public.luna_catalog_field_truth_trigger_v1()
returns trigger
language plpgsql
set search_path=pg_catalog,public
as $$
begin
  new.field_truth_v1 := case when new.preflight_status='PREFLIGHT_PASS'
    then public.derive_luna_catalog_snapshot_field_truth_v1(to_jsonb(new))
    else null end;
  return new;
end;
$$;

drop trigger if exists luna_catalog_field_truth_v1
  on public.luna_catalog_snapshot_variants_v1;
create trigger luna_catalog_field_truth_v1
before insert or update of snapshot_id,product_id,variant_id,sku,canonical_url,
  title,price,compare_at_price,availability,options,weight,weight_unit,images,
  product_type,barcode_gtin,source_fields,source_fingerprint,observed_at,
  preflight_status,preflight_reasons,identity_result,field_truth_v1
on public.luna_catalog_snapshot_variants_v1
for each row execute function public.luna_catalog_field_truth_trigger_v1();

do $$ begin
  if not exists (select 1 from pg_constraint
    where conrelid='public.luna_catalog_snapshot_variants_v1'::regclass
      and conname='luna_catalog_snapshot_field_truth_v1_check') then
    alter table public.luna_catalog_snapshot_variants_v1
      add constraint luna_catalog_snapshot_field_truth_v1_check check (
        field_truth_v1 is null or (
          field_truth_v1->>'contractVersion'='LUNA_FIELD_PRODUCT_TRUTH_V1'
          and field_truth_v1->>'sourceAuthorityContract'=
            'SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1'
          and field_truth_v1->>'sourceSnapshotId'=snapshot_id::text
          and field_truth_v1->>'sourceProductId'=product_id
          and field_truth_v1->>'sourceVariantId'=variant_id
          and field_truth_v1->>'sourceSupplierSku'=sku
          and field_truth_v1->>'sourceCatalogFingerprint'=source_fingerprint
          and coalesce(field_truth_v1->>'evidenceDigest','') ~
            '^sha256:[0-9a-f]{64}$'
          and jsonb_typeof(field_truth_v1->'fields')='array'
          and jsonb_array_length(field_truth_v1->'fields')=25
        )
      ) not valid;
  end if;
end $$;

-- Recover only the current complete snapshot. Historical snapshots stay
-- immutable source history and are not needed by the current Product Case.
with current_snapshot as (
  select snapshot_id from public.luna_catalog_snapshots_v1
  where snapshot_status='COMPLETE'
  order by snapshot_completed_at desc limit 1
)
update public.luna_catalog_snapshot_variants_v1 variant
set field_truth_v1=public.derive_luna_catalog_snapshot_field_truth_v1(
  to_jsonb(variant))
from current_snapshot
where variant.snapshot_id=current_snapshot.snapshot_id
  and variant.preflight_status='PREFLIGHT_PASS'
  and variant.field_truth_v1 is distinct from
    public.derive_luna_catalog_snapshot_field_truth_v1(to_jsonb(variant));

alter table public.luna_catalog_snapshot_variants_v1
  validate constraint luna_catalog_snapshot_field_truth_v1_check;

do $$ declare f record; begin
  for f in select oid::regprocedure signature from pg_proc
    where pronamespace='public'::regnamespace and proname in (
      'derive_luna_catalog_snapshot_field_truth_v1',
      'luna_catalog_field_truth_trigger_v1') loop
    execute format('revoke all on function %s from public,anon,authenticated',
      f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

comment on column public.luna_catalog_snapshot_variants_v1.field_truth_v1 is
  'Durable LUNA_FIELD_PRODUCT_TRUTH_V1 receipt derived only from this exact snapshot variant; unknown fields remain missing.';
