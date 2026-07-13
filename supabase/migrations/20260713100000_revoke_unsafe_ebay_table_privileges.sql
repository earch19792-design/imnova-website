-- Seller OS tables are operated through server-side services and guarded RPCs.
-- Keep only the existing authenticated admin reads that are protected by RLS.
-- PostgreSQL default privileges are role/schema scoped, not table-name scoped,
-- so future public tables must opt in to client access explicitly.

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

alter default privileges for role supabase_admin in schema public
  revoke all on tables from anon, authenticated;

do $$
declare
  seller_os_tables constant text[] := array[
    'ebay_active_listing_risk_events',
    'ebay_active_listing_sync_state',
    'ebay_active_listings',
    'ebay_category_learning_adjustments',
    'ebay_command_center_reviews',
    'ebay_draft_only_approvals',
    'ebay_draft_only_execution_ledger',
    'ebay_image_storage_cleanup_attempts',
    'ebay_image_storage_cleanup_jobs',
    'ebay_listing_image_assets',
    'ebay_listing_packages',
    'ebay_listing_performance_snapshots',
    'ebay_luna_best_selling_signals',
    'ebay_luna_opportunity_assessments',
    'ebay_luna_opportunity_queue',
    'ebay_luna_opportunity_queue_events',
    'ebay_luna_scan_runs',
    'ebay_manual_listing_links',
    'ebay_market_listing_observations',
    'ebay_seller_alert_delivery_attempts',
    'ebay_seller_alert_outbox',
    'ebay_seller_automation_runs',
    'ebay_seller_listing_templates',
    'ebay_seller_scan_tasks',
    'ebay_seller_whatsapp_alert_state'
  ];
  authenticated_read_tables constant text[] := array[
    'ebay_active_listing_risk_events',
    'ebay_active_listings',
    'ebay_command_center_reviews',
    'ebay_listing_packages',
    'ebay_luna_best_selling_signals',
    'ebay_luna_opportunity_assessments',
    'ebay_luna_opportunity_queue',
    'ebay_luna_opportunity_queue_events',
    'ebay_luna_scan_runs',
    'ebay_market_listing_observations',
    'ebay_seller_alert_delivery_attempts',
    'ebay_seller_alert_outbox',
    'ebay_seller_automation_runs',
    'ebay_seller_scan_tasks',
    'ebay_seller_whatsapp_alert_state'
  ];
  service_only_tables constant text[] := array[
    'ebay_active_listing_sync_state',
    'ebay_category_learning_adjustments',
    'ebay_draft_only_approvals',
    'ebay_draft_only_execution_ledger',
    'ebay_image_storage_cleanup_attempts',
    'ebay_image_storage_cleanup_jobs',
    'ebay_listing_image_assets',
    'ebay_listing_performance_snapshots',
    'ebay_manual_listing_links',
    'ebay_seller_listing_templates'
  ];
  unsafe_privileges constant text[] := array[
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'REFERENCES',
    'TRIGGER',
    'MAINTAIN'
  ];
  table_name text;
  privilege_name text;
begin
  foreach table_name in array seller_os_tables loop
    if to_regclass(format('public.%I', table_name)) is null then
      raise exception 'SELLER_OS_ACL_TABLE_MISSING:%', table_name;
    end if;

    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = table_name
        and c.relkind in ('r', 'p')
        and c.relrowsecurity
    ) then
      raise exception 'SELLER_OS_ACL_RLS_REQUIRED:%', table_name;
    end if;

    execute format(
      'revoke insert, update, delete, truncate, references, trigger, maintain on table public.%I from anon, authenticated',
      table_name
    );
    execute format(
      'revoke select on table public.%I from anon',
      table_name
    );
  end loop;

  foreach table_name in array service_only_tables loop
    execute format(
      'revoke select on table public.%I from authenticated',
      table_name
    );
  end loop;

  -- Fail closed if any effective unsafe privilege remains through role
  -- membership, PUBLIC, or another ACL path.
  foreach table_name in array seller_os_tables loop
    foreach privilege_name in array unsafe_privileges loop
      if has_table_privilege('anon', format('public.%I', table_name), privilege_name) then
        raise exception 'SELLER_OS_ACL_UNSAFE_PRIVILEGE:anon:%.%', table_name, privilege_name;
      end if;
      if has_table_privilege('authenticated', format('public.%I', table_name), privilege_name) then
        raise exception 'SELLER_OS_ACL_UNSAFE_PRIVILEGE:authenticated:%.%', table_name, privilege_name;
      end if;
    end loop;

    if has_table_privilege('anon', format('public.%I', table_name), 'SELECT') then
      raise exception 'SELLER_OS_ACL_UNEXPECTED_SELECT:anon:%', table_name;
    end if;

    if not has_table_privilege('service_role', format('public.%I', table_name), 'SELECT') then
      raise exception 'SELLER_OS_ACL_SERVICE_ROLE_SELECT_REQUIRED:%', table_name;
    end if;
  end loop;

  foreach table_name in array service_only_tables loop
    if has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT') then
      raise exception 'SELLER_OS_ACL_UNEXPECTED_SELECT:authenticated:%', table_name;
    end if;
  end loop;

  foreach table_name in array authenticated_read_tables loop
    if not has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT') then
      raise exception 'SELLER_OS_ACL_ADMIN_SELECT_MISSING:%', table_name;
    end if;

    if not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = table_name
        and p.cmd in ('SELECT', 'ALL')
        and 'authenticated' = any (p.roles::text[])
        and p.qual like '%is_admin()%'
    ) then
      raise exception 'SELLER_OS_ACL_ADMIN_SELECT_POLICY_MISSING:%', table_name;
    end if;
  end loop;

  if exists (
    select 1
    from pg_default_acl d
    join pg_roles owner_role on owner_role.oid = d.defaclrole
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(coalesce(d.defaclacl, acldefault('r', d.defaclrole))) acl
    join pg_roles grantee_role on grantee_role.oid = acl.grantee
    where owner_role.rolname in ('postgres', 'supabase_admin')
      and n.nspname = 'public'
      and d.defaclobjtype = 'r'
      and grantee_role.rolname in ('anon', 'authenticated')
  ) then
    raise exception 'SELLER_OS_ACL_UNSAFE_TABLE_DEFAULT_PRIVILEGES_REMAIN';
  end if;
end
$$;

notify pgrst, 'reload schema';
