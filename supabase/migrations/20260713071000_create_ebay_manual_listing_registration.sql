-- Register a listing created manually in Seller Hub and learn only reusable,
-- seller-owned operational defaults. eBay ownership is verified exclusively
-- against an authenticated, read-only eBay connector. Seller Hub listings use
-- Trading GetUser + GetItem because Inventory API may not represent web listings.

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
        'fulfillmentPolicyId', 'paymentPolicyId', 'returnPolicyId',
        'merchantLocationKey', 'condition', 'conditionId', 'categoryId',
        'categorySchemaVersion', 'dimensionUnit', 'weightUnit'
      )
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
    )
    and (
      not (coalesce(p_defaults, '{}'::jsonb) ? 'merchantLocationKey')
      or p_defaults->>'merchantLocationKey' ~ '^[A-Za-z0-9._:-]{1,36}$'
    )
    and (
      not (coalesce(p_defaults, '{}'::jsonb) ? 'condition')
      or p_defaults->>'condition' in (
        'NEW', 'LIKE_NEW', 'NEW_OTHER', 'NEW_WITH_DEFECTS',
        'MANUFACTURER_REFURBISHED', 'CERTIFIED_REFURBISHED',
        'EXCELLENT_REFURBISHED', 'VERY_GOOD_REFURBISHED',
        'GOOD_REFURBISHED', 'SELLER_REFURBISHED', 'USED_EXCELLENT',
        'USED_VERY_GOOD', 'USED_GOOD', 'USED_ACCEPTABLE',
        'FOR_PARTS_OR_NOT_WORKING'
      )
    )
    and (
      not (coalesce(p_defaults, '{}'::jsonb) ? 'conditionId')
      or p_defaults->>'conditionId' ~ '^[0-9]{1,12}$'
    )
    and (
      not (coalesce(p_defaults, '{}'::jsonb) ? 'categoryId')
      or p_defaults->>'categoryId' ~ '^[0-9]{1,20}$'
    )
    and (
      not (coalesce(p_defaults, '{}'::jsonb) ? 'categorySchemaVersion')
      or p_defaults->>'categorySchemaVersion' ~ '^[A-Za-z0-9._:-]{1,64}$'
    )
    and (
      not (coalesce(p_defaults, '{}'::jsonb) ? 'dimensionUnit')
      or p_defaults->>'dimensionUnit' in ('INCH', 'CENTIMETER')
    )
    and (
      not (coalesce(p_defaults, '{}'::jsonb) ? 'weightUnit')
      or p_defaults->>'weightUnit' in ('POUND', 'OUNCE', 'KILOGRAM', 'GRAM')
    );
$$;

