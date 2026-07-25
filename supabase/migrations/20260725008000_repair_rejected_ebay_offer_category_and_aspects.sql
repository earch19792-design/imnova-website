-- Extend rejected-category repair to include official Item Specifics additions.
-- This keeps the exact same UNPUBLISHED Offer path and does not call publishOffer.

alter table public.ebay_rejected_category_repair_events
  add column if not exists old_inventory_aspects jsonb not null default '{}'::jsonb;
alter table public.ebay_rejected_category_repair_events
  add column if not exists new_inventory_aspects jsonb not null default '{}'::jsonb;
alter table public.ebay_rejected_category_repair_events
  add column if not exists added_required_aspects jsonb not null default '{}'::jsonb;
alter table public.ebay_rejected_category_repair_events
  add column if not exists inventory_update_http_status integer;
alter table public.ebay_rejected_category_repair_events
  add column if not exists inventory_update_reconciled boolean;
alter table public.ebay_rejected_category_repair_events
  add column if not exists inventory_write_attempted boolean;
alter table public.ebay_rejected_category_repair_events
  add column if not exists offer_update_http_status integer;
alter table public.ebay_rejected_category_repair_events
  add column if not exists offer_update_reconciled boolean;
alter table public.ebay_rejected_category_repair_events
  add column if not exists offer_write_attempted boolean;

alter table public.ebay_rejected_category_repair_events
  add constraint ebay_rejected_category_repair_aspects_check
  check (
    jsonb_typeof(old_inventory_aspects) = 'object'
    and jsonb_typeof(new_inventory_aspects) = 'object'
    and jsonb_typeof(added_required_aspects) = 'object'
  );

create or replace function
  public.repair_rejected_ebay_offer_category_and_aspects_once(
    p_publication_id uuid,
    p_actor_user_id uuid,
    p_confirmation text,
    p_old_category_id text,
    p_new_category_id text,
    p_new_category_name text,
    p_taxonomy_tree_id text,
    p_taxonomy_tree_version text,
    p_taxonomy_observed_at timestamptz,
    p_category_resolution text,
    p_new_payload_hash text,
    p_new_approved_payload jsonb,
    p_new_preview_hash text,
    p_new_preview jsonb,
    p_added_required_aspects jsonb,
    p_inventory_update_http_status integer,
    p_inventory_update_reconciled boolean,
    p_inventory_write_attempted boolean,
    p_offer_update_http_status integer,
    p_offer_update_reconciled boolean,
    p_offer_write_attempted boolean
  )
returns setof public.ebay_authorized_listing_publications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_publication public.ebay_authorized_listing_publications%rowtype;
  v_approval public.ebay_draft_only_approvals%rowtype;
  v_execution public.ebay_draft_only_execution_ledger%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_existing public.ebay_rejected_category_repair_events%rowtype;
  v_event_id uuid := gen_random_uuid();
  v_taxonomy_evidence jsonb;
  v_old_aspects jsonb;
  v_new_aspects jsonb;
  v_new_required_aspects jsonb;
  v_added_required_aspects jsonb := coalesce(p_added_required_aspects, '{}'::jsonb);
  v_old_aspect_values jsonb;
  v_new_aspect_values jsonb;
  v_aspect_name text;
