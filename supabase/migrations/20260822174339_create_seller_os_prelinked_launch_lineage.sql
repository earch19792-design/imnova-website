-- OP-LAUNCH-I01 targeted artifact only. This creates a fail-closed shadow
-- launch lineage and early SKU reservation boundary. It creates no Product
-- Case truth, listing package, eBay draft/publication, external write, or job.
-- Pool membership/rank intentionally remains a bounded derived read model
-- (maximum 20 in the canonical runtime); this artifact stores global candidate
-- identity/lineage and cannot create a competing mutable pool truth.

create or replace function public.is_valid_seller_os_prelinked_launch_components_v1(
  p_components jsonb
)
returns boolean
language plpgsql immutable strict security invoker
set search_path = pg_catalog, extensions, pg_temp
as $function$
declare
  v_component jsonb;
  v_count integer;
begin
  if jsonb_typeof(p_components) <> 'array'
    or jsonb_array_length(p_components) not between 1 and 20 then
    return false;
  end if;

  for v_component in
    select value from jsonb_array_elements(p_components)
  loop
    if jsonb_typeof(v_component) <> 'object'
      or not (v_component ?& array[
        'componentOrdinal', 'componentIdentityId', 'lunaProductId',
        'lunaVariantId', 'lunaSku', 'supplierQuantityRequired',
        'identityEvidenceDigest', 'supplierIdentityStatus',
        'p2LinkageId', 'p2LinkageStatus'
      ])
      or (v_component - array[
        'componentOrdinal', 'componentIdentityId', 'lunaProductId',
        'lunaVariantId', 'lunaSku', 'supplierQuantityRequired',
        'identityEvidenceDigest', 'supplierIdentityStatus',
        'p2LinkageId', 'p2LinkageStatus'
      ]::text[]) <> '{}'::jsonb
      or coalesce(v_component ->> 'componentOrdinal', '') !~ '^[0-9]{1,2}$'
      or coalesce(v_component ->> 'componentIdentityId', '') <>
        'launch-component-v1:sha256:' || encode(
          extensions.digest(convert_to(concat(
            'SELLER_OS_PRELINKED_LAUNCH_COMPONENT_IDENTITY_V1', E'\n',
            v_component ->> 'lunaProductId', E'\n',
            v_component ->> 'lunaVariantId', E'\n',
            (v_component ->> 'supplierQuantityRequired')::integer::text
          ), 'UTF8'), 'sha256'), 'hex'
        )
      or coalesce(v_component ->> 'lunaProductId', '') !~ '^[0-9]{1,30}$'
      or coalesce(v_component ->> 'lunaVariantId', '') !~ '^[0-9]{1,30}$'
      or length(coalesce(v_component ->> 'lunaSku', '')) not between 1 and 120
      or coalesce(v_component ->> 'lunaSku', '') ~ '[[:cntrl:]]'
      or coalesce(v_component ->> 'supplierQuantityRequired', '') !~
        '^([1-9][0-9]{0,3}|10000)$'
      or coalesce(v_component ->> 'identityEvidenceDigest', '') !~
        '^sha256:[0-9a-f]{64}$'
      or coalesce(v_component ->> 'supplierIdentityStatus', '') not in (
        'EXACT_PRELINKED', 'UNPROVEN', 'UNKNOWN', 'UNAVAILABLE', 'CONFLICT'
      )
      or (
        v_component -> 'p2LinkageId' <> 'null'::jsonb
        and coalesce(v_component ->> 'p2LinkageId', '') !~
          '^luna-linkage-v1:sha256:[0-9a-f]{64}$'
      )
      or (
        v_component -> 'p2LinkageStatus' <> 'null'::jsonb
        and coalesce(v_component ->> 'p2LinkageStatus', '') not in (
          'CERTIFIED', 'UNPROVEN', 'CANDIDATE', 'HUMAN_REVIEW',
          'REJECTED', 'STALE'
        )
      )
      or (
        (v_component -> 'p2LinkageId' = 'null'::jsonb) <>
          (v_component -> 'p2LinkageStatus' = 'null'::jsonb)
      ) then
      return false;
    end if;

    if (v_component ->> 'componentOrdinal')::integer not between 1 and 20 then
      return false;
    end if;
  end loop;

  select count(*) into v_count
  from (
    select distinct (component.value ->> 'componentOrdinal')::integer
    from jsonb_array_elements(p_components) component(value)
  ) ordinals;
  if v_count <> jsonb_array_length(p_components) then
    return false;
  end if;

  select count(*) into v_count
  from (
    select distinct component.value ->> 'componentIdentityId'
    from jsonb_array_elements(p_components) component(value)
  ) identities;
  if v_count <> jsonb_array_length(p_components) then
    return false;
  end if;

  select count(*) into v_count
  from (
    select distinct concat(
      component.value ->> 'lunaProductId', E'\x1f',
      component.value ->> 'lunaVariantId'
    )
    from jsonb_array_elements(p_components) component(value)
  ) external_identities;
  return v_count = jsonb_array_length(p_components);
exception when others then
  return false;
end;
$function$;

create or replace function public.is_valid_seller_os_prelinked_launch_configuration_v1(
  p_offer_semantics jsonb,
  p_components jsonb
)
returns boolean
language plpgsql immutable strict security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_mode text;
  v_pack_count integer;
  v_component_count integer;
begin
  if jsonb_typeof(p_offer_semantics) <> 'object'
    or not (p_offer_semantics ?& array[
      'configurationMode', 'packCount', 'bundleSemantics'
    ])
    or (p_offer_semantics - array[
      'configurationMode', 'packCount', 'bundleSemantics'
    ]::text[]) <> '{}'::jsonb
    or coalesce(p_offer_semantics ->> 'packCount', '') !~
      '^([1-9][0-9]{0,3}|10000)$'
    or not public.is_valid_seller_os_prelinked_launch_components_v1(
      p_components
    ) then
    return false;
  end if;

  v_mode := p_offer_semantics ->> 'configurationMode';
  v_pack_count := (p_offer_semantics ->> 'packCount')::integer;
  v_component_count := jsonb_array_length(p_components);

  if v_mode = 'SINGLE_COMPONENT' then
    return p_offer_semantics ->> 'bundleSemantics' = 'SINGLE_COMPONENT'
      and v_pack_count = 1
      and v_component_count = 1
      and (p_components -> 0 ->> 'supplierQuantityRequired')::integer = 1;
  elsif v_mode = 'SIMPLE_MULTIPLIER' then
    return p_offer_semantics ->> 'bundleSemantics' = 'SIMPLE_MULTIPLIER'
      and v_pack_count > 1
      and v_component_count = 1
      and (p_components -> 0 ->> 'supplierQuantityRequired')::integer
        = v_pack_count;
  elsif v_mode = 'MULTI_COMPONENT_BOM' then
    return p_offer_semantics ->> 'bundleSemantics' = 'MULTI_COMPONENT_BOM'
      and v_pack_count = 1
      and v_component_count between 2 and 20;
  end if;
  return false;
exception when others then
  return false;
end;
$function$;

create or replace function public.is_valid_seller_os_launch_gate_statuses_v1(
  p_gate_statuses jsonb
)
returns boolean
language sql immutable strict security invoker
set search_path = pg_catalog, pg_temp
as $function$
  select coalesce(
    jsonb_typeof(p_gate_statuses) = 'object'
    and p_gate_statuses ?& array['SUPPLY','MARKET','ECONOMICS','LISTING']
    and (p_gate_statuses - array[
      'SUPPLY','MARKET','ECONOMICS','LISTING'
    ]::text[]) = '{}'::jsonb
    and p_gate_statuses ->> 'SUPPLY' in ('READY','NOT_READY','UNPROVEN')
    and p_gate_statuses ->> 'MARKET' in ('READY','NOT_READY','UNPROVEN')
    and p_gate_statuses ->> 'ECONOMICS' in ('READY','NOT_READY','UNPROVEN')
    and p_gate_statuses ->> 'LISTING' in ('READY','NOT_READY','UNPROVEN'),
    false
  );
$function$;

create or replace function public.is_valid_seller_os_prelinked_launch_text_array_v1(
  p_values text[],
  p_minimum integer,
  p_maximum integer
)
returns boolean
language sql immutable strict security invoker
set search_path = pg_catalog, pg_temp
as $function$
  select cardinality(p_values) between p_minimum and p_maximum
    and cardinality(p_values) = (
      select count(distinct item.value) from unnest(p_values) item(value)
    )
    and not exists (
      select 1 from unnest(p_values) item(value)
      where item.value is null
        or length(item.value) not between 1 and 240
        or item.value ~ '[[:cntrl:]]'
    );
$function$;

create or replace function public.is_valid_seller_os_launch_evidence_items_v1(
  p_evidence_items jsonb,
  p_account_key text,
  p_marketplace_id text,
  p_configuration_id text,
  p_components jsonb,
  p_evidence_references text[],
  p_gate_statuses jsonb,
  p_evaluated_at timestamptz
)
returns boolean
language plpgsql immutable strict security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_item jsonb;
  v_subject jsonb;
  v_expected_component_ids jsonb;
  v_item_count integer;
  v_unique_reference_count integer;
  v_maximum_age integer;
  v_gate_name text;
  v_required_class text;
  v_gate_item jsonb;
  v_gate_item_count integer;
