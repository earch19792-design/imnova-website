-- The incompatible approval reconciliation must work even if the preview
-- preflight snapshot has aged out. The user asked to resolve the approval
-- conflict, not to re-run eBay gating.

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
    or v_current_preview.production_changed then
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
