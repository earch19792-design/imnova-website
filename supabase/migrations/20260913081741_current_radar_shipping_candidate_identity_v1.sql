create or replace function public.seller_os_current_commercial_candidate_id_v1(
  p_account_key text,
  p_marketplace_id text,
  p_supplier_authority text,
  p_product_id text,
  p_variant_id text,
  p_supplier_sku text
) returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
  select case
    when p_account_key is null or p_account_key <> btrim(p_account_key)
      or octet_length(p_account_key) not between 1 and 200
      or p_account_key ~ '[[:cntrl:]]'
      or p_marketplace_id is null or p_marketplace_id <> btrim(p_marketplace_id)
      or octet_length(p_marketplace_id) not between 1 and 32
      or p_marketplace_id ~ '[[:cntrl:]]'
      or p_supplier_authority is null
      or p_supplier_authority <> btrim(p_supplier_authority)
      or octet_length(p_supplier_authority) not between 1 and 32
      or p_supplier_authority ~ '[[:cntrl:]]'
      or p_product_id is null or p_product_id <> btrim(p_product_id)
      or octet_length(p_product_id) not between 1 and 80
      or p_product_id ~ '[[:cntrl:]]'
      or p_variant_id is null or p_variant_id <> btrim(p_variant_id)
      or octet_length(p_variant_id) not between 1 and 80
      or p_variant_id ~ '[[:cntrl:]]'
      or p_supplier_sku is null or p_supplier_sku <> btrim(p_supplier_sku)
      or octet_length(p_supplier_sku) not between 1 and 200
      or p_supplier_sku ~ '[[:cntrl:]]'
    then null
    else 'sha256:' || encode(extensions.digest(pg_catalog.convert_to(
      octet_length('CURRENT_COMMERCIAL_CANDIDATE_IDENTITY_V1')::text ||
        ':CURRENT_COMMERCIAL_CANDIDATE_IDENTITY_V1' || E'\n' ||
      octet_length(p_account_key)::text || ':' || p_account_key || E'\n' ||
      octet_length(p_marketplace_id)::text || ':' || p_marketplace_id || E'\n' ||
      octet_length(p_supplier_authority)::text || ':' || p_supplier_authority || E'\n' ||
      octet_length(p_product_id)::text || ':' || p_product_id || E'\n' ||
      octet_length(p_variant_id)::text || ':' || p_variant_id || E'\n' ||
      octet_length(p_supplier_sku)::text || ':' || p_supplier_sku,
      'UTF8'), 'sha256'), 'hex')
  end
$function$;

create table if not exists public.seller_os_current_candidate_identities_v1 (
  canonical_candidate_id text primary key,
  account_key text not null,
  marketplace_id text not null,
  supplier_authority text not null,
  product_id text not null,
  variant_id text not null,
  supplier_sku text not null,
  contract_version text not null default
    'CURRENT_COMMERCIAL_CANDIDATE_IDENTITY_V1',
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  constraint seller_os_current_candidate_identity_hash_check check (
    canonical_candidate_id ~ '^sha256:[0-9a-f]{64}$'),
  constraint seller_os_current_candidate_identity_contract_check check (
    contract_version = 'CURRENT_COMMERCIAL_CANDIDATE_IDENTITY_V1'),
  constraint seller_os_current_candidate_identity_derivation_check check (
    canonical_candidate_id =
      public.seller_os_current_commercial_candidate_id_v1(
        account_key, marketplace_id, supplier_authority,
        product_id, variant_id, supplier_sku)),
  unique (account_key, marketplace_id, supplier_authority,
    product_id, variant_id, supplier_sku)
);