create table if not exists public.ebay_manual_listing_links (
  id uuid primary key default gen_random_uuid(),
  account_key text not null,
  marketplace_id text not null default 'EBAY_US',
  ebay_item_id text not null,
  ebay_url text not null,
  opportunity_id uuid not null
    references public.ebay_luna_opportunity_queue(id) on delete restrict,
  candidate_key text not null,
  market_radar_product_id uuid null
    references public.market_radar_products(id) on delete set null,
  supplier_variant_id text null,
  supplier_sku text null,
  verification_status text not null default 'pending_manual_verification',
  verification_method text not null default 'NOT_EXECUTED',
  verification_reason text not null,
  connector_listing_id uuid null
    references public.ebay_active_listings(id) on delete restrict,
  connector_listing_status text null,
  connector_ebay_sku text null,
  safe_defaults jsonb not null default '{}'::jsonb,
  verified_at timestamptz null,
  last_verification_at timestamptz not null default now(),
  verification_attempt_count integer not null default 1,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_manual_listing_account_check check (
    char_length(account_key) between 1 and 160
    and account_key !~ '[[:cntrl:]]'
  ),
  constraint ebay_manual_listing_marketplace_check check (
    marketplace_id = 'EBAY_US'
  ),
  constraint ebay_manual_listing_item_check check (
    ebay_item_id ~ '^[0-9]{9,20}$'
  ),
  constraint ebay_manual_listing_url_check check (
    ebay_url ~ '^https://www[.]ebay[.]com/itm/[0-9]{9,20}$'
  ),
  constraint ebay_manual_listing_candidate_check check (
    char_length(candidate_key) between 1 and 300
    and candidate_key !~ '[[:cntrl:]]'
  ),
  constraint ebay_manual_listing_supplier_sku_check check (
    supplier_sku is null or (
      char_length(supplier_sku) between 1 and 100
      and supplier_sku !~ '[[:cntrl:]]'
    )
  ),
  constraint ebay_manual_listing_supplier_variant_check check (
    supplier_variant_id is null or (
      char_length(supplier_variant_id) between 1 and 160
      and supplier_variant_id !~ '[[:cntrl:]]'
    )
  ),
  constraint ebay_manual_listing_verification_status_check check (
    verification_status in ('verified', 'pending_manual_verification')
  ),
  constraint ebay_manual_listing_verification_method_check check (
    verification_method in (
      'EBAY_TRADING_GET_ITEM_READONLY',
      'EBAY_SELL_INVENTORY_READONLY',
      'NOT_EXECUTED'
    )
  ),
  constraint ebay_manual_listing_verification_reason_check check (
    verification_reason ~ '^[A-Z0-9_]{3,100}$'
  ),
  constraint ebay_manual_listing_verification_evidence_check check (
    (
      verification_status = 'verified'
      and verification_method in (
        'EBAY_TRADING_GET_ITEM_READONLY',
        'EBAY_SELL_INVENTORY_READONLY'
      )
      and connector_listing_id is not null
      and connector_listing_status in ('active', 'paused')
      and connector_ebay_sku ~ '^IMNOVA-[A-Z0-9]{16,32}$'
      and verified_at is not null
    ) or (
      verification_status = 'pending_manual_verification'
      and connector_listing_id is null
      and connector_listing_status is null
      and connector_ebay_sku is null
      and verified_at is null
    )
  ),
  constraint ebay_manual_listing_defaults_check check (
    public.is_safe_ebay_listing_defaults(safe_defaults)
  ),
  constraint ebay_manual_listing_attempts_check check (
    verification_attempt_count >= 1
  ),
  constraint ebay_manual_listing_account_item_unique
    unique (account_key, ebay_item_id),
  constraint ebay_manual_listing_candidate_unique
    unique (account_key, candidate_key)
);

create table if not exists public.ebay_seller_listing_templates (
  id uuid primary key default gen_random_uuid(),
  account_key text not null,
  marketplace_id text not null default 'EBAY_US',
  template_key text not null,
  source_link_id uuid not null
    references public.ebay_manual_listing_links(id) on delete restrict,
  fulfillment_policy_id text null,
  payment_policy_id text null,
  return_policy_id text null,
  merchant_location_key text null,
  condition_code text null,
  condition_id text null,
  category_id text null,
  category_schema_version text null,
  dimension_unit text null,
  weight_unit text null,
  status text not null default 'active',
  verified_source_at timestamptz not null,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_seller_listing_template_account_check check (
    char_length(account_key) between 1 and 160
    and account_key !~ '[[:cntrl:]]'
  ),
  constraint ebay_seller_listing_template_marketplace_check check (
    marketplace_id = 'EBAY_US'
  ),
  constraint ebay_seller_listing_template_key_check check (
    template_key ~ '^EBAY_US:[A-Za-z0-9._:-]{1,40}:[A-Za-z0-9._:-]{1,40}$'
  ),
  constraint ebay_seller_listing_template_status_check check (
    status in ('active', 'superseded')
  ),
  constraint ebay_seller_listing_template_condition_check check (
    condition_code is null or condition_code in (
      'NEW', 'LIKE_NEW', 'NEW_OTHER', 'NEW_WITH_DEFECTS',
      'MANUFACTURER_REFURBISHED', 'CERTIFIED_REFURBISHED',
      'EXCELLENT_REFURBISHED', 'VERY_GOOD_REFURBISHED',
      'GOOD_REFURBISHED', 'SELLER_REFURBISHED', 'USED_EXCELLENT',
      'USED_VERY_GOOD', 'USED_GOOD', 'USED_ACCEPTABLE',
      'FOR_PARTS_OR_NOT_WORKING'
    )
  ),
  constraint ebay_seller_listing_template_condition_id_check check (
    condition_id is null or condition_id ~ '^[0-9]{1,12}$'
  ),
  constraint ebay_seller_listing_template_category_check check (
    category_id is null or category_id ~ '^[0-9]{1,20}$'
  ),
  constraint ebay_seller_listing_template_dimension_unit_check check (
    dimension_unit is null or dimension_unit in ('INCH', 'CENTIMETER')
  ),
  constraint ebay_seller_listing_template_weight_unit_check check (
    weight_unit is null or weight_unit in ('POUND', 'OUNCE', 'KILOGRAM', 'GRAM')
  ),
  constraint ebay_seller_listing_template_account_key_unique
    unique (account_key, template_key)
);

