-- Add the minimal Smart Stocking learning profile to the existing canonical
-- marketplace listing decision-package authority. Historical packages remain
-- untouched and no new persistence authority is introduced.

alter table public.marketplace_listing_decision_packages
  add column if not exists smart_stocking_learning_profile jsonb,
  add column if not exists smart_stocking_learning_profile_updated_at timestamptz;

comment on column public.marketplace_listing_decision_packages.smart_stocking_learning_profile is
  'Versioned Smart Stocking entry and decision snapshots. Entry snapshot is write-once; no marketplace action authority.';
comment on column public.marketplace_listing_decision_packages.smart_stocking_learning_profile_updated_at is
  'Last durable decision-snapshot update time; entry snapshot remains immutable.';

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'marketplace_listing_decision_packages_learning_profile_check'
      and conrelid = 'public.marketplace_listing_decision_packages'::regclass
  ) then
    alter table public.marketplace_listing_decision_packages
      add constraint marketplace_listing_decision_packages_learning_profile_check
      check (
        smart_stocking_learning_profile is null
        or (
          pg_catalog.jsonb_typeof(smart_stocking_learning_profile) = 'object'
          and smart_stocking_learning_profile ->> 'profileVersion' =
            'SELLER_OS_SMART_STOCKING_LEARNING_PROFILE_V1'
          and pg_catalog.jsonb_typeof(
            smart_stocking_learning_profile -> 'entrySnapshot'
          ) = 'object'
          and pg_catalog.jsonb_typeof(
            smart_stocking_learning_profile -> 'decisionSnapshot'
          ) = 'object'
          and smart_stocking_learning_profile -> 'entrySnapshot' ?& array[
            'entryPotentialScore',
            'entryPotentialTier',
            'marketDemandScore',
            'economicsPotentialScore',
            'merchandisingScore',
            'lunaAdvantageScore',
            'operationalSimplicityScore',
            'portfolioDiversificationScore',
            'evidenceQualityScore',
            'riskPenalty',
            'whyPrioritized',
            'knownUncertainties',
            'entrySnapshotOrigin'
          ]
          and smart_stocking_learning_profile -> 'decisionSnapshot' ?& array[
            'launchPotentialScore',
            'launchTier',
            'evidenceProfile',
            'finalEconomics',
            'rescueUsed',
            'rescueType',
            'whyPublishedOrParked',
            'parkReason',
            'reopenCondition'
          ]
          and smart_stocking_learning_profile ->> 'entrySnapshotHash'
            ~ '^sha256:[0-9a-f]{64}$'
          and smart_stocking_learning_profile ->> 'decisionSnapshotHash'
            ~ '^sha256:[0-9a-f]{64}$'
          and case
            when pg_catalog.jsonb_typeof(
              smart_stocking_learning_profile #> '{entrySnapshot,entryPotentialScore}'
            ) = 'number'
              then (smart_stocking_learning_profile #>>
                '{entrySnapshot,entryPotentialScore}')::numeric between 0 and 100
            else false
          end
          and case
            when pg_catalog.jsonb_typeof(
              smart_stocking_learning_profile #> '{entrySnapshot,riskPenalty}'
            ) = 'number'
              then (smart_stocking_learning_profile #>>
                '{entrySnapshot,riskPenalty}')::numeric between 0 and 100
            else false
          end
          and case
            when pg_catalog.jsonb_typeof(
              smart_stocking_learning_profile #> '{decisionSnapshot,launchPotentialScore}'
            ) = 'number'
              then (smart_stocking_learning_profile #>>
                '{decisionSnapshot,launchPotentialScore}')::numeric between 0 and 100
            else false
          end
        )
      );
  end if;
end
$$;

create unique index if not exists
  marketplace_listing_decision_packages_learning_profile_identity_uidx
on public.marketplace_listing_decision_packages (
  marketplace_account_key,
  marketplace,
  coalesce(
    nullif(supplier_variant_id, ''),
    'supplier-sku:' || supplier_sku
  )
)
where smart_stocking_learning_profile is not null;

create or replace function public.enforce_smart_stocking_entry_snapshot_immutable_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.smart_stocking_learning_profile is not null then
    if new.smart_stocking_learning_profile is null then
      raise exception 'SELLER_OS_SMART_STOCKING_ENTRY_SNAPSHOT_IMMUTABLE'
        using errcode = '23514';
    end if;

    if old.smart_stocking_learning_profile -> 'entrySnapshot'
         is distinct from new.smart_stocking_learning_profile -> 'entrySnapshot'
      or old.smart_stocking_learning_profile ->> 'entrySnapshotHash'
         is distinct from new.smart_stocking_learning_profile ->> 'entrySnapshotHash'
    then
      raise exception 'SELLER_OS_SMART_STOCKING_ENTRY_SNAPSHOT_IMMUTABLE'
        using errcode = '23514';
    end if;
  end if;

  if new.smart_stocking_learning_profile is not null then
    new.smart_stocking_learning_profile_updated_at = pg_catalog.clock_timestamp();
  end if;

  return new;
end
$$;

revoke all on function public.enforce_smart_stocking_entry_snapshot_immutable_v1()
  from public, anon, authenticated;
grant execute on function public.enforce_smart_stocking_entry_snapshot_immutable_v1()
  to service_role;

drop trigger if exists enforce_smart_stocking_entry_snapshot_immutable_v1
  on public.marketplace_listing_decision_packages;
create trigger enforce_smart_stocking_entry_snapshot_immutable_v1
before insert or update of smart_stocking_learning_profile
on public.marketplace_listing_decision_packages
for each row
execute function public.enforce_smart_stocking_entry_snapshot_immutable_v1();

select pg_catalog.pg_notify('pgrst', 'reload schema');
