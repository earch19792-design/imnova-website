-- SELLER_OS_RETIRE_888LOTS_SUPPLIER_V1
-- The supplier is closing. Preserve history but prevent new sourcing use.

update public.market_radar_sources
set is_active = false,
  sourcing_metadata = coalesce(sourcing_metadata, '{}'::jsonb) ||
    jsonb_build_object(
      'supplierStatus', 'RETIRED',
      'retirementReason', 'SUPPLIER_CLOSING',
      'newRecommendationsAllowed', false,
      'supplierReadsAllowed', false,
      'historicalEvidencePreserved', true,
      'retiredAt', now()
    ),
  updated_at = now()
where key = '888lots';

comment on table public.market_radar_sources is
  'Canonical supplier sources. Retired sources remain for historical evidence but must not generate new recommendations.';
