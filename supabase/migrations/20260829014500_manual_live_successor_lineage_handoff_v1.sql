-- Reuse the existing manual-listing registration and post-publication Luna
-- handoff contracts for a manually-created LIVE successor of one compensated,
-- rearmed Golden Path lineage. The authenticated Trading GetItem remains the
-- only eBay authority. This migration performs no marketplace operation.

do $extend_existing_handoff$
declare
  v_signature regprocedure :=
    'public.handoff_ebay_authorized_publication_luna_linkage_v1(uuid,text,uuid,uuid)'
      ::regprocedure;
  v_definition text;
  v_declaration_old text := '  v_idempotent boolean := false;';
  v_declaration_new text := v_declaration_old || E'\n' ||
    '  v_manual_live_successor boolean := false;' || E'\n' ||
    '  v_compensated_active public.ebay_active_listings%rowtype;';
  v_gate_old text := $old$
  select * into v_publication
  from public.ebay_authorized_listing_publications publication
  where publication.id = p_publication_id
  for update;
  if not found
    or v_publication.phase not in (
      'published_pending_verification', 'monitor_registered'
    )
    or v_publication.listing_id is distinct from p_expected_listing_id
    or (v_publication.active_listing_id is not null and
      v_publication.active_listing_id is distinct from p_active_listing_id)
    or (v_publication.manual_registration_id is not null and
      v_publication.manual_registration_id is distinct from
        p_manual_registration_id) then
    raise exception 'POST_PUBLISH_LUNA_LINEAGE_PUBLICATION_NOT_EXACT';
  end if;$old$;
  v_gate_new text := $new$
  select * into v_publication
  from public.ebay_authorized_listing_publications publication
  where publication.id = p_publication_id
  for update;
  if not found then
    raise exception 'POST_PUBLISH_LUNA_LINEAGE_PUBLICATION_NOT_EXACT';
  end if;
  v_manual_live_successor :=
    v_publication.phase = 'preview_ready'
    and v_publication.listing_id is null
    and v_publication.active_listing_id is null
    and v_publication.manual_registration_id is null
    and v_publication.publication_idempotency_key is null
    and v_publication.claim_token is null
    and v_publication.publish_attempt_count = 0
    and v_publication.publish_recovery_count = 1
    and v_publication.sanitized_result->>'compensatedListingId'
      ~ '^[0-9]{9,20}$'
    and v_publication.sanitized_result->>'compensatingEndVerified' = 'true'
    and v_publication.sanitized_result->>'officialReadbackNotCurrentLive'
      = 'true';
  if (
    not v_manual_live_successor and (
      v_publication.phase not in (
        'published_pending_verification', 'monitor_registered'
      )
      or v_publication.listing_id is distinct from p_expected_listing_id
      or (v_publication.active_listing_id is not null and
        v_publication.active_listing_id is distinct from p_active_listing_id)
      or (v_publication.manual_registration_id is not null and
        v_publication.manual_registration_id is distinct from
          p_manual_registration_id)
    )
  ) then
    raise exception 'POST_PUBLISH_LUNA_LINEAGE_PUBLICATION_NOT_EXACT';
  end if;$new$;
  v_identity_old text :=
    '    or v_active.ebay_sku is distinct from v_publication.sku';
  v_identity_new text :=
    '    or (not v_manual_live_successor and' || E'\n' ||
    '      v_active.ebay_sku is distinct from v_publication.sku)';
  v_manual_guard_anchor text := $old$
  v_product_truth := v_opportunity.assessment -> 'productTruth';

  if v_approval.id is null or v_package.id is null$old$;
  v_manual_guard_replacement text := $new$
  v_product_truth := v_opportunity.assessment -> 'productTruth';

  if v_manual_live_successor then
    select * into v_compensated_active
    from public.ebay_active_listings active_listing
    where active_listing.account_key =
        v_publication.marketplace_account_key
      and active_listing.ebay_item_id =
        v_publication.sanitized_result->>'compensatedListingId'
      and active_listing.ebay_sku = v_publication.sku
      and active_listing.listing_status = 'ended'
    for update;
    if not found or exists (
      select 1 from public.ebay_active_listings competing
      where competing.account_key = v_publication.marketplace_account_key
        and competing.listing_status = 'active'
        and competing.id is distinct from p_active_listing_id
        and (
          competing.ebay_sku = v_publication.sku
          or competing.market_radar_product_id =
            v_opportunity.market_radar_product_id
        )
    ) then
      raise exception 'MANUAL_LIVE_SUCCESSOR_DUPLICATE_OR_HISTORY_MISMATCH';
    end if;
  end if;

  if v_approval.id is null or v_package.id is null$new$;
  v_lineage_old text := $old$
    'ebaySkuUsedAsSupplierIdentity', false
  );$old$;
  v_lineage_new text := $new$
    'ebaySkuUsedAsSupplierIdentity', false,
    'handoffMode', case when v_manual_live_successor
      then 'MANUAL_LIVE_SUCCESSOR'
      else 'CONTROLLED_PUBLICATION' end,
    'supersedesItemId', case when v_manual_live_successor
      then v_publication.sanitized_result->>'compensatedListingId'
      else null end
  );$new$;
