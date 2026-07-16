-- Ensure every real POST generation invalidates absence evidence from a prior
-- generation. This prevents a previously reconciled absence from authorizing a
-- retry after a newer ambiguous POST.

create or replace function public.guard_fulfillment_real_post_generation_v1b()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.adapter = 'ebay_real' and new.post_count > old.post_count then
    new.post_started_at := clock_timestamp();
    new.absence_confirmed_at := null;
  end if;
  return new;
end;
$$;

create trigger marketplace_fulfillment_real_post_generation_v1b
before update on public.marketplace_fulfillment_submission_outbox
for each row execute function public.guard_fulfillment_real_post_generation_v1b();

revoke all on function public.guard_fulfillment_real_post_generation_v1b()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
