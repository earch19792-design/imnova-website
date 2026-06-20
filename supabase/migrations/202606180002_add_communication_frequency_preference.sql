-- Adds contact frequency preference to explicit communication consent.
-- Safe and non-destructive: existing preferences default to important updates only.

alter table public.communication_preferences
  add column if not exists frequency_preference text not null default 'important_only';

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'communication_preferences'
      and constraint_name = 'communication_preferences_frequency_check'
  ) then
    alter table public.communication_preferences
      add constraint communication_preferences_frequency_check
        check (
          frequency_preference in (
            'important_only',
            'weekly',
            'twice_monthly'
          )
        );
  end if;
end $$;

notify pgrst, 'reload schema';
