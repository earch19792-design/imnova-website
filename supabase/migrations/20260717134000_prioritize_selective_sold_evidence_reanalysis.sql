-- Additive priority for selective Product Research sold-evidence reanalysis.
-- This prevents a new sold-evidence version from reopening unrelated completed
-- candidates. No competitor content, PII, secret, OpenAI call, or eBay write.

alter table public.marketplace_listing_approval_queue_scan_targets
  add column if not exists evidence_reanalysis_priority smallint not null default 0,
  add column if not exists evidence_reanalysis_version text null,
  add column if not exists evidence_reanalysis_requested_at timestamptz null,
  add column if not exists evidence_reanalysis_completed_at timestamptz null;

alter table public.marketplace_listing_approval_queue_scan_targets
  add constraint marketplace_listing_approval_queue_targets_evidence_priority_check
    check (evidence_reanalysis_priority between 0 and 100),
  add constraint marketplace_listing_approval_queue_targets_evidence_version_check
    check (evidence_reanalysis_version is null or
      evidence_reanalysis_version ~ '^sha256:[0-9a-f]{64}$'),
  add constraint marketplace_listing_approval_queue_targets_evidence_timestamps_check
    check (evidence_reanalysis_completed_at is null or
      evidence_reanalysis_requested_at is null or
      evidence_reanalysis_completed_at >= evidence_reanalysis_requested_at);

create index if not exists marketplace_listing_approval_queue_targets_evidence_priority_idx
  on public.marketplace_listing_approval_queue_scan_targets(
    run_id, evidence_reanalysis_priority desc, status, next_retry_at, ordinal
  ) where evidence_reanalysis_priority > 0;

create or replace function public.claim_marketplace_listing_top20_targets(
  p_run_id uuid,
  p_marketplace_account_key text,
  p_worker_id text,
  p_limit integer,
  p_now timestamptz default now()
)
returns setof public.marketplace_listing_approval_queue_scan_targets
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_limit < 1 or p_limit > 10 or length(trim(p_worker_id)) < 8 then
    raise exception 'TOP20_TARGET_CLAIM_INPUT_INVALID';
  end if;

  return query
  with candidates as (
    select target.id
    from public.marketplace_listing_approval_queue_scan_targets target
    join public.marketplace_listing_approval_queue_runs run on run.id = target.run_id
    where target.run_id = p_run_id
      and target.marketplace_account_key = p_marketplace_account_key
      and target.marketplace = 'EBAY_US'
      and (
        (run.scan_phase = 'DISCOVERY' and target.status = 'PENDING')
        or (run.scan_phase = 'LOOP1_ANALYSIS' and target.status = 'PRESELECTED')
        or (target.status = 'RETRY_REQUIRED' and coalesce(target.next_retry_at, p_now) <= p_now)
        or (target.status = 'CLAIMED' and target.lease_expires_at <= p_now)
      )
    order by
      target.evidence_reanalysis_priority desc,
      case target.discovery_strategy when 'EBAY_FIRST' then 0 else 1 end,
      target.ebay_first_rank nulls last,
      case target.source_priority
        when 'RADAR_TOP5' then 0
        when 'PRIOR_INTELLIGENCE' then 1
        else 2
      end,
      target.ordinal
    for update skip locked
    limit p_limit
  )
  update public.marketplace_listing_approval_queue_scan_targets target
  set status = 'CLAIMED',
      processing_phase = (select run.scan_phase
        from public.marketplace_listing_approval_queue_runs run where run.id = target.run_id),
      attempt_count = target.attempt_count + 1,
      lease_owner = p_worker_id,
      lease_expires_at = p_now + interval '5 minutes',
      claimed_at = p_now,
      updated_at = p_now
  from candidates
  where target.id = candidates.id
  returning target.*;
end;
$$;

revoke all on function public.claim_marketplace_listing_top20_targets(uuid,text,text,integer,timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_marketplace_listing_top20_targets(uuid,text,text,integer,timestamptz)
  to service_role;

notify pgrst, 'reload schema';
