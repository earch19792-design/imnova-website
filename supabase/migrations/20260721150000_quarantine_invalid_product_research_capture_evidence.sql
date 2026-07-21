-- Quarantine Product Research rows whose sold date cannot belong to the
-- authorized visible window. Preserve every original row for audit, but make
-- invalid evidence ineligible for commercial decisions and return active
-- same-day candidates to a fresh, operator-authorized capture.

alter table public.marketplace_product_research_capture_observations
  add column if not exists quality_status text not null default 'VALID',
  add column if not exists quality_reason_codes text[] not null default '{}';

alter table public.marketplace_product_research_capture_observations
  drop constraint if exists marketplace_product_research_capture_observations_review_check;

alter table public.marketplace_product_research_capture_observations
  drop constraint if exists marketplace_product_research_capture_observations_quality_check;
alter table public.marketplace_product_research_capture_observations
  add constraint marketplace_product_research_capture_observations_quality_check check (
    (quality_status = 'VALID' and evidence_reviewed = true
      and cardinality(quality_reason_codes) = 0)
    or
    (quality_status = 'QUARANTINED' and evidence_reviewed = false
      and cardinality(quality_reason_codes) > 0)
  );

update public.marketplace_product_research_capture_observations observation
set evidence_reviewed = false,
    quality_status = 'QUARANTINED',
    quality_reason_codes = array['LAST_SOLD_DATE_OUTSIDE_CAPTURE_WINDOW']::text[]
from public.marketplace_product_research_capture_batches batch
where batch.id = observation.capture_batch_id
  and observation.quality_status = 'VALID'
  and (
    observation.last_sold_date < batch.captured_at - interval '92 days'
    or observation.last_sold_date > batch.captured_at + interval '1 day'
  );

create index if not exists marketplace_product_research_capture_reviewed_target_idx
  on public.marketplace_product_research_capture_observations(
    marketplace_account_key, marketplace, matched_supplier_variant_id, last_sold_date desc
  ) where evidence_reviewed = true and quality_status = 'VALID';

create temporary table product_research_quality_recovery_candidates
on commit drop as
select
  candidate.id as candidate_id,
  candidate.run_id,
  candidate.machine_state as previous_state,
  candidate.product_research_capture_batch_id as quarantined_batch_id,
  candidate.ordinal,
  candidate.product_title,
  candidate.product_research_query_plan,
  query_task.id as query_task_id,
  query_task.plan_id
from public.ebay_same_day_pilot_candidates candidate
left join public.marketplace_product_research_query_tasks query_task
  on query_task.capture_batch_id = candidate.product_research_capture_batch_id
where candidate.product_research_capture_batch_id in (
  select distinct observation.capture_batch_id
  from public.marketplace_product_research_capture_observations observation
  where observation.quality_status = 'QUARANTINED'
)
and candidate.machine_state not in (
  'REJECTED','BLOCKED','READY_FOR_MANUAL_PUBLICATION','WAITING_ITEM_ID',
  'VERIFYING_PUBLISHED_LISTING','REGISTERING_COMMERCIAL_MONITOR',
  'VERIFIED_ACTIVE','COMPLETED'
);

update public.ebay_same_day_pilot_human_tasks task
set status = 'SUPERSEDED',
    completed_at = clock_timestamp(),
    updated_at = clock_timestamp()
from product_research_quality_recovery_candidates recovery
where task.candidate_id = recovery.candidate_id
  and task.status = 'OPEN';

update public.ebay_same_day_pilot_jobs job
set status = 'CANCELLED',
    lease_owner = null,
    lease_expires_at = null,
    last_error_code = 'PRODUCT_RESEARCH_EVIDENCE_QUARANTINED',
    updated_at = clock_timestamp()
from product_research_quality_recovery_candidates recovery
where job.candidate_id = recovery.candidate_id
  and job.status in ('PENDING','LEASED','WAITING_RETRY');

insert into public.ebay_same_day_pilot_transitions(
  run_id,candidate_id,previous_state,next_state,reason_code,triggered_by,
  started_at,completed_at,attempt,checkpoint,evidence_hash,idempotency_key,
  next_automatic_action,next_human_action
)
select
  recovery.run_id,
  recovery.candidate_id,
  recovery.previous_state,
  'PRODUCT_RESEARCH_PLAN_READY',
  'PRODUCT_RESEARCH_EVIDENCE_QUARANTINED',
  'SYSTEM',
  clock_timestamp(),
  clock_timestamp(),
  1,
  jsonb_build_object(
    'quarantinedBatchId', recovery.quarantined_batch_id,
    'reasonCode', 'LAST_SOLD_DATE_OUTSIDE_CAPTURE_WINDOW',
    'originalRowsPreserved', true,
    'ebayWrites', 0
  ),
  encode(digest(
    recovery.candidate_id::text || ':PRODUCT_RESEARCH_EVIDENCE_QUARANTINED_V1',
    'sha256'
  ), 'hex'),
  recovery.run_id::text || ':' || recovery.candidate_id::text ||
    ':PRODUCT_RESEARCH_EVIDENCE_QUARANTINED_V1',
  'Esperar una captura nueva con la extensión validada.',
  'Recapturar la consulta visible de Product Research.'