create index if not exists ebay_manual_listing_links_verification_idx
  on public.ebay_manual_listing_links(
    account_key, verification_status, updated_at desc
  );
create index if not exists ebay_manual_listing_links_opportunity_idx
  on public.ebay_manual_listing_links(opportunity_id);
create index if not exists ebay_seller_listing_templates_lookup_idx
  on public.ebay_seller_listing_templates(
    account_key, marketplace_id, category_id, condition_code, updated_at desc
  ) where status = 'active';

alter table public.ebay_manual_listing_links enable row level security;
alter table public.ebay_seller_listing_templates enable row level security;

revoke all on table public.ebay_manual_listing_links from anon, authenticated;
revoke all on table public.ebay_seller_listing_templates from anon, authenticated;
grant select, insert, update on table public.ebay_manual_listing_links to service_role;
grant select, insert, update on table public.ebay_seller_listing_templates to service_role;
grant select, insert, update on table public.ebay_active_listings to service_role;

create or replace function public.register_ebay_manual_listing_link(
  p_account_key text,
  p_ebay_item_id text,
  p_ebay_url text,
  p_opportunity_id uuid,
  p_candidate_key text,
  p_supplier_variant_id text,
  p_supplier_sku text,
  p_verification_status text,
  p_verification_method text,
  p_verification_reason text,
  p_connector_ebay_sku text,
  p_connector_observed_at timestamptz,
  p_safe_defaults jsonb,
  p_actor_user_id uuid
)
returns setof public.ebay_manual_listing_links
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opportunity public.ebay_luna_opportunity_queue%rowtype;
  v_connector public.ebay_active_listings%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_existing public.ebay_manual_listing_links%rowtype;
  v_link public.ebay_manual_listing_links%rowtype;
  v_template_key text;
  v_expected_ebay_sku text;
