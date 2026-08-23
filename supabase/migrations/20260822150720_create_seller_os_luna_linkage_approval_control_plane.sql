-- P2-I01B targeted artifact only. This creates no decision, Luna stock read,
-- scheduler, polling, or eBay mutation.

create or replace function public.is_valid_seller_os_luna_linkage_components_v1(
  p_components jsonb
)
returns boolean
language sql immutable strict security invoker
set search_path = pg_catalog, pg_temp
as $function$
  select coalesce(jsonb_typeof(p_components) = 'array'
    and jsonb_array_length(p_components) <= 24
    and not exists (
      select 1
      from jsonb_array_elements(p_components) component(value)
      where jsonb_typeof(component.value) <> 'object'
        or not (component.value ?& array[
          'lunaProductId', 'lunaVariantId', 'lunaSku', 'productTitle',
          'variantTitle', 'supplierQuantityRequired', 'quantityBasis',
          'variantPresence', 'exactProductIdentity', 'exactVariantIdentity',
          'exactSupplierSku', 'structuredVariantAttributesComplete',
          'identityConflict'
        ])
        or (component.value - array[
          'lunaProductId', 'lunaVariantId', 'lunaSku', 'productTitle',
          'variantTitle', 'supplierQuantityRequired', 'quantityBasis',
          'variantPresence', 'exactProductIdentity', 'exactVariantIdentity',
          'exactSupplierSku', 'structuredVariantAttributesComplete',
          'identityConflict'
        ]::text[]) <> '{}'::jsonb
        or jsonb_typeof(component.value -> 'lunaProductId') <> 'string'
        or length(component.value ->> 'lunaProductId') not between 1 and 30
        or (component.value ->> 'lunaProductId') !~ '^[0-9]+$'
        or jsonb_typeof(component.value -> 'lunaVariantId') <> 'string'
        or length(component.value ->> 'lunaVariantId') not between 1 and 30
        or (component.value ->> 'lunaVariantId') !~ '^[0-9]+$'
        or jsonb_typeof(component.value -> 'lunaSku') <> 'string'
        or length(component.value ->> 'lunaSku') not between 1 and 120
        or (component.value ->> 'lunaSku') ~ '[[:cntrl:]]'
        or (component.value -> 'productTitle' <> 'null'::jsonb and (
          jsonb_typeof(component.value -> 'productTitle') <> 'string'
          or length(component.value ->> 'productTitle') not between 1 and 240
          or (component.value ->> 'productTitle') ~ '[[:cntrl:]]'
        ))
        or (component.value -> 'variantTitle' <> 'null'::jsonb and (
          jsonb_typeof(component.value -> 'variantTitle') <> 'string'
          or length(component.value ->> 'variantTitle') not between 1 and 160
          or (component.value ->> 'variantTitle') ~ '[[:cntrl:]]'
        ))
        or jsonb_typeof(component.value -> 'supplierQuantityRequired')
          <> 'number'
        or (component.value ->> 'supplierQuantityRequired')
          !~ '^([1-9][0-9]{0,3}|10000)$'
        or component.value ->> 'quantityBasis' not in (
          'STRUCTURED_EVIDENCE', 'HUMAN_CONFIRMATION_REQUIRED',
          'TITLE_ONLY', 'UNPROVEN'
        )
        or component.value ->> 'variantPresence' not in (
          'PRESENT', 'MISSING', 'UNPROVEN'
        )
        or component.value -> 'exactProductIdentity'
          not in ('true'::jsonb, 'false'::jsonb)
        or component.value -> 'exactVariantIdentity'
          not in ('true'::jsonb, 'false'::jsonb)
        or component.value -> 'exactSupplierSku'
          not in ('true'::jsonb, 'false'::jsonb)
        or component.value -> 'structuredVariantAttributesComplete'
          not in ('true'::jsonb, 'false'::jsonb)
        or component.value -> 'identityConflict'
          not in ('true'::jsonb, 'false'::jsonb)
    ), false);
$function$;

create or replace function public.is_valid_seller_os_luna_identity_evidence_provenance_v1(
  p_provenance jsonb
)
returns boolean
language sql immutable strict security invoker
set search_path = pg_catalog, pg_temp
as $function$
  select coalesce(
    jsonb_typeof(p_provenance) = 'object'
    and p_provenance ?& array[
      'contractVersion', 'sourceStatus', 'acquisitionMethod'
    ]
    and (p_provenance - array[
      'contractVersion', 'sourceStatus', 'acquisitionMethod'
    ]::text[]) = '{}'::jsonb
    and p_provenance ->> 'contractVersion' =
      'SELLER_OS_LUNA_IDENTITY_VERIFICATION_V1'
    and (
      (p_provenance ->> 'sourceStatus' = 'AVAILABLE'
        and p_provenance ->> 'acquisitionMethod' =
          'CANONICAL_SERVER_READ_IDENTITY_ONLY')
      or (p_provenance ->> 'sourceStatus' = 'UNAVAILABLE'
        and p_provenance ->> 'acquisitionMethod' = 'NONE')
    ), false
  );
$function$;

create or replace function public.has_seller_os_luna_identity_evidence_reference_v1(
  p_evidence_references text[]
)
returns boolean
language sql immutable strict security invoker
set search_path = pg_catalog, pg_temp
as $function$
  select exists (
    select 1
    from unnest(p_evidence_references) evidence_reference(value)
    where evidence_reference.value ~
      '^luna-identity-v1:sha256:[0-9a-f]{64}$'
  );
$function$;

