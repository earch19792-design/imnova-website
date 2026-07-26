begin;

-- A candidate already published and monitored remains in the durable history,
-- but it can never occupy or reacquire a Listing Factory execution slot.
create or replace function
  public.enforce_published_acquisition_factory_terminal_v1()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_is_superseded boolean;
  v_factory_changed boolean;
begin
  v_is_superseded :=
    coalesce(new.blockers, '{}'::text[]) && array[
      'ALREADY_LISTED_AND_MONITORED',
      'ALREADY_PUBLISHED_AND_MONITORED'
    ]
    or exists (
      select 1
      from public.ebay_published_acquisition_exclusions exclusion
      where exclusion.candidate_id = new.id
        and exclusion.disposition = 'SUPERSEDED_ALREADY_PUBLISHED'
    )
    or exists (
      select 1
      from public.ebay_luna_opportunity_acquisition_dispositions disposition
      join public.ebay_same_day_pilot_runs run
        on run.id = new.run_id
       and run.marketplace_account_key = disposition.account_key
       and run.marketplace = disposition.marketplace
      where disposition.opportunity_id = new.opportunity_id
        and disposition.disposition = 'SUPERSEDED_ALREADY_PUBLISHED'
        and not (
          new.machine_state = 'VERIFIED_ACTIVE'
          and new.factory_state = 'COMMERCIAL_MONITORING'
          and not new.active_slot
          and not (
            coalesce(new.blockers, '{}'::text[]) && array[
              'ALREADY_LISTED_AND_MONITORED',
              'ALREADY_PUBLISHED_AND_MONITORED'
            ]
          )
        )
    );

  if not v_is_superseded then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_factory_changed := true;
  else
    v_factory_changed :=
      old.factory_state is distinct from 'REJECTED_TERMINAL'
      or old.active_slot
      or old.slot_index is not null
      or old.factory_lease_owner is not null
      or old.factory_lease_token is not null
      or old.factory_lease_expires_at is not null
      or old.factory_heartbeat_at is not null;
  end if;

  new.machine_state := 'REJECTED';
  new.state := 'REJECTED_TODAY';
  new.blockers := array(
    select distinct blocker
    from unnest(
      coalesce(new.blockers, '{}'::text[])
      || array['ALREADY_PUBLISHED_AND_MONITORED']
    ) blocker
  );
  new.factory_state := 'REJECTED_TERMINAL';
  new.active_slot := false;
  new.slot_index := null;
  new.factory_lease_owner := null;
  new.factory_lease_token := null;
  new.factory_lease_expires_at := null;
  new.factory_heartbeat_at := null;
  new.factory_last_error_code := 'ALREADY_PUBLISHED_AND_MONITORED';
  new.last_factory_checkpoint :=
    coalesce(new.last_factory_checkpoint, '{}'::jsonb)
    || jsonb_build_object(
      'publishedAcquisitionExclusion',
      jsonb_build_object(
        'policyVersion',
        'EBAY_PUBLISHED_FACTORY_SLOT_RECONCILIATION_V1_2026_07_26',
        'blockerCode',
        'ALREADY_PUBLISHED_AND_MONITORED',
        'activeSlotReleased',
        true,
        'historyDeleted',
        false,
        'ebayWrites',
        0
      )
    );
  new.next_automated_action :=
    'Continuar con otro producto elegible; no repetir el analisis.';
  new.next_human_action :=
    'Ninguna; el listing existente continua en monitoreo.';

  if v_factory_changed then
    new.factory_state_version :=
      greatest(coalesce(new.factory_state_version, 0), 0) + 1;
    new.last_factory_checkpoint_at := clock_timestamp();
    new.factory_updated_at := clock_timestamp();
  end if;
  new.updated_at := clock_timestamp();

  return new;
end;
$$;

revoke all on function
  public.enforce_published_acquisition_factory_terminal_v1()
  from public, anon, authenticated;

drop trigger if exists
  enforce_published_acquisition_factory_terminal_v1
  on public.ebay_same_day_pilot_candidates;
create trigger enforce_published_acquisition_factory_terminal_v1
before insert or update of
  machine_state,
  state,
  blockers,
  factory_state,
  active_slot,
  slot_index,
  factory_lease_owner,
  factory_lease_token,
  factory_lease_expires_at,
  factory_heartbeat_at
