-- Reviewed compensating migration. Do not run manually during an incident.
-- Preserve dossier, transition, quarantine and attempt exports before execution.
begin;

drop view if exists public.ebay_listing_factory_run_metrics_v1;
drop function if exists public.recompute_ebay_listing_factory_run_v1(uuid);
drop function if exists public.recover_expired_ebay_listing_factory_effects_v1(timestamptz);
drop function if exists public.record_ebay_listing_factory_effect_result_v1(
  uuid,text,uuid,text,text,integer,text,jsonb,text,text
);
drop function if exists public.claim_ebay_listing_factory_effect_v1(text,timestamptz);
drop function if exists public.prepare_ebay_listing_factory_effect_v1(
  uuid,uuid,uuid,text,text,text,text,integer,text,text,jsonb,text
);
drop function if exists public.open_ebay_listing_factory_circuit_v1(
  text,text,text,text,text,timestamptz
);
drop function if exists public.resolve_ebay_listing_factory_circuit_probe_v1(
  text,text,text,text,boolean,text,text,timestamptz,timestamptz
);
drop function if exists public.claim_ebay_listing_factory_circuit_probe_v1(
  text,text,text,text,timestamptz,integer
);
drop function if exists public.replay_ebay_listing_factory_quarantine_v1(
  uuid,text,boolean,uuid,text
);
drop function if exists public.quarantine_ebay_listing_factory_legacy_dead_letter_v1(
  uuid,text,text,text,text,uuid,text
);
drop function if exists public.quarantine_ebay_listing_factory_candidate_v1(
  uuid,text,uuid,text,text,text,text,text,text,jsonb,text,text,jsonb,boolean,uuid,text
);
drop function if exists public.transition_ebay_listing_factory_candidate_v1(
  uuid,text,text,text,integer,text,jsonb,text,text,uuid,text,text,uuid,text
);
drop function if exists public.heartbeat_ebay_listing_factory_candidate_v1(
  uuid,text,uuid,timestamptz
);
drop function if exists public.claim_ebay_listing_factory_candidate_v1(
  uuid,text,timestamptz,integer
);
drop function if exists public.claim_ebay_listing_factory_candidate_by_id_v1(
  uuid,uuid,text,timestamptz,integer
);
drop function if exists public.release_ebay_listing_factory_candidate_v1(
  uuid,text,uuid,timestamptz
);
drop function if exists public.initialize_ebay_listing_factory_run_v1(uuid,text,uuid);
drop function if exists public.append_ebay_listing_factory_dossier_v1(
  uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,numeric,text,
  timestamptz,timestamptz,text
);
drop trigger if exists ebay_listing_factory_attempts_immutable
  on public.ebay_listing_factory_effect_attempts;
drop trigger if exists ebay_listing_factory_transitions_immutable
  on public.ebay_listing_factory_transitions;
drop trigger if exists ebay_listing_factory_dossiers_immutable
  on public.ebay_listing_factory_dossiers;
drop trigger if exists ebay_listing_factory_candidate_scope_sync
  on public.ebay_same_day_pilot_candidates;
drop function if exists public.sync_ebay_listing_factory_candidate_scope();
drop function if exists public.prevent_listing_factory_immutable_mutation();
drop table if exists public.ebay_listing_factory_effect_attempts;
drop table if exists public.ebay_listing_factory_effect_outbox;
drop table if exists public.ebay_listing_factory_quarantine_cases;
drop table if exists public.ebay_listing_factory_error_fingerprints;
drop table if exists public.ebay_listing_factory_dependency_circuits;
drop table if exists public.ebay_listing_factory_transitions;
drop table if exists public.ebay_listing_factory_transition_rules;
drop table if exists public.ebay_listing_factory_dossiers;
drop table if exists public.ebay_listing_factory_policies;

drop index if exists public.ebay_listing_factory_claim_idx;
drop index if exists public.ebay_listing_factory_reserved_sku_idx;
drop index if exists public.ebay_listing_factory_active_slot_idx;

do $restore_legacy_lease_index$
begin
  with ranked_leases as (
    select id, row_number() over (
      partition by run_id
      order by coalesce(last_heartbeat_at, updated_at, created_at) desc, id
    ) as lease_rank
    from public.ebay_same_day_pilot_jobs
    where status = 'LEASED'
  )
  update public.ebay_same_day_pilot_jobs job
  set status = 'WAITING_RETRY',
      available_at = now(),
      lease_owner = null,
      lease_expires_at = null,
      last_heartbeat_at = null,
      last_error_code = 'ROLLBACK_REQUEUED_CONCURRENT_LEASE',
      updated_at = now()
  from ranked_leases
  where job.id = ranked_leases.id
    and ranked_leases.lease_rank > 1;

  if not exists (
    select 1
    from pg_class
    where oid = 'public.ebay_same_day_pilot_one_lease_per_run_idx'::regclass
  ) then
    create unique index ebay_same_day_pilot_one_lease_per_run_idx
      on public.ebay_same_day_pilot_jobs(run_id)
      where status = 'LEASED';
  end if;