begin
  select pg_get_functiondef(v_signature) into strict v_definition;
  if strpos(v_definition, v_declaration_new) = 0 then
    if strpos(v_definition, v_declaration_old) = 0 then
      raise exception 'MANUAL_LIVE_HANDOFF_DECLARATION_TARGET_MISSING';
    end if;
    v_definition := replace(
      v_definition, v_declaration_old, v_declaration_new
    );
  end if;
  if strpos(v_definition, v_gate_new) = 0 then
    if strpos(v_definition, v_gate_old) = 0 then
      raise exception 'MANUAL_LIVE_HANDOFF_GATE_TARGET_MISSING';
    end if;
    v_definition := replace(v_definition, v_gate_old, v_gate_new);
  end if;
  if strpos(v_definition, v_identity_new) = 0 then
    if strpos(v_definition, v_identity_old) = 0 then
      raise exception 'MANUAL_LIVE_HANDOFF_IDENTITY_TARGET_MISSING';
    end if;
    v_definition := replace(
      v_definition, v_identity_old, v_identity_new
    );
  end if;
  if strpos(v_definition, v_manual_guard_replacement) = 0 then
    if strpos(v_definition, v_manual_guard_anchor) = 0 then
      raise exception 'MANUAL_LIVE_HANDOFF_DUPLICATE_GUARD_TARGET_MISSING';
    end if;
    v_definition := replace(
      v_definition, v_manual_guard_anchor, v_manual_guard_replacement
    );
  end if;
  if strpos(v_definition, v_lineage_new) = 0 then
    if strpos(v_definition, v_lineage_old) = 0 then
      raise exception 'MANUAL_LIVE_HANDOFF_LINEAGE_TARGET_MISSING';
    end if;
    v_definition := replace(
      v_definition, v_lineage_old, v_lineage_new
    );
  end if;
  execute v_definition;
end;
$extend_existing_handoff$;

