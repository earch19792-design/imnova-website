-- The worker's terminal image failure can reconcile the candidate back to
-- REJECTED without appending a duplicate transition when the immediately
-- preceding transition already records the exact recovery lane. Permit that
-- shape only when the failed job and failed control were created after the
-- audited recovery transition. All other run, candidate, capture, control and
-- blocker checks in the recovery function remain unchanged.

do $migration$
declare
  v_definition text;
  v_old_guard text := $old$
  if not found
    or v_last_transition.previous_state <> 'PREPARING_IMAGE_PACKAGE'
    or v_last_transition.next_state <> 'REJECTED'
    or v_last_transition.reason_code <> 'SAME_DAY_IMAGE_SET_EVIDENCE_INVALID' then
    raise exception 'SAME_DAY_FRAMED_MAIN_RECOVERY_TRANSITION_INVALID';
  end if;
$old$;
  v_new_guard text := $new$
  if not found or not (
    (
      v_last_transition.previous_state = 'PREPARING_IMAGE_PACKAGE'
      and v_last_transition.next_state = 'REJECTED'
      and v_last_transition.reason_code = 'SAME_DAY_IMAGE_SET_EVIDENCE_INVALID'
    )
    or
    (
      v_last_transition.previous_state = 'REJECTED'
      and v_last_transition.next_state = 'PREPARING_IMAGE_PACKAGE'
      and v_last_transition.reason_code
        = 'VISUAL_STRATEGY_V3_EVIDENCE_VALIDATOR_DEPLOYED'
      and v_failed_job.created_at >= v_last_transition.created_at
      and v_control.created_at >= v_last_transition.created_at
    )
  ) then
    raise exception 'SAME_DAY_FRAMED_MAIN_RECOVERY_TRANSITION_INVALID';
  end if;
$new$;
begin
  select pg_get_functiondef(
    'public.resume_same_day_image_after_framed_main_validator_v1(text,uuid,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure
  ) into v_definition;
  if v_definition is null or strpos(v_definition, v_old_guard) = 0 then
    raise exception 'FRAMED_MAIN_RECOVERY_TRANSITION_BASE_NOT_FOUND';
  end if;
  execute replace(v_definition, v_old_guard, v_new_guard);
end;
$migration$;

comment on function public.resume_same_day_image_after_framed_main_validator_v1(
  text, uuid, uuid, uuid, uuid, uuid, timestamptz
) is 'Creates one append-only framed-main recovery and accepts only the exact terminal failure transition or its audited immediately preceding recovery transition; no eBay write is possible.';

notify pgrst, 'reload schema';