create or replace function public.are_seller_os_luna_linkage_components_approvable_v1(
  p_components jsonb
)
returns boolean
language sql immutable strict security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
  select public.is_valid_seller_os_luna_linkage_components_v1(p_components)
    and jsonb_array_length(p_components) > 0
    and not exists (
      select 1
      from jsonb_array_elements(p_components) component(value)
      where component.value ->> 'variantPresence' <> 'PRESENT'
        or component.value -> 'exactProductIdentity' <> 'true'::jsonb
        or component.value -> 'exactVariantIdentity' <> 'true'::jsonb
        or component.value -> 'exactSupplierSku' <> 'true'::jsonb
        or component.value -> 'structuredVariantAttributesComplete'
          <> 'true'::jsonb
        or component.value -> 'identityConflict' <> 'false'::jsonb
        or component.value ->> 'quantityBasis' in ('TITLE_ONLY', 'UNPROVEN')
    )
    and (select count(*) = count(distinct jsonb_build_array(
      component.value ->> 'lunaProductId',
      component.value ->> 'lunaVariantId',
      component.value ->> 'lunaSku',
      component.value ->> 'supplierQuantityRequired'
    )) from jsonb_array_elements(p_components) component(value));
$function$;

create or replace function public.is_seller_os_service_role_request_v1()
returns boolean
language plpgsql stable security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_claims text;
begin
  if session_user = 'service_role' or current_user = 'service_role'
    or nullif(current_setting('request.jwt.claim.role', true), '') =
      'service_role' then
    return true;
  end if;
  v_claims := nullif(current_setting('request.jwt.claims', true), '');
  begin
    return coalesce(v_claims::jsonb ->> 'role' = 'service_role', false);
  exception when others then
    return false;
  end;
end;
$function$;

create table public.seller_os_luna_linkage_review_candidates (
  review_candidate_id text primary key,
  review_set_id text not null,
  current_cohort_id text not null,
  account_key text not null,
  account_binding text not null default 'CANONICAL_SELLER_ACCOUNT',
  marketplace_id text not null default 'EBAY_US',
  ebay_item_id text not null,
  ebay_sku text null,
  listing_title text null,
  classification text not null,
  linkage_mode text not null,
  linkage_id text null,
  luna_product_id text null,
  luna_variant_id text null,
  luna_sku text null,
  components jsonb not null,
  supplier_quantity_required integer null,
  match_signals text[] not null default '{}'::text[],
  conflict_signals text[] not null default '{}'::text[],
  evidence_references text[] not null default '{}'::text[],
  evidence_digest text not null,
  evidence_observed_at timestamptz not null,
  review_observed_at timestamptz not null,
  evidence_maximum_age_seconds integer not null,
  identity_evidence_provenance jsonb not null,
  evidence_freshness text not null,
  decision_version integer not null,
  approval_eligible boolean not null,
  is_current boolean not null default true,
  retired_at timestamptz null,
  contract_version text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint seller_os_luna_linkage_review_candidate_id_check check (
    review_candidate_id ~
      '^luna-linkage-review-candidate-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_luna_linkage_review_set_id_check check (
    review_set_id ~ '^luna-linkage-review-set-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_luna_linkage_review_cohort_check check (
    length(current_cohort_id) between 8 and 240
    and current_cohort_id ~ '^[A-Za-z0-9_.:-]+$'
  ),
  constraint seller_os_luna_linkage_review_account_check check (
    length(account_key) between 1 and 200
    and account_key !~ '[[:cntrl:]]'
    and account_binding = 'CANONICAL_SELLER_ACCOUNT'
  ),
  constraint seller_os_luna_linkage_review_marketplace_check check (
    marketplace_id = 'EBAY_US'
  ),
  constraint seller_os_luna_linkage_review_listing_check check (
    ebay_item_id ~ '^[0-9]{9,19}$'
    and (ebay_sku is null or (
      length(ebay_sku) between 1 and 160 and ebay_sku !~ '[[:cntrl:]]'
    ))
    and (listing_title is null or (
      length(listing_title) between 1 and 350
      and listing_title !~ '[[:cntrl:]]'
    ))
  ),
  constraint seller_os_luna_linkage_review_classification_check check (
    classification in (
      'EXACT_UNIQUE_MATCH', 'AMBIGUOUS_MATCH', 'CONFLICTING_MATCH',
      'NO_MATCH', 'BUNDLE_INCOMPLETE', 'IDENTITY_EVIDENCE_INCOMPLETE'
    )
  ),
  constraint seller_os_luna_linkage_review_mode_check check (
    linkage_mode in (
      'SINGLE_COMPONENT', 'SIMPLE_MULTIPLIER', 'MULTI_COMPONENT_BOM',
      'UNRESOLVED'
    )
  ),
  constraint seller_os_luna_linkage_review_linkage_id_check check (
    linkage_id is null
    or linkage_id ~ '^luna-linkage-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_luna_linkage_review_components_check check (
    public.is_valid_seller_os_luna_linkage_components_v1(components)
  ),
  constraint seller_os_luna_linkage_review_shape_check check (
    not approval_eligible
    or (linkage_mode = 'SINGLE_COMPONENT'
      and jsonb_array_length(components) = 1
      and (components -> 0 ->> 'supplierQuantityRequired')::integer = 1)
    or (linkage_mode = 'SIMPLE_MULTIPLIER'
      and jsonb_array_length(components) = 1
      and (components -> 0 ->> 'supplierQuantityRequired')::integer > 1)
    or (linkage_mode = 'MULTI_COMPONENT_BOM'
      and jsonb_array_length(components) >= 2)
  ),
  constraint seller_os_luna_linkage_review_unresolved_shape_check check (
    (linkage_mode = 'UNRESOLVED'
      and jsonb_array_length(components) = 0
      and linkage_id is null
      and not approval_eligible)
    or (linkage_mode <> 'UNRESOLVED'
      and jsonb_array_length(components) > 0)
  ),
  constraint seller_os_luna_linkage_review_scalar_check check (
    (jsonb_array_length(components) = 1
      and luna_product_id = components -> 0 ->> 'lunaProductId'
      and luna_variant_id = components -> 0 ->> 'lunaVariantId'
      and luna_product_id ~ '^[0-9]{1,30}$'
      and luna_variant_id ~ '^[0-9]{1,30}$'
      and luna_sku = components -> 0 ->> 'lunaSku'
      and supplier_quantity_required =
        (components -> 0 ->> 'supplierQuantityRequired')::integer)
    or (jsonb_array_length(components) <> 1
      and luna_product_id is null and luna_variant_id is null
      and luna_sku is null and supplier_quantity_required is null)
  ),
  constraint seller_os_luna_linkage_review_evidence_check check (
    evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    and evidence_maximum_age_seconds = 21600
    and evidence_freshness in ('CURRENT', 'STALE')
    and public.is_valid_seller_os_luna_identity_evidence_provenance_v1(
      identity_evidence_provenance
    )
    and cardinality(match_signals) <= 32
    and cardinality(conflict_signals) <= 32
    and cardinality(evidence_references) <= 64
    and array_position(match_signals, null) is null
    and array_position(conflict_signals, null) is null
    and array_position(evidence_references, null) is null
  ),
  constraint seller_os_luna_linkage_review_version_check check (
    decision_version between 1 and 1000000
  ),
  constraint seller_os_luna_linkage_review_approval_check check (
    not approval_eligible or (
      classification = 'EXACT_UNIQUE_MATCH'
      and linkage_id is not null
      and evidence_freshness = 'CURRENT'
      and identity_evidence_provenance ->> 'sourceStatus' = 'AVAILABLE'
      and identity_evidence_provenance ->> 'acquisitionMethod' =
        'CANONICAL_SERVER_READ_IDENTITY_ONLY'
      and cardinality(evidence_references) > 0
      and public.has_seller_os_luna_identity_evidence_reference_v1(
        evidence_references
      )
      and cardinality(conflict_signals) = 0
      and public.are_seller_os_luna_linkage_components_approvable_v1(
        components
      )
    )
  ),
  constraint seller_os_luna_linkage_review_lifecycle_check check (
    (is_current and retired_at is null)
    or (not is_current and retired_at is not null)
  ),
  constraint seller_os_luna_linkage_review_contract_check check (
    contract_version = 'SELLER_OS_LUNA_LINKAGE_REVIEW_V2'
  ),
  constraint seller_os_luna_linkage_review_set_item_unique unique (
    review_set_id, ebay_item_id
  )
);

