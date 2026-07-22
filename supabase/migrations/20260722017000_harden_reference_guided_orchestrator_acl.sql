-- Idempotent ACL hardening for installations where the V3 orchestrator tables
-- already exist. This migration changes no attempt/job data and invokes no
-- provider, Storage or eBay operation.

alter table public.ebay_reference_guided_generation_attempts enable row level security;
alter table public.ebay_reference_guided_generation_attempts force row level security;
alter table public.ebay_reference_guided_generation_jobs enable row level security;
alter table public.ebay_reference_guided_generation_jobs force row level security;

revoke all on table public.ebay_reference_guided_generation_attempts from anon, authenticated;
revoke all on table public.ebay_reference_guided_generation_attempts from public;
revoke all on table public.ebay_reference_guided_generation_jobs from anon, authenticated;
revoke all on table public.ebay_reference_guided_generation_jobs from public;
revoke all on table public.ebay_reference_guided_generation_attempts from service_role;
revoke all on table public.ebay_reference_guided_generation_jobs from service_role;

grant select, insert, update on table public.ebay_reference_guided_generation_attempts to service_role;
grant select, insert, update on table public.ebay_reference_guided_generation_jobs to service_role;

revoke all on function public.create_ebay_reference_guided_generation_attempt(
  uuid, text, text[], text, text, text[], text, text
) from public, anon, authenticated;
revoke all on function public.claim_ebay_reference_guided_generation_jobs(
  uuid, text, text, integer, boolean
) from public, anon, authenticated;
grant execute on function public.create_ebay_reference_guided_generation_attempt(
  uuid, text, text[], text, text, text[], text, text
) to service_role;
grant execute on function public.claim_ebay_reference_guided_generation_jobs(
  uuid, text, text, integer, boolean
) to service_role;

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and roles && array['anon'::name, 'authenticated'::name, 'public'::name]
      and (
        qual ilike '%ebay-listing-image-sources%'
        or with_check ilike '%ebay-listing-image-sources%'
        or qual ilike '%ebay-listing-image-staging%'
        or with_check ilike '%ebay-listing-image-staging%'
      )
  ) then
    raise exception 'REFERENCE_GUIDED_STORAGE_CLIENT_POLICY_FORBIDDEN';
  end if;
end;
$$;

notify pgrst, 'reload schema';