create table if not exists public.seller_os_current_candidate_identity_aliases_v1 (
  account_key text not null,
  alias_candidate_id text not null,
  canonical_candidate_id text not null references
    public.seller_os_current_candidate_identities_v1(canonical_candidate_id)
    on delete restrict,
  opportunity_id uuid not null references
    public.ebay_luna_opportunity_queue(id) on delete restrict,
  source_contract text not null,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  primary key (account_key, alias_candidate_id),
  constraint seller_os_current_candidate_alias_length_check check (
    octet_length(alias_candidate_id) between 1 and 200),
  constraint seller_os_current_candidate_alias_source_check check (
    octet_length(source_contract) between 1 and 120)
);

create index if not exists seller_os_current_candidate_alias_canonical_idx
  on public.seller_os_current_candidate_identity_aliases_v1
  (account_key, canonical_candidate_id);

alter table public.seller_os_current_candidate_identities_v1 enable row level security;
alter table public.seller_os_current_candidate_identity_aliases_v1 enable row level security;

revoke all on public.seller_os_current_candidate_identities_v1 from public, anon, authenticated;
revoke all on public.seller_os_current_candidate_identity_aliases_v1 from public, anon, authenticated;
grant select, insert, update on public.seller_os_current_candidate_identities_v1 to service_role;
grant select, insert, update on public.seller_os_current_candidate_identity_aliases_v1 to service_role;

