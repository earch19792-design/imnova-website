-- Recover one exact UNPUBLISHED Offer after eBay Inventory error 25005.
-- The repair is category-only, preserves the rejected before-state in an
-- append-only audit event, and rearms the corrected preview without publishing.

create table if not exists public.ebay_rejected_category_repair_events (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null unique
    references public.ebay_authorized_listing_publications(id)
      on delete restrict,
  draft_execution_id uuid not null
    references public.ebay_draft_only_execution_ledger(id)
      on delete restrict,
  draft_approval_id uuid not null
    references public.ebay_draft_only_approvals(id)
      on delete restrict,
  listing_package_id uuid not null
    references public.ebay_listing_packages(id)
      on delete restrict,
  opportunity_id uuid not null
    references public.ebay_luna_opportunity_queue(id)
      on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  marketplace_account_key text not null,
  account_fingerprint text not null,
  offer_id text not null,
  sku text not null,
  ebay_error_id text not null,
  old_category_id text not null,
  new_category_id text not null,
  new_category_name text not null,
  taxonomy_tree_id text not null,
  taxonomy_tree_version text not null,
  taxonomy_observed_at timestamptz not null,
  category_resolution text not null,
  old_payload_hash text not null,
  new_payload_hash text not null,
  old_preview_hash text not null,
  new_preview_hash text not null,
  old_approved_payload jsonb not null,
  new_approved_payload jsonb not null,
  old_preview jsonb not null,
  new_preview jsonb not null,
  rejected_publish_result jsonb not null,
  ebay_update_http_status integer not null,
  ebay_update_reconciled boolean not null,
  ebay_write_attempted boolean not null,
  action_version text not null
    default 'EBAY_REJECTED_CATEGORY_REPAIR_V1',
  repaired_at timestamptz not null default now(),
  constraint ebay_rejected_category_repair_error_check
    check (ebay_error_id = '25005'),
  constraint ebay_rejected_category_repair_categories_check check (
    old_category_id ~ '^[0-9]{1,12}$'
    and new_category_id ~ '^[0-9]{1,12}$'
    and old_category_id <> new_category_id
  ),
  constraint ebay_rejected_category_repair_hashes_check check (
    old_payload_hash ~ '^[0-9a-f]{64}$'
    and new_payload_hash ~ '^[0-9a-f]{64}$'
    and old_preview_hash ~ '^[0-9a-f]{64}$'
    and new_preview_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_rejected_category_repair_identity_check check (
    account_fingerprint ~ '^[0-9a-f]{64}$'
    and offer_id ~ '^[A-Za-z0-9_-]{1,80}$'
    and sku ~ '^IMNOVA[A-F0-9]{32}$'
  ),
  constraint ebay_rejected_category_repair_taxonomy_check check (
    taxonomy_tree_id ~ '^[0-9]{1,12}$'
    and length(taxonomy_tree_version) between 1 and 80
    and category_resolution in (
      'TITLE_SUGGESTION',
      'TITLE_SUGGESTION_FALLBACK'
    )
  ),
  constraint ebay_rejected_category_repair_http_check check (
    ebay_update_http_status in (200, 204)
  )
);

alter table public.ebay_rejected_category_repair_events
  enable row level security;
alter table public.ebay_rejected_category_repair_events
  force row level security;

revoke all on public.ebay_rejected_category_repair_events
  from public, anon, authenticated, service_role;
grant select, insert on public.ebay_rejected_category_repair_events
  to service_role;

create or replace function
  public.prevent_ebay_rejected_category_repair_event_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_AUDIT_APPEND_ONLY';
end;
$$;

revoke all on function
  public.prevent_ebay_rejected_category_repair_event_mutation()
from public, anon, authenticated;
grant execute on function
  public.prevent_ebay_rejected_category_repair_event_mutation()
to service_role;

drop trigger if exists ebay_rejected_category_repair_events_append_only
on public.ebay_rejected_category_repair_events;
create trigger ebay_rejected_category_repair_events_append_only
before update or delete on public.ebay_rejected_category_repair_events
for each row execute function
  public.prevent_ebay_rejected_category_repair_event_mutation();

create or replace function
  public.repair_rejected_ebay_offer_category_once(
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
    p_ebay_update_http_status integer,
    p_ebay_update_reconciled boolean,
    p_ebay_write_attempted boolean
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
    or p_category_resolution not in (
      'TITLE_SUGGESTION',
      'TITLE_SUGGESTION_FALLBACK'
    )
    or coalesce(p_new_payload_hash, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_new_preview_hash, '') !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(coalesce(p_new_approved_payload, 'null'::jsonb))
      <> 'object'
    or jsonb_typeof(coalesce(p_new_preview, 'null'::jsonb)) <> 'object'
    or p_new_approved_payload#>>'{offerPayload,categoryId}'
      is distinct from p_new_category_id
    or p_new_approved_payload#>>'{compliance,aspectValidation,categoryId}'
      is distinct from p_new_category_id
    or p_new_approved_payload#>>'{compliance,aspectValidation,validated}'
      <> 'true'
    or p_new_approved_payload#>>'{compliance,aspectValidation,categoryTreeId}'
      is distinct from p_taxonomy_tree_id
    or p_new_approved_payload#>>'{compliance,aspectValidation,categoryTreeVersion}'
      is distinct from p_taxonomy_tree_version
    or p_new_approved_payload#>>'{compliance,aspectValidation,source}'
      <> 'EBAY_TAXONOMY_OFFICIAL_READONLY'
    or p_new_preview->>'version'
      <> 'EBAY_AUTHORIZED_LISTING_PUBLICATION_V1'
    or p_new_preview->>'permittedOperation' <> 'publishOffer'
    or p_new_preview->>'approvedPayloadHash'
      is distinct from p_new_payload_hash
    or p_new_preview#>>'{offerPayload,categoryId}'
      is distinct from p_new_category_id
    or p_ebay_update_http_status not in (200, 204)
    or (
      not p_ebay_write_attempted
      and not p_ebay_update_reconciled
    ) then
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
      or v_publication.publish_recovery_count <> 1 then
      raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_IDEMPOTENCY_MISMATCH';
    end if;
    return next v_publication;
    return;
  end if;

  if v_publication.actor_user_id is distinct from p_actor_user_id
    or v_publication.phase <> 'terminal_failure'
    or v_publication.publish_http_status <> 400
    or v_publication.last_error_code
      is distinct from 'EBAY_PUBLISH_WRITE_REJECTED'
    or v_publication.listing_id is not null
    or v_publication.publish_attempt_count <> 1
    or coalesce(v_publication.publish_recovery_count, 0) > 1
    or v_publication.sanitized_result#>>'{details,errors,0,errorId}'
      is distinct from '25005'
    or v_publication.preview#>>'{offerPayload,categoryId}'
      is distinct from p_old_category_id then
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
    or v_approval.payload_hash
      is distinct from v_publication.preview->>'approvedPayloadHash'
    or v_approval.approved_payload#>>'{offerPayload,categoryId}'
      is distinct from p_old_category_id
    or v_package.package_data->>'categoryId'
      is distinct from p_old_category_id
    or v_execution.offer_id is distinct from v_publication.offer_id
    or v_execution.sku is distinct from v_publication.sku
    or p_new_approved_payload->>'sku' is distinct from v_execution.sku
    or p_new_preview->>'offerId' is distinct from v_execution.offer_id
    or p_new_preview->>'sku' is distinct from v_execution.sku
    or p_new_preview->>'draftExecutionId'
      is distinct from v_execution.id::text
    or p_new_preview->>'draftApprovalId'
      is distinct from v_approval.id::text
    or p_new_preview->>'listingPackageId'
      is distinct from v_package.id::text then
    raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_CHAIN_CHANGED';
  end if;

  -- Only offerPayload.categoryId and the official aspect-validation evidence
  -- may change in the consumed payload. Product, images, quantity, price,
  -- policies, location and every other authorization remain byte-equivalent
  -- at the jsonb level.
  if (
      (v_approval.approved_payload - 'offerPayload' - 'compliance')
      is distinct from
      (p_new_approved_payload - 'offerPayload' - 'compliance')
    )
    or (
      (v_approval.approved_payload->'offerPayload') - 'categoryId'
      is distinct from
      (p_new_approved_payload->'offerPayload') - 'categoryId'
    )
    or (
      (v_approval.approved_payload->'compliance') - 'aspectValidation'
      is distinct from
      (p_new_approved_payload->'compliance') - 'aspectValidation'
    )
    or (
      (v_publication.preview - 'approvedPayloadHash' - 'offerPayload')
      is distinct from
      (p_new_preview - 'approvedPayloadHash' - 'offerPayload')
    )
    or (
      (v_publication.preview->'offerPayload') - 'categoryId'
      is distinct from
      (p_new_preview->'offerPayload') - 'categoryId'
    ) then
    raise exception 'EBAY_REJECTED_CATEGORY_REPAIR_SCOPE_EXCEEDED';
  end if;

  v_taxonomy_evidence := jsonb_build_object(
    'source', 'EBAY_TAXONOMY_OFFICIAL_READONLY',
    'categoryId', p_new_category_id,
    'categoryName', trim(p_new_category_name),
    'categoryTreeId', p_taxonomy_tree_id,
    'categoryTreeVersion', trim(p_taxonomy_tree_version),
    'categoryResolution', p_category_resolution,
    'observedAt', p_taxonomy_observed_at,
    'repairEventId', v_event_id
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
    ebay_update_http_status,
    ebay_update_reconciled,
    ebay_write_attempted
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
    p_ebay_update_http_status,
    p_ebay_update_reconciled,
    p_ebay_write_attempted
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
          'ebayUpdateHttpStatus', p_ebay_update_http_status,
          'ebayUpdateReconciled', p_ebay_update_reconciled,
          'ebayWriteAttempted', p_ebay_write_attempted,
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
  public.repair_rejected_ebay_offer_category_once(
    uuid, uuid, text, text, text, text, text, text, timestamptz, text,
    text, jsonb, text, jsonb, integer, boolean, boolean
  )
from public, anon, authenticated;
grant execute on function
  public.repair_rejected_ebay_offer_category_once(
    uuid, uuid, text, text, text, text, text, text, timestamptz, text,
    text, jsonb, text, jsonb, integer, boolean, boolean
  )
to service_role;

comment on table public.ebay_rejected_category_repair_events
is
  'Append-only before/after audit for one official Taxonomy category repair on an existing UNPUBLISHED Offer rejected with Inventory error 25005.';

comment on function
  public.repair_rejected_ebay_offer_category_once(
    uuid, uuid, text, text, text, text, text, text, timestamptz, text,
    text, jsonb, text, jsonb, integer, boolean, boolean
  )
is
  'Atomically persists a verified category-only eBay Offer repair and rearms its corrected preview; never performs or authorizes publishOffer.';

notify pgrst, 'reload schema';