begin
  if p_account_key is null
    or char_length(p_account_key) not between 1 and 160
    or p_account_key ~ '[[:cntrl:]]'
    or p_ebay_item_id !~ '^[0-9]{9,20}$'
    or p_ebay_url is distinct from concat('https://www.ebay.com/itm/', p_ebay_item_id)
    or p_candidate_key is null
    or char_length(p_candidate_key) not between 1 and 300
    or p_candidate_key ~ '[[:cntrl:]]'
    or p_verification_status not in ('verified', 'pending_manual_verification')
    or p_verification_method not in (
      'EBAY_TRADING_GET_ITEM_READONLY',
      'EBAY_SELL_INVENTORY_READONLY',
      'NOT_EXECUTED'
    )
    or p_verification_reason !~ '^[A-Z0-9_]{3,100}$'
    or not public.is_safe_ebay_listing_defaults(coalesce(p_safe_defaults, '{}'::jsonb)) then
    raise exception 'MANUAL_LISTING_REGISTRATION_INVALID';
  end if;

  select * into v_opportunity
  from public.ebay_luna_opportunity_queue
  where id = p_opportunity_id
  for key share;
  if not found or v_opportunity.candidate_key is distinct from p_candidate_key then
    raise exception 'MANUAL_LISTING_OPPORTUNITY_MISMATCH';
  end if;
  if v_opportunity.supplier_sku is not null
    and v_opportunity.supplier_sku is distinct from p_supplier_sku then
    raise exception 'MANUAL_LISTING_SUPPLIER_SKU_MISMATCH';
  end if;
  if v_opportunity.supplier_variant_id is not null
    and v_opportunity.supplier_variant_id is distinct from p_supplier_variant_id then
    raise exception 'MANUAL_LISTING_SUPPLIER_VARIANT_MISMATCH';
  end if;

  if p_verification_status = 'verified' then
    if p_verification_method not in (
      'EBAY_TRADING_GET_ITEM_READONLY',
      'EBAY_SELL_INVENTORY_READONLY'
    )
      or p_connector_ebay_sku !~ '^IMNOVA-[A-Z0-9]{16,32}$'
      or p_connector_observed_at is null
      or p_connector_observed_at > now() + interval '5 minutes'
      or p_connector_observed_at < now() - interval '1 day' then
      raise exception 'MANUAL_LISTING_VERIFICATION_EVIDENCE_REQUIRED';
    end if;
    select * into v_package
    from public.ebay_listing_packages
    where opportunity_id = p_opportunity_id
      and candidate_key = p_candidate_key
    for key share;
    if not found then
      raise exception 'MANUAL_LISTING_CANONICAL_PACKAGE_REQUIRED';
    end if;
    v_expected_ebay_sku := concat(
      'IMNOVA-', upper(replace(v_package.id::text, '-', ''))
    );
    if p_connector_ebay_sku is distinct from v_expected_ebay_sku then
      raise exception 'MANUAL_LISTING_EBAY_SKU_MISMATCH';
    end if;
  elsif p_connector_ebay_sku is not null
    or p_connector_observed_at is not null then
    raise exception 'MANUAL_LISTING_PENDING_WITH_VERIFIED_EVIDENCE';
  end if;

  -- Candidate and item locks are independent so two concurrent requests cannot
  -- race by pairing the same candidate with different item IDs (or vice versa).
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat('candidate:', p_account_key, ':', p_candidate_key), 0
    )
  );
  perform pg_advisory_xact_lock(
    hashtextextended(concat('item:', p_account_key, ':', p_ebay_item_id), 0)
  );

  select * into v_existing
  from public.ebay_manual_listing_links
  where account_key = p_account_key
    and candidate_key = p_candidate_key
  for update;
  if found and v_existing.ebay_item_id is distinct from p_ebay_item_id then
    raise exception 'MANUAL_LISTING_CANDIDATE_ALREADY_LINKED';
  end if;

  select * into v_existing
  from public.ebay_manual_listing_links
  where account_key = p_account_key
    and ebay_item_id = p_ebay_item_id
  for update;
  if found and v_existing.candidate_key is distinct from p_candidate_key then
    raise exception 'MANUAL_LISTING_ITEM_ALREADY_LINKED';
  end if;

  -- The connector evidence and the link are committed in this same transaction.
  -- A candidate/item conflict below therefore cannot leave a mapped orphan row.
  if p_verification_status = 'verified' then
    insert into public.ebay_active_listings (
      source, account_key, sync_key, ebay_item_id, listing_status, title,
      ebay_sku, market_radar_product_id, supplier_variant_id, supplier_sku,
      last_ebay_sync_at, raw_payload, updated_at
    ) values (
      p_verification_method,
      p_account_key,
      concat(p_verification_method, ':', p_account_key, ':', p_ebay_item_id),
      p_ebay_item_id,
      'active',
      concat('eBay listing ', p_ebay_item_id),
      p_connector_ebay_sku,
      v_opportunity.market_radar_product_id,
      v_opportunity.supplier_variant_id,
      v_opportunity.supplier_sku,
      p_connector_observed_at,
      jsonb_build_object(
        'source', p_verification_method,
        'marketplaceId', 'EBAY_US',
        'ownershipVerified', true,
        'productIdentityVerified', true,
        'expectedEbaySku', v_expected_ebay_sku,
        'listingPackageId', v_package.id
      ),
      p_connector_observed_at
    )
    on conflict (sync_key) do update set
      listing_status = excluded.listing_status,
      ebay_sku = excluded.ebay_sku,
      market_radar_product_id = excluded.market_radar_product_id,
      supplier_variant_id = excluded.supplier_variant_id,
      supplier_sku = excluded.supplier_sku,
      last_ebay_sync_at = excluded.last_ebay_sync_at,
      raw_payload = excluded.raw_payload,
      updated_at = excluded.updated_at
    returning * into v_connector;
  end if;

  insert into public.ebay_manual_listing_links (
    account_key, marketplace_id, ebay_item_id, ebay_url,
    opportunity_id, candidate_key, market_radar_product_id,
    supplier_variant_id, supplier_sku, verification_status,
    verification_method, verification_reason, connector_listing_id,
    connector_listing_status, connector_ebay_sku, safe_defaults,
    verified_at, last_verification_at, verification_attempt_count,
    created_by, updated_by, created_at, updated_at
  ) values (
    p_account_key, 'EBAY_US', p_ebay_item_id, p_ebay_url,
    p_opportunity_id, p_candidate_key, v_opportunity.market_radar_product_id,
    coalesce(v_opportunity.supplier_variant_id, nullif(trim(p_supplier_variant_id), '')),
    coalesce(v_opportunity.supplier_sku, nullif(trim(p_supplier_sku), '')),
    p_verification_status, p_verification_method, p_verification_reason,
    case when p_verification_status = 'verified' then v_connector.id else null end,
    case when p_verification_status = 'verified' then v_connector.listing_status else null end,
    case when p_verification_status = 'verified' then v_connector.ebay_sku else null end,
    coalesce(p_safe_defaults, '{}'::jsonb),
    case when p_verification_status = 'verified' then now() else null end,
    now(), 1, p_actor_user_id, p_actor_user_id, now(), now()
  )
  on conflict (account_key, ebay_item_id) do update set
    ebay_url = excluded.ebay_url,
    opportunity_id = excluded.opportunity_id,
    candidate_key = excluded.candidate_key,
    market_radar_product_id = excluded.market_radar_product_id,
    supplier_variant_id = excluded.supplier_variant_id,
    supplier_sku = excluded.supplier_sku,
    verification_status = excluded.verification_status,
    verification_method = excluded.verification_method,
    verification_reason = excluded.verification_reason,
    connector_listing_id = excluded.connector_listing_id,
    connector_listing_status = excluded.connector_listing_status,
    connector_ebay_sku = excluded.connector_ebay_sku,
    safe_defaults = excluded.safe_defaults,
    -- Keep the beginning of an uninterrupted verified interval so causal
    -- performance windows can mature. A pending -> verified recovery starts a
    -- new interval and therefore uses excluded.verified_at.
    verified_at = case
      when public.ebay_manual_listing_links.verification_status = 'verified'
        and excluded.verification_status = 'verified'
        then public.ebay_manual_listing_links.verified_at
      else excluded.verified_at
    end,
    last_verification_at = now(),
    verification_attempt_count =
      public.ebay_manual_listing_links.verification_attempt_count + 1,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning * into v_link;

  -- Re-verification fails closed. Keep the link for audit and retry, but an
  -- inactive, mismatched, or unavailable source may not leave its template
  -- active.
  if p_verification_status <> 'verified' then
    update public.ebay_seller_listing_templates
    set
      status = 'superseded',
      updated_by = p_actor_user_id,
      updated_at = now()
    where source_link_id = v_link.id
      and status = 'active';
  end if;

  if p_verification_status = 'verified'
    and coalesce(p_safe_defaults, '{}'::jsonb) <> '{}'::jsonb then
    v_template_key := concat(
      'EBAY_US:',
      coalesce(nullif(p_safe_defaults->>'categoryId', ''), 'all-categories'),
      ':',
      coalesce(nullif(p_safe_defaults->>'condition', ''), 'all-conditions')
    );
    -- A newly observed category/condition replaces the old template key from
    -- this same listing instead of leaving both versions active.
    update public.ebay_seller_listing_templates
    set
      status = 'superseded',
      updated_by = p_actor_user_id,
      updated_at = now()
    where source_link_id = v_link.id
      and template_key <> v_template_key
      and status = 'active';

    insert into public.ebay_seller_listing_templates (
      account_key, marketplace_id, template_key, source_link_id,
      fulfillment_policy_id, payment_policy_id, return_policy_id,
      merchant_location_key, condition_code, condition_id, category_id,
      category_schema_version, dimension_unit, weight_unit, status,
      verified_source_at, created_by, updated_by, created_at, updated_at
    ) values (
      p_account_key, 'EBAY_US', v_template_key, v_link.id,
      nullif(p_safe_defaults->>'fulfillmentPolicyId', ''),
      nullif(p_safe_defaults->>'paymentPolicyId', ''),
      nullif(p_safe_defaults->>'returnPolicyId', ''),
      nullif(p_safe_defaults->>'merchantLocationKey', ''),
      nullif(p_safe_defaults->>'condition', ''),
      nullif(p_safe_defaults->>'conditionId', ''),
      nullif(p_safe_defaults->>'categoryId', ''),
      nullif(p_safe_defaults->>'categorySchemaVersion', ''),
      nullif(p_safe_defaults->>'dimensionUnit', ''),
      nullif(p_safe_defaults->>'weightUnit', ''),
      'active', v_link.verified_at, p_actor_user_id, p_actor_user_id,
      now(), now()
    )
    on conflict (account_key, template_key) do update set
      source_link_id = excluded.source_link_id,
      -- Replace the complete allowlisted snapshot. Never retain a value from
      -- an older source while attributing the row to the newer listing.
      fulfillment_policy_id = excluded.fulfillment_policy_id,
      payment_policy_id = excluded.payment_policy_id,
      return_policy_id = excluded.return_policy_id,
      merchant_location_key = excluded.merchant_location_key,
      condition_code = excluded.condition_code,
      condition_id = excluded.condition_id,
      category_id = excluded.category_id,
      category_schema_version = excluded.category_schema_version,
      dimension_unit = excluded.dimension_unit,
      weight_unit = excluded.weight_unit,
      status = 'active',
      verified_source_at = excluded.verified_source_at,
      updated_by = excluded.updated_by,
      updated_at = now();
  end if;

  return next v_link;
end;
$$;

revoke all on function public.register_ebay_manual_listing_link(
  text, text, text, uuid, text, text, text, text, text, text, text,
  timestamptz, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.register_ebay_manual_listing_link(
  text, text, text, uuid, text, text, text, text, text, text, text,
  timestamptz, jsonb, uuid
) to service_role;

comment on table public.ebay_manual_listing_links is
  'Links a Seller Hub listing to one Luna opportunity. Verified requires an exact row from the authenticated read-only eBay account connector.';
comment on table public.ebay_seller_listing_templates is
  'Reusable seller-owned operational defaults only. Never stores titles, descriptions, images, claims, brands, competitor content, or aspect values.';
comment on column public.ebay_manual_listing_links.safe_defaults is
  'Strict allowlist: policy IDs, merchant location, condition/category schema identifiers, and measurement units only.';

notify pgrst, 'reload schema';
