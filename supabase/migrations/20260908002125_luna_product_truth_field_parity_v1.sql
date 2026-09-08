-- Reuse Luna catalog snapshots and assessment.productTruth. No new table,
-- scheduler, marketplace authority, or downstream stage transition.
-- Field records retain the existing audit vocabulary and supplier authority.

create or replace function public.luna_truth_text_v1(p_text text)
returns text language sql immutable set search_path=pg_catalog as $$
  select trim(regexp_replace(
    replace(replace(replace(replace(replace(
      regexp_replace(coalesce(p_text,''),'<[^>]*>',' ','g'),
      E'\\n',' '), E'\\"','"'),'&quot;','"'),'&amp;','&'),'&nbsp;',' '),
    '[[:space:]]+',' ','g'));
$$;

create or replace function public.luna_truth_observation_v1(
  p_field text,p_value jsonb,p_raw jsonb,p_locator text,p_source_id text,
  p_captured timestamptz,p_observed timestamptz,p_expires timestamptz,
  p_class text default 'FACT'
) returns jsonb language sql immutable
set search_path=pg_catalog,extensions as $$
  select jsonb_build_object(
    'FIELD',p_field,'VALUE',p_value,'RAW_VALUE',p_raw,
    'SEMANTIC_CLASS',p_class,'SOURCE','LUNA_EXACT_VARIANT',
    'SOURCE_AUTHORITY','SUPPLIER','SOURCE_LOCATOR_OR_FIELD',p_locator,
    'CAPTURED_AT',p_captured,'OBSERVED_AT',p_observed,'FRESH_UNTIL',p_expires,
    'CONFIDENCE',case when p_class='FACT' then 1.0 else 0.5 end,
    'EVIDENCE_ID','sha256:'||encode(digest(jsonb_build_array(
      p_field,p_value,p_raw,p_locator,p_source_id,p_captured,p_observed,p_class
    )::text,'sha256'),'hex'),
    'SOURCE_RECEIPT_ID',p_source_id,
    'REASONING_BASIS',case when p_class='SUPPLIER_CLAIM'
      then 'Supplier statement; no independent verification'
      else 'Explicit exact Luna source field; normalization only' end);
$$;

create or replace function public.luna_truth_measurements_v1(p_value text)
returns jsonb language sql immutable set search_path=pg_catalog as $$
  with parts as (
    select m,ordinality from regexp_matches(replace(p_value,E'\\"','"'),
      '([0-9]+(?:\.[0-9]+)?)[[:space:]]*("|inches?|in|centimeters?|cm|millimeters?|mm|ft|feet|oz|lb|kg|g)(?![a-z])','gi')
      with ordinality r(m,ordinality)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'RAW_VALUE',m[1]||m[2],'NORMALIZED_VALUE',m[1]::numeric,
    'UNIT',case lower(m[2]) when '"' then 'in' when 'inch' then 'in'
      when 'inches' then 'in' when 'centimeter' then 'cm'
      when 'centimeters' then 'cm' when 'millimeter' then 'mm'
      when 'millimeters' then 'mm' when 'feet' then 'ft' else lower(m[2]) end,
    'ORDINAL_OR_SET_MEMBERSHIP',ordinality) order by ordinality),'[]'::jsonb)
  from parts;
$$;

