-- Validate the two previously NOT VALID active-listing constraints without
-- modifying or deleting any row. A violation aborts with an actionable count.

do $$
declare
  v_account_scope_violations bigint;
  v_generation_violations bigint;
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ebay_active_listings_account_scope_check'
      and conrelid = 'public.ebay_active_listings'::regclass
  ) then
    raise exception
      'EBAY_ACTIVE_LISTINGS_ACCOUNT_SCOPE_CONSTRAINT_MISSING';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ebay_active_listings_sync_generation_check'
      and conrelid = 'public.ebay_active_listings'::regclass
  ) then
    raise exception
      'EBAY_ACTIVE_LISTINGS_SYNC_GENERATION_CONSTRAINT_MISSING';
  end if;

  select count(*) into v_account_scope_violations
  from public.ebay_active_listings listing
  where listing.account_key is null
    or listing.account_key = 'default'
    or listing.account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$';

  if v_account_scope_violations > 0 then
    raise exception
      'EBAY_ACTIVE_LISTINGS_ACCOUNT_SCOPE_VIOLATIONS: % row(s)',
      v_account_scope_violations;
  end if;

  select count(*) into v_generation_violations
  from public.ebay_active_listings listing
  where listing.sync_generation is null
    or listing.sync_generation < 0;

  if v_generation_violations > 0 then
    raise exception
      'EBAY_ACTIVE_LISTINGS_SYNC_GENERATION_VIOLATIONS: % row(s)',
      v_generation_violations;
  end if;

  alter table public.ebay_active_listings
    validate constraint ebay_active_listings_account_scope_check;
  alter table public.ebay_active_listings
    validate constraint ebay_active_listings_sync_generation_check;

  if exists (
    select 1 from pg_constraint
    where conname in (
      'ebay_active_listings_account_scope_check',
      'ebay_active_listings_sync_generation_check'
    )
      and conrelid = 'public.ebay_active_listings'::regclass
      and convalidated is distinct from true
  ) then
    raise exception 'EBAY_ACTIVE_LISTINGS_CONSTRAINT_VALIDATION_INCOMPLETE';
  end if;
end;
$$;

comment on constraint ebay_active_listings_account_scope_check
  on public.ebay_active_listings is
  'Validated by migration 20260713078000 after explicit zero-violation check.';
comment on constraint ebay_active_listings_sync_generation_check
  on public.ebay_active_listings is
  'Validated by migration 20260713078000 after explicit zero-violation check.';

notify pgrst, 'reload schema';
