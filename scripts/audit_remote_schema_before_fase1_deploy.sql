-- IMNOVA OS Fase 1E remote schema audit.
-- Read-only script for Supabase SQL Editor.
-- This file intentionally contains SELECT statements only.
-- It does not read emails, phone numbers, names, or other personal data.

select
  'audit_context' as audit_section,
  current_database() as database_name,
  current_schema() as active_schema,
  current_user as executed_as,
  now() as audited_at,
  version() as postgres_version;

select
  'expected_public_table_existence' as audit_section,
  expected_table,
  to_regclass('public.' || expected_table) is not null as exists_in_public
from (
  values
    ('products'),
    ('product_states'),
    ('product_images'),
    ('strategic_niches'),
    ('strategic_subniches'),
    ('product_subniches'),
    ('subscribers'),
    ('communication_preferences'),
    ('community_interest_areas'),
    ('subscriber_area_interests'),
    ('subscriber_interests'),
    ('community_referral_codes'),
    ('community_referrals'),
    ('community_points_ledger'),
    ('community_member_status'),
    ('community_levels'),
    ('community_idea_votes'),
    ('trend_radar_signals'),
    ('idea_lab_items'),
    ('transparency_wall_items'),
    ('community_vip_rewards'),
    ('community_reward_redemptions')
) as expected(expected_table)
order by expected_table;

select
  'expected_public_view_existence' as audit_section,
  expected_view,
  to_regclass('public.' || expected_view) is not null as exists_in_public
from (
  values
    ('public_products')
) as expected(expected_view)
order by expected_view;

select
  'expected_columns_presence' as audit_section,
  expected_table,
  expected_column,
  exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = expected_table
      and c.column_name = expected_column
  ) as column_exists
from (
  values
    ('products', 'id'),
    ('products', 'slug'),
    ('products', 'name'),
    ('products', 'state_id'),
    ('products', 'price'),
    ('products', 'visible'),
    ('products', 'is_public'),
    ('products', 'is_active'),
    ('products', 'strategic_niche_id'),
    ('products', 'primary_subniche_id'),
    ('subscribers', 'id'),
    ('subscribers', 'email'),
    ('subscribers', 'telefono'),
    ('subscribers', 'nichos'),
    ('communication_preferences', 'subscriber_id'),
    ('communication_preferences', 'channel'),
    ('communication_preferences', 'frequency_preference'),
    ('communication_preferences', 'consent_text'),
    ('communication_preferences', 'consent_version'),
    ('communication_preferences', 'opted_in_at'),
    ('subscriber_area_interests', 'subscriber_id'),
    ('subscriber_area_interests', 'area_key'),
    ('subscriber_area_interests', 'source'),
    ('subscriber_interests', 'subscriber_id'),
    ('subscriber_interests', 'subniche_id'),
    ('subscriber_interests', 'source'),
    ('community_referral_codes', 'subscriber_id'),
    ('community_referral_codes', 'code'),
    ('community_referrals', 'referrer_subscriber_id'),
    ('community_referrals', 'referred_subscriber_id'),
    ('community_points_ledger', 'subscriber_id'),
    ('community_points_ledger', 'event_type'),
    ('community_points_ledger', 'points'),
    ('community_points_ledger', 'idempotency_key'),
    ('community_member_status', 'subscriber_id'),
    ('community_member_status', 'points_total'),
    ('community_member_status', 'level_key'),
    ('community_idea_votes', 'dedupe_key'),
    ('community_idea_votes', 'vote_type'),
    ('community_idea_votes', 'subscriber_id')
) as expected(expected_table, expected_column)
order by expected_table, expected_column;

select
  'public_columns_detail' as audit_section,
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in (
    'products',
    'product_states',
    'product_images',
    'strategic_niches',
    'strategic_subniches',
    'product_subniches',
    'subscribers',
    'communication_preferences',
    'community_interest_areas',
    'subscriber_area_interests',
    'subscriber_interests',
    'community_referral_codes',
    'community_referrals',
    'community_points_ledger',
    'community_member_status',
    'community_levels',
    'community_idea_votes',
    'trend_radar_signals',
    'idea_lab_items',
    'transparency_wall_items',
    'community_vip_rewards',
    'community_reward_redemptions'
  )
order by c.table_name, c.ordinal_position;

select
  'public_constraints' as audit_section,
  ns.nspname as schema_name,
  cls.relname as table_name,
  con.conname as constraint_name,
  con.contype as constraint_type,
  pg_get_constraintdef(con.oid) as constraint_definition,
  con.convalidated as is_validated
from pg_constraint con
join pg_class cls on cls.oid = con.conrelid
join pg_namespace ns on ns.oid = cls.relnamespace
where ns.nspname = 'public'
  and cls.relname in (
    'products',
    'product_states',
    'product_images',
    'strategic_niches',
    'strategic_subniches',
    'product_subniches',
    'subscribers',
    'communication_preferences',
    'community_interest_areas',
    'subscriber_area_interests',
    'subscriber_interests',
    'community_referral_codes',
    'community_referrals',
    'community_points_ledger',
    'community_member_status',
    'community_levels',
    'community_idea_votes',
    'trend_radar_signals',
    'idea_lab_items',
    'transparency_wall_items',
    'community_vip_rewards',
    'community_reward_redemptions'
  )
order by cls.relname, con.conname;

select
  'public_indexes' as audit_section,
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'products',
    'product_states',
    'product_images',
    'strategic_niches',
    'strategic_subniches',
    'product_subniches',
    'subscribers',
    'communication_preferences',
    'community_interest_areas',
    'subscriber_area_interests',
    'subscriber_interests',
    'community_referral_codes',
    'community_referrals',
    'community_points_ledger',
    'community_member_status',
    'community_levels',
    'community_idea_votes',
    'trend_radar_signals',
    'idea_lab_items',
    'transparency_wall_items',
    'community_vip_rewards',
    'community_reward_redemptions'
  )