create index seller_os_luna_linkage_review_current_idx
  on public.seller_os_luna_linkage_review_candidates (
    account_key, marketplace_id, current_cohort_id, ebay_item_id
  ) where is_current;

create table public.seller_os_luna_linkage_decisions (
  decision_id text primary key,
  review_candidate_id text not null references
    public.seller_os_luna_linkage_review_candidates(review_candidate_id),
  review_set_id text not null,
  current_cohort_id text not null,
  account_key text not null,
  account_binding text not null,
  marketplace_id text not null,
  ebay_item_id text not null,
  ebay_sku text null,
  listing_title text null,
  classification text not null,
  linkage_mode text not null,
  linkage_id text null,
  luna_product_id text null,
  luna_variant_id text null,
  luna_sku text null,
  components jsonb not null,
  supplier_quantity_required integer null,
  evidence_references text[] not null,
  evidence_digest text not null,
  evidence_observed_at timestamptz not null,
  review_observed_at timestamptz not null,
  evidence_maximum_age_seconds integer not null,
  identity_evidence_provenance jsonb not null,
  evidence_freshness text not null,
  provenance jsonb not null,
  decision text not null,
  decision_version integer not null,
  decision_at timestamptz not null,
  decision_reference text not null,
  actor_user_id uuid not null references auth.users(id),
  contract_version text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint seller_os_luna_linkage_decision_id_check check (
    decision_id ~ '^luna-linkage-decision-v1:sha256:[0-9a-f]{64}$'
    and decision_reference = decision_id
  ),
  constraint seller_os_luna_linkage_decision_choice_check check (
    decision in (
      'APPROVE_EXACT_LINKAGE', 'REJECT_CANDIDATE', 'KEEP_UNPROVEN'
    )
  ),
  constraint seller_os_luna_linkage_decision_account_binding_check check (
    account_binding = 'CANONICAL_SELLER_ACCOUNT'
  ),
  constraint seller_os_luna_linkage_decision_version_check check (
    decision_version between 1 and 1000000
  ),
  constraint seller_os_luna_linkage_decision_components_check check (
    public.is_valid_seller_os_luna_linkage_components_v1(components)
  ),
  constraint seller_os_luna_linkage_decision_scalar_check check (
    (jsonb_array_length(components) = 1
      and luna_product_id = components -> 0 ->> 'lunaProductId'
      and luna_variant_id = components -> 0 ->> 'lunaVariantId'
      and luna_product_id ~ '^[0-9]{1,30}$'
      and luna_variant_id ~ '^[0-9]{1,30}$'
      and luna_sku = components -> 0 ->> 'lunaSku'
      and supplier_quantity_required =
        (components -> 0 ->> 'supplierQuantityRequired')::integer)
    or (jsonb_array_length(components) <> 1
      and luna_product_id is null and luna_variant_id is null
      and luna_sku is null and supplier_quantity_required is null)
  ),
  constraint seller_os_luna_linkage_decision_evidence_check check (
    evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    and evidence_maximum_age_seconds = 21600
    and evidence_freshness in ('CURRENT', 'STALE')
    and cardinality(evidence_references) <= 64
    and array_position(evidence_references, null) is null
    and public.is_valid_seller_os_luna_identity_evidence_provenance_v1(
      identity_evidence_provenance
    )
  ),
  constraint seller_os_luna_linkage_decision_approval_check check (
    decision <> 'APPROVE_EXACT_LINKAGE' or (
      classification = 'EXACT_UNIQUE_MATCH'
      and linkage_id is not null
      and evidence_freshness = 'CURRENT'
      and identity_evidence_provenance ->> 'sourceStatus' = 'AVAILABLE'
      and identity_evidence_provenance ->> 'acquisitionMethod' =
        'CANONICAL_SERVER_READ_IDENTITY_ONLY'
      and cardinality(evidence_references) > 0
      and public.has_seller_os_luna_identity_evidence_reference_v1(
        evidence_references
      )
      and public.are_seller_os_luna_linkage_components_approvable_v1(
        components
      )
      and (
        (linkage_mode = 'SINGLE_COMPONENT'
          and jsonb_array_length(components) = 1
          and (components -> 0 ->> 'supplierQuantityRequired')::integer = 1)
        or (linkage_mode = 'SIMPLE_MULTIPLIER'
          and jsonb_array_length(components) = 1
          and (components -> 0 ->> 'supplierQuantityRequired')::integer > 1)
        or (linkage_mode = 'MULTI_COMPONENT_BOM'
          and jsonb_array_length(components) >= 2)
      )
    )
  ),
  constraint seller_os_luna_linkage_decision_provenance_check check (
    provenance = jsonb_build_object(
      'authorityClass', 'HUMAN_DECISION',
      'identityEvidenceClass', 'SUPPLIER_CURRENT_IDENTITY',
      'stockEvidenceUsed', false,
      'identityEvidenceProvenance', identity_evidence_provenance
    )
  ),
  constraint seller_os_luna_linkage_decision_contract_check check (
    contract_version = 'SELLER_OS_LUNA_LINKAGE_DECISION_V1'
  ),
  constraint seller_os_luna_linkage_decision_item_version_unique unique (
    account_key, marketplace_id, ebay_item_id, decision_version
  ),
  constraint seller_os_luna_linkage_decision_reference_unique unique (
    decision_reference
  )
);

