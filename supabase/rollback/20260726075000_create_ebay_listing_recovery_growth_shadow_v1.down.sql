begin;

drop view if exists public.ebay_listing_recovery_dashboard_v1;

drop function if exists
  public.reconcile_commercial_improvement_outcome_v2(
    uuid, boolean, text, jsonb
  );
drop function if exists
  public.mark_commercial_improvement_uncertain_v2(uuid, uuid, text);
drop function if exists
  public.claim_commercial_improvement_execution_v2(uuid, text, integer);
drop function if exists
  public.finish_ebay_listing_recovery_shadow_run_v1(
    uuid, text, text, integer, integer, integer
  );
drop function if exists
  public.record_ebay_listing_recovery_shadow_error_v1(
    uuid, text, text, text, text
  );
drop function if exists
  public.record_ebay_listing_recovery_shadow_result_v1(
    uuid, text, uuid, text, text, text, text, integer, text,
    text, text, jsonb
  );
drop function if exists
  public.start_ebay_listing_recovery_shadow_run_v1(
    text, text, text, text, integer, integer
  );

alter table if exists public.ebay_commercial_improvement_executions
  drop constraint if exists ebay_commercial_improvement_experiment_fkey,
  drop constraint if exists ebay_commercial_improvement_rollback_fkey,
  drop column if exists experiment_id,
  drop column if exists claim_token,
  drop column if exists lease_expires_at,
  drop column if exists reconciled,
  drop column if exists reconciled_at,
  drop column if exists reconciliation_code,
  drop column if exists rollback_of_execution_id;

drop table if exists public.ebay_listing_recovery_learning_events;
drop table if exists public.ebay_listing_recovery_competitive_gap_reports;
drop table if exists public.commercial_experiment_snapshot_memberships;
drop table if exists public.commercial_experiment_controls;
drop table if exists public.ebay_listing_negotiation_eligibility_snapshots;
drop table if exists public.ebay_listing_marketing_snapshots;
drop table if exists public.ebay_listing_performance_baselines;
drop table if exists public.ebay_listing_recovery_diagnostics;
drop table if exists public.ebay_listing_recovery_state_transitions;
drop table if exists public.ebay_listing_recovery_run_items;
drop table if exists public.ebay_listing_recovery_cases;
drop table if exists public.ebay_listing_recovery_runs;
drop table if exists public.ebay_listing_recovery_configs;

drop function if exists
  public.reject_ebay_listing_recovery_immutable_change_v1();

alter table if exists public.listing_commercial_snapshots
  drop column if exists search_impressions,
  drop column if exists store_impressions,
  drop column if exists search_views,
  drop column if exists direct_views,
  drop column if exists external_views,
  drop column if exists other_ebay_views,
  drop column if exists store_views,
  drop column if exists analytics_last_updated_at,
  drop column if exists analytics_timezone,
  drop column if exists analytics_reconciliation_status,
  drop column if exists analytics_scope;

commit;
