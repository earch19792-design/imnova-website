-- The economic evidence control plane is service-role only. Explicit policies
-- document that boundary for the database linter while public/authenticated
-- grants remain revoked and FORCE RLS remains enabled.

create policy seller_os_live_economic_evidence_service_role_v1
on public.seller_os_live_economic_evidence_v1
for all to service_role using (true) with check (true);

create policy seller_os_economic_refresh_jobs_service_role_v1
on public.seller_os_economic_evidence_refresh_jobs_v1
for all to service_role using (true) with check (true);

create policy seller_os_live_economics_readbacks_service_role_v1
on public.seller_os_live_economics_readbacks_v1
for all to service_role using (true) with check (true);

create index seller_os_economic_refresh_last_evidence_v1_idx
on public.seller_os_economic_evidence_refresh_jobs_v1(last_evidence_id)
where last_evidence_id is not null;

notify pgrst, 'reload schema';
