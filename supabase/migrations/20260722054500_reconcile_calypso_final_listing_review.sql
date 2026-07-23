-- Reconcile Calypso's internal final-listing review against the immutable V3
-- selection and an official read-only eBay Taxonomy snapshot. This migration
-- creates no eBay resource and enables no commercial authorization.

create table if not exists public.ebay_reference_guided_final_listing_reconciliation_events (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.ebay_same_day_pilot_image_revisions(id),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  listing_package_id uuid not null references public.ebay_listing_packages(id),
  prior_preview_id uuid not null
    references public.ebay_reference_guided_final_listing_review_previews(id),
  reconciled_preview_id uuid not null
    references public.ebay_reference_guided_final_listing_review_previews(id),
  taxonomy_cache_id uuid not null references public.ebay_readonly_detail_cache(id),
  title_before text not null,
  title_after text not null,
  item_specifics_before jsonb not null,
  item_specifics_after jsonb not null,
  gate_sources jsonb not null,
  opportunity_validation_status text not null,
  market_demand_validation_status text not null,
  package_preparation_percent integer not null check (package_preparation_percent = 100),
  visual_gate_source text not null,
  legacy_v2_visual_blockers_active boolean not null check (not legacy_v2_visual_blockers_active),
  user_fields_preserved boolean not null check (user_fields_preserved),
  provider_calls_snapshot integer not null check (provider_calls_snapshot = 8),
  inventory_item_created boolean not null check (not inventory_item_created),
  offer_created boolean not null check (not offer_created),
  ebay_writes integer not null check (ebay_writes = 0),
  production_changed boolean not null check (not production_changed),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (attempt_id)
);

drop trigger if exists ebay_reference_guided_final_listing_reconciliation_append_only
  on public.ebay_reference_guided_final_listing_reconciliation_events;
create trigger ebay_reference_guided_final_listing_reconciliation_append_only
before update or delete
  on public.ebay_reference_guided_final_listing_reconciliation_events
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

alter table public.ebay_reference_guided_final_listing_reconciliation_events
  enable row level security;
alter table public.ebay_reference_guided_final_listing_reconciliation_events
  force row level security;
revoke all on table public.ebay_reference_guided_final_listing_reconciliation_events
  from public, anon, authenticated, service_role;
grant select, insert
  on table public.ebay_reference_guided_final_listing_reconciliation_events
  to service_role;

create or replace function public.reconcile_calypso_v3_final_listing_review(
  p_revision_id uuid,
  p_attempt_id uuid
) returns table(
  reconciliation_event_id uuid,
  preview_id uuid,
  preview_hash text,
  title_final text,
  title_length integer,
  taxonomy_fetched boolean,
  category_valid boolean,
  item_specifics_valid boolean,
  opportunity_validation_status text,
  market_demand_validation_status text,
  package_preparation_percent integer,
  ready_for_unpublished_offer_authorization boolean,
  blockers text[]
)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_prior public.ebay_reference_guided_final_listing_review_previews%rowtype;
  v_existing public.ebay_reference_guided_final_listing_reconciliation_events%rowtype;
  v_existing_preview public.ebay_reference_guided_final_listing_review_previews%rowtype;
  v_taxonomy public.ebay_readonly_detail_cache%rowtype;
  v_taxonomy_payload jsonb;
  v_before jsonb;
  v_after jsonb;
  v_before_aspects jsonb;
  v_after_aspects jsonb;
  v_before_without_internal_edits jsonb;
  v_after_without_internal_edits jsonb;
  v_user_fields jsonb;
  v_user_fields_hash text;
  v_snapshot jsonb;
  v_gates jsonb;
  v_gate_sources jsonb;
  v_gate_details jsonb;
  v_preview_hash text;
  v_new_preview public.ebay_reference_guided_final_listing_review_previews%rowtype;
  v_event public.ebay_reference_guided_final_listing_reconciliation_events%rowtype;
  v_title constant text :=
    'Calypso Basics by Reston Lloyd 1.5 Qt Powder Coated Enamel Colander White';
  v_opportunity_status constant text :=
    'CURRENT_CANDIDATE_READY_LEGACY_QUEUE_GATES_SUPERSEDED';
  v_market_status constant text :=
    'CONTROLLED_TEST_APPROVED_WITH_INSUFFICIENT_EQUIVALENT_MARKET_DATA';
  v_visual_source constant text :=
    'V3_FINAL_ATOMIC_SELECTION:ebay_reference_guided_position_6_extraordinary_human_verdict_events.selected_assets';
  v_taxonomy_valid boolean;
  v_specifics_valid boolean;
  v_market_route_valid boolean;
