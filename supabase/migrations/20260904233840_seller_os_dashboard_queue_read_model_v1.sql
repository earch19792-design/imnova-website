-- Narrow, automatically maintained read-model fields for owner dashboards.
-- These columns prevent every status refresh from detoasting the multi-MB
-- assessment evidence. They are derived from the same durable authority and
-- cannot diverge from it.
alter table public.ebay_luna_opportunity_queue
  add column if not exists dashboard_is_quick_pick boolean
    generated always as (
      jsonb_typeof(assessment -> 'lunaQuickPickOperationV1') = 'object'
      and assessment -> 'lunaQuickPickOperationV1' <> '{}'::jsonb
    ) stored,
  add column if not exists dashboard_is_radar_candidate boolean
    generated always as (
      jsonb_typeof(assessment -> 'radarFactoryCandidateV1') = 'object'
      and assessment -> 'radarFactoryCandidateV1' <> '{}'::jsonb
    ) stored,
  add column if not exists dashboard_radar_family_id text
    generated always as (
      assessment #>> '{radarToQuickPickHandoffV1,radarFamilyId}'
    ) stored,
  add column if not exists dashboard_radar_luna_sku text
    generated always as (
      assessment #>> '{radarToQuickPickHandoffV1,lunaSku}'
    ) stored,
  add column if not exists dashboard_quick_pick_operation_id text
    generated always as (
      assessment #>> '{radarToQuickPickHandoffV1,quickPickOperationId}'
    ) stored;

comment on column public.ebay_luna_opportunity_queue.dashboard_is_quick_pick
  is 'Generated owner read-model projection; assessment remains canonical.';
comment on column public.ebay_luna_opportunity_queue.dashboard_is_radar_candidate
  is 'Generated owner read-model projection; assessment remains canonical.';
comment on column public.ebay_luna_opportunity_queue.dashboard_radar_family_id
  is 'Generated Radar handoff projection for narrow dashboard reads.';
comment on column public.ebay_luna_opportunity_queue.dashboard_radar_luna_sku
  is 'Generated Radar handoff projection for narrow dashboard reads.';
comment on column public.ebay_luna_opportunity_queue.dashboard_quick_pick_operation_id
  is 'Generated Radar handoff projection for narrow dashboard reads.';
