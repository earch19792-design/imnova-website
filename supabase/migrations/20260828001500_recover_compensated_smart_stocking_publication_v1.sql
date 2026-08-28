-- Permit one exact recovery after the publication Golden Path itself ended a
-- newly published listing because monitor persistence failed. The original
-- ended Item ID remains in the active-listing registry and publication audit;
-- the same canonical Offer may be rearmed only after the server proves that it
-- is UNPUBLISHED and that no competing live offer exists.

do $preserve_publication_history$
declare
  v_signature regprocedure :=
    'public.record_ebay_authorized_listing_published(uuid,uuid,text,integer,boolean)'::regprocedure;
  v_definition text;
  v_old text := '      sanitized_result = jsonb_build_object(';
  v_new text := '      sanitized_result = sanitized_result || jsonb_build_object(';
begin
  select pg_get_functiondef(v_signature) into strict v_definition;
  if strpos(v_definition, v_new) = 0 then
    if strpos(v_definition, v_old) = 0 then
      raise exception 'EBAY_COMPENSATED_PUBLICATION_HISTORY_PATCH_TARGET_MISSING';
    end if;
    execute replace(v_definition, v_old, v_new);
  end if;
end;
$preserve_publication_history$;

create or replace function
  public.rearm_ebay_authorized_listing_after_compensated_monitor_failure_once(
    p_publication_id uuid,
    p_actor_user_id uuid,
    p_confirm_publish text,
    p_expected_error_code text
  )
returns setof public.ebay_authorized_listing_publications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_publication public.ebay_authorized_listing_publications%rowtype;
  v_old_active public.ebay_active_listings%rowtype;
  v_old_link public.ebay_manual_listing_links%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_actor_user_id is null
    or p_confirm_publish <> 'PUBLICAR LISTING EN EBAY'
    or p_expected_error_code <>
      'EBAY_FINAL_PUBLICATION_MONITOR_PERSIST_FAILED' then
    raise exception 'EBAY_COMPENSATED_PUBLICATION_RECOVERY_INVALID';
  end if;

  select * into v_publication
  from public.ebay_authorized_listing_publications
  where id = p_publication_id
  for update;
  if not found
    or v_publication.actor_user_id is distinct from p_actor_user_id
    or v_publication.phase <> 'terminal_failure'
    or v_publication.last_error_code is distinct from p_expected_error_code
    or v_publication.listing_id !~ '^[0-9]{9,20}$'
    or v_publication.publish_attempt_count <> 1
    or v_publication.publish_recovery_count <> 0
    or v_publication.sanitized_result->>'attachmentFailed' <> 'true'
    or v_publication.sanitized_result->>'compensatingEndVerified' <> 'true'
    or v_publication.sanitized_result->>'officialReadbackNotCurrentLive'
      <> 'true'
    or not public.is_ebay_smart_stocking_authorized_publication_v1(
      v_publication.draft_approval_id,
      v_publication.listing_package_id,
      v_publication.opportunity_id,
      v_publication.actor_user_id,
      v_publication.marketplace_account_key
    ) then
    raise exception 'EBAY_COMPENSATED_PUBLICATION_RECOVERY_NOT_ELIGIBLE';
  end if;

  select * into v_old_active
  from public.ebay_active_listings
  where account_key = v_publication.marketplace_account_key
    and ebay_item_id = v_publication.listing_id
    and ebay_sku = v_publication.sku
    and listing_status = 'ended'
  for update;
  if not found then
    raise exception 'EBAY_COMPENSATED_PUBLICATION_ENDED_REGISTRY_REQUIRED';
  end if;

  select * into v_old_link
  from public.ebay_manual_listing_links
  where account_key = v_publication.marketplace_account_key
    and opportunity_id = v_publication.opportunity_id
    and candidate_key = v_publication.preview->>'candidateKey'
    and ebay_item_id = v_publication.listing_id
    and connector_listing_id = v_old_active.id
    and verification_status = 'verified'
    and connector_ebay_sku = v_publication.sku
  for update;
  if not found then
    raise exception 'EBAY_COMPENSATED_PUBLICATION_VERIFIED_LINK_REQUIRED';
  end if;

  if exists (
    select 1 from public.ebay_active_listings active
    where active.account_key = v_publication.marketplace_account_key
      and active.ebay_sku = v_publication.sku
      and active.listing_status = 'active'
  ) then
    raise exception 'EBAY_COMPENSATED_PUBLICATION_ACTIVE_DUPLICATE';
  end if;

  update public.ebay_authorized_listing_publications
  set phase = 'preview_ready',
      publication_idempotency_key = null,
      publish_attempt_count = 0,
      publish_recovery_count = 1,
      claim_token = null,
      lease_expires_at = null,
      publish_http_status = null,
      listing_id = null,
      active_listing_id = null,
      manual_registration_id = null,
      publish_started_at = null,
      published_at = null,
      verified_active_at = null,
      monitor_registered_at = null,
      preview_prepared_at = v_now,
      last_error_code = null,
      sanitized_result = sanitized_result || jsonb_build_object(
        'compensatedListingId', v_publication.listing_id,
        'compensatedFailureCode', p_expected_error_code,
        'compensatedRecoveryAuthorizedAt', v_now,
        'compensatedRecoveryCount', 1
      ),
      updated_at = v_now
  where id = p_publication_id
  returning * into v_publication;
  return next v_publication;
