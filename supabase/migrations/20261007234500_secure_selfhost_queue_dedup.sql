drop policy if exists seller_os_queue_dispatch_dedup_service_role
  on public.seller_os_queue_dispatch_dedup;
create policy seller_os_queue_dispatch_dedup_service_role
  on public.seller_os_queue_dispatch_dedup
  for all
  to service_role
  using (true)
  with check (true);
