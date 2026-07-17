-- Reusable facts from a verified seller-owned listing are deliberately limited
-- to category, condition id and official business policy ids. Location,
-- taxonomy version and package measurements must be resolved for every draft.

create or replace function public.is_safe_ebay_listing_defaults(p_defaults jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select
    jsonb_typeof(coalesce(p_defaults, '{}'::jsonb)) = 'object'
    and not exists (
      select 1
      from jsonb_object_keys(coalesce(p_defaults, '{}'::jsonb)) as keys(key)
      where key not in (
        'categoryId', 'conditionId', 'fulfillmentPolicyId',
        'paymentPolicyId', 'returnPolicyId'
      )
    )
    and (
      not (coalesce(p_defaults, '{}'::jsonb) ? 'categoryId')
      or p_defaults->>'categoryId' ~ '^[0-9]{1,20}$'
    )
    and (
      not (coalesce(p_defaults, '{}'::jsonb) ? 'conditionId')
      or p_defaults->>'conditionId' ~ '^[0-9]{1,12}$'
    )
    and (
      not (coalesce(p_defaults, '{}'::jsonb) ? 'fulfillmentPolicyId')
      or p_defaults->>'fulfillmentPolicyId' ~ '^[A-Za-z0-9._:-]{1,80}$'
    )
    and (
      not (coalesce(p_defaults, '{}'::jsonb) ? 'paymentPolicyId')
      or p_defaults->>'paymentPolicyId' ~ '^[A-Za-z0-9._:-]{1,80}$'
    )
    and (
      not (coalesce(p_defaults, '{}'::jsonb) ? 'returnPolicyId')
      or p_defaults->>'returnPolicyId' ~ '^[A-Za-z0-9._:-]{1,80}$'
    );
$$;

-- Existing rows are sanitized without inventing replacements. The current
-- staging tables are empty, but this remains safe for later deployments.
update public.ebay_manual_listing_links
set safe_defaults = coalesce(safe_defaults, '{}'::jsonb)
  - 'merchantLocationKey'
  - 'categorySchemaVersion'
  - 'dimensionUnit'
  - 'weightUnit'
  - 'condition',
    updated_at = now()
where coalesce(safe_defaults, '{}'::jsonb) ?| array[
  'merchantLocationKey', 'categorySchemaVersion', 'dimensionUnit',
  'weightUnit', 'condition'
];

do $$
begin
  if exists (
    select 1
    from public.ebay_seller_listing_templates template_row
    group by
      template_row.account_key,
      concat(
        'EBAY_US:',
        coalesce(nullif(template_row.category_id, ''), 'all-categories'),
        ':',
        coalesce(nullif(template_row.condition_id, ''), 'all-conditions')
      )
    having count(*) > 1
  ) then
    raise exception 'EBAY_SAFE_DEFAULT_TEMPLATE_KEY_COLLISION';
  end if;
end;
$$;

update public.ebay_seller_listing_templates
set template_key = concat(
      'EBAY_US:',
      coalesce(nullif(category_id, ''), 'all-categories'),
      ':',
      coalesce(nullif(condition_id, ''), 'all-conditions')
    ),
    merchant_location_key = null,
    condition_code = null,
    category_schema_version = null,
    dimension_unit = null,
    weight_unit = null,
    updated_at = now()
where merchant_location_key is not null
  or condition_code is not null
  or category_schema_version is not null
  or dimension_unit is not null
  or weight_unit is not null
  or template_key is distinct from concat(
    'EBAY_US:',
    coalesce(nullif(category_id, ''), 'all-categories'),
    ':',
    coalesce(nullif(condition_id, ''), 'all-conditions')
  );

create or replace function public.enforce_ebay_safe_listing_template_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.merchant_location_key := null;
  new.condition_code := null;
  new.category_schema_version := null;
  new.dimension_unit := null;
  new.weight_unit := null;
  new.template_key := concat(
    'EBAY_US:',
    coalesce(nullif(new.category_id, ''), 'all-categories'),
    ':',
    coalesce(nullif(new.condition_id, ''), 'all-conditions')
  );
  return new;
end;
$$;

drop trigger if exists ebay_safe_listing_template_fields_guard
  on public.ebay_seller_listing_templates;
create trigger ebay_safe_listing_template_fields_guard
before insert or update on public.ebay_seller_listing_templates
for each row execute function public.enforce_ebay_safe_listing_template_fields();

-- Replace the scoped package wrapper so refresh cannot smuggle excluded
-- defaults into location, condition code, taxonomy version or measurement
-- units. Seller-authored values already stored in the package are preserved.
create or replace function public.ebay_save_listing_package_guarded(
  p_package_id uuid,
  p_account_key text,
  p_actor uuid,
  p_opportunity_id uuid,
  p_candidate_key text,
  p_operation text,
  p_package_patch jsonb,
  p_status text,
  p_readiness numeric,
  p_source_observed_at timestamptz,
  p_expected_updated_at timestamptz
)
returns setof public.ebay_listing_packages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_safe_patch jsonb := coalesce(p_package_patch, '{}'::jsonb);
begin
  perform public.assert_ebay_listing_package_account_scope(
    p_package_id, p_account_key, p_actor
  );

  if p_operation = 'refresh' then
    v_safe_patch := v_safe_patch
      #- '{draftConfiguration,merchantLocationKey}'
      #- '{draftConfiguration,condition}'
      #- '{draftConfiguration,packageWeightAndSize,dimensions,unit}'
      #- '{draftConfiguration,packageWeightAndSize,weight,unit}';
  end if;

  return query select * from public.ebay_save_listing_package_guarded(
    p_package_id, p_actor, p_opportunity_id, p_candidate_key, p_operation,
    v_safe_patch, p_status, p_readiness, p_source_observed_at,
    p_expected_updated_at
  );
end;
$$;

revoke all on function public.enforce_ebay_safe_listing_template_fields()
  from public, anon, authenticated;
revoke all on function public.is_safe_ebay_listing_defaults(jsonb)
  from public, anon, authenticated;
grant execute on function public.is_safe_ebay_listing_defaults(jsonb)
  to service_role;
revoke all on function public.ebay_save_listing_package_guarded(
  uuid, text, uuid, uuid, text, text, jsonb, text, numeric, timestamptz,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.ebay_save_listing_package_guarded(
  uuid, text, uuid, uuid, text, text, jsonb, text, numeric, timestamptz,
  timestamptz
) to service_role;

comment on table public.ebay_seller_listing_templates is
  'Reusable verified defaults: categoryId, conditionId and official fulfillment, payment and return policy ids only.';
comment on column public.ebay_manual_listing_links.safe_defaults is
  'Strict allowlist: categoryId, conditionId, fulfillmentPolicyId, paymentPolicyId and returnPolicyId.';

notify pgrst, 'reload schema';