create or replace function public.reconcile_seller_os_current_candidate_identity_v1(
  p_account_key text,
  p_opportunity_id uuid,
  p_expected_canonical_candidate_id text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_queue public.ebay_luna_opportunity_queue%rowtype;
  v_canonical text;
  v_exact_count integer;
  v_alias text;
  v_aliases text[] := '{}'::text[];
  v_conflicting text;
begin
  select * into v_queue
  from public.ebay_luna_opportunity_queue q
  where q.id = p_opportunity_id
  for update;
  if not found then
    raise exception 'CURRENT_COMMERCIAL_CANDIDATE_NOT_FOUND';
  end if;

  select count(*) into v_exact_count
  from public.ebay_luna_opportunity_queue q
  where q.supplier_product_id is not distinct from v_queue.supplier_product_id
    and q.supplier_variant_id is not distinct from v_queue.supplier_variant_id
    and q.supplier_sku is not distinct from v_queue.supplier_sku;
  if v_exact_count <> 1 then
    raise exception 'CURRENT_COMMERCIAL_CANDIDATE_IDENTITY_AMBIGUOUS';
  end if;

  if exists (
    select 1 from public.ebay_listing_packages p
    where p.opportunity_id = v_queue.id
      and p.account_key is distinct from p_account_key
  ) then
    raise exception 'CURRENT_COMMERCIAL_CANDIDATE_ACCOUNT_SCOPE_MISMATCH';
  end if;

  v_canonical := public.seller_os_current_commercial_candidate_id_v1(
    p_account_key, 'EBAY_US', 'LUNAPORTEX', v_queue.supplier_product_id,
    v_queue.supplier_variant_id, v_queue.supplier_sku);
  if v_canonical is null or
      v_canonical is distinct from p_expected_canonical_candidate_id then
    raise exception 'CURRENT_COMMERCIAL_CANDIDATE_DERIVATION_MISMATCH';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_account_key || ':' || v_canonical, 0));

  insert into public.seller_os_current_candidate_identities_v1 (
    canonical_candidate_id, account_key, marketplace_id,
    supplier_authority, product_id, variant_id, supplier_sku
  ) values (
    v_canonical, p_account_key, 'EBAY_US', 'LUNAPORTEX',
    v_queue.supplier_product_id, v_queue.supplier_variant_id,
    v_queue.supplier_sku
  ) on conflict (canonical_candidate_id) do update
    set last_seen_at = clock_timestamp()
    where seller_os_current_candidate_identities_v1.account_key = excluded.account_key
      and seller_os_current_candidate_identities_v1.marketplace_id = excluded.marketplace_id
      and seller_os_current_candidate_identities_v1.supplier_authority = excluded.supplier_authority
      and seller_os_current_candidate_identities_v1.product_id = excluded.product_id
      and seller_os_current_candidate_identities_v1.variant_id = excluded.variant_id
      and seller_os_current_candidate_identities_v1.supplier_sku = excluded.supplier_sku;
  if not found then
    raise exception 'CURRENT_COMMERCIAL_CANDIDATE_CANONICAL_CONTRADICTION';
  end if;

  foreach v_alias in array array[
    v_queue.candidate_key,
    v_queue.assessment #>> '{radarFactoryCandidateV1,candidateId}',
    v_queue.assessment #>> '{radarAutomaticLunaShippingContinuationV1,candidateId}',
    v_queue.assessment #>> '{candidate,candidateKey}',
    v_queue.assessment #>> '{productTruth,candidateKey}',
    v_canonical
  ] loop
    if v_alias is null or octet_length(v_alias) not between 1 and 200 then
      continue;
    end if;
    select a.canonical_candidate_id into v_conflicting
    from public.seller_os_current_candidate_identity_aliases_v1 a
    where a.account_key = p_account_key and a.alias_candidate_id = v_alias;
    if v_conflicting is not null and v_conflicting is distinct from v_canonical then
      raise exception 'CURRENT_COMMERCIAL_CANDIDATE_ALIAS_CONTRADICTION';
    end if;
    insert into public.seller_os_current_candidate_identity_aliases_v1 (
      account_key, alias_candidate_id, canonical_candidate_id,
      opportunity_id, source_contract, provenance
    ) values (
      p_account_key, v_alias, v_canonical, v_queue.id,
      case when v_alias = v_canonical
        then 'CURRENT_COMMERCIAL_CANDIDATE_IDENTITY_V1'
        else 'FAMILY_SCOPED_CANDIDATE_ID_ALIAS' end,
      jsonb_build_object(
        'productId', v_queue.supplier_product_id,
        'variantId', v_queue.supplier_variant_id,
        'supplierSku', v_queue.supplier_sku,
        'manualIdentityRebind', false,
        'codexRuntimeDependency', false)
    ) on conflict (account_key, alias_candidate_id) do update
      set last_seen_at = clock_timestamp()
      where seller_os_current_candidate_identity_aliases_v1.canonical_candidate_id = excluded.canonical_candidate_id
        and seller_os_current_candidate_identity_aliases_v1.opportunity_id = excluded.opportunity_id;
    if not found then
      raise exception 'CURRENT_COMMERCIAL_CANDIDATE_ALIAS_CONTRADICTION';
    end if;
    if not (v_alias = any(v_aliases)) then
      v_aliases := array_append(v_aliases, v_alias);
    end if;
  end loop;

  return jsonb_build_object(
    'contractVersion', 'CURRENT_COMMERCIAL_CANDIDATE_IDENTITY_V1',
    'canonicalCandidateId', v_canonical,
    'queueCandidateKey', v_queue.candidate_key,
    'aliasCandidateIds', to_jsonb(v_aliases),
    'canonicalCommercialIdentityMatch', true,
    'radarShippingIdentityDerivationAligned', true,
    'duplicateCandidateCount', 0,
    'manualIdentityRebind', false,
    'codexRuntimeDependency', false);
end
$function$;

revoke all on function public.seller_os_current_commercial_candidate_id_v1(
  text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.reconcile_seller_os_current_candidate_identity_v1(
  text,uuid,text) from public, anon, authenticated;
grant execute on function public.seller_os_current_commercial_candidate_id_v1(
  text,text,text,text,text,text) to service_role;
grant execute on function public.reconcile_seller_os_current_candidate_identity_v1(
  text,uuid,text) to service_role;

comment on function public.reconcile_seller_os_current_candidate_identity_v1(
  text,uuid,text) is
  'Fail-closed CURRENT Radar/Shipping commercial identity reconciliation. It records aliases only after exact account/product/variant/SKU agreement and never mutates Shipping evidence.';

notify pgrst, 'reload schema';
