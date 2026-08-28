-- Durable, reusable category learning for Seller OS listings.
--
-- This does not replace official eBay Taxonomy, candidate-bound Taxonomy
-- preflights, listing packages, or post-listing category performance learning.
-- It stores only mappings that have just passed official Taxonomy validation.

create table public.ebay_category_resolution_learning_v1 (
  id uuid primary key default gen_random_uuid(),
  account_key text not null,
  marketplace_id text not null default 'EBAY_US',
  normalized_product_family text not null,
  normalized_product_type text not null,
  family_type_fingerprint text not null,
  category_id text not null,
  category_name text null,
  taxonomy_tree_id text not null,
  taxonomy_tree_version text not null,
  taxonomy_snapshot_digest text not null,
  taxonomy_pass boolean not null,
  required_aspects jsonb not null default '[]'::jsonb,
  listing_acceptance text not null default 'UNKNOWN',
  listing_acceptance_ebay_item_id text null,
  listing_acceptance_observed_at timestamptz null,
  confidence_tier text not null,
  confidence_score numeric(5,2) not null,
  provenance jsonb not null default '{}'::jsonb,
  source_listing_package_id uuid null
    references public.ebay_listing_packages(id) on delete restrict,
  source_opportunity_id uuid null
    references public.ebay_luna_opportunity_queue(id) on delete restrict,
  source_candidate_key text null,
  first_validated_at timestamptz not null,
  last_validated_at timestamptz not null,
  revalidate_after timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_category_resolution_learning_account_check check (
    char_length(account_key) between 1 and 160
    and account_key !~ '[[:cntrl:]]'
  ),
  constraint ebay_category_resolution_learning_marketplace_check check (
    marketplace_id = 'EBAY_US'
  ),
  constraint ebay_category_resolution_learning_family_check check (
    char_length(normalized_product_family) between 2 and 160
    and normalized_product_family = lower(normalized_product_family)
    and normalized_product_family ~ '^[a-z0-9]+(?: [a-z0-9]+)*$'
  ),
  constraint ebay_category_resolution_learning_type_check check (
    char_length(normalized_product_type) between 2 and 160
    and normalized_product_type = lower(normalized_product_type)
    and normalized_product_type ~ '^[a-z0-9]+(?: [a-z0-9]+)*$'
  ),
  constraint ebay_category_resolution_learning_family_type_digest_check check (
    family_type_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint ebay_category_resolution_learning_category_check check (
    category_id ~ '^[0-9]{1,20}$'
  ),
  constraint ebay_category_resolution_learning_category_name_check check (
    category_name is null or (
      char_length(category_name) between 1 and 200
      and category_name !~ '[[:cntrl:]]'
    )
  ),
  constraint ebay_category_resolution_learning_tree_check check (
    taxonomy_tree_id ~ '^[0-9]{1,20}$'
    and char_length(taxonomy_tree_version) between 1 and 80
    and taxonomy_tree_version ~ '^[A-Za-z0-9._:-]+$'
  ),
  constraint ebay_category_resolution_learning_snapshot_check check (
    taxonomy_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint ebay_category_resolution_learning_taxonomy_pass_check check (
    taxonomy_pass is true
  ),
  constraint ebay_category_resolution_learning_required_aspects_check check (
    jsonb_typeof(required_aspects) = 'array'
  ),
  constraint ebay_category_resolution_learning_acceptance_check check (
    listing_acceptance in ('UNKNOWN', 'ACCEPTED', 'REJECTED')
    and (
      (listing_acceptance = 'UNKNOWN'
        and listing_acceptance_ebay_item_id is null
        and listing_acceptance_observed_at is null)
      or (listing_acceptance = 'ACCEPTED'
        and listing_acceptance_ebay_item_id ~ '^[0-9]{9,20}$'
        and listing_acceptance_observed_at is not null)
      or (listing_acceptance = 'REJECTED'
        and listing_acceptance_ebay_item_id is null
        and listing_acceptance_observed_at is not null)
    )
  ),
  constraint ebay_category_resolution_learning_confidence_check check (
    confidence_tier in ('HIGH_CONFIDENCE', 'MEDIUM_CONFIDENCE', 'LOW_CONFIDENCE')
    and confidence_score between 0 and 100
  ),
  constraint ebay_category_resolution_learning_provenance_check check (
    jsonb_typeof(provenance) = 'object'
  ),
  constraint ebay_category_resolution_learning_source_context_check check (
    (
      source_listing_package_id is null
      and source_opportunity_id is null
      and source_candidate_key is null
    ) or (
      source_listing_package_id is not null
      and source_opportunity_id is not null
      and char_length(source_candidate_key) between 1 and 300
      and source_candidate_key !~ '[[:cntrl:]]'
    )
  ),
  constraint ebay_category_resolution_learning_time_check check (
    first_validated_at <= last_validated_at
    and last_validated_at <= revalidate_after
  ),
  constraint ebay_category_resolution_learning_snapshot_unique unique (
    account_key,
    marketplace_id,
    normalized_product_family,
    normalized_product_type,
    category_id,
    taxonomy_tree_id,
    taxonomy_tree_version,
    taxonomy_snapshot_digest
  )
);

create index ebay_category_resolution_learning_lookup_idx
  on public.ebay_category_resolution_learning_v1 (
    account_key,
    marketplace_id,
    family_type_fingerprint,
    taxonomy_pass,
    last_validated_at desc
  );

create index ebay_category_resolution_learning_package_idx
  on public.ebay_category_resolution_learning_v1 (source_listing_package_id)
  where source_listing_package_id is not null;

create index ebay_category_resolution_learning_opportunity_idx
  on public.ebay_category_resolution_learning_v1 (source_opportunity_id)
  where source_opportunity_id is not null;

alter table public.ebay_category_resolution_learning_v1
  enable row level security;
alter table public.ebay_category_resolution_learning_v1
  force row level security;

revoke all on table public.ebay_category_resolution_learning_v1
  from public;
revoke all on table public.ebay_category_resolution_learning_v1
  from anon, authenticated;
grant select, insert, update on table
  public.ebay_category_resolution_learning_v1 to service_role;

create or replace function public.upsert_ebay_category_resolution_learning_v1(
  p_account_key text,
  p_marketplace_id text,
  p_normalized_product_family text,
  p_normalized_product_type text,
  p_family_type_fingerprint text,
  p_category_id text,
  p_category_name text,
  p_taxonomy_tree_id text,
  p_taxonomy_tree_version text,
  p_taxonomy_snapshot_digest text,
  p_required_aspects jsonb,
  p_confidence_tier text,
  p_confidence_score numeric,
  p_provenance jsonb,
  p_source_listing_package_id uuid,
  p_source_opportunity_id uuid,
  p_source_candidate_key text,
  p_validated_at timestamptz,
  p_revalidate_after timestamptz
)
returns setof public.ebay_category_resolution_learning_v1
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_context_matches boolean;
begin
  if p_source_listing_package_id is not null then
    select exists (
      select 1
      from public.ebay_listing_packages package_row
      where package_row.id = p_source_listing_package_id
        and package_row.account_key = p_account_key
        and package_row.opportunity_id = p_source_opportunity_id
        and package_row.candidate_key = p_source_candidate_key
    ) into v_context_matches;
    if not v_context_matches then
      raise exception 'EBAY_CATEGORY_RESOLVER_SOURCE_CONTEXT_MISMATCH';
    end if;
  elsif p_source_opportunity_id is not null
    or p_source_candidate_key is not null then
    raise exception 'EBAY_CATEGORY_RESOLVER_SOURCE_CONTEXT_INCOMPLETE';
  end if;

  return query
  insert into public.ebay_category_resolution_learning_v1 as learning (
    account_key,
    marketplace_id,
    normalized_product_family,
    normalized_product_type,
    family_type_fingerprint,
    category_id,
    category_name,
    taxonomy_tree_id,
    taxonomy_tree_version,
    taxonomy_snapshot_digest,
    taxonomy_pass,
    required_aspects,
    confidence_tier,
    confidence_score,
    provenance,
    source_listing_package_id,
    source_opportunity_id,
    source_candidate_key,
    first_validated_at,
    last_validated_at,
    revalidate_after,
    updated_at
  ) values (
    p_account_key,
    p_marketplace_id,
    p_normalized_product_family,
    p_normalized_product_type,
    p_family_type_fingerprint,
    p_category_id,
    nullif(trim(p_category_name), ''),
    p_taxonomy_tree_id,
    p_taxonomy_tree_version,
    p_taxonomy_snapshot_digest,
    true,
    coalesce(p_required_aspects, '[]'::jsonb),
    p_confidence_tier,
    p_confidence_score,
    coalesce(p_provenance, '{}'::jsonb),
    p_source_listing_package_id,
    p_source_opportunity_id,
    nullif(trim(p_source_candidate_key), ''),
    p_validated_at,
    p_validated_at,
    p_revalidate_after,
    now()
  )
  on conflict (
    account_key,
    marketplace_id,
    normalized_product_family,
    normalized_product_type,
    category_id,
    taxonomy_tree_id,
    taxonomy_tree_version,
    taxonomy_snapshot_digest
  ) do update set
    family_type_fingerprint = excluded.family_type_fingerprint,
    category_name = excluded.category_name,
    taxonomy_pass = true,
    required_aspects = excluded.required_aspects,
    confidence_tier = case
      when excluded.confidence_score >=
        learning.confidence_score
        then excluded.confidence_tier
      else learning.confidence_tier
    end,
    confidence_score = greatest(
      learning.confidence_score,
      excluded.confidence_score
    ),
    provenance = excluded.provenance,
    -- Origin provenance is immutable. Later candidates may reuse the same
    -- mapping without taking ownership of its historical source.
    source_listing_package_id = coalesce(
      learning.source_listing_package_id,
      excluded.source_listing_package_id
    ),
    source_opportunity_id = coalesce(
      learning.source_opportunity_id,
      excluded.source_opportunity_id
    ),
    source_candidate_key = coalesce(
      learning.source_candidate_key,
      excluded.source_candidate_key
    ),
    last_validated_at = greatest(
      learning.last_validated_at,
      excluded.last_validated_at
    ),
    revalidate_after = greatest(
      learning.revalidate_after,
      excluded.revalidate_after
    ),
    updated_at = now()
  returning learning.*;
end;
$$;

create or replace function public.record_ebay_category_listing_acceptance_v1(
  p_learning_id uuid,
  p_account_key text,
  p_listing_package_id uuid,
  p_category_id text,
  p_listing_acceptance text,
  p_ebay_item_id text,
  p_observed_at timestamptz
)
returns setof public.ebay_category_resolution_learning_v1
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_listing_acceptance not in ('ACCEPTED', 'REJECTED')
    or p_observed_at is null
    or (p_listing_acceptance = 'ACCEPTED'
      and coalesce(p_ebay_item_id, '') !~ '^[0-9]{9,20}$')
    or (p_listing_acceptance = 'REJECTED'
      and p_ebay_item_id is not null) then
    raise exception 'EBAY_CATEGORY_RESOLVER_LISTING_ACCEPTANCE_INVALID';
  end if;

  return query
  update public.ebay_category_resolution_learning_v1 learning
  set listing_acceptance = case
        when learning.listing_acceptance = 'ACCEPTED' then 'ACCEPTED'
        else p_listing_acceptance
      end,
      listing_acceptance_ebay_item_id = case
        when learning.listing_acceptance = 'ACCEPTED'
          then learning.listing_acceptance_ebay_item_id
        when p_listing_acceptance = 'ACCEPTED' then p_ebay_item_id
        else null
      end,
      listing_acceptance_observed_at = case
        when learning.listing_acceptance = 'ACCEPTED'
          then learning.listing_acceptance_observed_at
        else p_observed_at
      end,
      updated_at = now()
  from public.ebay_listing_packages package_row
  where learning.id = p_learning_id
    and learning.account_key = p_account_key
    and learning.category_id = p_category_id
    and package_row.id = p_listing_package_id
    and package_row.account_key = p_account_key
    and package_row.package_data #>> '{categoryResolverV1,authorityClass}' =
      'SELLER_OS_EBAY_CATEGORY_RESOLVER_V1'
    and package_row.package_data #>> '{categoryResolverV1,status}' =
      'AUTO_SELECTED'
    and package_row.package_data #>> '{categoryResolverV1,learningId}' =
      learning.id::text
    and package_row.package_data #>> '{categoryResolverV1,listingPackageId}' =
      package_row.id::text
    and package_row.package_data #>> '{categoryResolverV1,opportunityId}' =
      package_row.opportunity_id::text
    and package_row.package_data #>> '{categoryResolverV1,candidateKey}' =
      package_row.candidate_key
    and package_row.package_data #>> '{categoryResolverV1,selectedCategoryId}' =
      learning.category_id
  returning learning.*;

  if not found then
    raise exception 'EBAY_CATEGORY_RESOLVER_LISTING_ACCEPTANCE_CONTEXT_MISMATCH';
  end if;
end;
$$;

revoke all on function public.upsert_ebay_category_resolution_learning_v1(
  text, text, text, text, text, text, text, text, text, text, jsonb,
  text, numeric, jsonb, uuid, uuid, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.upsert_ebay_category_resolution_learning_v1(
  text, text, text, text, text, text, text, text, text, text, jsonb,
  text, numeric, jsonb, uuid, uuid, text, timestamptz, timestamptz
) to service_role;

revoke all on function public.record_ebay_category_listing_acceptance_v1(
  uuid, text, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_ebay_category_listing_acceptance_v1(
  uuid, text, uuid, text, text, text, timestamptz
) to service_role;

comment on table public.ebay_category_resolution_learning_v1 is
  'CATEGORY_RESOLVER_V1 mappings proven by official eBay Taxonomy. Reusable mapping data is family/type scoped; candidate-specific aspect values remain in exact listing packages.';
comment on column public.ebay_category_resolution_learning_v1.required_aspects is
  'Official required-aspect metadata only. Never contains values copied from another candidate.';
comment on column public.ebay_category_resolution_learning_v1.listing_acceptance is
  'UNKNOWN until authoritative post-publication readback records ACCEPTED or a bounded rejection records REJECTED.';

notify pgrst, 'reload schema';
