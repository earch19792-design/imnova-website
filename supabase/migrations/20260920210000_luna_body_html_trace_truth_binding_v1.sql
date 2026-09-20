-- Extend the existing Luna Product Truth normalizer for the bounded supplier
-- markup observed in body_html. Product Truth remains partial when optional
-- fields are absent; this migration creates no downstream or marketplace work.

create or replace function public.extract_luna_body_markup_field_observations_v1(
  p_html text
) returns jsonb
language plpgsql
immutable
set search_path=pg_catalog,public
as $$
declare
  v_result jsonb := '[]'::jsonb;
  v_match text[];
  v_item text[];
  v_item_chunk text;
  v_items jsonb;
  v_label text;
  v_value text;
  v_chunk text;
  v_plain text;
  v_field text;
  v_class text;
  v_parsed jsonb;
begin
  if nullif(trim(coalesce(p_html,'')),'') is null
      or length(p_html)>100000 then
    return v_result;
  end if;
  v_plain:=translate(public.luna_truth_text_v1(p_html),'‐‑‒–—','-----');

  -- Standalone strong labels followed by a list are a common Luna shape.
  -- Only a bounded label allowlist may assign a Product Truth field.
  for v_chunk in select chunk from regexp_split_to_table(p_html,'</ul>','i') chunk
      where chunk ~* '<ul' loop
    v_match:=regexp_match(v_chunk,
      '<p[^>]*>[[:space:]]*<strong[^>]*>([^<]{1,80})</strong>[[:space:]]*</p>[[:space:]]*<ul[^>]*>(.*)$','is');
    if v_match is null then continue; end if;
    v_label:=lower(public.luna_truth_text_v1(v_match[1]));
    v_label:=trim(trailing ':' from v_label);
    v_field:=case
      when v_label in ('features','key features','benefits') then 'FEATURES'
      when v_label in ('what’s included','what''s included','whats included',
        'package contents','set includes') then 'PACKAGE_CONTENTS'
      when v_label in ('perfect for','intended uses','uses','applications')
        then 'INTENDED_USES'
      else null end;
    if v_field is null then continue; end if;
    v_items:='[]'::jsonb;
    for v_item_chunk in select chunk
        from regexp_split_to_table(v_match[2],'</li>','i') chunk
        where chunk ~* '<li' loop
      v_item:=regexp_match(v_item_chunk,'<li[^>]*>(.*)$','is');
      if v_item is null then continue; end if;
      v_value:=public.luna_truth_text_v1(v_item[1]);
      if v_value<>'' then v_items:=v_items||jsonb_build_array(v_value); end if;
    end loop;
    if jsonb_array_length(v_items)=0 then continue; end if;
    if v_field='PACKAGE_CONTENTS' then
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'FIELD',v_field,'VALUE',v_items,'RAW_VALUE',v_items,
        'SEMANTIC_CLASS','FACT','LOCATOR','strong-list-section'));
    else
      for v_value in select value#>>'{}' from jsonb_array_elements(v_items) loop
        v_result:=v_result||jsonb_build_array(jsonb_build_object(
          'FIELD',v_field,'VALUE',to_jsonb(v_value),'RAW_VALUE',to_jsonb(v_value),
          'SEMANTIC_CLASS',case when v_field='FEATURES'
            then 'SUPPLIER_CLAIM' else 'FACT' end,
          'LOCATOR','strong-list-section'));
      end loop;
    end if;
  end loop;

  -- Strong lead paragraphs are preserved verbatim as supplier claims. Exact
  -- recognized labels may instead produce facts without interpreting prose.
  for v_chunk in select chunk from regexp_split_to_table(p_html,'</p>','i') chunk
      where chunk ~* '<strong' loop
    v_match:=regexp_match(v_chunk,
      '<p[^>]*>[[:space:]]*<strong[^>]*>([^<]{1,100})</strong>[[:space:]]*(?:[-–—][[:space:]]*|<br[^>]*>[[:space:]]*)(.*)$','is');
    if v_match is null then continue; end if;
    v_label:=trim(trailing ':' from lower(public.luna_truth_text_v1(v_match[1])));
    v_value:=public.luna_truth_text_v1(v_match[2]);
    if v_value='' then continue; end if;
    v_field:=case
      when v_label in ('perfect for','intended uses','uses','applications')
        then 'INTENDED_USES'
      when v_label in ('material','materials') then 'MATERIAL'
      when v_label in ('dimensions','product dimensions','package dimensions')
        then 'DIMENSIONS'
      else 'FEATURES' end;
    v_class:=case when v_field='FEATURES' then 'SUPPLIER_CLAIM' else 'FACT' end;
    v_parsed:=to_jsonb(v_value);
    if v_field='DIMENSIONS' then
      v_parsed:=public.luna_truth_measurements_v1(v_value);
      if v_parsed='[]'::jsonb then continue; end if;
    end if;
    v_result:=v_result||jsonb_build_array(jsonb_build_object(
      'FIELD',v_field,'VALUE',v_parsed,'RAW_VALUE',to_jsonb(v_value),
      'SEMANTIC_CLASS',v_class,'LOCATOR','strong-lead-paragraph'));
  end loop;

  -- Exact grammatical assertions are bounded and retain their literal text.
  -- Component words are not reclassified and vague "made from" claims are not
  -- accepted as material evidence.
  v_match:=regexp_match(v_plain,
    '\mbuilt[[:space:]]+with[[:space:]]+(?:an?[[:space:]]+)?([^.]+)','i');
  if v_match is not null then
    v_value:=trim(regexp_replace(v_match[1],
      '[[:space:]]+for[[:space:]].*$','','i'));
    if v_value ~* '\m(exterior|insulation|lining|shell|fabric|metal|alumin(?:um|ium)|plastic|steel|wood|glass|silicone|rubber|cotton|polyester|nylon|leather)\M' then
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'FIELD','MATERIAL','VALUE',to_jsonb(v_value),'RAW_VALUE',to_jsonb(v_value),
        'SEMANTIC_CLASS','FACT','LOCATOR','explicit-built-with-clause'));
    end if;
  end if;

  v_match:=regexp_match(v_plain,
    '\mperfect[[:space:]]+for[[:space:]]+([^.]+)','i');
  if v_match is not null then
    v_value:=trim(v_match[1]);
    if v_value<>'' then
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'FIELD','INTENDED_USES','VALUE',to_jsonb(v_value),
        'RAW_VALUE',to_jsonb(v_value),'SEMANTIC_CLASS','FACT',
        'LOCATOR','explicit-perfect-for-clause'));
    end if;
  end if;

  for v_match in select distinct m from regexp_matches(v_plain,
    '\m([1-9][0-9]{0,3})[[:space:]-]*(?:pack|pk)\M','gi') m loop
    v_result:=v_result||jsonb_build_array(jsonb_build_object(
      'FIELD','QUANTITY_OR_SET_COUNT','VALUE',to_jsonb(v_match[1]::integer),
      'RAW_VALUE',to_jsonb(v_match[1]),'SEMANTIC_CLASS','FACT',
      'LOCATOR','explicit-pack-count'));
  end loop;
  return v_result;