exception
  when undefined_table then
    raise notice 'Legacy jobs table is unavailable; lease index was not restored.';
  when undefined_object then
    create unique index if not exists ebay_same_day_pilot_one_lease_per_run_idx
      on public.ebay_same_day_pilot_jobs(run_id)
      where status = 'LEASED';
end
$restore_legacy_lease_index$;

do $restore_legacy_candidate_contract$
begin
  if exists (
    select 1
    from public.ebay_same_day_pilot_candidates
    where ordinal not between 1 and 5
  ) then
    raise exception
      'ROLLBACK_BLOCKED_CANDIDATE_ORDINAL_OUTSIDE_LEGACY_RANGE';
  end if;
end
$restore_legacy_candidate_contract$;

alter table public.ebay_same_day_pilot_candidates
  drop constraint if exists ebay_same_day_pilot_candidates_ordinal_check,
  drop constraint if exists ebay_same_day_pilot_candidates_replaces_fk,
  drop constraint if exists ebay_same_day_pilot_candidates_factory_state_check,
  drop constraint if exists ebay_same_day_pilot_candidates_role_check,
  drop constraint if exists ebay_same_day_pilot_candidates_slot_check,
  drop constraint if exists ebay_same_day_pilot_candidates_factory_lease_check,
  drop constraint if exists ebay_same_day_pilot_candidates_hashes_check,
  drop constraint if exists ebay_same_day_pilot_candidates_sku_scope_check,
  add constraint ebay_same_day_pilot_candidates_ordinal_check
    check (ordinal between 1 and 5),
  drop column if exists factory_state,
  drop column if exists factory_state_version,
  drop column if exists slot_index,
  drop column if exists candidate_role,
  drop column if exists active_slot,
  drop column if exists replaces_candidate_id,
  drop column if exists dossier_version,
  drop column if exists dossier_hash,
  drop column if exists reserved_sku,
  drop column if exists factory_marketplace_account_key,
  drop column if exists factory_marketplace,
  drop column if exists factory_registered_at,
  drop column if exists commercial_generation,
  drop column if exists frozen_payload_hash,
  drop column if exists last_factory_checkpoint,
  drop column if exists last_factory_checkpoint_at,
  drop column if exists factory_lease_owner,
  drop column if exists factory_lease_token,
  drop column if exists factory_lease_expires_at,
  drop column if exists factory_heartbeat_at,
  drop column if exists factory_attempt_count,
  drop column if exists factory_last_error_code,
  drop column if exists factory_last_error_fingerprint,
  drop column if exists factory_updated_at;

update public.ebay_same_day_pilot_runs
set status = case status
      when 'COMPLETED_WITH_HOLDS' then 'COMPLETED'
      when 'COMPLETED_WITH_QUARANTINE' then 'COMPLETED'
      when 'PARTIAL_SUCCESS' then 'PARTIALLY_READY'
      when 'PAUSED_BY_GLOBAL_DEPENDENCY' then 'BLOCKED'
      else status
    end
where status not in (
    'ACTIVE','PARTIALLY_READY','READY_FOR_OPERATOR','COMPLETED','BLOCKED'
  );

alter table public.ebay_same_day_pilot_runs
  drop constraint if exists ebay_same_day_pilot_runs_status_check,
  drop constraint if exists ebay_same_day_pilot_runs_target_new_listings_check,
  drop constraint if exists ebay_same_day_pilot_runs_factory_status_check,
  drop constraint if exists ebay_same_day_pilot_runs_factory_target_size_check,
  drop constraint if exists ebay_same_day_pilot_runs_factory_mode_check,
  drop constraint if exists ebay_same_day_pilot_runs_factory_slots_check,
  drop constraint if exists ebay_same_day_pilot_runs_factory_scheduler_check,
  drop constraint if exists ebay_same_day_pilot_runs_factory_safety_check,
  add constraint ebay_same_day_pilot_runs_status_check check (
    status in (
      'ACTIVE','PARTIALLY_READY','READY_FOR_OPERATOR','COMPLETED','BLOCKED'
    )
  ),
  add constraint ebay_same_day_pilot_runs_target_new_listings_check
    check (target_new_listings between 0 and 2),
  drop column if exists factory_policy_version,
  drop column if exists factory_status,
  drop column if exists factory_target_size,
  drop column if exists factory_mode,
  drop column if exists desired_active_slots,
  drop column if exists reserve_enabled,
  drop column if exists factory_scheduler_owner,
  drop column if exists factory_correlation_id,
  drop column if exists factory_config_snapshot,
  drop column if exists publication_kill_switch_engaged,
  drop column if exists automatic_publication_allowed,
  drop column if exists factory_initialized_at,
  drop column if exists factory_last_success_at,
  drop column if exists factory_updated_at;

commit;
