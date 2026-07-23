-- Additive repair for a second PL/pgSQL output-column collision. Preserve the
-- already-applied migration and replace only the ambiguous provider-event
-- predicate in the installed function definition. This migration writes no
-- authorization, budget, lease, output, eBay, or production data.

do $repair_extraordinary_consume$
declare
  v_signature regprocedure :=
    'public.consume_ebay_reference_guided_extraordinary_position_4(uuid,uuid,text,text,boolean)'::regprocedure;
  v_before text;
  v_after text;
begin
  select pg_get_functiondef(v_signature) into v_before;
  v_after := replace(v_before,
    'from public.ebay_reference_guided_extraordinary_provider_events
      where authorization_event_id=v_authorization.id',
    'from public.ebay_reference_guided_extraordinary_provider_events authorization_provider_event
      where authorization_provider_event.authorization_event_id=v_authorization.id');
  if v_after = v_before then
    raise exception 'EXTRAORDINARY_CONSUME_AUTHORIZATION_COLUMN_REPAIR_NOT_APPLIED';
  end if;
  execute v_after;
end;
$repair_extraordinary_consume$;

revoke all on function public.consume_ebay_reference_guided_extraordinary_position_4(
  uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.consume_ebay_reference_guided_extraordinary_position_4(
  uuid,uuid,text,text,boolean) to service_role;

notify pgrst,'reload schema';