end;
$$;

do $migration$
declare
  definition text;
  updated text;
  marker text := E'  foreach v_field in array v_fields loop';
  insertion text := $patch$
  -- Bounded body markup observations join the same source-evidence resolver;
  -- they do not form a second truth authority.
  for v_entry in select value entry,ordinality ord
    from jsonb_array_elements(
      public.extract_luna_body_markup_field_observations_v1(
        p_product->>'body_html')) with ordinality entries(value,ordinality) loop
    v_observations:=v_observations||jsonb_build_array(
      public.luna_truth_observation_v1(
        v_entry.entry->>'FIELD',v_entry.entry->'VALUE',
        v_entry.entry->'RAW_VALUE',
        'product.body_html#'||(v_entry.entry->>'LOCATOR')||':'||v_entry.ord,
        p_product->>'id',v_pc,v_po,null,
        v_entry.entry->>'SEMANTIC_CLASS'));
  end loop;

$patch$;
begin
  definition:=pg_get_functiondef(
    'public.derive_luna_field_truth_v1(jsonb,jsonb,jsonb,jsonb)'::regprocedure);
  if position('extract_luna_body_markup_field_observations_v1' in definition)>0
      or position(marker in definition)=0 then
    raise exception 'LUNA_BODY_MARKUP_NORMALIZER_PATCH_PRECONDITION_FAILED';
  end if;
  updated:=replace(definition,marker,insertion||marker);
  execute updated;
end;
$migration$;

-- Re-materialize only the current complete snapshot through the canonical
-- function. Historical snapshots and downstream stages remain untouched.
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

revoke all on function
  public.extract_luna_body_markup_field_observations_v1(text)
  from public,anon,authenticated;
grant execute on function
  public.extract_luna_body_markup_field_observations_v1(text)
  to service_role;

comment on function public.extract_luna_body_markup_field_observations_v1(text)
  is 'Bounded deterministic Luna strong-label/list and explicit-clause normalization; never infers from images, marketplace evidence, or arbitrary prose.';
