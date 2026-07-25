-- Allow Luna reconfirmation while a candidate is in WAITING_ITEM_ID.
-- This keeps the same no-write safety contract and preserves all existing
-- binding and governance checks from the current reconfirm function.

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.reconfirm_ebay_ready_publication_luna_v1(text,uuid,uuid,uuid,numeric,boolean,integer,timestamptz)'::regprocedure
  ) into v_definition;
  if v_definition is null then
    raise exception 'SELLER_OS_RECONFIRM_LUNA_FN_MISSING';
  end if;

  if position(
    'or v_candidate.machine_state is distinct from ''READY_FOR_MANUAL_PUBLICATION''' in v_definition
  ) > 0 then
    v_definition := replace(
      v_definition,
      'or v_candidate.machine_state is distinct from ''READY_FOR_MANUAL_PUBLICATION''',
      'or not (v_candidate.machine_state in (''READY_FOR_MANUAL_PUBLICATION'', ''WAITING_ITEM_ID''))'
    );
    execute v_definition;
  elsif position(
    'or v_candidate.machine_state not in (''READY_FOR_MANUAL_PUBLICATION'', ''WAITING_ITEM_ID'')' in v_definition
  ) = 0 then
    raise exception 'SELLER_OS_RECONFIRM_LUNA_FN_UNEXPECTED_STATE_CHECK';
  end if;

  notify pgrst, 'reload schema';
end;
$$;

