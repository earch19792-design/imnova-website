-- IMNOVA OS Fase 1 / migration 005 verification.
-- Run after applying 202606180005_prod_reconcile_fase1_growth.sql.
-- This script is read-only and returns metadata only.

with expected_columns(table_name, column_name) as (
  values
    ('communication_preferences', 'frequency_preference'),
    ('communication_preferences', 'consent_version')
)
select
  'expected_columns' as check_group,
  table_name,
  column_name,
  exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = expected_columns.table_name
      and c.column_name = expected_columns.column_name
  ) as ok
from expected_columns
order by table_name, column_name;

with expected_tables(table_name) as (
  values
    ('community_levels'),
    ('community_member_status'),
    ('community_points_ledger'),
    ('community_referral_codes'),
    ('community_referrals'),
    ('community_vip_rewards'),
    ('community_reward_redemptions'),
    ('transparency_wall_items'),
    ('subscriber_interests'),
    ('product_subniches')
)
select
  'expected_tables' as check_group,
  table_name,
  to_regclass(format('public.%I', table_name)) is not null as ok
from expected_tables
order by table_name;

with expected_functions(function_name) as (
  values
    ('generate_referral_code'),
    ('ensure_community_member_status'),
    ('award_community_points'),
    ('sync_community_member_status')
)
select
  'expected_functions' as check_group,
  function_name,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = expected_functions.function_name
  ) as ok
from expected_functions
order by function_name;

with sensitive_tables(table_name) as (
  values
    ('subscribers'),
    ('communication_preferences'),
    ('subscriber_interests'),
    ('subscriber_area_interests'),
    ('community_member_status'),
    ('community_points_ledger'),
    ('community_referral_codes'),
    ('community_referrals'),
    ('community_reward_redemptions'),
    ('product_subniches')
)
select
  'rls_status' as check_group,
  table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from sensitive_tables
left join pg_class c
  on c.oid = to_regclass(format('public.%I', table_name))
order by table_name;

select
  'subscriber_interests_policies' as check_group,
  policyname,
  cmd,
  roles,
  qual is not null as has_using_expression,
  with_check is not null as has_check_expression
from pg_policies
where schemaname = 'public'
  and tablename = 'subscriber_interests'
order by policyname, cmd;

select
  'product_subniches_policies' as check_group,
  policyname,
  cmd,
  roles,
  qual is not null as has_using_expression,
  with_check is not null as has_check_expression
from pg_policies
where schemaname = 'public'
  and tablename = 'product_subniches'
order by policyname, cmd;

with protected_tables(table_name) as (
  values
    ('community_member_status'),
    ('community_points_ledger'),
    ('community_referral_codes'),
    ('community_referrals'),
    ('community_reward_redemptions'),
    ('subscriber_interests')
)
select
  'anon_write_grants_review' as check_group,
  protected_tables.table_name,
  coalesce(
    array_agg(privilege_type order by privilege_type)
      filter (where privilege_type is not null),
    array[]::text[]
  ) as anon_write_grants
from protected_tables
left join information_schema.role_table_grants g
  on g.table_schema = 'public'
  and g.table_name = protected_tables.table_name
  and g.grantee = 'anon'
  and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
group by protected_tables.table_name
order by protected_tables.table_name;

with backend_tables(table_name) as (
  values
    ('community_levels'),
    ('community_member_status'),
    ('community_points_ledger'),
    ('community_referral_codes'),
    ('community_referrals'),
    ('community_vip_rewards'),
    ('community_reward_redemptions'),
    ('transparency_wall_items'),
    ('subscriber_interests'),
    ('product_subniches')
)
select
  'service_role_permissions_review' as check_group,
  backend_tables.table_name,
  coalesce(
    array_agg(privilege_type order by privilege_type)
      filter (where privilege_type is not null),
    array[]::text[]
  ) as service_role_grants
from backend_tables
left join information_schema.role_table_grants g
  on g.table_schema = 'public'
  and g.table_name = backend_tables.table_name
  and g.grantee = 'service_role'
group by backend_tables.table_name
order by backend_tables.table_name;

select
  'service_role_function_permissions_review' as check_group,
  routine_name,
  privilege_type,
  grantee
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name in (
    'generate_referral_code',
    'ensure_community_member_status',
    'award_community_points',
    'sync_community_member_status'
  )
  and grantee = 'service_role'
order by routine_name, privilege_type;