create or replace function public.derive_luna_field_truth_v1(
  p_product jsonb,p_snapshot jsonb,p_expected_identity jsonb,p_package jsonb default '{}'
) returns jsonb language plpgsql immutable
set search_path=pg_catalog,public,extensions as $$
declare
  v_fields constant text[] := array['LUNA_PRODUCT_ID','LUNA_VARIANT_ID','SUPPLIER_SKU',
    'TITLE','BRAND','MODEL','MATERIAL','COLOR','DIMENSIONS','SIZE_SET','WEIGHT',
    'PACKAGE_CONTENTS','QUANTITY_OR_SET_COUNT','FORM_FACTOR','FEATURES','INTENDED_USES',
    'GTIN','MPN','SUPPLIER_COST','REGULAR_PRICE','SALE_PRICE','SUPPLIER_AVAILABILITY',
    'SUPPLIER_STOCK','IMAGES','VARIANT_OPTIONS'];
  v_product_id text := p_product->>'supplier_product_id';
  v_variant_id text := p_snapshot->>'supplier_variant_id';
  v_sku text := p_snapshot->>'sku';
  v_snapshot_id text := p_snapshot->>'id';
  v_pc timestamptz := (p_product->>'last_snapshot_at')::timestamptz;
  v_sc timestamptz := (p_snapshot->>'captured_at')::timestamptz;
  v_po timestamptz;
  v_so timestamptz;
  v_raw_variant jsonb := coalesce(p_snapshot#>'{raw,variant}','{}'::jsonb);
  v_raw_product jsonb := coalesce(p_snapshot#>'{raw,product}','{}'::jsonb);
  v_observations jsonb := '[]'; v_result jsonb := '[]'; v_unsupported jsonb := '[]';
  v_lines text[]; v_line text; v_title text; v_label text; v_value text;
  v_field text; v_class text; v_parsed jsonb; v_obs jsonb; v_selected jsonb;
  v_support jsonb; v_value_count integer; v_evidence_ids jsonb; v_units jsonb;
  v_match text[]; v_entry record; v_block record; v_capture timestamptz;
  v_observed timestamptz; v_expires timestamptz; v_locator text;
  v_receipt text; v_images jsonb; v_options jsonb; v_conflict boolean;
  v_known integer; v_claim integer; v_missing integer; v_contradicted integer;
  v_core jsonb; v_package_value jsonb; v_normalized text;
begin
  -- Exact source identity and source host binding are prerequisites.
  if v_product_id is distinct from p_expected_identity->>'lunaProductId'
    or v_variant_id is distinct from p_expected_identity->>'lunaVariantId'
    or v_sku is distinct from p_expected_identity->>'supplierSku'
    or p_product->>'id' is distinct from p_snapshot->>'product_id'
    or coalesce(p_product->>'product_url','') !~ '^https://(www\.)?lunaportex\.com/products/[^/?#]+'
    or v_pc is null or v_sc is null
  then raise exception 'LUNA_FIELD_TRUTH_EXACT_SOURCE_BINDING_INVALID'; end if;
  v_po := coalesce((p_product->>'updated_at_source')::timestamptz,v_pc);
  v_so := coalesce((p_snapshot->>'source_observed_at')::timestamptz,v_sc);
  v_title := public.luna_truth_text_v1(p_product->>'title');
  -- Preserve structural boundaries before cleaning tags/escaped HTML.
  v_lines := regexp_split_to_array(regexp_replace(
    replace(coalesce(p_product->>'body_html',''),E'\\n',E'\n'),
    '</(?:p|li|h[1-6]|tr)>|<br[^>]*>',E'\n','gi'),E'\n');

  for v_entry in select * from (values
    ('LUNA_PRODUCT_ID',to_jsonb(v_product_id),'product.supplier_product_id'),
    ('LUNA_VARIANT_ID',to_jsonb(v_variant_id),'snapshot.supplier_variant_id'),
    ('SUPPLIER_SKU',to_jsonb(v_sku),'snapshot.sku'),
    ('TITLE',to_jsonb(v_title),'product.title'),
    ('SUPPLIER_COST',p_snapshot->'price','snapshot.price'),
    ('REGULAR_PRICE',p_snapshot->'compare_at_price','snapshot.compare_at_price'),
    ('GTIN',to_jsonb(nullif(p_snapshot->>'barcode','')),'snapshot.barcode')
  ) t(field,value,locator) loop
    if v_entry.value is null or v_entry.value='null'::jsonb or v_entry.value='""'::jsonb
      then continue; end if;
    if v_entry.field='GTIN' and v_entry.value#>>'{}' !~ '^[0-9]{8,14}$'
      then continue; end if;
    v_capture := case when v_entry.locator like 'product.%' then v_pc else v_sc end;
    v_observed := case when v_entry.locator like 'product.%' then v_po else v_so end;
    v_expires := case when v_entry.field in ('SUPPLIER_COST','REGULAR_PRICE')
      then v_sc+interval '24 hours' else null end;
    v_observations := v_observations||jsonb_build_array(public.luna_truth_observation_v1(
      v_entry.field,v_entry.value,v_entry.value,v_entry.locator,
      case when v_entry.locator like 'product.%' then p_product->>'id' else v_snapshot_id end,
      v_capture,v_observed,v_expires));
  end loop;
  -- Snapshot raw fields remain independent assertions. A normalization mismatch
  -- with raw variant/product data is a contradiction, not a priority decision.
  for v_entry in select * from (values
    ('TITLE',v_raw_product->'title','snapshot.raw.product.title'),
    ('SUPPLIER_COST',v_raw_variant->'price','snapshot.raw.variant.price'),
    ('REGULAR_PRICE',v_raw_variant->'compare_at_price','snapshot.raw.variant.compare_at_price'),
    ('GTIN',v_raw_variant->'barcode','snapshot.raw.variant.barcode'),
    ('SUPPLIER_AVAILABILITY',v_raw_variant->'available','snapshot.raw.variant.available')
  ) t(field,value,locator) loop
    if v_entry.value is null or v_entry.value in ('null'::jsonb,'""'::jsonb) then continue; end if;
    v_parsed:=v_entry.value;
    if v_entry.field in ('SUPPLIER_COST','REGULAR_PRICE') then
      if v_parsed#>>'{}' !~ '^[0-9]+(\.[0-9]+)?$' then continue; end if;
      v_parsed:=to_jsonb((v_parsed#>>'{}')::numeric);
    elsif v_entry.field='SUPPLIER_AVAILABILITY' then
      if jsonb_typeof(v_parsed)<>'boolean' then continue; end if;
      v_parsed:=to_jsonb(case when (v_parsed#>>'{}')::boolean then 'AVAILABLE'::text else 'OUT_OF_STOCK' end);
    elsif v_entry.field='TITLE' then
      v_parsed:=to_jsonb(public.luna_truth_text_v1(v_parsed#>>'{}'));
    elsif v_entry.field='GTIN' and v_parsed#>>'{}' !~ '^[0-9]{8,14}$' then continue;
    end if;
    v_observations:=v_observations||jsonb_build_array(public.luna_truth_observation_v1(
      v_entry.field,v_parsed,v_entry.value,v_entry.locator,v_snapshot_id,v_sc,v_so,
      case when v_entry.field in ('SUPPLIER_COST','REGULAR_PRICE','SUPPLIER_AVAILABILITY')
        then v_sc+interval '24 hours' else null end));
  end loop;
  if (p_snapshot->>'price')::numeric < (p_snapshot->>'compare_at_price')::numeric then
    v_observations:=v_observations||jsonb_build_array(public.luna_truth_observation_v1(
      'SALE_PRICE',p_snapshot->'price',p_snapshot->'price',
      'snapshot.price < snapshot.compare_at_price',v_snapshot_id,v_sc,v_so,
      v_sc+interval '24 hours'));
  end if;
  if jsonb_typeof(p_snapshot->'available')='boolean' then
    v_observations:=v_observations||jsonb_build_array(public.luna_truth_observation_v1(
      'SUPPLIER_AVAILABILITY',to_jsonb(case when (p_snapshot->>'available')::boolean
        then 'AVAILABLE'::text else 'OUT_OF_STOCK' end),p_snapshot->'available',
      'snapshot.available',v_snapshot_id,v_sc,v_so,v_sc+interval '24 hours'));
  end if;
  -- Availability alone never demonstrates numeric stock, including zero.
  if jsonb_typeof(p_snapshot->'inventory_quantity')='number'
    and (p_snapshot->>'inventory_quantity')::numeric>=0
    and (p_snapshot->>'inventory_quantity')::numeric=trunc((p_snapshot->>'inventory_quantity')::numeric)
    and (jsonb_typeof(v_raw_variant->'inventory_quantity')='number'
      or p_snapshot#>>'{raw,inventory_context,inventory_scope}'='variant_level')
  then
    v_observations:=v_observations||jsonb_build_array(public.luna_truth_observation_v1(
      'SUPPLIER_STOCK',jsonb_build_object('status','QUANTITY_PROVEN',
        'quantity',p_snapshot->'inventory_quantity'),p_snapshot->'inventory_quantity',
      'snapshot.inventory_quantity + explicit variant inventory context',
      v_snapshot_id,v_sc,v_so,v_sc+interval '24 hours'));
  end if;
  if (p_snapshot->>'weight')::numeric>0 and nullif(p_snapshot->>'weight_unit','') is not null then
    v_observations:=v_observations||jsonb_build_array(public.luna_truth_observation_v1(
      'WEIGHT',jsonb_build_object('NORMALIZED_VALUE',p_snapshot->'weight',
        'UNIT',p_snapshot->'weight_unit'),jsonb_build_object('weight',p_snapshot->'weight',
        'unit',p_snapshot->'weight_unit'),'snapshot.weight,weight_unit',
      v_snapshot_id,v_sc,v_so,null));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('SOURCE_IMAGE_URL',url,
    'IMAGE_ORDINAL',ord,'VARIANT_ASSOCIATION_IF_PROVEN',
      case when v_raw_variant#>>'{featured_image,src}'=url then v_variant_id else null end,
    'CAPTURED_AT',v_pc) order by ord),'[]'::jsonb) into v_images
  from jsonb_array_elements_text(coalesce(p_product->'image_urls','[]')) with ordinality im(url,ord)
  where url ~ '^https://';
  if jsonb_array_length(v_images)>0 then
    v_observations:=v_observations||jsonb_build_array(public.luna_truth_observation_v1(
      'IMAGES',v_images,p_product->'image_urls','product.image_urls',
      p_product->>'id',v_pc,v_po,null));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('SOURCE_FIELD',key,'RAW_VALUE',value,
    'NORMALIZED_VALUE',value,'ORDINAL_OR_SET_MEMBERSHIP',right(key,1)::integer)
    order by key),'[]') into v_options from jsonb_each(v_raw_variant)
  where key in ('option1','option2','option3') and value<>'null'::jsonb and value<>'""'::jsonb;
  if jsonb_array_length(v_options)>0 then
    v_observations:=v_observations||jsonb_build_array(public.luna_truth_observation_v1(
      'VARIANT_OPTIONS',v_options,v_options,'snapshot.raw.variant.option1..3',
      v_snapshot_id,v_sc,v_so,null));
  end if;

  -- Structured supplier fields and labelled prose are independent observations.
  -- Never merge sources before detecting conflicts, or use package/reference
  -- values, supplier vendor, title-prefix brands, or human visual annotations.
  for v_block in select * from (values
    (coalesce(p_product#>'{metadata,source_product_fields_v1}','{}'::jsonb),
      'product.metadata.source_product_fields_v1',v_pc,v_po),
    (v_raw_product,'snapshot.raw.product',v_sc,v_so),
    (v_raw_variant,'snapshot.raw.variant',v_sc,v_so)
  ) x(data,locator,captured,observed) loop
    for v_entry in select key,value from jsonb_each(v_block.data) loop
      v_label:=lower(regexp_replace(v_entry.key,'[_ -]+',' ','g'));
      v_field:=case v_label when 'brand' then 'BRAND' when 'manufacturer brand' then 'BRAND'
        when 'model' then 'MODEL' when 'mpn' then 'MPN' when 'material' then 'MATERIAL'
        when 'color' then 'COLOR' when 'colour' then 'COLOR' when 'dimensions' then 'DIMENSIONS'
        when 'size set' then 'SIZE_SET' when 'package contents' then 'PACKAGE_CONTENTS'
        when 'pack quantity' then 'QUANTITY_OR_SET_COUNT' when 'set count' then 'QUANTITY_OR_SET_COUNT'
        when 'form factor' then 'FORM_FACTOR' when 'features' then 'FEATURES'
        when 'intended uses' then 'INTENDED_USES' else null end;
      if v_field is null or v_entry.value in ('null'::jsonb,'""'::jsonb,'[]'::jsonb,'{}'::jsonb)
        then continue; end if;
      v_parsed:=v_entry.value;
      if v_field='QUANTITY_OR_SET_COUNT' then
        if v_entry.value#>>'{}' !~ '^[1-9][0-9]{0,3}$' then continue; end if;
        v_parsed:=to_jsonb((v_entry.value#>>'{}')::integer);
      elsif v_field='SIZE_SET' and jsonb_typeof(v_parsed)='string' then
        v_parsed:=public.luna_truth_measurements_v1(v_parsed#>>'{}');
        if v_parsed='[]'::jsonb then continue; end if;
      end if;
      v_class:=case when v_field='FEATURES' or v_entry.value::text ~*
        '\m(rust[- ]?(resistant|proof)|dishwasher[- ]safe|premium|durable|best|guaranteed)\M'
        then 'SUPPLIER_CLAIM' else 'FACT' end;
      v_observations:=v_observations||jsonb_build_array(public.luna_truth_observation_v1(
        v_field,v_parsed,v_entry.value,v_block.locator||'.'||v_entry.key,
        case when v_block.locator like 'product.%' then p_product->>'id' else v_snapshot_id end,
        v_block.captured,v_block.observed,null,v_class));
    end loop;
  end loop;
  for v_entry in select value line,ordinality ord
    from unnest(v_lines) with ordinality lines(value,ordinality) loop
    v_line:=public.luna_truth_text_v1(v_entry.line);
    if v_line='' then continue; end if;
    v_match:=regexp_match(v_line,
      '^(?:[^[:alnum:]]*)?(Brand|Manufacturer Brand|Model|MPN|Material|Colou?r|Dimensions|Sizes Included|Size Set|Package Contents|Set Includes|Number in Pack|Pack Quantity|Design|Form Factor|Intended Uses|Cleaning)[[:space:]]*:[[:space:]]*(.+)$','i');
    if v_match is null then continue; end if;
    v_label:=lower(v_match[1]); v_value:=trim(v_match[2]);
    v_field:=case v_label when 'brand' then 'BRAND' when 'manufacturer brand' then 'BRAND'
      when 'model' then 'MODEL' when 'mpn' then 'MPN' when 'material' then 'MATERIAL'
      when 'color' then 'COLOR' when 'colour' then 'COLOR' when 'dimensions' then 'DIMENSIONS'
      when 'sizes included' then 'SIZE_SET' when 'size set' then 'SIZE_SET'
      when 'package contents' then 'PACKAGE_CONTENTS' when 'set includes' then 'PACKAGE_CONTENTS'
      when 'number in pack' then 'QUANTITY_OR_SET_COUNT' when 'pack quantity' then 'QUANTITY_OR_SET_COUNT'
      when 'design' then 'FORM_FACTOR' when 'form factor' then 'FORM_FACTOR'
      when 'intended uses' then 'INTENDED_USES' when 'cleaning' then 'FEATURES' end;
    v_parsed:=to_jsonb(v_value);
    if v_field='SIZE_SET' then
      v_parsed:=public.luna_truth_measurements_v1(v_value);
      if v_parsed='[]'::jsonb then continue; end if;
    elsif v_field='QUANTITY_OR_SET_COUNT' then
      if v_value !~ '^[1-9][0-9]{0,3}$' then continue; end if;
      v_parsed:=to_jsonb(v_value::integer);
    end if;
    v_class:=case when v_field='FEATURES' or v_value ~*
      '\m(rust[- ]?(resistant|proof)|dishwasher[- ]safe|premium|durable|best|guaranteed)\M'
      then 'SUPPLIER_CLAIM' else 'FACT' end;
    v_observations:=v_observations||jsonb_build_array(public.luna_truth_observation_v1(
      v_field,v_parsed,to_jsonb(v_value),'product.body_html#line:'||v_entry.ord,
      p_product->>'id',v_pc,v_po,null,v_class));
  end loop;
  -- All explicit count assertions are retained so disagreement cannot disappear.
  for v_block in select * from (values(v_title,'product.title'),
    (public.luna_truth_text_v1(p_product->>'body_html'),'product.body_html')) b(value,locator) loop
    for v_match in select regexp_matches(v_block.value,
      '\m([0-9]{1,3})[ -]*(?:pieces?|pcs?)\M|\mset[[:space:]]+of[[:space:]]+([0-9]{1,3})\M','gi') loop
      v_value:=coalesce(v_match[1],v_match[2]);
      if v_value::integer<1 then continue; end if;
      v_observations:=v_observations||jsonb_build_array(public.luna_truth_observation_v1(
        'QUANTITY_OR_SET_COUNT',to_jsonb(v_value::integer),to_jsonb(v_value),
        v_block.locator||'#explicit-count',p_product->>'id',v_pc,v_po,null));
    end loop;
  end loop;
  -- Contents may be captured as the explicit count-bearing set phrase. Do not
  -- manufacture a component name or assign one of several sizes to an item.
  v_match:=regexp_match(v_title,'([0-9]+[ -]*(?:pieces?|pcs?).*\mset\M.*|\mset[[:space:]]+of[[:space:]]+[0-9]+.*)','i');
  if v_match is not null and not exists(select 1 from jsonb_array_elements(v_observations) o
    where o->>'FIELD'='PACKAGE_CONTENTS') then
    v_observations:=v_observations||jsonb_build_array(public.luna_truth_observation_v1(
      'PACKAGE_CONTENTS',jsonb_build_array(jsonb_build_object(
        'RAW_VALUE',v_match[1],'NORMALIZED_VALUE',public.luna_truth_text_v1(v_match[1]),
        'UNIT',null,'ORDINAL_OR_SET_MEMBERSHIP',1)),to_jsonb(v_match[1]),
      'product.title#explicit-set-phrase',p_product->>'id',v_pc,v_po,null));
  end if;
  -- Feature/usage sections are captured as supplier statements, not interpreted
  -- from images or promoted from downstream marketplace packages.
  v_field:=null;
  for v_entry in select value line,ordinality ord
    from unnest(v_lines) with ordinality lines(value,ordinality) loop
    v_line:=public.luna_truth_text_v1(v_entry.line);
    if v_entry.line ~* '<h[1-6]' then
      v_field:=case when v_line ~* '(features|benefits)' then 'FEATURES'
        when v_line ~* '(perfect for|intended uses|uses|applications)' then 'INTENDED_USES'
        else null end;
      continue;
    end if;
    if v_field is not null and v_entry.line ~* '<li' and v_line<>'' then
      v_observations:=v_observations||jsonb_build_array(public.luna_truth_observation_v1(
        v_field,to_jsonb(v_line),to_jsonb(v_line),
        'product.body_html#line:'||v_entry.ord,p_product->>'id',v_pc,v_po,null,
        case when v_field='FEATURES' then 'SUPPLIER_CLAIM' else 'FACT' end));
    end if;
  end loop;

  foreach v_field in array v_fields loop
    select coalesce(jsonb_agg(distinct o order by o),'[]'),
      count(distinct case when jsonb_typeof(o->'VALUE')='string' then
        to_jsonb(lower(regexp_replace(o->>'VALUE','[[:space:]]+',' ','g'))) else o->'VALUE' end),
      coalesce(jsonb_agg(distinct o->'EVIDENCE_ID'),'[]')
    into v_support,v_value_count,v_evidence_ids
    from jsonb_array_elements(v_observations) o where o->>'FIELD'=v_field;
    v_conflict:=v_value_count>1 and v_field not in ('FEATURES','INTENDED_USES');
    v_selected:=coalesce(v_support->0,'{}');
    v_class:=case when v_conflict then 'CONTRADICTED'
      when v_value_count=0 then 'MISSING'
      when exists(select 1 from jsonb_array_elements(v_support) o
        where o->>'SEMANTIC_CLASS'='SUPPLIER_CLAIM') then 'SUPPLIER_CLAIM'
      else 'FACT' end;
    v_parsed:=case when v_conflict or v_value_count=0 then 'null'::jsonb
      when v_field in ('FEATURES','INTENDED_USES') then
        (select jsonb_agg(distinct o->'VALUE') from jsonb_array_elements(v_support) o)
      else v_selected->'VALUE' end;
    if v_field in ('SIZE_SET','PACKAGE_CONTENTS','DIMENSIONS') and jsonb_typeof(v_parsed)='array' then
      select jsonb_agg(case when jsonb_typeof(member)='object' then member||jsonb_build_object(
        'SOURCE_EVIDENCE',v_evidence_ids) else jsonb_build_object('RAW_VALUE',member,
        'NORMALIZED_VALUE',member,'UNIT',null,'ORDINAL_OR_SET_MEMBERSHIP',ordinal,
        'SOURCE_EVIDENCE',v_evidence_ids) end order by ordinal) into v_parsed
        from jsonb_array_elements(v_parsed) with ordinality m(member,ordinal);
    end if;
    v_obs:=jsonb_build_object('FIELD',v_field,'VALUE',v_parsed,
      'SEMANTIC_CLASS',v_class,'EVIDENCE_STATUS',case when v_class='FACT' then 'PROVEN'
        when v_class='SUPPLIER_CLAIM' then 'UNPROVEN' else v_class end,
      'SOURCE','LUNA_EXACT_VARIANT','SOURCE_AUTHORITY','SUPPLIER',
      'SOURCE_LOCATOR_OR_FIELD',v_selected->'SOURCE_LOCATOR_OR_FIELD',
      'CAPTURED_AT',v_selected->'CAPTURED_AT','OBSERVED_AT',v_selected->'OBSERVED_AT',
      'FRESH_UNTIL',v_selected->'FRESH_UNTIL',
      'CONFIDENCE',case when v_class='FACT' then 1.0 when v_class='SUPPLIER_CLAIM' then 0.5 else 0 end,
      'EVIDENCE_ID',case when v_value_count=0 then null else 'sha256:'||encode(
        digest(jsonb_build_array(v_field,v_support)::text,'sha256'),'hex') end,
      'REASONING_BASIS',case when v_conflict then 'Incompatible explicit Luna observations; no source silently selected'
        when v_value_count=0 then 'No sufficient explicit Luna source evidence'
        when v_class='SUPPLIER_CLAIM' then 'Supplier statement; no independent verification'
        else 'Explicit Luna evidence; normalized without adding product facts' end,
      'CONTRADICTION',v_conflict,'CONFLICTING_EVIDENCE_IDS',
        case when v_conflict then v_evidence_ids else '[]'::jsonb end,
      'RESOLUTION_STATUS',case when v_conflict then 'UNRESOLVED' else 'NOT_APPLICABLE' end,
      'SOURCE_EVIDENCE',v_support);
    if v_field='SUPPLIER_STOCK' and v_class='MISSING' then
      v_obs:=v_obs||jsonb_build_object('QUANTITY_STATUS','QUANTITY_UNPROVEN',
        'CAPTURED_AT',v_sc,'OBSERVED_AT',v_so,'FRESH_UNTIL',v_sc+interval '24 hours');
    end if;
    v_result:=v_result||jsonb_build_array(v_obs);
    -- Downstream values are diagnostic only; never inputs to truth.
    if v_field in ('BRAND','MODEL','MPN') then
      select value into v_package_value from jsonb_each(
        coalesce(p_package->'requiredItemSpecifics',p_package->'itemSpecifics','{}'))
        where upper(key)=v_field limit 1;
      v_package_value:=coalesce(v_package_value,p_package->lower(v_field));
      if v_package_value is not null and v_package_value<>'null'::jsonb
        and (v_class<>'FACT' or lower(v_package_value::text)<>lower(v_parsed::text)) then
        v_unsupported:=v_unsupported||jsonb_build_array(jsonb_build_object(
          'FIELD',v_field,'DOWNSTREAM_VALUE',v_package_value,
          'CONTRADICTION',true,'REASON','UNSUPPORTED_DOWNSTREAM_VALUE',
          'CONFLICTING_EVIDENCE_IDS',jsonb_build_array(p_package->>'id',v_obs->>'EVIDENCE_ID'),
          'RESOLUTION_STATUS','UNRESOLVED','PACKAGE_CHANGED',false));
      end if;
    end if;
  end loop;
  select count(*) filter(where f->>'SEMANTIC_CLASS'='FACT'),
    count(*) filter(where f->>'SEMANTIC_CLASS'='SUPPLIER_CLAIM'),
    count(*) filter(where f->>'SEMANTIC_CLASS'='MISSING'),
    count(*) filter(where f->>'SEMANTIC_CLASS'='CONTRADICTED')
  into v_known,v_claim,v_missing,v_contradicted from jsonb_array_elements(v_result) f;
  v_core:=jsonb_build_object('contractVersion','LUNA_FIELD_PRODUCT_TRUTH_V1',
    'sourceAuthorityContract','SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1',
    'fields',v_result,'unsupportedDownstreamValues',v_unsupported,
    'sourceReceiptIds',jsonb_build_array(p_product->>'id',v_snapshot_id),
    'sourceFingerprint','sha256:'||encode(digest(jsonb_build_array(
      p_product,p_snapshot,p_expected_identity,p_package)::text,'sha256'),'hex'),
    'counts',jsonb_build_object('sourceFieldsDiscovered',v_known+v_claim+v_contradicted,
      'facts',v_known,'supplierClaims',v_claim,'inferred',0,'missing',v_missing,
      'contradicted',v_contradicted),
    'status',case when v_contradicted>0 then 'CONTRADICTED'
      when v_missing>0 or v_claim>0 then 'PARTIAL' else 'PROVEN' end,
    'capturedAt',greatest(v_pc,v_sc),'marketplaceWrites',0,'downstreamAdvancements',0);
  return v_core||jsonb_build_object('evidenceDigest','sha256:'||encode(
    digest(v_core::text,'sha256'),'hex'));
end;
$$;

-- The existing assessment owns the current materialization and its immutable
-- versions. Incoming legacy writers cannot remove historical source receipts.
create or replace function public.merge_luna_field_truth_assessment_v1(
  p_assessment jsonb,p_previous jsonb,p_receipt jsonb
) returns jsonb language plpgsql immutable set search_path=pg_catalog,extensions as $$
declare
  a jsonb:=coalesce(p_assessment,'{}');
  old_truth jsonb:=coalesce(p_previous->'productTruth','{}');
  truth jsonb:=coalesce(p_assessment->'productTruth','{}');
  history jsonb:=coalesce(old_truth->'fieldTruthHistoryV1','[]');
  current_receipt jsonb:=old_truth->'fieldTruthV1';
  next_receipt jsonb:=p_receipt;
  next_fields jsonb;
  legacy jsonb:=coalesce(old_truth->'legacyProductTruthReceiptV1',
    case when old_truth<>'{}'::jsonb and current_receipt is null then old_truth end);
begin
  if current_receipt is not null and not exists(select 1 from jsonb_array_elements(history) h
    where h->>'evidenceDigest'=current_receipt->>'evidenceDigest') then
    history:=history||jsonb_build_array(current_receipt);
  end if;
  if next_receipt is not null then
    -- Re-normalization of the same/older source cannot erase an existing fact.
    -- Freshness remains tied to the retained observation, never refreshed here.
    if current_receipt is not null then
      select jsonb_agg(case when old_field->>'SEMANTIC_CLASS'='FACT'
        and new_field->>'SEMANTIC_CLASS'='MISSING'
        and (next_receipt->>'capturedAt')::timestamptz <=
          (current_receipt->>'capturedAt')::timestamptz
        then old_field else new_field end order by ordinal)
      into next_fields
      from jsonb_array_elements(next_receipt->'fields') with ordinality n(new_field,ordinal)
      left join lateral (select f old_field from jsonb_array_elements(current_receipt->'fields') f
        where f->>'FIELD'=new_field->>'FIELD') old on true;
      if next_fields is distinct from next_receipt->'fields' then
        next_receipt:=jsonb_set(next_receipt,'{fields}',next_fields)-'evidenceDigest';
        next_receipt:=jsonb_set(next_receipt,'{counts}',(select jsonb_build_object(
          'sourceFieldsDiscovered',count(*) filter(where f->>'SEMANTIC_CLASS'<>'MISSING'),
          'facts',count(*) filter(where f->>'SEMANTIC_CLASS'='FACT'),
          'supplierClaims',count(*) filter(where f->>'SEMANTIC_CLASS'='SUPPLIER_CLAIM'),
          'missing',count(*) filter(where f->>'SEMANTIC_CLASS'='MISSING'),
          'contradicted',count(*) filter(where f->>'SEMANTIC_CLASS'='CONTRADICTED'),'inferred',0)
          from jsonb_array_elements(next_fields) f));
        next_receipt:=next_receipt||jsonb_build_object('evidenceDigest','sha256:'||
          encode(digest(next_receipt::text,'sha256'),'hex'));
      end if;
    end if;
    -- A catalog pointer replay must not replace newer truth with older data.
    if current_receipt is null or (next_receipt->>'capturedAt')::timestamptz >=
      (current_receipt->>'capturedAt')::timestamptz then
      current_receipt:=next_receipt;
    end if;
    if not exists(select 1 from jsonb_array_elements(history) h
      where h->>'evidenceDigest'=current_receipt->>'evidenceDigest') then
      history:=history||jsonb_build_array(current_receipt);
    end if;
  end if;
  if current_receipt is null then return a; end if;
  truth:=truth||jsonb_build_object('fieldTruthV1',current_receipt,'fieldTruthHistoryV1',history);
  if legacy is not null then truth:=truth||jsonb_build_object('legacyProductTruthReceiptV1',legacy); end if;
  return a||jsonb_build_object('productTruth',truth);
end;
$$;

create or replace function public.materialize_luna_field_truth_assessment_v1(
  p_queue jsonb,p_previous jsonb default '{}'
) returns jsonb language plpgsql volatile set search_path=pg_catalog,public as $$
declare p jsonb; s jsonb; pkg jsonb; receipt jsonb;
begin
  select to_jsonb(product),to_jsonb(snapshot) into p,s
  from public.market_radar_products product
  join public.market_radar_sources source on source.id=product.source_id and source.key='lunaportex'
  join public.market_radar_current_variant_snapshots current_snapshot on current_snapshot.product_id=product.id
  join public.market_radar_snapshots snapshot on snapshot.id=current_snapshot.snapshot_id
  where product.supplier_product_id=p_queue->>'supplier_product_id'
    and snapshot.supplier_variant_id=p_queue->>'supplier_variant_id'
    and snapshot.sku=p_queue->>'supplier_sku';
  if p is not null and s is not null then
    select coalesce(package_data,'{}')||jsonb_build_object('id',id)
      into pkg from public.ebay_listing_packages
      where candidate_key=p_queue->>'candidate_key' order by updated_at desc,id limit 1;
    receipt:=public.derive_luna_field_truth_v1(p,s,jsonb_build_object(
      'lunaProductId',p_queue->>'supplier_product_id',
      'lunaVariantId',p_queue->>'supplier_variant_id',
      'supplierSku',p_queue->>'supplier_sku'),coalesce(pkg,'{}'));
  end if;
  return public.merge_luna_field_truth_assessment_v1(p_queue->'assessment',p_previous,receipt);
end;
$$;

create or replace function public.luna_queue_field_truth_trigger_v1()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  new.assessment:=public.materialize_luna_field_truth_assessment_v1(to_jsonb(new),
    case when tg_op='UPDATE' then old.assessment else '{}'::jsonb end);
  return new;
end;
$$;
create trigger luna_queue_field_truth_v1
before insert or update of assessment,market_radar_product_id,supplier_product_id,supplier_variant_id,supplier_sku
on public.ebay_luna_opportunity_queue for each row
execute function public.luna_queue_field_truth_trigger_v1();

-- Bounded, cohort-wide and repeatable; only assessment changes. No queue stage,
-- decision, package, authorization, or original source receipt is updated.
create or replace function public.recover_luna_product_truth_parity_v1(p_limit integer default 200)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare q record; a jsonb; affected integer:=0; recovered integer:=0; queue_id uuid;
begin
  if p_limit<1 or p_limit>1000 then raise exception 'LUNA_RECOVERY_BOUND_INVALID'; end if;
  for q in select queue.* from public.ebay_luna_opportunity_queue queue
    join public.market_radar_products p on p.supplier_product_id=queue.supplier_product_id
    join public.market_radar_sources src on src.id=p.source_id and src.key='lunaportex'
    order by queue.candidate_key loop
    a:=public.materialize_luna_field_truth_assessment_v1(to_jsonb(q),q.assessment);
    if a is distinct from q.assessment then
      affected:=affected+1;
      if recovered<p_limit then
        queue_id:=q.id;
        select * into q from public.ebay_luna_opportunity_queue where id=queue_id for update skip locked;
        if found then
          a:=public.materialize_luna_field_truth_assessment_v1(to_jsonb(q),q.assessment);
          if a is distinct from q.assessment then
            update public.ebay_luna_opportunity_queue set assessment=a where id=q.id;
            recovered:=recovered+1;
          end if;
        end if;
      end if;
    end if;
  end loop;
  return jsonb_build_object('contractVersion','LUNA_FIELD_PRODUCT_TRUTH_V1',
    'affectedCount',affected,'recoveredCount',recovered,'remainingCount',affected-recovered,
    'ownerResubmitRequired',false,'codexPerProductDispatchRequired',false,
    'marketplaceWrites',0,'downstreamAdvancements',0);
end;
$$;

create or replace function public.luna_source_field_truth_trigger_v1()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare q record; a jsonb; product_key uuid; supplier_key text;
begin
  product_key:=(case when tg_table_name='market_radar_products'
    then to_jsonb(new)->>'id' else to_jsonb(new)->>'product_id' end)::uuid;
  select p.supplier_product_id into supplier_key from public.market_radar_products p
    join public.market_radar_sources s on s.id=p.source_id and s.key='lunaportex' where p.id=product_key;
  if supplier_key is null then return new; end if;
  for q in select * from public.ebay_luna_opportunity_queue where supplier_product_id=supplier_key
    for update loop
    a:=public.materialize_luna_field_truth_assessment_v1(to_jsonb(q),q.assessment);
    if a is distinct from q.assessment then
      update public.ebay_luna_opportunity_queue set assessment=a where id=q.id;
    end if;
  end loop;
  return new;
end;
$$;
create trigger luna_product_source_field_truth_v1
after update of title,body_html,metadata,image_urls,last_snapshot_at
on public.market_radar_products for each row
when (old.title is distinct from new.title or old.body_html is distinct from new.body_html
  or old.metadata is distinct from new.metadata or old.image_urls is distinct from new.image_urls
  or old.last_snapshot_at is distinct from new.last_snapshot_at)
execute function public.luna_source_field_truth_trigger_v1();
create trigger luna_snapshot_source_field_truth_v1
after insert or update on public.market_radar_current_variant_snapshots
for each row execute function public.luna_source_field_truth_trigger_v1();

-- Internal supplier materialization only. No authenticated/anon RPC authority.
do $$ declare f record; begin
  for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace
    and proname in ('luna_truth_text_v1','luna_truth_observation_v1','luna_truth_measurements_v1',
      'derive_luna_field_truth_v1','merge_luna_field_truth_assessment_v1',
      'materialize_luna_field_truth_assessment_v1','recover_luna_product_truth_parity_v1',
      'luna_queue_field_truth_trigger_v1','luna_source_field_truth_trigger_v1') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

-- Deploy-time cohort recovery uses the same function as normal retries. The
-- preflight cohort is below this bound; never dispatch by SKU/product identity.
select public.recover_luna_product_truth_parity_v1(1000);