on public.ebay_same_day_pilot_candidates
for each row execute function
  public.enforce_published_acquisition_factory_terminal_v1();

-- Preserve an immutable factory transition before repairing legacy projections.
insert into public.ebay_listing_factory_transitions (
  run_id,
  candidate_id,
  previous_state,
  next_state,
  cause_code,
  dossier_version,
  dossier_hash,
  actor_kind,
  actor_id,
  correlation_id,
  checkpoint,
  idempotency_key
)
select
  candidate.run_id,
  candidate.id,
  candidate.factory_state,
  'REJECTED_TERMINAL',
  'ALREADY_PUBLISHED_AND_MONITORED',
  candidate.dossier_version,
  candidate.dossier_hash,
  'SYSTEM',
  'published-acquisition-slot-reconciler-v1',
  gen_random_uuid(),
  coalesce(candidate.last_factory_checkpoint, '{}'::jsonb)
    || jsonb_build_object(
      'policyVersion',
      'EBAY_PUBLISHED_FACTORY_SLOT_RECONCILIATION_V1_2026_07_26',
      'activeSlotReleased',
      true,
      'historyDeleted',
      false,
      'ebayWrites',
      0
    ),
  encode(
    extensions.digest(
      convert_to(
        'PUBLISHED_FACTORY_SLOT_RECONCILED:'
        || candidate.id::text
        || ':EBAY_PUBLISHED_FACTORY_SLOT_RECONCILIATION_V1_2026_07_26',
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
from public.ebay_same_day_pilot_candidates candidate
where (
    coalesce(candidate.blockers, '{}'::text[]) && array[
      'ALREADY_LISTED_AND_MONITORED',
      'ALREADY_PUBLISHED_AND_MONITORED'
    ]
    or exists (
      select 1
      from public.ebay_published_acquisition_exclusions exclusion
      where exclusion.candidate_id = candidate.id
        and exclusion.disposition = 'SUPERSEDED_ALREADY_PUBLISHED'
    )
    or exists (
      select 1
      from public.ebay_luna_opportunity_acquisition_dispositions disposition
      join public.ebay_same_day_pilot_runs run
        on run.id = candidate.run_id
       and run.marketplace_account_key = disposition.account_key
       and run.marketplace = disposition.marketplace
      where disposition.opportunity_id = candidate.opportunity_id
        and disposition.disposition = 'SUPERSEDED_ALREADY_PUBLISHED'
        and not (
          candidate.machine_state = 'VERIFIED_ACTIVE'
          and candidate.factory_state = 'COMMERCIAL_MONITORING'
          and not candidate.active_slot
          and not (
            coalesce(candidate.blockers, '{}'::text[]) && array[
              'ALREADY_LISTED_AND_MONITORED',
              'ALREADY_PUBLISHED_AND_MONITORED'
            ]
          )
        )
    )
  )
  and (
    candidate.factory_state is distinct from 'REJECTED_TERMINAL'
    or candidate.active_slot
    or candidate.slot_index is not null
    or candidate.factory_lease_owner is not null
    or candidate.factory_lease_token is not null
    or candidate.factory_lease_expires_at is not null
    or candidate.factory_heartbeat_at is not null
  )
on conflict (idempotency_key) do nothing;

-- The trigger performs the terminal normalization in the same transaction.
update public.ebay_same_day_pilot_candidates candidate
set blockers = array(
      select distinct blocker
      from unnest(
        coalesce(candidate.blockers, '{}'::text[])
        || array['ALREADY_PUBLISHED_AND_MONITORED']
      ) blocker
    ),
    updated_at = clock_timestamp()
where (
    coalesce(candidate.blockers, '{}'::text[]) && array[
      'ALREADY_LISTED_AND_MONITORED',
      'ALREADY_PUBLISHED_AND_MONITORED'
    ]
    or exists (
      select 1
      from public.ebay_published_acquisition_exclusions exclusion
      where exclusion.candidate_id = candidate.id
        and exclusion.disposition = 'SUPERSEDED_ALREADY_PUBLISHED'
    )
    or exists (
      select 1
      from public.ebay_luna_opportunity_acquisition_dispositions disposition
      join public.ebay_same_day_pilot_runs run
        on run.id = candidate.run_id
       and run.marketplace_account_key = disposition.account_key
       and run.marketplace = disposition.marketplace
      where disposition.opportunity_id = candidate.opportunity_id
        and disposition.disposition = 'SUPERSEDED_ALREADY_PUBLISHED'
        and not (
          candidate.machine_state = 'VERIFIED_ACTIVE'
          and candidate.factory_state = 'COMMERCIAL_MONITORING'
          and not candidate.active_slot
          and not (
            coalesce(candidate.blockers, '{}'::text[]) && array[
              'ALREADY_LISTED_AND_MONITORED',
              'ALREADY_PUBLISHED_AND_MONITORED'
            ]
          )
        )
    )
  )
  and (
    candidate.machine_state is distinct from 'REJECTED'
    or candidate.factory_state is distinct from 'REJECTED_TERMINAL'
    or candidate.active_slot
    or candidate.slot_index is not null
    or candidate.factory_lease_owner is not null
    or candidate.factory_lease_token is not null
    or candidate.factory_lease_expires_at is not null
    or candidate.factory_heartbeat_at is not null
  );

-- Close any task or job recreated between the original disposition and this
-- reconciliation. History and checkpoints remain queryable.
update public.ebay_same_day_pilot_human_tasks task
set status = 'SUPERSEDED',
    completed_at = coalesce(task.completed_at, clock_timestamp()),
    evidence_summary = coalesce(task.evidence_summary, '{}'::jsonb)
      || jsonb_build_object(
        'resolutionCode',
        'ALREADY_PUBLISHED_AND_MONITORED',
        'policyVersion',
        'EBAY_PUBLISHED_FACTORY_SLOT_RECONCILIATION_V1_2026_07_26',
        'evidenceRetained',
        true
      ),
    updated_at = clock_timestamp()
where task.status = 'OPEN'
  and exists (
    select 1
    from public.ebay_same_day_pilot_candidates candidate
    where candidate.id = task.candidate_id
      and coalesce(candidate.blockers, '{}'::text[]) && array[
        'ALREADY_LISTED_AND_MONITORED',
        'ALREADY_PUBLISHED_AND_MONITORED'
      ]
  );

update public.ebay_same_day_pilot_jobs job
set status = 'CANCELLED',
    lease_owner = null,
    lease_expires_at = null,
    last_error_code = 'ALREADY_PUBLISHED_AND_MONITORED',
    checkpoint = coalesce(job.checkpoint, '{}'::jsonb)
      || jsonb_build_object(
        'policyVersion',
        'EBAY_PUBLISHED_FACTORY_SLOT_RECONCILIATION_V1_2026_07_26',
        'resolutionCode',
        'ALREADY_PUBLISHED_AND_MONITORED',
        'evidenceRetained',
        true,
        'ebayWrites',
        0
      ),
    updated_at = clock_timestamp()
where job.status in ('PENDING', 'WAITING_RETRY', 'LEASED', 'DEAD_LETTER')
  and exists (
    select 1
    from public.ebay_same_day_pilot_candidates candidate
    where candidate.id = job.candidate_id
      and coalesce(candidate.blockers, '{}'::text[]) && array[
        'ALREADY_LISTED_AND_MONITORED',
        'ALREADY_PUBLISHED_AND_MONITORED'
      ]
  );

-- This invariant is the compact common guard for initialization, reserve
-- promotion and both claim RPCs. Their UPDATE cannot reactivate an excluded row.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ebay_same_day_pilot_candidates'::regclass
      and conname =
        'ebay_same_day_published_candidate_factory_terminal_check'
  ) then
    alter table public.ebay_same_day_pilot_candidates
      add constraint
        ebay_same_day_published_candidate_factory_terminal_check
      check (
        not (
          coalesce(blockers, '{}'::text[]) && array[
            'ALREADY_LISTED_AND_MONITORED',
            'ALREADY_PUBLISHED_AND_MONITORED'
          ]
        )
        or (
          machine_state = 'REJECTED'
          and factory_state = 'REJECTED_TERMINAL'
          and not active_slot
          and slot_index is null
          and factory_lease_owner is null
          and factory_lease_token is null
          and factory_lease_expires_at is null
          and factory_heartbeat_at is null
        )
      ) not valid;
  end if;
end;
$$;

alter table public.ebay_same_day_pilot_candidates
  validate constraint
    ebay_same_day_published_candidate_factory_terminal_check;

notify pgrst, 'reload schema';

commit;
