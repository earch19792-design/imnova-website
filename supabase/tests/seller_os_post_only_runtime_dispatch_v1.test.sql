begin;

do $$
declare
  v_config_rls boolean;
  v_receipt_rls boolean;
  v_client_grants integer;
  v_non_post_paths integer;
  v_get_dispatchers integer;
begin
  select relrowsecurity into v_config_rls from pg_class
  where oid = 'public.seller_os_post_runtime_scheduler_v1'::regclass;
  select relrowsecurity into v_receipt_rls from pg_class
  where oid =
    'public.seller_os_post_runtime_dispatch_receipts_v1'::regclass;
  if not v_config_rls or not v_receipt_rls then
    raise exception 'SELLER_OS_POST_RUNTIME_RLS_REQUIRED';
  end if;

  select count(*) into v_client_grants
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('seller_os_post_runtime_scheduler_v1',
      'seller_os_post_runtime_dispatch_receipts_v1')
    and grantee in ('anon', 'authenticated', 'service_role');
  if v_client_grants <> 0 then
    raise exception 'SELLER_OS_POST_RUNTIME_DIRECT_GRANT_FORBIDDEN';
  end if;

  select count(*) into v_non_post_paths
  from public.seller_os_post_runtime_scheduler_v1
  where endpoint_path !~ '^/api/(cron|runtime)/[a-z0-9-]{3,100}$';
  if v_non_post_paths <> 0 then
    raise exception 'SELLER_OS_POST_RUNTIME_PATH_INVALID';
  end if;

  select count(*) into v_get_dispatchers
  from (values
    ('public.dispatch_same_day_pilot_staging_worker(text,timestamp with time zone)'::regprocedure),
    ('public.dispatch_ebay_monitoring_staging_worker(text,timestamp with time zone)'::regprocedure),
    ('public.dispatch_seller_os_post_runtime_v1(text,timestamp with time zone)'::regprocedure)
  ) functions(signature)
  where pg_get_functiondef(functions.signature) ilike '%net.http_get%';
  if v_get_dispatchers <> 0 then
    raise exception 'SELLER_OS_GET_RUNTIME_DISPATCH_FORBIDDEN';
  end if;
end;
$$;

rollback;
