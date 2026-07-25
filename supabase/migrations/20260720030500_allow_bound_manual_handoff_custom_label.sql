-- Permit a Seller Hub Custom Label only when it is either the canonical
-- package SKU or the exact safe label persisted in both the candidate and its
-- append-only READY_FOR_MANUAL_PUBLICATION handoff. Ownership and ACTIVE
-- status remain verified by the authenticated Trading read before this RPC.

alter table public.ebay_manual_listing_links
  drop constraint if exists ebay_manual_listing_verification_evidence_check;

alter table public.ebay_manual_listing_links
  add constraint ebay_manual_listing_verification_evidence_check check (
    (
      verification_status = 'verified'
      and verification_method in (
        'EBAY_TRADING_GET_ITEM_READONLY',
        'EBAY_SELL_INVENTORY_READONLY'
      )
      and connector_listing_id is not null
      and connector_listing_status in ('active', 'paused')
      and connector_ebay_sku ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,49}$'
      and verified_at is not null
    ) or (
      verification_status = 'pending_manual_verification'
      and connector_listing_id is null
      and connector_listing_status is null
      and connector_ebay_sku is null
      and verified_at is null
    )
  );

alter function public.register_ebay_manual_listing_link(
  text, text, text, uuid, text, text, text, text, text, text, text,
  timestamptz, jsonb, uuid
) rename to register_ebay_manual_listing_link_canonical_core_v1;

revoke all on function public.register_ebay_manual_listing_link_canonical_core_v1(
  text, text, text, uuid, text, text, text, text, text, text, text,
  timestamptz, jsonb, uuid
) from public, anon, authenticated, service_role;

create function public.register_ebay_manual_listing_link(
  p_account_key text,
  p_ebay_item_id text,
  p_ebay_url text,
  p_opportunity_id uuid,
  p_candidate_key text,
  p_supplier_variant_id text,
  p_supplier_sku text,
  p_verification_status text,
  p_verification_method text,
  p_verification_reason text,
  p_connector_ebay_sku text,
  p_connector_observed_at timestamptz,
  p_safe_defaults jsonb,
  p_actor_user_id uuid
)
returns setof public.ebay_manual_listing_links
language plpgsql
security definer
set search_path = public
as $$
declare
  v_package public.ebay_listing_packages%rowtype;
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_handoff public.ebay_same_day_pilot_handoffs%rowtype;
  v_link public.ebay_manual_listing_links%rowtype;
  v_expected_ebay_sku text;
  v_candidate_custom_label text;
  v_handoff_custom_label text;
  v_candidate_package_hash text;
  v_core_connector_sku text;
  v_reason text := p_verification_reason;
  v_bound_handoff_label boolean := false;
