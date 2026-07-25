-- Reopen exactly one same-day candidate after the seller's own eBay policy
-- profile has been saved through the GET-only preflight. This function does
-- not scan candidates, call eBay, publish, or grant any marketplace write.

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
  v_run_id uuid;
  v_run public.ebay_same_day_pilot_runs%rowtype;
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_profile public.ebay_account_policy_profiles%rowtype;
  v_last_transition public.ebay_same_day_pilot_transitions%rowtype;
  v_profile_fingerprint text;
  v_job_idempotency_key text;
  v_checkpoint jsonb;
  v_evidence_hash text;
  v_transition_idempotency_key text;
  v_transition_result text;
begin
  if coalesce(p_account_key, '') !~ '^[A-Za-z0-9._:-]{3,120}$'
    or p_actor is null
    or p_candidate_id is null
    or p_now is null then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_INPUT_INVALID';
  end if;

  select candidate.run_id
  into v_run_id
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id;
  if not found then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_CANDIDATE_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('ebay_same_day_pilot_run:' || v_run_id::text, 0)
  );

  select run.*
  into v_run
  from public.ebay_same_day_pilot_runs run
  where run.id = v_run_id
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

  select profile.*
  into v_profile
  from public.ebay_account_policy_profiles profile
  where profile.account_key = p_account_key
    and profile.marketplace_id = 'EBAY_US'
    and profile.verification_source = 'EBAY_ACCOUNT_API_GET'
    and profile.profile_version = 'EBAY_ACCOUNT_POLICY_PROFILE_V1_2026_07_20'
    and profile.expires_at > p_now
    and length(trim(profile.fulfillment_policy_id)) > 0
    and length(trim(profile.payment_policy_id)) > 0
    and length(trim(profile.return_policy_id)) > 0
    and length(trim(coalesce(profile.merchant_location_key, ''))) > 0
  order by profile.updated_at desc
  limit 1
  for key share;
  if not found then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_PROFILE_REQUIRED';
  end if;

  v_profile_fingerprint := encode(extensions.digest(
    concat_ws(
      ':',
      v_profile.id::text,
      v_profile.profile_version,
      v_profile.verified_at::text,
      v_profile.updated_at::text
    ),
    'sha256'
  ), 'hex');
  v_job_idempotency_key := v_run.id::text || ':' || p_candidate_id::text
    || ':BUILD_MANUAL_SELLER_HUB_HANDOFF:ACCOUNT_POLICY_PROFILE:'
    || v_profile_fingerprint;

  if v_candidate.machine_state in (
      'GENERATING_LISTING_CONTENT', 'VALIDATING_LISTING_CONTENT',
      'PREPARING_IMAGE_PACKAGE', 'WAITING_IMAGE_APPROVAL',
      'BUILDING_SELLER_HUB_HANDOFF', 'READY_FOR_MANUAL_PUBLICATION',
      'WAITING_ITEM_ID', 'VERIFYING_PUBLISHED_LISTING',
      'REGISTERING_COMMERCIAL_MONITOR', 'VERIFIED_ACTIVE', 'COMPLETED'
    )
    and exists (
      select 1
      from public.ebay_same_day_pilot_transitions transition_row
      where transition_row.run_id = v_run.id
        and transition_row.candidate_id = p_candidate_id
        and transition_row.previous_state = 'REJECTED'
        and transition_row.next_state = 'GENERATING_LISTING_CONTENT'
        and transition_row.reason_code = 'ACCOUNT_POLICY_PROFILE_VERIFIED_RETRY'
    ) then
    return jsonb_build_object(
      'status', 'ALREADY_RESUMED',
      'runId', v_run.id,
      'candidateId', p_candidate_id,
      'machineState', v_candidate.machine_state,
      'candidateScoped', true,
      'ebayWrites', 0,
      'productionChanged', false
    );
  end if;

  if v_candidate.machine_state <> 'REJECTED'
    or v_candidate.state <> 'REJECTED_TODAY' then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_STATE_INVALID';
  end if;
  if coalesce(cardinality(v_candidate.blockers), 0) <> 1
    or not (v_candidate.blockers @> array['VERIFIED_BUSINESS_POLICIES_REQUIRED']::text[]) then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_REJECTION_NOT_EXCLUSIVE';
  end if;

  select transition_row.*
  into v_last_transition
  from public.ebay_same_day_pilot_transitions transition_row
  where transition_row.run_id = v_run.id
    and transition_row.candidate_id = p_candidate_id
  order by transition_row.created_at desc, transition_row.id desc
  limit 1;
  if not found
    or v_last_transition.previous_state <> 'GENERATING_LISTING_CONTENT'
    or v_last_transition.next_state <> 'REJECTED'
    or v_last_transition.reason_code <> 'VERIFIED_BUSINESS_POLICIES_REQUIRED' then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_REJECTION_INVALID';
  end if;

  perform 1
  from public.ebay_same_day_pilot_jobs job
  where job.run_id = v_run.id
    and job.candidate_id = p_candidate_id
    and job.job_type = 'BUILD_MANUAL_SELLER_HUB_HANDOFF'
    and job.status = 'COMPLETED';
  if not found then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_COMPLETED_JOB_REQUIRED';
  end if;

  if v_run.status = 'COMPLETED'
    or v_run.verified_new_listings >= v_run.target_new_listings then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_RUN_SETTLED';
  end if;
  if coalesce(v_run.worker_lease_expires_at, '-infinity'::timestamptz) > p_now then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_RUN_LEASE_BLOCKED';
  end if;
  if exists (
    select 1
    from public.ebay_same_day_pilot_jobs job
    where job.run_id = v_run.id
      and job.status in ('PENDING', 'WAITING_RETRY', 'LEASED', 'DEAD_LETTER')
  ) then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_JOB_LANE_BLOCKED';
  end if;
  if exists (
    select 1
    from public.ebay_same_day_pilot_human_tasks task
    where task.run_id = v_run.id
      and task.status = 'OPEN'
  ) then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_TASK_LANE_BLOCKED';
  end if;
  if exists (
    select 1
    from public.ebay_same_day_pilot_candidates candidate
    where candidate.run_id = v_run.id
      and candidate.id <> p_candidate_id
      and candidate.machine_state not in (
        'RUN_CREATED', 'REJECTED', 'BLOCKED', 'READY_FOR_MANUAL_PUBLICATION',
        'VERIFIED_ACTIVE', 'COMPLETED'
      )
  ) then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_OTHER_CANDIDATE_BLOCKED';
  end if;
  if exists (
    select 1
    from public.ebay_same_day_pilot_handoffs handoff
    where handoff.run_id = v_run.id
      and handoff.candidate_id = p_candidate_id
  ) or exists (
    select 1
    from public.ebay_same_day_pilot_jobs job
    where job.run_id = v_run.id
      and job.candidate_id = p_candidate_id
      and job.job_type = 'GENERATE_SIX_IMAGE_PACKAGE'
  ) then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_CHECKPOINT_BLOCKED';
  end if;

  if v_candidate.product_facts_summary ->> 'currentRunBound' is distinct from 'true'
    or nullif(v_candidate.product_facts_summary ->> 'factRunId', '') is null
    or v_candidate.economics_summary ->> 'operatorPriceApproved' is distinct from 'true'
    or v_candidate.economics_summary ->> 'passesProfitGate' is distinct from 'true'
    or v_candidate.economics_summary ->> 'imageRightsConfirmed' is distinct from 'true'
    or v_candidate.economics_summary ->> 'openAiImageSpendApproved' is distinct from 'true' then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_CHECKPOINT_INVALID';
  end if;

  v_checkpoint := jsonb_build_object(
    'recoveryVersion', 'ACCOUNT_POLICY_PROFILE_RECOVERY_V1_2026_07_20',
    'accountPolicyProfileId', v_profile.id,
    'accountPolicyProfileVersion', v_profile.profile_version,
    'accountPolicyProfileVerifiedAt', v_profile.verified_at,
    'accountPolicyProfileFingerprint', v_profile_fingerprint,
    'factRunId', v_candidate.product_facts_summary ->> 'factRunId',
    'openAiCalls', 0,
    'ebayWrites', 0
  );
  v_evidence_hash := encode(
    extensions.digest(v_checkpoint::text, 'sha256'),
    'hex'
  );
  v_transition_idempotency_key := v_run.id::text || ':' || p_candidate_id::text
    || ':GENERATING_LISTING_CONTENT:' || v_evidence_hash;

  v_transition_result := public.advance_same_day_pilot_candidate(
    v_run.id,
    p_candidate_id,
    'REJECTED',
    'GENERATING_LISTING_CONTENT',
    'ACCOUNT_POLICY_PROFILE_VERIFIED_RETRY',
    'USER',
    p_now,
    p_now,
    1,
    v_checkpoint,
    v_evidence_hash,
    v_transition_idempotency_key,
    'Construir el paquete manual con el perfil de policies verificado.',
    'Ninguna.',
    'BUILD_MANUAL_SELLER_HUB_HANDOFF',
    v_job_idempotency_key,
    jsonb_build_object(
      'factRunId', v_candidate.product_facts_summary ->> 'factRunId',
      'accountPolicyProfileId', v_profile.id,
      'accountPolicyProfileFingerprint', v_profile_fingerprint,
      'openAiCalls', 0,
      'ebayWrites', 0
    ),
    p_now,
    4,
    null,
    null,
    null
  );
  if v_transition_result = 'STALE' then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_TRANSITION_BLOCKED';
  end if;

  update public.ebay_same_day_pilot_candidates
  set state = 'READY_FOR_CONTENT',
      blockers = '{}'::text[],
      updated_at = p_now
  where id = p_candidate_id
    and run_id = v_run.id
    and machine_state = 'GENERATING_LISTING_CONTENT';
  if not found then
    raise exception 'SAME_DAY_PILOT_POLICY_RECOVERY_CANDIDATE_PATCH_FAILED';
  end if;

  update public.ebay_same_day_pilot_runs
  set status = 'ACTIVE',
      stage = 'GENERATING_LISTING_CONTENT',
      next_automated_action = 'Construir el paquete manual del candidato recuperado.',
      next_human_action = 'Ninguna.',
      updated_at = p_now
  where id = v_run.id;

  return jsonb_build_object(
    'status', 'RESUMED',
    'runId', v_run.id,
    'candidateId', p_candidate_id,
    'machineState', 'GENERATING_LISTING_CONTENT',
    'jobType', 'BUILD_MANUAL_SELLER_HUB_HANDOFF',
    'candidateScoped', true,
    'ebayWrites', 0,
    'productionChanged', false
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
) is 'Atomically reopens one policy-blocked same-day candidate and enqueues one profile-bound manual handoff job; performs no eBay write.';

notify pgrst, 'reload schema';
