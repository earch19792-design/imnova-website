-- Append-only correction of reader-facing gate-source attribution. The prior
-- exact preview remains immutable evidence; no listing field or eBay object is
-- changed.

create table if not exists public.ebay_reference_guided_final_listing_gate_source_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  prior_preview_id uuid not null
    references public.ebay_reference_guided_final_listing_review_previews(id),
  corrected_preview_id uuid not null
    references public.ebay_reference_guided_final_listing_review_previews(id),
  correction_type text not null check (
    correction_type = 'PERSISTED_GATE_SOURCE_ATTRIBUTION_FIX'
  ),
  provider_calls_snapshot integer not null check (provider_calls_snapshot = 8),
  ebay_writes integer not null check (ebay_writes = 0),
  production_changed boolean not null check (not production_changed),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (attempt_id)
);

drop trigger if exists ebay_reference_guided_final_listing_gate_source_append_only
  on public.ebay_reference_guided_final_listing_gate_source_events;
create trigger ebay_reference_guided_final_listing_gate_source_append_only
before update or delete
  on public.ebay_reference_guided_final_listing_gate_source_events
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

alter table public.ebay_reference_guided_final_listing_gate_source_events
  enable row level security;
alter table public.ebay_reference_guided_final_listing_gate_source_events
  force row level security;
revoke all on table public.ebay_reference_guided_final_listing_gate_source_events
  from public,anon,authenticated,service_role;
grant select,insert
  on table public.ebay_reference_guided_final_listing_gate_source_events
  to service_role;

create or replace function public.correct_calypso_final_listing_gate_sources(
  p_attempt_id uuid
) returns table(
  correction_event_id uuid,
  preview_id uuid,
  preview_hash text
)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_prior public.ebay_reference_guided_final_listing_review_previews%rowtype;
  v_corrected public.ebay_reference_guided_final_listing_review_previews%rowtype;
  v_existing public.ebay_reference_guided_final_listing_gate_source_events%rowtype;
  v_snapshot jsonb;
  v_gate_sources jsonb;
  v_gate_details jsonb;
  v_preview_hash text;
  v_event public.ebay_reference_guided_final_listing_gate_source_events%rowtype;
begin
  if p_attempt_id <> 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid then
    raise exception 'FINAL_LISTING_GATE_SOURCE_SCOPE_INVALID';
  end if;
  select event.* into v_existing
  from public.ebay_reference_guided_final_listing_gate_source_events event
  where event.attempt_id = p_attempt_id;
  if v_existing.id is not null then
    select preview.* into v_corrected
    from public.ebay_reference_guided_final_listing_review_previews preview
    where preview.id = v_existing.corrected_preview_id;
    return query select v_existing.id,v_corrected.id,v_corrected.preview_hash;
    return;
  end if;

  select preview.* into v_prior
  from public.ebay_reference_guided_final_listing_review_previews preview
  where preview.attempt_id = p_attempt_id
  order by preview.created_at desc limit 1 for share;
  if v_prior.id is null or v_prior.provider_calls_snapshot <> 8
    or v_prior.ebay_writes <> 0 or v_prior.production_changed
    or v_prior.inventory_item_created or v_prior.offer_created
    or v_prior.authorization_enabled
    or cardinality(v_prior.blockers) <> 0
    or v_prior.preview_snapshot->>'version' <>
      'CALYPSO_FINAL_LISTING_REVIEW_V2' then
    raise exception 'FINAL_LISTING_GATE_SOURCE_PREVIEW_INVALID';
  end if;
  v_gate_sources := v_prior.preview_snapshot->'gateSources';
  if coalesce(v_gate_sources->>'visual','') = ''
    or coalesce(v_gate_sources->>'taxonomy','') = ''
    or coalesce(v_gate_sources->>'opportunity','') = ''
    or coalesce(v_gate_sources->>'marketDemand','') = ''
    or coalesce(v_gate_sources->>'luna','') = ''
    or coalesce(v_gate_sources->>'policies','') = ''
    or coalesce(v_gate_sources->>'package','') = '' then
    raise exception 'FINAL_LISTING_GATE_SOURCE_MAP_INCOMPLETE';
  end if;

  v_gate_details := (
    select jsonb_agg(jsonb_build_object(
      'gate',entry.key,
      'passed',entry.value,
      'source',case
        when entry.key in (
          'visualFinalSetAtomic','legacyV2VisualBlockersInactive',
          'sevenImageOrderValid','position6StatusConsistent'
        ) then v_gate_sources->>'visual'
        when entry.key in (
          'taxonomyFetched','categoryValid','itemSpecificsValid'
        ) then v_gate_sources->>'taxonomy'
        when entry.key = 'opportunityValidationCurrent'
          then v_gate_sources->>'opportunity'
        when entry.key = 'marketDemandControlledRouteValid'
          then v_gate_sources->>'marketDemand'
        when entry.key in ('lunaCostFresh','lunaStockFresh')
          then v_gate_sources->>'luna'
        when entry.key in ('policiesValid','merchantLocationValid')
          then v_gate_sources->>'policies'
        else v_gate_sources->>'package'
      end
    ) order by entry.key)
    from jsonb_each(v_prior.gates) entry
  );
  if (
    select count(*) from jsonb_array_elements(v_gate_details) detail
    where detail->>'source' = v_gate_sources->>'visual'
  ) < 4 or (
    select count(*) from jsonb_array_elements(v_gate_details) detail
    where detail->>'source' = v_gate_sources->>'opportunity'
  ) <> 1 or (
    select count(*) from jsonb_array_elements(v_gate_details) detail
    where detail->>'source' = v_gate_sources->>'marketDemand'
  ) <> 1 then
    raise exception 'FINAL_LISTING_GATE_SOURCE_ATTRIBUTION_INVALID';
  end if;

  v_snapshot := jsonb_set(
    v_prior.preview_snapshot,
    '{packagePreparation,gateDetails}',
    v_gate_details,
    false
  );
  v_snapshot := jsonb_set(
    v_snapshot,
    '{gateSourceAttributionVersion}',
    to_jsonb('CALYPSO_GATE_SOURCE_ATTRIBUTION_V2'::text),
    true
  );
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
    v_prior.revision_id,v_prior.attempt_id,v_prior.listing_package_id,
    v_prior.final_set_event_id,v_prior.final_set_hash,
    v_prior.listing_package_updated_at,v_prior.user_fields_hash,v_snapshot,
    v_preview_hash,v_prior.gates,v_prior.blockers,v_prior.visual_phase,
    v_prior.final_visual_set_locked,v_prior.generation_controls_hidden,
    v_prior.ready_for_unpublished_offer_authorization,false,false,false,
    'NOT_CREATED',0,false,8,v_prior.created_by
  ) returning * into v_corrected;

  insert into public.ebay_reference_guided_final_listing_gate_source_events(
    attempt_id,prior_preview_id,corrected_preview_id,correction_type,
    provider_calls_snapshot,ebay_writes,production_changed,created_by
  ) values(
    p_attempt_id,v_prior.id,v_corrected.id,
    'PERSISTED_GATE_SOURCE_ATTRIBUTION_FIX',8,0,false,v_prior.created_by
  ) returning * into v_event;
  return query select v_event.id,v_corrected.id,v_corrected.preview_hash;
end;
$$;

revoke all on function public.correct_calypso_final_listing_gate_sources(uuid)
  from public,anon,authenticated;
grant execute on function public.correct_calypso_final_listing_gate_sources(uuid)
  to service_role;

notify pgrst,'reload schema';