do $extend_existing_manual_registration$
declare
  v_signature regprocedure :=
    'public.register_ebay_manual_listing_link_canonical_core_v1(text,text,text,uuid,text,text,text,text,text,text,text,timestamptz,jsonb,uuid)'
      ::regprocedure;
  v_definition text;
  v_declaration_old text := $old$
  v_expected_ebay_sku text;
  v_relink_link_id uuid := null;$old$;
  v_declaration_new text := $new$
  v_expected_ebay_sku text;
  v_relink_link_id uuid := null;
  v_manual_successor_publication_id uuid := null;
  v_manual_successor_old_item_id text := null;$new$;
  v_conflict_old text := $old$
  if found and v_existing.ebay_item_id is distinct from p_ebay_item_id then
    if p_verification_status <> 'verified'
      or not exists (
        select 1 from public.ebay_active_listings old_active
        where old_active.id = v_existing.connector_listing_id
          and old_active.account_key = p_account_key
          and old_active.ebay_item_id = v_existing.ebay_item_id
          and old_active.ebay_sku = p_connector_ebay_sku
          and old_active.listing_status = 'ended'
      )
      or not exists (
        select 1 from public.ebay_authorized_listing_publications publication
        where publication.actor_user_id = p_actor_user_id
          and publication.marketplace_account_key = p_account_key
          and publication.opportunity_id = p_opportunity_id
          and publication.preview->>'candidateKey' = p_candidate_key
          and publication.phase = 'published_pending_verification'
          and publication.listing_id = p_ebay_item_id
          and publication.sku = p_connector_ebay_sku
          and publication.publish_recovery_count = 1
          and publication.sanitized_result->>'compensatedListingId'
            = v_existing.ebay_item_id
          and publication.sanitized_result->>'compensatingEndVerified' = 'true'
      ) then
      raise exception 'MANUAL_LISTING_CANDIDATE_ALREADY_LINKED';
    end if;
    v_relink_link_id := v_existing.id;
  end if;$old$;
  v_conflict_new text := $new$
  if found and v_existing.ebay_item_id is distinct from p_ebay_item_id then
    if p_verification_status = 'verified' and exists (
      select 1 from public.ebay_active_listings old_active
      where old_active.id = v_existing.connector_listing_id
        and old_active.account_key = p_account_key
        and old_active.ebay_item_id = v_existing.ebay_item_id
        and old_active.listing_status = 'ended'
    ) then
      select publication.id into v_manual_successor_publication_id
      from public.ebay_authorized_listing_publications publication
      join public.ebay_draft_only_approvals approval
        on approval.id = publication.draft_approval_id
      join public.ebay_draft_only_execution_ledger execution
        on execution.id = publication.draft_execution_id
      join public.ebay_listing_packages package
        on package.id = publication.listing_package_id
      where publication.actor_user_id = p_actor_user_id
        and publication.marketplace_account_key = p_account_key
        and publication.opportunity_id = p_opportunity_id
        and publication.preview->>'candidateKey' = p_candidate_key
        and publication.phase = 'preview_ready'
        and publication.listing_id is null
        and publication.active_listing_id is null
        and publication.manual_registration_id is null
        and publication.publication_idempotency_key is null
        and publication.claim_token is null
        and publication.publish_attempt_count = 0
        and publication.publish_recovery_count = 1
        and publication.sku = v_existing.connector_ebay_sku
        and publication.offer_id = execution.offer_id
        and publication.draft_approval_id = approval.id
        and publication.draft_execution_id = execution.id
        and approval.status = 'consumed'
        and approval.revoked_at is null
        and approval.payload_hash = execution.request_hash
        and approval.listing_package_id = package.id
        and execution.approval_id = approval.id
        and execution.phase = 'completed'
        and execution.listing_package_id = package.id
        and execution.opportunity_id = p_opportunity_id
        and execution.offer_id = publication.offer_id
        and execution.sku = publication.sku
        and package.opportunity_id = p_opportunity_id
        and package.candidate_key = p_candidate_key
        and package.account_key = p_account_key
        and publication.sanitized_result->>'compensatedListingId'
          = v_existing.ebay_item_id
        and publication.sanitized_result->>'compensatingEndVerified' = 'true'
        and publication.sanitized_result->>'officialReadbackNotCurrentLive'
          = 'true'
        and not exists (
          select 1 from public.ebay_active_listings competing
          where competing.account_key = p_account_key
            and competing.listing_status = 'active'
            and competing.ebay_item_id <> p_ebay_item_id
            and (
              competing.ebay_sku = publication.sku
              or competing.market_radar_product_id =
                v_opportunity.market_radar_product_id
            )
        )
      order by publication.updated_at desc
      limit 1
      for update of publication;
    end if;
    if v_manual_successor_publication_id is null and not exists (
      select 1 from public.ebay_authorized_listing_publications publication
      where publication.actor_user_id = p_actor_user_id
        and publication.marketplace_account_key = p_account_key
        and publication.opportunity_id = p_opportunity_id
        and publication.preview->>'candidateKey' = p_candidate_key
        and publication.phase = 'published_pending_verification'
        and publication.listing_id = p_ebay_item_id
        and publication.sku = v_existing.connector_ebay_sku
        and publication.publish_recovery_count = 1
        and publication.sanitized_result->>'compensatedListingId'
          = v_existing.ebay_item_id
        and publication.sanitized_result->>'compensatingEndVerified' = 'true'
    ) then
      raise exception 'MANUAL_LISTING_CANDIDATE_ALREADY_LINKED';
    end if;
    v_manual_successor_old_item_id := v_existing.ebay_item_id;
    v_relink_link_id := v_existing.id;
  end if;$new$;
  v_return_old text := $old$
    update public.ebay_seller_listing_templates
    set status = 'superseded', updated_by = p_actor_user_id,
        updated_at = now()
    where source_link_id = v_link.id and status = 'active';
    return next v_link;
    return;$old$;
  v_return_new text := $new$
    update public.ebay_seller_listing_templates
    set status = 'superseded', updated_by = p_actor_user_id,
        updated_at = now()
    where source_link_id = v_link.id and status = 'active';
    if v_manual_successor_publication_id is not null then
      perform public.handoff_ebay_authorized_publication_luna_linkage_v1(
        v_manual_successor_publication_id,
        p_ebay_item_id,
        v_link.connector_listing_id,
        v_link.id
      );
      update public.ebay_authorized_listing_publications publication
      set phase = 'terminal_failure',
          last_error_code = 'SUPERSEDED_BY_MANUAL_LIVE_ITEM',
          publication_idempotency_key = null,
          claim_token = null,
          lease_expires_at = null,
          sanitized_result = coalesce(
            publication.sanitized_result, '{}'::jsonb
          ) || jsonb_build_object(
            'lineageDispositionContract',
              'MANUAL_LIVE_SUCCESSOR_LINEAGE_RETIREMENT_V1',
            'lineageDisposition',
              'SUPERSEDED_BY_MANUAL_LIVE_ITEM_' || p_ebay_item_id,
            'supersededByManualLiveItemId', p_ebay_item_id,
            'supersededHistoricalItemId',
              v_manual_successor_old_item_id,
            'supersededOfferId', publication.offer_id,
            'supersededAt', clock_timestamp(),
            'marketplaceWrites', 0
          ),
          updated_at = clock_timestamp()
      where publication.id = v_manual_successor_publication_id
        and publication.phase = 'preview_ready'
        and publication.publish_attempt_count = 0
        and publication.publish_recovery_count = 1;
      if not found then
        raise exception 'MANUAL_LIVE_SUCCESSOR_LINEAGE_RETIREMENT_FAILED';
      end if;
    end if;
    return next v_link;
    return;$new$;