begin
  if p_verification_status = 'verified' then
    select package.* into v_package
    from public.ebay_listing_packages package
    where package.opportunity_id = p_opportunity_id
      and package.candidate_key = p_candidate_key
      and package.account_key = p_account_key
    for key share;
    if not found then
      raise exception 'MANUAL_LISTING_CANONICAL_PACKAGE_REQUIRED';
    end if;

    v_expected_ebay_sku := concat(
      'IMNOVA-', upper(replace(v_package.id::text, '-', ''))
    );

    if p_connector_ebay_sku is distinct from v_expected_ebay_sku then
      select candidate.* into v_candidate
      from public.ebay_same_day_pilot_candidates candidate
      join public.ebay_same_day_pilot_runs run on run.id = candidate.run_id
      where candidate.opportunity_id = p_opportunity_id
        and candidate.candidate_key = p_candidate_key
        and run.marketplace_account_key = p_account_key
        and candidate.state in (
          'READY_FOR_MANUAL_PUBLICATION',
          'PUBLISHED_PENDING_VERIFICATION',
          'VERIFIED_ACTIVE'
        )
        and candidate.machine_state in (
          'READY_FOR_MANUAL_PUBLICATION',
          'WAITING_ITEM_ID',
          'VERIFYING_PUBLISHED_LISTING',
          'REGISTERING_COMMERCIAL_MONITOR',
          'VERIFIED_ACTIVE'
        )
      order by candidate.updated_at desc
      limit 1
      for share of candidate;
    if not found then
      raise exception 'MANUAL_LISTING_AUTHORITATIVE_CUSTOM_LABEL_MISMATCH';
    end if;

    select handoff.* into v_handoff
    from public.ebay_same_day_pilot_handoffs handoff
    where handoff.run_id = v_candidate.run_id
      and handoff.candidate_id = v_candidate.id
      and handoff.status = 'READY_FOR_MANUAL_PUBLICATION'
    order by handoff.created_at desc
    limit 1;
    if not found then
      raise exception 'MANUAL_LISTING_AUTHORITATIVE_CUSTOM_LABEL_MISMATCH';
    end if;

    v_candidate_custom_label := nullif(trim(
      v_candidate.manual_handoff_package #>> '{package,customLabel}'
    ), '');
    v_handoff_custom_label := nullif(trim(
      v_handoff.package_data ->> 'customLabel'
    ), '');
    v_candidate_package_hash := nullif(trim(
      v_candidate.manual_handoff_package ->> 'packageHash'
    ), '');

    v_bound_handoff_label :=
      v_candidate_custom_label ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,49}$'
      and v_candidate_custom_label = v_handoff_custom_label
      and p_connector_ebay_sku = v_candidate_custom_label
      and v_candidate.manual_handoff_package #>> '{package,candidateId}' =
        v_candidate.id::text
      and v_handoff.package_data ->> 'candidateId' = v_candidate.id::text
      and v_candidate_package_hash ~ '^[0-9a-f]{64}$'
      and v_candidate_package_hash = v_handoff.package_hash;

    if v_bound_handoff_label is distinct from true then
      raise exception 'MANUAL_LISTING_AUTHORITATIVE_CUSTOM_LABEL_MISMATCH';
    end if;

    v_core_connector_sku := v_expected_ebay_sku;
    v_reason :=
      'OWNERSHIP_AND_AUTHORITATIVE_HANDOFF_CUSTOM_LABEL_CONFIRMED_TRADING_READONLY';
    else
      v_core_connector_sku := p_connector_ebay_sku;
    end if;
  else
    v_core_connector_sku := p_connector_ebay_sku;
  end if;

  select * into v_link
  from public.register_ebay_manual_listing_link_canonical_core_v1(
    p_account_key,
    p_ebay_item_id,
    p_ebay_url,
    p_opportunity_id,
    p_candidate_key,
    p_supplier_variant_id,
    p_supplier_sku,
    p_verification_status,
    p_verification_method,
    v_reason,
    v_core_connector_sku,
    p_connector_observed_at,
    p_safe_defaults,
    p_actor_user_id
  );

  if p_verification_status = 'verified' and v_bound_handoff_label then
    update public.ebay_active_listings
    set
      ebay_sku = p_connector_ebay_sku,
      raw_payload = raw_payload || jsonb_build_object(
        'observedEbaySku', p_connector_ebay_sku,
        'canonicalPackageSku', v_expected_ebay_sku,
        'productIdentityBinding',
          'AUTHORITATIVE_MANUAL_HANDOFF_CUSTOM_LABEL'
      ),
      updated_at = p_connector_observed_at
    where id = v_link.connector_listing_id;

    update public.ebay_manual_listing_links
    set
      connector_ebay_sku = p_connector_ebay_sku,
      verification_reason = v_reason,
      updated_at = now()
    where id = v_link.id
    returning * into v_link;
  end if;

  return next v_link;
end;
$$;

revoke all on function public.register_ebay_manual_listing_link(
  text, text, text, uuid, text, text, text, text, text, text, text,
  timestamptz, jsonb, uuid
) from public, anon, authenticated;

grant execute on function public.register_ebay_manual_listing_link(
  text, text, text, uuid, text, text, text, text, text, text, text,
  timestamptz, jsonb, uuid
) to service_role;

comment on function public.register_ebay_manual_listing_link(
  text, text, text, uuid, text, text, text, text, text, text, text,
  timestamptz, jsonb, uuid
) is
  'Registers an owned active Seller Hub listing. Product identity must match the canonical package SKU or the exact safe Custom Label bound in both the candidate and append-only manual handoff.';

notify pgrst, 'reload schema';