from product_research_quality_recovery_candidates recovery
on conflict (idempotency_key) do nothing;

update public.marketplace_product_research_query_tasks task
set status = 'PENDING',
    capture_batch_id = null,
    captured_at = null,
    processed_at = null,
    last_error_code = 'CAPTURE_EVIDENCE_QUARANTINED',
    updated_at = clock_timestamp()
from product_research_quality_recovery_candidates recovery
where task.id = recovery.query_task_id;

update public.marketplace_product_research_query_plans plan
set status = 'ACTIVE',
    completed_at = null,
    updated_at = clock_timestamp()
where plan.id in (
  select distinct recovery.plan_id
  from product_research_quality_recovery_candidates recovery
  where recovery.plan_id is not null
);

update public.ebay_same_day_pilot_candidates candidate
set state = 'NEEDS_PRODUCT_RESEARCH_CAPTURE',
    machine_state = 'PRODUCT_RESEARCH_PLAN_READY',
    blockers = '{}',
    product_research_capture_batch_id = null,
    product_research_query_plan = candidate.product_research_query_plan ||
      case when recovery.plan_id is null then '{}'::jsonb
        else jsonb_build_object('productResearchPlanId', recovery.plan_id) end,
    evidence_summary = (
      candidate.evidence_summary
        - 'exactSoldMarketReference'
        - 'exactSoldMarketReferenceReconciledAt'
        - 'exactSoldMarketReferenceSource'
        - 'commercialEvidenceHash'
        - 'controlledTestPlan'
        - 'captureCandidateReferencesPendingReconciliation'
    ) || jsonb_build_object(
      'productResearchQualityStatus', 'RECAPTURE_REQUIRED',
      'productResearchQualityReasonCodes',
        jsonb_build_array('LAST_SOLD_DATE_OUTSIDE_CAPTURE_WINDOW'),
      'quarantinedProductResearchBatchId', recovery.quarantined_batch_id,
      'historicalMarketCheckStatus', 'RECAPTURE_REQUIRED_DATA_QUALITY',
      'historicalMarketCheckedAt', null,
      'commercialEvidenceMode', 'UNAVAILABLE_PENDING_RECAPTURE',
      'soldExactCount', 0,
      'evidenceTiers', jsonb_build_object(
        'exactIdentityMatches', 0,
        'confirmedSoldExact', 0,
        'confirmedSoldRelatedPack', 0,
        'confirmedSoldRelatedSize', 0,
        'broadSearchOnlyPromoted', false
      )
    ),
    economics_summary = (
      candidate.economics_summary
        - 'pricingRecommendation'
        - 'recommendedSalePrice'
        - 'operatorApprovedSalePrice'
        - 'operatorPriceApproved'
    ) || jsonb_build_object(
      'ready', false,
      'status', 'PRODUCT_RESEARCH_RECAPTURE_REQUIRED',
      'automaticPricingRecommendationUsed', false,
      'competitorPriceUsedForRecommendation', false
    ),
    product_facts_summary = (
      candidate.product_facts_summary
        - 'marketPricing'
        - 'pricingRecommendation'
    ) || jsonb_build_object(
      'status', 'STALE_PRODUCT_RESEARCH_RECAPTURE_REQUIRED',
      'marketPricing', jsonb_build_object(
        'status', 'RECAPTURE_REQUIRED_DATA_QUALITY',
        'cohorts', jsonb_build_array()
      )
    ),
    next_automated_action = 'Esperar una captura nueva con la extensión validada.',
    next_human_action = 'Recapturar la consulta visible de Product Research.',
    updated_at = clock_timestamp()
from product_research_quality_recovery_candidates recovery
where candidate.id = recovery.candidate_id;

with first_recovery as (
  select distinct on (recovery.run_id)
    recovery.run_id,recovery.candidate_id,recovery.plan_id
  from product_research_quality_recovery_candidates recovery
  order by recovery.run_id,recovery.ordinal
)
update public.ebay_same_day_pilot_runs run
set status = 'ACTIVE',
    stage = 'PRODUCT_RESEARCH_RECAPTURE_REQUIRED',
    source_inventory = run.source_inventory || jsonb_build_object(
      'productResearchPlanId', recovery.plan_id,
      'productResearchPlanActivatedForCandidateId', recovery.candidate_id,
      'productResearchQualityRecoveryVersion',
        'PRODUCT_RESEARCH_CAPTURE_QUALITY_RECOVERY_V1_2026_07_21',
      'productResearchQualityRecoveredAt', clock_timestamp()
    ),
    next_automated_action = 'Procesar las capturas corregidas sin repetir Discovery.',
    next_human_action = 'Recapturar la consulta visible indicada por Seller OS.',
    updated_at = clock_timestamp()
from first_recovery recovery
where run.id = recovery.run_id;

notify pgrst, 'reload schema';
