-- Preserve eBay's authorized retry boundary for the two-speed Seller OS scanner.
-- A quota pause is neither task completion nor task failure; the original
-- Retry-After checkpoint remains append-only in ebay_api_quota_events.

alter table public.ebay_api_quota_events
  add column if not exists retry_after_source text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ebay_api_quota_events_retry_after_source_check'
      and conrelid = 'public.ebay_api_quota_events'::regclass
  ) then
    alter table public.ebay_api_quota_events
      add constraint ebay_api_quota_events_retry_after_source_check
      check (retry_after_source is null or retry_after_source in (
        'RETRY_AFTER_SECONDS',
        'RETRY_AFTER_HTTP_DATE',
        'UNAVAILABLE'
      ));
  end if;
end
$$;

create or replace function public.pause_ebay_seller_scan_tasks_for_quota(
  p_task_ids uuid[],
  p_worker_id text,
  p_resume_at timestamptz,
  p_reason_code text default 'EBAY_READONLY_GET_429'
)
returns setof public.ebay_seller_scan_tasks
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(array_length(p_task_ids, 1), 0) = 0 then
    raise exception 'TASK_IDS_REQUIRED';
  end if;
  if nullif(trim(p_worker_id), '') is null then
    raise exception 'WORKER_ID_REQUIRED';
  end if;
  if p_resume_at is null then
    raise exception 'QUOTA_RESUME_AT_REQUIRED';
  end if;

  return query
  update public.ebay_seller_scan_tasks task
  set status = 'retry',
      -- Keep the exact eBay-authorized instant. claim_ebay_seller_scan_tasks
      -- already requires due_at <= now(), so no worker can reclaim it early.
      due_at = p_resume_at,
      attempts = greatest(task.attempts - 1, 0),
      lease_owner = null,
      lease_expires_at = null,
      last_error_code = left(coalesce(nullif(trim(p_reason_code), ''), 'EBAY_READONLY_GET_429'), 120),
      last_error_detail = null,
      updated_at = now()
  where task.id = any(p_task_ids)
    and task.status = 'leased'
    and task.lease_owner = trim(p_worker_id)
  returning task.*;
end;
$$;

revoke all on function public.pause_ebay_seller_scan_tasks_for_quota(
  uuid[], text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.pause_ebay_seller_scan_tasks_for_quota(
  uuid[], text, timestamptz, text
) to service_role;

comment on function public.pause_ebay_seller_scan_tasks_for_quota(
  uuid[], text, timestamptz, text
) is 'Releases scanner leases at the exact persisted eBay quota resume time without completing, failing, or consuming an attempt.';

notify pgrst, 'reload schema';
