-- Resolve incompatible draft-only approvals without touching eBay.
-- The mutation is append-only at the event level and service-role only.

alter table public.ebay_draft_only_approvals
  drop constraint if exists ebay_draft_only_approvals_status_check;
alter table public.ebay_draft_only_approvals
  add constraint ebay_draft_only_approvals_status_check
  check (status in (
    'approved',
    'consumed',
    'revoked',
    'expired',
    'SUPERSEDED_BY_RECONCILIATION'
  ));

create table if not exists public.ebay_draft_only_approval_reconciliation_events (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null
    references public.ebay_draft_only_approvals(id) on delete restrict,
  listing_package_id uuid not null
    references public.ebay_listing_packages(id) on delete restrict,
  opportunity_id uuid not null
    references public.ebay_luna_opportunity_queue(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  old_preview_hash text not null check (old_preview_hash ~ '^[0-9a-f]{64}$'),
  old_payload_hash text not null check (old_payload_hash ~ '^[0-9a-f]{64}$'),
  new_preview_hash text not null check (new_preview_hash ~ '^[0-9a-f]{64}$'),
  new_payload_hash text not null check (new_payload_hash ~ '^[0-9a-f]{64}$'),
  target_account_fingerprint text not null
    check (target_account_fingerprint ~ '^[0-9a-f]{64}$'),
  action_version text not null
    check (action_version ~ '^[A-Za-z0-9._:-]{1,80}$'),
  reason text not null
    check (reason = 'PAYLOAD_RECONCILED_BEFORE_EBAY_WRITE'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (approval_id)
);

alter table public.ebay_draft_only_approval_reconciliation_events
  enable row level security;
alter table public.ebay_draft_only_approval_reconciliation_events
  force row level security;

revoke all on public.ebay_draft_only_approval_reconciliation_events
  from public, anon, authenticated, service_role;
grant select, insert on public.ebay_draft_only_approval_reconciliation_events
  to service_role;

create or replace function public.reject_ebay_draft_only_append_only_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'EBAY_DRAFT_ONLY_APPEND_ONLY';
end;
$$;

revoke all on function public.reject_ebay_draft_only_append_only_mutation()
  from public;
revoke all on function public.reject_ebay_draft_only_append_only_mutation()
  from anon, authenticated;
grant execute on function public.reject_ebay_draft_only_append_only_mutation()
  to service_role;

drop trigger if exists ebay_draft_only_approval_reconciliation_events_append_only
on public.ebay_draft_only_approval_reconciliation_events;
create trigger ebay_draft_only_approval_reconciliation_events_append_only
before update or delete on public.ebay_draft_only_approval_reconciliation_events
for each row execute function public.reject_ebay_draft_only_append_only_mutation();

create or replace function public.reconcile_ebay_draft_only_approval_conflict(
  p_listing_package_id uuid,
  p_actor_user_id uuid,
  p_current_preview_hash text,
  p_current_payload_hash text,
  p_target_account_fingerprint text,
  p_action_version text
)
returns setof public.ebay_draft_only_approval_reconciliation_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_package public.ebay_listing_packages%rowtype;
  v_active_approval public.ebay_draft_only_approvals%rowtype;
  v_current_preview public.ebay_v3_unpublished_offer_authorization_previews%rowtype;
  v_old_preview public.ebay_v3_unpublished_offer_authorization_previews%rowtype;
  v_assets jsonb;
  v_asset jsonb;
  v_roles text[] := array[
    'PRIMARY_MAIN',
    'SECONDARY_MATERIAL_DETAIL',
    'SECONDARY_PACKAGE_CONTENTS',
    'SECONDARY_SCALE_CAPACITY',
    'SECONDARY_USE_CONTEXT',
    'SECONDARY_ASPIRATIONAL_LIFESTYLE',
    'SECONDARY_HUMAN_CONTEXT'
  ];
  v_event public.ebay_draft_only_approval_reconciliation_events%rowtype;
begin
  if p_listing_package_id is null
    or p_actor_user_id is null
    or p_current_preview_hash !~ '^[0-9a-f]{64}$'
    or p_current_payload_hash !~ '^[0-9a-f]{64}$'
    or p_target_account_fingerprint !~ '^[0-9a-f]{64}$'
    or p_action_version !~ '^[A-Za-z0-9._:-]{1,80}$' then
    raise exception 'EBAY_DRAFT_ONLY_RECONCILIATION_INPUT_INVALID';
  end if;

  select * into v_package
  from public.ebay_listing_packages
  where id = p_listing_package_id
  for update;
  if not found
    or v_package.created_by is distinct from p_actor_user_id
    or v_package.status not in ('draft', 'ready_for_review', 'approved') then
    raise exception 'EBAY_DRAFT_ONLY_RECONCILIATION_PACKAGE_INVALID';
  end if;

  select * into v_active_approval
  from public.ebay_draft_only_approvals
  where listing_package_id = p_listing_package_id
    and status = 'approved'
  for update;
  if not found
    or v_active_approval.actor_user_id is distinct from p_actor_user_id
    or v_active_approval.consumed_at is not null
    or v_active_approval.revoked_at is not null
    or v_active_approval.payload_hash is null
    or v_active_approval.payload_hash = p_current_payload_hash then
    raise exception 'EBAY_DRAFT_ONLY_RECONCILIATION_APPROVAL_INVALID';
  end if;

  select * into v_current_preview
  from public.ebay_v3_unpublished_offer_authorization_previews
  where listing_package_id = p_listing_package_id
    and created_by = p_actor_user_id
    and exact_preview_hash = p_current_preview_hash
    and payload_hash = p_current_payload_hash
  order by created_at desc
  limit 1;
  if not found
    or v_current_preview.account_fingerprint <> p_target_account_fingerprint
    or v_current_preview.status <> 'READY_FOR_HUMAN_AUTHORIZATION'
    or v_current_preview.provider_calls_snapshot <> 8
    or v_current_preview.inventory_item_created
    or v_current_preview.offer_created
    or v_current_preview.publish_offer_called
    or v_current_preview.ebay_writes <> 0
    or v_current_preview.production_changed
    or v_current_preview.preflight_snapshot_expires_at <= now() then
    raise exception 'EBAY_DRAFT_ONLY_RECONCILIATION_PREVIEW_INVALID';
  end if;

  v_assets := coalesce(
    v_current_preview.exact_payload #> '{compliance,v3FinalSetAuthorization,selectedAssets}',
    '[]'::jsonb
  );
  if jsonb_typeof(v_assets) <> 'array'
    or jsonb_array_length(v_assets) <> 7 then
    raise exception 'EBAY_DRAFT_ONLY_RECONCILIATION_SELECTION_INVALID';
  end if;
  for i in 0..6 loop
    v_asset := v_assets -> i;
    if v_asset is null
      or coalesce((v_asset ->> 'position')::integer, -1) <> i
      or coalesce(v_asset ->> 'assetRole', '') <> v_roles[i + 1]
      or coalesce(v_asset ->> 'sha256', '') !~ '^[0-9a-f]{64}$' then
      raise exception 'EBAY_DRAFT_ONLY_RECONCILIATION_SELECTION_INVALID';
    end if;
  end loop;

  select * into v_old_preview
  from public.ebay_v3_unpublished_offer_authorization_previews
  where listing_package_id = p_listing_package_id
    and created_by = p_actor_user_id
    and payload_hash = v_active_approval.payload_hash
  order by created_at desc
  limit 1;
  if not found then
    raise exception 'EBAY_DRAFT_ONLY_RECONCILIATION_HISTORY_NOT_FOUND';
  end if;

  update public.ebay_draft_only_approvals
  set status = 'SUPERSEDED_BY_RECONCILIATION',
      updated_at = now()
  where id = v_active_approval.id
    and status = 'approved';
  if not found then
    raise exception 'EBAY_DRAFT_ONLY_RECONCILIATION_SUPERSEDE_FAILED';
  end if;

  insert into public.ebay_draft_only_approval_reconciliation_events (
    approval_id,
    listing_package_id,
    opportunity_id,
    actor_user_id,
    old_preview_hash,
    old_payload_hash,
    new_preview_hash,
    new_payload_hash,
    target_account_fingerprint,
    action_version,
    reason,
    created_by
  ) values (
    v_active_approval.id,
    p_listing_package_id,
    v_active_approval.opportunity_id,
    p_actor_user_id,
    v_old_preview.exact_preview_hash,
    v_active_approval.payload_hash,
    v_current_preview.exact_preview_hash,
    p_current_payload_hash,
    p_target_account_fingerprint,
    p_action_version,
    'PAYLOAD_RECONCILED_BEFORE_EBAY_WRITE',
    p_actor_user_id
  ) returning * into v_event;

  return next v_event;
end;
$$;

revoke all on function public.reconcile_ebay_draft_only_approval_conflict(
  uuid, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.reconcile_ebay_draft_only_approval_conflict(
  uuid, uuid, text, text, text, text
) to service_role;