begin
  if p_actor_user_id is null
    or p_confirmation <> 'REPARAR CATEGORIA OFICIAL SIN PUBLICAR'
    or coalesce(p_old_category_id, '') !~ '^[0-9]{1,12}$'
    or coalesce(p_new_category_id, '') !~ '^[0-9]{1,12}$'
    or p_old_category_id = p_new_category_id
    or length(trim(coalesce(p_new_category_name, ''))) not between 1 and 200
    or coalesce(p_taxonomy_tree_id, '') !~ '^[0-9]{1,12}$'
    or length(trim(coalesce(p_taxonomy_tree_version, ''))) not between 1 and 80
    or p_taxonomy_observed_at < clock_timestamp() - interval '24 hours'
    or p_taxonomy_observed_at > clock_timestamp() + interval '5 minutes'
    or p_category_resolution not in ('TITLE_SUGGESTION', 'TITLE_SUGGESTION_FALLBACK')
    or coalesce(p_new_payload_hash, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_new_preview_hash, '') !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(coalesce(p_new_approved_payload, 'null'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_new_preview, 'null'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(v_added_required_aspects, 'null'::jsonb)) <> 'object'
    or p_new_approved_payload#>>'{offerPayload,categoryId}' is distinct from p_new_category_id
    or p_new_approved_payload#>>'{compliance,aspectValidation,categoryId}' is distinct from p_new_category_id
    or p_new_approved_payload#>>'{compliance,aspectValidation,validated}' <> 'true'
    or p_new_approved_payload#>>'{compliance,aspectValidation,categoryTreeId}'
      is distinct from p_taxonomy_tree_id
    or p_new_approved_payload#>>'{compliance,aspectValidation,categoryTreeVersion}'
      is distinct from p_taxonomy_tree_version
    or p_new_approved_payload#>>'{compliance,aspectValidation,source}'
      <> 'EBAY_TAXONOMY_OFFICIAL_READONLY'
    or p_new_preview->>'version' <> 'EBAY_AUTHORIZED_LISTING_PUBLICATION_V1'
    or p_new_preview->>'permittedOperation' <> 'publishOffer'
    or p_new_preview->>'approvedPayloadHash' is distinct from p_new_payload_hash
    or p_new_preview#>>'{offerPayload,categoryId}' is distinct from p_new_category_id
  then
    raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_INPUT_INVALID';
  end if;

  select * into v_publication
  from public.ebay_authorized_listing_publications
  where id = p_publication_id
  for update;
  if not found then
    raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_PUBLICATION_NOT_FOUND';
  end if;

  select * into v_existing
  from public.ebay_rejected_category_repair_events
  where publication_id = p_publication_id;
  if found then
    if v_existing.actor_user_id is distinct from p_actor_user_id
      or v_existing.old_category_id is distinct from p_old_category_id
      or v_existing.new_category_id is distinct from p_new_category_id
      or v_existing.new_payload_hash is distinct from p_new_payload_hash
      or v_existing.new_preview_hash is distinct from p_new_preview_hash
      or v_publication.phase <> 'preview_ready'
      or v_publication.preview_hash is distinct from p_new_preview_hash
      or v_publication.publish_recovery_count <> 1
      or v_existing.action_version is distinct from 'EBAY_REJECTED_CATEGORY_REPAIR_V2'
    then
      raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_IDEMPOTENCY_MISMATCH';
    end if;
    return next v_publication;
    return;
  end if;

  if v_publication.actor_user_id is distinct from p_actor_user_id
    or v_publication.phase <> 'terminal_failure'
    or v_publication.publish_http_status <> 400
    or v_publication.last_error_code is distinct from 'EBAY_PUBLISH_WRITE_REJECTED'
    or v_publication.listing_id is not null
    or v_publication.publish_attempt_count <> 1
    or coalesce(v_publication.publish_recovery_count, 0) > 1
    or v_publication.sanitized_result#>>'{details,errors,0,errorId}'
      is distinct from '25005'
    or v_publication.preview#>>'{offerPayload,categoryId}'
      is distinct from p_old_category_id
  then
    raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_NOT_ELIGIBLE';
  end if;

  select * into v_approval
  from public.ebay_draft_only_approvals
  where id = v_publication.draft_approval_id
  for update;
  select * into v_execution
  from public.ebay_draft_only_execution_ledger
  where id = v_publication.draft_execution_id
  for update;
  select * into v_package
  from public.ebay_listing_packages
  where id = v_publication.listing_package_id
  for update;

  if v_approval.id is null
    or v_execution.id is null
    or v_package.id is null
    or v_approval.actor_user_id is distinct from p_actor_user_id
    or v_execution.actor_user_id is distinct from p_actor_user_id
    or v_package.created_by is distinct from p_actor_user_id
    or v_approval.status <> 'consumed'
    or v_execution.phase <> 'completed'
    or v_approval.payload_hash is distinct from v_execution.request_hash
    or v_approval.payload_hash is distinct from v_publication.preview->>'approvedPayloadHash'
    or v_approval.approved_payload#>>'{offerPayload,categoryId}' is distinct from p_old_category_id
    or v_publication.preview#>>'{offerPayload,categoryId}'
      is distinct from p_old_category_id
    or p_new_preview->>'offerId' is distinct from v_execution.offer_id::text
    or p_new_preview->>'sku' is distinct from v_execution.sku
    or p_new_preview->>'draftExecutionId' is distinct from v_execution.id::text
    or p_new_preview->>'draftApprovalId' is distinct from v_approval.id::text
    or p_new_preview->>'listingPackageId' is distinct from v_package.id::text
  then
    raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_CHAIN_CHANGED';
  end if;

  if (v_approval.approved_payload - 'offerPayload' - 'compliance' - 'inventoryItemPayload')
      is distinct from
      (p_new_approved_payload - 'offerPayload' - 'compliance' - 'inventoryItemPayload')
    or ((v_approval.approved_payload->'offerPayload') - 'categoryId')
      is distinct from
      (p_new_approved_payload->'offerPayload' - 'categoryId')
    or ((v_approval.approved_payload->'compliance') - 'aspectValidation')
      is distinct from
      (p_new_approved_payload->'compliance' - 'aspectValidation')
    or ((v_approval.approved_payload->'inventoryItemPayload'->'product') - 'aspects')
      is distinct from
      ((p_new_approved_payload->'inventoryItemPayload'->'product') - 'aspects')
    or ((v_publication.preview - 'approvedPayloadHash' - 'offerPayload' - 'inventoryItemPayload')
      is distinct from
      (p_new_preview - 'approvedPayloadHash' - 'offerPayload' - 'inventoryItemPayload'))
  then
    raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_SCOPE_EXCEEDED';
  end if;

  v_old_aspects := coalesce(
    v_approval.approved_payload#>'{inventoryItemPayload,product,aspects}',
    '{}'::jsonb
  );
  v_new_aspects := coalesce(
    p_new_approved_payload#>'{inventoryItemPayload,product,aspects}',
    '{}'::jsonb
  );
  v_new_required_aspects := coalesce(
    p_new_approved_payload#>'{compliance,aspectValidation,requiredAspects}',
    '[]'::jsonb
  );

  if jsonb_typeof(v_old_aspects) <> 'object'
    or jsonb_typeof(v_new_aspects) <> 'object'
    or jsonb_typeof(v_new_required_aspects) <> 'array'
  then
    raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_ASPECT_VALIDATION_INVALID';
  end if;

  for v_aspect_name in
    select k.key from jsonb_object_keys(v_added_required_aspects) as k(key)
  loop
    v_new_aspect_values := v_new_aspects -> v_aspect_name;
    v_old_aspect_values := v_old_aspects -> v_aspect_name;
    if v_old_aspect_values is not null
      or jsonb_typeof(v_new_aspect_values) <> 'array'
      or jsonb_array_length(v_new_aspect_values) = 0
      or jsonb_typeof(v_added_required_aspects -> v_aspect_name) <> 'array'
      or jsonb_array_length(v_added_required_aspects -> v_aspect_name) = 0
      or not (to_jsonb(v_aspect_name) <@ v_new_required_aspects)
      or (v_new_aspect_values is distinct from (v_added_required_aspects -> v_aspect_name))
      or exists (
        select 1
        from jsonb_array_elements_text(v_new_aspect_values) as new_value(value)
        where btrim(value) = ''
      )
      or exists (
        select 1
        from jsonb_array_elements_text(v_added_required_aspects -> v_aspect_name) as added_value(value)
        where btrim(value) = ''
      )
    then
      raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_INVALID_ADDED_ASPECTS';
    end if;
  end loop;

  for v_aspect_name in
    select k.key from jsonb_object_keys(v_old_aspects) as k(key)
  loop
    v_old_aspect_values := v_old_aspects -> v_aspect_name;
    v_new_aspect_values := v_new_aspects -> v_aspect_name;
    if jsonb_typeof(v_old_aspect_values) <> 'array'
      or jsonb_typeof(v_new_aspect_values) <> 'array'
      or (
        v_old_aspect_values @> v_new_aspect_values
        is distinct from true
      )
      or (
        v_new_aspect_values @> v_old_aspect_values
        is distinct from true
      )
      or (v_added_required_aspects ? v_aspect_name)
    then
      raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_SCOPE_EXCEEDED';
    end if;
    if exists (
      select 1
      from jsonb_array_elements_text(v_old_aspect_values) as old_value(value)
      where btrim(value) = ''
    ) then
      raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_SCOPE_EXCEEDED';
    end if;
  end loop;

  for v_aspect_name in
    select k.key from jsonb_object_keys(v_new_aspects) as k(key)
  loop
    if not (v_old_aspects ? v_aspect_name)
      and not (v_added_required_aspects ? v_aspect_name)
    then
      raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_SCOPE_EXCEEDED';
    end if;
  end loop;

  if coalesce(p_inventory_update_http_status, 0) in (200, 204) then
    if p_inventory_write_attempted is distinct from true then
      raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_INPUT_INVALID';
    end if;
  elsif coalesce(p_inventory_update_reconciled, false) is distinct from true then
    raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_INPUT_INVALID';
  end if;

  if coalesce(p_offer_update_http_status, 0) in (200, 204) then
    if p_offer_write_attempted is distinct from true then
      raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_INPUT_INVALID';
    end if;
  elsif coalesce(p_offer_update_reconciled, false) is distinct from true then
    raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_INPUT_INVALID';
  end if;

  v_taxonomy_evidence := jsonb_build_object(
    'source', 'EBAY_TAXONOMY_OFFICIAL_READONLY',
    'categoryId', p_new_category_id,
    'categoryName', trim(p_new_category_name),
    'categoryTreeId', p_taxonomy_tree_id,
    'categoryTreeVersion', trim(p_taxonomy_tree_version),
    'categoryResolution', p_category_resolution,
    'observedAt', p_taxonomy_observed_at,
    'addedRequiredAspectCount', coalesce(jsonb_object_length(v_added_required_aspects), 0),
    'addedRequiredAspects', v_added_required_aspects,
    'repairEventId', v_event_id,
    'offerUpdateHttpStatus', p_offer_update_http_status,
    'offerUpdateReconciled', coalesce(p_offer_update_reconciled, false),
    'offerWriteAttempted', coalesce(p_offer_write_attempted, false),
    'inventoryUpdateHttpStatus', coalesce(p_inventory_update_http_status, 0),
    'inventoryUpdateReconciled', coalesce(p_inventory_update_reconciled, false),
    'inventoryWriteAttempted', coalesce(p_inventory_write_attempted, false)
  );

  update public.ebay_listing_packages
  set package_data = jsonb_set(
        jsonb_set(
          jsonb_set(
            package_data,
            '{categoryId}',
            to_jsonb(p_new_category_id),
            true
          ),
          '{categoryName}',
          to_jsonb(trim(p_new_category_name)),
          true
        ),
        '{categoryTaxonomyEvidence}',
        v_taxonomy_evidence,
        true
      ),
      updated_at = clock_timestamp()
  where id = v_package.id
    and package_data->>'categoryId' = p_old_category_id;
  if not found then
    raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_PACKAGE_CHANGED';
  end if;

  update public.ebay_draft_only_approvals
  set approved_payload = p_new_approved_payload,
      payload_hash = p_new_payload_hash,
      updated_at = clock_timestamp()
  where id = v_approval.id
    and payload_hash = v_approval.payload_hash;
  if not found then
    raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_APPROVAL_CHANGED';
  end if;

  update public.ebay_draft_only_execution_ledger
  set request_hash = p_new_payload_hash,
      sanitized_result = sanitized_result || jsonb_build_object(
        'rejectedCategoryRepair',
        v_taxonomy_evidence || jsonb_build_object(
          'oldCategoryId', p_old_category_id,
          'newPayloadHash', p_new_payload_hash
        )
      ),
      updated_at = clock_timestamp()
  where id = v_execution.id
    and request_hash = v_execution.request_hash
    and phase = 'completed';
  if not found then
    raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_EXECUTION_CHANGED';
  end if;

  insert into public.ebay_rejected_category_repair_events (
    id,
    publication_id,
    draft_execution_id,
    draft_approval_id,
    listing_package_id,
    opportunity_id,
    actor_user_id,
    marketplace_account_key,
    account_fingerprint,
    offer_id,
    sku,
    ebay_error_id,
    old_category_id,
    new_category_id,
    new_category_name,
    taxonomy_tree_id,
    taxonomy_tree_version,
    taxonomy_observed_at,
    category_resolution,
    old_payload_hash,
    new_payload_hash,
    old_preview_hash,
    new_preview_hash,
    old_approved_payload,
    new_approved_payload,
    old_preview,
    new_preview,
    rejected_publish_result,
    old_inventory_aspects,
    new_inventory_aspects,
    added_required_aspects,
    inventory_update_http_status,
    inventory_update_reconciled,
    inventory_write_attempted,
    offer_update_http_status,
    offer_update_reconciled,
    offer_write_attempted,
    action_version
  ) values (
    v_event_id,
    v_publication.id,
    v_execution.id,
    v_approval.id,
    v_package.id,
    v_publication.opportunity_id,
    p_actor_user_id,
    v_publication.marketplace_account_key,
    v_publication.account_fingerprint,
    v_publication.offer_id,
    v_publication.sku,
    '25005',
    p_old_category_id,
    p_new_category_id,
    trim(p_new_category_name),
    p_taxonomy_tree_id,
    trim(p_taxonomy_tree_version),
    p_taxonomy_observed_at,
    p_category_resolution,
    v_approval.payload_hash,
    p_new_payload_hash,
    v_publication.preview_hash,
    p_new_preview_hash,
    v_approval.approved_payload,
    p_new_approved_payload,
    v_publication.preview,
    p_new_preview,
    v_publication.sanitized_result,
    v_old_aspects,
    v_new_aspects,
    v_added_required_aspects,
    p_inventory_update_http_status,
    p_inventory_update_reconciled,
    p_inventory_write_attempted,
    p_offer_update_http_status,
    p_offer_update_reconciled,
    p_offer_write_attempted,
    'EBAY_REJECTED_CATEGORY_REPAIR_V2'
  );

  update public.ebay_authorized_listing_publications
  set preview = p_new_preview,
      preview_hash = p_new_preview_hash,
      phase = 'preview_ready',
      publication_idempotency_key = null,
      publish_attempt_count = 0,
      publish_recovery_count = 1,
      claim_token = null,
      lease_expires_at = null,
      publish_http_status = null,
      publish_started_at = null,
      preview_prepared_at = clock_timestamp(),
      last_error_code = null,
      sanitized_result = sanitized_result || jsonb_build_object(
        'rejectedCategoryRepair',
        v_taxonomy_evidence || jsonb_build_object(
          'oldCategoryId', p_old_category_id,
          'newPreviewHash', p_new_preview_hash,
          'ebayUpdateHttpStatus', p_offer_update_http_status,
          'ebayUpdateReconciled', p_offer_update_reconciled,
          'ebayWriteAttempted', p_offer_write_attempted,
          'inventoryUpdateHttpStatus', coalesce(p_inventory_update_http_status, 0),
          'inventoryUpdateReconciled', p_inventory_update_reconciled,
          'inventoryWriteAttempted', p_inventory_write_attempted,
          'publishOfferCalled', false
        )
      ),
      updated_at = clock_timestamp()
  where id = v_publication.id
    and phase = 'terminal_failure'
    and preview_hash = v_publication.preview_hash
  returning * into v_publication;
  if not found then
    raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_PUBLICATION_CHANGED';
  end if;

  return next v_publication;
end;
$$;

revoke all on function
  public.repair_rejected_ebay_offer_category_and_aspects_once(
    uuid, uuid, text, text, text, text, text, text, timestamptz, text,
    text, jsonb, text, jsonb, jsonb, integer, boolean, boolean,
    integer, boolean, boolean
  )
from public, anon, authenticated;
grant execute on function
  public.repair_rejected_ebay_offer_category_and_aspects_once(
    uuid, uuid, text, text, text, text, text, text, timestamptz, text,
    text, jsonb, text, jsonb, jsonb, integer, boolean, boolean,
    integer, boolean, boolean
  )
to service_role;

comment on function
  public.repair_rejected_ebay_offer_category_and_aspects_once(
    uuid, uuid, text, text, text, text, text, text, timestamptz, text,
    text, jsonb, text, jsonb, jsonb, integer, boolean, boolean,
    integer, boolean, boolean
  )
is
  'Atomically persists a verified category+aspect repair on an existing UNPUBLISHED Offer, with one-time reconciliation and no publishOffer call.';

notify pgrst, 'reload schema';
