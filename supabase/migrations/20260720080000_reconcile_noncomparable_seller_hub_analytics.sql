-- Preserve manual Seller Hub observations without treating unlike metric
-- families or time windows as a source contradiction. Official Traffic API
-- metrics remain the operational source unless equal-scope evidence differs.

alter table public.listing_commercial_manual_evidence
  add column if not exists entity_scope text not null default 'LISTING',
  add column if not exists ctr_metric text not null default
    'DERIVED_ORGANIC_LISTING_VIEWS_OVER_ORGANIC_IMPRESSIONS',
  add column if not exists ctr_unit text not null default 'PERCENT',
  add column if not exists window_start date null,
  add column if not exists window_end date null,
  add column if not exists time_zone text null;

alter table public.listing_commercial_manual_evidence
  drop constraint if exists listing_commercial_manual_evidence_context_check;

alter table public.listing_commercial_manual_evidence
  add constraint listing_commercial_manual_evidence_context_check check (
    entity_scope in ('LISTING', 'ACCOUNT', 'UNKNOWN')
    and ctr_unit in ('PERCENT', 'RATIO', 'UNKNOWN')
    and (
      (window_start is null and window_end is null)
      or (window_start is not null and window_end is not null and window_start <= window_end)
    )
  );

alter table public.listing_analytics_source_divergences
  add column if not exists comparison_details jsonb not null default '{}'::jsonb;

alter table public.listing_analytics_source_divergences
  drop constraint if exists listing_analytics_source_divergences_classification_check,
  drop constraint if exists listing_analytics_source_divergences_comparison_check;

alter table public.listing_analytics_source_divergences
  add constraint listing_analytics_source_divergences_classification_check check (
    classification in (
      'SELLER_HUB_LISTING_API_DISCREPANCY',
      'SOURCES_MATCH',
      'VERIFIED_EXPLANATION',
      'MANUAL_EVIDENCE_NOT_COMPARABLE',
      'INSUFFICIENT_EVIDENCE'
    )
  ),
  add constraint listing_analytics_source_divergences_comparison_check check (
    jsonb_typeof(comparison_details) = 'object'
  );

update public.listing_analytics_source_divergences as divergence
set
  classification = 'MANUAL_EVIDENCE_NOT_COMPARABLE',
  health_flag = 'RESOLVED',
  status = 'resolved',
  comparison_details = jsonb_build_object(
    'comparable', false,
    'reasonCodes', jsonb_build_array(
      'METRIC_MAPPING_MISMATCH',
      'WINDOW_MISSING',
      'TIME_ZONE_MISSING'
    )
  ),
  last_checked_at = clock_timestamp(),
  resolved_at = clock_timestamp(),
  resolution_code = 'MANUAL_EVIDENCE_NOT_COMPARABLE',
  verified_explanation = coalesce(
    divergence.verified_explanation,
    'La evidencia manual orgánica sin ventana no es comparable con métricas totales oficiales en una ventana UTC.'
  ),
  updated_at = clock_timestamp()
from public.listing_commercial_manual_evidence as manual
where divergence.manual_evidence_id = manual.id
  and divergence.status = 'open'
  and (
    manual.entity_scope <> 'LISTING'
    or manual.impressions_metric <> 'TOTAL_IMPRESSION_TOTAL'
    or manual.views_metric <> 'LISTING_VIEWS_TOTAL'
    or manual.transactions_metric <> 'TRANSACTION'
    or manual.ctr_metric <> 'CLICK_THROUGH_RATE'
    or manual.ctr_unit <> 'PERCENT'
    or manual.window_start is null
    or manual.window_end is null
    or manual.time_zone is null
    or manual.window_start is distinct from divergence.official_window_start
    or manual.window_end is distinct from divergence.official_window_end
    or manual.time_zone <> 'UTC'
  );

notify pgrst, 'reload schema';
