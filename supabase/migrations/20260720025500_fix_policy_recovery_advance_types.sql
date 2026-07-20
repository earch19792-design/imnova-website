-- Correct the three optional audit fields to the registered text types.

create or replace function public.resume_same_day_pilot_candidate_after_account_policy_profile_v1(
  p_account_key text,
  p_actor uuid,
  p_candidate_id uuid,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.ebay_same_day_pilot_runs%rowtype;
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_last_transition public.ebay_same_day_pilot_transitions%rowtype;
  v_prior_transition public.ebay_same_day_pilot_transitions%rowtype;
  v_reconciliation jsonb;
  v_evidence_hash text;
  v_idempotency_key text;
  v_transition_result text;
begin
  if coalesce(p_account_key, '') !~ '^[A-Za-z0-9._:-]{3,120}$'
    or p_actor is null
    or p_candidate_id is null
    or p_now is null then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_INPUT_INVALID';
  end if;

  select run.*
  into v_run
  from public.ebay_same_day_pilot_runs run
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.run_id = run.id
  where candidate.id = p_candidate_id;
  if not found then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_CANDIDATE_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('ebay_same_day_pilot_run:' || v_run.id::text, 0)
  );

  select run.*
  into v_run
  from public.ebay_same_day_pilot_runs run
  where run.id = v_run.id
  for update;
  if not found
    or v_run.marketplace_account_key <> p_account_key
    or v_run.marketplace <> 'EBAY_US'
    or v_run.created_by is distinct from p_actor then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_RUN_SCOPE_INVALID';
  end if;

  select candidate.*
  into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
  for update;
  if not found then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_CANDIDATE_NOT_FOUND';
  end if;

  if v_candidate.machine_state <> 'REJECTED' then
    return public.resume_same_day_pilot_candidate_after_account_policy_profile_core_v1(
      p_account_key, p_actor, p_candidate_id, p_now
    );
  end if;

  select transition_row.*
  into v_last_transition
  from public.ebay_same_day_pilot_transitions transition_row
  where transition_row.run_id = v_run.id
    and transition_row.candidate_id = p_candidate_id
  order by transition_row.created_at desc, transition_row.id desc
  limit 1;
  if not found then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_REJECTION_INVALID';
  end if;

  if v_last_transition.previous_state = 'GENERATING_LISTING_CONTENT'
    and v_last_transition.next_state = 'REJECTED'
    and v_last_transition.reason_code = 'VERIFIED_BUSINESS_POLICIES_REQUIRED' then
    return public.resume_same_day_pilot_candidate_after_account_policy_profile_core_v1(
      p_account_key, p_actor, p_candidate_id, p_now
    );
  end if;

  if v_candidate.state <> 'REJECTED_TODAY'
    or coalesce(cardinality(v_candidate.blockers), 0) <> 1
    or not (
      v_candidate.blockers
      @> array['VERIFIED_BUSINESS_POLICIES_REQUIRED']::text[]
    )
    or v_last_transition.previous_state <> 'REJECTED'
    or v_last_transition.next_state <> 'GENERATING_LISTING_CONTENT'
    or v_last_transition.reason_code
      <> 'OWN_ACTIVE_LISTING_POLICY_HOMOLOGATION_V6' then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_LEDGER_MISMATCH';
  end if;

  select transition_row.*
  into v_prior_transition
  from public.ebay_same_day_pilot_transitions transition_row
  where transition_row.run_id = v_run.id
    and transition_row.candidate_id = p_candidate_id
    and (
      transition_row.created_at < v_last_transition.created_at
      or (
        transition_row.created_at = v_last_transition.created_at
        and transition_row.id < v_last_transition.id
      )
    )
  order by transition_row.created_at desc, transition_row.id desc
  limit 1;
  if not found
    or v_prior_transition.previous_state <> 'GENERATING_LISTING_CONTENT'
    or v_prior_transition.next_state <> 'REJECTED'
    or v_prior_transition.reason_code
      <> 'VERIFIED_BUSINESS_POLICIES_REQUIRED' then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_LEDGER_MISMATCH';
  end if;

  if coalesce(v_run.worker_lease_expires_at, '-infinity'::timestamptz) > p_now
    or exists (
      select 1
      from public.ebay_same_day_pilot_jobs job
      where job.run_id = v_run.id
        and job.status in ('PENDING', 'WAITING_RETRY', 'LEASED', 'DEAD_LETTER')
    )
    or exists (
      select 1
      from public.ebay_same_day_pilot_human_tasks task
      where task.run_id = v_run.id
        and task.status = 'OPEN'
    )
    or exists (
      select 1
      from public.ebay_same_day_pilot_handoffs handoff
      where handoff.run_id = v_run.id
        and handoff.candidate_id = p_candidate_id
    )
    or exists (
      select 1
      from public.ebay_same_day_pilot_jobs job
      where job.run_id = v_run.id
        and job.candidate_id = p_candidate_id
        and job.job_type = 'GENERATE_SIX_IMAGE_PACKAGE'
    )
    or not exists (
      select 1
      from public.ebay_same_day_pilot_jobs job
      where job.run_id = v_run.id
        and job.candidate_id = p_candidate_id
        and job.job_type = 'BUILD_MANUAL_SELLER_HUB_HANDOFF'
        and job.status = 'COMPLETED'
        and job.created_at >= v_last_transition.created_at
    ) then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_LEDGER_LANE_BLOCKED';
  end if;

  v_reconciliation := jsonb_build_object(
    'reconciliationVersion', 'POLICY_HOMOLOGATION_LEDGER_V1_2026_07_20',
    'sourceTransitionId', v_last_transition.id,
    'sourceReason', v_last_transition.reason_code,
    'priorPolicyRejectionTransitionId', v_prior_transition.id,
    'candidateStateObserved', v_candidate.machine_state,
    'exclusiveBlocker', 'VERIFIED_BUSINESS_POLICIES_REQUIRED',
    'ebayWrites', 0
  );
  v_evidence_hash := encode(
    extensions.digest(v_reconciliation::text, 'sha256'),
    'hex'
  );
  v_idempotency_key := v_run.id::text || ':' || p_candidate_id::text
    || ':POLICY_HOMOLOGATION_LEDGER_RECONCILIATION:'
    || v_last_transition.id::text;

  update public.ebay_same_day_pilot_candidates
  set machine_state = 'GENERATING_LISTING_CONTENT',
      updated_at = p_now
  where id = p_candidate_id
    and run_id = v_run.id
    and machine_state = 'REJECTED'
    and state = 'REJECTED_TODAY'
    and blockers = array['VERIFIED_BUSINESS_POLICIES_REQUIRED']::text[];
  if not found then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_LEDGER_PATCH_FAILED';
  end if;

  v_transition_result := public.advance_same_day_pilot_candidate(
    v_run.id,
    p_candidate_id,
    'GENERATING_LISTING_CONTENT',
    'REJECTED',
    'VERIFIED_BUSINESS_POLICIES_REQUIRED',
    'USER',
    p_now,
    p_now,
    1,
    v_reconciliation,
    v_evidence_hash,
    v_idempotency_key,
    'Reconciliar el ledger antes de recuperar el perfil de policies.',
    'Ninguna.',
    null::text,
    null::text,
    null::jsonb,
    p_now,
    1,
    null::text,
    null::text,
    null::text
  );
  if v_transition_result = 'STALE' then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_LEDGER_TRANSITION_BLOCKED';
  end if;

  return public.resume_same_day_pilot_candidate_after_account_policy_profile_core_v1(
    p_account_key, p_actor, p_candidate_id, p_now
  );
end;
$$;

revoke all on function public.resume_same_day_pilot_candidate_after_account_policy_profile_v1(
  text, uuid, uuid, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.resume_same_day_pilot_candidate_after_account_policy_profile_v1(
  text, uuid, uuid, timestamptz
) to service_role;

comment on function public.resume_same_day_pilot_candidate_after_account_policy_profile_v1(
  text, uuid, uuid, timestamptz
) is 'Atomically reconciles one exact policy-homologation ledger mismatch, then delegates to the original fail-closed candidate recovery; performs no eBay write.';

notify pgrst, 'reload schema';