end;
$$;

revoke all on function
  public.rearm_ebay_authorized_listing_after_compensated_monitor_failure_once(
    uuid, uuid, text, text
  )
from public, anon, authenticated;
grant execute on function
  public.rearm_ebay_authorized_listing_after_compensated_monitor_failure_once(
    uuid, uuid, text, text
  )
to service_role;

do $relink_core$
declare
  v_signature regprocedure :=
    'public.register_ebay_manual_listing_link_canonical_core_v1(text,text,text,uuid,text,text,text,text,text,text,text,timestamptz,jsonb,uuid)'::regprocedure;
  v_definition text;
  v_declaration_old text := '  v_expected_ebay_sku text;';
  v_declaration_new text := v_declaration_old || E'\n' ||
    '  v_relink_link_id uuid := null;';
  v_conflict_old text := $old$
  if found and v_existing.ebay_item_id is distinct from p_ebay_item_id then
    raise exception 'MANUAL_LISTING_CANDIDATE_ALREADY_LINKED';
  end if;$old$;
  v_conflict_new text := $new$
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
  end if;$new$;
  v_insert_anchor text := $old$
  insert into public.ebay_manual_listing_links ($old$;
  v_insert_replacement text := $new$
  if v_relink_link_id is not null then
    update public.ebay_manual_listing_links
    set ebay_item_id = p_ebay_item_id,
        ebay_url = p_ebay_url,
        opportunity_id = p_opportunity_id,
        candidate_key = p_candidate_key,
        market_radar_product_id = v_opportunity.market_radar_product_id,
        supplier_variant_id = coalesce(
          v_opportunity.supplier_variant_id,
          nullif(trim(p_supplier_variant_id), '')
        ),
        supplier_sku = coalesce(
          v_opportunity.supplier_sku,
          nullif(trim(p_supplier_sku), '')
        ),
        verification_status = p_verification_status,
        verification_method = p_verification_method,
        verification_reason = p_verification_reason,
        connector_listing_id = v_connector.id,
        connector_listing_status = v_connector.listing_status,
        connector_ebay_sku = v_connector.ebay_sku,
        safe_defaults = coalesce(p_safe_defaults, '{}'::jsonb),
        verified_at = now(),
        last_verification_at = now(),
        verification_attempt_count = verification_attempt_count + 1,
        updated_by = p_actor_user_id,
        updated_at = now()
    where id = v_relink_link_id
      and account_key = p_account_key
    returning * into v_link;
    if not found then
      raise exception 'MANUAL_LISTING_COMPENSATED_RELINK_FAILED';
    end if;
    update public.ebay_seller_listing_templates
    set status = 'superseded', updated_by = p_actor_user_id,
        updated_at = now()
    where source_link_id = v_link.id and status = 'active';
    return next v_link;
    return;
  end if;

  insert into public.ebay_manual_listing_links ($new$;
begin
  select pg_get_functiondef(v_signature) into strict v_definition;
  if strpos(v_definition, v_declaration_new) = 0 then
    if strpos(v_definition, v_declaration_old) = 0 then
      raise exception 'EBAY_COMPENSATED_RELINK_DECLARATION_TARGET_MISSING';
    end if;
    v_definition := replace(
      v_definition, v_declaration_old, v_declaration_new
    );
  end if;
  if strpos(v_definition, v_conflict_new) = 0 then
    if strpos(v_definition, v_conflict_old) = 0 then
      raise exception 'EBAY_COMPENSATED_RELINK_CONFLICT_TARGET_MISSING';
    end if;
    v_definition := replace(v_definition, v_conflict_old, v_conflict_new);
  end if;
  if strpos(v_definition, v_insert_replacement) = 0 then
    if strpos(v_definition, v_insert_anchor) = 0 then
      raise exception 'EBAY_COMPENSATED_RELINK_INSERT_TARGET_MISSING';
    end if;
    v_definition := replace(
      v_definition, v_insert_anchor, v_insert_replacement
    );
  end if;
  execute v_definition;
end;
$relink_core$;

do $assertion$
declare
  v_record text;
  v_core text;
begin
  select pg_get_functiondef(
    'public.record_ebay_authorized_listing_published(uuid,uuid,text,integer,boolean)'::regprocedure
  ) into strict v_record;
  select pg_get_functiondef(
    'public.register_ebay_manual_listing_link_canonical_core_v1(text,text,text,uuid,text,text,text,text,text,text,text,timestamptz,jsonb,uuid)'::regprocedure
  ) into strict v_core;
  if strpos(v_record,
      'sanitized_result = sanitized_result || jsonb_build_object') = 0
    or strpos(v_core, 'v_relink_link_id uuid := null') = 0
    or strpos(v_core, 'compensatedListingId') = 0
    or strpos(v_core, 'MANUAL_LISTING_COMPENSATED_RELINK_FAILED') = 0 then
    raise exception 'EBAY_COMPENSATED_PUBLICATION_RECOVERY_ALIGNMENT_FAILED';
  end if;
end;
$assertion$;

notify pgrst, 'reload schema';
