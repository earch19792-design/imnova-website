-- Additive, sanitized eBay read-rate-limit state for the Preview/staging Top 20
-- scanner. No response body, URL, token, header value, PII, or marketplace write
-- is stored. Retry-After is normalized to an integer duration only.

alter table public.marketplace_listing_approval_queue_runs
  add column if not exists rate_limit_consecutive_count integer not null default 0,
  add column if not exists last_rate_limit_retry_after_seconds integer null,
  add column if not exists last_rate_limit_backoff_seconds integer null,
  add column if not exists last_rate_limit_source text null,
  add column if not exists last_rate_limit_observed_at timestamptz null;

alter table public.marketplace_listing_approval_queue_runs
  add constraint marketplace_listing_approval_queue_runs_rate_limit_count_check
    check (rate_limit_consecutive_count between 0 and 20),
  add constraint marketplace_listing_approval_queue_runs_retry_after_check
    check (last_rate_limit_retry_after_seconds is null or
      last_rate_limit_retry_after_seconds between 0 and 604800),
  add constraint marketplace_listing_approval_queue_runs_backoff_check
    check (last_rate_limit_backoff_seconds is null or
      last_rate_limit_backoff_seconds between 1 and 604865),
  add constraint marketplace_listing_approval_queue_runs_rate_limit_source_check
    check (last_rate_limit_source is null or last_rate_limit_source in (
      'RETRY_AFTER_SECONDS','RETRY_AFTER_HTTP_DATE','ADAPTIVE_BACKOFF'
    ));

alter table public.marketplace_listing_approval_queue_scan_targets
  add column if not exists rate_limit_consecutive_count integer not null default 0,
  add column if not exists last_rate_limit_retry_after_seconds integer null,
  add column if not exists last_rate_limit_backoff_seconds integer null,
  add column if not exists last_rate_limit_source text null,
  add column if not exists last_rate_limit_observed_at timestamptz null;

alter table public.marketplace_listing_approval_queue_scan_targets
  add constraint marketplace_listing_approval_queue_targets_rate_limit_count_check
    check (rate_limit_consecutive_count between 0 and 20),
  add constraint marketplace_listing_approval_queue_targets_retry_after_check
    check (last_rate_limit_retry_after_seconds is null or
      last_rate_limit_retry_after_seconds between 0 and 604800),
  add constraint marketplace_listing_approval_queue_targets_backoff_check
    check (last_rate_limit_backoff_seconds is null or
      last_rate_limit_backoff_seconds between 1 and 604865),
  add constraint marketplace_listing_approval_queue_targets_rate_limit_source_check
    check (last_rate_limit_source is null or last_rate_limit_source in (
      'RETRY_AFTER_SECONDS','RETRY_AFTER_HTTP_DATE','ADAPTIVE_BACKOFF'
    ));

create index if not exists marketplace_listing_approval_queue_runs_rate_limit_idx
  on public.marketplace_listing_approval_queue_runs(
    marketplace_account_key, marketplace, next_continuation_at
  ) where automation_status = 'PAUSED_RATE_LIMIT';

create index if not exists marketplace_listing_approval_queue_targets_rate_limit_idx
  on public.marketplace_listing_approval_queue_scan_targets(
    marketplace_account_key, marketplace, next_retry_at
  ) where status = 'RETRY_REQUIRED';

notify pgrst, 'reload schema';