begin
  if jsonb_typeof(p_evidence_items) <> 'array'
    or jsonb_array_length(p_evidence_items) not between 1 and 100
    or not public.is_valid_seller_os_launch_gate_statuses_v1(
      p_gate_statuses
    ) then
    return false;
  end if;

  select jsonb_agg(
    component.value ->> 'componentIdentityId'
    order by (component.value ->> 'componentIdentityId') collate "C"
  ) into v_expected_component_ids
  from jsonb_array_elements(p_components) component(value);

  for v_item in
    select value from jsonb_array_elements(p_evidence_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or not (v_item ?& array[
        'adapter', 'evidenceClass', 'subject', 'adapterVersion',
        'reference', 'evidenceDigest', 'sourceContractVersion',
        'observedAt', 'maximumAgeSeconds', 'availability',
        'authorityClass', 'blockerCodes'
      ])
      or (v_item - array[
        'adapter', 'evidenceClass', 'subject', 'adapterVersion',
        'reference', 'evidenceDigest', 'sourceContractVersion',
        'observedAt', 'maximumAgeSeconds', 'availability',
        'authorityClass', 'blockerCodes'
      ]::text[]) <> '{}'::jsonb
      or coalesce(v_item ->> 'adapter', '') not in (
        'SupplierIdentityAdapter', 'MarketEvidenceAdapter',
        'EconomicsEvidenceAdapter', 'ListingReadinessAdapter',
        'PortfolioPolicyAdapter', 'LearningOutcomeAdapter'
      )
      or coalesce(v_item ->> 'evidenceClass', '') not in (
        'SUPPLIER_IDENTITY', 'MARKET_EVIDENCE', 'ECONOMICS_EVIDENCE',
        'LISTING_READINESS', 'PORTFOLIO_POLICY', 'LEARNING_OUTCOME'
      )
      or (v_item ->> 'adapter' = 'SupplierIdentityAdapter'
        and v_item ->> 'evidenceClass' <> 'SUPPLIER_IDENTITY')
      or (v_item ->> 'adapter' = 'MarketEvidenceAdapter'
        and v_item ->> 'evidenceClass' <> 'MARKET_EVIDENCE')
      or (v_item ->> 'adapter' = 'EconomicsEvidenceAdapter'
        and v_item ->> 'evidenceClass' <> 'ECONOMICS_EVIDENCE')
      or (v_item ->> 'adapter' = 'ListingReadinessAdapter'
        and v_item ->> 'evidenceClass' <> 'LISTING_READINESS')
      or (v_item ->> 'adapter' = 'PortfolioPolicyAdapter'
        and v_item ->> 'evidenceClass' <> 'PORTFOLIO_POLICY')
      or (v_item ->> 'adapter' = 'LearningOutcomeAdapter'
        and v_item ->> 'evidenceClass' <> 'LEARNING_OUTCOME')
      or length(coalesce(v_item ->> 'adapterVersion', '')) not between 1 and 120
      or coalesce(v_item ->> 'adapterVersion', '') ~ '[|[:cntrl:]]'
      or length(coalesce(v_item ->> 'reference', '')) not between 1 and 240
      or coalesce(v_item ->> 'reference', '') ~ '[|[:cntrl:]]'
      or not (v_item ->> 'reference' = any(p_evidence_references))
      or coalesce(v_item ->> 'evidenceDigest', '') !~
        '^sha256:[0-9a-f]{64}$'
      or length(coalesce(v_item ->> 'sourceContractVersion', ''))
        not between 1 and 120
      or coalesce(v_item ->> 'sourceContractVersion', '') ~ '[|[:cntrl:]]'
      or coalesce(v_item ->> 'observedAt', '') !~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
      or coalesce(v_item ->> 'maximumAgeSeconds', '') !~ '^[0-9]{1,6}$'
      or coalesce(v_item ->> 'availability', '') not in (
        'AVAILABLE', 'UNPROVEN', 'UNKNOWN', 'UNAVAILABLE', 'STALE', 'CONFLICT'
      )
      or coalesce(v_item ->> 'authorityClass', '') not in (
        'OFFICIAL_EXTERNAL_FACT', 'DIRECT_OBSERVATION',
        'DURABLY_PERSISTED_FACT', 'DERIVED_FACT', 'INFERENCE',
        'RECOMMENDATION', 'UNPROVEN', 'UNAVAILABLE'
      )
      or (
        v_item ->> 'authorityClass' in ('UNPROVEN', 'UNAVAILABLE')
        and v_item ->> 'availability' = 'AVAILABLE'
      )
      or jsonb_typeof(v_item -> 'blockerCodes') <> 'array'
      or jsonb_array_length(v_item -> 'blockerCodes') > 64
      or exists (
        select 1
        from jsonb_array_elements(v_item -> 'blockerCodes') blocker(value)
        where jsonb_typeof(blocker.value) <> 'string'
          or length(blocker.value #>> '{}') not between 2 and 120
          or blocker.value #>> '{}' !~ '^[A-Z][A-Z0-9_]{1,119}$'
      ) then
      return false;
    end if;

    v_maximum_age := (v_item ->> 'maximumAgeSeconds')::integer;
    if v_maximum_age not between 60 and 86400 then
      return false;
    end if;
    perform (v_item ->> 'observedAt')::timestamptz;

    v_subject := v_item -> 'subject';
    if jsonb_typeof(v_subject) <> 'object'
      or not (v_subject ?& array[
        'accountKey', 'marketplaceId', 'configurationIdentity',
        'componentIdentityIds'
      ])
      or (v_subject - array[
        'accountKey', 'marketplaceId', 'configurationIdentity',
        'componentIdentityIds'
      ]::text[]) <> '{}'::jsonb
      or v_subject ->> 'accountKey' <> p_account_key
      or v_subject ->> 'marketplaceId' <> p_marketplace_id
      or v_subject ->> 'configurationIdentity' <> p_configuration_id
      or jsonb_typeof(v_subject -> 'componentIdentityIds') <> 'array'
      or v_subject -> 'componentIdentityIds' <> v_expected_component_ids then
      return false;
    end if;
  end loop;

  -- A claimed READY gate must be backed by exactly one fresh, AVAILABLE item
  -- from an allowed factual authority. Non-ready gates may truthfully retain
  -- missing/unavailable evidence in this shadow foundation.
  for v_gate_name, v_required_class in
    select * from (values
      ('SUPPLY', 'SUPPLIER_IDENTITY'),
      ('MARKET', 'MARKET_EVIDENCE'),
      ('ECONOMICS', 'ECONOMICS_EVIDENCE'),
      ('LISTING', 'LISTING_READINESS')
    ) required(gate_name, evidence_class)
  loop
    select count(*) into v_gate_item_count
    from jsonb_array_elements(p_evidence_items) item(value)
    where item.value ->> 'evidenceClass' = v_required_class;
    if p_gate_statuses ->> v_gate_name = 'READY' then
      if v_gate_item_count <> 1 then
        return false;
      end if;
      select item.value into v_gate_item
      from jsonb_array_elements(p_evidence_items) item(value)
      where item.value ->> 'evidenceClass' = v_required_class
      limit 1;
      if v_gate_item ->> 'availability' <> 'AVAILABLE'
        or jsonb_array_length(v_gate_item -> 'blockerCodes') <> 0
        or (v_gate_item ->> 'observedAt')::timestamptz >
          p_evaluated_at + interval '5 minutes'
        or (v_gate_item ->> 'observedAt')::timestamptz + make_interval(
          secs => (v_gate_item ->> 'maximumAgeSeconds')::integer
        ) < p_evaluated_at
        or (
          v_gate_name in ('SUPPLY', 'MARKET')
          and v_gate_item ->> 'authorityClass' not in (
            'OFFICIAL_EXTERNAL_FACT', 'DIRECT_OBSERVATION',
            'DURABLY_PERSISTED_FACT'
          )
        )
        or (
          v_gate_name in ('ECONOMICS', 'LISTING')
          and v_gate_item ->> 'authorityClass' not in (
            'DURABLY_PERSISTED_FACT', 'DERIVED_FACT'
          )
        )
        or (
          v_gate_name = 'SUPPLY'
          and exists (
            select 1 from jsonb_array_elements(p_components) component(value)
            where component.value ->> 'supplierIdentityStatus' <>
              'EXACT_PRELINKED'
          )
        ) then
        return false;
      end if;
    end if;
  end loop;

  v_item_count := jsonb_array_length(p_evidence_items);
  select count(distinct item.value ->> 'reference')
  into v_unique_reference_count
  from jsonb_array_elements(p_evidence_items) item(value);
  if v_unique_reference_count <> v_item_count
    or v_unique_reference_count <> cardinality(p_evidence_references)
    or exists (
      select 1 from unnest(p_evidence_references) reference(value)
      where not exists (
        select 1 from jsonb_array_elements(p_evidence_items) item(value)
        where item.value ->> 'reference' = reference.value
      )
    ) then
    return false;
  end if;

  return true;
exception when others then
  return false;
end;
$function$;

create table public.seller_os_prelinked_launch_evidence_packages (
  evidence_package_id text primary key,
  evidence_digest text not null unique,
  account_key text not null,
  marketplace_id text not null default 'EBAY_US',
  configuration_id text not null,
  configuration_identity_digest text not null,
  components jsonb not null,
  offer_semantics jsonb not null,
  evidence_references text[] not null,
  evidence_items jsonb not null,
  evidence_provenance jsonb not null,
  p2_dependency_gate text not null,
  gate_statuses jsonb not null,
  ranking_score numeric(6,2) not null,
  score_version text not null,
  hard_blockers text[] not null,
  evidence_evaluated_at timestamptz not null,
  evidence_maximum_age_seconds integer not null,
  limitations text[] not null default '{}',
  readiness text not null default 'NOT_READY_TO_LIST',
  contract_version text not null
    default 'SELLER_OS_LAUNCH_EVIDENCE_PACKAGE_V1',
  created_at timestamptz not null default now(),
  constraint seller_os_prelinked_launch_evidence_id_check check (
    evidence_package_id ~ '^launch-evidence-v1:sha256:[0-9a-f]{64}$'
    and evidence_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_prelinked_launch_evidence_account_check check (
    account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
  ),
  constraint seller_os_prelinked_launch_evidence_marketplace_check check (
    marketplace_id = 'EBAY_US'
  ),
  constraint seller_os_prelinked_launch_evidence_configuration_check check (
    configuration_id =
      'launch-configuration-v1:' || configuration_identity_digest
    and configuration_identity_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_prelinked_launch_evidence_components_check check (
    public.is_valid_seller_os_prelinked_launch_components_v1(components)
    and public.is_valid_seller_os_prelinked_launch_configuration_v1(
      offer_semantics, components
    )
  ),
  constraint seller_os_prelinked_launch_evidence_references_check check (
    public.is_valid_seller_os_prelinked_launch_text_array_v1(
      evidence_references, 1, 100
    )
  ),
  constraint seller_os_prelinked_launch_evidence_items_check check (
    public.is_valid_seller_os_launch_evidence_items_v1(
      evidence_items, account_key, marketplace_id, configuration_id,
      components, evidence_references, gate_statuses, evidence_evaluated_at
    )
  ),
  constraint seller_os_prelinked_launch_evidence_provenance_check check (
    evidence_provenance = jsonb_build_object(
      'contractVersion', 'SELLER_OS_LAUNCH_EVIDENCE_PACKAGE_V1',
      'authority', 'SERVER_GENERATED',
      'productCaseAuthority', 'PRODUCT_CASE_NON_AUTHORITATIVE',
      'fastLaneAuthority', 'SHADOW_FOUNDATION_ONLY'
    )
  ),
  constraint seller_os_prelinked_launch_evidence_gates_check check (
    p2_dependency_gate in (
      'PREPUBLICATION_PRELINKED_ONLY', 'PASS', 'BLOCKED', 'UNPROVEN'
    )
    and public.is_valid_seller_os_launch_gate_statuses_v1(gate_statuses)
  ),
  constraint seller_os_prelinked_launch_evidence_score_check check (
    ranking_score between 0 and 100
    and score_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$'
  ),
  constraint seller_os_prelinked_launch_evidence_blockers_check check (
    public.is_valid_seller_os_prelinked_launch_text_array_v1(
      hard_blockers, 0, 64
    )
  ),
  constraint seller_os_prelinked_launch_evidence_age_check check (
    evidence_maximum_age_seconds between 60 and 86400
    and evidence_evaluated_at = date_trunc(
      'milliseconds', evidence_evaluated_at
    )
  ),
  constraint seller_os_prelinked_launch_evidence_limitations_check check (
    public.is_valid_seller_os_prelinked_launch_text_array_v1(
      limitations, 0, 64
    )
  ),
  constraint seller_os_prelinked_launch_evidence_readiness_check check (
    readiness in ('NOT_READY_TO_LIST', 'READY_TO_LIST')
  ),
  constraint seller_os_prelinked_launch_evidence_contract_check check (
    contract_version = 'SELLER_OS_LAUNCH_EVIDENCE_PACKAGE_V1'
  )
);

create table public.seller_os_prelinked_launch_candidates (
  launch_candidate_id text primary key,
  configuration_id text not null,
  launch_id text not null unique,
  account_key text not null,
  marketplace_id text not null default 'EBAY_US',
  configuration_identity_digest text not null,
  components jsonb not null,
  offer_semantics jsonb not null,
  current_evidence_package_id text not null
    references public.seller_os_prelinked_launch_evidence_packages(
      evidence_package_id
    ) on delete restrict,
  current_evidence_digest text not null,
  supply_gate_status text not null,
  market_gate_status text not null,
  economics_gate_status text not null,
  listing_gate_status text not null,
  p2_i01_gate_status text not null,
  p2_i02_gate_status text not null,
  ranking_score numeric(6,2) not null,
  score_version text not null,
  hard_blockers text[] not null,
  opportunity_candidate_key text null,
  product_case_id text null,
  product_case_version_id text null,
  p2_linkage_id text null,
  canonical_sku text null,
  reserved_listing_package_id uuid null,
  sku_reservation_id text null,
  sku_reservation_idempotency_key text null,
  sku_reserved_at timestamptz null,
  listing_package_id uuid null
    references public.ebay_listing_packages(id) on delete restrict,
  ebay_item_id text null,
  outcome_tracking_id text null,
  launch_state text not null default 'NEEDS_DATA',
  human_approval_required boolean not null default true,
  publish_allowed boolean not null default false,
  p2_gate_bypass_allowed boolean not null default false,
  contract_version text not null
    default 'SELLER_OS_PRELINKED_LAUNCH_CANDIDATE_V1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_os_prelinked_launch_candidate_business_grain_unique
    unique (configuration_identity_digest),
  constraint seller_os_prelinked_launch_candidate_id_check check (
    launch_candidate_id ~
      '^prelinked-candidate-v1:sha256:[0-9a-f]{64}$'
    and configuration_id =
      'launch-configuration-v1:' || configuration_identity_digest
    and launch_id ~ '^prelinked-launch-v1:sha256:[0-9a-f]{64}$'
    and configuration_identity_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_prelinked_launch_candidate_account_check check (
    account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    and marketplace_id = 'EBAY_US'
  ),
  constraint seller_os_prelinked_launch_candidate_configuration_check check (
    public.is_valid_seller_os_prelinked_launch_components_v1(components)
    and public.is_valid_seller_os_prelinked_launch_configuration_v1(
      offer_semantics, components
    )
  ),
  constraint seller_os_prelinked_launch_candidate_evidence_check check (
    current_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_prelinked_launch_candidate_gate_check check (
    supply_gate_status in ('READY','NOT_READY','UNPROVEN')
    and market_gate_status in ('READY','NOT_READY','UNPROVEN')
    and economics_gate_status in ('READY','NOT_READY','UNPROVEN')
    and listing_gate_status in ('READY','NOT_READY','UNPROVEN')
    and p2_i01_gate_status in (
      'PREPUBLICATION_PRELINKED_ONLY','PASS','BLOCKED','UNPROVEN'
    )
    and p2_i02_gate_status in (
      'PREPUBLICATION_PRELINKED_ONLY','PASS','BLOCKED','UNPROVEN'
    )
  ),
  constraint seller_os_prelinked_launch_candidate_score_check check (
    ranking_score between 0 and 100
    and score_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$'
  ),
  constraint seller_os_prelinked_launch_candidate_blockers_check check (
    public.is_valid_seller_os_prelinked_launch_text_array_v1(
      hard_blockers, 0, 64
    )
  ),
  constraint seller_os_prelinked_launch_candidate_lineage_refs_check check (
    (opportunity_candidate_key is null or (
      length(opportunity_candidate_key) between 1 and 240
      and opportunity_candidate_key !~ '[[:cntrl:]]'
    ))
    and (product_case_id is null or (
      length(product_case_id) between 1 and 240
      and product_case_id !~ '[[:cntrl:]]'
    ))
    and (product_case_version_id is null or (
      length(product_case_version_id) between 1 and 240
      and product_case_version_id !~ '[[:cntrl:]]'
    ))
    and ((product_case_id is null) = (product_case_version_id is null))
  ),
  constraint seller_os_prelinked_launch_candidate_p2_linkage_check check (
    p2_linkage_id is null or
      p2_linkage_id ~ '^luna-linkage-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_prelinked_launch_candidate_sku_shape_check check (
    (
      canonical_sku is null
      and reserved_listing_package_id is null
      and sku_reservation_id is null
      and sku_reservation_idempotency_key is null
      and sku_reserved_at is null
    ) or (
      canonical_sku = 'IMNOVA' || upper(replace(
        reserved_listing_package_id::text, '-', ''
      ))
      and canonical_sku ~ '^IMNOVA[0-9A-F]{32}$'
      and length(canonical_sku) = 38
      and sku_reservation_id =
        'prelinked-launch-sku-reservation-v1:' || canonical_sku
      and sku_reservation_idempotency_key ~
        '^prelinked-launch-reservation-v1:sha256:[0-9a-f]{64}$'
      and sku_reserved_at is not null
    )
  ),
  constraint seller_os_prelinked_launch_candidate_downstream_refs_check check (
    (ebay_item_id is null or ebay_item_id ~ '^[0-9]{9,20}$')
    and (outcome_tracking_id is null or outcome_tracking_id ~
      '^launch-outcome-tracking-v1:sha256:[0-9a-f]{64}$')
    and (
      listing_package_id is null
      or listing_package_id = reserved_listing_package_id
    )
  ),
  constraint seller_os_prelinked_launch_candidate_safety_check check (
    launch_state in (
      'NEEDS_DATA', 'READY_TO_LIST', 'LISTING_PACKAGE_BOUND', 'PUBLISHED'
    )
    and not p2_gate_bypass_allowed
  ),
  constraint seller_os_prelinked_launch_candidate_contract_check check (
    contract_version = 'SELLER_OS_PRELINKED_LAUNCH_CANDIDATE_V1'
  )
);

create unique index seller_os_prelinked_launch_candidate_sku_unique
  on public.seller_os_prelinked_launch_candidates(
    account_key, marketplace_id, canonical_sku
  ) where canonical_sku is not null;
create unique index seller_os_prelinked_launch_candidate_package_unique
  on public.seller_os_prelinked_launch_candidates(reserved_listing_package_id)
  where reserved_listing_package_id is not null;
create unique index seller_os_prelinked_launch_candidate_bound_package_unique
  on public.seller_os_prelinked_launch_candidates(listing_package_id)
  where listing_package_id is not null;
create unique index seller_os_prelinked_launch_candidate_item_unique
  on public.seller_os_prelinked_launch_candidates(
    account_key, marketplace_id, ebay_item_id
  ) where ebay_item_id is not null;
create unique index seller_os_prelinked_launch_candidate_p2_linkage_unique
  on public.seller_os_prelinked_launch_candidates(p2_linkage_id)
  where p2_linkage_id is not null;
create unique index seller_os_prelinked_launch_candidate_outcome_unique
  on public.seller_os_prelinked_launch_candidates(outcome_tracking_id)
  where outcome_tracking_id is not null;
create unique index seller_os_prelinked_launch_candidate_reservation_key_unique
  on public.seller_os_prelinked_launch_candidates(
    account_key, marketplace_id, sku_reservation_idempotency_key
  ) where sku_reservation_idempotency_key is not null;

create table public.seller_os_prelinked_launch_lineage_references (
  lineage_reference_id text primary key,
  launch_candidate_id text not null
    references public.seller_os_prelinked_launch_candidates(
      launch_candidate_id
    ) on delete restrict,
  source_type text not null,
  source_identity text not null,
  evidence_digest text not null,
  authority_class text not null,
  observed_at timestamptz not null,
  contract_version text not null
    default 'SELLER_OS_PRELINKED_LAUNCH_LINEAGE_V1',
  created_at timestamptz not null default now(),
  constraint seller_os_prelinked_launch_lineage_grain_unique unique (
    launch_candidate_id, source_type, source_identity, evidence_digest
  ),
  constraint seller_os_prelinked_launch_lineage_id_check check (
    lineage_reference_id ~
      '^prelinked-launch-lineage-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_prelinked_launch_lineage_source_check check (
    source_type in (
      'SELLER_OS_LUNA_LINKAGE_DECISION',
      'MARKETPLACE_LISTING_APPROVAL_QUEUE_ITEM',
      'EBAY_LUNA_OPPORTUNITY',
      'EBAY_PRODUCT_CANDIDATE',
      'EBAY_LISTING_PACKAGE',
      'MARKET_RADAR_PRODUCT',
      'PRODUCT_CASE'
    )
    and length(source_identity) between 1 and 240
    and source_identity !~ '[[:cntrl:]]'
  ),
  constraint seller_os_prelinked_launch_lineage_evidence_check check (
    evidence_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_prelinked_launch_lineage_authority_check check (
    (source_type = 'SELLER_OS_LUNA_LINKAGE_DECISION'
      and authority_class = 'CANONICAL_SOURCE')
    or (source_type in (
      'MARKETPLACE_LISTING_APPROVAL_QUEUE_ITEM',
      'EBAY_LUNA_OPPORTUNITY',
      'EBAY_PRODUCT_CANDIDATE',
      'EBAY_LISTING_PACKAGE',
      'MARKET_RADAR_PRODUCT'
    ) and authority_class = 'DISCOVERY_ONLY')
    or (source_type = 'PRODUCT_CASE'
      and authority_class = 'PRODUCT_CASE_NON_AUTHORITATIVE')
  ),
  constraint seller_os_prelinked_launch_lineage_contract_check check (
    contract_version = 'SELLER_OS_PRELINKED_LAUNCH_LINEAGE_V1'
  )
);

comment on table public.seller_os_prelinked_launch_evidence_packages is
  'Immutable server-generated launch evidence; Product Case and Fast Lane are non-authoritative. The OP-LAUNCH-I01 RPC always records NOT_READY_TO_LIST; future readiness requires an independently gated adapter and migration.';
comment on table public.seller_os_prelinked_launch_candidates is
  'Candidate identity is stable across evidence refresh. OP-LAUNCH-I01 RPCs force NEEDS_DATA, human approval required, publish forbidden; future transitions require an independently gated adapter and migration.';
comment on table public.seller_os_prelinked_launch_lineage_references is
  'Append-only source lineage. Product Case and discovery queues are never product or launch truth.';

create index seller_os_prelinked_launch_evidence_account_idx
  on public.seller_os_prelinked_launch_evidence_packages(
    account_key, marketplace_id, created_at desc
  );
create index seller_os_prelinked_launch_candidates_state_idx
  on public.seller_os_prelinked_launch_candidates(
    account_key, marketplace_id, launch_state, created_at desc
  );
create index seller_os_prelinked_launch_lineage_candidate_idx
  on public.seller_os_prelinked_launch_lineage_references(
    launch_candidate_id, created_at
  );

create or replace function public.reject_seller_os_prelinked_launch_append_mutation_v1()
returns trigger
language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  raise exception 'SELLER_OS_PRELINKED_LAUNCH_APPEND_ONLY';
end;
$function$;

create trigger seller_os_prelinked_launch_evidence_immutable
before update or delete
on public.seller_os_prelinked_launch_evidence_packages
for each row execute function
  public.reject_seller_os_prelinked_launch_append_mutation_v1();
create trigger seller_os_prelinked_launch_lineage_append_only
before update or delete
on public.seller_os_prelinked_launch_lineage_references
for each row execute function
  public.reject_seller_os_prelinked_launch_append_mutation_v1();

alter table public.seller_os_prelinked_launch_evidence_packages
  enable row level security;
alter table public.seller_os_prelinked_launch_evidence_packages
  force row level security;
alter table public.seller_os_prelinked_launch_candidates
  enable row level security;
alter table public.seller_os_prelinked_launch_candidates
  force row level security;
alter table public.seller_os_prelinked_launch_lineage_references
  enable row level security;
alter table public.seller_os_prelinked_launch_lineage_references
  force row level security;

revoke all on table public.seller_os_prelinked_launch_evidence_packages
  from public, anon, authenticated, service_role;
revoke all on table public.seller_os_prelinked_launch_candidates
  from public, anon, authenticated, service_role;
revoke all on table public.seller_os_prelinked_launch_lineage_references
  from public, anon, authenticated, service_role;
grant select on table public.seller_os_prelinked_launch_evidence_packages
  to service_role;
grant select on table public.seller_os_prelinked_launch_candidates
  to service_role;
grant select on table public.seller_os_prelinked_launch_lineage_references
  to service_role;

create policy seller_os_prelinked_launch_evidence_service_role_read
  on public.seller_os_prelinked_launch_evidence_packages
  for select to service_role using (true);
create policy seller_os_prelinked_launch_candidate_service_role_read
  on public.seller_os_prelinked_launch_candidates
  for select to service_role using (true);
create policy seller_os_prelinked_launch_lineage_service_role_read
  on public.seller_os_prelinked_launch_lineage_references
  for select to service_role using (true);

-- FORCE RLS remains active inside fixed SECURITY DEFINER RPCs. Owner policies
-- additionally require the existing server-side service-role request gate.
create policy seller_os_prelinked_launch_evidence_rpc_owner_insert
  on public.seller_os_prelinked_launch_evidence_packages
  for insert to postgres
  with check (public.is_seller_os_service_role_request_v1());
create policy seller_os_prelinked_launch_evidence_rpc_owner_read
  on public.seller_os_prelinked_launch_evidence_packages
  for select to postgres
  using (public.is_seller_os_service_role_request_v1());
create policy seller_os_prelinked_launch_candidate_rpc_owner_insert
  on public.seller_os_prelinked_launch_candidates
  for insert to postgres
  with check (public.is_seller_os_service_role_request_v1());
create policy seller_os_prelinked_launch_candidate_rpc_owner_read
  on public.seller_os_prelinked_launch_candidates
  for select to postgres
  using (public.is_seller_os_service_role_request_v1());
create policy seller_os_prelinked_launch_candidate_rpc_owner_update
  on public.seller_os_prelinked_launch_candidates
  for update to postgres
  using (public.is_seller_os_service_role_request_v1())
  with check (public.is_seller_os_service_role_request_v1());
create policy seller_os_prelinked_launch_lineage_rpc_owner_insert
  on public.seller_os_prelinked_launch_lineage_references
  for insert to postgres
  with check (public.is_seller_os_service_role_request_v1());
create policy seller_os_prelinked_launch_lineage_rpc_owner_read
  on public.seller_os_prelinked_launch_lineage_references
  for select to postgres
  using (public.is_seller_os_service_role_request_v1());

create or replace function public.put_seller_os_prelinked_launch_evidence_package_v1(
  p_account_key text,
  p_marketplace_id text,
  p_p2_dependency_gate text,
  p_components jsonb,
  p_offer_semantics jsonb,
  p_evidence_references text[],
  p_evidence_items jsonb,
  p_gate_statuses jsonb,
  p_ranking_score numeric,
  p_score_version text,
  p_hard_blockers text[],
  p_evaluated_at timestamptz,
  p_evidence_maximum_age_seconds integer,
  p_limitations text[] default '{}'
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_account_key text := trim(coalesce(p_account_key, ''));
  v_components jsonb;
  v_evidence_references text[];
  v_evidence_items jsonb;
  v_hard_blockers text[];
  v_limitations text[];
  v_identity_components text;
  v_evidence_item_lines text;
  v_evaluated_at_text text;
  v_configuration_identity_digest text;
  v_configuration_id text;
  v_evidence_digest text;
  v_evidence_package_id text;
  v_provenance constant jsonb := jsonb_build_object(
    'contractVersion', 'SELLER_OS_LAUNCH_EVIDENCE_PACKAGE_V1',
    'authority', 'SERVER_GENERATED',
    'productCaseAuthority', 'PRODUCT_CASE_NON_AUTHORITATIVE',
    'fastLaneAuthority', 'SHADOW_FOUNDATION_ONLY'
  );
  v_existing public.seller_os_prelinked_launch_evidence_packages%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
    or v_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_marketplace_id <> 'EBAY_US'
    or p_p2_dependency_gate not in (
      'PREPUBLICATION_PRELINKED_ONLY', 'PASS', 'BLOCKED', 'UNPROVEN'
    )
    or not public.is_valid_seller_os_prelinked_launch_components_v1(
      p_components
    )
    or not public.is_valid_seller_os_prelinked_launch_configuration_v1(
      p_offer_semantics, p_components
    )
    or not public.is_valid_seller_os_prelinked_launch_text_array_v1(
      p_evidence_references, 1, 100
    )
    or jsonb_typeof(p_evidence_items) <> 'array'
    or jsonb_array_length(p_evidence_items) not between 1 and 100
    or exists (
      select 1 from jsonb_array_elements(p_evidence_items) item(value)
      where jsonb_typeof(item.value) <> 'object'
        or jsonb_typeof(item.value -> 'blockerCodes') <> 'array'
    )
    or not public.is_valid_seller_os_launch_gate_statuses_v1(p_gate_statuses)
    or p_ranking_score not between 0 and 100
    or coalesce(p_score_version, '') !~
      '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$'
    or not public.is_valid_seller_os_prelinked_launch_text_array_v1(
      p_hard_blockers, 1, 64
    )
    or not public.is_valid_seller_os_prelinked_launch_text_array_v1(
      p_limitations, 0, 64
    )
    or p_evidence_maximum_age_seconds not between 60 and 86400
    or p_evaluated_at is distinct from date_trunc(
      'milliseconds', p_evaluated_at
    )
    or p_evaluated_at > now() + interval '5 minutes'
    or p_evaluated_at + make_interval(
      secs => p_evidence_maximum_age_seconds
    ) < now() then
    raise exception 'SELLER_OS_PRELINKED_LAUNCH_EVIDENCE_INPUT_INVALID';
  end if;

  -- Normalize every set-like input before persistence and digesting. Component
  -- ordinals are assigned from the external Luna tuple, never caller order.
  select jsonb_agg(
    jsonb_set(component.value, '{componentOrdinal}',
      to_jsonb(component.canonical_ordinal), false)
    order by component.canonical_ordinal
  ) into v_components
  from (
    select value,
      row_number() over (order by
        (value ->> 'lunaProductId') collate "C",
        (value ->> 'lunaVariantId') collate "C",
        (value ->> 'supplierQuantityRequired')::integer
      )::integer as canonical_ordinal
    from jsonb_array_elements(p_components)
  ) component;
  select array_agg(reference.value order by reference.value collate "C")
    into v_evidence_references
  from unnest(p_evidence_references) reference(value);
  select jsonb_agg(
    jsonb_set(item.value, '{blockerCodes}', coalesce((
      select jsonb_agg(blocker.value #>> '{}'
        order by (blocker.value #>> '{}') collate "C")
      from jsonb_array_elements(item.value -> 'blockerCodes') blocker(value)
    ), '[]'::jsonb), false)
    order by (item.value ->> 'evidenceClass') collate "C",
      (item.value ->> 'reference') collate "C"
  ) into v_evidence_items
  from jsonb_array_elements(p_evidence_items) item(value);
  select coalesce(array_agg(blocker.value
    order by blocker.value collate "C"), '{}')
    into v_hard_blockers
  from unnest(p_hard_blockers) blocker(value);
  select coalesce(array_agg(limitation.value
    order by limitation.value collate "C"), '{}')
    into v_limitations
  from unnest(p_limitations) limitation(value);

  select string_agg(concat_ws(':',
    component.value ->> 'lunaProductId',
    component.value ->> 'lunaVariantId',
    (component.value ->> 'supplierQuantityRequired')::integer::text
  ), E'\n' order by
    (component.value ->> 'lunaProductId') collate "C",
    (component.value ->> 'lunaVariantId') collate "C",
    (component.value ->> 'supplierQuantityRequired')::integer)
  into v_identity_components
  from jsonb_array_elements(v_components) component(value);

  v_configuration_identity_digest := 'sha256:' || encode(
    extensions.digest(convert_to(concat(
      'SELLER_OS_PRELINKED_CONFIGURATION_V1', E'\n',
      p_offer_semantics ->> 'configurationMode', E'\n',
      v_identity_components
    ), 'UTF8'), 'sha256'), 'hex'
  );
  v_configuration_id := 'launch-configuration-v1:'
    || v_configuration_identity_digest;
  if not public.is_valid_seller_os_launch_evidence_items_v1(
    v_evidence_items, v_account_key, p_marketplace_id,
    v_configuration_id, v_components, v_evidence_references,
    p_gate_statuses, p_evaluated_at
  ) then
    raise exception 'SELLER_OS_PRELINKED_LAUNCH_EVIDENCE_ITEMS_INVALID';
  end if;
  select string_agg(line.item_line, E'\n'
    order by line.item_line collate "C")
  into v_evidence_item_lines
  from jsonb_array_elements(v_evidence_items) item(value)
  cross join lateral (
    select concat_ws('|',
      item.value ->> 'adapter',
      item.value ->> 'evidenceClass',
      item.value ->> 'adapterVersion',
      item.value ->> 'reference',
      item.value ->> 'evidenceDigest',
      item.value ->> 'sourceContractVersion',
      item.value ->> 'observedAt',
      (item.value ->> 'maximumAgeSeconds')::integer::text,
      item.value ->> 'availability',
      item.value ->> 'authorityClass',
      coalesce((
        select string_agg(blocker.value #>> '{}', ','
          order by (blocker.value #>> '{}') collate "C")
        from jsonb_array_elements(item.value -> 'blockerCodes') blocker(value)
      ), '')
    ) as item_line
  ) line;
  v_evaluated_at_text := to_char(
    p_evaluated_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  v_evidence_package_id := 'launch-evidence-v1:sha256:' || encode(
    extensions.digest(convert_to(concat(
      'SELLER_OS_LAUNCH_EVIDENCE_PACKAGE_ID_V1', E'\n',
      v_account_key, E'\n', p_marketplace_id, E'\n',
      v_configuration_id, E'\n', p_p2_dependency_gate, E'\n',
      v_evidence_item_lines
    ), 'UTF8'), 'sha256'), 'hex'
  );
  v_evidence_digest := 'sha256:' || encode(
    extensions.digest(convert_to(concat(
      'SELLER_OS_LAUNCH_EVIDENCE_DIGEST_V1', E'\n',
      v_evidence_package_id, E'\n', v_evaluated_at_text, E'\n',
      p_gate_statuses ->> 'SUPPLY', E'\n',
      p_gate_statuses ->> 'MARKET', E'\n',
      p_gate_statuses ->> 'ECONOMICS', E'\n',
      p_gate_statuses ->> 'LISTING',
      case when cardinality(v_hard_blockers) = 0 then ''
        else E'\n' || array_to_string(v_hard_blockers, E'\n') end
    ), 'UTF8'), 'sha256'), 'hex'
  );

  perform pg_advisory_xact_lock(hashtextextended(v_evidence_package_id, 0));
  select * into v_existing
  from public.seller_os_prelinked_launch_evidence_packages
  where evidence_package_id = v_evidence_package_id;
  if found then
    if v_existing.account_key is distinct from v_account_key
      or v_existing.marketplace_id is distinct from p_marketplace_id
      or v_existing.configuration_id is distinct from v_configuration_id
      or v_existing.components is distinct from v_components
      or v_existing.offer_semantics is distinct from p_offer_semantics
      or v_existing.evidence_references is distinct from v_evidence_references
      or v_existing.evidence_items is distinct from v_evidence_items
      or v_existing.p2_dependency_gate is distinct from p_p2_dependency_gate
      or v_existing.gate_statuses is distinct from p_gate_statuses
      or v_existing.ranking_score is distinct from p_ranking_score
      or v_existing.score_version is distinct from p_score_version
      or v_existing.hard_blockers is distinct from v_hard_blockers
      or v_existing.evidence_evaluated_at is distinct from p_evaluated_at
      or v_existing.evidence_maximum_age_seconds is distinct from
        p_evidence_maximum_age_seconds
      or v_existing.limitations is distinct from v_limitations then
      raise exception 'SELLER_OS_PRELINKED_LAUNCH_EVIDENCE_DIGEST_CONFLICT';
    end if;
    return jsonb_build_object(
      'outcome', 'IDEMPOTENT_SUCCESS',
      'evidencePackageId', v_existing.evidence_package_id,
      'evidenceDigest', v_existing.evidence_digest,
      'configurationId', v_existing.configuration_id
    );
  end if;

  insert into public.seller_os_prelinked_launch_evidence_packages (
    evidence_package_id, evidence_digest, account_key, marketplace_id,
    configuration_id, configuration_identity_digest, components,
    offer_semantics, evidence_references, evidence_items, evidence_provenance,
    p2_dependency_gate, gate_statuses, ranking_score, score_version,
    hard_blockers, evidence_evaluated_at,
    evidence_maximum_age_seconds, limitations
  ) values (
    v_evidence_package_id, v_evidence_digest, v_account_key,
    p_marketplace_id, v_configuration_id,
    v_configuration_identity_digest, v_components, p_offer_semantics,
    v_evidence_references, v_evidence_items, v_provenance,
    p_p2_dependency_gate, p_gate_statuses, p_ranking_score,
    p_score_version, v_hard_blockers, p_evaluated_at,
    p_evidence_maximum_age_seconds, v_limitations
  ) returning * into v_existing;

  return jsonb_build_object(
    'outcome', 'CREATED',
    'evidencePackageId', v_existing.evidence_package_id,
    'evidenceDigest', v_existing.evidence_digest,
    'configurationId', v_existing.configuration_id
  );
end;
$function$;

create or replace function public.put_seller_os_prelinked_launch_candidate_v1(
  p_account_key text,
  p_marketplace_id text,
  p_evidence_package_id text,
  p_p2_i01_gate_status text,
  p_p2_i02_gate_status text,
  p_opportunity_candidate_key text default null,
  p_product_case_id text default null,
  p_product_case_version_id text default null
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_account_key text := trim(coalesce(p_account_key, ''));
  v_evidence public.seller_os_prelinked_launch_evidence_packages%rowtype;
  v_candidate_id text;
  v_launch_id text;
  v_existing public.seller_os_prelinked_launch_candidates%rowtype;
  v_current_evidence
    public.seller_os_prelinked_launch_evidence_packages%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
    or v_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_marketplace_id <> 'EBAY_US'
    or coalesce(p_evidence_package_id, '') !~
      '^launch-evidence-v1:sha256:[0-9a-f]{64}$'
    or p_p2_i01_gate_status not in (
      'PREPUBLICATION_PRELINKED_ONLY','PASS','BLOCKED','UNPROVEN'
    )
    or p_p2_i02_gate_status not in (
      'PREPUBLICATION_PRELINKED_ONLY','PASS','BLOCKED','UNPROVEN'
    )
    or (p_opportunity_candidate_key is not null and (
      length(p_opportunity_candidate_key) not between 1 and 240
      or p_opportunity_candidate_key ~ '[[:cntrl:]]'
    ))
    or ((p_product_case_id is null) <> (p_product_case_version_id is null))
    or (p_product_case_id is not null and (
      length(p_product_case_id) not between 1 and 240
      or p_product_case_id ~ '[[:cntrl:]]'
      or length(p_product_case_version_id) not between 1 and 240
      or p_product_case_version_id ~ '[[:cntrl:]]'
    )) then
    raise exception 'SELLER_OS_PRELINKED_LAUNCH_CANDIDATE_INPUT_INVALID';
  end if;

  select * into v_evidence
  from public.seller_os_prelinked_launch_evidence_packages
  where evidence_package_id = p_evidence_package_id
    and account_key = v_account_key
    and marketplace_id = p_marketplace_id;
  if not found
    or v_evidence.evidence_evaluated_at > now() + interval '5 minutes'
    or v_evidence.evidence_evaluated_at + make_interval(
      secs => v_evidence.evidence_maximum_age_seconds
    ) < now() then
    raise exception 'SELLER_OS_PRELINKED_LAUNCH_CURRENT_EVIDENCE_REQUIRED';
  end if;

  v_candidate_id := 'prelinked-candidate-v1:sha256:' || encode(
    extensions.digest(convert_to(concat(
      'SELLER_OS_PRELINKED_LAUNCH_CANDIDATE_V1', E'\n',
      v_evidence.configuration_id
    ), 'UTF8'), 'sha256'), 'hex'
  );
  v_launch_id := 'prelinked-launch-v1:sha256:' || encode(
    extensions.digest(convert_to(concat(
      'SELLER_OS_PRELINKED_LAUNCH_V1', E'\n',
      v_evidence.configuration_id
    ), 'UTF8'), 'sha256'), 'hex'
  );

  perform pg_advisory_xact_lock(hashtextextended(
    v_evidence.configuration_identity_digest, 0
  ));
  select * into v_existing
  from public.seller_os_prelinked_launch_candidates
  where configuration_identity_digest =
    v_evidence.configuration_identity_digest
  for update;
  if found then
    if v_existing.launch_candidate_id is distinct from v_candidate_id
      or v_existing.launch_id is distinct from v_launch_id
      or v_existing.configuration_id is distinct from
        v_evidence.configuration_id
      or v_existing.account_key is distinct from v_account_key
      or v_existing.marketplace_id is distinct from p_marketplace_id
      or (
        v_existing.opportunity_candidate_key is not null
        and p_opportunity_candidate_key is not null
        and v_existing.opportunity_candidate_key is distinct from
          p_opportunity_candidate_key
      )
      or (
        v_existing.product_case_id is not null
        and p_product_case_id is not null
        and (
          v_existing.product_case_id is distinct from p_product_case_id
          or v_existing.product_case_version_id is distinct from
            p_product_case_version_id
        )
      ) then
      raise exception 'SELLER_OS_PRELINKED_LAUNCH_CANDIDATE_REPLAY_CONFLICT';
    end if;

    if v_existing.current_evidence_package_id = p_evidence_package_id then
      if v_existing.p2_i01_gate_status is distinct from p_p2_i01_gate_status
        or v_existing.p2_i02_gate_status is distinct from p_p2_i02_gate_status
        or (
          v_existing.opportunity_candidate_key is null
          and p_opportunity_candidate_key is not null
        )
        or (
          v_existing.product_case_id is null
          and p_product_case_id is not null
        ) then
        raise exception 'SELLER_OS_PRELINKED_LAUNCH_CANDIDATE_REPLAY_CONFLICT';
      end if;
      return jsonb_build_object(
        'outcome', 'IDEMPOTENT_SUCCESS',
        'launchCandidateId', v_existing.launch_candidate_id,
        'launchId', v_existing.launch_id,
        'evidencePackageId', v_existing.current_evidence_package_id,
        'canonicalSku', v_existing.canonical_sku,
        'launchState', v_existing.launch_state
      );
    end if;

    select * into v_current_evidence
    from public.seller_os_prelinked_launch_evidence_packages
    where evidence_package_id = v_existing.current_evidence_package_id;
    if not found
      or v_evidence.evidence_evaluated_at <=
        v_current_evidence.evidence_evaluated_at then
      raise exception 'SELLER_OS_PRELINKED_LAUNCH_STALE_EVIDENCE_REJECTED';
    end if;

    update public.seller_os_prelinked_launch_candidates
    set components = v_evidence.components,
        offer_semantics = v_evidence.offer_semantics,
        current_evidence_package_id = v_evidence.evidence_package_id,
        current_evidence_digest = v_evidence.evidence_digest,
        supply_gate_status = v_evidence.gate_statuses ->> 'SUPPLY',
        market_gate_status = v_evidence.gate_statuses ->> 'MARKET',
        economics_gate_status = v_evidence.gate_statuses ->> 'ECONOMICS',
        listing_gate_status = v_evidence.gate_statuses ->> 'LISTING',
        p2_i01_gate_status = p_p2_i01_gate_status,
        p2_i02_gate_status = p_p2_i02_gate_status,
        ranking_score = v_evidence.ranking_score,
        score_version = v_evidence.score_version,
        hard_blockers = v_evidence.hard_blockers,
        opportunity_candidate_key = coalesce(
          v_existing.opportunity_candidate_key,
          p_opportunity_candidate_key
        ),
        product_case_id = coalesce(
          v_existing.product_case_id, p_product_case_id
        ),
        product_case_version_id = coalesce(
          v_existing.product_case_version_id, p_product_case_version_id
        ),
        launch_state = 'NEEDS_DATA',
        human_approval_required = true,
        publish_allowed = false,
        p2_gate_bypass_allowed = false,
        updated_at = now()
    where launch_candidate_id = v_existing.launch_candidate_id
    returning * into v_existing;

    return jsonb_build_object(
      'outcome', 'CURRENT_EVIDENCE_UPDATED',
      'launchCandidateId', v_existing.launch_candidate_id,
      'launchId', v_existing.launch_id,
      'evidencePackageId', v_existing.current_evidence_package_id,
      'canonicalSku', v_existing.canonical_sku,
      'launchState', v_existing.launch_state
    );
  end if;

  insert into public.seller_os_prelinked_launch_candidates (
    launch_candidate_id, configuration_id, launch_id, account_key,
    marketplace_id, configuration_identity_digest, components,
    offer_semantics, current_evidence_package_id, current_evidence_digest,
    supply_gate_status, market_gate_status, economics_gate_status,
    listing_gate_status, p2_i01_gate_status, p2_i02_gate_status,
    ranking_score, score_version, hard_blockers,
    opportunity_candidate_key, product_case_id, product_case_version_id,
    launch_state, human_approval_required, publish_allowed,
    p2_gate_bypass_allowed
  ) values (
    v_candidate_id, v_evidence.configuration_id, v_launch_id,
    v_account_key, p_marketplace_id,
    v_evidence.configuration_identity_digest, v_evidence.components,
    v_evidence.offer_semantics, v_evidence.evidence_package_id,
    v_evidence.evidence_digest,
    v_evidence.gate_statuses ->> 'SUPPLY',
    v_evidence.gate_statuses ->> 'MARKET',
    v_evidence.gate_statuses ->> 'ECONOMICS',
    v_evidence.gate_statuses ->> 'LISTING',
    p_p2_i01_gate_status, p_p2_i02_gate_status,
    v_evidence.ranking_score, v_evidence.score_version,
    v_evidence.hard_blockers, p_opportunity_candidate_key,
    p_product_case_id, p_product_case_version_id,
    'NEEDS_DATA', true, false, false
  ) returning * into v_existing;

  return jsonb_build_object(
    'outcome', 'CREATED',
    'launchCandidateId', v_existing.launch_candidate_id,
    'launchId', v_existing.launch_id,
    'evidencePackageId', v_existing.current_evidence_package_id,
    'canonicalSku', v_existing.canonical_sku,
    'launchState', v_existing.launch_state
  );
end;
$function$;

create or replace function public.reserve_seller_os_prelinked_launch_sku_v1(
  p_launch_candidate_id text,
  p_reservation_idempotency_key text
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_candidate public.seller_os_prelinked_launch_candidates%rowtype;
  v_reserved_listing_package_id uuid;
  v_uuid_hex text;
  v_canonical_sku text;
  v_sku_reservation_id text;
  v_collision boolean := true;
  v_attempt integer;
begin
  if not public.is_seller_os_service_role_request_v1()
    or coalesce(p_launch_candidate_id, '') !~
      '^prelinked-candidate-v1:sha256:[0-9a-f]{64}$'
    or coalesce(p_reservation_idempotency_key, '') !~
      '^prelinked-launch-reservation-v1:sha256:[0-9a-f]{64}$' then
    raise exception 'SELLER_OS_PRELINKED_LAUNCH_RESERVATION_INPUT_INVALID';
  end if;

  select * into v_candidate
  from public.seller_os_prelinked_launch_candidates
  where launch_candidate_id = p_launch_candidate_id
  for update;
  if not found then
    raise exception 'SELLER_OS_PRELINKED_LAUNCH_CANDIDATE_NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    v_candidate.account_key || ':' || v_candidate.marketplace_id || ':'
      || v_candidate.launch_candidate_id, 0
  ));

  if v_candidate.canonical_sku is not null then
    if v_candidate.sku_reservation_idempotency_key is distinct from
      p_reservation_idempotency_key then
      raise exception 'SELLER_OS_PRELINKED_LAUNCH_RESERVATION_REPLAY_CONFLICT';
    end if;
    return jsonb_build_object(
      'outcome', 'IDEMPOTENT_SUCCESS',
      'launchCandidateId', v_candidate.launch_candidate_id,
      'reservedListingPackageId', v_candidate.reserved_listing_package_id,
      'canonicalSku', v_candidate.canonical_sku
    );
  end if;

  for v_attempt in 0..7 loop
    v_uuid_hex := substr(encode(extensions.digest(convert_to(
      concat(
        'SELLER_OS_PRELINKED_LISTING_PACKAGE_V1', E'\n',
        v_candidate.launch_candidate_id, E'\n', v_attempt::text
      ),
      'UTF8'
    ), 'sha256'), 'hex'), 1, 32);
    v_reserved_listing_package_id := (
      substr(v_uuid_hex, 1, 8) || '-' ||
      substr(v_uuid_hex, 9, 4) || '-' ||
      substr(v_uuid_hex, 13, 4) || '-' ||
      substr(v_uuid_hex, 17, 4) || '-' ||
      substr(v_uuid_hex, 21, 12)
    )::uuid;
    -- Exact compatibility with canonicalEbayPackageSku(packageId): IMNOVA
    -- plus all 32 compact uppercase UUID characters, without a hyphen.
    v_canonical_sku := 'IMNOVA' || upper(replace(
      v_reserved_listing_package_id::text, '-', ''
    ));
    v_sku_reservation_id :=
      'prelinked-launch-sku-reservation-v1:' || v_canonical_sku;

    perform pg_advisory_xact_lock(hashtextextended(
      v_candidate.account_key || ':' || v_candidate.marketplace_id || ':'
        || v_canonical_sku, 0
    ));

    select exists (
      select 1 from public.ebay_active_listings listing
      where listing.account_key = v_candidate.account_key
        and upper(trim(coalesce(listing.ebay_sku, ''))) = v_canonical_sku
    ) or exists (
      select 1 from public.ebay_listing_packages package_row
      where package_row.id = v_reserved_listing_package_id
        or (
          (package_row.account_key = v_candidate.account_key
            or package_row.account_key is null)
          and (
            upper(trim(coalesce(
              package_row.package_data #>> '{draftConfiguration,sku}',
              package_row.package_data ->> 'sku', ''
            ))) = v_canonical_sku
            or 'IMNOVA' || upper(replace(package_row.id::text, '-', ''))
              = v_canonical_sku
          )
        )
    ) or exists (
      select 1 from public.ebay_draft_only_execution_ledger execution
      where upper(trim(execution.sku)) = v_canonical_sku
    ) or exists (
      select 1 from public.ebay_authorized_listing_publications publication
      where upper(trim(publication.sku)) = v_canonical_sku
    ) or exists (
      select 1
      from public.ebay_same_day_pilot_candidates pilot_candidate
      join public.ebay_same_day_pilot_runs pilot_run
        on pilot_run.id = pilot_candidate.run_id
      where pilot_run.marketplace_account_key = v_candidate.account_key
        and (
          upper(trim(coalesce(
            to_jsonb(pilot_candidate) ->> 'reserved_sku', ''
          ))) = v_canonical_sku
          or upper(trim(coalesce(
            pilot_candidate.manual_handoff_package
              #>> '{package,customLabel}', ''
          ))) = v_canonical_sku
        )
    ) or exists (
      select 1
      from public.ebay_same_day_pilot_handoffs handoff
      join public.ebay_same_day_pilot_runs pilot_run
        on pilot_run.id = handoff.run_id
      where pilot_run.marketplace_account_key = v_candidate.account_key
        and upper(trim(coalesce(
          handoff.package_data ->> 'customLabel', ''
        ))) = v_canonical_sku
    ) or exists (
      select 1
      from public.ebay_manual_listing_links manual_link
      where manual_link.account_key = v_candidate.account_key
        and manual_link.marketplace_id = v_candidate.marketplace_id
        and upper(trim(coalesce(
          manual_link.connector_ebay_sku, ''
        ))) = v_canonical_sku
    ) or exists (
      select 1 from public.seller_os_prelinked_launch_candidates candidate
      where candidate.launch_candidate_id <> v_candidate.launch_candidate_id
        and candidate.account_key = v_candidate.account_key
        and candidate.marketplace_id = v_candidate.marketplace_id
        and candidate.canonical_sku = v_canonical_sku
    ) into v_collision;

    exit when not v_collision;
  end loop;

  if v_collision then
    raise exception 'SELLER_OS_PRELINKED_LAUNCH_SKU_RESERVATION_EXHAUSTED';
  end if;

  update public.seller_os_prelinked_launch_candidates
  set canonical_sku = v_canonical_sku,
      reserved_listing_package_id = v_reserved_listing_package_id,
      sku_reservation_id = v_sku_reservation_id,
      sku_reservation_idempotency_key = p_reservation_idempotency_key,
      sku_reserved_at = now(),
      updated_at = now()
  where launch_candidate_id = v_candidate.launch_candidate_id
    and canonical_sku is null
  returning * into v_candidate;
  if not found then
    raise exception 'SELLER_OS_PRELINKED_LAUNCH_RESERVATION_CONCURRENT_CHANGE';
  end if;

  return jsonb_build_object(
    'outcome', 'CREATED',
    'launchCandidateId', v_candidate.launch_candidate_id,
    'reservedListingPackageId', v_candidate.reserved_listing_package_id,
    'canonicalSku', v_candidate.canonical_sku
  );
end;
$function$;

create or replace function public.append_seller_os_prelinked_launch_lineage_v1(
  p_launch_candidate_id text,
  p_source_type text,
  p_source_identity text,
  p_evidence_digest text,
  p_authority_class text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_candidate public.seller_os_prelinked_launch_candidates%rowtype;
  v_evidence public.seller_os_prelinked_launch_evidence_packages%rowtype;
  v_lineage_reference_id text;
  v_existing public.seller_os_prelinked_launch_lineage_references%rowtype;
  v_inserted_count integer := 0;
begin
  if not public.is_seller_os_service_role_request_v1()
    or coalesce(p_launch_candidate_id, '') !~
      '^prelinked-candidate-v1:sha256:[0-9a-f]{64}$'
    or p_source_type not in (
      'SELLER_OS_LUNA_LINKAGE_DECISION',
      'MARKETPLACE_LISTING_APPROVAL_QUEUE_ITEM',
      'EBAY_LUNA_OPPORTUNITY', 'EBAY_PRODUCT_CANDIDATE',
      'EBAY_LISTING_PACKAGE', 'MARKET_RADAR_PRODUCT', 'PRODUCT_CASE'
    )
    or length(trim(coalesce(p_source_identity, ''))) not between 1 and 240
    or p_source_identity ~ '[[:cntrl:]]'
    or coalesce(p_evidence_digest, '') !~ '^sha256:[0-9a-f]{64}$'
    or p_observed_at > now() + interval '5 minutes'
    or not (
      (p_source_type = 'SELLER_OS_LUNA_LINKAGE_DECISION'
        and p_authority_class = 'CANONICAL_SOURCE')
      or (p_source_type in (
        'MARKETPLACE_LISTING_APPROVAL_QUEUE_ITEM',
        'EBAY_LUNA_OPPORTUNITY', 'EBAY_PRODUCT_CANDIDATE',
        'EBAY_LISTING_PACKAGE', 'MARKET_RADAR_PRODUCT'
      ) and p_authority_class = 'DISCOVERY_ONLY')
      or (p_source_type = 'PRODUCT_CASE'
        and p_authority_class = 'PRODUCT_CASE_NON_AUTHORITATIVE')
    ) then
    raise exception 'SELLER_OS_PRELINKED_LAUNCH_LINEAGE_INPUT_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_launch_candidate_id, 0));
  select * into v_candidate
  from public.seller_os_prelinked_launch_candidates
  where launch_candidate_id = p_launch_candidate_id;
  if not found then
    raise exception 'SELLER_OS_PRELINKED_LAUNCH_CANDIDATE_NOT_FOUND';
  end if;

  select * into v_evidence
  from public.seller_os_prelinked_launch_evidence_packages
  where evidence_digest = p_evidence_digest
    and account_key = v_candidate.account_key
    and marketplace_id = v_candidate.marketplace_id
    and configuration_identity_digest =
      v_candidate.configuration_identity_digest;
  if not found then
    raise exception 'SELLER_OS_PRELINKED_LAUNCH_LINEAGE_EVIDENCE_MISMATCH';
  end if;

  v_lineage_reference_id := 'prelinked-launch-lineage-v1:sha256:'
    || encode(extensions.digest(convert_to(jsonb_build_object(
      'launchCandidateId', p_launch_candidate_id,
      'sourceType', p_source_type,
      'sourceIdentity', trim(p_source_identity),
      'evidenceDigest', p_evidence_digest
    )::text, 'UTF8'), 'sha256'), 'hex');

  insert into public.seller_os_prelinked_launch_lineage_references (
    lineage_reference_id, launch_candidate_id, source_type,
    source_identity, evidence_digest, authority_class, observed_at
  ) values (
    v_lineage_reference_id, p_launch_candidate_id, p_source_type,
    trim(p_source_identity), p_evidence_digest, p_authority_class,
    p_observed_at
  ) on conflict (
    launch_candidate_id, source_type, source_identity, evidence_digest
  ) do nothing;
  get diagnostics v_inserted_count = row_count;

  select * into v_existing
  from public.seller_os_prelinked_launch_lineage_references
  where launch_candidate_id = p_launch_candidate_id
    and source_type = p_source_type
    and source_identity = trim(p_source_identity)
    and evidence_digest = p_evidence_digest;
  if v_existing.lineage_reference_id is distinct from v_lineage_reference_id
    or v_existing.authority_class is distinct from p_authority_class
    or v_existing.observed_at is distinct from p_observed_at then
    raise exception 'SELLER_OS_PRELINKED_LAUNCH_LINEAGE_REPLAY_CONFLICT';
  end if;

  return jsonb_build_object(
    'outcome', case when v_inserted_count = 1
      then 'CREATED' else 'IDEMPOTENT_SUCCESS' end,
    'lineageReferenceId', v_existing.lineage_reference_id,
    'launchCandidateId', v_existing.launch_candidate_id,
    'authorityClass', v_existing.authority_class
  );
end;
$function$;

revoke all on function
  public.is_valid_seller_os_prelinked_launch_components_v1(jsonb)
  from public, anon, authenticated;
revoke all on function
  public.is_valid_seller_os_prelinked_launch_configuration_v1(jsonb,jsonb)
  from public, anon, authenticated;
revoke all on function
  public.is_valid_seller_os_launch_gate_statuses_v1(jsonb)
  from public, anon, authenticated;
revoke all on function
  public.is_valid_seller_os_prelinked_launch_text_array_v1(text[],integer,integer)
  from public, anon, authenticated;
revoke all on function
  public.is_valid_seller_os_launch_evidence_items_v1(
    jsonb,text,text,text,jsonb,text[],jsonb,timestamptz
  ) from public, anon, authenticated, service_role;
revoke all on function
  public.reject_seller_os_prelinked_launch_append_mutation_v1()
  from public, anon, authenticated, service_role;
revoke all on function
  public.put_seller_os_prelinked_launch_evidence_package_v1(
    text,text,text,jsonb,jsonb,text[],jsonb,jsonb,numeric,text,text[],
    timestamptz,integer,text[]
  ) from public, anon, authenticated, service_role;
revoke all on function
  public.put_seller_os_prelinked_launch_candidate_v1(
    text,text,text,text,text,text,text,text
  ) from public, anon, authenticated, service_role;
revoke all on function
  public.reserve_seller_os_prelinked_launch_sku_v1(text,text)
  from public, anon, authenticated, service_role;
revoke all on function
  public.append_seller_os_prelinked_launch_lineage_v1(
    text,text,text,text,text,timestamptz
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.put_seller_os_prelinked_launch_evidence_package_v1(
    text,text,text,jsonb,jsonb,text[],jsonb,jsonb,numeric,text,text[],
    timestamptz,integer,text[]
  ) to service_role;
grant execute on function
  public.put_seller_os_prelinked_launch_candidate_v1(
    text,text,text,text,text,text,text,text
  ) to service_role;
grant execute on function
  public.reserve_seller_os_prelinked_launch_sku_v1(text,text)
  to service_role;
grant execute on function
  public.append_seller_os_prelinked_launch_lineage_v1(
    text,text,text,text,text,timestamptz
  ) to service_role;

notify pgrst, 'reload schema';
