-- Allow one same-day run to preserve successful listings while appending a
-- bounded number of replacement candidates. Runtime selection remains capped
-- at five candidates per replenishment and twenty batches (100 attempts).

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select constraint_definition.conname
    from pg_constraint as constraint_definition
    where constraint_definition.conrelid =
        'public.ebay_same_day_pilot_runs'::regclass
      and constraint_definition.contype = 'c'
      and (
        pg_get_constraintdef(constraint_definition.oid) like '%target_new_listings%'
        or pg_get_constraintdef(constraint_definition.oid) like '%queue_count%'
        or pg_get_constraintdef(constraint_definition.oid) like
          '%ready_for_manual_publication_count%'
        or pg_get_constraintdef(constraint_definition.oid) like
          '%verified_new_listings%'
      )
  loop
    execute format(
      'alter table public.ebay_same_day_pilot_runs drop constraint %I',
      constraint_row.conname
    );
  end loop;
end;
$$;

alter table public.ebay_same_day_pilot_runs
  add constraint ebay_pilot_run_target_new_listings_v2_check
    check (target_new_listings between 0 and 5),
  add constraint ebay_pilot_run_queue_count_v2_check
    check (queue_count between 0 and 100),
  add constraint ebay_pilot_run_ready_count_v2_check
    check (ready_for_manual_publication_count between 0 and 5),
  add constraint ebay_pilot_run_verified_count_v2_check
    check (verified_new_listings between 0 and 5);

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select constraint_definition.conname
    from pg_constraint as constraint_definition
    where constraint_definition.conrelid =
        'public.ebay_same_day_pilot_candidates'::regclass
      and constraint_definition.contype = 'c'
      and pg_get_constraintdef(constraint_definition.oid) like '%ordinal%'
  loop
    execute format(
      'alter table public.ebay_same_day_pilot_candidates drop constraint %I',
      constraint_row.conname
    );
  end loop;
end;
$$;

alter table public.ebay_same_day_pilot_candidates
  add constraint ebay_pilot_candidate_ordinal_v2_check
    check (ordinal between 1 and 100);

notify pgrst, 'reload schema';