begin
  if p_revision_id <> '3a4a233e-d4bc-4a65-825f-c4882bceb9d1'::uuid
    or p_attempt_id <> 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid then
    raise exception 'FINAL_LISTING_RECONCILIATION_SCOPE_INVALID';
  end if;

  select event.* into v_existing
  from public.ebay_reference_guided_final_listing_reconciliation_events event
  where event.attempt_id = p_attempt_id;
  if v_existing.id is not null then
    select preview.* into v_existing_preview
    from public.ebay_reference_guided_final_listing_review_previews preview
    where preview.id = v_existing.reconciled_preview_id;
    return query select v_existing.id, v_existing_preview.id,
      v_existing_preview.preview_hash, v_existing.title_after,
      length(v_existing.title_after), true, true, true,
      v_existing.opportunity_validation_status,
      v_existing.market_demand_validation_status,
      v_existing.package_preparation_percent,
      v_existing_preview.ready_for_unpublished_offer_authorization,
      v_existing_preview.blockers;
    return;
  end if;

  select revision.* into v_revision
  from public.ebay_same_day_pilot_image_revisions revision
  where revision.id = p_revision_id for update;
  select attempt.* into v_attempt
  from public.ebay_reference_guided_generation_attempts attempt
  where attempt.id = p_attempt_id and attempt.revision_id = p_revision_id
  for update;
  if v_revision.id is null or v_attempt.id is null
    or v_revision.strategy_version <> 'VISUAL_STRATEGY_V3'
    or v_revision.revision_contract <> 'REFERENCE_GUIDED_PRODUCT_GENERATION_V1'
    or v_attempt.provider_calls <> 8 or v_attempt.max_provider_calls <> 8
    or v_attempt.ebay_writes <> 0 or v_attempt.production_changed
    or v_attempt.retry_consumed then
    raise exception 'FINAL_LISTING_RECONCILIATION_ATTEMPT_INVALID';
  end if;
  if exists (
    select 1 from public.ebay_reference_guided_generation_jobs job
    where job.generation_attempt_id = p_attempt_id and (
      job.lease_owner is not null or job.lease_expires_at is not null
    )
  ) then
    raise exception 'FINAL_LISTING_RECONCILIATION_ACTIVE_LEASE';
  end if;

  select package.* into v_package
  from public.ebay_listing_packages package
  where package.id = v_revision.listing_package_id for update;
  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = v_revision.candidate_id
    and candidate.candidate_key = v_package.candidate_key for share;
  select preview.* into v_prior
  from public.ebay_reference_guided_final_listing_review_previews preview
  where preview.attempt_id = p_attempt_id
  order by preview.created_at desc limit 1 for share;
  if v_package.id is null or v_candidate.id is null or v_prior.id is null
    or v_prior.final_visual_set_locked is not true
    or v_prior.visual_phase <> 'COMPLETED'
    or v_prior.provider_calls_snapshot <> 8
    or cardinality(v_prior.blockers) <> 0
    or v_prior.gates->>'sevenImageOrderValid' <> 'true'
    or jsonb_array_length(v_prior.preview_snapshot->'selectedImages') <> 7
    or v_prior.preview_snapshot->'selectedImages'->0->>'assetRole' <> 'PRIMARY_MAIN'
    or exists (
      select 1
      from jsonb_array_elements(v_prior.preview_snapshot->'selectedImages') asset
      where asset->>'status' <> 'PASSED'
    ) then
    raise exception 'FINAL_LISTING_RECONCILIATION_V3_SET_INVALID';
  end if;

  select cache.* into v_taxonomy
  from public.ebay_readonly_detail_cache cache
  where cache.api_family = 'TAXONOMY'
    and cache.resource_fingerprint =
      '6effbce5086488722de1e3e90a337c0aca2ae2a7a40f78ca1e6656163e7c7586'
    and cache.expires_at > clock_timestamp()
  order by cache.observed_at desc limit 1 for share;
  v_taxonomy_payload := coalesce(v_taxonomy.safe_payload,'{}'::jsonb);
  v_taxonomy_valid := v_taxonomy.id is not null
    and v_taxonomy_payload->>'source' = 'EBAY_TAXONOMY_OFFICIAL_READONLY'
    and v_taxonomy_payload->>'status' = 'AVAILABLE'
    and v_taxonomy_payload->>'categoryId' = '20636'
    and v_taxonomy_payload->>'taxonomyMarketplaceId' = 'EBAY_US'
    and coalesce(v_taxonomy_payload->>'categoryTreeId','') <> ''
    and coalesce(v_taxonomy_payload->>'categoryTreeVersion','') <> ''
    and exists (
      select 1 from jsonb_array_elements(v_taxonomy_payload->'aspects') aspect
      where aspect->>'name' = 'Brand' and aspect->>'mode' = 'FREE_TEXT'
        and aspect->>'cardinality' = 'SINGLE'
        and aspect->>'required' = 'true'
    )
    and exists (
      select 1 from jsonb_array_elements(v_taxonomy_payload->'aspects') aspect
      where aspect->>'name' = 'Type' and aspect->>'mode' = 'FREE_TEXT'
        and aspect->>'cardinality' = 'SINGLE'
    )
    and exists (
      select 1 from jsonb_array_elements(v_taxonomy_payload->'aspects') aspect
      where aspect->>'name' = 'Color' and aspect->>'mode' = 'FREE_TEXT'
        and aspect->>'cardinality' = 'SINGLE'
    )
    and exists (
      select 1 from jsonb_array_elements(v_taxonomy_payload->'aspects') aspect
      where aspect->>'name' = 'Material' and aspect->>'mode' = 'FREE_TEXT'
        and aspect->>'cardinality' = 'MULTI'
    )
    and exists (
      select 1 from jsonb_array_elements(v_taxonomy_payload->'aspects') aspect
      where aspect->>'name' = 'Size' and aspect->>'mode' = 'FREE_TEXT'
        and aspect->>'cardinality' = 'SINGLE'
    )
    and exists (
      select 1 from jsonb_array_elements(v_taxonomy_payload->'aspects') aspect
      where aspect->>'name' = 'MPN' and aspect->>'mode' = 'FREE_TEXT'
    );
  if not v_taxonomy_valid then
    raise exception 'FINAL_LISTING_RECONCILIATION_TAXONOMY_INVALID';
  end if;

  v_before := v_package.package_data;
  v_before_aspects := coalesce(v_before->'aspects','{}'::jsonb);
  v_after_aspects := jsonb_set(
    v_before_aspects, '{Size}', to_jsonb('1.5 Quart'::text), true);
  v_after := jsonb_set(
    jsonb_set(v_before, '{title}', to_jsonb(v_title), true),
    '{aspects}', v_after_aspects, true);
  v_specifics_valid :=
    v_after->>'categoryId' = '20636'
    and v_after_aspects->>'Brand' = 'Calypso Basics'
    and v_after_aspects->>'MPN' = '08300'
    and v_after_aspects->>'Type' = 'Colander'
    and v_after_aspects->>'Color' = 'White'
    and lower(v_after_aspects->>'Material') =
      'powder coated enamel on steel'
    and v_after_aspects->>'Size' = '1.5 Quart'
    and v_prior.preview_snapshot#>>'{listing,productIdentifiers,gtin}' =
      '036588083005'
    and v_after->>'conditionId' = '1000';
  v_market_route_valid :=
    v_candidate.state = 'READY_FOR_MANUAL_PUBLICATION'
    and v_candidate.machine_state = 'READY_FOR_MANUAL_PUBLICATION'
    and v_candidate.product_facts_summary#>>'{marketPricing,status}' =
      'INSUFFICIENT_EQUIVALENT_MARKET_DATA'
    and v_candidate.economics_summary->>'controlledExploratoryTestApproved' = 'true'
    and v_candidate.economics_summary->>'operatorPriceApproved' = 'true'
    and v_after#>>'{pricing,targetPrice}' = '21.39'
    and v_after#>>'{pricing,supplierCost}' = '3.8'
    and v_after#>>'{pricing,passesProfitGate}' = 'true';
  if length(v_title) > 80 or not v_specifics_valid or not v_market_route_valid then
    raise exception 'FINAL_LISTING_RECONCILIATION_COMMERCIAL_GATE_INVALID';
  end if;

  -- Only the exact requested title and Taxonomy-normalized Size are changed.
  v_before_without_internal_edits := v_before - 'title';
  v_before_without_internal_edits := jsonb_set(
    v_before_without_internal_edits, '{aspects}',
    coalesce(v_before_without_internal_edits->'aspects','{}'::jsonb) - 'Size');
  v_after_without_internal_edits := v_after - 'title';
  v_after_without_internal_edits := jsonb_set(
    v_after_without_internal_edits, '{aspects}',
    coalesce(v_after_without_internal_edits->'aspects','{}'::jsonb) - 'Size');
  if v_before_without_internal_edits <> v_after_without_internal_edits then
    raise exception 'FINAL_LISTING_RECONCILIATION_USER_FIELDS_CHANGED';
  end if;

  update public.ebay_listing_packages
  set package_data = v_after, readiness = 100, updated_at = clock_timestamp()
  where id = v_package.id
  returning * into v_package;

  v_gate_sources := jsonb_build_object(
    'visual',v_visual_source,
    'taxonomy','EBAY_TAXONOMY_OFFICIAL_READONLY:ebay_readonly_detail_cache',
    'canonicalIdentity',
      'ebay_same_day_pilot_candidates.product_facts_summary+listing_package',
    'opportunity',
      'ebay_same_day_pilot_candidates.id=' || v_candidate.id::text,
    'marketDemand',
      'candidate.product_facts_summary.marketPricing+economics_summary.operatorApprovals',
    'luna','candidate.economics_summary.lunaConfirmation',
    'policies','ebay_account_policy_profiles',
    'package','ebay_listing_packages.package_data'
  );
  v_gates := v_prior.gates || jsonb_build_object(
    'visualFinalSetAtomic',true,
    'taxonomyFetched',true,
    'opportunityValidationCurrent',true,
    'marketDemandControlledRouteValid',true,
    'legacyV2VisualBlockersInactive',true,
    'position6StatusConsistent',true,
    'userFieldsPreserved',true
  );
  v_gate_details := (
    select jsonb_agg(jsonb_build_object(
      'gate',entry.key,'passed',entry.value,'source',
      coalesce(v_gate_sources->>entry.key,
        case
          when entry.key like '%Image%' or entry.key like '%Visual%'
            then v_gate_sources->>'visual'
          when entry.key like '%taxonomy%' or entry.key like '%category%'
            or entry.key like '%Specifics%'
            then v_gate_sources->>'taxonomy'
          when entry.key like '%luna%' then v_gate_sources->>'luna'
          when entry.key like '%policies%' or entry.key like '%Location%'
            then v_gate_sources->>'policies'
          else v_gate_sources->>'package'
        end)
    ) order by entry.key)
    from jsonb_each(v_gates) entry
  );
  v_user_fields := jsonb_build_object(
    'title',v_after->'title',
    'categoryId',v_after->'categoryId',
    'categoryName',v_after->'categoryName',
    'conditionId',v_after->'conditionId',
    'description',v_after->'description',
    'aspects',v_after->'aspects',
    'pricing',v_after->'pricing',
    'shipping',v_after->'shipping',
    'draftConfiguration',v_after->'draftConfiguration'
  );
  v_user_fields_hash := encode(extensions.digest(
    convert_to(v_user_fields::text,'UTF8'),'sha256'),'hex');

  v_snapshot := jsonb_set(v_prior.preview_snapshot,
    '{version}',to_jsonb('CALYPSO_FINAL_LISTING_REVIEW_V2'::text),true);
  v_snapshot := jsonb_set(v_snapshot,'{listing,title}',to_jsonb(v_title),true);
  v_snapshot := jsonb_set(v_snapshot,'{listing,titleLength}',
    to_jsonb(length(v_title)),true);
  v_snapshot := jsonb_set(v_snapshot,'{listing,itemSpecifics}',
    v_after_aspects,true);
  v_snapshot := jsonb_set(v_snapshot,'{canonicalIdentity,capacity}',
    to_jsonb('1.5 Quart'::text),true);
  v_snapshot := jsonb_set(v_snapshot,'{userFields}',v_user_fields,true);
  v_snapshot := jsonb_set(v_snapshot,'{userFieldsHash}',
    to_jsonb(v_user_fields_hash),true);
  v_snapshot := jsonb_set(v_snapshot,'{gates}',v_gates,true);
  v_snapshot := jsonb_set(v_snapshot,'{blockers}','[]'::jsonb,true);
  v_snapshot := jsonb_set(v_snapshot,'{taxonomy}',jsonb_build_object(
    'status','AVAILABLE',
    'source','EBAY_TAXONOMY_OFFICIAL_READONLY',
    'categoryId','20636',
    'categoryTreeId',v_taxonomy_payload->>'categoryTreeId',
    'categoryTreeVersion',v_taxonomy_payload->>'categoryTreeVersion',
    'observedAt',v_taxonomy_payload->>'observedAt',
    'requiredAspectNames',(
      select coalesce(jsonb_agg(aspect->>'name' order by aspect->>'name'),'[]'::jsonb)
      from jsonb_array_elements(v_taxonomy_payload->'requiredAspects') aspect
    ),
    'validatedItemSpecifics',v_after_aspects,
    'gtin','036588083005',
    'condition','New'
  ),true);
  v_snapshot := jsonb_set(v_snapshot,'{gateSources}',v_gate_sources,true);
  v_snapshot := jsonb_set(v_snapshot,'{opportunityValidation}',jsonb_build_object(
    'status',v_opportunity_status,
    'candidateId',v_candidate.id,
    'legacyQueueGatesActive',false
  ),true);
  v_snapshot := jsonb_set(v_snapshot,'{marketDemandValidation}',jsonb_build_object(
    'status',v_market_status,
    'equivalentMarketDataStatus',
      v_candidate.product_facts_summary#>>'{marketPricing,status}',
    'controlledExploratoryTestApproved',true,
    'operatorPriceApproved',true,
    'syntheticCompletionUsed',false
  ),true);
  v_snapshot := jsonb_set(v_snapshot,'{packagePreparation}',jsonb_build_object(
    'percent',100,
    'blocked',false,
    'gateDetails',v_gate_details,
    'legacyV2VisualBlockersActive',false
  ),true);
  v_snapshot := jsonb_set(v_snapshot,'{visualGateSource}',
    to_jsonb(v_visual_source),true);
  v_snapshot := jsonb_set(v_snapshot,'{legacyV2VisualBlockersActive}',
    'false'::jsonb,true);
  v_snapshot := jsonb_set(v_snapshot,'{exactPreviewCreated}','true'::jsonb,true);
  v_snapshot := jsonb_set(v_snapshot,
    '{readyForUnpublishedOfferAuthorization}','true'::jsonb,true);
  v_snapshot := jsonb_set(v_snapshot,'{authorizationEnabled}','false'::jsonb,true);

  v_preview_hash := encode(extensions.digest(
    convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
  insert into public.ebay_reference_guided_final_listing_review_previews(
    revision_id,attempt_id,listing_package_id,final_set_event_id,final_set_hash,
    listing_package_updated_at,user_fields_hash,preview_snapshot,preview_hash,
    gates,blockers,visual_phase,final_visual_set_locked,generation_controls_hidden,
    ready_for_unpublished_offer_authorization,authorization_enabled,
    inventory_item_created,offer_created,offer_status,ebay_writes,
    production_changed,provider_calls_snapshot,created_by
  ) values(
    p_revision_id,p_attempt_id,v_package.id,v_prior.final_set_event_id,
    v_prior.final_set_hash,v_package.updated_at,v_user_fields_hash,v_snapshot,
    v_preview_hash,v_gates,'{}'::text[],'COMPLETED',true,true,true,false,
    false,false,'NOT_CREATED',0,false,8,v_revision.created_by
  ) returning * into v_new_preview;

  insert into public.ebay_reference_guided_final_listing_reconciliation_events(
    revision_id,attempt_id,listing_package_id,prior_preview_id,
    reconciled_preview_id,taxonomy_cache_id,title_before,title_after,
    item_specifics_before,item_specifics_after,gate_sources,
    opportunity_validation_status,market_demand_validation_status,
    package_preparation_percent,visual_gate_source,
    legacy_v2_visual_blockers_active,user_fields_preserved,
    provider_calls_snapshot,inventory_item_created,offer_created,ebay_writes,
    production_changed,created_by
  ) values(
    p_revision_id,p_attempt_id,v_package.id,v_prior.id,v_new_preview.id,
    v_taxonomy.id,v_before->>'title',v_title,v_before_aspects,v_after_aspects,
    v_gate_sources,v_opportunity_status,v_market_status,100,v_visual_source,
    false,true,8,false,false,0,false,v_revision.created_by
  ) returning * into v_event;

  return query select v_event.id,v_new_preview.id,v_new_preview.preview_hash,
    v_title,length(v_title),true,true,true,v_opportunity_status,v_market_status,
    100,true,'{}'::text[];
end;
$$;

revoke all on function public.reconcile_calypso_v3_final_listing_review(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.reconcile_calypso_v3_final_listing_review(uuid,uuid)
  to service_role;

notify pgrst,'reload schema';