begin
  select pg_get_functiondef(v_signature) into strict v_definition;
  if strpos(v_definition, v_declaration_new) = 0 then
    if strpos(v_definition, v_declaration_old) = 0 then
      raise exception 'MANUAL_LIVE_RELINK_DECLARATION_TARGET_MISSING';
    end if;
    v_definition := replace(
      v_definition, v_declaration_old, v_declaration_new
    );
  end if;
  if strpos(v_definition, v_conflict_new) = 0 then
    if strpos(v_definition, v_conflict_old) = 0 then
      raise exception 'MANUAL_LIVE_RELINK_CONFLICT_TARGET_MISSING';
    end if;
    v_definition := replace(v_definition, v_conflict_old, v_conflict_new);
  end if;
  if strpos(v_definition, v_return_new) = 0 then
    if strpos(v_definition, v_return_old) = 0 then
      raise exception 'MANUAL_LIVE_RELINK_RETIREMENT_TARGET_MISSING';
    end if;
    v_definition := replace(v_definition, v_return_old, v_return_new);
  end if;
  execute v_definition;
end;
$extend_existing_manual_registration$;

do $assert_contracts$
declare
  v_handoff text;
  v_registration text;
begin
  select pg_get_functiondef(
    'public.handoff_ebay_authorized_publication_luna_linkage_v1(uuid,text,uuid,uuid)'
      ::regprocedure
  ) into strict v_handoff;
  select pg_get_functiondef(
    'public.register_ebay_manual_listing_link_canonical_core_v1(text,text,text,uuid,text,text,text,text,text,text,text,timestamptz,jsonb,uuid)'
      ::regprocedure
  ) into strict v_registration;
  if strpos(v_handoff, 'MANUAL_LIVE_SUCCESSOR') = 0
    or strpos(v_handoff,
      'MANUAL_LIVE_SUCCESSOR_DUPLICATE_OR_HISTORY_MISMATCH') = 0
    or strpos(v_registration,
      'SUPERSEDED_BY_MANUAL_LIVE_ITEM_') = 0
    or strpos(v_registration,
      'handoff_ebay_authorized_publication_luna_linkage_v1') = 0 then
    raise exception 'MANUAL_LIVE_SUCCESSOR_CONTRACT_INSTALLATION_FAILED';
  end if;
end;
$assert_contracts$;

comment on function
  public.register_ebay_manual_listing_link_canonical_core_v1(
    text, text, text, uuid, text, text, text, text, text, text, text,
    timestamptz, jsonb, uuid
  ) is
  'Registers exact official manual-listing evidence and atomically transfers one compensated rearmed lineage to its verified LIVE manual successor without an eBay write.';

comment on function
  public.handoff_ebay_authorized_publication_luna_linkage_v1(
    uuid, text, uuid, uuid
  ) is
  'Idempotently certifies exact Luna linkage from the authorized candidate/package lineage after controlled publication or exact verified manual LIVE succession. It never infers supplier identity from title or eBay SKU and performs no marketplace write.';

notify pgrst, 'reload schema';
