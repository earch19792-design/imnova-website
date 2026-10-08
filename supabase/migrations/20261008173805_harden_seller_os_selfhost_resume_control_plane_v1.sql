create index if not exists seller_os_selfhost_job_runs_session_v1
  on public.seller_os_selfhost_runtime_job_runs_v1 (
    session_id, updated_at desc
  );

create policy seller_os_selfhost_runtime_sessions_deny_direct_v1
  on public.seller_os_selfhost_runtime_sessions_v1
  as restrictive
  for all
  to public
  using (false)
  with check (false);

create policy seller_os_selfhost_runtime_job_runs_deny_direct_v1
  on public.seller_os_selfhost_runtime_job_runs_v1
  as restrictive
  for all
  to public
  using (false)
  with check (false);

comment on policy seller_os_selfhost_runtime_sessions_deny_direct_v1
  on public.seller_os_selfhost_runtime_sessions_v1 is
  'No direct Data API access. Service-only security-definer functions own access.';
comment on policy seller_os_selfhost_runtime_job_runs_deny_direct_v1
  on public.seller_os_selfhost_runtime_job_runs_v1 is
  'No direct Data API access. Service-only security-definer functions own access.';
