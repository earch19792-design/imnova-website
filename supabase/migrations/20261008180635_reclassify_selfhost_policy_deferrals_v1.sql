-- A protected runtime HTTP 423 means the scheduler reached the commercial
-- lane and the lane intentionally deferred work behind an evidence/policy
-- gate (for example, the known eBay Trading quota reset). It is not a Docker
-- or scheduler execution failure. Align earlier receipts with that durable
-- orchestration meaning; the source blocker remains visible in the commercial
-- monitor evidence and TEO's data gaps.

update public.seller_os_selfhost_runtime_job_runs_v1
set status = 'SUCCEEDED',
    outcome_code = 'DEFERRED_POLICY_GATE',
    completed_at = coalesce(completed_at, clock_timestamp()),
    updated_at = clock_timestamp()
where job_name = 'commercial-monitor'
  and status = 'FAILED'
  and http_status = 423;
