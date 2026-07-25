-- Asset.position is an append-only generation lineage position and can exceed
-- 0..6 after a recovered attempt. The approved package manifest owns the
-- seven-image publication order; this assertion only verifies the exact set.
-- Keep all identity, rights, QA, slot, source and human-approval checks.

do $migration$
declare
  v_signature regprocedure :=
    'public.assert_ebay_same_day_approved_v9_control_v1(uuid,text,uuid,uuid[])'
      ::regprocedure;
  v_definition text;
  v_legacy_clause text :=
    '      or asset.position not between 0 and 6' || chr(10);
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if v_definition is null then
    raise exception 'SAME_DAY_WORKSPACE_APPROVED_V9_FUNCTION_MISSING';
  end if;
  if strpos(v_definition, v_legacy_clause) = 0 then
    raise exception 'SAME_DAY_WORKSPACE_APPROVED_V9_POSITION_GATE_NOT_FOUND';
  end if;

  execute replace(v_definition, v_legacy_clause, '');
end;
$migration$;

comment on function
  public.assert_ebay_same_day_approved_v9_control_v1(
    uuid, text, uuid, uuid[]
  )
is
  'Validates the exact approved seven-asset set. Publication order is bound by the protected package manifest; historical asset lineage positions are not display indexes.';
