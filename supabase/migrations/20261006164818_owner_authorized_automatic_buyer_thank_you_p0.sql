-- P0 owner authorization for exactly one fixed buyer thank-you per official
-- paid eBay order. This is deliberately separate from listing, pricing,
-- inventory and order mutation authority.

create table if not exists public.seller_os_buyer_thank_you_policies_v1 (
  marketplace_account_key text not null,
  marketplace text not null,
  policy_name text not null,
  policy_version text not null,
  execution_authority text not null,
  template_version text not null,
  template_sha256 text not null,
  message_grain text not null,
  authorization_source text not null,
  owner_authorized_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (marketplace_account_key, marketplace),
  constraint seller_os_buyer_thank_you_policy_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint seller_os_buyer_thank_you_policy_name_check
    check (policy_name = 'OWNER_AUTHORIZED_AUTOMATIC_BUYER_THANK_YOU'),
  constraint seller_os_buyer_thank_you_policy_version_check
    check (policy_version =
      'OWNER_AUTHORIZED_AUTOMATIC_BUYER_THANK_YOU_V1'),
  constraint seller_os_buyer_thank_you_policy_authority_check
    check (execution_authority = 'OWNER_AUTHORIZED_FIXED_TEMPLATE'),
  constraint seller_os_buyer_thank_you_policy_template_check
    check (template_version = 'POST_PURCHASE_THANK_YOU_TEMPLATE_V1'
      and template_sha256 =
        'eab110987291c762c8a39f4451f5e7f6a3095f3f21a22f7d174a2ba3589f6a08'),
  constraint seller_os_buyer_thank_you_policy_grain_check
    check (message_grain = 'ONE_BUYER_THANK_YOU_PER_EBAY_ORDER'),
  constraint seller_os_buyer_thank_you_policy_source_check
    check (authorization_source =
      'OWNER_CONVERSATION_AUTHORIZATION_2026_10_06')
);

alter table public.seller_os_buyer_thank_you_policies_v1 enable row level security;

revoke all on table public.seller_os_buyer_thank_you_policies_v1
  from public, anon, authenticated;
grant select, insert, update on table
  public.seller_os_buyer_thank_you_policies_v1 to service_role;

drop policy if exists seller_os_buyer_thank_you_policy_service_select_v1
  on public.seller_os_buyer_thank_you_policies_v1;
create policy seller_os_buyer_thank_you_policy_service_select_v1
  on public.seller_os_buyer_thank_you_policies_v1
  for select to service_role using (true);

drop policy if exists seller_os_buyer_thank_you_policy_service_insert_v1
  on public.seller_os_buyer_thank_you_policies_v1;
create policy seller_os_buyer_thank_you_policy_service_insert_v1
  on public.seller_os_buyer_thank_you_policies_v1
  for insert to service_role with check (true);

drop policy if exists seller_os_buyer_thank_you_policy_service_update_v1
  on public.seller_os_buyer_thank_you_policies_v1;
create policy seller_os_buyer_thank_you_policy_service_update_v1
  on public.seller_os_buyer_thank_you_policies_v1
  for update to service_role using (true) with check (true);

comment on table public.seller_os_buyer_thank_you_policies_v1 is
  'Durable owner authorization for the canonical EBAY_US account, one fixed POST_PURCHASE_THANK_YOU_TEMPLATE_V1 per official paid order only.';

-- Bind the authorization to the account that owns the explicitly named
-- current order. If that evidence is absent, fall back only when exactly one
-- EBAY_US account has an active commercial configuration. Ambiguity creates
-- no policy row and the runtime remains fail-closed.
with target_candidates as (
  select distinct marketplace_account_key
  from public.commercial_alert_events
  where marketplace = 'EBAY_US'
    and marketplace_order_id = '12-15256-64974'
    and marketplace_account_key is not null
    and marketplace_account_key <> ''
), configured_candidates as (
  select distinct marketplace_account_key
  from public.commercial_threshold_configs
  where marketplace = 'EBAY_US'
    and active = true
    and marketplace_account_key is not null
    and marketplace_account_key <> ''
), canonical_account as (
  select min(marketplace_account_key) as marketplace_account_key
  from target_candidates
  having count(*) = 1
  union all
  select min(marketplace_account_key) as marketplace_account_key
  from configured_candidates
  where not exists (select 1 from target_candidates)
  having count(*) = 1
)
insert into public.seller_os_buyer_thank_you_policies_v1 (
  marketplace_account_key, marketplace, policy_name, policy_version,
  execution_authority, template_version, template_sha256, message_grain,
  authorization_source, owner_authorized_at, active
)
select marketplace_account_key, 'EBAY_US',
  'OWNER_AUTHORIZED_AUTOMATIC_BUYER_THANK_YOU',
  'OWNER_AUTHORIZED_AUTOMATIC_BUYER_THANK_YOU_V1',
  'OWNER_AUTHORIZED_FIXED_TEMPLATE',
  'POST_PURCHASE_THANK_YOU_TEMPLATE_V1',
  'eab110987291c762c8a39f4451f5e7f6a3095f3f21a22f7d174a2ba3589f6a08',
  'ONE_BUYER_THANK_YOU_PER_EBAY_ORDER',
  'OWNER_CONVERSATION_AUTHORIZATION_2026_10_06',
  '2026-10-06T16:36:34.947Z'::timestamptz,
  true
from canonical_account
on conflict (marketplace_account_key, marketplace) do update set
  policy_name = excluded.policy_name,
  policy_version = excluded.policy_version,
  execution_authority = excluded.execution_authority,
  template_version = excluded.template_version,
  template_sha256 = excluded.template_sha256,
  message_grain = excluded.message_grain,
  authorization_source = excluded.authorization_source,
  owner_authorized_at = excluded.owner_authorized_at,
  active = true,
  updated_at = clock_timestamp();

-- The legacy event name implied delivery even when the provider had never
-- been called. Preserve the immutable deduplication key and evidence while
-- moving the ledger to a workflow name with evidence-based stages.
update public.commercial_alert_events
set event_type = 'EBAY_BUYER_THANK_YOU_WORKFLOW',
    evidence = evidence || jsonb_build_object(
      'semanticEventType', 'EBAY_BUYER_THANK_YOU_WORKFLOW',
      'deliveryState', case
        when evidence->>'workflowState' = 'SUCCEEDED'
          and evidence->>'receiptStatus' = 'PRESENT'
          then 'ACCEPTED_BY_EBAY'
        when evidence->>'dispatchStarted' = 'true'
          then 'SEND_ATTEMPTED'
        else 'PREPARED'
      end,
      'deliveredConfirmed', false
    )
where marketplace = 'EBAY_US'
  and event_type = 'EBAY_BUYER_THANK_YOU_DELIVERY';