create index seller_os_luna_linkage_decision_latest_idx
  on public.seller_os_luna_linkage_decisions (
    account_key, marketplace_id, ebay_item_id, decision_version desc
  );

create or replace function public.guard_seller_os_luna_linkage_review_candidate_v1()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $function$
begin
  if tg_op = 'UPDATE' and old.is_current and not new.is_current
    and new.retired_at is not null
    and (to_jsonb(new) - array['is_current', 'retired_at']::text[])
      = (to_jsonb(old) - array['is_current', 'retired_at']::text[]) then
    return new;
  end if;
  raise exception 'SELLER_OS_LUNA_LINKAGE_REVIEW_CANDIDATE_IMMUTABLE';
end;
$function$;

create trigger seller_os_luna_linkage_review_candidate_guard
before update or delete on public.seller_os_luna_linkage_review_candidates
for each row execute function
  public.guard_seller_os_luna_linkage_review_candidate_v1();

create or replace function public.prevent_seller_os_luna_linkage_decision_mutation_v1()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $function$
begin
  raise exception 'SELLER_OS_LUNA_LINKAGE_DECISION_IMMUTABLE';
end;
$function$;

create trigger seller_os_luna_linkage_decision_immutable
before update or delete on public.seller_os_luna_linkage_decisions
for each row execute function
  public.prevent_seller_os_luna_linkage_decision_mutation_v1();

alter table public.seller_os_luna_linkage_review_candidates
  enable row level security;
alter table public.seller_os_luna_linkage_review_candidates
  force row level security;
alter table public.seller_os_luna_linkage_decisions enable row level security;
alter table public.seller_os_luna_linkage_decisions force row level security;

revoke all on table public.seller_os_luna_linkage_review_candidates
  from public, anon, authenticated, service_role;
revoke all on table public.seller_os_luna_linkage_decisions
  from public, anon, authenticated, service_role;
grant select on table public.seller_os_luna_linkage_review_candidates
  to service_role;
grant select on table public.seller_os_luna_linkage_decisions to service_role;

create policy seller_os_luna_linkage_review_service_role_read
  on public.seller_os_luna_linkage_review_candidates
  for select to service_role using (true);
create policy seller_os_luna_linkage_decision_service_role_read
  on public.seller_os_luna_linkage_decisions
  for select to service_role using (true);

-- FORCE RLS must not depend on the hosted postgres role retaining BYPASSRLS.
-- These policies are reachable only while the fixed SECURITY DEFINER RPCs run
-- as their migration owner, and still require a server-side service-role claim.
create policy seller_os_luna_linkage_review_rpc_owner_insert
  on public.seller_os_luna_linkage_review_candidates
  for insert to postgres
  with check (public.is_seller_os_service_role_request_v1());
create policy seller_os_luna_linkage_review_rpc_owner_read
  on public.seller_os_luna_linkage_review_candidates
  for select to postgres
  using (public.is_seller_os_service_role_request_v1());
create policy seller_os_luna_linkage_review_rpc_owner_retire
  on public.seller_os_luna_linkage_review_candidates
  for update to postgres
  using (public.is_seller_os_service_role_request_v1())
  with check (public.is_seller_os_service_role_request_v1());
create policy seller_os_luna_linkage_decision_rpc_owner_insert
  on public.seller_os_luna_linkage_decisions
  for insert to postgres
  with check (public.is_seller_os_service_role_request_v1());
create policy seller_os_luna_linkage_decision_rpc_owner_read
  on public.seller_os_luna_linkage_decisions
  for select to postgres
  using (public.is_seller_os_service_role_request_v1());

