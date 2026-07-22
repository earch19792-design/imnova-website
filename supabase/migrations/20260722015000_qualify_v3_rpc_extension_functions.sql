do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ensure_visual_strategy_v3_revision_from_binding'
  limit 1;
  if v_def is null then raise exception 'V3_RPC_NOT_FOUND'; end if;
  v_def := replace(v_def, 'digest(', 'extensions.digest(');
  v_def := replace(v_def, 'gen_random_uuid()', 'extensions.gen_random_uuid()');
  execute v_def;
end $$;
notify pgrst, 'reload schema';