order by tablename, indexname;

select
  'public_triggers' as audit_section,
  ns.nspname as schema_name,
  cls.relname as table_name,
  trg.tgname as trigger_name,
  pg_get_triggerdef(trg.oid) as trigger_definition,
  not trg.tgisinternal as is_user_trigger
from pg_trigger trg
join pg_class cls on cls.oid = trg.tgrelid
join pg_namespace ns on ns.oid = cls.relnamespace
where ns.nspname = 'public'
  and not trg.tgisinternal
  and cls.relname in (
    'products',
    'product_states',
    'subscribers',
    'communication_preferences',
    'subscriber_area_interests',
    'subscriber_interests',
    'community_referral_codes',
    'community_referrals',
    'community_points_ledger',
    'community_member_status',
    'community_idea_votes',
    'trend_radar_signals',
    'idea_lab_items'
  )
order by cls.relname, trg.tgname;

select
  'public_functions_expected' as audit_section,
  proc.proname as function_name,
  pg_get_function_identity_arguments(proc.oid) as arguments,
  proc.prosecdef as security_definer,
  proc.provolatile as volatility
from pg_proc proc
join pg_namespace ns on ns.oid = proc.pronamespace
where ns.nspname = 'public'
  and proc.proname in (
    'is_admin',
    'set_updated_at',
    'generate_referral_code',
    'ensure_community_member_status',
    'award_community_points',
    'sync_community_member_status'
  )
order by proc.proname, arguments;

select
  'public_rls_status' as audit_section,
  ns.nspname as schema_name,
  cls.relname as table_name,
  cls.relrowsecurity as rls_enabled,
  cls.relforcerowsecurity as rls_forced
from pg_class cls
join pg_namespace ns on ns.oid = cls.relnamespace
where ns.nspname = 'public'
  and cls.relkind in ('r', 'p')
  and cls.relname in (
    'products',
    'product_states',
    'product_images',
    'strategic_niches',
    'strategic_subniches',
    'product_subniches',
    'subscribers',
    'communication_preferences',
    'community_interest_areas',
    'subscriber_area_interests',
    'subscriber_interests',
    'community_referral_codes',
    'community_referrals',
    'community_points_ledger',
    'community_member_status',
    'community_levels',
    'community_idea_votes',
    'trend_radar_signals',
    'idea_lab_items',
    'transparency_wall_items',
    'community_vip_rewards',
    'community_reward_redemptions'
  )
order by cls.relname;

select
  'public_rls_policies' as audit_section,
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'products',
    'product_states',
    'product_images',
    'strategic_niches',
    'strategic_subniches',
    'product_subniches',
    'subscribers',
    'communication_preferences',
    'community_interest_areas',
    'subscriber_area_interests',
    'subscriber_interests',
    'community_referral_codes',
    'community_referrals',
    'community_points_ledger',
    'community_member_status',
    'community_levels',
    'community_idea_votes',
    'trend_radar_signals',
    'idea_lab_items',
    'transparency_wall_items',
    'community_vip_rewards',
    'community_reward_redemptions'
  )
order by tablename, policyname;

select
  'public_table_grants' as audit_section,
  table_schema,
  table_name,
  grantee,
  privilege_type,
  is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role')
  and table_name in (
    'products',
    'product_states',
    'product_images',
    'strategic_niches',
    'strategic_subniches',
    'product_subniches',
    'subscribers',
    'communication_preferences',
    'community_interest_areas',
    'subscriber_area_interests',
    'subscriber_interests',
    'community_referral_codes',
    'community_referrals',
    'community_points_ledger',
    'community_member_status',
    'community_levels',
    'community_idea_votes',
    'trend_radar_signals',
    'idea_lab_items',
    'transparency_wall_items',
    'community_vip_rewards',
    'community_reward_redemptions',
    'public_products'
  )
order by table_name, grantee, privilege_type;

select
  'public_routine_grants' as audit_section,
  routine_schema,
  routine_name,
  grantee,
  privilege_type,
  is_grantable
from information_schema.routine_privileges
where routine_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role')
  and routine_name in (
    'is_admin',
    'set_updated_at',
    'generate_referral_code',
    'ensure_community_member_status',
    'award_community_points',
    'sync_community_member_status'
  )
order by routine_name, grantee, privilege_type;

select
  'public_views' as audit_section,
  schemaname,
  viewname,
  definition
from pg_views
where schemaname = 'public'
  and viewname in ('public_products')
order by viewname;

select
  'estimated_table_rows_no_pii' as audit_section,
  ns.nspname as schema_name,
  cls.relname as table_name,
  cls.reltuples::bigint as estimated_rows
from pg_class cls
join pg_namespace ns on ns.oid = cls.relnamespace
where ns.nspname = 'public'
  and cls.relkind in ('r', 'p')
  and cls.relname in (
    'products',
    'product_states',
    'subscribers',
    'communication_preferences',
    'subscriber_area_interests',
    'subscriber_interests',
    'community_referral_codes',
    'community_referrals',
    'community_points_ledger',
    'community_member_status',
    'community_levels',
    'community_idea_votes'
  )
order by cls.relname;

select
  'supabase_migration_table_visibility' as audit_section,
  ns.nspname as schema_name,
  cls.relname as table_name,
  cls.relkind as relation_kind
from pg_class cls
join pg_namespace ns on ns.oid = cls.relnamespace
where ns.nspname = 'supabase_migrations'
order by cls.relname;

select
  'supabase_migration_history' as audit_section,
  version,
  name
from supabase_migrations.schema_migrations
order by version;