create or replace function public.replace_seller_os_luna_linkage_review_set_v1(
  p_account_key text,
  p_marketplace_id text,
  p_current_cohort_id text,
  p_review_set_id text,
  p_contract_version text,
  p_candidates jsonb
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_candidate jsonb;
  v_existing public.seller_os_luna_linkage_review_candidates%rowtype;
  v_candidate_count integer;
  v_existing_count integer;
  v_eligible boolean;
  v_components jsonb;
begin
  if not public.is_seller_os_service_role_request_v1()
    or length(trim(coalesce(p_account_key, ''))) not between 1 and 200
    or p_marketplace_id <> 'EBAY_US'
    or coalesce(p_current_cohort_id, '') !~ '^[A-Za-z0-9_.:-]{8,240}$'
    or coalesce(p_review_set_id, '') !~
      '^luna-linkage-review-set-v1:sha256:[0-9a-f]{64}$'
    or p_contract_version <> 'SELLER_OS_LUNA_LINKAGE_REVIEW_V2'
    or jsonb_typeof(p_candidates) <> 'array'
    or jsonb_array_length(p_candidates) not between 1 and 50 then
    raise exception 'SELLER_OS_LUNA_LINKAGE_REVIEW_SET_INPUT_INVALID';
  end if;
  v_candidate_count := jsonb_array_length(p_candidates);
  perform pg_advisory_xact_lock(hashtextextended(
    p_account_key || ':' || p_marketplace_id, 0
  ));

  for v_candidate in select value from jsonb_array_elements(p_candidates)
  loop
    v_components := v_candidate -> 'components';
    v_eligible := coalesce(
      (v_candidate -> 'approvalEligibility' ->> 'eligible')::boolean, false
    );
    if jsonb_typeof(v_candidate) <> 'object'
      or not (v_candidate ?& array[
        'contractVersion', 'reviewCandidateId', 'currentCohortId',
        'accountBinding', 'ebayItemId', 'ebaySku', 'listingTitle',
        'classification', 'linkageMode', 'linkageId', 'components',
        'supplierQuantityRequired', 'matchSignals', 'conflictSignals',
        'evidenceReferences', 'evidenceObservedAt', 'reviewObservedAt',
        'evidenceMaximumAgeSeconds', 'identityEvidenceProvenance',
        'evidenceDigest', 'evidenceFreshness', 'decisionVersion',
        'allowedOperatorDecisions',
        'recommendedSafeDecision', 'approvalEligibility',
        'stockCertification'
      ])
      or (v_candidate - array[
        'contractVersion', 'reviewCandidateId', 'currentCohortId',
        'accountBinding', 'ebayItemId', 'ebaySku', 'listingTitle',
        'classification', 'linkageMode', 'linkageId', 'components',
        'supplierQuantityRequired', 'matchSignals', 'conflictSignals',
        'evidenceReferences', 'evidenceObservedAt', 'reviewObservedAt',
        'evidenceMaximumAgeSeconds', 'identityEvidenceProvenance',
        'evidenceDigest', 'evidenceFreshness', 'decisionVersion',
        'allowedOperatorDecisions',
        'recommendedSafeDecision', 'approvalEligibility',
        'stockCertification'
      ]::text[]) <> '{}'::jsonb
      or v_candidate ->> 'contractVersion' <> p_contract_version
      or v_candidate ->> 'currentCohortId' <> p_current_cohort_id
      or v_candidate ->> 'accountBinding' <> 'CANONICAL_SELLER_ACCOUNT'
      or coalesce(v_candidate ->> 'reviewCandidateId', '') !~
        '^luna-linkage-review-candidate-v1:sha256:[0-9a-f]{64}$'
      or coalesce(v_candidate ->> 'ebayItemId', '') !~ '^[0-9]{9,19}$'
      or v_candidate ->> 'classification' not in (
        'EXACT_UNIQUE_MATCH', 'AMBIGUOUS_MATCH', 'CONFLICTING_MATCH',
        'NO_MATCH', 'BUNDLE_INCOMPLETE', 'IDENTITY_EVIDENCE_INCOMPLETE'
      )
      or v_candidate ->> 'linkageMode' not in (
        'SINGLE_COMPONENT', 'SIMPLE_MULTIPLIER', 'MULTI_COMPONENT_BOM',
        'UNRESOLVED'
      )
      or not public.is_valid_seller_os_luna_linkage_components_v1(v_components)
      or coalesce(v_candidate ->> 'evidenceDigest', '') !~
        '^sha256:[0-9a-f]{64}$'
      or v_candidate ->> 'evidenceFreshness' not in ('CURRENT', 'STALE')
      or jsonb_typeof(v_candidate -> 'evidenceMaximumAgeSeconds') <>
        'number'
      or v_candidate ->> 'evidenceMaximumAgeSeconds' <> '21600'
      or not public.is_valid_seller_os_luna_identity_evidence_provenance_v1(
        v_candidate -> 'identityEvidenceProvenance'
      )
      or coalesce(v_candidate ->> 'decisionVersion', '') !~
        '^[1-9][0-9]{0,5}$'
      or jsonb_typeof(v_candidate -> 'matchSignals') <> 'array'
      or jsonb_array_length(v_candidate -> 'matchSignals') > 32
      or jsonb_typeof(v_candidate -> 'conflictSignals') <> 'array'
      or jsonb_array_length(v_candidate -> 'conflictSignals') > 32
      or jsonb_typeof(v_candidate -> 'evidenceReferences') <> 'array'
      or jsonb_array_length(v_candidate -> 'evidenceReferences') > 64
      or exists (select 1
        from jsonb_array_elements(v_candidate -> 'matchSignals') signal(value)
        where jsonb_typeof(signal.value) <> 'string'
          or (signal.value #>> '{}') !~ '^[A-Z0-9_]{3,120}$')
      or exists (select 1
        from jsonb_array_elements(v_candidate -> 'conflictSignals') signal(value)
        where jsonb_typeof(signal.value) <> 'string'
          or (signal.value #>> '{}') !~ '^[A-Z0-9_]{3,120}$')
      or exists (select 1
        from jsonb_array_elements(v_candidate -> 'evidenceReferences') evidence(value)
        where jsonb_typeof(evidence.value) <> 'string'
          or length(evidence.value #>> '{}') not between 1 and 240
          or (evidence.value #>> '{}') !~ '^[A-Za-z0-9_.:/-]+$')
      or v_candidate -> 'stockCertification' ->> 'status' <>
        'NOT_EVALUATED'
      or v_candidate -> 'stockCertification' -> 'stockEvidenceUsedForIdentity'
        <> 'false'::jsonb
      or v_candidate -> 'stockCertification' -> 'automaticPauseAllowed'
        <> 'false'::jsonb
      or v_eligible is distinct from (
        v_candidate ->> 'classification' = 'EXACT_UNIQUE_MATCH'
        and v_candidate ->> 'evidenceFreshness' = 'CURRENT'
        and v_candidate -> 'identityEvidenceProvenance' ->> 'sourceStatus' =
          'AVAILABLE'
        and v_candidate -> 'identityEvidenceProvenance'
          ->> 'acquisitionMethod' = 'CANONICAL_SERVER_READ_IDENTITY_ONLY'
        and jsonb_array_length(v_candidate -> 'evidenceReferences') > 0
        and exists (select 1
          from jsonb_array_elements_text(
            v_candidate -> 'evidenceReferences'
          ) evidence_reference(value)
          where evidence_reference.value ~
            '^luna-identity-v1:sha256:[0-9a-f]{64}$')
        and jsonb_array_length(v_candidate -> 'conflictSignals') = 0
        and v_candidate -> 'linkageId' <> 'null'::jsonb
        and public.are_seller_os_luna_linkage_components_approvable_v1(
          v_components
        )
        and (
          (v_candidate ->> 'linkageMode' = 'SINGLE_COMPONENT'
            and jsonb_array_length(v_components) = 1
            and (v_components -> 0 ->> 'supplierQuantityRequired')::integer = 1)
          or (v_candidate ->> 'linkageMode' = 'SIMPLE_MULTIPLIER'
            and jsonb_array_length(v_components) = 1
            and (v_components -> 0 ->> 'supplierQuantityRequired')::integer > 1)
          or (v_candidate ->> 'linkageMode' = 'MULTI_COMPONENT_BOM'
            and jsonb_array_length(v_components) >= 2)
        )
        and (select count(*) = count(distinct jsonb_build_array(
          component.value ->> 'lunaProductId',
          component.value ->> 'lunaVariantId',
          component.value ->> 'lunaSku',
          component.value ->> 'supplierQuantityRequired'
        )) from jsonb_array_elements(v_components) component(value))
      )
      or (v_candidate ->> 'linkageMode' = 'UNRESOLVED' and (
        jsonb_array_length(v_components) <> 0
        or v_candidate -> 'linkageId' <> 'null'::jsonb
        or v_eligible))
      or (v_candidate ->> 'linkageMode' <> 'UNRESOLVED'
        and jsonb_array_length(v_components) = 0)
      or (v_eligible
        and v_candidate ->> 'linkageMode' = 'SINGLE_COMPONENT' and (
        jsonb_array_length(v_components) <> 1
        or (v_components -> 0 ->> 'supplierQuantityRequired')::integer <> 1))
      or (v_eligible
        and v_candidate ->> 'linkageMode' = 'SIMPLE_MULTIPLIER' and (
        jsonb_array_length(v_components) <> 1
        or (v_components -> 0 ->> 'supplierQuantityRequired')::integer <= 1))
      or (v_eligible
        and v_candidate ->> 'linkageMode' = 'MULTI_COMPONENT_BOM'
        and jsonb_array_length(v_components) < 2) then
      raise exception 'SELLER_OS_LUNA_LINKAGE_REVIEW_CANDIDATE_INVALID';
    end if;
  end loop;

  select count(*) into v_existing_count
  from public.seller_os_luna_linkage_review_candidates candidate
  where candidate.review_set_id = p_review_set_id;
  if v_existing_count > 0 then
    if v_existing_count <> v_candidate_count then
      raise exception 'SELLER_OS_LUNA_LINKAGE_REVIEW_SET_REPLAY_CONFLICT';
    end if;
    for v_candidate in select value from jsonb_array_elements(p_candidates)
    loop
      select * into v_existing
      from public.seller_os_luna_linkage_review_candidates candidate
      where candidate.review_set_id = p_review_set_id
        and candidate.review_candidate_id =
          v_candidate ->> 'reviewCandidateId';
      if not found or not v_existing.is_current
        or v_existing.review_set_id <> p_review_set_id
        or v_existing.current_cohort_id <> p_current_cohort_id
        or v_existing.ebay_item_id <> v_candidate ->> 'ebayItemId'
        or v_existing.evidence_digest <> v_candidate ->> 'evidenceDigest'
        or v_existing.review_observed_at <>
          (v_candidate ->> 'reviewObservedAt')::timestamptz
        or v_existing.evidence_maximum_age_seconds <>
          (v_candidate ->> 'evidenceMaximumAgeSeconds')::integer
        or v_existing.identity_evidence_provenance <>
          v_candidate -> 'identityEvidenceProvenance'
        or v_existing.evidence_freshness <>
          v_candidate ->> 'evidenceFreshness'
        or v_existing.components <> v_candidate -> 'components' then
        raise exception 'SELLER_OS_LUNA_LINKAGE_REVIEW_SET_REPLAY_CONFLICT';
      end if;
    end loop;
    return jsonb_build_object('outcome', 'IDEMPOTENT_SUCCESS',
      'reviewSetId', p_review_set_id, 'candidateCount', v_candidate_count);
  end if;

  update public.seller_os_luna_linkage_review_candidates candidate
  set is_current = false, retired_at = clock_timestamp()
  where candidate.account_key = p_account_key
    and candidate.marketplace_id = p_marketplace_id
    and candidate.is_current;

  for v_candidate in select value from jsonb_array_elements(p_candidates)
  loop
    v_components := v_candidate -> 'components';
    insert into public.seller_os_luna_linkage_review_candidates (
      review_candidate_id, review_set_id, current_cohort_id, account_key,
      account_binding, marketplace_id, ebay_item_id, ebay_sku, listing_title,
      classification,
      linkage_mode, linkage_id, luna_product_id, luna_variant_id, luna_sku,
      components, supplier_quantity_required, match_signals, conflict_signals,
      evidence_references, evidence_digest, evidence_observed_at,
      review_observed_at, evidence_maximum_age_seconds,
      identity_evidence_provenance, evidence_freshness,
      decision_version, approval_eligible, contract_version
    ) values (
      v_candidate ->> 'reviewCandidateId', p_review_set_id,
      p_current_cohort_id, p_account_key, 'CANONICAL_SELLER_ACCOUNT',
      p_marketplace_id,
      v_candidate ->> 'ebayItemId', nullif(v_candidate ->> 'ebaySku', ''),
      nullif(v_candidate ->> 'listingTitle', ''),
      v_candidate ->> 'classification', v_candidate ->> 'linkageMode',
      nullif(v_candidate ->> 'linkageId', ''),
      case when jsonb_array_length(v_components) = 1
        then v_components -> 0 ->> 'lunaProductId' end,
      case when jsonb_array_length(v_components) = 1
        then v_components -> 0 ->> 'lunaVariantId' end,
      case when jsonb_array_length(v_components) = 1
        then v_components -> 0 ->> 'lunaSku' end,
      v_components,
      case when jsonb_array_length(v_components) = 1
        then (v_components -> 0 ->> 'supplierQuantityRequired')::integer end,
      array(select jsonb_array_elements_text(v_candidate -> 'matchSignals')),
      array(select jsonb_array_elements_text(v_candidate -> 'conflictSignals')),
      array(select jsonb_array_elements_text(v_candidate -> 'evidenceReferences')),
      v_candidate ->> 'evidenceDigest',
      (v_candidate ->> 'evidenceObservedAt')::timestamptz,
      (v_candidate ->> 'reviewObservedAt')::timestamptz,
      (v_candidate ->> 'evidenceMaximumAgeSeconds')::integer,
      v_candidate -> 'identityEvidenceProvenance',
      v_candidate ->> 'evidenceFreshness',
      (v_candidate ->> 'decisionVersion')::integer,
      (v_candidate -> 'approvalEligibility' ->> 'eligible')::boolean,
      p_contract_version
    );
  end loop;
  return jsonb_build_object('outcome', 'CREATED',
    'reviewSetId', p_review_set_id, 'candidateCount', v_candidate_count);
end;
$function$;

create or replace function public.record_seller_os_luna_linkage_decision_v1(
  p_review_candidate_id text,
  p_review_set_id text,
  p_current_cohort_id text,
  p_ebay_item_id text,
  p_evidence_digest text,
  p_decision text,
  p_decision_version integer,
  p_decision_at timestamptz,
  p_decision_reference text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_candidate public.seller_os_luna_linkage_review_candidates%rowtype;
  v_existing public.seller_os_luna_linkage_decisions%rowtype;
  v_account_key text;
  v_marketplace_id text;
  v_previous_version integer;
begin
  if not public.is_seller_os_service_role_request_v1()
    or coalesce(p_review_candidate_id, '') !~
      '^luna-linkage-review-candidate-v1:sha256:[0-9a-f]{64}$'
    or coalesce(p_review_set_id, '') !~
      '^luna-linkage-review-set-v1:sha256:[0-9a-f]{64}$'
    or coalesce(p_current_cohort_id, '') !~ '^[A-Za-z0-9_.:-]{8,240}$'
    or coalesce(p_ebay_item_id, '') !~ '^[0-9]{9,19}$'
    or coalesce(p_evidence_digest, '') !~ '^sha256:[0-9a-f]{64}$'
    or p_decision not in (
      'APPROVE_EXACT_LINKAGE', 'REJECT_CANDIDATE', 'KEEP_UNPROVEN'
    )
    or p_decision_version not between 1 and 1000000
    or p_decision_at is null
    or p_decision_at > clock_timestamp() + interval '5 minutes'
    or coalesce(p_decision_reference, '') !~
      '^luna-linkage-decision-v1:sha256:[0-9a-f]{64}$'
    or p_actor_user_id is null then
    raise exception 'SELLER_OS_LUNA_LINKAGE_DECISION_INPUT_INVALID';
  end if;

  select candidate.account_key, candidate.marketplace_id
    into v_account_key, v_marketplace_id
  from public.seller_os_luna_linkage_review_candidates candidate
  where candidate.review_set_id = p_review_set_id
    and candidate.review_candidate_id = p_review_candidate_id;
  if not found then raise exception 'STALE_REVIEW_REJECTED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    v_account_key || ':' || v_marketplace_id, 0
  ));

  select * into v_candidate
  from public.seller_os_luna_linkage_review_candidates candidate
  where candidate.review_set_id = p_review_set_id
    and candidate.review_candidate_id = p_review_candidate_id
  for update;
  if not found then raise exception 'STALE_REVIEW_REJECTED'; end if;

  select * into v_existing
  from public.seller_os_luna_linkage_decisions decision_record
  where decision_record.account_key = v_candidate.account_key
    and decision_record.marketplace_id = v_candidate.marketplace_id
    and decision_record.ebay_item_id = v_candidate.ebay_item_id
    and decision_record.decision_version = p_decision_version;
  if found then
    if v_existing.review_candidate_id = p_review_candidate_id
      and v_existing.evidence_digest = p_evidence_digest
      and v_existing.decision = p_decision
      and v_existing.decision_reference = p_decision_reference then
      return jsonb_build_object('outcome', 'IDEMPOTENT_SUCCESS',
        'decisionReference', v_existing.decision_reference);
    end if;
    return jsonb_build_object(
      'outcome', 'CONFLICT_REQUIRES_NEW_DECISION_VERSION',
      'decisionReference', p_decision_reference);
  end if;

  if not v_candidate.is_current
    or v_candidate.review_set_id <> p_review_set_id
    or v_candidate.current_cohort_id <> p_current_cohort_id
    or v_candidate.ebay_item_id <> p_ebay_item_id
    or v_candidate.evidence_digest <> p_evidence_digest
    or v_candidate.decision_version <> p_decision_version then
    raise exception 'STALE_REVIEW_REJECTED';
  end if;
  if p_decision_at <
      v_candidate.evidence_observed_at - interval '5 minutes' then
    raise exception 'SELLER_OS_LUNA_LINKAGE_DECISION_CLOCK_INVALID';
  end if;
  if v_candidate.evidence_freshness <> 'CURRENT'
    or p_decision_at > v_candidate.evidence_observed_at
      + make_interval(secs => v_candidate.evidence_maximum_age_seconds) then
    raise exception 'STALE_REVIEW_REJECTED';
  end if;
  if p_decision = 'APPROVE_EXACT_LINKAGE'
    and not v_candidate.approval_eligible then
    raise exception 'SELLER_OS_LUNA_LINKAGE_EXACT_APPROVAL_NOT_ALLOWED';
  end if;
  if p_decision = 'REJECT_CANDIDATE'
    and jsonb_array_length(v_candidate.components) = 0 then
    raise exception 'SELLER_OS_LUNA_LINKAGE_REJECT_CANDIDATE_NOT_ALLOWED';
  end if;
  if v_candidate.linkage_mode = 'UNRESOLVED'
    and p_decision <> 'KEEP_UNPROVEN' then
    raise exception 'SELLER_OS_LUNA_LINKAGE_UNRESOLVED_DECISION_NOT_ALLOWED';
  end if;
  if not exists (
    select 1 from auth.users actor
    where actor.id = p_actor_user_id and (
      actor.raw_app_meta_data ->> 'is_admin' = 'true'
      or actor.raw_app_meta_data ->> 'role' = 'admin'
    )
  ) then
    raise exception 'SELLER_OS_LUNA_LINKAGE_ADMIN_ACTOR_REQUIRED';
  end if;

  select max(decision_record.decision_version) into v_previous_version
  from public.seller_os_luna_linkage_decisions decision_record
  where decision_record.account_key = v_candidate.account_key
    and decision_record.marketplace_id = v_candidate.marketplace_id
    and decision_record.ebay_item_id = v_candidate.ebay_item_id;
  if p_decision_version <> coalesce(v_previous_version + 1, 1) then
    return jsonb_build_object(
      'outcome', 'CONFLICT_REQUIRES_NEW_DECISION_VERSION',
      'decisionReference', p_decision_reference);
  end if;

  insert into public.seller_os_luna_linkage_decisions (
    decision_id, review_candidate_id, review_set_id, current_cohort_id,
    account_key, account_binding, marketplace_id, ebay_item_id, ebay_sku,
    listing_title,
    classification, linkage_mode, linkage_id, luna_product_id,
    luna_variant_id, luna_sku, components, supplier_quantity_required,
    evidence_references, evidence_digest, evidence_observed_at,
    review_observed_at, evidence_maximum_age_seconds,
    identity_evidence_provenance, evidence_freshness, provenance,
    decision, decision_version, decision_at, decision_reference,
    actor_user_id, contract_version
  ) values (
    p_decision_reference, v_candidate.review_candidate_id,
    v_candidate.review_set_id, v_candidate.current_cohort_id,
    v_candidate.account_key, v_candidate.account_binding,
    v_candidate.marketplace_id,
    v_candidate.ebay_item_id, v_candidate.ebay_sku,
    v_candidate.listing_title, v_candidate.classification,
    v_candidate.linkage_mode, v_candidate.linkage_id,
    v_candidate.luna_product_id, v_candidate.luna_variant_id,
    v_candidate.luna_sku, v_candidate.components,
    v_candidate.supplier_quantity_required,
    v_candidate.evidence_references, v_candidate.evidence_digest,
    v_candidate.evidence_observed_at,
    v_candidate.review_observed_at,
    v_candidate.evidence_maximum_age_seconds,
    v_candidate.identity_evidence_provenance,
    v_candidate.evidence_freshness,
    jsonb_build_object('authorityClass', 'HUMAN_DECISION',
      'identityEvidenceClass', 'SUPPLIER_CURRENT_IDENTITY',
      'stockEvidenceUsed', false,
      'identityEvidenceProvenance',
        v_candidate.identity_evidence_provenance),
    p_decision, p_decision_version, p_decision_at, p_decision_reference,
    p_actor_user_id, 'SELLER_OS_LUNA_LINKAGE_DECISION_V1'
  );
  return jsonb_build_object('outcome', 'CREATED',
    'decisionReference', p_decision_reference);
end;
$function$;

revoke all on function
  public.is_valid_seller_os_luna_linkage_components_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  public.are_seller_os_luna_linkage_components_approvable_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  public.is_valid_seller_os_luna_identity_evidence_provenance_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  public.has_seller_os_luna_identity_evidence_reference_v1(text[])
  from public, anon, authenticated, service_role;
revoke all on function public.is_seller_os_service_role_request_v1()
  from public, anon, authenticated, service_role;
revoke all on function
  public.guard_seller_os_luna_linkage_review_candidate_v1()
  from public, anon, authenticated, service_role;
revoke all on function
  public.prevent_seller_os_luna_linkage_decision_mutation_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.replace_seller_os_luna_linkage_review_set_v1(
  text, text, text, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.record_seller_os_luna_linkage_decision_v1(
  text, text, text, text, text, text, integer, timestamptz, text, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.replace_seller_os_luna_linkage_review_set_v1(
  text, text, text, text, text, jsonb
) to service_role;
grant execute on function public.record_seller_os_luna_linkage_decision_v1(
  text, text, text, text, text, text, integer, timestamptz, text, uuid
) to service_role;

comment on table public.seller_os_luna_linkage_review_candidates is
  'Server-generated current Luna identity review evidence; not linkage truth.';
comment on table public.seller_os_luna_linkage_decisions is
  'Append-only canonical P2-I01 human linkage decision truth.';

notify pgrst, 'reload schema';
