-- Additive repair for the already-applied position-6 authorization RPC.
-- Qualify resolver output columns that collide with RETURNS TABLE variables.
do $repair$
declare
  v_before text;
  v_after text;
  v_old text := $old$  select position_6_amendment_id as amendment_id,
    position_6_amendment_hash as amendment_hash,
    position_6_effective_contract_hash as effective_position_contract_hash,
    position_6_effective_prompt_text as effective_prompt_text,
    position_6_effective_prompt_hash as effective_prompt_hash,
    main_source_hash, side_source_hash into v_resolved
  from public.resolve_ebay_reference_guided_position_6_effective_contract(
    'f166b395-8d3a-4921-b273-1a62a6032707'::uuid);$old$;
  v_new text := $new$  select r.position_6_amendment_id as amendment_id,
    r.position_6_amendment_hash as amendment_hash,
    r.position_6_effective_contract_hash as effective_position_contract_hash,
    r.position_6_effective_prompt_text as effective_prompt_text,
    r.position_6_effective_prompt_hash as effective_prompt_hash,
    r.main_source_hash, r.side_source_hash into v_resolved
  from public.resolve_ebay_reference_guided_position_6_effective_contract(
    'f166b395-8d3a-4921-b273-1a62a6032707'::uuid) r;$new$;
begin
  select pg_get_functiondef(
    'public.consume_ebay_reference_guided_successor_position_6(uuid,text,text,boolean)'::regprocedure
  ) into v_before;
  if position(v_old in v_before) = 0 then
    raise exception 'POSITION_6_RESOLVER_ALIAS_REPAIR_SOURCE_MISMATCH';
  end if;
  v_after := replace(v_before, v_old, v_new);
  if v_after = v_before or position(v_new in v_after) = 0 then
    raise exception 'POSITION_6_RESOLVER_ALIAS_REPAIR_NOT_APPLIED';
  end if;
  execute v_after;
end;
$repair$;

revoke all on function public.consume_ebay_reference_guided_successor_position_6(
  uuid,text,text,boolean) from public, anon, authenticated;
grant execute on function public.consume_ebay_reference_guided_successor_position_6(
  uuid,text,text,boolean) to service_role;

notify pgrst, 'reload schema';
