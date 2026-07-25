-- Additive repair after 20260722033000: qualify the atomic budget UPDATE
-- because the RETURNS TABLE provider_calls field is also a PL/pgSQL variable.
do $repair$
declare
  v_signature regprocedure :=
    'public.consume_ebay_reference_guided_successor_position_5(uuid,text,text,boolean)'::regprocedure;
  v_definition text;
  v_repaired text;
  v_ambiguous text := $target$update public.ebay_reference_guided_generation_attempts
  set provider_calls = provider_calls + 1
  where id = v_attempt.id and provider_calls = 2 and max_provider_calls = 6
  returning ebay_reference_guided_generation_attempts.provider_calls into v_calls;$target$;
  v_qualified text := $replacement$update public.ebay_reference_guided_generation_attempts a
  set provider_calls = a.provider_calls + 1
  where a.id = v_attempt.id and a.provider_calls = 2
    and a.max_provider_calls = 6
  returning a.provider_calls into v_calls;$replacement$;
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if position(v_ambiguous in v_definition) = 0 then
    raise exception 'SUCCESSOR_POSITION_5_BUDGET_QUALIFICATION_TARGET_MISSING';
  end if;
  v_repaired := replace(v_definition, v_ambiguous, v_qualified);
  if v_repaired = v_definition
    or position(v_ambiguous in v_repaired) <> 0
    or position(v_qualified in v_repaired) = 0 then
    raise exception 'SUCCESSOR_POSITION_5_BUDGET_QUALIFICATION_FAILED';
  end if;
  execute v_repaired;
end;
$repair$;

revoke all on function public.consume_ebay_reference_guided_successor_position_5(
  uuid,text,text,boolean) from public, anon, authenticated;
grant execute on function public.consume_ebay_reference_guided_successor_position_5(
  uuid,text,text,boolean) to service_role;

notify pgrst, 'reload schema';
