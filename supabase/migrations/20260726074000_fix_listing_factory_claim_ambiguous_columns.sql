begin;

-- RETURNS TABLE exposes factory_state as a PL/pgSQL output variable. Qualify
-- every target-column read so PostgreSQL cannot confuse it with that variable.
create or replace function public.claim_ebay_listing_factory_candidate_by_id_v1(
  p_run_id uuid,
  p_candidate_id uuid,
  p_worker text,
  p_now timestamptz default now(),
  p_lease_seconds integer default 300
)
returns table (
  candidate_id uuid,
  run_id uuid,
  factory_state text,
  slot_index integer,
  dossier_version integer,
  dossier_hash text,
  reserved_sku text,
  commercial_generation integer,
  frozen_payload_hash text,
  checkpoint jsonb,
  lease_token uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_token uuid := gen_random_uuid();
  v_desired_slots integer;
  v_leased_count integer;
  v_account_key text;
  v_marketplace text;
begin
  if nullif(trim(p_worker), '') is null or p_lease_seconds not between 30 and 900 then
    raise exception 'LISTING_FACTORY_INVALID_LEASE_REQUEST';
  end if;

  select desired_active_slots, marketplace_account_key, marketplace
  into v_desired_slots, v_account_key, v_marketplace
  from public.ebay_same_day_pilot_runs
  where id = p_run_id
  for update;
  if not found then raise exception 'LISTING_FACTORY_RUN_NOT_FOUND'; end if;

  if exists (
    select 1
    from public.ebay_listing_factory_dependency_circuits circuit
    where circuit.marketplace_account_key = v_account_key
      and circuit.marketplace = v_marketplace
      and (
        circuit.status = 'OPEN'
        or (
          circuit.status = 'HALF_OPEN'
          and circuit.half_open_probe_owner is distinct from p_worker
        )
      )
  ) then
    return;
  end if;

  select * into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id
    and candidate.run_id = p_run_id
  for update;
  if not found then raise exception 'LISTING_FACTORY_CANDIDATE_NOT_FOUND'; end if;

  if not v_candidate.active_slot
    or v_candidate.factory_state in (
      'DRAFT_READY','PUBLISHED','POST_PUBLISH_VERIFIED','COMMERCIAL_MONITORING',
      'BLOCKED_MISSING_EVIDENCE','HOLD_BUSINESS_RULE','STOCK_HOLD','MARGIN_HOLD',
      'COMPLIANCE_HOLD','IDENTITY_HOLD','QUARANTINED_UNKNOWN_ERROR',
      'REJECTED_TERMINAL','CANCELLED','WAITING_EXTERNAL_DEPENDENCY'
    )
    or (
      v_candidate.factory_lease_expires_at is not null
      and v_candidate.factory_lease_expires_at > p_now
    ) then
    return;
  end if;

  select count(*) into v_leased_count
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.run_id = p_run_id
    and candidate.id <> p_candidate_id
    and candidate.factory_lease_expires_at > p_now;
  if v_leased_count >= v_desired_slots then return; end if;

  update public.ebay_same_day_pilot_candidates as target
  set factory_lease_owner = p_worker,
      factory_lease_token = v_token,
      factory_lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      factory_heartbeat_at = p_now,
      factory_attempt_count = target.factory_attempt_count + 1,
      factory_state = case
        when target.factory_state = 'QUEUED' then 'CLAIMED'
        else target.factory_state
      end,
      factory_state_version = target.factory_state_version + 1,
      factory_updated_at = p_now
  where target.id = p_candidate_id;

  if v_candidate.factory_state = 'QUEUED' then
    insert into public.ebay_listing_factory_transitions (
      run_id, candidate_id, previous_state, next_state, cause_code,
      dossier_version, dossier_hash, actor_kind, actor_id, correlation_id,
      checkpoint, idempotency_key
    ) values (
      v_candidate.run_id, v_candidate.id, 'QUEUED', 'CLAIMED',
      'FACTORY_CANDIDATE_CLAIMED', v_candidate.dossier_version,
      v_candidate.dossier_hash, 'SYSTEM', p_worker, v_token,
      v_candidate.last_factory_checkpoint,
      pg_catalog.encode(extensions.digest(
        'FACTORY_CANDIDATE_CLAIMED:' || v_candidate.id::text || ':'
          || v_token::text,
        'sha256'
      ), 'hex')
    );
  end if;

  return query
  select candidate.id, candidate.run_id, candidate.factory_state,
    candidate.slot_index, candidate.dossier_version, candidate.dossier_hash,
    candidate.reserved_sku, candidate.commercial_generation,
    candidate.frozen_payload_hash, candidate.last_factory_checkpoint,
    candidate.factory_lease_token
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id;
end
$$;

commit;
