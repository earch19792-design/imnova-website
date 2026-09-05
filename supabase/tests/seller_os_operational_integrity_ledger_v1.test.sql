begin;

do $$
declare
  v_runs_rls boolean;
  v_ledger_rls boolean;
  v_anon_grants integer;
  v_authenticated_grants integer;
begin
  select relrowsecurity into v_runs_rls
  from pg_class
  where oid = 'public.seller_os_operational_integrity_runs_v1'::regclass;
  select relrowsecurity into v_ledger_rls
  from pg_class
  where oid = 'public.seller_os_operational_learning_ledger_v1'::regclass;
  if not v_runs_rls or not v_ledger_rls then
    raise exception 'OPERATIONAL_INTEGRITY_RLS_REQUIRED';
  end if;

  select count(*) into v_anon_grants
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in (
      'seller_os_operational_integrity_runs_v1',
      'seller_os_operational_learning_ledger_v1'
    )
    and grantee = 'anon';
  select count(*) into v_authenticated_grants
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in (
      'seller_os_operational_integrity_runs_v1',
      'seller_os_operational_learning_ledger_v1'
    )
    and grantee = 'authenticated';
  if v_anon_grants <> 0 or v_authenticated_grants <> 0 then
    raise exception 'OPERATIONAL_INTEGRITY_CLIENT_GRANT_FORBIDDEN';
  end if;
end;
$$;

rollback;
