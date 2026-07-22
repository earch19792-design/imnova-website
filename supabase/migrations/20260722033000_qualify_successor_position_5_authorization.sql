-- Additive repair: 20260722032000 is already applied in staging and remains
-- immutable. Qualify output-column names that also exist as PL/pgSQL variables.
do $repair$
declare
  v_signature regprocedure :=
    'public.consume_ebay_reference_guided_successor_position_5(uuid,text,text,boolean)'::regprocedure;
  v_definition text;
  v_repaired text;
  v_ambiguous text :=
    'where successor_plan_id = v_plan.id and job_id = v_job.id and position = 5';
  v_qualified text :=
    'where ebay_reference_guided_successor_provider_events.successor_plan_id = v_plan.id and ebay_reference_guided_successor_provider_events.job_id = v_job.id and ebay_reference_guided_successor_provider_events.position = 5';
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if position(v_ambiguous in v_definition) = 0 then
    raise exception 'SUCCESSOR_POSITION_5_AUTHORIZATION_QUALIFICATION_TARGET_MISSING';
  end if;
  v_repaired := replace(v_definition, v_ambiguous, v_qualified);
  if v_repaired = v_definition
    or position(v_ambiguous in v_repaired) <> 0
    or position(v_qualified in v_repaired) = 0 then
    raise exception 'SUCCESSOR_POSITION_5_AUTHORIZATION_QUALIFICATION_FAILED';
  end if;
  execute v_repaired;
end;
$repair$;

revoke all on function public.consume_ebay_reference_guided_successor_position_5(
  uuid,text,text,boolean) from public, anon, authenticated;
grant execute on function public.consume_ebay_reference_guided_successor_position_5(
  uuid,text,text,boolean) to service_role;

notify pgrst, 'reload schema';
